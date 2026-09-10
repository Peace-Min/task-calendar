-- =====================================================================
--  캘린더(cal_*) 테이블 DDL — 단일 소스
--  MySQL 8.0.13+ / InnoDB / utf8mb4.  (실측·검증 대상: MySQL 8.4.9, STRICT_TRANS_TABLES)
--  ※ 8.0.13 미만 불가 — memo/note/body/subject(전부 MEDIUMTEXT) 가 식 DEFAULT ('') 를 쓴다.
--  ※ 설계 근거는 db/CALENDAR-TABLE-DESIGN.md. 문서와 이 파일이 어긋나면 이 파일이 정본이다.
--
--  ★★ 2026-08-24 키 전환(schema_version 3) — 이 파일에서 가장 크게 바뀐 것 ★★
--     cal_* 13표의 소유자 키가 login_id(VARCHAR) 에서 **user_id(SMALLINT UNSIGNED, app_user 의 대리키)** 로,
--     각 표의 문자열 id 가 **PK 자리에서 내려와 uid 컬럼 + UNIQUE(user_id, uid)** 로 바뀌었다.
--     PK 는 전부 (user_id, <표>_no) 꼴의 대리키다(cat_no·entry_no·todo_no·…).
--     왜: login_id 는 netcus 가 소유한 외부 값인데 참조가 다중경로라 ON UPDATE CASCADE 를 걸 수 없었고
--       (실측 1451/1452), 그래서 RESTRICT 로 갔고, 그 결과 **개명이 영구히 막혔다**(실측: UPDATE 5가지
--       순서 전부 ERROR 1451). 퇴사자 ID 재발급이 오면 '전임자 행 재사용'이 유일한 조치가 되어
--       신입이 전임자 근태를 상속하고 그 값이 netcus 일간보고로 회사에 나간다.
--       user_id 로 옮기면 개명은 app_user 한 행의 UPDATE 로 끝나고 cal_* 는 손댈 필요가 없다.
--     ★ 손대지 않은 것: project · customer · section_code · status_code(과제 트랙, 운영 중) ·
--       org_unit · title_code(개명이 ON UPDATE CASCADE 로 실제 전파되는 것을 실측 확인).
--       코드테이블은 값을 우리가 정하고 참조가 한 갈래라 같은 결함이 없다.
--     ★ db/deploy/rename-login-id.sql 은 이제 필요 없다(그 파일은 애초에 없었다 — 설계 §5.2 가
--       '문장으로만 존재하는 대안 절차'라고 스스로 적어 두었던 그것이다).
--
--  ⚠️ 재실행 경고 — 데이터가 든 DB 에 다시 돌리면 캘린더 데이터가 전부 사라진다.
--     아래 DROP TABLE 이 cal_* 를 자식→부모 순으로 지운다(개수는 여기 적지 않는다 —
--     그 DROP 목록과 아래 CREATE TABLE 목록 자신이 정본이다). 일정·할일·공수·근태·회의실·
--     보고서 서식·보고 기록·이관 마커가 모두 날아가고 되돌릴 수 없다.
--     ★ 되돌릴 수단은 이 DB 안에 없다. 복구 경로는 '주간 mysqldump + binlog' 하나뿐이다
--       (2026-08-11 결정: 감사 트리거·cal_audit_trash 폐지. 같은 DB 안에 둔 휴지통은 서버가
--        통째로 죽는 사고에 함께 사라져 복구에 무력했고, 이 파일을 다시 돌릴 때 DROP TABLE 이
--        경고 한 줄 없이 그 트리거까지 지워 '보호받는 줄 알았는데 아니었던' 상태를 만들었다).
--       → 데이터가 있는 DB 라면 이 파일을 돌리기 전에 mysqldump 를 먼저 뜰 것.
--       배포 순서(고정):
--         · 신규 DB : 01-schema-users.sql(→02·03…) → schema-calendar.sql → grants-calendar.sql
--         · 기존 DB : migrate-2026-08-24-user-id.sql → schema-calendar.sql → grants-calendar.sql
--       ★ 기존 DB 에서 마이그레이션을 건너뛰면 이 파일은 **DROP 에 도달하기 전에** 멈춘다
--         (아래 SET NAMES 바로 다음의 '0. 선행조건 가드'). 그 가드가 없던 시절에는 DROP 이
--         전부 실행된 뒤 첫 CREATE TABLE 이 ERROR 3734 로 죽어 cal_* 가 0개 남았다(실측).
--       (사람이 먼저 여는 파일이 이것이라 여기에도 둔다. 두 파일이 같은 순서를 각자 적어 두고 있으므로
--        한 곳을 고치면 나머지도 함께 볼 것 — 순서는 GRANT 가 표의 실재를 전제하기 때문에 정해진다.)
--     이 파일은 '최초 1회 구축' 전용이다. 운영 중 구조 변경은 별도 migrate-*.sql 로 할 것.
--
--  ⚠️ 이 파일은 cal_* 만 만든다.
--     app_user / org_unit / title_code / project / customer / section_code / status_code 는
--     FK 로 참조만 하고 DROP·CREATE·ALTER 를 하지 않는다(사내 실데이터 89명분이 들어 있다).
--     선행 조건: app_user 가 이미 존재하고 **user_id SMALLINT UNSIGNED 를 PK 로** 갖고 있어야 한다.
--       없거나 타입·부호가 다르면 FK 생성이 errno 1824/3780 으로 실패한다.
--       ★ 이 선행 조건은 이제 말로만 있지 않다 — 아래 '0. 선행조건 가드'가 DROP 보다 먼저 실제로 검사한다.
--         가드는 PRIMARY 를 요구한다(UNIQUE 만으로도 FK 자체는 서지만, 그건
--         migrate-2026-08-24-user-id.sql 이 2단계에서 멈춘 반쯤 된 상태라서 통과시키면 안 된다 — 실측 g3b).
--       (app_user 쪽 DDL 은 이 파일의 범위가 아니다 — migrate-2026-08-24-user-id.sql / 01-schema-users.sql.)
--
--  시각 컬럼 규약(중요) — ★ 2026-09-09 정정:
--     이 자리에는 *"서버 DEFAULT CURRENT_TIMESTAMP(3) 도, ON UPDATE CURRENT_TIMESTAMP(3) 도
--     일부러 쓰지 않았다"* 라고 적혀 있었다. **이 파일 안에서 이미 거짓이었다** —
--     아래 cal_report_daily·cal_report_weekly 의 created_at/updated_at 이 둘 다 쓴다(1654·1704 부근).
--     동작이 틀린 것이 아니라 머리말이 낡은 것이었다(값은 실제로 UTC 로 들어간다. 아래 근거).
--     낡은 머리말을 그냥 두면 다음 사람이 '규약과 코드 중 어느 쪽이 진짜냐'를 매번 다시 판정해야 한다.
--
--     지금의 규약은 이렇다:
--       · **이 DB 의 시각 값은 전부 UTC 다.** 예외 없다.
--       · cal_* 대부분은 앱이 UTC 로 계산해 '명시 대입'한다(created_at/updated_at/completed_at).
--         updated_at 은 동시에 낙관적 잠금 토큰이라, 쓰기 주체가 둘이면 토큰 자체가 무너지기 때문이다.
--       · 예외가 둘 있다 — cal_report_daily·cal_report_weekly 의 created_at/updated_at 은
--         **서버 기본값을 쓴다**(그 두 표는 '보낸 사실'을 담을 뿐이고 낙관적 잠금 대상이 아니다).
--       · 그것이 안전한 이유는 하나뿐이다: **DB 에 접근하는 모든 호스트 코드가 접속 프리앰블에서
--         SET SESSION time_zone='+00:00' 을 건다.** 그래서 CURRENT_TIMESTAMP 도 UTC 로 평가된다.
--         (CalendarDb.ReadPreambleSql · CalendarWriteDb/ReportDb.WritePreambleSql ·
--          ProjectDb 의 읽기/쓰기 프리앰블 — 마지막 것은 2026-09-09 에 신설했다.)
--       · 그 전제는 말이 아니라 **계약으로 지킨다** — tests/schema-integrity.test.mjs 의
--         '계약①: 프리앰블' 이 widget/ 의 .cs 를 디렉터리로 열거해, DB 접속 문자열을 만드는 파일에
--         time_zone='+00:00' 이 있는지 검사한다(새 파일도 자동 편입된다).
--       · 프리앰블 없는 쓰기 주체를 새로 만들면 그 순간 한 컬럼에 KST 와 UTC 가 섞이고,
--         DATETIME 은 사후에 둘을 구분할 수단이 없다(복구 불가). 실제로 그렇게 됐던 적이 있다 —
--         ProjectDb 에 프리앰블이 없어 project·customer·section_code·status_code 의 감사 컬럼이
--         KST 로 적혀 왔고, migrate-2026-09-09-integrity.sql (5)가 그 행들을 1회 정규화했다.
--
--  =====================================================================
--  ★★ DB 어댑터 계약 — 여덟 부류(A~F 는 앱→DB, G 는 DB→앱, H 는 양방향 키 해석).
--      여덟 다 '선택'이 아니다.
--  =====================================================================
--     왜 한 절로 묶는가: 병이 하나다. data.xml 의 값을 **그대로** INSERT 하면 둘 중 하나가 난다 —
--       (1) 이관이 그 자리에서 멈추고 단일 트랜잭션이라 그 사용자의 이관 전체가 롤백되거나,
--       (2) 에러도 경고도 없이 값이 다른 값으로 바뀐다(사후 구분 불가).
--     A~D 가 그 둘이고, E·F 는 다른 병이다 — E 는 XML 에 원본이 없어 어댑터가 만들어야 하는 값이고,
--     F 는 XML 에 있는데 앱은 만들지 않는 값이다. 여섯을 어댑터 단일 함수로 강제하고,
--     런타임 저장 경로와 이관 도구가 같은 함수를 쓴다.
--     H 는 2026-08-24 키 전환으로 새로 생긴 부류다 — 앱은 문자열 id 만 알고 DB 는 번호만 아는데,
--     그 사이를 잇는 코드가 없으면 **모든 쓰기가 그 자리에서 멈춘다.** A~G 를 다 지켜도 소용없다.
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
--          categoryId (entry·todo 양쪽) — 앱은 전 경로가 `|| null` 이다:
--            addEntry() / addTodo() / fromXML() 의 entry·todo 매핑 (`getAttribute(...) || null`).
--            빈 속성 categoryId="" 도 `'' || null` 로 null 이 된다.
--            ★ 키 전환 후 이 값이 들어가는 자리는 **cal_entry.cat_no / cal_todo.cat_no(INT UNSIGNED)** 다.
--              문자열이 애초에 들어갈 수 없으므로 옛 'ERROR 1452' 실측은 더 이상 재현되지 않는다 —
--              대신 H 절의 해석 실패로 나타난다(미존재 과제 id → cat_no 를 만들 수 없다).
--          remind — 미입력은 '' 가 아니라 null 이다(normRemind()).
--          (entry@hours 는 아예 대응 컬럼이 없다 — 아래 ★ '이관이 버리는 XML 속성' 참조)
--          cal_attendance.status — '' 를 NULL 로 바꾸는 게 아니라 **행 자체를 넣지 않는다.**
--            앱의 setAttendance() 가 빈 값·미지 코드면 그 날의 키를 delete 한다(getAttendance() 는
--            미기록에 null 을 돌려준다 — 커밋 8adb1ab 규약). cal_task_hours 의 '0 = 행 삭제' 와 같은 부류다.
--            NOT NULL + chk_cal_attendance_status 의 IN 목록에 '' 가 없어 구조로도 막힌다(ERROR 3819).
--          cal_user_pref.report_marker_custom — '' 가 정상값이다(= 직접 입력 안 함). NULL 로 바꾸지 말 것.
--            report_font_family 도 마찬가지로 '' = 기본 글꼴이다(NOT NULL DEFAULT '').
--          ★ uid — 세 표(cal_category·cal_entry·cal_todo)의 uid 는 NOT NULL 이고 '' 를 허용하지 않는다
--            (chk_*_uid). 앱의 id 는 safeId() 를 거쳐 항상 1자 이상이다. '' 가 오면 그건 값이 아니라 버그다.
--
--     ★ 별개 위험(''와 무관, 어댑터가 아니라 이관 도구가 막아야 한다):
--        fromXML() 은 존재하지 않는 과제를 가리키는 categoryId 를 그대로 남긴다(주석 "미존재 참조는 표시 시
--        '미분류'로 안전 처리"). 앱은 무해하지만 DB 는 그 id 로 cat_no 를 만들 수 없다.
--        이관 도구가 사전에 '실재하지 않는 categoryId → NULL' 정리를 하고 그 건수를 보고해야 한다(H-3).
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
--     대응 컬럼이 있는 것만 적는다. 대응 컬럼이 없는 것은 두 부류로 갈라 아래 ★ 두 절에 따로 적었다 —
--       · 버린다(값이 사라져도 된다): entry@hours · lsMigrated · 루트 @version/@generator/@exportedAt · dbGone
--       · DB 에 안 올리고 로컬에 남긴다(값은 살아 있어야 한다): category@gitRepo / @svnRepo
--       XML(부재 시)                    → 컬럼                          → 넣을 값(파서 기본값)
--       ------------------------------------------------------------------------------------
--       recur@interval                    cal_entry.recur_interval        1        ← ★ NOT NULL 아님에도 CHECK 가 요구
--       recur@count                       cal_entry.recur_count           0        ← ★ 같은 CHECK
--       recur@until                       cal_entry.recur_until           NULL     (A 와 동일 처리)
--       <recur> 요소 자체 부재            recur_freq/interval/until/count 전부 NULL (= 반복 없음)
--       entry@source                      cal_entry.source                ''       ← NOT NULL. NULL 이면 ERROR 1048
--       entry@location                    cal_entry.location              ''       ← NOT NULL. NULL 이면 ERROR 1048
--       entry@categoryId                  cal_entry.cat_no                NULL     ★ 컬럼 이름·타입이 바뀌었다(H 절)
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
--       <attendance> 요소 부재            cal_attendance                  행 없음
--       ─ 보고서 서식(<prefs>) — 요소 자체가 없는 구버전 XML 이 흔하다. 전부 아래 기본값 ────────
--       <prefs> 요소 자체 부재            cal_user_pref 의 서식 12컬럼    전부 아래 각 줄의 기본값
--       prefs@reportMarker                cal_user_pref.report_marker          '-'   ← NOT NULL
--       prefs@reportMarkerCustom          cal_user_pref.report_marker_custom   ''    ← NOT NULL
--       prefs@reportIndent                cal_user_pref.report_indent          2     ← NOT NULL
--       prefs@gitCommitBody               cal_user_pref.git_commit_body        0     ← ★ 아래 D 참조('1'만 쓴다)
--       prefs@reportMarker_daily          cal_user_pref.report_marker_daily    ★ '-' 가 아니다 — 아래 ※ 참조
--       prefs@reportMarkerCustom_daily    …_marker_custom_daily                ''
--       prefs@reportIndent_daily          …_indent_daily                       ★ 아래 ※ 참조
--       prefs@reportMarker_weekly         …_marker_weekly / _custom_weekly / _indent_weekly  (daily 와 동일 규칙)
--       prefs@fontFamily                  cal_user_pref.report_font_family     ''    ← '' = 기본 글꼴
--       prefs@fontSize                    cal_user_pref.report_font_size       0     ← 0 = 기본 크기
--
--     ※ ★ 종류별(_daily/_weekly) 3속성의 기본값은 '-'·2 가 **아니다.** fromXML() 의
--       readReportFormatPref(key) 는 세 속성이 모두 없으면 null 을 돌려주고, normalizeReportFormatPrefs()
--       가 그 자리를 **전역값(reportMarker/reportMarkerCustom/reportIndent)으로** 채운다.
--       즉 전역이 '•'/4 인 구파일을 이관하면서 종류별에 '-'/2 를 넣으면, 사용자가 보던 서식이
--       이관 순간 조용히 바뀐다(에러도 경고도 없다). 반대로 세 속성 중 **하나라도** 있으면 그때는
--       marker·indent 만 전역값으로 메우고, ★ markerCustom 은 전역이 아니라 '' 이 된다
--       (readReportFormatPref 가 `(rmc || '')` 를 돌려주고, normalizeReportFormatPref 가 그 ''를
--        문자열로 인정해 폴백을 타지 않는다 — 직접 읽어 확인한 비대칭이다. 셋을 같은 규칙으로 적지 말 것).
--     ※ 전역 3값(report_marker/_custom/_indent)은 '종류별과 독립인 별도 설정'이 아니라
--       **마지막으로 본 모드의 거울**이다(syncLegacyReportFormatFields() 가 모드 전환마다 덮어쓴다).
--       그래서 전역과 daily/weekly 가 서로 달라도 정상이다 — 어긋난다고 '고쳐서' 넣지 말 것.
--       존치 이유는 하나뿐이다: 종류별 속성이 없는 구파일의 폴백 원본이라 버리면 위 ※ 가 성립하지 않는다.
--
--     ※ 실측(8.4.9, STRICT): 위 'NOT NULL' 표시 컬럼에 NULL 을 넣으면 전부 ERROR 1048
--       (cal_entry.memo·source·location, cal_entry_commit.hash, cal_todo.prio, cal_category.source 로 확인).
--       즉 이 부류는 대체로 '시끄럽게' 실패한다 — 조용히 틀리는 것은 recur 두 컬럼(3819 로 전체 롤백)과
--       svn_author(''로 채우면 구버전 사용자의 SVN 수집 대상이 조용히 '전체'로 바뀐다) 쪽이다.
--
--     ★★ 이 표에 sort_order 가 없는 것은 빠뜨린 게 아니다 — **C 가 아니라 E 다.** 여기가 가장 헷갈리는
--       자리라 못박아 둔다. C 의 규칙은 '속성이 없다 = 파서 기본값' 인데, sort_order 에는 대응 XML
--       속성이 **애초에 없다.** 그래서 '부재 → DEFAULT 0' 으로 처리하면 규칙을 지킨 것 같은데 실제로는
--       배열 순서가 통째로 사라진다. `NOT NULL DEFAULT 0` 이 C 부류처럼 보이는 것이 함정이다.
--       계약: **이관 도구는 sort_order 네 개(cal_category·cal_room·cal_entry·cal_todo)를 XML 문서
--             순서(= fromXML() 배열 인덱스)로 직접 채운다.** 상세와 실측 근거는 계약 E 를 볼 것.
--             값을 안 주고 컬럼 DEFAULT 에 맡기면 오류도 경고도 없이 전 행이 0 이 된다.
--
--     ※ 한 건만 '파서 기본값 그대로'가 자동 정답이 아니다 — `<rooms>` 요소 부재(구버전 XML).
--       파서는 DEFAULT_ROOMS 3개를 주입하는데, cal_room 의 계약은 '행 0개 = 빈 목록'이다(아래 7. 참조).
--       이관 도구는 파서 쪽(DEFAULT_ROOMS 주입)을 따르고 그 사실을 보고한다 — 이관 직후 사용자가
--       보던 목록이 사라지면 '데이터가 없어졌다'로 보이고, 반대 방향(원치 않는 3개가 생김)은
--       사용자가 지울 수 있기 때문이다. `<rooms>` 가 있는 파일은 빈 목록도 그대로 존중한다.
--
--     ※ ★ 근태만은 '미지 값'을 버리지 않고 흡수한다 — 이 파일에서 유일한 예외다.
--       fromXML() 의 attendance 매핑은 `ATTEND_STATUS_SET.has(String(st)) ? String(st) : '1'` 이라
--       미지 코드·빈 속성을 **'1'(정근)으로 바꿔** 그 날을 살려 둔다. 같은 값을 setAttendance() 에
--       넣으면 반대로 그 날 기록이 삭제된다(위 A ③ 참조). 두 경로가 서로 다르다.
--       계약: 이관 도구는 파서 쪽을 따른다(F 절의 '파서 결과만 넣는다' 와 일관). 다만 그렇게 들어간
--       '1' 은 사용자가 적은 값이 아니므로 **건수를 사람에게 보고**할 것 — 회사 일간보고로 그대로
--       나가는 값이고, netcus 에 손으로 적어 둔 휴가·병가를 '정근'으로 덮을 수 있다(커밋 8adb1ab 가
--       런타임 경로에서 막은 바로 그 사고다). toXML() 도 같은 흡수를 하므로 정상 앱이 만든 파일에는
--       이 경우가 나오지 않는다 — 손으로 고친 XML·구버전 파일에서만 나온다.
--
--     ※ undefined ↔ 'local' (cal_category.source) 의 반대 방향: 앱은 개인 과제에 source 키를 만들지
--       않는다(코드 전역에 'local' 문자열 0건). DB 표기를 정본으로 삼되, DB→XML 재생성 시 'local' 이면
--       속성을 쓰지 않아 byte 동일성을 지킨다.
--
--  ── ★ DB 에 안 올리고 '로컬에 남기는' 값 — category@gitRepo / @svnRepo ─────────────
--     ★ 이것은 아래 '버리는' 부류와 **다르다.** 값은 계속 살아 있어야 하고, 저장 위치만 로컬이다.
--     왜 안 올리나: 두 값은 그 PC 의 작업복사본 경로다(#cGitRepo/#cSvnRepo 로 폴더를 직접 고른다).
--       · 자리마다 경로가 달라야 하는데 DB 에 올리면 A자리 경로가 B자리에 그대로 따라가 깨진다.
--       · 더 나쁜 경우는 '경로는 존재하는데 다른 저장소'다 — 그때는 오류 없이 **남의 커밋이
--         자기 보고서에 실린다.** 깨진 경로보다 이쪽이 위험하다(조용하다).
--       · 브라우저 지원에는 로컬 파일 경로라는 개념 자체가 없다.
--     ★ 어댑터 계약: cal_category 에 대응 컬럼을 만들지 않는다. 대신 **로컬 저장소(data.xml /
--       설정 파일)에 그대로 남기고, 과제 편집·커밋 수집이 계속 그 값을 읽는다.**
--       버리면 collectCommits 계열이 `cat.gitRepo || ''` 로 빈 경로를 받아 커밋 수집이
--       오류 없이 조용히 0건이 된다(직접 확인: 커밋 요청 페이로드가 `gitRepo: cat.gitRepo || ''`).
--       '대응 컬럼이 없다'만 보고 아래 '버린다' 부류와 같이 취급하는 것이 이 계약의 유일한 사고다.
--     ★ 로컬 쪽 키도 함께 볼 것 — 로컬 파일은 과제를 **앱의 문자열 id** 로 가리킨다(uid). DB 의
--       cat_no 로 가리키지 말 것. cat_no 는 이 DB 안에서만 뜻이 있는 번호이고, 로컬 파일을 다른
--       PC·다른 DB 로 옮기면 엉뚱한 과제를 가리킨다.
--     ※ 되살릴 조건: 경로를 PC 별로 분리 저장할 자리(예: cal_category_local(user_id,cat_no,host,...))가
--       생기면 그때 올릴 것. 지금 구조에는 'PC' 라는 축이 없어서 올릴 수가 없다.
--
--  ── ★ 이관이 버리는 XML 속성 — entry@hours 외 (대응 컬럼 없음. 오류가 아니다) ──────
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
--     같은 부류(읽지 않고 버린다. 대응 컬럼을 만들지 말 것):
--       root@lsMigrated  — 구 localStorage(tc_taskHours/tc_attendance) → XML 1회 이관의 종료 마커다.
--         그 이관은 이미 끝났고(migrateLocalStores 는 마커가 서면 재실행하지 않는다), DB 이관의
--         재실행 방지는 cal_migration_log 가 따로 맡는다. 두 마커를 한 컬럼에 겹쳐 두면 'XML 이관
--         완료'와 'DB 이관 완료'가 구분되지 않는다.
--       root@version / @generator / @exportedAt — 파일 메타다(파일이 언제 어느 프로그램에서 나왔나).
--         DB 는 파일이 아니라 사용자별 행의 집합이라 대응 개념이 없다. @exportedAt 은 위 B 의 ※ 도 참조.
--       category@dbGone — toXML 이 쓰지만 조회 시 LEFT JOIN project 로 파생한다(§6). 저장하면
--         DB 의 현재 상태와 어긋난 옛 판정이 굳는다.
--
--  ── D. 불리언 문자열 'true'/'false' → 1/0 ────────────────────────────
--     toXML() 은 두 값을 **문자열**로 쓴다: `el.setAttribute('allDay', e.allDay ? 'true' : 'false')` 와
--     todo 의 같은 꼴 `done`. 대상 컬럼은 TINYINT(1) NOT NULL 이다.
--     전수 확인: 'true'/'false' 표기를 쓰는 XML 속성은 정확히 이 둘뿐이다.
--       cal_entry.all_day ← entry@allDay      cal_todo.done ← todo@done
--
--     ★ 세 번째 불리언 컬럼 cal_user_pref.git_commit_body 는 표기가 다르다 — 이 변환을 적용하지 말 것.
--       toXML() 은 `if(state.gitCommitBody) prefs.setAttribute('gitCommitBody','1')` 이라
--       **켜졌을 때만 '1' 을 쓰고, 꺼졌으면 속성 자체가 없다.** fromXML() 도 `=== '1'` 로만 읽는다.
--       즉 이 값의 규칙은 D 가 아니라 C(속성 부재 → 기본값 0)다. '1'→1 / 부재→0 이고 'false' 는 나오지 않는다.
--       (dbGone·lsMigrated 도 같은 '1' 표기지만 대응 컬럼이 없다 — 위 두 ★ 절 참조)
--     ※ 그래서 'TINYINT 컬럼 = D 부류' 로 세지 말 것. TINYINT 계열에는 불리언이 아닌 것이 섞여 있다
--       (report_indent·report_indent_daily·report_indent_weekly · report_font_size · attendance.overtime).
--       D 부류는 위 둘뿐이고, 나머지는 전부 C(속성 부재 → 기본값)로 처리한다.
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
--     ★ 키 전환으로 위험이 하나 늘었다 — UNIQUE(user_id, uid) 위반(1062)도 IGNORE 가 삼킨다.
--       그러면 '같은 uid 를 두 번 넣으려던 행'이 조용히 사라지고, 어댑터의 uid→_no 맵에는
--       먼저 들어간 행의 번호가 남아 **두 앱 객체가 같은 DB 행을 가리키게 된다**(H-2 참조).
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
--       cal_entry.sort_order         <entry> 문서 순서       ★ 조용히 전 행 0 → 일정 배열 순서 영구 소실
--       cal_todo.sort_order          <todo> 문서 순서        ★ 조용히 전 행 0 → 할 일 배열 순서 영구 소실
--       cal_entry_commit.seq         commits 배열 인덱스     ERROR 1364 (시끄럽게 실패)
--       cal_category.cat_no          없음(대리키)            ERROR 1364 — 아래 ★ 참조
--       cal_entry.entry_no           없음(대리키)            ERROR 1364
--       cal_todo.todo_no             없음(대리키)            ERROR 1364
--
--     ★ 대리키 3개(cat_no·entry_no·todo_no)도 이 부류다 — 2026-08-24 키 전환으로 새로 들어왔다.
--       DEFAULT 도 AUTO_INCREMENT 도 없으므로 안 채우면 STRICT 에서 그 자리에 1364 로 멈춘다(시끄러운 쪽).
--       할당 규칙과 그것이 왜 경합에 안전한지는 아래 H-1 과 11. cal_user_rev 의 주석에 있다.
--       ※ AUTO_INCREMENT 를 붙이지 않은 것은 취향이 아니라 실측 결정이다 — 붙이면 MySQL 이 그 컬럼을
--         어떤 인덱스의 선두로 요구해 불필요한 KEY 가 강제되고, 실측에서 보조 인덱스 합이
--         25.59MB → 34.13MB 로 늘었다. 되돌리자는 제안이 나오면 이 줄을 근거로 거절할 것.
--
--     ★ 위험한 것은 sort_order **넷**이다(2026-08-27 에 cal_entry·cal_todo 가 합류했다).
--       NOT NULL **DEFAULT 0** 이라 안 채워도 INSERT 가 성공한다 —
--       오류도 경고도 없고 CHECK 도 게이트도 못 잡는다. 값이 '틀린' 게 아니라 '전부 같은' 상태가
--       되기 때문이다. 실측(8.4.9): sort_order 를 뺀 3행 INSERT → 성공, 세 행 모두 0.
--     ★★ 계약(이관 도구) — **네 표 모두 sort_order 를 XML 문서 순서로 채운다.** 빼먹으면 조용히 0 이 된다.
--       cal_category ← <categories> 안의 <category> 등장 순서
--       cal_room     ← <rooms> 안의 <room> 등장 순서 (= normRooms() 통과 후의 배열 순서)
--       cal_entry    ← <entries> 안의 <entry> 등장 순서 (= fromXML 이 만든 state.entries 배열 인덱스)
--       cal_todo     ← <todos> 안의 <todo> 등장 순서   (= 빈 text 를 filter 로 버린 **뒤**의 배열 인덱스)
--       ※ 값은 0,1,2… 로 건너뛰지 말 것(아래 ※ 규칙). 순서만 맞으면 되지만, 재이관 왕복 서명이
--         값 자체를 비교하므로 규칙을 고정해 둔다.
--       ※ '문서 순서' 의 정본은 XML 텍스트가 아니라 **fromXML() 이 돌려준 배열의 인덱스**다.
--         파서가 버리는 항목이 있어서(계약 F: 빈 <todo>·범위 밖 dayNote·중복 <room>) 두 순서가
--         어긋날 수 있다. 계약 F 의 '파서를 통과한 결과만 넣는다' 와 짝을 이루는 줄이다.
--     ※ seq 는 다르다 — NOT NULL 이면서 **DEFAULT 가 없어** STRICT 에서 그 자리에 1364 로 멈춘다
--       (실측: seq 를 뺀 커밋 2건 INSERT → ERROR 1364 "Field 'seq' doesn't have a default value").
--       PK 충돌(1062)로 2건째에 걸리는 게 아니라 1건째부터 못 들어간다. 시끄러워서 안전한 쪽이다.
--       ※ 이 차이를 DEFAULT 로 메우려 하지 말 것 — sort_order 에서 DEFAULT 0 을 빼면 '순서 없음'을
--         표현하던 기존 행과 ALTER 백필이 전부 깨진다(설계 §5.5 의 '추가 컬럼은 DEFAULT 필수' 규칙).
--         조용한 쪽은 DB 가 아니라 계약과 §8 서명으로 막는다.
--       설계 §5.3 이 이 컬럼을 둔 이유가 그거다 — 화면 순서는 배열 순서인데 created_at 이 대부분
--       같은 밀리초라(실측 37개 중 33개) 대체할 수단이 없다. 안 채우면 이관 순간 순서가 사라지고,
--       사용자는 '순서가 뒤죽박죽'으로만 느낀다. 원본이 없으니 사후 복구도 안 된다.
--       ★ 2026-08-27 — cal_entry·cal_todo 가 **정확히 같은 상황**임이 실측으로 확인됐다(사용자 실 data.xml):
--         일정 23건 중 22건 · 할 일 7건 중 5건이 같은 밀리초(2026-06-23T04:45:32.051Z)다.
--         (entry_date, created_at) 쌍으로 묶어도 동률 그룹이 2개 남고, 그중 한 그룹(2026-06-22 의 3건)은
--         두 값이 완전히 같아 어떤 보조정렬로도 갈라지지 않는다 — 문서 순서 [wk3, e22a, e22b] 가
--         이관 후 [e22a, e22b, wk3] 로 뒤바뀌는 것을 게이트가 재현했다(tests/calendar-adapter.mjs).
--         ※ '화면이 렌더할 때 다시 정렬하니 괜찮다' 는 반론은 실측으로 기각됐다 — 그 정렬(entrySort·sortS)도
--           created_at 에서 끝나고 JS sort 는 안정 정렬이라, 동률이면 배열 순서가 그대로 화면에 나온다.
--     ★ sort_order 를 cat_no·entry_no·todo_no 로 대체하려 하지 말 것 — 둘은 다른 값이다. 번호는 '한 번
--       정해지면 안 변하는 신원'이고 sort_order 는 '사용자가 끌어 옮기면 바뀌는 표시 순서'다. 순서를 번호
--       로 표현하면 재정렬이 곧 PK 변경(=자식 재배선)이 되어, 키 전환으로 없앤 문제가 되돌아온다.
--       게다가 번호는 MAX()+1 이라 **재사용된다**(H-1) — 마지막 행을 지우고 새로 만들면 그 항목이
--       배열 끝이 아니라 옛 자리로 돌아간다.
--     ※ 규칙: 문서에 나타난 순서대로 0,1,2… (건너뛰지 말 것 — 앱은 값의 크기가 아니라 정렬 결과만 본다).
--       seq 도 0-base 로 commits 배열 인덱스 그대로.
--     ※ 이 부류는 §8 의 이관 왕복 서명에 반드시 포함시킬 것. 서명에서 빠지면 순서가 통째로
--       뒤집혀도 게이트가 초록불을 낸다(설계 §8 이 카테고리 서명에 sort_order 를 넣은 이유).
--       ★ 단 cat_no·entry_no·todo_no 는 서명에 **넣지 말 것.** 그 번호는 이 DB 안에서만 뜻이 있고
--         같은 XML 을 두 번 이관하면 다른 번호가 나오는 것이 정상이다. 서명에 넣으면 정상 왕복이
--         전부 불일치로 보고된다. 서명의 신원 축은 uid 다.
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
--       중복 <except date>                 dedup 안 함(A 부류 아님)      PK(user_id,entry_no,except_date)
--                                                                        가 1062 → 이관 전체 롤백
--       실재하지 않는 날짜의                fromXML 이 isRealDate(date)   cal_attendance 에 2026-02-30
--       <attendance day date="2026-02-30"> 로 그 날을 통째로 버림        같은 행. DATE 컬럼이 STRICT 에서
--                                                                        1292 로 막으므로 여기는 시끄럽다
--       <taskHours> 의 같은 경우           같은 isRealDate 검사           cal_task_hours 도 동일
--       ★ 중복 <category id>                fromXML 은 dedup 하지 않는다  UNIQUE(user_id,uid) 가 1062.
--         / 중복 <entry id> / <todo id>     (앱은 나중 것이 배열에 그냥   entry·todo 도 같다.
--                                            더 붙는다)                   → 2026-08-24 키 전환으로 새로 생긴 줄
--
--     ★ 계약: 이관 도구와 런타임 저장은 **fromXML() 을 통과한 결과만** DB 에 넣는다. XML 을 직접
--       파싱해 INSERT 하지 말 것. 그러면 이 부류가 통째로 해소된다(파서가 이미 다 버렸으므로).
--       그게 불가능한 도구라면 위 줄들을 손으로 구현하고, 버린 건수를 사람에게 보고할 것.
--       ※ 마지막 줄(중복 id)만은 파서를 통과시켜도 해소되지 않는다 — 파서가 dedup 을 하지 않기 때문이다.
--         옛 스키마에서는 PK(login_id,id) 가 같은 1062 를 냈으므로 위험도는 그대로다(새로 생긴 위험이
--         아니라, 막는 제약의 이름이 PRIMARY 에서 uq_*_uid 로 바뀐 것뿐이다). 장애 대응 때 제약 이름으로
--         원인을 찾는 절차가 있다면 그 이름을 함께 고칠 것.
--     ※ 왜 '보고'가 필요한가: 버리는 게 정상이지만 '몇 개를 버렸는지'는 사용자가 알아야 한다.
--       빈 할일 200개를 조용히 버리면 '이관에서 데이터가 샜다'는 의심을 나중에 못 푼다.
--
--     ★★ 예외 하나 — 근태(<attendance>)는 fromXML() 을 통과시키면 안 된다.
--       위 계약('파서 통과 결과만 넣는다')이 근태에서만은 정반대로 작동한다. 실측(앱 코드 직접 확인):
--         getAttendance()  무효·미기록 → null       ← 2026-08-11 커밋에서 고친 것
--         setAttendance()  무효·빈 값 → 그 날 기록 삭제  ← 같은 커밋
--         fromXML()        무효 status → '1'(정근)으로 흡수  ★ 안 고쳐졌다
--         toXML()          무효 status → '1' 로 흡수        ★ 안 고쳐졌다
--       즉 이관 도구가 fromXML() 결과를 그대로 쓰면, 손편집·구버전 XML 의 무효 status 가 전부
--       '정근' 행으로 DB 에 굳는다. 그 커밋이 고친 결함(미기록을 정근으로 흡수)이 이번엔
--       **영구 데이터로** 재현되는 것이다 — 앱 버그는 화면만 틀리지만 이건 되돌릴 원본이 없다.
--
--       계약: <attendance><day> 는 XML 에서 직접 읽고, status 가 코드 목록에 없으면
--             **행을 만들지 않는다**(NULL 도 '' 도 아니다 — 행 부재가 곧 '미기록'이다).
--             chk_cal_attendance_status 가 '' 를 막으므로 실수하면 3819 로 시끄럽게 실패한다.
--             버린 날짜 수를 사람에게 보고할 것(위 ※ 와 같은 이유).
--       ※ toXML() 쪽 흡수는 DB→XML 내보내기에서 같은 왜곡을 만든다. 다만 DB 에는 무효 status 가
--         애초에 들어갈 수 없으므로(CHECK) 그 경로는 발화하지 않는다 — 앱 코드를 고칠 필요는 없다.
--         고치려면 '미기록 = day 요소를 쓰지 않는다' 가 되어야 하고, 그건 XML 포맷 변경이다.
--
--
--  ══ G. DB → 앱 (읽기 경로) — 위 A~F 의 반대 방향 ═══════════════════════
--     A~F 는 전부 'XML/앱 → DB' 였다. 부팅 조회는 반대로 가고, 규칙이 대칭이 아니다.
--     목표는 하나다: **fromXML() 이 돌려주던 것과 똑같은 모양의 객체**를 만든다.
--     앱 전체를 고치지 않고 재료만 바꾸는 것이므로, 모양이 한 군데라도 다르면 그 자리에서
--     화면이 깨지거나(터지면 다행) 조용히 다르게 그려진다.
--
--     최상위 반환 객체(fromXML() 의 return 과 키가 정확히 같아야 한다):
--       { categories, entries, todos, rooms, taskHours, attendance,
--         gitAuthor, svnAuthor,
--         reportMarker, reportMarkerCustom, reportIndent, gitCommitBody,
--         reportFormatPrefs, reportFont, lsMigrated }
--     ★ 최상위 15키는 **늘지도 줄지도 않는다.** 늘려야 할 것 같으면 그건 대개 원소의 키다.
--
--     ★★ 2026-08-27 — 원소의 키 집합이 한 번 늘었다. 계약이므로 여기 명시한다:
--        **categories 원소에 `usesRepo`(boolean)가 항상 붙는다**(G-6). fromXML() 은 그 키를 만들지
--        않으므로 '똑같은 모양' 이라는 이 절의 목표에 **의도된 예외**가 하나 생긴 것이다.
--        · 왜 예외를 두는가: 그 값은 XML 에 표현이 없고(§4 — 경로만 있고 '쓴다/안 쓴다' 는 없다)
--          DB 에만 있다. 앱이 §4 의 안내를 띄우려면 그 한 비트를 받아야 한다.
--        · 대조 게이트(tests/calendar-adapter.mjs)는 이 차이를 **덮지 말고 계산해서 맞춰야 한다** —
--          G-6 의 '없는 것 채우기'(hours=null · commits=[] · lsMigrated=true)와 같은 부류로,
--          기준(fromXML) 쪽을 정규화해 대조한다. 정규화 규칙은 I-1 과 같다:
--            expected.usesRepo = (XML 의 gitRepo 또는 svnRepo 가 비어 있지 않다)
--          ※ 그 규칙은 이관 도구가 세우는 규칙과 **같은 규칙**이므로, 이 대조가 증명하는 것은
--            '이관 규칙이 옳다' 가 아니라 **'어댑터가 DB 의 그 비트를 손실 없이 앱까지 나른다'** 다.
--            게이트가 자기 요약에 그 사실을 찍어야 한다(무엇을 증명 못 했는지도 결과의 일부다).
--        · 이 예외를 **늘리지 말 것.** 다음에 또 '앱에는 없지만 DB 에만 있는 값'을 얹고 싶어지면,
--          먼저 그것이 §4 처럼 *"DB 에 있어야만 앱이 두 상태를 구분할 수 있다"* 를 만족하는지 보여라.
--          만족하지 못하면 그건 파생값이고, 파생값은 얹지 않는다(ADR-18).
--
--  ── G-1. 이름이 다르다 ────────────────────────────────────────────────
--     DB 는 snake_case, 앱은 camelCase 인데 단순 변환으로 안 되는 것들이 있다.
--       cal_category.description      → category.desc        ★ description 아님
--       cal_todo.todo_text            → todo.text            ★ todoText 아님
--       cal_entry_commit.short_hash   → commit.short         ★ shortHash 아님
--       cal_entry_commit.commit_time  → commit.time
--       cal_entry.entry_date          → entry.date           ★ entryDate 아님
--       cal_entry.all_day             → entry.allDay
--       cal_attendance.work_date      → attendance 맵의 키
--
--     ★★ 2026-08-24 키 전환으로 여기가 크게 늘었다 — **uid ↔ 앱의 id** 대응이 핵심이다.
--       어댑터는 조회 결과의 uid 를 state 객체의 **id** 로 되돌려야 한다. 번호(_no)가 아니다.
--       cal_category.uid              → category.id          ★ 앱은 이 값으로 과제를 가리킨다
--       cal_entry.uid                 → entry.id             ★ 반복 일정의 시리즈 id 로도 쓰인다
--       cal_todo.uid                  → todo.id
--       cal_entry.cat_no              → entry.categoryId     ★ **번호가 아니라 그 과제의 uid 로 되돌린다**
--       cal_todo.cat_no               → todo.categoryId      ★ 같음
--       cal_task_hours.cat_no         → taskHours 맵의 **안쪽 키**(= 그 과제의 uid)
--     ★ cat_no 를 그대로 state 에 넣으면 무슨 일이 나는가: 앱은 `e.categoryId === c.id` 로 비교하는데
--       한쪽은 숫자 7, 다른 쪽은 문자열 'c-…' 라 **어떤 일정도 어떤 과제에도 안 붙는다.** 전부 '미분류'로
--       그려지고, 오류는 하나도 안 난다. 색·필터·과제별 보고서가 통째로 비는데 원인은 안 보인다.
--     ★ 반대로 uid 만 있고 번호를 안 들고 있으면 **쓰기를 못 한다**(H-2). 어댑터는 둘 다 들고 있어야 한다 —
--       state 에는 uid 만, 별도 맵에는 uid↔_no 를 둔다.
--       cal_entry_except.entry_no / cal_entry_commit.entry_no / cal_todo_day_note.todo_no
--         → 앱 객체에 대응이 **없다.** 부모 객체 안으로 접히는 값이라 state 에 나타나지 않는다
--           (G-5 의 접는 규칙 참조). 이 셋을 state 에 흘리지 말 것.
--       cal_*.user_id → 앱 객체에 대응이 **없다.** state 는 항상 '나 한 사람'이라 소유자 축이 없다.
--         조회 결과에서 걷어낼 것 — 넣으면 toXML() 이 모르는 키를 만나고, §8 왕복 서명도 어긋난다.
--     나머지는 snake→camel 로 기계 변환이 되지만, 위 표에 있는 것은 표를 보고 쓸 것.
--
--  ── G-2. NULL → '' (A 의 역방향) ──────────────────────────────────────
--     앱은 '값 없음'을 빈 문자열로 들고 있다. NULL 을 그대로 넘기면 `if(e.startTime)` 류 검사가
--     통과하는 것까지는 같지만, 문자열 메서드(.slice·.localeCompare)에서 터진다.
--       start_time · end_time · commit_time · end_date(entry·todo) · due · recur_until
--       · completed_at
--     ※ 반대로 NULL 을 유지해야 하는 것도 있다 — cat_no(앱의 categoryId 는 `|| null` 로 다룬다.
--       NULL 인 cat_no 는 '' 가 아니라 **null** 로 되돌린다) ·
--       remind(null = '기본 사다리', 0 = '알림 없음'. ''로 바꾸면 두 상태가 뭉개진다).
--
--  ── G-3. DATETIME(3) → ISO 'Z' (B 의 역방향) ──────────────────────────
--     앱의 시각은 전부 nowIso() = toISOString() 산출물 형태다. DB 값은 UTC 이므로
--     'yyyy-MM-dd HH:mm:ss.fff' → 'yyyy-MM-ddTHH:mm:ss.fffZ' 로 되돌린다.
--     대상: category.createdAt · entry.createdAt/updatedAt · todo.createdAt/updatedAt/completedAt
--     ※ completed_at 은 NULL 이면 '' 다(G-2). ISO 변환은 값이 있을 때만.
--     ★ 낙관적 잠금 토큰은 이 변환을 거친 값이 아니다 — §3.3 이 요구하는 @prev 는
--       **DB 가 준 원문 문자열**이다. state 에 넣지 말고 어댑터가 따로 보관할 것(G-6).
--
--  ── G-4. TINYINT → boolean (D 의 역방향) ──────────────────────────────
--     all_day → entry.allDay(true/false) · done → todo.done · git_commit_body → state.gitCommitBody
--     ※ 0/1 을 그대로 넘기지 말 것. 앱은 `e.allDay ? …` 로 쓰므로 당장은 같게 동작하지만,
--       toXML() 이 `e.allDay ? 'true' : 'false'` 로 쓰기 때문에 내보내기에서만 값이 달라진다.
--
--  ── G-5. 정렬 컬럼 → 배열 순서 / 행 → 맵 (E 의 역방향) ────────────────
--     DB 는 행 집합이고 앱은 배열·객체다. 접는 규칙이 표마다 다르다.
--       cal_category    ORDER BY sort_order, uid → categories 배열. sort_order·cat_no 는 state 에 넣지 않는다
--       cal_room        ORDER BY sort_order, name → rooms 문자열 배열(객체 아님)
--       cal_entry       ORDER BY sort_order, uid → entries 배열. sort_order·entry_no 는 state 에 넣지 않는다
--       cal_todo        ORDER BY sort_order, uid → todos 배열. sort_order·todo_no 는 state 에 넣지 않는다
--       cal_entry_commit ORDER BY seq       → entry.commits 배열. seq 는 state 에 넣지 않는다
--       cal_entry_except ORDER BY except_date → entry.recurExcept 문자열 배열
--       cal_todo_day_note → todo.dayNotes = { 'YYYY-MM-DD': '설명' }   (배열 아님)
--       cal_task_hours    → taskHours   = { 'YYYY-MM-DD': { 과제uid: 시간 } }  (2단 중첩)
--                            ★ 안쪽 키는 cat_no 가 아니라 그 과제의 **uid** 다(G-1).
--                              JOIN cal_category 로 되돌리거나, 이미 만든 _no→uid 맵을 쓴다.
--       cal_attendance    → attendance  = { 'YYYY-MM-DD': { status, overtime } }
--     ★ ORDER BY 를 빠뜨리면 MySQL 이 어떤 순서를 주는지 보장이 없다. '대체로 맞게' 나오다가
--       행이 늘거나 실행계획이 바뀌면 순서가 뒤집힌다 — 화면 순서가 이유 없이 달라진다.
--     ★ ORDER BY 에 cat_no·entry_no·todo_no 를 쓰지 말 것. 번호는 '만들어진 순서'일 뿐이고
--       삭제 후 재사용되므로(11. cal_user_rev 주석) 표시 순서의 근거가 되지 못한다.
--     ★★ 2026-08-27 — cal_entry·cal_todo 의 정렬키가 확정됐다(그 전에는 cal_todo 줄이 '…' 로 열려
--        있었고, 어댑터가 created_at 을 임시 정렬키로 쓰고 있었다). **created_at 은 정렬키가 아니다.**
--        근거는 계약 E 의 실측이다 — 일정 23건 중 22건, 할 일 7건 중 5건이 같은 밀리초라 순서를
--        결정하지 못한다. 배열 순서의 유일한 근거는 sort_order 다.
--     ★★ 같은 날 cal_entry 에서 **entry_date 를 정렬키에서 뺐다.** 이 줄은 원래 'ORDER BY entry_date'
--        였다 — 정정이므로 근거를 남긴다.
--        · 이 절의 목표는 'fromXML() 이 돌려주던 것과 똑같은 모양' 인데, fromXML 의 entries 배열은
--          **문서 순서이고 날짜순이 아니다.** entry_date 를 1차 키로 두면 그 배열을 재현할 방법이
--          아예 없다(게이트 실측: real 픽스처 23자리 중 22자리가 어긋난다).
--        · 옛 'ORDER BY entry_date' 는 sort_order 가 없던 시절의 대용품이었다 — 뜻은 '무순서를 두지
--          말라' 였고, 이제 그 자리를 sort_order 가 정확히 채운다.
--        · 화면은 달라지지 않는다(앱 코드 직접 확인): state.entries 를 날짜순으로 신뢰하는 곳이 없다.
--          entriesOn()·groupByDateHtml() 이 **먼저 날짜로 묶은 뒤** entrySort 로 정렬하고, 작업일지는
--          rows.sort(date,time) 한다. 배열 순서가 새어 나오는 곳은 entrySort 의 동률뿐인데 그건 언제나
--          '같은 날짜 안' 이라, 날짜로 먼저 정렬하든 안 하든 같은 날짜 안의 상대 순서는 **동일**하다.
--        ★ 되돌리자는 제안이 나오면 이 세 줄을 근거로 거절할 것. 되돌리는 순간 게이트가 다시 빨간불이 된다.
--     ★ 마지막 티브레이커가 uid 인 이유(네 표 공통 — category=uid, room=name, entry=uid, todo=uid):
--        sort_order 가 동률인 상태는 정상이 아니지만(계약 E 가 0,1,2… 를 요구한다), 이관이 그 값을
--        빠뜨리면 **전 행이 0** 이 되어 실제로 벌어진다. 그때 티브레이커가 없으면 MySQL 이 매 부팅
--        다른 순서를 줄 수 있다 — '순서가 틀렸다' 보다 '순서가 매번 바뀐다' 가 훨씬 나쁜 증상이고
--        재현이 안 돼 원인 추적도 막힌다. uid 는 UNIQUE(user_id, uid) 라 순서를 완전히 결정한다.
--        ※ 이 티브레이커의 대가는 인덱스로 정렬을 끝낼 수 없다는 것이다(실측: 넣는 순간 filesort).
--          사용자당 수십 행이라 무시할 수 있다 — 근거와 EXPLAIN 은 cal_entry 의 인덱스 주석에 있다.
--        ※ _no 를 티브레이커로 쓰지 말 것 — 위 ★ 과 같은 이유(재사용되는 번호)다.
--     ★ cal_attendance 는 **행이 없는 날짜의 키를 만들지 않는다.** 그게 '미기록' 이다
--       (getAttendance() 가 그 자리에서 null 을 돌려준다). 빈 객체나 status:'' 를 넣지 말 것.
--
--  ── G-6. DB 에 없는 것을 무엇으로 채우나 ★ 가장 위험한 절 ─────────────
--     아래는 조회 결과에 없다. 안 채우면 undefined 가 되고, undefined 는 대부분의 검사를
--     조용히 통과하므로 **터지지 않고 다르게 동작한다.**
--
--       entry.hours          → null 로 채운다.
--                              컬럼을 폐지했다(위 '이관이 버리는 XML 속성' 참조). undefined 로 두면
--                              `e.hours != null` 이 우연히 같게 동작하지만 명시가 낫다.
--
--       category.gitRepo     → **로컬 저장소에서 읽어 채운다.** DB 에 없는 것은 의도이고(§4),
--       category.svnRepo       값이 없어도 되는 것은 아니다. 빈 문자열로 채우면 「연동」 섹션이
--                              통째로 사라져 사용자는 '커밋이 없는 것'과 구분하지 못한다.
--                              ★ 이 PC 에 경로가 없으면 그 사실을 화면이 말해야 한다(§4).
--                              ★ 로컬 쪽 키는 uid 다 — cat_no 로 찾지 말 것(위 ★ 절).
--
--                              ★★ 그 '로컬 저장소'가 무엇인지 여기서 못박는다(2026-08-27 신설).
--                                 이 자리가 "로컬 저장소" 라고만 적혀 있어 구현자가 두 번 헤맸다.
--                                 · 파일 : %APPDATA%\TaskCalendar\repo-paths.json
--                                 · 코드 : widget/RepoPaths.cs  (형식·손상 처리·고아 키 규칙의 단일 소스)
--                                 · 소유 : **웹 계층**(과제 목록과 함께 늘었다 줄었다 하는 키 맵).
--                                          widget.settings.json 이 아니다 — 그쪽은 창 위치·자동시작
--                                          같은 호스트(WPF) 소유의 평평한 DTO 라 수명도 소유자도 다르다.
--                                          data.xml 도 아니다 — DB 전환 뒤 그 파일은 보존만 되므로
--                                          거기 남기면 로컬 유지가 아니라 **동결**이다(§4).
--                                 · 형식 : { "version": 1,
--                                            "paths": { "<category uid>": { "git": "…", "svn": "…" } } }
--                                          키가 과제 **uid** 다(c-<uuid> / db-<project.uid>).
--                                          맵을 최상위에 두지 않는 이유는 "version" 이라는 이름의 과제
--                                          키와 부딪히지 않게 하려는 것이다.
--                                 · 배선 : 부팅 때 한 번 읽어 세션이 끝날 때까지 들고 있는다.
--                                            _repoPaths = RepoPaths.Load(_dataDir, Log);
--                                            await _calDb.LoadSnapshotAsync(loginId, _repoPaths.Map);
--                                          `.Map` 이 repoPaths 인자와 **정확히 같은 형**이라 변환이 없다.
--                                          ★ CalendarDb 에 `(string?, RepoPaths)` 편의 오버로드를 만들지
--                                            말 것 — 어댑터 게이트가 부팅 조회를 **이름 점수**로 고르는데
--                                            오버로드는 이름도 인자 개수도 같아 어느 쪽이 뽑힐지가 우연이
--                                            된다. RepoPaths 쪽이 뽑히면 게이트가 null 을 넣어
--                                            gitRepo·svnRepo 가 전부 '' 가 되고, 게이트는 그것을 '' 로만
--                                            대조하고 통과시킨다 = **G-6 의 값 대조가 조용히 사라진다.**
--                                 · 파일이 없거나 깨져도 **예외를 던지지 않는다**(빈 맵 + 원본은 .bak).
--                                   이 파일 하나 때문에 위젯이 안 뜨면 사용자는 고칠 화면조차 없다.
--                                 ※ 경로 **문자열**은 여전히 DB 로 올리지 않는다. DB 로 가는 것은
--                                   "저장소를 쓰는 과제인가" 하는 **비트 하나**뿐이다(§4) — 그 비트가
--                                   없으면 앱은 '경로가 없다'와 '저장소를 안 쓰는 과제다'를 구분하지
--                                   못해 위 안내가 모든 과제에 뜨거나 아무 데도 안 뜬다.
--
--       category.usesRepo    → ★★ cal_category.uses_repo(0/1) → **boolean**. 위 두 줄의 짝이다.
--                              (2026-08-27 신설, schema_version 5)
--                              · **fromXML() 은 이 키를 만들지 않는다.** XML 에 대응 속성이 없다 —
--                                XML 에는 gitRepo·svnRepo 경로 **문자열**만 있고, 그건 그 파일을 만든
--                                PC 의 사실이지 과제의 사실이 아니다. 그래서 이 키는 이 절('DB 에
--                                없는 것을 채운다')의 **거울**이다 — DB 에만 있는 것을 앱에 얹는다.
--                              · 왜 필요한가: gitRepo=''·svnRepo='' 만으로는 *"이 PC 에 경로가 없다"* 와
--                                *"저장소를 안 쓰는 과제다"* 가 **같은 모양**이다. 앱은 그 둘을 갈라야
--                                「연동」 섹션을 숨길지, *"이 PC 에는 이 과제의 저장소 경로가 설정되지
--                                않았습니다"* 를 띄울지 정할 수 있다(§4). 화면 규칙은 이 셋의 조합이다:
--                                   usesRepo=false                      → 「연동」 섹션을 숨긴다(지금과 같다)
--                                   usesRepo=true  · 경로 있음          → 커밋 줄을 그린다(지금과 같다)
--                                   usesRepo=true  · 경로 없음          → ★ 숨기지 말고 안내를 띄운다
--                              · **키를 항상 만든다**(true/false 둘 다). 'false 면 키를 만들지 않는' 식으로
--                                아끼지 말 것 — source·dbGone 과 다른 판정이다. 저 둘은 '공식 과제인가'
--                                라는 **분류**라 부재가 곧 'local' 이라는 뜻이지만, usesRepo 는 위 3분기의
--                                **조건**이고 undefined 는 false 와 같은 자리에 떨어져 세 번째 분기가
--                                통째로 사라진다(터지지 않고 조용히 사라진다 — 이 절이 경고하는 그것).
--                              · 값을 로컬 경로 유무에서 **파생하지 말 것**(usesRepo = !!gitRepo 금지).
--                                그러면 정의상 3분기가 2분기로 접혀 이 컬럼을 만든 이유가 사라진다.
--                                근거는 언제나 DB 컬럼이다.
--                              · 이 값은 state 에 실리지만 toXML() 은 쓰지 않는다(직렬화 목록에 없다 —
--                                id·color·gitRepo·svnRepo·createdAt·source·dbGone 뿐). 즉 **내보내기 →
--                                가져오기 왕복에서 이 비트는 살아남지 못한다.** 그건 손실이 아니라
--                                설계다 — XML 은 '한 PC 의 파일'이고 이 비트의 원본은 DB 한 곳이다.
--                                ※ 그래서 §8 의 왕복 서명에도 넣지 않는다(서명은 XML↔DB 대응이 있는
--                                  값만 센다). 대신 이관 도구가 무엇을 근거로 이 비트를 세우는지는
--                                  아래 I-1 이 못박는다.
--
--       category.dbGone      → source='db' 인 행만, LEFT JOIN project 로 파생한다(§6).
--                              컬럼으로 저장하지 않는다 — 파생값 캐시라 ADR-18 과 충돌한다.
--
--       category.source      → 'db' 일 때만 키를 만든다. 'local' 이면 **키 자체를 넣지 않는다**
--                              (앱은 개인 과제에 source 키를 만들지 않는다 — 계약 C 의 역방향).
--
--       state.lsMigrated     → ★★ 반드시 **true**. 이게 이 절에서 제일 위험하다.
--                              false 나 undefined 면 migrateLocalStores() 가 실행되어
--                              WebView2 의 localStorage(tc_taskHours · tc_attendance)를 읽어
--                              state 에 병합하고 save() 한다 — DB 모드에서는 그 좀비 데이터가
--                              **DB 로 들어간다.** 게다가 mergeLegacyStores() 는 무효 근태 코드를
--                              유효 코드로 정규화하므로, 방금 구조로 막은 '미기록 → 정근' 이
--                              그 경로로 되살아난다. 함수 주석 자신이 "재실행하면 사용자가 지운
--                              값이 되살아난다(좀비)" 라고 적고 있다.
--                              DB 모드는 그 이관이 이미 끝난 세계이므로 true 가 사실이기도 하다.
--                              ★ 그 좀비 taskHours 의 과제 id 는 대부분 이미 없는 과제를 가리킨다 —
--                                키 전환 후에는 cat_no 로 해석조차 안 되므로 H-3 의 중단 경로를 탄다.
--                                즉 증상이 '조용한 오염'에서 '요란한 저장 실패'로 바뀔 뿐, 원인은 같다.
--
--       낙관적 잠금 토큰      → state 에 넣지 않는다. 어댑터가 별도 맵으로 보관한다:
--                              Map<'표:<표>_no' → DB 가 준 updated_at 원문>.
--                              ★ 키에서 login_id 가 빠졌다 — 한 세션은 한 사용자이고(user_id 고정)
--                                _no 는 그 사용자 안에서 유일하므로 소유자 축이 필요 없다.
--                                옛 키 '표:login_id:id' 를 그대로 쓰면 login_id 가 개명된 뒤
--                                맵이 통째로 미스가 되어 첫 편집이 전부 충돌 오탐이 된다.
--                              §3.3 이 앱의 entry.updatedAt 을 쓰지 말라고 한 이유는 JS 가
--                              편집마다 nowIso() 로 덮기 때문이다. 저장할 때 이 맵에서 꺼내
--                              @prev 로 쓰고, 성공 응답의 새 값으로 갱신한다.
--                              ※ cal_category·cal_user_pref 는 state 에 updatedAt 키가 아예
--                                없으므로(fromXML 확인) 이 맵이 유일한 보관처다.
--
--  ── G-7. 커밋은 부팅 조회에 넣지 않는다 ───────────────────────────────
--     §2 — 무게의 대부분이 커밋이고 캘린더를 그리는 데 쓰이지 않는다.
--     부팅 조회 대상에서 cal_entry_commit 을 빼고, entry.commits 는 **빈 배열**로 채운다.
--     ★ undefined 로 두지 말 것. 렌더·보고서 경로는 `(e.commits||[])`·Array.isArray 로 방어하지만
--       **커밋 편집 경로는 가드가 없다**(직접 확인: 커밋 찾기·삭제 함수가 entry.commits.find(…)
--       와 entry.commits.length 를 바로 읽는다). 사용자가 커밋 내역에서 한 줄 지우려는 순간
--       TypeError 가 난다 — 조회는 멀쩡한데 편집만 죽는 형태라 원인을 찾기 어렵다.
--     커밋 화면·보고서를 열 때 그 entry 의 커밋만 지연 조회해 채운다.
--     ★ 지연 조회의 조건절은 (user_id, entry_no) 다 — state 에는 entry_no 가 없으므로(G-1)
--       H-2 의 uid→_no 맵을 반드시 거쳐야 한다. 이 한 줄을 빠뜨리면 커밋 화면만 안 열린다.
--
--  ══ H. 대리키 해석 — 앱의 문자열 id ↔ DB 의 번호 (2026-08-24 신설, 양방향) ═══
--     앱은 과제·일정·할일을 **문자열 id** 로만 가리킨다(c-<uuid>·e-<uuid>·t-<uuid>·db-<project.uid>).
--     DB 는 2026-08-24 부터 그것들을 **번호**로 가리킨다(cat_no·entry_no·todo_no).
--     그 사이를 잇는 코드가 어댑터에 없으면 조회는 되는데 **모든 쓰기가 그 자리에서 멈춘다.**
--     A~G 를 다 지켜도 소용없으므로 별도 부류로 둔다.
--
--  ── H-1. 번호는 누가, 어떻게 매기나 ───────────────────────────────────
--     ★ AUTO_INCREMENT 를 쓰지 않는다(위 E 절의 근거 — 강제 인덱스로 보조 인덱스 합 25.59→34.13MB).
--     ★ 시퀀스 표도 두지 않는다. 사용자별 카운터를 **쓰기 트랜잭션 안에서** 계산한다:
--
--         -- (1) 모든 쓰기 트랜잭션의 첫 문장 — §3.1. 이 순서는 불변이다.
--         INSERT INTO cal_user_rev (user_id, rev) VALUES (?, 1)
--           ON DUPLICATE KEY UPDATE rev = rev + 1;
--         -- (2) 그 뒤에 새 행의 번호를 뽑는다.
--         SELECT COALESCE(MAX(entry_no), 0) + 1 FROM cal_entry WHERE user_id = ?;
--
--     왜 이것이 경합에 안전한가(실측으로 확인할 것 — 아래 ※ 참조):
--       (1) 의 ODKU 는 **이미 있는 행**을 갱신하므로 그 사용자의 cal_user_rev 행에 배타 락을 잡고
--       트랜잭션이 끝날 때까지 놓지 않는다. cal_user_rev 는 배포 시 app_user 전원 시딩이 강제라
--       (이 파일 맨 아래) 그 행은 항상 존재한다. 따라서 **같은 user_id 의 쓰기는 (1) 에서 이미
--       직렬화**되어 있고, (2) 의 MAX() 와 그 뒤의 INSERT 사이에 다른 세션이 끼어들 수 없다.
--       다른 user_id 는 다른 행이라 서로 막지 않는다(경합 없음).
--       ※ 이 안전성은 (1) 을 **정말로 먼저** 실행할 때만 성립한다. (1) 을 건너뛰고 (2) 부터 하면
--         두 세션이 같은 MAX() 를 읽어 같은 번호로 INSERT 하고, 한쪽이 1062(PRIMARY)로 죽는다.
--         조용히 틀리지는 않지만 사용자에게는 '가끔 저장이 실패한다'로 보인다.
--       ※ ★★ '먼저' 는 문장 순서만의 문제가 아니다 — **리드뷰(read view)가 언제 굳는가**의 문제다.
--         이 계약에는 격리수준 의존이 숨어 있었다. 이제 조건으로 명시한다.
--           · REPEATABLE READ 에서 리드뷰는 그 트랜잭션의 **첫 일관읽기** 시점에 굳는다.
--             (1) 의 ODKU 는 잠금읽기라 리드뷰를 만들지 않는다 → (1) 이 정말 첫 문장이면 (2) 의
--             MAX() 가 첫 일관읽기가 되어 최신 커밋을 본다(안전).
--           · 그런데 (1) **앞에** 일관읽기가 한 줄이라도 있으면 리드뷰가 거기서 굳는다.
--             그 뒤 다른 자리가 커밋한 행을 (2) 가 **못 보고**, 낡은 MAX() 로 발번해 1062 로 죽는다.
--             ★ 그 '한 줄' 은 cal_entry 를 읽을 필요도 없다 — **무관한 표 한 줄이면 충분하다.**
--         2026-08-24 실측(8.4.9, 격리 DB, 두 연결. A=발번 세션, B=그 사이에 끼어들어 커밋하는 세션.
--         cal_entry 에 entry_no=1 하나만 둔 상태에서 시작):
--           · RR + (1) 앞에 cal_entry 일관읽기 1줄  → A 가 2를 발번 → **ERROR 1062 (PRIMARY '1-2')**
--           · RR + (1) 앞에 app_user  일관읽기 1줄  → A 가 2를 발번 → **ERROR 1062** (표가 달라도 같다)
--           · RR + (1) 이 정말 첫 문장             → A 가 3을 발번 → 성공
--           · READ COMMITTED + (1) 앞에 읽기 1줄   → A 가 3을 발번 → 성공(문장마다 리드뷰를 새로 뜬다)
--         ⇒ **계약 조건 두 가지. 둘 중 하나만 지켜도 안전하지만, 둘 다 지킬 것.**
--           ㄱ) 쓰기 연결은 READ COMMITTED 다(설계 §3.2). 이 격리수준이면 (2) 는 항상 최신을 본다.
--           ㄴ) 그 위에서도 (1) 앞에는 어떤 SELECT 도 두지 않는다(어댑터가 '현재 상태 확인' 한 줄을
--               습관처럼 앞에 붙이기 쉽다 — 그 한 줄이 정확히 이 사고다).
--         ★ 설계 §3.2 의 READ COMMITTED 는 이제 '이웃 사용자 차단(1205) 회피' 만이 아니라
--           **번호 유일성의 전제**이기도 하다. 두 절이 이 한 줄로 묶였다 — §3.2 를 '성능 이야기'로
--           읽고 빼면 번호가 깨진다.
--         ※ 다행히 조용히 틀리지는 않는다(1062 로 시끄럽게 죽고, 재시도하면 성공한다).
--           바로 그래서 오래 남기 쉽다 — '가끔 저장이 실패하는' 산발적 증상으로만 보인다.
--       ※ cal_user_rev 에 별도 카운터 컬럼(next_entry_no …)을 두는 안은 기각했다 — 표당 한 컬럼씩
--         13개가 붙고, 그 값이 실제 행과 어긋나는 경로(부분 복구·손수정·표 단위 재적재)가 생기면
--         1062 이거나 **번호 재사용**이 된다. MAX()+1 은 데이터 자신이 근거라 어긋날 수가 없다.
--     ★ 번호는 **재사용된다**(MAX 기준이므로 마지막 행을 지우면 그 번호가 다음에 다시 나온다).
--       안전한 이유: 앱은 번호를 보지 않고(uid 로 본다), 자식 표는 부모 삭제 시 ON DELETE CASCADE 로
--       함께 사라지며(except·commit·day_note), 유일하게 CASCADE 가 아닌 참조인 cal_task_hours 는
--       RESTRICT 라 과제가 남아 있는 동안에만 존재한다. 즉 '지워진 번호를 가리키는 행'이 남을 수 없다.
--       ★ 다만 어댑터의 uid→_no 맵은 예외다 — 삭제한 행의 항목을 **반드시 즉시 지울 것.**
--         남겨 두면 나중에 같은 번호를 받은 **다른** 행을 가리키게 되고, 그 오염은 조용하다.
--     ★ 이 규칙은 이관 도구에도 그대로 적용된다. 이관은 사용자별 단일 트랜잭션이므로 도구가
--       메모리에서 1,2,3… 을 붙여도 되지만, 그때도 (1) 을 먼저 실행해야 한다(다른 자리에서
--       같은 사용자가 앱을 켜 놓았을 수 있다).
--
--  ── H-1b. 새 항목의 sort_order 는 무엇으로 주나 (쓰기 계층 계약) ───────
--     ※ 2026-08-27 신설. 쓰기 계층은 아직 없다 — 만들 때 이 절을 구현할 것.
--     대상: cal_category · cal_room · cal_entry · cal_todo (sort_order 를 가진 네 표 전부).
--
--     ★ 값 — 그 사용자 안에서 **MAX(sort_order) + 1**. 즉 새 항목은 배열의 **끝**에 붙는다.
--       근거: 앱이 실제로 그렇게 한다(state.entries.push / state.todos.push / categories.push).
--       ※ 0-base 라 빈 표에서 0 이 나와야 한다 → `COALESCE(MAX(sort_order), -1) + 1`.
--         `COALESCE(MAX(...), 0) + 1` 로 쓰면 첫 항목이 1 이 되어 값 규칙(0,1,2…)이 어긋나고,
--         §8 왕복 서명이 sort_order 값 자체를 비교하므로 재이관 대조가 전부 틀어진다.
--
--     ★ 자리 — **<표>_no 를 뽑는 그 자리에서, 같은 문장으로 함께 뽑는다.** 위 (2) 를 이렇게 쓴다:
--         SELECT COALESCE(MAX(entry_no), 0) + 1, COALESCE(MAX(sort_order), -1) + 1
--           FROM cal_entry WHERE user_id = ?;
--       왜 같은 자리여야 하는가: 둘 다 '그 사용자의 현재 최댓값' 이라 (1) 의 rev 락이 직렬화해 주는
--       구간 안에서 읽어야 한다는 조건이 **정확히 같다.** 락 밖에서 읽으면 두 세션이 같은 값을 본다.
--       ★★ 그런데 결과는 정반대다 — entry_no 충돌은 1062 로 **시끄럽게** 죽지만, sort_order 충돌은
--         UNIQUE 가 없어 **아무 일도 안 일어난다.** 두 항목이 같은 sort_order 를 갖고, 순서는 G-5 의
--         uid 티브레이커가 임의로 정한다. 즉 sort_order 쪽이 더 위험하다(조용하다).
--         그래서 '번호는 락 안에서, 순서는 나중에 대충' 이 성립하지 않는다. 한 문장으로 묶어 둘 것.
--       ※ 두 값을 같은 수로 쓰지 말 것. _no 는 1-base 신원이고 sort_order 는 0-base 표시 순서다.
--         한 번의 삭제나 재정렬로 곧바로 갈라진다(계약 E 의 ★ — 둘은 다른 값이다).
--
--     ★ 재정렬(드래그) 은 다른 경로다 — 두 행만 맞바꾸지 말고, 그 사용자의 그 표 전체를 배열 순서대로
--       **0..n-1 로 다시 쓴다.** 앱이 배열을 통째로 들고 있으므로 그게 가능하고, 부분 UPDATE 는
--       삭제로 생긴 구멍(아래 ※)과 겹쳐 조용히 동률을 만든다.
--     ※ 삭제가 남긴 구멍(0,1,3,4…)은 메우지 않아도 된다 — 앱은 값의 크기가 아니라 정렬 결과만 본다.
--       그래서 MAX+1 은 단조 증가하지만 INT 상한까지 여유가 있다(한 사용자의 일생 생성 건수다).
--
--  ── H-2. 어댑터가 들고 있어야 하는 맵 ─────────────────────────────────
--     state 에는 uid 만 들어간다(G-1). 그런데 UPDATE/DELETE 와 자식 조회의 조건절은 번호다.
--     그래서 어댑터는 부팅 조회 때 아래 세 맵을 함께 만들어 세션이 끝날 때까지 유지한다:
--       Map<category.id → cat_no>   Map<entry.id → entry_no>   Map<todo.id → todo_no>
--     (반대 방향 _no→uid 도 필요하다 — cal_task_hours 를 접을 때 쓴다. G-5)
--     ★ 새 행을 INSERT 한 직후 반드시 맵에 넣을 것. 빠뜨리면 '방금 만든 일정을 곧바로 수정'하는
--       가장 흔한 흐름이 실패한다. 반대로 DELETE 직후에는 반드시 빼야 한다(H-1 의 ★).
--     ★ 맵의 수명은 세션이다. 다른 자리에서 만든 행의 번호는 이 맵에 없으므로, 조회를 다시 하기
--       전에는 그 행을 수정할 수 없다 — 그건 결함이 아니라 §3.1 이 이미 전제한 것이다(rev 로 감지).
--
--  ── H-3. 해석 실패 — id 는 있는데 번호가 없을 때 ──────────────────────
--     실재하지 않는 과제를 가리키는 categoryId 는 앱에서는 무해하다(fromXML 이 그대로 남기고
--     화면은 '미분류'로 그린다). DB 에서는 **번호를 만들 수 없다.**
--       · 런타임 저장: 그 값을 NULL(미분류)로 바꿔 저장하고, 사람에게 알린다.
--         조용히 저장하면 사용자가 보던 '미분류'와 결과가 같아 보이지만, 원본 id 가 영구히 사라진다.
--       · 이관 도구: **중단하고 사람에게 보고한다**(§8 "버리지 않는다"). 실재하지 않는 categoryId 의
--         건수와 값을 먼저 보여 주고, 사람이 '미분류로 정리' 를 승인한 뒤에 다시 돌린다.
--     ★ cal_task_hours 는 다르다 — cat_no 가 NOT NULL 이라 '미분류 공수' 라는 상태가 없다.
--       해석 실패 시 그 행은 **버릴 수밖에 없다.** 반드시 건수·날짜·과제 id 를 보고할 것.
--       이 값은 회사(netcus) 일간보고에 그대로 나가는 숫자다. 조용히 버리면 보고 숫자가 줄어든다.
--       ※ 이 부류가 실제로 존재한다: fromXML() 의 taskHours 파싱은 `cat` 이 실재 과제인지 검사하지
--         않는다(빈 문자열만 거른다 — 직접 확인). 옛 localStorage 승격분·손편집 XML 에서 나온다.
--
--  ── H-4. 공식 과제는 uid 가 89명 전부 같다 ────────────────────────────
--     공식 과제 id 는 'db-<project.uid>' 라(mapDbRows()), 같은 과제를 구독한 사람이 **전원 같은 uid** 를
--     갖는다. 그래서 uid 는 **전역 UNIQUE 가 아니라 UNIQUE(user_id, uid)** 다.
--     ★ 전역 UNIQUE 로 만들면 표 생성은 되지만 두 번째 사람의 구독에서 ERROR 1062 가 난다.
--       (설계 §5.2 근거① 과 같은 사실이다. 실측 검증 항목에 포함되어 있다 — 서로 다른 두 user_id 가
--        같은 uid 를 각각 INSERT 할 수 있어야 한다.)
--     ★ 반대로 cat_no 는 같지 않다. 사람마다 자기 카운터로 받은 번호라 같은 공식 과제가
--       A 에게는 3, B 에게는 11 일 수 있다. **cat_no 로 '같은 과제인지'를 판정하지 말 것** —
--       그 판정의 근거는 uid(또는 project_uid)다.
--
--  ══ I. cal_category.uses_repo — 누가 세우고 누가 지우나 (2026-08-27 신설) ══
--     쓰기 계층이 아직 없다. 그래서 **코드가 아니라 계약으로** 먼저 못박는다. 이 절이 정본이다.
--     컬럼의 의미·왜 경로가 아니라 비트인지는 cal_category 의 컬럼 주석과 설계 §4 에 있다.
--
--  ── I-1. 이관(XML → DB)이 세우는 값 ───────────────────────────────────
--     uses_repo = (그 <category> 에 gitRepo 또는 svnRepo 가 있고 빈 문자열이 아니면 1, 아니면 0).
--     ★ 그것이 **이관 시점에 존재하는 유일한 증거**다. 다른 근거는 없다 — 이관은 한 PC 의
--       data.xml 한 개를 보고 있고, 그 PC 에 경로가 있었다는 사실이 곧 '이 과제는 저장소를 쓴다' 다.
--     ★ 같은 이관이 **repo-paths.json 도 함께 만든다.** 경로 문자열은 DB 로 가지 않으므로(§4),
--       이관이 그것을 로컬로 옮기지 않으면 그 PC 는 이관 직후 **자기가 갖고 있던 경로를 잃는다** —
--       그러면 uses_repo=1 만 남아 §4 의 안내가 방금 이관한 그 PC 에서 곧바로 뜬다. 우스운 상태다.
--       두 쓰기는 한 도구의 같은 단계에서 함께 일어나야 한다.
--     ★ 0 으로 백필하지 말고 **행마다 계산**할 것. 전 행 0 이면 안내가 아무 데도 안 뜨고,
--       전 행 1 이면 모든 과제에 뜬다(§5.5 가 DEFAULT 를 0 으로 정한 이유는 '계산 실패 시 조용한
--       쪽으로 넘어지게' 하려는 것이지, 계산을 생략해도 된다는 뜻이 아니다).
--
--  ── I-2. 런타임이 세우는 시점 — 경로를 **처음 지정할 때** ─────────────
--     앱이 [과제 관리]에서 그 과제의 gitRepo·svnRepo 중 하나라도 **비어 있지 않은 값으로** 저장하면,
--     그 자리에서 uses_repo=1 로 올린다. 그 UPDATE 는 §3.1 의 rev 락 안에서, 그 과제의
--     낙관적 잠금(@prev)과 함께 나간다 — 다른 컬럼의 UPDATE 와 같은 규약이다.
--     ★ 이미 1 이면 다시 쓰지 않는다(무의미한 updated_at 갱신 = 남의 세션에 충돌 오탐을 만든다).
--     ※ 경로 **문자열**은 이 UPDATE 에 실리지 않는다. 그건 repo-paths.json 으로만 간다(§4).
--       한 사용자 동작이 두 저장소에 나뉘어 쓰이는 유일한 자리이므로, 로컬 쓰기가 실패하면
--       DB 쓰기도 하지 않는다(순서: 로컬 먼저 → 성공하면 DB). 반대로 하면 경로 없이 비트만 서서
--       방금 경로를 지정한 사람에게 "경로가 설정되지 않았습니다" 가 뜬다.
--
--  ── I-3. 지우는 조건 — ★ **자동으로는 지우지 않는다** ─────────────────
--     이 PC 에서 경로를 지웠다는 사실은 **그 과제가 저장소를 그만 쓴다는 뜻이 아니다.** 다른 자리에
--     아직 경로가 있을 수 있고, DB 는 그것을 알 방법이 **없다** — 경로도, 'PC 마다의 유무'도
--     올리지 않기 때문이다(§4. 올리면 그게 바로 §4 가 막으려던 그것이다).
--     그래서 '마지막 PC 에서 지워졌는가' 는 **판정 불가**다. 판정할 수 없는 것으로 상태를 바꾸지 않는다.
--
--     ★ 그러면 어느 쪽으로 틀리는 것이 나은가 — 두 오류의 값이 다르다:
--       · 잘못 켜 둔 채로 두면(거짓 양성) 저장소를 그만 쓴 과제의 「연동」 자리에
--         *"이 PC 에는 경로가 설정되지 않았습니다"* 한 줄이 남는다. **보이고, 설명되고,
--         사용자가 직접 끌 수 있다**(I-4).
--       · 잘못 꺼 버리면(거짓 음성) 「연동」 섹션이 **다시 통째로 사라진다** — 그게 바로 §4 가
--         없애려던 상태다. 아무 말도 없이 커밋 줄만 없고, 원인을 알 방법이 없다.
--       비대칭이다. 그래서 **한 번 켜지면 끄지 않는다**를 택한다.
--
--  ── I-4. 그래도 끄는 유일한 경로 — 사람이 명시적으로 ──────────────────
--     [과제 관리]에 *"이 과제는 저장소를 쓰지 않습니다"* 를 두고, 그것을 누를 때만 0 으로 내린다.
--     ★ '이 PC 의 경로를 비웠다' 를 그 신호로 **삼지 말 것.** 그건 PC 의 사실이고 이 비트는 과제의
--       성질이다(컬럼 주석 ③). 사람이 과제에 대해 한 진술만이 과제의 성질을 바꾼다.
--     ※ 그 UI 는 아직 없다. 없어도 무해하다 — 켜진 채 남은 과제는 안내 한 줄을 띄울 뿐이고,
--       그 안내는 틀린 말도 아니다("이 PC 에는 경로가 없다"는 사실 그대로다).
--
--  ── I-5. 과제가 지워지면 ──────────────────────────────────────────────
--     cal_category 행이 사라지므로 이 비트도 함께 사라진다. 따로 정리할 것이 없다.
--     로컬 repo-paths.json 의 그 키는 **고아로 남아도 무해하다**(참조하는 과제가 없으면 안 읽힌다).
--     지울 수 있으면 지우되, 지우려고 DB 를 뒤지지는 말 것(§4).
--
--  값 집합이 고정된 문자열 컬럼은 COLLATE utf8mb4_bin 이다(테이블 기본 utf8mb4_0900_ai_ci 상속 금지).
--     실측: ai_ci 는 대소문자뿐 아니라 전각/반각까지 같게 본다. 'DB'·'Db'·전각 'ｄｂ' 가 CHECK 를
--     전부 통과하고 입력 그대로 저장됐다. 앱은 `source === 'db'` 로 정확 비교하므로 그런 행은
--     조용히 개인 과제로 취급된다. 대상: cal_category.source · cal_entry.source · cal_entry.recur_freq ·
--     cal_todo.prio · cal_schema_meta.k/v · cal_attendance.status · cal_user_pref.report_font_family.
--     ★ uid 3개(cal_category·cal_entry·cal_todo)도 같은 이유로 _bin 이다 — 앱 id 는 대소문자를 구분하고
--       (safeId 가 [A-Za-z0-9_-] 를 그대로 통과시킨다), ai_ci 면 'c-AB…' 와 'c-ab…' 가 UNIQUE 충돌로
--       1062 를 내거나 서로를 덮는다. 옛 PK 컬럼(id)이 _bin 이던 것과 같은 판정이다.
--     ※ 반대로 cal_user_pref 의 머리기호 3컬럼(report_marker·_daily·_weekly)과 report_marker_custom 은
--       _bin 이 **아니다.** 값 집합이 고정되어 있지 않기 때문이다 — 드롭다운 프리셋 말고도 fromXML() 이
--       임의 문자열(길이 8 이하)을 그대로 받아들이고, 앱은 이 값을 비교하지 않고 그냥 앞에 붙여 출력한다.
--       ai_ci(NO PAD)를 그대로 상속시키는 편이 안전하다 — _bin 은 PAD SPACE 라 공백만으로 된 머리기호가
--       chk_..._marker(<> '') 에 걸린다(cal_room.name 에서 실제로 그렇게 동작하는 것을 확인했다).
--     ★ _bin 은 절반만 막는다 — 2026-08-21 실측으로 확인한 구멍이다. utf8mb4_bin 은 PAD SPACE 라
--       '값+뒤공백' 이 IN 목록을 그대로 통과한다(실측: 'db ' 도, '1 ' 도 통과. HEX 로 확인).
--       앱은 정확 비교라 그 행을 '다른 값'으로 읽으므로, ai_ci 의 'Db' 사고와 결과가 똑같다.
--       바꿔 끼우는 것으로는 해결되지 않는다 — ai_ci(NO PAD)는 뒤공백을 막는 대신 전각을 통과시킨다.
--       → 새로 만드는 값집합 CHECK 에는 `AND <컬럼> NOT LIKE '% '` 를 함께 적는다(LIKE 는 PAD 접기를
--         하지 않는다). cal_attendance.status 와 cal_user_pref.report_font_family 가 그렇게 되어 있다.
--       ※ 먼저 만든 네 컬럼(cal_category.source · cal_entry.source · cal_entry.recur_freq ·
--         cal_todo.prio)에는 아직 그 한 줄이 없다. 이 파일은 '최초 1회 구축' 전용이라 여기서 고치면
--         이미 배포된 DB 와 어긋나므로, 보완은 migrate-*.sql 로 할 것(아직 안 함 — 미해결로 적어 둔다).
--       ※ uid 는 이 부류가 아니다 — 값 집합이 고정이 아니라 '앱이 만든 원문 보존'이 목적이라
--         뒤공백도 원문의 일부다. 대신 chk_*_uid 가 '' 만 막는다(_bin PAD SPACE 라 공백만인 값도 함께
--         막힌다 — cal_room.name 과 같은 동작이다. 실측 항목).
--     ※ color · recur_until 은 REGEXP CHECK 라 이미 폭에 안전하다(실측: 전각 입력 ERROR 3819).
--       대소문자는 색상 표기가 원래 양쪽을 허용하므로(앱 /^#[0-9a-fA-F]{6}$/) 의도된 통과다 → _bin 불필요.
--
--  이 파일에 없는 것: 앱 계정 GRANT(create-app-user.sql / grants-calendar.sql 계열). 별도 파일이다.
--  ★ 2026-08-24 키 전환은 GRANT 파일에도 영향이 있다 — 컬럼 단위 부여가 있다면 컬럼 이름이 바뀌었다.
--     이 파일은 그 파일의 현재 상태를 적지 않는다(아래 ※ 와 같은 이유). 배포 전에 그 파일을 직접 열 것.
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

-- =====================================================================
--  0. ★★ 선행조건 가드 — 반드시 아래 DROP 보다 **먼저** 있어야 한다 ★★
-- =====================================================================
--  왜 있는가 (2026-08-24 신설):
--    이 파일은 cal_* 를 먼저 DROP 하고 그다음 CREATE 한다. 그런데 첫 CREATE TABLE
--    (cal_category) 의 fk_cal_category_user 가 app_user(user_id) 를 참조한다. user_id 가 없는
--    DB — 즉 아직 migrate-2026-08-24-user-id.sql 을 안 돌린 기존 DB — 에서는 그 CREATE 가
--    ERROR 1824/3734 로 죽는다. DDL 은 롤백이 없다. 이미 지나간 DROP 은 되돌아오지 않는다.
--    → cal_* 가 0개 남는 반파 상태가 되고, 실 taskmgr 기준 cal_user_rev 89행
--      (§3.1 동시성과 계약 H-1 번호발급의 전제)이 그 자리에서 소실된다.
--    그래서 '지우기 전에' 멈춘다. 아래 세 가드가 통과해야만 DROP 에 도달한다.
--
--  ★ 방식: MySQL 은 스토어드 프로그램 밖에서 IF/THEN 도 SIGNAL 도 못 쓴다
--    (실측: PREPARE 로 SIGNAL 을 감싸면 ERROR 1295 'not supported in the prepared statement
--     protocol yet'). 그래서 information_schema 를 읽어 **실행할 문장 자체를 문자열로 고른** 뒤
--    PREPARE/EXECUTE 한다. 조건 충족이면 'DO 0'(무해한 no-op), 불충족이면 존재하지 않는
--    테이블명을 SELECT 하는 문장을 골라 일부러 ERROR 1146 을 낸다 — 테이블명 자리에 넣은
--    한국어 문장이 그대로 에러 메시지로 나온다(실측).
--    ※ 식별자 64자 제한. ※ Windows(lower_case_table_names=1)는 ASCII 를 소문자로 바꿔 출력한다.
--
--  ★★ 실행할 때 --force 를 붙이지 말 것. mysql 클라이언트는 기본적으로 에러에서 멈추지만
--    --force 는 계속 진행시킨다 — 그러면 이 가드가 무력화되고 DROP 이 그대로 돈다.
--    (init-calendar.ps1 등 이 파일을 돌리는 모든 러너에 해당한다.)
-- ---------------------------------------------------------------------

-- 가드 1) app_user 가 있는가
SET @g_has_app_user := (SELECT COUNT(*) FROM information_schema.TABLES
                         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user');
SET @g := IF(@g_has_app_user = 1, 'DO 0',
             'SELECT 1 FROM `중단: app_user 가 없다 - 01-schema-users.sql 을 먼저 돌릴 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 가드 2) app_user.user_id 컬럼이 있는가 (= 대리키 전환이 끝났는가)
SET @g_has_user_id := (SELECT COUNT(*) FROM information_schema.COLUMNS
                        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                          AND COLUMN_NAME = 'user_id');
SET @g := IF(@g_has_user_id = 1, 'DO 0',
             'SELECT 1 FROM `중단: app_user.user_id 없음 - migrate-2026-08-24-user-id.sql 먼저`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 가드 3) 타입과 인덱스가 FK 를 받을 수 있는 모양인가
--   · COLUMN_TYPE 이 아래 각 표(cal_schema_meta 를 뺀 전부)의 user_id 와 **글자까지 같아야**
--     FK 가 선다(ERROR 3780). 여기에도 개수를 적지 않는다 — 아래 CREATE TABLE 목록이 정본이다.
--   · 참조 컬럼은 인덱스의 선두여야 한다(ERROR 1822). 설계상 그 인덱스는 PRIMARY 다.
SET @g_type_ok := (SELECT COUNT(*) FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                      AND COLUMN_NAME = 'user_id' AND COLUMN_TYPE = 'smallint unsigned');
SET @g_pk_ok := (SELECT COUNT(*) FROM information_schema.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                    AND INDEX_NAME = 'PRIMARY' AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'user_id');
SET @g := IF(@g_type_ok = 1 AND @g_pk_ok = 1, 'DO 0',
             'SELECT 1 FROM `중단: app_user.user_id 가 smallint unsigned PK 가 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;


-- ---------- 멱등 재구축용 DROP — 자식(FK 참조하는 쪽) → 부모 순 ----------
-- 위 경고를 다시 읽을 것. 아래 DROP 줄들이 캘린더 데이터를 지운다.
--
-- ★ DROP 목록은 CREATE TABLE 목록보다 **길다**(폐지된 cal_audit_trash 를 더 지우므로). 짧으면
--   그 자체가 결함이다 — 빠진 표가 있으면 재적용 2회차가 DROP 을 다 지나간 뒤 그 표의 CREATE 에서
--   ERROR 1050 으로 죽고, 그때는 앞의 표들이 이미 지워진 뒤다(DDL 은 롤백이 없다). 빈 DB 에 새로
--   짓는 경로에서는 드러나지 않으니, 표를 더할 때 여기를 같이 고치는 것을 잊지 말 것.
--   (2026-08-31 에 cal_report_* 세 표를 더하면서 실제로 그 상태가 됐고, 재적용 2회차 오류 0 을
--    실측해 닫았다 — 자식→부모 순이라 cal_report_hours 가 cal_report_daily 보다 먼저다.)
--
-- ★ 폐지된 표도 지운다. cal_audit_trash 는 감사 트리거와 함께 폐기됐지만(설계 §7.5),
--   그 전에 이 키트를 한 번이라도 돌린 DB 에는 실물이 남아 있다. '안 만든다'만으로는
--   사라지지 않는다 — 지우는 문장이 없으면 고아 표로 살아남아 DB 의 cal_* 가 명부보다 하나 많아지고,
--   문서·GRANT·게이트는 명부 개수를 정본으로 삼아 서로 어긋난다.
--   ※ 숫자를 여기 적지 않는다. 명부는 늘어난다(2026-08-11 12개 → 2026-08-21 13개) — 숫자를 박아 두면
--     다음 사람이 '정본 파일이 13을 고장난 상태라고 하네' 하고 게이트를 거꾸로 되돌린다. 실제로
--     이 주석이 한 라운드 동안 그 상태로 남아 있었다. 정본은 아래 CREATE TABLE 목록 자신이다.
--   지운 뒤 다시 만들지 않으므로 이 줄은 영구히 남는다(재적용마다 무해하게 반복).
-- ★ cal_task_hours 가 2026-08-24 부터 cal_category 를 FK 로 참조한다 — DROP 순서에서 cal_category
--   **앞**에 있어야 한다. 아래는 이미 그 순서다(cal_task_hours 가 위쪽). 순서를 정리한답시고
--   알파벳순으로 바꾸면 재적용이 ERROR 3730 으로 죽는다.
DROP TABLE IF EXISTS cal_audit_trash;   -- 폐지(§7.5). 옛 배포분 정리용 — 재생성하지 않는다
DROP TABLE IF EXISTS cal_schema_meta;   -- FK 없음 — 순서 무관
DROP TABLE IF EXISTS cal_migration_log;
DROP TABLE IF EXISTS cal_user_rev;
DROP TABLE IF EXISTS cal_report_hours;      -- cal_report_daily 를 참조 — 자식 먼저
DROP TABLE IF EXISTS cal_report_daily;
DROP TABLE IF EXISTS cal_report_weekly;     -- 자식 없음
DROP TABLE IF EXISTS cal_user_pref;
DROP TABLE IF EXISTS cal_attendance;
DROP TABLE IF EXISTS cal_task_hours;         -- cal_category 를 참조(2026-08-24 신설 FK)
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
--
-- ★ 2026-08-24 키 전환: PK 가 (login_id, id) → (user_id, cat_no) 로 바뀌었고, 옛 id 는
--   uid 컬럼 + uq_cal_category_uid(user_id, uid) 로 내려왔다. 앱이 보는 신원은 여전히 uid 다(G-1).
CREATE TABLE cal_category (
  user_id      SMALLINT UNSIGNED NOT NULL,   -- 소유자(app_user.user_id). 개명은 app_user 한 행의 UPDATE 로 끝난다 — 이 표는 손대지 않는다
  cat_no       INT UNSIGNED      NOT NULL,   -- 사용자 안에서 유일한 과제 번호. AUTO_INCREMENT 아님 — 할당 규칙은 계약 H-1
  -- 앱이 만든 문자열 id 원문. 개인=c-<uuid>(38자), 공식=db-<project.uid>(39자). 대소문자 구분(_bin).
  -- ★ 전역 UNIQUE 가 아니다 — 공식 과제 id 는 89명이 같은 값을 갖는다(계약 H-4). UNIQUE(user_id, uid) 다.
  uid          VARCHAR(80)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,          -- 앱의 category.id 원문
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
  -- ★ 값의 출처 = uid 접두 제거. XML 에 대응 속성이 전혀 없어 이관 도구가 파생해야 한다(§8).
  --   규칙: source='db' 이면 project_uid = SUBSTRING(uid, 4).
  --   단 uid 가 'db-' 로 시작하고 나머지가 정확히 36자일 때만(공식 과제 id 는 'db-'+project.uid, mapDbRows()).
  --   조건에 안 맞는 source='db' 행은 조용히 버리지 말고 이관 도구가 사람에게 보고하고 중단한다(§8 "버리지 않는다").
  --   왜 중단인가: fromXML 의 safeId(/^[A-Za-z0-9_-]{1,80}$/)가 id 를 재발급하면 접두가 사라져
  --   복원 근거가 영구 소실되는데, 그 상태로 넣으면 아래 chk_cal_category_projuid 가 3819 를 내고
  --   그 과제에 달린 일정·공수까지 함께 이관이 막힌다. 사람이 원본 XML 을 보고 정해야 하는 문제다.
  --   ※ cat_no 로는 이 파생을 할 수 없다 — 번호에는 접두가 없다. 근거는 언제나 uid 다.
  project_uid  CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL, -- 공식 과제가 가리키는 project.uid. FK 걸지 않음(§5.2). 콜레이션은 project.uid 와 일치해야 조인 가능
  -- ★★ '저장소를 쓰는 과제' 플래그 (설계 §4 · 2026-08-27 신설, schema_version 5) ★★
  --   1 = 이 과제는 git/svn 저장소를 쓴다. 0 = 안 쓴다.
  --
  --   ① **경로 문자열은 올리지 않는다.** 올리는 것은 이 비트 하나뿐이다(§4).
  --      gitRepo·svnRepo 는 DB 로 가지 않는 **유일한 항목**이다 — PC 마다 달라야 하는 값이고
  --      브라우저에는 개념 자체가 없다. 올리면 A자리의 'D:\repos\report' 가 B자리까지 따라와
  --      커밋 수집이 조용히 실패하고, 더 나쁜 경우 **경로는 유효한데 다른 저장소**라
  --      실패조차 안 하고 **남의 커밋이 내 보고서에 실린다.**
  --      → 경로의 보관처는 %APPDATA%\TaskCalendar\repo-paths.json (과제 uid 를 키로 하는 맵, §4).
  --        이 컬럼에 경로를 넣거나, 경로를 담을 컬럼을 옆에 새로 만들지 말 것.
  --
  --   ② **이 비트가 없으면 앱은 두 상태를 구분하지 못한다** — *"이 PC 에 경로가 없다"* 와
  --      *"저장소를 안 쓰는 과제다"*. 지금 기록 모달은 저장소가 없으면 「연동」 섹션을 통째로
  --      숨긴다(updateGitRow() 의 sect.classList.toggle('hidden', !show)). 일정이 DB 로 올라가면
  --      "A자리에서 보이던 커밋이 B자리에서 사라지는" 것이 일상이 되는데, 화면은 아무 말도 안 한다.
  --      그 자리에 *"이 PC 에는 이 과제의 저장소 경로가 설정되지 않았습니다 — [과제 관리]에서
  --      경로를 지정하세요"* 를 띄우려면 조건이 필요하다. 이 비트가 그 조건이다.
  --      비트가 없으면 그 안내는 **모든 과제에 뜨거나 아무 데도 안 뜬다** — 둘 다 안내가 아니다.
  --
  --   ③ **이 값은 과제의 성질이지 PC 의 성질이 아니다.** 그래서 DB 에 둔다.
  --      '이 PC 에 경로가 있나' 는 PC 의 성질이고 그건 repo-paths.json 이 답한다. 두 물음을
  --      한 저장소에 섞지 말 것 — 섞는 순간 ①의 사고가 그대로 돌아온다.
  --
  --   ④ DEFAULT 는 **0('안 쓴다')** 이다. 1 로 백필하면 ②의 안내가 모든 과제에 뜬다(설계 §5.5).
  --   ⑤ 누가 세우고 누가 지우나 — 쓰기 계층 계약은 아래 헤더 **I 부류**가 정본이다.
  uses_repo    TINYINT(1)   NOT NULL DEFAULT 0,                                         -- 저장소를 쓰는 과제인가. 1=쓴다/0=안 쓴다. ★ 경로 문자열이 아니다(위 ①). 앱으로는 category.usesRepo(boolean) 로 나간다(G-6)
  sort_order   INT          NOT NULL DEFAULT 0,                                         -- 화면 표시 순서. XML 문서 순서를 박제한 유일한 근거. ★ cat_no 와 다른 값이다(계약 E 의 ★)
  created_at   DATETIME(3)  NOT NULL,                                                   -- 생성 시각(UTC). 앱이 계산해 보낸다
  -- ★ 이관 규칙: updated_at = created_at 을 그대로 복사한다(원본이 없다).
  --   근거: toXML 의 category 직렬화에 updatedAt 속성이 없고 fromXML 이 만드는 객체에도 updatedAt 키가 없다.
  --   NOT NULL 무DEFAULT 라 이관 INSERT 가 그 자리에서 ERROR 1364 로 멈춘다.
  --   왜 '이관 시각'이 아닌가: 그러면 전 사용자의 모든 과제가 '방금 수정됨'이 되어, 부팅 직후 사용자가
  --   들고 있는 @prev 와 어긋나 첫 편집이 전부 낙관적 잠금 충돌 오탐이 된다.
  updated_at   DATETIME(3)  NOT NULL,                                                   -- 수정 시각(UTC). 낙관적 잠금 토큰 — 서버 자동 갱신 없음
  PRIMARY KEY (user_id, cat_no),
  -- ★ 이 UNIQUE 가 옛 PK(login_id, id) 의 역할을 그대로 이어받는다 — 같은 사람이 같은 과제 id 를
  --   두 번 만들 수 없다는 계약. 전역 UNIQUE 로 바꾸지 말 것(계약 H-4: 공식 과제는 89명이 같은 uid).
  UNIQUE KEY uq_cal_category_uid (user_id, uid),
  KEY ix_cal_category_user_sort (user_id, sort_order),
  -- 부모 방향 FK 의 자식 인덱스는 PK 의 선두(user_id)가 겸한다 — 별도 KEY 를 만들지 말 것(불필요한 인덱스).
  CONSTRAINT fk_cal_category_user FOREIGN KEY (user_id) REFERENCES app_user(user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,                 -- 사람이 지워질 때 캘린더가 조용히 사라지면 안 된다(퇴사 처리는 app_user.is_active=0)
  -- ★ 이 제약은 아래 chk_cal_category_projuid 에 포섭되어 단독 발화하지 않는다 — source 가 두 값이 아니면
  --   projuid 쪽 두 분기가 먼저 모두 FALSE 가 되기 때문이다. 잘못된 source 는 실제로 'chk_cal_category_projuid'
  --   위반으로 보고된다(실측). 장애 대응 때 project_uid 문제로 오진하지 말 것.
  CONSTRAINT chk_cal_category_source  CHECK (source IN ('local','db')),
  CONSTRAINT chk_cal_category_color   CHECK (color REGEXP '^#[0-9a-fA-F]{6}$'),
  -- uid 는 NOT NULL 이므로 이 식은 NULL 을 낳지 않는다. _bin(PAD SPACE)이라 공백만인 값도 함께 막힌다.
  CONSTRAINT chk_cal_category_uid     CHECK (uid <> ''),
  -- 불리언 컬럼은 값 집합을 CHECK 로 못박는다(cal_entry.all_day·cal_todo.done 과 같은 관례).
  -- NOT NULL 이 함께 있어야 실제 방벽이 된다 — MySQL 의 CHECK 는 식이 NULL 이면 통과시킨다(§5.1 ★).
  CONSTRAINT chk_cal_category_usesrepo01 CHECK (uses_repo IN (0,1)),
  -- 공식 과제인데 project_uid 가 없으면 §6 의 LEFT JOIN 이 항상 db_gone 을 뱉는다. 반대로 개인 과제에
  -- project_uid 가 붙으면 남의 과제명을 끌어다 쓰게 된다. 두 방향을 다 막는다.
  --
  -- ★ 2026-08-24 강화 — 예전에는 source='db' 일 때 project_uid 의 **NULL 여부만** 봤다.
  --   그래서 uid='db-aaaa…' 인데 project_uid='ffff…' 인 **어긋난 쌍**이 조용히 들어갔고(실측: 통과),
  --   그 행은 §6 의 LEFT JOIN 에서 **남의 과제명**을 끌어온다. 위 주석이 이미 정본 규칙
  --   (source='db' → project_uid = SUBSTRING(uid,4))을 적어 두었는데 검사만 없던 상태였다.
  --   이제 그 규칙을 CHECK 로 직접 강제한다. 실측으로 가능함을 확인했고, 세는 함정이 있었다:
  --     ① 콜레이션이 서로 다르다(uid=utf8mb4_bin, project_uid=utf8mb4_0900_ai_ci). 그냥 '=' 로 써도
  --        CREATE 는 되지만 어느 쪽 콜레이션이 이기는지가 암묵 규칙에 달린다(실측상 _bin 이 이겨
  --        대소문자를 구분했다). 암묵에 기대지 않으려고 COLLATE 를 **명시**한다.
  --     ② PAD SPACE 구멍 — utf8mb4_bin 으로 비교하면 uid 끝의 공백이 접혀
  --        uid='db-<35자> ' + project_uid='<35자>' 조합이 **통과한다**(실측: 통과 = 구멍).
  --        utf8mb4_0900_bin(NO PAD)으로 비교하면 막힌다(실측: ERROR 3819). 그래서 0900_bin 이다.
  --     ③ 길이·접두를 따로 본다. 등호만으로는 uid 가 'db-' 로 시작하지 않아도(예: 'xx-…')
  --        SUBSTRING(uid,4) 가 우연히 맞을 수 있다. 정본 규칙의 단서('db-' + 정확히 36자)를 그대로 옮긴다.
  --   ★ 이 식은 NULL 을 낳지 않는다 — source·uid 는 NOT NULL 이고 project_uid 는 비교 **전에**
  --     IS NOT NULL 로 걸러진다. 'MySQL CHECK 는 NULL 이면 통과' 함정에 해당하지 않는다.
  --     실측 전수(8.4.9, 격리 DB): INSERT 9종 · UPDATE 9종. 특히 UPDATE 로 한 컬럼씩 미는 경로가
  --     전부 3819 다 — project_uid 만 바꾸기 · uid 만 바꾸기 · source 만 바꾸기 · project_uid 만 NULL 로.
  --     정상 경로(uid 와 project_uid 를 짝 맞춰 함께 UPDATE / local↔db 승격)는 통과한다.
  --   ※ 왜 migrate-*.sql 이 아니라 이 파일에서 고치는가: 이 CHECK 가 붙은 표는 이번 키 전환으로
  --     어차피 통째로 다시 만들어진다(schema_version 3). v3 로 만들어진 DB 는 아직 없으므로
  --     '이미 배포된 DB 와 어긋난다' 는 이 파일의 금기에 해당하지 않는다. v3 가 한 번이라도 배포된
  --     뒤에 이 식을 또 바꾸고 싶어지면 그때는 migrate-*.sql 이다.
  CONSTRAINT chk_cal_category_projuid CHECK (
       (source = 'db'
        AND project_uid IS NOT NULL
        AND CHAR_LENGTH(uid) = 39
        AND SUBSTRING(uid, 1, 3) = 'db-'
        AND project_uid COLLATE utf8mb4_0900_bin = SUBSTRING(uid, 4))
    OR (source = 'local' AND project_uid IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='캘린더 과제(카테고리). source=local(개인)/db(공식). PK=(user_id,cat_no), 앱 id 는 uid(user_id 안에서 UNIQUE).';

-- =====================================================================
--  2. cal_entry — 일정
-- =====================================================================
-- XML <entry> 대응(반복 규칙은 recur_* 컬럼으로 평탄화).
-- §3.3 낙관적 잠금의 기준 행이자 except/commit 자식의 잠금 단위.
CREATE TABLE cal_entry (
  user_id        SMALLINT UNSIGNED NOT NULL,  -- 소유자(app_user.user_id)
  entry_no       INT UNSIGNED      NOT NULL,  -- 사용자 안에서 유일한 일정 번호. 할당 규칙은 계약 H-1
  uid            VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,  -- 앱의 entry.id 원문. e-<uuid>(38자). 반복 일정의 시리즈 id 로도 쓰인다
  -- NULL = 미분류. 앱은 '' 를 만들지 않는다(전 경로 `|| null`) — 헤더 A ③ 참조.
  -- ★ 단 fromXML 은 실재하지 않는 과제 id 를 그대로 남긴다. 그 id 로는 cat_no 를 만들 수 없으므로
  --   해석 실패가 되고, 처리 규칙은 계약 H-3 에 있다(런타임=NULL 로 낮추고 알림, 이관=중단·보고).
  cat_no         INT UNSIGNED NULL DEFAULT NULL,                                          -- 소속 과제 번호. NULL = 미분류. 앱으로 돌려줄 때는 그 과제의 uid 로 되돌린다(G-1)
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
  -- ★ 왜 두는가 — §5.3 이 cal_category 에 sort_order 를 둔 것과 **정확히 같은 상황**이다.
  --   '배열 순서는 created_at 으로 복원하면 된다' 는 가정이 실측에서 깨졌다(사용자 실 data.xml, 2026-08-27):
  --     · 일정 23건 중 **22건이 같은 밀리초**다(2026-06-23T04:45:32.051Z — 옛 localStorage 승격분이 한 번에 찍혔다).
  --     · (entry_date, created_at) 쌍으로 묶어도 동률 그룹이 2개 남는다: 2026-06-22 의 3건 · 2026-06-23 의 2건.
  --       그 3건은 두 값이 **완전히 같아** 어떤 보조정렬로도 갈라지지 않는다 — 문서 순서 [wk3, e22a, e22b] 가
  --       이관 후 [e22a, e22b, wk3] 로 뒤바뀌는 것을 재현했다(tests/calendar-adapter.mjs).
  --   ★ '화면이 렌더할 때 다시 정렬하니 배열 순서는 아무래도 좋다' 는 반론은 틀렸다 — 그 정렬(entrySort)도
  --     created_at 에서 끝나고 JS sort 는 **안정 정렬**이라, 동률이면 배열 순서가 그대로 화면에 새어 나온다.
  --   ★ entry_no 로 대체하지 말 것 — 번호는 '만들어진 순서'이고 삭제 후 재사용된다(H-1). 계약 G-5 가 금지한다.
  --   ★ entry_date 로 대체할 수도 없다 — fromXML 의 entries 배열은 문서 순서이고 날짜순이 아니다.
  --     그래서 이 컬럼이 생기면서 부팅 조회의 ORDER BY 에서 entry_date 가 빠졌다(G-5 의 2026-08-27 정정).
  sort_order     INT          NOT NULL DEFAULT 0,          -- 화면 표시 순서(= state.entries 배열 순서). XML 문서 순서를 박제한 유일한 근거. ★ entry_no 와 다른 값이다(계약 E 의 ★)
  created_at     DATETIME(3)  NOT NULL,                    -- 생성 시각(UTC)
  updated_at     DATETIME(3)  NOT NULL,                    -- 수정 시각(UTC). 낙관적 잠금 토큰 — 자식 테이블 변경 시에도 같은 트랜잭션에서 올린다
  PRIMARY KEY (user_id, entry_no),
  UNIQUE KEY uq_cal_entry_uid (user_id, uid),              -- 옛 PK(login_id,id) 의 유일성 계약을 이어받는다
  -- ★ 이 인덱스는 **부팅 조회용이 아니다.** 부팅 조회는 ORDER BY sort_order, uid 이고 entry_date 를
  --   정렬키로 쓰지 않는다(G-5 의 2026-08-27 정정). 이건 월/주 화면의 날짜 범위 조회용으로 남는다.
  KEY ix_cal_entry_user_date (user_id, entry_date),        -- 월/주 화면의 날짜 범위 조회
  -- ★ 순서 전용 인덱스((user_id, sort_order))를 새로 만들지 말 것. 부팅 조회의 ORDER BY 가
  --   sort_order, **uid** 로 끝나기 때문에 인덱스로는 정렬이 끝나지 않는다.
  --   실측(8.4.9, 90명×60건 = 5,400행, ANALYZE 후 EXPLAIN): 후보 인덱스를 만들어도
  --   key=PRIMARY · **Using filesort** 그대로였다. 이득을 보려면 uid 티브레이커를 버려야 하는데,
  --   그건 G-5 의 ★(결정성)을 버리는 거래라 하지 않는다. 사용자당 수십 행의 filesort 는 무시할 수 있고,
  --   인덱스는 쓰기마다 유지 비용을 문다.
  --   ※ 선례(cal_category)의 ix_cal_category_user_sort 도 같은 이유로 부팅 조회에서는 쓰이지 않는다(실측:
  --     그 인덱스가 있는데도 key=PRIMARY · Using filesort). 대칭으로 만들면 아무도 안 쓰는 인덱스만 는다.
  KEY ix_cal_entry_user_cat  (user_id, cat_no),            -- 과제별 조회 + 아래 복합 FK 의 자식 인덱스
  CONSTRAINT fk_cal_entry_user FOREIGN KEY (user_id) REFERENCES app_user(user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- 부모(과제) 방향은 RESTRICT — 과제를 지우면 그 일정도 같이 사라지는 게 아니라, 앱이 먼저
  -- 일정의 cat_no 를 정리하도록 강제한다(CASCADE/RESTRICT 혼동이 사고의 원인이었다).
  -- 앱의 deleteCategory() 가 실제로 그렇게 한다: 먼저 `e.categoryId = null` 로 전부 풀고 과제를 지운다.
  CONSTRAINT fk_cal_entry_category FOREIGN KEY (user_id, cat_no) REFERENCES cal_category(user_id, cat_no)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_cal_entry_uid      CHECK (uid <> ''),
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
  COMMENT='일정. PK=(user_id,entry_no), 앱 id 는 uid. 반복은 recur_* 로 평탄화. updated_at=낙관적 잠금 토큰.';

-- =====================================================================
--  3. cal_entry_except — 반복 일정의 예외일(삭제된 회차)
-- =====================================================================
-- XML <recur><except> 대응. 날짜 자체가 값이라 UPDATE 개념이 없다(추가/삭제만).
-- ★ 이 표는 자기 번호(_no)도 uid 도 갖지 않는다 — 부모 일정 안으로 접히는 값이고(G-5),
--   앱에는 entry.recurExcept 문자열 배열로만 나타난다. 신원은 (부모, 날짜) 로 충분하다.
CREATE TABLE cal_entry_except (
  user_id     SMALLINT UNSIGNED NOT NULL,   -- 소유자 (부모에서 전파)
  entry_no    INT UNSIGNED      NOT NULL,   -- 부모 일정 번호
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
  PRIMARY KEY (user_id, entry_no, except_date),
  -- CASCADE 인 이유: 예외일은 부모 일정 없이는 뜻이 없는 값이고, 앱은 일정을 지울 때 이 행들을
  -- 따로 지우지 않는다 — recurExcept 는 entry 객체 **안에** 든 배열이고 deleteEntry() 는 그 객체를
  -- state.entries 에서 걷어내는 한 줄이 전부다(직접 확인). 즉 어댑터는 cal_entry 에 DELETE 한 문장만
  -- 낸다. RESTRICT 로 두면 그 한 문장이
  -- ERROR 1451 로 실패한다. 부모 방향(category)의 RESTRICT 와 혼동하지 말 것 — 여기는 부모 일정과
  -- 생사를 같이한다.  ※ 예전 근거였던 '§7.5 부모 트리거가 자식을 JSON 으로 흡수한다'는 2026-08-11
  -- 감사 트리거 폐지로 사라졌다. CASCADE 결정 자체는 위 이유로 그대로 유지된다.
  -- ★ PK 의 선두 (user_id, entry_no) 가 이 FK 의 자식 인덱스를 겸한다 — 별도 KEY 불필요.
  CONSTRAINT fk_cal_entry_except_entry FOREIGN KEY (user_id, entry_no) REFERENCES cal_entry(user_id, entry_no)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='반복 일정의 예외일. PK=(user_id,entry_no,except_date). 부모 삭제 시 CASCADE. UPDATE 없음.';

-- =====================================================================
--  4. cal_entry_commit — git/svn 커밋 목록
-- =====================================================================
-- XML <commits><commit> 대응. 부팅 조회에서 제외하고 커밋 화면·보고서를 열 때만 지연 조회한다(§2).
-- ★ 이 표도 자기 번호(_no)·uid 를 갖지 않는다 — 부모 안의 배열이고 신원은 (부모, seq) 다.
CREATE TABLE cal_entry_commit (
  user_id     SMALLINT UNSIGNED NOT NULL,   -- 소유자 (부모에서 전파)
  entry_no    INT UNSIGNED      NOT NULL,   -- 부모 일정 번호
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
  PRIMARY KEY (user_id, entry_no, seq),
  KEY ix_cal_entry_commit_hash (user_id, hash),   -- 재수집 시 이미 있는 커밋인지 판정
  CONSTRAINT fk_cal_entry_commit_entry FOREIGN KEY (user_id, entry_no) REFERENCES cal_entry(user_id, entry_no)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='일정에 붙은 커밋 목록. PK=(user_id,entry_no,seq). 부팅 조회 제외(지연 로드). seq=배열 인덱스 0-base.';

-- =====================================================================
--  5. cal_todo — 할 일
-- =====================================================================
-- XML <todo> 대응. end_date 유무로 단일/기간 할일이 갈리고 설명 저장소가 note ↔ day_note 로 바뀐다.
CREATE TABLE cal_todo (
  user_id      SMALLINT UNSIGNED NOT NULL,   -- 소유자(app_user.user_id)
  todo_no      INT UNSIGNED      NOT NULL,   -- 사용자 안에서 유일한 할 일 번호. 할당 규칙은 계약 H-1
  uid          VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,   -- 앱의 todo.id 원문. t-<uuid>(38자)
  cat_no       INT UNSIGNED NULL DEFAULT NULL,             -- 연결된 과제 번호. NULL 허용(미분류). 앱으로는 uid 로 되돌린다(G-1)
  todo_text    VARCHAR(200) NOT NULL,                     -- 할 일 본문 한 줄(공백 축약·trim). 빈 값이면 앱이 항목 자체를 폐기. 폼 #todoInput/.te-text maxlength=200 과 정확히 같다(fromXML 절단 없음 — name 과 같은 단서)
  -- 폭 재판정: TEXT → MEDIUMTEXT. 할일 설명 textarea(#qaMemo)에 maxlength 가 없다(memo 와 같은 이유).
  note         MEDIUMTEXT   NOT NULL DEFAULT (''),        -- 단일 할일의 전역 설명(여러 줄). 기간 할일이면 항상 ''
  due          DATE         NULL DEFAULT NULL,            -- 기한(단일) 또는 시작일(기간). NULL=기한없음
  end_date     DATE         NULL DEFAULT NULL,            -- 기간 할일 종료일. due 가 있고 due 보다 클 때만 존재
  done         TINYINT(1)   NOT NULL DEFAULT 0,           -- 완료 여부
  prio         VARCHAR(8)   CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT 'normal',  -- 중요 표시 2단계. XML 은 normal 을 기록하지 않음(속성 부재=normal). _bin — 'HIGH' 가 통과하면 앱의 prio==='high' 가 조용히 '보통'으로 읽는다
  completed_at DATETIME(3)  NULL DEFAULT NULL,            -- 완료 시각(UTC). done=0 이면 반드시 NULL. 보고서 '한 일' 기간 필터 키
  -- ★ 왜 두는가 — cal_entry.sort_order 와 같은 근거이고, 여기가 더 심하다.
  --   실측(사용자 실 data.xml, 2026-08-27): 할 일 **7건 중 5건이 같은 밀리초**다(2026-06-23T04:45:32.051Z).
  --   일정은 그나마 entry_date 라는 1차 정렬키가 동률 그룹을 잘게 쪼개 주지만, 할 일에는 그런 축이 없다 —
  --   due 는 NULL(기한 없음)이 정상 상태라 정렬키로 못 쓴다(계약 G-5 의 cal_todo 줄이 '…' 로 열려 있던 이유).
  --   즉 sort_order 가 없으면 할 일 배열 순서는 **복원 수단이 아예 없다.**
  --   ★ 화면의 sortS() 도 created_at 에서 끝나고 JS sort 는 안정 정렬이라, 동률이면 배열 순서가 그대로 보인다.
  --   ★ todo_no 로 대체하지 말 것 — 재사용되는 번호다(H-1, G-5 ★).
  sort_order   INT          NOT NULL DEFAULT 0,           -- 화면 표시 순서(= state.todos 배열 순서). XML 문서 순서를 박제한 유일한 근거. ★ todo_no 와 다른 값이다(계약 E 의 ★)
  created_at   DATETIME(3)  NOT NULL,                     -- 생성 시각(UTC)
  updated_at   DATETIME(3)  NOT NULL,                     -- 수정 시각(UTC). 낙관적 잠금 토큰이자 day_note 자식의 잠금 단위
  PRIMARY KEY (user_id, todo_no),
  UNIQUE KEY uq_cal_todo_uid (user_id, uid),              -- 옛 PK(login_id,id) 의 유일성 계약을 이어받는다
  KEY ix_cal_todo_user_due (user_id, due),
  -- ★ ix_cal_todo_user_sort (user_id, sort_order) 를 만들지 말 것 — cal_category·cal_room 에는 있지만
  --   여기서는 쓰이지 않는다. 부팅 조회의 ORDER BY 가 sort_order, **uid** 라 인덱스로 정렬이 끝나지 않고,
  --   실측(8.4.9, 90명×40건 = 3,600행, ANALYZE 후 EXPLAIN)에서 그 인덱스를 만들어도 key=PRIMARY ·
  --   **Using filesort** 그대로였다(전 컬럼 조회 모양·축약 모양 둘 다). 근거는 cal_entry 의 같은 ★ 를 볼 것.
  -- ※ ix_cal_todo_user_due 도 부팅 조회용이 아니다 — due 는 정렬키가 아니다(NULL=기한 없음이 정상 상태).
  KEY ix_cal_todo_user_cat (user_id, cat_no),             -- 아래 복합 FK 의 자식 인덱스 겸용
  CONSTRAINT fk_cal_todo_user FOREIGN KEY (user_id) REFERENCES app_user(user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_cal_todo_category FOREIGN KEY (user_id, cat_no) REFERENCES cal_category(user_id, cat_no)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_cal_todo_uid     CHECK (uid <> ''),
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
  COMMENT='할 일. PK=(user_id,todo_no), 앱 id 는 uid. end_date 유무로 단일/기간이 갈린다.';

-- =====================================================================
--  6. cal_todo_day_note — 기간 할일의 날짜별 설명
-- =====================================================================
-- XML <dayNotes><dayNote> 대응. 보고서 '한 일' 라인의 원천. 빈 값 저장 = 행 삭제 계약.
-- ★ 자기 번호(_no)·uid 없음 — 부모 안의 맵이고 신원은 (부모, 날짜) 다(G-5).
CREATE TABLE cal_todo_day_note (
  user_id   SMALLINT UNSIGNED NOT NULL,   -- 소유자 (부모에서 전파)
  todo_no   INT UNSIGNED      NOT NULL,   -- 부모 할 일 번호
  note_date DATE NOT NULL,                                                          -- 설명이 붙는 날짜. 앱이 due <= date <= (end_date||due) 범위를 강제(DB 로는 표현 불가)
  -- 폭 재판정: TEXT → MEDIUMTEXT. 이 화면의 편집 textarea 는 maxlength=500 이지만 그게 상한이 아니다 —
  --   addTodo()가 단일→기간 전환 시 무제한 note 를 통째로 dayNotes[due] 로 옮긴다. note 와 상한이 같아야 한다.
  note_text MEDIUMTEXT NOT NULL,                                                    -- 그 날짜의 설명(trim 된 값). 빈 문자열이면 행을 두지 않는다
  PRIMARY KEY (user_id, todo_no, note_date),
  CONSTRAINT fk_cal_todo_day_note_todo FOREIGN KEY (user_id, todo_no) REFERENCES cal_todo(user_id, todo_no)
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
  COMMENT='기간 할일의 날짜별 설명. PK=(user_id,todo_no,note_date). 빈 값=행 삭제. 부모 삭제 시 CASCADE.';

-- =====================================================================
--  7. cal_room — 장소(회의실) 빠른선택 목록
-- =====================================================================
-- XML <rooms><room> 대응. 이름 자체가 값이라 id 가 없고, 표시 순서는 배열 순서뿐이라 sort_order 로 박제한다.
-- ★ 행 0개 = '빈 목록' 으로 확정. DEFAULT_ROOMS 재주입은 DB 전환과 함께 폐기한다
--   (DB 에서는 '한 번도 없었음'과 '사용자가 전부 지움'을 구분할 수 없기 때문).
--
-- ★★ 2026-08-24 판정 — 이 표만 대리키로 가지 않는다. PK 는 (user_id, name) 을 유지한다.
--   다른 12표와 다르게 가는 이유를 근거로 남긴다(다음 사람이 '일관성'을 이유로 되돌리지 못하게):
--     ① 이번 전환이 고치려던 병이 여기엔 없다. 병은 'login_id 라는 외부 소유 값이 PK 라 개명이
--        막힌다' 였고, 그 축은 user_id 로 옮기면서 이미 나았다. name 은 우리(사용자)가 소유한
--        값이고, 이 표를 FK 로 참조하는 자식이 **하나도 없다** — 즉 값이 바뀌어도 전파할 곳이 없다.
--     ② 넣을 uid 가 없다. 앱의 rooms 는 객체가 아니라 **문자열 배열**이다(G-5).
--        room_no 를 만들면 앱이 영원히 읽지 않는 컬럼이 하나 늘 뿐이고, uid 를 만들려면
--        원문이 없는 값을 지어내야 한다 — 'uid = 앱이 만든 id 원문 보존' 이라는 이 전환의 규칙 자체와 어긋난다.
--     ③ 중복 금지가 PK 로 강제되고 있었다. 대리키로 가면 그 강제는 UNIQUE(user_id, name) 로 옮겨야
--        하는데, 그러면 인덱스가 하나 늘고 얻는 것은 0 이다(막는 힘은 완전히 같다).
--     ④ 제자리 UPDATE 경로가 없다(아래 ★ updated_at 절의 근거와 같다). 자연키의 고질병인
--        'PK 를 고쳐야 하는 상황'이 이 표에는 존재하지 않는다 — 변경은 추가/삭제뿐이다.
--     ⑤ 규모가 작다. 사용자당 최대 50행, name 40자 — 폭으로 인한 인덱스 부담이 실질적으로 0 이다.
--   ※ 재검토 조건: 이 표를 참조하는 자식 표가 생기거나(예: 일정이 회의실을 FK 로 가리키게 되거나),
--     '이름 바꾸기' 기능이 생기면 그때 대리키로 갈 것. 그 두 경우에는 ①·④ 가 무너진다.
--
-- ★ updated_at 을 일부러 두지 않는다(§3.3 낙관적 잠금의 명시적 예외).
--   근거: 이 테이블은 엔티티가 아니라 키 (user_id, name) 으로 주소지정되는 값 행이다. 이름 자체가 값이라
--   '같은 행을 두 사람이 서로 다르게 고치는' 상황이 성립하지 않는다(변경 = 추가/삭제뿐, UPDATE 경로가 없다).
--   같은 사용자의 동시 쓰기는 §3.1 의 cal_user_rev 락이 이미 직렬화한다.
--   설계 §3.3 도 이 테이블을 낙관적 잠금 대상으로 지목하지 않았다.
--   재검토 조건: 이 테이블에 '행을 제자리에서 수정하는' 기능(이름 변경 등)이 생기면 그때 컬럼을 추가할 것.
CREATE TABLE cal_room (
  user_id    SMALLINT UNSIGNED NOT NULL,   -- 소유자(app_user.user_id)
  name       VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,  -- 회의실/장소 이름. 앱이 공백축약·trim·40자 절단·중복 제거. 중복 판정이 정확 일치라 _bin
  sort_order INT NOT NULL DEFAULT 0,                                                 -- 표시 순서(XML 문서 순서 박제). 최대 50개
  PRIMARY KEY (user_id, name),
  KEY ix_cal_room_user_sort (user_id, sort_order),   -- G-5 의 ORDER BY sort_order 조회용
  CONSTRAINT fk_cal_room_user FOREIGN KEY (user_id) REFERENCES app_user(user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- ★ 이 CHECK 는 cal_todo_day_note.chk_cal_todo_day_note_text 와 모양이 같지만 더 넓게 막는다 —
  --   name 이 utf8mb4_bin(PAD SPACE)이라 비교 시 공백을 접기 때문이다. 실측(8.4.9): name='   ' → ERROR 3819.
  --   같은 이유로 PK 도 '회의실A' 와 '회의실A  ' 를 같은 키로 본다(실측: ERROR 1062). 의도된 동작이다 —
  --   앱도 normRooms() 에서 공백 축약·trim 후 중복 제거를 하므로 DB 쪽이 한 겹 더 좁을 뿐이다.
  --   ※ 개행·탭만 있는 이름은 PAD SPACE 도 접지 않아 통과한다. 그쪽은 어댑터(JS trim)가 막는다.
  CONSTRAINT chk_cal_room_name CHECK (name <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='장소(회의실) 빠른선택. PK=(user_id,name) — 이 표만 자연키 유지(표 머리 ★★ 판정). 행 0개=빈 목록.';

-- =====================================================================
--  8. cal_task_hours — (날짜 × 과제) 투입 시간
-- =====================================================================
-- XML <taskHours><day><t> 대응. 회사 일간/주간보고 '[과제명] : n' 계약의 원천.
-- 값 0/빈값은 0 저장이 아니라 행 삭제다(setTaskHours). 그래서 hours > 0 CHECK 와 DELETE 권한이 한 쌍이다.
-- ★ 바로 아래 9. cal_attendance 가 같은 규약을 쓴다('미기록 = 행 없음'). 두 표는 같은 코드 경로로 다룰 것 —
--   한쪽만 '빈 값을 저장'으로 구현하면 보고서 한 줄이 조용히 틀린 채 회사 시스템으로 나간다.
--
-- ★ 2026-08-11 결정: 공수의 단일 소스는 이 표 하나다. 옛 cal_entry.hours_min(일정 단위 분)은 폐지했다 —
--   채우는 UI 도 자동계산도 없었고 회사 일간보고에도 들어가지 않았다. 두 자리에 공수가 있으면
--   '어느 쪽이 맞는가'를 사람이 매번 판정해야 한다. 되살릴 조건은 헤더의 entry@hours 절에 적어 두었다.
--
-- ★★ 2026-08-24 판정 — 과제 참조에 **FK 를 건다**(전환 전에는 FK 가 없었다).
--   ※ 설계 문서와 어긋난다. db/CALENDAR-TABLE-DESIGN.md §5.2 의 표는 이 컬럼에 대해
--     "FK 걸지 않음 / 과제를 지워도 지난 공수 기록은 남아야 한다(집계 이력)" 이라고 적고 있다.
--     **문서가 앱과 다르다.** 문서 담당이 그 줄을 고칠 것 — 아래가 직접 읽고 확인한 근거다.
--   ① 앱은 과제를 지울 때 그 과제의 공수 행을 **함께 지운다.** deleteCategory() 가
--      loadTaskHoursMap() 을 돌며 `delete day[id]` 하고 빈 날짜까지 정리한다(직접 확인).
--      즉 '지워도 남는다'는 동작은 앱에 존재한 적이 없다. 문서 쪽이 사실과 달랐다.
--   ② 키 전환으로 '미아 행'이라는 상태 자체가 **표현 불가능**해졌다. 옛 컬럼은 문자열 id 라
--      존재하지 않는 과제를 가리키는 값을 그냥 담을 수 있었지만, cat_no 는 번호다 —
--      존재하지 않는 과제에는 줄 번호가 없다. FK 를 안 걸어도 미아를 만들 수 없고,
--      안 걸면 '아무 번호나 들어갈 수 있는 NOT NULL 정수' 라는 더 나쁜 상태가 된다.
--   ③ 그래서 방향은 RESTRICT 다(CASCADE 아님). cal_entry·cal_todo 의 과제 FK 와 같은 방향으로 맞춘다.
--      CASCADE 로 하면 과제 하나를 지울 때 회사 일간보고에 나가는 숫자가 **조용히 여러 달치 사라진다.**
--      이 DB 에는 감사 휴지통이 없어(2026-08-11 폐지) 되돌릴 수단이 주간 mysqldump 뿐이다.
--      RESTRICT 면 어댑터가 순서를 틀렸을 때 ERROR 1451 로 시끄럽게 멈춘다 — 이 파일의 일관된 취향이다.
--   ★ 그 대가로 **어댑터가 지켜야 할 순서가 하나 생겼다**: 과제 삭제 트랜잭션은
--        (1) cal_entry.cat_no·cal_todo.cat_no 를 NULL 로,
--        (2) cal_task_hours 의 그 cat_no 행을 DELETE,
--        (3) 마지막에 cal_category 행을 DELETE.
--      ★ 앱 메모리에서의 순서와 다르다 — deleteCategory() 는 배열에서 과제를 먼저 걷어내고 공수를 나중에
--        정리한다. 그 순서를 그대로 SQL 로 옮기면 (3) 이 (2) 보다 앞서 1451 로 죽는다. 순서를 뒤집을 것.
--   ※ 사용자에게 보이는 문구와도 어긋난다(고칠 대상): 과제 삭제 확인 대화상자는 "이 과제에 속한 N개
--     기록은 '미분류'로 변경됩니다. (기록 자체는 유지)" 라고만 말하고 공수가 함께 지워진다는 말은 없다.
--     N 도 일정 수만 센다. 앱 담당이 문구에 공수 삭제를 명시할 것(이 파일 범위 밖).
--
-- ★ updated_at 을 일부러 두지 않는다(§3.3 낙관적 잠금의 명시적 예외). cal_room 과 같은 근거다:
--   엔티티가 아니라 키 (user_id, work_date, cat_no) 로 주소지정되는 값 행이고, 같은 사용자의
--   동시 쓰기는 §3.1 rev 락이 직렬화한다. 설계 §3.3 도 이 테이블을 지목하지 않았다.
--   ※ 그 대가는 인정한다 — 두 PC 를 쓰는 사람이 같은 (날짜×과제) 칸을 동시에 고치면 마지막 쓰기가
--     이긴다(실측: 스테일 UPDATE 가 ROW_COUNT=1 로 통과). 이 값은 회사 일간보고에 그대로 나간다.
--     ★ 사후 추적 수단은 이 DB 안에 없다(2026-08-11 감사 트리거 폐지). 남는 것은 주간 mysqldump 와
--       binlog 뿐이고, 둘 다 '언제 무엇이 바뀌었나'를 사람이 직접 파야 나온다. 없는 방어를 있다고
--       적지 않기 위해 그대로 적는다 — 이 표는 지금 '마지막 쓰기가 이기고, 추적은 백업으로만' 이다.
--   재검토 조건: 두 자리 동시 편집으로 공수가 어긋난 사고가 한 번이라도 보고되면 updated_at 컬럼을
--     추가하고 낙관적 잠금 대상으로 편입할 것.
CREATE TABLE cal_task_hours (
  user_id     SMALLINT UNSIGNED NOT NULL,   -- 소유자(app_user.user_id)
  work_date   DATE NOT NULL,                                                          -- 대상 날짜
  cat_no      INT UNSIGNED NOT NULL,        -- 과제 번호. ★ NULL 불가 — '미분류 공수' 라는 상태가 없다(계약 H-3)
  hours       DECIMAL(4,2) NOT NULL,                                                  -- 투입 시간(★시간 단위, 소수 2자리). 0 초과 24 이하. 앱은 0.5·0.25 같은 소수를 그대로 보낸다
  -- ★ 2026-08-26 신설 — §3.3 낙관적 잠금 토큰. 이 표는 엔티티가 아니라 '값 칸' 이라
  --   cal_entry·cal_todo 와 달리 타임스탬프가 없었다. 그런데 **덮어쓰기 사고는 값 칸에서도 똑같이 난다** —
  --   토큰이 없으면 PK 만으로 무조건 덮어쓰므로, 다른 환경에서 적은 값이 흔적 없이 사라지고
  --   사라졌다는 사실을 알 방법도 없다. 근태·공수는 회사 보고로 나가는 숫자라 조용한 유실이 특히 나쁘다.
  --   ※ 지금은 클라이언트가 위젯 하나뿐이라 발화하지 않는다. 브라우저가 붙는 순간부터 일한다.
  --     그때 컬럼을 추가하려면 실제 ALTER 가 되므로, 0행인 지금 미리 둔다.
  --   ★ 기본값·ON UPDATE 에 서버 함수(NOW(3)·CURRENT_TIMESTAMP)를 달지 않는다 — §5.3 '시각' 규칙.
  --     세션 time_zone 이 SYSTEM(KST)이면 앱이 보내는 UTC 값과 9시간이 한 컬럼에 영구 혼재되고
  --     DATETIME 은 사후 구분이 불가능하다. cal_entry·cal_todo 와 같이 **앱이 UTC 로 계산해 명시 대입**한다.
  updated_at  DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, work_date, cat_no),
  -- ★ PK 의 선두가 (user_id, work_date) 라 아래 FK 의 자식 인덱스가 되지 못한다 — 이 KEY 가 필요하다.
  --   겸사겸사 과제 삭제 시의 DELETE … WHERE user_id=? AND cat_no=? 도 이 인덱스를 쓴다.
  --   PK 를 (user_id, cat_no, work_date) 로 뒤집어 인덱스를 아끼자는 안은 기각했다 — 조회가
  --   날짜 범위 기준이다(보고서·부팅 조회 모두 날짜로 자른다).
  KEY ix_cal_task_hours_user_cat (user_id, cat_no),
  CONSTRAINT fk_cal_task_hours_user FOREIGN KEY (user_id) REFERENCES app_user(user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- ★ 2026-08-24 신설. 전환 전에는 FK 가 없었고 설계 §5.2 는 그 근거를 '과제를 지워도 지난 공수
  --   기록은 남아야 한다(집계 이력)' 라고 적었다 — **코드와 반대였다.** deleteCategory()
  --   (task-calendar-prototype.html:4516-4521)는 과제를 지울 때 그 과제의 (날짜×과제) 공수 행을
  --   전 날짜에서 함께 지운다("사라진 과제의 시간이 XML에 유령으로 남지 않게" — 그 함수의 주석).
  --   즉 '남는 이력' 은 구현된 적이 없다. 그리고 키 전환이 요구를 하나 더 만들었다: cat_no 는
  --   MAX()+1 이라 **번호가 재사용된다**(H-1). FK 가 없으면 지워진 과제의 공수 행이 나중에 같은
  --   번호를 받은 **다른 과제**의 공수로 조용히 흡수되고, 그 숫자는 회사 일간보고로 나간다.
  --   문자열 id(UUID) 시절에는 재사용이 없어 미아 행이 무해했지만 번호 키에서는 무해하지 않다.
  --   CASCADE 가 아니라 RESTRICT 인 이유: 캘린더에 소프트삭제가 없어 CASCADE 는 침묵 삭제와 같은
  --   말인데 이 값은 보고 숫자다. 앱이 이미 공수를 먼저 지우므로 정상 경로에서는 발화하지 않고,
  --   발화하면 그건 '앱이 순서를 어겼다' 는 신호다 — 그 신호를 죽이지 않는 쪽을 택했다.
  CONSTRAINT fk_cal_task_hours_category FOREIGN KEY (user_id, cat_no) REFERENCES cal_category(user_id, cat_no)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_cal_task_hours_range CHECK (hours > 0 AND hours <= 24)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='(날짜×과제) 투입 시간(시간 단위). PK=(user_id,work_date,cat_no). 과제 FK RESTRICT. 0=행 삭제.';

-- =====================================================================
--  9. cal_attendance — 날짜별 근태·초과시간
-- =====================================================================
-- XML <attendance><day date status overtime/> 대응. 회사 일간보고(netcus) 전송용 보조 메타다.
--
-- ★★ 가장 중요한 계약: **미기록 = 행 없음.** status='' 를 저장하지 않는다.
--   앱 쪽 정본은 setAttendance() 다 — 빈 값이거나 ATTEND_STATUS_SET 밖의 코드가 오면 값을 저장하는
--   대신 `delete m[date]` 로 그 날 기록을 지운다. 읽는 쪽 getAttendance() 는 기록이 없으면
--   status:null 을 돌려주고(정근 '1' 로 흡수하지 않는다), 호스트(NetcusService)는 null 을 받으면
--   회사 사이트의 기존 근태를 건드리지 않는 경로를 탄다.
--   → 그러므로 DB 에서도 '그 날은 미기록' 의 표현은 **행의 부재 하나뿐**이다. status='' 인 행은
--     '미기록'이 아니라 '알 수 없는 제3의 상태'가 되어, 조회한 앱이 그것을 유효 코드로 착각하거나
--     반대로 미기록으로 흡수해 버린다. 어느 쪽이든 netcus 에 직접 적어 둔 휴가·병가가 캘린더
--     일간보고 전송으로 '정근' 에 덮이는 사고(커밋 8adb1ab 가 고친 그 사고)로 되돌아간다.
--   → 어댑터·런타임 저장은 '미기록으로 되돌리기' 를 UPDATE 가 아니라 **DELETE** 로 구현한다.
--     이것이 이 표에 DELETE 권한이 필요한 유일한 이유다(grants-calendar.sql 이 같은 근거를 적는다).
--   cal_task_hours 의 '0 = 행 삭제' 와 정확히 같은 규약이다. 두 표를 같은 코드 경로로 다룰 것.
--   ※ 구조로도 막는다 — status 는 NOT NULL 이고 chk_cal_attendance_status 의 IN 목록에 '' 가 없다.
--     실측(8.4.9): status='' INSERT → ERROR 3819. 정상 행을 ''로 바꾸는 UPDATE → 같은 3819.
--
-- ★ 왜 DB 로 올리는가(설계 §4 의 '보류' 판정을 2026-08-21 뒤집었다):
--   옛 근거는 "12개 중 민감도 최고인데 타인 열람 요구 0" 이었는데 앞부분이 사실과 다르다.
--   회사 일간보고 URL 이 pjm_work_view.jsp?y&m&d&id 라 id 만 바꾸면 남의 것이 열리고, 좌측
--   조직도에 전 인원의 id 가 들어 있다(widget/NetcusService.cs · taskmgr-company-data/README.md).
--   즉 근태는 사내에 이미 열려 있는 값이라 '노출'이 뺄 이유가 되지 못한다. 반대로 올려서 얻는 것:
--   다른 자리 PC 에서도 근태가 유지되고, 로컬 data.xml 에만 있던 탓에 생기던 미기록/정근 혼동이
--   근본적으로 완화되며, 주·월 단위 근태 집계가 가능해진다.
--
-- ★ 이 표는 과제를 참조하지 않는다(근태는 날짜 단위다). 앱의 deleteCategory() 도 근태에는
--   손대지 않는다 — "근태는 날짜 단위라 그대로 둔다" 는 그 함수의 주석이 근거다.
--
-- ★ updated_at 을 일부러 두지 않는다(§3.3 낙관적 잠금의 명시적 예외). cal_task_hours·cal_room 과 같은 근거다:
--   엔티티가 아니라 키 (user_id, work_date) 로 주소지정되는 값 행이고, 같은 사용자의 동시 쓰기는
--   §3.1 rev 락이 직렬화한다. 대가도 같다 — 두 자리에서 같은 날을 고치면 마지막 쓰기가 이기고,
--   사후 추적 수단은 주간 mysqldump + binlog 뿐이다. 재검토 조건도 같다(사고가 한 번이라도 보고되면 추가).
CREATE TABLE cal_attendance (
  user_id   SMALLINT UNSIGNED NOT NULL,   -- 소유자(app_user.user_id)
  work_date DATE NOT NULL,                                                          -- 대상 날짜. 하루에 한 행
  -- 값 집합이 고정된 문자열이라 _bin 이다(헤더의 그 규칙). 테이블 기본(0900_ai_ci)을 상속하면
  -- 전각 '１' 이 CHECK 를 통과해 그대로 저장되고, 회사 사이트로 그 값이 그대로 전송된다.
  -- ★ 코드값은 netcus 근태 select 의 value 를 **그대로** 쓴다(앱이 가공 없이 전송한다). 임의로 채우지 말 것 —
  --   앱의 ATTEND_STATUS 배열을 직접 읽어 옮긴 전수 목록이고, ★ 8 이 없다(**드롭다운에** 그 코드가 없다).
  --   1=정근 2=야근 3=특근 4=외근 5=출장 6=휴가 12=반차 7=조퇴 9=지각 10=지각+야근 11=병가
  -- ★ 2026-08-26 — 주간보고 시스템의 실제 코드표(workstatus_tbl)를 검토자에게서 받아 대조했다. 두 가지가 다르다:
  --   ① **8=결근 은 그쪽 DB 에 실재한다.** 위 '없다' 는 드롭다운 기준이 맞다(자기 결근을 스스로 고르지
  --      않으므로 화면에 없다). 우리는 **쓰기만** 하므로 지금은 무해하다 — 다만 나중에 그쪽 근태를
  --      **읽어오는** 경로를 만들면 8 이 이 IN 목록에 없어 3819 로 막힌다. 그때 함께 넓힐 것.
  --   ② **12 를 그쪽 코드표는 '야근+식사' 라 적고 있다.** 우리(=드롭다운)는 '반차' 다. 실데이터가
  --      우리 쪽을 지지한다 — phmin 2026-08-19 행이 status=12 · overtime=0 인데 content 가
  --      '[휴가] : 4  - 오후 반차(08.19)' 다(야근이 0시간인데 '야근+식사' 일 수 없다). 그리고 앱 배열의
  --      순서가 '… 6=휴가 → 12 → 7=조퇴 …' 로 숫자순이 아닌 것이 **화면 순서를 그대로 베꼈다는 증거**다.
  --      → **코드표(workstatus_tbl)의 이름을 신뢰하지 말 것.** 이름의 정본은 드롭다운(=ATTEND_STATUS)이다.
  --      (참고: 그 표는 PK 도 UNIQUE 도 없어 '11 병가' 가 중복 적재돼 있다 — 13행/12코드.)
  status    VARCHAR(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,          -- 근태 코드. ''(미기록)은 저장 금지 — 위 ★★ 계약. 미기록은 행을 지운다
  overtime  TINYINT NOT NULL DEFAULT 0,                                             -- 초과시간(시간 단위 정수). 0..11. 0 은 '초과 없음'이고 미기록이 아니다(status 와 달리 삭제 신호가 아니다)
  -- ★ 2026-08-26 신설 — §3.3 낙관적 잠금 토큰. 이 표는 엔티티가 아니라 '값 칸' 이라
  --   cal_entry·cal_todo 와 달리 타임스탬프가 없었다. 그런데 **덮어쓰기 사고는 값 칸에서도 똑같이 난다** —
  --   토큰이 없으면 PK 만으로 무조건 덮어쓰므로, 다른 환경에서 적은 값이 흔적 없이 사라지고
  --   사라졌다는 사실을 알 방법도 없다. 근태·공수는 회사 보고로 나가는 숫자라 조용한 유실이 특히 나쁘다.
  --   ※ 지금은 클라이언트가 위젯 하나뿐이라 발화하지 않는다. 브라우저가 붙는 순간부터 일한다.
  --     그때 컬럼을 추가하려면 실제 ALTER 가 되므로, 0행인 지금 미리 둔다.
  --   ★ 기본값·ON UPDATE 에 서버 함수(NOW(3)·CURRENT_TIMESTAMP)를 달지 않는다 — §5.3 '시각' 규칙.
  --     세션 time_zone 이 SYSTEM(KST)이면 앱이 보내는 UTC 값과 9시간이 한 컬럼에 영구 혼재되고
  --     DATETIME 은 사후 구분이 불가능하다. cal_entry·cal_todo 와 같이 **앱이 UTC 로 계산해 명시 대입**한다.
  updated_at  DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, work_date),
  CONSTRAINT fk_cal_attendance_user FOREIGN KEY (user_id) REFERENCES app_user(user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- ★ 이 IN 목록이 곧 '미기록 = 행 없음' 의 구조적 강제다 — '' 가 목록에 없으므로 INSERT 도 UPDATE 도
  --   3819 로 거부된다. 목록을 넓힐 때 ''(또는 NULL 허용)를 끼워 넣지 말 것. 사이트에 코드가 늘어나면
  --   앱의 ATTEND_STATUS 와 이 줄을 **함께** 고친다(한쪽만 고치면 앱이 만든 값이 이관에서 3819 로 막힌다).
  -- ★★ `AND status NOT LIKE '% '` 은 군더더기가 아니다 — 없으면 IN 목록만으로 '1 '(뒤 공백)이 통과한다.
  --   실측(8.4.9): utf8mb4_bin 은 PAD SPACE 라 '1 ' IN ('1',…) 가 TRUE 다. 그렇게 들어간 행은
  --   HEX 가 3120 이고, 앱의 ATTEND_STATUS_SET.has('1 ') 는 false 라 getAttendance() 가 미기록으로
  --   읽는다 — 즉 '있는데 없는 것처럼 보이는' 행이 되고, 이 표의 계약(미기록=행 없음)이 깨진다.
  --   ai_ci 로 바꾸는 것은 해법이 아니다(NO PAD 라 뒤 공백은 막지만 전각 '１' 이 통과한다. 실측 확인).
  --   LIKE 는 PAD SPACE 접기를 하지 않으므로 이 한 줄로 닫힌다(실측: '1 ' NOT LIKE '% ' → 0 = 거부).
  --   앞 공백 ' 1' 은 IN 이 이미 막는다(첫 글자가 다르다 — 실측 3819).
  CONSTRAINT chk_cal_attendance_status   CHECK (status IN ('1','2','3','4','5','6','7','9','10','11','12')
                                            AND status NOT LIKE '% '),
  -- 앱의 검증 규약과 같다: `if(!(ot >= 0 && ot <= 11)) ot = 0` (setAttendance·fromXML·toXML 세 곳 동일).
  -- 부호 있는 TINYINT 로 두는 이유: UNSIGNED 면 음수가 1264(범위 초과)로 걸려 CHECK 이름이 안 나온다.
  CONSTRAINT chk_cal_attendance_overtime CHECK (overtime >= 0 AND overtime <= 11)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='날짜별 근태·초과시간(netcus 일간보고용). PK=(user_id,work_date). ★미기록=행 없음 — 되돌리기는 DELETE.';
-- =====================================================================
--  cal_report_daily / cal_report_hours — **캘린더가 보낸** 일간보고 기록
-- =====================================================================
--  ★ 2026-08-31 정정 — 이 자리에는 *"netcus 일간보고 **사본**. 원본은 사이트다"* 라고 적혀
--    있었다. 사본이 아니다. 사이트는 무효화 신호를 주지 않으므로 *"지금 사이트의 그 날 보고는
--    무엇인가"* 는 이 표가 답할 수 있는 질문이 아니다. 담는 것은 우리가 아는 사실 하나뿐이다 —
--    **우리가 무엇을 보냈는가**(설계 §5.9.2. migrate-2026-08-31-sent-only.sql 이 같은 이유로
--    content_from 을 지우고 content_at 을 sent_at 으로 바꿨다).
--  사용자는 캘린더로 초안을 만든 뒤 netcus 에서 상세를 직접 고친다(2026-08-31 사용자 확인).
--  그러므로 이 표의 값은 사이트의 최종본이 아니다 — 그 대가는 설계 §5.9.8 이 명시해 두었다.
--
--  ★★ cal_task_hours 와 혼동 금지 — 둘은 다른 것이다
--     cal_task_hours   = 캘린더에 입력한 시간 = **초안**(사용자가 언제든 고친다)
--     cal_report_hours = 실제로 보고된 시간   = **확정**(공수계산기의 원천)
--     나누는 이유: 보고 후 캘린더를 고치면 과거 집계가 소급해서 바뀐다.
--
--  ★ 왜 일간만 있고 주간이 없나
--    일간은 주소가 (사번, 날짜)로 결정된다(pjm_work_view.jsp?y&m&d&id) — 검색이 아니라
--    직접 주소라 "그 날의 최종본"에 확답이 된다. 레거시 workpaper_tbl 도 하루 한 행이다.
--    주간은 게시판이라 글을 뒤져서 추측한다(작성일 창 ±7일·기간 겹침·상한 60건).
--    한 주에 글이 2개면 어느 게 최종인지 코드가 정하지 못한다. 그래서 주간은
--    그래서 사이트를 되읽지 않고, cal_report_weekly 는 **캘린더가 작성한 것**만 담는다(아래).
-- =====================================================================
CREATE TABLE cal_report_daily (
  user_id      SMALLINT UNSIGNED NOT NULL,                                  -- 소유자(app_user.user_id)
  work_date    DATE              NOT NULL,                                  -- 보고 대상 날짜. 하루 한 행 — 사이트가 그렇다
  status       VARCHAR(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
                                                                            -- 근태 코드. cal_attendance.status 와 같은 타입이라 대조 가능
  overtime     TINYINT           NOT NULL DEFAULT 0,                        -- 초과시간(정수). cal_attendance 와 같음
  content      MEDIUMTEXT        NOT NULL,                                  -- 본문 전체. 레거시 workpaper_tbl.content 와 같은 크기
  sent_at      DATETIME(3)       NOT NULL,                                  -- 보낸 시각. 이 표는 「보낸 것」만 담는다
  created_at   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, work_date),
  -- ★ 2026-09-09 CASCADE → RESTRICT (migrate-2026-09-09-integrity.sql (1)).
  --   grants-calendar.sql 은 이 표에 DELETE 권한을 주지 않는다("보고한 사실은 지우는 대상이 아니다").
  --   그런데 FK 가 CASCADE 라, 퇴사자 정리에서 app_user 행을 지우는 순간 보고 이력이
  --   **DELETE 권한 없이도** 함께 사라졌다 — FK 의 참조 동작은 GRANT 검사를 거치지 않는다.
  --   두 장치의 의도가 반대였고 FK 쪽이 GRANT 의 방어를 우회했다. 소유자 FK 11개 중 나머지가
  --   전부 RESTRICT 인 것도 같은 이유다. 멈추는 것이 답이다.
  CONSTRAINT fk_crd_user FOREIGN KEY (user_id) REFERENCES app_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- ★ 2026-09-09 신설 — 쌍둥이 cal_attendance 의 규율을 이식했다(migrate-…-integrity.sql (3)).
  --   두 컬럼은 "cal_attendance 와 같은 타입이라 대조 가능" 을 노리고 만들었는데 값의 규율이
  --   한쪽에만 있었다. 한쪽에만 들어갈 수 있는 값이 있으면 대조 자체가 성립하지 않는다.
  --   ★ '' 가 목록에 있는 것이 cal_attendance 와의 **유일한 차이이고 의도된 차이**다:
  --     그쪽은 '미기록 = 행 없음' 이라 '' 가 필요 없지만, 이 표는 보고를 보내면 하루 한 행이
  --     반드시 생기므로 '근태 미기재' 를 표현할 값이 필요하다. 게다가 ReportDb 는 Clamp2 로
  --     길이만 자르고 값을 검증하지 않아, '' 를 막으면 근태 미기재일의 보고 저장이 통째로 3819 로 죽는다.
  --   NOT LIKE '% ' 의 근거는 위 chk_cal_attendance_status 주석에 적혀 있다(PAD SPACE 구멍).
  CONSTRAINT chk_crd_status   CHECK (status IN ('','1','2','3','4','5','6','7','9','10','11','12')
                                 AND status NOT LIKE '% '),
  CONSTRAINT chk_crd_overtime CHECK (overtime >= 0 AND overtime <= 11)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='캘린더가 보낸 일간보고. 사이트의 현재 상태가 아니다';

-- ── 2단계: cal_report_hours ──────────────────────────────────────────
--   ★★ 2026-09-09 뒤집음 — cat_no 에 **RESTRICT FK 를 건다**(fk_crh_cat).
--     이 자리에는 *"cat_no 에 FK 를 걸지 않는다. 과제를 지워도 과거 보고 기록은 남아야 하기
--     때문이다"* 라고 적혀 있었다. 그 문장은 cal_task_hours 가 2026-08-24 에 이미 기각한 논리와
--     같다 — cat_no 는 AUTO_INCREMENT 가 아니라 MAX()+1 발번이라 **번호가 재사용된다**(H-1).
--     FK 가 없으면 '남은 과거 기록' 은 남는 것이 아니라, 나중에 같은 번호를 받은 **다른 과제**의
--     공수로 조용히 흡수된다. 그리고 그 숫자는 회사 일간보고로 나간다.
--     (ON DELETE SET NULL 을 못 쓰는 것은 사실이다 — user_id 가 NOT NULL 이라 MySQL 이 거부한다.
--      그래서 남는 선택지는 RESTRICT 뿐이고, 그게 쌍둥이 cal_task_hours 가 고른 것과 같다.)
--   ★ 오늘은 아무 동작도 바뀌지 않는다: 앱은 cat_no 를 항상 NULL 로 쓴다
--     (MainWindow.xaml.cs:2053). 복합 FK 는 MATCH SIMPLE 이라 NULL 행은 검사 면제다.
--     이 제약이 하는 일은 **나중에 이 컬럼을 채우는 사람에게 "과제를 지우기 전에 먼저 비워라"를
--     강제하는 것**이다. 그 사람이 이 주석을 못 봐도 DB 가 1451 로 알려 준다.
CREATE TABLE cal_report_hours (
  user_id    SMALLINT UNSIGNED NOT NULL,
  work_date  DATE              NOT NULL,
  line_no    SMALLINT UNSIGNED NOT NULL,                                    -- content 안에서의 줄 순서(0부터). 순서 보존 + 좁은 키
  task_name  VARCHAR(200)      NOT NULL,                                    -- 사이트 원문 그대로. 과제명이 바뀌어도 과거는 안 흔들린다
  cat_no     INT UNSIGNED      NULL,                                        -- 매칭되면 채움 · NULL = 미분류(NULL 은 FK 검사 면제 — 위 ★)
  hours      DECIMAL(4,2)      NOT NULL,                                    -- 폭은 쌍둥이 cal_task_hours 와 같게(2026-09-09). 소수 2자리는 파서의 Math.round(x*100)/100 과 정확히 같다
  PRIMARY KEY (user_id, work_date, line_no),
  KEY idx_crh_cat (user_id, cat_no, work_date),                             -- 계산기: 과제별 기간 합계 + fk_crh_cat 의 지지 인덱스(선두 두 열이 FK 열)
  CONSTRAINT fk_crh_daily FOREIGN KEY (user_id, work_date)
    REFERENCES cal_report_daily (user_id, work_date) ON DELETE CASCADE ON UPDATE CASCADE,
  -- ★ 2026-09-09 신설 — 위 ★★ 참조. cal_category 는 이 파일 앞쪽(1. cal_category)에서 이미 만들어지므로
  --   여기서 인라인으로 선언할 수 있다(파일 끝 ALTER 로 미룰 이유가 없다 — 표 정의 한자리에 다 보이는 편이 낫다).
  CONSTRAINT fk_crh_cat FOREIGN KEY (user_id, cat_no) REFERENCES cal_category (user_id, cat_no)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- ★ 2026-09-09 hours >= 0 → hours > 0 AND hours <= 24. cal_task_hours 의 chk_cal_task_hours_range 와 같다.
  --   0 은 '기록할 것이 없다' 이지 '0시간을 일했다' 가 아니다(캘린더 쪽은 이미 0 을 행 삭제로 다룬다).
  --   상한 24 가 없으면 파서가 잘못 읽은 240 이 그대로 회사 보고 집계에 들어간다.
  --   ★ 앱과 짝이다 — ReportDb.cs 의 0시간 줄 필터가 `<= 0` 이어야 한다(한쪽만 고치면 저장 트랜잭션이 죽는다).
  --     그 짝을 tests/schema-integrity.test.mjs 의 '계약④: 공수 상한' 이 기계로 붙잡는다.
  CONSTRAINT chk_crh_hours CHECK (hours > 0 AND hours <= 24)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='보낸 과제별 시간 — 공수계산기의 원천. 캘린더가 본문을 만들 때 이미 아는 값이다(파싱 아님)';
--  ★ 이 주석을 '되읽은 content 를 파싱해 채운다' 로 되돌리지 말 것 — 그건 §5.9.2 에서 **버린 안**이다.
--    표 주석은 DB 안에 남는 설명이라, 여기가 옛 설명을 들고 있으면 재구축할 때마다 버린 설계가
--    근거처럼 되살아난다(2026-08-31 에 실제로 파일과 운영 DB 의 주석이 서로 반대였다).

-- =====================================================================
--  cal_report_weekly — 캘린더가 작성한 주간보고
-- =====================================================================
--  ★ 이 표는 사이트의 현재 상태가 아니다
--    위젯은 주간을 **전송하지 않는다**(NetcusService.cs:666 — 폼만 채우고 사용자가 직접 제출).
--    사용자가 폼에서 보완한 내용(notendwork·problem·차주계획 등)은 여기 담기지 않는다.
--    우리가 아는 사실은 '캘린더가 이걸 작성했다'까지다 — 그래서 composed_at 이다.
--
--  ★ 키가 (user_id, period_start) 인 이유
--    사이트 글번호(view_no)는 **크롤링해야 얻는 값**이라 쓸 수 없다.
--    캘린더는 기간을 스스로 정하므로 기간이 곷 식별자다. 재작성하면 덮어쓴다.
-- =====================================================================
CREATE TABLE cal_report_weekly (
  user_id      SMALLINT UNSIGNED NOT NULL,                                  -- 소유자(app_user.user_id)
  period_start DATE              NOT NULL,                                  -- 캘린더가 정한 기간 시작(WeekFill 의 sdate)
  period_end   DATE              NOT NULL,                                  -- 기간 끝(edate)
  subject      VARCHAR(200)      NOT NULL DEFAULT '',                       -- 캘린더가 만든 제목('8월 셋째주')
  content      MEDIUMTEXT        NOT NULL,                                  -- 과제투입시간. 집계는 일간 원자로 한다(이중 계산 방지)
  endwork      MEDIUMTEXT        NOT NULL,                                  -- 진행사항
  plan         MEDIUMTEXT        NOT NULL,                                  -- 차주계획(캘린더가 만든 머리표)
  composed_at  DATETIME(3)       NOT NULL,                                  -- 캘린더가 이 주간보고를 작성한 시각
  created_at   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, period_start),
  -- ★ 2026-09-09 CASCADE → RESTRICT — 근거는 위 fk_crd_user 와 같다(GRANT 는 DELETE 를 안 주는데
  --   FK 가 지웠다). 소유자 FK 는 이 DB 에서 전부 RESTRICT 로 통일한다.
  CONSTRAINT fk_crw_user FOREIGN KEY (user_id) REFERENCES app_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_crw_period CHECK (period_start <= period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='캘린더가 작성한 주간보고. 사이트의 현재 상태가 아니다 - 사용자가 폼에서 보완한 내용은 담기지 않는다';
--  ★ composed_at 이지 sent_at 이 아닌 이유: 위젯은 주간을 **전송하지 않는다**(NetcusService.cs:666
--    "폼을 채웠습니다 - 보완 후 열린 창에서 직접 '제출'하세요"). 우리가 아는 사실은 '작성했다'까지다.




-- =====================================================================
--  10. cal_user_pref — 사용자당 1행 설정(커밋 수집 작성자 + 보고서 서식)
-- =====================================================================
-- XML 루트 gitAuthor/svnAuthor + <prefs> 대응. 사용자당 정확히 1행이고 삭제 경로가 없다.
-- ★ 사용자당 1행이므로 PK 는 (user_id) 다 — 대리키를 따로 두지 않는다(번호를 붙일 대상이 없다).
--
-- ★ 왜 서식을 여기에 넣는가(설계 §4 의 '보류' 판정을 2026-08-21 뒤집었다):
--   브라우저 지원(로컬 파일이 없는 환경)에서도 필요한 값이라 결국 DB 로 온다. 그리고 이 표가 이미
--   '사용자당 1행 설정' 이므로 표를 늘리지 않고 컬럼만 늘리면 된다.
-- ★ 왜 JSON 컬럼도, key-value 표도 아닌가(설계 §10 의 기각 근거 그대로):
--   DB 가 형식을 못 막기 때문이다. JSON 이면 report_indent 에 "가나다"가 들어가도 서버는 통과시키고,
--   그 값을 읽는 시점(보고서 생성)에 가서야 조용히 기본값으로 흡수된다. key-value 표도 값이 전부
--   문자열 한 컬럼이라 같은 문제다. 평탄한 컬럼 + CHECK 라야 잘못된 값이 들어오는 그 자리에서 3819 로 멈춘다.
--   대가는 '서식을 하나 추가할 때마다 ALTER 가 필요하다' 인데, 서식은 UI 를 함께 고쳐야 늘어나는 값이라
--   어차피 배포가 따라간다(설계 §5.5 의 '추가 컬럼은 DEFAULT 필수' 규칙을 지킬 것).
CREATE TABLE cal_user_pref (
  user_id    SMALLINT UNSIGNED NOT NULL,   -- 소유자(app_user.user_id). 사용자당 1행
  -- 폭 120 의 근거: 폼 #cGitAuthor/#cSvnAuthor maxlength=120. fromXML()은 루트 속성을 그대로 읽어
  -- 절단이 없으므로, 손으로 고친 XML 만 초과할 수 있다(1406 → 이관 도구 사전 스캔 대상). name 과 같은 판정.
  git_author VARCHAR(120) NOT NULL DEFAULT '',   -- Git 커밋 수집 작성자. ''=전체 커밋 대상. 형식 검증 없음(이메일 아니어도 됨)
  svn_author VARCHAR(120) NOT NULL DEFAULT '',   -- SVN 커밋 수집 작성자. git 과 독립. '속성 부재→gitAuthor 복사' 구버전 마이그레이션은 파서가 이미 해소한 뒤 들어온다
  -- ★ 이관 규칙: 여기만 '이관 시각'을 쓴다. cal_category 와 달리 복사할 원본이 아예 없다 —
  --   toXML 은 gitAuthor/svnAuthor 를 XML '루트 속성'으로 쓸 뿐 시각을 함께 적지 않고,
  --   앱 state 에도 이 두 값의 수정 시각이라는 개념이 없다(setGitAuthor() 은 save() 만 한다).
  --   사용자당 1행이고 부팅 직후 이 행을 고치는 흐름이 드물어 충돌 오탐 위험이 cal_category 만큼 크지 않다.
  -- ── 보고서 서식(XML <prefs>) ──────────────────────────────────────────────────────
  -- 전부 '표시+복사 서식' 이다 — 캘린더·커밋 데이터를 바꾸지 않는다. 기본값은 파서(fromXML/
  -- normalizeReportFormatPref/normalizeReportFont)가 쓰는 값과 **같은 값**을 적었다(어댑터 계약 C).
  --
  -- (1) 전역 3값 — ★ 종류별과 독립인 설정이 아니라 '마지막으로 본 모드의 거울' 이다.
  --     syncLegacyReportFormatFields() 가 모드를 바꿀 때마다 현재 모드 값으로 덮어쓴다.
  --     존치 이유: 종류별 속성이 없는 구버전 XML 을 읽을 때 폴백 원본이 된다(헤더 C 의 ※ 참조).
  --     전역과 daily/weekly 가 달라도 정상이므로 '맞춰서' 고쳐 넣지 말 것.
  -- 폭 8 의 근거: 프리셋은 전부 4자 이하이고(#rptMarker 의 option value), 직접 입력은
  --   #rptMarkerCustom maxlength=8 · normalizeReportFormatPref 의 `.slice(0,8)` · fromXML 의 `rm.length <= 8`.
  --   셋이 같은 8 이라 초과는 손으로 고친 XML 에서만 나온다(ERROR 1406 → 이관 도구 사전 스캔 대상).
  -- 콜레이션: 값 집합이 고정이 아니므로 _bin 을 쓰지 않는다(헤더의 그 규칙 마지막 ※ 참조).
  report_marker              VARCHAR(8) NOT NULL DEFAULT '-',   -- 머리기호. 프리셋 키 또는 임의 문자열(8자 이하). ''는 불가 — 파서가 '-'로 흡수한다
  report_marker_custom       VARCHAR(8) NOT NULL DEFAULT '',    -- 직접 입력 머리기호. ''=사용 안 함(정상값. NULL 로 바꾸지 말 것)
  report_indent              TINYINT    NOT NULL DEFAULT 2,     -- 들여쓰기 단수 0..6 (파서가 clamp 하는 범위와 동일)
  -- ★ D 부류가 아니다 — toXML 은 켜졌을 때만 '1' 을 쓰고 꺼졌으면 속성을 아예 안 쓴다(헤더 D 의 ★ 참조).
  git_commit_body            TINYINT(1) NOT NULL DEFAULT 0,     -- 보고서에 커밋 본문 포함 여부. 1=포함. XML 속성 부재=0
  -- (2) 종류별(daily/weekly) — custom 모드는 'weekly' 키를 함께 쓴다(reportFormatKeyForMode: daily 외 전부 weekly).
  --     그래서 키가 둘뿐이고 컬럼도 둘씩이다. 셋째 모드를 만들려면 컬럼을 늘리기 전에 그 키 규칙부터 볼 것.
  report_marker_daily        VARCHAR(8) NOT NULL DEFAULT '-',   -- 일간 보고서 머리기호
  report_marker_custom_daily VARCHAR(8) NOT NULL DEFAULT '',    -- 일간 직접 입력 머리기호
  report_indent_daily        TINYINT    NOT NULL DEFAULT 2,     -- 일간 들여쓰기 0..6
  report_marker_weekly       VARCHAR(8) NOT NULL DEFAULT '-',   -- 주간(+기간 취합) 머리기호
  report_marker_custom_weekly VARCHAR(8) NOT NULL DEFAULT '',   -- 주간 직접 입력 머리기호
  report_indent_weekly       TINYINT    NOT NULL DEFAULT 2,     -- 주간 들여쓰기 0..6
  -- (3) 글꼴 — 기간 취합 보고서 전용이지만 모드별이 아닌 **단일 전역** 값이다(state.reportFont).
  --     서식 pref 와 분리된 이유가 코드 주석에 있다: custom 이 'weekly' 키를 공유해서, 기간 취합에서
  --     서식을 바꾸면 주간까지 따라 바뀐다. 글꼴만은 그 결합을 피하려고 최상위 단일값으로 뒀다.
  -- ★ family 는 화이트리스트다(REPORT_FONTS 에서 ''를 뺀 5개 = REPORT_FONT_FAMILY_SET). 값 집합이
  --   고정이므로 _bin. ''(기본 글꼴)은 목록에 함께 넣는다 — 그게 DEFAULT 이자 '지정 안 함'이다.
  --   폭 20 의 근거: 가장 긴 'Malgun Gothic' 이 13자. 여유를 두되 화이트리스트가 실질 제한이다.
  report_font_family         VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '', -- 보고서 글꼴. ''=기본
  -- ★ 0 은 '크기 지정 안 함(기본)' 이고 10..16 이 실제 pt 다. 1..9 는 두 뜻 사이의 빈 구간이라 막는다
  --   (normalizeReportFont: `Number.isInteger(n) && n >= 10 && n <= 16` 아니면 0). 드롭다운은 REPORT_FONT_SIZES
  --   = [0,10,11,12,13,14,15,16] 이지만 파서는 10..16 정수를 전부 받으므로 CHECK 도 범위로 적는다.
  report_font_size           TINYINT NOT NULL DEFAULT 0,        -- 보고서 글꼴 크기(pt). 0=기본, 그 밖에는 10..16
  updated_at DATETIME(3)  NOT NULL,              -- 수정 시각(UTC). 낙관적 잠금 토큰
  PRIMARY KEY (user_id),
  CONSTRAINT fk_cal_user_pref_user FOREIGN KEY (user_id) REFERENCES app_user(user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- 머리기호는 파서가 빈 값을 '-'로 흡수하므로 앱에서 ''가 나올 수 없다. 구조로도 막아 둔다.
  -- (custom 쪽은 ''가 정상값이라 이 CHECK 대상이 아니다)
  CONSTRAINT chk_cal_user_pref_marker CHECK (report_marker        <> ''
                                         AND report_marker_daily  <> ''
                                         AND report_marker_weekly <> ''),
  CONSTRAINT chk_cal_user_pref_indent CHECK (report_indent        BETWEEN 0 AND 6
                                         AND report_indent_daily  BETWEEN 0 AND 6
                                         AND report_indent_weekly BETWEEN 0 AND 6),
  CONSTRAINT chk_cal_user_pref_commit_body CHECK (git_commit_body IN (0,1)),
  -- NOT LIKE '% ' 의 근거는 chk_cal_attendance_status 에 적어 두었다(utf8mb4_bin PAD SPACE 로
  -- 'Gulim ' 이 IN 을 통과하는데, REPORT_FONT_FAMILY_SET.has('Gulim ') 는 false 라 앱은 기본 글꼴로 읽는다).
  -- 'Malgun Gothic' 의 가운데 공백은 이 검사에 걸리지 않는다 — 막는 것은 '끝의' 공백뿐이다.
  CONSTRAINT chk_cal_user_pref_font_family CHECK (report_font_family IN ('','Malgun Gothic','Gulim','Dotum','Batang','NanumGothic')
                                              AND report_font_family NOT LIKE '% '),
  CONSTRAINT chk_cal_user_pref_font_size   CHECK (report_font_size = 0 OR report_font_size BETWEEN 10 AND 16)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='사용자당 1행 설정 — 커밋 수집 작성자(git/svn) + 보고서 서식. PK=(user_id). 삭제 경로 없음.';

-- =====================================================================
--  11. cal_user_rev — 동시성·동기화 단일 감시점(§3.1)
-- =====================================================================
-- 모든 쓰기 트랜잭션의 첫 문장이 이 행을 ODKU 로 잡아 같은 사용자의 쓰기를 직렬화하고 삭제까지 감지한다.
-- XML 원본 없음. DELETE 권한을 주지 않는다 — rev 는 단조증가여야 한다.
-- ★ 사용자당 1행이므로 PK 는 (user_id) 다.
--
-- ★★ 2026-08-24 판정 — 여기에 <표>_no 카운터 컬럼을 두지 **않는다.**
--   대안이었던 것: next_cat_no / next_entry_no / next_todo_no … 를 이 표에 두고 ODKU 로 함께 올리는 안.
--   기각 근거:
--     ① 값이 실제 행과 어긋날 수 있는 경로가 실재한다 — 표 단위 부분 복구, 손수정, mysqldump 를
--        표별로 골라 넣는 복구. 카운터가 실제 MAX 보다 **낮아지면** 다음 INSERT 가 1062 로 죽거나,
--        더 나쁘게는 다른 표의 자식이 이미 지워진 뒤라면 **번호가 재사용되어 조용히 남의 행을 가리킨다.**
--        MAX()+1 은 데이터 자신이 근거라 그런 상태가 성립하지 않는다.
--     ② 컬럼이 표 수만큼 늘고(번호를 갖는 표 3개 + 앞으로 늘 때마다), 표를 하나 추가할 때마다
--        이 표를 ALTER 해야 한다. 결합이 잘못된 방향이다.
--     ③ 성능 이득이 없다. MAX(<표>_no) 는 PK (user_id, <표>_no) 의 오른쪽 끝을 한 번 읽는
--        인덱스 역방향 탐색이고, 어차피 같은 트랜잭션이 이 행의 락을 이미 쥐고 있어 직렬 실행이다.
--   ★ 그래서 이 표의 유일한 역할은 그대로다 — **락과 rev.** 번호 발급의 안전성은 그 락에서 나온다.
--     구체적 문장과 근거는 계약 H-1 에 있다. 요지: (1) 아래 ODKU 가 그 사용자의 행에 배타 락을 잡고
--     COMMIT 까지 놓지 않으므로, (2) 그 뒤의 SELECT MAX(<표>_no)+1 과 INSERT 사이에 같은 사용자의
--     다른 세션이 끼어들 수 없다. 전원 시딩이 강제라 그 행은 항상 존재하고, 따라서 (1) 은 항상
--     '있는 행의 UPDATE'(= 확실한 락)이지 '중복키 삽입 경합'이 아니다 — 아래 시딩 절의 첫째 이유와 같다.
CREATE TABLE cal_user_rev (
  user_id  SMALLINT UNSIGNED NOT NULL,   -- 소유자(app_user.user_id). 배포 시 app_user 전원 시딩 필수
  rev      BIGINT UNSIGNED NOT NULL DEFAULT 0,                                     -- 단조증가 리비전. 시딩값 0, 상시 문장은 신규 행을 1로 만든다
  PRIMARY KEY (user_id),
  CONSTRAINT fk_cal_user_rev_user FOREIGN KEY (user_id) REFERENCES app_user(user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='사용자별 동시성 감시점. 쓰기 첫 문장이 ODKU 로 잡는 행 — 번호 발급도 이 락에 기댄다(H-1). DELETE 금지.';

-- =====================================================================
--  12. cal_migration_log — data.xml → DB 1회성 이관의 재실행 방지(§8)
-- =====================================================================
-- 데이터 INSERT 와 같은 트랜잭션에 넣고, 행이 있으면 도구가 거부한다.
-- XML 원본 없음(구 lsMigrated 마커의 후속). UPSERT·REPLACE·선삭제 금지.
-- ★ 사용자당 1행이므로 PK 는 (user_id) 다.
CREATE TABLE cal_migration_log (
  user_id     SMALLINT UNSIGNED NOT NULL,   -- 이관된 사용자. 이관은 PC 단위가 아니라 사람 단위
  source_host VARCHAR(255) NOT NULL DEFAULT '',   -- 이관을 실행한 PC 이름. 두 자리 사용자 사고 추적용
  migrated_at DATETIME(3)  NOT NULL,              -- 이관 시각(UTC)
  PRIMARY KEY (user_id),
  CONSTRAINT fk_cal_migration_log_user FOREIGN KEY (user_id) REFERENCES app_user(user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='data.xml→DB 1회성 이관 마커(사람 단위). PK=(user_id). 행 존재=이관 완료, 재실행 거부 근거.';

-- =====================================================================
--  (cal_audit_trash — 폐지. 번호를 주지 않는다. 옛 명부에서는 12번이었다)
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
--  13. cal_schema_meta — 스키마 버전 행 (§5.5)
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
-- 사용자별 데이터가 아니라 user_id 도 FK 도 없다. 값 집합이 고정된 토큰이라 두 컬럼 모두 _bin.
CREATE TABLE cal_schema_meta (
  k          VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,  -- 메타 키. 현재 'schema_version' 하나. 앱이 정확 비교하므로 _bin
  v          VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,  -- 값. schema_version 은 단조증가 정수 문자열
  updated_at DATETIME(3) NOT NULL,                                            -- 갱신 시각(UTC). 아래 시딩은 UTC_TIMESTAMP(3) 명시 — CURRENT_TIMESTAMP 는 세션 tz 로 평가되므로 쓰지 않는다
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='스키마 버전 행(§5.5). 앱은 SELECT 만 — 위젯 빌드 상수와 비교해 파괴적 연산만 차단.';

-- 시딩 — 구조를 바꾸는 migrate-*.sql 은 반드시 이 값을 함께 올려야 한다(올리지 않으면 게이트가 죽은 문자가 된다).
-- ★ 2026-08-21: 1 → 2. cal_attendance 신설 + cal_user_pref 서식 12컬럼 = 명백한 구조 변경이다.
-- ★ 2026-08-24: 2 → 3. **cal_* 13표 전부의 키가 바뀌었다**(login_id/문자열 id → user_id/대리키).
--   이번 판은 '새 컬럼을 모르는 구버전' 정도가 아니라 구버전 클라이언트의 모든 SQL 이 아예 성립하지
--   않는 변경이다. 그런데도 이 행을 올려야 하는 이유는 같다 — 구버전이 붙었을 때 **파괴적 연산이
--   먼저 막히는 것**이 게이트의 목적이고, 올리지 않으면 그 게이트가 죽은 문자가 된다.
-- ★ 2026-08-27: 3 → 4. cal_entry·cal_todo 에 sort_order 신설(배열=문서 순서 박제).
--   컬럼 추가라 구버전 SELECT 가 깨지지는 않는다. 그래도 올리는 이유는 위와 같다 — 올리지 않으면
--   이 숫자가 '어떤 변경에도 안 움직이는 값'이 되어 게이트가 죽는다.
--   실 DB 반영은 migrate-2026-08-27-sort-order.sql 이 한다(이 파일은 새로 짓는 경로다).
-- ★ 2026-08-27: 4 → 5. cal_category 에 uses_repo 신설('저장소를 쓰는 과제' 플래그, 설계 §4).
--   같은 날 두 번째 판이다 — sort-order(3→4) 를 **먼저** 적용해야 한다(4→5 가드가 그 순서를 강제한다).
--   실 DB 반영은 migrate-2026-08-27-repo-flag.sql 이 한다.
-- ★ 2026-08-31: 5 → 6 → 7 → 8. 보고 기록 3표(cal_report_daily · cal_report_hours ·
--   cal_report_weekly)가 늘었다(설계 §5.9). 한 판이 아니라 세 판인 이유는 결정이 그 순서로
--   좁혀졌기 때문이다 — 6 = 일간 2표 신설(migrate-2026-08-31-report-daily.sql),
--   7 = 주간 1표 신설(-report-weekly.sql), 8 = **'캘린더가 만든 것만 담는다'로 좁힘**
--   (-sent-only.sql. content_from 폐기 · content_at → sent_at · 주간 재작성).
--   세 파일은 반드시 이 순서로 적용한다 — 각 파일의 가드가 앞 버전(5·6·7)을 요구한다.
-- ★ 2026-09-09: 8 → 9. 무결성 규칙 통일 + 감사 시각 1회 정규화(migrate-2026-09-09-integrity.sql).
--   소유자 FK 두 개를 CASCADE→RESTRICT · cal_report_hours 에 fk_crh_cat 신설 ·
--   cal_report_daily 에 chk_crd_status/chk_crd_overtime 신설 · hours 를 DECIMAL(4,2)/>0..24 로 좁힘 ·
--   project·section_code·status_code 표 주석 드리프트 복구 · 7표 감사 컬럼 KST→UTC 시프트.
--   ★ 그 마이그레이션은 **재실행 안전이 아니다**(시각 시프트). v8 에서만 적용된다.
-- ★ 2026-09-10: 9 → 10. project 에 dev_end_date(개발종료일) 신설(migrate-2026-09-10-dev-end-date.sql).
--   컬럼 추가라 구버전 SELECT 가 깨지지는 않지만, **위젯이 새 컬럼을 SELECT 한다** — 구버전 DB 에
--   새 위젯이 붙으면 1054 로 죽는다. 그 짝 어긋남을 게이트가 먼저 잡으라고 올린다
--   (widget/CalendarDb.cs 의 ExpectedSchemaVersion 도 같은 배포에서 10 이다).
-- ★ 2026-09-10: 10 → 11. app_user 에 sort_order(전 직원 명부 서열) 신설
--   (migrate-2026-09-10-user-sort-order.sql · docs/USER-ADMIN.md §3).
--   같은 날 두 번째 판이다 — dev-end-date(9→10) 를 **먼저** 적용해야 한다(10→11 가드가 그 순서를 강제한다).
--   컬럼 추가라 구버전 SELECT 가 깨지지는 않지만, **새 위젯의 명부 조회가 그 컬럼을 SELECT·ORDER BY 한다** —
--   v10 DB 에 새 위젯이 붙으면 구성원 명부가 1054 로 통째로 비고, 직원 관리 화면의 저장이 전부 죽는다.
--   그 짝 어긋남을 게이트가 먼저 잡으라고 올린다(widget/CalendarDb.cs 의 ExpectedSchemaVersion 도 11).
--   ※ 이 컬럼은 db/deploy 가 만드는 표가 아니다(app_user 는 taskmgr-company-data/01-schema-users.sql
--     소관). 그래도 판번호는 여기가 정본이라 이 줄이 여기 있다 — 두 저장소가 같은 창에 나가야 한다.
--   ※ 이 아래 시딩값을 고칠 때는 이 목록도 함께 늘릴 것. 2026-08-31 에 값만 8 로 오르고
--     이 목록이 5 에서 멈춰 있어, 파일 안에서 '무엇이 8 을 만들었는지'를 읽을 수 없었다.
--   ※ 이 값과 db/deploy 의 최신 migrate-*.sql 이 올리는 값이 어긋나면
--     tests/schema-integrity.test.mjs 의 '계약⑥: 버전 정합' 이 실패한다(둘이 갈라지지 않게).
--   · 12 (2026-09-10): app_user.sort_order SMALLINT→INT UNSIGNED (migrate-2026-09-10-user-sort-order-int.sql)
--       10 간격 6,553명 천장(SMALLINT 65,535) 제거 — 부하 실측 뒤 배포 전에 넓혔다.
INSERT INTO cal_schema_meta (k, v, updated_at) VALUES ('schema_version', '12', UTC_TIMESTAMP(3));

-- =====================================================================
--  cal_user_rev 전원 시딩 (§3.1) — 구조 생성 직후 반드시 함께 실행
-- =====================================================================
-- 왜 '전원'인가(부분 시딩 금지):
--   · 상시 문장(아래 ODKU)이 행을 만들어 주긴 한다. 하지만 그 경우 직렬화 지점이
--     '이미 있는 행의 UPDATE' 가 아니라 '중복키 삽입 경합' 이 되어, §3.1 이 전제한 락 획득
--     순서가 사용자마다 달라진다. 같은 사용자가 두 자리(PC 2대)에서 동시에 첫 쓰기를 하는
--     상황이 바로 이 설계가 막으려던 케이스다.
--     ★ 2026-08-24 부터 이유가 하나 더 늘었다 — **번호 발급(H-1)이 이 락에 기대고 있다.**
--       행이 없어 (1) 이 삽입 경합이 되면 MAX()+1 두 개가 같은 값을 읽을 창이 생긴다.
--       즉 전원 시딩은 이제 '동시성 설계의 전제' 이자 '번호 유일성의 전제' 다.
--   · 아래 릴리스 게이트('누락 0')가 배포 검증의 유일한 수단인데, 일부만 시딩하면 그 게이트가
--     통과 여부를 판정할 기준을 잃는다.
--   · is_active=0(휴직·퇴사 처리) 사용자도 빼지 말 것. 빼면 복직 시 조용히 누락 상태가 된다.
--   · INSERT IGNORE 인 이유: 재실행 가능해야 하고(신규 입사자 추가 후 다시 돌림), 이미 rev 가 올라간
--     사용자의 값을 0 으로 되돌리면 안 되기 때문. 기각된 것은 'INSERT IGNORE 후 FOR UPDATE' 조합이지
--     INSERT IGNORE 자체가 아니다.
INSERT IGNORE INTO cal_user_rev (user_id, rev)
SELECT user_id, 0 FROM app_user;

-- 릴리스 게이트 — 아래 쿼리 결과가 반드시 0 이어야 배포 완료다(0 이 아니면 시딩을 다시 돌릴 것):
--   SELECT COUNT(*) FROM app_user u
--     LEFT JOIN cal_user_rev r ON r.user_id = u.user_id
--    WHERE r.user_id IS NULL;
--
-- 참고 — 앱의 상시 문장(모든 쓰기 트랜잭션의 첫 문장. 이 파일에서 실행하지 않는다):
--   INSERT INTO cal_user_rev (user_id, rev) VALUES (?, 1)
--     ON DUPLICATE KEY UPDATE rev = rev + 1;
--   시딩값 0 과 상시 시작값 1 의 차이는 무해하다(신규 행이 1로 생성될 뿐).
--   ★ 이 문장 뒤에 오는 것이 계약 H-1 의 번호 발급이다 — 순서를 바꾸지 말 것.
