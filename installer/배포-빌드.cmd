@echo off
REM ============================================================
REM  수행과제 캘린더 - 배포 빌드 (원클릭)
REM  이 파일을 더블클릭하면:
REM    1) 위젯을 자체포함 단일 exe 로 publish
REM    2) 인스톨러(ISCC) 생성       -> dist\installer\TaskCalendarWidget-Setup-v<버전>.exe
REM    3) latest.json 생성(sha256)  -> dist\installer\latest.json
REM  결과물 2개(Setup exe + latest.json)를 공유폴더(FTP)에 함께 올리면 배포 끝.
REM
REM  [필요] .NET 9 SDK + Inno Setup 6 (ISCC). 버전은 widget\TaskCalendarWidget.csproj <Version> 단일 소스.
REM  [옵션] 공유폴더로 자동 복사:  배포-빌드.cmd -CopyTo "\\서버\TaskCalendar"
REM         배너 안내문:           기본은 RELEASE_NOTES.md의 현재 버전 요약을 자동 사용. 덮어쓰기: 배포-빌드.cmd -Notes "요약"
REM ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-update.ps1" -Build %*
echo.
pause
