@echo off
rem ===========================================================================
rem  migrate-code-ids.cmd - launcher for migrate-code-ids.ps1
rem  (move an existing v12 DB that holds data to v13, code-table number keys:
rem   schema_version check -> app session check -> confirm Y -> mysqldump
rem   backup + verify -> migrate-2026-10-15-code-ids.sql without --force
rem   -> result check, or recovery steps when it stopped.)
rem
rem  Use it for an existing DB with data (for example the PC acting as the
rem  server). A new company server is built with setup-taskcalendar.cmd
rem  instead. A DB that is already v13 is left alone (exit 0).
rem
rem  ASCII ONLY. Do not put Korean (or any non-ASCII) text in this file.
rem  cmd.exe resumes a batch file by BYTE offset after a child process exits.
rem  Under codepage 65001 that offset is miscomputed when the file contains
rem  multi-byte text, so cmd.exe re-executes fragments of comment lines as
rem  commands (measured on this PC with init-calendar.cmd).
rem  All Korean documentation lives in the migrate-code-ids.ps1 header.
rem
rem  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
rem    0 ok - migrated to v13 and verified, or the DB is already v13 (nothing to do)
rem    1 failed - the migration SQL stopped or the result check failed; read the printed recovery steps
rem    2 cancelled - the confirmation was not Y; nothing was changed
rem    3 preflight failed - tools, SQL file, password, connection, DB, schema_version not 12, or not the old shape; nothing was changed
rem    4 app sessions open - the app account is still connected to this DB; close every widget; nothing was changed
rem    5 backup failed - mysqldump failed or the dump is incomplete; the DB was not touched
rem  --- END EXITCODES ---
rem
rem  Usage:
rem    migrate-code-ids.cmd
rem    migrate-code-ids.cmd -DbName taskcalendar_copy      (rehearse on a copy first)
rem    migrate-code-ids.cmd -DbHost 192.168.0.50 -BackupDir "D:\taskmgr-backup"
rem    migrate-code-ids.cmd -Yes                           (unattended: no prompt)
rem  The password is never an argument. Unattended runs set the environment
rem  variable TASKMGR_ADMIN_PW, or pipe the password into this file as the
rem  first stdin line together with -Yes (see the .ps1 header for the exact
rem  form; never write a real password into a script or a log).
rem
rem  Do NOT end an argument value with a backslash - powershell.exe reads \"
rem  as an escaped quote and swallows the following argument.
rem ===========================================================================
cd /d "%~dp0"
rem  TC_MIGRATE_LAUNCHER=cmd tells the .ps1 it was started by this launcher:
rem  this file pauses on failure (below), so the .ps1 pauses only on success.
rem  Without it (the .ps1 run directly) the .ps1 always waits for Enter.
set "TC_MIGRATE_LAUNCHER=cmd"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0migrate-code-ids.ps1" %*
set "RC=%ERRORLEVEL%"
if errorlevel 1 pause
exit /b %RC%
