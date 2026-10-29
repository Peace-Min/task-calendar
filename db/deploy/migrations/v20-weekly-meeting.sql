-- @migration from=19 to=20
-- =====================================================================
--  v20-weekly-meeting.sql: 이관 조각, DB 구조 번호 19 에서 20 으로
--  근태 주간보고(docs/ATTENDANCE-PLAN.md §13.4, 결정 13, 2026-10-29 사용자 결정).
--  cal_report_weekly 에 회의내용 칸(meeting)을 더한다.
-- =====================================================================
--
--  이 파일은 혼자 실행하지 않는다.
--    installer/publish-update.ps1(installer/release-sql.ps1)이 이 폴더의 조각을 구조 번호 순서로 이어 붙여
--    dist/installer/release-v<버전>.sql 하나를 만든다. 운영자는 그 파일만 받아 Workbench 에서 한 번 실행한다.
--    release SQL 이 확인과 닫기(db_updating = 1)를 한 뒤 조각을 돌리고, 끝에서 한 트랜잭션으로 연다.
--    조각은 닫지도 열지도 않는다(DB-RELEASE-OPS §5). 닫히지 않은 DB 에서 이 조각만 돌리면 첫 확인에서 멈춘다.
--
--  바꾸는 것:
--    1) cal_report_weekly.meeting MEDIUMTEXT NULL 을 plan 뒤(composed_at 앞)에 더한다. 정본 schema-calendar.sql 과 같은 자리, 같은 형.
--       앱의 [보고]가 회사 주간 폼의 회의내용(resultwork)을 채우고, 같은 글을 여기 남긴다(SaveWeeklyAsync).
--       NULL 을 허용하는 이유: 이 칸이 생기기 전에 작성한 주는 회의내용을 남긴 적이 없다. 빈 글('')과 구별해 둔다.
--       앱은 COALESCE(meeting, '') 로 읽어 둘을 같은 빈칸으로 보인다.
--       기존 행은 건드리지 않는다(새 칸이 NULL 로 생길 뿐 값 채우기가 없다).
--       ALGORITHM=INSTANT 라 즉시 변경이 안 되는 서버면 표를 복사하지 않고 실패한다(DB-RELEASE-OPS §5.1).
--    2) 검증(information_schema): 새 칸이 있고 mediumtext, NULL 허용이며 plan 바로 뒤에 있다.
--    3) 구조 번호 20.
--    인덱스는 더하지 않는다. 회의내용으로 찾는 조회가 없다.
--
--  권한: 이 조각은 권한을 주거나 거두지 않는다(배포 SQL 에서 금지). 표가 그대로라 앱 계정의 SELECT, INSERT, UPDATE 가 새 칸에도 닿는다.
--
--  다시 돌리기: 안전하다.
--    - 구조 번호가 이미 20 이상이면 아무것도 하지 않는다(건너뛴 배포를 몰아서 올릴 때, 끝난 뒤 다시 돌릴 때).
--    - 앞선 실행이 중간에 멈췄으면 이어서 끝낸다. 칸은 information_schema 로 있는지 보고 없을 때만 더한다.
--    - 19 도 20 이상도 아니면 멈춘다(앞 판이 빠졌거나 손댄 값).
--
--  멈추는 방법: 저장 프로그램을 쓰지 않는다. 조건으로 실행할 문장을 고르고(PREPARE/EXECUTE),
--    조건이 틀리면 없는 표 이름을 SELECT 해 ERROR 1146 을 낸다. 그 표 이름이 멈춘 이유다.
--
--  앱 쪽 짝: DbGate.AppStructureVersion 20, 정본 schema-calendar.sql 의 cal_report_weekly 와 시딩 20
--    (tests/release-sql.test.mjs, tests/schema-guards.test.mjs, tests/version-gate-host.test.mjs).
--  조각 규칙(DB-RELEASE-OPS §5.2): 변수는 @go, @skip, @g, @s 와 @m_ 만 쓴다(@r_ 는 감싸개 몫).
--    잠금 대기 상한(lock_wait_timeout)은 release SQL 맨 위에서 한 번 건다. 조각은 걸지 않는다.
-- =====================================================================

-- 1) 확인: 19 면 올리고, 20 이상이면 건너뛴다. 올릴 때는 닫힌 상태(db_updating = 1)여야 한다
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @m_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @go := (@m_cur <=> '19');
SET @skip := (@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 20);
SET @g := IF(@go OR @skip, 'DO 0',
             'SELECT 1 FROM `중단: v20 조각 - 구조 번호가 19 도 20 이상도 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(NOT @go OR @m_upd <=> '1', 'DO 0',
             'SELECT 1 FROM `중단: v20 조각 - 닫히지 않았다 - release SQL 로만 돌린다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '19 에서 20 으로 올린다(주간보고 회의내용)', '이미 20 이상이다. 건너뛴다') AS `v20 조각`;

-- 2) cal_report_weekly.meeting: 없을 때만 더한다(MySQL 에는 ADD COLUMN IF NOT EXISTS 가 없다)
--    구조 변경 문장이라 트랜잭션으로 묶지 않는다(자동 확정된다). 중간에 멈추면 다시 돌릴 때 여기서 건너뛴다.
SET @m_mcol := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly' AND COLUMN_NAME = 'meeting');
SET @s := IF(@go AND @m_mcol = 0,
  'ALTER TABLE cal_report_weekly ADD COLUMN meeting MEDIUMTEXT NULL AFTER plan, ALGORITHM=INSTANT',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 3) 검증: 칸(형, NULL 허용, 자리). 틀리면 db_updating = 1 인 채로 멈춘다(앱은 계속 기다린다).
--    information_schema 로 다시 보는 이유: 이름이 같은 다른 모양의 칸이 이미 있으면 위 단계가 건너뛰기 때문이다.
SET @m_mty := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly' AND COLUMN_NAME = 'meeting'
                  AND COLUMN_TYPE = 'mediumtext' AND IS_NULLABLE = 'YES');
SET @m_mpos := (SELECT COUNT(*) FROM information_schema.COLUMNS a JOIN information_schema.COLUMNS b
                   ON b.TABLE_SCHEMA = a.TABLE_SCHEMA AND b.TABLE_NAME = a.TABLE_NAME AND b.ORDINAL_POSITION = a.ORDINAL_POSITION + 1
                 WHERE a.TABLE_SCHEMA = DATABASE() AND a.TABLE_NAME = 'cal_report_weekly' AND a.COLUMN_NAME = 'plan' AND b.COLUMN_NAME = 'meeting');
SET @g := IF(NOT @go OR (@m_mty = 1 AND @m_mpos = 1), 'DO 0',
             'SELECT 1 FROM `중단: v20 조각 검증 실패 - 회의내용 칸의 형이나 자리가 다르다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '주간보고에 회의내용 칸을 더했다', '만들 것이 없다') AS `v20 회의내용 칸`;

-- 4) 구조 번호 올리기: 19 일 때만 20 으로. 이미 20 이상이면 0행이다.
--    db_updating 은 그대로 1 이다. 앱은 release SQL 의 마지막 열기까지 계속 기다린다.
UPDATE cal_schema_meta SET v = '20', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_structure_version' AND v = '19';

-- 5) 끝 확인: 구조 번호 20 이상
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @g := IF(@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 20, 'DO 0',
             'SELECT 1 FROM `중단: v20 조각 끝 확인 실패 - 구조 번호가 20 이상이 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
