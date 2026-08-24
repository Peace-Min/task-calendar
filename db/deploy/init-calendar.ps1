<#
  init-calendar.ps1 — 캘린더(cal_*) 테이블 구축 원큐. 보통은 init-calendar.cmd 더블클릭.

  하는 일(순서):
    1) mysql.exe 찾기 → 관리자 비번 입력 → 임시 .cnf 로 접속
    2) 선행 조건 — DB / app_user / GRANT 대상 테이블 / 서버 버전 / app_user.user_id 타입·인덱스
       ★ 2026-08-24 키 전환: cal_* 13표의 소유자 키가 login_id(VARCHAR) → user_id(SMALLINT UNSIGNED,
         app_user 의 대리키) 로 바뀌었다. app_user 에 user_id 가 없으면 아무것도 만들지 않고 멈춘다.
    3) 이미 cal_* 이 있으면 행 수를 보여주고 물어봄(기본 '아니오'. -Force 로만 무인 진행)
    4) schema-calendar.sql   → cal_* 전체 + cal_schema_meta 시딩 + cal_user_rev 전원 시딩
    5) grants-calendar.sql   → 앱 계정 권한 (계정이 없으면 건너뛰고 '미완'(코드 4)으로 끝난다)
    6) 게이트 — 표 명부·개수 / rev 누락 0 / 스키마 버전 행 / GRANT 대조(전역 권한까지) /
       FK 실재·참조동작 / CHECK 실제 강제(ERROR 3819 확인) / cal_* 트리거 0개
       하나라도 어긋나면 무엇이 왜 틀렸는지 말하고 exit 1.

  ┌ 종료코드 ─────────────────────────────────────────────────────────────────────┐
  │ 0  게이트 전 항목 통과 — 구축 완료. 이 상태만 '배포해도 되는 상태'다.          │
  │ 1  실패 — 선행 조건·안전 스캔·게이트 중 하나가 어긋났다(Die). 고쳐서 다시.     │
  │ 2  사용자가 취소 — 아무것도 바꾸지 않았다.                                     │
  │ 3  (결번) 옛 '감사 트리거 없음'. 2026-08-11 트리거 폐지로 사라졌다.            │
  │ 4  미완: 앱 계정 없음 → GRANT 미부여. 구조는 있으나 앱이 한 줄도 못 읽는다.    │
  │ 5  (결번) 옛 '3 과 4 가 동시에'.                                               │
  └───────────────────────────────────────────────────────────────────────────────┘
  ★ 3·5 를 결번으로 남기고 4 를 3 으로 당기지 않는 이유: 종료코드는 호출자와의 계약이다.
    이미 4 를 '계정 없음'으로 읽도록 짜 둔 배치가 있다면, 4 의 뜻을 바꾸는 편이 값 하나를
    비워 두는 것보다 훨씬 위험하다(조용히 다른 분기를 탄다). 값을 재사용하지 말 것.
  왜 4 를 0 이 아니게 하는가: 판단 기준은 '이 상태로 배포하면 사용자가 다치는가' 다.
    계정이 없으면 앱은 배포 직후 첫 조회부터 ERROR 1142 로 죽는다 — 다친다. 그렇다고
    1(Die)로 뭉뚱그리지도 않는다: 1 은 '만든 것이 틀렸다(고쳐서 다시 돌려라)' 이고,
    4 는 '만든 것은 맞고 남은 단계가 있다' 라서 사람이 할 일이 다르다. 1 로 합치면
    멀쩡한 구조를 지우고 처음부터 다시 돌리는 대응을 부른다.
  왜 취소(2)를 0 이 아니게 하는가: 이전판은 취소도 0 이라 '아무것도 안 함' 과 '구축 완료' 가
    호출자에게 똑같이 보였다 — 배포 스크립트가 취소된 실행을 성공으로 세고 다음으로 넘어간다.
  무인 실행 호출자는 0 만 성공으로 셀 것. 마지막 줄이 무엇이 빠졌는지 말한다.

  ⚠️ 비밀번호를 명령줄 인자(-DbPassword)로 주면 **같은 사용자의 다른 프로세스가 읽을 수 있다.**
     Windows 는 프로세스의 명령줄을 같은 사용자 권한으로 조회할 수 있어
     (Get-CimInstance Win32_Process | Select CommandLine — 실측으로 값이 그대로 보였다),
     실행이 끝날 때까지 평문으로 노출된다. 무인 실행이라면 stdin 파이프 쪽이 낫다:
       "비번" | powershell -NoProfile -ExecutionPolicy Bypass -File init-calendar.ps1
     파이프는 명령줄에 남지 않는다. 대화형이면 -DbPassword 를 아예 주지 말고 물어보게 둘 것.
     (stdin 이 리다이렉트된 상태에서 -DbPassword 도 없고 stdin 도 비어 있으면, 예전에는
      Read-Host -AsSecureString 이 콘솔을 기다리며 **영원히 멈췄다.** 지금은 즉시 진단하고 죽는다.)

  ⚠️ 이 스크립트는 '최초 1회 구축' 전용이다. schema-calendar.sql 이 cal_* 를 DROP 후
     재생성하므로, 데이터가 든 DB 에 다시 돌리면 캘린더 데이터가 전부 사라진다.
     운영 중 구조 변경은 별도 migrate-*.sql 로 할 것.

  ⚠️ 기존 테이블(app_user/org_unit/title_code/project/customer/section_code/status_code)에는
     SELECT 만 한다. 이 스크립트가 직접 내는 문장 중 읽기가 아닌 것은 단 하나 —
     게이트의 '일부러 위반하는 INSERT' 이고, 그것도 cal_attendance 에 넣고 곧바로 롤백한다
     (그 INSERT 의 user_id 는 app_user 에서 SELECT 로 한 명을 읽어 온다. 읽기다).

     실행 전 .sql 검사는 '허용 목록(whitelist)' 이다. 주석·문자열을 인식하는 분해기로 문장을
     세미콜론 단위로 자른 뒤, 아래 형태가 아닌 문장이 하나라도 있으면 아예 시작하지 않는다:
       schema : SET NAMES utf8mb4 / DROP TABLE IF EXISTS cal_* / CREATE TABLE cal_*(…) /
                INSERT INTO cal_schema_meta(…) VALUES(…) /
                INSERT IGNORE INTO cal_user_rev(…) SELECT … FROM app_user
       grants : SET NAMES utf8mb4 / GRANT <동사목록> ON <db>.<표> TO '계정'@'호스트' / FLUSH PRIVILEGES
     ※ 2026-08-11 트리거 폐지 전에는 여기에 triggers-calendar.sql 용 목록이 하나 더 있었다
       (CREATE TRIGGER 의 본문이 쓰는 표를 '자리로' 읽어 cal_* 인지 보던 검사). 그 파일이
       사라졌으므로 함께 걷어냈다 — 지금 이 스크립트는 트리거를 만들지도 실행하지도 않는다.
     왜 뒤집었나: 이전판은 '줄 첫머리 정규식으로 위험한 문장을 찾는' 블랙리스트였고, 실제로는
     'SELECT 1; DROP TABLE app_user;' · 'TRUNCATE app_user'(TABLE 키워드 없는 유효 문법) ·
     'DROP TABLE cal_x, app_user' · 'INSERT INTO app_user …' 가 전부 통과했다(적대검증 실측).
     허용 목록의 대가는 '새로 추가한 정상 문장이 걸린다'는 것이다 — .sql 에 새 문장 형태를
     넣으면 이 목록도 함께 고칠 것. 잡지 못하는 범위: 문장 형태만 보므로 CREATE TABLE 본문 안의
     기묘한 식까지 의미로 판정하지는 않는다.

  기대값은 원칙적으로 .sql 에서 파싱한다. FK 이름·CHECK 이름·GRANT 동사는 전부 파일이 정본이다 —
  숫자를 박아 두면 .sql 을 고칠 때 게이트만 조용히 헐거워진다.
  ★ 단 '표 명부'($DESIGN_TABLES, 설계 §5.1) 하나만은 예외로 이 파일에 상수로 박았다.
     파싱값의 출처가 검증 대상 자신이라, .sql 에서 표를 통째로 빼면 기대값도 같이 줄어
     초록불이 그대로 뜨기 때문이다(적대검증 지적). 명부가 바뀌면 이 상수와
     schema-calendar.sql 을 함께 고칠 것.
     ※ 옛 $DESIGN_TRIGGERS(설계 §7.5 감사 트리거 명부)는 2026-08-11 트리거 폐지로 제거했다.
       그 자리를 대신하는 것은 '기대 목록과의 대조'가 아니라 **cal_* 트리거가 0개인지**를
       보는 게이트다(5-7). 명부가 비면 대조는 성립하지 않지만 '0개' 는 성립한다.

  예)  powershell -ExecutionPolicy Bypass -File init-calendar.ps1 -DbHost 192.168.0.50 -Port 3306
#>
[CmdletBinding()]
param(
  [string]$DbHost = "127.0.0.1",     # 대상 MySQL 호스트(서버 이관 시 서버 IP)
  [int]$Port = 3306,
  [string]$DbName = "taskmgr",
  [string]$BaseDir = "C:\mysql",     # mysql.exe 위치(없으면 서비스 binPath 추론)
  [string]$ServiceName = "MySQL84",
  [string]$DbUser = "root",          # DDL·GRANT 를 낼 관리 계정
  [string]$DbPassword = "",          # 비우면 물어봄
  [switch]$Force                     # 확인 없이 진행(무인 실행). 기존 cal_* 데이터가 지워진다
)
$ErrorActionPreference = "Continue"  # 네이티브 stderr가 창을 닫지 않게(Stop 금지)

function Info($m){ Write-Host "[*] $m" }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[!] $m" -ForegroundColor Yellow }

# Die 는 try 안에서도 불린다. exit 는 finally 를 실행시키므로 '종료 안내'가 두 번 뜨는 것을
# 막기 위해 dying 플래그를 둔다. 임시 파일 삭제는 양쪽 어디서 죽어도 되도록 여기서도 한다.
$script:cnfPath   = $null
$script:tmpGrants = $null
$script:tmpProbe  = $null
$script:tmpOut    = $null
$script:dying     = $false
# -DbName 을 grants 파일의 스키마와 다르게 준 경우, 되돌리는 REVOKE 문을 담아 두었다가
# 화면에 두 번(권한 부여 직후·종료 직전) 보여 준다. 스크롤에 묻히면 없는 것과 같다.
$script:revokeHint = $null
function Cleanup(){
  if($script:cnfPath){   Remove-Item $script:cnfPath   -Force -ErrorAction SilentlyContinue; $script:cnfPath = $null }
  if($script:tmpGrants){ Remove-Item $script:tmpGrants -Force -ErrorAction SilentlyContinue; $script:tmpGrants = $null }
  if($script:tmpProbe){  Remove-Item $script:tmpProbe  -Force -ErrorAction SilentlyContinue; $script:tmpProbe = $null }
  if($script:tmpOut){    Remove-Item $script:tmpOut    -Force -ErrorAction SilentlyContinue; $script:tmpOut = $null }
}
function Die($m){
  Write-Host "[오류] $m" -ForegroundColor Red
  $script:dying = $true
  Cleanup
  try{ Read-Host "엔터를 누르면 종료" }catch{}
  exit 1
}
# 1(Die) 이 아닌 비0 종료(취소 2 · 미완 3/4/5)를 한 자리로 모은다. Die 와 같은 모양으로 끝내야
# 하는 이유가 두 가지다: dying 을 세우지 않으면 finally 의 '엔터' 안내가 두 번 뜨고,
# Cleanup 을 부르지 않으면 비밀번호가 든 임시 .cnf 가 %TEMP% 에 남는다.
function ExitWith($code, $lastLine, $color){
  Write-Host $lastLine -ForegroundColor $color
  $script:dying = $true
  Cleanup
  try{ Read-Host "엔터를 누르면 종료" }catch{}
  exit $code
}
# 되돌리는 REVOKE 안내. 완료(0)로 끝나든 미완(3/4/5)으로 끝나든 똑같이 보여야 한다 —
# 미완일 때만 안 보이면 '시험 DB 로 한 번 돌려 보고 미완으로 끝난' 경우에 권한 잔여물이
# 조용히 남는다(MySQL 은 DROP DATABASE 로도 mysql.tables_priv 를 지우지 않는다).
function Show-RevokeHint(){
  if(-not $script:revokeHint){ return }
  Write-Host ""
  Write-Host "★ '$DbName' 은 grants-calendar.sql 이 박아 둔 '$grantSchema' 가 아닙니다." -ForegroundColor Yellow
  Write-Host "   '$appUser'@'$appHost' 에 붙은 '$DbName' 권한은 DROP DATABASE 로도 사라지지 않습니다. 되돌리려면:" -ForegroundColor Yellow
  foreach($l in $script:revokeHint){ Write-Host "   $l" -ForegroundColor Yellow }
  Write-Host ""
}

# ============================================================================
#  인자 검증 — 인자가 뒤엉킨 채로 '조용히 운영 DB' 를 대상으로 진행하는 것을 막는다
# ============================================================================
# 왜 필요한가: init-calendar.cmd 가 %* 로 인자를 넘기는데, 값이 역슬래시로 끝나는 따옴표 인자
#   (-BaseDir "C:\...\MySQL Server 8.4\")를 주면 powershell.exe 의 명령줄 파서가 \" 를
#   '이스케이프된 따옴표'로 읽어 닫는 따옴표가 사라지고, 뒤따르는 인자가 통째로 $BaseDir 안으로
#   빨려 들어간다. 그러면 -DbName 이 소리 없이 기본값 taskmgr(운영 DB)로 되돌아간다(적대검증 실측).
#   .cmd 쪽에서 값을 고쳐 주는 방법도 있으나 값을 손대면 비밀번호 같은 값이 망가질 수 있어,
#   여기서는 값을 바꾸지 않고 '이상한 값이면 멈춘다'로 처리한다.
# 부수 효과(의도): $DbName·$DbUser·$DbHost 는 아래에서 SQL 문자열에 그대로 끼워 넣으므로
#   여기 통과가 곧 그 자리의 안전 조건이다.
function AssertNoSwallow($label, $val){
  if("$val" -match '"'){ Die "$label 값에 따옴표가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태입니다 — 경로 끝의 역슬래시를 빼고 다시 실행하세요(예: -BaseDir `"C:\Program Files\MySQL\MySQL Server 8.4`")." }
  if("$val" -match '\s-(DbHost|Port|DbName|BaseDir|ServiceName|DbUser|DbPassword|Force)\b'){ Die "$label 값 안에 다른 인자가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태라 대상 DB 가 의도와 다릅니다 — 경로 끝의 역슬래시를 빼고 다시 실행하세요." }
}
AssertNoSwallow "-BaseDir"     $BaseDir
AssertNoSwallow "-DbName"      $DbName
AssertNoSwallow "-DbUser"      $DbUser
AssertNoSwallow "-DbHost"      $DbHost
AssertNoSwallow "-ServiceName" $ServiceName
if($DbName -notmatch '^[A-Za-z0-9_$]+$'){ Die "-DbName 이 식별자 형식이 아닙니다: [$DbName]. 이 값은 아래에서 SQL 에 그대로 들어갑니다." }
if($DbUser -notmatch '^[A-Za-z0-9_.$-]+$'){ Die "-DbUser 가 식별자 형식이 아닙니다: [$DbUser]." }
if($DbHost -notmatch '^[A-Za-z0-9_.:-]+$'){ Die "-DbHost 형식이 이상합니다: [$DbHost]." }
if($Port -lt 1 -or $Port -gt 65535){ Die "-Port 범위가 아닙니다: $Port" }

# ============================================================================
#  설계 §5.1 표 명부 — 이 파일에 박아 두는 유일한 기대값(머리말 참조)
# ============================================================================
$DESIGN_TABLES = @(
  'cal_category','cal_entry','cal_entry_except','cal_entry_commit',
  'cal_todo','cal_todo_day_note','cal_room','cal_task_hours',
  'cal_attendance','cal_user_pref','cal_user_rev','cal_migration_log','cal_schema_meta'
)
# FK 가 참조해도 되는 '기존' 표. 여기 없는 표를 스키마가 참조하면 시작조차 하지 않는다.
$ALLOWED_REF_TABLES = @('app_user')
# ※ 옛 $ZERO_GRANT_TABLES(= cal_audit_trash. 앱 계정에 권한이 한 줄도 없어야 하는 표)는
#   그 표가 폐지되면서 함께 없어졌다. 지금 규칙은 더 단순하다 — cal_* 13개 **전부**에
#   GRANT 가 한 줄씩 있어야 한다. 예외를 하나도 두지 않으므로 '빠진 것'과 '일부러 뺀 것'을
#   구분할 필요 자체가 없어졌다(아래 $calUngranted 검사가 그대로 Die 한다).

# 종료코드 — 호출자(init-calendar.cmd·무인 실행)가 결과를 구분할 수 있어야 한다.
# 표와 그 근거는 머리말 참조. 여기와 머리말과 init-calendar.cmd 세 곳이 같은 값을 적는다.
#   0 = 구축 완료   1 = 실패(Die)   2 = 사용자 취소
#   3 = (결번)      4 = 미완(앱 계정 없음 → GRANT 미부여)   5 = (결번)
# ★ 3·5 는 옛 '감사 트리거 없음' / '3+4' 였고 2026-08-11 트리거 폐지로 쓰이지 않는다.
#   비워 두되 다른 뜻으로 재사용하지 말 것 — 종료코드는 호출자와의 계약이라, 값의 뜻을
#   바꾸면 옛 값을 그대로 읽는 배치가 조용히 다른 분기를 탄다.
$EXIT_CANCEL      = 2
$EXIT_NO_GRANTS   = 4

$scriptDir   = Split-Path -Parent $PSCommandPath
$schemaFile  = Join-Path $scriptDir "schema-calendar.sql"
$grantsFile  = Join-Path $scriptDir "grants-calendar.sql"

# ★ 기존 DB 를 새 키로 옮기는 마이그레이션 파일. 선행 조건 1-4 가 실패했을 때 사람에게 이름을 말해 준다.
#   파일 이름을 문자열로 박아 두되, 폴더에 실제로 있으면 전체 경로를 보여 준다(없으면 이름만 말한다) —
#   있지도 않은 경로를 '여기 있다'고 안내하면 사람이 그 자리에서 한 번 더 막힌다.
$MIGRATE_FILE = "migrate-2026-08-24-user-id.sql"
$MIGRATE_HINT = $MIGRATE_FILE
$migPath = Join-Path $scriptDir $MIGRATE_FILE
if(Test-Path $migPath){ $MIGRATE_HINT = $migPath }

# ============================================================================
#  SQL 문장 분해기 — 주석·문자열을 인식해 세미콜론으로 자른다
# ============================================================================
# 왜 정규식 한 줄로 안 하는가: 이 스키마는 주석 안에 세미콜론이 들어 있고
#   (예: 릴리스 게이트 쿼리 '... WHERE r.user_id IS NULL;'), 문자열 안에 주석 기호가 들어 있다
#   (예: DEFAULT '#5b6b7d', REGEXP '^#[0-9a-fA-F]{6}$'). 어느 한쪽을 단순 치환하면 문장 경계가
#   어긋나 허용 목록 검사가 헛돈다. 반환값은 주석이 제거되고 공백이 한 칸으로 접힌 문장 배열이다.
function Split-SqlStatements([string]$text){
  $res = New-Object System.Collections.ArrayList
  $sb  = New-Object System.Text.StringBuilder
  $i = 0; $n = $text.Length
  while($i -lt $n){
    $c = $text[$i]
    $d = [char]0
    if($i + 1 -lt $n){ $d = $text[$i+1] }
    # 문자열/식별자 인용 — 안쪽은 통째로 보존한다
    if($c -eq "'" -or $c -eq '"' -or $c -eq '`'){
      $q = $c
      [void]$sb.Append($c); $i++
      while($i -lt $n){
        $ch = $text[$i]
        if($ch -eq '\' -and $q -ne '`' -and ($i + 1) -lt $n){ [void]$sb.Append($ch); [void]$sb.Append($text[$i+1]); $i += 2; continue }
        [void]$sb.Append($ch); $i++
        if($ch -eq $q){
          if($i -lt $n -and $text[$i] -eq $q){ [void]$sb.Append($text[$i]); $i++; continue }   # '' 로 이스케이프한 인용부호
          break
        }
      }
      continue
    }
    if($c -eq '-' -and $d -eq '-'){ while($i -lt $n -and $text[$i] -ne "`n"){ $i++ }; [void]$sb.Append(' '); continue }
    if($c -eq '#'){ while($i -lt $n -and $text[$i] -ne "`n"){ $i++ }; [void]$sb.Append(' '); continue }
    if($c -eq '/' -and $d -eq '*'){ $i += 2; while(($i + 1) -lt $n -and -not ($text[$i] -eq '*' -and $text[$i+1] -eq '/')){ $i++ }; $i += 2; [void]$sb.Append(' '); continue }
    if($c -eq ';'){ [void]$res.Add($sb.ToString()); $sb = New-Object System.Text.StringBuilder; $i++; continue }
    [void]$sb.Append($c); $i++
  }
  [void]$res.Add($sb.ToString())
  $out = @()
  foreach($s in $res){
    $t = (("" + $s) -replace '\s+',' ').Trim()
    if($t -ne ''){ $out += $t }
  }
  return ,$out
}

# 문자열 리터럴의 '내용'만 비운다(따옴표는 남긴다).
# 왜 필요한가: 아래 키워드 검사는 '문장이 무엇을 하는가'를 보는 것인데, 이 스키마는 COMMENT=
#   문자열 안에 SELECT·DELETE 같은 낱말을 한국어 설명으로 담고 있다(예: cal_schema_meta 의
#   COMMENT='… 앱은 SELECT 만 …'). 리터럴을 비우지 않으면 정상 DDL 이 위험 문장으로 오판된다.
function Blank-SqlLiterals([string]$s){
  return [regex]::Replace($s, "'(?:\\.|''|[^'\\])*'", "''")
}

# ※ 여기에 Split-TableRefs / Get-SqlWriteTargets 두 함수가 있었다(DML 이 '쓰는 표'를 낱말이 아니라
#   자리로 읽어 'UPDATE app_user u SET …' 같은 별칭 DML 을 잡아내던 물건). 오직 triggers-calendar.sql
#   본문 스캔에서만 쓰였고, 2026-08-11 트리거 폐지로 호출부가 0 이 되어 함께 지웠다.
#   한 번도 실행되지 않는 검사 코드를 남겨 두면 다음 사람이 '검사가 있다'고 믿는다 — 그게 더 위험하다.
#   트리거를 되살린다면 git 이력(2f3aa92)에서 그대로 꺼내 쓸 것. 다시 짜지 말 것 —
#   그 정규식은 적대검증에서 두 번 고쳐 나온 것이다.

Write-Host "============================================"
Write-Host "   캘린더(cal_*) 테이블 구축"
Write-Host "   대상: $DbHost`:$Port  DB=$DbName"
Write-Host "============================================"

# --- mysql.exe 위치 (init-db.ps1 과 같은 방식) ---
$mysql = Join-Path $BaseDir "bin\mysql.exe"
if(-not (Test-Path $mysql)){
  try {
    $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    if($svc -and $svc.PathName -match '"?([A-Za-z]:[^"]*)\\bin\\mysqld\.exe'){
      $cand = Join-Path $Matches[1] "bin\mysql.exe"; if(Test-Path $cand){ $mysql = $cand }
    }
  } catch {}
}
if(-not (Test-Path $mysql)){ Die "mysql.exe 를 못 찾았습니다. -BaseDir 로 설치 경로를 지정하세요(예: -BaseDir `"C:\Program Files\MySQL\MySQL Server 8.4`")." }

if(-not (Test-Path $schemaFile)){ Die "schema-calendar.sql 이 스크립트 폴더에 없습니다: $scriptDir" }
if(-not (Test-Path $grantsFile)){ Die "grants-calendar.sql 이 스크립트 폴더에 없습니다: $scriptDir" }

# .sql 은 BOM 없는 UTF-8 이다. -Encoding UTF8 을 명시하지 않으면 5.1 의 Get-Content 가
# 시스템 ANSI 로 읽어 한국어 주석이 깨지고, 그 깨진 텍스트로 아래 정규식이 헛돈다.
$schemaText = Get-Content $schemaFile -Raw -Encoding UTF8
$grantsText = Get-Content $grantsFile -Raw -Encoding UTF8

# ============================================================================
#  실행 전 안전 스캔(허용 목록) — 머리말 참조. 여기서 걸리면 접속도 하지 않는다
# ============================================================================
$schemaStmts = Split-SqlStatements $schemaText
if($schemaStmts.Count -lt 2){ Die "schema-calendar.sql 에서 SQL 문장을 거의 못 찾았습니다($($schemaStmts.Count)개) — 파일이 손상됐거나 인코딩이 다릅니다." }

# ★ 2026-08-24 신설: schema-calendar.sql 머리의 '선행조건 가드' 를 허용 목록에 넣는다.
#   그 가드가 하는 일: information_schema 를 읽어 **실행할 문장 자체를 문자열로 고른** 뒤
#   PREPARE/EXECUTE 한다(MySQL 은 스토어드 프로그램 밖에서 IF/SIGNAL 을 못 쓴다).
#   조건 충족이면 'DO 0'(no-op), 불충족이면 없는 테이블을 SELECT 해 일부러 ERROR 1146 을 낸다.
#   ★ 허용 목록에 PREPARE 를 들이는 것은 '실행 시점에 정해지는 SQL' 을 들이는 것이라, 문장 형태만
#     보는 이 검사로는 원래 무엇이 도는지 알 수 없다. 그래서 **변수의 출처를 추적**해 닫는다:
#       · @변수 := IF(<변수 비교식>, 'DO 0', 'SELECT 1 FROM `…`')  ← 두 리터럴이 이 둘뿐인지 확인
#       · PREPARE 는 그렇게 만들어진 변수만 허용(위 형태로 대입된 적 없는 변수면 Die)
#       · EXECUTE 는 그렇게 PREPARE 된 이름만 허용. USING 은 형태에서 배제(정규식이 안 받는다)
#     즉 EXECUTE 가 돌릴 수 있는 문장은 'DO 0' 아니면 '반드시 실패하는 SELECT' 둘뿐임이
#     파일을 읽는 것만으로 확정된다. 조건식도 변수·숫자·비교만 허용해 함수 호출을 배제한다.
$safeExecVars   = @()   # 위 IF 형태로 대입된 변수(= PREPARE 해도 되는 것)
$unsafeVars     = @()   # 그 밖의 대입을 한 번이라도 받은 변수
$preparedSafe   = @{}   # PREPARE 이름 → 안전 확인 여부
foreach($s in $schemaStmts){
  $head = if($s.Length -gt 140){ $s.Substring(0,140) + " …" } else { $s }
  $sc = Blank-SqlLiterals $s      # 키워드 판정은 리터럴을 비운 사본으로 한다(위 함수 주석 참조)
  if($s -match '^SET\s+NAMES\s+utf8mb4$'){ continue }
  if($s -match '^DROP\s+TABLE\s+IF\s+EXISTS\s+`?(cal_[A-Za-z0-9_]+)`?$'){ continue }
  if($s -match '^CREATE\s+TABLE\s+`?(cal_[A-Za-z0-9_]+)`?\s*\('){
    # CREATE TABLE 본문은 DDL 이라 다른 표를 쓸 수단이 없다. 다만 CREATE … SELECT 와
    # 트리거 동반 정의만은 형태로 걸러 둔다(있을 리 없지만 있으면 여기서 멈춰야 한다).
    if($sc -match '\bSELECT\b'){ Die "schema-calendar.sql 의 CREATE TABLE 에 SELECT 가 있습니다: $head" }
    if($sc -match '\bTRIGGER\b'){ Die "schema-calendar.sql 의 CREATE TABLE 에 TRIGGER 가 있습니다: $head" }
    foreach($r in [regex]::Matches($sc,'(?i)REFERENCES\s+`?([A-Za-z0-9_]+)`?')){
      $rt = $r.Groups[1].Value
      if($rt -notlike 'cal_*' -and $ALLOWED_REF_TABLES -notcontains $rt){ Die "schema-calendar.sql 이 허용되지 않은 표를 참조합니다: '$rt' (허용: cal_* / $($ALLOWED_REF_TABLES -join ', '))." }
    }
    continue
  }
  if($s -match '^INSERT\s+INTO\s+`?cal_schema_meta`?\s*\([^()]*\)\s*VALUES\s*\('){ continue }
  if($s -match '^INSERT\s+IGNORE\s+INTO\s+`?cal_user_rev`?\s*\([^()]*\)\s*SELECT\s+.+\s+FROM\s+`?app_user`?$'){ continue }

  # --- 선행조건 가드(위 ★ 참조) -------------------------------------------------
  # (가) 조건 읽기 — information_schema 만 읽는 COUNT 대입. 읽기 전용이라 그 자체로는 무해하다.
  #      다만 이 변수는 PREPARE 대상이 될 수 없다($unsafeVars 로 못 박는다) — 값이 숫자든 무엇이든
  #      '파일만 보고 무엇이 실행될지 안다' 는 보장이 깨지기 때문이다.
  $gm1 = [regex]::Match($s,'(?i)^SET\s+@([A-Za-z0-9_]+)\s*:=\s*\(\s*SELECT\s+COUNT\(\*\)\s+FROM\s+information_schema\.[A-Za-z0-9_]+\s+WHERE\s+.+\)$')
  if($gm1.Success){
    if($sc -match '(?i)\b(DROP|DELETE|INSERT|UPDATE|REPLACE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|LOAD|PREPARE|EXECUTE)\b'){ Die "schema-calendar.sql 의 가드 대입문에 읽기가 아닌 낱말이 있습니다: $head" }
    $v = $gm1.Groups[1].Value
    if($unsafeVars -notcontains $v){ $unsafeVars += $v }
    continue
  }
  # (나) 실행할 문장 고르기 — 리터럴이 'DO 0' 과 'SELECT 1 FROM `…`' 둘뿐이어야 한다.
  #      조건식은 변수·숫자·비교(AND/OR)만. 괄호도 따옴표도 없으므로 함수 호출이 들어갈 자리가 없다.
  $gm2 = [regex]::Match($s,'(?i)^SET\s+@([A-Za-z0-9_]+)\s*:=\s*IF\s*\(\s*([^(),'']+?)\s*,\s*''DO 0''\s*,\s*''SELECT 1 FROM `[^`'']*`''\s*\)$')
  if($gm2.Success){
    $cond = $gm2.Groups[2].Value
    if($cond -notmatch '^[@A-Za-z0-9_= <>]+$'){ Die "schema-calendar.sql 의 가드 조건식이 허용 형태가 아닙니다(변수·숫자·비교만): [$cond] — $head" }
    $v = $gm2.Groups[1].Value
    if($safeExecVars -notcontains $v){ $safeExecVars += $v }
    continue
  }
  # (다) PREPARE — (나) 로 만들어진 변수만.
  $gm3 = [regex]::Match($s,'(?i)^PREPARE\s+([A-Za-z0-9_]+)\s+FROM\s+@([A-Za-z0-9_]+)$')
  if($gm3.Success){
    $v = $gm3.Groups[2].Value
    if($safeExecVars -notcontains $v -or $unsafeVars -contains $v){ Die "schema-calendar.sql 이 출처를 확인할 수 없는 변수를 PREPARE 합니다: @$v — 실행 시점에 무엇이 도는지 파일만 보고 알 수 없으므로 실행하지 않습니다: $head" }
    $preparedSafe[$gm3.Groups[1].Value] = $true
    continue
  }
  # (라) EXECUTE — (다) 로 준비된 이름만. USING 은 이 형태가 받지 않는다.
  $gm4 = [regex]::Match($s,'(?i)^EXECUTE\s+([A-Za-z0-9_]+)$')
  if($gm4.Success){
    if(-not $preparedSafe.ContainsKey($gm4.Groups[1].Value)){ Die "schema-calendar.sql 이 준비되지 않은(또는 확인되지 않은) 문장을 EXECUTE 합니다: $head" }
    continue
  }
  # (마) DEALLOCATE — 준비 목록에서 내린다. 내린 이름을 다시 EXECUTE 하면 위 (라) 가 잡는다.
  $gm5 = [regex]::Match($s,'(?i)^DEALLOCATE\s+PREPARE\s+([A-Za-z0-9_]+)$')
  if($gm5.Success){ $preparedSafe.Remove($gm5.Groups[1].Value); continue }

  Die "schema-calendar.sql 에 허용 목록에 없는 문장이 있습니다 — 실행하지 않습니다: $head"
}

# 권한 파일은 SET NAMES / GRANT(표 단위) / FLUSH PRIVILEGES 만이어야 한다.
#   · CREATE USER 가 섞이면 비밀번호가 두 곳으로 흩어져 배포 때 어긋난다(grants 머리말이 계정 생성을 뺀 이유).
#   · REVOKE 는 기존 테이블 권한을 조용히 회수한다 — 이전판 블랙리스트에는 아예 없던 동사다.
#   · GRANT … ON db.* / *.* 는 아래 '권한 0줄' 게이트를 통째로 무의미하게 만든다.
$grantStmts = Split-SqlStatements $grantsText
$expGrants   = @{}
$grantSchema = $null; $appUser = $null; $appHost = $null
foreach($s in $grantStmts){
  $head = if($s.Length -gt 140){ $s.Substring(0,140) + " …" } else { $s }
  if($s -match '^SET\s+NAMES\s+utf8mb4$'){ continue }
  if($s -match '^FLUSH\s+PRIVILEGES$'){ continue }
  $gm = [regex]::Match($s,"(?i)^GRANT\s+([A-Za-z, ]+?)\s+ON\s+``?([A-Za-z0-9_]+)``?\s*\.\s*``?([A-Za-z0-9_]+)``?\s+TO\s+'([^']+)'@'([^']+)'$")
  if(-not $gm.Success){ Die "grants-calendar.sql 에 허용 목록에 없는 문장이 있습니다(표 단위 GRANT 만 허용): $head" }
  if($gm.Groups[1].Value -match '(?i)\bALL\b'){ Die "grants-calendar.sql 에 GRANT ALL 이 있습니다: $head. 동사를 하나씩 적어야 아래 GRANT 대조가 성립합니다." }
  $verbs = @()
  foreach($v in ($gm.Groups[1].Value -split ',')){ $t = "$v".Trim().ToUpper(); if($t -ne ""){ $verbs += $t } }
  if($null -eq $grantSchema){ $grantSchema = $gm.Groups[2].Value; $appUser = $gm.Groups[4].Value; $appHost = $gm.Groups[5].Value }
  if($gm.Groups[2].Value -ne $grantSchema){ Die "grants-calendar.sql 안에 스키마 이름이 섞여 있습니다($grantSchema / $($gm.Groups[2].Value))." }
  if($gm.Groups[4].Value -ne $appUser -or $gm.Groups[5].Value -ne $appHost){ Die "grants-calendar.sql 안에 계정이 섞여 있습니다($appUser@$appHost / $($gm.Groups[4].Value)@$($gm.Groups[5].Value))." }
  $expGrants[$gm.Groups[3].Value] = (($verbs | Sort-Object) -join ',')
}
if($expGrants.Count -lt 1){ Die "grants-calendar.sql 에서 GRANT 문을 하나도 못 찾았습니다." }

# ============================================================================
#  기대값 파싱 — 주석을 걷어낸 문장에서만 뽑는다(주석 속 예시 SQL 이 섞이지 않게)
# ============================================================================
$schemaCode = ($schemaStmts -join ";`n")
# 문자열 리터럴(COMMENT='…')까지 비운 사본. '실행되는 DDL 이 무엇을 말하는가'만 보는 검사에 쓴다.
$schemaCodeBare = Blank-SqlLiterals $schemaCode

# ★ 2026-08-24 키 전환 — 실행 문장에 옛 소유자 키가 남아 있으면 아예 시작하지 않는다.
#   왜 파일에서 먼저 보는가: cal_* 는 이 파일이 만든다. 여기에 login_id 가 한 줄이라도 남아 있으면
#   그 표는 옛 키로 만들어지고, 앱(=user_id 로 조회)은 그 표에서 ERROR 1054 를 받는다. 그런데 게이트는
#   '표가 생겼다'만 보므로 초록불이 그대로 뜬다 — 전환이 절반만 끝난 상태가 배포까지 간다.
#   주석은 대상이 아니다(분해기가 이미 걷어냈다). COMMENT='…' 안의 설명 문구도 대상이 아니다(위 사본).
$legacyDecl = @()
foreach($k in @('login_id','category_id','entry_id','todo_id')){
  if($schemaCodeBare -match ('(?i)\b' + $k + '\b')){ $legacyDecl += $k }
}
if($legacyDecl.Count -gt 0){
  Die "schema-calendar.sql 의 **실행 문장**에 옛 키 컬럼이 남아 있습니다: $($legacyDecl -join ', '). 2026-08-24 키 전환(login_id/문자열 id → user_id/<표>_no)이 절반만 끝난 상태입니다 — 이대로 만들면 앱의 SQL 이 ERROR 1054 로 죽습니다(주석에 남은 것은 여기서 걸리지 않습니다)."
}

$expTables = @()
foreach($m in [regex]::Matches($schemaCode,'(?i)\bCREATE\s+TABLE\s+`?([A-Za-z0-9_]+)`?')){ $expTables += $m.Groups[1].Value }
if($expTables.Count -lt 1){ Die "schema-calendar.sql 에서 CREATE TABLE 을 하나도 못 찾았습니다." }

# ★ 명부 대조 — 파싱값의 출처가 검증 대상 자신이라, 이 상수와 맞춰 보지 않으면
#   스키마에서 표를 통째로 빼도 '전부 생성' 초록불이 그대로 뜬다(적대검증 경미14).
$tblMissing = @($DESIGN_TABLES | Where-Object { $expTables -notcontains $_ })
$tblExtra   = @($expTables    | Where-Object { $DESIGN_TABLES -notcontains $_ })
if($tblMissing.Count -gt 0){ Die "설계 §5.1 명부에 있는 표가 schema-calendar.sql 에 없습니다: $($tblMissing -join ', '). 명부가 바뀐 것이면 이 스크립트의 `$DESIGN_TABLES 도 함께 고치세요." }
if($tblExtra.Count -gt 0){   Die "schema-calendar.sql 에 명부에 없는 표가 있습니다: $($tblExtra -join ', '). 설계 §5.1 과 이 스크립트의 `$DESIGN_TABLES 를 먼저 정하세요." }
if($expTables.Count -ne $DESIGN_TABLES.Count){ Die "표 개수 불일치 — 기대 $($DESIGN_TABLES.Count)개 / 스키마 $($expTables.Count)개." }

# ============================================================================
#  ★ 소유자 키(user_id) 기대값 — 2026-08-24 키 전환
# ============================================================================
# 두 가지를 파일에서 뽑는다. 둘 다 '박아 두지 않고 파일이 정본' 원칙 그대로다.
#   $expUserType      : cal_* 가 선언하는 user_id 의 타입. app_user.user_id 와 **글자 하나까지** 같아야
#                       FK 가 선다(InnoDB 는 타입·부호가 다르면 errno 3780/150 으로 거부한다).
#   $expUserIdTables  : user_id 컬럼을 갖는 cal_* 표 목록. 게이트가 DB 실물과 대조해 '전환 누락'을 잡는다.
#                       (cal_schema_meta 는 사용자별 데이터가 아니라 이 목록에 없다 — 그 사실까지 대조된다)
$userTypes = @()
foreach($m in [regex]::Matches($schemaCodeBare,'(?i)\buser_id\s+((?:TINY|SMALL|MEDIUM|BIG)?INT)\s*(?:\(\s*\d+\s*\))?\s*(UNSIGNED)?\s+NOT\s+NULL')){
  $t = $m.Groups[1].Value.ToLower()
  if($m.Groups[2].Success){ $t += ' unsigned' }
  if($userTypes -notcontains $t){ $userTypes += $t }
}
if($userTypes.Count -lt 1){ Die "schema-calendar.sql 에서 user_id 컬럼 선언을 하나도 찾지 못했습니다 — 파일 형식이 바뀌었거나 키 전환이 되돌려진 것 같습니다(2026-08-24 이후 cal_* 의 소유자 키는 user_id 입니다)." }
if($userTypes.Count -gt 1){ Die "schema-calendar.sql 안의 user_id 선언이 서로 다릅니다: $($userTypes -join ' / '). 타입이 하나라도 다르면 그 표의 FK 가 서지 않습니다 — 전부 같은 타입이어야 합니다." }
$expUserType = $userTypes[0]

$expUserIdTables = @()
foreach($s in $schemaStmts){
  $cm = [regex]::Match($s,'(?i)^CREATE\s+TABLE\s+`?(cal_[A-Za-z0-9_]+)`?\s*\(')
  if(-not $cm.Success){ continue }
  if((Blank-SqlLiterals $s) -match '(?i)\buser_id\s+((?:TINY|SMALL|MEDIUM|BIG)?INT)\b'){ $expUserIdTables += $cm.Groups[1].Value }
}
if($expUserIdTables.Count -lt 1){ Die "schema-calendar.sql 의 CREATE TABLE 중 user_id 를 갖는 표가 하나도 없습니다 — 키 전환 상태를 확인하세요." }

$expFks = @()
foreach($m in [regex]::Matches($schemaCode,'(?i)CONSTRAINT\s+`?([A-Za-z0-9_]+)`?\s+FOREIGN\s+KEY')){ $expFks += $m.Groups[1].Value }

$expChecks = @()
foreach($m in [regex]::Matches($schemaCode,'(?i)CONSTRAINT\s+`?([A-Za-z0-9_]+)`?\s+CHECK\s*\(')){ $expChecks += $m.Groups[1].Value }

# FK 의 참조 동작까지 대조한다. CASCADE(자식) 와 RESTRICT(부모 과제) 를 뒤집는 것이
# 이 스키마에서 가장 잦은 사고라, 이름만 맞는지 보는 것으로는 부족하다.
# ★ 이름 패턴을 fk_ 로 좁히지 않는다. 좁히면 다른 접두로 명명한 FK 가 기대표에 안 들어가고,
#   게이트 5-4 의 규칙 비교가 ContainsKey 로 조용히 건너뛴다(적대검증 경미11).
$expFkUpd = @{}; $expFkDel = @{}
foreach($m in [regex]::Matches($schemaCode,'(?is)CONSTRAINT\s+`?([A-Za-z0-9_]+)`?\s+FOREIGN\s+KEY.{0,400}?ON\s+UPDATE\s+(RESTRICT|CASCADE|SET\s+NULL|NO\s+ACTION)\s+ON\s+DELETE\s+(RESTRICT|CASCADE|SET\s+NULL|NO\s+ACTION)')){
  $expFkUpd[$m.Groups[1].Value] = (($m.Groups[2].Value -replace '\s+',' ').ToUpper())
  $expFkDel[$m.Groups[1].Value] = (($m.Groups[3].Value -replace '\s+',' ').ToUpper())
}
$fkNoRule = @($expFks | Where-Object { -not $expFkUpd.ContainsKey($_) })
if($fkNoRule.Count -gt 0){ Die "FK 의 참조 동작(ON UPDATE/ON DELETE)을 파싱하지 못한 제약이 있습니다: $($fkNoRule -join ', '). 이대로 두면 CASCADE/RESTRICT 가 뒤집혀도 게이트가 조용히 건너뜁니다 — schema-calendar.sql 의 표기를 확인하세요." }

# FK 가 가리키는 '기존' 테이블(= cal_* 이 아닌 것). 이게 없으면 CREATE 가 errno 1824 로 죽는다.
$fkTargets = @()
foreach($m in [regex]::Matches($schemaCode,'(?i)REFERENCES\s+`?([A-Za-z0-9_]+)`?')){
  if($fkTargets -notcontains $m.Groups[1].Value){ $fkTargets += $m.Groups[1].Value }
}
$extTargets = @($fkTargets | Where-Object { $_ -notlike 'cal_*' })

$grantTables  = @($expGrants.Keys)
$calGranted   = @($grantTables | Where-Object { $_ -like 'cal_*' } | Sort-Object)
$extGranted   = @($grantTables | Where-Object { $_ -notlike 'cal_*' } | Sort-Object)
# 스키마에는 있는데 GRANT 파일에 없는 cal_*. ★ 이제 예외가 하나도 없다 — 한 표라도 비면 Die 다.
#   (옛날에는 cal_audit_trash 만 '일부러 0줄'이라 상수와 대조해야 했다. 그 표가 폐지되면서
#    '빠진 것'과 '일부러 뺀 것'을 구분할 이유가 사라졌고, 검사는 이 한 줄로 줄었다.)
$calUngranted = @($expTables | Where-Object { $calGranted -notcontains $_ } | Sort-Object)
if($calUngranted.Count -gt 0){
  Die "grants-calendar.sql 에 GRANT 가 한 줄도 없는 cal_* 표가 있습니다: $($calUngranted -join ', '). 스키마가 만드는 cal_* 는 전부 앱이 쓰는 표이므로 권한이 0줄인 표가 있어서는 안 됩니다 — 앱이 못 읽는 표를 만들어 두고 게이트만 통과시키지 않기 위해 여기서 멈춥니다(cal_schema_meta 라면 GRANT SELECT 한 줄이 필요합니다. §5.5)."
}
# cal_schema_meta 는 SELECT 만이어야 한다 — 앱이 버전 행을 올릴 수 있으면 '낡은 클라이언트 차단'이 성립하지 않는다(§5.5).
if($expGrants.ContainsKey('cal_schema_meta') -and $expGrants['cal_schema_meta'] -ne 'SELECT'){
  Die "grants-calendar.sql 이 cal_schema_meta 에 [$($expGrants['cal_schema_meta'])] 를 줍니다. §5.5 상 SELECT 만 허용됩니다 — 앱이 버전 행을 올릴 수 있으면 차단 자체가 무의미해집니다."
}

# ============================================================================
#  ★ 옛 §7.5 감사 트리거 단계 — 2026-08-11 폐지
# ============================================================================
# 여기에 triggers-calendar.sql 의 안전 스캔(허용 문장·대상 표·본문이 쓰는 표)과 명부 대조가 있었다.
# 그 파일이 사라졌으므로 통째로 걷어냈다. 트리거를 다시 도입한다면 이 자리에 같은 검사를 되살릴 것 —
# 트리거는 서버 안에서 DEFINER 권한으로 도는 코드라, 파일을 안 보고 실행하면 안 된다.
# 지금 남은 것은 '트리거가 하나도 없는지' 를 보는 게이트 둘뿐이다: 1-6(지우기 전) · 5-7(구축 후).

# ============================================================================
#  접속
# ============================================================================
if(-not $DbPassword){
  # ★ Read-Host -AsSecureString 은 호스트 콘솔에서 직접 읽는다 — stdin 이 리다이렉트돼 있으면
  #   읽을 콘솔이 없는데도 EOF 를 받지 못해 **영원히 멈춘다**(적대검증 경미1: 무인 실행이
  #   그대로 매달렸다). 머리말이 무인 실행을 지원한다고 적어 둔 이상 이건 최악의 실패 모양이다:
  #   실패도 성공도 아니고 아무 말도 없이 멈춘 채 다음 단계를 영원히 막는다.
  #   그래서 리다이렉트를 먼저 감지하고, 그 경우에는 콘솔 대신 stdin 첫 줄을 읽는다.
  #   (파이프는 명령줄에 남지 않으므로 -DbPassword 보다 낫다 — 머리말 ⚠ 참조)
  if([Console]::IsInputRedirected){
    Info "stdin 이 리다이렉트돼 있습니다 — 대화형 입력은 불가하므로 비밀번호를 stdin 첫 줄에서 읽습니다."
    $line = $null
    try { $line = [Console]::In.ReadLine() } catch { $line = $null }
    if([string]::IsNullOrEmpty($line)){
      Die "비밀번호를 받지 못했습니다(stdin 이 리다이렉트돼 있고 첫 줄이 비어 있습니다). 무인 실행에서는 stdin 첫 줄로 주거나(예: `"비번`" | powershell -NoProfile -ExecutionPolicy Bypass -File init-calendar.ps1) -DbPassword 를 쓰세요. 대화형 입력을 기다리면 콘솔이 없어 영원히 멈춥니다."
    }
    $DbPassword = $line
  } else {
    $s = Read-Host "MySQL $DbUser 비밀번호" -AsSecureString
    $DbPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
  }
}
if(-not $DbPassword){ Die "비밀번호가 비어 있습니다." }

$pwEsc = ($DbPassword -replace '\\','\\') -replace '"','\"'
$cnf = Join-Path $env:TEMP ("mycal_"+[IO.Path]::GetRandomFileName()+".cnf")
# ★ 인코딩 — 이전판은 Out-File -Encoding ascii 였다. ascii 인코더는 비ASCII 문자를 예외 없이
#   '?'(0x3F)로 **조용히** 치환하므로, 비밀번호에 한글·악센트가 하나라도 있으면 맞는 비번인데도
#   접속이 실패하고 사람은 '비번을 확인하세요'만 본다(원인이 화면 어디에도 안 나온다).
#   같은 파일의 다른 임시 파일 쓰기(권한 사본·CHECK probe)가 이미 UTF8Encoding($false) 이므로
#   그쪽에 맞춘다. BOM 은 반드시 없어야 한다 — MySQL 옵션 파일 파서는 BOM 바이트를 첫 줄의
#   일부로 읽어 '[client]' 섹션 머리를 못 알아본다.
$cnfText = "[client]`r`nuser=$DbUser`r`npassword=""$pwEsc""`r`nhost=$DbHost`r`nport=$Port`r`n"
[IO.File]::WriteAllText($cnf, $cnfText, (New-Object System.Text.UTF8Encoding($false)))
$script:cnfPath = $cnf

# QSrv = 기본 DB 없이(서버 단위). Q/QRows = $DbName 을 기본 DB 로 두고 실행.
# -N -B 는 헤더·격자 없는 탭 구분 출력. 아래 파싱이 이걸 전제하므로 -t 로 바꾸지 말 것.
function QSrv($sql){ return ("" + (& $mysql "--defaults-extra-file=$cnf" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql)).Trim() }
function Q($sql){ return ("" + (& $mysql "--defaults-extra-file=$cnf" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql $DbName)).Trim() }
function QRows($sql){
  $o = & $mysql "--defaults-extra-file=$cnf" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql $DbName
  if($null -eq $o){ return @() }
  return @(@($o) | Where-Object { "$_".Trim() -ne "" })
}
function SqlList($names){
  $q = @()
  foreach($n in $names){ $q += ("'" + ($n -replace "'","''") + "'") }
  return ($q -join ",")
}

try {
  if((QSrv "SELECT 1;") -ne "1"){ Die "$DbUser 로 접속 실패. 호스트/포트/비번을 확인하세요($DbHost`:$Port)." }

  # ==========================================================================
  #  1. 선행 조건 — 하나라도 어긋나면 아무것도 만들지 않고 중단
  # ==========================================================================
  Write-Host ""
  Write-Host "---- 선행 조건 ----"

  # 1-1) 서버 버전.
  #  8.0.13+ : TEXT 식 DEFAULT ('') — memo/note/body 가 쓴다.
  #  8.0.16+ : CHECK 를 '실제로 강제'. 그 미만은 파싱만 하고 조용히 무시한다 → 이 스키마의
  #            all_day/반복/공수 규칙이 전부 무방비가 된다. 그래서 더 높은 쪽을 하한으로 삼는다.
  $ver = QSrv "SELECT VERSION();"
  $verNum = ($ver -split '-')[0]
  $vObj = $null
  try { $vObj = [version]$verNum } catch { $vObj = $null }
  if($null -eq $vObj){ Warn "서버 버전 문자열을 해석하지 못했습니다: '$ver' — 버전 검사를 건너뜁니다(게이트 5가 대신 잡습니다)." }
  elseif($vObj -lt [version]"8.0.16"){ Die "MySQL $ver 입니다. 8.0.16 미만은 CHECK 제약을 파싱만 하고 무시합니다 — 이 스키마는 CHECK 로 무결성을 지키므로 사용할 수 없습니다." }
  else { Ok "서버 버전 $ver (8.0.16+)" }

  # 1-2) DB 존재. 이 스크립트는 DB 를 만들지 않는다 — 과제 DB 가 이미 있다는 전제다.
  $hasDb = QSrv "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$DbName';"
  if($hasDb -ne $DbName){ Die "'$DbName' 데이터베이스가 없습니다. 과제 DB 를 먼저 구축하세요(init-db.cmd)." }
  Ok "데이터베이스 '$DbName' 존재"

  # 1-3) 참조 대상 테이블.
  #   · $extTargets  = FK 가 실제로 REFERENCES 하는 기존 테이블. 없으면 CREATE 가 errno 1824.
  #   · $extGranted  = grants-calendar.sql 이 SELECT 를 주는 기존 테이블. 없으면 그 GRANT 줄이
  #                    ERROR 1146 으로 파일 실행을 중단시킨다(권한 파일에 가드가 없는 것이 의도).
  $needExisting = @()
  foreach($t in ($extTargets + $extGranted)){ if($needExisting -notcontains $t){ $needExisting += $t } }
  $lackTables = @()
  foreach($t in ($needExisting | Sort-Object)){
    $n = [int](Q "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='$t';")
    if($n -lt 1){ $lackTables += $t }
  }
  if($lackTables.Count -gt 0){ Die "'$DbName' 에 다음 테이블이 없습니다: $($lackTables -join ', '). FK 대상이거나 권한 대상이라 지금 진행하면 도중에 실패합니다(taskmgr-company-data\apply.cmd 로 사용자·조직 테이블을 먼저 구축)." }
  Ok "참조 대상 테이블 확인: $($needExisting -join ', ')"

  # 1-4) ★ app_user.user_id — cal_* 13표 전부의 소유자 키(2026-08-24 키 전환).
  #   옛 판은 여기서 login_id 의 타입·콜레이션을 봤다. 그 컬럼은 이제 cal_* 어디에서도 참조되지 않는다
  #   (app_user 안의 UNIQUE 로 남아 외부 로그인 입구 노릇만 한다). 지금 FK 가 매달린 곳은 user_id 다.
  #   무엇을 보는가 — 셋 다 '없으면 CREATE 가 도중에 죽는' 조건이다:
  #     ① 컬럼 실재. 없으면 cal_* 의 app_user 참조 FK 가 전멸한다(errno 150). 기존 DB 는 아직
  #        login_id 가 PK 인 상태이므로, 여기가 '마이그레이션을 먼저 돌리라'고 말하는 자리다.
  #     ② 타입 일치. InnoDB 는 FK 양쪽 정수 컬럼의 폭·부호가 다르면 생성을 거부한다
  #        (SMALLINT UNSIGNED vs SMALLINT 도 다른 타입이다). 기대값은 schema-calendar.sql 이 정본이다.
  #     ③ 부모 쪽 인덱스. FK 의 부모 컬럼은 인덱스의 **선두**여야 한다. PK 도 UNIQUE 도 아니면 errno 150.
  #   ★ 왜 시작 전인가: schema-calendar.sql 은 cal_* 를 DROP 하고 다시 만든다. 조건이 어긋난 채
  #     실행하면 '옛 표는 지워졌는데 새 표는 못 만든' 반파 상태가 된다. 그래서 접속 직후 여기서 막는다.
  $nUserFk = ([regex]::Matches($schemaCode,'(?i)REFERENCES\s+`?app_user`?\s*\(')).Count
  $actUserType = (Q "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='app_user' AND COLUMN_NAME='user_id';").ToLower()
  $actUserNull =  Q "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='app_user' AND COLUMN_NAME='user_id';"
  $actUserKey  =  Q "SELECT COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='app_user' AND COLUMN_NAME='user_id';"
  if($actUserType -eq ""){
    $actUserPk = Q "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='app_user' AND CONSTRAINT_NAME='PRIMARY';"
    Die "app_user 에 user_id 컬럼이 없습니다(현재 PK: $actUserPk). 2026-08-24 키 전환으로 cal_* 13표는 전부 app_user.user_id($expUserType)를 참조합니다 — 지금 진행하면 FK $nUserFk 개가 전부 errno 150 으로 실패하고, 그 전에 옛 cal_* 는 이미 DROP 된 뒤라 반파 상태가 됩니다. 기존 DB 라면 $MIGRATE_HINT 를 먼저 적용하고, 새 DB 라면 taskmgr-company-data\apply.cmd(01-schema-users.sql)로 사용자 표를 먼저 구축하세요."
  }
  if($actUserType -ne $expUserType){ Die "app_user.user_id 타입 불일치 — schema-calendar.sql 은 [$expUserType] 를 전제하는데 실제는 [$actUserType] 입니다. InnoDB 는 폭·부호가 다르면 FK 를 만들지 않습니다 — cal_* 의 app_user 참조 FK $nUserFk 개가 전부 실패합니다." }
  if($actUserNull -ne 'NO'){ Die "app_user.user_id 가 NULL 을 허용합니다 — 소유자 키에 NULL 이 들어가면 그 사람의 캘린더 행이 주인 없는 행이 됩니다(cal_* 는 전부 NOT NULL 로 만듭니다). NOT NULL 로 고치세요." }
  if($actUserKey -ne 'PRI' -and $actUserKey -ne 'UNI'){ Die "app_user.user_id 에 PK/UNIQUE 인덱스가 없습니다(COLUMN_KEY=[$actUserKey]). FK 의 부모 컬럼은 인덱스의 선두여야 합니다 — 지금 진행하면 FK $nUserFk 개가 errno 150 으로 전멸합니다." }
  Ok "app_user.user_id = $actUserType / $actUserKey (schema-calendar.sql 전제와 일치, app_user 참조 FK $nUserFk 개)"

  # 1-4b) login_id 는 사라지지 않았다 — 외부 로그인 입구로 남는다. 없거나 유일하지 않으면 경고만 한다.
  #   Die 가 아닌 이유: cal_* 의 생성에는 아무 영향이 없다(FK 가 걸리지 않는다). 다만 앱이 netcus 로그인
  #   id 로 사람을 찾는 경로가 이 컬럼이라, 유일하지 않으면 다른 사람의 캘린더가 열릴 수 있다.
  $actLoginKey = Q "SELECT COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='app_user' AND COLUMN_NAME='login_id';"
  if($actLoginKey -eq ""){ Warn "app_user 에 login_id 컬럼이 없습니다 — 앱은 netcus 로그인 id 로 user_id 를 찾습니다(그 경로가 막힙니다)." }
  elseif($actLoginKey -ne 'PRI' -and $actLoginKey -ne 'UNI'){ Warn "app_user.login_id 가 UNIQUE 가 아닙니다(COLUMN_KEY=[$actLoginKey]) — 같은 로그인 id 가 둘이면 앱이 남의 캘린더를 열 수 있습니다. uq_app_user_login_id 를 확인하세요." }

  # 1-5) project.uid 콜레이션 — FK 는 아니지만 §6 이 cal_category.project_uid 와 LEFT JOIN 한다.
  #   콜레이션이 다르면 테이블 생성은 멀쩡히 되고 나중에 조회에서 ERROR 1267 이 난다.
  #   구축 자체를 막을 사유는 아니라 경고로만 남긴다(고치는 쪽은 project 테이블이다).
  $pm = [regex]::Match($schemaCode,'(?i)project_uid\s+(CHAR\s*\(\s*\d+\s*\))\s+CHARACTER\s+SET\s+([A-Za-z0-9_]+)\s+COLLATE\s+([A-Za-z0-9_]+)')
  if($pm.Success){
    $actUidColl = Q "SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND COLUMN_NAME='uid';"
    if($actUidColl -ne "" -and $actUidColl -ne $pm.Groups[3].Value){
      Warn "project.uid 콜레이션이 $actUidColl 이라 cal_category.project_uid($($pm.Groups[3].Value))와 다릅니다 — 공식 과제 이름 해석(§6 LEFT JOIN)이 실행 시 ERROR 1267 로 실패합니다."
    }
  }

  # 1-6) ★ cal_* 에 붙어 있는 트리거 — '지우기 전에' 본다.
  #   2026-08-11 결정으로 이 키트는 트리거를 하나도 만들지 않는다. 그러므로 지금 DB 에 붙어 있는
  #   cal_* 트리거는 전부 '이 키트 밖에서 누군가 심은 것'이다(옛 배포의 trg_cal_* 잔재 포함).
  #   왜 여기인가: 몇 줄 아래 schema-calendar.sql 의 DROP TABLE 이 그 표의 트리거를 경고 한 줄
  #   없이 함께 지운다(실측). 즉 이 자리를 지나면 증거 자체가 사라져 게이트 5-7 은 '방금 만들어진
  #   것이 없다'만 확인하게 된다. 사람이 무엇이 있었는지 볼 수 있는 유일한 지점이 여기다.
  #   Die 가 아니라 경고인 이유: 옛 배포 위에 재구축하는 정상 경로까지 막게 되고, 어차피 DROP 으로
  #   사라진다. 목적은 '무엇이 사라지는지' 를 사라지기 전에 눈에 보이게 하는 것이다.
  $preRogue = QRows "SELECT CONCAT(TRIGGER_NAME,'|',EVENT_OBJECT_TABLE) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='$DbName' AND EVENT_OBJECT_TABLE LIKE 'cal\_%';"
  if($preRogue.Count -gt 0){
    Warn "★ cal_* 에 트리거가 붙어 있습니다($($preRogue.Count)개): $($preRogue -join ', ')"
    Warn "  → 이 키트는 트리거를 만들지 않습니다(2026-08-11 감사 트리거 폐지). 옛 배포의 잔재이거나 누군가 따로 심은 것입니다."
    Warn "  → 아래 schema-calendar.sql 이 표를 DROP 하면 이 트리거들도 함께 사라집니다(증거가 없어짐)."
    Warn "     본문을 먼저 남기세요 — SHOW CREATE TRIGGER <이름>."
  }

  # ==========================================================================
  #  2. 이미 cal_* 이 있으면 — 지우기 전에 반드시 묻는다
  # ==========================================================================
  $existing = QRows "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME LIKE 'cal\_%' ORDER BY TABLE_NAME;"
  if($existing.Count -gt 0){
    Write-Host ""
    Warn "'$DbName' 에 cal_* 테이블이 이미 $($existing.Count) 개 있습니다. 현재 행 수:"
    $total = 0
    foreach($t in $existing){
      if("$t" -notmatch '^[A-Za-z0-9_]+$'){ continue }
      $c = [int](Q "SELECT COUNT(*) FROM ``$t``;")
      $total += $c
      Write-Host ("      {0,-22} {1,8} 행" -f $t, $c)
    }
    Write-Host ""
    Write-Host "    계속하면 schema-calendar.sql 이 이 테이블들을 DROP 후 다시 만듭니다." -ForegroundColor Yellow
    Write-Host "    위 $total 행이 전부 사라지고 되돌릴 수 없습니다 — 이 DB 안에는 되돌릴 수단이 없습니다" -ForegroundColor Yellow
    Write-Host "    (감사 휴지통은 2026-08-11 폐지). 데이터가 있다면 여기서 멈추고 먼저 백업하세요(mysqldump)." -ForegroundColor Yellow
    Write-Host ""
    if($Force){
      Warn "-Force 가 지정되어 확인 없이 진행합니다."
    } else {
      # 기본 응답은 '아니오'. 엔터만 쳐도 취소되도록 정확히 yes 를 요구한다.
      # -cne(대소문자 구분)인 이유: -ne 는 5.1 에서 대소문자를 무시해 'YES'·'Yes' 도 통과했다.
      # 파괴 확인 프롬프트가 주석보다 느슨하면 안 된다(적대검증 경미10).
      $a = Read-Host "정말 지우고 다시 만들까요? 진행하려면 yes 를 그대로 입력"
      if($a -cne 'yes'){
        # ★ 종료코드를 0 으로 두면 '아무것도 안 함' 과 '구축 완료' 가 호출자에게 똑같이 보인다
        #   (적대검증 경미8). 취소는 실패가 아니므로 1(Die)도 아닌 전용 코드 2 를 쓴다.
        ExitWith $EXIT_CANCEL "취소했습니다. 아무것도 바꾸지 않았습니다(종료코드 $EXIT_CANCEL = 사용자 취소)." 'White'
      }
    }
  }

  # ==========================================================================
  #  3. 구조 생성
  # ==========================================================================
  Write-Host ""
  Info "테이블 생성: schema-calendar.sql (cal_* $($expTables.Count)개 + cal_user_rev 전원 시딩)"
  # 파일 바이트를 그대로 mysql 에 흘려 넣는다(UTF-8 보존). Get-Content 로 읽어 -e 로 넘기면
  # 인코딩과 따옴표가 두 번 해석돼 한국어 주석·REGEXP 리터럴이 깨진다.
  cmd /c "`"$mysql`" --defaults-extra-file=`"$cnf`" --default-character-set=utf8mb4 `"$DbName`" < `"$schemaFile`""
  if($LASTEXITCODE -ne 0){ Die "schema-calendar.sql 실행 실패. 위에 찍힌 mysql 오류를 그대로 읽으세요(1824=FK 대상 없음 / 3780=콜레이션 불일치 / 1146=참조 테이블 없음)." }
  Ok "schema-calendar.sql 실행 완료"

  # (옛 3-b. 감사 트리거 실행 단계 — 2026-08-11 폐지. 이 스크립트는 트리거를 만들지 않는다)

  # ==========================================================================
  #  4. 권한 — 계정이 없으면 건너뛴다(죽지 않는다)
  # ==========================================================================
  $appExists = [int](QSrv "SELECT COUNT(*) FROM mysql.user WHERE user='$appUser' AND host='$appHost';")
  $grantsRan = $false
  if($appExists -lt 1){
    Warn "계정 '$appUser'@'$appHost' 이 없어 권한 부여를 건너뜁니다."
    Warn "→ 지금은 구조만 만들어진 상태입니다. create-app-user.sql 로 계정을 만든 뒤 이 스크립트를 다시 실행하세요."
    Warn "  (권한이 없으면 앱은 cal_* 를 한 줄도 읽지 못하고 ERROR 1142 로 실패합니다)"
    Warn "  → 이 실행은 종료코드 $EXIT_NO_GRANTS(미완)로 끝납니다. 0 이 아니므로 배포 파이프라인이 그냥 넘어가지 못합니다."
  } else {
    $runFile = $grantsFile
    if($DbName -ne $grantSchema){
      # grants-calendar.sql 은 '$grantSchema.' 를 글자로 박아 뒀다(파일 머리말 참고).
      # -DbName 을 다르게 준 채 파일을 그대로 돌리면 '엉뚱한 DB' 에 권한이 붙는다.
      Warn "-DbName 이 '$DbName' 인데 grants-calendar.sql 은 '$grantSchema.' 를 박아 두었습니다 — 임시 사본에서 스키마 이름만 바꿔 실행합니다(원본은 건드리지 않음)."
      # ★ 여기서 붙는 권한은 이 실행이 끝나도, 심지어 이 DB 를 지워도 남는다(적대검증 경미9).
      #   MySQL 은 DROP DATABASE 로 mysql.tables_priv 의 표 단위 권한을 함께 지우지 않는다 —
      #   존재하지 않는 DB 에 대한 권한 줄이 운영 앱 계정에 영구히 달라붙는다. 시험용 DB 로
      #   한 번 돌리면 그 흔적이 계정에 남아, 나중에 같은 이름의 DB 가 생기면 되살아난다.
      Warn "  ★ 운영 계정 '$appUser'@'$appHost' 에 '$DbName' 의 표 권한이 **영구히** 붙습니다."
      Warn "     MySQL 은 DROP DATABASE 로도 표 단위 권한(mysql.tables_priv)을 지우지 않습니다 —"
      Warn "     시험 DB 였다면 아래 REVOKE 를 반드시 직접 실행해 되돌리세요(관리 계정으로)."
      $script:tmpGrants = Join-Path $env:TEMP ("calgrants_"+[IO.Path]::GetRandomFileName()+".sql")
      $rewritten = [regex]::Replace($grantsText, '(?i)(\sON\s+)' + [regex]::Escape($grantSchema) + '(\s*\.)', ('${1}' + $DbName + '${2}'))
      [IO.File]::WriteAllText($script:tmpGrants, $rewritten, (New-Object System.Text.UTF8Encoding($false)))
      $runFile = $script:tmpGrants
      $revokeLines = @()
      foreach($t in ($expGrants.Keys | Sort-Object)){
        $revokeLines += ("REVOKE " + ($expGrants[$t] -replace ',', ', ') + " ON ``$DbName``.``$t`` FROM '$appUser'@'$appHost';")
      }
      $revokeLines += "FLUSH PRIVILEGES;"
      $script:revokeHint = $revokeLines
    }
    Info "권한 부여: grants-calendar.sql → '$appUser'@'$appHost'"
    cmd /c "`"$mysql`" --defaults-extra-file=`"$cnf`" --default-character-set=utf8mb4 `"$DbName`" < `"$runFile`""
    if($LASTEXITCODE -ne 0){ Die "권한 부여 실패. 위 mysql 오류를 읽으세요(1146=테이블 없음 / 1410=계정 없음)." }
    $grantsRan = $true
    Ok "grants-calendar.sql 실행 완료"
    if($script:revokeHint){
      Write-Host ""
      Write-Host "    ---- '$DbName' 권한을 되돌리는 문장 (시험 DB 였다면 그대로 실행) ----" -ForegroundColor Yellow
      foreach($l in $script:revokeHint){ Write-Host "    $l" -ForegroundColor Yellow }
      Write-Host "    확인: SELECT * FROM mysql.tables_priv WHERE Db='$DbName' AND User='$appUser';  -- 0행이어야 함" -ForegroundColor Yellow
      Write-Host ""
    }
  }

  # ==========================================================================
  #  5. 게이트 — 여기서부터는 '됐다고 말하는지'가 아니라 '실제로 그런지'를 본다
  # ==========================================================================
  Write-Host ""
  Write-Host "---- 게이트 ----"
  $fail = @()

  # 5-1) 테이블이 전부 생겼는지 + 엔진.
  #   MyISAM 이면 FOREIGN KEY 를 문법만 받고 조용히 버린다 → 아래 FK 게이트가 잡긴 하지만
  #   원인을 바로 말해 주기 위해 엔진을 따로 본다.
  # ★ 2026-08-24 수정 — 조회 범위가 틀려 아래 '잔재' 검사가 죽은 문자였다.
  #   이전판은 WHERE … TABLE_NAME IN (기대 목록) 이었다. 그러면 결과는 언제나 기대 목록의 부분집합이라
  #   $extraTbl 이 **원리적으로 항상 비어** 있었다 — 바로 아래 주석이 '그 사고가 났다'고 적어 둔 검사가
  #   실제로는 아무것도 보고 있지 않았다(이번 라운드 실측: 옛 cal_room 을 cal_room_legacy 로 남겨 두고
  #   돌렸더니 이 검사는 조용했고, 새로 넣은 5-1b '옛 키 컬럼' 게이트만 그것을 잡았다).
  #   그래서 cal_* 전체를 읽고, '기대한 것' 과 '남아 있는 것' 을 그 안에서 가른다.
  $tblRows = QRows "SELECT CONCAT(TABLE_NAME,'|',ENGINE) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DbName' AND (TABLE_NAME LIKE 'cal\_%' OR TABLE_NAME IN ($(SqlList $expTables)));"
  $gotTables = @(); $badEngine = @()
  foreach($r in $tblRows){
    $p = "$r".Split('|')
    $gotTables += $p[0]
    if($p.Count -gt 1 -and $p[1] -ne 'InnoDB'){ $badEngine += ($p[0] + '=' + $p[1]) }
  }
  $gotExpected = @($gotTables | Where-Object { $expTables -contains $_ })
  $missTbl = @($expTables | Where-Object { $gotTables -notcontains $_ })
  if($missTbl.Count -gt 0){ $fail += "테이블 누락 $($missTbl.Count)개: $($missTbl -join ', ') (기대 $($expTables.Count)개 / 실제 $($gotExpected.Count)개)" }
  else { Ok "테이블 $($gotExpected.Count)/$($expTables.Count) 생성" }
  # ★ 있어야 할 것만 세면 '남아 있는 것'을 못 본다. 실제로 그 사고가 났다 — 폐지된 cal_audit_trash 가
  #   DROP 목록에 없어 옛 배포분에 고아로 살아남았는데, 이 게이트가 '기대한 표가 전부 있음'만 보고
  #   초록불을 냈다. 그 상태에서 문서·GRANT 가 세는 표 수와 DB 의 실제 표 수가 하나 어긋난다
  #   (당시 숫자는 12 대 13이었다. 지금 명부는 13개이므로 그 숫자를 지금 값으로 읽지 말 것).
  #   schema-calendar.sql 이 만들지 않는 cal_* 가 DB 에 있으면 실패로 처리한다.
  $extraTbl = @($gotTables | Where-Object { $expTables -notcontains $_ })
  if($extraTbl.Count -gt 0){
    $fail += "명부에 없는 cal_* 표가 DB 에 있습니다: $($extraTbl -join ', ') — 옛 배포분의 잔재입니다. schema-calendar.sql 의 DROP 목록에 그 표를 추가하고 다시 실행하세요(폐지된 표는 '안 만든다'만으로는 사라지지 않습니다)"
  }
  if($badEngine.Count -gt 0){ $fail += "InnoDB 가 아닌 테이블: $($badEngine -join ', ') — InnoDB 가 아니면 FOREIGN KEY 가 조용히 버려집니다" }

  # 5-1b) ★ 소유자 키 전수 확인 (2026-08-24 키 전환) — 두 가지를 본다.
  #   (가) cal_* 에 옛 키 컬럼(login_id 등)이 **0건**인가.
  #        무엇을 잡나: 전환이 절반만 끝난 상태. 파일 쪽은 이미 실행 전에 걸렀지만(위 $legacyDecl),
  #        이 게이트는 '이 DB 에 실제로 서 있는 표'를 본다 — DROP 목록에 없어 살아남은 옛 표,
  #        스키마 실행 뒤 누군가 ALTER 로 되살린 컬럼처럼 파일 검사가 볼 수 없는 것들이 여기서 걸린다.
  #        왜 실패로 다루나: 옛 컬럼이 남아 있으면 앱(user_id 로 조회)과 표가 서로 다른 키를 말하는
  #        상태이고, 그 사실은 사용자가 첫 쓰기를 하다 ERROR 1054 를 받고서야 드러난다.
  #   (나) app_user.user_id 와 cal_*.user_id 의 타입이 **글자 하나까지** 같은가, 그리고 user_id 를
  #        가져야 할 표가 전부 갖고 있는가(기대 목록은 schema-calendar.sql 에서 뽑는다).
  #        타입이 다르면 FK 가 아예 서지 않으므로 5-4 도 잡긴 하지만, 거기서는 'FK 누락'으로만 보여
  #        원인이 타입이라는 사실이 드러나지 않는다. 여기서 원인을 이름으로 말해 준다.
  $legacyCols = QRows "SELECT CONCAT(TABLE_NAME,'.',COLUMN_NAME) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME LIKE 'cal\_%' AND COLUMN_NAME IN ('login_id','category_id','entry_id','todo_id') ORDER BY TABLE_NAME, COLUMN_NAME;"
  if($legacyCols.Count -gt 0){
    $fail += "★ cal_* 에 옛 키 컬럼이 $($legacyCols.Count)건 남아 있습니다: $($legacyCols -join ', ') — 2026-08-24 키 전환(login_id/문자열 id → user_id/<표>_no)이 이 DB 에서 절반만 끝났습니다. 앱의 SQL 은 user_id 로 조회하므로 그 표는 ERROR 1054 로 죽습니다"
  } else {
    Ok "cal_* 옛 키 컬럼(login_id 등) 0건"
  }
  $gotUidTables = @(QRows "SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME LIKE 'cal\_%' AND COLUMN_NAME='user_id' ORDER BY TABLE_NAME;")
  $uidMissing = @($expUserIdTables | Where-Object { $gotUidTables -notcontains $_ })
  if($uidMissing.Count -gt 0){ $fail += "★ user_id 컬럼이 없는 cal_* 표: $($uidMissing -join ', ') (schema-calendar.sql 은 이 표들이 user_id 를 갖는다고 선언합니다)" }
  $badUidType = @(QRows "SELECT CONCAT(TABLE_NAME,'=',COLUMN_TYPE) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME LIKE 'cal\_%' AND COLUMN_NAME='user_id' AND LOWER(COLUMN_TYPE) <> '$expUserType' ORDER BY TABLE_NAME;")
  if($badUidType.Count -gt 0){ $fail += "★ user_id 타입이 기대([$expUserType])와 다른 cal_* 표: $($badUidType -join ', ') — InnoDB 는 폭·부호가 다르면 app_user 참조 FK 를 만들지 않습니다" }
  # app_user 쪽과의 대조는 선행 조건 1-4 에서 이미 했지만, 그 사이에 ALTER 가 끼어들 수 있으므로 다시 본다.
  $actUserTypeNow = (Q "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='app_user' AND COLUMN_NAME='user_id';").ToLower()
  if($actUserTypeNow -ne $expUserType){ $fail += "★ app_user.user_id 타입이 [$actUserTypeNow] 입니다 — cal_* 의 [$expUserType] 와 다릅니다(FK 가 설 수 없습니다)" }
  if($uidMissing.Count -eq 0 -and $badUidType.Count -eq 0 -and $actUserTypeNow -eq $expUserType){
    Ok "소유자 키 타입 일치 — app_user.user_id = cal_* $($gotUidTables.Count)개 표의 user_id = $expUserType"
  }

  # 5-2) ★ 설계 §3.1 릴리스 게이트 — cal_user_rev 시딩 누락 0.
  #   한 명이라도 빠지면 그 사용자는 직렬화 없이 쓰게 되고, 그 사실은 두 자리에서 동시에
  #   쓰다가 데이터가 덮여 사라진 뒤에야 드러난다. 경고가 아니라 실패로 처리한다.
  $nUser = Q "SELECT COUNT(*) FROM app_user;"
  $nRev  = Q "SELECT COUNT(*) FROM cal_user_rev;"
  $missRev = Q "SELECT COUNT(*) FROM app_user u LEFT JOIN cal_user_rev r ON r.user_id = u.user_id WHERE r.user_id IS NULL;"
  if($missRev -ne '0'){ $fail += "★ cal_user_rev 시딩 누락 $missRev 명 (app_user $nUser / cal_user_rev $nRev). 이 사람들은 §3.1 직렬화 없이 쓰게 됩니다 — schema-calendar.sql 끝의 INSERT IGNORE 를 다시 돌리세요" }
  else { Ok "cal_user_rev 시딩 누락 0 (app_user $nUser 명 / rev $nRev 행)" }

  # 5-3) GRANT 대조. 개수를 박지 않고 grants-calendar.sql 에서 뽑은 표에 맞춘다.
  if(-not $grantsRan){
    Warn "GRANT 게이트 건너뜀 — 계정이 없어 권한을 부여하지 않았습니다(구조만 완성된 상태)."
  } else {
    # 이 구간에 들어오기 전의 실패 건수. 앞 게이트(표 누락·rev 시딩)가 실패해 있어도
    # GRANT 대조 결과는 따로 찍어야 한다 — 실패 상황일수록 이 진단이 필요하다(적대검증 경미12).
    $failBeforeGrant = $fail.Count
    $granteeExpr = "CONCAT(CHAR(39 USING utf8mb4),'$appUser',CHAR(39 USING utf8mb4),'@',CHAR(39 USING utf8mb4),'$appHost',CHAR(39 USING utf8mb4))"
    $actMap = @{}
    foreach($r in (QRows "SELECT CONCAT(TABLE_NAME,'|',GROUP_CONCAT(PRIVILEGE_TYPE ORDER BY PRIVILEGE_TYPE SEPARATOR ',')) FROM information_schema.TABLE_PRIVILEGES WHERE TABLE_SCHEMA='$DbName' AND GRANTEE = $granteeExpr GROUP BY TABLE_NAME;")){
      $i = "$r".IndexOf('|')
      if($i -gt 0){ $actMap["$r".Substring(0,$i)] = "$r".Substring($i+1) }
    }
    # cal_* 는 '정확히 일치'를 요구한다. 동사가 하나 더 붙어 있는 것도 실패다 —
    # cal_user_rev/cal_user_pref/cal_migration_log 의 DELETE 금지가 바로 이 검사로 지켜진다.
    foreach($t in $calGranted){
      if(-not $actMap.ContainsKey($t)){ $fail += "GRANT 누락: $t 에 권한이 한 줄도 없습니다 (기대 $($expGrants[$t]))"; continue }
      if($actMap[$t] -ne $expGrants[$t]){ $fail += "GRANT 불일치: $t — 기대 [$($expGrants[$t])] / 실제 [$($actMap[$t])]" }
    }
    # 기존 테이블은 이미 다른 배포 스크립트가 준 권한이 더 있을 수 있으므로 '포함'만 본다.
    foreach($t in $extGranted){
      $have = @()
      if($actMap.ContainsKey($t)){ $have = @($actMap[$t].Split(',')) }
      $lack = @($expGrants[$t].Split(',') | Where-Object { $have -notcontains $_ })
      if($lack.Count -gt 0){ $fail += "GRANT 누락: $t 에 $($lack -join ',') 이(가) 없습니다" }
    }
    # ★ DB 단위 권한이 있으면 위의 '표별 정확 일치' 는 아무 의미가 없다 — DELETE 를 일부러 빼 둔
    #   cal_user_rev·cal_user_pref·cal_migration_log·cal_schema_meta 도 DB 단위 DELETE 로 지워진다.
    #   (옛날에는 여기 '권한 0줄이어야 하는 표(cal_audit_trash)' 검사가 함께 있었다. 그 표가
    #    폐지되면서 검사도 없어졌다 — 지금 cal_* 는 전부 권한이 붙는 것이 정상이다)
    $schemaPriv = Q "SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES WHERE TABLE_SCHEMA='$DbName' AND GRANTEE = $granteeExpr;"
    if($schemaPriv -ne '0'){ $fail += "★ '$appUser'@'$appHost' 에 DB 단위 권한이 $schemaPriv 건 있습니다 — DB 단위 권한이 있으면 표별 정확일치 검사가 무의미해집니다(DELETE 를 안 준 표도 지워집니다)" }
    # ★ 전역 권한(GRANT … ON *.*)은 DB 단위보다 한 칸 더 위다. 이걸 안 보면 표별 게이트가
    #   초록불인 채로 앱 계정이 무엇이든 지울 수 있다(적대검증 중대11).
    #   USAGE 는 계정이 있으면 항상 붙는 '권한 없음' 표기라 제외한다.
    $globalPriv = QSrv "SELECT COUNT(*) FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = $granteeExpr AND PRIVILEGE_TYPE <> 'USAGE';"
    if($globalPriv -ne '0'){
      $globalList = (QSrv "SELECT GROUP_CONCAT(PRIVILEGE_TYPE ORDER BY PRIVILEGE_TYPE SEPARATOR ',') FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = $granteeExpr AND PRIVILEGE_TYPE <> 'USAGE';")
      $fail += "★ '$appUser'@'$appHost' 에 전역 권한이 $globalPriv 건 있습니다 [$globalList] — 전역 권한이 있으면 표별 정확일치 검사가 전부 무의미해집니다. REVOKE 로 걷어내세요"
    }
    if($fail.Count -eq $failBeforeGrant){ Ok "GRANT 대조 — cal_* $($calGranted.Count)개 정확히 일치 · 기존 $($extGranted.Count)개 포함 · DB 단위 0 · 전역 0" }
  }

  # 5-4) FK 가 실제로 걸렸는지 + 참조 동작(CASCADE/RESTRICT)까지.
  $fkRows = QRows "SELECT CONCAT(CONSTRAINT_NAME,'|',UPDATE_RULE,'|',DELETE_RULE) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='$DbName' AND CONSTRAINT_NAME IN ($(SqlList $expFks));"
  $gotFk = @(); $badRule = @()
  foreach($r in $fkRows){
    $p = "$r".Split('|')
    $gotFk += $p[0]
    if($p.Count -gt 2 -and $expFkUpd.ContainsKey($p[0])){
      if($p[1].ToUpper() -ne $expFkUpd[$p[0]] -or $p[2].ToUpper() -ne $expFkDel[$p[0]]){
        $badRule += ("$($p[0]) (기대 ON UPDATE $($expFkUpd[$p[0]]) / ON DELETE $($expFkDel[$p[0]]), 실제 $($p[1]) / $($p[2]))")
      }
    }
  }
  $missFk = @($expFks | Where-Object { $gotFk -notcontains $_ })
  if($missFk.Count -gt 0){ $fail += "FK 누락 $($missFk.Count)개: $($missFk -join ', ') (기대 $($expFks.Count)개 / 실제 $($gotFk.Count)개)" }
  else { Ok "FK $($gotFk.Count)/$($expFks.Count) 실재" }
  if($badRule.Count -gt 0){ $fail += "FK 참조 동작 불일치: $($badRule -join ' / ') — CASCADE 와 RESTRICT 가 뒤바뀌면 부모를 지울 때 자식이 같이 사라지거나 반대로 남습니다" }

  # 5-5) CHECK — 이름이 붙었는지, 그리고 ★실제로 강제되는지.
  $gotChk = @()
  if($expChecks.Count -gt 0){
    $gotChk = QRows "SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='$DbName' AND CONSTRAINT_NAME IN ($(SqlList $expChecks));"
    $missChk = @($expChecks | Where-Object { $gotChk -notcontains $_ })
    if($missChk.Count -gt 0){ $fail += "CHECK 누락 $($missChk.Count)개: $($missChk -join ', ')" }
    else { Ok "CHECK $($gotChk.Count)/$($expChecks.Count) 등록" }
  }

  # 이름이 붙은 것과 강제되는 것은 다르다(8.0.16 미만은 파싱만 하고 무시).
  #
  # ★ 시험 대상을 cal_attendance 로 옮겼다(2026-08-24 키 전환). 이력을 남겨 둔다 —
  #   ① 원래는 cal_audit_trash 였다. 근거는 'CHECK 는 있고 FK 는 없어 부모 행 없이 시험이 닫힌다'.
  #      2026-08-11 그 표가 폐지되면서 근거를 잃었다.
  #   ② 다음이 cal_task_hours 였다. 근거는 'category_id 에 FK 가 없어 cal_category 부모 행이 필요 없다'.
  #      **그 근거가 2026-08-24 에 사라졌다** — 키 전환으로 fk_cal_task_hours_category(user_id, cat_no)
  #      가 신설되어, 이제 이 표에 한 줄 넣으려면 cal_category 부모 행부터 만들어야 한다.
  #      부모를 만들지 않고 없는 cat_no 로 찌르면 'CHECK 가 꺼진 서버'에서 3819 대신 1452 가 나와
  #      '미강제'와 '시험 불성립'을 구분할 수 없게 된다(아래 ★ 와 같은 이유).
  #   ③ 그래서 지금은 cal_attendance 다. 근거:
  #     · 자기 표 하나로 시험이 닫힌다 — FK 가 user_id → app_user 하나뿐이고, 그 값은 실재하는
  #       app_user 한 명을 SELECT 로 읽어 채운다(다른 cal_* 부모 행을 만들 필요가 없다).
  #     · CHECK 식이 컬럼 하나짜리라 위반 값을 만드는 데 해석이 필요 없다 — status='' 는
  #       chk_cal_attendance_status 의 IN 목록에 없다.
  #     · 그 CHECK 자체가 이 표의 최상위 계약('미기록 = 행 없음')을 지탱한다. status='' 가 들어가는
  #       순간 회사 일간보고로 나가는 근태가 '알 수 없는 제3의 상태'가 된다.
  #   ★ 왜 가짜 user_id 를 쓰지 않는가: 실측(8.4.9) 결과 CHECK 는 FK 보다 **먼저** 평가된다.
  #     그래서 가짜 값으로도 3819 는 나오지만, 'CHECK 가 꺼져 있는 서버'에서는 3819 대신 1452 가 나와
  #     'CHECK 미강제'와 '시험 불성립'을 구분할 수 없다. 실재 user_id 를 쓰면 두 결과가 갈린다:
  #       3819 = 강제됨 / 성공(행이 들어감) = 강제 안 됨. 판정이 흐려지지 않는다.
  #   app_user 는 읽기만 한다(이 스크립트가 기존 표에 하는 유일한 접근이 SELECT 라는 단언은 유지된다).
  #
  # ★ 종료코드만 보면 게이트가 아니라 위증이다(적대검증 중대7). probe 의 컬럼 목록은
  #   cal_attendance 정의에 붙어 있어서, 컬럼 이름이 바뀌면 ERROR 1054 로 실패하는데
  #   '0 이 아니니 거부된 것' 으로 읽어 [OK] 를 찍는다. 그래서 오류 번호로 판정한다:
  #     exit 0        → CHECK 가 강제되지 않음(실패)
  #     3819          → 정상(CHECK 위반으로 거부)
  #     그 밖의 실패  → 시험 자체가 성립하지 않음(실패로 처리. 조용히 넘기면 안 된다)
  #   ※ 2026-08-24 이 판정이 실제로 일을 했다 — 옛 probe(login_id/category_id)를 그대로 두고 돌렸더니
  #     ERROR 1054 가 났고, 종료코드만 봤다면 초록불이었을 자리에서 '시험 불성립'으로 걸렸다.
  # 출력 캡처는 cmd 의 리다이렉트로 한다 — 5.1 에서 네이티브 exe 에 PowerShell 의 2>&1 을 걸면
  # stderr 줄이 ErrorRecord 로 감싸져 $? 와 문자열 판정이 함께 흔들린다.
  if($expTables -notcontains 'cal_attendance'){
    $fail += "CHECK 강제 시험을 하지 못했습니다 — schema-calendar.sql 에 cal_attendance 가 없습니다(명부 대조에서 이미 걸렸어야 합니다)"
  } elseif($nUser -eq '0'){
    # app_user 가 비면 INSERT … SELECT 가 0행을 넣고 조용히 성공한다 — 그걸 'CHECK 미강제'로 읽으면 오진이다.
    $fail += "CHECK 강제 시험을 하지 못했습니다 — app_user 가 0행이라 FK 를 만족시킬 user_id 가 없습니다(선행 조건부터 다시 보세요)"
  } else {
    Write-Host "    (아래 ERROR 3819 는 일부러 규칙을 어기는 INSERT 의 결과입니다 — 이게 보이는 것이 정상)"
    $script:tmpProbe = Join-Path $env:TEMP ("calprobe_"+[IO.Path]::GetRandomFileName()+".sql")
    $script:tmpOut   = Join-Path $env:TEMP ("calprobe_"+[IO.Path]::GetRandomFileName()+".txt")
    # status='' 는 chk_cal_attendance_status 위반이다(IN 목록에 '' 가 없다 — 그것이 '미기록=행 없음' 계약).
    # work_date 는 실데이터와 겹치지 않는 고정 과거일이라 PK(user_id, work_date)가 진짜 행과 부딪히지 않는다.
    $probeSql = "START TRANSACTION;`r`nINSERT INTO cal_attendance (user_id, work_date, status, overtime) SELECT user_id, '1970-01-01', '', 0 FROM app_user LIMIT 1;`r`nROLLBACK;`r`n"
    [IO.File]::WriteAllText($script:tmpProbe, $probeSql, (New-Object System.Text.UTF8Encoding($false)))
    cmd /c "`"$mysql`" --defaults-extra-file=`"$cnf`" --default-character-set=utf8mb4 `"$DbName`" < `"$($script:tmpProbe)`" > `"$($script:tmpOut)`" 2>&1"
    $probeExit = $LASTEXITCODE
    $probeOut = ""
    if(Test-Path $script:tmpOut){ $probeOut = ("" + (Get-Content $script:tmpOut -Raw -Encoding UTF8)).Trim() }
    $probeLines = @($probeOut -split "`r?`n" | Where-Object { "$_".Trim() -ne "" })
    foreach($l in $probeLines){ Write-Host "      $l" }
    $probeOneLine = ($probeLines -join ' / ')
    if($probeExit -eq 0){
      $fail += "★ CHECK 가 강제되지 않습니다 — status='' 가 cal_attendance 에 들어갔습니다(chk_cal_attendance_status 위반). 서버가 CHECK 를 무시하는 상태이므로 근태 코드·all_day/반복·공수·색상 규칙이 전부 무방비입니다(서버 버전 확인)"
    } elseif($probeOut -notmatch '\b3819\b'){
      $fail += "★ CHECK 강제 시험이 성립하지 않았습니다 — 거부되긴 했으나 CHECK 위반(3819)이 아닌 다른 이유입니다. 이 상태에서는 CHECK 가 실제로 작동하는지 알 수 없습니다. mysql 출력: [$probeOneLine]"
    } else {
      Ok "CHECK 실제 강제 확인 — 위반 INSERT 가 ERROR 3819 로 거부됨(cal_attendance.status='')"
    }
    # 롤백이 됐는지도 본다. 표 전체를 세지 않고 시험 행만 본다 — 이 게이트는 데이터가 든 DB 에서도
    # 같은 뜻이어야 하기 때문이다(전체 COUNT 은 진짜 근태 행까지 세어 무의미해진다).
    $leak = Q "SELECT COUNT(*) FROM cal_attendance WHERE work_date='1970-01-01' AND status='';"
    if($leak -ne '0'){ $fail += "시험용 행이 남았습니다 — cal_attendance 에 work_date='1970-01-01' AND status='' 가 $leak 행. 직접 확인 후 지우세요" }
    Remove-Item $script:tmpProbe -Force -ErrorAction SilentlyContinue; $script:tmpProbe = $null
    Remove-Item $script:tmpOut   -Force -ErrorAction SilentlyContinue; $script:tmpOut   = $null
  }

  # 5-6) 스키마 버전 행(§5.5). 행이 없으면 낡은 클라이언트 차단이 죽은 문자가 된다.
  if($expTables -contains 'cal_schema_meta'){
    $schemaVer = Q "SELECT v FROM cal_schema_meta WHERE k='schema_version';"
    if($schemaVer -eq ""){ $fail += "★ cal_schema_meta 에 schema_version 행이 없습니다 — 위젯이 빌드 상수와 비교할 대상이 없어 §5.5 의 '낡은 클라이언트는 파괴적 연산 차단'이 성립하지 않습니다" }
    else { Ok "스키마 버전 행 schema_version = $schemaVer" }
  }

  # 5-7) ★ cal_* 트리거가 0개인지. 2026-08-11 결정으로 이 키트는 트리거를 만들지 않는다.
  #   '있어야 할 것이 있는지' 를 보던 옛 명부 대조를 '없어야 할 것이 없는지' 로 뒤집었다.
  #   명부가 비면 대조는 성립하지 않지만 0개 검사는 성립한다 — 오히려 이쪽은 상수와 파일이
  #   함께 헐거워지는 옛 약점(적대검증 중대3)이 원리적으로 없다.
  #   여기서 무엇이 잡히나: 이 스크립트 밖에서 만들어져 DROP 되지 않는 표에 붙은 트리거,
  #   그리고 schema 실행과 게이트 사이에 다른 세션이 붙인 트리거. 옛 배포의 trg_cal_* 잔재는
  #   방금 DROP TABLE 에 함께 지워졌으므로 여기서는 보이지 않는다 — 그건 1-6 이 지우기 전에 본다.
  $rogueTrig = QRows "SELECT CONCAT(TRIGGER_NAME,'|',EVENT_OBJECT_TABLE) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='$DbName' AND EVENT_OBJECT_TABLE LIKE 'cal\_%';"
  if($rogueTrig.Count -gt 0){ $fail += "★ cal_* 에 트리거가 $($rogueTrig.Count)개 붙어 있습니다: $($rogueTrig -join ', ') — 이 키트는 트리거를 만들지 않습니다(2026-08-11 감사 트리거 폐지). 누가 무엇을 위해 달았는지 확인 전에는 배포하지 마세요" }
  else { Ok "cal_* 트리거 0개 (이 키트는 트리거를 만들지 않는다 — 2026-08-11 결정)" }

  # ==========================================================================
  #  6. 판정
  # ==========================================================================
  Write-Host ""
  if($fail.Count -gt 0){
    foreach($f in $fail){ Write-Host "  [실패] $f" -ForegroundColor Red }
    Write-Host ""
    Die "게이트 $($fail.Count) 건 실패. 위 항목을 고치기 전에는 앱을 DB 모드로 전환하지 마세요 — 지금 넘어가면 사용자 데이터로 확인하게 됩니다."
  }
  # ★ 미완 배포를 '완료' 로 끝내지 않는다(적대검증 중대2). 이전판은 앱 계정이 없어도 게이트를
  #   통과하면 0 + "구축 완료" 였다 — 배포 파이프라인과 사람 둘 다 '됐다' 로 읽는다.
  #   기준은 '이 상태로 배포하면 사용자가 다치는가' 이고, 계정이 없으면 앱이 첫 조회부터
  #   ERROR 1142 로 죽는다. 1(Die)로 합치지 않는 이유와 코드 값은 머리말의 종료코드 표 참조.
  #   판정은 '경고를 찍었는가' 가 아니라 '실제로 그 단계를 돌렸는가'($grantsRan)로 한다.
  $incomplete = @()
  $nextSteps  = @()
  $exitCode   = 0
  if(-not $grantsRan){
    $incomplete += "앱 계정 '$appUser'@'$appHost' 권한 미부여(계정이 없습니다)"
    $nextSteps  += "create-app-user.sql 로 계정을 만든 뒤 이 스크립트를 다시 실행하세요 — 그 전에는 앱이 cal_* 를 한 줄도 못 읽고 ERROR 1142 로 죽습니다."
  }
  Show-RevokeHint
  if($incomplete.Count -gt 0){
    $exitCode = $EXIT_NO_GRANTS
    Write-Host ""
    Write-Host "  구조 게이트는 전부 통과했습니다(표·FK·CHECK·rev 시딩·스키마 버전 행)." -ForegroundColor Yellow
    Write-Host "  그러나 배포는 완료가 아닙니다 — 빠진 것:" -ForegroundColor Yellow
    foreach($x in $incomplete){ Write-Host "    · $x" -ForegroundColor Yellow }
    Write-Host "  다음에 할 일:" -ForegroundColor Yellow
    foreach($x in $nextSteps){ Write-Host "    → $x" -ForegroundColor Yellow }
    Write-Host ""
    ExitWith $exitCode "[미완] 캘린더 테이블 구축이 완료되지 않았습니다 — $($incomplete -join ' / ') (종료코드 $exitCode). 이 상태로 앱을 DB 모드로 전환하지 마세요." 'Yellow'
  }

  Ok "게이트 전 항목 통과 — 캘린더 테이블 구축 완료."
  Write-Host ""
  Write-Host "다음: data.xml → DB 1회성 이관 도구를 돌린 뒤(설계 §8 — cal_migration_log 가 재실행을 막습니다) 앱을 DB 모드로 전환하세요."
} finally {
  Cleanup
  if(-not $script:dying){ try{ Read-Host "엔터를 누르면 종료" }catch{} }
}
