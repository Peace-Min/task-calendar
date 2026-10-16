<#
  reviewer-account.ps1: 외부 검토자가 자기 PC 에서 캘린더 DB(taskcalendar)를 읽기만 하도록 전용 MySQL 계정을 만드는 운영 도구.
  보통은 reviewer-account.cmd 를 관리자 권한으로 실행한다(방화벽 규칙 때문에).

  왜 있나
    검토자가 Workbench, DBeaver, HeidiSQL 같은 클라이언트로 DB 를 직접 보고 싶어 한다.
    - root 를 주면 안 된다. root 는 root@localhost 하나뿐이라 다른 PC 에서는 붙지도 못하고, 붙더라도 모든 권한이다.
    - 앱 계정(taskmgr_app)도 안 된다. 쓰기 권한이 있고, 비밀번호가 위젯 설정에 들어 있어 바꾸면 위젯이 끊긴다.
    그래서 검토자 PC 의 IP 에서만 붙는 전용 계정을 만들고 SELECT, SHOW VIEW 만 준다.

  무엇을 바꾸나
    MySQL 의 계정과 권한 정보(mysql 시스템 스키마)만. <DbName> 안의 표와 행은 하나도 바꾸지 않는다.
    방화벽: 관리자 권한이면 받는 규칙 하나(TaskCalendar MySQL reviewer <IP>)를 만들거나 지운다.

  ⚠️ 데이터 노출: 이 계정은 <DbName> 의 모든 표를 읽는다. 모든 직원의 일정, 할 일, 주간보고, 이름과 조직이 다 보인다.
     검토가 끝나면 -Drop 으로 지운다.

  하는 일(화면에 [n/3] 으로 찍힌다. 첫 실패에서 멈춘다)
    [0] 사전 점검: 인자(IP, 계정 이름), mysql.exe, 관리 자격, 접속, bind_address, port, skip_networking 을 보여 준다.
        원격 접속이 막힌 설정(skip_networking=ON, bind_address 가 127.0.0.1 이나 localhost 뿐)이면 크게 경고하고
        서비스 binPath 의 --defaults-file(my.ini) 경로를 알려 준다(계정은 계속 만든다).
        mandatory_roles 가 비어 있지 않으면 읽기 전용을 보장할 수 없어 멈춘다.
    만들기(기본)
      [1] 계정: '<UserName>'@'<IP>' 가 이미 있으면 멈춘다(종료코드 3). -ResetPassword 면 비밀번호만 바꾼다(ALTER USER).
          확인(Y) 뒤 검토자 비밀번호를 받고, 임시 SQL 파일을 mysql 의 stdin 으로 흘려 CREATE USER 와 GRANT SELECT, SHOW VIEW 를 낸다.
          SHOW GRANTS FOR 로 USAGE 와 그 DB 의 SELECT, SHOW VIEW 두 줄뿐인지 본다. 다르면 DROP USER 로 되돌리고 멈춘다(종료코드 1).
          -AllowLocal -ReviewerIp 127.0.0.1 이면 그 계정으로 실제로 붙어 읽기는 되고 쓰기는 거부되는지도 본다.
      [2] 방화벽: 관리자 권한이면 받는 규칙을 만든다(같은 이름의 옛 규칙은 지우고 다시). TCP <port>, RemoteAddress <IP>
          (/24 꼴이면 a.b.c.0/24), Profile Domain,Private. 관리자 권한이 아니면 실패하지 않고 관리자 PowerShell 에서
          칠 New-NetFirewallRule 명령을 그대로 보여 준다. 규칙을 만들다 실패하면 종료코드 6(계정은 만들어진 상태).
      [3] 접속 안내: 이 PC 의 IPv4, 포트, 계정 이름, DB 이름, 클라이언트별 입력 칸. 비밀번호는 화면에 찍지 않는다.
    -Drop: DROP USER IF EXISTS '<UserName>'@'<IP>', 사라졌는지 확인, 그 계정의 열린 세션을 끊는다. 방화벽 규칙은
          관리자 권한이면 지우고, 아니면 지우는 명령을 보여 준다.
    -List: 그 이름의 계정(모든 호스트)과 권한, TaskCalendar MySQL reviewer 방화벽 규칙을 보여 주고 끝낸다(종료코드 0).
    화면에 찍힌 모든 줄은 <OutDir>\reviewer-account-<시각>.txt 로 남긴다(실패면 이름 끝에 -FAILED).

  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
    0 ok - the account was created (or its password reset, or it was dropped, or listed) and verified
    1 account step failed - CREATE/GRANT/ALTER/DROP or the grant check failed; a newly created account was dropped again (rolled back)
    2 cancelled - the confirmation was not Y; nothing was changed
    3 precheck failed - bad -ReviewerIp or -UserName, tools, password, connection, DB, or the account already exists without -ResetPassword; nothing was changed
    6 firewall step failed - the account step succeeded but the firewall rule was not created or removed; run the printed command in an administrator PowerShell
  --- END EXITCODES ---

  ⚠️ 비밀번호: 이 스크립트는 비밀번호를 인자로 받지 않는다(같은 사용자의 다른 프로세스가 명령줄을 읽는다).
     관리 계정(root): (1) 환경변수 TASKMGR_ADMIN_PW, (2) 입력이 리다이렉트돼 있으면 stdin 첫 줄(상한 10초),
       (3) 대화형이면 가려진 입력. mysql 에는 임시 .cnf(--defaults-extra-file)로만 넘기고 finally 에서 지운다.
     검토자: (1) 환경변수 TASKMGR_REVIEWER_PW, (2) 대화형이면 가려진 입력 두 번. 12자 이상, 따옴표와 역슬래시와 백틱과
       공백과 한글은 받지 않는다(SQL 과 .cnf 에 그대로 들어가도 안전한 글자만). root 비밀번호와 같으면 받지 않는다.
       CREATE USER 문은 %TEMP% 의 임시 .sql 로만 쓰고 mysql 의 stdin 으로 흘린다(명령줄 금지). 실행 직후와 finally 에서 지운다.
       화면, 보고서 어디에도 찍지 않는다. mysql 출력은 비밀번호 글자를 ******** 로 가린 뒤에만 화면에 옮긴다.
       MySQL 서버 로그(general log, binlog)는 CREATE USER 의 비밀번호를 서버가 스스로 가려 적는다.

  ⚠️ 인자 값을 역슬래시로 끝내지 말 것(-OutDir "D:\x\" 등). powershell.exe 가 \" 를 이스케이프된 따옴표로 읽어
     뒤 인자를 삼킨다. 아래 AssertNoSwallow 가 그 상태를 감지하면 멈춘다(scope-all.ps1 과 같은 가드).

  창 닫힘: .cmd 로 띄우면(TC_REVIEWER_LAUNCHER=cmd) 실패는 .cmd 가, 성공은 이 스크립트가 멈춰 준다(-Yes 면 성공은 안 멈춤).
     ps1 을 직접 실행하면 종료코드와 무관하게 늘 엔터를 기다린다. stdin 이 리다이렉트된 무인 실행은 멈추지 않는다.

  예)  reviewer-account.cmd -ReviewerIp 192.168.16.25            (관리자 권한으로: 계정과 방화벽 규칙)
       reviewer-account.cmd -ReviewerIp 192.168.16.%            (그 /24 대역 어디서든)
       reviewer-account.cmd -ReviewerIp 192.168.16.25 -ResetPassword
       reviewer-account.cmd -List
       reviewer-account.cmd -Drop -ReviewerIp 192.168.16.25
       reviewer-account.cmd -AllowLocal -ReviewerIp 127.0.0.1 -NoFirewall   (이 PC 에서만 붙는 리허설용)
       무인 실행(입력이 리다이렉트되면 -Yes 가 꼭 있어야 한다. 비밀번호 자리는 예시용 자리표시다):
         set TASKMGR_ADMIN_PW=<관리자 비밀번호>
         set TASKMGR_REVIEWER_PW=<검토자 비밀번호>
         reviewer-account.cmd -ReviewerIp 192.168.16.25 -Yes
#>
[CmdletBinding()]
param(
  [string]$ReviewerIp = "",             # 검토자 PC 의 IPv4(192.168.16.25) 또는 /24 꼴(192.168.16.%). -List 말고는 꼭 있어야 한다
  [string]$UserName = "reviewer",       # 만들 MySQL 계정 이름
  [string]$DbName = "taskcalendar",     # 읽게 할 DB
  [string]$DbHost = "127.0.0.1",        # MySQL 호스트(관리 계정이 붙는 곳)
  [int]$Port = 3306,
  [string]$BaseDir = "C:\mysql",        # mysql.exe 위치(없으면 서비스 binPath, 그다음 기본 설치 경로)
  [string]$ServiceName = "MySQL84",
  [string]$DbUser = "root",             # CREATE USER 와 GRANT 를 낼 관리 계정
  [string]$OutDir = "",                 # 비우면 <스크립트>\..\..\dist\reviewer-account
  [switch]$Drop,                        # 계정을 지운다(방화벽 규칙도)
  [switch]$List,                        # 그 이름의 계정과 권한을 보여 주기만 한다
  [switch]$ResetPassword,               # 이미 있는 계정의 비밀번호만 바꾼다
  [switch]$NoFirewall,                  # 방화벽 단계를 건너뛴다
  [switch]$AllowLocal,                  # -ReviewerIp 127.0.0.1 을 허용한다(이 PC 에서만 하는 리허설용)
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
$EXIT_FIREWALL  = 6

$ADMIN_PW_ENV    = "TASKMGR_ADMIN_PW"      # 관리 자격(scope-all.ps1, migrate-code-ids.ps1 과 같은 이름)
$REVIEWER_PW_ENV = "TASKMGR_REVIEWER_PW"   # 검토자 비밀번호(무인 실행용)
$STDIN_WAIT_SEC  = 10                      # stdin 첫 줄 읽기 상한(초). 파이프가 열린 채 비어 있으면 영원히 멎는다.
$DEFAULT_MYSQL_DIR = "C:\Program Files\MySQL\MySQL Server 8.4"
$REVIEWER_PW_MIN = 12

# 검토자에게 주는 권한의 전부. GRANT 와 SHOW GRANTS 검증이 이 한 값을 쓴다(GRANT OPTION 없음).
$REVIEWER_PRIVS = "SELECT, SHOW VIEW"
$RULE_PREFIX    = "TaskCalendar MySQL reviewer "
# 이 이름으로는 만들지 않는다. 같은 이름에 더 구체적인 호스트를 붙이면 그 IP 에서 기존 계정 대신 이 계정이 맞는다
# (예: 'taskmgr_app'@'<IP>' 를 만들면 그 PC 의 위젯이 SELECT 만 가진 계정으로 붙어 깨진다).
$RESERVED_USERS = @('root', 'taskmgr_app', 'taskmgr_backup')

# 형식 검사. 값이 SQL 문자열 안에 그대로 들어가므로 여기 통과가 곧 그 자리의 안전 조건이다.
# \z 를 쓴다($ 는 끝의 줄바꿈 앞에서도 맞는다). [0-9] 를 쓴다(\d 는 다른 문자 체계의 숫자도 받는다).
$IPV4_RE  = '^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\z'
$NET24_RE = '^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.%\z'
$OCTET_RE = '^(0|[1-9][0-9]{0,2})\z'
$USER_RE  = '^[a-z][a-z0-9_]{2,31}\z'
# 검토자 비밀번호에 쓸 수 있는 글자: 출력 가능한 ASCII(0x21~0x7E)에서 " ' \ ` 를 뺀 것.
$PW_CHARS_RE = '^[\x21\x23-\x26\x28-\x5B\x5D-\x5F\x61-\x7E]+\z'

# ============================================================================
#  출력, 보고서, 종료
# ============================================================================
$script:logLines   = New-Object System.Collections.Generic.List[string]
$script:cnfPath    = $null
$script:sqlPath    = $null
$script:revCnfPath = $null
$script:reportDir  = $null
$script:ts         = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:stepTotal  = 3

function Log([string]$m, [string]$color){
  if($color){ Write-Host $m -ForegroundColor $color } else { Write-Host $m }
  $script:logLines.Add($m)
}
function Info($m){ Log "[*] $m" }
function Ok($m){   Log "[OK] $m" 'Green' }
function Warn($m){ Log "[!] $m" 'Yellow' }
function Step($n, $m){ Log ""; Log "==== [$n/$($script:stepTotal)] $m ====" 'Cyan' }

# 비밀이 든 임시 파일 셋(관리 .cnf, 검토자 SQL, 검토자 .cnf)을 지운다. 두 번 불려도 안전하다.
function Cleanup(){
  if($script:cnfPath){ Remove-Item -LiteralPath $script:cnfPath -Force -ErrorAction SilentlyContinue; $script:cnfPath = $null }
  if($script:sqlPath){ Remove-Item -LiteralPath $script:sqlPath -Force -ErrorAction SilentlyContinue; $script:sqlPath = $null }
  if($script:revCnfPath){ Remove-Item -LiteralPath $script:revCnfPath -Force -ErrorAction SilentlyContinue; $script:revCnfPath = $null }
}
function SaveReport([string]$suffix){
  $dir = $script:reportDir
  if(-not $dir){ $dir = Split-Path -Parent $PSCommandPath }
  $rp = Join-Path $dir ("reviewer-account-" + $script:ts + $suffix + ".txt")
  try {
    Write-Host "[*] 보고서: $rp"
    $script:logLines.Add("[*] 보고서: $rp")
    # BOM 을 붙인다. 메모장(구판 포함)이 한국어를 UTF-8 로 확실히 알아보게.
    [IO.File]::WriteAllLines($rp, $script:logLines.ToArray(), (New-Object System.Text.UTF8Encoding($true)))
  } catch { Write-Host "[!] 보고서를 쓰지 못했습니다: $rp ($($_.Exception.Message))" -ForegroundColor Yellow }
}
# 모든 종료가 이 한 곳을 지난다. 보고서를 남기고, 비밀이 든 임시 파일을 지우고, 코드를 낸다.
function Finish($code, [string]$lastLine, [string]$color){
  Log $lastLine $color
  if($code -eq $EXIT_OK){ SaveReport "" } else { SaveReport "-FAILED" }
  Cleanup
  # 창을 멈추나(scope-all.ps1 과 같은 규칙):
  #   stdin 이 리다이렉트됨: 멈추지 않는다 / .cmd 를 거치지 않음: 늘 멈춘다 / .cmd 가 띄움: 성공만(-Yes 면 안 멈춤)
  $pause = $false
  if([Console]::IsInputRedirected){ $pause = $false }
  elseif($env:TC_REVIEWER_LAUNCHER -ne 'cmd'){ $pause = $true }
  elseif($code -eq $EXIT_OK -and -not $Yes){ $pause = $true }
  if($pause){
    try { Read-Host "엔터를 누르면 종료" | Out-Null } catch {}
  }
  exit $code
}
# 사전 점검 실패: MySQL 계정과 방화벽에 아무것도 하지 않은 상태에서만 부른다.
function DiePre([string]$m){
  Log "[사전 점검 실패] $m" 'Red'
  Finish $EXIT_PRECHECK "중단: 사전 점검 실패(종료코드 $EXIT_PRECHECK). 아무것도 바꾸지 않았습니다." 'Red'
}

# ============================================================================
#  인자 검증
# ============================================================================
$SWALLOW_FLAGS = '\s-(ReviewerIp|UserName|DbName|DbHost|Port|BaseDir|ServiceName|DbUser|OutDir|Drop|List|ResetPassword|NoFirewall|AllowLocal|Yes)\b'
function AssertNoSwallow($label, $val){
  if("$val" -match '"'){ DiePre "$label 값에 따옴표가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태입니다. 경로 끝의 역슬래시를 빼고 다시 실행하세요(예: -OutDir `"D:\ops`")." }
  if("$val" -match $SWALLOW_FLAGS){ DiePre "$label 값 안에 다른 인자가 들어 있습니다: [$val]. 경로 끝의 역슬래시를 빼고 다시 실행하세요." }
}

function OctetOk([string]$s){ return ($s -cmatch $OCTET_RE) -and ([int]$s -le 255) }
# -ReviewerIp 를 MySQL 호스트 값과 방화벽 RemoteAddress 로 바꾼다. 받는 꼴은 둘뿐이다:
#   IPv4 하나(192.168.16.25), /24 꼴(192.168.16.%). 127.0.0.1 은 -AllowLocal 이 있을 때만.
#   '%' 하나, 빈 값, 이름(localhost 등), 다른 와일드카드, 0.x, 127.x(127.0.0.1 밖), 224 이상은 받지 않는다.
function ParseReviewerHost([string]$v, [bool]$allowLoopback){
  $res = @{ Ok = $false; Kind = ''; AcctHost = ''; Remote = ''; Why = '' }
  if([string]::IsNullOrEmpty($v)){ $res.Why = "비어 있습니다."; return $res }
  if($v -eq '%'){ $res.Why = "'%' 는 어느 PC 에서든 접속을 허용합니다. 받지 않습니다."; return $res }
  $m4 = [regex]::Match($v, $IPV4_RE)
  $m3 = [regex]::Match($v, $NET24_RE)
  $oct = @()
  if($m4.Success){ $oct = @($m4.Groups[1].Value, $m4.Groups[2].Value, $m4.Groups[3].Value, $m4.Groups[4].Value) }
  elseif($m3.Success){ $oct = @($m3.Groups[1].Value, $m3.Groups[2].Value, $m3.Groups[3].Value) }
  else { $res.Why = "IPv4 하나(예: 192.168.16.25)나 /24 꼴(예: 192.168.16.%)만 받습니다."; return $res }
  foreach($o in $oct){ if(-not (OctetOk $o)){ $res.Why = "IPv4 의 각 자리는 0~255 이고 앞에 0 을 붙이지 않습니다: [$o]"; return $res } }
  $first = [int]$oct[0]
  if($first -eq 0 -or $first -ge 224){ $res.Why = "0 이나 224 이상으로 시작하는 주소는 받지 않습니다."; return $res }
  if($first -eq 127){
    if($m4.Success -and $v -eq '127.0.0.1' -and $allowLoopback){
      $res.Ok = $true; $res.Kind = 'local'; $res.AcctHost = '127.0.0.1'; $res.Remote = '127.0.0.1'; return $res
    }
    $res.Why = "127.x 는 이 PC 자신입니다. 리허설이면 -AllowLocal -ReviewerIp 127.0.0.1 로만 받습니다."; return $res
  }
  if($m4.Success){
    $res.Ok = $true; $res.Kind = 'ip'; $res.AcctHost = $v; $res.Remote = $v; return $res
  }
  $res.Ok = $true; $res.Kind = 'net24'; $res.AcctHost = $v
  $res.Remote = ($oct -join '.') + '.0/24'
  return $res
}

function Sha256Hex([string]$s){
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s))) -replace '-', '') }
  finally { $sha.Dispose() }
}

$modeCount = @($Drop.IsPresent, $List.IsPresent, $ResetPassword.IsPresent | Where-Object { $_ }).Count
$mode = 'create'
if($Drop){ $mode = 'drop' } elseif($List){ $mode = 'list' } elseif($ResetPassword){ $mode = 'reset' }
if($mode -eq 'list'){ $script:stepTotal = 1 }

$title = "검토자 읽기 전용 계정 만들기"
if($mode -eq 'reset'){ $title = "검토자 계정 비밀번호 바꾸기" }
elseif($mode -eq 'drop'){ $title = "검토자 계정 지우기" }
elseif($mode -eq 'list'){ $title = "검토자 계정 보기" }
Log "=================================================="
Log "   $title`: $UserName"
Log "   DB: $DbName (서버 $DbHost`:$Port)"
Log "=================================================="

Step 0 "사전 점검"
AssertNoSwallow "-ReviewerIp"  $ReviewerIp
AssertNoSwallow "-UserName"    $UserName
AssertNoSwallow "-DbName"      $DbName
AssertNoSwallow "-DbHost"      $DbHost
AssertNoSwallow "-BaseDir"     $BaseDir
AssertNoSwallow "-ServiceName" $ServiceName
AssertNoSwallow "-DbUser"      $DbUser
AssertNoSwallow "-OutDir"      $OutDir

function FullPath([string]$fp){
  if(-not [IO.Path]::IsPathRooted($fp)){ $fp = Join-Path (Get-Location).ProviderPath $fp }
  return [IO.Path]::GetFullPath($fp)
}
$scriptDir = Split-Path -Parent $PSCommandPath
if(-not $OutDir){ $OutDir = Join-Path $scriptDir "..\..\dist\reviewer-account" }
$OutDir = FullPath $OutDir
# 보고서 폴더를 지금 잡는다. 사전 점검(3)이나 취소(2)로 끝나도 보고서가 남게.
if(-not (Test-Path -LiteralPath $OutDir)){ try { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null } catch {} }
if(Test-Path -LiteralPath $OutDir -PathType Container){ $script:reportDir = $OutDir }

if($modeCount -gt 1){ DiePre "-Drop, -List, -ResetPassword 는 하나만 줄 수 있습니다." }
if($DbName -notmatch '^[A-Za-z0-9_]+$'){ DiePre "-DbName 이 식별자 형식이 아닙니다: [$DbName]" }
if($DbUser -notmatch '^[A-Za-z0-9_.$-]+$'){ DiePre "-DbUser 가 식별자 형식이 아닙니다: [$DbUser]" }
if($DbHost -notmatch '^[A-Za-z0-9_.:-]+$'){ DiePre "-DbHost 형식이 이상합니다: [$DbHost]" }
if($Port -lt 1 -or $Port -gt 65535){ DiePre "-Port 범위가 아닙니다: $Port" }
if($UserName -cnotmatch $USER_RE){ DiePre "-UserName 은 소문자로 시작하고 소문자, 숫자, 밑줄만 쓴 3~32자여야 합니다: [$UserName]" }
if($RESERVED_USERS -contains $UserName -or $UserName -eq $DbUser){
  DiePre "-UserName '$UserName' 은 이미 다른 용도로 쓰는 계정 이름입니다($($RESERVED_USERS -join ', '), 관리 계정). 다른 이름을 주세요."
}
$dbIsLocal = @('127.0.0.1', 'localhost', '::1') -contains $DbHost

# 무인 실행(입력 리다이렉트)에서는 확인 질문에 답할 사람이 없다. -Yes 를 요구한다(-List 는 묻지 않는다).
if([Console]::IsInputRedirected -and -not $Yes -and $mode -ne 'list'){ DiePre "입력이 리다이렉트된 무인 실행에서는 확인(Y)을 받을 수 없습니다. -Yes 를 함께 주세요." }

# --- 검토자 IP: -List 말고는 꼭 있어야 한다. 대화형이고 비어 있으면 묻는다 ---
$hostInfo = $null
if($mode -ne 'list'){
  if(-not $ReviewerIp -and -not [Console]::IsInputRedirected){
    $ReviewerIp = Read-Host "검토자 PC 의 IP(예: 192.168.16.25, 대역이면 192.168.16.%)"
    $ReviewerIp = "$ReviewerIp".Trim()
    AssertNoSwallow "-ReviewerIp" $ReviewerIp
  }
  $hostInfo = ParseReviewerHost $ReviewerIp ([bool]$AllowLocal)
  if(-not $hostInfo.Ok){ DiePre "-ReviewerIp [$ReviewerIp] 를 쓸 수 없습니다. $($hostInfo.Why)" }
  $acctHost = $hostInfo.AcctHost
  Ok "검토자 호스트: '$UserName'@'$acctHost' (방화벽 RemoteAddress $($hostInfo.Remote))"
  # 지우는 명령(안내용). 기본값과 다른 인자만 붙인다.
  $dropHint = "reviewer-account.cmd -Drop -ReviewerIp $ReviewerIp"
  if($UserName -ne 'reviewer'){ $dropHint += " -UserName $UserName" }
  if($DbHost -ne '127.0.0.1'){ $dropHint += " -DbHost $DbHost" }
  if($Port -ne 3306){ $dropHint += " -Port $Port" }
  if($hostInfo.Kind -eq 'local'){ $dropHint += " -AllowLocal -NoFirewall" }
}

# 무인 실행에서 검토자 비밀번호는 환경변수로만 받는다(stdin 첫 줄은 관리 자격 자리다). 접속 전에 미리 본다.
if(($mode -eq 'create' -or $mode -eq 'reset') -and [Console]::IsInputRedirected -and
   [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($REVIEWER_PW_ENV))){
  DiePre "입력이 리다이렉트된 무인 실행에서는 검토자 비밀번호를 환경변수 $REVIEWER_PW_ENV 로 주세요."
}

# --- 도구: -BaseDir, 서비스 binPath, 기본 설치 경로 순서로 mysql.exe 를 찾는다 ---
$toolRoots = New-Object System.Collections.Generic.List[string]
$toolRoots.Add($BaseDir)
$svcPath = ""
try {
  $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  if($svc){ $svcPath = "$($svc.PathName)" }
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
if($script:reportDir){ Ok "기록 폴더: $OutDir" } else { Warn "기록 폴더를 만들지 못했습니다: $OutDir (보고서는 스크립트 폴더에 남깁니다)" }

# my.ini 위치: 서비스 binPath 의 --defaults-file. 원격 접속이 막혔을 때 고칠 곳을 알려 주려고 읽는다.
$myIni = ""
$mIni = [regex]::Match($svcPath, '--defaults-file=(?:"([^"]+)"|(\S+))')
if($mIni.Success){ $myIni = $mIni.Groups[1].Value; if(-not $myIni){ $myIni = $mIni.Groups[2].Value } }

# --- 관리자 비밀번호: 환경변수, stdin 첫 줄(상한), 가려진 입력 순서 ---
# stdin 첫 줄을 상한 안에 읽는다(scope-all.ps1, migrate-code-ids.ps1 과 같은 구현). [Console]::In.ReadLine() 은
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
# 검토자 비밀번호가 관리 비밀번호와 같은지 보려고 해시만 남긴다(관리 비밀번호 글자는 .cnf 를 쓴 뒤 버린다).
$script:adminPwSha = Sha256Hex $adminPw

# 검토자 비밀번호 검사. 문제를 설명하는 글을 돌려준다(비밀번호 글자는 담지 않는다). 문제가 없으면 빈 글.
function ReviewerPwProblem([string]$cand){
  if([string]::IsNullOrEmpty($cand)){ return "비어 있습니다." }
  if($cand.Length -lt $REVIEWER_PW_MIN){ return "$REVIEWER_PW_MIN 자 이상이어야 합니다." }
  if($cand -cnotmatch $PW_CHARS_RE){ return "영문, 숫자, 기호만 씁니다. 따옴표(' `"), 역슬래시(\), 백틱(``), 공백, 한글은 쓸 수 없습니다." }
  if((Sha256Hex $cand) -eq $script:adminPwSha){ return "관리 계정($DbUser) 비밀번호와 같습니다. 다른 비밀번호를 쓰세요." }
  return ""
}
function ReadMasked([string]$prompt){
  $ss = Read-Host $prompt -AsSecureString
  $bs = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bs) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bs) }
}
# 검토자 비밀번호: 환경변수, 그다음 가려진 입력 두 번(세 번까지 다시 묻는다). 어디에도 찍지 않는다.
function GetReviewerPw(){
  $envRev = [Environment]::GetEnvironmentVariable($REVIEWER_PW_ENV)
  if(-not [string]::IsNullOrEmpty($envRev)){
    $why = ReviewerPwProblem $envRev
    if($why){ DiePre "환경변수 $REVIEWER_PW_ENV 의 비밀번호를 쓸 수 없습니다. $why" }
    Info "검토자 비밀번호: 환경변수 $REVIEWER_PW_ENV 에서 읽었습니다. 끝나면 그 변수를 지우세요."
    return $envRev
  }
  for($attempt = 1; $attempt -le 3; $attempt++){
    $a1 = ReadMasked "검토자 비밀번호($REVIEWER_PW_MIN 자 이상)"
    $why = ReviewerPwProblem $a1
    if($why){ Warn "쓸 수 없는 비밀번호입니다. $why"; continue }
    $a2 = ReadMasked "검토자 비밀번호 한 번 더"
    $same = ($a1 -ceq $a2)
    if(-not $same){ Warn "두 번 입력한 비밀번호가 다릅니다."; continue }
    return $a1
  }
  DiePre "검토자 비밀번호를 세 번 받지 못했습니다."
}

# ============================================================================
#  여기서부터 임시 .cnf 가 생긴다. 어디서 끝나든 finally 와 Finish 가 지운다
# ============================================================================
try {
  # 임시 .cnf. 관리 비밀번호는 여기에만 쓴다(명령줄 금지). BOM 금지(MySQL 옵션 파서가 첫 줄을 못 읽는다).
  $pwEsc = ($adminPw -replace '\\','\\') -replace '"','\"'
  $adminPw = $null
  $script:cnfPath = Join-Path $env:TEMP ("myreviewer_" + [IO.Path]::GetRandomFileName() + ".cnf")
  $cnfText = "[client]`r`nuser=$DbUser`r`npassword=""$pwEsc""`r`nhost=$DbHost`r`nport=$Port`r`ndefault-character-set=utf8mb4`r`n"
  [IO.File]::WriteAllText($script:cnfPath, $cnfText, (New-Object System.Text.UTF8Encoding($false)))
  $pwEsc = $null

  # 한 결과 질의(-N -B). 실패하면 $null 을 돌려준다. 부르는 쪽이 단계에 맞는 종료코드로 끝낸다.
  function QTry([string]$sql){
    $o = & $mysql "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql
    if($LASTEXITCODE -ne 0){ return $null }
    if($null -eq $o){ return "" }
    return ((@($o) -join "`n").Trim())
  }
  # 여러 행 질의. -r(--raw): SHOW GRANTS 의 \_ 를 \\_ 로 바꾸지 않게. 빈 배열은 상자에 담아 '실패' 와 가른다.
  function QRowsTry([string]$sql){
    $o = & $mysql "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "-N" "-B" "-r" "-e" $sql
    if($LASTEXITCODE -ne 0){ return @{ Ok = $false; Rows = @() } }
    if($null -eq $o){ return @{ Ok = $true; Rows = @() } }
    return @{ Ok = $true; Rows = @(@($o) | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne "" }) }
  }
  function QPre([string]$sql, [string]$what){
    $v = QTry $sql
    if($null -eq $v){ DiePre "$what 질의가 실패했습니다. 위에 찍힌 mysql 오류를 확인하세요." }
    return $v
  }
  function IsElevated(){
    try {
      $wid = [Security.Principal.WindowsIdentity]::GetCurrent()
      return (New-Object Security.Principal.WindowsPrincipal($wid)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
  }
  function ShowGrants([string]$acct){
    $g = QRowsTry "SHOW GRANTS FOR '$UserName'@'$acct';"
    if(-not $g.Ok){ Warn "  '$UserName'@'$acct' 의 권한을 읽지 못했습니다."; return $g }
    foreach($line in @($g.Rows)){ Log "      $line" }
    return $g
  }

  # --- 접속 ---
  $serverVer = QTry "SELECT VERSION();"
  if($null -eq $serverVer){ DiePre "MySQL 에 접속하지 못했습니다($DbUser@$DbHost`:$Port). 위 mysql 오류(비밀번호, 서비스 실행 여부)를 확인하세요." }
  Ok "접속: MySQL $serverVer"

  # --- 서버의 네트워크 설정: 다른 PC 에서 붙을 수 있는지 ---
  $bindAddr = QPre "SELECT @@bind_address;" "bind_address"
  $srvPort  = QPre "SELECT @@port;" "port"
  $skipNet  = QPre "SELECT @@skip_networking;" "skip_networking"
  $partRev  = QPre "SELECT @@partial_revokes;" "partial_revokes"
  $mandRoles = QPre "SELECT @@mandatory_roles;" "mandatory_roles"
  $skipNetText = 'OFF'; if("$skipNet" -eq '1'){ $skipNetText = 'ON' }
  Info "bind_address = $bindAddr, port = $srvPort, skip_networking = $skipNetText"
  if("$srvPort" -notmatch '^[0-9]+$'){ DiePre "서버 port 값이 숫자가 아닙니다: [$srvPort]" }
  if("$srvPort" -ne "$Port"){ Warn "서버가 알려 준 port($srvPort)가 -Port($Port)와 다릅니다. 검토자 안내와 방화벽에는 서버 값 $srvPort 를 씁니다." }
  $bindList = @("$bindAddr".Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $loopOnly = ($bindList.Count -gt 0) -and (@($bindList | Where-Object { $_ -notmatch '^(127\.[0-9.]+|::1|localhost)$' }).Count -eq 0)
  $script:netBlocked = ("$skipNet" -eq '1') -or $loopOnly
  if($script:netBlocked){
    Log ""
    Log "  [경고] 지금 설정으로는 다른 PC 에서 이 MySQL 에 붙을 수 없습니다." 'Yellow'
    if("$skipNet" -eq '1'){ Log "    skip_networking 이 ON 입니다(TCP 접속을 아예 받지 않습니다)." 'Yellow' }
    if($loopOnly){ Log "    bind_address 가 [$bindAddr] 라 이 PC 안에서만 받습니다." 'Yellow' }
    if($myIni){ Log "    고칠 곳: $myIni (서비스 $ServiceName 의 --defaults-file)" 'Yellow' }
    else { Log "    고칠 곳: MySQL 설정 파일(my.ini). 서비스 $ServiceName 의 binPath 에서 --defaults-file 을 찾지 못했습니다. services.msc 의 실행 파일 경로를 보세요." 'Yellow' }
    Log "    [mysqld] 절에서 skip-networking 줄을 지우고 bind-address=0.0.0.0(또는 이 PC 의 내부망 IP)로 둔 뒤," 'Yellow'
    Log "    관리자 명령 창에서 net stop $ServiceName 그다음 net start $ServiceName 으로 다시 띄웁니다. 그동안 위젯은 끊깁니다." 'Yellow'
    Log "    계정은 계속 만듭니다. 설정을 고치기 전에는 검토자가 붙지 못합니다." 'Yellow'
    Log ""
  } else {
    Ok "원격 접속 설정: 다른 PC 의 TCP 접속을 받습니다."
  }
  if("$mandRoles".Trim() -ne ""){
    DiePre "mandatory_roles 가 [$mandRoles] 입니다. 모든 계정에 붙는 역할이 있어 읽기 전용을 보장할 수 없습니다."
  }
  # DB 수준 GRANT 의 _ 는 와일드카드다(partial_revokes 가 OFF 일 때). 글자 그대로 그 DB 하나만 가리키도록 \_ 로 적는다.
  $dbGrant = $DbName
  if("$partRev" -ne '1'){ $dbGrant = $DbName.Replace('_', '\_') }

  # --- DB ---
  $dbExists = [int](QPre "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$DbName';" "DB 유무")
  if($mode -eq 'create' -or $mode -eq 'reset'){
    if($dbExists -lt 1){ DiePre "DB '$DbName' 가 없습니다. -DbName 을 확인하세요." }
    $tblCount = QPre "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '$DbName';" "표 수"
    Ok "DB '$DbName': 표 $tblCount 개"
  } elseif($dbExists -lt 1){
    Warn "DB '$DbName' 가 없습니다(계정 일에는 상관없습니다)."
  }

  # 방화벽 규칙 이름과 명령. 만들기, 지우기, 보기가 같이 쓴다.
  $fwPort = "$srvPort"

  # ==========================================================================
  #  -List: 그 이름의 계정(모든 호스트), 권한, 방화벽 규칙
  # ==========================================================================
  if($mode -eq 'list'){
    Step 1 "목록"
    $acc = QRowsTry "SELECT Host, account_locked, password_expired, IFNULL(DATE_FORMAT(password_last_changed, '%Y-%m-%d %H:%i'), '') FROM mysql.user WHERE User = '$UserName' ORDER BY Host;"
    if(-not $acc.Ok){ Finish $EXIT_PRECHECK "중단: mysql.user 를 읽지 못했습니다(종료코드 $EXIT_PRECHECK)." 'Red' }
    if(@($acc.Rows).Count -eq 0){ Info "'$UserName' 이름의 계정이 없습니다." }
    foreach($row in @($acc.Rows)){
      $f = "$row".Split("`t")
      $hh = "$($f[0])"
      Log ("  '{0}'@'{1}'  잠금 {2}, 만료 {3}, 비밀번호 바꾼 때 {4}" -f $UserName, $hh, $f[1], $f[2], $f[3])
      if($hh -notmatch '^[A-Za-z0-9.%:_-]+$'){ Warn "  호스트 값이 특이해 권한을 읽지 않습니다: [$hh]"; continue }
      ShowGrants $hh | Out-Null
    }
    try {
      $rules = @(Get-NetFirewallRule -DisplayName "$RULE_PREFIX*" -ErrorAction SilentlyContinue)
      if($rules.Count -eq 0){ Info "방화벽 규칙($RULE_PREFIX*): 없음" }
      foreach($rule in $rules){
        $af = $rule | Get-NetFirewallAddressFilter
        $pf = $rule | Get-NetFirewallPortFilter
        Log ("  방화벽: {0}  켜짐 {1}, TCP {2}, 원격 {3}, 프로필 {4}" -f $rule.DisplayName, $rule.Enabled, ($pf.LocalPort -join ','), ($af.RemoteAddress -join ','), $rule.Profile)
      }
    } catch { Warn "방화벽 규칙을 읽지 못했습니다: $($_.Exception.Message)" }
    Finish $EXIT_OK "완료: 목록을 보여 줬습니다. 바꾼 것은 없습니다(종료코드 $EXIT_OK)." 'Green'
  }

  $ruleName = $RULE_PREFIX + $acctHost
  $fwNewCmd = "New-NetFirewallRule -DisplayName `"$ruleName`" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $fwPort -RemoteAddress $($hostInfo.Remote) -Profile Domain,Private"
  $fwDelCmd = "Remove-NetFirewallRule -DisplayName `"$ruleName`""
  # 방화벽을 이 PC 에서 다룰 이유가 있나: 건너뛰기, 이 PC 자신(127.0.0.1), DB 서버가 다른 PC 면 다루지 않는다.
  $fwSkipWhy = ""
  if($NoFirewall){ $fwSkipWhy = "-NoFirewall" }
  elseif($hostInfo.Kind -eq 'local'){ $fwSkipWhy = "검토자가 이 PC 자신(127.0.0.1)이라 방화벽을 거치지 않습니다" }
  elseif(-not $dbIsLocal){ $fwSkipWhy = "DB 서버($DbHost)가 이 PC 가 아닙니다. 규칙은 그 PC 에서 만들어야 합니다" }

  $existsNow = [int](QPre "SELECT COUNT(*) FROM mysql.user WHERE User = '$UserName' AND Host = '$acctHost';" "계정 유무")
  $others = QRowsTry "SELECT Host FROM mysql.user WHERE User = '$UserName' AND Host <> '$acctHost' ORDER BY Host;"
  if($others.Ok -and @($others.Rows).Count -gt 0){
    Info "같은 이름의 다른 호스트 계정: $(@($others.Rows | ForEach-Object { "'$UserName'@'$_'" }) -join ', ') (이 실행은 건드리지 않습니다)"
  }

  # ==========================================================================
  #  -Drop
  # ==========================================================================
  if($mode -eq 'drop'){
    if($existsNow -lt 1){ Info "'$UserName'@'$acctHost' 계정이 없습니다. 방화벽 규칙만 정리합니다." }
    else {
      Log "  지금 권한:"
      ShowGrants $acctHost | Out-Null
    }
    Log ""
    Log "  지울 계정 : '$UserName'@'$acctHost'"
    if($fwSkipWhy){ Log "  방화벽    : 건너뜀($fwSkipWhy)" } else { Log "  방화벽    : 규칙 '$ruleName' 를 지웁니다(관리자 권한일 때)" }
    if(-not $Yes){
      $ans = Read-Host "지우려면 Y"
      if("$ans".Trim() -ne 'Y'){ Finish $EXIT_CANCEL "취소했습니다. 아무것도 바꾸지 않았습니다(종료코드 $EXIT_CANCEL)." 'White' }
    }

    Step 1 "계정 지우기"
    if($existsNow -ge 1){
      $dr = QTry "DROP USER IF EXISTS '$UserName'@'$acctHost';"
      $left = QTry "SELECT COUNT(*) FROM mysql.user WHERE User = '$UserName' AND Host = '$acctHost';"
      if($null -eq $dr -or "$left" -ne '0'){
        Finish $EXIT_FAIL "중단: '$UserName'@'$acctHost' 를 지우지 못했습니다(남은 수 [$left], 종료코드 $EXIT_FAIL). 위 mysql 오류를 확인하세요." 'Red'
      }
      Ok "'$UserName'@'$acctHost' 를 지웠습니다(mysql.user 에 0 행)."
      # DROP USER 는 이미 열린 세션을 끊지 않는다. 이 호스트에서 온 그 계정의 세션을 끊는다.
      $sess = QRowsTry "SELECT ID, HOST FROM information_schema.PROCESSLIST WHERE USER = '$UserName';"
      foreach($row in @($sess.Rows)){
        $f = "$row".Split("`t")
        $sid = "$($f[0])"; $peer = "$($f[1])" -replace ':[0-9]+$', ''
        $mine = $false
        if($hostInfo.Kind -eq 'net24'){ $mine = $peer.StartsWith($acctHost.TrimEnd('%')) }
        elseif($hostInfo.Kind -eq 'local'){ $mine = ($peer -eq '127.0.0.1' -or $peer -eq 'localhost') }
        else { $mine = ($peer -eq $acctHost) }
        if($sid -notmatch '^[0-9]+$'){ continue }
        if($mine){
          if($null -ne (QTry "KILL $sid;")){ Ok "열린 세션 $sid ($peer) 를 끊었습니다." } else { Warn "세션 $sid ($peer) 를 끊지 못했습니다. 관리 계정으로 KILL $sid; 를 실행하세요." }
        } else { Info "그 이름의 다른 세션 $sid ($peer) 은 이 호스트가 아니라 두었습니다." }
      }
    }

    Step 2 "방화벽 규칙 지우기"
    if($fwSkipWhy){
      Info "건너뜁니다($fwSkipWhy). 규칙이 있으면 관리자 PowerShell 에서:"
      Log "     $fwDelCmd"
    } elseif(-not (IsElevated)){
      Warn "관리자 권한이 아니라 방화벽 규칙을 지우지 않았습니다. 관리자 PowerShell 에서 아래를 실행하세요:"
      Log "     $fwDelCmd"
    } else {
      try {
        $old = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
        if($old.Count -eq 0){ Info "규칙 '$ruleName' 가 없습니다." }
        else {
          $old | Remove-NetFirewallRule -ErrorAction Stop
          if(@(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue).Count -ne 0){ throw "지운 뒤에도 규칙이 남아 있습니다." }
          Ok "방화벽 규칙 '$ruleName' 를 지웠습니다($($old.Count)개)."
        }
      } catch {
        Log "  방화벽 규칙을 지우지 못했습니다: $($_.Exception.Message)" 'Red'
        Log "  관리자 PowerShell 에서: $fwDelCmd"
        Finish $EXIT_FIREWALL "중단: 계정은 지웠지만 방화벽 규칙을 지우지 못했습니다(종료코드 $EXIT_FIREWALL)." 'Red'
      }
    }
    Step 3 "정리"
    Finish $EXIT_OK "완료: '$UserName'@'$acctHost' 를 지웠습니다(종료코드 $EXIT_OK)." 'Green'
  }

  # ==========================================================================
  #  만들기와 비밀번호 바꾸기: 확인
  # ==========================================================================
  if($mode -eq 'create' -and $existsNow -ge 1){
    Log "  지금 권한:"
    ShowGrants $acctHost | Out-Null
    DiePre "'$UserName'@'$acctHost' 계정이 이미 있습니다. 비밀번호만 바꾸려면 -ResetPassword, 지우려면 -Drop 을 주세요."
  }
  if($mode -eq 'reset' -and $existsNow -lt 1){
    DiePre "'$UserName'@'$acctHost' 계정이 없습니다. -ResetPassword 없이 실행하면 새로 만듭니다."
  }
  Log ""
  Log "  계정      : '$UserName'@'$acctHost'"
  Log "  DB        : $DbName (서버 $DbHost`:$srvPort)"
  if($mode -eq 'create'){
    Log "  권한      : 읽기 전용($REVIEWER_PRIVS), 이 DB 하나. GRANT OPTION 없음."
  } else {
    Log "  할 일     : 비밀번호만 바꿉니다(ALTER USER). 권한은 그대로입니다."
  }
  if($fwSkipWhy){ Log "  방화벽    : 건너뜀($fwSkipWhy)" } else { Log "  방화벽    : 받는 규칙 '$ruleName' (TCP $fwPort, 원격 $($hostInfo.Remote), Domain,Private)" }
  Log "  [주의] 이 계정은 '$DbName' 의 모든 표를 읽습니다. 모든 직원의 일정, 할 일, 주간보고, 이름과 조직이 보입니다." 'Yellow'
  Log "         검토가 끝나면 $dropHint 로 지우세요." 'Yellow'
  if(-not $Yes){
    $ans = Read-Host "계속하려면 Y"
    if("$ans".Trim() -ne 'Y'){ Finish $EXIT_CANCEL "취소했습니다. 아무것도 바꾸지 않았습니다(종료코드 $EXIT_CANCEL)." 'White' }
  }

  # ==========================================================================
  #  [1/3] 계정: 임시 SQL 을 stdin 으로. 검증이 어긋나면 새로 만든 계정은 DROP USER 로 되돌린다
  # ==========================================================================
  Step 1 "계정"
  $revPw = GetReviewerPw
  $why = ReviewerPwProblem $revPw
  if($why){ DiePre "검토자 비밀번호 검사를 통과하지 못했습니다. $why" }
  # 새로 만든 계정만 되돌린다(-ResetPassword 는 원래 있던 계정이라 지우지 않는다).
  function Rollback([string]$why){
    if($mode -ne 'create'){
      Finish $EXIT_FAIL "중단: $why (종료코드 $EXIT_FAIL). 원래 있던 계정이라 지우지 않았습니다. 위 권한을 확인하세요." 'Red'
    }
    $null = QTry "DROP USER IF EXISTS '$UserName'@'$acctHost';"
    $gone = QTry "SELECT COUNT(*) FROM mysql.user WHERE User = '$UserName' AND Host = '$acctHost';"
    if("$gone" -eq '0'){ Log "  되돌림: '$UserName'@'$acctHost' 를 DROP USER 로 지웠습니다." 'Yellow' }
    else { Log "  되돌림 실패: '$UserName'@'$acctHost' 가 남아 있습니다([$gone]). 관리 계정으로 DROP USER '$UserName'@'$acctHost'; 를 실행하세요." 'Red' }
    Finish $EXIT_FAIL "중단: $why (종료코드 $EXIT_FAIL)." 'Red'
  }

  # 비밀번호가 든 SQL 은 %TEMP% 의 임시 파일에만 쓰고 stdin 으로 흘린다. 실행 직후 지운다(finally 의 Cleanup 도 지운다).
  if($mode -eq 'create'){
    $sqlLines = @(
      "CREATE USER '$UserName'@'$acctHost' IDENTIFIED BY '$revPw' PASSWORD EXPIRE NEVER;",
      "GRANT $REVIEWER_PRIVS ON ``$dbGrant``.* TO '$UserName'@'$acctHost';",
      "SELECT 'account-done';"
    )
  } else {
    $sqlLines = @(
      "ALTER USER '$UserName'@'$acctHost' IDENTIFIED BY '$revPw';",
      "SELECT 'account-done';"
    )
  }
  $script:sqlPath = Join-Path $env:TEMP ("myreviewer_" + [IO.Path]::GetRandomFileName() + ".sql")
  try { [IO.File]::WriteAllLines($script:sqlPath, $sqlLines, (New-Object System.Text.UTF8Encoding($false))) }
  catch { $sqlLines = $null; Finish $EXIT_FAIL "중단: 임시 SQL 을 쓰지 못했습니다($($_.Exception.Message), 종료코드 $EXIT_FAIL). 바꾼 것은 없습니다." 'Red' }
  $sqlLines = $null
  $what = "ALTER USER"
  if($mode -eq 'create'){ $what = "CREATE USER, GRANT $REVIEWER_PRIVS" }
  Info "실행: $what (임시 SQL 을 stdin 으로, --force 없음)"
  $runOut = @(cmd /c "`"$mysql`" --defaults-extra-file=`"$($script:cnfPath)`" --default-character-set=utf8mb4 -N -B < `"$($script:sqlPath)`" 2>&1")
  $runRc = $LASTEXITCODE
  Remove-Item -LiteralPath $script:sqlPath -Force -ErrorAction SilentlyContinue; $script:sqlPath = $null
  # mysql 의 오류 문구는 문장 조각을 되풀이할 수 있다. 비밀번호 글자를 가린 뒤에만 화면에 옮긴다.
  $shown = @($runOut | ForEach-Object { "$_".Replace($revPw, '********') })
  foreach($l in $shown){ if("$l".Trim() -ne ""){ Log "      $l" } }
  $done = @($shown | Where-Object { "$_".Trim() -eq 'account-done' }).Count -gt 0
  if($runRc -ne 0 -or -not $done){
    $revPw = $null
    # ERROR 1396: 그 사이 같은 계정이 생겨 CREATE USER 가 실패했다. 이 실행이 만든 계정이 아니므로 지우지 않는다.
    if($mode -eq 'create' -and @($shown | Where-Object { "$_" -match 'ERROR 1396' }).Count -gt 0){
      Finish $EXIT_FAIL "중단: '$UserName'@'$acctHost' 가 그 사이 생겼습니다(ERROR 1396, 종료코드 $EXIT_FAIL). 이 실행이 만든 계정이 아니라 지우지 않았습니다." 'Red'
    }
    Rollback "계정 SQL 이 끝까지 가지 않았습니다(mysql 종료코드 $runRc)"
  }
  Ok "계정 SQL 완료"

  # --- 검증: 계정이 있고, 권한은 USAGE 와 그 DB 의 SELECT, SHOW VIEW 두 줄뿐이다 ---
  $cnt = QTry "SELECT COUNT(*) FROM mysql.user WHERE User = '$UserName' AND Host = '$acctHost';"
  if("$cnt" -ne '1'){ $revPw = $null; Rollback "계정이 mysql.user 에 [$cnt] 행입니다(1 이어야 합니다)" }
  $wantGrants = @(
    "GRANT USAGE ON *.* TO ``$UserName``@``$acctHost``",
    "GRANT $REVIEWER_PRIVS ON ``$dbGrant``.* TO ``$UserName``@``$acctHost``"
  )
  Log "  SHOW GRANTS FOR '$UserName'@'$acctHost':"
  $g = ShowGrants $acctHost
  $gotGrants = @($g.Rows | ForEach-Object { "$_".Trim() } | Sort-Object)
  $wantSorted = @($wantGrants | Sort-Object)
  if(-not $g.Ok -or (($gotGrants -join "`n") -cne ($wantSorted -join "`n"))){
    Log "  기대한 권한:" 'Red'
    foreach($w in $wantGrants){ Log "      $w" 'Red' }
    $revPw = $null
    Rollback "권한이 읽기 전용 두 줄(USAGE, $REVIEWER_PRIVS)과 다릅니다"
  }
  Ok "권한 확인: USAGE 와 '$DbName' 의 $REVIEWER_PRIVS 뿐(GRANT OPTION 없음)"

  # --- 이 PC 자신(127.0.0.1) 리허설이면 그 계정으로 실제로 붙어 본다: 읽기는 되고 쓰기는 거부돼야 한다 ---
  if($hostInfo.Kind -eq 'local' -and $dbIsLocal){
    $script:revCnfPath = Join-Path $env:TEMP ("myreviewer_" + [IO.Path]::GetRandomFileName() + ".cnf")
    $revCnfText = "[client]`r`nuser=$UserName`r`npassword=""$revPw""`r`nhost=127.0.0.1`r`nport=$srvPort`r`ndefault-character-set=utf8mb4`r`n"
    [IO.File]::WriteAllText($script:revCnfPath, $revCnfText, (New-Object System.Text.UTF8Encoding($false)))
    $revCnfText = $null
    $revPw = $null
    function QRev([string]$sql){
      $o = @(& $mysql "--defaults-extra-file=$($script:revCnfPath)" "-N" "-B" "-e" $sql 2>&1 | ForEach-Object { "$_" })
      return @{ Rc = $LASTEXITCODE; Out = $o }
    }
    $who = QRev "SELECT CURRENT_USER();"
    if($who.Rc -ne 0 -or (($who.Out -join '').Trim() -ne "$UserName@127.0.0.1")){
      foreach($l in $who.Out){ Log "      $l" 'Red' }
      Rollback "검토자 계정으로 붙지 못했습니다(CURRENT_USER [$(($who.Out -join ' ').Trim())])"
    }
    $seen = QRev "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '$DbName';"
    if($seen.Rc -ne 0){ Rollback "검토자 계정으로 '$DbName' 의 표 목록을 읽지 못했습니다" }
    Ok "검토자 계정 접속: $UserName@127.0.0.1, 보이는 표 $(($seen.Out -join '').Trim()) 개"
    # 쓰기 시험: 권한 검사에서 거부되므로 표는 생기지 않는다. 만에 하나 생기면 지우고 되돌린다.
    $probe = QRev "CREATE TABLE ``$DbName``.``reviewer_write_probe`` (x INT);"
    if($probe.Rc -eq 0){
      $null = QTry "DROP TABLE IF EXISTS ``$DbName``.``reviewer_write_probe``;"
      Rollback "검토자 계정으로 표를 만들 수 있었습니다(읽기 전용이 아닙니다)"
    }
    if(-not (@($probe.Out | Where-Object { "$_" -match 'ERROR (1142|1044)' }).Count -gt 0)){
      foreach($l in $probe.Out){ Log "      $l" 'Red' }
      Rollback "쓰기 시험의 결과를 판정하지 못했습니다(권한 거부 오류 1142 나 1044 가 아닙니다)"
    }
    Ok "쓰기 시험: 거부됨(읽기 전용 확인)"
    Remove-Item -LiteralPath $script:revCnfPath -Force -ErrorAction SilentlyContinue; $script:revCnfPath = $null
  }
  $revPw = $null

  # ==========================================================================
  #  [2/3] 방화벽: 관리자 권한일 때만 규칙을 만든다. 아니면 명령을 보여 주고 실패로 치지 않는다
  # ==========================================================================
  Step 2 "방화벽"
  $fwManual = $false
  if($fwSkipWhy){
    Info "건너뜁니다($fwSkipWhy)."
    if($NoFirewall -and $hostInfo.Kind -ne 'local'){
      Log "  나중에 규칙을 만들려면 관리자 PowerShell 에서:"
      Log "     $fwNewCmd"
    }
  } else {
    # 이미 이 포트를 누구에게나 여는 규칙이 있으면 IP 제한은 MySQL 계정 호스트만 남는다. 알려만 준다.
    try {
      $broad = @(Get-NetFirewallPortFilter -Protocol TCP -ErrorAction Stop | Where-Object { @($_.LocalPort) -contains $fwPort } |
        Get-NetFirewallRule -ErrorAction SilentlyContinue |
        Where-Object { "$($_.Enabled)" -eq 'True' -and "$($_.Direction)" -eq 'Inbound' -and "$($_.Action)" -eq 'Allow' -and $_.DisplayName -notlike "$RULE_PREFIX*" })
      foreach($rule in $broad){
        $af = $rule | Get-NetFirewallAddressFilter
        Warn "이미 TCP $fwPort 를 여는 받는 규칙: '$($rule.DisplayName)' (원격 $($af.RemoteAddress -join ','), 프로필 $($rule.Profile)). 원격이 Any 면 IP 제한은 MySQL 계정의 호스트만 남습니다."
      }
    } catch { Info "기존 방화벽 규칙을 훑지 못했습니다: $($_.Exception.Message)" }
    try {
      foreach($np in @(Get-NetConnectionProfile -ErrorAction Stop)){
        if("$($np.NetworkCategory)" -eq 'Public'){ Warn "네트워크 '$($np.InterfaceAlias)' 가 공용(Public)입니다. 이 규칙(Domain,Private)은 공용 네트워크에서는 듣지 않습니다." }
      }
    } catch {}
    if(-not (IsElevated)){
      $fwManual = $true
      Warn "관리자 권한이 아니라 방화벽 규칙을 만들지 않았습니다(계정은 만들어졌습니다). 관리자 PowerShell 에서 아래를 실행하세요:"
      Log "     $fwNewCmd"
    } else {
      try {
        $old = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
        if($old.Count -gt 0){ $old | Remove-NetFirewallRule -ErrorAction Stop; Info "같은 이름의 옛 규칙 $($old.Count)개를 지우고 다시 만듭니다." }
        New-NetFirewallRule -DisplayName $ruleName -Description "TaskCalendar reviewer read-only MySQL access ($UserName@$acctHost)" `
          -Direction Inbound -Action Allow -Protocol TCP -LocalPort $fwPort -RemoteAddress $hostInfo.Remote `
          -Profile Domain,Private -ErrorAction Stop | Out-Null
        $chk = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction Stop)
        if($chk.Count -ne 1){ throw "만든 뒤 규칙이 $($chk.Count)개입니다." }
        $pf = $chk[0] | Get-NetFirewallPortFilter
        $af = $chk[0] | Get-NetFirewallAddressFilter
        if(@($pf.LocalPort) -notcontains $fwPort){ throw "규칙의 포트가 $($pf.LocalPort -join ',') 입니다." }
        Ok "방화벽 규칙 '$ruleName': TCP $fwPort, 원격 $($af.RemoteAddress -join ','), 프로필 $($chk[0].Profile)"
      } catch {
        Log "  방화벽 규칙을 만들지 못했습니다: $($_.Exception.Message)" 'Red'
        Log "  계정은 만들어졌습니다. 관리자 PowerShell 에서 아래를 실행하세요:"
        Log "     $fwNewCmd"
        Finish $EXIT_FIREWALL "중단: 방화벽 단계 실패(종료코드 $EXIT_FIREWALL). 계정 '$UserName'@'$acctHost' 는 있습니다." 'Red'
      }
    }
  }

  # ==========================================================================
  #  [3/3] 접속 안내: 비밀번호는 찍지 않는다
  # ==========================================================================
  Step 3 "검토자에게 줄 접속 정보"
  $serverAddrs = @()
  if($hostInfo.Kind -eq 'local'){ $serverAddrs = @('127.0.0.1 (이 PC 에서만)') }
  elseif(-not $dbIsLocal){ $serverAddrs = @($DbHost) }
  else {
    $prefix = ""
    if($hostInfo.Kind -eq 'net24'){ $prefix = $acctHost.TrimEnd('%') }
    else { $prefix = ($acctHost -replace '[0-9]+$', '') }
    try {
      foreach($ip in @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Sort-Object InterfaceAlias)){
        $mark = ""; if($ip.IPAddress.StartsWith($prefix)){ $mark = "  (검토자와 같은 대역)" }
        $serverAddrs += "$($ip.IPAddress)  [$($ip.InterfaceAlias)]$mark"
      }
    } catch { Warn "이 PC 의 IPv4 주소를 읽지 못했습니다. ipconfig 로 확인하세요." }
    if($serverAddrs.Count -eq 0){ $serverAddrs = @('(찾지 못함, ipconfig 로 확인)') }
  }
  Log "  서버 주소 : $($serverAddrs[0])"
  foreach($sa in @($serverAddrs | Select-Object -Skip 1)){ Log "              $sa" }
  Log "  포트      : $srvPort"
  Log "  사용자    : $UserName"
  Log "  비밀번호  : 따로 전달(이 화면과 보고서에는 없습니다)"
  Log "  DB(스키마): $DbName"
  Log ""
  Log "  클라이언트별 입력 칸:"
  Log "    MySQL Workbench: Hostname 에 서버 주소, Port $srvPort, Username $UserName, Default Schema $DbName. 비밀번호는 Store in Vault 로."
  Log "    DBeaver: MySQL 연결에서 Server Host 에 서버 주소, Port $srvPort, Database $DbName, Username $UserName."
  Log "      'Public Key Retrieval is not allowed' 가 나오면 Driver properties 에서 allowPublicKeyRetrieval=true 로 둡니다."
  Log "    HeidiSQL: Network type 은 MySQL (TCP/IP), Hostname/IP 에 서버 주소, User $UserName, Port $srvPort, Databases 에 $DbName."
  Log "  계정은 읽기 전용이라 INSERT, UPDATE, DELETE, CREATE 는 모두 거부됩니다."
  if($script:netBlocked){ Log "  [경고] 위 사전 점검의 원격 접속 설정(my.ini)을 고치기 전에는 검토자가 붙지 못합니다." 'Yellow' }
  if($fwManual){ Log "  [할 일] 방화벽 규칙을 아직 만들지 않았습니다. 관리자 PowerShell 에서: $fwNewCmd" 'Yellow' }
  Log ""
  Log "  지우는 법: $dropHint" 'Cyan'
  $doneMsg = "완료: '$UserName'@'$acctHost' 를 만들었습니다(읽기 전용, 종료코드 $EXIT_OK)."
  if($mode -eq 'reset'){ $doneMsg = "완료: '$UserName'@'$acctHost' 의 비밀번호를 바꿨습니다(종료코드 $EXIT_OK)." }
  Finish $EXIT_OK $doneMsg 'Green'
} finally {
  # exit(Finish) 로 끝나도 finally 는 돈다. Cleanup 은 두 번 불려도 안전하다.
  Cleanup
}
