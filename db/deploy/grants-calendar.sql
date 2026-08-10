-- ============================================================================
--  캘린더 테이블 앱 계정 권한 (taskmgr_app) — GRANT 단일 소스
--  MySQL 8.0.16+ / taskmgr DB. 지금(개인 PC)·나중(서버) 동일하게 실행.
-- ----------------------------------------------------------------------------
--  선행 조건 세 가지 — 순서를 어기면 이 파일은 첫 줄에서 멈추거나, 더 나쁘게 '조용히' 근거를 잃는다:
--    1) 계정이 있을 것    (db/deploy/create-app-user.sql 이 CREATE USER 를 한다)
--    2) cal_* 테이블이 있을 것 (db/deploy/schema-calendar.sql 이 13개를 만든다)
--    3) ★ db/deploy/triggers-calendar.sql 이 이미 적용돼 있을 것 — 아래 DELETE 부여의 근거다.
--       배포 순서: schema-calendar.sql → triggers-calendar.sql → 이 파일.
--       3)만은 이 파일이 스스로 확인하지 못한다(GRANT 문은 트리거 존재를 모른다).
--       트리거 없이 이 파일만 돌리면 에러 없이 성공하고, 그 순간 '흔적 없이 지울 수 있는'
--       계정이 전 사용자 PC 에 퍼진다. 아래 확인 6)을 반드시 눈으로 볼 것.
--  ※ 이 파일은 계정을 만들지 않는다. 비밀번호를 여기 다시 박지 않기 위해서다
--    (비번이 두 파일에 흩어지면 둘이 어긋난 채로 배포되는 사고가 난다).
--
--  ★ 가드(계정/테이블 존재 확인)를 일부러 넣지 않았다 — MySQL 이 이미 시끄럽게 실패한다.
--    실측(MySQL 8.4.9): 없는 테이블에 GRANT → ERROR 1146,
--                      없는 계정에 GRANT → ERROR 1410,
--    두 경우 모두 배치 실행이 그 줄에서 중단되고 뒤 문장은 실행되지 않는다.
--    taskmgr-company-data/05-grants.sql 은 '계정 없으면 조용히 건너뜀' 패턴이지만
--    여기서는 따르지 않는다. 캘린더는 권한이 하나만 빠져도 앱이 런타임 ERROR 1142 로
--    죽고, 그건 사용자가 자기 일정을 저장하지 못한 뒤에야 드러난다.
--    배포 중에 시끄럽게 실패하는 쪽이 훨씬 싸다.
-- ----------------------------------------------------------------------------
--  ★★ 이 파일은 create-app-user.sql 의 관례를 의도적으로 깬다 — DELETE 를 준다.
--
--    create-app-user.sql:7-8 은 "앱이 실제로 쓰는 SQL 동사 = SELECT/INSERT/UPDATE,
--    소프트삭제는 UPDATE is_active=0 이라 DELETE 불필요" 라고 적었다.
--    그 근거는 과제 테이블(project/customer/…)에만 성립한다. 거기엔 is_active 가 있다.
--    캘린더 테이블에는 소프트삭제가 없다 — 일정·할일·과제·회의실·공수·예외일·커밋은
--    전부 '행을 지우는' 것이 정상 동작이고, 값 0/빈 문자열은 0 저장이 아니라 행 삭제다.
--    → 그 관례를 글자대로 캘린더에 옮기면 앱의 모든 삭제 UI 가 ERROR 1142 로 실패한다.
--    그래서 아래에는 테이블마다 '왜 그 동사를 주는지 / 왜 DELETE 를 안 주는지'를
--    실제 코드 위치와 함께 한 줄씩 남긴다. 근거 없이 동사를 늘리지 말 것.
--
--    노출 전제는 그대로다(계정 비밀번호는 배포본에 담겨 전 사용자 PC에 퍼진다).
--    DELETE 를 주는 대신 설계 §7.5 감사 트리거(DEFINER 권한으로 실행)가 삭제/수정 전
--    이미지를 cal_audit_trash 에 적재하고, 앱 계정에는 그 테이블 권한을 한 줄도 주지
--    않는다 → 우회 접속자는 지울 수는 있어도 '지운 흔적'은 지우지 못한다.
--    ★ 그 트리거의 실체는 db/deploy/triggers-calendar.sql 이다(trg_cal_*_bd / _bu 15개).
--      ★ 아래 표별 주석이 DELETE·UPDATE 의 근거로 든 '자식 단독 삭제/수정' 경로
--        (cal_entry_except:79 · cal_entry_commit:85 · cal_todo_day_note:95 · cal_room:102)는
--        부모 트리거로는 잡히지 않는다 — FK CASCADE 가 아니라 부모가 살아 있는 채로 자식만
--        지우는 경로라서다. 그래서 그 4개 표에도 트리거를 둔다. 부모에만 있던 동안은
--        '가장 자주 일어나는 삭제'가 흔적을 안 남겨 이 파일의 상쇄 논리가 반쪽이었다.
--      그 파일을 적용하지 않으면 아래 DELETE 부여는 상쇄 근거가 없는 상태다 —
--      '노출된 자격증명 + 전 캘린더 테이블 DELETE + 흔적 0'. 확인 6)이 이걸 잡는다.
--      또 schema-calendar.sql 을 다시 돌리면 DROP TABLE 이 트리거까지 조용히 지운다.
--      구조를 재구축했다면 triggers-calendar.sql 도 반드시 다시 돌릴 것.
-- ----------------------------------------------------------------------------
--  호스트 제한 (설계 §7.3 — 아직 '%' 다. 배포 시 사내 대역으로 좁힐 것):
--    이 파일의 계정 표기는 전부 'taskmgr_app'@'%' 한 형태로만 쓴다. 배포 스크립트가
--    한 줄로 치환할 수 있게 하기 위해서다:
--      $sql = (Get-Content grants-calendar.sql -Raw) -replace "@'%'", "@'$AppHost'"
--      $sql | Set-Content grants-calendar.applied.sql -Encoding utf8
--    주의 1) 호스트가 다르면 MySQL 에서는 아예 다른 계정이다
--            ('taskmgr_app'@'%' ≠ 'taskmgr_app'@'192.168.0.%').
--            create-app-user.sql 의 CREATE USER 호스트도 같이 바꿔야 한다.
--    주의 2) 서버 PC 자신에서 돌릴 이관/배치 도구용으로 @'localhost' 계정을 따로 둘지는
--            아직 정해지지 않았다(미결 — 사내 대역과 함께 사람이 결정).
-- ============================================================================
SET NAMES utf8mb4;

-- ---------- 과제(카테고리) ----------
-- DELETE 필요: 개인 과제 삭제(deleteCategory, task-calendar-prototype.html:4511-4526)와
--   공식 과제 구독 해제(unsubscribeDbCat, :4280-4287) 두 경로가 실재한다.
--   설계 §7.3 표는 이 테이블을 DELETE 금지 대상에 넣었지만, 글자대로 부여하면 두 UI 가
--   ERROR 1142 로 실패한다 → 문서보다 코드를 따르고, 대신 §7.5 감사 트리거 대상에 포함해
--   사후 탐지로 대체한다.
GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.cal_category TO 'taskmgr_app'@'%';

-- ---------- 일정 ----------
-- DELETE 필요: deleteEntry(:4483) 호출부 6곳 + 가져오기 '교체'/초기화의 전량 삭제 +
--   git 재수집이 [from,to] 범위의 자동생성 일정을 통째로 지우고 다시 넣는 경로(:10892).
-- UPDATE 는 일정 편집뿐 아니라 과제 삭제 시 소속 일정의 categoryId 를 NULL 로 미는 데도 쓴다(:4512).
GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.cal_entry TO 'taskmgr_app'@'%';

-- ---------- 반복 일정의 예외일 ----------
-- UPDATE 를 주지 않는다: PK(login_id, entry_id, except_date) 가 곧 행의 전부라 '수정'이라는
--   개념이 없다. 날짜를 바꾸는 것은 삭제 후 삽입이다. 없는 동사를 주면 나중에 누군가
--   UPDATE 경로를 만들어 낙관적 잠금을 우회할 여지만 생긴다.
-- DELETE 필요: 예외 추가(:10152/:10493)의 반대 동작 + 반복 주기가 바뀌면 기존 예외가
--   의미를 잃어 전량 비운다(:5671-5675).
GRANT SELECT, INSERT, DELETE ON taskmgr.cal_entry_except TO 'taskmgr_app'@'%';

-- ---------- 커밋 목록 ----------
-- 네 동사 전부: 개별 삭제 UI 가 실재하고(deleteCommitRow :8934, 호출부 :9725/:10486),
--   제목·본문 인라인 편집이 있으며(setCommitSubject :8898 / setCommitMessage :8907),
--   범위 재수집은 삭제 후 재삽입이다.
GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.cal_entry_commit TO 'taskmgr_app'@'%';

-- ---------- 할 일 ----------
-- DELETE 필요: deleteTodo(:8809) 호출부 3곳. (완료 토글·본문 수정은 UPDATE)
GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.cal_todo TO 'taskmgr_app'@'%';

-- ---------- 기간 할일의 날짜별 설명 ----------
-- DELETE 필요: normalizeTodoDayNotes(:8757-8766)가 updateTodo 마다 빈 값과 기한 범위를
--   벗어난 날짜를 탈락시킨다 — 부모 할일은 살아 있는데 자식 행만 사라지는 경우가 정상 경로다.
--   (부모를 지울 때의 자식 정리는 FK ON DELETE CASCADE 가 하므로 이 권한과 무관하다)
GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.cal_todo_day_note TO 'taskmgr_app'@'%';

-- ---------- 장소(회의실) 목록 ----------
-- DELETE 필요: deleteRoom(:5872-5877) / addRoom(:5862-5871).
-- UPDATE 필요: 이름이 PK 라 이름 수정 자체는 없지만, 중간 항목이 지워지면 뒤 행들의
--   sort_order 를 다시 써야 한다. 회의실에는 createdAt 조차 없어 sort_order 가 표시 순서의
--   유일한 근거다 — 이 UPDATE 가 막히면 순서가 조용히 뒤섞인다.
GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.cal_room TO 'taskmgr_app'@'%';

-- ---------- (날짜 × 과제) 투입 시간 ----------
-- DELETE 필요: 공수에 0/빈칸을 넣는 것은 0 저장이 아니라 행 삭제다
--   (setTaskHours :3384 `if(v > 0) day[catId] = v; else delete day[catId];`).
--   CHECK (hours > 0 AND hours <= 24) 가 0 을 3819 로 거부하므로 '0 으로 UPDATE' 는 대안이 아니다.
--   과제 삭제 시 그 과제의 공수 행을 전 날짜에서 동반 정리하는 경로도 DELETE 다(:4517-4521).
--   ※ 설계 §5.2 의 'FK 없음 = 과제를 지워도 공수 이력은 남는다'는 근거는 코드와 반대다.
--     FK 를 안 거는 결정은 유지하되 근거는 '앱이 동반 삭제하므로 FK 액션이 필요 없고,
--     다른 경로로 생긴 미아 행은 무해하다' 쪽이 맞다.
GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.cal_task_hours TO 'taskmgr_app'@'%';

-- ---------- 커밋 수집용 전역 작성자 ----------
-- DELETE 를 주지 않는다: setGitAuthor(:10726)/setSvnAuthor(:10728)는 값을 비워도
--   빈 문자열을 저장할 뿐 키를 지우지 않는다. 앱 전체에 삭제 경로가 0건이라
--   설계 §7.3 의 DELETE 금지와 코드가 일치한다(캘린더에서 문서와 코드가 맞는 몇 안 되는 곳).
GRANT SELECT, INSERT, UPDATE ON taskmgr.cal_user_pref TO 'taskmgr_app'@'%';

-- ---------- 동시성 감시점(rev) ----------
-- INSERT 와 UPDATE 를 둘 다 줘야 한다: §3.1 의 쓰기 트랜잭션 첫 문장이 ODKU 한 문장이라
--   두 권한이 모두 필요하다 —
--   INSERT INTO cal_user_rev(login_id, rev) VALUES(?, 1) ON DUPLICATE KEY UPDATE rev = rev + 1;
-- DELETE 는 금지: rev 는 단조증가여야 삭제까지 감지할 수 있고, 행이 사라지면 그 사용자의
--   직렬화가 통째로 풀린다. §8 의 '교체' 이관도 이 테이블만은 전량 삭제 대상에서 제외한다.
GRANT SELECT, INSERT, UPDATE ON taskmgr.cal_user_rev TO 'taskmgr_app'@'%';

-- ---------- 이관 1회성 마커 ----------
-- SELECT + INSERT 만: 존재 확인 후 데이터 INSERT 와 같은 트랜잭션에서 한 행을 남기는 것이
--   전부다. UPDATE/REPLACE/선삭제를 주면 재실행 방지가 무력화된다 — 그게 이 테이블의 존재 이유다.
-- ※ 가능하면 앱 계정이 아니라 1회성 이관 도구 전용 계정에만 부여하는 편이 낫다.
--   지금은 이관 도구 계정이 정해지지 않아 앱 계정에 둔다(전용 계정이 생기면 여기서 회수할 것).
GRANT SELECT, INSERT ON taskmgr.cal_migration_log TO 'taskmgr_app'@'%';

-- ---------- 스키마 버전 행 (§5.5) ----------
-- SELECT 만 준다. 앱은 접속 프리앰블에서 한 줄을 읽어 자기 빌드 상수와 비교하고, 다르면
--   파괴적 연산(가져오기 '교체'·이관·전량 삭제)만 막는다(schema-calendar.sql:451-455).
-- ★ INSERT/UPDATE/DELETE 를 주면 안 되는 이유: 낡은 클라이언트를 막으려고 두는 행인데
--   그 클라이언트 자신이 값을 올릴 수 있으면 차단이 성립하지 않는다. 값을 올리는 것은
--   구조를 바꾸는 migrate-*.sql 의 몫이고, 그건 관리 계정으로 돈다.
--   (버전을 올려야 할 사람이 앱이라면 애초에 이 게이트가 필요 없다는 뜻이다)
GRANT SELECT ON taskmgr.cal_schema_meta TO 'taskmgr_app'@'%';

-- ---------- 감사 휴지통 (cal_audit_trash) ----------
-- 의도적으로 GRANT 문이 없다. 한 줄도 주지 않는 것이 §7.5 감사가 성립하는 유일한 조건이다.
--   앱 계정으로 SELECT/DELETE/TRUNCATE/DROP TRIGGER 가 전부 ERROR 1142 로 거부돼야
--   우회 접속한 사용자가 자기 흔적을 읽거나 지울 수 없다.
--   트리거는 DEFINER(관리 계정) 권한으로 쓰므로 앱 계정에 권한이 없어도 적재된다.
--   → 아래 검증 쿼리에 이 테이블 권한이 0건인지 확인하는 항목을 반드시 포함할 것.
-- ※ TRIGGER 권한도 이 파일 어디에도 없다(의도). 그 결과 앱 계정은 DROP TRIGGER 가 1142 로
--   막힐 뿐 아니라 information_schema.TRIGGERS 에서 트리거를 아예 보지 못한다 —
--   MySQL 이 그 뷰를 'TRIGGER 권한이 있는 테이블'로만 걸러 주기 때문이다(실측).
--   즉 우회 접속자는 감시받고 있다는 사실 자체를 알 수 없다. TRIGGER 를 주지 말 것.

-- ---------- 기존 테이블 — 캘린더가 추가로 요구하는 읽기 권한 ----------
-- 아래 세 줄은 '새 권한'이 아니라 배포 스크립트의 결손을 메우는 것이다.
--   실서버에는 이미 걸려 있고(taskmgr-company-data/05-grants.sql 이 부여),
--   db/deploy/create-app-user.sql:21-24 에는 없다. 즉 db/deploy 만으로 서버를 재구축하면
--   쓰기 권한 판정(widget/ProjectDb.cs:102)·타인 일정 열람(view_scope)·rev 시딩 게이트가
--   통째로 깨진다. 캘린더 배포가 이 파일 하나로 자족하도록 여기서 다시 부여한다.
--   (GRANT 는 누적이라 이미 있는 권한을 다시 줘도 무해하고, project 의 INSERT/UPDATE 도 유지된다)
GRANT SELECT ON taskmgr.app_user TO 'taskmgr_app'@'%';   -- login_id 실재 확인·view_scope/edit_role 판정·rev 시딩 대상
GRANT SELECT ON taskmgr.org_unit TO 'taskmgr_app'@'%';   -- 조직 트리 조회(widget/ProjectDb.cs:364)
GRANT SELECT ON taskmgr.project  TO 'taskmgr_app'@'%';   -- §6 공식 과제 이름 해석 + db_gone 파생 LEFT JOIN

FLUSH PRIVILEGES;

-- ============================================================================
--  확인 — 배포 후 root 로 실행할 것 (이 파일이 성공했다고 끝난 게 아니다)
-- ----------------------------------------------------------------------------
--  1) 권한 전체 눈으로 보기
--     SHOW GRANTS FOR 'taskmgr_app'@'%';
--
--  2) 캘린더 12개 테이블에 권한이 붙었는지 (기대값 12)
--     schema-calendar.sql 이 만드는 cal_* 는 13개이고, 그중 cal_audit_trash 만 0줄이다.
--     ※ 스키마에 테이블을 더하거나 빼면 이 숫자도 같이 고칠 것. 숫자가 뒤처지면 게이트가
--       '권한이 통째로 빠진 새 테이블'을 통과시킨다(cal_schema_meta 를 더할 때 실제로 겪었다).
--     SELECT COUNT(DISTINCT TABLE_NAME) FROM information_schema.TABLE_PRIVILEGES
--      WHERE GRANTEE LIKE '%taskmgr_app%' AND TABLE_SCHEMA = 'taskmgr'
--        AND TABLE_NAME LIKE 'cal\_%' AND TABLE_NAME <> 'cal_audit_trash';
--
--     2b) 위 숫자 대신 '차집합'으로 보는 편이 낫다 — 스키마가 정본이고 사람이 세지 않는다.
--         권한이 0줄인 cal_* 가 정확히 cal_audit_trash 하나인지 (한 행만 나와야 한다)
--     SELECT t.TABLE_NAME FROM information_schema.TABLES t
--       LEFT JOIN (SELECT DISTINCT TABLE_NAME FROM information_schema.TABLE_PRIVILEGES
--                   WHERE GRANTEE LIKE '%taskmgr_app%' AND TABLE_SCHEMA='taskmgr') p
--              ON p.TABLE_NAME = t.TABLE_NAME
--      WHERE t.TABLE_SCHEMA='taskmgr' AND t.TABLE_NAME LIKE 'cal\_%' AND p.TABLE_NAME IS NULL;
--
--  3) ★ 감사 휴지통에 권한이 한 줄도 없는지 (기대값 0 — 0 이 아니면 §7.5 감사가 무너진다)
--     SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES
--      WHERE GRANTEE LIKE '%taskmgr_app%' AND TABLE_SCHEMA = 'taskmgr'
--        AND TABLE_NAME = 'cal_audit_trash';
--
--  4) ★ DELETE 를 주면 안 되는 테이블에 DELETE 가 없는지 (기대값 0)
--     SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES
--      WHERE GRANTEE LIKE '%taskmgr_app%' AND TABLE_SCHEMA = 'taskmgr'
--        AND TABLE_NAME IN ('cal_user_rev','cal_user_pref','cal_migration_log','cal_schema_meta')
--        AND PRIVILEGE_TYPE = 'DELETE';
--
--     4b) ★ cal_schema_meta 에 쓰기 권한이 하나도 없는지 (기대값 0 — 하나라도 있으면
--         낡은 클라이언트 차단이 무의미해진다. 앱이 자기 통과증을 발급하는 셈이다)
--     SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES
--      WHERE GRANTEE LIKE '%taskmgr_app%' AND TABLE_SCHEMA = 'taskmgr'
--        AND TABLE_NAME = 'cal_schema_meta'
--        AND PRIVILEGE_TYPE IN ('INSERT','UPDATE','DELETE');
--
--  5) DB 단위·전역 권한이 새어 들어오지 않았는지 (기대: USAGE 한 줄뿐)
--     SELECT * FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE LIKE '%taskmgr_app%';
--     SELECT * FROM information_schema.USER_PRIVILEGES   WHERE GRANTEE LIKE '%taskmgr_app%';
--     ※ 여기에 DB 단위 DELETE 가 있으면 3)의 cal_audit_trash 0건은 아무 의미가 없다.
--       전역(*.*)이 DB 단위보다 한 단계 더 위다 — USER_PRIVILEGES 를 빼먹지 말 것.
--     ※ TRIGGER 권한이 여기에 보이면 앱 계정이 감사 트리거를 지울 수 있다는 뜻이다.
--
--  6) ★ 감사 트리거가 실재하는지 (기대값 15 — 0 이면 이 파일의 DELETE 부여에 근거가 없다)
--     관리 계정으로:
--     SELECT COUNT(*) FROM information_schema.TRIGGERS
--      WHERE TRIGGER_SCHEMA='taskmgr' AND TRIGGER_NAME LIKE 'trg\_cal\_%';
--     → 15 가 아니면 db/deploy/triggers-calendar.sql 을 적용할 것. 그때까지 이 파일의
--       DELETE 부여는 '흔적 없이 지울 수 있는 계정을 80대에 배포'하는 것과 같다.
--
--     6b) ★ 숫자 대신 차집합으로 보는 편이 낫다(2b 와 같은 이유 — 사람이 세지 않는다).
--         'DELETE 를 준 cal_* 인데 DELETE 트리거가 없는 표'가 한 행도 없어야 한다.
--     SELECT p.TABLE_NAME FROM information_schema.TABLE_PRIVILEGES p
--       LEFT JOIN information_schema.TRIGGERS t
--              ON t.TRIGGER_SCHEMA = p.TABLE_SCHEMA
--             AND t.EVENT_OBJECT_TABLE = p.TABLE_NAME
--             AND t.EVENT_MANIPULATION = 'DELETE'
--      WHERE p.GRANTEE LIKE '%taskmgr_app%' AND p.TABLE_SCHEMA='taskmgr'
--        AND p.TABLE_NAME LIKE 'cal\_%' AND p.PRIVILEGE_TYPE='DELETE'
--        AND t.TRIGGER_NAME IS NULL;
--     ※ UPDATE 로 바꿔 한 번 더 볼 것. 단 UPDATE 쪽은 cal_user_pref·cal_user_rev 두 행이
--       나오는 것이 정상이다(감사 제외 — 근거는 triggers-calendar.sql 머리주석).
--       이 두 표 말고 다른 이름이 보이면 트리거가 빠진 것이다.
--
--  7) ★ 앱 계정으로 직접 접속해 거부되는지 (넷 다 ERROR 1142 여야 한다. 실측으로 볼 것)
--     mysql -u taskmgr_app -p taskmgr
--       SELECT * FROM cal_audit_trash;                       -- 1142
--       DELETE FROM cal_audit_trash;                         -- 1142
--       DROP TRIGGER trg_cal_entry_bd;                       -- 1142
--       UPDATE cal_schema_meta SET v='999' WHERE k='schema_version';  -- 1142
--     그리고 트리거가 아예 보이지 않는지 (기대값 0):
--       SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='taskmgr';
-- ============================================================================
