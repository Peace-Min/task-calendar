-- 회사 서버에 앱 접속 계정(taskmgr_app)을 만들고 taskcalendar 권한을 준다.
-- 언제: taskcalendar 를 개발 PC 에서 통째로 떠서 서버에 부은 직후, 한 번.
-- 어떻게: 아래 비밀번호를 앱 배포 설정의 DbPassword 와 같은 값으로 바꾼 뒤
--   mysql -u root -p < server-app-account.sql
--   (서버 root 가 auth_socket 이면 sudo mysql < server-app-account.sql)
-- 권한은 2026-10-16 개발 PC 의 SHOW GRANTS(taskcalendar 분) 그대로다.
-- cal_todo_day_note 에 UPDATE 가 없는 것은 의도다(앱은 지우고 다시 넣는다).
-- 2026-10-21 회의실 공용화(구조 번호 15): cal_room 을 지우고 room_code 를 더했다(docs/SHARED-ROOMS.md).
-- 2026-10-22 과제 캘린더(구조 번호 16): cal_project_ 표 둘을 더했다. 둘 다 DELETE 없음(docs/PROJECT-CALENDAR-PLAN.md §4.6).
-- 2026-10-22 월간보고(구조 번호 17): project_schedule_image 를 더했다. 그림 삭제가 실제 행 삭제라 DELETE 까지(docs/MONTHLY-REPORT-PLAN.md §6.4).
--   그림은 사람마다 따로다(2026-10-23). 행을 가르는 것은 앱(세션의 사람)이고 권한은 그대로다.
-- 2026-10-26 Git, SVN 삭제(구조 번호 18): cal_entry_commit 을 지웠다. 그 GRANT 줄도 뺐다(docs/GIT-SVN-REMOVAL.md §2).
-- 파일에 바꾼 비밀번호를 남기지 말 것. 실행 뒤 이 줄을 다시 자리표시로 되돌린다.

CREATE USER IF NOT EXISTS 'taskmgr_app'@'%' IDENTIFIED BY 'CHANGE_ME_ON_DEPLOY';

GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`app_user` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_attendance` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_category` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, DELETE ON `taskcalendar`.`cal_entry_except` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_entry` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT ON `taskcalendar`.`cal_migration_log` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT ON `taskcalendar`.`cal_project_change` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE ON `taskcalendar`.`cal_project_event` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE ON `taskcalendar`.`cal_report_daily` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_report_hours` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE ON `taskcalendar`.`cal_report_weekly` TO 'taskmgr_app'@'%';
GRANT SELECT ON `taskcalendar`.`cal_schema_meta` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_task_hours` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, DELETE ON `taskcalendar`.`cal_todo_day_note` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_todo` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_user_pref` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_user_rev` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`customer` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE ON `taskcalendar`.`org_unit` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`project` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`project_schedule_image` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`room_code` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`section_code` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`status_code` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE ON `taskcalendar`.`title_code` TO 'taskmgr_app'@'%';

SHOW GRANTS FOR 'taskmgr_app'@'%';
