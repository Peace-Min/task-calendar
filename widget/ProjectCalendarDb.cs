using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using MySqlConnector;

namespace TaskCalendarWidget
{
    // ================================================================================
    //  과제 캘린더(공용 트랙) 호스트: docs/PROJECT-CALENDAR-PLAN.md §5
    // ================================================================================
    //  공식 과제마다 공용 캘린더를 둔다. 표는 둘(cal_project_event, cal_project_change,
    //  정본 db/deploy/schema-calendar.sql 14~15)이고, 그 표의 SQL 규칙은 이 파일에만 있다. 과제별 감시점 표는 없다.
    //  개인 일정에 등록(복사)은 그 순간의 사본을 개인 일정 한 건으로 만들 뿐 대응표가 없다. 원본과 사본은 어느 쪽으로도 이어지지 않는다.
    //
    //  【명령 일곱】 MainWindow 의 메인 창에서만 온다(관리 창, 열람 창 허용 목록 밖). 회신은
    //    { ok, data?, error?: { kind, message } }. kind 는 forbidden, conflict, invalid 와 연결 분류(DbErrorKind).
    //
    //  【신원과 판정】
    //    - 사람은 세션(UserSession)의 login_id 로 app_user 에서 찾는다. 웹이 보낸 사용자 값은 읽지 않는다.
    //    - 비활성이거나 등록되지 않았으면 forbidden. edit_role 은 보지 않는다(공용 쓰기는 역할과 무관, §5.2).
    //    - "이 과제를 쓸 수 있나" 는 **EligibleProjectsAsync 하나**가 정한다: 그 과제가 내 과제(cal_category,
    //      source='db', project_uid)에 있다. 모든 명령이 이 함수만 부른다. 나중에 관리자 배정이 생기면
    //      이 함수만 고친다(§3.4).
    //    - 쓰기(저장, 삭제)는 그 위에 과제 is_active = 1. 숨긴 과제는 읽기 전용이고 개인 복사는 된다.
    //    - 보안 경계가 아니라 난간이다(공유 앱 계정이 DB 에 직접 붙는 지금 구조와 같은 수준, DB-RELEASE-OPS §0).
    //
    //  【트랜잭션 규칙】
    //    - 연결은 모두 DbGate.OpenAsync. 읽기는 REPEATABLE-READ 한 스냅샷, 쓰기는 READ-COMMITTED.
    //    - 공용 쓰기 트랜잭션은 판정(신원, 내 과제, 쓰기 가능)으로 시작한다(BeginSharedWriteAsync). 판정이 과제 행을 FOR SHARE 로
    //      잡고(관리자 종료, 영구 삭제와 엇갈리지 않게), 그다음 그 일정 행을 FOR UPDATE 로 잡는다.
    //      같은 일정의 저장과 삭제만 줄 서고, 다른 일정끼리는 막지 않는다(과제 행 공유 잠금끼리는 서로 막지 않는다).
    //    - 잠금 순서는 어디서나 과제 행, 일정 행, 그다음 cal_user_rev 다. 개인 복사: 과제 행(공유), 원본 일정 행(공유),
    //      cal_user_rev ODKU(§5.5). 휴지통 영구 삭제와 관리자 종료는 과제 행만 잠근다(일정 행을 먼저 잡지 않는다).
    //    - 과제 영구 삭제와 엇갈려 FK 1452/1451 이 나면 원문 대신 고정 문구 forbidden(MsgProjectGone).
    //    - 커밋은 CommitWithGateAsync 한 곳에서만 한다. 커밋 바로 앞에서 관문을 다시 읽는다(CalendarWriteDb 와 같은 규칙).
    //    - 멱등: 같은 (과제, mutationUid) 이력이 있으면 그 결과를 돌려준다. 생성은 같은 eventUid 가 있으면 같다.
    //    - 낙관적 잠금: row_version. 판이 다르면 conflict 와 최신 행. 자동 덮어쓰기는 없다.
    //    - 글자 상한(Limits)을 넘으면 자르지 않고 invalid.
    // ================================================================================
    internal sealed class ProjectCalendarDb
    {
        //  글자 상한. 화면(웹 상수), 이 호스트, DDL 칸 폭이 같은 숫자다(PROJECT-CALENDAR-PLAN §4.1).
        //  ★ 바꾸면 schema-calendar.sql 과 이관 조각의 칸 폭도 함께 바꾼다. tests/project-calendar-host.test.mjs 가 대조한다.
        //  ★ 세는 단위는 유니코드 글자(코드 포인트)다. MySQL VARCHAR(n) 이 세는 단위와 같다.
        internal static class Limits
        {
            public const int Title = 200;      // cal_project_event.title VARCHAR(200)
            public const int Location = 200;   // cal_project_event.location VARCHAR(200)
            public const int Name = 200;       // created_by_name, updated_by_name, actor_name, title_snapshot
            public const int Memo = 8000;      // cal_project_event.memo TEXT, 앱 상한
        }

        //  호스트가 채우는 error.kind 셋. 연결 오류는 DbErrorKind(network, auth, schema, gate, unknown)를 그대로 쓴다.
        internal static class Kind
        {
            public const string Forbidden = "forbidden";
            public const string Conflict = "conflict";
            public const string Invalid = "invalid";
        }

        //  명령 일곱. MainWindow 의 스위치와 시험이 이 이름을 쓴다. 참여자 명단(projectCalendarMembers)은 2026-10-23 에 더했다(기획 §6.9).
        internal static readonly string[] Commands =
        {
            "projectCalendarBootstrap", "projectCalendarLoad", "projectCalendarSave",
            "projectCalendarDelete", "projectCalendarChanges", "projectCalendarCopy",
            "projectCalendarMembers",
        };

        private readonly string _dataDir;
        private readonly Action<string> _log;

        public ProjectCalendarDb(string dataDir, Action<string> log)
        {
            _dataDir = dataDir;
            _log = log ?? (_ => { });
        }

        // ── 연결 ──────────────────────────────────────────────────────────────
        private static string BuildConnString() =>
            new MySqlConnectionStringBuilder
            {
                Server = DeployConfig.DbHost,
                Port = (uint)DeployConfig.DbPort,
                Database = DeployConfig.DbName,
                UserID = DeployConfig.DbUser,
                Password = DeployConfig.DbPassword,
                ConnectionTimeout = 4,
                DefaultCommandTimeout = 10,
                Pooling = false,
                //  '영향 행 0 = 충돌' 판정의 전제(CalendarWriteDb 와 같다). 값이 그대로인 UPDATE 도 1 로 센다.
                UseAffectedRows = false,
            }.ConnectionString;

        //  읽기: 여러 과제를 한 스냅샷으로 읽는다(START TRANSACTION WITH CONSISTENT SNAPSHOT 이 이 격리수준을 요구한다).
        //  쓰기: READ-COMMITTED. 두 상수를 합치지 않는다(CalendarDb, CalendarWriteDb 와 같은 값, 같은 이유).
        private const string ReadPreambleSql =
            "SET SESSION innodb_lock_wait_timeout=5, " +
            "SESSION time_zone='+00:00', " +
            "SESSION transaction_isolation='REPEATABLE-READ'";
        private const string WritePreambleSql =
            "SET SESSION innodb_lock_wait_timeout=5, " +
            "SESSION time_zone='+00:00', " +
            "SESSION transaction_isolation='READ-COMMITTED'";

        //  "이 과제를 쓸 수 있나" 의 유일한 판정 SQL(§3.2). 내 과제에 넣은 공식 과제 = 과제 탭의 과제.
        private const string EligibleSql =
            "SELECT p.id, p.uid, p.project_name, p.common_name, p.is_active, p.section_id, " +
            "IFNULL(cu.name, '') AS customer_name, c.uid AS cat_uid, c.color, c.cat_no " +
            "FROM cal_category c JOIN project p ON p.uid = c.project_uid " +
            "LEFT JOIN customer cu ON cu.customer_id = p.customer_id " +
            "WHERE c.user_id=@me AND c.source='db'";

        private const string EventCols =
            "e.event_id, e.uid, p.uid AS project_uid, e.project_id, e.title, " +
            "DATE_FORMAT(e.start_date, '%Y-%m-%d') AS sd, DATE_FORMAT(COALESCE(e.end_date, e.start_date), '%Y-%m-%d') AS ed, " +
            "TIME_FORMAT(e.start_time, '%H:%i') AS st, TIME_FORMAT(e.end_time, '%H:%i') AS et, " +
            "e.location, e.memo, e.row_version, e.is_deleted, e.created_by_name, e.updated_by_name, e.created_at, e.updated_at";

        // ── 내부 형 ───────────────────────────────────────────────────────────
        private sealed class Me { public int UserId; public string Name = ""; }

        private sealed class Proj
        {
            public uint Id; public string Uid = ""; public string ProjectName = ""; public string CommonName = "";
            public bool Active; public int SectionId; public string Customer = ""; public string CatUid = ""; public string Color = "";
            public string Display => CommonName.Length > 0 ? CommonName : ProjectName;
        }

        //  한 일정의 값(웹 DTO 와 같은 모양). 종료일은 포함이고 하루 일정이면 시작일과 같다. 시각은 HH:mm 또는 null.
        private sealed class Fields
        {
            public string Title = ""; public string StartDate = ""; public string EndDate = "";
            public string? StartTime; public string? EndTime; public string Location = ""; public string Memo = "";
        }

        private sealed class Ev
        {
            public uint EventId; public string Uid = ""; public string ProjectUid = ""; public uint ProjectId;
            public Fields F = new Fields(); public long RowVersion; public bool Deleted;
            public string CreatedBy = ""; public string UpdatedBy = ""; public DateTime CreatedAt; public DateTime UpdatedAt;
        }

        //  안에서 멈출 때 던진다. 바깥 HandleAsync 가 롤백 뒤 회신으로 바꾼다.
        private sealed class PcFail : Exception
        {
            public string Kind { get; }
            public object? Payload { get; }
            public PcFail(string kind, string message, object? payload = null) : base(message) { Kind = kind; Payload = payload; }
        }

        // ── 고정 문구(사용자에게 그대로 보인다) ─────────────────────────────────
        internal const string MsgNoSession = "로그인이 필요합니다.";
        internal const string MsgUnregistered = "사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요.";
        internal const string MsgInactiveUser = "비활성 처리된 계정입니다.";
        internal const string MsgNotMine = "내 과제에 없는 과제입니다. 내 과제에 공식 과제를 넣으면 과제 캘린더를 쓸 수 있습니다.";
        internal const string MsgReadOnly = "종료되었거나 숨긴 과제라 읽기 전용입니다.";
        internal const string MsgConflict = "다른 사람이 먼저 고쳤습니다. 최신 내용을 확인한 뒤 다시 저장하세요.";
        internal const string MsgGone = "이미 지워졌거나 없는 일정입니다.";
        internal const string MsgOtherProject = "다른 과제의 일정입니다.";
        internal const string MsgBusy = "다른 저장과 겹쳤습니다. 잠시 뒤 다시 시도하세요.";
        //  쓰는 사이 과제가 영구 삭제되었거나(FK 1452) 지우려는 쪽과 엇갈렸다(1451). 원문 오류 대신 이 문장으로 거부한다.
        internal const string MsgProjectGone = "과제가 지워졌거나 내 과제에서 빠져 저장하지 못했습니다. 과제 목록을 다시 읽으세요.";

        private static readonly JsonSerializerOptions JsonOpt = new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,   // 이력의 한글을 사람이 읽을 수 있게 둔다
        };

        // ================================================================================
        //  입구: 명령 이름과 웹 메시지 원문을 받아 회신을 만든다
        // ================================================================================
        public async Task<ProjectCalendarReply> HandleAsync(string cmd, string rawJson)
        {
            try
            {
                using var doc = JsonDocument.Parse(string.IsNullOrEmpty(rawJson) ? "{}" : rawJson);
                var q = doc.RootElement;
                if (q.ValueKind != JsonValueKind.Object) throw new PcFail(Kind.Invalid, "요청 형식이 잘못되었습니다.");
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
                var ct = cts.Token;
                switch (cmd)
                {
                    case "projectCalendarBootstrap": return ProjectCalendarReply.Success(await BootstrapAsync(ct));
                    case "projectCalendarLoad":      return ProjectCalendarReply.Success(await LoadAsync(q, ct));
                    case "projectCalendarSave":      return ProjectCalendarReply.Success(await SaveAsync(q, ct));
                    case "projectCalendarDelete":    return ProjectCalendarReply.Success(await DeleteAsync(q, ct));
                    case "projectCalendarChanges":   return ProjectCalendarReply.Success(await ChangesAsync(q, ct));
                    case "projectCalendarCopy":
                    {
                        //  성공하면 늘 새 개인 일정 한 건이 생긴다. MainWindow 가 개인 스냅샷을 다시 읽는다.
                        var r = ProjectCalendarReply.Success(await CopyAsync(q, ct));
                        r.ReloadPersonal = true;
                        return r;
                    }
                    case "projectCalendarMembers":   return ProjectCalendarReply.Success(await MembersAsync(q, ct));
                    default: throw new PcFail(Kind.Invalid, "알 수 없는 요청입니다.");
                }
            }
            catch (PcFail f)
            {
                _log("과제 캘린더 " + cmd + " 거부(" + f.Kind + "): " + f.Message);
                return ProjectCalendarReply.Failure(f.Kind, f.Message, f.Payload);
            }
            catch (JsonException)
            {
                return ProjectCalendarReply.Failure(Kind.Invalid, "요청 형식이 잘못되었습니다.");
            }
            catch (DbGateException gx)
            {
                _log("과제 캘린더 " + cmd + " 관문 차단: " + gx.Message);
                return ProjectCalendarReply.Failure(DbErrorKind.Gate, DbErrors.ConnMessage(DbErrorKind.Gate));
            }
            catch (Exception fx) when (DbErrors.Number(fx) == 1452 || DbErrors.Number(fx) == 1451)
            {
                //  과제 영구 삭제(휴지통)와 엇갈렸다. 트랜잭션은 이미 롤백했다. 원문 오류를 보이지 않고 고정 문구로 거부한다.
                _log("과제 캘린더 " + cmd + " 거부(FK " + DbErrors.Number(fx) + ", 과제가 사라짐): " + fx.Message);
                return ProjectCalendarReply.Failure(Kind.Forbidden, MsgProjectGone);
            }
            catch (Exception ex)
            {
                var (kind, detail) = DbErrors.Observe(ex, _log);
                int n = DbErrors.Number(ex);
                _log("과제 캘린더 " + cmd + " 실패(" + kind + ", " + n + "): " + detail);
                string msg = (n == 1205 || n == 1213) ? MsgBusy : DbErrors.ConnMessage(kind);
                return ProjectCalendarReply.Failure(kind, msg);
            }
        }

        // ================================================================================
        //  판정 함수 하나(§3.2): 이 사람의 과제 탭 과제
        // ================================================================================
        //  onlyUid 가 있으면 그 과제 하나만 본다(없으면 빈 목록). 쓰기 가능 여부는 Proj.Active 다.
        //  lockProject: 같은 판정 SQL 에 FOR SHARE OF p 를 붙여 **과제 행만** 공유 잠금한다(쓰기 트랜잭션 안에서만).
        //    관리자의 종료(UPDATE project SET is_active)와 휴지통 영구 삭제(DELETE project)가 진행 중인 공용 쓰기와
        //    엇갈리지 않게 한다. MySQL 8 의 FOR SHARE 는 SELECT 에 더해 UPDATE(또는 DELETE, LOCK TABLES) 권한이 필요한데
        //    앱 계정은 project 에 SELECT, INSERT, UPDATE, DELETE 가 있다(server-app-account.sql, create-app-user.sql).
        private static async Task<List<Proj>> EligibleProjectsAsync(MySqlConnection conn, MySqlTransaction? tx, int userId,
            string? onlyUid, CancellationToken ct, bool lockProject = false)
        {
            var list = new List<Proj>();
            string sql = EligibleSql + (onlyUid != null ? " AND p.uid=@pu" : "") + " ORDER BY c.sort_order, c.cat_no"
                + (lockProject ? " FOR SHARE OF p" : "");
            await using var cmd = new MySqlCommand(sql, conn, tx);
            cmd.Parameters.AddWithValue("@me", userId);
            if (onlyUid != null) cmd.Parameters.AddWithValue("@pu", onlyUid);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            while (await rd.ReadAsync(ct))
            {
                var p = new Proj
                {
                    Id = Convert.ToUInt32(rd["id"], CultureInfo.InvariantCulture),
                    Uid = Str(rd, "uid"),
                    ProjectName = Str(rd, "project_name"),
                    CommonName = Str(rd, "common_name"),
                    Active = Convert.ToInt32(rd["is_active"], CultureInfo.InvariantCulture) == 1,
                    SectionId = Convert.ToInt32(rd["section_id"], CultureInfo.InvariantCulture),
                    Customer = Str(rd, "customer_name"),
                    CatUid = Str(rd, "cat_uid"),
                    Color = Str(rd, "color"),
                };
                if (seen.Add(p.Uid)) list.Add(p);
            }
            return list;
        }

        //  한 과제를 쓸 수 있는지(없으면 forbidden). write 면 숨긴 과제도 거부한다. lockProject 는 위 함수 주석.
        private static async Task<Proj> RequireProjectAsync(MySqlConnection conn, MySqlTransaction? tx, Me me, string projectUid,
            bool write, CancellationToken ct, bool lockProject = false)
        {
            var ps = await EligibleProjectsAsync(conn, tx, me.UserId, projectUid, ct, lockProject);
            if (ps.Count == 0) throw new PcFail(Kind.Forbidden, MsgNotMine);
            if (write && !ps[0].Active) throw new PcFail(Kind.Forbidden, MsgReadOnly);
            return ps[0];
        }

        // ── 신원: 세션의 login_id 로 app_user(활성)를 찾는다. 웹 값은 쓰지 않는다 ─────────
        private string SessionLoginId()
        {
            var s = UserSession.Load(_dataDir, _log);
            if (s == null || s.LoginId.Length == 0) throw new PcFail(Kind.Forbidden, MsgNoSession);
            return s.LoginId;
        }

        private static async Task<Me> IdentityAsync(MySqlConnection conn, MySqlTransaction? tx, string loginId, CancellationToken ct)
        {
            await using var cmd = new MySqlCommand("SELECT user_id, name, is_active FROM app_user WHERE login_id=@id", conn, tx);
            cmd.Parameters.AddWithValue("@id", loginId);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            if (!await rd.ReadAsync(ct)) throw new PcFail(Kind.Forbidden, MsgUnregistered);
            if (Convert.ToInt32(rd["is_active"], CultureInfo.InvariantCulture) != 1) throw new PcFail(Kind.Forbidden, MsgInactiveUser);
            return new Me { UserId = Convert.ToInt32(rd["user_id"], CultureInfo.InvariantCulture), Name = Str(rd, "name") };
        }

        // ── 연결 열기 ──────────────────────────────────────────────────────────
        private static async Task<MySqlConnection> OpenAsync(string preamble, CancellationToken ct)
        {
            var conn = await DbGate.OpenAsync(BuildConnString(), ct);
            try { await Exec(conn, null, preamble, ct); }
            catch { await conn.DisposeAsync(); throw; }
            return conn;
        }

        //  읽기 한 스냅샷. 끝나면 커밋 대신 닫는다(읽기 전용).
        private static async Task<MySqlConnection> OpenReadSnapshotAsync(CancellationToken ct)
        {
            var conn = await OpenAsync(ReadPreambleSql, ct);
            try { await Exec(conn, null, "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY", ct); }
            catch { await conn.DisposeAsync(); throw; }
            return conn;
        }

        //  공용 쓰기 트랜잭션을 연다. ★ 트랜잭션의 첫 문장들은 판정이다: 활성 사용자(IdentityAsync), 그다음 그 과제가 내 과제에
        //  있고 쓸 수 있음(RequireProjectAsync, write: true = 과제 is_active 1). 그 앞에 다른 문장을 두지 않는다.
        //  과제별 감시점 표는 없다(2026-10-22 저녁 결정). 동시 수정은 일정 행 FOR UPDATE 와 row_version, 재시도는 이력의
        //  (project_id, mutation_uid) UNIQUE 와 일정 uid UNIQUE, 과제 영구 삭제와의 경합은 FK RESTRICT(1452 는 MsgProjectGone)가 맡는다.
        //  반환: 트랜잭션, 나, 과제. 거부면 forbidden(롤백).
        private static async Task<(MySqlTransaction tx, Me me, Proj proj)> BeginSharedWriteAsync(
            MySqlConnection conn, string login, string projectUid, CancellationToken ct)
        {
            var tx = await conn.BeginTransactionAsync(ct);
            try
            {
                var me = await IdentityAsync(conn, tx, login, ct);
                //  잠금 1: 과제 행(공유). 커밋까지 관리자 종료와 영구 삭제가 끼어들지 못한다. 잠금 순서는 어디서나 과제 행 다음 일정 행이다.
                var proj = await RequireProjectAsync(conn, tx, me, projectUid, write: true, ct, lockProject: true);
                CheckName(me.Name);
                return (tx, me, proj);
            }
            catch { await SafeRollbackAsync(tx); await tx.DisposeAsync(); throw; }
        }

        //  커밋은 여기 한 곳. 바로 앞에서 관문을 잠금 없이 다시 읽고(READ-COMMITTED 라 방금 커밋된 값이 보인다)
        //  막혔으면 통째로 롤백한다(VERSION-GATE §2.2, CalendarWriteDb 11번과 같은 규칙).
        private async Task CommitWithGateAsync(MySqlConnection conn, MySqlTransaction tx, CancellationToken ct)
        {
            var gateMeta = await DbGate.ReadMetaAsync(conn, tx, ct);
            if (DbGate.Observe(gateMeta) != GateVerdict.Ok)
            {
                await SafeRollbackAsync(tx);
                _log("과제 캘린더 쓰기 중단(버전 관문, 커밋 직전): " + (DbGate.Last?.State ?? "unknown") + ", 롤백");
                throw new DbGateException(DbGate.Last?.Verdict ?? GateVerdict.Unknown, gateMeta);
            }
            await tx.CommitAsync(ct);
        }

        private static async Task SafeRollbackAsync(MySqlTransaction tx)
        {
            try { await tx.RollbackAsync(CancellationToken.None); } catch { /* 연결을 닫으면 서버가 어차피 롤백한다 */ }
        }

        // ================================================================================
        //  1. projectCalendarBootstrap: 과제 탭 과제 목록, 참여자 수, 글자 상한
        // ================================================================================
        private async Task<object> BootstrapAsync(CancellationToken ct)
        {
            string login = SessionLoginId();
            await using var conn = await OpenReadSnapshotAsync(ct);
            var me = await IdentityAsync(conn, null, login, ct);
            var ps = await EligibleProjectsAsync(conn, null, me.UserId, null, ct);

            //  참여자 수 = 그 과제를 내 과제에 넣은 활성 사용자 수(§3.2)
            var members = new Dictionary<string, long>(StringComparer.Ordinal);
            if (ps.Count > 0)
            {
                var (inSql, inPs) = InList("@u", ps.ConvertAll(p => (object)p.Uid));
                await using var cmd = new MySqlCommand(
                    "SELECT c.project_uid, COUNT(DISTINCT c.user_id) AS n FROM cal_category c " +
                    "JOIN app_user u ON u.user_id = c.user_id AND u.is_active = 1 " +
                    "WHERE c.source='db' AND c.project_uid IN (" + inSql + ") GROUP BY c.project_uid", conn);
                foreach (var (k, v) in inPs) cmd.Parameters.AddWithValue(k, v);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct)) members[Str(rd, "project_uid")] = Convert.ToInt64(rd["n"], CultureInfo.InvariantCulture);
            }

            var projects = new List<object>();
            foreach (var p in ps)
                projects.Add(new Dictionary<string, object?>
                {
                    ["projectUid"] = p.Uid,
                    ["categoryUid"] = p.CatUid,
                    ["name"] = p.Display,
                    ["projectName"] = p.ProjectName,
                    ["commonName"] = p.CommonName,
                    ["customer"] = p.Customer,
                    ["sectionId"] = p.SectionId,
                    ["color"] = p.Color,
                    ["active"] = p.Active,
                    ["writable"] = p.Active,
                    ["members"] = members.TryGetValue(p.Uid, out var mc) ? mc : 0L,
                });
            return new Dictionary<string, object?>
            {
                ["projects"] = projects,
                ["limits"] = new Dictionary<string, object?> { ["title"] = Limits.Title, ["location"] = Limits.Location, ["memo"] = Limits.Memo },
            };
        }

        // ================================================================================
        //  2. projectCalendarLoad: { projectUids, from, to } → 쓸 수 있는 과제의 범위 일정과 쓰기 가능 여부
        // ================================================================================
        //  판정에서 빠진 과제는 오류가 아니라 excluded 로 알린다(화면 목록이 낡았을 수 있다).
        private async Task<object> LoadAsync(JsonElement q, CancellationToken ct)
        {
            var uids = UidList(q, "projectUids");
            string from = ReqDate(q, "from"), to = ReqDate(q, "to");
            if (string.CompareOrdinal(from, to) > 0) throw new PcFail(Kind.Invalid, "기간의 시작이 끝보다 늦습니다.");
            if ((ParseDate(to) - ParseDate(from)).TotalDays > 731) throw new PcFail(Kind.Invalid, "한 번에 읽는 기간이 너무 깁니다.");

            string login = SessionLoginId();
            await using var conn = await OpenReadSnapshotAsync(ct);
            var me = await IdentityAsync(conn, null, login, ct);
            var mine = await EligibleProjectsAsync(conn, null, me.UserId, null, ct);
            var byUid = new Dictionary<string, Proj>(StringComparer.Ordinal);
            foreach (var p in mine) byUid[p.Uid] = p;
            var take = new List<Proj>();
            var excluded = new List<string>();
            foreach (var u in uids) { if (byUid.TryGetValue(u, out var p)) take.Add(p); else excluded.Add(u); }

            var events = new List<object>();
            if (take.Count > 0)
            {
                string ids = string.Join(",", take.ConvertAll(p => p.Id.ToString(CultureInfo.InvariantCulture)));
                await using var cmd = new MySqlCommand(
                    "SELECT " + EventCols + " FROM cal_project_event e JOIN project p ON p.id = e.project_id " +
                    "WHERE e.project_id IN (" + ids + ") AND e.is_deleted = 0 " +
                    "AND e.start_date <= @to AND COALESCE(e.end_date, e.start_date) >= @from " +
                    "ORDER BY e.start_date, e.uid", conn);
                cmd.Parameters.AddWithValue("@from", from);
                cmd.Parameters.AddWithValue("@to", to);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct)) events.Add(EventDto(ReadEvent(rd)));
            }
            var projects = new List<object>();
            foreach (var p in take)
                projects.Add(new Dictionary<string, object?> { ["projectUid"] = p.Uid, ["writable"] = p.Active });
            return new Dictionary<string, object?> { ["projects"] = projects, ["events"] = events, ["excluded"] = excluded, ["from"] = from, ["to"] = to };
        }

        // ================================================================================
        //  3. projectCalendarSave: { projectUid, eventUid, expectedVersion?, mutationUid, event }
        // ================================================================================
        //  expectedVersion 이 없으면 생성, 있으면 수정. 수정할 때 과제는 바꿀 수 없다(다른 과제의 일정이면 invalid).
        private async Task<object> SaveAsync(JsonElement q, CancellationToken ct)
        {
            string projectUid = ReqUid(q, "projectUid", "과제");
            string eventUid = ReqClientId(q, "eventUid", "일정 id");
            string mutationUid = ReqClientId(q, "mutationUid", "변경 id");
            long? expected = OptVersion(q, "expectedVersion");
            if (!q.TryGetProperty("event", out var evEl) || evEl.ValueKind != JsonValueKind.Object)
                throw new PcFail(Kind.Invalid, "저장할 일정이 없습니다.");
            var f = ValidateFields(evEl);   // 글자 상한, 날짜, 시각. 넘으면 자르지 않고 invalid

            string login = SessionLoginId();
            string now = NowDb();
            await using var conn = await OpenAsync(WritePreambleSql, ct);
            var (tx, me, proj) = await BeginSharedWriteAsync(conn, login, projectUid, ct);
            uint projectId = proj.Id;
            await using var txOwn = tx;
            try
            {
                //  수정은 그 일정 행을 먼저 잡는다(같은 일정의 저장과 삭제를 줄 세운다). 기다린 뒤의 아래 읽기는 READ-COMMITTED 라
                //  앞선 저장이 커밋한 이력까지 보인다(같은 변경 id 의 동시 재시도가 두 번 적히지 않는다).
                //  ★ 생성은 잠그지 않고 읽는다. 아직 없는 uid 를 FOR UPDATE 로 읽으면 uid 색인의 빈틈이 잠기고, 같은 빈틈에
                //    동시에 넣는 두 생성(uid 가 달라도)이 서로의 빈틈을 기다리다 교착한다(1213, 2026-10-22 실 DB 시험).
                //    생성의 중복은 아래 INSERT 의 uid UNIQUE(1062)가 막고, 그때 커밋된 행을 재시도 결과로 돌려준다.
                var cur = expected == null
                    ? await EventWhereAsync(conn, tx, "e.uid=@uid", ct, P("@uid", eventUid))
                    : await EventByUidForUpdateAsync(conn, tx, eventUid, ct);

                //  멱등: 같은 변경 id 가 이미 적혔으면(응답만 잃은 재시도) 그 결과를 돌려준다
                var replay = await ReplayAsync(conn, tx, projectId, mutationUid, ct);
                if (replay != null) { await SafeRollbackAsync(tx); return SaveData(replay, replayed: true); }

                if (expected == null)
                {
                    //  생성. 같은 uid 가 이 과제에 이미 있으면 재시도로 본다(4번과 같게).
                    if (cur != null)
                    {
                        if (cur.ProjectId != projectId) throw new PcFail(Kind.Invalid, MsgOtherProject);
                        await SafeRollbackAsync(tx);
                        return SaveData(cur, replayed: true);
                    }
                    try
                    {
                        await Exec(conn, tx,
                            "INSERT INTO cal_project_event (uid, project_id, title, start_date, end_date, start_time, end_time, location, memo, " +
                            "row_version, is_deleted, created_by_name, updated_by_name, created_at, updated_at, deleted_at) " +
                            "VALUES (@uid, @p, @t, @sd, @ed, @st, @et, @loc, @memo, 1, 0, @who, @who, @now, @now, NULL)", ct,
                            FieldParams(f, P("@uid", eventUid), P("@p", projectId), P("@who", me.Name), P("@now", now)));
                    }
                    catch (MySqlException dx) when (dx.Number == 1062)
                    {
                        //  같은 uid 의 동시 재시도가 먼저 커밋했다(uid UNIQUE). 그 문장만 취소되므로 커밋된 행을 다시 읽어 재시도로 돌려준다.
                        var won = await EventByUidForUpdateAsync(conn, tx, eventUid, ct);
                        if (won == null || won.ProjectId != projectId) throw new PcFail(Kind.Invalid, MsgOtherProject);
                        await SafeRollbackAsync(tx);
                        return SaveData(won, replayed: true);
                    }
                    var made = await EventByUidForUpdateAsync(conn, tx, eventUid, ct) ?? throw new InvalidOperationException("방금 넣은 일정을 읽지 못했다");
                    await InsertChangeAsync(conn, tx, projectId, made.EventId, mutationUid, "create", me.Name, f.Title, null, FieldMap(f, null), now, ct);
                    await CommitWithGateAsync(conn, tx, ct);
                    _log("과제 일정 생성: " + projectUid + " " + eventUid);
                    return SaveData(made, replayed: false);
                }

                //  수정
                if (cur == null) throw new PcFail(Kind.Conflict, MsgGone, ConflictData(null));
                if (cur.ProjectId != projectId) throw new PcFail(Kind.Invalid, MsgOtherProject);
                if (cur.Deleted || cur.RowVersion != expected.Value) throw new PcFail(Kind.Conflict, cur.Deleted ? MsgGone : MsgConflict, ConflictData(cur));
                var changed = FieldMap(f, cur.F);
                if (changed.Count == 0)
                {
                    //  바뀐 것이 없는 저장은 아무것도 쓰지 않는다(이력 행도, 판도). 지금 행을 그대로 돌려준다.
                    await SafeRollbackAsync(tx);
                    var same = (Dictionary<string, object?>)SaveData(cur, replayed: false);
                    same["unchanged"] = true;
                    return same;
                }
                int n = await Exec(conn, tx,
                    "UPDATE cal_project_event SET title=@t, start_date=@sd, end_date=@ed, start_time=@st, end_time=@et, location=@loc, memo=@memo, " +
                    "row_version = row_version + 1, updated_by_name=@who, updated_at=@now " +
                    "WHERE event_id=@e AND row_version=@exp AND is_deleted=0", ct,
                    FieldParams(f, P("@e", cur.EventId), P("@exp", expected.Value), P("@who", me.Name), P("@now", now)));
                if (n == 0) throw new PcFail(Kind.Conflict, MsgConflict, ConflictData(await EventByUidForUpdateAsync(conn, tx, eventUid, ct)));
                await InsertChangeAsync(conn, tx, projectId, cur.EventId, mutationUid, "update", me.Name, f.Title, FieldMap(cur.F, f), changed, now, ct);
                var after = await EventByUidForUpdateAsync(conn, tx, eventUid, ct) ?? throw new InvalidOperationException("방금 고친 일정을 읽지 못했다");
                await CommitWithGateAsync(conn, tx, ct);
                _log("과제 일정 수정: " + projectUid + " " + eventUid + " v" + after.RowVersion);
                return SaveData(after, replayed: false);
            }
            catch { await SafeRollbackAsync(tx); throw; }
        }

        // ================================================================================
        //  4. projectCalendarDelete: { projectUid, eventUid, expectedVersion, mutationUid } → 소프트 삭제
        // ================================================================================
        private async Task<object> DeleteAsync(JsonElement q, CancellationToken ct)
        {
            string projectUid = ReqUid(q, "projectUid", "과제");
            string eventUid = ReqClientId(q, "eventUid", "일정 id");
            string mutationUid = ReqClientId(q, "mutationUid", "변경 id");
            long expected = OptVersion(q, "expectedVersion") ?? throw new PcFail(Kind.Invalid, "지울 일정의 판(expectedVersion)이 없습니다.");

            string login = SessionLoginId();
            string now = NowDb();
            await using var conn = await OpenAsync(WritePreambleSql, ct);
            var (tx, me, proj) = await BeginSharedWriteAsync(conn, login, projectUid, ct);
            uint projectId = proj.Id;
            await using var txOwn = tx;
            try
            {
                //  일정 행을 먼저 잡고(저장과 같은 순서) 그다음 같은 변경 id 의 재시도인지 본다
                var cur = await EventByUidForUpdateAsync(conn, tx, eventUid, ct);
                var replay = await ReplayAsync(conn, tx, projectId, mutationUid, ct);
                if (replay != null) { await SafeRollbackAsync(tx); return DeleteData(replay, replayed: true); }

                if (cur == null) throw new PcFail(Kind.Conflict, MsgGone, ConflictData(null));
                if (cur.ProjectId != projectId) throw new PcFail(Kind.Invalid, MsgOtherProject);
                if (cur.Deleted || cur.RowVersion != expected) throw new PcFail(Kind.Conflict, cur.Deleted ? MsgGone : MsgConflict, ConflictData(cur));
                int n = await Exec(conn, tx,
                    "UPDATE cal_project_event SET is_deleted=1, deleted_at=@now, row_version = row_version + 1, updated_by_name=@who, updated_at=@now " +
                    "WHERE event_id=@e AND row_version=@exp AND is_deleted=0", ct,
                    P("@e", cur.EventId), P("@exp", expected), P("@who", me.Name), P("@now", now));
                if (n == 0) throw new PcFail(Kind.Conflict, MsgConflict, ConflictData(await EventByUidForUpdateAsync(conn, tx, eventUid, ct)));
                //  지운 일정의 제목은 title_snapshot 에 남는다. 앞 값은 모든 필드를 담는다(delete 는 before 만).
                await InsertChangeAsync(conn, tx, projectId, cur.EventId, mutationUid, "delete", me.Name, cur.F.Title, FieldMap(cur.F, null), null, now, ct);
                var after = await EventByUidForUpdateAsync(conn, tx, eventUid, ct) ?? throw new InvalidOperationException("방금 지운 일정을 읽지 못했다");
                await CommitWithGateAsync(conn, tx, ct);
                _log("과제 일정 삭제: " + projectUid + " " + eventUid);
                return DeleteData(after, replayed: false);
            }
            catch { await SafeRollbackAsync(tx); throw; }
        }

        // ================================================================================
        //  5. projectCalendarChanges: { projectUids, changedFrom?, changedTo?, kind?, cursor?, limit? }
        // ================================================================================
        //  최근 변경. 새것부터(changed_at, change_no 내림차순). 묶기(과제별, 날짜순, 일정별)는 웹이 한다.
        //  kind: all(기본), create, update, delete(PROJECT-CALENDAR-PLAN §6.6 의 종류 필터. 옛 이름 fieldFilter 도 받는다).
        //  cursor: 앞 회신의 nextCursor { changedAt, changeNo }. 그보다 오래된 것을 준다.
        private async Task<object> ChangesAsync(JsonElement q, CancellationToken ct)
        {
            var uids = UidList(q, "projectUids");
            string? fromAt = OptInstant(q, "changedFrom"), toAt = OptInstant(q, "changedTo");
            string kind = Str(q, "kind");
            if (kind.Length == 0) kind = Str(q, "fieldFilter");
            if (kind.Length == 0) kind = "all";
            if (kind != "all" && kind != "create" && kind != "update" && kind != "delete")
                throw new PcFail(Kind.Invalid, "변경 종류는 all, create, update, delete 중 하나입니다.");
            int limit = 50;
            if (q.TryGetProperty("limit", out var lim) && lim.ValueKind == JsonValueKind.Number && lim.TryGetInt32(out int li)) limit = li;
            if (limit < 1 || limit > 200) throw new PcFail(Kind.Invalid, "한 번에 1건에서 200건까지 읽습니다.");
            string? curAt = null; long curNo = 0;
            if (q.TryGetProperty("cursor", out var cur) && cur.ValueKind == JsonValueKind.Object)
            {
                curAt = OptInstant(cur, "changedAt") ?? throw new PcFail(Kind.Invalid, "커서 형식이 잘못되었습니다.");
                if (!(cur.TryGetProperty("changeNo", out var cn) && cn.ValueKind == JsonValueKind.Number && cn.TryGetInt64(out curNo) && curNo > 0))
                    throw new PcFail(Kind.Invalid, "커서 형식이 잘못되었습니다.");
            }

            string login = SessionLoginId();
            await using var conn = await OpenReadSnapshotAsync(ct);
            var me = await IdentityAsync(conn, null, login, ct);
            var mine = await EligibleProjectsAsync(conn, null, me.UserId, null, ct);
            var byUid = new Dictionary<string, Proj>(StringComparer.Ordinal);
            foreach (var p in mine) byUid[p.Uid] = p;
            var take = new List<Proj>();
            var excluded = new List<string>();
            foreach (var u in uids) { if (byUid.TryGetValue(u, out var p)) take.Add(p); else excluded.Add(u); }

            var rows = new List<object>();
            bool more = false;
            object? next = null;
            if (take.Count > 0)
            {
                string ids = string.Join(",", take.ConvertAll(p => p.Id.ToString(CultureInfo.InvariantCulture)));
                string sql =
                    "SELECT c.change_no, c.action, c.actor_name, c.title_snapshot, c.before_json, c.after_json, c.changed_at, " +
                    "e.uid AS event_uid, p.uid AS project_uid FROM cal_project_change c " +
                    "JOIN cal_project_event e ON e.event_id = c.event_id JOIN project p ON p.id = c.project_id " +
                    "WHERE c.project_id IN (" + ids + ")" +
                    (kind != "all" ? " AND c.action=@act" : "") +
                    (fromAt != null ? " AND c.changed_at >= @from" : "") +
                    (toAt != null ? " AND c.changed_at < @to" : "") +
                    (curAt != null ? " AND (c.changed_at < @cat OR (c.changed_at = @cat AND c.change_no < @cno))" : "") +
                    " ORDER BY c.changed_at DESC, c.change_no DESC LIMIT " + (limit + 1).ToString(CultureInfo.InvariantCulture);
                await using var cmd = new MySqlCommand(sql, conn);
                if (kind != "all") cmd.Parameters.AddWithValue("@act", kind);
                if (fromAt != null) cmd.Parameters.AddWithValue("@from", fromAt);
                if (toAt != null) cmd.Parameters.AddWithValue("@to", toAt);
                if (curAt != null) { cmd.Parameters.AddWithValue("@cat", curAt); cmd.Parameters.AddWithValue("@cno", curNo); }
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    if (rows.Count == limit) { more = true; break; }
                    long no = Convert.ToInt64(rd["change_no"], CultureInfo.InvariantCulture);
                    var at = (DateTime)rd["changed_at"];
                    rows.Add(new Dictionary<string, object?>
                    {
                        ["changeNo"] = no,
                        ["projectUid"] = Str(rd, "project_uid"),
                        ["eventUid"] = Str(rd, "event_uid"),
                        ["action"] = Str(rd, "action"),
                        ["actor"] = Str(rd, "actor_name"),
                        ["title"] = Str(rd, "title_snapshot"),
                        ["before"] = JsonOrNull(rd, "before_json"),
                        ["after"] = JsonOrNull(rd, "after_json"),
                        ["changedAt"] = Iso(at),
                    });
                    next = new Dictionary<string, object?> { ["changedAt"] = Iso(at), ["changeNo"] = no };
                }
            }
            return new Dictionary<string, object?>
            {
                ["rows"] = rows, ["hasMore"] = more, ["nextCursor"] = more ? next : null, ["excluded"] = excluded,
            };
        }

        // ================================================================================
        //  6. projectCalendarCopy: { projectUid, eventUid, expectedVersion?, mutationUid } → 개인 일정 한 건
        // ================================================================================
        //  §5.5. 잠금 순서: 과제 행(공유), 원본 일정 행(공유), cal_user_rev(배타). 개인 저장은 cal_user_rev 만, 공용 쓰기는
        //  과제 행 다음 일정 행만 잡으므로 순환이 없다. 공용 이력에는 남기지 않는다.
        //  ★ 한 번 찍는 사본이다(2026-10-22 저녁 결정). 대응표가 없고 "이미 복사했나" 를 보지 않는다. 부를 때마다
        //    새 개인 일정 한 건을 만든다. 만든 뒤에는 원본과 사본이 어느 쪽으로도 이어지지 않는다.
        //  ★ mutationUid 는 형식만 본다(멱등 키로 쓰지 않는다).
        private async Task<object> CopyAsync(JsonElement q, CancellationToken ct)
        {
            string projectUid = ReqUid(q, "projectUid", "과제");
            string eventUid = ReqClientId(q, "eventUid", "일정 id");
            ReqClientId(q, "mutationUid", "변경 id");
            long? expected = OptVersion(q, "expectedVersion");

            string login = SessionLoginId();
            string now = NowDb();
            await using var conn = await OpenAsync(WritePreambleSql, ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            try
            {
                var me = await IdentityAsync(conn, tx, login, ct);
                //  잠금 1: 과제 행(공유). 공용 쓰기와 같은 순서(과제 행, 일정 행)라 교착 순환이 없다. 숨긴 과제도 개인 등록은 된다.
                var proj = await RequireProjectAsync(conn, tx, me, projectUid, write: false, ct, lockProject: true);

                //  잠금 2: 원본 일정 행(공유). 커밋까지 공용 쓰기가 이 일정을 바꾸지 못해, 확인한 판 그대로 복사된다.
                var src = await EventByUidForShareAsync(conn, tx, eventUid, ct);
                if (src == null) throw new PcFail(Kind.Conflict, MsgGone, ConflictData(null));
                if (src.ProjectId != proj.Id) throw new PcFail(Kind.Invalid, MsgOtherProject);
                if (src.Deleted) throw new PcFail(Kind.Conflict, MsgGone, ConflictData(src));
                if (expected != null && src.RowVersion != expected.Value) throw new PcFail(Kind.Conflict, MsgConflict, ConflictData(src));

                //  잠금 3: 내 개인 rev(배타). 번호 발급(H-1)이 이 락에 기댄다. CalendarWriteDb 의 같은 문장을 쓴다.
                long personalRev = await CalendarWriteDb.BumpUserRevInTxAsync(conn, tx, me.UserId, ct);

                //  분류 = 내 과제의 그 공식 과제(과제 탭에 보인다는 것이 이미 내 과제에 있다는 뜻)
                uint catNo;
                await using (var cmd = new MySqlCommand(
                    "SELECT cat_no FROM cal_category WHERE user_id=@me AND source='db' AND project_uid=@pu ORDER BY cat_no LIMIT 1", conn, tx))
                {
                    cmd.Parameters.AddWithValue("@me", me.UserId);
                    cmd.Parameters.AddWithValue("@pu", projectUid);
                    var o = await cmd.ExecuteScalarAsync(ct);
                    if (o == null || o == DBNull.Value) throw new PcFail(Kind.Forbidden, MsgNotMine);
                    catNo = Convert.ToUInt32(o, CultureInfo.InvariantCulture);
                }

                //  개인 일정 한 건. 행 투영은 개인 저장과 같은 함수(CalendarWriteDb.EntryParams)를 쓴다.
                //  시각이 없으면 all_day = 0 에 시각 NULL(시각 없는 하루 일정), 미리알림은 새 기록과 같은 기본값(remind NULL = 놓침 방지 사다리), 반복 없음.
                string entryUid = "e-" + Guid.NewGuid().ToString("D");
                var entry = new Dictionary<string, object?>
                {
                    ["id"] = entryUid,
                    ["date"] = src.F.StartDate,
                    ["endDate"] = src.F.EndDate == src.F.StartDate ? "" : src.F.EndDate,
                    ["allDay"] = false,
                    ["startTime"] = src.F.StartTime ?? "",
                    ["endTime"] = src.F.EndTime ?? "",
                    ["title"] = src.F.Title,
                    ["memo"] = src.F.Memo,
                    ["location"] = src.F.Location,
                    ["remind"] = null,   // 새 기록과 같은 기본 미리알림(놓침 방지 사다리). 사본은 보통 개인 일정이다(2026-10-23)
                    ["createdAt"] = "",
                };
                using var entryDoc = JsonDocument.Parse(JsonSerializer.Serialize(entry));
                await CalendarWriteDb.InsertEntryInTxAsync(conn, tx, me.UserId, entryDoc.RootElement, catNo, now, ct);

                await CommitWithGateAsync(conn, tx, ct);
                _log("과제 일정 개인 복사: " + projectUid + " " + eventUid + " -> " + entryUid + " personalRev=" + personalRev);
                var data = (Dictionary<string, object?>)CopyData(entryUid, eventUid, projectUid);
                data["personalRev"] = personalRev;
                return data;
            }
            catch { await SafeRollbackAsync(tx); throw; }
        }

        // ================================================================================
        //  7. projectCalendarMembers: { projectUid } → 그 과제의 참여자 명단(기획 §6.9, 2026-10-23)
        // ================================================================================
        //  읽기 전용 한 스냅샷. 내 과제에 있는 과제만(판정 함수 하나, 숨긴 과제도 읽기는 된다). 아니면 forbidden.
        //  ★ 사람의 집합은 부트스트랩의 참여자 수와 같은 규칙이다: 그 과제를 cal_category(source='db')로 가진 활성 사용자.
        //    그래서 목록의 n명과 명단의 total 이 늘 같다.
        //  ★ 보내는 것은 이름, 소속 이름, 직급 이름, 나인지뿐이다. 번호, login_id, 이메일은 고르지도 않는다.
        //  ★ 순서는 "다른 사람 일정" 명부와 같다(ProjectDb.cs 구성원 조회의 ② 조직 트리와 ④ 구성원):
        //    소속 묶음 = 조직 트리 순서. 활성 조직을 ORDER BY sort_order, name 으로 읽고, 부모가 없거나 활성 목록에 없으면 루트,
        //    루트부터 깊이 우선(형제는 읽은 순서 그대로, 웹 renderUnitTree 와 pkOrgIndex 의 걷기와 같다).
        //    묶음 안 = u.sort_order IS NULL, u.sort_order, u.name(관리자가 정한 서열, 직급을 끼우지 않는다).
        //    트리에 닿지 않는 소속(비활성 조직 등)은 트리 뒤에 소속 이름 순, 소속 없는 사람은 맨 뒤 org "" 묶음(웹이 "소속 없음"으로 그린다).
        //  ★ 숨김 표시는 보내지 않는다. cal_category 에 숨김 칸이 없고, 과제 탭의 표시와 숨김(체크)은 그 PC 의 localStorage 다.
        private async Task<object> MembersAsync(JsonElement q, CancellationToken ct)
        {
            string projectUid = ReqUid(q, "projectUid", "과제");

            string login = SessionLoginId();
            await using var conn = await OpenReadSnapshotAsync(ct);
            var me = await IdentityAsync(conn, null, login, ct);
            await RequireProjectAsync(conn, null, me, projectUid, write: false, ct);

            //  ① 조직 트리(명부 ②와 같은 WHERE 와 ORDER BY)
            var unitOrder = new List<int>();
            var unitName = new Dictionary<int, string>();
            var unitParent = new Dictionary<int, int?>();
            await using (var cmd = new MySqlCommand(MembersOrgSql, conn))
            {
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    string n = Str(rd, "name");
                    if (n.Length == 0) continue;
                    int oid = Convert.ToInt32(rd["org_id"], CultureInfo.InvariantCulture);
                    unitOrder.Add(oid);
                    unitName[oid] = n;
                    unitParent[oid] = rd.IsDBNull(rd.GetOrdinal("parent_id")) ? (int?)null : Convert.ToInt32(rd["parent_id"], CultureInfo.InvariantCulture);
                }
            }
            //  루트부터 깊이 우선. 형제는 SQL 이 준 순서(sort_order, name). 방문 집합이 부모 순환을 멈춘다.
            var kids = new Dictionary<int, List<int>>();
            var roots = new List<int>();
            foreach (var oid in unitOrder)
            {
                int? par = unitParent[oid];
                if (par == null || !unitName.ContainsKey(par.Value)) roots.Add(oid);
                else { if (!kids.TryGetValue(par.Value, out var l)) kids[par.Value] = l = new List<int>(); l.Add(oid); }
            }
            var treeOrder = new List<int>();
            var seenUnit = new HashSet<int>();
            void Walk(int oid)
            {
                if (!seenUnit.Add(oid)) return;
                treeOrder.Add(oid);
                if (kids.TryGetValue(oid, out var ks)) foreach (var k in ks) Walk(k);
            }
            foreach (var r in roots) Walk(r);

            //  ② 사람(명부 ④와 같은 소속 안 순서). 집합은 참여자 수와 같은 규칙(source='db', 활성)이다.
            var byOrg = new Dictionary<int, List<Dictionary<string, object?>>>();
            var orgLabel = new Dictionary<int, string>();
            var noOrg = new List<Dictionary<string, object?>>();
            int total = 0;
            await using (var cmd = new MySqlCommand(MembersSql, conn))
            {
                cmd.Parameters.AddWithValue("@me", me.UserId);
                cmd.Parameters.AddWithValue("@pu", projectUid);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    string org = Str(rd, "org_name");
                    var row = new Dictionary<string, object?>
                    {
                        ["name"] = Str(rd, "name"),
                        ["org"] = org,
                        ["title"] = Str(rd, "title_name"),
                        ["me"] = Convert.ToInt32(rd["is_me"], CultureInfo.InvariantCulture) == 1,
                    };
                    total++;
                    int oi = rd.GetOrdinal("org_id");
                    if (rd.IsDBNull(oi) || org.Length == 0) { noOrg.Add(row); continue; }
                    int oid = Convert.ToInt32(rd.GetValue(oi), CultureInfo.InvariantCulture);
                    if (!byOrg.TryGetValue(oid, out var l)) { byOrg[oid] = l = new List<Dictionary<string, object?>>(); orgLabel[oid] = org; }
                    l.Add(row);
                }
            }

            var groups = new List<object>();
            void Put(string org, List<Dictionary<string, object?>> users) =>
                groups.Add(new Dictionary<string, object?> { ["org"] = org, ["users"] = users });
            foreach (var oid in treeOrder) if (byOrg.Remove(oid, out var l)) Put(orgLabel[oid], l);
            var rest = new List<int>(byOrg.Keys);
            rest.Sort((a, b) => { int c = string.CompareOrdinal(orgLabel[a], orgLabel[b]); return c != 0 ? c : a.CompareTo(b); });
            foreach (var oid in rest) Put(orgLabel[oid], byOrg[oid]);
            if (noOrg.Count > 0) Put("", noOrg);
            return new Dictionary<string, object?> { ["projectUid"] = projectUid, ["groups"] = groups, ["total"] = total };
        }

        //  참여자 명단의 두 SQL. 시험(tests/project-calendar-host.test.mjs)이 명부(ProjectDb.cs)의 ORDER BY 와 글자로 대조한다.
        private const string MembersOrgSql =
            "SELECT t.org_id, t.name, t.parent_id, t.sort_order FROM org_unit t " +
            "WHERE t.is_active=1 ORDER BY t.sort_order, t.name";
        private const string MembersSql =
            "SELECT u.name, u.org_id, o.name AS org_name, t.name AS title_name, (u.user_id = @me) AS is_me " +
            "FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id " +
            "LEFT JOIN title_code t ON t.title_id = u.title_id " +
            "WHERE u.is_active = 1 AND EXISTS (SELECT 1 FROM cal_category c WHERE c.user_id = u.user_id AND c.source='db' AND c.project_uid = @pu) " +
            "ORDER BY u.sort_order IS NULL, u.sort_order, u.name";

        // ── 일정 읽기 ──────────────────────────────────────────────────────────
        private static async Task<Ev?> EventByUidForUpdateAsync(MySqlConnection conn, MySqlTransaction tx, string uid, CancellationToken ct) =>
            await EventWhereAsync(conn, tx, "e.uid=@uid FOR UPDATE OF e", ct, P("@uid", uid));

        private static async Task<Ev?> EventByUidForShareAsync(MySqlConnection conn, MySqlTransaction tx, string uid, CancellationToken ct) =>
            await EventWhereAsync(conn, tx, "e.uid=@uid FOR SHARE OF e", ct, P("@uid", uid));

        private static async Task<Ev?> EventWhereAsync(MySqlConnection conn, MySqlTransaction? tx, string where, CancellationToken ct,
            params (string, object?)[] ps)
        {
            await using var cmd = new MySqlCommand("SELECT " + EventCols + " FROM cal_project_event e JOIN project p ON p.id = e.project_id WHERE " + where, conn, tx);
            foreach (var (k, v) in ps) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            return await rd.ReadAsync(ct) ? ReadEvent(rd) : null;
        }

        private static Ev ReadEvent(MySqlDataReader rd) => new Ev
        {
            EventId = Convert.ToUInt32(rd["event_id"], CultureInfo.InvariantCulture),
            Uid = Str(rd, "uid"),
            ProjectUid = Str(rd, "project_uid"),
            ProjectId = Convert.ToUInt32(rd["project_id"], CultureInfo.InvariantCulture),
            F = new Fields
            {
                Title = Str(rd, "title"),
                StartDate = Str(rd, "sd"),
                EndDate = Str(rd, "ed"),
                StartTime = NStr(rd, "st"),
                EndTime = NStr(rd, "et"),
                Location = Str(rd, "location"),
                Memo = Str(rd, "memo"),
            },
            RowVersion = Convert.ToInt64(rd["row_version"], CultureInfo.InvariantCulture),
            Deleted = Convert.ToInt32(rd["is_deleted"], CultureInfo.InvariantCulture) == 1,
            CreatedBy = Str(rd, "created_by_name"),
            UpdatedBy = Str(rd, "updated_by_name"),
            CreatedAt = (DateTime)rd["created_at"],
            UpdatedAt = (DateTime)rd["updated_at"],
        };

        //  같은 (과제, 변경 id) 의 이력이 있으면 그 일정의 지금 행
        private static async Task<Ev?> ReplayAsync(MySqlConnection conn, MySqlTransaction tx, uint projectId, string mutationUid, CancellationToken ct)
        {
            object? eid;
            await using (var cmd = new MySqlCommand("SELECT event_id FROM cal_project_change WHERE project_id=@p AND mutation_uid=@m", conn, tx))
            {
                cmd.Parameters.AddWithValue("@p", projectId);
                cmd.Parameters.AddWithValue("@m", mutationUid);
                eid = await cmd.ExecuteScalarAsync(ct);
            }
            if (eid == null || eid == DBNull.Value) return null;
            return await EventWhereAsync(conn, tx, "e.event_id=@e", ct, P("@e", Convert.ToUInt32(eid, CultureInfo.InvariantCulture)));
        }

        private static async Task InsertChangeAsync(MySqlConnection conn, MySqlTransaction tx, uint projectId, uint eventId, string mutationUid,
            string action, string actor, string title, Dictionary<string, object?>? before, Dictionary<string, object?>? after, string now, CancellationToken ct)
        {
            await Exec(conn, tx,
                "INSERT INTO cal_project_change (project_id, event_id, mutation_uid, action, actor_name, title_snapshot, before_json, after_json, changed_at) " +
                "VALUES (@p, @e, @m, @a, @who, @ts, @bj, @aj, @now)", ct,
                P("@p", projectId), P("@e", eventId), P("@m", mutationUid), P("@a", action), P("@who", actor), P("@ts", title),
                P("@bj", before == null ? null : JsonSerializer.Serialize(before, JsonOpt)),
                P("@aj", after == null ? null : JsonSerializer.Serialize(after, JsonOpt)),
                P("@now", now));
        }

        // ── 값 비교와 DTO ──────────────────────────────────────────────────────
        //  a 의 필드 중 b 와 다른 것만(b 가 null 이면 전부). 이력의 before, after 와 "바뀐 것 없음" 판정이 같은 함수다.
        private static Dictionary<string, object?> FieldMap(Fields a, Fields? b)
        {
            var d = new Dictionary<string, object?>(StringComparer.Ordinal);
            void Put(string k, string? x, string? y) { if (b == null || !string.Equals(x, y, StringComparison.Ordinal)) d[k] = x; }
            Put("title", a.Title, b?.Title);
            Put("startDate", a.StartDate, b?.StartDate);
            Put("endDate", a.EndDate, b?.EndDate);
            Put("startTime", a.StartTime, b?.StartTime);
            Put("endTime", a.EndTime, b?.EndTime);
            Put("location", a.Location, b?.Location);
            Put("memo", a.Memo, b?.Memo);
            return d;
        }

        private static List<(string, object?)> FieldParams(Fields f, params (string, object?)[] extra)
        {
            var l = new List<(string, object?)>
            {
                ("@t", f.Title),
                ("@sd", f.StartDate),
                ("@ed", f.EndDate == f.StartDate ? null : f.EndDate),   // 하루 일정은 NULL(정본 CHECK: end_date > start_date)
                ("@st", f.StartTime),
                ("@et", f.EndTime),
                ("@loc", f.Location),
                ("@memo", f.Memo),
            };
            l.AddRange(extra);
            return l;
        }

        private static Dictionary<string, object?> EventDto(Ev e) => new Dictionary<string, object?>
        {
            ["eventUid"] = e.Uid,
            ["projectUid"] = e.ProjectUid,
            ["title"] = e.F.Title,
            ["startDate"] = e.F.StartDate,
            ["endDate"] = e.F.EndDate,
            ["startTime"] = e.F.StartTime,
            ["endTime"] = e.F.EndTime,
            ["location"] = e.F.Location,
            ["memo"] = e.F.Memo,
            ["rowVersion"] = e.RowVersion,
            ["deleted"] = e.Deleted,
            ["createdBy"] = e.CreatedBy,
            ["updatedBy"] = e.UpdatedBy,
            ["createdAt"] = Iso(e.CreatedAt),
            ["updatedAt"] = Iso(e.UpdatedAt),
        };

        private static object SaveData(Ev e, bool replayed) => new Dictionary<string, object?>
        {
            ["event"] = EventDto(e), ["rowVersion"] = e.RowVersion, ["replayed"] = replayed,
        };

        private static object DeleteData(Ev e, bool replayed) => new Dictionary<string, object?>
        {
            ["eventUid"] = e.Uid, ["rowVersion"] = e.RowVersion, ["deleted"] = e.Deleted, ["replayed"] = replayed,
        };

        private static object CopyData(string entryUid, string eventUid, string projectUid) => new Dictionary<string, object?>
        {
            ["entryUid"] = entryUid, ["eventUid"] = eventUid, ["projectUid"] = projectUid,
        };

        private static object ConflictData(Ev? latest) => new Dictionary<string, object?> { ["latest"] = latest == null ? null : EventDto(latest) };

        // ── 입력 검사(DB 를 열기 전) ────────────────────────────────────────────
        private static readonly Regex UuidRe = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOptions.CultureInvariant);
        private static readonly Regex DateRe = new Regex(@"^\d{4}-\d{2}-\d{2}$", RegexOptions.CultureInvariant);
        private static readonly Regex TimeRe = new Regex(@"^([01]\d|2[0-3]):[0-5]\d$", RegexOptions.CultureInvariant);

        //  project.uid(서버가 만든 36자 id). 대소문자를 바꾸지 않는다.
        private static string ReqUid(JsonElement q, string key, string label)
        {
            string v = Str(q, key);
            if (v.Length != 36 || !UuidRe.IsMatch(v.ToLowerInvariant())) throw new PcFail(Kind.Invalid, label + " id 형식이 잘못되었습니다.");
            return v;
        }

        //  웹이 만든 id(crypto.randomUUID). _bin 비교라 소문자로 고정한다.
        private static string ReqClientId(JsonElement q, string key, string label)
        {
            string v = Str(q, key).ToLowerInvariant();
            if (!UuidRe.IsMatch(v)) throw new PcFail(Kind.Invalid, label + " 형식이 잘못되었습니다.");
            return v;
        }

        private static List<string> UidList(JsonElement q, string key)
        {
            var l = new List<string>();
            if (!q.TryGetProperty(key, out var a) || a.ValueKind != JsonValueKind.Array) throw new PcFail(Kind.Invalid, "과제 목록이 없습니다.");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var x in a.EnumerateArray())
            {
                string v = x.ValueKind == JsonValueKind.String ? (x.GetString() ?? "") : "";
                if (v.Length != 36 || !UuidRe.IsMatch(v.ToLowerInvariant())) throw new PcFail(Kind.Invalid, "과제 id 형식이 잘못되었습니다.");
                if (seen.Add(v)) l.Add(v);
            }
            if (l.Count > 200) throw new PcFail(Kind.Invalid, "한 번에 읽는 과제가 너무 많습니다.");
            return l;
        }

        private static long? OptVersion(JsonElement q, string key)
        {
            if (!q.TryGetProperty(key, out var v) || v.ValueKind == JsonValueKind.Null) return null;
            if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out long n) && n >= 1) return n;
            throw new PcFail(Kind.Invalid, "판(" + key + ") 형식이 잘못되었습니다.");
        }

        private static string ReqDate(JsonElement q, string key)
        {
            string v = Str(q, key);
            if (!IsDate(v)) throw new PcFail(Kind.Invalid, "날짜 형식이 잘못되었습니다(" + key + ").");
            return v;
        }

        private static bool IsDate(string v) =>
            DateRe.IsMatch(v) && DateTime.TryParseExact(v, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

        private static DateTime ParseDate(string v) => DateTime.ParseExact(v, "yyyy-MM-dd", CultureInfo.InvariantCulture);

        //  시각 범위 경계(UTC). ISO(Z 또는 +00:00) 를 DATETIME(3) 글자로. 없으면 null.
        private static string? OptInstant(JsonElement q, string key)
        {
            if (!q.TryGetProperty(key, out var v) || v.ValueKind == JsonValueKind.Null) return null;
            string s = v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";
            if (s.Length == 0) return null;
            if (!DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d))
                throw new PcFail(Kind.Invalid, "시각 형식이 잘못되었습니다(" + key + ").");
            return d.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
        }

        //  일정 값 검사. 글자 상한을 넘으면 자르지 않고 거절한다(§4.1). 제목과 장소는 앞뒤 공백만 걷는다.
        private static Fields ValidateFields(JsonElement e)
        {
            var f = new Fields
            {
                Title = Str(e, "title").Trim(),
                StartDate = Str(e, "startDate"),
                EndDate = Str(e, "endDate"),
                Location = Str(e, "location").Trim(),
                Memo = Str(e, "memo"),
            };
            string st = Str(e, "startTime"), et = Str(e, "endTime");
            f.StartTime = st.Length == 0 ? null : st;
            f.EndTime = et.Length == 0 ? null : et;

            if (f.Title.Length == 0) throw new PcFail(Kind.Invalid, "제목을 입력하세요.");
            if (CountChars(f.Title) > Limits.Title) throw new PcFail(Kind.Invalid, "제목은 " + Limits.Title + "자까지 쓸 수 있습니다.");
            if (CountChars(f.Location) > Limits.Location) throw new PcFail(Kind.Invalid, "장소는 " + Limits.Location + "자까지 쓸 수 있습니다.");
            if (CountChars(f.Memo) > Limits.Memo) throw new PcFail(Kind.Invalid, "메모는 " + Limits.Memo.ToString("N0", CultureInfo.InvariantCulture) + "자까지 쓸 수 있습니다.");
            if (!IsDate(f.StartDate)) throw new PcFail(Kind.Invalid, "시작일 형식이 잘못되었습니다.");
            if (f.EndDate.Length == 0) f.EndDate = f.StartDate;
            if (!IsDate(f.EndDate)) throw new PcFail(Kind.Invalid, "종료일 형식이 잘못되었습니다.");
            if (string.CompareOrdinal(f.EndDate, f.StartDate) < 0) throw new PcFail(Kind.Invalid, "종료일이 시작일보다 빠릅니다.");
            if ((f.StartTime == null) != (f.EndTime == null)) throw new PcFail(Kind.Invalid, "시작 시각과 종료 시각은 둘 다 적거나 둘 다 비웁니다.");
            if (f.StartTime != null)
            {
                if (!TimeRe.IsMatch(f.StartTime) || !TimeRe.IsMatch(f.EndTime!)) throw new PcFail(Kind.Invalid, "시각 형식이 잘못되었습니다(HH:mm).");
                if (f.EndDate != f.StartDate) throw new PcFail(Kind.Invalid, "시각은 하루 일정에서만 쓸 수 있습니다.");
                if (string.CompareOrdinal(f.EndTime, f.StartTime) <= 0) throw new PcFail(Kind.Invalid, "종료 시각이 시작 시각보다 늦어야 합니다.");
            }
            return f;
        }

        //  세션 사람 이름이 이름 칸(200자)에 들어가는가. app_user.name 은 더 짧아 보통 닿지 않는다.
        private static void CheckName(string name)
        {
            if (CountChars(name) > Limits.Name) throw new PcFail(Kind.Invalid, "사용자 이름이 너무 깁니다.");
        }

        //  유니코드 글자 수(서로게이트 쌍은 한 글자). MySQL 의 문자 수와 같은 단위다.
        internal static int CountChars(string s)
        {
            int n = 0;
            for (int i = 0; i < s.Length; i++) { if (char.IsHighSurrogate(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) i++; n++; }
            return n;
        }

        // ── 작은 도구 ──────────────────────────────────────────────────────────
        private static string NowDb() => DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
        private static string Iso(DateTime utc) => DateTime.SpecifyKind(utc, DateTimeKind.Utc).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        private static (string, object?) P(string k, object? v) => (k, v);

        private static (string sql, List<(string, object)> ps) InList(string prefix, List<object> values)
        {
            var names = new List<string>(values.Count);
            var ps = new List<(string, object)>(values.Count);
            for (int i = 0; i < values.Count; i++) { string n = prefix + i.ToString(CultureInfo.InvariantCulture); names.Add(n); ps.Add((n, values[i])); }
            return (string.Join(",", names), ps);
        }

        private static async Task<int> Exec(MySqlConnection conn, MySqlTransaction? tx, string sql, CancellationToken ct, params (string, object?)[] ps)
        {
            await using var cmd = new MySqlCommand(sql, conn, tx);
            foreach (var (k, v) in ps) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
            return await cmd.ExecuteNonQueryAsync(ct);
        }

        private static Task<int> Exec(MySqlConnection conn, MySqlTransaction? tx, string sql, CancellationToken ct, List<(string, object?)> ps) =>
            Exec(conn, tx, sql, ct, ps.ToArray());

        private static string Str(MySqlDataReader rd, string col)
        {
            int i = rd.GetOrdinal(col);
            return rd.IsDBNull(i) ? "" : Convert.ToString(rd.GetValue(i), CultureInfo.InvariantCulture) ?? "";
        }

        private static string? NStr(MySqlDataReader rd, string col)
        {
            int i = rd.GetOrdinal(col);
            return rd.IsDBNull(i) ? null : Convert.ToString(rd.GetValue(i), CultureInfo.InvariantCulture);
        }

        private static object? JsonOrNull(MySqlDataReader rd, string col)
        {
            string? s = NStr(rd, col);
            if (string.IsNullOrEmpty(s)) return null;
            using var d = JsonDocument.Parse(s);
            return d.RootElement.Clone();
        }

        private static string Str(JsonElement o, string k) =>
            o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";
    }

    //  명령 하나의 회신. MainWindow 가 { ok, data?, error?: { kind, message } } 로 웹에 보낸다.
    internal sealed class ProjectCalendarReply
    {
        public bool Ok { get; private set; }
        public object? Data { get; private set; }
        public string Kind { get; private set; } = "";
        public string Message { get; private set; } = "";
        //  개인 복사로 개인 일정이 새로 생겼다. 호스트가 개인 스냅샷을 다시 읽어야 한다(§5.5 3번).
        public bool ReloadPersonal { get; set; }

        public static ProjectCalendarReply Success(object data) => new ProjectCalendarReply { Ok = true, Data = data };
        public static ProjectCalendarReply Failure(string kind, string message, object? data = null) =>
            new ProjectCalendarReply { Ok = false, Kind = kind, Message = message, Data = data };

        public object ToPayload() => Ok
            ? new Dictionary<string, object?> { ["ok"] = true, ["data"] = Data }
            : new Dictionary<string, object?> { ["ok"] = false, ["data"] = Data, ["error"] = new Dictionary<string, object?> { ["kind"] = Kind, ["message"] = Message } };
    }
}
