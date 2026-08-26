-- ============================================================================
--  rollback-2026-08-24-org-id.sql — migrate-2026-08-24-org-id.sql(완전 절단판)을 되돌린다
--    (org_unit PK: org_id → name · parent · app_user.org_unit **재생성** · 구 FK 2개 복원)
--
--  ★ 이 파일이 존재하는 이유
--    마이그레이션은 **DDL 이라 롤백이 없다.** 중간에 죽어도 트랜잭션이 되돌려 주지 않는다.
--    그런데 "되돌리려면 덤프를 다시 부으세요" 라고만 적어 두면, 되돌리는 사이에 들어온
--    **정상 변경(과제·일정·근태)까지 함께 되돌아간다** — 조직 하나 때문에 그날의 업무
--    데이터를 버리는 대응이 된다. 그래서 '조직 컬럼만 되돌리는' 경로를 파일로 둔다.
--
--  ★★ A판 롤백과 결정적으로 다른 점 — 미러가 없으므로 **재생성**한다
--    A판(확장-수축)은 구 컬럼(org_unit.parent · app_user.org_unit)을 미러로 남겨 뒀기 때문에
--    되돌리기가 '새로 만든 셋을 걷어내면 끝' 이었다. 대신 그 미러가 틀려 있으면 되돌리기가
--    **틀린 미러를 유일한 진실로 승격**시키는 최악의 경로가 됐다(실측된 결함).
--    절단판은 구 컬럼을 지웠으므로, 되돌리기는 그 두 컬럼을 정본에서 **다시 만들어 낸다**:
--        org_unit.parent   := (parent_id 가 가리키는 조직의 name)
--        app_user.org_unit := (org_id 가 가리키는 조직의 name)
--    → 그래서 이 판의 롤백에는 '승격시킬 미러' 자체가 없다. 정본 하나에서 유도할 뿐이다.
--
--  ★★★ 재생성이 **원본과 한 글자도 다르지 않다**는 근거
--    마이그레이션이 구 컬럼을 지우기 직전에 [8단계 절단 관문]을 통과했기 때문이다.
--    그 관문은 지우기 전에 딱 하나를 확인한다 —
--      '정본만으로 구 컬럼의 모든 값을 **BINARY** 로 완전히 재현할 수 있는가'.
--    네 검사(양쪽 NULL 일치 2 + BINARY 이름 일치 2)가 전부 0 이라야 지웠다. 즉 지워진 값은
--    정의상 정본에서 유도 가능한 값뿐이다. 그것이 이 파일이 무손실인 이유이고,
--    아래 (R5 관문)이 재생성 직후 같은 것을 다시 세어 확인한다.
--
--  ★ 이 파일은 **A판 상태의 DB 에도 쓸 수 있다**(구 컬럼이 아직 남아 있는 DB).
--    그때 R1~R4 는 no-op 이 되고(이미 값이 있다) 나머지가 그대로 돈다. 즉 이 한 파일이
--    'A판 되돌리기'와 '절단판 되돌리기'를 모두 처리한다.
--
--  ★★★★ 언제 쓰면 안 되나 — 되돌리면 잃는 것
--    · **org_id 자체를 참조하는 무언가를 새로 만들었다면** 그건 사라진다.
--      (이 문서를 쓰는 시점에는 그런 것이 없다 — 캘린더 데이터 cal_* 는 user_id 만 쓴다.
--       확인 방법은 파일 끝 [되돌리기 전 확인].)
--    · 절단 이후에 조직을 **개명**했다면, 되돌린 뒤에는 그 이름이 부모 문자열·소속 문자열에도
--      퍼져 나간 상태로 복원된다(정본에서 유도하므로 당연히 새 이름이다). 그건 손실이 아니라
--      '현재 조직도의 정확한 표현'이다. 다만 그 뒤로는 다시 fk_org_parent 가 서므로,
--      **하위 조직을 가진 노드의 개명이 다시 ERROR 1451 로 막힌다**. 그게 원래 상태다.
--
--  [적용] — 네 걸음. 1) 을 건너뛰지 말 것.
--
--    1) ★ 실행 전 mysqldump 필수. 이 파일은 **마이그레이션이 한 일**만 되돌린다 —
--       그 뒤에 사람이 저지른 조직 변경까지 되돌려 주지는 않는다. 어디로 돌아갈지 고르려면
--       스냅샷이 있어야 한다.
--         mysqldump -u root -p --default-character-set=utf8mb4 --single-transaction \
--                   --routines --triggers --events taskmgr > taskmgr-<날짜>.sql
--       정식 경로(검증·회전·해시 대조까지 한다):  db/deploy/backup-taskmgr.ps1
--         (또는 backup-taskmgr.cmd) — 실패 코드의 의미와 **복원 절차**는
--         db/deploy/README.md 의 '### 복구' 절에 있다.
--
--    2) 마이그레이션 전 지문을 손에 쥔다. migrate-2026-08-24-org-id.sql 은 시작하자마자
--       (P0) 으로 org_unit·app_user 의 전 컬럼 SHA-256 두 줄을 찍는다 — 그 실행 로그의 두 줄이
--       '원래 상태'의 정의다.
--       ★ 절단판에서는 그 두 값을 **나중에 다시 계산할 수 없다**(구 컬럼이 없으니 계산식이
--         성립하지 않는다). 로그를 잃었다면 1) 의 덤프에서 뽑는 수밖에 없다.
--
--    3) mysql -u root -p --default-character-set=utf8mb4 taskmgr < rollback-2026-08-24-org-id.sql
--       ※ --force 를 붙이지 말 것. 이 파일도 '에러로 멈추는' 방식으로 자신을 보호한다.
--         특히 [R-가드 2]와 [R5 관문]이 무력화되면 **재생성이 반쪽인 채로 정본을 지우게 된다**.
--       ※ 종료코드를 볼 것. 파일 끝 [R-E6 차단]이 반쪽 롤백을 exit 1 로 끝낸다.
--
--       ★★★ 3-a) **백업 프로세스가 끝난 뒤에** 시작할 것 — 겹치면 89대가 함께 멈춘다
--         1) 의 mysqldump 는 --single-transaction 이라 읽기 트랜잭션을 하나 열어 둔 채로 돈다.
--         그 트랜잭션이 org_unit·app_user 의 메타데이터 락(MDL)을 쥐고 있으면 이 파일의 ALTER 가
--         그 뒤에 줄을 서고, **그 줄 뒤의 평범한 SELECT 까지 전부 막힌다**(실측: 홀더 20초 ·
--         배포본 조직 트리 질의 12,127ms 무응답). 덤프가 완전히 끝난 것을 확인하고 시작한다.
--
--       ★★★ 3-b) 시작 직전 — 열린 트랜잭션이 0건인지 확인할 것
--           SELECT * FROM information_schema.innodb_trx;
--         0행이어야 한다. 이 파일은 맨 앞에서 SET SESSION lock_wait_timeout = 10 을 걸어 두므로,
--         홀더가 있으면 **10초 뒤 ERROR 1205 로 멈춘다**. 홀더를 치우고 다시 돌리면 된다
--         (전 단계가 멱등이고, 멈추는 자리는 언제나 R 단계 경계다).
--         ※ 정확히 말하면 — migrate 파일은 첫 문장이 곧 ALTER org_unit 이라 홀더가 있으면
--           **DDL 0건**으로 멈춘다. 이 파일은 R1·R2 가 app_user 만 건드리므로, 홀더가
--           **org_unit 에만** 걸려 있으면 R1(컬럼 재생성)·R2(백필)까지는 통과하고 R3 에서
--           1205 가 난다(실측: 10,119ms · 중단 지점 = R2 직후). 그 상태는 이 파일이 스스로
--           재개할 수 있는 지점이고, 홀더를 치운 뒤 재실행하면 원본이 **바이트 단위로**
--           복원된다(실측). 홀더가 app_user 에 걸려 있으면 R1 에서 막혀 DDL 0건이다.
--
--       ★★★ 3-c) 멈춘 것처럼 보이면 — Ctrl-C 를 누르기 전에 **다른 세션에서** 볼 것
--           SHOW PROCESSLIST;   -- 'Waiting for table metadata lock' 이면 위 3-b) 다
--           SELECT * FROM information_schema.innodb_trx;
--         (Ctrl-C 자체는 안전함이 실측됐다 — 대기 중 클라이언트를 죽여도 스키마 무변경, 재실행 정상.)
--
--    4) 출력 (R-E5) 의 두 지문이 2) 의 값과 **글자까지 같은지** 대조한다.
--       (실측 2026-08-24, MySQL 8.4.9, 실 taskmgr 복제본: migrate → 이 파일 실행 후
--        org_unit_fp · app_user_fp 가 마이그레이션 전과 완전 동일. 컬럼 순서·컬럼 정의·PK·
--        fk_org_parent·fk_user_org·ix_org_parent·ix_user_org 도 전부 복원.
--        migrate→rollback→migrate→rollback 왕복 2회 뒤에도 두 지문이 그대로였다.
--        updated_at 도 밀리지 않는다 — 백필이 updated_at = updated_at 로 억제하고,
--        DDL 은 애초에 ON UPDATE CURRENT_TIMESTAMP 를 발동시키지 않는다.)
--       두 값이 다르면 롤백이 데이터를 건드린 것이거나, 마이그레이션 이후 사람이 데이터를
--       바꾼 것이다. 후자는 정당할 수 있다 — 무엇이 바뀌었는지 확인하고 판단할 것.
--
--    ★ 딱 하나 원상 복구되지 **않는** 것: SHOW CREATE TABLE app_user 의 **인덱스 나열 순서**.
--      원본은  PRIMARY · uq_app_user_login_id · ix_user_org · ix_user_active · fk_user_title
--      롤백 후는 PRIMARY · uq_app_user_login_id · ix_user_active · fk_user_title · ix_user_org
--      (실측 diff: 그 한 줄의 위치만 다르다. 다른 차이는 없다.)
--      이유: SHOW CREATE 의 인덱스 순서는 **생성 순서**다. org_unit 컬럼이 마이그레이션에서
--      지워졌다가 여기서 다시 생기므로 그 인덱스는 마지막에 만들어질 수밖에 없다.
--      표를 통째로 재구축하지 않는 한 되돌릴 방법이 없고, 되돌릴 값어치도 없다 —
--      인덱스 이름·컬럼·유일성·용도가 모두 같아서 **동작·성능·제약 어느 것도 달라지지 않는다**.
--      다만 두 DB 의 mysqldump 를 텍스트로 diff 하면 그 한 줄이 어긋나 보인다는 점은 알아 둘 것.
--      (org_unit 쪽은 PRIMARY · ix_org_parent 순서까지 원본과 완전히 같다.)
--    ※ 되돌린 뒤 taskmgr-company-data/apply.cmd 는 **-SkipSchema 로 돌리면 안 된다**
--      (02·03 이 org_id 를 전제한다 — apply.ps1 이 선행검사로 막는다).
--  멱등: 이미 되돌아간 DB 에서는 모든 단계가 no-op 이다. 중단된 실행의 재개도 된다 —
--    각 단계가 자기 결과를 information_schema 나 데이터로 따로 확인하고, 있을 수도 없을 수도
--    있는 컬럼을 읽는 검사는 전부 PREPARE 안에 둔다(ERROR 1054 로 죽지 않는다).
-- ============================================================================
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
--  ★★★ 락 대기 상한 — migrate 파일과 **같은 값**이어야 한다 (실측된 결함)
--    MySQL 8.4 의 기본값은 @@lock_wait_timeout = 31536000 = **1년**이다(실측). 이 값이
--    메타데이터 락(MDL) 대기의 상한이고, ALTER TABLE 이 기다리는 것이 바로 그것이다.
--    (@@innodb_lock_wait_timeout = 50 은 행 락 상한이라 여기서는 아무 역할도 하지 않는다.)
--    열린 트랜잭션이 하나 있으면 이 파일의 첫 ALTER 가 1년까지 기다리고, **그 뒤에 줄 선
--    89대의 질의가 전부 함께 멈춘다**(실측: 홀더 20초 · 배포본 질의 12,127ms 무응답).
--    → 10초로 자른다. 홀더가 있으면 **ERROR 1205 로 멈춘다**(실측 10,090~10,119ms).
--      멈추는 자리는 언제나 R 단계 경계이고, 홀더를 치우고 다시 돌리면 원본이 바이트 단위로
--      복원된다(실측). 어디서 멈추는지는 [적용] 3-b) 의 ※ 참조 —
--      홀더가 app_user 에 있으면 R1 에서(DDL 0건), org_unit 에만 있으면 R3 에서 멈춘다.
--    ※ SESSION 이므로 이 접속에만 적용된다 — 서버 설정을 바꾸지 않는다.
-- ---------------------------------------------------------------------------
SET SESSION lock_wait_timeout = 10;

-- ---------- 상태 탐지 ----------
--  되돌리기도 여러 DDL 이라 중간 상태가 실재한다. 지금 어디인지 먼저 안다.
SET @has_org_id       := (SELECT COUNT(*) FROM information_schema.COLUMNS
                           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
                             AND COLUMN_NAME = 'org_id');
SET @has_parent_id    := (SELECT COUNT(*) FROM information_schema.COLUMNS
                           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
                             AND COLUMN_NAME = 'parent_id');
SET @has_parent_col   := (SELECT COUNT(*) FROM information_schema.COLUMNS
                           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
                             AND COLUMN_NAME = 'parent');
SET @has_user_org_id  := (SELECT COUNT(*) FROM information_schema.COLUMNS
                           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                             AND COLUMN_NAME = 'org_id');
SET @has_user_org_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                             AND COLUMN_NAME = 'org_unit');
SELECT @has_org_id AS has_org_id, @has_parent_id AS has_parent_id,
       @has_parent_col AS old_parent_col, @has_user_org_id AS has_user_org_id,
       @has_user_org_col AS old_user_org_col;

-- ---------- R-가드 1) 되돌릴 것이 있는가 = 이 파일 전체의 우회 스위치 ----------
--  org_unit.org_id 가 없으면 이미 전환 전 상태다. 그냥 조용히 끝낸다(에러가 아니다).
--  ※ 아래 모든 단계가 자기 조건을 따로 보므로 여기서 분기하지 않는다. @has_org_id = 0 이면
--    R1~R15 전부가 no-op 이고, [R-E6 차단]은 옛 스키마를 확인하고 통과한다.

-- ---------- R-가드 2) ★★ 정본이 성립하는가 — 재생성의 입력을 먼저 검사한다 ----------
--  되돌리기는 정본(parent_id · app_user.org_id)에서 이름을 **유도**한다. 그러므로 정본이
--  틀려 있으면 그 틀림이 그대로 이름에 새겨진다 — 그것도 조용히. 재생성 **전에** 본다.
--    · 고아(FK 가 지켜야 하지만 반입본·복구본에서는 느슨할 수 있다)
--    · 루트 정확히 1개
--    · 순환/도달불가 0  ← ★ FK 가 막지 못하는 유일한 붕괴. 이게 있으면 되돌린 뒤에도
--      fk_org_parent 는 만족되지만(모든 이름이 실재하므로) 트리는 여전히 고리다.
--    · 이름 표기 정규화(앞뒤 ASCII 공백 · 전각 영숫자 · **눈에 보이지 않는 공백·제어문자**
--      — 전각 공백 U+3000 · NBSP · 탭 · ZWSP · BOM …) — 이제 이름이 조직명 한 곳뿐이라
--      오염되면 재생성값이 그 오염을 두 컬럼에 복제한다.
--      ※ MySQL TRIM 은 ASCII 0x20 만 뗀다 — 나머지는 전부 @fw_ban 정규식이 본다.
--    · 비활성 조직에 남은 재직자(member_hidden) — **세어서 찍기만 하고 막지는 않는다.**
--      되돌리기는 is_active 를 건드리지 않으므로 이 상태를 만들지도 옮기지도 않는다.
--      그런데 다른 게이트(migrate [E9] · apply.ps1 · org-ops)는 전부 이걸로 멈추므로,
--      되돌린 뒤 그 게이트들에 걸릴 것을 **여기서 미리 알려 주는** 것이 이 값의 쓸모다.
--      ★ 막지 않는 이유: 되돌리기는 탈출구다. 탈출구를 이 값으로 잠그면 '전환도 못 하고
--        되돌리지도 못하는' 막다른 골목이 생긴다(org-ops 가 F13 에서 겪은 그 골목이다).
--  ★ 계층을 어느 컬럼으로 읽는가: 아래 [R-가드 2-pre] 가 고른 @use_name_path 를 따른다.
--    이름 경로 JOIN 은 BINARY 다.
--  ※ 깊이 상한 512 의 뜻은 migrate 파일 [가드 5] ★★ 참조. 세 게이트가 같은 값을 써야 한다.
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

-- ---------- R-가드 2-pre) ★★ 계층 출처 선택 — migrate [가드 5-pre] 와 **같은 규칙** ----------
--  ★★★ 실측된 결함(2026-08-25) — 옛 판은 '컬럼이 있으면 정본' 으로 골랐다
--    옛 조건은 IF(@has_parent_id = 1, parent_id 경로, parent 경로) 였다. 그런데 마이그레이션이
--    **4단계(parent_id 신설)와 5단계(백필) 사이에서 죽은 DB** 는 parent_id 가 있지만 전부 NULL
--    이다. 그 상태에서 parent_id 로 읽으면 12개가 전부 루트로 보여
--      `중단: 루트가 1개가 아니다 - 되돌리기 전에 조직도부터 고칠 것`
--    으로 **오진단**하고 되돌리기를 거부했다. 데이터는 완전무결하다(parent 가 그대로 있다).
--  ★ 거울상 상태도 있다 — 이 파일이 R3(컬럼만 재생성)까지 돌고 죽으면 parent 는 있지만
--    **전부 NULL** 이고 parent_id 가 정본이다. 그래서 '컬럼이 있는가' 가 아니라
--    **'값이 실제로 들어 있는가'** 로 고른다. 두 파일이 같은 규칙을 써야 판정이 갈리지 않는다.
SET @q := IF(@has_parent_col = 1 AND @has_parent_id = 1,
  'SELECT SUM(parent IS NOT NULL), SUM(parent_id IS NOT NULL)
     INTO @h_pname_set, @h_pid_set FROM org_unit',
  'SELECT NULL, NULL INTO @h_pname_set, @h_pid_set');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
--  백필 미완 = 구 컬럼에는 값이 있는데 parent_id 는 전부 NULL (migrate 4단계 직후에서 끊긴 흔적)
SET @backfill_pending := IF(@has_parent_col = 1 AND @has_parent_id = 1
                            AND IFNULL(@h_pid_set, 0) = 0 AND IFNULL(@h_pname_set, 0) > 0, 1, 0);
--  재생성 미완 = 구 컬럼이 껍데기(전부 NULL)인데 parent_id 에는 값이 있다 (이 파일 R3 직후)
SET @regen_pending    := IF(@has_parent_col = 1 AND @has_parent_id = 1
                            AND IFNULL(@h_pname_set, 0) = 0 AND IFNULL(@h_pid_set, 0) > 0, 1, 0);
SET @use_name_path    := IF(@has_parent_col = 1 AND @regen_pending = 0, 1, 0);
--  ★ app_user 쪽에도 같은 '백필 미완' 이 있다 — migrate 6단계(org_id 신설)와 7단계(백필) 사이.
--    그때 org_id 는 있지만 전부 NULL 이고 소속의 정본은 org_unit(이름)이다.
SET @q := IF(@has_user_org_col = 1 AND @has_user_org_id = 1,
  'SELECT SUM(org_unit IS NOT NULL), SUM(org_id IS NOT NULL)
     INTO @h_uname_set, @h_uid_set FROM app_user',
  'SELECT NULL, NULL INTO @h_uname_set, @h_uid_set');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @u_backfill_pending := IF(@has_user_org_col = 1 AND @has_user_org_id = 1
                              AND IFNULL(@h_uid_set, 0) = 0 AND IFNULL(@h_uname_set, 0) > 0, 1, 0);
--  ★ 사람이 로그에서 읽을 한 줄. 오진 문구 대신 이 줄이 나와야 한다.
SELECT CASE
         WHEN @backfill_pending = 1
           THEN 'migrate 5단계 백필 미완 - 재개 중 (계층 출처 = 구 컬럼 parent). 되돌릴 것이 없다'
         WHEN @regen_pending = 1
           THEN 'R4 재생성 미완 - 재개 중 (계층 출처 = parent_id). 이 실행이 R4 를 마저 돌린다'
         WHEN @use_name_path = 1 THEN '되돌리기 전/중 - 계층 출처 = 구 컬럼 parent'
         ELSE '절단 상태 - 계층 출처 = parent_id'
       END AS hierarchy_source,
       CAST(IFNULL(@h_pname_set, -1) AS SIGNED) AS parent_name_filled, CAST(IFNULL(@h_pid_set, -1) AS SIGNED) AS parent_id_filled,
       @u_backfill_pending AS user_backfill_pending;

SET @q := IF(@use_name_path = 0,
  'WITH RECURSIVE tree AS (
       SELECT org_id, 0 AS depth FROM org_unit WHERE parent_id IS NULL
       UNION ALL
       SELECT o.org_id, t.depth + 1 FROM org_unit o JOIN tree t ON o.parent_id = t.org_id
        WHERE t.depth < 512)
   SELECT COUNT(*) INTO @rb_reach FROM tree',
  'WITH RECURSIVE tree AS (
       SELECT name, 0 AS depth FROM org_unit WHERE parent IS NULL
       UNION ALL
       SELECT o.name, t.depth + 1 FROM org_unit o JOIN tree t
              ON CAST(o.parent AS BINARY) = CAST(t.name AS BINARY)
        WHERE t.depth < 512)
   SELECT COUNT(*) INTO @rb_reach FROM tree');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @rb_unreach := (SELECT COUNT(*) FROM org_unit) - @rb_reach;

SET @q := IF(@use_name_path = 0,
  'SELECT COUNT(*) FROM org_unit WHERE parent_id IS NULL INTO @rb_root',
  'SELECT COUNT(*) FROM org_unit WHERE parent    IS NULL INTO @rb_root');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;

--  고아 검사도 같은 출처를 쓴다. 이름 경로일 때는 BINARY 로 센다(migrate [가드 3]과 같은 식).
SET @q := IF(@use_name_path = 0,
  'SELECT COUNT(*) FROM org_unit c WHERE c.parent_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM (SELECT org_id FROM org_unit) p WHERE p.org_id = c.parent_id)
   INTO @rb_org_orphan',
  'SELECT COUNT(*) FROM org_unit c WHERE c.parent IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM (SELECT name FROM org_unit) p
                      WHERE CAST(p.name AS BINARY) = CAST(c.parent AS BINARY))
   INTO @rb_org_orphan');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;

SET @q := IF(@has_user_org_id = 1 AND @has_org_id = 1,
  'SELECT COUNT(*) FROM app_user u WHERE u.org_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM org_unit o WHERE o.org_id = u.org_id)
   INTO @rb_user_orphan',
  'SELECT 0 INTO @rb_user_orphan');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;

SET @rb_name_bad := (SELECT COUNT(*) FROM org_unit
                      WHERE CAST(name AS BINARY) <> CAST(TRIM(name) AS BINARY)
                         OR name REGEXP @fw_ban);

--  ★ 보고 전용(막지 않는다 — 위 머리말 참조). 소속 컬럼이 어느 쪽인지에 따라 경로가 갈린다.
SET @q := CASE
  WHEN @has_user_org_id = 1 AND @has_org_id = 1 THEN
    'SELECT COUNT(*) FROM app_user u JOIN org_unit o ON o.org_id = u.org_id
       WHERE u.is_active = 1 AND o.is_active = 0 INTO @rb_member_hidden'
  WHEN @has_user_org_col = 1 THEN
    'SELECT COUNT(*) FROM app_user u JOIN org_unit o
            ON CAST(o.name AS BINARY) = CAST(u.org_unit AS BINARY)
       WHERE u.is_active = 1 AND o.is_active = 0 INTO @rb_member_hidden'
  ELSE 'SELECT 0 INTO @rb_member_hidden' END;
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;

SELECT @rb_root AS root_count, @rb_unreach AS unreachable, @rb_org_orphan AS orphan_org,
       @rb_user_orphan AS orphan_user, @rb_name_bad AS name_bad,
       @rb_member_hidden AS member_hidden_report_only;
SET @g := CASE
  WHEN @rb_root = 1 AND IFNULL(@rb_unreach, 1) = 0 AND @rb_org_orphan = 0
       AND @rb_user_orphan = 0 AND @rb_name_bad = 0 THEN 'DO 0'
  WHEN @rb_org_orphan + @rb_user_orphan > 0
    THEN 'SELECT 1 FROM `중단: 정본에 고아가 있다 - 재생성하면 그 고아가 이름으로 새겨진다`'
  WHEN @rb_root <> 1
    THEN 'SELECT 1 FROM `중단: 루트가 1개가 아니다 - 되돌리기 전에 조직도부터 고칠 것`'
  WHEN IFNULL(@rb_unreach, 1) > 0
    THEN 'SELECT 1 FROM `중단: 루트에서 도달 못하는 조직이 있다 (순환/섬) - 먼저 고칠 것`'
  ELSE 'SELECT 1 FROM `중단: 조직 이름에 공백/전각/보이지 않는 문자가 있다 - 재생성이 복제한다`'
  END;
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ============================================================================
--  되돌리기 — ① 구 컬럼 재생성 → ② 관문 → ③ 새 컬럼/키 철거 → ④ 구 키 복원
--
--  ★ 순서가 A판과 반대다. A판은 '걷어내기'가 전부여서 마이그레이션의 역순(10→1)이면 됐다.
--    절단판은 **먼저 되살리고 나중에 걷어낸다** — 걷어낸 뒤에는 되살릴 입력이 없기 때문이다.
-- ============================================================================

-- ---------- R1) app_user.org_unit 컬럼 재생성 (컬럼만. 값은 R2) ----------
--  ★ AFTER title 인 이유: 마이그레이션 6단계가 org_id 를 정확히 그 자리(title 뒤)에 넣었다.
--    여기에 org_unit 을 넣으면 (…, title, org_unit, org_id, …) 가 되고, R7 이 org_id 를 지우면
--    (…, title, org_unit, view_scope, …) — **마이그레이션 전과 완전히 같은 순서**가 된다.
--    (실측 확인. 컬럼 순서는 SELECT * 를 쓰는 도구·덤프 비교·SHOW CREATE 대조에 전부 영향을 준다.)
--  ★ 정의를 원본과 글자까지 맞춘다: varchar(50) NULL DEFAULT NULL.
--    콜레이션은 지정하지 않는다 — 표 기본값(utf8mb4_0900_ai_ci)을 그대로 물려받아야
--    SHOW CREATE TABLE 에 컬럼별 콜레이션 절이 붙지 않는다(원본과 같아진다).
SET @s := IF(@has_user_org_col = 0,
  'ALTER TABLE app_user ADD COLUMN org_unit VARCHAR(50) NULL DEFAULT NULL AFTER title',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @has_user_org_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                             AND COLUMN_NAME = 'org_unit');

-- ---------- R2) app_user.org_unit 재생성(백필): org_id → 조직 이름 ----------
--  ★ org_id 가 NULL 인 사람(소속 미등록)은 매칭되지 않아 org_unit 도 NULL 로 남는다 — 의도다.
--    마이그레이션 7단계의 정확한 역연산이다.
--  ★ WHERE org_unit IS NULL: 이미 값이 있으면 덮지 않는다(A판 상태의 DB 에서 이 파일을 돌리면
--    여기가 0행이 된다 — 미러가 이미 채워져 있기 때문이다).
--  ★ updated_at = updated_at — 명시 대입이 ON UPDATE CURRENT_TIMESTAMP(3)을 억제한다(실측).
--    이걸 빼면 89행의 갱신시각이 롤백 시각으로 덮여 지문이 달라진다. 무손실의 핵심이다.
SET @s := IF(@has_user_org_col = 1 AND @has_user_org_id = 1,
  'UPDATE app_user u JOIN org_unit o ON o.org_id = u.org_id
      SET u.org_unit = o.name, u.updated_at = u.updated_at
    WHERE u.org_unit IS NULL',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- R3) org_unit.parent 컬럼 재생성 (컬럼만. 값은 R4) ----------
--  ★ AFTER name 인 이유: 마이그레이션 뒤 순서는 (org_id, name, parent_id, sort_order, …) 다.
--    여기에 parent 를 name 뒤로 넣으면 (org_id, name, parent, parent_id, …) 가 되고,
--    R9 가 parent_id 를, R12 가 org_id 를 지우면 (name, parent, sort_order, …) —
--    **마이그레이션 전과 완전히 같은 순서**가 된다(실측 확인).
SET @s := IF(@has_parent_col = 0 AND @has_org_id = 1,
  'ALTER TABLE org_unit ADD COLUMN parent VARCHAR(50) NULL DEFAULT NULL AFTER name',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @has_parent_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
                           AND COLUMN_NAME = 'parent');

-- ---------- R4) org_unit.parent 재생성(백필): parent_id → 부모 조직 이름 ----------
--  ★ 루트(parent_id IS NULL)는 매칭되지 않아 parent 도 NULL 로 남는다 — 의도다.
--  ★ 파생 테이블로 감싸는 이유: UPDATE 대상 표를 같은 문장의 FROM 절에서 직접 읽으면
--    ERROR 1093. (SELECT org_id, name FROM org_unit) 로 감싸면 실체화되어 통과한다.
--  ★ updated_at = updated_at — R2 와 같은 이유.
SET @s := IF(@has_parent_col = 1 AND @has_parent_id = 1,
  'UPDATE org_unit c JOIN (SELECT org_id, name FROM org_unit) p ON p.org_id = c.parent_id
      SET c.parent = p.name, c.updated_at = c.updated_at
    WHERE c.parent IS NULL',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------------------------------------------------------------------------
--  (R-P0) 재생성 직후 지문 — 이 시점이 '원래 데이터가 다시 갖춰진 순간'이다.
--    아래 (R-E5)가 모든 DDL 을 마친 뒤 같은 두 값을 다시 찍는다. 되돌리기의 나머지는 DDL
--    뿐이므로 두 값은 **같아야 한다**. 그리고 둘 다 마이그레이션 (P0) 의 값과 같아야 한다.
--    (세 값이 전부 같으면: ① 재생성이 원본을 정확히 복원했고 ② 이후 DDL 이 데이터를
--     건드리지 않았다 — 이 파일이 무손실이라는 증명이 그 두 조각이다.)
--  ※ 계산식은 migrate 파일 (P0) 과 **글자까지 같아야 한다**. 다르면 비교가 성립하지 않는다.
SET SESSION group_concat_max_len = 1048576;
SET @q := IF(@has_parent_col = 1,
  'SELECT SHA2(GROUP_CONCAT(SHA2(CONCAT_WS(CHAR(31), name, IFNULL(parent,CHAR(0)), sort_order,
          is_active, created_at, updated_at), 256) ORDER BY name SEPARATOR ''''), 256)
     FROM org_unit INTO @org_fp_mid',
  'SELECT NULL INTO @org_fp_mid');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @q := IF(@has_user_org_col = 1,
  'SELECT SHA2(GROUP_CONCAT(SHA2(CONCAT_WS(CHAR(31), user_id, login_id, name, IFNULL(title,CHAR(0)),
          IFNULL(org_unit,CHAR(0)), view_scope, edit_role, is_active, created_at, updated_at), 256)
          ORDER BY user_id SEPARATOR ''''), 256)
     FROM app_user INTO @user_fp_mid',
  'SELECT NULL INTO @user_fp_mid');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SELECT @org_fp_mid AS org_unit_fp_regen, @user_fp_mid AS app_user_fp_regen;

-- ============================================================================
--  [R5 관문] ★★★ 재생성이 완결됐는가 — 여기를 통과해야만 정본을 지운다
--
--  ★ 마이그레이션 [8단계 절단 관문]의 거울상이다. 그쪽은 '지워도 되는가'를 물었고,
--    여기는 '되살아났는가'를 묻는다. 둘 다 같은 네 가지를 센다.
--    아래가 0 이 아닌 채로 R6~R12 가 돌면, 정본을 지운 뒤에 이름이 비어 있는 행이 남는다 —
--    그 순간 그 조직/그 사람의 소속은 **어디에도 없다**. 되돌릴 방법은 덤프뿐이다.
--
--    · regen_pid_null : parent 와 parent_id 중 한쪽만 NULL 인 행 (재생성이 빠뜨렸다)
--    · regen_pid_drift: parent_id 가 가리키는 조직의 이름 ≠ parent 문자열 (BINARY)
--    · regen_uid_null : app_user 의 두 소속 경로 중 한쪽만 NULL 인 행
--    · regen_uid_drift: org_id 가 가리키는 조직의 이름 ≠ org_unit 문자열 (BINARY)
--
--  ★ BINARY 인 이유는 migrate 파일 [8단계 관문] ★ 항목과 같다. 표 콜레이션이
--    utf8mb4_0900_ai_ci 라 ai_ci 로 세면 대소문자 표류를 0 으로 보고 통과시킨다.
--    A판 롤백에서 실제로 났던 결함이 그것이다(실측 2026-08-24: 한 자식의 미러만 소문자로
--    표류시키자 ai_ci 검사는 통과했고, 그 뒤 정본을 지워 **표류한 값이 유일한 진실로 승격**됐다).
--  ★ A판 상태의 DB(구 컬럼이 원래부터 있던 DB)에서는 이 관문이 곧 'A판 미러 정합 검사'가 된다
--    — 미러가 정본과 어긋나 있으면 여기서 멈춘다. 목적이 정확히 같으므로 식도 같다.
--
--  ※ 실측 2026-08-24(복제본, 이 관문이 정말 작동하는지 고장을 주입해 확인):
--    · R4 까지 돌린 뒤 한 사람의 org_unit 만 LOWER() 로 표류시키자 → ERROR 1146 으로 차단,
--      **app_user.org_id 가 그대로 남아 있었다**(정본을 지우지 않았다).
--    · 같은 방식으로 한 조직의 parent 를 LOWER() 로 표류시키자 → 역시 차단, parent_id 잔존.
--    · 아무것도 건드리지 않은 정상 복제본에서는 네 값이 전부 0 이고 통과했다(오탐 없음).
--    ★ 표류 주입에 **ASCII 가 든 조직명**을 쓸 것. 한글만으로 된 이름은 LOWER() 가 아무것도
--      바꾸지 않아 '고장을 주입했다고 착각하고 통과를 정상으로 오독'하게 된다(실제로 겪었다).
-- ============================================================================
--  ★★ 예외 하나 — '백필 미완' 상태에서는 이 관문이 검사할 대상이 없다 (실측된 결함의 나머지 반)
--    마이그레이션이 4단계(parent_id 신설)와 5단계(백필) 사이에서 죽으면 parent_id 는 있지만
--    **전부 NULL** 이다. 그 상태에서 (parent IS NULL) <> (parent_id IS NULL) 을 세면 11행이
--    어긋난 것처럼 보여, 완전무결한 DB 에서 롤백이 `구 컬럼 재생성이 정본과 일치하지 않는다`
--    로 멈췄다. 하지만 그 상태에서 이 파일이 지우는 것은 **전부 NULL 인 빈 컬럼**뿐이고,
--    되살릴 값은 애초에 구 컬럼에 온전히 남아 있다 — 잃을 것이 없다.
--    (app_user 도 같다: 6단계와 7단계 사이면 org_id 가 전부 NULL 이고 소속은 org_unit 에 있다.)
--    ★ 예외 조건은 **'전부 NULL'** 이다. 한 행이라도 값이 있으면 예외가 걸리지 않고 원래대로
--      전수 대조한다 — 즉 '반쯤 백필된 상태'는 여전히 여기서 막힌다.
SET @q := CONCAT('SELECT ',
  IF(@has_parent_col = 1 AND @has_parent_id = 1 AND @backfill_pending = 0,
     '(SELECT COUNT(*) FROM org_unit WHERE (parent IS NULL) <> (parent_id IS NULL))', '0'),
  ' INTO @regen_pid_null');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @q := CONCAT('SELECT ',
  IF(@has_parent_col = 1 AND @has_parent_id = 1 AND @backfill_pending = 0,
     '(SELECT COUNT(*) FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id
        WHERE CAST(c.parent AS BINARY) <> CAST(p.name AS BINARY))', '0'),
  ' INTO @regen_pid_drift');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @q := CONCAT('SELECT ',
  IF(@has_user_org_col = 1 AND @has_user_org_id = 1 AND @u_backfill_pending = 0,
     '(SELECT COUNT(*) FROM app_user WHERE (org_unit IS NULL) <> (org_id IS NULL))', '0'),
  ' INTO @regen_uid_null');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @q := CONCAT('SELECT ',
  IF(@has_user_org_col = 1 AND @has_user_org_id = 1 AND @u_backfill_pending = 0,
     '(SELECT COUNT(*) FROM app_user u JOIN org_unit o ON o.org_id = u.org_id
        WHERE CAST(u.org_unit AS BINARY) <> CAST(o.name AS BINARY))', '0'),
  ' INTO @regen_uid_drift');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;

SELECT @regen_pid_null AS regen_pid_null, @regen_pid_drift AS regen_pid_drift,
       @regen_uid_null AS regen_uid_null, @regen_uid_drift AS regen_uid_drift;
SET @g := IF(@regen_pid_null + @regen_pid_drift + @regen_uid_null + @regen_uid_drift = 0, 'DO 0',
             'SELECT 1 FROM `중단: 구 컬럼 재생성이 정본과 일치하지 않는다 - 정본을 지우면 안 된다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ============================================================================
--  철거 — 새 키와 새 컬럼을 걷어낸다 (마이그레이션 11 → 1 의 역순)
-- ============================================================================

-- ---------- R6) fk_user_org_id DROP (= 마이그레이션 11단계 취소) ----------
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
              AND CONSTRAINT_NAME = 'fk_user_org_id' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @s := IF(@c > 0, 'ALTER TABLE app_user DROP FOREIGN KEY fk_user_org_id', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- R7) app_user.org_id DROP (= 6·7단계 취소) ----------
--  ★ 백필한 번호가 함께 사라진다. 그래도 무손실인 이유: 같은 소속을 app_user.org_unit 이
--    이름으로 다시 들고 있기 때문이다([R5 관문]이 둘이 일치함을 확인했다).
--  ※ InnoDB 가 fk_user_org_id 와 함께 만든 인덱스는 R6 의 DROP FOREIGN KEY 로 사라진다 —
--    남아 있어도 이 DROP COLUMN 이 함께 걷어낸다(단일 컬럼 인덱스).
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'org_id');
SET @s := IF(@c > 0, 'ALTER TABLE app_user DROP COLUMN org_id', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- R8) fk_org_parent_id DROP (= 11단계 취소) ----------
--  ★ 이것이 **R11 보다 반드시 먼저**다. 실측(MySQL 8.4.9): 이 FK 가 살아 있는 채로 R11 을
--    돌리면 ERROR 1553 — Cannot drop index 'PRIMARY': needed in a foreign key constraint.
--    (그 FK 가 org_unit(org_id)를 참조하고 있어 org_id 위의 PK 인덱스를 붙잡고 있다.)
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
              AND CONSTRAINT_NAME = 'fk_org_parent_id' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @s := IF(@c > 0, 'ALTER TABLE org_unit DROP FOREIGN KEY fk_org_parent_id', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- R9) org_unit.parent_id DROP (= 4·5단계 취소) ----------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit' AND COLUMN_NAME = 'parent_id');
SET @s := IF(@c > 0, 'ALTER TABLE org_unit DROP COLUMN parent_id', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- R10) AUTO_INCREMENT 해제 (3단계의 MODIFY 취소) ----------
--  ★ PK 교체(R11)보다 **먼저** 해야 한다. AUTO_INCREMENT 컬럼은 어떤 인덱스의 선두여야 하는데,
--    PK 를 name 으로 옮기면 org_id 가 그 자격을 잃기 때문이다.
--    실측(MySQL 8.4.9): 이 해제를 건너뛰고 R11 만 돌리면
--      ERROR 1075 — Incorrect table definition; there can be only one auto column
--                   and it must be defined as a key
--  ★ 두 문장으로 갈라 둔 이유는 '한 문장에 묶으면 죽어서'가 **아니다** — 실측하면 MODIFY 와
--    PK 교체를 한 ALTER 에 묶어도 8.4 는 통과시킨다. 가른 이유는 멱등성이다: 각 조각이
--    자기 결과(EXTRA 에 auto_increment 가 남았는가 / PK 가 이미 name 인가)를 **따로** 보므로,
--    중단된 실행을 재개해도 이미 끝난 조각을 건너뛴다.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
              AND COLUMN_NAME = 'org_id' AND EXTRA LIKE '%auto_increment%');
SET @s := IF(@c > 0, 'ALTER TABLE org_unit MODIFY COLUMN org_id SMALLINT UNSIGNED NOT NULL', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- R11) PK 를 name 으로 되돌린다 (3단계 취소) ----------
--  ★ 마이그레이션 3단계와 대칭이다 — 세 조각을 **한 문장**에 묶는다.
--    ADD PRIMARY KEY (name) 과 DROP INDEX uq_org_unit_name 을 같은 문장에 두면 PK 인덱스가
--    곧바로 그 자리를 받는다. 쪼개면 name 위의 인덱스가 한 순간 사라진다.
--  ★ R8(fk_org_parent_id DROP)이 먼저여야 하는 이유는 R8 주석 참조 — 순서 의존이다.
--  · 조건: org_id 컬럼이 아직 있고 PK 가 아직 name 이 아닐 때만.
SET @pk_is_name := (SELECT COUNT(*) FROM information_schema.STATISTICS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
                       AND INDEX_NAME = 'PRIMARY' AND COLUMN_NAME = 'name');
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit' AND COLUMN_NAME = 'org_id');
SET @s := IF(@c = 1 AND @pk_is_name = 0,
  'ALTER TABLE org_unit
     DROP PRIMARY KEY,
     ADD PRIMARY KEY (name),
     DROP INDEX uq_org_unit_name',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- R12) org_unit.org_id DROP (= 1·2단계 취소) ----------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit' AND COLUMN_NAME = 'org_id');
SET @s := IF(@c > 0, 'ALTER TABLE org_unit DROP COLUMN org_id', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ============================================================================
--  구 키 복원 — 옛 스키마의 인덱스와 FK 를 다시 세운다 (마이그레이션 9·10단계 취소)
-- ============================================================================

-- ---------- R13) ix_org_parent + fk_org_parent 복원 ----------
--  ★ 인덱스를 **먼저, 이름을 명시해** 만든다. 그냥 ADD CONSTRAINT 만 하면 InnoDB 가 제약과
--    같은 이름(fk_org_parent)으로 인덱스를 자동 생성해 버려, 원본의 `KEY ix_org_parent (parent)`
--    와 이름이 달라진다. 원본과 같은 모양으로 돌아가는 것이 이 파일의 계약이다.
--  ★ 이것이 되돌리기의 마지막이자 **개명이 다시 막히는 지점**이다. 이 FK 가 서는 순간
--    하위 조직을 가진 노드의 개명은 다시 ERROR 1451 이 된다(자기참조 CASCADE 미수행).
--    그것이 원래 상태다 — 되돌린다는 것은 그 병까지 되돌린다는 뜻이다.
--  ★ 선언을 원본과 글자까지 맞춘다: ON DELETE RESTRICT ON UPDATE CASCADE
--    (실 taskmgr 의 SHOW CREATE TABLE 에서 그대로 옮겼다).
SET @c := (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
              AND INDEX_NAME = 'ix_org_parent');
SET @has_parent_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
                           AND COLUMN_NAME = 'parent');
SET @s := IF(@c = 0 AND @has_parent_col = 1,
             'ALTER TABLE org_unit ADD KEY ix_org_parent (parent)', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
              AND CONSTRAINT_NAME = 'fk_org_parent' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @s := IF(@c = 0 AND @has_parent_col = 1,
  'ALTER TABLE org_unit ADD CONSTRAINT fk_org_parent FOREIGN KEY (parent)
     REFERENCES org_unit(name) ON DELETE RESTRICT ON UPDATE CASCADE',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- R14) ix_user_org + fk_user_org 복원 ----------
--  ★ R13 과 같은 이유로 인덱스를 먼저 이름 붙여 만든다.
--  ★ 이 FK 가 요구하는 것은 org_unit(name) 위의 인덱스다 — R11 이 PRIMARY KEY (name) 을
--    세워 뒀으므로 조건이 만족된다. R11 보다 먼저 오면 ERROR 1215 다.
SET @c := (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
              AND INDEX_NAME = 'ix_user_org');
SET @has_user_org_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                             AND COLUMN_NAME = 'org_unit');
SET @s := IF(@c = 0 AND @has_user_org_col = 1,
             'ALTER TABLE app_user ADD KEY ix_user_org (org_unit)', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
              AND CONSTRAINT_NAME = 'fk_user_org' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @s := IF(@c = 0 AND @has_user_org_col = 1,
  'ALTER TABLE app_user ADD CONSTRAINT fk_user_org FOREIGN KEY (org_unit)
     REFERENCES org_unit(name) ON DELETE RESTRICT ON UPDATE CASCADE',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- R15) 표 코멘트 복원 (마이그레이션 12단계 취소) ----------
--  ★ 조건을 '현재 코멘트가 마이그레이션이 넣은 새 문자열과 정확히 같을 때만' 으로 좁힌다.
--    누군가 그 뒤에 손으로 바꿔 뒀다면 그 뜻을 우리가 알 수 없다 — 모르는 것은 덮지 않는다.
SET @old_org_comment  := '조직 트리. name=자연키, parent로 계층. 조회 범위 계산의 기준.';
SET @new_org_comment  := '조직 트리. PK=org_id(내부 정체성) · name=UNIQUE. 계층 정본은 parent_id 하나 — 이름 미러 없음.';
SET @old_user_comment := '사용자. 인증은 netcus, 여기는 인가만. 비밀번호 컬럼 없음.';
SET @new_user_comment := '사용자. 인증은 netcus, 여기는 인가만. 비밀번호 컬럼 없음. 소속 정본은 org_id 하나 — 이름 미러 없음.';
SET @cur := (SELECT TABLE_COMMENT FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit');
SET @s := IF(@cur = @new_org_comment,
             CONCAT('ALTER TABLE org_unit COMMENT = ', QUOTE(@old_org_comment)), 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @cur := (SELECT TABLE_COMMENT FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user');
SET @s := IF(@cur = @new_user_comment,
             CONCAT('ALTER TABLE app_user COMMENT = ', QUOTE(@old_user_comment)), 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ============================================================================
--  확인 — 눈으로 볼 것
-- ============================================================================

-- (R-E1) 구조. 기대 2행: PRIMARY/1/name/0 · ix_org_parent/1/parent/1
--        (uq_org_unit_name · fk_org_parent_id 인덱스는 없어야 한다)
SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
 ORDER BY INDEX_NAME, SEQ_IN_INDEX;

-- (R-E2) FK 목록. 기대 3행:
--        app_user fk_user_org    org_unit → org_unit.name   (★ 복원되어야 한다)
--        app_user fk_user_title  title    → title_code.name
--        org_unit fk_org_parent  parent   → org_unit.name   (★ 복원되어야 한다)
SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME,
       k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
  FROM information_schema.KEY_COLUMN_USAGE k
  JOIN information_schema.REFERENTIAL_CONSTRAINTS r
    ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
 WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME IN ('org_unit','app_user')
   AND k.REFERENCED_TABLE_NAME IS NOT NULL
 ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME;

-- (R-E3) 새 컬럼이 남아 있지 않은가 · 구 컬럼이 제자리에 돌아왔는가.
--        기대: org_id/parent_id 는 0행. org_unit.parent 는 ORDINAL_POSITION=2,
--              app_user.org_unit 은 ORDINAL_POSITION=5 (마이그레이션 전과 같은 자리).
SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME = 'org_unit' AND COLUMN_NAME IN ('org_id','parent_id','parent'))
     OR (TABLE_NAME = 'app_user' AND COLUMN_NAME IN ('org_id','org_unit')))
 ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- (R-E4) 데이터가 온전한가. 기대: n_org=12 · n_root=1 · parent_orphan=0 · n_users=89 · user_orphan=0
--        ★ 두 고아 검사는 **BINARY** 다. 되돌린 뒤에는 fk_org_parent 가 다시 서지만 그 FK 는
--          ai_ci 라 parent='sw개발본부' 를 통과시킨다(실측). 즉 FK 가 섰다는 사실은
--          '배포본이 볼 때 고아가 없다'를 뜻하지 않는다. 여기서 세는 고아는 FK 가 보는 고아가
--          아니라 **89대(StringComparer.Ordinal)가 보는 고아**여야 한다.
SELECT
  (SELECT COUNT(*) FROM org_unit)                          AS n_org,
  (SELECT COUNT(*) FROM org_unit WHERE parent IS NULL)     AS n_root,
  (SELECT COUNT(*) FROM org_unit c WHERE c.parent IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM (SELECT name FROM org_unit) p
                      WHERE CAST(p.name AS BINARY) = CAST(c.parent AS BINARY)))
                                                           AS parent_orphan,
  (SELECT COUNT(*) FROM app_user)                          AS n_users,
  (SELECT COUNT(*) FROM app_user u WHERE u.org_unit IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM org_unit o
                      WHERE CAST(o.name AS BINARY) = CAST(u.org_unit AS BINARY)))
                                                           AS user_orphan;

-- (R-E5) ★★ 지문 — [적용] 2) 의 '마이그레이션 전' 값과 **글자까지 같아야 한다**.
--        그리고 위 (R-P0) 의 재생성 직후 값과도 같아야 한다(그 사이는 DDL 뿐이므로).
SET SESSION group_concat_max_len = 1048576;
SELECT SHA2(GROUP_CONCAT(SHA2(CONCAT_WS(CHAR(31), name, IFNULL(parent,CHAR(0)), sort_order,
            is_active, created_at, updated_at), 256) ORDER BY name SEPARATOR ''), 256)
       AS org_unit_fp FROM org_unit;
SELECT SHA2(GROUP_CONCAT(SHA2(CONCAT_WS(CHAR(31), user_id, login_id, name, IFNULL(title,CHAR(0)),
            IFNULL(org_unit,CHAR(0)), view_scope, edit_role, is_active, created_at, updated_at), 256)
            ORDER BY user_id SEPARATOR ''), 256) AS app_user_fp FROM app_user;

-- ============================================================================
--  [R-E6 차단] ★★★ 반쪽 롤백이면 여기서 **실행을 실패시킨다**
--
--  ★ 왜 필요한가 — 출력만으로는 아무것도 막지 못한다
--    (R-E1)~(R-E5)는 사람이 볼 표를 찍을 뿐이라, 되돌리다 만 DB 에서도 mysql 은 종료코드 0 으로
--    끝난다. 그러면 `mysql < rollback.sql && echo OK` 형태의 자동화가 **반쪽 상태를 OK 로
--    보고**한다. 짝이 되는 migrate 파일의 [E9 차단]과 같은 장치를 여기에도 둔다.
--    ※ 위 출력은 그대로 둔다. 출력은 '무엇이 틀렸나', 아래는 '진행하지 마라'.
--    ※ 이 블록이 맨 끝이라, 에러로 죽어도 위 표는 이미 다 나온 뒤다.
--
--  기대: 전부 0.
--    · rb_pk_not_name    : PK 가 (name) 단일이 아니다 (R11 이 안 돌았다)
--    · rb_new_cols_left  : org_unit.org_id / parent_id / app_user.org_id 잔존 개수 (R7·R9·R12)
--    · rb_uq_left        : uq_org_unit_name 잔존 (R11)
--    · rb_new_fk_left    : fk_org_parent_id / fk_user_org_id 잔존 개수 (R6·R8)
--    · rb_old_cols_missing: org_unit.parent / app_user.org_unit 이 안 돌아왔다 (R1·R3) — 2 에서 뺀 값
--    · rb_old_fk_missing : fk_org_parent 가 안 돌아왔다 (R13)
--    · rb_user_fk_missing: fk_user_org 가 안 돌아왔다 (R14)
--    · rb_ix_missing     : ix_org_parent / ix_user_org 가 안 돌아왔다 (R13·R14) — 2 에서 뺀 값
--    · rb_parent_orphan  : parent 고아(**BINARY**). fk_org_parent 가 다시 섰으니 0 이어야 정상.
--                          ★ 'FK 가 섰으니 당연히 0' 이 아니다 — 그 FK 는 ai_ci 다.
--    · rb_user_orphan    : app_user.org_unit 고아(**BINARY**). 같은 이유.
--    · rb_null_left      : 정본이 있었는데 이름이 안 채워진 행 — 재생성 유실. 이제 정본이
--                          없으므로 여기 걸리면 덤프 복원뿐이다. 반드시 0 이어야 한다.
-- ============================================================================
SET @rb_pk_not_name := (SELECT IF(GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'name', 0, 1)
                          FROM information_schema.STATISTICS
                         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
                           AND INDEX_NAME = 'PRIMARY');
SET @rb_new_cols_left := (SELECT COUNT(*) FROM information_schema.COLUMNS
                           WHERE TABLE_SCHEMA = DATABASE()
                             AND ((TABLE_NAME = 'org_unit' AND COLUMN_NAME IN ('org_id','parent_id'))
                               OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'org_id')));
SET @rb_old_cols_missing := (SELECT 2 - COUNT(*) FROM information_schema.COLUMNS
                              WHERE TABLE_SCHEMA = DATABASE()
                                AND ((TABLE_NAME = 'org_unit' AND COLUMN_NAME = 'parent')
                                  OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'org_unit')));
SET @rb_uq_left := (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
                       AND INDEX_NAME = 'uq_org_unit_name');
SET @rb_new_fk_left := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                         WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'
                           AND CONSTRAINT_NAME IN ('fk_org_parent_id','fk_user_org_id'));
SET @rb_old_fk_missing := (SELECT 1 - COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
                              AND CONSTRAINT_NAME = 'fk_org_parent'
                              AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @rb_user_fk_missing := (SELECT 1 - COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                               AND CONSTRAINT_NAME = 'fk_user_org'
                               AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @rb_ix_missing := (SELECT 2 - COUNT(*) FROM
                        (SELECT DISTINCT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
                          WHERE TABLE_SCHEMA = DATABASE()
                            AND INDEX_NAME IN ('ix_org_parent','ix_user_org')) x);
--  ★ 이 두 검사는 컬럼이 복원된 뒤에만 성립한다. 복원이 안 됐으면 위 rb_old_cols_missing 이
--    이미 1 이상이므로, 여기서는 컬럼 존재를 조건으로 걸어 ERROR 1054 를 피한다.
SET @q := CONCAT('SELECT ',
  IF(@rb_old_cols_missing = 0,
     '(SELECT COUNT(*) FROM org_unit c WHERE c.parent IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM (SELECT name FROM org_unit) p
                          WHERE CAST(p.name AS BINARY) = CAST(c.parent AS BINARY)))
      + (SELECT COUNT(*) FROM app_user u WHERE u.org_unit IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM org_unit o
                          WHERE CAST(o.name AS BINARY) = CAST(u.org_unit AS BINARY)))', '0'),
  ' INTO @rb_orphan');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
--  ★ 재생성 유실 검출: 루트가 아닌데 parent 가 비었거나, 소속이 있어야 하는데 이름이 빈 행.
--    정본이 이미 사라졌으므로 이 값은 '이 파일이 데이터를 잃었다'는 신호다.
--    루트 1개 · 소속 미등록 0명이 정상값이므로, 기대는 n_root=1 · org_unit NULL 0명이다.
SET @q := CONCAT('SELECT ',
  IF(@rb_old_cols_missing = 0,
     '(SELECT ABS(COUNT(*) - 1) FROM org_unit WHERE parent IS NULL)
      + (SELECT COUNT(*) FROM app_user WHERE org_unit IS NULL)', '0'),
  ' INTO @rb_null_left');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;

SELECT @rb_pk_not_name AS rb_pk_not_name, @rb_new_cols_left AS rb_new_cols_left,
       @rb_old_cols_missing AS rb_old_cols_missing, @rb_uq_left AS rb_uq_left,
       @rb_new_fk_left AS rb_new_fk_left, @rb_old_fk_missing AS rb_old_fk_missing,
       @rb_user_fk_missing AS rb_user_fk_missing, @rb_ix_missing AS rb_ix_missing,
       @rb_orphan AS rb_orphan, @rb_null_left AS rb_null_left;

SET @rb_bad := IFNULL(@rb_pk_not_name, 1) + @rb_new_cols_left + @rb_old_cols_missing
             + @rb_uq_left + @rb_new_fk_left + @rb_old_fk_missing + @rb_user_fk_missing
             + @rb_ix_missing + @rb_orphan + @rb_null_left;
--  ※ Windows(lower_case_table_names=1)에서는 ASCII 가 소문자로 바뀌어 출력된다.
SET @g := CASE
  WHEN @rb_bad = 0 THEN 'DO 0'
  WHEN @rb_old_cols_missing > 0
    THEN 'SELECT 1 FROM `중단: 롤백 미완 - 구 컬럼(parent/org_unit)이 복원되지 않았다. R-E3 를 볼 것`'
  WHEN @rb_null_left > 0
    THEN 'SELECT 1 FROM `중단: 롤백 유실 - 재생성이 비어 있는 행이 있다. 덤프 복원이 필요하다`'
  WHEN IFNULL(@rb_pk_not_name,1) + @rb_new_cols_left + @rb_uq_left + @rb_new_fk_left > 0
    THEN 'SELECT 1 FROM `중단: 롤백 미완 - 새 키/컬럼이 남아 있다. 위 R-E6 를 볼 것`'
  WHEN @rb_old_fk_missing + @rb_user_fk_missing + @rb_ix_missing > 0
    THEN 'SELECT 1 FROM `중단: 롤백 미완 - 옛 FK/인덱스가 안 돌아왔다. 위 R-E6 를 볼 것`'
  ELSE 'SELECT 1 FROM `중단: 롤백 사후 검증 실패 - 고아가 있다. 위 R-E4 를 볼 것`' END;
PREPARE _r FROM @g; EXECUTE _r; DEALLOCATE PREPARE _r;

-- ============================================================================
--  [되돌리기 전 확인] — org_id 를 참조하는 무언가가 새로 생기지 않았는가
--    아래가 0행이어야 이 파일이 무손실이다. 한 줄이라도 나오면 그 객체가 먼저다.
--      SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
--       WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME LIKE '%org_id%'
--         AND TABLE_NAME NOT IN ('org_unit','app_user');
--    ※ 캘린더 데이터(cal_*)는 org_id 를 모른다 — 사람은 user_id 로만 가리킨다.
--
--  [되돌린 뒤 반드시 할 일]
--    · 되돌린 스키마는 배포본 v0.17.1 이 원래 보던 그 스키마다 — S1~S6 전부 동작한다.
--      반대로 **신버전(org_id 를 쓰는 판)은 동작하지 않는다.** 되돌리기는 배포 되돌리기와
--      짝을 맞춰야 한다.
--    · 개명이 필요하면 이 스키마에서는 1문장으로 안 된다(fk_org_parent 가 다시 섰다).
--      CALENDAR-TABLE-DESIGN.md §5.6.6 의 절차를 쓸 것 — 그 절차는 fk_org_parent 가 있는
--      스키마 전용이다.
-- ============================================================================
