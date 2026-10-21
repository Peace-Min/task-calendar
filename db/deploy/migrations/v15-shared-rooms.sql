-- @migration from=14 to=15
-- =====================================================================
--  v15-shared-rooms.sql: 이관 조각, DB 구조 번호 14 에서 15 로
--  회의실 공용화(docs/SHARED-ROOMS.md). 사람마다 두던 회의실 목록(cal_room)을 회사 공용 목록(room_code) 하나로 바꾼다.
-- =====================================================================
--
--  이 파일은 혼자 실행하지 않는다.
--    installer/publish-update.ps1(installer/release-sql.ps1)이 이 폴더의 조각을 구조 번호 순서로 이어 붙여
--    dist/installer/release-v<버전>.sql 하나를 만든다. 운영자는 그 파일만 받아 Workbench 에서 한 번 실행한다.
--    release SQL 이 확인과 닫기(db_updating = 1)를 한 뒤 조각을 돌리고, 끝에서 한 트랜잭션으로 연다.
--    조각은 닫지도 열지도 않는다(DB-RELEASE-OPS §5). 닫히지 않은 DB 에서 이 조각만 돌리면 첫 확인에서 멈춘다.
--
--  바꾸는 것:
--    1) room_code 를 만든다(정본 schema-structure.sql 과 같은 열, 키, CHECK, 표 설명).
--    2) cal_room 에 있던 이름을 모아 넣는다. 앞뒤 공백을 지우고, 빈 이름은 버리고, 같은 이름(대소문자만 다른 것도
--       같은 이름이다. room_code.name 은 ai_ci UNIQUE)은 한 줄로 합친다. 순서는 그 이름을 등록해 둔 사람이 많은
--       것부터, 같으면 이름순이다(sort_order 10, 20, 30 …). 관리자가 관리 화면에서 정리한다.
--    3) 검증: 넣은 줄 수가 모은 고유 이름 수와 같고, 빠진 이름이 없다.
--    4) cal_room 을 지운다. 일정의 장소(cal_entry.location)는 처음부터 글자라 건드리지 않는다.
--    5) 구조 번호 15.
--
--  다시 돌리기: 안전하다.
--    - 구조 번호가 이미 15 이상이면 아무것도 하지 않는다(건너뛴 배포를 몰아서 올릴 때, 끝난 뒤 다시 돌릴 때).
--    - 앞선 실행이 중간에 멈췄으면 이어서 끝낸다. 표 만들기는 IF NOT EXISTS, 넣기는 INSERT IGNORE 이고,
--      cal_room 이 이미 지워졌으면 모으기와 검증을 건너뛴다.
--    - 14 도 15 이상도 아니면 멈춘다(앞 판이 빠졌거나 손댄 값).
--
--  멈추는 방법: 저장 프로그램을 쓰지 않는다. 조건으로 실행할 문장을 고르고(PREPARE/EXECUTE),
--    조건이 틀리면 '없는 표 이름'을 SELECT 해 ERROR 1146 을 낸다. 그 표 이름이 멈춘 이유다.
--    cal_room 이 없을 수도 있어 그 표를 읽는 문장은 모두 PREPARE 로만 돌린다.
--
--  앱 쪽 짝: DbGate.AppStructureVersion 15, 정본 schema-structure.sql 의 room_code, schema-calendar.sql 의 시딩 15
--    (tests/shared-rooms.test.mjs, tests/schema-guards.test.mjs).
-- =====================================================================
SET SESSION lock_wait_timeout = 10;

-- 1) 확인: 14 이면 올리고, 15 이상이면 건너뛴다. 올릴 때는 닫힌 상태(db_updating = 1)여야 한다
SET @v15_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @v15_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @v15_go := (@v15_cur <=> '14');
SET @v15_skip := (@v15_cur REGEXP '^[0-9]{1,6}$' AND CAST(@v15_cur AS UNSIGNED) >= 15);
SET @v15_g := IF(@v15_go OR @v15_skip, 'DO 0',
             'SELECT 1 FROM `중단: v15 조각 - 구조 번호가 14 도 15 이상도 아니다`');
PREPARE _g FROM @v15_g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @v15_g := IF(NOT @v15_go OR @v15_upd <=> '1', 'DO 0',
             'SELECT 1 FROM `중단: v15 조각 - 닫히지 않았다 - release SQL 로만 돌린다`');
PREPARE _g FROM @v15_g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@v15_go, '14 에서 15 로 올린다(회의실 공용화)', '이미 15 이상이다. 건너뛴다') AS `v15 조각`;

-- 2) room_code 만들기(정본 schema-structure.sql 과 글자까지 같은 정의)
SET @v15_s := IF(@v15_go,
  'CREATE TABLE IF NOT EXISTS room_code (
  room_id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(40)  NOT NULL,
  sort_order  INT          NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id),
  UNIQUE KEY uq_room_code_name (name),
  CONSTRAINT chk_room_code_name CHECK (name <> '''')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT=''회의실 코드. PK=room_id, name=UNIQUE 라벨. 회사 공용 장소 추천 목록. Admin 관리.''',
  'DO 0');
PREPARE _s FROM @v15_s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 3) cal_room 의 이름 모으기(cal_room 이 남아 있을 때만)
SET @v15_has := (SELECT COUNT(*) FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_room');
SET @v15_take := (@v15_go AND @v15_has = 1);
--  고유 이름 수: 앞뒤 공백을 지운 이름을 room_code 의 비교 규칙(ai_ci)으로 묶은 수.
SET @v15_dist := 0;
SET @v15_s := IF(@v15_take,
  'SELECT COUNT(*) INTO @v15_dist FROM (SELECT 1 AS one FROM cal_room WHERE TRIM(name) <> '''' GROUP BY TRIM(name) COLLATE utf8mb4_0900_ai_ci) t',
  'DO 0');
PREPARE _s FROM @v15_s; EXECUTE _s; DEALLOCATE PREPARE _s;
--  넣기: 등록한 사람이 많은 이름부터, 같으면 이름순. INSERT IGNORE 라 다시 돌려도 이미 넣은 이름은 그대로다.
SET @v15_s := IF(@v15_take,
  'INSERT IGNORE INTO room_code (name, sort_order, created_at, updated_at)
   SELECT nm, ROW_NUMBER() OVER (ORDER BY users DESC, nm) * 10, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
     FROM (SELECT MIN(TRIM(name)) COLLATE utf8mb4_0900_ai_ci AS nm, COUNT(DISTINCT user_id) AS users
             FROM cal_room WHERE TRIM(name) <> '''' GROUP BY TRIM(name) COLLATE utf8mb4_0900_ai_ci) t',
  'DO 0');
PREPARE _s FROM @v15_s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 4) 검증: 넣은 줄 수 = 고유 이름 수, 빠진 이름 0. 틀리면 db_updating = 1 인 채로 멈춘다(앱은 계속 기다린다)
SET @v15_miss := 0;
SET @v15_s := IF(@v15_take,
  'SELECT COUNT(*) INTO @v15_miss FROM (SELECT MIN(TRIM(name)) COLLATE utf8mb4_0900_ai_ci AS nm FROM cal_room WHERE TRIM(name) <> '''' GROUP BY TRIM(name) COLLATE utf8mb4_0900_ai_ci) t LEFT JOIN room_code r ON r.name = t.nm WHERE r.room_id IS NULL',
  'DO 0');
PREPARE _s FROM @v15_s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @v15_rows := -1;
SET @v15_s := IF(@v15_go, 'SELECT COUNT(*) INTO @v15_rows FROM room_code', 'DO 0');
PREPARE _s FROM @v15_s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @v15_g := IF(NOT @v15_go OR (@v15_rows >= 0 AND (NOT @v15_take OR (@v15_miss = 0 AND @v15_rows = @v15_dist))), 'DO 0',
             'SELECT 1 FROM `중단: v15 조각 검증 실패 - 회의실 이름 수가 맞지 않는다 - 갱신 중 표시인 채로 멈췄다`');
PREPARE _g FROM @v15_g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@v15_take, CONCAT('회의실 이름 ', @v15_dist, '개를 공용 목록으로 옮겼다'), '옮길 회의실 표가 없다') AS `v15 회의실`;

-- 5) cal_room 지우기(남아 있을 때만). 참조하는 표가 없다
SET @v15_s := IF(@v15_take, 'DROP TABLE cal_room', 'DO 0');
PREPARE _s FROM @v15_s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 6) 구조 번호 올리기: 14 일 때만 15 로. 이미 15 이상이면 0행이다.
--    db_updating 은 그대로 1 이다. 앱은 release SQL 의 마지막 열기까지 계속 기다린다.
UPDATE cal_schema_meta SET v = '15', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_structure_version' AND v = '14';

-- 7) 끝 확인: 구조 번호 15 이상, room_code 있음, cal_room 없음
SET @v15_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @v15_rc := (SELECT COUNT(*) FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('room_code', 'cal_room'));
SET @v15_new := (SELECT COUNT(*) FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'room_code');
SET @v15_g := IF(@v15_cur REGEXP '^[0-9]{1,6}$' AND CAST(@v15_cur AS UNSIGNED) >= 15 AND (NOT @v15_go OR (@v15_rc = 1 AND @v15_new = 1)), 'DO 0',
             'SELECT 1 FROM `중단: v15 조각 끝 확인 실패 - 구조 번호 15, room_code 만 있음이 아니다`');
PREPARE _g FROM @v15_g; EXECUTE _g; DEALLOCATE PREPARE _g;
