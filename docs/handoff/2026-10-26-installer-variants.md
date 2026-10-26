# 설치기 두 종류 인계 보고 (2026-10-26, 브랜치 feat/db-app, 마지막 구현 커밋 c1cb86d)

## 한 줄 요약

배포 cmd 한 번에 공유폴더 업데이트용과 WebView2 포함 Full을 만들고, 자동 업데이트는 작은 설치기를 사용한다.

## 바뀐 것 (파일과 이유)

- `installer/task-calendar.iss`: 기본 업데이트용, `/DFullInstaller=1`은 Full. Full에만 런타임을 포함하고 `-full` 파일명을 사용한다. 업데이트용은 InitializeSetup에서 WebView2 미설치를 감지하면 Full을 안내하고 설치 전에 종료한다.
- `installer/build-installer.ps1`: 런타임 파일 사전 검사, 앱 publish 한 번, 두 변형 컴파일, 각 산출물 존재 확인과 크기 및 SHA256 출력. 어느 한쪽이라도 실패하면 중단.
- `installer/배포-빌드.cmd`: 두 파일 안내, 실행 결과 코드 보존. PowerShell 7에서 호출해도 Windows PowerShell 기본 모듈이 우선되도록 자식 프로세스의 모듈 경로를 설정한다. 실제 cmd 시험에서 Get-FileHash 탐색 실패를 확인해 수정했다.
- `installer/publish-update.ps1`: 업데이트용 및 Full 용도 안내. 기존 파일명과 업데이트용 해시 계약 및 `-CopyTo` 범위는 유지.
- `tests/installer-webview.test.mjs`: 두 변형, Full 필수 파일, 사전 중단, 두 번 컴파일과 업데이트용 배포 정보 계약 및 변이 검출.
- `docs/INSTALLER-VARIANTS.md`, 기존 기획서, `docs/DB-RELEASE-OPS.md`, installer와 redist README, 위키와 변경 이력: 새 정책으로 안내.

## 결정

- 사용자가 정한 것: B안. 매번 배포 cmd에서 기존 이름의 업데이트용과 `-full.exe` 처음 설치용 생성. 자동 업데이트와 latest.json, SQL의 파일명 및 해시는 업데이트용 기준. 빌드 PC 런타임 파일은 계속 필수. 업데이트용의 미설치 PC 실행은 안내 후 중단.
- 내가 정한 것(검토 필요): Inno 직접 컴파일 기본은 업데이트용. 차단은 파일 설치 전 InitializeSetup에서 하며, 억제 가능한 오류 안내를 사용해 무인 실행도 종료한다. AppId와 설치 위치는 두 종류가 동일하다. 기존 `-CopyTo`는 Full을 복사하지 않으며 새 PC용으로 별도 전달하거나 구분해 올린다.
- 버전, DB 구조, 앱 기능은 변경하지 않았다. 공유폴더에서 런타임을 따로 찾는 C안은 구현하지 않았다.

## 시험 (명령과 결과 숫자)

- 관련 시험: `tests/harness.mjs`의 run으로 `tests/installer-webview.test.mjs` 실행, 7 pass / 0 fail / 0 skip. 필수 파일 검사 및 미설치 차단을 지운 변이를 검출한다. 표준 입력은 빈 문자열 파이프.
- 실제 배포 cmd: `cmd /d /c "installer\배포-빌드.cmd < nul"`, exit 0. 동일 exe로 두 설치기와 latest.json, release SQL을 생성했다. 사용자 데이터와 공용 DB는 변경하지 않았다.
- 누락 실패: redist 없는 격리 소스에서 PowerShell 빌드 exit 1, `/DFullInstaller=1` Inno 컴파일 exit 2. 모두 런타임 파일 누락으로 중단.
- 초기 차단 실행 시험: 실제 소스의 설치 이벤트 코드를 격리된 작은 Inno 시험 설치기에 사용하고 런타임 감지만 주입했다. `/VERYSILENT /SUPPRESSMSGBOXES /SP- /NORESTART`로 실행. 업데이트용+미설치 판정 exit 1, 파일 생성 0. 업데이트용+설치 판정 exit 0, 시험 파일 생성. Full+미설치 판정 exit 0, 시험 파일 생성. 세 경우 모두 실제 사용자 앱, 레지스트리 및 WebView2 설치를 건드리지 않는 격리용 파일이다.
- 전체 strict: `TC_TEST_STRICT=1 node tests/run-tests.mjs`, 3150 pass / 0 fail / 0 skip, exit 0.
- 빌드: `dotnet build widget/TaskCalendarWidget.csproj -c Debug`, exit 0, 경고 0개 / 오류 0개.
- 배포 정보: latest.json의 file 및 sha256, release SQL의 파일명과 해시를 실제 업데이트용에 대조해 일치 확인. SQL에 `-full.exe` 없음.

## 산출물(커밋 제외)

- `dist/installer/TaskCalendarWidget-Setup-v0.24.0.exe`: 53482604 bytes, 약 51.0 MiB. SHA256 `bc6cd83d730b6ebd441b6e03bd42d2049d3469c36fada4d9547fd1542b7dd760`.
- `dist/installer/TaskCalendarWidget-Setup-v0.24.0-full.exe`: 267527118 bytes, 약 255.1 MiB. SHA256 `9b2c437a299a2d8206f2db7582bd80594a4f0caf5d17f1f9cfaee9fd36e404fb`.
- `dist/installer/latest.json`, `release-v0.24.0.sql`: 업데이트용 기준으로 로컬 생성. 공유폴더 복사 및 SQL 실행은 하지 않았다.
- 증거: `dist/proto/split-tests.log`, `split-cmd-build.log`, `split-strict.log`, `split-debug-build.log`, `split-missing-powershell.log`, `split-missing-inno.log`.
- 초기 차단 재현 스크립트: `dist/proto/installer-guard-probes.py`, 생성물과 실행 로그 `dist/proto/installer-guard-probes/`.

## 확인 못 한 것 (실제 위젯, 실제 DB, 다른 테마 등)

실제 WebView2 미설치 PC/VM에서 Full의 런타임 설치와 앱 실행을 확인하지 않았다. 실제 사내 공유폴더에서 자동 업데이트도 실행하지 않았다. 미설치 차단은 감지 결과를 주입한 격리 시험이며 실제 레지스트리 감지를 새 PC에서 시험한 것은 아니다.

## 남은 질문

추가 제품 결정은 없다. 배포 전 새 PC에서 Full 설치와 이후 업데이트용 갱신을 확인해야 한다. 버전이 그대로 0.24.0이므로 이미 같은 버전인 사용자는 자동 업데이트 대상이 되지 않는다. 버전 갱신, push, 서버 발행은 하지 않았다.
