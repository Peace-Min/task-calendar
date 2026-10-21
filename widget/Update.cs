using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;

// FtpWebRequest는 .NET에서 obsolete 경고(SYSLIB0014)지만 인박스 대체가 없고 폐쇄망 오프라인
// 셀프컨테인드 빌드가 추가 NuGet 없이 FTP를 써야 하므로 이 파일 한정으로 경고를 끈다.
#pragma warning disable SYSLIB0014

namespace TaskCalendarWidget
{
    // DB 기반 업데이트(docs/VERSION-GATE.md §2.6, DB-RELEASE-OPS §3.3). 배포 정보는 DB 의 cal_schema_meta
    // app_ 세 키(app_latest_version, app_installer_file, app_installer_sha256)이고, 파일만 공유폴더(UpdateSourceUrl)에서 받는다.
    // 2026-10-21 까지는 공유폴더의 매니페스트 파일이 그 역할을 했다. 이제 그 파일은 만들지도 읽지도 않는다.
    // 각 위젯이 시작 후 + 주기적으로 조용히 확인 → 새 버전이면 상단 배너(정상) 또는 차단 화면의 버튼(막힘)
    // → '지금 업데이트' 시 내려받기·검증·설치·재시작. 확인 실패는 무음(Log만). URL 비면 완전 휴면.
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
                // 이후 30분마다 무음 확인. 새 버전 발견뿐 아니라 '서버 오프 → 열린 배너 자동 종료'도 이 주기로 반영.
                // ★ 이것이 정상 상태에서 허용된 **유일한 주기 DB 읽기**다("정상일 때 주기 DB 접속 없음" A11 의 예외,
                //   VERSION-GATE §2.5). PC 하나가 30분에 키 다섯 개를 한 번 읽는다. 다른 주기 DB 접속을 더하지 말 것.
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
            if (src.Length == 0) return;   // 휴면. 받을 폴더를 모르면 새 버전을 알려도 받을 수 없다
            if (_updBusy) return;          // 적용 진행 중이면 확인 생략
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                var (mver, _, _) = await DbGate.ReadReleaseAsync(CalendarDb.BuildConnString(), cts.Token);
                var own = OwnVersion();
                if (mver.Length == 0)   // app_latest_version 이 빈 값 = 배포 중인 새 버전 없음(정본 시드의 기본)
                {
                    Log("업데이트 없음: 배포 중인 새 버전이 없다(app_latest_version 빈 값)");
                    if (userInitiated) UpdateResult(true, "이미 최신 버전입니다" + (own == null ? "" : " (v" + own.ToString(3) + ")"));
                    else UpdateNone();
                    return;
                }
                var m = ParseVer(mver);
                if (m == null || own == null)
                {
                    if (userInitiated) UpdateResult(false, "업데이트 확인 실패. 버전 정보를 읽지 못했습니다");
                    else UpdateNone();   // 백그라운드: 버전 값 이상 → 열린 배너 닫기
                    return;
                }
                if (IsNewer(m, own))
                {
                    Log($"업데이트 발견: {mver} > 내 {own.ToString(3)}");
                    // __updateAvailable(infoJson) — HTML이 JSON.parse하므로 문자열로 전달(이중 직렬화).
                    // notes 는 DB 에 두지 않는다(DB-RELEASE-OPS §2). 바뀐 내용은 업데이트 뒤 패치노트 창에서 본다.
                    string info = JsonSerializer.Serialize(new { version = mver, notes = "" });
                    JsCall("window.__updateAvailable && window.__updateAvailable(" + JsonSerializer.Serialize(info) + ")");
                    // 설정 '지금 확인'이면 #updSrcMsg 스피너가 배너만으로는 안 풀리므로 결과도 함께 통지.
                    if (userInitiated) UpdateResult(true, "새 버전이 있습니다. 배너에서 업데이트하세요");
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
                Log("업데이트 확인 실패(무음): " + DbErrors.Sanitize(ex.Message));
                if (userInitiated) UpdateResult(false, "업데이트 확인 실패. 서버에 접근할 수 없습니다");
                else UpdateNone();   // 백그라운드: 서버 접근 실패 → 열린 배너 닫기
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
                // 배포 정보 재확인: 파일명/해시/버전 확보. 차단 화면(업데이트 필요)의 버튼도 이 길로 온다.
                // ★ ReadReleaseAsync 는 관문 판정을 하지 않는다. 막힌 상태에서도 읽혀야 이 버튼이 동작한다.
                string mver, file, sha;
                using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8)))
                    (mver, file, sha) = await DbGate.ReadReleaseAsync(CalendarDb.BuildConnString(), cts.Token);

                // 다운그레이드 방지: 배너 노출과 클릭 사이에 배포 정보가 롤백/구버전으로 바뀌었을 수 있다.
                // 받을 새 버전이 없으면(운영 실수: app_ 값 누락) 별도 상태 없이 같은 문구로 알린다(2026-10-21 결정).
                var mv = ParseVer(mver);
                var own = OwnVersion();
                if (mver.Length == 0 || mv == null || own == null || !IsNewer(mv, own))
                {
                    Log("업데이트 적용 중단: 받을 새 버전이 없다(app_latest_version=" + (mver.Length == 0 ? "빈 값" : mver) + ")");
                    UpdateResult(false, InstallerNotFoundMsg);
                    return;
                }
                // 무결성 해시 필수 — 없으면 설치 중단(검증 불가 exe 실행 금지). 진짜 진위성은 아니지만 변조 최소 방어.
                if (string.IsNullOrWhiteSpace(sha))
                {
                    UpdateResult(false, "무결성 해시(sha256)가 없어 설치를 중단했습니다");
                    return;
                }
                if (string.IsNullOrWhiteSpace(file)) { UpdateResult(false, InstallerNotFoundMsg); return; }
                file = Path.GetFileName(file);   // 경로 조작 방지 — 파일명만 취함

                // 임시 폴더 정리(오래된 잔여 제거) 후 재생성
                try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
                Directory.CreateDirectory(dir);
                dest = Path.Combine(dir, file);

                UpdateProgress("내려받는 중…");
                try { await DownloadFileAsync(CombineUrl(src, file), dest, 300000); }   // 설치기 다운로드는 넉넉히(5분)
                catch (Exception dx) when (IsNotFound(dx))
                {
                    // Setup 미업로드(운영 실수). 재시도 루프 없이 문구만. 수동 설치 경로는 차단 화면이 보여 준다.
                    Log("설치 파일 없음: " + CombineUrl(src, file) + " (" + dx.Message + ")");
                    UpdateResult(false, InstallerNotFoundMsg);
                    TryDelete(dest);
                    return;
                }
                if (!File.Exists(dest) || new FileInfo(dest).Length == 0)
                {
                    UpdateResult(false, "내려받기 실패. 다시 시도하세요"); TryDelete(dest); return;
                }

                // 해시 검증(필수) — 대소문자 무시 hex 비교. sha는 위에서 이미 비어있지 않음을 보장.
                UpdateProgress("검증 중…");
                string got = await Task.Run(() => Sha256Hex(dest));
                string want = sha.Trim().Replace(" ", "").ToLowerInvariant();
                if (!string.Equals(got, want, StringComparison.OrdinalIgnoreCase))
                {
                    Log($"해시 불일치: got={got} want={want}");
                    UpdateResult(false, "검증 실패. 다시 시도하세요");
                    TryDelete(dest);
                    return;
                }
                Log("해시 검증 통과");

                // 설치기 실행(/SILENT). /UPDATED=1 로 무인 재시작 트리거(.iss [Run] Check:IsAutoUpdate).
                // 그다음 앱 종료 → exe 잠금 해제 → 설치기가 교체 후 새 앱을 재시작.
                // 사용자 데이터는 이 교체와 무관하다(2026-09-07 갱신 — 옛 근거는 "data.xml(%APPDATA%)은 불변"
                // 이었으나 그 파일은 2026-09-01 에 데이터 출처에서 폐기됐다): 일정·과제는 MySQL 에 있고
                // 설치기는 프로그램 파일만 교체하므로, 갱신 도중 꺼져도 DB 쪽에 남는 흔적이 없다.
                UpdateProgress("설치 후 자동으로 재시작합니다…");
                // 설치 시도 기록: Setup 을 띄우기 **직전**에 쓴다. 다음 실행에서 버전이 그대로면 설치 실패로 본다.
                WriteUpdateAttempt(mver, file);
                Log($"설치기 실행(/SILENT /UPDATED=1): {dest} (v{mver})");
                Process.Start(new ProcessStartInfo(dest, "/SILENT /UPDATED=1") { UseShellExecute = true });
                await Task.Delay(700);   // 진행 메시지 전달 + 설치기 기동 여유
                Dispatcher.Invoke(() =>
                {
                    try { MarkSystemExit("업데이트 설치"); ExitApp(); }   // 설치기가 이미 돌고 있다 — 닫기 경고로 막지 않는다
                    catch { try { Application.Current.Shutdown(); } catch { } }
                });
            }
            catch (TimeoutException)
            {
                Log("업데이트 적용 시간 초과");
                UpdateResult(false, "시간 초과. 다시 시도하세요");
                TryDelete(dest);
            }
            catch (Exception ex)
            {
                Log("업데이트 적용 실패: " + ex.Message);
                UpdateResult(false, "업데이트 실패: " + ex.Message);
                TryDelete(dest);
            }
            finally { _updBusy = false; }   // 성공/실패/시간초과 무엇이든 항상 해제 — 영구 잠금 방지
        }

        // 받을 새 버전이 없거나 설치 파일을 찾지 못했을 때의 문구(VERSION-GATE §2.6). 차단 화면의 버튼 아래에 뜬다.
        private const string InstallerNotFoundMsg = "새 버전 파일을 찾을 수 없습니다. 관리자에게 문의해 주세요.";

        // 파일이 없다는 뜻의 실패만 고른다(UNC/로컬 파일 없음, FTP 550, HTTP 404). 연결 실패나 시간 초과는 아니다.
        private static bool IsNotFound(Exception ex)
        {
            for (var e = ex; e != null; e = e.InnerException)
            {
                if (e is FileNotFoundException || e is DirectoryNotFoundException) return true;
                if (e is WebException we && we.Response is FtpWebResponse fr &&
                    fr.StatusCode == FtpStatusCode.ActionNotTakenFileUnavailable) return true;
                if (e is HttpRequestException he && he.StatusCode == HttpStatusCode.NotFound) return true;
            }
            return false;
        }

        // ---------- 설치 시도 기록(%LOCALAPPDATA%\TaskCalendar\update-attempt.json) ----------
        //  { target, at, count, file }. Setup 을 띄우기 직전에 쓰고, 다음 실행(웹 ready)에서 본다.
        //    자기 버전 >= target  → 설치 성공. 기록을 지운다.
        //    자기 버전 <  target  → 설치 실패. 'installFailed' 를 한 번 밀고 기록(count)은 남긴다.
        //  같은 target 으로 다시 시도하면 count 가 오른다. count >= 2 면 웹은 자동 재시도 대신 수동 설치 안내만 보인다.
        private static string UpdateAttemptPath =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TaskCalendar", "update-attempt.json");

        private sealed class UpdateAttempt
        {
            public string target { get; set; } = "";
            public string at { get; set; } = "";
            public int count { get; set; }
            public string file { get; set; } = "";
        }

        private static UpdateAttempt? ReadUpdateAttempt()
        {
            try
            {
                string p = UpdateAttemptPath;
                if (!File.Exists(p)) return null;
                return JsonSerializer.Deserialize<UpdateAttempt>(File.ReadAllText(p, Encoding.UTF8));
            }
            catch { return null; }   // 깨진 기록은 없는 것으로 본다(다음 시도가 새로 쓴다)
        }

        private void WriteUpdateAttempt(string target, string file)
        {
            try
            {
                var prev = ReadUpdateAttempt();
                int count = prev != null && prev.target == target ? prev.count + 1 : 1;
                var rec = new UpdateAttempt { target = target, at = DateTime.UtcNow.ToString("o"), count = count, file = file };
                string p = UpdateAttemptPath;
                Directory.CreateDirectory(Path.GetDirectoryName(p)!);
                File.WriteAllText(p, JsonSerializer.Serialize(rec), new UTF8Encoding(false));
                Log("설치 시도 기록: v" + target + " (" + count + "번째)");
            }
            catch (Exception ex) { Log("설치 시도 기록 실패(설치는 계속한다): " + ex.Message); }
        }

        //  웹 ready 때 한 번(GateHost.GateOnReady). 실패면 GateHost 의 설치 실패 필드를 채운다(푸시는 부른 쪽이 한다).
        private void CheckUpdateAttempt()
        {
            var a = ReadUpdateAttempt();
            if (a == null) return;
            var own = OwnVersion();
            var t = ParseVer(a.target);
            if (own == null || t == null || a.target.Trim().Length == 0)
            {
                TryDelete(UpdateAttemptPath);
                return;
            }
            if (!IsNewer(t, own))
            {
                Log("설치 확인: v" + own.ToString(3) + " 이 목표 v" + a.target + " 이상이다. 설치 시도 기록을 지운다");
                TryDelete(UpdateAttemptPath);
                return;
            }
            _installFailedTarget = a.target;
            _installFailedCount = Math.Max(1, a.count);
            _installFailedFile = a.file ?? "";
            Log("설치 실패로 본다: 목표 v" + a.target + ", 지금 v" + own.ToString(3) + " (" + _installFailedCount + "번째 시도 뒤)");
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
