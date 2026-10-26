-- @migration from=17 to=18
-- =====================================================================
--  v18-remove-git.sql: 이관 조각, DB 구조 번호 17 에서 18 로
--  Git, SVN 기능 전량 삭제(docs/GIT-SVN-REMOVAL.md §2, 2026-10-26 사용자 결정). 커밋 기록은 일반 기록으로 바꾸지 않고 지운다.
-- =====================================================================
--
--  이 파일은 혼자 실행하지 않는다.
--    installer/publish-update.ps1(installer/release-sql.ps1)이 이 폴더의 조각을 구조 번호 순서로 이어 붙여
--    dist/installer/release-v<버전>.sql 하나를 만든다. 운영자는 그 파일만 받아 Workbench 에서 한 번 실행한다.
--    release SQL 이 확인과 닫기(db_updating = 1)를 한 뒤 조각을 돌리고, 끝에서 한 트랜잭션으로 연다.
--    조각은 닫지도 열지도 않는다(DB-RELEASE-OPS §5). 닫히지 않은 DB 에서 이 조각만 돌리면 첫 확인에서 멈춘다.
--
--  ★ 되돌릴 수 없다. 커밋 기록(그 기록에 적은 메모, 장소 포함)과 커밋 목록이 지워진다. 실행 전 Workbench 백업은 필수다.
--
--  바꾸는 것:
--    1) 커밋 기록 지우기: DELETE FROM cal_entry WHERE source = 'git'(cal_entry.source 칸이 남아 있을 때만).
--       예외일(cal_entry_except)과 커밋 목록(cal_entry_commit)은 FK ON DELETE CASCADE 로 함께 지워진다.
--       WHERE 에 user_id > 0 을 함께 적는다. Workbench 의 안전 갱신 모드(키 칸 없는 DELETE 거부)를 통과하려는 것이다
--       (v17 의 WHERE id > 0 과 같은 이유). 지운 뒤 git 기록이 하나라도 남으면 닫힌 채 멈춘다.
--    2) cal_entry_commit 표째 지우기(일반 일정에 붙어 있던 커밋 목록까지). 이 표를 가리키는 표는 없다.
--    3) cal_entry: CHECK chk_cal_entry_git(source 와 end_date, recur_freq 를 본다)과 chk_cal_entry_source 를 먼저 지우고
--       source 칸을 지운다. MySQL 은 CHECK 가 쓰는 칸을 지우지 못하므로(3959) 순서가 이렇다.
--    4) cal_category: CHECK chk_cal_category_usesrepo01 다음 uses_repo 칸.
--    5) cal_user_pref: CHECK chk_cal_user_pref_commit_body 다음 git_author, svn_author, git_commit_body 칸, 그리고 표 설명
--       (정본 schema-calendar.sql 의 18 과 같은 글자).
--    6) 검증(information_schema): 지울 표, 칸, CHECK 가 하나도 남지 않았다.
--    7) 구조 번호 18.
--    지우는 칸에는 인덱스도 FK 도 없다(정본 17 확인). 그래서 칸 지우기 앞에 지울 인덱스는 없다.
--
--  표를 다시 만들지 않는다:
--    - 칸 지우기는 ALGORITHM=INSTANT 다(MySQL 8.0.29 부터, 8.4 지원). 즉시 변경이 안 되는 서버나 표면
--      (예: 즉시 변경 판 수 64 를 다 쓴 표) 표를 조용히 복사하지 않고 그 자리에서 실패한다(DB-RELEASE-OPS §5.1).
--    - CHECK 지우기와 표 설명 바꾸기는 메타데이터만 바꾼다. 행을 옮기지 않는다.
--    - DELETE 는 지울 행 수만큼 걸린다(git 기록과 그 자식 행). 한 트랜잭션이다.
--
--  권한: 이 조각은 권한을 주거나 거두지 않는다(배포 SQL 에서 금지). 표마다 권한을 준 환경(개발 PC 의 최소 권한 앱 계정)은
--    지운 cal_entry_commit 의 표 권한이 남아도 해가 없다. 정리는 정본 권한 파일(grants-calendar.sql)대로 root 가 따로 한다.
--
--  다시 돌리기: 안전하다.
--    - 구조 번호가 이미 18 이상이면 아무것도 하지 않는다(건너뛴 배포를 몰아서 올릴 때, 끝난 뒤 다시 돌릴 때).
--    - 앞선 실행이 중간에 멈췄으면 이어서 끝낸다. 단계마다 information_schema 로 대상이 남아 있는지 보고 있을 때만 지운다
--      (source 칸이 이미 없으면 1 의 지우기도 건너뛴다).
--    - 17 도 18 이상도 아니면 멈춘다(앞 판이 빠졌거나 손댄 값).
--
--  멈추는 방법: 저장 프로그램을 쓰지 않는다. 조건으로 실행할 문장을 고르고(PREPARE/EXECUTE),
--    조건이 틀리면 없는 표 이름을 SELECT 해 ERROR 1146 을 낸다. 그 표 이름이 멈춘 이유다.
--    지울 표와 칸이 없을 수도 있어 그것을 읽거나 바꾸는 문장은 모두 PREPARE 로만 돌린다.
--
--  앱 쪽 짝: DbGate.AppStructureVersion 18, 정본 schema-calendar.sql 의 시딩 18(cal_entry_commit 없음, 위 칸과 CHECK 없음)
--    (tests/release-sql.test.mjs, tests/schema-guards.test.mjs, tests/git-removal.test.mjs).
--  조각 규칙(DB-RELEASE-OPS §5.2): 변수는 @go, @skip, @g, @s 와 @m_ 만 쓴다(@r_ 는 감싸개 몫).
--    잠금 대기 상한(lock_wait_timeout)은 release SQL 맨 위에서 한 번 건다. 조각은 걸지 않는다.
-- =====================================================================

-- 1) 확인: 17 이면 올리고, 18 이상이면 건너뛴다. 올릴 때는 닫힌 상태(db_updating = 1)여야 한다
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @m_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @go := (@m_cur <=> '17');
SET @skip := (@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 18);
SET @g := IF(@go OR @skip, 'DO 0',
             'SELECT 1 FROM `중단: v18 조각 - 구조 번호가 17 도 18 이상도 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(NOT @go OR @m_upd <=> '1', 'DO 0',
             'SELECT 1 FROM `중단: v18 조각 - 닫히지 않았다 - release SQL 로만 돌린다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, '17 에서 18 로 올린다(Git, SVN 삭제)', '이미 18 이상이다. 건너뛴다') AS `v18 조각`;

-- 2) 커밋 기록 지우기(cal_entry.source 칸이 남아 있을 때만). 자식(예외일, 커밋 목록)은 FK CASCADE 로 함께 지워진다.
--    값 바꾸기라 한 트랜잭션으로 묶는다(구조 변경 문장은 섞지 않는다).
SET @m_src := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_entry' AND COLUMN_NAME = 'source');
SET @m_del := 0;
START TRANSACTION;
SET @s := IF(@go AND @m_src = 1,
  'DELETE FROM cal_entry WHERE user_id > 0 AND source = ''git''',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; SET @m_del := ROW_COUNT(); DEALLOCATE PREPARE _s;
COMMIT;
--  남은 git 기록이 없어야 칸을 지운다(user_id 가 0 인 행처럼 위 WHERE 가 못 지운 행이 있으면 여기서 멈춘다).
SET @m_left := 0;
SET @s := IF(@go AND @m_src = 1, 'SELECT COUNT(*) INTO @m_left FROM cal_entry WHERE source = ''git''', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @g := IF(NOT @go OR @m_left = 0, 'DO 0',
             'SELECT 1 FROM `중단: v18 조각 - 커밋 기록이 남았다 - 갱신 중 표시인 채로 멈췄다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go AND @m_src = 1, CONCAT('커밋 기록 ', @m_del, '건을 지웠다'), '지울 커밋 기록 칸이 없다') AS `v18 커밋 기록`;

-- 3) cal_entry_commit 지우기(남아 있을 때만)
SET @m_tbl := (SELECT COUNT(*) FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_entry_commit');
SET @s := IF(@go AND @m_tbl = 1, 'DROP TABLE cal_entry_commit', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 4) cal_entry: CHECK 둘(source 를 쓰는 것) 다음 source 칸. 구조 변경 문장이라 트랜잭션으로 묶지 않는다(자동 확정된다).
SET @m_chk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_entry'
                  AND CONSTRAINT_NAME = 'chk_cal_entry_git' AND CONSTRAINT_TYPE = 'CHECK');
SET @s := IF(@go AND @m_chk = 1, 'ALTER TABLE cal_entry DROP CHECK chk_cal_entry_git', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @m_chk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_entry'
                  AND CONSTRAINT_NAME = 'chk_cal_entry_source' AND CONSTRAINT_TYPE = 'CHECK');
SET @s := IF(@go AND @m_chk = 1, 'ALTER TABLE cal_entry DROP CHECK chk_cal_entry_source', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_entry' AND COLUMN_NAME = 'source');
SET @s := IF(@go AND @m_col = 1, 'ALTER TABLE cal_entry DROP COLUMN source, ALGORITHM=INSTANT', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 5) cal_category: CHECK 다음 uses_repo 칸
SET @m_chk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category'
                  AND CONSTRAINT_NAME = 'chk_cal_category_usesrepo01' AND CONSTRAINT_TYPE = 'CHECK');
SET @s := IF(@go AND @m_chk = 1, 'ALTER TABLE cal_category DROP CHECK chk_cal_category_usesrepo01', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category' AND COLUMN_NAME = 'uses_repo');
SET @s := IF(@go AND @m_col = 1, 'ALTER TABLE cal_category DROP COLUMN uses_repo, ALGORITHM=INSTANT', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 6) cal_user_pref: CHECK 다음 칸 셋(칸마다 따로 본다. 중간에 멈춘 뒤 다시 돌려도 남은 칸만 지운다), 그리고 표 설명
SET @m_chk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_user_pref'
                  AND CONSTRAINT_NAME = 'chk_cal_user_pref_commit_body' AND CONSTRAINT_TYPE = 'CHECK');
SET @s := IF(@go AND @m_chk = 1, 'ALTER TABLE cal_user_pref DROP CHECK chk_cal_user_pref_commit_body', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_user_pref' AND COLUMN_NAME = 'git_author');
SET @s := IF(@go AND @m_col = 1, 'ALTER TABLE cal_user_pref DROP COLUMN git_author, ALGORITHM=INSTANT', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_user_pref' AND COLUMN_NAME = 'svn_author');
SET @s := IF(@go AND @m_col = 1, 'ALTER TABLE cal_user_pref DROP COLUMN svn_author, ALGORITHM=INSTANT', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_user_pref' AND COLUMN_NAME = 'git_commit_body');
SET @s := IF(@go AND @m_col = 1, 'ALTER TABLE cal_user_pref DROP COLUMN git_commit_body, ALGORITHM=INSTANT', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
--  표 설명(정본과 같은 글자). 같은 값을 다시 써도 결과가 같다.
SET @s := IF(@go, 'ALTER TABLE cal_user_pref COMMENT = ''사용자당 1행 설정(보고서 서식). PK=(user_id). 삭제 경로 없음.''', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 7) 검증: 지울 표, 칸, CHECK 가 하나도 남지 않았다. 틀리면 db_updating = 1 인 채로 멈춘다(앱은 계속 기다린다).
SET @m_v1 := (SELECT COUNT(*) FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_entry_commit');
SET @m_v2 := (SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_entry' AND COLUMN_NAME = 'source');
SET @m_v3 := (SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category' AND COLUMN_NAME = 'uses_repo');
SET @m_v4 := (SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_user_pref' AND COLUMN_NAME IN ('git_author', 'svn_author', 'git_commit_body'));
SET @m_v5 := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_entry'
                 AND CONSTRAINT_NAME IN ('chk_cal_entry_git', 'chk_cal_entry_source') AND CONSTRAINT_TYPE = 'CHECK');
SET @m_v6 := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category'
                 AND CONSTRAINT_NAME = 'chk_cal_category_usesrepo01' AND CONSTRAINT_TYPE = 'CHECK');
SET @m_v7 := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_user_pref'
                 AND CONSTRAINT_NAME = 'chk_cal_user_pref_commit_body' AND CONSTRAINT_TYPE = 'CHECK');
SET @g := IF(NOT @go OR (@m_v1 = 0 AND @m_v2 = 0 AND @m_v3 = 0 AND @m_v4 = 0 AND @m_v5 = 0 AND @m_v6 = 0 AND @m_v7 = 0), 'DO 0',
             'SELECT 1 FROM `중단: v18 조각 검증 실패 - 지울 표, 칸, CHECK 가 남았다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT IF(@go, 'cal_entry_commit 과 출처, 저장소, 작성자 칸을 지웠다', '지울 것이 없다') AS `v18 Git, SVN 삭제`;

-- 8) 구조 번호 올리기: 17 일 때만 18 로. 이미 18 이상이면 0행이다.
--    db_updating 은 그대로 1 이다. 앱은 release SQL 의 마지막 열기까지 계속 기다린다.
UPDATE cal_schema_meta SET v = '18', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_structure_version' AND v = '17';

-- 9) 끝 확인: 구조 번호 18 이상
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @g := IF(@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 18, 'DO 0',
             'SELECT 1 FROM `중단: v18 조각 끝 확인 실패 - 구조 번호가 18 이상이 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
