-- =====================================================================
--  과제 데이터 적재 템플릿(내부망 LLM용)
--  ---------------------------------------------------------------------
--  용도: 실제 과제 데이터를 이 형식의 INSERT SQL 로 만들어 taskcalendar 에 넣는다.
--        (외부망엔 실데이터를 못 주므로, 내부망 LLM이 이 템플릿+구조를 보고 생성)
--  실행: setup-taskcalendar.cmd 로 DB 를 만든 뒤,
--          mysql -u root -p --default-character-set=utf8mb4 taskcalendar < 만든파일.sql
--
--  ★ 2026-10-15 부터 코드표(발주처, 구분, 상태)는 번호가 키다(docs/CODE-TABLE-IDS.md).
--    project 는 이름이 아니라 번호(customer_id, section_id, status_id)를 담는다.
--    그래서 과제는 이름으로 적어 임시 표(_load_project)에 먼저 넣고, 마지막에 이름으로 번호를 찾아 옮긴다.
--
--  ★ 반드시 지킬 규칙 (어기면 아래 검사가 멈추거나 INSERT 가 거부된다) ★
--   1) 순서: 코드값(section_code/status_code)과 customer(발주처)를 먼저, 그다음 과제. (전부 project 의 FK)
--   2) project 에서 넣지 않는 컬럼(자동 생성): id, uid, is_active, created_at, updated_at
--   3) 구분과 상태는 코드표에 있는 이름이어야 한다. 기본 행은 번호가 고정이다:
--        구분 1 일반계약, 2 선진행, 3 사업부관리 / 상태 1 진행중, 2 종료, 3 1차 납품완료, 4 미정.
--      새 이름이 필요하면 아래 (0)처럼 번호 없이 이름만 넣는다(번호는 자동으로 다음 값).
--   4) 상태가 없으면 NULL. 구분, 상태와 날짜는 서로 묶이지 않는다(어느 구분이든 날짜와 상태를 넣거나 비울 수 있다).
--   5) 과제 순서(No, 구조 19 의 sort_no)는 (2)에 적은 순서다. 구분마다 그 구분의 지금 마지막 번호 뒤에 1 씩 붙는다(아래 (5)).
--   6) 날짜는 '2026-01-31' 형식 문자열 또는 NULL.
--   7) 발주처 이름은 (1)에서 넣은 이름과 글자까지 같아야 한다. 못 찾는 이름이 하나라도 있으면 (3)에서 멈춘다.
--   8) 이름 유니크 없음. 같은 발주처, 같은 사업명 중복을 허용한다(구성품별 계약, 연도별 갱신). 실수 중복은 앱 소프트경고가 잡는다.
--   9) 계약명(contract_name), 통상명칭(common_name), note(비고)는 없으면 '' (빈 문자열; NULL 금지).
--  10) --force 를 붙이지 말 것. (3)의 검사는 에러로 멈추는 방식이다.
-- =====================================================================
SET NAMES utf8mb4;

-- (0) 코드값. 기본 행은 setup 이 이미 넣었다. 재실행과 새 값에 대비해 INSERT IGNORE 로 보장한다(번호 고정).
INSERT IGNORE INTO section_code (section_id, name, sort_order) VALUES (1,'일반계약',10),(2,'선진행',20),(3,'사업부관리',30);
INSERT IGNORE INTO status_code  (status_id, name, sort_order) VALUES (1,'진행중',10),(2,'종료',20),(3,'1차 납품완료',30),(4,'미정',40);
-- 새 구분/상태가 필요하면 여기서 먼저 추가(예, 번호는 자동):  INSERT IGNORE INTO status_code (name, sort_order) VALUES ('보류',50);

-- (1) 발주처 먼저. 실제 발주처명으로 교체(번호는 자동).
INSERT IGNORE INTO customer (name) VALUES
  ('발주처A'),
  ('발주처B');

-- (2) 과제. 이름으로 적는다(임시 표). 실제 과제로 교체. 컬럼 순서 고정. (note 는 생략 가능, DEFAULT '')
DROP TEMPORARY TABLE IF EXISTS _load_project;
CREATE TEMPORARY TABLE _load_project (
  seq           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  section       VARCHAR(50)  NOT NULL,
  customer      VARCHAR(100) NOT NULL,
  project_name  VARCHAR(200) NOT NULL,
  contract_name VARCHAR(200) NOT NULL DEFAULT '',
  common_name   VARCHAR(200) NOT NULL DEFAULT '',
  start_date    DATE         NULL,
  end_date      DATE         NULL,
  status        VARCHAR(50)  NULL,
  note          VARCHAR(500) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO _load_project
  (section, customer, project_name, contract_name, common_name, start_date, end_date, status)
VALUES
  -- 일반계약 예: 날짜·상태 있음
  ('일반계약','발주처A','○○ 성능개량 사업','○○ 성능개량 계약','○○개량','2026-01-01','2026-12-31','진행중'),
  -- 사업부관리 예: 1차 납품완료
  ('사업부관리','발주처A','△△ 체계 운영','△△ 연간 운영 계약','△△운영','2025-06-15','2027-05-31','1차 납품완료'),
  -- 선진행 예: 계약 전이라 날짜와 상태가 아직 없다
  ('선진행','발주처B','□□ 선행연구','','',NULL,NULL,NULL);

-- (3) 이름 → 번호 검사. 코드표에서 못 찾는 이름(BINARY 기준)이 하나라도 있으면 여기서 멈춘다.
--     (멈추지 않고 JOIN 으로 넣으면 못 찾은 행이 조용히 빠진다.)
SET @load_miss := (SELECT COUNT(*) FROM _load_project l
                     LEFT JOIN section_code s ON CAST(s.name AS BINARY) = CAST(l.section  AS BINARY)
                     LEFT JOIN customer     c ON CAST(c.name AS BINARY) = CAST(l.customer AS BINARY)
                     LEFT JOIN status_code  t ON CAST(t.name AS BINARY) = CAST(l.status   AS BINARY)
                    WHERE s.section_id IS NULL OR c.customer_id IS NULL
                       OR (l.status IS NOT NULL AND t.status_id IS NULL));
SET @g := IF(@load_miss = 0, 'DO 0',
             'SELECT 1 FROM `중단: 코드표에 없는 구분, 발주처, 상태 이름이 있다 - 글자를 맞출 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- (4) 번호로 바꿔 넣는다.
INSERT INTO project
  (section_id, customer_id, project_name, contract_name, common_name, start_date, end_date, status_id, note)
SELECT s.section_id, c.customer_id, l.project_name, l.contract_name, l.common_name, l.start_date, l.end_date,
       t.status_id, l.note
  FROM _load_project l
  JOIN section_code s ON CAST(s.name AS BINARY) = CAST(l.section  AS BINARY)
  JOIN customer     c ON CAST(c.name AS BINARY) = CAST(l.customer AS BINARY)
  LEFT JOIN status_code t ON CAST(t.name AS BINARY) = CAST(l.status AS BINARY)
 ORDER BY l.seq;

DROP TEMPORARY TABLE IF EXISTS _load_project;

-- (5) 과제 순서(구조 19, sort_no). 방금 넣은 과제(번호가 빈 보이는 과제)에 구분마다 넣은 순서(id 순)로
--     그 구분의 지금 최댓값 뒤 번호를 매긴다. 이미 번호가 있는 과제는 건드리지 않는다.
UPDATE project p
  JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY section_id ORDER BY id) AS rn
          FROM project WHERE is_active = 1 AND sort_no IS NULL) o ON o.id = p.id
  LEFT JOIN (SELECT section_id, MAX(sort_no) AS mx FROM project WHERE is_active = 1 GROUP BY section_id) m ON m.section_id = p.section_id
   SET p.sort_no = IFNULL(m.mx, 0) + o.rn
 WHERE p.id > 0;

-- 확인:
--   SELECT COUNT(*) FROM project;
--   SELECT s.name, COUNT(*) FROM project p JOIN section_code s ON s.section_id = p.section_id GROUP BY s.name;
--   SELECT s.name, p.sort_no, p.common_name FROM project p JOIN section_code s ON s.section_id = p.section_id
--    WHERE p.is_active = 1 ORDER BY s.sort_order, p.sort_no;    -- 과제 순서(No) 확인
--   SELECT section_id, name, sort_order FROM section_code ORDER BY sort_order;  -- 코드값 확인
