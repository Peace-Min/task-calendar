# 수행과제 캘린더 위키

사내 일정·과제 관리 위젯 **수행과제 캘린더**의 사용·운영 안내입니다. 개발 기록은 저장소의 `docs/`, 배포 절차는 `DEPLOY.md` 가 정본입니다.

## 사용자

- [다른 사람 일정 보기](다른-사람-일정-보기) — 열람 창에서 보이는 것·안 보이는 것 · 밀도 · 내 일정 겹쳐 보기
- [날짜 누르기와 기간 일정](날짜-누르기와-기간-일정) — 무엇을 누르면 어느 날짜가 선택되는지 · 기간 막대 클릭 수정(2026-10-01)
- [과제 순서 바꾸기](과제-순서-바꾸기) — 「과제 관리」의 ▲▼ 로 순서를 정하면 보고서 순서가 따라간다
- [서버 연결이 끊겼을 때](서버-연결이-끊겼을-때) — 화면에 무엇이 뜨고, 무엇을 하면 되는지

## 운영·관리자

- [서버 장애 시 동작과 진단](서버-장애-시-동작과-진단) — 장애 종류별 동작, 재연결 주기, 로그 보는 법, 자주 나는 원인

## 개발·QA

- 기획서: [`docs/OFFLINE-RESILIENCE.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/OFFLINE-RESILIENCE.md)
- 실 위젯 장애 주입 루프: `tests/loop-offline.mjs` (디버그 실행에서만 동작)
- 과제 순서 기획서: [`docs/CATEGORY-ORDER.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/CATEGORY-ORDER.md) · 실 위젯 루프 `tests/loop-category-order.mjs`
- 기간 칩 클릭 버그 기획서: [`docs/BUG-RANGE-CHIP-CLICK.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/BUG-RANGE-CHIP-CLICK.md) · 실 위젯 루프 `tests/loop-range-chip.mjs`
- 타인 일정 보기 기획서: [`docs/PEER-VIEW-FULL.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PEER-VIEW-FULL.md) · 루프 `tests/loop-peer-view.mjs` · `tests/loop-peer-frame.mjs`
