<#
  setup-taskcalendar.ps1 — 새 주 DB `taskcalendar` 원큐 구축. 보통은 setup-taskcalendar.cmd 더블클릭.

  무엇을 하나 — 같은 MySQL 8.4 서버 안에서, 기존 `taskmgr` 옆에 새 DB 를 하나 더 세운다:
    구조(정본 DDL 파일) → 데이터(taskmgr 에서 복사 · id/uid 보존) → 앱 계정 권한 → 검증 보고서.
    ★ 원본 `taskmgr` 는 **읽기만** 한다(0.16 클라이언트가 계속 그 DB 를 쓴다). 이 스크립트가
      원본에 내는 문장은 SELECT 와 mysqldump(읽기) 뿐이다.
    ★ 캘린더 표(cal_*)는 원본에 없으므로 비어 있는 채로 시작한다
      (cal_schema_meta 버전 행과 cal_user_rev 사용자별 0 행만 채운다 — 아래 [3] 참조).

  단계(화면에 [n/5] 로 찍힌다. 첫 실패에서 멈춘다):
    [0] 사전 점검 — mysql.exe/mysqldump.exe · 접속 · DDL/권한 파일 6개 · 원본 7표 · 대상 DB 부재 ·
        앱 계정 → 요약을 보여 주고 'Y' 를 받는다(-Yes 면 묻지 않는다)
    [1] 원본 백업 — mysqldump(--single-transaction --no-tablespaces --routines --triggers).
        '-- Dump completed' 마감 줄과 1KB 초과를 확인한다. (-Force 로 기존 대상을 지울 때는
        지우기 전에 대상도 한 벌 뜬다.)
    [2] 구조 — CREATE DATABASE → schema-structure.sql → 01-schema-users.sql → schema-calendar.sql
        (사용자 표가 캘린더보다 먼저여야 한다: schema-calendar.sql 머리의 가드가 app_user.user_id 를 요구한다)
        → 표 개수 · schema_version(= schema-calendar.sql 이 시딩하는 값, 파일에서 읽는다) 대조
    [3] 데이터 복사 — FK 순서로 7표. 컬럼은 원본∩대상 교집합(빠진 컬럼은 대상 기본값, 원본에만 있는
        컬럼은 보고서에 이름을 적는다). 과제 트랙 4표의 created_at/updated_at 은 KST→UTC(-9h) 로 민다
        (-NoShift 로 끈다). 이후 고아 행 0 · 행 수 일치 · AUTO_INCREMENT > MAX(id) 를 확인한다.
    [4] 권한 — create-app-user.sql · grants-calendar.sql(두 파일의 `taskmgr.` 를 대상 DB 로 바꾼 임시 사본) ·
        05-grants.sql(DATABASE() 를 쓰므로 원본 그대로, 대상 DB 를 선택한 채 실행) → SHOW GRANTS 대조
    [5] 보고서 — 화면에 찍힌 모든 줄을 <BackupDir>\setup-taskcalendar-<시각>.txt 로 남긴다.
        (실패·취소·사전 점검 중단도 남긴다 — 이름 끝에 -FAILED. 백업 폴더를 못 만들면 이 스크립트 옆에 쓴다.)

  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
    0 ok - taskcalendar built and every verification passed
    1 failed - a step after the confirmation failed; see the last red line and the report file
    2 cancelled - the confirmation was not Y; nothing was changed
    3 preflight failed - tools, files, connection, source tables, target exists or app account; nothing was changed
  --- END EXITCODES ---

  ⚠️ 비밀번호: 관리자 비번(-RootPassword)·앱 비번(-AppPassword)은 mysql 명령줄에 절대 싣지 않는다.
     임시 .cnf(--defaults-extra-file)에만 쓰고, 끝나면(실패해도) finally 에서 지운다.
     -RootPassword 를 이 스크립트의 인자로 주는 것도 같은 사용자의 다른 프로세스가 명령줄로 읽을 수
     있으니(init-calendar.ps1 머리말의 실측) 대화형이면 비워 두고 물어보게 둘 것. 무인이면 stdin 첫 줄로:
       "비번" | powershell -NoProfile -ExecutionPolicy Bypass -File setup-taskcalendar.ps1 -Yes

  ⚠️ -Force: 대상 DB(-TargetDb)가 이미 있으면 기본은 멈춘다(종료코드 3). -Force 를 주면 그 DB 를
     한 벌 백업한 뒤 DROP DATABASE 하고 처음부터 다시 만든다. 운영이 이미 새 DB 로 넘어간 뒤에는
     쓰지 말 것 — 그 사이 쌓인 캘린더 데이터가 사라진다(백업 파일에서만 되살릴 수 있다).

  ⚠️ 인자 값을 역슬래시로 끝내지 말 것(-BackupDir "D:\x\" 등). powershell.exe 가 \" 를 이스케이프된
     따옴표로 읽어 뒤따르는 인자를 통째로 삼키고, -TargetDb 같은 값이 조용히 기본값으로 돌아간다.
     아래 AssertNoSwallow 가 그 상태를 감지하면 멈춘다(init-calendar.ps1 과 같은 가드).

  예)  setup-taskcalendar.cmd
       setup-taskcalendar.cmd -DbHost 192.168.0.50 -CompanyDataDir "D:\taskmgr-company-data"
       setup-taskcalendar.cmd -Force -Yes          (리허설: 있으면 지우고 다시, 묻지 않음)
#>
[CmdletBinding()]
param(
  [string]$DbHost = "127.0.0.1",        # MySQL 호스트
  [int]$Port = 3306,
  [string]$SourceDb = "taskmgr",        # 원본(읽기만 한다)
  [string]$TargetDb = "taskcalendar",   # 새로 만들 DB
  [string]$BaseDir = "C:\mysql",        # mysql.exe 위치(없으면 서비스 binPath 추론)
  [string]$ServiceName = "MySQL84",
  [string]$DbUser = "root",             # DDL·GRANT 를 낼 관리 계정
  [string]$RootPassword = "",           # 비우면 물어봄
  [string]$AppUser = "taskmgr_app",     # 앱 계정(권한 파일 3개에 박힌 이름과 같아야 한다)
  [string]$AppPassword = "",            # 앱 계정이 아직 없을 때만 필요
  [string]$CompanyDataDir = "",         # 비우면 <스크립트>\..\..\..\taskmgr-company-data
  [string]$BackupDir = "",              # 비우면 <스크립트>\..\..\dist\setup-taskcalendar\backup
  [switch]$Force,                       # 대상 DB 가 이미 있으면 백업 후 DROP 하고 다시 만든다
  [switch]$NoShift,                     # 과제 트랙 created_at/updated_at 의 KST→UTC 이동을 끈다
  [switch]$Yes                          # 확인 질문을 건너뛴다(무인 리허설)
)
$ErrorActionPreference = "Continue"     # 네이티브 stderr 가 창을 닫지 않게(Stop 금지)

# ============================================================================
#  상수 — 종료코드 · 복사 순서 · 시각 이동 대상 · 검사 목록
# ============================================================================
$EXIT_OK        = 0
$EXIT_FAIL      = 1
$EXIT_CANCEL    = 2
$EXIT_PREFLIGHT = 3

# 복사 순서 = FK 부모 → 자식. (FK 검사를 끄고 넣으므로 순서가 정합성을 좌우하지는 않지만,
# 실패했을 때 '어디까지 들어갔는가' 를 사람이 읽을 수 있게 부모부터 넣는다.)
$COPY_ORDER   = @('section_code','status_code','customer','title_code','org_unit','app_user','project')

# KST→UTC 이동 대상. 옛 DB 는 0.16 클라이언트가 KST 로 썼고, 지금 코드는 UTC 로 쓴다
# (마이그레이션 v9 가 바로 이 표들에 같은 -9h 이동을 했다). 사용자 3표(title_code/org_unit/app_user)는
# 옮기지 않는다 — 따로 시딩·이관된 표이고, 이미 UTC 인 사본과 같다는 것을 사용자가 확인했다.
$SHIFT_TABLES = @('section_code','status_code','customer','project')
$SHIFT_COLS   = @('created_at','updated_at')

# 구조 단계 후 대상 DB 의 표 개수(과제 4 + 사용자 3 + 캘린더 16). 아래 사전 점검이 세 DDL 파일의
# CREATE TABLE 수와도 맞춰 본다 — 파일에 표가 늘면 여기서 먼저 멈추고 이 값을 함께 고치라고 말한다.
$EXPECTED_TABLE_COUNT = 23

# 정체성 컬럼. 원본에 이 컬럼이 없으면 교집합 복사가 조용히 새 번호를 매긴다 — 그러면 cal_* 가
# 가리킬 사람·과제의 번호가 옛 DB 와 달라진다. 그래서 사전 점검에서 원본에 있는지부터 본다.
$KEY_COLS = [ordered]@{
  section_code = @('name');   status_code = @('name');  customer = @('name')
  title_code   = @('name');   org_unit    = @('org_id'); app_user = @('user_id')
  project      = @('id','uid')
}
$AUTOINC_KEYS = [ordered]@{ project = 'id'; org_unit = 'org_id'; app_user = 'user_id' }

# 고아 행 검사. 복사 중에는 FK 검사를 껐으므로 **이것이 진짜 검사다.**
# 자식 컬럼이 NULL 이면 '참조 없음' 이라 고아가 아니다(status · org_id · title · parent_id 는 NULL 허용).
$ORPHAN_CHECKS = @(
  @{ name='project -> customer';     child='project';  col='customer';  parent='customer';     pcol='name' },
  @{ name='project -> section_code'; child='project';  col='section';   parent='section_code'; pcol='name' },
  @{ name='project -> status_code';  child='project';  col='status';    parent='status_code';  pcol='name' },
  @{ name='app_user -> org_unit';    child='app_user'; col='org_id';    parent='org_unit';     pcol='org_id' },
  @{ name='app_user -> title_code';  child='app_user'; col='title';     parent='title_code';   pcol='name' },
  @{ name='org_unit -> org_unit';    child='org_unit'; col='parent_id'; parent='org_unit';     pcol='org_id' }
)

# ============================================================================
#  출력 · 보고서 · 종료
# ============================================================================
$script:logLines   = New-Object System.Collections.Generic.List[string]
$script:tempFiles  = New-Object System.Collections.Generic.List[string]
$script:cnfPath    = $null
$script:preflight  = $true     # 확인 전 실패 = 3(아무것도 안 바꿈) · 확인 후 실패 = 1
$script:reportDir  = $null     # 백업 폴더가 준비된 뒤에만 보고서를 쓴다
$script:ts         = Get-Date -Format 'yyyyMMdd-HHmmss'

function Log([string]$m, [string]$color){
  if($color){ Write-Host $m -ForegroundColor $color } else { Write-Host $m }
  $script:logLines.Add($m)
}
function Info($m){ Log "[*] $m" }
function Ok($m){   Log "[OK] $m" 'Green' }
function Warn($m){ Log "[!] $m" 'Yellow' }
function Step($n, $m){ Log ""; Log "==== [$n/5] $m ====" 'Cyan' }

# 임시 파일은 전부 여기로 모아 finally 에서 지운다. .cnf 는 관리자 비번을, 앱 계정 사본은 앱 비번을 담는다.
function NewTemp([string]$prefix, [string]$ext){
  $p = Join-Path $env:TEMP ($prefix + [IO.Path]::GetRandomFileName() + $ext)
  $script:tempFiles.Add($p)
  return $p
}
function Cleanup(){
  if($script:cnfPath){ Remove-Item -LiteralPath $script:cnfPath -Force -ErrorAction SilentlyContinue; $script:cnfPath = $null }
  foreach($f in @($script:tempFiles)){ Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
  $script:tempFiles.Clear()
}
function SaveReport([string]$suffix){
  # 보고서 폴더는 -BackupDir 가 확정되는 즉시 잡는다(아래 참조). 그 전에(인자 검증에서) 죽으면 스크립트 폴더에 남긴다 —
  # 어떤 종료코드로 끝나든 "화면에 찍힌 것" 이 파일로 남아야 폐쇄망에서 결과를 가져올 수 있다(2026-09-29 실측: 사전 점검
  # 실패 = 3 은 [1] 백업 단계에 못 미쳐 보고서 폴더가 비어 있었고, 그래서 파일이 하나도 안 남았다).
  $dir = $script:reportDir
  if(-not $dir){ $dir = Split-Path -Parent $PSCommandPath }
  $p = Join-Path $dir ("setup-taskcalendar-" + $script:ts + $suffix + ".txt")
  try {
    Write-Host "[*] 보고서: $p"
    $script:logLines.Add("[*] 보고서: $p")
    # BOM 을 붙인다 — 메모장(구판 포함)이 한국어를 UTF-8 로 확실히 알아보게.
    [IO.File]::WriteAllLines($p, $script:logLines.ToArray(), (New-Object System.Text.UTF8Encoding($true)))
  } catch { Write-Host "[!] 보고서를 쓰지 못했습니다: $p ($($_.Exception.Message))" -ForegroundColor Yellow }
}
# 모든 종료가 이 한 곳을 지난다 — 보고서를 남기고, 비밀이 든 임시 파일을 지우고, 코드를 낸다.
function Finish($code, [string]$lastLine, [string]$color){
  Log $lastLine $color
  if($code -eq $EXIT_OK){ SaveReport "" } else { SaveReport "-FAILED" }
  Cleanup
  if($code -eq $EXIT_OK -and -not $Yes -and -not [Console]::IsInputRedirected){
    try { Read-Host "엔터를 누르면 종료" | Out-Null } catch {}
  }
  exit $code
}
# 확인 전(사전 점검)에 죽으면 3, 확인 뒤에 죽으면 1. 호출하는 쪽이 고를 필요가 없게 여기서 가른다.
function Die([string]$m){
  if($script:preflight){
    Log "[사전 점검 실패] $m" 'Red'
    Finish $EXIT_PREFLIGHT "중단: 사전 점검 실패(종료코드 $EXIT_PREFLIGHT). 아무것도 바꾸지 않았습니다." 'Red'
  }
  Log "[오류] $m" 'Red'
  Finish $EXIT_FAIL "중단: 실패(종료코드 $EXIT_FAIL). 원본 '$SourceDb' 는 그대로입니다. 원인을 고친 뒤 -Force 로 다시 실행하세요." 'Red'
}

# ============================================================================
#  인자 검증 — 인자가 뒤엉킨 채 '조용히 다른 DB' 를 대상으로 진행하는 것을 막는다
# ============================================================================
# 왜: .cmd 가 %* 로 넘기는 인자 중 값이 역슬래시로 끝나는 따옴표 인자(-BackupDir "C:\x\")가 있으면
#   powershell.exe 가 \" 를 이스케이프된 따옴표로 읽어 뒤 인자를 그 값 안으로 삼킨다(init-calendar.ps1 실측).
#   그러면 -TargetDb 가 기본값으로 돌아가고 -Force 가 사라지는 식으로 대상이 바뀐다. 값은 고치지 않고 멈춘다.
$SWALLOW_FLAGS = '\s-(DbHost|Port|SourceDb|TargetDb|BaseDir|ServiceName|DbUser|RootPassword|AppUser|AppPassword|CompanyDataDir|BackupDir|Force|NoShift|Yes)\b'
function AssertNoSwallow($label, $val){
  if("$val" -match '"'){ Die "$label 값에 따옴표가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태입니다 — 경로 끝의 역슬래시를 빼고 다시 실행하세요(예: -BackupDir `"D:\backup`")." }
  if("$val" -match $SWALLOW_FLAGS){ Die "$label 값 안에 다른 인자가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태라 대상이 의도와 다릅니다 — 경로 끝의 역슬래시를 빼고 다시 실행하세요." }
}
# 비밀번호는 따옴표를 포함할 수 있으므로 '다른 인자를 삼켰는가' 만 본다. 값은 화면에 찍지 않는다.
function AssertNoSwallowSecret($label, $val){
  if("$val" -match $SWALLOW_FLAGS){ Die "$label 값 안에 다른 인자 이름이 들어 있습니다(값은 표시하지 않음). 앞 인자가 역슬래시로 끝나 뒤 인자를 삼킨 상태로 보입니다 — 경로 끝의 역슬래시를 빼고 다시 실행하세요." }
}

Log "=================================================="
Log "   새 주 DB 구축: $SourceDb → $TargetDb"
Log "   서버: $DbHost`:$Port   (원본은 읽기만 합니다)"
Log "=================================================="

Step 0 "사전 점검"
AssertNoSwallow "-DbHost"         $DbHost
AssertNoSwallow "-SourceDb"       $SourceDb
AssertNoSwallow "-TargetDb"       $TargetDb
AssertNoSwallow "-BaseDir"        $BaseDir
AssertNoSwallow "-ServiceName"    $ServiceName
AssertNoSwallow "-DbUser"         $DbUser
AssertNoSwallow "-AppUser"        $AppUser
AssertNoSwallow "-CompanyDataDir" $CompanyDataDir
AssertNoSwallow "-BackupDir"      $BackupDir
AssertNoSwallowSecret "-RootPassword" $RootPassword
AssertNoSwallowSecret "-AppPassword"  $AppPassword
# 아래 값들은 SQL 문자열·식별자에 그대로 들어간다. 여기 통과가 곧 그 자리의 안전 조건이다.
if($SourceDb -notmatch '^[A-Za-z0-9_]+$'){ Die "-SourceDb 가 식별자 형식이 아닙니다: [$SourceDb]" }
if($TargetDb -notmatch '^[A-Za-z0-9_]+$'){ Die "-TargetDb 가 식별자 형식이 아닙니다: [$TargetDb]" }
if($SourceDb -eq $TargetDb){ Die "-SourceDb 와 -TargetDb 가 같습니다([$SourceDb]). 원본 위에 새 DB 를 만들 수는 없습니다." }
if($AppUser -notmatch '^[A-Za-z0-9_]+$'){ Die "-AppUser 가 식별자 형식이 아닙니다: [$AppUser]" }
if($DbUser -notmatch '^[A-Za-z0-9_.$-]+$'){ Die "-DbUser 가 식별자 형식이 아닙니다: [$DbUser]" }
if($DbHost -notmatch '^[A-Za-z0-9_.:-]+$'){ Die "-DbHost 형식이 이상합니다: [$DbHost]" }
if($Port -lt 1 -or $Port -gt 65535){ Die "-Port 범위가 아닙니다: $Port" }

function FullPath([string]$p){
  if(-not [IO.Path]::IsPathRooted($p)){ $p = Join-Path (Get-Location).ProviderPath $p }
  return [IO.Path]::GetFullPath($p)
}
$scriptDir = Split-Path -Parent $PSCommandPath
if(-not $CompanyDataDir){ $CompanyDataDir = Join-Path $scriptDir "..\..\..\taskmgr-company-data" }
if(-not $BackupDir){      $BackupDir      = Join-Path $scriptDir "..\..\dist\setup-taskcalendar\backup" }
$CompanyDataDir = FullPath $CompanyDataDir
$BackupDir      = FullPath $BackupDir
# 보고서 폴더를 지금 잡는다 — 사전 점검(종료코드 3)·취소(2)로 끝나도 보고서가 남도록. 못 만들면 SaveReport 가 스크립트 폴더로 떨어진다.
if(-not (Test-Path -LiteralPath $BackupDir)){ try { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null } catch {} }
if(Test-Path -LiteralPath $BackupDir){ $script:reportDir = $BackupDir }

# --- 도구: mysql.exe / mysqldump.exe (init-calendar.ps1 · backup-taskmgr.ps1 과 같은 방식) ---
$mysql     = Join-Path $BaseDir "bin\mysql.exe"
$mysqldump = Join-Path $BaseDir "bin\mysqldump.exe"
if(-not (Test-Path -LiteralPath $mysql) -or -not (Test-Path -LiteralPath $mysqldump)){
  try {
    $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    if($svc -and $svc.PathName -match '"?([A-Za-z]:[^"]*)\\bin\\mysqld\.exe'){
      $root = $Matches[1]
      $c1 = Join-Path $root "bin\mysql.exe";     if(Test-Path -LiteralPath $c1){ $mysql = $c1 }
      $c2 = Join-Path $root "bin\mysqldump.exe"; if(Test-Path -LiteralPath $c2){ $mysqldump = $c2 }
    }
  } catch {}
}
if(-not (Test-Path -LiteralPath $mysql)){     Die "mysql.exe 를 못 찾았습니다. -BaseDir 로 설치 경로를 지정하세요(예: -BaseDir `"C:\Program Files\MySQL\MySQL Server 8.4`")." }
if(-not (Test-Path -LiteralPath $mysqldump)){ Die "mysqldump.exe 를 못 찾았습니다. -BaseDir 로 설치 경로를 지정하세요(예: -BaseDir `"C:\Program Files\MySQL\MySQL Server 8.4`")." }
Ok "도구: $mysql"

# --- DDL · 권한 파일 6개 ---
$structFile        = Join-Path $scriptDir "schema-structure.sql"
$calFile           = Join-Path $scriptDir "schema-calendar.sql"
$appUserFile       = Join-Path $scriptDir "create-app-user.sql"
$calGrantsFile     = Join-Path $scriptDir "grants-calendar.sql"
if(-not (Test-Path -LiteralPath $CompanyDataDir -PathType Container)){
  Die "회사 데이터 폴더가 없습니다: $CompanyDataDir — 01-schema-users.sql · 05-grants.sql 이 든 taskmgr-company-data 폴더를 -CompanyDataDir 로 지정하세요."
}
$usersFile         = Join-Path $CompanyDataDir "01-schema-users.sql"
$companyGrantsFile = Join-Path $CompanyDataDir "05-grants.sql"
foreach($f in @($structFile, $calFile, $appUserFile, $calGrantsFile, $usersFile, $companyGrantsFile)){
  if(-not (Test-Path -LiteralPath $f -PathType Leaf)){ Die "필요한 파일이 없습니다: $f" }
}
Ok "DDL·권한 파일 6개 확인 (회사 데이터: $CompanyDataDir)"

# .sql 은 BOM 없는 UTF-8 이다. -Encoding UTF8 을 빼면 5.1 이 시스템 ANSI 로 읽어 한국어가 깨진다.
$structText        = Get-Content -LiteralPath $structFile        -Raw -Encoding UTF8
$calText           = Get-Content -LiteralPath $calFile           -Raw -Encoding UTF8
$usersText         = Get-Content -LiteralPath $usersFile         -Raw -Encoding UTF8
$appUserText       = Get-Content -LiteralPath $appUserFile       -Raw -Encoding UTF8
$calGrantsText     = Get-Content -LiteralPath $calGrantsFile     -Raw -Encoding UTF8
$companyGrantsText = Get-Content -LiteralPath $companyGrantsFile -Raw -Encoding UTF8

# 기대 스키마 버전은 schema-calendar.sql 이 시딩하는 값 그대로다(숫자를 여기 박지 않는다 — 박으면
# 스키마가 올라갈 때 이 스크립트만 낡아 '정상 구축' 을 실패로 판정한다).
$verMatch = [regex]::Match($calText, "VALUES \('schema_version', '(\d+)'")
if(-not $verMatch.Success){ Die "schema-calendar.sql 에서 schema_version 시딩 줄(VALUES ('schema_version', 'N'))을 찾지 못했습니다 — 파일 형식이 바뀌었습니다." }
$expVersion = $verMatch.Groups[1].Value

# 세 DDL 파일이 만드는 표 이름(줄머리의 CREATE TABLE 만 — 주석 속 예시는 '--' 로 시작하므로 안 걸린다).
$ddlTables = @()
foreach($txt in @($structText, $usersText, $calText)){
  foreach($m in [regex]::Matches($txt, '(?im)^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?')){
    if($ddlTables -notcontains $m.Groups[1].Value){ $ddlTables += $m.Groups[1].Value }
  }
}
if($ddlTables.Count -ne $EXPECTED_TABLE_COUNT){
  Die "세 DDL 파일의 CREATE TABLE 이 $($ddlTables.Count)개입니다(기대 $EXPECTED_TABLE_COUNT). 표가 늘거나 줄었다면 이 스크립트의 `$EXPECTED_TABLE_COUNT 를 함께 고치세요: $($ddlTables -join ', ')"
}
foreach($t in $COPY_ORDER){
  if($ddlTables -notcontains $t){ Die "DDL 파일에 복사 대상 표 '$t' 의 CREATE TABLE 이 없습니다." }
}

# 권한 파일 3개는 계정 이름을 글자로 박아 두었다. -AppUser 가 다르면 엉뚱한 계정에 권한이 붙는다.
if(-not $appUserText.Contains("'" + $AppUser + "'@'%'")){   Die "create-app-user.sql 에 '$AppUser'@'%' 가 없습니다 — 이 파일이 만드는 계정과 -AppUser 가 다릅니다." }
if(-not $calGrantsText.Contains("'" + $AppUser + "'@'%'")){ Die "grants-calendar.sql 에 '$AppUser'@'%' 가 없습니다 — 이 파일이 권한을 주는 계정과 -AppUser 가 다릅니다." }
if(-not $companyGrantsText.Contains("''" + $AppUser + "''@''%''")){ Die "05-grants.sql 에 ''$AppUser''@''%'' 가 없습니다 — 이 파일이 권한을 주는 계정과 -AppUser 가 다릅니다." }

# --- 관리자 비밀번호 ---
function ReadSecret([string]$prompt){
  # Read-Host -AsSecureString 은 stdin 이 리다이렉트돼 있으면 콘솔을 기다리며 영원히 멈춘다
  # (init-calendar.ps1 실측). 그 경우에는 stdin 첫 줄을 읽는다.
  if([Console]::IsInputRedirected){
    $line = $null
    try { $line = [Console]::In.ReadLine() } catch { $line = $null }
    return $line
  }
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
if(-not $RootPassword){ $RootPassword = ReadSecret "MySQL $DbUser 비밀번호" }
if(-not $RootPassword){ Die "$DbUser 비밀번호가 비어 있습니다(무인 실행이면 stdin 첫 줄로 주세요)." }

# ============================================================================
#  여기서부터 임시 파일이 생긴다 — 어디서 끝나든 finally/Finish 가 지운다
# ============================================================================
try {
  # --- 임시 .cnf. 비번은 여기에만 쓴다(명령줄 금지). BOM 금지 — MySQL 옵션 파서가 첫 줄을 못 읽는다.
  #     ascii 인코딩 금지 — 비ASCII 비번이 조용히 '?' 로 바뀐다(init-calendar.ps1 실측).
  $pwEsc = ($RootPassword -replace '\\','\\') -replace '"','\"'
  $script:cnfPath = Join-Path $env:TEMP ("mysetup_" + [IO.Path]::GetRandomFileName() + ".cnf")
  $cnfText = "[client]`r`nuser=$DbUser`r`npassword=""$pwEsc""`r`nhost=$DbHost`r`nport=$Port`r`ndefault-character-set=utf8mb4`r`n"
  [IO.File]::WriteAllText($script:cnfPath, $cnfText, (New-Object System.Text.UTF8Encoding($false)))

  function BQ([string]$n){ return ('`' + $n + '`') }
  function TQ([string]$db, [string]$t){ return ((BQ $db) + '.' + (BQ $t)) }

  # 한 결과 질의(-N -B = 머리줄·격자 없음). 실패하면 그 자리에서 죽는다 — 이 스크립트의 질의는 전부 필수다.
  function Q([string]$sql, [string]$what){
    $o = & $mysql "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql
    $rc = $LASTEXITCODE
    if($rc -ne 0){ Die "$what — mysql 이 코드 $rc 로 실패했습니다. 위에 찍힌 mysql 오류를 확인하세요." }
    if($null -eq $o){ return "" }
    return ((@($o) -join "`n").Trim())
  }
  function QRows([string]$sql, [string]$what){
    $o = & $mysql "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql
    $rc = $LASTEXITCODE
    if($rc -ne 0){ Die "$what — mysql 이 코드 $rc 로 실패했습니다. 위에 찍힌 mysql 오류를 확인하세요." }
    if($null -eq $o){ return @() }
    return @(@($o) | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne "" })
  }
  # .sql 파일을 바이트 그대로 mysql 에 흘려 넣는다(Get-Content → -e 로 넘기면 인코딩·따옴표가 두 번 해석된다).
  # 2>&1 은 cmd 안에서 처리되므로 PowerShell 5.1 의 NativeCommandError 포장이 생기지 않는다.
  function ApplySqlFile([string]$file, [string]$db, [string]$label){
    Info "적용: $label"
    if($db){
      $out = cmd /c "`"$mysql`" --defaults-extra-file=`"$($script:cnfPath)`" --default-character-set=utf8mb4 `"$db`" 2>&1 < `"$file`""
    } else {
      $out = cmd /c "`"$mysql`" --defaults-extra-file=`"$($script:cnfPath)`" --default-character-set=utf8mb4 2>&1 < `"$file`""
    }
    $rc = $LASTEXITCODE
    foreach($l in @($out)){ if("$l".Trim() -ne ""){ Log "      $l" } }
    if($rc -ne 0){ Die "$label 적용 실패(mysql 종료코드 $rc). 위 mysql 오류 줄을 확인하세요." }
    Ok "$label 적용 완료"
  }
  # 백업. --result-file 을 쓰는 이유: PowerShell 의 '>' 는 5.1 에서 UTF-16/BOM 으로 써서 되먹일 수 없는 파일이 된다.
  function DumpDb([string]$db, [string]$path){
    Info "mysqldump $db → $path"
    & $mysqldump "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "--single-transaction" "--no-tablespaces" "--routines" "--triggers" "--result-file=$path" $db
    $rc = $LASTEXITCODE
    if($rc -ne 0){ Die "mysqldump($db) 가 코드 $rc 로 실패했습니다." }
    if(-not (Test-Path -LiteralPath $path)){ Die "mysqldump($db) 가 성공했다는데 파일이 없습니다: $path" }
    $size = (Get-Item -LiteralPath $path).Length
    if($size -le 1024){ Die "백업 파일이 1KB 이하입니다($size B): $path — 온전한 덤프가 아닙니다." }
    # 정상 종료한 mysqldump 는 마지막 줄에 '-- Dump completed on …' 을 쓴다. 없으면 도중에 끊긴 것이다.
    $tail = @(Get-Content -LiteralPath $path -Tail 5 -Encoding UTF8)
    $done = $false
    foreach($l in $tail){ if("$l".StartsWith("-- Dump completed")){ $done = $true } }
    if(-not $done){ Die "백업 파일 끝에 '-- Dump completed' 가 없습니다(중간에 끊겼을 수 있습니다): $path" }
    Ok ("백업 완료: {0} ({1:N1} KB)" -f $path, ($size / 1KB))
  }
  # MySQL 문자열 리터럴 안에 넣을 값. 기본 sql_mode 는 역슬래시를 이스케이프로 읽으므로 둘 다 막는다.
  function SqlStr([string]$s){ return (($s -replace '\\','\\') -replace "'","''") }
  # 권한 파일 두 개(create-app-user.sql · grants-calendar.sql)는 스키마를 `taskmgr.` 로 박아 두었다.
  # 낱말 경계 + 점까지 봐야 'taskmgr_app' 같은 계정 이름을 건드리지 않는다.
  function SubstSchema([string]$text, [string]$label){
    $out = [regex]::Replace($text, '\btaskmgr\.', ($TargetDb + '.'))
    if(-not $out.Contains($TargetDb + '.')){ Die "$label 에 바꿀 'taskmgr.' 가 하나도 없습니다 — 파일 형식이 바뀌었습니다." }
    return $out
  }

  # --- 접속 ---
  $ping = & $mysql "--defaults-extra-file=$($script:cnfPath)" "-N" "-B" "-e" "SELECT 1;"
  if("$ping".Trim() -ne "1"){ Die "$DbUser 로 접속하지 못했습니다. 호스트/포트/비밀번호를 확인하세요($DbHost`:$Port)." }
  $serverVer = Q "SELECT VERSION();" "서버 버전"
  Ok "접속 OK ($DbUser@$DbHost`:$Port, MySQL $serverVer)"

  # --- 원본 DB · 7표 · 정체성 컬럼 ---
  $hasSrc = Q "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$SourceDb';" "원본 DB 확인"
  if([int]$hasSrc -lt 1){ Die "원본 DB '$SourceDb' 가 없습니다." }
  $srcTables = @(QRows "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$SourceDb' AND TABLE_TYPE='BASE TABLE';" "원본 표 목록")
  $lack = @($COPY_ORDER | Where-Object { $srcTables -notcontains $_ })
  if($lack.Count -gt 0){ Die "원본 '$SourceDb' 에 다음 표가 없습니다: $($lack -join ', ')" }
  foreach($t in $KEY_COLS.Keys){
    $sc = @(QRows "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$SourceDb' AND TABLE_NAME='$t';" "원본 $t 컬럼")
    foreach($k in $KEY_COLS[$t]){
      if($sc -notcontains $k){ Die "원본 $SourceDb.$t 에 정체성 컬럼 '$k' 가 없습니다. 이대로 복사하면 새 번호가 매겨져 옛 번호와 어긋납니다 — 원본을 먼저 최신 스키마로 마이그레이션하세요." }
    }
  }
  $srcCounts = [ordered]@{}
  foreach($t in $COPY_ORDER){ $srcCounts[$t] = [long](Q ("SELECT COUNT(*) FROM " + (TQ $SourceDb $t) + ";") "원본 $t 행 수") }
  Ok ("원본 '$SourceDb' 7표 확인: " + (($COPY_ORDER | ForEach-Object { "$_=" + $srcCounts[$_] }) -join ' '))

  # --- 대상 DB 가 이미 있는가 ---
  $hasTgt = [int](Q "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$TargetDb';" "대상 DB 확인")
  $targetExists = ($hasTgt -gt 0)
  $tgtTableCount = 0
  if($targetExists){
    $tgtTableCount = [int](Q "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$TargetDb';" "대상 표 수")
    if(-not $Force){
      Die "대상 DB '$TargetDb' 가 이미 있습니다(표 $tgtTableCount 개). 지우고 다시 만들려면 -Force 를 붙여 실행하세요(지우기 전에 한 벌 백업합니다)."
    }
    Warn "대상 DB '$TargetDb' 가 이미 있습니다(표 $tgtTableCount 개) — -Force: 백업한 뒤 DROP 하고 다시 만듭니다."
  }

  # --- 앱 계정 ---
  $appExists = ([int](Q "SELECT COUNT(*) FROM mysql.user WHERE user='$AppUser' AND host='%';" "앱 계정 확인") -gt 0)
  if(-not $appExists -and -not $AppPassword){
    Die "앱 계정 '$AppUser'@'%' 이 없습니다. -AppPassword 로 새 계정의 비밀번호를 주세요(위젯 빌드의 DeployConfig.DbPassword 와 같아야 합니다)."
  }

  $doShift = -not $NoShift
  Log ""
  Log "  ---- 요약 ----"
  Log "  서버          : $DbHost`:$Port (MySQL $serverVer)"
  Log "  원본(읽기만)  : $SourceDb"
  if($targetExists){ Log "  대상(새로)    : $TargetDb  ★ 이미 있음 → 백업 후 DROP 하고 다시 만듦(-Force)" 'Yellow' }
  else             { Log "  대상(새로)    : $TargetDb" }
  Log "  schema_version: $expVersion (schema-calendar.sql)"
  Log "  백업 폴더     : $BackupDir"
  Log "  회사 데이터   : $CompanyDataDir"
  if($doShift){ Log "  시각 이동     : 켬 — $($SHIFT_TABLES -join ',') 의 $($SHIFT_COLS -join '/') 를 -9시간(KST→UTC)" }
  else        { Log "  시각 이동     : 끔 (-NoShift)" }
  if($appExists){ Log "  앱 계정       : '$AppUser'@'%' 있음 (권한만 추가)" }
  else          { Log "  앱 계정       : '$AppUser'@'%' 없음 → -AppPassword 로 새로 만듦" }
  Log ""

  if(-not $Yes){
    $a = Read-Host "계속하려면 Y"
    if("$a".Trim() -ne 'Y'){
      Finish $EXIT_CANCEL "취소했습니다. 아무것도 바꾸지 않았습니다(종료코드 $EXIT_CANCEL)." 'White'
    }
  }
  $script:preflight = $false

  # ==========================================================================
  #  [1/5] 원본 백업
  # ==========================================================================
  Step 1 "원본 백업"
  if(-not (Test-Path -LiteralPath $BackupDir)){
    try { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null } catch {}
  }
  if(-not (Test-Path -LiteralPath $BackupDir)){ Die "백업 폴더를 만들 수 없습니다: $BackupDir" }
  $script:reportDir = $BackupDir   # (위에서 이미 잡았지만, 여기서 만든 경우를 위해 한 번 더)
  $srcDump = Join-Path $BackupDir ("$SourceDb-" + $script:ts + ".sql")
  DumpDb $SourceDb $srcDump
  $tgtDump = $null
  if($targetExists){
    if($Force){
      $tgtDump = Join-Path $BackupDir ("$TargetDb-before-drop-" + $script:ts + ".sql")
      DumpDb $TargetDb $tgtDump
      Warn "DROP DATABASE $TargetDb (백업: $tgtDump)"
      Q ("DROP DATABASE " + (BQ $TargetDb) + ";") "대상 DB 삭제" | Out-Null
    }
  }

  # ==========================================================================
  #  [2/5] 구조
  # ==========================================================================
  Step 2 "구조 생성"
  Q ("CREATE DATABASE " + (BQ $TargetDb) + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;") "대상 DB 생성" | Out-Null
  Ok "DATABASE '$TargetDb' 생성 (utf8mb4 / utf8mb4_0900_ai_ci)"
  ApplySqlFile $structFile $TargetDb "schema-structure.sql (과제 트랙)"
  ApplySqlFile $usersFile $TargetDb "01-schema-users.sql (사용자·조직)"
  ApplySqlFile $calFile $TargetDb "schema-calendar.sql (캘린더 cal_*)"

  $tblCount = [int](Q "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$TargetDb';" "대상 표 수")
  if($tblCount -ne $EXPECTED_TABLE_COUNT){ Die "대상 '$TargetDb' 의 표가 $tblCount 개입니다(기대 $EXPECTED_TABLE_COUNT)." }
  $tgtTables = @(QRows "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$TargetDb';" "대상 표 목록")
  $miss = @($ddlTables | Where-Object { $tgtTables -notcontains $_ })
  if($miss.Count -gt 0){ Die "DDL 이 만드는 표 중 대상에 없는 것이 있습니다: $($miss -join ', ')" }
  $actVersion = Q ("SELECT v FROM " + (TQ $TargetDb 'cal_schema_meta') + " WHERE k='schema_version';") "schema_version"
  if($actVersion -ne $expVersion){ Die "cal_schema_meta.schema_version 이 [$actVersion] 입니다(schema-calendar.sql 기대 [$expVersion])." }
  Ok "표 $tblCount 개 · schema_version $actVersion"

  # ==========================================================================
  #  [3/5] 데이터 복사 (id/uid 보존)
  # ==========================================================================
  Step 3 "데이터 복사 ($SourceDb → $TargetDb)"
  $copy = New-Object System.Collections.Generic.List[string]
  $copy.Add('SET NAMES utf8mb4;')
  # FK 검사를 끄는 이유: org_unit 은 parent_id 로 자기 자신을 가리키는데 원본 행이 부모→자식 순으로
  # 놓여 있지 않다. 끈 대가로 아래 '고아 행 0' 검사가 정합성의 진짜 관문이 된다.
  $copy.Add('SET FOREIGN_KEY_CHECKS=0;')
  # schema-structure.sql 이 section_code/status_code 에 기본 코드 행을 시딩한다. 그대로 두면 원본 행과
  # PK 가 겹쳐 INSERT 가 ERROR 1062 로 죽고, 남겨 두면 원본에 없는 행이 섞인다. 원본이 정본이므로 비운다.
  foreach($t in $COPY_ORDER){ $copy.Add('DELETE FROM ' + (TQ $TargetDb $t) + ';') }
  $colReport = New-Object System.Collections.Generic.List[string]
  foreach($t in $COPY_ORDER){
    $colSql = "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='{0}' AND TABLE_NAME='$t' AND EXTRA NOT LIKE '%VIRTUAL GENERATED%' AND EXTRA NOT LIKE '%STORED GENERATED%' ORDER BY ORDINAL_POSITION;"
    $tgtCols = @(QRows ($colSql -f $TargetDb) "대상 $t 컬럼")
    $srcCols = @(QRows ($colSql -f $SourceDb) "원본 $t 컬럼")
    $cols    = @($tgtCols | Where-Object { $srcCols -contains $_ })      # 대상의 ORDINAL_POSITION 순서를 따른다
    $srcOnly = @($srcCols | Where-Object { $tgtCols -notcontains $_ })
    $tgtOnly = @($tgtCols | Where-Object { $srcCols -notcontains $_ })
    foreach($c in $cols){ if($c -notmatch '^[A-Za-z0-9_]+$'){ Die "$t 의 컬럼 이름이 식별자 형식이 아닙니다: [$c]" } }
    foreach($k in $KEY_COLS[$t]){ if($cols -notcontains $k){ Die "$t 의 정체성 컬럼 '$k' 가 복사 목록에 없습니다." } }
    $sel = @()
    $shifted = @()
    foreach($c in $cols){
      if($doShift -and ($SHIFT_TABLES -contains $t) -and ($SHIFT_COLS -contains $c)){
        $sel += ('DATE_SUB(' + (BQ $c) + ', INTERVAL 9 HOUR)')
        $shifted += $c
      } else {
        $sel += (BQ $c)
      }
    }
    $copy.Add('INSERT INTO ' + (TQ $TargetDb $t) + ' (' + (($cols | ForEach-Object { BQ $_ }) -join ',') + ') SELECT ' + ($sel -join ',') + ' FROM ' + (TQ $SourceDb $t) + ';')
    $line = "  {0,-13} 컬럼 {1,2}개" -f $t, $cols.Count
    if($shifted.Count -gt 0){ $line += " · -9h: " + ($shifted -join ',') }
    if($tgtOnly.Count -gt 0){ $line += " · 원본에 없음(대상 기본값): " + ($tgtOnly -join ',') }
    if($srcOnly.Count -gt 0){ $line += " · ★ 원본에만 있어 복사 안 함: " + ($srcOnly -join ',') }
    $colReport.Add($line)
  }
  $copy.Add('SET FOREIGN_KEY_CHECKS=1;')
  foreach($l in $colReport){ Log $l }

  $copyFile = NewTemp "setup_copy_" ".sql"
  [IO.File]::WriteAllText($copyFile, (($copy.ToArray()) -join "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
  ApplySqlFile $copyFile "" "7표 복사(한 세션)"

  # cal_user_rev — schema-calendar.sql 이 'app_user 전원에게 rev 0 행' 을 시딩하지만, 그 시점의 app_user 는
  # 비어 있었다. 사람이 방금 들어왔으므로 같은 시딩을 다시 한다(그 파일 끝 '릴리스 게이트' 가 누락 0 을 요구한다).
  Q ("INSERT IGNORE INTO " + (TQ $TargetDb 'cal_user_rev') + " (user_id, rev) SELECT user_id, 0 FROM " + (TQ $TargetDb 'app_user') + ";") "cal_user_rev 시딩" | Out-Null
  $revMissing = [long](Q ("SELECT COUNT(*) FROM " + (TQ $TargetDb 'app_user') + " u LEFT JOIN " + (TQ $TargetDb 'cal_user_rev') + " r ON r.user_id = u.user_id WHERE r.user_id IS NULL;") "cal_user_rev 누락")
  if($revMissing -ne 0){ Die "cal_user_rev 에 행이 없는 사용자가 $revMissing 명입니다." }
  Ok "cal_user_rev 시딩 (누락 0)"

  # 고아 행 — FK 검사를 껐으므로 여기가 진짜 검사다.
  $orphanTotal = 0
  foreach($oc in $ORPHAN_CHECKS){
    $sql = "SELECT COUNT(*) FROM " + (TQ $TargetDb $oc.child) + " c LEFT JOIN " + (TQ $TargetDb $oc.parent) + " p ON p." + (BQ $oc.pcol) + " = c." + (BQ $oc.col) +
           " WHERE c." + (BQ $oc.col) + " IS NOT NULL AND p." + (BQ $oc.pcol) + " IS NULL;"
    $n = [long](Q $sql "고아 행 $($oc.name)")
    $orphanTotal += $n
    if($n -ne 0){ Log ("  고아 행 {0,-24} {1}" -f $oc.name, $n) 'Red' } else { Log ("  고아 행 {0,-24} 0" -f $oc.name) }
  }
  if($orphanTotal -ne 0){ Die "고아 행이 $orphanTotal 개 있습니다(위 목록). 원본 '$SourceDb' 의 참조가 깨져 있습니다 — 원본을 고친 뒤 -Force 로 다시 실행하세요." }
  Ok "고아 행 0 ($($ORPHAN_CHECKS.Count)개 관계)"

  # 행 수 대조
  $tgtCounts = [ordered]@{}
  $countBad = @()
  Log ("  {0,-13} {1,8} {2,8}" -f "표", "원본", "대상")
  foreach($t in $COPY_ORDER){
    $tgtCounts[$t] = [long](Q ("SELECT COUNT(*) FROM " + (TQ $TargetDb $t) + ";") "대상 $t 행 수")
    $mark = "OK"
    if($tgtCounts[$t] -ne $srcCounts[$t]){ $mark = "불일치"; $countBad += $t }
    Log ("  {0,-13} {1,8} {2,8}  {3}" -f $t, $srcCounts[$t], $tgtCounts[$t], $mark)
  }
  if($countBad.Count -gt 0){ Die "행 수가 원본과 다릅니다: $($countBad -join ', ')" }
  Ok "행 수 7표 일치"

  # AUTO_INCREMENT > MAX(id). 명시 id 로 넣으면 MySQL 이 카운터를 올린다 — 그것을 확인만 한다.
  # stats_expiry=0: information_schema 의 AUTO_INCREMENT 는 기본 24시간 캐시라 갓 만든 표는 낡은 값을 보인다.
  foreach($t in $AUTOINC_KEYS.Keys){
    $k = $AUTOINC_KEYS[$t]
    $ai = [long](Q ("SET SESSION information_schema_stats_expiry=0; SELECT IFNULL(AUTO_INCREMENT,0) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$TargetDb' AND TABLE_NAME='$t';") "$t AUTO_INCREMENT")
    $mx = [long](Q ("SELECT IFNULL(MAX(" + (BQ $k) + "),0) FROM " + (TQ $TargetDb $t) + ";") "$t MAX($k)")
    if($ai -le $mx){ Die "$t 의 AUTO_INCREMENT($ai) 가 MAX($k)=$mx 이하입니다 — 다음 신규 행이 기존 번호와 부딪힙니다." }
    Log ("  {0,-13} MAX({1})={2} · AUTO_INCREMENT={3}" -f $t, $k, $mx, $ai)
  }
  Ok "AUTO_INCREMENT 3표 확인"

  # ==========================================================================
  #  [4/5] 권한
  # ==========================================================================
  Step 4 "앱 계정 권한"
  # (a) create-app-user.sql — 계정이 이미 있으면 CREATE USER IF NOT EXISTS 는 아무것도 하지 않는다.
  #     그래서 -AppPassword 가 없을 때 남는 'CHANGE_ME_ON_DEPLOY' 자리표는 무해하다(쓰이지 않는다).
  #     계정이 있는데 -AppPassword 를 준 경우에도 비밀번호는 바뀌지 않는다(같은 이유).
  $appUserSql = SubstSchema $appUserText "create-app-user.sql"
  if($AppPassword){
    if(-not $appUserSql.Contains('CHANGE_ME_ON_DEPLOY')){ Die "create-app-user.sql 에 비밀번호 자리표 CHANGE_ME_ON_DEPLOY 가 없습니다 — -AppPassword 를 넣을 자리가 없습니다." }
    $appUserSql = $appUserSql.Replace('CHANGE_ME_ON_DEPLOY', (SqlStr $AppPassword))   # 문자 그대로 치환($ 등 해석 없음)
    if($appExists){ Warn "계정 '$AppUser'@'%' 이 이미 있어 -AppPassword 는 쓰이지 않습니다(비밀번호는 바뀌지 않습니다)." }
  }
  $appUserTmp = NewTemp "setup_appuser_" ".sql"
  [IO.File]::WriteAllText($appUserTmp, $appUserSql, (New-Object System.Text.UTF8Encoding($false)))
  # (b) grants-calendar.sql — 같은 스키마 치환.
  $calGrantsSql = SubstSchema $calGrantsText "grants-calendar.sql"
  $calGrantsTmp = NewTemp "setup_calgrants_" ".sql"
  [IO.File]::WriteAllText($calGrantsTmp, $calGrantsSql, (New-Object System.Text.UTF8Encoding($false)))
  # (c) 05-grants.sql — 치환하지 않는다. 스키마를 DATABASE() 로 잡으므로 대상 DB 를 선택한 채 원본 파일을 돌린다.
  ApplySqlFile $appUserTmp "" "create-app-user.sql (스키마 → $TargetDb)"
  ApplySqlFile $calGrantsTmp "" "grants-calendar.sql (스키마 → $TargetDb)"
  ApplySqlFile $companyGrantsFile $TargetDb "05-grants.sql (DATABASE() = $TargetDb)"

  # 기대 표: 세 파일이 권한을 주는 표 전부. SHOW GRANTS 에 `대상`.`표` 로 하나씩 있어야 한다.
  $expGrantTables = @()
  foreach($txt in @($appUserSql, $calGrantsSql)){
    foreach($m in [regex]::Matches($txt, '(?im)^\s*GRANT\s+[^;]*?\bON\s+' + $TargetDb + '\.([A-Za-z0-9_]+)')){
      if($expGrantTables -notcontains $m.Groups[1].Value){ $expGrantTables += $m.Groups[1].Value }
    }
  }
  foreach($m in [regex]::Matches($companyGrantsText, '`\.([A-Za-z0-9_]+)\s+TO\s+''''')){
    if($expGrantTables -notcontains $m.Groups[1].Value){ $expGrantTables += $m.Groups[1].Value }
  }
  if($expGrantTables.Count -lt 1){ Die "권한 파일 세 개에서 GRANT 대상 표를 하나도 읽지 못했습니다 — 파일 형식이 바뀌었습니다." }
  $grantLines = @(QRows ("SHOW GRANTS FOR '" + $AppUser + "'@'%';") "SHOW GRANTS")
  $tgtGrantLines = @($grantLines | Where-Object { $_.Contains((BQ $TargetDb) + '.') })
  foreach($g in $tgtGrantLines){ Log "  $g" }
  if($tgtGrantLines.Count -lt 1){ Die "SHOW GRANTS FOR '$AppUser'@'%' 에 '$TargetDb' 권한이 한 줄도 없습니다." }
  $grantMiss = @()
  foreach($gt in $expGrantTables){
    $needle = (TQ $TargetDb $gt) + ' '
    $hit = @($tgtGrantLines | Where-Object { $_.Contains($needle) })
    if($hit.Count -lt 1){ $grantMiss += $gt }
  }
  if($grantMiss.Count -gt 0){ Die "권한이 붙지 않은 표가 있습니다: $($grantMiss -join ', ')" }
  Ok "권한 확인: '$TargetDb' 표 $($expGrantTables.Count)개 (SHOW GRANTS $($tgtGrantLines.Count)줄)"

  # ==========================================================================
  #  [5/5] 보고서
  # ==========================================================================
  Step 5 "보고서"
  Log "  대상 DB        : $TargetDb"
  Log "  schema_version : $actVersion"
  Log "  표 수          : $tblCount"
  foreach($t in $COPY_ORDER){ Log ("  행 수 {0,-13}: {1}" -f $t, $tgtCounts[$t]) }
  Log "  고아 행        : 0 ($($ORPHAN_CHECKS.Count)개 관계)"
  if($doShift){ Log "  시각 이동      : $($SHIFT_TABLES -join ',') 의 $($SHIFT_COLS -join '/') -9시간" }
  else        { Log "  시각 이동      : 안 함(-NoShift)" }
  Log "  권한           : OK ('$AppUser'@'%' · 표 $($expGrantTables.Count)개)"
  Log "  원본 백업      : $srcDump"
  if($tgtDump){ Log "  삭제 전 대상   : $tgtDump" }
  Log ""
  Log "  다음 단계: widget/DeployConfig.cs → DbName = `"$TargetDb`" 로 바꾼 뒤 다시 빌드하세요." 'Cyan'
  Log "            (원본 '$SourceDb' 는 그대로라 0.16 클라이언트는 계속 그쪽을 씁니다.)" 'Cyan'
  Finish $EXIT_OK "완료: '$TargetDb' 구축·검증 통과(종료코드 $EXIT_OK)." 'Green'
} finally {
  # exit(Finish/Die) 로 끝나도 finally 는 돈다. Cleanup 은 두 번 불려도 안전하다.
  Cleanup
}
