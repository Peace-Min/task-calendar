# 배포 가이드 (수행과제 캘린더 위젯)

폐쇄망(오프라인) Windows 11 환경 기준. clone한 PC에서 **직접 빌드**해 exe를 만드는 흐름입니다.

## 사전 요구 (한 번만)
- **.NET 9 SDK** 설치 (또는 .NET 9 지원 **Visual Studio 2022 17.12+**).
  - 폐쇄망: [.NET 9 SDK 오프라인 설치 파일](https://dotnet.microsoft.com/download/dotnet/9.0)(x64)을 인터넷 PC에서 받아 USB로 반입 → 설치.
  - 확인: `dotnet --version` 이 `9.x`(또는 그 이상) 출력.
- WebView2 런타임: Windows 11 기본 내장(별도 작업 불필요).
- WebView2 **NuGet 패키지**는 저장소에 동봉(`widget/nuget-packages/`)되어 **인터넷 없이 복원**됩니다.

## 빌드 (셋 중 택1)
- **원클릭**: 저장소 루트의 **`build.cmd`** 더블클릭.
- **명령줄**: `dotnet publish widget\TaskCalendarWidget.csproj -c Release -o dist\app`
- **Visual Studio**: `TaskCalendarWidget.sln` 열고 Release 빌드.

→ 결과: `dist\app\TaskCalendarWidget.exe` (+ dll 약 10개). **이 PC에서 빌드하면 같은 PC에서 바로 실행 가능**(SDK에 런타임 포함).

> "Visual Studio에서 빌드가 안 됐다"면 대개 ① `.sln`이 없었거나 ② VS가 .NET 9을 모르는 옛 버전이었기 때문입니다. 이제 `.sln`이 포함됐고, VS 2022 **17.12 이상**(또는 .NET 9 SDK)만 있으면 빌드됩니다.

---

## 인스톨러 배포 (Inno Setup) — 권장 배포 방식

exe만 떼서 복사하는 대신 **설치 프로그램**으로 배포한다(시작 메뉴·바로가기·제거 등록·브라우저 HTML 동시 설치).

```powershell
# .NET 9 SDK + Inno Setup 6 설치된 빌드 PC에서:
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
# 또는 installer\build-installer.cmd 더블클릭
```
→ `dist\installer\수행과제캘린더-설치-v<버전>.exe` 생성. 이 파일 하나만 반입해 대상 PC에서 실행하면 설치된다.

- 설치물: **위젯 exe**(자체포함) + **브라우저용 단일 HTML**(`수행과제캘린더-브라우저.html`, 더블클릭 시 기본 브라우저) + 변경내역 + 바로가기.
- **브라우저 HTML은 위젯과 데이터가 분리**된 독립 사본(위젯=`data.xml` / 브라우저=localStorage). 이동은 앱의 **XML 내보내기/불러오기**로. (서버 페이즈에서 단일 소스로 합류 — `docs/ROADMAP.md`)
- 사용자 데이터(`%APPDATA%\TaskCalendar`)는 설치·제거가 **보존**한다.
- 상세·사전요구·옵션: [installer/README.md](installer/README.md). Inno Setup 6 필요(폐쇄망은 설치 파일 반입).
- 버전 단일 소스 = `widget\TaskCalendarWidget.csproj`의 `<Version>`(스크립트가 읽어 인스톨러에 주입).

---

## 0. 구성 요약
- 소스: `task-calendar/` (프로토타입 HTML `task-calendar-prototype.html`, 명세 `SPEC.md`, 위젯 `widget/`)
- 위젯은 검증된 HTML을 **exe 안에 임베드**(빌드 시 포함)하므로 HTML을 따로 배포할 필요 없음.
- 데이터/설정은 실행 PC의 **`%APPDATA%\TaskCalendar\`** 에 저장(저장소에 미포함):
  - `data.xml` — 캘린더 기록(교환용 XML)
  - `widget.settings.json` — 창 위치/크기/부착/자동시작
  - `WebView2\` — WebView2 사용자 데이터

---

## 1. 빌드 (이 PC에서 가능 — 폐쇄망 OK)
**프레임워크 종속 publish** (설치된 .NET 9 데스크톱 런타임 사용):
```powershell
dotnet publish widget\TaskCalendarWidget.csproj -c Release -o dist\app
```
- 결과: `dist\app\` 폴더에 **`TaskCalendarWidget.exe` + dll 약 10개**.
- 이 PC에는 .NET 9 데스크톱 런타임(9.0.x)과 WebView2 NuGet 캐시가 있어 **오프라인으로 빌드됩니다.**

> ⚠️ `--self-contained`(런타임 번들 단일 exe)는 **런타임 팩이 없는 폐쇄망 PC에서는 빌드 실패**합니다(NuGet에서 받아야 함). 인터넷 되는 PC 또는 런타임 팩이 캐시된 PC에서만 가능 — 아래 4번 참고.

> ℹ️ **현재 개발/빌드 PC는 인터넷 연결됨**(망분리 대상은 *배포될* 위젯이지 이 빌드 PC가 아님) + win-x64 런타임 팩/WindowsDesktop 런타임 캐시 보유 → **실제 운영 산출물은 자체포함 단일 exe(~171MB)** 이며 `C:\Users\<사용자>\Desktop\수행과제캘린더\수행과제캘린더.exe` 로 **파일명을 한글 rename해 배포**한다. 명령·함정 포함 **운영 빌드·배포 런북은 [CHANGELOG.md](CHANGELOG.md)** 참고.
>
> ⚠️ **재빌드 전 파일 락 해제**: 두 프로세스명(`TaskCalendarWidget`, `수행과제캘린더`)을 **모두** 종료해야 publish가 락에 안 걸린다(배포본은 rename돼 프로세스명이 다름). `Get-Process -Name 'TaskCalendarWidget','수행과제캘린더' -EA SilentlyContinue | Stop-Process -Force`

---

## 2. 다른 PC로 배포 (런타임 있는 경우)
1. `dist\app\` **폴더 전체**를 USB 등으로 대상 PC에 복사(예: `C:\Tools\TaskCalendar\`).
2. 대상 PC에 **.NET 9 데스크톱 런타임**이 있어야 함. 없으면 3번.
3. 폴더 안의 `TaskCalendarWidget.exe` 실행.

> exe 하나만 떼면 실행 안 됨(옆의 dll 필요) — **폴더째** 두세요.

### 대상 PC에 .NET 런타임이 없을 때
Microsoft "**.NET Desktop Runtime 9.x (x64)**" **오프라인 설치 파일**(약 50MB, 단일 exe)을 인터넷 PC에서 받아 USB로 반입 → 대상 PC에서 1회 설치 → 이후 위 폴더 실행.

### WebView2 런타임
- Windows 11에는 기본 내장(별도 작업 불필요).
- 구형 Windows면 "Microsoft Edge WebView2 Evergreen 런타임" 설치 파일을 반입해 1회 설치.

---

## 3. 시작프로그램(자동 실행) 등록
- **첫 실행 시 1회 질문**: "Windows 켤 때 자동 실행할까요?"에 예/아니오 선택. 예를 누르면 `HKCU\…\Run`에 등록(묻지 않고 몰래 등록하지 않음). 이후 ⚙ 메뉴에서 켜기/끄기.
  - 등록 경로는 **그때의 exe 경로**를 가리킴 → exe를 옮겼으면 ⚙에서 한 번 껐다 켜 경로 갱신.
- **수동(원하면)**: `Win+R` → `shell:startup` → 열린 폴더에 `TaskCalendarWidget.exe` **바로가기** 넣기.

---

## 4. (선택) 진짜 단일 exe — 인터넷 되는 PC에서
무설치 단일 exe가 필요하면 인터넷 연결된 PC에서:
```powershell
dotnet publish widget\TaskCalendarWidget.csproj -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o dist\portable
```
- 결과: `dist\portable\TaskCalendarWidget.exe` **1개**(~171MB, WinForms 트레이 포함, .NET 설치 불필요).
- 이 exe 하나만 폐쇄망 PC로 복사(원하면 한글 rename) → 실행. 시작프로그램에도 이 1개만 등록.
- (대안) 런타임 팩 없는 폐쇄망에서 굳이 하려면 win-x64 런타임 팩/WindowsDesktop 런타임을 NuGet 캐시에 미리 채워야 함.
- 첫 실행 시 `%TEMP%\.net`으로 네이티브 추출 → 초기 시작이 프레임워크 종속본보다 느릴 수 있음.

### Inno Setup 설치 파일 만들기
자체포함 단일 exe를 만든 뒤 Inno Setup 6으로 사용자별 설치 파일을 생성합니다.

```powershell
dotnet publish widget\TaskCalendarWidget.csproj -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:PublishReadyToRun=false -o dist\portable

& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" installer\task-calendar.iss
```

- 결과: `dist\installer\TaskCalendarWidget-Setup-v0.5.0.exe`
- 설치 경로: `%LOCALAPPDATA%\Programs\TaskCalendar`
- 설치 후 실행 파일명: `수행과제캘린더.exe`
- .NET 런타임은 exe에 포함되므로 대상 PC에 별도 .NET 설치가 필요 없습니다.
- 인스톨러는 Microsoft WebView2 Evergreen Standalone Installer x64(`redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe`)를 포함할 수 있고, 대상 PC에 WebView2 Runtime이 없으면 설치 중 자동으로 `/silent /install`을 실행합니다.
- Standalone 설치 파일은 약 190MB라 GitHub에 커밋하지 않습니다. 빌드 PC에서 `redist\README.md`의 명령으로 내려받은 뒤 Inno Setup을 컴파일합니다.
- 이 방식으로 만든 최종 인스톨러는 .NET 런타임과 WebView2 Runtime 설치 파일을 모두 포함하므로, 대상 PC가 인터넷이 없어도 설치 가능합니다.

---

## 5. 버전관리 / 릴리스 (Git)
- 소스만 커밋(빌드 산출물은 `.gitignore`로 제외).
- 버전 올릴 때:
  1. `widget\TaskCalendarWidget.csproj`에 `<Version>1.0.0</Version>` 갱신(없으면 추가).
  2. 커밋 후 태그: `git tag v1.0.0`.
  3. (사내/GitHub) **Releases**에 1번에서 만든 `dist\app`(zip) 또는 단일 exe 첨부 → 사용자는 빌드 없이 내려받아 실행.
- 시맨틱 버저닝 권장: `MAJOR.MINOR.PATCH` (호환 깨짐 / 기능 추가 / 버그 수정).
- 변경 이력은 `CHANGELOG.md`에 누적.

---

## 6. 데이터 백업 / 이전
- 데이터는 PC 로컬(`%APPDATA%\TaskCalendar\data.xml`)이며 PC 간 자동 동기화 없음.
- 다른 PC로 기록을 옮기려면: 앱 **[데이터 → XML 내보내기]** 로 백업 → 새 PC에서 **[데이터 → XML 가져오기]**.
