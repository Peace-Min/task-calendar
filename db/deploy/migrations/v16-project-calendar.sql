-- @migration from=15 to=16
-- =====================================================================
--  v16-project-calendar.sql: 이관 조각, DB 구조 번호 15 에서 16 으로
--  과제 캘린더(docs/PROJECT-CALENDAR-PLAN.md §4). 공식 과제마다 공용 캘린더를 두는 새 표 둘을 만든다.
-- =====================================================================
--
--  이 파일은 혼자 실행하지 않는다.
--    installer/publish-update.ps1(installer/release-sql.ps1)이 이 폴더의 조각을 구조 번호 순서로 이어 붙여
--    dist/installer/release-v<버전>.sql 하나를 만든다. 운영자는 그 파일만 받아 Workbench 에서 한 번 실행한다.
--    release SQL 이 확인과 닫기(db_updating = 1)를 한 뒤 조각을 돌리고, 끝에서 한 트랜잭션으로 연다.
--    조각은 닫지도 열지도 않는다(DB-RELEASE-OPS §5). 닫히지 않은 DB 에서 이 조각만 돌리면 첫 확인에서 멈춘다.
--
--  바꾸는 것:
--    1) 새 표 둘을 FK 순서로 만든다: cal_project_event, cal_project_change.
--       정의는 정본 db/deploy/schema-calendar.sql 의 14~15 와 글자까지 같다(작은따옴표만 두 겹. 시험이 대조한다).
--       기존 표는 건드리지 않는다. 옮길 데이터가 없다.
--    2) 검증: 두 표가 있고 표마다 열 수와 FK 수가 기대와 같다(information_schema).
--    3) 구조 번호 16.
--
--  권한: 이 조각은 GRANT 를 하지 않는다(배포 SQL 은 권한을 줄 수 없다). 폐쇄망 서버 앱 계정은 그 DB 전체 권한이라
--    새 표를 바로 쓴다. 표마다 권한을 주는 환경(개발 PC 의 최소 권한 앱 계정)은 정본 권한 파일
--    (grants-calendar.sql, create-app-user.sql)대로 root 로 따로 준다(안 주면 1142).
--
--  다시 돌리기: 안전하다.
--    - 구조 번호가 이미 16 이상이면 아무것도 하지 않는다(건너뛴 배포를 몰아서 올릴 때, 끝난 뒤 다시 돌릴 때).
--    - 앞선 실행이 중간에 멈췄으면 이어서 끝낸다. 표 만들기는 모두 IF NOT EXISTS 다.
--    - 15 도 16 이상도 아니면 멈춘다(앞 판이 빠졌거나 손댄 값).
--
--  멈추는 방법: 저장 프로그램을 쓰지 않는다. 조건으로 실행할 문장을 고르고(PREPARE/EXECUTE),
--    조건이 틀리면 없는 표 이름을 SELECT 해 ERROR 1146 을 낸다. 그 표 이름이 멈춘 이유다.
--
--  앱 쪽 짝: DbGate.AppStructureVersion 16, 정본 schema-calendar.sql 의 14~15 와 시딩 16
--    (tests/project-calendar-host.test.mjs, tests/schema-guards.test.mjs, tests/release-sql.test.mjs).
--  조각 규칙(DB-RELEASE-OPS §5.2): 변수는 @go, @skip, @g, @s 와 @m_ 만 쓴다(@r_ 는 감싸개 몫).
--    잠금 대기 상한(lock_wait_timeout)은 release SQL 맨 위에서 한 번 건다. 조각은 걸지 않는다.
-- =====================================================================

-- 1) 확인: 15 이면 올리고, 16 이상이면 건너뛴다. 올릴 때는 닫힌 상태(db_updating = 1)여야 한다
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @m_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @go := (@m_cur <=> '15');
SET @skip := (@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 16);
SET @g := IF(@go OR @skip, 'DO 0',
             'SELECT 1 FROM `중단: v16 조각 - 구조 번호가 15 도 16 이상도 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(NOT @go OR @m_upd <=> '1', 'DO 0',
             'SELECT 1 FROM `중단: v16 조각 - 닫히지 않았다 - release SQL 로만 돌린다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '15 에서 16 으로 올린다(과제 캘린더)', '이미 16 이상이다. 건너뛴다') AS `v16 조각`;

-- 2) 새 표 둘 만들기(정본 schema-calendar.sql 14~15 와 글자까지 같은 정의). FK 순서: event, change.
--    구조 변경 문장이라 트랜잭션으로 묶지 않는다(자동 확정된다). 중간에 멈추면 다시 돌릴 때 IF NOT EXISTS 로 이어 간다.
-- 2-1) cal_project_event: 과제 일정
SET @s := IF(@go,
  'CREATE TABLE IF NOT EXISTS cal_project_event (
  event_id         INT UNSIGNED    NOT NULL AUTO_INCREMENT                                      COMMENT ''내부 번호. 이력이 가리킨다'',
  uid              CHAR(36)        CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL           COMMENT ''클라이언트가 만든 안정 id. 생성 재시도의 멱등 키'',
  project_id       INT UNSIGNED    NOT NULL                                                     COMMENT ''과제 번호(project.id)'',
  title            VARCHAR(200)    NOT NULL                                                     COMMENT ''제목(앱 상한 200자)'',
  start_date       DATE            NOT NULL                                                     COMMENT ''시작일'',
  end_date         DATE            NULL DEFAULT NULL                                            COMMENT ''종료일(포함). 하루 일정은 NULL'',
  start_time       TIME            NULL DEFAULT NULL                                            COMMENT ''시작 시각. 날짜만 있는 일정은 NULL'',
  end_time         TIME            NULL DEFAULT NULL                                            COMMENT ''종료 시각. 날짜만 있는 일정은 NULL'',
  location         VARCHAR(200)    NOT NULL DEFAULT ''''                                          COMMENT ''장소(앱 상한 200자)'',
  memo             TEXT            NOT NULL                                                     COMMENT ''메모(앱 상한 8,000자)'',
  row_version      BIGINT UNSIGNED NOT NULL DEFAULT 1                                           COMMENT ''낙관적 잠금 판. 저장과 삭제마다 1씩 오른다'',
  is_deleted       TINYINT(1)      NOT NULL DEFAULT 0                                           COMMENT ''소프트 삭제. 행을 지우지 않는다'',
  created_by_name  VARCHAR(200)    NOT NULL                                                     COMMENT ''글쓴이 이름(사용자 FK 없음)'',
  updated_by_name  VARCHAR(200)    NOT NULL                                                     COMMENT ''마지막 수정자 이름'',
  created_at       DATETIME(3)     NOT NULL                                                     COMMENT ''만든 시각(UTC)'',
  updated_at       DATETIME(3)     NOT NULL                                                     COMMENT ''마지막 수정 시각(UTC)'',
  deleted_at       DATETIME(3)     NULL DEFAULT NULL                                            COMMENT ''삭제 시각(UTC)'',
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_cal_project_event_uid (uid),
  KEY ix_cal_project_event_range (project_id, is_deleted, start_date, end_date),
  KEY ix_cal_project_event_updated (project_id, updated_at, event_id),
  CONSTRAINT fk_cal_project_event_project FOREIGN KEY (project_id) REFERENCES project(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_cal_project_event_uid     CHECK (uid <> ''''),
  CONSTRAINT chk_cal_project_event_title   CHECK (title <> ''''),
  CONSTRAINT chk_cal_project_event_enddate CHECK (end_date IS NULL OR end_date > start_date),
  CONSTRAINT chk_cal_project_event_time    CHECK ((start_time IS NULL AND end_time IS NULL)
                                               OR (end_date IS NULL AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)),
  CONSTRAINT chk_cal_project_event_deleted CHECK (is_deleted IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT=''과제 일정(과제 캘린더 공용 트랙). PK=event_id, 웹과의 정체성은 uid. 소프트 삭제, row_version 낙관적 잠금.''',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 2-2) cal_project_change: 변경 이력
SET @s := IF(@go,
  'CREATE TABLE IF NOT EXISTS cal_project_change (
  change_no       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                                       COMMENT ''안정 정렬과 커서'',
  project_id      INT UNSIGNED    NOT NULL                                                      COMMENT ''과제 번호(project.id)'',
  event_id        INT UNSIGNED    NOT NULL                                                      COMMENT ''과제 일정 번호(cal_project_event.event_id)'',
  mutation_uid    CHAR(36)        CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL            COMMENT ''재시도 멱등 키. 과제 안에서 UNIQUE'',
  action          VARCHAR(8)      CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL            COMMENT ''create, update, delete'',
  actor_name      VARCHAR(200)    NOT NULL                                                      COMMENT ''바꾼 사람 이름'',
  title_snapshot  VARCHAR(200)    NOT NULL                                                      COMMENT ''그때의 제목(삭제 뒤에도 보인다)'',
  before_json     JSON            NULL                                                          COMMENT ''바뀐 필드의 앞 값. create 는 NULL'',
  after_json      JSON            NULL                                                          COMMENT ''바뀐 필드의 뒤 값. delete 는 NULL'',
  changed_at      DATETIME(3)     NOT NULL                                                      COMMENT ''바꾼 시각(UTC)'',
  PRIMARY KEY (change_no),
  UNIQUE KEY uq_cal_project_change_mutation (project_id, mutation_uid),
  KEY ix_cal_project_change_project (project_id, changed_at, change_no),
  KEY ix_cal_project_change_event (event_id, changed_at, change_no),
  CONSTRAINT fk_cal_project_change_project FOREIGN KEY (project_id) REFERENCES project(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_cal_project_change_event FOREIGN KEY (event_id) REFERENCES cal_project_event(event_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_cal_project_change_mutation CHECK (mutation_uid <> ''''),
  CONSTRAINT chk_cal_project_change_action   CHECK (action IN (''create'',''update'',''delete''))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT=''과제 일정 변경 이력(지우지 않는 기록). 한 저장의 바뀐 필드만 한 행. 바뀐 것이 없으면 행이 없다.''',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 3) 검증: 두 표가 있고 표마다 열 수와 FK 수가 기대와 같다. 틀리면 db_updating = 1 인 채로 멈춘다(앱은 계속 기다린다).
--    IF NOT EXISTS 는 이름이 같은 다른 모양의 표를 그대로 두므로, 모양을 information_schema 로 다시 본다.
SET @m_c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_project_event');
SET @m_f1 := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_project_event');
SET @m_c2 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_project_change');
SET @m_f2 := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_project_change');
SET @g := IF(NOT @go OR (@m_c1 = 17 AND @m_f1 = 1
                         AND @m_c2 = 10 AND @m_f2 = 2), 'DO 0',
             'SELECT 1 FROM `중단: v16 조각 검증 실패 - 새 표의 열 수나 FK 수가 다르다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '과제 캘린더 표 둘을 만들었다', '만들 표가 없다') AS `v16 과제 캘린더`;

-- 4) 구조 번호 올리기: 15 일 때만 16 으로. 이미 16 이상이면 0행이다.
--    db_updating 은 그대로 1 이다. 앱은 release SQL 의 마지막 열기까지 계속 기다린다.
UPDATE cal_schema_meta SET v = '16', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_structure_version' AND v = '15';

-- 5) 끝 확인: 구조 번호 16 이상
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @g := IF(@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 16, 'DO 0',
             'SELECT 1 FROM `중단: v16 조각 끝 확인 실패 - 구조 번호가 16 이상이 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
