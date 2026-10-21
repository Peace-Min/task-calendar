# DB 버전 관문과 DB 기반 업데이트 (VERSION-GATE)

- 상태: 기획 확정(2026-10-21, 차단 화면 시안 승인). 운용 기준은 [DB-RELEASE-OPS.md](DB-RELEASE-OPS.md), 이 문서는 그것을 코드로 옮기는 기획이다.
- 목표 버전: 앱 **0.23.0**, DB 구조 번호 **14**.
- 범위 밖: 피드백 반영(회의실 등), 서버 주소(`DbHost`)와 공유 폴더 경로 값(배포 때 넣는다).

## 1. 바꾸는 것 한눈에

| 영역 | 지금 | 바뀐 뒤 |
|---|---|---|
| 판정 값 | `cal_schema_meta.schema_version`, 부팅 때 1회 읽기 | 키 다섯 개(`db_structure_version`, `db_updating`, `app_latest_version`, `app_installer_file`, `app_installer_sha256`), 연결 열 때마다 읽기 |
| 다를 때 | 빨간 띠, 가져오기와 초기화만 차단 | 읽기와 쓰기 모두 차단, 전체 화면 안내 |
| 연결 여는 곳 | 7곳이 각자 생성 | 관문 `DbGate` 한 곳(핑 제외) |
| 업데이트 정보 | 공유 폴더 `latest.json` | DB 의 `app_` 세 키, 파일만 공유 폴더 |
| 배포 스크립트 | `latest.json` 을 exe 보다 먼저 복사 | exe 만 복사하고 `app_` 갱신 SQL 을 만들어 준다 |

## 2. 호스트(C#)

### 2.1 관문 `DbGate`

- 새 정적 클래스(`widget/DbGate.cs`). 데이터를 다루는 연결은 모두 여기서 연다: `CalendarDb.OpenReadAsync`, `CalendarWriteDb.SaveAsync`, `ProjectDb.OpenReadAsync / OpenWriteAsync / OpenAdminAsync`, `ReportDb.OpenWriteAsync`. 각 헬퍼는 연결 생성 대신 `DbGate.OpenAsync(connString, ct)` 를 부르고, 권한 판정 같은 자기 일은 그 뒤에 그대로 한다.
- `OpenAsync` 순서: `DbFault.ThrowIfActive()`, 연결 열기(실패 시 정리 후 그대로 던짐), `SELECT k, v FROM cal_schema_meta WHERE k IN (...)` 한 번, 판정. 프리앰블은 지금처럼 호출자가 건다(격리 수준이 경로마다 다르다).
- 판정(`GateVerdict`): `Ok`, `Updating`(`db_updating = 1`), `NeedUpdate`(DB 구조 번호 > 앱), `ServerOld`(DB < 앱), `Unknown`(행 없음, 숫자 아님). `Ok` 가 아니면 연결을 닫고 `DbGateException(verdict, meta)` 을 던진다.
- 앱의 구조 번호 상수: `CalendarDb.ExpectedSchemaVersion` 을 `DbGate.AppStructureVersion = 14`(정수)로 옮긴다. 비교는 정수로 한다.
- 예외: `DbGate.ReadReleaseAsync()` 는 판정 없이 `app_` 세 키만 읽는다. 업데이트 확인 전용이다.
- 마지막 판정은 `DbGate.Last` 에 스레드 안전하게 둔다(보고 재시도가 `Task.Run` 위에서 돈다).
- 핑(`OfflineHost` dbPing)은 관문을 지나지 않는다. 데이터를 다루지 않는다.

### 2.2 쓰기 재확인

- `CalendarWriteDb.SaveAsync`: 삭제 루프가 끝난 뒤, `CommitAsync` 바로 앞에서 `cal_schema_meta` 를 **잠금 없이** 한 번 더 읽어 `Ok` 가 아니면 롤백하고 관문 오류로 돌려준다. rev 증가가 첫 문장이어야 하는 규칙(155-158)과 commit-lost 주입 위치(484)는 그대로 둔다.
- `FOR SHARE` 를 쓰지 않는 이유: MySQL 8 은 `FOR SHARE` 에 SELECT 말고 UPDATE, DELETE, LOCK TABLES 중 하나를 더 요구한다. 최소 권한 계정(`cal_schema_meta` SELECT 만)에서 실패한다. 커밋 직전 재확인으로 틈은 사실상 0 이다.
- `ProjectDb`, `ReportDb` 쓰기는 열 때 판정으로 충분하다(관리자 경로, 짧은 트랜잭션).

### 2.3 오류 분류와 회신

- `DbErrors` 에 kind `gate` 를 더한다. 세부는 `verdict`(updating, needUpdate, serverOld, unknown). 재시도 대상이 아니다.
- 지금 kind 가 웹에 닿지 않는 경로(ProjectDb 읽기와 쓰기 회신, 열람 창 `peerSchedule`, `membersGet`, 로그인 회신)도 관문 오류만큼은 `{ ok:false, kind:'gate', gate:{...} }` 로 실어 보낸다.
- 어느 경로에서든 관문 오류가 나면 호스트가 `__versionGate(state)` 를 메인 창(그리고 열려 있으면 열람 창)에 민다. 웹은 회신을 기다리지 않고 이 푸시로 화면을 바꾼다.

### 2.4 회사 보고 전송 전 확인

- `INetcusHost` 에 `Task<bool> GateOkAsync()` 를 더한다(관문으로 연결을 한 번 열고 닫는다). `netcusSubmit`(MainWindow:593), `netcusWeekSubmit`(805) 진입 직후 부르고, 막히면 회사 사이트에 접속하지 않고 관문 화면으로 간다.

### 2.5 재확인 루프

- 막힌 상태: `Updating` 은 30초, `ServerOld` 와 `Unknown` 은 5분마다 호스트가 관문을 다시 연다(`gateRecheck`). `Ok` 가 되면 `__versionGate({state:'ok'})` 를 밀고 웹이 `reloadState` 한다. `NeedUpdate` 는 사용자가 업데이트하기 전에는 바뀌지 않으니 재확인하지 않는다.
- 정상 상태: 30분 업데이트 확인(아래 2.6)이 DB 를 읽는다. "정상일 때 주기 DB 접속 없음"(A11) 원칙의 예외로 문서에 적는다(PC 당 30분에 키 세 개 읽기).

### 2.6 업데이트(`Update.cs`)

- 확인: `latest.json` 대신 `DbGate.ReadReleaseAsync()`. `app_latest_version` 이 자기보다 높으면 배너(정상) 또는 차단 화면의 버튼(막힘). 파일은 `UpdateSourceUrl` 폴더의 `app_installer_file`, 해시는 `app_installer_sha256`. 다운로드, 대조, `/SILENT /UPDATED=1` 은 지금 코드를 쓴다.
- 막혔는데 받을 새 버전이 없거나(운영 실수: `app_` 값 누락, Setup 미업로드) 파일을 찾지 못하면, 별도 상태를 두지 않고 업데이트 필요 화면의 버튼 아래에 "새 버전 파일을 찾을 수 없습니다. 관리자에게 문의해 주세요" 를 띄운다(2026-10-21 결정, 재확인 루프 없음).
- 설치 시도 기록: Setup 을 띄우기 직전 `%LOCALAPPDATA%\TaskCalendar\update-attempt.json`(목표 버전, 시각)을 쓴다. 다음 실행에서 자기 버전이 목표보다 낮으면 `installFailed` 를 웹에 알리고 기록을 지운다. 같은 목표로 두 번 실패하면 자동 재시도 버튼 대신 수동 설치 안내만 보인다.
- 수동 설치 경로 표시: `UpdateSourceUrl` 과 파일 이름을 합쳐 보여 주고 복사 버튼을 둔다.
- `UpdateSourceUrl` 설정 UI 는 그대로 둔다(폴더 위치만 뜻하게 문구를 고친다).

## 3. 웹(`task-calendar-prototype.html`)

- 차단 화면: 로그인 게이트 `.lg-gate`(fixed, inset 0) 본을 따르는 전체 화면 카드 `#vgGate`. 상태는 프로토타입 `docs/prototypes/version-gate.html` 을 따르되 "새 버전 준비 중" 은 뺀다. 남는 상태: updating(갱신 중), needUpdate(업데이트 필요), 업데이트 진행 중, installFailed(설치 실패), serverOld(관리자 문의), 열람 창용. 확정 사항(2026-10-21): 뒤 화면은 흐리게 보이기, 제목줄은 덮지 않음(창 이동, 최소화, 닫기 가능), 기술 정보(구조 번호, 앱 버전)는 "자세한 정보" 에 접어 둠, 막힘 제목 "새 버전이 필요합니다" 와 정상 배너 "새 버전이 있습니다" 를 구별.
- `__versionGate(state)`: 상태 반영, 편집 잠금(`db-locked` 재사용), 저장 큐 정지. `ok` 로 돌아오면 카드를 닫고 `reloadState`.
- 저장 안 된 변경: `unsaved` 가 참이면 카드에 경고 문구만 띄운다(변경 목록과 목록 복사는 두지 않는다, 2026-10-21 결정).
- 기존 빨간 띠(`renderDataSourceBadge` 의 스키마 불일치 문구)와 `schemaBlocked` 토스트는 관문 화면으로 대체한다. 읽기 전용 배지는 남긴다.
- 업데이트 배너: 정상 상태의 배너는 지금 그대로. 막힌 상태에서는 배너 대신 카드의 버튼을 쓴다.
- 열람 창(`?peerwin=1`): 같은 카드의 작은 변형, 업데이트 버튼 없이 "메인 창에서 업데이트해 주세요".

## 4. DB 와 스크립트

- 이관 `db/deploy/migrate-2026-10-21-version-gate.sql`(13 에서 14): DB-RELEASE-OPS §5 의 형식을 처음 따르는 파일. `schema_version = '13'` 확인, 닫기(이 판만 예외로 `db_updating` 행을 먼저 만든다), 새 키 다섯 개 넣기, `schema_version` 행 지우기, 열기. 다시 돌려도 안전하게.
- 정본 `db/deploy/schema-calendar.sql`: 시드를 새 키 다섯 개로(`app_` 값은 빈 문자열로 시드하고, 빈 값이면 업데이트 없음으로 본다). 표 주석과 `cal_schema_meta` 설명 갱신.
- 키를 읽는 스크립트를 새 키로: `setup-taskcalendar.ps1`, `init-calendar.ps1`, `restore-taskmgr.ps1`, `scope-all.ps1`, `db/demo/*`, `tools/schema-report/*`. 지난 이관(`migrate-2026-10-15-code-ids.*`)은 고치지 않는다(12 에서 13 전용, 이력).
- `installer/publish-update.ps1`: `latest.json` 을 만들지 않는다. Setup 만 복사하고(옛 파일 유지), `dist/installer/release-v<버전>.sql`(앱만 바뀐 배포용 `app_` 세 줄 갱신, 구조 번호 확인 포함)을 만들어 경로를 알려 준다.
- 워크스페이스 `CLAUDE.md` 릴리스 체크리스트의 `latest.json` 항목을 `release-v<버전>.sql` 과 해시 대조로 바꾼다.

## 5. 시험

- 바뀌는 고정: `schema-guards` ⑥⑨⑩, data-source 낡은①~⑥과 변이㉗~㉚(특히 ⑥ 의 SELECT 전용 권한 강제는 유지), `canon-schema`, `schema-integrity` 계약⑥, `calendar-adapter`(프리앰블), `setup-taskcalendar`, `code-ids-db`, `demo-db`, `admin-auth`·`user-login` 불변식(ProjectDb 의 `new MySqlConnection` 3곳 고정을 "관문 밖 0곳" 으로), `offline-host` 주입⑦(모든 연결이 `DbFault` 를 지남).
- 새 시험:
  - 관문 판정 표(값 조합별 verdict, 정수 비교, 빈 값, 숫자 아님).
  - "`new MySqlConnection(` 은 `DbGate.cs` 와 핑에만" 정적 불변식.
  - 쓰기 재확인이 COMMIT 바로 앞, rev 증가 뒤에 있는지.
  - 보고 전송 전 확인이 사이트 접속보다 앞에 있는지.
  - 이관 SQL: 13 에서 14, 다시 돌리기, 이미 14, 13 도 14 도 아닌 값에서 멈춤(실제 MySQL, 같은 권한 시험 계정).
  - 웹: `__versionGate` 상태별 카드, 편집 잠금, `ok` 복귀.
- `tests/loop-schema-gate.mjs`: 의미가 반대가 된다("서버 값이 다르면 통상 저장도 막힌다", "db_updating 1 이면 대기 후 복귀").

## 6. QA (실제 위젯, 이 PC MySQL)

- 정상: 저장, 조회, 열람 창, 배너(앱만 바뀐 배포 흉내: `app_latest_version` 만 올림).
- `db_updating = 1`: 메인과 열람 창 모두 대기 화면, 30초 안에 자동 복귀.
- 구조 번호를 15 로: 업데이트 필요 화면, 공유 폴더(로컬 시험 폴더)에 Setup 이 있으면 버튼으로 설치까지(실제 설치는 이 PC 설치본으로 확인, 끝나면 원래 버전으로 되돌림).
- 구조 번호를 13 으로: 관리자 문의 화면.
- 저장 안 된 변경이 있는 채로 막힘: 경고 상자.
- 회사 보고 전송: 막힌 상태에서 사이트 접속을 시도하지 않음(로그로 확인, 실제 전송 금지).
- 설치 실패 흉내: 기록 파일만 남기고 버전 그대로 재시작.
- 시험이 끝나면 `cal_schema_meta` 와 설정 파일을 원래 값으로 되돌린다.

## 7. 위키

- `docs/wiki/` 에 "앱 업데이트와 서버 갱신 안내"(사용자용: 화면별 뜻과 할 일) 한 쪽.
- 운영자용은 DB-RELEASE-OPS 가 정본이라 위키에서는 링크만.
