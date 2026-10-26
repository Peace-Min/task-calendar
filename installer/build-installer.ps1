#requires -Version 5
<#
  수행과제 캘린더 — 인스톨러 빌드 CLI
  ------------------------------------------------------------------
  csproj의 <Version>을 단일 소스로 삼아:
    1) (기본) 위젯을 self-contained 단일 exe로 publish
    2) ISCC로 업데이트용과 처음 설치용(-full)을 각각 컴파일
  → dist\installer\TaskCalendarWidget-Setup-v<버전>.exe 및 -full.exe 생성

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

# 두 설치기를 모두 만들므로 Full에 필요한 런타임이 없으면 publish 전에 중단한다.
$webviewSetup = Join-Path $root 'redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
if (-not (Test-Path -LiteralPath $webviewSetup -PathType Leaf)) {
  Fail "WebView2 오프라인 x64 설치기가 없습니다. redist/README.md에 따라 준비하세요."
}
Write-Host "● WebView2 오프라인 런타임 포함: $webviewSetup" -ForegroundColor Cyan

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

# 4) 같은 앱으로 공유폴더 업데이트용과 처음 설치용을 함께 만든다.
$variants = @(
  @{ Full = 0; Suffix = ''; Label = '공유폴더 업데이트용' },
  @{ Full = 1; Suffix = '-full'; Label = '처음 설치용(WebView2 포함)' }
)
foreach ($variant in $variants) {
  Write-Host "● $($variant.Label) 컴파일 중..." -ForegroundColor Cyan
  & $Iscc "/DMyAppVersion=$ver" "/DFullInstaller=$($variant.Full)" $iss
  if ($LASTEXITCODE -ne 0) { Fail "$($variant.Label) ISCC 컴파일 실패 (exit $LASTEXITCODE)" }

  $out = Join-Path $root ("dist\installer\TaskCalendarWidget-Setup-v{0}{1}.exe" -f $ver, $variant.Suffix)
  if (-not (Test-Path -LiteralPath $out -PathType Leaf)) { Fail "예상 설치기가 없습니다: $out" }
  $hash = (Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host ("✓ {0}: {1} ({2:N1} MiB)" -f $variant.Label, $out, ((Get-Item -LiteralPath $out).Length/1MB)) -ForegroundColor Green
  Write-Host "  SHA256: $hash" -ForegroundColor DarkGray
}
