-- ============================================================================
-- 마이그레이션: 이름 기반 유니크 제거 + 계약명/통상명칭 NOT NULL DEFAULT ''
--   (근거: db/TABLE-DESIGN.md §4 · ARCHITECTURE ADR-21 — 실데이터 144건 검수)
--
--   ★ 최초 구축은 schema.sql(또는 deploy/schema-structure.sql)로 한다.
--     이 스크립트는 '이미 데이터가 들어 있는 기존 DB'를 재구축 없이 새 설계로 맞추는 1회용이다.
--   ⚠️ 멱등(idempotent) 아님 — 이미 적용된 DB에 다시 돌리면 DROP INDEX 단계에서 에러(존재하지 않는 인덱스)가 난다.
--      그 에러는 '이미 적용됨'을 뜻하니 무시해도 되지만, 재실행을 전제로 만들지 않았다.
--
--   적용:  mysql -u root -p taskmgr < migrate-2026-07-24-uniqueness.sql
--   무손실: 데이터 행은 건드리지 않는다(값 변경은 NULL→'' 정규화뿐, 인덱스/컬럼 제약만 조정).
-- ============================================================================

-- 1) NOT NULL 전환 전, 기존 NULL을 ''로 채운다(그대로 두면 MODIFY가 실패한다).
UPDATE project SET contract_name = '' WHERE contract_name IS NULL;
UPDATE project SET common_name   = '' WHERE common_name   IS NULL;

-- 2) 이름 기반 하드 유니크 제거(구성품별 계약·연도별 갱신이 정당한 중복이라 도메인과 충돌).
--    uq_project_uid(uid)와 조회용 ix_project_customer(customer)는 유지한다.
ALTER TABLE project DROP INDEX uq_project;

-- 3) 계약명/통상명칭을 NOT NULL DEFAULT ''로(빈값은 '' — NULL 금지, 비교 함정 방지).
ALTER TABLE project
  MODIFY contract_name VARCHAR(200) NOT NULL DEFAULT '',
  MODIFY common_name   VARCHAR(200) NOT NULL DEFAULT '';

-- 확인(선택):
--   SHOW INDEX FROM project;                    -- uq_project 가 없어야 함, uq_project_uid 는 있어야 함
--   SHOW COLUMNS FROM project LIKE 'contract_name';   -- Null=NO, Default=''
