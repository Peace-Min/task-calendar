// =====================================================================
//  xml-to-db — data.xml → cal_* 이관 (설계 §8, 1회성)
// =====================================================================
//
//  【이 도구가 지켜야 하는 것 — 하나라도 어기면 조용히 틀린다】
//
//   ★ fromXML() 을 쓰지 않는다. XML 을 **직접** 읽는다(§8).
//     앱의 파서는 유효 코드가 아닌 근태 status 를 '1'(정근)으로 **흡수**한다. 그걸 통과시킨 값을
//     DB 에 넣으면 커밋 8adb1ab 가 고치려던 결함이 영구 데이터로 굳는다 —
//     그 사람의 휴가·병가가 다음 전송에서 정근으로 덮인다.
//
//   ★ INSERT 전용이다. UPSERT·REPLACE·선삭제 금지(§8).
//     그래서 CalendarWriteDb 를 쓰지 않는다 — 그건 UPSERT 라 이 계약을 못 지킨다.
//
//   ★ 단일 트랜잭션이다. 청크 커밋 분할 금지 — 원자성을 잃고 왕복 대조가 무효화된다.
//
//   ★ 재실행 방지: cal_migration_log 를 **같은 트랜잭션**에 넣는다. 행이 있으면 거부한다.
//     XML 은 PC 단위인데 이관은 사람 단위다. 두 번째 PC 에서 또 돌리면 삭제한 일정이 되살아난다.
//
//   ★ 조용히 버리지 않는다. 버린 것은 전부 리포트에 건수로 보고한다
//     (entry@hours · 무효 근태 day · 중복 예외일 · 미존재 과제 참조).
//
//  【사용】
//    dotnet run -- --login-id=hjlee [--xml=PATH] [--dry-run]
//      --dry-run : 전부 해 보고 **롤백**한다. 리포트와 왕복 대조는 그대로 나온다.
// =====================================================================
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Xml.Linq;
using MySqlConnector;

static class P
{
    // ── 배포 구성 — widget/DeployConfig.cs 와 같은 값이어야 한다 ────────────
    //   ★ 여기에 복사본을 두는 이유: 이 도구는 위젯이 아니고, 위젯 어셈블리를 참조하면
    //     WPF 의존이 통째로 딸려온다. 값이 갈리면 '다른 DB 에 이관' 이 되므로 배포 전 대조할 것.
    const string DbHost = "localhost"; const int DbPort = 3306;
    const string DbName = "taskmgr";   const string DbUser = "root";
    static string DbPass = Environment.GetEnvironmentVariable("TC_MIGRATE_DB_PW") ?? "";

    static string Conn() => new MySqlConnectionStringBuilder {
        Server = DbHost, Port = (uint)DbPort, Database = DbName, UserID = DbUser, Password = DbPass,
        ConnectionTimeout = 6, DefaultCommandTimeout = 60, Pooling = false, UseAffectedRows = false,
    }.ConnectionString;

    // ── 리포트 ──────────────────────────────────────────────────────────────
    static readonly List<string> Notes = new();
    static readonly List<string> Warns = new();
    static void Note(string s) { Notes.Add(s); Console.WriteLine("  · " + s); }
    static void Warn(string s) { Warns.Add(s); Console.WriteLine("  ⚠ " + s); }
    static void Die(string s) { Console.Error.WriteLine("\n[중단] " + s); Environment.Exit(2); }

    // ── 값 변환(§8 · schema-calendar.sql A·B 부류) ──────────────────────────
    //   A: '' → NULL. 대상 8컬럼은 DDL 헤더가 정본이다. 여기서는 그 함수만 제공한다.
    static object? NullIfEmpty(string? s) => string.IsNullOrEmpty(s) ? null : s;

    //   B: 시각. XML 은 toISOString() 산출물('2026-08-10T02:33:44.123Z')이라 원형 그대로 넣으면
    //      ERROR 1292 로 첫 행에서 전체가 롤백된다. 소수는 **정확히 3자리** — 4자리는 오류도 경고도
    //      없이 반올림돼 그 사용자의 첫 편집을 전부 충돌 오탐으로 만든다(§3.3).
    static readonly Regex IsoRe = new(@"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z?$");
    static string? IsoToDb(string? iso)
    {
        if (string.IsNullOrWhiteSpace(iso)) return null;
        var m = IsoRe.Match(iso.Trim());
        if (!m.Success) return null;
        string frac = m.Groups[3].Success ? m.Groups[3].Value : "";
        frac = (frac + "000").Substring(0, 3);          // 모자라면 채우고 넘치면 자른다(반올림 금지)
        return m.Groups[1].Value + " " + m.Groups[2].Value + "." + frac;
    }
    static readonly Regex DateRe = new(@"^\d{4}-\d{2}-\d{2}$");
    static readonly Regex TimeRe = new(@"^\d{2}:\d{2}$");
    static object? DateOrNull(string? s) => (s != null && DateRe.IsMatch(s)) ? s : null;
    static object? TimeOrNull(string? s) => (s != null && TimeRe.IsMatch(s)) ? s : null;

    static string A(XElement e, string n) => e.Attribute(n)?.Value ?? "";
    static string T(XElement? e) => e?.Value ?? "";
    static int? IntOrNull(string s) => int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : (int?)null;

    // 근태 유효 코드 — DB CHECK 와 같은 집합. 여기 목록을 늘리려면 CHECK 도 같이 늘려야 한다.
    static readonly HashSet<string> AttendOk = new() { "1","2","3","4","5","6","7","9","10","11","12" };

    static async Task<int> Main(string[] argv)
    {
        string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        string xmlPath = Path.Combine(appData, "TaskCalendar", "data.xml");
        //  ★ 저장소 경로 파일은 **PC 단위**라 대상 사용자와 무관하게 이 PC 의 것을 쓴다.
        //    그래서 시험이 실 파일을 덮을 수 있다 — 시험은 반드시 --repo-paths-out 으로 딴 데를 준다.
        string repoOut = Path.Combine(appData, "TaskCalendar", "repo-paths.json");
        string loginId = ""; bool dry = false;
        foreach (var a in argv)
        {
            if (a.StartsWith("--xml=")) xmlPath = a.Substring(6);
            else if (a.StartsWith("--login-id=")) loginId = a.Substring(11);
            else if (a.StartsWith("--repo-paths-out=")) repoOut = a.Substring(17);
            else if (a == "--dry-run") dry = true;
            else if (a.StartsWith("--db-pw=")) DbPass = a.Substring(8);
            else { Console.Error.WriteLine("알 수 없는 인자: " + a); return 2; }
        }
        if (loginId.Length == 0) { Console.Error.WriteLine("--login-id=<회사 계정> 가 필요합니다."); return 2; }
        if (!File.Exists(xmlPath)) { Console.Error.WriteLine("XML 이 없습니다: " + xmlPath); return 2; }
        if (DbPass.Length == 0) { Console.Error.WriteLine("DB 비밀번호가 없습니다. TC_MIGRATE_DB_PW 또는 --db-pw= 로 주세요."); return 2; }

        Console.WriteLine(new string('=', 72));
        Console.WriteLine($"data.xml → DB 이관{(dry ? "  [예행 — 롤백한다]" : "")}");
        Console.WriteLine($"  XML   : {xmlPath}");
        Console.WriteLine($"  대상  : {loginId}");
        Console.WriteLine(new string('=', 72));

        var doc = XDocument.Load(xmlPath, LoadOptions.PreserveWhitespace);
        var root = doc.Root!;

        // ── 1. XML 을 직접 읽어 모델을 만든다 ────────────────────────────────
        Console.WriteLine("\n[1] XML 읽기(앱 파서를 쓰지 않는다)");

        var cats = (root.Element("categories")?.Elements("category") ?? Enumerable.Empty<XElement>()).ToList();
        var ents = (root.Element("entries")?.Elements("entry") ?? Enumerable.Empty<XElement>()).ToList();
        var tods = (root.Element("todos")?.Elements("todo") ?? Enumerable.Empty<XElement>()).ToList();
        var rooms = (root.Element("rooms")?.Elements("room") ?? Enumerable.Empty<XElement>()).Select(r => T(r).Trim()).Where(s => s.Length > 0).ToList();
        var prefs = root.Element("prefs");
        var thDays = (root.Element("taskHours")?.Elements("day") ?? Enumerable.Empty<XElement>()).ToList();
        var atDays = (root.Element("attendance")?.Elements("day") ?? Enumerable.Empty<XElement>()).ToList();
        Console.WriteLine($"  과제 {cats.Count} · 일정 {ents.Count} · 할 일 {tods.Count} · 회의실 {rooms.Count}" +
                          $" · 공수 {thDays.Count}일 · 근태 {atDays.Count}일");

        // ── 2. 중단 조건 — 도구가 고칠 수 없는 것은 사람에게 넘긴다 ──────────
        Console.WriteLine("\n[2] 사전 검사");
        var catUids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in cats)
        {
            string id = A(c, "id");
            if (id.Length == 0) Die("과제에 id 가 없다 — 원본 XML 을 확인할 것");
            if (!catUids.Add(id)) Die($"과제 id 가 중복이다: {id}");
            //  project_uid 는 파생값이다(§8). source='db' 이고 'db-' + 36자일 때만 만든다.
            //  조건에 안 맞으면 추측해 채우지도, 조용히 버리지도 않는다 — 중단한다.
            if (A(c, "source") == "db" && !(id.StartsWith("db-", StringComparison.Ordinal) && id.Length == 39))
                Die($"source='db' 인데 id 가 'db-'+36자가 아니다: {id}\n" +
                    "  → 복원 근거가 소실된 상태다. 도구가 고칠 수 없다. 원본 XML 을 보고 사람이 정할 것(§8).");
        }
        var entUids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in ents) { var id = A(e, "id"); if (id.Length == 0) Die("일정에 id 가 없다"); if (!entUids.Add(id)) Die($"일정 id 중복: {id}"); }
        var todUids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var t in tods) { var id = A(t, "id"); if (id.Length == 0) Die("할 일에 id 가 없다"); if (!todUids.Add(id)) Die($"할 일 id 중복: {id}"); }
        Console.WriteLine("  중단 조건 없음");

        // ── 3. DB 연결 · 소유자 해석 · 재실행 방지 ───────────────────────────
        Console.WriteLine("\n[3] 대상 확인");
        await using var conn = new MySqlConnection(Conn());
        await conn.OpenAsync();
        await Ex(conn, null, "SET SESSION time_zone='+00:00', SESSION transaction_isolation='READ-COMMITTED'");

        object? uidObj = await Sc(conn, null, "SELECT user_id FROM app_user WHERE login_id=@l", ("@l", loginId));
        if (uidObj == null) Die($"app_user 에 '{loginId}' 가 없다. 없는 사람의 캘린더를 만들면 그 행을 가리킬 로그인이 영영 없다(§8).");
        int uid = Convert.ToInt32(uidObj, CultureInfo.InvariantCulture);
        Console.WriteLine($"  user_id = {uid}");

        if (Convert.ToInt64(await Sc(conn, null, $"SELECT COUNT(*) FROM cal_migration_log WHERE user_id={uid}") ?? 0L) > 0)
            Die("이미 이관된 사용자다(cal_migration_log 에 행이 있다). 재실행하면 사용자가 지운 일정이 되살아난다(§8).");
        long existing = Convert.ToInt64(await Sc(conn, null,
            $"SELECT (SELECT COUNT(*) FROM cal_category WHERE user_id={uid})+(SELECT COUNT(*) FROM cal_entry WHERE user_id={uid})" +
            $"+(SELECT COUNT(*) FROM cal_todo WHERE user_id={uid})") ?? 0L);
        if (existing > 0) Die($"이 사용자에게 이미 캘린더 데이터가 {existing}행 있다. 이 도구는 INSERT 전용이라 덮어쓰지 않는다(§8).");
        Console.WriteLine("  재실행 방지 통과 · 기존 데이터 0행");

        // ── 4. 이관 ──────────────────────────────────────────────────────────
        Console.WriteLine($"\n[4] 이관{(dry ? "(예행)" : "")}");
        string now = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
        var catNo = new Dictionary<string, uint>(StringComparer.Ordinal);
        var repoPaths = new Dictionary<string, object>(StringComparer.Ordinal);
        int droppedHours = 0, droppedDays = 0, dedupExcept = 0, orphanCat = 0;

        await using var tx = await conn.BeginTransactionAsync();
        try
        {
            // 4-1 과제 — 부모 먼저(FK). updated_at 은 created_at 을 **복사**한다(이관 시각이 아니다 §8).
            uint no = 0;
            foreach (var c in cats)
            {
                string id = A(c, "id");
                string created = IsoToDb(A(c, "createdAt")) ?? now;
                bool isDb = A(c, "source") == "db";
                string git = A(c, "gitRepo"), svn = A(c, "svnRepo");
                if (git.Length > 0 || svn.Length > 0) repoPaths[id] = new { git, svn };
                await Ex(conn, tx,
                    "INSERT INTO cal_category (user_id,cat_no,uid,source,name,color,description,project_uid,uses_repo,sort_order,created_at,updated_at) " +
                    "VALUES (@u,@n,@id,@src,@nm,@col,@desc,@pu,@ur,@so,@ca,@ca)",
                    ("@u", uid), ("@n", ++no), ("@id", id), ("@src", isDb ? "db" : "local"),
                    ("@nm", T(c.Element("name"))), ("@col", A(c, "color")), ("@desc", T(c.Element("description"))),
                    ("@pu", isDb ? id.Substring(3) : (object?)null),
                    ("@ur", (git.Length > 0 || svn.Length > 0) ? 1 : 0), ("@so", (int)no - 1), ("@ca", created));
                catNo[id] = no;
            }
            Console.WriteLine($"  과제 {catNo.Count}건");

            // 4-2 일정 + 자식
            uint eno = 0; int nExcept = 0, nCommit = 0;
            foreach (var e in ents)
            {
                string id = A(e, "id");
                string? cid = A(e, "categoryId"); if (cid.Length == 0) cid = null;
                object? cno = null;
                if (cid != null) {
                    //  미존재 참조는 NULL 로 정리하고 건수를 보고한다(H-3) — 앱은 무해하지만 DB 는 번호를 만들 수 없다.
                    if (catNo.TryGetValue(cid, out var cv)) cno = cv; else orphanCat++;
                }
                if (A(e, "hours").Length > 0) droppedHours++;   // 받을 컬럼이 없다(§5.3). 조용히 버리지 않는다.
                var rec = e.Element("recur");
                string rf = rec == null ? "" : A(rec, "freq");
                await Ex(conn, tx,
                    "INSERT INTO cal_entry (user_id,entry_no,uid,cat_no,entry_date,end_date,all_day,start_time,end_time," +
                    "title,memo,source,location,remind,recur_freq,recur_interval,recur_until,recur_count,sort_order,created_at,updated_at) " +
                    "VALUES (@u,@n,@id,@c,@dt,@ed,@ad,@st,@et,@ti,@mo,@sr,@lo,@rm,@rf,@ri,@ru,@rc,@so,@ca,@ua)",
                    ("@u", uid), ("@n", ++eno), ("@id", id), ("@c", cno),
                    ("@dt", DateOrNull(A(e, "date"))), ("@ed", DateOrNull(A(e, "endDate"))),
                    ("@ad", A(e, "allDay") == "true" ? 1 : 0),
                    ("@st", TimeOrNull(A(e, "startTime"))), ("@et", TimeOrNull(A(e, "endTime"))),
                    ("@ti", T(e.Element("title"))), ("@mo", T(e.Element("memo"))),
                    ("@sr", A(e, "source")), ("@lo", A(e, "location")),
                    ("@rm", IntOrNull(A(e, "remind")) is int r0 ? r0 : (object?)null),
                    ("@rf", rf.Length > 0 ? rf : (object?)null),
                    ("@ri", rf.Length > 0 ? (IntOrNull(A(rec!, "interval")) ?? 1) : (object?)null),
                    ("@ru", rf.Length > 0 ? DateOrNull(A(rec!, "until")) : null),
                    ("@rc", rf.Length > 0 ? (IntOrNull(A(rec!, "count")) ?? 0) : (object?)null),
                    ("@so", (int)eno - 1), ("@ca", IsoToDb(A(e, "createdAt")) ?? now), ("@ua", IsoToDb(A(e, "updatedAt")) ?? now));

                //  예외일 — **dedup 은 어댑터가 항상 한다**(§8). 앱이 어디서도 중복을 제거하지 않아
                //  같은 날짜가 두 번 오면 1062 로 이관 전체가 롤백된다.
                if (rec != null)
                {
                    var seen = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var x in rec.Elements("except"))
                    {
                        string d = A(x, "date");
                        if (DateOrNull(d) == null) continue;
                        if (!seen.Add(d)) { dedupExcept++; continue; }
                        await Ex(conn, tx, "INSERT INTO cal_entry_except (user_id,entry_no,except_date) VALUES (@u,@n,@d)",
                            ("@u", uid), ("@n", eno), ("@d", d));
                        nExcept++;
                    }
                }
                //  ★ 커밋 — 쓰기 계층(CalendarWriteDb)은 이 표를 건드리지 않는다(지연 로드라 지우면 안 되므로).
                //    그러므로 **이관 도구가 직접 넣어야 한다.** 안 넣으면 커밋이 통째로 사라진다.
                var cse = e.Element("commits");
                if (cse != null)
                {
                    uint seq = 0;
                    foreach (var cm in cse.Elements("commit"))
                    {
                        await Ex(conn, tx,
                            "INSERT INTO cal_entry_commit (user_id,entry_no,seq,hash,short_hash,commit_time,subject,body) " +
                            "VALUES (@u,@n,@s,@h,@sh,@t,@sj,@b)",
                            ("@u", uid), ("@n", eno), ("@s", seq++),
                            ("@h", A(cm, "hash")), ("@sh", A(cm, "short")),
                            ("@t", TimeOrNull(A(cm, "time"))),      // '' → NULL(A 부류 ① 무음 오염)
                            ("@sj", A(cm, "subject")), ("@b", T(cm)));
                        nCommit++;
                    }
                }
            }
            Console.WriteLine($"  일정 {eno}건 · 예외일 {nExcept} · 커밋 {nCommit}");

            // 4-3 할 일 + 날짜메모
            uint tno = 0; int nNote = 0;
            foreach (var t in tods)
            {
                string id = A(t, "id");
                string? cid = A(t, "categoryId"); if (cid.Length == 0) cid = null;
                object? cno = null;
                if (cid != null) { if (catNo.TryGetValue(cid, out var cv)) cno = cv; else orphanCat++; }
                await Ex(conn, tx,
                    "INSERT INTO cal_todo (user_id,todo_no,uid,cat_no,todo_text,note,due,end_date,done,prio,completed_at,sort_order,created_at,updated_at) " +
                    "VALUES (@u,@n,@id,@c,@tx,@nt,@du,@ed,@dn,@pr,@co,@so,@ca,@ua)",
                    ("@u", uid), ("@n", ++tno), ("@id", id), ("@c", cno),
                    ("@tx", T(t.Element("text"))), ("@nt", T(t.Element("note"))),
                    ("@du", DateOrNull(A(t, "due"))), ("@ed", DateOrNull(A(t, "endDate"))),
                    ("@dn", A(t, "done") == "true" ? 1 : 0),
                    ("@pr", A(t, "prio") == "high" ? "high" : "normal"),
                    ("@co", IsoToDb(A(t, "completedAt"))),          // '' → NULL(A 부류 ②)
                    ("@so", (int)tno - 1), ("@ca", IsoToDb(A(t, "createdAt")) ?? now), ("@ua", IsoToDb(A(t, "updatedAt")) ?? now));
                var dns = t.Element("dayNotes");
                if (dns != null)
                    foreach (var d in dns.Elements("dayNote"))
                    {
                        string dt = A(d, "date"); string txt = T(d).Trim();
                        if (DateOrNull(dt) == null || txt.Length == 0) continue;   // 빈 설명은 행을 두지 않는다(DDL)
                        await Ex(conn, tx, "INSERT INTO cal_todo_day_note (user_id,todo_no,note_date,note_text) VALUES (@u,@n,@d,@v)",
                            ("@u", uid), ("@n", tno), ("@d", dt), ("@v", txt));
                        nNote++;
                    }
            }
            Console.WriteLine($"  할 일 {tno}건 · 날짜메모 {nNote}");

            // 4-4 회의실
            for (int i = 0; i < rooms.Count; i++)
                await Ex(conn, tx, "INSERT INTO cal_room (user_id,name,sort_order) VALUES (@u,@n,@s)",
                    ("@u", uid), ("@n", rooms[i]), ("@s", i));
            Console.WriteLine($"  회의실 {rooms.Count}건");

            // 4-5 공수
            int nTh = 0;
            foreach (var d in thDays)
            {
                string date = A(d, "date"); if (DateOrNull(date) == null) continue;
                foreach (var t in d.Elements("t"))
                {
                    if (!catNo.TryGetValue(A(t, "cat"), out var cv)) { orphanCat++; continue; }
                    if (!double.TryParse(A(t, "h"), NumberStyles.Float, CultureInfo.InvariantCulture, out var h) || !(h > 0)) continue;
                    await Ex(conn, tx, "INSERT INTO cal_task_hours (user_id,work_date,cat_no,hours,updated_at) VALUES (@u,@d,@c,@h,@n)",
                        ("@u", uid), ("@d", date), ("@c", cv), ("@h", Math.Round((decimal)h, 2)), ("@n", now));
                    nTh++;
                }
            }
            Console.WriteLine($"  공수 {nTh}건");

            // 4-6 근태 — ★ 미기록 = 행 없음이 이관에서도 지켜져야 한다(§8).
            //     status 가 빈 값·무속성·유효 코드 밖이면 **행을 만들지 않는다.** '1' 로 채우지 않는다.
            int nAt = 0;
            foreach (var d in atDays)
            {
                string date = A(d, "date"), st = A(d, "status");
                if (DateOrNull(date) == null) { droppedDays++; continue; }
                if (!AttendOk.Contains(st)) { droppedDays++; continue; }
                int ot = IntOrNull(A(d, "overtime")) ?? 0;
                if (ot < 0 || ot > 11) ot = 0;              // overtime 은 반대다 — 범위 밖이면 0, 행은 버리지 않는다
                await Ex(conn, tx, "INSERT INTO cal_attendance (user_id,work_date,status,overtime,updated_at) VALUES (@u,@d,@s,@o,@n)",
                    ("@u", uid), ("@d", date), ("@s", st), ("@o", ot), ("@n", now));
                nAt++;
            }
            Console.WriteLine($"  근태 {nAt}건");

            // 4-7 설정 — 요소가 없어도 **행은 언제나 만든다**(근태와 반대). 파서 기본값을 넣는다.
            //     ★ 종류별 속성이 없으면 전역 3종으로 메운다. '-'/'2' 로 채우면 사용자가 보던 서식이 조용히 바뀐다.
            //       markerCustom 만 전역이 아니라 '' 로 가는 **비대칭**이다(DDL C 부류).
            string gMk = prefs != null && A(prefs, "reportMarker").Length > 0 ? A(prefs, "reportMarker") : "-";
            string gMkc = prefs != null ? A(prefs, "reportMarkerCustom") : "";
            int gInd = prefs != null ? Clamp(IntOrNull(A(prefs, "reportIndent")) ?? 2, 0, 6) : 2;
            string Mk(string k) { var v = prefs != null ? A(prefs, "reportMarker_" + k) : ""; return v.Length > 0 ? v : gMk; }
            string Mkc(string k) => prefs != null ? A(prefs, "reportMarkerCustom_" + k) : "";   // 비대칭: 전역으로 안 간다
            int Ind(string k) { var v = prefs != null ? IntOrNull(A(prefs, "reportIndent_" + k)) : null; return Clamp(v ?? gInd, 0, 6); }
            int fSize = prefs != null ? (IntOrNull(A(prefs, "fontSize")) ?? 0) : 0;
            if (fSize != 0 && (fSize < 10 || fSize > 16)) fSize = 0;
            await Ex(conn, tx,
                "INSERT INTO cal_user_pref (user_id,git_author,svn_author,report_marker,report_marker_custom,report_indent," +
                "git_commit_body,report_marker_daily,report_marker_custom_daily,report_indent_daily," +
                "report_marker_weekly,report_marker_custom_weekly,report_indent_weekly,report_font_family,report_font_size,updated_at) " +
                "VALUES (@u,@ga,@sa,@m,@mc,@i,@gcb,@dm,@dmc,@di,@wm,@wmc,@wi,@ff,@fs,@n)",
                ("@u", uid), ("@ga", A(root, "gitAuthor")), ("@sa", A(root, "svnAuthor")),
                ("@m", gMk), ("@mc", Trunc(gMkc, 8)), ("@i", gInd),
                ("@gcb", A(prefs ?? root, "gitCommitBody") == "1" ? 1 : 0),
                ("@dm", Mk("daily")), ("@dmc", Trunc(Mkc("daily"), 8)), ("@di", Ind("daily")),
                ("@wm", Mk("weekly")), ("@wmc", Trunc(Mkc("weekly"), 8)), ("@wi", Ind("weekly")),
                ("@ff", prefs != null ? A(prefs, "fontFamily") : ""), ("@fs", fSize), ("@n", now));
            Console.WriteLine("  설정 1건");

            // 4-8 rev 시딩 + 이관 로그 — **같은 트랜잭션**(§8)
            await Ex(conn, tx, "INSERT INTO cal_user_rev (user_id, rev) VALUES (@u,0) ON DUPLICATE KEY UPDATE rev=rev", ("@u", uid));
            await Ex(conn, tx, "INSERT INTO cal_migration_log (user_id, source_host, migrated_at) VALUES (@u,@h,@n)",
                ("@u", uid), ("@h", Environment.MachineName), ("@n", now));

            if (dry) { await tx.RollbackAsync(); Console.WriteLine("\n  [예행] 롤백했다 — DB 는 그대로다."); }
            else { await tx.CommitAsync(); Console.WriteLine("\n  커밋 완료"); }
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync();
            Die("이관 실패(전체 롤백): " + ex.Message);
        }

        // ── 5. 리포트 — 버린 것을 조용히 넘기지 않는다 ───────────────────────
        Console.WriteLine("\n[5] 이관이 버린 것");
        if (droppedHours > 0) Note($"일정별 hours {droppedHours}건 — 받을 컬럼이 없다(§5.3). 값은 XML 에 남아 있다.");
        if (droppedDays > 0)  Warn($"근태 {droppedDays}일 — status 가 유효 코드가 아니라 행을 만들지 않았다(미기록으로 남는다).");
        if (dedupExcept > 0)  Note($"중복 예외일 {dedupExcept}건 — 같은 날짜가 두 번 있어 하나만 넣었다.");
        if (orphanCat > 0)    Warn($"미존재 과제 참조 {orphanCat}건 — cat_no 를 NULL 로 두었다(화면에서 '미분류').");
        if (droppedHours + droppedDays + dedupExcept + orphanCat == 0) Console.WriteLine("  버린 것 없음");

        // ── 6. 저장소 경로 — DB 가 아니라 로컬 파일로 간다(§4) ───────────────
        Console.WriteLine("\n[6] 저장소 경로");
        if (repoPaths.Count == 0) Console.WriteLine("  경로를 쓰는 과제 없음");
        else
        {
            string dst = repoOut;
            string dir = Path.GetDirectoryName(dst) ?? ".";
            //  ★ 반드시 { version, paths } 로 감싼다 — 앱(RepoPaths.Load)이 최상위 "paths" 를 요구한다.
            //    맵을 최상위에 쓰면 앱이 손상 으로 보고 **빈 맵으로 시작**하고 원본을 .bak 로 밀어낸다.
            //    그러면 이관 직후부터 저장소 경로가 통째로 사라지고, uses_repo=true 인 과제는
            //    영원히 \"이 PC 에는 저장소 경로가 설정되지 않았습니다\" 를 띄운다(§4).
            //    2026-09-01 실측으로 겪었다 — 위젯 로그의 \"저장소 경로 맵 손상\" 이 그것이다.
            var wrapped = new Dictionary<string, object> { ["version"] = 1, ["paths"] = repoPaths };
            string json = JsonSerializer.Serialize(wrapped, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
            if (dry) Console.WriteLine($"  [예행] {repoPaths.Count}건을 쓸 예정: {dst}\n{Indent(json)}");
            else
            {
                Directory.CreateDirectory(dir);
                if (File.Exists(dst)) File.Copy(dst, dst + ".bak", true);   // 있으면 덮기 전에 보존
                string tmp = dst + ".tmp";
                File.WriteAllText(tmp, json, new UTF8Encoding(false));
                File.Move(tmp, dst, true);
                Console.WriteLine($"  {repoPaths.Count}건 저장: {dst}");
            }
            foreach (var kv in repoPaths) Console.WriteLine("    " + kv.Key);
        }

        // ── 7. 왕복 대조 — uid 를 키로, DB 가 발급한 번호는 넣지 않는다(§8) ──
        Console.WriteLine("\n[7] 왕복 대조");
        if (dry) Console.WriteLine("  [예행] 롤백했으므로 대조 대상이 없다. 실제 이관 뒤 다시 확인할 것.");
        else
        {
            var bad = await Verify(conn, uid, cats, ents, tods, rooms, thDays, atDays);
            if (bad.Count == 0) Console.WriteLine("  ✓ 건수·서명 일치");
            else { foreach (var b in bad) Console.WriteLine("  ✗ " + b); Warns.Add($"왕복 대조 불일치 {bad.Count}건"); }
        }

        Console.WriteLine("\n" + new string('=', 72));
        Console.WriteLine(Warns.Count == 0 ? (dry ? "예행 완료 ✓ — 중단 조건 없음." : "이관 완료 ✓") : $"경고 {Warns.Count}건 — 위를 확인할 것");
        Console.WriteLine(new string('=', 72));
        return Warns.Count == 0 ? 0 : 1;
    }

    static int Clamp(int v, int lo, int hi) => v < lo ? lo : v > hi ? hi : v;
    static string Trunc(string s, int n) => s.Length <= n ? s : s.Substring(0, n);
    static string Indent(string s) => string.Join("\n", s.Split('\n').Select(l => "      " + l));

    // 건수 대조 — 자식 표 포함. 값 서명은 앱 왕복(loop/dryrun)이 이미 덮으므로 여기서는
    //   '넣은 만큼 들어갔나' 를 본다(§8 의 건수 대조 항목).
    static async Task<List<string>> Verify(MySqlConnection c, int uid,
        List<XElement> cats, List<XElement> ents, List<XElement> tods, List<string> rooms,
        List<XElement> th, List<XElement> at)
    {
        var bad = new List<string>();
        async Task Cmp(string what, string sql, long want)
        {
            long got = Convert.ToInt64(await Sc(c, null, sql) ?? 0L);
            if (got != want) bad.Add($"{what}: XML {want} ≠ DB {got}");
        }
        await Cmp("과제", $"SELECT COUNT(*) FROM cal_category WHERE user_id={uid}", cats.Count);
        await Cmp("일정", $"SELECT COUNT(*) FROM cal_entry WHERE user_id={uid}", ents.Count);
        await Cmp("할 일", $"SELECT COUNT(*) FROM cal_todo WHERE user_id={uid}", tods.Count);
        await Cmp("회의실", $"SELECT COUNT(*) FROM cal_room WHERE user_id={uid}", rooms.Count);
        await Cmp("커밋", $"SELECT COUNT(*) FROM cal_entry_commit WHERE user_id={uid}",
            ents.Sum(e => e.Element("commits")?.Elements("commit").Count() ?? 0));
        await Cmp("날짜메모", $"SELECT COUNT(*) FROM cal_todo_day_note WHERE user_id={uid}",
            tods.Sum(t => t.Element("dayNotes")?.Elements("dayNote").Count(d => (d.Value ?? "").Trim().Length > 0) ?? 0));

        //  ★ uid 집합 대조 — 바이트 그대로 비교한다(uid 는 utf8mb4_bin). 번호는 넣지 않는다.
        foreach (var (tbl, want) in new[] {
            ("cal_category", cats.Select(x => x.Attribute("id")!.Value)),
            ("cal_entry",    ents.Select(x => x.Attribute("id")!.Value)),
            ("cal_todo",     tods.Select(x => x.Attribute("id")!.Value)) })
        {
            var got = new List<string>();
            await using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = $"SELECT uid FROM {tbl} WHERE user_id={uid} ORDER BY uid";
                await using var rd = await cmd.ExecuteReaderAsync();
                while (await rd.ReadAsync()) got.Add(rd.GetString(0));
            }
            var w = want.OrderBy(x => x, StringComparer.Ordinal).ToList();
            got.Sort(StringComparer.Ordinal);
            if (!w.SequenceEqual(got, StringComparer.Ordinal))
                bad.Add($"{tbl} uid 집합 불일치 — XML만:{string.Join(",", w.Except(got, StringComparer.Ordinal).Take(3))}" +
                        $" DB만:{string.Join(",", got.Except(w, StringComparer.Ordinal).Take(3))}");
        }
        return bad;
    }

    static async Task<int> Ex(MySqlConnection c, MySqlTransaction? tx, string sql, params (string, object?)[] ps)
    {
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sql; if (tx != null) cmd.Transaction = tx;
        foreach (var (k, v) in ps) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
        return await cmd.ExecuteNonQueryAsync();
    }
    static async Task<object?> Sc(MySqlConnection c, MySqlTransaction? tx, string sql, params (string, object?)[] ps)
    {
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sql; if (tx != null) cmd.Transaction = tx;
        foreach (var (k, v) in ps) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
        var v2 = await cmd.ExecuteScalarAsync();
        return v2 == DBNull.Value ? null : v2;
    }
}
