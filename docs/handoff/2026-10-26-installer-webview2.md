# 설치기 WebView2 패키징 인계 보고 (2026-10-26, 브랜치 feat/db-app, 마지막 구현 커밋 2bcb5d2)

## 한 줄 요약

공식 WebView2 오프라인 x64 런타임을 설치기에 필수 포함하고 파일 누락 시 빌드를 중단한다. 새 설치기를 로컬에 만들었다.

## 바뀐 것 (파일과 이유)

- `installer/task-calendar.iss`: 조건부 번들을 필수 번들로 전환. 파일이 없으면 전처리 오류. 기존 런타임 감지와 설치 순서, `/silent /install`, 종료 대기는 유지.
- `installer/build-installer.ps1`: publish 전에 런타임 파일 누락을 검사.
- `tests/installer-webview.test.mjs`: 필수 포함, 설치 순서, 사전 검사 및 검사를 제거하는 변이 시험.
- `installer/README.md`, `redist/README.md`: 새 빌드 PC의 런타임 준비 절차와 누락 실패 안내.
- `docs/INSTALLER-WEBVIEW2.md`, `docs/wiki/설치기-런타임.md`, 위키 홈과 사이드바, `CHANGELOG.md`: 승인 범위와 운영 안내.

## 결정

- 사용자가 정한 것: 인스톨러에 런타임 추가. 구성원 편집 브랜치가 아니라 `feat/db-app`에 반영.
- 내가 정한 것(검토 필요): PowerShell과 Inno 직접 컴파일 양쪽에서 누락을 차단한다. 기존 런타임 설치 및 감지 방식은 유지한다. 큰 바이너리는 기존 정책에 따라 커밋하지 않는다.
- 빌드 시 자동 다운로드를 추가하지 않았다. 폐쇄망 빌드 PC에는 `redist/MicrosoftEdgeWebView2RuntimeInstallerX64.exe`를 반입한다. 버전은 변경하지 않았다.

## 시험 (명령과 결과 숫자)

- 관련 시험: `tests/harness.mjs`의 `run()`으로 `tests/installer-webview.test.mjs` 실행, 4 pass / 0 fail / 0 skip. 입력은 빈 문자열 파이프.
- 누락 시험: `dist/proto/webview-missing`에 소스만 복사해 실행. `powershell -NoProfile -ExecutionPolicy Bypass -File .../build-installer.ps1 -SkipPublish`, exit 1. `ISCC.exe .../task-calendar.iss`, exit 2. 모두 런타임 파일 누락 문구로 중단.
- 설치기 빌드: `powershell -NoProfile -ExecutionPolicy Bypass -File installer/build-installer.ps1`, exit 0. 자체 포함 publish와 Inno 컴파일 성공. 컴파일 로그에 런타임 파일 압축을 확인.
- 전체 strict: `TC_TEST_STRICT=1 node tests/run-tests.mjs`, 3147 pass / 0 fail / 0 skip, exit 0.
- 빌드: `dotnet build widget/TaskCalendarWidget.csproj -c Debug`, exit 0, 경고 0개 / 오류 0개.
- 로컬 배포 파일: `powershell -NoProfile -ExecutionPolicy Bypass -File installer/publish-update.ps1`, exit 0. `latest.json`과 `release-v0.24.0.sql`의 SHA256이 새 설치기와 일치한다. 공유폴더 복사나 SQL 실행은 하지 않았다.

## 산출물과 재현 정보

- 공식 다운로드: `winget download --id Microsoft.EdgeWebView2Runtime --exact --architecture x64 --download-directory redist/winget-webview2 --accept-source-agreements --accept-package-agreements --disable-interactivity`. winget 해시 검증 성공, 패키지 버전 155.0.4283.62. 설치가 아닌 다운로드만 수행.
- `redist/MicrosoftEdgeWebView2RuntimeInstallerX64.exe`: 214156024 bytes. Authenticode Valid, 서명 Microsoft Corporation. SHA256 `0625FB5C1E75BE58A164E14F95AA58A3E5BADB859B3D17C952385F3E4A9FF3E8`.
- `dist/installer/TaskCalendarWidget-Setup-v0.24.0.exe`: 267509420 bytes(약 255.1 MiB). SHA256 `63a2158c384bccae342f40aee26d9263d51924733fa83216153504923b882845`.
- 큰 바이너리와 `dist` 산출물은 git 제외. 새 체크아웃에는 자동으로 따라오지 않는다. 런타임을 준비하고 설치기를 다시 빌드해야 한다.
- 로그(커밋 제외): `dist/proto/webview-installer-build.log`, `webview-tests.log`, `webview-missing-powershell.log`, `webview-missing-inno.log`, `webview-strict.log`, `webview-debug-build.log`, `webview-publish.log`.

## 추가 의존성 점검(사용자 후속 요청)

- 실제 `dist/portable/TaskCalendarWidget.exe`의 .NET 번들 헤더와 파일 목록을 읽었다. 내부 파일 459개. 내장 deps의 런타임 및 네이티브 자산 235개를 대조했고 누락 0개다. 원본 deps와 비교해도 SDK가 의도적으로 제거하도록 지정한 파일 외 누락은 없다.
- 내장 runtimeconfig에는 `Microsoft.NETCore.App` 및 `Microsoft.WindowsDesktop.App` 9.0.17이 포함됐다. MySqlConnector, WebView2 Core/WPF/Loader, PresentationFramework, `vcruntime140_cor3.dll`을 실제 내부 목록에서 확인했다.
- CoreCLR와 JIT DLL이 별도 목록에 없는 것은 누락이 아니다. 사용한 런타임 팩의 `RuntimeList.xml`은 해당 파일을 `DropFromSingleFile=true`로 지정하며, 단일 실행 호스트에 직접 결합된다. [해당 버전 공식 소스](https://github.com/dotnet/runtime/blob/v9.0.17/src/native/corehost/apphost/static/CMakeLists.txt)와 대조했다. 초기 조사 중 누락을 의심했던 안내는 사용자에게 정정했다. 설치기를 변경하거나 재빌드할 필요는 없었다.
- 실행 파일 및 번들 네이티브 DLL의 PE import를 확인했다. Windows 시스템 DLL, Universal CRT 및 포함된 런타임 DLL을 사용한다. Windows 10/11 x64 기준으로 추가 프레임워크 패키징 누락은 발견하지 않았다.
- DOCX는 `DocxWriter.cs`에서 ZIP/XML로 직접 생성하므로 생성 단계에 Word COM 자동화 설치가 필요하지 않다. 앱 실행에는 Node.js나 Python도 사용하지 않는다.
- 증거(커밋 제외): `dist/proto/webview-dependency-audit.json`, `webview-dependency-audit.log`, 재현 스크립트 `audit-bundle.py`.

## 확인 못 한 것 (실제 위젯, 실제 DB, 다른 테마 등)

WebView2가 없는 별도 PC 또는 VM에서 설치기를 실행하는 시험은 하지 않았다. 이 PC의 런타임과 사용자 앱을 재설치하지 않았다. 실제 DB, 공용 서버, 사용자 데이터도 변경하지 않았다.

## 남은 질문

코드에 대한 추가 질문은 없다. 폐쇄망 반입 전 WebView2 미설치 PC에서 최초 설치 및 앱 실행을 확인해야 한다. push와 서버 배포는 하지 않았다.
