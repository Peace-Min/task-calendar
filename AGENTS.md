# 작업 규칙 (AI 에이전트용)

이 저장소에서 일하는 에이전트(Codex, Claude 등)가 먼저 읽는 파일이다. 사용자가 "기획 개발 QA 위키로 진행해: <작업>" 이라고만 지시해도 아래 절차를 그대로 따른다.
답변, 문서, 커밋 메시지는 한국어로 쓴다.

## 1. 프로젝트 한눈에

- 근태 작성 UI를 이어서 작업할 때는 [최신 인계](docs/handoff/2026-10-27-attendance-composer.md)와 [A/B/C 시안](docs/prototypes/attendance-composer/README.md)을 먼저 확인한다. 캘린더 활용 및 여러 과제 편집 방식은 시안 검토 중이며 구현 확정으로 해석하지 않는다.

- 수행과제 캘린더: WPF(.NET 9) 위젯(`widget/*.cs`)이 단일 HTML 화면(`task-calendar-prototype.html`)을 WebView2 로 띄우고, 사내 MySQL(`taskcalendar` DB)에 저장한다.
- 큰 그림: `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, 위키 `docs/wiki/Home.md`.
- 시험: `tests/README.md`. DB 배포 규칙: `docs/DB-RELEASE-OPS.md`, `docs/VERSION-GATE.md`.
- 기능별 기획서는 `docs/<기능>.md` 에 있다. 비슷한 기능을 고치기 전에 해당 기획서와 `docs/DECISIONS.md` 를 먼저 읽는다.
- **근태 및 보고 작업의 필수 정본:** [docs/ATTENDANCE-REPORT-POLICY.md](docs/ATTENDANCE-REPORT-POLICY.md)를 먼저 읽는다. 회사 성공 확인 후에만 관련 DB 변경 전체를 한 트랜잭션으로 저장한다. 어느 단계든 실패하면 편집창과 입력 유지, 공통 실패 안내, 재시도는 회사 보고부터 실행한다. 회사와 DB의 분산 원자성을 구현한다고 확대하지 않는다. 이 정책을 위해 작성본 DB 선저장, DB 전용 재시도, 로컬 복구 큐 및 자동 대조를 추가하지 않는다. 이슈 #17 초기 명세와 충돌하면 이 정본을 따른다. 작업 전후 `node tests/audit-attendance-policy.mjs`로 확인하고 미통과 및 미검증을 인계한다.
- 실제 운용은 폐쇄망(사내 서버 DB, 공유 폴더)이다. 이 저장소를 여는 PC 는 개발용이다.

## 2. 절차: 기획, 개발, QA, 위키

### 2.1 기획
- `docs/<기능>.md` 에 배경, 바꾸는 것, 하지 않는 것, 결정(누가 정했는지), 순서를 짧게 쓴다.
- 화면이 바뀌면 `dist/proto/<이름>.html` 에 A/B 시안을 나란히 만들어 보여 준다(`dist/` 는 커밋되지 않는다).
- 사용자가 정해야 할 것은 추천안과 함께 묻는다. **승인 전에는 개발하지 않는다.**
- 범위가 사용자 설명보다 커질 것 같으면 시작 전에 한 줄로 알린다.

### 2.2 개발
- 작업 하나에 브랜치 하나: `feat/db-app` 에서 `codex/<주제>`(또는 `<에이전트>/<주제>`)를 만든다.
- 주변 코드의 문체, 이름, 주석 밀도를 따른다. 한두 줄짜리 자명한 수정에 큰 리팩터링을 섞지 않는다.
- `widget/MainWindow.xaml.cs` 는 줄끝이 `\r\r\n` 이다(.gitattributes `-text`). 바이트를 보존하는 방법으로 고친다.
- DB 구조를 바꾸면:
  - 이관 조각 `db/deploy/migrations/vNN-<이름>.sql` 을 새로 만든다. 규칙은 `installer/release-sql.ps1` 머리말과 `docs/DB-RELEASE-OPS.md` §5 이고, 본보기는 기존 v17, v18, v19 이다. 다시 돌려도 안전해야 하고, 검증 뒤 구조 번호를 정확한 한 줄로 올린다. 주석에도 DELIMITER, PROCEDURE, FUNCTION, TRIGGER, DEFINER 낱말을 쓰지 않는다.
  - 정본 스키마(`db/deploy/schema-structure.sql`, `schema-calendar.sql`)와 `widget/DbGate.cs` 의 `AppStructureVersion` 을 같이 맞춘다.
  - `tests/release-sql-sim.mjs` 와 `tests/release-sql.test.mjs` 에 새 문장과 경우를 더한다.
- 데이터끼리 묶는 규칙(한 칸 값에 따라 다른 칸을 자동으로 비우거나 잠그는 것)을 새로 만들지 않는다(`docs/DECISIONS.md` 결정 8).

### 2.3 QA
- 개발 중에는 바뀐 곳과 관련된 시험 파일만 돌린다. 작은 러너: `tests/harness.mjs` 를 import 하고, 시험 파일을 import 한 뒤 `await run()`. 표준 입력은 비워서 돌린다(`< /dev/null`).
- 끝에 한 번 전체: `TC_TEST_STRICT=1 node tests/run-tests.mjs` 가 **exit 0, fail 0, skip 0** 이어야 한다. skip 이 있으면 통과가 아니다.
- 위젯 빌드: `dotnet build widget/TaskCalendarWidget.csproj -c Debug` 경고 0, 오류 0(위젯이 떠 있어 잠기면 `-o <다른 폴더>`).
- 시험이 깨지면 시험부터 고치지 말고 원인을 먼저 본다. 변이 시험(mutation)은 실제로 무는지 확인한다.
- 실제 위젯 루프(`tests/loop-*.mjs`, CDP 9222)와 DB 시험(`tests/db-*.mjs`, `calendar-adapter.mjs` 등)은 Windows 개발 PC 에서만 돈다. 못 돌렸으면 인계 보고의 "확인 못 한 것"에 적는다.
- DB 관리자 비밀번호는 환경 변수 `TC_TEST_DB_ADMIN_PW` 로만 받는다. 파일, 로그, 명령줄 인자에 쓰지 않는다.

### 2.4 위키
- `docs/wiki/` 의 관련 쪽을 고치거나 새로 만들고 `Home.md`, `_Sidebar.md` 에 잇는다.
- `CHANGELOG.md` 맨 위에 **버전 번호 없는** 제목으로 적는다(예: `## 🆕 2026-10-30 (다음 판, 번호는 배포 때): <요약>`). 제목에 `vX.Y.Z` 를 쓰면 버전 시험이 깨진다.
- 기획서의 상태 줄을 "구현 완료(날짜, 커밋)" 로 고친다.

## 3. 하지 않는 것

- **버전 갱신을 하지 않는다**: csproj 버전, `APP_VERSION`, 앱 안 패치노트(`#patchModal`), `RELEASE_NOTES.md`, `installer/task-calendar.iss`. 사용자가 검토 뒤 따로 한다.
- 공개 저장소에 회사 실데이터(과제 목록, 직원 명단), 비밀번호, 폐쇄망 서버 주소를 넣지 않는다. 회사 데이터는 비공개 저장소 `taskmgr-company-data` 몫이다.
- `git stash` 를 쓰지 않는다(다른 세션과 공유된다). 임시로 비켜 둘 것은 WIP 커밋으로 둔다.
- 실제 사용자 데이터나 공용 DB 를 바꾸지 않는다. 시험 데이터는 `zz` 접두사로 만들고 끝나면 지운다. DB 실험은 `zz_` 로 시작하는 복제 DB 에서 한다.
- 사용자가 "푸쉬" 라고 하기 전에는 push 하지 않는다.

## 4. 글 규칙

- 화면 문구, 문서, 커밋 메시지, 답변에 엠 대시(—), en 대시(–), 띄어 쓴 가운데 점 구분자( · ), 낫표(「」)를 쓰지 않는다. 쉼표, 마침표, 괄호로 쓴다.
- 짧고 자연스러운 문장. 번역체와 과장을 피한다.

## 5. 인계 보고 (작업 끝에 반드시)

`docs/handoff/<YYYY-MM-DD>-<주제>.md` 를 만들고 커밋한다. 다음 검토자가 이 파일부터 읽는다.

```markdown
# <주제> 인계 보고 (<날짜>, 브랜치 <이름>, 마지막 커밋 <해시>)

## 한 줄 요약
## 바뀐 것 (파일과 이유)
## 결정
- 사용자가 정한 것:
- 내가 정한 것(검토 필요):
## 시험 (명령과 결과 숫자)
- 관련 시험:
- 전체 strict: <pass / fail / skip, exit>
- 빌드:
## 확인 못 한 것 (실제 위젯, 실제 DB, 다른 테마 등)
## 남은 질문
```

"확인 못 한 것"은 비워 두지 않는다. 직접 확인하지 않은 것을 확인한 것처럼 쓰지 않는다.
