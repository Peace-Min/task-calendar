-- ============================================================================
-- 백업 전용 최소권한 DB 계정 (taskmgr 주간 백업용)
--   짝: backup-taskmgr.ps1 / backup-taskmgr.cmd
-- ----------------------------------------------------------------------------
-- 왜 root 를 쓰지 않는가:
--   주간 백업은 작업 스케줄러가 사람 없이 돌린다. 무인 실행이므로 자격 증명이
--   그 PC 안에 파일(.cnf)로 남아 있어야 하고, 그 파일은 평문이다.
--   거기에 root 를 적어 두면 '.cnf 한 파일이 읽히는 것' 이 곧 'DB 전체에 대한
--   DROP·GRANT 권한이 넘어가는 것' 이 된다. 백업이 실제로 필요로 하는 동작은
--   읽기뿐이므로, 노출되더라도 피해가 '읽기' 까지로 끝나는 계정을 따로 판다.
--   (같은 논리로 접속 호스트도 '%' 가 아니라 'localhost' 다 — 백업은 DB 서버와
--    같은 PC 에서 돈다. 다른 PC 에서 돌릴 거라면 그 PC 의 주소로 바꿀 것.)
--
-- ★ 왜 SELECT 만으로는 안 되는가 — 실측 결과다:
--   SELECT 만 가진 계정으로 mysqldump 를 돌리면 **에러도 경고도 없이 exit 0** 으로
--   끝나는데 트리거가 통째로 빠진다.
--     · 같은 DB, root          : 6404 바이트 · 표 3 · 트리거 3 · exit 0
--     · 같은 DB, SELECT 만     : 3377 바이트 · 표 3 · 트리거 0 · exit 0
--   (실제 taskmgr 규모에서는 72K 對 48K · 표 20 · 트리거 15 → 0 으로 측정됐다)
--   더 나쁜 것은 information_schema.TRIGGERS 도 TRIGGER 권한으로 걸러진다는 점이다.
--   그 계정 눈에는 DB 쪽 트리거도 0 개로 보이므로 '덤프 0 == DB 0' 으로 대조까지
--   통과해 버린다(실측: SELECT 만 가진 계정의 COUNT(*) = 0, TRIGGER 까지 가진
--   계정 = 3). 그래서 backup-taskmgr.ps1 은 덤프 전에 SHOW GRANTS 로 TRIGGER 보유를
--   먼저 확인한다. 이 GRANT 를 빼면 그 검사에서 막혀 백업이 아예 돌지 않는다.
--
-- 안 주는 권한과 그 이유:
--   · LOCK TABLES : --single-transaction 으로 뜨므로 필요 없다(InnoDB 일관 스냅샷).
--   · PROCESS     : --no-tablespaces 로 뜨므로 필요 없다. 이걸 주면 서버 전역의
--                   다른 세션·쿼리가 전부 보인다(전역 권한이라 DB 경계를 넘는다).
--   · RELOAD      : --flush-logs / --source-data 를 쓰지 않으므로 필요 없다.
--   · SHOW VIEW / EXECUTE·SHOW_ROUTINE : 현재 taskmgr 에 뷰 0 · 저장 프로시저 0.
--                   나중에 생기면 아래 주석 처리된 줄을 함께 부여할 것
--                   (뷰가 있는데 SHOW VIEW 가 없으면 mysqldump 는 그때는 조용하지
--                    않고 exit 2 로 죽는다 — 실측).
-- ----------------------------------------------------------------------------
-- 배포(폐쇄망 서버)에서:
--   1) 아래 IDENTIFIED BY '...' 를 실제 강한 비밀번호로 교체
--   2) 이 스크립트를 root 로 1 회 실행
--   3) 같은 비밀번호를 백업용 .cnf 에 넣고 파일 권한을 좁힌다(backup-taskmgr.ps1 이
--      .cnf 가 없으면 만드는 법과 icacls 예시를 그대로 찍어 준다)
--   4) backup-taskmgr.cmd -Install 을 관리자 권한으로 1 회 실행(주 1 회 등록)
-- ============================================================================

CREATE USER IF NOT EXISTS 'taskmgr_backup'@'localhost'
  IDENTIFIED BY 'CHANGE_ME_ON_DEPLOY';   -- ★ 배포 시 강한 비밀번호로 교체

GRANT SELECT, TRIGGER ON taskmgr.* TO 'taskmgr_backup'@'localhost';

-- 뷰가 생기면 함께 부여(그 전에는 불필요):
-- GRANT SHOW VIEW ON taskmgr.* TO 'taskmgr_backup'@'localhost';
-- 저장 프로시저/함수가 생기면 함께 부여(MySQL 8.0.20+ 는 SHOW_ROUTINE 이 정석):
-- GRANT SHOW_ROUTINE ON *.* TO 'taskmgr_backup'@'localhost';

FLUSH PRIVILEGES;

-- 확인: SHOW GRANTS FOR 'taskmgr_backup'@'localhost';
--   기대: GRANT USAGE ON *.* … / GRANT SELECT, TRIGGER ON `taskmgr`.* …
