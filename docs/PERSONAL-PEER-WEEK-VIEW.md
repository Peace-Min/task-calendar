# 개인 일정 및 다른 사람 일정 월간/주간 모드 기획

상태: 구현 완료 (2026-10-30, 브랜치 codex/peer-org-recent)

## 1. 배경

- 과제 탭(`#pcView`)에는 상단 도구줄에 `[월간 | 주간]` 분할 버튼이 있어 한 달 전체 흐름과 한 주 집중 일정을 오가며 볼 수 있다.
- 반면 개인 일정 탭(`!PEER`)과 다른 사람 일정 팝업(`PEER`, `?peer=1`)은 월간 격자만 지원한다.
- 일정과 할 일이 많은 주간에는 월간 격자의 행 높이 한계로 `+N` 접힘이 자주 생기거나, 한 주 단위로 일정과 할 일, 내 일정을 비교하기 어렵다.
- 개인 일정과 다른 사람 일정(겹쳐 보기 및 나란히 보기)에도 `[월간 | 주간]` 전환 모드를 추가한다.

## 2. 결정 (사용자 결정)

1. **화면 구성: 시안 A (1주 집중 확대 격자 + 우측 상세 패널 유지)**
   - 기존의 7열 달력 격자(`#weekdays` + `#grid`, 나란히 보기에서는 `#weekdaysMine` + `#gridMine`)와 우측 상세 패널(`#dayPanel`) 구성을 그대로 유지하되, 선택된 날짜(`selectedDate`)가 포함된 **1주(7일, 1행)** 만 달력 영역 전체 높이에 맞춰 크게 펼친다.
   - 1주만 그리므로 세로 공간이 넉넉하여 `+N` 접힘 없이 그 주의 모든 기간 일정, 단일 일정, 할 일, 내 일정(`--mine-*`) 막대를 한눈에 보여 준다(항목이 많으면 주간 격자 내부에서 세로 스크롤).
   - 다른 사람 일정의 **겹쳐 보기**(상대 일정 위, 내 일정 점선 구분선 아래)와 **나란히 보기**(왼쪽 상대방 1주 격자, 오른쪽 내 1주 격자, 행 높이/스크롤 동기화) 모두 동일하게 작동한다.
2. **주간 시작 요일: 월요일 시작 (`월 화 수 목 금 토 일`)**
   - 과제 탭 주간 보기(`pcWeekRange`) 및 주간 보고서(`weekRange`)와 동일하게 월요일부터 일요일까지 7일을 한 주로 묶는다.
   - 주간 모드로 전환하면 요일 헤더(`#weekdays`, `#weekdaysMine`)도 `월 화 수 목 금 토 일`(토요일 `.sat`, 일요일 `.sun`) 순서로 표시하고, 월간 모드로 돌아오면 기존 `일 월 화 수 목 금 토` 로 표시한다.
3. **보기 모드 저장: `localStorage` 창별 분리 기억 (`tc_calView` / `tc_peerView`)**
   - 밀도 설정(`tc_calDensity` / `tc_peerDensity`)처럼 개인 일정 창은 `tc_calView`, 다른 사람 일정 팝업은 `tc_peerView` 키로 `localStorage` 에 `'month' | 'week'` 를 저장한다(기본값 `'month'`).

## 3. 바꾸는 것 (세부 설계)

- **전환 버튼 (`#calViewSeg`)**:
  - 상단 탐색줄(`header.topbar .nav`)의 날짜 제목(`#btnTitle`) 옆에 `[월간 | 주간]` 분할 버튼(`#calViewSeg`)을 둔다. 개인 일정 창과 다른 사람 일정 팝업 모두 같은 위치에서 전환한다.
- **날짜 제목 (`#btnTitle`) 및 월 선택 팝업 (`#jumpMonth`)**:
  - 월간 모드: 기존처럼 `YYYY년 M월`(예: `2026년 10월`).
  - 주간 모드: 선택된 날짜(`selectedDate`)가 속한 월요일~일요일 범위를 `pcRangeLabel` 과 같은 규칙으로 표시한다(같은 달: `2026년 10월 26일 ~ 11월 1일`, 같은 달 내: `2026년 10월 19일 ~ 25일`, 해가 바뀌면 `2026.12.28 ~ 2027.1.3`).
- **탐색 동작 (`#btnPrev`, `#btnNext`, `#btnToday`, 키보드 단축키)**:
  - 월간 모드: 기존처럼 한 달(`moveMonth(±1)`) 이동.
  - 주간 모드: `#btnPrev` / `#btnNext` 클릭 및 `PageUp` / `PageDown` 키는 선택된 날짜를 **7일(`±7일`)** 이동(`moveWeek(±1)`)하고 해당 날짜가 속한 달로 `view` 도 맞춘다. `오늘` 버튼(`#btnToday`)과 `Home` 키는 오늘 날짜로 이동한다.
  - 달력 격자 안에서 방향키(`ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`)로 날짜를 옮길 때 주간 경계를 넘어가면 해당 주로 자연스럽게 넘어간다.
- **렌더링 (`renderWeekdays`, `renderGrid`, `renderMonthBars`, `fitBars`, `peerSyncRows`)**:
  - `calView()` 가 `'week'` 이면:
    - `renderWeekdays()` 는 `['월','화','수','목','금','토','일']` 순서로 그리며 index 5가 `.sat`, index 6이 `.sun` 이 된다.
    - `renderGrid()` 는 `selectedDate` 가 속한 월요일(`weekStartMonday(selectedDate)`)부터 일요일까지 7일(1주, `weeks = 1`)만 그린다. 주간 모드에서는 달이 다른 날이라도 한 주 안에 함께 보므로 `.dim`(타월 흐림) 처리를 하지 않거나 달이 다를 때 월 표기를 보조로 보여 주며, `fitBars` 의 `+N` 접힘을 적용하지 않고(`expand` 와 같이 모든 차선 표시, 세로 스크롤 허용) 모든 막대를 표시한다.
    - 다른 사람 일정 나란히 보기(`PEER && __peerLayout === 'side'`)에서도 왼쪽 `#grid` 와 오른쪽 `#gridMine` 모두 해당 1주만 그리고 `peerSyncRows()` 로 높이를 맞춘다.

## 4. 하지 않는 것

- DB 스키마나 서버 API 는 바꾸지 않는다.
- 과제 탭(`#pcView`)의 기존 월간/주간 보기 동작과 주간 보고서(`#reportModal`) 동작은 바꾸지 않는다.
- 데이터끼리 묶는 규칙은 새로 만들지 않는다.

## 5. 순서

1. 기획서 작성 및 `dist/proto/personal-peer-week-mode.html` 시안 A/B 비교 화면 제작 후 사용자 승인 (완료)
2. 승인된 안으로 `task-calendar-prototype.html` 주간/월간 상태, 탐색(`±7일`), 렌더링(`renderWeekdays`, `renderGrid`, `renderMonthBars`, `fitBars`, `peerSyncRows`) 구현
3. 단위/통합/변이 시험 추가 및 전체 strict 시험(`TC_TEST_STRICT=1 node tests/run-tests.mjs`), 위젯 빌드 검증
4. 위키(`docs/wiki/`), `CHANGELOG.md`, 인계 보고(`docs/handoff/`) 갱신 및 커밋
