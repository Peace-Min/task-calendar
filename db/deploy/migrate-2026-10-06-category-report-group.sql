-- =====================================================================
--  migrate-2026-10-06-category-report-group.sql
--  cal_category 에 report_group 신설: 보고서 묶음(포함/기타)
--  schema_version 12 → 13
-- =====================================================================
--
--  【왜 필요한가】
--    지금은 '내 과제'에 등록한 과제가 전부 보고서에 과제 행으로 나간다. 사용자가 과제마다
--    보고서에서 어떻게 보일지 정한다(docs/REPORT-INCLUDE-STATE.md):
--      include = 보고서에 이 과제 행으로 나간다(기본, 지금과 같은 동작)
--      etc     = 이 과제의 업무와 공수가 보고서의 '기타' 행으로 합쳐진다
--    이 값은 어느 PC 에서든 같아야 하므로(과제의 성질) DB 에 둔다.
--    앱으로는 category.reportGroup('include'|'etc') 로 나간다(부팅 조회가 모든 과제에 항상 싣는다).
--
--  【적용】
--    mysql -u root -p --default-character-set=utf8mb4 taskcalendar < migrate-2026-10-06-category-report-group.sql
--
--    · 실행 전 백업 필수(db/deploy/backup-taskmgr.ps1 또는 mysqldump).
--    · **DB 를 먼저 올린다.** 새 위젯의 부팅 과제 조회가 c.report_group 을 SELECT 한다.
--      이 파일을 적용하지 않은 v12 DB 에 새 위젯이 붙으면 그 조회가 ERROR 1054 로 죽어
--      과제 목록이 통째로 빈다. 반대 방향(적용한 DB + 구버전 위젯)은 무해하다:
--      DEFAULT 'include' 가 구버전의 INSERT(컬럼 목록에 report_group 없음)를 메운다.
--      단 구버전 위젯으로 과제를 저장하면 그 과제의 기타 설정이 포함으로 되돌아갈 수 있다.
--    · **재실행 안전**하다(멱등). 컬럼과 CHECK 가 이미 있으면 조용히 지나가고 버전도 그대로다.
--    · 백필은 DEFAULT 가 한다. 기존 과제 행은 전부 'include' 가 되어 지금 동작이 바뀌지 않는다.
-- =====================================================================

SET NAMES utf8mb4;
SET SESSION lock_wait_timeout = 10;   -- 홀더가 있으면 기다리지 않고 ERROR 1205 로 즉시 멈춘다

-- ── 상태 탐지 ────────────────────────────────────────────────────────
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category'
                    AND COLUMN_NAME = 'report_group');
SET @has_chk := (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
                  WHERE CONSTRAINT_SCHEMA = DATABASE()
                    AND CONSTRAINT_NAME = 'chk_cal_category_rgroup');
SET @n_cat   := (SELECT COUNT(*) FROM cal_category);
SET @ver     := (SELECT v FROM cal_schema_meta WHERE k = 'schema_version');

SELECT CONCAT('상태: cal_category.report_group=', @has_col, '(', @n_cat, '행), ',
              'CHECK=', @has_chk, ', schema_version=', IFNULL(@ver, '(행 없음)')) AS `상태`;

-- ── 가드: 선행 마이그레이션 확인 ─────────────────────────────────────
--   12 에서만 연다. 이미 13 인 경우(재실행)는 통과시킨다(멱등).
--   ★ 중단 메시지는 식별자 64자 제한 안에 넣는다(넘기면 ERROR 1059 로 메시지가 잘린다).
SET @g := IF(@ver IN ('12','13'), 'DO 0',
             'SELECT 1 FROM `중단: schema_version 이 12/13 이 아니다 - 앞선 마이그레이션 먼저`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ── 1단계: report_group 컬럼 ─────────────────────────────────────────
--   ★ AFTER uses_repo: 재구축본(schema-calendar.sql)과 ORDINAL_POSITION 까지 일치시킨다.
--   ★ _bin + CHECK: 값 집합이 고정이라 'ETC' 같은 변형이 저장되지 않게 한다(source 와 같은 관례).
--   ★ DEFAULT 'include': 기존 행의 백필이자, 이 컬럼을 모르는 v12 위젯 INSERT 의 안전망이다.
SET @s := IF(@has_col = 1, 'DO 0',
             'ALTER TABLE cal_category ADD COLUMN report_group VARCHAR(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT ''include'' AFTER uses_repo');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ── 2단계: 값 집합 CHECK ─────────────────────────────────────────────
--   MySQL 의 CHECK 는 식이 NULL 이면 통과시킨다. 실제 방벽은 위 NOT NULL 과 함께다.
SET @s := IF(@has_chk = 1, 'DO 0',
             'ALTER TABLE cal_category ADD CONSTRAINT chk_cal_category_rgroup CHECK (report_group IN (''include'',''etc''))');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ── 3단계: schema_version 12 → 13 ────────────────────────────────────
--   조건절이 v='12' 라 재실행(이미 13)에서는 0행 갱신으로 조용히 지나간다 = 멱등.
UPDATE cal_schema_meta SET v = '13', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'schema_version' AND v = '12';

-- ── (E) 사후 검증: 사람이 읽는 출력 ──────────────────────────────────
SELECT CONCAT('  cal_category.report_group : ', COLUMN_TYPE, ' / NULL=', IS_NULLABLE,
              ' / 기본값=', IFNULL(COLUMN_DEFAULT, '~'), ' / 콜레이션=', IFNULL(COLLATION_NAME, '~'),
              ' / 위치=', ORDINAL_POSITION) AS `E1`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category' AND COLUMN_NAME = 'report_group';
SELECT CONCAT('  CHECK ', CONSTRAINT_NAME, ' : ', CHECK_CLAUSE) AS `E2`
  FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_cal_category_rgroup';
SELECT CONCAT('  schema_version = ', v) AS `E3` FROM cal_schema_meta WHERE k = 'schema_version';
SELECT CONCAT('  과제 행 ', COUNT(*), '개, include ', IFNULL(SUM(report_group = 'include'), 0),
              '개, etc ', IFNULL(SUM(report_group = 'etc'), 0), '개') AS `E4`
  FROM cal_category;

-- ── (E9) 차단형 사후 검증 ────────────────────────────────────────────
--   종료코드가 진실을 말하게 한다(`mysql < file && echo OK` 자동화가 실패를 보게).
--   타입, NULL 허용, 기본값, 콜레이션, 위치(uses_repo 바로 다음)까지 본다. 손으로 먼저 ALTER 해 둔
--   DB(예: NULL 허용, 맨 뒤에 붙인 것)가 조용히 통과하면 재구축본과 어긋난다.
--   ★ '기존 행 전부 include' 는 이번 실행이 컬럼을 새로 만들었을 때만 센다(@has_col = 0).
--     재실행 때는 사용자가 그 사이 정한 etc 가 정상 값이라 세면 안 된다.
SET @bad := (SELECT
    (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category' AND COLUMN_NAME = 'report_group'
        AND COLUMN_TYPE = 'varchar(8)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = 'include'
        AND COLLATION_NAME = 'utf8mb4_bin'
        AND ORDINAL_POSITION = (SELECT ORDINAL_POSITION + 1 FROM information_schema.COLUMNS
                                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category'
                                   AND COLUMN_NAME = 'uses_repo'))
  + (SELECT COUNT(*) = 0 FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_cal_category_rgroup')
  + (SELECT COUNT(*) = 0 FROM cal_schema_meta WHERE k = 'schema_version' AND v = '13')
  + (@has_col = 0 AND (SELECT COUNT(*) FROM cal_category WHERE report_group <> 'include') > 0));
SET @g := IF(@bad = 0, 'DO 0',
             'SELECT 1 FROM `중단: 사후 검증 실패 - 위 E1/E2/E3/E4 를 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT '완료: cal_category.report_group, CHECK, schema_version 13' AS `결과`;
