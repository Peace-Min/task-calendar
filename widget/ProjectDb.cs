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
    // 과제 DB 연동(READ 경로만) — 로컬 MySQL(taskmgr)의 공식 과제(project)를 '읽기만' 해서 웹으로 넘긴다.
    // 공식 과제 쓰기/CRUD·관리자 편집 화면은 이 슬라이스 범위 밖(이후 단계). 오프라인이면 조용히 실패하고 웹은 로컬 캐시로 폴백한다.
    // 설정(host/port/database/user/password + adminId/adminPw)은 db-config.json에 '평문'으로 저장한다.
    //   ※ 암호화 없음(사용자 결정) — 자동 업데이트 소스 URL 저장과 동일한 단순 평문 방식. 보안 강화는 P6.5(app_user 전환)에서.
    internal sealed class ProjectDb
    {
        private readonly string _dataDir;
        private readonly Action<string> _log;

        // 비-비밀 연결 기본값(폐쇄망 내부·localhost). 비밀번호는 기본값(baked) 없음 — 오직 config에서만 읽는다.
        private const string DefHost = "localhost";
        private const int    DefPort = 3306;
        private const string DefDb   = "taskmgr";
        private const string DefUser = "root";

        public ProjectDb(string dataDir, Action<string> log)
        {
            _dataDir = dataDir;
            _log = log ?? (_ => { });
        }

        private string ConfigFile => Path.Combine(_dataDir, "db-config.json");

        private sealed class DbConfig
        {
            public string Host = DefHost;
            public int Port = DefPort;
            public string Database = DefDb;
            public string User = DefUser;
            public string Password = "";    // 평문 — 미설정이면 빈 문자열(연결 실패 → 웹은 캐시 폴백)
            public string AdminId = "";     // 관리자 자격(평문) — 공식 과제 편집 게이트. 미설정이면 빈 문자열.
            public string AdminPw = "";
        }

        // ----- 설정 로드/저장 (평문 json) -----
        private DbConfig LoadConfig()
        {
            var c = new DbConfig();
            try
            {
                if (!File.Exists(ConfigFile)) return c;   // 파일 없음 → 비-비밀 기본값(비번/관리자는 빈 문자열)
                using var d = JsonDocument.Parse(File.ReadAllText(ConfigFile, Encoding.UTF8));
                var r = d.RootElement;
                if (r.TryGetProperty("host", out var h) && h.ValueKind == JsonValueKind.String) c.Host = h.GetString() ?? DefHost;
                if (r.TryGetProperty("port", out var p) && p.TryGetInt32(out var pi) && pi > 0) c.Port = pi;
                if (r.TryGetProperty("database", out var db) && db.ValueKind == JsonValueKind.String) c.Database = db.GetString() ?? DefDb;
                if (r.TryGetProperty("user", out var u) && u.ValueKind == JsonValueKind.String) c.User = u.GetString() ?? DefUser;
                if (r.TryGetProperty("password", out var pw) && pw.ValueKind == JsonValueKind.String) c.Password = pw.GetString() ?? "";
                if (r.TryGetProperty("adminId", out var ai) && ai.ValueKind == JsonValueKind.String) c.AdminId = ai.GetString() ?? "";
                if (r.TryGetProperty("adminPw", out var ap) && ap.ValueKind == JsonValueKind.String) c.AdminPw = ap.GetString() ?? "";
            }
            catch (Exception ex) { _log("DB 설정 로드 실패: " + ex.Message); }
            return c;
        }

        private void WriteConfig(DbConfig c)
        {
            Directory.CreateDirectory(_dataDir);
            File.WriteAllText(ConfigFile,
                JsonSerializer.Serialize(new
                {
                    host = c.Host, port = c.Port, database = c.Database, user = c.User, password = c.Password,
                    adminId = c.AdminId, adminPw = c.AdminPw
                }, new JsonSerializerOptions { WriteIndented = true }),
                new UTF8Encoding(false));
        }

        // DB 접속 설정 저장(평문). 빈 값은 기존 유지(실수로 지워지는 것 방지 — netcus SaveCreds와 동일 철학).
        public void SaveConfig(string? host, int port, string? database, string? user, string? password)
        {
            try
            {
                var c = LoadConfig();
                if (!string.IsNullOrWhiteSpace(host)) c.Host = host!.Trim();
                if (port > 0) c.Port = port;
                if (!string.IsNullOrWhiteSpace(database)) c.Database = database!.Trim();
                if (!string.IsNullOrWhiteSpace(user)) c.User = user!.Trim();
                if (!string.IsNullOrEmpty(password)) c.Password = password;   // 빈칸 = 기존 유지
                WriteConfig(c);
                _log("DB 설정 저장: " + c.Host + ":" + c.Port + "/" + c.Database + " (user=" + c.User + ")");
            }
            catch (Exception ex) { _log("DB 설정 저장 실패: " + ex.Message); }
        }

        // 관리자 자격 등록/변경(평문). 초기 1회 설정용. 빈 값 = 기존 유지.
        public void SaveAdminCred(string? id, string? pw)
        {
            try
            {
                var c = LoadConfig();
                if (!string.IsNullOrWhiteSpace(id)) c.AdminId = id!.Trim();
                if (!string.IsNullOrEmpty(pw)) c.AdminPw = pw;   // 빈칸 = 기존 유지
                WriteConfig(c);
                _log("관리자 자격 저장: id=" + c.AdminId + " (pw " + (c.AdminPw.Length > 0 ? "설정됨" : "미설정") + ")");
            }
            catch (Exception ex) { _log("관리자 자격 저장 실패: " + ex.Message); }
        }

        // 관리자 로그인 검증. config값과 대조해 role('admin') 또는 null을 반환(+안내 메시지).
        // ※ 검증은 '이 한 지점'에서만 — P6.5에서 여기만 app_user 인증으로 교체한다. JS엔 비번을 절대 노출하지 않는다.
        // id가 비어 있으면 pw만 대조(단일 관리자 편의). id가 있으면 id+pw 모두 일치해야 함.
        public (string? role, string msg) VerifyAdmin(string? id, string? pw)
        {
            try
            {
                var c = LoadConfig();
                if (string.IsNullOrEmpty(c.AdminPw))
                    return (null, "관리자 자격이 아직 설정되지 않았습니다 — 먼저 관리자 자격을 등록하세요.");
                bool idOk = string.IsNullOrEmpty(id) || string.Equals(id, c.AdminId, StringComparison.Ordinal);
                bool ok = idOk && !string.IsNullOrEmpty(pw) && string.Equals(pw, c.AdminPw, StringComparison.Ordinal);
                return ok ? ("admin", "관리자 모드로 전환되었습니다.") : (null, "관리자 자격이 일치하지 않습니다.");
            }
            catch (Exception ex) { _log("관리자 검증 실패: " + ex.Message); return (null, "관리자 검증 오류: " + Short(ex)); }
        }

        // 짧은 연결 타임아웃(~4s) — 오프라인이면 빠르게 실패해 캐시로 폴백.
        private static string BuildConnString(DbConfig c) =>
            new MySqlConnectionStringBuilder
            {
                Server = c.Host,
                Port = (uint)(c.Port > 0 ? c.Port : DefPort),
                Database = c.Database,
                UserID = c.User,
                Password = c.Password,
                ConnectionTimeout = 4,        // 접속 대기(초) — 오프라인 빠른 실패
                DefaultCommandTimeout = 8,
                Pooling = false,               // 위젯 단발성 조회 — 풀 미유지(정지된 서버로 소켓 재사용 방지)
            }.ConnectionString;

        // 공식 과제(is_active=1)를 읽어 JSON 배열 문자열로 반환. 연결/조회 실패 시 null(호출측이 캐시 폴백).
        public async Task<string?> LoadProjectsJsonAsync()
        {
            var c = LoadConfig();
            if (string.IsNullOrEmpty(c.Password)) { _log("DB 비밀번호 미설정 — 로드 생략(캐시 폴백)"); return null; }   // 미설정이면 시도조차 안 함
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = new MySqlConnection(BuildConnString(c));
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

        // 연결 테스트 — 짧은 한국어 메시지 반환("연결됨 · N건" / "연결 실패: <이유>").
        public async Task<(bool ok, string msg)> TestConnectionAsync()
        {
            var c = LoadConfig();
            if (string.IsNullOrEmpty(c.Password)) return (false, "연결 실패: 비밀번호가 설정되지 않았습니다");
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                await using var conn = new MySqlConnection(BuildConnString(c));
                await conn.OpenAsync(cts.Token);
                await using var cmd = new MySqlCommand("SELECT COUNT(*) FROM project WHERE is_active=1", conn);
                var n = await cmd.ExecuteScalarAsync(cts.Token);
                long cnt = (n == null || n is DBNull) ? 0 : Convert.ToInt64(n);
                _log("DB 연결 테스트 성공: " + cnt + "건");
                return (true, "연결됨 · " + cnt + "건");
            }
            catch (Exception ex) { _log("DB 연결 테스트 실패: " + Short(ex)); return (false, "연결 실패: " + Short(ex)); }
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

        // 예외 메시지를 한 줄로 축약(과도한 스택/내부 예외 방지 — UI 표시용)
        private static string Short(Exception ex)
        {
            string m = ex.Message ?? ex.GetType().Name;
            m = m.Replace("\r", " ").Replace("\n", " ").Trim();
            return m.Length > 120 ? m.Substring(0, 120) + "…" : m;
        }
    }
}
