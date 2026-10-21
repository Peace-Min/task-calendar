#requires -Version 5
<#
  수행과제 캘린더: 배포 파일과 배포 SQL 만들기 CLI
  ------------------------------------------------------------------
  csproj <Version>을 단일 소스로:
    1) (선택 -Build) build-installer.ps1을 먼저 돌려 설치기 생성
    2) dist\installer\TaskCalendarWidget-Setup-v<버전>.exe 의 SHA256 계산
    3) dist\installer\release-v<버전>.sql 생성 = DB 의 app_ 세 키(app_latest_version, app_installer_file,
       app_installer_sha256)를 바꾸는 짧은 SQL. 구조 번호(widget\DbGate.cs 의 AppStructureVersion)가 맞고
       갱신 중이 아닐 때만 바꾼다(docs/DB-RELEASE-OPS.md §4, docs/VERSION-GATE.md §4)
    4) dist\installer\latest.json 생성 = 0.23.0 전의 위젯(공유폴더 매니페스트를 보는 옛 업데이트 방식)을 위한 다리
    5) (선택 -CopyTo) Setup exe 를 공유폴더로 복사하고 복사본의 해시를 다시 대조한 뒤, latest.json 을 임시 이름으로 썼다가 바꿔 단다

  사용 예:
    powershell -ExecutionPolicy Bypass -File publish-update.ps1
    powershell -ExecutionPolicy Bypass -File publish-update.ps1 -Build -Notes "리마인더 개선"
    powershell -ExecutionPolicy Bypass -File publish-update.ps1 -CopyTo "\\192.168.0.10\TaskCalendar"

  ※ 2026-10-21 부터 0.23.0 이상 위젯은 배포 정보를 DB 의 app_ 키에서 읽고(위 3), 파일만 'UpdateSourceUrl' 폴더에서 받는다.
  ※ latest.json 은 전환용으로 계속 만든다. 폐쇄망의 기존 사용자(0.22 이하)는 공유폴더의 latest.json 만 보고 업데이트를 찾으므로,
    이것이 없으면 0.23.0 으로 넘어올 길이 없다. 모든 사용자가 0.23.0 이상이 된 뒤에는 공유폴더의 latest.json 을 지워도 된다.
  ※ 순서: Setup 을 먼저 올리고(옛 Setup 은 지우지 않는다), 그다음 release-v<버전>.sql 을 Workbench 에서 실행한다.
    SQL 을 먼저 돌리면 위젯이 아직 없는 파일을 받으려다 실패한다.
#>
[CmdletBinding()]
param(
  [switch]$Build,                # 발행 전 build-installer.ps1로 설치기 새로 빌드
  [string]$Notes = "",           # 배포 요약(release SQL 머리 주석에만 남는다. 배너 문구는 DB 에 두지 않는다)
  [string]$CopyTo = ""           # UNC/로컬 공유폴더 경로. 주면 Setup exe 만 그리로 복사(옛 파일은 지우지 않는다)
)
$ErrorActionPreference = 'Stop'

$here   = Split-Path -Parent $MyInvocation.MyCommand.Path      # installer\
$root   = Split-Path -Parent $here                            # 저장소 루트(task-calendar\)
$csproj = Join-Path $root 'widget\TaskCalendarWidget.csproj'
$gateCs = Join-Path $root 'widget\DbGate.cs'

function Fail($m){ Write-Host "X $m" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $csproj)) { Fail "csproj 없음: $csproj" }
if (-not (Test-Path $gateCs)) { Fail "DbGate.cs 없음: $gateCs" }

# 1) 버전 (단일 소스 = csproj <Version>)
[xml]$x = Get-Content $csproj
$ver = @($x.Project.PropertyGroup.Version | Where-Object { $_ })[0]
if ($ver) { $ver = ([string]$ver).Trim() }
if (-not $ver) { Fail "csproj에서 <Version>을 못 읽음" }
if ($ver -notmatch '^\d+\.\d+\.\d+$') { Fail "csproj <Version> 형식이 X.Y.Z 가 아님: $ver" }
Write-Host "* 버전: $ver" -ForegroundColor Cyan

# 1.2) 앱의 DB 구조 번호(단일 소스 = widget\DbGate.cs 의 AppStructureVersion). release SQL 이 이 값을 확인한다.
$gateText = Get-Content -LiteralPath $gateCs -Raw -Encoding UTF8
$structMatch = [regex]::Match($gateText, 'public const int AppStructureVersion = (\d+);')
if (-not $structMatch.Success) { Fail "DbGate.cs 에서 AppStructureVersion 을 못 읽음" }
$structure = $structMatch.Groups[1].Value
Write-Host "* DB 구조 번호: $structure (DbGate.AppStructureVersion)" -ForegroundColor Cyan

# 1.5) Notes 미지정 시 RELEASE_NOTES.md의 현재 버전 요약(인트로 문단)에서 자동 추출. release SQL 머리 주석에만 쓴다.
if (-not $Notes) {
  $rn = Join-Path $root 'RELEASE_NOTES.md'
  if (Test-Path $rn) {
    $inSec = $false
    foreach ($ln in (Get-Content $rn -Encoding UTF8)) {
      if ($ln -match ("^##\s+v" + [regex]::Escape($ver) + "\b")) { $inSec = $true; continue }   # ## v<버전> 섹션 진입
      if ($inSec) {
        if ($ln -match '^\s*(##\s|---\s*$)') { break }                # 다음 버전/구분선 → 종료
        $t = $ln.Trim()
        if ($t -and $t[0] -ne '-') { $Notes = $t; break }             # 첫 비-불릿 문단 = 요약 인트로
      }
    }
  }
  if ($Notes) { Write-Host "* 요약(자동, RELEASE_NOTES v$ver): $Notes" -ForegroundColor DarkCyan }
  else { Write-Host "! RELEASE_NOTES.md에서 v$ver 요약을 못 찾음 → 요약 없이 진행(원하면 -Notes로 지정)" -ForegroundColor Yellow }
}

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

# 4) SHA256
$sha = (Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLower()
$sizeMB = (Get-Item $setup).Length / 1MB
Write-Host ("* 설치기: {0}  ({1:N1} MB)" -f $fileName, $sizeMB) -ForegroundColor Cyan
Write-Host "* SHA256: $sha" -ForegroundColor DarkGray

# 5) release-v<버전>.sql: 앱만 바뀐 배포에서 Workbench 로 실행할 SQL(DB-RELEASE-OPS §4.2)
#    ★ 구조 번호가 맞지 않거나 갱신 중이면 1146(없는 표 이름)으로 멈추고 아무것도 바꾸지 않는다.
#    ★ 값 세 개는 한 트랜잭션으로 바꾼다. 위젯이 반쯤 바뀐 값(새 버전 번호에 옛 해시)을 읽지 않게.
function SqlStr([string]$s){ return "'" + ($s -replace "'", "''") + "'" }
$notesLine = ($Notes -replace "[\r\n]+", " ").Trim()
$releaseSql = Join-Path $distDir "release-v$ver.sql"
$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm')
$lines = @(
  "-- release-v$ver.sql  (installer\publish-update.ps1 이 $stamp 에 만들었다)",
  "-- 앱만 바뀐 배포(docs/DB-RELEASE-OPS.md §4.2). 버전 $ver, 파일 $fileName",
  "-- 요약: $notesLine",
  "--",
  "-- 실행 방법: Setup 을 공유 폴더에 **먼저** 올린 뒤, MySQL Workbench 에서 taskcalendar 를 기본 스키마로 열고",
  "--   전체 실행(Ctrl+Shift+Enter). 오류가 나면 멈추는 기본 설정을 그대로 둔다.",
  "-- 구조 번호가 $structure 이고 db_updating = 0 일 때만 app_ 세 키를 바꾼다. 아니면 1146 으로 멈춘다(아무것도 안 바뀜).",
  "SET SESSION lock_wait_timeout = 10;",
  "SET NAMES utf8mb4;",
  "",
  "SET @cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');",
  "SET @upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');",
  "SET @n_app := (SELECT COUNT(*) FROM cal_schema_meta WHERE k IN ('app_latest_version', 'app_installer_file', 'app_installer_sha256'));",
  "SET @g := IF(@cur <=> '$structure' AND @upd <=> '0' AND @n_app = 3, 'DO 0',",
  "             'SELECT 1 FROM ``중단: 구조 번호가 $structure 가 아니거나 갱신 중이다 - 이 앱의 DB 가 아니다``');",
  "PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;",
  "",
  "START TRANSACTION;",
  ("UPDATE cal_schema_meta SET v = " + (SqlStr $ver) + ", updated_at = UTC_TIMESTAMP(3) WHERE k = 'app_latest_version';"),
  ("UPDATE cal_schema_meta SET v = " + (SqlStr $fileName) + ", updated_at = UTC_TIMESTAMP(3) WHERE k = 'app_installer_file';"),
  ("UPDATE cal_schema_meta SET v = " + (SqlStr $sha) + ", updated_at = UTC_TIMESTAMP(3) WHERE k = 'app_installer_sha256';"),
  "COMMIT;",
  "",
  "SELECT k, v, updated_at FROM cal_schema_meta ORDER BY k;"
)
# BOM 없는 UTF-8, 줄끝 LF(Workbench 는 둘 다 읽는다)
[System.IO.File]::WriteAllText($releaseSql, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "`n✓ 배포 SQL 생성 → $releaseSql" -ForegroundColor Green

# 5.5) latest.json: 0.22 이하 위젯을 위한 전환용 매니페스트(형식은 옛것 그대로: version, file, notes, sha256)
$manifest = [ordered]@{
  version = $ver
  file    = $fileName
  notes   = $Notes
  sha256  = $sha
}
$json = $manifest | ConvertTo-Json -Depth 4
$latest = Join-Path $distDir 'latest.json'
# BOM 없는 UTF-8 로 기록(옛 위젯 host 가 http/ftp/파일 모두 안전하게 파싱)
[System.IO.File]::WriteAllText($latest, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "✓ 전환용 매니페스트 생성(0.22 이하 위젯용) → $latest" -ForegroundColor Green

# 6) (선택) 공유폴더로 Setup exe 만 복사. 옛 Setup 은 지우지 않는다(DB-RELEASE-OPS §4.1 1).
#    복사본을 다시 재서 해시가 같은지 본다. 다르면 SQL 을 돌리지 말아야 하므로 실패로 끝낸다.
if ($CopyTo) {
  if (-not (Test-Path $CopyTo)) {
    Write-Host "`n! 복사 대상 경로가 없습니다: $CopyTo (수동 업로드하세요)" -ForegroundColor Yellow
  } else {
    $dest = Join-Path $CopyTo $fileName
    Copy-Item $setup -Destination $dest -Force
    $copied = (Get-FileHash -Algorithm SHA256 -Path $dest).Hash.ToLower()
    if ($copied -ne $sha) { Fail "복사본 해시가 다릅니다: $dest ($copied, 기대 $sha). release SQL 을 실행하지 말고 다시 복사하세요" }
    Write-Host "`n✓ 공유폴더 복사와 해시 대조 완료 → $dest" -ForegroundColor Green
    # latest.json 은 exe 복사와 해시 대조가 끝난 **뒤에**, 임시 이름으로 썼다가 바꿔 단다.
    #   옛 위젯이 복사 도중에 확인해도 "아직 없는 exe" 나 "덜 써진 매니페스트" 를 보지 않게 한다.
    $tmp = Join-Path $CopyTo 'latest.json.tmp'
    Copy-Item $latest -Destination $tmp -Force
    Move-Item -LiteralPath $tmp -Destination (Join-Path $CopyTo 'latest.json') -Force
    Write-Host "✓ 공유폴더 latest.json 갱신(0.22 이하 위젯용)" -ForegroundColor Green
  }
}

# 7) 안내
Write-Host "`n──────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host " 배포 방법(docs/DB-RELEASE-OPS.md §4)" -ForegroundColor White
Write-Host "  1) $fileName 을 공유폴더(각 위젯의 'UpdateSourceUrl' 위치)에 올린다. 옛 Setup 은 지우지 않는다" -ForegroundColor Gray
Write-Host "     그다음 latest.json 도 올린다(0.22 이하 사용자용. -CopyTo 를 쓰면 이 순서로 자동)" -ForegroundColor Gray
Write-Host "  2) 그다음 Workbench 에서 실행: $releaseSql" -ForegroundColor Gray
Write-Host "     (DB 구조가 바뀌는 배포면 이관 SQL 을 먼저 돌린 뒤 이 SQL 을 돌린다)" -ForegroundColor Gray
Write-Host "  예) ftp://<서버IP>/TaskCalendar/, \\<서버>\TaskCalendar\, http(s)://.../TaskCalendar/" -ForegroundColor DarkGray
Write-Host "  각 위젯이 시작과 30분마다 DB 를 확인해 새 버전이면 상단 배너로 안내합니다." -ForegroundColor DarkGray
Write-Host "──────────────────────────────────────────────" -ForegroundColor DarkGray
