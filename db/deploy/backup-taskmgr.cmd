@echo off
rem ===========================================================================
rem  backup-taskmgr.cmd - launcher for backup-taskmgr.ps1 (weekly mysqldump)
rem
rem  ASCII ONLY. Do not put Korean (or any non-ASCII) text in this file.
rem  cmd.exe resumes a batch file by BYTE offset after a child process exits.
rem  Under codepage 65001 that offset is miscomputed when the file contains
rem  multi-byte text, so cmd.exe re-executes fragments of comment lines as
rem  commands (measured on this PC with init-calendar.cmd).
rem
rem  All Korean documentation lives where it is actually read:
rem    - backup-taskmgr.ps1 header : what it does, parameters, exit codes,
rem                                  why the dump content is compared to the DB
rem    - create-backup-user.sql    : the backup account and why SELECT alone
rem                                  silently produces a trigger-less dump
rem    - db/deploy/README.md       : deploy order
rem
rem  Exit codes (must match the ps1 header table):
rem    0 ok | 1 backup failed or verification mismatch (file kept as .partial)
rem    2 config problem (.cnf missing / backup folder cannot be created)
rem    3 connection or privilege problem (no SELECT+TRIGGER on the database)
rem    4 mysqldump.exe / mysql.exe not found
rem    5 administrator rights required (-Install / -Uninstall)
rem
rem  Usage:
rem    backup-taskmgr.cmd
rem    backup-taskmgr.cmd -BackupDir "E:\backup" -Keep 12
rem    backup-taskmgr.cmd -Status
rem    backup-taskmgr.cmd -Install      (run as Administrator)
rem    backup-taskmgr.cmd -Uninstall    (run as Administrator)
rem
rem  Do NOT end an argument value with a backslash - powershell.exe reads \"
rem  as an escaped quote and swallows the following argument.
rem ===========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-taskmgr.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%
