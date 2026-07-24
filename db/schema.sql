-- =====================================================================
--  과제관리(taskmgr) 스키마 — DB 원본(authoritative) 모델
--  MySQL 8.0.16+ / InnoDB / utf8mb4. 로컬 MySQL <-> 사내 서버 동일 DDL.
--
--  ★ 설계 모델: DB가 원본(source of truth). Admin이 캘린더 앱으로 과제를
--    등록/수정하고, Excel은 DB에서 '추출'하는 리포트(양방향 동기화 없음).
--    - 기존 사업부 Excel은 최초 1회만 이 DB로 이관하고, 이후엔 DB가 마스터.
--    - Excel 흔적 필드(원본 No)는 제거 — No는 추출 시점에 생성하면 됨.
--    - section/status는 룩업 코드테이블(section_code/status_code) + FK(발주처와 대칭).
--      ENUM이 아니라 코드테이블이라 런타임 추가/개명(CASCADE)/순서변경/숨김이 가능하고, FK가 무결성을 승계한다.
--    - 삭제는 소프트(is_active=0). 영구 삭제는 DB에서 직접 DELETE.
--    - created_at/updated_at 감사. 발주처·구분·상태 개명은 FK ON UPDATE CASCADE로 project에 자동 전파.
-- =====================================================================
SET NAMES utf8mb4;

-- ---------- 재구축 멱등 : 이전 객체 정리(캘린더 결합/미러 버전 잔재 포함) ----------
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

-- ---------- 구분(section) 코드테이블 — 발주처와 대칭. ENUM 대체(런타임 추가/개명/순서/숨김) ----------
CREATE TABLE section_code (
  name        VARCHAR(50)  NOT NULL,             -- 코드값 = 자연키(project.section FK 타겟)
  sort_order  INT          NOT NULL DEFAULT 0,   -- 드롭다운 정렬(작을수록 먼저)
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,   -- 소프트 삭제(0=숨김)
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='구분 코드. name=자연키. 개명=FK CASCADE로 project 전파. Admin 관리.';

-- ---------- 상태(status) 코드테이블 — section_code와 동일 형태 ----------
CREATE TABLE status_code (
  name        VARCHAR(50)  NOT NULL,             -- 코드값 = 자연키(project.status FK 타겟, nullable)
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='상태 코드. name=자연키. 개명=FK CASCADE로 project 전파. Admin 관리.';

-- ---------- 과제(핵심 엔티티) ----------
CREATE TABLE project (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,  -- 내부 PK(대리키)
  uid           CHAR(36)     NOT NULL DEFAULT (UUID()), -- 외부 안정 참조키(assign-once). 일정은 db-<uid>로 참조. rename/재빌드/이관에도 불변
  section       VARCHAR(50)  NOT NULL,                 -- 구분 (FK -> section_code.name)
  customer      VARCHAR(100) NOT NULL,                 -- 발주처 (FK -> customer.name)
  project_name  VARCHAR(200) NOT NULL,                 -- 사업명
  contract_name VARCHAR(200) NOT NULL DEFAULT '',      -- 계약명(빈값=''; NULL 금지 — 비교 함정 방지)
  common_name   VARCHAR(200) NOT NULL DEFAULT '',      -- 통상명칭(빈값=''; NULL 금지)
  start_date    DATE         NULL,                     -- 계약시작일(선진행/미정=NULL)
  end_date      DATE         NULL,                     -- 계약종료일(선진행/미정=NULL)
  status        VARCHAR(50)  NULL DEFAULT NULL,        -- 상태 (FK -> status_code.name; 선진행=NULL이면 FK 검사 스킵)
  note          VARCHAR(500) NOT NULL DEFAULT '',      -- 비고(관리 화면 전용 내부메모; 캘린더·보고서 미노출). 빈값=''
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,       -- 소프트 삭제(0=숨김)
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_project_uid (uid),                     -- 외부 참조 무결성(assign-once) — 과제 정체성은 uid
  -- 이름 기반 하드 유니크는 두지 않는다 — 실데이터에 정당한 중복 다수(구성품별 계약·연도별 갱신).
  -- 실수 중복은 앱 소프트 경고(정규화 비교)로 거른다. 근거: db/TABLE-DESIGN.md §4 (ADR-21).
  KEY ix_project_customer (customer),                  -- 발주처 조회 + 소프트경고 후보 조회
  KEY ix_project_section  (section),
  KEY ix_project_active   (is_active),
  CONSTRAINT fk_project_customer FOREIGN KEY (customer) REFERENCES customer(name)
    ON UPDATE CASCADE,                                 -- 발주처 개명 자동 전파(삭제는 RESTRICT)
  CONSTRAINT fk_project_section FOREIGN KEY (section) REFERENCES section_code(name)
    ON UPDATE CASCADE ON DELETE RESTRICT,              -- 구분 개명 자동 전파(참조 중이면 삭제 차단)
  CONSTRAINT fk_project_status FOREIGN KEY (status) REFERENCES status_code(name)
    ON UPDATE CASCADE ON DELETE RESTRICT               -- 상태 개명 자동 전파(NULL이면 검사 스킵)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='과제 마스터. DB 원본. 정체성=uid. 이름 유니크 없음(소프트경고). section/status=코드테이블+FK, is_active=소프트삭제.';

-- =====================================================================
--  초기 이관 시드(로컬 개발·검증용 더미 13건).
--  ※ 서버 초기 배포 시엔 이 시드 대신 실제 사업부 Excel 1회 이관으로 대체.
--  ※ 더미(롤 지명) 픽스처 — 실 국방데이터 아님. 선진행은 날짜/상태 NULL.
-- =====================================================================
-- 코드테이블 시드 — project INSERT보다 먼저(FK 타겟이 존재해야 함).
INSERT INTO section_code (name, sort_order) VALUES
  ('일반계약', 10), ('선진행', 20), ('사업부관리', 30);
INSERT INTO status_code (name, sort_order) VALUES
  ('진행중', 10), ('종료', 20), ('1차 납품완료', 30), ('미정', 40);

INSERT INTO customer (name) VALUES
  ('데마시아'),('노크사스'),('요르드'),('필리오니아'),
  ('아이오니아'),('빌지조트'),('셔마야'),('불타오르는 대지');

INSERT INTO project
  (section, customer, project_name, contract_name, common_name, start_date, end_date, status)
VALUES
  -- [일반계약]
  ('일반계약','데마시아','자르반 2세 정복 작전','빛의 검 강화 용역','자르반의 검',DATE'2023-01-10',DATE'2024-06-30','종료'),
  ('일반계약','노크사스','스윈의 침략 방어 체계 구축','전쟁 여신 무기 개발 용역','노크사스의 분노',DATE'2023-03-15',DATE'2025-02-28','진행중'),
  ('일반계약','요르드','바르드 하모니 복원 사업','고요의 음악 수집 용역','바르드의 노래',DATE'2022-07-01',DATE'2023-12-31','종료'),
  ('일반계약','필리오니아','아리 그림자 무술 훈련소 건립','키스사기 기술 이전 용역','아리의 키스',DATE'2024-01-05',DATE'2026-08-20','진행중'),
  ('일반계약','아이오니아','아리 고국 방벽 강화','그림자 무술 교육 용역','아이오니아 방패',DATE'2023-06-01',DATE'2025-05-31','1차 납품완료'),
  ('일반계약','빌지조트','트런드 해골 검 수리','피마신 유지보수 용역','트런드의 톱',DATE'2022-11-10',DATE'2023-11-09','종료'),
  ('일반계약','셔마야','네코 정령 소환 시스템 구축','고양이 귀 장착 용역','네코의 꼬리',DATE'2024-04-01',DATE'2026-03-31','진행중'),
  ('일반계약','불타오르는 대지','비스트 화염 저항 장비 개발','용의 숨 막기 용역','비스트의 불',DATE'2025-01-15',DATE'2027-12-31','미정'),
  -- [선진행] 계약 전 -> 날짜/상태 NULL
  ('선진행','데마시아','가렌 방패 업그레이드','빛의 검 2차 강화 용역','가렌의 방패',NULL,NULL,NULL),
  ('선진행','요르드','뺀비 폭죽 안전 기준 마련','폭죽 제조 허가 용역','뺀비의 폭죽',NULL,NULL,NULL),
  -- [사업부관리]
  ('사업부관리','데마시아','리안돈 성벽 보수','성벽 설계 용역','리안돈 성벽',DATE'2023-05-01',DATE'2024-04-30','종료'),
  ('사업부관리','데마시아','카르마 영적 훈련 프로그램','다섯 번째 인시그니아 연구 용역','카르마의 빛',DATE'2024-02-01',DATE'2026-01-31','진행중'),
  ('사업부관리','데마시아','타리온 빛의 검 연마','쌍검 동기화 용역','타리온의 검',DATE'2023-09-01',DATE'2024-08-31','종료');

-- 왕복 검증:
--   SELECT COUNT(*) FROM project;                              -- 13
--   SELECT section, COUNT(*) FROM project GROUP BY section;     -- 일반계약8·선진행2·사업부관리3
--   SELECT * FROM project WHERE section='선진행';               -- 날짜/상태 NULL
--   INSERT INTO project(section,customer,project_name,status)   -- FK 강제: 코드테이블에 없는 '보류'는 거부됨
--     VALUES('일반계약','데마시아','X','보류');                 -- ERROR 1452 (fk_project_status)
--   조회는 보통 WHERE is_active=1 (소프트삭제 숨김).
--   새 구분/상태는 먼저 코드테이블에 넣어야 project가 참조 가능:
--     INSERT INTO status_code(name,sort_order) VALUES('보류',50);  -- 그 뒤엔 project에서 '보류' 사용 가능
