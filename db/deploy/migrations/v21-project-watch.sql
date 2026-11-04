-- @migration from=20 to=21
-- =====================================================================
--  v21-project-watch.sql: 이관 조각, DB 구조 번호 20 에서 21 으로
--  과제 탭 다른 과제 보기(docs/PC-WATCH.md, 2026-11-04 사용자 결정).
--  새 표 cal_project_watch(보는 사람, 보는 공식 과제, 넣은 시각)를 더한다. 내 과제(cal_category)가 아니라 읽기 전용 보기 목록이다.
-- =====================================================================
--
--  이 파일은 혼자 실행하지 않는다.
--    installer/publish-update.ps1(installer/release-sql.ps1)이 이 폴더의 조각을 구조 번호 순서로 이어 붙여
--    dist/installer/release-v<버전>.sql 하나를 만든다. 운영자는 그 파일만 받아 Workbench 에서 한 번 실행한다.
--    release SQL 이 확인과 닫기(db_updating = 1)를 한 뒤 조각을 돌리고, 끝에서 한 트랜잭션으로 연다.
--    조각은 닫지도 열지도 않는다(DB-RELEASE-OPS §5). 닫히지 않은 DB 에서 이 조각만 돌리면 첫 확인에서 멈춘다.
--
--  바꾸는 것:
--    1) 새 표 cal_project_watch 를 만든다. 없을 때만(IF NOT EXISTS).
--       정의는 정본 db/deploy/schema-calendar.sql 의 cal_project_watch 와 글자까지 같다(작은따옴표만 두 겹. 시험이 대조한다).
--       기본 키는 숫자 둘(user_id, project_id). 과제 FK 는 CASCADE(공식 과제 영구 삭제를 막지 않는다), 사람 FK 는 RESTRICT.
--       옮길 데이터는 없다(빈 표로 생긴다).
--    2) 검증(information_schema): 표가 있고 열 수(3), 기본 키 열 수(2), FK 수(2: app_user 를 RESTRICT 로, project 를 CASCADE 로)가 정본과 같다.
--    3) 구조 번호 21.
--
--  이 조각에는 DELETE 가 없고 UPDATE 는 끝의 구조 번호 갱신 하나다(키 칸 조건 WHERE, Workbench 안전 갱신 모드 1175 를 피한다).
--
--  권한: 이 조각은 권한을 주거나 거두지 않는다(배포 SQL 에서 금지, DB-RELEASE-OPS §5).
--    새 표: 폐쇄망 서버 앱 계정은 taskcalendar 전체 권한이라 바로 쓴다. 표마다 권한을 주는 환경(개발 PC 의 최소 권한 앱 계정)은
--    정본 권한 파일(grants-calendar.sql)의 cal_project_watch 줄(SELECT, INSERT, DELETE)을 root 로 따로 준다(안 주면 1142).
--
--  다시 돌리기: 안전하다.
--    - 구조 번호가 이미 21 이상이면 아무것도 하지 않는다(건너뛴 배포를 몰아서 올릴 때, 끝난 뒤 다시 돌릴 때).
--    - 앞선 실행이 중간에 멈췄으면 이어서 끝낸다(표는 IF NOT EXISTS 로 만든다).
--    - 20 도 21 이상도 아니면 멈춘다(앞 판이 빠졌거나 손댄 값).
--
--  멈추는 방법: 저장 프로그램을 쓰지 않는다. 조건으로 실행할 문장을 고르고(PREPARE/EXECUTE),
--    조건이 틀리면 없는 표 이름을 SELECT 해 ERROR 1146 을 낸다. 그 표 이름이 멈춘 이유다.
--
--  앱 쪽 짝: DbGate.AppStructureVersion 21, 정본 schema-calendar.sql 의 cal_project_watch
--    (tests/release-sql.test.mjs, tests/pc-watch.test.mjs, tests/version-gate-host.test.mjs).
--  조각 규칙(DB-RELEASE-OPS §5.2): 변수는 @go, @skip, @g, @s 와 @m_ 만 쓴다(@r_ 는 감싸개 몫).
--    잠금 대기 상한(lock_wait_timeout)은 release SQL 맨 위에서 한 번 건다. 조각은 걸지 않는다.
-- =====================================================================

-- 1) 확인: 20 이면 올리고, 21 이상이면 건너뛴다. 올릴 때는 닫힌 상태(db_updating = 1)여야 한다
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @m_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @go := (@m_cur <=> '20');
SET @skip := (@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 21);
SET @g := IF(@go OR @skip, 'DO 0',
             'SELECT 1 FROM `중단: v21 조각 - 구조 번호가 20 도 21 이상도 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(NOT @go OR @m_upd <=> '1', 'DO 0',
             'SELECT 1 FROM `중단: v21 조각 - 닫히지 않았다 - release SQL 로만 돌린다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '20 에서 21 으로 올린다(과제 탭 보기만 목록)', '이미 21 이상이다. 건너뛴다') AS `v21 조각`;

-- 2) 과제 탭 보기만 목록 표: 없을 때만 만든다(정본 schema-calendar.sql 의 cal_project_watch 와 글자까지 같은 정의).
--    구조 변경 문장이라 트랜잭션으로 묶지 않는다. 중간에 멈추면 다시 돌릴 때 IF NOT EXISTS 로 이어 간다.
--    부모 app_user, project 는 이 DB 에 이미 있다.
SET @s := IF(@go,
  'CREATE TABLE IF NOT EXISTS cal_project_watch (
  user_id     SMALLINT UNSIGNED NOT NULL COMMENT ''보는 사람(app_user.user_id)'',
  project_id  INT UNSIGNED      NOT NULL COMMENT ''보는 공식 과제(project.id)'',
  added_at    DATETIME(3)       NOT NULL COMMENT ''넣은 시각(UTC)'',
  PRIMARY KEY (user_id, project_id),
  KEY ix_cal_project_watch_project (project_id),
  CONSTRAINT fk_cal_project_watch_user    FOREIGN KEY (user_id)    REFERENCES app_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cal_project_watch_project FOREIGN KEY (project_id) REFERENCES project (id)       ON DELETE CASCADE  ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT=''과제 탭 보기만 목록. 내 과제(cal_category)가 아니다. 근태, 보고, 필터 과제 목록에 들어가지 않는다''',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 3) 검증: 표의 모양(열 수, 기본 키 열 수, FK 수와 그 대상과 규칙). 틀리면 db_updating = 1 인 채로 멈춘다(앱은 계속 기다린다).
--    IF NOT EXISTS 는 이름이 같은 다른 모양의 표를 그대로 두므로, 모양을 information_schema 로 다시 본다(v16, v20 과 같은 수법).
SET @m_wc := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_project_watch');
SET @m_wp := (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_project_watch' AND CONSTRAINT_NAME = 'PRIMARY');
SET @m_wf := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_project_watch');
SET @m_wu := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_project_watch' AND REFERENCED_TABLE_NAME = 'app_user' AND DELETE_RULE = 'RESTRICT' AND UPDATE_RULE = 'RESTRICT');
SET @m_wj := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_project_watch' AND REFERENCED_TABLE_NAME = 'project' AND DELETE_RULE = 'CASCADE' AND UPDATE_RULE = 'RESTRICT');
SET @g := IF(NOT @go OR (@m_wc = 3 AND @m_wp = 2 AND @m_wf = 2 AND @m_wu = 1 AND @m_wj = 1), 'DO 0',
             'SELECT 1 FROM `중단: v21 조각 검증 실패 - 보기만 목록 표의 모양이 다르다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '과제 탭 보기만 목록 표를 만들었다', '만들 것이 없다') AS `v21 보기만 목록`;

-- 4) 구조 번호 올리기: 20 일 때만 21 로. 이미 21 이상이면 0행이다.
--    db_updating 은 그대로 1 이다. 앱은 release SQL 의 마지막 열기까지 계속 기다린다.
UPDATE cal_schema_meta SET v = '21', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_structure_version' AND v = '20';

-- 5) 끝 확인: 구조 번호 21 이상
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @g := IF(@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 21, 'DO 0',
             'SELECT 1 FROM `중단: v21 조각 끝 확인 실패 - 구조 번호가 21 이상이 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
