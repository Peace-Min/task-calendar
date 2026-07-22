using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MySqlConnector;

namespace TaskCalendarWidget
{
    // 과제 DB 연동 — 사내 MySQL(taskmgr)의 공식 과제(project)를 읽어 웹으로 넘기고(READ),
    // 관리자 편집(P3.2)의 쓰기(UPSERT/소프트삭제)를 처리한다. 오프라인이면 읽기는 조용히 실패해
    // 웹이 로컬 캐시로 폴백하고, 쓰기는 '온라인에서만 가능'을 명시적으로 알린다(무음 유실 금지).
    // DB 연결정보는 '배포 구성'(아래 상수) — 배포자가 배포 전 코드에서 설정하고 빌드한다(일반 사용자에겐 비노출).
    // 관리자 자격만 db-config.json(평문)에 저장(변경 시) — 없으면 베이크 디폴트 사용. 보안 강화는 P6.5(app_user 전환)에서.
    internal sealed class ProjectDb
    {
        // ================================================================================
        // ★ 배포 구성 — 배포 전 여기서 DB 연결정보를 설정하고 빌드한다 (서버 이관 시 이 값만 변경)
        // ================================================================================
        private const string DefHost     = "localhost";    // DB 서버 주소 (폐쇄망 서버 IP로 교체)
        private const int    DefPort     = 3306;           // MySQL 포트
        private const string DefDb       = "taskmgr";      // 데이터베이스명
        private const string DefUser     = "root";         // DB 계정
        private const string DefPassword = "taskmgr123";   // DB 비밀번호 (로컬 개발 디폴트 — 배포 전 실서버 값으로 교체)
        private const string DefAdminId  = "admin";        // 관리자 초기 ID (설정창에서 변경 가능)
        private const string DefAdminPw  = "1234";         // 관리자 초기 비밀번호 (설정창에서 변경 가능)
        // ================================================================================

        private readonly string _dataDir;
        private readonly Action<string> _log;

        public ProjectDb(string dataDir, Action<string> log)
        {
            _dataDir = dataDir;
            _log = log ?? (_ => { });
        }

        private string ConfigFile => Path.Combine(_dataDir, "db-config.json");

        // config(db-config.json)에는 관리자 자격 + 잠금해제 상태만 남긴다(변경분). 연결정보는 항상 베이크 상수 —
        // 옛 파일에 host/port 등 연결 필드가 남아 있어도 그냥 무시한다(에러·마이그레이션 불필요).
        private sealed class AdminCred
        {
            public string AdminId = "";   // 빈 문자열 = 미변경 → 베이크 디폴트(DefAdminId/DefAdminPw) 사용
            public string AdminPw = "";
            public bool AdminUnlocked = false;   // 이 PC에서 인증 완료 여부(영속) — netcus 자격 패턴과 같은 '한 번 인증하면 유지'
        }

        private AdminCred LoadAdmin()
        {
            var a = new AdminCred();
            try
            {
                if (!File.Exists(ConfigFile)) return a;
                using var d = JsonDocument.Parse(File.ReadAllText(ConfigFile, Encoding.UTF8));
                var r = d.RootElement;
                if (r.TryGetProperty("adminId", out var ai) && ai.ValueKind == JsonValueKind.String) a.AdminId = ai.GetString() ?? "";
                if (r.TryGetProperty("adminPw", out var ap) && ap.ValueKind == JsonValueKind.String) a.AdminPw = ap.GetString() ?? "";
                // 옛 파일엔 이 필드가 없다 → 기본 false(=미인증). 하위호환.
                if (r.TryGetProperty("adminUnlocked", out var au) && (au.ValueKind == JsonValueKind.True || au.ValueKind == JsonValueKind.False)) a.AdminUnlocked = au.GetBoolean();
            }
            catch (Exception ex) { _log("관리자 설정 로드 실패: " + ex.Message); }
            return a;
        }

        // config 기록 — 자격·잠금해제를 한 곳에서 직렬화(세 경로가 각자 쓰다 필드를 흘리는 것 방지).
        private bool WriteAdmin(AdminCred a)
        {
            try
            {
                Directory.CreateDirectory(_dataDir);
                File.WriteAllText(ConfigFile,
                    JsonSerializer.Serialize(new { adminId = a.AdminId, adminPw = a.AdminPw, adminUnlocked = a.AdminUnlocked },
                        new JsonSerializerOptions { WriteIndented = true }),
                    new UTF8Encoding(false));
                return true;
            }
            catch (Exception ex) { _log("관리자 설정 저장 실패: " + ex.Message); return false; }
        }

        // 이 PC에서 관리자 인증이 이미 끝났는지(부팅 시 웹 복원용).
        public bool IsAdminUnlocked()
        {
            try { return LoadAdmin().AdminUnlocked; }
            catch (Exception ex) { _log("관리자 잠금상태 조회 실패: " + ex.Message); return false; }
        }

        // 잠금해제 상태만 변경(해제 버튼 = false). 자격은 건드리지 않는다.
        public bool SetAdminUnlocked(bool unlocked)
        {
            var a = LoadAdmin();
            a.AdminUnlocked = unlocked;
            bool ok = WriteAdmin(a);
            if (ok) _log("관리자 잠금해제 상태: " + (unlocked ? "활성(유지)" : "해제"));
            return ok;
        }

        // 관리자 자격 등록/변경(평문 json). 빈 값 = 기존 유지.
        // ★ 자격을 바꾸면 잠금해제를 반드시 내린다 — 비번을 바꿨는데 옛 잠금해제가 남으면 안 된다(재인증 요구).
        // 반환: (ok, msg) — 디스크 쓰기 실패를 삼키지 않고 웹에 알려 거짓 성공 표시를 막는다(__saveFailed와 같은 취지).
        public (bool ok, string msg) SaveAdminCred(string? id, string? pw)
        {
            try
            {
                var a = LoadAdmin();
                if (!string.IsNullOrWhiteSpace(id)) a.AdminId = id!.Trim();
                if (!string.IsNullOrEmpty(pw)) a.AdminPw = pw;   // 빈칸 = 기존 유지
                a.AdminUnlocked = false;                          // 자격 변경 = 재인증 요구
                if (!WriteAdmin(a)) return (false, "관리자 자격을 저장하지 못했습니다(디스크 쓰기 실패).");
                _log("관리자 자격 저장: id=" + (a.AdminId.Length > 0 ? a.AdminId : "(디폴트)") + " (pw " + (a.AdminPw.Length > 0 ? "설정됨" : "디폴트") + ") · 잠금해제 초기화");
                return (true, "관리자 자격이 등록되었습니다. 편집할 때 새 비밀번호로 1회 인증하세요.");
            }
            catch (Exception ex) { _log("관리자 자격 저장 실패: " + ex.Message); return (false, "관리자 자격을 저장하지 못했습니다: " + Short(ex)); }
        }

        // 관리자 로그인 검증 — config값(없으면 베이크 디폴트)과 대조해 role('admin') 또는 null 반환(+안내 메시지).
        // ※ 검증은 '이 한 지점'에서만 — P6.5에서 여기만 app_user 인증으로 교체한다. JS엔 비번을 절대 노출하지 않는다.
        // id가 비어 있으면 pw만 대조(단일 관리자 편의). id가 있으면 id+pw 모두 일치해야 함.
        // 성공하면 잠금해제를 영속화한다(이 PC에선 재시작해도 유지 — 사용자 결정).
        public (string? role, string msg) VerifyAdmin(string? id, string? pw)
        {
            try
            {
                var a = LoadAdmin();
                string effId = a.AdminId.Length > 0 ? a.AdminId : DefAdminId;   // 미변경 → 베이크 디폴트 폴백
                string effPw = a.AdminPw.Length > 0 ? a.AdminPw : DefAdminPw;
                bool idOk = string.IsNullOrEmpty(id) || string.Equals(id, effId, StringComparison.Ordinal);
                bool ok = idOk && !string.IsNullOrEmpty(pw) && string.Equals(pw, effPw, StringComparison.Ordinal);
                if (!ok) return (null, "관리자 자격이 일치하지 않습니다.");
                // 잠금해제 영속화 — 쓰기 실패해도 이번 세션 인증 자체는 유효하므로 role은 내주고 안내만 덧붙인다.
                a.AdminUnlocked = true;
                bool saved = WriteAdmin(a);
                return ("admin", saved ? "관리자 모드로 전환되었습니다. 이 PC에서는 계속 유지됩니다."
                                       : "관리자 모드로 전환되었습니다(이번 실행만 — 상태 저장 실패).");
            }
            catch (Exception ex) { _log("관리자 검증 실패: " + ex.Message); return (null, "관리자 검증 오류: " + Short(ex)); }
        }

        // 짧은 연결 타임아웃(~4s) — 오프라인이면 빠르게 실패해 캐시로 폴백. 연결정보는 항상 베이크 상수.
        private static string BuildConnString() =>
            new MySqlConnectionStringBuilder
            {
                Server = DefHost,
                Port = (uint)DefPort,
                Database = DefDb,
                UserID = DefUser,
                Password = DefPassword,
                ConnectionTimeout = 4,        // 접속 대기(초) — 오프라인 빠른 실패
                DefaultCommandTimeout = 8,
                Pooling = false,               // 위젯 단발성 조회 — 풀 미유지(정지된 서버로 소켓 재사용 방지)
            }.ConnectionString;

        // 공식 과제(is_active=1)를 읽어 JSON 배열 문자열로 반환. 연결/조회 실패 시 null(호출측이 캐시 폴백).
        public async Task<string?> LoadProjectsJsonAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = new MySqlConnection(BuildConnString());
                await conn.OpenAsync(cts.Token);

                const string sql =
                    "SELECT uid, section, customer, project_name, contract_name, common_name, " +
                    "DATE_FORMAT(start_date,'%Y-%m-%d') start_date, DATE_FORMAT(end_date,'%Y-%m-%d') end_date, " +
                    "status, is_active FROM project WHERE is_active=1 ORDER BY common_name";
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
                        ["status"]        = Str(rd, "status"),
                        ["is_active"]     = IntOrNull(rd, "is_active"),
                    });
                }
                _log("DB 과제 로드: " + rows.Count + "건");
                return JsonSerializer.Serialize(rows);
            }
            catch (Exception ex) { _log("DB 과제 로드 실패(캐시 폴백): " + Short(ex)); return null; }
        }

        // 발주처 마스터(customer, is_active=1)를 이름 배열 JSON으로. 편집 폼의 발주처 드롭다운 소스.
        // 실패(오프라인 포함) 시 null → 웹은 기존 목록(dbCategories의 distinct)만으로 폴백한다.
        public async Task<string?> LoadCustomersJsonAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = new MySqlConnection(BuildConnString());
                await conn.OpenAsync(cts.Token);
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

        // ================================================================================
        // 쓰기 경로(P3.2) — 관리자 공식 과제 CRUD
        // 규약: ① 모든 값은 MySqlParameter 바인딩(문자열 연결 절대 금지) ② 예외는 전부 잡아
        //       (false, 한국어 메시지)로 환원하고 절대 throw하지 않는다 ③ 실패 사유는 사용자가
        //       '무엇을 고치면 되는지' 알 수 있는 문장으로만 노출한다(SQL/스택 노출 금지).
        // ================================================================================
        private static readonly string[] Sections = { "일반계약", "선진행", "사업부관리" };            // schema.sql section ENUM
        private static readonly string[] Statuses = { "진행중", "종료", "1차 납품완료", "미정" };      // schema.sql status ENUM(NULL 허용)

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

        // MySQL 에러번호 → 사용자 문장. 스키마 제약(UNIQUE/FK/ENUM)이 그대로 사용자에게 닿는 지점이다.
        private static string MySqlMsg(MySqlException ex)
        {
            switch (ex.Number)
            {
                case 1062: return "같은 발주처에 동일 사업명이 이미 있습니다.";                 // uq_project(customer, project_name)
                case 1451:
                case 1452: return "등록되지 않은 발주처입니다.";                                 // fk_project_customer
                case 1265:
                case 1406: return "구분/상태 값이 올바르지 않습니다.";                           // ENUM 밖 값 / 길이 초과
                case 1048: return "필수 항목이 비어 있습니다.";                                  // NOT NULL
                default:   return "저장하지 못했습니다: " + Short(ex);
            }
        }

        private const string OfflineMsg = "서버에 연결할 수 없습니다 — 편집은 온라인에서만 가능합니다.";

        // 공식 과제 추가/수정. uid가 비어 있으면 INSERT(uid는 DB DEFAULT (UUID())가 생성), 있으면 그 행 UPDATE.
        public async Task<(bool ok, string msg)> UpsertProjectAsync(string? uid, string section, string customer,
            string projectName, string? contractName, string? commonName, string? startDate, string? endDate, string? status)
        {
            // ── 앱단 선검증 — ENUM/필수값 위반은 DB까지 보내지 않고 바로 사용자 문장으로 돌려준다.
            string u = (uid ?? "").Trim();
            string sec = (section ?? "").Trim(), cust = (customer ?? "").Trim(), pname = (projectName ?? "").Trim();
            string st = (status ?? "").Trim(), sd = (startDate ?? "").Trim(), ed = (endDate ?? "").Trim();
            if (pname.Length == 0) return (false, "사업명을 입력하세요.");
            if (cust.Length == 0) return (false, "발주처를 선택하세요.");
            if (Array.IndexOf(Sections, sec) < 0) return (false, "구분 값이 올바르지 않습니다.");
            if (st.Length > 0 && Array.IndexOf(Statuses, st) < 0) return (false, "상태 값이 올바르지 않습니다.");
            // 선진행 = 계약 전 단계 → 날짜·상태는 스키마상 NULL이어야 한다(웹 폼도 같은 규칙으로 잠근다).
            if (sec == "선진행") { sd = ""; ed = ""; st = ""; }
            // 날짜 형식 선검증 — 잘못된 형식을 조용히 NULL로 저장하지 않고 사용자에게 되돌린다(무음 데이터 유실 방지).
            if (!IsDateOrEmpty(sd)) return (false, "계약시작일 형식이 올바르지 않습니다(YYYY-MM-DD).");
            if (!IsDateOrEmpty(ed)) return (false, "계약종료일 형식이 올바르지 않습니다(YYYY-MM-DD).");
            if (sd.Length > 0 && ed.Length > 0 && string.CompareOrdinal(sd, ed) > 0)
                return (false, "계약종료일이 계약시작일보다 빠릅니다.");

            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                await using var conn = new MySqlConnection(BuildConnString());
                try { await conn.OpenAsync(cts.Token); }
                catch (Exception cex) { _log("DB 연결 실패(과제 저장): " + Short(cex)); return (false, OfflineMsg); }

                if (u.Length == 0)
                {
                    const string ins = "INSERT INTO project (section, customer, project_name, contract_name, common_name, " +
                                       "start_date, end_date, status) VALUES (@sec,@cust,@pn,@cn,@mn,@sd,@ed,@st)";
                    await using (var cmd = new MySqlCommand(ins, conn))
                    {
                        BindProject(cmd, sec, cust, pname, contractName, commonName, sd, ed, st);
                        await cmd.ExecuteNonQueryAsync(cts.Token);
                    }
                    // uid는 DB가 만든다(assign-once) — 로그에만 남긴다. 웹은 재조회(loadProjects)로 새 행을 받는다.
                    string newUid = "";
                    await using (var q = new MySqlCommand("SELECT uid FROM project WHERE id=LAST_INSERT_ID()", conn))
                        newUid = (await q.ExecuteScalarAsync(cts.Token))?.ToString() ?? "";
                    _log("공식 과제 추가: " + pname + " (uid=" + (newUid.Length > 0 ? newUid : "?") + ")");
                    return (true, "공식 과제를 추가했습니다.");
                }
                else
                {
                    const string upd = "UPDATE project SET section=@sec, customer=@cust, project_name=@pn, contract_name=@cn, " +
                                       "common_name=@mn, start_date=@sd, end_date=@ed, status=@st WHERE uid=@uid";
                    int n;
                    await using (var cmd = new MySqlCommand(upd, conn))
                    {
                        BindProject(cmd, sec, cust, pname, contractName, commonName, sd, ed, st);
                        cmd.Parameters.AddWithValue("@uid", u);
                        n = await cmd.ExecuteNonQueryAsync(cts.Token);
                    }
                    // 영향 행 0 = '값이 하나도 안 바뀜'과 '대상이 사라짐'이 겹친다 → 존재 확인으로 구분(유령 성공 방지).
                    if (n == 0)
                    {
                        await using var q = new MySqlCommand("SELECT COUNT(*) FROM project WHERE uid=@uid", conn);
                        q.Parameters.AddWithValue("@uid", u);
                        long cnt = Convert.ToInt64((await q.ExecuteScalarAsync(cts.Token)) ?? 0L);
                        if (cnt == 0) return (false, "대상 과제를 찾을 수 없습니다 — 목록을 새로고침해 주세요.");
                    }
                    _log("공식 과제 수정: " + pname + " (uid=" + u + ")");
                    return (true, "공식 과제를 저장했습니다.");
                }
            }
            catch (MySqlException mex)
            {
                _log("공식 과제 저장 실패(" + mex.Number + "): " + Short(mex));
                // 1062(UNIQUE 충돌)인데 같은 (customer, project_name)의 숨김(is_active=0) 행이 점유 중이면 원인을 구분해 안내(복구 필요).
                if (mex.Number == 1062 && await SoftDeletedDuplicateExistsAsync(cust, pname))
                    return (false, "같은 발주처에 숨김 처리된 동일 사업명이 있습니다(복구 필요).");
                return (false, MySqlMsg(mex));
            }
            catch (Exception ex) { _log("공식 과제 저장 실패: " + Short(ex)); return (false, "저장하지 못했습니다: " + Short(ex)); }
        }

        // UNIQUE(customer, project_name) 충돌이 '숨김(is_active=0) 행' 때문인지 확인 — 별도 연결(풀 미사용)로 짧게 조회. 실패 시 false(기본 메시지).
        private async Task<bool> SoftDeletedDuplicateExistsAsync(string customer, string projectName)
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = new MySqlConnection(BuildConnString());
                await conn.OpenAsync(cts.Token);
                await using var cmd = new MySqlCommand(
                    "SELECT COUNT(*) FROM project WHERE customer=@c AND project_name=@p AND is_active=0", conn);
                cmd.Parameters.AddWithValue("@c", customer);
                cmd.Parameters.AddWithValue("@p", projectName);
                return Convert.ToInt64((await cmd.ExecuteScalarAsync(cts.Token)) ?? 0L) > 0;
            }
            catch (Exception ex) { _log("숨김 중복 확인 실패: " + Short(ex)); return false; }
        }

        // INSERT/UPDATE 공통 파라미터 바인딩 — 두 경로가 어긋나 한쪽만 NULL 규칙을 어기는 일이 없게 한 곳에서.
        private static void BindProject(MySqlCommand cmd, string sec, string cust, string pname,
            string? contractName, string? commonName, string sd, string ed, string st)
        {
            cmd.Parameters.AddWithValue("@sec", sec);
            cmd.Parameters.AddWithValue("@cust", cust);
            cmd.Parameters.AddWithValue("@pn", pname);
            cmd.Parameters.AddWithValue("@cn", TextOrNull(contractName));
            cmd.Parameters.AddWithValue("@mn", TextOrNull(commonName));
            cmd.Parameters.AddWithValue("@sd", DateOrNull(sd));
            cmd.Parameters.AddWithValue("@ed", DateOrNull(ed));
            cmd.Parameters.AddWithValue("@st", TextOrNull(st));
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
                await using var conn = new MySqlConnection(BuildConnString());
                try { await conn.OpenAsync(cts.Token); }
                catch (Exception cex) { _log("DB 연결 실패(과제 숨김/복구): " + Short(cex)); return (false, OfflineMsg); }

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
    }
}
