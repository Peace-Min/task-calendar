<#
  migrate-code-ids.ps1: 이미 데이터가 있는 v12 DB 를 v13(코드표 번호 키)으로 옮기는 마스터 도구.
  보통은 migrate-code-ids.cmd 를 더블클릭한다.

  무엇을 하나
    같은 폴더의 migrate-2026-10-15-code-ids.sql(12 에서 13, 코드표 넷의 기본키를 이름에서 번호로)을
    사람이 손으로 지켜야 했던 순서 그대로 돌린다: 판번호 확인, 앱 세션 확인, 확인(Y), 백업과 백업 검증,
    이관 SQL(--force 없이), 결과 판정, 실패하면 무엇이 남았고 어떻게 되돌리는지 안내.
    근거와 결정은 docs/CODE-TABLE-IDS.md, 이관 SQL 의 단계와 가드는 그 파일 머리말이 정본이다.

  언제 쓰나
    데이터가 들어 있고 지우면 안 되는 v12 DB 하나를 0.21.0 앱이 쓰는 v13 으로 올릴 때.
    예: 서버 노릇을 하는 PC 의 taskcalendar(0.19.x 를 쓰던 DB).

  언제 쓰지 않나
    - 새로 세우는 DB(회사 서버 포함): setup-taskcalendar.cmd 가 처음부터 v13 으로 만든다. 이 도구가 아니다.
    - 이미 v13 인 DB: 이 도구가 판번호를 읽고 "이미 v13 입니다" 로 끝낸다(종료코드 0, 아무것도 안 바꿈).
    - 판번호가 12 도 13 도 아닌 DB: 이 도구는 멈춘다(앞 판이 빠졌거나 다른 DB 다).

  단계(화면에 [n/3] 으로 찍힌다. 첫 실패에서 멈춘다)
    [0] 사전 점검: mysql.exe, mysqldump.exe, 이관 SQL 파일, 접속, DB 와 cal_schema_meta, 판번호(13 이면 여기서 끝,
        12 가 아니면 멈춤), 옛 모양(이름 키) 확인, 앱 계정(taskmgr_app) 세션 확인(-Force 면 건너뜀),
        행 수(project, app_user, cal_entry)와 백업 경로를 보여 주고 Y 를 받는다(-Yes 면 묻지 않는다).
    [1] 백업: mysqldump(--single-transaction --no-tablespaces --routines --triggers --events --set-gtid-purged=OFF)
        를 <BackupDir>\<DbName>-before-code-ids-<시각>.sql 로 뜬다. 1KB 를 넘고 끝에 '-- Dump completed' 가
        있어야 통과다. 통과하기 전에는 이관 SQL 을 돌리지 않는다(DB 는 그대로).
        ★ --databases 를 쓰지 않는다. 그러면 덤프에 CREATE DATABASE 와 USE 가 들어가고, restore-taskmgr 로
          별도 DB 에 되살릴 때 대상 인자를 무시하고 라이브 DB 로 들어간다(restore-taskmgr.ps1 머리말 ⚠️).
          backup-taskmgr.ps1 과 같은 단일 DB 덤프라 restore-taskmgr -TargetDb 로 어디에든 되살릴 수 있다.
    [2] 이관 SQL: mysql --default-character-set=utf8mb4 -t <DbName> < migrate-2026-10-15-code-ids.sql.
        --force 는 붙이지 않는다(이관 SQL 은 조건이 어긋나면 에러로 멈추는 방식으로 자신을 지킨다).
        화면과 오류 출력은 <BackupDir>\<DbName>-migrate-code-ids-<시각>.log 에 그대로 남긴다.
    [3] 판정: 판번호를 다시 읽어 13 인지, 절단 관문(cut_*)과 사후 검증(e1~e8)이 모두 0 인지, 행 수가 같은지 본다.
        실패했으면 DB 상태(옛 열, 옛 기본키, 옛 외래키, 판번호)를 직접 읽어 어디서 멈췄는지 가른다:
          - 절단 전(옛 열과 키가 그대로): "옛 열은 그대로입니다. 메시지대로 데이터를 고친 뒤 다시 실행하세요."
          - 스키마는 13 이고 마지막 권한 회수만 실패: 관리자가 칠 REVOKE 세 줄을 보여 준다.
          - 절단 뒤이거나 알 수 없음: 백업으로 되돌리는 restore-taskmgr 명령을 그대로 보여 준다.
    화면에 찍힌 모든 줄은 <BackupDir>\migrate-code-ids-<시각>.txt 로 남긴다(실패면 이름 끝에 -FAILED).

  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
    0 ok - migrated to v13 and verified, or the DB is already v13 (nothing to do)
    1 failed - the migration SQL stopped or the result check failed; read the printed recovery steps
    2 cancelled - the confirmation was not Y; nothing was changed
    3 preflight failed - tools, SQL file, password, connection, DB, schema_version not 12, or not the old shape; nothing was changed
    4 app sessions open - the app account is still connected to this DB; close every widget; nothing was changed
    5 backup failed - mysqldump failed or the dump is incomplete; the DB was not touched
  --- END EXITCODES ---

  ⚠️ 비밀번호: 이 스크립트는 비밀번호를 인자로 받지 않는다(같은 사용자의 다른 프로세스가 명령줄을 읽는다.
     restore-taskmgr.ps1 머리말의 실측). 순서는 restore-taskmgr 와 같다:
       (1) 환경변수 TASKMGR_ADMIN_PW, (2) 입력이 리다이렉트돼 있으면 stdin 첫 줄(상한 10초),
       (3) 대화형이면 가려진 입력으로 묻는다.
     mysql 과 mysqldump 에는 임시 .cnf(--defaults-extra-file)로만 넘기고, 어떻게 끝나든 finally 에서 지운다.

  ⚠️ 위젯을 모두 닫을 것. 열린 연결이 표를 잡고 있으면 첫 ALTER 가 10초 뒤 ERROR 1205 로 멈춘다(그때는 바뀐 것이 없다).
     그래서 [0] 에서 앱 계정 세션을 세고, 하나라도 있으면 목록을 보여 주고 멈춘다(종료코드 4).
     -Force 는 이 세션 확인 하나만 건너뛴다. 다른 확인은 그대로다.

  ⚠️ 인자 값을 역슬래시로 끝내지 말 것(-BackupDir "D:\x\" 등). powershell.exe 가 \" 를 이스케이프된 따옴표로 읽어
     뒤 인자를 삼킨다. 아래 AssertNoSwallow 가 그 상태를 감지하면 멈춘다(setup-taskcalendar.ps1 과 같은 가드).

  창 닫힘: .cmd 로 띄우면(TC_MIGRATE_LAUNCHER=cmd) 실패는 .cmd 가, 성공은 이 스크립트가 멈춰 준다(-Yes 면 성공은 안 멈춤).
     ps1 을 직접 실행하면 종료코드와 무관하게 늘 엔터를 기다린다. stdin 이 리다이렉트된 무인 실행은 멈추지 않는다.

  예)  migrate-code-ids.cmd                                   (더블클릭: 묻고, 백업하고, 옮긴다)
       migrate-code-ids.cmd -DbName taskcalendar_copy        (복제한 격리 DB 로 먼저 리허설)
       migrate-code-ids.cmd -DbHost 192.168.0.50 -BackupDir "D:\taskmgr-backup"
       무인 실행(입력이 리다이렉트되면 -Yes 가 꼭 있어야 한다. 비밀번호 자리는 예시용 자리표시다):
         set TASKMGR_ADMIN_PW=<관리자 비밀번호>  그다음  migrate-code-ids.cmd -Yes
         echo <관리자 비밀번호>| migrate-code-ids.cmd -Yes
#>
[CmdletBinding()]
param(
  [string]$DbName = "taskcalendar",     # 옮길 DB(v12, 데이터가 있는 것)
  [string]$DbHost = "127.0.0.1",        # MySQL 호스트
  [int]$Port = 3306,
  [string]$BaseDir = "C:\mysql",        # mysql.exe 위치(없으면 서비스 binPath, 그다음 기본 설치 경로)
  [string]$ServiceName = "MySQL84",
  [string]$DbUser = "root",             # ALTER 와 REVOKE 를 낼 관리 계정
  [string]$AppUser = "taskmgr_app",     # 세션을 세는 앱 계정(위젯이 붙는 계정)
  [string]$BackupDir = "",              # 비우면 <스크립트>\..\..\dist\migrate-code-ids\backup
  [switch]$Yes,                         # 확인 질문을 건너뛴다(무인 실행)
  [switch]$Force                        # 앱 세션 확인만 건너뛴다
)
$ErrorActionPreference = "Continue"     # 네이티브 stderr 가 창을 닫지 않게(Stop 금지)

# ============================================================================
#  상수
# ============================================================================
$EXIT_OK        = 0
$EXIT_FAIL      = 1
$EXIT_CANCEL    = 2
$EXIT_PREFLIGHT = 3
$EXIT_BUSY      = 4
$EXIT_BACKUP    = 5

$ADMIN_PW_ENV   = "TASKMGR_ADMIN_PW"   # 무인 실행 자격(restore-taskmgr.ps1 과 같은 이름)
$STDIN_WAIT_SEC = 10                   # stdin 첫 줄 읽기 상한(초). 파이프가 열린 채 비어 있으면 영원히 멎는다.

# 이관 SQL 은 이 스크립트와 같은 폴더의 이 이름 하나다(다른 경로를 받지 않는다).
$MIGRATION_SQL  = "migrate-2026-10-15-code-ids.sql"
$DEFAULT_MYSQL_DIR = "C:\Program Files\MySQL\MySQL Server 8.4"
# mysqldump 의 GTID 옵션. 이름을 둘로 나눠 적는 이유: 비밀번호 명령줄 검사(tests/ps-guard-lib.mjs)가 코드 속 '-p...' 를
# mysql 의 -p<비번> 으로 본다. 검사를 느슨하게 하는 대신 이 이름 하나만 쪼갠다(setup-taskcalendar.ps1 의 04 파일 이름과 같은 방식).
$GTID_PURGED_OFF = "--set-gtid-" + "purged=OFF"

# ============================================================================
#  출력, 보고서, 종료
# ============================================================================
$script:logLines  = New-Object System.Collections.Generic.List[string]
$script:cnfPath   = $null
$script:reportDir = $null
$script:ts        = Get-Date -Format 'yyyyMMdd-HHmmss'

function Log([string]$m, [string]$color){
  if($color){ Write-Host $m -ForegroundColor $color } else { Write-Host $m }
  $script:logLines.Add($m)
}
function Info($m){ Log "[*] $m" }
function Ok($m){   Log "[OK] $m" 'Green' }
function Warn($m){ Log "[!] $m" 'Yellow' }
function Step($n, $m){ Log ""; Log "==== [$n/3] $m ====" 'Cyan' }

function Cleanup(){
  if($script:cnfPath){ Remove-Item -LiteralPath $script:cnfPath -Force -ErrorAction SilentlyContinue; $script:cnfPath = $null }
}
function SaveReport([string]$suffix){
  $dir = $script:reportDir
  if(-not $dir){ $dir = Split-Path -Parent $PSCommandPath }
  $p = Join-Path $dir ("migrate-code-ids-" + $script:ts + $suffix + ".txt")
  try {
    Write-Host "[*] 보고서: $p"
    $script:logLines.Add("[*] 보고서: $p")
    # BOM 을 붙인다. 메모장(구판 포함)이 한국어를 UTF-8 로 확실히 알아보게.
    [IO.File]::WriteAllLines($p, $script:logLines.ToArray(), (New-Object System.Text.UTF8Encoding($true)))
  } catch { Write-Host "[!] 보고서를 쓰지 못했습니다: $p ($($_.Exception.Message))" -ForegroundColor Yellow }
}
# 모든 종료가 이 한 곳을 지난다. 보고서를 남기고, 비밀번호가 든 임시 .cnf 를 지우고, 코드를 낸다.
function Finish($code, [string]$lastLine, [string]$color){
  Log $lastLine $color
  if($code -eq $EXIT_OK){ SaveReport "" } else { SaveReport "-FAILED" }
  Cleanup
  # 창을 멈추나(setup-taskcalendar.ps1 과 같은 규칙):
  #   stdin 이 리다이렉트됨: 멈추지 않는다 / .cmd 를 거치지 않음: 늘 멈춘다 / .cmd 가 띄움: 성공만(-Yes 면 안 멈춤)
  $pause = $false
  if([Console]::IsInputRedirected){ $pause = $false }
  elseif($env:TC_MIGRATE_LAUNCHER -ne 'cmd'){ $pause = $true }
  elseif($code -eq $EXIT_OK -and -not $Yes){ $pause = $true }
  if($pause){
    try { Read-Host "엔터를 누르면 종료" | Out-Null } catch {}
  }
  exit $code
}
# 사전 점검 실패: DB 에 아무것도 하지 않은 상태에서만 부른다.
function DiePre([string]$m){
  Log "[사전 점검 실패] $m" 'Red'
  Finish $EXIT_PREFLIGHT "중단: 사전 점검 실패(종료코드 $EXIT_PREFLIGHT). 아무것도 바꾸지 않았습니다." 'Red'
}

# ============================================================================
#  인자 검증: 인자가 뒤엉킨 채 '조용히 다른 DB' 를 옮기는 것을 막는다
# ============================================================================
$SWALLOW_FLAGS = '\s-(DbName|DbHost|Port|BaseDir|ServiceName|DbUser|AppUser|BackupDir|Yes|Force)\b'
function AssertNoSwallow($label, $val){
  if("$val" -match '"'){ DiePre "$label 값에 따옴표가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태입니다. 경로 끝의 역슬래시를 빼고 다시 실행하세요(예: -BackupDir `"D:\backup`")." }
  if("$val" -match $SWALLOW_FLAGS){ DiePre "$label 값 안에 다른 인자가 들어 있습니다: [$val]. 경로 끝의 역슬래시를 빼고 다시 실행하세요." }
}

Log "=================================================="
Log "   코드표 번호 키 이관(v12 에서 v13): $DbName"
Log "   서버: $DbHost`:$Port"
Log "=================================================="

Step 0 "사전 점검"
AssertNoSwallow "-DbName"      $DbName
AssertNoSwallow "-DbHost"      $DbHost
AssertNoSwallow "-BaseDir"     $BaseDir
AssertNoSwallow "-ServiceName" $ServiceName
AssertNoSwallow "-DbUser"      $DbUser
AssertNoSwallow "-AppUser"     $AppUser
AssertNoSwallow "-BackupDir"   $BackupDir

function FullPath([string]$p){
  if(-not [IO.Path]::IsPathRooted($p)){ $p = Join-Path (Get-Location).ProviderPath $p }
  return [IO.Path]::GetFullPath($p)
}
$scriptDir = Split-Path -Parent $PSCommandPath
if(-not $BackupDir){ $BackupDir = Join-Path $scriptDir "..\..\dist\migrate-code-ids\backup" }
$BackupDir = FullPath $BackupDir
# 보고서 폴더를 지금 잡는다. 사전 점검(3)이나 취소(2)로 끝나도 보고서가 남게.
if(-not (Test-Path -LiteralPath $BackupDir)){ try { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null } catch {} }
if(Test-Path -LiteralPath $BackupDir -PathType Container){ $script:reportDir = $BackupDir }
# 아래 값들은 SQL 문자열과 식별자에 그대로 들어간다. 여기 통과가 곧 그 자리의 안전 조건이다.
if($DbName -notmatch '^[A-Za-z0-9_]+$'){ DiePre "-DbName 이 식별자 형식이 아닙니다: [$DbName]" }
if($AppUser -notmatch '^[A-Za-z0-9_]+$'){ DiePre "-AppUser 가 식별자 형식이 아닙니다: [$AppUser]" }
if($DbUser -notmatch '^[A-Za-z0-9_.$-]+$'){ DiePre "-DbUser 가 식별자 형식이 아닙니다: [$DbUser]" }
if($DbHost -notmatch '^[A-Za-z0-9_.:-]+$'){ DiePre "-DbHost 형식이 이상합니다: [$DbHost]" }
if($Port -lt 1 -or $Port -gt 65535){ DiePre "-Port 범위가 아닙니다: $Port" }

# --- 도구: -BaseDir, 서비스 binPath, 기본 설치 경로 순서로 mysql.exe 와 mysqldump.exe 를 함께 찾는다 ---
$toolRoots = New-Object System.Collections.Generic.List[string]
$toolRoots.Add($BaseDir)
try {
  $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  if($svc -and $svc.PathName -match '"?([A-Za-z]:[^"]*)\\bin\\mysqld\.exe'){ $toolRoots.Add($Matches[1]) }
} catch {}
$toolRoots.Add($DEFAULT_MYSQL_DIR)
$mysql = $null; $mysqldump = $null; $toolRoot = $null
foreach($root in $toolRoots){
  $c1 = Join-Path $root "bin\mysql.exe"
  $c2 = Join-Path $root "bin\mysqldump.exe"
  if((Test-Path -LiteralPath $c1) -and (Test-Path -LiteralPath $c2)){ $mysql = $c1; $mysqldump = $c2; $toolRoot = $root; break }
}
if(-not $mysql){ DiePre "mysql.exe 와 mysqldump.exe 를 못 찾았습니다(찾아본 곳: $($toolRoots -join ', ')). -BaseDir 로 설치 경로를 지정하세요." }
Ok "도구: $mysql"

# --- 이관 SQL: 같은 폴더의 정해진 이름 하나 ---
$sqlFile = Join-Path $scriptDir $MIGRATION_SQL
if(-not (Test-Path -LiteralPath $sqlFile -PathType Leaf)){ DiePre "이관 SQL 이 없습니다: $sqlFile (이 스크립트와 같은 폴더에 있어야 합니다)" }
$sqlText = Get-Content -LiteralPath $sqlFile -Raw -Encoding UTF8
# 앞뒤 판번호는 이관 SQL 에서 읽는다(숫자를 여기 박지 않는다. 파일과 이 도구가 어긋나지 않게).
$fromMatch = [regex]::Match($sqlText, "SET @g := IF\(@v = '(\d+)'")
$toMatch   = [regex]::Match($sqlText, "UPDATE cal_schema_meta SET v = '(\d+)'")
if(-not $fromMatch.Success -or -not $toMatch.Success){ DiePre "$MIGRATION_SQL 에서 앞뒤 판번호(가드의 @v = 'N', UPDATE cal_schema_meta SET v = 'N')를 읽지 못했습니다. 파일 형식이 바뀌었습니다." }
$fromVersion = $fromMatch.Groups[1].Value
$toVersion   = $toMatch.Groups[1].Value
Ok "이관 SQL: $sqlFile (판번호 $fromVersion 에서 $toVersion)"

# 무인 실행(입력 리다이렉트)에서는 확인 질문에 답할 사람이 없다. -Yes 를 요구한다.
if([Console]::IsInputRedirected -and -not $Yes){ DiePre "입력이 리다이렉트된 무인 실행에서는 확인(Y)을 받을 수 없습니다. -Yes 를 함께 주세요." }

# --- 관리자 비밀번호: 환경변수, stdin 첫 줄(상한), 가려진 입력 순서 ---
# stdin 첫 줄을 상한 안에 읽는다(restore-taskmgr.ps1 과 같은 구현). [Console]::In.ReadLine() 은 파이프가 열린 채
# 비어 있으면 돌아오지 않으므로 raw 스트림을 비동기로 읽고 대기에 상한을 건다.
function ReadStdinLineBounded([int]$timeoutSec){
  $res = @{ Line = $null; TimedOut = $false }
  try{
    $stdin = [Console]::OpenStandardInput()
    $buf = New-Object byte[] 4096
    $sb  = New-Object System.Text.StringBuilder
    $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSec)
    while($true){
      $leftMs = [int][math]::Ceiling(($deadline - [DateTime]::UtcNow).TotalMilliseconds)
      if($leftMs -le 0){ $res.TimedOut = $true; return $res }
      $ar = $stdin.BeginRead($buf, 0, $buf.Length, $null, $null)
      if(-not $ar.AsyncWaitHandle.WaitOne($leftMs)){ $res.TimedOut = $true; return $res }
      $n = $stdin.EndRead($ar)
      if($n -le 0){ break }
      [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $n))
      $t = $sb.ToString()
      $ix = $t.IndexOfAny([char[]]@("`r","`n"))
      if($ix -ge 0){ $res.Line = $t.Substring(0, $ix); return $res }
    }
    $res.Line = $sb.ToString()
    return $res
  } catch { $res.Line = $null; return $res }
}
$adminPw = $null
$envPw = [Environment]::GetEnvironmentVariable($ADMIN_PW_ENV)
if(-not [string]::IsNullOrEmpty($envPw)){
  $adminPw = $envPw
  Info "관리 자격: 환경변수 $ADMIN_PW_ENV 에서 읽었습니다(stdin 을 읽지 않습니다)."
} elseif([Console]::IsInputRedirected){
  Info "관리 자격: stdin 첫 줄에서 읽습니다(상한 $STDIN_WAIT_SEC 초)."
  $r = ReadStdinLineBounded $STDIN_WAIT_SEC
  if($r.TimedOut){ DiePre "stdin 첫 줄을 $STDIN_WAIT_SEC 초 안에 받지 못했습니다. 무인 실행이면 $ADMIN_PW_ENV 를 설정하세요." }
  $adminPw = $r.Line
} else {
  $sec = Read-Host "MySQL $DbUser 비밀번호" -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $adminPw = [Runtime.InteropServices.Marshal]::PtrToStringAuto($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
if([string]::IsNullOrEmpty($adminPw)){ DiePre "$DbUser 비밀번호가 비어 있습니다(무인 실행이면 $ADMIN_PW_ENV 나 stdin 첫 줄로 주세요)." }

# ============================================================================
#  여기서부터 임시 .cnf 가 생긴다. 어디서 끝나든 finally 와 Finish 가 지운다
# ============================================================================
try {
  # 임시 .cnf. 비밀번호는 여기에만 쓴다(명령줄 금지). BOM 금지(MySQL 옵션 파서가 첫 줄을 못 읽는다).
  $pwEsc = ($adminPw -replace '\\','\\') -replace '"','\"'
  $adminPw = $null
  $script:cnfPath = Join-Path $env:TEMP ("mymigrate_" + [IO.Path]::GetRandomFileName() + ".cnf")
  $cnfText = "[client]`r`nuser=$DbUser`r`npassword=""$pwEsc""`r`nhost=$DbHost`r`nport=$Port`r`ndefault-character-set=utf8mb4`r`n"
  [IO.File]::WriteAllText($script:cnfPath, $cnfText, (New-Object System.Text.UTF8Encoding($false)))
  $pwEsc = $null

  function BQ([string]$n){ return ('`' + $n + '`') }
  $dbQ = BQ $DbName

  # 한 결과 질의(-N -B). 실패하면 $null 을 돌려준다. 부르는 쪽이 단계에 맞는 종료코드로 끝낸다.
  function QTry([string]$sql){
    $o = & $mysql "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql
    if($LASTEXITCODE -ne 0){ return $null }
    if($null -eq $o){ return "" }
    return ((@($o) -join "`n").Trim())
  }
  # 여러 행 질의. 빈 배열을 함수에서 그대로 돌려주면 $null 로 풀려 '실패' 와 구분이 안 되므로 상자에 담는다.
  function QRowsTry([string]$sql){
    $o = & $mysql "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql
    if($LASTEXITCODE -ne 0){ return @{ Ok = $false; Rows = @() } }
    if($null -eq $o){ return @{ Ok = $true; Rows = @() } }
    return @{ Ok = $true; Rows = @(@($o) | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne "" }) }
  }
  function QPre([string]$sql, [string]$what){
    $v = QTry $sql
    if($null -eq $v){ DiePre "$what 질의가 실패했습니다. 위에 찍힌 mysql 오류를 확인하세요." }
    return $v
  }

  # 옛 모양(이름 키) 지표. 이관 SQL 0-d 가드와 같은 질의다. 사전 점검과 실패 판정이 함께 쓴다.
  $SQL_OLD_COLS = "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '$DbName' AND ((TABLE_NAME = 'project' AND COLUMN_NAME IN ('customer','section','status')) OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'title'));"
  $SQL_OLD_PK   = "SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = '$DbName' AND CONSTRAINT_NAME = 'PRIMARY' AND TABLE_NAME IN ('customer','section_code','status_code','title_code') AND COLUMN_NAME = 'name';"
  $SQL_OLD_FK   = "SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = '$DbName' AND REFERENCED_TABLE_NAME IN ('customer','section_code','status_code','title_code') AND REFERENCED_COLUMN_NAME = 'name' AND ((TABLE_NAME = 'project' AND COLUMN_NAME IN ('customer','section','status')) OR (TABLE_NAME = 'app_user' AND COLUMN_NAME = 'title'));"
  $SQL_VERSION  = "SELECT v FROM $dbQ.cal_schema_meta WHERE k = 'schema_version';"

  # --- 접속 ---
  $serverVer = QTry "SELECT VERSION();"
  if($null -eq $serverVer){ DiePre "MySQL 에 접속하지 못했습니다($DbUser@$DbHost`:$Port). 위 mysql 오류(비밀번호, 서비스 실행 여부)를 확인하세요." }
  Ok "접속: MySQL $serverVer"

  # --- DB 와 판번호 ---
  if([int](QPre "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$DbName';" "DB 유무") -lt 1){
    DiePre "DB '$DbName' 가 없습니다. -DbName 을 확인하세요(새로 만드는 것이면 setup-taskcalendar.cmd 를 쓰세요)."
  }
  if([int](QPre "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '$DbName' AND TABLE_NAME = 'cal_schema_meta';" "cal_schema_meta 유무") -lt 1){
    DiePre "'$DbName' 에 cal_schema_meta 표가 없습니다. 캘린더 DB(taskcalendar)가 맞는지 확인하세요."
  }
  $verBefore = QPre $SQL_VERSION "schema_version"
  if(-not $verBefore){ DiePre "'$DbName'.cal_schema_meta 에 schema_version 행이 없습니다. 판번호를 알 수 없어 멈춥니다." }
  if($verBefore -eq $toVersion){
    Ok "'$DbName' 의 schema_version = $verBefore"
    Finish $EXIT_OK "이미 v$toVersion 입니다. 할 일이 없습니다." 'Green'
  }
  if($verBefore -ne $fromVersion){
    DiePre "'$DbName' 의 schema_version 이 $verBefore 입니다. 이 도구는 $fromVersion 인 DB 만 $toVersion 으로 옮깁니다(앞 판이 빠졌거나 다른 DB 입니다)."
  }
  Ok "'$DbName' 의 schema_version = $verBefore"

  # --- 옛 모양(이름 키)인가: 판번호는 12 인데 모양이 아니면 앞선 실행이 절단 뒤에 멈춘 반쯤 바뀐 DB 일 수 있다 ---
  $oldCols = [int](QPre $SQL_OLD_COLS "옛 열")
  $oldPk   = [int](QPre $SQL_OLD_PK "옛 기본키")
  $oldFkBefore = [int](QPre $SQL_OLD_FK "옛 외래키")
  if($oldCols -ne 4 -or $oldPk -ne 4){
    Log "  옛 열 $oldCols/4, 이름 기본키 $oldPk/4" 'Red'
    $prior = @(Get-ChildItem -LiteralPath $BackupDir -Filter "$DbName-before-code-ids-*.sql" -ErrorAction SilentlyContinue | Sort-Object Name)
    foreach($f in $prior){ Log "  이전 백업: $($f.FullName)" }
    DiePre "판번호는 $fromVersion 인데 옛 모양(이름 키)이 아닙니다. 앞선 실행이 옛 열을 지운 뒤 멈춘 상태일 수 있습니다. 그 실행 전에 뜬 백업(위 목록)으로 되돌린 뒤 다시 실행하세요(db/deploy/README.md 의 '기존 PC 의 DB 이관' 절)."
  }
  Ok "옛 모양 확인: 이름 열 4, 이름 기본키 4, 이름 외래키 $oldFkBefore"

  # --- 앱 세션: 위젯이 열려 있으면 ALTER 가 메타데이터 락을 기다리다 멈춘다 ---
  if($Force){
    Warn "-Force: 앱 계정($AppUser) 세션 확인을 건너뜁니다. 위젯이 열려 있으면 이관 SQL 이 10초 뒤 ERROR 1205 로 멈춥니다."
  } else {
    $sessRes = QRowsTry "SELECT ID, USER, HOST, IFNULL(DB,''), COMMAND, TIME FROM information_schema.PROCESSLIST WHERE USER = '$AppUser' AND DB = '$DbName' ORDER BY ID;"
    if(-not $sessRes.Ok){ DiePre "접속 목록(information_schema.PROCESSLIST)을 읽지 못했습니다. 관리 계정에 PROCESS 권한이 있는지 확인하세요." }
    $sessions = @($sessRes.Rows)
    if($sessions.Count -gt 0){
      Log "  앱 계정 '$AppUser' 이 '$DbName' 에 $($sessions.Count)개 붙어 있습니다(ID, 계정, 호스트, DB, 상태, 초):" 'Red'
      foreach($s in $sessions){ Log ("    " + ($s -replace "`t", ", ")) 'Red' }
      Finish $EXIT_BUSY "중단: 이 DB 에 붙은 위젯을 모두 닫은 뒤 다시 실행하세요(종료코드 $EXIT_BUSY). 아무것도 바꾸지 않았습니다." 'Red'
    }
    Ok "앱 계정 '$AppUser' 세션: 0"
  }

  # --- 행 수(정보용, 이관 뒤 같은지 본다) ---
  $COUNT_TABLES = @('project','app_user','cal_entry')
  $countsBefore = [ordered]@{}
  foreach($t in $COUNT_TABLES){ $countsBefore[$t] = QPre "SELECT COUNT(*) FROM $dbQ.$(BQ $t);" "$t 행 수" }
  $dumpPath = Join-Path $BackupDir ("$DbName-before-code-ids-" + $script:ts + ".sql")
  $migLog   = Join-Path $BackupDir ("$DbName-migrate-code-ids-" + $script:ts + ".log")

  Log ""
  Log "  DB           : $DbName  (서버 $DbHost`:$Port)"
  Log "  판번호       : $verBefore 에서 $toVersion 으로"
  foreach($t in $COUNT_TABLES){ Log ("  행 수 {0,-8}: {1}" -f $t, $countsBefore[$t]) }
  Log "  백업         : $dumpPath"
  Log "  이관 기록    : $migLog"
  Log "  이 DB 에 붙는 위젯을 모두 닫았는지 확인하세요. 이관 뒤에는 0.21.0 앱만 이 DB 에 붙습니다." 'Yellow'
  if(-not $Yes){
    $a = Read-Host "계속하려면 Y"
    if("$a".Trim() -ne 'Y'){
      Finish $EXIT_CANCEL "취소했습니다. 아무것도 바꾸지 않았습니다(종료코드 $EXIT_CANCEL)." 'White'
    }
  }

  # ==========================================================================
  #  [1/3] 백업: 이관 SQL 보다 반드시 먼저, 검증까지 통과해야 다음으로 간다
  # ==========================================================================
  Step 1 "백업"
  # 끝까지 검증되기 전에는 .partial 이름으로 둔다(restore-taskmgr 는 .partial 을 고르지 않는다).
  $partPath = $dumpPath + ".partial"
  Info "mysqldump $DbName"
  & $mysqldump "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "--single-transaction" "--no-tablespaces" "--routines" "--triggers" "--events" $GTID_PURGED_OFF "--result-file=$partPath" $DbName
  $dumpRc = $LASTEXITCODE
  if($dumpRc -ne 0){ Finish $EXIT_BACKUP "중단: mysqldump 가 코드 $dumpRc 로 실패했습니다(종료코드 $EXIT_BACKUP). DB 는 건드리지 않았습니다." 'Red' }
  if(-not (Test-Path -LiteralPath $partPath -PathType Leaf)){ Finish $EXIT_BACKUP "중단: mysqldump 가 성공했다는데 백업 파일이 없습니다(종료코드 $EXIT_BACKUP). DB 는 건드리지 않았습니다." 'Red' }
  $dumpSize = (Get-Item -LiteralPath $partPath).Length
  if($dumpSize -le 1024){ Finish $EXIT_BACKUP "중단: 백업 파일이 1KB 이하입니다($dumpSize B, 종료코드 $EXIT_BACKUP). 온전한 덤프가 아닙니다. DB 는 건드리지 않았습니다." 'Red' }
  # 정상 종료한 mysqldump 는 마지막 줄에 '-- Dump completed on ...' 을 쓴다. 없으면 도중에 끊긴 것이다.
  $tail = @(Get-Content -LiteralPath $partPath -Tail 5 -Encoding UTF8)
  $dumpDone = $false
  foreach($l in $tail){ if("$l".StartsWith("-- Dump completed")){ $dumpDone = $true } }
  if(-not $dumpDone){ Finish $EXIT_BACKUP "중단: 백업 파일 끝에 '-- Dump completed' 가 없습니다(종료코드 $EXIT_BACKUP). 중간에 끊겼을 수 있습니다: $partPath. DB 는 건드리지 않았습니다." 'Red' }
  Move-Item -LiteralPath $partPath -Destination $dumpPath -Force
  if(-not (Test-Path -LiteralPath $dumpPath -PathType Leaf)){ Finish $EXIT_BACKUP "중단: 검증한 백업의 이름을 바꾸지 못했습니다: $partPath (종료코드 $EXIT_BACKUP). DB 는 건드리지 않았습니다." 'Red' }
  Ok ("백업 완료: {0} ({1:N1} KB, '-- Dump completed' 확인)" -f $dumpPath, ($dumpSize / 1KB))

  # 되돌리기 안내. 덤프에는 USE 가 없으므로 restore-taskmgr 의 -TargetDb 로 어느 DB 에든 되살릴 수 있다.
  # restore-taskmgr 는 -TargetDb 가 -LiveDb 와 같으면 거부하고, -OverwriteLive 와 대화형 이름 입력이 있어야만 라이브를 덮는다.
  function RestoreHelp(){
    $extra = ""
    if($DbHost -ne "127.0.0.1"){ $extra += " -DbHost $DbHost" }
    if($Port -ne 3306){ $extra += " -Port $Port" }
    if($toolRoot -ne "C:\mysql"){ $extra += " -BaseDir `"$toolRoot`"" }
    $scratch = $DbName + "_before_code_ids"
    $restoreCmd = Join-Path $scriptDir "restore-taskmgr.cmd"
    Log "  되돌리는 법(비밀번호는 restore-taskmgr 가 따로 묻습니다):" 'Yellow'
    Log "  1) 먼저 별도 DB 로 되살려 내용을 확인합니다(라이브는 건드리지 않습니다):" 'Yellow'
    Log "     `"$restoreCmd`" -DumpPath `"$dumpPath`" -BackupDir `"$BackupDir`" -LiveDb $DbName -TargetDb $scratch$extra"
    Log "  2) 라이브 '$DbName' 자체를 이관 전으로 되돌리려면 대화형 콘솔에서 아래를 실행하고, 물으면 DB 이름 '$DbName' 을 그대로 입력합니다:" 'Yellow'
    Log "     `"$restoreCmd`" -DumpPath `"$dumpPath`" -BackupDir `"$BackupDir`" -LiveDb $DbName -TargetDb $DbName -OverwriteLive$extra"
    Log "     restore-taskmgr 가 지금 상태를 pre-restore 덤프로 먼저 남기고, DB 를 지운 뒤 다시 만들어 이 백업을 붓습니다(앱 계정 권한은 DB 를 지워도 남습니다)." 'Yellow'
    Log "  3) 1) 에서 만든 확인용 DB 는 다 본 뒤 지웁니다:" 'Yellow'
    Log "     `"$restoreCmd`" -BackupDir `"$BackupDir`" -LiveDb $DbName -TargetDb $scratch -DropTarget$extra"
    Log "  되돌린 DB 는 다시 v$fromVersion 입니다. 원인을 고친 뒤 이 도구를 다시 실행하세요." 'Yellow'
  }

  # ==========================================================================
  #  [2/3] 이관 SQL: --force 없이. 출력은 파일로 받아(UTF-8 그대로) 화면에 옮긴다
  # ==========================================================================
  Step 2 "이관 SQL"
  Info "적용: $MIGRATION_SQL (DB $DbName, --force 없음)"
  # 바이트를 그대로 흘려 넣고 출력도 바이트 그대로 파일로 받는다. PowerShell 이 끼면 인코딩이 두 번 해석된다.
  # 2>&1 은 cmd 안에서 처리되므로 PowerShell 5.1 의 NativeCommandError 포장이 생기지 않는다.
  cmd /c "`"$mysql`" --defaults-extra-file=`"$($script:cnfPath)`" --default-character-set=utf8mb4 -t `"$DbName`" < `"$sqlFile`" > `"$migLog`" 2>&1"
  $migRc = $LASTEXITCODE
  $migLines = @()
  try { $migLines = @([IO.File]::ReadAllLines($migLog, (New-Object System.Text.UTF8Encoding($false)))) } catch { Warn "이관 기록을 읽지 못했습니다: $migLog ($($_.Exception.Message))" }
  foreach($l in $migLines){ if("$l".Trim() -ne ""){ Log "      $l" } }
  Info "이관 기록: $migLog"

  # -t 표 출력에서 머리줄에 $first 가 있는 표의 '이름 = 값' 을 뽑는다(머리줄 다음의 첫 '|' 줄이 값이다).
  function TableValues($lines, [string]$first){
    $out = [ordered]@{}
    for($i = 0; $i -lt $lines.Count; $i++){
      $h = "$($lines[$i])"
      if(-not $h.StartsWith('|') -or $h -notmatch ("\|\s*" + [regex]::Escape($first) + "\s*\|")){ continue }
      for($j = $i + 1; $j -lt $lines.Count; $j++){
        $v = "$($lines[$j])"
        if(-not $v.StartsWith('|')){ continue }
        $names = @($h.Trim('|').Split('|') | ForEach-Object { $_.Trim() })
        $vals  = @($v.Trim('|').Split('|') | ForEach-Object { $_.Trim() })
        for($k = 0; $k -lt [math]::Min($names.Count, $vals.Count); $k++){ $out[$names[$k]] = $vals[$k] }
        return $out
      }
    }
    return $out
  }

  if($migRc -ne 0){
    # ========================================================================
    #  실패 판정: 출력 문구가 아니라 DB 상태로 가른다(출력이 잘려도 틀리지 않게)
    # ========================================================================
    Log ""
    Log "==== 이관 SQL 이 멈췄습니다(mysql 종료코드 $migRc) ====" 'Red'
    $why = @($migLines | Where-Object { "$_" -match '중단:|ERROR \d+' })
    foreach($w in $why){ Log "  이유: $w" 'Red' }
    if(@($migLines | Where-Object { "$_" -match 'ERROR 1205' }).Count -gt 0){
      Warn "ERROR 1205 는 다른 연결이 표를 잡고 있다는 뜻입니다. 이 DB 에 붙은 위젯을 모두 닫고 다시 실행하세요."
    }
    $verNow   = QTry $SQL_VERSION
    $colsNow  = QTry $SQL_OLD_COLS
    $pkNow    = QTry $SQL_OLD_PK
    $fkNow    = QTry $SQL_OLD_FK
    $intact = ($verNow -eq $fromVersion) -and ($colsNow -eq '4') -and ($pkNow -eq '4') -and ($fkNow -eq "$oldFkBefore")
    $schemaDone = ($verNow -eq $toVersion) -and (@($migLines | Where-Object { "$_" -match '완료: 코드표 넷이 번호 키다' }).Count -gt 0)
    if($intact){
      Log "  DB 상태: 판번호 $verNow, 옛 열 $colsNow/4, 이름 기본키 $pkNow/4, 이름 외래키 $fkNow (절단 전)" 'Yellow'
      Log "  옛 열은 그대로입니다. 메시지대로 데이터를 고친 뒤 다시 실행하세요." 'Yellow'
      Log "  (관문에서 멈췄다면 더한 번호 열만 남습니다. 다시 실행하면 번호를 처음부터 다시 매깁니다. 백업: $dumpPath)"
      Finish $EXIT_FAIL "중단: 이관 SQL 이 절단 전에 멈췄습니다(종료코드 $EXIT_FAIL). 옛 열과 키는 그대로입니다." 'Red'
    }
    if($schemaDone){
      Log "  DB 상태: 판번호 $verNow. 스키마 전환은 끝났고 마지막 단계(앱 계정의 안 쓰는 UPDATE 권한 회수)만 실패했습니다." 'Yellow'
      Log "  관리 계정으로 아래 세 줄을 실행하세요(권한이 없다는 오류가 나면 이미 없는 것이라 괜찮습니다):" 'Yellow'
      foreach($t in @('cal_entry_commit','cal_todo_day_note','cal_room')){
        Log "     REVOKE UPDATE ON $dbQ.$t FROM '$AppUser'@'%';"
      }
      Finish $EXIT_FAIL "중단: 권한 회수만 실패했습니다(종료코드 $EXIT_FAIL). 스키마는 v$toVersion 입니다. 위 세 줄을 실행한 뒤 0.21.0 앱을 설치하세요." 'Red'
    }
    Log "  DB 상태: 판번호 [$verNow], 옛 열 [$colsNow]/4, 이름 기본키 [$pkNow]/4, 이름 외래키 [$fkNow] (절단 뒤이거나 알 수 없음)" 'Red'
    Log "  옛 열을 지우는 단계 이후에 멈췄거나 상태를 확인할 수 없습니다. 이 DB 를 그대로 쓰지 말고 백업으로 되돌리세요." 'Red'
    RestoreHelp
    Finish $EXIT_FAIL "중단: 이관이 절단 뒤에 멈췄거나 상태를 알 수 없습니다(종료코드 $EXIT_FAIL). 위 순서대로 백업에서 되돌리세요." 'Red'
  }

  # ==========================================================================
  #  [3/3] 판정과 요약
  # ==========================================================================
  Step 3 "판정"
  $verAfter = QTry $SQL_VERSION
  if($verAfter -ne $toVersion){
    Log "  이관 SQL 은 0 으로 끝났는데 schema_version 이 [$verAfter] 입니다(기대 $toVersion)." 'Red'
    RestoreHelp
    Finish $EXIT_FAIL "중단: 판번호가 $toVersion 이 아닙니다(종료코드 $EXIT_FAIL). 위 순서대로 확인하고 되돌리세요." 'Red'
  }
  Ok "schema_version = $verAfter"

  $gateBad = $false
  foreach($g in @(@('사전 점검', 'customer_empty_name'), @('절단 관문', 'cut_parent'), @('사후 검증', 'e1_orphan'))){
    $vals = TableValues $migLines $g[1]
    if($vals.Count -lt 1){ Warn "$($g[0]) 표를 이관 기록에서 찾지 못했습니다($($g[1])). 기록 파일을 직접 보세요: $migLog"; continue }
    $pairs = @($vals.Keys | ForEach-Object { "$_=$($vals[$_])" })
    $nonZero = @($vals.Keys | Where-Object { "$($vals[$_])" -ne '0' })
    if($nonZero.Count -gt 0){ $gateBad = $true; Log ("  {0}: {1}" -f $g[0], ($pairs -join ', ')) 'Red' }
    else { Ok ("{0} 전부 0: {1}" -f $g[0], ($pairs -join ', ')) }
  }
  if($gateBad){
    RestoreHelp
    Finish $EXIT_FAIL "중단: 관문 값이 0 이 아닌데 이관 SQL 이 멈추지 않았습니다(종료코드 $EXIT_FAIL). 기록을 확인하고 되돌리세요." 'Red'
  }
  foreach($l in @($migLines | Where-Object { "$_" -match '알림: 숨겨져 있던 보호 행' })){ Warn "보호 행을 다시 켰습니다: $("$l".Trim())" }

  $countsAfter = [ordered]@{}
  foreach($t in $COUNT_TABLES){
    $c = QTry "SELECT COUNT(*) FROM $dbQ.$(BQ $t);"
    $countsAfter[$t] = $c
    if("$c" -ne "$($countsBefore[$t])"){ Warn "$t 행 수가 이관 전 $($countsBefore[$t]) 에서 지금 [$c] 입니다(이관 SQL 은 이 표의 행을 바꾸지 않습니다. 이관 중에 다른 연결이 썼을 수 있습니다)." }
  }

  Log ""
  Log "  DB           : $DbName"
  Log "  판번호       : $verBefore 에서 $verAfter"
  foreach($t in $COUNT_TABLES){ Log ("  행 수 {0,-8}: {1} (이관 전 {2})" -f $t, $countsAfter[$t], $countsBefore[$t]) }
  Log "  백업         : $dumpPath"
  Log "  이관 기록    : $migLog"
  Log ""
  Log "  다음 단계: 이제 0.21.0 앱을 설치하세요. 0.19.x 와 0.20.0 앱은 이 DB 에 붙지 않습니다." 'Cyan'
  Finish $EXIT_OK "완료: '$DbName' 이 v$verAfter 입니다(종료코드 $EXIT_OK)." 'Green'
} finally {
  # exit(Finish) 로 끝나도 finally 는 돈다. Cleanup 은 두 번 불려도 안전하다.
  Cleanup
}
