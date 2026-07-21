using System;
using System.Collections.Generic;
using System.Data.Common;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MySqlConnector;

namespace TaskCalendarWidget
{
    // 과제 DB 연동(READ 경로만) — 사내 MySQL(taskmgr)의 공식 과제(project)를 '읽기만' 해서 웹으로 넘긴다.
    // 공식 과제 쓰기/CRUD·관리자 편집 화면은 이후 단계. 오프라인이면 조용히 실패하고 웹은 로컬 캐시로 폴백한다.
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

        // config(db-config.json)에는 관리자 자격만 남긴다(변경분). 연결정보는 항상 베이크 상수 —
        // 옛 파일에 host/port 등 연결 필드가 남아 있어도 그냥 무시한다(에러·마이그레이션 불필요).
        private sealed class AdminCred
        {
            public string AdminId = "";   // 빈 문자열 = 미변경 → 베이크 디폴트(DefAdminId/DefAdminPw) 사용
            public string AdminPw = "";
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
            }
            catch (Exception ex) { _log("관리자 설정 로드 실패: " + ex.Message); }
            return a;
        }

        // 관리자 자격 등록/변경(평문 json — adminId/adminPw만 기록). 빈 값 = 기존 유지.
        public void SaveAdminCred(string? id, string? pw)
        {
            try
            {
                var a = LoadAdmin();
                if (!string.IsNullOrWhiteSpace(id)) a.AdminId = id!.Trim();
                if (!string.IsNullOrEmpty(pw)) a.AdminPw = pw;   // 빈칸 = 기존 유지
                Directory.CreateDirectory(_dataDir);
                File.WriteAllText(ConfigFile,
                    JsonSerializer.Serialize(new { adminId = a.AdminId, adminPw = a.AdminPw },
                        new JsonSerializerOptions { WriteIndented = true }),
                    new UTF8Encoding(false));
                _log("관리자 자격 저장: id=" + (a.AdminId.Length > 0 ? a.AdminId : "(디폴트)") + " (pw " + (a.AdminPw.Length > 0 ? "설정됨" : "디폴트") + ")");
            }
            catch (Exception ex) { _log("관리자 자격 저장 실패: " + ex.Message); }
        }

        // 관리자 로그인 검증 — config값(없으면 베이크 디폴트)과 대조해 role('admin') 또는 null 반환(+안내 메시지).
        // ※ 검증은 '이 한 지점'에서만 — P6.5에서 여기만 app_user 인증으로 교체한다. JS엔 비번을 절대 노출하지 않는다.
        // id가 비어 있으면 pw만 대조(단일 관리자 편의). id가 있으면 id+pw 모두 일치해야 함.
        public (string? role, string msg) VerifyAdmin(string? id, string? pw)
        {
            try
            {
                var a = LoadAdmin();
                string effId = a.AdminId.Length > 0 ? a.AdminId : DefAdminId;   // 미변경 → 베이크 디폴트 폴백
                string effPw = a.AdminPw.Length > 0 ? a.AdminPw : DefAdminPw;
                bool idOk = string.IsNullOrEmpty(id) || string.Equals(id, effId, StringComparison.Ordinal);
                bool ok = idOk && !string.IsNullOrEmpty(pw) && string.Equals(pw, effPw, StringComparison.Ordinal);
                return ok ? ("admin", "관리자 모드로 전환되었습니다.") : (null, "관리자 자격이 일치하지 않습니다.");
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
