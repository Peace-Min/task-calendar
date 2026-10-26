-- @migration from=18 to=19
-- =====================================================================
--  v19-project-order.sql: 이관 조각, DB 구조 번호 18 에서 19 로
--  과제 관리 화면 개선(docs/PROJECT-ADMIN-UX.md §1.1, §1.4, 2026-10-26 사용자 결정).
--  과제 순서 칸(No)을 더하고, 구분 2, 상태 2 에 묶였던 규칙 문구를 코드표 표 설명에서 지운다.
-- =====================================================================
--
--  이 파일은 혼자 실행하지 않는다.
--    installer/publish-update.ps1(installer/release-sql.ps1)이 이 폴더의 조각을 구조 번호 순서로 이어 붙여
--    dist/installer/release-v<버전>.sql 하나를 만든다. 운영자는 그 파일만 받아 Workbench 에서 한 번 실행한다.
--    release SQL 이 확인과 닫기(db_updating = 1)를 한 뒤 조각을 돌리고, 끝에서 한 트랜잭션으로 연다.
--    조각은 닫지도 열지도 않는다(DB-RELEASE-OPS §5). 닫히지 않은 DB 에서 이 조각만 돌리면 첫 확인에서 멈춘다.
--
--  바꾸는 것:
--    1) project.sort_no INT UNSIGNED NULL 을 status_id 뒤(note 앞)에 더한다. 정본 schema-structure.sql 과 같은 자리, 같은 형.
--       그 구분 안에서의 순서다(1 부터). 화면의 No 는 이 순서로 매긴 자리 번호다. NULL 은 맨 뒤로 간다.
--       ALGORITHM=INSTANT 라 즉시 변경이 안 되는 서버면 표를 복사하지 않고 실패한다(DB-RELEASE-OPS §5.1).
--    2) section_code, status_code 의 표 설명에서 고정 번호 문구(2=선진행, 2=종료)를 지운다(정본과 같은 글자).
--       구분, 상태와 날짜는 이제 서로 묶이지 않는다(§1.4). 표 설명 바꾸기는 메타데이터만 바꾼다.
--    3) 기존 과제의 처음 순서: 보이는 과제(is_active = 1)에 구분마다 지금 화면 순서(표시 이름 = 통상명칭, 비었으면 사업명,
--       같으면 id)로 1, 2, 3 을 매긴다. 숨긴 과제는 NULL 로 둔다(되살리면 앱이 그 구분의 맨 뒤로 보낸다).
--       이미 번호가 있는 행은 건드리지 않고, 번호가 없는 행은 그 구분의 지금 최댓값 뒤에 붙인다.
--       updated_at 은 자기 값으로 적어 수정 시각을 덮지 않는다(순서 채우기는 과제 내용의 수정이 아니다).
--       WHERE p.id > 0 은 Workbench 의 안전 갱신 모드(키 칸 없는 UPDATE 거부)를 통과하려는 것이다(v17 과 같은 이유).
--    4) 검증(information_schema 와 남은 NULL): 새 칸이 있고 int unsigned, NULL 허용이며 status_id 바로 뒤에 있다.
--       두 표 설명이 정본과 같다. 보이는 과제 가운데 번호가 빈 것이 없다.
--    5) 구조 번호 19.
--    인덱스는 더하지 않는다. 과제는 수백 건이고 구분별 조회는 ix_project_section_id 로 충분하다.
--
--  권한: 이 조각은 권한을 주거나 거두지 않는다(배포 SQL 에서 금지). 새 표가 없어 따로 줄 권한도 없다.
--
--  다시 돌리기: 안전하다.
--    - 구조 번호가 이미 19 이상이면 아무것도 하지 않는다(건너뛴 배포를 몰아서 올릴 때, 끝난 뒤 다시 돌릴 때).
--    - 앞선 실행이 중간에 멈췄으면 이어서 끝낸다. 칸은 information_schema 로 있는지 보고 없을 때만 더하고,
--      표 설명은 같은 값을 다시 써도 결과가 같고, 순서 채우기는 번호가 빈 행만 건드린다.
--    - 18 도 19 이상도 아니면 멈춘다(앞 판이 빠졌거나 손댄 값).
--
--  멈추는 방법: 저장 프로그램을 쓰지 않는다. 조건으로 실행할 문장을 고르고(PREPARE/EXECUTE),
--    조건이 틀리면 없는 표 이름을 SELECT 해 ERROR 1146 을 낸다. 그 표 이름이 멈춘 이유다.
--    새 칸이 없을 수도 있어 그 칸을 읽거나 쓰는 문장은 모두 PREPARE 로만 돌린다.
--
--  다음 순서(폐쇄망): 이 조각이 든 배포 SQL 다음에 과제 최신화 SQL(taskmgr-company-data 의 project-data)을 돌린다.
--    최신화 SQL 은 엑셀 No 순서로 sort_no 를 다시 채우며 구조 19 이상에서만 돈다.
--
--  앱 쪽 짝: DbGate.AppStructureVersion 19, 정본 schema-calendar.sql 의 시딩 19, schema-structure.sql 의 project 와
--    section_code, status_code(tests/project-order.test.mjs, tests/release-sql.test.mjs, tests/schema-guards.test.mjs).
--  조각 규칙(DB-RELEASE-OPS §5.2): 변수는 @go, @skip, @g, @s 와 @m_ 만 쓴다(@r_ 는 감싸개 몫).
--    잠금 대기 상한(lock_wait_timeout)은 release SQL 맨 위에서 한 번 건다. 조각은 걸지 않는다.
-- =====================================================================

-- 1) 확인: 18 이면 올리고, 19 이상이면 건너뛴다. 올릴 때는 닫힌 상태(db_updating = 1)여야 한다
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @m_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @go := (@m_cur <=> '18');
SET @skip := (@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 19);
SET @g := IF(@go OR @skip, 'DO 0',
             'SELECT 1 FROM `중단: v19 조각 - 구조 번호가 18 도 19 이상도 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(NOT @go OR @m_upd <=> '1', 'DO 0',
             'SELECT 1 FROM `중단: v19 조각 - 닫히지 않았다 - release SQL 로만 돌린다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '18 에서 19 로 올린다(과제 순서)', '이미 19 이상이다. 건너뛴다') AS `v19 조각`;

-- 2) project.sort_no: 없을 때만 더한다(MySQL 에는 ADD COLUMN IF NOT EXISTS 가 없다)
--    구조 변경 문장이라 트랜잭션으로 묶지 않는다(자동 확정된다). 중간에 멈추면 다시 돌릴 때 여기서 건너뛴다.
SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'sort_no');
SET @s := IF(@go AND @m_col = 0,
  'ALTER TABLE project ADD COLUMN sort_no INT UNSIGNED NULL AFTER status_id, ALGORITHM=INSTANT',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 3) 코드표 표 설명(정본 schema-structure.sql 과 같은 글자). 같은 값을 다시 써도 결과가 같다.
SET @s := IF(@go, 'ALTER TABLE section_code COMMENT = ''구분 코드. PK=section_id, name=UNIQUE 라벨. Admin 관리.''', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @s := IF(@go, 'ALTER TABLE status_code COMMENT = ''상태 코드. PK=status_id, name=UNIQUE 라벨. Admin 관리.''', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 4) 기존 과제의 처음 순서: 보이는 과제 가운데 번호가 빈 것에, 구분마다 (그 구분의 지금 최댓값 + 화면 순서)를 매긴다.
--    값 바꾸기라 한 트랜잭션으로 묶는다(구조 변경 문장은 섞지 않는다).
SET @m_fill := 0;
START TRANSACTION;
SET @s := IF(@go,
  'UPDATE project p
     JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY section_id ORDER BY COALESCE(NULLIF(common_name, ''''), project_name), id) AS rn
             FROM project WHERE is_active = 1 AND sort_no IS NULL) o ON o.id = p.id
     LEFT JOIN (SELECT section_id, MAX(sort_no) AS mx FROM project WHERE is_active = 1 GROUP BY section_id) m ON m.section_id = p.section_id
      SET p.sort_no = IFNULL(m.mx, 0) + o.rn, p.updated_at = p.updated_at
    WHERE p.id > 0',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; SET @m_fill := ROW_COUNT(); DEALLOCATE PREPARE _s;
COMMIT;
SELECT IF(@go, CONCAT('기존 과제 순서 채움: ', @m_fill, '건'), '건너뜀') AS `v19 과제 순서`;

-- 5) 검증: 칸(형, NULL 허용, 자리), 두 표 설명, 보이는 과제의 빈 번호. 틀리면 db_updating = 1 인 채로 멈춘다(앱은 계속 기다린다).
--    information_schema 로 다시 보는 이유: 이름이 같은 다른 모양의 칸이 이미 있으면 위 단계가 건너뛰기 때문이다.
SET @m_cty := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'sort_no'
                  AND COLUMN_TYPE = 'int unsigned' AND IS_NULLABLE = 'YES');
SET @m_pos := (SELECT COUNT(*) FROM information_schema.COLUMNS a JOIN information_schema.COLUMNS b
                  ON b.TABLE_SCHEMA = a.TABLE_SCHEMA AND b.TABLE_NAME = a.TABLE_NAME AND b.ORDINAL_POSITION = a.ORDINAL_POSITION + 1
                WHERE a.TABLE_SCHEMA = DATABASE() AND a.TABLE_NAME = 'project' AND a.COLUMN_NAME = 'status_id' AND b.COLUMN_NAME = 'sort_no');
SET @m_c1 := (SELECT COUNT(*) FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_code' AND TABLE_COMMENT = '구분 코드. PK=section_id, name=UNIQUE 라벨. Admin 관리.');
SET @m_c2 := (SELECT COUNT(*) FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'status_code' AND TABLE_COMMENT = '상태 코드. PK=status_id, name=UNIQUE 라벨. Admin 관리.');
SET @m_null := 0;
SET @s := IF(@go AND @m_cty = 1, 'SELECT COUNT(*) INTO @m_null FROM project WHERE is_active = 1 AND sort_no IS NULL', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @g := IF(NOT @go OR (@m_cty = 1 AND @m_pos = 1 AND @m_c1 = 1 AND @m_c2 = 1 AND @m_null = 0), 'DO 0',
             'SELECT 1 FROM `중단: v19 조각 검증 실패 - 순서 칸, 표 설명, 빈 순서가 다르다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '과제 순서 칸을 더하고 코드표 표 설명을 고쳤다', '만들 것이 없다') AS `v19 과제 순서 칸`;

-- 6) 구조 번호 올리기: 18 일 때만 19 로. 이미 19 이상이면 0행이다.
--    db_updating 은 그대로 1 이다. 앱은 release SQL 의 마지막 열기까지 계속 기다린다.
UPDATE cal_schema_meta SET v = '19', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_structure_version' AND v = '18';

-- 7) 끝 확인: 구조 번호 19 이상
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @g := IF(@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 19, 'DO 0',
             'SELECT 1 FROM `중단: v19 조각 끝 확인 실패 - 구조 번호가 19 이상이 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
