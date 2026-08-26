-- ============================================================================
--  마이그레이션 2026-08-24 — org_unit PK: name → org_id (대리키 전환) · ★완전 절단판
--    대상: 이미 name 을 PK 로 세워 놓고 운영 중인 기존 DB(실 taskmgr 가 그 상태다).
--    신규 구축은 이 파일이 아니라 taskmgr-company-data/01-schema-users.sql 이 한다.
--    이 파일은 '이미 선 것'을 옮기는 1회용이다.
--
--  ★ 왜 옮기나 — 선언은 CASCADE 인데 동작하지 않는다
--    org_unit.parent 는 자기참조 FK(fk_org_parent, ON UPDATE CASCADE)인데, InnoDB 는
--    **자기참조 FK 에 CASCADE 를 수행하지 않는다**. 그래서 하위 조직을 가진 본부를 개명하면
--    자식의 parent 가 따라오지 못해 그 자리에서 ERROR 1451 로 막힌다.
--    (실측 2026-08-24, MySQL 8.4.9, 실 taskmgr 복제본: 자식을 가진 노드 3개 — 루트 1 + 본부 2 —
--     전부 UPDATE org_unit SET name=... 이 1451 로 실패. 선언된 CASCADE 는 한 번도 돌지 않았다.)
--    번호(org_id)를 분리하면 계층은 parent_id 가 잡고, 개명은 name 한 컬럼 갱신으로 끝난다.
--
--  ★★★ 2026-08-24 방향 전환 — 이 파일은 **미러를 남기지 않는다**
--    직전 판은 확장-수축의 A단계였다: org_id/parent_id 를 신설하되 구 컬럼
--    org_unit.parent · app_user.org_unit 을 **이름 미러로 남겨** 배포된 v0.17.1 89대를 살렸다.
--    그 미러가 **DB 가 검증하지 않는 중복 상태**였고, 적대검증 결함의 절반이 거기서 나왔다:
--      · 개명이 2문장이 되고, 둘째 문장을 빠뜨리면 **에러 없이** 트리가 끊어졌다
--      · 신설·이관·인사이동이 전부 '정본+미러 동시 쓰기'가 되어 한쪽만 쓴 사고가 반복됐다
--      · ai_ci 콜레이션 때문에 대소문자만 다른 미러 표류가 FK 를 통과했다(앱은 Ordinal 이라 끊긴다)
--      · 롤백이 '정본을 버리고 미러를 진실로 승격'시키는 일이 되어, 미러가 틀려 있으면
--        그 틀림이 조용히 확정됐다
--    → 미러를 지우면 그 결함군이 **설계에서 사라진다**. 그래서 완전 절단을 택했다.
--
--  ★★ 완전 절단의 근거는 실측이다 — 89대에 실제로 무슨 일이 생기나
--    · 부팅 경로(userSessionGet)는 **로컬 세션 파일만 읽고 DB 를 안 본다**(MainWindow.xaml.cs:1578).
--    · 세션에 **만료(TTL)가 없다** — savedAt 조차 저장하지 않는다(UserSession.cs).
--      직접 로그아웃하지 않는 한 재로그인이 강제되는 경로가 없다.
--    · 그래서 이 마이그레이션 뒤 배포본 6문 중 **S1 은 생존**하고 S2~S6 만 깨진다:
--        S1 SELECT edit_role, is_active FROM app_user WHERE login_id=@id     ← 생존(과제 편집 권한 관문)
--        S2 로그인 인가       (… org_unit …)                                 ← ERROR 1054
--        S3 사용자정보 모달   (… org_unit …)                                 ← ERROR 1054
--        S4 열람범위 기준점   (org_unit …)                                    ← ERROR 1054
--        S5 조직 트리         (name, parent, sort_order FROM org_unit)        ← ERROR 1054
--        S6 구성원 명부       (… org_unit …)                                  ← ERROR 1054
--      전부 **SELECT** 다. 쓰기가 없으므로 **데이터 손상 위험 0**이다.
--    · 즉 기존 사용자에게 실제로 깨지는 것은 **조회 화면 둘**(사용자정보 모달·구성원 명부)과
--      **새 로그인**뿐이고, 신버전을 배포하면 해결된다.
--
--  [적용] — 다섯 걸음. 1) 을 건너뛰지 말 것.
--
--    1) ★ 실행 전 mysqldump 필수. 되돌릴 출발점이 없으면 아래 5) 의 '되돌릴 것' 이 말이 안 된다.
--         손으로:
--           mysqldump -u root -p --default-character-set=utf8mb4 --single-transaction \
--                     --routines --triggers --events taskmgr > taskmgr-<날짜>.sql
--         정식 경로(검증·회전·해시 대조까지 한다):  db/deploy/backup-taskmgr.ps1
--           (또는 backup-taskmgr.cmd) — 실패 코드의 의미와 **복원 절차**는
--           db/deploy/README.md 의 '### 복구' 절에 있다. 덤프를 뜬 시각을 적어 둘 것
--           (그 시각이 binlog 재생의 시작점이다).
--
--    2) ★★★ 컷오버 경고 — **신버전 배포와 같은 시점에 적용할 것**
--       이 마이그레이션이 끝나는 순간부터, 배포된 v0.17.1 은
--         · 새 로그인          → 실패
--         · 사용자정보 모달    → 실패
--         · 구성원 명부(조직도)→ 실패
--       가 된다. 반대로
--         · 이미 로그인해 둔 세션의 **부팅**  → 정상(로컬 세션 파일만 읽는다)
--         · 캘린더 조회·입력                   → 정상(cal_* 는 이 전환과 무관)
--         · 과제 편집 권한 관문(S1)            → 정상
--       이고, **데이터가 손상되지 않는다**(깨지는 5문이 전부 SELECT).
--       그래도 근무시간 중에 돌리지 말 것 — 그 시간대에 새로 로그인하는 사람이 막힌다.
--
--    3) 지문 기록. 이 파일이 시작하자마자 (P0) 으로 org_unit·app_user 의 전 컬럼 SHA-256 을
--       찍는다. 그 두 줄을 남겨 둘 것 — 되돌린 뒤 '정말 원래대로인가' 를 증명하는 유일한 값이다.
--       ★ 이 판에서는 구 컬럼이 사라지므로, 전환 뒤에는 이 지문을 **다시 계산할 수 없다**.
--         로그에 남기지 않으면 롤백 무손실을 증명할 방법이 없어진다.
--
--    4) mysql -u root -p --default-character-set=utf8mb4 taskmgr < migrate-2026-08-24-org-id.sql
--       ※ --force 를 붙이지 말 것. 이 파일은 선행조건 위반 시 '에러로 멈추는' 방식으로 자신을
--         보호한다(순수 SQL 에는 IF/THEN 도 SIGNAL 도 없다 — 아래 ★가드 참조). --force 는 그
--         멈춤을 무력화한다. 특히 [가드 1](명부 해시)은 무력화되면 전 직원 소속이 어긋난다.
--       ※ 종료코드를 볼 것. 0 이 아니면 아무것도 통과하지 않은 것이다 — 가드와 파일 끝
--         [E9 차단] 이 둘 다 에러로 멈추게 만들어 두었다.
--
--       ★★★ 4-a) **백업 프로세스가 끝난 뒤에** 시작할 것 — 겹치면 89대가 함께 멈춘다
--         1) 의 mysqldump 는 --single-transaction 이라 **읽기 트랜잭션을 하나 열어 둔 채로**
--         돈다. 그 트랜잭션은 org_unit·app_user 의 메타데이터 락(MDL)을 쥐고 있고, 이 파일의
--         첫 ALTER 는 그 락이 풀릴 때까지 기다린다. 아래 4-b) 의 상한이 없으면
--         @@lock_wait_timeout = 31536000(**1년**, 8.4 기본값 — 실측)만큼 기다린다.
--         ★ 기다리는 동안 **ALTER 뒤에 줄 선 모든 질의가 함께 멈춘다**. 배포본 v0.17.1 이
--           쏘는 6문 중 유일하게 살아남는 S1(과제 편집 권한 관문)까지 막힌다 —
--           실측: 홀더 20초 · 배포본 S5 가 12,127ms 무응답 · 마이그레이션 총 23,378ms
--           (홀더 없을 때 498ms). 즉 "백업 먼저 뜨세요" 지시가 스스로 이 사고를 만든다.
--         → 덤프가 **완전히 끝난 것을 확인하고** 시작한다(프로세스 종료 + 파일 크기 확정).
--
--       ★★★ 4-b) 시작 직전 — 열린 트랜잭션이 0건인지 확인할 것
--           SELECT * FROM information_schema.innodb_trx;
--         0행이어야 한다. 한 줄이라도 있으면 그 트랜잭션(trx_mysql_thread_id)이 끝나기를
--         기다렸다가 시작한다. 남의 세션을 KILL 하기 전에 무엇인지 먼저 볼 것.
--         ※ 이 파일은 맨 앞에서 SET SESSION lock_wait_timeout = 10 을 건다. 홀더가 있으면
--           10초 뒤 **ERROR 1205 로 즉시 멈추고 DDL 은 0건**이다 — 이 파일의 '에러로 멈춘다'
--           철학 그대로다. 그때는 홀더를 정리하고 **그냥 다시 돌리면 된다**(전 단계가 멱등).
--
--       ★★★ 4-c) 멈춘 것처럼 보이면 — Ctrl-C 를 누르기 전에 **다른 세션에서** 볼 것
--           SHOW PROCESSLIST;   -- 'Waiting for table metadata lock' 이 보이면 위 4-b) 다
--           SELECT * FROM information_schema.innodb_trx;
--         (Ctrl-C 자체는 안전함이 실측됐다 — 첫 ALTER 대기 중 클라이언트를 죽여도 스키마는
--          변하지 않았고 재실행이 정상 완주했다. 그래도 원인을 보지 않고 끊으면 같은 일이
--          반복된다.)
--
--    5) 되돌리려면:  db/deploy/rollback-2026-08-24-org-id.sql
--         mysql -u root -p --default-character-set=utf8mb4 taskmgr < rollback-2026-08-24-org-id.sql
--       ★ 이 판은 구 컬럼을 **지운다**. 그래서 롤백은 parent · app_user.org_unit 을
--         parent_id · org_id 로부터 **재생성**한다. 그 재생성이 원본과 한 글자도 다르지 않다는
--         근거는 아래 [8단계 절단 관문]이다 — 구 컬럼을 지우기 직전에, 정본이 구 컬럼을
--         **BINARY 로 완전히 재현하는지** 확인하고서야 지운다. 재현하지 못하면 지우지 않는다.
--       ★ 되돌리면 fk_org_parent 가 다시 붙어 **본부 개명이 다시 ERROR 1451 로 막힌다** —
--         그게 원래 상태다. 롤백은 '병까지 되돌리는' 일이라는 걸 알고 쓸 것.
--       ★ 그래도 1) 의 덤프가 필요하다. 롤백 파일은 **이 마이그레이션이 한 일**만 되돌린다.
--         그 뒤에 사람이 저지른 조직 변경은 되돌리지 않는다.
--
--  ★ 순서: 이 파일은 migrate-2026-08-24-user-id.sql 과 **독립**이다(건드리는 표가 겹치지 않는다 —
--    저쪽은 app_user 의 키, 이쪽은 org_unit 의 키 + app_user 의 소속 컬럼). 어느 쪽을 먼저
--    돌려도 된다. 다만 apply.ps1 게이트가 둘 다 요구하므로 결국 둘 다 돌려야 한다.
--
--  무손실: 행을 지우지 않는다. 컬럼 3개 추가 + 키 재배치 + FK 교체 + **구 컬럼 2개 제거**다.
--    구 컬럼의 값은 지우기 전에 정본으로 완전히 옮겨졌음이 확인된다([8단계 절단 관문]).
--    ★ 백필 UPDATE 는 updated_at 까지 보존한다(SET ... , updated_at = updated_at).
--      명시 대입하면 ON UPDATE CURRENT_TIMESTAMP 가 발동하지 않는다 — 실측으로 확인했다.
--      이걸 빼면 12+89행의 갱신시각이 마이그레이션 시각으로 통째로 덮여, 나중에 '언제 조직이
--      바뀌었나'를 추적할 수 없게 된다.
--  멱등: 이미 전환된 DB 에서는 모든 단계가 no-op 이다. 중단된 실행의 재개도 된다 —
--    각 단계가 '자기 결과가 이미 있는가'를 information_schema 나 데이터로 따로 확인하고,
--    구 컬럼을 읽는 검사는 전부 '그 컬럼이 아직 있는가'로 갈라 둔다(이미 지워진 뒤에
--    재개해도 ERROR 1054 로 죽지 않는다).
-- ============================================================================
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
--  ★★★ 락 대기 상한 — 이 한 줄이 없으면 89대가 함께 멈춘다 (실측된 결함)
--    MySQL 8.4 의 기본값은 @@lock_wait_timeout = 31536000 = **1년**이다(실측).
--    이 값은 **메타데이터 락(MDL) 대기**의 상한이고, ALTER TABLE 이 기다리는 것이 바로 그것이다.
--    (@@innodb_lock_wait_timeout = 50 은 행 락 상한이라 여기서는 아무 역할도 하지 않는다.)
--
--    무엇이 벌어지나 — 실측(MySQL 8.4.9, 실 taskmgr 복제본):
--      홀더 세션:  START TRANSACTION; SELECT COUNT(*) FROM org_unit; SELECT SLEEP(20);
--        ★ 이것은 **--single-transaction 덤프와 똑같은 모양**이다. 즉 [적용] 1) 의
--          "백업 먼저 뜨세요" 지시를 지키다가 그 덤프와 겹치면 스스로 이 상황을 만든다.
--      → processlist:  Waiting for table metadata lock | ALTER TABLE org_unit ADD COLUMN org_id …
--      → 그 대기 중 배포본 v0.17.1 의 S5(조직 트리)를 앱 계정으로 쏘면 **12,127ms 무응답**.
--        ALTER 가 MDL 대기 큐의 앞에 서서, 뒤에 줄 선 **평범한 SELECT 까지 전부 막는다**.
--        컷오버 뒤에도 유일하게 살아남는 S1(과제 편집 권한 관문)도 같은 큐에 선다 —
--        즉 89대가 '과제 편집조차 안 되는' 상태로 함께 멈춘다.
--      → 마이그레이션 총 소요 23,378ms (홀더가 없을 때 498ms).
--      → 홀더를 app_user 에만 걸어도 결과는 같다(FK 로 엮인 표까지 MDL 을 잡는다).
--
--    그래서 10초로 자른다. 홀더가 있으면 **ERROR 1205 (Lock wait timeout exceeded) 로 즉시
--    멈추고 DDL 은 한 건도 돌지 않는다** — 이 파일의 모든 가드가 쓰는 '에러로 멈춘다' 와 같은
--    철학이다. 멈춘 뒤 할 일은 [적용] 4-b)·4-c) 에 있다. 홀더를 치우고 다시 돌리면 된다
--    (전 단계가 멱등이므로 재실행이 안전하다).
--    ※ 10초인 이유: 정상 상태의 이 마이그레이션은 전부 합쳐 500ms 안쪽이다(실측). 10초는
--      '잠깐 스치는 짧은 트랜잭션'은 넘겨 주고 '사람이 열어 둔 트랜잭션'은 잡아내는 폭이다.
--    ※ SESSION 이므로 이 접속에만 적용된다 — 서버 설정을 바꾸지 않는다.
-- ---------------------------------------------------------------------------
SET SESSION lock_wait_timeout = 10;

-- ---------------------------------------------------------------------------
--  ★ 가드 방식에 대해 (migrate-2026-08-24-user-id.sql · schema-calendar.sql 과 같은 수법)
--    MySQL 은 스토어드 프로그램 밖에서 IF/THEN 도, SIGNAL 도 못 쓴다
--    (실측: PREPARE 로 SIGNAL 을 감싸면 ERROR 1295 'not supported in the prepared
--     statement protocol yet'). 그래서 조건부 실행은 information_schema 를 읽어
--    실행할 문장 자체를 문자열로 고르고 PREPARE/EXECUTE 하는 방법밖에 없다.
--    조건 불충족일 때는 '존재하지 않는 테이블명'을 SELECT 하는 문장을 골라 일부러 ERROR 1146 을
--    낸다 — 테이블명 자리에 사람이 읽을 메시지를 넣으면 그 메시지가 에러로 나온다(실측).
--    ※ 식별자는 64자 제한. ※ Windows(lower_case_table_names=1)에서는 ASCII 가 소문자로
--      바뀌어 출력된다 — 대소문자에 의미를 싣지 말 것.
--    ★ 구 컬럼을 읽는 검사는 **반드시** PREPARE 안에 둘 것. PREPARE 는 EXECUTE 시점에만
--      파싱되므로, 컬럼이 없는 DB 에서는 그 문장을 아예 고르지 않으면 된다. 밖에서 직접
--      쓰면 '이미 전환이 끝난 DB' 에서 그 SET 문 자체가 ERROR 1054 로 죽는다.
--      (A판에는 그런 문장이 여럿 있었다. 절단판에서는 전부 PREPARE 안으로 옮겼다.)
-- ---------------------------------------------------------------------------

-- ---------- 가드 0-A) 선행조건: org_unit 이 있어야 한다 ----------
SET @has_org_unit := (SELECT COUNT(*) FROM information_schema.TABLES
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit');
SET @g := IF(@has_org_unit = 1, 'DO 0',
             'SELECT 1 FROM `중단: org_unit 없음 — 01-schema-users.sql 을 먼저 돌릴 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 가드 0-B) 선행조건: app_user 도 있어야 한다 ----------
--   6~11단계가 app_user 를 건드린다. 없으면 중간까지만 돌고 반쪽 상태로 끝난다 — 미리 막는다.
SET @has_app_user := (SELECT COUNT(*) FROM information_schema.TABLES
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user');
SET @g := IF(@has_app_user = 1, 'DO 0',
             'SELECT 1 FROM `중단: app_user 없음 — 01-schema-users.sql 을 먼저 돌릴 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 상태 탐지 — 이 아래 전부가 이 다섯 값으로 갈린다 ----------
--   전환은 여러 DDL 로 이뤄지고 DDL 은 트랜잭션이 없다. 그래서 '중간 상태'가 실재한다.
--   어느 중간 상태에서 재개해도 죽지 않으려면, 먼저 지금이 어디인지 정확히 알아야 한다.
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

-- ---------- 가드 0-C) 이미 번호가 붙었는가 = 명부 가드의 우회 스위치 ----------
--   ★ 우회의 기준을 '컬럼이 있는가'가 아니라 '번호 배정까지 끝났는가'로 잡는다.
--     컬럼 존재만 보면 구멍이 하나 생긴다: 1단계(ADD COLUMN)까지만 돌고 죽은 실행을 재개할 때
--     org_id 컬럼이 이미 있으므로 [가드 1](명부 해시)이 통과해 버리고, 그 뒤에 2단계가 검사 없이
--     번호를 박는다. 번호가 곧 89명의 소속이므로 그 구간을 무방비로 두면 안 된다.
--     그래서 '컬럼이 있고 && org_id=0 인 행이 하나도 없다' 일 때만 배정 완료로 본다.
--   ★ COUNT 를 PREPARE 로 감싸는 이유는 위 ★ 항목과 같다(컬럼이 없으면 ERROR 1054).
SET @q := IF(@has_org_id = 1,
             'SELECT COUNT(*) FROM org_unit WHERE org_id = 0 INTO @n_zero_pre',
             'SELECT -1 INTO @n_zero_pre');   -- -1 = 컬럼 자체가 없음
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @numbered := IF(@has_org_id = 1 AND @n_zero_pre = 0, 1, 0);

-- ---------- 가드 0-D) 아직 안 옮겼다면 PK 가 (name) 단일이어야 한다 ----------
--   여기서 막지 않으면, PK 가 전혀 다른 무엇인 DB 에서도 3단계가 그대로 돌아
--   그 PK 를 조용히 날려 버린다.
SET @pk_cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
                   FROM information_schema.STATISTICS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
                    AND INDEX_NAME = 'PRIMARY');
SET @g := IF(@numbered = 1 OR @pk_cols = 'name', 'DO 0',
             'SELECT 1 FROM `중단: org_unit PK 가 name 단일이 아니다 — 손으로 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 가드 0-E) 지금 어디까지 왔나 = 사람이 로그에서 볼 한 줄 ----------
--   '전환 끝'은 다섯 조건을 **동시에** 만족하는 상태다. 하나라도 빠지면 중간 상태이고,
--   아래 단계들이 빠진 조각만 골라 마저 돌린다(그래서 여기서 분기할 필요가 없다).
--   cutover_done=1 이면 이 실행은 아무것도 바꾸지 않고 (E) 검증만 하고 끝난다 — 조용한 멱등 통과다.
SET @cutover_done := IF(@numbered = 1 AND @has_parent_id = 1 AND @has_user_org_id = 1
                        AND @has_parent_col = 0 AND @has_user_org_col = 0, 1, 0);
SELECT @has_org_id AS has_org_id, @numbered AS numbered, @has_parent_id AS has_parent_id,
       @has_user_org_id AS has_user_org_id, @has_parent_col AS old_parent_col,
       @has_user_org_col AS old_user_org_col, @cutover_done AS cutover_done;

-- ---------- 가드 1) ★★ 명부 대조 — 반드시 ALTER **앞**에서, 반드시 차단 ----------
--  왜 여기인가: 2단계가 발급하는 번호는 '지금 이 표에 있는 조직 목록 · 그 계층 · 그 sort_order'
--  에 전적으로 달려 있다(depth → sort_order → name 순으로 1..N). 그런데 그 번호가 맞는지는
--  taskmgr-company-data/02-seed-org.sql 의 명시값과 같아야만 확인된다.
--  조직이 하나라도 다르면(신설·폐지·소속 변경·sort_order 변경) 순번이 밀려 **그 지점 뒤가 전부
--  한 칸씩 어긋나고**, 그러면 org_id 로 사람을 조직에 붙인 결과가 통째로 남의 조직이 된다.
--  (89명 전원의 소속이 걸려 있다. app_user.org_id 백필이 이 번호를 그대로 쓴다.)
--
--  ★ DDL 은 트랜잭션으로 되돌아가지 않는다(암묵 커밋). ALTER 뒤에 대조해서 'MISMATCH' 를
--    출력해 봐야 이미 번호가 박힌 뒤다. 그래서 대조를 앞으로 옮기고, 어긋나면 **여기서 멈춘다**.
--
--  검사 방법: 조직 한 줄을 'name:parent:sort_order' 로 적어 sort_order,name 순으로 이어붙인
--  문자열의 SHA-256 을 시드의 것과 비교한다. 이름·부모·순서 셋 중 하나라도 다르면 값이 달라진다.
--  ※ 12줄을 이 파일에 복사하지 않는 이유: 조직 명부가 두 곳에 생기고, 시드가 바뀌어도 여기가
--    안 바뀌면 이 파일이 조용히 거짓말을 하게 된다. 해시 한 줄이면 그 위험이 없다.
--    (실명 조직 데이터를 비공개 저장소 밖으로 복사하지 않는다는 원칙과도 맞는다.)
--  ※ 시드가 정당하게 바뀌면(조직 개편) 이 상수도 함께 갱신해야 한다. 갱신값 구하는 법:
--      SET SESSION group_concat_max_len = 65535;
--      SELECT SHA2(GROUP_CONCAT(CONCAT(name,':',IFNULL(parent,''),':',sort_order)
--                               ORDER BY sort_order, name SEPARATOR '|'), 256) FROM org_unit;
--    단 갱신 전에 **번호가 밀리지 않는지** 먼저 확인할 것 — 밀린다면 해시만 고치는 것은
--    가드를 무력화하는 것이지 문제를 푸는 것이 아니다.
--  ★ 이 가드는 전환 **전** 상태에서만 의미가 있다(parent 컬럼이 있어야 계산된다).
--    번호가 이미 붙었거나 구 컬럼이 이미 없으면 @roster 가 NULL 이 되어 우회한다.
SET SESSION group_concat_max_len = 65535;
SET @q := IF(@numbered = 0 AND @has_parent_col = 1,
  'SELECT SHA2(GROUP_CONCAT(CONCAT(name,'':'',IFNULL(parent,''''),'':'',sort_order)
                            ORDER BY sort_order, name SEPARATOR ''|''), 256)
     FROM org_unit INTO @roster',
  'SELECT NULL INTO @roster');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
--  ↓ 2026-08-24 실측: 실 taskmgr 조직 12행(루트 1 · 본부/부서 4 · 팀 7)
--    · taskmgr-company-data/02-seed-org.sql 의 명부와 일치 확인
SET @roster_expected := '997723e18d26bd81b7f6b5247175a7002d7d9459ba29c13de8b7ee24453a5020';
SET @g := IF(@roster IS NULL OR @roster = @roster_expected, 'DO 0',
             'SELECT 1 FROM `중단: org_unit 명부가 02-seed-org.sql 과 다르다 - 번호가 밀린다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------------------------------------------------------------------------
--  [가드 2~5] 남는 불변식 — 전환 **전** 상태에서 먼저 본다
--
--  ★ 왜 앞에서 보나: 이것들은 파일 끝 (E) 블록이 전환 **뒤**에도 본다. 그런데 뒤에서만 보면,
--    이미 어긋나 있던 DB 는 DDL 을 다 맞고 나서 [E9 차단]에 걸린다 — '전환은 됐는데 게이트가
--    실패한' 가장 다루기 어려운 상태다. 앞에서 같은 것을 보면 DDL 전에 멈춘다.
--  ★ 미러 불변식(양방향 정합·미러 표류·미러 BINARY 비교)은 이 판에 **없다**. 미러를 만들지
--    않기 때문이다. 남는 것은 순수하게 '트리가 트리인가'와 '이름이 이름인가'다:
--      ① app_user 소속 고아 0   ② org_unit 부모 고아 0   ③ 이름 표기 정규화
--      ④ 루트 정확히 1개        ⑤ 순환/도달불가 0        ⑥ 비활성 부모의 활성 자식 0
-- ---------------------------------------------------------------------------

-- ---------- 가드 2) app_user 소속 고아 0 ----------
--  7단계(app_user.org_id 백필)는 이름으로 org_unit 을 찾아 번호를 넣는다. 이름이 없는 소속이
--  있으면 그 사람의 org_id 가 조용히 NULL 로 남고, 겉보기엔 '소속 미등록'과 구분되지 않는다.
--  그 상태로 10단계가 org_unit 컬럼을 지우면 **그 사람의 소속이 영영 사라진다**.
--  ※ 지금은 fk_user_org 가 이걸 막고 있지만, 이 파일은 FK 가 느슨한 DB(외부 반입본·복구본)에
--    떨어질 수도 있다. 백필의 전제는 백필 앞에서 직접 확인한다.
--  ★★ 비교를 BINARY 로 하는 이유 — FK 가 통과시키는 붕괴가 있다
--    이 표의 콜레이션은 utf8mb4_0900_ai_ci 다. 그래서 fk_user_org 는 org_unit='sw 1팀' 을
--    'SW 1팀' 과 같은 값으로 보고 **통과시킨다**. 그런데 배포본은 StringComparer.Ordinal 로
--    소속을 맞춘다(ProjectDb.cs:447) — 앱에게 그 둘은 다른 조직이다.
--    (실측 2026-08-24: SELECT 'SW'='sw' → ai_ci 1 / CAST(... AS BINARY) 0.)
--    ※ CAST(x AS BINARY) 를 쓰는 이유: `BINARY x` 연산자는 MySQL 8.4 에서 deprecated 라
--      실행할 때마다 경고 1287 을 뿜는다(실측). 둘의 판정 결과는 같다.
--    ★ 이 판에서 BINARY 가 더 중요해졌다: 7단계 백필이 ai_ci 로 매칭하면 'sw 1팀' 소속인
--      사람에게 'SW 1팀'(6번) 번호가 붙고, 10단계가 원래 문자열을 지운다. 즉 **표기 차이가
--      영구히 소실된다**. 그래서 백필도 BINARY 로 매칭하고, 여기서 미리 막는다.
SET @q := IF(@has_user_org_col = 1,
  'SELECT COUNT(*) FROM app_user u
     WHERE u.org_unit IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM org_unit o
                        WHERE CAST(o.name AS BINARY) = CAST(u.org_unit AS BINARY))
   INTO @user_org_orphan',
  'SELECT 0 INTO @user_org_orphan');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @g := IF(@user_org_orphan = 0, 'DO 0',
             'SELECT 1 FROM `중단: app_user.org_unit 에 org_unit 에 없는 값이 있다 (고아)`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 가드 3) org_unit 부모 고아 0 ----------
--  5단계(parent_id 백필)의 전제. parent 가 실재하지 않는 이름을 가리키면 parent_id 가 NULL 로
--  남는데, 그러면 그 노드는 **에러 없이 루트로 승격**된다. 그 뒤 10단계가 parent 를 지우면
--  '원래 어느 조직 밑이었는가'가 사라진다. 조용히 틀리는 상태라 반드시 앞에서 막는다.
--  ★ 비교는 [가드 2]와 같은 이유로 BINARY 다.
--  ★ 이미 전환된 DB(parent 없음)에서는 FK(fk_org_parent_id)가 같은 것을 강제하므로 0 이다.
SET @q := IF(@has_parent_col = 1,
  'SELECT COUNT(*) FROM org_unit c
     WHERE c.parent IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM (SELECT name FROM org_unit) p
                        WHERE CAST(p.name AS BINARY) = CAST(c.parent AS BINARY))
   INTO @org_parent_orphan',
  'SELECT 0 INTO @org_parent_orphan');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @g := IF(@org_parent_orphan = 0, 'DO 0',
             'SELECT 1 FROM `중단: org_unit.parent 가 실재하지 않는 조직을 가리킨다 (고아)`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 가드 4) 이름 표기 정규화 — '보이지 않게 다른 이름'을 들여보내지 않는다 ----------
--  앞뒤 공백 · 전각 영숫자(ＳＷ) · NBSP(U+00A0) 는 화면에서 구별되지 않으면서 Ordinal 비교로는
--  다른 문자열이다. 배포본 ExpandUnitTree 는 내 소속만 Trim() 하고 트리의 이름들은 안 하므로
--  ' SW 1팀' 은 자기 자신과도 안 맞는다(조용한 실패).
--  ★ 이 판에서 이 가드가 더 중요해진 이유: 이름이 **org_unit.name 한 곳에만** 남는다.
--    그 한 곳이 오염되면 대조할 곳이 없다. 02-seed-org.sql 의 (C) 가드와 같은 검사다.
--  ※ 패턴을 16진 바이트로 조립하는 이유: 이 파일이 어떤 인코딩 사고를 겪어도 패턴만은
--    ASCII 로 남아 뜻이 바뀌지 않는다(정규식 escape 는 못 쓴다 — mysql 클라이언트가 역슬래시를
--    먼저 먹는다, 실측). 뜻은 '전각 영숫자 + 눈에 보이지 않는 공백·제어문자 전부' 다.
--  ★★ MySQL TRIM 은 ASCII 0x20 **하나만** 뗀다. 그래서 전각 공백(U+3000)·탭·NBSP 는 이름
--    앞뒤에 붙어 있어도 위의 TRIM 비교가 못 잡는다 — 그 구멍을 이 정규식이 메운다(위치 무관).
--    한국어 IME 로 가장 쉽게 들어오는 것이 U+3000 이라, 이게 빠져 있던 동안 게이트가
--    '　SW 1팀' 을 통과시켰다(실측). 통과하면 배포본이 그 팀의 unit_tree 를 0명으로 만든다.
--  ★★ 이 집합은 org-ops.sql · org-ops.ps1($ORG_NAME_BAN) · rollback · apply.ps1 ·
--    02-seed-org.sql 이 **글자까지 같은 것**을 써야 한다. 갈리면 판정이 갈린다.
--  ※ @fw_ban 은 아래 (E4)·[E9 차단]에서도 다시 쓴다 — 같은 세션 변수를 공유해 판정이 갈리지
--    않게 한다.
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
SET @name_bad := (SELECT COUNT(*) FROM org_unit
                   WHERE CAST(name AS BINARY) <> CAST(TRIM(name) AS BINARY) OR name REGEXP @fw_ban);
SET @q := IF(@has_parent_col = 1,
  'SELECT COUNT(*) FROM org_unit WHERE parent IS NOT NULL
     AND (CAST(parent AS BINARY) <> CAST(TRIM(parent) AS BINARY) OR parent REGEXP @fw_ban)
   INTO @pname_bad',
  'SELECT 0 INTO @pname_bad');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @q := IF(@has_user_org_col = 1,
  'SELECT COUNT(*) FROM app_user WHERE org_unit IS NOT NULL
     AND (CAST(org_unit AS BINARY) <> CAST(TRIM(org_unit) AS BINARY) OR org_unit REGEXP @fw_ban)
   INTO @uname_bad',
  'SELECT 0 INTO @uname_bad');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @g := IF(@name_bad + @pname_bad + @uname_bad = 0, 'DO 0',
             'SELECT 1 FROM `중단: 조직 이름에 앞뒤 공백/전각 영숫자/NBSP 가 있다 - 정규화할 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 가드 5) ★★ 트리가 트리인가 — 루트 1개 · 순환/도달불가 0 ·
--            비활성 절단 0 · 비활성 조직의 재직자 0 ----------
--  ★ 왜 전환 전에도 봐야 하나
--    이 셋은 전환이 만들어 내는 문제가 아니라 **이미 있던 문제**다. 그런데 파일 끝 (E) 에서만
--    보면, 이미 순환이 있던 DB 는 DDL 을 전부 맞고 나서 [E9 차단]에 걸린다. 그때는 '전환은
--    됐는데 게이트가 실패한' 상태라 사람이 롤백부터 해야 한다. 앞에서 같은 것을 보면 안 돈다.
--  ★ FK 는 순환을 막지 못한다. FK 는 '부모가 실재하는가'만 보고 '루트에서 닿는가'는 보지 않는다.
--    두 조직이 서로를 부모로 가리키면 그 둘은 루트에서 영원히 닿지 않는 **섬**이 되는데,
--    FK 도 '루트 1개' 검사도 전부 통과한다. 트리를 보장하는 유일한 식이 도달가능성이다.
--    (실측 2026-08-24, 복제본: 조직 12개 중 도달 가능 10 · 도달불가 2, 그 소속 19명이
--     CTO 열람 범위 밖으로 나갔는데 A판은 종료코드 0 으로 끝났다.)
--  ★★ 깊이 상한 512 의 뜻 — 순환 탐지가 아니라 폭주 방지다.
--    순환에 속한 노드의 부모는 반드시 그 순환 안에 있으므로, 순환은 애초에 루트에서 도달
--    불가능하다. 즉 이 재귀는 상한이 없어도 반드시 끝나고, 상한을 올려도 순환 탐지력은 조금도
--    줄지 않는다. 반대로 상한이 실제 트리보다 얕으면 **정상 트리를 도달불가로 오판**한다
--    (옛 값 64 는 66단 이상 트리에서 오탐 — 실측). 배포본의 BFS(ExpandUnitTree)에는 깊이 제한이
--    없으므로 게이트가 앱보다 얕은 눈을 가져서는 안 된다.
--    ※ 세 게이트가 **같은 값**을 써야 판정이 갈리지 않는다:
--      이 파일 · taskmgr-company-data/apply.ps1 · db/deploy/org-ops.ps1.
--  ★ 계층을 어느 컬럼으로 읽는가: 바로 아래 [가드 5-pre] 가 고른 @use_name_path 를 따른다.
--    이름 경로의 JOIN 은 BINARY 다 — [가드 3]과 같은 이유다.
--  ★ 비활성 절단(inactive_cut): 배포본은 조직도를 `WHERE is_active = 1` 로 긁는다
--    (ProjectDb.cs:364). 하위 조직을 가진 노드를 is_active=0 으로 내리면 그 밑의 활성 조직이
--    사라진 부모를 가리키게 되고, 웹이 그들을 루트로 승격시킨다.
--    (실측 2026-08-24, 복제본: 비-리프 하나를 is_active=0 으로 내리자 CTO 열람 인원 89 → 69명,
--     루트 1개 → 3개. 에러는 한 줄도 나지 않았다.)  조직 폐지는 **리프부터** 할 것.

-- ---------- 가드 5-pre) ★★ 계층 출처 선택 — '지금 무엇이 정본인가' ----------
--  ★★★ 실측된 결함(2026-08-25) — 옛 판은 '컬럼이 있으면 정본' 으로 골랐다
--    옛 조건은 IF(@has_parent_id = 1, parent_id 경로, parent 경로) 였다. 그런데
--    **4단계(parent_id 컬럼 신설)와 5단계(백필) 사이에서 죽으면** parent_id 는 있지만
--    **전부 NULL** 이다. 그 상태에서 parent_id 로 계층을 읽으면 12개가 전부 루트로 보여
--      `중단: 트리의 루트가 1개가 아니다 - 조직도부터 고칠 것 (사전 가드)`
--    로 **오진단**하고 재개를 거부했다. 데이터는 완전무결하다 — parent 컬럼이 그대로 있고
--    루트도 1개다. 롤백도 같은 이유로 같은 오진을 냈다(rollback [R-가드 2]).
--    → 고른다: **값이 실제로 들어 있는 쪽**이 정본이다.
--
--  ★ 왜 '컬럼 존재' 가 아니라 '값 존재' 인가 — 거울상 상태가 하나 더 있다
--    · 백필 미완 (migrate 4단계 직후):  parent 에 값 O · parent_id 전부 NULL → **parent 가 정본**
--    · 재생성 미완 (rollback R3 직후):  parent 전부 NULL · parent_id 에 값 O → **parent_id 가 정본**
--    '구 컬럼이 있으면 무조건 구 컬럼' 으로 뒤집기만 하면 뒤쪽 상태에서 같은 오진이 거울처럼
--    되살아난다(롤백을 R3 에서 끊고 마이그레이션을 다시 돌리는 경로 — 실제로 생길 수 있다).
--  ★ 둘 다 채워져 있으면 어느 쪽을 골라도 판정이 같다: 5단계 백필이 BINARY 로 파생시킨 값이고,
--    [8단계 절단 관문]이 두 경로의 BINARY 일치를 지우기 전에 강제한다. 그때는 구 컬럼을 쓴다
--    (구 컬럼이 남아 있는 동안은 그쪽이 원본이다).
SET @q := IF(@has_parent_col = 1 AND @has_parent_id = 1,
  'SELECT SUM(parent IS NOT NULL), SUM(parent_id IS NOT NULL)
     INTO @h_pname_set, @h_pid_set FROM org_unit',
  'SELECT NULL, NULL INTO @h_pname_set, @h_pid_set');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
--  백필 미완 = 구 컬럼에는 값이 있는데 parent_id 는 전부 NULL (4단계 직후에서 끊긴 흔적)
SET @backfill_pending := IF(@has_parent_col = 1 AND @has_parent_id = 1
                            AND IFNULL(@h_pid_set, 0) = 0 AND IFNULL(@h_pname_set, 0) > 0, 1, 0);
--  재생성 미완 = 구 컬럼이 껍데기(전부 NULL)인데 parent_id 에는 값이 있다 (rollback R3 직후)
SET @regen_pending    := IF(@has_parent_col = 1 AND @has_parent_id = 1
                            AND IFNULL(@h_pname_set, 0) = 0 AND IFNULL(@h_pid_set, 0) > 0, 1, 0);
SET @use_name_path    := IF(@has_parent_col = 1 AND @regen_pending = 0, 1, 0);
--  ★ 사람이 로그에서 읽을 한 줄. 오진 문구 대신 이 줄이 나와야 한다.
SELECT CASE
         WHEN @backfill_pending = 1
           THEN '5단계 백필 미완 - 재개 중 (계층 출처 = 구 컬럼 parent). 이 실행이 5단계를 마저 돌린다'
         WHEN @regen_pending = 1
           THEN '롤백 R4 재생성 미완 - 재개 중 (계층 출처 = parent_id)'
         WHEN @use_name_path = 1 THEN '전환 전/중 - 계층 출처 = 구 컬럼 parent'
         ELSE '절단 완료 - 계층 출처 = parent_id'
       END AS hierarchy_source,
       CAST(IFNULL(@h_pname_set, -1) AS SIGNED) AS parent_name_filled,
       CAST(IFNULL(@h_pid_set, -1) AS SIGNED) AS parent_id_filled;

SET @q := IF(@use_name_path = 0,
  'WITH RECURSIVE tree AS (
       SELECT org_id, 0 AS depth FROM org_unit WHERE parent_id IS NULL
       UNION ALL
       SELECT o.org_id, t.depth + 1 FROM org_unit o JOIN tree t ON o.parent_id = t.org_id
        WHERE t.depth < 512)
   SELECT COUNT(*) INTO @pre_reach FROM tree',
  'WITH RECURSIVE tree AS (
       SELECT name, 0 AS depth FROM org_unit WHERE parent IS NULL
       UNION ALL
       SELECT o.name, t.depth + 1 FROM org_unit o JOIN tree t
              ON CAST(o.parent AS BINARY) = CAST(t.name AS BINARY)
        WHERE t.depth < 512)
   SELECT COUNT(*) INTO @pre_reach FROM tree');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @pre_unreach := (SELECT COUNT(*) FROM org_unit) - @pre_reach;

SET @q := IF(@use_name_path = 0,
  'SELECT COUNT(*) FROM org_unit WHERE parent_id IS NULL INTO @pre_root',
  'SELECT COUNT(*) FROM org_unit WHERE parent    IS NULL INTO @pre_root');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;

SET @q := IF(@use_name_path = 0,
  'SELECT COUNT(*) FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id
     WHERE c.is_active = 1 AND p.is_active = 0 INTO @pre_cut',
  'SELECT COUNT(*) FROM org_unit c JOIN org_unit p
          ON CAST(p.name AS BINARY) = CAST(c.parent AS BINARY)
     WHERE c.is_active = 1 AND p.is_active = 0 INTO @pre_cut');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;

--  ★ 비활성 조직에 남은 재직자(member_hidden): 위 @pre_cut 은 **조직만** 센다. 조직도는
--    is_active=1 로 긁으므로, 숨긴 조직에 사람이 남아 있으면 그 사람들은 살아 있는데도
--    화면에서 통째로 사라진다. 조직 수만 보는 눈으로는 아예 보이지 않는 상태다
--    (실측: 본부 하나를 숨기고 자식까지 전부 숨기자 @pre_cut 은 0 이 됐는데 CTO 열람 89 → 69명).
--    ★ 전환 전 스키마에서는 소속이 app_user.org_unit(이름)이므로 그 경로로도 셀 수 있어야 한다.
SET @q := CASE
  WHEN @has_user_org_id = 1 AND @has_org_id = 1 THEN
    'SELECT COUNT(*) FROM app_user u JOIN org_unit o ON o.org_id = u.org_id
       WHERE u.is_active = 1 AND o.is_active = 0 INTO @pre_member_hidden'
  WHEN @has_user_org_col = 1 THEN
    'SELECT COUNT(*) FROM app_user u JOIN org_unit o
            ON CAST(o.name AS BINARY) = CAST(u.org_unit AS BINARY)
       WHERE u.is_active = 1 AND o.is_active = 0 INTO @pre_member_hidden'
  ELSE 'SELECT 0 INTO @pre_member_hidden' END;
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;

SELECT @pre_root AS pre_root_count, @pre_unreach AS pre_unreachable, @pre_cut AS pre_inactive_cut,
       @pre_member_hidden AS pre_member_hidden;
SET @g := CASE
  WHEN @pre_root = 1 AND IFNULL(@pre_unreach, 1) = 0 AND @pre_cut = 0
       AND IFNULL(@pre_member_hidden, 1) = 0 THEN 'DO 0'
  WHEN @pre_root <> 1
    THEN 'SELECT 1 FROM `중단: 트리의 루트가 1개가 아니다 - 조직도부터 고칠 것 (사전 가드)`'
  WHEN IFNULL(@pre_unreach, 1) > 0
    THEN 'SELECT 1 FROM `중단: 루트에서 도달 못하는 조직이 있다 (순환/섬) - 사전 가드`'
  WHEN @pre_cut > 0
    THEN 'SELECT 1 FROM `중단: 비활성 부모 밑에 활성 자식이 있다 - 리프부터 폐지할 것 (사전 가드)`'
  ELSE 'SELECT 1 FROM `중단: 비활성 조직에 재직자가 남아 있다 - 먼저 사람을 옮길 것 (사전 가드)`'
  END;
--  ※ 메시지에 '(사전 가드)'를 붙여 둔 이유: 같은 세 검사를 파일 끝 [E9 차단]도 한다.
--    에러 문구만 보고 '전환 전에 막힌 것인지, 전환 뒤에 막힌 것인지'를 구분할 수 있어야 한다
--    (전자는 DDL 이 하나도 안 돈 상태, 후자는 전환이 끝난 상태다 — 조치가 완전히 다르다).
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------------------------------------------------------------------------
--  (P0) ★★ 전환 직전 지문 — 되돌린 뒤 '정말 원래대로인가' 를 증명할 유일한 값.
--    ★ 이 판에서는 전환이 끝나면 parent · app_user.org_unit 이 **없어진다**. 즉 이 두 값을
--      나중에 다시 계산할 방법이 없다. 실행 로그에서 반드시 남겨 둘 것.
--      rollback-2026-08-24-org-id.sql 이 되돌린 뒤 같은 두 값을 다시 찍는다 — 글자까지 같으면
--      데이터가 한 바이트도 안 변한 것이다.
--  ※ 행 단위로 먼저 SHA2 하고 이어붙이는 이유: 조직명에 구분자가 들어 있어도 경계가 흐려지지
--    않는다(행 해시는 항상 64자 고정). GROUP_CONCAT 의 SEPARATOR 는 리터럴만 받아서,
--    구분자를 CHAR(30) 같은 식으로는 줄 수 없다(ERROR 1064 — 실측).
--  ※ 이 두 문장은 아무것도 바꾸지 않는다. SELECT 뿐이다.
--  ※ 이미 전환이 끝난 DB 에서 재실행하면 NULL 두 줄이 나온다(구 컬럼이 없다) — 정상이다.
SET SESSION group_concat_max_len = 1048576;
SET @q := IF(@has_parent_col = 1,
  'SELECT SHA2(GROUP_CONCAT(SHA2(CONCAT_WS(CHAR(31), name, IFNULL(parent,CHAR(0)), sort_order,
          is_active, created_at, updated_at), 256) ORDER BY name SEPARATOR ''''), 256)
     FROM org_unit INTO @org_fp_before',
  'SELECT NULL INTO @org_fp_before');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @q := IF(@has_user_org_col = 1,
  'SELECT SHA2(GROUP_CONCAT(SHA2(CONCAT_WS(CHAR(31), user_id, login_id, name, IFNULL(title,CHAR(0)),
          IFNULL(org_unit,CHAR(0)), view_scope, edit_role, is_active, created_at, updated_at), 256)
          ORDER BY user_id SEPARATOR ''''), 256)
     FROM app_user INTO @user_fp_before',
  'SELECT NULL INTO @user_fp_before');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SELECT @org_fp_before AS org_unit_fp_before, @user_fp_before AS app_user_fp_before;

-- ============================================================================
--  전환
-- ============================================================================

-- ---------- 1) org_unit.org_id 컬럼 신설 (아직 번호 없음·아직 키 아님) ----------
--  ★ 왜 AUTO_INCREMENT 로 만들지 않는가 (user-id 마이그레이션과 갈리는 지점)
--    AUTO_INCREMENT 는 '클러스터드 인덱스 순서'로 번호를 뿌린다 = 지금 PK 인 name 오름차순
--    = 조직명 사전순(utf8mb4_0900_ai_ci). 그러면 org_id 가 조직 계층과 아무 관계 없는 순서로
--    붙고, 02-seed-org.sql 이 그 순서를 사람이 손으로 재현할 수 없게 된다(한글 콜레이션 순서를
--    시드 파일에 적을 수는 없다). 그래서 번호를 **명시 규칙으로 직접 박고**(2단계),
--    AUTO_INCREMENT 는 키를 세울 때 붙인다(3단계). 그때 InnoDB 가 카운터를 max+1 로 맞춘다
--    (실측: 12행 배정 후 AUTO_INCREMENT=13).
--  · DEFAULT 0 인 이유: NOT NULL 컬럼을 기존 행에 추가하려면 채울 값이 필요하다. 0 은
--    '아직 배정 안 됨'의 표식이고, 2단계가 전부 덮는다. 3단계 뒤에는 0 이 남을 수 없다
--    (남으면 PK 중복으로 ALTER 자체가 실패한다 — 즉 이 상태는 검출 가능하다).
--  · 조건: org_id 컬럼이 아직 없을 때만. 있으면 no-op(재실행 안전).
SET @s := IF(@has_org_id = 0,
  'ALTER TABLE org_unit ADD COLUMN org_id SMALLINT UNSIGNED NOT NULL DEFAULT 0 FIRST',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 2) 번호 배정 — 계층 너비우선(depth → sort_order → name) 1..N ----------
--  ★★★ 이 규칙은 taskmgr-company-data/02-seed-org.sql 의 명시 배정과 **글자 그대로 같아야 한다**.
--     시드는 '루트 1 · 본부 2~5 · 팀 6~12' 로 번호를 손으로 박아 둔다. 즉 트리를 위에서
--     아래로(depth), 같은 층 안에서는 화면 표시 순서(sort_order)로 훑는 순서다.
--     두 경로(신규 구축 / 이 마이그레이션)가 다른 번호를 내면, 같은 회사의 DB 두 벌이 서로
--     비교 불가능해지고 문서(개명 절차의 `WHERE org_id = @id`)가 한쪽에서만 맞게 된다.
--     ※ 실측 2026-08-24: 아래 문장을 실 taskmgr 복제본에 돌린 결과가 02-seed-org.sql 의
--       12쌍과 완전히 일치했다(1=루트, 2~5=본부 4개, 6~12=팀 7개).
--  ★ AUTO_INCREMENT 순서에 맡기지 않는 이유가 이것이다. 그 순서는 조직명 콜레이션 순서라
--    사람이 시드 파일에 재현할 수 없다.
--  ★ 왜 'sort_order 오름차순' 한 축으로는 안 되나: 이 회사의 sort_order 는 본부 20 → 그 산하
--    팀 21,22… 로 매겨져 있어 한 축으로 정렬하면 본부와 팀이 뒤섞인다. 사람이 외울 수 없는
--    번호가 되고, 시드에 손으로 적기도 어렵다. depth 를 1순위로 두면 '앞번호=상위조직'이 되어
--    번호만 보고도 층이 읽힌다.
--  ★ depth 는 재귀 CTE 로 parent(이름)를 타고 계산한다. 이 시점의 parent 는 아직
--    fk_org_parent 가 지키는 검증된 값이다(9단계에서야 뗀다) — 그래서 신뢰할 수 있다.
--    JOIN 이 BINARY 인 이유는 [가드 3]과 같다. 가드 3 이 통과했으므로 ai_ci 매칭과 결과가
--    같지만, '이름 매칭은 언제나 BINARY' 를 이 파일의 규약으로 고정해 둔다.
--  ★ 동률 tie-break 로 name 을 넣은 이유: sort_order 는 UNIQUE 가 아니다. 같은 값이 둘이면
--    ROW_NUMBER 의 순서가 비결정적이 되어 '두 번 돌리면 다른 번호'가 될 수 있다. name 은
--    이 시점에 PK 라 유일하므로, (depth, sort_order, name)은 전순서(total order)를 보장한다.
--  ★ 이 UPDATE 가 ERROR 1093('you can't specify target table for update in FROM clause')을
--    피하는 이유: 파생 테이블에 윈도우 함수가 있어 머지되지 않고 반드시 실체화(materialize)된다.
--    실측으로 통과 확인. (WITH RECURSIVE 를 UPDATE 앞에 두는 문법도 prepared statement 안에서
--    동작함을 실측 확인.)
--  ★ updated_at = updated_at 은 오타가 아니다. 명시 대입이 ON UPDATE CURRENT_TIMESTAMP(3)을
--    억제한다(실측). 없으면 조직 12행의 갱신시각이 전부 마이그레이션 시각으로 덮인다.
--  · 조건: **모든 행이 org_id=0** 일 때만 = 방금 1단계가 만든 컬럼일 때만.
--    부분 배정(0 과 비0 이 섞임)은 사람이 봐야 하는 상태라 아래에서 차단한다.
--    이미 배정된 DB 에서 이 문장이 다시 돌면 안 되는 이유: 나중에 조직이 신설되어 층/순서가
--    중간에 끼면 재번호가 일어나 **전 직원 소속이 어긋난다**. 재실행 안전의 핵심이 이 조건이다.
--  ※ @n_all·@n_zero 도 PREPARE 로 읽는다 — 1단계가 no-op 인 경로(컬럼 없음)에서 org_id 를
--    직접 쓰면 ERROR 1054 다. 여기까지 왔으면 컬럼은 반드시 있지만, 규약을 깨지 않는다.
SET @n_all := (SELECT COUNT(*) FROM org_unit);
SET @q := 'SELECT COUNT(*) FROM org_unit WHERE org_id = 0 INTO @n_zero';
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @g := IF(@n_zero = 0 OR @n_zero = @n_all, 'DO 0',
             'SELECT 1 FROM `중단: org_id 가 일부만 배정된 상태 - 중단된 실행 흔적. 손으로 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SET @s := IF(@n_zero = @n_all AND @n_all > 0 AND @has_parent_col = 1,
  'WITH RECURSIVE tree AS (
       SELECT name, sort_order, 0 AS depth FROM org_unit WHERE parent IS NULL
       UNION ALL
       SELECT o.name, o.sort_order, t.depth + 1
         FROM org_unit o JOIN tree t ON CAST(o.parent AS BINARY) = CAST(t.name AS BINARY)
   )
   UPDATE org_unit o
      JOIN (SELECT name AS nm, ROW_NUMBER() OVER (ORDER BY depth, sort_order, name) AS rn
              FROM tree) x
        ON CAST(o.name AS BINARY) = CAST(x.nm AS BINARY)
     SET o.org_id = x.rn, o.updated_at = o.updated_at',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 2b) 번호 미배정 잔여 0 — 재귀가 닿지 못한 행을 잡는다 ----------
--  2단계의 JOIN 은 재귀 CTE 가 만든 집합(=루트에서 도달 가능한 노드)하고만 매칭된다.
--  [가드 5]가 도달불가 0 을 이미 확인했으므로 정상 경로에서는 여기 걸리지 않는다. 그래도
--  둔다 — 가드와 배정 사이에 사람이 끼어드는 경우가 있고, 그대로 3단계에 들어가면
--    · 그런 행이 2개 이상이면 PRIMARY KEY 중복으로 ALTER 가 실패하고(그나마 다행)
--    · 정확히 1개면 **0번 조직**이 조용히 생겨 AUTO_INCREMENT 와 어긋난다.
--  ★ 구 컬럼이 이미 없는 DB(재개)에서는 2단계가 no-op 이므로, 그때 org_id=0 이 남아 있다면
--    그것은 '번호를 못 박은 채 구 컬럼을 지운' 최악의 상태다 — 여기서 반드시 멈춰야 한다.
SET @q := 'SELECT COUNT(*) FROM org_unit WHERE org_id = 0 INTO @n_zero_after';
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @g := IF(@n_zero_after = 0, 'DO 0',
             'SELECT 1 FROM `중단: 번호를 배정받지 못한 조직이 있다 (도달불가/구 컬럼 부재)`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ---------- 3) PK 교체: name → org_id, name 은 UNIQUE 로 강등, org_id 에 AUTO_INCREMENT ----------
--  ★ 이 문장은 org_unit(name) 을 참조하는 FK 2개가 **살아 있는 채로** 통과한다.
--    (실측 2026-08-24, MySQL 8.4.9, foreign_key_checks=1 기본값:
--     fk_org_parent(org_unit.parent → org_unit.name, 자기참조) ·
--     fk_user_org(app_user.org_unit → org_unit.name) — 둘 다 살아 있는 채로 통과했고,
--     문장 뒤에도 둘 다 그대로였다. SHOW CREATE TABLE 로 확인.)
--    이유: 같은 ALTER 안에서 name 을 받칠 UNIQUE 가 함께 서기 때문에, FK 가 요구하는
--    '참조 컬럼 위의 인덱스'가 한 순간도 사라지지 않는다. ADD UNIQUE KEY 를 빼고 DROP PRIMARY KEY
--    만 하면 그 자리에서 ERROR 1553 이 난다 — 네 조각을 한 문장에 묶어 둔 것이 요점이다. 쪼개지 말 것.
--  ★ uq_org_unit_name 은 임시 조치가 아니라 **최종 스키마의 일부**다. 조직 이름은 계속 유일해야
--    한다(겹치면 사람이 조직을 지목할 수 없다). 9~10단계에서 구 FK 를 떼도 이 UNIQUE 는 남는다.
--  ★ MODIFY ... AUTO_INCREMENT 를 같은 문장에 넣는 이유: AUTO_INCREMENT 컬럼은 어떤 인덱스의
--    선두여야 한다(아니면 ERROR 1075). 같은 문장에서 PRIMARY KEY(org_id)가 서므로 조건을 만족한다.
--    또 AUTO_INCREMENT 컬럼은 DEFAULT 를 가질 수 없어, 여기서 1단계의 DEFAULT 0 이 함께 사라진다.
--  · 조건: PK 가 아직 org_id 가 아닐 때만.
SET @pk_is_org_id := (SELECT COUNT(*) FROM information_schema.STATISTICS
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
                         AND INDEX_NAME = 'PRIMARY' AND COLUMN_NAME = 'org_id');
SET @s := IF(@pk_is_org_id = 0,
  'ALTER TABLE org_unit
     DROP PRIMARY KEY,
     ADD PRIMARY KEY (org_id),
     ADD UNIQUE KEY uq_org_unit_name (name),
     MODIFY COLUMN org_id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 4) org_unit.parent_id 컬럼 신설 (계층의 **유일한** 정본) ----------
--  · 타입은 org_id 와 **정확히 같아야** FK 가 선다: SMALLINT UNSIGNED.
--  · NULL 허용 = 루트. 스키마가 루트 개수를 강제하지는 않는다(강제하면 조직 개편 중간 상태를
--    저장할 수 없다). 개수 검사는 [가드 5]와 파일 끝 (E4)가 한다.
--  · 위치를 name 뒤로 잡은 이유: SELECT * 로 볼 때 org_id · name · parent_id 가 나란히 보인다.
--    (A판에서는 그 뒤에 parent 미러가 하나 더 붙어 있었다. 이제 없다.)
--  · 조건: 컬럼이 아직 없을 때만.
SET @s := IF(@has_parent_id = 0,
  'ALTER TABLE org_unit ADD COLUMN parent_id SMALLINT UNSIGNED NULL DEFAULT NULL AFTER name',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 5) parent_id 백필: parent 이름 → org_id. 루트는 NULL 유지 ----------
--  ★ 지금 이 순간의 parent 는 아직 fk_org_parent 가 지키는 '검증된 값'이다(9단계에서야 뗀다).
--    그래서 이 백필의 입력은 신뢰할 수 있다. 순서를 바꿔 FK 를 먼저 떼면 그 보장이 사라진다 —
--    9단계를 5단계 뒤로 둔 것은 취향이 아니라 순서 의존이다.
--  ★ JOIN 이 자기 자신을 파생 테이블로 감싸는 이유: UPDATE 대상 표를 같은 문장의 FROM 절에서
--    직접 읽으면 ERROR 1093. (SELECT org_id, name FROM org_unit) 로 감싸면 실체화되어 통과한다.
--  ★ INNER JOIN 이므로 parent 가 NULL 인 루트는 아예 매칭되지 않아 parent_id 가 NULL 로 남는다
--    — 이것이 의도다. [가드 3]이 '이름은 있는데 실재하지 않는 부모'를 이미 걸러냈으므로,
--    여기서 매칭에 실패해 NULL 로 남는 행은 진짜 루트뿐이다. [8단계 관문]이 그것을 다시 센다.
--  ★ 매칭이 BINARY 인 이유는 [가드 2] ★ 항목 참조 — 이 판은 원본 문자열을 지우므로,
--    ai_ci 로 매칭하면 표기 차이가 **영구히** 소실된다.
--  ★ updated_at = updated_at — 2단계와 같은 이유.
--  · 조건: 채울 것이 있을 때만(parent 는 있는데 parent_id 가 NULL 인 행). 이미 채워졌으면 no-op.
--    이 조건은 '덮어쓰기'를 하지 않는다 — 이미 값이 있는 parent_id 는 절대 건드리지 않는다.
SET @q := IF(@has_parent_col = 1,
  'SELECT COUNT(*) FROM org_unit WHERE parent IS NOT NULL AND parent_id IS NULL INTO @pid_unset',
  'SELECT 0 INTO @pid_unset');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @s := IF(@pid_unset > 0,
  'UPDATE org_unit c
      JOIN (SELECT org_id, name FROM org_unit) p
        ON CAST(p.name AS BINARY) = CAST(c.parent AS BINARY)
     SET c.parent_id = p.org_id, c.updated_at = c.updated_at
   WHERE c.parent_id IS NULL',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 6) app_user.org_id 컬럼 신설 ----------
--  ★ NULL 허용인 이유: 기존 org_unit 이 NULL 허용이고(소속 미등록), 그 상태를 그대로 옮겨야
--    한다. NOT NULL 로 만들면 소속 없는 사람을 넣을 수 없게 되어 정책이 바뀌어 버린다.
--    (2026-08-24 실측: 현재 소속이 NULL 인 사용자는 0명. 하지만 스키마가 그걸 강제하진 않는다.)
--  ★★ 위치를 title 뒤로 잡은 이유 — 롤백 무손실의 일부다.
--    10단계에서 사라질 org_unit 의 자리를 그대로 물려받는다. 그래야 전환 뒤 컬럼 순서가
--    (…, title, org_id, view_scope, …) 가 되고, 롤백이 org_unit 을 title 뒤에 되살린 뒤
--    org_id 를 지우면 **원래 컬럼 순서로 정확히 복원**된다.
--    (실측 2026-08-24: migrate → rollback 후 app_user 의 컬럼 순서가 전환 전과 완전히 같았다.
--     A판은 org_unit 을 남겼으므로 AFTER org_unit 이었다 — 절단판에서는 그 자리가 없다.)
--  · 조건: 컬럼이 아직 없을 때만.
SET @s := IF(@has_user_org_id = 0,
  'ALTER TABLE app_user ADD COLUMN org_id SMALLINT UNSIGNED NULL DEFAULT NULL AFTER title',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 7) app_user.org_id 백필: org_unit 이름 → org_id. NULL 소속은 NULL 유지 ----------
--  ★ INNER JOIN 이므로 소속이 NULL 인 사람은 매칭되지 않아 org_id 가 NULL 로 남는다 — 의도다.
--    [가드 2]가 '이름은 있는데 실재하지 않는 소속'을 이미 걸러냈으므로, 여기서 NULL 로 남는 행은
--    진짜 '소속 미등록'뿐이다. [8단계 관문]이 그것을 다시 센다.
--  ★ 매칭이 BINARY 인 이유는 5단계와 같다.
--  ★ updated_at = updated_at — 2단계와 같은 이유. 89행의 갱신시각을 지키기 위해서다.
--  · 조건: 채울 것이 있을 때만. 이미 값이 있는 org_id 는 덮지 않는다(WHERE org_id IS NULL).
SET @q := IF(@has_user_org_col = 1,
  'SELECT COUNT(*) FROM app_user WHERE org_unit IS NOT NULL AND org_id IS NULL INTO @uid_unset',
  'SELECT 0 INTO @uid_unset');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @s := IF(@uid_unset > 0,
  'UPDATE app_user u
      JOIN org_unit o ON CAST(o.name AS BINARY) = CAST(u.org_unit AS BINARY)
     SET u.org_id = o.org_id, u.updated_at = u.updated_at
   WHERE u.org_id IS NULL',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ============================================================================
--  [8단계 절단 관문] ★★★ 되돌릴 수 없는 지점 — 여기를 통과해야만 구 컬럼을 지운다
--
--  ★ 이 관문이 이 파일에서 가장 중요한 블록이다.
--    9~10단계는 org_unit.parent 와 app_user.org_unit 을 **영구히 지운다**. 지운 뒤에는
--    '원래 무슨 값이었나'를 물어볼 곳이 없다. 롤백조차 정본(parent_id·org_id)에서
--    **재생성**하는 방식이라, 정본이 구 컬럼을 완전히 재현하지 못하면 롤백은 무손실이 아니다.
--    → 그러므로 '지워도 되는가'의 정의는 딱 하나다:
--       **정본만으로 구 컬럼의 모든 값을 BINARY 로 한 글자도 틀리지 않게 되살릴 수 있는가.**
--    아래 네 값이 전부 0 이면 그렇다. 하나라도 0 이 아니면 지우지 않고 여기서 멈춘다.
--
--    · pid_null_disagree : parent 와 parent_id 중 한쪽만 NULL 인 행
--                          (→ 루트/비루트 판정이 갈린다. 재생성하면 그 행의 부모가 달라진다)
--    · pid_name_drift    : parent_id 가 가리키는 조직의 이름 ≠ parent 문자열 (BINARY)
--                          (→ 재생성하면 다른 이름이 들어간다. 대소문자 표류가 여기서 잡힌다)
--    · uid_null_disagree : app_user 의 소속 두 경로 중 한쪽만 NULL 인 행
--    · uid_name_drift    : org_id 가 가리키는 조직의 이름 ≠ org_unit 문자열 (BINARY)
--
--  ★ 왜 BINARY 인가: 표 콜레이션이 utf8mb4_0900_ai_ci 라 'SW 1팀' 과 'sw 1팀' 을 같은 값으로
--    본다. ai_ci 로 이 관문을 통과시키면, 원본이 'sw 1팀' 이었는데 재생성값은 'SW 1팀' 이 되어
--    **롤백이 데이터를 바꾼다**. 배포본은 StringComparer.Ordinal(ProjectDb.cs:447)이라 그 둘을
--    다른 조직으로 본다 — 사람 눈에도 앱 눈에도 다른 값이다.
--
--  ★ 이 관문은 A판 [가드 2](롤백의 미러 정합 검사)가 있던 자리를 대신한다. A판은 '되돌릴 때'
--    미러를 믿을 수 있는지 물었고, 절단판은 '지울 때' 정본을 믿을 수 있는지 묻는다.
--    묻는 시점이 앞으로 옮겨진 것이 요점이다 — 지운 뒤에 물으면 늦다.
--
--  ★ 이미 구 컬럼이 없는 DB(재개·재실행)에서는 검사할 대상이 없으므로 0 이다. 그 상태는
--    '이전 실행이 이 관문을 통과하고 지웠다'는 뜻이다.
-- ============================================================================
SET @q := CONCAT('SELECT ',
  IF(@has_parent_col = 1 AND @has_parent_id = 1,
     '(SELECT COUNT(*) FROM org_unit WHERE (parent IS NULL) <> (parent_id IS NULL))', '0'),
  ' INTO @cut_pid_null');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @q := CONCAT('SELECT ',
  IF(@has_parent_col = 1 AND @has_parent_id = 1,
     '(SELECT COUNT(*) FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id
        WHERE CAST(c.parent AS BINARY) <> CAST(p.name AS BINARY))', '0'),
  ' INTO @cut_pid_drift');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @q := CONCAT('SELECT ',
  IF(@has_user_org_col = 1 AND @has_user_org_id = 1,
     '(SELECT COUNT(*) FROM app_user WHERE (org_unit IS NULL) <> (org_id IS NULL))', '0'),
  ' INTO @cut_uid_null');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;
SET @q := CONCAT('SELECT ',
  IF(@has_user_org_col = 1 AND @has_user_org_id = 1,
     '(SELECT COUNT(*) FROM app_user u JOIN org_unit o ON o.org_id = u.org_id
        WHERE CAST(u.org_unit AS BINARY) <> CAST(o.name AS BINARY))', '0'),
  ' INTO @cut_uid_drift');
PREPARE _q FROM @q; EXECUTE _q; DEALLOCATE PREPARE _q;

SELECT @cut_pid_null AS pid_null_disagree, @cut_pid_drift AS pid_name_drift,
       @cut_uid_null AS uid_null_disagree, @cut_uid_drift AS uid_name_drift;
SET @g := IF(@cut_pid_null + @cut_pid_drift + @cut_uid_null + @cut_uid_drift = 0, 'DO 0',
             'SELECT 1 FROM `중단: 정본이 구 컬럼을 재현하지 못한다 - 지우면 롤백이 무손실이 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ============================================================================
--  절단 — 구 제약을 떼고 구 컬럼을 지운다
-- ============================================================================

-- ---------- 9) 구 FK 2개 DROP ----------
--  · fk_org_parent : 개명을 막던 바로 그 제약(자기참조 CASCADE 미수행). 계층의 정본이
--    parent_id 로 옮겨 갔으니 뗀다.
--  · fk_user_org   : app_user.org_unit → org_unit.name. 10단계에서 그 컬럼 자체를 지우므로
--    먼저 떼야 한다(제약이 걸린 컬럼은 못 지운다).
--    ★ A판은 이 FK 를 **유지**했다. 그 CASCADE 가 사람 쪽 이름 미러를 따라오게 하는 장치였기
--      때문이다. 미러가 없어졌으니 그 장치도 필요 없다 — 소속은 이제 org_id 하나뿐이고,
--      개명은 app_user 를 아예 건드리지 않는다.
--  · 조건: 그 이름의 FK 가 아직 있을 때만.
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
              AND CONSTRAINT_NAME = 'fk_org_parent' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @s := IF(@c > 0, 'ALTER TABLE org_unit DROP FOREIGN KEY fk_org_parent', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
              AND CONSTRAINT_NAME = 'fk_user_org' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @s := IF(@c > 0, 'ALTER TABLE app_user DROP FOREIGN KEY fk_user_org', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 10) ★ 구 컬럼 2개 DROP — 이름 미러가 세상에서 사라진다 ----------
--  ★ 인덱스 ix_org_parent(parent) · ix_user_org(org_unit) 는 **따로 지우지 않는다**.
--    MySQL 은 인덱스를 이루는 컬럼이 전부 없어지면 그 인덱스를 함께 없앤다. 둘 다 단일 컬럼
--    인덱스이므로 DROP COLUMN 한 문장에 같이 사라진다.
--    (실측 2026-08-24, MySQL 8.4.9, 실 taskmgr 복제본: DROP COLUMN 뒤 SHOW CREATE TABLE 에
--     두 인덱스가 모두 없었다. 확정 설계가 요구하는 상태 그대로다.)
--    ※ 그래서 DROP INDEX 를 따로 쓰면 오히려 위험하다 — 9단계 직후 그 인덱스는 아직 FK 의
--      받침일 수 있고, 순서를 잘못 쓰면 ERROR 1553 이 난다. 컬럼과 함께 보내는 것이 맞다.
--  ★ 이 두 문장 이후 배포본 v0.17.1 의 S2~S6 이 ERROR 1054 로 실패한다. 파일 머리 [적용] 2)
--    컷오버 경고 참조. S1(과제 편집 권한 관문)은 이 컬럼들을 안 읽으므로 계속 동작한다.
--  · 조건: 컬럼이 아직 있을 때만.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit' AND COLUMN_NAME = 'parent');
SET @s := IF(@c > 0, 'ALTER TABLE org_unit DROP COLUMN parent', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'org_unit');
SET @s := IF(@c > 0, 'ALTER TABLE app_user DROP COLUMN org_unit', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 11) 새 FK 2개 ADD — 무결성을 번호 위에 다시 세운다 ----------
--  ON UPDATE CASCADE: org_id 는 우리가 발급한 불변 번호라 사실 갱신될 일이 없다. 그래도 선언은
--    남긴다 — 이 표의 다른 FK 와 규약을 맞추기 위해서다(01-schema-users.sql 의 모든 FK 가 이 짝).
--    ★ 그리고 이번에는 이 CASCADE 가 '동작하지 않아도 무해하다'. 자기참조 CASCADE 미수행이
--      문제였던 건 갱신되는 값이 name(가변)이었기 때문이고, org_id 는 갱신하지 않는다.
--  ON DELETE RESTRICT: 하위 조직이나 소속 인원이 달린 노드를 지우지 못하게 한다. 조직은
--    소프트 삭제(is_active=0)가 정책이고, 하드 삭제는 사고일 가능성이 높다 — 1451 로 막히는 게 맞다.
--  ★ 인덱스를 따로 만들지 않는 이유: InnoDB 가 제약과 같은 이름(fk_org_parent_id ·
--    fk_user_org_id)으로 자동 생성한다(실측). 01-schema-users.sql 도 같은 이름이 나오므로,
--    '신규 구축'과 '마이그레이션'이 만든 스키마가 어긋나지 않는다. 여기서 ix_… 를 손으로
--    만들면 두 경로의 인덱스 이름이 달라져 비교가 불가능해진다.
--    → 확정 설계가 말하는 '대신 parent_id 인덱스' 가 바로 이 자동 인덱스(fk_org_parent_id)다.
--  ★ 이 FK 들이 고아를 **DB 차원에서** 강제한다. A판에서 손으로 세던 고아 검사가 이제 제약이다.
--  · 조건: 아직 없을 때만.
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
              AND CONSTRAINT_NAME = 'fk_org_parent_id' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @s := IF(@c = 0,
  'ALTER TABLE org_unit ADD CONSTRAINT fk_org_parent_id FOREIGN KEY (parent_id)
     REFERENCES org_unit(org_id) ON UPDATE CASCADE ON DELETE RESTRICT',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
              AND CONSTRAINT_NAME = 'fk_user_org_id' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @s := IF(@c = 0,
  'ALTER TABLE app_user ADD CONSTRAINT fk_user_org_id FOREIGN KEY (org_id)
     REFERENCES org_unit(org_id) ON UPDATE CASCADE ON DELETE RESTRICT',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ---------- 12) 표 코멘트 갱신 — SHOW CREATE 가 거짓말하지 않게 ----------
--  구 코멘트는 'name=자연키, parent로 계층' 이라고 적혀 있다. parent 를 지운 지금 그 문장은
--  거짓이다. 이 파일의 목적이 '검증되지 않는 중복 진술'을 없애는 것이므로 여기도 맞춘다.
--  ★ 조건을 '현재 코멘트가 옛 문자열과 정확히 같을 때만' 으로 좁힌 이유: 누군가 코멘트를
--    손으로 바꿔 뒀다면 그 뜻을 우리가 알 수 없다. 모르는 것은 덮지 않는다.
--  ★ 롤백은 같은 방식으로(현재 코멘트가 이 새 문자열과 정확히 같을 때만) 옛 문자열을 되돌린다.
--  ※ 코멘트 변경은 데이터도 AUTO_INCREMENT 도 건드리지 않는다(실측: 변경 전후 AUTO_INCREMENT
--    90 → 90, 전 행 updated_at 지문 동일).
SET @old_org_comment  := '조직 트리. name=자연키, parent로 계층. 조회 범위 계산의 기준.';
SET @new_org_comment  := '조직 트리. PK=org_id(내부 정체성) · name=UNIQUE. 계층 정본은 parent_id 하나 — 이름 미러 없음.';
SET @old_user_comment := '사용자. 인증은 netcus, 여기는 인가만. 비밀번호 컬럼 없음.';
SET @new_user_comment := '사용자. 인증은 netcus, 여기는 인가만. 비밀번호 컬럼 없음. 소속 정본은 org_id 하나 — 이름 미러 없음.';
SET @cur := (SELECT TABLE_COMMENT FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit');
SET @s := IF(@cur = @old_org_comment,
             CONCAT('ALTER TABLE org_unit COMMENT = ', QUOTE(@new_org_comment)), 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @cur := (SELECT TABLE_COMMENT FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user');
SET @s := IF(@cur = @old_user_comment,
             CONCAT('ALTER TABLE app_user COMMENT = ', QUOTE(@new_user_comment)), 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ============================================================================
--  확인 — 반드시 눈으로 볼 것.
--    A판의 (E4)(E5)(미러 정합 불변식)는 **없다**. 미러가 없으니 검사할 것도 없다.
--    남은 것은 '구 컬럼이 정말 사라졌는가' · '번호가 맞는가' · '트리가 트리인가' 셋이다.
-- ============================================================================
SET SESSION group_concat_max_len = 65535;

-- (E1) 구조: org_unit PK=org_id, name 은 UNIQUE, parent_id 인덱스(fk_org_parent_id) 존재.
--      ★ ix_org_parent 는 **없어야 한다**(parent 와 함께 사라졌다).
--      기대 3행: PRIMARY/1/org_id/0 · fk_org_parent_id/1/parent_id/1 · uq_org_unit_name/1/name/0
SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
 ORDER BY INDEX_NAME, SEQ_IN_INDEX;

-- (E1b) FK 목록. 기대 3행:
--       app_user  fk_user_org_id    org_id    → org_unit.org_id
--       app_user  fk_user_title     title     → title_code.name
--       org_unit  fk_org_parent_id  parent_id → org_unit.org_id
--       ★ fk_org_parent · fk_user_org 는 **없어야 한다**(9단계가 뗐다).
SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME,
       k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
       r.UPDATE_RULE, r.DELETE_RULE
  FROM information_schema.KEY_COLUMN_USAGE k
  JOIN information_schema.REFERENTIAL_CONSTRAINTS r
    ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
 WHERE k.TABLE_SCHEMA = DATABASE()
   AND k.TABLE_NAME IN ('org_unit','app_user')
   AND k.REFERENCED_TABLE_NAME IS NOT NULL
 ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME;

-- (E1c) 타입·자리: parent_id · app_user.org_id 가 org_id 와 정확히 같아야 FK 가 선다.
--       기대: 세 줄 모두 smallint unsigned (org_unit.org_id 만 EXTRA=auto_increment)
--       ORDINAL_POSITION 도 함께 본다 — app_user.org_id 는 title 바로 뒤(5)여야 한다
--       (롤백이 컬럼 순서를 원상 복구할 수 있는 근거. 6단계 ★★ 참조).
SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, EXTRA
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME = 'org_unit' AND COLUMN_NAME IN ('org_id','parent_id'))
     OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'org_id'))
 ORDER BY TABLE_NAME, COLUMN_NAME;

-- (E2) ★★ 구 컬럼이 **실제로** 사라졌는가 — 이 판의 핵심 사후조건. 기대: 0행.
--      한 줄이라도 나오면 10단계가 안 돌았다는 뜻이고, 그러면 이 DB 는 아직 A판(미러 유지)이다.
SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME = 'org_unit' AND COLUMN_NAME = 'parent')
     OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'org_unit'));

-- (E2b) 구 인덱스도 사라졌는가. 기대: 0행 (ix_org_parent · ix_user_org).
SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME IN ('ix_org_parent','ix_user_org')
 GROUP BY TABLE_NAME, INDEX_NAME;

-- (E3) ★★ 번호 일치 대조 — taskmgr-company-data/02-seed-org.sql 의 명시값과 같은가.
--      체크섬 방식인 이유는 [가드 1]과 같다(명부를 두 곳에 두지 않는다).
--      ※ 이 상수는 2026-08-24 실 taskmgr 복제본에서 이 파일을 돌려 나온 12쌍(org_id:name)으로
--        계산했고, 02-seed-org.sql 의 명시 배정표(루트 1 · 본부 2~5 · 팀 6~12)와 대조해
--        12/12 일치를 확인했다. 조직이 정당하게 바뀌면 02 와 함께 이 상수도 갱신할 것.
--        재계산: SELECT SHA2(GROUP_CONCAT(CONCAT(org_id,':',name) ORDER BY org_id SEPARATOR ','),256)
--                  FROM org_unit;
--      기대: seed_match = MATCH, n_rows = n_distinct = 12, n_zero = 0, min=1, max=12
SELECT
    IF(SHA2(GROUP_CONCAT(CONCAT(org_id, ':', name) ORDER BY org_id SEPARATOR ','), 256)
       = 'fb43b4d644d8890d8f1b4ec78a46b1180eccf57375a0a0e752148f899338e8f7',
       'MATCH', 'MISMATCH — 조직이 바뀐 DB 이거나 번호가 밀렸다') AS seed_match,
    COUNT(*)               AS n_rows,
    COUNT(DISTINCT org_id) AS n_distinct,
    SUM(org_id = 0)        AS n_zero,
    MIN(org_id)            AS min_id,
    MAX(org_id)            AS max_id
  FROM org_unit;

-- (E3b) 발급 규칙 자체의 검증 — 시드를 모르는 DB 에서도 쓸 수 있는 형태.
--      '번호가 (depth, sort_order, name) 오름차순 1..N 인가'를 본다. 기대: 0
--      ※ 이 검사는 '최초 배정 직후'에만 0 이 보장된다. 나중에 조직이 신설되면 새 조직은
--        기존 번호 뒤에 붙으므로(번호를 밀지 않는 것이 정책이다) 이 값이 0 이 아니게 될 수 있다.
--        그때 이 줄은 '위반'이 아니라 '이 DB 는 최초 배정 이후 조직이 바뀌었다'는 신호다.
--        정합성의 정본은 (E4)이지 이 줄이 아니다 — 그래서 [E9 차단]에 넣지 않는다.
WITH RECURSIVE tree AS (
    SELECT org_id, sort_order, name, 0 AS depth FROM org_unit WHERE parent_id IS NULL
    UNION ALL
    SELECT o.org_id, o.sort_order, o.name, t.depth + 1
      FROM org_unit o JOIN tree t ON o.parent_id = t.org_id
     WHERE t.depth < 512
)
SELECT COUNT(*) AS rank_mismatch
  FROM (SELECT org_id, ROW_NUMBER() OVER (ORDER BY depth, sort_order, name) AS expect_no
          FROM tree) r
 WHERE r.org_id <> r.expect_no;

-- (E4) ★★★ 남는 불변식 — 이 판에서 감시할 것은 이것이 전부다. 기대: 전부 0, n_root=1.
--      · orphan_org   : parent_id 가 실재하지 않는 조직을 가리킨다.
--                       이제 fk_org_parent_id 가 막지만 직접도 센다 — FK 는 반입본·복구본에서
--                       느슨할 수 있고, 게이트는 남의 제약을 믿지 말고 스스로 확인해야 한다.
--      · orphan_user  : org_id 가 실재하지 않는 조직을 가리킨다 (동상).
--      · n_root       : 루트(parent_id IS NULL) 개수. 정확히 1.
--      · unreachable  : 루트에서 parent_id 를 따라 내려가 닿지 못하는 조직 = 순환/섬.
--                       ★ FK 는 순환을 막지 못한다. 근거·깊이 상한 512 의 뜻은 [가드 5] 참조.
--      · inactive_cut : 비활성 부모 밑의 활성 **자식 조직**. 배포본이 조직도를 is_active=1 로
--                       긁으므로 그 가지가 통째로 사라지고 웹이 루트로 승격시킨다([가드 5] 참조).
--      · member_hidden: 비활성 조직에 남아 있는 **재직자**. 위 칸은 조직만 세므로, 자식 조직까지
--                       전부 숨기면 inactive_cut 은 0 이 되는데 사람은 그대로 갇힌다 — 그때
--                       조직도와 상위 unit_tree 열람 범위에서 그 인원이 통째로 빠진다
--                       (실측: 89 → 69명인데 게이트 3종 전부 exit 0 이었다).
--      · name_bad     : 앞뒤 공백·전각 영숫자·NBSP 가 섞인 이름. 이제 이름이 한 곳뿐이라
--                       오염되면 대조본이 없다([가드 4] 참조).
--      · n_no_org     : 소속 미등록 인원. 정상값이지만 수를 봐 두면 다음 마이그레이션 때
--                       '늘었나'를 알 수 있다. 기대 0.
WITH RECURSIVE tree AS (
    SELECT org_id, 0 AS depth FROM org_unit WHERE parent_id IS NULL
    UNION ALL
    SELECT o.org_id, t.depth + 1
      FROM org_unit o JOIN tree t ON o.parent_id = t.org_id
     WHERE t.depth < 512
)
SELECT
  (SELECT COUNT(*) FROM org_unit c WHERE c.parent_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM (SELECT org_id FROM org_unit) p WHERE p.org_id = c.parent_id))
                                                                       AS orphan_org,
  (SELECT COUNT(*) FROM app_user u WHERE u.org_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM org_unit o WHERE o.org_id = u.org_id))
                                                                       AS orphan_user,
  (SELECT COUNT(*) FROM org_unit WHERE parent_id IS NULL)              AS n_root,
  (SELECT COUNT(*) FROM org_unit) - (SELECT COUNT(*) FROM tree)        AS unreachable,
  (SELECT COUNT(*) FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id
    WHERE c.is_active = 1 AND p.is_active = 0)                         AS inactive_cut,
  (SELECT COUNT(*) FROM app_user u JOIN org_unit o ON o.org_id = u.org_id
    WHERE u.is_active = 1 AND o.is_active = 0)                         AS member_hidden,
  (SELECT COUNT(*) FROM org_unit
    WHERE CAST(name AS BINARY) <> CAST(TRIM(name) AS BINARY) OR name REGEXP @fw_ban)
                                                                       AS name_bad,
  (SELECT COUNT(*) FROM org_unit)                                      AS n_org,
  (SELECT COUNT(*) FROM app_user)                                      AS n_users,
  (SELECT COUNT(*) FROM app_user WHERE org_id IS NULL)                 AS n_no_org;

-- (E5) 도달 못하는 조직이 있으면 **누가 끊겼는지** 표로 찍는다. 기대: 0행.
--      (E4)의 unreachable 이 0 이 아닐 때 사람이 볼 화면이다 — 숫자만으로는 조치할 수 없다.
WITH RECURSIVE tree AS (
    SELECT org_id, 0 AS depth FROM org_unit WHERE parent_id IS NULL
    UNION ALL
    SELECT o.org_id, t.depth + 1
      FROM org_unit o JOIN tree t ON o.parent_id = t.org_id
     WHERE t.depth < 512
)
SELECT o.org_id, o.name, o.parent_id, o.is_active,
       (SELECT COUNT(*) FROM app_user u WHERE u.org_id = o.org_id) AS n_members_cut_off
  FROM org_unit o
 WHERE o.org_id NOT IN (SELECT org_id FROM tree)
 ORDER BY o.org_id;

-- (E6) 눈으로 보는 최종 상태. 기대: 12행. org_id 1 만 parent_id NULL.
SELECT o.org_id, o.name, o.parent_id, p.name AS parent_name, o.sort_order, o.is_active,
       (SELECT COUNT(*) FROM app_user u WHERE u.org_id = o.org_id) AS n_members
  FROM org_unit o LEFT JOIN org_unit p ON p.org_id = o.parent_id
 ORDER BY o.org_id;

-- (E7) ★ 개명이 정말 1문장인가 — 조직 이름을 들고 있는 곳이 org_unit.name 하나뿐임을 확인한다.
--      기대: 0행. 한 줄이라도 나오면 그 컬럼도 개명 시 함께 고쳐야 한다는 뜻이고,
--            그러면 '1문장 개명'이라는 이 전환의 약속이 깨진다.
--      ※ 조직 이름을 담을 법한 이름의 문자열 컬럼을 스키마 전체에서 찾는다(org_unit.name 제외).
SELECT c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_TYPE
  FROM information_schema.COLUMNS c
 WHERE c.TABLE_SCHEMA = DATABASE()
   AND c.DATA_TYPE IN ('char','varchar','text')
   AND NOT (c.TABLE_NAME = 'org_unit' AND c.COLUMN_NAME = 'name')
   AND c.COLUMN_NAME IN ('org_unit','parent','org_name','unit_name','dept','department')
 ORDER BY c.TABLE_NAME, c.COLUMN_NAME;

-- ============================================================================
--  [E9 차단] ★★★ 사후 검증 — 위 (E1)~(E7)이 어긋나면 **실행을 실패시킨다**
--
--  ★ 왜 필요한가 — 출력만으로는 아무것도 막지 못한다(실측된 결함 F11)
--    (E3)가 'MISMATCH' 를 찍어도 mysql 은 **종료코드 0** 으로 끝난다. 그래서
--      mysql ... < migrate-2026-08-24-org-id.sql && echo OK
--    형태의 자동화(apply.ps1 게이트·CI·배포 스크립트)가 **오염된 DB 에서도 OK 를 찍었다**.
--    가드들은 PREPARE 트릭으로 ERROR 1146 을 내 exit 1 을 만드는데, E 구간에는 그 장치가
--    없었다. 여기서 같은 장치를 붙인다.
--    ※ 위 (E1)~(E7)의 사람이 읽는 출력은 **그대로 둔다**. 둘 다 필요하다 —
--      출력은 '무엇이 틀렸나'를, 아래 차단은 '진행하지 마라'를 말한다.
--    ※ 이 블록은 파일의 맨 끝 직전이라, 에러로 죽어도 (E1)~(E7)의 출력은 이미 다 나온 뒤다.
--
--  ★★ 여기서 걸리면 무엇을 하나
--    1) 아래 요약 한 줄에서 어느 칸이 0 이 아닌지 본다. unreachable 이면 (E5) 표에
--       끊긴 조직과 그 소속 인원이 그대로 찍혀 있다.
--    2) 조직 변경을 잘못한 것이면 파일 끝 [조직 변경 레시피]로 고친다.
--    3) 마이그레이션 자체가 반쯤 돈 것이면 rollback-2026-08-24-org-id.sql 로 되돌린 뒤
--       원인을 고치고 다시 돌린다. 그것도 안 되면 [적용] 1) 의 덤프로 복원한다.
-- ============================================================================
SET @e_orphan_org := (SELECT COUNT(*) FROM org_unit c WHERE c.parent_id IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM (SELECT org_id FROM org_unit) p
                                        WHERE p.org_id = c.parent_id));
SET @e_orphan_user := (SELECT COUNT(*) FROM app_user u WHERE u.org_id IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM org_unit o WHERE o.org_id = u.org_id));
SET @e_root_bad := (SELECT (COUNT(*) <> 1) FROM org_unit WHERE parent_id IS NULL);
WITH RECURSIVE tree AS (
    SELECT org_id, 0 AS depth FROM org_unit WHERE parent_id IS NULL
    UNION ALL
    SELECT o.org_id, t.depth + 1
      FROM org_unit o JOIN tree t ON o.parent_id = t.org_id
     WHERE t.depth < 512
) SELECT COUNT(*) INTO @e_reach FROM tree;
SET @e_unreachable := (SELECT COUNT(*) FROM org_unit) - @e_reach;
SET @e_inactive_cut := (SELECT COUNT(*) FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id
                         WHERE c.is_active = 1 AND p.is_active = 0);
--  ★ 조직이 아니라 **사람** 을 센다. 자식 조직까지 전부 숨기면 위 @e_inactive_cut 은 0 이 되는데
--    그 안의 재직자는 그대로 살아 있고 조직도에서만 사라진다 — 그것이 이 줄이 보는 상태다.
SET @e_member_hidden := (SELECT COUNT(*) FROM app_user u JOIN org_unit o ON o.org_id = u.org_id
                          WHERE u.is_active = 1 AND o.is_active = 0);
SET @e_name_bad := (SELECT COUNT(*) FROM org_unit
                     WHERE CAST(name AS BINARY) <> CAST(TRIM(name) AS BINARY) OR name REGEXP @fw_ban);
--  ★ 구 컬럼 잔존 — 이 판의 핵심 사후조건. 하나라도 남아 있으면 절단이 안 끝난 것이다.
SET @e_old_cols := (SELECT COUNT(*) FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND ((TABLE_NAME = 'org_unit' AND COLUMN_NAME = 'parent')
                         OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'org_unit')));
--  구조: PK=(org_id) · 새 FK 2개 존재 · 구 FK 2개 부재 · uq_org_unit_name 존재 · 구 인덱스 부재.
--        전부 이 파일이 스스로 만든 결과라, 하나라도 어긋나면 이 파일이 반쯤 돈 것이다.
SET @e_pk_cols := (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
                     FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
                      AND INDEX_NAME = 'PRIMARY');
SET @e_struct_bad := IF(IFNULL(@e_pk_cols, '') <> 'org_id', 1, 0)
   + (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'
         AND CONSTRAINT_NAME IN ('fk_org_parent','fk_user_org'))
   + (SELECT 2 - COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'
         AND CONSTRAINT_NAME IN ('fk_org_parent_id','fk_user_org_id'))
   + (SELECT 1 - COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_unit'
         AND INDEX_NAME = 'uq_org_unit_name')
   + (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME IN ('ix_org_parent','ix_user_org'));
--  seed_bad 는 '이번 실행이 번호를 새로 박았는데 그 번호가 시드와 다르다' 일 때만 1 이다
--  (이미 번호가 있던 DB 에서는 항상 0 — 조직이 정당하게 늘면 (E3) 해시는 당연히 달라지므로
--   그걸로 막으면 오탐이 된다. [가드 1]이 @numbered 로 우회하는 것과 정확히 같은 논리다).
SET @e_seed_bad := IF(@numbered = 1, 0,
   (SELECT IF(SHA2(GROUP_CONCAT(CONCAT(org_id, ':', name) ORDER BY org_id SEPARATOR ','), 256)
              = 'fb43b4d644d8890d8f1b4ec78a46b1180eccf57375a0a0e752148f899338e8f7', 0, 1)
      FROM org_unit));

SELECT @e_orphan_org AS orphan_org, @e_orphan_user AS orphan_user,
       @e_root_bad   AS root_not_1,  @e_unreachable AS unreachable,
       @e_inactive_cut AS inactive_cut, @e_member_hidden AS member_hidden,
       @e_name_bad AS name_bad,
       @e_old_cols   AS old_cols_left, @e_struct_bad AS struct_bad,
       @e_seed_bad   AS seed_bad;

SET @bad := @e_orphan_org + @e_orphan_user + @e_root_bad + IFNULL(@e_unreachable, 1)
          + @e_inactive_cut + @e_member_hidden + @e_name_bad + @e_old_cols + @e_struct_bad
          + IFNULL(@e_seed_bad, 1);
--  ★ 메시지를 CASE 로 갈라 어느 칸이 터졌는지 에러 문구에 싣는다. 식별자 64자 제한 안에서
--    최대한 좁게 — 자동화 로그에는 이 한 줄만 남는 경우가 많다.
--  ※ Windows(lower_case_table_names=1)에서는 ASCII 가 소문자로 바뀌어 출력된다.
SET @g := CASE
  WHEN @bad = 0 THEN 'DO 0'
  WHEN @e_old_cols > 0
    THEN 'SELECT 1 FROM `중단: 절단 미완 - 구 컬럼(parent/org_unit)이 남아 있다. E2 를 볼 것`'
  WHEN @e_struct_bad > 0
    THEN 'SELECT 1 FROM `중단: 사후검증 실패 - 구조가 확정 설계와 다르다. E1/E1b 를 볼 것`'
  WHEN @e_orphan_org + @e_orphan_user > 0
    THEN 'SELECT 1 FROM `중단: 사후검증 실패 - 실재하지 않는 조직을 가리키는 행이 있다 (고아)`'
  WHEN @e_root_bad > 0
    THEN 'SELECT 1 FROM `중단: 사후검증 실패 - 루트가 1개가 아니다. E4 를 볼 것`'
  WHEN IFNULL(@e_unreachable, 1) > 0
    THEN 'SELECT 1 FROM `중단: 사후검증 실패 - 루트에서 도달 못하는 조직(순환). E5 를 볼 것`'
  WHEN @e_inactive_cut > 0
    THEN 'SELECT 1 FROM `중단: 사후검증 실패 - 비활성 부모 밑에 활성 자식이 있다. E4 를 볼 것`'
  WHEN @e_member_hidden > 0
    THEN 'SELECT 1 FROM `중단: 사후검증 실패 - 비활성 조직에 재직자가 남아 있다. E4 를 볼 것`'
  WHEN @e_name_bad > 0
    THEN 'SELECT 1 FROM `중단: 사후검증 실패 - 조직 이름에 공백/전각/NBSP 가 있다. E4 를 볼 것`'
  ELSE 'SELECT 1 FROM `중단: 사후검증 실패 - 번호가 시드와 다르다. E3 를 볼 것`' END;
PREPARE _e FROM @g; EXECUTE _e; DEALLOCATE PREPARE _e;

-- ============================================================================
--  [조직 변경 레시피] — 절단 뒤 조직을 건드리는 **유일한** 정식 절차.
--
--  ★ A판과 무엇이 다른가: **미러가 없다.** 그래서 전부 '정본 한 곳만' 쓴다.
--    A판의 공통 규칙이었던 '정본과 미러를 같은 트랜잭션 안에서 쓴다'가 통째로 사라졌고,
--    그와 함께 '한쪽만 써서 에러 없이 조용히 틀리는' 사고 유형 전체가 사라졌다.
--    남은 규칙은 둘뿐이다:
--      (a) 조직은 **번호(org_id)로 지목**한다. 이름으로 WHERE 하면 개명 중간 상태에서 빗나간다.
--      (b) 끝나면 [변경 뒤 검산]을 돌린다. 안 돌렸으면 안 한 것이다.
--
--  ※ 이것들을 **실행 가능한 도구**로 만들어 둔 것이 db/deploy/org-ops.cmd(= org-ops.ps1)이고,
--    PowerShell 을 못 쓰는 환경용 최소본이 db/deploy/org-ops.sql 이다.
--    그쪽은 COMMIT **앞**에서 검산까지 하므로 어긋나면 아예 커밋되지 않는다. 손으로 칠 이유가
--    없으면 그 파일을 쓸 것 — 아래 SQL 은 '무엇이 왜 필요한가'의 정본 기록이자 수동 절차다.
--    ※ 2026-08-25 확인: 세 파일 모두 **절단 스키마 기준**으로 갱신돼 있다(org-ops.sql 머리말이
--      '조직 절단 마이그레이션을 끝낸 DB' 를 대상으로 명시하고, 이름 미러 컬럼이 하나라도
--      남아 있으면 `중단: 이름 미러 컬럼이 남아 있다` 로 차단한다). 즉 이 파일과 짝이 맞는다.
--
--  ------------------------------------------------------------------------
--  ① 개명 (rename) — ★ 한 문장이다.
--
--      UPDATE org_unit SET name = '<새 이름>' WHERE org_id = <조직번호>;
--
--    · 트랜잭션도 필요 없다(단일 문장은 그 자체로 원자적이다).
--    · **자식도, 소속자도 따라올 것이 없다.** 자식은 parent_id(번호)로, 소속자는
--      app_user.org_id(번호)로 이 조직을 가리키므로 이름이 바뀌어도 아무 영향이 없다.
--      FK CASCADE 가 무엇을 끌고 오는 것도 아니다 — 끌고 올 것이 애초에 없다.
--      (실측 2026-08-24, MySQL 8.4.9, 실 taskmgr 절단 복제본:
--         · org_id=2 (자식 5개 · 직속 소속 2명 · 산하 포함 58명) 개명 → 문장 하나로 성공.
--           개명 뒤에도 자식 5 · 직속 2 · 산하 58 이 그대로 같은 org_id 를 가리켰다.
--         · 루트(org_id=1) 개명 → 역시 문장 하나로 성공.
--         · 같은 복제본의 **옛 스키마**에서 같은 개명은
--             ERROR 1451 Cannot delete or update a parent row … CONSTRAINT `fk_org_parent`
--           로 실패했다. 그 차이가 이 전환의 목적 전부다.
--         · 개명 뒤 이 파일을 다시 돌린 (E4) 재검산도 전부 0 · exit 0.)
--    · 이름 규칙: 앞뒤 공백·전각 영숫자·NBSP 를 넣지 말 것([가드 4]가 막는다).
--      새 이름이 기존 조직명과 겹치면 uq_org_unit_name 이 ERROR 1062 로 막는다 — 정상이다.
--
--  ------------------------------------------------------------------------
--  ② 신설 (new) — 정본 한 컬럼(parent_id)만 준다.
--
--      INSERT INTO org_unit (name, parent_id, sort_order, is_active)
--        VALUES ('<새 이름>', <상위 조직번호>, <표시순서>, 1);
--
--    · org_id 는 적지 않는다 — 3단계에서 붙인 AUTO_INCREMENT 가 max+1 을 준다.
--      **번호를 손으로 지정하지 말 것**(기존 번호를 밀면 89명의 소속이 통째로 어긋난다).
--    · 최상위를 하나 더 만들지 말 것 — 루트는 정확히 1개가 불변식이다((E4) n_root).
--    · 없는 상위 번호를 주면 fk_org_parent_id 가 ERROR 1452 로 막는다 — 정상이다.
--    · 신설 뒤에는 (E3b) rank_mismatch 가 0 이 아니게 될 수 있다 — 위반이 아니라
--      '최초 배정 이후 조직이 바뀌었다'는 신호다. (E3) 해시도 당연히 달라진다.
--
--  ------------------------------------------------------------------------
--  ③ 이관 (move) — 조직을 다른 상위 밑으로 옮긴다. ★ 한 문장이다.
--
--      UPDATE org_unit SET parent_id = <새 상위번호> WHERE org_id = <옮길 조직번호>;
--
--    · ★ 자기 자신이나 자기 자손 밑으로 옮기지 말 것 — 트리가 고리가 되고, 그 가지 전체가
--      루트에서 도달 불가능해진다((E4) unreachable). FK 는 이것을 막지 못한다.
--      옮기기 전에 확인(반드시 0 이어야 한다):
--        WITH RECURSIVE d AS (SELECT org_id FROM org_unit WHERE org_id = <옮길 조직번호>
--                             UNION ALL
--                             SELECT o.org_id FROM org_unit o JOIN d ON o.parent_id = d.org_id)
--        SELECT COUNT(*) AS must_be_zero FROM d WHERE org_id = <새 상위번호>;
--    · 소속 인원은 따라 움직이지 않는다 — 사람은 팀에 붙어 있고 팀이 통째로 옮겨 가는 것이다.
--      사람만 옮기려면 ④ 다.
--
--  ------------------------------------------------------------------------
--  ④ 인사이동 (assign) — 사람의 소속을 바꾼다. ★ 한 문장이다.
--
--      UPDATE app_user SET org_id = <새 조직번호> WHERE login_id = '<로그인ID>';
--
--    · 소속 해제(미등록)는  SET org_id = NULL.
--    · 없는 조직 번호를 주면 fk_user_org_id 가 ERROR 1452 로 막는다 — 정상이다.
--    · A판에서는 이 자리에 org_unit(이름)까지 함께 쓰는 2컬럼 UPDATE 가 필요했고, 한쪽만
--      쓰면 에러 없이 어긋났다. 이제 쓸 컬럼이 하나뿐이라 그 사고가 불가능하다.
--
--  ------------------------------------------------------------------------
--  ⑤ 폐지(소프트 삭제) — 레시피가 아니라 **금지 사항**이 하나 붙는다
--    조직을 없앨 때는 is_active=0 으로 내리는 것이 정책이다. 그런데 배포본은 조직도를
--    `WHERE is_active = 1` 로 긁는다(ProjectDb.cs:364). 그래서 **하위 조직이 달린 노드를
--    내리면 그 밑의 활성 조직 전체가 사라진 부모를 가리키게 되고**, 웹이 그들을 루트로
--    승격시킨다. (실측 2026-08-24: 비-리프 하나를 is_active=0 으로 내리자 CTO 열람 인원
--    89 → 69명, 배포본이 보는 루트 1개 → 6개. 에러는 한 줄도 나지 않았다.)
--    → 폐지는 **리프부터**. 또는 산하를 ③ 으로 먼저 옮긴 뒤에 내린다.
--      (E4)의 inactive_cut 이 이 상태를 세고, [E9 차단]이 그걸로 실행을 막는다.
--    ※ 하드 삭제(DELETE)는 fk_org_parent_id · fk_user_org_id 의 RESTRICT 가 막는다 — 정상이다.
--
--  ------------------------------------------------------------------------
--  [변경 뒤 검산] — 다섯 중 무엇을 했든 끝나면 이걸 돌린다. 안 돌렸으면 안 한 것이다.
--
--    1) 위 (E4) 를 그대로 다시 돌린다(이 파일에서 그 SELECT 만 복사해 쓰면 된다).
--       기대: orphan_org · orphan_user · unreachable · inactive_cut · member_hidden ·
--             name_bad 가 전부 0,
--             n_root = 1.
--       ★ 하나라도 어긋나면 되돌린다:
--         · 방금 한 조직 변경 하나를 물리려면 → 같은 레시피의 역연산(① 로 옛 이름으로 되개명,
--           ③ 으로 옛 상위로 복귀). 이제 역연산도 한 문장이다.
--         · 마이그레이션 자체를 물리려면 → db/deploy/rollback-2026-08-24-org-id.sql
--         · 무엇이 어디서부터 틀렸는지 모르겠으면 → [적용] 1) 의 mysqldump 스냅샷으로 복원.
--           절차는 db/deploy/README.md 의 '### 복구' 절. 덤프 도구는 db/deploy/backup-taskmgr.ps1.
--
--    2) 이어서 루프 테스트를 돌린다:
--         node tests/loop-org-compat.mjs --selfcheck --db-name=taskmgr
--       읽기 전용이다(원본을 SELECT 만 한다). **exit 1 이면 되돌릴 것.**
--       ※ 2026-08-25 확인: 이 도구도 **완전 절단** 기준으로 갱신돼 있다 — 옛 명제("배포본 SQL
--         6문의 결과가 언제나 id 경로와 일치한다")를 폐기하고, 대신 **배포본 낙진**
--         (S1 생존 · S2~S6 은 errno 1054)까지 확인해 절단을 '동작'으로도 증명한다.
--         즉 절단 스키마에서 5문이 1054 로 실패하는 것은 이 도구에게 **기대값**이지 결함이 아니다.
--
--    ★ 검산으로 **이 마이그레이션 파일을 다시 돌리지 말 것.** 이 파일의 5·7단계는 백필이고,
--      이미 전환된 DB 에서는 no-op 이라 아무것도 검사하지 않는다. 검산은 (E4)다.
--
--  ------------------------------------------------------------------------
--  · A판에 있던 'B단계' 개념은 **없다.** 이 파일이 그 자리까지 한 번에 간다.
--  · 이 파일 이후 스키마의 진실은 하나뿐이다:
--      계층 = org_unit.parent_id · 소속 = app_user.org_id · 이름 = org_unit.name
--    같은 사실을 두 번 적어 둔 곳이 없으므로, 두 곳이 갈릴 일도 없다.
-- ============================================================================
