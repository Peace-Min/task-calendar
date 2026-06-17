# 위젯 UI 실측 캡처 — 헤드리스 Edge로 task-calendar-prototype.html을 실제 렌더해 PNG 저장.
#
# 왜: PrintWindow(hdc, PW_RENDERFULLCONTENT)는 WebView2(Chromium GPU/DirectComposition 표면)를
#     못 읽어 '검은 화면'이 나온다. Chromium 자체(headless Edge)로 렌더+캡처하면 실제 픽셀을 얻는다.
# 주의: PowerShell 5.1의 Get-Content 기본 디코딩은 시스템 ANSI(CP949)라 UTF-8 한글이 깨진다.
#       반드시 -Encoding UTF8 로 읽고 UTF8(no BOM)로 써야 한다.
#
# 사용:
#   pwsh -File tools\capture-widget.ps1 -W 380 -H 470 -Out shot.png            # 시드 데이터, 위젯 기본폭
#   pwsh -File tools\capture-widget.ps1 -W 1100 -H 800 -Out wide.png -Demo     # 대표 데모(기간/시간/할일)
param(
  [int]$W = 380,
  [int]$H = 470,
  [string]$Out = "$env:TEMP\widget-shot.png",
  [switch]$Demo   # 기간 일정·시간 일정·할 일 등 대표 데이터를 주입(미지정 시 앱 시드 데이터)
)
$ErrorActionPreference = 'Stop'
$proto = Join-Path $PSScriptRoot '..\task-calendar-prototype.html'
$edgeCandidates = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw "msedge.exe 를 찾을 수 없습니다." }

$tpl = Get-Content $proto -Raw -Encoding UTF8   # CP949 오디코드 방지

if ($Demo) {
  $inject = @'
<script>try{
 state={gitAuthor:'',categories:[
  {id:'c1',name:'보고서 작성',color:'#3e5be0',desc:'',gitRepo:'',createdAt:''},
  {id:'c2',name:'시스템 점검',color:'#2e9e6b',desc:'',gitRepo:'',createdAt:''}],
 entries:[
  {id:'e1',date:'2026-06-09',endDate:'2026-06-13',categoryId:'c2',allDay:true,startTime:'',endTime:'',title:'출장 워크숍',memo:'',source:'manual',commits:[],recur:null,recurExcept:[],createdAt:'',updatedAt:''},
  {id:'e2',date:'2026-06-11',categoryId:'c2',allDay:true,startTime:'',endTime:'',title:'서버 점검',memo:'',source:'manual',commits:[],endDate:'',recur:null,recurExcept:[],createdAt:'',updatedAt:''},
  {id:'e3',date:'2026-06-17',categoryId:'c1',allDay:false,startTime:'09:00',endTime:'10:00',title:'주간 회의',memo:'',source:'manual',commits:[],endDate:'',recur:null,recurExcept:[],createdAt:'',updatedAt:''},
  {id:'e4',date:'2026-06-17',categoryId:'c1',allDay:false,startTime:'14:00',endTime:'',title:'보고서 리뷰',memo:'',source:'manual',commits:[],endDate:'',recur:null,recurExcept:[],createdAt:'',updatedAt:''}],
 todos:[{id:'t1',text:'주간 보고서 초안',done:false,categoryId:'c1',due:'2026-06-17',endDate:'',prio:'high',completedAt:'',note:'',createdAt:'',updatedAt:''}]};
 view.y=2026;view.m=5;selectedDate='2026-06-17';
 document.body.classList.add('host');
 var s=document.createElement('style');s.textContent='@media(max-width:760px){.day-panel{display:none!important}}';document.head.appendChild(s);
 renderAll();
}catch(e){document.body.insertAdjacentHTML('afterbegin','<pre style="color:red;font:12px monospace">INJECT ERR: '+e.message+'</pre>');}</script>
'@
  $tpl = $tpl -replace '</body>', ($inject + "`r`n</body>")
}

$tmp = Join-Path $env:TEMP 'tc_widget_render.html'
[System.IO.File]::WriteAllText($tmp, $tpl, (New-Object System.Text.UTF8Encoding($false)))

$udd = Join-Path $env:TEMP 'tc_edge_profile'
& $edge --headless --disable-gpu --no-sandbox --hide-scrollbars --force-device-scale-factor=1 `
  --user-data-dir="$udd" --window-size="$W,$H" --screenshot="$Out" ("file:///" + ($tmp -replace '\\','/')) | Out-Null
Start-Sleep -Seconds 2
if (Test-Path $Out) { "캡처 완료: $Out ({0:N0} bytes, ${W}x${H})" -f (Get-Item $Out).Length }
else { "캡처 실패" }
