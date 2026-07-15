# 인스톨러 빌드 (Inno Setup)

폐쇄망에서 clone한 뒤 **인스톨러(설치 exe)** 를 만드는 도구. 매번 스크립트를 새로 짜지 않도록 저장소에 고정해 둔다.

## 만들어지는 것
`dist\installer\TaskCalendarWidget-Setup-v<버전>.exe` — 실행하면:
- **위젯 exe**(자체포함) 설치 + 시작 메뉴/바탕화면 바로가기
- **브라우저용 단일 HTML**(`수행과제캘린더-브라우저.html`) 설치 + 바로가기(더블클릭 → 기본 브라우저)
- **WebView2 런타임 자동설치** — `redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe`가 **있을 때만** 포함(없으면 자동 생략, Win11은 내장이라 대개 불필요)
- 제거 프로그램 등록. **사용자 데이터(`%APPDATA%\TaskCalendar`)는 설치/제거가 건드리지 않음.**

> 브라우저 HTML은 **위젯과 데이터가 분리**된 독립 사본이다(위젯=`data.xml`, 브라우저=localStorage). 둘 사이 이동은 앱의 **XML 내보내기/불러오기**로. (서버 페이즈에서 단일 소스로 합쳐질 예정 — `docs/ROADMAP.md`)

## 사전 요구 (빌드 PC, 한 번만)
- **.NET 9 SDK** (위젯 publish용)
- **Inno Setup 6** — https://jrsoftware.org/isdl.php 에서 받아 설치(폐쇄망은 설치 파일 반입).
  - 설치하면 `C:\Program Files (x86)\Inno Setup 6\ISCC.exe` 가 생김(빌드 스크립트가 자동 탐색).

## 빌드
```powershell
# 저장소 어디서든:
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
```
옵션:
- `-SkipPublish` — 위젯 exe를 이미 빌드(`dist\portable\`)했으면 publish 건너뛰기(빠름).
- `-Iscc "<경로>\ISCC.exe"` — ISCC 자동탐색이 실패할 때 경로 직접 지정.

스크립트가 하는 일: `csproj`의 `<Version>`을 읽어 → 위젯 self-contained publish → `ISCC /DMyAppVersion=<버전> task-calendar.iss` 컴파일.

> ⚠️ **순서 주의 — Inno는 "포장"만 한다.** `.iss`는 이미 빌드된 `dist\portable\TaskCalendarWidget.exe`를 담을 뿐 exe를 **만들지 않는다.** 그래서 **Inno Setup GUI로 `.iss`를 직접 컴파일하려면 먼저 `build-portable.cmd`(또는 `dotnet publish … -o dist\portable`)로 exe를 구워야** 한다 — 안 그러면 ISCC가 "소스 파일 없음"(위치 에러)을 낸다.
> 순서 = **① `build-portable.cmd`(exe 굽기) → ② Inno로 `.iss` 컴파일(포장).** `build-installer.ps1`은 이 두 단계를 순서대로 자동 수행하므로 이 함정이 없다.

## 버전 올리기
버전 단일 소스는 **`widget\TaskCalendarWidget.csproj`의 `<Version>`**. 여기만 올리면 인스톨러 파일명·표시 버전이 따라온다. (앱 화면 버전은 `task-calendar-prototype.html`의 `APP_VERSION` + 패치노트 모달을 함께 갱신 — `docs`/README의 릴리스 규칙 참고.)

## 파일
- `task-calendar.iss` — Inno Setup 스크립트(설치 구성 · **이 하나만 정본**). `AppId` GUID는 **업그레이드 동일성 키라 절대 변경 금지**. WebView2 번들은 `redist\` 파일 존재 시 `#if`로 자동 포함/생략.
- `build-installer.ps1` — 빌드 오케스트레이션 CLI(설치기만 · `powershell -ExecutionPolicy Bypass -File`로 실행). 원클릭 전체 배포는 `배포-빌드.cmd` 사용.

> 마법사 언어 = `Korean.isl`(Inno의 `Languages\` 폴더에 있어야 함). 없어서 컴파일이 막히면 `.iss`의 `[Languages]`를 `compiler:Default.isl`(영문)로 바꾸면 됨.
> `.iss`/`.ps1`은 한글 오독 방지를 위해 **UTF-8 BOM**으로 저장돼 있음(편집 시 인코딩 유지).
