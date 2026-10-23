using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

// FtpWebRequest 는 SYSLIB0014(obsolete) 경고가 나지만 인박스 대체가 없다. Update.cs 와 같은 이유로 이 파일 한정으로 끈다.
#pragma warning disable SYSLIB0014

namespace TaskCalendarWidget
{
    // ================================================================================
    //  사용 영상 안내: 호스트 쪽(docs/GUIDE-VIDEOS.md, 2026-10-23 사용자 결정)
    // ================================================================================
    //  영상은 Setup 에 없다. 운영자가 업데이트 폴더(UpdateSourceUrl, latest.json 과 Setup 이 있는 곳) 아래 guide\ 에
    //  guide.json, mp4, (선택) srt 를 올린다. 화면(목록, 재생, 장면 이동)은 앱 안에 있고 이 파일은 두 명령만 맡는다.
    //    guideManifest        → { ok:true, version, source:'file'|'net', videos:[{ id, file, title, chapters:[{ t, title }] }] }
    //                         | { ok:false, reason:'noSource'|'unreachable'|'missing'|'invalid'|'tooLarge'|'noVideos' }
    //    guideFetch { file }  → { ok:true, url, srt }   url = https://guide.tcapp.local/<판 폴더>/<file>, srt = 자막 원문(SRT, 없으면 "")
    //                         | { ok:false, reason:'badName'|'noGuide'|'unreachable'|'missing'|'download' }
    //    진행 알림(받는 중)     window.__guideProgress({ file, got, total })   total = -1 이면 크기를 모른다
    //  ★ 메인 창 전용이다. 열람 창(PeerWinCommands)과 관리 창(AdminWinCommands) 허용 목록에 넣지 않는다(그 창에는 "?" 메뉴가 없다).
    //  ★ DB 를 쓰지 않는다(§4). 이 파일에서 연결 문자열이나 DB 계층을 부르지 않는다(시험이 지킨다).
    //  ★ 재생은 늘 캐시에서 한다. 가상 호스트 guide.tcapp.local 은 %LOCALAPPDATA%\TaskCalendar\guide-cache 하나에
    //    첫 내비게이션 전에 한 번 잇고(GuideMapInit, 웹뷰 초기화에서 tcapp.local 바로 옆) 다시는 바꾸지 않는다.
    //    2026-10-23 실측: 문서가 뜬 뒤에 이은(또는 바꾼) 매핑은 그 문서의 요청에 적용되지 않는다(fetch 실패, video readyState 0, 다시 읽어야 됨).
    //    guideFetch 가 요청한 mp4 를 guide-cache\<판>\ 로 복사(로컬, UNC, file://)하거나 받는다(ftp, http). 같은 크기가 이미 있으면 건너뛴다.
    //    매핑이 바뀌지 않으므로 실행 중에 업데이트 폴더를 바꿔도 다시 읽을 필요가 없다.
    //  ★ 자막은 주소가 아니라 글로 돌려준다. 다른 출처(guide.tcapp.local)의 track 과 fetch 는 CORS 에 막히므로
    //    웹이 SRT 를 WebVTT 로 바꿔 blob 주소로 붙인다.
    public partial class MainWindow
    {
        internal const string GuideVirtualHost = "guide.tcapp.local";
        private const int GuideJsonMaxBytes = 256 * 1024;          // guide.json 상한(넘으면 tooLarge)
        private const int GuideSrtMaxBytes = 1024 * 1024;          // 자막 상한(넘으면 자막 없이 재생)
        private const int GuideReadTimeoutMs = 6000;               // guide.json 과 자막 읽기. 닿지 않는 공유 폴더가 부팅 뒤 화면을 붙잡지 않게
        private const int GuideVideoTimeoutMs = 15 * 60 * 1000;    // mp4 복사와 받기 전체 상한

        private GuideManifest? _guide;                // 마지막으로 읽은 정상 목록. guideFetch 는 이 목록에 있는 이름만 받는다
        private string _guideSrc = "";                // 그 목록을 읽은 업데이트 폴더 주소(바뀌면 다시 읽는다)
        private readonly Dictionary<string, Task<string>> _guideFetching = new(StringComparer.OrdinalIgnoreCase);   // 받는 중인 파일(같은 파일을 두 번 받지 않는다)

        //  OnWebMessage 의 case 두 줄이 부른다(UI 스레드). 회신은 ReplyOnUi.
        private async Task RunGuideAsync(string cmd, string reqId, string file)
        {
            object reply;
            try
            {
                reply = cmd == "guideFetch" ? await GuideFetchAsync(file) : await GuideManifestAsync();
            }
            catch (Exception ex)
            {
                Log("사용 영상 " + cmd + " 예외: " + ex.Message);
                reply = new { ok = false, reason = "unreachable" };
            }
            ReplyOnUi(reqId, reply);
        }

        // ── 폴더 정하기 ─────────────────────────────────────────────────────
        //  업데이트 폴더 주소 + "guide". 업데이트 코드(Update.cs 의 KindOf, CombineUrl)와 같은 다섯 형식을 받는다.
        //    로컬 경로, UNC(\\서버\공유), file://  → 파일 공유(가상 호스트를 그 폴더에 바로 잇는다)
        //    ftp://, http(s)://                    → 네트워크(받아서 캐시에 둔다)
        internal static string GuideFolderOf(string src) => CombineUrl(src, "guide");

        private async Task<object> GuideManifestAsync()
        {
            string src = (_settings?.UpdateSourceUrl ?? "").Trim();
            if (src.Length == 0) { _guide = null; return new { ok = false, reason = "noSource" }; }
            string folder = GuideFolderOf(src);
            var kind = KindOf(src);

            byte[] bytes;
            try
            {
                if (kind == SrcKind.File)
                {
                    //  업데이트 폴더 자체가 없으면 닿지 않는 것(unreachable), 폴더는 있는데 guide.json 이 없으면 아직 안 올린 것(missing).
                    //  ★ 닿지 않는 UNC 는 Exists 가 오래 걸릴 수 있어 풀 스레드에서 시간 제한을 둔다.
                    string root = SafeLocalPath(src);
                    bool rootOk = await BoundAsync(Task.Run(() => Directory.Exists(root)), GuideReadTimeoutMs);
                    if (!rootOk) { Log("사용 영상: 업데이트 폴더에 닿지 않는다"); _guide = null; return new { ok = false, reason = "unreachable" }; }
                }
                bytes = await GuideReadAsync(kind, folder, "guide.json", GuideJsonMaxBytes);
            }
            catch (GuideTooLargeException) { _guide = null; return new { ok = false, reason = "tooLarge" }; }
            catch (Exception ex) when (IsNotFound(ex)) { _guide = null; return new { ok = false, reason = "missing" }; }
            catch (Exception ex)
            {
                Log("사용 영상: guide.json 을 읽지 못했다(" + ex.GetType().Name + ")");
                _guide = null;
                return new { ok = false, reason = "unreachable" };
            }

            var m = GuideRules.Parse(bytes, out string why);
            if (m == null) { Log("사용 영상: guide.json 거절(" + why + ")"); _guide = null; return new { ok = false, reason = why }; }
            m.Net = kind != SrcKind.File;
            m.Folder = folder;
            _guide = m;
            _guideSrc = src;
            Log("사용 영상: 판 " + m.Version + ", 영상 " + m.Videos.Count + "편(" + (m.Net ? "네트워크" : "파일 공유") + ")");
            return new
            {
                ok = true,
                version = m.Version,
                source = m.Net ? "net" : "file",
                videos = m.Videos.Select(v => new
                {
                    id = v.Id, file = v.File, title = v.Title,
                    chapters = v.Chapters.Select(c => new { t = c.T, title = c.Title }).ToArray(),
                }).ToArray(),
            };
        }

        private async Task<object> GuideFetchAsync(string file)
        {
            file = file ?? "";
            string src = (_settings?.UpdateSourceUrl ?? "").Trim();
            if (_guide == null || !string.Equals(_guideSrc, src, StringComparison.Ordinal)) await GuideManifestAsync();
            var g = _guide;
            if (g == null) return new { ok = false, reason = "noGuide" };
            //  ★ 이름은 목록에 있는 것만, 그리고 규칙(구분자 없음, .. 없음, .mp4)을 다시 본다. 웹을 믿지 않는다.
            if (!GuideRules.NameOk(file) || !file.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase) ||
                !g.Videos.Any(v => string.Equals(v.File, file, StringComparison.Ordinal)))
            {
                Log("사용 영상: 목록에 없는 이름 거절");
                return new { ok = false, reason = "badName" };
            }
            string srtName = GuideRules.SrtNameOf(file);
            string verDir = GuideRules.SafeDirName(g.Version);
            string url = "https://" + GuideVirtualHost + "/" + Uri.EscapeDataString(verDir) + "/" + Uri.EscapeDataString(file);

            //  파일 공유는 복사, 네트워크는 받기. 어느 쪽이든 이 판의 캐시 폴더에 둔다(가상 호스트는 캐시 루트에 이미 이어져 있다).
            string dir;
            try { dir = GuideCacheDir(g.Version); }
            catch (Exception ex) { Log("사용 영상: 캐시 폴더를 만들지 못했다: " + ex.Message); return new { ok = false, reason = "download" }; }
            var kind = g.Net ? KindOf(src) : SrcKind.File;
            string key = g.Version + "|" + file;
            try
            {
                if (!_guideFetching.TryGetValue(key, out var job))
                {
                    job = GuideDownloadAsync(kind, g.Folder, file, dir);
                    _guideFetching[key] = job;
                }
                try { await job; }
                finally { _guideFetching.Remove(key); }
            }
            catch (Exception ex) when (IsNotFound(ex)) { Log("사용 영상: 영상 파일이 없다: " + file); return new { ok = false, reason = "missing" }; }
            catch (Exception ex)
            {
                Log("사용 영상: 받기 실패(" + file + "): " + ex.GetType().Name + " " + ex.Message);
                return new { ok = false, reason = "download" };
            }
            string srtText = await GuideSrtTextAsync(kind, g.Folder, srtName);
            return new { ok = true, url, srt = srtText };
        }

        // ── 가상 호스트 ─────────────────────────────────────────────────────
        //  웹뷰 초기화에서 한 번, 첫 Navigate 전에 부른다(MainWindow.xaml.cs, tcapp.local 매핑 바로 다음).
        //  ★ 이 뒤로 guide.tcapp.local 매핑을 바꾸거나 지우지 않는다. 문서가 뜬 뒤의 매핑 변경은 그 문서에 적용되지 않는다.
        //  실패해도 앱은 뜬다(보기 창이 영상을 읽지 못할 뿐이다). 로그만 남긴다.
        private void GuideMapInit(CoreWebView2 core)
        {
            try
            {
                Directory.CreateDirectory(GuideCacheRoot);
                core.SetVirtualHostNameToFolderMapping(GuideVirtualHost, GuideCacheRoot, CoreWebView2HostResourceAccessKind.Allow);
            }
            catch (Exception ex) { Log("사용 영상: 가상 호스트를 잇지 못했다: " + ex.Message); }
        }

        // ── 캐시(%LOCALAPPDATA%\TaskCalendar\guide-cache\<판>\) ─────────────
        private static string GuideCacheRoot =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TaskCalendar", "guide-cache");

        //  이 판의 폴더를 만들고, 다른 판의 폴더는 지운다(재생 중이라 잠겨 있으면 다음 기회에).
        private string GuideCacheDir(string version)
        {
            string root = GuideCacheRoot;
            string dir = Path.Combine(root, GuideRules.SafeDirName(version));
            Directory.CreateDirectory(dir);
            foreach (var old in Directory.GetDirectories(root))
            {
                string full = Path.GetFullPath(old);
                if (string.Equals(full, Path.GetFullPath(dir), StringComparison.OrdinalIgnoreCase)) continue;
                try { Directory.Delete(old, true); Log("사용 영상: 지난 판 캐시를 지웠다: " + Path.GetFileName(old)); }
                catch { }
            }
            return dir;
        }

        //  mp4 하나를 캐시로(파일 공유는 복사, ftp 와 http 는 받기). 이미 있고 크기가 원본과 같으면(또는 원본 크기를 모르면) 그대로 쓴다.
        //  받는 동안 .part 에 쓰고 끝나면 이름을 바꾼다(중간에 꺼져도 반쪽 파일을 재생하지 않게).
        private async Task<string> GuideDownloadAsync(SrcKind kind, string folder, string file, string dir)
        {
            string dest = Path.Combine(dir, file);
            string from = CombineUrl(folder, file);
            long remote = await GuideRemoteSizeAsync(kind, from).ConfigureAwait(false);
            if (File.Exists(dest))
            {
                long have = new FileInfo(dest).Length;
                if (have > 0 && (remote < 0 || remote == have)) return dest;
            }
            string part = dest + ".part";
            TryDelete(part);
            long last = 0;
            void Report(long got, long total)
            {
                long now = Environment.TickCount64;
                if (got < total && now - last < 300) return;   // 0.3초에 한 번(끝은 늘 알린다)
                last = now;
                string js = "window.__guideProgress && window.__guideProgress(" +
                            JsonSerializer.Serialize(new { file, got, total }) + ")";
                JsCall(js);
            }
            try
            {
                await BoundAsync(GuideCopyAsync(kind, from, part, remote, Report), GuideVideoTimeoutMs).ConfigureAwait(false);
                if (!File.Exists(part) || new FileInfo(part).Length == 0) throw new IOException("빈 파일");
                File.Move(part, dest, true);
                Log("사용 영상: 받았다: " + file + " (" + new FileInfo(dest).Length + " 바이트)");
                return dest;
            }
            catch { TryDelete(part); throw; }
        }

        private static async Task GuideCopyAsync(SrcKind kind, string url, string dest, long total, Action<long, long> report)
        {
            switch (kind)
            {
                case SrcKind.Http:
                {
                    using var http = new HttpClient { Timeout = System.Threading.Timeout.InfiniteTimeSpan };   // 전체 상한은 BoundAsync 가 둔다
                    using var resp = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
                    resp.EnsureSuccessStatusCode();
                    long len = resp.Content.Headers.ContentLength ?? total;
                    using var s = await resp.Content.ReadAsStreamAsync().ConfigureAwait(false);
                    await GuidePumpAsync(s, dest, len, report).ConfigureAwait(false);
                    break;
                }
                case SrcKind.Ftp:
                {
                    var req = MakeFtp(url, 60000);
                    try
                    {
                        using var resp = (FtpWebResponse)await req.GetResponseAsync().ConfigureAwait(false);
                        using var s = resp.GetResponseStream();
                        await GuidePumpAsync(s, dest, total, report).ConfigureAwait(false);
                    }
                    catch { try { req.Abort(); } catch { } throw; }
                    break;
                }
                default:
                {
                    string path = SafeLocalPath(url);
                    using var s = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
                    await GuidePumpAsync(s, dest, s.Length, report).ConfigureAwait(false);
                    break;
                }
            }
        }

        private static async Task GuidePumpAsync(Stream s, string dest, long total, Action<long, long> report)
        {
            using var fs = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true);
            var buf = new byte[81920];
            long got = 0;
            report(0, total);
            int n;
            while ((n = await s.ReadAsync(buf.AsMemory(0, buf.Length)).ConfigureAwait(false)) > 0)
            {
                await fs.WriteAsync(buf.AsMemory(0, n)).ConfigureAwait(false);
                got += n;
                report(got, total);
            }
            report(got, got);
        }

        //  원본 크기(바이트). 모르거나 실패하면 -1(캐시가 있으면 그것을 쓴다).
        private static async Task<long> GuideRemoteSizeAsync(SrcKind kind, string url)
        {
            try
            {
                switch (kind)
                {
                    case SrcKind.Http:
                    {
                        using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(GuideReadTimeoutMs) };
                        using var req = new HttpRequestMessage(HttpMethod.Head, url);
                        using var resp = await http.SendAsync(req).ConfigureAwait(false);
                        return resp.IsSuccessStatusCode ? (resp.Content.Headers.ContentLength ?? -1) : -1;
                    }
                    case SrcKind.Ftp:
                    {
                        var req = MakeFtp(url, GuideReadTimeoutMs);
                        req.Method = WebRequestMethods.Ftp.GetFileSize;
                        try
                        {
                            using var resp = (FtpWebResponse)await BoundAsync(req.GetResponseAsync(), GuideReadTimeoutMs).ConfigureAwait(false);
                            return resp.ContentLength;
                        }
                        catch { try { req.Abort(); } catch { } throw; }
                    }
                    default:
                    {
                        string path = SafeLocalPath(url);
                        return await BoundAsync(Task.Run(() => File.Exists(path) ? new FileInfo(path).Length : -1L), GuideReadTimeoutMs).ConfigureAwait(false);
                    }
                }
            }
            catch { return -1; }
        }

        // ── 작은 파일 읽기(guide.json, srt) ─────────────────────────────────
        //  상한을 넘으면 GuideTooLargeException. 없으면 FileNotFoundException(또는 FTP 550, HTTP 404, IsNotFound 가 가른다).
        private static async Task<byte[]> GuideReadAsync(SrcKind kind, string folder, string name, int max)
        {
            string url = CombineUrl(folder, name);
            switch (kind)
            {
                case SrcKind.Http:
                {
                    using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(GuideReadTimeoutMs) };
                    using var resp = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
                    if (resp.StatusCode == HttpStatusCode.NotFound) throw new FileNotFoundException(name);
                    resp.EnsureSuccessStatusCode();
                    if (resp.Content.Headers.ContentLength > max) throw new GuideTooLargeException();
                    using var s = await resp.Content.ReadAsStreamAsync().ConfigureAwait(false);
                    return await BoundAsync(ReadCappedAsync(s, max), GuideReadTimeoutMs).ConfigureAwait(false);
                }
                case SrcKind.Ftp:
                {
                    var req = MakeFtp(url, GuideReadTimeoutMs);
                    try
                    {
                        using var resp = (FtpWebResponse)await BoundAsync(req.GetResponseAsync(), GuideReadTimeoutMs).ConfigureAwait(false);
                        using var s = resp.GetResponseStream();
                        return await BoundAsync(ReadCappedAsync(s, max), GuideReadTimeoutMs).ConfigureAwait(false);
                    }
                    catch { try { req.Abort(); } catch { } throw; }
                }
                default:
                {
                    string path = SafeLocalPath(url);
                    return await BoundAsync(Task.Run(() =>
                    {
                        var fi = new FileInfo(path);
                        if (!fi.Exists) throw new FileNotFoundException(name);
                        if (fi.Length > max) throw new GuideTooLargeException();
                        return File.ReadAllBytes(path);
                    }), GuideReadTimeoutMs).ConfigureAwait(false);
                }
            }
        }

        private static async Task<byte[]> ReadCappedAsync(Stream s, int max)
        {
            using var ms = new MemoryStream();
            var buf = new byte[16384];
            int n;
            while ((n = await s.ReadAsync(buf.AsMemory(0, buf.Length)).ConfigureAwait(false)) > 0)
            {
                if (ms.Length + n > max) throw new GuideTooLargeException();
                ms.Write(buf, 0, n);
            }
            return ms.ToArray();
        }

        //  자막 원문. 없거나 크거나 읽지 못하면 "" (자막 없이 재생한다, 실패로 보지 않는다).
        private async Task<string> GuideSrtTextAsync(SrcKind kind, string folder, string srtName)
        {
            if (!GuideRules.NameOk(srtName)) return "";
            try
            {
                var b = await GuideReadAsync(kind, folder, srtName, GuideSrtMaxBytes);
                return GuideRules.Utf8(b);
            }
            catch (Exception ex) when (IsNotFound(ex)) { return ""; }
            catch (Exception ex) { Log("사용 영상: 자막을 읽지 못했다(" + srtName + "): " + ex.GetType().Name); return ""; }
        }

        private static string SafeLocalPath(string p)
        {
            if (p.StartsWith("file://", StringComparison.OrdinalIgnoreCase)) { try { return new Uri(p).LocalPath; } catch { } }
            return p;
        }
    }

    internal sealed class GuideTooLargeException : Exception { }

    internal sealed class GuideChapter
    {
        public double T;
        public string Title = "";
    }

    internal sealed class GuideVideo
    {
        public string Id = "";
        public string File = "";
        public string Title = "";
        public List<GuideChapter> Chapters = new();
    }

    internal sealed class GuideManifest
    {
        public string Version = "";
        public List<GuideVideo> Videos = new();
        public bool Net;            // ftp, http(s) 면 true(캐시로 받는다)
        public string Folder = "";  // guide 폴더 주소(경로 또는 URL)
    }

    // ================================================================================
    //  guide.json 검사와 이름 규칙(순수 함수). 웹의 gvNameOk 와 같은 규칙이다(시험이 둘을 함께 본다).
    // ================================================================================
    internal static class GuideRules
    {
        private static readonly char[] Bad = { '/', '\\', ':', '*', '?', '"', '<', '>', '|' };

        //  파일 이름 하나: 비어 있지 않고 128자 이하, 경로 구분자와 ".." 없음, 점으로 시작하지 않음, 제어 문자 없음, .mp4 나 .srt.
        public static bool NameOk(string? name)
        {
            if (string.IsNullOrEmpty(name) || name.Length > 128) return false;
            if (name.IndexOfAny(Bad) >= 0 || name.Contains("..") || name.StartsWith('.') || name.Trim() != name) return false;
            if (name.Any(char.IsControl)) return false;
            return name.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".srt", StringComparison.OrdinalIgnoreCase);
        }

        //  overview.mp4 → overview.srt (같은 이름의 자막)
        public static string SrtNameOf(string mp4) => mp4.Substring(0, mp4.Length - 4) + ".srt";

        //  판 번호 → 캐시 폴더 이름(파일 이름에 못 쓰는 글자는 _, 40자까지).
        public static string SafeDirName(string version)
        {
            var bad = Path.GetInvalidFileNameChars();
            var sb = new StringBuilder();
            foreach (char c in version) sb.Append(bad.Contains(c) || (c == '.' && sb.Length == 0) ? '_' : c);
            string s = sb.ToString();
            if (s.Length > 40) s = s.Substring(0, 40);
            s = s.Trim().TrimEnd('.', ' ');   // Windows 는 폴더 이름 끝의 점과 공백을 지운다(지우고 나면 이름이 달라져 지난 판 정리가 이 판을 지운다)
            return s.Length == 0 ? "_" : s;
        }

        public static string Utf8(byte[] b)
        {
            int skip = b.Length >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF ? 3 : 0;
            return Encoding.UTF8.GetString(b, skip, b.Length - skip);
        }

        public const int MaxVideos = 60;     // 영상 줄 상한(넘는 줄은 버린다)
        public const int MaxChapters = 60;   // 영상 하나의 장면 상한

        //  guide.json 을 읽는다. 모르는 칸은 무시하고, 규칙에 맞지 않는 영상 줄과 장면은 버린다(나머지는 쓴다).
        //  거절(null)은 셋뿐이다: JSON 이 아니다(invalid), 판 번호가 없다(invalid), 쓸 영상이 하나도 없다(noVideos).
        public static GuideManifest? Parse(byte[] bytes, out string reason)
        {
            reason = "invalid";
            JsonDocument doc;
            try
            {
                doc = JsonDocument.Parse(Utf8(bytes), new JsonDocumentOptions
                { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip, MaxDepth = 16 });
            }
            catch { return null; }
            using (doc)
            {
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object) return null;
                string version = root.TryGetProperty("version", out var ve) ? ScalarText(ve) : "";
                if (version.Length == 0 || version.Length > 64) return null;
                var m = new GuideManifest { Version = version };
                if (!root.TryGetProperty("videos", out var vs) || vs.ValueKind != JsonValueKind.Array) { reason = "noVideos"; return null; }
                var ids = new HashSet<string>(StringComparer.Ordinal);
                var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var v in vs.EnumerateArray())
                {
                    if (m.Videos.Count >= MaxVideos) break;
                    if (v.ValueKind != JsonValueKind.Object) continue;
                    string id = Str(v, "id"), file = Str(v, "file"), title = Str(v, "title");
                    if (id.Length == 0 || id.Length > 64 || title.Length == 0 || title.Length > 200) continue;
                    if (!NameOk(file) || !file.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase)) continue;
                    if (!ids.Add(id) || !files.Add(file)) continue;
                    var gv = new GuideVideo { Id = id, File = file, Title = title };
                    if (v.TryGetProperty("chapters", out var cs) && cs.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var c in cs.EnumerateArray())
                        {
                            if (gv.Chapters.Count >= MaxChapters) break;
                            if (c.ValueKind != JsonValueKind.Object) continue;
                            if (!c.TryGetProperty("t", out var te) || te.ValueKind != JsonValueKind.Number || !te.TryGetDouble(out double t)) continue;
                            if (double.IsNaN(t) || double.IsInfinity(t) || t < 0 || t > 86400) continue;
                            string ct = Str(c, "title");
                            if (ct.Length == 0 || ct.Length > 200) continue;
                            gv.Chapters.Add(new GuideChapter { T = t, Title = ct });
                        }
                        gv.Chapters.Sort((a, b) => a.T.CompareTo(b.T));
                    }
                    m.Videos.Add(gv);
                }
                if (m.Videos.Count == 0) { reason = "noVideos"; return null; }
                reason = "";
                return m;
            }
        }

        private static string Str(JsonElement o, string key) =>
            o.TryGetProperty(key, out var e) && e.ValueKind == JsonValueKind.String ? (e.GetString() ?? "").Trim() : "";

        //  판 번호는 글이든 숫자든 받는다(같은가만 본다, §2).
        private static string ScalarText(JsonElement e) => e.ValueKind switch
        {
            JsonValueKind.String => (e.GetString() ?? "").Trim(),
            JsonValueKind.Number => e.GetRawText(),
            _ => "",
        };
    }
}
