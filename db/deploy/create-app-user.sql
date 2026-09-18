-- ============================================================================
-- 앱 전용 최소권한 DB 계정 (과제 DB 배포용)
-- ----------------------------------------------------------------------------
-- 왜: 접속 정보는 앱 바이너리에 박혀 '전 사용자에게' 배포된다. 즉 누구든 계정을
--     추출해 MySQL에 직접 접속할 수 있다. 그러므로 이 계정은, 노출되더라도 피해가
--     '앱이 이미 허용하는 것'까지로 제한되도록 최소권한만 가진다.
--   · 앱이 실제로 쓰는 SQL 동사 = SELECT / INSERT / UPDATE / DELETE  (전수 점검됨 — DELETE 는 휴지통 한 곳)
--   · 소프트삭제는 UPDATE is_active=0 이라 평소엔 DELETE 가 필요 없다. 그럼에도 아래 네 표에
--     DELETE 가 있는 이유는 **휴지통 관문 하나 때문**이다 — 숨긴 항목만, 관리자만, 이름을 그대로
--     입력한 뒤에야 ProjectDb.DeleteTrashAsync 가 지운다(docs/TRASH-DELETE.md §3.3).
--     권한은 '가능하게'만 하고 판정은 호스트가 한다.
--   · DDL(DROP/ALTER/CREATE)·GRANT·타 DB 접근 없음
-- ----------------------------------------------------------------------------
-- 배포(폐쇄망 서버)에서:
--   1) 아래 IDENTIFIED BY '...' 를 실제 강한 비밀번호로 교체
--   2) 접속 호스트 범위를 최소화 (가능하면 '%' 대신 사내 서브넷, 예: '10.0.0.%')
--   3) 이 스크립트를 root로 1회 실행
--   4) 같은 비밀번호를 widget/ProjectDb.cs 의 DefUser/DefPassword 에 넣고 빌드
-- ============================================================================

CREATE USER IF NOT EXISTS 'taskmgr_app'@'%'
  IDENTIFIED BY 'CHANGE_ME_ON_DEPLOY';   -- ★ 배포 시 강한 비밀번호로 교체

GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.project      TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.customer     TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.section_code TO 'taskmgr_app'@'%';   -- 구분 코드값(위젯 관리)
GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.status_code  TO 'taskmgr_app'@'%';   -- 상태 코드값(위젯 관리)

-- 사용자·조직 도메인의 두 마스터 — 2026-09-18 직급·소속 관리(docs/ORG-TITLE-ADMIN.md §6).
--   위 넷은 과제 도메인이고 이 둘은 아니지만, §0-5 가 세 파일을 **같은 목록**으로 다시 돌리게 해 두었다 —
--   빠지면 「직급·소속 관리」의 첫 쓰기가 ERROR 1142 다. DELETE 는 주지 않는다(숨김까지 · 행은 남는다).
--   ※ app_user 자체의 권한은 여기 없다 — 그 정본은 비공개 taskmgr-company-data/05-grants.sql 이다.
GRANT SELECT, INSERT, UPDATE ON taskmgr.org_unit   TO 'taskmgr_app'@'%';   -- 조직 트리 조회 + 「직급·소속 관리」 쓰기
GRANT SELECT, INSERT, UPDATE ON taskmgr.title_code TO 'taskmgr_app'@'%';   -- 직급 목록 조회 + 같은 화면의 쓰기

FLUSH PRIVILEGES;

-- 확인: SHOW GRANTS FOR 'taskmgr_app'@'%';
