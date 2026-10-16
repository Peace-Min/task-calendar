// 창 버튼: 최소화, 최대화(이전 크기로), 닫기(docs/WINDOW-UI.md §1, 시안 dist/rehearsal/window-ui/proto-window-buttons.html).
//
// 이 파일이 지키는 것:
//   (S) 웹 마크업: 기능 버튼(맨 앞, 핀, ☰) 뒤에 구분선, 그 뒤 창 버튼 셋(46x32). 닫기는 예전 ✕ 자리를 옮긴 것이라 하나뿐이다.
//       최대화 중(body.winmax)에는 크기 조절 손잡이를 숨긴다. 닫기 hover 는 #c42b1c.
//   (S) 호스트 메시지: winMinimize, winMaximizeToggle. 최대화는 WindowState.Maximized 가 아니라 그 창이 있는 모니터의
//       작업 영역(rcWork)으로 직접 맞추고, 직전 좌표(_normalRect)를 두었다가 복원한다. 설정에는 평소 창 좌표와
//       Maximized 를 저장하고, 켤 때 최대화로 닫았으면 최대화로 연다. 최대화 중에는 가장자리 크기 조절이 없고,
//       끌면 평소 크기로 돌아와 커서 밑에 온다. 상태는 __setWinState('max'|'normal') 로 웹에 알린다.
//   (R) jsdom: 위젯 모드로 띄워 버튼 클릭, 두 번 누르기, 최대화 중 끌기 문턱, 상태 알림, 트레이에 따른 최소화 표시를 본다.
//       ★ 가짜 호스트는 메시지를 배열에 넣기만 한다.
//       최소화 중에는 저장 좌표를 건드리지 않는다(GetWindowRect 가 -32000 자리를 준다).
//   (S) 2026-10-16 리뷰 수정: 복원은 가장 가까운 모니터의 작업 영역(물리 px)으로 당긴다(VirtualScreen DIP 에 창 DPI 를
//       곱하지 않는다). 최소화된 채로 트레이 '보이기', 아이콘, 트레이 끄기, 크기 프리셋, 모니터 이동, 초기화를 하면 먼저
//       되살린다(UnMinimize, 최대화였으면 RefitMax). 위젯 모드(트레이 끔)에서 최소화되면 바로 되살리고 최대화였으면 복원한다.
//       최대화 중 작업 영역이나 해상도가 바뀌면(WM_SETTINGCHANGE + SPI_SETWORKAREA, WM_DISPLAYCHANGE) 다시 맞춘다.
//   (M) 변이: WindowState.Maximized 로 바꾸기, Maximized 저장 빼기, 최소화 가드 빼기, 크기 조절 가드 빼기, 두 번 누르기 빼기,
//       최대화 중 끌기 문턱 빼기, 복원을 가상 화면 DIP 로 되돌리기, 최소화 되살리기 빼기, 위젯 모드 최소화 되돌림 빼기,
//       창 메시지 훅 빼기, 작업 영역 바뀜 상수 틀리기를 각각 잡는다.
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, extractCsMember, stripCsComments,
         importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';
import { readFileSync } from 'node:fs';

const app = loadAppSource();
const CS = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8').replace(/\r/g, '');

function mutate(text, find, repl) {
  const n = text.split(find).length - 1;
  assert.equal(n, 1, `변이 앵커가 ${n}번 나온다: ${find.slice(0, 60)}`);
  return text.replace(find, repl);
}
function hostBarMarkup(src) {
  const fn = extractFunction(src, 'buildHostBar');
  const a = fn.indexOf('bar.innerHTML = `');
  assert.ok(a > 0, 'buildHostBar 의 마크업 템플릿을 찾지 못했다');
  return fn.slice(a, fn.indexOf('`;', a));
}
const member = (src, sig) => extractCsMember(src, sig);

// ── (S) 웹 ───────────────────────────────────────────────────────────
function checkMarkup(src) {
  const mk = hostBarMarkup(src);
  const btns = mk.indexOf('<div class="hb-btns">'), sep = mk.indexOf('<span class="hb-sep" aria-hidden="true"></span>'), cap = mk.indexOf('<div class="hb-cap">');
  assert.ok(btns > 0 && sep > btns && cap > sep, '기능 버튼, 구분선, 창 버튼 순서가 아니다');
  const capPart = mk.slice(cap);
  const ids = [...capPart.matchAll(/<button data-host="(\w+)" id="(\w+)"/g)].map((m) => m[1] + '#' + m[2]);
  assert.deepStrictEqual(ids, ['winMinimize#hbMin', 'winMaximizeToggle#hbMax', 'close#hbClose'], '창 버튼 셋(최소화, 최대화, 닫기)의 순서와 메시지가 다르다');
  assert.strictEqual((mk.match(/data-host="close"/g) || []).length, 1, '닫기 버튼이 둘이다(예전 ✕ 를 옮겨야 한다)');
  assert.ok(!mk.slice(btns, sep).includes('data-host="close"'), '예전 ✕ 가 기능 버튼 칸에 남아 있다');
  for (const k of ['min', 'max', 'restore', 'close']) assert.match(src, new RegExp(`\\n  ${k}: +'<svg viewBox="0 0 10 10"`), `CAP_ICON.${k} 가 10x10 글리프가 아니다`);
  assert.match(mk, /id="hbMin" title="\$\{HB_TIP\.min\}" aria-label="\$\{HB_TIP\.min\}" hidden>/, '최소화가 처음에 숨어 있지 않다(트레이를 끈 위젯은 되돌릴 길이 없다)');
  assert.match(mk, /id="hbMax" title="\$\{HB_TIP\.max\}" aria-label="\$\{HB_TIP\.max\}">\$\{CAP_ICON\.max\}/, '최대화 버튼의 기본 툴팁이나 글리프가 다르다');
  for (const [k, v] of [['min', '최소화'], ['max', '최대화'], ['restore', '이전 크기로']]) assert.match(src, new RegExp(`\n  ${k}: +'${v}',`), `HB_TIP.${k} 가 '${v}' 가 아니다`);
  // CSS: 46x32, 닫기 hover 빨강, 최대화 중 손잡이 숨김
  assert.match(src, /#hostbar \.hb-cap button\{width:46px;height:32px;/, '창 버튼 크기가 46x32 가 아니다');
  assert.match(src, /#hostbar \.hb-cap button\.cap-close:hover\{background:var\(--cap-close\)\}/, '닫기 hover 가 --cap-close 가 아니다');
  assert.match(src, /\n  --cap-close:#c42b1c;/, '--cap-close 토큰이 #c42b1c 가 아니다');
  assert.match(src, /\nbody\.winmax \.rsz\{display:none\}/, '최대화 중 크기 조절 손잡이를 숨기지 않는다');
  assert.match(src, /#hostbar button:focus-visible\{outline-color:#fff;/, '제목줄 버튼 키보드 포커스 표시가 없다');
}
function checkDblAndDrag(src) {
  const fn = extractFunction(src, 'buildHostBar');
  assert.match(fn, /drag\.addEventListener\('dblclick', e => \{ if\(e\.button===0\)\{ e\.preventDefault\(\); hpost\(\{cmd:'winMaximizeToggle'\}\); \} \}\);/, '제목줄 빈 곳 두 번 누르기가 최대화 전환을 보내지 않는다');
  assert.match(fn, /if\(__winMax\)\{ maxPress = \{/, '최대화 중 누름을 바로 끌기로 시작한다(두 번 누르기 복원이 깨진다)');
  assert.match(fn, /Math\.abs\(e\.screenY - maxPress\.sy\) >= 4\)\{/, '최대화 중 끌기 문턱(4px)이 없다');
  assert.match(fn, /maxPress = null;\s*__gBegin\('move', e, drag, null, \{ fxm: /, '문턱을 넘으면 끌기 칸 안 위치(fxm)를 실어 끌기를 시작하지 않는다');
  assert.match(fn, /capw: Math\.round\(\(br\.width - dr\.width\) \* dpr\)/, '오른쪽 버튼 묶음 폭(capw)을 물리 px 로 보내지 않는다');
  //  창 크기가 바뀌면 캡처가 풀린다(실측). 다시 잡고, 못 잡아도 창 전체에서 이어 받고 끝낸다.
  assert.match(fn, /drag\.addEventListener\('lostpointercapture', e => \{\s*if\(__gesture && __gesture\.type === 'move' && \(e\.buttons & 1\)\)\{ try\{ drag\.setPointerCapture\(e\.pointerId\); \}/, '캡처를 잃었을 때 다시 잡지 않는다');
  assert.match(fn, /window\.addEventListener\('pointerup', e => \{ if\(__gesture && __gesture\.type === 'move' && e\.target !== drag\) __gEnd\(e, drag\); \}, true\);/, '캡처 없이 다른 곳에서 뗀 끌기를 끝내지 않는다');
  assert.match(src, /hpost\(Object\.assign\(\{cmd: type==='move' \? 'dragbegin' : 'resizebegin'\}, extra \|\| \{\}\)\);/, '__gBegin 이 추가 값(extra)을 싣지 않는다');
  assert.match(fn, /bar\.addEventListener\('click', ev => \{/, '버튼 위임이 창 버튼 칸까지 듣지 않는다');
  const sw = src.slice(src.indexOf('window.__setWinState = function('), src.indexOf('\n};', src.indexOf('window.__setWinState = function(')));
  assert.ok(sw.length > 30, '__setWinState 가 없다');
  assert.match(sw, /__winMax = s === 'max';/);
  assert.match(sw, /classList\.toggle\('winmax', __winMax\)/, '__setWinState 가 body.winmax 를 바꾸지 않는다');
  assert.match(sw, /CAP_ICON\.restore : CAP_ICON\.max/, '__setWinState 가 글리프를 바꾸지 않는다');
  assert.match(sw, /HB_TIP\.restore : HB_TIP\.max/, '__setWinState 가 툴팁을 바꾸지 않는다');
  assert.match(sw, /setAttribute\('aria-label', t\)/, '__setWinState 가 aria-label 을 바꾸지 않는다');
}

// ── (S) 호스트 ────────────────────────────────────────────────────────
function checkHostMessages(cs) {
  const code = stripCsComments(cs);
  assert.match(code, /case "winMinimize": MinimizeWindow\(\); break;/, '호스트에 winMinimize 가 없다');
  assert.match(code, /case "winMaximizeToggle": ToggleMaximize\(\); break;/, '호스트에 winMaximizeToggle 이 없다');
  assert.match(member(cs, 'private void ToggleMaximize()'), /if \(_maximized\) RestoreFromMax\(\); else MaximizeWindow\(\);/);
  const min = member(cs, 'private void MinimizeWindow()');
  assert.match(min, /if \(!_settings\.TrayEnabled\) return;[\s\S]*WindowState = WindowState\.Minimized;/, '최소화가 트레이 모드 가드 뒤 WindowState.Minimized 가 아니다');
  const ready = code.slice(code.indexOf('case "ready":'), code.indexOf('case "reloadState":'));
  assert.match(ready, /SendWinState\(\);/, 'ready 에서 창 상태를 알리지 않는다(다시 켰을 때 글리프가 틀린다)');
  assert.match(member(cs, 'private void SendWinState()'), /window\.__setWinState\('" \+ \(_maximized \? "max" : "normal"\) \+ "'\)/, 'SendWinState 가 __setWinState(max|normal) 를 보내지 않는다');
}
function checkWorkArea(cs) {
  const code = stripCsComments(cs);
  assert.doesNotMatch(code, /WindowState\s*=\s*WindowState\.Maximized/, 'WindowState.Maximized 를 쓴다(None+투명 창은 작업 표시줄까지 덮는다)');
  const core = member(cs, 'private void MaximizeCore()');
  const grab = core.indexOf('GetWindowRect(hwnd, out _normalRect)');
  const mon = core.search(/GetMonitorInfo\(MonitorFromWindow\(hwnd, MONITOR_DEFAULTTONEAREST\), ref mi\)/);
  const wa = core.indexOf('var wa = mi.rcWork;');
  const set = core.search(/SetWindowPos\(hwnd, IntPtr\.Zero, wa\.Left, wa\.Top, wa\.Right - wa\.Left, wa\.Bottom - wa\.Top,/);
  assert.ok(grab > 0, 'MaximizeCore 가 직전 좌표(_normalRect)를 잡지 않는다');
  assert.ok(mon > 0 && wa > mon, 'MaximizeCore 가 그 창의 모니터 작업 영역(rcWork)을 읽지 않는다');
  assert.ok(set > wa && grab < set, 'MaximizeCore 가 작업 영역으로 SetWindowPos 하지 않거나 좌표를 나중에 잡는다');
  assert.ok(!/rcMonitor/.test(core), 'MaximizeCore 가 모니터 전체(rcMonitor)를 쓴다(작업 표시줄을 덮는다)');
  assert.match(core, /_maximized = true;[\s\S]*SendWinState\(\);/, 'MaximizeCore 가 상태를 켜고 웹에 알리지 않는다');
  const rest = member(cs, 'private void RestoreFromMax()');
  assert.match(rest, /_maximized = false;/);
  assert.match(rest, /int w = _normalRect\.Right - _normalRect\.Left, h = _normalRect\.Bottom - _normalRect\.Top;/, 'RestoreFromMax 가 직전 크기로 돌아가지 않는다');
  assert.match(rest, /SetWindowPos\(hwnd, IntPtr\.Zero, rx, ry, w, h,/, 'RestoreFromMax 가 직전 좌표로 SetWindowPos 하지 않는다');
  assert.match(rest, /SendWinState\(\);\s*SaveSettings\(\);/, 'RestoreFromMax 가 웹에 알리고 저장하지 않는다');
  //  리뷰 P1-3: 모니터마다 배율이 다르면 VirtualScreen(시스템 DPI 의 DIP)에 창 DPI 를 곱한 값은 물리 px 가 아니다.
  assert.doesNotMatch(rest, /SystemParameters\.VirtualScreen|GetDpi\(/, 'RestoreFromMax 가 DIP 가상 화면에 창 DPI 를 곱해 물리 좌표를 맞춘다(배율이 다른 모니터에서 어긋난다)');
  assert.match(rest, /GetMonitorInfo\(MonitorFromRect\(ref nr, MONITOR_DEFAULTTONEAREST\), ref mi\)/, 'RestoreFromMax 가 복원 좌표에서 가장 가까운 모니터를 고르지 않는다');
  assert.match(rest, /var wa = mi\.rcWork;\s*w = Math\.Min\(w, wa\.Right - wa\.Left\); h = Math\.Min\(h, wa\.Bottom - wa\.Top\);\s*rx = Math\.Min\(Math\.Max\(rx, wa\.Left\), wa\.Right - w\);\s*ry = Math\.Min\(Math\.Max\(ry, wa\.Top\), wa\.Bottom - h\);/,
    'RestoreFromMax 가 복원 좌표를 그 모니터의 작업 영역 안으로 당기지 않는다');
  assert.match(cs, /\[DllImport\("user32\.dll"\)\] private static extern IntPtr MonitorFromRect\(ref RECT lprc, uint flags\);/, 'MonitorFromRect 선언이 없다');
  // 시스템 최대화(Win+위)도 작업 영역 최대화로 바꾼다
  const sc = member(cs, 'private void Window_StateChanged(');
  assert.match(sc, /if \(WindowState != WindowState\.Maximized\) return;\s*WindowState = WindowState\.Normal;[\s\S]*MaximizeCore\(\);/, '시스템 최대화를 가로채 작업 영역 최대화로 바꾸지 않는다');
  assert.match(code, /StateChanged \+= Window_StateChanged;/, 'StateChanged 처리기가 걸려 있지 않다');
}
function checkPersist(cs) {
  const save = member(cs, 'private void SaveSettings()');
  assert.match(save, /\(_maximized \? \(r = _normalRect\)\.Right > r\.Left\s*:/, 'SaveSettings 가 최대화 중에 직전(평소) 좌표를 저장하지 않는다');
  //  최소화 중 GetWindowRect 는 -32000 자리의 160x28 을 준다(2026-10-16 실측: 그 값이 설정에 남아 다음 실행이 기본 크기로 떴다).
  assert.match(save, /:\s*WindowState != WindowState\.Minimized && GetWindowRect\(hwnd, out r\)\)/, 'SaveSettings 가 최소화 중의 좌표(-32000)를 저장한다');
  assert.match(save, /_settings\.Maximized = _maximized;/, 'SaveSettings 가 최대화 여부를 저장하지 않는다');
  assert.match(stripCsComments(cs), /public bool Maximized \{ get; set; \} = false;/, 'WidgetSettings 에 Maximized 가 없다');
  assert.match(member(cs, 'private void Window_SourceInitialized('), /if \(_settings\.Maximized\) MaximizeCore\(\);/, '켤 때 최대화로 닫았으면 최대화로 열지 않는다');
  assert.match(member(cs, 'private void MaximizeWindow()'), /if \(!IsVisible\) Show\(\);[\s\S]*MaximizeCore\(\);\s*SaveSettings\(\);/, 'MaximizeWindow 가 보이게 한 뒤 최대화하고 저장하지 않는다');
}
function checkGestures(cs) {
  const code = stripCsComments(cs);
  assert.match(code, /case "resizebegin":\s*if \(_maximized\) break;/, '최대화 중에도 가장자리 크기 조절이 시작된다');
  assert.match(code, /case "resizemove":\s*if \(_maximized\) break;/, '최대화 중에도 가장자리 크기 조절이 움직인다');
  assert.match(code, /case "dragbegin":\s*if \(_settings\.Pinned\) break;\s*if \(_maximized\) RestoreUnderCursor\(hwnd, GetInt\(doc, "fxm"\), GetInt\(doc, "capw"\)\);\s*GetWindowRect\(hwnd, out _gestureRect\);/, '최대화 중 끌기가 평소 크기로 복원한 뒤 끌기 기준을 잡지 않는다');
  assert.match(code, /case "dragmove":\s*if \(_settings\.Pinned \|\| _maximized\) break;/, '최대화 상태에서 dragmove 가 창을 옮긴다');
  const ruc = member(cs, 'private void RestoreUnderCursor(');
  assert.match(ruc, /GetCursorPos\(out POINT pt\)/, '커서 위치를 보지 않는다');
  assert.match(ruc, /_maximized = false;[\s\S]*SetWindowPos\(hwnd, IntPtr\.Zero, x, cur\.Top, nw, nh,[\s\S]*SendWinState\(\);/, '끌어서 복원이 평소 크기로 커서 밑에 놓고 알리지 않는다');
  assert.match(ruc, /pt\.X - \(int\)\(\(long\)fxm \* \(nw - capw\) \/ 1000\)/, '끌기 칸 안 비율(fxm)로 커서 밑 자리를 정하지 않는다');
  // 크기 프리셋, 다른 모니터로 이동, 초기화는 최대화를 먼저 푼다
  assert.match(member(cs, 'private void SetSize('), /RestoreFromMax\(\);/, '크기 프리셋이 최대화를 풀지 않는다');
  assert.match(member(cs, 'private void MoveToNextMonitor()'), /RestoreFromMax\(\);/, '다른 모니터로 이동이 최대화를 풀지 않는다');
  assert.match(member(cs, 'private void ResetBounds()'), /if \(_maximized\) \{ _maximized = false; SendWinState\(\); \}/, '초기화가 최대화를 풀지 않는다');
}

//  리뷰 P1-4, P2-1: 최소화된 창을 되살리는 길. 트레이를 끈 위젯은 작업 표시줄 단추가 없어 최소화로 남으면 고립된다.
function checkUnminimize(cs) {
  const un = member(cs, 'private void UnMinimize()');
  assert.match(un, /if \(WindowState != WindowState\.Minimized\) return;\s*WindowState = WindowState\.Normal;\s*if \(_maximized\) RefitMax\(\);/, 'UnMinimize 가 Normal 로 되살리고 최대화였으면 작업 영역에 다시 맞추지 않는다');
  assert.match(member(cs, 'private void ShowFromTray()'), /^[^{]*\{\s*Show\(\);\s*UnMinimize\(\);/, "트레이 아이콘이나 '보이기' 가 최소화를 풀지 않는다");
  assert.match(member(cs, 'private void SetTrayEnabled(bool on)'), /else \{ if \(!IsVisible \|\| WindowState == WindowState\.Minimized\) ShowFromTray\(\); DisposeTray\(\); \}/, '최소화된 채 트레이를 끄면 되살리지 않는다(고립된다)');
  for (const [sig, after] of [['private void SetSize(', 'RestoreFromMax();'], ['private void MoveToNextMonitor()', 'RestoreFromMax();'], ['private void ResetBounds()', 'if (_maximized) { _maximized = false; SendWinState(); }']]) {
    const b = member(cs, sig);
    const u = b.indexOf('UnMinimize();'), a = b.indexOf(after);
    assert.ok(u >= 0 && a > u, sig + ' 가 최소화를 먼저 풀지 않는다(최소화된 창의 좌표는 -32000 자리다)');
  }
  const sc = member(cs, 'private void Window_StateChanged(');
  assert.match(sc, /if \(WindowState == WindowState\.Minimized\)\s*\{\s*if \(!_settings\.TrayEnabled\)\s*Dispatcher\.BeginInvoke\(new Action\(\(\) =>\s*\{\s*if \(WindowState != WindowState\.Minimized \|\| _settings\.TrayEnabled\) return;\s*WindowState = WindowState\.Normal;\s*if \(_maximized\) RestoreFromMax\(\);\s*ApplyDesktopMode\(\);/,
    '위젯 모드(트레이 끔)에서 최소화되면 되살리지 않는다(또는 최대화였을 때 이전 크기로 돌리지 않는다)');
  assert.ok(sc.indexOf('WindowState == WindowState.Minimized') < sc.indexOf('if (WindowState != WindowState.Maximized) return;'), '최소화 갈래가 최대화 가로채기의 return 뒤에 있다(닿지 않는다)');
}
//  리뷰 P2-3: 최대화 중 작업 영역이나 해상도가 바뀌면 지금 모니터의 작업 영역에 다시 맞춘다.
function checkWorkAreaChange(cs) {
  assert.match(member(cs, 'private void Window_SourceInitialized('), /HwndSource\.FromHwnd\(new WindowInteropHelper\(this\)\.Handle\)\?\.AddHook\(WndProc\);/, '창 메시지 훅을 걸지 않는다');
  assert.match(cs, /private const int WM_SETTINGCHANGE = 0x001A, WM_DISPLAYCHANGE = 0x007E, SPI_SETWORKAREA = 0x002F;/, '작업 영역, 해상도 바뀜 메시지 값이 다르다');
  const wp = member(cs, 'private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)');
  assert.match(wp, /if \(_maximized && \(msg == WM_DISPLAYCHANGE \|\| \(msg == WM_SETTINGCHANGE && wParam\.ToInt64\(\) == SPI_SETWORKAREA\)\)\)\s*Dispatcher\.BeginInvoke\(new Action\(RefitMax\)\);/, '최대화 중 작업 영역, 해상도 바뀜에 다시 맞추지 않는다');
  assert.match(wp, /return IntPtr\.Zero;\s*\}?\s*$/,'WndProc 가 메시지를 그대로 흘려보내지 않는다');
  assert.doesNotMatch(wp, /handled\s*=\s*true/, 'WndProc 가 메시지를 삼킨다');
  const rf = member(cs, 'private void RefitMax()');
  assert.match(rf, /if \(!_maximized \|\| WindowState == WindowState\.Minimized\) return;/, 'RefitMax 가 최대화가 아니거나 최소화 중에도 창을 옮긴다');
  assert.match(rf, /GetMonitorInfo\(MonitorFromWindow\(hwnd, MONITOR_DEFAULTTONEAREST\), ref mi\)[\s\S]*var wa = mi\.rcWork;\s*SetWindowPos\(hwnd, IntPtr\.Zero, wa\.Left, wa\.Top, wa\.Right - wa\.Left, wa\.Bottom - wa\.Top,/, 'RefitMax 가 지금 모니터의 작업 영역에 맞추지 않는다');
  assert.doesNotMatch(rf, /_normalRect/, 'RefitMax 가 복원 좌표(_normalRect)를 덮는다');
}

test('창 버튼①: 제목줄 = 기능 버튼, 구분선, 창 버튼 셋(최소화, 최대화, 닫기 46x32). 닫기는 하나, 최대화 중 손잡이 숨김', () => checkMarkup(app));
test('창 버튼②: 빈 곳 두 번 누르기 = 최대화 전환, 최대화 중 끌기는 4px 문턱, __setWinState 가 글리프와 툴팁을 바꾼다', () => checkDblAndDrag(app));
test('창 버튼③: 호스트 winMinimize, winMaximizeToggle, ready 의 상태 알림', () => checkHostMessages(CS));
test('창 버튼④: 최대화는 WindowState.Maximized 가 아니라 그 모니터의 작업 영역(rcWork)이고, 복원은 직전 좌표다', () => checkWorkArea(CS));
test('창 버튼⑤: 설정에 평소 창 좌표와 Maximized 를 저장하고, 켤 때 최대화로 연다', () => checkPersist(CS));
test('창 버튼⑥: 최대화 중 크기 조절 없음, 끌면 커서 밑으로 복원, 프리셋과 모니터 이동과 초기화는 최대화를 푼다', () => checkGestures(CS));

test('변이 M1: MaximizeCore 를 WindowState.Maximized 로 바꾸면 ④가 잡는다', () => {
  const bad = mutate(CS, '            _maximized = true;\n            SetWindowPos(hwnd, IntPtr.Zero, wa.Left',
    '            _maximized = true;\n            WindowState = WindowState.Maximized;\n            SetWindowPos(hwnd, IntPtr.Zero, wa.Left');
  assert.throws(() => checkWorkArea(bad), /WindowState\.Maximized/);
});
test('변이 M2: rcWork 대신 rcMonitor 를 쓰면 ④가 잡는다', () => {
  const bad = mutate(CS, 'var wa = mi.rcWork;                   // 그 창이 있는 모니터의 작업 영역', 'var wa = mi.rcMonitor;                // 그 창이 있는 모니터의 작업 영역');
  assert.throws(() => checkWorkArea(bad));
});
test('변이 M3: Maximized 저장을 빼면 ⑤가 잡는다', () => {
  const bad = mutate(CS, '                    _settings.Maximized = _maximized;\n', '');
  assert.throws(() => checkPersist(bad), /최대화 여부/);
});
test('변이 M4: 최대화 중 크기 조절 가드를 빼면 ⑥이 잡는다', () => {
  const bad = mutate(CS, '                        if (_maximized) break;   // 최대화 중에는 가장자리 크기 조절이 없다', '                        //');
  assert.throws(() => checkGestures(bad), /크기 조절/);
});
test('변이 M5: 최대화 중 저장이 지금 좌표를 쓰면 ⑤가 잡는다', () => {
  const bad = mutate(CS, '(_maximized ? (r = _normalRect).Right > r.Left', '(false ? (r = _normalRect).Right > r.Left');
  assert.throws(() => checkPersist(bad), /직전/);
});
test('변이 M6: 최소화 가드를 빼면 ⑤가 잡는다', () => {
  const bad = mutate(CS, ': WindowState != WindowState.Minimized && GetWindowRect(hwnd, out r)', ': GetWindowRect(hwnd, out r)');
  assert.throws(() => checkPersist(bad), /최소화/);
});
test('창 버튼⑦: 최소화된 채로 트레이 보이기, 트레이 끄기, 프리셋, 모니터 이동, 초기화를 하면 먼저 되살리고, 위젯 모드의 최소화는 바로 되돌린다', () => checkUnminimize(CS));
test('창 버튼⑧: 최대화 중 작업 영역이나 해상도가 바뀌면 지금 모니터의 작업 영역에 다시 맞춘다(복원 좌표는 그대로)', () => checkWorkAreaChange(CS));
test('변이 M7: 복원을 예전처럼 가상 화면 DIP 에 창 DPI 를 곱해 맞추면 ④가 잡는다', () => {
  const bad = mutate(CS, '                var nr = _normalRect;\n', '                var nr = _normalRect;\n                var pdpi = VisualTreeHelper.GetDpi(this); int vlp = (int)(SystemParameters.VirtualScreenLeft * pdpi.DpiScaleX);\n');
  assert.throws(() => checkWorkArea(bad), /DIP 가상 화면/);
});
test('변이 M8: 트레이 보이기의 되살리기, 트레이 끄기의 최소화 조건, 프리셋의 되살리기를 각각 빼면 ⑦이 잡는다', () => {
  assert.throws(() => checkUnminimize(mutate(CS, '            Show();\n            UnMinimize();   // 최소화된 채로', '            Show();\n            //   최소화된 채로')), /보이기/);
  assert.throws(() => checkUnminimize(mutate(CS, 'if (!IsVisible || WindowState == WindowState.Minimized) ShowFromTray();', 'if (!IsVisible) ShowFromTray();')), /트레이를 끄면/);
  assert.throws(() => checkUnminimize(mutate(CS, '            UnMinimize();       // 최소화 중이면 먼저 되살린다\n', '')), /SetSize\( 가 최소화를 먼저 풀지 않는다/);
});
test('변이 M9: 위젯 모드 최소화 되돌림을 빼면 ⑦이 잡는다', () => {
  const bad = mutate(CS, '                if (!_settings.TrayEnabled)\n                    Dispatcher.BeginInvoke(', '                if (false)\n                    Dispatcher.BeginInvoke(');
  assert.throws(() => checkUnminimize(bad), /위젯 모드/);
});
test('변이 M10: 창 메시지 훅을 빼거나 SPI_SETWORKAREA 값을 틀리면 ⑧이 잡는다', () => {
  assert.throws(() => checkWorkAreaChange(mutate(CS, '?.AddHook(WndProc);', ';')), /훅/);
  assert.throws(() => checkWorkAreaChange(mutate(CS, 'SPI_SETWORKAREA = 0x002F;', 'SPI_SETWORKAREA = 0x0030;')), /메시지 값/);
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom 실행: 위젯 모드, 가짜 호스트(전달 없음)
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('window-buttons: jsdom 미설치. 창 버튼 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const tick = () => new Promise((r) => setTimeout(r, 20));
  function boot(source) {
    const posted = [];
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/',
      virtualConsole: jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined,
      beforeParse(win) {
        win.chrome = { webview: {
          postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); },
          addEventListener() {}, removeEventListener() {},
        } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        if (!win.CSS) win.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
      },
    });
    const w = dom.window;
    const ev = (code) => w.eval(code);
    const sess = posted.find((x) => x && x.cmd === 'userSessionGet');
    if (sess) ev('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'tester', name: '시험자' } }) + ')');
    return { w, posted, ev, doc: w.document, close: async () => { await tick(); try { w.close(); } catch (_) {} } };
  }
  const cmds = (m, from) => m.posted.slice(from).map((x) => x && x.cmd).filter(Boolean);
  const mouse = (m, el, type, x, y) => el.dispatchEvent(new m.w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, screenX: x, screenY: y }));

  // 실행 검사기. 변이 시험이 재사용한다.
  function runDbl(m) {
    const n = m.posted.length;
    mouse(m, m.doc.getElementById('hbDrag'), 'dblclick', 10, 10);
    const onDrag = cmds(m, n);
    const n2 = m.posted.length;
    mouse(m, m.doc.getElementById('hbPin'), 'dblclick', 10, 10);
    return { onDrag, onBtn: cmds(m, n2) };
  }
  function runMaxDrag(m) {
    m.ev("__setPinned(false); __setWinState('max')");
    const d = m.doc.getElementById('hbDrag');
    const n = m.posted.length;
    mouse(m, d, 'pointerdown', 100, 10);
    mouse(m, d, 'pointermove', 102, 10);   // 문턱(4px) 아래
    const small = cmds(m, n);
    mouse(m, d, 'pointermove', 108, 12);   // 문턱 넘음
    const big = cmds(m, n);
    mouse(m, d, 'pointerup', 108, 12);
    const all = cmds(m, n);
    m.ev("__setWinState('normal'); __setPinned(true)");
    return { small, big, all };
  }

  let M = null, bootErr = null;
  try { M = boot(app); } catch (e) { bootErr = e; }
  if (bootErr) {
    test('R0: 위젯 모드 부팅', () => { throw bootErr; });
  } else {
    test('R1: 창 버튼을 누르면 winMinimize, winMaximizeToggle, close 를 보낸다', () => {
      M.ev('__setTray(true)');
      for (const [id, cmd] of [['hbMin', 'winMinimize'], ['hbMax', 'winMaximizeToggle'], ['hbClose', 'close']]) {
        const n = M.posted.length;
        M.doc.getElementById(id).click();
        assert.deepStrictEqual(cmds(M, n), [cmd], `#${id} 가 ${cmd} 를 보내지 않는다`);
      }
      const bar = M.doc.getElementById('hostbar');
      assert.deepStrictEqual([...bar.querySelectorAll('.hb-cap button')].map((b) => b.getAttribute('aria-label')),
        ['최소화', '최대화', bar.querySelector('#hbClose').title], '창 버튼 aria-label 이 다르다');
    });
    test('R2: 트레이 켬이면 최소화가 보이고, 끄면 숨는다', () => {
      M.ev('__setTray(true)');
      assert.strictEqual(M.doc.getElementById('hbMin').hidden, false);
      M.ev('__setTray(false)');
      assert.strictEqual(M.doc.getElementById('hbMin').hidden, true, '트레이를 끈 위젯에서 최소화가 보인다');
    });
    test('R3: __setWinState(max) = 이전 크기로 글리프와 툴팁, body.winmax. normal 이면 돌아온다', () => {
      const b = M.doc.getElementById('hbMax');
      M.ev("__setWinState('max')");
      assert.ok(M.doc.body.classList.contains('winmax'));
      assert.strictEqual(b.title, '이전 크기로'); assert.strictEqual(b.getAttribute('aria-label'), '이전 크기로');
      assert.ok(b.querySelector('svg rect') && b.querySelector('svg path'), '이전 크기로 글리프(겹친 사각형)가 아니다');
      M.ev("__setWinState('normal')");
      assert.ok(!M.doc.body.classList.contains('winmax'));
      assert.strictEqual(b.title, '최대화');
      assert.ok(b.querySelector('svg rect') && !b.querySelector('svg path'), '최대화 글리프(사각형 하나)가 아니다');
    });
    test('R4: 제목줄 빈 곳 두 번 누르기는 winMaximizeToggle, 버튼 위 두 번 누르기는 아니다', () => {
      const r = runDbl(M);
      assert.deepStrictEqual(r.onDrag, ['winMaximizeToggle']);
      assert.ok(!r.onBtn.includes('winMaximizeToggle'), '버튼 위 두 번 누르기가 최대화를 바꾼다');
    });
    test('R5: 최대화 중 누름은 4px 넘게 움직여야 dragbegin, 그 뒤 dragmove 와 dragend', () => {
      const r = runMaxDrag(M);
      assert.deepStrictEqual(r.small, [], '최대화 중 누르기만 해도 끌기가 시작됐다(두 번 누르기 복원이 깨진다)');
      assert.deepStrictEqual(r.big.slice(0, 1), ['dragbegin']);
      assert.ok(r.all.includes('dragend'));
    });
    test('R6: 맨 앞 중 Esc 는 focus 를 보낸다', () => {
      M.ev('__setFocus(true)');
      const n = M.posted.length;
      M.doc.dispatchEvent(new M.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert.deepStrictEqual(cmds(M, n), ['focus']);
      M.ev('__setFocus(false)');
    });

    test('변이 R-M1: 두 번 누르기 처리를 빼면 R4 가 잡는다', async () => {
      const bad = mutate(app, "  drag.addEventListener('dblclick', e => { if(e.button===0){ e.preventDefault(); hpost({cmd:'winMaximizeToggle'}); } });\n", '');
      const B = boot(bad);
      try { assert.deepStrictEqual(runDbl(B).onDrag, [], '변이가 닿지 않았다'); } finally { await B.close(); }
    });
    test('변이 R-M2: 최대화 중 끌기 문턱을 빼면 R5 가 잡는다', async () => {
      const bad = mutate(app, "    if(__winMax){ maxPress = {", "    if(false){ maxPress = {");
      const B = boot(bad);
      try { assert.notDeepStrictEqual(runMaxDrag(B).small, [], '변이가 닿지 않았다'); } finally { await B.close(); }
    });
    test('R 정리: 부팅한 위젯 창을 닫는다', async () => { await M.close(); });
  }
}
