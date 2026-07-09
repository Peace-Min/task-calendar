using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;

// FtpWebRequest는 .NET에서 obsolete 경고(SYSLIB0014)지만 인박스 대체가 없고 폐쇄망 오프라인
// 셀프컨테인드 빌드가 추가 NuGet 없이 FTP를 써야 하므로 이 파일 한정으로 경고를 끈다.
#pragma warning disable SYSLIB0014

namespace TaskCalendarWidget
{
    // FTP/파일 기반 자동 업데이트. 관리자가 공유폴더(UpdateSourceUrl)에 latest.json + Setup exe를 올려두면,
    // 각 위젯이 시작 후 + 주기적으로 조용히 확인 → 새 버전이면 상단 배너 → '지금 업데이트' 시 내려받기·검증·설치·재시작.
    // 모든 실패(접근불가/파일없음/파싱오류/해시불일치)는 무음: Log만 남기고 UI·예외·시작지연 없음. URL 비면 완전 휴면.
    public partial class MainWindow
    {
        private System.Windows.Threading.DispatcherTimer? _updTimer;   // 30분 주기 확인(서버 오프 시 배너 자동 종료 반응성)
        private volatile bool _updBusy;                                // 적용(다운로드·설치) 중복 방지

        // 시작 시 1회 호출(Window_Loaded 끝). 시작을 막지 않도록 지연 1회 + 주기 타이머만 건다.
        private void UpdateInit()
        {
            try
            {
                // 시작 후 ~9초 지연 1회(창/웹뷰 준비 후, 시작 차단 방지) — 무음
                var first = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(9) };
                first.Tick += (_, _) => { first.Stop(); _ = CheckForUpdateAsync(false); };
                first.Start();
                // 이후 30분마다 무음 확인 — 새 버전 발견뿐 아니라 '서버 오프 → 열린 배너 자동 종료'도 이 주기로 반영(폐쇄망 로컬 소스라 부담 없음)
                _updTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMinutes(30) };
                _updTimer.Tick += (_, _) => { _ = CheckForUpdateAsync(false); };
                _updTimer.Start();
            }
            catch (Exception ex) { Log("UpdateInit 오류: " + ex.Message); }
        }

        // ---------- 확인 ----------
        // userInitiated=false(백그라운드): 더 높은 버전이면 __updateAvailable(배너), 그 외(최신/접근실패/파싱실패)면 __updateNone
        //   → 이미 떠 있는 배너를 조용히 닫는다(서버가 꺼진 뒤 배너가 남아 있지 않도록). 팝업/토스트 없음.
        // userInitiated=true(설정 '지금 확인'): '최신입니다'/'확인 실패'를 __updateResult로 조용히 알림.
        private async Task CheckForUpdateAsync(bool userInitiated = false)
        {
            string src = (_settings?.UpdateSourceUrl ?? "").Trim();
            if (src.Length == 0) return;   // 휴면
            if (_updBusy) return;          // 적용 진행 중이면 확인 생략
            try
            {
                string json = await FetchTextAsync(CombineUrl(src, "latest.json"), 6000);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                string mver = GetJsonStr(root, "version");
                var m = ParseVer(mver);
                var own = OwnVersion();
                if (m == null || own == null)
                {
                    if (userInitiated) UpdateResult(false, "업데이트 확인 실패 — 버전 정보를 읽지 못했습니다");
                    else UpdateNone();   // 백그라운드: 파싱 실패(매니페스트 이상) → 열린 배너 닫기
                    return;
                }
                if (IsNewer(m, own))
                {
                    string notes = GetJsonStr(root, "notes");
                    Log($"업데이트 발견: {mver} > 내 {own.ToString(3)}");
                    // __updateAvailable(infoJson) — HTML이 JSON.parse하므로 문자열로 전달(이중 직렬화).
                    string info = JsonSerializer.Serialize(new { version = mver, notes });
                    JsCall("window.__updateAvailable && window.__updateAvailable(" + JsonSerializer.Serialize(info) + ")");
                    // 설정 '지금 확인'이면 #updSrcMsg 스피너가 배너만으로는 안 풀리므로 결과도 함께 통지.
                    if (userInitiated) UpdateResult(true, "새 버전 발견 — 배너에서 업데이트하세요");
                }
                else
                {
                    Log($"업데이트 없음: 최신 {mver} ≤ 내 {own.ToString(3)}");
                    if (userInitiated) UpdateResult(true, "이미 최신 버전입니다 (v" + own.ToString(3) + ")");
                    else UpdateNone();   // 백그라운드: 더 높지 않음(최신) → 열린 배너 닫기
                }
            }
            catch (Exception ex)
            {
                Log("업데이트 확인 실패(무음): " + ex.Message);
                if (userInitiated) UpdateResult(false, "업데이트 확인 실패 — 소스에 접근할 수 없습니다");
                else UpdateNone();   // 백그라운드: 소스 접근/매니페스트 실패(서버 오프) → 열린 배너 닫기
            }
        }

        // ---------- 적용(다운로드 → 검증 → 설치 → 재시작) ----------
        private async Task ApplyUpdateAsync()
        {
            string src = (_settings?.UpdateSourceUrl ?? "").Trim();
            // 배너는 클릭 즉시 진행(스피너) 모드로 바뀌므로, 모든 조기 종료에서 __updateResult로 배너를 풀어준다.
            if (src.Length == 0) { UpdateResult(false, "업데이트 소스가 설정되지 않았습니다"); return; }
            if (_updBusy) return;   // 이미 적용 진행 중 — 그 작업이 배너를 마무리한다(중복 통지 금지)
            _updBusy = true;
            string dir = Path.Combine(Path.GetTempPath(), "TaskCalendarUpdate");
            string dest = "";
            try
            {
                UpdateProgress("업데이트 확인 중…");
                // 매니페스트 재확인 — 파일명/해시/버전 확보
                string json = await FetchTextAsync(CombineUrl(src, "latest.json"), 6000);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                string file = GetJsonStr(root, "file");
                string sha = GetJsonStr(root, "sha256");
                string mver = GetJsonStr(root, "version");

                // 다운그레이드 방지 — 배너 노출과 클릭 사이에 매니페스트가 롤백/구버전으로 바뀌었을 수 있다.
                var mv = ParseVer(mver);
                var own = OwnVersion();
                if (mv == null || own == null || !IsNewer(mv, own))
                {
                    UpdateResult(false, "이미 최신이거나 더 낮은 버전입니다");
                    return;
                }
                // 무결성 해시 필수 — 없으면 설치 중단(검증 불가 exe 실행 금지). 진짜 진위성은 아니지만 변조 최소 방어.
                if (string.IsNullOrWhiteSpace(sha))
                {
                    UpdateResult(false, "무결성 해시(sha256)가 없어 설치를 중단했습니다");
                    return;
                }
                if (string.IsNullOrWhiteSpace(file)) { UpdateResult(false, "업데이트 파일 정보가 없습니다"); return; }
                file = Path.GetFileName(file);   // 경로 조작 방지 — 파일명만 취함

                // 임시 폴더 정리(오래된 잔여 제거) 후 재생성
                try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
                Directory.CreateDirectory(dir);
                dest = Path.Combine(dir, file);

                UpdateProgress("내려받는 중…");
                await DownloadFileAsync(CombineUrl(src, file), dest, 300000);   // 설치기 다운로드는 넉넉히(5분)
                if (!File.Exists(dest) || new FileInfo(dest).Length == 0)
                {
                    UpdateResult(false, "내려받기 실패 — 다시 시도"); TryDelete(dest); return;
                }

                // 해시 검증(필수) — 대소문자 무시 hex 비교. sha는 위에서 이미 비어있지 않음을 보장.
                UpdateProgress("검증 중…");
                string got = await Task.Run(() => Sha256Hex(dest));
                string want = sha.Trim().Replace(" ", "").ToLowerInvariant();
                if (!string.Equals(got, want, StringComparison.OrdinalIgnoreCase))
                {
                    Log($"해시 불일치: got={got} want={want}");
                    UpdateResult(false, "검증 실패 — 다시 시도");
                    TryDelete(dest);
                    return;
                }
                Log("해시 검증 통과");

                // 설치기 실행(/SILENT). /UPDATED=1 로 무인 재시작 트리거(.iss [Run] Check:IsAutoUpdate).
                // 그다음 앱 종료 → exe 잠금 해제 → 설치기가 교체 후 새 앱을 재시작. data.xml(%APPDATA%)은 불변.
                UpdateProgress("설치 후 자동으로 재시작합니다…");
                Log($"설치기 실행(/SILENT /UPDATED=1): {dest} (v{mver})");
                Process.Start(new ProcessStartInfo(dest, "/SILENT /UPDATED=1") { UseShellExecute = true });
                await Task.Delay(700);   // 진행 메시지 전달 + 설치기 기동 여유
                Dispatcher.Invoke(() =>
                {
                    try { ExitApp(); }
                    catch { try { Application.Current.Shutdown(); } catch { } }
                });
            }
            catch (TimeoutException)
            {
                Log("업데이트 적용 시간 초과");
                UpdateResult(false, "시간 초과 — 다시 시도");
                TryDelete(dest);
            }
            catch (Exception ex)
            {
                Log("업데이트 적용 실패: " + ex.Message);
                UpdateResult(false, "업데이트 실패 — " + ex.Message);
                TryDelete(dest);
            }
            finally { _updBusy = false; }   // 성공/실패/시간초과 무엇이든 항상 해제 — 영구 잠금 방지
        }

        // ---------- 호스트→HTML 통지 ----------
        private void UpdateProgress(string msg) { Log("update: " + msg); JsCall("window.__updateProgress && window.__updateProgress(" + JsonSerializer.Serialize(msg) + ")"); }
        private void UpdateResult(bool ok, string msg) { Log("update result: " + ok + " / " + msg); JsCall("window.__updateResult && window.__updateResult(" + (ok ? "true" : "false") + "," + JsonSerializer.Serialize(msg) + ")"); }
        // 백그라운드 확인이 '새 버전 없음/접근 실패'로 끝났을 때 — 열려 있는 배너를 조용히 닫도록 HTML에 통지(진행 중이면 HTML 쪽에서 무시).
        private void UpdateNone() { JsCall("window.__updateNone && window.__updateNone()"); }

        // ---------- 네트워크/파일 헬퍼(스킴별 분기: ftp:// · http(s):// · UNC/로컬) ----------
        private enum SrcKind { Ftp, Http, File }

        private static SrcKind KindOf(string url)
        {
            if (url.StartsWith("ftp://", StringComparison.OrdinalIgnoreCase)) return SrcKind.Ftp;
            if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return SrcKind.Http;
            return SrcKind.File;   // UNC(\\서버\공유) · 로컬 경로 · file://
        }

        // 소스 폴더 URL + 자식파일명 결합(스킴 보존). 로컬/UNC는 Path.Combine, URL은 슬래시.
        private static string CombineUrl(string baseUrl, string child)
        {
            baseUrl = (baseUrl ?? "").Trim();
            if (KindOf(baseUrl) == SrcKind.File)
            {
                string b = baseUrl;
                if (b.StartsWith("file://", StringComparison.OrdinalIgnoreCase)) { try { b = new Uri(b).LocalPath; } catch { } }
                return Path.Combine(b, child);
            }
            return baseUrl.TrimEnd('/') + "/" + child;
        }

        // 작은 텍스트(latest.json) 받기 — 짧은 타임아웃. 모든 대기는 timeoutMs로 상한(UI 스레드 무동결).
        private static async Task<string> FetchTextAsync(string url, int timeoutMs)
        {
            switch (KindOf(url))
            {
                case SrcKind.Http:
                {
                    using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(timeoutMs) };
                    // HttpClient.Timeout 위에 한 겹 더(GetString은 본문까지 포함하지만 방어적 상한).
                    return await BoundAsync(http.GetStringAsync(url), timeoutMs);
                }
                case SrcKind.Ftp:
                {
                    // FtpWebRequest.Timeout/ReadWriteTimeout은 GetResponseAsync에서 안정적으로 지켜지지 않으므로
                    // 응답/읽기 대기를 명시적으로 상한하고, 초과 시 요청을 Abort.
                    var req = MakeFtp(url, timeoutMs);
                    try
                    {
                        using var resp = (FtpWebResponse)await BoundAsync(req.GetResponseAsync(), timeoutMs);
                        using var s = resp.GetResponseStream();
                        using var reader = new StreamReader(s, Encoding.UTF8);
                        return await BoundAsync(reader.ReadToEndAsync(), timeoutMs);
                    }
                    catch { try { req.Abort(); } catch { } throw; }
                }
                default:
                {
                    string path = url;
                    if (path.StartsWith("file://", StringComparison.OrdinalIgnoreCase)) { try { path = new Uri(path).LocalPath; } catch { } }
                    // 동기 파일 오픈(CreateFile)은 첫 await 전에 UI 스레드에서 실행되어, 죽은 UNC면
                    // OS SMB 타임아웃(20~30s)까지 막힌다(취소 토큰이 이 오픈을 못 끊음). 풀 스레드로 밀고 대기만 상한.
                    return await BoundAsync(Task.Run(() => File.ReadAllText(path, Encoding.UTF8)), timeoutMs);
                }
            }
        }

        // 바이너리(설치기) 받기 → destPath. 모든 대기는 timeoutMs로 상한(UI 스레드 무동결).
        private static async Task DownloadFileAsync(string url, string destPath, int timeoutMs)
        {
            switch (KindOf(url))
            {
                case SrcKind.Http:
                {
                    using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(timeoutMs) };
                    // GetStreamAsync 이후 본문 복사는 HttpClient.Timeout이 안 덮으므로 복사 대기를 명시적으로 상한.
                    using var s = await BoundAsync(http.GetStreamAsync(url), timeoutMs);
                    using var fs = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None);
                    await BoundAsync(s.CopyToAsync(fs), timeoutMs);
                    break;
                }
                case SrcKind.Ftp:
                {
                    var req = MakeFtp(url, timeoutMs);
                    try
                    {
                        using var resp = (FtpWebResponse)await BoundAsync(req.GetResponseAsync(), timeoutMs);
                        using var s = resp.GetResponseStream();
                        using var fs = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None);
                        await BoundAsync(s.CopyToAsync(fs), timeoutMs);
                    }
                    catch { try { req.Abort(); } catch { } throw; }
                    break;
                }
                default:
                {
                    string path = url;
                    if (path.StartsWith("file://", StringComparison.OrdinalIgnoreCase)) { try { path = new Uri(path).LocalPath; } catch { } }
                    // File.Copy는 동기·인라인이라 느린 공유에서 UI를 얼린다. 풀 스레드로 밀고 대기만 상한.
                    await BoundAsync(Task.Run(() => File.Copy(path, destPath, true)), timeoutMs);
                    break;
                }
            }
        }

        private static FtpWebRequest MakeFtp(string url, int timeoutMs)
        {
            var req = (FtpWebRequest)WebRequest.Create(url);
            req.Method = WebRequestMethods.Ftp.DownloadFile;
            req.UseBinary = true;
            req.UsePassive = true;      // 방화벽/NAT 뒤 폐쇄망 기본 — 수동 모드
            req.KeepAlive = false;
            req.Credentials = new NetworkCredential("anonymous", "anonymous@");   // 익명
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            return req;
        }

        // 대기를 timeoutMs로 상한한다. 초과하면 TimeoutException을 던지고, 남은 작업은 풀 스레드에서 계속
        // 진행하되(호출부에서 Abort/Dispose로 정리됨) 그 예외는 관찰해 UnobservedTaskException 노이즈를 막는다.
        // 근본 목적: 동기 오픈/SMB/half-open FTP가 UI 스레드를 timeoutMs 넘게 붙잡지 못하게 하는 것.
        private static async Task<T> BoundAsync<T>(Task<T> work, int timeoutMs)
        {
            if (await Task.WhenAny(work, Task.Delay(timeoutMs)).ConfigureAwait(false) != work)
            {
                _ = work.ContinueWith(t => { _ = t.Exception; }, TaskScheduler.Default);
                throw new TimeoutException();
            }
            return await work.ConfigureAwait(false);
        }

        private static async Task BoundAsync(Task work, int timeoutMs)
        {
            if (await Task.WhenAny(work, Task.Delay(timeoutMs)).ConfigureAwait(false) != work)
            {
                _ = work.ContinueWith(t => { _ = t.Exception; }, TaskScheduler.Default);
                throw new TimeoutException();
            }
            await work.ConfigureAwait(false);
        }

        // ---------- 버전/해시 유틸 ----------
        private static Version? OwnVersion()
        {
            try { return System.Reflection.Assembly.GetExecutingAssembly().GetName().Version; }
            catch { return null; }
        }

        // "0.8.1" → [0,8,1]. 누락 파트는 0. 완전 실패면 null.
        private static int[]? ParseVer(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            var parts = s.Trim().Split('.');
            var v = new int[3];
            for (int i = 0; i < 3 && i < parts.Length; i++) int.TryParse(parts[i], out v[i]);
            return v;
        }

        // 매니페스트 버전 m(Major.Minor.Build)이 내 버전 own보다 큰가(숫자 비교).
        private static bool IsNewer(int[] m, Version own)
        {
            int[] o = { own.Major, own.Minor, Math.Max(own.Build, 0) };
            for (int i = 0; i < 3; i++)
            {
                if (m[i] > o[i]) return true;
                if (m[i] < o[i]) return false;
            }
            return false;
        }

        private static string GetJsonStr(JsonElement root, string key) =>
            root.TryGetProperty(key, out var el) && el.ValueKind == JsonValueKind.String ? (el.GetString() ?? "") : "";

        private static string Sha256Hex(string path)
        {
            using var sha = System.Security.Cryptography.SHA256.Create();
            using var fs = File.OpenRead(path);
            var hash = sha.ComputeHash(fs);
            var sb = new StringBuilder(hash.Length * 2);
            foreach (var b in hash) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        private static void TryDelete(string path)
        {
            try { if (!string.IsNullOrEmpty(path) && File.Exists(path)) File.Delete(path); } catch { }
        }
    }
}
