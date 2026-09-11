using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MySqlConnector;

namespace TaskCalendarWidget
{
    // 쓰기 권한 거부 — '오프라인'과 반드시 구분해야 하는 실패다(USER-LOGIN §3.3).
    //   쓰기 메서드들은 연결 실패를 전부 OfflineMsg("서버에 연결할 수 없습니다…")로 환원한다.
    //   전용 타입이 없으면 "편집 권한이 없습니다"가 "서버 연결이 필요합니다"로 표시돼 사용자가 원인을 오해한다.
    //   그래서 쓰기 11곳 모두 이 예외를 Exception보다 '앞에서' 잡아 Message를 그대로 사용자에게 돌려준다.
    internal sealed class NotAuthorizedException : Exception
    {
        public NotAuthorizedException(string message) : base(message) { }
        //  ★ '권한이 모자라다'(roleOnly)와 '신원 자체가 서지 않는다'(미로그인·미등록·비활성)를 가른다.
        //    화면은 앞쪽에 자기 문장을 갖고 있지만("관리자만 사용할 수 있습니다."), 뒤쪽 사유는 **관문만 안다** —
        //    그 문장을 화면까지 실어 주지 않으면 퇴사 처리된 사람이 원인을 영영 못 찾는다(USER-LOGIN §3.3 함정).
        public NotAuthorizedException(string message, bool roleOnly) : base(message) { RoleOnly = roleOnly; }
        public bool RoleOnly { get; }
    }

    // 과제 DB 연동 — 사내 MySQL(taskmgr)의 공식 과제(project)를 읽어 웹으로 넘기고(READ),
    // 공식 과제 편집(P3.2)의 쓰기(UPSERT/소프트삭제)를 처리한다. 오프라인이면 읽기는 null을 돌려 웹이 목록을 비우고
    // (로컬 캐시 없음 — ADR-18), 쓰기는 '온라인에서만 가능'을 명시적으로 알린다(무음 유실 금지).
    // DB 연결정보는 배포 구성(DeployConfig.cs 한 곳)에서 온다 — 배포 전 그 파일만 고쳐 빌드.
    // ★ 편집 권한은 공용 관리자 비밀번호가 아니라 '로그인 신원 + app_user.edit_role'로 판정한다(USER-LOGIN §3.3).
    //   판정 지점은 OpenWriteAsync 한 곳뿐이다.
    internal sealed class ProjectDb
    {
        private readonly string _dataDir;
        private readonly Action<string> _log;

        public ProjectDb(string dataDir, Action<string> log)
        {
            _dataDir = dataDir;
            _log = log ?? (_ => { });
        }

        // ★ db-config.json은 더 이상 읽지도 쓰지도 않는다(USER-LOGIN §3.3, 2026-07-30).
        //   그 파일이 담고 있던 것은 관리자 자격(adminId/adminPw)과 잠금해제 상태(adminUnlocked)뿐이었고
        //   셋 다 폐지됐다 — 편집 권한은 공용 비밀번호가 아니라 로그인 신원으로 판정한다.
        //   DB 연결정보는 예나 지금이나 배포 구성(DeployConfig) 베이크 상수라 그 파일에 없었다.
        //   사용자 PC에 남은 옛 파일은 아무도 읽지 않으므로 그냥 방치한다
        //   (지우는 코드를 새로 지으면 ‘언젠가 다른 걸 지운다’는 위험만 남고 얻는 게 없다).

        // 짧은 연결 타임아웃(~4s) — 오프라인이면 빠르게 실패해 화면이 곧바로 '연결 안 됨'으로 간다. 연결정보는 항상 배포 구성 상수(DeployConfig).
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
                Pooling = false,               // 위젯 단발성 조회 — 풀 미유지(정지된 서버로 소켓 재사용 방지)
            }.ConnectionString;

        // ── 접속 프리앰블 — 시각 컬럼 규약(schema-calendar.sql 머리말 「시각 컬럼 규약」) ──────
        //   ★ 2026-09-09 신설. 왜 이 파일에만 없었는가가 곧 이 코드가 존재하는 이유다:
        //     CalendarDb·CalendarWriteDb·ReportDb 는 셋 다 프리앰블에서 time_zone='+00:00' 을 걸었는데
        //     ProjectDb 만 걸지 않았다. 그런데 이 파일이 쓰는 표들(project · customer ·
        //     section_code · status_code)의 created_at/updated_at 은 **서버 기본값**
        //     CURRENT_TIMESTAMP(3) 이고, 그 함수는 세션 time_zone 으로 평가된다.
        //     이 서버의 time_zone 은 SYSTEM=KST 다 → 그 표들만 KST 로 적혀 왔다.
        //     실측(2026-09-09): customer 저장 16:05:39 / 물리 기록 16:05:56(같은 시계 = KST),
        //                       cal_category 저장 03:09:01 / 물리 기록 12:09:01(9시간 차 = UTC).
        //     즉 같은 DB 한복판에 기준이 둘이었고, DATETIME 은 사후에 둘을 구분하지 못한다.
        //     경계 이전 행은 migrate-2026-09-09-integrity.sql 의 (5)가 1회 정규화했다 —
        //     그 마이그레이션과 이 코드는 반드시 같이 가야 한다(한쪽만 가면 혼재가 남는다).
        //
        //   ★ 읽기와 쓰기를 한 상수로 합치지 않는다. 쓰기는 격리수준까지 고정하지만
        //     읽기 경로는 **기존 동작을 바꾸지 않는다** — 여기서 격리수준을 건드리면
        //     LoadProjectsJsonAsync·LoadAppUserJsonAsync 등 읽기 전량의 동작이 함께 바뀐다.
        //     읽기에 필요한 것은 시각 기준 하나뿐이다(읽기 경로도 감사 컬럼을 그대로 돌려주므로).
        private const string ReadPreambleSql =
            "SET SESSION time_zone='+00:00'";

        private const string WritePreambleSql =
            "SET SESSION innodb_lock_wait_timeout=5, " +      // DefaultCommandTimeout(8s)보다 짧게 — DB 가 진단 가능한 1205 를 먼저 내게
            "SESSION time_zone='+00:00', " +                  // 위 ★ — 서버 기본값 CURRENT_TIMESTAMP(3) 이 UTC 로 평가되게
            "SESSION transaction_isolation='READ-COMMITTED'";

        // 연 연결마다 프리앰블 1회. 실패하면 연결을 정리하고 원인을 그대로 전파한다 —
        // 프리앰블이 안 걸린 연결로 계속 진행하면 그 세션이 쓴 값만 조용히 KST 가 된다(무음 오염).
        private static async Task ApplyPreambleAsync(MySqlConnection conn, string sql, CancellationToken ct)
        {
            try
            {
                await using var pre = conn.CreateCommand();
                pre.CommandText = sql;
                await pre.ExecuteNonQueryAsync(ct);
            }
            catch { await conn.DisposeAsync(); throw; }
        }

        // 예외 경로의 롤백 — **취소되지 않은 토큰**으로 하고, 롤백 자체의 실패는 삼킨다.
        //   ★ 왜: cts 는 타임아웃(10~15초)이다. 그 시간을 넘겨 예외가 난 자리에서 RollbackAsync(cts.Token) 을
        //     부르면 **롤백이 OperationCanceled 로 죽고 그 예외가 원래 예외를 덮어쓴다.** 그러면 1205(잠금 대기)·
        //     1213(교착)·1451(FK) 같은, 사용자 문장으로 옮길 수 있었던 원인이 catch (MySqlException) 에
        //     닿지 못하고 "처리하지 못했습니다"로 뭉개진다(2026-09-10 검토 지적).
        //   ★ 롤백 실패를 삼키는 이유: 여기서 던지면 원래 예외를 또 덮는다. 연결을 닫으면 서버가 어차피 롤백한다.
        private static async Task SafeRollbackAsync(System.Data.Common.DbTransaction tx)
        {
            try { await tx.RollbackAsync(CancellationToken.None); } catch { /* 원래 예외를 덮지 않는다 */ }
        }

        // ================================================================================
        // DB 접근 관문 — 연결 획득을 두 헬퍼로 좁힌다 (USER-LOGIN §3)
        //   메서드 18개가 각자 new MySqlConnection을 열면, 쓰기 권한 검사를 '호출부마다 한 줄'로 넣는 설계는
        //   fail-open이 된다(새 API에서 빠뜨리면 조용히 뚫린다). SQL 모양은 제각각이어도 '연결을 여는 한 줄'은
        //   전부 같으므로, 그 한 줄을 초크포인트로 만들고 테스트 불변식(§3.2)으로 기계가 강제한다.
        //   ★ 2단계(2026-07-30)부터 OpenWriteAsync 안에 실제 권한 판정이 들어 있다 —
        //     쓰기 11곳은 이미 이 관문을 통과하므로 호출부를 고치지 않아도 전부 적용된다.
        // ================================================================================

        // 읽기용 연결. 실패(오프라인·인증오류)는 그대로 던진다 — 호출측이 자기 문맥의 메시지로 처리한다.
        // ★ 읽기에는 권한 검사를 두지 않는다(USER-LOGIN §3.3) — 회수의 목적은 편집 차단이지 조회 차단이 아니다.
        //   로그인 인가 조회(LoadAppUserJsonAsync)도 이 경로를 쓴다. 여기에 권한 검사를 넣으면
        //   "권한을 알려면 먼저 권한이 있어야 한다"는 순환이 생겨 아무도 로그인하지 못한다.
        private static async Task<MySqlConnection> OpenReadAsync(CancellationToken ct)
        {
            var conn = new MySqlConnection(BuildConnString());
            try { await conn.OpenAsync(ct); }
            catch { await conn.DisposeAsync(); throw; }   // 못 연 연결을 새지 않게 정리하고 원인은 그대로 전파
            await ApplyPreambleAsync(conn, ReadPreambleSql, ct);   // 프리앰블은 연 연결마다 — 예외를 두면 그 자리가 규약 밖이 된다
            return conn;
        }

        // 쓰기용 연결 = 권한 관문. ★ static이 아니다 — 세션(_dataDir)을 읽어야 하기 때문이다.
        //
        // DB 작업 권한은 '로그인 시점'이 아니라 '작업 요청 시점'에 결정된다(USER-LOGIN §3.3).
        //   ① 세션이 없으면 신원이 없다 → 연결도 열지 않는다.
        //   ② 연결을 연 뒤, 방금 연 그 연결로 지금 이 순간의 권한을 읽는다 — 세션 캐시를 믿지 않는다.
        //      그래서 퇴사·계정 회수(is_active=0)와 권한 강등이 다음 쓰기부터 즉시 반영된다.
        //      주기 검사·타이머·백그라운드 폴링이 전혀 필요 없는 이유다(같은 쿼리에서 공짜로 따라온다).
        //   ③ 거부하면 연결을 반드시 정리한다 — 예외로 빠져나가며 열린 연결을 흘리면 소켓이 샌다.
        private async Task<MySqlConnection> OpenWriteAsync(CancellationToken ct)
        {
            var s = UserSession.Load(_dataDir, _log);
            if (s == null || s.LoginId.Length == 0) throw new NotAuthorizedException("로그인이 필요합니다.");

            var conn = new MySqlConnection(BuildConnString());
            try { await conn.OpenAsync(ct); }
            catch { await conn.DisposeAsync(); throw; }   // 연결 실패는 그대로 전파 = 호출측에서 '오프라인'
            // ★ 프리앰블은 권한 판정보다 **먼저** 건다. 판정 쿼리도 이 연결로 도는 데다,
            //   순서를 뒤집으면 '권한은 통과했는데 프리앰블에서 죽는' 창이 생겨 실패 원인이 흐려진다.
            await ApplyPreambleAsync(conn, WritePreambleSql, ct);
            try
            {
                bool found = false;
                string role = "";
                int active = 0;
                // 값은 반드시 파라미터 바인딩(문자열 연결 금지) — loginId는 사용자 입력에서 왔다.
                await using (var cmd = new MySqlCommand("SELECT edit_role, is_active FROM app_user WHERE login_id=@id", conn))
                {
                    cmd.Parameters.AddWithValue("@id", s.LoginId);
                    await using var rd = await cmd.ExecuteReaderAsync(ct);
                    if (await rd.ReadAsync(ct))
                    {
                        found = true;
                        role = Str(rd, "edit_role");
                        active = IntOrNull(rd, "is_active") ?? 0;
                    }
                }
                if (!found) throw new NotAuthorizedException("사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요.");
                if (active == 0) throw new NotAuthorizedException("비활성 처리된 계정입니다.");
                if (!string.Equals(role, "editor", StringComparison.Ordinal) && !string.Equals(role, "admin", StringComparison.Ordinal))
                    throw new NotAuthorizedException("편집 권한이 없습니다.");
            }
            catch (NotAuthorizedException nex)
            {
                _log("쓰기 권한 거부(" + s.LoginId + "): " + nex.Message);
                await conn.DisposeAsync();
                throw;
            }
            catch { await conn.DisposeAsync(); throw; }   // 권한 조회 자체의 실패(질의 오류 등)도 연결을 흘리지 않는다
            return conn;
        }

        // 관리자 전용 관문 = 직원 정보(app_user) 쓰기. OpenWriteAsync 와 **같은 순서**(세션 → 연결 →
        // 프리앰블 → 같은 연결로 권한 조회)이되 'admin' 만 통과시킨다(USER-ADMIN §4.1).
        //
        // 왜 쓰기 관문을 재사용하지 않나 — editor 가 통과하기 때문이다. editor 는 '과제 DB 를 고칠 수 있나'
        //   축이고, 직원 정보는 '누가 관리자인가' 를 담는 표라 급이 다르다(04-permissions.sql 이 이미
        //   admin 을 "+ 시스템·직원 정보 관리" 로 정의해 두었다 — 새 등급을 만들지 않고 그 정의를 쓴다).
        // ★ 판정은 로그인 시점이 아니라 **요청 시점**이다(USER-LOGIN §3.3) — 관리자에서 내려간 사람은
        //   다음 저장부터 막힌다. 그래서 세션에 아무것도 캐시하지 않고 매번 이 연결로 다시 읽는다.
        private async Task<MySqlConnection> OpenAdminAsync(CancellationToken ct)
        {
            var s = UserSession.Load(_dataDir, _log);
            if (s == null || s.LoginId.Length == 0) throw new NotAuthorizedException("로그인이 필요합니다.");

            var conn = new MySqlConnection(BuildConnString());
            try { await conn.OpenAsync(ct); }
            catch { await conn.DisposeAsync(); throw; }   // 연결 실패는 그대로 전파 = 호출측에서 '오프라인'
            await ApplyPreambleAsync(conn, WritePreambleSql, ct);   // 쓰기와 같은 프리앰블(격리수준까지) — 판정보다 먼저
            try
            {
                bool found = false;
                string role = "";
                int active = 0;
                await using (var cmd = new MySqlCommand("SELECT edit_role, is_active FROM app_user WHERE login_id=@id", conn))
                {
                    cmd.Parameters.AddWithValue("@id", s.LoginId);   // 값은 반드시 파라미터 바인딩(문자열 연결 금지)
                    await using var rd = await cmd.ExecuteReaderAsync(ct);
                    if (await rd.ReadAsync(ct))
                    {
                        found = true;
                        role = Str(rd, "edit_role");
                        active = IntOrNull(rd, "is_active") ?? 0;
                    }
                }
                if (!found) throw new NotAuthorizedException("사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요.");
                if (active == 0) throw new NotAuthorizedException("비활성 처리된 계정입니다.");
                if (!string.Equals(role, "admin", StringComparison.Ordinal))
                    //  roleOnly — 위 둘(미등록·비활성)과 달리 '신원은 섰는데 등급이 모자란' 경우다. 부르는 쪽이 갈라 쓴다.
                    throw new NotAuthorizedException("직원 정보는 관리자만 고칠 수 있습니다.", roleOnly: true);
            }
            catch (NotAuthorizedException nex)
            {
                _log("직원 정보 쓰기 권한 거부(" + s.LoginId + "): " + nex.Message);
                await conn.DisposeAsync();
                throw;
            }
            catch { await conn.DisposeAsync(); throw; }
            return conn;
        }

        // 공식 과제(is_active=1)를 읽어 JSON 배열 문자열로 반환. 연결/조회 실패 시 null(호출측이 웹에 ""를 넘겨 목록을 비운다).
        public async Task<string?> LoadProjectsJsonAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = await OpenReadAsync(cts.Token);

                const string sql =
                    "SELECT uid, section, customer, project_name, contract_name, common_name, " +
                    "DATE_FORMAT(start_date,'%Y-%m-%d') start_date, DATE_FORMAT(end_date,'%Y-%m-%d') end_date, " +
                    "DATE_FORMAT(dev_end_date,'%Y-%m-%d') dev_end_date, " +
                    "status, note, is_active FROM project WHERE is_active=1 ORDER BY common_name";
                await using var cmd = new MySqlCommand(sql, conn);
                await using var rd = await cmd.ExecuteReaderAsync(cts.Token);

                var rows = new List<Dictionary<string, object?>>();
                while (await rd.ReadAsync(cts.Token))
                {
                    rows.Add(new Dictionary<string, object?>
                    {
                        ["uid"]           = Str(rd, "uid"),
                        ["section"]       = Str(rd, "section"),
                        ["customer"]      = Str(rd, "customer"),
                        ["project_name"]  = Str(rd, "project_name"),
                        ["contract_name"] = Str(rd, "contract_name"),
                        ["common_name"]   = Str(rd, "common_name"),
                        ["start_date"]    = Str(rd, "start_date"),
                        ["end_date"]      = Str(rd, "end_date"),
                        ["dev_end_date"]  = Str(rd, "dev_end_date"),
                        ["status"]        = Str(rd, "status"),
                        ["note"]          = Str(rd, "note"),
                        ["is_active"]     = IntOrNull(rd, "is_active"),
                    });
                }
                _log("DB 과제 로드: " + rows.Count + "건");
                return JsonSerializer.Serialize(rows);
            }
            catch (Exception ex) { _log("DB 과제 로드 실패(목록 비움): " + Short(ex)); return null; }
        }

        // 발주처 마스터(customer, is_active=1)를 이름 배열 JSON으로. 편집 폼의 발주처 드롭다운 소스.
        // 실패(오프라인 포함) 시 null → 웹은 카탈로그에 실제로 쓰인 발주처만으로 폴백한다(마스터 캐시 없음).
        public async Task<string?> LoadCustomersJsonAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = await OpenReadAsync(cts.Token);
                await using var cmd = new MySqlCommand("SELECT name FROM customer WHERE is_active=1 ORDER BY name", conn);
                await using var rd = await cmd.ExecuteReaderAsync(cts.Token);
                var names = new List<string>();
                while (await rd.ReadAsync(cts.Token))
                {
                    string n = Str(rd, "name");
                    if (n.Length > 0) names.Add(n);
                }
                _log("DB 발주처 로드: " + names.Count + "건");
                return JsonSerializer.Serialize(names);
            }
            catch (Exception ex) { _log("DB 발주처 로드 실패: " + Short(ex)); return null; }
        }

        // 발주처 전체(숨김 포함) — 관리 화면 전용. [{name, active}] JSON. 활성 먼저, 그 안에서 이름순.
        // (편집 폼·추출 드롭다운은 활성만 필요해 LoadCustomersJsonAsync를 쓰고, 이 메서드는 관리 UI에서만 쓴다.)
        public async Task<string?> LoadCustomersFullJsonAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = await OpenReadAsync(cts.Token);
                await using var cmd = new MySqlCommand("SELECT name, is_active FROM customer ORDER BY is_active DESC, name", conn);
                await using var rd = await cmd.ExecuteReaderAsync(cts.Token);
                var rows = new List<Dictionary<string, object?>>();
                while (await rd.ReadAsync(cts.Token))
                {
                    string n = Str(rd, "name");
                    if (n.Length == 0) continue;
                    var a = IntOrNull(rd, "is_active");
                    rows.Add(new Dictionary<string, object?> { ["name"] = n, ["active"] = (a ?? 1) != 0 });
                }
                _log("DB 발주처(전체) 로드: " + rows.Count + "건");
                return JsonSerializer.Serialize(rows);
            }
            catch (Exception ex) { _log("DB 발주처(전체) 로드 실패: " + Short(ex)); return null; }
        }

        // ================================================================================
        // 사용자(app_user) 조회 — 로그인 인가(누구인가 → 이름·소속·권한).
        //   인증(정말 본인인가)은 회사 사이트(netcus)가 하고, 여기는 인가 정보만 읽는다.
        //   그래서 app_user에는 비밀번호 컬럼이 없다(USER-LOGIN §1).
        // ================================================================================

        // login_id로 app_user 1행을 JSON으로. 값은 반드시 파라미터 바인딩(문자열 연결 금지).
        // 반환 3분기 — 호출측(로그인 핸들러)이 사유별로 다른 안내를 하려면 셋을 구분해야 한다:
        //   행 있음 → 그 행의 JSON 객체 / 행 없음 → "{}"(미등록 사용자) / 연결·질의 실패 → null(오프라인·DB 오류)
        public async Task<string?> LoadAppUserJsonAsync(string? loginId)
        {
            string id = (loginId ?? "").Trim();
            if (id.Length == 0) return "{}";   // 빈 ID는 조회할 것도 없다(행 없음과 동일 취급)
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = await OpenReadAsync(cts.Token);

                // ★ 소속 이름은 org_unit 한 곳에만 있다(app_user 에는 org_id 뿐) — JOIN 으로 이름을 만든다.
                //   별칭 org_unit 은 웹으로 나가는 payload 키다(MainWindow.ParseAppUser 가 "org_unit"을 읽는다).
                //   LEFT JOIN 이라 소속이 없는 사람(org_id IS NULL)은 그대로 NULL → Str() 이 ""로 바꾼다(종전과 동일).
                const string sql =
                    "SELECT u.login_id, u.name, u.title, o.name AS org_unit, u.view_scope, u.edit_role, u.is_active " +
                    "FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id " +
                    "WHERE u.login_id=@id";
                await using var cmd = new MySqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("@id", id);
                await using var rd = await cmd.ExecuteReaderAsync(cts.Token);

                if (!await rd.ReadAsync(cts.Token))
                {
                    _log("DB 사용자 조회: 미등록(" + id + ")");
                    return "{}";
                }
                var row = new Dictionary<string, object?>
                {
                    ["login_id"]   = Str(rd, "login_id"),
                    ["name"]       = Str(rd, "name"),
                    ["title"]      = Str(rd, "title"),
                    ["org_unit"]   = Str(rd, "org_unit"),
                    ["view_scope"] = Str(rd, "view_scope"),
                    ["edit_role"]  = Str(rd, "edit_role"),
                    ["is_active"]  = IntOrNull(rd, "is_active"),
                };
                _log("DB 사용자 조회: " + id + " (" + Str(rd, "name") + ")");
                return JsonSerializer.Serialize(row);
            }
            catch (Exception ex) { _log("DB 사용자 조회 실패(" + id + "): " + Short(ex)); return null; }
        }

        // 로그인한 사람의 현재 권한을 DB에서 그대로 읽어 온다(표시 전용 — 상단바 「사용자 정보」 모달).
        // ★ 세션에 캐시하지 않는다 — 관리자가 역할을 바꾼 뒤에도 낡은 값이 남으면 화면이 거짓말을 한다.
        //   그래서 모달을 열 때마다 이 조회가 다시 돈다(주기 폴링은 없다).
        // ★ 읽기 경로다: OpenWriteAsync 를 쓰면 viewer 가 자기 권한을 확인조차 못 한다
        //   ("권한을 보려면 먼저 권한이 있어야 한다"는 순환 — 읽기 관문에 권한 검사를 두지 않는 이유와 같다).
        // 반환 3분기 — 호출측이 사유별로 다른 안내를 하려면 셋을 구분해야 한다:
        //   행 있음 → {"found":true, …} / 행 없음 → {"found":false} / 연결·질의 실패 → null
        //   (LoadAppUserJsonAsync 처럼 "{}" 로 구분하지 않는 이유: 이 payload 는 웹으로 그대로 나가므로
        //    '없음'도 명시적인 필드여야 한다. 빈 객체는 파싱 실패와 구분되지 않는다.)
        public async Task<string?> LoadUserInfoJsonAsync(string loginId)
        {
            string id = (loginId ?? "").Trim();
            if (id.Length == 0) return NotFoundJson();
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = await OpenReadAsync(cts.Token);

                // ★ 소속 이름은 JOIN 으로 만든다(위 LoadAppUserJsonAsync 와 같은 이유·같은 별칭).
                //   컬럼 순서·이름을 그대로 두었으므로 아래 payload 와 웹(사용자 정보 모달)은 손대지 않는다.
                const string sql =
                    "SELECT u.name, u.title, o.name AS org_unit, u.view_scope, u.edit_role, u.is_active " +
                    "FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id " +
                    "WHERE u.login_id=@id";
                await using var cmd = new MySqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("@id", id);   // 값은 반드시 파라미터 바인딩(문자열 연결 금지)
                await using var rd = await cmd.ExecuteReaderAsync(cts.Token);

                if (!await rd.ReadAsync(cts.Token))
                {
                    _log("DB 사용자 권한 조회: 미등록(" + id + ")");
                    return NotFoundJson();
                }
                var row = new Dictionary<string, object?>
                {
                    ["found"]      = true,
                    ["name"]       = Str(rd, "name"),
                    ["title"]      = Str(rd, "title"),
                    ["org_unit"]   = Str(rd, "org_unit"),
                    ["view_scope"] = Str(rd, "view_scope"),
                    ["edit_role"]  = Str(rd, "edit_role"),
                    ["is_active"]  = IntOrNull(rd, "is_active"),
                };
                _log("DB 사용자 권한 조회: " + id + " (" + Str(rd, "edit_role") + "/" + Str(rd, "view_scope") + ")");
                return JsonSerializer.Serialize(row);
            }
            catch (Exception ex) { _log("DB 사용자 권한 조회 실패(" + id + "): " + Short(ex)); return null; }
        }
        private static string NotFoundJson() =>
            JsonSerializer.Serialize(new Dictionary<string, object?> { ["found"] = false });

        // 조직 한 노드(org_unit 한 행) — 트리 계산은 전부 메모리에서 돈다(12행이라 왕복이 더 비싸다).
        private sealed class OrgUnitRow
        {
            public string Name = "";
            public string Parent = "";     // 최상위는 빈 문자열(NULL) — payload 로 나갈 때 null 로 바뀐다
            public int SortOrder;
            //  ★ 관리자 편집 폼의 소속 드롭다운이 **번호로** 저장하기 때문에 필요하다(app_user.org_id).
            //    이름으로 보내면 개명 한 번에 소속이 통째로 어긋난다 — 완전 절단(01-schema-users.sql ★★)의 요지다.
            //    비관리자 회신에는 싣지 않는다(쓸 데가 없다).
            public int? OrgId;
        }

        // 전 조직 트리 + 전 구성원 명부, 그리고 '그 사람 일정을 볼 수 있는가'(canViewSchedule).
        // ★ 명부는 열람 범위와 무관하게 전원(is_active=1)이다 — 이름·직급·소속은 사내망 인트라넷에서
        //   이미 전 직원이 보는 정보다. view_scope 가 정하는 것은 명부가 아니라 「그 사람의 '일정'을
        //   볼 수 있는가」다. 예전엔 이 값으로 명부 자체를 잘랐고, 그래서 self 인 71명(89명 중)이
        //   조직 트리 없이 자기 이름 한 줄만 보는 화면을 받았다(실사용에서 지적됐다). 통제 대상은 일정이다.
        // ★ 조직 트리도 전 조직을 그대로 보낸다 — 누구나 조직도를 탐색할 수 있어야 한다(누르지 못할 노드가 없다).
        // ★ 읽기 경로다(OpenReadAsync): 쓰기 관문을 쓰면 viewer — 즉 unit_tree 를 가진 사람 전원 — 이
        //   명부를 아예 못 본다. 열람 권한과 편집 권한은 다른 축이다(USER-LOGIN §3.3).
        // 반환 3분기는 LoadUserInfoJsonAsync 와 같다: 행 있음 → {"found":true,…} / 행 없음 → {"found":false} / 실패 → null.
        //
        // ★ 2026-09-10 — 관리자에게만 직원 관리용 필드가 더 실린다(USER-ADMIN §4.2).
        //   판정은 **이 연결에서 지금 읽은 edit_role** 로 한다(①). 세션에 캐시하지 않는 이유는 쓰기 관문과 같다 —
        //   관리자에서 내려간 사람의 화면에 편집 컨트롤이 남아 있으면 그건 화면이 거짓말을 하는 것이다.
        //   ★★ 관리자가 아니면 회신은 **글자까지 종전과 같다**. 키를 하나라도 더 실으면 그 순간
        //     '비관리자에게 무엇이 나가는가' 를 다시 감사해야 하고, 기존 시험이 붙잡고 있는 계약도 흔들린다.
        //   includeInactive 는 관리자 전용이다(퇴사자 보기). 비관리자에게는 값과 무관하게 무시된다 —
        //   웹이 그 플래그를 바꾸는 것만으로 퇴사자 명단을 얻으면 안 된다(웹은 신뢰 경계 밖이다).
        public async Task<string?> LoadMembersJsonAsync(string loginId, bool includeInactive = false, bool flatOrder = false)
        {
            string id = (loginId ?? "").Trim();
            if (id.Length == 0) return NotFoundJson();
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                await using var conn = await OpenReadAsync(cts.Token);

                // ① 나 자신 — 일정 열람 범위와 소속을 여기서 정한다.
                //   ★ name/title 은 읽지 않는다: 명부에 전원이 담기므로 본인 행도 그 안에 들어 있다.
                //   ★ edit_role 은 '직원 관리 화면을 그릴 것인가' 판정용이다(위 ★). 표시용이 아니다.
                string scope = "", myUnit = "", myRole = "";
                int myActive = 0;
                bool found = false;
                //   ★ 소속 이름은 org_unit 을 JOIN 해서 만든다 — myUnit 은 이름 기준 트리 순회(③)의 시작점이다.
                await using (var cmd = new MySqlCommand(
                    "SELECT o.name AS org_unit, u.view_scope, u.edit_role, u.is_active " +
                    "FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id " +
                    "WHERE u.login_id=@id", conn))
                {
                    cmd.Parameters.AddWithValue("@id", id);   // 값은 반드시 파라미터 바인딩(문자열 연결 금지)
                    await using var rd = await cmd.ExecuteReaderAsync(cts.Token);
                    if (await rd.ReadAsync(cts.Token))
                    {
                        found    = true;
                        myUnit   = Str(rd, "org_unit");
                        scope    = Str(rd, "view_scope");
                        myRole   = Str(rd, "edit_role");
                        myActive = IntOrNull(rd, "is_active") ?? 0;
                    }
                }
                if (!found)
                {
                    _log("DB 구성원 조회: 미등록(" + id + ")");
                    return NotFoundJson();
                }
                // ★ is_active=0 을 여기서 막지 않는다 — 이건 '읽기'다. 회수의 목적은 편집 차단이지
                //   조직도 열람 차단이 아니고, 막으면 비활성 계정은 자기 상태를 확인할 화면조차 잃는다.
                //   실제 차단은 쓰기 관문(OpenWriteAsync) 한 곳에서만 한다.

                // 관리자인가 — 활성 admin 만이다. 비활성 admin 에게 편집 컨트롤을 그려 봐야
                //   저장이 관문(OpenAdminAsync)에서 전부 거부된다: 화면과 관문이 같은 답을 해야 한다.
                bool isAdmin = myActive != 0 && string.Equals(myRole, "admin", StringComparison.Ordinal);
                bool withInactive = isAdmin && includeInactive;   // 퇴사자 보기는 관리자 전용

                // ② 조직 트리 — 열람 범위와 무관하게 항상 전 조직이다(scope 로 건너뛰지 않는다).
                //   조직도는 사내망에 이미 공개된 정보고, 트리가 없으면 '내 위에 무엇이 있는지'조차 볼 수 없다.
                //   ★ 부모 '이름'은 자기 JOIN 으로 만든다(정본은 parent_id 뿐이다). 최상위는 parent_id IS NULL →
                //     LEFT JOIN 이 NULL 을 돌려주고 Str() 이 ""로 바꾼다 → payload 에서 다시 null 이 된다(종전과 동일).
                //   ★ ORDER BY 대상은 예전 그대로 org_unit 자신의 sort_order·name 이다(화면 순서 불변).
                var units = new List<OrgUnitRow>();
                await using (var cmd = new MySqlCommand(
                    "SELECT t.name, p.name AS parent, t.sort_order, t.org_id " +
                    "FROM org_unit t LEFT JOIN org_unit p ON p.org_id = t.parent_id " +
                    "WHERE t.is_active=1 ORDER BY t.sort_order, t.name", conn))
                {
                    await using var rd = await cmd.ExecuteReaderAsync(cts.Token);
                    while (await rd.ReadAsync(cts.Token))
                    {
                        string n = Str(rd, "name");
                        if (n.Length == 0) continue;
                        units.Add(new OrgUnitRow { Name = n, Parent = Str(rd, "parent"), SortOrder = IntOrNull(rd, "sort_order") ?? 0, OrgId = IntOrNull(rd, "org_id") });
                    }
                }

                // ③ 일정 열람 가능 유닛 집합 — 명부의 경계가 아니라 '누구의 일정을 열 수 있는가'다.
                //   self(그리고 알 수 없는 값)는 빈 집합 → 명부는 전원 그대로 나가되 아무도 누를 수 없다.
                var allowed = new HashSet<string>(StringComparer.Ordinal);
                switch (scope)
                {
                    case "all":
                        foreach (var u in units) allowed.Add(u.Name);
                        break;
                    case "unit_tree":
                        ExpandUnitTree(units, myUnit, allowed);
                        break;
                    default:
                        break;   // self(그리고 알 수 없는 값) — 빈 집합.
                }

                // ④ 구성원 — 항상 전원(is_active=1). 유닛 필터(IN 절)를 두지 않는다:
                //   명부는 통제 대상이 아니고, 필터를 되살리면 self 인 사람은 다시 자기 한 줄만 보게 된다.
                //   ★ 본인도 이 목록에 그대로 들어 있다(따로 담지 않는다 — 두 경로가 되면 한쪽이 낡는다).
                var members = new List<Dictionary<string, object?>>();
                //   ★ 소속 이름은 JOIN 으로 만든다. 정렬 첫 키도 그 이름이다.
                //   ★ 2026-09-10 — 정렬에 u.sort_order 가 끼었다(USER-ADMIN §5.3):
                //       ORDER BY o.name, u.sort_order IS NULL, u.sort_order, u.name
                //     소속 → 순번(NULL 은 맨 뒤) → 이름. **직급 서열을 여기 끼우지 않는다** —
                //     전사 서열이 직급을 이미 담고 있고, 끼우면 관리자가 정한 순서를 직급이 뒤엎는다.
                //     화면은 이 순서를 **그대로** 그린다(renderMembers 에 sort 가 없다) — 두 곳이면 갈린다.
                //     소속 없는 사람(NULL)이 앞에 오는 것은 종전과 같다(MySQL 은 ASC 에서 NULL 이 먼저다).
                //   ★ 2026-09-10 — 「구성원 편집」은 flatOrder=true 로 부른다(사용자 결정: 편집은 팀과 무관하게 서열로).
                //       ORDER BY u.sort_order IS NULL, u.sort_order, u.name
                //     서열의 주인은 편집 화면이고 전사 단일 서열이라 소속을 첫 키로 두면 그 서열이 팀에 갇힌다.
                //     보기 화면은 종전대로 소속 → 순번 → 이름. 정렬은 여기 두 리터럴뿐이다 — 화면은 어느 쪽도 재정렬하지 않는다.
                //   ★ WHERE 는 두 갈래다. 퇴사자 포함은 관리자 전용이고, 그 판정은 이미 위에서
                //     이 연결로 읽은 edit_role 이 했다(withInactive). 웹이 보낸 플래그만으로는 열리지 않는다.
                string rosterSql =
                    "SELECT u.user_id, u.login_id, u.name, u.title, u.sort_order, u.org_id, " +
                    "o.name AS org_unit, u.view_scope, u.edit_role, u.is_active " +
                    "FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id " +
                    (withInactive ? "" : "WHERE u.is_active=1 ") +
                    (flatOrder ? "ORDER BY u.sort_order IS NULL, u.sort_order, u.name"
                               : "ORDER BY o.name, u.sort_order IS NULL, u.sort_order, u.name");
                await using (var cmd = new MySqlCommand(rosterSql, conn))
                {
                    await using var rd = await cmd.ExecuteReaderAsync(cts.Token);
                    while (await rd.ReadAsync(cts.Token))
                    {
                        string ou = Str(rd, "org_unit");
                        var row = new Dictionary<string, object?>
                        {
                            ["loginId"] = Str(rd, "login_id"),
                            ["name"]    = Str(rd, "name"),
                            ["title"]   = Str(rd, "title"),
                            ["orgUnit"] = ou,
                            // 이 한 값이 곧 열람 범위다 — 화면은 이걸 보고 행을 누를 수 있게 할지 정한다.
                            ["canViewSchedule"] = allowed.Contains(ou),
                        };
                        // ★ 관리자에게만 더 싣는다. 비관리자 회신은 위 5키에서 한 글자도 늘지 않는다.
                        if (isAdmin)
                        {
                            row["userId"]    = IntOrNull(rd, "user_id");
                            row["orgId"]     = IntOrNull(rd, "org_id");     // 소속 없으면 null(드롭다운의 '(없음)')
                            row["viewScope"] = Str(rd, "view_scope");
                            row["editRole"]  = Str(rd, "edit_role");
                            row["isActive"]  = (IntOrNull(rd, "is_active") ?? 0) != 0;
                            row["sortOrder"] = IntOrNull(rd, "sort_order");
                        }
                        members.Add(row);
                    }
                }

                // 직급 목록 — 편집 폼의 드롭다운 소스. 관리자일 때만 읽는다(비관리자에게는 쓸 데가 없다).
                //   ★ 활성만·직급 서열순이다. title 은 FK 타겟이라 여기 없는 값은 저장이 DB 에서 막힌다 —
                //     드롭다운을 이 목록으로 채우면 '고를 수 없는 값'과 '저장할 수 없는 값'이 같아진다.
                List<string>? titles = null;
                if (isAdmin)
                {
                    titles = new List<string>();
                    await using var cmd = new MySqlCommand(
                        "SELECT name FROM title_code WHERE is_active=1 ORDER BY sort_order, name", conn);
                    await using var rd = await cmd.ExecuteReaderAsync(cts.Token);
                    while (await rd.ReadAsync(cts.Token)) { string n = Str(rd, "name"); if (n.Length > 0) titles.Add(n); }
                }

                var unitPayload = new List<Dictionary<string, object?>>(units.Count);
                foreach (var u in units)
                {
                    var un = new Dictionary<string, object?>
                    {
                        ["name"]      = u.Name,
                        ["parent"]    = u.Parent.Length == 0 ? null : u.Parent,   // 최상위는 null(웹이 루트로 읽는다)
                        ["sortOrder"] = u.SortOrder,
                        // ★ allowed 는 싣지 않는다 — 트리는 전부 활성이라 노드에 붙일 범위 개념이 없다.
                    };
                    if (isAdmin) un["orgId"] = u.OrgId;   // 편집 폼의 소속 드롭다운 값(이름이 아니라 번호)
                    unitPayload.Add(un);
                }
                _log("DB 구성원 조회: " + id + " (" + scope + "/" + (myActive != 0 ? "활성" : "비활성") +
                     (isAdmin ? "/관리자" : "") + ") 유닛 " + unitPayload.Count + "건 · 일정 열람 가능 유닛 " +
                     allowed.Count + "건 · 구성원 " + members.Count + "명");
                var payload = new Dictionary<string, object?>
                {
                    ["found"]   = true,
                    ["scope"]   = scope,
                    ["myUnit"]  = myUnit,
                    ["units"]   = unitPayload,
                    ["members"] = members,
                };
                // ★ 관리자에게만 더 싣는다 — 비관리자 회신은 위 5키 그대로다(키 순서까지 종전과 같다).
                if (isAdmin)
                {
                    payload["admin"] = true;
                    payload["titles"] = titles;                 // 활성 직급(드롭다운 소스)
                    payload["includeInactive"] = withInactive;  // 퇴사자 보기 상태 — 화면 토글이 이 값으로 자기를 맞춘다
                }
                return JsonSerializer.Serialize(payload);
            }
            catch (Exception ex) { _log("DB 구성원 조회 실패(" + id + "): " + Short(ex)); return null; }
        }

        // unit_tree 확장 — 내 소속 + 그 하위 전부. 부모→자식 반복 확장(BFS)이다.
        // ★ 재귀 CTE(WITH RECURSIVE)를 쓰지 않는다: 폐쇄망 MySQL 버전 가정을 하나 더 늘리는 값이
        //   12행짜리 트리에서 얻는 이득보다 크다. 메모리에서 도는 편이 싸고 버전에 자유롭다.
        // ★ allowed 자체가 방문 집합이다 — HashSet.Add 가 false 를 돌려주면 이미 담은 노드라 큐에 다시 넣지 않는다.
        //   org_unit.parent_id 에 순환(A→B→A)이 들어와도 여기서 멈춘다(무한 루프 방지).
        // ★ 이름 기준 순회를 그대로 둔다: 이름은 이제 org_unit 한 곳에만 있어 표류가 불가능하고,
        //   입력(units)은 위 ②가 JOIN 으로 만든 이름 쌍이라 id 경로와 같은 트리다(최소 변경).
        // ================================================================================
        //  공유 인가 판정 — "이 사람이 저 사람의 **일정**을 볼 수 있는가"
        // ================================================================================
        //   ★ 여기 두는 이유: 명부(LoadMembersJsonAsync)가 행마다 붙이는 canViewSchedule 과
        //     **정확히 같은 규칙**이어야 한다. 두 벌이 되는 순간 화면은 "누를 수 있다" 고 하는데
        //     조회는 거부하거나, 더 나쁘게는 그 반대가 된다.
        //   ★ 조회 쪽에서 **반드시 다시 부른다.** 웹이 보낸 대상 login_id 를 믿고 읽으면,
        //     화면을 우회한 요청 하나로 아무나 남의 일정을 가져간다(웹은 신뢰 경계 밖이다).
        //   ★ 호출자의 연결을 그대로 쓴다 — 조회와 같은 트랜잭션·같은 왕복에서 판정하기 위해서다.
        internal static async Task<bool> CanViewScheduleAsync(
            MySqlConnection conn, string viewerLoginId, string targetLoginId, CancellationToken ct)
        {
            string viewer = (viewerLoginId ?? "").Trim(), target = (targetLoginId ?? "").Trim();
            if (viewer.Length == 0 || target.Length == 0) return false;
            //  자기 자신은 언제나 볼 수 있다(명부에서는 누를 수 없게 두지만, 규칙 자체는 참이다).
            if (string.Equals(viewer, target, StringComparison.Ordinal)) return true;

            string scope = "", myUnit = "", targetUnit = "";
            bool haveViewer = false, haveTarget = false;
            await using (var cmd = new MySqlCommand(
                "SELECT u.login_id, o.name AS org_unit, u.view_scope " +
                "FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id " +
                "WHERE u.login_id IN (@v, @t)", conn))
            {
                cmd.Parameters.AddWithValue("@v", viewer);
                cmd.Parameters.AddWithValue("@t", target);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    string lid = Str(rd, "login_id");
                    if (string.Equals(lid, viewer, StringComparison.Ordinal))
                    { haveViewer = true; myUnit = Str(rd, "org_unit"); scope = Str(rd, "view_scope"); }
                    else if (string.Equals(lid, target, StringComparison.Ordinal))
                    { haveTarget = true; targetUnit = Str(rd, "org_unit"); }
                }
            }
            //  둘 중 하나라도 app_user 에 없으면 거부한다 — 없는 사람의 일정을 열 이유가 없고,
            //  '없음' 을 '허용' 으로 흘리면 오타 하나가 권한 우회가 된다.
            if (!haveViewer || !haveTarget) return false;

            if (string.Equals(scope, "all", StringComparison.Ordinal)) return true;
            if (!string.Equals(scope, "unit_tree", StringComparison.Ordinal)) return false;   // self · 미지값 → 거부
            if (targetUnit.Length == 0) return false;   // 소속 없는 사람은 unit_tree 로 못 닿는다

            var units = new List<OrgUnitRow>();
            await using (var cmd = new MySqlCommand(
                "SELECT t.name, p.name AS parent, t.sort_order " +
                "FROM org_unit t LEFT JOIN org_unit p ON p.org_id = t.parent_id " +
                "WHERE t.is_active=1 ORDER BY t.sort_order, t.name", conn))
            {
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    string n = Str(rd, "name");
                    if (n.Length == 0) continue;
                    units.Add(new OrgUnitRow { Name = n, Parent = Str(rd, "parent"), SortOrder = IntOrNull(rd, "sort_order") ?? 0 });
                }
            }
            var allowed = new HashSet<string>(StringComparer.Ordinal);
            ExpandUnitTree(units, myUnit, allowed);
            return allowed.Contains(targetUnit);
        }

        private static void ExpandUnitTree(List<OrgUnitRow> units, string myUnit, HashSet<string> allowed)
        {
            string root = (myUnit ?? "").Trim();
            if (root.Length == 0) return;

            var children = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (var u in units)
            {
                if (u.Parent.Length == 0) continue;
                if (!children.TryGetValue(u.Parent, out var lst)) { lst = new List<string>(); children[u.Parent] = lst; }
                lst.Add(u.Name);
            }

            var queue = new Queue<string>();
            allowed.Add(root);           // 내 소속은 org_unit 에 없더라도(비활성 유닛 등) 항상 내 범위다
            queue.Enqueue(root);
            while (queue.Count > 0)
            {
                string cur = queue.Dequeue();
                if (!children.TryGetValue(cur, out var kids)) continue;
                foreach (var k in kids)
                {
                    if (allowed.Add(k)) queue.Enqueue(k);   // 방문 집합 가드
                }
            }
        }

        // ================================================================================
        //  직원 정보(app_user) 쓰기 — 관리자 전용 (USER-ADMIN §4)
        //    "관리자가 신규 직원이나 퇴사 직원 있으면 App 단에서만 관리하는 걸 원함. 편집 권한 포함해서."
        //    · 삭제는 없다. 퇴사 = is_active=0 이고 행은 남는다 —
        //      cal_* 11개 표가 RESTRICT 로 이 표를 붙들고 있어 DELETE 는 애초에 ERROR 1451 이다(§3.3).
        //    · 기존 사용자의 login_id 는 바꾸지 않는다. 그 값은 넷커스 소유다(§6).
        //    · 규약은 과제 쓰기와 같다: 값은 전부 파라미터 바인딩 · 예외는 (false, 한국어 문장)으로 환원 ·
        //      SQL/스택을 사용자에게 노출하지 않는다. 다만 **권한 거부는 오프라인 문구로 뭉개지 않는다**
        //      (USER-LOGIN §3.3 의 함정 — "관리자만 고칠 수 있다"가 "서버에 연결할 수 없다"로 표시되면
        //       사용자는 원인을 영영 못 찾는다).
        // ================================================================================

        // 로그인 ID 형식 — 넷커스 계정과 같은 값이다(이메일 아님). 정규화(소문자 강제)는 하지 않는다:
        //   넷커스가 어떤 표기를 쓰는지 이 앱이 정하지 않는다. 중복 판정은 DB 콜레이션(ai_ci)에 맡긴다(1062).
        private static readonly System.Text.RegularExpressions.Regex LoginIdShape =
            new System.Text.RegularExpressions.Regex(@"^[A-Za-z0-9._-]{1,50}$",
                System.Text.RegularExpressions.RegexOptions.CultureInvariant);

        // 도메인 값 — 최종 보증은 chk_view_scope / chk_edit_role 이고, 여기서는 사용자 문장을 만들려고 본다.
        private static bool IsViewScope(string v) => v == "self" || v == "unit_tree" || v == "all";
        private static bool IsEditRole(string v)  => v == "viewer" || v == "editor" || v == "admin";

        // 잠금 방지 3문장(§4.4) — 화면은 힌트로 미리 잠그지만 **판정은 여기**다. 상수로 모아 두는 이유는
        //   같은 말을 두 곳에 적으면 한쪽만 고쳐지기 때문이다(시험도 이 상수를 계약으로 붙잡는다).
        private const string SelfDeactivateMsg = "자기 계정은 퇴사 처리할 수 없습니다.";
        private const string SelfRoleMsg       = "자기 권한은 바꿀 수 없습니다. 다른 관리자가 바꿔야 합니다.";
        private const string LastAdminMsg      = "관리자가 한 명뿐이라 처리할 수 없습니다. 먼저 다른 관리자를 지정하세요.";
        private const string UserGoneMsg       = "대상 직원을 찾을 수 없습니다 — 명부를 새로고침해 주세요.";
        // 순서 저장이 **낡은 명부**로 왔을 때(목록 밖에 활성 직원이 남아 있다). 저장을 통째로 거부한다 —
        //   반만 반영하면 그 사람의 서열이 소리 없이 사라진다(2026-09-11 적대 검토 R1 · §7-1a).
        //   ★ internal 인 이유는 하나다(2026-09-11 R3-H2): 브리지(MainWindow)가 "이 거부는 낡은 명부다"
        //     를 **문장 대조**로 알아야 그때만 명부를 다시 밀어 준다. 같은 문장을 저쪽에 한 벌 더 적으면
        //     한쪽만 고쳐지는 순간 그 푸시가 조용히 멈춘다 — 정본은 이 한 줄이다.
        internal const string StaleRosterMsg    = "명부가 바뀌었습니다 — 새로고침한 뒤 다시 저장하세요.";

        // 잠금 경합(1205 잠금 대기 초과 · 1213 교착) — 사람에게는 한 문장이다. 둘 다 "지금은 남이 잡고 있다"이고
        //   할 일도 같다(잠시 뒤 다시). 번호를 문장에 섞지 않는다 — 번호는 로그의 몫이다.
        private const string DbBusyMsg = "다른 관리자가 같은 항목을 편집 중입니다 — 잠시 후 다시 시도하세요.";
        // 그 '둘'을 세 자리(직원 문장 매핑 · 휴지통 복구 · 영구 삭제)가 똑같이 판정한다 — 번호를 세 곳에 적으면
        //   한쪽만 고쳐진다(2026-09-11 적대 검토 R5). 판정은 여기 한 줄이고, 부르는 쪽은 문장만 고른다.
        private static bool IsLockContention(MySqlException ex) => ex.Number is 1205 or 1213;
        // 매핑되지 않은 DB 오류의 마지막 문장. ★ 예외 원문을 사용자 문장에 이어 붙이지 않는다 —
        //   SQL·컬럼명·스택이 화면으로 새고, 정작 사용자는 무엇을 할지 알 수 없다(원문은 부르는 쪽이 _log 에 남긴다).
        private const string DbFailMsg = "처리하지 못했습니다(DB 오류).";

        // MySQL 에러번호 → 사용자 문장(직원 정보 전용). 과제용 MySqlMsg 와 섞지 않는다 — 같은 번호가
        //   다른 제약에서 오므로 한 함수로 합치면 "등록되지 않은 발주처입니다"가 직원 저장에서 튀어나온다.
        private static string MySqlUserMsg(MySqlException ex)
        {
            string m = ex.Message ?? "";
            //  잠금 경합(1205·1213)은 번호 판정을 IsLockContention 한 곳에서 한다 — 휴지통 두 곳과 같은 판정이다(R5).
            if (IsLockContention(ex)) return DbBusyMsg;
            switch (ex.Number)
            {
                case 1062: return "이미 등록된 ID 입니다.";
                case 1451:
                case 1452:
                    if (m.Contains("fk_user_title")) return "등록되지 않은 직급입니다.";
                    if (m.Contains("fk_user_org_id")) return "등록되지 않은 소속입니다.";
                    return "등록되지 않은 값이 있습니다 — 직급·소속을 다시 고르세요.";
                case 3819:   // CHECK 위반
                    if (m.Contains("chk_view_scope")) return "열람 범위 값이 올바르지 않습니다.";
                    if (m.Contains("chk_edit_role")) return "편집 권한 값이 올바르지 않습니다.";
                    return "값이 허용 범위를 벗어났습니다.";
                case 1406: return "값이 너무 깁니다 — 길이를 줄여 주세요.";
                case 1048: return "필수 항목이 비어 있습니다.";
                default:   return DbFailMsg;   // ★ 원문(Short(ex))은 부르는 쪽 _log 에만 — 화면에는 고정 문장이다
            }
        }

        // 지금 로그인한 사람의 login_id. OpenAdminAsync 가 이미 신원을 확인한 뒤에만 부른다
        //   — 그래서 여기서 빈 값이 나오는 경로는 없다(방어적으로 ""를 돌려주면 아래 조회가 0행이 된다).
        private string SessionLoginId()
        {
            var s = UserSession.Load(_dataDir, _log);
            return s == null ? "" : s.LoginId;
        }

        // 같은 트랜잭션에서 '나'의 user_id 와 권한을 잠근 채 읽는다(§4.4 — 판정과 갱신 사이에 값이 바뀌면 안 된다).
        private static async Task<int?> LockedMyUserIdAsync(MySqlConnection conn, MySqlTransaction tx, string me, CancellationToken ct)
        {
            await using var cmd = new MySqlCommand("SELECT user_id FROM app_user WHERE login_id=@me FOR UPDATE", conn, tx);
            cmd.Parameters.AddWithValue("@me", me);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            return await rd.ReadAsync(ct) ? IntOrNull(rd, "user_id") : null;
        }

        // 활성 관리자 수 — 같은 트랜잭션에서 잠근 채 센다. 이 한 줄이 '마지막 관리자' 규칙의 전부다.
        //   ★ FOR UPDATE 가 없으면 두 관리자가 동시에 서로를 강등해 **아무도 남지 않는다**(둘 다 COUNT=2 를 본다).
        private static async Task<long> LockedActiveAdminCountAsync(MySqlConnection conn, MySqlTransaction tx, CancellationToken ct)
        {
            await using var cmd = new MySqlCommand(
                "SELECT COUNT(*) FROM app_user WHERE edit_role='admin' AND is_active=1 FOR UPDATE", conn, tx);
            return Convert.ToInt64((await cmd.ExecuteScalarAsync(ct)) ?? 0L);
        }

        // 대상 직원 1행을 잠근 채 읽는다(없으면 null).
        //   ★ title·org_id 도 함께 읽는다 — '지금 저장돼 있는 값'은 그 값이 폐지됐어도 다시 저장할 수 있어야 하고
        //     (§4.3 의 2026-09-10 완화), 그 판정은 잠근 행의 값으로 해야 판정과 갱신이 갈리지 않는다.
        private static async Task<(int userId, string editRole, int isActive, string name, string title, int? orgId)?> LockedUserAsync(
            MySqlConnection conn, MySqlTransaction tx, int userId, CancellationToken ct)
        {
            await using var cmd = new MySqlCommand(
                "SELECT user_id, name, title, org_id, edit_role, is_active FROM app_user WHERE user_id=@uid FOR UPDATE", conn, tx);
            cmd.Parameters.AddWithValue("@uid", userId);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            if (!await rd.ReadAsync(ct)) return null;
            return (IntOrNull(rd, "user_id") ?? 0, Str(rd, "edit_role"), IntOrNull(rd, "is_active") ?? 0,
                    Str(rd, "name"), Str(rd, "title"), IntOrNull(rd, "org_id"));
        }

        // 직원 등록/수정. userId 가 없으면 INSERT, 있으면 그 행 UPDATE.
        //   ★ UPDATE 에서 login_id 를 건드리지 않는다 — 넷커스 소유 값이고, 바꿔야 하면 DBA(org-ops)다.
        //   ★ 신규 등록은 sort_order 를 비워 둔다(NULL = 그 소속의 맨 뒤). 관리자가 ▲▼ 로 끌어올려 저장한다.
        public async Task<(bool ok, string msg)> UpsertUserAsync(int? userId, string? loginId, string? name,
            string? title, int? orgId, string? viewScope, string? editRole)
        {
            // ── 앱단 선검증(형식·도메인) — DB 까지 보내지 않고 바로 사용자 문장으로. 최종 보증은 DB 제약이다.
            string lid = (loginId ?? "").Trim();
            string nm  = (name ?? "").Trim();
            string ti  = (title ?? "").Trim();
            string vs  = (viewScope ?? "").Trim();
            string er  = (editRole ?? "").Trim();
            if (!LoginIdShape.IsMatch(lid)) return (false, "로그인 ID 는 영문·숫자·._- 만 쓸 수 있습니다.");
            if (nm.Length == 0) return (false, "이름을 입력하세요.");
            if (!IsViewScope(vs)) return (false, "열람 범위 값이 올바르지 않습니다.");
            if (!IsEditRole(er)) return (false, "편집 권한 값이 올바르지 않습니다.");

            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                MySqlConnection conn;
                try { conn = await OpenAdminAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(직원 저장): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(직원 저장): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;
                string me = SessionLoginId();

                // 직급·소속 존재 검증 — 좋은 에러문구용(최종은 fk_user_title · fk_user_org_id).
                //   활성만 본다: 폐지된 직급·조직으로 **새로** 배정하지 못하게 하는 것이 이 화면의 목적이다.
                var titleSet = await LoadCodeNameSetAsync(conn, cts.Token, "title_code", activeOnly: true);

                // 활성 조직인가 — 두 분기(신규·수정)가 같은 문장을 쓴다. 같은 말을 두 벌로 적으면 한쪽만 고쳐진다.
                async Task<bool> OrgIsActiveAsync(MySqlTransaction? t)
                {
                    await using var q = new MySqlCommand("SELECT COUNT(*) FROM org_unit WHERE org_id=@o AND is_active=1", conn, t);
                    q.Parameters.AddWithValue("@o", orgId!.Value);
                    return Convert.ToInt64((await q.ExecuteScalarAsync(cts.Token)) ?? 0L) > 0;
                }

                await using var tx = (MySqlTransaction)await conn.BeginTransactionAsync(cts.Token);
                try
                {
                    // ── 잠금 방지(§4.4) — 판정과 갱신이 **같은 트랜잭션**이어야 한다. 수정이면 대상 행부터 잠근다.
                    (int userId, string editRole, int isActive, string name, string title, int? orgId)? target = null;
                    int? myId = null;
                    if (userId.HasValue)
                    {
                        target = await LockedUserAsync(conn, tx, userId.Value, cts.Token);
                        if (target == null) { await tx.RollbackAsync(cts.Token); return (false, UserGoneMsg); }
                        myId = await LockedMyUserIdAsync(conn, tx, me, cts.Token);
                    }

                    // ── 직급·소속 검사는 **한 벌**이다(2026-09-11 적대 검토 R7 — 전에는 두 분기에 같은 말이 두 벌 적혀 있었다).
                    //    기준: 활성이거나 **지금 저장된 값**이면 통과(2026-09-10 완화 · §4.3).
                    //    폐지된 직급을 단 사람의 이름 한 글자를 고치려 할 때 "등록되지 않은 직급입니다"로 막히면,
                    //    관리자는 그 사람의 직급부터 바꿔야 한다 — 화면은 저장된 값을 드롭다운에 그대로 남기므로
                    //    '보이는 값'과 '되는 값'이 갈린다. 저장된 값과의 대조는 **잠근 행**으로 한다(위 FOR UPDATE).
                    //    ★ 신규 등록은 curTitle·curOrg 가 없어(null) '지금 저장된 값' 갈래가 저절로 닫힌다 —
                    //      곧 **활성만**이다. "완화는 '이미 그 값인 사람'에게만" 이라는 규칙이 한 줄로 유지된다.
                    string? curTitle = target?.title;
                    int? curOrg = target?.orgId;
                    if (!titleSet.Contains(ti) && !string.Equals(ti, curTitle, StringComparison.Ordinal))
                    { await tx.RollbackAsync(cts.Token); return (false, "등록되지 않은 직급입니다."); }
                    if (orgId.HasValue && orgId.Value != (curOrg ?? -1) && !await OrgIsActiveAsync(tx))
                    { await tx.RollbackAsync(cts.Token); return (false, "등록되지 않은 소속입니다."); }

                    if (userId.HasValue)
                    {
                        //  ★ 이 갈래는 위에서 target 을 채우고 null 이면 이미 돌아섰다 — 다만 컴파일러의 흐름
                        //    분석은 두 분기를 건너오며 그 사실을 잃는다(CS8629). 한 번만 풀어 쓴다.
                        var tgt = target!.Value;

                        // (2) 자기 편집 권한은 올리는 것도 내리는 것도 못 한다. 값이 그대로면 통과(수정 자체를 막지는 않는다).
                        if (myId.HasValue && myId.Value == tgt.userId &&
                            !string.Equals(er, tgt.editRole, StringComparison.Ordinal))
                        { await tx.RollbackAsync(cts.Token); return (false, SelfRoleMsg); }

                        // (3) 마지막 활성 관리자를 강등할 수 없다.
                        if (string.Equals(tgt.editRole, "admin", StringComparison.Ordinal) && tgt.isActive != 0 &&
                            !string.Equals(er, "admin", StringComparison.Ordinal) &&
                            await LockedActiveAdminCountAsync(conn, tx, cts.Token) <= 1)
                        { await tx.RollbackAsync(cts.Token); return (false, LastAdminMsg); }

                        await using (var cmd = new MySqlCommand(
                            "UPDATE app_user SET name=@nm, title=@ti, org_id=@org, view_scope=@vs, edit_role=@er WHERE user_id=@uid", conn, tx))
                        {
                            cmd.Parameters.AddWithValue("@nm", nm);
                            cmd.Parameters.AddWithValue("@ti", ti);
                            cmd.Parameters.AddWithValue("@org", orgId.HasValue ? (object)orgId.Value : DBNull.Value);
                            cmd.Parameters.AddWithValue("@vs", vs);
                            cmd.Parameters.AddWithValue("@er", er);
                            cmd.Parameters.AddWithValue("@uid", userId.Value);
                            await cmd.ExecuteNonQueryAsync(cts.Token);
                        }
                        await tx.CommitAsync(cts.Token);
                        _log("직원 수정: " + nm + " (user_id=" + userId.Value + ", " + er + "/" + vs + ")");
                        return (true, "직원 정보를 저장했습니다.");
                    }
                    else
                    {
                        // 직급·소속은 위 한 벌이 이미 봤다 — 신규는 curTitle·curOrg 가 null 이라 **활성만**이다(R7).
                        // 신규 등록 — sort_order 는 넣지 않는다(NULL = 맨 뒤). user_id 는 AUTO_INCREMENT 가 준다.
                        await using (var cmd = new MySqlCommand(
                            "INSERT INTO app_user (login_id, name, title, org_id, view_scope, edit_role) " +
                            "VALUES (@lid,@nm,@ti,@org,@vs,@er)", conn, tx))
                        {
                            cmd.Parameters.AddWithValue("@lid", lid);
                            cmd.Parameters.AddWithValue("@nm", nm);
                            cmd.Parameters.AddWithValue("@ti", ti);
                            cmd.Parameters.AddWithValue("@org", orgId.HasValue ? (object)orgId.Value : DBNull.Value);
                            cmd.Parameters.AddWithValue("@vs", vs);
                            cmd.Parameters.AddWithValue("@er", er);
                            await cmd.ExecuteNonQueryAsync(cts.Token);
                        }
                        await tx.CommitAsync(cts.Token);
                        _log("직원 등록: " + nm + " (" + lid + ", " + er + "/" + vs + ")");
                        //  ★ 넷커스 계정을 만든 것이 아니다 — 이 앱에 등록한 것뿐이고, 그 ID 로 로그인이 되는지는
                        //    그 사람이 처음 로그인할 때 판명된다(USER-ADMIN §4.6). 그 사실을 문장에 담는다.
                        return (true, "직원을 등록했습니다. 본인이 주간보고 계정으로 로그인하면 사용할 수 있습니다.");
                    }
                }
                catch { await SafeRollbackAsync(tx); throw; }   // ★ 롤백은 취소되지 않은 토큰으로 — 원래 예외가 살아남아야 한다(SafeRollbackAsync 주석)
            }
            catch (MySqlException mex) { _log("직원 저장 실패(" + mex.Number + "): " + Short(mex)); return (false, MySqlUserMsg(mex)); }
            catch (Exception ex) { _log("직원 저장 실패: " + Short(ex)); return (false, "저장하지 못했습니다: " + Short(ex)); }
        }

        // 퇴사 처리(active=false) / 복구(true). 행은 지우지 않는다 — 과거 데이터 참조를 지킨다(§3.3).
        public async Task<(bool ok, string msg)> SetUserActiveAsync(int userId, bool active)
        {
            if (userId <= 0) return (false, "대상 직원이 지정되지 않았습니다.");
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                MySqlConnection conn;
                try { conn = await OpenAdminAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(직원 퇴사/복구): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(직원 퇴사/복구): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;
                string me = SessionLoginId();

                await using var tx = (MySqlTransaction)await conn.BeginTransactionAsync(cts.Token);
                try
                {
                    var target = await LockedUserAsync(conn, tx, userId, cts.Token);
                    if (target == null) { await tx.RollbackAsync(cts.Token); return (false, UserGoneMsg); }
                    int? myId = await LockedMyUserIdAsync(conn, tx, me, cts.Token);

                    if (!active)
                    {
                        // (1) 자기 자신을 퇴사 처리할 수 없다 — 하면 그 자리에서 관리 화면을 잃는다.
                        if (myId.HasValue && myId.Value == target.Value.userId)
                        { await tx.RollbackAsync(cts.Token); return (false, SelfDeactivateMsg); }
                        // (3) 마지막 활성 관리자를 퇴사 처리할 수 없다.
                        if (string.Equals(target.Value.editRole, "admin", StringComparison.Ordinal) && target.Value.isActive != 0 &&
                            await LockedActiveAdminCountAsync(conn, tx, cts.Token) <= 1)
                        { await tx.RollbackAsync(cts.Token); return (false, LastAdminMsg); }
                    }

                    //  ★ 2026-09-11 적대 검토(R3) — **복구는 서열을 비운다**(sort_order=NULL = 맨 뒤).
                    //    §7-1a(퇴사자의 옛 순번이 복구 때 새 서열 사이에 끼어든다)를 옛 판은 **순서 저장 쪽**에서
                    //    닫았다 — 저장할 때 목록 밖 숨김의 서열을 비웠다. 그 비우기와 복구 사이는 열려 있었다:
                    //    낡은 명부 판정(COUNT)과 재작성(CASE) 사이에 남이 복구하면 그 사람은 그 순간 **활성**이라
                    //    비우기 갈래(is_active=0)에 걸리지 않고 옛 숫자를 그대로 들고 새 서열(10·20·30…) 사이에
                    //    끼어들었다. 비우는 시점을 '저장할 때'가 아니라 **'돌아올 때'**로 옮기면 그 틈이 없다.
                    //    NULL 은 명부 ORDER BY 에서 맨 뒤라(§5.3) 복구한 사람은 맨 뒤에 서고, 관리자가 그때
                    //    한 번 끌어올리면 끝난다(구분·상태 코드의 '복구 = MAX+10' 과 같은 판단).
                    //    ★ 퇴사(active=false)는 서열을 손대지 않는다 — 그 값은 돌아올 때 어차피 비워지고,
                    //      지금 지우면 '퇴사 → 곧바로 복구' 가 멀쩡하던 자리를 잃는다.
                    string setActiveSql = active
                        ? "UPDATE app_user SET is_active=1, sort_order=NULL WHERE user_id=@uid"
                        : "UPDATE app_user SET is_active=0 WHERE user_id=@uid";
                    await using (var cmd = new MySqlCommand(setActiveSql, conn, tx))
                    {
                        cmd.Parameters.AddWithValue("@uid", userId);
                        await cmd.ExecuteNonQueryAsync(cts.Token);
                    }
                    await tx.CommitAsync(cts.Token);
                    _log("직원 " + (active ? "복구" : "퇴사 처리") + ": user_id=" + userId + " (" + target.Value.name + ")");
                    return (true, active ? "복구했습니다. 명부에 다시 표시됩니다." : "퇴사 처리했습니다. 기록은 남고 명부에서만 사라집니다.");
                }
                catch { await SafeRollbackAsync(tx); throw; }   // ★ 롤백은 취소되지 않은 토큰으로 — 원래 예외가 살아남아야 한다(SafeRollbackAsync 주석)
            }
            catch (MySqlException mex) { _log("직원 퇴사/복구 실패(" + mex.Number + "): " + Short(mex)); return (false, MySqlUserMsg(mex)); }
            catch (Exception ex) { _log("직원 퇴사/복구 실패: " + Short(ex)); return (false, "처리하지 못했습니다: " + Short(ex)); }
        }

        // 명부 서열 저장 — 받은 순서대로 sort_order = (index+1)*10 **전량 재작성**(§2).
        //   ★ '사이값 계산'도 '기존 값 밀기'도 하지 않는다. 관리자는 숫자를 보지 않고 화면의 순서만 정하며,
        //     그 순서가 곧 서열이다. 전량 재작성이면 규칙이 하나도 없어 어긋날 자리가 없다
        //     (구분·상태 코드값의 순서 재배치와 같은 방식 — 이 파일 아래쪽).
        //   ★ 잠금 방지 3규칙은 여기 없다 — 순서는 권한도 활성 상태도 건드리지 않는다.
        //   ★ 2026-09-11 적대 검토(R3) — §7-1a 는 이제 **복구 쪽**에서 닫힌다. 돌아오는 사람은 서열이
        //     비워진 채(sort_order=NULL = 맨 뒤) 돌아온다(SetUserActiveAsync · RestoreTrashAsync).
        //     그래서 이 함수는 목록 **밖**을 아예 건드리지 않는다 — 쓰는 자리는 받은 목록 하나다.
        //     옛 판(2026-09-10 → R1)은 저장할 때 숨긴 사람의 서열을 비웠는데, 그 비우기와 복구 사이가
        //     열려 있었다: 낡은 명부 판정(COUNT)과 재작성(CASE) 사이에 남이 복구하면 그 사람은 그 순간
        //     **활성**이라 비우기 갈래(`is_active=0`)에 걸리지 않고 옛 숫자를 그대로 들고 새 서열
        //     (10·20·30…) 사이에 끼어들었다. 비우는 시점을 '저장할 때' 에서 '돌아올 때' 로 옮기면
        //     그 틈 자체가 없다 — 그리고 이 문장은 받은 PK 들만 잠근다(표 전체도, 숨긴 사람도 아니다).
        //   ★ 낡은 명부 거부(①)는 그대로 남는다 — 그건 서열 비우기가 아니라 **낡은 목록**에 대한 가드다.
        //     목록 밖에 활성 직원이 있으면 화면이 낡았다는 뜻이고, 그대로 절반만 재작성하면 그 사람의
        //     서열이 소리 없이 어긋난다. 아무것도 쓰지 않고 StaleRosterMsg 로 거부한다(할 일은 새로고침 한 번).
        public async Task<(bool ok, string msg)> SaveUserOrderAsync(IReadOnlyList<int>? userIds)
        {
            if (userIds == null || userIds.Count == 0) return (false, "정렬할 명부가 비어 있습니다.");

            // 쓸 수 있는 id 만 추린다. ★ 받은 목록이 통째로 쓸모없으면(전부 0 이하) **어떤 문장을 내기도 전에**
            //   거부한다 — 빈 목록으로 진행하면 NOT IN () 가 전원을 목록 밖으로 만든다(빈 목록 거부와 같은 판단).
            var kept = new List<int>(userIds.Count);
            foreach (int uid in userIds) { if (uid > 0) kept.Add(uid); }
            if (kept.Count == 0) return (false, "정렬할 명부가 비어 있습니다.");

            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                MySqlConnection conn;
                try { conn = await OpenAdminAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(명부 순서): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(명부 순서): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;

                //  ★ user_id 는 위에서 걸러진 정수뿐이지만 그래도 파라미터로 묶는다 — 이 파일의 규약 ①.
                var keyPn = new List<string>(kept.Count);
                for (int i = 0; i < kept.Count; i++) keyPn.Add("@k" + i.ToString(CultureInfo.InvariantCulture));
                string inList = string.Join(",", keyPn);

                await using var tx = (MySqlTransaction)await conn.BeginTransactionAsync(cts.Token);
                try
                {
                    // ① 낡은 명부 거부(R1-a). 목록 밖에 **활성** 직원이 있으면 이 저장은 화면이 낡은 것이다.
                    //    FOR UPDATE 는 **지금 있는 그 행들**을 잠근다 — 판정과 갱신 사이에 남이 그 사람들의
                    //    is_active 나 서열을 바꾸지 못한다(§4.4 와 같은 규율).
                    //    ★ 2026-09-11 적대 검토(R2) — 전에는 여기에 "다른 트랜잭션이 끼어들지 못한다" 고만 적혀
                    //      있었다. 과장이다: 이 연결은 READ COMMITTED 라(§3.2) 갭 잠금이 없어 **새 INSERT 는
                    //      막지 못한다**. 다만 해롭지 않다 — 그 틈에 등록된 사람은 아래 UPDATE 의 WHERE 에도
                    //      걸리지 않아 sort_order 가 NULL 인 채 명부 맨 뒤에 서고, 다음 저장이 제자리를 준다.
                    long outsiders;
                    await using (var chk = new MySqlCommand())
                    {
                        chk.Connection = conn;
                        chk.Transaction = tx;
                        for (int i = 0; i < kept.Count; i++) chk.Parameters.AddWithValue(keyPn[i], kept[i]);
                        chk.CommandText = "SELECT COUNT(*) FROM app_user WHERE is_active=1 AND user_id NOT IN (" +
                                          inList + ") FOR UPDATE";
                        outsiders = Convert.ToInt64((await chk.ExecuteScalarAsync(cts.Token)) ?? 0L);
                    }
                    if (outsiders > 0)
                    {
                        await SafeRollbackAsync(tx);
                        _log("명부 순서 저장 거부: 목록 밖 활성 직원 " + outsiders + "명 — 화면의 명부가 낡았다(R1)");
                        return (false, StaleRosterMsg);
                    }

                    // ② 받은 순서대로 10·20·30… **전량 재작성**. 쓰는 자리는 받은 목록 하나뿐이다.
                    //    ★ 목록 밖은 손대지 않는다 — 숨긴 사람의 서열은 **복구될 때** NULL 이 된다(위 ★ R3).
                    //      여기서 비우면 '저장 사이에 남이 복구한 사람' 이 그 갈래를 빠져나간다(그게 R3 의 결함이다).
                    //    ★ updated_at 은 손대지 않는다 — 이 표의 감사 시각은 서버 ON UPDATE 의 몫이다(§4.5).
                    //    ★ 2026-09-11 적대 검토(R2) — **WHERE 가 없었다.** 문장의 대상이 app_user **전 행**이면
                    //      전원에 X 잠금이 걸리고(한 사람의 순서 저장이 표 전체를 잠근다), 드라이버가 돌려주는
                    //      영향 행 수도 표 크기가 된다. WHERE 는 받은 PK 들(IN)로 정확히 좁힌다.
                    int matched;
                    await using (var cmd = new MySqlCommand())
                    {
                        cmd.Connection = conn;
                        cmd.Transaction = tx;
                        var whens = new List<string>(kept.Count);
                        for (int i = 0; i < kept.Count; i++)
                        {
                            string op = "@o" + i.ToString(CultureInfo.InvariantCulture);
                            whens.Add("WHEN " + keyPn[i] + " THEN " + op);
                            cmd.Parameters.AddWithValue(keyPn[i], kept[i]);
                            cmd.Parameters.AddWithValue(op, (i + 1) * 10);
                        }
                        cmd.CommandText = "UPDATE app_user SET sort_order = CASE user_id " + string.Join(" ", whens) +
                                          " END WHERE user_id IN (" + inList + ")";
                        matched = await cmd.ExecuteNonQueryAsync(cts.Token);
                    }

                    await tx.CommitAsync(cts.Token);
                    //  ★ 2026-09-11 적대 검토(R3) — 두 숫자를 **함께** 남긴다. WHERE 가 받은 PK 로 좁혀진
                    //    지금(R2), 이 숫자는 '표 크기' 가 아니라 **받은 목록 중 실제로 있는 사람 수**다.
                    //    둘이 다르면 뜻이 하나뿐이다: 목록에 **이미 없는 id** 가 섞여 있었다(남이 그 사이에
                    //    지웠다). 낡은 명부 거부(①)는 '목록 밖 활성' 만 보므로 이 경우를 못 잡는다 —
                    //    로그의 이 한 줄이 유일한 단서다.
                    //    ★ 이 수는 MySqlConnector 의 CLIENT_FOUND_ROWS 규약상 '바뀐 행' 이 아니라
                    //      **조건에 맞은 행**이다(CALENDAR-TABLE-DESIGN "'영향 행 0' 은 한 가지 뜻이
                    //      아니다"). 그래서 '존재 확인' 으로는 읽어도 '몇 명의 서열이 실제로 달라졌나'
                    //      로는 읽지 않는다 — 같은 값을 다시 쓴 사람도 여기 포함된다.
                    _log("명부 순서 저장: 일치 행 " + matched + " / 대상 " + kept.Count + "명 전량 재작성");
                    return (true, "명부 순서를 저장했습니다.");
                }
                catch { await SafeRollbackAsync(tx); throw; }   // ★ 롤백은 취소되지 않은 토큰으로 — 원래 예외가 살아남아야 한다(SafeRollbackAsync 주석)
            }
            catch (MySqlException mex) { _log("명부 순서 저장 실패(" + mex.Number + "): " + Short(mex)); return (false, MySqlUserMsg(mex)); }
            catch (Exception ex) { _log("명부 순서 저장 실패: " + Short(ex)); return (false, "저장하지 못했습니다: " + Short(ex)); }
        }

        // ================================================================================
        // 구분/상태 코드테이블 — section_code / status_code (발주처 마스터와 대칭 · ENUM 대체)
        //   kind 문자열('section'|'status')로 테이블·컬럼을 단일 소스에서 해석한다(중복 분기 방지).
        //   드롭다운 = 활성만 sort_order 순, 관리 화면 = 숨김 포함 전체.
        // ================================================================================
        private static bool ResolveCodeKind(string? kind, out string table, out string projCol)
        {
            switch ((kind ?? "").Trim())
            {
                case "section": table = "section_code"; projCol = "section"; return true;
                case "status":  table = "status_code";  projCol = "status";  return true;
                default:        table = "";             projCol = "";        return false;
            }
        }

        // 활성 코드값 이름 배열 JSON — 편집 폼·필터 드롭다운 소스. 실패면 null(웹이 폴백/비활성).
        public async Task<string?> LoadSectionCodesJsonAsync() => await LoadActiveCodeNamesJsonAsync("section_code");
        public async Task<string?> LoadStatusCodesJsonAsync()  => await LoadActiveCodeNamesJsonAsync("status_code");
        private async Task<string?> LoadActiveCodeNamesJsonAsync(string table)
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = await OpenReadAsync(cts.Token);
                await using var cmd = new MySqlCommand($"SELECT name FROM {table} WHERE is_active=1 ORDER BY sort_order, name", conn);
                await using var rd = await cmd.ExecuteReaderAsync(cts.Token);
                var names = new List<string>();
                while (await rd.ReadAsync(cts.Token)) { string n = Str(rd, "name"); if (n.Length > 0) names.Add(n); }
                _log("DB 코드 로드(" + table + "): " + names.Count + "건");
                return JsonSerializer.Serialize(names);
            }
            catch (Exception ex) { _log("DB 코드 로드 실패(" + table + "): " + Short(ex)); return null; }
        }

        // 코드값 전체(숨김 포함) — 관리 화면 전용. [{name, active, sort}] JSON. 활성 먼저, 그 안에서 sort_order·name.
        public async Task<string?> LoadCodesFullJsonAsync(string? kind)
        {
            if (!ResolveCodeKind(kind, out string table, out _)) return null;
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = await OpenReadAsync(cts.Token);
                await using var cmd = new MySqlCommand($"SELECT name, sort_order, is_active FROM {table} ORDER BY is_active DESC, sort_order, name", conn);
                await using var rd = await cmd.ExecuteReaderAsync(cts.Token);
                var rows = new List<Dictionary<string, object?>>();
                while (await rd.ReadAsync(cts.Token))
                {
                    string n = Str(rd, "name");
                    if (n.Length == 0) continue;
                    rows.Add(new Dictionary<string, object?>
                    {
                        ["name"] = n,
                        ["active"] = (IntOrNull(rd, "is_active") ?? 1) != 0,
                        ["sort"] = IntOrNull(rd, "sort_order") ?? 0,
                    });
                }
                return JsonSerializer.Serialize(rows);
            }
            catch (Exception ex) { _log("DB 코드(전체) 로드 실패(" + table + "): " + Short(ex)); return null; }
        }

        // 같은 연결로 코드 이름 집합 로드(UpsertProjectAsync 선검증용 — 좋은 에러문구). activeOnly=false면 숨김 포함.
        private static async Task<HashSet<string>> LoadCodeNameSetAsync(MySqlConnection conn, System.Threading.CancellationToken ct, string table, bool activeOnly)
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            string sql = activeOnly ? $"SELECT name FROM {table} WHERE is_active=1" : $"SELECT name FROM {table}";
            await using var cmd = new MySqlCommand(sql, conn);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            while (await rd.ReadAsync(ct)) { string n = Str(rd, "name"); if (n.Length > 0) set.Add(n); }
            return set;
        }

        // ================================================================================
        // 쓰기 경로(P3.2) — 관리자 공식 과제 CRUD
        // 규약: ① 모든 값은 MySqlParameter 바인딩(문자열 연결 절대 금지) ② 예외는 전부 잡아
        //       (false, 한국어 메시지)로 환원하고 절대 throw하지 않는다 ③ 실패 사유는 사용자가
        //       '무엇을 고치면 되는지' 알 수 있는 문장으로만 노출한다(SQL/스택 노출 금지).
        // ※ 구분/상태는 하드코딩 배열이 아니라 코드테이블에서 로드해 선검증한다(최종 보증은 FK).
        // ================================================================================

        // 빈 문자열/공백 → DBNull(스키마의 NULL 허용 컬럼). 그 외는 트림한 값.
        private static object TextOrNull(string? s) =>
            string.IsNullOrWhiteSpace(s) ? DBNull.Value : (object)s!.Trim();

        // 'YYYY-MM-DD'만 날짜로 인정. 빈값 → DBNull(선진행·미정 계약은 날짜가 없다).
        // ★ 형식 불일치는 여기서 조용히 NULL로 만들지 않는다 — 호출부(UpsertProjectAsync)가 IsDateOrEmpty로 선검증해 실패를 되돌린다.
        //   (선검증을 통과한 값만 도달하므로 여기 도달 시엔 반드시 빈값 아니면 유효 날짜다. 방어적으로 파싱 실패는 DBNull.)
        private static bool IsDateOrEmpty(string? s)
        {
            string t = (s ?? "").Trim();
            return t.Length == 0 || DateTime.TryParseExact(t, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
        }
        private static object DateOrNull(string? s)
        {
            string t = (s ?? "").Trim();
            if (t.Length == 0) return DBNull.Value;
            return DateTime.TryParseExact(t, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
                ? (object)d.Date : DBNull.Value;
        }

        // MySQL 에러번호 → 사용자 문장. 스키마 제약(FK/길이/NOT NULL)이 그대로 사용자에게 닿는 지점이다.
        // ★ (customer, project_name) 유니크는 제거됐다(ADR-21) — project 1062는 uq_project_uid(UUID라 사실상 없음)만 의미.
        //   FK(1451/1452)는 3개(발주처·구분·상태) 중 어느 것인지 예외 메시지의 제약명으로 구분해 안내한다.
        private static string MySqlMsg(MySqlException ex)
        {
            switch (ex.Number)
            {
                case 1451:
                case 1452:
                {
                    string m = ex.Message ?? "";
                    if (m.Contains("fk_project_section")) return "등록되지 않은 구분입니다 — 구분·상태 관리에서 먼저 추가하세요.";
                    if (m.Contains("fk_project_status"))  return "등록되지 않은 상태입니다 — 구분·상태 관리에서 먼저 추가하세요.";
                    return "등록되지 않은 발주처입니다.";                                          // fk_project_customer
                }
                case 1406: return "값이 너무 깁니다 — 길이를 줄여 주세요.";                        // 길이 초과
                case 1048: return "필수 항목이 비어 있습니다.";                                    // NOT NULL
                default:   return "저장하지 못했습니다: " + Short(ex);
            }
        }

        // 이름 정규화(소프트 경고 비교용) — TRIM + 연속공백 1칸 축소 + 소문자화(ai_ci의 대소문자 무시 흉내).
        // ★ 하드 유니크(ai_ci·NO PAD)는 끝공백 변형을 '다른 값'으로 통과시켜 진짜 실수를 못 잡는다 — 그래서 C#에서 정규화 비교한다.
        private static string NormalizeName(string? s) =>
            System.Text.RegularExpressions.Regex.Replace((s ?? "").Trim(), @"\s+", " ").ToLowerInvariant();

        private const string OfflineMsg = "서버에 연결할 수 없습니다 — 편집은 온라인에서만 가능합니다.";

        // 공식 과제 추가/수정. uid가 비어 있으면 INSERT(uid는 DB DEFAULT (UUID())가 생성), 있으면 그 행 UPDATE.
        // 반환 3-튜플: (ok, msg, needConfirm). needConfirm=true는 '실패'가 아니라 '소프트 경고 확인 요청'이다
        //   — 비슷한 과제가 이미 있으니 그래도 추가할지 사용자에게 물으라는 신호. confirmSimilar=true로 재호출하면 검사 없이 저장한다.
        // 이름 필드(사업명·계약명·통상명칭·발주처)는 저장 전 TRIM. 빈 계약명/통상명칭은 ''로 저장(NULL 금지 — 비교 함정 방지).
        public async Task<(bool ok, string msg, bool needConfirm)> UpsertProjectAsync(string? uid, string section, string customer,
            string projectName, string? contractName, string? commonName, string? startDate, string? endDate, string? devEndDate, string? status,
            string? note = null, bool confirmSimilar = false)
        {
            // ── 앱단 선검증(형식·필수) — DB까지 보내지 않고 바로 사용자 문장으로. 구분/상태 존재 검증은 연결 후(코드테이블 로드).
            string u = (uid ?? "").Trim();
            string sec = (section ?? "").Trim(), cust = (customer ?? "").Trim(), pname = (projectName ?? "").Trim();
            string cn = (contractName ?? "").Trim(), mn = (commonName ?? "").Trim();   // 빈값은 ''(NULL 아님)
            string nt = (note ?? "").Trim();                                            // 비고(빈값 '')
            string st = (status ?? "").Trim(), sd = (startDate ?? "").Trim(), ed = (endDate ?? "").Trim();
            string ded = (devEndDate ?? "").Trim();                                    // 개발종료일 — 아래 선진행 분기에서 비우지 않는다
            if (pname.Length == 0) return (false, "사업명을 입력하세요.", false);
            if (cust.Length == 0) return (false, "발주처를 선택하세요.", false);
            if (sec.Length == 0) return (false, "구분을 선택하세요.", false);
            // 선진행 = 계약 전 단계 → 날짜·상태는 스키마상 NULL이어야 한다(웹 폼도 같은 규칙으로 잠근다).
            //   ※ '선진행'은 코드테이블 개명 가능하나, 이 특수규칙은 표준 시드값 기준(개명하면 규칙도 함께 손봐야 함).
            //   ★ ded(개발종료일)는 여기서 비우지 않는다 — 선진행은 '계약 전'일 뿐 개발은 이미 돌고 있어
            //     개발종료일이야말로 이 구간에서 유일하게 의미 있는 날짜다(2026-09-10 설계 결정).
            if (sec == "선진행") { sd = ""; ed = ""; st = ""; }
            // 날짜 형식 선검증 — 잘못된 형식을 조용히 NULL로 저장하지 않고 사용자에게 되돌린다(무음 데이터 유실 방지).
            if (!IsDateOrEmpty(sd)) return (false, "계약시작일 형식이 올바르지 않습니다(YYYY-MM-DD).", false);
            if (!IsDateOrEmpty(ed)) return (false, "계약종료일 형식이 올바르지 않습니다(YYYY-MM-DD).", false);
            if (!IsDateOrEmpty(ded)) return (false, "개발종료일 형식이 올바르지 않습니다(YYYY-MM-DD).", false);
            if (sd.Length > 0 && ed.Length > 0 && string.CompareOrdinal(sd, ed) > 0)
                return (false, "계약종료일이 계약시작일보다 빠릅니다.", false);
            // ★ ded 에는 순서 검증을 걸지 않는다 — 계약 시작 전에 개발이 끝나는 일이 실제로 있다
            //   (선진행분을 나중에 계약으로 덮는 경우). 계약종료일과의 대소도 마찬가지다.

            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                MySqlConnection conn;
                try { conn = await OpenWriteAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(과제 저장): " + nex.Message); return (false, nex.Message, false); }
                catch (Exception cex) { _log("DB 연결 실패(과제 저장): " + Short(cex)); return (false, OfflineMsg, false); }
                await using var connOwn = conn;   // 위에서 연 연결의 수명(본문은 conn 그대로 사용)

                // 구분/상태 존재 검증(코드테이블 로드) — 좋은 에러문구용. 최종 보증은 FK. 숨김 포함 전체로 검사해
                // 이미 저장된 값(나중에 숨긴 코드)이 편집 저장에서 막히지 않게 한다.
                var secSet = await LoadCodeNameSetAsync(conn, cts.Token, "section_code", activeOnly: false);
                if (!secSet.Contains(sec)) return (false, "등록되지 않은 구분입니다 — 구분·상태 관리에서 먼저 추가하세요.", false);
                if (st.Length > 0)
                {
                    var stSet = await LoadCodeNameSetAsync(conn, cts.Token, "status_code", activeOnly: false);
                    if (!stSet.Contains(st)) return (false, "등록되지 않은 상태입니다 — 구분·상태 관리에서 먼저 추가하세요.", false);
                }

                if (u.Length == 0)
                {
                    // ── 소프트 경고(신규 INSERT 한정) — 같은 발주처의 활성 과제 중 (사업명, 계약명)이 정규화 기준으로
                    //    같은 게 있으면 저장하지 말고 확인을 요청한다. confirmSimilar=true면 건너뛴다(사용자가 이미 '추가' 선택).
                    if (!confirmSimilar)
                    {
                        var sim = await FindSimilarActiveAsync(conn, cts.Token, cust, pname, cn);
                        if (sim.HasValue)
                        {
                            string cnShown = sim.Value.cn.Length > 0 ? sim.Value.cn : "(계약명 없음)";
                            return (false,
                                "비슷한 과제가 있습니다: " + cust + " / " + sim.Value.pn + " / " + cnShown + ". 그래도 추가하시겠습니까?",
                                true);
                        }
                    }
                    const string ins = "INSERT INTO project (section, customer, project_name, contract_name, common_name, " +
                                       "start_date, end_date, dev_end_date, status, note) " +
                                       "VALUES (@sec,@cust,@pn,@cn,@mn,@sd,@ed,@ded,@st,@note)";
                    await using (var cmd = new MySqlCommand(ins, conn))
                    {
                        BindProject(cmd, sec, cust, pname, cn, mn, sd, ed, ded, st, nt);
                        await cmd.ExecuteNonQueryAsync(cts.Token);
                    }
                    // uid는 DB가 만든다(assign-once) — 로그에만 남긴다. 웹은 재조회(loadProjects)로 새 행을 받는다.
                    string newUid = "";
                    await using (var q = new MySqlCommand("SELECT uid FROM project WHERE id=LAST_INSERT_ID()", conn))
                        newUid = (await q.ExecuteScalarAsync(cts.Token))?.ToString() ?? "";
                    _log("공식 과제 추가: " + pname + " (uid=" + (newUid.Length > 0 ? newUid : "?") + ")");
                    return (true, "공식 과제를 추가했습니다.", false);
                }
                else
                {
                    const string upd = "UPDATE project SET section=@sec, customer=@cust, project_name=@pn, contract_name=@cn, " +
                                       "common_name=@mn, start_date=@sd, end_date=@ed, dev_end_date=@ded, " +
                                       "status=@st, note=@note WHERE uid=@uid";
                    int n;
                    await using (var cmd = new MySqlCommand(upd, conn))
                    {
                        BindProject(cmd, sec, cust, pname, cn, mn, sd, ed, ded, st, nt);
                        cmd.Parameters.AddWithValue("@uid", u);
                        n = await cmd.ExecuteNonQueryAsync(cts.Token);
                    }
                    // 영향 행 0 = '값이 하나도 안 바뀜'과 '대상이 사라짐'이 겹친다 → 존재 확인으로 구분(유령 성공 방지).
                    if (n == 0)
                    {
                        await using var q = new MySqlCommand("SELECT COUNT(*) FROM project WHERE uid=@uid", conn);
                        q.Parameters.AddWithValue("@uid", u);
                        long cnt = Convert.ToInt64((await q.ExecuteScalarAsync(cts.Token)) ?? 0L);
                        if (cnt == 0) return (false, "대상 과제를 찾을 수 없습니다 — 목록을 새로고침해 주세요.", false);
                    }
                    _log("공식 과제 수정: " + pname + " (uid=" + u + ")");
                    return (true, "공식 과제를 저장했습니다.", false);
                }
            }
            catch (MySqlException mex)
            {
                _log("공식 과제 저장 실패(" + mex.Number + "): " + Short(mex));
                return (false, MySqlMsg(mex), false);
            }
            catch (Exception ex) { _log("공식 과제 저장 실패: " + Short(ex)); return (false, "저장하지 못했습니다: " + Short(ex), false); }
        }

        // 소프트 경고 후보 조회 — 같은 발주처의 활성 과제 중 (사업명, 계약명)이 '정규화 기준'으로 같은 첫 행의 표시값을 돌려준다(없으면 null).
        // 정규화 비교는 SQL 문자열함수가 아니라 C#에서 한다(발주처당 과제 수가 적어 안전하고, ai_ci·NO PAD의 함정을 피한다).
        private static async Task<(string pn, string cn)?> FindSimilarActiveAsync(
            MySqlConnection conn, System.Threading.CancellationToken ct, string customer, string projectName, string contractName)
        {
            string nPn = NormalizeName(projectName), nCn = NormalizeName(contractName);
            await using var cmd = new MySqlCommand(
                "SELECT project_name, contract_name FROM project WHERE customer=@c AND is_active=1", conn);
            cmd.Parameters.AddWithValue("@c", customer);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            while (await rd.ReadAsync(ct))
            {
                string ep = Str(rd, "project_name"), ec = Str(rd, "contract_name");
                if (NormalizeName(ep) == nPn && NormalizeName(ec) == nCn) return (ep, ec);
            }
            return null;
        }

        // INSERT/UPDATE 공통 파라미터 바인딩 — 두 경로가 어긋나지 않게 한 곳에서. cn/mn/nt는 이미 TRIM된 문자열('' 허용, NULL 금지).
        private static void BindProject(MySqlCommand cmd, string sec, string cust, string pname,
            string cn, string mn, string sd, string ed, string ded, string st, string nt)
        {
            cmd.Parameters.AddWithValue("@sec", sec);
            cmd.Parameters.AddWithValue("@cust", cust);
            cmd.Parameters.AddWithValue("@pn", pname);
            cmd.Parameters.AddWithValue("@cn", cn);   // '' 그대로(NULL 아님)
            cmd.Parameters.AddWithValue("@mn", mn);   // '' 그대로(NULL 아님)
            cmd.Parameters.AddWithValue("@sd", DateOrNull(sd));
            cmd.Parameters.AddWithValue("@ed", DateOrNull(ed));
            cmd.Parameters.AddWithValue("@ded", DateOrNull(ded));   // 개발종료일(빈값=NULL). 선진행이어도 살아 있다
            cmd.Parameters.AddWithValue("@st", TextOrNull(st));
            cmd.Parameters.AddWithValue("@note", nt);  // 비고 '' 그대로(NULL 아님)
        }

        // 소프트삭제/복구 — is_active=0이면 LoadProjectsJsonAsync가 아예 안 가져온다(목록에서 사라짐).
        // 복구(true) UI는 이번 범위 밖이지만 API는 대칭으로 열어 둔다(DB 직접 조작 없이 되돌릴 수 있게).
        public async Task<(bool ok, string msg)> SetProjectActiveAsync(string uid, bool active)
        {
            string u = (uid ?? "").Trim();
            if (u.Length == 0) return (false, "대상 과제가 지정되지 않았습니다.");
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                MySqlConnection conn;
                try { conn = await OpenWriteAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(과제 숨김/복구): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(과제 숨김/복구): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;   // 위에서 연 연결의 수명(본문은 conn 그대로 사용)

                await using var cmd = new MySqlCommand("UPDATE project SET is_active=@a WHERE uid=@uid", conn);
                cmd.Parameters.AddWithValue("@a", active ? 1 : 0);
                cmd.Parameters.AddWithValue("@uid", u);
                int n = await cmd.ExecuteNonQueryAsync(cts.Token);
                if (n == 0)
                {
                    await using var q = new MySqlCommand("SELECT COUNT(*) FROM project WHERE uid=@uid", conn);
                    q.Parameters.AddWithValue("@uid", u);
                    long cnt = Convert.ToInt64((await q.ExecuteScalarAsync(cts.Token)) ?? 0L);
                    if (cnt == 0) return (false, "대상 과제를 찾을 수 없습니다 — 목록을 새로고침해 주세요.");
                }
                _log("공식 과제 " + (active ? "복구" : "숨김") + ": uid=" + u);
                return (true, active ? "공식 과제를 목록에 다시 표시합니다." : "공식 과제를 목록에서 숨겼습니다.");
            }
            catch (MySqlException mex) { _log("공식 과제 숨김/복구 실패(" + mex.Number + "): " + Short(mex)); return (false, MySqlMsg(mex)); }
            catch (Exception ex) { _log("공식 과제 숨김/복구 실패: " + Short(ex)); return (false, "처리하지 못했습니다: " + Short(ex)); }
        }

        // ================================================================================
        // 발주처(customer) 마스터 관리 — 이름만 관리한다(더미 View_Customer가 No+이름뿐, customer 테이블도
        //   name+is_active+감사뿐이라 스키마 변경 없음). name이 자연키 PK이자 project.customer의 FK 타겟이며
        //   FK가 ON UPDATE CASCADE라 개명은 과제로 자동 전파된다(schema.sql 확인). 하드삭제는 앱에서 안 한다
        //   (사용자 방침: 실삭제는 DB에서 직접) — 앱은 소프트삭제(is_active)만. 규약은 UpsertProjectAsync와 동일.
        // ================================================================================

        // 발주처 존재/활성 상태 — null=없음, true=활성, false=숨김. (별도 짧은 조회 — 1062 안내를 나누는 용도)
        private async Task<bool?> CustomerActiveStateAsync(string name)
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = await OpenReadAsync(cts.Token);
                await using var cmd = new MySqlCommand("SELECT is_active FROM customer WHERE name=@n", conn);
                cmd.Parameters.AddWithValue("@n", name);
                var o = await cmd.ExecuteScalarAsync(cts.Token);
                if (o == null || o == DBNull.Value) return null;
                return Convert.ToInt32(o) != 0;
            }
            catch (Exception ex) { _log("발주처 상태 조회 실패: " + Short(ex)); return null; }
        }

        // 발주처 추가. name은 자연키 PK라 중복(1062)이면 이미 존재 — 활성/숨김을 구분해 안내(숨김이면 복구 필요).
        public async Task<(bool ok, string msg)> AddCustomerAsync(string? name)
        {
            string n = (name ?? "").Trim();
            if (n.Length == 0) return (false, "발주처명을 입력하세요.");
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                MySqlConnection conn;
                try { conn = await OpenWriteAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(발주처 추가): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(발주처 추가): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;   // 위에서 연 연결의 수명(본문은 conn 그대로 사용)

                await using var cmd = new MySqlCommand("INSERT INTO customer (name) VALUES (@n)", conn);
                cmd.Parameters.AddWithValue("@n", n);
                await cmd.ExecuteNonQueryAsync(cts.Token);
                _log("발주처 추가: " + n);
                return (true, "발주처를 추가했습니다.");
            }
            catch (MySqlException mex) when (mex.Number == 1062)
            {
                bool? active = await CustomerActiveStateAsync(n);
                if (active == false) return (false, "숨김 처리된 동일 발주처가 있습니다(복구 필요).");
                return (false, "이미 등록된 발주처입니다.");
            }
            catch (MySqlException mex) { _log("발주처 추가 실패(" + mex.Number + "): " + Short(mex)); return (false, "추가하지 못했습니다: " + Short(mex)); }
            catch (Exception ex) { _log("발주처 추가 실패: " + Short(ex)); return (false, "추가하지 못했습니다: " + Short(ex)); }
        }

        // 발주처 개명. FK가 ON UPDATE CASCADE라 project.customer는 자동 반영된다(따로 갱신 불필요).
        // oldName==newName은 no-op 성공, 대상 없음(0행)은 실패, newName 충돌(1062)은 안내.
        public async Task<(bool ok, string msg)> RenameCustomerAsync(string? oldName, string? newName)
        {
            string o = (oldName ?? "").Trim(), nw = (newName ?? "").Trim();
            if (o.Length == 0) return (false, "변경할 발주처를 지정하세요.");
            if (nw.Length == 0) return (false, "새 발주처명을 입력하세요.");
            if (string.Equals(o, nw, StringComparison.Ordinal)) return (true, "변경 사항이 없습니다.");   // no-op
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                MySqlConnection conn;
                try { conn = await OpenWriteAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(발주처 개명): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(발주처 개명): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;   // 위에서 연 연결의 수명(본문은 conn 그대로 사용)

                await using var cmd = new MySqlCommand("UPDATE customer SET name=@new WHERE name=@old", conn);
                cmd.Parameters.AddWithValue("@new", nw);
                cmd.Parameters.AddWithValue("@old", o);
                int n = await cmd.ExecuteNonQueryAsync(cts.Token);
                if (n == 0) return (false, "발주처를 찾을 수 없습니다 — 목록을 새로고침해 주세요.");
                _log("발주처 개명: " + o + " → " + nw + " (project.customer는 FK CASCADE로 자동 전파)");
                return (true, "발주처 이름을 변경했습니다. 이 발주처의 과제 표기도 함께 바뀝니다.");
            }
            catch (MySqlException mex) when (mex.Number == 1062)
            {
                return (false, "그 이름의 발주처가 이미 있습니다.");
            }
            catch (MySqlException mex) { _log("발주처 개명 실패(" + mex.Number + "): " + Short(mex)); return (false, "변경하지 못했습니다: " + Short(mex)); }
            catch (Exception ex) { _log("발주처 개명 실패: " + Short(ex)); return (false, "변경하지 못했습니다: " + Short(ex)); }
        }

        // 발주처 소프트삭제(숨김)/복구. 하드삭제는 하지 않는다(FK RESTRICT라 참조 중이면 DELETE도 막힌다).
        public async Task<(bool ok, string msg)> SetCustomerActiveAsync(string? name, bool active)
        {
            string n = (name ?? "").Trim();
            if (n.Length == 0) return (false, "대상 발주처가 지정되지 않았습니다.");
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                MySqlConnection conn;
                try { conn = await OpenWriteAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(발주처 숨김/복구): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(발주처 숨김/복구): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;   // 위에서 연 연결의 수명(본문은 conn 그대로 사용)

                await using var cmd = new MySqlCommand("UPDATE customer SET is_active=@a WHERE name=@n", conn);
                cmd.Parameters.AddWithValue("@a", active ? 1 : 0);
                cmd.Parameters.AddWithValue("@n", n);
                int cnt = await cmd.ExecuteNonQueryAsync(cts.Token);
                if (cnt == 0) return (false, "발주처를 찾을 수 없습니다 — 목록을 새로고침해 주세요.");
                _log("발주처 " + (active ? "복구" : "숨김") + ": " + n);
                return (true, active ? "발주처를 다시 표시합니다." : "발주처를 숨겼습니다.");
            }
            catch (MySqlException mex) { _log("발주처 숨김/복구 실패(" + mex.Number + "): " + Short(mex)); return (false, "처리하지 못했습니다: " + Short(mex)); }
            catch (Exception ex) { _log("발주처 숨김/복구 실패: " + Short(ex)); return (false, "처리하지 못했습니다: " + Short(ex)); }
        }

        // 이 발주처를 쓰는 '활성' 과제 수 — 숨김 확인 UX용(막지는 않는다). 오프라인/실패면 ok=false.
        public async Task<(bool ok, int count, string msg)> CountActiveProjectsByCustomerAsync(string? name)
        {
            string n = (name ?? "").Trim();
            if (n.Length == 0) return (false, 0, "대상 발주처가 지정되지 않았습니다.");
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                MySqlConnection conn;
                try { conn = await OpenWriteAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(발주처 참조수): " + nex.Message); return (false, 0, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(발주처 참조수): " + Short(cex)); return (false, 0, OfflineMsg); }
                await using var connOwn = conn;   // 위에서 연 연결의 수명(본문은 conn 그대로 사용)

                await using var cmd = new MySqlCommand("SELECT COUNT(*) FROM project WHERE customer=@c AND is_active=1", conn);
                cmd.Parameters.AddWithValue("@c", n);
                int count = (int)Convert.ToInt64((await cmd.ExecuteScalarAsync(cts.Token)) ?? 0L);
                return (true, count, "");
            }
            catch (Exception ex) { _log("발주처 참조수 조회 실패: " + Short(ex)); return (false, 0, "확인하지 못했습니다: " + Short(ex)); }
        }

        // ================================================================================
        // 구분/상태 코드값 관리 — 발주처 CRUD를 그대로 복제(kind로 테이블·컬럼 해석).
        //   추가=INSERT / 개명=UPDATE name(→FK CASCADE로 project 전파) / 숨김=is_active / 재배치=sort_order.
        //   하드삭제는 앱에서 안 한다(FK RESTRICT). 규약은 UpsertProjectAsync와 동일.
        // ================================================================================

        // 코드값 존재/활성 상태 — null=없음, true=활성, false=숨김(1062 안내 분기용).
        private async Task<bool?> CodeActiveStateAsync(string table, string name)
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = await OpenReadAsync(cts.Token);
                await using var cmd = new MySqlCommand($"SELECT is_active FROM {table} WHERE name=@n", conn);
                cmd.Parameters.AddWithValue("@n", name);
                var o = await cmd.ExecuteScalarAsync(cts.Token);
                if (o == null || o == DBNull.Value) return null;
                return Convert.ToInt32(o) != 0;
            }
            catch (Exception ex) { _log("코드 상태 조회 실패(" + table + "): " + Short(ex)); return null; }
        }

        private static string KindLabel(string kind) => kind == "status" ? "상태" : "구분";

        // 코드값 추가 — 다음 sort_order = MAX+10(끝에 붙임). name PK 중복(1062)이면 활성/숨김 구분 안내.
        public async Task<(bool ok, string msg)> AddCodeAsync(string? kind, string? name)
        {
            if (!ResolveCodeKind(kind, out string table, out _)) return (false, "대상 종류가 올바르지 않습니다.");
            string lbl = KindLabel(kind!.Trim());
            string n = (name ?? "").Trim();
            if (n.Length == 0) return (false, lbl + "명을 입력하세요.");
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                MySqlConnection conn;
                try { conn = await OpenWriteAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(" + table + " 추가): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(" + table + " 추가): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;   // 위에서 연 연결의 수명(본문은 conn 그대로 사용)

                // 다음 sort_order = MAX+10(끝에 붙임). INSERT와 같은 테이블 SELECT를 한 문장에 섞지 않게 두 단계로.
                int nextSort;
                await using (var q = new MySqlCommand($"SELECT COALESCE(MAX(sort_order),0)+10 FROM {table}", conn))
                    nextSort = (int)Convert.ToInt64((await q.ExecuteScalarAsync(cts.Token)) ?? 10L);
                await using var cmd = new MySqlCommand($"INSERT INTO {table} (name, sort_order) VALUES (@n, @s)", conn);
                cmd.Parameters.AddWithValue("@n", n);
                cmd.Parameters.AddWithValue("@s", nextSort);
                await cmd.ExecuteNonQueryAsync(cts.Token);
                _log(lbl + " 추가: " + n);
                return (true, lbl + "을(를) 추가했습니다.");
            }
            catch (MySqlException mex) when (mex.Number == 1062)
            {
                bool? active = await CodeActiveStateAsync(table, n);
                if (active == false) return (false, "숨김 처리된 동일 " + lbl + "이(가) 있습니다(복구 필요).");
                return (false, "이미 등록된 " + lbl + "입니다.");
            }
            catch (MySqlException mex) { _log(lbl + " 추가 실패(" + mex.Number + "): " + Short(mex)); return (false, "추가하지 못했습니다: " + Short(mex)); }
            catch (Exception ex) { _log(lbl + " 추가 실패: " + Short(ex)); return (false, "추가하지 못했습니다: " + Short(ex)); }
        }

        // 코드값 개명 — FK ON UPDATE CASCADE라 project.section/status가 자동 반영된다. no-op/0행/1062 처리.
        public async Task<(bool ok, string msg)> RenameCodeAsync(string? kind, string? oldName, string? newName)
        {
            if (!ResolveCodeKind(kind, out string table, out _)) return (false, "대상 종류가 올바르지 않습니다.");
            string lbl = KindLabel(kind!.Trim());
            string o = (oldName ?? "").Trim(), nw = (newName ?? "").Trim();
            if (o.Length == 0) return (false, "변경할 " + lbl + "을(를) 지정하세요.");
            if (nw.Length == 0) return (false, "새 " + lbl + "명을 입력하세요.");
            if (string.Equals(o, nw, StringComparison.Ordinal)) return (true, "변경 사항이 없습니다.");
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                MySqlConnection conn;
                try { conn = await OpenWriteAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(" + table + " 개명): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(" + table + " 개명): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;   // 위에서 연 연결의 수명(본문은 conn 그대로 사용)

                await using var cmd = new MySqlCommand($"UPDATE {table} SET name=@new WHERE name=@old", conn);
                cmd.Parameters.AddWithValue("@new", nw);
                cmd.Parameters.AddWithValue("@old", o);
                int n = await cmd.ExecuteNonQueryAsync(cts.Token);
                if (n == 0) return (false, lbl + "을(를) 찾을 수 없습니다 — 목록을 새로고침해 주세요.");
                _log(lbl + " 개명: " + o + " → " + nw + " (project는 FK CASCADE로 자동 전파)");
                return (true, lbl + "을(를) 변경했습니다. 이 " + lbl + "의 과제 표기도 함께 바뀝니다.");
            }
            catch (MySqlException mex) when (mex.Number == 1062) { return (false, "그 이름의 " + lbl + "이(가) 이미 있습니다."); }
            catch (MySqlException mex) { _log(lbl + " 개명 실패(" + mex.Number + "): " + Short(mex)); return (false, "변경하지 못했습니다: " + Short(mex)); }
            catch (Exception ex) { _log(lbl + " 개명 실패: " + Short(ex)); return (false, "변경하지 못했습니다: " + Short(ex)); }
        }

        // 코드값 소프트삭제(숨김)/복구. 하드삭제 안 함(FK RESTRICT).
        public async Task<(bool ok, string msg)> SetCodeActiveAsync(string? kind, string? name, bool active)
        {
            if (!ResolveCodeKind(kind, out string table, out _)) return (false, "대상 종류가 올바르지 않습니다.");
            string lbl = KindLabel(kind!.Trim());
            string n = (name ?? "").Trim();
            if (n.Length == 0) return (false, "대상 " + lbl + "이(가) 지정되지 않았습니다.");
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                MySqlConnection conn;
                try { conn = await OpenWriteAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(" + table + " 숨김/복구): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(" + table + " 숨김/복구): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;   // 위에서 연 연결의 수명(본문은 conn 그대로 사용)

                // 복구(active=true)는 sort_order를 '맨 뒤(MAX+10)'로 새로 부여한다.
                // 왜: 숨김은 sort_order를 그대로 두는데, 그 사이 순서 재배치가 '활성 값만' 10·20·30…으로
                //     재부여하므로, 옛 순번을 그대로 들고 복구되면 활성끼리 sort_order가 겹친다(순서가 이름
                //     콜레이션 tiebreak에 좌우돼 드롭다운이 불안정해짐 — 루프테스트 I5로 실측된 결함).
                //     맨 뒤로 보내면 항상 고유하고, 사용자가 ▲▼로 원하는 자리에 옮기면 된다.
                //     (MySQL은 UPDATE 대상 테이블을 직접 서브쿼리로 못 읽어 파생테이블로 감싼다.)
                string sql = active
                    ? $"UPDATE {table} SET is_active=1, sort_order=(SELECT s FROM (SELECT COALESCE(MAX(sort_order),0)+10 AS s FROM {table}) x) WHERE name=@n"
                    : $"UPDATE {table} SET is_active=0 WHERE name=@n";
                await using var cmd = new MySqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("@n", n);
                int cnt = await cmd.ExecuteNonQueryAsync(cts.Token);
                if (cnt == 0) return (false, lbl + "을(를) 찾을 수 없습니다 — 목록을 새로고침해 주세요.");
                _log(lbl + " " + (active ? "복구" : "숨김") + ": " + n);
                return (true, active ? lbl + "을(를) 다시 표시합니다." : lbl + "을(를) 숨겼습니다.");
            }
            catch (MySqlException mex) { _log(lbl + " 숨김/복구 실패(" + mex.Number + "): " + Short(mex)); return (false, "처리하지 못했습니다: " + Short(mex)); }
            catch (Exception ex) { _log(lbl + " 숨김/복구 실패: " + Short(ex)); return (false, "처리하지 못했습니다: " + Short(ex)); }
        }

        // 코드값 순서 재배치 — 받은 이름 순서대로 sort_order = (index+1)*10 재부여(트랜잭션). 존재하는 이름만 갱신.
        public async Task<(bool ok, string msg)> ReorderCodesAsync(string? kind, IReadOnlyList<string>? orderedNames)
        {
            if (!ResolveCodeKind(kind, out string table, out _)) return (false, "대상 종류가 올바르지 않습니다.");
            string lbl = KindLabel(kind!.Trim());
            if (orderedNames == null || orderedNames.Count == 0) return (false, "정렬할 " + lbl + " 목록이 비어 있습니다.");
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                MySqlConnection conn;
                try { conn = await OpenWriteAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(" + table + " 순서변경): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(" + table + " 순서변경): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;   // 위에서 연 연결의 수명(본문은 conn 그대로 사용)

                await using var tx = await conn.BeginTransactionAsync(cts.Token);
                try
                {
                    int order = 0;
                    foreach (var raw in orderedNames)
                    {
                        string nm = (raw ?? "").Trim();
                        if (nm.Length == 0) continue;
                        order += 10;
                        await using var cmd = new MySqlCommand($"UPDATE {table} SET sort_order=@s WHERE name=@n", conn, (MySqlTransaction)tx);
                        cmd.Parameters.AddWithValue("@s", order);
                        cmd.Parameters.AddWithValue("@n", nm);
                        await cmd.ExecuteNonQueryAsync(cts.Token);
                    }
                    await tx.CommitAsync(cts.Token);
                    _log(lbl + " 순서변경: " + orderedNames.Count + "건");
                    return (true, lbl + " 순서를 변경했습니다.");
                }
                catch { await SafeRollbackAsync(tx); throw; }   // ★ 롤백은 취소되지 않은 토큰으로 — 원래 예외가 살아남아야 한다(SafeRollbackAsync 주석)
            }
            catch (MySqlException mex) { _log(lbl + " 순서변경 실패(" + mex.Number + "): " + Short(mex)); return (false, "변경하지 못했습니다: " + Short(mex)); }
            catch (Exception ex) { _log(lbl + " 순서변경 실패: " + Short(ex)); return (false, "변경하지 못했습니다: " + Short(ex)); }
        }

        // 이 코드값을 쓰는 '활성' 과제 수 — 숨김 확인 UX용(막지는 않는다).
        public async Task<(bool ok, int count, string msg)> CountActiveProjectsByCodeAsync(string? kind, string? name)
        {
            if (!ResolveCodeKind(kind, out _, out string projCol)) return (false, 0, "대상 종류가 올바르지 않습니다.");
            string n = (name ?? "").Trim();
            if (n.Length == 0) return (false, 0, "대상이 지정되지 않았습니다.");
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                MySqlConnection conn;
                try { conn = await OpenWriteAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(코드 참조수): " + nex.Message); return (false, 0, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(코드 참조수): " + Short(cex)); return (false, 0, OfflineMsg); }
                await using var connOwn = conn;   // 위에서 연 연결의 수명(본문은 conn 그대로 사용)

                await using var cmd = new MySqlCommand($"SELECT COUNT(*) FROM project WHERE {projCol}=@n AND is_active=1", conn);
                cmd.Parameters.AddWithValue("@n", n);
                int count = (int)Convert.ToInt64((await cmd.ExecuteScalarAsync(cts.Token)) ?? 0L);
                return (true, count, "");
            }
            catch (Exception ex) { _log("코드 참조수 조회 실패: " + Short(ex)); return (false, 0, "확인하지 못했습니다: " + Short(ex)); }
        }

        private static string Str(DbDataReader rd, string col)
        {
            int i = rd.GetOrdinal(col);
            return rd.IsDBNull(i) ? "" : (rd.GetValue(i)?.ToString() ?? "");
        }

        private static int? IntOrNull(DbDataReader rd, string col)
        {
            int i = rd.GetOrdinal(col);
            if (rd.IsDBNull(i)) return null;
            try { return Convert.ToInt32(rd.GetValue(i)); } catch { return null; }
        }

        // 예외 메시지를 한 줄로 축약(과도한 스택/내부 예외 방지 — 로그·UI 표시용)
        private static string Short(Exception ex)
        {
            string m = ex.Message ?? ex.GetType().Name;
            m = m.Replace("\r", " ").Replace("\n", " ").Trim();
            return m.Length > 120 ? m.Substring(0, 120) + "…" : m;
        }

        // ================================================================================
        //  휴지통 — 숨긴 항목 조회 · 복구 · 영구 삭제 (TRASH-DELETE §3·§4)
        //    검토자 지적이 이 자리의 이유다: "숨기기만 되어 있지 실제로 지우는 메커니즘이 없다."
        //    과제는 한 걸음 더 비어 있었다 — 숨기면 앱에서 **다시는 볼 수 없다**(호스트가 is_active=1 만 읽는다).
        //    그래서 다섯 표(과제·인력·발주처·구분·상태)의 숨긴 항목을 한 화면에 모으고 거기서만 지운다.
        //
        //    ★ 세 함수 전부 OpenAdminAsync 다. 되돌릴 수 없는 조작은 가장 좁은 관문으로 — 발주처·코드의
        //      '숨김'은 지금처럼 editor 도 하지만(SetCustomerActiveAsync·SetCodeActiveAsync, 쓰기 관문)
        //      '삭제'와 '휴지통 열람'은 admin 뿐이다. 관문이 갈린 게 아니라 조작이 다른 것이다.
        //    ★ 지울 수 있는 것은 **숨긴 항목(is_active=0)** 뿐이다. 숨김 → 휴지통 → 삭제, 이 두 단계가
        //      실수 방지의 전부다(한 번에 지우는 길을 두지 않는다 · §2).
        //    ★ 되돌리기는 없다. 삭제 뒤 복구 수단은 DB 백업뿐이라, 확인은 **이름을 그대로 입력**하는 방식이고
        //      호스트도 그 입력을 대조한다(§5.2 — Trim 도 대소문자 무시도 하지 않는다).
        // ================================================================================

        // 대상 종류 → 표·키 컬럼·이름 컬럼·라벨. 다섯 표가 같은 뼈대라 해석을 한 곳에 모은다(분기 복제 방지).
        //   ★ 나오는 값은 전부 **코드 상수**다. 표·컬럼 이름이 SQL 에 이어 붙어도 사용자 입력은 닿지 않는다
        //     (값은 언제나 @파라미터 바인딩 — 이 파일의 규약 ①).
        //   ★ 2026-09-10 — 모르는 종류를 **여기서만** 거부한다(false). 복구·삭제의 SQL 갈래는 각 함수 안에 남기되,
        //     둘 다 다섯 종류를 전부 이름으로 적고 `default:` 는 거부다(옛 `default:` 는 status_code 였다 —
        //     종류가 하나 늘고 한쪽만 안 고치면 **엉뚱한 표가 복구·삭제된다**).
        //     SQL 을 이 해석기로 끌어올리지 않은 이유는 두 시험 계약이 그것을 막기 때문이다:
        //       · admin-auth — "쓰기 SQL 을 가진 메서드는 대상 표에 맞는 관문으로 연다"(app_user 쓰기 문자열을
        //         관문 없는 순수 함수에 두면 그 계약이 운다. 그 계약이 지키는 것은 fail-open 방지다).
        //       · trash-host ⑥ · user-admin ③ · xlsx-export — "다섯 표의 DELETE 문은 DeleteTrashAsync 안에만".
        private static bool ResolveTrashKind(string? kind, out string table, out string keyCol, out string nameCol, out string label)
        {
            switch ((kind ?? "").Trim())
            {
                case "project":  table = "project";      keyCol = "uid";     nameCol = "project_name"; label = "과제";   return true;
                case "user":     table = "app_user";     keyCol = "user_id"; nameCol = "name";         label = "인력";   return true;
                case "customer": table = "customer";     keyCol = "name";    nameCol = "name";         label = "발주처"; return true;
                case "section":  table = "section_code"; keyCol = "name";    nameCol = "name";         label = "구분";   return true;
                case "status":   table = "status_code";  keyCol = "name";    nameCol = "name";         label = "상태";   return true;
                default:         table = ""; keyCol = ""; nameCol = ""; label = ""; return false;
            }
        }

        // 인력 '기록 0건'의 기준 표 9개(§3.2).
        //   ★ 정본(db/deploy/schema-calendar.sql)의 `REFERENCES app_user` 집합에서 cal_user_pref·cal_user_rev 를
        //     뺀 것과 **글자까지 같아야 한다** — 시험 계약 ③ 이 정본을 파싱해 이 배열과 대조한다(표 이름 박제 금지).
        //   ★ 뺀 둘은 로그인 한 번이면 생기는 부속 행이라 '기록'이 아니다. 삭제 트랜잭션이 그 둘을 먼저 지운다.
        //   ★ cal_migration_log 는 뺄 수 없다 — XML 이관을 한 번이라도 한 계정은 일정이 있었던 계정이다(감사 흔적).
        private static readonly string[] UserRecordTables =
        {
            "cal_category", "cal_entry", "cal_todo", "cal_room", "cal_task_hours",
            "cal_attendance", "cal_report_daily", "cal_report_weekly", "cal_migration_log",
        };

        // 한 사람의 기록 수 = 9개 표의 합. 표 이름은 위 배열(상수)에서만 온다.
        private static string UserRefCountSql()
        {
            var parts = new List<string>(UserRecordTables.Length);
            foreach (var t in UserRecordTables) parts.Add("(SELECT COUNT(*) FROM " + t + " WHERE user_id=@u)");
            return "SELECT " + string.Join(" + ", parts);
        }

        // 휴지통에 뜨는 사람 = 퇴사자(is_active=0) 뿐이다. 기록 수도 **그 사람들만** 센다.
        //   ★ 전원을 세면 9개 표를 통째로 훑는다 — 일정·할일·공수는 재직자 전원의 전 기간 행이라
        //     휴지통을 한 번 열 때마다 그 스캔이 돌고, 정작 쓰는 값은 퇴사자 몇 명분이다(2026-09-10 검토 지적).
        //     서브쿼리 하나로 좁히면 각 표의 user_id 인덱스로 끝난다.
        private const string InactiveUserFilter = " WHERE user_id IN (SELECT user_id FROM app_user WHERE is_active=0)";

        // 퇴사자들의 기록 수를 한 문장으로 — 휴지통 목록이 사람마다 9회 왕복하지 않게(같은 배열이 소스다).
        private static string UserRefCountAllSql()
        {
            var parts = new List<string>(UserRecordTables.Length);
            foreach (var t in UserRecordTables)
                parts.Add("SELECT user_id, COUNT(*) AS c FROM " + t + InactiveUserFilter + " GROUP BY user_id");
            return "SELECT user_id, SUM(c) AS c FROM (" + string.Join(" UNION ALL ", parts) + ") x GROUP BY user_id";
        }

        // 거부 문구(§4.3) — 같은 말을 두 곳에 적으면 한쪽만 고쳐진다. 시험도 이 문장들을 계약으로 붙잡는다.
        private const string TrashKindMsg   = "알 수 없는 대상입니다.";
        private const string TrashGoneMsg   = "이미 삭제됐거나 없는 항목입니다 — 목록을 새로고침합니다.";
        private const string TrashActiveMsg = "숨긴(퇴사) 항목만 지울 수 있습니다. 먼저 숨기세요.";
        private const string TrashNameMsg   = "입력한 이름이 다릅니다.";
        private const string TrashSelfMsg   = "자기 계정은 지울 수 없습니다.";
        private const string TrashFkMsg     = "다른 기록이 붙어 있어 지울 수 없습니다.";
        private const string TrashNoTarget  = "대상이 지정되지 않았습니다.";
        private const string TrashDoneMsg   = "영구 삭제했습니다.";
        // 이미 활성인 항목의 복구 — 실패가 아니라 **목록이 낡은 것**이다. 그래서 문구가 새로고침을 시킨다(TrashGoneMsg 와 같은 성격).
        private const string TrashAlreadyActiveMsg = "이미 복구된 항목입니다 — 목록을 새로고침합니다.";
        // 조회·복구·삭제의 마지막 문장 셋 — ★ 예외 원문을 사용자 문장에 이어 붙이지 않는다(원문은 _log 의 몫이다).
        private const string TrashLoadFailMsg    = "휴지통을 불러오지 못했습니다.";
        private const string TrashRestoreFailMsg = "복구하지 못했습니다.";
        private const string TrashDeleteFailMsg  = "지우지 못했습니다.";
        private static string UserRecordsMsg(long n) => "기록 " + n + "건이 있어 지울 수 없습니다. 퇴사 상태로 유지됩니다.";
        private static string CodeInUseMsg(long n)   => "이 값을 쓰는 과제가 " + n + "건(숨긴 과제 포함) 있어 지울 수 없습니다.";

        // 삭제 직전 행을 로그에 남길 때 쓰는 직렬화 설정 — 감사 표를 새로 두지 않는 대신 이 한 줄이 그 역할이다(§4.4).
        //   ★ 한글을 \uXXXX 로 이스케이프하지 않는다. 사람이 읽지 못하는 감사 기록은 없는 것과 같다.
        private static readonly JsonSerializerOptions TrashLogJson = new JsonSerializerOptions
        {
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        };

        private static string RowJson(Dictionary<string, object?> row)
        {
            try { return JsonSerializer.Serialize(row, TrashLogJson); }
            catch (Exception ex) { return "{\"직렬화실패\":\"" + Short(ex) + "\"}"; }
        }

        // 부제 — 빈 조각은 빼고 ' · ' 로 잇는다(빈 칸이 점만 남는 줄을 만들지 않는다).
        private static string SubLine(params string[] parts)
        {
            var keep = new List<string>(parts.Length);
            foreach (var p in parts) { string t = (p ?? "").Trim(); if (t.Length > 0) keep.Add(t); }
            return string.Join(" · ", keep);
        }

        // 휴지통 한 줄 — 다섯 탭이 **같은 모양**이라 화면도 한 벌로 그린다(§5.1).
        private static Dictionary<string, object?> TrashRow(string key, string name, string sub, long refs, bool deletable, string why) =>
            new Dictionary<string, object?>
            {
                ["key"] = key,
                ["name"] = name,
                ["sub"] = sub,
                ["refs"] = refs,
                ["deletable"] = deletable,
                ["why"] = why,
            };

        private static string TrashFailJson(string msg) =>
            JsonSerializer.Serialize(new Dictionary<string, object?> { ["found"] = false, ["msg"] = msg });

        private static long LongOrZero(DbDataReader rd, string col)
        {
            int i = rd.GetOrdinal(col);
            if (rd.IsDBNull(i)) return 0L;
            try { return Convert.ToInt64(rd.GetValue(i)); } catch { return 0L; }
        }

        // 코드 3종(발주처·구분·상태)의 숨긴 값 + 참조 수. 참조는 **숨긴 과제까지 포함한** 전 과제다 —
        //   FK 가 RESTRICT 라 숨긴 과제 하나만 남아 있어도 DB 가 거부한다(활성만 세면 힌트가 거짓말을 한다).
        //   ★ 2026-09-11 적대 검토(R4) — 세는 일을 **DB 에 맡긴다**. 전에는 과제를 GROUP BY 로 걷어 와
        //     C# 사전(OrdinalIgnoreCase)으로 코드 이름과 맞췄는데, 그 비교는 DB 의 비교와 같지 않다:
        //     FK 컬럼의 콜레이션 utf8mb4_0900_ai_ci 는 대소문자뿐 아니라 **악센트·전각/반각까지** 무시해
        //     'Ａ' 와 'A' 를 같은 값으로 센다. C# 은 그 둘을 다른 키로 놓는다 — 그러면 힌트가 0 건이라
        //     화면이 [영구 삭제] 를 켜고, 같은 콜레이션으로 다시 세는 삭제 시점 판정이 1451 로 막는다
        //     (힌트 ≠ 판정이 되는 자리). LEFT JOIN 은 FK 와 **같은 콜레이션**으로 맞으므로 그 틈이 사라진다.
        //   ★ 표·컬럼 이름은 전부 코드 상수다(ResolveTrashKind 와 같은 규약) — 사용자 입력은 SQL 에 닿지 않는다.
        private static async Task<List<Dictionary<string, object?>>> TrashCodeListAsync(
            MySqlConnection conn, string table, string projCol, CancellationToken ct)
        {
            var rows = new List<Dictionary<string, object?>>();
            await using (var cmd = new MySqlCommand(
                "SELECT c.name AS nm, COUNT(p.uid) AS cnt FROM " + table + " c " +
                "LEFT JOIN project p ON p." + projCol + " = c.name " +
                "WHERE c.is_active=0 GROUP BY c.name ORDER BY c.name", conn))
            await using (var rd = await cmd.ExecuteReaderAsync(ct))
            {
                while (await rd.ReadAsync(ct))
                {
                    string n = Str(rd, "nm");
                    if (n.Length == 0) continue;
                    long c = LongOrZero(rd, "cnt");
                    rows.Add(TrashRow(n, n, "", c, c == 0, c == 0 ? "" : CodeInUseMsg(c)));
                }
            }
            return rows;
        }

        // 휴지통 조회 — 다섯 표의 **숨긴 항목만**(§4.2).
        //   회신 3분기: 관리자면 {found:true, admin:true, 목록 다섯} · 관리자가 아니면 {found:true, admin:false} ·
        //   연결/질의 실패면 {found:false, msg}. 권한 없음을 실패로 뭉개지 않는 이유는 늘 같다 —
        //   화면이 "서버가 이상한가?" 와 "내가 볼 수 없는가?" 를 구분해야 한다(USER-LOGIN §3.3 함정).
        //   ★ refs·deletable·why 는 **화면용 힌트**다. 최종 판정은 DeleteTrashAsync 가 같은 트랜잭션에서 다시 한다.
        //     힌트와 판정이 갈리면 판정이 이긴다(§4.2).
        public async Task<string?> LoadTrashJsonAsync(string loginId)
        {
            string me = (loginId ?? "").Trim();
            if (me.Length == 0) me = SessionLoginId();
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(12));
                MySqlConnection conn;
                try { conn = await OpenAdminAsync(cts.Token); }
                catch (NotAuthorizedException nex)
                {
                    // 미로그인·미등록·비활성·비관리자 — 넷 다 '휴지통을 볼 수 없는 사람'이다. 목록을 싣지 않는다.
                    //   ★ 그러나 넷이 같은 사건은 아니다. '관리자가 아니다'는 화면이 이미 자기 문장을 갖고 있지만
                    //     (「관리자만 사용할 수 있습니다.」), 미로그인·미등록·비활성은 **관문만 아는 사유**다.
                    //     그 문장을 msg 로 실어 화면이 그대로 보여 주게 한다 — 안 그러면 퇴사 처리된 사람이
                    //     "관리자만 사용할 수 있습니다"를 보고 원인을 영영 못 찾는다(USER-LOGIN §3.3 함정).
                    _log("휴지통 조회 거부(" + me + "): " + nex.Message);
                    var deny = new Dictionary<string, object?> { ["found"] = true, ["admin"] = false };
                    if (!nex.RoleOnly) deny["msg"] = nex.Message ?? "";
                    return JsonSerializer.Serialize(deny);
                }
                catch (Exception cex) { _log("DB 연결 실패(휴지통 조회): " + Short(cex)); return TrashFailJson(OfflineMsg); }
                await using var connOwn = conn;

                // 나 자신 — '자기 계정은 지울 수 없다' 힌트의 근거(판정은 삭제 트랜잭션이 잠근 채 다시 한다).
                int myId = 0;
                await using (var cmd = new MySqlCommand("SELECT user_id FROM app_user WHERE login_id=@me", conn))
                {
                    cmd.Parameters.AddWithValue("@me", me);
                    var o = await cmd.ExecuteScalarAsync(cts.Token);
                    if (o != null && o != DBNull.Value) myId = Convert.ToInt32(o);
                }

                // ① 과제 — 참조는 '이 과제를 편입한 개인 카테고리' 수다. FK 가 아니라 문자열 참조라(§3.1)
                //    지워도 DB 는 막지 않는다. 그래서 deletable 은 항상 true 고, 수는 확인창이 보여 준다.
                var catRefs = new Dictionary<string, long>(StringComparer.Ordinal);
                await using (var cmd = new MySqlCommand(
                    "SELECT project_uid, COUNT(*) AS c FROM cal_category WHERE project_uid IS NOT NULL AND project_uid<>'' GROUP BY project_uid", conn))
                await using (var rd = await cmd.ExecuteReaderAsync(cts.Token))
                {
                    while (await rd.ReadAsync(cts.Token)) catRefs[Str(rd, "project_uid")] = LongOrZero(rd, "c");
                }
                var projects = new List<Dictionary<string, object?>>();
                await using (var cmd = new MySqlCommand(
                    "SELECT uid, project_name, common_name, customer, section FROM project WHERE is_active=0 ORDER BY project_name", conn))
                await using (var rd = await cmd.ExecuteReaderAsync(cts.Token))
                {
                    while (await rd.ReadAsync(cts.Token))
                    {
                        string uid = Str(rd, "uid");
                        long c = catRefs.TryGetValue(uid, out var x) ? x : 0L;
                        projects.Add(TrashRow(uid, Str(rd, "project_name"),
                            SubLine(Str(rd, "common_name"), Str(rd, "customer"), Str(rd, "section")), c, true, ""));
                    }
                }

                // ② 인력 — 기록 9표 합계가 0 이고 자기 자신이 아닐 때만 지울 수 있다(§3.2).
                //    ★ 명부를 **먼저** 읽는다: 퇴사자가 하나도 없으면 9개 표 합산은 아예 돌리지 않는다
                //      (빈 탭 하나를 그리려고 전 기록을 훑을 이유가 없다).
                var retired = new List<(int uid, string name, string sub)>();
                await using (var cmd = new MySqlCommand(
                    "SELECT u.user_id, u.name, u.title, u.login_id, o.name AS org_unit " +
                    "FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id " +
                    "WHERE u.is_active=0 ORDER BY u.name", conn))
                await using (var rd = await cmd.ExecuteReaderAsync(cts.Token))
                {
                    while (await rd.ReadAsync(cts.Token))
                        retired.Add((IntOrNull(rd, "user_id") ?? 0, Str(rd, "name"),
                                     SubLine(Str(rd, "org_unit"), Str(rd, "title"), Str(rd, "login_id"))));
                }

                var userRefs = new Dictionary<int, long>();
                if (retired.Count > 0)
                {
                    await using var cmd = new MySqlCommand(UserRefCountAllSql(), conn);
                    await using var rd = await cmd.ExecuteReaderAsync(cts.Token);
                    while (await rd.ReadAsync(cts.Token))
                    {
                        int uid = IntOrNull(rd, "user_id") ?? 0;
                        if (uid > 0) userRefs[uid] = LongOrZero(rd, "c");
                    }
                }

                var users = new List<Dictionary<string, object?>>();
                foreach (var r in retired)
                {
                    long c = userRefs.TryGetValue(r.uid, out var x) ? x : 0L;
                    bool self = r.uid != 0 && r.uid == myId;
                    string why = c > 0 ? UserRecordsMsg(c) : (self ? TrashSelfMsg : "");
                    users.Add(TrashRow(r.uid.ToString(CultureInfo.InvariantCulture), r.name, r.sub, c, c == 0 && !self, why));
                }

                // ③ 코드 3종 — 셋이 같은 함수다(발주처도 이름 자연키 마스터라 코드와 구조가 같다).
                var customers = await TrashCodeListAsync(conn, "customer", "customer", cts.Token);
                var sections  = await TrashCodeListAsync(conn, "section_code", "section", cts.Token);
                var statuses  = await TrashCodeListAsync(conn, "status_code", "status", cts.Token);

                _log("휴지통 조회: 과제 " + projects.Count + " · 인력 " + users.Count + " · 발주처 " + customers.Count +
                     " · 구분 " + sections.Count + " · 상태 " + statuses.Count + "건");
                return JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["found"] = true,
                    ["admin"] = true,
                    ["projects"] = projects,
                    ["users"] = users,
                    ["customers"] = customers,
                    ["sections"] = sections,
                    ["statuses"] = statuses,
                });
            }
            // ★ 실패 문구는 **고정**이다 — 예외 원문(SQL·컬럼·스택)은 _log 에만 남긴다(§4.3, 2026-09-10 검토 지적).
            catch (Exception ex) { _log("휴지통 조회 실패: " + Short(ex)); return TrashFailJson(TrashLoadFailMsg); }
        }

        // 복구 — 숨긴 항목을 목록으로 되돌린다(is_active=1).
        //   ★ 설계 §4.1 은 기존 Set*ActiveAsync 재사용을 적었지만 그 넷은 OpenWriteAsync(editor 통과)다.
        //     재사용하면 "휴지통의 세 함수는 관리자 관문만 쓴다"는 계약이 그 자리에서 깨지므로 UPDATE 를 여기 둔다
        //     (TRASH-DELETE §11 정정). 기존 숨김/복구 경로는 손대지 않는다 — 그쪽은 그대로 editor 의 일이다.
        //   ★ 코드 2종의 복구는 sort_order 를 맨 뒤(MAX+10)로 새로 부여한다. 옛 순번을 들고 돌아오면 활성끼리
        //     sort_order 가 겹쳐 드롭다운 순서가 콜레이션에 좌우된다(SetCodeActiveAsync 가 루프테스트 I5 로
        //     실측해 고친 결함 — 여기서 되풀이하지 않는다).
        public async Task<(bool ok, string msg)> RestoreTrashAsync(string? kind, string? key)
        {
            if (!ResolveTrashKind(kind, out string table, out string keyCol, out string nameCol, out string label))
                return (false, TrashKindMsg);
            string kd = (kind ?? "").Trim();
            string k = (key ?? "").Trim();
            if (k.Length == 0) return (false, TrashNoTarget);
            object keyVal = k;
            if (kd == "user")
            {
                if (!int.TryParse(k, NumberStyles.Integer, CultureInfo.InvariantCulture, out int tid) || tid <= 0)
                    return (false, TrashNoTarget);
                keyVal = tid;
            }
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                MySqlConnection conn;
                try { conn = await OpenAdminAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(휴지통 복구): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(휴지통 복구): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;

                await using var tx = (MySqlTransaction)await conn.BeginTransactionAsync(cts.Token);
                try
                {
                    // 대상 행을 잠근 채 읽는다 — 없으면 다른 관리자가 이미 지운 것이다(목록을 새로 그리게 한다).
                    //   ★ is_active 도 **같이 잠근 채** 읽는다. 두 관리자가 같은 항목을 동시에 복구하면
                    //     뒤에 온 쪽이 이미 활성인 행에 UPDATE 를 걸고, 구분·상태는 그 자리에서 sort_order 를
                    //     MAX+10 으로 **다시** 매겨 멀쩡히 쓰이던 값이 목록 맨 뒤로 튄다(2026-09-10 검토 지적).
                    //     '이미 복구됨'은 실패가 아니라 **낡은 목록**이므로, 문구가 새로고침을 시킨다.
                    bool found = false;
                    string name = "";
                    int wasActive = 0;
                    await using (var sel = new MySqlCommand(
                        "SELECT " + nameCol + " AS nm, is_active AS act FROM " + table + " WHERE " + keyCol + "=@k FOR UPDATE", conn, tx))
                    {
                        sel.Parameters.AddWithValue("@k", keyVal);
                        await using var rd = await sel.ExecuteReaderAsync(cts.Token);
                        if (await rd.ReadAsync(cts.Token)) { found = true; name = Str(rd, "nm"); wasActive = IntOrNull(rd, "act") ?? 0; }
                    }
                    if (!found) { await tx.RollbackAsync(cts.Token); return (false, TrashGoneMsg); }
                    if (wasActive != 0) { await tx.RollbackAsync(cts.Token); return (false, TrashAlreadyActiveMsg); }

                    // ★ 다섯 종류를 **전부 이름으로** 적고, 모르는 종류는 거부한다 — 옛 `default:` 는 status_code 였고,
                    //   종류가 하나 늘고 여기만 안 고치면 **엉뚱한 표가 복구된다**(모르는 종류는 ResolveTrashKind 가
                    //   이미 걸러 여기 닿지 않지만, '기본값으로 아무 표나'는 남겨 둘 수 없는 형태다).
                    //   구분·상태만 sort_order 를 맨 뒤(MAX+10)로 다시 매긴다 — 옛 순번을 들고 돌아오면 활성끼리 겹친다.
                    string sql;
                    switch (kd)
                    {
                        case "project":  sql = "UPDATE project SET is_active=1 WHERE uid=@k"; break;
                        //  ★ 인력의 복구는 sort_order 를 **비운다**(NULL = 명부 맨 뒤) — 코드 2종의 MAX+10 과
                        //    같은 이유이고, SetUserActiveAsync 의 복구와 **같은 규칙**이다(2026-09-11 R3).
                        //    옛 순번을 들고 돌아오면 그 숫자가 활성 서열(10·20·30…) 사이에 끼어든다(USER-ADMIN §7-1a).
                        case "user":     sql = "UPDATE app_user SET is_active=1, sort_order=NULL WHERE user_id=@k"; break;
                        case "customer": sql = "UPDATE customer SET is_active=1 WHERE name=@k"; break;
                        case "section":  sql = "UPDATE section_code SET is_active=1, sort_order=(SELECT s FROM (SELECT COALESCE(MAX(sort_order),0)+10 AS s FROM section_code) x) WHERE name=@k"; break;
                        case "status":   sql = "UPDATE status_code SET is_active=1, sort_order=(SELECT s FROM (SELECT COALESCE(MAX(sort_order),0)+10 AS s FROM status_code) x) WHERE name=@k"; break;
                        //  ★ ResolveTrashKind 가 이미 걸러 여기 닿지 않는다. 닿았다면 종류가 늘었는데 이 switch 만
                        //    안 고친 것이다 — 롤백+거부 문장을 한 벌 더 적어 조용히 덮지 말고 **터뜨린다**(2026-09-11 R5).
                        //    바깥 catch 가 롤백하고 고정 문구를 돌려주며, 원인은 로그에 그대로 남는다.
                        default:         throw new InvalidOperationException("알 수 없는 휴지통 종류(복구): " + kd);
                    }
                    await using (var cmd = new MySqlCommand(sql, conn, tx))
                    {
                        cmd.Parameters.AddWithValue("@k", keyVal);
                        await cmd.ExecuteNonQueryAsync(cts.Token);
                    }
                    await tx.CommitAsync(cts.Token);
                    _log("휴지통 복구 " + label + " " + k + " (" + name + ")");
                    if (kd == "project") return (true, "공식 과제를 목록에 다시 표시합니다.");
                    if (kd == "user")    return (true, "복구했습니다. 명부에 다시 표시됩니다.");
                    return (true, "복구했습니다.");
                }
                catch { await SafeRollbackAsync(tx); throw; }   // ★ 롤백은 취소되지 않은 토큰으로 — 원래 예외가 살아남아야 한다(SafeRollbackAsync 주석)
            }
            // ★ 실패 문구는 **고정**이다 — 예외 원문(SQL·컬럼·스택)은 _log 에만 남긴다(§4.3, 2026-09-10 검토 지적).
            //   잠금 경합(1205·1213)만 따로 말해 준다 — 두 관리자가 같은 항목을 만지는 상황이라 '다시 하면 된다'가 안내다.
            catch (MySqlException mex)
            {
                _log("휴지통 복구 실패(" + mex.Number + "): " + Short(mex));
                return (false, IsLockContention(mex) ? DbBusyMsg : TrashRestoreFailMsg);
            }
            catch (Exception ex) { _log("휴지통 복구 실패: " + Short(ex)); return (false, TrashRestoreFailMsg); }
        }

        // 영구 삭제 — 되돌릴 수 없다. 다섯 표의 뼈대가 같다(§3.4):
        //   행 잠금 → 숨김인가 → 참조 수 **재계산** → 이름 대조 → (인력) 부속 2표 → DELETE → 로그 한 줄.
        //   ★ 화면이 같은 판정을 힌트로 먼저 보여 주지만 그건 조회 시점 값이다. 판정은 여기, 트랜잭션 안이다.
        //   ★ 다섯 표의 DELETE 문은 이 함수 안에만 있다 — 시험 계약 ①·⑥ 이 그 사실을 잠근다.
        //   ★ 자기 계정 금지는 퇴사 규칙(§4.4-1)과 **한 벌**이다. 기록 0 이면 로그인한 적도 없어 실제로는
        //     걸릴 일이 없지만, 규칙이 두 벌이 되는 순간 한쪽이 낡는다.
        public async Task<(bool ok, string msg)> DeleteTrashAsync(string? kind, string? key, string? confirm)
        {
            if (!ResolveTrashKind(kind, out string table, out string keyCol, out string nameCol, out string label))
                return (false, TrashKindMsg);
            string kd = (kind ?? "").Trim();
            string k = (key ?? "").Trim();
            if (k.Length == 0) return (false, TrashNoTarget);
            object keyVal = k;
            int targetUserId = 0;
            if (kd == "user")
            {
                if (!int.TryParse(k, NumberStyles.Integer, CultureInfo.InvariantCulture, out targetUserId) || targetUserId <= 0)
                    return (false, TrashNoTarget);
                keyVal = targetUserId;
            }
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                MySqlConnection conn;
                try { conn = await OpenAdminAsync(cts.Token); }
                catch (NotAuthorizedException nex) { _log("권한 거부(영구 삭제): " + nex.Message); return (false, nex.Message); }
                catch (Exception cex) { _log("DB 연결 실패(영구 삭제): " + Short(cex)); return (false, OfflineMsg); }
                await using var connOwn = conn;
                string me = SessionLoginId();

                await using var tx = (MySqlTransaction)await conn.BeginTransactionAsync(cts.Token);
                try
                {
                    // ① 행 전체를 잠근 채 읽는다 — 이것이 로그에 남길 '삭제 직전 행'이다(§4.4).
                    var row = new Dictionary<string, object?>(StringComparer.Ordinal);
                    await using (var sel = new MySqlCommand(
                        "SELECT * FROM " + table + " WHERE " + keyCol + "=@k FOR UPDATE", conn, tx))
                    {
                        sel.Parameters.AddWithValue("@k", keyVal);
                        await using var rd = await sel.ExecuteReaderAsync(cts.Token);
                        if (await rd.ReadAsync(cts.Token))
                            for (int i = 0; i < rd.FieldCount; i++)
                                row[rd.GetName(i)] = rd.IsDBNull(i) ? null : rd.GetValue(i);
                    }
                    if (row.Count == 0) { await tx.RollbackAsync(cts.Token); return (false, TrashGoneMsg); }

                    // ② 숨긴 항목만 지운다. 읽지 못하면 **활성으로 친다**(fail-closed) — 모르는 상태를 지우지 않는다.
                    int isActive = 1;
                    try { isActive = row.TryGetValue("is_active", out var av) && av != null ? Convert.ToInt32(av) : 1; }
                    catch { isActive = 1; }
                    if (isActive != 0) { await tx.RollbackAsync(cts.Token); return (false, TrashActiveMsg); }

                    // ③ 참조 수 재계산 — 힌트가 낡았을 수 있다(두 관리자가 동시에 만지면).
                    long refs = 0L;
                    if (kd == "user")
                    {
                        await using (var cmd = new MySqlCommand(UserRefCountSql(), conn, tx))
                        {
                            cmd.Parameters.AddWithValue("@u", targetUserId);
                            refs = Convert.ToInt64((await cmd.ExecuteScalarAsync(cts.Token)) ?? 0L);
                        }
                        if (refs > 0) { await tx.RollbackAsync(cts.Token); return (false, UserRecordsMsg(refs)); }
                        int? myId = await LockedMyUserIdAsync(conn, tx, me, cts.Token);
                        if (myId.HasValue && myId.Value == targetUserId)
                        { await tx.RollbackAsync(cts.Token); return (false, TrashSelfMsg); }
                    }
                    else if (kd == "project")
                    {
                        // 과제는 참조가 있어도 지운다 — 개인 카테고리는 문자열 참조라 db_gone 으로 남는다(§3.1).
                        //   막는 대신 **몇 명이 편입 중이었는지**를 로그에 남긴다.
                        await using var cmd = new MySqlCommand("SELECT COUNT(*) FROM cal_category WHERE project_uid=@k", conn, tx);
                        cmd.Parameters.AddWithValue("@k", k);
                        refs = Convert.ToInt64((await cmd.ExecuteScalarAsync(cts.Token)) ?? 0L);
                    }
                    else
                    {
                        // 코드 3종은 그 값을 쓰는 과제가 **숨긴 과제까지 포함해** 0건일 때만. 최종 보증은 FK RESTRICT 다.
                        string cntSql = kd == "customer" ? "SELECT COUNT(*) FROM project WHERE customer=@n"
                                      : kd == "section"  ? "SELECT COUNT(*) FROM project WHERE section=@n"
                                                         : "SELECT COUNT(*) FROM project WHERE status=@n";
                        await using (var cmd = new MySqlCommand(cntSql, conn, tx))
                        {
                            cmd.Parameters.AddWithValue("@n", k);
                            refs = Convert.ToInt64((await cmd.ExecuteScalarAsync(cts.Token)) ?? 0L);
                        }
                        if (refs > 0) { await tx.RollbackAsync(cts.Token); return (false, CodeInUseMsg(refs)); }
                    }

                    // ④ 이름 대조 — Trim 도 대소문자 무시도 하지 않는다(§5.2). 이름에 공백이 있으면 공백까지 같아야 한다.
                    string storedName = row.TryGetValue(nameCol, out var nv) && nv != null ? (nv.ToString() ?? "") : "";
                    if (!string.Equals(confirm ?? "", storedName, StringComparison.Ordinal))
                    { await tx.RollbackAsync(cts.Token); return (false, TrashNameMsg); }

                    // ⑤ (인력) 부속 2표를 같은 트랜잭션에서 먼저 지운다 — 로그인 한 번이면 생기는 행이라
                    //    '기록 0' 계정에도 남아 있고, 남으면 FK RESTRICT 가 1451 로 거부한다(§3.1).
                    if (kd == "user")
                    {
                        await using (var cmd = new MySqlCommand("DELETE FROM cal_user_pref WHERE user_id=@u", conn, tx))
                        { cmd.Parameters.AddWithValue("@u", targetUserId); await cmd.ExecuteNonQueryAsync(cts.Token); }
                        await using (var cmd = new MySqlCommand("DELETE FROM cal_user_rev WHERE user_id=@u", conn, tx))
                        { cmd.Parameters.AddWithValue("@u", targetUserId); await cmd.ExecuteNonQueryAsync(cts.Token); }
                    }

                    // ⑥ 본체. ★ 다섯 종류를 **전부 이름으로** 적고, 모르는 종류는 거부한다 —
                    //    옛 `default:` 는 status_code 였다. 종류가 하나 늘고 여기만 안 고치면 **엉뚱한 표가 지워진다**
                    //    (되돌릴 수 없는 조작에서 '기본값으로 아무거나'는 허용될 수 없다 · 2026-09-10 검토 지적).
                    //    이 다섯 줄이 이 파일에서 DELETE 문이 사는 유일한 자리다(시험 계약 ⑥).
                    string delSql;
                    switch (kd)
                    {
                        case "project":  delSql = "DELETE FROM project WHERE uid=@k"; break;
                        case "user":     delSql = "DELETE FROM app_user WHERE user_id=@k"; break;
                        case "customer": delSql = "DELETE FROM customer WHERE name=@k"; break;
                        case "section":  delSql = "DELETE FROM section_code WHERE name=@k"; break;
                        case "status":   delSql = "DELETE FROM status_code WHERE name=@k"; break;
                        //  ★ 복구 쪽과 같은 이유로 **터뜨린다**(R5) — 되돌릴 수 없는 조작에서 '기본값으로 아무거나' 도,
                        //    거부 문장 복제도 답이 아니다. 여기 닿았다는 것은 종류가 늘고 이 switch 만 안 고쳤다는 뜻이다.
                        default:         throw new InvalidOperationException("알 수 없는 휴지통 종류(영구 삭제): " + kd);
                    }
                    int n;
                    await using (var cmd = new MySqlCommand(delSql, conn, tx))
                    {
                        cmd.Parameters.AddWithValue("@k", keyVal);
                        n = await cmd.ExecuteNonQueryAsync(cts.Token);
                    }
                    if (n == 0) { await tx.RollbackAsync(cts.Token); return (false, TrashGoneMsg); }
                    await tx.CommitAsync(cts.Token);
                    _log("영구 삭제 " + kd + " " + k + " by " + me + " " + RowJson(row) + " 참조 " + refs + "건");
                    return (true, TrashDoneMsg);
                }
                catch { await SafeRollbackAsync(tx); throw; }   // ★ 롤백은 취소되지 않은 토큰으로 — 원래 예외가 살아남아야 한다(SafeRollbackAsync 주석)
            }
            catch (MySqlException mex) when (mex.Number == 1451)
            {
                // 힌트가 틀렸을 때의 최후 방어 — 어느 제약이 붙들었는지는 로그에만 남긴다(사용자 문장은 고정이다).
                _log("영구 삭제 거부(FK 1451) " + label + " " + k + ": " + Short(mex));
                return (false, TrashFkMsg);
            }
            // ★ 실패 문구는 **고정**이다 — 예외 원문(SQL·컬럼·스택)은 _log 에만 남긴다(§4.3, 2026-09-10 검토 지적).
            //   잠금 경합(1205·1213)만 따로 말해 준다 — 두 관리자가 같은 항목을 만지는 상황이라 '다시 하면 된다'가 안내다.
            catch (MySqlException mex)
            {
                _log("영구 삭제 실패(" + mex.Number + "): " + Short(mex));
                return (false, IsLockContention(mex) ? DbBusyMsg : TrashDeleteFailMsg);
            }
            catch (Exception ex) { _log("영구 삭제 실패: " + Short(ex)); return (false, TrashDeleteFailMsg); }
        }
    }
}
