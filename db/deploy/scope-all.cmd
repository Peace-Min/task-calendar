@echo off
rem ===========================================================================
rem  scope-all.cmd - launcher for scope-all.ps1
rem  (set app_user.view_scope = 'all' for every row of the calendar DB,
rem   active and inactive: precheck -> show the current distribution ->
rem   confirm Y -> write and verify a revert .sql -> one transaction with an
rem   affected-row check -> verify that no row is left that is not 'all'.)
rem
rem  Only view_scope changes. edit_role and every other column stay as they
rem  are. Run it again after setup-taskcalendar builds a new server, and
rem  after new employees were registered with the scope left at self.
rem
rem  ASCII ONLY. Do not put Korean (or any non-ASCII) text in this file.
rem  cmd.exe resumes a batch file by BYTE offset after a child process exits.
rem  Under codepage 65001 that offset is miscomputed when the file contains
rem  multi-byte text, so cmd.exe re-executes fragments of comment lines as
rem  commands (measured on this PC with init-calendar.cmd).
rem  All Korean documentation lives in the scope-all.ps1 header.
rem
rem  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
rem    0 ok - every app_user row now has view_scope 'all', or every row already had it (nothing to do)
rem    1 update failed - the UPDATE did not commit (rolled back), or the check after the commit failed; read the printed state
rem    2 cancelled - the confirmation was not Y; nothing was changed
rem    3 precheck failed - tools, password, connection, DB, app_user table or its columns; nothing was changed
rem    5 revert file failed - the revert .sql could not be written or verified; nothing was changed
rem  --- END EXITCODES ---
rem
rem  Usage:
rem    scope-all.cmd
rem    scope-all.cmd -DbName taskcalendar_copy      (rehearse on a copy first)
rem    scope-all.cmd -DbHost 192.168.0.50 -OutDir "D:\taskmgr-ops"
rem    scope-all.cmd -Yes                           (unattended: no prompt)
rem  The password is never an argument. Unattended runs set the environment
rem  variable TASKMGR_ADMIN_PW, or pipe the password into this file as the
rem  first stdin line together with -Yes (see the .ps1 header for the exact
rem  form; never write a real password into a script or a log).
rem
rem  Do NOT end an argument value with a backslash - powershell.exe reads \"
rem  as an escaped quote and swallows the following argument.
rem ===========================================================================
cd /d "%~dp0"
rem  TC_SCOPE_ALL_LAUNCHER=cmd tells the .ps1 it was started by this launcher:
rem  this file pauses on failure (below), so the .ps1 pauses only on success.
rem  Without it (the .ps1 run directly) the .ps1 always waits for Enter.
set "TC_SCOPE_ALL_LAUNCHER=cmd"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scope-all.ps1" %*
set "RC=%ERRORLEVEL%"
if errorlevel 1 pause
exit /b %RC%
