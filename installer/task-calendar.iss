#define MyAppName "수행과제 캘린더"
#define MyAppPublisher "Peace-Min"
#define MyAppVersion "0.5.0"
#define MyAppExeName "수행과제캘린더.exe"
#define SourceExe "..\dist\portable\TaskCalendarWidget.exe"
#define WebView2SetupName "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
#define WebView2SetupSource "..\redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"

[Setup]
AppId={{B732E361-639B-4B5F-8A55-22E5E7C2C11D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
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

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면 바로가기 만들기"; GroupDescription: "추가 바로가기:"; Flags: unchecked

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion
Source: "{#WebView2SetupSource}"; DestDir: "{tmp}"; DestName: "{#WebView2SetupName}"; Flags: deleteafterinstall

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\{#WebView2SetupName}"; Parameters: "/silent /install"; StatusMsg: "Microsoft Edge WebView2 Runtime 확인/설치 중..."; Flags: waituntilterminated; Check: NeedsWebView2
Filename: "{app}\{#MyAppExeName}"; Description: "{#MyAppName} 실행"; Flags: nowait postinstall skipifsilent

[Code]
function IsNonZeroVersion(Value: string): Boolean;
begin
  Result := (Value <> '') and (Value <> '0.0.0.0');
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
