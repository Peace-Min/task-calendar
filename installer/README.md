# 인스톨러 빌드 (Inno Setup)

폐쇄망에서 clone한 뒤 **인스톨러(설치 exe)** 를 만드는 도구. 매번 스크립트를 새로 짜지 않도록 저장소에 고정해 둔다.

## 만들어지는 것
`배포-빌드.cmd` 한 번으로 설치기 두 개와 배포 정보를 만듭니다.

- `dist\installer\TaskCalendarWidget-Setup-v<버전>.exe`: 공유폴더 업데이트용. WebView2 설치 파일 제외, 약 51 MiB. 자동 업데이트가 이 파일을 받습니다.
- `dist\installer\TaskCalendarWidget-Setup-v<버전>-full.exe`: 처음 설치용. WebView2 포함, 약 255 MiB. 새 PC에는 이 파일 하나를 전달합니다.
- `latest.json`, `release-v<버전>.sql`: 업데이트용 파일명과 SHA256을 사용합니다. Full 해시는 빌드 화면에 별도로 표시합니다.

두 설치기의 공통 내용:
- **위젯 exe**(자체포함) 설치 + 시작 메뉴/바탕화면 바로가기
- **브라우저용 단일 HTML**(`수행과제캘린더-브라우저.html`) 설치 + 바로가기(더블클릭하면 기본 브라우저로 열림)
- **WebView2 처리**: Full은 런타임이 없으면 앱 실행 전에 설치합니다. 업데이트용은 런타임이 없으면 처음 설치용(-full.exe)을 안내하고 파일 설치 전에 중단합니다.
- 제거 프로그램 등록. **사용자 데이터(`%APPDATA%\TaskCalendar`)는 설치/제거가 건드리지 않음.**

> 브라우저 HTML은 **위젯과 데이터가 분리**된 독립 사본이다(위젯=서버 MySQL, 브라우저=localStorage). 둘 사이 이동은 앱의 **XML 내보내기/불러오기**로. (서버 페이즈에서 단일 소스로 합쳐질 예정, `docs/ROADMAP.md`)

## 사전 요구 (빌드 PC, 한 번만)
- **.NET 9 SDK** (위젯 publish용)
- **WebView2 Evergreen Standalone x64 설치 파일**: [redist/README.md](../redist/README.md)에 따라 준비합니다. 작은 온라인 Bootstrapper는 사용하지 않습니다. 폐쇄망 빌드 PC에는 파일을 반입합니다.
- **Inno Setup 6**: https://jrsoftware.org/isdl.php 에서 받아 설치(폐쇄망은 설치 파일 반입).
  - 설치하면 `C:\Program Files (x86)\Inno Setup 6\ISCC.exe` 가 생김(빌드 스크립트가 자동 탐색).

## 빌드
```powershell
# 저장소 어디서든:
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
```
옵션:
- `-SkipPublish`: 위젯 exe를 이미 빌드(`dist\portable\`)했으면 publish 건너뛰기(빠름).
- `-Iscc "<경로>\ISCC.exe"`: ISCC 자동탐색이 실패할 때 경로 직접 지정.

스크립트는 위젯을 한 번 self-contained publish한 뒤 `ISCC /DMyAppVersion=<버전> /DFullInstaller=0 task-calendar.iss`와 `/DFullInstaller=1`을 차례로 컴파일합니다. 두 설치기를 모두 만들므로 런타임 파일이 없으면 빌드 전체를 중단합니다.

공유폴더에는 업데이트용과 `latest.json`을 올립니다. 새 PC용으로는 최신 Full을 별도로 전달하거나 공유폴더에 구분해서 둡니다. `-CopyTo`는 기존처럼 업데이트용과 `latest.json`만 복사하며, Full은 자동 업데이트 대상이 아닙니다.

> ⚠️ **순서 주의: Inno는 "포장"만 한다.** `.iss`는 이미 빌드된 `dist\portable\TaskCalendarWidget.exe`를 담을 뿐 exe를 **만들지 않는다.** 그래서 **Inno Setup GUI로 `.iss`를 직접 컴파일하려면 먼저 `build-portable.cmd`(또는 `dotnet publish … -o dist\portable`)로 exe를 구워야** 한다. 안 그러면 ISCC가 "소스 파일 없음"(위치 에러)을 낸다.
> 순서 = **① `build-portable.cmd`(exe 굽기) → ② Inno로 `.iss` 컴파일(포장).** `build-installer.ps1`은 이 두 단계를 순서대로 자동 수행하므로 이 함정이 없다.

## 버전 올리기
버전 단일 소스는 **`widget\TaskCalendarWidget.csproj`의 `<Version>`**. 여기만 올리면 인스톨러 파일명과 표시 버전이 따라온다. (앱 화면 버전은 `task-calendar-prototype.html`의 `APP_VERSION` + 패치노트 모달을 함께 갱신. `docs`/README의 릴리스 규칙 참고.)

## 파일
- `task-calendar.iss`: 두 설치기가 공유하는 정본입니다. AppId와 설치 경로는 같게 유지합니다. Inno 직접 컴파일은 기본 업데이트용이며 `/DFullInstaller=1`이면 Full을 만듭니다. Full 직접 컴파일도 런타임 누락을 거부합니다.
- `build-installer.ps1`: 빌드 오케스트레이션 CLI(설치기만, `powershell -ExecutionPolicy Bypass -File`로 실행). 원클릭 전체 배포는 `배포-빌드.cmd` 사용.

> 마법사 언어 = `Korean.isl`(Inno의 `Languages\` 폴더에 있어야 함). 없어서 컴파일이 막히면 `.iss`의 `[Languages]`를 `compiler:Default.isl`(영문)로 바꾸면 됨.
> `.iss`/`.ps1`은 한글 오독 방지를 위해 **UTF-8 BOM**으로 저장돼 있음(편집 시 인코딩 유지).
