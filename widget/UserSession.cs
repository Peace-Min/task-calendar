using System;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace TaskCalendarWidget
{
    // 로그인 세션 영속 — 위젯을 다시 켰을 때 netcus에 재접속하지 않고 신원을 복원하기 위한 로컬 캐시.
    //
    // ★ 이 파일이 하는 일은 '재인증'이 아니라 '세션 유지'다.
    //   부팅 경로에서 netcus로 나가는 코드는 단 하나도 없어야 한다(보조 WebView2 창이 뜨는 순간 설계 위반).
    //   실제 인증은 로그인 시 1회만 일어나고(NetcusService.LoginVerify), 그 결과를 여기에 저장한다.
    //
    // ★ DPAPI(CurrentUser)로 감싸는 이유:
    //   평문 JSON이면 loginId 한 줄만 고쳐 남의 신원으로 들어올 수 있다(이름·소속·권한을 자칭하게 된다).
    //   DPAPI CurrentUser 스코프로 감싸면 그 PC의 그 계정 밖에서는 복호화 자체가 불가능해
    //   손편집이 사실상 막힌다(고치면 복호화 실패 → 조용히 폐기 → 로그인 팝업).
    //   netcus 자격증명(netcus.cred)이 이미 쓰는 방식과 같다(Dpapi.Protect/Unprotect).
    //
    // 저장 파일: <dataDir>/user.session  (JSON → UTF8 → Dpapi.Protect → Base64)
    internal sealed class UserSession
    {
        public string LoginId = "";
        public string Name = "";
        public string Title = "";
        public string OrgUnit = "";
        public string ViewScope = "";
        public string EditRole = "";
        public string AppVersion = "";
        public string SavedAt = "";

        private static string FileOf(string dataDir) => Path.Combine(dataDir, "user.session");

        // 실행 어셈블리 버전 — 앱 업데이트 시 저장 세션을 일괄 무효화하는 기준.
        public static string CurrentAppVersion()
        {
            try { return Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? ""; }
            catch { return ""; }
        }

        // 저장 — 쓰고 나서 '되읽어 확인'된 경우에만 성공으로 본다.
        // (이전 구현에서 "저장 성공"을 찍고도 파일이 그대로였던 사례가 있었다. 거짓 성공 보고 금지.)
        // 반환: (ok, msg) — 실패 사유에 경로를 포함해 로그로 추적 가능하게.
        public static (bool ok, string msg) Save(string dataDir, string loginId, string name, string title,
                                                 string orgUnit, string viewScope, string editRole,
                                                 string appVersion, Action<string>? log = null)
        {
            string path = FileOf(dataDir);
            try
            {
                Directory.CreateDirectory(dataDir);
                var payload = new
                {
                    loginId = loginId ?? "",
                    name = name ?? "",
                    title = title ?? "",
                    orgUnit = orgUnit ?? "",
                    viewScope = viewScope ?? "",
                    editRole = editRole ?? "",
                    appVersion = appVersion ?? "",
                    savedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                };
                string json = JsonSerializer.Serialize(payload);
                string b64 = Convert.ToBase64String(Dpapi.Protect(Encoding.UTF8.GetBytes(json)));
                File.WriteAllText(path, b64, new UTF8Encoding(false));

                // 되읽기 검증 — 파일이 실제로 바뀌었고 복호화까지 되는지 확인한 뒤에만 성공.
                var back = Load(dataDir, verifyVersion: false);
                if (back == null || !string.Equals(back.LoginId, loginId ?? "", StringComparison.Ordinal))
                {
                    log?.Invoke("사용자 세션 저장 확인 실패(되읽기 불일치): " + path);
                    return (false, "세션을 저장하지 못했습니다.");
                }
                log?.Invoke("사용자 세션 저장: " + (loginId ?? "") + " (앱 " + (appVersion ?? "") + ")");
                return (true, "");
            }
            catch (Exception ex)
            {
                log?.Invoke("사용자 세션 저장 실패: " + ex.Message + " / " + path);
                return (false, "세션을 저장하지 못했습니다.");
            }
        }

        // 로드 — 없거나 복호화 실패·JSON 손상이면 null(조용히 폐기 → 로그인 팝업).
        // verifyVersion=true(기본)면 저장된 appVersion이 현재와 다를 때 세션을 폐기한다(앱 업데이트 = 일괄 로그아웃).
        public static UserSession? Load(string dataDir, bool verifyVersion = true, Action<string>? log = null)
        {
            string path = FileOf(dataDir);
            try
            {
                if (!File.Exists(path)) return null;
                string b64 = File.ReadAllText(path, Encoding.UTF8).Trim();
                if (b64.Length == 0) return null;
                string json = Encoding.UTF8.GetString(Dpapi.Unprotect(Convert.FromBase64String(b64)));

                using var d = JsonDocument.Parse(json);
                var r = d.RootElement;
                var s = new UserSession
                {
                    LoginId   = Str(r, "loginId"),
                    Name      = Str(r, "name"),
                    Title     = Str(r, "title"),
                    OrgUnit   = Str(r, "orgUnit"),
                    ViewScope = Str(r, "viewScope"),
                    EditRole  = Str(r, "editRole"),
                    AppVersion = Str(r, "appVersion"),
                    SavedAt   = Str(r, "savedAt"),
                };
                if (s.LoginId.Length == 0) return null;   // 신원 없는 세션은 세션이 아니다

                if (verifyVersion)
                {
                    string cur = CurrentAppVersion();
                    if (!string.Equals(s.AppVersion, cur, StringComparison.Ordinal))
                    {
                        // 앱 업데이트 → 저장 세션 무효(일괄 로그아웃). 사유를 남겨야 "왜 갑자기 로그인하래?"에 답할 수 있다.
                        log?.Invoke("사용자 세션 폐기 — 앱 버전 변경(" + (s.AppVersion.Length > 0 ? s.AppVersion : "(없음)") + " → " + cur + ")");
                        Clear(dataDir, log);
                        return null;
                    }
                }
                return s;
            }
            catch (Exception ex)
            {
                // 복호화 실패(다른 PC/계정으로 복사됐거나 손편집) · JSON 손상 → 조용히 폐기.
                log?.Invoke("사용자 세션 로드 실패(폐기): " + ex.Message);
                return null;
            }
        }

        // 삭제(로그아웃 · 버전 불일치 폐기). 파일이 없으면 no-op.
        public static bool Clear(string dataDir, Action<string>? log = null)
        {
            string path = FileOf(dataDir);
            try
            {
                if (File.Exists(path)) File.Delete(path);
                return true;
            }
            catch (Exception ex) { log?.Invoke("사용자 세션 삭제 실패: " + ex.Message + " / " + path); return false; }
        }

        private static string Str(JsonElement r, string key) =>
            r.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";
    }
}
