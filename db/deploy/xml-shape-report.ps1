<#
  =====================================================================
   xml-shape-report.ps1 — data.xml 의 **구조만** 요약한다 (내용 반출 없음)
  =====================================================================

   【무엇을 위한 것인가】
     폐쇄망의 실사용 data.xml 이 어떤 모양인지 알아야 이관 도구를 제대로 검증할 수 있다.
     그런데 파일 자체를 반출하면 과제명·일정 제목·커밋 메시지가 통째로 나간다.
     이 스크립트는 **개수·분포·이상값만** 낸다 — 사람이 읽을 수 있는 문자열은 내지 않는다.

   【무엇을 절대 출력하지 않나】
     · 과제명 · 일정 제목 · 메모 · 할 일 내용 · 커밋 제목/본문 · 회의실 이름
     · 저장소 경로 · 작성자 이름 · id 원문(길이와 형식만 낸다)
     · 날짜 원값(연-월 분포만 낸다)
     출력에 한글 업무 용어가 섞이지 않는지 눈으로 확인한 뒤 반출할 것.

   【사용】
     powershell -ExecutionPolicy Bypass -File xml-shape-report.ps1
     powershell -ExecutionPolicy Bypass -File xml-shape-report.ps1 -Xml "D:\어딘가\data.xml" -Out shape.txt

   【반출 절차 권고】
     1) 이 스크립트를 폐쇄망으로 가져간다(텍스트 파일 하나다 — 내용을 직접 읽고 반입할 것)
     2) 실행해서 shape.txt 를 만든다
     3) shape.txt 를 **직접 열어 읽어 본 뒤** 반출한다
  ===================================================================== #>
param(
  [string]$Xml = (Join-Path $env:APPDATA 'TaskCalendar\data.xml'),
  [string]$Out = ''
)

$ErrorActionPreference = 'Stop'

#  ★ 콘솔 출력 인코딩 — PowerShell 5.1 은 기본이 시스템 ANSI(한국어 Windows 는 cp949)라
#    UTF-8 로 쓴 이 스크립트의 한글이 화면에서 통째로 깨진다(파일 출력은 멀쩡한데 화면만 깨진다).
#    폐쇄망에서 사용자가 **화면으로** 읽고 반출 여부를 판단하는 도구라, 화면이 깨지면 쓸모가 없다.
#    2026-09-02 실측으로 잡았다.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
if (-not (Test-Path $Xml)) { Write-Error "XML 이 없습니다: $Xml"; exit 2 }

$lines = New-Object System.Collections.Generic.List[string]
function W($s) { $lines.Add($s) | Out-Null; Write-Host $s }

# ── 값이 아니라 '모양'만 낸다 ─────────────────────────────────────────
function Shape([string]$s) {
  if ($null -eq $s) { return 'null' }
  if ($s -eq '')    { return 'empty' }
  if ($s -match '^\d{4}-\d{2}-\d{2}$')            { return 'date' }
  if ($s -match '^\d{2}:\d{2}$')                  { return 'time' }
  if ($s -match '^\d{4}-\d{2}-\d{2}T.*Z$')        { return 'iso' }
  if ($s -match '^-?\d+$')                        { return 'int' }
  if ($s -match '^-?\d+\.\d+$')                   { return 'dec' }
  if ($s -match '^#[0-9a-fA-F]{6}$')              { return 'color' }
  if ($s -match '^db-[0-9a-fA-F-]{36}$')          { return 'db-uuid' }
  if ($s -match '^db-')                           { return '★db-비규격' }
  return "text(len=$($s.Length))"
}
function Bucket([int]$n) {
  if ($n -eq 0) { return '0' } elseif ($n -le 10) { return '1-10' }
  elseif ($n -le 50) { return '11-50' } elseif ($n -le 200) { return '51-200' }
  elseif ($n -le 1000) { return '201-1000' } else { return '1000+' }
}
function Tally($map, $key) { if ($map.ContainsKey($key)) { $map[$key]++ } else { $map[$key] = 1 } }
function Dump($title, $map) {
  if ($map.Count -eq 0) { W "    (없음)"; return }
  foreach ($k in ($map.Keys | Sort-Object)) { W ("    {0,-22} {1}" -f $k, $map[$k]) }
}

[xml]$doc = Get-Content -Path $Xml -Raw -Encoding UTF8
$root = $doc.DocumentElement
$fi = Get-Item $Xml

W "════════════════════════════════════════════════════════════════════"
W " data.xml 구조 요약 (내용 없음)"
W "   생성: $(Get-Date -Format 'yyyy-MM-dd HH:mm')   파일 크기: $($fi.Length) bytes"
W "   파일 수정일: $($fi.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))"
W "════════════════════════════════════════════════════════════════════"

# ── 루트 ──────────────────────────────────────────────────────────────
W ""
W "[루트 속성]"
foreach ($a in $root.Attributes) {
  if ($a.Name -in @('version','generator','lsMigrated')) { W ("    {0,-14} {1}" -f $a.Name, $a.Value) }
  else { W ("    {0,-14} {1}" -f $a.Name, (Shape $a.Value)) }
}

$cats = @($root.SelectNodes('categories/category'))
$ents = @($root.SelectNodes('entries/entry'))
$tods = @($root.SelectNodes('todos/todo'))
$rooms = @($root.SelectNodes('rooms/room'))
$thDay = @($root.SelectNodes('taskHours/day'))
$atDay = @($root.SelectNodes('attendance/day'))
$prefs = $root.SelectSingleNode('prefs')

W ""
W "[건수]"
W ("    과제 {0} · 일정 {1} · 할 일 {2} · 회의실 {3} · 공수 {4}일 · 근태 {5}일" -f `
   $cats.Count, $ents.Count, $tods.Count, $rooms.Count, $thDay.Count, $atDay.Count)

# ── 과제 ──────────────────────────────────────────────────────────────
W ""
W "[과제] — 이관이 가장 먼저 만드는 표. project_uid 규칙이 여기서 걸린다"
$idShape = @{}; $srcCnt = @{}; $repoCnt = @{ 'git만'=0; 'svn만'=0; '둘다'=0; '없음'=0 }
$dupId = @{}; $badDb = 0; $descLen = 0; $nameLen = 0
foreach ($c in $cats) {
  $id = [string]$c.GetAttribute('id')
  Tally $idShape (Shape $id)
  Tally $dupId $id
  $src = [string]$c.GetAttribute('source'); if ($src -eq '') { $src = '(local)' }
  Tally $srcCnt $src
  if ($src -eq 'db' -and $id -notmatch '^db-[0-9a-fA-F-]{36}$') { $badDb++ }
  $g = [string]$c.GetAttribute('gitRepo'); $s = [string]$c.GetAttribute('svnRepo')
  if ($g -and $s) { $repoCnt['둘다']++ } elseif ($g) { $repoCnt['git만']++ }
  elseif ($s) { $repoCnt['svn만']++ } else { $repoCnt['없음']++ }
  $n = $c.SelectSingleNode('name'); if ($n) { $nameLen = [Math]::Max($nameLen, $n.InnerText.Length) }
  $d = $c.SelectSingleNode('description'); if ($d) { $descLen = [Math]::Max($descLen, $d.InnerText.Length) }
}
W "  id 형식:";      Dump 'id' $idShape
W "  source 분포:";  Dump 'src' $srcCnt
W "  저장소 경로:";  Dump 'repo' $repoCnt
W ("    중복 id {0}건" -f (($dupId.Values | Where-Object { $_ -gt 1 }).Count))
W ("    ★ source=db 인데 id 가 'db-'+36자 아님: {0}건  (0 이 아니면 이관이 중단된다)" -f $badDb)
W ("    이름 최장 {0}자 · 설명 최장 {1}자" -f $nameLen, $descLen)

# ── 일정 ──────────────────────────────────────────────────────────────
W ""
W "[일정]"
$attrPresent = @{}; $recurFreq = @{}; $exceptPer = @{}; $commitPer = @{}
$monthCnt = @{}; $dupExcept = 0; $totalExcept = 0; $totalCommit = 0
$bodyLenMax = 0; $subjLenMax = 0; $memoLenMax = 0; $titleLenMax = 0
$emptyStart = 0; $emptyEnd = 0; $hoursAttr = 0; $remindAttr = 0; $orphanCat = 0
$catIds = @{}; foreach ($c in $cats) { $catIds[[string]$c.GetAttribute('id')] = 1 }
foreach ($e in $ents) {
  foreach ($a in $e.Attributes) { Tally $attrPresent $a.Name }
  $d = [string]$e.GetAttribute('date'); if ($d -match '^(\d{4}-\d{2})') { Tally $monthCnt $Matches[1] }
  if ([string]$e.GetAttribute('startTime') -eq '') { $emptyStart++ }
  if ([string]$e.GetAttribute('endTime') -eq '')   { $emptyEnd++ }
  if ($e.HasAttribute('hours'))  { $hoursAttr++ }
  if ($e.HasAttribute('remind')) { $remindAttr++ }
  $cid = [string]$e.GetAttribute('categoryId')
  if ($cid -and -not $catIds.ContainsKey($cid)) { $orphanCat++ }
  $t = $e.SelectSingleNode('title'); if ($t) { $titleLenMax = [Math]::Max($titleLenMax, $t.InnerText.Length) }
  $m = $e.SelectSingleNode('memo');  if ($m) { $memoLenMax  = [Math]::Max($memoLenMax,  $m.InnerText.Length) }
  $r = $e.SelectSingleNode('recur')
  if ($r) {
    Tally $recurFreq ([string]$r.GetAttribute('freq'))
    $xs = @($r.SelectNodes('except')); $totalExcept += $xs.Count
    Tally $exceptPer (Bucket $xs.Count)
    $seen = @{}
    foreach ($x in $xs) { $dt = [string]$x.GetAttribute('date'); if ($seen.ContainsKey($dt)) { $dupExcept++ } else { $seen[$dt] = 1 } }
  }
  $cs = $e.SelectSingleNode('commits')
  $n = 0
  if ($cs) {
    $cl = @($cs.SelectNodes('commit')); $n = $cl.Count; $totalCommit += $n
    foreach ($cm in $cl) {
      $subjLenMax = [Math]::Max($subjLenMax, ([string]$cm.GetAttribute('subject')).Length)
      $bodyLenMax = [Math]::Max($bodyLenMax, $cm.InnerText.Length)
    }
  }
  Tally $commitPer (Bucket $n)
}
W "  속성 출현 횟수:"; Dump 'attr' $attrPresent
W ("    빈 startTime {0} · 빈 endTime {1} · hours 속성 {2} · remind 속성 {3}" -f $emptyStart, $emptyEnd, $hoursAttr, $remindAttr)
W ("    ★ 미존재 과제를 가리키는 categoryId: {0}건  (이관이 NULL 로 정리하고 보고한다)" -f $orphanCat)
W "  반복 freq 분포:"; Dump 'freq' $recurFreq
W ("    예외일 총 {0}건 · ★ 같은 일정 안 중복 {1}건  (이관이 dedup 하고 보고한다)" -f $totalExcept, $dupExcept)
W "  일정당 예외일 수:"; Dump 'exc' $exceptPer
W ("    커밋 총 {0}건" -f $totalCommit)
W "  일정당 커밋 수:"; Dump 'cmt' $commitPer
W ("    제목 최장 {0}자 · 메모 최장 {1}자 · 커밋 제목 최장 {2}자 · 커밋 본문 최장 {3}자" -f `
   $titleLenMax, $memoLenMax, $subjLenMax, $bodyLenMax)
W "  월별 일정 분포(연-월만):"; Dump 'mon' $monthCnt

# ── 할 일 ─────────────────────────────────────────────────────────────
W ""
W "[할 일]"
$tAttr = @{}; $prio = @{}; $dnPer = @{}; $totalDn = 0; $noteLenMax = 0; $textLenMax = 0; $doneCnt = 0
foreach ($t in $tods) {
  foreach ($a in $t.Attributes) { Tally $tAttr $a.Name }
  Tally $prio ([string]$t.GetAttribute('prio'))
  if ([string]$t.GetAttribute('done') -eq 'true') { $doneCnt++ }
  $x = $t.SelectSingleNode('text'); if ($x) { $textLenMax = [Math]::Max($textLenMax, $x.InnerText.Length) }
  $n = $t.SelectSingleNode('note'); if ($n) { $noteLenMax = [Math]::Max($noteLenMax, $n.InnerText.Length) }
  $dn = $t.SelectSingleNode('dayNotes'); $c = 0
  if ($dn) { $c = @($dn.SelectNodes('dayNote')).Count; $totalDn += $c }
  Tally $dnPer (Bucket $c)
}
W "  속성 출현:"; Dump 'a' $tAttr
W "  prio 분포:"; Dump 'p' $prio
W ("    완료 {0}건 · 날짜메모 총 {1}건 · 내용 최장 {2}자 · 비고 최장 {3}자" -f $doneCnt, $totalDn, $textLenMax, $noteLenMax)
W "  할 일당 날짜메모 수:"; Dump 'dn' $dnPer

# ── 공수 · 근태 ───────────────────────────────────────────────────────
W ""
W "[공수]"
$thCells = 0; $thBad = 0
foreach ($d in $thDay) {
  foreach ($t in @($d.SelectNodes('t'))) {
    $thCells++
    $h = [string]$t.GetAttribute('h')
    if ($h -notmatch '^\d+(\.\d+)?$') { $thBad++ }
    elseif (-not $catIds.ContainsKey([string]$t.GetAttribute('cat'))) { $thBad++ }
  }
}
W ("    {0}일 · 칸 {1}개 · ★ 값/과제가 이상한 칸 {2}개" -f $thDay.Count, $thCells, $thBad)

W ""
W "[근태] — ★ 이관의 가장 민감한 자리(무효 status 는 행을 만들지 않는다)"
$stCnt = @{}; $otBad = 0; $dateBad = 0
$okSet = @('1','2','3','4','5','6','7','9','10','11','12')
foreach ($d in $atDay) {
  $st = [string]$d.GetAttribute('status')
  if ($st -eq '') { Tally $stCnt '(빈값→행없음)' }
  elseif ($okSet -contains $st) { Tally $stCnt $st }
  else { Tally $stCnt "★무효($st)→행없음" }
  $ot = [string]$d.GetAttribute('overtime')
  if ($ot -ne '' -and ($ot -notmatch '^\d+$' -or [int]$ot -gt 11)) { $otBad++ }
  if ([string]$d.GetAttribute('date') -notmatch '^\d{4}-\d{2}-\d{2}$') { $dateBad++ }
}
W "  status 분포:"; Dump 's' $stCnt
W ("    overtime 범위 밖 {0}건(0 으로 보정) · 날짜 형식 이상 {1}건(건너뜀)" -f $otBad, $dateBad)

# ── 설정 ──────────────────────────────────────────────────────────────
W ""
W "[보고서 서식(prefs)] — 종류별 속성이 없으면 전역으로 폴백한다"
if ($null -eq $prefs) { W "    <prefs> 요소 없음 → 이관이 파서 기본값을 넣는다" }
else {
  foreach ($a in $prefs.Attributes) {
    if ($a.Name -like 'reportMarkerCustom*' -or $a.Name -eq 'fontFamily') { W ("    {0,-28} {1}" -f $a.Name, (Shape $a.Value)) }
    else { W ("    {0,-28} {1}" -f $a.Name, $a.Value) }
  }
  foreach ($k in @('daily','weekly')) {
    $has = $prefs.HasAttribute("reportMarker_$k")
    W ("    reportMarker_{0} 존재: {1}{2}" -f $k, $has, $(if (-not $has) { '  ← 전역값으로 폴백된다' } else { '' }))
  }
}

W ""
W "[회의실]"
$rl = 0; foreach ($r in $rooms) { $rl = [Math]::Max($rl, $r.InnerText.Length) }
W ("    {0}개 · 이름 최장 {1}자" -f $rooms.Count, $rl)

W ""
W "════════════════════════════════════════════════════════════════════"
W " 위 출력에 업무 용어(과제명·일정 제목 등)가 없는지 확인한 뒤 반출하세요."
W "════════════════════════════════════════════════════════════════════"

if ($Out -ne '') {
  $lines -join "`r`n" | Set-Content -Path $Out -Encoding UTF8
  Write-Host ""
  Write-Host "  저장: $Out"
}

#  ★ 종료코드를 명시한다 — 안 하면 마지막 문장의 상태가 새어 나와, 폐쇄망에서
#    "실패한 줄 알았는데 사실 성공" 이 된다(실측: 정상 완료인데 255 가 나왔다).
exit 0
