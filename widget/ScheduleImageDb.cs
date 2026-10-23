using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using MySqlConnector;

namespace TaskCalendarWidget
{
    // ================================================================================
    //  과제별 개발 일정 그림(월간보고): docs/MONTHLY-REPORT-PLAN.md §6
    // ================================================================================
    //  표는 project_schedule_image 하나(정본 db/deploy/schema-calendar.sql 16, 구조 번호 17). 그 표의 SQL 은 이 파일에만 있다.
    //  그림은 **사람마다 따로**다(사용자 결정 2026-10-23, §6.1). 행마다 주인(user_id)이 하나고, 모든 SQL 이 세션의 사람을 건다:
    //    목록, 미리 보기, 받기는 내 그림만 돌려주고, 남의 그림 번호로 지우거나 옮기면 없는 그림과 똑같이 notFound 다(있는지 알리지 않는다).
    //    추가는 세션의 사람을 주인으로 쓴다. 5장 상한, 같은 그림 거절, seq 매기기는 (사람, 과제) 단위다. DOCX 에도 저장하는 사람의 그림만.
    //  ★ 관리자 검사는 하지 않는다(의도, §6.1). 내 그림은 내가 넣고 지운다.
    //
    //  【명령】 MainWindow 의 메인 창에서만 온다(관리 창, 열람 창 허용 목록 밖). 배선은 MonthlyReportExport.cs.
    //    scheduleImageList   { projectUid }            → { projectUid, images:[메타], limits }      바이트 없음
    //    scheduleImageAdd    { projectUid, mode }       mode 'file'(파일 고르기) 또는 'clipboard'(붙여넣기). 호스트가 바이트를 얻어 AddAsync
    //    scheduleImageDelete { id }                     실제 행 삭제(휴지통 없음). 남은 그림은 1..n 으로 다시 매긴다
    //    scheduleImageMove   { id, seq }                과제 안 자리를 seq(1부터)로 옮긴다
    //    scheduleImageThumb  { id }                     → { id, sha256, dataUrl, width, height } 웹 미리 보기(약 40KB 이하 JPEG)
    //    회신은 { ok, data?, error?: { kind, message } }. kind 는 forbidden, invalid, notFound, conflict 와 연결 분류(DbErrorKind).
    //    파일 고르기를 취소하면 { ok:false, cancelled:true }.
    //
    //  【PC 사본】 앱 데이터 폴더 schedule-images\<sha256>.png|jpg. 목록을 읽을 때마다 (로그인 id, 과제)별 메타를 index.json 에 적어 두고,
    //    바이트는 해시가 같은 사본이 없을 때만 DB 에서 받는다. 사본은 읽을 때마다 해시를 다시 보고, 다르면 지우고 새로 받는다.
    //    DB 가 끊기면 DOCX 저장과 미리 보기는 사본으로 하고(ImagesForExportAsync, ThumbAsync), 추가와 삭제와 순서 바꾸기는 막힌다.
    //
    //  【트랜잭션 규칙】
    //    - 연결은 모두 DbGate.OpenAsync(버전 관문). 쓰기는 READ-COMMITTED 한 트랜잭션이고 커밋은 CommitWithGateAsync 한 곳에서
    //      관문을 다시 읽은 뒤에 한다(VERSION-GATE §2.2, CalendarWriteDb, ProjectCalendarDb 와 같은 규칙).
    //    - 쓰기 트랜잭션은 신원(세션의 login_id 로 활성 app_user)과 과제 행 FOR UPDATE 로 시작한다. 같은 과제의 그림 쓰기는(사람이 달라도)
    //      이 잠금으로 줄을 서고(5장 상한, seq 매기기가 엇갈리지 않는다), 휴지통의 과제 영구 삭제(CASCADE)와도 엇갈리지 않는다.
    //      잠금 순서는 어디서나 과제 행 다음 그림 행이다.
    //    - (user_id, project_id, seq) UNIQUE 를 피해 순서를 바꿀 때는 먼저 내 그림을 모두 +100 으로 비켜 놓고 제자리로 하나씩 옮긴다.
    //    - 사용자 값(projectUid, id, seq)은 형식을 보고 매개변수로만 넣는다. 웹이 보낸 사용자 값은 읽지 않는다.
    // ================================================================================
    internal sealed class ScheduleImageDb
    {
        //  상한. 화면 문구와 시험(tests/schedule-image.test.mjs)이 같은 숫자를 쓴다.
        internal static class Limits
        {
            public const int MaxBytes = 5 * 1024 * 1024;     // 장당 5MB(MEDIUMBLOB 은 16MB 까지 받지만 앱이 막는다)
            public const int MaxPerProject = 5;              // 사람마다 과제당 5장
            public const int MaxEdgePx = 16000;              // 가로, 세로 상한(SMALLINT UNSIGNED 안, 압축 폭탄과 거대 그림 막기)
            public const int ThumbMaxBytes = 40 * 1024;      // 미리 보기 JPEG 상한(약 40KB)
            public const int ThumbEdgePx = 360;              // 미리 보기 긴 변(처음 시도). 크면 줄여 가며 다시 만든다
        }

        //  호스트가 채우는 error.kind. 연결 오류는 DbErrorKind(network, auth, schema, gate, unknown)를 그대로 쓴다.
        internal static class Kind
        {
            public const string Forbidden = "forbidden";
            public const string Invalid = "invalid";
            public const string NotFound = "notFound";
            public const string Conflict = "conflict";
        }

        //  명령 다섯. MainWindow 의 스위치와 시험이 이 이름을 쓴다.
        internal static readonly string[] Commands =
        {
            "scheduleImageList", "scheduleImageAdd", "scheduleImageDelete", "scheduleImageMove", "scheduleImageThumb",
        };

        // ── 고정 문구(사용자에게 그대로 보인다) ─────────────────────────────────
        internal const string MsgNoSession = "로그인이 필요합니다.";
        internal const string MsgUnregistered = "사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요.";
        internal const string MsgInactiveUser = "비활성 처리된 계정입니다.";
        internal const string MsgNoProject = "과제를 찾을 수 없습니다. 과제 목록을 다시 읽으세요.";
        internal const string MsgGone = "이미 지워졌거나 없는 그림입니다.";
        internal const string MsgTooMany = "개발 일정 그림은 과제마다 5장까지 올릴 수 있습니다.";
        internal const string MsgTooBig = "그림 파일은 5MB 까지 올릴 수 있습니다.";
        internal const string MsgNotImage = "PNG 또는 JPEG 그림만 올릴 수 있습니다.";
        internal const string MsgBroken = "그림을 읽지 못했습니다. 파일이 손상되었거나 그림이 아닙니다.";
        internal const string MsgHuge = "그림이 너무 큽니다(가로, 세로 16,000 화소까지).";
        internal const string MsgDuplicate = "같은 그림이 이 과제에 이미 있습니다.";
        internal const string MsgBusy = "다른 저장과 겹쳤습니다. 잠시 뒤 다시 시도하세요.";
        internal const string MsgPacket = "서버 설정(max_allowed_packet)이 작아 그림을 올리지 못했습니다. 관리자에게 문의하세요.";
        internal const string MsgOffline = "서버에 연결되지 않아 PC 에 받아 둔 그림만 보여 줍니다. 추가와 삭제는 연결된 뒤에 하세요.";

        private readonly string _dataDir;
        private readonly Action<string> _log;

        public ScheduleImageDb(string dataDir, Action<string> log)
        {
            _dataDir = dataDir ?? "";
            _log = log ?? (_ => { });
        }

        // ── 형 ────────────────────────────────────────────────────────────────
        //  그림 한 장의 메타(웹과 PC 사본 색인이 같은 모양을 쓴다). 바이트는 싣지 않는다.
        internal sealed class ImageMeta
        {
            public long Id { get; set; }
            public int Seq { get; set; }
            public string Mime { get; set; } = "";
            public int Width { get; set; }
            public int Height { get; set; }
            public long Size { get; set; }
            public string Sha256 { get; set; } = "";
            public string UploadedAt { get; set; } = "";   // ISO UTC(…Z)
        }

        private sealed class Me { public int UserId; public string Name = ""; }

        //  안에서 멈출 때 던진다. 바깥 HandleAsync 가 롤백 뒤 회신으로 바꾼다.
        private sealed class SiFail : Exception
        {
            public string Kind { get; }
            public SiFail(string kind, string message) : base(message) { Kind = kind; }
        }

        private static readonly Regex UuidRe = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOptions.CultureInvariant);
        private static readonly Regex ShaRe = new Regex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);

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
                DefaultCommandTimeout = 30,   // 그림 한 장(최대 5MB)을 주고받는다
                Pooling = false,
                UseAffectedRows = false,
            }.ConnectionString;

        private const string PreambleSql =
            "SET SESSION innodb_lock_wait_timeout=5, " +
            "SESSION time_zone='+00:00', " +
            "SESSION transaction_isolation='READ-COMMITTED'";

        private static async Task<MySqlConnection> OpenAsync(CancellationToken ct)
        {
            var conn = await DbGate.OpenAsync(BuildConnString(), ct);
            try { await Exec(conn, null, PreambleSql, ct); }
            catch { await conn.DisposeAsync(); throw; }
            return conn;
        }

        //  커밋은 여기 한 곳. 바로 앞에서 관문을 잠금 없이 다시 읽고 막혔으면 통째로 롤백한다(VERSION-GATE §2.2).
        private async Task CommitWithGateAsync(MySqlConnection conn, MySqlTransaction tx, CancellationToken ct)
        {
            var gateMeta = await DbGate.ReadMetaAsync(conn, tx, ct);
            if (DbGate.Observe(gateMeta) != GateVerdict.Ok)
            {
                await SafeRollbackAsync(tx);
                _log("개발 일정 그림 쓰기 중단(버전 관문, 커밋 직전): " + (DbGate.Last?.State ?? "unknown") + ", 롤백");
                throw new DbGateException(DbGate.Last?.Verdict ?? GateVerdict.Unknown, gateMeta);
            }
            await tx.CommitAsync(ct);
        }

        private static async Task SafeRollbackAsync(MySqlTransaction tx)
        {
            try { await tx.RollbackAsync(CancellationToken.None); } catch { /* 연결을 닫으면 서버가 어차피 롤백한다 */ }
        }

        // ── 신원: 세션의 login_id 로 활성 app_user 를 찾는다. 웹 값은 쓰지 않는다 ─────────
        private string SessionLoginId()
        {
            var s = UserSession.Load(_dataDir, _log);
            if (s == null || s.LoginId.Length == 0) throw new SiFail(Kind.Forbidden, MsgNoSession);
            return s.LoginId;
        }

        private static async Task<Me> IdentityAsync(MySqlConnection conn, MySqlTransaction? tx, string loginId, CancellationToken ct)
        {
            await using var cmd = new MySqlCommand("SELECT user_id, name, is_active FROM app_user WHERE login_id=@id", conn, tx);
            cmd.Parameters.AddWithValue("@id", loginId);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            if (!await rd.ReadAsync(ct)) throw new SiFail(Kind.Forbidden, MsgUnregistered);
            if (Convert.ToInt32(rd["is_active"], CultureInfo.InvariantCulture) != 1) throw new SiFail(Kind.Forbidden, MsgInactiveUser);
            return new Me { UserId = Convert.ToInt32(rd["user_id"], CultureInfo.InvariantCulture), Name = Str(rd, "name") };
        }

        //  과제 번호. lockRow 면 FOR UPDATE(쓰기 트랜잭션 안에서만). 없으면 notFound.
        private static async Task<uint> ProjectIdAsync(MySqlConnection conn, MySqlTransaction? tx, string projectUid, bool lockRow, CancellationToken ct)
        {
            await using var cmd = new MySqlCommand("SELECT id FROM project WHERE uid=@u" + (lockRow ? " FOR UPDATE" : ""), conn, tx);
            cmd.Parameters.AddWithValue("@u", projectUid);
            object? v = await cmd.ExecuteScalarAsync(ct);
            if (v == null || v is DBNull) throw new SiFail(Kind.NotFound, MsgNoProject);
            return Convert.ToUInt32(v, CultureInfo.InvariantCulture);
        }

        // ================================================================================
        //  입구: 명령 이름과 웹 메시지 원문(scheduleImageAdd 는 MonthlyReportExport.cs 가 AddAsync 로 부른다)
        // ================================================================================
        public async Task<ScheduleImageReply> HandleAsync(string cmd, string rawJson)
        {
            string projectUid = "";
            try
            {
                using var doc = JsonDocument.Parse(string.IsNullOrEmpty(rawJson) ? "{}" : rawJson);
                var q = doc.RootElement;
                if (q.ValueKind != JsonValueKind.Object) throw new SiFail(Kind.Invalid, "요청 형식이 잘못되었습니다.");
                switch (cmd)
                {
                    case "scheduleImageList":
                        projectUid = ReqProjectUid(q);
                        return await ListAsync(projectUid);
                    case "scheduleImageDelete": return await DeleteAsync(ReqId(q));
                    case "scheduleImageMove": return await MoveAsync(ReqId(q), ReqSeq(q));
                    case "scheduleImageThumb": return await ThumbAsync(ReqId(q));
                    default: throw new SiFail(Kind.Invalid, "알 수 없는 요청입니다.");
                }
            }
            catch (SiFail f) { return Fail(cmd, f); }
            catch (JsonException) { return ScheduleImageReply.Failure(Kind.Invalid, "요청 형식이 잘못되었습니다."); }
        }

        //  예외를 회신으로. 회신 문장은 고정 문구다(원문 오류는 로그에만).
        private ScheduleImageReply Fail(string what, Exception ex, object? data = null)
        {
            if (ex is SiFail f)
            {
                _log("개발 일정 그림 " + what + " 거부(" + f.Kind + "): " + f.Message);
                return ScheduleImageReply.Failure(f.Kind, f.Message, data);
            }
            if (ex is DbGateException gx)
            {
                _log("개발 일정 그림 " + what + " 관문 차단: " + gx.Message);
                return ScheduleImageReply.Failure(DbErrorKind.Gate, DbErrors.ConnMessage(DbErrorKind.Gate), data);
            }
            int n = DbErrors.Number(ex);
            if (n == 1452 || n == 1451)
            {
                _log("개발 일정 그림 " + what + " 거부(FK " + n + ", 과제나 사람이 사라짐): " + ex.Message);
                return ScheduleImageReply.Failure(Kind.NotFound, MsgNoProject, data);
            }
            if (n == 1062)
            {
                _log("개발 일정 그림 " + what + " 충돌(1062): " + ex.Message);
                return ScheduleImageReply.Failure(Kind.Conflict, MsgBusy, data);
            }
            if (n == 1153 || n == 1301)
            {
                _log("개발 일정 그림 " + what + " 실패(패킷 크기 " + n + "): " + ex.Message);
                return ScheduleImageReply.Failure(Kind.Invalid, MsgPacket, data);
            }
            var (kind, detail) = DbErrors.Observe(ex, _log);
            _log("개발 일정 그림 " + what + " 실패(" + kind + ", " + n + "): " + detail);
            string msg = (n == 1205 || n == 1213) ? MsgBusy : DbErrors.ConnMessage(kind);
            return ScheduleImageReply.Failure(kind, msg, data);
        }

        // ================================================================================
        //  1. 목록(메타만). 읽을 때마다 PC 사본 색인을 그 과제의 최신 메타로 바꾼다.
        // ================================================================================
        public async Task<ScheduleImageReply> ListAsync(string projectUid)
        {
            string login = "";
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
                var ct = cts.Token;
                login = SessionLoginId();
                await using var conn = await OpenAsync(ct);
                var me = await IdentityAsync(conn, null, login, ct);
                uint pid = await ProjectIdAsync(conn, null, projectUid, false, ct);
                var images = await ListMetaAsync(conn, null, me.UserId, pid, ct);
                Cache.Remember(_dataDir, login, projectUid, images, _log);
                return ScheduleImageReply.Success(ListData(projectUid, images, stale: false));
            }
            catch (Exception ex)
            {
                //  끊겼거나 막혔으면 이 로그인의 PC 사본 색인 마지막 목록을 함께 준다(stale). 거부(신원, 과제 없음)면 주지 않는다.
                object? data = null;
                if (!(ex is SiFail) && login.Length > 0)
                {
                    var cached = Cache.Recall(_dataDir, login, projectUid);
                    if (cached != null) data = ListData(projectUid, cached, stale: true);
                }
                return Fail("목록", ex, data);
            }
        }

        private static object ListData(string projectUid, List<ImageMeta> images, bool stale) => new Dictionary<string, object?>
        {
            ["projectUid"] = projectUid,
            ["images"] = images.ConvertAll(MetaPayload),
            ["stale"] = stale,
            ["notice"] = stale ? MsgOffline : "",
            ["limits"] = new Dictionary<string, object?> { ["maxBytes"] = Limits.MaxBytes, ["maxPerProject"] = Limits.MaxPerProject },
        };

        private static object MetaPayload(ImageMeta m) => new Dictionary<string, object?>
        {
            ["id"] = m.Id,
            ["seq"] = m.Seq,
            ["mime"] = m.Mime,
            ["width"] = m.Width,
            ["height"] = m.Height,
            ["bytes"] = m.Size,
            ["sha256"] = m.Sha256,
            ["uploadedAt"] = m.UploadedAt,
        };

        //  그 사람의 그 과제 그림(메타만). 남의 그림은 읽지 않는다.
        private static async Task<List<ImageMeta>> ListMetaAsync(MySqlConnection conn, MySqlTransaction? tx, int userId, uint projectId, CancellationToken ct)
        {
            var list = new List<ImageMeta>();
            await using var cmd = new MySqlCommand(
                "SELECT id, seq, mime, width_px, height_px, LENGTH(bytes) AS size, sha256, uploaded_at " +
                "FROM project_schedule_image WHERE user_id=@u AND project_id=@p ORDER BY seq, id", conn, tx);
            cmd.Parameters.AddWithValue("@u", userId);
            cmd.Parameters.AddWithValue("@p", projectId);
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            while (await rd.ReadAsync(ct))
            {
                list.Add(new ImageMeta
                {
                    Id = Convert.ToInt64(rd["id"], CultureInfo.InvariantCulture),
                    Seq = Convert.ToInt32(rd["seq"], CultureInfo.InvariantCulture),
                    Mime = Str(rd, "mime"),
                    Width = Convert.ToInt32(rd["width_px"], CultureInfo.InvariantCulture),
                    Height = Convert.ToInt32(rd["height_px"], CultureInfo.InvariantCulture),
                    Size = Convert.ToInt64(rd["size"], CultureInfo.InvariantCulture),
                    Sha256 = Str(rd, "sha256"),
                    UploadedAt = Iso(Convert.ToDateTime(rd["uploaded_at"], CultureInfo.InvariantCulture)),
                });
            }
            return list;
        }

        // ================================================================================
        //  2. 추가: 파일 창이나 클립보드를 열기 전에 미리 보고(ProbeAddAsync), 바이트를 얻은 뒤 AddAsync
        // ================================================================================
        //  DB 가 끊겼거나 막혔거나 이미 5장이면 파일 창을 열지 않는다(고른 뒤에 실패하지 않게). 최종 판정은 AddAsync 가 다시 한다.
        public async Task<ScheduleImageReply> ProbeAddAsync(string projectUid)
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                var ct = cts.Token;
                string login = SessionLoginId();
                await using var conn = await OpenAsync(ct);
                var me = await IdentityAsync(conn, null, login, ct);
                uint pid = await ProjectIdAsync(conn, null, projectUid, false, ct);
                long n = await CountAsync(conn, null, me.UserId, pid, ct);
                if (n >= Limits.MaxPerProject) throw new SiFail(Kind.Invalid, MsgTooMany);
                return ScheduleImageReply.Success(new Dictionary<string, object?> { ["projectUid"] = projectUid, ["count"] = n });
            }
            catch (Exception ex) { return Fail("추가 확인", ex); }
        }

        //  바이트를 검사(형식, 크기, 가로세로)하고 한 트랜잭션으로 넣는다. 회신 data: { projectUid, image, images }.
        public async Task<ScheduleImageReply> AddAsync(string projectUid, byte[] bytes)
        {
            try
            {
                var info = await ScheduleImageCodec.InspectAsync(bytes);   // 그림이 아니면 SiFail 대신 ArgumentException(아래에서 invalid)
                string sha = Sha256Hex(bytes);
                string login = SessionLoginId();
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
                var ct = cts.Token;
                await using var conn = await OpenAsync(ct);
                long newId;
                List<ImageMeta> images;
                var tx = await conn.BeginTransactionAsync(ct);
                await using (tx)
                {
                    try
                    {
                        var me = await IdentityAsync(conn, tx, login, ct);
                        uint pid = await ProjectIdAsync(conn, tx, projectUid, lockRow: true, ct);   // 잠금: 과제 행. 같은 과제의 그림 쓰기가 줄을 선다
                        long n = await CountAsync(conn, tx, me.UserId, pid, ct);   // 내 그림만 센다(사람마다 과제당 5장)
                        if (n >= Limits.MaxPerProject) throw new SiFail(Kind.Invalid, MsgTooMany);
                        await using (var dup = new MySqlCommand("SELECT COUNT(*) FROM project_schedule_image WHERE user_id=@u AND project_id=@p AND sha256=@h", conn, tx))
                        {
                            dup.Parameters.AddWithValue("@u", me.UserId);
                            dup.Parameters.AddWithValue("@p", pid);
                            dup.Parameters.AddWithValue("@h", sha);
                            if (Convert.ToInt64(await dup.ExecuteScalarAsync(ct) ?? 0L, CultureInfo.InvariantCulture) > 0) throw new SiFail(Kind.Invalid, MsgDuplicate);
                        }
                        await Renumber(conn, tx, me.UserId, pid, null, ct);   // 1..n 이 아니면 먼저 바로잡는다(손댄 데이터 대비)
                        await using (var ins = new MySqlCommand(
                            "INSERT INTO project_schedule_image (user_id, project_id, seq, mime, bytes, width_px, height_px, sha256, uploaded_at) " +
                            "VALUES (@u, @p, @s, @m, @b, @w, @h, @sha, @at)", conn, tx))
                        {
                            ins.Parameters.AddWithValue("@u", me.UserId);   // 주인 = 세션의 사람(웹 값이 아니다)
                            ins.Parameters.AddWithValue("@p", pid);
                            ins.Parameters.AddWithValue("@s", (int)n + 1);
                            ins.Parameters.AddWithValue("@m", info.Mime);
                            ins.Parameters.Add(new MySqlParameter("@b", MySqlDbType.MediumBlob) { Value = bytes });
                            ins.Parameters.AddWithValue("@w", info.Width);
                            ins.Parameters.AddWithValue("@h", info.Height);
                            ins.Parameters.AddWithValue("@sha", sha);
                            ins.Parameters.AddWithValue("@at", DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture));
                            await ins.ExecuteNonQueryAsync(ct);
                            newId = ins.LastInsertedId;
                        }
                        images = await ListMetaAsync(conn, tx, me.UserId, pid, ct);
                        await CommitWithGateAsync(conn, tx, ct);
                        _log("개발 일정 그림 추가: 과제 " + projectUid + ", 번호 " + newId + ", " + bytes.Length + " bytes, 주인 " + me.UserId);
                    }
                    catch { await SafeRollbackAsync(tx); throw; }
                }
                Cache.Store(_dataDir, sha, info.Mime, bytes, _log);
                Cache.Remember(_dataDir, login, projectUid, images, _log);
                var mine = images.Find(x => x.Id == newId);
                return ScheduleImageReply.Success(new Dictionary<string, object?>
                {
                    ["projectUid"] = projectUid,
                    ["image"] = mine == null ? null : MetaPayload(mine),
                    ["images"] = images.ConvertAll(MetaPayload),
                });
            }
            catch (ArgumentException ax)
            {
                _log("개발 일정 그림 추가 거부(그림 검사): " + ax.Message);
                return ScheduleImageReply.Failure(Kind.Invalid, ax.Message);
            }
            catch (Exception ex) { return Fail("추가", ex); }
        }

        private static async Task<long> CountAsync(MySqlConnection conn, MySqlTransaction? tx, int userId, uint pid, CancellationToken ct)
        {
            await using var cmd = new MySqlCommand("SELECT COUNT(*) FROM project_schedule_image WHERE user_id=@u AND project_id=@p", conn, tx);
            cmd.Parameters.AddWithValue("@u", userId);
            cmd.Parameters.AddWithValue("@p", pid);
            return Convert.ToInt64(await cmd.ExecuteScalarAsync(ct) ?? 0L, CultureInfo.InvariantCulture);
        }

        // ================================================================================
        //  3. 삭제(실제 행 삭제, 휴지통 없음, 관리자 검사 없음, 내 그림만) / 4. 순서 바꾸기(내 그림 안에서)
        // ================================================================================
        public async Task<ScheduleImageReply> DeleteAsync(long id)
        {
            return await WriteOnImageAsync("삭제", id, async (conn, tx, uid, pid, ct) =>
            {
                await using (var del = new MySqlCommand("DELETE FROM project_schedule_image WHERE id=@id AND user_id=@u AND project_id=@p", conn, tx))
                {
                    del.Parameters.AddWithValue("@id", id);
                    del.Parameters.AddWithValue("@u", uid);
                    del.Parameters.AddWithValue("@p", pid);
                    if (await del.ExecuteNonQueryAsync(ct) == 0) throw new SiFail(Kind.NotFound, MsgGone);
                }
                await Renumber(conn, tx, uid, pid, null, ct);
            });
        }

        public async Task<ScheduleImageReply> MoveAsync(long id, int seq)
        {
            return await WriteOnImageAsync("순서 바꾸기", id, async (conn, tx, uid, pid, ct) =>
            {
                await Renumber(conn, tx, uid, pid, (id, seq), ct);
            });
        }

        //  그림 하나를 바꾸는 쓰기의 뼈대: 신원, 내 그림의 과제, 과제 행 FOR UPDATE, 본문(사람 번호, 과제 번호), 목록, 관문 재확인 커밋.
        //  ★ 남의 그림 번호는 없는 번호와 똑같이 notFound(MsgGone)다. 있는지조차 알리지 않는다.
        private async Task<ScheduleImageReply> WriteOnImageAsync(string what, long id,
            Func<MySqlConnection, MySqlTransaction, int, uint, CancellationToken, Task> body)
        {
            try
            {
                string login = SessionLoginId();
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
                var ct = cts.Token;
                await using var conn = await OpenAsync(ct);
                string projectUid;
                List<ImageMeta> images;
                var tx = await conn.BeginTransactionAsync(ct);
                await using (tx)
                {
                    try
                    {
                        var me = await IdentityAsync(conn, tx, login, ct);
                        //  내 그림의 과제(잠금 없이 읽고, 과제 행을 잠근 뒤 본문이 내 그 과제의 그림인지 다시 본다)
                        string? uid = null;
                        await using (var q = new MySqlCommand("SELECT p.uid FROM project_schedule_image i JOIN project p ON p.id = i.project_id WHERE i.id=@id AND i.user_id=@u", conn, tx))
                        {
                            q.Parameters.AddWithValue("@id", id);
                            q.Parameters.AddWithValue("@u", me.UserId);
                            //  ★ project.uid 는 CHAR(36) 이라 MySqlConnector 가 Guid 로 돌려준다(GuidFormat 기본값). 'as string' 이면
                            //    늘 null 이 되어 있는 그림도 '없다' 가 된다(2026-10-22 실 DB 시험에서 잡힘). 글자로 바꿔 읽는다.
                            object? pv = await q.ExecuteScalarAsync(ct);
                            uid = pv == null || pv is DBNull ? null : Convert.ToString(pv, CultureInfo.InvariantCulture)?.ToLowerInvariant();
                        }
                        if (string.IsNullOrEmpty(uid)) throw new SiFail(Kind.NotFound, MsgGone);
                        projectUid = uid;
                        uint pid = await ProjectIdAsync(conn, tx, projectUid, lockRow: true, ct);
                        await body(conn, tx, me.UserId, pid, ct);
                        images = await ListMetaAsync(conn, tx, me.UserId, pid, ct);
                        await CommitWithGateAsync(conn, tx, ct);
                        _log("개발 일정 그림 " + what + ": 번호 " + id + ", 과제 " + projectUid + ", 사람 " + me.UserId);
                    }
                    catch { await SafeRollbackAsync(tx); throw; }
                }
                Cache.Remember(_dataDir, login, projectUid, images, _log);
                return ScheduleImageReply.Success(ListData(projectUid, images, stale: false));
            }
            catch (Exception ex) { return Fail(what, ex); }
        }

        //  그 사람의 그 과제 그림을 1..n 으로 다시 매긴다. move 가 있으면 그 그림을 seq 자리(1..n 으로 자름)로 옮긴다.
        //  ★ (user_id, project_id, seq) UNIQUE 를 피해 두 번에 나눈다: 내 그림을 모두 +100 으로 비켜 놓고, 하나씩 제자리로.
        //    이미 맞으면 아무것도 쓰지 않는다. 부르는 쪽이 과제 행을 FOR UPDATE 로 잡고 있어야 한다. 남의 그림은 읽지도 쓰지도 않는다.
        private static async Task Renumber(MySqlConnection conn, MySqlTransaction tx, int userId, uint pid, (long id, int seq)? move, CancellationToken ct)
        {
            var rows = new List<(long id, int seq)>();
            await using (var q = new MySqlCommand("SELECT id, seq FROM project_schedule_image WHERE user_id=@u AND project_id=@p ORDER BY seq, id FOR UPDATE", conn, tx))
            {
                q.Parameters.AddWithValue("@u", userId);
                q.Parameters.AddWithValue("@p", pid);
                await using var rd = await q.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                    rows.Add((Convert.ToInt64(rd["id"], CultureInfo.InvariantCulture), Convert.ToInt32(rd["seq"], CultureInfo.InvariantCulture)));
            }
            var order = rows.ConvertAll(r => r.id);
            if (move.HasValue)
            {
                int at = order.IndexOf(move.Value.id);
                if (at < 0) throw new SiFail(Kind.NotFound, MsgGone);
                int to = Math.Max(1, Math.Min(order.Count, move.Value.seq)) - 1;
                order.RemoveAt(at);
                order.Insert(to, move.Value.id);
            }
            bool same = true;
            for (int i = 0; i < order.Count; i++)
                if (rows[rows.FindIndex(r => r.id == order[i])].seq != i + 1) { same = false; break; }
            if (same) return;
            await Exec(conn, tx, "UPDATE project_schedule_image SET seq = seq + 100 WHERE user_id=@u AND project_id=@p", ct, ("@u", userId), ("@p", pid));
            for (int i = 0; i < order.Count; i++)
                await Exec(conn, tx, "UPDATE project_schedule_image SET seq=@s WHERE id=@id AND user_id=@u AND project_id=@p", ct, ("@s", i + 1), ("@id", order[i]), ("@u", userId), ("@p", pid));
        }

        // ================================================================================
        //  5. 미리 보기: 사본(없으면 DB 에서 받아 사본으로)에서 작은 JPEG 를 만든다. 끊기면 사본 색인으로
        // ================================================================================
        public async Task<ScheduleImageReply> ThumbAsync(long id)
        {
            ImageMeta? meta = null;
            byte[]? bytes = null;
            bool stale = false;
            string login;
            try { login = SessionLoginId(); }
            catch (SiFail f) { return Fail("미리 보기", f); }
            try
            {
                var got = await GetAsync(id);
                meta = got.meta;
                bytes = got.bytes;
            }
            catch (Exception ex)
            {
                if (ex is SiFail || ex is ArgumentException) return Fail("미리 보기", ex);
                //  끊겼거나 막혔다: 이 로그인의 색인에 그 번호가 있고 사본이 온전하면 그것으로 만든다.
                meta = Cache.FindById(_dataDir, login, id);
                bytes = meta == null ? null : Cache.Load(_dataDir, meta.Sha256, meta.Mime, _log);
                if (meta == null || bytes == null) return Fail("미리 보기", ex);
                stale = true;
            }
            try
            {
                var thumb = Cache.LoadThumb(_dataDir, meta.Sha256);
                int tw, th;
                if (thumb == null)
                {
                    var t = await ScheduleImageCodec.ThumbAsync(bytes!);
                    thumb = t.Jpeg; tw = t.Width; th = t.Height;
                    Cache.StoreThumb(_dataDir, meta.Sha256, thumb, _log);
                }
                else (tw, th) = ThumbSize(meta.Width, meta.Height, thumb);
                return ScheduleImageReply.Success(new Dictionary<string, object?>
                {
                    ["id"] = meta.Id,
                    ["sha256"] = meta.Sha256,
                    ["dataUrl"] = "data:image/jpeg;base64," + Convert.ToBase64String(thumb),
                    ["width"] = tw,
                    ["height"] = th,
                    ["stale"] = stale,
                });
            }
            catch (ArgumentException ax)
            {
                _log("개발 일정 그림 미리 보기 실패(그림 검사): " + ax.Message);
                return ScheduleImageReply.Failure(Kind.Invalid, MsgBroken);
            }
        }

        //  사본 미리 보기의 실제 크기는 JPEG 머리(SOFn)에서 읽는다. 못 읽으면 원본 비율로 어림한다.
        private static (int w, int h) ThumbSize(int w, int h, byte[] jpeg)
        {
            var d = ScheduleImageCodec.JpegSize(jpeg);
            if (d.HasValue) return d.Value;
            double k = Math.Min(1.0, (double)Limits.ThumbEdgePx / Math.Max(1, Math.Max(w, h)));
            return (Math.Max(1, (int)(w * k)), Math.Max(1, (int)(h * k)));
        }

        //  내 그림 한 장의 메타와 바이트. 사본이 해시와 같으면 사본, 아니면 DB 에서 받아 해시를 확인하고 사본을 둔다.
        //  남의 그림 번호는 없는 번호와 같다(notFound).
        //  ★ 해시가 다른 바이트를 DB 가 주면(손댄 데이터) 쓰지 않는다(invalid). 시험(db-schedule-image)이 이 길로 '받기' 를 본다.
        internal async Task<(ImageMeta meta, byte[] bytes, bool fromCache)> GetAsync(long id)
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var ct = cts.Token;
            string login = SessionLoginId();
            await using var conn = await OpenAsync(ct);
            var me = await IdentityAsync(conn, null, login, ct);
            ImageMeta? meta = null;
            await using (var q = new MySqlCommand(
                "SELECT id, seq, mime, width_px, height_px, LENGTH(bytes) AS size, sha256, uploaded_at " +
                "FROM project_schedule_image WHERE id=@id AND user_id=@u", conn))
            {
                q.Parameters.AddWithValue("@id", id);
                q.Parameters.AddWithValue("@u", me.UserId);
                await using var rd = await q.ExecuteReaderAsync(ct);
                if (await rd.ReadAsync(ct))
                {
                    meta = new ImageMeta
                    {
                        Id = Convert.ToInt64(rd["id"], CultureInfo.InvariantCulture),
                        Seq = Convert.ToInt32(rd["seq"], CultureInfo.InvariantCulture),
                        Mime = Str(rd, "mime"),
                        Width = Convert.ToInt32(rd["width_px"], CultureInfo.InvariantCulture),
                        Height = Convert.ToInt32(rd["height_px"], CultureInfo.InvariantCulture),
                        Size = Convert.ToInt64(rd["size"], CultureInfo.InvariantCulture),
                        Sha256 = Str(rd, "sha256"),
                        UploadedAt = Iso(Convert.ToDateTime(rd["uploaded_at"], CultureInfo.InvariantCulture)),
                    };
                }
            }
            if (meta == null) throw new SiFail(Kind.NotFound, MsgGone);
            var cached = Cache.Load(_dataDir, meta.Sha256, meta.Mime, _log);
            if (cached != null) return (meta, cached, true);
            byte[] bytes = await FetchBytesAsync(conn, me.UserId, id, ct);
            if (!string.Equals(Sha256Hex(bytes), meta.Sha256, StringComparison.Ordinal))
                throw new SiFail(Kind.Invalid, MsgBroken);
            Cache.Store(_dataDir, meta.Sha256, meta.Mime, bytes, _log);
            return (meta, bytes, false);
        }

        private static async Task<byte[]> FetchBytesAsync(MySqlConnection conn, int userId, long id, CancellationToken ct)
        {
            await using var q = new MySqlCommand("SELECT bytes FROM project_schedule_image WHERE id=@id AND user_id=@u", conn);
            q.Parameters.AddWithValue("@id", id);
            q.Parameters.AddWithValue("@u", userId);
            object? v = await q.ExecuteScalarAsync(ct);
            if (v is byte[] b) return b;
            throw new SiFail(Kind.NotFound, MsgGone);
        }

        // ================================================================================
        //  DOCX 저장용: 과제마다 **저장하는 사람의** 그림 바이트(순서대로). DB 가 되면 DB 메타 기준(사본이 같으면 사본), 안 되면 이 로그인의 사본 색인
        // ================================================================================
        //  source: "db"(DB 에서 확인), "cache"(DB 가 안 돼 사본으로), "none"(그림 없음). DOCX 저장 자체는 막지 않는다.
        internal sealed class ExportImages
        {
            public Dictionary<string, List<byte[]>> ByProject { get; } = new Dictionary<string, List<byte[]>>(StringComparer.Ordinal);
            public string Source { get; set; } = "none";
            public string Note { get; set; } = "";
            public int Count { get; set; }
        }

        public async Task<ExportImages> ImagesForExportAsync(IReadOnlyCollection<string> projectUids)
        {
            var r = new ExportImages();
            var uids = new List<string>();
            foreach (var u in projectUids) if (UuidRe.IsMatch(u) && !uids.Contains(u)) uids.Add(u);
            if (uids.Count == 0) return r;
            string login = "";
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
                var ct = cts.Token;
                login = SessionLoginId();
                await using var conn = await OpenAsync(ct);
                var me = await IdentityAsync(conn, null, login, ct);
                foreach (var uid in uids)
                {
                    uint pid;
                    try { pid = await ProjectIdAsync(conn, null, uid, false, ct); }
                    catch (SiFail) { continue; }   // 지워진 과제: 그림 없음
                    var metas = await ListMetaAsync(conn, null, me.UserId, pid, ct);   // 내 그림만
                    Cache.Remember(_dataDir, login, uid, metas, _log);
                    var list = new List<byte[]>();
                    foreach (var m in metas)
                    {
                        var b = Cache.Load(_dataDir, m.Sha256, m.Mime, _log);
                        if (b == null)
                        {
                            b = await FetchBytesAsync(conn, me.UserId, m.Id, ct);
                            if (!string.Equals(Sha256Hex(b), m.Sha256, StringComparison.Ordinal)) { _log("개발 일정 그림 해시 불일치(문서에서 뺌): 번호 " + m.Id); continue; }
                            Cache.Store(_dataDir, m.Sha256, m.Mime, b, _log);
                        }
                        list.Add(b);
                    }
                    r.ByProject[uid] = list;
                    r.Count += list.Count;
                }
                r.Source = r.Count > 0 ? "db" : "none";
                return r;
            }
            catch (Exception ex)
            {
                //  끊겼거나 막혔다(또는 신원이 서지 않는다): 이 로그인의 사본 색인으로 넣는다. 저장은 계속한다.
                //  로그인이 없으면 누구의 그림인지 모르므로 사본도 쓰지 않는다(그림 없이 저장).
                var (kind, detail) = ex is SiFail sf ? (sf.Kind, sf.Message) : DbErrors.Observe(ex, _log, notify: false);
                _log("DOCX 그림: DB 를 쓰지 못해 PC 사본으로 넣는다(" + kind + "): " + detail);
                var c = new ExportImages();
                int missing = 0;
                foreach (var uid in uids)
                {
                    if (login.Length == 0) break;
                    var metas = Cache.Recall(_dataDir, login, uid);
                    if (metas == null) continue;
                    var list = new List<byte[]>();
                    foreach (var m in metas)
                    {
                        var b = Cache.Load(_dataDir, m.Sha256, m.Mime, _log);
                        if (b != null) list.Add(b); else missing++;
                    }
                    c.ByProject[uid] = list;
                    c.Count += list.Count;
                }
                c.Source = c.Count > 0 ? "cache" : "none";
                c.Note = "서버의 그림을 읽지 못해(연결 끊김, 버전 차이, 로그인 문제) PC 에 받아 둔 개발 일정 그림으로 저장했습니다" + (missing > 0 ? "(받아 두지 않은 그림 " + missing + "장은 빠졌습니다)." : ".");
                return c;
            }
        }

        // ── 요청 값 ──────────────────────────────────────────────────────────
        //  과제 id: 'db-<uuid>' 또는 '<uuid>'(소문자로). 형식이 아니면 invalid.
        internal static string NormalizeProjectUid(string? raw)
        {
            string v = (raw ?? "").Trim();
            if (v.StartsWith("db-", StringComparison.Ordinal)) v = v.Substring(3);
            v = v.ToLowerInvariant();
            return UuidRe.IsMatch(v) ? v : "";
        }

        private static string ReqProjectUid(JsonElement q)
        {
            string v = NormalizeProjectUid(Str(q, "projectUid"));
            if (v.Length == 0) throw new SiFail(Kind.Invalid, "과제 id 형식이 잘못되었습니다.");
            return v;
        }

        internal static string ReqProjectUidOrEmpty(string rawJson)
        {
            try
            {
                using var doc = JsonDocument.Parse(string.IsNullOrEmpty(rawJson) ? "{}" : rawJson);
                return doc.RootElement.ValueKind == JsonValueKind.Object ? NormalizeProjectUid(Str(doc.RootElement, "projectUid")) : "";
            }
            catch (JsonException) { return ""; }
        }

        private static long ReqId(JsonElement q)
        {
            if (q.TryGetProperty("id", out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out long n) && n >= 1) return n;
            throw new SiFail(Kind.Invalid, "그림 번호 형식이 잘못되었습니다.");
        }

        private static int ReqSeq(JsonElement q)
        {
            if (q.TryGetProperty("seq", out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out int n) && n >= 1 && n <= 255) return n;
            throw new SiFail(Kind.Invalid, "순서 형식이 잘못되었습니다.");
        }

        // ── 작은 도구 ──────────────────────────────────────────────────────────
        internal static string Sha256Hex(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
        private static string Iso(DateTime utc) => DateTime.SpecifyKind(utc, DateTimeKind.Utc).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

        private static async Task<int> Exec(MySqlConnection conn, MySqlTransaction? tx, string sql, CancellationToken ct, params (string, object?)[] ps)
        {
            await using var cmd = new MySqlCommand(sql, conn, tx);
            foreach (var (k, v) in ps) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
            return await cmd.ExecuteNonQueryAsync(ct);
        }

        private static string Str(MySqlDataReader rd, string col)
        {
            int i = rd.GetOrdinal(col);
            return rd.IsDBNull(i) ? "" : Convert.ToString(rd.GetValue(i), CultureInfo.InvariantCulture) ?? "";
        }

        private static string Str(JsonElement o, string k) =>
            o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";

        // ================================================================================
        //  PC 사본: <앱 데이터>\schedule-images\<sha256>.png|jpg, thumb\<sha256>.jpg, index.json(과제별 메타)
        // ================================================================================
        //  ★ 파일 이름은 해시와 형식에서만 만든다(웹 값이 경로에 닿지 않는다). 해시는 소문자 16진수 64자만 받는다.
        //  ★ 쓰기는 같은 폴더 임시 파일에 쓰고 옮긴다(반쯤 쓴 사본이 남지 않게). 읽을 때 해시를 다시 본다.
        //  ★ 색인은 (로그인 id, 과제)마다 마지막으로 본 목록이다. 키는 '<login>|<과제 uid>'. 한 PC 를 둘이 써도 남의 목록이 보이지 않는다.
        //    옛 모양(과제 uid 만, 사람별 그림 전 시험판)의 키는 색인을 고칠 때 버린다. 색인 어디에도 없는 사본은 그때 지운다(쌓이지 않게).
        //    바이트 사본은 해시 이름이라 사람이 달라도 같은 그림이면 한 벌이다.
        internal static class Cache
        {
            private static readonly object Gate = new object();
            private static readonly JsonSerializerOptions Json = new JsonSerializerOptions
            {
                Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
                WriteIndented = false,
            };

            public static string Dir(string dataDir) => Path.Combine(dataDir, "schedule-images");
            private static string ThumbDir(string dataDir) => Path.Combine(Dir(dataDir), "thumb");
            private static string IndexPath(string dataDir) => Path.Combine(Dir(dataDir), "index.json");

            public static string? FileFor(string dataDir, string sha, string mime)
            {
                if (!ShaRe.IsMatch(sha ?? "")) return null;
                string ext = mime == "image/png" ? ".png" : mime == "image/jpeg" ? ".jpg" : "";
                return ext.Length == 0 ? null : Path.Combine(Dir(dataDir), sha + ext);
            }

            //  해시가 맞는 사본만 돌려준다. 다르면(깨졌거나 바뀜) 지우고 null.
            public static byte[]? Load(string dataDir, string sha, string mime, Action<string> log)
            {
                string? p = FileFor(dataDir, sha, mime);
                if (p == null) return null;
                try
                {
                    if (!File.Exists(p)) return null;
                    var b = File.ReadAllBytes(p);
                    if (string.Equals(Sha256Hex(b), sha, StringComparison.Ordinal)) return b;
                    log("개발 일정 그림 사본 해시 불일치, 지운다: " + Path.GetFileName(p));
                    TryDelete(p);
                }
                catch (Exception ex) { log("개발 일정 그림 사본 읽기 실패: " + ex.Message); }
                return null;
            }

            public static void Store(string dataDir, string sha, string mime, byte[] bytes, Action<string> log)
            {
                string? p = FileFor(dataDir, sha, mime);
                if (p == null) return;
                try { WriteAtomic(p, bytes); }
                catch (Exception ex) { log("개발 일정 그림 사본 쓰기 실패: " + ex.Message); }
            }

            public static byte[]? LoadThumb(string dataDir, string sha)
            {
                if (!ShaRe.IsMatch(sha ?? "")) return null;
                string p = Path.Combine(ThumbDir(dataDir), sha + ".jpg");
                try { return File.Exists(p) ? File.ReadAllBytes(p) : null; } catch { return null; }
            }

            public static void StoreThumb(string dataDir, string sha, byte[] jpeg, Action<string> log)
            {
                if (!ShaRe.IsMatch(sha ?? "")) return;
                try { WriteAtomic(Path.Combine(ThumbDir(dataDir), sha + ".jpg"), jpeg); }
                catch (Exception ex) { log("개발 일정 그림 미리 보기 사본 쓰기 실패: " + ex.Message); }
            }

            internal static string Key(string login, string projectUid) => login + "|" + projectUid;

            //  그 로그인, 그 과제의 최신 목록을 색인에 적고, 색인 어디에도 없는 사본을 지운다.
            public static void Remember(string dataDir, string login, string projectUid, List<ImageMeta> images, Action<string> log)
            {
                if (string.IsNullOrEmpty(login)) return;
                lock (Gate)
                {
                    try
                    {
                        var idx = ReadIndex(dataDir);
                        foreach (var k in new List<string>(idx.Keys)) if (k.IndexOf('|') < 0) idx.Remove(k);   // 옛 공용 모양 키
                        idx[Key(login, projectUid)] = images;
                        Directory.CreateDirectory(Dir(dataDir));
                        WriteAtomic(IndexPath(dataDir), System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(idx, Json)));
                        Prune(dataDir, idx);
                    }
                    catch (Exception ex) { log("개발 일정 그림 색인 쓰기 실패: " + ex.Message); }
                }
            }

            public static List<ImageMeta>? Recall(string dataDir, string login, string projectUid)
            {
                if (string.IsNullOrEmpty(login)) return null;
                lock (Gate)
                {
                    var idx = ReadIndex(dataDir);
                    return idx.TryGetValue(Key(login, projectUid), out var l) ? l : null;
                }
            }

            //  이 로그인의 색인에서만 찾는다(남의 목록에 있는 번호는 없는 번호다).
            public static ImageMeta? FindById(string dataDir, string login, long id)
            {
                if (string.IsNullOrEmpty(login)) return null;
                string pre = login + "|";
                lock (Gate)
                {
                    foreach (var kv in ReadIndex(dataDir))
                    {
                        if (!kv.Key.StartsWith(pre, StringComparison.Ordinal)) continue;
                        foreach (var m in kv.Value) if (m.Id == id) return m;
                    }
                    return null;
                }
            }

            private static Dictionary<string, List<ImageMeta>> ReadIndex(string dataDir)
            {
                try
                {
                    string p = IndexPath(dataDir);
                    if (!File.Exists(p)) return new Dictionary<string, List<ImageMeta>>(StringComparer.Ordinal);
                    var d = JsonSerializer.Deserialize<Dictionary<string, List<ImageMeta>>>(File.ReadAllText(p), Json);
                    return d == null ? new Dictionary<string, List<ImageMeta>>(StringComparer.Ordinal)
                                     : new Dictionary<string, List<ImageMeta>>(d, StringComparer.Ordinal);
                }
                catch { return new Dictionary<string, List<ImageMeta>>(StringComparer.Ordinal); }   // 깨진 색인은 새로 시작한다
            }

            private static void Prune(string dataDir, Dictionary<string, List<ImageMeta>> idx)
            {
                var keep = new HashSet<string>(StringComparer.Ordinal);
                foreach (var l in idx.Values) foreach (var m in l) keep.Add(m.Sha256);
                foreach (var dir in new[] { Dir(dataDir), ThumbDir(dataDir) })
                {
                    if (!Directory.Exists(dir)) continue;
                    foreach (var f in Directory.GetFiles(dir))
                    {
                        string name = Path.GetFileNameWithoutExtension(f);
                        string ext = Path.GetExtension(f).ToLowerInvariant();
                        if ((ext == ".png" || ext == ".jpg") && ShaRe.IsMatch(name) && !keep.Contains(name)) TryDelete(f);
                    }
                }
            }

            private static void WriteAtomic(string path, byte[] bytes)
            {
                string dir = Path.GetDirectoryName(path) ?? ".";
                Directory.CreateDirectory(dir);
                string tmp = Path.Combine(dir, "." + Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N") + ".tmp");
                try
                {
                    File.WriteAllBytes(tmp, bytes);
                    File.Move(tmp, path, true);
                }
                finally { TryDelete(tmp); }
            }

            private static void TryDelete(string p) { try { if (File.Exists(p)) File.Delete(p); } catch { } }
        }
    }

    // ================================================================================
    //  그림 검사와 미리 보기(WPF 이미징). 모두 따로 띄운 STA 스레드에서 돈다(UI 스레드를 막지 않고, 콘솔 시험 러너에서도 같다).
    // ================================================================================
    internal static class ScheduleImageCodec
    {
        internal readonly struct Info
        {
            public string Mime { get; }
            public int Width { get; }
            public int Height { get; }
            public Info(string mime, int w, int h) { Mime = mime; Width = w; Height = h; }
        }

        internal readonly struct Thumb
        {
            public byte[] Jpeg { get; }
            public int Width { get; }
            public int Height { get; }
            public Thumb(byte[] jpeg, int w, int h) { Jpeg = jpeg; Width = w; Height = h; }
        }

        //  형식(머리 글자와 WPF BitmapDecoder 가 같은 형식), 크기(5MB), 가로세로(1..16000)를 본다. 틀리면 ArgumentException(고정 문구).
        public static Task<Info> InspectAsync(byte[] bytes) => StaAsync(() => Inspect(bytes));

        internal static Info Inspect(byte[] bytes)
        {
            if (bytes == null || bytes.Length == 0) throw new ArgumentException(ScheduleImageDb.MsgBroken);
            if (bytes.Length > ScheduleImageDb.Limits.MaxBytes) throw new ArgumentException(ScheduleImageDb.MsgTooBig);
            string mime = Sniff(bytes);
            if (mime.Length == 0) throw new ArgumentException(ScheduleImageDb.MsgNotImage);
            BitmapDecoder dec;
            try
            {
                using var ms = new MemoryStream(bytes, writable: false);
                dec = BitmapDecoder.Create(ms, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
            }
            catch (Exception) { throw new ArgumentException(ScheduleImageDb.MsgBroken); }
            bool kindOk = mime == "image/png" ? dec is PngBitmapDecoder : dec is JpegBitmapDecoder;
            if (!kindOk || dec.Frames.Count < 1) throw new ArgumentException(ScheduleImageDb.MsgNotImage);
            var f = dec.Frames[0];
            int w = f.PixelWidth, h = f.PixelHeight;
            if (w < 1 || h < 1) throw new ArgumentException(ScheduleImageDb.MsgBroken);
            if (w > ScheduleImageDb.Limits.MaxEdgePx || h > ScheduleImageDb.Limits.MaxEdgePx) throw new ArgumentException(ScheduleImageDb.MsgHuge);
            return new Info(mime, w, h);
        }

        //  머리 글자: PNG 89 50 4E 47 0D 0A 1A 0A, JPEG FF D8 FF. 확장자는 보지 않는다.
        internal static string Sniff(byte[] b)
        {
            if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) return "image/png";
            if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";
            return "";
        }

        //  미리 보기: 긴 변 360 에서 시작해 흰 바탕 JPEG 로 만들고, 40KB 를 넘으면 품질과 크기를 줄여 다시 만든다.
        public static Task<Thumb> ThumbAsync(byte[] bytes) => StaAsync(() => MakeThumb(bytes));

        private static Thumb MakeThumb(byte[] bytes)
        {
            var info = Inspect(bytes);
            Thumb last = default;
            foreach (int edge in new[] { ScheduleImageDb.Limits.ThumbEdgePx, 300, 240, 180, 120 })
            {
                double k = Math.Min(1.0, (double)edge / Math.Max(info.Width, info.Height));
                int tw = Math.Max(1, (int)Math.Round(info.Width * k)), th = Math.Max(1, (int)Math.Round(info.Height * k));
                var src = new BitmapImage();
                using (var ms = new MemoryStream(bytes, writable: false))
                {
                    src.BeginInit();
                    src.CacheOption = BitmapCacheOption.OnLoad;
                    src.StreamSource = ms;
                    if (info.Width >= info.Height) src.DecodePixelWidth = tw; else src.DecodePixelHeight = th;
                    src.EndInit();
                }
                var dv = new DrawingVisual();
                using (var dc = dv.RenderOpen())
                {
                    dc.DrawRectangle(Brushes.White, null, new Rect(0, 0, tw, th));   // 투명한 PNG 가 검게 나오지 않게
                    dc.DrawImage(src, new Rect(0, 0, tw, th));
                }
                var rtb = new RenderTargetBitmap(tw, th, 96, 96, PixelFormats.Pbgra32);
                rtb.Render(dv);
                foreach (int quality in new[] { 80, 65, 50 })
                {
                    var enc = new JpegBitmapEncoder { QualityLevel = quality };
                    enc.Frames.Add(BitmapFrame.Create(rtb));
                    using var outMs = new MemoryStream();
                    enc.Save(outMs);
                    last = new Thumb(outMs.ToArray(), tw, th);
                    if (last.Jpeg.Length <= ScheduleImageDb.Limits.ThumbMaxBytes) return last;
                }
            }
            return last;   // 가장 작게 만든 것(120 화소, 품질 50). 40KB 를 넘는 일은 사실상 없다
        }

        //  JPEG 의 가로세로(SOF0..SOF15, DHT, JPG, DAC 제외). 못 읽으면 null.
        internal static (int w, int h)? JpegSize(byte[] b)
        {
            int i = 2;
            while (i + 9 < b.Length)
            {
                if (b[i] != 0xFF) return null;
                byte m = b[i + 1];
                int len = (b[i + 2] << 8) | b[i + 3];
                if (m >= 0xC0 && m <= 0xCF && m != 0xC4 && m != 0xC8 && m != 0xCC)
                    return ((b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]);
                i += 2 + len;
            }
            return null;
        }

        //  클립보드의 그림(UI 스레드에서 부른다). 순서: PNG 데이터(잘라 복사한 그림), 파일 하나(탐색기에서 복사한 PNG, JPEG),
        //  비트맵(그 밖의 그림, PNG 로 바꿔 담는다). 없으면 ArgumentException(고정 문구).
        public static byte[] ReadClipboard()
        {
            try
            {
                if (Clipboard.ContainsData("PNG") && Clipboard.GetData("PNG") is MemoryStream pngStream)
                {
                    using (pngStream) return pngStream.ToArray();
                }
                if (Clipboard.ContainsFileDropList())
                {
                    var files = Clipboard.GetFileDropList();
                    if (files.Count == 1)
                    {
                        string p = files[0] ?? "";
                        string ext = Path.GetExtension(p).ToLowerInvariant();
                        if (ext != ".png" && ext != ".jpg" && ext != ".jpeg") throw new ArgumentException(ScheduleImageDb.MsgNotImage);
                        var fi = new FileInfo(p);
                        if (!fi.Exists) throw new ArgumentException(ScheduleImageDb.MsgBroken);
                        if (fi.Length > ScheduleImageDb.Limits.MaxBytes) throw new ArgumentException(ScheduleImageDb.MsgTooBig);
                        return File.ReadAllBytes(p);
                    }
                    if (files.Count > 1) throw new ArgumentException("그림 파일은 한 번에 하나씩 붙여 넣으세요.");
                }
                if (Clipboard.ContainsImage())
                {
                    var bmp = Clipboard.GetImage();
                    if (bmp != null)
                    {
                        var enc = new PngBitmapEncoder();
                        enc.Frames.Add(BitmapFrame.Create(bmp));
                        using var ms = new MemoryStream();
                        enc.Save(ms);
                        return ms.ToArray();
                    }
                }
            }
            catch (ArgumentException) { throw; }
            catch (Exception ex) { throw new ArgumentException("클립보드를 읽지 못했습니다. 잠시 뒤 다시 붙여 넣으세요. (" + ex.GetType().Name + ")"); }
            throw new ArgumentException("클립보드에 그림이 없습니다. 그림을 복사한 뒤 붙여 넣으세요.");
        }

        //  WPF 이미징을 따로 띄운 STA 스레드에서 돌린다. 예외는 그대로 전한다.
        private static Task<T> StaAsync<T>(Func<T> f)
        {
            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            var t = new Thread(() =>
            {
                try { tcs.SetResult(f()); }
                catch (Exception ex) { tcs.SetException(ex); }
            }) { IsBackground = true, Name = "schedule-image-codec" };
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            return tcs.Task;
        }
    }

    //  명령 하나의 회신. MainWindow 가 { ok, data?, error?: { kind, message } } 로 웹에 보낸다. 파일 창 취소는 { ok:false, cancelled:true }.
    internal sealed class ScheduleImageReply
    {
        public bool Ok { get; private set; }
        public bool Cancelled { get; private set; }
        public object? Data { get; private set; }
        public string Kind { get; private set; } = "";
        public string Message { get; private set; } = "";

        public static ScheduleImageReply Success(object data) => new ScheduleImageReply { Ok = true, Data = data };
        public static ScheduleImageReply Failure(string kind, string message, object? data = null) =>
            new ScheduleImageReply { Ok = false, Kind = kind, Message = message, Data = data };
        public static ScheduleImageReply Cancel() => new ScheduleImageReply { Ok = false, Cancelled = true };

        public object ToPayload() => Ok
            ? new Dictionary<string, object?> { ["ok"] = true, ["data"] = Data }
            : Cancelled
                ? new Dictionary<string, object?> { ["ok"] = false, ["cancelled"] = true }
                : new Dictionary<string, object?> { ["ok"] = false, ["data"] = Data, ["error"] = new Dictionary<string, object?> { ["kind"] = Kind, ["message"] = Message } };
    }
}
