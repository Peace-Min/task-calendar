#requires -Version 5
<#
  수행과제 캘린더: 배포 SQL(release-v<버전>.sql) 만들기
  ------------------------------------------------------------------
  installer\publish-update.ps1 이 부른다. 시험(tests/release-sql.test.mjs)도 같은 파일을 임시 조각 폴더로 부른다.

  한 배포에 SQL 은 하나다(docs/DB-RELEASE-OPS.md §4, §5). 운영자는 Workbench 에서 이 파일 하나만 한 번 실행한다:
    1) 확인       구조 번호(db_structure_version, 14 전의 옛 키 schema_version)와 db_updating 을 읽는다.
                  DB 가 앱보다 새거나, 조각 사슬보다 오래됐거나, 값을 읽을 수 없으면 1146 으로 멈춘다.
    2) 닫기       구조 번호가 앱보다 낮을 때만 db_updating = 1(키가 없던 13 에서는 만든다)
    3) 이관 조각  db\deploy\migrations\*.sql 을 구조 번호 순서로. 조각마다 이미 지난 번호면 스스로 건너뛴다
    4) 끝 확인    구조 번호 = 앱, 옛 키 없음, 키 다섯 개
    5) 열기       한 트랜잭션: app_latest_version, app_installer_file, app_installer_sha256, db_updating = 0
    6) 결과 표

  조각 규칙(DB-RELEASE-OPS §5.2):
    - 첫 줄 '-- @migration from=N to=N+1'.
    - 끝에서 구조 번호를 한 줄로 올린다: UPDATE cal_schema_meta SET v = '<to>', updated_at = UTC_TIMESTAMP(3)
      WHERE k = 'db_structure_version' AND v = '<from>';
    - db_updating 을 쓰지 않는다(닫기와 열기는 이 스크립트가 만드는 감싸개의 일이다). @r_ 변수를 쓰지 않는다(감싸개 몫).
    - 저장 프로그램(PROCEDURE, FUNCTION, TRIGGER, DELIMITER)을 쓰지 않는다.
  사슬: from 순서로 빈틈과 겹침 없이 이어지고, 마지막 to 가 앱 구조 번호(DbGate.AppStructureVersion)와 같아야 한다.

  사용 예:
    release-sql.ps1 -FragmentDir ..\db\deploy\migrations -Structure 14 -CheckOnly
    release-sql.ps1 -FragmentDir ..\db\deploy\migrations -Structure 14 -Version 0.23.0 `
      -InstallerFile TaskCalendarWidget-Setup-v0.23.0.exe -Sha256 <64자> -Notes "요약" -OutFile ..\dist\installer\release-v0.23.0.sql

  --- EXITCODES (ASCII copy for tests)
  0 ok
  2 bad arguments (version, file name, sha256, missing parameter)
  3 bad fragment (header, step, to-version UPDATE, forbidden statement)
  4 chain broken (gap or duplicate start)
  5 chain end differs from app structure (or no fragment)
  --- END EXITCODES ---
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$FragmentDir,
  [Parameter(Mandatory = $true)][int]$Structure,
  [switch]$CheckOnly,             # 사슬만 확인하고 끝낸다(빌드 전에 publish-update.ps1 이 부른다)
  [string]$Version = "",
  [string]$InstallerFile = "",
  [string]$Sha256 = "",
  [string]$Notes = "",
  [string]$OutFile = "",
  [string]$Stamp = ""             # 머리 주석의 시각. 비우면 지금(시험은 고정값을 준다)
)
$ErrorActionPreference = 'Stop'

function Stop-Gen([string]$tag, [string]$m, [int]$code) {
  Write-Host "X [$tag] $m" -ForegroundColor Red
  exit $code
}

# ── 1) 조각 읽기와 머리 검사 ──────────────────────────────────────────
if (-not (Test-Path -LiteralPath $FragmentDir -PathType Container)) { Stop-Gen 'NO_FRAGMENT_DIR' "조각 폴더 없음: $FragmentDir" 5 }
$frags = @()
foreach ($f in @(Get-ChildItem -LiteralPath $FragmentDir -Filter '*.sql' -File | Sort-Object Name)) {
  $text = [System.IO.File]::ReadAllText($f.FullName, (New-Object System.Text.UTF8Encoding($false)))
  $text = $text.TrimStart([char]0xFEFF) -replace "`r`n", "`n"
  $first = ($text -split "`n", 2)[0]
  $hm = [regex]::Match($first, '^-- @migration from=(\d+) to=(\d+)[ \t]*$')
  if (-not $hm.Success) { Stop-Gen 'BAD_HEADER' "$($f.Name): 첫 줄이 '-- @migration from=N to=M' 이 아니다" 3 }
  if ([regex]::Matches($text, '(?m)^-- @migration ').Count -ne 1) { Stop-Gen 'BAD_HEADER' "$($f.Name): '-- @migration' 줄이 둘 이상이다" 3 }
  $from = [int]$hm.Groups[1].Value; $to = [int]$hm.Groups[2].Value
  if ($to -ne $from + 1) { Stop-Gen 'BAD_STEP' "$($f.Name): 조각 하나는 한 칸만 올린다($from 에서 $to)" 3 }
  # 줄 전체 주석을 지운 코드에서 본다(설명문이 검사에 걸리지 않게).
  $code = [regex]::Replace($text, '(?m)^[ \t]*--.*$', '')
  $bump = "UPDATE cal_schema_meta SET v = '$to', updated_at = UTC_TIMESTAMP(3)`n WHERE k = 'db_structure_version' AND v = '$from';"
  if (-not $code.Contains($bump)) { Stop-Gen 'NO_BUMP' "$($f.Name): 끝에서 구조 번호를 $from 에서 $to 로 올리는 UPDATE 가 없다" 3 }
  if ([regex]::IsMatch($code, "(?i)\b(UPDATE|INSERT|REPLACE|DELETE)\b[^;]*db_updating")) { Stop-Gen 'WRITES_UPDATING' "$($f.Name): db_updating 을 쓴다(닫기와 열기는 release SQL 의 몫)" 3 }
  if ([regex]::IsMatch($code, '(?i)\b(DELIMITER|PROCEDURE|FUNCTION|TRIGGER|DEFINER)\b')) { Stop-Gen 'STORED_PROGRAM' "$($f.Name): 저장 프로그램이나 DELIMITER 를 쓴다" 3 }
  if ($code.Contains('@r_')) { Stop-Gen 'USES_R_VAR' "$($f.Name): 감싸개 변수(@r_)를 쓴다" 3 }
  $frags += [pscustomobject]@{ Name = $f.Name; From = $from; To = $to; Text = $text.TrimEnd("`n") }
}

# ── 2) 사슬 검사 ──────────────────────────────────────────────────────
if ($frags.Count -eq 0) { Stop-Gen 'NO_FRAGMENT' "조각이 하나도 없다: $FragmentDir" 5 }
$frags = @($frags | Sort-Object From)
for ($i = 1; $i -lt $frags.Count; $i++) {
  $a = $frags[$i - 1]; $b = $frags[$i]
  if ($b.From -eq $a.From) { Stop-Gen 'CHAIN_DUP' "$($a.Name) 와 $($b.Name) 가 같은 번호($($a.From))에서 출발한다" 4 }
  if ($b.From -ne $a.To) { Stop-Gen 'CHAIN_GAP' "사슬이 끊겼다: $($a.Name) 는 $($a.To) 에서 끝나는데 다음 $($b.Name) 는 $($b.From) 에서 출발한다" 4 }
}
$firstFrom = $frags[0].From
$lastTo = $frags[$frags.Count - 1].To
if ($lastTo -ne $Structure) { Stop-Gen 'CHAIN_END' "사슬의 끝($lastTo)이 앱 구조 번호($Structure, DbGate.AppStructureVersion)와 다르다" 5 }
$chainText = ($frags | ForEach-Object { "$($_.Name)($($_.From) 에서 $($_.To))" }) -join ', '
Write-Host "* 이관 조각 사슬: $chainText" -ForegroundColor Cyan
if ($CheckOnly) { exit 0 }

# ── 3) 값 검사 ────────────────────────────────────────────────────────
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Stop-Gen 'BAD_VERSION' "버전 형식이 X.Y.Z 가 아니다: '$Version'" 2 }
if ($InstallerFile -notmatch '^[A-Za-z0-9._-]+\.exe$') { Stop-Gen 'BAD_FILE' "설치 파일 이름이 이상하다: '$InstallerFile'" 2 }
if ($Sha256 -cnotmatch '^[0-9a-f]{64}$') { Stop-Gen 'BAD_SHA' "SHA256 이 소문자 16진수 64자가 아니다" 2 }
if (-not $OutFile) { Stop-Gen 'NO_OUT' "-OutFile 이 없다" 2 }
if (-not $Stamp) { $Stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm') }
$notesLine = (($Notes -replace "[\r\n]+", " ").Trim())

# ── 4) 조립 ───────────────────────────────────────────────────────────
#  틀(작은따옴표 here-string)에 {{이름}} 자리를 채운다. 백틱과 $ 를 그대로 쓰려고 작은따옴표다.
$fragBlocks = ($frags | ForEach-Object {
  "-- ---------- 조각 $($_.Name) ($($_.From) 에서 $($_.To)) ----------`n" + $_.Text + "`n-- ---------- 조각 $($_.Name) 끝 ----------"
}) -join "`n`n"

$tpl = @'
-- release-v{{VERSION}}.sql  (installer\publish-update.ps1 이 {{STAMP}} 에 만들었다)
-- 이 배포의 DB 작업 전부를 이 파일 하나로 한다(docs/DB-RELEASE-OPS.md §4).
--   앱 버전    {{VERSION}}
--   설치 파일  {{FILE}}
--   SHA256     {{SHA}}
--   DB 구조    {{APP}} (담긴 이관 조각: {{CHAIN}})
--   요약       {{NOTES}}
--
-- 실행 방법(폐쇄망, MySQL Workbench, taskmgr_app 계정)
--   1) {{FILE}} 와 latest.json 을 공유 폴더에 먼저 올린다. 옛 Setup 은 지우지 않는다.
--      (installer\publish-update.ps1 -CopyTo 를 쓰면 exe 복사, 해시 대조, latest.json 순서로 올린다)
--   2) 백업: Server > Data Export, taskcalendar 선택, Dump Structure and Data, Export to Self-Contained File,
--      Create Dump in a Single Transaction, Include Create Schema. 파일 끝에 '-- Dump completed' 가 있는지 본다.
--   3) 이 파일을 열고 taskcalendar 를 기본 스키마로 둔 채 전체 실행(Ctrl+Shift+Enter)한다.
--      오류가 나면 멈추는 기본 설정을 그대로 둔다. 이 파일 하나를 한 번 실행하면 끝이다.
--   4) 마지막 결과 표에서 db_structure_version = {{APP}}, db_updating = 0, app_latest_version = {{VERSION}} 을 본다.
--
-- 멈췄을 때(DB-RELEASE-OPS §6)
--   - 오류 1146 의 표 이름('중단: ...')이 멈춘 이유다. 아무것도 건드리지 말고 그 메시지를 개발자에게 넘긴다.
--   - 확인 단계에서 멈췄으면 아무것도 바뀌지 않았다.
--   - 닫은 뒤에 멈췄으면 db_updating = 1 인 채라 모든 앱이 기다린다. 고친 뒤 이 파일을 처음부터 다시 실행하거나
--     (이미 된 단계는 건너뛴다) 30분 안에 못 고치면 2) 의 백업을 Data Import 로 복원한다.
--   - 구조 번호가 이미 {{APP}} 인데 db_updating = 1 이면(앞선 실행이 마지막 조각 뒤에 멈춤) 이 파일이 열기까지 마무리한다.
--   - 성공한 뒤 다시 실행해도 바뀌는 것이 없다.
--
-- 순서: 1) 확인, 2) 닫기(구조가 낮을 때만), 3) 이관 조각, 4) 끝 확인, 5) 열기(한 트랜잭션), 6) 결과 표
SET SESSION lock_wait_timeout = 10;
SET NAMES utf8mb4;

-- =====================================================================
--  1) 확인
-- =====================================================================
SET @r_tbl := (SELECT COUNT(*) FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_schema_meta');
SET @g := IF(@r_tbl = 1, 'DO 0',
             'SELECT 1 FROM `중단: cal_schema_meta 표가 없다 - 기본 스키마를 확인할 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

--  구조 번호는 db_structure_version, 14 전의 DB 는 옛 키 schema_version('13') 에 있다.
SET @r_old := (SELECT v FROM cal_schema_meta WHERE k = 'schema_version');
SET @r_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @r_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @r_from := COALESCE(@r_cur, @r_old);
SET @r_n := IF(@r_from REGEXP '^[0-9]{1,6}$', CAST(@r_from AS UNSIGNED), NULL);

SET @g := IF(@r_n IS NOT NULL AND (@r_old IS NULL OR @r_cur IS NULL OR @r_old = @r_cur), 'DO 0',
             'SELECT 1 FROM `중단: 구조 번호를 읽을 수 없다 - 손댄 값이거나 다른 DB 다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(@r_n <= {{APP}}, 'DO 0',
             'SELECT 1 FROM `중단: DB 구조 번호가 {{APP}} 보다 높다 - 이 Setup 보다 새 DB 다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(@r_n >= {{FIRST}}, 'DO 0',
             'SELECT 1 FROM `중단: DB 구조 번호가 {{FIRST}} 보다 낮다 - 이 SQL 로 올릴 수 없다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
--  옛 키만 있는 DB 는 13 이어야 한다(옛 키는 13 에서 끝났다. 14 부터는 db_structure_version).
SET @g := IF(@r_cur IS NOT NULL OR @r_old = '13', 'DO 0',
             'SELECT 1 FROM `중단: 옛 키 schema_version 이 13 이 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(@r_upd <=> '0' OR @r_upd <=> '1' OR (@r_upd IS NULL AND @r_cur IS NULL), 'DO 0',
             'SELECT 1 FROM `중단: db_updating 값이 0 도 1 도 아니다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SET @r_need := (@r_n < {{APP}});
SELECT @r_from AS `지금 구조 번호`, '{{APP}}' AS `목표`, @r_upd AS `db_updating`,
       IF(@r_need, '구조를 올린다: 닫기, 이관 조각, 열기',
          IF(@r_upd <=> '1', '앞선 실행을 마무리한다: 열기', '앱 배포 정보만 바꾼다')) AS `할 일`;

-- =====================================================================
--  2) 닫기: 구조 번호가 {{APP}} 보다 낮을 때만 db_updating = 1
-- =====================================================================
--  이 순간부터 모든 앱이 '서버 갱신 중' 으로 기다린다. autocommit 한 문장이라 곧바로 다른 연결에 보인다.
--  13 에는 db_updating 키가 없어 여기서 만든다(INSERT ... ON DUPLICATE KEY UPDATE).
SET @s := IF(@r_need,
  'INSERT INTO cal_schema_meta (k, v, updated_at) VALUES (''db_updating'', ''1'', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE v = ''1'', updated_at = UTC_TIMESTAMP(3)',
  'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- =====================================================================
--  3) 이관 조각(db/deploy/migrations, 구조 번호 순서)
-- =====================================================================
--  조각마다 지금 번호를 다시 읽어, 자기 출발 번호일 때만 바꾸고 이미 지난 번호면 건너뛴다.
--  조각 안에서 멈추면 db_updating = 1 인 채다.

{{FRAGMENTS}}

-- =====================================================================
--  4) 끝 확인: 구조 번호 {{APP}}, 옛 키 없음, 키 다섯 개
-- =====================================================================
SET @r_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @r_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @r_nold := (SELECT COUNT(*) FROM cal_schema_meta WHERE k = 'schema_version');
SET @r_keys := (SELECT COUNT(*) FROM cal_schema_meta
                 WHERE k IN ('db_structure_version', 'db_updating', 'app_latest_version',
                             'app_installer_file', 'app_installer_sha256'));
SET @g := IF(@r_cur <=> '{{APP}}' AND @r_nold = 0 AND @r_keys = 5 AND (@r_upd <=> '0' OR @r_upd <=> '1'), 'DO 0',
             'SELECT 1 FROM `중단: 끝 확인 실패 - 구조 번호가 {{APP}} 가 아니거나 키가 모자란다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- =====================================================================
--  5) 열기(한 트랜잭션): 배포 정보 세 키와 db_updating = 0
-- =====================================================================
--  구조 번호와 새 배포 정보가 함께 보이게 된다. 위젯이 반쯤 바뀐 값(새 버전 번호에 옛 해시)을 읽지 않는다.
--  값이 이미 같으면 0행이라, 성공한 뒤 다시 실행해도 바뀌는 것이 없다.
START TRANSACTION;
UPDATE cal_schema_meta SET v = {{Q_VERSION}}, updated_at = UTC_TIMESTAMP(3) WHERE k = 'app_latest_version' AND v <> {{Q_VERSION}};
UPDATE cal_schema_meta SET v = {{Q_FILE}}, updated_at = UTC_TIMESTAMP(3) WHERE k = 'app_installer_file' AND v <> {{Q_FILE}};
UPDATE cal_schema_meta SET v = {{Q_SHA}}, updated_at = UTC_TIMESTAMP(3) WHERE k = 'app_installer_sha256' AND v <> {{Q_SHA}};
UPDATE cal_schema_meta SET v = '0', updated_at = UTC_TIMESTAMP(3) WHERE k = 'db_updating' AND v <> '0';
COMMIT;

-- =====================================================================
--  6) 결과 표
-- =====================================================================
SELECT k, v, updated_at FROM cal_schema_meta ORDER BY k;
'@

function SqlStr([string]$s) { return "'" + ($s -replace "'", "''") + "'" }
$sql = $tpl.Replace("`r`n", "`n")
$sql = $sql.Replace('{{Q_VERSION}}', (SqlStr $Version)).Replace('{{Q_FILE}}', (SqlStr $InstallerFile)).Replace('{{Q_SHA}}', (SqlStr $Sha256))
$sql = $sql.Replace('{{VERSION}}', $Version).Replace('{{FILE}}', $InstallerFile).Replace('{{SHA}}', $Sha256)
$sql = $sql.Replace('{{APP}}', [string]$Structure).Replace('{{FIRST}}', [string]$firstFrom)
$sql = $sql.Replace('{{CHAIN}}', $chainText).Replace('{{STAMP}}', $Stamp).Replace('{{NOTES}}', $notesLine)
$sql = $sql.Replace('{{FRAGMENTS}}', $fragBlocks)   # 마지막에 넣는다(조각 본문은 자리 채우기에 닿지 않는다)

# BOM 없는 UTF-8, 줄끝 LF(Workbench 는 둘 다 읽는다)
$outDir = Split-Path -Parent ([System.IO.Path]::GetFullPath($OutFile))
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
[System.IO.File]::WriteAllText($OutFile, ($sql.TrimEnd("`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
exit 0
