@echo off
REM 수행과제 캘린더 인스톨러 빌드 (더블클릭 또는 인자 전달)
REM   예)  build-installer.cmd
REM        build-installer.cmd -SkipPublish
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-installer.ps1" %*
echo.
pause
