-- =====================================================================
--  migrate-2026-09-10-user-sort-order.sql
--  사용자 표(app_user)에 명부 서열(sort_order) 신설
--  schema_version 10 → 11
-- =====================================================================
--
--  【왜 컬럼이 필요한가 — 사용자 원문】
--    "같은 직급이라도 입사일이나 타직장 연차를 고려해서 더 상단에" ·
--    "굳이 팀별로 안 하고 **전체 직원**끼리" ·
--    "12 라고 하면 기존 12 부터 일일이 +1 씩 해줘야 함?" → 아니어야 한다.
--    지금 명부는 (소속명, 이름) 순이라 직급도 연차도 표현하지 못한다. 직급 서열(title_code.sort_order)로
--    정렬해도 '같은 직급 안의 순서'는 여전히 이름순이고, 그건 회사가 쓰는 서열이 아니다.
--    → 관리자가 **앱 안에서** 정하는 전사 단일 서열을 컬럼으로 세운다(docs/USER-ADMIN.md).
--
--  【설계 결정 — 나중에 "왜 안 걸었지?" 하고 되돌리지 말 것】
--    · **UNIQUE 를 걸지 않는다.** 앱은 순서를 저장할 때 전 직원을 10·20·30… 으로 **전량 재작성**한다.
--      재작성 중간에 같은 값이 잠깐 공존해도 이름순으로 갈려 실해가 없는데, UNIQUE 가 있으면
--      그 중간 상태가 1062 로 죽는다. '밀기 UPDATE' 규칙 자체를 없애려고 고른 방식이다.
--    · **인덱스를 두지 않는다.** 89행이고 정렬 키는 (소속명, sort_order, 이름) 셋인데 첫 키가
--      조인 값(org_unit.name)이라 이 컬럼의 인덱스가 서지 않는다. 필요해지면 그때 실측으로 결정한다.
--    · **컬럼 COMMENT 를 두지 않는다.** 이 DB 는 컬럼 주석이 0/174 다. 여기만 달면
--      '마이그레이션으로 온 DB' 에만 주석이 붙어 정본과 갈린다 —
--      migrate-2026-09-09-integrity.sql (4) 가 복구한 드리프트 사고와 같은 모양이다.
--      문구는 이 파일의 -- 주석과 tools/schema-report/col-notes.json 이 진다.
--    · **NULL 을 허용한다.** NULL = 미지정이고 명부에서는 그 소속의 맨 뒤로 간다.
--      신규 등록 직후가 그 상태이고, 관리자가 ▲▼ 로 끌어올린 뒤 저장하면 값이 매겨진다.
--
--  【적용】
--    set MYSQL_PWD=...
--    mysql -uroot --default-character-set=utf8mb4 taskmgr < migrate-2026-09-10-user-sort-order.sql
--    · 같은 날 두 번째 판이다 — migrate-2026-09-10-dev-end-date.sql(9→10)을 **먼저** 적용할 것.
--      아래 (0) 가드가 그 순서를 강제한다.
--    · 기존 89행의 sort_order 를 채운다(아래 2). 그 외 컬럼은 건드리지 않는다.
--      그래도 백업은 습관으로 — db/deploy/backup-taskmgr.ps1
--    · 적용 뒤 문서 재생성(컬럼이 늘었으므로):
--        node tools/schema-report/dump-schema.mjs
--        node tools/schema-report/build-schema-html.mjs
--        node tools/schema-report/build-db-schema-html.mjs
--
--  【★ 위젯과 같은 배포에 실릴 것】
--    widget/CalendarDb.cs 의 `ExpectedSchemaVersion` 도 이 판에서 **11** 이다.
--    새 위젯의 구성원 명부 조회가 이 컬럼을 SELECT·ORDER BY 하고, 직원 관리 저장이 이 컬럼에
--    UPDATE 를 건다 — v10 DB 에 새 위젯이 붙으면 명부가 1054 로 통째로 비고 저장이 전부 죽는다.
--    반대로 v11 DB 에 구버전 위젯이 붙는 것은 무해하다(컬럼을 모를 뿐).
--    그래서 이 마이그레이션과 위젯 상수는 **한 배포**로 나간다 — 순서는 DB 가 먼저다.
--
--  【정본 SQL 과의 관계 — 이 표는 db/deploy 소관이 아니다】
--    app_user 를 만드는 정본은 비공개 저장소 taskmgr-company-data/01-schema-users.sql 이다.
--    같은 컬럼이 같은 자리(title 바로 뒤)로 그 파일에도 들어갔다(신규 구축 경로).
--    두 경로가 같은 구조에 도달하는지는 mysqldump --no-data 대조로 실증한다 —
--    그러지 않으면 "마이그레이션으로 온 DB" 와 "새로 세운 DB" 가 조용히 갈린다.
--    ※ 시드(03-seed-users.sql)는 값을 넣지 않는다. 신규 구축 직후 첫 명부는 전원 NULL(=이름순)이고,
--      관리자가 첫 저장을 하면 매겨진다. 두 경로는 **구조**만 같으면 되고 **값**은 같을 필요가 없다.
--    ※ 권한도 짝이다 — taskmgr-company-data/05-grants.sql 이 app_user 에 INSERT·UPDATE 를 부여한다.
--      그게 없으면 컬럼만 서고 관리 화면은 ERROR 1142 로 죽는다.
-- =====================================================================

SET NAMES utf8mb4;
SET SESSION lock_wait_timeout = 10;
-- 이 세션이 쓰는 시각은 전부 UTC 로 — 아래 UPDATE 는 감사 시각을 일부러 고정하지만(2),
-- ALTER 중에 서버 기본값이 한 줄이라도 발화하면 그것도 UTC 여야 한다(시각 컬럼 규약).
SET SESSION time_zone = '+00:00';

-- ── 0. 선행조건 가드 — v10 에서만 진행한다 ───────────────────────────
--   ALTER … ADD COLUMN 은 두 번째 실행이 ERROR 1060(Duplicate column)으로 죽는다. 그 에러는
--   '왜' 를 말해 주지 않고, 중간까지 돌다 죽으면 무엇이 적용됐는지도 흐려진다.
--   그래서 재실행을 **가드가 먼저** 막는다 — 같은 날 앞선 판(9→10) 누락도 같은 가드가 잡는다.
SET @v := (SELECT v FROM cal_schema_meta WHERE k = 'schema_version');
SET @g := IF(@v = '10', 'DO 0',
             'SELECT 1 FROM `중단: schema_version 이 10 이 아니다 - 이미 적용됐거나 앞선 마이그레이션이 빠졌다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 표가 실재하는지도 본다 — 없는 표에 ALTER 를 걸면 에러 메시지가 '왜' 를 말해 주지 않는다.
--   title_code 까지 보는 이유: 아래 (2) 초기값이 직급 서열로 정렬하므로 그 표가 없으면
--   조용히 전원 이름순이 된다(에러가 아니라 **다른 결과**라 더 나쁘다).
SET @miss := (SELECT 2 - COUNT(*) FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME IN ('app_user', 'title_code'));
SET @g := IF(@miss = 0, 'DO 0',
             'SELECT 1 FROM `중단: app_user/title_code 표가 없다 - 01-schema-users.sql 을 먼저 적용할 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- =====================================================================
--  1. 명부 서열 신설 — title 바로 뒤
-- =====================================================================
--  AFTER title 로 자리를 못 박는 이유: 정본(taskmgr-company-data/01-schema-users.sql)이 그 자리에
--  적어 두었다. 컬럼 **순서**까지 같아야 mysqldump --no-data 대조가 성립한다 —
--  순서가 다르면 "마이그레이션으로 온 DB" 와 "새로 세운 DB" 가 diff 에서 갈린다.
--  ※ COMMENT 를 달지 않는 이유는 머리말 【설계 결정】 참조.
ALTER TABLE app_user
  ADD COLUMN sort_order SMALLINT UNSIGNED NULL DEFAULT NULL   -- 전 직원 단일 서열. 작을수록 위. NULL=미지정(맨 뒤)
  AFTER title;

-- =====================================================================
--  2. 초기값 — 직급 서열 → 이름 순으로 10 간격
-- =====================================================================
--  왜 채우는가: 관리자가 손대기 전에도 명부가 말이 되게 하려고. 전원 NULL 로 두면 첫 화면이
--  이름순이 되어, 지금(소속명·이름순)보다 나아지는 것이 하나도 없다. 이 값은 **참고용**이고
--  관리자가 한 번이라도 순서를 저장하면 앱이 전량 재작성한다.
--
--  ★ ROW_NUMBER() 를 쓴다 — 설계 문서(§3.2)가 적어 둔 `SET @r := 0` + `ORDER BY` 형태는
--    MySQL 에서 **문법 오류**다. 다중 테이블 UPDATE(여기서는 title_code 조인)에는 ORDER BY 를
--    쓸 수 없다("For multiple-table syntax, ORDER BY and LIMIT cannot be used").
--    사용자 변수 누적은 8.4 에서 평가 순서를 보장하지도 않는다. 창 함수는 둘 다 피한다.
--
--  ★ updated_at 을 **명시**한다(= 자기 값으로 덮어쓴다). 안 적으면 서버 ON UPDATE 가
--    89행의 갱신 시각을 전부 지금으로 덮는다 — migrate-2026-09-09-integrity.sql (5) 와 같은 이유다.
--    "언제 이 사람의 정보가 마지막으로 바뀌었나" 는 인사 이력이고, 컬럼 하나 늘린 일로 지울 값이 아니다.
--
--  ★ is_active 로 거르지 않는다. 서열은 '전 직원 단일'이고, 퇴사자도 복구되면 자리가 있어야 한다.
--    (명부에서 안 보이는 것은 sort_order 가 아니라 is_active 가 정한다.)
UPDATE app_user u
  JOIN (
    SELECT u2.user_id,
           ROW_NUMBER() OVER (ORDER BY (t.sort_order IS NULL), t.sort_order, u2.name, u2.user_id) * 10 AS n
      FROM app_user u2
      LEFT JOIN title_code t ON t.name = u2.title
  ) r ON r.user_id = u.user_id
   SET u.sort_order = r.n,
       u.updated_at = u.updated_at;   -- ON UPDATE 발화 차단(위 ★)

-- =====================================================================
--  3. 버전 갱신
-- =====================================================================
UPDATE cal_schema_meta SET v = '11', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'schema_version' AND v = '10';

-- =====================================================================
--  사후 검증 — 사람이 읽는 E1~E3 + 기계가 막는 @bad
-- =====================================================================
--  존재만 보지 않는다. 타입(smallint unsigned)·NULL 허용·**바로 앞 컬럼이 title 인가**까지 본다 —
--  ORDINAL_POSITION 비교가 곧 'AFTER title 이 실제로 먹혔는가' 의 증거다.
SELECT CONCAT('  app_user.sort_order : 타입=', DATA_TYPE, ' ', COLUMN_TYPE,
              ' · NULL허용=', IS_NULLABLE,
              ' · 위치=', ORDINAL_POSITION,
              ' (title 은 ', (SELECT ORDINAL_POSITION FROM information_schema.COLUMNS
                               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                                 AND COLUMN_NAME = 'title'), ')') AS `E1`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'sort_order';
SELECT CONCAT('  초기값: 활성 사용자 ', COUNT(*), '명 중 sort_order 가 NULL 인 사람 ',
              SUM(sort_order IS NULL), '명 (0 이어야 한다) · 최솟값 ', MIN(sort_order),
              ' · 최댓값 ', MAX(sort_order)) AS `E2`
  FROM app_user WHERE is_active = 1;
SELECT CONCAT('  schema_version = ', v) AS `E3` FROM cal_schema_meta WHERE k = 'schema_version';

SET @bad := (SELECT
    (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
        AND COLUMN_NAME = 'sort_order' AND COLUMN_TYPE = 'smallint unsigned' AND IS_NULLABLE = 'YES')
  + (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS c
      WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = 'app_user'
        AND c.COLUMN_NAME = 'sort_order'
        AND c.ORDINAL_POSITION = 1 + (SELECT t.ORDINAL_POSITION FROM information_schema.COLUMNS t
                                       WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = 'app_user'
                                         AND t.COLUMN_NAME = 'title'))
  + (SELECT COUNT(*) > 0 FROM app_user WHERE is_active = 1 AND sort_order IS NULL)
  + (SELECT COUNT(*) = 0 FROM cal_schema_meta WHERE k = 'schema_version' AND v = '11'));
SET @g := IF(@bad = 0, 'DO 0', 'SELECT 1 FROM `중단: 사후 검증 실패 - 위 E1~E3 를 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT '완료 — app_user.sort_order(명부 서열) 신설 · schema_version 11' AS `결과`;
