-- @migration from=16 to=17
-- =====================================================================
--  v17-monthly-report.sql: 이관 조각, DB 구조 번호 16 에서 17 로
--  월간보고(docs/MONTHLY-REPORT-PLAN.md §6). 과제 개발 시작일 칸과 과제별 개발 일정 그림 표를 더한다.
-- =====================================================================
--
--  이 파일은 혼자 실행하지 않는다.
--    installer/publish-update.ps1(installer/release-sql.ps1)이 이 폴더의 조각을 구조 번호 순서로 이어 붙여
--    dist/installer/release-v<버전>.sql 하나를 만든다. 운영자는 그 파일만 받아 Workbench 에서 한 번 실행한다.
--    release SQL 이 확인과 닫기(db_updating = 1)를 한 뒤 조각을 돌리고, 끝에서 한 트랜잭션으로 연다.
--    조각은 닫지도 열지도 않는다(DB-RELEASE-OPS §5). 닫히지 않은 DB 에서 이 조각만 돌리면 첫 확인에서 멈춘다.
--
--  바꾸는 것:
--    1) project.dev_start_date DATE NULL 을 end_date 뒤(dev_end_date 앞)에 더한다. 정본 schema-structure.sql 과 같은 자리, 같은 형.
--       ALGORITHM=INSTANT 라 즉시 변경이 안 되는 서버면 표를 복사하지 않고 실패한다(DB-RELEASE-OPS §5.1).
--       값은 모두 NULL 로 시작한다(개발 시작, 종료 값 채우기는 사용자가 따로 한다. 이 조각은 칸만 만든다).
--    2) project 에 CHECK chk_project_dev_dates(둘 다 있을 때 시작 <= 종료)를 건다. 새 칸이 모두 NULL 이라 기존 행은 통과한다.
--    3) 새 표 project_schedule_image 를 만든다. 정의는 정본 db/deploy/schema-calendar.sql 의 16 과 글자까지 같다
--       (작은따옴표만 두 겹. 시험이 대조한다). project(id) 를 CASCADE, 주인 app_user(user_id) 를 RESTRICT 로 가리킨다.
--       그림은 사람마다 따로다(2026-10-23 결정): UNIQUE (user_id, project_id, seq), 앱은 주인의 그림만 읽고 쓴다.
--    4) 검증: 새 칸이 있고 DATE, NULL 허용이며 end_date 바로 뒤에 있다. CHECK 가 있다. 새 표의 열 수와 FK 수가 기대와 같다(information_schema).
--    5) 구조 번호 17.
--
--  권한: 이 조각은 GRANT 를 하지 않는다(배포 SQL 은 권한을 줄 수 없다). 폐쇄망 서버 앱 계정은 그 DB 전체 권한이라
--    새 표를 바로 쓴다. 표마다 권한을 주는 환경(개발 PC 의 최소 권한 앱 계정)은 정본 권한 파일
--    (grants-calendar.sql)대로 root 로 따로 준다(안 주면 1142).
--
--  다시 돌리기: 안전하다.
--    - 구조 번호가 이미 17 이상이면 아무것도 하지 않는다(건너뛴 배포를 몰아서 올릴 때, 끝난 뒤 다시 돌릴 때).
--    - 앞선 실행이 중간에 멈췄으면 이어서 끝낸다. 칸과 CHECK 는 information_schema 로 있는지 보고 없을 때만 더하고,
--      표 만들기는 IF NOT EXISTS 다.
--    - 16 도 17 이상도 아니면 멈춘다(앞 판이 빠졌거나 손댄 값).
--
--  멈추는 방법: 저장 프로그램을 쓰지 않는다. 조건으로 실행할 문장을 고르고(PREPARE/EXECUTE),
--    조건이 틀리면 없는 표 이름을 SELECT 해 ERROR 1146 을 낸다. 그 표 이름이 멈춘 이유다.
--
--  앱 쪽 짝: DbGate.AppStructureVersion 17, 정본 schema-calendar.sql 의 16 과 시딩 17, schema-structure.sql 의 project
--    (tests/schedule-image.test.mjs, tests/schema-guards.test.mjs, tests/release-sql.test.mjs).
--  조각 규칙(DB-RELEASE-OPS §5.2): 변수는 @go, @skip, @g, @s 와 @m_ 만 쓴다(@r_ 는 감싸개 몫).
--    잠금 대기 상한(lock_wait_timeout)은 release SQL 맨 위에서 한 번 건다. 조각은 걸지 않는다.
-- =====================================================================

-- 1) 확인: 16 이면 올리고, 17 이상이면 건너뛴다. 올릴 때는 닫힌 상태(db_updating = 1)여야 한다
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @m_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @go := (@m_cur <=> '16');
SET @skip := (@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 17);
SET @g := IF(@go OR @skip, 'DO 0',
             'SELECT 1 FROM `중단: v17 조각 - 구조 번호가 16 도 17 이상도 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(NOT @go OR @m_upd <=> '1', 'DO 0',
             'SELECT 1 FROM `중단: v17 조각 - 닫히지 않았다 - release SQL 로만 돌린다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '16 에서 17 로 올린다(월간보고)', '이미 17 이상이다. 건너뛴다') AS `v17 조각`;

-- 2) project.dev_start_date: 없을 때만 더한다(MySQL 에는 ADD COLUMN IF NOT EXISTS 가 없다)
--    구조 변경 문장이라 트랜잭션으로 묶지 않는다(자동 확정된다). 중간에 멈추면 다시 돌릴 때 여기서 건너뛴다.
SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'dev_start_date');
SET @s := IF(@go AND @m_col = 0,
  'ALTER TABLE project ADD COLUMN dev_start_date DATE NULL AFTER end_date, ALGORITHM=INSTANT',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 3) CHECK chk_project_dev_dates: 없을 때만 건다(정본 schema-structure.sql 의 project 와 같은 식)
SET @m_chk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'project'
                  AND CONSTRAINT_NAME = 'chk_project_dev_dates' AND CONSTRAINT_TYPE = 'CHECK');
SET @s := IF(@go AND @m_chk = 0,
  'ALTER TABLE project ADD CONSTRAINT chk_project_dev_dates CHECK (dev_start_date IS NULL OR dev_end_date IS NULL OR dev_start_date <= dev_end_date)',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 4) 새 표 project_schedule_image(정본 schema-calendar.sql 16 과 글자까지 같은 정의)
SET @s := IF(@go,
  'CREATE TABLE IF NOT EXISTS project_schedule_image (
  id           INT UNSIGNED      NOT NULL AUTO_INCREMENT                                    COMMENT ''그림 번호'',
  user_id      SMALLINT UNSIGNED NOT NULL                                                   COMMENT ''그림 주인(app_user.user_id). 이 사람만 보고 고치며 이 사람 문서에만 들어간다'',
  project_id   INT UNSIGNED      NOT NULL                                                   COMMENT ''과제 번호(project.id)'',
  seq          TINYINT UNSIGNED  NOT NULL                                                   COMMENT ''주인의 그 과제 안 순서(1부터)'',
  mime         VARCHAR(20)       CHARACTER SET ascii COLLATE ascii_bin NOT NULL             COMMENT ''image/png 또는 image/jpeg'',
  bytes        MEDIUMBLOB        NOT NULL                                                   COMMENT ''그림 원본(앱 상한 5MB)'',
  width_px     SMALLINT UNSIGNED NOT NULL                                                   COMMENT ''가로 화소'',
  height_px    SMALLINT UNSIGNED NOT NULL                                                   COMMENT ''세로 화소'',
  sha256       CHAR(64)          CHARACTER SET ascii COLLATE ascii_bin NOT NULL             COMMENT ''바이트의 SHA-256(소문자 16진수). PC 사본 확인용'',
  uploaded_at  DATETIME(3)       NOT NULL                                                   COMMENT ''등록 시각(UTC)'',
  PRIMARY KEY (id),
  UNIQUE KEY uq_project_schedule_image_seq (user_id, project_id, seq),
  KEY ix_project_schedule_image_project (project_id),
  CONSTRAINT fk_project_schedule_image_user FOREIGN KEY (user_id) REFERENCES app_user(user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_project_schedule_image_project FOREIGN KEY (project_id) REFERENCES project(id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT chk_project_schedule_image_mime CHECK (mime IN (''image/png'',''image/jpeg'')),
  CONSTRAINT chk_project_schedule_image_seq  CHECK (seq >= 1),
  CONSTRAINT chk_project_schedule_image_size CHECK (width_px >= 1 AND height_px >= 1),
  CONSTRAINT chk_project_schedule_image_sha  CHECK (sha256 REGEXP ''^[0-9a-f]{64}$'')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT=''사람별 과제 개발 일정 그림(월간보고). 주인만 보고 고친다. 과제 삭제 때 함께 지워진다. 주인은 RESTRICT. 앱이 사람마다 과제당 5장, 장당 5MB 로 막는다.''',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 5) 검증: 칸(형, NULL 허용, 자리), CHECK, 새 표의 열 수와 FK 수. 틀리면 db_updating = 1 인 채로 멈춘다(앱은 계속 기다린다).
--    information_schema 로 다시 보는 이유: 이름이 같은 다른 모양의 칸이나 표가 이미 있으면 위 단계가 건너뛰기 때문이다.
SET @m_cty := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'dev_start_date'
                  AND DATA_TYPE = 'date' AND IS_NULLABLE = 'YES');
SET @m_pos := (SELECT COUNT(*) FROM information_schema.COLUMNS a JOIN information_schema.COLUMNS b
                  ON b.TABLE_SCHEMA = a.TABLE_SCHEMA AND b.TABLE_NAME = a.TABLE_NAME AND b.ORDINAL_POSITION = a.ORDINAL_POSITION + 1
                WHERE a.TABLE_SCHEMA = DATABASE() AND a.TABLE_NAME = 'project' AND a.COLUMN_NAME = 'end_date' AND b.COLUMN_NAME = 'dev_start_date');
SET @m_chk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'project'
                  AND CONSTRAINT_NAME = 'chk_project_dev_dates' AND CONSTRAINT_TYPE = 'CHECK');
SET @m_c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_schedule_image');
SET @m_f1 := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'project_schedule_image');
SET @g := IF(NOT @go OR (@m_cty = 1 AND @m_pos = 1 AND @m_chk = 1 AND @m_c1 = 10 AND @m_f1 = 2), 'DO 0',
             'SELECT 1 FROM `중단: v17 조각 검증 실패 - 새 칸, CHECK, 새 표 모양이 다르다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '개발 시작일 칸과 개발 일정 그림 표를 만들었다', '만들 것이 없다') AS `v17 월간보고`;

-- 6) 구조 번호 올리기: 16 일 때만 17 로. 이미 17 이상이면 0행이다.
--    db_updating 은 그대로 1 이다. 앱은 release SQL 의 마지막 열기까지 계속 기다린다.
UPDATE cal_schema_meta SET v = '17', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_structure_version' AND v = '16';

-- 7) 끝 확인: 구조 번호 17 이상
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @g := IF(@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 17, 'DO 0',
             'SELECT 1 FROM `중단: v17 조각 끝 확인 실패 - 구조 번호가 17 이상이 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
