SET SESSION lock_wait_timeout = 10;
SET NAMES utf8mb4;
-- =====================================================================
--  migrate-2026-10-21-version-gate.sql
--  버전 관문(docs/VERSION-GATE.md, docs/DB-RELEASE-OPS.md)의 DB 쪽 절반. DB 구조 번호 13 에서 14 로.
--  DB-RELEASE-OPS §5 형식(확인, 닫기, 바꾸기, 검증, 열기)을 처음 따르는 이관 파일이다.
-- =====================================================================
--
--  【바꾸는 것】 표 구조는 바꾸지 않는다. cal_schema_meta 의 행만 바꾼다.
--    - 옛 키 schema_version 을 지운다.
--    - 새 키 다섯 개를 둔다.
--        db_structure_version  '14'  DB 표 구조 번호. 앱(DbGate.AppStructureVersion)과 같아야 동작한다
--        db_updating           '0'   '1' 이면 DB 갱신 중. 모든 앱이 잠시 기다린다
--        app_latest_version    ''    배포 중인 최신 앱 버전(빈 값 = 새 버전 없음)
--        app_installer_file    ''    공유 폴더에서 받을 Setup 파일 이름
--        app_installer_sha256  ''    받은 파일 대조용 해시
--      app_ 세 키는 빈 값으로 둔다. 새 앱을 배포할 때 installer/publish-update.ps1 이 만들어 주는
--      dist/installer/release-v<버전>.sql 로 채운다(DB-RELEASE-OPS §4).
--
--  【실행 방법】 MySQL Workbench 에서 taskmgr_app 계정으로.
--    1) 먼저 백업한다. Server > Data Export, taskcalendar 선택, Dump Structure and Data,
--       Export to Self-Contained File, Create Dump in a Single Transaction, Include Create Schema.
--       파일 끝에 '-- Dump completed' 가 있는지 본다.
--    2) 이 파일을 열고 전체 실행(Ctrl+Shift+Enter)한다. 기본 설정(오류가 나면 멈춤)을 그대로 둔다.
--    3) 마지막 결과 표에서 db_structure_version = 14, db_updating = 0 을 본다.
--    ※ 오류(1146, '중단: …' 이라는 이름의 표가 없다는 메시지)로 멈추면 그 이름이 멈춘 이유다.
--      아무것도 건드리지 말고 메시지를 개발자에게 넘긴다(DB-RELEASE-OPS §6).
--
--  【멈추는 방법】 Workbench 에서도 저장 프로시저를 남기지 않는다. 조건을 계산해 실행할 문장을 고르고
--    (PREPARE/EXECUTE), 조건이 틀리면 '없는 표 이름'을 SELECT 해 ERROR 1146 을 낸다
--    (migrate-2026-10-15-code-ids.sql 의 관문 패턴 그대로다).
--
--  【다시 돌리기】 안전하다.
--    - 이미 14 이고 db_updating = 0 이면 아무것도 바꾸지 않고 끝난다.
--    - 앞선 실행이 중간에 멈췄으면(db_updating = 1, 구조 번호 13) 이어서 끝낸다.
--    - 13 도 14 도 아니면(앞 판이 빠졌거나 손댄 값) 확인 단계에서 멈춘다. 아무것도 바뀌지 않는다.
--
--  【앱 쪽 짝】 이 파일과 같은 커밋에서 DbGate.AppStructureVersion 이 14 이고, 정본 schema-calendar.sql 이
--    같은 키 다섯 개를 시딩한다(tests/schema-guards.test.mjs 가드 ⑥⑨, tests/version-gate-host.test.mjs).
--    ※ 옛 앱(0.22 이하)은 db_ 키를 모른다. 사내 서버에 붙은 사용자가 아직 없어(DB-RELEASE-OPS §0) 옮길 사람이 없다.
-- =====================================================================

-- =====================================================================
--  0) 표 확인
-- =====================================================================
SET @n_tbl := (SELECT COUNT(*) FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_schema_meta');
SET @g := IF(@n_tbl = 1, 'DO 0',
             'SELECT 1 FROM `중단: cal_schema_meta 표가 없다 - DB 이름을 확인할 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- =====================================================================
--  1) 확인: 13 에서만 진행한다. 이미 14 면 아무것도 하지 않는다
-- =====================================================================
SET @old := (SELECT v FROM cal_schema_meta WHERE k = 'schema_version');
SET @cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');

-- 이미 끝났다: 옛 키가 없고 구조 번호 14, 갱신 중 아님.
SET @done := (@old IS NULL AND @cur <=> '14' AND @upd <=> '0');
-- 처음 돌린다: 옛 키 13. 앞선 실행이 db_structure_version 13 을 이미 넣었을 수 있다.
SET @fresh := (@old <=> '13' AND (@cur IS NULL OR @cur <=> '13'));
-- 앞선 실행이 옛 키를 지운 뒤 멈췄다: 구조 번호 13, 갱신 중.
SET @partial := (@old IS NULL AND @cur <=> '13' AND @upd <=> '1');
SET @go := (@fresh OR @partial);

SET @g := IF(@done OR @go, 'DO 0',
             'SELECT 1 FROM `중단: 구조 번호가 13 도 14 도 아니다 - 앞 판이 빠졌거나 손댄 값`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@done, '이미 14 다. 아무것도 바꾸지 않는다', '13 에서 14 로 올린다') AS `확인`;

-- =====================================================================
--  2) 닫기: db_updating = 1. 이 순간부터 새 앱은 모두 '서버 갱신 중' 으로 기다린다
-- =====================================================================
--  이 판만 예외로 db_updating 행을 여기서 처음 만든다(13 에는 없던 키다).
--  autocommit 한 문장이라 곧바로 다른 연결에 보인다.
SET @s := IF(@go,
  'INSERT INTO cal_schema_meta (k, v, updated_at) VALUES (''db_updating'', ''1'', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE v = ''1'', updated_at = UTC_TIMESTAMP(3)',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

--  표 설명을 새 역할에 맞춘다(정본 schema-calendar.sql 과 같은 문구). 메타데이터만 바꾸는 DDL 이라 즉시 끝난다.
SET @s := IF(@go, 'ALTER TABLE cal_schema_meta COMMENT = ''구조 번호와 배포 정보(키-값). 앱은 SELECT 만, 연결마다 구조 번호를 비교해 다르면 읽기와 쓰기를 막는다(VERSION-GATE).''', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- =====================================================================
--  3) 바꾸기: 새 키를 넣고 옛 키를 지운다(값 바꾸기라 한 트랜잭션)
-- =====================================================================
--  구조 번호는 일단 13 으로 넣는다. 14 는 마지막 열기에서 db_updating = 0 과 함께 올린다.
--  이미 있는 키는 건드리지 않는다(ON DUPLICATE KEY UPDATE k = k). 다시 돌려도 app_ 값을 지우지 않는다.
START TRANSACTION;
SET @s := IF(@go,
  'INSERT INTO cal_schema_meta (k, v, updated_at) VALUES (''db_structure_version'', ''13'', UTC_TIMESTAMP(3)), (''app_latest_version'', '''', UTC_TIMESTAMP(3)), (''app_installer_file'', '''', UTC_TIMESTAMP(3)), (''app_installer_sha256'', '''', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE k = k',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @s := IF(@go, 'DELETE FROM cal_schema_meta WHERE k = ''schema_version''', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
COMMIT;

-- =====================================================================
--  4) 검증: 틀리면 db_updating = 1 인 채로 멈춘다(앱은 계속 기다린다)
-- =====================================================================
SET @n_keys := (SELECT COUNT(*) FROM cal_schema_meta
                 WHERE k IN ('db_structure_version', 'db_updating', 'app_latest_version',
                             'app_installer_file', 'app_installer_sha256'));
SET @n_old := (SELECT COUNT(*) FROM cal_schema_meta WHERE k = 'schema_version');
SET @v_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @v_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @ok := (@done OR (@n_keys = 5 AND @n_old = 0 AND @v_cur <=> '13' AND @v_upd <=> '1'));
SET @g := IF(@ok, 'DO 0',
             'SELECT 1 FROM `중단: 검증 실패 - 갱신 중 표시인 채로 멈췄다 - 개발자에게 알릴 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- =====================================================================
--  5) 열기(한 트랜잭션): 구조 번호 14, db_updating = 0
-- =====================================================================
--  두 줄 모두 조건이 맞을 때만 바뀐다. 이미 14 인 DB 에서는 둘 다 0행이다.
START TRANSACTION;
UPDATE cal_schema_meta SET v = '14', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_structure_version' AND v = '13';
UPDATE cal_schema_meta SET v = '0', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_updating' AND v = '1' AND @go = 1;
COMMIT;

-- =====================================================================
--  6) 끝 확인
-- =====================================================================
SET @v_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @v_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @g := IF(@v_cur <=> '14' AND @v_upd <=> '0', 'DO 0',
             'SELECT 1 FROM `중단: 끝 확인 실패 - 구조 번호 14, 갱신 중 0 이 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT k, v, updated_at FROM cal_schema_meta ORDER BY k;
