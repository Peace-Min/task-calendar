@echo off
REM ============================================================
REM  수행과제 캘린더 - 배포 빌드 (원클릭)
REM  이 파일을 더블클릭하면:
REM    1) 위젯을 자체포함 단일 exe 로 publish
REM    2) 인스톨러(ISCC) 생성       -> dist\installer\TaskCalendarWidget-Setup-v<버전>.exe
REM    3) 배포 SQL 생성(sha256)     -> dist\installer\release-v<버전>.sql
REM  Setup exe 를 공유폴더(FTP)에 먼저 올리고, 그다음 release-v<버전>.sql 을 Workbench 에서 실행하면 배포 끝.
REM  (공유폴더 latest.json 은 2026-10-21 부터 쓰지 않는다. 배포 정보는 DB 에 있다. docs\DB-RELEASE-OPS.md 4절)
REM
REM  [필요] .NET 9 SDK + Inno Setup 6 (ISCC). 버전은 widget\TaskCalendarWidget.csproj <Version> 단일 소스.
REM  [옵션] 공유폴더로 자동 복사:  배포-빌드.cmd -CopyTo "\\서버\TaskCalendar"   (Setup exe 만, 복사 뒤 해시 대조)
REM         요약 주석:             기본은 RELEASE_NOTES.md의 현재 버전 요약(배포 SQL 머리 주석). 덮어쓰기: 배포-빌드.cmd -Notes "요약"
REM ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-update.ps1" -Build %*
echo.
pause
