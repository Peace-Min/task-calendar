# 다른 사람 일정 열람 창 기간 막대 공용화 (PEER-RANGE-BARS)

작성 2026-10-29. 상태: 구현 완료(2026-10-29, 8d10879). 브랜치 `codex/peer-org-recent`. 시안: `dist/proto/peer-range-bars.html`.

## 1. 배경

개인 월간 달력(`!PEER`)은 2026-10-23 개인 탭 개선(`docs/PERSONAL-IMPROVE-PLAN.md` 결정 1~4)에서 주 단위 연속 기간 막대(`renderMonthBars`, `.grid.bars > .gridrow`, `.chip.chip-bar`)로 바뀌었다. 반면 다른 사람 일정 열람 창(`PEER`, `?peer=1`)은 겹쳐 보기와 나란히 보기 배치 때문에 예전 칸별 조각 그리기(`renderMonthGrid`, `.cell > .chips > .chip-range`)에 머물러 있었다.

이 때문에 같은 기간 일정을 개인 달력에서 볼 때와 다른 사람 일정 창에서 볼 때 모양이 달랐다(개인 달력은 칸을 가로지르는 한 줄 막대 + `◂`/`▸` + 기간 글자, 열람 창은 칸마다 끊긴 조각 + 주 시작 칸에만 제목 재표기). 두 화면의 월간 달력 그리기 함수를 `renderMonthBars` 하나로 합쳐 기간 막대 디자인을 통일한다.

## 2. 결정 (2026-10-29 사용자)

- **시안 B 채택 (`renderMonthBars` 공용화 + 겹쳐 보기 상대/내 차선 상하 분리)**:
  1. 내 창(`!PEER`)과 열람 창(`PEER`, 겹쳐 보기 및 나란히 보기) 모두 `renderMonthBars` 로 월간 격자를 그린다.
  2. 겹쳐 보기(`PEER && !peerSide()`)에서 한 주 줄(`.gridrow`)의 차선을 배치할 때, 상대방 일정/할 일(`!_mine`)을 위쪽 차선(`0 .. theirLanes - 1`)에 먼저 배치하고, 내 겹 일정(`_mine`)을 그 아래 차선(`theirLanes .. theirLanes + mineLanes - 1`)에 배치한다.
  3. 별도 구분줄 행(`.mine-sep`)을 끼워 넣지 않고 모든 차선 높이를 `19px` 로 균일하게 유지한다(과제 색 막대와 내 일정 남색 막대 토큰 `--mine-*` 으로 소속을 구분).
  4. 나란히 보기(`peerSide()`)에서는 왼쪽(`#grid`)에 상대방 기록만(`pick: e => !e._mine`, `todos: true`, `roving: true`, `sideOvl: true`), 오른쪽(`#gridMine`)에 내 일정만(`pick: e => !!e._mine`, `todos: false`, `roving: false`, `sideOvl: true`) 각각 `renderMonthBars` 로 그린다.
  5. 열람 창(`PEER`)의 모든 막대 칩은 읽기 전용(`draggable="false"`)이며, 내 일정 막대(`.chip-mine`)에는 과제 색 인라인 스타일(`border-left-color`, `background`)을 넣지 않아 테마 토큰(`--mine-bg`, `--mine-bar`, `--mine-text`)이 그대로 적용되게 한다.
  6. 나란히 보기 줄 높이 맞춤(`peerSyncRows`)과 오른쪽 달력 막대 클릭(`chipCellDate` 로 누른 날짜 칸 판정), `+N` 접기(`fitBars` 를 `#grid` 와 `#gridMine` 모두에 적용)가 `.grid.bars` 구조에서 그대로 동작하게 맞춘다.

## 3. 하지 않는 것

- DB 스키마 변경 없음(구조 번호 그대로).
- 호스트(C#) 통신 명령이나 봉인 규칙(`PEER` 에서 호스트 전송 0회) 변경 없음.
- 우측 일정 상세 패널(`#dpBody`)의 사람별 두 묶음 표시와 시간 겹침 배지(`.ovl-badge`), 날짜 칸 머리의 시간 겹침 점(`.ovl-dot`) 규칙 변경 없음.
- 버전 번호(`APP_VERSION`, `csproj`, `RELEASE_NOTES.md`, `installer/task-calendar.iss`) 갱신 안 함.

## 4. 순서

1. 기획서(`docs/PEER-RANGE-BARS.md`) 작성.
2. `task-calendar-prototype.html` 의 `renderGrid`, `pmMonthItems`, `barChipHtml`, `renderMonthBars`, `fitChips`, `peerSyncRows`, `#gridMine` 클릭 배선 및 `.grid.bars` 스크롤/줄 높이 CSS 정리.
3. 관련 시험(`tests/peer-overlay.test.mjs`, `tests/peer-overlay-redesign.test.mjs`, `tests/peer-side-by-side.test.mjs`, `tests/peer-expand-scroll.test.mjs`, `tests/peer-view-full.test.mjs`, `tests/personal-improve.test.mjs`, `tests/loop-peer-frame.mjs`)을 막대 달력 계약에 맞춰 갱신하고 전체 strict 시험과 위젯 빌드를 통과시킨다.
4. 위키(`docs/wiki/다른-사람-일정-보기.md`), `CHANGELOG.md`, 기획서 상태, 인계 보고서(`docs/handoff/`)를 갱신하고 브랜치 `codex/peer-org-recent` 에 커밋한다.
