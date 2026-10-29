# 다른 사람 일정 열람 창 기간 막대 공용화 인계 보고 (2026-10-29, 브랜치 codex/peer-org-recent, 마지막 커밋 8d10879)

## 한 줄 요약
다른 사람 일정 열람 창(겹쳐 보기, 나란히 보기)의 월간 달력 그리기를 개인 달력과 같은 주 단위 연속 기간 막대(renderMonthBars)로 통일하고 겹쳐 보기 상대와 내 차선을 상하로 분리 배치.

## 바뀐 것 (파일과 이유)
- task-calendar-prototype.html:
  - renderGrid: 내 창과 열람 창(겹쳐 보기 및 나란히 보기) 모두 renderMonthBars 로 월간 달력을 그리도록 통합.
  - pmMonthItems: 상대방 기록과 내 겹 일정을 수집하고 차선 배치를 위한 아이템 목록 가공.
  - barChipHtml: 열람 창의 막대 칩을 읽기 전용(draggable="false")으로 생성하고 내 일정 막대에 테마 전용 토큰 적용.
  - renderMonthBars: 겹쳐 보기 모드에서 상대방 차선(0 .. theirLanes - 1) 아래에 내 일정 차선(theirLanes ..)을 배치, 모든 차선 높이 19px 유지.
  - fitChips, fitBars: 나란히 보기의 #grid 와 #gridMine 모두에 접기 적용.
  - peerSyncRows: .grid.bars 주 단위 행 높이 동기화.
  - #gridMine 클릭 처리: 막대 클릭 시 chipCellDate 로 누른 날짜 칸 판정.
- tests/peer-overlay.test.mjs, tests/peer-overlay-redesign.test.mjs, tests/peer-side-by-side.test.mjs, tests/peer-expand-scroll.test.mjs, tests/peer-view-full.test.mjs, tests/personal-improve.test.mjs:
  - 칸별 조각 대신 주 단위 연속 기간 막대 구조와 차선 분리 배치 계약에 맞춰 갱신.
- docs/wiki/다른-사람-일정-보기.md:
  - 다른 사람 일정 창의 기간 일정이 주 단위 연속 막대로 표시되고, 겹쳐 보기에서 상대방 차선 아래 내 차선이 배치되는 내용 반영.
- CHANGELOG.md:
  - 다음 판 개발 이력에 기간 막대 공용화 및 차선 분리 배치 내용 추가.
- docs/PEER-RANGE-BARS.md:
  - 기획서 상태를 구현 완료(2026-10-29, 8d10879)로 갱신.

## 결정
- 사용자가 정한 것:
  - 시안 B 채택(renderMonthBars 공용화와 겹쳐 보기 상대/내 차선 상하 분리 배치).
  - 별도 구분줄 행(.mine-sep) 없이 차선 높이 19px 균일 유지 및 색과 토큰으로 소속 구분.
  - 나란히 보기 왼쪽 달력에 상대방 기록만, 오른쪽 달력에 내 일정만 각각 renderMonthBars 로 렌더링.
- 내가 정한 것(검토 필요):
  - 없음 (사용자가 승인한 시안 B 규칙을 그대로 준수함).

## 시험 (명령과 결과 숫자)
- 관련 시험:
  - node --test tests/peer-overlay.test.mjs tests/peer-overlay-redesign.test.mjs tests/peer-side-by-side.test.mjs tests/peer-expand-scroll.test.mjs tests/peer-view-full.test.mjs tests/personal-improve.test.mjs (150 pass, 0 fail, 0 skip)
- 전체 strict:
  - cmd /c "set TC_TEST_STRICT=1&& node tests/run-tests.mjs < NUL" (3151 pass, 0 fail, 0 skip, exit 0)
- 빌드:
  - dotnet build widget/TaskCalendarWidget.csproj -c Debug -o dist/build-check (경고 0, 오류 0, NuGet 패키지 보안 권고 NU1902 2건 제외 C# 빌드 정상)

## 확인 못 한 것 (실제 위젯, 실제 DB, 다른 테마 등)
- 실제 위젯 창(WebView2 CDP 루프 및 실제 창 테두리)에서의 렌더링 확인 (Windows 개발 PC 환경이지만 CDP 자동화 루프 없이 jsdom 및 정적 시험 위주 검증)
- 다크, 포레스트, 세피아, 고대비 등 테마별 실화면 시각적 검증 (CSS 토큰 수식 및 대비는 기존 하네스로 통과 확인)
- 사내 실제 MySQL DB 연결 환경에서의 열람 동작 (단위 시험은 모의 환경 기준)

## 남은 질문
- 없음
