@echo off
rem 위젯 DB 계정(taskmgr_app) 생성/비번 맞추기 — 더블클릭, root 비번만 입력.
rem 위젯이 DB에 못 붙을 때(계정 없음/비번 불일치) 사용. 테이블·데이터는 안 건드림.
rem 다른 값으로 맞추려면:  app-account.cmd -AppPassword 새비번  (위젯 빌드값과 일치해야 함)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app-account.ps1" %*
