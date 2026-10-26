using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MySqlConnector;

namespace TaskCalendarWidget
{
    // 정본: docs/ATTENDANCE-REPORT-POLICY.md. 회사 성공 전에는 조회와 입력 검증만 한다.
    internal sealed class AttendanceDb
    {
        private readonly string _login;
        public AttendanceDb(string login, Action<string> log) { _login = login; }
        private static string ConnectionString => new MySqlConnectionStringBuilder {
            Server = DeployConfig.DbHost, Port = (uint)DeployConfig.DbPort, Database = DeployConfig.DbName,
            UserID = DeployConfig.DbUser, Password = DeployConfig.DbPassword, ConnectionTimeout = 4,
            DefaultCommandTimeout = 8, Pooling = false, UseAffectedRows = false, GuidFormat = MySqlGuidFormat.None }.ConnectionString;
        private async Task<(MySqlConnection conn, int user)> Open(CancellationToken ct)
        {
            var c = await DbGate.OpenAsync(ConnectionString, ct);
            try {
                await using var pre = new MySqlCommand("SET SESSION time_zone='+00:00', SESSION transaction_isolation='READ-COMMITTED', SESSION innodb_lock_wait_timeout=5", c);
                await pre.ExecuteNonQueryAsync(ct);
                await using var q = new MySqlCommand("SELECT user_id FROM app_user WHERE login_id=@id AND is_active=1", c);
                q.Parameters.AddWithValue("@id", _login);
                var u = await q.ExecuteScalarAsync(ct);
                if (u == null) throw new InvalidOperationException("활성 로그인 계정이 필요합니다.");
                return (c, Convert.ToInt32(u, CultureInfo.InvariantCulture));
            } catch { await c.DisposeAsync(); throw; }
        }
        internal async Task<List<object>> Categories()
        {
            using var ct = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            var (c, u) = await Open(ct.Token); await using var owned = c;
            await using var q = new MySqlCommand("SELECT c.uid,c.name FROM cal_category c LEFT JOIN project p ON p.uid=c.project_uid WHERE c.user_id=@u AND (c.source<>'db' OR p.is_active=1) ORDER BY c.sort_order,c.uid", c);
            q.Parameters.AddWithValue("@u", u); await using var r = await q.ExecuteReaderAsync(ct.Token);
            var rows = new List<object>(); while (await r.ReadAsync(ct.Token)) rows.Add(new { id = r.GetString(0), name = r.GetString(1) }); return rows;
        }
        internal async Task Prepare(AttendanceDocument d)
        {
            d.Validate();
            using var ct = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            var (c, u) = await Open(ct.Token); await using var owned = c;
            foreach (var line in d.Lines) {
                await using var q = new MySqlCommand("SELECT c.name FROM cal_category c LEFT JOIN project p ON p.uid=c.project_uid WHERE c.user_id=@u AND c.uid=@id AND (c.source<>'db' OR p.is_active=1)", c);
                q.Parameters.AddWithValue("@u", u); q.Parameters.AddWithValue("@id", line.CategoryId);
                line.Name = (await q.ExecuteScalarAsync(ct.Token)) as string ?? throw new InvalidOperationException("사용 가능한 내 과제를 다시 선택하세요.");
            }
        }
        // 본문과 시간 행은 한 트랜잭션이다. 실패 시 연결과 트랜잭션 폐기로 전체 롤백한다.
        internal async Task StoreConfirmed(AttendanceDocument d, AttendanceReceipt receipt)
        {
            if (receipt.State != "confirmed") throw new InvalidOperationException("회사 성공 확인 없이 DB에 기록할 수 없습니다.");
            d.Validate();
            using var ct = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            var (c,u) = await Open(ct.Token); await using var owned = c;
            await using var tx = await c.BeginTransactionAsync(ct.Token);
            MySqlCommand Q(string text) {
                var q = new MySqlCommand(text,c,tx); q.Parameters.AddWithValue("@u",u);
                q.Parameters.AddWithValue("@f",AttendanceDocument.Date(d.From)); q.Parameters.AddWithValue("@t",AttendanceDocument.Date(d.To));
                q.Parameters.AddWithValue("@j",d.Serialize()); q.Parameters.AddWithValue("@at",receipt.ConfirmedAt ?? DateTime.UtcNow); return q;
            }
            if (d.Kind == "daily") {
                await using (var q=Q("INSERT INTO cal_report_daily(user_id,work_date,status,overtime,content,sent_at,report_json) VALUES(@u,@f,@s,@o,@body,@at,@j) ON DUPLICATE KEY UPDATE status=VALUES(status),overtime=VALUES(overtime),content=VALUES(content),sent_at=VALUES(sent_at),report_json=VALUES(report_json)")) {
                    q.Parameters.AddWithValue("@s",d.Status); q.Parameters.AddWithValue("@o",d.Overtime);q.Parameters.AddWithValue("@body",d.WorkText);
                    await q.ExecuteNonQueryAsync(ct.Token);
                }
                await using (var q=Q("DELETE FROM cal_report_hours WHERE user_id=@u AND work_date=@f")) await q.ExecuteNonQueryAsync(ct.Token);
                // 기존 보고 규약대로 과거 시간 행의 과제 FK는 비워 둔다. 과제 삭제가 보고 이력을 막지 않는다.
                int n=0;
                foreach (var line in d.Lines) {
                    await using var q=Q("INSERT INTO cal_report_hours(user_id,work_date,line_no,task_name,cat_no,hours) VALUES(@u,@f,@n,@name,@cat,@h)");
                    q.Parameters.AddWithValue("@n",n++);q.Parameters.AddWithValue("@name",line.Name);q.Parameters.AddWithValue("@cat",DBNull.Value);q.Parameters.AddWithValue("@h",line.Hours);
                    await q.ExecuteNonQueryAsync(ct.Token);
                }
            } else {
                await using var q=Q("INSERT INTO cal_report_weekly(user_id,period_start,period_end,subject,content,endwork,plan,composed_at,submitted_at,report_json) VALUES(@u,@f,@t,@title,@hours,@work,@plan,@at,@at,@j) ON DUPLICATE KEY UPDATE period_end=VALUES(period_end),subject=VALUES(subject),content=VALUES(content),endwork=VALUES(endwork),plan=VALUES(plan),composed_at=VALUES(composed_at),submitted_at=VALUES(submitted_at),report_json=VALUES(report_json)");
                q.Parameters.AddWithValue("@title",d.Title);q.Parameters.AddWithValue("@hours",d.HoursText);q.Parameters.AddWithValue("@work",d.WorkText);q.Parameters.AddWithValue("@plan",d.PlanText);
                await q.ExecuteNonQueryAsync(ct.Token);
            }
            if (DbGate.Observe(await DbGate.ReadMetaAsync(c,tx,ct.Token)) != GateVerdict.Ok) throw new InvalidOperationException("DB 버전 관문이 닫혔습니다.");
            await tx.CommitAsync(ct.Token);
        }
        internal async Task<object?> Detail(AttendanceDocument d)
        {
            using var ct=new CancellationTokenSource(TimeSpan.FromSeconds(15));var(c,u)=await Open(ct.Token);await using var owned=c;
            string text=d.Kind=="daily" ? "SELECT report_json,content,sent_at FROM cal_report_daily WHERE user_id=@u AND work_date=@f" :
                "SELECT report_json,CONCAT(subject,'\\n',content,'\\n',endwork,'\\n',plan),COALESCE(submitted_at,composed_at) FROM cal_report_weekly WHERE user_id=@u AND period_start=@f AND period_end=@t";
            await using var q=new MySqlCommand(text,c);q.Parameters.AddWithValue("@u",u);q.Parameters.AddWithValue("@f",AttendanceDocument.Date(d.From));q.Parameters.AddWithValue("@t",AttendanceDocument.Date(d.To));
            await using var r=await q.ExecuteReaderAsync(ct.Token);if(!await r.ReadAsync(ct.Token))return null;
            return new{document=r.IsDBNull(0)?(JsonElement?)null:JsonSerializer.Deserialize<JsonElement>(r.GetString(0)),body=r.GetString(1),source=r.IsDBNull(0)?"legacy":"app",submittedAt=r.GetDateTime(2).ToString("O")+"Z"};
        }
        internal async Task<object> List(string kind,string from,string to,string search,int page)
        {
            if(kind!="daily"&&kind!="weekly")throw new ArgumentException("보고 종류를 확인하세요.");
            var a=AttendanceDocument.Date(from);var b=AttendanceDocument.Date(to);if(b<a)throw new ArgumentException("기간을 확인하세요.");if(search.Length>200)throw new ArgumentException("검색어는 200자 이내입니다.");
            using var ct=new CancellationTokenSource(TimeSpan.FromSeconds(20));var(c,u)=await Open(ct.Token);await using var owned=c;
            const string union="SELECT 'daily' AS kind,work_date AS period_start,work_date AS period_end,COALESCE(CAST(report_json AS CHAR),content) AS body,sent_at AS submitted_at,IF(report_json IS NULL,'legacy-sent','confirmed') AS state,IF(report_json IS NULL,'legacy','app') AS source FROM cal_report_daily WHERE user_id=@u "+
                "UNION ALL SELECT 'weekly',period_start,period_end,COALESCE(CAST(report_json AS CHAR),CONCAT(subject,'\\n',content,'\\n',endwork,'\\n',plan)),submitted_at,IF(submitted_at IS NULL,'legacy-composed','confirmed'),IF(report_json IS NULL,'legacy','app') FROM cal_report_weekly WHERE user_id=@u";
            string filter=" FROM ("+union+") h WHERE kind=@k AND period_start<=@t AND period_end>=@f AND (@s='' OR LOCATE(@s,body)>0 OR LOCATE(@s,CONCAT(period_start,' ~ ',period_end))>0)";
            MySqlCommand Q(string text){var q=new MySqlCommand(text,c);q.Parameters.AddWithValue("@u",u);q.Parameters.AddWithValue("@k",kind);q.Parameters.AddWithValue("@f",a);q.Parameters.AddWithValue("@t",b);q.Parameters.AddWithValue("@s",search);return q;}
            await using var count=Q("SELECT COUNT(*)"+filter);var total=Convert.ToInt32(await count.ExecuteScalarAsync(ct.Token));page=Math.Clamp(page,1,Math.Max(1,(total+19)/20));
            await using var query=Q("SELECT kind,period_start,period_end,body,submitted_at,state,source"+filter+" ORDER BY period_start DESC,period_end DESC LIMIT 20 OFFSET @off");query.Parameters.AddWithValue("@off",(page-1)*20);
            var rows=new List<object>();await using var r=await query.ExecuteReaderAsync(ct.Token);
            while(await r.ReadAsync(ct.Token))rows.Add(new{kind=r.GetString(0),from=r.GetDateTime(1).ToString("yyyy-MM-dd"),to=r.GetDateTime(2).ToString("yyyy-MM-dd"),body=r.GetString(3),submittedAt=r.IsDBNull(4)?null:r.GetDateTime(4).ToString("O")+"Z",state=r.GetString(5),source=r.GetString(6)});
            return new{rows,total,page,pageSize=20};
        }
    }
}
