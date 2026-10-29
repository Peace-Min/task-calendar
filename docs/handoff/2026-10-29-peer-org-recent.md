# 타인 일정 고르기 조직도 본인 표시와 최근 본 사람 삭제 인계 보고 (2026-10-29, 브랜치 codex/peer-org-recent, 마지막 커밋 a19cbed)

## 한 줄 요약

타인 일정 고르기 팝오버(`#peerPicker`)의 '조직도' 탭과 '내 부서' 묶음에 본인(`(나)`, 비활성, 인원수 포함)을 표시하고, '최근 본 사람' 묶음에 행별 `✕` 지우기 단추와 머리말 `전체 지우기` 단추를 추가했다.

## 바뀐 것 (파일과 이유)

- `task-calendar-prototype.html`:
  - `pkModel`, `pkOrgIndex`, `pkDirRow`, `pkUnitListEl`: 조직도 직속 명단 및 인원수(`count`), 사람 탭의 '내 부서' 명단(`mine`)과 인원수(`mineCount`)에 본인을 포함하고 `isMe: true`를 표시한다. 즐겨찾기, 최근 본 사람, 검색 결과에서는 기존대로 본인을 제외한다.
  - `pkRowEl`: `r.isMe` 행에 `aria-disabled="true"`, `title="나 자신입니다"`, 이름 옆 ` (나)` 꼬리표(`.pk-tag`)를 붙이고 오른쪽 단추를 생략한다. 재직 중인 최근 본 사람(`!r.isMe && !r.gone && kind === 'Recent'`) 행에는 `☆` 단추 옆에 `✕` 지우기 단추(`.pk-del`, `data-act="forget"`, `data-kind="Recent"`)를 그린다.
  - `pkSection`, `pkForget`, `pkPick`, `pkOnClick`: '최근 본 사람' 머리말 오른쪽에 `전체 지우기` 단추(`data-act="clear-recent"`)를 두고, 빈 `id`로 `pkForget('Recent', '')`을 호출할 때 최근 목록 전체를 비우도록 확장했다. `pkPick`에서도 본인 ID 선택을 방어한다.
- `tests/peer-picker.test.mjs`, `tests/peer-picker-org.test.mjs`, `tests/loop-peer-frame.mjs`:
  - 조직도 및 내 부서 본인 포함(`isMe: true`, `(나)` 꼬리표, `aria-disabled="true"`, 인원수 포함)과 최근 본 사람 행별 `[☆] [✕]` 단추 및 `전체 지우기` 동작, 변이 시험을 갱신 및 추가했다.
- `docs/PEER-ORG-RECENT.md`, `docs/PEER-PICKER.md`, `docs/PEER-PICKER-ORG.md`, `docs/wiki/다른-사람-일정-보기.md`, `docs/wiki/Home.md`, `CHANGELOG.md`:
  - 신규 기획서 작성 및 기존 기획서, 위키, 변경 기록(버전 번호 없는 제목)을 최신 동작에 맞춰 갱신했다.

## 결정

- 사용자가 정한 것:
  - 본인 표시 범위(시안 B): '조직도' 탭과 '사람' 탭의 '내 부서' 묶음 모두에 본인(`(나)`, 비활성, 부서 인원수 포함)을 넣는다.
  - 최근 본 사람 삭제(시안 B): 최근 본 사람 각 행 오른쪽에 `[☆] [✕]` 단추를 나란히 두고, '최근 본 사람' 머리말 오른쪽에 `전체 지우기` 단추도 둔다.
  - 브랜치: 메인이나 `feat/db-app`이 아닌 별도 브랜치(`codex/peer-org-recent`)에 커밋한다.
- 내가 정한 것(검토 필요):
  - 별도 함수(`pkClearRecent`)를 늘리는 대신 기존 `pkForget(kind, id)`가 빈 `id`를 받으면 해당 목록 전체를 비우도록 통일했다.
  - 버전 번호와 배포 파일은 건드리지 않았다.

## 시험 (명령과 결과 숫자)

- 관련 시험: `tests/peer-picker.test.mjs`, `tests/peer-picker-org.test.mjs` 단독 실행, 65 pass / 0 fail / 0 skip, exit 0.
- 문장 부호 및 버전 동기화 시험: `tests/ui-copy-punct.test.mjs`, `tests/version-sync.test.mjs` 통과.
- 전체 strict: `cmd /c "set TC_TEST_STRICT=1&& node tests/run-tests.mjs < NUL"`, 3151 pass / 0 fail / 0 skip, exit 0(88개 시험 파일 전원 통과). 형제 폴더 `../taskmgr-company-data` 연결 후 권한 및 스키마 검증까지 모두 통과했다.
- 빌드: `dotnet build widget/TaskCalendarWidget.csproj -c Debug -o dist/build-check`, exit 0, 컴파일 오류 0개, 코드 경고 0개(오프라인 환경 NuGet 취약점 목록 참조 안내 NU1902 2건).

## 확인 못 한 것 (실제 위젯, 실제 DB, 다른 테마 등)

- 실제 배포용 폐쇄망 서버 DB 및 원격 공유 폴더와의 연동은 확인하지 못했다(로컬 개발 PC의 MySQL 8.4 및 `dist/proto/peer-org-recent.html` 시안으로 검증).

## 남은 질문

- 추가 질문은 없다. 검토 후 배포 시점에 버전 갱신과 브랜치 병합을 진행하면 된다.
