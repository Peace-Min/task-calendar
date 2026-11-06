-- v22-postcheck.sql: 0.26.0 배포 뒤 사후 확인(폐쇄망, MySQL Workbench, 배포하는 관리자 계정)
-- docs/DB-V22-REPORT-HOURS.md "배포와 운영", docs/RELEASE-0.26.0-QA.md 항목 A.
--
-- 읽기만 한다(SELECT 와 SHOW 뿐. tests/db-checks-readonly.test.mjs 가 강제한다). DB 를 바꾸지 않는다.
-- 언제: release-v0.26.0.sql 이 끝난 직후, taskcalendar 를 기본 스키마로 두고 전체 실행(Ctrl+Shift+Enter).
-- '판정' 칸이 모두 OK 여야 한다. '다름' 이 있으면 결과 표를 개발자에게 넘긴다.

-- 1) 구조 번호와 열림(기대: 22, 0, 앱 버전 0.26.0)
SELECT (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version') AS `구조 번호`,
       (SELECT v FROM cal_schema_meta WHERE k = 'db_updating') AS `db_updating`,
       (SELECT v FROM cal_schema_meta WHERE k = 'app_latest_version') AS `app_latest_version`,
       (SELECT COUNT(*) FROM cal_schema_meta) AS `메타 키 수`,
       IF((SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version') = '22'
          AND (SELECT v FROM cal_schema_meta WHERE k = 'db_updating') = '0'
          AND (SELECT COUNT(*) FROM cal_schema_meta) = 5, 'OK', '다름') AS `판정`;

-- 2) 칸(기대: 일간 줄 8칸 순서, 주간 줄 7칸 순서, 일간보고 memo 가 content 바로 뒤)
SELECT 'cal_report_hours' AS `표`,
       (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours') AS `칸`,
       IF((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours') = 'user_id,work_date,line_no,task_name,cat_uid,project_uid,hours,body', 'OK', '다름') AS `판정`
UNION ALL
SELECT 'cal_report_weekly_hours',
       (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly_hours'),
       IF((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly_hours') = 'user_id,period_start,line_no,task_name,cat_uid,project_uid,hours', 'OK', '다름')
UNION ALL
SELECT 'cal_report_daily',
       (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_daily'),
       IF((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ',') FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_daily') LIKE '%,content,memo,%', 'OK', '다름');
--    새 칸의 형과 콜레이션(기대: 다섯 줄 모두 OK)
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, IFNULL(COLLATION_NAME, '-') AS COLLATION_NAME,
       IF(IS_NULLABLE = 'YES' AND ((COLUMN_NAME = 'cat_uid' AND COLUMN_TYPE = 'varchar(80)' AND COLLATION_NAME = 'utf8mb4_bin')
          OR (COLUMN_NAME = 'project_uid' AND COLUMN_TYPE = 'char(36)' AND COLLATION_NAME = 'utf8mb4_0900_ai_ci')
          OR (COLUMN_NAME IN ('body', 'memo') AND COLUMN_TYPE = 'mediumtext')), 'OK', '다름') AS `판정`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME = 'cal_report_hours' AND COLUMN_NAME IN ('cat_uid', 'project_uid', 'body'))
     OR (TABLE_NAME = 'cal_report_daily' AND COLUMN_NAME = 'memo')
     OR (TABLE_NAME = 'cal_report_weekly_hours' AND COLUMN_NAME = 'cat_uid'))
 ORDER BY TABLE_NAME, COLUMN_NAME;

-- 3) 색인, FK, CHECK(기대: 판정 모두 OK)
SELECT (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME = 'ix_crh_project') AS `ix_crh_project`,
       (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME = 'ix_crh_cat') AS `ix_crh_cat`,
       (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly_hours' AND INDEX_NAME = 'ix_crwh_cat') AS `ix_crwh_cat`,
       (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME IN ('idx_crh_cat', 'fk_crh_cat')) AS `옛 색인 남음`,
       (SELECT GROUP_CONCAT(CONSTRAINT_NAME ORDER BY CONSTRAINT_NAME SEPARATOR ',') FROM information_schema.REFERENTIAL_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours') AS `일간 줄 FK`,
       (SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_crh_hours') AS `chk_crh_hours`,
       IF((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME = 'ix_crh_project') = 'project_uid,work_date'
          AND (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME = 'ix_crh_cat') = 'user_id,cat_uid'
          AND (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly_hours' AND INDEX_NAME = 'ix_crwh_cat') = 'user_id,cat_uid'
          AND (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND INDEX_NAME IN ('idx_crh_cat', 'fk_crh_cat')) = 0
          AND (SELECT GROUP_CONCAT(CONSTRAINT_NAME ORDER BY CONSTRAINT_NAME SEPARATOR ',') FROM information_schema.REFERENTIAL_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours') = 'fk_crh_daily'
          AND (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
            WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_crh_hours' AND CHECK_CLAUSE LIKE '%>= 0%' AND CHECK_CLAUSE LIKE '%<= 24%') = 1,
          'OK', '다름') AS `판정`;

-- 4) 표(기대: 지운 표 셋 0, cal_project_watch 1, 캘린더 표 cal_ 로 시작하는 것 18 에서 v21 +1, v22 -3 = 16)
SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN ('cal_task_hours', 'cal_migration_log', 'cal_user_pref')) AS `지운 표 남음`,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_project_watch') AS `cal_project_watch`,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE 'cal\_%') AS `cal_ 표 수`,
       IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME IN ('cal_task_hours', 'cal_migration_log', 'cal_user_pref')) = 0
          AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_project_watch') = 1, 'OK', '다름') AS `판정`;

-- 5) 데이터(기대: 일간 옛 줄 0(배포 직후. 사용자가 일간보고를 보내면 늘어난다), 일간보고 memo NULL 은 precheck 의 cal_report_daily 수,
--    주간 줄 수는 precheck 와 같고, 공식 과제 id, 개인 과제 id, 빈 줄은 precheck 6) 의 공식, 하나, 없음 + 둘 이상과 같다)
SELECT (SELECT COUNT(*) FROM cal_report_hours) AS `cal_report_hours`,
       (SELECT COUNT(*) FROM cal_report_daily) AS `cal_report_daily`,
       (SELECT COUNT(*) FROM cal_report_daily WHERE memo IS NULL) AS `memo NULL(옛 보고)`,
       (SELECT COUNT(*) FROM cal_report_weekly) AS `cal_report_weekly`,
       (SELECT COUNT(*) FROM cal_report_weekly_hours) AS `주간 줄 전체`,
       (SELECT COUNT(*) FROM cal_report_weekly_hours WHERE cat_uid LIKE 'db-%') AS `공식 과제 id`,
       (SELECT COUNT(*) FROM cal_report_weekly_hours WHERE cat_uid IS NOT NULL AND cat_uid NOT LIKE 'db-%') AS `개인 과제 id`,
       (SELECT COUNT(*) FROM cal_report_weekly_hours WHERE cat_uid IS NULL) AS `빈 줄`,
       (SELECT COUNT(*) FROM cal_report_weekly_hours WHERE project_uid IS NOT NULL AND NOT (cat_uid <=> CONCAT('db-', project_uid))) AS `공식 줄인데 id 가 다름`,
       IF((SELECT COUNT(*) FROM cal_report_weekly_hours WHERE project_uid IS NOT NULL AND NOT (cat_uid <=> CONCAT('db-', project_uid))) = 0, 'OK', '다름') AS `판정`;
