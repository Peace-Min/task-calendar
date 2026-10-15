-- =====================================================================
--  migrate-2026-10-15-code-ids.sql
--  코드표 넷(customer, section_code, status_code, title_code)의 기본키를 이름에서 번호로 바꾼다.
--  자식 열은 번호 참조로 바꾼다(project.customer_id, section_id, status_id / app_user.title_id).
--  schema_version 12 → 13. 근거와 결정: docs/CODE-TABLE-IDS.md (§2 스키마, §3 고정 번호, §6 이 파일).
-- =====================================================================
--
--  【대상】
--    이미 데이터가 있는 DB(개발자 로컬 PC 의 taskcalendar, v12) 하나다. 새로 짓는 DB 는 이 파일이 아니라
--    setup-taskcalendar.ps1 이 고친 스키마 파일(schema-structure.sql, 회사 저장소 01-schema-users.sql)로 만든다.
--    title_code 와 app_user 는 회사 저장소가 만든 표지만 같은 물리 DB(taskcalendar) 안에 있으므로 여기서 함께 옮긴다.
--    두 경로의 결과(열, 인덱스, 외래키, CHECK, 표 COMMENT)는 글자까지 같아야 한다(아래 【대조】).
--
--  【적용】 순서를 지킬 것. 로컬 실 DB 에 돌리기 전에 복제한 격리 DB 에서 먼저 돌린다(§6, §12).
--    1) 위젯을 모두 닫는다(열린 트랜잭션이 있으면 첫 ALTER 가 10초 뒤 ERROR 1205 로 멈춘다. DDL 0건).
--    2) 백업. DB 이름을 꼭 적는다:
--         db\deploy\backup-taskmgr.cmd -DbName taskcalendar
--       (덤프가 완전히 끝난 것을 확인한 뒤 3) 으로 간다. 덤프와 겹치면 ALTER 가 메타데이터 락을 기다린다.)
--    3) 관리자 계정으로, 문자셋을 utf8mb4 로, --force 없이 돌린다(비밀번호는 명령줄에 쓰지 않는다):
--         mysql -u root -p --default-character-set=utf8mb4 taskcalendar < db\deploy\migrate-2026-10-15-code-ids.sql
--       ※ --force 를 붙이지 말 것. 이 파일은 조건이 어긋나면 '에러로 멈추는' 방식으로 자신을 지킨다.
--       ※ 종료코드가 0 이 아니면 어딘가에서 멈춘 것이다. 마지막 '중단: …' 줄이 이유다.
--    4) 끝나면 위젯을 v13 판(ExpectedSchemaVersion 13)으로 바꿔 띄운다. 옛 위젯(12)은 이 DB 를 거부한다.
--
--  【멈추는 방법】 MySQL 은 스토어드 프로그램 밖에서 IF 도 SIGNAL 도 못 쓴다. 그래서 조건을 계산해
--    실행할 문장 자체를 고르고(PREPARE/EXECUTE), 조건이 틀리면 '없는 표 이름'을 SELECT 해 ERROR 1146 을 낸다.
--    표 이름 자리에 사람이 읽을 문장을 넣는다(64자 이내). mysql 은 --force 가 없으면 그 자리에서 끝난다.
--    (migrate-2026-08-24-org-id.sql 이 쓰던 수법 그대로다. 그 파일은 2026-10-15 에 지웠고 git 이력에 있다.)
--
--  【단계】
--    0) 가드: 표 7개, schema_version = '12', 옛 모양(이름 키), 문자셋, 뷰와 트리거 없음, 외래키 모양, 데이터 사전 점검.
--       여기까지는 아무것도 바꾸지 않는다.
--    1) 스냅숏: 옛 값을 임시 표에 남긴다(과제 uid 별 발주처, 구분, 상태 / 사용자 user_id 별 직급) + 행 수와 지문.
--    2) 부모에 번호 열을 더하고 매긴다. 시드 이름은 고정 번호 지도로(BINARY 일치), 나머지는 MAX+1 부터 이름순.
--    3) 자식에 *_id 열을 NULL 허용으로 더하고 JOIN … ON name 으로 채운다.
--    4) ★ 절단 관문: 번호로 되살린 이름이 스냅숏과 BINARY 로 한 글자도 다르지 않고 NULL 여부도 같아야 한다.
--       하나라도 다르면 여기서 멈춘다. 멈춰도 옛 열과 옛 키는 그대로다(더한 열만 남는다).
--       이어서 동작이 묶인 고정 번호 행(구분 2 선진행, 상태 2 종료)이 있는지 본다. 옛 DB 에서 라벨을 바꿔 번호 2 가
--       비었으면 여기서 멈춘다(옛 DB 에서 라벨을 시드 이름으로 되돌린 뒤 다시 돌린다). 두 행이 숨겨져 있으면 켠다(알림).
--    5) 되돌릴 수 없는 지점: 옛 외래키, 옛 열(인덱스는 함께 사라진다)을 지우고 부모 기본키를 번호로 바꾼다.
--       UNIQUE(name), CHECK, 자식 NOT NULL, 인덱스와 외래키를 건다. AUTO_INCREMENT 는 MAX+1 과 고정 번호 바닥
--       (구분 4, 상태 5, 직급 12) 중 큰 값으로 올린다.
--    6) v13 을 기록하고 사후 검증(고아 0, 표별 행 수 불변, 이름 복원 BINARY 일치, cal_* 행 수와 cal_user_rev 불변,
--       구조, AUTO_INCREMENT > MAX 와 바닥, 보호 행이 켜져 있음). 어긋나면 실행을 실패시킨다.
--    7) 앱 계정의 안 쓰는 UPDATE 권한 회수(cal_entry_commit, cal_todo_day_note, cal_room, CODE-TABLE-IDS §8-3).
--       grants-calendar.sql 에서 뺀 권한을 이미 받은 DB 에서도 거두어, init-calendar 의 GRANT 대조와 맞춘다.
--
--  【재실행】
--    - 4) 에서 멈춘 경우: 옛 열이 그대로라 원인(데이터)을 고친 뒤 이 파일을 그대로 다시 돌리면 된다
--      (1~3 단계는 더한 열이 있으면 건너뛰고 번호를 처음부터 다시 매긴다).
--    - 5) 이후에서 멈춘 경우: 반쯤 바뀐 상태다. 0) 가드가 재실행을 막는다. 2) 의 백업으로 되돌린 뒤 다시 한다.
--    - 이미 v13 인 DB: 0) 가드에서 멈춘다(할 일 없음).
--    DDL 은 암묵 커밋이라 이 파일은 원자적이지 않다. 안전장치는 2) 의 백업과 4) 의 관문이다.
--
--  【감사 시각】 백필 UPDATE 는 updated_at = updated_at 을 함께 적어 ON UPDATE 가 갱신 시각을 덮지 않게 한다.
--
--  【대조】(§6-7, 사람이 한다) 빈 격리 DB 에 setup-taskcalendar 로 새로 만든 결과와 이 파일을 거친 DB 의
--    information_schema 가 같아야 한다. 예:
--      SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
--        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
--         AND TABLE_NAME IN ('customer','section_code','status_code','project','title_code','app_user')
--       ORDER BY TABLE_NAME, ORDINAL_POSITION;
--    (STATISTICS, REFERENTIAL_CONSTRAINTS, CHECK_CONSTRAINTS, TABLES.TABLE_COMMENT 도 같은 방식으로. AUTO_INCREMENT 값은 데이터에 따라 다르다.)
--
--  【안 하는 것】 과제 계약일 순서 CHECK(start_date <= end_date)는 넣지 않는다(§8-4 결정: 뒤집힌 행 0건, 호스트가 검사):
--      SELECT id, uid, start_date, end_date FROM project WHERE start_date > end_date;
-- =====================================================================

SET NAMES utf8mb4;
SET SESSION lock_wait_timeout = 10;
SET SESSION time_zone = '+00:00';

-- =====================================================================
--  0) 가드: 여기까지는 아무것도 바꾸지 않는다
-- =====================================================================

-- 0-a) 대상 표 7개
SET @n_tbl := (SELECT COUNT(*) FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
                  AND TABLE_NAME IN ('cal_schema_meta','customer','section_code','status_code',
                                     'project','title_code','app_user'));
SET @g := IF(@n_tbl = 7, 'DO 0',
             'SELECT 1 FROM `중단: 대상 표 7개가 다 있지 않다 - DB 이름을 확인할 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 0-b) 판번호 12 에서만 진행한다
SET @v := (SELECT v FROM cal_schema_meta WHERE k = 'schema_version');
SET @g := IF(@v = '12', 'DO 0',
             'SELECT 1 FROM `중단: schema_version 이 12 가 아니다 - 이미 적용됐거나 앞 판이 빠졌다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 0-c) 문자셋: 아래 고정 번호 지도의 한글 이름이 utf8mb4 로 들어와야 BINARY 일치가 성립한다.
--      (--default-character-set=utf8mb4 를 빼면 시드 이름이 지도에 안 맞아 조용히 MAX+1 번호를 받는다.)
SET @g := IF(HEX('선진행') = 'EC84A0ECA784ED9689', 'DO 0',
             'SELECT 1 FROM `중단: 문자셋이 utf8mb4 가 아니다 - default-character-set 을 줄 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 0-d) 옛 모양(이름 키)인가: 자식의 이름 열 4개가 있고, 부모 넷의 기본키가 name 하나다.
--      5) 이후에서 멈춘 DB 는 여기서 걸린다(반쯤 바뀐 상태라 백업으로 되돌린다).
SET @n_old := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND ((TABLE_NAME = 'project'  AND COLUMN_NAME IN ('customer','section','status'))
                    OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'title')));
SET @n_pk_all := (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
                   WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'PRIMARY'
                     AND TABLE_NAME IN ('customer','section_code','status_code','title_code'));
SET @n_pk_name := (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
                    WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'PRIMARY'
                      AND TABLE_NAME IN ('customer','section_code','status_code','title_code')
                      AND COLUMN_NAME = 'name');
SET @g := IF(@n_old = 4 AND @n_pk_all = 4 AND @n_pk_name = 4, 'DO 0',
             'SELECT 1 FROM `중단: 옛 모양(이름 키)이 아니다 - 반쯤 바뀌었다면 백업으로 되돌릴 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 0-e) 뷰와 트리거: 옛 열을 읽는 것이 있으면 열을 지운 뒤 조용히 깨진다. 있으면 사람이 먼저 본다.
SET @n_view := (SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE());
SET @n_trg  := (SELECT COUNT(*) FROM information_schema.TRIGGERS
                 WHERE TRIGGER_SCHEMA = DATABASE()
                   AND EVENT_OBJECT_TABLE IN ('customer','section_code','status_code','project','title_code','app_user'));
SET @g := IF(@n_view = 0 AND @n_trg = 0, 'DO 0',
             'SELECT 1 FROM `중단: 뷰나 트리거가 있다 - 옛 열을 읽는지 먼저 확인할 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 0-f) 외래키 모양: 네 부모를 가리키는 외래키는 정확히 아래 넷(이 있으면 그것)뿐이어야 한다.
--      다른 표가 부모의 name 을 가리키면 5) 의 기본키 교체가 ERROR 1553 으로 반쯤 멈춘다. 미리 막는다.
SET @n_ref_other := (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
                      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_SCHEMA = DATABASE()
                        AND REFERENCED_TABLE_NAME IN ('customer','section_code','status_code','title_code')
                        AND (TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME) NOT IN
                            (('project','customer','customer','name'),
                             ('project','section','section_code','name'),
                             ('project','status','status_code','name'),
                             ('app_user','title','title_code','name')));
SET @n_ref_dup := (SELECT COUNT(*) FROM (
                     SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
                      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
                        AND ((TABLE_NAME = 'project'  AND COLUMN_NAME IN ('customer','section','status'))
                          OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'title'))
                      GROUP BY TABLE_NAME, COLUMN_NAME HAVING COUNT(*) > 1) d);
-- 옛 열이 든 인덱스는 단일 열이어야 한다(열을 지울 때 함께 사라진다. 여러 열 인덱스면 조용히 좁아진다).
SET @n_idx_multi := (SELECT COUNT(*) FROM (
                       SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
                        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('project','app_user')
                        GROUP BY TABLE_NAME, INDEX_NAME
                       HAVING COUNT(*) > 1
                          AND SUM((TABLE_NAME = 'project'  AND COLUMN_NAME IN ('customer','section','status'))
                               OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'title')) > 0) d);
SET @g := IF(@n_ref_other = 0 AND @n_ref_dup = 0 AND @n_idx_multi = 0, 'DO 0',
             'SELECT 1 FROM `중단: 코드표를 가리키는 외래키나 인덱스 모양이 예상과 다르다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 0-g) 데이터 사전 점검: 5) 에서 거는 CHECK 를 지금 데이터가 통과하는가(통과 못 하면 ALTER 가 반쯤 멈춘다).
--      빈 이름(name = '')과 is_active 가 0, 1 이 아닌 행을 센다.
SELECT
  (SELECT COUNT(*) FROM customer     WHERE name = '') AS customer_empty_name,
  (SELECT COUNT(*) FROM section_code WHERE name = '') AS section_empty_name,
  (SELECT COUNT(*) FROM status_code  WHERE name = '') AS status_empty_name,
  (SELECT COUNT(*) FROM title_code   WHERE name = '') AS title_empty_name,
  (SELECT COUNT(*) FROM customer     WHERE is_active NOT IN (0,1))
+ (SELECT COUNT(*) FROM section_code WHERE is_active NOT IN (0,1))
+ (SELECT COUNT(*) FROM status_code  WHERE is_active NOT IN (0,1))
+ (SELECT COUNT(*) FROM title_code   WHERE is_active NOT IN (0,1))
+ (SELECT COUNT(*) FROM project      WHERE is_active NOT IN (0,1)) AS bad_is_active
INTO @pre_e1, @pre_e2, @pre_e3, @pre_e4, @pre_act;
SELECT @pre_e1 AS customer_empty_name, @pre_e2 AS section_empty_name, @pre_e3 AS status_empty_name,
       @pre_e4 AS title_empty_name, @pre_act AS bad_is_active;
SET @g := IF(@pre_e1 + @pre_e2 + @pre_e3 + @pre_e4 + @pre_act = 0, 'DO 0',
             'SELECT 1 FROM `중단: 빈 이름이나 0과 1 밖의 is_active 가 있다 - 데이터를 먼저 고칠 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- =====================================================================
--  1) 스냅숏: 옛 값과 행 수, 지문
-- =====================================================================
--  ※ 임시 표를 한 질의에서 두 번 부르면 ERROR 1137 이다. 아래 문장은 전부 한 번씩만 부른다.
DROP TEMPORARY TABLE IF EXISTS _cid_snap_project;
CREATE TEMPORARY TABLE _cid_snap_project (PRIMARY KEY (id)) ENGINE=InnoDB
  SELECT id, CAST(uid AS CHAR(36)) AS uid, customer, section, status FROM project;   -- uid 는 식 기본값(UUID())을 옮기지 않게 CAST
DROP TEMPORARY TABLE IF EXISTS _cid_snap_user;
CREATE TEMPORARY TABLE _cid_snap_user (PRIMARY KEY (user_id)) ENGINE=InnoDB
  SELECT user_id, title FROM app_user;

SET @c0_customer := (SELECT COUNT(*) FROM customer);
SET @c0_section  := (SELECT COUNT(*) FROM section_code);
SET @c0_status   := (SELECT COUNT(*) FROM status_code);
SET @c0_title    := (SELECT COUNT(*) FROM title_code);
SET @c0_project  := (SELECT COUNT(*) FROM project);
SET @c0_user     := (SELECT COUNT(*) FROM app_user);
-- cal_* 16표 행 수(이 파일은 cal_* 를 건드리지 않는다. 사후에 그대로인지 본다).
SET @c0_cal := (SELECT CONCAT_WS(',',
  (SELECT COUNT(*) FROM cal_category),      (SELECT COUNT(*) FROM cal_entry),
  (SELECT COUNT(*) FROM cal_entry_except),  (SELECT COUNT(*) FROM cal_entry_commit),
  (SELECT COUNT(*) FROM cal_todo),          (SELECT COUNT(*) FROM cal_todo_day_note),
  (SELECT COUNT(*) FROM cal_room),          (SELECT COUNT(*) FROM cal_task_hours),
  (SELECT COUNT(*) FROM cal_attendance),    (SELECT COUNT(*) FROM cal_report_daily),
  (SELECT COUNT(*) FROM cal_report_hours),  (SELECT COUNT(*) FROM cal_report_weekly),
  (SELECT COUNT(*) FROM cal_user_pref),     (SELECT COUNT(*) FROM cal_user_rev),
  (SELECT COUNT(*) FROM cal_migration_log), (SELECT COUNT(*) FROM cal_schema_meta)));
SET @c0_rev := (SELECT CONCAT(COUNT(*), ':', IFNULL(SUM(rev), 0), ':',
                              IFNULL(BIT_XOR(CRC32(CONCAT(user_id, ':', rev))), 0)) FROM cal_user_rev);
-- 옮기지 않는 열의 지문(내용과 갱신 시각이 그대로인지 사후에 본다).
SET @c0_fp_project := (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', id, uid, project_name, contract_name, common_name,
                               IFNULL(start_date,'-'), IFNULL(end_date,'-'), IFNULL(dev_end_date,'-'),
                               note, is_active, created_at, updated_at))), 0) FROM project);
SET @c0_fp_user := (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', user_id, login_id, name, IFNULL(org_id,'-'),
                            IFNULL(sort_order,'-'), view_scope, edit_role, is_active, created_at, updated_at))), 0) FROM app_user);
SET @c0_fp_codes := (SELECT CONCAT_WS(',',
  (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', name, is_active, created_at, updated_at))), 0) FROM customer),
  (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', name, sort_order, is_active, created_at, updated_at))), 0) FROM section_code),
  (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', name, sort_order, is_active, created_at, updated_at))), 0) FROM status_code),
  (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', name, sort_order, is_active, created_at, updated_at))), 0) FROM title_code)));

SELECT @c0_customer AS customer, @c0_section AS section_code, @c0_status AS status_code,
       @c0_title AS title_code, @c0_project AS project, @c0_user AS app_user, @c0_cal AS cal_counts;

-- =====================================================================
--  2) 부모 번호: 시드 이름은 고정 번호 지도로, 나머지는 MAX+1 부터 이름순
-- =====================================================================
--  ★ 고정 번호 지도는 정본 시드와 같다: section_code, status_code = schema-structure.sql 끝의 INSERT,
--    title_code = 회사 저장소 02-seed-org.sql 의 _title_seed. 셋이 어긋나면 tests/code-ids-db.test.mjs 가 잡는다.
--  ★ 지도 매칭은 BINARY 다. 이름이 대소문자 하나만 달라도 지도 밖으로 보고 MAX+1 번호를 준다(조용히 흡수하지 않는다).
--  ★ 로컬 DB 의 sort_order 는 시드와 다르므로 sort_order 로 번호를 매기지 않는다(§3).
--  ★ 열을 더하기 전에 있으면 건너뛰고, 번호는 매번 처음부터 다시 매긴다(4) 에서 멈춘 뒤의 재실행).

-- ---------- 2-1) customer.customer_id (지도 없음: 1 부터 이름순) ----------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer' AND COLUMN_NAME = 'customer_id');
SET @s := IF(@c = 0, 'ALTER TABLE customer ADD COLUMN customer_id SMALLINT UNSIGNED NULL DEFAULT NULL FIRST', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
UPDATE customer SET customer_id = NULL, updated_at = updated_at;
SET @base := (SELECT IFNULL(MAX(customer_id), 0) FROM customer);
UPDATE customer c JOIN (
    SELECT name, ROW_NUMBER() OVER (ORDER BY name, CAST(name AS BINARY)) AS rn
      FROM customer WHERE customer_id IS NULL
  ) r ON CAST(r.name AS BINARY) = CAST(c.name AS BINARY)
   SET c.customer_id = @base + r.rn, c.updated_at = c.updated_at;

-- ---------- 2-2) section_code.section_id (지도: 1 일반계약, 2 선진행, 3 사업부관리) ----------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_code' AND COLUMN_NAME = 'section_id');
SET @s := IF(@c = 0, 'ALTER TABLE section_code ADD COLUMN section_id SMALLINT UNSIGNED NULL DEFAULT NULL FIRST', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
UPDATE section_code SET section_id = NULL, updated_at = updated_at;
UPDATE section_code s JOIN (
    SELECT 1 AS id, '일반계약' AS nm UNION ALL SELECT 2, '선진행' UNION ALL SELECT 3, '사업부관리'
  ) m ON CAST(s.name AS BINARY) = CAST(m.nm AS BINARY)
   SET s.section_id = m.id, s.updated_at = s.updated_at;
SET @base := (SELECT GREATEST(3, IFNULL(MAX(section_id), 0)) FROM section_code);
UPDATE section_code s JOIN (
    SELECT name, ROW_NUMBER() OVER (ORDER BY name, CAST(name AS BINARY)) AS rn
      FROM section_code WHERE section_id IS NULL
  ) r ON CAST(r.name AS BINARY) = CAST(s.name AS BINARY)
   SET s.section_id = @base + r.rn, s.updated_at = s.updated_at;

-- ---------- 2-3) status_code.status_id (지도: 1 진행중, 2 종료, 3 1차 납품완료, 4 미정) ----------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'status_code' AND COLUMN_NAME = 'status_id');
SET @s := IF(@c = 0, 'ALTER TABLE status_code ADD COLUMN status_id SMALLINT UNSIGNED NULL DEFAULT NULL FIRST', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
UPDATE status_code SET status_id = NULL, updated_at = updated_at;
UPDATE status_code s JOIN (
    SELECT 1 AS id, '진행중' AS nm UNION ALL SELECT 2, '종료' UNION ALL SELECT 3, '1차 납품완료' UNION ALL SELECT 4, '미정'
  ) m ON CAST(s.name AS BINARY) = CAST(m.nm AS BINARY)
   SET s.status_id = m.id, s.updated_at = s.updated_at;
SET @base := (SELECT GREATEST(4, IFNULL(MAX(status_id), 0)) FROM status_code);
UPDATE status_code s JOIN (
    SELECT name, ROW_NUMBER() OVER (ORDER BY name, CAST(name AS BINARY)) AS rn
      FROM status_code WHERE status_id IS NULL
  ) r ON CAST(r.name AS BINARY) = CAST(s.name AS BINARY)
   SET s.status_id = @base + r.rn, s.updated_at = s.updated_at;

-- ---------- 2-4) title_code.title_id (지도: 02-seed-org.sql 의 직급 배정표 1~11) ----------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'title_code' AND COLUMN_NAME = 'title_id');
SET @s := IF(@c = 0, 'ALTER TABLE title_code ADD COLUMN title_id SMALLINT UNSIGNED NULL DEFAULT NULL FIRST', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
UPDATE title_code SET title_id = NULL, updated_at = updated_at;
UPDATE title_code t JOIN (
    SELECT 1 AS id, '대표' AS nm UNION ALL SELECT 2, '전무' UNION ALL SELECT 3, '상무' UNION ALL SELECT 4, '이사'
    UNION ALL SELECT 5, '수석' UNION ALL SELECT 6, '책임' UNION ALL SELECT 7, '부장' UNION ALL SELECT 8, '선임'
    UNION ALL SELECT 9, '연구원' UNION ALL SELECT 10, '대리' UNION ALL SELECT 11, '사원'
  ) m ON CAST(t.name AS BINARY) = CAST(m.nm AS BINARY)
   SET t.title_id = m.id, t.updated_at = t.updated_at;
SET @base := (SELECT GREATEST(11, IFNULL(MAX(title_id), 0)) FROM title_code);
UPDATE title_code t JOIN (
    SELECT name, ROW_NUMBER() OVER (ORDER BY name, CAST(name AS BINARY)) AS rn
      FROM title_code WHERE title_id IS NULL
  ) r ON CAST(r.name AS BINARY) = CAST(t.name AS BINARY)
   SET t.title_id = @base + r.rn, t.updated_at = t.updated_at;

SELECT 'customer' AS tbl, customer_id AS id, name FROM customer
UNION ALL SELECT 'section_code', section_id, name FROM section_code
UNION ALL SELECT 'status_code',  status_id,  name FROM status_code
UNION ALL SELECT 'title_code',   title_id,   name FROM title_code
ORDER BY tbl, id;

-- =====================================================================
--  3) 자식 번호: NULL 허용으로 더하고 JOIN … ON name 으로 채운다
-- =====================================================================
--  ★ 자리: 옛 열 바로 뒤(AFTER). 5) 에서 옛 열을 지우면 새 열이 그 자리를 물려받아,
--    새로 지은 DB 와 열 순서가 같아진다.
--  ★ JOIN 은 옛 외래키와 같은 비교(표 콜레이션)로 한다. 대소문자만 다른 참조가 있었다면 4) 의 BINARY 관문이 잡는다.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'section_id');
SET @s := IF(@c = 0, 'ALTER TABLE project ADD COLUMN section_id SMALLINT UNSIGNED NULL DEFAULT NULL AFTER section', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'customer_id');
SET @s := IF(@c = 0, 'ALTER TABLE project ADD COLUMN customer_id SMALLINT UNSIGNED NULL DEFAULT NULL AFTER customer', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'status_id');
SET @s := IF(@c = 0, 'ALTER TABLE project ADD COLUMN status_id SMALLINT UNSIGNED NULL DEFAULT NULL AFTER status', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

UPDATE project p
  LEFT JOIN section_code s ON s.name = p.section
  LEFT JOIN customer     c ON c.name = p.customer
  LEFT JOIN status_code  t ON t.name = p.status
   SET p.section_id = s.section_id, p.customer_id = c.customer_id, p.status_id = t.status_id,
       p.updated_at = p.updated_at;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'title_id');
SET @s := IF(@c = 0, 'ALTER TABLE app_user ADD COLUMN title_id SMALLINT UNSIGNED NULL DEFAULT NULL AFTER title', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

UPDATE app_user u
  LEFT JOIN title_code t ON t.name = u.title
   SET u.title_id = t.title_id, u.updated_at = u.updated_at;

-- =====================================================================
--  4) ★ 절단 관문: 여기를 통과해야만 옛 열을 지운다
-- =====================================================================
--  '지워도 되는가' 의 정의는 하나다: 번호만으로 옛 이름을 BINARY 로 한 글자도 틀리지 않게 되살릴 수 있는가.
--  아래 값이 전부 0 이면 그렇다. 하나라도 0 이 아니면 옛 열을 지우지 않고 여기서 멈춘다.
--    - cut_parent : 부모 번호가 비었거나(NULL, 0) 겹치는 행
--    - cut_fixed  : 지도에 있는 이름이 지도와 다른 번호를 받은 행
--    - cut_*_null : 옛 값과 새 번호 중 한쪽만 NULL 인 행(상태 없음, 직급 없음 판정이 갈린다)
--    - cut_*_drift: 새 번호가 가리키는 이름 ≠ 스냅숏의 옛 값(BINARY). 행이 사라져도 여기서 잡힌다.
--  BINARY 인 이유: 표 콜레이션(ai_ci)은 'ABC' 와 'abc' 를 같게 본다. 그대로 통과시키면 옛 열을 지우는 순간
--  원래 글자가 사라진다. 대소문자만 다른 참조가 있다면 데이터를 먼저 맞춘 뒤 다시 돌린다.
SET @cut_parent := (SELECT
    (SELECT COUNT(*) FROM customer     WHERE customer_id IS NULL OR customer_id = 0)
  + (SELECT COUNT(*) - COUNT(DISTINCT customer_id) FROM customer)
  + (SELECT COUNT(*) FROM section_code WHERE section_id IS NULL OR section_id = 0)
  + (SELECT COUNT(*) - COUNT(DISTINCT section_id) FROM section_code)
  + (SELECT COUNT(*) FROM status_code  WHERE status_id IS NULL OR status_id = 0)
  + (SELECT COUNT(*) - COUNT(DISTINCT status_id) FROM status_code)
  + (SELECT COUNT(*) FROM title_code   WHERE title_id IS NULL OR title_id = 0)
  + (SELECT COUNT(*) - COUNT(DISTINCT title_id) FROM title_code));
SET @cut_fixed := (SELECT
    (SELECT COUNT(*) FROM section_code s JOIN (
        SELECT 1 AS id, '일반계약' AS nm UNION ALL SELECT 2, '선진행' UNION ALL SELECT 3, '사업부관리'
      ) m ON CAST(s.name AS BINARY) = CAST(m.nm AS BINARY) WHERE s.section_id <> m.id)
  + (SELECT COUNT(*) FROM status_code s JOIN (
        SELECT 1 AS id, '진행중' AS nm UNION ALL SELECT 2, '종료' UNION ALL SELECT 3, '1차 납품완료' UNION ALL SELECT 4, '미정'
      ) m ON CAST(s.name AS BINARY) = CAST(m.nm AS BINARY) WHERE s.status_id <> m.id)
  + (SELECT COUNT(*) FROM title_code t JOIN (
        SELECT 1 AS id, '대표' AS nm UNION ALL SELECT 2, '전무' UNION ALL SELECT 3, '상무' UNION ALL SELECT 4, '이사'
        UNION ALL SELECT 5, '수석' UNION ALL SELECT 6, '책임' UNION ALL SELECT 7, '부장' UNION ALL SELECT 8, '선임'
        UNION ALL SELECT 9, '연구원' UNION ALL SELECT 10, '대리' UNION ALL SELECT 11, '사원'
      ) m ON CAST(t.name AS BINARY) = CAST(m.nm AS BINARY) WHERE t.title_id <> m.id));

SET @cut_cust_null := (SELECT COUNT(*) FROM _cid_snap_project s JOIN project p ON p.id = s.id
                        WHERE (s.customer IS NULL) <> (p.customer_id IS NULL));
SET @cut_sec_null  := (SELECT COUNT(*) FROM _cid_snap_project s JOIN project p ON p.id = s.id
                        WHERE (s.section IS NULL) <> (p.section_id IS NULL));
SET @cut_st_null   := (SELECT COUNT(*) FROM _cid_snap_project s JOIN project p ON p.id = s.id
                        WHERE (s.status IS NULL) <> (p.status_id IS NULL));
SET @cut_title_null := (SELECT COUNT(*) FROM _cid_snap_user s JOIN app_user u ON u.user_id = s.user_id
                         WHERE (s.title IS NULL) <> (u.title_id IS NULL));

SET @cut_cust_drift := (SELECT COUNT(*) FROM _cid_snap_project s
                          LEFT JOIN project  p ON p.id = s.id
                          LEFT JOIN customer c ON c.customer_id = p.customer_id
                         WHERE p.id IS NULL OR NOT (CAST(s.customer AS BINARY) <=> CAST(c.name AS BINARY)));
SET @cut_sec_drift  := (SELECT COUNT(*) FROM _cid_snap_project s
                          LEFT JOIN project      p ON p.id = s.id
                          LEFT JOIN section_code c ON c.section_id = p.section_id
                         WHERE p.id IS NULL OR NOT (CAST(s.section AS BINARY) <=> CAST(c.name AS BINARY)));
SET @cut_st_drift   := (SELECT COUNT(*) FROM _cid_snap_project s
                          LEFT JOIN project     p ON p.id = s.id
                          LEFT JOIN status_code c ON c.status_id = p.status_id
                         WHERE p.id IS NULL OR NOT (CAST(s.status AS BINARY) <=> CAST(c.name AS BINARY)));
SET @cut_title_drift := (SELECT COUNT(*) FROM _cid_snap_user s
                           LEFT JOIN app_user   u ON u.user_id = s.user_id
                           LEFT JOIN title_code t ON t.title_id = u.title_id
                          WHERE u.user_id IS NULL OR NOT (CAST(s.title AS BINARY) <=> CAST(t.name AS BINARY)));
SET @cut_rows := ((SELECT COUNT(*) FROM project) <> @c0_project) + ((SELECT COUNT(*) FROM app_user) <> @c0_user);

SELECT @cut_parent AS cut_parent, @cut_fixed AS cut_fixed,
       @cut_cust_null AS cut_cust_null, @cut_sec_null AS cut_sec_null, @cut_st_null AS cut_st_null,
       @cut_title_null AS cut_title_null,
       @cut_cust_drift AS cut_cust_drift, @cut_sec_drift AS cut_sec_drift, @cut_st_drift AS cut_st_drift,
       @cut_title_drift AS cut_title_drift, @cut_rows AS cut_rows;

-- 어긋난 행을 먼저 보여 준다(멈춘 뒤 무엇을 고칠지 바로 보이게. 정상이면 0행).
SELECT s.id, s.uid, s.customer AS old_customer, c.name AS new_customer,
       s.section AS old_section, sc.name AS new_section, s.status AS old_status, st.name AS new_status
  FROM _cid_snap_project s
  LEFT JOIN project      p  ON p.id = s.id
  LEFT JOIN customer     c  ON c.customer_id = p.customer_id
  LEFT JOIN section_code sc ON sc.section_id = p.section_id
  LEFT JOIN status_code  st ON st.status_id = p.status_id
 WHERE p.id IS NULL
    OR NOT (CAST(s.customer AS BINARY) <=> CAST(c.name AS BINARY))
    OR NOT (CAST(s.section  AS BINARY) <=> CAST(sc.name AS BINARY))
    OR NOT (CAST(s.status   AS BINARY) <=> CAST(st.name AS BINARY))
 ORDER BY s.id LIMIT 20;
SELECT s.user_id, s.title AS old_title, t.name AS new_title
  FROM _cid_snap_user s
  LEFT JOIN app_user   u ON u.user_id = s.user_id
  LEFT JOIN title_code t ON t.title_id = u.title_id
 WHERE u.user_id IS NULL OR NOT (CAST(s.title AS BINARY) <=> CAST(t.name AS BINARY))
 ORDER BY s.user_id LIMIT 20;

SET @g := IF(@cut_parent + @cut_fixed
           + @cut_cust_null + @cut_sec_null + @cut_st_null + @cut_title_null
           + @cut_cust_drift + @cut_sec_drift + @cut_st_drift + @cut_title_drift + @cut_rows = 0, 'DO 0',
             'SELECT 1 FROM `중단: 번호가 옛 이름을 그대로 되살리지 못한다 - 옛 열을 지우지 않았다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 4-b) 동작이 묶인 고정 번호 행이 있어야 한다(CODE-TABLE-IDS §3) ----------
--  구분 2(선진행)는 날짜 잠금, 상태 2(종료)는 '진행중만' 필터와 엑셀 회색에 묶여 있고 앱은 이 두 행의 숨김과 삭제를 막는다.
--  옛 DB 에서 라벨을 바꿨다면(예: '선진행(계약전)') 지도에 안 맞아 MAX+1 번호를 받고, 번호 2 는 비어 버린다.
--  그러면 동작이 아무 행에도 걸리지 않으므로 옛 열이 남아 있는 여기서 멈춘다. 고치는 법: 옛 DB 에서 그 라벨을 시드 이름
--  ('선진행', '종료')으로 되돌리고 이 파일을 다시 돌린다(4) 에서 멈춘 것과 같아 그대로 재실행된다). 바꾼 라벨은 v13 이 된 뒤
--  관리 화면에서 다시 붙이면 된다(번호 2 에 묶인 동작은 그대로 남는다).
SET @fix_sec := (SELECT COUNT(*) FROM section_code WHERE section_id = 2);
SET @fix_st  := (SELECT COUNT(*) FROM status_code  WHERE status_id  = 2);
SELECT 'section_code' AS tbl, 2 AS fixed_id, '선진행' AS seed_name, @fix_sec AS found
UNION ALL SELECT 'status_code', 2, '종료', @fix_st;
SET @g := IF(@fix_sec = 1 AND @fix_st = 1, 'DO 0',
             'SELECT 1 FROM `중단: 구분 2(선진행)나 상태 2(종료)가 없다 - 옛 DB 에서 이름을 시드대로 되돌릴 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 4-c) 보호 행은 켜져 있어야 한다 ----------
--  앱은 이 두 행을 숨길 수 없게 막는다. 옛 DB 에서 숨겨져(is_active = 0) 왔다면 숨김을 풀 길이 없으므로 여기서 켠다.
--  켠 행은 알림으로 보인다(정상이면 0행). 감사 시각은 다른 백필과 같이 덮지 않는다.
SELECT '알림: 숨겨져 있던 보호 행을 다시 켠다' AS notice, 'section_code' AS tbl, section_id AS id, name
  FROM section_code WHERE section_id = 2 AND is_active = 0
UNION ALL
SELECT '알림: 숨겨져 있던 보호 행을 다시 켠다', 'status_code', status_id, name
  FROM status_code WHERE status_id = 2 AND is_active = 0;
UPDATE section_code SET is_active = 1, updated_at = updated_at WHERE section_id = 2 AND is_active = 0;
UPDATE status_code  SET is_active = 1, updated_at = updated_at WHERE status_id  = 2 AND is_active = 0;
--  위에서 is_active 를 바꿨을 수 있으므로 코드표 지문(1) 단계)을 여기서 다시 뜬다. 6) 의 불변 검사는 이 값과 비교한다.
SET @c0_fp_codes := (SELECT CONCAT_WS(',',
  (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', name, is_active, created_at, updated_at))), 0) FROM customer),
  (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', name, sort_order, is_active, created_at, updated_at))), 0) FROM section_code),
  (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', name, sort_order, is_active, created_at, updated_at))), 0) FROM status_code),
  (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', name, sort_order, is_active, created_at, updated_at))), 0) FROM title_code)));

-- =====================================================================
--  5) 절단: 되돌릴 수 없는 지점. 여기서부터 멈추면 백업으로 되돌린다
-- =====================================================================

-- ---------- 5-1) 옛 외래키 넷을 뗀다(이름은 information_schema 에서 찾는다. 0-f 가 열마다 하나 이하임을 확인했다) ----------
SET @fk := (SELECT MIN(CONSTRAINT_NAME) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'customer'
               AND REFERENCED_TABLE_NAME IS NOT NULL);
SET @s := IF(@fk IS NULL, 'DO 0', CONCAT('ALTER TABLE project DROP FOREIGN KEY `', @fk, '`'));
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @fk := (SELECT MIN(CONSTRAINT_NAME) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'section'
               AND REFERENCED_TABLE_NAME IS NOT NULL);
SET @s := IF(@fk IS NULL, 'DO 0', CONCAT('ALTER TABLE project DROP FOREIGN KEY `', @fk, '`'));
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @fk := (SELECT MIN(CONSTRAINT_NAME) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'status'
               AND REFERENCED_TABLE_NAME IS NOT NULL);
SET @s := IF(@fk IS NULL, 'DO 0', CONCAT('ALTER TABLE project DROP FOREIGN KEY `', @fk, '`'));
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @fk := (SELECT MIN(CONSTRAINT_NAME) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'title'
               AND REFERENCED_TABLE_NAME IS NOT NULL);
SET @s := IF(@fk IS NULL, 'DO 0', CONCAT('ALTER TABLE app_user DROP FOREIGN KEY `', @fk, '`'));
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 5-2) 옛 열을 지운다. 단일 열 인덱스(ix_project_customer, ix_project_section, FK 받침)는 함께 사라진다 ----------
ALTER TABLE project  DROP COLUMN customer, DROP COLUMN section, DROP COLUMN status;
ALTER TABLE app_user DROP COLUMN title;

-- ---------- 5-3) 부모 기본키를 번호로. UNIQUE(name), CHECK, 표 COMMENT 는 schema-structure.sql / 01-schema-users.sql 과 같다 ----------
--  ※ AUTO_INCREMENT 를 붙이는 순간 InnoDB 가 카운터를 MAX+1 로 맞춘다(6) 에서 확인한다).
--  ※ 0 인 번호가 없다는 것은 4) 의 cut_parent 가 확인했다(0 이 있으면 AUTO_INCREMENT 가 새 번호로 바꾼다).
ALTER TABLE customer
  DROP PRIMARY KEY,
  MODIFY customer_id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (customer_id),
  ADD UNIQUE KEY uq_customer_name (name),
  ADD CONSTRAINT chk_customer_name   CHECK (name <> ''),
  ADD CONSTRAINT chk_customer_active CHECK (is_active IN (0,1)),
  COMMENT = '발주처 마스터. PK=customer_id, name=UNIQUE 라벨. Admin 관리.';
ALTER TABLE section_code
  DROP PRIMARY KEY,
  MODIFY section_id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (section_id),
  ADD UNIQUE KEY uq_section_code_name (name),
  ADD CONSTRAINT chk_section_code_name   CHECK (name <> ''),
  ADD CONSTRAINT chk_section_code_active CHECK (is_active IN (0,1)),
  COMMENT = '구분 코드. PK=section_id(고정 번호 2=선진행), name=UNIQUE 라벨. Admin 관리.';
ALTER TABLE status_code
  DROP PRIMARY KEY,
  MODIFY status_id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (status_id),
  ADD UNIQUE KEY uq_status_code_name (name),
  ADD CONSTRAINT chk_status_code_name   CHECK (name <> ''),
  ADD CONSTRAINT chk_status_code_active CHECK (is_active IN (0,1)),
  COMMENT = '상태 코드. PK=status_id(고정 번호 2=종료), name=UNIQUE 라벨. Admin 관리.';
ALTER TABLE title_code
  DROP PRIMARY KEY,
  MODIFY title_id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (title_id),
  ADD UNIQUE KEY uq_title_code_name (name),
  ADD CONSTRAINT chk_title_code_name   CHECK (name <> ''),
  ADD CONSTRAINT chk_title_code_active CHECK (is_active IN (0,1)),
  COMMENT = '직급 코드. PK=title_id, name=UNIQUE 라벨. 표시와 정렬 전용, 권한 판정에 쓰지 않는다.';

-- ---------- 5-3b) AUTO_INCREMENT 바닥: 고정 번호의 최댓값 + 1 ----------
--  옛 DB 에 시드 이름이 빠져 있으면(예: 구분 '사업부관리' 가 없음) 카운터가 MAX+1 이라 다음 새 행이 비어 있는 고정 번호
--  (구분 3)를 차지한다. 그래서 고정 번호를 둔 세 표는 카운터를 max(바닥, MAX+1)로 올려 둔다. 바닥: 구분 4, 상태 5, 직급 12.
--  customer 는 고정 번호가 없다. ALTER TABLE ... AUTO_INCREMENT 는 상수만 받으므로 문장을 만들어 돌린다.
SET @s := CONCAT('ALTER TABLE section_code AUTO_INCREMENT = ', (SELECT GREATEST(4,  IFNULL(MAX(section_id), 0) + 1) FROM section_code));
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @s := CONCAT('ALTER TABLE status_code AUTO_INCREMENT = ',  (SELECT GREATEST(5,  IFNULL(MAX(status_id), 0) + 1) FROM status_code));
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @s := CONCAT('ALTER TABLE title_code AUTO_INCREMENT = ',   (SELECT GREATEST(12, IFNULL(MAX(title_id), 0) + 1) FROM title_code));
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 5-4) 자식: NOT NULL, 인덱스, 외래키(ON UPDATE RESTRICT ON DELETE RESTRICT), CHECK ----------
--  ※ 인덱스를 외래키보다 먼저(같은 문장 안에서) 이름을 붙여 만든다. 그래야 InnoDB 가 자동 이름 인덱스를 만들지 않고,
--    새로 지은 DB 와 인덱스 이름이 같아진다.
ALTER TABLE project
  MODIFY section_id  SMALLINT UNSIGNED NOT NULL,
  MODIFY customer_id SMALLINT UNSIGNED NOT NULL,
  MODIFY status_id   SMALLINT UNSIGNED NULL DEFAULT NULL,
  ADD KEY ix_project_customer_id (customer_id),
  ADD KEY ix_project_section_id  (section_id),
  ADD KEY ix_project_status_id   (status_id),
  ADD CONSTRAINT fk_project_customer_id FOREIGN KEY (customer_id) REFERENCES customer(customer_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT fk_project_section_id FOREIGN KEY (section_id) REFERENCES section_code(section_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT fk_project_status_id FOREIGN KEY (status_id) REFERENCES status_code(status_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT chk_project_active CHECK (is_active IN (0,1)),
  COMMENT = '과제 마스터. DB 원본. 코드는 번호 참조(customer_id, section_id, status_id), is_active=소프트삭제.';
-- app_user 의 표 COMMENT 는 그대로 둔다(회사 저장소 apply.ps1 이 SHA-256 으로 대조한다).
ALTER TABLE app_user
  ADD KEY ix_user_title_id (title_id),
  ADD CONSTRAINT fk_user_title_id FOREIGN KEY (title_id) REFERENCES title_code(title_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

-- =====================================================================
--  6) 판번호 13 + 사후 검증
-- =====================================================================
UPDATE cal_schema_meta SET v = '13', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'schema_version' AND v = '12';

SET SESSION information_schema_stats_expiry = 0;

-- E1) 고아(외래키가 막지만 제약이 실제로 섰는지까지 함께 증명한다)
SET @e_orphan := (SELECT
    (SELECT COUNT(*) FROM project p LEFT JOIN customer c ON c.customer_id = p.customer_id WHERE c.customer_id IS NULL)
  + (SELECT COUNT(*) FROM project p LEFT JOIN section_code s ON s.section_id = p.section_id WHERE s.section_id IS NULL)
  + (SELECT COUNT(*) FROM project p LEFT JOIN status_code s ON s.status_id = p.status_id
      WHERE p.status_id IS NOT NULL AND s.status_id IS NULL)
  + (SELECT COUNT(*) FROM app_user u LEFT JOIN title_code t ON t.title_id = u.title_id
      WHERE u.title_id IS NOT NULL AND t.title_id IS NULL));

-- E2) 표별 행 수 불변
SET @e_rows := ((SELECT COUNT(*) FROM customer) <> @c0_customer) + ((SELECT COUNT(*) FROM section_code) <> @c0_section)
             + ((SELECT COUNT(*) FROM status_code) <> @c0_status) + ((SELECT COUNT(*) FROM title_code) <> @c0_title)
             + ((SELECT COUNT(*) FROM project) <> @c0_project) + ((SELECT COUNT(*) FROM app_user) <> @c0_user);

-- E3) 번호로 되살린 이름 = 스냅숏(BINARY, NULL 대칭). 옛 열이 없어진 뒤의 최종 확인이다.
SET @e_proj_drift := (SELECT COUNT(*) FROM _cid_snap_project s
                        LEFT JOIN project      p  ON p.id = s.id
                        LEFT JOIN customer     c  ON c.customer_id = p.customer_id
                        LEFT JOIN section_code sc ON sc.section_id = p.section_id
                        LEFT JOIN status_code  st ON st.status_id = p.status_id
                       WHERE p.id IS NULL OR CAST(p.uid AS BINARY) <> CAST(s.uid AS BINARY)
                          OR NOT (CAST(s.customer AS BINARY) <=> CAST(c.name AS BINARY))
                          OR NOT (CAST(s.section  AS BINARY) <=> CAST(sc.name AS BINARY))
                          OR NOT (CAST(s.status   AS BINARY) <=> CAST(st.name AS BINARY)));
SET @e_user_drift := (SELECT COUNT(*) FROM _cid_snap_user s
                        LEFT JOIN app_user   u ON u.user_id = s.user_id
                        LEFT JOIN title_code t ON t.title_id = u.title_id
                       WHERE u.user_id IS NULL OR NOT (CAST(s.title AS BINARY) <=> CAST(t.name AS BINARY)));

-- E4) cal_* 행 수와 cal_user_rev 불변, 옮기지 않은 열의 지문 불변(내용과 갱신 시각)
SET @e_cal := (SELECT CONCAT_WS(',',
  (SELECT COUNT(*) FROM cal_category),      (SELECT COUNT(*) FROM cal_entry),
  (SELECT COUNT(*) FROM cal_entry_except),  (SELECT COUNT(*) FROM cal_entry_commit),
  (SELECT COUNT(*) FROM cal_todo),          (SELECT COUNT(*) FROM cal_todo_day_note),
  (SELECT COUNT(*) FROM cal_room),          (SELECT COUNT(*) FROM cal_task_hours),
  (SELECT COUNT(*) FROM cal_attendance),    (SELECT COUNT(*) FROM cal_report_daily),
  (SELECT COUNT(*) FROM cal_report_hours),  (SELECT COUNT(*) FROM cal_report_weekly),
  (SELECT COUNT(*) FROM cal_user_pref),     (SELECT COUNT(*) FROM cal_user_rev),
  (SELECT COUNT(*) FROM cal_migration_log), (SELECT COUNT(*) FROM cal_schema_meta)));
SET @e_rev := (SELECT CONCAT(COUNT(*), ':', IFNULL(SUM(rev), 0), ':',
                             IFNULL(BIT_XOR(CRC32(CONCAT(user_id, ':', rev))), 0)) FROM cal_user_rev);
SET @e_fp_project := (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', id, uid, project_name, contract_name, common_name,
                              IFNULL(start_date,'-'), IFNULL(end_date,'-'), IFNULL(dev_end_date,'-'),
                              note, is_active, created_at, updated_at))), 0) FROM project);
SET @e_fp_user := (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', user_id, login_id, name, IFNULL(org_id,'-'),
                           IFNULL(sort_order,'-'), view_scope, edit_role, is_active, created_at, updated_at))), 0) FROM app_user);
SET @e_fp_codes := (SELECT CONCAT_WS(',',
  (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', name, is_active, created_at, updated_at))), 0) FROM customer),
  (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', name, sort_order, is_active, created_at, updated_at))), 0) FROM section_code),
  (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', name, sort_order, is_active, created_at, updated_at))), 0) FROM status_code),
  (SELECT IFNULL(BIT_XOR(CRC32(CONCAT_WS('|', name, sort_order, is_active, created_at, updated_at))), 0) FROM title_code)));
SET @e_same := (@e_cal <> @c0_cal) + (@e_rev <> @c0_rev) + (@e_fp_project <> @c0_fp_project)
             + (@e_fp_user <> @c0_fp_user) + (@e_fp_codes <> @c0_fp_codes);

-- E5) 구조: 이 파일이 스스로 만든 결과라 하나라도 어긋나면 반쯤 돈 것이다
SET @e_struct := (SELECT
    -- 옛 열 4개가 없어야 한다
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
       AND ((TABLE_NAME = 'project' AND COLUMN_NAME IN ('customer','section','status'))
         OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'title')))
    -- 부모 기본키 = 번호 열 하나
  + (4 - (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE()
           AND CONSTRAINT_NAME = 'PRIMARY'
           AND (TABLE_NAME, COLUMN_NAME) IN (('customer','customer_id'),('section_code','section_id'),
                                            ('status_code','status_id'),('title_code','title_id'))))
  + ((SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE()
       AND CONSTRAINT_NAME = 'PRIMARY' AND TABLE_NAME IN ('customer','section_code','status_code','title_code')) <> 4)
    -- UNIQUE(name) 넷
  + (4 - (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE()
           AND CONSTRAINT_TYPE = 'UNIQUE'
           AND CONSTRAINT_NAME IN ('uq_customer_name','uq_section_code_name','uq_status_code_name','uq_title_code_name')))
    -- 새 외래키 넷, 규칙은 RESTRICT / RESTRICT
  + (4 - (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
           AND UPDATE_RULE = 'RESTRICT' AND DELETE_RULE = 'RESTRICT'
           AND (TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME) IN
               (('project','fk_project_customer_id','customer'),('project','fk_project_section_id','section_code'),
                ('project','fk_project_status_id','status_code'),('app_user','fk_user_title_id','title_code'))))
    -- 코드표를 가리키는 외래키는 그 넷뿐
  + ((SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND REFERENCED_TABLE_NAME IN ('customer','section_code','status_code','title_code')) <> 4)
    -- CHECK 아홉
  + (9 - (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE()
           AND CONSTRAINT_TYPE = 'CHECK'
           AND CONSTRAINT_NAME IN ('chk_customer_name','chk_customer_active','chk_section_code_name',
                                   'chk_section_code_active','chk_status_code_name','chk_status_code_active',
                                   'chk_title_code_name','chk_title_code_active','chk_project_active')))
    -- 이름 붙인 인덱스 넷
  + (4 - (SELECT COUNT(DISTINCT TABLE_NAME, INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
           AND (TABLE_NAME, INDEX_NAME) IN (('project','ix_project_customer_id'),('project','ix_project_section_id'),
                                           ('project','ix_project_status_id'),('app_user','ix_user_title_id'))))
    -- 자식 NULL 허용: customer_id, section_id 는 NOT NULL, status_id, title_id 는 NULL
  + (4 - (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
           AND (TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE) IN
               (('project','customer_id','NO','smallint unsigned'),('project','section_id','NO','smallint unsigned'),
                ('project','status_id','YES','smallint unsigned'),('app_user','title_id','YES','smallint unsigned'))))
    -- 표 COMMENT(정본 파일과 같은 문자열)
  + (4 - (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
           AND (TABLE_NAME, TABLE_COMMENT) IN (
             ('customer',     '발주처 마스터. PK=customer_id, name=UNIQUE 라벨. Admin 관리.'),
             ('section_code', '구분 코드. PK=section_id(고정 번호 2=선진행), name=UNIQUE 라벨. Admin 관리.'),
             ('status_code',  '상태 코드. PK=status_id(고정 번호 2=종료), name=UNIQUE 라벨. Admin 관리.'),
             ('project',      '과제 마스터. DB 원본. 코드는 번호 참조(customer_id, section_id, status_id), is_active=소프트삭제.'))))
  + ((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'title_code'
       AND TABLE_COMMENT = '직급 코드. PK=title_id, name=UNIQUE 라벨. 표시와 정렬 전용, 권한 판정에 쓰지 않는다.') <> 1));

-- E6) AUTO_INCREMENT > MAX(번호) 이고 고정 번호 바닥(구분 4, 상태 5, 직급 12) 이상: 다음 새 행이 기존 번호나
--     비어 있는 고정 번호와 부딪히지 않는다(5-3b).
SET @e_ai := (SELECT
    ((SELECT IFNULL(AUTO_INCREMENT, 0) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer')
      <= (SELECT IFNULL(MAX(customer_id), 0) FROM customer))
  + ((SELECT IFNULL(AUTO_INCREMENT, 0) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_code')
      <= (SELECT GREATEST(3, IFNULL(MAX(section_id), 0)) FROM section_code))
  + ((SELECT IFNULL(AUTO_INCREMENT, 0) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'status_code')
      <= (SELECT GREATEST(4, IFNULL(MAX(status_id), 0)) FROM status_code))
  + ((SELECT IFNULL(AUTO_INCREMENT, 0) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'title_code')
      <= (SELECT GREATEST(11, IFNULL(MAX(title_id), 0)) FROM title_code)));

-- E8) 보호 행(구분 2, 상태 2)이 하나씩 있고 켜져 있다(4-b, 4-c).
SET @e_fixed := ((SELECT COUNT(*) FROM section_code WHERE section_id = 2 AND is_active = 1) <> 1)
              + ((SELECT COUNT(*) FROM status_code  WHERE status_id  = 2 AND is_active = 1) <> 1);

-- E7) 판번호
SET @e_ver := (SELECT COUNT(*) = 0 FROM cal_schema_meta WHERE k = 'schema_version' AND v = '13');

SELECT @e_orphan AS e1_orphan, @e_rows AS e2_rows, @e_proj_drift AS e3_project_drift, @e_user_drift AS e3_user_drift,
       @e_same AS e4_unchanged_bad, @e_struct AS e5_struct_bad, @e_ai AS e6_autoinc_bad, @e_ver AS e7_version_bad,
       @e_fixed AS e8_fixed_bad;

-- (정보) 동작이 묶인 고정 번호 행과 지금 라벨(4-b 가 없으면 멈췄고, E8 이 켜져 있는지 본다).
SELECT 'section_code 2' AS fixed_row, (SELECT name FROM section_code WHERE section_id = 2) AS name, '선진행 동작' AS bound
UNION ALL
SELECT 'status_code 2', (SELECT name FROM status_code WHERE status_id = 2), '종료 동작';

SET @g := IF(@e_orphan + @e_rows + @e_proj_drift + @e_user_drift + @e_same + @e_struct + @e_ai + @e_ver + @e_fixed = 0, 'DO 0',
             'SELECT 1 FROM `중단: 사후 검증 실패 - 위 e1~e8 을 볼 것. 백업으로 되돌린다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

DROP TEMPORARY TABLE IF EXISTS _cid_snap_project;
DROP TEMPORARY TABLE IF EXISTS _cid_snap_user;

SELECT '완료: 코드표 넷이 번호 키다(customer_id, section_id, status_id, title_id), schema_version 13' AS `결과`;

-- =====================================================================
--  7) 앱 계정의 안 쓰는 UPDATE 권한 회수(CODE-TABLE-IDS §8-3)
-- =====================================================================
--  호스트는 이 세 표를 DELETE 뒤 INSERT 로만 쓴다(widget/CalendarWriteDb.cs). grants-calendar.sql 에서 UPDATE 를 뺐고,
--  이미 받은 DB 에서도 거둔다(그래야 init-calendar 의 GRANT 대조가 맞는다). 권한이 없으면 아무것도 하지 않는다.
--  ※ 스키마 전환은 위에서 끝났다. 여기서 멈추면(관리자 권한 부족 등) 스키마는 v13 그대로이고 권한만 남는다.
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES
            WHERE GRANTEE = '''taskmgr_app''@''%''' AND TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'cal_entry_commit' AND PRIVILEGE_TYPE = 'UPDATE');
SET @s := IF(@c > 0, CONCAT('REVOKE UPDATE ON `', DATABASE(), '`.cal_entry_commit FROM ''taskmgr_app''@''%'''), 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES
            WHERE GRANTEE = '''taskmgr_app''@''%''' AND TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'cal_todo_day_note' AND PRIVILEGE_TYPE = 'UPDATE');
SET @s := IF(@c > 0, CONCAT('REVOKE UPDATE ON `', DATABASE(), '`.cal_todo_day_note FROM ''taskmgr_app''@''%'''), 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES
            WHERE GRANTEE = '''taskmgr_app''@''%''' AND TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'cal_room' AND PRIVILEGE_TYPE = 'UPDATE');
SET @s := IF(@c > 0, CONCAT('REVOKE UPDATE ON `', DATABASE(), '`.cal_room FROM ''taskmgr_app''@''%'''), 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SELECT TABLE_NAME, GROUP_CONCAT(PRIVILEGE_TYPE ORDER BY PRIVILEGE_TYPE) AS app_privileges
  FROM information_schema.TABLE_PRIVILEGES
 WHERE GRANTEE = '''taskmgr_app''@''%''' AND TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('cal_entry_commit','cal_todo_day_note','cal_room')
 GROUP BY TABLE_NAME;
