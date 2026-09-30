using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace TaskCalendarWidget
{
    // 이전 버전 기록 감지 (2026-09-30 사용자 결정 · 설계 §3b 부기)
    //   빈 캘린더인데 이 PC 의 데이터 폴더에 옛 버전(XML 저장)의 기록 파일이 남아 있으면,
    //   웹이 「가져올까요?」 를 **한 번 묻는다**. 여기 두 명령은 그 물음의 재료만 준다:
    //     · legacyXmlProbe — 데이터 폴더 **최상위**의 *.xml 중 가장 최근 것의 **이름·크기·시각만**.
    //                         ★ 내용은 읽지 않는다. 묻기 전에 읽으면 그것이 자동이관의 첫걸음이다.
    //     · readLegacyXml  — 사용자가 「가져오기」를 **누른 뒤에만** 온다. 회신은 PickImportXml 과 같다
    //                         { ok, name, text } — 웹은 그것을 미리보기(병합/교체)로만 넘긴다.
    //   ★ 적용·저장은 여기서도 웹에서도 저절로 일어나지 않는다. 사용자가 미리보기에서 병합/교체를 고른다.
    //   ★ 경로는 웹에 나가지 않는다(PickImportXml 과 같은 이유) — 오가는 것은 **파일 이름**뿐이고,
    //     그 이름은 데이터 폴더 안으로만 풀린다. 구분자·「..」가 든 이름은 거절한다.
    //   ★ 개명은 기존 규칙 그대로다: 읽은 파일을 _lastImportPath 로 기억해 두면, 전량 교체가
    //     **성공한 뒤** RenameImportedSource 가 `.migrated-<날짜>` 로 바꿔 다음에 또 묻지 않게 된다.
    //   (PickImportXml 과 64MB·UTF-8·_lastImportPath 규칙을 공유하지만 함수로 뽑지 않았다 —
    //    그 함수는 줄끝이 특수한 MainWindow.xaml.cs 에 있고 계약 시험이 본문을 직접 본다.
    //    그래서 같은 규칙을 여기 최소한으로 한 번 더 적는다. 상한을 바꾸면 **두 곳을 함께** 바꿀 것.)
    public partial class MainWindow
    {
        private const long LegacyXmlMaxBytes = 64L * 1024 * 1024;   // PickImportXml 의 상한과 같다

        //  데이터 폴더 최상위의 *.xml 중 가장 최근에 고친 것 하나. 회신: { ok, found, name, size, mtime }
        private void ProbeLegacyXml(string reqId)
        {
            try
            {
                if (!Directory.Exists(_dataDir))
                {
                    Log("이전 버전 기록 감지: 데이터 폴더 없음");
                    GitReply(reqId, new { ok = true, found = false });
                    return;
                }
                //  ★ TopDirectoryOnly — 하위 폴더(WebView2 프로필 등)는 보지 않는다.
                //  ★ 확장자를 한 번 더 거른다 — Win32 와일드카드는 "*.xml" 이 "a.xmlx" 까지 맞춘다.
                //    개명된 `.migrated-<날짜>` 는 .xml 로 끝나지 않으므로 여기서 자연히 빠진다.
                var fi = new DirectoryInfo(_dataDir)
                    .EnumerateFiles("*.xml", SearchOption.TopDirectoryOnly)
                    .Where(f => f.Name.EndsWith(".xml", StringComparison.OrdinalIgnoreCase))
                    .OrderByDescending(f => f.LastWriteTimeUtc)
                    .FirstOrDefault();
                if (fi == null)
                {
                    Log("이전 버전 기록 감지: 없음");
                    GitReply(reqId, new { ok = true, found = false });
                    return;
                }
                string mtime = fi.LastWriteTimeUtc.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
                Log("이전 버전 기록 감지: " + fi.Name + " (" + fi.Length + "B, " + mtime + ")");
                GitReply(reqId, new { ok = true, found = true, name = fi.Name, size = fi.Length, mtime });
            }
            catch (Exception ex)
            {
                Log("이전 버전 기록 감지 실패: " + ex.Message);
                GitReply(reqId, new { ok = false, error = ex.Message });
            }
        }

        //  감지한 파일 읽기 — 사용자가 「가져오기」를 누른 뒤에만 온다. 회신: { ok, name, text, error }
        private void ReadLegacyXml(string reqId, string name)
        {
            try
            {
                _lastImportPath = null;   // 새 읽기가 시작됐다 — 지난 선택의 흔적을 남기지 않는다(PickImportXml 과 같다)
                string? path = ResolveLegacyXmlPath(name, out string why);
                if (path == null)
                {
                    Log("이전 버전 기록 읽기 거절: " + why);
                    GitReply(reqId, new { ok = false, error = why });
                    return;
                }
                var fi = new FileInfo(path);
                if (fi.Length > LegacyXmlMaxBytes)
                {
                    GitReply(reqId, new { ok = false, error = "파일이 너무 큽니다(64MB 초과): " + fi.Name });
                    return;
                }
                string text = File.ReadAllText(path, Encoding.UTF8);
                _lastImportPath = path;   // 이관 성공 뒤 개명할 대상(P1-8). 읽기에 실패하면 위에서 null 이다
                Log("이전 버전 기록 읽기: " + fi.Name + " (" + fi.Length + "B)");
                GitReply(reqId, new { ok = true, name = fi.Name, text });
            }
            catch (Exception ex)
            {
                Log("이전 버전 기록 읽기 실패: " + ex.Message);
                GitReply(reqId, new { ok = false, error = ex.Message });
            }
        }

        //  웹이 준 **이름** → 데이터 폴더 바로 안의 전체 경로. 하나라도 어기면 null(사유는 why).
        //  ★ 웹은 신뢰 경계 밖이다(콘솔 한 줄이면 아무 이름이나 보낸다) — 이름만 받고, 폴더는 호스트가 정한다.
        private string? ResolveLegacyXmlPath(string name, out string why)
        {
            why = "";
            string n = (name ?? "").Trim();
            if (n.Length == 0) { why = "파일 이름이 비었습니다"; return null; }
            if (n.IndexOfAny(new[] { '/', '\\', ':' }) >= 0 || n.Contains("..") ||
                n.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            {
                why = "파일 이름이 올바르지 않습니다";
                return null;
            }
            if (!n.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)) { why = "XML 파일이 아닙니다"; return null; }
            if (!Directory.Exists(_dataDir)) { why = "데이터 폴더가 없습니다"; return null; }
            string data = Path.GetFullPath(_dataDir).TrimEnd(Path.DirectorySeparatorChar);
            string full = Path.GetFullPath(Path.Combine(data, n));
            string dir = (Path.GetDirectoryName(full) ?? "").TrimEnd(Path.DirectorySeparatorChar);
            if (!string.Equals(dir, data, StringComparison.OrdinalIgnoreCase)) { why = "데이터 폴더 밖의 파일입니다"; return null; }
            if (!File.Exists(full)) { why = "파일이 없습니다: " + n; return null; }
            return full;
        }
    }
}
