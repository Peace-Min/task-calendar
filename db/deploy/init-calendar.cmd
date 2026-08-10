@echo off
rem ===========================================================================
rem  init-calendar.cmd - launcher for init-calendar.ps1 (calendar cal_* tables)
rem
rem  ASCII ONLY. Do not put Korean (or any non-ASCII) text in this file.
rem  cmd.exe resumes a batch file by BYTE offset after a child process exits.
rem  Under codepage 65001 that offset is miscomputed when the file contains
rem  multi-byte text, so cmd.exe re-executes fragments of comment lines as
rem  commands. Measured: Korean rem block present -> 6 bogus "not recognized"
rem  lines under chcp 65001 (and, when the block sat below the powershell call,
rem  the set/exit lines were skipped too and the exit code became 9009).
rem  Under chcp 949 (this PC's system default = what double-click gets) it was
rem  always clean - i.e. the breakage only shows up in UTF-8 consoles (dev/CI).
rem
rem  All Korean documentation lives where it is actually read:
rem    - init-calendar.ps1 header : usage, parameters, exit codes, safety scan
rem    - db/deploy/README.md      : deploy order (schema -> triggers -> grants)
rem  Exit codes (must match the ps1 header table):
rem    0 ok | 1 failed | 2 cancelled | 3 no triggers | 4 no app account | 5 = 3+4
rem
rem  Usage:  init-calendar.cmd [-DbHost 192.168.0.50] [-DbName taskmgr] [-Force]
rem  Do NOT end an argument value with a backslash - powershell.exe reads \" as
rem  an escaped quote and swallows the following argument.
rem ===========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0init-calendar.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%
