using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MySqlConnector;

namespace TaskCalendarWidget
{
    // 저장 결과. Ok=false 면 아무것도 쓰이지 않았다(트랜잭션 전체 롤백).
    internal sealed class CalendarSaveResult
    {
        public bool Ok { get; init; }
        public string? Message { get; init; }              // 실패 사유(사용자에게 그대로 보여줄 문장)
        public bool Conflict { get; init; }                // true = 낙관적 잠금 충돌(§3.3)
        public long Rev { get; init; }
        public IReadOnlyDictionary<string, string> Tokens { get; init; } = new Dictionary<string, string>();
        public IReadOnlyDictionary<string, uint> CategoryNoByUid { get; init; } = new Dictionary<string, uint>();
        public IReadOnlyDictionary<string, uint> EntryNoByUid { get; init; } = new Dictionary<string, uint>();
        public IReadOnlyDictionary<string, uint> TodoNoByUid { get; init; } = new Dictionary<string, uint>();
        public int Inserted { get; init; }
        public int Updated { get; init; }
        public int Deleted { get; init; }
    }

    // ================================================================================
    //  CalendarWriteDb — 캘린더 데이터 쓰기 (설계 §3.1~3.4)
    // ================================================================================
    //  【왜 '차이 계산(diff)' 인가 — 앱이 전량 저장이라서】
    //    앱의 save() 는 상태 전체를 한 번에 넘긴다(XML 시절의 파일 한 번 쓰기 모델).
    //    그런데 §3.3 의 낙관적 잠금은 **행 단위 토큰**이 전제다. 그래서 이 클래스가 둘을 잇는다:
    //      부팅 스냅샷(CalendarSnapshot) ↔ 새 state 를 비교해 행 단위 INSERT/UPDATE/DELETE 로 바꾼다.
    //    스냅샷이 Tokens 와 *NoByUid 를 들고 있는 이유가 정확히 이것이다(설계가 의도한 구조).
    //
    //  【트랜잭션 골격 — 순서를 바꾸면 조용히 깨진다】
    //    1. rev 증가가 **첫 문장**이다(§3.1). 앞에 SELECT 를 한 줄도 두지 않는다 —
    //       읽기가 먼저 오면 리드뷰가 굳어 발번의 MAX() 가 낡은 값을 본다(무관한 표여도 그렇다).
    //    2. 번호 발번(<표>_no)은 **락 안에서** 한다. 밖에서 고르면 같은 사람의 두 PC 가
    //       같은 번호를 골라 1062 로 갈린다.
    //    3. UPDATE/DELETE 는 전부 `AND updated_at=@prev`. 영향 행 0 = 충돌(§3.3).
    //    4. 자식 표를 건드리면 **같은 트랜잭션에서 부모 updated_at 을 올린다**(§3.4).
    //
    //  【이번 범위에서 쓰지 않는 것 — 의도된 제외】
    //    ★ cal_entry_commit(커밋)은 **건드리지 않는다.** 부팅 조회가 commits 를 []로 두고
    //      지연 로드하기 때문에(CalendarDb:504 "G-7: 항상 배열. 지연 조회로 채운다"),
    //      state 를 그대로 쓰면 **기존 커밋이 전부 삭제된다.** 읽지도 않은 것을 지우는 셈이다.
    //      그래서 이 클래스는 그 표에 어떤 문장도 보내지 않는다(검사가 이를 잠근다).
    //      커밋 저장은 '무엇이 로드됐는지'를 웹이 알려주는 계약이 생긴 뒤에 붙인다.
    // ================================================================================
    internal sealed class CalendarWriteDb
    {
        private readonly Action<string> _log;
        public CalendarWriteDb(Action<string> log) { _log = log ?? (_ => { }); }

        // 낙관적 잠금 충돌을 트랜잭션 밖으로 걷어 올리는 내부 신호.
        private sealed class ConflictException : Exception
        {
            public ConflictException(string m) : base(m) { }
        }

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
                // ★ §3.3 — '영향 행 0 = 충돌' 계약의 전제다. true 로 바뀌면 값이 그대로인 저장이
                //   전부 "다른 곳에서 먼저 수정되었습니다" 로 뜬다. 명시해 두면 그 사고가 안 난다.
                UseAffectedRows = false,
            }.ConnectionString;

        // ★ 읽기(REPEATABLE-READ)와 반대다. 합치지 말 것(§3.2) — 틀린 쪽은 Warning 138 하나만
        //   남기고 조용히 무시되는 형태로 나타난다.
        private const string WritePreambleSql =
            "SET SESSION innodb_lock_wait_timeout=5, " +
            "SESSION time_zone='+00:00', " +
            "SESSION transaction_isolation='READ-COMMITTED'";

        // ================================================================================
        //  공개 API — 상태 전체를 받아 차이만 쓴다
        // ================================================================================
        public async Task<CalendarSaveResult> SaveAsync(CalendarSnapshot prev, string newStateJson)
        {
            if (prev == null) return Fail("부팅 스냅샷이 없습니다 — 다시 시작한 뒤 저장하세요");
            if (string.IsNullOrWhiteSpace(newStateJson)) return Fail("저장할 내용이 비었습니다");

            //  이 저장 전체가 쓰는 단 하나의 시각. §3.3 의 포맷 계약(소수 정확히 3자리)을 지킨다 —
            //  모자라도 넘쳐도 다음 저장이 조용히 충돌 오탐이 된다.
            string now = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);

            using var doc = JsonDocument.Parse(newStateJson);
            var st = doc.RootElement;

            var tokens = new Dictionary<string, string>(prev.Tokens, StringComparer.Ordinal);
            var catNo = new Dictionary<string, uint>(prev.CategoryNoByUid, StringComparer.Ordinal);
            var entNo = new Dictionary<string, uint>(prev.EntryNoByUid, StringComparer.Ordinal);
            var todNo = new Dictionary<string, uint>(prev.TodoNoByUid, StringComparer.Ordinal);
            int ins = 0, upd = 0, del = 0;
            long newRev;

            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
                var ct = cts.Token;
                await using var conn = new MySqlConnection(BuildConnString());
                await conn.OpenAsync(ct);
                await Exec(conn, null, WritePreambleSql, ct);

                await using var tx = await conn.BeginTransactionAsync(ct);
                int u = prev.UserId;

                // ── 1. rev 증가 — 반드시 첫 문장(§3.1). 앞에 SELECT 를 두지 말 것 ──────────
                await Exec(conn, tx,
                    "INSERT INTO cal_user_rev(user_id, rev) VALUES(" + u + ", 1) " +
                    "ON DUPLICATE KEY UPDATE rev = rev + 1", ct);

                // 여기서부터는 읽어도 안전하다(락을 이미 잡았다).
                newRev = Convert.ToInt64(await Scalar(conn, tx, $"SELECT rev FROM cal_user_rev WHERE user_id={u}", ct) ?? 0L,
                                         CultureInfo.InvariantCulture);

                // ── 2. 발번 — 락 안에서(§3.1 ★) ────────────────────────────────────────
                uint nextCat  = (uint)(Convert.ToInt64(await Scalar(conn, tx, $"SELECT IFNULL(MAX(cat_no),0)   FROM cal_category WHERE user_id={u}", ct) ?? 0L, CultureInfo.InvariantCulture) + 1);
                uint nextEnt  = (uint)(Convert.ToInt64(await Scalar(conn, tx, $"SELECT IFNULL(MAX(entry_no),0) FROM cal_entry    WHERE user_id={u}", ct) ?? 0L, CultureInfo.InvariantCulture) + 1);
                uint nextTod  = (uint)(Convert.ToInt64(await Scalar(conn, tx, $"SELECT IFNULL(MAX(todo_no),0)  FROM cal_todo     WHERE user_id={u}", ct) ?? 0L, CultureInfo.InvariantCulture) + 1);

                // ── 3. 과제 — 부모부터. 새 과제가 있어야 일정이 참조할 수 있다 ─────────────
                var seenCat = new HashSet<string>(StringComparer.Ordinal);
                int i = 0;
                foreach (var c in Arr(st, "categories"))
                {
                    string uid = S(c, "id");
                    if (uid.Length == 0) continue;
                    seenCat.Add(uid);
                    bool isDb = string.Equals(S(c, "source"), "db", StringComparison.Ordinal);
                    var p = new List<(string, object?)>
                    {
                        ("@n",  S(c, "name")),
                        ("@col", S(c, "color")),
                        ("@d",  S(c, "desc")),
                        ("@ur", B(c, "usesRepo") ? 1 : 0),
                        ("@so", i),
                    };
                    uint no;
                    if (catNo.TryGetValue(uid, out no))
                    {
                        //  ★ project_uid 는 SET 목록에 없다 — uid 에서 파생되는 불변값이라
                        //    바뀔 일이 없고, state 에 대응 키도 없다(있지도 않은 값을 덮어쓰지 않는다).
                        await Upd(conn, tx, "cal_category",
                            "SET name=@n, color=@col, description=@d, uses_repo=@ur, sort_order=@so, updated_at=@now " +
                            $"WHERE user_id={u} AND cat_no={no}", tokens, "category:" + no, p, now, ct);
                        upd++;
                    }
                    else
                    {
                        uint nn = nextCat++;
                        p.Add(("@u2", uid));
                        p.Add(("@src", isDb ? "db" : "local"));
                        p.Add(("@pu", isDb && uid.Length > 3 ? uid.Substring(3) : (object?)null));
                        await Exec(conn, tx,
                            "INSERT INTO cal_category (user_id,cat_no,uid,source,name,color,description,project_uid,uses_repo,sort_order,created_at,updated_at) " +
                            $"VALUES ({u},{nn},@u2,@src,@n,@col,@d,@pu,@ur,@so,@now,@now)", ct, p, now);
                        catNo[uid] = nn;
                        no = nn;
                        ins++;
                    }
                    //  ★ if/else **밖에서** 갱신한다. UPDATE 분기에서 빠뜨리면 그 행의 토큰만 낡은 채로
                    //    남아, **두 번째 저장부터 그 표에서만 충돌**한다(2026-09-01 실측: 과제만 그랬다).
                    //    이 결함은 저장할 때마다 스냅샷을 새로 읽는 테스트로는 못 잡는다 —
                    //    한 스냅샷으로 연속 저장해야 드러난다(tests/loop-calendar-write.mjs 의 연속 저장 절).
                    tokens["category:" + no] = now;
                    i++;
                }

                // ── 4. 일정 + 자식(예외일) ────────────────────────────────────────────
                var seenEnt = new HashSet<string>(StringComparer.Ordinal);
                i = 0;
                foreach (var e in Arr(st, "entries"))
                {
                    string uid = S(e, "id");
                    if (uid.Length == 0) continue;
                    seenEnt.Add(uid);
                    string? cuid = NS(e, "categoryId");
                    object? cno = (cuid != null && catNo.TryGetValue(cuid, out uint cn)) ? cn : (object?)null;
                    var rec = Obj(e, "recur");
                    var p = new List<(string, object?)>
                    {
                        ("@c",  cno),
                        ("@dt", DateOrNull(S(e, "date"))),
                        ("@ed", DateOrNull(S(e, "endDate"))),
                        ("@ad", B(e, "allDay") ? 1 : 0),
                        ("@stt", TimeOrNull(S(e, "startTime"))),
                        ("@ett", TimeOrNull(S(e, "endTime"))),
                        ("@t",  S(e, "title")),
                        ("@m",  S(e, "memo")),
                        ("@src", S(e, "source")),
                        ("@loc", S(e, "location")),
                        ("@rm", IntOrNull(e, "remind")),
                        ("@rf", rec == null ? null : S(rec.Value, "freq")),
                        ("@ri", rec == null ? (object?)null : (IntOrNull(rec.Value, "interval") ?? 1)),
                        ("@ru", rec == null ? null : DateOrNull(S(rec.Value, "until"))),
                        ("@rc", rec == null ? (object?)null : (IntOrNull(rec.Value, "count") ?? 0)),
                        ("@so", i),
                    };
                    uint no;
                    if (entNo.TryGetValue(uid, out no))
                    {
                        await Upd(conn, tx, "cal_entry",
                            "SET cat_no=@c, entry_date=@dt, end_date=@ed, all_day=@ad, start_time=@stt, end_time=@ett, " +
                            "title=@t, memo=@m, source=@src, location=@loc, remind=@rm, " +
                            "recur_freq=@rf, recur_interval=@ri, recur_until=@ru, recur_count=@rc, " +
                            "sort_order=@so, updated_at=@now " +
                            $"WHERE user_id={u} AND entry_no={no}", tokens, "entry:" + no, p, now, ct);
                        upd++;
                    }
                    else
                    {
                        no = nextEnt++;
                        p.Add(("@u2", uid));
                        p.Add(("@ca", IsoToDb(S(e, "createdAt"), now)));
                        await Exec(conn, tx,
                            "INSERT INTO cal_entry (user_id,entry_no,uid,cat_no,entry_date,end_date,all_day,start_time,end_time," +
                            "title,memo,source,location,remind,recur_freq,recur_interval,recur_until,recur_count,sort_order,created_at,updated_at) " +
                            $"VALUES ({u},{no},@u2,@c,@dt,@ed,@ad,@stt,@ett,@t,@m,@src,@loc,@rm,@rf,@ri,@ru,@rc,@so,@ca,@now)", ct, p, now);
                        entNo[uid] = no;
                        ins++;
                    }
                    tokens["entry:" + no] = now;

                    //  자식: 예외일. 전량 교체다(§3.4 — 부모가 잠금 단위이고 부모 updated_at 은 위에서 올렸다).
                    //  ★ 커밋(cal_entry_commit)은 여기서 다루지 않는다 — 클래스 주석의 '의도된 제외'.
                    await Exec(conn, tx, $"DELETE FROM cal_entry_except WHERE user_id={u} AND entry_no={no}", ct);
                    foreach (var x in Arr(e, "recurExcept"))
                    {
                        string d = x.ValueKind == JsonValueKind.String ? (x.GetString() ?? "") : "";
                        if (DateOrNull(d) == null) continue;
                        await Exec(conn, tx,
                            $"INSERT IGNORE INTO cal_entry_except (user_id,entry_no,except_date) VALUES ({u},{no},@d)",
                            ct, new List<(string, object?)> { ("@d", d) }, now);
                    }
                    i++;
                }

                // ── 5. 할 일 + 자식(날짜별 메모) ──────────────────────────────────────
                var seenTod = new HashSet<string>(StringComparer.Ordinal);
                i = 0;
                foreach (var t in Arr(st, "todos"))
                {
                    string uid = S(t, "id");
                    if (uid.Length == 0) continue;
                    seenTod.Add(uid);
                    string? cuid = NS(t, "categoryId");
                    object? cno = (cuid != null && catNo.TryGetValue(cuid, out uint cn2)) ? cn2 : (object?)null;
                    var p = new List<(string, object?)>
                    {
                        ("@c",  cno),
                        ("@tx", S(t, "text")),
                        ("@nt", S(t, "note")),
                        ("@du", DateOrNull(S(t, "due"))),
                        ("@ed", DateOrNull(S(t, "endDate"))),
                        ("@dn", B(t, "done") ? 1 : 0),
                        ("@pr", S(t, "prio").Length > 0 ? S(t, "prio") : "normal"),
                        ("@ca2", IsoToDbOrNull(S(t, "completedAt"))),
                        ("@so", i),
                    };
                    uint no;
                    if (todNo.TryGetValue(uid, out no))
                    {
                        await Upd(conn, tx, "cal_todo",
                            "SET cat_no=@c, todo_text=@tx, note=@nt, due=@du, end_date=@ed, done=@dn, prio=@pr, " +
                            "completed_at=@ca2, sort_order=@so, updated_at=@now " +
                            $"WHERE user_id={u} AND todo_no={no}", tokens, "todo:" + no, p, now, ct);
                        upd++;
                    }
                    else
                    {
                        no = nextTod++;
                        p.Add(("@u2", uid));
                        p.Add(("@cr", IsoToDb(S(t, "createdAt"), now)));
                        await Exec(conn, tx,
                            "INSERT INTO cal_todo (user_id,todo_no,uid,cat_no,todo_text,note,due,end_date,done,prio,completed_at,sort_order,created_at,updated_at) " +
                            $"VALUES ({u},{no},@u2,@c,@tx,@nt,@du,@ed,@dn,@pr,@ca2,@so,@cr,@now)", ct, p, now);
                        todNo[uid] = no;
                        ins++;
                    }
                    tokens["todo:" + no] = now;

                    await Exec(conn, tx, $"DELETE FROM cal_todo_day_note WHERE user_id={u} AND todo_no={no}", ct);
                    var dn = Obj(t, "dayNotes");
                    if (dn != null)
                        foreach (var kv in dn.Value.EnumerateObject())
                        {
                            if (DateOrNull(kv.Name) == null) continue;
                            await Exec(conn, tx,
                                $"INSERT INTO cal_todo_day_note (user_id,todo_no,note_date,note_text) VALUES ({u},{no},@d,@v)",
                                ct, new List<(string, object?)> { ("@d", kv.Name), ("@v", kv.Value.ValueKind == JsonValueKind.String ? kv.Value.GetString() ?? "" : "") }, now);
                        }
                    i++;
                }

                // ── 6. 공수(날짜×과제) ────────────────────────────────────────────────
                var seenTh = new HashSet<string>(StringComparer.Ordinal);
                var th = Obj(st, "taskHours");
                if (th != null)
                    foreach (var day in th.Value.EnumerateObject())
                    {
                        if (DateOrNull(day.Name) == null || day.Value.ValueKind != JsonValueKind.Object) continue;
                        foreach (var kv in day.Value.EnumerateObject())
                        {
                            if (!catNo.TryGetValue(kv.Name, out uint cn3)) continue;   // 없는 과제의 공수는 버린다(FK)
                            double h = kv.Value.ValueKind == JsonValueKind.Number ? kv.Value.GetDouble() : 0;
                            if (!(h > 0)) continue;
                            string key = "task_hours:" + day.Name + ":" + cn3;
                            seenTh.Add(key);
                            var p = new List<(string, object?)> { ("@d", day.Name), ("@h", Math.Round(h, 2)) };
                            if (tokens.ContainsKey(key))
                            {
                                await Upd(conn, tx, "cal_task_hours", "SET hours=@h, updated_at=@now " +
                                    $"WHERE user_id={u} AND work_date=@d AND cat_no={cn3}", tokens, key, p, now, ct);
                                upd++;
                            }
                            else
                            {
                                await Exec(conn, tx, $"INSERT INTO cal_task_hours (user_id,work_date,cat_no,hours,updated_at) VALUES ({u},@d,{cn3},@h,@now)", ct, p, now);
                                ins++;
                            }
                            tokens[key] = now;
                        }
                    }
                del += await DeleteMissing(conn, tx, u, tokens, "task_hours:", seenTh, ct,
                    k => { var q = k.Split(':'); return ("cal_task_hours", $"work_date='{q[1]}' AND cat_no={q[2]}"); }, now);

                // ── 7. 근태 ───────────────────────────────────────────────────────────
                var seenAt = new HashSet<string>(StringComparer.Ordinal);
                var at = Obj(st, "attendance");
                if (at != null)
                    foreach (var day in at.Value.EnumerateObject())
                    {
                        if (DateOrNull(day.Name) == null || day.Value.ValueKind != JsonValueKind.Object) continue;
                        string status = S(day.Value, "status");
                        if (status.Length == 0) continue;     // '' = 미기록. 행을 만들지 않는다(DDL 계약)
                        string key = "attendance:" + day.Name;
                        seenAt.Add(key);
                        var p = new List<(string, object?)> { ("@d", day.Name), ("@s", status), ("@o", IntOrNull(day.Value, "overtime") ?? 0) };
                        if (tokens.ContainsKey(key))
                        {
                            await Upd(conn, tx, "cal_attendance", "SET status=@s, overtime=@o, updated_at=@now " +
                                $"WHERE user_id={u} AND work_date=@d", tokens, key, p, now, ct);
                            upd++;
                        }
                        else
                        {
                            await Exec(conn, tx, $"INSERT INTO cal_attendance (user_id,work_date,status,overtime,updated_at) VALUES ({u},@d,@s,@o,@now)", ct, p, now);
                            ins++;
                        }
                        tokens[key] = now;
                    }
                del += await DeleteMissing(conn, tx, u, tokens, "attendance:", seenAt, ct,
                    k => ("cal_attendance", $"work_date='{k.Split(':')[1]}'"), now);

                // ── 8. 회의실 — 토큰이 없는 단순 목록이라 전량 교체 ───────────────────
                await Exec(conn, tx, $"DELETE FROM cal_room WHERE user_id={u}", ct);
                i = 0;
                foreach (var r in Arr(st, "rooms"))
                {
                    string nm = r.ValueKind == JsonValueKind.String ? (r.GetString() ?? "").Trim() : "";
                    if (nm.Length == 0) continue;
                    await Exec(conn, tx, $"INSERT IGNORE INTO cal_room (user_id,name,sort_order) VALUES ({u},@n,{i})",
                        ct, new List<(string, object?)> { ("@n", nm) }, now);
                    i++;
                }

                // ── 9. 설정(사용자당 1행) ─────────────────────────────────────────────
                var rfp = Obj(st, "reportFormatPrefs");
                var dly = rfp == null ? (JsonElement?)null : Obj(rfp.Value, "daily");
                var wky = rfp == null ? (JsonElement?)null : Obj(rfp.Value, "weekly");
                var fnt = Obj(st, "reportFont");
                //  ★ 마커는 **빈 문자열이면 안 된다**(chk_cal_user_pref_marker). state 에 서식이
                //    통째로 없을 수 있으므로(구버전·초기 상태) 빈 값을 그대로 흘리면 저장이 통째로
                //    거부된다 — 설정 하나 때문에 일정·할 일까지 못 쓰게 된다. 그래서 여기서 메운다.
                //    메우는 값은 상위 reportMarker → 없으면 '-'(앱의 기본값과 같은 값)다.
                string topMarker = S(st, "reportMarker"); if (topMarker.Length == 0) topMarker = "-";
                string dMarker = dly == null ? "" : S(dly.Value, "marker"); if (dMarker.Length == 0) dMarker = topMarker;
                string wMarker = wky == null ? "" : S(wky.Value, "marker"); if (wMarker.Length == 0) wMarker = topMarker;
                var pp = new List<(string, object?)>
                {
                    ("@ga", S(st, "gitAuthor")), ("@sa", S(st, "svnAuthor")),
                    ("@rm", topMarker), ("@rmc", S(st, "reportMarkerCustom")),
                    ("@ri", IntOrNull(st, "reportIndent") ?? 2),
                    ("@gcb", B(st, "gitCommitBody") ? 1 : 0),
                    ("@dm", dMarker), ("@dmc", dly == null ? "" : S(dly.Value, "markerCustom")),
                    ("@di", dly == null ? 2 : (IntOrNull(dly.Value, "indent") ?? 2)),
                    ("@wm", wMarker), ("@wmc", wky == null ? "" : S(wky.Value, "markerCustom")),
                    ("@wi", wky == null ? 2 : (IntOrNull(wky.Value, "indent") ?? 2)),
                    ("@ff", fnt == null ? "" : S(fnt.Value, "family")),
                    ("@fs", fnt == null ? (object?)null : IntOrNull(fnt.Value, "size")),
                };
                await Exec(conn, tx,
                    "INSERT INTO cal_user_pref (user_id,git_author,svn_author,report_marker,report_marker_custom,report_indent," +
                    "git_commit_body,report_marker_daily,report_marker_custom_daily,report_indent_daily," +
                    "report_marker_weekly,report_marker_custom_weekly,report_indent_weekly,report_font_family,report_font_size,updated_at) " +
                    $"VALUES ({u},@ga,@sa,@rm,@rmc,@ri,@gcb,@dm,@dmc,@di,@wm,@wmc,@wi,@ff,@fs,@now) " +
                    "ON DUPLICATE KEY UPDATE git_author=VALUES(git_author), svn_author=VALUES(svn_author), " +
                    "report_marker=VALUES(report_marker), report_marker_custom=VALUES(report_marker_custom), " +
                    "report_indent=VALUES(report_indent), git_commit_body=VALUES(git_commit_body), " +
                    "report_marker_daily=VALUES(report_marker_daily), report_marker_custom_daily=VALUES(report_marker_custom_daily), " +
                    "report_indent_daily=VALUES(report_indent_daily), report_marker_weekly=VALUES(report_marker_weekly), " +
                    "report_marker_custom_weekly=VALUES(report_marker_custom_weekly), report_indent_weekly=VALUES(report_indent_weekly), " +
                    "report_font_family=VALUES(report_font_family), report_font_size=VALUES(report_font_size), updated_at=VALUES(updated_at)", ct, pp, now);
                tokens["user_pref"] = now;

                // ── 10. 삭제 — 자식→부모 순. 일정/할 일 먼저, 과제는 마지막(FK) ────────
                foreach (var kv in new List<KeyValuePair<string, uint>>(entNo))
                    if (!seenEnt.Contains(kv.Key))
                    {
                        await DelTok(conn, tx, "cal_entry", $"WHERE user_id={u} AND entry_no={kv.Value}", tokens, "entry:" + kv.Value, now, ct);
                        entNo.Remove(kv.Key); tokens.Remove("entry:" + kv.Value); del++;
                    }
                foreach (var kv in new List<KeyValuePair<string, uint>>(todNo))
                    if (!seenTod.Contains(kv.Key))
                    {
                        await DelTok(conn, tx, "cal_todo", $"WHERE user_id={u} AND todo_no={kv.Value}", tokens, "todo:" + kv.Value, now, ct);
                        todNo.Remove(kv.Key); tokens.Remove("todo:" + kv.Value); del++;
                    }
                foreach (var kv in new List<KeyValuePair<string, uint>>(catNo))
                    if (!seenCat.Contains(kv.Key))
                    {
                        await DelTok(conn, tx, "cal_category", $"WHERE user_id={u} AND cat_no={kv.Value}", tokens, "category:" + kv.Value, now, ct);
                        catNo.Remove(kv.Key); tokens.Remove("category:" + kv.Value); del++;
                    }

                await tx.CommitAsync(ct);
                _log($"캘린더 저장: user_id={u} rev={newRev} · 추가 {ins} · 수정 {upd} · 삭제 {del}");
            }
            catch (ConflictException ex)
            {
                _log("캘린더 저장 충돌: " + ex.Message);
                return new CalendarSaveResult { Ok = false, Conflict = true, Message = ex.Message };
            }
            catch (Exception ex)
            {
                _log("캘린더 저장 실패: " + ex);
                return Fail("저장하지 못했습니다: " + ex.Message);
            }

            return new CalendarSaveResult
            {
                Ok = true, Rev = newRev, Tokens = tokens,
                CategoryNoByUid = catNo, EntryNoByUid = entNo, TodoNoByUid = todNo,
                Inserted = ins, Updated = upd, Deleted = del,
            };
        }

        // ── 쓰기 헬퍼 ────────────────────────────────────────────────────────────
        private static CalendarSaveResult Fail(string m) => new CalendarSaveResult { Ok = false, Message = m };

        //  토큰을 건 UPDATE. 영향 행 0 이면 충돌이다(§3.3).
        private async Task Upd(MySqlConnection conn, MySqlTransaction tx, string table, string setWhere,
            Dictionary<string, string> tokens, string tokKey, List<(string, object?)> ps, string now, CancellationToken ct)
        {
            if (!tokens.TryGetValue(tokKey, out var prevTok))
                throw new ConflictException("이 항목의 버전을 알 수 없습니다 — 새로고침 후 다시 시도하세요");
            var all = new List<(string, object?)>(ps) { ("@prev", prevTok) };
            int n = await Exec(conn, tx, $"UPDATE {table} {setWhere} AND updated_at=@prev", ct, all, now);
            if (n == 0) throw new ConflictException("다른 곳에서 먼저 수정되었습니다 — 새로고침 후 다시 시도하세요");
        }

        //  토큰을 건 DELETE. 삭제에도 같은 조건을 건다(§3.3 — 세션 수명 = 스테일 윈도우).
        private async Task DelTok(MySqlConnection conn, MySqlTransaction tx, string table, string where,
            Dictionary<string, string> tokens, string tokKey, string now, CancellationToken ct)
        {
            if (!tokens.TryGetValue(tokKey, out var prevTok)) return;   // 이미 우리가 지운 것 — 조용히 통과
            int n = await Exec(conn, tx, $"DELETE FROM {table} {where} AND updated_at=@prev", ct,
                new List<(string, object?)> { ("@prev", prevTok) }, now);
            if (n == 0) throw new ConflictException("다른 곳에서 먼저 수정되었습니다 — 새로고침 후 다시 시도하세요");
        }

        //  새 state 에 없어진 (토큰 접두어) 행들을 지운다.
        private async Task<int> DeleteMissing(MySqlConnection conn, MySqlTransaction tx, int u,
            Dictionary<string, string> tokens, string prefix, HashSet<string> seen, CancellationToken ct,
            Func<string, (string table, string where)> map, string now)
        {
            int n = 0;
            foreach (var k in new List<string>(tokens.Keys))
            {
                if (!k.StartsWith(prefix, StringComparison.Ordinal) || seen.Contains(k)) continue;
                var (table, where) = map(k);
                await DelTok(conn, tx, table, $"WHERE user_id={u} AND {where}", tokens, k, now, ct);
                tokens.Remove(k); n++;
            }
            return n;
        }

        private static async Task<int> Exec(MySqlConnection conn, MySqlTransaction? tx, string sql, CancellationToken ct,
            List<(string, object?)>? ps = null, string? now = null)
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            if (tx != null) cmd.Transaction = tx;
            if (now != null && sql.Contains("@now", StringComparison.Ordinal)) cmd.Parameters.AddWithValue("@now", now);
            if (ps != null) foreach (var (k, v) in ps) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
            return await cmd.ExecuteNonQueryAsync(ct);
        }

        private static async Task<object?> Scalar(MySqlConnection conn, MySqlTransaction? tx, string sql, CancellationToken ct)
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            if (tx != null) cmd.Transaction = tx;
            var v = await cmd.ExecuteScalarAsync(ct);
            return v == DBNull.Value ? null : v;
        }

        // ── JSON 접근자 ──────────────────────────────────────────────────────────
        private static IEnumerable<JsonElement> Arr(JsonElement o, string k) =>
            o.TryGetProperty(k, out var a) && a.ValueKind == JsonValueKind.Array ? a.EnumerateArray() : System.Linq.Enumerable.Empty<JsonElement>();
        private static JsonElement? Obj(JsonElement o, string k) =>
            o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Object ? v : (JsonElement?)null;
        private static string S(JsonElement o, string k) =>
            o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";
        private static string? NS(JsonElement o, string k) =>
            o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        private static bool B(JsonElement o, string k) =>
            o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;
        private static int? IntOrNull(JsonElement o, string k) =>
            o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : (int?)null;

        // ── 값 변환 ──────────────────────────────────────────────────────────────
        private static object? DateOrNull(string s) =>
            System.Text.RegularExpressions.Regex.IsMatch(s ?? "", @"^\d{4}-\d{2}-\d{2}$") ? s : null;
        private static object? TimeOrNull(string s) =>
            System.Text.RegularExpressions.Regex.IsMatch(s ?? "", @"^\d{2}:\d{2}$") ? s : null;

        //  ISO(앱) → DATETIME(3) 문자열. 못 읽으면 fallback.
        private static string IsoToDb(string iso, string fallback) =>
            DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var d)
                ? d.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture) : fallback;
        private static object? IsoToDbOrNull(string iso) =>
            string.IsNullOrWhiteSpace(iso) ? null
            : (DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var d)
                ? d.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture) : (object?)null);
    }
}
