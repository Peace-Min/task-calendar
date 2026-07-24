@echo off
rem taskmgr 스키마 마이그레이션 (데이터 보존) — 더블클릭, root 비번만 입력.
rem 이미 데이터가 있는 DB를 새 규칙(uid 단독 식별)으로 고친다. 테이블을 지우지 않음.
rem 대상 경로가 다르면:  migrate.cmd -BaseDir D:\mysql -Port 3307
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0migrate.ps1" %*
