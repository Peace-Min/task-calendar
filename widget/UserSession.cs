using System;
using System.IO;
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
    // ★ 필드는 4개뿐이다(USER-LOGIN §3.3):
    //   loginId = 본질(신원이자 쓰기 관문이 권한을 조회하는 키) · name/title/orgUnit = 설정창 「계정」 표시용
    //   (오프라인에서도 이름이 보여야 하므로 캐시 값어치가 있다).
    //   viewScope·editRole은 담지 않는다 — **권한은 작업 시점에 DB 쓰기 관문이 판정한다.**
    //   캐시된 권한은 아무도 읽지 않으면서 "이게 권한이다"는 오해만 부른다(실제로 그 오해가 한 번 일어났다).
    //   appVersion·savedAt도 담지 않는다 — 아래 참조.
    //
    // ★ 버전 기반 일괄 로그아웃은 폐기했다(USER-LOGIN §3.3).
    //   막으려던 것: ① 포맷 변경으로 잘못 읽힘 → Load가 복호화·JSON 실패 시 이미 조용히 null이다
    //               ② 권한 캐시 의미 변화 → 권한을 캐시하지 않으므로 변할 게 없다
    //               ③ 보안 사고 시 강제 리셋 → DB is_active=0/계정 정지가 정공법이다
    //   비용은 확실했다 — 릴리스마다 전원 재로그인(같은 날 0.14.0→0.14.1→0.14.2를 올린 이력이 있다).
    //   포맷이 정말 깨지는 날에는 파일명을 바꾼다(user.session → user2.session): 옛 파일은 안 읽히니
    //   자동으로 로그아웃되고 버전 비교 코드는 0줄이다.
    //   ★ 이 축소가 기존 사용자를 로그아웃시키지 않는다 — Load는 필드를 '이름으로' 읽으므로
    //     옛 파일에 남은 viewScope·editRole·appVersion·savedAt은 그냥 무시된다.
    //
    // ★ DPAPI(CurrentUser)로 감싸는 이유:
    //   평문 JSON이면 loginId 한 줄만 고쳐 남의 신원으로 들어올 수 있다(이름·소속을 자칭하게 된다).
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

        private static string FileOf(string dataDir) => Path.Combine(dataDir, "user.session");

        // 저장 — 쓰고 나서 '되읽어 확인'된 경우에만 성공으로 본다.
        // (이전 구현에서 "저장 성공"을 찍고도 파일이 그대로였던 사례가 있었다. 거짓 성공 보고 금지.)
        // 반환: (ok, msg) — 실패 사유에 경로를 포함해 로그로 추적 가능하게.
        public static (bool ok, string msg) Save(string dataDir, string loginId, string name, string title,
                                                 string orgUnit, Action<string>? log = null)
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
                };
                string json = JsonSerializer.Serialize(payload);
                string b64 = Convert.ToBase64String(Dpapi.Protect(Encoding.UTF8.GetBytes(json)));
                File.WriteAllText(path, b64, new UTF8Encoding(false));

                // 되읽기 검증 — 파일이 실제로 바뀌었고 복호화까지 되는지 확인한 뒤에만 성공.
                var back = Load(dataDir);
                if (back == null || !string.Equals(back.LoginId, loginId ?? "", StringComparison.Ordinal))
                {
                    log?.Invoke("사용자 세션 저장 확인 실패(되읽기 불일치): " + path);
                    return (false, "세션을 저장하지 못했습니다.");
                }
                log?.Invoke("사용자 세션 저장: " + (loginId ?? ""));
                return (true, "");
            }
            catch (Exception ex)
            {
                log?.Invoke("사용자 세션 저장 실패: " + ex.Message + " / " + path);
                return (false, "세션을 저장하지 못했습니다.");
            }
        }

        // 로드 — 없거나 복호화 실패·JSON 손상이면 null(조용히 폐기 → 로그인 팝업).
        // ★ 필드는 이름으로 읽는다 — 옛 파일에 남아 있는 추가 필드는 무시되고, 없는 필드는 ""가 된다.
        //   그래서 세션 스키마를 줄여도 기존 로그인은 그대로 살아 있다(일괄 로그아웃 유발 금지).
        public static UserSession? Load(string dataDir, Action<string>? log = null)
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
                    LoginId = Str(r, "loginId"),
                    Name    = Str(r, "name"),
                    Title   = Str(r, "title"),
                    OrgUnit = Str(r, "orgUnit"),
                };
                if (s.LoginId.Length == 0) return null;   // 신원 없는 세션은 세션이 아니다
                return s;
            }
            catch (Exception ex)
            {
                // 복호화 실패(다른 PC/계정으로 복사됐거나 손편집) · JSON 손상 → 조용히 폐기.
                log?.Invoke("사용자 세션 로드 실패(폐기): " + ex.Message);
                return null;
            }
        }

        // 삭제(로그아웃). 파일이 없으면 no-op.
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
