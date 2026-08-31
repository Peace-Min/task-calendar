-- =====================================================================
--  migrate-2026-08-27-sort-order.sql
--  cal_entry · cal_todo 에 sort_order 신설 — 배열(=문서) 순서를 박제한다
--  schema_version 3 → 4
-- =====================================================================
--
--  【왜 필요한가】
--    앱의 state.entries · state.todos 는 **배열**이고 그 순서가 곧 사용자가 보던 순서다.
--    DB 는 행 집합이라 순서 개념이 없으므로, 읽을 때 ORDER BY 로 되살려야 한다.
--    그런데 되살릴 근거가 created_at 뿐이었고 **동률이 압도적**이다 — 실 data.xml 직접 계측:
--
--      · 일정 23건 중 **22건**이 같은 밀리초(2026-06-23T04:45:32.051Z)
--      · (entry_date, created_at) 쌍으로 묶어도 동률 그룹 2개 — 2026-06-22 x3 · 2026-06-23 x2
--        문서 순서 [wk3, e22a, e22b] 가 보조정렬로는 [e22a, e22b, wk3] 로 뒤바뀐다
--      · 할 일 7건 중 **5건**이 같은 밀리초
--      · 할 일은 1차 정렬축이 될 due 가 NULL(기한 없음)이 **정상 상태**라 복원 수단이 아예 없다
--
--    즉 sort_order 가 없으면 **이관 순간 순서가 영구 소실**된다.
--    §5.3 이 cal_category 에 sort_order 를 둔 근거가 정확히 같은 상황이었다
--    ("created_at 이 대부분 같은 밀리초(37개 중 33개)라 대체 불가").
--    cal_room 도 이미 갖고 있다. cal_entry · cal_todo 만 없었다.
--
--  【이 결함이 왜 늦게 발견됐나 — 기록해 둔다】
--    tests/calendar-adapter.mjs 의 compareDeep 이 대조 직전에 배열을 id 키 **객체로 접어**
--    순서를 비교 대상에서 통째로 뺐다. 그래서 "차이 0건"이 나왔다.
--    통과하는 테스트가 통과 못 하는 테스트보다 위험한 사례다. 게이트를 먼저 고쳐
--    결함을 드러낸 뒤 이 파일을 만들었다(그 순서를 지킬 것).
--
--  【적용】
--    mysql -u root -p --default-character-set=utf8mb4 taskmgr < migrate-2026-08-27-sort-order.sql
--
--    · 실행 전 백업 필수 — db/deploy/backup-taskmgr.ps1 또는 mysqldump.
--      (이번 변경 자체는 0행 대상이라 무해하지만, 규칙은 규칙이다)
--    · **재실행 안전**하다(멱등). 이미 컬럼이 있으면 조용히 통과한다.
--    · 두 표에 데이터가 있으면 **중단**한다 — 이 파일은 백필을 하지 않는다.
--      데이터가 있는 DB 에서는 XML→DB 이관 도구가 sort_order 를 함께 채워야 한다(아래 ★).
--
--  ★★ 이관 도구에 남기는 계약 — 이걸 어기면 이 파일을 만든 의미가 없다
--    이관은 sort_order 를 **XML 문서 순서(0부터 오름차순)** 로 채워야 한다.
--    DEFAULT 0 에 맡기면 전 행이 0 이 되어 ORDER BY 가 무의미해지고, 그 순간 순서가 소실된다.
--    쓰기 계층은 새 항목에 **그 사용자 안의 MAX(sort_order)+1** 을 준다
--    (앱이 state.entries.push(e) 로 뒤에 붙이므로 그것과 같은 뜻이다).
--    발번은 §3.1 의 rev 락 안에서 한다 — <표>_no 발번과 같은 자리다.
-- =====================================================================

SET NAMES utf8mb4;
SET SESSION lock_wait_timeout = 10;   -- 홀더가 있으면 1년을 기다리지 않고 ERROR 1205 로 즉시 멈춘다

-- ── 상태 탐지 ────────────────────────────────────────────────────────
SET @has_entry_sort := (SELECT COUNT(*) FROM information_schema.COLUMNS
                         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_entry'
                           AND COLUMN_NAME = 'sort_order');
SET @has_todo_sort  := (SELECT COUNT(*) FROM information_schema.COLUMNS
                         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_todo'
                           AND COLUMN_NAME = 'sort_order');
SET @n_entry := (SELECT COUNT(*) FROM cal_entry);
SET @n_todo  := (SELECT COUNT(*) FROM cal_todo);

SELECT CONCAT('상태 — cal_entry.sort_order=', @has_entry_sort, '(', @n_entry, '행) · ',
              'cal_todo.sort_order=', @has_todo_sort, '(', @n_todo, '행)') AS `상태`;

-- ── 가드 1: 데이터가 있는데 컬럼이 없으면 중단 ───────────────────────
--   ★ 아래 식별자를 64자 이내로 유지할 것 — MySQL 식별자 한도다. 넘으면 의도한
--     ERROR 1146(전체 문구)이 아니라 ERROR 1059 'Identifier name … is too long' 이 떠서
--     차단은 되지만 **사람이 이유를 읽을 수 없다**(2026-08-27 실측: 68자였다).
--   이 파일은 백필을 하지 않는다. DEFAULT 0 으로 채우면 순서가 그 자리에서 소실되므로,
--   '조용히 0 으로 채우는 것'보다 '멈추는 것'이 낫다(§5.3 이 경고한 그것).
SET @g := IF((@has_entry_sort = 1 OR @n_entry = 0) AND (@has_todo_sort = 1 OR @n_todo = 0),
             'DO 0',
             'SELECT 1 FROM `중단: cal_entry/cal_todo 에 데이터가 있다 - 이관이 sort_order 를 채울 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ── 1단계: cal_entry.sort_order ──────────────────────────────────────
--   ★ AFTER 를 지정해야 DDL 재구축본(schema-calendar.sql)과 ORDINAL_POSITION 까지 일치한다.
--     안 주면 맨 뒤에 붙어 information_schema 전수 대조가 깨진다.
SET @s := IF(@has_entry_sort = 1, 'DO 0',
             'ALTER TABLE cal_entry ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER recur_count');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ── 2단계: cal_todo.sort_order ───────────────────────────────────────
SET @s := IF(@has_todo_sort = 1, 'DO 0',
             'ALTER TABLE cal_todo ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER completed_at');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ── 3단계: schema_version 3 → 4 ──────────────────────────────────────
--   schema-calendar.sql 이 못박은 규칙: "구조를 바꾸는 migrate-*.sql 은 반드시 이 값을 함께
--   올려야 한다(올리지 않으면 게이트가 죽은 문자가 된다)". 구버전 클라이언트가 붙었을 때
--   파괴적 연산이 먼저 막히는 것이 그 게이트의 목적이다.
--   ※ 이번 변경은 컬럼 추가라 구버전의 SELECT 가 깨지지는 않는다. 그래도 올리는 이유는 같다 —
--     올리지 않으면 그 게이트가 '어떤 변경에도 안 움직이는 숫자'가 되어 죽는다.
UPDATE cal_schema_meta SET v = '4', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'schema_version' AND v = '3';
INSERT INTO cal_schema_meta (k, v, updated_at)
SELECT 'schema_version', '4', UTC_TIMESTAMP(3)
 WHERE NOT EXISTS (SELECT 1 FROM (SELECT k FROM cal_schema_meta WHERE k = 'schema_version') x);

-- ── (E) 사후 검증 — 사람이 읽는 출력 ─────────────────────────────────
SELECT CONCAT('  cal_entry.sort_order : ', COLUMN_TYPE, ' / NULL=', IS_NULLABLE,
              ' / 기본값=', IFNULL(COLUMN_DEFAULT, '~'), ' / 위치=', ORDINAL_POSITION) AS `E1`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_entry' AND COLUMN_NAME = 'sort_order';
SELECT CONCAT('  cal_todo.sort_order  : ', COLUMN_TYPE, ' / NULL=', IS_NULLABLE,
              ' / 기본값=', IFNULL(COLUMN_DEFAULT, '~'), ' / 위치=', ORDINAL_POSITION) AS `E2`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_todo' AND COLUMN_NAME = 'sort_order';
SELECT CONCAT('  schema_version = ', v) AS `E3` FROM cal_schema_meta WHERE k = 'schema_version';

-- ── (E9) 차단형 사후 검증 ────────────────────────────────────────────
--   사람이 읽는 출력만 두면 `mysql < file && echo OK` 형태의 자동화가 실패를 못 본다.
--   종료코드가 진실을 말하게 한다.
SET @bad := (SELECT
    (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_entry' AND COLUMN_NAME = 'sort_order')
  + (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_todo'  AND COLUMN_NAME = 'sort_order')
  + (SELECT COUNT(*) = 0 FROM cal_schema_meta WHERE k = 'schema_version' AND v = '4'));
SET @g := IF(@bad = 0, 'DO 0',
             'SELECT 1 FROM `중단: 사후 검증 실패 - 위 E1/E2/E3 을 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT '완료 — sort_order 2컬럼 · schema_version 4' AS `결과`;
