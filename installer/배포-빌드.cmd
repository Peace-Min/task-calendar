@echo off
setlocal
REM PowerShell 7에서 호출해도 Windows PowerShell 기본 모듈을 먼저 찾는다.
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules;%ProgramFiles%\WindowsPowerShell\Modules;%PSModulePath%"
REM ============================================================
REM  수행과제 캘린더 - 배포 빌드 (원클릭)
REM  이 파일을 더블클릭하면:
REM    1) 위젯을 자체포함 단일 exe 로 publish
REM    2) 설치기 두 개 생성: 공유폴더용 Setup-v<버전>.exe, 처음 설치용 Setup-v<버전>-full.exe
REM    3) 배포 SQL 생성(sha256, 이관 조각 포함) -> dist\installer\release-v<버전>.sql
REM    4) 전환용 매니페스트(0.22 이하 위젯용)   -> dist\installer\latest.json
REM  공유폴더에는 업데이트용 Setup exe 와 latest.json 을 먼저 올린다. Full은 새 PC에 배포한다.
REM  Workbench 로 백업한 뒤,
REM  release-v<버전>.sql 하나를 Workbench 에서 한 번 실행하면 배포 끝(docs\DB-RELEASE-OPS.md 4절).
REM
REM  [필요] .NET 9 SDK + Inno Setup 6 + redist의 WebView2 오프라인 x64 설치 파일.
REM  버전은 widget\TaskCalendarWidget.csproj <Version> 단일 소스.
REM  [옵션] 공유폴더로 자동 복사:  배포-빌드.cmd -CopyTo "\\서버\TaskCalendar"   (Setup exe 만, 복사 뒤 해시 대조)
REM         요약 주석:             기본은 RELEASE_NOTES.md의 현재 버전 요약(배포 SQL 머리 주석). 덮어쓰기: 배포-빌드.cmd -Notes "요약"
REM ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-update.ps1" -Build %*
set "buildExit=%errorlevel%"
echo.
pause
exit /b %buildExit%
