-- =====================================================================
--  캘린더(cal_*) 테이블 DDL — 단일 소스
--  MySQL 8.0.13+ / InnoDB / utf8mb4.  (실측·검증 대상: MySQL 8.4.9, STRICT_TRANS_TABLES)
--  ※ 8.0.13 미만 불가 — memo/note/body/subject(전부 MEDIUMTEXT) 가 식 DEFAULT ('') 를 쓴다.
--  ※ 설계 근거는 db/CALENDAR-TABLE-DESIGN.md. 문서와 이 파일이 어긋나면 이 파일이 정본이다.
--
--  ⚠️ 재실행 경고 — 데이터가 든 DB 에 다시 돌리면 캘린더 데이터가 전부 사라진다.
--     아래 DROP TABLE 이 cal_* 12개를 자식→부모 순으로 지운다. 일정·할일·공수·회의실·
--     이관 마커가 모두 날아가고 되돌릴 수 없다.
--     ★ 되돌릴 수단은 이 DB 안에 없다. 복구 경로는 '주간 mysqldump + binlog' 하나뿐이다
--       (2026-08-11 결정: 감사 트리거·cal_audit_trash 폐지. 같은 DB 안에 둔 휴지통은 서버가
--        통째로 죽는 사고에 함께 사라져 복구에 무력했고, 이 파일을 다시 돌릴 때 DROP TABLE 이
--        경고 한 줄 없이 그 트리거까지 지워 '보호받는 줄 알았는데 아니었던' 상태를 만들었다).
--       → 데이터가 있는 DB 라면 이 파일을 돌리기 전에 mysqldump 를 먼저 뜰 것.
--       배포 순서(고정): schema-calendar.sql → grants-calendar.sql.
--       (사람이 먼저 여는 파일이 이것이라 여기에도 둔다. 두 파일이 같은 순서를 각자 적어 두고 있으므로
--        한 곳을 고치면 나머지도 함께 볼 것 — 순서는 GRANT 가 표의 실재를 전제하기 때문에 정해진다.)
--     이 파일은 '최초 1회 구축' 전용이다. 운영 중 구조 변경은 별도 migrate-*.sql 로 할 것.
--
--  ⚠️ 이 파일은 cal_* 만 만든다.
--     app_user / org_unit / title_code / project / customer / section_code / status_code 는
--     FK 로 참조만 하고 DROP·CREATE·ALTER 를 하지 않는다(사내 실데이터 89명분이 들어 있다).
--     선행 조건: app_user 가 이미 존재해야 한다. 없으면 FK 생성이 errno 1824 로 실패한다.
--
--  시각 컬럼 규약(중요):
--     created_at / updated_at / completed_at 은 앱이 UTC 로 계산해 '명시 대입'한다.
--     서버 DEFAULT CURRENT_TIMESTAMP(3) 도, ON UPDATE CURRENT_TIMESTAMP(3) 도 일부러 쓰지 않았다.
--     왜: CURRENT_TIMESTAMP 는 세션 time_zone(현 서버는 SYSTEM=KST)으로 평가된다. 서버가 한 번이라도
--     값을 쓰면 같은 컬럼에 KST 와 UTC 가 섞이고, DATETIME 은 사후에 둘을 구분할 수단이 없다(복구 불가).
--     updated_at 은 동시에 낙관적 잠금 토큰이라 쓰기 주체가 둘이면 토큰 자체가 무너진다.
--     → 접속 프리앰블에 SET SESSION time_zone='+00:00' 을 함께 둘 것.
--
--  =====================================================================
--  ★★ XML→DB 어댑터 계약 — 여섯 부류(A·B·C·D·E·F). 여섯 다 '선택'이 아니다.
--  =====================================================================
--     왜 한 절로 묶는가: 병이 하나다. data.xml 의 값을 **그대로** INSERT 하면 둘 중 하나가 난다 —
--       (1) 이관이 그 자리에서 멈추고 단일 트랜잭션이라 그 사용자의 이관 전체가 롤백되거나,
--       (2) 에러도 경고도 없이 값이 다른 값으로 바뀐다(사후 구분 불가).
--     A~D 가 그 둘이고, E·F 는 다른 병이다 — E 는 XML 에 원본이 없어 어댑터가 만들어야 하는 값이고,
--     F 는 XML 에 있는데 앱은 만들지 않는 값이다. 여섯을 어댑터 단일 함수로 강제하고,
--     런타임 저장 경로와 이관 도구가 같은 함수를 쓴다.
--     대상 목록은 task-calendar-prototype.html 을 직접 읽어 전수 확인한 것이다.
--
--     ※ 앱 코드를 가리킬 때는 함수 이름·요소 id 로 가리킨다(줄번호를 쓰지 않는다).
--       저 파일은 1.5MB 짜리 단일 HTML 이라 한 줄만 늘어도 이 파일의 모든 줄번호가 어긋나고,
--       근거를 확인하려 열면 딴 내용이 나와 '실측 근거'가 검증 불가능해진다. 이름은 안 썩는다.
--       같은 이유로 이 파일은 형제 SQL 파일(grants)의 줄번호도, 그 파일의 '현재 상태'도
--       베끼지 않는다 — 제약·GRANT 는 전부 이름으로 가리킨다.
--
--  ── A. '' → NULL ─────────────────────────────────────────────────────
--     앱은 '값 없음'을 JS 빈 문자열로 들고 있고 XML 에도 그대로 나간다. 아래 8개 컬럼이 그 대상이다.
--
--     ① 무음 오염 3건 (TIME) — 가장 위험하다. 에러도 경고도 없이 값이 바뀐다.
--        실측(8.4.9, 같은 세션에서 SHOW WARNINGS 확인): '' 삽입 → 경고 0건, 저장값 00:00:00.
--        즉 '시각 없음'이 '자정'으로 조용히 바뀌고, 사후에 구분할 수단이 없다.
--          cal_entry.start_time        ← addEntry() `d.startTime||''`, fromXML() 의 validTime() 이 ''를 낸다
--          cal_entry.end_time          ← 같은 곳. toXML() 은 entry 의 startTime/endTime 을 빈 값도 속성으로 항상 기록한다
--          cal_entry_commit.commit_time← normCommits() `time: … : ''`
--
--     ② 시끄러운 실패 5건 — 이관이 그 자리에서 멈춘다(전체 롤백). 위험도는 낮지만 이관을 못 끝낸다.
--          cal_entry.end_date    DATE      ERROR 1292  ← rangeFields() `endDate:''`
--          cal_todo.due          DATE      ERROR 1292  ← addTodo() / updateTodo()
--          cal_todo.end_date     DATE      ERROR 1292  ← addTodo() / updateTodo()
--          cal_todo.completed_at DATETIME  ERROR 1292  ← toggleTodo() (완료 해제 시 ''), fromXML() 의 todo 매핑
--          cal_entry.recur_until CHAR(10)  ERROR 3819  ← normRecur() `until:''`
--             ★ recur_until 만 타입 검사를 통과하고 CHECK 단계에서 걸린다 — 가장 놓치기 쉽다.
--
--     ③ 목록에 넣지 않은 것 (직접 확인한 결과 '' 를 만들지 않는다. 받아쓰지 말 것):
--          category_id (entry·todo 양쪽) — 앱은 전 경로가 `|| null` 이다:
--            addEntry() / addTodo() / fromXML() 의 entry·todo 매핑 (`getAttribute(...) || null`).
--            빈 속성 categoryId="" 도 `'' || null` 로 null 이 된다. 실측상 ''를 넣으면 ERROR 1452 이지만
--            그 값을 만들어 내는 코드 경로가 없다.
--          remind — 미입력은 '' 가 아니라 null 이다(normRemind()).
--          (entry@hours 는 아예 대응 컬럼이 없다 — 아래 ★ '이관이 버리는 XML 속성' 참조)
--
--     ★ 별개 위험(''와 무관, 어댑터가 아니라 이관 도구가 막아야 한다):
--        fromXML() 은 존재하지 않는 과제를 가리키는 categoryId 를 그대로 남긴다(주석 "미존재 참조는 표시 시
--        '미분류'로 안전 처리"). 앱은 무해하지만 DB 는 fk_cal_entry_category 로 ERROR 1452 를 낸다.
--        이관 도구가 사전에 '실재하지 않는 category_id → NULL' 정리를 하고 그 건수를 보고해야 한다.
--
--  ── B. 시각 형식 ─────────────────────────────────────────────────────
--     앱은 시각을 JS `new Date().toISOString()` 산출물로 들고 있고(nowIso()), toXML() 이 그 문자열을
--     아무 가공 없이 XML 속성에 그대로 쓴다. 즉 data.xml 안의 모든 시각이 '2026-08-10T02:33:44.123Z' 형태다.
--     (직접 확인한 기록 지점 — 전부 `e.createdAt || ''` 꼴로 원문 대입이다)
--       toXML(): category@createdAt / entry@createdAt·@updatedAt / todo@createdAt·@updatedAt·@completedAt
--         (todo@completedAt 만 `if(t.done && t.completedAt)` 조건부라 속성이 아예 없을 수 있다 → 그때는
--          NULL 로 보낸다. 위 ② 의 completed_at '' 항목과 한 쌍으로 읽을 것 — 없거나 '' 면 NULL,
--          있으면 아래 형식 변환. 부재 처리 전반은 아래 C 를 볼 것.)
--       ※ fromXML() 도 속성이 없으면 nowIso() 로 채운다 — 구파일도 같은 형태가 된다.
--       ※ 루트 @exportedAt 도 같은 형태지만 대응 컬럼이 없다. 저장하지 않는다(대상 목록에 넣지 말 것).
--
--     대상 컬럼은 아래 7개다(DATETIME(3) 10개 중 XML 에서 값이 오는 것 전부. information_schema 로 전수 대조함):
--       cal_category.created_at · cal_category.updated_at   ← updated_at 은 created_at 복사(위 이관 규칙 참조)
--       cal_entry.created_at    · cal_entry.updated_at
--       cal_todo.created_at     · cal_todo.updated_at       · cal_todo.completed_at
--     나머지 3개는 XML 을 안 거치므로 이 계약 대상이 아니다 —
--     cal_schema_meta.updated_at 은 UTC_TIMESTAMP(3) 로 서버가 만들고, cal_user_pref.updated_at 과
--     cal_migration_log.migrated_at 은 이관 도구가 만든다. ★ 단 그 도구가 값을 JS Date 로 만든다면
--     같은 함정을 그대로 밟는다 — 도구도 아래 형식으로 내보낼 것.
--
--     변환 규칙: 'T' 와 'Z' 를 벗겨 `yyyy-MM-dd HH:mm:ss.fff` 로 보낸다. 소수는 **정확히 3자리**.
--
--     실측(8.4.9, STRICT_TRANS_TABLES, SET SESSION time_zone='+00:00'):
--       '2026-08-10T02:33:44.123Z' → ERROR 1292 (Incorrect datetime value)  ← XML 원형 그대로
--       '2026-08-10 02:33:44.123'  → 통과, 저장값 동일                        ← 변환 후
--       '2026-08-10T02:33:44.123'  → 통과 (T 만 남기면 8.4.9 는 받아준다)
--     ★ 1292 를 내는 범인은 'T' 가 아니라 끝의 'Z' 다. 'Z' 만 지워도 당장은 통과하므로 그 반쪽 수정이
--       나오기 쉬운데, 그건 문서화되지 않은 관용 파싱에 기대는 것이다. 두 글자를 모두 벗겨 정규형으로 보낼 것.
--     이관 도구가 XML 속성을 그대로 INSERT 하면 첫 행에서 1292 로 멈추고, 이관은 단일 트랜잭션이라
--     그 사용자의 이관 전체가 롤백된다(위 ② '시끄러운 실패' 와 같은 부류다).
--
--     ★ 소수가 정확히 3자리여야 하는 이유 — 4자리 이상은 1292 가 아니라 '조용히 반올림'된다.
--       실측: '2026-08-10 02:33:44.6789' → 경고 0건으로 통과, 저장값 .679.
--              '2026-08-10 02:33:59.9996' → 저장값 02:34:00.000 (초 경계까지 넘는다).
--       updated_at 은 §3.3 낙관적 잠금 토큰이다. 이관 직후 앱이 자기가 보낸 원문(.6789)을 @prev 로
--       들고 UPDATE 하면 DB 에 있는 값(.679)과 안 맞는다 — 실측으로 확인:
--         UPDATE … AND updated_at='…44.6789' → ROW_COUNT()=0   ← 사용자에게는 '다른 사람이 먼저 고쳤습니다'
--         UPDATE … AND updated_at='…44.679'  → ROW_COUNT()=1
--       즉 아무도 건드리지 않았는데 첫 편집이 전부 충돌로 거부된다. 에러가 아니라 오탐이라 원인 추적이
--       매우 어렵다. 3자리 초과를 만들지 말고, 만들었다면 그 값을 그대로 @prev 로 재사용하지 말 것.
--       (JS toISOString() 은 항상 3자리를 내므로 앱 경로는 안전하다. 위험한 쪽은 다른 언어로 짠 이관 도구다.)
--
--  ── C. 속성 부재 → 파서 기본값 ───────────────────────────────────────
--     toXML() 은 '값이 기본값이면 속성을 아예 쓰지 않는다'(기존 파일과 byte 동일성을 지키려는 설계).
--     그래서 XML 에 속성이 없다는 것은 '값 없음'이 아니라 '기본값'이다. 이관 도구가 XML 속성을
--     그대로 읽어 없으면 NULL 을 넣으면, 그 기본값이 통째로 사라진다.
--
--     ★ 가장 흔한 사고: '매주 반복' 일정은 `<recur freq="weekly"/>` 한 줄로 나간다.
--       toXML() 이 `if((e.recur.interval||1) > 1)` · `if(e.recur.count)` 로 감싸 두었기 때문이다.
--       그대로 읽으면 recur_interval=NULL, recur_count=NULL 이 되고 chk_cal_entry_recur 가 3819 로
--       거부한다. 이관은 단일 트랜잭션이라 그 사용자의 이관 **전체**가 롤백된다.
--       실측(8.4.9): freq='weekly' 만 넣은 INSERT → ERROR 3819 (chk_cal_entry_recur).
--                    정상 행에 UPDATE 로 recur_interval=NULL → 같은 ERROR 3819 (UPDATE 경로도 막힌다).
--                    파서 기본값(interval=1, count=0)을 채워 넣으면 통과.
--       ★ 해소는 CHECK 를 푸는 것이 아니다. 반쪽 반복(전개 로직 무한 루프/0회 반복)을 막는 것이
--         chk_cal_entry_recur 의 존재 이유다. 해소는 **이관 도구가 normRecur() 와 같은 기본값을
--         적용하는 것**이다. CHECK 완화 제안이 나오면 이 줄을 근거로 거절할 것.
--
--     전수 목록 — toXML() 에서 `if(...)` 로 감싼 setAttribute / 조건부 자식 요소 전부.
--     대응 컬럼이 있는 것만 적는다(gitRepo·svnRepo·prefs·attendance·dbGone·lsMigrated 는 §4 로 제외).
--       XML(부재 시)                    → 컬럼                          → 넣을 값(파서 기본값)
--       ------------------------------------------------------------------------------------
--       recur@interval                    cal_entry.recur_interval        1        ← ★ NOT NULL 아님에도 CHECK 가 요구
--       recur@count                       cal_entry.recur_count           0        ← ★ 같은 CHECK
--       recur@until                       cal_entry.recur_until           NULL     (A 와 동일 처리)
--       <recur> 요소 자체 부재            recur_freq/interval/until/count 전부 NULL (= 반복 없음)
--       entry@source                      cal_entry.source                ''       ← NOT NULL. NULL 이면 ERROR 1048
--       entry@location                    cal_entry.location              ''       ← NOT NULL. NULL 이면 ERROR 1048
--       entry@categoryId                  cal_entry.category_id           NULL
--       entry@remind                      cal_entry.remind                NULL     (normRemind() 가 null)
--       entry@endDate                     cal_entry.end_date              NULL
--       entry 의 <title> 부재/빈값        cal_entry.title                 '(제목 없음)'  ← NOT NULL
--       entry 의 <memo> 부재              cal_entry.memo                  ''       ← NOT NULL
--       commit@hash                       cal_entry_commit.hash           ''       ← NOT NULL
--       commit@short                      cal_entry_commit.short_hash     ''       ← NOT NULL
--       commit@time                       cal_entry_commit.commit_time    NULL     (A 와 동일 처리)
--       commit@subject 부재(구 포맷)      cal_entry_commit.subject        요소 textContent ← NOT NULL. 구 XML 은 제목이 본문 자리에 있다
--       commit textContent 없음           cal_entry_commit.body           ''       ← NOT NULL
--       todo@prio                         cal_todo.prio                   'normal' ← NOT NULL. NULL 이면 ERROR 1048
--       todo@due / todo@endDate           cal_todo.due / .end_date        NULL
--       todo@completedAt                  cal_todo.completed_at           NULL
--       todo 의 <note> 요소 부재          cal_todo.note                   ''       ← NOT NULL
--       todo 의 <dayNotes> 요소 부재      cal_todo_day_note               행 없음
--       category@source                   cal_category.source             'local'  ← NOT NULL. NULL 이면 ERROR 1048
--       category 의 <name> 부재/빈값      cal_category.name               '(이름 없음)' ← NOT NULL
--       category 의 <description> 부재    cal_category.description        ''       ← NOT NULL
--       root@gitAuthor                    cal_user_pref.git_author        ''       ← NOT NULL
--       root@svnAuthor                    cal_user_pref.svn_author        gitAuthor 값을 복사 ← ★ ''가 아니다(구버전 1회 마이그레이션)
--       entry/todo 의 @createdAt·@updatedAt 부재  각 표의 created_at·updated_at  이관 시각(UTC) — 파서도 nowIso() 로 채운다
--         ※ cal_category.updated_at 은 예외다 — XML 에 그 속성이 아예 없으므로 '부재'가 아니라
--           '원본 없음'이고, created_at 을 복사한다(아래 1. cal_category 의 이관 규칙이 정본).
--       <taskHours> 요소 부재             cal_task_hours                  행 없음
--
--     ※ 실측(8.4.9, STRICT): 위 'NOT NULL' 표시 컬럼에 NULL 을 넣으면 전부 ERROR 1048
--       (cal_entry.memo·source·location, cal_entry_commit.hash, cal_todo.prio, cal_category.source 로 확인).
--       즉 이 부류는 대체로 '시끄럽게' 실패한다 — 조용히 틀리는 것은 recur 두 컬럼(3819 로 전체 롤백)과
--       svn_author(''로 채우면 구버전 사용자의 SVN 수집 대상이 조용히 '전체'로 바뀐다) 쪽이다.
--
--     ※ 한 건만 '파서 기본값 그대로'가 자동 정답이 아니다 — `<rooms>` 요소 부재(구버전 XML).
--       파서는 DEFAULT_ROOMS 3개를 주입하는데, cal_room 의 계약은 '행 0개 = 빈 목록'이다(아래 7. 참조).
--       이관 도구는 파서 쪽(DEFAULT_ROOMS 주입)을 따르고 그 사실을 보고한다 — 이관 직후 사용자가
--       보던 목록이 사라지면 '데이터가 없어졌다'로 보이고, 반대 방향(원치 않는 3개가 생김)은
--       사용자가 지울 수 있기 때문이다. `<rooms>` 가 있는 파일은 빈 목록도 그대로 존중한다.
--
--     ※ undefined ↔ 'local' (cal_category.source) 의 반대 방향: 앱은 개인 과제에 source 키를 만들지
--       않는다(코드 전역에 'local' 문자열 0건). DB 표기를 정본으로 삼되, DB→XML 재생성 시 'local' 이면
--       속성을 쓰지 않아 byte 동일성을 지킨다.
--
--  ── ★ 이관이 버리는 XML 속성 — entry@hours (대응 컬럼 없음. 오류가 아니다) ──────
--     data.xml 에는 지금도 <entry hours="120"> 이 들어 있다(toXML 이 여전히 쓴다). 그런데 DB 에는
--     그 값을 받을 컬럼이 없다 — 2026-08-11 결정으로 cal_entry.hours_min 을 폐지했기 때문이다.
--     근거: 그 값을 채우는 UI 도 자동계산도 없었고, 소비처는 연구노트용 캘린더 md 의 「일정」 줄
--       ('· 2시간' 표기) 하나뿐이었다. 과제별 분 합계는 계산만 하고 읽는 코드가 없었고 회사(netcus)
--       일간보고에도 들어가지 않는다. 공수의 단일 소스는 cal_task_hours(날짜×과제) 하나다.
--     ★ 계약: 이관 도구는 entry@hours 를 **읽지 않고 그냥 버린다.** 건수 보고도 필요 없다.
--       이 줄이 없으면 도구가 '대응 컬럼이 없다'며 멈추거나, 사람이 컬럼을 다시 만든다.
--       (루트 @exportedAt 과 같은 부류다 — 위 B 의 ※ 참조. 대상 목록에 넣지 말 것)
--     ※ 되살릴 조건: 일정 단위 공수를 실제로 입력·소비하는 화면이 생기면 그때 컬럼을 다시 만들고
--       cal_task_hours 와의 단위 차이(분 vs 시간)를 먼저 정할 것. 그때까지는 만들지 않는다.
--
--  ── D. 불리언 문자열 'true'/'false' → 1/0 ────────────────────────────
--     toXML() 은 두 값을 **문자열**로 쓴다: `el.setAttribute('allDay', e.allDay ? 'true' : 'false')` 와
--     todo 의 같은 꼴 `done`. 대상 컬럼은 TINYINT(1) NOT NULL 이다.
--     전수 확인: 스키마의 TINYINT 컬럼은 정확히 이 둘뿐이다(information_schema 로 대조).
--       cal_entry.all_day ← entry@allDay      cal_todo.done ← todo@done
--       (dbGone·lsMigrated·gitCommitBody 도 불리언이지만 '1' 표기이고 대응 컬럼이 없다 — 대상 아님)
--     실측(8.4.9, STRICT): all_day='true' → ERROR 1366, done='false' → ERROR 1366.
--     ★ 그런데 이 부류는 IGNORE 와 만나면 '조용히 틀린 값'이 된다 — 아래를 볼 것.
--
--  ── ★ 이관 INSERT/UPDATE 에 IGNORE 를 쓰지 말 것 ────────────────────
--     위 A~D 의 안전 논리는 전부 '실패가 시끄럽다(1292·1366·1406·1452·3819 로 멈추고 단일 트랜잭션이라
--     전체 롤백되니 사람이 알아챈다)'에 기대고 있다. IGNORE 는 그 전제를 통째로 무너뜨린다.
--     실측(8.4.9, STRICT_TRANS_TABLES, --show-warnings):
--       INSERT IGNORE + chk_cal_entry_recur 위반 → ERROR 가 아니라 Warning 3819, **그 행만 사라지고**
--         트랜잭션은 정상 COMMIT. 같은 문장에 정상 행 2건 + 위반 행 1건을 넣으면 정상 2건만 남았다.
--       UPDATE IGNORE 로 정상 행을 반쪽 반복으로 깨뜨리기 → Warning 3819, 행은 옛 값 그대로(변경 무시).
--       INSERT IGNORE + all_day='true'(D 부류) → Warning 1366 인데 **행은 들어가고 all_day=0 이 된다**.
--         즉 '하루 종일'이 '하루 종일 아님'으로 조용히 뒤집힌다. 이게 가장 나쁜 경우다.
--     → 이관 도구는 IGNORE 없이 INSERT/UPDATE 하고, 첫 오류에서 롤백한 뒤 사람에게 보고한다.
--     ※ 이 파일 맨 아래 cal_user_rev 시딩의 `INSERT IGNORE` 와 혼동하지 말 것. 그쪽은 목적이 다르다 —
--       무시 대상이 CHECK 위반이 아니라 '이미 있는 PK(ERROR 1062)' 하나이고, 재실행 가능성이 요구사항이며,
--       무시된 행은 '이미 올바른 값이 들어 있는 행'이다. 이관에서 무시되는 행은 '데이터가 사라진 행'이다.
--
--  ── E. 파생 컬럼 — XML 에 원본이 없다. 어댑터가 '만들어' 넣는다 ──────────
--     A~D 는 전부 'XML 의 값을 어떻게 바꿔 넣나' 였다. 이 부류는 다르다 — XML 에 대응하는 것이
--     아예 없고, 어댑터가 문맥에서 계산해야 한다. 그래서 A~D 를 다 지켜도 여기서 조용히 틀린다.
--       컬럼                         XML 의 원본            안 채우면
--       ---------------------------------------------------------------------------------
--       cal_category.sort_order      <category> 문서 순서    ★ 조용히 전 행 0 → 표시 순서 영구 소실
--       cal_room.sort_order          <room> 문서 순서        ★ 조용히 전 행 0 → 회의실 순서 영구 소실
--       cal_entry_commit.seq         commits 배열 인덱스     ERROR 1364 (시끄럽게 실패)
--
--     ★ 위험한 것은 sort_order 둘이다. NOT NULL **DEFAULT 0** 이라 안 채워도 INSERT 가 성공한다 —
--       오류도 경고도 없고 CHECK 도 게이트도 못 잡는다. 값이 '틀린' 게 아니라 '전부 같은' 상태가
--       되기 때문이다. 실측(8.4.9): sort_order 를 뺀 3행 INSERT → 성공, 세 행 모두 0.
--     ※ seq 는 다르다 — NOT NULL 이면서 **DEFAULT 가 없어** STRICT 에서 그 자리에 1364 로 멈춘다
--       (실측: seq 를 뺀 커밋 2건 INSERT → ERROR 1364 "Field 'seq' doesn't have a default value").
--       PK 충돌(1062)로 2건째에 걸리는 게 아니라 1건째부터 못 들어간다. 시끄러워서 안전한 쪽이다.
--       ※ 이 차이를 DEFAULT 로 메우려 하지 말 것 — sort_order 에서 DEFAULT 0 을 빼면 '순서 없음'을
--         표현하던 기존 행과 ALTER 백필이 전부 깨진다(설계 §5.5 의 '추가 컬럼은 DEFAULT 필수' 규칙).
--         조용한 쪽은 DB 가 아니라 계약과 §8 서명으로 막는다.
--       설계 §5.3 이 이 컬럼을 둔 이유가 그거다 — 화면 순서는 배열 순서인데 created_at 이 대부분
--       같은 밀리초라(실측 37개 중 33개) 대체할 수단이 없다. 안 채우면 이관 순간 순서가 사라지고,
--       사용자는 '순서가 뒤죽박죽'으로만 느낀다. 원본이 없으니 사후 복구도 안 된다.
--     ※ 규칙: 문서에 나타난 순서대로 0,1,2… (건너뛰지 말 것 — 앱은 값의 크기가 아니라 정렬 결과만 본다).
--       seq 도 0-base 로 commits 배열 인덱스 그대로.
--     ※ 이 부류는 §8 의 이관 왕복 서명에 반드시 포함시킬 것. 서명에서 빠지면 순서가 통째로
--       뒤집혀도 게이트가 초록불을 낸다(설계 §8 이 카테고리 서명에 sort_order 를 넣은 이유).
--
--  ── F. 파서가 '버리는' 값 — XML 에 있는데 앱은 안 만드는 것 ──────────────
--     C 는 '속성이 없을 때' 였고 이건 정반대다 — 속성이 **있는데** fromXML() 이 그 항목을 버린다.
--     그대로 넣으면 앱이라면 존재하지 않았을 행이 DB 에 생긴다. DB 는 대체로 막지 못한다.
--
--       XML 에 있는 것                     fromXML() 의 처리            그대로 넣으면
--       ---------------------------------------------------------------------------------
--       <text> 가 빈 <todo>                `.filter(t => t.text)`       cal_todo 에 todo_text='' 행.
--                                          항목 자체를 폐기              CHECK 없음 → 통과. 유령 할일
--       due 범위 밖 <dayNote>              normalizeTodoDayNotes() 가   cal_todo_day_note 에 부모 기간
--       (date < due 또는 > endDate)        탈락시킴                      밖 행. DB 로는 표현 불가한 제약
--       due 가 아예 없는 todo 의 dayNote   같은 함수가 전부 버림         같은 유령 행
--       중복 <room> 이름 / 41자 이상       normRooms(): 공백축약·trim·   중복은 PK 가 1062 로 막지만
--       / 51개째부터                       40자 절단·중복 제거·50개 상한  절단·상한은 DB 가 안 막는다
--                                                                        (41자는 STRICT 에서 1406)
--       중복 <except date>                 dedup 안 함(A 부류 아님)      PK(login_id,entry_id,except_date)
--                                                                        가 1062 → 이관 전체 롤백
--
--     ★ 계약: 이관 도구와 런타임 저장은 **fromXML() 을 통과한 결과만** DB 에 넣는다. XML 을 직접
--       파싱해 INSERT 하지 말 것. 그러면 이 부류가 통째로 해소된다(파서가 이미 다 버렸으므로).
--       그게 불가능한 도구라면 위 다섯 줄을 손으로 구현하고, 버린 건수를 사람에게 보고할 것.
--     ※ 왜 '보고'가 필요한가: 버리는 게 정상이지만 '몇 개를 버렸는지'는 사용자가 알아야 한다.
--       빈 할일 200개를 조용히 버리면 '이관에서 데이터가 샜다'는 의심을 나중에 못 푼다.
--
--  값 집합이 고정된 문자열 컬럼은 COLLATE utf8mb4_bin 이다(테이블 기본 utf8mb4_0900_ai_ci 상속 금지).
--     실측: ai_ci 는 대소문자뿐 아니라 전각/반각까지 같게 본다. 'DB'·'Db'·전각 'ｄｂ' 가 CHECK 를
--     전부 통과하고 입력 그대로 저장됐다. 앱은 `source === 'db'` 로 정확 비교하므로 그런 행은
--     조용히 개인 과제로 취급된다. 대상: cal_category.source · cal_entry.source · cal_entry.recur_freq ·
--     cal_todo.prio · cal_schema_meta.k/v.
--     ※ color · recur_until 은 REGEXP CHECK 라 이미 폭에 안전하다(실측: 전각 입력 ERROR 3819).
--       대소문자는 색상 표기가 원래 양쪽을 허용하므로(앱 /^#[0-9a-fA-F]{6}$/) 의도된 통과다 → _bin 불필요.
--
--  이 파일에 없는 것: 앱 계정 GRANT(create-app-user.sql / grants-calendar.sql 계열). 별도 파일이다.
--  ★ 감사 트리거(trg_cal_*)와 cal_audit_trash 는 2026-08-11 결정으로 폐지됐다. 이 스키마에는
--     트리거가 하나도 없어야 한다 — init-calendar.ps1 의 게이트가 'cal_* 트리거 0개'를 확인한다.
--     되살릴 자리는 이 DB 가 아니라 API 서버 계층이다(같은 DB 안의 휴지통은 그 DB 가 죽으면 함께 죽는다).
--  ★ cal_schema_meta 는 앱 계정에 SELECT 만 주어야 한다(§5.5) — 앱이 버전 행을 올릴 수 있으면
--     '낡은 클라이언트 차단'이 성립하지 않는다. 그 부여의 단일 소스는 grants-calendar.sql 이다.
--     ※ 여기에 그 파일의 '현재 상태'(있다/없다)를 적지 않는다. 한때 "지금은 그 GRANT 가 없다" 고
--       적혀 있었는데 그 사이 추가돼 이 파일만 거짓말을 하고 있었다. 다른 파일의 상태는 그 파일에서
--       확인한다 — 배포 후 확인 절차는 grants-calendar.sql 꼬리의 검증 쿼리 4b) 가 갖고 있다.
-- =====================================================================
SET NAMES utf8mb4;

-- ---------- 멱등 재구축용 DROP — 자식(FK 참조하는 쪽) → 부모 순 ----------
-- 위 경고를 다시 읽을 것. 이 13줄이 캘린더 데이터 전량을 지운다.
--
-- ★ 폐지된 표도 지운다. cal_audit_trash 는 감사 트리거와 함께 폐기됐지만(설계 §7.5),
--   그 전에 이 키트를 한 번이라도 돌린 DB 에는 실물이 남아 있다. '안 만든다'만으로는
--   사라지지 않는다 — 지우는 문장이 없으면 고아 표로 살아남아 DB 의 cal_* 가 13개가 되고,
--   문서·GRANT·게이트는 전부 12를 정본으로 삼아 서로 어긋난다.
--   지운 뒤 다시 만들지 않으므로 이 줄은 영구히 남는다(재적용마다 무해하게 반복).
DROP TABLE IF EXISTS cal_audit_trash;   -- 폐지(§7.5). 옛 배포분 정리용 — 재생성하지 않는다
DROP TABLE IF EXISTS cal_schema_meta;   -- FK 없음 — 순서 무관
DROP TABLE IF EXISTS cal_migration_log;
DROP TABLE IF EXISTS cal_user_rev;
DROP TABLE IF EXISTS cal_user_pref;
DROP TABLE IF EXISTS cal_task_hours;
DROP TABLE IF EXISTS cal_room;
DROP TABLE IF EXISTS cal_todo_day_note;      -- cal_todo 를 참조
DROP TABLE IF EXISTS cal_todo;
DROP TABLE IF EXISTS cal_entry_commit;       -- cal_entry 를 참조
DROP TABLE IF EXISTS cal_entry_except;       -- cal_entry 를 참조
DROP TABLE IF EXISTS cal_entry;              -- cal_category 를 참조
DROP TABLE IF EXISTS cal_category;

-- =====================================================================
--  1. cal_category — 과제(카테고리)
-- =====================================================================
-- 개인 과제와 공식(DB project 유래) 과제를 source 로 갈라 한 테이블에 담는다(§6).
-- gitRepo/svnRepo 는 §4 로 제외, db_gone 은 조회 시 LEFT JOIN project 로 파생하므로 컬럼이 없다.
CREATE TABLE cal_category (
  login_id     VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,  -- 소유자 login_id (app_user.login_id). 불변 — 개명은 db/deploy/rename-login-id.sql 절차
  id           VARCHAR(80)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin        NOT NULL,  -- 과제 id. 개인=c-<uuid>(38자), 공식=db-<project.uid>(39자). 대소문자 구분
  -- 값 집합이 고정된 컬럼이라 _bin 이다. 테이블 기본(0900_ai_ci)을 상속하면 'DB'·'Db'·전각 'ｄｂ' 가
  -- CHECK 를 통과해 그대로 저장되고, 앱의 `source === 'db'` 정확 비교에서 개인 과제로 오분류된다(실측).
  source       VARCHAR(8)   CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT 'local', -- 과제 출처. local=개인 과제, db=공식 과제. XML 속성 부재가 local 에 대응
  -- 폭 200 의 근거: 공식 과제명은 project.common_name/project_name(둘 다 VARCHAR(200))에서 온다(mapDbRows()).
  -- 개인 과제는 폼 #cName maxlength=60. 두 생산 경로 모두 200 이하다.
  -- ★ 다만 fromXML() `name: txt(c,'name')` 에는 절단이 없다 — 사람이 손으로 고친 XML 만 초과할 수 있고,
  --   그때는 ERROR 1406 으로 이관 전체가 롤백된다. 이관 도구가 사전 스캔으로 사람에게 먼저 보여줄 것.
  name         VARCHAR(200) NOT NULL,                                                   -- 과제명. 공식 과제도 저장(소프트삭제 시 라벨 스냅샷 폴백)
  color        CHAR(7)      NOT NULL DEFAULT '#5b6b7d',                                 -- 과제 색 #rrggbb. 공식 과제도 색은 사용자 소유. REGEXP CHECK 라 _bin 불필요(전각은 이미 3819, 대소문자는 의도적 허용)
  description  VARCHAR(200) NOT NULL DEFAULT '',                                        -- 과제 설명. 폼 #cDesc maxlength=200 과 정확히 같다(fromXML 절단 없음 — name 과 같은 단서)
  -- ★ 값의 출처 = id 접두 제거. XML 에 대응 속성이 전혀 없어 이관 도구가 파생해야 한다(§8).
  --   규칙: source='db' 이면 project_uid = SUBSTRING(id, 4).
  --   단 id 가 'db-' 로 시작하고 나머지가 정확히 36자일 때만(공식 과제 id 는 'db-'+project.uid, mapDbRows()).
  --   조건에 안 맞는 source='db' 행은 조용히 버리지 말고 이관 도구가 사람에게 보고하고 중단한다(§8 "버리지 않는다").
  --   왜 중단인가: fromXML 의 safeId(/^[A-Za-z0-9_-]{1,80}$/)가 id 를 재발급하면 접두가 사라져
  --   복원 근거가 영구 소실되는데, 그 상태로 넣으면 아래 chk_cal_category_projuid 가 3819 를 내고
  --   그 과제에 달린 일정·공수까지 함께 이관이 막힌다. 사람이 원본 XML 을 보고 정해야 하는 문제다.
  project_uid  CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL, -- 공식 과제가 가리키는 project.uid. FK 걸지 않음(§5.2). 콜레이션은 project.uid 와 일치해야 조인 가능
  sort_order   INT          NOT NULL DEFAULT 0,                                         -- 화면 표시 순서. XML 문서 순서를 박제한 유일한 근거
  created_at   DATETIME(3)  NOT NULL,                                                   -- 생성 시각(UTC). 앱이 계산해 보낸다
  -- ★ 이관 규칙: updated_at = created_at 을 그대로 복사한다(원본이 없다).
  --   근거: toXML 의 category 직렬화(4540-4558)에 updatedAt 속성이 없고 fromXML(4715-4736)이 만드는
  --   객체에도 updatedAt 키가 없다. NOT NULL 무DEFAULT 라 이관 INSERT 가 그 자리에서 ERROR 1364 로 멈춘다.
  --   왜 '이관 시각'이 아닌가: 그러면 전 사용자의 모든 과제가 '방금 수정됨'이 되어, 부팅 직후 사용자가
  --   들고 있는 @prev 와 어긋나 첫 편집이 전부 낙관적 잠금 충돌 오탐이 된다.
  updated_at   DATETIME(3)  NOT NULL,                                                   -- 수정 시각(UTC). 낙관적 잠금 토큰 — 서버 자동 갱신 없음
  PRIMARY KEY (login_id, id),
  KEY ix_cal_category_login_sort (login_id, sort_order),
  CONSTRAINT fk_cal_category_user FOREIGN KEY (login_id) REFERENCES app_user(login_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,                 -- 사람이 지워질 때 캘린더가 조용히 사라지면 안 된다(퇴사 처리는 app_user.is_active=0)
  -- ★ 이 제약은 아래 chk_cal_category_projuid 에 포섭되어 단독 발화하지 않는다 — source 가 두 값이 아니면
  --   projuid 쪽 두 분기가 먼저 모두 FALSE 가 되기 때문이다. 잘못된 source 는 실제로 'chk_cal_category_projuid'
  --   위반으로 보고된다(실측). 장애 대응 때 project_uid 문제로 오진하지 말 것.
  CONSTRAINT chk_cal_category_source  CHECK (source IN ('local','db')),
  CONSTRAINT chk_cal_category_color   CHECK (color REGEXP '^#[0-9a-fA-F]{6}$'),
  -- 공식 과제인데 project_uid 가 없으면 §6 의 LEFT JOIN 이 항상 db_gone 을 뱉는다. 반대로 개인 과제에
  -- project_uid 가 붙으면 남의 과제명을 끌어다 쓰게 된다. 두 방향을 다 막는다.
  CONSTRAINT chk_cal_category_projuid CHECK ((source = 'db'    AND project_uid IS NOT NULL)
                                          OR (source = 'local' AND project_uid IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='캘린더 과제(카테고리). source=local(개인)/db(공식). PK=(login_id,id), id 는 utf8mb4_bin.';

-- =====================================================================
--  2. cal_entry — 일정
-- =====================================================================
-- XML <entry> 대응(반복 규칙은 recur_* 컬럼으로 평탄화).
-- §3.3 낙관적 잠금의 기준 행이자 except/commit 자식의 잠금 단위.
CREATE TABLE cal_entry (
  login_id       VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,        -- 소유자 login_id
  id             VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin        NOT NULL,        -- 일정 id. 반복 일정의 시리즈 id 로도 쓰임. e-<uuid>(38자)
  -- NULL = 미분류. 앱은 '' 를 만들지 않는다(전 경로 `|| null`) — 헤더 ③ 참조.
  -- ★ 단 fromXML 은 실재하지 않는 과제 id 를 그대로 남긴다. DB 는 아래 FK 로 1452 를 내므로
  --   이관 도구가 사전에 '실재하지 않는 category_id → NULL' 정리를 하고 건수를 보고해야 한다.
  category_id    VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL,      -- 소속 과제. NULL = 미분류
  entry_date     DATE         NOT NULL,                    -- 시작일(반복이면 시리즈 기준일). 파서가 실재 날짜만 통과시키므로 DATE 안전
  end_date       DATE         NULL DEFAULT NULL,           -- 기간 일정 종료일(포함). 단일일이면 NULL. 반드시 entry_date 보다 커야 함
  all_day        TINYINT(1)   NOT NULL DEFAULT 0,          -- 하루 종일 일정 여부. 1이면 시각 두 개가 모두 NULL 이어야 함
  start_time     TIME         NULL DEFAULT NULL,           -- 시작 시각 HH:mm. 앱의 '' 는 반드시 NULL 로 변환 — ''를 그대로 보내면 00:00:00 으로 무음 오염
  end_time       TIME         NULL DEFAULT NULL,           -- 종료 시각 HH:mm. '' ↔ NULL 매핑 규칙 동일
  -- 폭 재판정(§5.3 '실측 최대가 아니라 코드가 허용하는 상한 이상'): VARCHAR(2000) → MEDIUMTEXT.
  -- 근거: 폼 #fTitle/#qaTitle 은 maxlength=200 이지만 그건 사람 입력만 막는다. git 수집 경로는
  --   커밋 1건짜리 엔트리의 제목에 커밋 subject 를 그대로 넣고(setBulkRange()), normCommits()는
  --   공백 축약·trim 만 할 뿐 절단이 없다(저장소 전체에 slice(0,2000) 0건). 즉 코드상 상한이 없다.
  -- ★ TEXT 가 아니라 MEDIUMTEXT 인 이유(memo/note/body 와 같은 판정을 받는 이유):
  --   이 컬럼은 cal_entry_commit.subject 를 그대로 받는다(커밋 1건짜리 엔트리). 두 컬럼의 상한이 다르면
  --   같은 문자열이 한쪽만 통과하는 상태가 되고, 그건 근거 없이 갈린 것이다. 네 컬럼(title·subject·
  --   memo·body) 모두 '코드상 상한 0' 이라는 같은 근거를 가지므로 같은 타입이어야 한다.
  --   한때 title·subject 만 TEXT 로 남아 있었는데, 그건 판정을 안 한 것이지 다르게 판정한 것이 아니었다.
  -- 왜 지금 고치는가: 이관은 단일 트랜잭션이라 긴 제목 한 건이 그 사용자의 이관 전체를 롤백시키고(1406),
  --   이관 후에도 그 사용자는 커밋 수집을 할 때마다 저장이 실패한다. 근본 해법은 앱에 slice(0,2000)를
  --   넣는 것이지만 그건 이 파일 범위 밖이다 — 앱이 상한을 갖게 되면 그때 네 컬럼을 함께 되돌릴 것.
  title          MEDIUMTEXT   NOT NULL,                    -- 일정 제목. git 단일 커밋 엔트리는 커밋 제목(subject)이 그대로 들어온다
  -- 폭 재판정: TEXT(65,535바이트 ≈ 한글 21,845자) → MEDIUMTEXT. 메모 textarea(#fMemo / #qaMemo)에
  --   maxlength 가 없어 로그 붙여넣기로 실제 도달 가능한 경계다. '앱에 상한이 없어 TEXT' 는 근거가 거꾸로였다.
  memo           MEDIUMTEXT   NOT NULL DEFAULT (''),       -- 메모(여러 줄). 앱에 길이 상한이 없다
  source         VARCHAR(8)   CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',   -- 엔트리 출처. git=커밋에서 자동 생성, ''=사용자 일정. _bin 인 이유는 헤더 참조('GIT'·전각 'ｇｉｔ' 차단)
  -- ※ 일정 단위 공수(옛 hours_min)는 컬럼이 없다. 2026-08-11 결정 — 공수는 cal_task_hours 하나로
  --   단일화했다. XML 의 entry@hours 는 버린다(헤더 '★ 이관이 버리는 XML 속성' 참조).
  location       VARCHAR(200) NOT NULL DEFAULT '',         -- 장소(회의실 등). 앱이 200자로 절단
  remind         SMALLINT UNSIGNED NULL DEFAULT NULL,      -- 알림 리드타임(분). NULL=기본 사다리 60/30/10/5, 0=알림 없음, n=n분 전 1회
  recur_freq     VARCHAR(8)   CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL,     -- 반복 주기. NULL=반복 없음. weekly/monthly 두 값뿐. _bin — 'WEEKLY'·전각 'ｗｅｅｋｌｙ' 가 통과하면 앱의 freq==='weekly' 분기가 조용히 빗나간다
  recur_interval INT UNSIGNED NULL DEFAULT NULL,           -- 반복 간격(N주/N개월). 반복이 있으면 1 이상 필수
  recur_until    CHAR(10)     NULL DEFAULT NULL,           -- 반복 종료일 YYYY-MM-DD. ★DATE 아님 — 파서가 형식만 검사해 2026-02-31 같은 값이 실재하므로 문자열로 보존
  recur_count    INT UNSIGNED NULL DEFAULT NULL,           -- 반복 횟수 제한. 0=제한 없음
  created_at     DATETIME(3)  NOT NULL,                    -- 생성 시각(UTC)
  updated_at     DATETIME(3)  NOT NULL,                    -- 수정 시각(UTC). 낙관적 잠금 토큰 — 자식 테이블 변경 시에도 같은 트랜잭션에서 올린다
  PRIMARY KEY (login_id, id),
  KEY ix_cal_entry_login_date (login_id, entry_date),      -- 월/주 화면 조회
  KEY ix_cal_entry_login_cat  (login_id, category_id),     -- 과제별 조회 + 아래 복합 FK 의 자식 인덱스
  CONSTRAINT fk_cal_entry_user FOREIGN KEY (login_id) REFERENCES app_user(login_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- 부모(과제) 방향은 RESTRICT — 과제를 지우면 그 일정도 같이 사라지는 게 아니라, 앱이 먼저
  -- 일정의 category_id 를 정리하도록 강제한다(CASCADE/RESTRICT 혼동이 사고의 원인이었다).
  CONSTRAINT fk_cal_entry_category FOREIGN KEY (login_id, category_id) REFERENCES cal_category(login_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_cal_entry_source   CHECK (source IN ('','git')),
  CONSTRAINT chk_cal_entry_allday01 CHECK (all_day IN (0,1)),
  -- 아래 3개의 NULL 통과는 전부 '의도'다(NULL 이 곧 정상 상태를 뜻한다). 식이 NULL 을 낳지 않도록
  -- 나머지 항은 NOT NULL 컬럼이거나 IS NULL 판정이라, chk_cal_entry_recur 가 겪은 무음 통과가 없다.
  CONSTRAINT chk_cal_entry_enddate  CHECK (end_date IS NULL OR end_date > entry_date),          -- end_date NULL = 단일일 일정
  CONSTRAINT chk_cal_entry_allday   CHECK (all_day = 0 OR (start_time IS NULL AND end_time IS NULL)),  -- 시각 NULL = '시각 없음'(종일 일정의 정상 상태)
  CONSTRAINT chk_cal_entry_remind   CHECK (remind IS NULL OR remind BETWEEN 0 AND 10080),       -- NULL = 기본 사다리(60/30/10/5). 0 = 알림 없음
  -- 반복은 '전부 NULL' 이거나 '주기+간격+횟수가 갖춰진' 두 상태만 허용한다. 반쪽짜리 반복이 들어오면
  -- 전개 로직이 무한 루프거나 0회 반복이 된다.
  -- ★ IS NOT NULL 을 반드시 명시해야 한다. MySQL CHECK 는 결과가 FALSE 일 때만 거부하고 NULL(UNKNOWN)이면
  --   통과시킨다. 명시하기 전 식은 첫 분기 FALSE · 둘째 분기 NULL → 'FALSE OR NULL = NULL' 로 전부 통과했다
  --   (실측: freq만/freq+interval/interval만/freq+count/until만/count만 6종 전부 성공, UPDATE 로 정상 행을
  --   반쪽으로 깨뜨리는 경로도 무저항). 방어가 있는 것처럼 보이면서 검증이 0인 상태였다.
  -- recur_count 를 NOT NULL 로 요구하는 근거: normRecur()가 `count:(cn>0?cn:0)` 으로 항상 정수를
  --   만들고 0=제한 없음이다. 즉 앱에 '횟수 미정' 상태가 존재하지 않는다. recur_until 만 선택값이다.
  -- ★ recur_freq 에도 IS NOT NULL 이 필요하다. 이 한 줄이 없으면 UPDATE 로 freq 만 NULL 로 만드는 경로가
  --   그대로 통과한다(실측: freq=NULL, interval=2, count=0 → 둘째 분기가 'NULL AND TRUE…' = NULL → 통과).
  --   INSERT 만 시험하면 안 보인다 — 그때는 interval/count 도 함께 NULL 이라 IS NOT NULL 이 FALSE 를 만들어
  --   막히기 때문이다. 세 개를 모두 명시해야 식이 UNKNOWN 을 내지 않는다.
  CONSTRAINT chk_cal_entry_recur    CHECK ((recur_freq IS NULL AND recur_interval IS NULL AND recur_count IS NULL AND recur_until IS NULL)
                                        OR (recur_freq     IS NOT NULL AND recur_freq IN ('weekly','monthly')
                                            AND recur_interval IS NOT NULL AND recur_interval >= 1
                                            AND recur_count    IS NOT NULL AND recur_count    >= 0)),
  -- NULL 통과는 의도다 — recur_until NULL = '종료일 없는 반복'. 반복 자체가 없는데 until 만 있는 조합은
  -- 위 chk_cal_entry_recur 의 '전부 NULL' 분기가 막는다(둘이 한 쌍으로만 성립한다).
  -- 전각 숫자('２０２６-…')는 REGEXP 가 이미 막는다(실측 3819) — ai_ci 라도 REGEXP 는 폭을 접지 않는다.
  CONSTRAINT chk_cal_entry_until    CHECK (recur_until IS NULL OR recur_until REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  -- git 수집 엔트리는 특정 날짜의 커밋 묶음이라 기간·반복이라는 개념 자체가 없다. 재수집이 [from,to]
  -- 범위를 통째로 지우고 다시 넣기 때문에, 기간/반복이 섞이면 무엇을 지울지가 정의되지 않는다.
  -- source 는 NOT NULL 이고 나머지 두 항은 IS NULL 판정이라 이 식은 NULL 을 낳지 않는다(항상 TRUE/FALSE).
  CONSTRAINT chk_cal_entry_git      CHECK (source <> 'git' OR (end_date IS NULL AND recur_freq IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='일정. 반복 규칙은 recur_* 로 평탄화. updated_at=낙관적 잠금 토큰(앱이 UTC 대입).';

-- =====================================================================
--  3. cal_entry_except — 반복 일정의 예외일(삭제된 회차)
-- =====================================================================
-- XML <recur><except> 대응. 날짜 자체가 값이라 UPDATE 개념이 없다(추가/삭제만).
CREATE TABLE cal_entry_except (
  login_id    VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,  -- 소유자 login_id (부모에서 전파)
  entry_id    VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin        NOT NULL,  -- 부모 일정 id
  except_date DATE NOT NULL,                                                          -- 건너뛸 발생 시작일. 파서가 실재 날짜만 통과시킴
  -- 중복 예외일은 의미가 없다(같은 날짜를 두 번 건너뛰어도 결과가 같다). 그래서 PK 로 못 박았고, 중복이
  -- 들어오면 ERROR 1062 다. ★ 이건 이관 전용 문제가 아니다 — 런타임 저장 경로도 같은 1062 를 맞는다.
  -- → 계약: **어댑터가 저장 직전 항상 dedup 한다**(이관 도구도 같은 함수를 쓴다). '이관 도구가 사전에
  --   제거한다'로는 부족하다. 아래가 직접 읽고 확인한 근거다(task-calendar-prototype.html):
  --     · append 지점 2곳 모두 `includes` 가드가 없다 — 있는 값을 그대로 다시 붙인다:
  --         bind() 의 캘린더 '이 날짜만 삭제' : e.recurExcept = [...(e.recurExcept||[]), occDate]
  --         bind() 의 보고서 '이 날짜만 삭제' : e.recurExcept = [...(e.recurExcept||[]), from]
  --       ★ 보고서 쪽 `from` 은 그 발생일이 아니라 $('#rptFrom').value(보고 기간 시작일)라, 주간 보고에서
  --         같은 반복 일정의 서로 다른 행을 두 번 지우면 **같은 문자열이 두 번 들어간다**.
  --         (코드 경로로 확인. 브라우저로 재현해 보지는 않았다 — 미확인.)
  --     · 정규화 경로 3곳은 전부 '형식 필터'일 뿐 dedup 이 없다:
  --         load()       .filter(s=>/^\d{4}-\d{2}-\d{2}$/.test(s))
  --         rangeFields() 같은 정규식 필터
  --         fromXML()    .filter(isRealDate)   ← 손으로 고친/구버전 XML 의 중복이 그대로 살아 들어온다
  --     · saveEntryFromForm() 의 편집 저장 경로는 보존만 한다(__entryRecurExcept 를 그대로 되돌려 놓음).
  --     · dedup 처럼 보이는 expandOccurrences() 의 includes 가드는 저장이 아니라 **전개(표시)** 단계다. 화면에서는
  --       중복이 안 보이므로 앱만 써서는 이 결함을 눈치챌 수 없다 — DB 를 붙이는 순간 1062 로 드러난다.
  --   근본 해법은 앱의 append 지점에 가드를 넣는 것이지만 그건 이 파일 범위 밖이다. 그때까지는 어댑터가 막는다.
  PRIMARY KEY (login_id, entry_id, except_date),
  -- CASCADE 인 이유: 예외일은 부모 일정 없이는 뜻이 없는 값이고, 앱은 일정을 지울 때 이 행들을
  -- 따로 지우지 않는다 — recurExcept 는 entry 객체 **안에** 든 배열이고 deleteEntry() 는 그 객체를
  -- state.entries 에서 걷어내는 한 줄이 전부다(직접 확인). 즉 어댑터는 cal_entry 에 DELETE 한 문장만
  -- 낸다. RESTRICT 로 두면 그 한 문장이
  -- ERROR 1451 로 실패한다. 부모 방향(category)의 RESTRICT 와 혼동하지 말 것 — 여기는 부모 일정과
  -- 생사를 같이한다.  ※ 예전 근거였던 '§7.5 부모 트리거가 자식을 JSON 으로 흡수한다'는 2026-08-11
  -- 감사 트리거 폐지로 사라졌다. CASCADE 결정 자체는 위 이유로 그대로 유지된다.
  CONSTRAINT fk_cal_entry_except_entry FOREIGN KEY (login_id, entry_id) REFERENCES cal_entry(login_id, id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='반복 일정의 예외일. 부모 삭제 시 CASCADE. UPDATE 없음(추가/삭제만).';

-- =====================================================================
--  4. cal_entry_commit — git/svn 커밋 목록
-- =====================================================================
-- XML <commits><commit> 대응. 부팅 조회에서 제외하고 커밋 화면·보고서를 열 때만 지연 조회한다(§2).
CREATE TABLE cal_entry_commit (
  login_id    VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,  -- 소유자 login_id (부모에서 전파)
  entry_id    VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin        NOT NULL,  -- 부모 일정 id
  seq         SMALLINT UNSIGNED NOT NULL,                                             -- 부모 commits 배열 인덱스(0부터). 표시 순서의 유일한 근거
  hash        VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',  -- git 전체 해시(40자) 또는 svn 리비전 숫자. 중복 제거·편집 보존 키
  short_hash  VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',  -- 표시용 짧은 해시. git=%h, svn='r'+리비전
  commit_time TIME NULL DEFAULT NULL,                                                 -- 커밋 시각 HH:mm(날짜는 부모 entry_date). '' 는 NULL 로 변환
  -- 폭 재판정: VARCHAR(2000) → MEDIUMTEXT. '편집기 상한 2000' 은 근거가 아니었다 — maxlength=2000 은 수동 편집
  --   textarea(renderGitTab() 의 .nd-cedit) 한 곳뿐이고 그마저 제목+본문 합산이다. VCS 수집 경로(normCommits())에는
  --   절단이 전혀 없다. 스쿼시 머지 제목 한 건이 이관 트랜잭션 전체를 1406 으로 롤백시킨다.
  -- ★ TEXT 가 아니라 MEDIUMTEXT 인 이유: 이 값은 커밋 1건짜리 엔트리에서 cal_entry.title 로 그대로 흘러든다.
  --   두 컬럼의 상한이 다르면 같은 문자열이 한쪽만 통과한다 — 근거가 같으면 타입도 같아야 한다(cal_entry.title 참조).
  subject     MEDIUMTEXT NOT NULL DEFAULT (''),                                       -- 커밋 제목 한 줄(공백 축약·trim 됨)
  -- 폭 재판정: TEXT → MEDIUMTEXT. body 는 git 에서 그대로 받는 값이라 코드상 상한이 0 이다(memo 와 같은 이유).
  body        MEDIUMTEXT NOT NULL DEFAULT (''),                                       -- 커밋 본문(여러 줄). 길이 상한 없음. 이관 왕복 대조에 반드시 포함할 것
  PRIMARY KEY (login_id, entry_id, seq),
  KEY ix_cal_entry_commit_hash (login_id, hash),   -- 재수집 시 이미 있는 커밋인지 판정
  CONSTRAINT fk_cal_entry_commit_entry FOREIGN KEY (login_id, entry_id) REFERENCES cal_entry(login_id, id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='일정에 붙은 커밋 목록. 부팅 조회 제외(지연 로드). seq=배열 인덱스 0-base.';

-- =====================================================================
--  5. cal_todo — 할 일
-- =====================================================================
-- XML <todo> 대응. end_date 유무로 단일/기간 할일이 갈리고 설명 저장소가 note ↔ day_note 로 바뀐다.
CREATE TABLE cal_todo (
  login_id     VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,   -- 소유자 login_id
  id           VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin        NOT NULL,   -- 할 일 id. t-<uuid>(38자)
  category_id  VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL, -- 연결된 과제. NULL 허용
  todo_text    VARCHAR(200) NOT NULL,                     -- 할 일 본문 한 줄(공백 축약·trim). 빈 값이면 앱이 항목 자체를 폐기. 폼 #todoInput/.te-text maxlength=200 과 정확히 같다(fromXML 절단 없음 — name 과 같은 단서)
  -- 폭 재판정: TEXT → MEDIUMTEXT. 할일 설명 textarea(#qaMemo)에 maxlength 가 없다(memo 와 같은 이유).
  note         MEDIUMTEXT   NOT NULL DEFAULT (''),        -- 단일 할일의 전역 설명(여러 줄). 기간 할일이면 항상 ''
  due          DATE         NULL DEFAULT NULL,            -- 기한(단일) 또는 시작일(기간). NULL=기한없음
  end_date     DATE         NULL DEFAULT NULL,            -- 기간 할일 종료일. due 가 있고 due 보다 클 때만 존재
  done         TINYINT(1)   NOT NULL DEFAULT 0,           -- 완료 여부
  prio         VARCHAR(8)   CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT 'normal',  -- 중요 표시 2단계. XML 은 normal 을 기록하지 않음(속성 부재=normal). _bin — 'HIGH' 가 통과하면 앱의 prio==='high' 가 조용히 '보통'으로 읽는다
  completed_at DATETIME(3)  NULL DEFAULT NULL,            -- 완료 시각(UTC). done=0 이면 반드시 NULL. 보고서 '한 일' 기간 필터 키
  created_at   DATETIME(3)  NOT NULL,                     -- 생성 시각(UTC)
  updated_at   DATETIME(3)  NOT NULL,                     -- 수정 시각(UTC). 낙관적 잠금 토큰이자 day_note 자식의 잠금 단위
  PRIMARY KEY (login_id, id),
  KEY ix_cal_todo_login_due (login_id, due),
  KEY ix_cal_todo_login_cat (login_id, category_id),      -- 아래 복합 FK 의 자식 인덱스 겸용
  CONSTRAINT fk_cal_todo_user FOREIGN KEY (login_id) REFERENCES app_user(login_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_cal_todo_category FOREIGN KEY (login_id, category_id) REFERENCES cal_category(login_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_cal_todo_prio    CHECK (prio IN ('normal','high')),
  CONSTRAINT chk_cal_todo_done01  CHECK (done IN (0,1)),
  -- 일정(cal_entry)과 기준 컬럼이 다르다 — 여기는 due 기준. 이름만 보고 복붙하면 정상 데이터가 3819 로 막힌다.
  -- NULL 통과는 의도(end_date NULL = 단일 할일). due IS NOT NULL 이 이미 명시돼 있어 무음 통과가 없다.
  CONSTRAINT chk_cal_todo_enddate CHECK (end_date IS NULL OR (due IS NOT NULL AND end_date > due)),
  -- 미완료인데 완료시각이 남아 있으면 보고서 '한 일' 집계가 유령 항목을 만든다.
  -- ★ 반대 방향(done=1 인데 completed_at NULL)은 일부러 허용한다 — 완료 시각이 없는 구파일이 실재한다
  --   (fromXML() `completedAt: (done && comp) ? comp : ''`). 여기를 조이면 정상 데이터가 3819 로 막힌다.
  CONSTRAINT chk_cal_todo_comp    CHECK (done = 1 OR completed_at IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='할 일. end_date 유무로 단일/기간이 갈리고 설명 저장소가 note↔day_note 로 바뀐다.';

-- =====================================================================
--  6. cal_todo_day_note — 기간 할일의 날짜별 설명
-- =====================================================================
-- XML <dayNotes><dayNote> 대응. 보고서 '한 일' 라인의 원천. 빈 값 저장 = 행 삭제 계약.
CREATE TABLE cal_todo_day_note (
  login_id  VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,  -- 소유자 login_id (부모에서 전파)
  todo_id   VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin        NOT NULL,  -- 부모 할 일 id
  note_date DATE NOT NULL,                                                          -- 설명이 붙는 날짜. 앱이 due <= date <= (end_date||due) 범위를 강제(DB 로는 표현 불가)
  -- 폭 재판정: TEXT → MEDIUMTEXT. 이 화면의 편집 textarea 는 maxlength=500 이지만 그게 상한이 아니다 —
  --   addTodo()가 단일→기간 전환 시 무제한 note 를 통째로 dayNotes[due] 로 옮긴다. note 와 상한이 같아야 한다.
  note_text MEDIUMTEXT NOT NULL,                                                    -- 그 날짜의 설명(trim 된 값). 빈 문자열이면 행을 두지 않는다
  PRIMARY KEY (login_id, todo_id, note_date),
  CONSTRAINT fk_cal_todo_day_note_todo FOREIGN KEY (login_id, todo_id) REFERENCES cal_todo(login_id, id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  -- DEFAULT ('') 를 주지 않은 이유: 빈 값은 '빈 설명'이 아니라 '행 삭제'다(normalizeTodoDayNotes).
  -- 기본값이 있으면 실수로 빈 행이 생겨 보고서에 빈 줄이 찍힌다.
  -- ★ 아래 CHECK 는 cal_room 의 chk_cal_room_name 과 **모양이 같지만 동작이 다르다.** 복붙하지 말 것.
  --   이 컬럼은 테이블 기본 utf8mb4_0900_ai_ci(NO PAD)라 공백을 접지 않는다. cal_room.name 은
  --   utf8mb4_bin(PAD SPACE)이라 접는다. 실측(8.4.9):
  --     `' ' <> '' COLLATE utf8mb4_bin` = 0(같다고 본다) / `COLLATE utf8mb4_0900_ai_ci` = 1(다르다고 본다)
  --     cal_room.name  = '   ' 삽입 → ERROR 3819 (chk_cal_room_name)
  --     note_text      = '   ' 삽입 → **통과**, 저장값 LENGTH=3
  --   판정: 이대로 둔다(실害 없음). 앱은 이 값을 만드는 세 경로가 전부 JS trim 후 빈 값을 버린다 —
  --     fromXML() 의 dayNote 매핑(`String(...).trim()` 후 `&& v`), normalizeTodoDayNotes(), toXML()
  --     (`!String(text||'').trim()` 이면 요소를 안 쓴다). 즉 공백만 남은 행을 만드는 코드 경로가 없다.
  --   ★ CHECK 를 `TRIM(note_text) <> ''` 로 바꿔 두 표를 맞추려 하지 말 것 — 실측으로 반쪽이다.
  --     MySQL TRIM() 은 **공백만** 벗기므로 `'\n\t'` 는 그 CHECK 도 통과한다(실측: 통과·저장됨).
  --     JS trim() 은 개행·탭까지 벗긴다. 즉 DB CHECK 로는 앱의 계약을 재현할 수 없고, 바꾸면
  --     '이제 DB 가 막아 준다'는 잘못된 안심만 생긴다. 공백류 제거 책임은 어댑터(JS trim)에 둔다.
  CONSTRAINT chk_cal_todo_day_note_text CHECK (note_text <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='기간 할일의 날짜별 설명. 빈 값=행 삭제 계약. 부모 삭제 시 CASCADE.';

-- =====================================================================
--  7. cal_room — 장소(회의실) 빠른선택 목록
-- =====================================================================
-- XML <rooms><room> 대응. 이름 자체가 값이라 id 가 없고, 표시 순서는 배열 순서뿐이라 sort_order 로 박제한다.
-- ★ 행 0개 = '빈 목록' 으로 확정. DEFAULT_ROOMS 재주입은 DB 전환과 함께 폐기한다
--   (DB 에서는 '한 번도 없었음'과 '사용자가 전부 지움'을 구분할 수 없기 때문).
--
-- ★ updated_at 을 일부러 두지 않는다(§3.3 낙관적 잠금의 명시적 예외).
--   근거: 이 테이블은 엔티티가 아니라 키 (login_id, name) 으로 주소지정되는 값 행이다. 이름 자체가 값이라
--   '같은 행을 두 사람이 서로 다르게 고치는' 상황이 성립하지 않는다(변경 = 추가/삭제뿐, UPDATE 경로가 없다).
--   같은 사용자의 동시 쓰기는 §3.1 의 cal_user_rev 락이 이미 직렬화한다.
--   설계 §3.3 도 이 테이블을 낙관적 잠금 대상으로 지목하지 않았다.
--   재검토 조건: 이 테이블에 '행을 제자리에서 수정하는' 기능(이름 변경 등)이 생기면 그때 컬럼을 추가할 것.
CREATE TABLE cal_room (
  login_id   VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,  -- 소유자 login_id
  name       VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin        NOT NULL,  -- 회의실/장소 이름. 앱이 공백축약·trim·40자 절단·중복 제거. 중복 판정이 정확 일치라 _bin
  sort_order INT NOT NULL DEFAULT 0,                                                 -- 표시 순서(XML 문서 순서 박제). 최대 50개
  PRIMARY KEY (login_id, name),
  CONSTRAINT fk_cal_room_user FOREIGN KEY (login_id) REFERENCES app_user(login_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- ★ 이 CHECK 는 cal_todo_day_note.chk_cal_todo_day_note_text 와 모양이 같지만 더 넓게 막는다 —
  --   name 이 utf8mb4_bin(PAD SPACE)이라 비교 시 공백을 접기 때문이다. 실측(8.4.9): name='   ' → ERROR 3819.
  --   같은 이유로 PK 도 '회의실A' 와 '회의실A  ' 를 같은 키로 본다(실측: ERROR 1062). 의도된 동작이다 —
  --   앱도 normRooms() 에서 공백 축약·trim 후 중복 제거를 하므로 DB 쪽이 한 겹 더 좁을 뿐이다.
  --   ※ 개행·탭만 있는 이름은 PAD SPACE 도 접지 않아 통과한다. 그쪽은 어댑터(JS trim)가 막는다.
  CONSTRAINT chk_cal_room_name CHECK (name <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='장소(회의실) 빠른선택. name=자연키(utf8mb4_bin). 행 0개=빈 목록.';

-- =====================================================================
--  8. cal_task_hours — (날짜 × 과제) 투입 시간
-- =====================================================================
-- XML <taskHours><day><t> 대응. 회사 일간/주간보고 '[과제명] : n' 계약의 원천.
-- 값 0/빈값은 0 저장이 아니라 행 삭제다(setTaskHours). 그래서 hours > 0 CHECK 와 DELETE 권한이 한 쌍이다.
--
-- ★ 2026-08-11 결정: 공수의 단일 소스는 이 표 하나다. 옛 cal_entry.hours_min(일정 단위 분)은 폐지했다 —
--   채우는 UI 도 자동계산도 없었고 회사 일간보고에도 들어가지 않았다. 두 자리에 공수가 있으면
--   '어느 쪽이 맞는가'를 사람이 매번 판정해야 한다. 되살릴 조건은 헤더의 entry@hours 절에 적어 두었다.
--
-- ★ updated_at 을 일부러 두지 않는다(§3.3 낙관적 잠금의 명시적 예외). cal_room 과 같은 근거다:
--   엔티티가 아니라 키 (login_id, work_date, category_id) 로 주소지정되는 값 행이고, 같은 사용자의
--   동시 쓰기는 §3.1 rev 락이 직렬화한다. 설계 §3.3 도 이 테이블을 지목하지 않았다.
--   ※ 그 대가는 인정한다 — 두 PC 를 쓰는 사람이 같은 (날짜×과제) 칸을 동시에 고치면 마지막 쓰기가
--     이긴다(실측: 스테일 UPDATE 가 ROW_COUNT=1 로 통과). 이 값은 회사 일간보고에 그대로 나간다.
--     ★ 사후 추적 수단은 이 DB 안에 없다(2026-08-11 감사 트리거 폐지). 남는 것은 주간 mysqldump 와
--       binlog 뿐이고, 둘 다 '언제 무엇이 바뀌었나'를 사람이 직접 파야 나온다. 없는 방어를 있다고
--       적지 않기 위해 그대로 적는다 — 이 표는 지금 '마지막 쓰기가 이기고, 추적은 백업으로만' 이다.
--   재검토 조건: 두 자리 동시 편집으로 공수가 어긋난 사고가 한 번이라도 보고되면 updated_at 컬럼을
--     추가하고 낙관적 잠금 대상으로 편입할 것.
CREATE TABLE cal_task_hours (
  login_id    VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,  -- 소유자 login_id
  work_date   DATE NOT NULL,                                                          -- 대상 날짜
  category_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,         -- 과제 id. FK 걸지 않음 — 앱이 과제 삭제 시 이 행을 동반 정리하고, 그 밖의 경로로 생긴 미아 행은 무해
  hours       DECIMAL(4,2) NOT NULL,                                                  -- 투입 시간(★시간 단위, 소수 2자리). 0 초과 24 이하. 앱은 0.5·0.25 같은 소수를 그대로 보낸다
  PRIMARY KEY (login_id, work_date, category_id),
  CONSTRAINT fk_cal_task_hours_user FOREIGN KEY (login_id) REFERENCES app_user(login_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_cal_task_hours_range CHECK (hours > 0 AND hours <= 24)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='(날짜×과제) 투입 시간(시간 단위). category_id 에 FK 없음(앱이 동반 정리). 0=행 삭제.';

-- =====================================================================
--  9. cal_user_pref — 커밋 수집용 전역 작성자
-- =====================================================================
-- XML 루트 gitAuthor/svnAuthor 대응. 보고서 서식(<prefs>)은 §4 로 제외했으므로 여기 넣지 않는다.
CREATE TABLE cal_user_pref (
  login_id   VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,  -- 소유자 login_id. 사용자당 1행
  -- 폭 120 의 근거: 폼 #cGitAuthor/#cSvnAuthor maxlength=120. fromXML()은 루트 속성을 그대로 읽어
  -- 절단이 없으므로, 손으로 고친 XML 만 초과할 수 있다(1406 → 이관 도구 사전 스캔 대상). name 과 같은 판정.
  git_author VARCHAR(120) NOT NULL DEFAULT '',   -- Git 커밋 수집 작성자. ''=전체 커밋 대상. 형식 검증 없음(이메일 아니어도 됨)
  svn_author VARCHAR(120) NOT NULL DEFAULT '',   -- SVN 커밋 수집 작성자. git 과 독립. '속성 부재→gitAuthor 복사' 구버전 마이그레이션은 파서가 이미 해소한 뒤 들어온다
  -- ★ 이관 규칙: 여기만 '이관 시각'을 쓴다. cal_category 와 달리 복사할 원본이 아예 없다 —
  --   toXML 은 gitAuthor/svnAuthor 를 XML '루트 속성'으로 쓸 뿐(4533-4535) 시각을 함께 적지 않고,
  --   앱 state 에도 이 두 값의 수정 시각이라는 개념이 없다(setGitAuthor() 은 save() 만 한다).
  --   사용자당 1행이고 부팅 직후 이 행을 고치는 흐름이 드물어 충돌 오탐 위험이 cal_category 만큼 크지 않다.
  updated_at DATETIME(3)  NOT NULL,              -- 수정 시각(UTC). 낙관적 잠금 토큰
  PRIMARY KEY (login_id),
  CONSTRAINT fk_cal_user_pref_user FOREIGN KEY (login_id) REFERENCES app_user(login_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='사용자당 1행. 커밋 수집 작성자(git/svn). 삭제 경로 없음 — 비우면 빈 문자열 저장.';

-- =====================================================================
--  10. cal_user_rev — 동시성·동기화 단일 감시점(§3.1)
-- =====================================================================
-- 모든 쓰기 트랜잭션의 첫 문장이 이 행을 ODKU 로 잡아 같은 사용자의 쓰기를 직렬화하고 삭제까지 감지한다.
-- XML 원본 없음. DELETE 권한을 주지 않는다 — rev 는 단조증가여야 한다.
CREATE TABLE cal_user_rev (
  login_id VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,  -- 소유자 login_id. 배포 시 app_user 전원 시딩 필수
  rev      BIGINT UNSIGNED NOT NULL DEFAULT 0,                                     -- 단조증가 리비전. 시딩값 0, 상시 문장은 신규 행을 1로 만든다
  PRIMARY KEY (login_id),
  CONSTRAINT fk_cal_user_rev_user FOREIGN KEY (login_id) REFERENCES app_user(login_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='사용자별 동시성 감시점. 쓰기 트랜잭션의 첫 문장이 ODKU 로 잡는 행. DELETE 금지.';

-- =====================================================================
--  11. cal_migration_log — data.xml → DB 1회성 이관의 재실행 방지(§8)
-- =====================================================================
-- 데이터 INSERT 와 같은 트랜잭션에 넣고, 행이 있으면 도구가 거부한다.
-- XML 원본 없음(구 lsMigrated 마커의 후속). UPSERT·REPLACE·선삭제 금지.
CREATE TABLE cal_migration_log (
  login_id    VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,  -- 이관된 사용자. 이관은 PC 단위가 아니라 사람 단위
  source_host VARCHAR(255) NOT NULL DEFAULT '',   -- 이관을 실행한 PC 이름. 두 자리 사용자 사고 추적용
  migrated_at DATETIME(3)  NOT NULL,              -- 이관 시각(UTC)
  PRIMARY KEY (login_id),
  CONSTRAINT fk_cal_migration_log_user FOREIGN KEY (login_id) REFERENCES app_user(login_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='data.xml→DB 1회성 이관 마커(사람 단위). 행 존재=이관 완료, 재실행 거부 근거.';

-- =====================================================================
--  (옛 12. cal_audit_trash — 폐지. 결번)
-- =====================================================================
-- 2026-08-11 결정으로 감사 휴지통과 감사 트리거(trg_cal_*)를 통째로 걷어냈다. 여기에 '왜 없는지'를
-- 남기는 이유는, 이 표를 요구하던 설계 §7.5 를 읽은 사람이 '스키마가 표를 빠뜨렸다'고 판단해
-- 다시 만드는 것을 막기 위해서다.
--   왜 폐지했나: 서버 장애 복구에 무력했다 — 휴지통이 감사 대상과 같은 DB 안에 있어 그 DB 가
--     죽으면 함께 죽는다. 게다가 이 파일의 DROP TABLE 이 그 표에 걸린 트리거를 경고 없이 함께
--     지워, 재구축할 때마다 '보호받는 줄 알았는데 아닌' 상태가 조용히 만들어졌다.
--   대신 무엇을 하나: 표준 복구 경로 — 주간 mysqldump + binlog. 감사가 정말 필요해지면 그 자리는
--     API 서버 계층이다(앱이 DB 에 직접 붙는 지금 구조에서는 어차피 DEFINER 트리거밖에 둘 데가 없었다).
--   되살리지 말 것: 이 DB 안에 트리거를 다시 넣으면 init-calendar.ps1 의 '트리거 0개' 게이트가 실패한다.

-- =====================================================================
--  12. cal_schema_meta — 스키마 버전 행 (§5.5)
-- =====================================================================
-- §5.5 가 요구한 '스키마 버전 행 + 빌드 상수를 접속 시 1회 비교, 낡은 클라이언트는 파괴적 연산만 차단'의
-- 저장소 측 절반이다. 이 행이 없으면 스키마를 ALTER 한 뒤 구버전 위젯이 붙었을 때 막을 수단이 0 이다 —
-- 특히 §8 의 '가져오기 교체'(전량 DELETE + INSERT)와 이관 도구가 파괴적 연산이라, 새 컬럼을 모르는
-- 구버전 클라이언트가 교체를 돌리면 그 사용자의 새 컬럼 값이 전부 기본값으로 되돌아간다.
--
-- 사용 규약(위젯 측):
--   · 접속 프리앰블에서 SELECT v FROM cal_schema_meta WHERE k='schema_version' 를 1회 읽는다.
--   · 빌드 상수와 다르면 파괴적 연산(가져오기 교체·이관·전량 삭제)만 막고 조회·편집은 계속되게 한다.
--     §5.5 가 '전 쓰기 봉인은 과하다'고 못박았다.
--   · 앱 계정에는 SELECT 만 준다. 앱이 이 행을 올릴 수 있으면 차단 자체가 무의미해진다(헤더 참조).
--
-- 사용자별 데이터가 아니라 login_id 도 FK 도 없다. 값 집합이 고정된 토큰이라 두 컬럼 모두 _bin.
CREATE TABLE cal_schema_meta (
  k          VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,  -- 메타 키. 현재 'schema_version' 하나. 앱이 정확 비교하므로 _bin
  v          VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,  -- 값. schema_version 은 단조증가 정수 문자열
  updated_at DATETIME(3) NOT NULL,                                            -- 갱신 시각(UTC). 아래 시딩은 UTC_TIMESTAMP(3) 명시 — CURRENT_TIMESTAMP 는 세션 tz 로 평가되므로 쓰지 않는다
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='스키마 버전 행(§5.5). 앱은 SELECT 만 — 위젯 빌드 상수와 비교해 파괴적 연산만 차단.';

-- 시딩 — 구조를 바꾸는 migrate-*.sql 은 반드시 이 값을 함께 올려야 한다(올리지 않으면 게이트가 죽은 문자가 된다).
INSERT INTO cal_schema_meta (k, v, updated_at) VALUES ('schema_version', '1', UTC_TIMESTAMP(3));

-- =====================================================================
--  cal_user_rev 전원 시딩 (§3.1) — 구조 생성 직후 반드시 함께 실행
-- =====================================================================
-- 왜 '전원'인가(부분 시딩 금지):
--   · 상시 문장(아래 ODKU)이 행을 만들어 주긴 한다. 하지만 그 경우 직렬화 지점이
--     '이미 있는 행의 UPDATE' 가 아니라 '중복키 삽입 경합' 이 되어, §3.1 이 전제한 락 획득
--     순서가 사용자마다 달라진다. 같은 사용자가 두 자리(PC 2대)에서 동시에 첫 쓰기를 하는
--     상황이 바로 이 설계가 막으려던 케이스다.
--   · 아래 릴리스 게이트('누락 0')가 배포 검증의 유일한 수단인데, 일부만 시딩하면 그 게이트가
--     통과 여부를 판정할 기준을 잃는다.
--   · is_active=0(휴직·퇴사 처리) 사용자도 빼지 말 것. 빼면 복직 시 조용히 누락 상태가 된다.
--   · INSERT IGNORE 인 이유: 재실행 가능해야 하고(신규 입사자 추가 후 다시 돌림), 이미 rev 가 올라간
--     사용자의 값을 0 으로 되돌리면 안 되기 때문. 기각된 것은 'INSERT IGNORE 후 FOR UPDATE' 조합이지
--     INSERT IGNORE 자체가 아니다.
INSERT IGNORE INTO cal_user_rev (login_id, rev)
SELECT login_id, 0 FROM app_user;

-- 릴리스 게이트 — 아래 쿼리 결과가 반드시 0 이어야 배포 완료다(0 이 아니면 시딩을 다시 돌릴 것):
--   SELECT COUNT(*) FROM app_user u
--     LEFT JOIN cal_user_rev r ON r.login_id = u.login_id
--    WHERE r.login_id IS NULL;
--
-- 참고 — 앱의 상시 문장(모든 쓰기 트랜잭션의 첫 문장. 이 파일에서 실행하지 않는다):
--   INSERT INTO cal_user_rev (login_id, rev) VALUES (?, 1)
--     ON DUPLICATE KEY UPDATE rev = rev + 1;
--   시딩값 0 과 상시 시작값 1 의 차이는 무해하다(신규 행이 1로 생성될 뿐).
