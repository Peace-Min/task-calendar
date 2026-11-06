-- v22-precheck.sql: 0.26.0 배포 전 사전 조회(폐쇄망, MySQL Workbench, 배포하는 관리자 계정)
-- docs/DB-V22-REPORT-HOURS.md "배포와 운영", docs/RELEASE-0.26.0-QA.md 항목 A.
--
-- 읽기만 한다(SELECT 와 SHOW 뿐. tests/db-checks-readonly.test.mjs 가 강제한다). DB 를 바꾸지 않는다.
-- 언제: release-v0.26.0.sql 을 돌리기 전에, 지금 구조 20(0.25.1) 인 taskcalendar 를 기본 스키마로 두고 전체 실행(Ctrl+Shift+Enter).
--       구조 22 로 오른 뒤에는 cal_report_hours.cat_no 가 없어 4) 에서 멈춘다(배포 뒤에는 v22-postcheck.sql).
-- 결과 탭마다 '기대' 칸과 견준다. 기대와 다르면 배포를 멈추고 결과 표를 개발자에게 넘긴다.
--
-- 이 결과가 말해 주는 것
--   1)  구조 번호 20 이고 열림(db_updating 0) 이어야 release SQL 이 v21, v22 를 차례로 돈다.
--   2)  지워질 데이터의 양: cal_task_hours, cal_migration_log, cal_user_pref 는 표째, cal_report_hours 는 줄 전부가 지워진다.
--       지운 뒤에는 배포 전 백업(Data Export)에만 남는다.
--   3)  4)  5)  표 DROP 이 막히지 않는지(다른 표의 FK, 뷰, 트리거가 지울 표를 가리키면 멈춘다).
--   6)  주간 줄 과제 id 채우기에서 빠질 줄 수(같은 이름 개인 과제가 없거나 둘 이상).
--   7)  계정 권한(ALTER, DROP, CREATE, INDEX 가 있어야 release SQL 이 돈다).

-- 1) 지금 구조와 접속(기대: db_structure_version 20, db_updating 0, 기본 스키마 taskcalendar)
SELECT DATABASE() AS `기본 스키마`, CURRENT_USER() AS `접속 계정`, VERSION() AS `MySQL`, @@SESSION.sql_safe_updates AS `안전 갱신 모드`;
SELECT k, v, updated_at FROM cal_schema_meta ORDER BY k;
SELECT (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version') AS `구조 번호`,
       (SELECT v FROM cal_schema_meta WHERE k = 'db_updating') AS `db_updating`,
       IF((SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version') = '20'
          AND (SELECT v FROM cal_schema_meta WHERE k = 'db_updating') = '0', 'OK', '다름(20 과 0 이어야 한다)') AS `판정`;

-- 2) 지워질 데이터와 바뀌는 표의 행 수(기대: 숫자를 기록해 둔다. 배포 뒤 postcheck 의 같은 칸과 견준다)
SELECT (SELECT COUNT(*) FROM cal_task_hours) AS `cal_task_hours(표 삭제)`,
       (SELECT COUNT(*) FROM cal_migration_log) AS `cal_migration_log(표 삭제)`,
       (SELECT COUNT(*) FROM cal_user_pref) AS `cal_user_pref(표 삭제)`,
       (SELECT COUNT(*) FROM cal_report_hours) AS `cal_report_hours(줄 전부 삭제)`,
       (SELECT COUNT(*) FROM cal_report_daily) AS `cal_report_daily(그대로, memo NULL)`,
       (SELECT COUNT(*) FROM cal_report_weekly) AS `cal_report_weekly(그대로)`,
       (SELECT COUNT(*) FROM cal_report_weekly_hours) AS `cal_report_weekly_hours(그대로, cat_uid 채움)`;

-- 3) cal_report_hours.cat_no 가 찬 줄(기대: 0. 아니어도 v22 첫 단계에서 지워진다. 0 이 아니면 그 수만 기록)
SELECT COUNT(*) AS `cat_no 찬 줄`, IF(COUNT(*) = 0, 'OK', '기록(지워진다)') AS `판정` FROM cal_report_hours WHERE cat_no IS NOT NULL;

-- 4) 지울 표 셋을 가리키는 FK(기대: 0행. 있으면 DROP TABLE 이 3730 으로 멈춘다)
SELECT CONSTRAINT_NAME, TABLE_NAME AS `가리키는 표`, REFERENCED_TABLE_NAME AS `지울 표`
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IN ('cal_task_hours', 'cal_migration_log', 'cal_user_pref');
--    cal_report_hours 의 FK(기대: 정확히 둘. fk_crh_daily 와 fk_crh_cat. fk_crh_cat 은 v22 가 지운다)
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' ORDER BY CONSTRAINT_NAME;
--    cal_report_hours 를 가리키는 다른 표의 FK(기대: 0행)
SELECT CONSTRAINT_NAME, TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'cal_report_hours';

-- 5) 지울 표 셋을 쓰는 뷰와 트리거(기대: 0행 둘)
SELECT TABLE_NAME AS `뷰` FROM information_schema.VIEWS
 WHERE TABLE_SCHEMA = DATABASE() AND (VIEW_DEFINITION LIKE '%cal_task_hours%' OR VIEW_DEFINITION LIKE '%cal_migration_log%' OR VIEW_DEFINITION LIKE '%cal_user_pref%');
SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS
 WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE IN ('cal_task_hours', 'cal_migration_log', 'cal_user_pref', 'cal_report_hours', 'cal_report_daily', 'cal_report_weekly_hours');

--    v21, v22 가 만들 것이 아직 없는지(기대: 0, 0. 0 이 아니면 앞선 실행이 반쯤 돌았다. 그래도 release SQL 이 이어서 끝낸다)
SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_project_watch') AS `cal_project_watch 있음`,
       (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
           AND ((TABLE_NAME = 'cal_report_hours' AND COLUMN_NAME IN ('cat_uid', 'project_uid', 'body'))
             OR (TABLE_NAME = 'cal_report_daily' AND COLUMN_NAME = 'memo')
             OR (TABLE_NAME = 'cal_report_weekly_hours' AND COLUMN_NAME = 'cat_uid'))) AS `v22 새 칸 수`;

-- 6) 주간 줄 과제 id 채우기 미리 보기(v22 조각과 같은 비교: 그 사람의 개인 과제 이름과 글자까지 같은지, utf8mb4_bin 에 글자 수까지)
--    공식 과제 줄(project_uid 있음)은 모두 db-<project_uid> 로 채워진다.
--    project_uid 가 빈 줄은 같은 이름 개인 과제가 하나뿐일 때만 채워지고, 0 이나 2 이상이면 빈 채로 남는다(그 줄은 공식 과제 이관 대상이 아니다).
--    기대: 숫자를 기록해 둔다. 배포 뒤 postcheck 의 '공식 과제 id', '개인 과제 id', '빈 줄' 과 같아야 한다.
SELECT SUM(m.project_uid IS NOT NULL) AS `공식 과제 줄(채움)`,
       SUM(m.project_uid IS NULL AND m.same_name = 1) AS `같은 이름 하나(채움)`,
       SUM(m.project_uid IS NULL AND m.same_name = 0) AS `같은 이름 없음(빈 채로)`,
       SUM(m.project_uid IS NULL AND m.same_name >= 2) AS `같은 이름 둘 이상(빈 채로)`,
       COUNT(*) AS `주간 줄 전체`
  FROM (SELECT h.project_uid,
               (SELECT COUNT(*) FROM cal_category c
                 WHERE c.user_id = h.user_id AND c.source = 'local'
                   AND c.name COLLATE utf8mb4_bin = h.task_name COLLATE utf8mb4_bin
                   AND CHAR_LENGTH(c.name) = CHAR_LENGTH(h.task_name)) AS same_name
          FROM cal_report_weekly_hours h) m;
--    같은 이름 개인 과제가 둘 이상인 줄(빈 채로 남는 줄의 자세한 목록. 0행이면 좋다)
SELECT h.user_id, u.login_id, h.period_start, h.line_no, h.task_name,
       (SELECT COUNT(*) FROM cal_category c WHERE c.user_id = h.user_id AND c.source = 'local'
           AND c.name COLLATE utf8mb4_bin = h.task_name COLLATE utf8mb4_bin
                   AND CHAR_LENGTH(c.name) = CHAR_LENGTH(h.task_name)) AS `같은 이름 개인 과제 수`
  FROM cal_report_weekly_hours h JOIN app_user u ON u.user_id = h.user_id
 WHERE h.project_uid IS NULL
   AND (SELECT COUNT(*) FROM cal_category c WHERE c.user_id = h.user_id AND c.source = 'local'
           AND c.name COLLATE utf8mb4_bin = h.task_name COLLATE utf8mb4_bin
                   AND CHAR_LENGTH(c.name) = CHAR_LENGTH(h.task_name)) >= 2
 ORDER BY h.user_id, h.period_start, h.line_no;

-- 7) 권한(기대: taskcalendar.* 에 ALL PRIVILEGES, 또는 적어도 SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES)
--    첫 줄은 지금 접속한 계정. 둘째 줄은 앱 계정(db/deploy/server-app-account.sql 의 'taskmgr_app'@'%').
--    접속 계정이 taskmgr_app 이 아니고 mysql 스키마 읽기 권한이 없으면 둘째 줄이 1044 로 멈춘다. 그때는 첫 줄 결과만 넘긴다(맨 끝이라 앞 결과는 그대로다).
SHOW GRANTS FOR CURRENT_USER();
SHOW GRANTS FOR 'taskmgr_app'@'%';
