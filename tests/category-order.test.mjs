// 과제 순서 설정(docs/CATEGORY-ORDER.md — R1~R9 · 수용 C1~C8)의 웹 쪽 계약.
//
// 이 파일이 지키는 것:
//   ① 「과제 관리」 목록은 state.categories 를 **그 순서 그대로** 그린다(개인·공식 섞임 · 다시 묶지 않는다 — R1·C1).
//   ② 각 행의 ▲▼ — 진짜 버튼 · aria-label「위로 이동: 과제명」/「아래로 이동: 과제명」 · 첫 행 ▲·마지막 행 ▼ 비활성.
//      한 번 = 한 칸 · 저장 1회(R2·C2). 관문(guardEdit) → 맞바꿈 → save() 순(R7·C6).
//   ③ 옮긴 뒤 포커스는 옮겨진 행의 같은 버튼(끝에 닿아 꺼졌으면 같은 행의 반대쪽) · 목록을 다시 만들지 않는다(R3·C7).
//   ④ 같은 순서가 보고서 행(「기타」·미분류는 맨 뒤)·필터 막대·과제 선택 상자에 그대로 쓰인다(R4·R5·C4·C5).
//   ⑤ 저장 payload(saveState.state.categories)가 그 순서다 — 호스트는 배열 자리를 sort_order 로 쓴다(C3 의 웹 몫).
//
// 검사 함수를 테스트와 변이 시험이 공유한다 — 검사가 정말 잡는지 같은 함수를 변이된 소스에 다시 돌려 증명한다.
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}
// JS 주석 제거(문자열·템플릿 리터럴은 보존) — 계약이 보는 것은 코드지 설명 글자가 아니다.
function stripJs(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === c) { j++; break; } j++; }
      out += s.slice(i, j); i = j; continue;
    }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}
const fnBody = (app, name) => stripJs(extractFunction(app, name));

//  변이 — 각각 '되돌아가면 안 되는 판'을 만든다.
const MUT = {
  //  개인 먼저·공식 뒤로 다시 묶던 옛 판(R1 위반)
  regroup: (s) => mutate(
    "list.innerHTML = state.categories.map(c => catRowHtml(c)).join('');",
    "const ordered = state.categories.filter(c => !isOfficialCat(c)).concat(state.categories.filter(isOfficialCat));\n    list.innerHTML = ordered.map(catRowHtml).join('');",
    s),
  //  관문 없이 바로 바꾼다(R7 위반)
  noGuard: (s) => mutate(
    '  if(guardEdit()) return false;\n  const i = state.categories.findIndex(c => c.id === id);\n  const j = i + delta;',
    '  const i = state.categories.findIndex(c => c.id === id);\n  const j = i + delta;',
    s),
  //  한 번 옮기는데 두 번 저장한다(R2 위반)
  saveTwice: (s) => mutate(
    '  const t = state.categories[i]; state.categories[i] = state.categories[j]; state.categories[j] = t;\n  save();\n',
    '  const t = state.categories[i]; state.categories[i] = state.categories[j]; state.categories[j] = t;\n  save(); save();\n',
    s),
  //  보고서 행을 이름순으로 정렬한다(R4 위반)
  sortReport: (s) => mutate(
    "  rows = rows.filter(r => String(r.name || '').trim() !== '기타')",
    "  rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));\n  rows = rows.filter(r => String(r.name || '').trim() !== '기타')",
    s),
};

/* ── 정적 계약(jsdom 불필요) ─────────────────────────────────────────── */

const statics = {
  //  목록 = state.categories 그대로(다시 묶지 않는다 · 정렬하지 않는다)
  listInRealOrder(app) {
    const b = fnBody(app, 'renderCatModal');
    assert.ok(/list\.innerHTML\s*=\s*state\.categories\.map\(/.test(b), 'renderCatModal 이 state.categories 를 그대로 그리지 않는다(R1)');
    assert.ok(!/isOfficialCat/.test(b), 'renderCatModal 이 공식/개인을 가른다 — 목록이 실제 순서와 갈린다(R1)');
    assert.ok(!/\.concat\(|\.sort\(|\.reverse\(/.test(b), 'renderCatModal 이 목록을 재배열한다(R1)');
    assert.ok(/catOrderHint/.test(b), '안내 한 줄(#catOrderHint)의 표시를 렌더가 정하지 않는다(R8)');
    assert.ok(app.includes('<div class="cat-order-hint" id="catOrderHint">순서는 보고서·필터에 그대로 반영됩니다</div>'),
      '목록 위 안내 한 줄「순서는 보고서·필터에 그대로 반영됩니다」가 없다(R8)');
  },
  //  ▲▼ 마크업 — 진짜 버튼 · aria-label · 끝 비활성
  moveButtons(app) {
    const b = fnBody(app, 'catMoveBtnsHtml');
    assert.ok(/<button type="button" class="btn sm" data-act="up" aria-label="위로 이동: \$\{nm\}"/.test(b), '▲ 가 진짜 버튼 + aria-label「위로 이동: 과제명」이 아니다(R3)');
    assert.ok(/<button type="button" class="btn sm" data-act="down" aria-label="아래로 이동: \$\{nm\}"/.test(b), '▼ 가 진짜 버튼 + aria-label「아래로 이동: 과제명」이 아니다(R3)');
    assert.ok(/const nm = esc\(c\.name\)/.test(b), 'aria-label 의 과제명을 이스케이프하지 않는다');
    assert.ok(/i <= 0 \? ' disabled'/.test(b), '첫 행의 ▲ 를 끄지 않는다(R2)');
    assert.ok(/i >= n - 1\) \? ' disabled'/.test(b), '마지막 행의 ▼ 를 끄지 않는다(R2)');
    const row = fnBody(app, 'catRowHtml');
    assert.strictEqual((row.match(/\$\{catMoveBtnsHtml\(c\)\}/g) || []).length, 2, '개인·공식 두 행 템플릿 모두에 ▲▼ 가 있어야 한다');
  },
  //  관문 → 맞바꿈 → save() 1회
  handlerOrder(app) {
    const b = fnBody(app, 'moveCategory');
    const g = b.indexOf('guardEdit()');
    const sw = b.indexOf('state.categories[i] = state.categories[j]');
    const sv = b.indexOf('save()');
    assert.ok(g > 0, 'moveCategory 에 연결 잠금 관문(guardEdit)이 없다(R7)');
    assert.ok(sw > g, 'moveCategory 가 관문보다 먼저 배열을 바꾼다(R7)');
    assert.ok(sv > sw, 'moveCategory 가 바꾸기 전에 저장한다');
    assert.strictEqual((b.match(/save\(\)/g) || []).length, 1, 'moveCategory 의 저장이 1회가 아니다(R2)');
    const ui = fnBody(app, 'catMoveRow');
    assert.ok(!/save\(\)|saveFull\(\)|dbSave\(/.test(ui), 'catMoveRow(화면 쪽)가 따로 저장한다 — 저장은 moveCategory 한 번이다');
    assert.ok(ui.indexOf('moveCategory(') < ui.indexOf('insertBefore'), 'catMoveRow 가 데이터보다 화면을 먼저 바꾼다(잠금 중에 화면만 움직인다)');
    const i = app.indexOf("$('#catList').addEventListener('click'");
    const j = app.indexOf("if((act === 'unsub' || act === 'del') && guardEdit()) return;", i);
    assert.ok(i > 0 && j > i, '#catList 위임 앵커를 찾지 못했다');
    assert.ok(app.slice(i, j).includes("if(act === 'up' || act === 'down'){ catMoveRow(c.id, act === 'up' ? -1 : +1); return; }"),
      '#catList 위임이 ▲▼ 를 catMoveRow 로 보내지 않는다');
  },
  //  보고서 행 = state.categories 순서, 「기타」 맨 뒤, 미분류 그 뒤 — 이름순 정렬 없음
  reportOrder(app) {
    const b = fnBody(app, 'collectReportData');
    assert.ok(/let rows = state\.categories\.map\(/.test(b), '보고서 행이 state.categories 순서에서 나오지 않는다(R4)');
    assert.ok(b.includes("rows = rows.filter(r => String(r.name || '').trim() !== '기타').concat(rows.filter(r => String(r.name || '').trim() === '기타'));"),
      '「기타」 과제를 맨 뒤로 보내는 규칙이 사라졌다(R5)');
    assert.ok(/rows\.push\(\{ key:'__uncat__'/.test(b), '미분류 행을 맨 뒤에 붙이지 않는다(R5)');
    assert.ok(!/rows\s*(=\s*rows\s*)?\.(slice\(\)\.)?sort\(/.test(b), '보고서 행을 정렬한다 — 목록 순서와 갈린다(R4)');
  },
  //  필터 막대·과제 선택 상자·할 일 필터·할 일 편집·내보내기 — state.categories 를 정렬 없이 돈다
  pickersInOrder(app) {
    const fb = fnBody(app, 'renderFilterbar');
    assert.ok(/for\(const c of state\.categories\)/.test(fb) && !/\.sort\(/.test(fb), '필터 막대가 state.categories 순서가 아니다(R4)');
    const fs = fnBody(app, 'fillCatSelect');
    assert.ok(/state\.categories\.filter\(isPickableCat\)\.map\(/.test(fs), '과제 선택 상자가 state.categories 순서로 한 줄이 아니다(R4)');
    assert.ok(!/optgroup|\.sort\(|\.concat\(/.test(fs), '과제 선택 상자가 공식/개인으로 묶거나 정렬한다 — 순서가 갈린다(R4)');
    const nf = fnBody(app, 'noteFilterBarHtml');
    assert.ok(/for\(const c of state\.categories\)/.test(nf) && !/\.sort\(/.test(nf), '할 일·작업일지 과제 필터가 state.categories 순서가 아니다');
    const te = fnBody(app, 'todoEditHtml');
    assert.ok(/state\.categories\.map\(/.test(te) && !/categories[^;]*\.sort\(/.test(te), '할 일 편집의 과제 선택이 state.categories 순서가 아니다');
    const ex = fnBody(app, 'openExportModal');
    assert.ok(/for\(const c of state\.categories\)/.test(ex) && !/\.sort\(/.test(ex), '내보내기 과제 선택이 state.categories 순서가 아니다');
    //  새 기록·빠른 추가·검색은 모두 fillCatSelect 를 쓴다(따로 만들면 그쪽이 낡는다)
    for (const sel of ["fillCatSelect($('#fCat'))", "fillCatSelect($('#qaCat'), '과제 없음')", "fillCatSelect($('#sCatSelect'), '— 과제를 선택하세요 —')"]) {
      assert.ok(app.includes(sel), `${sel} 이 사라졌다 — 그 선택 상자가 따로 순서를 만든다`);
    }
  },
};

test('정적①: 「과제 관리」 목록이 state.categories 순서 그대로다(다시 묶지 않는다) + 안내 한 줄', () => statics.listInRealOrder(src));
test('정적②: ▲▼ 는 진짜 버튼 · aria-label · 끝 비활성 — 개인·공식 행 모두', () => statics.moveButtons(src));
test('정적③: 이동은 guardEdit → 맞바꿈 → save() 1회 · 위임이 ▲▼ 를 catMoveRow 로 보낸다', () => statics.handlerOrder(src));
test('정적④: 보고서 행 = state.categories 순서(「기타」·미분류 맨 뒤) · 정렬 없음', () => statics.reportOrder(src));
test('정적⑤: 필터 막대·과제 선택 상자·할 일 필터·내보내기가 state.categories 를 정렬 없이 돈다', () => statics.pickersInOrder(src));
test('변이①s: 개인 먼저 재묶음을 되살리면 정적① 이 실패한다', () => {
  assert.throws(() => statics.listInRealOrder(MUT.regroup(src)), /그대로 그리지 않는다|isOfficialCat|재배열/);
});
test('변이②s: guardEdit 를 지우면 정적③ 이 실패한다', () => {
  assert.throws(() => statics.handlerOrder(MUT.noGuard(src)), /관문/);
});
test('변이③s: 저장을 두 번 하면 정적③ 이 실패한다', () => {
  assert.throws(() => statics.handlerOrder(MUT.saveTwice(src)), /1회/);
});
test('변이④s: 보고서 행을 이름순으로 정렬하면 정적④ 가 실패한다', () => {
  assert.throws(() => statics.reportOrder(MUT.sortReport(src)), /정렬/);
});

/* ── 행동 — jsdom 위젯 모드 ──────────────────────────────────────────── */

const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('category-order: jsdom 미설치 — 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CA = '2026-09-01T00:00:00Z';
  const CAT = (id, name, extra) => Object.assign({ id, name, color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }, extra || {});
  const ENT = (id, categoryId) => ({ id, date: '2026-10-01', title: '업무 ' + id, categoryId, allDay: true, startTime: '', endTime: '',
    memo: '', location: '', source: '', commits: [], createdAt: CA, updatedAt: CA });
  //  이름은 '이름순 정렬'이 실제 순서와 갈리도록 고른다(감마 < 공식 < 베타 < 알파 · ko).
  const DATA = {
    categories: [CAT('c-a', '알파'), CAT('c-b', '베타'), CAT('c-c', '감마'), CAT('db-o', '공식 오메가', { source: 'db' })],
    entries: [ENT('e-a', 'c-a'), ENT('e-b', 'c-b'), ENT('e-c', 'c-c'), ENT('e-o', 'db-o'), ENT('e-u', null)],
    todos: [], rooms: ['201호'],
  };
  //  「기타」 과제가 있는 판 — 미분류는 그쪽으로 합쳐진다.
  const DATA_GITA = {
    categories: [CAT('c-a', '알파'), CAT('c-b', '베타'), CAT('c-g', '기타'), CAT('c-c', '감마')],
    entries: [ENT('e-a', 'c-a'), ENT('e-b', 'c-b'), ENT('e-g', 'c-g'), ENT('e-c', 'c-c'), ENT('e-u', null)],
    todos: [], rooms: ['201호'],
  };

  function boot(source) {
    const log = [];
    const handlers = { saveState: { ok: true } };
    const dom = new JSDOM(source, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://tcapp.local/',
      virtualConsole: quietConsole(),
      beforeParse(win) {
        win.chrome = { webview: {
          postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} log.push({ post: o && o.cmd, msg: o }); },
          addEventListener() {}, removeEventListener() {},
        } };
        if (typeof win.crypto === 'undefined') {
          win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        }
        win.scrollTo = () => {};
        //  시계는 멈춰 둔다 — 재시도·토스트 타이머가 시험 중에 끼어들지 않게.
        win.setTimeout = () => 0;
        win.clearTimeout = () => {};
      },
    });
    const w = dom.window;
    w.__fakeReply = (cmd, params) => {
      log.push({ req: cmd, params });
      const h = handlers[cmd];
      const r = typeof h === 'function' ? h(params) : h;
      return (r && typeof r.then === 'function') ? r : Promise.resolve(r === undefined ? { ok: false, error: 'no handler' } : r);
    };
    w.eval('hostRequest = function(cmd, params){ return window.__fakeReply(cmd, params || {}); };');
    w.eval('(function(){ var t = toast; toast = function(m, k, a, ms){ window.__fakeToast(String(m), k); return t(m, k, a, ms); }; })();');
    w.__fakeToast = (m, k) => log.push({ toast: m, kind: k });
    const sess = log.find((x) => x.post === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.msg.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'hjlee', name: '이현진' } }) + ')');
    const W = {
      w, log, handlers,
      ev: (code) => w.eval(code),
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      reqs: (cmd) => log.filter((x) => x.req === cmd),
      toasts: () => log.filter((x) => x.toast).map((x) => x.toast),
      applyState: (data) => w.eval('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(META) + ')'),
      order: () => JSON.parse(w.eval('JSON.stringify(state.categories.map(function(c){ return c.id; }))')),
      domOrder: () => JSON.parse(w.eval("JSON.stringify([].map.call(document.querySelectorAll('#catList .cat-row'), function(r){ return r.dataset.id; }))")),
      btn: (id, act) => w.document.querySelector('#catList .cat-row[data-id="' + id + '"] [data-act="' + act + '"]'),
      row: (id) => w.document.querySelector('#catList .cat-row[data-id="' + id + '"]'),
      clear: () => { log.length = 0; },
      close: () => { try { w.close(); } catch (_) {} },
    };
    return W;
  }
  async function withBoot(source, data, fn) {
    const W = boot(source);
    try {
      W.applyState(data);
      await settle();
      W.ev('openCatModal();');
      //  모달 A11y 가 여는 순간 첫 칸으로 포커스를 보낸다(MutationObserver · 마이크로태스크) — 그게 끝난 뒤에 누른다.
      await settle();
      W.clear();
      return await fn(W);
    } finally { W.close(); }
  }
  //  누른다 = 포커스를 준 뒤 click(사람이 누를 때와 같은 순서) — 그다음 저장 회신까지 흘린다.
  async function press(W, id, act) {
    const b = W.btn(id, act);
    assert.ok(b, `${id} 행의 ${act} 버튼이 없다`);
    b.focus();
    b.click();
    await settle();
  }
  //  jsdom 렐름의 배열은 deepStrictEqual 에서 프로토타입이 갈린다 — JSON 으로 이 렐름에 옮긴다.
  const saveOrders = (W) => JSON.parse(JSON.stringify(W.reqs('saveState').map((x) => x.params.state.categories.map((c) => c.id))));

  const checks = {
    //  C1·C2·C5·⑤ — 목록 순서 · 한 칸 이동 · 저장 1회 · payload 순서 · 끝 비활성 · 필터 막대·선택 상자 순서
    async moveAndSave(source) {
      await withBoot(source, DATA, async (W) => {
        assert.deepStrictEqual(W.order(), ['c-a', 'c-b', 'c-c', 'db-o'], '시드 순서가 다르다');
        assert.ok(W.ev("isOfficialCat(state.categories[3])"), '공식 과제가 공식으로 실리지 않았다(시드 문제)');
        assert.deepStrictEqual(W.domOrder(), W.order(), '목록이 state.categories 순서가 아니다(C1)');
        assert.strictEqual(W.btn('c-a', 'up').disabled, true, '첫 행의 ▲ 가 켜져 있다(R2)');
        assert.strictEqual(W.btn('db-o', 'down').disabled, true, '마지막 행의 ▼ 가 켜져 있다(R2)');
        assert.strictEqual(W.btn('c-c', 'up').getAttribute('aria-label'), '위로 이동: 감마', 'aria-label 이 다르다(R3)');
        assert.strictEqual(W.btn('c-c', 'down').getAttribute('aria-label'), '아래로 이동: 감마', 'aria-label 이 다르다(R3)');
        assert.strictEqual(W.btn('c-c', 'up').tagName, 'BUTTON');

        await press(W, 'c-c', 'up');
        assert.deepStrictEqual(W.order(), ['c-a', 'c-c', 'c-b', 'db-o'], '▲ 한 번이 한 칸 이동이 아니다(C2)');
        assert.deepStrictEqual(saveOrders(W), [['c-a', 'c-c', 'c-b', 'db-o']], '한 번 옮겼는데 저장이 1회가 아니거나 payload 순서가 다르다(C2)');
        await press(W, 'c-c', 'up');
        assert.deepStrictEqual(W.order(), ['c-c', 'c-a', 'c-b', 'db-o'], '▲ 두 번 뒤 순서가 C,A,B,O 가 아니다');
        const saves = saveOrders(W);
        assert.strictEqual(saves.length, 2, '두 번 옮겼는데 저장이 ' + saves.length + '회다(한 번 = 저장 1회)');
        assert.deepStrictEqual(saves[1], ['c-c', 'c-a', 'c-b', 'db-o'], '저장 payload 의 categories 순서가 화면 순서가 아니다(호스트는 배열 자리를 sort_order 로 쓴다)');
        assert.deepStrictEqual(W.domOrder(), W.order(), '옮긴 뒤 목록이 state.categories 순서가 아니다');
        assert.strictEqual(W.btn('c-c', 'up').disabled, true, '맨 위로 온 행의 ▲ 가 켜져 있다');
        assert.strictEqual(W.btn('c-a', 'up').disabled, false, '맨 위에서 밀려난 행의 ▲ 가 꺼진 채다');

        //  필터 막대 · 과제 선택 상자 — 같은 순서(C5)
        const chips = W.evJSON("[].map.call(document.querySelectorAll('#filterbar [data-cat]'), function(b){ return b.dataset.cat; }).filter(Boolean)");
        assert.deepStrictEqual(chips, W.order(), '필터 막대가 목록 순서를 따르지 않는다(C5)');
        const opts = W.evJSON("(function(){ var s = document.createElement('select'); fillCatSelect(s); return [].map.call(s.querySelectorAll('option'), function(o){ return o.value; }).filter(Boolean); })()");
        assert.deepStrictEqual(opts, W.order(), '과제 선택 상자가 목록 순서를 따르지 않는다(C5)');

        //  공식을 개인 사이로 — 다시 열어도(새로 그려도) 섞인 그대로다(R1 — 개인 먼저로 다시 묶지 않는다)
        await press(W, 'db-o', 'up');
        assert.deepStrictEqual(W.order(), ['c-c', 'c-a', 'db-o', 'c-b']);
        W.ev("closeModal('#categoryModal'); openCatModal();");
        assert.deepStrictEqual(W.domOrder(), ['c-c', 'c-a', 'db-o', 'c-b'], '다시 연 목록이 실제 순서가 아니다 — 개인/공식으로 다시 묶었다(R1)');
        assert.strictEqual(W.w.document.getElementById('catOrderHint').classList.contains('hidden'), false, '안내 한 줄이 안 보인다(R8)');
      });
    },
    //  C4 — 보고서 행 순서 = 목록 순서, 미분류(기타)는 맨 뒤
    async reportRows(source) {
      await withBoot(source, DATA, async (W) => {
        await press(W, 'c-c', 'up');
        await press(W, 'c-c', 'up');
        const keys = W.evJSON("collectReportData('2026-10-01', '2026-10-01').rows.map(function(r){ return r.key; })");
        assert.deepStrictEqual(keys, ['c-c', 'c-a', 'c-b', 'db-o', '__uncat__'], '보고서 행 순서가 목록 순서(미분류 맨 뒤)가 아니다(C4): ' + JSON.stringify(keys));
      });
    },
    //  R5 — 「기타」 과제는 맨 위로 옮겨도 보고서에서는 맨 뒤(미분류는 그리로 합쳐진다)
    async gitaLast(source) {
      await withBoot(source, DATA_GITA, async (W) => {
        await press(W, 'c-g', 'up');
        await press(W, 'c-g', 'up');
        assert.deepStrictEqual(W.order(), ['c-g', 'c-a', 'c-b', 'c-c'], '「기타」 가 맨 위로 오지 않았다');
        const rows = W.evJSON("collectReportData('2026-10-01', '2026-10-01').rows.map(function(r){ return [r.key, r.titles.length]; })");
        assert.deepStrictEqual(rows.map((r) => r[0]), ['c-a', 'c-b', 'c-c', 'c-g'], '「기타」 과제가 보고서 맨 뒤가 아니다(R5): ' + JSON.stringify(rows));
        assert.strictEqual(rows[3][1], 2, '미분류가 「기타」 과제로 합쳐지지 않았다');
      });
    },
    //  C7 — 포커스가 옮겨진 행의 같은 버튼 · 목록을 다시 만들지 않는다(스크롤 자리 유지의 근거)
    async focusKept(source) {
      await withBoot(source, DATA, async (W) => {
        const rowNode = W.row('c-c'), upNode = W.btn('c-c', 'up'), listNode = W.w.document.getElementById('catList');
        await press(W, 'c-c', 'up');
        assert.strictEqual(W.w.document.activeElement, upNode, '한 칸 옮긴 뒤 포커스가 옮겨진 행의 ▲ 에 있지 않다(R3)');
        assert.strictEqual(W.row('c-c'), rowNode, '옮길 때 목록을 새로 만들었다 — 스크롤·포커스가 날아간다(R3)');
        assert.strictEqual(W.w.document.getElementById('catList'), listNode);
        //  끝에 닿아 ▲ 가 꺼지면 같은 행의 ▼ 로 물러난다(body 로 떨어지지 않는다)
        await press(W, 'c-c', 'up');
        const af = W.w.document.activeElement;
        assert.strictEqual(af, W.btn('c-c', 'down'), '맨 위에 닿은 뒤 포커스가 같은 행의 ▼ 가 아니다: ' + (af && af.outerHTML ? af.outerHTML.slice(0, 80) : af));
        //  ▼ 는 그 자리의 같은 버튼을 유지한다
        await press(W, 'c-c', 'down');
        assert.strictEqual(W.w.document.activeElement, W.btn('c-c', 'down'), '▼ 한 칸 뒤 포커스가 같은 ▼ 에 있지 않다');
        assert.deepStrictEqual(W.order(), ['c-a', 'c-c', 'c-b', 'db-o']);
      });
    },
    //  C6 — 오프라인 잠금 중에는 상태·저장 변화 0 + 토스트
    async lockedNoop(source) {
      await withBoot(source, DATA, async (W) => {
        W.ev("__dbConnLost({ kind:'network', detail:'socket closed' })");
        assert.strictEqual(W.ev('editLocked()'), true, '끊김 주입이 잠금을 세우지 않았다(시험 전제)');
        W.clear();
        await press(W, 'c-c', 'up');
        assert.deepStrictEqual(W.order(), ['c-a', 'c-b', 'c-c', 'db-o'], '잠긴 채 순서가 바뀌었다(R7)');
        assert.deepStrictEqual(W.domOrder(), ['c-a', 'c-b', 'c-c', 'db-o'], '잠긴 채 화면의 순서가 바뀌었다(R7)');
        assert.strictEqual(W.reqs('saveState').length, 0, '잠긴 채 저장을 보냈다(R7)');
        assert.ok(W.toasts().includes('서버에 연결되지 않아 지금은 편집할 수 없습니다'), '막았는데 이유를 말하지 않는다: ' + JSON.stringify(W.toasts()));
        assert.strictEqual(W.ev('unsaved'), false, '잠긴 채 눌렀는데 미저장 표시가 섰다 — 바뀐 것이 없어야 한다');
      });
    },
  };

  test('행동①: ▲ 한 번 = 한 칸 · 저장 1회 · payload 순서 · 끝 비활성 · 필터 막대·선택 상자 같은 순서 · 다시 열어도 섞인 순서(C1·C2·C5)', () => checks.moveAndSave(src));
  test('행동②: 보고서 행 순서 = 목록 순서 · 미분류 맨 뒤(C4)', () => checks.reportRows(src));
  test('행동③: 「기타」 과제는 맨 위로 옮겨도 보고서 맨 뒤(R5)', () => checks.gitaLast(src));
  test('행동④: 옮긴 뒤 포커스가 옮겨진 행의 같은 버튼(끝이면 반대쪽) · 목록을 다시 만들지 않는다(C7)', () => checks.focusKept(src));
  test('행동⑤: 오프라인 잠금 중 이동 불가 — 상태·화면·저장 0 · 토스트(C6)', () => checks.lockedNoop(src));

  test('변이①: 개인 먼저 재묶음을 되살리면 행동① 이 실패한다', async () => {
    await assert.rejects(() => checks.moveAndSave(MUT.regroup(src)), /다시 묶었다/);
  });
  test('변이②: moveCategory 의 guardEdit 를 지우면 행동⑤ 가 실패한다', async () => {
    await assert.rejects(() => checks.lockedNoop(MUT.noGuard(src)), /잠긴 채 (순서|화면의 순서)가 바뀌었다/);
  });
  test('변이③: 한 번 옮기는데 두 번 저장하면 행동① 이 실패한다', async () => {
    await assert.rejects(() => checks.moveAndSave(MUT.saveTwice(src)), /저장이 1회가 아니거나|저장이 d+회다/);
  });
  test('변이④: 보고서 행을 이름순으로 정렬하면 행동② 가 실패한다', async () => {
    await assert.rejects(() => checks.reportRows(MUT.sortReport(src)), /보고서 행 순서/);
  });
}
