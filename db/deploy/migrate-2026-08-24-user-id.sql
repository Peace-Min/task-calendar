-- ============================================================================
--  마이그레이션 2026-08-24 — app_user PK: login_id → user_id (대리키 전환)
--    대상: 이미 login_id 를 PK 로 세워 놓고 운영 중인 기존 DB(실 taskmgr 가 그 상태다).
--    신규 구축은 이 파일이 아니라 taskmgr-company-data/01-schema-users.sql 이 한다
--    — 그 파일은 처음부터 user_id PK 로 만든다. 이 파일은 '이미 선 것'을 옮기는 1회용이다.
--
--  ★ 왜 옮기나 (요약. 근거는 01-schema-users.sql 헤더와 db/CALENDAR-TABLE-DESIGN.md §5.2)
--    login_id 는 netcus 가 소유한 외부 값이라 우리가 불변을 보장할 수 없는데, cal_* 참조가
--    다중경로라 ON UPDATE CASCADE 를 걸 수 없어 RESTRICT 로 갔다. 그 결과 개명이 영구히
--    불가능해지고(ERROR 1451), 퇴사자 ID 재발급이 오면 '전임자 행 재사용'이 유일한 조치가 되어
--    신입이 전임자 근태를 상속한다. 번호를 분리하면 개명·퇴임·재발급이 app_user 1행 조작으로 끝난다.
--
--  적용:  mysql -u root -p taskmgr < migrate-2026-08-24-user-id.sql
--    ※ --force 를 붙이지 말 것. 이 파일은 선행조건 위반 시 '에러로 멈추는' 방식으로 자신을
--      보호한다(순수 SQL 에는 IF/THEN 도 SIGNAL 도 없다 — 아래 ★가드 참조). --force 는 그 멈춤을
--      무력화한다.
--
--  ★ 순서: 이 파일 → (그 다음) deploy/schema-calendar.sql.
--    schema-calendar.sql 은 cal_* 를 user_id PK 로 재구축하며, 그 FK 타겟이 여기서 만드는
--    app_user.user_id 다. 반대로 돌리면 schema-calendar.sql 이 선행조건 가드에서 멈춘다.
--
--  ★★ 이 파일은 cal_* 의 데이터를 옮기지 않는다. app_user 의 키만 바꾼다.
--    cal_* 가 비어 있는 상태(실 taskmgr 현재: cal_user_rev 89행 외 전부 0행)를 전제로 한다.
--    cal_* 에 실데이터가 들어간 뒤라면 이 파일만으로는 부족하다 — login_id→user_id 치환
--    UPDATE 가 따로 필요하고, 그건 별도 마이그레이션이다.
--
--  무손실: app_user 의 행을 지우거나 값을 바꾸지 않는다. 컬럼 1개 추가 + 인덱스 재배치뿐이다.
--  멱등: 이미 user_id 가 있으면 세 ALTER 가 전부 no-op 이 된다(아래 각 단계의 조건 참조).
--    중단된 실행의 재개도 된다 — 각 단계가 '자기 결과가 이미 있는가'를 따로 본다.
-- ============================================================================
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
--  ★ 가드 방식에 대해 (이 파일과 schema-calendar.sql 이 같은 수법을 쓴다)
--    MySQL 은 스토어드 프로그램 밖에서 IF/THEN 도, SIGNAL 도 못 쓴다
--    (실측: PREPARE 로 SIGNAL 을 감싸면 ERROR 1295 'not supported in the prepared
--     statement protocol yet'). 그래서 조건부 실행은 information_schema 를 읽어
--    실행할 문장 자체를 문자열로 고르고 PREPARE/EXECUTE 하는 방법밖에 없다.
--    조건 불충족일 때는 '존재하지 않는 테이블명'을 SELECT 하는 문장을 골라 일부러 ERROR 1146 을
--    낸다 — 테이블명 자리에 사람이 읽을 메시지를 넣으면 그 메시지가 에러로 나온다(실측).
--    ※ 식별자는 64자 제한. ※ Windows(lower_case_table_names=1)에서는 ASCII 가 소문자로
--      바뀌어 출력된다 — 대소문자에 의미를 싣지 말 것.
-- ---------------------------------------------------------------------------

-- ---------- 0) 선행조건 A: app_user 가 있어야 한다 ----------
SET @has_app_user := (SELECT COUNT(*) FROM information_schema.TABLES
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user');
SET @g := IF(@has_app_user = 1, 'DO 0',
             'SELECT 1 FROM `중단: app_user 없음 — 01-schema-users.sql 을 먼저 돌릴 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 0) 선행조건 B: 아직 안 옮겼다면 PK 가 (login_id) 단일이어야 한다 ----------
--   여기서 막지 않으면, PK 가 전혀 다른 무엇인 DB 에서도 2단계가 그대로 돌아
--   그 PK 를 조용히 날려 버린다.
SET @has_user_id := (SELECT COUNT(*) FROM information_schema.COLUMNS
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                        AND COLUMN_NAME = 'user_id');
SET @pk_cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
                   FROM information_schema.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                    AND INDEX_NAME = 'PRIMARY');
SET @g := IF(@has_user_id = 1 OR @pk_cols = 'login_id', 'DO 0',
             'SELECT 1 FROM `중단: app_user PK 가 login_id 단일이 아니다 — 손으로 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 가드 3) ★★ 명부 대조 — 반드시 ALTER **앞**에서, 반드시 차단 ----------
--  왜 여기인가: 아래 ALTER 가 발급하는 번호는 '지금 이 표에 있는 login_id 목록'에 전적으로
--  달려 있다(사전순 1..N). 그런데 그 번호가 맞는지는 taskmgr-company-data/03-seed-users.sql 의
--  명시값과 같아야만 확인된다. 명부가 한 명이라도 다르면(입사·퇴사·ID 변경) 사전순이 밀려
--  **그 지점 뒤의 전원이 한 칸씩 어긋난다.**
--
--  ★ DDL 은 롤백이 없다. ALTER 를 돌린 뒤에 대조해서 'MISMATCH' 를 출력해 봐야 이미 번호가
--    박힌 뒤다. 그래서 대조를 앞으로 옮기고, 어긋나면 **여기서 멈춘다**(exit 0 으로 통과시키지 않는다).
--    이전 판(대조가 ALTER 뒤·비차단·exit 0)이 인수검증에서 치명으로 잡힌 자리다.
--
--  검사 방법: login_id 를 사전순으로 이어붙인 문자열의 SHA-256 을 시드 파일의 것과 비교한다.
--  ※ 89쌍을 이 파일에 복사하지 않는 이유: 명부가 두 곳에 생기고, 시드가 바뀌어도 여기가
--    안 바뀌면 이 파일이 조용히 거짓말을 하게 된다. 해시 한 줄이면 그 위험이 없다.
--  ※ 시드가 정당하게 바뀌면(입사·퇴사) 이 상수도 함께 갱신해야 한다. 갱신값 구하는 법:
--      SELECT SHA2(GROUP_CONCAT(login_id ORDER BY login_id SEPARATOR ','),256) FROM app_user;
--    단 갱신 전에 **번호가 밀리지 않는지** 먼저 확인할 것 — 밀린다면 해시만 고치는 것은
--    가드를 무력화하는 것이지 문제를 푸는 것이 아니다. 그때는 03 의 명시값을 새 사전순에
--    맞추거나, ALTER 대신 명시 UPDATE 로 번호를 박아야 한다.
SET @roster := (SELECT SHA2(GROUP_CONCAT(login_id ORDER BY login_id SEPARATOR ','), 256)
                  FROM app_user);
--  ↓ 2026-08-24 실측: 실 taskmgr 89명 · taskmgr-company-data/03-seed-users.sql 의 명부와 일치 확인
SET @roster_expected := '2fbc26fdd6cd4c4544e5e0dfa4769bd4b910052ed29e57a5d0e3537a0403e387';
SET @g := IF(@has_user_id = 1 OR @roster = @roster_expected, 'DO 0',
             'SELECT 1 FROM `중단: app_user 명부가 03-seed-users.sql 과 다르다 - 번호가 밀린다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 1) user_id 컬럼 신설 + 번호 발급 ----------
--  ★ 번호는 AUTO_INCREMENT 가 발급한다. 발급 순서는 '테이블 스캔 순서' = 클러스터드 인덱스
--    순서 = 현재 PK(login_id) 오름차순이다. 즉 login_id 사전순으로 1..N 이 붙는다.
--    ★★ 그 결과가 taskmgr-company-data/03-seed-users.sql 의 명시값과 **정확히 같아야** 한다.
--       (실측 2026-08-24: 실 taskmgr 89명 복제본(mysqldump 통째 복제)에 이 3문장을 돌린 뒤
--        시드 89쌍과 대조 — 89/89 완전 일치, 파일 끝 (2) 의 체크섬도 일치.)
--       어긋나면 그 사람의 캘린더가 남에게 붙는다. 반드시 파일 끝의 확인 쿼리를 돌릴 것.
--  ★ uq_tmp 가 왜 필요한가: AUTO_INCREMENT 컬럼은 어떤 인덱스의 선두여야 한다(없으면 ERROR 1075).
--    이 시점에 PK 는 아직 login_id 라 user_id 를 받쳐 줄 인덱스가 하나 필요하다. 임시다.
--  · 조건: user_id 컬럼이 아직 없을 때만. 있으면 no-op(재실행 안전).
SET @s := IF(@has_user_id = 0,
  'ALTER TABLE app_user ADD COLUMN user_id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST, ADD UNIQUE KEY uq_tmp (user_id)',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 2) PK 교체: login_id → user_id, login_id 는 UNIQUE 로 강등 ----------
--  ★ 이 문장은 cal_* 9개 FK 가 app_user(login_id) 를 참조하고 있는 상태에서도 통과한다.
--    (실측 2026-08-24, MySQL 8.4.9, foreign_key_checks=1 기본값:
--     fk_cal_attendance_user · fk_cal_category_user · fk_cal_entry_user ·
--     fk_cal_migration_log_user · fk_cal_room_user · fk_cal_task_hours_user ·
--     fk_cal_todo_user · fk_cal_user_pref_user · fk_cal_user_rev_user — 9개 전부 살아 있는 채로
--     통과했고, 문장 뒤에도 9개 그대로였다.)
--    이유: 같은 ALTER 안에서 login_id 를 받칠 UNIQUE 가 함께 서기 때문에, FK 가 요구하는
--    '참조 컬럼 위의 인덱스'가 한 순간도 사라지지 않는다. ADD UNIQUE KEY 를 빼고 DROP PRIMARY KEY
--    만 하면 그 자리에서 ERROR 1553 이 난다 — 세 조각을 한 문장에 묶어 둔 것이 요점이다. 쪼개지 말 것.
--  · 조건: PK 가 아직 user_id 가 아닐 때만.
SET @pk_is_user_id := (SELECT COUNT(*) FROM information_schema.STATISTICS
                        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                          AND INDEX_NAME = 'PRIMARY' AND COLUMN_NAME = 'user_id');
SET @s := IF(@pk_is_user_id = 0,
  'ALTER TABLE app_user DROP PRIMARY KEY, ADD PRIMARY KEY (user_id), ADD UNIQUE KEY uq_app_user_login_id (login_id)',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 3) 임시 인덱스 회수 ----------
--  ★ 이 문장을 빼면 PRIMARY 와 **완전히 중복**인 UNIQUE 인덱스가 영구히 남는다.
--    (실측 2026-08-24, 2단계 직후 information_schema.STATISTICS —
--       PRIMARY               SEQ_IN_INDEX=1  COLUMN_NAME=user_id   NON_UNIQUE=0
--       uq_tmp                SEQ_IN_INDEX=1  COLUMN_NAME=user_id   NON_UNIQUE=0
--       uq_app_user_login_id  SEQ_IN_INDEX=1  COLUMN_NAME=login_id  NON_UNIQUE=0
--     PRIMARY 와 uq_tmp 가 컬럼·순서·유일성까지 같다. 3단계 뒤 uq_tmp 만 사라지고 나머지는 그대로.)
--    남겨 두면 INSERT/UPDATE 마다 같은 검사를 두 번 하고, 나중에 이 표를 읽는 사람이
--    '왜 UNIQUE 가 두 개지' 하고 잘못된 결론을 낸다. 신규 구축(01-schema-users.sql)이 만드는
--    스키마와도 달라져 두 경로가 만든 DB 를 비교할 수 없게 된다.
--  · 조건: uq_tmp 가 남아 있을 때만(중단된 실행의 뒤처리도 겸한다).
SET @has_uq_tmp := (SELECT COUNT(*) FROM information_schema.STATISTICS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                       AND INDEX_NAME = 'uq_tmp');
SET @s := IF(@has_uq_tmp > 0, 'ALTER TABLE app_user DROP INDEX uq_tmp', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ============================================================================
--  확인 — 반드시 돌릴 것. 특히 (2) 는 사람과 번호의 짝이 시드와 같은지를 본다.
-- ============================================================================

-- (1) 구조: PK=user_id, login_id 는 UNIQUE, uq_tmp 없음.
--     기대: PRIMARY/1/user_id/0 · uq_app_user_login_id/1/login_id/0 · (uq_tmp 행 없음)
SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
 ORDER BY INDEX_NAME, SEQ_IN_INDEX;

-- (1b) 타입: cal_* 의 user_id 와 **정확히 같아야** FK 가 선다. 기대: smallint unsigned
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'user_id';

-- (2) ★★ 번호 일치 대조 — taskmgr-company-data/03-seed-users.sql 의 명시값과 같은가.
--     체크섬 방식인 이유: 89쌍을 이 파일에 복사해 두면 실명 명단이 두 곳에 생기고, 시드가
--     바뀌어도 여기가 안 바뀌어 조용히 거짓말을 하게 된다. 해시 한 줄이면 그럴 수 없다.
--     ※ 이 상수는 2026-08-24 시점 03-seed-users.sql 의 89쌍(user_id:login_id)으로 계산했다.
--       시드에 사람이 추가되면 이 상수도 함께 갱신할 것 —
--       재계산: 03-seed-users.sql 을 적재한 DB 에서 아래 SELECT 의 SHA2(...) 부분을 그대로 돌린 값.
--     기대: seed_match = MATCH, n_rows = n_distinct = 89, n_null = 0, min=1, max=89
SET SESSION group_concat_max_len = 65535;
SELECT
    IF(SHA2(GROUP_CONCAT(CONCAT(user_id, ':', login_id) ORDER BY user_id SEPARATOR ','), 256)
       = 'ccdc75791f2df1fd9fc0f28e31302eb22a4a43da2d88a9b0785be5f68c740000',
       'MATCH', 'MISMATCH — 중단하고 사람에게 보고할 것') AS seed_match,
    COUNT(*)                AS n_rows,
    COUNT(DISTINCT user_id) AS n_distinct,
    SUM(user_id IS NULL)    AS n_null,
    MIN(user_id)            AS min_id,
    MAX(user_id)            AS max_id
  FROM app_user;

-- (3) 발급 규칙 자체의 검증 — 시드를 모르는 DB(사람이 늘어난 뒤 포함)에서도 쓸 수 있는 형태.
--     '번호가 login_id 오름차순 1..N 인가'를 본다. 기대: 0
SELECT COUNT(*) AS rank_mismatch
  FROM (SELECT user_id, ROW_NUMBER() OVER (ORDER BY login_id) AS expect_no FROM app_user) t
 WHERE t.user_id <> t.expect_no;

-- (4) cal_* FK 가 살아 있는지(이 마이그레이션은 FK 를 건드리지 않는다). 기대: 9
--     ※ 이 9개는 아직 login_id 를 참조한다. user_id 참조로 바꾸는 것은 schema-calendar.sql 의 일이다.
SELECT COUNT(*) AS fk_to_app_user
  FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'app_user';
