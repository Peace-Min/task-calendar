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
    // 보고서에 실어 보낸 과제별 시간 한 줄. cal_report_hours 의 한 행이 된다.
    //   ★ CatNo 는 null 이 정상이다. 진실은 TaskName(보낸 그대로)이고 CatNo 는 참조일 뿐이다.
    //     지금 이 값을 채우는 코드는 없다 — 유일한 생성지가 MainWindow.xaml.cs 의
    //     `new ReportHourLine { TaskName = …, CatNo = null, Hours = h }` 한 줄이다.
    //   ★★ 2026-09-09 정정 — 이 자리에는 "과제를 지워도 과거 보고 기록은 남아야 하므로 **FK 를
    //     걸지 않았다**" 고 적혀 있었다. 이제 거짓이다: cal_report_hours 에 fk_crh_cat 이 있다
    //     (user_id, cat_no) → cal_category, ON DELETE/UPDATE RESTRICT.
    //     이유는 cat_no 가 MAX()+1 발번이라 **번호가 재사용되기** 때문이다 — FK 가 없으면
    //     '남은 과거 기록' 은 남는 것이 아니라 같은 번호를 받은 다른 과제의 공수로 흡수된다.
    //     · 현 동작은 그대로다: 복합 FK 는 MATCH SIMPLE 이라 cat_no 가 NULL 인 행은 검사 면제다.
    //     · 앞으로 이 필드를 실제로 채우려면 규칙이 하나 붙는다 —
    //       **과제를 지우기 전에 그 과제를 가리키는 보고 공수의 cat_no 를 먼저 비울 것.**
    //       안 그러면 과제 삭제가 1451 로 막힌다(그게 이 가드의 목적이다).
    internal sealed class ReportHourLine
    {
        public string TaskName = "";
        public int? CatNo;
        public decimal Hours;
    }

    // ================================================================================
    //  ReportDb — 보고 기록 쓰기 (설계 §5.9)
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
    // ================================================================================
    internal sealed class ReportDb
    {
        private readonly Action<string> _log;

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

        // ================================================================================
        //  공개 API 1 — 일간보고 저장
        // ================================================================================
        //   부르는 자리: NetcusService 의 전송 성공 확인 직후(vr == 1). 실패한 전송은 저장하지 않는다.
        //   cal_report_daily 1행 + cal_report_hours N행을 **한 트랜잭션**으로 쓴다.
        //   시간줄은 그 날짜를 DELETE 후 재삽입한다 — 재전송 시 줄 구성 자체가 바뀔 수 있어서
        //   행 단위 UPSERT 로는 '사라진 줄'이 남는다.
        public async Task<bool> SaveDailyAsync(
            string? loginId, int y, int m, int d,
            string? status, int overtime, string? content,
            IReadOnlyList<ReportHourLine>? hours)
        {
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
                        "INSERT INTO cal_report_daily (user_id, work_date, status, overtime, content, sent_at) " +
                        "VALUES (@u, @dt, @st, @ot, @c, @at) " +
                        "ON DUPLICATE KEY UPDATE status=VALUES(status), overtime=VALUES(overtime), " +
                        "content=VALUES(content), sent_at=VALUES(sent_at)";
                    cmd.Parameters.AddWithValue("@u", userId);
                    cmd.Parameters.AddWithValue("@dt", date.Value);
                    cmd.Parameters.AddWithValue("@st", Clamp2(status));
                    cmd.Parameters.AddWithValue("@ot", overtime);
                    cmd.Parameters.AddWithValue("@c", content);
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

                int written = 0;
                if (hours != null && hours.Count > 0)
                {
                    await using var ins = conn.CreateCommand();
                    ins.Transaction = tx;
                    var sb = new StringBuilder("INSERT INTO cal_report_hours (user_id, work_date, line_no, task_name, cat_no, hours) VALUES ");
                    int lineNo = 0;
                    for (int i = 0; i < hours.Count; i++)
                    {
                        var h = hours[i];
                        if (h == null) continue;
                        string name = (h.TaskName ?? "").Trim();
                        if (name.Length == 0) continue;                 // 이름 없는 줄은 기록할 대상이 아니다
                        if (name.Length > 200) name = name.Substring(0, 200);   // 컬럼 폭에 맞춰 자른다(예외로 전송을 깨지 않는다)
                        // ★ 2026-09-09 `< 0` → `<= 0`. chk_crh_hours 가 `hours >= 0` 에서
                        //   `hours > 0 AND hours <= 24` 로 좁아졌으므로(cal_task_hours 와 같은 규율)
                        //   0시간 줄도 여기서 미리 걸러야 한다. 안 그러면 그 한 줄이 3819 를 내고
                        //   **그 날 보고 저장 트랜잭션 전체가 죽는다** — 전송은 이미 나간 뒤라 가장 나쁜 실패다.
                        //   의미상으로도 0 은 '기록할 것이 없다' 이지 '0시간을 일했다' 가 아니다.
                        if (h.Hours <= 0) continue;                     // CHECK 위반을 미리 거른다 — 트랜잭션 전체를 죽이지 않게

                        if (lineNo > 0) sb.Append(',');
                        sb.Append("(@u, @dt, @l").Append(lineNo)
                          .Append(", @n").Append(lineNo)
                          .Append(", @k").Append(lineNo)
                          .Append(", @h").Append(lineNo).Append(')');
                        ins.Parameters.AddWithValue("@l" + lineNo, lineNo);
                        ins.Parameters.AddWithValue("@n" + lineNo, name);
                        ins.Parameters.AddWithValue("@k" + lineNo, (object?)h.CatNo ?? DBNull.Value);
                        ins.Parameters.AddWithValue("@h" + lineNo, decimal.Round(h.Hours, 2));
                        lineNo++;
                    }
                    if (lineNo > 0)
                    {
                        ins.Parameters.AddWithValue("@u", userId);
                        ins.Parameters.AddWithValue("@dt", date.Value);
                        ins.CommandText = sb.ToString();
                        await ins.ExecuteNonQueryAsync(cts.Token);
                        written = lineNo;
                    }
                }

                await tx.CommitAsync(cts.Token);
                _log("보고 기록 저장: 일간 " + ds +
                     " (user_id=" + userId + " · 시간줄 " + written + "건)");
                return true;
            }
            catch (Exception ex)
            {
                // 전송은 이미 성공했다. 여기서 던지면 사용자가 재전송하게 되고 그게 더 큰 사고다(클래스 주석).
                _log("보고 기록 저장 실패(전송은 성공했다) — 일간 " + ds + ": " + ex.Message);
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
        public async Task<bool> SaveWeeklyAsync(
            string? loginId, string? sdate, string? edate,
            string? subject, string? content, string? endwork, string? plan)
        {
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

                await using var cmd = conn.CreateCommand();
                cmd.CommandText =
                    "INSERT INTO cal_report_weekly " +
                    "(user_id, period_start, period_end, subject, content, endwork, plan, composed_at) " +
                    "VALUES (@u, @s, @e, @sj, @c, @ew, @pl, @at) " +
                    "ON DUPLICATE KEY UPDATE period_end=VALUES(period_end), subject=VALUES(subject), " +
                    "content=VALUES(content), endwork=VALUES(endwork), plan=VALUES(plan), composed_at=VALUES(composed_at)";
                cmd.Parameters.AddWithValue("@u", userId);
                cmd.Parameters.AddWithValue("@s", ps.Value);
                cmd.Parameters.AddWithValue("@e", pe.Value);
                cmd.Parameters.AddWithValue("@sj", Clamp(subject, 200));
                cmd.Parameters.AddWithValue("@c", content ?? "");
                cmd.Parameters.AddWithValue("@ew", endwork ?? "");
                cmd.Parameters.AddWithValue("@pl", plan ?? "");
                cmd.Parameters.AddWithValue("@at", DateTime.UtcNow);
                await cmd.ExecuteNonQueryAsync(cts.Token);

                _log("보고 기록 저장: 주간 " + ps.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) +
                     " ~ " + pe.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + " (user_id=" + userId + ")");
                return true;
            }
            catch (Exception ex)
            {
                _log("보고 기록 저장 실패 — 주간 " + sdate + " ~ " + edate + ": " + ex.Message);
                return false;
            }
        }

        // ── 내부 ─────────────────────────────────────────────────────────────────
        private static async Task<MySqlConnection> OpenWriteAsync(CancellationToken ct)
        {
            var conn = new MySqlConnection(BuildConnString());
            await conn.OpenAsync(ct);
            await using (var pre = conn.CreateCommand())
            {
                pre.CommandText = WritePreambleSql;      // 프리앰블은 연 연결마다 — 예외를 두면 그 자리가 규약 밖이 된다
                await pre.ExecuteNonQueryAsync(ct);
            }
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
