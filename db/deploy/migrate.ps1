<#
  migrate.ps1 — taskmgr 스키마 마이그레이션 원큐 (기존 DB용, 데이터 보존)
  식별키를 uid 단독으로: (customer, project_name) 유니크 제거 + contract_name/
  common_name을 NOT NULL DEFAULT ''로. 구성품별 계약·연도별 갱신이 막히지 않게 한다.

  보통은 migrate.cmd 더블클릭. root 비번만 입력하면 됨.
  - 재실행해도 안전(이미 적용됐으면 건너뜀).
  - customer(발주처)·project 데이터는 손대지 않는다(인덱스/컬럼 규격만 변경).
  - 테이블을 새로 만드는 init-db 와 다르다 — 이건 '있는 테이블을 고치는' 것.
#>
[CmdletBinding()]
param(
  [string]$BaseDir = "C:\mysql",
  [int]$Port = 3306,
  [string]$DbName = "taskmgr",
  [string]$ServiceName = "MySQL84",
  [string]$RootPassword = ""
)
$ErrorActionPreference = "Continue"   # 네이티브 stderr가 창을 닫지 않게(Stop 금지)
function Info($m){ Write-Host "[*] $m" }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Die($m){ Write-Host "[오류] $m" -ForegroundColor Red; try{ Read-Host "엔터를 누르면 종료" }catch{}; exit 1 }

Write-Host "============================================"
Write-Host "   taskmgr 스키마 마이그레이션 (데이터 보존)"
Write-Host "============================================"

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

# --- root 비번 ---
if(-not $RootPassword){
  $s = Read-Host "MySQL root 비밀번호" -AsSecureString
  $RootPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
if(-not $RootPassword){ Die "root 비밀번호가 비어 있습니다." }

# --- 임시 옵션파일(비번 경고/크래시 없이 접속) ---
$pwEsc = ($RootPassword -replace '\\','\\') -replace '"','\"'
$cnf = Join-Path $env:TEMP ("mymig_"+[IO.Path]::GetRandomFileName()+".cnf")
"[client]`r`nuser=root`r`npassword=""$pwEsc""`r`nhost=127.0.0.1`r`nport=$Port" | Out-File -FilePath $cnf -Encoding ascii
function Q($sql){ return ("" + (& $mysql "--defaults-extra-file=$cnf" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql)).Trim() }
function Exec($sql){ & $mysql "--defaults-extra-file=$cnf" "--default-character-set=utf8mb4" "-e" $sql; return $LASTEXITCODE }

try {
  # 접속 + 대상 확인
  if((Q "SELECT 1;") -ne "1"){ Die "root로 접속 실패. 비번/서버를 확인하세요(포트 $Port)." }
  $hasDb = Q "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$DbName';"
  if($hasDb -ne $DbName){ Die "'$DbName' 데이터베이스가 없습니다. (init-db 로 먼저 구축하세요)" }
  $hasTbl = Q "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project';"
  if($hasTbl -ne "project"){ Die "'$DbName.project' 테이블이 없습니다. (init-db 로 먼저 구축하세요)" }
  Ok "접속 OK · 대상 $DbName.project"

  # 현재 상태 진단
  $custN = Q "SELECT COUNT(*) FROM ``$DbName``.customer;"
  $projN = Q "SELECT COUNT(*) FROM ``$DbName``.project;"
  Info "현재 데이터 — 발주처 $custN · 과제 $projN (이 스크립트는 데이터를 지우지 않습니다)"

  $hasUq = [int](Q "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND INDEX_NAME='uq_project';")
  $cnNullable = Q "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND COLUMN_NAME='contract_name';"
  $mnNullable = Q "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND COLUMN_NAME='common_name';"

  if($hasUq -eq 0 -and $cnNullable -eq 'NO' -and $mnNullable -eq 'NO'){
    Ok "이미 최신 스키마입니다 — 변경할 것이 없습니다."
    Write-Host ""
    Write-Host "이제 과제 데이터를 넣으시면 됩니다 (같은 발주처·사업명 중복도 허용)."
    return
  }

  # 1) NULL → '' (NOT NULL 전환 전 선처리; 빈 테이블이면 0건)
  Info "빈 계약명/통상명칭 정리(NULL → '')..."
  if((Exec "UPDATE ``$DbName``.project SET contract_name='' WHERE contract_name IS NULL;") -ne 0){ Die "contract_name 정리 실패." }
  if((Exec "UPDATE ``$DbName``.project SET common_name='' WHERE common_name IS NULL;") -ne 0){ Die "common_name 정리 실패." }

  # 2) (customer, project_name) 유니크 제거 (있을 때만)
  if($hasUq -gt 0){
    Info "이름 기반 유니크(uq_project) 제거..."
    if((Exec "ALTER TABLE ``$DbName``.project DROP INDEX uq_project;") -ne 0){ Die "uq_project 제거 실패." }
  } else { Info "uq_project 없음 — 건너뜀" }

  # 3) 컬럼 NOT NULL DEFAULT '' (재실행 안전)
  Info "contract_name/common_name → NOT NULL DEFAULT ''..."
  if((Exec "ALTER TABLE ``$DbName``.project MODIFY contract_name VARCHAR(200) NOT NULL DEFAULT '', MODIFY common_name VARCHAR(200) NOT NULL DEFAULT '';") -ne 0){ Die "컬럼 변경 실패." }

  # 검증
  $uqAfter = [int](Q "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND INDEX_NAME='uq_project';")
  $custA = Q "SELECT COUNT(*) FROM ``$DbName``.customer;"
  $projA = Q "SELECT COUNT(*) FROM ``$DbName``.project;"
  if($uqAfter -ne 0){ Die "uq_project 가 아직 남아 있습니다." }
  Write-Host ""
  Ok "마이그레이션 완료!"
  Write-Host "  · uq_project 제거됨(uid 단독 식별)"
  Write-Host "  · contract_name/common_name NOT NULL DEFAULT ''"
  Write-Host "  · 데이터 보존 — 발주처 $custN→$custA · 과제 $projN→$projA"
  Write-Host ""
  Write-Host "이제 과제 데이터를 넣으시면 됩니다 (구성품별 계약·연도별 갱신 모두 허용)."
} finally {
  Remove-Item $cnf -Force -ErrorAction SilentlyContinue
  try{ Read-Host "엔터를 누르면 종료" }catch{}
}
