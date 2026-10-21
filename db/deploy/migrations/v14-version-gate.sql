-- @migration from=13 to=14
-- =====================================================================
--  v14-version-gate.sql: 이관 조각, DB 구조 번호 13 에서 14 로
--  버전 관문(docs/VERSION-GATE.md, docs/DB-RELEASE-OPS.md)의 DB 쪽 절반.
-- =====================================================================
--
--  이 파일은 혼자 실행하지 않는다.
--    installer/publish-update.ps1(installer/release-sql.ps1)이 이 폴더의 조각을 구조 번호 순서로 이어 붙여
--    dist/installer/release-v<버전>.sql 하나를 만든다. 운영자는 그 파일만 받아 Workbench 에서 한 번 실행한다.
--    release SQL 이 확인과 닫기(db_updating = 1)를 한 뒤 조각을 돌리고, 끝에서 한 트랜잭션으로 연다
--    (app_ 세 키와 db_updating = 0). 조각은 닫지도 열지도 않는다(DB-RELEASE-OPS §5).
--    닫히지 않은 DB 에서 이 조각만 돌리면 첫 확인에서 멈춘다(아무것도 바뀌지 않는다).
--
--  바꾸는 것: 표 구조는 그대로다. cal_schema_meta 의 행과 표 설명만 바꾼다.
--    - 옛 키 schema_version 을 지운다.
--    - 새 키를 둔다. db_updating 은 release SQL 의 닫기가 이미 '1' 로 만들었다.
--        db_structure_version  '13' 으로 넣고 이 조각 끝에서 '14' 로 올린다
--        app_latest_version    ''  배포 중인 최신 앱 버전(빈 값 = 새 버전 없음)
--        app_installer_file    ''  공유 폴더에서 받을 Setup 파일 이름
--        app_installer_sha256  ''  받은 파일 대조용 해시
--      app_ 세 키는 빈 값으로 두고, 같은 release SQL 의 마지막 열기가 채운다.
--
--  다시 돌리기: 안전하다.
--    - 구조 번호가 이미 14 이상이면 아무것도 하지 않는다(건너뛴 배포를 몰아서 올릴 때, 끝난 뒤 다시 돌릴 때).
--    - 앞선 실행이 중간에 멈췄으면(구조 13, 옛 키가 남았거나 이미 지워졌거나) 이어서 끝낸다.
--    - 13 도 14 이상도 아니면 멈춘다.
--
--  멈추는 방법: 저장 프로시저를 쓰지 않는다. 조건으로 실행할 문장을 고르고(PREPARE/EXECUTE),
--    조건이 틀리면 '없는 표 이름'을 SELECT 해 ERROR 1146 을 낸다. 그 표 이름이 멈춘 이유다.
--
--  앱 쪽 짝: DbGate.AppStructureVersion 14, 정본 schema-calendar.sql 의 키 다섯 개 시딩
--    (tests/schema-guards.test.mjs 가드 ⑥⑨, tests/version-gate-host.test.mjs).
-- =====================================================================

-- 1) 확인: 13 이면 올리고, 14 이상이면 건너뛴다. 올릴 때는 닫힌 상태(db_updating = 1)여야 한다
SET @m_old := (SELECT v FROM cal_schema_meta WHERE k = 'schema_version');
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @m_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @m_from := COALESCE(@m_cur, @m_old);
SET @go := (@m_from <=> '13');
SET @skip := (@m_from REGEXP '^[0-9]{1,6}$' AND CAST(@m_from AS UNSIGNED) >= 14);
SET @g := IF(@go OR @skip, 'DO 0',
             'SELECT 1 FROM `중단: v14 조각 - 구조 번호가 13 도 14 이상도 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(NOT @go OR @m_upd <=> '1', 'DO 0',
             'SELECT 1 FROM `중단: v14 조각 - 닫히지 않았다 - release SQL 로만 돌린다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '13 에서 14 로 올린다', '이미 14 이상이다. 건너뛴다') AS `v14 조각`;

-- 2) 바꾸기
--  표 설명을 새 역할에 맞춘다(정본 schema-calendar.sql 과 같은 문구). 메타데이터만 바꾸는 DDL 이라 즉시 끝난다.
SET @s := IF(@go, 'ALTER TABLE cal_schema_meta COMMENT = ''구조 번호와 배포 정보(키-값). 앱은 SELECT 만, 연결마다 구조 번호를 비교해 다르면 읽기와 쓰기를 막는다(VERSION-GATE).''', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

--  새 키를 넣고 옛 키를 지운다(값 바꾸기라 한 트랜잭션). 구조 번호는 일단 13 으로 넣는다.
--  이미 있는 키는 건드리지 않는다(ON DUPLICATE KEY UPDATE k = k). 다시 돌려도 app_ 값을 지우지 않는다.
START TRANSACTION;
SET @s := IF(@go,
  'INSERT INTO cal_schema_meta (k, v, updated_at) VALUES (''db_structure_version'', ''13'', UTC_TIMESTAMP(3)), (''app_latest_version'', '''', UTC_TIMESTAMP(3)), (''app_installer_file'', '''', UTC_TIMESTAMP(3)), (''app_installer_sha256'', '''', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE k = k',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @s := IF(@go, 'DELETE FROM cal_schema_meta WHERE k = ''schema_version''', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
COMMIT;

-- 3) 검증: 틀리면 db_updating = 1 인 채로 멈춘다(앱은 계속 기다린다)
SET @m_keys := (SELECT COUNT(*) FROM cal_schema_meta
                 WHERE k IN ('db_structure_version', 'db_updating', 'app_latest_version',
                             'app_installer_file', 'app_installer_sha256'));
SET @m_nold := (SELECT COUNT(*) FROM cal_schema_meta WHERE k = 'schema_version');
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @g := IF(NOT @go OR (@m_keys = 5 AND @m_nold = 0 AND @m_cur <=> '13'), 'DO 0',
             'SELECT 1 FROM `중단: v14 조각 검증 실패 - 갱신 중 표시인 채로 멈췄다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- 4) 구조 번호 올리기: 13 일 때만 14 로. 이미 14 이상이면 0행이다.
--    db_updating 은 그대로 1 이다. 앱은 release SQL 의 마지막 열기까지 계속 기다린다.
UPDATE cal_schema_meta SET v = '14', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_structure_version' AND v = '13';

-- 5) 끝 확인: 구조 번호가 14 이상이다
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @g := IF(@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 14, 'DO 0',
             'SELECT 1 FROM `중단: v14 조각 끝 확인 실패 - 구조 번호가 14 가 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
