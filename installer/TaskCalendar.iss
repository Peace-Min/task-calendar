; ============================================================================
;  수행과제 캘린더 — Inno Setup 인스톨러 스크립트
;  폐쇄망에서 clone 후 Inno Setup 6로 컴파일해 배포용 인스톨러를 만든다.
;
;  빌드: installer\build-installer.ps1 (권장) — csproj에서 버전을 읽어
;        위젯 publish 후 ISCC로 이 스크립트를 컴파일(/DAppVer=<버전> 주입).
;  수동: ISCC.exe /DAppVer=0.6.0 TaskCalendar.iss
;
;  산출물: dist\installer\수행과제캘린더-설치-v<버전>.exe
;  설치 내용: ① 위젯 exe(자체포함) ② 브라우저용 단일 HTML ③ 바로가기
;  ※ 사용자 데이터(%APPDATA%\TaskCalendar)는 설치/제거가 건드리지 않는다.
; ============================================================================

#ifndef AppVer
  #define AppVer "0.6.0"      ; build-installer.ps1이 /DAppVer로 덮어씀(단일 소스=csproj)
#endif
#define AppName    "수행과제캘린더"
#define Publisher  "넷커스터마이즈"
#define ExeSrc     "..\dist\portable\TaskCalendarWidget.exe"   ; publish 산출물(빌드명)
#define ExeName    "수행과제캘린더.exe"                          ; 설치 후 파일명(운영 배포와 동일)
#define HtmlSrc    "..\task-calendar-prototype.html"
#define HtmlName   "수행과제캘린더-브라우저.html"                 ; 더블클릭 시 기본 브라우저로 열림
#define NotesSrc   "..\RELEASE_NOTES.md"

[Setup]
; AppId는 업그레이드 동일성의 키 — 절대 바꾸지 말 것(바꾸면 별개 앱으로 중복 설치됨).
AppId={{8F3A1B72-4C9D-4E6A-9B21-7D5E2C1A0F44}
AppName={#AppName}
AppVersion={#AppVer}
AppVerName={#AppName} v{#AppVer}
AppPublisher={#Publisher}
VersionInfoVersion={#AppVer}.0
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; 관리자 없이도 설치되도록 사용자 영역 기본, 필요 시 마법사에서 전체 설치 선택 가능
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
; 자체포함 win-x64 exe라 64비트 Windows 전용
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
OutputDir=..\dist\installer
OutputBaseFilename=수행과제캘린더-설치-v{#AppVer}
SetupIconFile=..\widget\app.ico
UninstallDisplayIcon={app}\{#ExeName}
UninstallDisplayName={#AppName} v{#AppVer}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; 설치 시 실행 중인 위젯이 파일을 잠그고 있으면 자동으로 닫고 진행
CloseApplications=yes
RestartApplications=no

[Languages]
; Korean.isl은 Inno 기본 설치에 없을 수 있어 Default(영문 마법사)로 항상 컴파일되게 둔다.
; 앱 고유 문구(작업명·실행 설명 등)는 아래에서 한국어로 지정되므로 그대로 한국어로 보인다.
; 완전 한국어 마법사를 원하면: Inno 번역 페이지에서 Korean.isl을 받아 이 폴더에 두고
; 아래 줄을  Name: "kr"; MessagesFile: "Korean.isl"  로 교체.
Name: "kr"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon";  Description: "바탕화면에 위젯 바로가기 만들기";        GroupDescription: "바로가기 만들기:";
Name: "desktophtml";  Description: "바탕화면에 브라우저용 바로가기 만들기";  GroupDescription: "바로가기 만들기:"; Flags: unchecked

[Files]
; ① 위젯 exe (자체포함 단일파일) — 빌드명 → 한글명으로 rename 설치
Source: "{#ExeSrc}";   DestDir: "{app}"; DestName: "{#ExeName}";  Flags: ignoreversion
; ② 브라우저용 단일 HTML (file://로 그대로 실행 — 위젯 없이 사용/외부용)
Source: "{#HtmlSrc}";  DestDir: "{app}"; DestName: "{#HtmlName}"; Flags: ignoreversion
; ③ 변경 이력(오프라인 참고)
Source: "{#NotesSrc}"; DestDir: "{app}"; DestName: "변경내역.md";  Flags: ignoreversion

[Icons]
; 시작 메뉴
Name: "{group}\{#AppName}";            Filename: "{app}\{#ExeName}";  Comment: "바탕화면 위젯 실행"
Name: "{group}\{#AppName} (브라우저)"; Filename: "{app}\{#HtmlName}"; Comment: "브라우저에서 열기(위젯과 데이터는 별개 — XML로 이동)"
Name: "{group}\{#AppName} 제거";       Filename: "{uninstallexe}"
; 바탕화면(선택)
Name: "{autodesktop}\{#AppName}";            Filename: "{app}\{#ExeName}";  Tasks: desktopicon
Name: "{autodesktop}\{#AppName} (브라우저)"; Filename: "{app}\{#HtmlName}"; Tasks: desktophtml

[Run]
; 설치 마지막에 위젯 실행(무인 설치 시 생략)
Filename: "{app}\{#ExeName}"; Description: "지금 {#AppName} 실행"; Flags: nowait postinstall skipifsilent

; [UninstallDelete] 없음 — 사용자 데이터(%APPDATA%\TaskCalendar)는 의도적으로 보존한다.
