// 부팅(다시 읽기) 스냅샷은 화면에 넣기가 성공한 뒤에만 바꾼다(0.28.0, docs/ITEM-ORDER.md §5 F3 뒤 검토).
//
// 왜 있나
//   BootFromDbAsync 가 서버 스냅샷을 먼저 _calSnap 에 넣고 화면 주입(ExecuteScriptAsync)이 실패하면,
//   스냅샷에는 있고 화면에는 없는 행(예: 방금 [개인 일정에 등록]한 일정)이 생긴다.
//   바뀐 행만 쓰는 저장은 "스냅샷에 있었는데 화면에 없는 행"을 지운 것으로 보고 DB 에서 지운다.
//   그래서 주입 결과가 'ok' 일 때만 스냅샷을 바꾸는지 본다(웹 안의 예외도 'err' 로 돌려받는다).
import { test, assert, readText } from './harness.mjs';

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
  assert.ok(/return 'ok'\}catch\(e\)\{return 'err'\}/.test(b), '화면 주입이 웹 안에서 실패했는지 돌려받지 않는다');
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
