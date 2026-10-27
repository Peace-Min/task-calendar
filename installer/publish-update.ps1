#requires -Version 5
<#
  수행과제 캘린더: 배포 파일과 배포 SQL 만들기 CLI
  ------------------------------------------------------------------
  csproj <Version>을 단일 소스로:
    1) (선택 -Build) build-installer.ps1을 먼저 돌려 설치기 생성
    2) dist\installer\TaskCalendarWidget-Setup-v<버전>.exe 의 SHA256 계산
    3) dist\installer\release-v<버전>.sql 생성 = 이 배포의 DB 작업 전부를 담은 SQL 하나(release-sql.ps1 이 조립).
       확인, (구조 번호가 앱보다 낮으면) 닫기와 db\deploy\migrations 의 이관 조각, 끝 확인, 그리고 한 트랜잭션으로
       app_ 세 키(app_latest_version, app_installer_file, app_installer_sha256)와 db_updating = 0.
       조각 사슬이 끊겼거나 끝이 widget\DbGate.cs 의 AppStructureVersion 과 다르면 빌드 전에 실패한다
       (docs/DB-RELEASE-OPS.md §4, §5, docs/VERSION-GATE.md §4)
    4) dist\installer\latest.json 생성 = 0.23.0 전의 위젯(공유폴더 매니페스트를 보는 옛 업데이트 방식)을 위한 다리
    4.5) 영상 판(guide\guide.json version)이 바뀐 배포면 dist\installer\guide\ 도 만든다(아래 5.7, -Guide 는 늘)
    5) (선택 -CopyTo) Setup exe 를 공유폴더로 복사하고 복사본의 해시를 다시 대조한 뒤, latest.json 을 임시 이름으로 썼다가 바꿔 단다

  사용 예:
    powershell -ExecutionPolicy Bypass -File publish-update.ps1
    powershell -ExecutionPolicy Bypass -File publish-update.ps1 -Build -Notes "리마인더 개선"
    powershell -ExecutionPolicy Bypass -File publish-update.ps1 -CopyTo "\\192.168.0.10\TaskCalendar"

  ※ 2026-10-21 부터 0.23.0 이상 위젯은 배포 정보를 DB 의 app_ 키에서 읽고(위 3), 파일만 'UpdateSourceUrl' 폴더에서 받는다.
  ※ latest.json 은 전환용으로 계속 만든다. 폐쇄망의 기존 사용자(0.22 이하)는 공유폴더의 latest.json 만 보고 업데이트를 찾으므로,
    이것이 없으면 0.23.0 으로 넘어올 길이 없다. 모든 사용자가 0.23.0 이상이 된 뒤에는 공유폴더의 latest.json 을 지워도 된다.
  ※ 순서: Setup 과 latest.json 을 먼저 올리고(옛 Setup 은 지우지 않는다), Workbench Data Export 로 백업한 뒤,
    release-v<버전>.sql 하나를 Workbench 에서 한 번 실행한다. SQL 을 먼저 돌리면 위젯이 아직 없는 파일을 받으려다 실패한다.
    DB 구조가 바뀌는 배포도 따로 돌릴 이관 SQL 은 없다(이관 조각이 release SQL 안에 들어 있다).
#>
[CmdletBinding()]
param(
  [switch]$Build,                # 발행 전 build-installer.ps1로 설치기 새로 빌드
  [string]$Notes = "",           # 배포 요약(release SQL 머리 주석에만 남는다. 배너 문구는 DB 에 두지 않는다)
  [string]$CopyTo = "",          # UNC/로컬 공유폴더 경로. 주면 Setup exe 만 그리로 복사(옛 파일은 지우지 않는다)
  [switch]$Guide                 # 영상 판이 같아도 dist\installer\guide\ 로 떨군다(새 공유 폴더를 처음 채울 때)
)
$ErrorActionPreference = 'Stop'

$here   = Split-Path -Parent $MyInvocation.MyCommand.Path      # installer\
$root   = Split-Path -Parent $here                            # 저장소 루트(task-calendar\)
$csproj = Join-Path $root 'widget\TaskCalendarWidget.csproj'
$gateCs = Join-Path $root 'widget\DbGate.cs'
$relGen = Join-Path $here 'release-sql.ps1'                   # release-v<버전>.sql 조립기
$fragDir = Join-Path $root 'db\deploy\migrations'             # 이관 조각(구조 번호 순서)

function Fail($m){ Write-Host "X $m" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $csproj)) { Fail "csproj 없음: $csproj" }
if (-not (Test-Path $gateCs)) { Fail "DbGate.cs 없음: $gateCs" }
if (-not (Test-Path $relGen)) { Fail "release-sql.ps1 없음: $relGen" }

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

# 1.3) 이관 조각 사슬 확인(빌드 전에). 끊겼거나 끝이 앱 구조 번호와 다르면 여기서 멈춘다.
& $relGen -FragmentDir $fragDir -Structure ([int]$structure) -CheckOnly
if ($LASTEXITCODE -ne 0) { Fail "이관 조각 사슬이 맞지 않음(release-sql.ps1 exit $LASTEXITCODE): $fragDir" }

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
Write-Host ("* 공유폴더 업데이트용: {0} ({1:N1} MiB)" -f $fileName, $sizeMB) -ForegroundColor Cyan
Write-Host "* SHA256: $sha" -ForegroundColor DarkGray

# 5) release-v<버전>.sql: 이 배포의 DB 작업 전부(DB-RELEASE-OPS §4, §5). 조립은 release-sql.ps1 이 한다.
#    ★ 확인에서 멈추면 아무것도 바뀌지 않고, 닫은 뒤 멈추면 db_updating = 1 인 채라 모든 앱이 기다린다.
#    ★ 열기는 한 트랜잭션이다(app_ 세 키와 db_updating = 0). 위젯이 반쯤 바뀐 값(새 버전 번호에 옛 해시)을 읽지 않게.
$releaseSql = Join-Path $distDir "release-v$ver.sql"
& $relGen -FragmentDir $fragDir -Structure ([int]$structure) -Version $ver -InstallerFile $fileName -Sha256 $sha -Notes $Notes -OutFile $releaseSql
if ($LASTEXITCODE -ne 0) { Fail "배포 SQL 을 만들지 못함(release-sql.ps1 exit $LASTEXITCODE)" }
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

# 5.7) 사용 영상(docs/GUIDE-VIDEOS.md §6): 영상 판이 바뀐 배포에서만 dist\installer\guide\ 로 떨군다.
#      저장소 guide\guide.json 의 version 을 installer\guide-shipped.txt(마지막으로 떨군 영상 판과 앱 버전)와 견준다.
#      영상 판이 다르거나, 같은 앱 버전을 다시 빌드하면(그 판에서 이미 떨궜으므로) 떨군다. -Guide 는 늘 떨군다.
#      떨구면 표시 파일을 고친다. 릴리스 커밋에 같이 넣는다(빌드 PC 가 바뀌어도 판단이 같게).
$guideSrc  = Join-Path $root 'guide'
$guideOut  = Join-Path $distDir 'guide'
$guideMark = Join-Path $here 'guide-shipped.txt'
if (Test-Path $guideOut) { Remove-Item -LiteralPath $guideOut -Recurse -Force }
$guideJson = Join-Path $guideSrc 'guide.json'
$guideVer = $null
if (Test-Path $guideJson) {
  try { $guideVer = [string]((Get-Content -LiteralPath $guideJson -Raw -Encoding UTF8 | ConvertFrom-Json).version) } catch { Fail "guide\guide.json 을 읽지 못함: $($_.Exception.Message)" }
  if (-not $guideVer) { Fail "guide\guide.json 에 version 이 없음" }
}
$markGuide = ''; $markApp = ''
if (Test-Path $guideMark) {
  foreach ($ln in Get-Content -LiteralPath $guideMark -Encoding UTF8) {
    if ($ln -match '^guide=(.*)$') { $markGuide = $Matches[1].Trim() }
    elseif ($ln -match '^app=(.*)$') { $markApp = $Matches[1].Trim() }
  }
}
$guideShipped = $false
if (-not $guideVer) {
  Write-Host "* 사용 영상: 저장소에 guide\guide.json 이 없음(영상 없이 배포)" -ForegroundColor DarkGray
} elseif ($Guide -or $guideVer -ne $markGuide -or $ver -eq $markApp) {
  #  guide.json 이 가리키는 mp4 와 같은 이름의 srt, 그리고 guide.json 만 내보낸다(README 나 지난 판 파일은 공유 폴더에 올라가지 않게).
  $gj = Get-Content -LiteralPath $guideJson -Raw -Encoding UTF8 | ConvertFrom-Json
  $files = @(@($gj.videos) | ForEach-Object { [string]$_.file } | Where-Object { $_ })
  if (-not $files.Count) { Fail "guide\guide.json 에 영상이 없음" }
  New-Item -ItemType Directory -Force -Path $guideOut | Out-Null
  foreach ($f in $files) {
    $src = Join-Path $guideSrc $f
    if (-not (Test-Path -LiteralPath $src)) { Fail "guide\guide.json 의 영상이 저장소 guide\ 에 없음: $f" }
    Copy-Item -LiteralPath $src -Destination $guideOut -Force
    $srt = Join-Path $guideSrc ([IO.Path]::ChangeExtension($f, '.srt'))
    if (Test-Path -LiteralPath $srt) { Copy-Item -LiteralPath $srt -Destination $guideOut -Force }
  }
  Copy-Item -LiteralPath $guideJson -Destination $guideOut -Force
  [System.IO.File]::WriteAllText($guideMark, "guide=$guideVer`napp=$ver`n", (New-Object System.Text.UTF8Encoding($false)))
  $guideShipped = $true
  $n = @(Get-ChildItem -LiteralPath $guideOut -File).Count
  Write-Host "✓ 사용 영상 판 $guideVer 을 떨굼($n 개) → $guideOut" -ForegroundColor Green
} else {
  Write-Host "* 사용 영상: 판 $guideVer 은 $markApp 때 이미 떨궜음. 이번에는 영상 없음(공유 폴더 guide\ 는 그대로)" -ForegroundColor DarkGray
}

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
Write-Host "     TaskCalendarWidget-Setup-v$ver-full.exe 는 처음 설치용이다. 새 PC에 배포한다(자동 업데이트 대상 아님)" -ForegroundColor Gray
Write-Host "  2) Workbench Data Export 로 taskcalendar 를 백업한다(파일 끝 '-- Dump completed' 확인)" -ForegroundColor Gray
Write-Host "  3) Workbench 에서 이 파일 하나를 한 번 실행한다(Ctrl+Shift+Enter): $releaseSql" -ForegroundColor Gray
Write-Host "     DB 구조가 바뀌는 배포도 이 파일 하나다(이관 조각이 들어 있다)" -ForegroundColor Gray
if ($guideShipped) {
  Write-Host "  4) 영상 판이 바뀌었다: $guideOut 의 파일을 공유폴더의 guide\ 에 올린다(mp4 와 srt 먼저, guide.json 은 맨 마지막)" -ForegroundColor Gray
}
Write-Host "  예) ftp://<서버IP>/TaskCalendar/, \\<서버>\TaskCalendar\, http(s)://.../TaskCalendar/" -ForegroundColor DarkGray
Write-Host "  각 위젯이 시작과 30분마다 DB 를 확인해 새 버전이면 상단 배너로 안내합니다." -ForegroundColor DarkGray
Write-Host "──────────────────────────────────────────────" -ForegroundColor DarkGray
