-- =====================================================================
--  과제관리(Project Management) 최종 확정 스키마
--  MySQL 8.0.16+ / InnoDB / utf8mb4. 로컬 MySQL <-> 사내 서버 MySQL 동일 DDL.
--  실데이터 13건 규모(과설계 금지). 캘린더 위젯 category 소스.
--
--  설계 2축(직교):
--    - 유형(type_code)      = 분류. GENERAL(일반계약) / DIVISION(사업부관리). 선진행은 유형 미확정(NULL).
--    - 단계(lifecycle_stage) = 계약前(pre_contract=선진행) / 계약체결(contracted).
--  계약 사실(시작/종료/상태)은 project 인라인 nullable + CHECK로 '단계 불변식' 강제(플래그 아님).
--  categoryId 앵커 uid = 'prj_'+SHA2(발주처|사업명)[:16] : 콜론불가·결정론적·로컬/서버 동일.
--  룩업 PK는 code(문자)로 → auto_increment id 로컬/서버 상이 문제 원천 차단.
-- =====================================================================
SET NAMES utf8mb4;
-- CREATE DATABASE IF NOT EXISTS taskmgr CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; USE taskmgr;

-- ---------- 발주처 마스터 (시트 View_Customer, 8건) ----------
CREATE TABLE customer (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='발주처(고객) 마스터. name=ETL 자연키. 데마시아는 3섹션 공유 -> 1행.';

-- ---------- 유형(분류) 축 룩업 : code가 PK(로컬/서버 동일값) ----------
CREATE TABLE project_type (
  code          VARCHAR(32) NOT NULL,   -- 'GENERAL' | 'DIVISION'
  label         VARCHAR(50) NOT NULL,   -- '일반 계약 사업' | '사업부 관리 사업'
  default_color CHAR(7)     NOT NULL DEFAULT '#3E5BE0',
  sort_order    SMALLINT    NOT NULL DEFAULT 0,
  is_active     TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (code),
  UNIQUE KEY uq_project_type_label (label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='과제 유형(분류) 축. 선진행은 유형 미확정(NULL)이라 여기에 없음.';

-- ---------- 상태 도메인 룩업 : 확장형(1차->2차 납품완료 등 행 추가로 무중단) ----------
CREATE TABLE project_status (
  code        VARCHAR(32) NOT NULL,     -- 'ONGOING','CLOSED','DELIVERED_1','TBD',...
  label       VARCHAR(50) NOT NULL,     -- '진행중','종료','1차 납품완료','미정'
  sort_order  SMALLINT    NOT NULL DEFAULT 0,
  is_terminal TINYINT(1)  NOT NULL DEFAULT 0,  -- 종료류(캘린더 숨김/집계 판단)
  is_active   TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (code),
  UNIQUE KEY uq_project_status_label (label)   -- ETL이 한글 라벨로 해석/자동 온보딩
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='계약 체결 과제의 상태 도메인. 선진행(계약前)은 status NULL.';

-- ---------- 과제(핵심 엔티티). 계약 인라인 + 단계 CHECK ----------
CREATE TABLE project (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,  -- 내부 PK(외부 비노출, 로컬/서버 상이 허용)
  uid                 VARCHAR(80)  NOT NULL,   -- 캘린더 categoryId 앵커. 콜론불가. 결정론적.
  source_key          VARCHAR(255) NOT NULL,   -- ETL 멱등 자연키 = 발주처 + US(0x1F) + 사업명
  source_seq          INT          NULL,       -- 원본 'No'(섹션내 순번, 무의미/감사용)

  customer_id         INT UNSIGNED NOT NULL,
  type_code           VARCHAR(32)  NULL,        -- 유형 축. 선진행=NULL(유형 미확정)
  lifecycle_stage     ENUM('pre_contract','contracted') NOT NULL,  -- 단계 축(선진행=pre_contract)

  project_name        VARCHAR(200) NOT NULL,    -- 사업명
  contract_name       VARCHAR(200) NULL,        -- 계약명(선진행도 있음)
  common_name         VARCHAR(200) NULL,        -- 통상명칭(캘린더 라벨 1순위)

  contract_start_date DATE         NULL,        -- '미정'/공백 -> NULL
  contract_end_date   DATE         NULL,
  status_code         VARCHAR(32)  NULL,        -- 선진행이면 NULL

  calendar_color      CHAR(7)      NULL,        -- 캘린더 색 힌트(#RRGGBB). 로컬 override 가능
  is_active           TINYINT(1)   NOT NULL DEFAULT 1,  -- 선택목록 노출(soft-archive; 하드삭제 금지)

  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_project_uid        (uid),
  UNIQUE KEY uq_project_source_key (source_key),
  KEY ix_project_customer (customer_id),
  KEY ix_project_type     (type_code),
  KEY ix_project_status   (status_code),
  KEY ix_project_active   (is_active),

  CONSTRAINT fk_project_customer FOREIGN KEY (customer_id) REFERENCES customer(id),
  CONSTRAINT fk_project_type     FOREIGN KEY (type_code)   REFERENCES project_type(code),
  CONSTRAINT fk_project_status   FOREIGN KEY (status_code) REFERENCES project_status(code),

  -- 캘린더 XML import 검증기(/^[A-Za-z0-9_-]{1,80}$/)와 동일 규칙 이중 방어(콜론 원천 차단)
  CONSTRAINT chk_project_uid   CHECK (uid REGEXP '^[A-Za-z0-9_-]{1,80}$'),
  CONSTRAINT chk_project_color CHECK (calendar_color IS NULL OR calendar_color REGEXP '^#[0-9A-Fa-f]{6}$'),

  -- ★핵심: 단계(선진행 vs 계약체결)를 계약 사실 nullability와 묶어 '구조'로 강제(플래그 아님)
  CONSTRAINT chk_project_stage CHECK (
      (lifecycle_stage = 'pre_contract'
         AND contract_start_date IS NULL
         AND contract_end_date   IS NULL
         AND status_code         IS NULL)
   OR (lifecycle_stage = 'contracted'
         AND contract_start_date IS NOT NULL
         AND contract_end_date   IS NOT NULL
         AND type_code           IS NOT NULL
         AND status_code         IS NOT NULL)   -- '미정'(TBD)도 유효 status -> NULL(계약前)과 구분
  ),
  CONSTRAINT chk_project_dates CHECK (
      contract_end_date IS NULL OR contract_start_date IS NULL
   OR contract_end_date >= contract_start_date
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='과제 마스터. 유형(type_code) x 단계(lifecycle_stage) 직교. 선진행=계약前(날짜/상태/유형 NULL).';

-- =====================================================================
--  뷰
-- =====================================================================
-- 캘린더 '선택가능 목록' : 로컬 category 모델 {id,name,color,gitRepo,vcs,desc,createdAt} 형상
CREATE OR REPLACE VIEW v_calendar_category AS
SELECT
  p.uid                                                   AS id,
  COALESCE(NULLIF(p.common_name,''), p.project_name)      AS name,
  COALESCE(p.calendar_color, pt.default_color, '#3E5BE0') AS color,
  CAST(NULL AS CHAR)                                      AS gitRepo,  -- 캘린더 로컬 소유(과제 DB 무관)
  CAST(NULL AS CHAR)                                      AS vcs,      -- 캘린더 로컬 소유
  CONCAT_WS(' / ', c.name, p.project_name, p.contract_name) AS `desc`,
  p.created_at                                           AS createdAt,
  -- 부가(그룹핑/뱃지/클라이언트 필터용)
  p.type_code, pt.label AS type_label,
  p.lifecycle_stage     AS stage,
  p.status_code, ps.label AS status_label,
  COALESCE(ps.is_terminal, 0) AS is_terminal
FROM project p
JOIN customer c ON c.id = p.customer_id
LEFT JOIN project_type   pt ON pt.code = p.type_code
LEFT JOIN project_status ps ON ps.code = p.status_code
WHERE p.is_active = 1;
-- 선택 목록:        SELECT id,name,color FROM v_calendar_category ORDER BY name;
-- (종료 숨김 원하면) SELECT id,name,color FROM v_calendar_category WHERE is_terminal=0 ORDER BY name;

-- 캘린더 '과거 categoryId -> 라벨 해석' : is_active/종료 무관 전량(앵커 영구 해석)
CREATE OR REPLACE VIEW v_project_label AS
SELECT
  p.uid AS id,
  COALESCE(NULLIF(p.common_name,''), p.project_name)      AS name,
  COALESCE(p.calendar_color, pt.default_color, '#3E5BE0') AS color,
  c.name AS customer_name, p.project_name, p.contract_name,
  p.type_code, pt.label AS type_label,
  p.lifecycle_stage AS stage,
  p.status_code, ps.label AS status_label,
  p.is_active
FROM project p
JOIN customer c ON c.id = p.customer_id
LEFT JOIN project_type   pt ON pt.code = p.type_code
LEFT JOIN project_status ps ON ps.code = p.status_code;
-- 과거 라벨:  SELECT id,name,color FROM v_project_label WHERE id = ?;  (종료/아카이브도 항상 해석)

-- 원본 시트 복원/왕복 검증 : 13행(일반8+선진행2+사업부3), 선진행은 status='선진행'/날짜 NULL
CREATE OR REPLACE VIEW v_project_full AS
SELECT
  p.source_seq, c.name AS orderer,
  p.project_name AS biz_name, p.contract_name, p.common_name,
  CASE p.lifecycle_stage WHEN 'pre_contract' THEN '선진행'
       ELSE COALESCE(pt.label,'(미분류)') END AS section_type,
  CASE WHEN p.lifecycle_stage='pre_contract' THEN '선진행' ELSE ps.label END AS status,
  p.contract_start_date, p.contract_end_date, p.uid
FROM project p
JOIN customer c ON c.id = p.customer_id
LEFT JOIN project_type   pt ON pt.code = p.type_code
LEFT JOIN project_status ps ON ps.code = p.status_code;

-- =====================================================================
--  시드(멱등) — 룩업/발주처
-- =====================================================================
INSERT INTO project_type (code,label,default_color,sort_order) VALUES
  ('GENERAL','일반 계약 사업','#3E5BE0',10),
  ('DIVISION','사업부 관리 사업','#8A5CF6',20)
ON DUPLICATE KEY UPDATE label=VALUES(label), default_color=VALUES(default_color), sort_order=VALUES(sort_order);

INSERT INTO project_status (code,label,sort_order,is_terminal) VALUES
  ('ONGOING','진행중',10,0),
  ('DELIVERED_1','1차 납품완료',20,0),
  ('DELIVERED_2','2차 납품완료',21,0),   -- 확장 예시: DDL ALTER 없이 '행 추가'로 무중단 확장
  ('TBD','미정',30,0),
  ('CLOSED','종료',90,1)
ON DUPLICATE KEY UPDATE label=VALUES(label), sort_order=VALUES(sort_order), is_terminal=VALUES(is_terminal);

INSERT INTO customer (name) VALUES
  ('데마시아'),('노크사스'),('요르드'),('필리오니아'),
  ('아이오니아'),('빌지조트'),('셔마야'),('불타오르는 대지')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- =====================================================================
--  시드(멱등) — 과제 13건. uid=CONCAT('prj_',LEFT(SHA2(발주처||0x1F||사업명,256),16)).
--  ETL(파이썬)과 이 SQL이 동일 바이트열을 SHA2-256 하면 동일 uid로 수렴 -> 로컬/서버 자동 일치.
--  ON DUPLICATE에서 uid/source_key는 갱신 제외(assign-once) -> 재적재해도 앵커/ id 불변.
-- =====================================================================
INSERT INTO project
  (uid, source_key, source_seq, customer_id, type_code, lifecycle_stage,
   project_name, contract_name, common_name,
   contract_start_date, contract_end_date, status_code)
SELECT
  CONCAT('prj_', LEFT(SHA2(v.sk,256),16)),
  v.sk, v.seq, c.id, v.type_code, v.stage,
  v.biz, v.cname, v.common, v.sd, v.ed, v.st
FROM (
  SELECT o AS orderer, biz, CONCAT(o, CHAR(31), biz) AS sk,
         seq, type_code, stage, cname, common, sd, ed, st
  FROM (
    -- [섹션1] 일반 계약 사업 (No 1~8, contracted)
    SELECT '데마시아' o,'자르반 2세 정복 작전' biz,1 seq,'GENERAL' type_code,'contracted' stage,'빛의 검 강화 용역' cname,'자르반의 검' common,DATE'2023-01-10' sd,DATE'2024-06-30' ed,'CLOSED' st
    UNION ALL SELECT '노크사스','스윈의 침략 방어 체계 구축',2,'GENERAL','contracted','전쟁 여신 무기 개발 용역','노크사스의 분노',DATE'2023-03-15',DATE'2025-02-28','ONGOING'
    UNION ALL SELECT '요르드','바르드 하모니 복원 사업',3,'GENERAL','contracted','고요의 음악 수집 용역','바르드의 노래',DATE'2022-07-01',DATE'2023-12-31','CLOSED'
    UNION ALL SELECT '필리오니아','아리 그림자 무술 훈련소 건립',4,'GENERAL','contracted','키스사기 기술 이전 용역','아리의 키스',DATE'2024-01-05',DATE'2026-08-20','ONGOING'
    UNION ALL SELECT '아이오니아','아리 고국 방벽 강화',5,'GENERAL','contracted','그림자 무술 교육 용역','아이오니아 방패',DATE'2023-06-01',DATE'2025-05-31','DELIVERED_1'
    UNION ALL SELECT '빌지조트','트런드 해골 검 수리',6,'GENERAL','contracted','피마신 유지보수 용역','트런드의 톱',DATE'2022-11-10',DATE'2023-11-09','CLOSED'
    UNION ALL SELECT '셔마야','네코 정령 소환 시스템 구축',7,'GENERAL','contracted','고양이 귀 장착 용역','네코의 꼬리',DATE'2024-04-01',DATE'2026-03-31','ONGOING'
    UNION ALL SELECT '불타오르는 대지','비스트 화염 저항 장비 개발',8,'GENERAL','contracted','용의 숨 막기 용역','비스트의 불',DATE'2025-01-15',DATE'2027-12-31','TBD'
    -- [섹션2] 선진행 사업 (No 9~10, pre_contract): 유형/날짜/상태 NULL
    UNION ALL SELECT '데마시아','가렌 방패 업그레이드',9,NULL,'pre_contract','빛의 검 2차 강화 용역','가렌의 방패',NULL,NULL,NULL
    UNION ALL SELECT '요르드','뺀비 폭죽 안전 기준 마련',10,NULL,'pre_contract','폭죽 제조 허가 용역','뺀비의 폭죽',NULL,NULL,NULL
    -- [섹션3] 사업부 관리 사업 (No 1부터 재시작 -> source_seq만; 자연키=발주처+사업명이라 무충돌)
    UNION ALL SELECT '데마시아','리안돈 성벽 보수',1,'DIVISION','contracted','성벽 설계 용역','리안돈 성벽',DATE'2023-05-01',DATE'2024-04-30','CLOSED'
    UNION ALL SELECT '데마시아','카르마 영적 훈련 프로그램',2,'DIVISION','contracted','다섯 번째 인시그니아 연구 용역','카르마의 빛',DATE'2024-02-01',DATE'2026-01-31','ONGOING'
    UNION ALL SELECT '데마시아','타리온 빛의 검 연마',3,'DIVISION','contracted','쌍검 동기화 용역','타리온의 검',DATE'2023-09-01',DATE'2024-08-31','CLOSED'
  ) s
) v
JOIN customer c ON c.name = v.orderer
ON DUPLICATE KEY UPDATE
  source_seq=VALUES(source_seq), customer_id=VALUES(customer_id),
  type_code=VALUES(type_code), lifecycle_stage=VALUES(lifecycle_stage),
  project_name=VALUES(project_name), contract_name=VALUES(contract_name),
  common_name=VALUES(common_name), contract_start_date=VALUES(contract_start_date),
  contract_end_date=VALUES(contract_end_date), status_code=VALUES(status_code);
  -- uid, source_key는 갱신 제외 -> 재적재해도 categoryId 앵커 불변, id 재채번 없음.

-- 왕복 검증: SELECT * FROM v_project_full;                     -- 13행, 선진행 2건 status='선진행'/날짜 NULL
--           SELECT id,name,color FROM v_calendar_category;      -- 선택 목록(is_active=1 전량)
--           SELECT id,name FROM v_project_label WHERE id='prj_...'; -- 종료/아카이브도 라벨 해석