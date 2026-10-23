-- =====================================================================
--  dev-dates-from-contract.sql: 기존 과제의 개발 시작일, 개발 종료일을 계약 날짜에서 한 번 채운다
--  (2026-10-23 사용자 결정, docs/MONTHLY-REPORT-PLAN.md §6.5)
-- =====================================================================
--
--  규칙(관리 창의 공식 과제 폼과 같다. 화면 쪽은 task-calendar-prototype.html 의 offEdAutoDev):
--    개발 시작일 = 계약 시작일 + 1달, 개발 종료일 = 계약 종료일 - 1달.
--    그 달에 같은 날이 없으면 그 달 말일이다(DATE_ADD/DATE_SUB INTERVAL 1 MONTH. 01-31 + 1달 = 02-28, 윤년은 02-29).
--    채운 결과가 시작 > 종료면 채우지 않는다(CHECK chk_project_dev_dates 가 막는다). 아래 마지막 SELECT 에 이유와 함께 나온다.
--
--  고치는 행: 개발 시작일과 개발 종료일이 **둘 다 NULL** 이고, 계약 시작일과 계약 종료일이 **둘 다 있고**,
--    계산한 개발 시작일 <= 개발 종료일인 행만. 숨긴 과제(is_active = 0)도 같은 규칙으로 채운다.
--
--  다시 돌려도 안전하다: 개발 날짜가 둘 다 NULL 인 행만 건드리므로, 한 번 채운 행이나 사람이 한쪽이라도 넣은 행은 다시 바뀌지 않는다.
--  구조 번호를 올리지 않는다: 값만 채우고 표 모양은 그대로다(cal_schema_meta 를 건드리지 않는다).
--  필요한 구조: 17 이상(project.dev_start_date 칸, 이관 조각 v17-monthly-report.sql). 16 이하 DB 에서는 첫 SELECT 가
--    ERROR 1054(Unknown column 'dev_start_date')로 멈추고 아무것도 바꾸지 않는다.
--
--  실행: Workbench 에서 앱 계정(taskmgr_app)으로 열고 위에서부터 한 문장씩 또는 통째로 돌린다.
--    필요한 권한은 project 의 SELECT, UPDATE 뿐이다. 저장 프로그램과 DELIMITER 를 쓰지 않는다.
--    1) 미리 보기 SELECT 로 바뀔 행을 확인한다. 2) START TRANSACTION, UPDATE, COMMIT.
--    3) 결과 SELECT 로 확인한다. 4) 건너뛴 과제 SELECT 로 손으로 넣을 과제를 본다.
--    UPDATE 의 WHERE 에 `id > 0` 을 둔 것은 Workbench 의 안전 갱신 모드(Error 1175)를 지나기 위해서다(모든 행이 참이다).
--
--  이 파일은 배포 SQL(release-v<버전>.sql)에 묶이지 않는다. 묶이는 것은 db/deploy/migrations/ 의 이관 조각뿐이다.
-- =====================================================================

USE taskcalendar;

-- 1) 미리 보기: 바뀔 행
SELECT id,
       project_name,
       start_date,
       end_date,
       DATE_ADD(start_date, INTERVAL 1 MONTH) AS new_dev_start_date,
       DATE_SUB(end_date, INTERVAL 1 MONTH)   AS new_dev_end_date
  FROM project
 WHERE dev_start_date IS NULL
   AND dev_end_date IS NULL
   AND start_date IS NOT NULL
   AND end_date IS NOT NULL
   AND DATE_ADD(start_date, INTERVAL 1 MONTH) <= DATE_SUB(end_date, INTERVAL 1 MONTH)
 ORDER BY id;

-- 2) 채우기(미리 보기와 같은 조건)
START TRANSACTION;

UPDATE project
   SET dev_start_date = DATE_ADD(start_date, INTERVAL 1 MONTH),
       dev_end_date   = DATE_SUB(end_date, INTERVAL 1 MONTH)
 WHERE id > 0
   AND dev_start_date IS NULL
   AND dev_end_date IS NULL
   AND start_date IS NOT NULL
   AND end_date IS NOT NULL
   AND DATE_ADD(start_date, INTERVAL 1 MONTH) <= DATE_SUB(end_date, INTERVAL 1 MONTH);

COMMIT;

-- 3) 결과: 개발 날짜가 계약 날짜에서 한 달씩 안쪽인 행(이번에 채운 행과, 앞서 같은 규칙으로 채운 행)
SELECT id,
       project_name,
       start_date,
       end_date,
       dev_start_date,
       dev_end_date
  FROM project
 WHERE dev_start_date = DATE_ADD(start_date, INTERVAL 1 MONTH)
   AND dev_end_date = DATE_SUB(end_date, INTERVAL 1 MONTH)
 ORDER BY id;

-- 4) 건너뛴 과제와 이유(개발 날짜가 둘 다 비어 있는데 채우지 못한 행). 손으로 넣는다.
SELECT id,
       project_name,
       start_date,
       end_date,
       CASE
         WHEN start_date IS NULL AND end_date IS NULL THEN '계약 시작일과 계약 종료일이 없음'
         WHEN start_date IS NULL THEN '계약 시작일이 없음'
         WHEN end_date IS NULL THEN '계약 종료일이 없음'
         ELSE '계약 기간이 짧아 개발 시작이 개발 종료보다 늦음'
       END AS skip_reason
  FROM project
 WHERE dev_start_date IS NULL
   AND dev_end_date IS NULL
   AND NOT (start_date IS NOT NULL
            AND end_date IS NOT NULL
            AND DATE_ADD(start_date, INTERVAL 1 MONTH) <= DATE_SUB(end_date, INTERVAL 1 MONTH))
 ORDER BY id;
