using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Xml.Linq;

namespace TaskCalendarWidget
{
    // SVN(TortoiseSVN/SlikSVN의 svn.exe) 커밋 연동. git과 동일한 GitResult/GitCommit 형태로 회신해
    // 작업일지·보고서가 git/svn을 구분 없이 다룬다. 과제 경로의 .git/.svn 마커로 자동 판별.
    public partial class MainWindow
    {
        // 경로의 버전관리 종류 판별: "git" | "svn" | ""
        private static string DetectVcs(string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path)) return "";
                if (Directory.Exists(Path.Combine(path, ".svn"))) return "svn";   // SVN 작업복사본
                if (IsGitRepo(path)) return "git";
                return "";
            }
            catch { return ""; }
        }

        // 분기 단일 소스: 프론트가 명시한 vcs(사용자 라디오 선택)를 최우선, 비어 있을 때만 폴더 마커로 자동판별.
        // (예외: pickfolder는 사용자가 아직 종류를 못 정한 진입점이라 호출부에서 DetectVcs로 감지해 프론트에 제안)
        // gitlog/gitauthor/gitcheck는 모두 이 헬퍼로 통일해, '명시 선택'과 '호스트 재탐지'가 상충하지 않게 한다.
        private static string ResolveVcs(string repo, string vcs)
            => string.IsNullOrWhiteSpace(vcs) ? DetectVcs(repo) : vcs;

        // svn.exe 위치: PATH("svn")에 없으면 TortoiseSVN(명령행 도구)·SlikSVN 기본 설치 경로 탐색.
        private static string SvnExe()
        {
            string[] cands =
            {
                @"C:\Program Files\TortoiseSVN\bin\svn.exe",
                @"C:\Program Files (x86)\TortoiseSVN\bin\svn.exe",
                @"C:\Program Files\SlikSvn\bin\svn.exe",
            };
            foreach (var c in cands) { try { if (File.Exists(c)) return c; } catch { } }
            return "svn";   // PATH에 있으면 사용
        }

        // svn log --xml 로 커밋을 읽어 GitResult로 반환. author는 substring(대소문자 무시) 필터(svn엔 --author 없음).
        // 날짜는 svn이 UTC로 주므로 로컬로 변환하고, 요청 [since,until]을 로컬 날짜로 정밀 재필터.
        private GitResult SvnLog(string repo, string author, string since, string until, bool wantBody = false)
        {
            var r = new GitResult();
            if (string.IsNullOrWhiteSpace(repo)) { r.ok = false; r.error = "SVN 경로가 비어 있습니다."; return r; }
            if (!Directory.Exists(repo)) { r.ok = false; r.error = "경로를 찾을 수 없습니다: " + repo; return r; }

            try
            {
                var psi = new ProcessStartInfo(SvnExe())
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    StandardOutputEncoding = Encoding.UTF8,   // svn --xml 은 UTF-8(한글 안전)
                    StandardErrorEncoding = Encoding.UTF8,
                };
                psi.ArgumentList.Add("log");
                psi.ArgumentList.Add(repo);
                psi.ArgumentList.Add("--xml");
                // 날짜 범위(내림차순=최신 먼저, git과 동일). svn {DATE}=로컬 자정. 경계 누락 방지로 until+1일.
                string hi = string.IsNullOrWhiteSpace(until) ? "HEAD" : "{" + SvnAddDay(until) + "}";
                string lo = string.IsNullOrWhiteSpace(since) ? "1" : "{" + since + "}";
                psi.ArgumentList.Add("-r"); psi.ArgumentList.Add(hi + ":" + lo);
                psi.ArgumentList.Add("--limit"); psi.ArgumentList.Add("1000");
                psi.ArgumentList.Add("--non-interactive");   // 서버 인증 프롬프트 차단(캐시된 자격 사용)

                using var p = Process.Start(psi);
                if (p == null) { r.ok = false; r.error = "svn 프로세스를 시작할 수 없습니다."; return r; }
                string outp = p.StandardOutput.ReadToEnd();
                string errp = p.StandardError.ReadToEnd();
                if (!p.WaitForExit(20000)) { try { p.Kill(true); } catch { } r.ok = false; r.error = "svn 실행 시간 초과(서버 응답 없음)"; return r; }
                if (p.ExitCode != 0)
                {
                    r.ok = false;
                    r.error = string.IsNullOrWhiteSpace(errp) ? ("svn 종료코드 " + p.ExitCode) : errp.Trim();
                    return r;
                }
                if (string.IsNullOrWhiteSpace(outp)) { r.ok = true; return r; }   // 기간 내 커밋 없음

                var xdoc = XDocument.Parse(outp);
                foreach (var le in xdoc.Descendants("logentry"))
                {
                    string rev = (string?)le.Attribute("revision") ?? "";
                    string a = (string?)le.Element("author") ?? "";
                    string dRaw = (string?)le.Element("date") ?? "";
                    string msg = (string?)le.Element("msg") ?? "";

                    // 작성자 필터(svn은 서버 계정명). 비면 전체.
                    if (!string.IsNullOrWhiteSpace(author) && a.IndexOf(author, StringComparison.OrdinalIgnoreCase) < 0) continue;

                    // UTC → 로컬 ISO(오프셋 포함, git %aI 형식과 호환)
                    string localIso = dRaw, localDate = "";
                    if (DateTimeOffset.TryParse(dRaw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dto))
                    {
                        var loc = dto.ToLocalTime();
                        localIso = loc.ToString("yyyy-MM-ddTHH:mm:sszzz");
                        localDate = loc.ToString("yyyy-MM-dd");
                    }
                    // 요청 기간을 로컬 날짜 기준으로 정밀 재필터(UTC↔로컬 경계 오차 보정)
                    if (localDate.Length == 10)
                    {
                        if (!string.IsNullOrWhiteSpace(since) && string.CompareOrdinal(localDate, since) < 0) continue;
                        if (!string.IsNullOrWhiteSpace(until) && string.CompareOrdinal(localDate, until) > 0) continue;
                    }

                    r.commits.Add(new GitCommit
                    {
                        hash = rev,
                        shortHash = "r" + rev,
                        date = localIso,
                        author = a,
                        email = "",
                        subject = SvnFirstLine(msg),
                        body = wantBody ? SvnBody(msg) : "",   // 제목(첫 줄) 제외 본문 — git %b와 동일 의미(옵션 ON일 때만)
                    });
                }
                r.ok = true;
                return r;
            }
            catch (Win32Exception)
            {
                r.ok = false;
                r.error = "svn 명령을 찾을 수 없습니다. TortoiseSVN의 ‘command line client tools’(svn.exe) 설치를 확인하세요.";
                return r;
            }
            catch (Exception ex) { r.ok = false; r.error = "svn 처리 오류: " + ex.Message; return r; }
        }

        private static string SvnFirstLine(string msg)
        {
            if (string.IsNullOrEmpty(msg)) return "";
            foreach (var raw in msg.Replace("\r\n", "\n").Split('\n'))
            {
                var t = raw.Trim();
                if (t.Length > 0) return t;
            }
            return msg.Trim();
        }

        // 제목(첫 비어있지 않은 줄) 이후의 본문. 제목만 있는 메시지는 "". git %b(제목 제외 본문)와 같은 의미.
        private static string SvnBody(string msg)
        {
            if (string.IsNullOrEmpty(msg)) return "";
            var lines = msg.Replace("\r\n", "\n").Split('\n');
            int i = 0;
            while (i < lines.Length && lines[i].Trim().Length == 0) i++;   // 선행 빈 줄 스킵(제목 줄 찾기)
            if (i + 1 >= lines.Length) return "";                          // 제목 한 줄뿐 → 본문 없음
            return string.Join("\n", lines, i + 1, lines.Length - i - 1).Trim();
        }

        private static string SvnAddDay(string ymd)
        {
            return DateTime.TryParseExact(ymd, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
                ? d.AddDays(1).ToString("yyyy-MM-dd") : ymd;
        }
    }
}
