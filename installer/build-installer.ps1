#requires -Version 5
<#
  수행과제 캘린더 — 인스톨러 빌드 CLI
  ------------------------------------------------------------------
  csproj의 <Version>을 단일 소스로 삼아:
    1) (기본) 위젯을 self-contained 단일 exe로 publish
    2) ISCC(Inno Setup 컴파일러)로 task-calendar.iss 컴파일(/DMyAppVersion 주입)
  → dist\installer\TaskCalendarWidget-Setup-v<버전>.exe 생성

  사용 예:
    powershell -ExecutionPolicy Bypass -File build-installer.ps1
    powershell -ExecutionPolicy Bypass -File build-installer.ps1 -SkipPublish
    powershell -ExecutionPolicy Bypass -File build-installer.ps1 -Iscc "D:\Inno\ISCC.exe"

  (원클릭 전체 배포는 배포-빌드.cmd, 설치기만은 위 powershell 명령으로 실행)
#>
[CmdletBinding()]
param(
  [switch]$SkipPublish,          # 위젯 exe를 이미 빌드했으면 publish 생략
  [string]$Iscc                  # ISCC.exe 경로 직접 지정(자동탐색 실패 시)
)
$ErrorActionPreference = 'Stop'

$here   = Split-Path -Parent $MyInvocation.MyCommand.Path      # installer\
$root   = Split-Path -Parent $here                            # 저장소 루트(task-calendar\)
$csproj = Join-Path $root 'widget\TaskCalendarWidget.csproj'
$iss    = Join-Path $here 'task-calendar.iss'

function Fail($m){ Write-Host "✗ $m" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $csproj)) { Fail "csproj 없음: $csproj" }
if (-not (Test-Path $iss))    { Fail ".iss 없음: $iss" }

# 1) 버전 (단일 소스 = csproj <Version>)
[xml]$x = Get-Content $csproj
$ver = @($x.Project.PropertyGroup.Version | Where-Object { $_ })[0]
if ($ver) { $ver = ([string]$ver).Trim() }
if (-not $ver) { Fail "csproj에서 <Version>을 못 읽음" }
Write-Host "● 버전: $ver" -ForegroundColor Cyan

# 2) 위젯 publish (self-contained 단일 exe)
$exe = Join-Path $root 'dist\portable\TaskCalendarWidget.exe'
if (-not $SkipPublish) {
  Write-Host "● 위젯 publish 중... (자체포함 단일 exe, 수 분 소요)" -ForegroundColor Cyan
  try { Get-Process -Name 'TaskCalendarWidget','수행과제캘린더' -ErrorAction Stop | Stop-Process -Force } catch {}
  & dotnet publish $csproj -c Release -r win-x64 --self-contained true `
      -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
      -o (Join-Path $root 'dist\portable')
  if ($LASTEXITCODE -ne 0) { Fail "dotnet publish 실패 (exit $LASTEXITCODE)" }
} else {
  Write-Host "● publish 생략(-SkipPublish)" -ForegroundColor Yellow
}
if (-not (Test-Path $exe)) { Fail "위젯 exe 없음: $exe  (먼저 publish 필요 — -SkipPublish 빼고 실행)" }

# 3) ISCC 자동 탐색
if (-not $Iscc) {
  $cands = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",     # winget 기본(per-user 설치)
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 5\ISCC.exe"
  )
  $Iscc = $cands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $Iscc) { $c = Get-Command iscc -ErrorAction SilentlyContinue; if ($c) { $Iscc = $c.Source } }
}
if (-not $Iscc -or -not (Test-Path $Iscc)) {
  Fail "ISCC.exe(Inno Setup 컴파일러)를 못 찾음. Inno Setup 6 설치 후 재시도하거나 -Iscc <경로> 지정."
}
Write-Host "● ISCC: $Iscc" -ForegroundColor Cyan

# 4) 컴파일 (버전 주입 — .iss의 #define MyAppVersion 덮어씀)
& $Iscc "/DMyAppVersion=$ver" $iss
if ($LASTEXITCODE -ne 0) { Fail "ISCC 컴파일 실패 (exit $LASTEXITCODE)" }

# 5) 결과 (파일명은 .iss의 OutputBaseFilename과 일치)
$out = Join-Path $root ("dist\installer\TaskCalendarWidget-Setup-v{0}.exe" -f $ver)
if (Test-Path $out) {
  Write-Host ("`n✓ 완료 → {0}  ({1:N1} MB)" -f $out, ((Get-Item $out).Length/1MB)) -ForegroundColor Green
} else {
  Write-Host "`n✓ ISCC 성공했으나 예상 출력 파일을 못 찾음 — dist\installer\ 확인" -ForegroundColor Yellow
}
