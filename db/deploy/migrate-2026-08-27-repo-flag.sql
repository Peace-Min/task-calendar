-- =====================================================================
--  migrate-2026-08-27-repo-flag.sql
--  cal_category 에 uses_repo 신설 — '저장소를 쓰는 과제' 한 비트(설계 §4)
--  schema_version 4 → 5
-- =====================================================================
--
--  【왜 필요한가】
--    저장소 경로(gitRepo·svnRepo)는 **DB 로 올리지 않는다.** 캘린더 데이터 12부류 중 유일한
--    예외이고, 근거는 §4 그대로다 — PC 마다 달라야 하는 값이라 올리면 A자리의 'D:\repos\report'
--    가 B자리까지 따라와 커밋 수집이 조용히 실패한다. 더 나쁜 경우는 **경로는 유효한데 다른
--    저장소**인 자리다. 그러면 실패조차 안 하고 **남의 커밋이 내 보고서에 실린다.**
--    → 경로의 보관처는 %APPDATA%\TaskCalendar\repo-paths.json (과제 uid 를 키로 하는 맵).
--
--    그런데 경로를 안 올리는 것만으로는 화면이 성립하지 않는다. 지금 기록 모달은 저장소가 없으면
--    「연동」 섹션 자체를 숨긴다(updateGitRow() 의 sect.classList.toggle('hidden', !show)).
--    일정이 DB 로 올라가면 **"A자리에서 보이던 커밋이 B자리에서 사라지는" 것이 일상**이 되는데,
--    화면은 그 이유를 한 마디도 하지 않는다. 그 자리에 안내를 띄우려면 앱이
--      *"이 PC 에 경로가 없다"*  와  *"저장소를 안 쓰는 과제다"*
--    를 갈라야 하고, 지금은 둘 다 gitRepo='' · svnRepo='' 라 **모양이 같다.**
--    그 한 비트가 없으면 안내는 **모든 과제에 뜨거나 아무 데도 안 뜬다** — 둘 다 안내가 아니다.
--
--    ★ 올리는 것은 비트 하나뿐이다. **경로 문자열은 여전히 올리지 않는다.**
--      "쓴다/안 쓴다"는 **과제의 성질**이고, "이 PC 에 경로가 있나"는 **PC 의 성질**이다.
--      전자는 DB, 후자는 repo-paths.json. 이 줄이 흐려지면 §4 의 사고가 그대로 돌아온다.
--
--  【적용】
--    mysql -u root -p --default-character-set=utf8mb4 taskmgr < migrate-2026-08-27-repo-flag.sql
--
--    · 실행 전 백업 필수 — db/deploy/backup-taskmgr.ps1 또는 mysqldump.
--      (이번 변경 자체는 0행 대상이라 무해하지만, 규칙은 규칙이다)
--    · **재실행 안전**하다(멱등). 이미 컬럼이 있으면 조용히 통과한다.
--    · **순서** — 같은 날짜의 migrate-2026-08-27-sort-order.sql(3→4)을 **먼저** 적용해야 한다.
--      파일 이름은 알파벳순으로 repo-flag 가 앞이라 거꾸로 읽히기 쉽다. 순서를 강제하는 것은
--      이름이 아니라 아래 schema_version 가드다(v='4' 일 때만 5 로 올린다).
--    · cal_category 에 데이터가 있으면 **중단**한다 — 이 파일은 백필을 하지 않는다.
--      데이터가 있는 DB 에서는 XML→DB 이관 도구가 uses_repo 를 함께 채워야 한다(아래 ★).
--
--  ★★ 이관 도구에 남기는 계약 — 이걸 어기면 이 파일을 만든 의미가 없다
--    ① uses_repo = (그 <category> 에 gitRepo 또는 svnRepo 가 있고 빈 문자열이 아니면 1, 아니면 0).
--       **행마다 계산**한다. DEFAULT 0 에 맡기면 전 행이 0 이 되어 §4 의 안내가 아무 데도 안 뜨고,
--       반대로 1 로 백필하면 **모든 과제에 뜬다.** 둘 다 이 컬럼을 만든 의미를 지운다.
--       ※ 이관 시점에 존재하는 증거는 그것 하나뿐이다 — 이관은 한 PC 의 data.xml 하나를 본다.
--    ② 같은 이관이 **repo-paths.json 도 함께 만든다.** 경로 문자열은 DB 로 가지 않으므로,
--       이관이 그것을 로컬로 옮기지 않으면 그 PC 는 이관 직후 자기가 갖고 있던 경로를 잃는다.
--       그러면 uses_repo=1 만 남아 **방금 이관한 그 PC 에서 곧바로 안내가 뜬다.**
--    ③ 런타임: 경로를 **처음 지정할 때** 1 로 올린다(로컬 쓰기 성공 → 그 다음 DB).
--       순서를 뒤집으면 경로 없이 비트만 서서, 방금 경로를 지정한 사람에게 안내가 뜬다.
--    ④ **자동으로 0 으로 내리지 않는다.** '이 PC 에서 경로를 지웠다'는 '이 과제가 저장소를
--       그만 쓴다'가 아니고, 다른 자리의 경로 유무를 DB 는 알 방법이 없다(경로도, PC별 유무도
--       올리지 않으므로). 거짓 양성은 **보이고 설명되는 한 줄**로 끝나지만, 거짓 음성은
--       「연동」 섹션이 **다시 통째로 사라지는 것** — 즉 §4 가 없애려던 그 상태다. 비대칭이므로
--       **한 번 켜지면 끄지 않는다.** 끄는 유일한 경로는 사람이 [과제 관리]에서 명시적으로
--       *"이 과제는 저장소를 쓰지 않습니다"* 라고 진술하는 것이다.
--    정본은 schema-calendar.sql 헤더의 **I 부류**(I-1~I-5)다. 여기 요약은 그 사본이다.
--
--  ※ 읽기 계약: 앱으로는 category.usesRepo(boolean)로 나간다(계약 G-6·G-0).
--    fromXML() 은 그 키를 만들지 않으므로 대조 게이트가 기준 쪽을 정규화한다 — 규칙은 위 ①과 같다.
-- =====================================================================

SET NAMES utf8mb4;
SET SESSION lock_wait_timeout = 10;   -- 홀더가 있으면 1년을 기다리지 않고 ERROR 1205 로 즉시 멈춘다

-- ── 상태 탐지 ────────────────────────────────────────────────────────
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category'
                    AND COLUMN_NAME = 'uses_repo');
SET @has_chk := (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
                  WHERE CONSTRAINT_SCHEMA = DATABASE()
                    AND CONSTRAINT_NAME = 'chk_cal_category_usesrepo01');
SET @n_cat   := (SELECT COUNT(*) FROM cal_category);
SET @ver     := (SELECT v FROM cal_schema_meta WHERE k = 'schema_version');

SELECT CONCAT('상태 — cal_category.uses_repo=', @has_col, '(', @n_cat, '행) · ',
              'CHECK=', @has_chk, ' · schema_version=', IFNULL(@ver, '(행 없음)')) AS `상태`;

-- ── 가드 1: 선행 마이그레이션 확인 ───────────────────────────────────
--   sort-order(3→4)가 안 들어간 DB 에 이걸 먼저 넣으면 버전 행이 4 에 머무는데 컬럼은 5의 것이 된다.
--   그 상태는 '어떤 배포본인지' 를 아무도 말할 수 없는 상태라, 조용히 진행하지 않고 멈춘다.
--   ※ 이미 5 인 경우(재실행)는 통과시킨다 — 이 파일은 멱등이어야 한다.
--   ★ 중단 메시지는 **식별자 64자 제한** 안에 넣는다. 넘기면 MySQL 이 우리 문장 대신
--     ERROR 1059(Identifier name … is too long)를 내고 **메시지가 잘린 채로 뜬다**.
--     막히기는 하지만 사람이 읽는 이유가 사라지므로, 길면 짧게 쓴다(실측으로 확인한 함정 —
--     migrate-2026-08-27-sort-order.sql 의 데이터 가드가 68자라 실제로 그 상태다).
SET @g := IF(@ver IN ('4','5'), 'DO 0',
             'SELECT 1 FROM `중단: sort-order(3→4) 를 먼저 적용할 것 - schema_version 이 4/5 아님`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ── 가드 2: 데이터가 있는데 컬럼이 없으면 중단 ───────────────────────
--   이 파일은 백필을 하지 않는다. DEFAULT 0 이 조용히 먹으면 §4 의 안내가 **아무 데도 안 뜨고**,
--   그 실패는 화면에 아무 흔적을 남기지 않는다(원래도 섹션이 숨겨져 있었으므로 '전과 같아 보인다').
--   '조용히 0 으로 채우는 것'보다 '멈추는 것'이 낫다 — sort-order 판과 같은 판정이다.
SET @g := IF(@has_col = 1 OR @n_cat = 0, 'DO 0',
             'SELECT 1 FROM `중단: cal_category 에 데이터가 있다 - 이관이 uses_repo 를 채울 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ── 1단계: uses_repo 컬럼 ────────────────────────────────────────────
--   ★ AFTER 를 지정해야 DDL 재구축본(schema-calendar.sql)과 ORDINAL_POSITION 까지 일치한다.
--     안 주면 맨 뒤에 붙어 information_schema 전수 대조가 깨진다.
--   ★ 위치를 project_uid 뒤로 잡은 이유: sort_order·created_at·updated_at 은 표 공통의 꼬리
--     메타 컬럼이고, uses_repo 는 과제 자체의 성질이라 내용 컬럼 무리에 붙는다.
SET @s := IF(@has_col = 1, 'DO 0',
             'ALTER TABLE cal_category ADD COLUMN uses_repo TINYINT(1) NOT NULL DEFAULT 0 AFTER project_uid');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ── 2단계: 값 집합 CHECK ─────────────────────────────────────────────
--   cal_entry.all_day(chk_cal_entry_allday01) · cal_todo.done(chk_cal_todo_done01) 과 같은 관례다.
--   ※ CHECK 만으로는 못 막는다 — MySQL 의 CHECK 는 식이 NULL 이면 통과시킨다. 실제 방벽은
--     위 NOT NULL 이고, 이 CHECK 는 2·-1 같은 값을 3819 로 시끄럽게 거부하는 몫이다(§5.1 ★).
SET @s := IF(@has_chk = 1, 'DO 0',
             'ALTER TABLE cal_category ADD CONSTRAINT chk_cal_category_usesrepo01 CHECK (uses_repo IN (0,1))');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ── 3단계: schema_version 4 → 5 ──────────────────────────────────────
--   schema-calendar.sql 이 못박은 규칙: "구조를 바꾸는 migrate-*.sql 은 반드시 이 값을 함께
--   올려야 한다(올리지 않으면 게이트가 죽은 문자가 된다)". 구버전 클라이언트가 붙었을 때
--   파괴적 연산이 먼저 막히는 것이 그 게이트의 목적이다.
--   ※ 이번 변경은 컬럼 추가라 구버전의 SELECT 가 깨지지는 않는다. 그래도 올리는 이유는 같다 —
--     올리지 않으면 그 게이트가 '어떤 변경에도 안 움직이는 숫자'가 되어 죽는다.
--   ★ 조건절이 v='4' 라 재실행(이미 5)에서는 0행 갱신으로 조용히 지나간다 = 멱등.
UPDATE cal_schema_meta SET v = '5', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'schema_version' AND v = '4';
INSERT INTO cal_schema_meta (k, v, updated_at)
SELECT 'schema_version', '5', UTC_TIMESTAMP(3)
 WHERE NOT EXISTS (SELECT 1 FROM (SELECT k FROM cal_schema_meta WHERE k = 'schema_version') x);

-- ── (E) 사후 검증 — 사람이 읽는 출력 ─────────────────────────────────
SELECT CONCAT('  cal_category.uses_repo : ', COLUMN_TYPE, ' / NULL=', IS_NULLABLE,
              ' / 기본값=', IFNULL(COLUMN_DEFAULT, '~'), ' / 위치=', ORDINAL_POSITION) AS `E1`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category' AND COLUMN_NAME = 'uses_repo';
SELECT CONCAT('  CHECK ', CONSTRAINT_NAME, ' : ', CHECK_CLAUSE) AS `E2`
  FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_cal_category_usesrepo01';
SELECT CONCAT('  schema_version = ', v) AS `E3` FROM cal_schema_meta WHERE k = 'schema_version';
-- ★ 경로 컬럼이 딸려 들어오지 않았는지 — 이 마이그레이션의 **금지 사항**을 직접 센다(§4).
SELECT CONCAT('  cal_* 의 경로성 컬럼 = ', COUNT(*), '개(0 이어야 한다)') AS `E4`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'cal\\_%'
   AND (COLUMN_NAME LIKE '%repo\\_path%' OR COLUMN_NAME IN ('git_repo','svn_repo','repo_path'));

-- ── (E9) 차단형 사후 검증 ────────────────────────────────────────────
--   사람이 읽는 출력만 두면 `mysql < file && echo OK` 형태의 자동화가 실패를 못 본다.
--   종료코드가 진실을 말하게 한다.
--   ★ 여기서 '컬럼이 있다'만 세지 않는다. 타입·NULL 허용·기본값·위치까지 본다 —
--     손으로 먼저 ALTER 해 둔 DB(예: INT NULL, 또는 맨 뒤에 붙인 것)가 조용히 통과하면
--     재구축본과 information_schema 가 어긋나고, 그 어긋남은 다음 배포까지 안 보인다.
SET @bad := (SELECT
    (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category' AND COLUMN_NAME = 'uses_repo'
        AND COLUMN_TYPE = 'tinyint(1)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = '0'
        AND ORDINAL_POSITION = (SELECT ORDINAL_POSITION + 1 FROM information_schema.COLUMNS
                                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category'
                                   AND COLUMN_NAME = 'project_uid'))
  + (SELECT COUNT(*) = 0 FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_cal_category_usesrepo01')
  + (SELECT COUNT(*) = 0 FROM cal_schema_meta WHERE k = 'schema_version' AND v = '5')
  + (SELECT COUNT(*) <> 0 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'cal\\_%'
        AND (COLUMN_NAME LIKE '%repo\\_path%' OR COLUMN_NAME IN ('git_repo','svn_repo','repo_path'))));
SET @g := IF(@bad = 0, 'DO 0',
             'SELECT 1 FROM `중단: 사후 검증 실패 - 위 E1/E2/E3/E4 를 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT '완료 — cal_category.uses_repo · CHECK · schema_version 5' AS `결과`;
