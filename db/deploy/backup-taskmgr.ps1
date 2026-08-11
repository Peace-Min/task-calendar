<#
  backup-taskmgr.ps1 — taskmgr DB 주간 백업(mysqldump) + '온전한 백업인지' 대조.

  보통은 backup-taskmgr.cmd 더블클릭(1회 수동 백업), 정기 실행은 -Install 로 등록.

  하는 일(순서):
    1) mysqldump.exe / mysql.exe 찾기 (init-calendar.ps1 과 같은 방식: -BaseDir → 서비스 binPath 추론)
    2) 자격 증명을 보호된 .cnf 에서 읽는다(명령줄로 비번을 받지 않는다 — 아래 ⚠️)
    3) 권한 선검사 — SHOW GRANTS 에 SELECT 와 TRIGGER 가 있는가 (★ 아래 '이 스크립트의 존재 이유')
    4) mysqldump --single-transaction --no-tablespaces --routines --triggers
    5) ★ 검증 — 뜬 파일의 표 이름·트리거 이름·루틴 수·마감 표시·크기를 DB 의
       information_schema 실제 값과 대조. 하나라도 어긋나면 .partial 로 남기고 실패
    6) 세대 관리(-Keep) · 로그 한 줄 누적 · 같은 볼륨이면 경고

  ┌ 종료코드 (backup-taskmgr.cmd 의 표와 반드시 일치) ────────────────────────────┐
  │ 0  성공 — 백업 파일이 생겼고 검증을 전부 통과했다. (-Install/-Uninstall/-Status 성공도 0) │
  │ 1  실패 — 덤프 실행 실패 또는 검증 불일치. 뜬 파일은 .partial 로 남는다.      │
  │ 2  설정 문제 — .cnf 가 없거나 못 읽는다 / 백업 폴더를 만들 수 없다.            │
  │ 3  접속·권한 문제 — DB 에 못 붙거나 백업 계정에 SELECT·TRIGGER 가 없다.        │
  │ 4  도구 없음 — mysqldump.exe 또는 mysql.exe 를 못 찾았다.                      │
  │ 5  관리자 권한 필요 — -Install / -Uninstall 은 관리자 콘솔에서만 된다.         │
  └────────────────────────────────────────────────────────────────────────────────┘
  무인 호출자는 0 만 성공으로 셀 것. 1 과 2·3·4 를 나눈 이유는 사람이 할 일이 달라서다:
  1 은 '백업이 반쪽이다(복구에 못 쓴다)', 2·3·4 는 '백업을 시작조차 못했다' 이다.

  ★ 이 스크립트의 존재 이유 — 종료코드만 믿으면 안 되는 실측 사례:
     백업 계정에 SELECT 만 주고 mysqldump 를 돌리면 **에러도 경고도 없이 exit 0** 으로
     끝나는데 트리거가 통째로 빠진다.
       · root        : 6404 바이트 · 표 3 · 트리거 3 · exit 0
       · SELECT 만   : 3377 바이트 · 표 3 · 트리거 0 · exit 0   ← 실측(격리 DB)
       (실제 taskmgr 규모에서는 72K 對 48K · 표 20 · 트리거 15 → 0)
     그래서 이 스크립트는 반드시 '덤프 내용 ↔ DB' 를 대조한다.

     ★★ 그런데 대조만으로도 부족하다. information_schema.TRIGGERS 는 TRIGGER 권한으로
     걸러진다 — SELECT 만 가진 계정 눈에는 DB 쪽 트리거 수도 0 으로 보이므로
     '덤프 0 == DB 0' 으로 대조까지 통과해 버린다(실측: 같은 DB를 SELECT 만 가진 계정이
     세면 0, TRIGGER 까지 가진 계정이 세면 3). 그래서 덤프 전에 SHOW GRANTS 로
     TRIGGER 보유를 먼저 확인한다(3단계). 두 겹 중 이 겹이 실제로 걸러 내는 겹이다.

  ⚠️ 비밀번호를 명령줄 인자로 받지 않는 이유:
     Windows 는 같은 사용자 권한이면 다른 프로세스의 명령줄을 그대로 읽을 수 있다
     (Get-CimInstance Win32_Process | Select CommandLine — 실측으로 값이 보였다).
     주간 백업은 무인이라 자격이 어딘가에 남아 있어야 하므로, 남기는 자리를
     '아무나 읽을 수 있는 명령줄' 이 아니라 '권한을 좁힌 파일' 로 고정한다.
     .cnf 가 없으면 만드는 법과 icacls 예시를 찍고 종료한다(코드 2).

  ⚠️ --no-tablespaces 를 쓰는 이유: 이것을 빼면 mysqldump 가
     INFORMATION_SCHEMA.FILES 를 읽으려 하고, 그건 **전역 PROCESS 권한**을 요구한다.
     PROCESS 는 DB 경계를 넘어 서버 전체의 세션·쿼리를 보게 해 주는 권한이라
     '읽기 전용 백업 계정' 의 취지를 무너뜨린다. 우리 스키마는 InnoDB 기본
     테이블스페이스만 쓰므로 이 정보가 없어도 복구에 지장이 없다.
     --single-transaction 은 InnoDB 일관 스냅샷이라 LOCK TABLES 권한도 필요 없다.

  ⚠️ 이 스크립트는 taskmgr 에 SELECT 만 한다. 쓰기는 백업 폴더(파일 생성/삭제)뿐이다.

  예)  backup-taskmgr.cmd
       backup-taskmgr.cmd -BackupDir "E:\backup" -Keep 12
       backup-taskmgr.cmd -Status
       (관리자) backup-taskmgr.cmd -Install      / -Uninstall
#>
[CmdletBinding()]
param(
  [string]$BackupDir = "D:\taskmgr-backup",   # ★ C: 와 별개 물리 볼륨을 권장(6번 경고 참조)
  [string]$DbName    = "taskmgr",
  [int]$Keep         = 8,                     # 남길 세대 수(주 1회 → 약 2개월)
  [string]$CnfPath   = "",                    # 비우면 %ProgramData%\taskmgr\backup-taskmgr.cnf
  [switch]$Install,                           # 작업 스케줄러에 주 1회 등록(관리자)
  [switch]$Uninstall,                         # 등록 해제(관리자)
  [switch]$Status,                            # 등록 상태만 조회하고 종료
  [string]$BaseDir     = "C:\mysql",          # mysqldump.exe 위치(없으면 서비스 binPath 추론)
  [string]$DbHost      = "127.0.0.1",
  [int]$Port           = 3306,
  [string]$ServiceName = "MySQL84",
  [string]$TaskName    = "TaskmgrWeeklyBackup"
)

$ErrorActionPreference = "Continue"

# --- 화면 출력 -------------------------------------------------------------
function Info($m){ Write-Host "[*] $m" }
function Ok($m){   Write-Host "[OK] $m"   -ForegroundColor Green }
function Warn($m){ Write-Host "[경고] $m" -ForegroundColor Yellow }
function Bad($m){  Write-Host "[실패] $m" -ForegroundColor Red }

$script:logPath = $null

# 로그 한 줄 누적. 스케줄러로 돌면 화면을 아무도 안 보므로 이게 유일한 흔적이다.
# 인코딩: PS 5.1 의 Add-Content -Encoding UTF8 은 BOM 을 박는다. 여기서는 .NET 으로
# BOM 없는 UTF-8 을 직접 이어 붙인다(메모장·다른 도구에서 한글이 깨지지 않게).
function AddLog($line){
  if(-not $script:logPath){ return }
  try{
    $stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $enc = New-Object System.Text.UTF8Encoding($false)
    if(-not (Test-Path $script:logPath)){
      [IO.File]::WriteAllText($script:logPath, "# taskmgr 백업 로그 (시각 / 결과 / 파일 / 크기 / 표 / 트리거 / 루틴 / 소요 / 비고)`r`n", $enc)
    }
    [IO.File]::AppendAllText($script:logPath, "$stamp`t$line`r`n", $enc)
  } catch { Warn "로그를 못 남겼습니다: $($_.Exception.Message)" }
}

# 종료 — 화면·로그에 같은 이유를 남기고 지정 코드로 죽는다.
function Die($msg, $code){
  Bad $msg
  AddLog "FAIL`t-`t-`t-`t-`t-`t-`t$msg"
  exit $code
}

# 인자 뒤엉킴 방어 — powershell.exe 의 명령줄 파서는 -BackupDir "D:\dir\" 처럼 값이
# 역슬래시로 끝나면 \" 를 '이스케이프된 따옴표' 로 읽어 뒤 인자를 통째로 삼킨다
# (init-calendar.ps1 이 같은 이유로 같은 방어를 둔다). 대상 폴더가 조용히 달라지면
# 백업이 엉뚱한 곳에 쌓이므로 여기서 멈춘다.
function AssertNoSwallow($label, $val){
  if("$val" -match '"'){ Die "$label 값에 따옴표가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태입니다 — 경로 끝의 역슬래시를 빼고 다시 실행하세요." 2 }
  if("$val" -match '\s-(BackupDir|DbName|Keep|CnfPath|BaseDir|DbHost|Port|ServiceName|TaskName)\b'){ Die "$label 값 안에 다른 인자가 들어 있습니다: [$val]. 경로 끝의 역슬래시를 빼고 다시 실행하세요." 2 }
}
AssertNoSwallow "-BackupDir" $BackupDir
AssertNoSwallow "-CnfPath"   $CnfPath
AssertNoSwallow "-BaseDir"   $BaseDir

function TrimSlash($p){
  $t = "$p"
  if($t.Length -gt 3 -and $t.EndsWith("\")){ return $t.TrimEnd("\") }
  return $t
}
$BackupDir = TrimSlash $BackupDir
$BaseDir   = TrimSlash $BaseDir

if($Keep -lt 1){ Die "-Keep 은 1 이상이어야 합니다(지금: $Keep). 0 이면 방금 뜬 백업까지 지운다." 2 }
if($Install -and $Uninstall){ Die "-Install 과 -Uninstall 을 같이 줄 수 없습니다." 2 }
if(-not $CnfPath){ $CnfPath = Join-Path $env:ProgramData "taskmgr\backup-taskmgr.cnf" }

function IsAdmin(){
  try{
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}

Write-Host "============================================"
Write-Host "   taskmgr 주간 백업"
Write-Host "   대상: $DbHost`:$Port  DB=$DbName"
Write-Host "   보관: $BackupDir  (세대 $Keep)"
Write-Host "============================================"

# ============================================================================
#  작업 스케줄러 등록 / 해제 / 조회
# ============================================================================
function ShowRegistration(){
  if(-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)){
    Warn "이 PC 의 PowerShell 에 ScheduledTasks 모듈이 없습니다. schtasks /Query /TN `"$TaskName`" 로 확인하세요."
    return $false
  }
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if(-not $t){ Info "작업 스케줄러 등록: 없음 (이름 '$TaskName')"; return $false }
  Info "작업 스케줄러 등록: 있음 (이름 '$TaskName', 상태 $($t.State))"
  foreach($tr in $t.Triggers){ Info "  트리거: $($tr.CimClass.CimClassName) StartBoundary=$($tr.StartBoundary)" }
  Info "  실행 계정: $($t.Principal.UserId) / $($t.Principal.LogonType)"
  $inf = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  if($inf){ Info "  마지막 실행: $($inf.LastRunTime)  결과코드: $($inf.LastTaskResult)  다음 실행: $($inf.NextRunTime)" }
  return $true
}

if($Status){ [void](ShowRegistration); exit 0 }

if($Install -or $Uninstall){
  # ★ 관리자 권한 확인 — 여기서 안 막으면 Register-ScheduledTask 가 '액세스 거부' 라는
  #   맥락 없는 오류만 뱉고 죽는다. 무엇을 해야 하는지 말해 주고 죽는다.
  if(-not (IsAdmin)){
    Bad "관리자 권한이 없습니다. SYSTEM 계정으로 도는 작업을 등록/해제하려면 관리자 권한이 필요합니다."
    Write-Host "  → 시작 메뉴에서 'PowerShell' 또는 '명령 프롬프트' 를 마우스 오른쪽 → '관리자 권한으로 실행' 한 뒤"
    Write-Host "     다시 실행하세요:  backup-taskmgr.cmd $(if($Install){'-Install'}else{'-Uninstall'})"
    exit 5
  }
  if(-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)){
    Die "이 PowerShell 에 ScheduledTasks 모듈이 없습니다. schtasks.exe 로 수동 등록하세요." 2
  }

  if($Uninstall){
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if(-not $t){ Info "등록된 작업이 없습니다('$TaskName'). 할 일이 없습니다."; exit 0 }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    if($?){ Ok "작업 스케줄러에서 '$TaskName' 등록을 해제했습니다. (백업 파일은 그대로 둡니다)"; exit 0 }
    Die "등록 해제에 실패했습니다." 1
  }

  # -Install : 지금 이 실행에 준 설정 그대로 등록한다(나중에 화면과 스케줄러가 어긋나지 않게).
  if(-not (Test-Path $CnfPath)){
    Warn "자격 파일이 아직 없습니다: $CnfPath"
    Warn "이대로 등록하면 일요일마다 코드 2 로 실패만 쌓입니다. 등록 후 반드시 .cnf 를 만들 것."
  }
  $argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -BackupDir `"$BackupDir`" -DbName $DbName -Keep $Keep -CnfPath `"$CnfPath`" -DbHost $DbHost -Port $Port -BaseDir `"$BaseDir`" -ServiceName $ServiceName"
  $act  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argLine
  # 시각은 [datetime] 으로 만든다 — "03:00" 문자열은 로캘에 따라 다르게 읽힌다.
  $trg  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At ([datetime]::Today.AddHours(3))
  # SYSTEM + ServiceAccount = 로그온하지 않아도, 로그오프해도 돈다.
  $prc  = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  # StartWhenAvailable = 일요일 03:00 에 PC 가 꺼져 있었으면 켜진 뒤 따라잡는다.
  $set  = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::FromHours(2))
  Register-ScheduledTask -TaskName $TaskName -Action $act -Trigger $trg -Principal $prc -Settings $set -Description "taskmgr DB 주간 백업 (backup-taskmgr.ps1)" -Force | Out-Null
  if(-not $?){ Die "작업 등록에 실패했습니다." 1 }
  Ok "등록 완료 — 매주 일요일 03:00, SYSTEM 계정, 로그오프 상태에서도 실행."
  Write-Host ""
  [void](ShowRegistration)
  Write-Host ""
  Info "SYSTEM 계정이 읽어야 하므로 .cnf 와 백업 폴더에 SYSTEM 읽기/쓰기 권한이 있어야 합니다."
  exit 0
}

# ============================================================================
#  1) 도구 찾기 — init-calendar.ps1 과 같은 방식
# ============================================================================
$mysqldump = Join-Path $BaseDir "bin\mysqldump.exe"
$mysql     = Join-Path $BaseDir "bin\mysql.exe"
if(-not (Test-Path $mysqldump)){
  try {
    $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    if($svc -and $svc.PathName -match '"?([A-Za-z]:[^"]*)\\bin\\mysqld\.exe'){
      $root = $Matches[1]
      $c1 = Join-Path $root "bin\mysqldump.exe"; if(Test-Path $c1){ $mysqldump = $c1 }
      $c2 = Join-Path $root "bin\mysql.exe";     if(Test-Path $c2){ $mysql = $c2 }
    }
  } catch {}
}
if(-not (Test-Path $mysqldump)){ Die "mysqldump.exe 를 못 찾았습니다. -BaseDir 로 설치 경로를 지정하세요(예: -BaseDir `"C:\Program Files\MySQL\MySQL Server 8.4`")." 4 }
if(-not (Test-Path $mysql)){     Die "mysql.exe 를 못 찾았습니다(검증에 필요합니다). -BaseDir 로 설치 경로를 지정하세요." 4 }

# ============================================================================
#  백업 폴더 + 로그 자리
# ============================================================================
if(-not (Test-Path $BackupDir)){
  try { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null } catch {}
  if(-not (Test-Path $BackupDir)){ Die "백업 폴더를 만들 수 없습니다: $BackupDir (드라이브가 없거나 권한이 없습니다)" 2 }
  Info "백업 폴더를 새로 만들었습니다: $BackupDir"
}
$script:logPath = Join-Path $BackupDir "backup-log.txt"

# ============================================================================
#  2) 자격 증명 — 보호된 .cnf 에서만 읽는다
# ============================================================================
if(-not (Test-Path $CnfPath)){
  Bad "자격 파일이 없습니다: $CnfPath"
  Write-Host ""
  Write-Host "  비밀번호를 명령줄로 받지 않습니다. 같은 PC 의 다른 프로세스가 명령줄을 그대로"
  Write-Host "  읽을 수 있기 때문입니다(Get-CimInstance Win32_Process | Select CommandLine — 실측)."
  Write-Host "  아래처럼 파일로 만들고 권한을 좁히세요(관리자 콘솔에서):"
  Write-Host ""
  Write-Host "    md `"$(Split-Path $CnfPath -Parent)`"" -ForegroundColor Cyan
  Write-Host "    notepad `"$CnfPath`"" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  내용(3줄, ANSI/UTF-8 아무거나 — 비ASCII 를 넣지 말 것):" -ForegroundColor Cyan
  Write-Host "    [client]"                       -ForegroundColor Cyan
  Write-Host "    user=taskmgr_backup"            -ForegroundColor Cyan
  Write-Host "    password=`"여기에_실제_비밀번호`"" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  그 다음 파일 권한을 SYSTEM·Administrators 로만 좁힙니다"
  Write-Host "  (SID 로 적는 이유: 한국어 Windows 에서는 계정 그룹 이름이 번역돼 있어 이름으로 주면 실패합니다):"
  Write-Host "    icacls `"$CnfPath`" /inheritance:r /grant *S-1-5-18:R /grant *S-1-5-32-544:F" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  계정 자체는 create-backup-user.sql 로 만듭니다(SELECT, TRIGGER 만)."
  AddLog "FAIL`t-`t-`t-`t-`t-`t-`t자격 파일 없음: $CnfPath"
  exit 2
}
try { $null = Get-Content $CnfPath -TotalCount 1 -ErrorAction Stop }
catch { Die "자격 파일을 읽을 수 없습니다: $CnfPath ($($_.Exception.Message))" 2 }

# .cnf 권한 점검 — '좁히라' 고 안내만 하고 확인을 안 하면 안내는 지켜지지 않는다.
try{
  $acl = Get-Acl $CnfPath
  $loose = @()
  foreach($ace in $acl.Access){
    $sid = $null
    try { $sid = $ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $sid = "$($ace.IdentityReference)" }
    # S-1-1-0 Everyone / S-1-5-32-545 Users / S-1-5-11 Authenticated Users / S-1-5-4 INTERACTIVE
    if(@("S-1-1-0","S-1-5-32-545","S-1-5-11","S-1-5-4") -contains $sid){ $loose += "$($ace.IdentityReference)" }
  }
  if($loose.Count -gt 0){
    Warn "자격 파일이 일반 사용자에게도 열려 있습니다($($loose -join ', ')). 비밀번호가 평문으로 들어 있는 파일입니다."
    Warn "  icacls `"$CnfPath`" /inheritance:r /grant *S-1-5-18:R /grant *S-1-5-32-544:F"
  }
} catch { }

function MyArgs(){ return @("--defaults-extra-file=$CnfPath","--default-character-set=utf8mb4","-h","$DbHost","-P","$Port") }

# 한 줄 결과 질의. 실패는 빈 문자열이 아니라 $null 로 구분한다.
function Q1($sql){
  $out = & $mysql (MyArgs) "-N" "-B" "-e" $sql $DbName
  if($LASTEXITCODE -ne 0){ return $null }
  return ("" + $out).Trim()
}
function QLines($sql){
  $out = @(& $mysql (MyArgs) "-N" "-B" "-e" $sql $DbName)
  if($LASTEXITCODE -ne 0){ return $null }
  return @($out | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne "" })
}

# ============================================================================
#  3) 접속 · 권한 선검사
# ============================================================================
if((Q1 "SELECT 1;") -ne "1"){
  Die "DB 에 접속하지 못했습니다($DbHost`:$Port, DB=$DbName). .cnf 의 계정/비밀번호와 서버 상태를 확인하세요." 3
}
$whoami = Q1 "SELECT CURRENT_USER();"
Info "접속 계정: $whoami"

# ★ 왜 SHOW GRANTS 를 먼저 보는가 (머리말 ★★ 참조):
#   information_schema.TRIGGERS 는 TRIGGER 권한으로 걸러진다. SELECT 만 가진 계정은
#   DB 쪽 트리거도 0 으로 보므로 아래 5)번 대조가 '0 == 0' 으로 통과해 버린다.
#   즉 내용 대조만으로는 이 사고를 잡을 수 없다. 여기서 잡는다.
$grantLines = QLines "SHOW GRANTS FOR CURRENT_USER();"
if($null -eq $grantLines){ Die "SHOW GRANTS 를 실행하지 못했습니다. 접속 계정을 확인하세요." 3 }
$havePrivs = @{}
$roleGrantSeen = $false
foreach($g in $grantLines){
  if($g -match '^GRANT\s+`'){ $roleGrantSeen = $true; continue }   # 역할(ROLE) 부여 줄
  $m = [regex]::Match($g,'(?i)^GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO\s')
  if(-not $m.Success){ continue }
  # 컬럼 단위 부여 'SELECT (a, b)' 의 괄호를 먼저 지운다 — 안 지우면 콤마 분해가 엉킨다.
  $privTxt = [regex]::Replace($m.Groups[1].Value,'\([^)]*\)','')
  $scope   = ($m.Groups[2].Value -replace '`','')
  if($scope -ne "*.*" -and $scope -ne "$DbName.*"){ continue }      # 표 단위 부여는 아래에서 따로 본다
  foreach($p in ($privTxt -split ',')){
    $pv = "$p".Trim().ToUpper()
    if($pv -ne ""){ $havePrivs[$pv] = $true }
  }
}
$hasAll     = ($havePrivs.ContainsKey("ALL PRIVILEGES") -or $havePrivs.ContainsKey("ALL"))
$hasSelect  = ($hasAll -or $havePrivs.ContainsKey("SELECT"))
$hasTrigger = ($hasAll -or $havePrivs.ContainsKey("TRIGGER"))

if(-not $hasSelect){
  Die "백업 계정에 $DbName 에 대한 SELECT 권한이 없습니다(SHOW GRANTS 기준). create-backup-user.sql 을 root 로 실행하세요." 3
}
if(-not $hasTrigger){
  Bad "백업 계정에 TRIGGER 권한이 없습니다 — 이대로 뜨면 트리거가 통째로 빠진 백업이 만들어집니다."
  Write-Host "  mysqldump 는 이 경우 에러도 경고도 없이 exit 0 으로 끝납니다(실측: root 6404B/트리거3 vs SELECT만 3377B/트리거0)."
  Write-Host "  게다가 information_schema.TRIGGERS 도 권한으로 걸러져 DB 쪽도 0 으로 보이므로,"
  Write-Host "  덤프 내용 대조마저 '0 == 0' 으로 통과합니다. 그래서 여기서 막습니다."
  if($roleGrantSeen){ Write-Host "  (이 계정에는 역할(ROLE) 부여 줄이 있습니다. 역할로 준 권한은 여기서 해석하지 않습니다 — 백업 계정에는 직접 GRANT 하세요.)" }
  Write-Host "  조치:  GRANT SELECT, TRIGGER ON $DbName.* TO '<백업계정>'@'localhost';   (create-backup-user.sql)"
  AddLog "FAIL`t-`t-`t-`t-`t-`t-`tTRIGGER 권한 없음(계정 $whoami) — 트리거 빠진 반쪽 백업 방지를 위해 중단"
  exit 3
}
Ok "권한 선검사 통과 — SELECT · TRIGGER 보유."

# ============================================================================
#  DB 실제 값(기대값) 수집
# ============================================================================
$expTables = QLines "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DbName' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME;"
$expTrigs  = QLines "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='$DbName' ORDER BY TRIGGER_NAME;"
$expRtnN   = [int](Q1 "SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='$DbName';")
$expViewN  = [int](Q1 "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DbName' AND TABLE_TYPE='VIEW';")
$expEvtN   = [int](Q1 "SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA='$DbName';")
if($null -eq $expTables){ Die "표 목록을 읽지 못했습니다." 3 }
if($null -eq $expTrigs){ $expTrigs = @() }
if($expTables.Count -lt 1){ Die "DB '$DbName' 에 표가 하나도 없습니다. DB 이름이 맞습니까?" 3 }
Info "DB 현황 — 표 $($expTables.Count) · 트리거 $($expTrigs.Count) · 루틴 $expRtnN · 뷰 $expViewN · 이벤트 $expEvtN"

# 뷰가 있는데 SHOW VIEW 가 없으면 mysqldump 는 (트리거 때와 달리) 시끄럽게 죽는다 —
# 실측 exit 2. 미리 말해 주는 편이 낫다.
if($expViewN -gt 0 -and -not ($hasAll -or $havePrivs.ContainsKey("SHOW VIEW"))){
  Warn "뷰가 $expViewN 개 있는데 백업 계정에 SHOW VIEW 권한이 없습니다. 덤프가 실패할 것입니다(GRANT SHOW VIEW 필요)."
}
# 이벤트는 --events 를 쓰지 않으므로 백업에 들어가지 않는다. 지금은 0 개라 문제가 없지만,
# 생기면 조용히 빠지므로 알린다.
if($expEvtN -gt 0){ Warn "이 DB 에 이벤트 스케줄이 $expEvtN 개 있습니다. 이 백업에는 포함되지 않습니다(--events 미사용)." }

# ============================================================================
#  6) 같은 볼륨 경고 — 막지는 않는다. 디스크가 죽으면 원본과 백업이 같이 죽는다.
# ============================================================================
$dataDir = Q1 "SELECT @@datadir;"
$isLocal = @("127.0.0.1","localhost","::1",".",$env:COMPUTERNAME) -contains $DbHost
if($isLocal -and $dataDir){
  # -B(배치) 모드의 mysql 은 역슬래시를 이스케이프해서 내보낸다("C:\\ProgramData\\..." — 실측).
  $dataDir = $dataDir -replace '\\\\','\'
  try{
    $dstRoot = [IO.Path]::GetPathRoot((Resolve-Path $BackupDir).Path).ToUpper()
    $srcRoot = [IO.Path]::GetPathRoot($dataDir).ToUpper()
    if($srcRoot -and $dstRoot -eq $srcRoot){
      Warn "백업 폴더가 DB 데이터 폴더와 같은 볼륨($dstRoot)에 있습니다."
      Warn "  DB 데이터: $dataDir"
      Warn "  백업 위치: $BackupDir"
      Warn "  이 디스크가 고장 나면 원본과 백업이 함께 사라집니다. 다른 물리 디스크(또는 다른 PC)로 -BackupDir 을 옮기세요."
    } else {
      Info "볼륨 분리 확인 — DB $srcRoot / 백업 $dstRoot"
    }
  } catch { Warn "볼륨 비교를 못 했습니다: $($_.Exception.Message)" }
} elseif(-not $isLocal){
  Info "원격 DB($DbHost)라 데이터 폴더 볼륨 비교는 건너뜁니다."
}

# ============================================================================
#  4) 덤프 — .partial 로 뜨고, 검증을 통과해야만 최종 이름이 된다.
#     (검증 전에 최종 이름을 달아 두면, 실패한 반쪽 파일이 '정상 세대' 로 보관되고
#      세대 관리가 멀쩡한 백업을 밀어낸다.)
# ============================================================================
$stampName = (Get-Date).ToString("yyyyMMdd-HHmmss")
$finalPath = Join-Path $BackupDir "$DbName-$stampName.sql"
$n = 1
while(Test-Path $finalPath){   # 같은 초에 두 번 돌아도 서로 덮어쓰지 않게
  $n++
  $finalPath = Join-Path $BackupDir "$DbName-$stampName-$n.sql"
}
$partPath = "$finalPath.partial"

# 직전 세대(크기 급감 비교용). 지금 뜬 파일은 아직 .partial 이라 여기 섞이지 않는다.
$prev = @(Get-ChildItem -Path $BackupDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "$DbName-*.sql" } | Sort-Object LastWriteTime -Descending)
$prevFile = $null
if($prev.Count -gt 0){ $prevFile = $prev[0] }

Info "덤프 시작 → $partPath"
$sw = [Diagnostics.Stopwatch]::StartNew()
# --result-file 을 쓰는 이유: PowerShell 의 '>' 로 받으면 5.1 이 UTF-16 으로 쓰거나
# BOM 을 박아서 mysql 이 되먹이지 못하는 파일이 된다. mysqldump 가 직접 쓰게 한다.
& $mysqldump (MyArgs) "--single-transaction" "--no-tablespaces" "--routines" "--triggers" "--result-file=$partPath" $DbName
$dumpRc = $LASTEXITCODE
$sw.Stop()
$took = [math]::Round($sw.Elapsed.TotalSeconds,1)

if($dumpRc -ne 0){
  Bad "mysqldump 가 코드 $dumpRc 로 끝났습니다. 뜬 파일은 .partial 로 남깁니다: $partPath"
  AddLog "FAIL`t$(Split-Path $partPath -Leaf)`t-`t-`t-`t-`t$($took)s`tmysqldump exit=$dumpRc"
  exit 1
}
if(-not (Test-Path $partPath)){
  Die "mysqldump 가 성공했다는데 파일이 없습니다: $partPath" 1
}
$size = (Get-Item $partPath).Length

# ============================================================================
#  5) ★ 검증 — 뜬 파일의 내용을 DB 실제 값과 대조한다.
#
#     이 검사가 있는 이유: mysqldump 는 '권한이 모자라 절반만 떴다' 를 실패로 알리지
#     않는다. SELECT 만 가진 계정으로 뜨면 트리거가 전부 빠진 채 exit 0 이다(실측).
#     종료코드는 '명령이 죽지 않았다' 만 말할 뿐 '복구에 쓸 수 있다' 를 말하지 않는다.
#     그래서 파일을 실제로 읽어 표 이름·트리거 이름을 DB 와 맞춰 본다.
#
#     파싱 근거(MySQL 8.4.9 mysqldump 10.13 실제 출력으로 확인):
#       · 표     : 줄머리 'CREATE TABLE `이름` ('   (뷰는 여기 안 걸린다. 뷰 자리표는
#                  'DROP TABLE IF EXISTS' + '/*!50001 CREATE VIEW' 형태다 — 실측)
#       · 트리거 : '/*!50003 CREATE*/ … /*!50003 TRIGGER `이름` …' — 리터럴
#                  'CREATE TRIGGER' 는 파일에 나오지 않는다. 그래서 'CREATE' 를 품은
#                  '/*!' 또는 'CREATE' 로 시작하는 줄에서 TRIGGER `이름` 을 뽑는다.
#                  (줄머리를 이렇게 제한하는 이유: 데이터 INSERT 줄에 우연히
#                   "CREATE TRIGGER `x`" 라는 문자열이 들어 있어도 오탐하지 않게)
#       · 데이터 값 안의 줄바꿈은 mysqldump 가 \n 문자열로 이스케이프하므로,
#         줄머리 앵커가 데이터에 오염되지 않는다.
# ============================================================================
$gotTables = @(); $gotTrigs = @(); $gotRoutines = 0
$tail = ""
try{
  $sr = New-Object IO.StreamReader($partPath, (New-Object System.Text.UTF8Encoding($false)))
  while($null -ne ($line = $sr.ReadLine())){
    if($line.StartsWith("CREATE TABLE ")){
      $m = [regex]::Match($line,'^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`([^`]+)`')
      if($m.Success){ $gotTables += $m.Groups[1].Value }
      continue
    }
    if(($line.StartsWith("/*!") -or $line.StartsWith("CREATE")) -and $line.Contains("CREATE")){
      $m = [regex]::Match($line,'(?i)\bTRIGGER\s+`([^`]+)`')
      if($m.Success){ $gotTrigs += $m.Groups[1].Value; continue }
      $m2 = [regex]::Match($line,'(?i)\b(PROCEDURE|FUNCTION)\s+`([^`]+)`')
      if($m2.Success){ $gotRoutines++ ; continue }
    }
    if($line.StartsWith("-- Dump completed")){ $tail = $line }
  }
  $sr.Close()
} catch {
  Bad "덤프 파일을 읽지 못했습니다: $($_.Exception.Message)"
  AddLog "FAIL`t$(Split-Path $partPath -Leaf)`t$size`t-`t-`t-`t$($took)s`t파일 판독 실패"
  exit 1
}

$problems = @()
# (a) 마감 표시 — mysqldump 는 정상 종료 시 마지막 줄에 '-- Dump completed on …' 을 쓴다.
#     디스크가 차거나 프로세스가 중간에 끊기면 이 줄이 없다.
if($tail -eq ""){ $problems += "파일 끝의 '-- Dump completed' 표시가 없습니다(중간에 끊겼을 수 있습니다)." }
# (b) 표 이름 집합
$missT = @($expTables | Where-Object { $gotTables -notcontains $_ })
$extraT = @($gotTables | Where-Object { $expTables -notcontains $_ })
if($missT.Count -gt 0){  $problems += "덤프에 빠진 표 $($missT.Count)개: $($missT -join ', ')" }
if($extraT.Count -gt 0){ $problems += "DB 에 없는 표가 덤프에 있습니다: $($extraT -join ', ')" }
# (c) 트리거 이름 집합 (★ 권한 부족이 실제로 드러나는 자리. 다만 위 3)단계 선검사가
#     없으면 기대값 자체가 0 으로 깎여 여기서는 아무것도 걸리지 않는다.)
$missG = @($expTrigs | Where-Object { $gotTrigs -notcontains $_ })
$extraG = @($gotTrigs | Where-Object { $expTrigs -notcontains $_ })
if($missG.Count -gt 0){  $problems += "덤프에 빠진 트리거 $($missG.Count)개: $($missG -join ', ')" }
if($extraG.Count -gt 0){ $problems += "DB 에 없는 트리거가 덤프에 있습니다: $($extraG -join ', ')" }
# (d) 루틴 수
if($gotRoutines -ne $expRtnN){ $problems += "루틴 수가 다릅니다(덤프 $gotRoutines / DB $expRtnN)." }
# (e) 크기 — 0바이트, 그리고 '직전 세대 대비 급감'.
#     절대 크기로 DB 와 대조할 방법은 없다(덤프는 텍스트, DB 는 페이지 단위라 단위가 다르다).
#     대신 직전 성공분과 비교한다. 위 트리거 사고가 바로 72K → 48K 급감으로 나타났다.
if($size -le 0){ $problems += "덤프 파일이 0 바이트입니다." }
if($prevFile -and $prevFile.Length -gt 0){
  $ratio = [double]$size / [double]$prevFile.Length
  if($ratio -lt 0.5){ $problems += "직전 백업($($prevFile.Name), $($prevFile.Length)B)보다 크기가 절반 미만입니다($size B, $([math]::Round($ratio*100))%). 무언가 빠졌을 수 있습니다." }
  elseif($ratio -lt 0.9){ Warn "직전 백업보다 $([math]::Round((1-$ratio)*100))% 작습니다($($prevFile.Length)B → $size B). 데이터가 줄었는지 확인하세요." }
}

if($problems.Count -gt 0){
  Bad "검증 실패 — 이 파일은 복구에 쓸 수 없습니다. .partial 로 남깁니다: $partPath"
  foreach($p in $problems){ Write-Host "   · $p" -ForegroundColor Red }
  Write-Host "   (덤프 표 $($gotTables.Count)/DB $($expTables.Count) · 덤프 트리거 $($gotTrigs.Count)/DB $($expTrigs.Count) · $size 바이트)"
  AddLog "FAIL`t$(Split-Path $partPath -Leaf)`t$size`t$($gotTables.Count)/$($expTables.Count)`t$($gotTrigs.Count)/$($expTrigs.Count)`t$gotRoutines/$expRtnN`t$($took)s`t$($problems -join ' | ')"
  exit 1
}

Move-Item -LiteralPath $partPath -Destination $finalPath -Force
if(-not (Test-Path $finalPath)){ Die "검증은 통과했으나 최종 이름으로 바꾸지 못했습니다: $finalPath" 1 }
Ok "검증 통과 — 표 $($gotTables.Count)/$($expTables.Count) · 트리거 $($gotTrigs.Count)/$($expTrigs.Count) · 루틴 $gotRoutines/$expRtnN · $size 바이트 · $($took)초"
Info "백업 파일: $finalPath"
AddLog "OK`t$(Split-Path $finalPath -Leaf)`t$size`t$($gotTables.Count)/$($expTables.Count)`t$($gotTrigs.Count)/$($expTrigs.Count)`t$gotRoutines/$expRtnN`t$($took)s`t-"

# ============================================================================
#  세대 관리 — 무엇을 지웠는지 반드시 남긴다(로그에도, 화면에도).
# ============================================================================
function Prune($pattern, $label){
  $all = @(Get-ChildItem -Path $BackupDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like $pattern } | Sort-Object LastWriteTime -Descending)
  if($all.Count -le $Keep){ return }
  $old = $all[$Keep..($all.Count-1)]
  foreach($f in $old){
    Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
    if(Test-Path $f.FullName){ Warn "$label 삭제 실패: $($f.Name)" }
    else{
      Info "$label 삭제(세대 $Keep 초과): $($f.Name)  [$($f.Length) 바이트, $($f.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))]"
      AddLog "PRUNE`t$($f.Name)`t$($f.Length)`t-`t-`t-`t-`t$label 세대 정리(-Keep $Keep)"
    }
  }
}
# 실패한 .partial 도 같은 세대 수만큼만 남긴다 — 원인을 볼 수 있게 남기되, 무한히 쌓이지 않게.
Prune "$DbName-*.sql" "백업"
Prune "$DbName-*.sql.partial" "실패본"

$left = @(Get-ChildItem -Path $BackupDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "$DbName-*.sql" })
$part = @(Get-ChildItem -Path $BackupDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "$DbName-*.sql.partial" })
Info "보관 중인 백업: $($left.Count)개 (최대 $Keep)"
if($part.Count -gt 0){ Warn "검증에 실패한 .partial 파일이 $($part.Count)개 있습니다. 원인을 확인한 뒤 지우세요." }
Info "로그: $($script:logPath)"

# 복구 방법을 백업 옆에 항상 적어 둔다 — 급할 때 이 스크립트를 읽고 있을 사람은 없다.
$howto = Join-Path $BackupDir "복구방법.txt"
if(-not (Test-Path $howto)){
  $enc = New-Object System.Text.UTF8Encoding($false)
  $txt = @"
taskmgr 백업 복구 방법
=======================
1) 복구용 빈 DB 를 만든다(원본을 덮어쓰기 전에 반드시 여기서 먼저 확인할 것):
     mysql -uroot -p -e "CREATE DATABASE taskmgr_restore CHARACTER SET utf8mb4;"

2) 덤프를 밀어넣는다(이 파일들은 UTF-8, --default-character-set 을 반드시 줄 것):
     mysql -uroot -p --default-character-set=utf8mb4 taskmgr_restore < "taskmgr-YYYYMMDD-HHMMSS.sql"

3) 표·트리거·행 수가 원본과 같은지 확인한다:
     SELECT COUNT(*) FROM information_schema.TABLES   WHERE TABLE_SCHEMA='taskmgr_restore' AND TABLE_TYPE='BASE TABLE';
     SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='taskmgr_restore';

4) ★ 계정과 권한을 다시 만든다 — 이 덤프에는 들어 있지 않다.
   덤프는 taskmgr 한 DB 만 뜬다. 계정 정보는 mysql 스키마에 있어서 대상이 아니다.
   그래서 이 단계를 건너뛰면 표와 데이터는 다 있는데 위젯이 첫 조회부터 ERROR 1142 로 죽는다
   (실측: 복구본에 taskmgr_app 권한 0행).
     mysql -uroot -p < db\deploy\create-app-user.sql    (앱 계정 생성 — 비밀번호는 배포본과 같아야 한다)
     mysql -uroot -p taskmgr < db\deploy\grants-calendar.sql   (cal_* 권한)
   사용자·조직 표(app_user/org_unit/title_code)의 '데이터'는 덤프에 들어 있지만,
   그 표를 읽을 권한은 별도 저장소의 taskmgr-company-data\apply.cmd 가 부여한다.

5) .partial 로 끝나는 파일은 검증에 실패한 반쪽 백업이다. 복구에 쓰지 말 것.

주의 1) 이 백업은 주 1회 스냅샷이다. 마지막 백업 이후의 변경은 들어 있지 않다.
주의 2) ★ binlog 로 그 사이를 메우는 것은 '디스크 고장' 에는 통하지 않는다.
        binlog 는 MySQL 의 datadir(= DB 와 같은 디스크)에 있어서 디스크가 죽으면 함께 죽는다.
        binlog 가 쓸모 있는 경우는 디스크는 멀쩡한데 데이터를 실수로 지운 때뿐이다.
        게다가 이 덤프에는 binlog 좌표(--source-data)가 없다. 좌표를 넣으려면 백업 계정에
        전역 권한(RELOAD·REPLICATION CLIENT)이 필요한데, 최소권한 원칙과 맞바꾼 것이다.
        정밀 시점 복구가 필요해지면 그 권한을 주고 --source-data 를 켜야 한다.
        결론: 디스크가 죽으면 마지막 주간 백업 시점까지만 돌아간다. 그게 이 백업의 한계다.
"@
  try{ [IO.File]::WriteAllText($howto, $txt, $enc) } catch {}
}

exit 0
