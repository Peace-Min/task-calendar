<#
  org-ops.ps1 — 조직 변경을 '손으로 못 쓰게' 만드는 도구. 보통은 org-ops.cmd 로 부른다.

  ┌ 왜 이 도구가 있나 ────────────────────────────────────────────────────────────┐
  │ 2026-08-24 조직 소속을 **번호 하나로 완전 절단**했다(org_unit.parent 과          │
  │ app_user.org_unit 이름 컬럼은 없다). 그 덕에 개명은 1문장이 됐고, '같은 사실을   │
  │ 두 곳에 적어 둔' 데서 나오던 결함 부류는 통째로 사라졌다. 그런데 **DB 가 여전히  │
  │ 지켜 주지 못하는 것**이 남는다:                                                 │
  │  · fk_org_parent_id 는 '부모가 실재하는가' 만 본다 — '루트에서 닿는가(트리인가)' │
  │    는 보지 않는다. 손 UPDATE 두 줄이면 두 조직이 서로를 부모로 가리키는 **섬**   │
  │    이 만들어지고, 그 산하 인원이 상위 조직의 열람 범위에서 통째로 빠진다.        │
  │    에러도 경고도 나지 않는다(실측: 조직 12개 중 도달불가 2 · 19명이 범위 밖).    │
  │  · UNIQUE 는 ai_ci·NO PAD 라 'SW 1팀' 과 'SW 1팀 '(뒤 공백)을 다른 이름으로      │
  │    나란히 받아들인다. 사람 눈에는 같아 보인다.                                  │
  │  · is_active 는 그냥 값이라 '숨긴 부모 밑에 살아 있는 자식' 을 막지 않는다 —     │
  │    조직도는 숨긴 조직을 목록에서 빼므로 그 자식들이 최상위로 튀어 오른다.        │
  │ ★ 자기참조 테이블이라 트리거로도 막을 수 없다(ERROR 1442). 사후 게이트(apply.ps1)│
  │   는 '운영자가 다시 apply 를 돌릴 때까지' 아무 일도 하지 않는다. 그래서 변경     │
  │   자체를 감싸는 도구가 유일한 근본 대책이다.                                    │
  └───────────────────────────────────────────────────────────────────────────────┘

  ┌ 명령 ─────────────────────────────────────────────────────────────────────────┐
  │ show                                     조직 트리를 본다(읽기 전용, 쓰기 없음)│
  │ rename -Id <org_id> -Name <새이름>       개명 — UPDATE 1문장                   │
  │ add    -Name <이름> -ParentId <부모> [-SortOrder n]   신설                     │
  │ move   -Id <org_id> -ParentId <새부모>   이관                                  │
  │ assign -LoginId <id> -OrgId <조직>       인사이동                              │
  │ repair                                   고칠 수 있는 것을 고친다(아래 참조)    │
  │ repair -DeactivateOrphanedChildren        위에 더해, 숨긴 조직 밑에 살아 있는  │
  │                                           조직을 그 아래 전부와 함께 숨긴다    │
  │ 공통:  -WhatIf   아무것도 쓰지 않고 무엇이 바뀔지만 보여준다                    │
  │        -Force    확인 프롬프트를 건너뛴다(무인 실행)                            │
  └───────────────────────────────────────────────────────────────────────────────┘

  하는 일(모든 쓰기 명령이 똑같이): ① 실행 전 상태와 사전 불변식을 찍고 ② 무엇이 바뀌는지
  말하고 확인받고(-Force 면 생략) ③ **한 덩어리 트랜잭션**에서 쓰고 ④ COMMIT 앞에서 불변식을
  검사해 어긋나면 ROLLBACK 하고 ⑤ 성공하면 결과를 다시 찍는다.

  ★ 불변식 — 여섯 개다(전부 '작을수록 좋다', 목표 0). 정의는 $SQL_INVARIANTS 에 있다.
      roots         parent_id IS NULL 인 조직 수 — 정확히 1. (CTO 한 명의 unit_tree 로 전
                    직원을 덮는 구조라, 루트가 둘이면 그 순간 절반이 열람 범위 밖으로 나간다)
      unreachable   루트에서 닿지 못하는 조직 수 — 순환·자기부모·섬을 한 번에 잡는다.
                    루트가 1개라는 것만으로는 트리가 아니다. 이것이 트리임을 보장하는 유일한 식.
                    ※ 재귀 상한 512 는 '순환 탐지'가 아니라 '폭주 방지'다(순환은 애초에 루트에서
                      도달 불가). 얕으면 정상 트리를 오판한다 — 실측: 71단에서 옛 값 64 가 7 오탐.
                      apply.ps1 · 02-seed-org.sql · org-ops.sql · migrate-*.sql 이 같은 512 를 쓴다.
      name_bad      이름 표기 위반 — 앞뒤 공백(ASCII) · 전각 영숫자 · **눈에 보이지 않는
                    공백/제어문자 전부**(전각 공백 U+3000 · NBSP · 탭·줄바꿈 등 U+0000-001F ·
                    U+0085 · U+1680 · U+2000-200B · U+2028·U+2029 · U+202F · U+205F · U+FEFF).
                    비교는 BINARY 다(ai_ci 로 보면 이 차이가 통째로 안 보인다 — 표기 검사는
                    콜레이션 밖에서). ※ MySQL TRIM 은 ASCII 0x20 만 뗀다 — 그래서 나머지
                    공백류는 전부 @fw_ban 정규식이 본다(그 목록이 곧 .NET Trim() 이 떼는
                    문자 집합이라, Assert-OrgName 과 이 식의 판정이 같아진다).
      orphan        parent_id · app_user.org_id 가 없는 조직을 가리키는 수. FK 가 강제하므로
                    정상 DB 에서는 늘 0 — 제약이 빠진 채 이관된 DB 를 알아보려고 그래도 센다.
      inactive_cut  숨긴(is_active=0) 조직 밑에 살아 있는 **조직** 수.
      member_hidden 숨긴(is_active=0) 조직에 소속된 살아 있는 **사람** 수.
                    ★ 왜 따로 세나 — inactive_cut 은 조직만 센다. 그래서 '자식 조직까지 전부
                      숨겨서' inactive_cut 을 0 으로 만들면, 그 안의 사람은 그대로 살아 있는데
                      조직도(is_active=1 로 긁는다)에서 통째로 사라진다. 실측: 본부 하나를 숨기고
                      repair -DeactivateOrphanedChildren 로 '정리'하자 inactive_cut 2→0 인데
                      CTO 열람 89 → 69명, 게이트 3종 전부 exit 0 이었다. 조직 수만 보는 눈은
                      사람이 사라지는 것을 못 본다.

  ★★ 판정 규칙 — '이 명령이 어떤 불변식도 **악화시키지 않았는가**' (2026-08-24 F13 의 일반화)
     COMMIT 조건 둘: ① 의도한 변경이 실제로 일어났다(@a_outcome) ② 여섯 값 중 어느 하나도
     실행 전보다 커지지 않았다(기준선은 트랜잭션 맨 앞에서 잰다).
     · 깨끗한 DB(전부 0)에서는 '여전히 전부 0' 과 같은 뜻이다 — 보장이 약해지지 않는다.
     · 이미 깨진 DB 에서는 고치는 방향의 명령을 허용한다. 예전 규칙('실행 후 전부 0')은
       순환이 있는 DB 에서 그것을 푸는 move 조차 롤백시켜 탈출구를 손 SQL 로 몰았다(F13).

  ★★★ 실행 전부터 **경성** 불변식(roots·unreachable·name_bad·orphan)이 깨져 있으면
     rename·add·assign 은 시작조차 하지 않는다(코드 6) — 깨진 트리를 고치지도 못하면서
     상태만 헷갈리게 만든다. 반면 move·repair·show 는 언제나 허용한다(유일한 탈출구):
     루트/순환→move · 이름 표기→repair · 숨긴 부모 밑 자식→move 또는
     repair -DeactivateOrphanedChildren. inactive_cut·member_hidden 은 애초에 차단 사유가
     아니다(경고만) — 전면 차단으로 두면 그것을 푸는 명령(move·assign)까지 잠긴다.

  ⚠️ -WhatIf 의 유일한 부작용: `add` 를 -WhatIf 로 돌리면 InnoDB 의 AUTO_INCREMENT 카운터가
     1 올라간다(롤백해도 안 돌아온다 — MySQL 의 설계. 실측). **데이터는 한 행도 바뀌지 않는다**
     (실행 전후 지문 대조로 증명한다). org_id 는 의미 없는 대리키라 번호가 비어도 무해하다.

  ⚠️ 비밀번호를 명령줄 인자로 받지 않는다 — Windows 는 같은 사용자 권한이면 다른 프로세스의
     명령줄을 읽을 수 있다(backup-taskmgr.ps1 과 같은 결정). 자격은 환경변수나 대화형 입력으로만.
       $env:TC_OPS_DB_ADMIN_PW   = '<DB 관리자 비번>'   ← 필수(없으면 콘솔에서 물어본다)
       $env:TC_OPS_DB_ADMIN_USER = 'root'               ← 선택(기본 root)
     ※ 시험용 루프테스트의 TC_TEST_DB_ADMIN_PW 와 **일부러 이름을 나눴다** — 시험 자격이
       운영 DB 로 흘러드는 사고를 막는다.

  ⚠️ 쓰는 표는 org_unit 과 app_user 둘뿐이다. 캘린더(cal_*)·과제(project 등)에는 한 문장도
     보내지 않는다. DDL 도 한 문장 없다(트랜잭션이 암묵 커밋으로 깨지지 않게).

  ┌ 종료코드 (org-ops.cmd 의 표와 반드시 일치) ───────────────────────────────────┐
  │ 0  성공 — COMMIT 됐다. (-WhatIf 로 검사까지 통과한 경우도 0: 쓰지 않았다)      │
  │ 1  실패 — ROLLBACK 됐다. DB 는 실행 전과 같다. 무엇이 어긋났는지 화면에 있다.  │
  │ 2  아무것도 시도하지 않았다 — 인자·자격증명 문제, 선행조건 위반(없는 조직/     │
  │    사람), 또는 확인에서 취소. 1 과 나누는 이유: 1 은 '보냈으나 되돌렸다',      │
  │    2 는 '보내지도 않았다' — 사람이 할 일이 다르다.                             │
  │ 3  접속·권한 문제.   4  mysql.exe 를 못 찾았다.                                │
  │ 5  대상 스키마가 절단 전 — org_id/parent_id 가 없거나 이름 미러가 남아 있다.   │
  │ 6  실행 전부터 **경성** 불변식 위반 — 아무것도 시도하지 않았다.                │
  │    (move·repair·show 는 이 코드로 막지 않는다 — 그것들이 탈출구다)             │
  │ 9  ★ 롤백 검증 실패 — 실패했는데 DB 지문이 바뀌었다. 있어서는 안 되는 상태다.  │
  │ 7·8 결번. 종료코드는 호출자와의 계약이라 값의 뜻을 바꾸거나 재사용하지 않는다. │
  └───────────────────────────────────────────────────────────────────────────────┘

  예)  org-ops.cmd show
       org-ops.cmd rename -Id 2 -Name "SW연구본부" -WhatIf
       org-ops.cmd add    -Name "SW 5팀" -ParentId 2
       org-ops.cmd move   -Id 10 -ParentId 3
       org-ops.cmd assign -LoginId hjlee -OrgId 7
       org-ops.cmd repair -DeactivateOrphanedChildren -WhatIf
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = "",

  # 명령별 인자 — 미지정 표식은 0(org_id 는 1부터라 0 은 '안 줌'과 같다)
  [int]$Id = 0,
  [string]$Name = "",
  [int]$ParentId = 0,
  [int]$SortOrder = [int]::MinValue,   # 미지정 표식. 0 은 '진짜 0' 이라 쓸 수 없다
  [string]$LoginId = "",
  [int]$OrgId = 0,

  [switch]$WhatIf,                     # 아무것도 쓰지 않고 무엇이 바뀔지만 본다
  [switch]$Force,                      # 확인 프롬프트 건너뛰기(무인 실행)

  # repair 전용. '숨긴 조직 밑에 살아 있는 조직' 을 그 아래 전부와 함께 숨긴다.
  #  ★ 왜 기본값이 아니라 **명시 스위치**인가: 조직을 사라지게 하는 결정이고, 다른 선택지
  #    (자식을 살아 있는 부모로 move)가 더 나은 경우가 많으므로 사람이 고르게 한다.
  [switch]$DeactivateOrphanedChildren,

  [string]$DbHost = "127.0.0.1",
  [int]$Port = 3306,
  [string]$DbName = "taskmgr",
  [string]$BaseDir = "C:\mysql",       # mysql.exe 위치(없으면 서비스 binPath 추론)
  [string]$ServiceName = "MySQL84",
  [string]$DbUser = ""                 # 비우면 TC_OPS_DB_ADMIN_USER, 그것도 없으면 root
)

$ErrorActionPreference = "Continue"    # 네이티브 stderr 가 창을 닫지 않게(Stop 금지)

# ============================================================================
#  화면 출력 · 종료
# ============================================================================
function Info($m) { Write-Host "[*] $m" }
function Ok($m)   { Write-Host "[OK] $m"   -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m"    -ForegroundColor Yellow }
function Bad($m)  { Write-Host "[실패] $m" -ForegroundColor Red }

$script:cnfPath = $null
$script:tmpIn   = $null
$script:tmpOut  = $null

function Cleanup() {
  # ★ .cnf 에는 평문 비밀번호가 들어 있다. 어느 경로로 죽든 반드시 지운다.
  foreach ($v in 'cnfPath', 'tmpIn', 'tmpOut') {
    $p = Get-Variable -Name $v -Scope script -ValueOnly -ErrorAction SilentlyContinue
    if ($p) { Remove-Item $p -Force -ErrorAction SilentlyContinue; Set-Variable -Name $v -Scope script -Value $null }
  }
}
function Die($m, $code) {
  Bad $m
  Cleanup
  exit $code
}

# ============================================================================
#  인자 검증 — 인자가 뒤엉킨 채로 '조용히 운영 DB' 를 대상으로 진행하는 것을 막는다.
#  값이 역슬래시로 끝나는 따옴표 인자를 주면 powershell.exe 파서가 \" 를 이스케이프로 읽어
#  뒤 인자를 통째로 삼키고, -DbName 이 소리 없이 기본값 taskmgr(운영 DB)로 되돌아간다.
#  $DbName 은 아래에서 SQL·명령줄에 그대로 들어가므로 여기 통과가 곧 그 자리의 안전 조건이다.
# ============================================================================
function AssertNoSwallow($label, $val) {
  if ("$val" -match '"') { Die "$label 값에 따옴표가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태입니다 — 경로 끝의 역슬래시를 빼고 다시 실행하세요." 2 }
  if ("$val" -match '\s-(Id|Name|ParentId|SortOrder|LoginId|OrgId|WhatIf|Force|DeactivateOrphanedChildren|DbHost|Port|DbName|BaseDir|ServiceName|DbUser)\b') {
    Die "$label 값 안에 다른 인자가 들어 있습니다: [$val]. 인자가 뒤엉킨 상태라 대상 DB 가 의도와 다릅니다 — 경로 끝의 역슬래시를 빼고 다시 실행하세요." 2
  }
}
AssertNoSwallow "-BaseDir"     $BaseDir
AssertNoSwallow "-DbName"      $DbName
AssertNoSwallow "-DbUser"      $DbUser
AssertNoSwallow "-DbHost"      $DbHost
AssertNoSwallow "-ServiceName" $ServiceName
if ($DbName -notmatch '^[A-Za-z0-9_$]+$') { Die "-DbName 이 식별자 형식이 아닙니다: [$DbName]." 2 }
if ($DbHost -notmatch '^[A-Za-z0-9_.:-]+$') { Die "-DbHost 형식이 이상합니다: [$DbHost]." 2 }
if ($Port -lt 1 -or $Port -gt 65535) { Die "-Port 범위가 아닙니다: $Port" 2 }

$VALID = @('show', 'rename', 'add', 'move', 'assign', 'repair')
$cmd = "$Command".Trim().ToLowerInvariant()
if (-not $cmd) {
  Write-Host ""
  Write-Host "사용법:  org-ops.cmd <명령> [인자]" -ForegroundColor Cyan
  Write-Host "  show                                   조직 트리 보기(읽기 전용)"
  Write-Host "  rename -Id <org_id> -Name <새이름>     개명"
  Write-Host "  add    -Name <이름> -ParentId <부모> [-SortOrder n]   신설"
  Write-Host "  move   -Id <org_id> -ParentId <새부모> 이관"
  Write-Host "  assign -LoginId <id> -OrgId <조직>     인사이동"
  Write-Host "  repair                                 이름 표기 정규화(앞뒤 공백 제거)"
  Write-Host "  repair -DeactivateOrphanedChildren     위에 더해, 숨긴 조직 밑에 살아 있는"
  Write-Host "                                         조직을 그 아래 전부와 함께 숨긴다"
  Write-Host ""
  Write-Host "  -WhatIf  아무것도 쓰지 않고 무엇이 바뀔지만 본다"
  Write-Host "  -Force   확인 프롬프트를 건너뛴다(무인 실행)"
  Write-Host ""
  Write-Host "  사전:  `$env:TC_OPS_DB_ADMIN_PW = '<DB 관리자 비번>'   (계정 기본값 root)"
  Write-Host ""
  exit 2
}
if ($VALID -notcontains $cmd) { Die "모르는 명령입니다: [$Command]. 가능한 명령: $($VALID -join ', ')" 2 }

# ---- 조직 이름 검증 --------------------------------------------------------
#  왜 앞뒤 공백을 거부하나: utf8mb4_0900_ai_ci 는 NO PAD 라 'SW 1팀 ' 과 'SW 1팀' 이
#  **다른 이름**으로 들어간다(실측: 등호 비교 0). 사람 눈에는 같아 보이므로, 나중에
#  아무도 원인을 못 찾는 종류의 사고가 된다. 입구에서 막는다.
#  ※ 전각 영숫자·눈에 보이지 않는 공백류도 같은 이유로 막는다 — 불변식 name_bad 와 같은 기준이다.
#  ★★ $ORG_NAME_BAN 은 SQL 쪽 @fw_ban 과 **글자 단위로 같은 집합**이어야 한다.
#    어긋나면 두 도구가 같은 입력에 **정반대 판정**을 낸다 — 실측된 결함이다:
#    이름 앞에 전각 공백(U+3000)을 붙이면 org-ops.sql 은 커밋했고(MySQL TRIM 은
#    ASCII 0x20 만 둔다) 이 스크립트는 거부했다(.NET Trim() 은 유니코드 공백을 전부 둔다).
#    그래서 이젠 두 쪽 다 '이 집합' 하나로만 판정한다.
#  ※ 집합의 근거: .NET Char.IsWhiteSpace 가 참인 문자 전부(= .NET Trim() 이 떼는 것)
#    + 제어문자 U+0000-001F + 폭 없는 문자(U+200B ZWSP · U+FEFF BOM) + 전각 영숫자.
#    ASCII 0x20 만은 빠져 있다 — 이름 안에서는 정상이고('SW 1팀'), 앞뒤에 붙는 경우는
#    바로 아래 Trim 비교가 잡는다.
$ORG_NAME_BAN = '[\x00-\x1F\u0085\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]'
function Assert-OrgName($label, $v) {
  if ([string]::IsNullOrEmpty($v)) { Die "$label 이 비었습니다." 2 }
  if ($v -ne $v.Trim()) { Die "$label 의 앞뒤에 공백이 있습니다: [$v]. 조직명 콜레이션이 NO PAD 라 공백이 이름의 일부가 됩니다 — 공백을 빼고 다시 실행하세요." 2 }
  if ($v -match '[\x00-\x1F]') { Die "$label 에 제어문자(탭·줄바꿈 등)가 들어 있습니다." 2 }
  if ($v -match $ORG_NAME_BAN) { Die "$label 에 전각 영숫자 또는 **눈에 보이지 않는 공백·제어문자**가 들어 있습니다: [$v]. 전각 공백(U+3000) · NBSP · 탭 · ZWSP · BOM 등은 화면에서 구별되지 않으면서 다른 이름이 됩니다 — 반각 공백과 반각 영숫자로 고쳐 주세요." 2 }
  if ($v.Length -gt 50) { Die "$label 이 50자를 넘습니다($($v.Length)자) — org_unit.name 은 VARCHAR(50) 입니다." 2 }
}
function Assert-LoginId($v) {
  if ([string]::IsNullOrEmpty($v)) { Die "-LoginId 가 비었습니다." 2 }
  if ($v -ne $v.Trim()) { Die "-LoginId 앞뒤에 공백이 있습니다: [$v]." 2 }
  if ($v -match '[\x00-\x1F]') { Die "-LoginId 에 제어문자가 들어 있습니다." 2 }
  if ($v.Length -gt 50) { Die "-LoginId 가 50자를 넘습니다 — app_user.login_id 는 VARCHAR(50) 입니다." 2 }
}
function Assert-Ref($label, $v) {
  if ($v -le 0) { Die "$label 가 없습니다(또는 0). 조직 번호는 1 이상입니다 — `org-ops.cmd show` 로 번호를 확인하세요." 2 }
  if ($v -gt 65535) { Die "$label 가 범위를 넘습니다: $v — org_id 는 SMALLINT UNSIGNED 입니다." 2 }
}

switch ($cmd) {
  'rename' { Assert-Ref "-Id" $Id;            Assert-OrgName "-Name" $Name }
  'add'    { Assert-OrgName "-Name" $Name;    Assert-Ref "-ParentId" $ParentId
             if ($SortOrder -ne [int]::MinValue -and ($SortOrder -lt -2147483647 -or $SortOrder -gt 2147483647)) { Die "-SortOrder 범위가 아닙니다." 2 } }
  'move'   { Assert-Ref "-Id" $Id;            Assert-Ref "-ParentId" $ParentId
             if ($Id -eq $ParentId) { Die "자기 자신을 부모로 지정했습니다(-Id $Id -ParentId $ParentId) — 그 조직과 산하 전부가 트리에서 떨어져 나갑니다." 2 } }
  'assign' { Assert-LoginId $LoginId;         Assert-Ref "-OrgId" $OrgId }
}
# -DeactivateOrphanedChildren 는 repair 에서만 뜻이 있다. 다른 명령에 붙었다면 사람이
# 무언가를 오해한 것이므로, 조용히 무시하지 않고 말해 준다(무시하면 '먹혔다'고 믿게 된다).
if ($DeactivateOrphanedChildren -and $cmd -ne 'repair') {
  Die "-DeactivateOrphanedChildren 는 repair 에서만 쓸 수 있습니다(지금 명령: $cmd). 숨긴 조직 밑의 자식을 정리하려면  org-ops.cmd repair -DeactivateOrphanedChildren -WhatIf  로 먼저 보세요." 2
}

# ============================================================================
#  mysql.exe 찾기 (init-calendar.ps1 과 같은 방식: -BaseDir → 서비스 binPath 추론)
# ============================================================================
$mysql = Join-Path $BaseDir "bin\mysql.exe"
if (-not (Test-Path $mysql)) {
  try {
    $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    if ($svc -and $svc.PathName -match '"?([A-Za-z]:[^"]*)\\bin\\mysqld\.exe') {
      $cand = Join-Path $Matches[1] "bin\mysql.exe"; if (Test-Path $cand) { $mysql = $cand }
    }
  } catch {}
}
if (-not (Test-Path $mysql)) {
  # 마지막 수단 — 흔한 설치 경로 몇 개
  foreach ($c in @("C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe",
                   "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe")) {
    if (Test-Path $c) { $mysql = $c; break }
  }
}
if (-not (Test-Path $mysql)) { Die "mysql.exe 를 못 찾았습니다. -BaseDir 로 설치 경로를 지정하세요(예: -BaseDir `"C:\Program Files\MySQL\MySQL Server 8.4`")." 4 }

# ============================================================================
#  자격증명 — 환경변수 우선, 없으면 콘솔에서 물어본다. 명령줄로는 절대 받지 않는다.
# ============================================================================
if (-not $DbUser) { $DbUser = $env:TC_OPS_DB_ADMIN_USER }
if (-not $DbUser) { $DbUser = "root" }
if ($DbUser -notmatch '^[A-Za-z0-9_.$-]+$') { Die "DB 계정명 형식이 이상합니다: [$DbUser]." 2 }

$dbPw = $env:TC_OPS_DB_ADMIN_PW
if (-not $dbPw) {
  # ★ stdin 이 리다이렉트된 무인 실행에서 Read-Host 를 부르면 콘솔을 기다리며 멈춘다
  #   (init-calendar.ps1 이 같은 자리에서 겪은 실측 사고). 즉시 진단하고 죽는다.
  if ([Console]::IsInputRedirected) {
    Die "자격증명이 없습니다. 무인 실행에서는 환경변수로만 받습니다:  `$env:TC_OPS_DB_ADMIN_PW = '<DB 관리자 비번>'" 2
  }
  $s = Read-Host "MySQL $DbUser 비밀번호" -AsSecureString
  $dbPw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
if (-not $dbPw) { Die "비밀번호가 비어 있습니다. `$env:TC_OPS_DB_ADMIN_PW 를 설정하세요." 2 }

# 옵션파일 — 비밀번호가 명령줄에 남지 않게. BOM 없는 UTF-8 로 쓴다(BOM 은 [client] 앞에
# 섞여 들어가 파싱을 깨뜨린다). finally/Cleanup 에서 반드시 지운다.
$pwEsc = ($dbPw -replace '\\', '\\') -replace '"', '\"'
$script:cnfPath = Join-Path $env:TEMP ("orgops_" + [IO.Path]::GetRandomFileName() + ".cnf")
$cnfText = "[client]`r`nuser=$DbUser`r`npassword=""$pwEsc""`r`nhost=$DbHost`r`nport=$Port`r`n"
[IO.File]::WriteAllText($script:cnfPath, $cnfText, (New-Object System.Text.UTF8Encoding($false)))
$dbPw = $null; $pwEsc = $null   # 메모리에 오래 두지 않는다

# ============================================================================
#  SQL 실행기 — 한글은 절대 argv 로 넘기지 않는다. -e "…한글…" 은 Windows ANSI 코드페이지
#  변환에서 깨진다(이 저장소가 과거에 이 실수로 오판한 전례). SQL 은 BOM 없는 UTF-8 임시
#  파일에 써서 stdin 으로 먹이고, 결과도 파일로 받아 UTF-8 로 읽는다.
# ============================================================================
function Invoke-Sql {
  param([string]$Sql, [switch]$NoHeaders)
  $script:tmpIn  = Join-Path $env:TEMP ("orgops_" + [IO.Path]::GetRandomFileName() + ".sql")
  $script:tmpOut = Join-Path $env:TEMP ("orgops_" + [IO.Path]::GetRandomFileName() + ".txt")
  [IO.File]::WriteAllText($script:tmpIn, $Sql, (New-Object System.Text.UTF8Encoding($false)))
  $opt = "-B"
  if ($NoHeaders) { $opt = "-B -N" }
  cmd /c "`"$mysql`" --defaults-extra-file=`"$($script:cnfPath)`" --default-character-set=utf8mb4 $opt `"$DbName`" < `"$($script:tmpIn)`" > `"$($script:tmpOut)`" 2>&1"
  $rc = $LASTEXITCODE
  $txt = ""
  if (Test-Path $script:tmpOut) { $txt = "" + (Get-Content $script:tmpOut -Raw -Encoding UTF8) }
  Remove-Item $script:tmpIn, $script:tmpOut -Force -ErrorAction SilentlyContinue
  $script:tmpIn = $null; $script:tmpOut = $null
  return [pscustomobject]@{ Code = $rc; Text = $txt }
}

# 한 값만 돌려주는 조회. 숫자를 기대하는 자리에서 오류 문자열이 조용히 통과하는 것을 막는다
# (apply.ps1 의 QNum 이 같은 이유로 존재한다 — ERROR 1054 가 '위반 발견' 으로 보고된 전례).
function Get-Scalar($sql, $what) {
  $r = Invoke-Sql -Sql $sql -NoHeaders
  if ($r.Code -ne 0) { Die "$what 조회 실패:`r`n$($r.Text)" 3 }
  return ("" + $r.Text).Trim()
}
function Get-Num($sql, $what) {
  $v = Get-Scalar $sql $what
  if ($v -notmatch '^-?\d+$') { Die "$what 조회가 숫자를 돌려주지 않았습니다: $v" 3 }
  return [int]$v
}

# ============================================================================
#  표 출력 — 한글 폭(2칸)을 세어 자리를 맞춘다. 표가 어긋나면 '사람이 보고 확인' 이 어렵다.
# ============================================================================
function Get-DisplayWidth([string]$s) {
  $w = 0
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if (($c -ge 0x1100 -and $c -le 0x115F) -or ($c -ge 0x2E80 -and $c -le 0xA4CF) -or
        ($c -ge 0xAC00 -and $c -le 0xD7A3) -or ($c -ge 0xF900 -and $c -le 0xFAFF) -or
        ($c -ge 0xFE30 -and $c -le 0xFE6F) -or ($c -ge 0xFF00 -and $c -le 0xFF60) -or
        ($c -ge 0xFFE0 -and $c -le 0xFFE6)) { $w += 2 } else { $w += 1 }
  }
  return $w
}
function Show-Table($headers, $rows, $indent) {
  if (-not $indent) { $indent = "   " }
  $n = $headers.Count
  $wid = New-Object int[] $n
  for ($i = 0; $i -lt $n; $i++) { $wid[$i] = Get-DisplayWidth ([string]$headers[$i]) }
  foreach ($r in $rows) {
    for ($i = 0; $i -lt $n; $i++) {
      $c = ""; if ($i -lt $r.Count) { $c = [string]$r[$i] }
      $w = Get-DisplayWidth $c; if ($w -gt $wid[$i]) { $wid[$i] = $w }
    }
  }
  $pad = {
    param($s, $w)
    $s = [string]$s
    $s + (" " * [Math]::Max(0, $w - (Get-DisplayWidth $s)))
  }
  $line = $indent + (($(for ($i = 0; $i -lt $n; $i++) { & $pad $headers[$i] $wid[$i] }) -join "  "))
  Write-Host $line -ForegroundColor Cyan
  Write-Host ($indent + (($(for ($i = 0; $i -lt $n; $i++) { "-" * $wid[$i] }) -join "  ")))
  foreach ($r in $rows) {
    $cells = for ($i = 0; $i -lt $n; $i++) { $c = ""; if ($i -lt $r.Count) { $c = [string]$r[$i] }; & $pad $c $wid[$i] }
    Write-Host ($indent + ($cells -join "  "))
  }
}

# `##ROW|a|b|c` 형태의 줄만 골라 셀 배열로 바꾼다. mysql -B 는 여러 결과집합을 구분 없이
#  이어 붙여 찍으므로, 어느 줄이 어느 표인지는 줄 자체에 표식이 있어야 알 수 있다.
function Select-Marked($text, $marker) {
  $out = @()
  foreach ($ln in ($text -split "`r?`n")) {
    if ($ln.StartsWith("$marker|")) { $out += , ($ln.Substring($marker.Length + 1) -split '\|') }
  }
  return , $out
}

# ============================================================================
#  SQL 조각 — 여러 명령이 공유한다
# ============================================================================

# 조직 트리 한 장. 부모 이름은 **저장된 값이 아니라 조인 결과**다(미러가 없다).
$SQL_TREE = @'
SELECT CONCAT_WS('|', '##ROW',
         o.org_id, o.name, IFNULL(o.parent_id, '·'), IFNULL(p.name, '·'),
         o.sort_order,
         IF(o.is_active = 1, '활성', '숨김'),
         (SELECT COUNT(*) FROM org_unit c WHERE c.parent_id = o.org_id),
         (SELECT COUNT(*) FROM app_user u WHERE u.org_id = o.org_id)
       ) AS `__row`
  FROM org_unit o LEFT JOIN org_unit p ON p.org_id = o.parent_id
 ORDER BY o.org_id;
'@
$TREE_HEAD = @('org_id', '조직명', 'parent_id', '부모(조인)', 'sort', '상태', '자식', '인원')

# 불변식 계산 — 값만 세션 변수에 담는다(출력은 호출부가 한다).
#  ★ 다섯 개뿐이다. 미러가 없으므로 '두 값이 같은가' 를 보는 검사는 하나도 없다.
$SQL_INVARIANTS = @'
--  이름 표기 금지 패턴 — 전각 영숫자와 **눈에 보이지 않는 공백·제어문자 전부**.
--  16진 바이트로 조립하는 이유: 이 파일이 어떤 인코딩 사고를 겪어도 패턴만은 ASCII 로
--  남아 뜻이 바뀌지 않는다(정규식 escape 는 못 쓴다 — mysql 클라이언트가 역슬래시를 먼저 먹는다, 실측).
--  ★ MySQL TRIM 은 ASCII 0x20 **하나만** 둔다. 그래서 전각 공백(U+3000)·탭·NBSP 는
--    앞뒤에 붙어 있어도 TRIM 비교가 못 잡는다 — 그 구멍을 이 정규식이 메운다(위치 무관 검사).
--  ★★ 이 집합은 org-ops.ps1 $ORG_NAME_BAN · org-ops.sql · migrate · rollback · apply.ps1 ·
--    02-seed-org.sql 이 **글자까지 같은 것**을 써야 한다. 갈리면 판정이 갈린다.
SET @fw_ban := CONCAT('[',
       CONVERT(0x00     USING utf8mb4), '-', CONVERT(0x1F     USING utf8mb4),  -- 제어문자 U+0000-001F (탭·줄바꿈 포함)
       CONVERT(0xC285   USING utf8mb4),                                        -- U+0085 NEL
       CONVERT(0xC2A0   USING utf8mb4),                                        -- U+00A0 NBSP
       CONVERT(0xE19A80 USING utf8mb4),                                        -- U+1680 OGHAM SPACE MARK
       CONVERT(0xE28080 USING utf8mb4), '-', CONVERT(0xE2808B USING utf8mb4),  -- U+2000-200A 각종 공백 + U+200B ZWSP
       CONVERT(0xE280A8 USING utf8mb4),      CONVERT(0xE280A9 USING utf8mb4),  -- U+2028 · U+2029 줄/문단 구분
       CONVERT(0xE280AF USING utf8mb4),      CONVERT(0xE2819F USING utf8mb4),  -- U+202F · U+205F
       CONVERT(0xE38080 USING utf8mb4),                                        -- ★ U+3000 전각 공백 (한글 IME 로 가장 쉽게 들어온다)
       CONVERT(0xEFBBBF USING utf8mb4),                                        -- U+FEFF BOM/ZWNBSP
       CONVERT(0xEFBC90 USING utf8mb4), '-', CONVERT(0xEFBC99 USING utf8mb4),  -- ０-９
       CONVERT(0xEFBCA1 USING utf8mb4), '-', CONVERT(0xEFBCBA USING utf8mb4),  -- Ａ-Ｚ
       CONVERT(0xEFBD81 USING utf8mb4), '-', CONVERT(0xEFBD9A USING utf8mb4),  -- ａ-ｚ
       ']');

SET @v_roots := (SELECT COUNT(*) FROM org_unit WHERE parent_id IS NULL);
--  '1 에서 얼마나 떨어졌나'. 2개 → 3개 도 악화로 세려면 개수 자체를 봐야 한다.
SET @v_root_bad := ABS(@v_roots - 1);

--  ★ 깊이 상한 512 는 '순환 탐지'가 아니라 '폭주 방지'다 — 머리말 ★ 참조.
WITH RECURSIVE tree AS (
    SELECT org_id, 0 AS depth FROM org_unit WHERE parent_id IS NULL
    UNION ALL
    SELECT o.org_id, t.depth + 1
      FROM org_unit o JOIN tree t ON o.parent_id = t.org_id
     WHERE t.depth < 512
) SELECT COUNT(*) INTO @n_reach FROM tree;
SET @v_unreachable := (SELECT COUNT(*) FROM org_unit) - @n_reach;

SET @v_name_bad := (SELECT COUNT(*) FROM org_unit
                     WHERE CAST(name AS BINARY) <> CAST(TRIM(name) AS BINARY)
                        OR name REGEXP @fw_ban);

--  FK 가 강제하는 값이라 정상 DB 에서는 늘 0 이다. 제약이 빠진 채 이관된 DB 를 알아본다.
SET @v_orphan := (
    (SELECT COUNT(*) FROM org_unit c LEFT JOIN org_unit p ON p.org_id = c.parent_id
      WHERE c.parent_id IS NOT NULL AND p.org_id IS NULL)
  + (SELECT COUNT(*) FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id
      WHERE u.org_id IS NOT NULL AND o.org_id IS NULL));

SET @v_inactive_parent := (
  SELECT COUNT(*) FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id
   WHERE c.is_active = 1 AND p.is_active = 0);

--  ★ 여섯 번째 — 숨긴 조직에 소속된 **살아 있는 사람** 수.
--    inactive_cut 은 조직만 센다. 그래서 '자식 조직까지 전부 숨겨' inactive_cut 을 0 으로
--    만들면 그 안의 사람은 그대로 살아 있는데 조직도(is_active=1 로 긁는다)에서 통째로
--    사라진다. 실측: 본부 하나를 숨기고 repair -DeactivateOrphanedChildren 로 '정리'하자
--    inactive_cut 2→0 인데 CTO 열람 89 → 69명, 게이트 3종 전부 exit 0 이었다.
--    조직 수만 보는 눈은 사람이 사라지는 것을 못 본다.
SET @v_member_hidden := (
  SELECT COUNT(*) FROM app_user u JOIN org_unit o ON o.org_id = u.org_id
   WHERE u.is_active = 1 AND o.is_active = 0);

--  경성(hard) 합계 — 사전점검에서 rename/add/assign 을 막는 사유(머리말 ★★★).
--  inactive_cut·member_hidden 은 여기 들어가지 않는다: 전면 차단으로 두면 그것을 푸는
--  명령(move·assign)까지 잠긴다(F13). 대신 '악화 금지' 판정과 명령별 선행조건이 막는다.
SET @v_hard_bad := @v_root_bad + @v_unreachable + @v_name_bad + @v_orphan;
'@

# 불변식을 사람이 읽는 표로. `##INV|이름|값|기대|키`
#  ★ 네 번째 칸(키)은 화면에 찍히지 않는다 — Show-Table 은 $INV_HEAD 의 칸 수(3)만 그린다.
#    호출부가 '어느 줄이 어느 불변식인가'를 한글 라벨로 알아보지 않게 하려고 붙였다
#    (라벨은 언제든 다듬을 수 있는 문구고, 키는 계약이다).
$SQL_INV_REPORT = @'
SELECT CONCAT_WS('|', '##INV', '루트 수',                  @v_roots,           '1', 'roots') AS `__row`
UNION ALL SELECT CONCAT_WS('|', '##INV', '도달불가(순환 포함)',    @v_unreachable,     '0', 'unreachable')
UNION ALL SELECT CONCAT_WS('|', '##INV', '이름 표기 위반',         @v_name_bad,        '0', 'name_bad')
UNION ALL SELECT CONCAT_WS('|', '##INV', '고아(부모·소속)',        @v_orphan,          '0', 'orphan')
UNION ALL SELECT CONCAT_WS('|', '##INV', '비활성 부모의 활성 자식', @v_inactive_parent, '0', 'inactive_cut')
UNION ALL SELECT CONCAT_WS('|', '##INV', '숨긴 조직의 재직 인원',   @v_member_hidden,   '0', 'member_hidden');
'@
$INV_HEAD = @('불변식', '값', '기대')
# 사전점검에서 '쓰기 차단' 사유가 **아닌** 불변식(머리말 ★★★). 악화만 막는다.
$INV_SOFT_KEYS = @('inactive_cut', 'member_hidden')
# 깨져 있어도 실행을 허용하는 명령 — 이것들이 탈출구다(move 로 트리를 고치고 repair 로 표기를 고친다).
$ESCAPE_CMDS = @('show', 'move', 'repair')

# 지문 — '아무것도 안 썼다' 를 증명하는 값. 관련 컬럼을 한 줄로 이어 붙여 SHA-256 을 낸다.
# updated_at 까지 넣어야 '정말 아무 일도 없었다' 가 된다. app_user 정렬을 login_id 로 잡는
# 이유: user_id 는 별도 마이그레이션(user-id) 이후에만 있다.
$SQL_FINGERPRINT = @'
SET SESSION group_concat_max_len = 1048576;
SELECT SHA2(CONCAT_WS('||',
  IFNULL((SELECT GROUP_CONCAT(CONCAT_WS(':', org_id, name, IFNULL(parent_id,'~'),
                                        sort_order, is_active, updated_at)
                 ORDER BY org_id SEPARATOR ',') FROM org_unit), '-'),
  IFNULL((SELECT GROUP_CONCAT(CONCAT_WS(':', login_id, IFNULL(org_id,'~'), is_active, updated_at)
                 ORDER BY login_id SEPARATOR ',') FROM app_user), '-'), '-')
, 256) AS fp;
'@

# ============================================================================
#  선행 확인 — 접속 · 스키마가 '번호만' 인가
# ============================================================================
Write-Host ""
Write-Host "==========================================================="
Write-Host "  조직 변경 도구 — $cmd   (대상 $DbUser@$DbHost/$DbName)"
Write-Host "==========================================================="

$one = Invoke-Sql -Sql "SELECT 1;" -NoHeaders
if ($one.Code -ne 0 -or ("" + $one.Text).Trim() -ne "1") {
  Die "$DbUser 로 접속하지 못했습니다(포트 $Port). 비번·서버·방화벽을 확인하세요.`r`n$($one.Text)" 3
}

# 절단 후 스키마인가 — 없는 컬럼을 참조하는 순간 이 스크립트의 모든 문장이 ERROR 1054 로
# 죽는다. 그때 화면에 남는 것은 SQL 에러뿐이라 무엇을 해야 하는지 알 수 없다. 먼저 말한다.
$colSql = @"
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='org_unit' AND COLUMN_NAME='org_id')
+ (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='org_unit' AND COLUMN_NAME='parent_id')
+ (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='app_user' AND COLUMN_NAME='org_id');
"@
$nCols = Get-Num $colSql "번호 컬럼 3종 실재"
if ($nCols -ne 3) {
  Die "이 DB 는 조직 대리키(org_id) 전환 전 스키마입니다(있는 컬럼 $nCols/3). db/deploy/migrate-2026-08-24-org-id.sql 을 먼저 적용하세요." 5
}
# 이름 미러가 남아 있으면 절단이 덜 끝난 것이다. 이 도구는 그 컬럼을 쓰지 않으므로,
# 그대로 두면 아무도 갱신하지 않는 낡은 이름이 표에 남아 그걸 읽는 쪽이 틀린 트리를 그린다.
$nMirror = Get-Num @"
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME='org_unit' AND COLUMN_NAME='parent')
     OR (TABLE_NAME='app_user' AND COLUMN_NAME='org_unit'));
"@ "이름 미러 컬럼 잔존"
if ($nMirror -ne 0) {
  Die "이 DB 에는 이름 미러 컬럼이 $nMirror 개 남아 있습니다(org_unit.parent / app_user.org_unit) — 조직 절단 마이그레이션이 덜 끝났습니다. 이 도구는 그 컬럼을 쓰지 않으므로, 두면 낡은 이름이 표에 남습니다. db/deploy/migrate-2026-08-24-org-id.sql 을 끝까지 적용하세요." 5
}

# ============================================================================
#  1) 실행 전 현재 상태
# ============================================================================
Write-Host ""
Write-Host "[1] 실행 전 상태" -ForegroundColor White
$before = Invoke-Sql -Sql ($SQL_TREE + "`r`n" + $SQL_INVARIANTS + "`r`n" + $SQL_INV_REPORT) -NoHeaders
if ($before.Code -ne 0) { Die "현재 상태를 읽지 못했습니다:`r`n$($before.Text)" 3 }
$beforeRows = Select-Marked $before.Text '##ROW'
$beforeInv  = Select-Marked $before.Text '##INV'
if ($beforeRows.Count -eq 0) { Die "org_unit 이 비었거나 읽지 못했습니다:`r`n$($before.Text)" 3 }
Show-Table $TREE_HEAD $beforeRows
Write-Host ""
Show-Table $INV_HEAD $beforeInv

#  ★ 사전점검 — 깨진 상태에서 '고칠 수 없는' 명령만 막는다(머리말 ★★★).
#    · 경성 위반 + rename/add/assign → 코드 6 으로 아무것도 시도하지 않는다.
#    · 경성 위반 + move/repair/show  → 경고만 하고 진행한다. 그것들이 유일한 탈출구이고,
#      COMMIT 앞의 '악화 금지' 판정이 어차피 나빠지는 것을 막는다.
#    · inactive_cut 은 애초에 차단 사유가 아니다(F13) — 경고와 두 가지 탈출구를 제시한다.
$dirty     = @($beforeInv | Where-Object { $_[1] -ne $_[2] })
$dirtyHard = @($dirty | Where-Object { $_.Count -lt 4 -or $INV_SOFT_KEYS -notcontains $_[3] })
$dirtySoft = @($dirty | Where-Object { $_.Count -ge 4 -and $INV_SOFT_KEYS -contains $_[3] })
if ($dirtyHard.Count -gt 0) {
  Write-Host ""
  Warn "이 DB 는 **실행 전부터** 불변식을 어기고 있습니다:"
  foreach ($d in $dirtyHard) { Write-Host ("     · " + $d[0] + " = " + $d[1] + " (기대 " + $d[2] + ")") -ForegroundColor Yellow }
  if ($ESCAPE_CMDS -notcontains $cmd) {
    Write-Host ""
    Write-Host "   먼저 고치세요 — 무엇이 깨졌느냐에 따라 길이 다릅니다:" -ForegroundColor Yellow
    Write-Host "     · 루트 수 / 도달불가(순환·섬)  →  org-ops.cmd move -Id <조직> -ParentId <제대로 된 부모>" -ForegroundColor Yellow
    Write-Host "     · 이름 표기 위반               →  앞뒤 ASCII 공백이면  org-ops.cmd repair -WhatIf  로 보고  org-ops.cmd repair" -ForegroundColor Yellow
    Write-Host "                                      전각 영숫자·전각 공백(U+3000)·NBSP·제어문자는 repair 가 손대지 않습니다" -ForegroundColor Yellow
    Write-Host "                                      (뜻을 바꾸는 교정이라 사람이 정해야 합니다) —  org-ops.cmd rename -Id <조직> -Name <바른 이름>" -ForegroundColor Yellow
    Write-Host "     · 고아                         →  FK(fk_org_parent_id·fk_user_org_id)가 빠진 DB 입니다. 스키마부터 확인하세요." -ForegroundColor Yellow
    Die "깨진 상태 위에 이 명령을 쓰지 않습니다 — 아무것도 시도하지 않았습니다." 6
  }
  Write-Host ""
  Warn "$cmd 은(는) 이 상태를 고치는 쪽이므로 계속합니다(악화되면 COMMIT 앞에서 되돌립니다)."
}
if ($dirtySoft.Count -gt 0 -and $cmd -ne 'show') {
  Write-Host ""
  Warn "이 DB 에는 **숨김(is_active=0) 때문에 조직도에서 빠지는 것**이 있습니다(이 명령을 막지는 않습니다):"
  foreach ($d in $dirtySoft) { Write-Host ("     · " + $d[0] + " = " + $d[1] + " (기대 " + $d[2] + ")") -ForegroundColor Yellow }

  # ── (가) 숨긴 부모 밑의 살아 있는 조직 ─────────────────────────────────────
  # 무엇이 그 상태인지 이름까지 보여 준다 — 숫자만 주면 어느 행을 손봐야 할지 알 수 없다.
  $cutRows = Select-Marked (Invoke-Sql -Sql @'
SELECT CONCAT_WS('|','##ROW', c.org_id, c.name, p.org_id, p.name,
       (SELECT COUNT(*) FROM app_user u WHERE u.org_id = c.org_id)) AS `__row`
  FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id
 WHERE c.is_active = 1 AND p.is_active = 0
 ORDER BY c.org_id;
'@ -NoHeaders).Text '##ROW'
  if ($cutRows.Count -gt 0) {
    Write-Host ""
    Show-Table @('org_id', '살아 있는 자식', '부모 org_id', '숨긴 부모', '인원') $cutRows "     "
    Write-Host ""
    Write-Host "   조직도는 숨긴 조직을 목록에서 빼므로, 위 자식들은 최상위로 튀어 오르고" -ForegroundColor Yellow
    Write-Host "   상위 조직의 열람 범위에서 빠집니다. 해소하려면 **둘 중 하나**를 고르세요:" -ForegroundColor Yellow
    Write-Host "     ① 자식을 살아 있는 다른 부모 밑으로 옮긴다(조직은 그대로 보인다)" -ForegroundColor Yellow
    Write-Host "        org-ops.cmd move -Id <위 org_id> -ParentId <살아 있는 부모> -WhatIf" -ForegroundColor Yellow
    Write-Host "     ② 자식(과 그 아래 전부)도 함께 숨긴다(조직도에서 같이 사라진다)" -ForegroundColor Yellow
    Write-Host "        org-ops.cmd repair -DeactivateOrphanedChildren -WhatIf" -ForegroundColor Yellow
    Write-Host "        ※ 그 서브트리에 **재직자가 남아 있으면 이 명령은 거부됩니다** — 아래 (나) 참조." -ForegroundColor Yellow
    Write-Host "   (부모를 다시 살리는 길도 있지만 그건 조직 부활이라 이 도구의 명령이 아닙니다 —" -ForegroundColor Yellow
    Write-Host "    is_active 를 되돌리는 판단은 사람이 하고, 되살린 뒤 다시 이 도구로 확인하세요.)" -ForegroundColor Yellow
  }

  # ── (나) ★ 숨긴 조직에 남아 있는 재직자 ────────────────────────────────────
  #  조직 수만 세는 눈(inactive_cut)이 못 보던 것이다. 조직도는 is_active=1 로 긁으므로
  #  이 사람들은 살아 있는데도 화면에서 통째로 사라지고 상위 열람 범위에서 빠진다.
  $hidRows = Select-Marked (Invoke-Sql -Sql @'
SELECT CONCAT_WS('|','##ROW', o.org_id, o.name, IFNULL(p.name,'·'),
       (SELECT COUNT(*) FROM app_user u WHERE u.org_id = o.org_id AND u.is_active = 1)) AS `__row`
  FROM org_unit o LEFT JOIN org_unit p ON p.org_id = o.parent_id
 WHERE o.is_active = 0
   AND EXISTS (SELECT 1 FROM app_user u WHERE u.org_id = o.org_id AND u.is_active = 1)
 ORDER BY o.org_id;
'@ -NoHeaders).Text '##ROW'
  if ($hidRows.Count -gt 0) {
    Write-Host ""
    Show-Table @('org_id', '숨긴 조직', '부모', '남아 있는 재직자') $hidRows "     "
    Write-Host ""
    Write-Host "   위 조직은 숨겨져 있는데 소속 재직자가 남아 있습니다 — 그 사람들은 조직도에도," -ForegroundColor Yellow
    Write-Host "   상위 조직의 unit_tree 열람 범위에도 나오지 않습니다(에러도 경고도 없이)." -ForegroundColor Yellow
    Write-Host "   해소하려면 **셋 중 하나**를 고르세요:" -ForegroundColor Yellow
    Write-Host "     ① 사람을 살아 있는 조직으로 옮긴다   org-ops.cmd assign -LoginId <id> -OrgId <살아 있는 조직>" -ForegroundColor Yellow
    Write-Host "     ② 조직을 다시 살린다(조직 부활은 사람이 판단 — UPDATE org_unit SET is_active=1 WHERE org_id=?)" -ForegroundColor Yellow
    Write-Host "     ③ 그 사람들이 실제로 퇴사·휴직이면 app_user.is_active 를 0 으로(명단 소관 —" -ForegroundColor Yellow
    Write-Host "        taskmgr-company-data/03-seed-users.sql 을 고치고 apply.cmd -SkipSchema)" -ForegroundColor Yellow
  }
}

# 대상 행을 따로 보여 준다(트리 12행 속에서 눈으로 찾게 하지 않는다).
function Show-Focus($title, $sql, $head) {
  $r = Invoke-Sql -Sql $sql -NoHeaders
  if ($r.Code -ne 0) { Die "$title 조회 실패:`r`n$($r.Text)" 3 }
  $rows = Select-Marked $r.Text '##ROW'
  Write-Host ""
  Write-Host "   $title" -ForegroundColor White
  if ($rows.Count -eq 0) { Write-Host "     (해당 행 없음 — 번호/ID 를 확인하세요)" -ForegroundColor Yellow }
  else { Show-Table $head $rows "     " }
  return $rows.Count
}

# SQL 문자열 리터럴 escape. 한글은 파일이 UTF-8 이라 그대로 두면 되고,
# 위험한 것은 홑따옴표와 역슬래시뿐이다.
function Esc([string]$s) { return (($s -replace '\\', '\\') -replace "'", "''") }

$eName    = Esc $Name
$eLoginId = Esc $LoginId

# ============================================================================
#  2) 무엇이 바뀌나 — 요약 + 대상 행 + 확인
# ============================================================================
$summary = ""
$sqlMutation = ""
$sqlOutcome = ""

switch ($cmd) {

  'show' {
    Write-Host ""
    Ok "읽기 전용 — 아무것도 쓰지 않았습니다."
    Cleanup
    exit 0
  }

  'rename' {
    # ★ 여기만 '대상이 없으면 즉시 죽는' 선행검사를 두지 않는다(add/move/assign 은 둔다).
    #   ① rename 의 '대상 있음' 검사는 트랜잭션 안의 결과 단언(@a_outcome)과 같은 조건이라
    #      안 막아도 트랜잭션이 반드시 잡고 롤백한다(위 표에 '해당 행 없음' 이 이미 찍힌다).
    #   ② 그 단언은 검사와 쓰기 사이의 경합(TOCTOU)을 막는 마지막 그물인데, 선행검사가 모든
    #      경로를 걸러 버리면 그 그물이 한 번도 실행되지 않아 **검증할 수 없는 코드**가 된다.
    $null = Show-Focus "대상 조직(개명)" @"
SELECT CONCAT_WS('|','##ROW', o.org_id, o.name, IFNULL(p.name,'·'),
       (SELECT COUNT(*) FROM org_unit c WHERE c.parent_id = o.org_id),
       (SELECT COUNT(*) FROM app_user u WHERE u.org_id = o.org_id)) AS ``__row``
  FROM org_unit o LEFT JOIN org_unit p ON p.org_id = o.parent_id
 WHERE o.org_id = $Id;
"@ @('org_id', '현재 이름', '부모', '자식', '인원')
    $summary = "org_id=$Id 의 이름을 '$Name' 으로 바꾼다"
    # ★ **1문장이다.** 자식도 소속자도 이 조직을 번호로 가리키므로 따라 고칠 것이 없다.
    #   (미러가 있던 시절에는 여기가 두 문장이었고, 그 둘을 한 트랜잭션에 묶지 않으면
    #    그 찰나에 조회한 클라이언트가 끊어진 트리를 받았다. 그 부류가 통째로 사라졌다.)
    # ★ updated_at 은 일부러 자동 갱신되게 둔다 — 개명은 실제 변경이므로 '언제 바뀌었나'가 남아야 한다.
    $sqlMutation = @"
SET @id  := $Id;
SET @new := '$eName';
UPDATE org_unit SET name = @new WHERE org_id = @id;
SET @rc_main := ROW_COUNT();
"@
    # ★ ROW_COUNT() 가 아니라 **최종 상태**를 본다. 같은 이름으로 다시 rename 하면 바뀐 행이
    #   0 인데 그건 실패가 아니다(멱등). 반대로 대상이 없으면 최종 상태도 0 이라 잡힌다.
    $sqlOutcome = @"
SET @a_outcome := (SELECT COUNT(*) FROM org_unit
                    WHERE org_id = @id AND CAST(name AS BINARY) = CAST(@new AS BINARY));
"@
  }

  'add' {
    $n = Show-Focus "부모 조직(신설 대상의 상위)" @"
SELECT CONCAT_WS('|','##ROW', o.org_id, o.name, IF(o.is_active=1,'활성','숨김'), o.sort_order,
       (SELECT COUNT(*) FROM org_unit c WHERE c.parent_id = o.org_id)) AS ``__row``
  FROM org_unit o WHERE o.org_id = $ParentId;
"@ @('org_id', '부모 이름', '상태', 'sort', '현재 자식 수')
    if ($n -eq 0) { Die "-ParentId $ParentId 인 조직이 없습니다. `org-ops.cmd show` 로 번호를 확인하세요." 2 }
    # ★ 숨긴(is_active=0) 부모 밑에 새 조직을 만들면 그 순간 inactive_cut 이 하나 늘어난다.
    #   조직도는 숨긴 조직을 빼므로 새 조직은 태어나자마자 최상위로 튀어 오르고 상위 열람
    #   범위 밖이 된다 — assign 이 같은 이유로 막는 것과 같다.
    $pInact = Get-Num "SELECT COUNT(*) FROM org_unit WHERE org_id = $ParentId AND is_active = 0;" "부모 조직 비활성 여부"
    if ($pInact -ne 0) { Die "org_id=$ParentId 는 숨김(is_active=0) 조직입니다 — 그 밑에 새 조직을 만들면 조직도에서 부모가 없는 채로 최상위에 튀어 오르고, 상위 조직의 열람 범위에서 빠집니다. 살아 있는 조직 밑에 만들거나, 부모를 먼저 되살리세요." 2 }
    $soText = "형제 중 최대 sort_order + 1(자동)"
    $soExpr = "(SELECT COALESCE(MAX(c.sort_order), (SELECT sort_order FROM (SELECT org_id, sort_order FROM org_unit) x WHERE x.org_id = @pid)) + 1 FROM (SELECT parent_id, sort_order FROM org_unit) c WHERE c.parent_id = @pid)"
    if ($SortOrder -ne [int]::MinValue) { $soText = "$SortOrder(지정)"; $soExpr = "$SortOrder" }
    $summary = "'$Name' 을 org_id=$ParentId 아래에 신설한다 (sort_order = $soText)"
    # ★ 부모를 SELECT 로 확인하며 넣는 이유: 검사와 쓰기 사이에 부모가 사라져도(TOCTOU)
    #   FK 에러로 죽지 않고 0행 INSERT 가 되어, 아래 outcome 이 잡고 조용히 ROLLBACK 된다.
    $sqlMutation = @"
SET @pid := $ParentId;
SET @new := '$eName';
SET @so  := $soExpr;
INSERT INTO org_unit (name, parent_id, sort_order, is_active)
SELECT @new, p.org_id, @so, 1
  FROM (SELECT org_id FROM org_unit) p
 WHERE p.org_id = @pid;
SET @rc_main := ROW_COUNT();
SET @newid := LAST_INSERT_ID();
"@
    # ★ LAST_INSERT_ID() 는 0행 INSERT 뒤에도 **직전 값이 그대로 남는다**(실측).
    #   그래서 @rc_main = 1 을 함께 봐야 한다. 번호만 보면 없는 부모로 신설해도 통과한다.
    $sqlOutcome = @"
SET @a_outcome := IF(@rc_main = 1 AND (SELECT COUNT(*) FROM org_unit
                       WHERE org_id = @newid AND parent_id = @pid
                         AND CAST(name AS BINARY) = CAST(@new AS BINARY)) = 1, 1, 0);
"@
  }

  'move' {
    $n1 = Show-Focus "이관 대상" @"
SELECT CONCAT_WS('|','##ROW', o.org_id, o.name, IFNULL(p.name,'·'), IF(o.is_active=1,'활성','숨김'),
       (SELECT COUNT(*) FROM org_unit c WHERE c.parent_id = o.org_id),
       (SELECT COUNT(*) FROM app_user u WHERE u.org_id = o.org_id)) AS ``__row``
  FROM org_unit o LEFT JOIN org_unit p ON p.org_id = o.parent_id
 WHERE o.org_id = $Id;
"@ @('org_id', '조직명', '현재 부모', '상태', '자식', '인원')
    if ($n1 -eq 0) { Die "-Id $Id 인 조직이 없습니다." 2 }
    $n2 = Show-Focus "새 부모" @"
SELECT CONCAT_WS('|','##ROW', o.org_id, o.name, IF(o.is_active=1,'활성','숨김'),
       (SELECT COUNT(*) FROM org_unit c WHERE c.parent_id = o.org_id)) AS ``__row``
  FROM org_unit o WHERE o.org_id = $ParentId;
"@ @('org_id', '조직명', '상태', '현재 자식 수')
    if ($n2 -eq 0) { Die "-ParentId $ParentId 인 조직이 없습니다." 2 }
    # ★ 살아 있는 조직을 숨긴 부모 밑으로 옮기는 것만 막는다(F13). 반대 방향 — 숨긴 부모
    #   밑에 갇힌 자식을 **꺼내는** move — 은 탈출구 그 자체라 반드시 허용해야 한다.
    #   (숨긴 조직을 숨긴 부모 밑으로 옮기는 것은 더 나빠지지 않는다 — 조직도는 둘 다 안 본다.)
    $newParentInact = Get-Num "SELECT COUNT(*) FROM org_unit WHERE org_id = $ParentId AND is_active = 0;" "새 부모 비활성 여부"
    $selfActive     = Get-Num "SELECT COUNT(*) FROM org_unit WHERE org_id = $Id AND is_active = 1;" "이관 대상 활성 여부"
    if ($newParentInact -ne 0 -and $selfActive -ne 0) {
      Die "org_id=$ParentId 는 숨김(is_active=0) 조직입니다 — 살아 있는 org_id=$Id 를 그 밑에 두면 조직도에서 부모를 잃고 최상위로 튀어 오릅니다(상위 열람 범위에서 빠집니다). 살아 있는 부모를 지정하거나, 함께 숨길 생각이면  org-ops.cmd repair -DeactivateOrphanedChildren  을 쓰세요." 2 }
    # ★ 자기 자손 밑으로 옮기면 그 서브트리가 고리가 되어 루트에서 영영 닿지 않는다.
    #   불변식 unreachable 이 COMMIT 앞에서 잡아 롤백하지만, 그건 '되돌린 뒤에 알려 주는' 것이다.
    #   여기서 먼저 사람 말로 막아 두면 아무것도 보내지 않고 끝난다(코드 2).
    #   ※ 재귀 상한은 불변식과 같은 512.
    $descend = Get-Num @"
WITH RECURSIVE sub AS (
    SELECT org_id, 0 AS depth FROM org_unit WHERE org_id = $Id
    UNION ALL
    SELECT o.org_id, s.depth + 1 FROM org_unit o JOIN sub s ON o.parent_id = s.org_id
     WHERE s.depth < 512
) SELECT COUNT(*) FROM sub WHERE org_id = $ParentId;
"@ "새 부모가 자기 자손인가"
    if ($descend -ne 0) { Die "org_id=$ParentId 는 org_id=$Id 의 자손입니다 — 자기 자손 밑으로 옮기면 그 서브트리가 고리가 되어 루트에서 영영 닿지 않습니다(그 소속 인원이 상위 열람 범위에서 통째로 빠집니다)." 2 }
    $summary = "org_id=$Id 를 org_id=$ParentId 아래로 옮긴다"
    $sqlMutation = @"
SET @id  := $Id;
SET @pid := $ParentId;
UPDATE org_unit SET parent_id = @pid WHERE org_id = @id;
SET @rc_main := ROW_COUNT();
"@
    $sqlOutcome = @"
SET @a_outcome := (SELECT COUNT(*) FROM org_unit WHERE org_id = @id AND parent_id = @pid);
"@
  }

  'assign' {
    $n1 = Show-Focus "이동 대상(사람)" @"
SELECT CONCAT_WS('|','##ROW', u.login_id, u.name, IFNULL(o.name,'·'), IFNULL(u.org_id,'·'),
       u.view_scope, IF(u.is_active=1,'재직','비활성')) AS ``__row``
  FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id
 WHERE CAST(u.login_id AS BINARY) = CAST('$eLoginId' AS BINARY);
"@ @('login_id', '이름', '현재 소속', 'org_id', 'view_scope', '상태')
    if ($n1 -eq 0) { Die "-LoginId '$LoginId' 인 사용자가 없습니다(대소문자까지 정확히 맞춰야 합니다)." 2 }
    $n2 = Show-Focus "새 소속" @"
SELECT CONCAT_WS('|','##ROW', o.org_id, o.name, IF(o.is_active=1,'활성','숨김'),
       (SELECT COUNT(*) FROM app_user u WHERE u.org_id = o.org_id)) AS ``__row``
  FROM org_unit o WHERE o.org_id = $OrgId;
"@ @('org_id', '조직명', '상태', '현재 인원')
    if ($n2 -eq 0) { Die "-OrgId $OrgId 인 조직이 없습니다." 2 }
    # ★ 비활성 조직으로 보내는 것을 막는 이유: 조직도는 `WHERE is_active = 1` 로 읽힌다.
    #   숨긴 조직에 사람을 넣으면 그 사람이 조직도에서 사라지고 unit_tree 판정에서도 빠진다.
    $inact = Get-Num "SELECT COUNT(*) FROM org_unit WHERE org_id = $OrgId AND is_active = 0;" "새 소속 비활성 여부"
    if ($inact -ne 0) { Die "org_id=$OrgId 는 숨김(is_active=0) 조직입니다. 조직도는 숨긴 조직을 빼므로, 그 소속이 된 사람은 조직도에서 사라지고 unit_tree 열람 판정에서도 빠집니다. 조직을 먼저 활성화하거나 활성 조직으로 보내세요." 2 }
    $summary = "'$LoginId' 의 소속을 org_id=$OrgId 로 옮긴다"
    $sqlMutation = @"
SET @login := '$eLoginId';
SET @oid   := $OrgId;
UPDATE app_user SET org_id = @oid
 WHERE CAST(login_id AS BINARY) = CAST(@login AS BINARY);
SET @rc_main := ROW_COUNT();
"@
    $sqlOutcome = @"
SET @a_outcome := (SELECT COUNT(*) FROM app_user
                    WHERE CAST(login_id AS BINARY) = CAST(@login AS BINARY) AND org_id = @oid);
"@
  }

  'repair' {
    # ★ 미러가 사라지면서 repair 의 옛 임무('미러를 정본에서 다시 세운다')는 통째로 없어졌다.
    #   남은 임무는 **도구가 안전하게 고칠 수 있는 것** 둘뿐이다:
    #   ① 이름 앞뒤 공백 제거. 이 위반은 화면에서 보이지 않아 사람이 rename 으로 고치려 해도
    #      무엇을 고칠지 알 수 없다 — TRIM 은 뜻이 모호하지 않은 유일한 자동 교정이다.
    #      ※ 전각 영숫자·NBSP 는 고치지 않는다: 'ＳＷ'→'SW' 는 표기 교정이 아니라 개명 판단이다.
    #        불변식이 계속 위반으로 보고하고 사람이 rename 한다.
    #      ※ TRIM 결과가 기존 이름과 충돌하면 uq_org_unit_name 이 ERROR 1062 로 막고 전부 롤백된다.
    #   ② -DeactivateOrphanedChildren — 숨긴 조직 밑의 살아 있는 조직을 **그 아래 전부와 함께**
    #      숨긴다. move 로도 풀 수 있지만 서브트리가 깊으면 여러 번 해야 하므로 한 번에 닫는
    #      길을 둔다(F13 의 탈출구). 기본값이 아닌 이유는 '조직을 사라지게 하는' 결정이라서다.
    #      자식 하나만 숨기면 손자가 다시 같은 상태가 되므로 서브트리를 통째로 닫는다.
    #      파생 테이블로 감싸는 것은 ERROR 1093 회피 관용구, 재귀 상한 512 는 폭주 방지.
    $deactSql = ""
    if ($DeactivateOrphanedChildren) {
      $deactSql = @"
UPDATE org_unit o
  JOIN (SELECT org_id FROM (
          WITH RECURSIVE cut AS (
              SELECT c.org_id, 0 AS depth
                FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id
               WHERE c.is_active = 1 AND p.is_active = 0
              UNION ALL
              SELECT g.org_id, cut.depth + 1
                FROM org_unit g JOIN cut ON g.parent_id = cut.org_id
               WHERE g.is_active = 1 AND cut.depth < 512
          ) SELECT DISTINCT org_id FROM cut
        ) x) d ON d.org_id = o.org_id
   SET o.is_active = 0
 WHERE o.is_active = 1;
SET @rc_deact := ROW_COUNT();
"@
      # ★★ repair 가 '활성 사용자가 비활성 조직에 소속' 을 **만드는 유일한 경로**다.
      #   숨길 서브트리 안에 재직자가 남아 있으면, 이 명령은 inactive_cut 을 0 으로 만들면서
      #   그 사람들을 조직도 밖으로 밀어낸다(실측: CTO 열람 89 → 69명, 게이트 전부 exit 0).
      #   그래서 여기서 먼저 사람 말로 막는다 — 아무것도 보내지 않고 끝난다(코드 2).
      #   ※ 이 선행검사를 빠져나가도(검사와 쓰기 사이의 경합) COMMIT 앞의 '악화 금지' 판정이
      #     member_hidden 증가를 잡아 롤백한다. 두 겹이다.
      $hideMembers = Get-Num @"
WITH RECURSIVE cut AS (
    SELECT c.org_id, 0 AS depth
      FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id
     WHERE c.is_active = 1 AND p.is_active = 0
    UNION ALL
    SELECT g.org_id, cut.depth + 1
      FROM org_unit g JOIN cut ON g.parent_id = cut.org_id
     WHERE g.is_active = 1 AND cut.depth < 512
)
SELECT COUNT(*) FROM app_user u
 WHERE u.is_active = 1 AND u.org_id IN (SELECT org_id FROM cut);
"@ "숨길 서브트리에 남은 재직 인원"
      if ($hideMembers -ne 0) {
        Die ("숨기려는 서브트리에 재직자 $hideMembers 명이 남아 있습니다 — 그대로 숨기면 그 사람들이 조직도와 상위 조직의 unit_tree 열람 범위에서 통째로 사라집니다(에러도 경고도 없이). 아무것도 바꾸지 않았습니다.`r`n" +
             "    먼저 사람을 옮기세요:  org-ops.cmd assign -LoginId <id> -OrgId <살아 있는 조직>`r`n" +
             "    또는 조직을 숨기지 말고 자식을 살아 있는 부모 밑으로:  org-ops.cmd move -Id <조직> -ParentId <살아 있는 부모>`r`n" +
             "    (그 사람들이 실제로 퇴사·휴직이면 app_user.is_active 를 0 으로 하는 것이 먼저입니다 — 명단 소관)") 2
      }
    }
    $summary = "조직 이름의 앞뒤 ASCII 공백을 떼어 낸다(TRIM 이 뜻을 바꾸지 않고 고칠 수 있는 유일한 표기 위반)"
    if ($DeactivateOrphanedChildren) {
      $summary += " + 숨긴 조직 밑의 살아 있는 조직을 **그 아래 전부와 함께 숨긴다**"
    }
    $sqlMutation = $deactSql + @"
UPDATE org_unit SET name = TRIM(name)
 WHERE CAST(name AS BINARY) <> CAST(TRIM(name) AS BINARY);
SET @rc_main := ROW_COUNT();
"@
    # repair 는 '특정 행이 이렇게 됐다' 가 아니라 '더 나빠지지 않았다' 가 성공 조건이다.
    #  ★ 다만 -DeactivateOrphanedChildren 는 목표가 뚜렷하므로 결과를 단언한다:
    #    '이 실행 뒤에 숨긴 부모 밑의 살아 있는 자식이 하나도 남지 않았다'.
    #    (inactive_cut 은 '악화 금지' 판정만 받으므로, 여기서 안 보면 서브트리가 덜 닫힌 채
    #     COMMIT 될 수 있다 — 이 한 줄이 그것을 막는다.)
    $sqlOutcome = "SET @a_outcome := 1;"
    if ($DeactivateOrphanedChildren) {
      $sqlOutcome = @"
SET @a_outcome := IF((SELECT COUNT(*) FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id
                       WHERE c.is_active = 1 AND p.is_active = 0) = 0, 1, 0);
"@
    }
  }
}

Write-Host ""
Write-Host "[2] 바뀌는 것" -ForegroundColor White
Write-Host "   $summary" -ForegroundColor Cyan
if ($WhatIf) { Write-Host "   (-WhatIf — 검사만 하고 반드시 ROLLBACK 합니다)" -ForegroundColor Yellow }

if (-not $WhatIf -and -not $Force) {
  if ([Console]::IsInputRedirected) {
    Die "무인 실행에서는 확인을 받을 수 없습니다. 의도한 변경이면 -Force 를, 확인만 하려면 -WhatIf 를 붙이세요." 2
  }
  Write-Host ""
  $a = Read-Host "   진행할까요? (y/N)"
  if ($a -ne 'y' -and $a -ne 'Y') {
    Write-Host "   취소했습니다 — 아무것도 바꾸지 않았습니다."
    Cleanup
    exit 2
  }
}

# ============================================================================
#  3~4) 한 덩어리 트랜잭션 — 쓰고, COMMIT 전에 불변식이 나빠졌는지 본다
# ============================================================================
$fpBefore = Get-Scalar $SQL_FINGERPRINT "실행 전 지문"
if ($fpBefore -notmatch '^[0-9a-f]{64}$') { Die "실행 전 지문을 못 구했습니다: $fpBefore" 3 }

$doWrite = 1
if ($WhatIf) { $doWrite = 0 }

# ★ 트랜잭션 안에 DDL 을 한 문장도 넣지 않는다 — DDL 은 암묵 커밋을 일으켜 '전부 아니면 전무'
#   라는 이 도구의 유일한 보장을 깨뜨린다.
# ★ COMMIT/ROLLBACK 을 PREPARE 로 고르는 이유: 순수 SQL 에는 IF/THEN 도 SIGNAL 도 없다
#   (SIGNAL 은 ERROR 1295). 실행할 문장 자체를 문자열로 고르는 것이 이 저장소의 관례다.
#   ※ MySQL 8.4 에서 COMMIT·ROLLBACK 이 prepared statement 로 동작함을 실측 확인했다.
$txn = @"
SET NAMES utf8mb4;
SET SESSION autocommit = 0;
SET @dowrite := $doWrite;
START TRANSACTION;

/* ── 3-0) 기준선 — '이 명령이 무엇을 나쁘게 만들었나' 를 재려면 변경 전 값이 있어야 한다.
   같은 계산식을 두 번 쓰지 않기 위해, 불변식 SQL 을 그대로 한 번 돌리고 값을 복사한다. */
$SQL_INVARIANTS
SET @v0_root_bad        := @v_root_bad;
SET @v0_unreachable     := @v_unreachable;
SET @v0_name_bad        := @v_name_bad;
SET @v0_orphan          := @v_orphan;
SET @v0_inactive_parent := @v_inactive_parent;
SET @v0_member_hidden   := @v_member_hidden;

/* ── 3) 변경 ──────────────────────────────────────────────────────── */
$sqlMutation

/* ── 4-a) 의도한 결과가 실제로 났는가 ─────────────────────────────── */
$sqlOutcome

/* ── 4-b) 불변식 — 다시 재고, 하나라도 나빠졌으면 실패다 ──────────── */
$SQL_INVARIANTS
SET @v_worse := IF(@v_root_bad        > @v0_root_bad
                OR @v_unreachable     > @v0_unreachable
                OR @v_name_bad        > @v0_name_bad
                OR @v_orphan          > @v0_orphan
                OR @v_inactive_parent > @v0_inactive_parent
                OR @v_member_hidden   > @v0_member_hidden, 1, 0);
SET @ok := IF(@a_outcome = 1 AND @v_worse = 0, 1, 0);

/* ── 미리보기: 트랜잭션 안에서 본 결과(커밋 여부는 아래 판정) ────────── */
$SQL_TREE
$SQL_INV_REPORT

/* ── 4-c) 판정 — 어긋나면 ROLLBACK ────────────────────────────────── */
SET @decision := IF(@ok = 1 AND @dowrite = 1, 'COMMIT', 'ROLLBACK');
PREPARE _d FROM @decision; EXECUTE _d; DEALLOCATE PREPARE _d;

SELECT CONCAT_WS('|', '##RESULT',
         CONCAT('ok=', @ok),
         CONCAT('decision=', @decision),
         CONCAT('outcome=', @a_outcome),
         CONCAT('worse=', @v_worse),
         CONCAT('rc_main=', IFNULL(@rc_main, -1)),
         CONCAT('rc_deact=', IFNULL(@rc_deact, -1)),
         CONCAT('inactive_cut_before=', IFNULL(@v0_inactive_parent, -1)),
         CONCAT('inactive_cut_after=', IFNULL(@v_inactive_parent, -1)),
         CONCAT('member_hidden_before=', IFNULL(@v0_member_hidden, -1)),
         CONCAT('member_hidden_after=', IFNULL(@v_member_hidden, -1)),
         CONCAT('newid=', IFNULL(@newid, 0))) AS ``__row``;
"@

Write-Host ""
Write-Host "[3] 트랜잭션 실행" -ForegroundColor White
$res = Invoke-Sql -Sql $txn -NoHeaders

$afterRows = Select-Marked $res.Text '##ROW'
$afterInv  = Select-Marked $res.Text '##INV'
$resultRow = $null
foreach ($ln in ($res.Text -split "`r?`n")) { if ($ln.StartsWith('##RESULT|')) { $resultRow = $ln } }

$kv = @{}
if ($resultRow) {
  foreach ($p in ($resultRow.Substring(9) -split '\|')) {
    $i = $p.IndexOf('=')
    if ($i -gt 0) { $kv[$p.Substring(0, $i)] = $p.Substring($i + 1) }
  }
}

# 실행 후 실제 상태의 지문. 롤백이 진짜 일어났는지는 이 값으로만 증명된다.
$fpAfter = Get-Scalar $SQL_FINGERPRINT "실행 후 지문"

$committed = ($kv['decision'] -eq 'COMMIT')
$okFlag = ($kv['ok'] -eq '1')

# ---- 실패 경로 -------------------------------------------------------------
if ($res.Code -ne 0 -or -not $resultRow -or -not $okFlag -or ($doWrite -eq 1 -and -not $committed)) {

  if ($afterInv.Count -gt 0) {
    Write-Host ""
    Write-Host "   트랜잭션 안에서 본 불변식:" -ForegroundColor White
    Show-Table $INV_HEAD $afterInv "     "
  }
  Write-Host ""
  if (-not $resultRow) {
    # SQL 자체가 에러로 죽은 경우 — 남은 문장이 실행되지 않고 연결이 끊기며 InnoDB 가 롤백한다.
    Bad "SQL 이 오류로 중단됐습니다(판정 줄이 없습니다). MySQL 이 한 말:"
    Write-Host ($res.Text.Trim()) -ForegroundColor DarkYellow
  } else {
    Bad "결과/불변식 검사에 걸려 ROLLBACK 했습니다."
    if ($kv['outcome'] -ne '1') {
      Write-Host "   · 의도한 변경이 일어나지 않았습니다(대상이 없거나 조건에 맞는 행이 0행) — outcome=$($kv['outcome']), 바뀐 행=$($kv['rc_main'])" -ForegroundColor Yellow
    }
    if ($kv['worse'] -eq '1') {
      Write-Host "   · 이 명령이 불변식을 **악화시켰습니다** — 그래서 되돌렸습니다. 아래 표에서 기대와 다른 줄을 보세요." -ForegroundColor Yellow
    }
    # ★ @(...) 로 감싸는 것이 필수다 — 깨진 불변식이 **정확히 하나**일 때 파이프라인 결과가
    #   셀 배열 하나로 풀려서, foreach 가 그 배열의 '문자' 를 돌게 된다.
    $dirtyAfter = @($afterInv | Where-Object { $_[1] -ne $_[2] })
    foreach ($d in $dirtyAfter) {
      Write-Host ("   · " + $d[0] + " = " + $d[1] + " (기대 " + $d[2] + ")") -ForegroundColor Yellow
    }
    # 숨긴 부모 밑 자식을 늘린 경우는 숫자로 못박아 준다 — 위 목록만으로는 '늘렸다'가 안 보인다.
    $cutB = -1; $cutA = -1
    if ($kv['inactive_cut_before'] -match '^-?\d+$') { $cutB = [int]$kv['inactive_cut_before'] }
    if ($kv['inactive_cut_after']  -match '^-?\d+$') { $cutA = [int]$kv['inactive_cut_after'] }
    if ($cutA -gt $cutB -and $cutB -ge 0) {
      Write-Host "   · '숨긴 조직 밑의 살아 있는 조직' 을 $cutB → $cutA 로 늘렸습니다." -ForegroundColor Yellow
      Write-Host "     살아 있는 조직은 살아 있는 부모 밑에 두세요. 함께 숨길 생각이면  org-ops.cmd repair -DeactivateOrphanedChildren  을 쓰세요." -ForegroundColor Yellow
    }
    # ★ 사람을 숨긴 조직 안에 가둔 경우 — 조직 수만 보는 위 줄로는 절대 보이지 않는다.
    $hidB = -1; $hidA = -1
    if ($kv['member_hidden_before'] -match '^-?\d+$') { $hidB = [int]$kv['member_hidden_before'] }
    if ($kv['member_hidden_after']  -match '^-?\d+$') { $hidA = [int]$kv['member_hidden_after'] }
    if ($hidA -gt $hidB -and $hidB -ge 0) {
      Write-Host "   · '숨긴 조직에 소속된 재직자' 를 $hidB → $hidA 명으로 늘렸습니다." -ForegroundColor Yellow
      Write-Host "     그 사람들은 조직도에서도 상위 조직의 unit_tree 열람 범위에서도 사라집니다 — 먼저 org-ops.cmd assign 으로 살아 있는 조직에 옮기세요." -ForegroundColor Yellow
    }
  }

  Write-Host ""
  if ($fpAfter -eq $fpBefore) {
    Ok "롤백 확인 — DB 지문이 실행 전과 같습니다(한 행도 바뀌지 않았습니다). $($fpBefore.Substring(0,16))…"
    Cleanup
    exit 1
  } else {
    Bad "★★ 롤백 검증 실패 — 실패했는데 DB 지문이 바뀌었습니다."
    Write-Host "   전: $fpBefore" -ForegroundColor Red
    Write-Host "   후: $fpAfter"  -ForegroundColor Red
    Write-Host "   즉시 사람에게 보고하고, 백업으로 되돌릴지 판단하세요." -ForegroundColor Red
    Cleanup
    exit 9
  }
}

# ---- 성공 경로 -------------------------------------------------------------
Write-Host ""
if ($WhatIf) {
  Write-Host "[4] 이렇게 바뀝니다 (미리보기 — 트랜잭션 안에서 본 상태)" -ForegroundColor White
} else {
  Write-Host "[4] 실행 후 상태" -ForegroundColor White
}
Show-Table $TREE_HEAD $afterRows
Write-Host ""
Show-Table $INV_HEAD $afterInv

if ($cmd -eq 'add' -and $kv['newid']) { Write-Host "" ; Info "새 조직 번호(org_id) = $($kv['newid'])" }
if ($cmd -eq 'rename') { Info "바뀐 행 — 조직 $($kv['rc_main']) (자식·소속자는 번호로 가리키므로 따라 고칠 것이 없습니다)" }
if ($cmd -eq 'repair') {
  Info "이름 앞뒤 ASCII 공백을 떼어 낸 조직 — $($kv['rc_main']) 개 (전각·전각공백·NBSP·제어문자는 TRIM 대상이 아닙니다 — rename 으로 고치세요)"
  if ($DeactivateOrphanedChildren) {
    Info "숨김 처리한 조직 — $($kv['rc_deact']) 개 ('숨긴 부모 밑의 살아 있는 조직' $($kv['inactive_cut_before']) → $($kv['inactive_cut_after']))"
  }
}
# ★ 남아 있는 위반은 성공 경로에서도 말해 준다 — 안 그러면 '[OK] 니까 다 끝났다'로 읽힌다.
#   ('악화시키지 않았다'가 성공 조건이므로, 원래 있던 위반은 남은 채로 성공할 수 있다.)
$leftOver = @($afterInv | Where-Object { $_[1] -ne $_[2] })
$okWhat = "불변식 전 항목 통과"
if ($leftOver.Count -gt 0) {
  $okWhat = "이 명령은 어떤 불변식도 악화시키지 않았습니다(남은 위반은 아래 참조)"
  Write-Host ""
  Warn "다만 다음 불변식은 **원래부터** 어긋나 있고 이 명령의 대상이 아니었습니다:"
  foreach ($d in $leftOver) { Write-Host ("     · " + $d[0] + " = " + $d[1] + " (기대 " + $d[2] + ")") -ForegroundColor Yellow }
  Write-Host "   해소: 루트/도달불가 → org-ops.cmd move   ·   이름 표기 → repair(앞뒤 ASCII 공백) 또는 rename(그 밖의 문자)" -ForegroundColor Yellow
  Write-Host "         숨긴 부모 밑 자식 → org-ops.cmd move  또는  repair -DeactivateOrphanedChildren" -ForegroundColor Yellow
  Write-Host "         숨긴 조직에 남은 재직자 → org-ops.cmd assign 으로 살아 있는 조직에 옮긴다" -ForegroundColor Yellow
}

Write-Host ""
if ($WhatIf) {
  if ($fpAfter -eq $fpBefore) {
    Ok "-WhatIf — $okWhat. **아무것도 쓰지 않았습니다**(지문 동일: $($fpBefore.Substring(0,16))…)"
    Write-Host "   실제로 적용하려면 -WhatIf 를 빼고 다시 실행하세요."
    Cleanup
    exit 0
  }
  Bad "★★ -WhatIf 인데 DB 지문이 바뀌었습니다. 있어서는 안 되는 상태입니다."
  Write-Host "   전: $fpBefore" -ForegroundColor Red
  Write-Host "   후: $fpAfter"  -ForegroundColor Red
  Cleanup
  exit 9
}

Ok "COMMIT 완료 — $okWhat."
Write-Host "   지문 $($fpBefore.Substring(0,16))… → $($fpAfter.Substring(0,16))…"
Cleanup
exit 0
