<#
  scope-all.ps1: 모든 직원(app_user 전체 행)의 일정 열람 범위(view_scope)를 'all'(전체)로 바꾸는 운영 도구.
  보통은 scope-all.cmd 를 더블클릭한다.

  왜 있나
    사용자 결정(2026-10-16): 이 회사는 주간보고를 이미 서로 다 볼 수 있으므로, 캘린더의 일정 열람 범위도
    모든 직원이 '전체' 여야 한다. 그런데 새 행의 기본값은 'self' 이고(app_user DDL, 회사 저장소
    taskmgr-company-data\01-schema-users.sql), setup-taskcalendar 가 붓는 04-permissions.sql 도 대부분을 self 로 둔다.
    그래서 이 도구로 한 번에 맞춘다.

  무엇을 바꾸나
    <DbName>.app_user 의 view_scope 한 열만. 재직(is_active=1)과 비활성(0) 모두. edit_role 과 다른 열은 건드리지 않는다.
    허용 값은 self, unit_tree, all 이다(CHECK chk_view_scope).
    app_user.updated_at 은 ON UPDATE CURRENT_TIMESTAMP(3) 라서, 실제로 바뀐 행만 표가 스스로 지금 시각으로 갱신한다.
    이 도구가 updated_at 을 따로 쓰지는 않는다.
    'all' 인지는 글자 그대로(utf8mb4_0900_bin) 본다. 위젯이 'all' 을 대소문자까지 그대로 비교하므로
    (ProjectDb.CanViewScheduleAsync), 'ALL' 이나 'all ' 처럼 표의 정렬 규칙으로는 같아 보이는 값도 바꿀 대상으로 센다.

  단계(화면에 [n/3] 으로 찍힌다. 첫 실패에서 멈춘다)
    [0] 사전 점검: mysql.exe, 접속, DB, app_user 표와 user_id, view_scope 열, cal_schema_meta 의 db_structure_version
        (특정 판을 요구하지 않는다. 표나 행이 없으면 그렇다고만 알린다), 지금 분포(view_scope, 재직 여부별 인원),
        바뀔 행 수. 0 이면 "이미 모두 전체입니다. 할 일이 없습니다." 로 끝낸다(종료코드 0).
        그다음 DB, 서버, 바뀔 행 수, 되돌리기 파일 경로를 보여 주고 Y 를 받는다(-Yes 면 묻지 않는다).
    [1] 되돌리기 파일: 바뀔 행마다 한 줄씩 UPDATE app_user SET view_scope='<옛 값>' WHERE user_id=<번호>; 를
        <OutDir>\<DbName>-scope-before-<시각>.sql 로 쓴다. 값은 DB 에서 HEX 로 읽어 다시 만든다(사람 입력이 아니다.
        평범한 값이 아니면 CONVERT(X'..' USING utf8mb4) 로 적는다). 다시 읽어 UPDATE 줄 수와 user_id 목록이 계획과
        같아야 통과다. 통과하기 전에는 DB 를 바꾸지 않는다(종료코드 5).
    [2] 변경: 트랜잭션 하나로 돌린다. 바뀔 행을 FOR UPDATE 로 잡고, user_id 목록이 계획과 같은지 보고,
        UPDATE app_user SET view_scope = 'all' WHERE view_scope 가 'all' 이 아닌 행, ROW_COUNT() 가 계획한 수와 같을 때만
        COMMIT 한다. 어긋나면 그 자리에서 mysql 이 멈추고 연결이 끊기며 트랜잭션은 되돌려진다(종료코드 1).
        적용한 SQL 과 출력은 <OutDir>\<DbName>-scope-apply-<시각>.sql 과 .log 로 남긴다.
    [3] 확인: 'all' 이 아닌 행이 0 인지 다시 세고, 새 분포와 되돌리기 파일 경로를 보여 준다.
    화면에 찍힌 모든 줄은 <OutDir>\scope-all-<시각>.txt 로 남긴다(실패면 이름 끝에 -FAILED).

  위젯이 새 범위를 언제 읽나
    위젯(호스트)은 view_scope 를 부팅 때 읽어 두지 않는다. 세션 파일에도 없다(widget/UserSession.cs).
    구성원 창이나 사람 고르기 목록을 열 때마다(membersGet, ProjectDb.LoadMembersJsonAsync) 그리고 다른 사람
    일정을 열 때마다(CalendarDb.LoadPeerScheduleJsonAsync 가 ProjectDb.CanViewScheduleAsync 로 다시 판정) DB 에서
    새로 읽는다. 그래서 위젯을 다시 시작할 필요는 없다. 이미 열려 있는 구성원 창이나 사람 고르기 목록만
    닫았다가 다시 열면 된다.

  되돌리는 법
    [1] 에서 만든 파일을 mysql 로 붓는다(파일 머리말에 명령이 있다). user_id 로 행을 골라 view_scope 하나만 되돌린다.

  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
    0 ok - every app_user row now has view_scope 'all', or every row already had it (nothing to do)
    1 update failed - the UPDATE did not commit (rolled back), or the check after the commit failed; read the printed state
    2 cancelled - the confirmation was not Y; nothing was changed
    3 precheck failed - tools, password, connection, DB, app_user table or its columns; nothing was changed
    5 revert file failed - the revert .sql could not be written or verified; nothing was changed
  --- END EXITCODES ---

  ⚠️ 비밀번호: 이 스크립트는 비밀번호를 인자로 받지 않는다(같은 사용자의 다른 프로세스가 명령줄을 읽는다.
     restore-taskmgr.ps1 머리말의 실측). 순서는 migrate-code-ids 와 같다:
       (1) 환경변수 TASKMGR_ADMIN_PW, (2) 입력이 리다이렉트돼 있으면 stdin 첫 줄(상한 10초),
       (3) 대화형이면 가려진 입력으로 묻는다.
     mysql 에는 임시 .cnf(--defaults-extra-file)로만 넘기고, 어떻게 끝나든 finally 에서 지운다.

  ⚠️ 인자 값을 역슬래시로 끝내지 말 것(-OutDir "D:\x\" 등). powershell.exe 가 \" 를 이스케이프된 따옴표로 읽어
     뒤 인자를 삼킨다. 아래 AssertNoSwallow 가 그 상태를 감지하면 멈춘다(migrate-code-ids.ps1 과 같은 가드).

  창 닫힘: .cmd 로 띄우면(TC_SCOPE_ALL_LAUNCHER=cmd) 실패는 .cmd 가, 성공은 이 스크립트가 멈춰 준다(-Yes 면 성공은 안 멈춤).
     ps1 을 직접 실행하면 종료코드와 무관하게 늘 엔터를 기다린다. stdin 이 리다이렉트된 무인 실행은 멈추지 않는다.

  예)  scope-all.cmd                                   (더블클릭: 보여 주고, 묻고, 바꾼다)
       scope-all.cmd -DbName taskcalendar_copy        (복제한 격리 DB 로 먼저 리허설)
       scope-all.cmd -DbHost 192.168.0.50 -OutDir "D:\taskmgr-ops"
       무인 실행(입력이 리다이렉트되면 -Yes 가 꼭 있어야 한다. 비밀번호 자리는 예시용 자리표시다):
         set TASKMGR_ADMIN_PW=<관리자 비밀번호>  그다음  scope-all.cmd -Yes
         echo <관리자 비밀번호>| scope-all.cmd -Yes
#>
[CmdletBinding()]
param(
  [string]$DbName = "taskcalendar",     # 바꿀 DB(app_user 가 있는 캘린더 DB)
  [string]$DbHost = "127.0.0.1",        # MySQL 호스트
  [int]$Port = 3306,
  [string]$BaseDir = "C:\mysql",        # mysql.exe 위치(없으면 서비스 binPath, 그다음 기본 설치 경로)
  [string]$ServiceName = "MySQL84",
  [string]$DbUser = "root",             # UPDATE 를 낼 관리 계정
  [string]$OutDir = "",                 # 비우면 <스크립트>\..\..\dist\scope-all
  [switch]$Yes                          # 확인 질문을 건너뛴다(무인 실행)
)
$ErrorActionPreference = "Continue"     # 네이티브 stderr 가 창을 닫지 않게(Stop 금지)

# ============================================================================
#  상수
# ============================================================================
$EXIT_OK        = 0
$EXIT_FAIL      = 1
$EXIT_CANCEL    = 2
$EXIT_PRECHECK  = 3
$EXIT_REVERT    = 5

$ADMIN_PW_ENV   = "TASKMGR_ADMIN_PW"   # 무인 실행 자격(restore-taskmgr.ps1, migrate-code-ids.ps1 과 같은 이름)
$STDIN_WAIT_SEC = 10                   # stdin 첫 줄 읽기 상한(초). 파이프가 열린 채 비어 있으면 영원히 멎는다.
$DEFAULT_MYSQL_DIR = "C:\Program Files\MySQL\MySQL Server 8.4"

# 바꿀 대상의 조건. 'all' 을 글자 그대로(NO PAD 이진 비교) 본다. 위 머리말 '무엇을 바꾸나' 참고.
# 세기, 계획, 되돌리기 파일, UPDATE, 확인이 모두 이 한 식을 쓴다(식이 갈리면 센 수와 바꾼 수가 어긋난다).
$NOT_ALL = "view_scope COLLATE utf8mb4_0900_bin <> 'all'"

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
  $p = Join-Path $dir ("scope-all-" + $script:ts + $suffix + ".txt")
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
  # 창을 멈추나(migrate-code-ids.ps1 과 같은 규칙):
  #   stdin 이 리다이렉트됨: 멈추지 않는다 / .cmd 를 거치지 않음: 늘 멈춘다 / .cmd 가 띄움: 성공만(-Yes 면 안 멈춤)
  $pause = $false
  if([Console]::IsInputRedirected){ $pause = $false }
  elseif($env:TC_SCOPE_ALL_LAUNCHER -ne 'cmd'){ $pause = $true }
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
#  인자 검증: 인자가 뒤엉킨 채 '조용히 다른 DB' 를 바꾸는 것을 막는다
# ============================================================================
$SWALLOW_FLAGS = '\s-(DbName|DbHost|Port|BaseDir|ServiceName|DbUser|OutDir|Yes)\b'
function AssertNoSwallow($label, $val){
  if("$val" -match '"'){ DiePre "$label 값에 따옴표가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태입니다. 경로 끝의 역슬래시를 빼고 다시 실행하세요(예: -OutDir `"D:\ops`")." }
  if("$val" -match $SWALLOW_FLAGS){ DiePre "$label 값 안에 다른 인자가 들어 있습니다: [$val]. 경로 끝의 역슬래시를 빼고 다시 실행하세요." }
}

Log "=================================================="
Log "   모든 직원의 열람 범위를 전체로: $DbName"
Log "   서버: $DbHost`:$Port"
Log "=================================================="

Step 0 "사전 점검"
AssertNoSwallow "-DbName"      $DbName
AssertNoSwallow "-DbHost"      $DbHost
AssertNoSwallow "-BaseDir"     $BaseDir
AssertNoSwallow "-ServiceName" $ServiceName
AssertNoSwallow "-DbUser"      $DbUser
AssertNoSwallow "-OutDir"      $OutDir

function FullPath([string]$p){
  if(-not [IO.Path]::IsPathRooted($p)){ $p = Join-Path (Get-Location).ProviderPath $p }
  return [IO.Path]::GetFullPath($p)
}
$scriptDir = Split-Path -Parent $PSCommandPath
if(-not $OutDir){ $OutDir = Join-Path $scriptDir "..\..\dist\scope-all" }
$OutDir = FullPath $OutDir
# 보고서 폴더를 지금 잡는다. 사전 점검(3)이나 취소(2)로 끝나도 보고서가 남게.
if(-not (Test-Path -LiteralPath $OutDir)){ try { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null } catch {} }
if(Test-Path -LiteralPath $OutDir -PathType Container){ $script:reportDir = $OutDir }
# 아래 값들은 SQL 문자열과 식별자에 그대로 들어간다. 여기 통과가 곧 그 자리의 안전 조건이다.
if($DbName -notmatch '^[A-Za-z0-9_]+$'){ DiePre "-DbName 이 식별자 형식이 아닙니다: [$DbName]" }
if($DbUser -notmatch '^[A-Za-z0-9_.$-]+$'){ DiePre "-DbUser 가 식별자 형식이 아닙니다: [$DbUser]" }
if($DbHost -notmatch '^[A-Za-z0-9_.:-]+$'){ DiePre "-DbHost 형식이 이상합니다: [$DbHost]" }
if($Port -lt 1 -or $Port -gt 65535){ DiePre "-Port 범위가 아닙니다: $Port" }

# --- 도구: -BaseDir, 서비스 binPath, 기본 설치 경로 순서로 mysql.exe 를 찾는다 ---
$toolRoots = New-Object System.Collections.Generic.List[string]
$toolRoots.Add($BaseDir)
try {
  $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  if($svc -and $svc.PathName -match '"?([A-Za-z]:[^"]*)\\bin\\mysqld\.exe'){ $toolRoots.Add($Matches[1]) }
} catch {}
$toolRoots.Add($DEFAULT_MYSQL_DIR)
$mysql = $null
foreach($root in $toolRoots){
  $c1 = Join-Path $root "bin\mysql.exe"
  if(Test-Path -LiteralPath $c1){ $mysql = $c1; break }
}
if(-not $mysql){ DiePre "mysql.exe 를 못 찾았습니다(찾아본 곳: $($toolRoots -join ', ')). -BaseDir 로 설치 경로를 지정하세요." }
Ok "도구: $mysql"
if(-not $script:reportDir){ DiePre "기록 폴더를 만들지 못했습니다: $OutDir (되돌리기 파일을 쓸 곳이 없으면 바꾸지 않습니다)" }
Ok "기록 폴더: $OutDir"

# 무인 실행(입력 리다이렉트)에서는 확인 질문에 답할 사람이 없다. -Yes 를 요구한다.
if([Console]::IsInputRedirected -and -not $Yes){ DiePre "입력이 리다이렉트된 무인 실행에서는 확인(Y)을 받을 수 없습니다. -Yes 를 함께 주세요." }

# --- 관리자 비밀번호: 환경변수, stdin 첫 줄(상한), 가려진 입력 순서 ---
# stdin 첫 줄을 상한 안에 읽는다(restore-taskmgr.ps1, migrate-code-ids.ps1 과 같은 구현). [Console]::In.ReadLine() 은
# 파이프가 열린 채 비어 있으면 돌아오지 않으므로 raw 스트림을 비동기로 읽고 대기에 상한을 건다.
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
  $script:cnfPath = Join-Path $env:TEMP ("myscope_" + [IO.Path]::GetRandomFileName() + ".cnf")
  $cnfText = "[client]`r`nuser=$DbUser`r`npassword=""$pwEsc""`r`nhost=$DbHost`r`nport=$Port`r`ndefault-character-set=utf8mb4`r`n"
  [IO.File]::WriteAllText($script:cnfPath, $cnfText, (New-Object System.Text.UTF8Encoding($false)))
  $pwEsc = $null

  function BQ([string]$n){ return ('`' + $n + '`') }
  $dbQ = BQ $DbName
  $userQ = "$dbQ.$(BQ 'app_user')"

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

  $SQL_DIST    = "SELECT view_scope, is_active, COUNT(*) FROM $userQ GROUP BY view_scope, is_active ORDER BY view_scope, is_active;"
  $SQL_NOT_ALL = "SELECT COUNT(*) FROM $userQ WHERE $NOT_ALL;"

  # 분포를 찍는다(view_scope, 재직 여부, 인원). 사전 점검과 확인이 함께 쓴다.
  function ShowDist([string]$title){
    $d = QRowsTry $SQL_DIST
    if(-not $d.Ok){ Warn "$title 분포를 읽지 못했습니다."; return $false }
    Log "  $title (view_scope, 재직 여부, 인원):"
    if(@($d.Rows).Count -eq 0){ Log "    (행 없음)" }
    foreach($row in @($d.Rows)){
      $f = "$row".Split("`t")
      $act = "$($f[1])"
      if($act -eq '1'){ $act = '재직' } elseif($act -eq '0'){ $act = '비활성' }
      Log ("    {0,-10} {1,-6} {2,4}명" -f $f[0], $act, $f[2])
    }
    return $true
  }

  # --- 접속 ---
  $serverVer = QTry "SELECT VERSION();"
  if($null -eq $serverVer){ DiePre "MySQL 에 접속하지 못했습니다($DbUser@$DbHost`:$Port). 위 mysql 오류(비밀번호, 서비스 실행 여부)를 확인하세요." }
  Ok "접속: MySQL $serverVer"

  # --- DB, app_user, 열 ---
  if([int](QPre "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$DbName';" "DB 유무") -lt 1){
    DiePre "DB '$DbName' 가 없습니다. -DbName 을 확인하세요."
  }
  if([int](QPre "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '$DbName' AND TABLE_NAME = 'app_user';" "app_user 유무") -lt 1){
    DiePre "'$DbName' 에 app_user 표가 없습니다. 캘린더 DB(taskcalendar)가 맞는지 확인하세요."
  }
  $cols = [int](QPre "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '$DbName' AND TABLE_NAME = 'app_user' AND COLUMN_NAME IN ('user_id','view_scope');" "app_user 열")
  if($cols -ne 2){ DiePre "'$DbName'.app_user 에 user_id 와 view_scope 열이 다 있지 않습니다($cols/2). 이 도구가 아는 app_user 가 아닙니다." }
  Ok "'$DbName'.app_user 와 user_id, view_scope 열 확인"

  # --- 판번호: 정보용(특정 판을 요구하지 않는다) ---
  if([int](QPre "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '$DbName' AND TABLE_NAME = 'cal_schema_meta';" "cal_schema_meta 유무") -lt 1){
    Warn "'$DbName' 에 cal_schema_meta 표가 없습니다. 판번호는 알 수 없습니다(계속합니다)."
  } else {
    $ver = QPre "SELECT v FROM $dbQ.cal_schema_meta WHERE k = 'db_structure_version';" "db_structure_version"
    if($ver){ Ok "'$DbName' 의 db_structure_version = $ver" }
    else { Warn "'$DbName'.cal_schema_meta 에 db_structure_version 행이 없습니다. 판번호는 알 수 없습니다(계속합니다)." }
  }

  # --- 지금 분포와 계획 ---
  Log ""
  if(-not (ShowDist "지금 분포")){ DiePre "app_user 분포 질의가 실패했습니다. 위에 찍힌 mysql 오류를 확인하세요." }
  $total = QPre "SELECT COUNT(*) FROM $userQ;" "app_user 행 수"
  # 바뀔 행: user_id 와 지금 값(HEX). 값은 HEX 로 받아 -B 출력의 이스케이프와 문자셋 해석을 거치지 않게 한다.
  $planRes = QRowsTry "SELECT user_id, HEX(view_scope) FROM $userQ WHERE $NOT_ALL ORDER BY user_id;"
  if(-not $planRes.Ok){ DiePre "바뀔 행 목록 질의가 실패했습니다. 위에 찍힌 mysql 오류를 확인하세요." }
  $plan = New-Object System.Collections.Generic.List[object]
  foreach($row in @($planRes.Rows)){
    $f = "$row".Split("`t")
    $uid = "$($f[0])".Trim()
    $hex = ""
    if($f.Count -ge 2){ $hex = "$($f[1])".Trim().ToUpperInvariant() }
    if($uid -notmatch '^\d+$'){ DiePre "user_id 가 숫자가 아닙니다: [$uid]. 되돌리기 파일을 만들 수 없어 멈춥니다." }
    if($hex -notmatch '^([0-9A-F]{2})*$'){ DiePre "user_id $uid 의 view_scope HEX 가 이상합니다: [$hex]." }
    $plan.Add(@{ Id = $uid; Hex = $hex })
  }
  $planCount = $plan.Count
  $notAllNow = QPre $SQL_NOT_ALL "바뀔 행 수"
  if("$notAllNow" -ne "$planCount"){ DiePre "바뀔 행 수가 두 번 센 사이에 달라졌습니다(목록 $planCount, 수 $notAllNow). 관리 화면에서 직원을 고치는 중이면 끝난 뒤 다시 실행하세요." }
  Log ""
  Log "  전체 행    : $total"
  Log "  바뀔 행    : $planCount (view_scope 가 'all' 이 아닌 행, 재직과 비활성 모두)"
  if($planCount -eq 0){
    Finish $EXIT_OK "이미 모두 전체입니다. 할 일이 없습니다." 'Green'
  }

  $revertPath = Join-Path $OutDir ("$DbName-scope-before-" + $script:ts + ".sql")
  $applySql   = Join-Path $OutDir ("$DbName-scope-apply-" + $script:ts + ".sql")
  $applyLog   = Join-Path $OutDir ("$DbName-scope-apply-" + $script:ts + ".log")
  Log ""
  Log "  DB         : $DbName  (서버 $DbHost`:$Port)"
  Log "  바꿀 것    : app_user.view_scope 를 'all'(전체)로, $planCount 행. edit_role 과 다른 열은 그대로입니다."
  Log "  되돌리기   : $revertPath"
  if(-not $Yes){
    $a = Read-Host "계속하려면 Y"
    if("$a".Trim() -ne 'Y'){
      Finish $EXIT_CANCEL "취소했습니다. 아무것도 바꾸지 않았습니다(종료코드 $EXIT_CANCEL)." 'White'
    }
  }

  # ==========================================================================
  #  [1/3] 되돌리기 파일: UPDATE 보다 반드시 먼저, 검증까지 통과해야 다음으로 간다
  # ==========================================================================
  Step 1 "되돌리기 파일"
  function HexToText([string]$h){
    $bytes = New-Object byte[] ($h.Length / 2)
    for($i = 0; $i -lt $bytes.Length; $i++){ $bytes[$i] = [Convert]::ToByte($h.Substring($i * 2, 2), 16) }
    return [Text.Encoding]::UTF8.GetString($bytes)
  }
  # 옛 값을 SQL 값으로. 평범한 코드 값(소문자와 밑줄)은 그대로 따옴표에, 그 밖은 HEX 리터럴로(어떤 글자든 안전하다).
  function SqlValue([string]$h){
    $t = HexToText $h
    if($t -cmatch '^[a-z_]{1,20}\z'){ return "'" + $t + "'" }   # \z: $ 는 끝의 줄바꿈 앞에서도 맞는다
    return "CONVERT(X'" + $h + "' USING utf8mb4)"
  }
  $partPath = $revertPath + ".partial"
  $mysqlHint = "mysql --default-character-set=utf8mb4"
  if($DbHost -ne "127.0.0.1"){ $mysqlHint += " -h $DbHost" }
  if($Port -ne 3306){ $mysqlHint += " -P $Port" }
  $mysqlHint += " -u $DbUser -p $DbName < `"$revertPath`""
  $out = New-Object System.Collections.Generic.List[string]
  $out.Add("-- scope-all.ps1 되돌리기 파일")
  $out.Add("-- DB       : $DbName (서버 $DbHost`:$Port)")
  $out.Add("-- 만든 때  : " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
  $out.Add("-- 내용     : scope-all 이 view_scope 를 'all' 로 바꾸기 직전의 값, $planCount 행. 한 줄에 한 행이다.")
  $out.Add("--            user_id 로 행을 골라 view_scope 하나만 되돌린다(edit_role 과 다른 열은 그대로).")
  $out.Add("--            이 파일을 부으면 그 뒤 관리 화면에서 그 사람들에게 바꾼 열람 범위도 이 값으로 덮인다.")
  $out.Add("-- 되돌리기 : MySQL 의 bin 폴더에서 아래를 실행한다(비밀번호는 mysql 이 묻는다).")
  $out.Add("--   $mysqlHint")
  $out.Add("SET NAMES utf8mb4;")
  $out.Add("START TRANSACTION;")
  foreach($p in $plan){ $out.Add("UPDATE app_user SET view_scope=" + (SqlValue $p.Hex) + " WHERE user_id=" + $p.Id + ";") }
  $out.Add("COMMIT;")
  try {
    [IO.File]::WriteAllLines($partPath, $out.ToArray(), (New-Object System.Text.UTF8Encoding($false)))
  } catch {
    Finish $EXIT_REVERT "중단: 되돌리기 파일을 쓰지 못했습니다: $partPath ($($_.Exception.Message), 종료코드 $EXIT_REVERT). DB 는 건드리지 않았습니다." 'Red'
  }
  # 다시 읽어 센다: UPDATE 줄 수와 user_id 목록이 계획과 같아야 한다.
  $back = @()
  try { $back = @([IO.File]::ReadAllLines($partPath, (New-Object System.Text.UTF8Encoding($false)))) } catch { $back = @() }
  $updLines = @($back | Where-Object { "$_" -match '^UPDATE app_user SET view_scope=' })
  $backIds = @($updLines | ForEach-Object { if("$_" -match ' WHERE user_id=(\d+);$'){ $Matches[1] } else { '?' } })
  $planIds = @($plan | ForEach-Object { $_.Id })
  if($updLines.Count -ne $planCount -or (($backIds -join ',') -ne ($planIds -join ','))){
    Finish $EXIT_REVERT "중단: 되돌리기 파일 검증 실패(UPDATE 줄 $($updLines.Count), 계획 $planCount, 종료코드 $EXIT_REVERT). 파일: $partPath. DB 는 건드리지 않았습니다." 'Red'
  }
  Move-Item -LiteralPath $partPath -Destination $revertPath -Force
  if(-not (Test-Path -LiteralPath $revertPath -PathType Leaf)){ Finish $EXIT_REVERT "중단: 검증한 되돌리기 파일의 이름을 바꾸지 못했습니다: $partPath (종료코드 $EXIT_REVERT). DB 는 건드리지 않았습니다." 'Red' }
  Ok "되돌리기 파일: $revertPath (UPDATE $($updLines.Count)줄, user_id 목록이 계획과 같음)"

  # ==========================================================================
  #  [2/3] 변경: 트랜잭션 하나. 계획과 어긋나면 COMMIT 전에 mysql 이 멈추고, 끊긴 연결의 트랜잭션은 되돌려진다
  # ==========================================================================
  Step 2 "변경"
  # 멈추는 방법은 이관 SQL 과 같다: 스토어드 프로그램 밖에서는 IF 도 SIGNAL 도 못 쓰므로, 조건이 틀리면
  # 없는 표를 SELECT 해 ERROR 1146 을 낸다. mysql 은 --force 없이 첫 오류에서 끝나므로 COMMIT 에 닿지 않는다.
  $idList = $planIds -join ','
  $txLines = @(
    "SET SESSION innodb_lock_wait_timeout = 10;",
    "SET SESSION group_concat_max_len = 1048576;",
    "START TRANSACTION;",
    "SELECT COUNT(*) FROM app_user WHERE $NOT_ALL FOR UPDATE;",
    "SET @ids := (SELECT IFNULL(GROUP_CONCAT(user_id ORDER BY user_id SEPARATOR ','), '') FROM app_user WHERE $NOT_ALL);",
    "SET @g := IF(@ids = '$idList', 'DO 0', 'SELECT 1 FROM ``stop: rows to change differ from the plan``');",
    "PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;",
    "UPDATE app_user SET view_scope = 'all' WHERE $NOT_ALL;",
    "SET @n := ROW_COUNT();",
    "SELECT CONCAT('affected=', @n);",
    "SET @g := IF(@n = $planCount, 'DO 0', 'SELECT 1 FROM ``stop: affected rows differ from the plan``');",
    "PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;",
    "COMMIT;",
    "SELECT 'committed';"
  )
  try {
    [IO.File]::WriteAllLines($applySql, $txLines, (New-Object System.Text.UTF8Encoding($false)))
  } catch {
    Finish $EXIT_FAIL "중단: 적용 SQL 을 쓰지 못했습니다: $applySql ($($_.Exception.Message), 종료코드 $EXIT_FAIL). DB 는 건드리지 않았습니다." 'Red'
  }
  Info "적용: $applySql (DB $DbName, --force 없음, 트랜잭션 하나)"
  # 바이트를 그대로 흘려 넣고 출력도 바이트 그대로 파일로 받는다(migrate-code-ids.ps1 과 같은 방식).
  cmd /c "`"$mysql`" --defaults-extra-file=`"$($script:cnfPath)`" --default-character-set=utf8mb4 -N -B `"$DbName`" < `"$applySql`" > `"$applyLog`" 2>&1"
  $applyRc = $LASTEXITCODE
  $applyOut = @()
  try { $applyOut = @([IO.File]::ReadAllLines($applyLog, (New-Object System.Text.UTF8Encoding($false)))) } catch { Warn "적용 기록을 읽지 못했습니다: $applyLog ($($_.Exception.Message))" }
  foreach($l in $applyOut){ if("$l".Trim() -ne ""){ Log "      $l" } }
  Info "적용 기록: $applyLog"
  $affected = $null
  foreach($l in $applyOut){ if("$l".Trim() -match '^affected=(\d+)$'){ $affected = $Matches[1] } }
  $committed = @($applyOut | Where-Object { "$_".Trim() -eq 'committed' }).Count -gt 0

  if($applyRc -ne 0 -or -not $committed -or "$affected" -ne "$planCount"){
    Log ""
    Log "==== 변경이 끝까지 가지 않았습니다(mysql 종료코드 $applyRc, 바뀐 행 [$affected], 계획 $planCount) ====" 'Red'
    foreach($w in @($applyOut | Where-Object { "$_" -match 'ERROR \d+' })){ Log "  이유: $w" 'Red' }
    $leftNow = QTry $SQL_NOT_ALL
    if("$leftNow" -eq "$planCount"){
      Log "  지금 'all' 이 아닌 행이 계획과 같은 $leftNow 행입니다. 트랜잭션이 되돌려졌고 바뀐 것은 없습니다." 'Yellow'
      Log "  관리 화면에서 직원을 고치는 중이었다면 끝난 뒤 다시 실행하세요. 되돌리기 파일은 쓸 일이 없습니다." 'Yellow'
      Finish $EXIT_FAIL "중단: 변경을 되돌렸습니다(종료코드 $EXIT_FAIL). 아무것도 바뀌지 않았습니다." 'Red'
    }
    Log "  지금 'all' 이 아닌 행: [$leftNow] (계획 $planCount). 상태를 확인할 수 없거나 계획과 다릅니다." 'Red'
    Log "  분포를 직접 보고, 필요하면 되돌리기 파일을 부으세요: $revertPath" 'Red'
    Log "     $mysqlHint"
    Finish $EXIT_FAIL "중단: 변경 결과를 확인하지 못했습니다(종료코드 $EXIT_FAIL). 위 상태를 확인하세요." 'Red'
  }
  Ok "변경 커밋: $affected 행 (계획 $planCount)"

  # ==========================================================================
  #  [3/3] 확인
  # ==========================================================================
  Step 3 "확인"
  $left = QTry $SQL_NOT_ALL
  if("$left" -ne "0"){
    Log "  커밋 뒤에 'all' 이 아닌 행이 [$left] 입니다(기대 0). 그 사이 다른 연결이 바꿨을 수 있습니다." 'Red'
    ShowDist "지금 분포" | Out-Null
    Log "  다시 실행하면 남은 행만 바꿉니다. 이번 변경의 되돌리기 파일: $revertPath" 'Yellow'
    Finish $EXIT_FAIL "중단: 확인 실패(종료코드 $EXIT_FAIL). 이번 $affected 행은 이미 바뀌었습니다." 'Red'
  }
  Ok "'all' 이 아닌 행: 0"
  ShowDist "새 분포" | Out-Null
  Log ""
  Log "  되돌리기 파일: $revertPath"
  Log "     되돌리려면: $mysqlHint"
  Log ""
  Log "  위젯은 다시 시작할 필요가 없습니다. 열람 범위는 구성원 창이나 사람 고르기 목록을 열 때, 그리고 다른 사람 일정을 열 때마다 DB 에서 새로 읽습니다." 'Cyan'
  Log "  이미 열려 있는 구성원 창이나 사람 고르기 목록만 닫았다가 다시 여세요." 'Cyan'
  Finish $EXIT_OK "완료: '$DbName' 의 app_user $total 행이 모두 전체(all)입니다. 이번에 $affected 행을 바꿨습니다(종료코드 $EXIT_OK)." 'Green'
} finally {
  # exit(Finish) 로 끝나도 finally 는 돈다. Cleanup 은 두 번 불려도 안전하다.
  Cleanup
}
