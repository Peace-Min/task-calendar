using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;

namespace TaskCalendarWidget
{
    // ================================================================================
    //  월간보고 호스트 배선: DOCX 저장(exportMonthlyDocx, docs/MONTHLY-REPORT-PLAN.md §7.4)과 개발 일정 그림 명령(§6.3)
    // ================================================================================
    //  OnWebMessage 의 스위치가 case 한 줄씩으로 부른다. 메인 창 전용이다: 관리 창(AdminWinCommands)과 열람 창(PeerWinCommands)
    //  허용 목록에 이 명령들이 없으므로 그 창에서 오면 OnWebMessage 가 먼저 거절한다(tests/schedule-image.test.mjs 가 지킨다).
    //  ★ 파일 창(저장, 열기)의 주인은 요청한 창이다(DialogOwner). 지금은 메인 창뿐이지만 규칙을 ADMIN-WINDOW §3 과 맞춘다.
    //  ★ 회신은 모두 ReplyOnUi(요청 번호). 저장: { ok, path, dir } | { ok:false, cancelled:true } | { ok:false, error }.
    //  ★ 웹은 그림 바이트를 보내지 않는다. 문서의 그림은 호스트가 과제 uid 로 PC 사본(없으면 DB)에서 넣는다(§6.3).
    //    그림은 사람마다 따로라(2026-10-23) 세션의 사람(저장하는 사람)의 그림만 들어간다(ScheduleImageDb.ImagesForExportAsync).
    //  ★ 이 기능은 회사 사이트로 아무것도 보내지 않는다(Platform.report, netcusSubmit, netcusWeekSubmit 를 부르지 않는다).
    public partial class MainWindow
    {
        // ── 저장 ────────────────────────────────────────────────────────────────
        //  저장 위치 고르기(UI 스레드 모달) → 그림 모으기와 쓰기는 백그라운드 → ReplyOnUi. 취소는 오류가 아니라 조용한 회신.
        private void RunMonthlyDocxExport(Window owner, string reqId, string raw)
        {
            MonthlyReportPayload p;
            try { p = MonthlyReportPayload.Parse(raw); }
            catch (ArgumentException ax) { ReplyOnUi(reqId, new { ok = false, error = ax.Message }); return; }

            string target;
            try
            {
                var dlg = new Microsoft.Win32.SaveFileDialog
                {
                    Title = "월간보고를 저장할 위치 선택",
                    Filter = "Word 문서 (*.docx)|*.docx",
                    DefaultExt = "docx",
                    AddExtension = true,
                    OverwritePrompt = true,
                    FileName = MonthlyDefaultFileName(p.Name, p.ReportDate),
                };
                string last = MonthlyLastDir();
                if (last.Length > 0) dlg.InitialDirectory = last;
                if (dlg.ShowDialog(owner) != true) { ReplyOnUi(reqId, new { ok = false, cancelled = true }); return; }
                target = dlg.FileName;
                MonthlyRememberDir(Path.GetDirectoryName(target) ?? "");
            }
            catch (Exception ex) { ReplyOnUi(reqId, new { ok = false, error = ex.Message }); return; }

            var db = new ScheduleImageDb(_dataDir, Log);
            _ = Task.Run(async () =>
            {
                try
                {
                    var imgs = await db.ImagesForExportAsync(p.ProjectUids());
                    var report = p.ToReport(imgs.ByProject);
                    DocxWriter.Write(target, report);
                    Log("월간보고 DOCX 저장: " + target + " (과제 " + report.Projects.Count + ", 그림 " + imgs.Count + ", " + imgs.Source + ")");
                    ReplyOnUi(reqId, new
                    {
                        ok = true, path = target, dir = Path.GetDirectoryName(target) ?? "",
                        projects = report.Projects.Count, images = imgs.Count, imageSource = imgs.Source, notice = imgs.Note,
                    });
                }
                catch (IOException)
                {
                    //  가장 흔한 실패: Word 나 한글에서 같은 파일을 열어 둔 채 덮어쓰기. 원인을 그대로 말해 준다.
                    ReplyOnUi(reqId, new { ok = false, error = "파일이 열려 있어 저장할 수 없습니다. Word 나 한글에서 닫고 다시 시도하세요." });
                }
                catch (UnauthorizedAccessException)
                {
                    ReplyOnUi(reqId, new { ok = false, error = "이 위치에 저장할 권한이 없습니다. 다른 폴더를 선택하세요." });
                }
                catch (ArgumentException ax)
                {
                    //  DocxWriter 의 그림 형식 오류 등(사본이 깨졌으면 ScheduleImageDb 가 이미 걸렀다)
                    Log("월간보고 DOCX 저장 실패(입력): " + ax.Message);
                    ReplyOnUi(reqId, new { ok = false, error = "문서를 만들지 못했습니다: " + ax.Message });
                }
                catch (Exception ex)
                {
                    Log("월간보고 DOCX 저장 예외: " + ex);
                    ReplyOnUi(reqId, new { ok = false, error = "문서를 저장하지 못했습니다: " + ex.Message });
                }
            });
        }

        //  기본 파일 이름 월간보고_<이름>_<작성일 YYMMDD>.docx(§2.2, §5.5). 이름이 비면 '이름없음'.
        internal static string MonthlyDefaultFileName(string name, DateTime reportDate)
        {
            string who = string.IsNullOrWhiteSpace(name) ? "이름없음" : name.Trim();
            return SanitizeName("월간보고_" + who + "_" + reportDate.ToString("yyMMdd", CultureInfo.InvariantCulture)) + ".docx";
        }

        //  마지막 저장 폴더(앱 데이터 폴더의 monthly-report.json). 없거나 지워졌으면 빈 글자(시스템 기본 폴더).
        private string MonthlyPrefPath() => Path.Combine(_dataDir, "monthly-report.json");

        private string MonthlyLastDir()
        {
            try
            {
                string p = MonthlyPrefPath();
                if (!File.Exists(p)) return "";
                using var doc = JsonDocument.Parse(File.ReadAllText(p));
                string d = doc.RootElement.TryGetProperty("lastDir", out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";
                return d.Length > 0 && Directory.Exists(d) ? d : "";
            }
            catch { return ""; }
        }

        private void MonthlyRememberDir(string dir)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(dir)) return;
                Directory.CreateDirectory(_dataDir);
                File.WriteAllText(MonthlyPrefPath(), JsonSerializer.Serialize(new { lastDir = dir }));
            }
            catch (Exception ex) { Log("월간보고 저장 폴더 기억 실패: " + ex.Message); }
        }

        // ── 개발 일정 그림 명령 ───────────────────────────────────────────────────
        //  판정과 SQL 은 ScheduleImageDb 한 곳. 여기는 추가의 바이트 얻기(파일 창, 클립보드)와 회신만 한다.
        //  ★ 이 메서드는 UI 스레드에서 시작한다(OnWebMessage). await 뒤도 UI 스레드라 파일 창과 클립보드를 그대로 쓴다.
        private async Task RunScheduleImageAsync(string cmd, Window owner, string reqId, string raw)
        {
            ScheduleImageReply r;
            var db = new ScheduleImageDb(_dataDir, Log);
            try
            {
                r = cmd == "scheduleImageAdd" ? await AddScheduleImageAsync(db, owner, raw) : await db.HandleAsync(cmd, raw);
            }
            catch (Exception ex)
            {
                //  ScheduleImageDb 가 예외를 회신으로 바꾸므로 여기 닿는 것은 그 밖의 사고다. 원문은 로그에만 남긴다.
                Log("개발 일정 그림 " + cmd + " 예외: " + ex);
                r = ScheduleImageReply.Failure(DbErrorKind.Unknown, DbErrors.ConnMessage(DbErrorKind.Unknown));
            }
            ReplyOnUi(reqId, r.ToPayload());
        }

        //  { projectUid, mode:'file' | 'clipboard' }. 먼저 DB 로 미리 보고(끊겼거나 5장이면 창을 열지 않는다), 바이트를 얻고, AddAsync.
        private async Task<ScheduleImageReply> AddScheduleImageAsync(ScheduleImageDb db, Window owner, string raw)
        {
            string uid = ScheduleImageDb.ReqProjectUidOrEmpty(raw);
            string mode = "";
            try
            {
                using var doc = JsonDocument.Parse(string.IsNullOrEmpty(raw) ? "{}" : raw);
                if (doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("mode", out var m) && m.ValueKind == JsonValueKind.String)
                    mode = m.GetString() ?? "";
            }
            catch (JsonException) { }
            if (uid.Length == 0) return ScheduleImageReply.Failure(ScheduleImageDb.Kind.Invalid, "과제 id 형식이 잘못되었습니다.");
            if (mode != "file" && mode != "clipboard") return ScheduleImageReply.Failure(ScheduleImageDb.Kind.Invalid, "그림을 넣는 방법(file, clipboard)이 잘못되었습니다.");

            var probe = await db.ProbeAddAsync(uid);
            if (!probe.Ok) return probe;

            byte[] bytes;
            try
            {
                if (mode == "file")
                {
                    var dlg = new Microsoft.Win32.OpenFileDialog
                    {
                        Title = "개발 일정 그림 고르기(PNG, JPEG, 5MB 까지)",
                        Filter = "그림 파일 (*.png;*.jpg;*.jpeg)|*.png;*.jpg;*.jpeg",
                        Multiselect = false,
                        CheckFileExists = true,
                    };
                    if (dlg.ShowDialog(owner) != true) return ScheduleImageReply.Cancel();
                    var fi = new FileInfo(dlg.FileName);
                    if (fi.Length > ScheduleImageDb.Limits.MaxBytes) return ScheduleImageReply.Failure(ScheduleImageDb.Kind.Invalid, ScheduleImageDb.MsgTooBig);
                    bytes = File.ReadAllBytes(dlg.FileName);
                }
                else bytes = ScheduleImageCodec.ReadClipboard();
            }
            catch (ArgumentException ax) { return ScheduleImageReply.Failure(ScheduleImageDb.Kind.Invalid, ax.Message); }
            catch (IOException ix)
            {
                Log("개발 일정 그림 파일 읽기 실패: " + ix.Message);
                return ScheduleImageReply.Failure(ScheduleImageDb.Kind.Invalid, "파일을 읽지 못했습니다. 다른 프로그램이 쓰고 있지 않은지 확인하세요.");
            }
            return await db.AddAsync(uid, bytes);
        }
    }

    // ================================================================================
    //  exportMonthlyDocx payload(§7.4). 글과 구조만 온다(그림 바이트 없음).
    //  { name, reportDate, actual:{from,to}, plan:{from,to},
    //    projects:[{ uid, title, term, changes:[{what,date,why}], prevPlan, actual, nextPlan }], etc:{ lines } }
    //  본문 칸(prevPlan, actual, nextPlan, etc.lines)은 { level, text, bold } 줄 배열이다. level 은 0..3 으로 자른다.
    //  2026-10-23 부터 월간 탭은 prevPlan, nextPlan, changes 를 늘 빈 배열로 보낸다(사용자가 Word 에서 채운다). 칸이 없거나 비어도
    //  받아들이고, DocxWriter 가 양식 그대로 빈 문단과 변경이력 빈 줄 하나를 쓴다. 값이 오면 그대로 쓴다(계약은 바꾸지 않았다).
    //  ★ 상한을 넘으면 자르지 않고 거절한다(ArgumentException, 사용자 문장). 날짜는 YYYY-MM-DD.
    // ================================================================================
    internal sealed class MonthlyReportPayload
    {
        internal static class Limits
        {
            public const int Projects = 40;        // 과제 표 수
            public const int Lines = 2000;         // 칸 하나의 줄 수
            public const int LineChars = 2000;     // 줄 하나의 글자 수
            public const int Changes = 100;        // 변경이력 줄 수
            public const int ShortChars = 200;     // 이름, 과제명, 기간 글자, 변경이력 칸
        }

        public string Name { get; private set; } = "";
        public DateTime ReportDate { get; private set; }
        public DateTime ActualFrom { get; private set; }
        public DateTime ActualTo { get; private set; }
        public DateTime PlanFrom { get; private set; }
        public DateTime PlanTo { get; private set; }
        public List<(string Uid, DocxWriter.Project Project)> Projects { get; } = new List<(string, DocxWriter.Project)>();
        public List<DocxWriter.Line>? Etc { get; private set; }

        public static MonthlyReportPayload Parse(string raw)
        {
            JsonDocument doc;
            try { doc = JsonDocument.Parse(string.IsNullOrEmpty(raw) ? "{}" : raw); }
            catch (JsonException) { throw new ArgumentException("요청 형식이 잘못되었습니다."); }
            using (doc)
            {
                var q = doc.RootElement;
                if (q.ValueKind != JsonValueKind.Object) throw new ArgumentException("요청 형식이 잘못되었습니다.");
                var p = new MonthlyReportPayload
                {
                    Name = Short(q, "name", "이름"),
                    ReportDate = Date(q, "reportDate", "작성일"),
                };
                var (af, at) = Range(q, "actual", "월간 실적 기간");
                var (pf, pt) = Range(q, "plan", "월간 계획 기간");
                p.ActualFrom = af; p.ActualTo = at; p.PlanFrom = pf; p.PlanTo = pt;

                if (q.TryGetProperty("projects", out var arr) && arr.ValueKind != JsonValueKind.Null)
                {
                    if (arr.ValueKind != JsonValueKind.Array) throw new ArgumentException("과제 목록 형식이 잘못되었습니다.");
                    if (arr.GetArrayLength() > Limits.Projects) throw new ArgumentException("과제는 한 문서에 " + Limits.Projects + "개까지 넣을 수 있습니다.");
                    foreach (var o in arr.EnumerateArray())
                    {
                        if (o.ValueKind != JsonValueKind.Object) throw new ArgumentException("과제 형식이 잘못되었습니다.");
                        string uid = ScheduleImageDb.NormalizeProjectUid(Str(o, "uid"));   // 형식이 아니면 빈 글자(그림 없음)
                        var pr = new DocxWriter.Project
                        {
                            Title = Short(o, "title", "과제명"),
                            Term = Short(o, "term", "과제 수행 기간"),
                            PrevPlan = Lines(o, "prevPlan", "왼쪽 수행 계획"),
                            Actual = Lines(o, "actual", "수행 실적"),
                            NextPlan = Lines(o, "nextPlan", "오른쪽 수행 계획"),
                        };
                        if (o.TryGetProperty("changes", out var ch) && ch.ValueKind == JsonValueKind.Array)
                        {
                            if (ch.GetArrayLength() > Limits.Changes) throw new ArgumentException("일정 변경이력은 " + Limits.Changes + "줄까지 넣을 수 있습니다.");
                            foreach (var c in ch.EnumerateArray())
                            {
                                if (c.ValueKind != JsonValueKind.Object) continue;
                                pr.Changes.Add(new DocxWriter.Change
                                {
                                    What = Short(c, "what", "변경 내용"),
                                    Date = Short(c, "date", "변경 날짜"),
                                    Why = Short(c, "why", "변경 사유"),
                                });
                            }
                        }
                        p.Projects.Add((uid, pr));
                    }
                }
                if (q.TryGetProperty("etc", out var etc) && etc.ValueKind == JsonValueKind.Object)
                {
                    var lines = Lines(etc, "lines", "기타");
                    p.Etc = lines.Count > 0 ? lines : null;
                }
                return p;
            }
        }

        //  그림을 찾을 과제 uid(형식이 맞는 것만, 같은 것은 한 번).
        public List<string> ProjectUids()
        {
            var l = new List<string>();
            foreach (var (uid, _) in Projects) if (uid.Length > 0 && !l.Contains(uid)) l.Add(uid);
            return l;
        }

        //  DocxWriter 문서로. 그림은 과제 uid 로 찾은 바이트(순서대로)를 넣는다.
        public DocxWriter.Report ToReport(Dictionary<string, List<byte[]>> images)
        {
            var r = new DocxWriter.Report
            {
                Name = Name, ReportDate = ReportDate,
                ActualFrom = ActualFrom, ActualTo = ActualTo, PlanFrom = PlanFrom, PlanTo = PlanTo,
                Etc = Etc,
            };
            foreach (var (uid, pr) in Projects)
            {
                pr.Images = uid.Length > 0 && images != null && images.TryGetValue(uid, out var b) ? new List<byte[]>(b) : new List<byte[]>();
                r.Projects.Add(pr);
            }
            return r;
        }

        // ── 읽기 도구(모두 사용자 문장으로 거절한다) ───────────────────────────
        private static string Str(JsonElement o, string k) =>
            o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";

        private static string Short(JsonElement o, string k, string label)
        {
            string v = Str(o, k).Trim();
            if (v.Length > Limits.ShortChars) throw new ArgumentException(label + "은(는) " + Limits.ShortChars + "자까지 쓸 수 있습니다.");
            return v;
        }

        private static DateTime Date(JsonElement o, string k, string label)
        {
            string v = Str(o, k);
            if (!DateTime.TryParseExact(v, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
                throw new ArgumentException(label + " 날짜 형식이 잘못되었습니다(YYYY-MM-DD).");
            return d;
        }

        private static (DateTime from, DateTime to) Range(JsonElement q, string k, string label)
        {
            if (!q.TryGetProperty(k, out var o) || o.ValueKind != JsonValueKind.Object) throw new ArgumentException(label + "이 없습니다.");
            var f = Date(o, "from", label + " 시작");
            var t = Date(o, "to", label + " 끝");
            if (f > t) throw new ArgumentException(label + "의 시작이 끝보다 늦습니다.");
            return (f, t);
        }

        private static List<DocxWriter.Line> Lines(JsonElement o, string k, string label)
        {
            var list = new List<DocxWriter.Line>();
            if (!o.TryGetProperty(k, out var a) || a.ValueKind == JsonValueKind.Null) return list;
            if (a.ValueKind != JsonValueKind.Array) throw new ArgumentException(label + " 형식이 잘못되었습니다.");
            if (a.GetArrayLength() > Limits.Lines) throw new ArgumentException(label + "은(는) " + Limits.Lines + "줄까지 넣을 수 있습니다.");
            foreach (var x in a.EnumerateArray())
            {
                if (x.ValueKind != JsonValueKind.Object) throw new ArgumentException(label + " 줄 형식이 잘못되었습니다.");
                string text = Str(x, "text");
                if (text.Length > Limits.LineChars) throw new ArgumentException(label + "의 한 줄은 " + Limits.LineChars + "자까지 쓸 수 있습니다.");
                int level = x.TryGetProperty("level", out var lv) && lv.ValueKind == JsonValueKind.Number && lv.TryGetInt32(out int n) ? n : 0;
                bool bold = x.TryGetProperty("bold", out var bv) && bv.ValueKind == JsonValueKind.True;
                list.Add(new DocxWriter.Line(Math.Max(0, Math.Min(3, level)), text, bold));
            }
            return list;
        }
    }
}
