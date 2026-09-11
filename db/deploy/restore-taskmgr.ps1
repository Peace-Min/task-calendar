<#
  restore-taskmgr.ps1 — taskmgr 백업 덤프를 되살리고 '정말 되살아났는지' 를 대조한다.

  backup-taskmgr.ps1 의 짝이다. 저쪽은 '제대로 떴는가' 를 보고, 이쪽은 '되살아나는가' 를 본다.
  보통은 restore-taskmgr.cmd 로 실행한다.

  ★ 이 스크립트의 존재 이유 — 검증되지 않은 백업은 백업이 아니다.
    복구 절차는 지금까지 D:\taskmgr-backup\복구방법.txt 라는 '문서' 로만 있었다. 문서는
    실행되지 않는다. 특히 그 파일 4)번(계정·권한은 덤프에 들어 있지 않다)은 **건너뛰어도
    복구가 성공한 것처럼 보인다** — 표도 데이터도 전부 제자리에 있기 때문이다. 사고는 그 다음,
    위젯이 첫 조회를 던지는 순간 ERROR 1142 로 드러난다. 그래서 이 스크립트의 검증은
    '표와 행이 있는가' 에서 멈추지 않고 **앱 계정으로 실제 부팅 조회를 던져 본다**(9-7).

  하는 일(순서):
    1) ★ 라이브 덮어쓰기 가드 — -TargetDb 가 -LiveDb 와 같으면 그 자리에서 거부(코드 6).
       -OverwriteLive 스위치만으로는 부족하게 만들었다: 사람이 DB 이름을 직접 타이핑해
       글자까지 일치해야 진행하고, 비대화형(stdin 리다이렉트)이면 무조건 거부한다.
       이 가드는 스크립트 안에 있다 — 호출자의 조심성에 기대면 언젠가 반드시 진다.
    2) mysql.exe / mysqldump.exe 찾기 (backup-taskmgr.ps1 과 같은 방식: -BaseDir → 서비스 binPath 추론)
    3) 자격 증명 — .cnf → 환경변수 → (상한 있는) stdin → 대화형 질문 순서로 구한다.
       명령줄로 비번을 받지 않는다(아래 ⚠️ 두 개)
    4) 덤프 고르기 — -DumpPath 가 없으면 -BackupDir 의 최신 *.sql (.partial 은 제외).
       고른 파일의 머리를 읽어 CREATE DATABASE / USE 문이 있는지 확인해 화면에 찍는다(아래 ⚠️)
    5) 복구 전 안전망 — -TargetDb 가 이미 있으면 먼저 통째로 떠서
       <BackupDir>\pre-restore-<db>-<타임스탬프>.sql 로 남긴다. 못 남기면 실패(코드 2).
       그 덤프가 성공한 뒤에야 대상을 통째로 비우고 다시 만든다(-KeepExisting 이면 비우지 않는다).
       왜 비우는가는 5단계 ★ 절에 실측(ERROR 3734)과 함께 적어 두었다.
    6) CREATE DATABASE IF NOT EXISTS <TargetDb> — charset/collation 은 하드코딩하지 않고
       라이브 DB 의 실제 값(information_schema.SCHEMATA)을 읽어 그대로 맞춘다
    7) mysql --default-character-set=utf8mb4 <TargetDb> < <덤프>   (대상 DB 인자를 반드시 준다)
    8) -Grants 면 create-app-user.sql + grants-calendar.sql 적용(두 파일은 DB 이름을 글자로
       박아 두었다 — 대상이 다르면 임시 사본에서 이름만 바꿔 돌리고 REVOKE 문을 찍는다).
       ★ 세 번째 정본 taskmgr-company-data\05-grants.sql(app_user 의 SELECT/INSERT/UPDATE/DELETE)은
       **이 저장소에 없다**(비공개 형제 저장소). 형제 폴더에 있으면 함께 적용하고, 없으면 경고를
       찍고 넘어간다 — 그 파일 없이 끝낸 복구본에서는 직원 등록·수정·퇴사와 휴지통의 인력
       영구 삭제가 전부 ERROR 1142 로 죽는다(-UserGrantsPath 로 직접 지정할 수 있다)
    9) ★ 검증 — 표/트리거/뷰/루틴의 **이름 집합** · 표별 행 수 · 덤프 마감 표시 ·
       그리고 앱 계정 스모크 조회. 하나라도 어긋나면 실패(코드 1)
   10) -DropTarget 이면 뒷정리 — DROP DATABASE + 남은 표 단위 권한 REVOKE(아래 ⚠️)

  ┌ 종료코드 (restore-taskmgr.cmd 의 표와 반드시 일치) ──────────────────────────────┐
  │ 0  성공 — 복구했고 검증을 전부 통과했다. (-WhatIf / -DropTarget 성공도 0)         │
  │ 1  실패 — 복구 실행 실패 또는 검증 불일치. 대상 DB 는 원인 확인용으로 남긴다.     │
  │ 2  설정 문제 — 덤프가 없거나 못 읽는다 / 복구 전 안전 덤프를 못 남겼다 / .cnf 문제 │
  │ 3  접속·권한 문제 — DB 에 못 붙거나 관리 계정에 CREATE·GRANT 권한이 없다.         │
  │ 4  도구 없음 — mysql.exe 또는 mysqldump.exe 를 못 찾았다.                          │
  │ 5  관리자 권한 필요 — backup-taskmgr 와 뜻을 맞춘 결번(이 스크립트는 내지 않는다). │
  │ 6  거부 — 라이브 덮어쓰기 가드에 걸렸다. 아무것도 바꾸지 않았다.                   │
  │ 7  검증 못 함 — 라이브 DB 에 못 붙어 대조 기준이 없다. ★ 통과가 아니다.           │
  └───────────────────────────────────────────────────────────────────────────────────┘
  무인 호출자는 0 만 성공으로 셀 것. 1 과 2·3·4 를 나눈 뜻은 backup-taskmgr.ps1 과 같다:
  1 은 '복구본이 반쪽이다', 2·3·4 는 '복구를 시작조차 못했다'.
  ★ -WhatIf 가 0 으로 끝나는 것은 **인자가 성립할 때뿐**이다. 인자 검증(경로 오타 등)은 계획을 찍기
    전에 코드 2 로 끝낸다 — '아무것도 바꾸지 않는다' 는 그대로지만 '언제나 0' 은 아니다.
    그래야 같은 오타가 실제 실행에서 DB 를 갈아엎은 뒤에 터지지 않는다(파괴적 단계보다 앞에서 거른다).
  ★ 6 과 7 은 이 스크립트에만 있다. 새 뜻이라 새 값을 준다 — 기존 값의 뜻을 바꾸지 않는다
    (init-calendar.ps1 이 3·5 를 결번으로 남긴 것과 같은 이유. 종료코드는 호출자와의 계약이다).
  ★★ 7 이 왜 0 이 아닌가 — 판정 불가는 통과가 아니다. 라이브가 죽어 있는 진짜 재해 상황에서는
    대조할 기준 자체가 없다. 그때 0 을 돌려주면 '검증했다' 와 '검증할 수 없었다' 가 호출자에게
    똑같이 보인다. 이 저장소가 tests/harness.mjs 의 skip 을 exit 2 로 따로 세는 것과 같은 원칙이다.

  --- EXITCODES (ASCII; this block must match line-for-line in .ps1 and .cmd) ---
    0 ok - restored and every verification passed (-WhatIf / -DropTarget success is 0 too)
    1 restore or verification failed - the target DB is left in place for diagnosis
    2 config problem - dump missing/unreadable, pre-restore safety dump failed, .cnf problem
    3 connection or privilege problem - cannot connect, or the admin account cannot CREATE/GRANT
    4 mysql.exe / mysqldump.exe not found
    5 administrator rights required - reserved, same meaning as backup-taskmgr (never returned here)
    6 refused - live-overwrite guard tripped; nothing was changed
    7 cannot verify - no live baseline to compare against; this is NOT a pass
  --- END EXITCODES ---

  ⚠️ 비밀번호를 명령줄 인자로 받지 않는 이유(backup-taskmgr.ps1 과 같다):
     Windows 는 같은 사용자 권한이면 다른 프로세스의 명령줄을 그대로 읽을 수 있다
     (Get-CimInstance Win32_Process | Select CommandLine — 실측으로 값이 보였다).
     그래서 mysql 에 비번을 붙여 넘기는 형태를 이 파일 어디에서도 쓰지 않는다.
     자격은 --defaults-extra-file 로만 넘긴다(임시 .cnf 는 끝날 때 지운다).
     tests/restore-guards.test.mjs 가 이 규약이 지켜지는지 매 게이트마다 확인한다.

  ⚠️ 자격 획득 순서 — 무인 실행이 '조용히 멎는' 것을 막는 순서다.
     ① -CnfPath 를 줬으면 그 파일
     ② 기본 .cnf : %ProgramData%\taskmgr\restore-taskmgr.cnf
        (backup-taskmgr.ps1 이 %ProgramData%\taskmgr\backup-taskmgr.cnf 를 쓰는 것과 같은 자리 관례)
     ③ 환경변수 TASKMGR_ADMIN_PW
        (이 저장소가 시험에서 TC_TEST_DB_ADMIN_PW 를 쓰는 것과 같은 관례. 같은 글자가 이 머리말 ·
         아래 에러 메시지 · db/deploy/README.md 셋에 나온다 — 하나만 바꾸면 사람이 못 찾는다)
     ④ stdin 이 리다이렉트돼 있으면 그 첫 줄 — 단 **상한 10초**. 그 안에 한 줄이 안 오면 코드 2.
     ⑤ 대화형이면 물어본다.
     ①②③ 은 stdin 을 **아예 읽지 않는다**.

     ★ ④ 에 왜 상한이 필요한가 — 실측(2026-09-07):
       stdin 이 리다이렉트돼 있고 파이프가 **열린 채 비어 있으면**(아무도 안 쓴다)
       [Console]::In.ReadLine() 은 영원히 돌아오지 않는다. 그 상태에서
       restore-taskmgr.ps1 -WhatIf 가 5분이 지나도 끝나지 않았다
       (측정: 바깥에서 25초 상한을 걸어 강제 종료 — 종료코드 124).
       < NUL(즉시 EOF)이면 곧바로 끝나므로, 이 사고는 '파이프는 열려 있는데 아무도 안 쓰는'
       무인 실행 — 작업 스케줄러 · CI · 다른 스크립트 안 — 에서만 일어난다.
       그게 정확히 이 스크립트가 돌아야 할 자리다(짝인 backup-taskmgr.ps1 은 -Install 로
       스케줄러에 등록까지 된다).
       무인 실행에서 **실패는 알람이 되지만 무한 대기는 아무 신호도 내지 않는다.**
       백업 계정에 SELECT 만 줬을 때 mysqldump 가 조용히 exit 0 으로 끝나던 것과 같은 종류의
       침묵이다 — 그 침묵을 없애려고 만든 스크립트가 같은 침묵을 만들 수는 없다.
       tests/restore-guards.test.mjs 가 이 상한과 이 순서를 계약으로 잠근다.

  ⚠️ 덤프에 CREATE DATABASE / USE 가 있는가 — backup-taskmgr.ps1 은 단일 DB 덤프를
     --databases 없이 뜬다. 그래서 산출물에는 CREATE DATABASE 도 USE 도 없다(실측:
     taskmgr-20260824-102609.sql 에 0건). 즉 **대상 DB 인자를 빼먹으면** "No database selected"
     로 끝난다 — 조용히 엉뚱한 곳에 들어가지는 않는다. 하지만 언젠가 --databases 로 뜬 파일이
     섞이면 대상 인자를 무시하고 파일 안의 이름으로 들어간다. 그래서 이 스크립트는 주입 전에
     덤프 머리를 직접 읽어 두 문장의 유무를 화면에 찍고, 있으면 크게 경고한다.

  ⚠️ DROP DATABASE 는 표 단위 권한을 지우지 않는다.
     mysql.tables_priv 에 남은 줄은 나중에 같은 이름의 DB 가 생기면 되살아난다.
     그래서 -DropTarget 은 DROP 뒤에 그 DB 의 앱 계정 권한을 REVOKE 하고 0행을 확인한다.

  ⚠️ 이 스크립트가 -LiveDb 에 하는 일은 읽기뿐이다(SELECT · information_schema · mysqldump).
     쓰기는 -TargetDb 와 백업 폴더에만 한다. 가드(1단계)가 그 경계를 지킨다.

  예)  restore-taskmgr.cmd -TargetDb taskmgr_restore_drill
       restore-taskmgr.cmd -DumpPath "D:\taskmgr-backup\taskmgr-20260824-102609.sql" -Grants
       restore-taskmgr.cmd -TargetDb taskmgr_restore_drill -DropTarget
       restore-taskmgr.cmd -WhatIf
#>
[CmdletBinding()]
param(
  [string]$DumpPath   = "",                        # 비우면 -BackupDir 의 최신 *.sql (.partial 제외)
  [string]$BackupDir  = "D:\taskmgr-backup",
  [string]$TargetDb   = "taskmgr_restore",         # ★ 기본은 라이브가 아닌 별도 DB
  [string]$LiveDb     = "taskmgr",                 # 대조 기준(읽기 전용)
  [switch]$Grants,                                 # 복구 후 계정·권한 재적용(복구방법.txt 4번)
  [switch]$DropTarget,                             # 리허설 뒷정리 — TargetDb 를 지운다
  [switch]$WhatIf,                                 # 실제 쓰기 없이 계획만 출력
  [switch]$OverwriteLive,                          # ★ 이것만으로는 부족하다(1단계 가드 참조)
  [switch]$AllowRowDiff,                           # 옛 스냅샷 복구 — 행 수 차이를 경고로 낮춘다(스키마는 그대로 엄격)
  [switch]$KeepExisting,                           # 대상 DB 를 비우지 않고 덮어쓴다(기본은 안전 덤프 후 재생성 — 5단계 ★)
  [switch]$NoSmoke,                                # 앱 계정 스모크 조회를 건너뛴다(그 항목은 '검증 못 함'이 된다)
  [string]$BaseDir    = "C:\mysql",                # mysql.exe 위치(없으면 서비스 binPath 추론)
  [string]$DbHost     = "127.0.0.1",
  [int]$Port          = 3306,
  [string]$ServiceName = "MySQL84",
  [string]$CnfPath    = "",                        # 관리 계정 자격 파일. 비우면 물어봐서 임시로 만든다
  [string]$AdminUser  = "root",                    # -CnfPath 가 없을 때 물어볼 계정
  [string]$AppCnfPath = "",                        # 스모크용 앱 계정 자격 파일. 비우면 DeployConfig.cs 에서 읽는다
  [string]$DeployConfigPath = "",                  # 비우면 <저장소>\widget\DeployConfig.cs
  [string]$UserGrantsPath = ""                     # 비공개 05-grants.sql 경로. 비우면 형제 폴더에서 찾는다(8단계 ★)
)

$ErrorActionPreference = "Continue"

# 종료코드 상수 — 숫자를 흩뿌리면 표와 코드가 조용히 어긋난다(init-calendar.ps1 과 같은 관례).
$EXIT_OK         = 0
$EXIT_FAIL       = 1
$EXIT_CONFIG     = 2
$EXIT_CONN       = 3
$EXIT_NOTOOL     = 4
$EXIT_ADMIN      = 5   # 결번 — backup-taskmgr.ps1 과 뜻만 맞춰 비워 둔다
$EXIT_REFUSED    = 6
$EXIT_NOBASELINE = 7

# 무인 실행 자격 — 머리말 '⚠️ 자격 획득 순서' 참조.
#   이름을 상수로 둔다: 에러 메시지 · 머리말 · README 가 같은 글자를 가리켜야 사람이 찾는다.
$ADMIN_PW_ENV   = "TASKMGR_ADMIN_PW"   # ③ 환경변수 이름
$STDIN_WAIT_SEC = 10                   # ④ stdin 첫 줄 읽기 상한(초). 무한이면 안 된다 — 그게 A 결함이었다.

# --- 화면 출력 (backup-taskmgr.ps1 과 같은 네 함수) -------------------------
function Info($m){ Write-Host "[*] $m" }
function Ok($m){   Write-Host "[OK] $m"   -ForegroundColor Green }
function Warn($m){ Write-Host "[경고] $m" -ForegroundColor Yellow }
function Bad($m){  Write-Host "[실패] $m" -ForegroundColor Red }

$script:logPath  = $null
$script:tmpCnf   = $null
$script:tmpApp   = $null
$script:tmpSql   = @()

# 로그 한 줄 누적. backup-taskmgr.ps1 과 같은 방식 — PS 5.1 의 Add-Content -Encoding UTF8 은
# BOM 을 박으므로 .NET 으로 BOM 없는 UTF-8 을 직접 이어 붙인다.
function AddLog($line){
  if(-not $script:logPath){ return }
  try{
    $stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $enc = New-Object System.Text.UTF8Encoding($false)
    if(-not (Test-Path $script:logPath)){
      [IO.File]::WriteAllText($script:logPath, "# taskmgr 복구 로그 (시각 / 결과 / 덤프 / 대상DB / 표 / 행 / 소요 / 비고)`r`n", $enc)
    }
    [IO.File]::AppendAllText($script:logPath, "$stamp`t$line`r`n", $enc)
  } catch { Warn "로그를 못 남겼습니다: $($_.Exception.Message)" }
}

function Cleanup(){
  if($script:tmpCnf){ Remove-Item -LiteralPath $script:tmpCnf -Force -ErrorAction SilentlyContinue; $script:tmpCnf = $null }
  if($script:tmpApp){ Remove-Item -LiteralPath $script:tmpApp -Force -ErrorAction SilentlyContinue; $script:tmpApp = $null }
  foreach($f in $script:tmpSql){ Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
  $script:tmpSql = @()
}

# 종료 — 화면·로그에 같은 이유를 남기고 지정 코드로 죽는다.
function Die($msg, $code){
  Bad $msg
  AddLog "FAIL`t-`t-`t-`t-`t-`t$msg"
  Cleanup
  exit $code
}

# 인자 뒤엉킴 방어 — backup-taskmgr.ps1 과 같은 이유(값이 역슬래시로 끝나면 powershell.exe 의
# 파서가 \" 를 이스케이프된 따옴표로 읽어 뒤 인자를 통째로 삼킨다). 대상 DB 이름이 조용히
# 달라지면 이 스크립트에서는 '엉뚱한 DB 를 덮어쓴다' 가 되므로 여기서 멈춘다.
function AssertNoSwallow($label, $val){
  if("$val" -match '"'){ Die "$label 값에 따옴표가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태입니다 — 경로 끝의 역슬래시를 빼고 다시 실행하세요." $EXIT_CONFIG }
  if("$val" -match '\s-(DumpPath|BackupDir|TargetDb|LiveDb|BaseDir|DbHost|Port|ServiceName|CnfPath|AdminUser|AppCnfPath|DeployConfigPath|UserGrantsPath)\b'){ Die "$label 값 안에 다른 인자가 들어 있습니다: [$val]. 경로 끝의 역슬래시를 빼고 다시 실행하세요." $EXIT_CONFIG }
}
AssertNoSwallow "-DumpPath"  $DumpPath
AssertNoSwallow "-BackupDir" $BackupDir
AssertNoSwallow "-BaseDir"   $BaseDir
AssertNoSwallow "-CnfPath"   $CnfPath
AssertNoSwallow "-TargetDb"  $TargetDb
AssertNoSwallow "-LiveDb"    $LiveDb
AssertNoSwallow "-UserGrantsPath" $UserGrantsPath

function TrimSlash($p){
  $t = "$p"
  if($t.Length -gt 3 -and $t.EndsWith("\")){ return $t.TrimEnd("\") }
  return $t
}
$BackupDir = TrimSlash $BackupDir
$BaseDir   = TrimSlash $BaseDir

# DB 이름은 식별자다. 여기서 좁혀 두지 않으면 아래 백틱 인용이 뚫린다.
function AssertIdent($label, $val){
  if("$val" -notmatch '^[A-Za-z0-9_$]+$'){ Die "$label 이 DB 이름으로 쓸 수 없는 문자를 담고 있습니다: [$val]" $EXIT_CONFIG }
}
AssertIdent "-TargetDb" $TargetDb
AssertIdent "-LiveDb"   $LiveDb

# 직접 지정한 경로 인자는 **여기서** 본다 — 어떤 파괴적 단계보다 앞이다(2026-09-11 적대 검토 R2 → R3).
#   옛 판은 이 확인들이 저마다 쓰이는 자리(8단계 권한 적용 · 9-7 스모크)에 흩어져 있었다. 그 자리는
#   전부 **대상 DB 를 이미 드롭·복구한 뒤**다 — 사람은 "설정 문제(코드 2)" 를 읽으면서 갈아엎힌 DB 를
#   받는다. 지정한 경로는 곧 의도다. 성립하지 않으면 아무것도 건드리기 전에 끝낸다(-WhatIf 도 같다 —
#   계획을 찍기 전에 죽는다. 위 종료코드 표의 ★ 참조).
#   ★ -LiteralPath 로 본다. 경로에 `[`·`]`·`*` 가 있으면 Test-Path/Resolve-Path 는 그것을 **와일드카드**
#     로 읽어 있는 파일을 "없다" 고 하거나 엉뚱한 파일을 고른다. 이 파일은 덤프 쪽에서 이미
#     Get-Item -LiteralPath 로 같은 규약을 쓰고 있다 — 사람이 준 경로는 글자 그대로가 정답이다.
if($UserGrantsPath -and -not (Test-Path -LiteralPath $UserGrantsPath)){
  Die "-UserGrantsPath 로 지정한 05-grants.sql 이 없습니다: $UserGrantsPath (경로를 확인하거나, 형제 폴더에서 찾게 하려면 이 인자를 빼고 실행하세요)" $EXIT_CONFIG
}
if($AppCnfPath -and -not (Test-Path -LiteralPath $AppCnfPath)){
  Die "앱 자격 파일이 없습니다: $AppCnfPath" $EXIT_CONFIG
}
#   ★ -DeployConfigPath 는 **직접 준 경우에만** 본다. 비우면 9-7 이 <저장소>\widget\DeployConfig.cs 를
#     기본으로 채우고, 그 기본이 없는 것은 '검증 못 함' 이지 설정 오류가 아니다(비공개 파일이 없는
#     PC 도 있다). 반대로 직접 준 경로가 없을 때 옛 판은 `if(Test-Path …)` 로 **말없이 건너뛰어**
#     스모크를 '검증 못 함' 으로 끝냈다 — 사람은 자기가 준 경로가 무시된 줄 모른다.
if($DeployConfigPath -and -not (Test-Path -LiteralPath $DeployConfigPath)){
  Die "-DeployConfigPath 로 지정한 DeployConfig.cs 가 없습니다: $DeployConfigPath (경로를 확인하거나, 기본 위치(<저장소>\widget\DeployConfig.cs)를 쓰려면 이 인자를 빼고 실행하세요)" $EXIT_CONFIG
}
#   -Grants 가 쓸 두 SQL 은 스크립트 폴더에 있어야 한다. 8단계에서 죽으면 이미 DROP·복구 뒤다.
#   (경로 자체는 -Grants 여부와 무관하게 여기서 한 번만 정한다 — 8단계와 -WhatIf 가 같은 값을 본다.)
$scriptDir  = Split-Path -Parent $PSCommandPath
$appUserSql = Join-Path $scriptDir "create-app-user.sql"
$grantsSql  = Join-Path $scriptDir "grants-calendar.sql"
if($Grants -and -not (Test-Path -LiteralPath $appUserSql)){ Die "create-app-user.sql 이 스크립트 폴더에 없습니다: $scriptDir" $EXIT_CONFIG }
if($Grants -and -not (Test-Path -LiteralPath $grantsSql)){  Die "grants-calendar.sql 이 스크립트 폴더에 없습니다: $scriptDir" $EXIT_CONFIG }

Write-Host "============================================"
Write-Host "   taskmgr 복구 / 복구 리허설"
Write-Host "   대상: $DbHost`:$Port"
Write-Host "   복구 DB: $TargetDb   (대조 기준: $LiveDb)"
Write-Host "   덤프 폴더: $BackupDir"
if($WhatIf){ Write-Host "   -WhatIf — 계획만 출력하고 아무것도 바꾸지 않습니다." }
Write-Host "============================================"

# ============================================================================
#  1) ★ 라이브 덮어쓰기 가드 — 이 스크립트에서 가장 중요한 절
#
#     복구 스크립트의 사고는 '복구가 안 되는 것' 이 아니라 '살아 있는 DB 를 옛 스냅샷으로
#     덮어쓰는 것' 이다. 그건 되돌릴 수 없고, 게다가 명령 한 줄 오타로 일어난다.
#     그래서 스위치 하나로는 열리지 않게 한다:
#       (a) -TargetDb 가 -LiveDb 와 같다               → 기본은 즉시 거부(코드 6)
#       (b) -OverwriteLive 를 줬다                     → 그것만으로는 부족하다
#       (c) 사람이 DB 이름을 직접 타이핑해 글자까지 일치 → 그제서야 진행
#       (d) 비대화형(stdin 리다이렉트)이면 (c)가 불가능 → 무조건 거부
#     (d)가 핵심이다. 무인 배치·스케줄러에서는 이 경로가 열리지 않는다.
#     ※ PowerShell 의 -eq 는 문자열에서 대소문자를 구분하지 않는다. 가드 쪽은 그게 맞다
#       (Windows MySQL 은 lower_case_table_names=1 이라 TASKMGR 와 taskmgr 가 같은 DB 다).
#       반대로 타이핑 확인은 -cne 로 **대소문자까지** 본다 — 확인 절차는 느슨하면 의미가 없다.
# ============================================================================
if($TargetDb -eq $LiveDb){
  Bad "라이브 덮어쓰기 거부 — -TargetDb($TargetDb) 가 -LiveDb($LiveDb) 와 같습니다."
  Write-Host "  이 스크립트의 기본값은 '라이브가 아닌 별도 DB 로 복구' 입니다. 먼저 별도 DB 로 복구해"
  Write-Host "  내용을 확인한 뒤, 필요한 행만 옮기는 것이 안전합니다(db/deploy/README.md 복구 절)."
  if(-not $OverwriteLive){
    Write-Host "  정말 라이브를 덮어써야 한다면 -OverwriteLive 를 주고 **대화형 콘솔에서** 다시 실행하세요."
    AddLog "REFUSED`t-`t$TargetDb`t-`t-`t-`t라이브 덮어쓰기 거부(-OverwriteLive 없음)"
    Cleanup
    exit $EXIT_REFUSED
  }
  if([Console]::IsInputRedirected){
    Write-Host "  -OverwriteLive 가 있지만 stdin 이 리다이렉트돼 있습니다(비대화형)."
    Write-Host "  라이브 덮어쓰기는 사람이 DB 이름을 직접 타이핑해야만 열립니다 — 무인 실행에서는 열지 않습니다."
    AddLog "REFUSED`t-`t$TargetDb`t-`t-`t-`t라이브 덮어쓰기 거부(비대화형)"
    Cleanup
    exit $EXIT_REFUSED
  }
  Warn "-OverwriteLive 가 주어졌습니다. 확인을 위해 대상 DB 이름을 그대로 입력하세요."
  $typed = ""
  try { $typed = Read-Host "덮어쓸 DB 이름을 입력('$LiveDb')" } catch { $typed = "" }
  if("$typed" -cne "$LiveDb"){
    Bad "입력한 이름이 다릅니다([$typed] != [$LiveDb]). 아무것도 바꾸지 않고 종료합니다."
    AddLog "REFUSED`t-`t$TargetDb`t-`t-`t-`t라이브 덮어쓰기 거부(이름 입력 불일치)"
    Cleanup
    exit $EXIT_REFUSED
  }
  Warn "라이브 덮어쓰기가 열렸습니다. 아래 '복구 전 안전망' 이 현재 내용을 먼저 떠 둡니다."
}
if($DropTarget -and ($TargetDb -eq $LiveDb)){
  Die "-DropTarget 으로 라이브 DB($LiveDb) 를 지울 수는 없습니다. 이 조합은 어떤 스위치로도 열리지 않습니다." $EXIT_REFUSED
}

# ============================================================================
#  2) 도구 찾기 — backup-taskmgr.ps1 / init-calendar.ps1 과 같은 방식
# ============================================================================
$mysql     = Join-Path $BaseDir "bin\mysql.exe"
$mysqldump = Join-Path $BaseDir "bin\mysqldump.exe"
if(-not (Test-Path $mysql)){
  try {
    $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    if($svc -and $svc.PathName -match '"?([A-Za-z]:[^"]*)\\bin\\mysqld\.exe'){
      $root = $Matches[1]
      $c1 = Join-Path $root "bin\mysql.exe";     if(Test-Path $c1){ $mysql = $c1 }
      $c2 = Join-Path $root "bin\mysqldump.exe"; if(Test-Path $c2){ $mysqldump = $c2 }
    }
  } catch {}
}
if(-not (Test-Path $mysql)){     Die "mysql.exe 를 못 찾았습니다. -BaseDir 로 설치 경로를 지정하세요(예: -BaseDir `"C:\Program Files\MySQL\MySQL Server 8.4`")." $EXIT_NOTOOL }
if(-not (Test-Path $mysqldump)){ Die "mysqldump.exe 를 못 찾았습니다(복구 전 안전망에 필요합니다). -BaseDir 로 설치 경로를 지정하세요." $EXIT_NOTOOL }
Info "도구: $mysql"

# ============================================================================
#  백업 폴더 + 로그 자리
# ============================================================================
if(-not (Test-Path $BackupDir)){
  Die "덤프 폴더가 없습니다: $BackupDir (-BackupDir 로 지정하세요)" $EXIT_CONFIG
}
$script:logPath = Join-Path $BackupDir "restore-log.txt"

# ============================================================================
#  3) 자격 증명 — .cnf 만 쓴다. 비밀번호를 명령줄로 넘기는 자리는 이 파일에 없다.
# ============================================================================
function NewCnf($prefix, $user, $pw){
  $pwEsc = ($pw -replace '\\','\\') -replace '"','\"'
  $p = Join-Path $env:TEMP ($prefix + [IO.Path]::GetRandomFileName() + ".cnf")
  # BOM 없는 UTF-8 — MySQL 옵션 파서는 BOM 바이트를 첫 줄의 일부로 읽어 [client] 를 못 알아본다.
  $txt = "[client]`r`nuser=$user`r`npassword=`"$pwEsc`"`r`nhost=$DbHost`r`nport=$Port`r`n"
  [IO.File]::WriteAllText($p, $txt, (New-Object System.Text.UTF8Encoding($false)))
  return $p
}

# ★ stdin 첫 줄을 '상한 안에' 읽는다 — 여기가 A 결함(무인 실행 무한 대기)의 수리 자리다.
#   PS 5.1 에는 상한 있는 콘솔 읽기가 없다. [Console]::In.ReadLine() 은 파이프가 열린 채
#   비어 있으면 영원히 돌아오지 않는다(머리말 ★ 실측). 그래서 raw 스트림의 **비동기** 읽기로
#   바꾸고 완료 대기에 상한을 건다. 상한을 넘기면 그 읽기 스레드는 그대로 버린다 —
#   호출자가 곧바로 Die 로 프로세스를 끝내므로 뒷정리가 필요 없다.
#   반환: @{ Line = <첫 줄 또는 $null>; TimedOut = $true/$false }
#     · TimedOut=$true → 상한 안에 아무것도 안 왔다(파이프가 열린 채 비어 있는 무인 실행)
#     · Line=""        → 즉시 EOF(< NUL)이거나 빈 줄. 둘 다 '자격 없음' 이다.
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
      if($n -le 0){ break }                       # EOF
      [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $n))
      $t = $sb.ToString()
      $ix = $t.IndexOfAny([char[]]@("`r","`n"))
      if($ix -ge 0){ $res.Line = $t.Substring(0, $ix); return $res }
    }
    $res.Line = $sb.ToString()                    # 개행 없이 EOF — 있는 만큼이 첫 줄이다
    return $res
  } catch { $res.Line = $null; return $res }
}

# ② 기본 .cnf — backup-taskmgr.ps1 과 같은 자리 관례(%ProgramData%\taskmgr\).
#   있으면 그것을 쓰고 stdin 은 아예 읽지 않는다.
$defaultCnf = Join-Path $env:ProgramData "taskmgr\restore-taskmgr.cnf"
if(-not $CnfPath -and (Test-Path $defaultCnf)){
  $CnfPath = $defaultCnf
  Info "관리 자격: 기본 .cnf 를 찾았습니다 — $defaultCnf"
}

if($CnfPath){
  if(-not (Test-Path $CnfPath)){ Die "자격 파일이 없습니다: $CnfPath" $EXIT_CONFIG }
  try { $null = Get-Content $CnfPath -TotalCount 1 -ErrorAction Stop }
  catch { Die "자격 파일을 읽을 수 없습니다: $CnfPath ($($_.Exception.Message))" $EXIT_CONFIG }
  $adminCnf = $CnfPath
  Info "관리 자격: $CnfPath (stdin 을 읽지 않습니다)"
} else {
  $pw = $null
  $pwFrom = ""
  # ③ 환경변수 — stdin 보다 **먼저** 본다. 무인 호출자가 값을 넘기는 정식 통로다.
  $envPw = [Environment]::GetEnvironmentVariable($ADMIN_PW_ENV)
  if(-not [string]::IsNullOrEmpty($envPw)){
    $pw = $envPw
    $pwFrom = "환경변수 $ADMIN_PW_ENV"
    Info "관리 자격: 환경변수 $ADMIN_PW_ENV 에서 읽었습니다(stdin 을 읽지 않습니다)."
  } elseif([Console]::IsInputRedirected){
    # ④ stdin 첫 줄 — ★ 상한이 있다. 없으면 무인 실행이 아무 신호 없이 영원히 멎는다.
    Info "stdin 이 리다이렉트돼 있습니다 — 관리 계정 비밀번호를 stdin 첫 줄에서 읽습니다(상한 $STDIN_WAIT_SEC 초)."
    $r = ReadStdinLineBounded $STDIN_WAIT_SEC
    if($r.TimedOut){
      Die "stdin 첫 줄을 $STDIN_WAIT_SEC 초 안에 받지 못했습니다(파이프가 열린 채 비어 있습니다). 무인 실행이면 -CnfPath 를 주거나 $ADMIN_PW_ENV 를 설정하세요." $EXIT_CONFIG
    }
    $pw = $r.Line
    if([string]::IsNullOrEmpty($pw)){
      Die "비밀번호를 받지 못했습니다(stdin 첫 줄이 비어 있습니다). 무인 실행이면 -CnfPath 를 주거나 $ADMIN_PW_ENV 를 설정하세요." $EXIT_CONFIG
    }
    $pwFrom = "stdin 첫 줄"
  } else {
    # ⑤ 대화형 — 사람이 보고 있으니 기다려도 된다.
    $s = Read-Host "MySQL $AdminUser 비밀번호" -AsSecureString
    $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
    $pwFrom = "대화형 입력"
  }
  if(-not $pw){ Die "비밀번호가 비어 있습니다." $EXIT_CONFIG }
  $script:tmpCnf = NewCnf "mysrestore_" $AdminUser $pw
  $adminCnf = $script:tmpCnf
  Info "관리 자격: 임시 .cnf — $pwFrom (실행이 끝나면 지웁니다)"
}

function AdminArgs(){ return @("--defaults-extra-file=$adminCnf","--default-character-set=utf8mb4") }

# 한 줄 결과. 실패는 빈 문자열이 아니라 $null 로 구분한다(backup-taskmgr.ps1 과 같은 규약).
function Q1($sql){
  $out = & $mysql (AdminArgs) "-N" "-B" "-e" $sql 2>$null
  if($LASTEXITCODE -ne 0){ return $null }
  return ("" + $out).Trim()
}
function QLines($sql){
  $out = @(& $mysql (AdminArgs) "-N" "-B" "-e" $sql 2>$null)
  if($LASTEXITCODE -ne 0){ return $null }
  return @($out | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne "" })
}
function QExec($sql){
  & $mysql (AdminArgs) "-e" $sql
  return ($LASTEXITCODE -eq 0)
}

if((Q1 "SELECT 1;") -ne "1"){
  Die "DB 에 접속하지 못했습니다($DbHost`:$Port). 자격과 서버 상태를 확인하세요." $EXIT_CONN
}
$whoami = Q1 "SELECT CURRENT_USER();"
Info "접속 계정: $whoami"

# ============================================================================
#  4) 덤프 고르기 + 머리 확인
# ============================================================================
if(-not $DumpPath){
  $cands = @(Get-ChildItem -Path $BackupDir -File -ErrorAction SilentlyContinue |
             Where-Object { $_.Extension -eq ".sql" -and $_.Name -notlike "*.partial" -and $_.Name -notlike "pre-restore-*" } |
             Sort-Object LastWriteTime -Descending)
  if($cands.Count -lt 1){ Die "복구할 덤프를 못 찾았습니다: $BackupDir 안에 *.sql 이 없습니다(.partial 은 제외합니다 — 검증에 실패한 반쪽 백업이라 복구에 쓸 수 없습니다)." $EXIT_CONFIG }
  $DumpPath = $cands[0].FullName
  Info "덤프 자동 선택(최신): $($cands[0].Name)  [$($cands[0].Length) 바이트, $($cands[0].LastWriteTime.ToString('yyyy-MM-dd HH:mm'))]"
}
if(-not (Test-Path $DumpPath)){ Die "덤프 파일이 없습니다: $DumpPath" $EXIT_CONFIG }
if($DumpPath -like "*.partial"){ Die "이 파일은 검증에 실패한 반쪽 백업입니다(.partial). 복구에 쓸 수 없습니다: $DumpPath" $EXIT_CONFIG }
$dumpItem = Get-Item -LiteralPath $DumpPath
if($dumpItem.Length -le 0){ Die "덤프 파일이 0 바이트입니다: $DumpPath" $EXIT_CONFIG }
Info "복구할 덤프: $($dumpItem.FullName)  [$($dumpItem.Length) 바이트]"

# ★ 머리 40줄 확인 — 대상 DB 인자를 무시하고 파일 안의 이름으로 들어가는 형태인지 본다.
$head = @()
try{
  $sr = New-Object IO.StreamReader($dumpItem.FullName, (New-Object System.Text.UTF8Encoding($false)))
  for($i=0; $i -lt 40; $i++){
    $l = $sr.ReadLine()
    if($null -eq $l){ break }
    $head += $l
  }
  $sr.Close()
} catch { Die "덤프 머리를 읽지 못했습니다: $($_.Exception.Message)" $EXIT_CONFIG }
$hasCreateDb = @($head | Where-Object { $_ -match '(?i)^\s*CREATE\s+DATABASE' })
$hasUse      = @($head | Where-Object { $_ -match '(?i)^\s*USE\s+' })
$srcDbLine   = @($head | Where-Object { $_ -match '^-- Host:' })
if($srcDbLine.Count -gt 0){ Info "덤프 머리: $($srcDbLine[0])" }
if($hasCreateDb.Count -gt 0 -or $hasUse.Count -gt 0){
  Warn "★ 이 덤프에는 CREATE DATABASE/USE 문이 있습니다(CREATE $($hasCreateDb.Count)건 / USE $($hasUse.Count)건)."
  Warn "  그런 덤프는 **대상 DB 인자를 무시하고 파일에 적힌 DB 로 들어갑니다.** 아래 대상($TargetDb)과"
  Warn "  다른 DB 가 바뀔 수 있습니다. 파일을 직접 열어 확인하기 전에는 진행하지 마세요."
} else {
  Info "덤프 머리 확인 — CREATE DATABASE 0건 / USE 0건. 대상 DB 인자로만 들어갑니다(그래서 인자를 반드시 줍니다)."
}

# ============================================================================
#  라이브 DB 기준값 — 대조의 기준. 없으면 '검증 못 함' 이다(코드 7).
# ============================================================================
$liveExists = ([int](Q1 "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$LiveDb';") -gt 0)
$liveCharset = "utf8mb4"
$liveCollate = "utf8mb4_0900_ai_ci"
if($liveExists){
  $cs = Q1 "SELECT CONCAT(DEFAULT_CHARACTER_SET_NAME,'\t',DEFAULT_COLLATION_NAME) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$LiveDb';"
  if($cs){
    $parts = $cs -split "`t"
    if($parts.Count -ge 2 -and $parts[0] -and $parts[1]){ $liveCharset = $parts[0].Trim(); $liveCollate = $parts[1].Trim() }
  }
  Info "라이브 DB '$LiveDb' charset/collation = $liveCharset / $liveCollate (하드코딩하지 않고 읽어 왔습니다)"
} else {
  Warn "라이브 DB '$LiveDb' 가 없습니다 — 대조 기준이 없습니다. 검증은 '검증 못 함'으로 끝납니다(코드 $EXIT_NOBASELINE)."
  Warn "  charset/collation 은 읽을 곳이 없어 기본값($liveCharset / $liveCollate)으로 만듭니다."
}

# 이름 집합 조회들 — 개수가 아니라 이름을 가져온다(개수는 같고 이름이 다를 수 있다).
function TableNames($db){ return QLines "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$db' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME;" }
function ViewNames($db){  return QLines "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$db' AND TABLE_TYPE='VIEW' ORDER BY TABLE_NAME;" }
function TrigNames($db){  return QLines "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='$db' ORDER BY TRIGGER_NAME;" }
function RtnNames($db){   return QLines "SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='$db' ORDER BY ROUTINE_NAME;" }

# 표별 행 수 — information_schema.TABLE_ROWS 는 InnoDB 에서 **추정치**라 대조에 쓸 수 없다.
# 실제로 COUNT(*) 를 센다. 표 이름은 information_schema 에서 온 값이지만 그래도 한 번 더 좁힌다.
#   ★ README '리허설 기록' 의 실패담: 표 이름 끝의 \r 때문에 양쪽 다 ERROR 1103 이 났는데
#     비교 코드가 '둘 다 빈 값' 을 일치로 읽어 전 표 OK 를 찍었다. 그래서 여기서는
#     돌려받은 줄 수가 표 수와 같은지 먼저 확인하고, 다르면 대조 자체를 실패로 본다.
function RowCounts($db, $tables){
  $map = @{}
  if($tables.Count -lt 1){ return $map }
  $sel = @()
  foreach($t in $tables){
    if("$t" -notmatch '^[A-Za-z0-9_$]+$'){ Die "표 이름에 예상 밖 문자가 있습니다: [$t] — 대조를 진행하지 않습니다." $EXIT_FAIL }
    $sel += "SELECT '$t' AS t, COUNT(*) AS n FROM ``$db``.``$t``"
  }
  $sql = ($sel -join " UNION ALL ") + " ORDER BY t;"
  $lines = QLines $sql
  if($null -eq $lines){ Die "표별 행 수를 세지 못했습니다(DB=$db). 대조를 진행하지 않습니다." $EXIT_FAIL }
  foreach($l in $lines){
    $p = $l -split "`t"
    if($p.Count -ge 2){ $map[$p[0].Trim()] = [int]($p[1].Trim()) }
  }
  if($map.Count -ne $tables.Count){
    Die "표별 행 수 대조가 헛돌았습니다(표 $($tables.Count) 개인데 결과 $($map.Count) 줄). 이 상태를 '일치' 로 읽지 않습니다." $EXIT_FAIL
  }
  return $map
}

# 이름 집합 차집합 — ★ 개수를 세지 않는다. 개수는 같고 이름이 다를 수 있다.
function NameSetDiff($expect, $actual){
  $e = @($expect); $a = @($actual)
  return @{
    Missing = @($e | Where-Object { $a -notcontains $_ })
    Extra   = @($a | Where-Object { $e -notcontains $_ })
  }
}

$liveTables = @(); $liveViews = @(); $liveTrigs = @(); $liveRtns = @(); $liveRows = @{}
if($liveExists){
  $liveTables = @(TableNames $LiveDb)
  $liveViews  = @(ViewNames  $LiveDb)
  $liveTrigs  = @(TrigNames  $LiveDb)
  $liveRtns   = @(RtnNames   $LiveDb)
  $liveRows   = RowCounts $LiveDb $liveTables
  $liveTotal  = 0; foreach($k in $liveRows.Keys){ $liveTotal += $liveRows[$k] }
  Info "라이브 현황 — 표 $($liveTables.Count) · 뷰 $($liveViews.Count) · 트리거 $($liveTrigs.Count) · 루틴 $($liveRtns.Count) · 합 $liveTotal 행"
}

# ============================================================================
#  -WhatIf — 여기까지가 '읽기' 다. 계획만 찍고 끝낸다.
# ============================================================================
#  비공개 05-grants.sql — app_user 권한의 세 번째 정본 (8단계 ★)
#
#   ★ 왜 별도인가: 직원·조직 표(app_user·org_unit·title_code)와 그 권한은 회사 자료라
#     비공개 형제 저장소 taskmgr-company-data 에 있다(tests/user-admin.test.mjs 머리말과 같은 사실).
#     db\deploy 만으로 세운 서버는 캘린더는 돌지만 **직원 관리가 통째로 ERROR 1142 로 죽는다**
#     (docs\USER-ADMIN.md §11-11). 휴지통(v0.19.0~)이 오면서 인력 영구 삭제까지 여기에 걸린다.
#
#   ★ 이 파일만은 DB 이름을 치환할 필요가 없다 — 안의 GRANT 가 CONCAT(..., DATABASE(), ...) 로
#     **접속한 DB** 를 쓴다. 그래서 위 두 파일과 달리 임시 사본을 만들지 않고 그대로 돌린다.
# ============================================================================
function FindUserGrants(){
  #  ★ 이 함수는 **찾기만** 한다 — 오타를 잡는 자리는 여기가 아니라 맨 앞 인자 검증 구역이다.
  #    이 함수는 8단계(권한 적용)와 -WhatIf 계획 출력에서만 불리므로, 여기서 처음 죽으면
  #    **이미 DB 를 갈아엎은 뒤**다(2026-09-11 R2).
  #  ★ 두 사건을 섞지 않는다: '직접 지정했는데 없다'(Die)와 '원래 없는 환경이다'
  #    (아래 return $null → 경고). 전자를 경고로 흘리면 오타 하나가 "권한 파일이 원래 없는 환경"
  #    으로 둔갑해 복구가 경고만 남긴 채 '성공' 으로 끝난다(2026-09-11 R6). 후자는 비공개 저장소가
  #    없는 PC 의 정상 경로이므로 복구 자체는 끝까지 돌아야 한다.
  #  ★ 2026-09-11 적대 검토(R3) — 그래도 **쓰는 자리에서 한 번 더 본다**. 맨 앞 검증과 여기 사이는
  #    몇 분이고(덤프 주입), 그 사이에 파일이 사라지거나 이동할 수 있다. 그때 Resolve-Path 는
  #    아무것도 돌려주지 않아 이 함수가 $null 이 되고, 호출부는 그것을 '형제 폴더에 없음' 경고로
  #    읽는다 — 정확히 R6 이 막으려던 그 거짓말이다. 지정 경로가 없으면 여기서도 그 경로를
  #    이름으로 말하며 죽는다(설정 문제 = 코드 2). 절대 아래 경고 갈래로 떨어뜨리지 않는다.
  if($UserGrantsPath){
    if(-not (Test-Path -LiteralPath $UserGrantsPath)){
      Die "-UserGrantsPath 로 지정한 05-grants.sql 이 사라졌습니다: $UserGrantsPath (시작할 때는 있었습니다 — 실행 중에 옮겨지거나 지워졌습니다)" $EXIT_CONFIG
    }
    return (Resolve-Path -LiteralPath $UserGrantsPath).Path
  }
  $sd       = Split-Path -Parent $PSCommandPath                 # <저장소>\db\deploy
  $repoRoot = Split-Path (Split-Path $sd -Parent) -Parent       # <저장소>
  $cands = @(
    (Join-Path (Split-Path $repoRoot -Parent) "taskmgr-company-data\05-grants.sql"),  # 형제 폴더(정본 배치)
    (Join-Path $repoRoot "taskmgr-company-data\05-grants.sql")                        # 저장소 안에 반입해 둔 경우
  )
  #  ★ 기본 탐색(형제 폴더)에서 못 찾은 경우는 그대로 **경고**다 — 비공개 저장소가 없는 PC 에서도
  #    캘린더 복구 자체는 끝까지 돌아야 하기 때문이다(직원 관리만 1142 로 죽는다는 사실을 아래 경고가 말한다).
  #    '직접 지정했는데 없다'(위 Die)와 '원래 없는 환경이다'(이 경고)는 서로 다른 사건이다.
  foreach($c in $cands){ if(Test-Path -LiteralPath $c){ return (Resolve-Path -LiteralPath $c).Path } }
  return $null
}

# 없을 때 사람에게 남기는 경고 — 화면과 복구방법.txt 두 곳에 **같은 말**을 적는다.
#   화면은 스크롤로 사라지고, 복구를 실제로 하는 사람이 읽는 것은 백업 폴더의 복구방법.txt 다.
$UserGrantsMark = "[05-grants] app_user 권한은 비공개 저장소에 있다"
function UserGrantsWarnText(){
  return @"
$UserGrantsMark
--------------------------------------------------------------------
taskmgr-company-data\05-grants.sql 을 찾지 못했습니다(형제 폴더에 없음).
이 파일은 app_user 표에 SELECT/INSERT/UPDATE/DELETE 를 주는 **세 번째 정본**이고
이 저장소(db\deploy)에는 없습니다 — 비공개 저장소에서 따로 적용해야 합니다.

  mysql -uroot -p <대상DB> < <비공개저장소>\05-grants.sql        (또는 그 저장소의 apply.cmd)

적용하지 않으면 표와 데이터가 다 있어도 다음이 전부 ERROR 1142 로 죽습니다:
  · 직원 등록 · 수정 · 퇴사 처리  (docs\USER-ADMIN.md §11-11)
  · 휴지통의 인력 영구 삭제       (docs\TRASH-DELETE.md §3.3 · DEPLOY.md §0-5)
확인: SHOW GRANTS FOR 'taskmgr_app'@'%';  -> app_user 에 DELETE 가 보여야 합니다.
--------------------------------------------------------------------
"@
}

# 복구방법.txt(백업 폴더 — backup-taskmgr.ps1 이 만든다)에 같은 경고를 **한 번만** 덧붙인다.
#   ★ 새로 만들지는 않는다. 그 문서의 주인은 백업 스크립트고, 없는 폴더에 문서를 흩뿌리면
#     '어느 것이 정본인가' 가 흐려진다. 있으면 덧붙이고, 없으면 화면 경고로 끝낸다.
function WriteUserGrantsHowto(){
  try{
    $howto = Join-Path $BackupDir "복구방법.txt"
    if(-not (Test-Path $howto)){ return }
    $cur = [IO.File]::ReadAllText($howto)
    if($cur.Contains($UserGrantsMark)){ return }
    $enc = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($howto, $cur.TrimEnd() + "`r`n`r`n" + (UserGrantsWarnText) + "`r`n", $enc)
    Info "복구방법.txt 에 같은 경고를 덧붙였습니다: $howto"
  } catch { }
}

# ============================================================================
if($WhatIf){
  Write-Host ""
  Write-Host "---- 계획 (-WhatIf: 아무것도 바꾸지 않습니다) ----"
  Write-Host "  1) 복구 전 안전망 : $TargetDb 가 있으면 $BackupDir\pre-restore-$TargetDb-<타임스탬프>.sql 로 덤프"
  Write-Host "  2) CREATE DATABASE IF NOT EXISTS ``$TargetDb`` CHARACTER SET $liveCharset COLLATE $liveCollate;"
  Write-Host "  3) mysql --default-character-set=utf8mb4 $TargetDb < `"$($dumpItem.FullName)`""
  if($Grants){
    Write-Host "  4) create-app-user.sql + grants-calendar.sql 을 $TargetDb 에 적용"
    $ugPlan = FindUserGrants
    if($ugPlan){ Write-Host "     + $ugPlan  (비공개 05-grants.sql — app_user 쓰기 권한)" }
    else       { Write-Host "     + (없음 — taskmgr-company-data\05-grants.sql 을 못 찾았습니다. app_user 쓰기 권한은 안 붙습니다)" }
  }
  else       { Write-Host "  4) (건너뜀 — -Grants 를 주지 않았습니다. 권한 없이 복구하면 앱은 첫 조회에서 ERROR 1142 로 죽습니다)" }
  Write-Host "  5) 검증 — 표/뷰/트리거/루틴 이름 집합 · 표별 행 수 · 덤프 마감 표시 · 앱 계정 스모크 조회"
  if($DropTarget){ Write-Host "  6) DROP DATABASE ``$TargetDb`` + 남은 표 단위 권한 REVOKE" }
  Write-Host ""
  Ok "계획 출력만 했습니다."
  Cleanup
  exit $EXIT_OK
}

# ============================================================================
#  5) 복구 전 안전망 — 대상 DB 가 이미 있으면 그 내용을 먼저 떠 둔다.
#     못 뜨면 진행하지 않는다(코드 2). '복구가 복구를 지운' 사고를 막는 유일한 겹이다.
# ============================================================================
$targetExisted = ([int](Q1 "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$TargetDb';") -gt 0)
if($targetExisted){
  $stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
  $prePath = Join-Path $BackupDir "pre-restore-$TargetDb-$stamp.sql"
  Info "대상 DB '$TargetDb' 가 이미 있습니다 — 덮어쓰기 전에 현재 내용을 먼저 뜹니다: $prePath"
  & $mysqldump (AdminArgs) "--single-transaction" "--no-tablespaces" "--routines" "--triggers" "--result-file=$prePath" $TargetDb
  $rc = $LASTEXITCODE
  if($rc -ne 0 -or -not (Test-Path $prePath)){
    Die "복구 전 안전 덤프에 실패했습니다(mysqldump exit=$rc). 되돌릴 수단 없이 덮어쓰지 않습니다: $prePath" $EXIT_CONFIG
  }
  $preSize = (Get-Item -LiteralPath $prePath).Length
  if($preSize -le 0){ Die "복구 전 안전 덤프가 0 바이트입니다: $prePath. 되돌릴 수단 없이 덮어쓰지 않습니다." $EXIT_CONFIG }
  Ok "복구 전 안전망 확보 — $preSize 바이트: $prePath"

  # ★ 비운 뒤에 붓는다 — 실측으로 배운 것.
  #   덤프는 표마다 DROP TABLE IF EXISTS → CREATE TABLE 을 하지만, 표 **순서**대로 한다.
  #   대상에 다른 세대의 스키마가 남아 있으면 아직 안 지워진 옛 표를 참조하는 FK 에서 죽는다.
  #   실측(2026-09-07): 8-24 스냅샷이 든 DB 에 현재 덤프를 부으니
  #     ERROR 3734 (HY000) at line 25: Failed to add the foreign key constraint.
  #     Missing column 'org_id' for constraint 'fk_user_org_id' in the referenced table 'org_unit'
  #   — app_user 를 새 정의로 만들 때 org_unit 은 아직 옛 정의(org_id 없음)였다.
  #   덤프 머리의 FOREIGN_KEY_CHECKS=0 은 '없는 표 참조'만 봐주고 '있는 표에 컬럼이 없다'는 못 봐준다.
  #   게다가 덤프에 없는 옛 표는 DROP 되지 않고 살아남아 '반쯤 옛것인 DB' 가 만들어진다.
  #   그래서 안전 덤프가 성공한 뒤에만, 대상을 통째로 다시 만든다.
  if($KeepExisting){
    Warn "-KeepExisting — 대상 DB 를 비우지 않고 그대로 덮어씁니다."
    Warn "  덤프에 없는 옛 표가 살아남고, 세대가 다르면 DDL 이 ERROR 3734/1050 으로 죽을 수 있습니다(실측)."
  } else {
    Warn "대상 DB '$TargetDb' 를 비우고 다시 만듭니다(위 안전 덤프가 그 근거입니다)."
    if($TargetDb -eq $LiveDb){ Warn "  ★ 이것은 라이브 DB 입니다. 앞의 이름 입력 확인을 통과했기 때문에 여기까지 왔습니다." }
    if(-not (QExec "DROP DATABASE IF EXISTS ``$TargetDb``;")){ Die "대상 DB 를 비우지 못했습니다($TargetDb)." $EXIT_CONN }
    Ok "DROP DATABASE ``$TargetDb`` — 안전 덤프: $prePath"
  }
} else {
  Info "대상 DB '$TargetDb' 는 아직 없습니다 — 지울 것이 없어 안전 덤프를 건너뜁니다."
}

# ============================================================================
#  6) 대상 DB 만들기 — charset/collation 은 라이브에서 읽은 값 그대로
# ============================================================================
Info "CREATE DATABASE IF NOT EXISTS ``$TargetDb`` CHARACTER SET $liveCharset COLLATE $liveCollate;"
if(-not (QExec "CREATE DATABASE IF NOT EXISTS ``$TargetDb`` CHARACTER SET $liveCharset COLLATE $liveCollate;")){
  Die "대상 DB 를 만들지 못했습니다($TargetDb). 관리 계정에 CREATE 권한이 있는지 확인하세요." $EXIT_CONN
}

# ============================================================================
#  7) 주입 — ★ 대상 DB 인자를 반드시 준다.
#     PowerShell 의 '<' 리다이렉트는 5.1 에 없으므로 cmd /c 를 거친다
#     (init-calendar.ps1 이 grants 를 넣을 때와 같은 방식).
# ============================================================================
Info "덤프 주입 → $TargetDb"
$sw = [Diagnostics.Stopwatch]::StartNew()
cmd /c "`"$mysql`" `"--defaults-extra-file=$adminCnf`" --default-character-set=utf8mb4 `"$TargetDb`" < `"$($dumpItem.FullName)`""
$injRc = $LASTEXITCODE
$sw.Stop()
$took = [math]::Round($sw.Elapsed.TotalSeconds,1)
if($injRc -ne 0){
  Bad "덤프 주입이 코드 $injRc 로 끝났습니다. 대상 DB '$TargetDb' 는 원인 확인용으로 남깁니다."
  AddLog "FAIL`t$($dumpItem.Name)`t$TargetDb`t-`t-`t$($took)s`tmysql exit=$injRc"
  Cleanup
  exit $EXIT_FAIL
}
Ok "주입 완료 — $($took)초"

# ============================================================================
#  8) -Grants — 계정·권한 재적용 (D:\taskmgr-backup\복구방법.txt 4번)
#
#     ★ 덤프에는 계정도 권한도 들어 있지 않다. 백업은 taskmgr **한 DB** 만 뜨고, 계정 정보는
#       mysql 스키마에 있어 대상이 아니다. 그래서 이 단계를 건너뛰면 표와 데이터는 전부
#       제자리에 있는데 위젯이 첫 조회부터 ERROR 1142 로 죽는다. 아래 9-7 스모크가 그것을 잡는다.
#
#     ★ create-app-user.sql / grants-calendar.sql 은 DB 이름을 **글자로 박아 두었다**
#       (grants-calendar.sql 의 모든 GRANT 가 'ON taskmgr.<표>' 다 — 파일 머리말이 그렇게 못박았고,
#        배포 스크립트가 한 줄로 치환하도록 계정 표기까지 한 형태로 통일해 두었다).
#       그러므로 대상이 taskmgr 가 아니면 원본을 그대로 돌릴 수 없다. 돌리면 **리허설이
#       라이브 계정 권한을 건드린다.** 여기서는 init-calendar.ps1 과 같은 결론을 따른다 —
#       임시 사본에서 스키마 이름만 바꿔 실행하고(원본은 건드리지 않는다), 되돌리는 REVOKE 문을 찍는다.
# ============================================================================
#  ★ $scriptDir·$appUserSql·$grantsSql 는 **맨 앞 인자 검증 구역**에서 정해진다 — 존재 확인이 거기
#    있어야 하기 때문이다(2026-09-11 R3). 여기서 다시 만들면 두 벌이 되고 한쪽만 고쳐진다.
$appUser = "taskmgr_app"
$appHost = "%"
$revokeHint = @()

# GRANT 문에서 스키마 이름을 뽑는다(하드코딩 여부를 '보고' 판단하기 위해서다 — 추측하지 않는다).
function GrantSchemas($sqlText){
  $found = @{}
  foreach($m in [regex]::Matches($sqlText, '(?im)^\s*GRANT\s+[^;]*?\sON\s+`?([A-Za-z0-9_$]+)`?\s*\.')){
    $found[$m.Groups[1].Value] = $true
  }
  return @($found.Keys)
}

if($Grants){
  #  ★ 두 파일의 존재 확인은 맨 앞 인자 검증 구역에 있다(2026-09-11 R3) — 여기서 죽으면 이미 DROP 뒤다.
  $appUserText = [IO.File]::ReadAllText($appUserSql)
  $grantsText  = [IO.File]::ReadAllText($grantsSql)
  $schemas = @(GrantSchemas ($appUserText + "`n" + $grantsText))
  if($schemas.Count -lt 1){ Die "create-app-user.sql / grants-calendar.sql 에서 GRANT 대상 스키마를 못 찾았습니다." $EXIT_CONFIG }
  if($schemas.Count -gt 1){ Die "두 파일에 스키마 이름이 섞여 있습니다($($schemas -join ', ')). 치환이 성립하지 않으므로 멈춥니다." $EXIT_CONFIG }
  $grantSchema = $schemas[0]
  Info "grants 파일의 DB 이름은 하드코딩입니다 — 'ON $grantSchema.<표>' 형태(파일 원문 기준)."

  $runFiles = @($appUserSql, $grantsSql)
  if($TargetDb -ne $grantSchema){
    Warn "대상이 '$TargetDb' 인데 두 SQL 은 '$grantSchema.' 를 박아 두었습니다 — 임시 사본에서 DB 이름만 바꿔 실행합니다(원본은 건드리지 않습니다)."
    Warn "  ★ 여기서 붙는 권한은 이 실행이 끝나도, 심지어 이 DB 를 지워도 계정에 남습니다."
    Warn "     MySQL 은 DROP DATABASE 로 표 단위 권한(mysql.tables_priv)을 지우지 않습니다."
    Warn "     -DropTarget 이 그 뒷정리까지 합니다. 수동으로 지웠다면 아래 REVOKE 를 직접 실행하세요."
    $runFiles = @()
    foreach($pair in @(@($appUserText,"restoreuser_"), @($grantsText,"restoregrants_"))){
      $rewritten = [regex]::Replace($pair[0], '(?i)(\sON\s+`?)' + [regex]::Escape($grantSchema) + '(`?\s*\.)', ('${1}' + $TargetDb + '${2}'))
      $tmp = Join-Path $env:TEMP ($pair[1] + [IO.Path]::GetRandomFileName() + ".sql")
      [IO.File]::WriteAllText($tmp, $rewritten, (New-Object System.Text.UTF8Encoding($false)))
      $script:tmpSql += $tmp
      $runFiles += $tmp
    }
  }

  $appExists = ([int](Q1 "SELECT COUNT(*) FROM mysql.user WHERE user='$appUser' AND host='$appHost';") -gt 0)
  if(-not $appExists){
    Warn "앱 계정 '$appUser'@'$appHost' 이 없습니다. create-app-user.sql 이 만들지만 비밀번호는 파일에 적힌 자리표시자입니다."
    Warn "  배포본과 같은 비밀번호로 바꾸지 않으면 앱은 ERROR 1045(접근 거부)로 죽습니다 — 1142 와 증상이 다릅니다."
  }

  foreach($f in $runFiles){
    Info "적용: $(Split-Path $f -Leaf) → $TargetDb"
    cmd /c "`"$mysql`" `"--defaults-extra-file=$adminCnf`" --default-character-set=utf8mb4 `"$TargetDb`" < `"$f`""
    if($LASTEXITCODE -ne 0){
      Bad "권한 적용에 실패했습니다($(Split-Path $f -Leaf)). 위 mysql 오류를 읽으세요."
      Write-Host "  1410 = 계정이 없습니다 → create-app-user.sql 을 먼저 돌리세요." -ForegroundColor Red
      Write-Host "  1146 = 그 표가 복구본에 없습니다. ★ 이건 대개 '덤프가 grants 파일보다 낡았다' 는 뜻입니다 —" -ForegroundColor Red
      Write-Host "         grants-calendar.sql 은 **지금** 스키마를 전제로 GRANT 를 나열하고, 없는 표에 GRANT 하면" -ForegroundColor Red
      Write-Host "         그 줄에서 배치가 멈춥니다(그 파일이 일부러 그렇게 만들어져 있습니다)." -ForegroundColor Red
      Write-Host "         조치: 복구본에 db/deploy/migrate-*.sql 을 순서대로 적용해 스키마를 현재로 올린 뒤 다시 -Grants." -ForegroundColor Red
      Write-Host "  ※ 여기까지 성공한 GRANT 는 이미 계정에 붙어 있습니다. 리허설이었다면 -DropTarget 으로 회수하세요." -ForegroundColor Red
      Die "권한 적용 중단 — 대상 DB '$TargetDb' 는 원인 확인용으로 남깁니다." $EXIT_CONN
    }
  }
  # ★ 세 번째 정본 — 비공개 05-grants.sql(app_user 의 SELECT/INSERT/UPDATE/DELETE).
  #   위 두 파일과 달리 DB 이름 치환이 없다: 그 파일의 GRANT 는 DATABASE() 를 쓴다.
  $userGrants = FindUserGrants
  if($userGrants){
    Info "적용: $(Split-Path $userGrants -Leaf) -> $TargetDb   (비공개 05-grants.sql — app_user 쓰기 권한)"
    cmd /c "`"$mysql`" `"--defaults-extra-file=$adminCnf`" --default-character-set=utf8mb4 `"$TargetDb`" < `"$userGrants`""
    if($LASTEXITCODE -ne 0){
      Bad "05-grants.sql 적용에 실패했습니다. 위 mysql 오류를 읽으세요."
      Die "권한 적용 중단 — 대상 DB '$TargetDb' 는 원인 확인용으로 남깁니다." $EXIT_CONN
    }
  } else {
    Write-Host ""
    foreach($l in ((UserGrantsWarnText) -split "`r?`n")){ Warn $l }
    WriteUserGrantsHowto
    Write-Host ""
  }

  Ok "계정·권한 재적용 완료 (복구방법.txt 4번)"

  if($TargetDb -ne $grantSchema){
    $gt = QLines "SELECT DISTINCT TABLE_NAME FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE LIKE '%$appUser%' AND TABLE_SCHEMA='$TargetDb' ORDER BY TABLE_NAME;"
    foreach($t in @($gt)){ $revokeHint += "REVOKE ALL PRIVILEGES ON ``$TargetDb``.``$t`` FROM '$appUser'@'$appHost';" }
    if($revokeHint.Count -gt 0){
      $revokeHint += "FLUSH PRIVILEGES;"
      Write-Host ""
      Write-Host "    ---- '$TargetDb' 권한을 되돌리는 문장 (리허설이었다면 그대로 실행 / -DropTarget 이 자동으로 합니다) ----" -ForegroundColor Yellow
      foreach($l in $revokeHint){ Write-Host "    $l" -ForegroundColor Yellow }
      Write-Host ""
    }
  }
} else {
  Warn "-Grants 를 주지 않았습니다 — 계정·권한은 재적용되지 않습니다."
  Warn "  덤프에는 계정도 권한도 들어 있지 않습니다(복구방법.txt 4번). 표와 데이터가 다 있어도"
  Warn "  앱은 첫 조회에서 죽습니다 — ERROR 1044(그 DB 권한이 0줄) 또는 1142(그 표 권한만 없음)."
  Warn "  아래 스모크가 그것을 실제로 확인합니다."
  Warn "  ★ -Grants 를 주더라도 app_user 권한(taskmgr-company-data\05-grants.sql)은 비공개 저장소에 있습니다 — 8단계 ★."
}

# ============================================================================
#  9) ★ 검증 — 이 스크립트의 존재 이유.
#     '명령이 안 죽었다' 와 '복구되었다' 는 다른 말이다. 아래를 전부 대조한다.
# ============================================================================
Write-Host ""
Write-Host "---- 검증 ----"
$fail = @()
$unknown = @()
function Row($state, $label, $detail){
  $tag = switch($state){ "ok" { "[OK ]" } "bad" { "[X  ]" } "unk" { "[? ]" } default { "[   ]" } }
  $col = switch($state){ "ok" { "Green" } "bad" { "Red" } "unk" { "Yellow" } default { "Gray" } }
  Write-Host ("  {0} {1,-22} {2}" -f $tag, $label, $detail) -ForegroundColor $col
}

$gotTables = @(TableNames $TargetDb)
$gotViews  = @(ViewNames  $TargetDb)
$gotTrigs  = @(TrigNames  $TargetDb)
$gotRtns   = @(RtnNames   $TargetDb)
$gotRows   = RowCounts $TargetDb $gotTables
$gotTotal  = 0; foreach($k in $gotRows.Keys){ $gotTotal += $gotRows[$k] }

# 9-1..9-4) 이름 집합 대조. ★ 개수만 세지 않는다 — 개수는 같고 이름이 다를 수 있다.
function CheckNames($label, $expect, $actual){
  if(-not $liveExists){
    Row "unk" $label "검증 못 함 — 라이브 '$LiveDb' 가 없어 대조 기준이 없습니다 (복구본 $($actual.Count)개)"
    $script:unknown += $label
    return
  }
  $d = NameSetDiff $expect $actual
  if($d.Missing.Count -eq 0 -and $d.Extra.Count -eq 0){
    Row "ok" $label "이름 집합 동일 ($($actual.Count)개)"
  } else {
    $msg = "라이브 $($expect.Count) / 복구본 $($actual.Count)"
    if($d.Missing.Count -gt 0){ $msg += " · 복구본에 없음: $($d.Missing -join ', ')" }
    if($d.Extra.Count -gt 0){   $msg += " · 라이브에 없음: $($d.Extra -join ', ')" }
    Row "bad" $label $msg
    $script:fail += "$label — $msg"
  }
}
CheckNames "base table 이름"  $liveTables $gotTables
CheckNames "뷰 이름"          $liveViews  $gotViews
CheckNames "트리거 이름"      $liveTrigs  $gotTrigs
CheckNames "루틴 이름"        $liveRtns   $gotRtns
if($liveExists){ Row "ok" "루틴 개수" "라이브 $($liveRtns.Count) / 복구본 $($gotRtns.Count)" }

# 9-5) 표별 행 수 — 전 표 순회. 다른 표는 이름과 양쪽 수치를 찍는다.
if(-not $liveExists){
  Row "unk" "표별 행 수" "검증 못 함 — 대조 기준이 없습니다 (복구본 합 $gotTotal 행)"
  $unknown += "표별 행 수"
} else {
  $diffs = @()
  $names = @(@($liveTables) + @($gotTables) | Sort-Object -Unique)
  foreach($t in $names){
    $lv = if($liveRows.ContainsKey($t)){ $liveRows[$t] } else { $null }
    $gv = if($gotRows.ContainsKey($t)){  $gotRows[$t]  } else { $null }
    if($lv -ne $gv){ $diffs += [pscustomobject]@{ Table = $t; Live = $lv; Restored = $gv } }
  }
  $liveTotal2 = 0; foreach($k in $liveRows.Keys){ $liveTotal2 += $liveRows[$k] }
  if($diffs.Count -eq 0){
    Row "ok" "표별 행 수" "$($liveTables.Count)표 전수 일치 (합 $liveTotal2 행)"
  } else {
    $st = if($AllowRowDiff){ "unk" } else { "bad" }
    Row $st "표별 행 수" "$($diffs.Count)표가 다릅니다 (라이브 합 $liveTotal2 / 복구본 합 $gotTotal)"
    Write-Host ("      {0,-24} {1,10} {2,10} {3,10}" -f "표", "라이브", "복구본", "차이")
    foreach($d in $diffs){
      $lv = if($null -eq $d.Live){ "-" } else { "$($d.Live)" }
      $gv = if($null -eq $d.Restored){ "-" } else { "$($d.Restored)" }
      $df = if($null -eq $d.Live -or $null -eq $d.Restored){ "-" } else { "$($d.Restored - $d.Live)" }
      Write-Host ("      {0,-24} {1,10} {2,10} {3,10}" -f $d.Table, $lv, $gv, $df)
    }
    if($AllowRowDiff){
      Warn "  -AllowRowDiff — 행 수 차이를 경고로 낮췄습니다. **스키마(이름 집합)는 그대로 엄격합니다.**"
      Warn "  옛 스냅샷을 복구할 때만 쓰세요. 최신 덤프를 복구했는데 행 수가 다르면 그건 결손입니다."
      $unknown += "표별 행 수(-AllowRowDiff 로 판정 유보)"
    } else {
      $fail += "표별 행 수 — $($diffs.Count)표 불일치"
    }
  }
}

# 9-6) 덤프 마감 표시 — 디스크가 차거나 프로세스가 끊기면 이 줄이 없다.
$tailOk = $false
try{
  $sr2 = New-Object IO.StreamReader($dumpItem.FullName, (New-Object System.Text.UTF8Encoding($false)))
  while($null -ne ($line = $sr2.ReadLine())){ if($line.StartsWith("-- Dump completed")){ $tailOk = $true } }
  $sr2.Close()
} catch { }
if($tailOk){ Row "ok" "덤프 마감 표시" "'-- Dump completed' 있음" }
else{
  Row "bad" "덤프 마감 표시" "'-- Dump completed' 가 없습니다 — 중간에 끊긴 덤프일 수 있습니다"
  $fail += "덤프 마감 표시 없음"
}

# ============================================================================
#  9-7) ★★ 애플리케이션 수준 스모크 — 표·행이 다 있어도 권한이 없으면 앱은 죽는다.
#
#     widget/CalendarDb.cs 의 부팅 경로가 실제로 던지는 조회를 그대로 쓴다:
#       · ReadPreambleSql                                       (§3.6 접속 프리앰블)
#       · SELECT v FROM cal_schema_meta WHERE k='schema_version' (§5.5 판본 확인)
#       · SELECT user_id FROM app_user WHERE login_id=?          (공개 API 1)
#       · SELECT rev FROM cal_user_rev WHERE user_id=?           (§3.5 스냅샷 판본)
#       · SELECT uid, name, color FROM cal_category …            (부팅 조회 1/10)
#       · cal_entry LEFT JOIN cal_category …                     (부팅 조회 2/10)
#     이게 통과해야 '복구되었다' 고 말할 수 있다. 복구방법.txt 4번의 실측 사례가 여기 대응한다.
# ============================================================================
$smokeUser = ""
$smokePw   = ""
$smokeCnf  = ""
if($NoSmoke){
  Row "unk" "앱 스모크 조회" "검증 못 함 — -NoSmoke 로 건너뛰었습니다"
  $unknown += "앱 스모크 조회(-NoSmoke)"
} else {
  if($AppCnfPath){
    #  ★ 존재 확인은 맨 앞 인자 검증 구역에 있다(2026-09-11 R3) — 여기서 죽으면 이미 DROP·복구 뒤다.
    $smokeCnf = $AppCnfPath
    $smokeUser = "(-AppCnfPath)"
  } else {
    #  ★ 직접 준 -DeployConfigPath 는 맨 앞에서 이미 확인됐다. 여기 Test-Path 가 걸러 내는 것은
    #    **기본 위치에 파일이 없는 PC** 뿐이고, 그건 설정 오류가 아니라 '검증 못 함' 이다(아래 Row "unk").
    if(-not $DeployConfigPath){ $DeployConfigPath = Join-Path (Split-Path -Parent (Split-Path -Parent $scriptDir)) "widget\DeployConfig.cs" }
    if(Test-Path -LiteralPath $DeployConfigPath){
      $dc = [IO.File]::ReadAllText($DeployConfigPath)
      $mu = [regex]::Match($dc, 'const\s+string\s+DbUser\s*=\s*"([^"]*)"')
      $mp = [regex]::Match($dc, 'const\s+string\s+DbPassword\s*=\s*"([^"]*)"')
      if($mu.Success -and $mp.Success){
        $smokeUser = $mu.Groups[1].Value
        $smokePw   = $mp.Groups[1].Value
        $script:tmpApp = NewCnf "mysrestoreapp_" $smokeUser $smokePw
        $smokeCnf = $script:tmpApp
        Info "스모크 계정: $smokeUser (widget/DeployConfig.cs 에서 읽음 — 배포본이 실제로 쓰는 값)"
      }
    }
  }
  if(-not $smokeCnf){
    # ★ 판정 불가는 통과가 아니다. 자격을 못 구했으면 '검증 못 함' 으로 남긴다.
    Row "unk" "앱 스모크 조회" "검증 못 함 — 앱 계정 자격을 못 구했습니다($DeployConfigPath). -AppCnfPath 로 주세요"
    $unknown += "앱 스모크 조회(자격 없음)"
  } else {
    $probeLogin = Q1 "SELECT login_id FROM ``$TargetDb``.app_user ORDER BY user_id LIMIT 1;"
    if(-not $probeLogin){ $probeLogin = "__restore_smoke__" }   # 행이 없어도 권한 판정에는 지장이 없다
    $probeLoginEsc = $probeLogin -replace "'","''"
    $smokeSqls = @(
      @("프리앰블",       "SET SESSION innodb_lock_wait_timeout=5, SESSION time_zone='+00:00', SESSION transaction_isolation='REPEATABLE-READ';"),
      @("cal_schema_meta","SELECT v FROM cal_schema_meta WHERE k='schema_version';"),
      @("app_user",       "SELECT user_id FROM app_user WHERE login_id='$probeLoginEsc';"),
      @("cal_user_rev",   "SELECT rev FROM cal_user_rev WHERE user_id=(SELECT user_id FROM app_user WHERE login_id='$probeLoginEsc');"),
      @("cal_category",   "SELECT uid, name, color FROM cal_category WHERE user_id=(SELECT user_id FROM app_user WHERE login_id='$probeLoginEsc') ORDER BY sort_order;"),
      @("cal_entry",      "SELECT e.entry_no, e.uid, cc.uid FROM cal_entry e LEFT JOIN cal_category cc ON cc.user_id = e.user_id AND cc.cat_no = e.cat_no WHERE e.user_id=(SELECT user_id FROM app_user WHERE login_id='$probeLoginEsc') ORDER BY e.sort_order, e.uid;")
    )
    # ★ stderr 를 PowerShell 로 받지 않는다. PS 5.1 은 네이티브 exe 의 stderr 를 줄마다
    #   ErrorRecord 로 감싸서(NativeCommandError) 'ERROR 1142' 한 줄이 스택 트레이스 대여섯 줄로
    #   불어난다 — 실측. 진단에 필요한 것은 MySQL 이 낸 그 한 줄이므로 cmd 로 파일에 받아 읽는다.
    $errFile = Join-Path $env:TEMP ("mysrestoreerr_" + [IO.Path]::GetRandomFileName() + ".txt")
    $script:tmpSql += $errFile
    $smokeBad = @()
    foreach($s in $smokeSqls){
      $sqlFile = Join-Path $env:TEMP ("mysrestoresmoke_" + [IO.Path]::GetRandomFileName() + ".sql")
      $script:tmpSql += $sqlFile
      [IO.File]::WriteAllText($sqlFile, $s[1], (New-Object System.Text.UTF8Encoding($false)))
      cmd /c "`"$mysql`" `"--defaults-extra-file=$smokeCnf`" --default-character-set=utf8mb4 -N -B `"$TargetDb`" < `"$sqlFile`" > NUL 2> `"$errFile`""
      $rc = $LASTEXITCODE
      $one = ""
      # ★ "" + 로 감싼다 — 0바이트 파일에서 Get-Content -Raw 가 빈 배열을 돌려주면
      #   -replace 결과도 배열이 되어 .Trim() 이 없다는 오류가 난다(실측 2026-09-07).
      if(Test-Path $errFile){ $one = (("" + (Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue)) -replace '\s+',' ').Trim() }
      if($rc -ne 0){
        if(-not $one){ $one = "mysql exit=$rc (메시지 없음)" }
        $smokeBad += "$($s[0]): $one"
        Write-Host "      · $($s[0]) → $one" -ForegroundColor Red
      } else {
        Write-Host "      · $($s[0]) → OK" -ForegroundColor DarkGray
      }
    }
    if($smokeBad.Count -eq 0){
      Row "ok" "앱 스모크 조회" "$smokeUser 로 부팅 조회 $($smokeSqls.Count)건 전부 성공 (login_id='$probeLogin')"
    } else {
      Row "bad" "앱 스모크 조회" "$($smokeBad.Count)/$($smokeSqls.Count) 건 실패 — 표와 행이 다 있어도 앱은 이 상태로 죽습니다"
      # ★ 오류 번호가 셋으로 갈린다. 복구방법.txt 4번은 1142 만 적었지만 실측하면 상황마다 다르다.
      #   1044 = 그 DB 에 대한 권한이 **한 줄도** 없다(복구 대상 DB 이름이 배포 GRANT 와 다를 때).
      #   1142 = DB 에는 붙지만 그 **표**에 권한이 없다(표가 늘었는데 GRANT 를 안 준 때).
      #   1045 = 계정 자체가 없거나 비밀번호가 배포본과 다르다(create-app-user.sql 의 자리표시자).
      #   셋 다 원인은 하나다 — 덤프에는 계정도 권한도 들어 있지 않다.
      Write-Host "      1044/1142 = 권한 결손 → -Grants 로 다시 실행하세요(복구방법.txt 4번)." -ForegroundColor Red
      Write-Host "      1045      = 계정이 없거나 비밀번호가 배포본과 다릅니다(create-app-user.sql 의 자리표시자를 바꾸세요)." -ForegroundColor Red
      $fail += "앱 스모크 조회 — $($smokeBad -join ' | ')"
    }
  }
}

# ============================================================================
#  판정 — ★ '검증 못 함' 을 통과로 처리하지 않는다(판정 불가 != 통과).
# ============================================================================
Write-Host ""
if($fail.Count -gt 0){
  Bad "검증 실패 — 이 복구본은 그대로 쓸 수 없습니다. 대상 DB '$TargetDb' 는 남깁니다."
  foreach($p in $fail){ Write-Host "   · $p" -ForegroundColor Red }
  if($DropTarget){
    # ★ -DropTarget 이 있어도 실패한 복구본은 지우지 않는다. 원인을 볼 자료가 사라지기 때문이다.
    #   대신 손으로 지울 때 빠뜨리기 쉬운 것(표 단위 권한)을 같이 알려 준다.
    Warn "-DropTarget 이 있지만 지우지 않았습니다 — 실패한 복구본은 원인 자료입니다."
    Warn "  다 봤으면 같은 명령을 성공하는 덤프로 한 번 더 돌리거나, 손으로 지울 때 권한도 함께 회수하세요:"
    Warn "    DROP DATABASE ``$TargetDb``;  그리고 mysql.tables_priv 의 Db='$TargetDb' 줄 REVOKE"
    Warn "    (DROP DATABASE 는 표 단위 권한을 지우지 않습니다 — 같은 이름의 DB 가 생기면 되살아납니다)"
  }
  AddLog "FAIL`t$($dumpItem.Name)`t$TargetDb`t$($gotTables.Count)`t$gotTotal`t$($took)s`t$($fail -join ' | ')"
  Cleanup
  exit $EXIT_FAIL
}
if($unknown.Count -gt 0){
  Warn "검증 못 함 — 아래 항목은 판정하지 않았습니다. 이것은 통과가 아닙니다(코드 $EXIT_NOBASELINE)."
  foreach($p in $unknown){ Write-Host "   · $p" -ForegroundColor Yellow }
  Write-Host "   ※ 라이브가 죽어 있는 진짜 재해 상황이라면 대조 기준 자체가 없습니다. 그 사실을 숨기지 않습니다."
  AddLog "UNKNOWN`t$($dumpItem.Name)`t$TargetDb`t$($gotTables.Count)`t$gotTotal`t$($took)s`t$($unknown -join ' | ')"
  if(-not $DropTarget){ Cleanup; exit $EXIT_NOBASELINE }
} else {
  Ok "검증 통과 — 표 $($gotTables.Count) · 뷰 $($gotViews.Count) · 트리거 $($gotTrigs.Count) · 루틴 $($gotRtns.Count) · 합 $gotTotal 행 · $($took)초"
  AddLog "OK`t$($dumpItem.Name)`t$TargetDb`t$($gotTables.Count)`t$gotTotal`t$($took)s`t-"
}
Info "복구 DB: $TargetDb  (로그: $($script:logPath))"

# ============================================================================
#  10) -DropTarget — 리허설 뒷정리
#      DROP DATABASE 는 표 단위 권한을 지우지 않는다. 남겨 두면 나중에 같은 이름의 DB 가
#      생겼을 때 되살아난다. 그래서 REVOKE 까지 하고 0행을 확인한다.
# ============================================================================
if($DropTarget){
  Write-Host ""
  Write-Host "---- 뒷정리 (-DropTarget) ----"
  if($TargetDb -eq $LiveDb){ Die "라이브 DB 를 지우려 했습니다. 여기까지 왔다면 가드가 깨진 것입니다." $EXIT_REFUSED }
  $leftover = @(QLines "SELECT DISTINCT TABLE_NAME FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE LIKE '%$appUser%' AND TABLE_SCHEMA='$TargetDb' ORDER BY TABLE_NAME;")
  if(-not (QExec "DROP DATABASE IF EXISTS ``$TargetDb``;")){ Die "DROP DATABASE 에 실패했습니다($TargetDb)." $EXIT_CONN }
  Ok "DROP DATABASE ``$TargetDb`` 완료"
  if($leftover.Count -gt 0){
    Info "DROP 뒤에도 남는 표 단위 권한 $($leftover.Count)건을 회수합니다(MySQL 은 DROP DATABASE 로 지우지 않습니다)."
    foreach($t in $leftover){
      if(-not (QExec "REVOKE ALL PRIVILEGES ON ``$TargetDb``.``$t`` FROM '$appUser'@'$appHost';")){ Warn "REVOKE 실패: $t" }
    }
    [void](QExec "FLUSH PRIVILEGES;")
  }
  $rest = [int](Q1 "SELECT COUNT(*) FROM mysql.tables_priv WHERE Db='$TargetDb';")
  $restDb = [int](Q1 "SELECT COUNT(*) FROM mysql.db WHERE Db='$TargetDb';")
  if($rest -eq 0 -and $restDb -eq 0){ Ok "잔여 권한 0행 확인 (mysql.tables_priv · mysql.db)" }
  else{
    Bad "잔여 권한이 남았습니다 — tables_priv $rest 행 / db $restDb 행. 직접 REVOKE 하세요."
    AddLog "FAIL`t-`t$TargetDb`t-`t-`t-`t뒷정리 후 잔여 권한 tables_priv=$rest db=$restDb"
    Cleanup
    exit $EXIT_FAIL
  }
  AddLog "DROP`t-`t$TargetDb`t-`t-`t-`t리허설 뒷정리 완료(권한 회수 $($leftover.Count)건)"
  if($unknown.Count -gt 0){ Cleanup; exit $EXIT_NOBASELINE }
}

Cleanup
exit $EXIT_OK
