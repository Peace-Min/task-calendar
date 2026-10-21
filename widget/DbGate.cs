using System;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using MySqlConnector;

namespace TaskCalendarWidget
{
    // ================================================================================
    //  버전 관문(DbGate): docs/VERSION-GATE.md §2, docs/DB-RELEASE-OPS.md §1~3
    // ================================================================================
    //  규칙 하나: DB 의 구조 번호(cal_schema_meta.db_structure_version)와 앱이 아는 구조 번호가
    //  같으면 동작하고, 다르면 읽기와 쓰기를 모두 막는다. db_updating = '1' 이면 갱신 중이라 기다린다.
    //  ★ 데이터를 다루는 연결은 모두 여기서 연다(CalendarDb, CalendarWriteDb, ProjectDb, ReportDb).
    //    `new MySqlConnection(` 은 이 파일과 재연결 핑(OfflineHost dbPing)에만 있다. 시험이 강제한다
    //    (tests/version-gate-host.test.mjs). 입구가 하나라야 "어느 경로가 관문을 빼먹었나" 를 셀 필요가 없다.
    //  ★ 이것은 보안 장치가 아니라 난간이다. 정직한 구버전 앱이 새 구조의 DB 를 실수로 꼬이게 하지 않도록,
    //    그리고 개발 빌드가 운영 DB 에 붙지 않도록 막는다(DB-RELEASE-OPS §0, §7).
    internal enum GateVerdict
    {
        Ok,          // 같다. 정상
        Updating,    // db_updating = '1'. 이관 SQL 이 도는 중이라 기다린다(30초마다 재확인)
        NeedUpdate,  // DB 구조 번호 > 앱. 이 앱을 업데이트해야 한다
        ServerOld,   // DB 구조 번호 < 앱. 서버 갱신 전이다(관리자 문의)
        Unknown,     // 행이 없거나 숫자가 아니다. 모르는 상태에서 데이터를 만지지 않는다
    }

    // cal_schema_meta 에서 읽은 키 다섯 개. 구조 번호와 갱신 중 표시는 행이 없으면 null 이다(Unknown 판정의 재료).
    internal sealed class GateMeta
    {
        public string? DbStructure { get; init; }
        public string? DbUpdating { get; init; }
        public string LatestVersion { get; init; } = "";     // 빈 값 = 배포 중인 새 버전 없음
        public string InstallerFile { get; init; } = "";
        public string InstallerSha256 { get; init; } = "";
    }

    // 마지막 판정. 바뀌지 않는 객체라 참조 하나만 바꿔 끼우면 스레드 안전하다(보고 재시도가 Task.Run 위에서 돈다).
    internal sealed class GateSnapshot
    {
        public GateVerdict Verdict { get; }
        public GateMeta Meta { get; }
        public DateTime AtUtc { get; }
        public GateSnapshot(GateVerdict verdict, GateMeta meta) { Verdict = verdict; Meta = meta; AtUtc = DateTime.UtcNow; }
        public string State => DbGate.StateName(Verdict);
        public string DbStructure => Meta.DbStructure ?? "";
    }

    // 관문이 막았다. 연결은 이미 닫혔다. DbErrors.Classify 가 kind 'gate' 로 분류한다(재시도 대상 아님).
    internal sealed class DbGateException : Exception
    {
        public GateVerdict Verdict { get; }
        public GateMeta Meta { get; }
        public DbGateException(GateVerdict verdict, GateMeta meta)
            : base("버전 관문: " + DbGate.StateName(verdict) + " (DB 구조 " + (meta.DbStructure ?? "없음") +
                   ", 앱 구조 " + DbGate.AppStructureVersion.ToString(CultureInfo.InvariantCulture) + ")")
        {
            Verdict = verdict;
            Meta = meta;
        }
    }

    internal static class DbGate
    {
        //  앱이 아는 DB 구조 번호. 옛 CalendarDb.ExpectedSchemaVersion("13") 의 자리다.
        //  ★ 이관 SQL(db/deploy/migrate-*.sql)로 정본(db/deploy/schema-calendar.sql)의 db_structure_version 을
        //    올릴 때 **이 상수도 같은 커밋에서 올린다.** 어긋나면 tests/schema-guards.test.mjs 가드 ⑨ 가 잡는다.
        //  ★ 앱 계정의 cal_schema_meta 권한은 SELECT 하나뿐이다(db/deploy/grants-calendar.sql). 막히는 쪽이
        //    자기 통과증을 쓰지 못한다.
        //  ★ 2026-10-21: 13 → 14(db/deploy/migrations/v14-version-gate.sql, 배포 SQL 하나에 들어가는 조각, schema_version 키를 db_ 와 app_ 키 다섯 개로).
        //  ★ 2026-10-21: 14 → 15(이관 조각 migrations/v15-shared-rooms.sql, 회의실 공용화: cal_room 을 지우고 room_code).
        public const int AppStructureVersion = 15;

        //  키 다섯 개를 한 번에 읽는다. 연결을 열 때마다 도는 유일한 추가 쿼리다(DB-RELEASE-OPS §3.1 의 비용).
        internal const string MetaSql =
            "SELECT k, v FROM cal_schema_meta WHERE k IN " +
            "('db_structure_version','db_updating','app_latest_version','app_installer_file','app_installer_sha256')";

        // ── 판정(순수 함수) ─────────────────────────────────────────────────────
        //  ① db_updating = '1' 이 먼저다. 이관 SQL 은 구조 번호 행을 바꾸는 동안에도 이 행을 먼저 세운다
        //     (13 에서 14 로 가는 판은 구조 번호 행 자체가 없는 순간이 있다). 그 순간을 Unknown 이 아니라
        //     '갱신 중' 으로 보여야 30초 뒤 저절로 풀린다.
        //  ② 구조 번호와 갱신 중 표시가 없거나 정해진 값이 아니면 Unknown. 모르는 상태에서는 막는다.
        //  ③ 비교는 정수로 한다. 문자열 비교면 "9" > "14" 가 된다.
        public static GateVerdict Judge(string? dbStructure, string? dbUpdating, int appStructure)
        {
            string up = (dbUpdating ?? "").Trim();
            if (up == "1") return GateVerdict.Updating;
            if (dbUpdating == null || up != "0") return GateVerdict.Unknown;
            if (!TryParseStructure(dbStructure, out int db)) return GateVerdict.Unknown;
            if (db > appStructure) return GateVerdict.NeedUpdate;
            if (db < appStructure) return GateVerdict.ServerOld;
            return GateVerdict.Ok;
        }

        //  부호, 소수점, 공백 섞인 값은 숫자로 보지 않는다(앞뒤 공백만 걷어 낸다).
        internal static bool TryParseStructure(string? s, out int value)
        {
            value = 0;
            if (s == null) return false;
            string t = s.Trim();
            return t.Length > 0 && int.TryParse(t, NumberStyles.None, CultureInfo.InvariantCulture, out value);
        }

        //  웹으로 가는 상태 이름. 웹이 같은 글자로 분기한다.
        public static string StateName(GateVerdict v) => v switch
        {
            GateVerdict.Ok => "ok",
            GateVerdict.Updating => "updating",
            GateVerdict.NeedUpdate => "needUpdate",
            GateVerdict.ServerOld => "serverOld",
            _ => "unknown",
        };

        // ── 마지막 판정과 통지 ──────────────────────────────────────────────────
        private static GateSnapshot? _last;
        public static GateSnapshot? Last => Volatile.Read(ref _last);

        //  막힌 판정을 보았거나 판정이 바뀌었을 때 부른다(정상에서 정상은 부르지 않는다. 연결마다 UI 를 흔들지 않게).
        //  어느 스레드에서든 온다. 받는 쪽(MainWindow.OnGateObserved)이 UI 스레드로 넘긴다.
        public static event Action<GateSnapshot>? Observed;

        //  판정하고 기록한다. 연결을 연 자리(OpenWithMetaAsync)와 저장 커밋 직전 재확인(CalendarWriteDb)이 부른다.
        internal static GateVerdict Observe(GateMeta meta)
        {
            var v = Judge(meta.DbStructure, meta.DbUpdating, AppStructureVersion);
            var snap = new GateSnapshot(v, meta);
            var prev = Interlocked.Exchange(ref _last, snap);
            if (v != GateVerdict.Ok)
            {
                var f = _flow.Value;
                if (f != null) f.Blocked = snap;
            }
            if (v != GateVerdict.Ok || (prev != null && prev.Verdict != v))
            {
                try { Observed?.Invoke(snap); } catch { /* 통지 실패가 DB 경로를 깨지 않게 */ }
            }
            return v;
        }

        // ── 연결 입구 ───────────────────────────────────────────────────────────
        //  순서: 장애 주입 확인, 연결 열기(실패 시 정리 후 그대로 던짐), 메타 한 번 읽기, 판정.
        //  ★ 메타 읽기는 autocommit SELECT 한 문장이다. 트랜잭션도 스냅샷도 열지 않는다. 그래서 호출자의
        //    프리앰블(SET SESSION transaction_isolation 등)을 그 뒤에 걸어도 유효하다. 세션 격리수준 변경은
        //    열린 트랜잭션이 없으면 다음 트랜잭션부터 적용되고, 부팅 조회의 START TRANSACTION WITH CONSISTENT
        //    SNAPSHOT 은 프리앰블 **뒤에** 친다. 이 읽기를 그 스냅샷 안으로 끌어넣지 말 것(창만 길어진다).
        //  ★ 프리앰블은 호출자가 건다. 격리수준이 경로마다 다르다(읽기 REPEATABLE-READ, 쓰기 READ-COMMITTED).
        public static async Task<MySqlConnection> OpenAsync(string connString, CancellationToken ct) =>
            (await OpenWithMetaAsync(connString, ct)).conn;

        //  부팅 조회처럼 읽은 구조 번호가 필요한 자리용. 연결과 메타를 함께 돌려준다.
        public static async Task<(MySqlConnection conn, GateMeta meta)> OpenWithMetaAsync(string connString, CancellationToken ct)
        {
            DbFault.ThrowIfActive();   // 디버그 장애 주입(OFFLINE-RESILIENCE §7). 배포 실행에서는 무동작
            var conn = new MySqlConnection(connString);
            try { await conn.OpenAsync(ct); }
            catch { await conn.DisposeAsync(); throw; }   // 못 연 연결을 새지 않게 정리하고 원인은 그대로 전파
            GateMeta meta;
            try { meta = await ReadMetaAsync(conn, null, ct); }
            catch { await conn.DisposeAsync(); throw; }
            var v = Observe(meta);
            if (v != GateVerdict.Ok)
            {
                await conn.DisposeAsync();
                throw new DbGateException(v, meta);
            }
            return (conn, meta);
        }

        //  키 다섯 개 읽기. tx 는 쓰기 트랜잭션 안의 재확인(CalendarWriteDb)에서만 넘긴다.
        //  ★ 잠금 읽기(FOR SHARE)를 쓰지 않는다. MySQL 8 은 FOR SHARE 에 SELECT 말고 UPDATE, DELETE,
        //    LOCK TABLES 중 하나를 더 요구하는데 앱 계정은 이 표에 SELECT 만 있다(VERSION-GATE §2.2).
        internal static async Task<GateMeta> ReadMetaAsync(MySqlConnection conn, MySqlTransaction? tx, CancellationToken ct)
        {
            string? structure = null, updating = null;
            string latest = "", file = "", sha = "";
            await using var cmd = new MySqlCommand(MetaSql, conn, tx);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            while (await rd.ReadAsync(ct))
            {
                string k = rd.IsDBNull(0) ? "" : rd.GetString(0);
                string v = rd.IsDBNull(1) ? "" : rd.GetString(1);
                switch (k)
                {
                    case "db_structure_version": structure = v; break;
                    case "db_updating": updating = v; break;
                    case "app_latest_version": latest = v.Trim(); break;
                    case "app_installer_file": file = v.Trim(); break;
                    case "app_installer_sha256": sha = v.Trim(); break;
                }
            }
            return new GateMeta { DbStructure = structure, DbUpdating = updating, LatestVersion = latest, InstallerFile = file, InstallerSha256 = sha };
        }

        //  업데이트 확인 전용(Update.cs). 판정 없이 app_ 세 키만 돌려준다. 막힌 상태에서도 읽혀야
        //  업데이트 버튼이 동작한다(DB-RELEASE-OPS §3.1 끝). 값이 없으면 빈 문자열.
        public static async Task<(string latestVersion, string installerFile, string sha256)> ReadReleaseAsync(string connString, CancellationToken ct)
        {
            DbFault.ThrowIfActive();   // 디버그 장애 주입(OFFLINE-RESILIENCE §7). 배포 실행에서는 무동작
            await using var conn = new MySqlConnection(connString);
            await conn.OpenAsync(ct);
            var m = await ReadMetaAsync(conn, null, ct);
            return (m.LatestVersion, m.InstallerFile, m.InstallerSha256);
        }

        //  재확인(막힌 동안의 루프와 웹 명령 gateRecheck). 관문으로 연결을 한 번 열고 닫는다.
        //  연결 자체의 실패(네트워크 등)는 그대로 던진다. 부른 쪽이 로그를 남기고 상태를 바꾸지 않는다.
        public static async Task<GateVerdict> RecheckAsync(string connString, CancellationToken ct)
        {
            try
            {
                await using var conn = await OpenAsync(connString, ct);
                return GateVerdict.Ok;
            }
            catch (DbGateException gx) { return gx.Verdict; }
        }

        //  회신에 싣는 관문 정보 { state, dbStructure, appStructure }.
        public static object ReplyGate(GateSnapshot s) => new
        {
            state = s.State,
            dbStructure = s.DbStructure,
            appStructure = AppStructureVersion,
        };

        // ── 흐름 표시: 이 웹 명령을 처리하는 동안 관문이 막았는가 ──────────────────
        //  MainWindow.OnWebMessage 가 명령마다 BeginFlow 를 걸고, 회신(GitReply)이 FlowBlocked 를 보고
        //  { ok:false } 회신에 kind 'gate' 와 gate 정보를 붙인다. 회신 경로 마흔 곳을 하나씩 고치지 않는 길이다.
        //  ★ AsyncLocal 은 await 로 부른 메서드 안으로 흐르지만 안에서 바꾼 값은 밖으로 돌아오지 않는다.
        //    그래서 객체 하나를 심고 그 안에 적는다(DbErrors.Capture 와 같은 방식).
        private sealed class GateFlow { public volatile GateSnapshot? Blocked; }
        private static readonly AsyncLocal<GateFlow?> _flow = new();

        public static GateSnapshot? FlowBlocked => _flow.Value?.Blocked;

        public static IDisposable BeginFlow()
        {
            var scope = new FlowScope(_flow.Value);
            _flow.Value = new GateFlow();
            return scope;
        }

        private sealed class FlowScope : IDisposable
        {
            private readonly GateFlow? _prev;
            public FlowScope(GateFlow? prev) { _prev = prev; }
            public void Dispose() => _flow.Value = _prev;
        }
    }
}
