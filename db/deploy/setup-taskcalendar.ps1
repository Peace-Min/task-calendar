<#
  setup-taskcalendar.ps1 — 새 주 DB `taskcalendar` 원큐 구축. 보통은 setup-taskcalendar.cmd 더블클릭.

  무엇을 하나 — 같은 MySQL 8.4 서버 안에서, 기존 `taskmgr` 옆에 새 DB 를 하나 더 세운다:
    구조(정본 DDL 파일) → 사용자 표(회사 시드) → 과제 4표(taskmgr 에서 복사 · id/uid 보존) → 앱 계정 권한 → 검증 보고서.
    ★ 원본 `taskmgr` 는 **읽기만** 한다(0.16 클라이언트가 계속 그 DB 를 쓴다). 이 스크립트가
      원본에 내는 문장은 SELECT 와 mysqldump(읽기) 뿐이다.
    ★ 원본에서 옮기는 표는 과제 트랙 4표(section_code · status_code · customer · project)뿐이다.
    ★ 사용자 3표(title_code · org_unit · app_user)는 원본에서 옮기지 않는다 — 회사 데이터 폴더(-CompanyDataDir =
      taskmgr-company-data)의 02-seed-org.sql · 03-seed-users.sql · 04-permissions.sql 로 채운다.
      왜: 회사 보고 사이트의 명부가 폐쇄망 명부와 같고, 그 명부가 이미 시드 파일에 담겨 있다 — 조직 번호(org_id)와
      사람 번호(user_id)까지 명시 배정돼 있어, 그 번호가 곧 cal_* 가 가리킬 정본 번호다. 폐쇄망 taskmgr 의 사용자 표는
      0.16 시절 모양(org_unit 이름 PK · app_user login_id PK)이라 번호 자체가 없다.
      그래서 원본의 사용자 표는 어떤 모양이어도(없어도) 된다 — 읽는 곳은 [3] 의 login_id 명부 대조(정보용 · 멈추지
      않음) 하나뿐이다.
    ★ 캘린더 표(cal_*)는 원본에 없으므로 비어 있는 채로 시작한다
      (cal_schema_meta 버전 행과 cal_user_rev 사용자별 0 행만 채운다 — 아래 [3] 참조).
    ★ mysql 세션은 UTC 로 연다(임시 .cnf 의 [mysql] init-command). 시드 행의 created_at/updated_at 은
      CURRENT_TIMESTAMP 기본값이라 세션 time_zone 을 따르는데, 앱은 UTC 로 쓴다.

  단계(화면에 [n/5] 로 찍힌다. 첫 실패에서 멈춘다):
    [0] 사전 점검 — mysql.exe/mysqldump.exe · 접속 · 필요 파일 9개(DDL 3 · 권한 3 · 회사 시드 3) · 원본 과제 4표 ·
        대상 DB 유무(있으면 표 수 · 캘린더 기록 행 수 — 읽기만, 있어도 멈추지 않는다) · 옛 판 작업장
        (<대상>_legacy_stage) 유무 · 앱 계정 → 요약을 보여 주고 'Y' 를 받는다(-Yes 면 묻지 않는다)
        (원본의 사용자 표는 요구하지 않는다. app_user 에 login_id 가 있으면 [3] 의 명부 대조에만 쓴다.)
    [1] 원본 백업 — mysqldump(--single-transaction --no-tablespaces --routines --triggers).
        '-- Dump completed' 마감 줄과 1KB 초과를 확인한다. 대상 DB 가 이미 있으면 **늘** 대상도 같은 검증으로
        한 벌 뜬 뒤(<대상>-before-drop-<시각>.sql) DROP DATABASE 하고 처음부터 다시 만든다(아래 ⚠️ 재구축).
        옛 판이 남긴 작업장(<대상>_legacy_stage)이 있으면 함께 지운다(원본 덤프를 부은 작업용 사본이라 백업 없음).
    [2] 구조 — CREATE DATABASE → schema-structure.sql → 01-schema-users.sql → schema-calendar.sql
        (사용자 표가 캘린더보다 먼저여야 한다: schema-calendar.sql 머리의 가드가 app_user.user_id 를 요구한다)
        → 표 개수, db_structure_version(= schema-calendar.sql 이 시딩하는 값, 파일에서 읽는다) 대조
    [3] 데이터 — (a) 사용자 3표 = 회사 시드: 02-seed-org.sql → 03-seed-users.sql → 04-permissions.sql
        (대상 DB 를 선택한 채 원본 파일 그대로) → app_user.sort_order 백필(03 은 sort_order 를 적지 않는다.
        순서: 직급 서열 → 이름 → user_id, 10 간격) →
        user_id/org_id NULL·중복 0 · 3표 행 수 > 0 · AUTO_INCREMENT > MAX → 명부 대조(원본 app_user 에 login_id 가
        있으면 '원본에만 · 시드에만' 을 센다. 경고만 하고 멈추지 않는다).
        (b) 과제 4표 = 원본에서 복사 — FK 순서. 컬럼은 원본∩대상 교집합(빠진 컬럼은 대상 기본값, 원본에만 있는
        컬럼은 보고서에 이름을 적는다). project.contract_name/common_name 의 NULL 은 '' 로 넣는다(대상 NOT NULL).
        4표의 created_at/updated_at 은 KST→UTC(-9h) 로 민다(-NoShift 로 끈다). 이후 cal_user_rev 재시딩 ·
        고아 행 0(6관계 — 사용자 3관계는 곧 시드 검사) · 행 수 원본과 일치 · AUTO_INCREMENT > MAX(id) 를 확인한다.
        ★ 2026-10-15 코드표 번호 키(docs/CODE-TABLE-IDS.md §5). 원본(0.16 모양)은 이름이 키이고 대상은 번호가 키다.
          코드표 셋(section_code, status_code, customer)의 번호는 이 스크립트가 매긴다. 이름이 고정 번호 지도
          (schema-structure.sql 끝의 코드표 시드 INSERT)에 있으면(BINARY 일치) 그 번호, 없으면 지도의 MAX+1 부터 이름순이다.
          project 는 원본의 이름 열(section, customer, status)을 JOIN ON name 으로 대상의 번호 열(*_id)로 바꿔 넣는다.
          복사 뒤 번호로 되살린 이름이 원본과 BINARY 로 같은지(NULL 대칭 포함) 확인하고, 다르면 멈춘다.
          원본의 참조 고아, 빈 이름, 0과 1 밖의 is_active 는 사전 점검에서 막는다(대상의 NOT NULL 과 CHECK 가 받지 않는다).
    [4] 권한 — create-app-user.sql · grants-calendar.sql(두 파일의 `taskmgr.` 를 대상 DB 로 바꾼 임시 사본) ·
        05-grants.sql(DATABASE() 를 쓰므로 원본 그대로, 대상 DB 를 선택한 채 실행) → SHOW GRANTS 대조
    [5] 보고서 — 화면에 찍힌 모든 줄을 <BackupDir>\setup-taskcalendar-<시각>.txt 로 남긴다.
        (실패·취소·사전 점검 중단도 남긴다 — 이름 끝에 -FAILED. 백업 폴더를 못 만들면 이 스크립트 옆에 쓴다.)

  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
    0 ok - taskcalendar built and every verification passed
    1 failed - a step after the confirmation failed; see the last red line and the report file
    2 cancelled - the confirmation was not Y; nothing was changed
    3 preflight failed - tools, files, company data version, connection, source tables or app account; nothing was changed
  --- END EXITCODES ---

  ⚠️ 비밀번호: 관리자 비번(-RootPassword)·앱 비번(-AppPassword)은 mysql 명령줄에 절대 싣지 않는다.
     임시 .cnf(--defaults-extra-file)에만 쓰고, 끝나면(실패해도) finally 에서 지운다.
     -RootPassword 를 이 스크립트의 인자로 주는 것도 같은 사용자의 다른 프로세스가 명령줄로 읽을 수
     있으니(init-calendar.ps1 머리말의 실측) 대화형이면 비워 두고 물어보게 둘 것. 무인이면 stdin 첫 줄로:
       "비번" | powershell -NoProfile -ExecutionPolicy Bypass -File setup-taskcalendar.ps1 -Yes

  ⚠️ 재구축(2026-09-30 사용자 결정): 대상 DB(-TargetDb)가 이미 있으면 **실행할 때마다** 확인(Y) 뒤 그 DB 를
     한 벌 백업하고(<BackupDir>\<대상>-before-drop-<시각>.sql) DROP DATABASE 한 다음 처음부터 다시 만든다.
     멈추지 않는다 — 요약에 노란 줄로(대상에 캘린더 기록이 있으면 빨간 줄로 표별 행 수와 함께) 알릴 뿐이다.
     파일럿 동안 대상은 언제든 다시 만들 수 있는 사본이라 이렇게 정했다(원본 taskmgr 는 여전히 읽기만 한다).
     ★ 운영이 새 DB 로 넘어간 뒤에는 위험하다: 지난 실행 이후 대상에 쓰인 캘린더 데이터(일정 · 할 일 · 공수 ·
       근태 · 보고서)는 다시 실행하는 순간 지워지고, 되살릴 곳은 그 before-drop 덤프 하나뿐이다. 그때부터는
       이 스크립트를 다시 돌리지 말 것.
     -Force 는 옛 명령줄이 오류 나지 않게 이름만 남겨 둔 스위치다 — 줘도 안 줘도 동작이 같다.

  ⚠️ 인자 값을 역슬래시로 끝내지 말 것(-BackupDir "D:\x\" 등). powershell.exe 가 \" 를 이스케이프된
     따옴표로 읽어 뒤따르는 인자를 통째로 삼키고, -TargetDb 같은 값이 조용히 기본값으로 돌아간다.
     아래 AssertNoSwallow 가 그 상태를 감지하면 멈춘다(init-calendar.ps1 과 같은 가드).

  창 닫힘: .cmd 로 띄우면(TC_SETUP_LAUNCHER=cmd) 실패는 .cmd 가, 성공은 이 스크립트가 멈춰 준다(-Yes 면 성공은 안 멈춤).
     ps1 을 직접 실행하면(우클릭 'PowerShell로 실행' 등) 종료코드와 무관하게 늘 엔터를 기다린다 — 마지막 줄을
     읽기 전에 창이 꺼지지 않게. stdin 이 리다이렉트된 무인 실행은 어느 경우에도 멈추지 않는다.

  예)  setup-taskcalendar.cmd
       setup-taskcalendar.cmd -DbHost 192.168.0.50 -CompanyDataDir "D:\taskmgr-company-data"
       setup-taskcalendar.cmd -Yes                 (리허설: 묻지 않음 — 대상이 있으면 늘 백업 후 지우고 다시)
#>
[CmdletBinding()]
param(
  [string]$DbHost = "127.0.0.1",        # MySQL 호스트
  [int]$Port = 3306,
  [string]$SourceDb = "taskmgr",        # 원본(읽기만 한다)
  [string]$TargetDb = "taskcalendar",   # 새로 만들 DB
  [string]$BaseDir = "C:\mysql",        # mysql.exe 위치(없으면 서비스 binPath 추론)
  [string]$ServiceName = "MySQL84",
  [string]$DbUser = "root",             # DDL·GRANT 를 낼 관리 계정
  [string]$RootPassword = "",           # 비우면 물어봄
  [string]$AppUser = "taskmgr_app",     # 앱 계정(권한 파일 3개에 박힌 이름과 같아야 한다)
  [string]$AppPassword = "",            # 앱 계정이 아직 없을 때만 필요
  [string]$CompanyDataDir = "",         # 비우면 <스크립트>\..\..\..\taskmgr-company-data
  [string]$BackupDir = "",              # 비우면 <스크립트>\..\..\dist\setup-taskcalendar\backup
  [switch]$Force,                       # 호환용(옛 명령줄이 오류 나지 않게)일 뿐 아무 일도 안 한다 — 재구축은 이제 늘 한다(머리말 ⚠️ 재구축)
  [switch]$NoShift,                     # 과제 트랙 created_at/updated_at 의 KST→UTC 이동을 끈다
  [switch]$Yes                          # 확인 질문을 건너뛴다(무인 리허설)
)
$ErrorActionPreference = "Continue"     # 네이티브 stderr 가 창을 닫지 않게(Stop 금지)

# ============================================================================
#  상수 — 종료코드 · 복사 순서 · 시각 이동 대상 · 검사 목록
# ============================================================================
$EXIT_OK        = 0
$EXIT_FAIL      = 1
$EXIT_CANCEL    = 2
$EXIT_PREFLIGHT = 3

# 원본에서 복사하는 표 = 과제 트랙 4표뿐. 순서 = FK 부모 → 자식. (FK 검사를 끄고 넣으므로 순서가 정합성을
# 좌우하지는 않지만, 실패했을 때 '어디까지 들어갔는가' 를 사람이 읽을 수 있게 부모부터 넣는다.)
# ★ 사용자 3표는 여기 넣지 않는다 — 회사 시드(02 · 03 · 04)로 채운다(머리말). 이 목록은 복사 스크립트가
#   'DELETE 로 시드 행 비우기' 를 하는 대상이기도 하다 — 사용자 표를 넣으면 방금 채운 명부를 지우고 원본의 옛 행을 붓는다.
$COPY_ORDER   = @('section_code','status_code','customer','project')

# KST→UTC 이동 대상. 옛 DB 는 0.16 클라이언트가 KST 로 썼고, 지금 코드는 UTC 로 쓴다
# (마이그레이션 v9 가 바로 이 표들에 같은 -9h 이동을 했다). 사용자 3표는 원본에서 옮기지 않으므로(회사 시드 —
# UTC 세션의 CURRENT_TIMESTAMP) 밀 것이 없다.
$SHIFT_TABLES = @('section_code','status_code','customer','project')
$SHIFT_COLS   = @('created_at','updated_at')

# 회사 시드로 채우는 사용자 3표(시딩 뒤 행 수 > 0 을 본다).
$SEED_TABLES  = @('title_code','org_unit','app_user')

# 대상 DB 가 이미 있을 때 행 수를 세어 요약에 크게 알리는 캘린더 기록 표(사전 점검 · 정보용 — 세지 못해도 멈추지 않는다).
# 재구축은 늘 한다(머리말 ⚠️ 재구축) — 이 수가 0 이 아니면 '계속하면 지워지는 사람의 기록' 이다.
$CAL_DATA_TABLES = @('cal_entry','cal_todo','cal_task_hours','cal_attendance','cal_report_daily','cal_report_weekly')

# 복사 SELECT 에서 NULL 을 '' 로 바꿔 넣는 컬럼(옛 2026-07-24 유일성 정규화와 같은 뜻).
# 0.16 원본은 NULL 을 허용했지만 대상은 NOT NULL DEFAULT '' 라, 그대로 SELECT 하면 INSERT … SELECT 가 NULL 에서
# 막힌다. 원본은 읽기만 하므로 UPDATE 로 고칠 수 없다 — 그래서 옮기는 순간 IFNULL(<col>, '') 로 바꾼다.
$NULL_TO_EMPTY = [ordered]@{ project = @('contract_name','common_name') }

# 구조 단계 후 대상 DB 의 표 개수(과제 5 + 사용자 3 + 캘린더 파일 18). 아래 사전 점검이 세 DDL 파일의
# CREATE TABLE 수와도 맞춰 본다 — 파일에 표가 늘면 여기서 먼저 멈추고 이 값을 함께 고치라고 말한다.
# (2026-10-21 회의실 공용화: room_code +1, cal_room -1 로 23 그대로. 2026-10-22 과제 캘린더: cal_project_ 둘 +2 로 25.
#  2026-10-22 월간보고(구조 17): schema-calendar.sql 의 project_schedule_image +1 로 26.)
$EXPECTED_TABLE_COUNT = 26

# 정체성 컬럼. 원본에 이 컬럼이 없으면 교집합 복사가 조용히 새 번호를 매긴다 — 그러면 cal_* 가
# 가리킬 과제의 번호가 옛 DB 와 달라진다. 그래서 사전 점검에서 원본에 있는지부터 본다.
# (사용자 표의 번호 org_id · user_id 는 회사 시드가 명시 배정한다 — 원본을 보지 않는다.)
$KEY_COLS = [ordered]@{
  section_code = @('name');   status_code = @('name');  customer = @('name')
  project      = @('id','uid')
}
# 2026-10-15 코드표 번호 키(CODE-TABLE-IDS §5). 원본은 이름이 키이고 대상은 번호가 키다.
#   $CODE_ID_COLS : 코드표의 번호 열. 원본에서 옮기지 않고 복사할 때 매긴다(고정 번호 지도, 나머지는 MAX+1 부터 이름순).
#   $PROJECT_REFS : project 의 이름 참조(src, 원본) → 번호 참조(dst, 대상). 복사 SELECT 가 JOIN ON name 으로 바꾼다.
#                   nullable = 대상 열이 NULL 을 받는가(status_id 만. NULL 은 상태 없음).
$CODE_ID_COLS = [ordered]@{ section_code = 'section_id'; status_code = 'status_id'; customer = 'customer_id' }
$PROJECT_REFS = @(
  @{ src='section';  dst='section_id';  parent='section_code'; pid='section_id';  nullable=$false },
  @{ src='customer'; dst='customer_id'; parent='customer';     pid='customer_id'; nullable=$false },
  @{ src='status';   dst='status_id';   parent='status_code';  pid='status_id';   nullable=$true }
)
# AUTO_INCREMENT > MAX(번호) 확인 — 복사한 표와 시딩한 표를 따로 둔다(확인 시점이 다르다: 시딩 직후 · 복사 직후).
#   2026-10-15 부터 코드표 셋도 번호를 명시해 넣으므로 함께 본다.
$AUTOINC_KEYS      = [ordered]@{ section_code = 'section_id'; status_code = 'status_id'; customer = 'customer_id'; project = 'id' }
$SEED_AUTOINC_KEYS = [ordered]@{ org_unit = 'org_id'; app_user = 'user_id'; title_code = 'title_id' }

# 고아 행 검사. 복사 중에는 FK 검사를 껐으므로 **이것이 진짜 검사다.**
# 자식 컬럼이 NULL 이면 '참조 없음' 이라 고아가 아니다(status_id, org_id, title_id, parent_id 는 NULL 허용).
# 2026-10-15 부터 코드표 참조는 번호다(project.*_id, app_user.title_id).
$ORPHAN_CHECKS = @(
  @{ name='project -> customer';     child='project';  col='customer_id'; parent='customer';     pcol='customer_id' },
  @{ name='project -> section_code'; child='project';  col='section_id';  parent='section_code'; pcol='section_id' },
  @{ name='project -> status_code';  child='project';  col='status_id';   parent='status_code';  pcol='status_id' },
  @{ name='app_user -> org_unit';    child='app_user'; col='org_id';    parent='org_unit';     pcol='org_id' },
  @{ name='app_user -> title_code';  child='app_user'; col='title_id';  parent='title_code';   pcol='title_id' },
  @{ name='org_unit -> org_unit';    child='org_unit'; col='parent_id'; parent='org_unit';     pcol='org_id' }
)

# ============================================================================
#  출력 · 보고서 · 종료
# ============================================================================
$script:logLines   = New-Object System.Collections.Generic.List[string]
$script:tempFiles  = New-Object System.Collections.Generic.List[string]
$script:cnfPath    = $null
$script:preflight  = $true     # 확인 전 실패 = 3(아무것도 안 바꿈) · 확인 후 실패 = 1
$script:reportDir  = $null     # 백업 폴더가 준비된 뒤에만 보고서를 쓴다
$script:ts         = Get-Date -Format 'yyyyMMdd-HHmmss'

function Log([string]$m, [string]$color){
  if($color){ Write-Host $m -ForegroundColor $color } else { Write-Host $m }
  $script:logLines.Add($m)
}
function Info($m){ Log "[*] $m" }
function Ok($m){   Log "[OK] $m" 'Green' }
function Warn($m){ Log "[!] $m" 'Yellow' }
function Step($n, $m){ Log ""; Log "==== [$n/5] $m ====" 'Cyan' }

# 임시 파일은 전부 여기로 모아 finally 에서 지운다. .cnf 는 관리자 비번을, 앱 계정 사본은 앱 비번을 담는다.
function NewTemp([string]$prefix, [string]$ext){
  $p = Join-Path $env:TEMP ($prefix + [IO.Path]::GetRandomFileName() + $ext)
  $script:tempFiles.Add($p)
  return $p
}
function Cleanup(){
  if($script:cnfPath){ Remove-Item -LiteralPath $script:cnfPath -Force -ErrorAction SilentlyContinue; $script:cnfPath = $null }
  foreach($f in @($script:tempFiles)){ Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
  $script:tempFiles.Clear()
}
function SaveReport([string]$suffix){
  # 보고서 폴더는 -BackupDir 가 확정되는 즉시 잡는다(아래 참조). 그 전에(인자 검증에서) 죽으면 스크립트 폴더에 남긴다 —
  # 어떤 종료코드로 끝나든 "화면에 찍힌 것" 이 파일로 남아야 폐쇄망에서 결과를 가져올 수 있다(2026-09-29 실측: 사전 점검
  # 실패 = 3 은 [1] 백업 단계에 못 미쳐 보고서 폴더가 비어 있었고, 그래서 파일이 하나도 안 남았다).
  $dir = $script:reportDir
  if(-not $dir){ $dir = Split-Path -Parent $PSCommandPath }
  $p = Join-Path $dir ("setup-taskcalendar-" + $script:ts + $suffix + ".txt")
  try {
    Write-Host "[*] 보고서: $p"
    $script:logLines.Add("[*] 보고서: $p")
    # BOM 을 붙인다 — 메모장(구판 포함)이 한국어를 UTF-8 로 확실히 알아보게.
    [IO.File]::WriteAllLines($p, $script:logLines.ToArray(), (New-Object System.Text.UTF8Encoding($true)))
  } catch { Write-Host "[!] 보고서를 쓰지 못했습니다: $p ($($_.Exception.Message))" -ForegroundColor Yellow }
}
# 모든 종료가 이 한 곳을 지난다 — 보고서를 남기고, 비밀이 든 임시 파일을 지우고, 코드를 낸다.
function Finish($code, [string]$lastLine, [string]$color){
  Log $lastLine $color
  if($code -eq $EXIT_OK){ SaveReport "" } else { SaveReport "-FAILED" }
  Cleanup
  # 창을 멈추나 — 마지막 줄을 읽기 전에 창이 닫히면 안 된다(2026-09-29 사용자 실측: ps1 을 직접 실행하면
  # 실패 줄을 볼 새도 없이 창이 꺼졌다. 그 경로에는 .cmd 의 'if errorlevel 1 pause' 가 없다).
  #   · stdin 이 리다이렉트됨(무인·파이프) → 절대 멈추지 않는다(Read-Host 가 오지 않을 입력을 기다린다).
  #   · .cmd 를 거치지 않음(우클릭 'PowerShell로 실행' 등) → 종료코드와 무관하게 늘 엔터를 기다린다.
  #   · .cmd 가 띄움(TC_SETUP_LAUNCHER=cmd) → 실패는 .cmd 가 멈추므로 여기서는 성공만(-Yes 면 그것도 안 멈춤).
  $pause = $false
  if([Console]::IsInputRedirected){ $pause = $false }
  elseif($env:TC_SETUP_LAUNCHER -ne 'cmd'){ $pause = $true }
  elseif($code -eq $EXIT_OK -and -not $Yes){ $pause = $true }
  if($pause){
    try { Read-Host "엔터를 누르면 종료" | Out-Null } catch {}
  }
  exit $code
}
# 확인 전(사전 점검)에 죽으면 3, 확인 뒤에 죽으면 1. 호출하는 쪽이 고를 필요가 없게 여기서 가른다.
function Die([string]$m){
  if($script:preflight){
    Log "[사전 점검 실패] $m" 'Red'
    Finish $EXIT_PREFLIGHT "중단: 사전 점검 실패(종료코드 $EXIT_PREFLIGHT). 아무것도 바꾸지 않았습니다." 'Red'
  }
  Log "[오류] $m" 'Red'
  Finish $EXIT_FAIL "중단: 실패(종료코드 $EXIT_FAIL). 원본 '$SourceDb' 는 그대로입니다. 원인을 고친 뒤 다시 실행하세요." 'Red'
}

# ============================================================================
#  인자 검증 — 인자가 뒤엉킨 채 '조용히 다른 DB' 를 대상으로 진행하는 것을 막는다
# ============================================================================
# 왜: .cmd 가 %* 로 넘기는 인자 중 값이 역슬래시로 끝나는 따옴표 인자(-BackupDir "C:\x\")가 있으면
#   powershell.exe 가 \" 를 이스케이프된 따옴표로 읽어 뒤 인자를 그 값 안으로 삼킨다(init-calendar.ps1 실측).
#   그러면 -TargetDb 가 기본값으로 돌아가는 식으로 대상이 바뀐다(엉뚱한 DB 를 백업 후 지우고 다시 만든다). 값은 고치지 않고 멈춘다.
$SWALLOW_FLAGS = '\s-(DbHost|Port|SourceDb|TargetDb|BaseDir|ServiceName|DbUser|RootPassword|AppUser|AppPassword|CompanyDataDir|BackupDir|Force|NoShift|Yes)\b'
function AssertNoSwallow($label, $val){
  if("$val" -match '"'){ Die "$label 값에 따옴표가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태입니다 — 경로 끝의 역슬래시를 빼고 다시 실행하세요(예: -BackupDir `"D:\backup`")." }
  if("$val" -match $SWALLOW_FLAGS){ Die "$label 값 안에 다른 인자가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태라 대상이 의도와 다릅니다 — 경로 끝의 역슬래시를 빼고 다시 실행하세요." }
}
# 비밀번호는 따옴표를 포함할 수 있으므로 '다른 인자를 삼켰는가' 만 본다. 값은 화면에 찍지 않는다.
function AssertNoSwallowSecret($label, $val){
  if("$val" -match $SWALLOW_FLAGS){ Die "$label 값 안에 다른 인자 이름이 들어 있습니다(값은 표시하지 않음). 앞 인자가 역슬래시로 끝나 뒤 인자를 삼킨 상태로 보입니다 — 경로 끝의 역슬래시를 빼고 다시 실행하세요." }
}

Log "=================================================="
Log "   새 주 DB 구축: $SourceDb → $TargetDb"
Log "   서버: $DbHost`:$Port   (원본은 읽기만 합니다)"
Log "=================================================="

Step 0 "사전 점검"
AssertNoSwallow "-DbHost"         $DbHost
AssertNoSwallow "-SourceDb"       $SourceDb
AssertNoSwallow "-TargetDb"       $TargetDb
AssertNoSwallow "-BaseDir"        $BaseDir
AssertNoSwallow "-ServiceName"    $ServiceName
AssertNoSwallow "-DbUser"         $DbUser
AssertNoSwallow "-AppUser"        $AppUser
AssertNoSwallow "-CompanyDataDir" $CompanyDataDir
AssertNoSwallow "-BackupDir"      $BackupDir
AssertNoSwallowSecret "-RootPassword" $RootPassword
AssertNoSwallowSecret "-AppPassword"  $AppPassword
# 아래 값들은 SQL 문자열·식별자에 그대로 들어간다. 여기 통과가 곧 그 자리의 안전 조건이다.
if($SourceDb -notmatch '^[A-Za-z0-9_]+$'){ Die "-SourceDb 가 식별자 형식이 아닙니다: [$SourceDb]" }
if($TargetDb -notmatch '^[A-Za-z0-9_]+$'){ Die "-TargetDb 가 식별자 형식이 아닙니다: [$TargetDb]" }
if($SourceDb -eq $TargetDb){ Die "-SourceDb 와 -TargetDb 가 같습니다([$SourceDb]). 원본 위에 새 DB 를 만들 수는 없습니다." }
if($AppUser -notmatch '^[A-Za-z0-9_]+$'){ Die "-AppUser 가 식별자 형식이 아닙니다: [$AppUser]" }
if($DbUser -notmatch '^[A-Za-z0-9_.$-]+$'){ Die "-DbUser 가 식별자 형식이 아닙니다: [$DbUser]" }
if($DbHost -notmatch '^[A-Za-z0-9_.:-]+$'){ Die "-DbHost 형식이 이상합니다: [$DbHost]" }
if($Port -lt 1 -or $Port -gt 65535){ Die "-Port 범위가 아닙니다: $Port" }

function FullPath([string]$p){
  if(-not [IO.Path]::IsPathRooted($p)){ $p = Join-Path (Get-Location).ProviderPath $p }
  return [IO.Path]::GetFullPath($p)
}
$scriptDir = Split-Path -Parent $PSCommandPath
if(-not $CompanyDataDir){ $CompanyDataDir = Join-Path $scriptDir "..\..\..\taskmgr-company-data" }
if(-not $BackupDir){      $BackupDir      = Join-Path $scriptDir "..\..\dist\setup-taskcalendar\backup" }
$CompanyDataDir = FullPath $CompanyDataDir
$BackupDir      = FullPath $BackupDir
# 보고서 폴더를 지금 잡는다 — 사전 점검(종료코드 3)·취소(2)로 끝나도 보고서가 남도록. 못 만들면 SaveReport 가 스크립트 폴더로 떨어진다.
if(-not (Test-Path -LiteralPath $BackupDir)){ try { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null } catch {} }
if(Test-Path -LiteralPath $BackupDir){ $script:reportDir = $BackupDir }

# --- 도구: mysql.exe / mysqldump.exe (init-calendar.ps1 · backup-taskmgr.ps1 과 같은 방식) ---
$mysql     = Join-Path $BaseDir "bin\mysql.exe"
$mysqldump = Join-Path $BaseDir "bin\mysqldump.exe"
if(-not (Test-Path -LiteralPath $mysql) -or -not (Test-Path -LiteralPath $mysqldump)){
  try {
    $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    if($svc -and $svc.PathName -match '"?([A-Za-z]:[^"]*)\\bin\\mysqld\.exe'){
      $root = $Matches[1]
      $c1 = Join-Path $root "bin\mysql.exe";     if(Test-Path -LiteralPath $c1){ $mysql = $c1 }
      $c2 = Join-Path $root "bin\mysqldump.exe"; if(Test-Path -LiteralPath $c2){ $mysqldump = $c2 }
    }
  } catch {}
}
if(-not (Test-Path -LiteralPath $mysql)){     Die "mysql.exe 를 못 찾았습니다. -BaseDir 로 설치 경로를 지정하세요(예: -BaseDir `"C:\Program Files\MySQL\MySQL Server 8.4`")." }
if(-not (Test-Path -LiteralPath $mysqldump)){ Die "mysqldump.exe 를 못 찾았습니다. -BaseDir 로 설치 경로를 지정하세요(예: -BaseDir `"C:\Program Files\MySQL\MySQL Server 8.4`")." }
Ok "도구: $mysql"

# --- DDL · 권한 · 회사 시드 파일 9개 ---
$structFile        = Join-Path $scriptDir "schema-structure.sql"
$calFile           = Join-Path $scriptDir "schema-calendar.sql"
$appUserFile       = Join-Path $scriptDir "create-app-user.sql"
$calGrantsFile     = Join-Path $scriptDir "grants-calendar.sql"
if(-not (Test-Path -LiteralPath $CompanyDataDir -PathType Container)){
  Die "회사 데이터 폴더가 없습니다: $CompanyDataDir — 01-schema-users.sql ~ 05-grants.sql 이 든 taskmgr-company-data 폴더를 -CompanyDataDir 로 지정하세요."
}
$usersFile         = Join-Path $CompanyDataDir "01-schema-users.sql"
# 사용자 3표는 이 세 파일로 채운다(원본에서 옮기지 않는다 — 머리말). 적용 순서는 [3]: 02 → 03 → 04.
$seedOrgFile       = Join-Path $CompanyDataDir "02-seed-org.sql"
$seedUsersFile     = Join-Path $CompanyDataDir "03-seed-users.sql"
# ※ 04 의 이름을 "04-" + "permissions.sql" 로 쪼개 적는 이유: 비밀번호 명령줄 검사(시험 ②)가 코드 속 '-p…' 를
#   mysql 의 -p<비번> 으로 본다. 그 검사를 느슨하게 하는 대신 이 이름 하나만 쪼갠다.
$permsName         = "04-" + "permissions.sql"
$permsFile         = Join-Path $CompanyDataDir $permsName
$companyGrantsFile = Join-Path $CompanyDataDir "05-grants.sql"
foreach($f in @($structFile, $calFile, $appUserFile, $calGrantsFile, $usersFile, $seedOrgFile, $seedUsersFile, $permsFile, $companyGrantsFile)){
  if(-not (Test-Path -LiteralPath $f -PathType Leaf)){ Die "필요한 파일이 없습니다: $f" }
}
Ok "필요 파일 9개 확인 (DDL 3 · 권한 3 · 회사 시드 3 — 회사 데이터: $CompanyDataDir)"

# .sql 은 BOM 없는 UTF-8 이다. -Encoding UTF8 을 빼면 5.1 이 시스템 ANSI 로 읽어 한국어가 깨진다.
$structText        = Get-Content -LiteralPath $structFile        -Raw -Encoding UTF8
$calText           = Get-Content -LiteralPath $calFile           -Raw -Encoding UTF8
$usersText         = Get-Content -LiteralPath $usersFile         -Raw -Encoding UTF8
$appUserText       = Get-Content -LiteralPath $appUserFile       -Raw -Encoding UTF8
$calGrantsText     = Get-Content -LiteralPath $calGrantsFile     -Raw -Encoding UTF8
$companyGrantsText = Get-Content -LiteralPath $companyGrantsFile -Raw -Encoding UTF8

# 기대 DB 구조 번호는 schema-calendar.sql 이 시딩하는 값 그대로다(숫자를 여기 박지 않는다. 박으면
# 스키마가 올라갈 때 이 스크립트만 낡아 '정상 구축' 을 실패로 판정한다).
# 2026-10-21 부터 키는 db_structure_version 이다(옛 schema_version, docs/VERSION-GATE.md §4).
$verMatch = [regex]::Match($calText, "VALUES \('db_structure_version', '(\d+)'")
if(-not $verMatch.Success){ Die "schema-calendar.sql 에서 db_structure_version 시딩 줄(VALUES ('db_structure_version', 'N'))을 찾지 못했습니다. 파일 형식이 바뀌었습니다." }
$expVersion = $verMatch.Groups[1].Value

# 고정 번호 지도(CODE-TABLE-IDS §3). schema-structure.sql 끝의 코드표 시드 INSERT 가 정본이다(번호를 여기 박지 않는다).
#   section_code, status_code 는 시드가 있고 customer 는 없다(빈 지도 = 1 부터 이름순).
$FIXED_IDS = [ordered]@{}
foreach($t in $CODE_ID_COLS.Keys){
  $FIXED_IDS[$t] = [ordered]@{}
  $mm = [regex]::Match($structText, "(?is)INSERT\s+INTO\s+$t\s*\(\s*$($CODE_ID_COLS[$t])\s*,\s*name\s*,\s*sort_order\s*\)\s*VALUES(.*?);")
  if(-not $mm.Success){ continue }
  foreach($v in [regex]::Matches($mm.Groups[1].Value, "\(\s*(\d+)\s*,\s*'((?:[^']|'')*)'")){
    # 키는 문자열로 둔다. [ordered] 사전에 정수를 넣으면 키가 아니라 '몇 번째' 로 읽힌다.
    $FIXED_IDS[$t][[string]([int]$v.Groups[1].Value)] = $v.Groups[2].Value.Replace("''", "'")
  }
}
if($FIXED_IDS['section_code'].Count -lt 1 -or $FIXED_IDS['status_code'].Count -lt 1){
  Die "schema-structure.sql 에서 코드표 시드(INSERT INTO section_code / status_code (번호, name, sort_order))를 읽지 못했습니다. 파일 형식이 바뀌었습니다."
}
# 동작이 묶인 고정 번호(CODE-TABLE-IDS §3). 호스트 CodeIds.SectionPre, StatusEnded 와 웹 CODE_ID 가 같은 번호를 쓰고,
#   앱은 이 두 행의 숨김과 삭제를 막는다. 원본에 그 시드 이름이 없으면(라벨을 바꿨으면) 번호 2 가 비므로 멈추고,
#   원본에서 숨겨져 왔으면 대상에서 켠다. 색만 묶인 나머지 고정 번호는 없어도 경고만 한다.
$PROTECTED_IDS = [ordered]@{ section_code = '2'; status_code = '2' }
foreach($t in $PROTECTED_IDS.Keys){
  if(-not $FIXED_IDS[$t].Contains($PROTECTED_IDS[$t])){ Die "schema-structure.sql 의 $t 시드에 보호 번호 $($PROTECTED_IDS[$t]) 이 없습니다. 파일 형식이 바뀌었습니다." }
}

# 세 DDL 파일이 만드는 표 이름(줄머리의 CREATE TABLE 만 — 주석 속 예시는 '--' 로 시작하므로 안 걸린다).
$ddlTables = @()
foreach($txt in @($structText, $usersText, $calText)){
  foreach($m in [regex]::Matches($txt, '(?im)^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?')){
    if($ddlTables -notcontains $m.Groups[1].Value){ $ddlTables += $m.Groups[1].Value }
  }
}
if($ddlTables.Count -ne $EXPECTED_TABLE_COUNT){
  Die "세 DDL 파일의 CREATE TABLE 이 $($ddlTables.Count)개입니다(기대 $EXPECTED_TABLE_COUNT). 표가 늘거나 줄었다면 이 스크립트의 `$EXPECTED_TABLE_COUNT 를 함께 고치세요: $($ddlTables -join ', ')"
}
foreach($t in @($COPY_ORDER + $SEED_TABLES)){
  if($ddlTables -notcontains $t){ Die "DDL 파일에 복사·시딩 대상 표 '$t' 의 CREATE TABLE 이 없습니다." }
}

# 회사 데이터 폴더의 판 확인 — 2026-09-30 폐쇄망 실측: 회사 데이터 폴더가 2026-08-24 이전 사본이라
# 01-schema-users.sql 이 user_id 없는 app_user 를 만들었고, [2] 에서 schema-calendar.sql 의 가드
# ("app_user.user_id 없음")에 걸려 대상 DB 가 반쯤 선 채로 멈췄다. 여기서(접속 전 · 아무것도 만들기 전) 막는다.
#   · 01: app_user.user_id · org_unit.org_id 대리키 컬럼이 있어야 한다(없으면 08-24 이전 판)
#   · 02/03: 시드가 org_id · user_id 를 명시해야 한다(번호를 명시하지 않는 시드는 정본 번호를 보장하지 못한다)
$seedOrgText   = Get-Content -LiteralPath $seedOrgFile   -Raw -Encoding UTF8
$seedUsersText = Get-Content -LiteralPath $seedUsersFile -Raw -Encoding UTF8
$oldCompany = @()
if($usersText -notmatch '(?im)^\s*user_id\s+SMALLINT\b'){ $oldCompany += "01-schema-users.sql 에 app_user.user_id 가 없음" }
if($usersText -notmatch '(?im)^\s*org_id\s+SMALLINT\b'){  $oldCompany += "01-schema-users.sql 에 org_unit.org_id 가 없음" }
if($seedOrgText -notmatch '\borg_id\b'){                   $oldCompany += "02-seed-org.sql 이 org_id 를 명시하지 않음" }
if($seedUsersText -notmatch '\buser_id\b'){                $oldCompany += "03-seed-users.sql 이 user_id 를 명시하지 않음" }
if($oldCompany.Count -gt 0){
  Die ("회사 데이터 폴더가 옛 판(2026-08-24 이전)입니다: $CompanyDataDir — " + ($oldCompany -join ' · ') +
       ". 그 폴더(taskmgr-company-data)를 최신으로 받은 뒤(git pull) 다시 실행하세요.")
}
Ok "회사 데이터 판 확인 (app_user.user_id · org_unit.org_id · 시드 번호 명시)"

# AUTO_INCREMENT 바닥 = 고정 번호의 최댓값 + 1(CODE-TABLE-IDS §3). 원본에 시드 이름이 빠져 있어도(예: 구분 '사업부관리')
#   다음 새 행이 비어 있는 고정 번호를 차지하지 않게 한다. 구분, 상태는 schema-structure.sql 시드, 직급은 02 의 _title_seed.
#   customer 는 고정 번호가 없다(바닥 없음, MAX+1). CheckAutoInc 가 카운터를 이 값 이상으로 올리고 확인한다.
$AUTOINC_FLOOR = [ordered]@{}
foreach($t in $FIXED_IDS.Keys){
  if($FIXED_IDS[$t].Count -gt 0){ $AUTOINC_FLOOR[$t] = 1 + [int](($FIXED_IDS[$t].Keys | ForEach-Object { [int]$_ } | Measure-Object -Maximum).Maximum) }
}
$titleSeed = [regex]::Match($seedOrgText, "(?is)INSERT\s+INTO\s+_title_seed\s*\(\s*title_id\s*,\s*name\s*,\s*sort_order\s*\)\s*VALUES(.*?);")
if(-not $titleSeed.Success){ Die "02-seed-org.sql 에서 직급 배정표(INSERT INTO _title_seed (title_id, name, sort_order))를 읽지 못했습니다. 파일 형식이 바뀌었습니다." }
$AUTOINC_FLOOR['title_code'] = 1 + [int](([regex]::Matches($titleSeed.Groups[1].Value, "\(\s*(\d+)\s*,") | ForEach-Object { [int]$_.Groups[1].Value } | Measure-Object -Maximum).Maximum)

# 권한 파일 3개는 계정 이름을 글자로 박아 두었다. -AppUser 가 다르면 엉뚱한 계정에 권한이 붙는다.
if(-not $appUserText.Contains("'" + $AppUser + "'@'%'")){   Die "create-app-user.sql 에 '$AppUser'@'%' 가 없습니다 — 이 파일이 만드는 계정과 -AppUser 가 다릅니다." }
if(-not $calGrantsText.Contains("'" + $AppUser + "'@'%'")){ Die "grants-calendar.sql 에 '$AppUser'@'%' 가 없습니다 — 이 파일이 권한을 주는 계정과 -AppUser 가 다릅니다." }
if(-not $companyGrantsText.Contains("''" + $AppUser + "''@''%''")){ Die "05-grants.sql 에 ''$AppUser''@''%'' 가 없습니다 — 이 파일이 권한을 주는 계정과 -AppUser 가 다릅니다." }

# --- 관리자 비밀번호 ---
function ReadSecret([string]$prompt){
  # Read-Host -AsSecureString 은 stdin 이 리다이렉트돼 있으면 콘솔을 기다리며 영원히 멈춘다
  # (init-calendar.ps1 실측). 그 경우에는 stdin 첫 줄을 읽는다.
  if([Console]::IsInputRedirected){
    $line = $null
    try { $line = [Console]::In.ReadLine() } catch { $line = $null }
    return $line
  }
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
if(-not $RootPassword){ $RootPassword = ReadSecret "MySQL $DbUser 비밀번호" }
if(-not $RootPassword){ Die "$DbUser 비밀번호가 비어 있습니다(무인 실행이면 stdin 첫 줄로 주세요)." }

# ============================================================================
#  여기서부터 임시 파일이 생긴다 — 어디서 끝나든 finally/Finish 가 지운다
# ============================================================================
try {
  # --- 임시 .cnf. 비번은 여기에만 쓴다(명령줄 금지). BOM 금지 — MySQL 옵션 파서가 첫 줄을 못 읽는다.
  #     ascii 인코딩 금지 — 비ASCII 비번이 조용히 '?' 로 바뀐다(init-calendar.ps1 실측).
  $pwEsc = ($RootPassword -replace '\\','\\') -replace '"','\"'
  $script:cnfPath = Join-Path $env:TEMP ("mysetup_" + [IO.Path]::GetRandomFileName() + ".cnf")
  # [mysql] 그룹 = mysql.exe 만 읽는다. 세션 time_zone 을 UTC 로 연다 — 회사 시드 행의 created_at/updated_at 은
  #   CURRENT_TIMESTAMP 기본값이라 세션 time_zone 을 따르는데(서버 기본 SYSTEM 이면 KST), 앱은 UTC 로 쓴다.
  #   [client] 에 두면 안 된다: mysqldump 도 [client] 를 읽고, 모르는 옵션(init-command)에서 멈춘다.
  #   (DATETIME 값은 time_zone 과 무관하다 — 과제 4표 복사·-9h 이동은 이 설정의 영향을 받지 않는다.)
  $cnfText = "[client]`r`nuser=$DbUser`r`npassword=""$pwEsc""`r`nhost=$DbHost`r`nport=$Port`r`ndefault-character-set=utf8mb4`r`n" +
             "[mysql]`r`ninit-command=""SET time_zone='+00:00'""`r`n"
  [IO.File]::WriteAllText($script:cnfPath, $cnfText, (New-Object System.Text.UTF8Encoding($false)))

  function BQ([string]$n){ return ('`' + $n + '`') }
  function TQ([string]$db, [string]$t){ return ((BQ $db) + '.' + (BQ $t)) }

  # 한 결과 질의(-N -B = 머리줄·격자 없음). 실패하면 그 자리에서 죽는다 — 이 스크립트의 질의는 전부 필수다.
  function Q([string]$sql, [string]$what){
    $o = & $mysql "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql
    $rc = $LASTEXITCODE
    if($rc -ne 0){ Die "$what — mysql 이 코드 $rc 로 실패했습니다. 위에 찍힌 mysql 오류를 확인하세요." }
    if($null -eq $o){ return "" }
    return ((@($o) -join "`n").Trim())
  }
  function QRows([string]$sql, [string]$what){
    $o = & $mysql "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql
    $rc = $LASTEXITCODE
    if($rc -ne 0){ Die "$what — mysql 이 코드 $rc 로 실패했습니다. 위에 찍힌 mysql 오류를 확인하세요." }
    if($null -eq $o){ return @() }
    return @(@($o) | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne "" })
  }
  # .sql 파일을 바이트 그대로 mysql 에 흘려 넣는다(Get-Content → -e 로 넘기면 인코딩·따옴표가 두 번 해석된다).
  # 2>&1 은 cmd 안에서 처리되므로 PowerShell 5.1 의 NativeCommandError 포장이 생기지 않는다.
  # $failHint: 실패 메시지 뒤에 붙일 원인 설명(회사 시드처럼 '무엇이 남았나 · 어떻게 다시 하나' 를 알려야 하는 파일용. 비워도 된다).
  function ApplySqlFile([string]$file, [string]$db, [string]$label, [string]$failHint){
    Info "적용: $label"
    # mysql 은 오류 메시지를 UTF-8 로 낸다. PowerShell 5.1 은 네이티브 출력을 [Console]::OutputEncoding(한국어 Windows = CP949)
    # 로 읽으므로, 가드가 내는 한국어 메시지("중단: …")가 깨져 원인을 못 읽는다(2026-09-30 폐쇄망 실측). 이 호출 동안만 UTF-8 로 읽는다.
    $prevEnc = $null
    try { $prevEnc = [Console]::OutputEncoding; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { $prevEnc = $null }
    try {
      if($db){
        $out = cmd /c "`"$mysql`" --defaults-extra-file=`"$($script:cnfPath)`" --default-character-set=utf8mb4 `"$db`" 2>&1 < `"$file`""
      } else {
        $out = cmd /c "`"$mysql`" --defaults-extra-file=`"$($script:cnfPath)`" --default-character-set=utf8mb4 2>&1 < `"$file`""
      }
      $rc = $LASTEXITCODE
    } finally {
      if($prevEnc){ try { [Console]::OutputEncoding = $prevEnc } catch {} }
    }
    foreach($l in @($out)){ if("$l".Trim() -ne ""){ Log "      $l" } }
    if($rc -ne 0){ Die ("$label 적용 실패(mysql 종료코드 $rc). 위 mysql 오류 줄을 확인하세요." + $failHint) }
    Ok "$label 적용 완료"
  }
  # 백업. --result-file 을 쓰는 이유: PowerShell 의 '>' 는 5.1 에서 UTF-16/BOM 으로 써서 되먹일 수 없는 파일이 된다.
  function DumpDb([string]$db, [string]$path){
    Info "mysqldump $db → $path"
    & $mysqldump "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "--single-transaction" "--no-tablespaces" "--routines" "--triggers" "--result-file=$path" $db
    $rc = $LASTEXITCODE
    if($rc -ne 0){ Die "mysqldump($db) 가 코드 $rc 로 실패했습니다." }
    if(-not (Test-Path -LiteralPath $path)){ Die "mysqldump($db) 가 성공했다는데 파일이 없습니다: $path" }
    $size = (Get-Item -LiteralPath $path).Length
    if($size -le 1024){ Die "백업 파일이 1KB 이하입니다($size B): $path — 온전한 덤프가 아닙니다." }
    # 정상 종료한 mysqldump 는 마지막 줄에 '-- Dump completed on …' 을 쓴다. 없으면 도중에 끊긴 것이다.
    $tail = @(Get-Content -LiteralPath $path -Tail 5 -Encoding UTF8)
    $done = $false
    foreach($l in $tail){ if("$l".StartsWith("-- Dump completed")){ $done = $true } }
    if(-not $done){ Die "백업 파일 끝에 '-- Dump completed' 가 없습니다(중간에 끊겼을 수 있습니다): $path" }
    Ok ("백업 완료: {0} ({1:N1} KB)" -f $path, ($size / 1KB))
  }
  # MySQL 문자열 리터럴 안에 넣을 값. 기본 sql_mode 는 역슬래시를 이스케이프로 읽으므로 둘 다 막는다.
  function SqlStr([string]$s){ return (($s -replace '\\','\\') -replace "'","''") }
  # 권한 파일 두 개(create-app-user.sql · grants-calendar.sql)는 스키마를 `taskmgr.` 로 박아 두었다.
  # 낱말 경계 + 점까지 봐야 'taskmgr_app' 같은 계정 이름을 건드리지 않는다.
  function SubstSchema([string]$text, [string]$label){
    $out = [regex]::Replace($text, '\btaskmgr\.', ($TargetDb + '.'))
    if(-not $out.Contains($TargetDb + '.')){ Die "$label 에 바꿀 'taskmgr.' 가 하나도 없습니다 — 파일 형식이 바뀌었습니다." }
    return $out
  }
  # AUTO_INCREMENT > MAX(번호). 명시 번호로 넣으면 MySQL 이 카운터를 올린다. 그것을 확인한다.
  # 고정 번호를 둔 표($AUTOINC_FLOOR: 구분, 상태, 직급)는 카운터를 max(바닥, MAX+1)로 먼저 올리고, 바닥 이상인지도 본다.
  # stats_expiry=0: information_schema 의 AUTO_INCREMENT 는 기본 24시간 캐시라 갓 만든 표는 낡은 값을 보인다.
  # 부르는 곳은 둘: [3] 회사 시드 직후($SEED_AUTOINC_KEYS)와 과제 복사 직후($AUTOINC_KEYS).
  function CheckAutoInc([string]$t, [string]$k){
    $mx = [long](Q ("SELECT IFNULL(MAX(" + (BQ $k) + "),0) FROM " + (TQ $TargetDb $t) + ";") "$t MAX($k)")
    $floor = 0
    if($AUTOINC_FLOOR.Contains($t)){
      $floor = [long]$AUTOINC_FLOOR[$t]
      Q ("ALTER TABLE " + (TQ $TargetDb $t) + " AUTO_INCREMENT = " + [Math]::Max($floor, $mx + 1) + ";") "$t AUTO_INCREMENT 바닥 $floor" | Out-Null
    }
    $ai = [long](Q ("SET SESSION information_schema_stats_expiry=0; SELECT IFNULL(AUTO_INCREMENT,0) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$TargetDb' AND TABLE_NAME='$t';") "$t AUTO_INCREMENT")
    if($ai -le $mx){ Die "$t 의 AUTO_INCREMENT($ai) 가 MAX($k)=$mx 이하입니다 — 다음 신규 행이 기존 번호와 부딪힙니다." }
    if($ai -lt $floor){ Die "$t 의 AUTO_INCREMENT($ai) 가 고정 번호 바닥 $floor 보다 작습니다. 다음 새 행이 비어 있는 고정 번호를 차지합니다." }
    Log ("  {0,-13} MAX({1})={2} · AUTO_INCREMENT={3}" -f $t, $k, $mx, $ai)
  }
  # 실패해도 죽지 않는 여러 줄 질의 — 정보용 질의(사전 점검의 캘린더 기록 행 수 · [3] 명부 대조)에만 쓴다.
  # 나머지 질의는 전부 필수라 Q/QRows(실패 = Die)다.
  function QRowsTry([string]$sql){
    $o = & $mysql "--defaults-extra-file=$($script:cnfPath)" "--default-character-set=utf8mb4" "-N" "-B" "-e" $sql
    if($LASTEXITCODE -ne 0){ return @{ ok = $false; rows = @() } }
    if($null -eq $o){ return @{ ok = $true; rows = @() } }
    return @{ ok = $true; rows = @(@($o) | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne "" }) }
  }

  # --- 접속 ---
  $ping = & $mysql "--defaults-extra-file=$($script:cnfPath)" "-N" "-B" "-e" "SELECT 1;"
  if("$ping".Trim() -ne "1"){ Die "$DbUser 로 접속하지 못했습니다. 호스트/포트/비밀번호를 확인하세요($DbHost`:$Port)." }
  $serverVer = Q "SELECT VERSION();" "서버 버전"
  Ok "접속 OK ($DbUser@$DbHost`:$Port, MySQL $serverVer)"

  # --- 원본 DB · 과제 4표 · 정체성 컬럼 ---
  # 원본에서 요구하는 표는 복사할 과제 4표뿐이다. 사용자 표는 어떤 모양이어도(없어도) 된다 — 회사 시드로 채운다(머리말).
  $hasSrc = Q "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$SourceDb';" "원본 DB 확인"
  if([int]$hasSrc -lt 1){ Die "원본 DB '$SourceDb' 가 없습니다." }
  $srcTables = @(QRows "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$SourceDb' AND TABLE_TYPE='BASE TABLE';" "원본 표 목록")
  $lack = @($COPY_ORDER | Where-Object { $srcTables -notcontains $_ })
  if($lack.Count -gt 0){ Die "원본 '$SourceDb' 에 다음 표가 없습니다: $($lack -join ', ')" }
  $srcColMap = @{}
  foreach($t in $KEY_COLS.Keys){
    $sc = @(QRows "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$SourceDb' AND TABLE_NAME='$t';" "원본 $t 컬럼")
    $srcColMap[$t] = $sc
    foreach($k in $KEY_COLS[$t]){
      if($sc -notcontains $k){ Die "원본 $SourceDb.$t 에 정체성 컬럼 '$k' 가 없습니다. 이대로 복사하면 새 번호가 매겨져 옛 번호와 어긋납니다 — 원본을 먼저 최신 스키마로 마이그레이션하세요." }
    }
  }
  # --- 2026-10-15 번호 키로 옮길 수 있는가(읽기만, 확인 전) ---
  #   대상의 NOT NULL 과 CHECK 는 원본의 어긋난 행을 받지 않는다(FK 를 끄고 넣어도 번호가 비거나 CHECK 에 걸린다).
  #   그래서 여기서 센다. 하나라도 있으면 원본 데이터를 먼저 고친다(이 스크립트는 원본을 고치지 않는다).
  foreach($r in $PROJECT_REFS){
    if($srcColMap['project'] -notcontains $r.src){ Die "원본 $SourceDb.project 에 이름 참조 컬럼 '$($r.src)' 가 없습니다. 이 스크립트는 0.16 모양(이름 키) 원본을 전제로 합니다." }
  }
  $srcBad = @()
  foreach($r in $PROJECT_REFS){
    $n = [long](Q ("SELECT COUNT(*) FROM " + (TQ $SourceDb 'project') + " c LEFT JOIN " + (TQ $SourceDb $r.parent) + " p ON p.``name`` = c." + (BQ $r.src) + " WHERE c." + (BQ $r.src) + " IS NOT NULL AND p.``name`` IS NULL;") "원본 project.$($r.src) 고아 수")
    if($n -ne 0){ $srcBad += "project.$($r.src) 가 $($r.parent) 에 없는 이름을 가리키는 행 $n 개" }
    if(-not $r.nullable){
      $n = [long](Q ("SELECT COUNT(*) FROM " + (TQ $SourceDb 'project') + " WHERE " + (BQ $r.src) + " IS NULL;") "원본 project.$($r.src) NULL 수")
      if($n -ne 0){ $srcBad += "project.$($r.src) 가 NULL 인 행 $n 개(대상은 NOT NULL)" }
    }
  }
  foreach($t in $CODE_ID_COLS.Keys){
    $n = [long](Q ("SELECT COUNT(*) FROM " + (TQ $SourceDb $t) + " WHERE ``name`` = '';") "원본 $t 빈 이름 수")
    if($n -ne 0){ $srcBad += "$t 의 빈 이름 $n 행(대상 CHECK name <> '')" }
  }
  # 보호 번호(구분 2, 상태 2)는 시드 이름으로만 받는다. 원본에서 라벨을 바꿨다면 번호 2 가 비어 동작이 아무 행에도 걸리지 않는다.
  #   한글 이름은 명령줄 글자가 아니라 16진(X'...')으로 넘긴다(콘솔 코드페이지에서 깨진다).
  foreach($t in $PROTECTED_IDS.Keys){
    $pnm = $FIXED_IDS[$t][$PROTECTED_IDS[$t]]
    $phex = ([BitConverter]::ToString([Text.Encoding]::UTF8.GetBytes($pnm))).Replace('-', '')
    $n = [long](Q ("SELECT COUNT(*) FROM " + (TQ $SourceDb $t) + " WHERE CAST(CONVERT(``name`` USING utf8mb4) AS BINARY) = X'" + $phex + "';") "원본 $t 보호 이름")
    if($n -ne 1){ $srcBad += "$t 에 이름 '$pnm' 이 없음(고정 번호 $($PROTECTED_IDS[$t]) 은 앱 동작에 묶여 있다. 원본에서 그 라벨을 '$pnm' 으로 되돌릴 것. 이름은 구축 뒤 관리 화면에서 다시 바꿀 수 있다)" }
  }
  foreach($t in $COPY_ORDER){
    if($srcColMap[$t] -contains 'is_active'){
      $n = [long](Q ("SELECT COUNT(*) FROM " + (TQ $SourceDb $t) + " WHERE is_active NOT IN (0,1);") "원본 $t is_active 범위")
      if($n -ne 0){ $srcBad += "$t.is_active 가 0, 1 이 아닌 행 $n 개(대상 CHECK)" }
    }
  }
  if($srcBad.Count -gt 0){ Die ("원본 '$SourceDb' 의 과제 트랙을 번호 키로 옮길 수 없습니다: " + ($srcBad -join '; ') + ". 원본을 고친 뒤 다시 실행하세요.") }
  Ok "원본 이름 참조 점검: 고아 0, 빈 이름 0, is_active 0/1 (번호 키로 옮길 수 있음)"

  # 명부 대조([3], 정보용)를 할 수 있는가 — 원본 app_user 에 login_id 가 있을 때만(0.16 옛 모양에도 있다).
  # 없으면 대조를 건너뛸 뿐 멈추지 않는다.
  $srcLoginCheck = $false
  if($srcTables -contains 'app_user'){
    $srcAppCols = @(QRows "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$SourceDb' AND TABLE_NAME='app_user';" "원본 app_user 컬럼(명부 대조용)")
    $srcLoginCheck = ($srcAppCols -contains 'login_id')
  }
  $srcCounts = [ordered]@{}
  foreach($t in $COPY_ORDER){ $srcCounts[$t] = [long](Q ("SELECT COUNT(*) FROM " + (TQ $SourceDb $t) + ";") "원본 $t 행 수") }
  Ok ("원본 '$SourceDb' 과제 4표 확인: " + (($COPY_ORDER | ForEach-Object { "$_=" + $srcCounts[$_] }) -join ' '))

  # --- 대상 DB 가 이미 있는가 — 있어도 멈추지 않는다: [1] 에서 늘 백업한 뒤 DROP 하고 처음부터 다시 만든다 ---
  #     (2026-09-30 사용자 결정 · 머리말 ⚠️ 재구축.) 여기서는 읽기만 한다 — 표 수와 캘린더 기록 행 수를 요약에 알린다.
  $hasTgt = [int](Q "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$TargetDb';" "대상 DB 확인")
  $targetExists = ($hasTgt -gt 0)
  $tgtTableCount = 0
  if($targetExists){
    $tgtTableCount = [int](Q "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$TargetDb';" "대상 표 수")
    Warn "대상 DB '$TargetDb' 가 이미 있습니다(표 $tgtTableCount 개) — 확인하면 백업한 뒤 지우고 처음부터 다시 만듭니다."
  }
  # 캘린더 기록 행 수(정보용 — 이 블록은 절대 멈추지 않는다: Die 도, 실패하면 죽는 Q/QRows 도 쓰지 않는다).
  # $CAL_DATA_TABLES 중 대상에 실제로 있는 표만 센다(없는 표는 건너뛴다). 못 센 표는 '?' 로 적고 경고만 한다.
  $calCounts = [ordered]@{}
  $calTotal = 0
  $calCountFailed = $false
  if($targetExists -and $tgtTableCount -gt 0){
    $inList = (($CAL_DATA_TABLES | ForEach-Object { "'" + $_ + "'" }) -join ',')
    $rPresent = QRowsTry ("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$TargetDb' AND TABLE_NAME IN ($inList);")
    if(-not $rPresent.ok){
      $calCountFailed = $true
    } else {
      foreach($t in $CAL_DATA_TABLES){
        if(@($rPresent.rows) -notcontains $t){ continue }
        $rCnt = QRowsTry ("SELECT COUNT(*) FROM " + (TQ $TargetDb $t) + ";")
        $first = $null
        if($rCnt.ok -and @($rCnt.rows).Count -ge 1){ $first = "" + @($rCnt.rows)[0] }
        if($first -match '^\d+$'){
          $calCounts[$t] = [long]$first
          $calTotal += [long]$first
        } else {
          $calCounts[$t] = '?'
          $calCountFailed = $true
        }
      }
    }
    if($calCountFailed){ Warn "대상 '$TargetDb' 의 캘린더 기록 행 수를 다 세지 못했습니다(위 mysql 오류) — 못 센 표는 '?' 로 적습니다. 계속하면 그 표도 지워집니다." }
  }
  $calCountText = (@($calCounts.Keys) | ForEach-Object { "$_=" + $calCounts[$_] }) -join ' '
  if($targetExists -and -not $calCountText){
    if($calCountFailed){ $calCountText = '(세지 못함)' } else { $calCountText = '(캘린더 기록 표 없음)' }
  }

  # --- 옛 판이 남긴 작업장 — 옛 판(eeda5fc: 08-24 이전 사용자 표를 스테이징에서 마이그레이션하던 판)이 만든
  #     '<대상>_legacy_stage' 가 사용자 PC 에 남아 있을 수 있다(그 판은 도중에 멈추면 작업장을 남겼다). 지금 판은
  #     그 DB 를 쓰지 않는다. 여기서는 있는지만 본다(읽기) — 지우는 것은 [1](확인 뒤)이고, 이름 가드는 거기서 한 번 더 본다.
  $legacyStageDb = $TargetDb + "_legacy_stage"
  $legacyStageExists = $false
  if($legacyStageDb -match '^[A-Za-z0-9_]+$' -and $legacyStageDb -ne $SourceDb -and $legacyStageDb -ne $TargetDb){
    $legacyStageExists = ([int](Q "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$legacyStageDb';" "옛 판 작업장 확인") -gt 0)
  }

  # --- 앱 계정 ---
  $appExists = ([int](Q "SELECT COUNT(*) FROM mysql.user WHERE user='$AppUser' AND host='%';" "앱 계정 확인") -gt 0)
  if(-not $appExists -and -not $AppPassword){
    Die "앱 계정 '$AppUser'@'%' 이 없습니다. -AppPassword 로 새 계정의 비밀번호를 주세요(위젯 빌드의 DeployConfig.DbPassword 와 같아야 합니다)."
  }

  $doShift = -not $NoShift
  Log ""
  Log "  ---- 요약 ----"
  Log "  서버          : $DbHost`:$Port (MySQL $serverVer)"
  Log "  원본(읽기만)  : $SourceDb"
  if($targetExists){
    Log "  대상 DB       : '$TargetDb' 이미 있음(표 $tgtTableCount 개) → 백업 후 삭제하고 처음부터 다시 만듦" 'Yellow'
    if($calTotal -gt 0){ Log "  ★ 대상에 캘린더 기록이 있습니다: $calCountText — 계속하면 지워집니다(백업 파일에만 남음)" 'Red' }
    elseif($calCountFailed){ Log "  ★ 대상의 캘린더 기록을 다 세지 못했습니다: $calCountText — 기록이 있다면 계속하면 지워집니다(백업 파일에만 남음)" 'Red' }
    else { Log "  캘린더 기록   : $calCountText — 지워질 기록 없음" }
  } else {
    Log "  대상(새로)    : $TargetDb"
  }
  if($legacyStageExists){ Log "  옛 판이 남긴 작업장: '$legacyStageDb' 있음 → 삭제" 'Yellow' }
  Log "  구조 번호     : $expVersion (schema-calendar.sql 의 db_structure_version)"
  Log "  백업 폴더     : $BackupDir"
  Log "  회사 데이터   : $CompanyDataDir"
  Log "  원본에서 복사 : $($COPY_ORDER -join ',') (과제 트랙 4표)"
  Log "  번호 키       : 원본 이름 키를 대상 번호 키로 바꿈(고정 번호 = schema-structure.sql 시드, 나머지는 MAX+1 부터 이름순)"
  Log "  사용자 표     : 원본에서 옮기지 않음 — 회사 시드(02·03·04)로 채움 (보고 사이트 명부와 동일)"
  if($srcLoginCheck){ Log "  명부 대조     : 원본 app_user.login_id ↔ 시드 명부 (정보용 — 달라도 멈추지 않음)" }
  else              { Log "  명부 대조     : 안 함 (원본에 app_user.login_id 없음)" }
  if($doShift){ Log "  시각 이동     : 켬 — $($SHIFT_TABLES -join ',') 의 $($SHIFT_COLS -join '/') 를 -9시간(KST→UTC)" }
  else        { Log "  시각 이동     : 끔 (-NoShift)" }
  if($appExists){ Log "  앱 계정       : '$AppUser'@'%' 있음 (권한만 추가)" }
  else          { Log "  앱 계정       : '$AppUser'@'%' 없음 → -AppPassword 로 새로 만듦" }
  Log ""

  if(-not $Yes){
    $a = Read-Host "계속하려면 Y"
    if("$a".Trim() -ne 'Y'){
      Finish $EXIT_CANCEL "취소했습니다. 아무것도 바꾸지 않았습니다(종료코드 $EXIT_CANCEL)." 'White'
    }
  }
  $script:preflight = $false

  # ==========================================================================
  #  [1/5] 원본 백업
  # ==========================================================================
  Step 1 "원본 백업"
  if(-not (Test-Path -LiteralPath $BackupDir)){
    try { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null } catch {}
  }
  if(-not (Test-Path -LiteralPath $BackupDir)){ Die "백업 폴더를 만들 수 없습니다: $BackupDir" }
  $script:reportDir = $BackupDir   # (위에서 이미 잡았지만, 여기서 만든 경우를 위해 한 번 더)
  $srcDump = Join-Path $BackupDir ("$SourceDb-" + $script:ts + ".sql")
  DumpDb $SourceDb $srcDump

  # 대상 DB 가 이미 있으면 — **늘** 백업한 뒤 DROP 하고 처음부터 다시 만든다(2026-09-30 사용자 결정 · -Force 불필요).
  #   순서가 곧 안전 조건이다: (1) 확인(Y) 뒤 — 위 $script:preflight = $false 보다 아래 (2) 원본 덤프 뒤
  #   (3) 대상 덤프가 검증(마감 줄 · 1KB)까지 통과한 뒤 — DumpDb 는 실패하면 Die 하므로 덤프가 온전하지 않으면
  #   아래 DROP 줄에 닿지 않는다. 이 순서를 바꾸지 말 것(시험 ⑧).
  $tgtDump = $null
  if($targetExists){
    $tgtDump = Join-Path $BackupDir ("$TargetDb-before-drop-" + $script:ts + ".sql")
    DumpDb $TargetDb $tgtDump
    Warn "대상 DB '$TargetDb' 삭제 — 삭제 전 백업: $tgtDump"
    Q ("DROP DATABASE " + (BQ $TargetDb) + ";") "대상 DB 삭제" | Out-Null
    Ok "대상 DB '$TargetDb' 삭제 완료 — [2] 에서 처음부터 다시 만듭니다."
  }

  # 옛 판이 남긴 작업장 치우기(옛 판 eeda5fc 의 스테이징 DB). 원본 덤프를 부어 마이그레이션하던 작업용 사본이라
  # 백업하지 않는다(그 원본은 위에서 방금 떴다). 이름 가드: 정확히 <대상>_legacy_stage(대소문자까지) · 원본/대상과
  # 다름 · 식별자 형식 — 하나라도 어긋나면 건드리지 않고 경고만 한다.
  $legacyStageDropped = $false
  if($legacyStageExists){
    $stageOk = ($legacyStageDb -ceq ($TargetDb + "_legacy_stage")) -and ($legacyStageDb -ne $SourceDb) -and ($legacyStageDb -ne $TargetDb) -and ($legacyStageDb -match '^[A-Za-z0-9_]+$')
    if($stageOk){
      Warn "옛 판이 남긴 작업장 '$legacyStageDb' 삭제(백업 없음 — 원본 덤프로 만든 작업용 사본)"
      Q ("DROP DATABASE IF EXISTS " + (BQ $legacyStageDb) + ";") "옛 판 작업장 삭제" | Out-Null
      $legacyStageDropped = $true
      Ok "옛 판 작업장 '$legacyStageDb' 삭제 완료"
    } else {
      Warn "옛 판 작업장 이름이 예상과 다릅니다: [$legacyStageDb] — 지우지 않고 계속합니다."
    }
  }

  # ==========================================================================
  #  [2/5] 구조
  # ==========================================================================
  Step 2 "구조 생성"
  Q ("CREATE DATABASE " + (BQ $TargetDb) + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;") "대상 DB 생성" | Out-Null
  Ok "DATABASE '$TargetDb' 생성 (utf8mb4 / utf8mb4_0900_ai_ci)"
  ApplySqlFile $structFile $TargetDb "schema-structure.sql (과제 트랙)"
  ApplySqlFile $usersFile $TargetDb "01-schema-users.sql (사용자·조직)"
  ApplySqlFile $calFile $TargetDb "schema-calendar.sql (캘린더 cal_*)"

  $tblCount = [int](Q "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$TargetDb';" "대상 표 수")
  if($tblCount -ne $EXPECTED_TABLE_COUNT){ Die "대상 '$TargetDb' 의 표가 $tblCount 개입니다(기대 $EXPECTED_TABLE_COUNT)." }
  $tgtTables = @(QRows "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$TargetDb';" "대상 표 목록")
  $miss = @($ddlTables | Where-Object { $tgtTables -notcontains $_ })
  if($miss.Count -gt 0){ Die "DDL 이 만드는 표 중 대상에 없는 것이 있습니다: $($miss -join ', ')" }
  $actVersion = Q ("SELECT v FROM " + (TQ $TargetDb 'cal_schema_meta') + " WHERE k='db_structure_version';") "db_structure_version"
  if($actVersion -ne $expVersion){ Die "cal_schema_meta.db_structure_version 이 [$actVersion] 입니다(schema-calendar.sql 기대 [$expVersion])." }
  Ok "표 $tblCount 개, db_structure_version $actVersion"

  # ==========================================================================
  #  [3/5] 데이터 — 사용자 3표는 회사 시드 · 과제 4표는 원본에서 복사(id/uid 보존)
  # ==========================================================================
  Step 3 "데이터 (회사 시드 → 사용자 3표 · $SourceDb → 과제 4표)"

  # --- (a) 사용자 3표 = 회사 시드 --------------------------------------------
  # 원본의 사용자 표는 옮기지 않는다(머리말): 번호(org_id · user_id)는 02 · 03 이 명시 배정한 것이 정본이고,
  # 보고 사이트 명부 = 폐쇄망 명부다. 순서: 02(직급·조직 — FK 부모) → 03(사람) → 04(권한 — 03 의 사람에게 UPDATE).
  # 세 파일은 DATABASE() 로 표를 찾으므로 대상 DB 를 선택한 채 원본 파일 그대로 돌린다(apply.ps1 과 같은 방식).
  # 시각: 시드 행의 created_at/updated_at 은 CURRENT_TIMESTAMP 다 — .cnf 의 [mysql] init-command 가 세션을 UTC 로 연다.
  $seedHint = " ★ 회사 시드에서 멈췄습니다 — '$TargetDb' 는 사용자 표가 비었거나 반쯤 찬 채로 남습니다(원본 '$SourceDb' 는 그대로). 위 출력과 시드 파일을 확인한 뒤 다시 실행하세요(다음 실행이 '$TargetDb' 를 백업 후 지우고 다시 만듭니다)."
  ApplySqlFile $seedOrgFile   $TargetDb "02-seed-org.sql (직급·조직)" $seedHint
  ApplySqlFile $seedUsersFile $TargetDb "03-seed-users.sql (사용자)" $seedHint
  ApplySqlFile $permsFile     $TargetDb "$permsName (권한)" $seedHint

  # app_user.sort_order 백필 — 03 은 sort_order 를 적지 않아 사람이 전원 NULL 로 들어온다(04 도 건드리지 않는다).
  # 옛 migrate-2026-09-10-user-sort-order.sql 2단계와 같은 순서식(그 파일은 2026-10-15 에 지웠다. 표 이름만 대상 DB 로 한정):
  #   · 순서 = 직급 서열(title_code.sort_order, 없으면 맨 뒤) → 이름 → user_id, 10 간격.
  #   · 다중 표 UPDATE 에는 ORDER BY 를 못 쓰므로 ROW_NUMBER() 창 함수로 번호를 만든다(그 파일의 ★).
  #   · u.updated_at = u.updated_at — 명시 대입으로 ON UPDATE 를 막는다(번호 매기기로 갱신 시각을 바꾸지 않는다).
  #   · 04 뒤 · 과제 복사 앞 — 사람이 다 들어온 뒤 한 번에 매긴다.
  $sortNullBefore = [long](Q ("SELECT COUNT(*) FROM " + (TQ $TargetDb 'app_user') + " WHERE sort_order IS NULL;") "app_user.sort_order NULL 수(백필 전)")
  $sortFilled = 0
  if($sortNullBefore -gt 0){
    $sortSql = "UPDATE " + (TQ $TargetDb 'app_user') + " u JOIN (SELECT u2.user_id, " +
               "ROW_NUMBER() OVER (ORDER BY (t.sort_order IS NULL), t.sort_order, u2.name, u2.user_id) * 10 AS n " +
               "FROM " + (TQ $TargetDb 'app_user') + " u2 LEFT JOIN " + (TQ $TargetDb 'title_code') + " t ON t.title_id = u2.title_id" +
               ") r ON r.user_id = u.user_id SET u.sort_order = r.n, u.updated_at = u.updated_at; SELECT ROW_COUNT();"
    $sortFilled = [long](Q $sortSql "app_user.sort_order 백필")
  }
  $sortNull = [long](Q ("SELECT COUNT(*) FROM " + (TQ $TargetDb 'app_user') + " WHERE sort_order IS NULL;") "app_user.sort_order NULL 수")
  if($sortNull -ne 0){ Die "app_user.sort_order 백필 뒤에도 NULL 이 $sortNull 행 남았습니다." }
  Ok "app_user.sort_order 백필: $sortFilled 행 채움 (NULL 0 · 직급 서열 → 이름 → user_id 순 ×10)"

  # 시딩 검사 — apply.ps1 게이트와 같은 항목. 번호가 PK 라 NULL·중복은 구조상 나올 수 없지만, 시드 파일이나
  # DDL 이 바뀌어도 여기서 드러나게 직접 센다.
  foreach($t in $SEED_AUTOINC_KEYS.Keys){
    $k = $SEED_AUTOINC_KEYS[$t]
    $nNull = [long](Q ("SELECT COUNT(*) FROM " + (TQ $TargetDb $t) + " WHERE " + (BQ $k) + " IS NULL;") "$t.$k NULL 수")
    $nDup  = [long](Q ("SELECT COUNT(*) FROM (SELECT " + (BQ $k) + " FROM " + (TQ $TargetDb $t) + " WHERE " + (BQ $k) + " IS NOT NULL GROUP BY " + (BQ $k) + " HAVING COUNT(*) > 1) d;") "$t.$k 중복 수")
    if($nNull -ne 0 -or $nDup -ne 0){ Die "$t.$k 가 NULL $nNull 행 · 중복 $nDup 개입니다(회사 시드) — 02-seed-org.sql / 03-seed-users.sql 의 번호 배정을 확인하세요." }
  }
  $seedCounts = [ordered]@{}
  foreach($t in $SEED_TABLES){
    $seedCounts[$t] = [long](Q ("SELECT COUNT(*) FROM " + (TQ $TargetDb $t) + ";") "시드 $t 행 수")
    if($seedCounts[$t] -lt 1){ Die "회사 시드 뒤에도 $t 가 비어 있습니다 — 02-seed-org.sql / 03-seed-users.sql 이 아무것도 넣지 않았습니다." }
  }
  foreach($t in $SEED_AUTOINC_KEYS.Keys){ CheckAutoInc $t $SEED_AUTOINC_KEYS[$t] }
  Ok ("조직 {0} · 직급 {1} · 사용자 {2} (회사 시드 · org_id/user_id NULL 0 · 중복 0 · AUTO_INCREMENT > MAX)" -f $seedCounts['org_unit'], $seedCounts['title_code'], $seedCounts['app_user'])

  # 명부 대조(정보용 — 이 블록은 절대 멈추지 않는다: Die 도, 실패하면 죽는 Q/QRows 도 쓰지 않는다).
  # 원본 app_user 에 login_id 가 있으면(0.16 옛 모양에도 있다) 시드 명부와 login_id 로 맞대 본다. 보고 사이트 명부 =
  # 폐쇄망 명부라 둘 다 0 이 정상이지만, 달라도 이 DB 의 명부는 시드가 정본이다 — 사람이 보고 판단하게 알리기만 한다.
  # 비교는 바이너리(CONVERT … USING utf8mb4 COLLATE utf8mb4_bin, 양쪽 같은 식): 두 DB 의 문자셋·콜레이션이 달라도
  # 'Illegal mix of collations' 로 실패하지 않고, 대소문자만 다른 ID 도 다르다고 본다(로그인 ID 는 글자 그대로 쓰인다).
  $xSrcOnly  = $null
  $xSeedOnly = $null
  if($srcLoginCheck){
    $srcKey = "CONVERT(s.login_id USING utf8mb4) COLLATE utf8mb4_bin"
    $tgtKey = "CONVERT(t.login_id USING utf8mb4) COLLATE utf8mb4_bin"
    $rSrc  = QRowsTry ("SELECT s.login_id FROM " + (TQ $SourceDb 'app_user') + " s WHERE s.login_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM " + (TQ $TargetDb 'app_user') + " t WHERE $tgtKey = $srcKey) ORDER BY s.login_id;")
    $rSeed = QRowsTry ("SELECT t.login_id FROM " + (TQ $TargetDb 'app_user') + " t WHERE t.login_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM " + (TQ $SourceDb 'app_user') + " s WHERE $srcKey = $tgtKey) ORDER BY t.login_id;")
    if(-not $rSrc.ok -or -not $rSeed.ok){
      Warn "명부 대조 질의가 실패했습니다(위 mysql 오류) — 대조만 건너뛰고 구축은 계속합니다."
    } else {
      $xSrcOnly  = @($rSrc.rows).Count
      $xSeedOnly = @($rSeed.rows).Count
      if($xSrcOnly -eq 0 -and $xSeedOnly -eq 0){
        Ok "명부 대조: 원본 login_id 와 시드 명부가 같습니다 (원본에만 0 · 시드에만 0)"
      } else {
        Warn "명부 대조: login_id 가 원본에만 $xSrcOnly 명 · 시드에만 $xSeedOnly 명 — 이 DB 의 명부는 시드가 정본이라 멈추지 않습니다. 뜻밖의 차이면 회사 시드(03-seed-users.sql)부터 확인하세요."
        if($xSrcOnly -gt 0){  Warn ("  원본에만 (앞 10개): " + ((@($rSrc.rows)  | Select-Object -First 10) -join ', ')) }
        if($xSeedOnly -gt 0){ Warn ("  시드에만 (앞 10개): " + ((@($rSeed.rows) | Select-Object -First 10) -join ', ')) }
      }
    }
  } else {
    Info "명부 대조: 원본에 app_user.login_id 가 없어 건너뜁니다."
  }

  # --- (b) 과제 4표 = 원본에서 복사 ------------------------------------------
  $copy = New-Object System.Collections.Generic.List[string]
  $copy.Add('SET NAMES utf8mb4;')
  # FK 검사를 끄는 이유: 0.16 원본은 참조가 어긋난 행(없는 고객·코드를 가리키는 과제)을 가질 수 있는데, FK 를
  # 켠 채 넣으면 어느 행인지 모를 ERROR 1452 로 죽는다. 끄고 넣은 뒤 아래 '고아 행 0' 검사가 관계·개수를 짚어
  # 알린다 — 그래서 그 검사가 정합성의 진짜 관문이다.
  $copy.Add('SET FOREIGN_KEY_CHECKS=0;')
  # schema-structure.sql 이 section_code/status_code 에 기본 코드 행을 시딩한다. 그대로 두면 원본 행과
  # PK 가 겹쳐 INSERT 가 ERROR 1062 로 죽고, 남겨 두면 원본에 없는 행이 섞인다. 원본이 정본이므로 비운다.
  # ★ 비우는 표는 $COPY_ORDER(과제 4표)뿐이다 — 방금 (a) 에서 채운 사용자 3표는 절대 지우지 않는다.
  foreach($t in $COPY_ORDER){ $copy.Add('DELETE FROM ' + (TQ $TargetDb $t) + ';') }
  $colReport = New-Object System.Collections.Generic.List[string]
  foreach($t in $COPY_ORDER){
    $colSql = "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='{0}' AND TABLE_NAME='$t' AND EXTRA NOT LIKE '%VIRTUAL GENERATED%' AND EXTRA NOT LIKE '%STORED GENERATED%' ORDER BY ORDINAL_POSITION;"
    $tgtCols = @(QRows ($colSql -f $TargetDb) "대상 $t 컬럼")
    $srcCols = @(QRows ($colSql -f $SourceDb) "원본 $t 컬럼")
    $cols    = @($tgtCols | Where-Object { $srcCols -contains $_ })      # 대상의 ORDINAL_POSITION 순서를 따른다
    $srcOnly = @($srcCols | Where-Object { $tgtCols -notcontains $_ })
    $tgtOnly = @($tgtCols | Where-Object { $srcCols -notcontains $_ })
    # 2026-10-15 번호 키 열은 원본에서 옮기지 않는다(아래에서 매기거나 이름을 번호로 바꿔 넣는다).
    #   $genCols = 대상에서 이 스크립트가 채우는 번호 열, $convSrc = 번호로 바뀌어 들어가는 원본의 이름 열
    $genCols = @()
    $convSrc = @()
    if($CODE_ID_COLS.Contains($t)){ $genCols = @($CODE_ID_COLS[$t]) }
    if($t -eq 'project'){ $genCols = @($PROJECT_REFS | ForEach-Object { $_.dst }); $convSrc = @($PROJECT_REFS | ForEach-Object { $_.src }) }
    $cols    = @($cols    | Where-Object { $genCols -notcontains $_ })
    $srcOnly = @($srcOnly | Where-Object { $convSrc -notcontains $_ })
    $tgtOnly = @($tgtOnly | Where-Object { $genCols -notcontains $_ })
    foreach($c in $cols){ if($c -notmatch '^[A-Za-z0-9_]+$'){ Die "$t 의 컬럼 이름이 식별자 형식이 아닙니다: [$c]" } }
    foreach($k in $KEY_COLS[$t]){ if($cols -notcontains $k){ Die "$t 의 정체성 컬럼 '$k' 가 복사 목록에 없습니다." } }
    $sel = @()
    $shifted = @()
    $nulled = @()
    foreach($c in $cols){
      if($doShift -and ($SHIFT_TABLES -contains $t) -and ($SHIFT_COLS -contains $c)){
        $sel += ('DATE_SUB(s.' + (BQ $c) + ', INTERVAL 9 HOUR)')
        $shifted += $c
      } elseif($NULL_TO_EMPTY.Contains($t) -and ($NULL_TO_EMPTY[$t] -contains $c)){
        # 07-24 정규화를 복사 SELECT 에서 한다(원본은 읽기만 하므로 UPDATE 할 수 없다). 몇 행이었는지는 보고서에 남긴다.
        $sel += ('IFNULL(s.' + (BQ $c) + ", '')")
        $nNullSrc = [long](Q ("SELECT COUNT(*) FROM " + (TQ $SourceDb $t) + " WHERE " + (BQ $c) + " IS NULL;") "원본 $t.$c NULL 수")
        $nulled += ("$c " + $nNullSrc + "행")
      } else {
        $sel += ('s.' + (BQ $c))
      }
    }
    # 번호 열. 코드표: 고정 번호 지도에 있는 이름(BINARY)은 그 번호, 나머지는 지도의 MAX+1 부터 이름순.
    #          project: 원본 이름을 방금 넣은 대상 코드표에서 찾아 번호로(NOT NULL 열은 JOIN, status 는 LEFT JOIN).
    #   이름 비교는 대상 콜레이션(utf8mb4_0900_ai_ci)으로 한다. 원본 표의 문자셋이 달라도 CONVERT 로 맞춘다.
    $insCols = @($cols)
    $from = ''
    $genNote = ''
    if($CODE_ID_COLS.Contains($t)){
      $nameKey = 'CONVERT(s.' + (BQ 'name') + ' USING utf8mb4)'
      $ord = 'ORDER BY ' + $nameKey + ' COLLATE utf8mb4_0900_ai_ci, CAST(' + $nameKey + ' AS BINARY)'
      $map = $FIXED_IDS[$t]
      if($map.Count -gt 0){
        $base = [int](($map.Keys | ForEach-Object { [int]$_ } | Measure-Object -Maximum).Maximum)
        $mapSql = (@($map.Keys | ForEach-Object { 'SELECT ' + $_ + ' AS id, ''' + (SqlStr $map[$_]) + ''' AS nm' }) -join ' UNION ALL ')
        $sel += ('CASE WHEN m.id IS NOT NULL THEN m.id ELSE ' + $base + ' + ROW_NUMBER() OVER (PARTITION BY (m.id IS NULL) ' + $ord + ') END')
        $from = ' LEFT JOIN (' + $mapSql + ') m ON CAST(' + $nameKey + ' AS BINARY) = CAST(m.nm AS BINARY)'
        $genNote = $CODE_ID_COLS[$t] + '(고정 ' + $map.Count + '개, 나머지 ' + ($base + 1) + ' 부터 이름순)'
      } else {
        $sel += ('ROW_NUMBER() OVER (' + $ord + ')')
        $genNote = $CODE_ID_COLS[$t] + '(1 부터 이름순)'
      }
      $insCols += $CODE_ID_COLS[$t]
    } elseif($t -eq 'project'){
      $i = 0
      foreach($r in $PROJECT_REFS){
        $a = 'r' + $i
        $i++
        $kind = ' JOIN '
        if($r.nullable){ $kind = ' LEFT JOIN ' }
        $from += $kind + (TQ $TargetDb $r.parent) + ' ' + $a + ' ON ' + $a + '.' + (BQ 'name') + ' = CONVERT(s.' + (BQ $r.src) + ' USING utf8mb4) COLLATE utf8mb4_0900_ai_ci'
        $sel += ($a + '.' + (BQ $r.pid))
        $insCols += $r.dst
      }
      $genNote = (@($PROJECT_REFS | ForEach-Object { $_.src + '->' + $_.dst }) -join ',')
    }
    $copy.Add('INSERT INTO ' + (TQ $TargetDb $t) + ' (' + (($insCols | ForEach-Object { BQ $_ }) -join ',') + ') SELECT ' + ($sel -join ',') + ' FROM ' + (TQ $SourceDb $t) + ' s' + $from + ';')
    $line = "  {0,-13} 컬럼 {1,2}개" -f $t, $cols.Count
    if($shifted.Count -gt 0){ $line += " · -9h: " + ($shifted -join ',') }
    if($nulled.Count -gt 0){ $line += " · NULL→'': " + ($nulled -join ',') }
    if($tgtOnly.Count -gt 0){ $line += " · 원본에 없음(대상 기본값): " + ($tgtOnly -join ',') }
    if($srcOnly.Count -gt 0){ $line += " · ★ 원본에만 있어 복사 안 함: " + ($srcOnly -join ',') }
    if($genNote){ $line += ", 번호: " + $genNote }
    $colReport.Add($line)
  }
  $copy.Add('SET FOREIGN_KEY_CHECKS=1;')
  foreach($l in $colReport){ Log $l }

  $copyFile = NewTemp "setup_copy_" ".sql"
  [IO.File]::WriteAllText($copyFile, (($copy.ToArray()) -join "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
  ApplySqlFile $copyFile "" "과제 4표 복사(한 세션)"

  # --- 2026-10-15 번호 키 복사 검증(CODE-TABLE-IDS §5) ---
  #   원본과 대상의 키 모양이 다르므로 행 수와 고아 0 만으로는 '같은 이름을 가리키는가' 를 모른다.
  #   (a) 코드표 셋: 원본의 모든 이름이 대상에 글자 그대로(BINARY) 있다.
  #   (b) 고정 번호: 지도에 있는 이름은 지도의 번호를 받았다(없는 이름은 경고만 한다. 그 동작이 걸릴 행이 없다).
  #   (c) project 참조 셋: 대상의 번호로 되살린 이름 = 원본의 이름(BINARY, NULL 대칭). 행이 빠져도 여기서 잡힌다.
  #   ※ 한글 이름은 mysql 명령줄 인자로 넘기지 않는다(콘솔 코드페이지에서 깨진다). 16진 바이트로 비교한다.
  $idBad = @()
  foreach($t in $CODE_ID_COLS.Keys){
    $n = [long](Q ("SELECT COUNT(*) FROM " + (TQ $SourceDb $t) + " s WHERE NOT EXISTS (SELECT 1 FROM " + (TQ $TargetDb $t) + " t WHERE CAST(t.``name`` AS BINARY) = CAST(CONVERT(s.``name`` USING utf8mb4) AS BINARY));") "$t 이름 복원")
    if($n -ne 0){ $idBad += "$t 의 원본 이름이 대상에 글자 그대로 없음 $n 행" }
    foreach($id in $FIXED_IDS[$t].Keys){
      $hex = ([BitConverter]::ToString([Text.Encoding]::UTF8.GetBytes($FIXED_IDS[$t][$id]))).Replace('-', '')
      $got = Q ("SELECT IFNULL(MIN(" + (BQ $CODE_ID_COLS[$t]) + "), '') FROM " + (TQ $TargetDb $t) + " WHERE CAST(``name`` AS BINARY) = X'" + $hex + "';") "$t 고정 번호 $id"
      if("$got" -eq ""){
        if($PROTECTED_IDS.Contains($t) -and $PROTECTED_IDS[$t] -eq $id){
          Die "$t 에 고정 번호 $id 행이 없습니다. 원본 '$SourceDb' 의 $t 에 이름 '$($FIXED_IDS[$t][$id])' 이 없어서입니다(라벨을 바꿨다면 그 행은 MAX+1 번호를 받았습니다). 이 번호는 앱 동작에 묶여 있습니다. 원본에서 그 라벨을 '$($FIXED_IDS[$t][$id])' 으로 되돌린 뒤 다시 실행하세요. 이름은 구축 뒤 관리 화면에서 다시 바꿀 수 있습니다."
        }
        Warn "$t 고정 번호 $id 의 이름이 원본에 없습니다. 이 번호는 색만 묶여 있어 멈추지 않습니다."
      }
      elseif("$got" -ne "$id"){ $idBad += "$t 고정 번호 $id 의 이름이 번호 $got 을 받음" }
    }
  }
  foreach($r in $PROJECT_REFS){
    $n = [long](Q ("SELECT COUNT(*) FROM " + (TQ $SourceDb 'project') + " s LEFT JOIN " + (TQ $TargetDb 'project') + " p ON p.id = s.id LEFT JOIN " + (TQ $TargetDb $r.parent) + " c ON c." + (BQ $r.pid) + " = p." + (BQ $r.dst) +
                   " WHERE p.id IS NULL OR NOT (CAST(CONVERT(s." + (BQ $r.src) + " USING utf8mb4) AS BINARY) <=> CAST(c.``name`` AS BINARY));") "project.$($r.src) 번호 복원")
    if($n -ne 0){ $idBad += "project.$($r.src) 를 번호로 되살린 이름이 원본과 다른 행 $n 개" }
  }
  if($idBad.Count -gt 0){ Die ("번호 키 복사 검증 실패: " + ($idBad -join '; ') + ". 대소문자만 다른 참조처럼 원본의 이름 표기가 어긋난 곳을 고친 뒤 다시 실행하세요.") }
  Ok "번호 키 복사 검증: 이름 복원 BINARY 일치(코드표 3, project 참조 3), 고정 번호 일치"

  # 보호 행(구분 2, 상태 2)은 켜져 있어야 한다. 앱은 이 행의 숨김을 막으므로, 원본에서 숨겨져 왔다면 풀 길이 없다. 여기서 켜고 알린다.
  #   ($pid 는 PowerShell 자동 변수(읽기 전용)라 쓰지 않는다.)
  foreach($t in $PROTECTED_IDS.Keys){
    $protId = $PROTECTED_IDS[$t]
    $protPk = BQ $CODE_ID_COLS[$t]
    $off = [long](Q ("SELECT COUNT(*) FROM " + (TQ $TargetDb $t) + " WHERE " + $protPk + " = " + $protId + " AND is_active = 0;") "$t 보호 행 숨김 여부")
    if($off -gt 0){
      Q ("UPDATE " + (TQ $TargetDb $t) + " SET is_active = 1 WHERE " + $protPk + " = " + $protId + " AND is_active = 0;") "$t 보호 행 켜기" | Out-Null
      Warn "$t 고정 번호 $protId('$($FIXED_IDS[$t][$protId])') 이 원본에서 숨겨져 있어 켰습니다. 앱 동작에 묶인 행이라 숨길 수 없습니다."
    }
    $on = [long](Q ("SELECT COUNT(*) FROM " + (TQ $TargetDb $t) + " WHERE " + $protPk + " = " + $protId + " AND is_active = 1;") "$t 보호 행 확인")
    if($on -ne 1){ Die "$t 고정 번호 $protId 행이 켜져 있지 않습니다(켠 뒤 $on 행)." }
  }
  Ok "보호 행 확인: 구분 $($PROTECTED_IDS['section_code']), 상태 $($PROTECTED_IDS['status_code']) 이 있고 켜져 있음"

  # cal_user_rev — schema-calendar.sql 이 'app_user 전원에게 rev 0 행' 을 시딩하지만, 그 시점의 app_user 는
  # 비어 있었다. 사람이 (a) 회사 시드로 들어왔으므로 같은 시딩을 다시 한다(그 파일 끝 '릴리스 게이트' 가 누락 0 을 요구한다).
  Q ("INSERT IGNORE INTO " + (TQ $TargetDb 'cal_user_rev') + " (user_id, rev) SELECT user_id, 0 FROM " + (TQ $TargetDb 'app_user') + ";") "cal_user_rev 시딩" | Out-Null
  $revMissing = [long](Q ("SELECT COUNT(*) FROM " + (TQ $TargetDb 'app_user') + " u LEFT JOIN " + (TQ $TargetDb 'cal_user_rev') + " r ON r.user_id = u.user_id WHERE r.user_id IS NULL;") "cal_user_rev 누락")
  if($revMissing -ne 0){ Die "cal_user_rev 에 행이 없는 사용자가 $revMissing 명입니다." }
  Ok "cal_user_rev 시딩 (누락 0)"

  # 고아 행 — FK 검사를 껐으므로 여기가 진짜 검사다. 과제 3관계는 원본 데이터를, 사용자 3관계는 회사 시드를 검사한다.
  $orphanTotal = 0
  foreach($oc in $ORPHAN_CHECKS){
    $sql = "SELECT COUNT(*) FROM " + (TQ $TargetDb $oc.child) + " c LEFT JOIN " + (TQ $TargetDb $oc.parent) + " p ON p." + (BQ $oc.pcol) + " = c." + (BQ $oc.col) +
           " WHERE c." + (BQ $oc.col) + " IS NOT NULL AND p." + (BQ $oc.pcol) + " IS NULL;"
    $n = [long](Q $sql "고아 행 $($oc.name)")
    $orphanTotal += $n
    if($n -ne 0){ Log ("  고아 행 {0,-24} {1}" -f $oc.name, $n) 'Red' } else { Log ("  고아 행 {0,-24} 0" -f $oc.name) }
  }
  if($orphanTotal -ne 0){ Die "고아 행이 $orphanTotal 개 있습니다(위 목록). project 관계면 원본 '$SourceDb' 의 참조가, 사용자 관계면 회사 시드(02·03)의 참조가 깨져 있습니다 — 고친 뒤 다시 실행하세요." }
  Ok "고아 행 0 ($($ORPHAN_CHECKS.Count)개 관계)"

  # 행 수 대조 — 복사한 과제 4표만(사용자 표는 원본과 비교하지 않는다 — 시드가 정본이다).
  $tgtCounts = [ordered]@{}
  $countBad = @()
  Log ("  {0,-13} {1,8} {2,8}" -f "표", "원본", "대상")
  foreach($t in $COPY_ORDER){
    $tgtCounts[$t] = [long](Q ("SELECT COUNT(*) FROM " + (TQ $TargetDb $t) + ";") "대상 $t 행 수")
    $mark = "OK"
    if($tgtCounts[$t] -ne $srcCounts[$t]){ $mark = "불일치"; $countBad += $t }
    Log ("  {0,-13} {1,8} {2,8}  {3}" -f $t, $srcCounts[$t], $tgtCounts[$t], $mark)
  }
  if($countBad.Count -gt 0){ Die "행 수가 원본과 다릅니다: $($countBad -join ', ')" }
  Ok "행 수 4표 일치 (원본 = 대상)"

  foreach($t in $AUTOINC_KEYS.Keys){ CheckAutoInc $t $AUTOINC_KEYS[$t] }
  Ok "AUTO_INCREMENT 확인 (코드표 3 + project. org_unit, app_user 는 시딩 직후에 확인)"

  # ==========================================================================
  #  [4/5] 권한
  # ==========================================================================
  Step 4 "앱 계정 권한"
  # (a) create-app-user.sql — 계정이 이미 있으면 CREATE USER IF NOT EXISTS 는 아무것도 하지 않는다.
  #     그래서 -AppPassword 가 없을 때 남는 'CHANGE_ME_ON_DEPLOY' 자리표는 무해하다(쓰이지 않는다).
  #     계정이 있는데 -AppPassword 를 준 경우에도 비밀번호는 바뀌지 않는다(같은 이유).
  $appUserSql = SubstSchema $appUserText "create-app-user.sql"
  if($AppPassword){
    if(-not $appUserSql.Contains('CHANGE_ME_ON_DEPLOY')){ Die "create-app-user.sql 에 비밀번호 자리표 CHANGE_ME_ON_DEPLOY 가 없습니다 — -AppPassword 를 넣을 자리가 없습니다." }
    $appUserSql = $appUserSql.Replace('CHANGE_ME_ON_DEPLOY', (SqlStr $AppPassword))   # 문자 그대로 치환($ 등 해석 없음)
    if($appExists){ Warn "계정 '$AppUser'@'%' 이 이미 있어 -AppPassword 는 쓰이지 않습니다(비밀번호는 바뀌지 않습니다)." }
  }
  $appUserTmp = NewTemp "setup_appuser_" ".sql"
  [IO.File]::WriteAllText($appUserTmp, $appUserSql, (New-Object System.Text.UTF8Encoding($false)))
  # (b) grants-calendar.sql — 같은 스키마 치환.
  $calGrantsSql = SubstSchema $calGrantsText "grants-calendar.sql"
  $calGrantsTmp = NewTemp "setup_calgrants_" ".sql"
  [IO.File]::WriteAllText($calGrantsTmp, $calGrantsSql, (New-Object System.Text.UTF8Encoding($false)))
  # (c) 05-grants.sql — 치환하지 않는다. 스키마를 DATABASE() 로 잡으므로 대상 DB 를 선택한 채 원본 파일을 돌린다.
  ApplySqlFile $appUserTmp "" "create-app-user.sql (스키마 → $TargetDb)"
  ApplySqlFile $calGrantsTmp "" "grants-calendar.sql (스키마 → $TargetDb)"
  ApplySqlFile $companyGrantsFile $TargetDb "05-grants.sql (DATABASE() = $TargetDb)"

  # 기대 표: 세 파일이 권한을 주는 표 전부. SHOW GRANTS 에 `대상`.`표` 로 하나씩 있어야 한다.
  $expGrantTables = @()
  foreach($txt in @($appUserSql, $calGrantsSql)){
    foreach($m in [regex]::Matches($txt, '(?im)^\s*GRANT\s+[^;]*?\bON\s+' + $TargetDb + '\.([A-Za-z0-9_]+)')){
      if($expGrantTables -notcontains $m.Groups[1].Value){ $expGrantTables += $m.Groups[1].Value }
    }
  }
  foreach($m in [regex]::Matches($companyGrantsText, '`\.([A-Za-z0-9_]+)\s+TO\s+''''')){
    if($expGrantTables -notcontains $m.Groups[1].Value){ $expGrantTables += $m.Groups[1].Value }
  }
  if($expGrantTables.Count -lt 1){ Die "권한 파일 세 개에서 GRANT 대상 표를 하나도 읽지 못했습니다 — 파일 형식이 바뀌었습니다." }
  $grantLines = @(QRows ("SHOW GRANTS FOR '" + $AppUser + "'@'%';") "SHOW GRANTS")
  $tgtGrantLines = @($grantLines | Where-Object { $_.Contains((BQ $TargetDb) + '.') })
  foreach($g in $tgtGrantLines){ Log "  $g" }
  if($tgtGrantLines.Count -lt 1){ Die "SHOW GRANTS FOR '$AppUser'@'%' 에 '$TargetDb' 권한이 한 줄도 없습니다." }
  $grantMiss = @()
  foreach($gt in $expGrantTables){
    $needle = (TQ $TargetDb $gt) + ' '
    $hit = @($tgtGrantLines | Where-Object { $_.Contains($needle) })
    if($hit.Count -lt 1){ $grantMiss += $gt }
  }
  if($grantMiss.Count -gt 0){ Die "권한이 붙지 않은 표가 있습니다: $($grantMiss -join ', ')" }
  Ok "권한 확인: '$TargetDb' 표 $($expGrantTables.Count)개 (SHOW GRANTS $($tgtGrantLines.Count)줄)"

  # ==========================================================================
  #  [5/5] 보고서
  # ==========================================================================
  Step 5 "보고서"
  Log "  원본(읽기만)   : $SourceDb"
  Log "  복사           : $SourceDb → $TargetDb 과제 4표만 ($($COPY_ORDER -join ','))"
  Log ("  사용자 표      : 회사 시드(02·03·04) — 조직 {0} · 직급 {1} · 사용자 {2} (원본에서 옮기지 않음 · 보고 사이트 명부와 동일)" -f $seedCounts['org_unit'], $seedCounts['title_code'], $seedCounts['app_user'])
  if($null -ne $xSrcOnly){ Log "  명부 대조      : login_id 원본에만 $xSrcOnly · 시드에만 $xSeedOnly (정보용)" }
  elseif($srcLoginCheck) { Log "  명부 대조      : 질의 실패로 건너뜀(위 경고)" }
  else                   { Log "  명부 대조      : 안 함(원본에 app_user.login_id 없음)" }
  Log "  대상 DB        : $TargetDb"
  Log "  구조 번호      : $actVersion"
  Log "  표 수          : $tblCount"
  foreach($t in $COPY_ORDER){ Log ("  행 수 {0,-13}: {1}" -f $t, $tgtCounts[$t]) }
  Log "  고아 행        : 0 ($($ORPHAN_CHECKS.Count)개 관계)"
  if($doShift){ Log "  시각 이동      : $($SHIFT_TABLES -join ',') 의 $($SHIFT_COLS -join '/') -9시간" }
  else        { Log "  시각 이동      : 안 함(-NoShift)" }
  Log "  sort_order     : app_user $sortFilled 행 백필(직급 서열, 이름, user_id 순, NULL 0)"
  Log "  번호 키        : 코드표 3 + project 참조 3, 이름 복원 BINARY 일치(고정 번호 = schema-structure.sql 시드)"
  Log "  권한           : OK ('$AppUser'@'%' · 표 $($expGrantTables.Count)개)"
  Log "  원본 백업      : $srcDump"
  if($tgtDump){ Log "  삭제 전 대상   : $tgtDump" }
  if($targetExists){ Log "  삭제 전 캘린더 : $calCountText (지운 대상에 있던 행 — 삭제 전 대상 백업에만 남음)" }
  if($legacyStageDropped){ Log "  옛 판 작업장   : '$legacyStageDb' 삭제" }
  Log ""
  Log "  다음 단계: widget/DeployConfig.cs → DbName = `"$TargetDb`" 로 바꾼 뒤 다시 빌드하세요." 'Cyan'
  Log "            (원본 '$SourceDb' 는 그대로라 0.16 클라이언트는 계속 그쪽을 씁니다.)" 'Cyan'
  Finish $EXIT_OK "완료: '$TargetDb' 구축·검증 통과(종료코드 $EXIT_OK)." 'Green'
} finally {
  # exit(Finish/Die) 로 끝나도 finally 는 돈다. Cleanup 은 두 번 불려도 안전하다.
  Cleanup
}
