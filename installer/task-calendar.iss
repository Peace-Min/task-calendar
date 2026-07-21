; ============================================================================
;  수행과제 캘린더 — Inno Setup 인스톨러 (installer/에서 단일 관리)
;  담기는 것: ① 위젯 exe(자체포함) ② 브라우저용 단일 HTML ③ (redist에 있으면) WebView2 런타임 자동설치
;
;  빌드(권장): installer\build-installer.ps1  — csproj <Version>을 읽어 /DMyAppVersion 주입
;  수동:        ISCC.exe /DMyAppVersion=0.6.0 task-calendar.iss
;  산출물:      dist\installer\TaskCalendarWidget-Setup-v<버전>.exe
;  ※ 사용자 데이터(%APPDATA%\TaskCalendar)는 설치/제거가 건드리지 않는다.
; ============================================================================

; 버전 단일 소스 = widget\TaskCalendarWidget.csproj <Version>.
; build-installer.ps1이 /DMyAppVersion으로 덮어쓴다. 수동 컴파일 시 아래 기본값 사용.
#ifndef MyAppVersion
  #define MyAppVersion "0.13.0"
#endif
#define MyAppName "수행과제 캘린더"
#define MyAppPublisher "Peace-Min"
#define MyAppExeName "수행과제캘린더.exe"
#define MyAppHtmlName "수행과제캘린더-브라우저.html"
#define SourceExe "..\dist\portable\TaskCalendarWidget.exe"
#define SourceHtml "..\task-calendar-prototype.html"
#define WebView2SetupName "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
#define WebView2SetupSource "..\redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
; redist에 WebView2 설치기가 실제로 있을 때만 번들(없으면 그 부분을 빼고 정상 컴파일 — Win11은 내장이라 대개 불필요)
#define HasWebView2 FileExists(AddBackslash(SourcePath) + WebView2SetupSource)

[Setup]
; 소스 경로 기준을 .iss 위치로 고정 — 어디서 ISCC를 호출하든 ..\dist\portable 가
; 항상 repo\dist\portable 로 해석되게 함(호출 CWD에 따른 'installer\dist\portable' 오해석 방지).
SourceDir={#SourcePath}
; AppId는 업그레이드 동일성의 키 — 절대 바꾸지 말 것.
AppId={{B732E361-639B-4B5F-8A55-22E5E7C2C11D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} v{#MyAppVersion}
AppPublisher={#MyAppPublisher}
VersionInfoVersion={#MyAppVersion}.0
DefaultDirName={localappdata}\Programs\TaskCalendar
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist\installer
OutputBaseFilename=TaskCalendarWidget-Setup-v{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=..\widget\app.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName} v{#MyAppVersion}
; 재설치 시 실행 중인 위젯이 파일을 잠그면 자동으로 닫고 진행
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면에 위젯 바로가기 만들기";       GroupDescription: "추가 바로가기:"
Name: "desktophtml"; Description: "바탕화면에 브라우저용 바로가기 만들기"; GroupDescription: "추가 바로가기:"; Flags: unchecked

[Files]
; ① 위젯 exe (자체포함 단일파일) — 빌드명 → 한글명으로 rename 설치
Source: "{#SourceExe}";  DestDir: "{app}"; DestName: "{#MyAppExeName}";  Flags: ignoreversion
; ② 브라우저용 단일 HTML (file://로 그대로 실행 — 위젯 없이/외부용. 데이터는 위젯과 별개, XML로 이동)
Source: "{#SourceHtml}"; DestDir: "{app}"; DestName: "{#MyAppHtmlName}"; Flags: ignoreversion
; ③ WebView2 런타임 설치기 (redist에 있을 때만)
#if HasWebView2
Source: "{#WebView2SetupSource}"; DestDir: "{tmp}"; DestName: "{#WebView2SetupName}"; Flags: deleteafterinstall
#endif

[Icons]
Name: "{group}\{#MyAppName}";            Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{#MyAppName} (브라우저)"; Filename: "{app}\{#MyAppHtmlName}"; Comment: "브라우저에서 열기(위젯과 데이터는 별개 — XML로 이동)"
Name: "{userdesktop}\{#MyAppName}";            Filename: "{app}\{#MyAppExeName}";  Tasks: desktopicon
Name: "{userdesktop}\{#MyAppName} (브라우저)"; Filename: "{app}\{#MyAppHtmlName}"; Tasks: desktophtml

[Run]
#if HasWebView2
Filename: "{tmp}\{#WebView2SetupName}"; Parameters: "/silent /install"; StatusMsg: "Microsoft Edge WebView2 Runtime 확인/설치 중..."; Flags: waituntilterminated; Check: NeedsWebView2
#endif
Filename: "{app}\{#MyAppExeName}"; Description: "{#MyAppName} 실행"; Flags: nowait postinstall skipifsilent
; 무인 자동 업데이트(위젯이 /SILENT /UPDATED=1 로 실행)일 때만 새 앱을 재시작.
; (위 대화형 라인은 skipifsilent라 무인 설치에선 실행되지 않으므로 별도 라인이 필요하다.)
Filename: "{app}\{#MyAppExeName}"; Flags: nowait; Check: IsAutoUpdate

; 사용자 데이터(%APPDATA%\TaskCalendar)는 의도적으로 보존 — [UninstallDelete] 없음.

[Code]
function IsNonZeroVersion(Value: string): Boolean;
begin
  Result := (Value <> '') and (Value <> '0.0.0.0');
end;

// 위젯의 자동 업데이트가 넘긴 /UPDATED=1 파라미터 감지 — 무인 설치 후 새 앱 재시작 여부.
function IsAutoUpdate: Boolean;
begin
  Result := ExpandConstant('{param:UPDATED|0}') = '1';
end;

function NeedsWebView2: Boolean;
var
  Version: string;
begin
  Result := True;

  if RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and IsNonZeroVersion(Version) then
  begin
    Result := False;
    Exit;
  end;

  if RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and IsNonZeroVersion(Version) then
  begin
    Result := False;
    Exit;
  end;

  if RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and IsNonZeroVersion(Version) then
  begin
    Result := False;
    Exit;
  end;
end;
