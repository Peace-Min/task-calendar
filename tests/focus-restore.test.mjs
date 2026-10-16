// 맨 앞에 띄우기 뒤 창이 이상한 크기로 열리던 문제(docs/BUG-FOCUS-RESTORE.md).
//
// 이 파일이 지키는 것:
//   (S) SaveSettings 는 맨 앞 모드 중이면 지금 창 좌표가 아니라 진입 전 좌표(_preFocusRect)를 저장한다.
//       종료(Window_Closing), 끌기 끝, 설정 변경 등 어느 경로로 불려도 확대 좌표가 평소 창으로 기록되지 않는다.
//   (S) OpenBig 은 진입 전 좌표를 잡기 전에 숨은 창을 보이게 하고 최소화를 푼다.
//   (M) 변이: 맨 앞 분기 제거, 진입 전 표시 제거, 순서 뒤집기를 각각 잡는다.
import { test, assert, stripCsComments } from './harness.mjs';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8').replace(/\r/g, '');

// 메서드 본문을 이름으로 잘라 온다(다음 private/public 선언 앞까지).
function methodBody(src, sig) {
  const s = src.indexOf(sig);
  assert.ok(s >= 0, `${sig} 를 찾지 못했다`);
  const rest = src.slice(s + sig.length);
  const m = /\n\s{8}(private|public|internal|protected)\s/.exec(rest);
  return stripCsComments(m ? rest.slice(0, m.index) : rest);
}

function checkSave(src) {
  const body = methodBody(src, 'private void SaveSettings()');
  assert.match(body, /_focusMode\s*\?\s*\(r\s*=\s*_preFocusRect\)/, 'SaveSettings 가 맨 앞 모드에서 _preFocusRect 를 쓰지 않는다');
  assert.match(body, /:\s*GetWindowRect\(hwnd,\s*out r\)/, 'SaveSettings 의 평소 경로가 GetWindowRect 가 아니다');
  assert.doesNotMatch(body, /if\s*\(hwnd != IntPtr\.Zero && GetWindowRect\(hwnd, out RECT r\)\)/, '맨 앞 모드를 보지 않는 옛 저장식이 남아 있다');
}

function checkOpen(src) {
  const body = methodBody(src, 'private void OpenBig()');
  const show = body.indexOf('if (!IsVisible) Show();');
  const norm = body.indexOf('if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;');
  const grab = body.indexOf('GetWindowRect(hwnd, out _preFocusRect)');
  assert.ok(show >= 0, 'OpenBig 이 숨은 창을 보이게 하지 않는다');
  assert.ok(norm >= 0, 'OpenBig 이 최소화를 풀지 않는다');
  assert.ok(grab >= 0, 'OpenBig 이 진입 전 좌표를 잡지 않는다');
  assert.ok(show < grab && norm < grab, '진입 전 좌표를 보이게 하기 전에 잡는다');
}

function checkClosing(src) {
  const body = methodBody(src, 'private void Window_Closing(');
  assert.match(body, /SaveSettings\(\);/, 'Window_Closing 이 창 좌표를 저장하지 않는다(이 시험의 전제가 바뀌었다)');
}

function mutate(text, find, repl) {
  const n = text.split(find).length - 1;
  assert.equal(n, 1, `변이 앵커가 ${n}번 나온다: ${find.slice(0, 50)}`);
  return text.replace(find, repl);
}

test('맨 앞 복원①: SaveSettings 는 맨 앞 모드 중이면 진입 전 좌표를 저장한다', () => checkSave(SRC));
test('맨 앞 복원②: OpenBig 은 보이게 하고 최소화를 푼 뒤 진입 전 좌표를 잡는다', () => checkOpen(SRC));
test('맨 앞 복원③: 종료(Window_Closing)도 SaveSettings 를 거친다', () => checkClosing(SRC));

test('변이①: 맨 앞 분기를 지우면 ①이 실패한다', () => {
  const bad = mutate(SRC, '(_focusMode ? (r = _preFocusRect).Right > r.Left : GetWindowRect(hwnd, out r))', 'GetWindowRect(hwnd, out r)');
  assert.throws(() => checkSave(bad));
});
// 'if (!IsVisible) Show();' 는 SummonToFront 에도 있어서 OpenBig 의 것은 바로 앞 주석 줄과 묶어 고른다.
const NOTE = '먼저 보이게 한 뒤 좌표를 잡는다(BUG-FOCUS-RESTORE).\n';
const SHOW = '            if (!IsVisible) Show();\n';
test('변이②: 진입 전 표시를 지우면 ②가 실패한다', () => {
  const bad = mutate(SRC, NOTE + SHOW, NOTE);
  assert.throws(() => checkOpen(bad));
});
test('변이③: 좌표를 먼저 잡으면 ②가 실패한다', () => {
  const grab = '            GetWindowRect(hwnd, out _preFocusRect);   // 복원 기준(절대 settings 재계산 안 함)\n';
  let bad = mutate(SRC, grab, '');
  bad = mutate(bad, NOTE + SHOW, NOTE + grab + SHOW);
  assert.throws(() => checkOpen(bad));
});
