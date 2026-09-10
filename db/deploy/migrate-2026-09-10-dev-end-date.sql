-- =====================================================================
--  migrate-2026-09-10-dev-end-date.sql
--  과제 마스터(project)에 개발종료일(dev_end_date) 신설
--  schema_version 9 → 10
-- =====================================================================
--
--  【왜 계약종료일로는 안 되는가 — 실무 요구】
--    end_date 는 **계약**이 끝나는 날이다. 그런데 사업부가 실제로 관리하는 날짜는 하나 더 있다 —
--    **개발이 끝나는(끝나야 하는) 날**. 둘은 자주 다르다:
--      · 개발을 먼저 끝내고 검수·납품·하자보수 기간이 계약 말미에 남는다(개발종료 < 계약종료).
--      · 계약이 연장돼도 개발 완료 목표는 그대로다(계약종료만 밀린다).
--      · **선진행**(계약 전)은 계약 날짜가 아예 NULL 인데 개발은 이미 돌고 있다 —
--        이 구간에서 의미 있는 날짜는 오직 개발종료일 하나다.
--    지금까지는 그 날짜를 비고(note)에 글로 적거나 사람 머리에 두었다. 그러면 정렬도 집계도 못 하고,
--    Excel 장표에 열로 나가지도 않는다. 컬럼으로 세운다.
--
--  【설계 결정 — 나중에 "왜 안 걸었지?" 하고 되돌리지 말 것】
--    · **CHECK 를 두지 않는다.** project 표는 CHECK 를 쓰지 않는 관례다(값의 규율은 코드테이블 FK 와
--      앱 선검증이 맡는다). 이 컬럼만 예외로 만들면 그 관례가 깨진다.
--    · **선진행 잠금 규칙에 넣지 않는다.** start_date·end_date·status 는 '선진행이면 NULL' 이지만
--      dev_end_date 는 반대다 — 선진행이야말로 이 날짜가 유일하게 살아 있는 구간이다.
--      (widget/ProjectDb.cs 의 선진행 분기, task-calendar-prototype.html 의 offEdApplySectionRule
--       잠금 배열 둘 다 이 컬럼을 건드리지 않는다. 시험이 그 사실을 계약으로 붙잡고 있다.)
--    · **start_date 와의 순서 검증도 두지 않는다.** 계약 시작 전에 개발이 끝나는 일이 실제로 있다
--      (선진행분을 나중에 계약으로 덮는 경우). end_date 와의 대소도 마찬가지다.
--    남는 검증은 '형식이 날짜인가' 하나이고, 그것은 앱(IsDateOrEmpty)과 DATE 타입이 함께 본다.
--
--  【적용】
--    set MYSQL_PWD=...
--    mysql -uroot --default-character-set=utf8mb4 taskmgr < migrate-2026-09-10-dev-end-date.sql
--    · 데이터를 바꾸지 않는다(새 컬럼은 전 행 NULL). 그래도 백업은 습관으로 — db/deploy/backup-taskmgr.ps1
--    · 적용 뒤 문서 재생성(컬럼이 늘었으므로):
--        node tools/schema-report/dump-schema.mjs
--        node tools/schema-report/build-schema-html.mjs
--        node tools/schema-report/build-db-schema-html.mjs
--
--  【★ 위젯과 같은 배포에 실릴 것】
--    widget/CalendarDb.cs 의 `ExpectedSchemaVersion` 도 이 판에서 **10** 이다.
--    이번엔 그 짝이 특히 중요하다 — 위젯의 ProjectDb.LoadProjectsJsonAsync 가 **새 컬럼을 SELECT 한다.**
--    구버전(v9) DB 에 새 위젯이 붙으면 그 질의가 ERROR 1054(Unknown column)로 죽고 과제 목록이 통째로
--    비어 버린다. 반대로 v10 DB 에 구버전 위젯이 붙는 것은 무해하다(컬럼을 모를 뿐).
--    그래서 이 마이그레이션과 위젯 상수는 **한 배포**로 나간다 — 순서는 DB 가 먼저다.
--
--  【정본 SQL 과의 관계】
--    같은 컬럼이 db/deploy/schema-structure.sql · db/schema.sql 에도 들어갔다(신규 구축 경로).
--    두 경로가 같은 구조에 도달하는지는 mysqldump --no-data 대조로 실증한다 —
--    그러지 않으면 "마이그레이션으로 온 DB" 와 "새로 세운 DB" 가 조용히 갈린다.
-- =====================================================================

SET NAMES utf8mb4;
SET SESSION lock_wait_timeout = 10;
-- 이 세션이 쓰는 시각은 전부 UTC 로 — 아래 UPDATE 의 UTC_TIMESTAMP(3) 는 무관하지만,
-- ALTER 중에 서버 기본값이 한 줄이라도 발화하면 그것도 UTC 여야 한다(시각 컬럼 규약).
SET SESSION time_zone = '+00:00';

-- ── 0. 선행조건 가드 — v9 에서만 진행한다 ────────────────────────────
--   ALTER … ADD COLUMN 은 두 번째 실행이 ERROR 1060(Duplicate column)으로 죽는다. 그 에러는
--   '왜' 를 말해 주지 않고, 중간까지 돌다 죽으면 무엇이 적용됐는지도 흐려진다.
--   그래서 재실행을 **가드가 먼저** 막는다 — 앞선 마이그레이션 누락도 같은 가드가 잡는다.
SET @v := (SELECT v FROM cal_schema_meta WHERE k = 'schema_version');
SET @g := IF(@v = '9', 'DO 0',
             'SELECT 1 FROM `중단: schema_version 이 9 가 아니다 - 이미 적용됐거나 앞선 마이그레이션이 빠졌다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 표가 실재하는지도 본다 — 없는 표에 ALTER 를 걸면 에러 메시지가 '왜' 를 말해 주지 않는다.
SET @miss := (SELECT 1 - COUNT(*) FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME IN ('project'));
SET @g := IF(@miss = 0, 'DO 0',
             'SELECT 1 FROM `중단: project 표가 없다 - schema-structure.sql 을 먼저 적용할 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- =====================================================================
--  개발종료일 신설 — end_date 바로 뒤
-- =====================================================================
--  AFTER end_date 로 자리를 못 박는 이유: 정본(schema-structure.sql · schema.sql)이 그 자리에
--  적어 두었다. 컬럼 **순서**까지 같아야 mysqldump --no-data 대조가 성립한다 —
--  순서가 다르면 "마이그레이션으로 온 DB" 와 "새로 세운 DB" 가 diff 에서 갈린다.
--  ※ 기존 행은 전부 NULL('미정')이 된다. 값을 추정해 채우지 않는다 — 모르는 것은 모르는 채로 둔다.
--  ★ 컬럼 COMMENT 를 달지 않는다 — 이 DB 의 23표에 컬럼 주석이 **하나도 없다**(실측: mysqldump 대조).
--    설명은 SQL 의 -- 주석과 tools/schema-report/col-notes.json 이 맡는 것이 이 저장소의 관례다.
--    여기만 COMMENT 를 달면 '마이그레이션으로 온 DB' 에만 주석이 붙어 정본과 갈린다 —
--    그게 바로 migrate-2026-09-09-integrity.sql (4) 가 복구한 드리프트 사고의 모양이다(실측으로 재현했다).
ALTER TABLE project
  ADD COLUMN dev_end_date DATE NULL   -- 개발종료일(개발 완료 목표·실제. 계약종료일과 별개. 미정=NULL)
  AFTER end_date;

-- =====================================================================
--  버전 갱신
-- =====================================================================
UPDATE cal_schema_meta SET v = '10', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'schema_version' AND v = '9';

-- =====================================================================
--  사후 검증 — 사람이 읽는 E1~E2 + 기계가 막는 @bad
-- =====================================================================
--  존재만 보지 않는다. 타입(date)·NULL 허용·**바로 앞 컬럼이 end_date 인가**까지 본다 —
--  ORDINAL_POSITION 비교가 곧 'AFTER end_date 가 실제로 먹혔는가' 의 증거다.
SELECT CONCAT('  project.dev_end_date : 타입=', DATA_TYPE, ' · NULL허용=', IS_NULLABLE,
              ' · 위치=', ORDINAL_POSITION,
              ' (end_date 는 ', (SELECT ORDINAL_POSITION FROM information_schema.COLUMNS
                                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project'
                                    AND COLUMN_NAME = 'end_date'), ')') AS `E1`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'dev_end_date';
SELECT CONCAT('  schema_version = ', v) AS `E2` FROM cal_schema_meta WHERE k = 'schema_version';

SET @bad := (SELECT
    (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project'
        AND COLUMN_NAME = 'dev_end_date' AND DATA_TYPE = 'date' AND IS_NULLABLE = 'YES')
  + (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS c
      WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = 'project'
        AND c.COLUMN_NAME = 'dev_end_date'
        AND c.ORDINAL_POSITION = 1 + (SELECT e.ORDINAL_POSITION FROM information_schema.COLUMNS e
                                       WHERE e.TABLE_SCHEMA = DATABASE() AND e.TABLE_NAME = 'project'
                                         AND e.COLUMN_NAME = 'end_date'))
  + (SELECT COUNT(*) = 0 FROM cal_schema_meta WHERE k = 'schema_version' AND v = '10'));
SET @g := IF(@bad = 0, 'DO 0', 'SELECT 1 FROM `중단: 사후 검증 실패 - 위 E1~E2 를 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT '완료 — project.dev_end_date(개발종료일) 신설 · schema_version 10' AS `결과`;
