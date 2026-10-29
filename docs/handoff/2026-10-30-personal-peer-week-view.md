# 개인 일정 및 다른 사람 일정 월간/주간 모드 인계 보고 (2026-10-30, 브랜치 codex/peer-org-recent, 마지막 커밋 1b8e99f)

## 한 줄 요약
개인 탭 및 다른 사람 일정 열람 창에 상단 [월간 | 주간] 모드 전환을 추가하고, 월요일 시작 1주 확대 격자, ±7일 이동 및 창별 설정 분리 기억을 구현하고 검증했습니다.

## 바뀐 것 (파일과 이유)
- `task-calendar-prototype.html`:
  - 상단 탐색줄(.nav)에 #calViewSeg([월간 | 주간] 분할 버튼) 마크업 및 스타일 추가
  - calViewKey(), calViewDefault(), calView(), setCalView(), calWeekRange(), calTitleLabel(), syncCalViewSeg(), moveWeek(), stepCal() 함수 구현
  - renderWeekdays(): 주간 모드 시 '월 화 수 목 금 토 일' 순서로 요일 머리줄 표시(토요일 .sat, 일요일 .sun), 나란히 보기 #weekdaysMine 동기화
  - renderMonthBars(): 주간 모드 시 selectedDate 가 포함된 월요일~일요일 1주(7일, 1행)만 렌더하고 .grid.bars.week.expand 클래스 부여
  - 주간 모드 날짜 제목 표시(calTitleLabel), 탐색 이동(moveWeek(±1) 으로 ±7일 이동), 연·월 바로 이동(jumpMonth) 연동
  - 키보드 탐색(PageUp, PageDown 단축키가 주간 모드에서 ±7일 이동)
- `docs/PERSONAL-PEER-WEEK-VIEW.md`:
  - 상태를 '구현 완료 (2026-10-30, 브랜치 codex/peer-org-recent)' 로 갱신
- `docs/wiki/Person-Schedule.md`:
  - 개인 및 다른 사람 일정 월간/주간 모드 위키 문서 신규 작성
- `docs/wiki/Home.md`, `docs/wiki/_Sidebar.md`:
  - 위키 목차 및 개발 기획서 목록에 신규 위키 링크 연결
- `CHANGELOG.md`:
  - 맨 위 2026-10-30 섹션에 변경 내역 추가
- `tests/personal-peer-week-view.test.mjs`:
  - 정적, 단위(1주 범위, 제목 라벨, 모드 키), 런타임 JSDOM(내 창, 열람 창 겹쳐/나란히 보기, 이동, 격자 클래스 및 행/칸 수), 변이 3종 검증 파일 신규 작성

## 결정
- 사용자가 정한 것:
  - 화면 구성: 1주 집중 확대 격자(선택된 날짜가 속한 1주를 7열 달력 전체 높이에 맞춰 펼치고 우측 상세 패널 유지)
  - 시작 요일: 월요일 시작(월 화 수 목 금 토 일)
  - 저장 키: localStorage 창별 분리 기억(내 창 tc_calView, 열람 창 tc_peerView, 기본값 month)
- 내가 정한 것(검토 필요):
  - 주간 모드에서 jumpMonth 로 특정 연·월을 점프할 때 기존 selectedDate 의 일자를 최대한 유지하되 해당 월 말일을 넘지 않도록 보정(Math.min(sd.getDate(), dim))

## 시험 (명령과 결과 숫자)
- 관련 시험:
  - `node tests/personal-peer-week-view.test.mjs`: 12 pass / 0 fail / 0 skip
  - `node tests/personal-improve.test.mjs`: 26 pass / 0 fail / 0 skip
  - `node tests/peer-view-full.test.mjs`: 34 pass / 0 fail / 0 skip
  - `node tests/peer-side-by-side.test.mjs`: 22 pass / 0 fail / 0 skip
  - `node tests/ui-copy-punct.test.mjs`: 10 pass / 0 fail / 0 skip
- 전체 strict:
  - `$env:TC_TEST_STRICT="1"; node tests/run-tests.mjs`
  - 3163 pass / 0 fail / 0 skip, exit 0 (89개 시험 파일 전체 통과)
- 빌드:
  - `dotnet build widget/TaskCalendarWidget.csproj -c Debug`: 경고 2개(MySqlConnector 알려진 취약점 경고 NU1902), 오류 0개 통과

## 확인 못 한 것 (실제 위젯, 실제 DB, 다른 테마 등)
- 실제 사내 서버 MySQL DB 연동 환경에서의 위젯 실행(단위/통합 시험 및 JSDOM 가상 환경에서 검증함)
- Windows 실제 구동 중인 WebView2 위젯 프로세스에 대한 CDP 루프 테스트(tests/loop-peer-frame.mjs 등)는 개발 중 위젯이 띄워진 상태가 아니라 직접 돌리지 않음

## 남은 질문
- 없음
