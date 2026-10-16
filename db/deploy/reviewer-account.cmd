@echo off
rem ===========================================================================
rem  reviewer-account.cmd - launcher for reviewer-account.ps1
rem  (create a read-only MySQL account for an external reviewer:
rem   '<user>'@'<reviewer IP>' with SELECT, SHOW VIEW on one DB only,
rem   verified with SHOW GRANTS (rolled back by DROP USER on mismatch), plus an
rem   inbound firewall rule for that IP when this window runs as administrator.)
rem
rem  Only MySQL account and grant metadata change. No table or row of the DB
rem  changes. The account can read every table of the DB: the calendar data
rem  of every employee. Drop it when the review is over (-Drop).
rem
rem  Right-click this file and choose "Run as administrator" so that the
rem  firewall rule can be created. Without it the account is still created
rem  and the exact New-NetFirewallRule command is printed instead.
rem
rem  ASCII ONLY. Do not put Korean (or any non-ASCII) text in this file.
rem  cmd.exe resumes a batch file by BYTE offset after a child process exits.
rem  Under codepage 65001 that offset is miscomputed when the file contains
rem  multi-byte text, so cmd.exe re-executes fragments of comment lines as
rem  commands (measured on this PC with init-calendar.cmd).
rem  All Korean documentation lives in the reviewer-account.ps1 header.
rem
rem  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
rem    0 ok - the account was created (or its password reset, or it was dropped, or listed) and verified
rem    1 account step failed - CREATE/GRANT/ALTER/DROP or the grant check failed; a newly created account was dropped again (rolled back)
rem    2 cancelled - the confirmation was not Y; nothing was changed
rem    3 precheck failed - bad -ReviewerIp or -UserName, tools, password, connection, DB, or the account already exists without -ResetPassword; nothing was changed
rem    6 firewall step failed - the account step succeeded but the firewall rule was not created or removed; run the printed command in an administrator PowerShell
rem  --- END EXITCODES ---
rem
rem  Usage:
rem    reviewer-account.cmd -ReviewerIp 192.168.16.25
rem    reviewer-account.cmd -ReviewerIp 192.168.16.%        (any PC of that /24)
rem    reviewer-account.cmd -ReviewerIp 192.168.16.25 -ResetPassword
rem    reviewer-account.cmd -List
rem    reviewer-account.cmd -Drop -ReviewerIp 192.168.16.25
rem    reviewer-account.cmd -AllowLocal -ReviewerIp 127.0.0.1 -NoFirewall   (local rehearsal)
rem  Typed at a command prompt, 192.168.16.% passes as is. Inside another
rem  batch file write it as 192.168.16.%% (cmd.exe expands a single %).
rem  Passwords are never arguments. Unattended runs set TASKMGR_ADMIN_PW and
rem  TASKMGR_REVIEWER_PW and add -Yes (see the .ps1 header; never write a
rem  real password into a script or a log).
rem
rem  Do NOT end an argument value with a backslash - powershell.exe reads \"
rem  as an escaped quote and swallows the following argument.
rem ===========================================================================
cd /d "%~dp0"
rem  TC_REVIEWER_LAUNCHER=cmd tells the .ps1 it was started by this launcher:
rem  this file pauses on failure (below), so the .ps1 pauses only on success.
rem  Without it (the .ps1 run directly) the .ps1 always waits for Enter.
set "TC_REVIEWER_LAUNCHER=cmd"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reviewer-account.ps1" %*
set "RC=%ERRORLEVEL%"
if errorlevel 1 pause
exit /b %RC%
