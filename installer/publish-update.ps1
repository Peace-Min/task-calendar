#requires -Version 5
<#
  수행과제 캘린더 — 자동 업데이트 매니페스트 발행 CLI
  ------------------------------------------------------------------
  csproj <Version>을 단일 소스로:
    1) (선택 -Build) build-installer.ps1을 먼저 돌려 설치기 생성
    2) dist\installer\TaskCalendarWidget-Setup-v<버전>.exe 의 SHA256 계산
    3) dist\installer\latest.json 생성 = { version, file, notes, sha256 }
    4) 공유폴더 업로드 안내(또는 -CopyTo 로 UNC/로컬 경로에 자동 복사)

  사용 예:
    powershell -ExecutionPolicy Bypass -File publish-update.ps1
    powershell -ExecutionPolicy Bypass -File publish-update.ps1 -Build -Notes "리마인더 개선"
    powershell -ExecutionPolicy Bypass -File publish-update.ps1 -CopyTo "\\192.168.0.10\TaskCalendar"

  ※ latest.json 의 version/file 은 각 위젯이 자기 버전과 비교/다운로드하는 계약이다.
    이 두 파일(latest.json + Setup exe)을 위젯 설정의 'UpdateSourceUrl' 폴더에 함께 올려야 한다.
#>
[CmdletBinding()]
param(
  [switch]$Build,                # 발행 전 build-installer.ps1로 설치기 새로 빌드
  [string]$Notes = "",           # latest.json 의 notes(배너에 표시될 짧은 안내)
  [string]$CopyTo = ""           # UNC/로컬 공유폴더 경로 — 주면 latest.json+Setup을 그리로 복사
)
$ErrorActionPreference = 'Stop'

$here   = Split-Path -Parent $MyInvocation.MyCommand.Path      # installer\
$root   = Split-Path -Parent $here                            # 저장소 루트(task-calendar\)
$csproj = Join-Path $root 'widget\TaskCalendarWidget.csproj'

function Fail($m){ Write-Host "X $m" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $csproj)) { Fail "csproj 없음: $csproj" }

# 1) 버전 (단일 소스 = csproj <Version>)
[xml]$x = Get-Content $csproj
$ver = @($x.Project.PropertyGroup.Version | Where-Object { $_ })[0]
if ($ver) { $ver = ([string]$ver).Trim() }
if (-not $ver) { Fail "csproj에서 <Version>을 못 읽음" }
Write-Host "* 버전: $ver" -ForegroundColor Cyan

# 2) (선택) 설치기 빌드
if ($Build) {
  $bi = Join-Path $here 'build-installer.ps1'
  if (-not (Test-Path $bi)) { Fail "build-installer.ps1 없음: $bi" }
  Write-Host "* 설치기 빌드 중(build-installer.ps1)..." -ForegroundColor Cyan
  & powershell -ExecutionPolicy Bypass -File $bi
  if ($LASTEXITCODE -ne 0) { Fail "build-installer.ps1 실패 (exit $LASTEXITCODE)" }
}

# 3) 설치기 확인
$fileName = "TaskCalendarWidget-Setup-v$ver.exe"
$distDir  = Join-Path $root 'dist\installer'
$setup    = Join-Path $distDir $fileName
if (-not (Test-Path $setup)) {
  Fail "설치기 없음: $setup  (먼저 -Build 로 빌드하거나 build-installer.ps1 실행)"
}

# 4) SHA256 + latest.json 생성
$sha = (Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLower()
$sizeMB = (Get-Item $setup).Length / 1MB
Write-Host ("* 설치기: {0}  ({1:N1} MB)" -f $fileName, $sizeMB) -ForegroundColor Cyan
Write-Host "* SHA256: $sha" -ForegroundColor DarkGray

$manifest = [ordered]@{
  version = $ver
  file    = $fileName
  notes   = $Notes
  sha256  = $sha
}
$json = $manifest | ConvertTo-Json -Depth 4
$latest = Join-Path $distDir 'latest.json'
# BOM 없는 UTF-8 로 기록(위젯 host가 http/ftp/파일 모두 안전하게 파싱)
[System.IO.File]::WriteAllText($latest, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "`n✓ 생성 → $latest" -ForegroundColor Green
Write-Host $json -ForegroundColor DarkGray

# 5) (선택) 공유폴더로 복사
if ($CopyTo) {
  if (-not (Test-Path $CopyTo)) {
    Write-Host "`n! 복사 대상 경로가 없습니다: $CopyTo (수동 업로드하세요)" -ForegroundColor Yellow
  } else {
    Copy-Item $latest -Destination (Join-Path $CopyTo 'latest.json') -Force
    Copy-Item $setup  -Destination (Join-Path $CopyTo $fileName)     -Force
    Write-Host "`n✓ 공유폴더 복사 완료 → $CopyTo" -ForegroundColor Green
    Write-Host "  - latest.json" -ForegroundColor DarkGray
    Write-Host "  - $fileName"   -ForegroundColor DarkGray
  }
}

# 6) 안내
Write-Host "`n──────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host " 배포 방법" -ForegroundColor White
Write-Host "  이 두 파일을 공유폴더(각 위젯의 'UpdateSourceUrl' 위치)에 함께 올리세요:" -ForegroundColor Gray
Write-Host "    1) latest.json" -ForegroundColor Gray
Write-Host "    2) $fileName" -ForegroundColor Gray
Write-Host "  예) ftp://<서버IP>/TaskCalendar/  ·  \\<서버>\TaskCalendar\  ·  http(s)://.../TaskCalendar/" -ForegroundColor DarkGray
Write-Host "  각 위젯이 시작+6시간마다 조용히 확인 → 새 버전이면 상단 배너로 안내합니다." -ForegroundColor DarkGray
Write-Host "──────────────────────────────────────────────" -ForegroundColor DarkGray
