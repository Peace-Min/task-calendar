<#
  init-db.ps1 — taskmgr DB 구조 + 앱 계정 생성 원큐 (데이터는 안 넣음)
  지금(개인 PC)·나중(서버) 모두 같은 스크립트로 실행 → 동일 구조 재현.

  하는 일:
    1) CREATE DATABASE (없으면)
    2) schema-structure.sql 실행 → customer/project 테이블(빈 구조)
    3) 앱 계정(taskmgr_app) 생성 + 최소권한(SELECT/INSERT/UPDATE) 부여
  데이터는 내부망 LLM INSERT(load-template.sql 참고) 또는 mysqldump 이관으로 채운다.

  보통은 init-db.cmd 더블클릭. root/앱 비번만 넣으면 됨.
    powershell -ExecutionPolicy Bypass -File init-db.ps1 -DbHost 192.168.0.50 -Port 3306
#>
[CmdletBinding()]
param(
  [string]$DbHost = "127.0.0.1",     # 대상 MySQL 호스트(서버 이관 시 서버 IP)
  [int]$Port = 3306,
  [string]$DbName = "taskmgr",
  [string]$BaseDir = "C:\mysql",     # mysql.exe 위치(없으면 서비스 binPath 추론)
  [string]$ServiceName = "MySQL84",
  [string]$AppUser = "taskmgr_app",  # 앱 계정명
  [string]$RootPassword = "",        # 비우면 물어봄
  [string]$AppPassword = ""          # 비우면 물어봄 — DeployConfig.DbPassword 와 같아야 함
)
$ErrorActionPreference = "Continue"  # 네이티브 stderr가 창을 닫지 않게(Stop 금지)

function Info($m){ Write-Host "[*] $m" }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Die($m){ Write-Host "[오류] $m" -ForegroundColor Red; try{ Read-Host "엔터를 누르면 종료" }catch{}; exit 1 }

$scriptDir = Split-Path -Parent $PSCommandPath

# --- mysql.exe 위치 ---
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

# --- 스키마 파일 ---
$schemaFile = Join-Path $scriptDir "schema-structure.sql"
if(-not (Test-Path $schemaFile)){ Die "schema-structure.sql 이 스크립트 폴더에 없습니다." }

Write-Host "============================================"
Write-Host "   taskmgr DB 구조/계정 생성"
Write-Host "   대상: $DbHost`:$Port  DB=$DbName"
Write-Host "============================================"

# --- 비번 입력 ---
if(-not $RootPassword){
  $s = Read-Host "MySQL root 비밀번호" -AsSecureString
  $RootPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
if(-not $AppPassword){
  Write-Host "앱 계정($AppUser) 비밀번호 — 이 값을 위젯 빌드의 DeployConfig.DbPassword 와 똑같이 넣어야 합니다."
  $s2 = Read-Host "앱 계정 비밀번호" -AsSecureString
  $AppPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
}
if(-not $RootPassword){ Die "root 비밀번호가 비어 있습니다." }
if(-not $AppPassword){ Die "앱 계정 비밀번호가 비어 있습니다." }

# --- root 임시 옵션파일(비번 경고/크래시 없이 접속) ---
$rootPwEsc = ($RootPassword -replace '\\','\\') -replace '"','\"'
$cnf = Join-Path $env:TEMP ("myinit_"+[IO.Path]::GetRandomFileName()+".cnf")
"[client]`r`nuser=root`r`npassword=""$rootPwEsc""`r`nhost=$DbHost`r`nport=$Port" | Out-File -FilePath $cnf -Encoding ascii
function RootSql($sql){ & $mysql "--defaults-extra-file=$cnf" "--default-character-set=utf8mb4" "-e" $sql }

try {
  # 접속 확인
  $ping = & $mysql "--defaults-extra-file=$cnf" "-N" "-e" "SELECT 1;"
  if("$ping".Trim() -ne "1"){ Die "root로 접속 실패. 호스트/포트/비번을 확인하세요($DbHost`:$Port)." }
  Ok "root 접속 OK"

  # 1) DATABASE
  RootSql "CREATE DATABASE IF NOT EXISTS ``$DbName`` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
  if($LASTEXITCODE -ne 0){ Die "DATABASE 생성 실패." }
  Ok "DATABASE '$DbName' 준비"

  # 2) 구조(schema-structure.sql) — 파일 바이트를 그대로 mysql에 전달(UTF-8 보존)
  Info "테이블 구조 생성(schema-structure.sql)..."
  cmd /c "`"$mysql`" --defaults-extra-file=`"$cnf`" --default-character-set=utf8mb4 `"$DbName`" < `"$schemaFile`""
  if($LASTEXITCODE -ne 0){ Die "구조 생성 실패." }
  $tbls = ("" + (& $mysql "--defaults-extra-file=$cnf" "-N" "-e" "SELECT GROUP_CONCAT(TABLE_NAME ORDER BY TABLE_NAME) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DbName';")).Trim()
  if($tbls -notmatch 'customer' -or $tbls -notmatch 'project'){ Die "테이블이 생성되지 않았습니다(현재: $tbls)." }
  Ok "테이블 생성: $tbls"

  # 3) 앱 계정 + 최소권한
  Info "앱 계정 생성/갱신: $AppUser"
  $appPwEsc = $AppPassword -replace "'","''"
  RootSql "CREATE USER IF NOT EXISTS '$AppUser'@'%' IDENTIFIED BY '$appPwEsc'; ALTER USER '$AppUser'@'%' IDENTIFIED BY '$appPwEsc';"
  if($LASTEXITCODE -ne 0){ Die "앱 계정 생성 실패." }
  RootSql "GRANT SELECT, INSERT, UPDATE ON ``$DbName``.project TO '$AppUser'@'%'; GRANT SELECT, INSERT, UPDATE ON ``$DbName``.customer TO '$AppUser'@'%'; GRANT SELECT, INSERT, UPDATE ON ``$DbName``.section_code TO '$AppUser'@'%'; GRANT SELECT, INSERT, UPDATE ON ``$DbName``.status_code TO '$AppUser'@'%'; FLUSH PRIVILEGES;"
  if($LASTEXITCODE -ne 0){ Die "권한 부여 실패." }
  Ok "앱 계정 준비(최소권한: SELECT/INSERT/UPDATE)"

  Write-Host ""
  Ok "완료! '$DbName' 구조·계정 준비됨(데이터는 비어 있음)."
  Write-Host ""
  Write-Host "다음:"
  Write-Host "  · 데이터 넣기 — load-template.sql 규칙대로 내부망 LLM이 INSERT 생성 →"
  Write-Host "      `"$mysql`" -u root -p $DbName < 만든파일.sql"
  Write-Host "  · 위젯 빌드 — DeployConfig.DbHost=$DbHost / DbPassword=(방금 앱 비번) 로 맞춰 빌드"
} finally {
  Remove-Item $cnf -Force -ErrorAction SilentlyContinue
  try{ Read-Host "엔터를 누르면 종료" }catch{}
}
