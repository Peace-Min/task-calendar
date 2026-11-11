// 부팅(다시 읽기) 스냅샷은 화면에 넣기가 성공한 뒤에만 바꾼다(0.28.0, docs/ITEM-ORDER.md §5 F3 뒤 검토).
//
// 왜 있나
//   BootFromDbAsync 가 서버 스냅샷을 먼저 _calSnap 에 넣고 화면 주입(ExecuteScriptAsync)이 실패하면,
//   스냅샷에는 있고 화면에는 없는 행(예: 방금 [개인 일정에 등록]한 일정)이 생긴다.
//   바뀐 행만 쓰는 저장은 "스냅샷에 있었는데 화면에 없는 행"을 지운 것으로 보고 DB 에서 지운다.
//   그래서 주입 결과가 'ok' 일 때만 스냅샷을 바꾸는지 본다(웹 안의 예외도 'err' 로 돌려받는다).
import { test, skip, assert, readText, loadAppSource, importOptional, SKIP_NO_JSDOM } from './harness.mjs';

const cs = readText(new URL('../widget/MainWindow.xaml.cs', import.meta.url));

const bootBody = (src) => {
  const i = src.indexOf('private async Task BootFromDbAsync()');
  assert.ok(i >= 0, 'BootFromDbAsync 가 없다');
  const j = src.indexOf('//  DB 모드 저장', i);
  return src.slice(i, j > i ? j : i + 6000);
};

const check = (src) => {
  const b = bootBody(src);
  assert.ok(!/_calSnap\s*=\s*snap\s*;/.test(b), '서버 스냅샷을 화면 주입 전에 바로 _calSnap 에 넣는다');
  //  __applyState 는 안에서 예외를 삼키고 false 를 돌려준다. 던지기만 보면 늘 'ok' 다(0.28.0 검토 P2)
  assert.ok(/return window\.__applyState\([^;]*\)===false\?'err':'ok'\}catch\(e\)\{return 'err'\}/.test(b), '화면 주입이 웹 안에서 실패했는지(반환값 false) 돌려받지 않는다');
  const k = b.indexOf('ExecuteScriptAsync(js)'), m = b.indexOf('_calSnap = newSnap');
  assert.ok(k >= 0 && m > k, '스냅샷 교체가 화면 주입 뒤가 아니다');
  assert.ok(/if \(res == "\\"ok\\""\)/.test(b), '주입 결과가 ok 일 때만 바꾸지 않는다');
};

test('부팅 스냅샷: 화면 주입이 ok 일 때만 _calSnap 을 바꾼다', () => check(cs));
test('변이: 예전처럼 주입 전에 바로 넣으면 잡힌다', () => {
  const bad = cs.replace('newSnap = snap;', '_calSnap = snap;');
  assert.notStrictEqual(bad, cs, '변이 앵커가 없다');
  assert.throws(() => check(bad), /바로 _calSnap/);
});
test('변이: 결과를 보지 않고 바꾸면 잡힌다', () => {
  const bad = cs.replace('if (res == "\\"ok\\"") { if (newSnap != null) _calSnap = newSnap; }', 'if (newSnap != null) _calSnap = newSnap;');
  assert.notStrictEqual(bad, cs, '변이 앵커가 없다');
  assert.throws(() => check(bad), /ok 일 때만/);
});
test('변이: 반환값을 보지 않고 늘 ok 를 돌려주면(예전 꼴) 잡힌다', () => {
  const bad = cs.replace(")===false?'err':'ok'}catch(e){return 'err'}", ");return 'ok'}catch(e){return 'err'}").replace('try{return window.__applyState(', 'try{window.__applyState(');
  assert.notStrictEqual(bad, cs, '변이 앵커가 없다');
  assert.throws(() => check(bad), /반환값 false/);
});

//  웹 쪽: __applyState 는 적용하면 true, 안에서 실패해 옛 화면을 두면 false 를 돌려준다(호스트가 이것으로 가른다)
const app = loadAppSource();
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;
async function applyResults(src) {
  const { window: w } = new JSDOM(src, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/',
    beforeParse(win) {
      win.chrome = { webview: { postMessage() {}, addEventListener() {}, removeEventListener() {} } };
      if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'u-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
      win.scrollTo = () => {};
      win.HTMLElement.prototype.scrollIntoView = function () {};
    },
  });
  try {
    await new Promise((r) => setTimeout(r, 40));
    const meta = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
    const ok = w.__applyState(JSON.stringify({ categories: [], entries: [], todos: [], taskHours: {}, attendance: {} }), meta);
    const bad = w.__applyState('{깨진 JSON', meta);
    return { ok, bad };
  } finally { try { w.close(); } catch (_) {} }
}
if (!JSDOM) {
  skip('boot-snap-order: jsdom 미설치로 __applyState 반환값 검증을 건너뜁니다', SKIP_NO_JSDOM, 'test 2곳이 등록되지 않았습니다.');
} else {
  test('(R) __applyState: 적용하면 true, 받은 데이터를 해석하지 못하면 false', async () => {
    const r = await applyResults(app);
    assert.strictEqual(r.ok, true, '적용에 성공했는데 true 가 아니다');
    assert.strictEqual(r.bad, false, '적용에 실패했는데 false 가 아니다(호스트가 ok 로 보고 스냅샷을 바꾼다)');
  });
  test('(M) 안쪽 catch 가 false 를 돌려주지 않으면 잡힌다', async () => {
    const find = "    return false;\n  }\n  hideBootSkeleton();\n  return true;\n};";
    assert.strictEqual(app.split(find).length, 2, '변이 앵커가 없거나 여럿이다');
    const r = await applyResults(app.replace(find, "    return;\n  }\n  hideBootSkeleton();\n  return true;\n};"));
    assert.notStrictEqual(r.bad, false, '변이가 효과가 없다');
  });
}
