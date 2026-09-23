// 경합·상태 정확성 — 화면 계약(docs/QUALITY-SWEEP-2026-09-18.md §3.4-B · 2026-09-23)
//
// 이 파일이 존재하는 이유 — 셋 다 "사용자가 한 일이 말없이 사라지거나 뒤바뀌던" 자리다:
//   ① 휴지통 영구 삭제(trDelete)가 **이미 닫힌** 이름 입력 확인창의 #ctInput 을 되읽어 호스트로 보냈다.
//      그 사이 다른 확인창이 열리면 칸이 비워져 빈 값이 간다. 확인창(confirmTyped)이 [영구 삭제]를 누른
//      그 순간의 값을 { ok:true, typed } 로 돌려주고, 부르는 쪽은 그것만 쓴다(계약은 trash-web.test.mjs ⑦).
//   ② 발주처·구분/상태 목록을 다시 부르면(reloadCustomerList · reloadCodeList) **먼저 보낸 요청의 늦은 회신**이
//      나중 목록을 덮었다 — 구분 탭의 회신이 상태 탭 화면에 앉는다. 목록 상자(dataset.gen)에 세대 표식을 두고
//      낡은 회신은 버린다(모듈 상태를 늘리지 않는다).
//   ③ 행 안의 이름변경(입력칸)·상위 변경(select)이 탭 전환·「숨김 표시」 토글의 재렌더에 **말없이** 버려졌다.
//      guardInlineEdit 가 DOM 만 보고 판정해, 값이 바뀌었으면 한 번 묻고 그대로면 조용히 진행한다.
//
//   ★ 앱 전체를 부팅하지 않는다 — 판정 함수만 떼어 내 빈 문서에 심는다(trash-web.test.mjs 와 같은 방식).
//   ★ 검사와 변이가 **같은 창구**를 쓴다. 변이로 안 깨지는 검사는 장식이다.
import { test, skip, assert, loadAppSource, extractFunction, importOptional, useJsdom, runInJsdom, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

//  async 선언은 extractFunction 이 'function 이름(' 부터 오려 내므로 async 가 떨어진다 — 원본을 보고 다시 붙인다.
function extractFn(src, name) {
  const isAsync = new RegExp('async\\s+function\\s+' + name + '\\s*\\(').test(src);
  return (isAsync ? 'async ' : '') + extractFunction(src, name);
}

//  바인딩 한 줄 — 앵커로 시작하는 줄을 정확히 하나 찾는다(없거나 둘이면 판정 불가).
function bindLine(src, anchor) {
  const lines = src.split('\n').filter((l) => l.includes(anchor));
  assert.strictEqual(lines.length, 1, `바인딩 줄(${anchor})이 ${lines.length}개다 — 판정 불가`);
  return lines[0];
}

const jsdom = useJsdom(await importOptional('jsdom'));

async function runInJsdomAsync(fixture, js, name, ...args) {
  const dom = new jsdom.JSDOM(fixture, { runScripts: 'outside-only' });
  dom.window.eval(js);
  const fn = dom.window[name];
  assert.ok(typeof fn === 'function', `runInJsdomAsync: window.${name} 창구가 없다 — 판정 불가`);
  return JSON.parse(JSON.stringify(await fn(...args)));
}

// ── A. 인라인 편집 가드 ─────────────────────────────────────────────
const GUARD_FIXTURE = '<!doctype html><html><body><div id="custList"></div><div id="otList"></div>' +
  '<div class="overlay hidden" id="confirmModal"></div></body></html>';

function guardHarnessJs(src = app) {
  return [
    extractFunction(src, 'inlineEditDirty'),
    extractFunction(src, 'guardInlineEdit'),
    extractFunction(src, 'otRowOrig'),
    //  확인창 대역 — 몇 번 물었는지와 무엇을 물었는지만 적고, 답은 시험이 준다.
    'function confirmBox(title, msg, okLabel, altLabel){',
    '  window.__asked = (window.__asked || 0) + 1;',
    '  window.__lastAsk = { title: title, msg: msg, okLabel: okLabel, altLabel: altLabel };',
    '  return new Promise(function(res){ window.__answer = res; });',
    '}',
    //  ot 는 행이 data-otkey 만 알고 이름은 회신 덩어리에 있다 — otItem 대역이 그 덩어리 노릇을 한다.
    'var __items = { "u:3": { name: "개발팀" } };',
    'function otItem(key){ return __items[key]; }',
    'var byName = function(r){ return r.dataset.name; };',
    'window.__probe = function(rowHtml, listId, useOt){',
    '  listId = listId || "custList";',
    '  document.getElementById(listId).innerHTML = rowHtml;',
    '  var orig = useOt ? otRowOrig : byName;',
    '  var calls = { proceed: 0, revert: 0 };',
    '  guardInlineEdit(listId, orig, function(){ calls.proceed++; }, function(){ calls.revert++; });',
    '  return { asked: window.__asked || 0, calls: calls, dirty: inlineEditDirty(listId, orig), ask: window.__lastAsk || null };',
    '};',
    'window.__probeAnswer = function(rowHtml, answer, withRevert){',
    '  document.getElementById("custList").innerHTML = rowHtml;',
    '  var calls = { proceed: 0, revert: 0 };',
    '  guardInlineEdit("custList", byName, function(){ calls.proceed++; },',
    '    withRevert === false ? undefined : function(){ calls.revert++; });',
    '  var before = { proceed: calls.proceed, revert: calls.revert };',
    '  window.__answer(answer);',
    '  return new Promise(function(res){ setTimeout(function(){',
    '    res({ asked: window.__asked || 0, before: before, after: calls });',
    '  }, 0); });',
    '};',
  ].join('\n');
}

const ROW_PLAIN = '<div class="cust-row" data-name="A"><span class="cust-nm">A</span><button type="button">이름변경</button></div>';
const rowEdit = (v) => `<div class="cust-row" data-name="A"><span class="cust-edit"><input type="text" value="${v}"></span></div>`;
const ROW_MOVE_PICKED = '<div class="cust-row" data-otkey="u:3"><span class="cust-nm">개발팀</span>' +
  '<select><option value="">-</option><option value="7" selected>x</option></select></div>';
const ROW_MOVE_EMPTY = '<div class="cust-row" data-otkey="u:3"><span class="cust-nm">개발팀</span>' +
  '<select><option value="" selected>-</option><option value="7">x</option></select></div>';
const otRowEdit = (v) => `<div class="cust-row" data-otkey="u:3"><span class="cust-nm cust-edit"><input type="text" value="${v}"></span></div>`;

const probeGuard = (rowHtml, listId, useOt, src = app) => runInJsdom(GUARD_FIXTURE, guardHarnessJs(src), '__probe', rowHtml, listId, useOt);
const probeAnswer = (rowHtml, answer, withRevert, src = app) =>
  runInJsdomAsync(GUARD_FIXTURE, guardHarnessJs(src), '__probeAnswer', rowHtml, answer, withRevert);

// ── B. 목록 다시 부르기의 세대 표식 ─────────────────────────────────
//  hostRequest 대역은 요청을 쌓아 두기만 한다 — 회신 순서를 시험이 정한다(늦은 옛 회신을 재현하는 유일한 길).
function genHarnessJs(fnText, kind) {
  const code = kind === 'code';
  const listVar = code ? 'codeList' : 'custList';
  const boxId = code ? 'codeList' : 'custList';
  const render = code ? 'renderCodeList' : 'renderCustomerList';
  const reload = code ? 'reloadCodeList' : 'reloadCustomerList';
  return [
    `var codeKind = 'section', ${listVar} = [];`,
    "var ICON = { spinner: '' };",
    `function ${render}(){ document.getElementById('${boxId}').textContent = 'RENDERED:' + ${code ? 'codeKind' : "'cust'"} + ':' + ${listVar}.map(function(c){ return c.name; }).join(','); }`,
    'var __pending = [];',
    'function hostRequest(cmd, p){ return new Promise(function(res){ __pending.push({ cmd: cmd, p: p, res: res }); }); }',
    fnText,
    'function __tick(){ return new Promise(function(res){ setTimeout(res, 0); }); }',
    'window.__probe = async function(){',
    `  var box = document.getElementById('${boxId}');`,
    `  ${reload}();`,
    "  codeKind = 'status';",
    `  ${reload}();`,
    '  var cmds = __pending.map(function(x){ return x.cmd; });',
    '  var kinds = __pending.map(function(x){ return x.p && x.p.kind || ""; });',
    "  __pending[0].res({ ok: true, list: JSON.stringify([{ name: 'OLD' }]) });",
    '  await __tick();',
    '  var afterStale = String(box.textContent);',
    `  var varAfterStale = ${listVar}.map(function(c){ return c.name; }).join(',');`,
    "  __pending[1].res({ ok: true, list: JSON.stringify([{ name: 'NEW' }]) });",
    '  await __tick();',
    '  return { cmds: cmds, kinds: kinds, afterStale: afterStale, varAfterStale: varAfterStale,',
    `           final: String(box.textContent), varFinal: ${listVar}.map(function(c){ return c.name; }).join(',') };`,
    '};',
  ].join('\n');
}
const GEN_FIXTURE = '<!doctype html><html><body><div id="codeList"></div><div id="custList"></div></body></html>';
const probeGen = (kind, src = app, fnText) =>
  runInJsdomAsync(GEN_FIXTURE, genHarnessJs(fnText || extractFn(src, kind === 'code' ? 'reloadCodeList' : 'reloadCustomerList'), kind), '__probe');
const GEN_LINE = /\n[ \t]*if\(box\.dataset\.gen !== gen\) return;[^\n]*/;

if (!jsdom) {
  skip('계약③-DOM(a): 편집이 없거나 값이 그대로면 묻지 않고 진행한다', SKIP_NO_JSDOM, '이 파일의 DOM 계약 6건이 세어지지 않음');
  skip('계약③-DOM(b): 이름이 바뀌었으면 한 번 묻고, 답에 따라 진행하거나 되돌린다', SKIP_NO_JSDOM);
  skip('계약③-DOM(c): 상위 변경 후보를 골라 두었으면 묻는다(고르지 않았으면 조용히)', SKIP_NO_JSDOM);
  skip('계약②-DOM: 늦게 온 옛 회신은 새 목록을 덮지 않는다(구분·상태)', SKIP_NO_JSDOM);
  skip('계약②-DOM: 늦게 온 옛 회신은 새 목록을 덮지 않는다(발주처)', SKIP_NO_JSDOM);
  skip('변이②-DOM: 세대 확인 줄을 지우면 옛 회신이 새 목록을 덮는다', SKIP_NO_JSDOM);
} else {
  test('계약③-DOM(a): 편집이 없거나 값이 그대로면(앞뒤 공백만 달라도) 묻지 않고 바로 진행한다', () => {
    const plain = probeGuard(ROW_PLAIN);
    assert.strictEqual(plain.dirty, false, '편집하지 않은 행을 편집 중으로 본다 — 탭을 바꿀 때마다 쓸데없는 확인창이 뜬다');
    assert.strictEqual(plain.asked, 0, '편집이 없는데 확인창을 띄웠다');
    assert.strictEqual(plain.calls.proceed, 1, '편집이 없는데 탭 전환·숨김 토글이 진행되지 않았다 — 버튼이 먹통이 된다');
    const same = probeGuard(rowEdit('A'));
    assert.strictEqual(same.dirty, false, '입력칸을 열기만 하고 바꾸지 않았는데 편집 중으로 본다 — Esc 와 같게 조용히 가야 한다');
    assert.strictEqual(same.asked, 0, '값이 그대로인데 확인창을 띄웠다');
    assert.strictEqual(same.calls.proceed, 1, '값이 그대로인데 진행되지 않았다');
    const spaced = probeGuard(rowEdit('A '));
    assert.strictEqual(spaced.dirty, false, '뒤 공백만 붙었는데 편집 중으로 본다 — 저장도 trim 하므로 바뀐 것이 없다');
    assert.strictEqual(spaced.calls.proceed, 1);
    //  ot — 원래 이름은 otItem(회신 덩어리)에서 온다(otRowOrig).
    const ot = probeGuard(otRowEdit('개발팀'), 'otList', true);
    assert.strictEqual(ot.dirty, false, '직급·소속 입력칸의 값이 원래 이름과 같은데 편집 중으로 본다(otRowOrig 가 원래 이름을 못 찾는다)');
    assert.strictEqual(ot.calls.proceed, 1);
  });

  test('계약③-DOM(b): 이름이 바뀌었으면 한 번 묻고, [버리고 계속]이면 진행·[계속 편집]/×면 되돌린다', async () => {
    const d = probeGuard(rowEdit('B'));
    assert.strictEqual(d.dirty, true, '이름을 바꿨는데 편집 중으로 보지 않는다 — 탭 전환에 편집이 말없이 사라진다');
    assert.strictEqual(d.asked, 1, `이름을 바꿨는데 확인창을 ${d.asked}번 띄웠다 — 한 번 물어야 한다`);
    assert.strictEqual(d.calls.proceed, 0, '답을 듣기도 전에 진행했다 — 묻는 것이 장식이 된다');
    assert.strictEqual(d.ask && d.ask.okLabel, '버리고 계속', `확인 버튼 문구가 다르다: ${JSON.stringify(d.ask)}`);
    assert.strictEqual(d.ask && d.ask.altLabel, '계속 편집', `남는 쪽 버튼 문구가 다르다: ${JSON.stringify(d.ask)}`);
    const ok = await probeAnswer(rowEdit('B'), 'ok');
    assert.deepStrictEqual(ok.before, { proceed: 0, revert: 0 }, '답 전에 무언가 실행됐다');
    assert.deepStrictEqual(ok.after, { proceed: 1, revert: 0 }, `[버리고 계속]인데 ${JSON.stringify(ok.after)} — 진행 한 번이어야 한다`);
    const alt = await probeAnswer(rowEdit('B'), 'alt');
    assert.deepStrictEqual(alt.after, { proceed: 0, revert: 1 },
      `[계속 편집]인데 ${JSON.stringify(alt.after)} — 진행하면 편집이 사라지고, 되돌리지 않으면 체크박스가 화면과 어긋난다`);
    const x = await probeAnswer(rowEdit('B'), false);
    assert.deepStrictEqual(x.after, { proceed: 0, revert: 1 }, `× 로 닫았는데 ${JSON.stringify(x.after)} — 닫기는 '계속 편집'과 같다`);
    const tab = await probeAnswer(rowEdit('B'), 'alt', false);
    assert.deepStrictEqual(tab.after, { proceed: 0, revert: 0 }, '되돌리기가 없는 탭 버튼인데 무언가 실행됐다');
    const ot = probeGuard(otRowEdit('기획팀'), 'otList', true);
    assert.strictEqual(ot.dirty, true, '직급·소속 이름을 바꿨는데 편집 중으로 보지 않는다');
    assert.strictEqual(ot.calls.proceed, 0);
  });

  test('계약③-DOM(c): 상위 변경 후보를 골라 두었으면 묻고, 고르지 않았으면 조용히 진행한다', () => {
    const picked = probeGuard(ROW_MOVE_PICKED, 'otList', true);
    assert.strictEqual(picked.dirty, true, '새 상위를 골라 두었는데 편집 중으로 보지 않는다 — 탭 전환에 그 선택이 사라진다');
    assert.strictEqual(picked.calls.proceed, 0);
    const empty = probeGuard(ROW_MOVE_EMPTY, 'otList', true);
    assert.strictEqual(empty.dirty, false, '아무것도 고르지 않은 상위 변경을 편집 중으로 본다');
    assert.strictEqual(empty.calls.proceed, 1);
  });

  test('계약②-DOM: 늦게 온 옛 회신은 새 목록을 덮지 않는다(구분 회신이 상태 탭에 앉지 않는다)', async () => {
    const r = await probeGen('code');
    assert.deepStrictEqual(r.cmds, ['getCodesFull', 'getCodesFull'], `전제 붕괴: 요청이 ${JSON.stringify(r.cmds)} 다`);
    assert.deepStrictEqual(r.kinds, ['section', 'status'], `전제 붕괴: 두 요청의 탭이 ${JSON.stringify(r.kinds)} 다`);
    assert.ok(!/RENDERED/.test(r.afterStale), `구분 탭의 늦은 회신이 상태 탭 화면을 그렸다: ${JSON.stringify(r.afterStale)}`);
    assert.ok(/불러오는 중/.test(r.afterStale), `옛 회신 뒤 목록 자리가 '불러오는 중'이 아니다: ${JSON.stringify(r.afterStale)}`);
    assert.strictEqual(r.varAfterStale, '', `옛 회신이 목록 변수(codeList)를 덮었다: ${JSON.stringify(r.varAfterStale)} — 다음 렌더가 엉뚱한 탭을 그린다`);
    assert.strictEqual(r.final, 'RENDERED:status:NEW', `새 회신이 앉지 않았다: ${JSON.stringify(r.final)}`);
    assert.strictEqual(r.varFinal, 'NEW');
  });

  test('계약②-DOM: 늦게 온 옛 회신은 새 목록을 덮지 않는다(발주처)', async () => {
    const r = await probeGen('cust');
    assert.deepStrictEqual(r.cmds, ['loadCustomersFull', 'loadCustomersFull'], `전제 붕괴: 요청이 ${JSON.stringify(r.cmds)} 다`);
    assert.ok(!/RENDERED/.test(r.afterStale), `발주처 목록의 늦은 옛 회신이 화면을 그렸다: ${JSON.stringify(r.afterStale)}`);
    assert.strictEqual(r.varAfterStale, '', `옛 회신이 목록 변수(custList)를 덮었다: ${JSON.stringify(r.varAfterStale)}`);
    assert.strictEqual(r.final, 'RENDERED:cust:NEW', `새 회신이 앉지 않았다: ${JSON.stringify(r.final)}`);
  });

  test('변이②-DOM: 세대 확인 줄을 지우면 옛 회신이 새 목록을 덮는다(그래서 계약②-DOM 이 필요하다)', async () => {
    for (const [kind, name, want] of [['code', 'reloadCodeList', 'RENDERED:status:OLD'], ['cust', 'reloadCustomerList', 'RENDERED:cust:OLD']]) {
      const fn = extractFn(app, name);
      const bad = fn.replace(GEN_LINE, '');
      assert.notStrictEqual(bad, fn, `변이가 ${name} 를 바꾸지 못했다(세대 확인 줄 없음)`);
      const r = await probeGen(kind, app, bad);
      assert.strictEqual(r.afterStale, want, `변이 전제: 세대 확인이 없으면 ${name} 의 옛 회신이 그려져야 한다(${JSON.stringify(r.afterStale)})`);
    }
  });
}

// ── C. 정적 계약 — 배선·보존 ────────────────────────────────────────
test('계약③: 탭 전환·「숨김 표시」 일곱 배선이 모두 guardInlineEdit 를 지난다(체크박스는 되돌리기 포함)', () => {
  const cases = [
    ["{ const sh = $('#custShowHidden');", 'custList', /r => r\.dataset\.name, \(\) => \{ custShowHidden = sh\.checked; renderCustomerList\(\); \}, \(\) => \{ sh\.checked = !sh\.checked; \}\)/],
    ["{ const t = $('#codeTabSection');", 'codeList', /r => r\.dataset\.name, \(\) => switchCodeKind\('section'\)\)/],
    ["{ const t = $('#codeTabStatus');", 'codeList', /r => r\.dataset\.name, \(\) => switchCodeKind\('status'\)\)/],
    ["{ const sh = $('#codeShowHidden');", 'codeList', /r => r\.dataset\.name, \(\) => \{ codeShowHidden = sh\.checked; renderCodeList\(\); \}, \(\) => \{ sh\.checked = !sh\.checked; \}\)/],
    ["{ const t = $('#otTabTitle');", 'otList', /otRowOrig, \(\) => otSwitchTab\('title'\)\)/],
    ["{ const t = $('#otTabUnit');", 'otList', /otRowOrig, \(\) => otSwitchTab\('unit'\)\)/],
    ["{ const sh = $('#otShowHidden');", 'otList', /otRowOrig, \(\) => \{ __otShowHidden = !!sh\.checked; otRender\(\); otListTop\(\); \}, \(\) => \{ sh\.checked = !sh\.checked; \}\)/],
  ];
  for (const [anchor, listId, tail] of cases) {
    const line = bindLine(app, anchor);
    assert.ok(line.includes(`guardInlineEdit('${listId}', `),
      `${anchor} 배선이 guardInlineEdit('${listId}') 를 지나지 않는다 — 저장하지 않은 편집이 재렌더에 말없이 사라진다: ${line.trim()}`);
    assert.ok(tail.test(line), `${anchor} 배선의 진행·되돌리기 모양이 다르다: ${line.trim()}`);
  }
  //  ot 숨김 토글 줄은 다른 시험(org-title-web)이 이 부분 문자열로 잡는다 — 한 줄·그 글자 그대로여야 한다.
  const ot = bindLine(app, "{ const sh = $('#otShowHidden');");
  assert.ok(ot.startsWith("  { const sh = $('#otShowHidden'); if(sh) sh.addEventListener('change'"), 'ot 숨김 토글 줄의 머리가 바뀌었다');
  assert.ok(ot.includes('__otShowHidden = !!sh.checked; otRender(); otListTop(); }'), 'ot 숨김 토글의 본문 문자열이 바뀌었다 — 그것을 잡는 시험이 판정을 잃는다');
});

test('계약③: 가드는 DOM 만 본다 — otSwitchTab 은 그대로, otRowOrig 는 data-otkey 로 원래 이름을 찾는다', () => {
  assert.ok(extractFunction(app, 'otSwitchTab').includes('  otRender();\n  otSyncAdd();\n  otListTop();\n}'),
    'otSwitchTab 의 꼬리가 바뀌었다 — 그 꼬리를 잡는 변이 시험이 대상을 잃는다');
  const o = extractFunction(app, 'otRowOrig');
  assert.ok(/otItem\(row\.dataset\.otkey\)/.test(o), 'otRowOrig 가 행의 data-otkey 로 원래 항목을 찾지 않는다 — 편집 판정이 엉뚱한 이름과 비교한다');
  const g = extractFunction(app, 'inlineEditDirty') + extractFunction(app, 'guardInlineEdit');
  assert.ok(/confirmBox\(/.test(g), 'guardInlineEdit 가 확인창을 거치지 않는다');
  assert.ok(/\.trim\(\) !== /.test(g), 'inlineEditDirty 가 trim 해 비교하지 않는다 — 저장은 trim 하므로 공백만 달라도 묻게 된다');
});

test('계약②: 두 목록 다시 부르기는 await 앞에서 세대를 찍고, 회신 직후 낡았으면 돌아선다', () => {
  for (const name of ['reloadCodeList', 'reloadCustomerList']) {
    const f = extractFunction(app, name);
    const stamp = f.indexOf('box.dataset.gen = gen');
    const aw = f.indexOf('await hostRequest(');
    const chk = f.indexOf('if(box.dataset.gen !== gen) return;');
    const assign = f.indexOf(name === 'reloadCodeList' ? 'codeList = ' : 'custList = ');
    assert.ok(stamp >= 0, `${name} 가 목록 상자에 세대를 찍지 않는다 — 늦은 옛 회신을 가려낼 수 없다`);
    assert.ok(aw > stamp, `${name} 의 세대 표식이 await 뒤에 있다 — 두 요청이 같은 세대를 갖는다`);
    assert.ok(chk > aw, `${name} 가 회신 뒤에 세대를 확인하지 않는다 — 옛 회신이 새 목록을 덮는다`);
    assert.ok(assign > chk, `${name} 가 세대 확인 전에 목록 변수를 덮는다 — 화면은 막아도 다음 렌더가 옛 목록을 그린다`);
  }
});
