-- @migration from=21 to=22
-- =====================================================================
--  v22-report-hours.sql: 이관 조각, DB 구조 번호 21 에서 22 로
--  일간보고 과제별 줄, 안 쓰는 표 셋 정리, 공식 과제 연결 이관(docs/DB-V22-REPORT-HOURS.md, 2026-11-06 사용자 결정).
-- =====================================================================
--
--  이 파일은 혼자 실행하지 않는다.
--    installer/publish-update.ps1(installer/release-sql.ps1)이 이 폴더의 조각을 구조 번호 순서로 이어 붙여
--    dist/installer/release-v<버전>.sql 하나를 만든다. 운영자는 그 파일만 받아 Workbench 에서 한 번 실행한다.
--    release SQL 이 확인과 닫기(db_updating = 1)를 한 뒤 조각을 돌리고, 끝에서 한 트랜잭션으로 연다.
--    조각은 닫지도 열지도 않는다(DB-RELEASE-OPS §5). 닫히지 않은 DB 에서 이 조각만 돌리면 첫 확인에서 멈춘다.
--
--  바꾸는 것(순서가 강제된다. 틀리면 멈추거나, 오류 없이 색인이 엉뚱한 모양으로 남는다):
--    1) cal_report_hours 의 옛 줄을 모두 지운다(DELETE ... WHERE user_id > 0). 앱이 읽은 적 없는 쓰기 전용 줄이고
--       같은 내용이 cal_report_daily.content 에 다 있다(사용자 결정). 그래서 cat_no 가 찬 줄도 0 이 된다.
--    2) cal_report_hours 의 과제 번호 참조를 걷는다: FK fk_crh_cat, 색인 idx_crh_cat, 칸 cat_no 순서.
--       FK 를 먼저 끊지 않으면 색인을 못 지우고(1553), 칸을 먼저 지우면 색인이 남은 칸만으로 줄어 남는다.
--    3) 시간 제약 chk_crh_hours 를 hours >= 0 AND hours <= 24 로 바꾼다(내용이 있는 0시간 블록도 줄로 남긴다).
--       지우기와 만들기를 두 문장으로 나눈다(한 문장에 같은 이름을 지우고 만들면 실패한다).
--    4) 칸 추가(정본 자리대로, INSTANT): cal_report_hours.cat_uid, project_uid(task_name 뒤), body(hours 뒤),
--       cal_report_daily.memo(content 뒤), cal_report_weekly_hours.cat_uid(task_name 뒤).
--       색인 추가: ix_crh_project(project_uid, work_date), ix_crh_cat(user_id, cat_uid), ix_crwh_cat(user_id, cat_uid).
--       cal_report_hours 표 설명 갱신.
--       정의는 정본 db/deploy/schema-calendar.sql 의 그 줄과 글자까지 같다(작은따옴표만 두 겹. 시험이 대조한다).
--    5) 기존 주간 줄 cat_uid 채우기(한 트랜잭션): project_uid 가 있는 줄은 CONCAT('db-', project_uid).
--       project_uid 가 NULL 인 줄은 그 사람의 개인 과제(source = 'local') 가운데 이름이 글자까지 같은(_bin) 과제가
--       하나뿐일 때만 그 uid. 둘 이상이거나 없으면 NULL 로 둔다(그 줄은 공식 과제 이관 대상이 아니다. 알고 가는 한계).
--    6) 검증(information_schema). 다르면 db_updating = 1 인 채로 멈춘다.
--    7) 안 쓰는 표 셋을 지운다: cal_task_hours, cal_migration_log, cal_user_pref. 검증을 통과한 뒤 맨 끝에.
--    8) 구조 번호 22.
--
--  ★ 되돌릴 수 없다: 1) 은 옛 일간 줄을 지우고 7) 은 표 셋을 지운다. 운영 DB 를 백업한 뒤 돌린다(DB-RELEASE-OPS 배포 전 백업).
--
--  DELETE 와 UPDATE 에는 모두 키 칸 조건 WHERE(user_id > 0)를 적는다. Workbench 안전 갱신 모드가 1175 로 막으면
--    release SQL 이 닫힌 채 멈춘다(2026-11-02 0.25.0 사고, DB-RELEASE-OPS 6-1). INSERT IGNORE 를 쓰지 않는다.
--
--  권한: 이 조각은 권한을 주거나 거두지 않는다(배포 SQL 에서 금지, DB-RELEASE-OPS §5).
--    새 칸과 색인은 표가 그대로라 앱 계정의 표 단위 권한이 그대로 닿는다. 지운 표의 표 단위 권한 줄은
--    mysql.tables_priv 에 남을 수 있으나 동작에는 영향이 없다(정리는 root 가 따로, 선택).
--
--  다시 돌리기: 안전하다.
--    - 구조 번호가 이미 22 이상이면 아무것도 하지 않는다(건너뛴 배포를 몰아서 올릴 때, 끝난 뒤 다시 돌릴 때).
--    - 앞선 실행이 어느 문장 뒤에서 멈췄든 이어서 끝낸다. 단계마다 information_schema 로 지금 모양을 보고 한 번만 바꾼다.
--      지우기(1)와 채우기(5)는 다시 돌려도 결과가 같다(닫힌 동안 새 보고 줄은 생기지 않는다).
--    - 21 도 22 이상도 아니면 멈춘다(앞 판이 빠졌거나 손댄 값).
--
--  멈추는 방법: 저장 프로그램을 쓰지 않는다. 조건으로 실행할 문장을 고르고(PREPARE/EXECUTE),
--    조건이 틀리면 없는 표 이름을 SELECT 해 ERROR 1146 을 낸다. 그 표 이름이 멈춘 이유다.
--
--  앱 쪽 짝: DbGate.AppStructureVersion 22, 정본 schema-calendar.sql 의 cal_report_hours, cal_report_daily,
--    cal_report_weekly_hours 와 시딩 22(tests/release-sql.test.mjs, tests/schema-guards.test.mjs, tests/version-gate-host.test.mjs).
--    MySQL 8.4 실제 리허설: tools/db-rehearsal/rehearse-v22.mjs(처음, 다시, 단계마다 끊고 다시, 새로 깐 DB 와 대조).
--  조각 규칙(DB-RELEASE-OPS §5.2): 변수는 @go, @skip, @g, @s 와 @m_ 만 쓴다(@r_ 는 감싸개 몫).
--    잠금 대기 상한(lock_wait_timeout)은 release SQL 맨 위에서 한 번 건다. 조각은 걸지 않는다.
-- =====================================================================

-- 1) 확인: 21 이면 올리고, 22 이상이면 건너뛴다. 올릴 때는 닫힌 상태(db_updating = 1)여야 한다
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @m_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @go := (@m_cur <=> '21');
SET @skip := (@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 22);
SET @g := IF(@go OR @skip, 'DO 0',
             'SELECT 1 FROM `중단: v22 조각 - 구조 번호가 21 도 22 이상도 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(NOT @go OR @m_upd <=> '1', 'DO 0',
             'SELECT 1 FROM `중단: v22 조각 - 닫히지 않았다 - release SQL 로만 돌린다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

--    바꿀 표 셋이 있어야 한다(없으면 아래 문장이 1146 으로 멈추기 전에 이유를 적고 멈춘다. 아무것도 바뀌지 않았다)
SET @m_tbl := (SELECT COUNT(*) FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('cal_report_hours', 'cal_report_daily', 'cal_report_weekly_hours'));
SET @g := IF(NOT @go OR @m_tbl = 3, 'DO 0',
             'SELECT 1 FROM `중단: v22 조각 - 일간이나 주간 보고 표가 없다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '21 에서 22 로 올린다(일간보고 과제별 줄, 안 쓰는 표 셋 정리)', '이미 22 이상이다. 건너뛴다') AS `v22 조각`;

--    주간 줄 수를 바꾸기 전에 센다(검증에서 같은지 본다). 표 이름을 고정해 읽으므로 @go 일 때만 실행한다.
SET @m_wn0 := NULL;
SET @s := IF(@go, 'SELECT COUNT(*) INTO @m_wn0 FROM cal_report_weekly_hours', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 2) cal_report_hours 옛 줄 지우기(한 트랜잭션). 다시 돌려도 같다(닫힌 동안 새 줄은 생기지 않는다).
--    WHERE 에 user_id > 0 을 적는다(Workbench 안전 갱신 모드 1175).
START TRANSACTION;
SET @s := IF(@go, 'DELETE FROM cal_report_hours WHERE user_id > 0', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
COMMIT;

-- 3) 과제 번호 참조 걷기: FK, 색인, 칸 순서. 구조 변경 문장이라 트랜잭션으로 묶지 않는다(하나씩 자동 확정된다).
SET @m_fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND CONSTRAINT_NAME = 'fk_crh_cat' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @s := IF(@go AND @m_fk = 1, 'ALTER TABLE cal_report_hours DROP FOREIGN KEY fk_crh_cat', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @m_ix := (SELECT COUNT(*) FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME = 'idx_crh_cat');
SET @s := IF(@go AND @m_ix > 0, 'ALTER TABLE cal_report_hours DROP INDEX idx_crh_cat', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

--    FK 를 ALTER 로 더한 DB 에서는 MySQL 이 FK 이름으로 받침 색인을 따로 만들었을 수 있다. 있으면 함께 지운다(정본으로 깐 DB 에는 없다).
SET @m_ix := (SELECT COUNT(*) FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME = 'fk_crh_cat');
SET @s := IF(@go AND @m_ix > 0, 'ALTER TABLE cal_report_hours DROP INDEX fk_crh_cat', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND COLUMN_NAME = 'cat_no');
SET @s := IF(@go AND @m_col = 1, 'ALTER TABLE cal_report_hours DROP COLUMN cat_no, ALGORITHM=INSTANT', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 4) 시간 제약: 옛 글(> 0)이면 지우고, 없으면 새 글(>= 0)로 만든다. 두 문장이다.
--    지운 뒤 만들기 전에 멈췄으면 다시 돌릴 때 지우기는 건너뛰고 만들기만 한다.
SET @m_ck := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND CONSTRAINT_NAME = 'chk_crh_hours' AND CONSTRAINT_TYPE = 'CHECK');
SET @m_cknew := (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
                  WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_crh_hours' AND CHECK_CLAUSE LIKE '%>= 0%' AND CHECK_CLAUSE LIKE '%<= 24%');
SET @s := IF(@go AND @m_ck = 1 AND @m_cknew = 0, 'ALTER TABLE cal_report_hours DROP CHECK chk_crh_hours', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @m_ck := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND CONSTRAINT_NAME = 'chk_crh_hours' AND CONSTRAINT_TYPE = 'CHECK');
SET @s := IF(@go AND @m_ck = 0, 'ALTER TABLE cal_report_hours ADD CONSTRAINT chk_crh_hours CHECK (hours >= 0 AND hours <= 24)', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 5) 칸 추가: 없을 때만(MySQL 에는 ADD COLUMN IF NOT EXISTS 가 없다). 정본 schema-calendar.sql 의 그 줄과 같은 정의, 같은 자리.
--    INSTANT 라 즉시 변경이 안 되는 서버면 표를 복사하지 않고 실패한다(DB-RELEASE-OPS §5.1). 있는 행은 새 칸이 NULL 로 생긴다.
SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND COLUMN_NAME = 'cat_uid');
SET @s := IF(@go AND @m_col = 0,
  'ALTER TABLE cal_report_hours ADD COLUMN cat_uid VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL COMMENT ''그 블록의 앱 과제 id 원문(cal_category.uid 와 같은 정의). NULL 은 캘린더 과제와 이어지지 않은 블록. FK 없음'' AFTER task_name, ALGORITHM=INSTANT',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND COLUMN_NAME = 'project_uid');
SET @s := IF(@go AND @m_col = 0,
  'ALTER TABLE cal_report_hours ADD COLUMN project_uid CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT ''공식 과제 id(project.uid). 개인 과제는 NULL. 과제가 지워져도 남도록 FK 없음'' AFTER cat_uid, ALGORITHM=INSTANT',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND COLUMN_NAME = 'body');
SET @s := IF(@go AND @m_col = 0,
  'ALTER TABLE cal_report_hours ADD COLUMN body MEDIUMTEXT NULL COMMENT ''그 과제의 그날 내용(보낸 그대로의 줄바꿈과 들여쓰기). 새 앱은 NULL 을 쓰지 않는다(없으면 빈 글)'' AFTER hours, ALGORITHM=INSTANT',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_daily' AND COLUMN_NAME = 'memo');
SET @s := IF(@go AND @m_col = 0,
  'ALTER TABLE cal_report_daily ADD COLUMN memo MEDIUMTEXT NULL COMMENT ''근태 일간 작성의 자유 메모(구조 22). NULL 은 이 칸이 생기기 전의 옛 보고(content 를 해석한다)'' AFTER content, ALGORITHM=INSTANT',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly_hours' AND COLUMN_NAME = 'cat_uid');
SET @s := IF(@go AND @m_col = 0,
  'ALTER TABLE cal_report_weekly_hours ADD COLUMN cat_uid VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL COMMENT ''그 줄의 앱 과제 id 원문(cal_category.uid 와 같은 정의). NULL 은 캘린더 과제와 이어지지 않은 줄. FK 없음'' AFTER task_name, ALGORITHM=INSTANT',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 6) 색인 추가: 없을 때만. 정본의 KEY 줄과 같은 이름, 같은 칸 순서.
SET @m_ix := (SELECT COUNT(*) FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME = 'ix_crh_project');
SET @s := IF(@go AND @m_ix = 0, 'ALTER TABLE cal_report_hours ADD INDEX ix_crh_project (project_uid, work_date)', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @m_ix := (SELECT COUNT(*) FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME = 'ix_crh_cat');
SET @s := IF(@go AND @m_ix = 0, 'ALTER TABLE cal_report_hours ADD INDEX ix_crh_cat (user_id, cat_uid)', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @m_ix := (SELECT COUNT(*) FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly_hours' AND INDEX_NAME = 'ix_crwh_cat');
SET @s := IF(@go AND @m_ix = 0, 'ALTER TABLE cal_report_weekly_hours ADD INDEX ix_crwh_cat (user_id, cat_uid)', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 7) 표 설명(정본 schema-calendar.sql 의 cal_report_hours COMMENT 와 같은 글자). 메타데이터만 바뀐다.
SET @s := IF(@go, 'ALTER TABLE cal_report_hours COMMENT = ''근태 일간보고 과제별 줄. 주간 불러오기, 이전 보고, 공수 집계, 공식 과제 이관의 원천''', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SELECT IF(@go, '일간 과제별 줄 표를 바꿨다(옛 줄 지움, 과제 id 칸, 내용 칸, 0시간 허용)', '바꿀 것이 없다') AS `v22 일간 줄`;

-- 8) 기존 주간 줄 cat_uid 채우기(한 트랜잭션). 아직 빈 줄만 채우므로 다시 돌려도 같다.
--    a) 공식 과제 줄: 앱의 공식 과제 id 는 db-<project.uid> 다.
--    b) 개인 과제 줄: 그 사람의 개인 과제 가운데 이름이 글자까지 같은 과제가 하나뿐일 때만. 묶기와 비교를 _bin 으로 한다
--       (표 기본 콜레이션은 대소문자를 구분하지 않아 다른 과제를 하나로 셀 수 있다).
START TRANSACTION;
SET @s := IF(@go, 'UPDATE cal_report_weekly_hours SET cat_uid = CONCAT(''db-'', project_uid) WHERE user_id > 0 AND cat_uid IS NULL AND project_uid IS NOT NULL', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @s := IF(@go,
  'UPDATE cal_report_weekly_hours h JOIN (SELECT user_id, name COLLATE utf8mb4_bin AS nm, MIN(uid) AS uid FROM cal_category WHERE source = ''local'' GROUP BY user_id, nm HAVING COUNT(*) = 1) c ON c.user_id = h.user_id AND c.nm = h.task_name COLLATE utf8mb4_bin SET h.cat_uid = c.uid WHERE h.user_id > 0 AND h.cat_uid IS NULL AND h.project_uid IS NULL',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
COMMIT;

--    채운 결과를 보여 준다(바꾸지 않는다). 개인 과제 줄 가운데 빈 줄은 이름이 같은 개인 과제가 없거나 둘 이상인 줄이다.
SET @s := IF(@go, 'SELECT COUNT(*) AS `주간 줄`, SUM(cat_uid LIKE ''db-%'') AS `공식 과제 id`, SUM(cat_uid IS NOT NULL AND cat_uid NOT LIKE ''db-%'') AS `개인 과제 id`, SUM(cat_uid IS NULL) AS `빈 줄` FROM cal_report_weekly_hours', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 9) 검증(information_schema). 틀리면 db_updating = 1 인 채로 멈춘다(앱은 계속 기다린다).
--    칸이 있어도 이름이 같은 다른 모양일 수 있어(위 단계는 이름만 보고 건너뛴다) 모양을 다시 본다.
--    a) cal_report_hours: 칸 순서, 새 칸 셋의 형과 NULL 허용과 콜레이션(project_uid 는 project.uid 와 같은 콜레이션), 행 0
SET @m_hcols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours');
SET @m_hnew := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND IS_NULLABLE = 'YES'
                   AND ((COLUMN_NAME = 'cat_uid' AND COLUMN_TYPE = 'varchar(80)' AND COLLATION_NAME = 'utf8mb4_bin')
                     OR (COLUMN_NAME = 'project_uid' AND COLUMN_TYPE = 'char(36)'
                         AND COLLATION_NAME = (SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'uid'))
                     OR (COLUMN_NAME = 'body' AND COLUMN_TYPE = 'mediumtext')));
SET @m_hn := NULL;
SET @s := IF(@go, 'SELECT COUNT(*) INTO @m_hn FROM cal_report_hours', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @g := IF(NOT @go OR (@m_hcols <=> 'user_id,work_date,line_no,task_name,cat_uid,project_uid,hours,body' AND @m_hnew = 3 AND @m_hn = 0), 'DO 0',
             'SELECT 1 FROM `중단: v22 조각 검증 실패 - 일간 줄 표의 칸이 다르거나 옛 줄이 남았다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

--    b) cal_report_hours: FK 는 fk_crh_daily(cal_report_daily 로 CASCADE) 하나, 색인은 기본 키와 새 색인 둘(칸과 순서),
--       idx_crh_cat 없음, 시간 제약 글이 >= 0 이고 <= 24
SET @m_hfk := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours');
SET @m_hfd := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND CONSTRAINT_NAME = 'fk_crh_daily'
                  AND REFERENCED_TABLE_NAME = 'cal_report_daily' AND DELETE_RULE = 'CASCADE' AND UPDATE_RULE = 'CASCADE');
SET @m_hix := (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours');
SET @m_hip := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME = 'ix_crh_project');
SET @m_hic := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME = 'ix_crh_cat');
SET @m_hio := (SELECT COUNT(*) FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME = 'idx_crh_cat');
SET @m_hck := (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_crh_hours' AND CHECK_CLAUSE LIKE '%>= 0%' AND CHECK_CLAUSE LIKE '%<= 24%');
SET @m_hcm := (SELECT COUNT(*) FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND TABLE_COMMENT = '근태 일간보고 과제별 줄. 주간 불러오기, 이전 보고, 공수 집계, 공식 과제 이관의 원천');
SET @g := IF(NOT @go OR (@m_hfk = 1 AND @m_hfd = 1 AND @m_hix = 3 AND @m_hip <=> 'project_uid,work_date' AND @m_hic <=> 'user_id,cat_uid'
                         AND @m_hio = 0 AND @m_hck = 1 AND @m_hcm = 1), 'DO 0',
             'SELECT 1 FROM `중단: v22 조각 검증 실패 - 일간 줄 표의 FK, 색인, 시간 제약이 다르다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

--    c) cal_report_daily.memo(mediumtext, NULL 허용, content 바로 뒤)
SET @m_dm := (SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_daily' AND COLUMN_NAME = 'memo'
                 AND COLUMN_TYPE = 'mediumtext' AND IS_NULLABLE = 'YES');
SET @m_dp := (SELECT COUNT(*) FROM information_schema.COLUMNS a JOIN information_schema.COLUMNS b
                 ON b.TABLE_SCHEMA = a.TABLE_SCHEMA AND b.TABLE_NAME = a.TABLE_NAME AND b.ORDINAL_POSITION = a.ORDINAL_POSITION + 1
               WHERE a.TABLE_SCHEMA = DATABASE() AND a.TABLE_NAME = 'cal_report_daily' AND a.COLUMN_NAME = 'content' AND b.COLUMN_NAME = 'memo');
SET @g := IF(NOT @go OR (@m_dm = 1 AND @m_dp = 1), 'DO 0',
             'SELECT 1 FROM `중단: v22 조각 검증 실패 - 일간보고 메모 칸의 형이나 자리가 다르다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

--    d) cal_report_weekly_hours: 칸 순서, cat_uid 의 형과 콜레이션, ix_crwh_cat 의 칸과 순서, 줄 수가 바뀌기 전과 같다
SET @m_wcols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly_hours');
SET @m_wnew := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly_hours' AND IS_NULLABLE = 'YES'
                   AND COLUMN_NAME = 'cat_uid' AND COLUMN_TYPE = 'varchar(80)' AND COLLATION_NAME = 'utf8mb4_bin');
SET @m_wic := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly_hours' AND INDEX_NAME = 'ix_crwh_cat');
SET @m_wn := NULL;
SET @s := IF(@go, 'SELECT COUNT(*) INTO @m_wn FROM cal_report_weekly_hours', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @g := IF(NOT @go OR (@m_wcols <=> 'user_id,period_start,line_no,task_name,cat_uid,project_uid,hours' AND @m_wnew = 1
                         AND @m_wic <=> 'user_id,cat_uid' AND @m_wn <=> @m_wn0), 'DO 0',
             'SELECT 1 FROM `중단: v22 조각 검증 실패 - 주간 줄 표의 과제 id 칸, 색인, 줄 수가 다르다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 10) 안 쓰는 표 셋 지우기(검증을 통과한 뒤 맨 끝). 다른 표가 이 셋을 FK 로 가리키지 않는다(셋 다 자식 표다).
--     이미 없으면 건너뛴다(IF EXISTS). 앞선 실행이 하나만 지우고 멈췄어도 이어서 끝낸다.
SET @s := IF(@go, 'DROP TABLE IF EXISTS cal_task_hours', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @s := IF(@go, 'DROP TABLE IF EXISTS cal_migration_log', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @s := IF(@go, 'DROP TABLE IF EXISTS cal_user_pref', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @m_old := (SELECT COUNT(*) FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('cal_task_hours', 'cal_migration_log', 'cal_user_pref'));
SET @g := IF(NOT @go OR @m_old = 0, 'DO 0',
             'SELECT 1 FROM `중단: v22 조각 검증 실패 - 지울 표가 남았다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '안 쓰는 표 셋을 지웠다(cal_task_hours, cal_migration_log, cal_user_pref)', '지울 것이 없다') AS `v22 표 정리`;

-- 11) 구조 번호 올리기: 21 일 때만 22 로. 이미 22 이상이면 0행이다.
--    db_updating 은 그대로 1 이다. 앱은 release SQL 의 마지막 열기까지 계속 기다린다.
UPDATE cal_schema_meta SET v = '22', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_structure_version' AND v = '21';

-- 12) 끝 확인: 구조 번호 22 이상
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @g := IF(@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 22, 'DO 0',
             'SELECT 1 FROM `중단: v22 조각 끝 확인 실패 - 구조 번호가 22 이상이 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
