@echo off
rem ===========================================================================
rem  setup-taskcalendar.cmd - launcher for setup-taskcalendar.ps1
rem  (build the new main DB 'taskcalendar' next to the legacy 'taskmgr':
rem   structure from the DDL files -> user tables from the company seed files
rem   -> the 4 project-track tables copied from taskmgr -> app grants
rem   -> verification report. The legacy DB is only read, never modified.)
rem
rem  ASCII ONLY. Do not put Korean (or any non-ASCII) text in this file.
rem  cmd.exe resumes a batch file by BYTE offset after a child process exits.
rem  Under codepage 65001 that offset is miscomputed when the file contains
rem  multi-byte text, so cmd.exe re-executes fragments of comment lines as
rem  commands (measured on this PC with init-calendar.cmd).
rem  All Korean documentation lives in the setup-taskcalendar.ps1 header.
rem
rem  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
rem    0 ok - taskcalendar built and every verification passed
rem    1 failed - a step after the confirmation failed; see the last red line and the report file
rem    2 cancelled - the confirmation was not Y; nothing was changed
rem    3 preflight failed - tools, files, connection, source tables, target exists or app account; nothing was changed
rem  --- END EXITCODES ---
rem
rem  Usage:
rem    setup-taskcalendar.cmd
rem    setup-taskcalendar.cmd -DbHost 192.168.0.50 -CompanyDataDir "D:\taskmgr-company-data"
rem    setup-taskcalendar.cmd -Force -Yes      (rehearsal: drop an existing target, no prompt)
rem    setup-taskcalendar.cmd -NoShift         (do not shift project-track timestamps KST to UTC)
rem
rem  Do NOT end an argument value with a backslash - powershell.exe reads \"
rem  as an escaped quote and swallows the following argument.
rem ===========================================================================
cd /d "%~dp0"
rem  TC_SETUP_LAUNCHER=cmd tells the .ps1 it was started by this launcher:
rem  this file pauses on failure (below), so the .ps1 pauses only on success.
rem  Without it (the .ps1 run directly) the .ps1 always waits for Enter.
set "TC_SETUP_LAUNCHER=cmd"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-taskcalendar.ps1" %*
set "RC=%ERRORLEVEL%"
if errorlevel 1 pause
exit /b %RC%
