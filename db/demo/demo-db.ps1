<#
  demo-db.ps1: 사용 설명 영상(GitHub 이슈 #13)을 찍을 때 로컬 DB 를 데모 데이터로 바꾸고, 끝나면 원래대로 되돌리는 도구.
  보통은 demo-db.cmd 로 실행한다. 자세한 설명은 db/demo/README.md.

  세 가지 일(하나만 고른다. 아무것도 안 주면 -Status)
    -Load     지금 DB 를 통째로 백업한 뒤 데모 데이터를 넣는다.
    -Restore  -Load 가 뜬 백업으로 DB 를 지우고 다시 만든다. 행 수가 -Load 때 센 것과 같아야 통과다.
    -Status   지금 DB 에 데모 데이터가 들어 있는지 보여 준다(읽기만 한다).

  무엇이 바뀌나(-Load)
    app_user: 녹화 계정은 name 도 login_id 도 그대로(앱이 그 login_id 로 로그인돼 있고 세션 파일에 실제 이름이 남아 있다).
              나머지 사람은 name 과 login_id 를 가상 명단(demo-data.mjs)으로. user_id, 소속, 직급, 권한, 재직 여부, 순서는 그대로.
    customer, project: 전부 지우고 '(예시)' 로 시작하는 발주처 5개, 공식 과제 8개로.
    cal_*: 사용자 데이터를 전부 지우고 녹화 계정과 동료 셋(김철수, 이영희, 박민수)에게 지난달과 이번 달 데이터를 만든다.
           cal_user_rev 는 지우지 않고 모두 하나씩 올린다. cal_schema_meta 는 그대로(13).
    그대로: org_unit, title_code, section_code, status_code, MySQL 계정과 권한(이 도구는 GRANT, CREATE USER 를 내지 않는다).

  녹화 계정을 고르는 법
    -MyLoginId 를 주면 그것을 쓴다. 안 주면 이 PC 위젯의 세션 파일(%APPDATA%\TaskCalendar\user.session, DPAPI CurrentUser)을
    풀어 loginId 를 읽는다(widget/UserSession.cs 와 같은 형식). 못 읽으면 -MyLoginId 를 달라고 하고 멈춘다.
    그 login_id 로 app_user 에서 정확히 한 사람이 나와야 한다.

  단계(화면에 [n/3] 으로 찍힌다. 첫 실패에서 멈춘다)
    -Load
      [0] 사전 점검: mysql.exe, mysqldump.exe, node.exe, 생성기, 접속, DB, db_structure_version 17, 녹화 계정, 이미 데모인지,
          앱 계정(taskmgr_app) 세션(-Force 면 건너뜀), 표별 행 수. 그다음 Y 를 받는다(-Yes 면 묻지 않는다).
      [1] 백업: mysqldump(--single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF --no-tablespaces,
          --databases 없음)를 <OutDir>\<DbName>-before-demo-<시각>.sql 로 뜨고 끝의 '-- Dump completed' 를 확인한다.
          표별 행 수는 같은 이름 뒤에 .counts.json 으로, 어느 백업으로 되돌릴지는 <OutDir>\<DbName>-demo-marker.json 에 적는다.
      [2] 데모 SQL: node build-demo-sql.mjs 로 <OutDir>\<DbName>-demo-load-<시각>.sql 을 만들고 --force 없이 붓는다.
          SQL 안의 가드가 틀리면 COMMIT 전에 멈추고 트랜잭션은 되돌려진다.
      [3] 확인: 녹화 계정 이름과 login_id 불변, 사람 수, 조직과 직급 행 수, 발주처와 공식 과제, 캘린더 행, 판번호.
    -Restore
      [0] 사전 점검: 도구, 접속, 백업 고르기(-DumpPath, 없으면 표지 파일, 그것도 없으면 가장 최근 before-demo 백업),
          백업 끝의 '-- Dump completed', CREATE DATABASE 나 USE 가 없는지, .counts.json, 지금 DB 가 데모인지, 세션.
      [1] 안전 덤프: 지금 상태(데모)를 <OutDir>\<DbName>-before-restore-<시각>.sql 로 먼저 남긴다.
      [2] 되살리기: DROP DATABASE, CREATE DATABASE(백업 때의 문자셋과 정렬 규칙, 기본 utf8mb4_0900_ai_ci), 백업 붓기.
          표 단위 권한(mysql.tables_priv)은 DB 를 지워도 남으므로 앱 계정은 그대로 붙는다.
      [3] 확인: db_structure_version 17, 표 이름 집합과 표별 행 수가 .counts.json 과 같아야 통과. 표지 파일은 -restored- 이름으로 옮긴다.

  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
    0 ok - demo data loaded and verified, the DB was restored and verified, or the status was shown
    1 failed - the demo SQL or the restore stopped, or the check afterwards failed; read the printed state and steps
    2 cancelled - the confirmation was not Y; nothing was changed
    3 precheck failed - tools, password, connection, DB, db_structure_version not 17, recording login, demo state or backup file; nothing was changed
    4 app sessions open - the app account is still connected to this DB; close every widget; nothing was changed
    5 backup failed - mysqldump failed or the dump is incomplete; the DB was not touched
  --- END EXITCODES ---

  ⚠️ 데모 데이터가 들어 있는 동안 이 PC 의 DB 는 모든 세션과 루프에게 데모 데이터다. 녹화하는 동안 다른 세션이
     위젯 루프(tests/loop-*.mjs, run-loops)를 돌리면 안 된다. 끝나면 꼭 -Restore 한다.

  ⚠️ 비밀번호: 인자로 받지 않는다(같은 사용자의 다른 프로세스가 명령줄을 읽는다. restore-taskmgr.ps1 머리말의 실측).
     순서: (1) 환경변수 TASKMGR_ADMIN_PW, (2) 입력이 리다이렉트돼 있으면 stdin 첫 줄(상한 10초), (3) 대화형이면 가려진 입력.
     mysql 과 mysqldump 에는 임시 .cnf(--defaults-extra-file)로만 넘기고, 어떻게 끝나든 finally 에서 지운다.

  ⚠️ 인자 값을 역슬래시로 끝내지 말 것(-OutDir "D:\x\" 등). powershell.exe 가 \" 를 이스케이프된 따옴표로 읽어
     뒤 인자를 삼킨다. AssertNoSwallow 가 그 상태를 감지하면 멈춘다.

  창 닫힘: .cmd 로 띄우면(TC_DEMO_DB_LAUNCHER=cmd) 실패는 .cmd 가, 성공은 이 스크립트가 멈춰 준다(-Yes 면 성공은 안 멈춤).
     ps1 을 직접 실행하면 종료코드와 무관하게 늘 엔터를 기다린다. stdin 이 리다이렉트된 무인 실행은 멈추지 않는다.

  예)  demo-db.cmd -Status
       demo-db.cmd -Load                          (세션 파일에서 녹화 계정을 읽는다)
       demo-db.cmd -Load -MyLoginId <로그인 ID> -BaseDate 2026-10-19
       demo-db.cmd -Restore
       demo-db.cmd -Restore -DumpPath "<저장소>\dist\demo-db\taskcalendar-before-demo-20261019-101500.sql"
       무인 실행(입력이 리다이렉트되면 -Yes 가 꼭 있어야 한다. 비밀번호 자리는 예시용 자리표시다):
         set TASKMGR_ADMIN_PW=<관리자 비밀번호>  그다음  demo-db.cmd -Load -Yes
#>
[CmdletBinding()]
param(
  [switch]$Load,                        # 백업 뒤 데모 데이터 넣기
  [switch]$Restore,                     # before-demo 백업으로 되돌리기
  [switch]$Status,                      # 지금 상태 보기(읽기만)
  [string]$MyLoginId = "",              # 녹화 계정 login_id(비우면 위젯 세션 파일에서 읽는다)
  [string]$BaseDate = "",               # 데모 일정의 기준 날짜 YYYY-MM-DD(비우면 오늘)
  [string]$DumpPath = "",               # -Restore 에 쓸 백업(비우면 표지 파일, 그다음 가장 최근 before-demo 백업)
  [string]$DbName = "taskcalendar",     # 대상 DB
  [string]$DbHost = "127.0.0.1",        # MySQL 호스트
  [int]$Port = 3306,
  [string]$BaseDir = "C:\mysql",        # mysql.exe 위치(없으면 서비스 binPath, 그다음 기본 설치 경로)
  [string]$ServiceName = "MySQL84",
  [string]$DbUser = "root",             # 관리 계정
  [string]$AppUser = "taskmgr_app",     # 세션을 세는 앱 계정(위젯이 붙는 계정)
  [string]$OutDir = "",                 # 비우면 <저장소>\dist\demo-db
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
$EXIT_PRECHECK  = 3
$EXIT_BUSY      = 4
$EXIT_BACKUP    = 5

$ADMIN_PW_ENV   = "TASKMGR_ADMIN_PW"   # 무인 실행 자격(restore-taskmgr.ps1, migrate-code-ids.ps1 과 같은 이름)
$STDIN_WAIT_SEC = 10                   # stdin 첫 줄 읽기 상한(초)
$DEFAULT_MYSQL_DIR = "C:\Program Files\MySQL\MySQL Server 8.4"
$SCHEMA_VERSION = "17"   # cal_schema_meta.db_structure_version(2026-10-21 부터, 옛 키 schema_version)
$DEFAULT_COLLATION = "utf8mb4_0900_ai_ci"
$GENERATOR      = "build-demo-sql.mjs"
$LOGIN_RE       = '^[A-Za-z0-9._@-]{1,50}$'   # build-demo-sql.mjs 의 LOGIN_RE 와 같다
$DEMO_PREFIX    = "(예시)"
# mysqldump 의 GTID 옵션. 비밀번호 명령줄 검사(tests/ps-guard-lib.mjs)가 '-p...' 를 비번으로 보므로 이름을 둘로 나눠 적는다.
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
  if(-not $dir){ $dir = $env:TEMP }   # 기록 폴더를 잡기 전에 끝나면 TEMP 로(저장소 폴더에 보고서를 흘리지 않는다)
  $p = Join-Path $dir ("demo-db-" + $script:ts + $suffix + ".txt")
  try {
    Write-Host "[*] 보고서: $p"
    $script:logLines.Add("[*] 보고서: $p")
    [IO.File]::WriteAllLines($p, $script:logLines.ToArray(), (New-Object System.Text.UTF8Encoding($true)))
  } catch { Write-Host "[!] 보고서를 쓰지 못했습니다: $p ($($_.Exception.Message))" -ForegroundColor Yellow }
}
# 모든 종료가 이 한 곳을 지난다. 보고서를 남기고, 비밀번호가 든 임시 .cnf 를 지우고, 코드를 낸다.
function Finish($code, [string]$lastLine, [string]$color){
  Log $lastLine $color
  if($code -eq $EXIT_OK){ SaveReport "" } else { SaveReport "-FAILED" }
  Cleanup
  $pause = $false
  if([Console]::IsInputRedirected){ $pause = $false }
  elseif($env:TC_DEMO_DB_LAUNCHER -ne 'cmd'){ $pause = $true }
  elseif($code -eq $EXIT_OK -and -not $Yes){ $pause = $true }
  if($pause){
    try { Read-Host "엔터를 누르면 종료" | Out-Null } catch {}
  }
  exit $code
}
# 사전 점검 실패: DB 에 아무것도 하지 않은 상태에서만 부른다.
function DiePre([string]$m){
  Log "[사전 점검 실패] $m" 'Red'
  Finish $EXIT_PRECHECK "중단: 사전 점검 실패(종료코드 $EXIT_PRECHECK). 아무것도 바꾸지 않았습니다." 'Red'
}

# ============================================================================
#  인자 검증
# ============================================================================
$SWALLOW_FLAGS = '\s-(Load|Restore|Status|MyLoginId|BaseDate|DumpPath|DbName|DbHost|Port|BaseDir|ServiceName|DbUser|AppUser|OutDir|Yes|Force)\b'
function AssertNoSwallow($label, $val){
  if("$val" -match '"'){ DiePre "$label 값에 따옴표가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태입니다. 경로 끝의 역슬래시를 빼고 다시 실행하세요." }
  if("$val" -match $SWALLOW_FLAGS){ DiePre "$label 값 안에 다른 인자가 들어 있습니다: [$val]. 경로 끝의 역슬래시를 빼고 다시 실행하세요." }
}

$modeCount = @(@($Load.IsPresent, $Restore.IsPresent, $Status.IsPresent) | Where-Object { $_ }).Count
$mode = 'Status'
if($Load){ $mode = 'Load' } elseif($Restore){ $mode = 'Restore' }

Log "=================================================="
Log "   데모 DB 도구($mode): $DbName"
Log "   서버: $DbHost`:$Port"
Log "=================================================="

Step 0 "사전 점검"
if($modeCount -gt 1){ DiePre "-Load, -Restore, -Status 중 하나만 주세요." }
AssertNoSwallow "-MyLoginId"   $MyLoginId
AssertNoSwallow "-BaseDate"    $BaseDate
AssertNoSwallow "-DumpPath"    $DumpPath
AssertNoSwallow "-DbName"      $DbName
AssertNoSwallow "-DbHost"      $DbHost
AssertNoSwallow "-BaseDir"     $BaseDir
AssertNoSwallow "-ServiceName" $ServiceName
AssertNoSwallow "-DbUser"      $DbUser
AssertNoSwallow "-AppUser"     $AppUser
AssertNoSwallow "-OutDir"      $OutDir

function FullPath([string]$p){
  if(-not [IO.Path]::IsPathRooted($p)){ $p = Join-Path (Get-Location).ProviderPath $p }
  return [IO.Path]::GetFullPath($p)
}
$scriptDir = Split-Path -Parent $PSCommandPath
if(-not $OutDir){ $OutDir = Join-Path $scriptDir "..\..\dist\demo-db" }
$OutDir = FullPath $OutDir
if(-not (Test-Path -LiteralPath $OutDir)){ try { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null } catch {} }
if(Test-Path -LiteralPath $OutDir -PathType Container){ $script:reportDir = $OutDir }
# 아래 값들은 SQL 문자열과 식별자에 그대로 들어간다. 여기 통과가 곧 그 자리의 안전 조건이다.
if($DbName -notmatch '^[A-Za-z0-9_]+$'){ DiePre "-DbName 이 식별자 형식이 아닙니다: [$DbName]" }
if($DbUser -notmatch '^[A-Za-z0-9_.$-]+$'){ DiePre "-DbUser 가 식별자 형식이 아닙니다: [$DbUser]" }
if($AppUser -notmatch '^[A-Za-z0-9_.$-]+$'){ DiePre "-AppUser 가 식별자 형식이 아닙니다: [$AppUser]" }
if($DbHost -notmatch '^[A-Za-z0-9_.:-]+$'){ DiePre "-DbHost 형식이 이상합니다: [$DbHost]" }
if($Port -lt 1 -or $Port -gt 65535){ DiePre "-Port 범위가 아닙니다: $Port" }
if(-not $script:reportDir){ DiePre "기록 폴더를 만들지 못했습니다: $OutDir" }
Ok "기록 폴더: $OutDir"

# 글을 UTF-8 16진으로. mysql -e 에는 ASCII 만 싣는다(명령줄 코드페이지를 거치며 한글이 깨지지 않게).
function Utf8Hex([string]$s){ return (([Text.Encoding]::UTF8.GetBytes($s) | ForEach-Object { $_.ToString('X2') }) -join '') }
function HexStr([string]$s){ return "CONVERT(X'" + (Utf8Hex $s) + "' USING utf8mb4)" }
# mysql 이 낸 HEX() 값을 글로(화면에 이름을 그대로 보이려고). 모양이 틀리면 16진 그대로 둔다.
function FromUtf8Hex([string]$h){
  if("$h" -notmatch '^([0-9A-Fa-f]{2})*$'){ return "$h" }
  $b = New-Object byte[] ($h.Length / 2)
  for($i = 0; $i -lt $b.Length; $i++){ $b[$i] = [Convert]::ToByte($h.Substring($i * 2, 2), 16) }
  return [Text.Encoding]::UTF8.GetString($b)
}
$PREFIX_LIKE = "CONCAT(" + (HexStr $DEMO_PREFIX) + ", '%')"

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

# --- -Load 전용: node.exe, 생성기, 기준 날짜, 녹화 계정 ---
$node = $null
$genPath = Join-Path $scriptDir $GENERATOR
if($mode -eq 'Load'){
  $cmdNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if($cmdNode){ $node = $cmdNode.Source }
  elseif(Test-Path -LiteralPath (Join-Path $env:ProgramFiles "nodejs\node.exe")){ $node = Join-Path $env:ProgramFiles "nodejs\node.exe" }
  if(-not $node){ DiePre "node.exe 를 못 찾았습니다. Node.js 를 설치하거나 PATH 에 넣으세요(데모 SQL 생성기가 씁니다)." }
  if(-not (Test-Path -LiteralPath $genPath -PathType Leaf)){ DiePre "생성기가 없습니다: $genPath" }
  Ok "생성기: $node $genPath"
  if(-not $BaseDate){ $BaseDate = Get-Date -Format 'yyyy-MM-dd' }
  $bd = [DateTime]::MinValue
  if($BaseDate -notmatch '^\d{4}-\d{2}-\d{2}$' -or -not [DateTime]::TryParseExact($BaseDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$bd)){
    DiePre "-BaseDate 는 YYYY-MM-DD 여야 합니다: [$BaseDate]"
  }
  Ok "기준 날짜: $BaseDate (지난달 1일부터 이번 달 말일까지 일정을 만든다)"
}

# 위젯 세션 파일에서 loginId 를 읽는다(widget/UserSession.cs: JSON, UTF-8, DPAPI CurrentUser, Base64). 못 읽으면 이유를 돌려준다.
function ReadSessionLoginId(){
  $p = Join-Path $env:APPDATA "TaskCalendar\user.session"
  if(-not (Test-Path -LiteralPath $p -PathType Leaf)){ return @{ Login = $null; Why = "세션 파일이 없습니다: $p" } }
  try {
    Add-Type -AssemblyName System.Security
    $b64 = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8).Trim()
    $raw = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($b64), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $o = [Text.Encoding]::UTF8.GetString($raw) | ConvertFrom-Json
    $id = "$($o.loginId)".Trim()
    if(-not $id){ return @{ Login = $null; Why = "세션 파일에 loginId 가 없습니다: $p" } }
    return @{ Login = $id; Why = "" }
  } catch { return @{ Login = $null; Why = "세션 파일을 풀지 못했습니다($p): $($_.Exception.Message)" } }
}
if($mode -eq 'Load' -or ($mode -eq 'Status' -and $MyLoginId)){
  if(-not $MyLoginId -and $mode -eq 'Load'){
    $sess = ReadSessionLoginId
    if(-not $sess.Login){ DiePre "$($sess.Why). 녹화 계정의 login_id 를 -MyLoginId 로 주세요." }
    $MyLoginId = $sess.Login
    Ok "녹화 계정 login_id: 위젯 세션 파일에서 읽었습니다($MyLoginId)."
  }
  if($MyLoginId -notmatch $LOGIN_RE){ DiePre "-MyLoginId 가 login_id 모양이 아닙니다(영문, 숫자, . _ @ - 1~50자): [$MyLoginId]" }
}

# 무인 실행(입력 리다이렉트)에서는 확인 질문에 답할 사람이 없다. 바꾸는 일에는 -Yes 를 요구한다.
if($mode -ne 'Status' -and [Console]::IsInputRedirected -and -not $Yes){ DiePre "입력이 리다이렉트된 무인 실행에서는 확인(Y)을 받을 수 없습니다. -Yes 를 함께 주세요." }

# --- 관리자 비밀번호: 환경변수, stdin 첫 줄(상한), 가려진 입력 순서 ---
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
  $pwEsc = ($adminPw -replace '\\','\\') -replace '"','\"'
  $adminPw = $null
  $script:cnfPath = Join-Path $env:TEMP ("mydemo_" + [IO.Path]::GetRandomFileName() + ".cnf")
  $cnfText = "[client]`r`nuser=$DbUser`r`npassword=""$pwEsc""`r`nhost=$DbHost`r`nport=$Port`r`ndefault-character-set=utf8mb4`r`n"
  [IO.File]::WriteAllText($script:cnfPath, $cnfText, (New-Object System.Text.UTF8Encoding($false)))
  $pwEsc = $null

  function BQ([string]$n){ return ('`' + $n + '`') }
  $dbQ = BQ $DbName

  function QTry([string]$sql){
    $o = & $mysql "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql
    if($LASTEXITCODE -ne 0){ return $null }
    if($null -eq $o){ return "" }
    return ((@($o) -join "`n").Trim())
  }
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

  # 표별 정확한 행 수(이름 순). 실패하면 $null.
  function TableCounts(){
    $t = QRowsTry "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '$DbName' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME;"
    if(-not $t.Ok){ return $null }
    $names = @($t.Rows)
    $res = [ordered]@{}
    if($names.Count -eq 0){ return $res }
    foreach($n in $names){ if($n -notmatch '^[A-Za-z0-9_]+$'){ return $null } }
    $parts = @($names | ForEach-Object { "SELECT '$_', COUNT(*) FROM $dbQ.$(BQ $_)" })
    $c = QRowsTry (($parts -join " UNION ALL ") + ";")
    if(-not $c.Ok){ return $null }
    foreach($row in @($c.Rows)){ $f = "$row".Split("`t"); if($f.Count -ge 2){ $res[$f[0]] = [long]$f[1] } }
    if($res.Count -ne $names.Count){ return $null }
    return $res
  }
  # 데모 상태: 공식 과제와 발주처 중 '(예시)' 로 시작하는 것의 수
  function DemoState(){
    $v = QTry "SELECT (SELECT COUNT(*) FROM $dbQ.project), (SELECT COUNT(*) FROM $dbQ.project WHERE common_name LIKE $PREFIX_LIKE), (SELECT COUNT(*) FROM $dbQ.customer), (SELECT COUNT(*) FROM $dbQ.customer WHERE name LIKE $PREFIX_LIKE);"
    if($null -eq $v){ return $null }
    $f = "$v".Split("`t")
    if($f.Count -lt 4){ return $null }
    $s = @{ Projects = [int]$f[0]; DemoProjects = [int]$f[1]; Customers = [int]$f[2]; DemoCustomers = [int]$f[3] }
    $s.IsDemo = ($s.Projects -gt 0 -and $s.Projects -eq $s.DemoProjects -and $s.Customers -eq $s.DemoCustomers)
    $s.IsReal = ($s.DemoProjects -eq 0 -and $s.DemoCustomers -eq 0)
    return $s
  }
  function SessionCount(){
    $s = QRowsTry "SELECT ID, USER, HOST, IFNULL(DB,''), COMMAND, TIME FROM information_schema.PROCESSLIST WHERE USER = '$AppUser' AND DB = '$DbName' ORDER BY ID;"
    return $s
  }
  function CheckSessions(){
    if($Force){ Warn "-Force: 앱 계정($AppUser) 세션 확인을 건너뜁니다. 위젯이 열려 있으면 낡은 화면이 저장하다 충돌합니다."; return }
    $sessRes = SessionCount
    if(-not $sessRes.Ok){ DiePre "접속 목록(information_schema.PROCESSLIST)을 읽지 못했습니다. 관리 계정에 PROCESS 권한이 있는지 확인하세요." }
    $sessions = @($sessRes.Rows)
    if($sessions.Count -gt 0){
      Log "  앱 계정 '$AppUser' 이 '$DbName' 에 $($sessions.Count)개 붙어 있습니다(ID, 계정, 호스트, DB, 상태, 초):" 'Red'
      foreach($s in $sessions){ Log ("    " + ($s -replace "`t", ", ")) 'Red' }
      Finish $EXIT_BUSY "중단: 이 DB 에 붙은 위젯을 모두 닫은 뒤 다시 실행하세요(종료코드 $EXIT_BUSY). 아무것도 바꾸지 않았습니다." 'Red'
    }
    Ok "앱 계정 '$AppUser' 세션: 0"
  }
  # mysqldump 로 DB 를 뜨고 검증한다. 검증 전에는 .partial 이름으로 둔다. 실패면 이유 글, 성공이면 "".
  function DumpDb([string]$path){
    $part = $path + ".partial"
    Info "mysqldump $DbName"
    & $mysqldump "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "--single-transaction" "--no-tablespaces" "--routines" "--triggers" "--events" "--hex-blob" $GTID_PURGED_OFF "--result-file=$part" $DbName
    $rc = $LASTEXITCODE
    if($rc -ne 0){ return "mysqldump 가 코드 $rc 로 실패했습니다" }
    if(-not (Test-Path -LiteralPath $part -PathType Leaf)){ return "mysqldump 가 성공했다는데 백업 파일이 없습니다" }
    $size = (Get-Item -LiteralPath $part).Length
    if($size -le 1024){ return "백업 파일이 1KB 이하입니다($size B)" }
    if(-not (DumpCompleted $part)){ return "백업 파일 끝에 '-- Dump completed' 가 없습니다: $part" }
    Move-Item -LiteralPath $part -Destination $path -Force
    if(-not (Test-Path -LiteralPath $path -PathType Leaf)){ return "검증한 백업의 이름을 바꾸지 못했습니다: $part" }
    Ok ("백업 완료: {0} ({1:N1} KB, '-- Dump completed' 확인)" -f $path, ($size / 1KB))
    return ""
  }
  function DumpCompleted([string]$path){
    $tail = @(Get-Content -LiteralPath $path -Tail 5 -Encoding UTF8)
    foreach($l in $tail){ if("$l".StartsWith("-- Dump completed")){ return $true } }
    return $false
  }
  function WriteJson([string]$path, $obj){
    [IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
  }
  function ReadJson([string]$path){
    try { return ([IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) | ConvertFrom-Json) } catch { return $null }
  }
  $markerPath = Join-Path $OutDir "$DbName-demo-marker.json"
  function SetMarkerState([string]$state){
    $m = ReadJson $markerPath
    if($null -eq $m){ return }
    $m.state = $state
    try { WriteJson $markerPath $m } catch { Warn "표지 파일을 고치지 못했습니다: $markerPath ($($_.Exception.Message))" }
  }
  function RestoreHint(){
    $cmdPath = Join-Path $scriptDir "demo-db.cmd"
    $extra = ""
    if($DbName -ne "taskcalendar"){ $extra += " -DbName $DbName" }
    if($DbHost -ne "127.0.0.1"){ $extra += " -DbHost $DbHost" }
    if($Port -ne 3306){ $extra += " -Port $Port" }
    if($toolRoot -ne "C:\mysql"){ $extra += " -BaseDir `"$toolRoot`"" }
    return "`"$cmdPath`" -Restore$extra"
  }

  # --- 접속, DB ---
  $serverVer = QTry "SELECT VERSION();"
  if($null -eq $serverVer){ DiePre "MySQL 에 접속하지 못했습니다($DbUser@$DbHost`:$Port). 위 mysql 오류(비밀번호, 서비스 실행 여부)를 확인하세요." }
  Ok "접속: MySQL $serverVer"
  $dbExists = [int](QPre "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$DbName';" "DB 유무") -ge 1
  $marker = $null
  if(Test-Path -LiteralPath $markerPath -PathType Leaf){ $marker = ReadJson $markerPath }

  # ==========================================================================
  #  -Status: 읽기만 한다
  # ==========================================================================
  if($mode -eq 'Status'){
    if(-not $dbExists){
      if($marker){ Warn "표지 파일이 있습니다(상태 $($marker.state)). 되살리기 도중 멈췄을 수 있습니다. -Restore 를 다시 실행하세요." }
      DiePre "DB '$DbName' 가 없습니다."
    }
    $ver = QTry "SELECT v FROM $dbQ.cal_schema_meta WHERE k = 'db_structure_version';"
    if($null -eq $ver){ $ver = "(알 수 없음)" }
    Log "  구조 번호      : $ver"
    $st = DemoState
    if($null -eq $st){ DiePre "project, customer 질의가 실패했습니다. 이 도구가 아는 DB 가 아닙니다." }
    Log "  공식 과제      : $($st.Projects)개 중 '(예시)' 로 시작하는 것 $($st.DemoProjects)개"
    Log "  발주처         : $($st.Customers)개 중 '(예시)' 로 시작하는 것 $($st.DemoCustomers)개"
    if($MyLoginId){
      $who = QTry "SELECT HEX(name), view_scope FROM $dbQ.app_user WHERE login_id = $(HexStr $MyLoginId) COLLATE utf8mb4_0900_ai_ci;"
      if($who){
        $f = "$who".Split("`t")
        Log "  녹화 계정      : $MyLoginId, 이름 $(FromUtf8Hex $f[0]), 열람 범위 $($f[1])"
      } else { Warn "login_id $MyLoginId 인 사람이 없습니다." }
    }
    $sessRes = SessionCount
    if($sessRes.Ok){ Log "  앱 계정 세션   : $(@($sessRes.Rows).Count)" }
    if($marker){
      Log "  표지 파일      : $markerPath"
      Log "    상태 $($marker.state), 넣은 때 $($marker.loadedAt), 기준 날짜 $($marker.baseDate)"
      Log "    되돌릴 백업 $($marker.dumpPath)"
    } else { Log "  표지 파일      : 없음" }
    if($st.IsDemo){ $verdict = "데모 데이터가 들어 있습니다. 녹화가 끝나면 -Restore 로 되돌리세요."; $color = 'Yellow' }
    elseif($st.IsReal){ $verdict = "실데이터입니다(데모 데이터가 없습니다)."; $color = 'Green' }
    else { $verdict = "데모와 실데이터가 섞여 있습니다. 공식 과제나 발주처를 손으로 고쳤을 수 있습니다."; $color = 'Yellow' }
    Log ""
    Finish $EXIT_OK "상태: $verdict" $color
  }

  # ==========================================================================
  #  -Load
  # ==========================================================================
  if($mode -eq 'Load'){
    if(-not $dbExists){ DiePre "DB '$DbName' 가 없습니다. -DbName 을 확인하세요." }
    $ver = QPre "SELECT IFNULL((SELECT v FROM $dbQ.cal_schema_meta WHERE k = 'db_structure_version'), '');" "db_structure_version"
    if($ver -ne $SCHEMA_VERSION){ DiePre "'$DbName' 의 db_structure_version 이 $SCHEMA_VERSION 이 아닙니다([$ver]). 이 도구는 v$SCHEMA_VERSION DB 만 다룹니다." }
    Ok "db_structure_version = $ver"
    if($marker){ DiePre "이미 데모 데이터를 넣은 표지가 있습니다(상태 $($marker.state), $markerPath). 먼저 -Restore 로 되돌리세요. 두 번 넣으면 백업이 데모 데이터가 됩니다." }
    $st = DemoState
    if($null -eq $st){ DiePre "project, customer 질의가 실패했습니다." }
    if($st.DemoProjects -gt 0 -or $st.DemoCustomers -gt 0){ DiePre "DB 에 이미 '(예시)' 로 시작하는 공식 과제 $($st.DemoProjects)개, 발주처 $($st.DemoCustomers)개가 있습니다. 데모 데이터가 남아 있는 DB 를 백업하면 되돌릴 실데이터가 없습니다. 원래 백업으로 되돌린 뒤 다시 하세요." }
    $me = QPre "SELECT COUNT(*), IFNULL(MIN(user_id),''), IFNULL(MIN(HEX(name)),''), IFNULL(MIN(HEX(login_id)),''), IFNULL(MIN(view_scope),'') FROM $dbQ.app_user WHERE login_id = $(HexStr $MyLoginId) COLLATE utf8mb4_0900_ai_ci;" "녹화 계정"
    $mf = "$me".Split("`t")
    if($mf[0] -ne '1'){ DiePre "login_id '$MyLoginId' 인 사람이 app_user 에 정확히 한 명이 아닙니다($($mf[0])명). -MyLoginId 를 확인하세요." }
    $meId = $mf[1]; $meNameHex = $mf[2]; $meLoginHex = $mf[3]; $meScope = $mf[4]
    $meName = FromUtf8Hex $meNameHex
    Ok "녹화 계정: user_id $meId, 이름 $meName (이름과 login_id 는 그대로 둡니다)"
    if($meScope -eq 'self'){ Warn "녹화 계정의 열람 범위가 self 입니다. 다른 사람 일정(겹쳐 보기, 나란히 보기)을 보려면 scope-all.cmd 나 관리 화면으로 넓히세요." }
    $others = [int](QPre "SELECT COUNT(*) FROM $dbQ.app_user WHERE user_id <> $meId AND is_active = 1;" "재직 인원")
    if($others -lt 3){ DiePre "재직 중인 다른 사람이 $others 명입니다. 동료 셋(김철수, 이영희, 박민수)에게 데이터를 만들 수 없습니다." }
    CheckSessions
    $countsBefore = TableCounts
    if($null -eq $countsBefore){ DiePre "표별 행 수를 세지 못했습니다." }
    $schemaRow = QPre "SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$DbName';" "DB 문자셋"
    $sf = "$schemaRow".Split("`t")
    $dbCharset = "$($sf[0])"; $dbCollation = "$($sf[1])"
    $dumpPath  = Join-Path $OutDir ("$DbName-before-demo-" + $script:ts + ".sql")
    $countsPath = $dumpPath + ".counts.json"
    $sqlPath   = Join-Path $OutDir ("$DbName-demo-load-" + $script:ts + ".sql")
    $loadLog   = Join-Path $OutDir ("$DbName-demo-load-" + $script:ts + ".log")
    Log ""
    Log "  DB         : $DbName  (서버 $DbHost`:$Port, $dbCharset / $dbCollation)"
    Log "  사람       : $($countsBefore['app_user'])명. 녹화 계정($meName)은 이름과 login_id 그대로, 나머지는 가상 이름과 login_id 로 바뀝니다."
    Log "  공식 과제  : $($st.Projects)개, 발주처 $($st.Customers)개를 지우고 '(예시)' 과제 8개, 발주처 5개로 바꿉니다."
    Log "  캘린더     : cal_* 사용자 데이터를 지우고 녹화 계정과 동료 셋에게 지난달, 이번 달 데이터를 만듭니다."
    Log "  백업       : $dumpPath"
    Log "  데모 데이터가 들어 있는 동안 이 PC 의 DB 는 모든 세션과 루프에게 데모 데이터입니다. 다른 세션의 위젯 루프를 멈추세요." 'Yellow'
    if(-not $Yes){
      $a = Read-Host "계속하려면 Y"
      if("$a".Trim() -ne 'Y'){ Finish $EXIT_CANCEL "취소했습니다. 아무것도 바꾸지 않았습니다(종료코드 $EXIT_CANCEL)." 'White' }
    }

    # ------------------------------------------------------------------------
    #  [1/3] 백업: 데모 SQL 보다 반드시 먼저, 검증까지 통과해야 다음으로 간다
    # ------------------------------------------------------------------------
    Step 1 "백업"
    $why = DumpDb $dumpPath
    if($why){ Finish $EXIT_BACKUP "중단: $why (종료코드 $EXIT_BACKUP). DB 는 건드리지 않았습니다." 'Red' }
    try {
      WriteJson $countsPath ([ordered]@{ db = $DbName; schemaVersion = $ver; charset = $dbCharset; collation = $dbCollation; takenAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); tables = $countsBefore })
      WriteJson $markerPath ([ordered]@{ db = $DbName; host = $DbHost; port = $Port; state = 'loading'; loadedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); baseDate = $BaseDate; myLoginId = $MyLoginId; dumpPath = $dumpPath; countsPath = $countsPath })
    } catch {
      Remove-Item -LiteralPath $markerPath -Force -ErrorAction SilentlyContinue
      Finish $EXIT_BACKUP "중단: 행 수 파일이나 표지 파일을 쓰지 못했습니다($($_.Exception.Message), 종료코드 $EXIT_BACKUP). DB 는 건드리지 않았습니다." 'Red'
    }
    Ok "행 수 파일: $countsPath"
    Ok "표지 파일: $markerPath"

    # ------------------------------------------------------------------------
    #  [2/3] 데모 SQL: 만들고, --force 없이 붓는다(트랜잭션 하나)
    # ------------------------------------------------------------------------
    Step 2 "데모 SQL"
    & $node $genPath "--my-login" $MyLoginId "--base-date" $BaseDate "--out" $sqlPath
    $genRc = $LASTEXITCODE
    $sqlText = ""
    if(Test-Path -LiteralPath $sqlPath -PathType Leaf){ $sqlText = [IO.File]::ReadAllText($sqlPath, [Text.Encoding]::UTF8) }
    if($genRc -ne 0 -or -not $sqlText.Contains("COMMIT;") -or -not $sqlText.Contains("SELECT 'demo:committed';")){
      Remove-Item -LiteralPath $markerPath -Force -ErrorAction SilentlyContinue
      Finish $EXIT_FAIL "중단: 데모 SQL 을 만들지 못했습니다(node 종료코드 $genRc, $sqlPath, 종료코드 $EXIT_FAIL). DB 는 건드리지 않았습니다." 'Red'
    }
    Ok "데모 SQL: $sqlPath"
    Info "적용: DB $DbName, --force 없음, 트랜잭션 하나"
    cmd /c "`"$mysql`" --defaults-extra-file=`"$($script:cnfPath)`" --default-character-set=utf8mb4 -N -B `"$DbName`" < `"$sqlPath`" > `"$loadLog`" 2>&1"
    $applyRc = $LASTEXITCODE
    $out = @()
    try { $out = @([IO.File]::ReadAllLines($loadLog, (New-Object System.Text.UTF8Encoding($false)))) } catch { Warn "적용 기록을 읽지 못했습니다: $loadLog ($($_.Exception.Message))" }
    Info "적용 기록: $loadLog"
    $committed = @($out | Where-Object { "$_".Trim() -eq 'demo:committed' }).Count -gt 0
    $summary = [ordered]@{}
    foreach($l in $out){ if("$l".Trim() -match '^demo:([a-z_0-9]+)=(.*)$'){ $summary[$Matches[1]] = $Matches[2] } }
    if($applyRc -ne 0 -or -not $committed){
      Log ""
      Log "==== 데모 SQL 이 끝까지 가지 않았습니다(mysql 종료코드 $applyRc) ====" 'Red'
      foreach($w in @($out | Where-Object { "$_" -match 'ERROR \d+' })){ Log "  이유: $w" 'Red' }
      # 출력 문구가 아니라 DB 상태로 가른다
      $st2 = DemoState
      $nameNow = QTry "SELECT HEX(name) FROM $dbQ.app_user WHERE user_id = $meId;"
      if($st2 -and $st2.DemoProjects -eq 0 -and $st2.DemoCustomers -eq 0 -and "$nameNow" -eq $meNameHex){
        Remove-Item -LiteralPath $markerPath -Force -ErrorAction SilentlyContinue
        Log "  공식 과제와 녹화 계정 이름이 그대로입니다. 트랜잭션이 되돌려졌고 바뀐 것은 없습니다(표지 파일을 지웠습니다)." 'Yellow'
        Log "  백업은 남겨 둡니다: $dumpPath" 'Yellow'
        Finish $EXIT_FAIL "중단: 데모 SQL 을 되돌렸습니다(종료코드 $EXIT_FAIL). 아무것도 바뀌지 않았습니다." 'Red'
      }
      Log "  DB 상태를 확인할 수 없거나 일부가 바뀌었습니다. 아래 명령으로 백업을 되살리세요:" 'Red'
      Log "     $(RestoreHint)"
      Finish $EXIT_FAIL "중단: 데모 SQL 결과를 확인하지 못했습니다(종료코드 $EXIT_FAIL). 위 상태를 확인하세요." 'Red'
    }
    SetMarkerState 'loaded'
    Ok "데모 데이터 커밋"

    # ------------------------------------------------------------------------
    #  [3/3] 확인
    # ------------------------------------------------------------------------
    Step 3 "확인"
    $bad = New-Object System.Collections.Generic.List[string]
    $me2 = QTry "SELECT HEX(name), HEX(login_id) FROM $dbQ.app_user WHERE user_id = $meId;"
    $m2 = "$me2".Split("`t")
    if($m2[0] -ne $meNameHex){ $bad.Add("녹화 계정 이름이 바뀌었습니다") }
    if($m2.Count -lt 2 -or $m2[1] -ne $meLoginHex){ $bad.Add("녹화 계정 login_id 가 바뀌었습니다") }
    $countsAfter = TableCounts
    if($null -eq $countsAfter){ $bad.Add("표별 행 수를 세지 못했습니다") }
    else {
      foreach($t in @('app_user','org_unit','title_code','section_code','status_code','cal_schema_meta')){
        if("$($countsAfter[$t])" -ne "$($countsBefore[$t])"){ $bad.Add("$t 행 수가 바뀌었습니다($($countsBefore[$t]) 에서 $($countsAfter[$t]))") }
      }
    }
    $st3 = DemoState
    if($null -eq $st3 -or -not $st3.IsDemo -or "$($st3.Projects)" -ne "$($summary['projects'])" -or "$($st3.Customers)" -ne "$($summary['customers'])"){ $bad.Add("공식 과제나 발주처가 데모 목록과 다릅니다") }
    $calMe = QTry "SELECT COUNT(*) FROM $dbQ.cal_category WHERE user_id = $meId;"
    if("$calMe" -eq "" -or [int]$calMe -lt 1){ $bad.Add("녹화 계정의 과제가 없습니다") }
    $ver2 = QTry "SELECT v FROM $dbQ.cal_schema_meta WHERE k = 'db_structure_version';"
    if("$ver2" -ne $SCHEMA_VERSION){ $bad.Add("db_structure_version 이 $SCHEMA_VERSION 이 아닙니다([$ver2])") }
    if($bad.Count -gt 0){
      foreach($b in $bad){ Log "  확인 실패: $b" 'Red' }
      Log "  백업으로 되돌리려면:" 'Red'
      Log "     $(RestoreHint)"
      Finish $EXIT_FAIL "중단: 넣은 뒤 확인에 실패했습니다(종료코드 $EXIT_FAIL)." 'Red'
    }
    Ok "녹화 계정: user_id $meId, 이름 그대로($(FromUtf8Hex $m2[0])), login_id 그대로"
    Log ""
    Log "  요약"
    Log "    이름을 바꾼 사람 : $($summary['renamed'])명(녹화 계정 제외, 전체 $($summary['users'])명)"
    Log "    동료 user_id     : $($summary['peer_user_ids']) (김철수, 이영희, 박민수)"
    Log "    공식 과제, 발주처: $($summary['projects'])개, $($summary['customers'])개"
    foreach($k in @('cal_me','cal_c1','cal_c2','cal_c3')){ if($summary.Contains($k)){ Log "    $k : $($summary[$k])" } }
    Log "    녹화 계정 열람 범위: $($summary['my_view_scope'])"
    Log ""
    Log "  위젯을 다시 띄우세요. 녹화 계정은 이름이 그대로라 다시 로그인하지 않아도 됩니다." 'Cyan'
    Log "  녹화가 끝나면 되돌리세요: $(RestoreHint)" 'Cyan'
    Finish $EXIT_OK "완료: '$DbName' 에 데모 데이터를 넣었습니다(종료코드 $EXIT_OK). 백업: $dumpPath" 'Green'
  }

  # ==========================================================================
  #  -Restore
  # ==========================================================================
  if($mode -eq 'Restore'){
    # --- 백업 고르기: -DumpPath, 표지 파일, 가장 최근 before-demo 백업 순서 ---
    $pickedBy = ""
    if($DumpPath){ $DumpPath = FullPath $DumpPath; $pickedBy = "-DumpPath" }
    elseif($marker -and $marker.dumpPath){ $DumpPath = "$($marker.dumpPath)"; $pickedBy = "표지 파일" }
    else {
      $latest = @(Get-ChildItem -LiteralPath $OutDir -Filter "$DbName-before-demo-*.sql" -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\.sql$' } | Sort-Object Name | Select-Object -Last 1)
      if($latest.Count -gt 0){ $DumpPath = $latest[0].FullName; $pickedBy = "가장 최근 before-demo 백업" }
    }
    if(-not $DumpPath){ DiePre "되살릴 백업이 없습니다($OutDir 에 $DbName-before-demo-*.sql 이 없고 표지 파일도 없습니다). -DumpPath 로 주세요." }
    if(-not (Test-Path -LiteralPath $DumpPath -PathType Leaf)){ DiePre "백업 파일이 없습니다: $DumpPath" }
    Ok "백업($pickedBy): $DumpPath"
    if(-not (DumpCompleted $DumpPath)){ DiePre "백업 파일 끝에 '-- Dump completed' 가 없습니다. 온전한 덤프가 아닙니다: $DumpPath" }
    $head = @(Get-Content -LiteralPath $DumpPath -TotalCount 80 -Encoding UTF8)
    if(@($head | Where-Object { "$_" -match '^\s*(CREATE DATABASE|USE\s)' }).Count -gt 0){ DiePre "백업 머리에 CREATE DATABASE 나 USE 가 있습니다. 다른 DB 로 들어갈 수 있어 붓지 않습니다: $DumpPath" }
    $countsPath = $DumpPath + ".counts.json"
    $counts = ReadJson $countsPath
    if($null -eq $counts -or $null -eq $counts.tables){ DiePre "행 수 파일이 없거나 읽지 못했습니다: $countsPath. 이 도구(-Load)가 뜬 백업만 되살립니다." }
    if("$($counts.db)" -ne $DbName){ DiePre "이 백업은 DB '$($counts.db)' 의 것입니다(-DbName $DbName 과 다름)." }
    $collation = "$($counts.collation)"
    if($collation -notmatch '^utf8mb4_[a-z0-9_]+$'){ $collation = $DEFAULT_COLLATION }
    $expect = [ordered]@{}
    foreach($p in $counts.tables.PSObject.Properties){ $expect[$p.Name] = [long]$p.Value }
    Ok "행 수 파일: 표 $($expect.Count)개, 정렬 규칙 $collation"

    # --- 지금 DB 가 데모인가: 실데이터를 옛 백업으로 덮는 사고를 막는다 ---
    if($dbExists){
      $st = DemoState
      $isDemo = ($st -and $st.IsDemo)
      if(-not $isDemo -and -not $marker){
        DiePre "지금 '$DbName' 에는 데모 데이터가 없고 표지 파일도 없습니다. 되돌릴 것이 없습니다(실데이터를 옛 백업으로 덮지 않습니다). 다른 백업으로 되살리려면 db/deploy/restore-taskmgr.cmd 를 쓰세요."
      }
      if($isDemo){ Ok "지금 '$DbName' 은 데모 데이터입니다." } else { Warn "지금 '$DbName' 이 데모 모양이 아니지만 표지 파일(상태 $($marker.state))이 있어 계속합니다." }
      CheckSessions
    } else {
      if(-not $marker){ DiePre "DB '$DbName' 가 없고 표지 파일도 없습니다. 이 도구가 다룬 DB 가 아닙니다." }
      Warn "DB '$DbName' 가 없습니다. 앞선 되살리기가 도중에 멈춘 것으로 보고 새로 만듭니다."
    }
    $safePath = Join-Path $OutDir ("$DbName-before-restore-" + $script:ts + ".sql")
    $restoreLog = Join-Path $OutDir ("$DbName-restore-" + $script:ts + ".log")
    Log ""
    Log "  DB         : $DbName  (서버 $DbHost`:$Port)"
    Log "  되살릴 백업: $DumpPath"
    Log "  하는 일    : 지금 상태를 안전 덤프로 남긴 뒤 DB 를 지우고($collation 로) 다시 만들어 백업을 붓습니다."
    Log "  앱 계정 권한은 DB 를 지워도 남습니다(표 단위 권한). 위젯은 끝난 뒤 다시 띄우세요." 'Yellow'
    if(-not $Yes){
      $a = Read-Host "계속하려면 Y"
      if("$a".Trim() -ne 'Y'){ Finish $EXIT_CANCEL "취소했습니다. 아무것도 바꾸지 않았습니다(종료코드 $EXIT_CANCEL)." 'White' }
    }

    # ------------------------------------------------------------------------
    #  [1/3] 안전 덤프: 지금 상태(데모)를 먼저 남긴다
    # ------------------------------------------------------------------------
    Step 1 "안전 덤프"
    if($dbExists){
      $why = DumpDb $safePath
      if($why){ Finish $EXIT_BACKUP "중단: 안전 덤프 실패: $why (종료코드 $EXIT_BACKUP). DB 는 건드리지 않았습니다." 'Red' }
    } else { Info "DB 가 없어 안전 덤프를 건너뜁니다." }

    # ------------------------------------------------------------------------
    #  [2/3] 되살리기: DROP, CREATE, 붓기(--force 없이)
    # ------------------------------------------------------------------------
    Step 2 "되살리기"
    SetMarkerState 'restoring'
    $dc = QTry "DROP DATABASE IF EXISTS $dbQ; CREATE DATABASE $dbQ CHARACTER SET utf8mb4 COLLATE $collation;"
    if($null -eq $dc){
      Log "  DB 를 지우거나 만들지 못했습니다. 위 mysql 오류를 확인하세요." 'Red'
      Log "  다시 실행하면 같은 백업으로 이어서 합니다: $(RestoreHint) -DumpPath `"$DumpPath`""
      Finish $EXIT_FAIL "중단: DB 를 다시 만들지 못했습니다(종료코드 $EXIT_FAIL)." 'Red'
    }
    Ok "DB 를 지우고 다시 만들었습니다($collation)"
    Info "붓기: $DumpPath"
    cmd /c "`"$mysql`" --defaults-extra-file=`"$($script:cnfPath)`" --default-character-set=utf8mb4 `"$DbName`" < `"$DumpPath`" > `"$restoreLog`" 2>&1"
    $loadRc = $LASTEXITCODE
    if($loadRc -ne 0){
      $out = @()
      try { $out = @([IO.File]::ReadAllLines($restoreLog, (New-Object System.Text.UTF8Encoding($false)))) } catch {}
      foreach($w in @($out | Where-Object { "$_" -match 'ERROR \d+' })){ Log "  이유: $w" 'Red' }
      Log "  DB 가 반쯤 채워진 상태입니다. 원인을 고친 뒤 다시 실행하세요(같은 백업으로 처음부터 다시 만듭니다):" 'Red'
      Log "     $(RestoreHint) -DumpPath `"$DumpPath`""
      if($dbExists){ Log "  되살리기 직전의 데모 상태: $safePath" 'Yellow' }
      Finish $EXIT_FAIL "중단: 백업을 붓다가 멈췄습니다(mysql 종료코드 $loadRc, 기록 $restoreLog, 종료코드 $EXIT_FAIL)." 'Red'
    }
    Ok "붓기 완료(기록 $restoreLog)"

    # ------------------------------------------------------------------------
    #  [3/3] 확인: 판번호, 표 이름 집합, 표별 행 수가 -Load 때와 같아야 한다
    # ------------------------------------------------------------------------
    Step 3 "확인"
    $bad = New-Object System.Collections.Generic.List[string]
    $ver = QTry "SELECT v FROM $dbQ.cal_schema_meta WHERE k = 'db_structure_version';"
    if("$ver" -ne $SCHEMA_VERSION){ $bad.Add("db_structure_version 이 $SCHEMA_VERSION 이 아닙니다([$ver])") }
    $now = TableCounts
    if($null -eq $now){ $bad.Add("표별 행 수를 세지 못했습니다") }
    else {
      $a1 = @($expect.Keys | Sort-Object) -join ','
      $a2 = @($now.Keys | Sort-Object) -join ','
      if($a1 -ne $a2){ $bad.Add("표 이름 집합이 다릅니다(기대 $a1 / 지금 $a2)") }
      foreach($k in $expect.Keys){
        if($now.Contains($k) -and "$($now[$k])" -ne "$($expect[$k])"){ $bad.Add("$k 행 수가 다릅니다(기대 $($expect[$k]), 지금 $($now[$k]))") }
      }
    }
    if($bad.Count -gt 0){
      foreach($b in $bad){ Log "  확인 실패: $b" 'Red' }
      Finish $EXIT_FAIL "중단: 되살린 DB 가 -Load 때와 다릅니다(종료코드 $EXIT_FAIL). 위 차이를 확인하세요." 'Red'
    }
    Ok "db_structure_version $ver, 표 $($expect.Count)개의 행 수가 -Load 때와 같습니다"
    if(Test-Path -LiteralPath $markerPath -PathType Leaf){
      $done = Join-Path $OutDir ("$DbName-demo-marker-restored-" + $script:ts + ".json")
      try { Move-Item -LiteralPath $markerPath -Destination $done -Force; Ok "표지 파일을 옮겼습니다: $done" }
      catch { Warn "표지 파일을 옮기지 못했습니다: $markerPath ($($_.Exception.Message)). 다음 -Load 전에 지우세요." }
    }
    Log ""
    Log "  위젯을 다시 띄우세요." 'Cyan'
    Finish $EXIT_OK "완료: '$DbName' 을 데모 전 상태로 되살렸습니다(종료코드 $EXIT_OK)." 'Green'
  }
} finally {
  # exit(Finish) 로 끝나도 finally 는 돈다. Cleanup 은 두 번 불려도 안전하다.
  Cleanup
}
