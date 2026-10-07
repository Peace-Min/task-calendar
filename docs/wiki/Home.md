# 수행과제 캘린더 위키

사내 일정과 과제를 관리하는 위젯 **수행과제 캘린더**의 사용 및 운영 안내입니다. 개발 기록은 저장소의 `docs/`, 배포 절차는 `DEPLOY.md` 가 정본입니다.

## 사용자

- [창 버튼과 트레이](창-버튼과-트레이): 맨 앞에 띄우기, 부착, ☰, ✕(트레이를 쓰면 숨기기)
- [보고서 회사 전송](보고서-회사-전송): 늘 실제로 제출하고, 제출 전에 한 번 확인합니다. 과제를 기타로 합치기, 보고서 창 X 로 이번만 빼기
- [다른 사람 일정 보기](다른-사람-일정-보기): 툴바의 '👥 다른 사람 일정', 사람/조직도 탭, 즐겨찾기와 최근 본 사람, 사람 바꾸기, 보이는 것과 안 보이는 것, 밀도, 겹쳐 보기와 나란히 보기, 시간 겹침
- [날짜 누르기와 기간 일정](날짜-누르기와-기간-일정): 무엇을 누르면 어느 날짜가 선택되는지, 기간 막대 클릭 수정(2026-10-01)
- [과제 순서 바꾸기](과제-순서-바꾸기): '🏷️ 내 과제'의 ▲▼ 로 순서를 정하면 보고서 순서가 따라갑니다
- [서버 연결이 끊겼을 때](서버-연결이-끊겼을-때): 화면에 무엇이 뜨고, 무엇을 하면 되는지

## 운영·관리자

- [관리 화면](관리-화면): '⚙ 관리' 한 화면에서 구성원, 직급/소속, 공식 과제, 발주처, 구분/상태, 휴지통을 관리합니다
- [서버 장애 시 동작과 진단](서버-장애-시-동작과-진단): 장애 종류별 동작, 재연결 주기, 로그 보는 법, 자주 나는 원인(DB 스키마 12에서 13 올리기 순서 포함)

## 개발·QA

- 기획서: [`docs/OFFLINE-RESILIENCE.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/OFFLINE-RESILIENCE.md)
- 실 위젯 장애 주입 루프: `tests/loop-offline.mjs` (디버그 실행에서만 동작)
- 과제 순서 기획서: [`docs/CATEGORY-ORDER.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/CATEGORY-ORDER.md), 실 위젯 루프 `tests/loop-category-order.mjs`
- 보고서 포함 상태(포함/기타, 보고서 창 X) 기획서: [`docs/REPORT-INCLUDE-STATE.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/REPORT-INCLUDE-STATE.md), 실 위젯 루프 `tests/loop-report-include.mjs`, 마이그레이션 루프 `tests/loop-migrate-report-group.mjs`
- 기간 칩 클릭 버그 기획서: [`docs/BUG-RANGE-CHIP-CLICK.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/BUG-RANGE-CHIP-CLICK.md), 실 위젯 루프 `tests/loop-range-chip.mjs`
- 타인 일정 보기 기획서: [`docs/PEER-VIEW-FULL.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PEER-VIEW-FULL.md), [`docs/PEER-OVERLAY-REDESIGN.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PEER-OVERLAY-REDESIGN.md), [`docs/PEER-SIDE-BY-SIDE.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PEER-SIDE-BY-SIDE.md), [`docs/PEER-PICKER.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PEER-PICKER.md), [`docs/PEER-PICKER-ORG.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PEER-PICKER-ORG.md)
  - 루프: `tests/loop-peer-view.mjs`, `tests/loop-peer-frame.mjs`
- 관리 화면 기획서: [`docs/ADMIN-HUB.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/ADMIN-HUB.md), 루프 `tests/loop-admin-hub.mjs`
- 화면 혼란 3건 기획서: [`docs/UI-CLARITY-2026-10-01.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/UI-CLARITY-2026-10-01.md)
