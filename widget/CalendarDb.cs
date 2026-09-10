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
    // login_id 로 app_user 를 찾지 못했다 — '오프라인'과 반드시 구분해야 하는 실패다(설계 §3.6).
    //   ProjectDb 의 NotAuthorizedException 이 존재하는 이유와 같다: 읽기 실패를 전부 null 로 뭉개면
    //   "서버에 연결할 수 없습니다"가 떠서 사용자가 원인을 오해하고, 관리자도 엉뚱한 곳을 본다.
    //   ★ 이 예외를 삼키고 user_id 를 만들어 내지 말 것(§3.6) — 없는 사람의 캘린더를 새로 파는 셈이고,
    //     그 행을 나중에 누가 쓸지도 정해지지 않는다.
    internal sealed class CalendarUserNotFoundException : Exception
    {
        public CalendarUserNotFoundException(string message) : base(message) { }
    }

    // 부팅 조회 1회의 산출물 전부. ★ 어댑터는 이 중 무엇도 필드로 들고 있지 않는다 —
    //   호출자가 소유한다(설계 §3.8.3 「보관은 클라이언트, 판정은 서버」).
    //   그래서 CalendarDb 는 무상태이고, 두 번 호출하면 서로 무관한 두 스냅샷이 나온다.
    internal sealed class CalendarSnapshot
    {
        // (a) 계약 G 모양의 state — 웹에 그대로 넘긴다. fromXML() 의 return 과 키 15개가 정확히 같다.
        public string StateJson { get; }

        // (b) 낙관적 잠금 토큰 맵. 키 '표:<식별자>' → DB 가 준 updated_at **원문 문자열**(계약 G-6).
        //     ★ ISO 변환을 거친 값이 아니다. state 의 updatedAt 을 @prev 로 쓰면 JS 가 편집마다
        //       nowIso() 로 덮어써서 첫 편집이 전부 충돌 오탐이 된다(§3.3).
        public IReadOnlyDictionary<string, string> Tokens { get; }

        // (c) cal_user_rev.rev — 지금은 보관만 한다(폴링은 §3.7.3 의 '나중'). 스냅샷과 짝이다.
        public long Rev { get; }

        // 프리앰블에서 읽은 스키마 버전(§3.6). 값을 나르기만 한다 —
        //   '낡은 클라이언트의 파괴적 연산 차단' 판정은 쓰기 경로의 몫이다(§5.5).
        //   ★ 그 판정 지점은 **CalendarWriteDb.SaveAsync 의 replaceAll 분기 하나뿐**이고,
        //     비교 상대는 CalendarDb.ExpectedSchemaVersion 이다. 여기서 판정하지 않는 이유는
        //     읽기를 막을 이유가 없어서다 — 낡은 위젯도 조회·편집은 계속되어야 한다(§5.5).
        public string SchemaVersion { get; }

        // 이 스냅샷의 소유자. 쓰기 경로가 WHERE user_id 로 쓸 값이다.
        public int UserId { get; }

        // 계약 H-2 — state 에는 uid 만 들어가는데 UPDATE/DELETE 와 자식 조회의 조건절은 번호다.
        //   부팅 조회 때 함께 만들어 세션이 끝날 때까지 유지한다(유지 주체는 호출자).
        //   ★ INSERT 직후 넣고 DELETE 직후 뺄 것 — 번호는 재사용되므로 남은 항목은 나중에
        //     '다른 행'을 가리키게 되고 그 오염은 조용하다(H-1 ★).
        public IReadOnlyDictionary<string, uint> CategoryNoByUid { get; }
        public IReadOnlyDictionary<string, uint> EntryNoByUid { get; }
        public IReadOnlyDictionary<string, uint> TodoNoByUid { get; }

        public CalendarSnapshot(string stateJson, IReadOnlyDictionary<string, string> tokens, long rev,
                                string schemaVersion, int userId,
                                IReadOnlyDictionary<string, uint> categoryNoByUid,
                                IReadOnlyDictionary<string, uint> entryNoByUid,
                                IReadOnlyDictionary<string, uint> todoNoByUid)
        {
            StateJson = stateJson;
            Tokens = tokens;
            Rev = rev;
            SchemaVersion = schemaVersion;
            UserId = userId;
            CategoryNoByUid = categoryNoByUid;
            EntryNoByUid = entryNoByUid;
            TodoNoByUid = todoNoByUid;
        }
    }

    // ================================================================================
    //  캘린더(cal_*) DB 어댑터 — **읽기 계층만**.
    //
    //  하는 일은 하나다: DB 행 → 계약 G 의 객체(= fromXML() 이 돌려주던 것과 똑같은 모양).
    //  설계 §3.8.5 가 이 클래스에 건 제약을 그대로 옮긴다:
    //    · 변환만 한다. 그 이상을 하지 않는다.
    //    · 비즈니스 규칙을 베끼지 않는다 — 근태 유효 코드는 DB CHECK 가 판정하고, 여기는
    //      오류를 그대로 올린다. C# 에 목록을 세 번째로 두지 않는다.
    //    · 조직 트리 순회를 새로 만들지 않는다(이미 C#/JS 두 벌이다).
    //
    //  ★ 파서 기본값을 다시 적용하지 않는 이유: 이관 도구가 이미 넣어 둔다(계약 C).
    //    '(제목 없음)'·'(이름 없음)'·recur interval=1/count=0 은 **DB 에 저장된 값**이지
    //    읽으면서 만들어 낼 값이 아니다. 여기서 또 흡수하면 '무엇이 진짜 저장된 값인지'를
    //    영원히 알 수 없게 된다.
    //
    //  ★ 이 주석은 2026-08 에 "아직 없는 것: 쓰기 · XML→DB 이관 · MainWindow 브리지 배선 · 폴링.
    //    그래서 지금은 아무도 이 클래스를 부르지 않는다(컴파일만 된다)" 였다. **셋은 생겼다** —
    //    쓰기(CalendarWriteDb) · 이관(db/deploy/xml-to-db) · 브리지(MainWindow.BootFromDbAsync).
    //    남은 것은 **폴링**뿐이다(§3.7.3 의 '나중' — rev 를 주기적으로 보고 남의 편집을 당겨오는 것).
    //    ★ 낡은 주석을 그대로 두면 다음 사람이 "안 불리는 클래스" 로 알고 마음대로 고친다.
    // ================================================================================
    internal sealed class CalendarDb
    {
        // ── 이 위젯이 아는 스키마 판본(§5.5 「스키마 진화 규칙」) ──────────────────────
        //   부팅 프리앰블이 읽은 서버 값(cal_schema_meta.schema_version)과 **접속 시 1회** 비교하고,
        //   다르면 **파괴적 연산만** 막는다(전량 교체 = 가져오기·전체 초기화). 통상 저장·조회는
        //   그대로 둔다 — 전 쓰기 봉인은 과하고, 낡은 위젯이라고 하루를 못 쓰게 만들 이유가 없다.
        //   ★ `migrate-*.sql` 로 정본(db/deploy/schema-calendar.sql)의 값을 올릴 때 **이 상수도
        //     같이 올린다.** 잊으면 tests/schema-guards.test.mjs 가드 ⑨ 가 빨간불을 낸다.
        //   ★ 서버 값을 앱이 올려서 통과할 수는 없다 — 앱 계정의 cal_schema_meta 권한은 SELECT
        //     하나뿐이다(db/deploy/grants-calendar.sql). 막으려는 대상이 자기 통과증을 발급하면
        //     이 게이트는 무의미해진다(§5.5 ★).
        //   ★ 2026-09-09: 8 → 9(migrate-2026-09-09-integrity.sql — 무결성 규칙 통일 + 감사 시각 정규화).
        //   ★ 2026-09-10: 9 → 10(migrate-2026-09-10-dev-end-date.sql — project.dev_end_date 개발종료일 신설).
        //     이번 판은 짝이 특히 중요하다 — ProjectDb.LoadProjectsJsonAsync 가 **그 새 컬럼을 SELECT 한다.**
        //     v9 DB 에 이 위젯이 붙으면 그 질의가 1054 로 죽어 과제 목록이 통째로 빈다(DB 를 먼저 올릴 것).
        //   ★ 2026-09-10: 10 → 11(migrate-2026-09-10-user-sort-order.sql — app_user.sort_order 명부 서열 신설).
        //     같은 날 두 번째 판이다. 이번에도 짝이 중요하다 — ProjectDb.LoadMembersJsonAsync 가 그 컬럼을
        //     SELECT·ORDER BY 하고 직원 관리 쓰기가 그 컬럼에 UPDATE 를 건다(DB 를 먼저 올릴 것).
        //   ★ 2026-09-10: 11 → 12(migrate-2026-09-10-user-sort-order-int.sql — sort_order SMALLINT→INT UNSIGNED).
        internal const string ExpectedSchemaVersion = "12";

        private readonly Action<string> _log;

        // ★ ProjectDb 와 달리 _dataDir 이 없다. 그 필드는 오직 쓰기 권한 관문(UserSession.Load)을
        //   위한 것이고, 이 계층에는 쓰기가 없기 때문이다. 쓰기가 붙을 때 같은 이유로 생길 것이다.
        public CalendarDb(Action<string> log)
        {
            _log = log ?? (_ => { });
        }

        // 접속 문자열 — 값은 전부 DeployConfig 베이크 상수(ProjectDb 와 같다. 런타임 오버라이드 없음).
        // ★ ProjectDb.BuildConnString 을 공유하지 않는 이유: 여기엔 UseAffectedRows 가 더 붙는다.
        //   지금 쓰지 않는 값을 왜 지금 박아 두나 — 설계 §3.3 이 실측으로 못박은 것이라서다.
        //   낙관적 잠금의 '영향 행 0 = 충돌' 계약은 드라이버 기본값(False)에 얹혀서 참이고,
        //   누가 true 로 바꾸거나 드라이버를 갈면 **값이 그대로인 저장이 전부 "다른 곳에서 먼저
        //   수정되었습니다"로 뜬다.** 명시해 두면 그 사고가 애초에 안 난다.
        private static string BuildConnString() =>
            new MySqlConnectionStringBuilder
            {
                Server = DeployConfig.DbHost,
                Port = (uint)DeployConfig.DbPort,
                Database = DeployConfig.DbName,
                UserID = DeployConfig.DbUser,
                Password = DeployConfig.DbPassword,
                ConnectionTimeout = 4,        // 접속 대기(초) — 오프라인 빠른 실패
                DefaultCommandTimeout = 8,    // §3.5 '창을 짧게' — 열린 read view 가 undo purge 를 붙잡는다
                Pooling = false,              // 위젯 단발성 조회 — 풀 미유지(정지된 서버로 소켓 재사용 방지)
                UseAffectedRows = false,      // §3.3 — 낙관적 잠금 '영향 행 0 = 충돌' 계약의 전제
            }.ConnectionString;

        // ── 접속 프리앰블(읽기 전용) — 설계 §3.6 ───────────────────────────────
        //   ★ 쓰기 프리앰블과 **한 함수로 합치지 말 것**(§3.2 의 ★ 절). 격리수준이 반대다:
        //     읽기 REPEATABLE-READ / 쓰기 READ-COMMITTED. 합치는 순간 둘 중 하나가 반드시 틀리고,
        //     틀린 쪽은 START TRANSACTION WITH CONSISTENT SNAPSHOT 이 Warning 138 하나만 남기고
        //     **조용히 무시**되는 형태로 나타난다(실측). 로그를 안 보면 영영 모른다.
        private const string ReadPreambleSql =
            "SET SESSION innodb_lock_wait_timeout=5, " +      // DefaultCommandTimeout(8s)보다 짧게 — DB 가 진단 가능한 1205 를 먼저 내게
            "SESSION time_zone='+00:00', " +                  // 시각 컬럼 규약: 서버 함수가 한 줄 섞여도 값이 9시간 어긋나지 않게
            "SESSION transaction_isolation='REPEATABLE-READ'"; // §3.5 — 이게 없으면 아래 스냅샷이 무시된다

        // ================================================================================
        //  공개 API 1 — login_id → user_id 해석 (연결당 1회, §3.6)
        // ================================================================================
        //   netcus 로그인이 주는 것은 login_id 이고 cal_* 가 저장하는 것은 user_id 다.
        //   · user_id 는 우리가 발급하는 불변값이라 **스냅샷 밖에서 읽어도 찢어지지 않는다** —
        //     그래서 §3.5 의 9표 트랜잭션 안에 넣지 않는다.
        //   · 0행이면 app_user 에 없는 사람이다. 그 자리에서 멈춘다(예외).
        //   ※ view_scope·edit_role 은 여기서 읽지 않는다. 그 둘은 쓰기 권한 판정의 재료이고
        //     판정 지점은 ProjectDb.OpenWriteAsync 한 곳뿐이다(USER-LOGIN §3.3). 읽기 계층이
        //     같은 값을 또 읽어 들고 있으면 '어느 쪽이 최신인가'가 생긴다.
        //
        //   반환: user_id / 연결·질의 실패는 예외 그대로 전파(호출측이 자기 문맥의 메시지로 환원)
        public async Task<int> ResolveUserIdAsync(string? loginId)
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
            await using var conn = await OpenReadAsync(cts.Token);
            await ExecAsync(conn, ReadPreambleSql, cts.Token);   // 프리앰블은 연 연결마다 — 예외를 두면 그 자리가 규약 밖이 된다
            return await ResolveUserIdAsync(conn, loginId, cts.Token);
        }

        // ================================================================================
        //  공개 API 2 — 부팅 조회 (설계 §3.5)
        // ================================================================================
        //   10개 표를 **한 연결·한 트랜잭션**에서 읽어 계약 G 의 state 를 만든다.
        //     cal_category · cal_entry · cal_entry_except · cal_entry_commit · cal_todo ·
        //     cal_todo_day_note · cal_room · cal_task_hours · cal_attendance · cal_user_pref
        //
        //   ★★ 계약 G-7 개정(2026-09-01) — 커밋을 **부팅에서 전량 읽는다.**
        //     원안은 지연 조회였다: "무게의 대부분인데 캘린더를 그리는 데 안 쓴다". 전제가 틀렸다.
        //       · 앱은 커밋을 **전역으로 훑는다** — 검색(:7434)·통계(:8630)·보고서(:7664/:7740).
        //         일정 하나씩 늦게 읽어서는 이것들이 전부 틀린다. 실제로 틀리고 있었다.
        //       · 무게가 없다 — 실측 커밋 164건이 42,286자(≈42KB)다. 부팅 state 가 19,534B 였으니
        //         합쳐도 62KB 남짓이고 쿼리는 한 개 는다.
        //       · 지연 조회는 **배선된 적이 없었다.** LoadEntryCommitsJsonAsync 가 있었지만 호스트
        //         브리지에도 웹에도 호출부가 0 이었다 — 그래서 DB 모드에서는 커밋이 영영 빈 배열이고,
        //         커밋 기반 일간·주간 보고가 통째로 비었다. 이 앱의 주 용도가 그것이다.
        //       · 쓰기 쪽 부작용도 이것이 원인이었다 — 부팅이 [] 로 두니 차분 저장이 "164→0" 으로
        //         오판해서, CalendarWriteDb 가 cal_entry_commit 을 통째로 제외해야 했다.
        //         부팅이 제대로 읽으면 그 제외 사유가 사라진다.
        //     entry.commits 는 **항상 배열**이다(undefined 로 두면 커밋 편집 경로가 TypeError 로 죽는다).
        //
        //   repoPaths: 과제 uid → (gitRepo, svnRepo). 계약 G-6 — 이 값은 **DB 에 없다**(§4: PC 마다
        //     달라야 하는 유일한 항목). 로컬 저장소를 읽는 것은 이 클래스의 일이 아니라 호출자의
        //     일이다 — 어댑터는 변환만 한다(§3.8.5).
        //     ★ 그 '로컬 저장소'의 실체는 **`%APPDATA%\TaskCalendar\repo-paths.json`** 이고,
        //       그 파일을 다루는 코드는 **`widget/RepoPaths.cs`** 다(형식·소유자·손상 처리는 그 파일의
        //       머리 주석). 이 인자에 넘길 값은 `RepoPaths.Map` 이 그대로 만들어 준다:
        //
        //           _repoPaths = RepoPaths.Load(_dataDir, Log);                 // 부팅 때 1회
        //           var snap   = await _calDb.LoadSnapshotAsync(loginId, _repoPaths.Map);
        //
        //       `.Map` 은 이 인자와 **정확히 같은 형**이라 변환이 필요 없다. 편의 오버로드를
        //       만들지 않은 이유는 이 메서드 바로 아래 ★★ 절에 있다(게이트가 눈을 감는다).
        //
        //     ★ repoPaths 를 **안 주면**(생략 또는 null) 모든 과제의 gitRepo·svnRepo 가 '' 가 된다.
        //       그러면 기록 모달의 「연동」 섹션이 통째로 사라져(`updateGitRow()` 의
        //       `sect.classList.toggle('hidden', !show)`) 사용자는 '커밋이 없는 것'과 구분하지
        //       못한다(G-6 의 경고). **배선(1c)할 때 반드시 채울 것.**
        //
        //   반환: 스냅샷 / 연결·질의 실패는 null(오프라인 — 캐시 폴백 없음, ADR-18)
        //   예외: CalendarUserNotFoundException — login_id 가 app_user 에 없다(오프라인과 다른 사실)
        public async Task<CalendarSnapshot?> LoadSnapshotAsync(
            string? loginId,
            IReadOnlyDictionary<string, (string git, string svn)>? repoPaths = null)
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                var ct = cts.Token;
                await using var conn = await OpenReadAsync(ct);

                // ── 프리앰블(연결당 1회) ───────────────────────────────────────────
                await ExecAsync(conn, ReadPreambleSql, ct);
                string schemaVersion = await ReadSchemaVersionAsync(conn, ct);
                int userId = await ResolveUserIdAsync(conn, loginId, ct);

                // ── 스냅샷 트랜잭션 ────────────────────────────────────────────────
                //   같은 사람의 다른 PC 가 부팅 창(LAN 0.1~0.3초) 안에 커밋하면 데이터가 찢어진다.
                //   autocommit 으로는 연결을 합쳐도 문마다 새 read view 라 해결되지 않는다.
                //   ★ MySqlConnection.BeginTransaction() 을 쓰지 않는다 — 그건 평범한
                //     START TRANSACTION 을 보내고 WITH CONSISTENT SNAPSHOT 을 붙일 방법이 없다.
                //     그래서 문장을 직접 친다. 대신 모든 경로에서 COMMIT/ROLLBACK 을 보장한다
                //     (§3.5 주의: 열린 read view 는 undo purge 를 붙잡는다).
                await ExecAsync(conn, "START TRANSACTION WITH CONSISTENT SNAPSHOT", ct);
                CalendarSnapshot snap;
                try
                {
                    snap = await ReadInsideSnapshotAsync(conn, userId, schemaVersion, repoPaths, ct);
                    await ExecAsync(conn, "COMMIT", ct);
                }
                catch
                {
                    // 실패해도 read view 를 붙잡은 채 연결을 놓지 않는다. Pooling=false 라 Dispose 로도
                    // 끊기지만, 끊김이 서버에 도달하는 시점을 기다릴 이유가 없다.
                    try { await ExecAsync(conn, "ROLLBACK", CancellationToken.None); } catch { /* 이미 끊긴 연결 — 원인 예외를 덮지 않는다 */ }
                    throw;
                }

                _log("캘린더 부팅 조회: user_id=" + snap.UserId + " rev=" + snap.Rev +
                     " 토큰 " + snap.Tokens.Count + "건 · state " + snap.StateJson.Length + "B");
                return snap;
            }
            catch (CalendarUserNotFoundException)
            {
                throw;   // ★ '미등록'을 '오프라인'으로 뭉개지 않는다 — Exception 보다 앞에서 다시 던진다
            }
            catch (Exception ex)
            {
                _log("캘린더 부팅 조회 실패(데이터 없음): " + Short(ex));
                return null;   // 로컬 캐시 없음(§2) — 화면은 '데이터 없음 + 다시 시도'로 간다
            }
        }

        // ★★ 여기에 `LoadSnapshotAsync(string?, RepoPaths)` 같은 **편의 오버로드를 두지 말 것.**
        //    한 번 넣었다가 뺐다(2026-08-27). 이유는 컴파일 문제가 아니라 **게이트가 눈을 감는다**는
        //    것이다 — `tests/calendar-adapter.mjs` 는 부팅 조회 메서드를 **이름 점수**로 고르고
        //    (같은 이름이면 동점), 동점이면 인자 개수로만 가른다. 오버로드는 이름도 인자 개수도
        //    같으므로 **어느 쪽이 뽑힐지는 리플렉션 순서에 달린 우연**이 된다.
        //    RepoPaths 쪽이 뽑히면 그 인자는 딕셔너리가 아니라서 게이트가 `null` 을 넣고,
        //    조회는 성공하지만 gitRepo·svnRepo 가 전부 '' 가 된다. 그러면 게이트는 그 두 값을
        //    **'' 로만 대조하고 통과**시킨다 — 즉 G-6 의 값 대조가 조용히 사라진다. 실패가 아니라
        //    검사가 없어지는 형태라 아무도 눈치채지 못한다.
        //    편의가 필요하면 **CalendarDb 밖에** 두어라(게이트는 이 타입의 메서드만 훑는다).
        //    배선은 `.Map` 한 단어면 끝난다 — 위 주석의 두 줄이 그것이다.

        // ================================================================================
        //  공개 API 3 — 타인 일정 조회 (C4 · 읽기 전용)
        // ================================================================================
        //   「구성원」에서 사람을 눌렀을 때 그 사람의 일정을 읽는다.
        //
        //   ★★ 권한을 **여기서 다시 판정한다**(ProjectDb.CanViewScheduleAsync).
        //     명부가 이미 canViewSchedule 을 붙여 보내지만 그건 **화면을 그리기 위한 것**이고,
        //     웹은 신뢰 경계 밖이다. 여기서 안 막으면 화면을 우회한 요청 하나로 아무나
        //     남의 일정을 가져간다. 판정 규칙이 한 벌인 이유도 같다 — 두 벌이면 갈라진다.
        //
        //   ★ 무엇을 주고 무엇을 안 주나 — **일정만** 준다.
        //     주는 것: 날짜·시간·제목·과제(이름/색)·반복·예외일.
        //     안 주는 것: **메모 · 커밋 · 할 일 · 공수 · 근태 · 설정.**
        //     열람의 목적은 "그 사람이 언제 무엇을 하는가"(회의 잡기·부하 파악)이고,
        //     메모와 커밋은 개인 작업 노트다. 목적에 필요 없는 것을 주면 그때부터
        //     '열람 권한'이 '개인 기록 열람'이 된다. 필요해지면 그때 근거를 적고 늘린다.
        //
        //   ★ 날짜로 거르지 않고 **전부** 준다. 반복 일정은 종료일이 없을 수 있어
        //     범위로 거를 수 없다(2020년 시작이 2026년에도 떠야 한다). 전개는 웹의
        //     expandOccurrences 하나가 단일 진실이므로 그쪽에 맡긴다 — 내 일정과 같은 규칙이 된다.
        //
        //   반환: {"allowed":true,"entries":[…],"categories":[…]} / 권한 없음 {"allowed":false}
        //         / 실패는 null(호출측이 화면에 알린다)
        public async Task<string?> LoadPeerScheduleJsonAsync(string viewerLoginId, string targetLoginId)
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                var ct = cts.Token;
                await using var conn = await OpenReadAsync(ct);
                await ExecAsync(conn, ReadPreambleSql, ct);

                if (!await ProjectDb.CanViewScheduleAsync(conn, viewerLoginId, targetLoginId, ct))
                {
                    _log("타인 일정 조회 거부: " + viewerLoginId + " → " + targetLoginId);
                    return "{\"allowed\":false}";
                }

                int uid;
                await using (var cmd = new MySqlCommand("SELECT user_id FROM app_user WHERE login_id=@id", conn))
                {
                    cmd.Parameters.AddWithValue("@id", (targetLoginId ?? "").Trim());
                    var v = await cmd.ExecuteScalarAsync(ct);
                    if (v == null) return "{\"allowed\":false}";
                    uid = Convert.ToInt32(v, CultureInfo.InvariantCulture);
                }

                //  과제 — 이름·색만. uses_repo·저장소 경로·설명은 남의 화면에 필요 없다.
                var cats = new List<Dictionary<string, object?>>();
                await using (var cmd = new MySqlCommand(
                    "SELECT uid, name, color FROM cal_category WHERE user_id=@u ORDER BY sort_order", conn))
                {
                    cmd.Parameters.AddWithValue("@u", uid);
                    await using var rd = await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct))
                        cats.Add(new Dictionary<string, object?>
                        {
                            ["id"] = Str(rd, "uid"), ["name"] = Str(rd, "name"), ["color"] = Str(rd, "color"),
                        });
                }

                //  일정 — 부팅 조회(2/10)와 **같은 정렬**이어야 한다. 화면 순서가 사람마다 달라지면 안 된다.
                //  ★ 처음엔 여기에 entry_date 를 앞세워 놓고 주석만 '같은 정렬'이라고 적어 뒀다 — 거짓이었다.
                //    부팅(:587)은 `ORDER BY e.sort_order, e.uid` 로 **날짜가 없다.** sort_order 는 이 앱에서
                //    state.entries **배열 전체**의 순서이기 때문이다(실앱 데이터 확인: 한 사람의 값이
                //    날짜를 가로질러 0,1,2…21 로 이어진다). 날짜를 앞세우면 배열 순서가 달라져,
                //    달력 칸 안은 같아 보여도 전역으로 훑는 자리(검색 결과 순서 등)에서 주인이 보는 것과
                //    열람자가 보는 것이 어긋난다. 2026-09-03 더미 데이터를 넣다가 드러났다.
                var entries = new List<Dictionary<string, object?>>();
                var exceptByNo = new Dictionary<uint, List<object?>>();
                await using (var cmd = new MySqlCommand(
                    "SELECT e.entry_no, e.uid, cc.uid AS cat_uid, DATE_FORMAT(e.entry_date,'%Y-%m-%d') AS entry_date, " +
                    "DATE_FORMAT(e.end_date,'%Y-%m-%d') AS end_date, e.all_day, " +
                    "DATE_FORMAT(e.start_time,'%H:%i') AS start_time, DATE_FORMAT(e.end_time,'%H:%i') AS end_time, " +
                    "e.title, e.recur_freq, e.recur_interval, DATE_FORMAT(e.recur_until,'%Y-%m-%d') AS recur_until, e.recur_count " +
                    "FROM cal_entry e LEFT JOIN cal_category cc ON cc.user_id = e.user_id AND cc.cat_no = e.cat_no " +
                    "WHERE e.user_id=@u ORDER BY e.sort_order, e.uid", conn))
                {
                    cmd.Parameters.AddWithValue("@u", uid);
                    await using var rd = await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct))
                    {
                        uint no = UInt(rd, "entry_no");
                        string freq = Str(rd, "recur_freq");
                        Dictionary<string, object?>? recur = freq.Length == 0 ? null : new Dictionary<string, object?>
                        {
                            ["freq"] = freq,
                            ["interval"] = IntOrNull(rd, "recur_interval") ?? 1,
                            ["until"] = Str(rd, "recur_until"),
                            ["count"] = IntOrNull(rd, "recur_count") ?? 0,
                        };
                        var e = new Dictionary<string, object?>
                        {
                            ["id"] = Str(rd, "uid"),
                            ["date"] = Str(rd, "entry_date"),
                            ["title"] = Str(rd, "title"),
                            ["categoryId"] = NullableStr(rd, "cat_uid"),
                            ["allDay"] = (IntOrNull(rd, "all_day") ?? 0) != 0,
                            ["startTime"] = Str(rd, "start_time"),
                            ["endTime"] = Str(rd, "end_time"),
                            ["endDate"] = Str(rd, "end_date"),
                            ["recur"] = recur,
                            ["recurExcept"] = new List<object?>(),
                        };
                        entries.Add(e);
                        if (recur != null) exceptByNo[no] = (List<object?>)e["recurExcept"]!;
                    }
                }

                //  예외일 — 반복 일정에만 붙인다(부팅 조회 3/10 과 같은 규약).
                await using (var cmd = new MySqlCommand(
                    "SELECT entry_no, DATE_FORMAT(except_date,'%Y-%m-%d') AS d " +
                    "FROM cal_entry_except WHERE user_id=@u ORDER BY except_date", conn))
                {
                    cmd.Parameters.AddWithValue("@u", uid);
                    await using var rd = await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct))
                        if (exceptByNo.TryGetValue(UInt(rd, "entry_no"), out var lst)) lst.Add(Str(rd, "d"));
                }

                _log($"타인 일정 조회: {viewerLoginId} → {targetLoginId} · 과제 {cats.Count} · 일정 {entries.Count}");
                return JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["allowed"] = true, ["categories"] = cats, ["entries"] = entries,
                });
            }
            catch (Exception ex) { _log("타인 일정 조회 실패: " + Short(ex)); return null; }
        }

        // ================================================================================
        //  (없앤 것) 공개 API 3 — 커밋 지연 조회
        // ================================================================================
        //   LoadEntryCommitsJsonAsync 가 여기 있었다. 계약 G-7 이 개정되면서(부팅 전량 로드)
        //   존재 이유가 사라졌고, 애초에 **호출부가 0 이었다** — 호스트 브리지에도 웹에도 없었다.
        //   지우는 대신 남겨 두면 "지연 조회가 있으니 부팅은 안 읽어도 된다"는 잘못된 근거가
        //   코드 안에 계속 서 있게 된다. 그 오해가 이 결함의 원인이었으므로 지운다.


        // ================================================================================
        //  내부 — 연결·프리앰블
        // ================================================================================

        // 읽기용 연결. 실패(오프라인·인증오류)는 그대로 던진다 — 호출측이 자기 문맥의 메시지로 처리한다.
        // ★ 읽기에는 권한 검사를 두지 않는다(USER-LOGIN §3.3) — 회수의 목적은 편집 차단이지 조회 차단이 아니다.
        private static async Task<MySqlConnection> OpenReadAsync(CancellationToken ct)
        {
            var conn = new MySqlConnection(BuildConnString());
            try { await conn.OpenAsync(ct); }
            catch { await conn.DisposeAsync(); throw; }   // 못 연 연결을 새지 않게 정리하고 원인은 그대로 전파
            return conn;
        }

        private static async Task ExecAsync(MySqlConnection conn, string sql, CancellationToken ct)
        {
            await using var cmd = new MySqlCommand(sql, conn);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        // 스키마 버전(§3.6 프리앰블 · §5.5). 행이 없으면 "" — 판정은 쓰기 경로의 몫이라 여기선 막지 않는다.
        //   ★ 이 읽기를 §3.5 의 스냅샷 트랜잭션 안으로 끌어넣지 말 것. 조회 스냅샷과 같은 창에 둘 이유가
        //     없고(§3.5 의 '빠지는 것' 표), 창만 길어진다.
        private static async Task<string> ReadSchemaVersionAsync(MySqlConnection conn, CancellationToken ct)
        {
            await using var cmd = new MySqlCommand("SELECT v FROM cal_schema_meta WHERE k='schema_version'", conn);
            var v = await cmd.ExecuteScalarAsync(ct);
            return v == null || v is DBNull ? "" : (v.ToString() ?? "");
        }

        // 이미 연 연결로 해석한다(연결당 1회). 값은 반드시 파라미터 바인딩 — loginId 는 사용자 입력에서 왔다.
        private async Task<int> ResolveUserIdAsync(MySqlConnection conn, string? loginId, CancellationToken ct)
        {
            string id = (loginId ?? "").Trim();
            if (id.Length == 0) throw new CalendarUserNotFoundException("로그인이 필요합니다.");

            await using var cmd = new MySqlCommand("SELECT user_id FROM app_user WHERE login_id=@id", conn);
            cmd.Parameters.AddWithValue("@id", id);
            var v = await cmd.ExecuteScalarAsync(ct);
            if (v == null || v is DBNull)
            {
                _log("캘린더 사용자 해석 실패(app_user 미등록): " + id);
                throw new CalendarUserNotFoundException("사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요.");
            }
            return Convert.ToInt32(v, CultureInfo.InvariantCulture);
        }

        // ================================================================================
        //  내부 — 스냅샷 안에서 읽는 전부
        // ================================================================================
        private async Task<CalendarSnapshot> ReadInsideSnapshotAsync(
            MySqlConnection conn, int userId, string schemaVersion,
            IReadOnlyDictionary<string, (string git, string svn)>? repoPaths, CancellationToken ct)
        {
            var tokens = new Dictionary<string, string>(StringComparer.Ordinal);
            var catNoByUid = new Dictionary<string, uint>(StringComparer.Ordinal);
            var entryNoByUid = new Dictionary<string, uint>(StringComparer.Ordinal);
            var todoNoByUid = new Dictionary<string, uint>(StringComparer.Ordinal);

            // DATETIME(3) → 'yyyy-MM-dd HH:mm:ss.fff' 이 아닌 값이 나오면 세어 둔다.
            //   조용히 고쳐 넘기면 토큰(§3.3)이 어긋나는데 증상은 '가끔 저장이 충돌한다'로만 보인다.
            int badTimeFmt = 0;
            string Iso(string raw)
            {
                if (raw.Length == 0) return "";
                if (raw.Length != 23 || raw[10] != ' ') { badTimeFmt++; return raw; }
                return string.Concat(raw.Substring(0, 10), "T", raw.Substring(11), "Z");
            }

            // ── 0. rev — 이 스냅샷의 판본 ──────────────────────────────────────────
            //   ★ §3.5 의 '대상 9' 에는 cal_user_rev 가 없다. 그 목록은 **state 를 이루는 표**를 센
            //     것이고, rev 는 state 가 아니라 그 state 의 판본 도장이다.
            //   ★ 그런데 왜 트랜잭션 **안**인가 — 밖이면 양쪽 다 새기 때문이다:
            //       · 스냅샷 앞에서 읽으면 그 사이에 커밋된 변경이 데이터에는 들어오고 rev 에는
            //         안 들어와, 나중에 폴링이 '안 바뀌었다'고 판정한다(변경 놓침).
            //       · 스냅샷 뒤에서 읽으면 반대로 rev 만 앞서가 같은 놓침이 난다.
            //     같은 read view 에서 읽어야 데이터와 rev 가 정확히 한 짝이 된다.
            long rev = 0;
            await using (var cmd = new MySqlCommand("SELECT rev FROM cal_user_rev WHERE user_id=@u", conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                var v = await cmd.ExecuteScalarAsync(ct);
                // 행이 없으면 0 — 배포 시 app_user 전원 시딩이 강제라 정상 경로에서는 나오지 않는다.
                if (v != null && v is not DBNull) rev = Convert.ToInt64(v, CultureInfo.InvariantCulture);
            }

            // ── 1/10. cal_category ─────────────────────────────────────────────────
            //   ORDER BY sort_order — XML 문서 순서를 박제한 유일한 근거(G-5).
            //   동률의 뒷순서는 uid 로 고정한다. ★ cat_no 를 쓰지 않는다 — 번호는 '만들어진 순서'일
            //   뿐이고 삭제 후 재사용되므로 표시 순서의 근거가 되지 못한다(G-5 ★).
            //   db_gone 은 컬럼이 아니라 조회 시 파생이다(§6, ADR-18 과 충돌하는 캐시를 만들지 않는다).
            //   is_active 를 ON 절이 아니라 파생식 안에 두는 것도 §6 그대로 — ON 에 넣으면 이름까지 NULL 이 된다.
            var categories = new List<Dictionary<string, object?>>();
            //   uses_repo 는 '저장소를 쓰는 과제인가' 한 비트다(§4, schema_version 5). 경로가 아니다 —
            //   경로 문자열은 DB 에 없고 repoPaths(로컬)가 준다. 이 둘을 함께 실어야 화면이
            //   '경로가 없다' 와 '저장소를 안 쓰는 과제다' 를 가른다(G-6 의 usesRepo 절).
            const string catSql =
                "SELECT c.cat_no, c.uid, c.source, c.name, c.color, c.description, c.uses_repo, " +
                "CAST(c.created_at AS CHAR) AS created_at, CAST(c.updated_at AS CHAR) AS updated_at, " +
                "(c.source='db' AND (p.uid IS NULL OR p.is_active=0)) AS db_gone " +
                "FROM cal_category c LEFT JOIN project p ON p.uid = c.project_uid " +
                "WHERE c.user_id=@u ORDER BY c.sort_order, c.uid";
            await using (var cmd = new MySqlCommand(catSql, conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    uint catNo = UInt(rd, "cat_no");
                    string uid = Str(rd, "uid");
                    catNoByUid[uid] = catNo;
                    tokens["category:" + catNo.ToString(CultureInfo.InvariantCulture)] = Str(rd, "updated_at");

                    (string git, string svn) repo = ("", "");
                    if (repoPaths != null && repoPaths.TryGetValue(uid, out var rp)) repo = rp;

                    // 키 순서·집합은 fromXML() 의 category 객체 + usesRepo. 8개는 항상 있고,
                    // source='db' 일 때만 source·dbGone 두 개가 뒤에 붙는다(개인 과제는 키 자체가 없다 — G-6).
                    // ★ usesRepo 만은 fromXML() 에 대응이 **없는** 키다 — 계약 G-0 이 명시한 유일한
                    //   의도된 예외다. XML 에는 경로 문자열만 있고 '쓴다/안 쓴다'는 없다(§4).
                    var c = new Dictionary<string, object?>
                    {
                        ["id"]        = uid,                       // G-1: uid → 앱의 id. 번호(_no)가 아니다
                        ["name"]      = Str(rd, "name"),
                        ["color"]     = Str(rd, "color"),
                        ["desc"]      = Str(rd, "description"),    // G-1 ★ description 아님
                        ["gitRepo"]   = repo.git,                  // G-6 — DB 에 없다. 로컬에서 온다
                        ["svnRepo"]   = repo.svn,
                        // G-6 — DB 에만 있다(위 둘의 거울). 이 비트가 없으면 화면은 '이 PC 에 경로가 없다'와
                        //   '저장소를 안 쓰는 과제다'를 구분하지 못해, §4 의 안내가 모든 과제에 뜨거나
                        //   아무 데도 안 뜬다. ★ repo.git/svn 에서 파생하지 않는다 — 파생하면 3분기가
                        //   2분기로 접혀 이 컬럼을 만든 이유가 사라진다. 근거는 언제나 DB 컬럼이다.
                        // ★ true/false 둘 다 키를 만든다(source·dbGone 과 다르다) — undefined 는 false 와
                        //   같은 자리에 떨어져 '경로 없음 안내' 분기가 조용히 사라진다.
                        ["usesRepo"]  = (IntOrNull(rd, "uses_repo") ?? 0) != 0,   // G-4 — 0/1 을 그대로 넘기지 않는다
                        ["createdAt"] = Iso(Str(rd, "created_at")), // G-3
                    };
                    if (string.Equals(Str(rd, "source"), "db", StringComparison.Ordinal))
                    {
                        c["source"] = "db";
                        c["dbGone"] = (IntOrNull(rd, "db_gone") ?? 0) != 0;
                    }
                    categories.Add(c);
                    // ※ cal_category.updated_at 은 state 에 대응 키가 없다(fromXML 확인) —
                    //   위 토큰 맵이 유일한 보관처다(G-6).
                }
            }

            // ── 2/10. cal_entry ────────────────────────────────────────────────────
            //   ORDER BY sort_order, uid (G-5). ★ entry_date 도 created_at 도 정렬키가 아니다.
            //   ★ 2026-08-27 에 두 번 바뀐 자리다. 원래 `entry_date, created_at, uid` 였다.
            //     ① created_at 을 뺀 이유 — 실 data.xml 의 일정 23건 중 22건이 같은 밀리초라
            //        순서를 전혀 결정하지 못한다((entry_date, created_at) 쌍으로도 동률 그룹이 2개 남는다).
            //        배열 순서의 유일한 근거는 sort_order 다(계약 E — 이관이 XML 문서 순서를 박제한다).
            //     ② entry_date 를 **1차 키에서도 뺀 이유** — 계약 G 의 목표가 'fromXML() 이 돌려주던 것과
            //        똑같은 모양' 인데, fromXML 의 entries 배열은 문서 순서이고 **날짜순이 아니다**.
            //        entry_date 를 앞에 두면 그 배열을 재현할 방법이 아예 없다(게이트가 real 23자리 중
            //        22자리 불일치로 잡았다). 옛 G-5 의 'ORDER BY entry_date' 는 sort_order 가 없던 시절
            //        '무순서보다는 낫다' 는 대용품이었고, 이제 그 자리는 sort_order 가 정확히 채운다.
            //     ★ 화면이 달라지지 않는 근거(직접 확인): 앱은 state.entries 를 날짜순으로 신뢰하는 곳이
            //        한 곳도 없다. entriesOn()·groupByDateHtml() 이 **먼저 날짜로 묶은 뒤** entrySort 로
            //        정렬하고, 작업일지는 rows.sort(date,time) 한다. 배열 순서가 새어 나오는 곳은
            //        entrySort 의 동률뿐인데 그건 항상 '같은 날짜 안' 이라, 날짜로 먼저 정렬하든 안 하든
            //        **같은 날짜 안의 상대 순서는 동일**하다. 즉 ②는 화면에 무영향이고 재현성만 얻는다.
            //   마지막 uid 는 결정성용 티브레이커다. sort_order 동률(= 이관이 값을 빠뜨려 전 행 0)일 때
            //     MySQL 이 매 부팅 다른 순서를 주는 것을 막는다 — '틀린 순서' 보다 '매번 바뀌는 순서' 가
            //     훨씬 나쁘고 재현이 안 돼 추적도 막힌다. uid 는 UNIQUE(user_id, uid) 라 순서를 완결한다.
            //   ★ entry_no 는 쓰지 않는다(G-5 ★ — MAX()+1 이라 재사용되는 번호다).
            //   cat_no 는 LEFT JOIN 으로 **그 과제의 uid** 로 되돌린다(G-1). 숫자를 그대로 흘리면
            //   앱의 `e.categoryId === c.id` 가 어디서도 안 맞아 전 일정이 '미분류'가 되고 오류는 0건이다.
            var entries = new List<Dictionary<string, object?>>();
            var recurExceptByNo = new Dictionary<uint, List<object?>>();
            var commitsByNo     = new Dictionary<uint, List<object?>>();   // G-7 개정: 4/10 이 여기에 접는다
            const string entrySql =
                "SELECT e.entry_no, e.uid, cc.uid AS cat_uid, " +
                "DATE_FORMAT(e.entry_date,'%Y-%m-%d') AS entry_date, " +
                "DATE_FORMAT(e.end_date,'%Y-%m-%d')   AS end_date, " +
                "e.all_day, DATE_FORMAT(e.start_time,'%H:%i') AS start_time, " +
                "DATE_FORMAT(e.end_time,'%H:%i') AS end_time, " +
                "e.title, e.memo, e.source, e.location, e.remind, " +
                "e.recur_freq, e.recur_interval, e.recur_until, e.recur_count, " +
                "CAST(e.created_at AS CHAR) AS created_at, CAST(e.updated_at AS CHAR) AS updated_at " +
                "FROM cal_entry e " +
                "LEFT JOIN cal_category cc ON cc.user_id = e.user_id AND cc.cat_no = e.cat_no " +
                "WHERE e.user_id=@u ORDER BY e.sort_order, e.uid";
            await using (var cmd = new MySqlCommand(entrySql, conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    uint entryNo = UInt(rd, "entry_no");
                    string uid = Str(rd, "uid");
                    entryNoByUid[uid] = entryNo;
                    tokens["entry:" + entryNo.ToString(CultureInfo.InvariantCulture)] = Str(rd, "updated_at");

                    // recur — 네 컬럼이 통째로 NULL 이면 반복 없음(chk_cal_entry_recur 가 반쪽 상태를 막는다).
                    //   그래서 여기서 normRecur() 의 기본값 보정을 다시 하지 않는다: interval>=1·count>=0 은
                    //   이미 CHECK 가 판정한 값이고, until 은 형식만 검사된 문자열이라 원문 그대로 돌려준다.
                    string freq = Str(rd, "recur_freq");
                    Dictionary<string, object?>? recur = null;
                    if (freq.Length > 0)
                    {
                        recur = new Dictionary<string, object?>
                        {
                            ["freq"]     = freq,
                            ["interval"] = IntOrNull(rd, "recur_interval") ?? 1,
                            ["until"]    = Str(rd, "recur_until"),   // G-2: NULL → ''
                            ["count"]    = IntOrNull(rd, "recur_count") ?? 0,
                        };
                    }

                    var e = new Dictionary<string, object?>
                    {
                        ["id"]         = uid,
                        ["date"]       = Str(rd, "entry_date"),      // G-1 ★ entryDate 아님
                        ["title"]      = Str(rd, "title"),
                        ["categoryId"] = NullableStr(rd, "cat_uid"), // G-2 ★ 여기만은 NULL 을 유지한다('' 아님)
                        ["allDay"]     = (IntOrNull(rd, "all_day") ?? 0) != 0,   // G-4: TINYINT → boolean
                        ["startTime"]  = Str(rd, "start_time"),      // G-2: NULL → ''
                        ["endTime"]    = Str(rd, "end_time"),
                        ["hours"]      = null,                       // G-6: 컬럼을 폐지했다. undefined 로 두지 않는다
                        ["location"]   = Str(rd, "location"),
                        ["remind"]     = IntOrNull(rd, "remind"),    // G-2 ★ NULL 유지. null=기본 사다리 / 0=알림 없음
                        ["memo"]       = Str(rd, "memo"),
                        ["source"]     = Str(rd, "source"),          // '' 또는 'git' 두 값뿐(CHECK)
                        ["commits"]    = new List<object?>(),        // G-7: 항상 배열. 아래 4/10 에서 채운다
                        ["endDate"]    = Str(rd, "end_date"),        // G-2: NULL → ''
                        ["recur"]      = recur,
                        ["recurExcept"] = new List<object?>(),       // 아래 3/10 에서 채운다
                        ["createdAt"]  = Iso(Str(rd, "created_at")),
                        ["updatedAt"]  = Iso(Str(rd, "updated_at")),
                    };
                    entries.Add(e);
                    commitsByNo[entryNo] = (List<object?>)e["commits"]!;
                    if (recur != null) recurExceptByNo[entryNo] = (List<object?>)e["recurExcept"]!;
                }
            }

            // ── 3/10. cal_entry_except ─────────────────────────────────────────────
            //   ORDER BY except_date(G-5). ★ ORDER BY 에 entry_no 를 쓰지 않는다 — 부모별로 접으므로
            //   행이 어떻게 섞여 오든 각 배열 안의 순서는 날짜순으로 확정된다.
            //   entry_no 는 접는 데만 쓰고 state 에는 남기지 않는다(G-1d).
            //   ★ recur 가 없는 일정에는 붙이지 않는다 — fromXML() 은 예외일을 **유효한 recur 안에서만**
            //     읽으므로, 붙이면 그 즉시 '앱이 만들 수 없는 모양'이 되어 계약 G-0b 가 깨진다.
            //     (그런 행은 앱이 만들지 않는다. 나오면 세어서 알린다 — 조용히 버리지 않는다.)
            int orphanExcept = 0;
            const string exceptSql =
                "SELECT entry_no, DATE_FORMAT(except_date,'%Y-%m-%d') AS except_date " +
                "FROM cal_entry_except WHERE user_id=@u ORDER BY except_date";
            await using (var cmd = new MySqlCommand(exceptSql, conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    uint entryNo = UInt(rd, "entry_no");
                    if (recurExceptByNo.TryGetValue(entryNo, out var list)) list.Add(Str(rd, "except_date"));
                    else orphanExcept++;
                }
            }
            if (orphanExcept > 0) _log("반복 없는 일정에 붙은 예외일 " + orphanExcept + "건 — state 에 넣지 않았다(앱이 만들 수 없는 모양)");

            // ── 4/10. cal_entry_commit ────────────────────────────────────────────
            //   ORDER BY entry_no, seq — seq 가 부모 commits 배열의 인덱스이자 표시 순서의
            //   유일한 근거다(G-5). entry_no 를 앞에 두는 것은 순서와 무관하고(부모별로 접으므로)
            //   같은 부모의 행이 붙어 오게 해 접기를 싸게 만들 뿐이다.
            //   ★ entry_no 는 접는 데만 쓰고 state 에는 남기지 않는다(G-1d) — 3/10 과 같은 규약.
            //   ★ 고아 행(부모 없는 커밋)은 FK 가 막지만, 막혔다고 믿고 조용히 버리지 않는다.
            //     세어서 알린다 — 3/10 이 예외일에 하는 것과 같다.
            int orphanCommit = 0;
            const string commitSql =
                "SELECT entry_no, hash, short_hash, DATE_FORMAT(commit_time,'%H:%i') AS commit_time, subject, body " +
                "FROM cal_entry_commit WHERE user_id=@u ORDER BY entry_no, seq";
            await using (var cmd = new MySqlCommand(commitSql, conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    uint entryNo = UInt(rd, "entry_no");
                    if (commitsByNo.TryGetValue(entryNo, out var list)) list.Add(CommitRow(rd));
                    else orphanCommit++;
                }
            }
            if (orphanCommit > 0) _log("부모 없는 커밋 " + orphanCommit + "건 — state 에 넣지 않았다");

            // ── 5/10. cal_todo ─────────────────────────────────────────────────────
            //   ORDER BY sort_order, uid (G-5 — 2026-08-27 에 확정값으로 못박혔다).
            //   ★ 여기가 원래 created_at → uid 였고, 그 근거는 '앱이 push 하므로 배열 순서 = 생성 순서'
            //     였다. 전제는 맞지만 created_at 이 그 순서를 **표현하지 못한다** — 실 data.xml 의
            //     할 일 7건 중 5건이 같은 밀리초다. 일정과 달리 1차 정렬축이 될 것도 없다(due 는
            //     NULL 이 정상 상태라 정렬키로 못 쓴다). 그래서 sort_order 가 유일한 근거다.
            //   ★ entries 와 달리 날짜 축을 앞에 두지 않는다 — todos 는 배열 자체가 문서 순서이고
            //     due 로 묶는 것은 화면(sortS)의 몫이다. due 를 1차 키로 쓰면 NULL 이 어디로 갈지
            //     MySQL 정렬 규칙에 맡기게 되고, 기준(fromXML)의 배열 순서와 어긋난다.
            //   마지막 uid 는 entries 와 같은 이유의 결정성 티브레이커다.
            //   ★ todo_no 는 쓰지 않는다(G-5 ★ — 재사용되는 번호).
            var todos = new List<Dictionary<string, object?>>();
            var dayNotesByNo = new Dictionary<uint, Dictionary<string, object?>>();
            const string todoSql =
                "SELECT t.todo_no, t.uid, cc.uid AS cat_uid, t.todo_text, t.note, " +
                "DATE_FORMAT(t.due,'%Y-%m-%d') AS due, DATE_FORMAT(t.end_date,'%Y-%m-%d') AS end_date, " +
                "t.done, t.prio, CAST(t.completed_at AS CHAR) AS completed_at, " +
                "CAST(t.created_at AS CHAR) AS created_at, CAST(t.updated_at AS CHAR) AS updated_at " +
                "FROM cal_todo t " +
                "LEFT JOIN cal_category cc ON cc.user_id = t.user_id AND cc.cat_no = t.cat_no " +
                "WHERE t.user_id=@u ORDER BY t.sort_order, t.uid";
            await using (var cmd = new MySqlCommand(todoSql, conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    uint todoNo = UInt(rd, "todo_no");
                    string uid = Str(rd, "uid");
                    todoNoByUid[uid] = todoNo;
                    tokens["todo:" + todoNo.ToString(CultureInfo.InvariantCulture)] = Str(rd, "updated_at");

                    var dayNotes = new Dictionary<string, object?>(StringComparer.Ordinal);
                    dayNotesByNo[todoNo] = dayNotes;

                    todos.Add(new Dictionary<string, object?>
                    {
                        ["id"]          = uid,
                        ["text"]        = Str(rd, "todo_text"),      // G-1 ★ todoText 아님
                        ["done"]        = (IntOrNull(rd, "done") ?? 0) != 0,      // G-4
                        ["categoryId"]  = NullableStr(rd, "cat_uid"),             // G-2 ★ NULL 유지
                        ["due"]         = Str(rd, "due"),            // G-2: NULL → ''
                        ["endDate"]     = Str(rd, "end_date"),
                        ["prio"]        = Str(rd, "prio"),           // 'normal'|'high' 두 값뿐(CHECK)
                        ["completedAt"] = Iso(Str(rd, "completed_at")), // G-2+G-3: NULL 이면 '', 값이 있을 때만 ISO
                        ["note"]        = Str(rd, "note"),
                        ["dayNotes"]    = dayNotes,                  // 배열이 아니라 맵(G-5). 없으면 {}
                        ["createdAt"]   = Iso(Str(rd, "created_at")),
                        ["updatedAt"]   = Iso(Str(rd, "updated_at")),
                    });
                }
            }

            // ── 6/10. cal_todo_day_note ────────────────────────────────────────────
            //   { 'YYYY-MM-DD': '설명' } 로 접는다(G-5). todo_no 는 접는 데만 쓰고 state 에는 없다(G-1d).
            //   ORDER BY note_date — 맵이라 의미는 없지만 JSON 키 순서를 재현 가능하게 만든다.
            const string dayNoteSql =
                "SELECT todo_no, DATE_FORMAT(note_date,'%Y-%m-%d') AS note_date, note_text " +
                "FROM cal_todo_day_note WHERE user_id=@u ORDER BY note_date";
            await using (var cmd = new MySqlCommand(dayNoteSql, conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    if (dayNotesByNo.TryGetValue(UInt(rd, "todo_no"), out var map))
                        map[Str(rd, "note_date")] = Str(rd, "note_text");
                }
            }

            // ── 7/10. cal_room ─────────────────────────────────────────────────────
            //   객체가 아니라 **문자열 배열**이다(G-5). ORDER BY sort_order, 동률은 name(= PK 후단).
            //   ★ 행 0개 = 빈 목록으로 확정. DEFAULT_ROOMS 재주입은 DB 전환과 함께 폐기했다
            //     (DB 에서는 '한 번도 없었음'과 '사용자가 전부 지움'을 구분할 수 없다 — cal_room DDL 주석).
            var rooms = new List<object?>();
            await using (var cmd = new MySqlCommand("SELECT name FROM cal_room WHERE user_id=@u ORDER BY sort_order, name", conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct)) rooms.Add(Str(rd, "name"));
            }

            // ── 8/10. cal_task_hours ───────────────────────────────────────────────
            //   { 'YYYY-MM-DD': { 과제uid: 시간 } } 2단 중첩(G-5).
            //   ★ 안쪽 키는 cat_no 가 아니라 그 과제의 uid 다 — JOIN 으로 되돌린다(G-5 ★).
            //     INNER JOIN 인 이유: cat_no 가 NOT NULL 이고 FK 가 있어 같은 스냅샷 안에서 반드시 해석된다
            //     (해석 실패는 스냅샷 밖에서만 생길 수 있다 — G-1b).
            //   ★ 값은 DECIMAL(4,2) 인데 앱은 숫자다. decimal 을 그대로 직렬화하면 8.00 처럼 나가
            //     JSON 텍스트가 앱이 만드는 8 과 달라진다(파싱 결과는 같지만 §8 왕복 대조가 어긋난다).
            var taskHours = new Dictionary<string, object?>(StringComparer.Ordinal);
            const string thSql =
                "SELECT DATE_FORMAT(th.work_date,'%Y-%m-%d') AS work_date, th.cat_no, c.uid AS cat_uid, th.hours, " +
                "CAST(th.updated_at AS CHAR) AS updated_at " +
                "FROM cal_task_hours th " +
                "JOIN cal_category c ON c.user_id = th.user_id AND c.cat_no = th.cat_no " +
                "WHERE th.user_id=@u ORDER BY th.work_date, c.uid";
            await using (var cmd = new MySqlCommand(thSql, conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    string date = Str(rd, "work_date");
                    if (!taskHours.TryGetValue(date, out var slot) || slot is not Dictionary<string, object?> inner)
                    {
                        inner = new Dictionary<string, object?>(StringComparer.Ordinal);
                        taskHours[date] = inner;
                    }
                    inner[Str(rd, "cat_uid")] = Dbl(rd, "hours");
                    tokens["task_hours:" + date + ":" + UInt(rd, "cat_no").ToString(CultureInfo.InvariantCulture)] = Str(rd, "updated_at");
                }
            }

            // ── 9/10. cal_attendance ───────────────────────────────────────────────
            //   { 'YYYY-MM-DD': { status, overtime } }(G-5).
            //   ★ 행이 없는 날짜의 키를 만들지 않는다 — 그게 '미기록'이다. 빈 객체나 status:'' 를
            //     넣으면 getAttendance() 가 null 을 못 돌려주고, netcus 일간보고가 사용자가 사이트에
            //     직접 적어 둔 휴가·병가를 '정근'으로 덮는다(G-5 ★).
            //   ★ status 유효성을 C# 에서 검사하지 않는다 — DB CHECK 가 판정한다(§3.8.5).
            //     JS ATTEND_STATUS + SQL CHECK 로 이미 두 벌이고 세 번째를 만들지 않는다.
            var attendance = new Dictionary<string, object?>(StringComparer.Ordinal);
            const string atSql =
                "SELECT DATE_FORMAT(work_date,'%Y-%m-%d') AS work_date, status, overtime, " +
                "CAST(updated_at AS CHAR) AS updated_at " +
                "FROM cal_attendance WHERE user_id=@u ORDER BY work_date";
            await using (var cmd = new MySqlCommand(atSql, conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                while (await rd.ReadAsync(ct))
                {
                    string date = Str(rd, "work_date");
                    attendance[date] = new Dictionary<string, object?>
                    {
                        ["status"]   = Str(rd, "status"),
                        ["overtime"] = IntOrNull(rd, "overtime") ?? 0,
                    };
                    tokens["attendance:" + date] = Str(rd, "updated_at");
                }
            }

            // ── 10/10. cal_user_pref ────────────────────────────────────────────────
            //   사용자당 1행. 최상위의 12개 값이 전부 여기서 온다.
            //   ★ 행이 없을 때(= 아직 이관 전인 사용자)는 fromXML() 이 <prefs> 없는 XML 에 주는 값과
            //     똑같이 채운다. 그것이 이 앱이 '설정을 한 번도 만진 적 없는 사람'에게 주던 값이고,
            //     여기서 다른 값을 지어내면 이관 직후 서식이 이유 없이 바뀐다.
            //   ★ reportMarker/MarkerCustom/Indent(전역 3값)가 daily/weekly 와 달라도 정상이다 —
            //     그 셋은 '마지막으로 본 모드의 거울'이다(계약 C 의 ※).
            //   ★ DB 6컬럼이 전부 NOT NULL DEFAULT 라 fromXML 의 null 폴백 경로는 발화하지 않는다.
            //     컬럼값을 그대로 접는다.
            string gitAuthor = "", svnAuthor = "";
            string reportMarker = "-", reportMarkerCustom = "";
            int reportIndent = 2;
            bool gitCommitBody = false;
            string mkDaily = "-", mkcDaily = "", mkWeekly = "-", mkcWeekly = "";
            int inDaily = 2, inWeekly = 2;
            string fontFamily = "";
            int fontSize = 0;
            const string prefSql =
                "SELECT git_author, svn_author, report_marker, report_marker_custom, report_indent, git_commit_body, " +
                "report_marker_daily, report_marker_custom_daily, report_indent_daily, " +
                "report_marker_weekly, report_marker_custom_weekly, report_indent_weekly, " +
                "report_font_family, report_font_size, CAST(updated_at AS CHAR) AS updated_at " +
                "FROM cal_user_pref WHERE user_id=@u";
            await using (var cmd = new MySqlCommand(prefSql, conn))
            {
                cmd.Parameters.AddWithValue("@u", userId);
                await using var rd = await cmd.ExecuteReaderAsync(ct);
                if (await rd.ReadAsync(ct))
                {
                    gitAuthor          = Str(rd, "git_author");
                    svnAuthor          = Str(rd, "svn_author");
                    reportMarker       = Str(rd, "report_marker");
                    reportMarkerCustom = Str(rd, "report_marker_custom");
                    reportIndent       = IntOrNull(rd, "report_indent") ?? 2;
                    gitCommitBody      = (IntOrNull(rd, "git_commit_body") ?? 0) != 0;   // G-4
                    mkDaily            = Str(rd, "report_marker_daily");
                    mkcDaily           = Str(rd, "report_marker_custom_daily");
                    inDaily            = IntOrNull(rd, "report_indent_daily") ?? 2;
                    mkWeekly           = Str(rd, "report_marker_weekly");
                    mkcWeekly          = Str(rd, "report_marker_custom_weekly");
                    inWeekly           = IntOrNull(rd, "report_indent_weekly") ?? 2;
                    fontFamily         = Str(rd, "report_font_family");
                    fontSize           = IntOrNull(rd, "report_font_size") ?? 0;
                    // cal_user_pref 도 state 에 updatedAt 키가 없다 — 토큰 맵이 유일한 보관처다(G-6).
                    tokens["user_pref"] = Str(rd, "updated_at");
                }
            }

            if (badTimeFmt > 0)
                _log("DATETIME 문자열이 'yyyy-MM-dd HH:mm:ss.fff' 가 아닌 행 " + badTimeFmt + "건 — 낙관적 잠금 토큰이 어긋날 수 있다");

            // ── 계약 G-0: 최상위 반환 객체 — 키 14개, fromXML() 의 return 과 정확히 동일 ──────
            //   ★ lsMigrated 는 **없앴다**(2026-09-01). 여기 하드코딩 true 가 있었고, 그 이유는
            //     "false/undefined 면 migrateLocalStores() 가 localStorage 좀비를 DB 로 밀어 넣는다"
            //     였다. 즉 이 줄은 **다른 계층의 자동이관을 막으려고** 여기 서 있던 방어 부채였다.
            //     그 자동이관을 걷어내면서 함께 사라진다. 키가 하나 줄어 최상위 키는 14 다.
            var state = new Dictionary<string, object?>
            {
                ["categories"]         = categories,
                ["entries"]            = entries,
                ["gitAuthor"]          = gitAuthor,
                ["svnAuthor"]          = svnAuthor,
                ["todos"]              = todos,
                ["rooms"]              = rooms,
                ["reportMarker"]       = reportMarker,
                ["reportMarkerCustom"] = reportMarkerCustom,
                ["reportIndent"]       = reportIndent,
                ["gitCommitBody"]      = gitCommitBody,
                ["reportFormatPrefs"]  = new Dictionary<string, object?>
                {
                    ["daily"]  = new Dictionary<string, object?> { ["marker"] = mkDaily,  ["markerCustom"] = mkcDaily,  ["indent"] = inDaily },
                    ["weekly"] = new Dictionary<string, object?> { ["marker"] = mkWeekly, ["markerCustom"] = mkcWeekly, ["indent"] = inWeekly },
                },
                ["taskHours"]          = taskHours,
                ["attendance"]         = attendance,
                ["reportFont"]         = new Dictionary<string, object?> { ["family"] = fontFamily, ["size"] = fontSize },
            };

            return new CalendarSnapshot(
                JsonSerializer.Serialize(state), tokens, rev, schemaVersion, userId,
                catNoByUid, entryNoByUid, todoNoByUid);
        }

        // 커밋 한 행 → 앱의 commit 객체(계약 G-1·G-2). 키 5개가 전부다.
        private static Dictionary<string, object?> CommitRow(DbDataReader rd) =>
            new Dictionary<string, object?>
            {
                ["hash"]    = Str(rd, "hash"),
                ["short"]   = Str(rd, "short_hash"),   // G-1 ★ shortHash 아님
                ["time"]    = Str(rd, "commit_time"),  // G-1(commit_time→time) + G-2(NULL → '')
                ["subject"] = Str(rd, "subject"),
                ["body"]    = Str(rd, "body"),
            };

        // ================================================================================
        //  내부 — 리더 헬퍼
        //  ※ Str/IntOrNull/Short 는 ProjectDb 에도 같은 것이 있다. 지금 공용으로 빼지 않는 이유:
        //    그러려면 ProjectDb 를 고쳐야 하는데 이번 변경 범위가 아니고, 세 줄짜리 함수라
        //    '두 곳이 어긋나면 조용히 다르게 동작하는' 부류도 아니다(둘 다 순수 변환).
        // ================================================================================

        private static string Str(DbDataReader rd, string col)
        {
            int i = rd.GetOrdinal(col);
            return rd.IsDBNull(i) ? "" : (rd.GetValue(i)?.ToString() ?? "");
        }

        // NULL 을 '' 가 아니라 null 로 되돌리는 자리 — 계약 G-2 의 예외(categoryId) 전용.
        // 앱 전 경로가 `|| null` 이라 '' 도 즉시 null 로 접히지만, xmlRoundTrip 의 `e.categoryId||null`
        // 대조와 표시 분기를 위해 명시적 null 로 둔다.
        private static string? NullableStr(DbDataReader rd, string col)
        {
            int i = rd.GetOrdinal(col);
            return rd.IsDBNull(i) ? null : (rd.GetValue(i)?.ToString() ?? "");
        }

        private static int? IntOrNull(DbDataReader rd, string col)
        {
            int i = rd.GetOrdinal(col);
            if (rd.IsDBNull(i)) return null;
            try { return Convert.ToInt32(rd.GetValue(i), CultureInfo.InvariantCulture); } catch { return null; }
        }

        private static uint UInt(DbDataReader rd, string col)
        {
            int i = rd.GetOrdinal(col);
            if (rd.IsDBNull(i)) return 0;
            try { return Convert.ToUInt32(rd.GetValue(i), CultureInfo.InvariantCulture); } catch { return 0; }
        }

        // DECIMAL(4,2) → 앱의 숫자. 소수 2자리로 맞춰 8.00 이 8 로, 0.50 이 0.5 로 직렬화되게 한다
        // (System.Text.Json 의 double 은 왕복 가능한 최단 표기를 쓴다 — JS 의 숫자 표기와 같은 규칙).
        private static double Dbl(DbDataReader rd, string col)
        {
            int i = rd.GetOrdinal(col);
            if (rd.IsDBNull(i)) return 0;
            try { return Math.Round(Convert.ToDouble(rd.GetValue(i), CultureInfo.InvariantCulture), 2); } catch { return 0; }
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
