# 수행과제 캘린더 위키

사내 일정·과제 관리 위젯 **수행과제 캘린더**의 사용·운영 안내입니다. 개발 기록은 저장소의 `docs/`, 배포 절차는 `DEPLOY.md` 가 정본입니다.

## 사용자

- [과제 순서 바꾸기](과제-순서-바꾸기) — 「과제 관리」의 ▲▼ 로 순서를 정하면 보고서 순서가 따라간다
- [서버 연결이 끊겼을 때](서버-연결이-끊겼을-때) — 화면에 무엇이 뜨고, 무엇을 하면 되는지

## 운영·관리자

- [서버 장애 시 동작과 진단](서버-장애-시-동작과-진단) — 장애 종류별 동작, 재연결 주기, 로그 보는 법, 자주 나는 원인

## 개발·QA

- 기획서: [`docs/OFFLINE-RESILIENCE.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/OFFLINE-RESILIENCE.md)
- 실 위젯 장애 주입 루프: `tests/loop-offline.mjs` (디버그 실행에서만 동작)
- 과제 순서 기획서: [`docs/CATEGORY-ORDER.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/CATEGORY-ORDER.md) · 실 위젯 루프 `tests/loop-category-order.mjs`
