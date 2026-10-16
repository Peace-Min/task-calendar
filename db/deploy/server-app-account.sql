-- 회사 서버에 앱 접속 계정(taskmgr_app)을 만들고 taskcalendar 권한을 준다.
-- 언제: taskcalendar 를 개발 PC 에서 통째로 떠서 서버에 부은 직후, 한 번.
-- 어떻게: 아래 비밀번호를 앱 배포 설정의 DbPassword 와 같은 값으로 바꾼 뒤
--   mysql -u root -p < server-app-account.sql
--   (서버 root 가 auth_socket 이면 sudo mysql < server-app-account.sql)
-- 권한은 2026-10-16 개발 PC 의 SHOW GRANTS(taskcalendar 분) 그대로다.
-- cal_entry_commit, cal_todo_day_note, cal_room 에 UPDATE 가 없는 것은 의도다(앱은 지우고 다시 넣는다).
-- 파일에 바꾼 비밀번호를 남기지 말 것. 실행 뒤 이 줄을 다시 자리표시로 되돌린다.

CREATE USER IF NOT EXISTS 'taskmgr_app'@'%' IDENTIFIED BY 'CHANGE_ME_ON_DEPLOY';

GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`app_user` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_attendance` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_category` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, DELETE ON `taskcalendar`.`cal_entry_commit` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, DELETE ON `taskcalendar`.`cal_entry_except` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_entry` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT ON `taskcalendar`.`cal_migration_log` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE ON `taskcalendar`.`cal_report_daily` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_report_hours` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE ON `taskcalendar`.`cal_report_weekly` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, DELETE ON `taskcalendar`.`cal_room` TO 'taskmgr_app'@'%';
GRANT SELECT ON `taskcalendar`.`cal_schema_meta` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_task_hours` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, DELETE ON `taskcalendar`.`cal_todo_day_note` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_todo` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_user_pref` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`cal_user_rev` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`customer` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE ON `taskcalendar`.`org_unit` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`project` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`section_code` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`.`status_code` TO 'taskmgr_app'@'%';
GRANT SELECT, INSERT, UPDATE ON `taskcalendar`.`title_code` TO 'taskmgr_app'@'%';

SHOW GRANTS FOR 'taskmgr_app'@'%';
