-- =====================================================================
--  taskmgr 데이터 적재 템플릿 — 내부망 LLM용
--  ---------------------------------------------------------------------
--  용도: 실제 과제 데이터를 이 형식으로 INSERT SQL을 만들어 taskmgr에 넣는다.
--        (외부망엔 실데이터를 못 주므로, 내부망 LLM이 이 템플릿+구조를 보고 생성)
--  실행: init-db.cmd 로 빈 구조를 만든 뒤,  mysql -u root -p taskmgr < 만든파일.sql
--
--  ★ 반드시 지킬 규칙 (어기면 INSERT 거부/무결성 오류) ★
--   1) 순서: customer(발주처) 먼저 → 그다음 project. (project.customer가 FK)
--   2) project에서 넣지 않는 컬럼(자동 생성): id, uid, is_active, created_at, updated_at
--   3) section 은 정확히: '일반계약' | '선진행' | '사업부관리'  (ENUM — 다른 값 거부)
--   4) status 는 정확히: '진행중' | '종료' | '1차 납품완료' | '미정'  또는 NULL
--   5) '선진행' 행은 start_date, end_date, status 를 NULL 로.
--   6) 날짜는 '2026-01-31' 형식 문자열 또는 NULL.
--   7) customer 값은 위에서 넣은 발주처명과 정확히 일치해야 함(오타=FK 오류).
--   8) 같은 발주처에 동일 사업명 금지(UNIQUE(customer, project_name)).
--   9) 계약명(contract_name)·통상명칭(common_name)은 없으면 NULL.
-- =====================================================================
SET NAMES utf8mb4;

-- (1) 발주처 먼저 — 실제 발주처명으로 교체
INSERT INTO customer (name) VALUES
  ('발주처A'),
  ('발주처B');

-- (2) 과제 — 실제 과제로 교체. 컬럼 순서 고정.
INSERT INTO project
  (section, customer, project_name, contract_name, common_name, start_date, end_date, status)
VALUES
  -- 일반계약 예: 날짜·상태 있음
  ('일반계약','발주처A','○○ 성능개량 사업','○○ 성능개량 계약','○○개량','2026-01-01','2026-12-31','진행중'),
  -- 사업부관리 예: 1차 납품완료
  ('사업부관리','발주처A','△△ 체계 운영','△△ 연간 운영 계약','△△운영','2025-06-15','2027-05-31','1차 납품완료'),
  -- 선진행 예: 계약 전 → 날짜/상태 NULL
  ('선진행','발주처B','□□ 선행연구',NULL,NULL,NULL,NULL,NULL);

-- 확인:
--   SELECT COUNT(*) FROM project;
--   SELECT section, COUNT(*) FROM project GROUP BY section;
--   SELECT * FROM project WHERE section='선진행';   -- 날짜/상태 NULL 확인
