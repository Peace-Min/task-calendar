# 배포 가이드 (수행과제 캘린더 위젯)

폐쇄망(오프라인) Windows 11 환경 기준.

## ⭐ 가장 쉬운 방법 — Release에서 단일 exe 받기 (빌드 불필요)
[Releases](https://github.com/Peace-Min/task-calendar/releases/latest)의 **`TaskCalendarWidget-x.y.z-win-x64.exe`** 1개를 폐쇄망 PC로 복사 → 더블클릭.
- .NET 설치 불필요(런타임 내장), WebView2는 Win11 기본 내장. **빌드·NuGet 복원이 전혀 필요 없습니다.**
- clone이 되는 PC면 Release 다운로드도 됩니다.

아래는 직접 빌드해서 배포하려는 경우입니다.

---

빌드는 **.NET SDK가 있는 PC**에서 한 번 하고, 결과물을 다른 PC로 복사하는 흐름을 권장합니다. WebView2 패키지는 저장소에 동봉(`widget/nuget-packages/`)되어 **인터넷 없이도 복원·빌드**됩니다(자체포함 단일 exe만 인터넷 필요 — 런타임 팩 다운로드).

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

> ⚠️ `--self-contained`(런타임 번들 단일 exe)는 폐쇄망에서 **빌드 실패**합니다(런타임 팩을 NuGet에서 받아야 함). 인터넷 되는 PC에서만 가능 — 아래 4번 참고.

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
- **자동**: 위젯 첫 실행 시 `HKCU\…\Run`에 자동 등록됨. ⚙ 메뉴에서 켜기/끄기.
  - 자동시작은 **그때의 exe 경로**를 가리킴 → exe를 옮겼으면 ⚙에서 한 번 껐다 켜 경로 갱신.
- **수동(원하면)**: `Win+R` → `shell:startup` → 열린 폴더에 `TaskCalendarWidget.exe` **바로가기** 넣기.

---

## 4. (선택) 진짜 단일 exe — 인터넷 되는 PC에서
무설치 단일 exe가 필요하면 인터넷 연결된 PC에서:
```powershell
dotnet publish widget\TaskCalendarWidget.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o dist\single
```
- 결과: `dist\single\TaskCalendarWidget.exe` **1개**(~150MB, .NET 설치 불필요).
- 이 exe 하나만 폐쇄망 PC로 복사 → 실행. 시작프로그램에도 이 1개만 등록하면 됨.
- (대안) 폐쇄망에서 굳이 하려면 위 런타임 팩들을 NuGet 캐시에 미리 채워야 함.

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
