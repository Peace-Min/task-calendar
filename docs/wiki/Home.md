# 수행과제 캘린더 위키

사내 일정과 과제를 관리하는 위젯 **수행과제 캘린더**의 사용 및 운영 안내입니다. 개발 기록은 저장소의 `docs/`, 배포 절차는 `DEPLOY.md` 가 정본입니다.

## 사용자

- [창 버튼과 트레이](창-버튼과-트레이): 맨 앞에 띄우기, 부착, ☰, ✕(트레이를 쓰면 숨기기)
- [과제 캘린더](과제-캘린더): 개인 / 과제 탭, 내 과제에 넣은 공식 과제의 공용 일정, 그날 일정 목록과 [수정], 다른 사람과 동시에 고쳤을 때, 언제 새로 읽나, 최근 변경, 개인 일정에 등록
- [보고서 회사 전송](보고서-회사-전송): 늘 실제로 제출하고, 제출 전에 한 번 확인합니다
- [보고서 글 편집](보고서-글-편집): 일간, 주간보고에 상세 줄 쓰기, 이 보고서에서 빼기(×), 임시 저장, 보고서와 캘린더는 따로
- [월간 보고](월간-보고): 보고서 창의 네 번째 탭, 회사 월간보고 양식 .docx 저장, 자동으로 채우는 칸(수행 실적, 기타)과 직접 쓰는 칸, 개발 일정 그림, 저장 위치, Word 와 한컴
- [다른 사람 일정 보기](다른-사람-일정-보기): 툴바의 '👥 다른 사람 일정', 사람/조직도 탭, 즐겨찾기와 최근 본 사람, 사람 바꾸기, 보이는 것과 안 보이는 것, 밀도, 겹쳐 보기와 나란히 보기, 시간 겹침
- [날짜 누르기와 기간 일정](날짜-누르기와-기간-일정): 여러 날 일정과 할 일의 막대 모양, 무엇을 누르면 어느 날짜가 선택되는지, 잡은 날 기준으로 끌어 옮기기
- [일정 입력 창](일정-입력-창): 모든 칸이 보이는 한 화면 입력 창, 5분 단위 시각 칸, 반복(안 함, 매주, 매월)과 예전 세부 값 보존, 좁은 창의 아래 시트
- [과제 순서 바꾸기](과제-순서-바꾸기): '🏷️ 내 과제'의 ▲▼ 로 순서를 정하면 보고서 순서가 따라갑니다
- [장소 입력과 회의실](장소-입력과-회의실): 장소 칸에서 회사 공용 회의실을 고르거나 직접 적습니다. 목록은 관리자가 관리합니다
- [기본 과제 휴가와 기타](기본-과제-휴가와-기타): 늘 있는 휴가, 기타 과제, 과제 삭제 시 데이터 삭제, 다른 과제로 옮기기
- [서버 연결이 끊겼을 때](서버-연결이-끊겼을-때): 화면에 무엇이 뜨고, 무엇을 하면 되는지
- [앱 업데이트와 서버 갱신](앱-업데이트와-서버-갱신): 새 버전 알림, 서버 갱신 중, 업데이트 필요, 설치 실패, 관리자 문의 카드와 할 일
- [XML 가져오기](XML-가져오기): 예전 버전 기록 옮기기, 가져오기는 언제나 교체(2026-10-07 병합 제거)
- [사용 영상](사용-영상): "?" 의 [사용 영상], 켤 때 한 번 묻기와 세 단추, 운영자가 올리는 guide 폴더와 판 번호 올리기
- [지운 기능](지운-기능): Git, SVN 연동(2026-10-26, 커밋 기록은 바꾸지 않고 지움, 과제 데이터 내보내기는 캘린더.md 만), 선진행 잠금과 '진행중만'(2026-10-26)

## 운영·관리자

- [설치기 런타임](설치기-런타임): 공유폴더 업데이트용과 처음 설치용 Full, WebView2 준비 및 미설치 PC 차단
- [관리 화면](관리-화면): '⚙ 관리' 한 화면에서 구성원, 직급/소속, 공식 과제, 발주처, 구분/상태, 휴지통을 관리합니다
- [공식 과제 순서와 거르기](공식-과제-순서와-거르기): 구분 안 No 순서, 끌기와 ⋯ 메뉴로 옮기기, 상태 체크박스, 구분, 상태와 날짜는 서로 따로(2026-10-26)
- [서버 장애 시 동작과 진단](서버-장애-시-동작과-진단): 장애 종류별 동작, 재연결 주기, 로그 보는 법, 자주 나는 원인

## 개발·QA

- 기획서: [`docs/OFFLINE-RESILIENCE.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/OFFLINE-RESILIENCE.md)
- 실 위젯 장애 주입 루프: `tests/loop-offline.mjs` (디버그 실행에서만 동작)
- 과제 순서 기획서: [`docs/CATEGORY-ORDER.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/CATEGORY-ORDER.md), 실 위젯 루프 `tests/loop-category-order.mjs`
- 기간 칩 클릭 버그 기획서: [`docs/BUG-RANGE-CHIP-CLICK.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/BUG-RANGE-CHIP-CLICK.md), 실 위젯 루프 `tests/loop-range-chip.mjs`
- 타인 일정 보기 기획서: [`docs/PEER-VIEW-FULL.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PEER-VIEW-FULL.md), [`docs/PEER-OVERLAY-REDESIGN.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PEER-OVERLAY-REDESIGN.md), [`docs/PEER-SIDE-BY-SIDE.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PEER-SIDE-BY-SIDE.md), [`docs/PEER-PICKER.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PEER-PICKER.md), [`docs/PEER-PICKER-ORG.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PEER-PICKER-ORG.md)
  - 루프: `tests/loop-peer-view.mjs`, `tests/loop-peer-frame.mjs`
- 관리 화면 기획서: [`docs/ADMIN-HUB.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/ADMIN-HUB.md), 루프 `tests/loop-admin-hub.mjs`
- XML 병합 제거 기획서: [`docs/XML-MERGE-REMOVAL.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/XML-MERGE-REMOVAL.md), 실 위젯 루프 `tests/loop-import-ui.mjs`
- 기본 과제 기획서: [`docs/DEFAULT-TASKS.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/DEFAULT-TASKS.md), 실 위젯 루프 `tests/loop-default-tasks.mjs`
- 보고서 글 편집 기획서: [`docs/REPORT-EDIT.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/REPORT-EDIT.md), 실 위젯 루프 `tests/loop-report-edit.mjs`
- 주간 글 편집 기획서: [`docs/WEEKLY-EDIT.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/WEEKLY-EDIT.md), 실 위젯 루프 `tests/loop-weekly-edit.mjs`
- 버전 관문 기획서: [`docs/VERSION-GATE.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/VERSION-GATE.md), 운영 정본 [`docs/DB-RELEASE-OPS.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/DB-RELEASE-OPS.md), 실 위젯 루프 `tests/loop-schema-gate.mjs`
- 개인 탭 개선 기획서: [`docs/PERSONAL-IMPROVE-PLAN.md`](https://github.com/Peace-Min/task-calendar/blob/feat/personal-improve/docs/PERSONAL-IMPROVE-PLAN.md), 화면 시험 `tests/personal-improve.test.mjs`, 실 위젯 루프 `tests/loop-personal-improve.mjs`
- 과제 공용 캘린더 기획서: [`docs/PROJECT-CALENDAR-PLAN.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PROJECT-CALENDAR-PLAN.md), 실 위젯 루프 `tests/loop-project-calendar.mjs`, DB 계약 `tests/db-project-calendar.mjs`
- 월간보고 기획서: [`docs/MONTHLY-REPORT-PLAN.md`](https://github.com/Peace-Min/task-calendar/blob/feat/monthly-report-plan/docs/MONTHLY-REPORT-PLAN.md), 화면 시험 `tests/monthly-report.test.mjs`, 실 위젯 루프 `tests/loop-monthly-report.mjs`
- 사용 영상 규칙과 구현 메모: [`docs/GUIDE-VIDEOS.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/GUIDE-VIDEOS.md), 화면 시험 `tests/guide-videos.test.mjs`, 실 위젯 루프 `tests/loop-guide-videos.mjs`
- 과제 관리 화면 개선 기획서(No 순서, 상태 체크박스, 연결 규칙 삭제): [`docs/PROJECT-ADMIN-UX.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/PROJECT-ADMIN-UX.md), 이관 조각 `db/deploy/migrations/v19-project-order.sql`(구조 19), 시험 `tests/project-order.test.mjs`, `tests/project-order-web.test.mjs`
- Git, SVN 삭제 기획서: [`docs/GIT-SVN-REMOVAL.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/GIT-SVN-REMOVAL.md), 이관 조각 `db/deploy/migrations/v18-remove-git.sql`(구조 18), 시험 `tests/git-removal.test.mjs`, `tests/git-removal-web.test.mjs`
- 화면 혼란 3건 기획서: [`docs/UI-CLARITY-2026-10-01.md`](https://github.com/Peace-Min/task-calendar/blob/feat/db-app/docs/UI-CLARITY-2026-10-01.md)
