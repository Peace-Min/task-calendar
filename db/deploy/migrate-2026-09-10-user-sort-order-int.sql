-- =====================================================================
--  migrate-2026-09-10-user-sort-order-int.sql
--  app_user.sort_order 를 SMALLINT UNSIGNED → INT UNSIGNED 로 넓힌다
--  schema_version 11 → 12
-- =====================================================================
--
--  【왜 넓히는가 — 2026-09-10 부하 실측】
--    순서 저장은 전원을 10·20·30… 으로 전량 재작성한다(ProjectDb.SaveUserOrderAsync). 간격은 소모되지
--    않으므로 "사이값이 꽉 차는" 시점은 오지 않는다. 대신 컬럼 타입이 천장이었다:
--      SMALLINT UNSIGNED 최댓값 65,535 ÷ 10 = 6,553명. 6,554번째부터 값이 65,540 이 되어
--      ERROR 1264(Out of range) 로 트랜잭션 전체가 롤백된다 — 격리 DB 실측(rvS): 6,553명 정상(923ms),
--      6,554명 실패·0행 변경. 데이터는 안 깨지지만 그 규모에서 순서 저장이 통째로 불가능해진다.
--    INT UNSIGNED 면 4,294,967,295 ÷ 10 ≈ 4억 명 — 사실상 천장이 없다. 20,000명 재작성 실측 2.7초.
--    지금 89명이라 급하지 않지만, 배포 전에 넓히는 것이 가장 싸다(행 값은 그대로, 타입만 바뀐다).
--
--  【무엇이 바뀌나】
--    app_user.sort_order 의 타입만. 값·위치(title 뒤)·NULL 허용·기본값 NULL 은 그대로.
--    호스트는 int 로 다루므로(2^31) 코드 변경 없음. 위젯 CalendarDb.ExpectedSchemaVersion 을 12 로 올린다.
--
--  【재실행】
--    안전하지 않다 — 아래 가드가 schema_version = '11' 일 때만 진행한다. MODIFY 자체는 두 번 돌아도
--    같은 결과지만, 판번호가 두 번 오르면 정본과 어긋나므로 가드로 막는다.
--
--  【적용】
--    set MYSQL_PWD=...
--    mysql -uroot --default-character-set=utf8mb4 taskmgr < migrate-2026-09-10-user-sort-order-int.sql
--    · 실행 전 백업 — db/deploy/backup-taskmgr.ps1 (또는 mysqldump)
--    · 위젯 v0.19.0(ExpectedSchemaVersion 12)과 같은 창에 배포할 것. 어느 한쪽만 나가면 불일치.
--    · 비공개 저장소 01-schema-users.sql 도 INT UNSIGNED 로 바뀌었다(신규 구축 경로).
-- =====================================================================

SET NAMES utf8mb4;
SET SESSION lock_wait_timeout = 10;
SET SESSION time_zone = '+00:00';

-- ── 0. 선행조건 가드 — v11 에서만 진행한다 ────────────────────────────
SET @v := (SELECT v FROM cal_schema_meta WHERE k = 'schema_version');
SET @g := IF(@v = '11', 'DO 0',
             'SELECT 1 FROM `중단: schema_version 이 11 이 아니다 - 이미 적용됐거나 앞선 마이그레이션이 빠졌다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 컬럼이 실재하는지 — 없으면 앞선 마이그레이션(user-sort-order)이 빠진 것이다.
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'sort_order');
SET @g := IF(@has = 1, 'DO 0',
             'SELECT 1 FROM `중단: app_user.sort_order 가 없다 - migrate-2026-09-10-user-sort-order.sql 을 먼저 적용할 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ── 1. 타입 확장 — 값·위치·NULL 허용은 그대로 ─────────────────────────
ALTER TABLE app_user MODIFY sort_order INT UNSIGNED NULL DEFAULT NULL;

-- ── 2. 판번호 ────────────────────────────────────────────────────────
UPDATE cal_schema_meta SET v = '12', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'schema_version' AND v = '11';

-- ── 3. 사후 검증 ─────────────────────────────────────────────────────
SELECT CONCAT('  app_user.sort_order : ', COLUMN_TYPE, ' · NULL허용=', IS_NULLABLE,
              ' · 위치=', ORDINAL_POSITION, ' (int unsigned · YES · title 다음이어야 한다)') AS `E1`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'sort_order';
SELECT CONCAT('  값 보존: 활성 ', COUNT(*), '명 · sort_order NULL ', SUM(sort_order IS NULL), '명 · 최댓값 ', IFNULL(MAX(sort_order), 'NULL')) AS `E2`
  FROM app_user WHERE is_active = 1;
SELECT CONCAT('  schema_version = ', v) AS `E3` FROM cal_schema_meta WHERE k = 'schema_version';

SET @bad := (SELECT
    (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'sort_order'
        AND DATA_TYPE = 'int' AND COLUMN_TYPE LIKE '%unsigned%' AND IS_NULLABLE = 'YES')
  + (SELECT COUNT(*) = 0 FROM cal_schema_meta WHERE k = 'schema_version' AND v = '12'));
SET @g := IF(@bad = 0, 'DO 0', 'SELECT 1 FROM `중단: 사후 검증 실패 - 위 E1~E3 를 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT '완료 — app_user.sort_order INT UNSIGNED · schema_version 12' AS `결과`;
