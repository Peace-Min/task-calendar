<#
  migrate.ps1 — taskmgr 스키마 마이그레이션 원큐 (기존 DB용, 데이터 보존)
  단계 1(uid 단독 식별): (customer, project_name) 유니크 제거 + contract_name/
  common_name NOT NULL DEFAULT ''. 구성품별 계약·연도별 갱신이 막히지 않게 한다.
  단계 2(코드테이블 전환): section/status ENUM → 룩업 코드테이블(section_code/status_code)
  + FK. 런타임 추가/개명(CASCADE)/순서/숨김 가능. note(비고) 컬럼 추가.

  보통은 migrate.cmd 더블클릭. root 비번만 입력하면 됨.
  - 재실행해도 안전(각 단계 information_schema로 상태 검사 후 스킵; 전부 반영이면 "이미 최신").
  - customer/project 데이터 행은 손대지 않는다(NULL→'' 정규화·인덱스/컬럼 규격/FK만 변경, 값 보존).
  - 테이블을 새로 만드는 init-db 와 다르다 — 이건 '있는 테이블을 고치는' 것.
#>
[CmdletBinding()]
param(
  [string]$BaseDir = "C:\mysql",
  [int]$Port = 3306,
  [string]$DbName = "taskmgr",
  [string]$ServiceName = "MySQL84",
  [string]$RootPassword = "",
  [string]$DbUser = "root",              # DDL 실행 계정(기본 root; root가 없으면 ALL PRIVILEGES 가진 DBA 계정 지정)
  [string]$AppUser = "taskmgr_app"       # 위젯 접속 계정 — 코드테이블 권한을 이 계정에 부여
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

# --- DB 관리자 비번 ---
if(-not $RootPassword){
  $s = Read-Host "MySQL $DbUser 비밀번호" -AsSecureString
  $RootPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
if(-not $RootPassword){ Die "$DbUser 비밀번호가 비어 있습니다." }

# --- 임시 옵션파일(비번 경고/크래시 없이 접속) ---
$pwEsc = ($RootPassword -replace '\\','\\') -replace '"','\"'
$cnf = Join-Path $env:TEMP ("mymig_"+[IO.Path]::GetRandomFileName()+".cnf")
"[client]`r`nuser=$DbUser`r`npassword=""$pwEsc""`r`nhost=127.0.0.1`r`nport=$Port" | Out-File -FilePath $cnf -Encoding ascii
function Q($sql){ return ("" + (& $mysql "--defaults-extra-file=$cnf" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql)).Trim() }
function Exec($sql){ & $mysql "--defaults-extra-file=$cnf" "--default-character-set=utf8mb4" "-e" $sql; return $LASTEXITCODE }

try {
  # 접속 + 대상 확인
  if((Q "SELECT 1;") -ne "1"){ Die "$DbUser 로 접속 실패. 비번/서버를 확인하세요(포트 $Port)." }
  $hasDb = Q "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$DbName';"
  if($hasDb -ne $DbName){ Die "'$DbName' 데이터베이스가 없습니다. (init-db 로 먼저 구축하세요)" }
  $hasTbl = Q "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project';"
  if($hasTbl -ne "project"){ Die "'$DbName.project' 테이블이 없습니다. (init-db 로 먼저 구축하세요)" }
  Ok "접속 OK · 대상 $DbName.project"

  # 현재 상태 진단
  $custN = Q "SELECT COUNT(*) FROM ``$DbName``.customer;"
  $projN = Q "SELECT COUNT(*) FROM ``$DbName``.project;"
  Info "현재 데이터 — 발주처 $custN · 과제 $projN (이 스크립트는 데이터를 지우지 않습니다)"

  # =========================================================================
  # 단계 1 — uid 단독 식별 (uq_project 제거 + contract_name/common_name NOT NULL DEFAULT '')
  # =========================================================================
  $hasUq = [int](Q "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND INDEX_NAME='uq_project';")
  $cnNullable = Q "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND COLUMN_NAME='contract_name';"
  $mnNullable = Q "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND COLUMN_NAME='common_name';"

  if($hasUq -eq 0 -and $cnNullable -eq 'NO' -and $mnNullable -eq 'NO'){
    Info "[1] uid 단독 식별 — 이미 반영됨(건너뜀)"
  } else {
    Info "[1] NULL → '' 선처리..."
    if((Exec "UPDATE ``$DbName``.project SET contract_name='' WHERE contract_name IS NULL;") -ne 0){ Die "contract_name 정리 실패." }
    if((Exec "UPDATE ``$DbName``.project SET common_name='' WHERE common_name IS NULL;") -ne 0){ Die "common_name 정리 실패." }
    if($hasUq -gt 0){
      Info "[1] 이름 기반 유니크(uq_project) 제거..."
      if((Exec "ALTER TABLE ``$DbName``.project DROP INDEX uq_project;") -ne 0){ Die "uq_project 제거 실패." }
    }
    Info "[1] contract_name/common_name → NOT NULL DEFAULT ''..."
    if((Exec "ALTER TABLE ``$DbName``.project MODIFY contract_name VARCHAR(200) NOT NULL DEFAULT '', MODIFY common_name VARCHAR(200) NOT NULL DEFAULT '';") -ne 0){ Die "컬럼 변경 실패." }
    Ok "[1] uid 단독 식별 반영"
  }

  # =========================================================================
  # 단계 2 — section/status 코드테이블 전환(+ note 컬럼). 발주처와 대칭. 각 하위단계 멱등.
  # =========================================================================
  # 2-1) 코드테이블 생성(없으면)
  Info "[2] 코드테이블(section_code/status_code) 확인/생성..."
  if((Exec @"
CREATE TABLE IF NOT EXISTS ``$DbName``.section_code (
  name VARCHAR(50) NOT NULL, sort_order INT NOT NULL DEFAULT 0, is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS ``$DbName``.status_code (
  name VARCHAR(50) NOT NULL, sort_order INT NOT NULL DEFAULT 0, is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
"@) -ne 0){ Die "코드테이블 생성 실패." }

  # 2-2) 표준 시드(INSERT IGNORE — 이미 있으면 무시)
  Info "[2] 표준 코드값 시드(INSERT IGNORE)..."
  if((Exec "INSERT IGNORE INTO ``$DbName``.section_code (name,sort_order) VALUES ('일반계약',10),('선진행',20),('사업부관리',30);") -ne 0){ Die "section_code 시드 실패." }
  if((Exec "INSERT IGNORE INTO ``$DbName``.status_code (name,sort_order) VALUES ('진행중',10),('종료',20),('1차 납품완료',30),('미정',40);") -ne 0){ Die "status_code 시드 실패." }

  # 2-3) 안전망 — project의 기존 값 중 코드테이블에 없는 것 흡수(FK 붙이기 전 필수; sort_order 900+)
  Info "[2] 기존 project 값 흡수(코드테이블에 없는 것)..."
  if((Exec "INSERT IGNORE INTO ``$DbName``.section_code (name,sort_order) SELECT DISTINCT section, 900 FROM ``$DbName``.project WHERE section IS NOT NULL AND section<>'';") -ne 0){ Die "section 값 흡수 실패." }
  if((Exec "INSERT IGNORE INTO ``$DbName``.status_code (name,sort_order) SELECT DISTINCT status, 900 FROM ``$DbName``.project WHERE status IS NOT NULL AND status<>'';") -ne 0){ Die "status 값 흡수 실패." }

  # 2-4) ENUM → VARCHAR (COLUMN_TYPE가 enum일 때만; 값 보존)
  $secType = (Q "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND COLUMN_NAME='section';").ToLower()
  $stType  = (Q "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND COLUMN_NAME='status';").ToLower()
  if($secType -like 'enum*'){
    Info "[2] project.section ENUM → VARCHAR(50)..."
    if((Exec "ALTER TABLE ``$DbName``.project MODIFY section VARCHAR(50) NOT NULL;") -ne 0){ Die "section 컬럼 변경 실패." }
  } else { Info "[2] project.section 이미 VARCHAR — 건너뜀" }
  if($stType -like 'enum*'){
    Info "[2] project.status ENUM → VARCHAR(50) NULL..."
    if((Exec "ALTER TABLE ``$DbName``.project MODIFY status VARCHAR(50) NULL;") -ne 0){ Die "status 컬럼 변경 실패." }
  } else { Info "[2] project.status 이미 VARCHAR — 건너뜀" }

  # 2-5) FK 추가(TABLE_CONSTRAINTS에 없을 때만)
  $hasFkSec = [int](Q "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND CONSTRAINT_NAME='fk_project_section';")
  $hasFkSt  = [int](Q "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND CONSTRAINT_NAME='fk_project_status';")
  if($hasFkSec -eq 0){
    Info "[2] fk_project_section 추가..."
    if((Exec "ALTER TABLE ``$DbName``.project ADD CONSTRAINT fk_project_section FOREIGN KEY (section) REFERENCES ``$DbName``.section_code(name) ON UPDATE CASCADE ON DELETE RESTRICT;") -ne 0){ Die "fk_project_section 추가 실패(코드테이블에 없는 section 값이 있는지 확인)." }
  } else { Info "[2] fk_project_section 이미 있음 — 건너뜀" }
  if($hasFkSt -eq 0){
    Info "[2] fk_project_status 추가..."
    if((Exec "ALTER TABLE ``$DbName``.project ADD CONSTRAINT fk_project_status FOREIGN KEY (status) REFERENCES ``$DbName``.status_code(name) ON UPDATE CASCADE ON DELETE RESTRICT;") -ne 0){ Die "fk_project_status 추가 실패(코드테이블에 없는 status 값이 있는지 확인)." }
  } else { Info "[2] fk_project_status 이미 있음 — 건너뜀" }

  # 2-6) note 컬럼(없으면)
  $hasNote = [int](Q "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND COLUMN_NAME='note';")
  if($hasNote -eq 0){
    Info "[2] note(비고) 컬럼 추가..."
    if((Exec "ALTER TABLE ``$DbName``.project ADD COLUMN note VARCHAR(500) NOT NULL DEFAULT '' AFTER status;") -ne 0){ Die "note 컬럼 추가 실패." }
  } else { Info "[2] note 컬럼 이미 있음 — 건너뜀" }

  # 2-7) 앱 계정에 코드테이블 권한 부여(있는 계정에만; GRANT는 멱등)
  #      — 위젯이 loadCodes/구분·상태 관리를 하려면 section_code/status_code 접근이 필요.
  #      기존 배포는 migrate.cmd 한 번으로 완결되도록 여기서 함께 부여한다.
  $appExists = [int](Q "SELECT COUNT(*) FROM mysql.user WHERE user='$AppUser';")
  if($appExists -gt 0){
    Info "[2] 앱 계정($AppUser)에 코드테이블 권한 부여..."
    if((Exec "GRANT SELECT, INSERT, UPDATE ON ``$DbName``.section_code TO '$AppUser'@'%'; GRANT SELECT, INSERT, UPDATE ON ``$DbName``.status_code TO '$AppUser'@'%'; FLUSH PRIVILEGES;") -ne 0){ Die "코드테이블 권한 부여 실패." }
  } else { Info "[2] 앱 계정($AppUser) 없음 — 권한 부여 건너뜀(init-db/app-account에서 처리)" }

  # =========================================================================
  # 검증·리포트 — count before→after 동일(무손실), 핵심 제약 존재
  # =========================================================================
  $uqAfter  = [int](Q "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND INDEX_NAME='uq_project';")
  $fkSecA   = [int](Q "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND CONSTRAINT_NAME='fk_project_section';")
  $fkStA    = [int](Q "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND CONSTRAINT_NAME='fk_project_status';")
  $noteA    = [int](Q "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DbName' AND TABLE_NAME='project' AND COLUMN_NAME='note';")
  $secN     = Q "SELECT COUNT(*) FROM ``$DbName``.section_code;"
  $stN      = Q "SELECT COUNT(*) FROM ``$DbName``.status_code;"
  $custA    = Q "SELECT COUNT(*) FROM ``$DbName``.customer;"
  $projA    = Q "SELECT COUNT(*) FROM ``$DbName``.project;"
  if($uqAfter -ne 0){ Die "uq_project 가 아직 남아 있습니다." }
  if($fkSecA -ne 1 -or $fkStA -ne 1){ Die "section/status FK가 붙지 않았습니다." }
  if($noteA -ne 1){ Die "note 컬럼이 없습니다." }
  if("$custN" -ne "$custA" -or "$projN" -ne "$projA"){ Die "데이터 건수가 변했습니다 — 발주처 $custN→$custA · 과제 $projN→$projA (중단)." }
  Write-Host ""
  Ok "마이그레이션 완료!"
  Write-Host "  · [1] uq_project 제거(uid 단독) · contract_name/common_name NOT NULL DEFAULT ''"
  Write-Host "  · [2] section/status → 코드테이블 + FK (section_code $secN · status_code $stN)"
  Write-Host "  · [2] note(비고) 컬럼 추가"
  Write-Host "  · 데이터 보존 — 발주처 $custN=$custA · 과제 $projN=$projA (무손실)"
  Write-Host ""
  Write-Host "이제 구분/상태는 앱의 '구분·상태 관리'에서 추가/개명/순서변경 가능합니다."
} finally {
  Remove-Item $cnf -Force -ErrorAction SilentlyContinue
  try{ Read-Host "엔터를 누르면 종료" }catch{}
}
