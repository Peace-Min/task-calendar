# 구성원 편집 작업 재개 인계 보고 (2026-10-27, 브랜치 codex/member-org-order, 통합 커밋 ad883c3)

## 한 줄 요약

사용자 요청대로 db-app을 push한 뒤 구성원 편집 브랜치에 최신 변경을 통합하고 회귀 검증을 진행했다.

## 바뀐 것 (파일과 이유)

- `feat/db-app`의 `1277422`까지 원격 push했다. 작업 트리는 깨끗해 추가로 커밋할 미반영 변경은 없었다.
- `codex/member-org-order`에 `feat/db-app`을 merge했다. 설치기 두 종류 정책과 빈 캘린더 안내 삭제가 함께 들어왔다.
- `CHANGELOG.md`, `docs/wiki/Home.md`, `_Sidebar.md`의 추가 위치 충돌은 구성원 편집과 설치기 기록을 모두 보존해 해결했다.
- 구성원 편집 구현 자체는 기존 `f06f86f`와 같다. 전체 명부 하나를 기준으로 조직별 필터와 순서 이동을 유지한다. 기존 기획은 `docs/MEMBER-ORG-ORDER.md`, 최초 인계는 `2026-10-26-member-org-order.md`를 참고한다.

## 결정

- 사용자가 정한 것: 커밋과 push 후 구성원 편집 브랜치 작업 재개.
- 내가 정한 것(검토 필요): 기존 구현 커밋과 인계의 참조를 유지하도록 rebase 대신 merge했다. 양쪽 문서 기록은 모두 남겼다. 기능 범위는 넓히지 않았다.

## 시험 (명령과 결과 숫자)

- 관련 시험: `tests/harness.mjs`의 run으로 `user-admin.test.mjs`, `member-org-order.test.mjs`, `installer-webview.test.mjs` 실행. 212 pass / 0 fail / 0 skip, exit 0. 표준 입력은 빈 문자열 파이프.
- 전체 strict: `TC_TEST_STRICT=1 node tests/run-tests.mjs`, 3157 pass / 0 fail / 0 skip, exit 0.
- 빌드: 기본 Debug 출력은 실행 중인 TaskCalendarWidget이 잠가 실패했다. 앱은 종료하지 않았다. `dotnet build widget/TaskCalendarWidget.csproj -c Debug -o dist/proto/member-resume-widget`로 별도 출력하여 exit 0, 경고 0개 / 오류 0개를 확인했다.
- `git diff --check --cached`: 문서 충돌 해결 후 통과.
- 브라우저: Playwright로 실제 HTML에 가상 조직과 명부 30명만 주입했다. 가팀의 1번을 아래로 옮기면 전체 앞 네 자리가 [3, 2, 1, 4]로 바뀌어 다른 팀의 2번과 4번 자리가 유지됨을 확인했다. 밝은, 어두운, 포레스트, 세피아, 고대비, 시스템 테마 각각 1100px와 390px에서 트리 및 본문 가로 넘침 0을 확인했다. 좁은 폭의 여섯 테마 캡처를 직접 검토했다. 시스템 테마는 이 브라우저의 현재 시스템 설정 기준이다.
- 로그(커밋 제외): `dist/proto/member-resume-related.log`, `member-resume-strict.log`, `member-resume-build.log`, `member-resume-build-alt.log`.
- 화면 증거(커밋 제외): `dist/proto/member-resume-<theme>-<width>.png` 12개, 동작 기록 `member-resume-browser.log`. 브라우저 콘솔 오류는 favicon.ico 404 한 건이며 앱 스크립트 오류는 없었다.

## 확인 못 한 것 (실제 위젯, 실제 DB, 다른 테마 등)

후속 확인: 아래 작성 당시 미확인 사항 중 요청한 실제 구성원 관리 루프 두 시드와 UI 무결성 한 시드는 같은 날 완료했다. 결과와 남은 범위는 [실제 위젯 및 DB 루프 보고](2026-10-27-member-live-qa.md)를 참고한다.

실제 위젯과 DB에 쓰는 루프는 실행하지 않았다. CDP 9222가 열려 있지 않고 `TC_TEST_DB_ADMIN_PW` 환경 변수도 없다. 실행 중인 사용자 위젯을 종료하거나 사용자 데이터와 공용 DB를 변경하지 않았다. 브라우저 검증은 가상 명부 기준이며 실제 회사 조직 규모와 다중 관리자 DB 왕복은 확인하지 않았다.

## 남은 질문

새 제품 결정은 없다. 실제 위젯과 복제 DB의 저장 왕복 확인은 배포 전 필요하다. 버전 갱신과 구성원 기능의 db-app 병합은 하지 않았다.
