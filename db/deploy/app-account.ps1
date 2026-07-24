<#
  app-account.ps1 — 위젯 DB 계정(taskmgr_app)을 만들거나 비밀번호를 맞춘다.
  위젯은 DeployConfig의 DbUser/DbPassword(현재 taskmgr_app / taskmgr1234)로 접속하는데,
  MySQL에 그 계정이 없거나 비번이 다르면 위젯이 못 붙는다. 이 CLI가 그걸 일치시킨다.

  보통은 app-account.cmd 더블클릭. root 비번만 입력.
  - 계정만 만든다/고친다 — 테이블·데이터(발주처·과제)는 절대 손대지 않는다.
  - 재실행 안전(있으면 비번만 재설정).
  - 비밀번호는 조회할 수 없다(해시 저장). 이 CLI로 '맞추는' 것.
#>
[CmdletBinding()]
param(
  [string]$BaseDir = "C:\mysql",
  [int]$Port = 3306,
  [string]$DbName = "taskmgr",
  [string]$ServiceName = "MySQL84",
  [string]$RootPassword = "",
  [string]$AppUser = "taskmgr_app",       # 위젯 DeployConfig.DbUser 와 같아야 함
  [string]$AppPassword = "taskmgr1234"    # 위젯 DeployConfig.DbPassword 와 같아야 함
)
$ErrorActionPreference = "Continue"
function Info($m){ Write-Host "[*] $m" }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Die($m){ Write-Host "[오류] $m" -ForegroundColor Red; try{ Read-Host "엔터를 누르면 종료" }catch{}; exit 1 }

Write-Host "============================================"
Write-Host "   위젯 DB 계정 설정 ($AppUser)"
Write-Host "============================================"

# mysql.exe 위치
$mysql = Join-Path $BaseDir "bin\mysql.exe"
if(-not (Test-Path $mysql)){
  try {
    $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    if($svc -and $svc.PathName -match '"?([A-Za-z]:[^"]*)\\bin\\mysqld\.exe'){
      $cand = Join-Path $Matches[1] "bin\mysql.exe"; if(Test-Path $cand){ $mysql = $cand }
    }
  } catch {}
}
if(-not (Test-Path $mysql)){ Die "mysql.exe 를 못 찾았습니다. -BaseDir 로 설치 경로를 지정하세요(예: -BaseDir C:\mysql)." }

# root 비번
if(-not $RootPassword){
  $s = Read-Host "MySQL root 비밀번호" -AsSecureString
  $RootPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
if(-not $RootPassword){ Die "root 비밀번호가 비어 있습니다." }

# root 옵션파일
$pwEsc = ($RootPassword -replace '\\','\\') -replace '"','\"'
$cnf = Join-Path $env:TEMP ("myacc_"+[IO.Path]::GetRandomFileName()+".cnf")
"[client]`r`nuser=root`r`npassword=""$pwEsc""`r`nhost=127.0.0.1`r`nport=$Port" | Out-File -FilePath $cnf -Encoding ascii
function Q($sql){ return ("" + (& $mysql "--defaults-extra-file=$cnf" "-N" "-B" "-e" $sql)).Trim() }
function Exec($sql){ & $mysql "--defaults-extra-file=$cnf" "-e" $sql; return $LASTEXITCODE }

# 앱 계정 검증용 옵션파일(따로)
$appEsc = ($AppPassword -replace '\\','\\') -replace '"','\"'
$acnf = Join-Path $env:TEMP ("myacc2_"+[IO.Path]::GetRandomFileName()+".cnf")
"[client]`r`nuser=$AppUser`r`npassword=""$appEsc""`r`nhost=127.0.0.1`r`nport=$Port" | Out-File -FilePath $acnf -Encoding ascii

try {
  if((Q "SELECT 1;") -ne "1"){ Die "root로 접속 실패. 비번/서버를 확인하세요(포트 $Port)." }
  $hasDb = Q "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$DbName';"
  if($hasDb -ne $DbName){ Die "'$DbName' 데이터베이스가 없습니다. (init-db 로 먼저 구축하세요)" }

  $existed = [int](Q "SELECT COUNT(*) FROM mysql.user WHERE user='$AppUser';")
  Info ("계정 상태: " + $(if($existed -gt 0){"이미 있음 → 비밀번호 재설정"}else{"없음 → 새로 생성"}))

  # 생성 또는 비번 재설정 (계정만; 테이블/데이터 무관)
  if((Exec "CREATE USER IF NOT EXISTS '$AppUser'@'%' IDENTIFIED BY '$($AppPassword -replace "'","''")';") -ne 0){ Die "계정 생성 실패." }
  if((Exec "ALTER USER '$AppUser'@'%' IDENTIFIED BY '$($AppPassword -replace "'","''")';") -ne 0){ Die "비밀번호 설정 실패." }
  # 최소권한(두 테이블 SELECT/INSERT/UPDATE만)
  if((Exec "GRANT SELECT, INSERT, UPDATE ON ``$DbName``.project TO '$AppUser'@'%'; GRANT SELECT, INSERT, UPDATE ON ``$DbName``.customer TO '$AppUser'@'%'; GRANT SELECT, INSERT, UPDATE ON ``$DbName``.section_code TO '$AppUser'@'%'; GRANT SELECT, INSERT, UPDATE ON ``$DbName``.status_code TO '$AppUser'@'%'; FLUSH PRIVILEGES;") -ne 0){ Die "권한 부여 실패." }
  Ok "계정 준비 완료 · 최소권한(SELECT/INSERT/UPDATE)"

  # 실제 그 비번으로 접속되는지 확인 = 위젯 접속 조건과 동일
  $test = ("" + (& $mysql "--defaults-extra-file=$acnf" "-N" "-B" "-e" "SELECT 1;")).Trim()
  Write-Host ""
  if($test -eq "1"){
    Ok "검증 통과 — '$AppUser' / (입력한 비번)으로 접속 성공."
    Write-Host "  이 값이 위젯 DeployConfig(DbUser=$AppUser, DbPassword=$AppPassword)와 같으면 위젯이 바로 붙습니다."
  } else {
    Die "계정은 만들었으나 검증 접속 실패 — 원격 접속 설정(bind/방화벽)이나 호스트 범위를 확인하세요."
  }
} finally {
  Remove-Item $cnf,$acnf -Force -ErrorAction SilentlyContinue
  try{ Read-Host "엔터를 누르면 종료" }catch{}
}
