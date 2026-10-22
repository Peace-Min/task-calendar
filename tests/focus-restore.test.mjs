// 맨 앞에 띄우기(docs/WINDOW-UI.md §2, 2026-10-16 단순화). 예전 BUG-FOCUS-RESTORE 시험을 새 계약으로 옮겼다.
//
// 예전: 화면 가운데 1100x800 으로 키우고 뒤를 어둡게(스크림) 했다. 켜진 채 저장되면 확대 좌표가 평소 창으로 남아
//       ba5c535 가 진입 전 좌표(_preFocusRect)를 저장하게 고쳤다.
// 지금: 크기와 위치는 그대로 두고 Topmost 만 켠다. 크기가 바뀌지 않으니 저장 보정도 필요 없다(그 코드는 지웠다).
//
// 이 파일이 지키는 것:
//   (S) 맨 앞 경로(ToggleFocusMode, EnterFront, LeaveFront)는 창 좌표와 크기를 건드리지 않는다
//       (SetWindowPos, Left/Top/Width/Height 대입, 모니터 조회 없음). 켜면 Topmost = true, 끄면 false.
//   (S) 스크림(딤 배경 창)과 진입 전 좌표, OpenBig/CloseBig 이 남아 있지 않다. SaveSettings 는 맨 앞 여부를 보지 않는다.
//   (S) ba5c535 에서 남길 것: 숨었거나 최소화된 채로 켜면 먼저 보이게 하고 최소화를 푼다(Topmost 보다 먼저).
//   (S) 핀(최하위) 모드와의 관계: 맨 앞 중에는 ApplyDesktopMode 와 Window_Deactivated 가 최하위로 내리지 않는다.
//       끄면 ApplyDesktopMode 로 원래 자리(위젯 모드면 최하위)로 돌아간다.
//   (S) Esc: 웹 keydown 이 맨 앞 중이면 "focus" 를 보내고, 호스트 "focus" 는 ToggleFocusMode 다.
//   (S) 2026-10-16 리뷰 P1-2: 맨 앞 중에는 열람 창(PeerWindow)도 맨 위 띠에 둔다. 켜고 끌 때 SyncPeerTopmost 가 맞추고,
//       열람 창을 열거나 앞으로 가져올 때(BringToFront)는 FrontActive 를 따른다. 끈 뒤에 열람 창이 Topmost 로 남지 않는다.
//   (M) 변이: 진입 전 표시 제거, 순서 뒤집기, 맨 앞 경로에 SetWindowPos 추가, 스크림 부활, 가드 제거,
//       열람 창 맞추기를 끌 때 빼기, BringToFront 의 Topmost 빼기를 각각 잡는다.
import { test, assert, extractCsMember, stripCsComments, loadAppSource, readText } from './harness.mjs';

const SRC = readText(new URL('../widget/MainWindow.xaml.cs', import.meta.url)).replace(/\r/g, '');
const APPCS = readText(new URL('../widget/App.xaml.cs', import.meta.url)).replace(/\r/g, '');
const APP = loadAppSource();
const PWCS = readText(new URL('../widget/PeerWindow.cs', import.meta.url)).replace(/\r/g, '');

const body = (src, sig) => extractCsMember(src, sig);

//  맨 앞 경로가 창의 자리나 크기를 바꾸는 표현. 하나라도 있으면 '크기와 위치는 그대로' 가 깨진다.
const MOVES = [
  [/\bSetWindowPos\s*\(/, 'SetWindowPos'],
  [/\bMoveWindow\s*\(/, 'MoveWindow'],
  [/(?<![.\w])(?:Left|Top|Width|Height)\s*=(?!=)/, 'Left/Top/Width/Height 대입'],
  [/\bGetMonitorInfo\s*\(|\bMonitorFromWindow\s*\(/, '모니터 조회(크기 계산)'],
  [/\bWindowState\s*=\s*WindowState\.Maximized/, 'WindowState.Maximized'],
  [/\bShowScrim\s*\(|\b_scrim\b/, '스크림'],
];

function checkFrontPath(src) {
  const toggle = body(src, 'private void ToggleFocusMode()');
  assert.match(toggle, /if \(!_focusMode\) EnterFront\(\); else LeaveFront\(\);/, 'ToggleFocusMode 가 EnterFront/LeaveFront 갈래가 아니다');
  const enter = body(src, 'private void EnterFront()');
  const leave = body(src, 'private void LeaveFront()');
  for (const [name, b] of [['ToggleFocusMode', toggle], ['EnterFront', enter], ['LeaveFront', leave]]) {
    for (const [re, what] of MOVES) assert.doesNotMatch(b, re, `${name} 이 창 자리나 크기를 바꾼다(${what}). 맨 앞에 띄우기는 Topmost 만 켠다`);
  }
  assert.match(enter, /_focusMode = true;[\s\S]*Topmost = true;/, 'EnterFront 가 _focusMode 를 켠 뒤 Topmost = true 로 올리지 않는다');
  assert.match(enter, /SendFocusState\(\);/, 'EnterFront 가 웹에 상태를 알리지 않는다');
  assert.match(leave, /_focusMode = false;[\s\S]*Topmost = false;[\s\S]*ApplyDesktopMode\(\);/, 'LeaveFront 가 Topmost 를 끄고 원래 z 순서(ApplyDesktopMode)로 돌리지 않는다');
  assert.match(leave, /SendFocusState\(\);/, 'LeaveFront 가 웹에 상태를 알리지 않는다');
}

function checkShowFirst(src) {
  const enter = body(src, 'private void EnterFront()');
  const show = enter.indexOf('if (!IsVisible) Show();');
  const norm = enter.indexOf('if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;');
  const top = enter.indexOf('Topmost = true;');
  assert.ok(show >= 0, 'EnterFront 가 숨은(트레이) 창을 보이게 하지 않는다');
  assert.ok(norm >= 0, 'EnterFront 가 최소화를 풀지 않는다');
  assert.ok(top >= 0 && show < top && norm < top, '보이게 하기 전에 Topmost 를 켠다(숨은 채 맨 위로만 올라간다)');
}

function checkNoLegacy(src, appcs) {
  const code = stripCsComments(src);
  for (const w of ['_scrim', 'ShowScrim', 'CleanupScrim', '_preFocusRect', 'OpenBig', 'CloseBig']) {
    assert.ok(!code.includes(w), `예전 맨 앞(확대) 코드 ${w} 가 남아 있다`);
  }
  assert.ok(!/\b1100\b/.test(code), '예전 확대 크기(1100)가 코드에 남아 있다');
  assert.ok(!stripCsComments(appcs).includes('CleanupScrim'), 'App.xaml.cs 가 없어진 CleanupScrim 을 부른다');
  const save = body(src, 'private void SaveSettings()');
  assert.doesNotMatch(save, /_focusMode/, 'SaveSettings 가 맨 앞 여부를 본다(크기가 안 바뀌므로 볼 것이 없다)');
}

function checkGuards(src) {
  assert.match(body(src, 'private void ApplyDesktopMode()'), /^[^{]*\{\s*if \(_focusMode\) return;/, 'ApplyDesktopMode 가 맨 앞 중에도 최하위로 내린다');
  assert.match(body(src, 'private void Window_Deactivated('), /^[^{]*\{\s*if \(_focusMode\) return;/, 'Window_Deactivated 가 맨 앞 중에도 최하위로 내린다');
  assert.match(body(src, 'private void HideToTray()'), /if \(_focusMode\) LeaveFront\(\);/, '트레이로 숨길 때 맨 앞을 풀지 않는다');
  assert.match(stripCsComments(src), /case "focus": ToggleFocusMode\(\); break;/, '호스트 "focus" 가 ToggleFocusMode 가 아니다');
}

function checkPeerTopmost(src, pw) {
  const enter = body(src, 'private void EnterFront()');
  const leave = body(src, 'private void LeaveFront()');
  assert.match(enter, /_focusMode = true;\s*SyncPeerTopmost\(\);\s*Topmost = true;/, '맨 앞을 켤 때 열람 창을 맨 위 띠로 올리지 않는다(메인 창 뒤에 깔린다)');
  assert.match(leave, /_focusMode = false;\s*Topmost = false;\s*SyncPeerTopmost\(\);/, '맨 앞을 끌 때 열람 창을 맨 위 띠에서 내리지 않는다(풀린 뒤에도 다른 창을 가린다)');
  assert.match(body(src, 'private void SyncPeerTopmost()'), /if \(_peerWin != null\) _peerWin\.Topmost = _focusMode;/, 'SyncPeerTopmost 가 열람 창 Topmost 를 맨 앞 상태에 맞추지 않는다');
  assert.match(stripCsComments(src), /internal bool FrontActive => _focusMode;/, 'FrontActive 가 맨 앞 상태가 아니다');
  assert.match(body(pw, 'public void BringToFront()'), /Topmost = _host\.FrontActive;\s*Activate\(\);/, '열람 창을 열거나 앞으로 가져올 때 맨 앞 상태를 따르지 않는다');
}

function checkEsc(app) {
  assert.ok(/if\(window\.__big\)\{ hpost\(\{cmd:'focus'\}\); ev\.preventDefault\(\); return; \}/.test(app), '웹 Esc 가 맨 앞 중에 "focus" 를 보내지 않는다');
}

function mutate(text, find, repl) {
  const n = text.split(find).length - 1;
  assert.equal(n, 1, `변이 앵커가 ${n}번 나온다: ${find.slice(0, 50)}`);
  return text.replace(find, repl);
}

test('맨 앞①: ToggleFocusMode, EnterFront, LeaveFront 는 창 자리와 크기를 건드리지 않고 Topmost 만 바꾼다', () => checkFrontPath(SRC));
test('맨 앞②: 숨었거나 최소화된 채로 켜면 먼저 보이게 하고 최소화를 푼 뒤 Topmost 를 켠다', () => checkShowFirst(SRC));
test('맨 앞③: 스크림, 진입 전 좌표, OpenBig/CloseBig, 1100 확대가 없고 SaveSettings 는 맨 앞을 보지 않는다', () => checkNoLegacy(SRC, APPCS));
test('맨 앞④: 맨 앞 중에는 최하위로 내리지 않고(핀 모드 가드), 숨기면 푼다', () => checkGuards(SRC));
test('맨 앞⑤: Esc 는 맨 앞 중에 "focus" 를 보내 푼다', () => checkEsc(APP));
test('맨 앞⑦: 맨 앞 중에는 열람 창도 맨 위 띠에 두고(열 때, 앞으로 가져올 때 포함), 끄면 함께 내린다', () => checkPeerTopmost(SRC, PWCS));
test('맨 앞⑥: 종료(Window_Closing)도 SaveSettings 를 거친다', () => {
  assert.match(body(SRC, 'private void Window_Closing('), /SaveSettings\(\);/, 'Window_Closing 이 창 좌표를 저장하지 않는다');
});

// 'if (!IsVisible) Show();' 는 SummonToFront, MaximizeWindow 에도 있어서 EnterFront 의 것은 바로 앞 주석 줄과 묶어 고른다.
const NOTE = '먼저 보이게 한다(BUG-FOCUS-RESTORE).\n';
const SHOW = '            if (!IsVisible) Show();\n';
test('변이①: 진입 전 표시를 지우면 ②가 실패한다', () => {
  const bad = mutate(SRC, NOTE + SHOW, NOTE);
  assert.throws(() => checkShowFirst(bad), /보이게/);
});
//  'Topmost = true;' 는 SummonToFront 에도 있어서 EnterFront 의 것은 다음 줄(Activate 와 그 주석)과 묶어 고른다.
const TOP = '            Topmost = true;\n';
const ACT = '            Activate();                           // Esc 수신용 키보드 포커스\n';
test('변이②: Topmost 를 먼저 켜면 ②가 실패한다', () => {
  let bad = mutate(SRC, TOP + ACT, ACT);
  bad = mutate(bad, NOTE + SHOW, NOTE + TOP + SHOW);
  assert.throws(() => checkShowFirst(bad), /Topmost/);
});
test('변이③: EnterFront 에 크기 바꾸기(SetWindowPos)를 넣으면 ①이 실패한다', () => {
  const bad = mutate(SRC, TOP + ACT,
    TOP + '            SetWindowPos(new WindowInteropHelper(this).Handle, HWND_TOPMOST, 0, 0, 1100, 800, SWP_NOACTIVATE);\n' + ACT);
  assert.throws(() => checkFrontPath(bad), /SetWindowPos/);
});
test('변이④: LeaveFront 가 Width 를 되돌리면 ①이 실패한다', () => {
  const bad = mutate(SRC, '            Topmost = false;\n', '            Topmost = false;\n            Width = 455;\n');
  assert.throws(() => checkFrontPath(bad), /Width/);
});
test('변이⑤: 스크림 필드를 되살리면 ③이 실패한다', () => {
  const bad = mutate(SRC, '        private RECT _normalRect;', '        private Window? _scrim;\n        private RECT _normalRect;');
  assert.throws(() => checkNoLegacy(bad, APPCS), /_scrim/);
});
test('변이⑥: Window_Deactivated 의 맨 앞 가드를 지우면 ④가 실패한다', () => {
  const bad = mutate(SRC, '            if (_focusMode) return;   // 포커스 모드 중에는 맨 앞 유지(클릭해도 안 내려감)\n', '');
  assert.throws(() => checkGuards(bad), /Deactivated/);
});
test('변이⑧: 끌 때 열람 창 맞추기를 빼거나, BringToFront 의 Topmost 를 빼면 ⑦이 실패한다', () => {
  const bad = mutate(SRC, '            SyncPeerTopmost();                    // 열람 창도 맨 위 띠에서 내린다', '            //  열람 창도 맨 위 띠에서 내린다');
  assert.throws(() => checkPeerTopmost(bad, PWCS), /끌 때/);
  const badPw = mutate(PWCS, '            Topmost = _host.FrontActive;', '');
  assert.throws(() => checkPeerTopmost(SRC, badPw), /맨 앞 상태를 따르지 않는다/);
});
test('변이⑦: 웹 Esc 해제를 지우면 ⑤가 실패한다', () => {
  const bad = mutate(APP, "if(window.__big){ hpost({cmd:'focus'}); ev.preventDefault(); return; }", '');
  assert.throws(() => checkEsc(bad), /Esc/);
});
