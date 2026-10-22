@echo off
rem ===========================================================================
rem  demo-db.cmd - launcher for demo-db.ps1
rem  (demo database for recording the usage guide videos, GitHub issue #13:
rem   -Load    full mysqldump backup first, then fictional people names,
rem            "(example)" projects and customers, fresh calendar data for the
rem            recording account and three colleagues, in one transaction;
rem   -Restore drop and recreate the DB from the before-demo backup and check
rem            the row counts recorded at load time;
rem   -Status  show whether the DB holds demo data, read only.)
rem
rem  While demo data is loaded, the local DB is demo data for every session
rem  and every widget loop on this PC. Do not record while another session
rem  runs widget loops. Restore when the recording is done.
rem  MySQL accounts and grants are never touched.
rem
rem  ASCII ONLY. Do not put Korean (or any non-ASCII) text in this file.
rem  cmd.exe resumes a batch file by BYTE offset after a child process exits.
rem  Under codepage 65001 that offset is miscomputed when the file contains
rem  multi-byte text, so cmd.exe re-executes fragments of comment lines as
rem  commands (measured on this PC with init-calendar.cmd).
rem  All Korean documentation lives in the demo-db.ps1 header and README.md.
rem
rem  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
rem    0 ok - demo data loaded and verified, the DB was restored and verified, or the status was shown
rem    1 failed - the demo SQL or the restore stopped, or the check afterwards failed; read the printed state and steps
rem    2 cancelled - the confirmation was not Y; nothing was changed
rem    3 precheck failed - tools, password, connection, DB, db_structure_version not 16, recording login, demo state or backup file; nothing was changed
rem    4 app sessions open - the app account is still connected to this DB; close every widget; nothing was changed
rem    5 backup failed - mysqldump failed or the dump is incomplete; the DB was not touched
rem  --- END EXITCODES ---
rem
rem  Usage:
rem    demo-db.cmd -Status
rem    demo-db.cmd -Load                               (login id from the widget session file)
rem    demo-db.cmd -Load -MyLoginId someid -BaseDate 2026-10-19
rem    demo-db.cmd -Restore
rem    demo-db.cmd -Restore -DumpPath "D:\ops\taskcalendar-before-demo-20261019-101500.sql"
rem  The password is never an argument. Unattended runs set the environment
rem  variable TASKMGR_ADMIN_PW, or pipe the password into this file as the
rem  first stdin line together with -Yes (never write a real password into a
rem  script or a log).
rem
rem  Do NOT end an argument value with a backslash - powershell.exe reads \"
rem  as an escaped quote and swallows the following argument.
rem ===========================================================================
cd /d "%~dp0"
rem  TC_DEMO_DB_LAUNCHER=cmd tells the .ps1 it was started by this launcher:
rem  this file pauses on failure (below), so the .ps1 pauses only on success.
rem  Without it (the .ps1 run directly) the .ps1 always waits for Enter.
set "TC_DEMO_DB_LAUNCHER=cmd"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0demo-db.ps1" %*
set "RC=%ERRORLEVEL%"
if errorlevel 1 pause
exit /b %RC%
