-- =====================================================================
--  과제관리(taskmgr) 구조 전용 DDL — 배포/이관용 (더미 시드 없음)
--  MySQL 8.0.16+ / InnoDB / utf8mb4. 지금(개인 PC)·나중(서버) 동일하게 실행.
--  ※ 데이터는 이 파일이 채우지 않는다 — 내부망 LLM INSERT 또는 mysqldump 이관으로.
--  ※ 구조 단일 소스는 db/schema.sql 과 동일(구조 확정). 이 파일은 시드만 뺀 배포본.
--  ⚠️ 맨 위 DROP은 멱등 재구축용 — 데이터 있는 DB에 재실행하면 지워진다(최초 1회용).
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
  name        VARCHAR(100) NOT NULL,             -- 발주처 = 자연키(FK 타겟)
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,   -- 소프트 삭제(0=숨김)
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='발주처 마스터. name=자연키. Admin 관리.';

-- ---------- 구분(section) 코드테이블 — ENUM 대체(런타임 추가/개명/순서/숨김). project.section FK 타겟 ----------
CREATE TABLE section_code (
  name        VARCHAR(50)  NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='구분 코드. name=자연키. 개명=FK CASCADE. Admin 관리.';

-- ---------- 상태(status) 코드테이블 ----------
CREATE TABLE status_code (
  name        VARCHAR(50)  NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='상태 코드. name=자연키. 개명=FK CASCADE. Admin 관리.';

-- ---------- 과제(핵심 엔티티) ----------
CREATE TABLE project (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,  -- 내부 PK(대리키)
  uid           CHAR(36)     NOT NULL DEFAULT (UUID()), -- 외부 안정 참조키(assign-once). 일정은 db-<uid>로 참조
  section       VARCHAR(50)  NOT NULL,                 -- 구분 (FK -> section_code.name)
  customer      VARCHAR(100) NOT NULL,                 -- 발주처 (FK -> customer.name)
  project_name  VARCHAR(200) NOT NULL,                 -- 사업명
  contract_name VARCHAR(200) NOT NULL DEFAULT '',      -- 계약명(빈값=''; NULL 금지)
  common_name   VARCHAR(200) NOT NULL DEFAULT '',      -- 통상명칭(빈값=''; NULL 금지)
  start_date    DATE         NULL,                     -- 계약시작일(선진행/미정=NULL)
  end_date      DATE         NULL,                     -- 계약종료일(선진행/미정=NULL)
  status        VARCHAR(50)  NULL DEFAULT NULL,        -- 상태 (FK -> status_code.name; NULL이면 검사 스킵)
  note          VARCHAR(500) NOT NULL DEFAULT '',      -- 비고(관리 화면 전용; 캘린더·보고서 미노출). 빈값=''
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,       -- 소프트 삭제(0=숨김)
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_project_uid (uid),                     -- 외부 참조 무결성(assign-once) — 과제 정체성은 uid
  -- 이름 기반 하드 유니크 없음(실데이터 정당 중복 다수) — 실수 중복은 앱 소프트 경고로. 근거: db/TABLE-DESIGN.md §4(ADR-21).
  KEY ix_project_customer (customer),
  KEY ix_project_section  (section),
  KEY ix_project_active   (is_active),
  CONSTRAINT fk_project_customer FOREIGN KEY (customer) REFERENCES customer(name)
    ON UPDATE CASCADE,                                 -- 발주처 개명 자동 전파(삭제는 RESTRICT)
  CONSTRAINT fk_project_section FOREIGN KEY (section) REFERENCES section_code(name)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_project_status FOREIGN KEY (status) REFERENCES status_code(name)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='과제 마스터. DB 원본. section/status=코드테이블+FK, is_active=소프트삭제.';

-- 코드테이블 시드(참조 데이터 — 더미 아님). project INSERT 전에 존재해야 FK가 성립.
INSERT INTO section_code (name, sort_order) VALUES
  ('일반계약', 10), ('선진행', 20), ('사업부관리', 30);
INSERT INTO status_code (name, sort_order) VALUES
  ('진행중', 10), ('종료', 20), ('1차 납품완료', 30), ('미정', 40);
