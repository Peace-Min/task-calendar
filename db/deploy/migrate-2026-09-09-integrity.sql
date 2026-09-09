-- =====================================================================
--  migrate-2026-09-09-integrity.sql
--  무결성 규칙 통일(소유자 FK · 과제 참조 · 보고 표 CHECK) + 표 주석 드리프트 복구
--  + 감사 시각 1회 정규화(KST → UTC)
--  schema_version 8 → 9
-- =====================================================================
--
--  ★★ 재실행 안전 아님 — v8 에서만 적용된다. 두 번째 실행은 가드가 중단시킨다 ★★
--    앞선 migrate-*.sql 들은 CREATE TABLE IF NOT EXISTS 라 몇 번을 돌려도 무해했다.
--    이 파일은 다르다 — 아래 (5)가 **데이터 시프트**다. 두 번 돌면 18시간이 어긋나고,
--    DATETIME 은 사후에 '한 번 밀렸는지 두 번 밀렸는지'를 구분할 수단이 없다(복구 불가).
--    그래서 맨 앞 선행조건 가드를 'schema_version 이 정확히 8' 로 잡았다. 멱등을 흉내내는
--    대신(예: 시프트에 조건을 걸어 '이미 UTC 인 행은 건너뛴다') 아예 두 번째 실행을 막는다 —
--    '이미 UTC 인 행' 을 값만 보고 판정할 방법이 없기 때문이다. 그게 이 병의 본질이다.
--
--  【왜 지금 이 다섯을 한 판으로 묶는가】
--    다섯 다 2026-09-09 전면 검수에서 나온 **같은 종류의 병**이다 —
--    "장치 A 는 이렇게 지키자고 하는데 장치 B 가 반대로 하고 있다".
--    (1) GRANT 는 보고 이력을 못 지우게 하는데 FK 가 CASCADE 로 지운다.
--    (2) cal_task_hours 는 과제 참조를 RESTRICT 로 잠갔는데 쌍둥이 cal_report_hours 는 안 잠갔다.
--    (3) cal_attendance 는 근태 코드·초과시간을 CHECK 로 잠갔는데 cal_report_daily 는 안 잠갔다.
--    (4) 정본 SQL 의 표 주석과 실 DB 의 표 주석이 갈렸다(문서가 거짓을 말한다).
--    (5) cal_* 는 UTC 로 적히는데 project·customer 계열은 KST 로 적힌다(같은 DB, 두 기준).
--    따로 내보내면 각각이 '왜 이걸 지금?' 이 되고, 특히 (5)는 코드 수정(ProjectDb 프리앰블)과
--    **반드시 함께** 가야 한다 — 한쪽만 가면 한 컬럼에 KST 와 UTC 가 섞인다(설계 §5.3 이 경고한 것).
--
--  【적용】
--    set MYSQL_PWD=...
--    mysql -uroot --default-character-set=utf8mb4 taskmgr < migrate-2026-09-09-integrity.sql
--    · 실행 전 백업 — db/deploy/backup-taskmgr.ps1  (★ (5)가 데이터를 바꾼다. 백업은 선택이 아니다)
--    · 적용 뒤 문서 재생성(표 주석이 바뀌므로):
--        node tools/schema-report/dump-schema.mjs
--        node tools/schema-report/build-schema-html.mjs
--        node tools/schema-report/build-db-schema-html.mjs
--
--  【정본 SQL 과의 관계】
--    같은 내용이 db/deploy/schema-calendar.sql 에도 들어갔다(신규 구축 경로).
--    두 경로가 같은 구조에 도달하는지는 mysqldump --no-data 대조로 실증한다 — 그러지 않으면
--    "마이그레이션으로 온 DB" 와 "새로 세운 DB" 가 조용히 갈린다((4)가 바로 그 사고의 잔해다).
--    ※ 표 주석 복구는 원래 db/deploy/repair-2026-09-09-table-comments.sql 이라는 독립 파일이었다.
--      이 파일이 흡수했으므로 그 파일은 삭제했다 — 정본이 둘이면 다음 사람이 어느 쪽을 믿을지 모른다.
-- =====================================================================

SET NAMES utf8mb4;
SET SESSION lock_wait_timeout = 10;
-- 이 세션이 쓰는 시각은 전부 UTC 로 — (5)의 산술은 리터럴이라 무관하지만,
-- ALTER 중에 서버 기본값이 한 줄이라도 발화하면 그것도 UTC 여야 한다(시각 컬럼 규약).
SET SESSION time_zone = '+00:00';

-- ── 0. 선행조건 가드 — v8 에서만 진행한다 ────────────────────────────
--   ★ 이 가드는 '앞선 마이그레이션 누락' 뿐 아니라 **재실행**도 막는다(위 ★★).
SET @v := (SELECT v FROM cal_schema_meta WHERE k = 'schema_version');
SET @g := IF(@v = '8', 'DO 0',
             'SELECT 1 FROM `중단: schema_version 이 8 이 아니다 - 이미 적용됐거나 앞선 마이그레이션이 빠졌다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 표가 실재하는지도 본다 — 없는 표에 ALTER 를 걸면 에러 메시지가 '왜' 를 말해 주지 않는다.
SET @miss := (SELECT 5 - COUNT(*) FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME IN ('cal_report_daily','cal_report_hours','cal_report_weekly','cal_category','project'));
SET @g := IF(@miss = 0, 'DO 0',
             'SELECT 1 FROM `중단: 대상 표가 없다 - schema-calendar.sql / schema-structure.sql 을 먼저 적용할 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- =====================================================================
--  (1) 소유자 외래키 규칙 통일 — CASCADE → RESTRICT
-- =====================================================================
--  이 DB 의 소유자 FK(app_user.user_id 를 가리키는 것)는 11개인데 9개가 RESTRICT 이고
--  fk_crd_user · fk_crw_user 둘만 CASCADE 였다. 그 둘이 하필 **보고 기록**이다.
--
--  왜 CASCADE 가 틀렸나 — 두 장치의 의도가 정반대였다:
--    · grants-calendar.sql 은 cal_report_daily · cal_report_weekly 에 DELETE 권한을 주지 않았다.
--      근거로 "보고한 사실은 지우는 대상이 아니다" 라고 적혀 있다.
--    · 그런데 FK 가 CASCADE 라, 퇴사자 정리에서 캘린더 표들을 RESTRICT 순서대로 치운 뒤
--      app_user 행을 지우는 순간 보고 이력이 **DELETE 권한 없이도** 함께 사라졌다.
--      FK 의 참조 동작은 GRANT 검사를 거치지 않는다 — 즉 FK 가 GRANT 의 방어를 우회했다.
--    RESTRICT 로 맞추면 그 자리에서 1451 로 멈춘다. 멈추는 것이 답이다 — 보고 이력을
--    정말 지워야 하는 상황이면 사람이 명시적으로 지우고 그 행위가 기록에 남아야 한다.
--
--  ※ 지금 세 보고 표는 0행이라 이 변경의 비용은 0이다. 비어 있을 때 고치는 것이 싸다.
ALTER TABLE cal_report_daily  DROP FOREIGN KEY fk_crd_user;
ALTER TABLE cal_report_daily  ADD CONSTRAINT fk_crd_user FOREIGN KEY (user_id)
  REFERENCES app_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE cal_report_weekly DROP FOREIGN KEY fk_crw_user;
ALTER TABLE cal_report_weekly ADD CONSTRAINT fk_crw_user FOREIGN KEY (user_id)
  REFERENCES app_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- =====================================================================
--  (2) 보고 공수의 과제 참조 — 제한 외래키 신설 fk_crh_cat
-- =====================================================================
--  cat_no 는 AUTO_INCREMENT 가 아니라 MAX()+1 발번이다(설계 H-1) — **삭제된 번호가 재사용된다.**
--  참조가 없으면 이미 회사로 나간 공수가 나중에 같은 번호를 받은 **다른 과제**의 것으로
--  조용히 흡수된다. 쌍둥이 표 cal_task_hours 는 이 문제를 2026-08-24 에 이미
--  fk_cal_task_hours_category(RESTRICT)로 풀었다(schema-calendar.sql 의 그 주석 참조).
--  같은 병에 같은 약을 쓰는 것이지 새 규칙을 만드는 것이 아니다.
--
--  ★★ 이 FK 는 **오늘 아무 동작도 바꾸지 않는다** — 그래도 거는 이유
--    지금 앱은 cat_no 를 항상 NULL 로 쓴다(MainWindow.xaml.cs:2053 —
--    `new ReportHourLine { TaskName = name.Trim(), CatNo = null, Hours = h }`).
--    복합 FK 는 MATCH SIMPLE 이라 열 하나라도 NULL 이면 참조 검사가 면제된다.
--    즉 현 데이터·현 코드에서는 이 제약이 발화할 일이 없다(그래서 지금 거는 것이 무비용이다).
--    이 FK 가 하는 일은 **나중에 cat_no 를 채우는 사람에게 규칙을 강제하는 것**이다 —
--    "과제를 지우기 전에 그 과제를 가리키는 보고 공수의 cat_no 를 먼저 비워라".
--    그 사람이 이 주석을 못 봐도 DB 가 1451 로 알려 준다. 그게 가드의 값어치다.
--
--  ※ 지지 인덱스는 기존 idx_crh_cat (user_id, cat_no, work_date) 가 그대로 맡는다 —
--    선두 두 열이 FK 열과 같아 MySQL 이 이 인덱스를 쓴다. 새 인덱스를 만들지 않는다.
ALTER TABLE cal_report_hours ADD CONSTRAINT fk_crh_cat
  FOREIGN KEY (user_id, cat_no) REFERENCES cal_category (user_id, cat_no)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- =====================================================================
--  (3) 보고 표 제약 이식 — 쌍둥이 원본과 같은 규율
-- =====================================================================
--  cal_report_daily 의 status·overtime 은 cal_attendance 와 "같은 타입이라 대조 가능" 하다고
--  적혀 있는데, 정작 **값의 규율은 한쪽에만** 있었다. 대조를 전제로 만든 컬럼이 상대보다
--  느슨하면 대조가 성립하지 않는다(한쪽에만 있을 수 있는 값이 생긴다).
--
--  ★ DEFAULT '' 는 유지한다 — cal_attendance 와 여기가 다른 지점이다
--    cal_attendance 의 계약은 '미기록 = 행 없음' 이라 '' 가 필요 없고, 그래서 그쪽 IN 목록에는
--    '' 가 없다(그 목록의 주석이 "''를 끼워 넣지 말 것" 이라고 못 박아 두었다).
--    cal_report_daily 는 반대다 — 보고를 보내면 **하루 한 행이 반드시 생긴다.** 그래서
--    '근태를 안 적었다' 를 표현할 값이 필요하고 그 값이 '' 다.
--    게다가 ReportDb 는 Clamp2(status) 로 길이만 자르고 값을 검증하지 않으므로, '' 를 금지하면
--    근태 미기재일의 보고 저장이 통째로 3819 로 죽는다(전송은 이미 나간 뒤다 — §5.9 의 "실패해도
--    전송을 깨지 않는다" 가 무력해진다). 그래서 '' 를 도메인에 **명시적으로 포함**시킨다.
--    이것이 cal_attendance 목록과의 유일한 차이이고, 의도된 차이다.
--
--  ★ status NOT LIKE '% ' 를 함께 거는 근거는 schema-calendar.sql 의
--    chk_cal_attendance_status 주석에 이미 적혀 있다(utf8mb4_bin 은 PAD SPACE 라
--    '1 ' IN ('1',…) 가 TRUE 다 — IN 목록만으로는 뒤 공백이 통과한다. 실측 8.4.9).
--    같은 collation 을 쓰는 컬럼이므로 같은 구멍이 그대로 있다.
ALTER TABLE cal_report_daily
  ADD CONSTRAINT chk_crd_status CHECK (status IN ('','1','2','3','4','5','6','7','9','10','11','12')
                                   AND status NOT LIKE '% ');
--  앱의 검증 규약과 같다: `if(!(ot >= 0 && ot <= 11)) ot = 0`. cal_attendance 와 글자까지 같은 범위다.
ALTER TABLE cal_report_daily
  ADD CONSTRAINT chk_crd_overtime CHECK (overtime >= 0 AND overtime <= 11);

--  공수: 폭과 범위를 원본(cal_task_hours)에 맞춘다.
--    · DECIMAL(5,2) → DECIMAL(4,2): 하루 한 줄의 공수에 999.99 시간을 담을 자리는 필요 없다.
--      cal_task_hours 가 이미 DECIMAL(4,2) 이고, 폭이 다르면 두 표를 합쳐 집계할 때
--      한쪽에만 들어갈 수 있는 값이 생긴다.
--    · hours >= 0 → hours > 0 AND hours <= 24: cal_task_hours 의 chk_cal_task_hours_range 와 같다.
--      0 은 '기록할 것이 없다' 이지 '0시간을 일했다' 가 아니다 — 캘린더 쪽은 이미 0 을 행 삭제로 다룬다.
--      상한 24 가 없으면 파서가 잘못 읽은 240 이 그대로 회사 보고 집계에 들어간다.
--    ★ 이 좁힘은 앱과 짝이다 — ReportDb.cs 의 0시간 줄 필터를 `< 0` 에서 `<= 0` 으로 함께 고쳤다.
--      한쪽만 고치면 0시간 줄이 CHECK 에 걸려 그 날 보고 저장 트랜잭션 전체가 죽는다.
--    ※ 지금 cal_report_hours 는 0행이라 폭 축소·범위 축소 모두 무비용이다.
ALTER TABLE cal_report_hours MODIFY hours DECIMAL(4,2) NOT NULL;
ALTER TABLE cal_report_hours DROP CHECK chk_crh_hours;
ALTER TABLE cal_report_hours ADD CONSTRAINT chk_crh_hours CHECK (hours > 0 AND hours <= 24);

-- =====================================================================
--  (4) 표 주석을 v8 정본에 맞춤 — 드리프트 복구
-- =====================================================================
--  실 taskmgr 은 마이그레이션을 거쳐 지금 모양이 됐고, migrate-*.sql 들은 컬럼·키·CHECK 는
--  바꿨지만 **표 주석(TABLE_COMMENT)은 안 바꿨다.** 그래서 같은 schema_version 8 인데도
--    · 마이그레이션으로 온 DB (= 개발 PC)
--    · schema-structure.sql 로 새로 세운 DB (= 폐쇄망이 갈 길)
--  두 DB 의 표 주석이 갈렸다. 실측(신규 구축본과 mysqldump 대조, 2026-09-09):
--    표 주석 3건 불일치 · 컬럼 주석 0건 · 컬럼/키/FK/CHECK/인덱스는 전부 일치.
--
--  왜 주석 하나가 문제인가: docs/DB-SCHEMA.html 과 db/table-design-report.html 이
--  표 설명을 "DB 의 표 주석 그대로" 싣는다. 그래서 이 드리프트가 곧 문서의 거짓말이 된다.
--  특히 project 의 낡은 주석은 section/status 를 아직 ENUM 이라고 적는데 코드테이블+FK 로 바꾼 지
--  오래다 — 배포 검토자가 "section_code 와 status_code 가 뭐가 다르냐" 고 물은 바로 그 자리에서
--  문서가 틀린 답을 준다.
--  문구 정본은 db/deploy/schema-structure.sql 의 각 CREATE TABLE 끝 COMMENT 다(글자까지 같다).
ALTER TABLE project      COMMENT='과제 마스터. DB 원본. section/status=코드테이블+FK, is_active=소프트삭제.';
ALTER TABLE section_code COMMENT='구분 코드. name=자연키. 개명=FK CASCADE. Admin 관리.';
ALTER TABLE status_code  COMMENT='상태 코드. name=자연키. 개명=FK CASCADE. Admin 관리.';

-- =====================================================================
--  (5) 감사 시각 1회 정규화 — KST 로 적힌 기존 행을 UTC 로 되돌린다
-- =====================================================================
--  【무엇이 잘못돼 있었나 — 2026-09-09 실측】
--    cal_* 를 쓰는 CalendarDb · CalendarWriteDb · ReportDb 는 접속 프리앰블에
--    SET SESSION time_zone='+00:00' 을 건다. 그런데 **ProjectDb 에는 프리앰블이 없었다.**
--    ProjectDb 가 쓰는 표(project · customer · section_code · status_code)의 created_at/updated_at 은
--    서버 기본값 CURRENT_TIMESTAMP(3) 이고, CURRENT_TIMESTAMP 는 세션 time_zone 으로 평가된다.
--    이 서버의 time_zone 은 SYSTEM=KST 다 → 그 표들만 **KST 로 적혀 왔다.**
--    실측 대조: customer 저장 16:05:39 / 같은 시계의 물리 기록 16:05:56 (차이 없음 = KST),
--              cal_category 저장 03:09:01 / 물리 기록 12:09:01 (9시간 차 = UTC).
--    app_user · org_unit · title_code 도 같은 처지다 — 사내 시드 스크립트를 mysql 클라이언트로
--    돌렸고 그 세션 역시 SYSTEM=KST 였다.
--
--  【왜 코드 수정만으로는 안 되는가】
--    widget/ProjectDb.cs 에 프리앰블을 넣었으므로 **앞으로 쓰는 행은 UTC** 다.
--    그 경계 이전 행을 그대로 두면 한 컬럼 안에 KST 행과 UTC 행이 섞인다 —
--    설계 §5.3 이 "DATETIME 은 사후에 둘을 구분할 수단이 없다(복구 불가)" 며 금지한 바로 그 상태다.
--    지금은 아직 구분할 수 있다: **이 파일 이전 행은 전부 KST** 라는 사실이 아직 참이다.
--    그 사실이 참인 동안에만 이 정규화가 가능하다. 그래서 코드 수정과 같은 판에 넣었다.
--
--  ★★ 함정 — updated_at 을 SET 목록에 반드시 함께 적을 것
--    이 7표의 updated_at 에는 전부 ON UPDATE CURRENT_TIMESTAMP(3) 이 걸려 있다(실측).
--    created_at 만 UPDATE 하면 updated_at 이 서버 함수로 덮여 **시프트가 무효가 될 뿐 아니라
--    값이 지금 시각으로 날아간다.** MySQL 은 updated_at 이 SET 목록에 명시되면 ON UPDATE 를
--    발화시키지 않으므로, 아래처럼 둘 다 명시 대입해야 한다.
--    다음 사람이 "created_at 만 고치면 되겠네" 하고 줄을 지우면 조용히 깨진다 — 지우지 말 것.
--
--  ※ 리터럴 시간 산술이라 세션 time_zone 과 무관하다(위 SET SESSION time_zone 은 이 항목을 위한 것이 아니다).
--  ※ 대상은 '감사 컬럼' 뿐이다. 업무 의미가 있는 날짜(project 의 기간 등)는 DATE 이고 손대지 않는다.
UPDATE app_user     SET created_at = DATE_SUB(created_at, INTERVAL 9 HOUR),
                        updated_at = DATE_SUB(updated_at, INTERVAL 9 HOUR);
UPDATE customer     SET created_at = DATE_SUB(created_at, INTERVAL 9 HOUR),
                        updated_at = DATE_SUB(updated_at, INTERVAL 9 HOUR);
UPDATE org_unit     SET created_at = DATE_SUB(created_at, INTERVAL 9 HOUR),
                        updated_at = DATE_SUB(updated_at, INTERVAL 9 HOUR);
UPDATE project      SET created_at = DATE_SUB(created_at, INTERVAL 9 HOUR),
                        updated_at = DATE_SUB(updated_at, INTERVAL 9 HOUR);
UPDATE section_code SET created_at = DATE_SUB(created_at, INTERVAL 9 HOUR),
                        updated_at = DATE_SUB(updated_at, INTERVAL 9 HOUR);
UPDATE status_code  SET created_at = DATE_SUB(created_at, INTERVAL 9 HOUR),
                        updated_at = DATE_SUB(updated_at, INTERVAL 9 HOUR);
UPDATE title_code   SET created_at = DATE_SUB(created_at, INTERVAL 9 HOUR),
                        updated_at = DATE_SUB(updated_at, INTERVAL 9 HOUR);

-- =====================================================================
--  버전 갱신
-- =====================================================================
UPDATE cal_schema_meta SET v = '9', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'schema_version' AND v = '8';

-- =====================================================================
--  사후 검증 — 사람이 읽는 E1~E5 + 기계가 막는 @bad
-- =====================================================================
SELECT CONCAT('  소유자 FK 중 RESTRICT 아닌 것 : ', COUNT(*), '건(0 이어야 한다)') AS `E1`
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE()
   AND CONSTRAINT_NAME IN ('fk_crd_user','fk_crw_user')
   AND DELETE_RULE <> 'RESTRICT';
SELECT CONCAT('  fk_crh_cat : ',
              (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_crh_cat'),
              '건(1) · chk_crd_status/overtime : ',
              (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE()
                  AND CONSTRAINT_NAME IN ('chk_crd_status','chk_crd_overtime')),
              '건(2)') AS `E2`;
SELECT CONCAT('  cal_report_hours.hours 정밀도 : ', NUMERIC_PRECISION, '(4 여야 한다)') AS `E3`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND COLUMN_NAME = 'hours';
SELECT CONCAT('  project 표 주석 : ', TABLE_COMMENT) AS `E4`
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project';
SELECT CONCAT('  schema_version = ', v) AS `E5` FROM cal_schema_meta WHERE k = 'schema_version';

SET @bad := (SELECT
    (SELECT COUNT(*) <> 2 FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND CONSTRAINT_NAME IN ('fk_crd_user','fk_crw_user') AND DELETE_RULE = 'RESTRICT')
  + (SELECT COUNT(*) = 0 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_crh_cat'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY')
  + (SELECT COUNT(*) <> 2 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND CONSTRAINT_NAME IN ('chk_crd_status','chk_crd_overtime'))
  + (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours'
        AND COLUMN_NAME = 'hours' AND NUMERIC_PRECISION = 4)
  + (SELECT COUNT(*) <> 0 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND TABLE_COMMENT LIKE '%ENUM%')
  + (SELECT COUNT(*) = 0 FROM cal_schema_meta WHERE k = 'schema_version' AND v = '9'));
SET @g := IF(@bad = 0, 'DO 0', 'SELECT 1 FROM `중단: 사후 검증 실패 - 위 E1~E5 를 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT '완료 — 소유자 FK RESTRICT · fk_crh_cat · 보고 표 CHECK · 표 주석 · 감사 시각 UTC 정규화 · schema_version 9' AS `결과`;
