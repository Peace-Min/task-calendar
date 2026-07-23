-- ============================================================================
-- 앱 전용 최소권한 DB 계정 (과제 DB 배포용)
-- ----------------------------------------------------------------------------
-- 왜: 접속 정보는 앱 바이너리에 박혀 '전 사용자에게' 배포된다. 즉 누구든 계정을
--     추출해 MySQL에 직접 접속할 수 있다. 그러므로 이 계정은, 노출되더라도 피해가
--     '앱이 이미 허용하는 것'까지로 제한되도록 최소권한만 가진다.
--   · 앱이 실제로 쓰는 SQL 동사 = SELECT / INSERT / UPDATE  (전수 점검됨)
--   · 소프트삭제는 UPDATE is_active=0 이라 DELETE 불필요
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

GRANT SELECT, INSERT, UPDATE ON taskmgr.project  TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE ON taskmgr.customer TO 'taskmgr_app'@'%';

FLUSH PRIVILEGES;

-- 확인: SHOW GRANTS FOR 'taskmgr_app'@'%';
