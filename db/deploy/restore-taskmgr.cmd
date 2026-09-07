@echo off
rem ===========================================================================
rem  restore-taskmgr.cmd - launcher for restore-taskmgr.ps1 (dump restore + drill)
rem
rem  ASCII ONLY. Do not put Korean (or any non-ASCII) text in this file.
rem  cmd.exe resumes a batch file by BYTE offset after a child process exits.
rem  Under codepage 65001 that offset is miscomputed when the file contains
rem  multi-byte text, so cmd.exe re-executes fragments of comment lines as
rem  commands (measured on this PC with init-calendar.cmd).
rem
rem  All Korean documentation lives where it is actually read:
rem    - restore-taskmgr.ps1 header : what it does, parameters, exit codes,
rem                                   why the live-overwrite guard needs typing
rem    - backup-taskmgr.ps1 header  : the other half of the pair (dump + verify)
rem    - db/deploy/README.md        : restore procedure and the drill record
rem
rem  The live-overwrite guard lives in the ps1, not here. A launcher cannot
rem  protect anything - anyone can call powershell.exe directly.
rem
rem  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
rem    0 ok - restored and every verification passed (-WhatIf / -DropTarget success is 0 too)
rem    1 restore or verification failed - the target DB is left in place for diagnosis
rem    2 config problem - dump missing/unreadable, pre-restore safety dump failed, .cnf problem
rem    3 connection or privilege problem - cannot connect, or the admin account cannot CREATE/GRANT
rem    4 mysql.exe / mysqldump.exe not found
rem    5 administrator rights required - reserved, same meaning as backup-taskmgr (never returned here)
rem    6 refused - live-overwrite guard tripped; nothing was changed
rem    7 cannot verify - no live baseline to compare against; this is NOT a pass
rem  --- END EXITCODES ---
rem
rem  Usage:
rem    restore-taskmgr.cmd -WhatIf
rem    restore-taskmgr.cmd -TargetDb taskmgr_restore_drill -Grants
rem    restore-taskmgr.cmd -DumpPath "D:\taskmgr-backup\taskmgr-20260824-102609.sql" -Grants
rem    restore-taskmgr.cmd -TargetDb taskmgr_restore_drill -DropTarget
rem
rem  Do NOT end an argument value with a backslash - powershell.exe reads \"
rem  as an escaped quote and swallows the following argument.
rem ===========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-taskmgr.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%
