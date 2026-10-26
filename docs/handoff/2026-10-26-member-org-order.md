# 구성원 소속별 편집 인계 보고 (2026-10-26, 브랜치 codex/member-org-order, 마지막 구현 커밋 f06f86f)

## 한 줄 요약

구성원 편집에 조직 트리를 추가하고, 전체 명부 하나의 순서를 소속 안에서 조정한다.

## 바뀐 것 (파일과 이유)

- `task-calendar-prototype.html`: 조직 트리, 하위 조직 포함 필터, 소속 없음, 표시된 이웃끼리 이동, 조직 선택 잠금, 단독 및 관리 화면 배치.
- `tests/member-org-order.test.mjs`: 필터, 검색, 편집 진입, 이동, 전체 명부 저장, 취소, 권한 회수, 조직 삭제, 문자열 안전성과 순환 가드. 전체 배열의 이웃을 이동하도록 되돌리는 변이도 검출한다.
- `docs/MEMBER-ORG-ORDER.md`, `docs/USER-ADMIN.md`: 승인한 범위와 기존 결정의 변경 기록.
- `docs/wiki/구성원-소속별-편집.md`, `Home.md`, `_Sidebar.md`: 관리자 사용 안내 및 링크.
- `CHANGELOG.md`: 번호 없는 다음 판 변경 기록.

## 결정

- 사용자가 정한 것: 조직 트리형 B안. 조직별 독립 순서 대신 전체 순서 기반 필터링. 기획, 개발, QA, 위키 진행 승인.
- 내가 정한 것(검토 필요): 상위 조직은 하위 포함, 처음에는 전체, 소속 없음 제공. 소속 전환 시 검색 초기화. 순서 편집 중 검색과 소속 선택 잠금. 갱신으로 선택 조직이 사라지면 전체 복귀.
- 저장 계약: 표시된 두 사람의 전체 배열 자리만 교환하고 전체 `userIds`를 보낸다. 다른 조직의 자리, 관리자 관문과 명부 누락 검증은 유지한다. DB 구조와 C#은 변경하지 않았다.

## 시험 (명령과 결과 숫자)

- 관련 시험: `tests/harness.mjs`의 `run()`으로 `tests/user-admin.test.mjs` 실행, 198 pass / 0 fail / 0 skip. 신규 `tests/member-org-order.test.mjs`, 7 pass / 0 fail / 0 skip. 표준 입력은 빈 문자열 파이프로 제공했다.
- 전체 strict: `TC_TEST_STRICT=1 node tests/run-tests.mjs`, 3150 pass / 0 fail / 0 skip, exit 0.
- 빌드: `dotnet build widget/TaskCalendarWidget.csproj -c Debug`, exit 0, 경고 0개 / 오류 0개.
- 브라우저: Playwright로 실제 HTML에 가상 조직과 명부만 주입. 조직 선택, 소속 내 ▲▼, 취소 동작 확인. 단독 창과 관리 화면, 밝은 테마 및 어두운 테마의 순서 편집 화면을 확인했다. 390px 폭에서 트리, 본문, 목록의 가로 넘침 0.
- 화면 증거(커밋 제외): `dist/proto/member-actual.png`, `member-docked.png`, `member-narrow.png`, `member-dark.png`. 전체 시험 로그 `dist/proto/member-strict.log`, 빌드 로그 `dist/proto/member-build.log`.

## 확인 못 한 것 (실제 위젯, 실제 DB, 다른 테마 등)

- 실제 WebView2 위젯의 등록, 저장 및 DB 왕복은 확인하지 않았다. CDP 9222가 열려 있지 않고 `TC_TEST_DB_ADMIN_PW` 환경 변수도 없다. 실제 DB나 공용 데이터는 변경하지 않았다.
- 포레스트, 세피아, 고대비, 시스템 테마와 실제 회사 조직 규모에서의 화면은 직접 확인하지 않았다.

## 남은 질문

제품 동작에 대한 추가 질문은 없다. 실제 위젯 및 복제 DB 왕복 검증은 배포 전 수행해야 한다. 버전 갱신과 push는 하지 않는다.
