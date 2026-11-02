// 과제 일정 폼의 날짜와 종일(2026-11-02, v5 녹화 보고와 실제 위젯 재현).
//   1) 시작일을 옮기면 종료일도 같은 만큼(개인 폼과 같다). 2) 종료일이 시작일보다 빠르면 여러 날로 치지 않고 오류 줄.
//   3) 여러 날이라 잠겨 강제로 켜진 종일은 하루로 돌아오면 사용자가 고른 값으로 돌아간다.
// (S) 정적, (M) 변이.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';

const app = loadAppSource();
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 80));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 80));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
const checks = {
  sync(src) {
    const f = extractFunction(src, 'pcFormSync');
    assert.ok(/multi = !!s && !!e && e > s/.test(f), '여러 날 판정이 e > s 가 아니다(종료가 빠른 경우까지 여러 날로 친다)');
    assert.ok(/ad\.checked = multi \|\| pcfAllDayUser;/.test(f), '잠긴 동안 강제 켬이 사용자 선택을 덮는다');
    assert.ok(!/if\(multi\) pcfAllDayUser = true;/.test(f), '여러 날일 때 사용자 선택을 켬으로 덮는 줄이 남아 있다');
    assert.ok(/if\(bad\)\{ er\.textContent = PCF_RANGE_ERR; \}/.test(f), '종료가 빠를 때 오류 줄이 없다');
  },
  start(src) {
    const f = extractFunction(src, 'pcStartChanged');
    assert.ok(/ed\.value = addDays\(ed\.value, diffDays\(pcfPrevStart, s\)\)/.test(f), '시작일을 옮길 때 종료일을 같은 만큼 옮기지 않는다');
    assert.ok(/else if\(id === 'pcfStart'\) pcStartChanged\(\);/.test(src), '시작일 change 에 pcStartChanged 가 걸려 있지 않다');
    assert.ok(/pcfPrevStart = e\.startDate \|\| ''; pcfAllDayUser = !isNew && !e\.startTime;/.test(extractFunction(src, 'pcFormFill')), '폼을 열 때 이전 시작일과 사용자 종일 값을 잡지 않는다');
  },
};
test('(S) 종일: 여러 날은 e > s 만, 하루로 돌아오면 사용자 선택, 종료가 빠르면 오류 줄', () => checks.sync(app));
test('(S) 시작일을 옮기면 종료일도 같은 만큼', () => checks.start(app));
test('(M) 옛 규칙(강제 켬이 사용자 값을 덮음, s !== e)으로 되돌리면 잡는다', () => {
  assert.throws(() => checks.sync(mutate(app, 'ad.disabled = multi; ad.checked = multi || pcfAllDayUser;', 'if(multi) pcfAllDayUser = true;\n  ad.disabled = multi; ad.checked = pcfAllDayUser;')));
  assert.throws(() => checks.sync(mutate(app, 'multi = !!s && !!e && e > s;', 'multi = !!s && !!e && s !== e;')));
  assert.throws(() => checks.start(mutate(app, " else if(id === 'pcfStart') pcStartChanged();", '')));
});
