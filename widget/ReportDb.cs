using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Globalization;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using MySqlConnector;

namespace TaskCalendarWidget
{
    // 일간보고 과제별 줄 하나. cal_report_hours 의 한 행이 된다(구조 22, docs/DB-V22-REPORT-HOURS.md).
    //   CatUid = 앱 과제 id 원문(cal_category.uid, 개인 c-..., 공식 db-<uid>). null = 캘린더 과제와 이어지지 않은 블록.
    //   ProjectUid = 공식 과제 id(project.uid). 개인 과제는 null. Body = 그 과제의 그날 내용(없으면 '').
    //   과제는 id 로 찾는다. TaskName 은 보낸 이름 그대로의 기록(화면 표시)이다.
    internal sealed class ReportHourLine
    {
        public string TaskName = "";
        public string? CatUid;
        public string? ProjectUid;
        public decimal Hours;
        public string Body = "";
    }

    //  주간 과제투입시간 한 줄(cal_report_weekly_hours, 결정 14). 맨먼스 집계의 원천이다.
    //    ProjectUid = 공식 과제 id(project.uid, 36자). 개인 과제는 null. 과제 이름이 바뀌어도 사람 사이 합산이 끊기지 않게 id 를 함께 남긴다.
    internal sealed class WeeklyHourLine
    {
        public string TaskName = "";
        public string? CatUid;       // 앱 과제 id 원문(구조 22). null = 캘린더 과제와 이어지지 않은 줄
        public string? ProjectUid;
        public decimal Hours;
    }

    // ================================================================================
    //  ReportDb — 보고 기록 쓰기 (설계 §5.9)
    //  (2026-10-29 부터 일간 보고 목록 읽기도 여기 있다. ATTENDANCE-PLAN §3.2, 아래 공개 API 3)
    // ================================================================================
    //  【이 클래스가 담는 것 / 담지 않는 것】
    //    담는다:      "캘린더가 8/29 에 무엇을 보고했나"       항상 참. 과거는 안 바뀐다
    //    담지 않는다: "지금 사이트의 8/29 보고는 무엇인가"      물어봐야 알고, 물어봐도 그 순간의 사진
    //
    //    사이트는 우리에게 무효화 신호를 주지 않는다. 검증 못 하는 추측을 검증된 사실 옆에 두면
    //    표 전체의 신뢰도가 추측 수준으로 떨어진다 — 그래서 **우리가 보낸 것만** 담는다(§5.9.2).
    //
    //  【왜 NetcusReportDb 가 아닌가】
    //    저장하는 것은 netcus 의 데이터가 아니라 우리 cal_report_* 기록이다. netcus 는 지금
    //    유일한 호출자일 뿐이고, 레거시 DB 읽기 권한이 생기거나 브라우저판이 붙으면 호출자가 바뀐다.
    //    그때 저장소 클래스 이름에 Netcus 가 박혀 있으면 걸림돌이 된다.
    //    (CalendarDb=읽기 / ProjectDb=과제 / ReportDb=보고 — <도메인>Db 관례를 따른다.)
    //
    //  【실패해도 전송을 깨지 않는다 — 의도된 설계다】
    //    이 클래스가 불리는 시점에는 **이미 회사 사이트로 보고서가 나갔다.** 여기서 예외를 던져
    //    사용자에게 실패로 보이면 "안 보내졌나?" 하고 다시 보내게 되고, 그게 더 큰 사고다.
    //    그래서 모든 실패를 안에서 잡아 로그로 남기고 false 를 돌려준다.
    //    ★ 조용히 삼키는 것이 아니다 — 로그에 원인과 대상 날짜가 남는다. 그걸 지우지 말 것.
    //    ★ 2026-10-29 결정 9: 일간은 호출자(NetcusService)가 이 false 를 기다려 받아 "처리를 완료하지 못했습니다" 로
    //      알린다. 사용자는 회사 보고부터 다시 하고, 회사 쪽은 같은 날짜를 덮어쓴다. 주간은 예전처럼 뒤에서 재시도한다.
    // ================================================================================
    internal sealed class ReportDb
    {
        private readonly Action<string> _log;

        // 일간 공수 한 줄이 DB 에 들어갈 수 있는 값인가: 정본 제약 `chk_crh_hours CHECK (hours >= 0 AND hours <= 24)`
        //   와 같은 판정이다(구조 22 에서 0 을 허용했다. 내용이 있는 0시간 블록도 줄로 남긴다).
        //   범위 밖 줄 하나가 3819 를 내면 **그 날 보고 저장 트랜잭션 전체**가 롤백되고,
        //   전송은 이미 나간 뒤라 가장 나쁜 실패가 된다. 그래서 줄 하나를 버린다.
        //   ★ 2026-09-11 적대 검토(R5): 같은 판정이 두 곳(들어오는 자리 MainWindow.ParseHoursJson,
        //     저장 직전의 마지막 관문)에 **숫자까지 두 벌** 적혀 있었다. 한쪽만 고치면 두 관문이 갈린다.
        //     판정은 여기 한 줄이고, 두 곳은 이것을 부른다(문구와 로그는 각자 자기 자리의 말로 남긴다).
        //   ★ 0시간 줄은 내용(body)이 있을 때만 남긴다(DailyLineKept). 주간(WeeklyHoursInDomain)은 0 을 그대로 막는다.
        internal static bool HoursInDomain(decimal h) => h >= 0m && h <= 24m;

        //  일간 줄 하나를 남길 것인가: 이름이 있고, 시간이 범위 안이고, 0시간이면 내용이 있어야 한다(빈 0시간 블록은 기록할 것이 없다).
        internal static bool DailyLineKept(string? name, decimal h, string? body) =>
            !string.IsNullOrWhiteSpace(name) && HoursInDomain(h) && (h != 0m || !string.IsNullOrWhiteSpace(body));

        //  앱 과제 id(cal_category.uid 와 같은 칸 정의, VARCHAR(80)). 비었거나 너무 길면 null(캘린더 과제와 이어지지 않은 줄).
        internal static string? CatUidOrNull(string? s)
        {
            s = (s ?? "").Trim();
            return s.Length == 0 || s.Length > 80 ? null : s;
        }

        //  공식 과제 id 를 정한다: 받은 값이 uuid 꼴이면 그것, 아니면 과제 id 가 'db-<uuid>' 일 때 그 uuid, 그 밖은 null(개인 과제).
        internal static string? ProjectUidFor(string? catUid, string? projectUid)
        {
            string p = (projectUid ?? "").Trim();
            if (ProjectUidOk(p)) return p;
            if (catUid != null && catUid.StartsWith("db-", StringComparison.Ordinal) && ProjectUidOk(catUid.Substring(3))) return catUid.Substring(3);
            return null;
        }

        //  같은 날 같은 과제 id 블록을 한 줄로 합친다(구조 22: UNIQUE 는 두지 않고 앱이 합친다). 웹도 합쳐 보내지만 마지막 관문에서 한 번 더 본다.
        //    시간은 더하고(24 를 넘으면 24 로 내리고 로그), 내용은 줄바꿈으로 잇는다. id 가 없는 줄은 합치지 않는다. 순서는 처음 나온 자리.
        internal static List<ReportHourLine> MergeDailyLines(IReadOnlyList<ReportHourLine>? lines, Action<string>? log = null)
        {
            var outp = new List<ReportHourLine>();
            if (lines == null) return outp;
            var byCat = new Dictionary<string, ReportHourLine>(StringComparer.Ordinal);
            foreach (var h in lines)
            {
                if (h == null) continue;
                string name = (h.TaskName ?? "").Trim();
                if (name.Length > 200) name = name.Substring(0, 200);
                string body = h.Body ?? "";
                if (!HoursInDomain(h.Hours)) continue;          // CHECK 위반을 미리 거른다(트랜잭션 전체를 죽이지 않게)
                if (!DailyLineKept(name, h.Hours, body)) continue;   // 이름 없는 줄, 내용 없는 0시간 줄은 기록할 대상이 아니다
                string? cat = CatUidOrNull(h.CatUid);
                if (cat != null && byCat.TryGetValue(cat, out var first))
                {
                    decimal sum = first.Hours + h.Hours;
                    if (sum > 24m) { log?.Invoke("보고 시간줄: 같은 과제 블록을 합친 시간이 24 를 넘어 24 로 내렸다: " + first.TaskName); sum = 24m; }
                    first.Hours = sum;
                    if (body.Trim().Length > 0) first.Body = first.Body.Trim().Length > 0 ? first.Body + "\n" + body : body;
                    continue;
                }
                var line = new ReportHourLine { TaskName = name, CatUid = cat, ProjectUid = ProjectUidFor(cat, h.ProjectUid), Hours = h.Hours, Body = body };
                if (cat != null) byCat[cat] = line;
                outp.Add(line);
            }
            return outp;
        }

        //  줄로 다시 만든 회사 글(웹 atCompose 와 같은 꼴): 메모, 그다음 `[과제] : 시간` 과 내용, 조각 사이 빈 줄 하나.
        //    저장 뒤 보낸 글(content)과 견주어 다르면 로그만 남긴다(content 는 보낸 원본이라 고치지 않는다).
        internal static string ComposeDaily(string? memo, IReadOnlyList<ReportHourLine> lines)
        {
            var parts = new List<string>();
            string m = NormText(memo);
            if (m.Trim().Length > 0) parts.Add(m);
            foreach (var l in lines)
            {
                string b = NormText(l.Body);
                parts.Add("[" + l.TaskName + "] : " + decimal.Round(l.Hours, 2).ToString("0.##", CultureInfo.InvariantCulture) + (b.Trim().Length > 0 ? "\n" + b : ""));
            }
            return string.Join("\n\n", parts);
        }

        //  견주기용 정리: &nbsp; 와 U+00A0 은 보통 공백, 줄바꿈은 \n, 앞의 빈 줄과 끝 공백은 뺀다(웹 atDecode, atBodyNorm 과 같다).
        internal static string NormText(string? s)
        {
            string t = (s ?? "").Replace("&nbsp;", " ").Replace("&NBSP;", " ").Replace(' ', ' ').Replace("\r\n", "\n").Replace('\r', '\n');
            t = System.Text.RegularExpressions.Regex.Replace(t, "^(?:[ \\t]*\\n)+", "");
            return t.TrimEnd();
        }

        //  주간 과제투입시간의 허용 범위(chk_crwh_hours: 0 초과 168 이하). 0 은 '기록할 것이 없다' 라 남기지 않는다(일간과 같다).
        //  판정은 이 한 곳에만 둔다. 들어오는 자리(MainWindow.ParseWeeklyHoursJson)와 저장 직전이 같은 함수를 쓴다.
        internal static bool WeeklyHoursInDomain(decimal h) => h > 0m && h <= 168m;
        //  공식 과제 id 꼴(project.uid, 8-4-4-4-12 의 36자). 그 밖의 값은 개인 과제(null)로 남긴다.
        internal static bool ProjectUidOk(string? s) =>
            s != null && System.Text.RegularExpressions.Regex.IsMatch(s, "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

        //  마지막 저장이 **예외로** 실패했으면 그 원문 한 줄(DbErrors.Detail), 성공·건너뜀이면 null.
        //  ★ false 하나로는 '실패'와 '건너뜀(로그인 없음·빈 본문)'을 못 가른다 — 재시도(S10)는 앞쪽만 한다.
        public string? LastFailure { get; private set; }

        public ReportDb(Action<string> log)
        {
            _log = log ?? (_ => { });
        }

        // ★ CalendarDb.BuildConnString 과 값이 같지만 공유하지 않는다 — 그쪽은 읽기 전용 경로의
        //   private 이고, 여기서 끌어 쓰려고 공개로 바꾸면 '읽기 설정'과 '쓰기 설정'이 한 곳에 묶여
        //   한쪽만 바꿔야 할 때 둘 다 바뀐다. 격리수준이 반대인 두 경로다(아래 프리앰블 주석).
        private static string BuildConnString() =>
            new MySqlConnectionStringBuilder
            {
                Server = DeployConfig.DbHost,
                Port = (uint)DeployConfig.DbPort,
                Database = DeployConfig.DbName,
                UserID = DeployConfig.DbUser,
                Password = DeployConfig.DbPassword,
                ConnectionTimeout = 4,        // 접속 대기(초) — 오프라인 빠른 실패
                DefaultCommandTimeout = 8,
                Pooling = false,              // 위젯 단발성 — 정지된 서버로 소켓 재사용 방지
                UseAffectedRows = false,      // §3.3 — 드라이버 기본값 고정(UPSERT 판정을 여기 얹지 않는다)
            }.ConnectionString;

        // ── 쓰기 프리앰블 — 설계 §3.2 ──────────────────────────────────────────
        //   ★ CalendarDb.ReadPreambleSql 과 **합치지 말 것**. 격리수준이 반대다:
        //     읽기 REPEATABLE-READ / 쓰기 READ-COMMITTED. 합치면 둘 중 하나가 반드시 틀리고,
        //     틀린 쪽은 조용히(Warning 138) 나타나 로그를 안 보면 영영 모른다.
        private const string WritePreambleSql =
            "SET SESSION innodb_lock_wait_timeout=5, " +
            "SESSION time_zone='+00:00', " +                    // 시각 컬럼 규약 — 서버 함수가 섞여도 9시간 안 어긋나게
            "SESSION transaction_isolation='READ-COMMITTED'";

        //  읽기 프리앰블(목록 읽기 한 문장). 쓰기 프리앰블과 따로 둔다(위 주석). 시각 규약(+00:00)은 같다.
        private const string ReadPreambleSql =
            "SET SESSION innodb_lock_wait_timeout=5, " +
            "SESSION time_zone='+00:00', " +
            "SESSION transaction_isolation='REPEATABLE-READ'";

        // ================================================================================
        //  공개 API 1 — 일간보고 저장
        // ================================================================================
        //   부르는 자리: NetcusService 의 전송 성공 확인 직후(vr == 1). 실패한 전송은 저장하지 않는다.
        //   호출자는 이 결과를 기다렸다가 성공이나 실패를 알린다(결정 9). false 면 사용자에게 실패로 보인다.
        //   cal_report_daily 1행 + cal_report_hours N행을 **한 트랜잭션**으로 쓴다.
        //   시간줄은 그 날짜를 DELETE 후 재삽입한다 — 재전송 시 줄 구성 자체가 바뀔 수 있어서
        //   행 단위 UPSERT 로는 '사라진 줄'이 남는다.
        //   구조 22: memo(자유 메모)는 NULL 을 쓰지 않는다(없으면 ''). memo 가 NULL 이 아닌 날이 '새 보고'이고, 다시 열 때 글 해석 없이 줄을 쓴다.
        //     줄은 과제 id(cat_uid), 공식 과제 id(project_uid), 시간, 내용(body, 없으면 '')을 싣는다. 같은 과제 id 블록은 한 줄로 합친다.
        public async Task<bool> SaveDailyAsync(
            string? loginId, int y, int m, int d,
            string? status, int overtime, string? content, string? memo,
            IReadOnlyList<ReportHourLine>? hours)
        {
            LastFailure = null;
            var date = SafeDate(y, m, d);
            if (date == null) { _log("보고 기록 저장 건너뜀 — 날짜가 올바르지 않다: " + y + "-" + m + "-" + d); return false; }

            // ★ DateTime? 을 그대로 이어붙이면 "2026-08-28 오전 12:00:00" 이 찍힌다(실측).
            //   로그는 사람이 읽고 날짜로 검색하는 것이라 날짜만 남긴다.
            string ds = date.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

            if (string.IsNullOrEmpty(loginId)) { _log("보고 기록 저장 건너뜀 — 로그인 사용자를 모른다(" + ds + ")"); return false; }

            // 빈 본문은 행을 만들지 않는다 — '보고를 안 쓴 날'과 '빈 보고를 냈다'는 다르다.
            if (string.IsNullOrWhiteSpace(content)) { _log("보고 기록 저장 건너뜀 — 본문이 비었다(" + ds + ")"); return false; }

            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                await using var conn = await OpenWriteAsync(cts.Token);
                int userId = await ResolveUserIdAsync(conn, loginId, cts.Token);

                await using var tx = await conn.BeginTransactionAsync(cts.Token);

                // 1) 일간 본문 — 덮어쓰기(사용자 결정: 재작성하면 갱신, 이력 아님)
                await using (var cmd = conn.CreateCommand())
                {
                    cmd.Transaction = tx;
                    cmd.CommandText =
                        "INSERT INTO cal_report_daily (user_id, work_date, status, overtime, content, memo, sent_at) " +
                        "VALUES (@u, @dt, @st, @ot, @c, @mm, @at) " +
                        "ON DUPLICATE KEY UPDATE status=VALUES(status), overtime=VALUES(overtime), " +
                        "content=VALUES(content), memo=VALUES(memo), sent_at=VALUES(sent_at)";
                    cmd.Parameters.AddWithValue("@u", userId);
                    cmd.Parameters.AddWithValue("@dt", date.Value);
                    cmd.Parameters.AddWithValue("@st", Clamp2(status));
                    cmd.Parameters.AddWithValue("@ot", overtime);
                    cmd.Parameters.AddWithValue("@c", content);
                    cmd.Parameters.AddWithValue("@mm", memo ?? "");   // NULL 을 쓰지 않는다(NULL = 옛 보고라는 표시)
                    cmd.Parameters.AddWithValue("@at", DateTime.UtcNow);
                    await cmd.ExecuteNonQueryAsync(cts.Token);
                }

                // 2) 시간줄 — 그 날짜를 비우고 다시 넣는다(위 주석)
                await using (var del = conn.CreateCommand())
                {
                    del.Transaction = tx;
                    del.CommandText = "DELETE FROM cal_report_hours WHERE user_id=@u AND work_date=@dt";
                    del.Parameters.AddWithValue("@u", userId);
                    del.Parameters.AddWithValue("@dt", date.Value);
                    await del.ExecuteNonQueryAsync(cts.Token);
                }

                // ★ 저장 직전의 **마지막 관문**. 들어오는 자리(MainWindow.ParseHoursJson)가 이미 걸렀지만 여기서 한 번 더 거르고
                //   같은 과제 id 블록을 합친다. 판정은 HoursInDomain, DailyLineKept 한 곳에만 있다(2026-09-11 R5).
                var lines = MergeDailyLines(hours, _log);
                int written = 0;
                if (lines.Count > 0)
                {
                    await using var ins = conn.CreateCommand();
                    ins.Transaction = tx;
                    var sb = new StringBuilder("INSERT INTO cal_report_hours (user_id, work_date, line_no, task_name, cat_uid, project_uid, hours, body) VALUES ");
                    for (int lineNo = 0; lineNo < lines.Count; lineNo++)
                    {
                        var h = lines[lineNo];
                        if (lineNo > 0) sb.Append(',');
                        sb.Append("(@u, @dt, @l").Append(lineNo)
                          .Append(", @n").Append(lineNo)
                          .Append(", @k").Append(lineNo)
                          .Append(", @p").Append(lineNo)
                          .Append(", @h").Append(lineNo)
                          .Append(", @b").Append(lineNo).Append(')');
                        ins.Parameters.AddWithValue("@l" + lineNo, lineNo);
                        ins.Parameters.AddWithValue("@n" + lineNo, h.TaskName);
                        ins.Parameters.AddWithValue("@k" + lineNo, (object?)h.CatUid ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@p" + lineNo, (object?)h.ProjectUid ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@h" + lineNo, decimal.Round(h.Hours, 2));
                        ins.Parameters.AddWithValue("@b" + lineNo, h.Body ?? "");   // NULL 을 쓰지 않는다
                    }
                    ins.Parameters.AddWithValue("@u", userId);
                    ins.Parameters.AddWithValue("@dt", date.Value);
                    ins.CommandText = sb.ToString();
                    await ins.ExecuteNonQueryAsync(cts.Token);
                    written = lines.Count;
                }

                await tx.CommitAsync(cts.Token);
                _log("보고 기록 저장: 일간 " + ds +
                     " (user_id=" + userId + " · 시간줄 " + written + "건)");
                //  줄로 다시 만든 글과 보낸 글(content)이 다르면 로그만 남긴다(content 는 보낸 원본 기록이라 고치지 않는다).
                if (!string.Equals(ComposeDaily(memo, lines), NormText(content), StringComparison.Ordinal))
                    _log("보고 기록 확인: 일간 " + ds + " 줄로 다시 만든 글이 보낸 글과 다르다(기록은 그대로 둔다)");
                return true;
            }
            catch (Exception ex)
            {
                // 던지지 않고 false 로 알린다. 호출자가 공통 실패 안내를 띄운다(결정 9, 클래스 주석).
                _log("보고 기록 저장 실패(전송은 성공했다) — 일간 " + ds + ": " + ex.Message);
                LastFailure = DbErrors.Observe(ex, _log).detail;   // 실패 원인 표시. 건너뜀과 구분한다
                return false;
            }
        }

        // ================================================================================
        //  공개 API 2 — 주간보고 저장
        // ================================================================================
        //   부르는 자리: NetcusService 의 **폼 채우기 성공** 직후. 전송 성공이 아니다 —
        //   위젯은 주간을 전송하지 않고 사용자가 열린 창에서 직접 제출한다(NetcusService.cs 의 WeekFill).
        //   그래서 우리가 아는 사실은 '작성했다'까지이고 컬럼 이름도 composed_at 이다(§5.9.5).
        //   사용자가 폼에서 보완한 내용(notendwork·problem·차주계획 보완분)은 여기 담기지 않는다.
        //   meeting(회의내용, 구조 20, ATTENDANCE-PLAN §13.3): 남기지 않으면 완료한 주를 다시 열 때 빈칸이 되고,
        //   그대로 다시 보내면 인트라넷의 회의내용을 빈칸으로 덮어쓴다(결정 13). 그래서 폼에 채운 값을 같이 남긴다.
        //   hours(결정 14): 과제투입시간 줄을 cal_report_weekly_hours 에 **같은 트랜잭션**으로 쓴다. 그 주의 줄을 지우고 다시 넣는다
        //   (다시 보내면 줄 구성이 바뀔 수 있어 행 단위 UPSERT 로는 사라진 줄이 남는다. SaveDailyAsync 와 같다). 0 시간 줄은 남기지 않는다.
        public async Task<bool> SaveWeeklyAsync(
            string? loginId, string? sdate, string? edate,
            string? subject, string? content, string? endwork, string? plan, string? meeting,
            IReadOnlyList<WeeklyHourLine>? hours = null)
            //  meeting null = 이 요청은 회의내용을 다루지 않았다(보고서 창의 옛 주간 전송). 새 행은 NULL, 있던 행은 그 값을 그대로 둔다.
            //  hours null = 이 요청은 과제투입시간 줄을 다루지 않았다(같은 옛 전송). 그 주의 줄을 그대로 둔다.
        {
            LastFailure = null;
            var ps = ParseDate(sdate);
            var pe = ParseDate(edate);
            if (ps == null || pe == null) { _log("보고 기록 저장 건너뜀 — 주간 기간을 읽지 못했다: '" + sdate + "' ~ '" + edate + "'"); return false; }
            if (ps.Value > pe.Value) { _log("보고 기록 저장 건너뜀 — 주간 기간이 뒤집혔다: " + sdate + " > " + edate); return false; }
            if (string.IsNullOrEmpty(loginId)) { _log("보고 기록 저장 건너뜀 — 로그인 사용자를 모른다(주간 " + sdate + ")"); return false; }

            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                await using var conn = await OpenWriteAsync(cts.Token);
                int userId = await ResolveUserIdAsync(conn, loginId, cts.Token);

                await using var tx = await conn.BeginTransactionAsync(cts.Token);
                await using var cmd = conn.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText =
                    "INSERT INTO cal_report_weekly " +
                    "(user_id, period_start, period_end, subject, content, endwork, plan, meeting, composed_at) " +
                    "VALUES (@u, @s, @e, @sj, @c, @ew, @pl, @mt, @at) " +
                    "ON DUPLICATE KEY UPDATE period_end=VALUES(period_end), subject=VALUES(subject), " +
                    "content=VALUES(content), endwork=VALUES(endwork), plan=VALUES(plan), meeting=COALESCE(VALUES(meeting), meeting), composed_at=VALUES(composed_at)";
                cmd.Parameters.AddWithValue("@u", userId);
                cmd.Parameters.AddWithValue("@s", ps.Value);
                cmd.Parameters.AddWithValue("@e", pe.Value);
                cmd.Parameters.AddWithValue("@sj", Clamp(subject, 200));
                cmd.Parameters.AddWithValue("@c", content ?? "");
                cmd.Parameters.AddWithValue("@ew", endwork ?? "");
                cmd.Parameters.AddWithValue("@pl", plan ?? "");
                cmd.Parameters.AddWithValue("@mt", (object?)meeting ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@at", DateTime.UtcNow);
                await cmd.ExecuteNonQueryAsync(cts.Token);

                //  과제투입시간 줄(결정 14): 그 주를 비우고 다시 넣는다. 부모 행(위 UPSERT)과 한 트랜잭션이라 반쯤 쓴 상태가 남지 않는다.
                int written = -1;
                if (hours != null)
                {
                    await using (var del = conn.CreateCommand())
                    {
                        del.Transaction = tx;
                        del.CommandText = "DELETE FROM cal_report_weekly_hours WHERE user_id=@u AND period_start=@s";
                        del.Parameters.AddWithValue("@u", userId);
                        del.Parameters.AddWithValue("@s", ps.Value);
                        await del.ExecuteNonQueryAsync(cts.Token);
                    }
                    await using var ins = conn.CreateCommand();
                    ins.Transaction = tx;
                    var sb = new StringBuilder("INSERT INTO cal_report_weekly_hours (user_id, period_start, line_no, task_name, cat_uid, project_uid, hours) VALUES ");
                    int lineNo = 0;
                    foreach (var h in hours)
                    {
                        if (h == null) continue;
                        string name = (h.TaskName ?? "").Trim();
                        if (name.Length == 0 || name.Length > 200) continue;      // 칸 폭 밖은 들어오는 자리에서 이미 걸렀다. 여기서 한 번 더(CHECK 와 1406 이 트랜잭션 전체를 죽이지 않게)
                        if (!WeeklyHoursInDomain(h.Hours)) continue;                // 0 시간과 범위 밖은 남기지 않는다(chk_crwh_hours)
                        if (lineNo > 0) sb.Append(',');
                        sb.Append("(@u, @s, @l").Append(lineNo).Append(", @n").Append(lineNo).Append(", @k").Append(lineNo).Append(", @p").Append(lineNo).Append(", @h").Append(lineNo).Append(')');
                        ins.Parameters.AddWithValue("@l" + lineNo, lineNo);
                        ins.Parameters.AddWithValue("@n" + lineNo, name);
                        ins.Parameters.AddWithValue("@k" + lineNo, (object?)CatUidOrNull(h.CatUid) ?? DBNull.Value);   // 과제 id(구조 22). 공식 과제 이관의 열쇠
                        ins.Parameters.AddWithValue("@p" + lineNo, ProjectUidOk(h.ProjectUid) ? h.ProjectUid : (object)DBNull.Value);
                        ins.Parameters.AddWithValue("@h" + lineNo, decimal.Round(h.Hours, 2));
                        lineNo++;
                    }
                    if (lineNo > 0)
                    {
                        ins.Parameters.AddWithValue("@u", userId);
                        ins.Parameters.AddWithValue("@s", ps.Value);
                        ins.CommandText = sb.ToString();
                        await ins.ExecuteNonQueryAsync(cts.Token);
                    }
                    written = lineNo;
                }

                await tx.CommitAsync(cts.Token);
                _log("보고 기록 저장: 주간 " + ps.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) +
                     " ~ " + pe.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + " (user_id=" + userId +
                     (written >= 0 ? " · 시간줄 " + written + "건" : " · 시간줄 그대로") + ")");
                return true;
            }
            catch (Exception ex)
            {
                _log("보고 기록 저장 실패 — 주간 " + sdate + " ~ " + edate + ": " + ex.Message);
                LastFailure = DbErrors.Observe(ex, _log).detail;   // 재시도 대상 표시(S10) — 건너뜀과 구분한다
                return false;
            }
        }

        // ================================================================================
        //  공개 API 3: 일간 보고 목록 읽기 (ATTENDANCE-PLAN §2.2, §3.2, 구조 22)
        // ================================================================================
        //   근태 달력과 근태 창의 "보고한 날짜" 출처가 쓴다. 이 앱으로 보낸 보고만 있다(회사 사이트에서 직접 쓴 보고는 없다).
        //   사람(loginId)은 호스트가 세션에서 읽어 넘긴다. 기간은 from 이상 to 이하, ListMaxDays 일까지(달력 한 달, 출처 60일이면 넉넉하다).
        //   반환: [{date:'YYYY-MM-DD', status, overtime, content, sentAt:'yyyy-MM-ddTHH:mm:ss.fffZ'}] (날짜 순) / 실패나 잘못된 인자는 null.
        //   detail(주간 [일간 불러오기], 근태 [이전 보고], 보고한 날 다시 열기): 행마다 memo 와 lines 를 더 싣는다.
        //     memo = null 이면 옛 보고(구조 22 전)라 웹이 content 를 해석한다. 문자열이면 새 보고이고 lines 가 그날 블록이다(0개일 수 있다).
        //     lines = [{catUid, projectUid, name, hours, body}] (line_no 순). 옛 보고는 늘 빈 배열이다.
        //     부모와 줄은 한 트랜잭션(REPEATABLE-READ, 같은 스냅숏)에서 읽는다. 따로 읽으면 사이에 저장이 끼어 부모와 줄이 어긋날 수 있다.
        //   ★ sent_at 은 UTC 로 쓴다(쓰기 프리앰블 time_zone='+00:00', DateTime.UtcNow). 그래서 읽을 때 Z 를 붙인다.
        internal const int ListMaxDays = 400;

        public async Task<List<Dictionary<string, object?>>?> ListDailyAsync(string? loginId, DateTime from, DateTime to, bool withLines = false)
        {
            from = from.Date; to = to.Date;
            if (string.IsNullOrEmpty(loginId)) { _log("보고 기록 목록 건너뜀: 로그인 사용자를 모른다"); return null; }
            if (from > to || (to - from).TotalDays > ListMaxDays) { _log("보고 기록 목록 건너뜀: 기간이 올바르지 않다"); return null; }
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                await using var conn = await OpenReadAsync(cts.Token);
                int userId = await ResolveUserIdAsync(conn, loginId, cts.Token);

                //  한 스냅숏: 읽기 프리앰블이 REPEATABLE-READ 라 이 트랜잭션의 첫 읽기에서 굳은 스냅숏을 둘째 읽기도 본다.
                await using var tx = await conn.BeginTransactionAsync(cts.Token);
                await using var cmd = conn.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText =
                    "SELECT work_date, status, overtime, content, sent_at, memo FROM cal_report_daily " +
                    "WHERE user_id=@u AND work_date BETWEEN @f AND @t ORDER BY work_date";
                cmd.Parameters.AddWithValue("@u", userId);
                cmd.Parameters.AddWithValue("@f", from);
                cmd.Parameters.AddWithValue("@t", to);
                var rows = new List<Dictionary<string, object?>>();
                await using (var r = await cmd.ExecuteReaderAsync(cts.Token))
                {
                    while (await r.ReadAsync(cts.Token))
                    {
                        var sent = r.IsDBNull(4) ? (DateTime?)null : r.GetDateTime(4);
                        var row = new Dictionary<string, object?>
                        {
                            ["date"] = r.GetDateTime(0).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                            ["status"] = r.IsDBNull(1) ? "" : r.GetString(1),
                            ["overtime"] = r.IsDBNull(2) ? 0 : Convert.ToInt32(r.GetValue(2), CultureInfo.InvariantCulture),
                            ["content"] = r.IsDBNull(3) ? "" : r.GetString(3),
                            ["sentAt"] = sent == null ? "" : sent.Value.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
                        };
                        if (withLines)
                        {
                            row["memo"] = r.IsDBNull(5) ? null : r.GetString(5);   // NULL = 옛 보고(글 해석). 날짜 단위 판정이다
                            row["lines"] = new List<Dictionary<string, object?>>();
                        }
                        rows.Add(row);
                    }
                }
                if (withLines && rows.Count > 0)
                {
                    var byDate = new Dictionary<string, Dictionary<string, object?>>(StringComparer.Ordinal);
                    foreach (var row in rows) byDate[(string)row["date"]!] = row;
                    await using var hc = conn.CreateCommand();
                    hc.Transaction = tx;
                    hc.CommandText =
                        "SELECT work_date, line_no, task_name, cat_uid, project_uid, hours, body FROM cal_report_hours " +
                        "WHERE user_id=@u AND work_date BETWEEN @f AND @t ORDER BY work_date, line_no";
                    hc.Parameters.AddWithValue("@u", userId);
                    hc.Parameters.AddWithValue("@f", from);
                    hc.Parameters.AddWithValue("@t", to);
                    await using var hr = await hc.ExecuteReaderAsync(cts.Token);
                    while (await hr.ReadAsync(cts.Token))
                    {
                        string k = hr.GetDateTime(0).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                        if (!byDate.TryGetValue(k, out var row) || row["memo"] == null) continue;   // 옛 보고 날짜에는 줄을 붙이지 않는다(규칙은 memo 하나)
                        ((List<Dictionary<string, object?>>)row["lines"]!).Add(new Dictionary<string, object?>
                        {
                            ["catUid"] = hr.IsDBNull(3) ? null : hr.GetString(3),
                            //  ★ project_uid 는 CHAR(36) 이라 MySqlConnector 가 Guid 로 읽는다. GetString 은 InvalidCast(2026-10-30 실측, 주간과 같다).
                            ["projectUid"] = hr.IsDBNull(4) ? null : Convert.ToString(hr.GetValue(4), CultureInfo.InvariantCulture),
                            ["name"] = hr.IsDBNull(2) ? "" : hr.GetString(2),
                            ["hours"] = hr.IsDBNull(5) ? 0m : hr.GetDecimal(5),
                            ["body"] = hr.IsDBNull(6) ? "" : hr.GetString(6),
                        });
                    }
                }
                await tx.CommitAsync(cts.Token);
                _log("보고 기록 목록: " + from.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + " ~ " +
                     to.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + " (user_id=" + userId + ", " + rows.Count + "건" + (withLines ? ", 줄 포함" : "") + ")");
                return rows;
            }
            catch (Exception ex)
            {
                _log("보고 기록 목록 읽기 실패: " + ex.Message);
                DbErrors.Observe(ex, _log);   // 연결 끊김 알림과 실패 분류(OFFLINE-RESILIENCE S12)
                return null;
            }
        }

        // ================================================================================
        //  공개 API 4: 주간보고 목록 읽기 (ATTENDANCE-PLAN §13.1, §13.3)
        // ================================================================================
        //   근태 탭 주간 목록(상태 완료, 날짜)과 주간 편집(완료한 주 열기, 지난주 차주계획 가져오기)이 쓴다.
        //   이 앱으로 작성한 주만 있다(인트라넷에 직접 쓴 주는 [인트라넷에서 확인]으로 본다).
        //   사람은 호스트가 세션에서 읽어 넘긴다(payload 의 me 를 믿지 않는다). 기간은 period_start 기준 from 이상 to 이하,
        //   ListMaxDays 일까지(일간과 같은 상한. 목록 한 해치면 넉넉하다).
        //   반환: [{periodStart, periodEnd, subject, content, endwork, plan, meeting, composedAt, hours?}] (최근 주가 위) / 실패나 잘못된 인자는 null.
        //   hours = [{name, projectUid, hours, catUid}](결정 14, 과제투입시간 줄. catUid 는 구조 22). 시간 표가 없는 DB 에서는 이 키가 없다.
        //   meeting 이 NULL 인 행(구조 20 전에 작성한 주)은 빈 글로 준다.
        public async Task<List<Dictionary<string, object?>>?> ListWeeklyAsync(string? loginId, DateTime from, DateTime to)
        {
            from = from.Date; to = to.Date;
            if (string.IsNullOrEmpty(loginId)) { _log("주간보고 목록 건너뜀: 로그인 사용자를 모른다"); return null; }
            if (from > to || (to - from).TotalDays > ListMaxDays) { _log("주간보고 목록 건너뜀: 기간이 올바르지 않다"); return null; }
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                await using var conn = await OpenReadAsync(cts.Token);
                int userId = await ResolveUserIdAsync(conn, loginId, cts.Token);

                await using var cmd = conn.CreateCommand();
                cmd.CommandText =
                    "SELECT period_start, period_end, subject, content, endwork, plan, COALESCE(meeting, '') AS meeting, composed_at " +
                    "FROM cal_report_weekly WHERE user_id=@u AND period_start BETWEEN @f AND @t ORDER BY period_start DESC";
                cmd.Parameters.AddWithValue("@u", userId);
                cmd.Parameters.AddWithValue("@f", from);
                cmd.Parameters.AddWithValue("@t", to);
                var rows = new List<Dictionary<string, object?>>();
                await using (var r = await cmd.ExecuteReaderAsync(cts.Token))
                {
                    while (await r.ReadAsync(cts.Token))
                    {
                        var at = r.IsDBNull(7) ? (DateTime?)null : r.GetDateTime(7);
                        rows.Add(new Dictionary<string, object?>
                        {
                            ["periodStart"] = r.GetDateTime(0).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                            ["periodEnd"] = r.GetDateTime(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                            ["subject"] = r.IsDBNull(2) ? "" : r.GetString(2),
                            ["content"] = r.IsDBNull(3) ? "" : r.GetString(3),
                            ["endwork"] = r.IsDBNull(4) ? "" : r.GetString(4),
                            ["plan"] = r.IsDBNull(5) ? "" : r.GetString(5),
                            ["meeting"] = r.IsDBNull(6) ? "" : r.GetString(6),
                            //  composed_at 은 UTC 로 쓴다(쓰기 프리앰블, DateTime.UtcNow). 읽을 때 Z 를 붙인다(일간 sentAt 과 같다).
                            ["composedAt"] = at == null ? "" : at.Value.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
                        });
                    }
                }
                //  과제투입시간 줄(결정 14). 같은 기간을 한 번 더 읽어 주마다 hours:[{name, projectUid, hours}] 로 붙인다(줄 순서).
                //  ★ 이 표가 아직 없는 DB(구조 20 이지만 v20 보정 전의 개발 DB, 1146)에서는 시간 줄 없이 목록만 돌려준다.
                //    목록 전체를 실패시키면 주간 화면이 통째로 막힌다. 그때 웹은 과제투입시간을 글(content)에서 되살린다.
                var byWeek = new Dictionary<string, List<Dictionary<string, object?>>>();
                try
                {
                    await using var hc = conn.CreateCommand();
                    hc.CommandText =
                        "SELECT period_start, line_no, task_name, project_uid, hours, cat_uid FROM cal_report_weekly_hours " +
                        "WHERE user_id=@u AND period_start BETWEEN @f AND @t ORDER BY period_start, line_no";
                    hc.Parameters.AddWithValue("@u", userId);
                    hc.Parameters.AddWithValue("@f", from);
                    hc.Parameters.AddWithValue("@t", to);
                    await using var hr = await hc.ExecuteReaderAsync(cts.Token);
                    while (await hr.ReadAsync(cts.Token))
                    {
                        string k = hr.GetDateTime(0).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                        if (!byWeek.TryGetValue(k, out var L)) byWeek[k] = L = new List<Dictionary<string, object?>>();
                        L.Add(new Dictionary<string, object?>
                        {
                            ["name"] = hr.IsDBNull(2) ? "" : hr.GetString(2),
                            //  ★ project_uid 는 CHAR(36) 이라 MySqlConnector 가 Guid 로 읽는다. GetString 은 InvalidCast 로 목록 전체를 실패시킨다(2026-10-30 실측).
                            ["projectUid"] = hr.IsDBNull(3) ? "" : Convert.ToString(hr.GetValue(3), CultureInfo.InvariantCulture) ?? "",
                            ["hours"] = hr.IsDBNull(4) ? 0m : hr.GetDecimal(4),
                            ["catUid"] = hr.IsDBNull(5) ? "" : hr.GetString(5),   // 과제 id(구조 22). 이어지지 않은 줄은 ''
                        });
                    }
                }
                catch (MySqlException mex) when (mex.ErrorCode == MySqlErrorCode.NoSuchTable)
                {
                    _log("주간보고 목록: 과제투입시간 표(cal_report_weekly_hours)가 없어 시간 줄 없이 돌려준다(개발 DB 보정 전)");
                    byWeek = null;
                }
                foreach (var row in rows)
                    if (byWeek != null) row["hours"] = byWeek.TryGetValue((string)row["periodStart"]!, out var hl) ? hl : new List<Dictionary<string, object?>>();
                _log("주간보고 목록: " + from.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + " ~ " +
                     to.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + " (user_id=" + userId + ", " + rows.Count + "건)");
                return rows;
            }
            catch (Exception ex)
            {
                _log("주간보고 목록 읽기 실패: " + ex.Message);
                DbErrors.Observe(ex, _log);   // 연결 끊김 알림과 실패 분류(일간 목록과 같다)
                return null;
            }
        }

        // ================================================================================
        //  공개 API 5: 공식 과제로 연결할 때 공수 옮기기 (구조 22, docs/DB-V22-REPORT-HOURS.md 앱 변경 6)
        // ================================================================================
        //   이 사람의 cal_report_hours 와 cal_report_weekly_hours 에서 **cat_uid 가 옛 개인 과제 id 인 줄만** 공식 과제로 옮긴다.
        //   과제 이름은 비교하지 않는다(같은 이름의 다른 공식 과제 줄을 끌고 오지 않는다). 옮긴 줄은 cat_uid = 'db-<uid>',
        //   project_uid = uid, task_name = 공식 이름. 공식 이름은 여기서 project 표를 uid 로 읽는다(웹이 보낸 이름을 믿지 않는다).
        //   같은 날(주)에 그 공식 과제 줄이 이미 있으면 시간을 더해 가장 작은 line_no 한 줄로 남기고 나머지는 지운다.
        //     내용(body)은 줄 순서대로 줄바꿈으로 잇는다(NULL 과 빈 글은 건너뛴다. CONCAT_WS 와 COALESCE 를 쓴 것과 같은 결과로, 통째로 NULL 이 되지 않는다).
        //   합친 시간이 하루 24, 한 주 168 을 넘으면 DB 제약에 걸려 전체가 실패하므로 미리 보고 문구로 거절한다(아무것도 바꾸지 않는다).
        //   잠금 순서는 일간 저장과 같다: 일간 부모 FOR UPDATE, 일간 줄, 주간 부모, 주간 줄(다르면 교착).
        //   한 트랜잭션이고 연결은 DbGate.OpenAsync 로 열며 커밋 직전에 구조 번호를 다시 본다. content 와 주간 글은 바꾸지 않는다.
        //   같은 명령을 다시 보내도 결과가 같다(옮길 줄이 없으면 그냥 성공). 옛 보고(memo NULL)는 줄이 없으므로 대상이 아니다.
        //   반환: (ok, 문구, 옮긴 일간 줄 수, 옮긴 주간 줄 수). 실패면 ok=false 이고 문구는 사용자에게 보일 한국어다.
        internal const string RelinkFailMsg = "공수를 옮기지 못했습니다. 원래 과제는 그대로 두었습니다.";

        public async Task<(bool ok, string msg, int daily, int weekly)> RelinkHoursAsync(string? loginId, string? oldCatUid, string? projectUid)
        {
            LastFailure = null;
            string oldCat = (oldCatUid ?? "").Trim();
            string uid = (projectUid ?? "").Trim();
            if (string.IsNullOrEmpty(loginId)) { _log("공수 옮기기 건너뜀: 로그인 사용자를 모른다"); return (false, "로그인이 필요합니다.", 0, 0); }
            if (CatUidOrNull(oldCat) == null || oldCat.StartsWith("db-", StringComparison.Ordinal) || !ProjectUidOk(uid))
            { _log("공수 옮기기 거부: 과제 id 가 올바르지 않다"); return (false, "연결할 과제가 올바르지 않습니다.", 0, 0); }
            string newCat = "db-" + uid;
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
                var ct = cts.Token;
                await using var conn = await OpenWriteAsync(ct);   // DbGate.OpenAsync 로 연다(구조 번호 판정)
                int userId = await ResolveUserIdAsync(conn, loginId!, ct);
                await using var tx = await conn.BeginTransactionAsync(ct);

                //  공식 이름(카탈로그와 같은 규칙: 통상명칭, 없으면 사업명). 없는 과제면 거절한다.
                string? official;
                await using (var c0 = conn.CreateCommand())
                {
                    c0.Transaction = tx;
                    c0.CommandText = "SELECT COALESCE(NULLIF(TRIM(common_name), ''), NULLIF(TRIM(project_name), ''), '(이름 없음)') FROM project WHERE uid=@p";
                    c0.Parameters.AddWithValue("@p", uid);
                    official = Convert.ToString(await c0.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
                }
                if (string.IsNullOrEmpty(official))
                {
                    await tx.RollbackAsync(ct);
                    return (false, "공식 과제를 찾을 수 없습니다. 원래 과제는 그대로 두었습니다.", 0, 0);
                }
                if (official.Length > 200) official = official.Substring(0, 200);

                //  1) 일간 부모 잠금(옛 과제 줄이 있는 날만, 날짜 순). 2) 그날들의 일간 줄 잠금과 읽기(옛 과제와 대상 공식 과제 줄만).
                var days = await LockParentsAsync(conn, tx,
                    "SELECT work_date FROM cal_report_daily WHERE user_id=@u AND work_date IN " +
                    "(SELECT work_date FROM cal_report_hours WHERE user_id=@u AND cat_uid=@o) ORDER BY work_date FOR UPDATE",
                    userId, oldCat, ct);
                var dRows = days.Count == 0 ? new List<RelinkRow>() : await LockRowsAsync(conn, tx,
                    "SELECT work_date, line_no, cat_uid, hours, body FROM cal_report_hours WHERE user_id=@u AND cat_uid IN (@o, @n) " +
                    "AND work_date IN (" + DateList(days) + ") ORDER BY work_date, line_no FOR UPDATE",
                    userId, oldCat, newCat, true, ct);
                //  3) 주간 부모 잠금, 4) 주간 줄 잠금과 읽기.
                var weeks = await LockParentsAsync(conn, tx,
                    "SELECT period_start FROM cal_report_weekly WHERE user_id=@u AND period_start IN " +
                    "(SELECT period_start FROM cal_report_weekly_hours WHERE user_id=@u AND cat_uid=@o) ORDER BY period_start FOR UPDATE",
                    userId, oldCat, ct);
                var wRows = weeks.Count == 0 ? new List<RelinkRow>() : await LockRowsAsync(conn, tx,
                    "SELECT period_start, line_no, cat_uid, hours, NULL FROM cal_report_weekly_hours WHERE user_id=@u AND cat_uid IN (@o, @n) " +
                    "AND period_start IN (" + DateList(weeks) + ") ORDER BY period_start, line_no FOR UPDATE",
                    userId, oldCat, newCat, false, ct);

                //  미리 검사: 합친 시간이 하루 24, 한 주 168 을 넘으면 거절한다(아직 아무것도 바꾸지 않았다).
                string? overDay = RelinkOver(dRows, oldCat, 24m), overWeek = RelinkOver(wRows, oldCat, 168m);
                if (overDay != null || overWeek != null)
                {
                    await tx.RollbackAsync(ct);
                    string why = overDay != null ? "하루 24시간을 넘는 날(" + overDay + ")이 있어" : "한 주 168시간을 넘는 주(" + overWeek + ")가 있어";
                    _log("공수 옮기기 거절: 합친 시간이 " + why + " user_id=" + userId);
                    return (false, "합친 시간이 " + why + " 연결하지 않았습니다. 원래 과제는 그대로 두었습니다.", 0, 0);
                }

                int dMoved = await RelinkApplyAsync(conn, tx, "cal_report_hours", "work_date", true, dRows, userId, oldCat, newCat, uid, official, ct);
                int wMoved = await RelinkApplyAsync(conn, tx, "cal_report_weekly_hours", "period_start", false, wRows, userId, oldCat, newCat, uid, official, ct);

                //  커밋 직전 관문 재확인(CalendarWriteDb 와 같다). 막혔으면 통째로 롤백한다.
                var gateMeta = await DbGate.ReadMetaAsync(conn, tx, ct);
                if (DbGate.Observe(gateMeta) != GateVerdict.Ok)
                {
                    try { await tx.RollbackAsync(CancellationToken.None); } catch { /* 연결을 닫으면 서버가 어차피 롤백한다 */ }
                    _log("공수 옮기기 중단(버전 관문, 커밋 직전): " + (DbGate.Last?.State ?? "unknown") + ", 롤백");
                    return (false, RelinkFailMsg, 0, 0);
                }
                await tx.CommitAsync(ct);
                _log("공수 옮기기: user_id=" + userId + " " + oldCat + " -> " + newCat + " (일간 줄 " + dMoved + "건, 주간 줄 " + wMoved + "건)");
                return (true, "", dMoved, wMoved);
            }
            catch (Exception ex)
            {
                _log("공수 옮기기 실패: " + ex.Message);
                LastFailure = DbErrors.Observe(ex, _log).detail;
                return (false, RelinkFailMsg, 0, 0);
            }
        }

        //  공수 옮기기가 읽은 줄 하나(일간은 날짜, 주간은 주 시작일이 Key).
        internal sealed class RelinkRow
        {
            public string Key = "";
            public int LineNo;
            public string CatUid = "";
            public decimal Hours;
            public string? Body;
        }

        //  값은 DB 가 돌려준 DATE 뿐이다(사용자 글이 섞이지 않는다). 날짜 꼴로만 적는다.
        private static string DateList(List<DateTime> ds)
        {
            var parts = new List<string>(ds.Count);
            foreach (var d in ds) parts.Add("'" + d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "'");
            return string.Join(",", parts);
        }

        private static async Task<List<DateTime>> LockParentsAsync(MySqlConnection conn, MySqlTransaction tx, string sql, int userId, string oldCat, CancellationToken ct)
        {
            var list = new List<DateTime>();
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = sql;
            cmd.Parameters.AddWithValue("@u", userId);
            cmd.Parameters.AddWithValue("@o", oldCat);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) list.Add(r.GetDateTime(0).Date);
            return list;
        }

        private static async Task<List<RelinkRow>> LockRowsAsync(MySqlConnection conn, MySqlTransaction tx, string sql, int userId, string oldCat, string newCat, bool hasBody, CancellationToken ct)
        {
            var list = new List<RelinkRow>();
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = sql;
            cmd.Parameters.AddWithValue("@u", userId);
            cmd.Parameters.AddWithValue("@o", oldCat);
            cmd.Parameters.AddWithValue("@n", newCat);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                list.Add(new RelinkRow
                {
                    Key = r.GetDateTime(0).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    LineNo = Convert.ToInt32(r.GetValue(1), CultureInfo.InvariantCulture),
                    CatUid = r.GetString(2),
                    Hours = r.GetDecimal(3),
                    Body = hasBody && !r.IsDBNull(4) ? r.GetString(4) : null,
                });
            return list;
        }

        //  옛 과제 줄이 있는 날(주) 가운데 옛 과제와 대상 공식 과제 줄의 합이 상한을 넘는 첫 열쇠. 없으면 null.
        internal static string? RelinkOver(List<RelinkRow> rows, string oldCat, decimal max)
        {
            var sum = new SortedDictionary<string, decimal>(StringComparer.Ordinal);
            var hasOld = new HashSet<string>(StringComparer.Ordinal);
            foreach (var x in rows)
            {
                sum[x.Key] = (sum.TryGetValue(x.Key, out var v) ? v : 0m) + x.Hours;
                if (x.CatUid == oldCat) hasOld.Add(x.Key);
            }
            foreach (var kv in sum) if (hasOld.Contains(kv.Key) && kv.Value > max) return kv.Key;
            return null;
        }

        //  옮기기 계획 한 묶음(한 날 또는 한 주). 남길 줄(가장 작은 line_no), 합친 시간, 이은 내용(주간은 null), 지울 줄, 옮긴 옛 과제 줄 수.
        internal sealed class RelinkStep
        {
            public string Key = "";
            public int KeepLine;
            public decimal Hours;
            public string? Body;
            public List<int> DropLines = new List<int>();
            public int Olds;
        }

        //  날(주)마다: 남길 줄 = 가장 작은 line_no. 그 줄을 공식 과제로 바꾸고 시간을 합치고(일간은 내용도 줄 순서대로 잇고) 나머지 줄은 지운다.
        //    옛 과제 줄이 없는 날은 건드리지 않는다(대상 공식 과제 줄만 있는 날). 순수 함수라 시험이 C# 그대로 돌린다(tests/report-hours-v22).
        internal static List<RelinkStep> RelinkPlan(List<RelinkRow> rows, string oldCat, bool hasBody)
        {
            var plan = new List<RelinkStep>();
            var groups = new SortedDictionary<string, List<RelinkRow>>(StringComparer.Ordinal);
            foreach (var x in rows) { if (!groups.TryGetValue(x.Key, out var g)) groups[x.Key] = g = new List<RelinkRow>(); g.Add(x); }
            foreach (var kv in groups)
            {
                var g = kv.Value;
                int olds = 0; foreach (var x in g) if (x.CatUid == oldCat) olds++;
                if (olds == 0) continue;
                g.Sort((a, b) => a.LineNo.CompareTo(b.LineNo));
                var step = new RelinkStep { Key = kv.Key, KeepLine = g[0].LineNo, Olds = olds };
                var bodies = new List<string>();
                foreach (var x in g) { step.Hours += x.Hours; if (x.Body != null && x.Body.Trim().Length > 0) bodies.Add(x.Body); }
                step.Hours = decimal.Round(step.Hours, 2);
                step.Body = hasBody ? string.Join("\n", bodies) : null;
                for (int i = 1; i < g.Count; i++) step.DropLines.Add(g[i].LineNo);
                plan.Add(step);
            }
            return plan;
        }

        //  계획대로 쓴다. 돌려주는 값 = 옮긴 옛 과제 줄 수. 표와 열 이름은 이 파일의 상수 인자에서만 온다.
        private static async Task<int> RelinkApplyAsync(MySqlConnection conn, MySqlTransaction tx, string table, string keyCol, bool hasBody,
            List<RelinkRow> rows, int userId, string oldCat, string newCat, string uid, string official, CancellationToken ct)
        {
            int moved = 0;
            foreach (var st in RelinkPlan(rows, oldCat, hasBody))
            {
                moved += st.Olds;
                await using (var up = conn.CreateCommand())
                {
                    up.Transaction = tx;
                    up.CommandText = "UPDATE " + table + " SET cat_uid=@n, project_uid=@p, task_name=@t, hours=@h" + (hasBody ? ", body=@b" : "") +
                                     " WHERE user_id=@u AND " + keyCol + "=@k AND line_no=@l";
                    up.Parameters.AddWithValue("@n", newCat);
                    up.Parameters.AddWithValue("@p", uid);
                    up.Parameters.AddWithValue("@t", official);
                    up.Parameters.AddWithValue("@h", st.Hours);
                    if (hasBody) up.Parameters.AddWithValue("@b", st.Body ?? "");
                    up.Parameters.AddWithValue("@u", userId);
                    up.Parameters.AddWithValue("@k", st.Key);
                    up.Parameters.AddWithValue("@l", st.KeepLine);
                    await up.ExecuteNonQueryAsync(ct);
                }
                foreach (int ln in st.DropLines)
                {
                    await using var del = conn.CreateCommand();
                    del.Transaction = tx;
                    del.CommandText = "DELETE FROM " + table + " WHERE user_id=@u AND " + keyCol + "=@k AND line_no=@l";
                    del.Parameters.AddWithValue("@u", userId);
                    del.Parameters.AddWithValue("@k", st.Key);
                    del.Parameters.AddWithValue("@l", ln);
                    await del.ExecuteNonQueryAsync(ct);
                }
            }
            return moved;
        }

        //  웹이 보내는 날짜 'YYYY-MM-DD' 를 엄격하게 읽는다(근태 창의 날짜 이동, 목록 기간). 그 밖의 모양은 false.
        internal static bool TryParseYmd(string? s, out DateTime d) =>
            DateTime.TryParseExact(s ?? "", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d);

        // ── 내부 ─────────────────────────────────────────────────────────────────
        //  연결은 버전 관문(DbGate)이 연다(장애 주입, 열기 실패 정리, 구조 번호 판정).
        //  ★ 프리앰블이 실패하면 연결을 닫고 원인을 그대로 던진다. 예전에는 열린 연결을 흘렸다.
        private static async Task<MySqlConnection> OpenWriteAsync(CancellationToken ct)
        {
            var conn = await DbGate.OpenAsync(BuildConnString(), ct);
            try
            {
                await using var pre = conn.CreateCommand();
                pre.CommandText = WritePreambleSql;      // 프리앰블은 연 연결마다 — 예외를 두면 그 자리가 규약 밖이 된다
                await pre.ExecuteNonQueryAsync(ct);
            }
            catch { await conn.DisposeAsync(); throw; }
            return conn;
        }

        //  읽기용 연결(목록 읽기). 쓰기와 같은 관문(DbGate)으로 열고 읽기 프리앰블을 건다. 실패는 그대로 던진다.
        private static async Task<MySqlConnection> OpenReadAsync(CancellationToken ct)
        {
            var conn = await DbGate.OpenAsync(BuildConnString(), ct);
            try
            {
                await using var pre = conn.CreateCommand();
                pre.CommandText = ReadPreambleSql;
                await pre.ExecuteNonQueryAsync(ct);
            }
            catch { await conn.DisposeAsync(); throw; }
            return conn;
        }

        // login_id → user_id. 0행이면 app_user 에 없는 사람이다 — 만들어 내지 않는다(§3.6).
        //   ★ CalendarDb.ResolveUserIdAsync 를 부르지 않는 이유: 그건 읽기 프리앰블로 **별도 연결**을
        //     연다. 같은 쓰기 트랜잭션 안에서 풀어야 연결이 하나로 끝나고 격리수준도 어긋나지 않는다.
        private static async Task<int> ResolveUserIdAsync(MySqlConnection conn, string loginId, CancellationToken ct)
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT user_id FROM app_user WHERE login_id = @l";
            cmd.Parameters.AddWithValue("@l", loginId);
            object? v = await cmd.ExecuteScalarAsync(ct);
            if (v == null || v == DBNull.Value)
                throw new InvalidOperationException("app_user 에 login_id='" + loginId + "' 가 없다");
            return Convert.ToInt32(v, CultureInfo.InvariantCulture);
        }

        private static DateTime? SafeDate(int y, int m, int d)
        {
            if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
            try { return new DateTime(y, m, d); } catch { return null; }
        }

        // 사이트 폼이 쓰는 'YYYY-MM-DD'(구분자 흔들림 허용). 실패하면 null 이고 호출측이 저장을 건너뛴다.
        private static DateTime? ParseDate(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            string t = s.Trim().Replace('/', '-').Replace('.', '-');
            return DateTime.TryParseExact(t, "yyyy-M-d", CultureInfo.InvariantCulture,
                       DateTimeStyles.None, out var dt) ? dt.Date : (DateTime?)null;
        }

        private static string Clamp(string? s, int max)
        {
            s ??= "";
            return s.Length <= max ? s : s.Substring(0, max);
        }

        // status 는 VARCHAR(2). ""(미기록)은 그대로 둔다 — 웹→호스트 공통 규약(NetcusReq.Status 주석).
        private static string Clamp2(string? s) => Clamp(s, 2);
    }
}
