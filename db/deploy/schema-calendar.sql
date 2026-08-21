-- =====================================================================
--  캘린더(cal_*) 테이블 DDL — 단일 소스
--  MySQL 8.0.13+ / InnoDB / utf8mb4.  (실측·검증 대상: MySQL 8.4.9, STRICT_TRANS_TABLES)
--  ※ 8.0.13 미만 불가 — memo/note/body/subject(전부 MEDIUMTEXT) 가 식 DEFAULT ('') 를 쓴다.
--  ※ 설계 근거는 db/CALENDAR-TABLE-DESIGN.md. 문서와 이 파일이 어긋나면 이 파일이 정본이다.
--
--  ⚠️ 재실행 경고 — 데이터가 든 DB 에 다시 돌리면 캘린더 데이터가 전부 사라진다.
--     아래 DROP TABLE 이 cal_* 13개를 자식→부모 순으로 지운다. 일정·할일·공수·근태·회의실·
--     보고서 서식·이관 마커가 모두 날아가고 되돌릴 수 없다.
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
--  ★★ DB 어댑터 계약 — 일곱 부류(A~F 는 앱→DB, G 는 DB→앱). 일곱 다 '선택'이 아니다.
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
--          cal_attendance.status — '' 를 NULL 로 바꾸는 게 아니라 **행 자체를 넣지 않는다.**
--            앱의 setAttendance() 가 빈 값·미지 코드면 그 날의 키를 delete 한다(getAttendance() 는
--            미기록에 null 을 돌려준다 — 커밋 8adb1ab 규약). cal_task_hours 의 '0 = 행 삭제' 와 같은 부류다.
--            NOT NULL + chk_cal_attendance_status 의 IN 목록에 '' 가 없어 구조로도 막힌다(ERROR 3819).
--          cal_user_pref.report_marker_custom — '' 가 정상값이다(= 직접 입력 안 함). NULL 로 바꾸지 말 것.
--            report_font_family 도 마찬가지로 '' = 기본 글꼴이다(NOT NULL DEFAULT '').
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
--     ※ 되살릴 조건: 경로를 PC 별로 분리 저장할 자리(예: cal_category_local(login_id,id,host,...))가
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
--       실재하지 않는 날짜의                fromXML 이 isRealDate(date)   cal_attendance 에 2026-02-30
--       <attendance day date="2026-02-30"> 로 그 날을 통째로 버림        같은 행. DATE 컬럼이 STRICT 에서
--                                                                        1292 로 막으므로 여기는 시끄럽다
--       <taskHours> 의 같은 경우           같은 isRealDate 검사           cal_task_hours 도 동일
--
--     ★ 계약: 이관 도구와 런타임 저장은 **fromXML() 을 통과한 결과만** DB 에 넣는다. XML 을 직접
--       파싱해 INSERT 하지 말 것. 그러면 이 부류가 통째로 해소된다(파서가 이미 다 버렸으므로).
--       그게 불가능한 도구라면 위 다섯 줄을 손으로 구현하고, 버린 건수를 사람에게 보고할 것.
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
--     나머지는 snake→camel 로 기계 변환이 되지만, 위 다섯은 규칙에서 벗어나므로 표를 보고 쓸 것.
--
--  ── G-2. NULL → '' (A 의 역방향) ──────────────────────────────────────
--     앱은 '값 없음'을 빈 문자열로 들고 있다. NULL 을 그대로 넘기면 `if(e.startTime)` 류 검사가
--     통과하는 것까지는 같지만, 문자열 메서드(.slice·.localeCompare)에서 터진다.
--       start_time · end_time · commit_time · end_date(entry·todo) · due · recur_until
--       · completed_at
--     ※ 반대로 NULL 을 유지해야 하는 것도 있다 — category_id(앱이 `|| null` 로 다룬다) ·
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
--       cal_category    ORDER BY sort_order → categories 배열. sort_order 값 자체는 state 에 넣지 않는다
--       cal_room        ORDER BY sort_order → rooms 문자열 배열(객체 아님)
--       cal_entry_commit ORDER BY seq       → entry.commits 배열. seq 는 state 에 넣지 않는다
--       cal_entry_except ORDER BY except_date → entry.recurExcept 문자열 배열
--       cal_todo_day_note → todo.dayNotes = { 'YYYY-MM-DD': '설명' }   (배열 아님)
--       cal_task_hours    → taskHours   = { 'YYYY-MM-DD': { 과제id: 시간 } }  (2단 중첩)
--       cal_attendance    → attendance  = { 'YYYY-MM-DD': { status, overtime } }
--     ★ ORDER BY 를 빠뜨리면 MySQL 이 어떤 순서를 주는지 보장이 없다. '대체로 맞게' 나오다가
--       행이 늘거나 실행계획이 바뀌면 순서가 뒤집힌다 — 화면 순서가 이유 없이 달라진다.
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
--
--       낙관적 잠금 토큰      → state 에 넣지 않는다. 어댑터가 별도 맵으로 보관한다:
--                              Map<'표:login_id:id' → DB 가 준 updated_at 원문>.
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
--
--  값 집합이 고정된 문자열 컬럼은 COLLATE utf8mb4_bin 이다(테이블 기본 utf8mb4_0900_ai_ci 상속 금지).
--     실측: ai_ci 는 대소문자뿐 아니라 전각/반각까지 같게 본다. 'DB'·'Db'·전각 'ｄｂ' 가 CHECK 를
--     전부 통과하고 입력 그대로 저장됐다. 앱은 `source === 'db'` 로 정확 비교하므로 그런 행은
--     조용히 개인 과제로 취급된다. 대상: cal_category.source · cal_entry.source · cal_entry.recur_freq ·
--     cal_todo.prio · cal_schema_meta.k/v · cal_attendance.status · cal_user_pref.report_font_family.
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
-- 위 경고를 다시 읽을 것. 이 14줄이 캘린더 데이터 전량을 지운다.
--
-- ★ 폐지된 표도 지운다. cal_audit_trash 는 감사 트리거와 함께 폐기됐지만(설계 §7.5),
--   그 전에 이 키트를 한 번이라도 돌린 DB 에는 실물이 남아 있다. '안 만든다'만으로는
--   사라지지 않는다 — 지우는 문장이 없으면 고아 표로 살아남아 DB 의 cal_* 가 명부보다 하나 많아지고,
--   문서·GRANT·게이트는 명부 개수를 정본으로 삼아 서로 어긋난다.
--   ※ 숫자를 여기 적지 않는다. 명부는 늘어난다(2026-08-11 12개 → 2026-08-21 13개) — 숫자를 박아 두면
--     다음 사람이 '정본 파일이 13을 고장난 상태라고 하네' 하고 게이트를 거꾸로 되돌린다. 실제로
--     이 주석이 한 라운드 동안 그 상태로 남아 있었다. 정본은 아래 CREATE TABLE 목록 자신이다.
--   지운 뒤 다시 만들지 않으므로 이 줄은 영구히 남는다(재적용마다 무해하게 반복).
DROP TABLE IF EXISTS cal_audit_trash;   -- 폐지(§7.5). 옛 배포분 정리용 — 재생성하지 않는다
DROP TABLE IF EXISTS cal_schema_meta;   -- FK 없음 — 순서 무관
DROP TABLE IF EXISTS cal_migration_log;
DROP TABLE IF EXISTS cal_user_rev;
DROP TABLE IF EXISTS cal_user_pref;
DROP TABLE IF EXISTS cal_attendance;
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
-- ★ 바로 아래 9. cal_attendance 가 같은 규약을 쓴다('미기록 = 행 없음'). 두 표는 같은 코드 경로로 다룰 것 —
--   한쪽만 '빈 값을 저장'으로 구현하면 보고서 한 줄이 조용히 틀린 채 회사 시스템으로 나간다.
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
-- ★ updated_at 을 일부러 두지 않는다(§3.3 낙관적 잠금의 명시적 예외). cal_task_hours·cal_room 과 같은 근거다:
--   엔티티가 아니라 키 (login_id, work_date) 로 주소지정되는 값 행이고, 같은 사용자의 동시 쓰기는
--   §3.1 rev 락이 직렬화한다. 대가도 같다 — 두 자리에서 같은 날을 고치면 마지막 쓰기가 이기고,
--   사후 추적 수단은 주간 mysqldump + binlog 뿐이다. 재검토 조건도 같다(사고가 한 번이라도 보고되면 추가).
CREATE TABLE cal_attendance (
  login_id  VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,  -- 소유자 login_id
  work_date DATE NOT NULL,                                                          -- 대상 날짜. 하루에 한 행
  -- 값 집합이 고정된 문자열이라 _bin 이다(헤더의 그 규칙). 테이블 기본(0900_ai_ci)을 상속하면
  -- 전각 '１' 이 CHECK 를 통과해 그대로 저장되고, 회사 사이트로 그 값이 그대로 전송된다.
  -- ★ 코드값은 netcus 근태 select 의 value 를 **그대로** 쓴다(앱이 가공 없이 전송한다). 임의로 채우지 말 것 —
  --   앱의 ATTEND_STATUS 배열을 직접 읽어 옮긴 전수 목록이고, ★ 8 이 없다(사이트에 그 코드가 없다).
  --   1=정근 2=야근 3=특근 4=외근 5=출장 6=휴가 12=반차 7=조퇴 9=지각 10=지각+야근 11=병가
  status    VARCHAR(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,          -- 근태 코드. ''(미기록)은 저장 금지 — 위 ★★ 계약. 미기록은 행을 지운다
  overtime  TINYINT NOT NULL DEFAULT 0,                                             -- 초과시간(시간 단위 정수). 0..11. 0 은 '초과 없음'이고 미기록이 아니다(status 와 달리 삭제 신호가 아니다)
  PRIMARY KEY (login_id, work_date),
  CONSTRAINT fk_cal_attendance_user FOREIGN KEY (login_id) REFERENCES app_user(login_id)
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
  COMMENT='날짜별 근태·초과시간(netcus 일간보고용). ★미기록=행 없음 — status=''''는 저장 금지, 되돌리기는 DELETE.';

-- =====================================================================
--  10. cal_user_pref — 사용자당 1행 설정(커밋 수집 작성자 + 보고서 서식)
-- =====================================================================
-- XML 루트 gitAuthor/svnAuthor + <prefs> 대응. 사용자당 정확히 1행이고 삭제 경로가 없다.
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
  login_id   VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,  -- 소유자 login_id. 사용자당 1행
  -- 폭 120 의 근거: 폼 #cGitAuthor/#cSvnAuthor maxlength=120. fromXML()은 루트 속성을 그대로 읽어
  -- 절단이 없으므로, 손으로 고친 XML 만 초과할 수 있다(1406 → 이관 도구 사전 스캔 대상). name 과 같은 판정.
  git_author VARCHAR(120) NOT NULL DEFAULT '',   -- Git 커밋 수집 작성자. ''=전체 커밋 대상. 형식 검증 없음(이메일 아니어도 됨)
  svn_author VARCHAR(120) NOT NULL DEFAULT '',   -- SVN 커밋 수집 작성자. git 과 독립. '속성 부재→gitAuthor 복사' 구버전 마이그레이션은 파서가 이미 해소한 뒤 들어온다
  -- ★ 이관 규칙: 여기만 '이관 시각'을 쓴다. cal_category 와 달리 복사할 원본이 아예 없다 —
  --   toXML 은 gitAuthor/svnAuthor 를 XML '루트 속성'으로 쓸 뿐(4533-4535) 시각을 함께 적지 않고,
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
  PRIMARY KEY (login_id),
  CONSTRAINT fk_cal_user_pref_user FOREIGN KEY (login_id) REFERENCES app_user(login_id)
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
  COMMENT='사용자당 1행 설정 — 커밋 수집 작성자(git/svn) + 보고서 서식(머리기호·들여쓰기·글꼴). 삭제 경로 없음.';

-- =====================================================================
--  11. cal_user_rev — 동시성·동기화 단일 감시점(§3.1)
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
--  12. cal_migration_log — data.xml → DB 1회성 이관의 재실행 방지(§8)
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
-- 사용자별 데이터가 아니라 login_id 도 FK 도 없다. 값 집합이 고정된 토큰이라 두 컬럼 모두 _bin.
CREATE TABLE cal_schema_meta (
  k          VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,  -- 메타 키. 현재 'schema_version' 하나. 앱이 정확 비교하므로 _bin
  v          VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,  -- 값. schema_version 은 단조증가 정수 문자열
  updated_at DATETIME(3) NOT NULL,                                            -- 갱신 시각(UTC). 아래 시딩은 UTC_TIMESTAMP(3) 명시 — CURRENT_TIMESTAMP 는 세션 tz 로 평가되므로 쓰지 않는다
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='스키마 버전 행(§5.5). 앱은 SELECT 만 — 위젯 빌드 상수와 비교해 파괴적 연산만 차단.';

-- 시딩 — 구조를 바꾸는 migrate-*.sql 은 반드시 이 값을 함께 올려야 한다(올리지 않으면 게이트가 죽은 문자가 된다).
-- ★ 2026-08-21: 1 → 2. cal_attendance 신설 + cal_user_pref 서식 12컬럼 = 명백한 구조 변경이다.
--   올리지 않으면 §5.5 가 이 게이트를 둔 이유(새 컬럼을 모르는 구버전 클라이언트가 파괴적 연산을
--   돌리는 것)가 그대로 재현되고, 게이트는 죽은 문자가 된다.
INSERT INTO cal_schema_meta (k, v, updated_at) VALUES ('schema_version', '2', UTC_TIMESTAMP(3));

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
