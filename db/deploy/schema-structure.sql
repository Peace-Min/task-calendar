-- =====================================================================
--  과제 트랙 구조 DDL(배포와 새 DB 구축용, 더미 시드 없음)
--  MySQL 8.0.16+ / InnoDB / utf8mb4. setup-taskcalendar.ps1 의 [2] 가 이 파일을 그대로 흘려 넣는다.
--  ※ 데이터는 이 파일이 채우지 않는다(코드표 기본 행만 넣는다). 과제는 setup 이 원본 taskmgr 에서 옮긴다.
--  ※ 과제 트랙 구조의 정본은 이 파일 하나다(옛 db/schema.sql 은 2026-10-15 에 지웠다).
--  ※ 2026-10-15 코드표 번호 키 전환(docs/CODE-TABLE-IDS.md, schema_version 13):
--     발주처, 구분, 상태는 번호(customer_id, section_id, status_id)가 기본키이고 이름은 UNIQUE 라벨이다.
--     project 는 번호로 가리킨다. 개명은 그 표의 name 한 행만 바꾸면 되고 화면은 조인으로 따라온다.
--     같은 전환을 이미 데이터가 있는 DB 에 하는 것은 migrate-2026-10-15-code-ids.sql 이다.
--     두 경로의 결과(열, 인덱스, 외래키, CHECK, 표 COMMENT)는 글자까지 같아야 한다.
--  주의: 맨 위 DROP 은 처음부터 다시 짓기 위한 것이다. 데이터가 있는 DB 에 다시 돌리면 지워진다.
-- =====================================================================
SET NAMES utf8mb4;

DROP VIEW  IF EXISTS v_calendar_category;
DROP VIEW  IF EXISTS v_project_label;
DROP VIEW  IF EXISTS v_project_full;
DROP TABLE IF EXISTS project;          -- customer/section_code/status_code를 FK로 참조하므로 먼저 삭제
DROP TABLE IF EXISTS project_status;
DROP TABLE IF EXISTS project_type;
DROP TABLE IF EXISTS customer;
DROP TABLE IF EXISTS section_code;
DROP TABLE IF EXISTS status_code;

-- ---------- 발주처 마스터 ----------
CREATE TABLE customer (
  customer_id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT, -- 발주처 번호(기본키). project.customer_id 가 가리킨다
  name        VARCHAR(100) NOT NULL,             -- 발주처 이름(라벨). UNIQUE, 개명은 이 한 행만 바꾼다
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,   -- 소프트 삭제(0=숨김)
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (customer_id),
  UNIQUE KEY uq_customer_name (name),            -- 옛 기본키(name)가 하던 중복 막기(ai_ci, 대소문자만 다른 이름도 막는다)
  CONSTRAINT chk_customer_name   CHECK (name <> ''),
  CONSTRAINT chk_customer_active CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='발주처 마스터. PK=customer_id, name=UNIQUE 라벨. Admin 관리.';

-- ---------- 구분(section) 코드표. project.section_id 가 가리킨다 ----------
--  고정 번호: 2=선진행(날짜와 상태를 비우고 잠근다). 앱은 이름이 아니라 이 번호로 판정한다.
CREATE TABLE section_code (
  section_id  SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(50)  NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (section_id),
  UNIQUE KEY uq_section_code_name (name),
  CONSTRAINT chk_section_code_name   CHECK (name <> ''),
  CONSTRAINT chk_section_code_active CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='구분 코드. PK=section_id(고정 번호 2=선진행), name=UNIQUE 라벨. Admin 관리.';

-- ---------- 상태(status) 코드표. project.status_id 가 가리킨다 ----------
--  고정 번호: 2=종료(목록 필터 제외, 엑셀 회색).
CREATE TABLE status_code (
  status_id   SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(50)  NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (status_id),
  UNIQUE KEY uq_status_code_name (name),
  CONSTRAINT chk_status_code_name   CHECK (name <> ''),
  CONSTRAINT chk_status_code_active CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='상태 코드. PK=status_id(고정 번호 2=종료), name=UNIQUE 라벨. Admin 관리.';

-- ---------- 과제(핵심 엔티티) ----------
CREATE TABLE project (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,  -- 내부 PK(대리키)
  uid           CHAR(36)     NOT NULL DEFAULT (UUID()), -- 외부 안정 참조키(assign-once). 일정은 db-<uid>로 참조
  section_id    SMALLINT UNSIGNED NOT NULL,            -- 구분 (FK -> section_code.section_id)
  customer_id   SMALLINT UNSIGNED NOT NULL,            -- 발주처 (FK -> customer.customer_id)
  project_name  VARCHAR(200) NOT NULL,                 -- 사업명
  contract_name VARCHAR(200) NOT NULL DEFAULT '',      -- 계약명(빈값=''; NULL 금지)
  common_name   VARCHAR(200) NOT NULL DEFAULT '',      -- 통상명칭(빈값=''; NULL 금지)
  start_date    DATE         NULL,                     -- 계약시작일(선진행/미정=NULL)
  end_date      DATE         NULL,                     -- 계약종료일(선진행/미정=NULL)
  dev_end_date  DATE         NULL,                     -- 개발종료일(개발 완료 목표·실제. 계약종료일과 별개. 미정=NULL)
  status_id     SMALLINT UNSIGNED NULL DEFAULT NULL,   -- 상태 (FK -> status_code.status_id; NULL 은 상태 없음)
  note          VARCHAR(500) NOT NULL DEFAULT '',      -- 비고(관리 화면 전용; 캘린더·보고서 미노출). 빈값=''
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,       -- 소프트 삭제(0=숨김)
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_project_uid (uid),                     -- 외부 참조 무결성(assign-once). 과제 정체성은 uid
  -- 이름 기반 하드 유니크 없음(실데이터 정당 중복 다수). 실수 중복은 앱 소프트 경고로. 근거: db/TABLE-DESIGN.md §4(ADR-21).
  KEY ix_project_customer_id (customer_id),            -- 발주처 조회와 소프트경고 후보 조회, FK 받침
  KEY ix_project_section_id  (section_id),
  KEY ix_project_status_id   (status_id),
  KEY ix_project_active      (is_active),
  -- 번호는 바뀌지 않으므로 갱신 전파(CASCADE)가 필요 없다. 코드 행 삭제는 쓰는 과제가 있으면 막는다.
  CONSTRAINT fk_project_customer_id FOREIGN KEY (customer_id) REFERENCES customer(customer_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_project_section_id FOREIGN KEY (section_id) REFERENCES section_code(section_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_project_status_id FOREIGN KEY (status_id) REFERENCES status_code(status_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_project_active CHECK (is_active IN (0,1))
  -- 계약일 순서 CHECK(start_date <= end_date)는 아직 걸지 않는다. 실데이터를 확인한 뒤 정한다(CODE-TABLE-IDS §8-4).
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='과제 마스터. DB 원본. 코드는 번호 참조(customer_id, section_id, status_id), is_active=소프트삭제.';

-- 코드표 시드(참조 데이터, 더미 아님). project INSERT 전에 있어야 FK 가 성립한다.
--  ★ 번호를 명시한다(org_id 와 같은 방식). 앱이 이 번호로 동작을 판정한다(CODE-TABLE-IDS §3):
--    구분 2=선진행, 상태 2=종료. 이름은 바꿀 수 있지만 번호는 바꾸지 않는다.
--  ★ setup-taskcalendar.ps1 과 migrate-2026-10-15-code-ids.sql 이 이 두 줄을 고정 번호 지도로 쓴다.
--    번호나 이름을 고칠 때는 세 곳이 함께 움직인다(tests/code-ids-db.test.mjs 가 대조한다).
INSERT INTO section_code (section_id, name, sort_order) VALUES
  (1, '일반계약', 10), (2, '선진행', 20), (3, '사업부관리', 30);
INSERT INTO status_code (status_id, name, sort_order) VALUES
  (1, '진행중', 10), (2, '종료', 20), (3, '1차 납품완료', 30), (4, '미정', 40);
