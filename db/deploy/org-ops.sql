-- ============================================================================
--  org-ops.sql — 조직 변경 4종의 **mysql 전용 대체본**(PowerShell 을 못 쓰는 환경용).
--    보통은 org-ops.cmd(= org-ops.ps1) 를 쓴다. 이 파일은 같은 판정을 내는 최소본이다.
--    대상: 조직 절단(org_id/parent_id) 마이그레이션을 끝낸 DB.
--
--  ★ 왜 이 파일이 필요한가 — DB 가 지켜 주지 못하는 것이 남아 있다
--    소속은 번호 하나다(org_unit.parent_id · app_user.org_id). 이름 미러가 없으므로
--    '두 곳에 적힌 같은 사실이 어긋난다' 는 사고 부류는 통째로 사라졌다. 그래도:
--      · fk_org_parent_id 는 '부모가 실재하는가' 만 본다 — '루트에서 닿는가(트리인가)' 는
--        보지 않는다. 손 UPDATE 두 줄이면 두 조직이 서로를 부모로 가리키는 섬이 되고,
--        그 산하 인원이 상위 조직의 열람 범위에서 통째로 빠진다(에러 0 · 경고 0).
--      · UNIQUE 는 ai_ci·NO PAD 라 'SW 1팀' 과 'SW 1팀 ' 을 다른 이름으로 나란히 받는다.
--      · is_active 는 그냥 값이라 '숨긴 부모 밑의 살아 있는 자식' 도, '숨긴 조직에 남은
--        재직자' 도 막지 않는다. 뒤쪽은 조직 수만 세는 눈으로는 아예 보이지 않는다.
--    → 그래서 변경을 트랜잭션으로 감싸고, COMMIT **앞에서** 불변식을 검산한다.
--
--  ★★ 판정은 org-ops.ps1 과 **같아야 한다**(앞선 판에서 둘이 정반대 판정을 낸 치명 결함이
--    있었다). 같은 여섯 불변식 · 같은 재귀 상한 512 · 같은 BINARY 비교 · 같은 커밋 조건:
--      COMMIT = ① 의도한 변경이 실제로 났다 ② 여섯 값 중 어느 하나도 실행 전보다 커지지
--               않았다(깨끗한 DB 에서는 '여전히 전부 0' 과 같은 뜻이다).
--
--  적용: 아래 [입력] 블록만 고치고
--        mysql -u root -p --default-character-set=utf8mb4 taskmgr < org-ops.sql
--    ※ --force 금지. 안전장치가 전부 '에러로 멈추는' 방식이고 **트랜잭션 안에서** 멈춘다 —
--      mysql 이 죽으면 세션이 끊기고 InnoDB 가 되돌린다(실측). --force 는 두 겹을 함께 무력화한다.
--  ※ 한 번 실행에 한 연산. 번호는 @op='show' 로 먼저 확인할 것(눈으로 짐작하지 말 것).
--  ※ repair(이름 앞뒤 공백 제거 · 숨긴 조직 밑 정리)는 여기 없다 — org-ops.cmd repair 소관.
-- ============================================================================
SET NAMES utf8mb4;

-- ############################################################################
-- #  [입력] — 여기만 고친다
-- ############################################################################
--  @op : show | rename | add | move | assign  (다섯 중 하나. 그 밖의 값은 아래에서 막는다)
SET @op := 'show';

--  rename (조직 개명)        : @org_id(대상 번호) · @new_name(새 이름)
--  add    (조직 신설)        : @new_name(이름) · @parent_id(상위 번호) · @sort_order(표시 순서)
--  move   (팀 이동·조직 개편): @org_id(옮길 조직) · @parent_id(새 상위 번호)
--  assign (인사이동)         : @login_id(사람) · @to_org_id(새 소속 번호)
SET @org_id    := NULL;
SET @new_name  := NULL;
SET @parent_id := NULL;
SET @sort_order := NULL;
SET @login_id  := NULL;
SET @to_org_id := NULL;
-- ############################################################################

--  옛 이름 'new' 를 계속 받아 준다(문서·런북 호환). 이후로는 'add' 한 이름만 쓴다.
SET @op := IF(@op = 'new', 'add', @op);

-- ---------------------------------------------------------------------------
--  가드 방식: MySQL 은 스토어드 프로그램 밖에서 IF/THEN 도 SIGNAL 도 못 쓴다.
--  그래서 조건이 깨지면 '존재하지 않는 테이블명' 을 SELECT 하는 문장을 골라 일부러
--  ERROR 1146 을 내고, 테이블명 자리에 사람이 읽을 메시지를 넣는다.
--  ※ 식별자는 64자 제한. ※ Windows 는 ASCII 를 소문자로 바꿔 출력한다.
-- ---------------------------------------------------------------------------

-- ---------- 가드 A) 절단이 끝난 스키마인가 ----------
--  번호 컬럼 3종이 있어야 하고, 이름 미러 컬럼은 하나도 없어야 한다.
--  전자가 없으면 아래 문장이 ERROR 1054 로 죽고, 후자가 남아 있으면 이 파일이 채우지 않는
--  낡은 이름이 표에 남아 그걸 읽는 쪽이 틀린 트리를 그린다.
SET @n_new_cols := (SELECT COUNT(*) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND ((TABLE_NAME = 'org_unit' AND COLUMN_NAME IN ('org_id','parent_id'))
                         OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'org_id')));
SET @n_mirror := (SELECT COUNT(*) FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                     AND ((TABLE_NAME = 'org_unit' AND COLUMN_NAME = 'parent')
                       OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'org_unit')));
SET @g := CASE
  WHEN @n_new_cols <> 3 THEN 'SELECT 1 FROM `중단: org_id 전환 전 스키마다 - migrate-2026-08-24-org-id.sql 먼저`'
  WHEN @n_mirror <> 0   THEN 'SELECT 1 FROM `중단: 이름 미러 컬럼이 남아 있다 - 절단 마이그레이션이 덜 끝났다`'
  ELSE 'DO 0' END;
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 가드 B) @op 가 아는 값인가 ----------
--  오타(예: 'renmae')를 그냥 두면 아래 모든 CASE 가 'DO 0' 을 골라 **아무 일도 안 일어난 채
--  성공으로 끝난다**. 조용히 아무것도 안 하는 것이 가장 나쁜 실패라 여기서 막는다.
SET @g := IF(@op IN ('show','rename','add','move','assign'), 'DO 0',
             'SELECT 1 FROM `중단: @op 가 show/rename/add/move/assign 중 하나가 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ============================================================================
--  불변식 (사전) — org-ops.ps1 의 $SQL_INVARIANTS 와 **같은 여섯 · 같은 식**이다.
--    roots         parent_id IS NULL 인 조직 수(기대 1)
--    unreachable   루트에서 닿지 못하는 조직 수 — 순환·자기부모·섬을 한 번에 잡는다
--    name_bad      이름 표기 위반(앞뒤 ASCII 공백 · 전각 영숫자 · 눈에 보이지 않는 공백/
--                  제어문자 전부: U+3000 전각 공백 · NBSP · 탭·줄바꿈 · ZWSP · BOM …)
--                  — 비교는 BINARY
--    orphan        parent_id · app_user.org_id 가 없는 조직을 가리키는 수(FK 가 강제하지만 센다)
--    inactive_cut  숨긴 조직 밑의 살아 있는 **조직** 수
--    member_hidden 숨긴 조직에 소속된 살아 있는 **사람** 수
--  ★ member_hidden 이 왜 따로 있나 — inactive_cut 은 조직만 센다. '자식 조직까지 전부 숨겨서'
--    inactive_cut 을 0 으로 만들면 그 안의 사람은 살아 있는데 조직도(is_active=1 로 긁는다)에서
--    통째로 사라진다. 실측: 본부 하나를 숨기고 repair -DeactivateOrphanedChildren 로 '정리'하자
--    inactive_cut 2→0 인데 CTO 열람 89 → 69명, 게이트 3종 전부 exit 0 이었다.
--  ★ 재귀 상한 512 는 '순환 탐지'가 아니라 '폭주 방지'다 — 순환은 애초에 루트에서 도달
--    불가능하므로 상한과 무관하고, 얕으면 정상 트리를 오판한다(실측: 71단에서 옛 값 64 가 오탐).
--    apply.ps1 · 02-seed-org.sql · org-ops.ps1 · migrate-*.sql 이 전부 같은 512 를 쓴다.
--  ★ @b_* 로 붙들어 두는 이유: 커밋 조건이 '전부 0' 이 아니라 '실행 전보다 나빠지지 않았다'
--    이기 때문이다 — 이미 깨진 DB 에서 그것을 고치는 move 까지 막던 막다른 골목을 없앴다.
-- ============================================================================
--  이름 표기 금지 패턴 — 전각 영숫자와 **눈에 보이지 않는 공백·제어문자 전부**.
--  16진 바이트로 조립해 인코딩 사고에 견딘다(정규식 escape 는 못 쓴다 — mysql 클라이언트가
--  역슬래시를 먼저 먹는다, 실측).
--  ★ MySQL TRIM 은 ASCII 0x20 **하나만** 뗀다. 그래서 전각 공백(U+3000)·탭·NBSP 는 앞뒤에
--    붙어 있어도 TRIM 비교가 못 잡는다 — 그 구멍을 이 정규식이 메운다(위치 무관 검사).
--  ★★ 이 집합은 org-ops.ps1 $ORG_NAME_BAN · migrate · rollback · apply.ps1 · 02-seed-org.sql
--    이 **글자까지 같은 것**을 써야 한다. 갈리면 두 도구가 정반대 판정을 낸다(실측된 결함:
--    앞에 U+3000 이 붙은 이름을 이 파일은 커밋하고 org-ops.ps1 은 거부했다).
SET @fw_ban := CONCAT('[',
       CONVERT(0x00     USING utf8mb4), '-', CONVERT(0x1F     USING utf8mb4),  -- 제어문자 U+0000-001F (탭·줄바꿈 포함)
       CONVERT(0xC285   USING utf8mb4),                                        -- U+0085 NEL
       CONVERT(0xC2A0   USING utf8mb4),                                        -- U+00A0 NBSP
       CONVERT(0xE19A80 USING utf8mb4),                                        -- U+1680 OGHAM SPACE MARK
       CONVERT(0xE28080 USING utf8mb4), '-', CONVERT(0xE2808B USING utf8mb4),  -- U+2000-200A 각종 공백 + U+200B ZWSP
       CONVERT(0xE280A8 USING utf8mb4),      CONVERT(0xE280A9 USING utf8mb4),  -- U+2028 · U+2029 줄/문단 구분
       CONVERT(0xE280AF USING utf8mb4),      CONVERT(0xE2819F USING utf8mb4),  -- U+202F · U+205F
       CONVERT(0xE38080 USING utf8mb4),                                        -- ★ U+3000 전각 공백 (한글 IME 로 가장 쉽게 들어온다)
       CONVERT(0xEFBBBF USING utf8mb4),                                        -- U+FEFF BOM/ZWNBSP
       CONVERT(0xEFBC90 USING utf8mb4), '-', CONVERT(0xEFBC99 USING utf8mb4),  -- ０-９
       CONVERT(0xEFBCA1 USING utf8mb4), '-', CONVERT(0xEFBCBA USING utf8mb4),  -- Ａ-Ｚ
       CONVERT(0xEFBD81 USING utf8mb4), '-', CONVERT(0xEFBD9A USING utf8mb4),  -- ａ-ｚ
       ']');

SET @b_root_bad := ABS((SELECT COUNT(*) FROM org_unit WHERE parent_id IS NULL) - 1);
WITH RECURSIVE tree AS (
    SELECT org_id, 0 AS depth FROM org_unit WHERE parent_id IS NULL
    UNION ALL
    SELECT o.org_id, t.depth + 1 FROM org_unit o JOIN tree t ON o.parent_id = t.org_id
     WHERE t.depth < 512
) SELECT COUNT(*) INTO @n_reach FROM tree;
SET @b_unreachable := (SELECT COUNT(*) FROM org_unit) - @n_reach;
SET @b_name_bad := (SELECT COUNT(*) FROM org_unit
                     WHERE CAST(name AS BINARY) <> CAST(TRIM(name) AS BINARY) OR name REGEXP @fw_ban);
SET @b_orphan := (
    (SELECT COUNT(*) FROM org_unit c LEFT JOIN org_unit p ON p.org_id = c.parent_id
      WHERE c.parent_id IS NOT NULL AND p.org_id IS NULL)
  + (SELECT COUNT(*) FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id
      WHERE u.org_id IS NOT NULL AND o.org_id IS NULL));
SET @b_inactive_cut := (SELECT COUNT(*) FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id
                         WHERE c.is_active = 1 AND p.is_active = 0);
--  ★ 여섯 번째 — 숨긴 조직에 소속된 재직자. 조직 수만 세는 위 식이 못 보는 것이다.
SET @b_member_hidden := (SELECT COUNT(*) FROM app_user u JOIN org_unit o ON o.org_id = u.org_id
                          WHERE u.is_active = 1 AND o.is_active = 0);

-- ---------- 가드 C) 이미 깨진 트리 위에서 '고치지도 못할' 연산을 하지 않는다 ----------
--  경성 위반(루트·도달불가·이름표기·고아)이 있으면 rename/add/assign 은 시작하지 않는다.
--  move 와 show 는 언제나 허용한다 — move 가 그 상태를 푸는 유일한 수단이기 때문이다
--  (전면 차단으로 두면 탈출구가 손 SQL 밖에 없어진다. org-ops.ps1 이 같은 규칙을 쓴다).
--  ※ inactive_cut·member_hidden 은 애초에 차단 사유가 아니다 — 아래 연산별 선행조건이
--    '늘리는' 것만 막고(assign 은 숨긴 조직으로 사람을 보내지 않는다), 사후 검산 ②가
--    '실행 전보다 커졌는가'로 되돌린다.
SET @g := IF(@b_root_bad + @b_unreachable + @b_name_bad + @b_orphan = 0
             OR @op IN ('show','move'), 'DO 0',
             'SELECT 1 FROM `중단: 시작 전부터 트리/이름이 깨져 있다 - move 로 고치거나 org-ops.cmd repair`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 가드 D) 연산별 입력 검사 ----------
--  ★ 이름 유일성은 utf8mb4_0900_ai_ci 로 판정된다 — 대소문자·악센트를 구분하지 않는다.
--    'SW본부' 가 있으면 'sw본부' 는 uq_org_unit_name 에 걸려 ERROR 1062 로 거부된다.
--    여기서 미리, 사람 말로 막는다.
--  ★ 이름 표기(@name_fmt_bad)는 org-ops.ps1 의 Assert-OrgName 과 **같은 기준**이다 —
--    앞뒤 ASCII 공백 · @fw_ban(전각 영숫자 + 눈에 보이지 않는 공백/제어문자) · 50자 초과.
--    눈에 안 보이는 차이를 입구에서 막는다.
--    ※ 제어문자는 @fw_ban 에 U+0000-001F 로 들어 있다. 그래도 아래에 한 항을 더 두는 이유는
--      'Assert-OrgName 이 제어문자를 따로 본다'는 사실을 이 파일에서도 눈에 보이게 두기 위해서다
--      — 둘 중 하나가 나중에 좁아져도 나머지 하나가 남는다(두 도구의 판정이 갈리는 것이
--      이 파일이 존재하는 이유 그 자체다).
SET @tgt_exists := IF(@org_id IS NULL, 0, (SELECT COUNT(*) FROM org_unit WHERE org_id = @org_id));
SET @par_exists := IF(@parent_id IS NULL, 0, (SELECT COUNT(*) FROM org_unit WHERE org_id = @parent_id));
SET @par_hidden := IF(@parent_id IS NULL, 0, (SELECT COUNT(*) FROM org_unit WHERE org_id = @parent_id AND is_active = 0));
SET @tgt_active := IF(@org_id IS NULL, 0, (SELECT COUNT(*) FROM org_unit WHERE org_id = @org_id AND is_active = 1));
SET @dst_exists := IF(@to_org_id IS NULL, 0, (SELECT COUNT(*) FROM org_unit WHERE org_id = @to_org_id));
SET @dst_hidden := IF(@to_org_id IS NULL, 0, (SELECT COUNT(*) FROM org_unit WHERE org_id = @to_org_id AND is_active = 0));
--  ★ login_id 비교는 BINARY 다 — org-ops.ps1 이 그렇게 하므로, 여기서 ai_ci 로 두면
--    'HJLEE' 같은 값을 한쪽만 받아들여 두 도구의 판정이 갈린다.
SET @usr_exists := IF(@login_id IS NULL, 0,
                      (SELECT COUNT(*) FROM app_user
                        WHERE CAST(login_id AS BINARY) = CAST(@login_id AS BINARY)));
--  이름 중복: 자기 자신은 제외한다(같은 이름으로 다시 rename 하는 것은 무해한 no-op).
SET @name_dup := IF(@new_name IS NULL, 0,
                    (SELECT COUNT(*) FROM org_unit
                      WHERE name = @new_name AND (@org_id IS NULL OR org_id <> @org_id)));
SET @ctl_ban := CONCAT('[', CONVERT(0x00 USING utf8mb4), '-', CONVERT(0x1F USING utf8mb4), ']');
SET @name_fmt_bad := IF(@new_name IS NULL, 0,
                        (CAST(@new_name AS BINARY) <> CAST(TRIM(@new_name) AS BINARY)
                         OR @new_name REGEXP @fw_ban
                         OR @new_name REGEXP @ctl_ban
                         OR CHAR_LENGTH(@new_name) > 50));

SET @g := CASE @op
  WHEN 'rename' THEN
    CASE WHEN @tgt_exists = 0
           THEN 'SELECT 1 FROM `중단: rename - 그 번호의 조직이 없다 (@op=show 로 명부 확인)`'
         WHEN @new_name IS NULL OR @new_name = ''
           THEN 'SELECT 1 FROM `중단: rename - @new_name 이 비어 있다`'
         WHEN @name_fmt_bad
           THEN 'SELECT 1 FROM `중단: rename - 이름에 공백/전각/보이지 않는 문자가 있거나 50자를 넘는다`'
         WHEN @name_dup > 0
           THEN 'SELECT 1 FROM `중단: rename - 그 이름의 조직이 이미 있다 (대소문자 무시 비교)`'
         ELSE 'DO 0' END
  WHEN 'add' THEN
    CASE WHEN @new_name IS NULL OR @new_name = ''
           THEN 'SELECT 1 FROM `중단: add - @new_name 이 비어 있다`'
         WHEN @name_fmt_bad
           THEN 'SELECT 1 FROM `중단: add - 이름에 공백/전각/보이지 않는 문자가 있거나 50자를 넘는다`'
         WHEN @name_dup > 0
           THEN 'SELECT 1 FROM `중단: add - 그 이름의 조직이 이미 있다 (대소문자 무시 비교)`'
         WHEN @parent_id IS NULL OR @par_exists = 0
           THEN 'SELECT 1 FROM `중단: add - @parent_id 가 비었거나 그 조직이 없다`'
         WHEN @par_hidden > 0
           THEN 'SELECT 1 FROM `중단: add - 숨긴(is_active=0) 조직 밑에는 새 조직을 만들지 않는다`'
         WHEN @sort_order IS NULL
           THEN 'SELECT 1 FROM `중단: add - @sort_order 를 정해야 한다 (화면 표시 순서)`'
         ELSE 'DO 0' END
  WHEN 'move' THEN
    CASE WHEN @tgt_exists = 0
           THEN 'SELECT 1 FROM `중단: move - 옮길 조직 번호가 없다`'
         WHEN @parent_id IS NULL OR @par_exists = 0
           THEN 'SELECT 1 FROM `중단: move - @parent_id 가 비었거나 그 조직이 없다`'
         WHEN @parent_id = @org_id
           THEN 'SELECT 1 FROM `중단: move - 자기 자신을 부모로 지정했다`'
         WHEN @par_hidden > 0 AND @tgt_active > 0
           THEN 'SELECT 1 FROM `중단: move - 살아 있는 조직을 숨긴 조직 밑에 두지 않는다`'
         ELSE 'DO 0' END
  WHEN 'assign' THEN
    CASE WHEN @usr_exists <> 1
           THEN 'SELECT 1 FROM `중단: assign - 그 login_id 의 사용자가 없거나 둘 이상이다`'
         WHEN @to_org_id IS NULL OR @dst_exists = 0
           THEN 'SELECT 1 FROM `중단: assign - @to_org_id 가 비었거나 그 조직이 없다`'
         WHEN @dst_hidden > 0
           THEN 'SELECT 1 FROM `중단: assign - 숨긴(is_active=0) 조직으로는 보내지 않는다`'
         ELSE 'DO 0' END
  ELSE 'DO 0' END;
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 가드 E) move 순환 금지 ----------
--  자기 자손을 자기 부모로 지정하면 그 서브트리가 고리가 되어 루트에서 영영 닿지 않는다.
--  DB 는 막지 않는다(FK 는 '번호가 실재하는가' 만 본다). 아래 사후 검산이 어차피 잡지만,
--  여기서 먼저 막으면 아무것도 보내지 않고 끝난다(org-ops.ps1 도 같은 검사를 한다).
SET @cyc := IF(@op <> 'move' OR @org_id IS NULL OR @parent_id IS NULL, 0, (
  WITH RECURSIVE sub AS (
      SELECT org_id, 0 AS depth FROM org_unit WHERE org_id = @org_id
      UNION ALL
      SELECT o.org_id, s.depth + 1 FROM org_unit o JOIN sub s ON o.parent_id = s.org_id
       WHERE s.depth < 512
  )
  SELECT COUNT(*) FROM sub WHERE org_id = @parent_id));
SET @g := IF(@cyc = 0, 'DO 0',
             'SELECT 1 FROM `중단: move - 자기 자손 밑으로 옮기려 한다 (트리가 고리가 된다)`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ============================================================================
--  실행 — 한 덩어리 트랜잭션. 연산은 **한 문장**이다(미러가 없으니 함께 쓸 것이 없다).
-- ============================================================================
START TRANSACTION;

SET @s1 := CASE @op
  WHEN 'rename' THEN 'UPDATE org_unit SET name = @new_name WHERE org_id = @org_id'
  WHEN 'add'    THEN 'INSERT INTO org_unit (name, parent_id, sort_order, is_active)
                        SELECT @new_name, p.org_id, @sort_order, 1
                          FROM (SELECT org_id FROM org_unit) p WHERE p.org_id = @parent_id'
  WHEN 'move'   THEN 'UPDATE org_unit SET parent_id = @parent_id WHERE org_id = @org_id'
  WHEN 'assign' THEN 'UPDATE app_user SET org_id = @to_org_id
                       WHERE CAST(login_id AS BINARY) = CAST(@login_id AS BINARY)'
  ELSE 'DO 0' END;
--  ★ ROW_COUNT()·LAST_INSERT_ID() 는 EXECUTE **직후에** 붙든다. DEALLOCATE 도 하나의
--    문장이라 그 뒤에서 읽으면 방금 한 일이 아니라 DEALLOCATE 의 결과를 읽게 된다.
PREPARE _s FROM @s1;
EXECUTE _s;
SET @rc_main := ROW_COUNT();
SET @newid   := LAST_INSERT_ID();
DEALLOCATE PREPARE _s;

-- ---------- 사후 검산 ① 의도한 결과가 실제로 났는가 ----------
--  ★ ROW_COUNT() 가 아니라 **최종 상태**를 본다. 같은 값으로 다시 실행하면 바뀐 행이 0 인데
--    그건 실패가 아니다(멱등). 반대로 대상이 사라졌으면 최종 상태도 0 이라 여기서 잡힌다.
--  ★ add 는 @rc_main 을 함께 본다 — LAST_INSERT_ID() 는 0행 INSERT 뒤에도 직전 값이
--    그대로 남아서(실측), 번호만 보면 없는 부모로 신설해도 통과한다.
SET @outcome := CASE @op
  WHEN 'show'   THEN 1
  WHEN 'rename' THEN (SELECT COUNT(*) FROM org_unit
                       WHERE org_id = @org_id AND CAST(name AS BINARY) = CAST(@new_name AS BINARY))
  WHEN 'add'    THEN IF(@rc_main = 1 AND (SELECT COUNT(*) FROM org_unit
                          WHERE org_id = @newid AND parent_id = @parent_id
                            AND CAST(name AS BINARY) = CAST(@new_name AS BINARY)) = 1, 1, 0)
  WHEN 'move'   THEN (SELECT COUNT(*) FROM org_unit WHERE org_id = @org_id AND parent_id = @parent_id)
  WHEN 'assign' THEN (SELECT COUNT(*) FROM app_user
                       WHERE CAST(login_id AS BINARY) = CAST(@login_id AS BINARY) AND org_id = @to_org_id)
  ELSE 0 END;
SET @g := IF(@outcome = 1, 'DO 0',
             'SELECT 1 FROM `중단(되돌림): 의도한 변경이 일어나지 않았다 - 커밋하지 않았다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 사후 검산 ② 불변식이 나빠지지 않았는가 ----------
--  ★ 검산이 COMMIT **앞**에 있어야 한다. 뒤에 있으면 '틀렸다' 를 알아도 이미 늦다.
--    어긋나면 위 가드와 같은 방식으로 ERROR 1146 이 나고 → mysql 이 그 자리에서 죽고 →
--    세션이 끊기고 → InnoDB 가 이 트랜잭션을 되돌린다(실측 확인).
--  ★ 여섯 식은 위 사전 계산과 **글자까지 같아야** 한다. 사전과 사후가 다른 눈이면
--    '내가 깬 것' 을 사후 검산이 못 본다 — 검산이 있다는 사실만 남는다.
SET @a_root_bad := ABS((SELECT COUNT(*) FROM org_unit WHERE parent_id IS NULL) - 1);
WITH RECURSIVE tree AS (
    SELECT org_id, 0 AS depth FROM org_unit WHERE parent_id IS NULL
    UNION ALL
    SELECT o.org_id, t.depth + 1 FROM org_unit o JOIN tree t ON o.parent_id = t.org_id
     WHERE t.depth < 512
) SELECT COUNT(*) INTO @n_reach FROM tree;
SET @a_unreachable := (SELECT COUNT(*) FROM org_unit) - @n_reach;
SET @a_name_bad := (SELECT COUNT(*) FROM org_unit
                     WHERE CAST(name AS BINARY) <> CAST(TRIM(name) AS BINARY) OR name REGEXP @fw_ban);
SET @a_orphan := (
    (SELECT COUNT(*) FROM org_unit c LEFT JOIN org_unit p ON p.org_id = c.parent_id
      WHERE c.parent_id IS NOT NULL AND p.org_id IS NULL)
  + (SELECT COUNT(*) FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id
      WHERE u.org_id IS NOT NULL AND o.org_id IS NULL));
SET @a_inactive_cut := (SELECT COUNT(*) FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id
                         WHERE c.is_active = 1 AND p.is_active = 0);
SET @a_member_hidden := (SELECT COUNT(*) FROM app_user u JOIN org_unit o ON o.org_id = u.org_id
                          WHERE u.is_active = 1 AND o.is_active = 0);

SET @g := IF(@a_root_bad <= @b_root_bad AND @a_unreachable <= @b_unreachable
         AND @a_name_bad <= @b_name_bad AND @a_orphan <= @b_orphan
         AND @a_inactive_cut <= @b_inactive_cut
         AND @a_member_hidden <= @b_member_hidden, 'DO 0',
             'SELECT 1 FROM `중단(되돌림): 이 연산이 트리 불변식을 악화시켰다 - 커밋하지 않았다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

COMMIT;

-- ============================================================================
--  결과 — 눈으로 볼 것. 부모 이름은 저장된 값이 아니라 **조인 결과**다(미러가 없다).
-- ============================================================================
SELECT o.org_id, o.name, o.parent_id, p.name AS parent_name, o.sort_order, o.is_active,
       (SELECT COUNT(*) FROM app_user u WHERE u.org_id = o.org_id) AS n_members
  FROM org_unit o LEFT JOIN org_unit p ON p.org_id = o.parent_id
 ORDER BY o.org_id;

-- 불변식 요약. 기대: n_root=1 · 나머지 전부 0
--  ★ 위 검산과 **같은 식**이어야 한다. 여기만 다른 눈으로 두면 차단은 제대로 되는데
--    사람이 읽는 요약만 '전부 0' 이라 거짓 안심을 준다.
SELECT (SELECT COUNT(*) FROM org_unit WHERE parent_id IS NULL) AS n_root,
       @a_unreachable    AS unreachable,
       @a_name_bad       AS name_bad,
       @a_orphan         AS orphan,
       @a_inactive_cut   AS inactive_cut,
       @a_member_hidden  AS member_hidden;

-- ============================================================================
--  [부록] 이 파일이 다루지 **않는** 것
--   · 조직 폐지 — 하드 삭제가 아니라 `UPDATE org_unit SET is_active = 0`. 행을 지우면 과거
--     소속 표기가 사라지고, 하위 조직·소속자가 있으면 ON DELETE RESTRICT 로 어차피 1451 이다.
--     ※ 폐지 뒤 '숨긴 부모 밑의 살아 있는 자식' 이 남을 수 있다 — org-ops.cmd 로 확인할 것.
--   · repair — 이름 앞뒤 공백 제거 · 숨긴 조직 밑 서브트리 정리는 org-ops.cmd repair 소관.
--   · 사람 추가·권한 변경 — taskmgr-company-data 의 03/04 소관(apply.cmd -SkipSchema).
--   · sort_order 만 바꾸기 — 트리와 무관하다:  UPDATE org_unit SET sort_order=? WHERE org_id=?;
-- ============================================================================
