@echo off
rem taskmgr DB 구조 + 앱 계정 생성 (데이터는 안 넣음). root/앱 비번만 입력.
rem 로컬이면 그냥 더블클릭. 서버 대상이면:  init-db.cmd -DbHost 192.168.0.50
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0init-db.ps1" %*
