// 스크롤 칸 안정성 계약 (docs/SCROLL-STABILITY.md, 2026-11-05)
//
// 지키는 것: 다시 그리는 동안 스크롤 칸의 내용 높이가 줄지 않고(holdHeight, taGrow), 스크롤 상자 요소는 한 번만 만들고 안만 바꾸며
// (과제 탭 pcRender, pcRenderWeek), 비동기 회신을 기다리는 동안 목록을 비우지 않는다(관리 목록 셋). 스크롤 위치를 저장했다 되돌리는 코드는 없다.
//   (S) 정적 계약  (J) jsdom 행동  (M) 변이(옛 코드로 되돌리면 실패)
// jsdom 은 레이아웃이 없어 실제 scrollTop 수치는 못 잰다. 그 수치는 브라우저에서 따로 잰다(문서 10절).
import { test, skip, assert, loadAppSource, extractFunction, extractCodeIdsBlock, importOptional, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();

function mutate(from, to, base = src) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${String(from).slice(0, 80)}`);
  return out;
}
//  한 함수 안에서만 바꾼다(같은 줄이 다른 함수에도 있을 수 있다).
function mutateFn(base, fnName, from, to) {
  const body = extractFn(base, fnName);
  const nb = body.replace(from, to);
  assert.notStrictEqual(nb, body, `변이가 ${fnName} 를 바꾸지 못했다: ${String(from).slice(0, 80)}`);
  return base.replace(body, nb);
}
function extractFn(s, name) {
  const isAsync = new RegExp('async\\s+function\\s+' + name + '\\s*\\(').test(s);
  return (isAsync ? 'async ' : '') + extractFunction(s, name);
}
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const failsAssert = async (fn) => {
  try { await fn(); } catch (e) { if (e && (e.name === 'AssertionError' || e.code === 'ERR_ASSERTION')) return true; throw e; }
  return false;
};

/* ══ (S) 정적 계약 ═══════════════════════════════════════════════════ */
const S = {
  S1(s) {
    const hits = s.match(/style\.height\s*=\s*'auto'/g) || [];
    assert.strictEqual(hits.length, 1, `style.height = 'auto' 가 앱 전체에 ${hits.length}번 있다(taGrow 안에 한 번뿐이어야 한다)`);
    const t = extractFn(s, 'taGrow');
    const iHold = t.indexOf('holdHeight(t.parentElement)'), iAuto = t.search(/style\.height\s*=\s*'auto'/);
    const iSet = t.indexOf('t.style.height = (h'), iRel = t.indexOf('release()');
    assert.ok(iHold >= 0 && iAuto > iHold, 'taGrow 가 접기 전에 부모 높이를 잠그지 않는다');
    assert.ok(iSet > iAuto && iRel > iSet, 'taGrow 가 새 높이를 넣은 뒤에 잠금을 풀지 않는다');
    assert.ok(/function atGrow\(t\)\{ taGrow\(t, 0\); \}/.test(s), 'atGrow 가 taGrow(t, 0) 이 아니다');
    assert.ok(/taGrow\(t, 2\)/.test(extractFn(s, 'ceGrow')), 'ceGrow 가 taGrow(t, 2) 를 부르지 않는다');
  },
  S2(s) {
    const f = extractFn(s, 'atBlocksRender');
    const iHold = f.indexOf('const release = holdHeight(box)'), iHtml = f.indexOf('box.innerHTML =');
    const iMemo = f.lastIndexOf('atGrow(mt)'), iRel = f.indexOf('release();'), iPlace = f.indexOf('atAddPlace');
    assert.ok(iHold >= 0 && iHtml > iHold, 'atBlocksRender 가 innerHTML 을 바꾸기 전에 내용 상자를 잠그지 않는다');
    assert.ok(iRel > iMemo && iMemo > iHtml, '잠금 해제가 메모 칸 atGrow 뒤가 아니다');
    assert.ok(iPlace > iRel, '잠금 해제가 atAddPlace 보다 앞이 아니다(풀린 뒤의 높이로 재야 한다)');
    const g = extractFn(s, 'pcRender');
    const iH = g.indexOf(".pc-side .pc-list')].map(holdHeight)"), iF = g.indexOf('.forEach(catFitName)'), iR = g.indexOf('rel.forEach(f => f())');
    assert.ok(iH >= 0 && iF > iH && iR > iF, 'pcRender 가 catFitName 순회 동안 .pc-side 목록 높이를 잠그지 않는다');
  },
  S3(s) {
    const f = noComments(extractFn(s, 'pcRenderWeek'));
    assert.strictEqual((f.match(/body\.innerHTML/g) || []).length, 1, 'pcRenderWeek 가 body.innerHTML 을 한 번보다 많이(또는 안) 쓴다');
    assert.ok(/if\(!sc \|\| sc\.id !== 'pcWScroll'\)\{ body\.innerHTML = '<div class="pc-wscroll" id="pcWScroll"><\/div>';/.test(f), '빈 상자는 상자가 없을 때의 가지 안에서만 만들어야 한다');
    assert.ok(/sc\.innerHTML = h;/.test(f), '표는 상자 안에 넣어야 한다');
    assert.ok(!/body\.innerHTML = h/.test(f), '예전처럼 표 전체(상자 포함)를 body.innerHTML 로 쓴다');
    assert.ok(f.includes("calCellCls(ds, 'pc-whday'") && f.includes('CAL_DOW'), '표 문자열이 이 함수 밖으로 나갔다(cal-common 시험의 앵커)');
  },
  S4(s) {
    const f = noComments(extractFn(s, 'pcRender'));
    assert.strictEqual((f.match(/v\.innerHTML = '<div class="pc-main"/g) || []).length, 1, '껍데기를 쓰는 곳이 하나가 아니다');
    assert.ok(/if\([^\n]*main0\.dataset\.shell !== shellKey\)\{\s*v\.innerHTML = '<div class="pc-main" data-shell="'/.test(f), '껍데기는 열쇠(data-shell)를 비교한 가지 안에서만 만들어야 한다');
    assert.ok(f.includes('pcSideInner()'), 'pcRender 가 목록 안쪽(pcSideInner)만 갈아 끼우지 않는다');
  },
  S5(s) {
    for (const fn of ['reloadCustomerList', 'reloadCodeList', 'raReload']) {
      const f = noComments(extractFn(s, fn));
      const all = f.match(/box\.innerHTML = `<div class="cust-empty">\$\{ICON\.spinner\}/g) || [];
      const guarded = f.match(/if\(fresh\) box\.innerHTML = `<div class="cust-empty">\$\{ICON\.spinner\}/g) || [];
      assert.ok(all.length === 1 && guarded.length === 1, `${fn}: 스피너 대입이 if(fresh) 안에만 있어야 한다`);
      assert.ok(/const fresh = !!\(opt && opt\.fresh\) \|\| !box\.querySelector\('\.cust-row'\);/.test(f), `${fn}: fresh 판정이 규칙대로가 아니다`);
    }
    for (const [fn, call] of [['openCustomerModal', 'reloadCustomerList'], ['openCodeModal', 'reloadCodeList'], ['switchCodeKind', 'reloadCodeList'], ['openRoomAdmin', 'raReload']]) {
      assert.ok(new RegExp(call + '\\(\\{ fresh: true \\}\\)').test(extractFn(s, fn)), `${fn} 가 ${call}({ fresh: true }) 를 부르지 않는다(비우고 스피너를 보여야 하는 자리)`);
    }
    assert.ok(/reloadCustomerList\(\)/.test(extractFn(s, 'custSend')), 'custSend 는 인자 없이 부른다');
    assert.ok(/reloadCodeList\(\)/.test(extractFn(s, 'codeSend')), 'codeSend 는 인자 없이 부른다');
    assert.ok(/raReload\(\)/.test(extractFn(s, 'raSend')), 'raSend 는 인자 없이 부른다');
  },
  S6(s) {
    for (const fn of ['holdHeight', 'taGrow', 'atGrow', 'ceGrow', 'atBlocksRender', 'awRender', 'pcRender', 'pcRenderWeek', 'pcSideInner', 'reloadCustomerList', 'reloadCodeList', 'raReload']) {
      assert.ok(!/scrollTop/.test(noComments(extractFn(s, fn))), `${fn} 안에 scrollTop 이 있다(저장하고 되돌리는 땜질 금지)`);
    }
  },
  S7(s) {
    const PUNCT = [[/—/, '엠 대시'], [/–/, 'en 대시'], [/「|」/, '낫표'], [/(^|\s)·|·(\s|$)/, '띄어 쓴 가운데 점']];
    for (const fn of ['holdHeight', 'taGrow', 'pcSideInner', 'imeOnWheel', 'imeGuardInstall']) {
      for (const [re, name] of PUNCT) assert.ok(!re.test(extractFn(s, fn)), `${fn} 에 ${name}가 있다`);
    }
    //  고친 함수에 새로 단 주석(스크롤, 껍데기, 비우기, 잠금을 말하는 줄)
    for (const fn of ['atBlocksRender', 'pcRender', 'pcRenderWeek', 'reloadCustomerList', 'reloadCodeList', 'raReload', 'ceGrow']) {
      const cm = (extractFn(s, fn).match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) || []).filter((c) => /스크롤|껍데기|비우|잠|높이/.test(c));
      for (const c of cm) for (const [re, name] of PUNCT) assert.ok(!re.test(c), `${fn} 의 주석에 ${name}가 있다: ${c}`);
    }
  },
};
test('스크롤S1: style.height = auto 는 taGrow 안에 한 번뿐이고 부모 잠금 뒤, 해제는 높이 대입 뒤다', () => S.S1(src));
test('스크롤S2: atBlocksRender 는 innerHTML 전에 잠그고 메모 칸 뒤, atAddPlace 전에 푼다', () => S.S2(src));
test('스크롤S3: pcRenderWeek 는 스크롤 상자를 없을 때만 만들고 표만 갈아 끼운다', () => S.S3(src));
test('스크롤S4: pcRender 는 껍데기 열쇠가 다를 때만 껍데기를 새로 만든다', () => S.S4(src));
test('스크롤S5: 관리 목록 셋은 fresh 일 때만 스피너, 열기와 탭 바꾸기는 fresh, 저장 성공은 인자 없음', () => S.S5(src));
test('스크롤S6: 고친 함수 안에 scrollTop 저장과 복원이 없다', () => S.S6(src));
test('스크롤S7: 새 함수와 새 주석에 엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점이 없다', () => S.S7(src));

/* ══ (J) jsdom ═══════════════════════════════════════════════════════ */
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('스크롤J: jsdom 미설치, 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM, 'J1~J7 과 그에 기대는 변이가 등록되지 않았다');
} else {
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

  //  ── J1~J3: taGrow, ceGrow ─────────────────────────────────────────
  const GROW_FIX = '<!doctype html><html><body><div id="par"><textarea id="ceName"></textarea><span id="ceCount"></span></div></body></html>';
  function growJs(s) {
    return [extractFn(s, 'holdHeight'), extractFn(s, 'taGrow'), extractFn(s, 'atGrow'), extractFn(s, 'ceGrow'),
      'window.__probe = function(kind, sh, preMin, val){',
      '  var par = document.getElementById("par"), t = document.getElementById("ceName");',
      '  Object.defineProperty(par, "offsetHeight", { get: function(){ return 300; } });',
      '  if(preMin) par.style.minHeight = preMin;',
      '  t.value = val || "";',
      '  var seen = null;',
      '  Object.defineProperty(t, "scrollHeight", { get: function(){ seen = { min: par.style.minHeight, h: t.style.height }; return sh; } });',
      '  if(kind === "at") atGrow(t); else ceGrow();',
      '  return { seen: seen, min: par.style.minHeight, h: t.style.height, value: t.value, sel: [t.selectionStart, t.selectionEnd], cnt: document.getElementById("ceCount").textContent };',
      '};'].join('\n');
  }
  function probeGrow(s, ...args) {
    const dom = new JSDOM(GROW_FIX, { runScripts: 'outside-only' });
    dom.window.eval(growJs(s));
    return JSON.parse(JSON.stringify(dom.window.__probe(...args)));
  }
  const j1 = (s) => {
    const r = probeGrow(s, 'at', 123, '');
    assert.deepStrictEqual(r.seen, { min: '300px', h: 'auto' }, '재는 순간 부모 높이가 잠겨 있지 않거나 글 칸이 접히지 않았다');
    assert.strictEqual(r.min, '', '잴 뒤 부모 잠금이 풀리지 않았다');
    assert.strictEqual(r.h, '123px', '높이 결과가 scrollHeight 와 다르다');
    const r2 = probeGrow(s, 'at', 50, '10px');
    assert.strictEqual(r2.min, '10px', '원래 inline min-height 를 되돌리지 않았다');
  };
  const j2 = (s) => {
    const r = probeGrow(s, 'ce', 40, '');
    assert.deepStrictEqual(r.seen, { min: '300px', h: 'auto' }, 'ceGrow 가 재는 동안 부모를 잠그지 않는다');
    assert.strictEqual(r.h, '42px', 'ceGrow 가 위아래 테두리 +2 를 지키지 않는다');
    assert.strictEqual(r.min, '');
    //  줄바꿈은 공백, 커서 자리 그대로, 글자 수 표시
    const dom = new JSDOM(GROW_FIX, { runScripts: 'outside-only' });
    dom.window.eval(growJs(s));
    const t = dom.window.document.getElementById('ceName');
    t.value = 'ab\ncd'; t.setSelectionRange(2, 2);
    dom.window.ceGrow();
    assert.strictEqual(t.value, 'ab cd', '줄바꿈이 공백이 되지 않았다');
    assert.deepStrictEqual([t.selectionStart, t.selectionEnd], [2, 2], '커서 자리가 바뀌었다');
    assert.strictEqual(dom.window.document.getElementById('ceCount').textContent, '5 / 60자');
  };
  const j3 = (s) => {
    const r = probeGrow(s, 'at', 0, '');
    assert.strictEqual(r.h, 'auto', 'scrollHeight 가 0 이면 height 는 auto 로 남아야 한다');
    assert.strictEqual(r.min, '');
  };
  test('스크롤J1: taGrow 는 재는 순간 부모 높이를 잠그고 글 칸을 접으며, 끝나면 풀고 높이를 넣는다', () => j1(src));
  test('스크롤J2: ceGrow 는 +2, 줄바꿈은 공백, 커서 자리 그대로, 글자 수 표시 그대로, 잠금 사용', () => j2(src));
  test('스크롤J3: scrollHeight 0 이면 height 는 auto 로 남는다', () => j3(src));

  //  ── J4: atBlocksRender ────────────────────────────────────────────
  const AT_FIX = '<!doctype html><html><body><div id="atBlocks"></div></body></html>';
  function atJs(s) {
    return [
      "var esc = s => String(s == null ? '' : s).replace(/[&<>\"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'})[c]; });",
      'var $ = function(sel){ return document.querySelector(sel); };',
      "var ATE = { blocks: [{ name: 'A과제', text: 'hello world', hours: 1 }, { name: 'B과제', text: 'second', hours: 2 }], memo: 'memo text', sending: false, showErr: false };",
      'function atProjects(){ return []; }', "function atProjColor(){ return '#000'; }", "function atHoursText(h){ return String(h); }", 'function atHoursOk(){ return true; }',
      "function atBlockProblem(){ return ''; }", 'function atStatRender(){}',
      'var __placeMin = null; function atAddShown(){ return true; } function atAddPlace(){ __placeMin = document.getElementById("atBlocks").style.minHeight; }',
      extractFn(s, 'atBlockShowProblem'), extractFn(s, 'atHoursBad'), extractFn(s, 'atFocusKey'), extractFn(s, 'atFocusRestore'),
      extractFn(s, 'holdHeight'), extractFn(s, 'taGrow'), extractFn(s, 'atGrow'), extractFn(s, 'atBlocksRender'),
      'window.__probe = function(){',
      '  var box = document.getElementById("atBlocks");',
      '  Object.defineProperty(box, "offsetHeight", { get: function(){ return 300; } });',
      '  var mins = [];',
      '  Object.defineProperty(window.HTMLTextAreaElement.prototype, "scrollHeight", { configurable: true, get: function(){ mins.push(box.style.minHeight); return 40; } });',
      '  atBlocksRender();',
      '  var firstMins = mins.slice(); mins.length = 0;',
      '  var ta = box.querySelector("textarea[data-bt=\\"0\\"]"); ta.focus(); ta.setSelectionRange(2, 4);',
      '  atBlocksRender();',
      '  var ta2 = box.querySelector("textarea[data-bt=\\"0\\"]"), ae = document.activeElement;',
      '  return { firstMins: firstMins, mins: mins, after: box.style.minHeight, placeMin: __placeMin,',
      '    vals: Array.prototype.map.call(box.querySelectorAll("textarea[data-bt]"), function(t){ return t.value; }), memo: box.querySelector("textarea[data-memo]").value,',
      '    sameEl: ta2 === ae, replaced: ta2 !== ta, sel: [ta2.selectionStart, ta2.selectionEnd] };',
      '};'].join('\n');
  }
  const j4 = (s) => {
    const dom = new JSDOM(AT_FIX, { runScripts: 'outside-only' });
    dom.window.eval(atJs(s));
    const r = JSON.parse(JSON.stringify(dom.window.__probe()));
    assert.ok(r.firstMins.length > 0 && r.mins.length > 0, '글 칸 높이를 재지 않았다');
    assert.ok(r.firstMins.every((m) => m === '300px') && r.mins.every((m) => m === '300px'), `다시 그리는 동안 #atBlocks 가 잠겨 있지 않다: ${r.mins}`);
    assert.strictEqual(r.after, '', '다시 그린 뒤 잠금이 풀리지 않았다');
    assert.strictEqual(r.placeMin, '', 'atAddPlace 가 잠금이 풀리기 전에 불렸다');
    assert.deepStrictEqual(r.vals, ['hello world', 'second'], '칸 값이 모델과 다르다');
    assert.strictEqual(r.memo, 'memo text');
    assert.ok(r.replaced && r.sameEl, '다시 그린 뒤 포커스가 같은 칸으로 돌아오지 않았다');
    assert.deepStrictEqual(r.sel, [2, 4], '커서 선택 범위가 복원되지 않았다');
  };
  test('스크롤J4: atBlocksRender 는 그리는 동안 #atBlocks 를 잠그고 끝나면 풀며, 칸 값과 포커스와 선택을 지킨다', () => j4(src));

  //  ── J5, J6: 과제 탭 껍데기 ────────────────────────────────────────
  const P1 = '11111111-1111-4111-8111-111111111111', P3 = '33333333-3333-4333-8333-333333333333';
  const B1 = 'bbbbbbbb-0000-4000-8000-000000000001', B2 = 'bbbbbbbb-0000-4000-8000-000000000002';
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const META = { schemaVersion: '21', expectedSchema: '21', schemaMismatch: false, gate: 'ok', rev: 1, canWrite: true, userId: 7 };
  const DATA = () => ({ categories: [{ id: 'c-1', name: '휴가', color: '#9aa2b3' }, { id: 'db-' + P1, name: '장비 개발', color: '#3e5be0' }], entries: [], todos: [], rooms: [] });
  const MINE = [
    { projectUid: P1, name: '장비 개발', color: '#3e5be0', active: true, writable: true, mine: true, members: 6 },
    { projectUid: P3, name: '구형 유지', color: '#8a5cc8', active: false, writable: false, mine: true, members: 2 },
  ];
  const WATCH = [
    { projectUid: B1, name: '함대공 훈련장비', customer: 'D사', status: '진행중', statusId: 1, sectionId: 1, members: 2, hidden: false },
    { projectUid: B2, name: '숨겨진 표본', customer: 'E사', status: '진행중', statusId: 1, sectionId: 1, members: 0, hidden: true },
  ];
  function fakeClock() {
    let seq = 0, now = 0; const timers = new Map();
    return {
      setTimeout(fn, d, ...args) { const id = ++seq; timers.set(id, { fn, args, at: now + (Number(d) || 0) }); return id; },
      clearTimeout(id) { timers.delete(id); },
      advance(ms) {
        const end = now + ms;
        for (;;) {
          let best = null;
          for (const [id, t] of timers) if (t.at <= end && (best === null || t.at < timers.get(best).at)) best = id;
          if (best === null) { now = end; return; }
          const t = timers.get(best); timers.delete(best); now = t.at;
          try { t.fn(...t.args); } catch (_) { /* 앱의 일 */ }
        }
      },
    };
  }
  async function boot(source = src) {
    const clock = fakeClock(); const posts = [];
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quietConsole(),
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posts.push(o || {}); }, addEventListener() {}, removeEventListener() {} } };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.__narrow = false;
        win.matchMedia = () => ({ get matches() { return !!win.__narrow; }, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
        win.setTimeout = clock.setTimeout; win.clearTimeout = clock.clearTimeout;
      },
    });
    const w = dom.window, doc = w.document;
    const W = {
      w, doc, clock, posts,
      ev: (c) => w.eval(c),
      q: (s) => doc.querySelector(s), qa: (s) => [...doc.querySelectorAll(s)],
      last: (cmd) => [...posts].reverse().find((p) => p.cmd === cmd && p.reqId && !p.__done),
      async reply(cmd, res) {
        const p = W.last(cmd); assert.ok(p, `${cmd} 요청이 나가지 않았다`); p.__done = true;
        w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify(res) + ')'); await settle();
      },
      async click(sel) { const e = typeof sel === 'string' ? doc.querySelector(sel) : sel; assert.ok(e, `누를 것(${sel})이 없다`); e.click(); await settle(); clock.advance(150); await settle(); },
      async change(el, checked) { el.checked = checked; el.dispatchEvent(new w.Event('change', { bubbles: true })); await settle(); clock.advance(50); await settle(); },
      close: () => { try { w.close(); } catch (_) {} },
    };
    await settle();
    await W.reply('userSessionGet', { ok: true, user: { loginId: 'hjlee', name: '이현진' } });
    w.eval('__applyState(' + JSON.stringify(JSON.stringify(DATA())) + ',' + JSON.stringify(META) + ')');
    await settle(); clock.advance(5); await settle();
    for (const p of posts.filter((x) => x.cmd === 'saveState' && x.reqId && !x.__done)) { p.__done = true; w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',{"ok":true})'); }
    await settle();
    return W;
  }
  async function enter(W) {
    await W.click('#pcTabProject');
    await W.reply('projectCalendarBootstrap', { ok: true, data: { projects: MINE, limits: { title: 200, location: 200, memo: 8000 } } });
    await W.reply('pcWatchList', { ok: true, data: { projects: WATCH, max: 50 } });
    const p = W.last('projectCalendarLoad');
    if (p) {
      p.__done = true;
      const ps = (p.projectUids || []).map((u) => { const m = MINE.find((x) => x.projectUid === u); return m ? { projectUid: u, writable: m.writable, mine: true } : { projectUid: u, writable: false, mine: false }; });
      const ev = { eventUid: 'aaaaaaaa-0000-4000-8000-000000000001', projectUid: P1, title: '일정 1', startDate: today(), endDate: today(), startTime: null, endTime: null, location: '', memo: '', rowVersion: 1, deleted: false, createdBy: '홍', updatedBy: '홍', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
      W.w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify({ ok: true, data: { projects: ps, events: [ev], excluded: [], from: p.from, to: p.to } }) + ')');
      await settle();
    }
    W.ev('PCAL.view = "week"; pcRender()');
    await settle();
  }
  async function withBoot(source, fn) { const W = await boot(source); try { return await fn(W); } finally { W.close(); } }

  const j5 = async (W) => {
    await enter(W);
    const sc = W.q('#pcWScroll'), side = W.q('#pcView .pc-side'), area = W.q('#pcArea'), main = W.q('#pcView .pc-main');
    assert.ok(sc && side && area && main, '주간 보기 껍데기가 그려지지 않았다');
    const same = (what) => {
      assert.ok(W.q('#pcWScroll') === sc, `${what} 뒤 #pcWScroll 이 새 요소다(scrollTop 이 0 으로 튄다)`);
      assert.ok(W.q('#pcView .pc-side') === side, `${what} 뒤 .pc-side 가 새 요소다`);
      assert.ok(W.q('#pcArea') === area && W.q('#pcView .pc-main') === main, `${what} 뒤 껍데기가 새 요소다`);
    };
    W.ev('pcRender()'); await settle(); same('pcRender()');
    const cnt0 = side.querySelector('.pc-count').textContent, names0 = sc.querySelectorAll('.pc-wname').length;
    assert.ok(names0 >= 1, '주간 표에 과제 줄이 없다');
    //  체크 바꾸기
    const ck = W.q('#pcView .pc-list:not(.pc-list-w) input[data-act="toggle"]');
    await W.change(ck, !ck.checked); same('체크 change');
    //  전체 해제, 전체 선택
    await W.click('#pcView [data-act="selNone"]'); same('전체 해제');
    assert.notStrictEqual(side.querySelector('.pc-count').textContent, cnt0, '전체 해제 뒤 목록 안(표시 개수)이 바뀌지 않았다');
    assert.strictEqual(sc.querySelectorAll('.pc-wname').length, 0, '전체 해제 뒤 주간 표 안이 바뀌지 않았다');
    await W.click('#pcView [data-act="selAll"]'); same('전체 선택');
    assert.ok(sc.querySelectorAll('.pc-wname').length >= 1, '전체 선택 뒤 주간 표에 과제 줄이 돌아오지 않았다');
    //  메모 첫 줄, 다음 주
    await W.click('#pcView [data-act="memoLine"]'); same('메모 첫 줄');
    const range0 = W.q('#pcView .pc-range').textContent, cells0 = sc.querySelector('.pc-wcells').dataset.from;
    await W.click('#pcView [data-act="next"]'); same('다음 주');
    assert.notStrictEqual(sc.querySelector('.pc-wcells') && sc.querySelector('.pc-wcells').dataset.from, cells0, '다음 주 뒤 표 안이 바뀌지 않았다');
    assert.ok(typeof range0 === 'string');
    //  창 크기 조절
    W.w.dispatchEvent(new W.w.Event('resize')); W.clock.advance(400); await settle(); same('resize');
    //  포커스 복원
    const fkEl = W.q('#pcView [data-fk="selNone"]') || W.q('#pcView [data-fk^="ck-"]');
    const fk = fkEl.dataset.fk; fkEl.focus();
    W.ev('pcRender()'); await settle();
    assert.ok(W.doc.activeElement && W.doc.activeElement !== fkEl && W.doc.activeElement.dataset.fk === fk && W.doc.activeElement.isConnected, '다시 그린 뒤 data-fk 포커스가 복원되지 않았다');
    same('포커스 복원 pcRender()');
  };
  test('스크롤J5: 과제 탭 주간은 다시 그려도 스크롤 상자, 왼쪽 목록, 껍데기가 같은 요소이고 안만 바뀐다', () => withBoot(src, j5));

  const j6 = async (W) => {
    await enter(W);
    const sc1 = W.q('#pcWScroll');
    W.ev('PCAL.view = "month"; pcRender()'); await settle();
    assert.ok(!W.q('#pcWScroll'), '월간에 주간 상자가 남아 있다');
    W.ev('PCAL.view = "week"; pcRender()'); await settle();
    const sc2 = W.q('#pcWScroll');
    assert.ok(sc2 && sc2 !== sc1, '월간에서 주간으로 올 때는 새 상자(의도된 맨 위)여야 한다');
    //  좁은 폭: 껍데기가 바뀐다
    const main = W.q('#pcView .pc-main');
    W.w.__narrow = true; W.ev('pcRender()'); await settle();
    const mainN = W.q('#pcView .pc-main');
    assert.ok(mainN !== main && mainN.dataset.shell === 'n', '넓은 폭에서 좁은 폭으로 가도 껍데기가 새로 만들어지지 않았다');
    assert.ok(!W.q('#pcView aside.pc-side'), '좁은 폭에 왼쪽 목록이 남아 있다');
    const scN = W.q('#pcWScroll');
    W.ev('PCAL.drawer = true; pcRender()'); await settle();
    assert.ok(W.q('#pcView .pc-main') === mainN && W.q('#pcView .pc-main').dataset.shell === 'n', '서랍을 열 때 껍데기가 새로 만들어졌다');
    assert.ok(W.q('#pcWScroll') === scN, '서랍을 열 때 주간 스크롤 상자가 새로 만들어졌다');
    const dr = W.q('#pcDrawer');
    assert.ok(dr && dr.querySelectorAll('.pc-side.in-drawer .pc-row').length >= 1, '서랍 안에 과제 목록이 없다');
    W.ev('pcRender()'); await settle();
    assert.ok(W.q('#pcDrawer') === dr, '서랍이 열려 있는 채 다시 그리면 같은 서랍이어야 한다');
    const dside = dr.querySelector('.pc-side');
    W.ev('pcRender()'); await settle();
    assert.ok(W.q('#pcDrawer .pc-side') === dside, '서랍 안 목록 상자가 새 요소다');
    W.ev('PCAL.drawer = false; pcRender()'); await settle();
    assert.ok(!W.q('#pcDrawer'), '서랍을 닫았는데 서랍이 남아 있다');
    assert.ok(W.q('#pcView .pc-main') === mainN && W.q('#pcWScroll') === scN, '서랍을 닫을 때 껍데기나 스크롤 상자가 새로 만들어졌다');
  };
  test('스크롤J6: 월간에서 주간으로, 넓은 폭에서 좁은 폭으로, 서랍 열고 닫기는 껍데기와 주간 스크롤 상자를 그대로 둔다', () => withBoot(src, j6));

  //  ── J7: 관리 목록 ─────────────────────────────────────────────────
  const KINDS = {
    cust: { fn: 'reloadCustomerList', box: 'custList', msg: 'custMsgSet', fail: '발주처 목록을 불러오지 못했습니다.', ok: JSON.stringify([{ id: 5, name: '신규 발주처' }]), okText: 'RENDERED:신규 발주처' },
    code: { fn: 'reloadCodeList', box: 'codeList', msg: 'codeMsgSet', fail: '목록을 불러오지 못했습니다.', ok: JSON.stringify([{ id: 5, name: '신규 값' }]), okText: 'RENDERED:신규 값' },
    ra: { fn: 'raReload', box: 'raList', msg: 'raMsgSet', fail: '회의실 목록을 불러오지 못했습니다.', ok: JSON.stringify([{ id: 5, name: '신규 회의실' }]), okText: 'RENDERED:신규 회의실' },
  };
  function mgmtJs(s, kind) {
    const k = KINDS[kind];
    return [
      extractCodeIdsBlock(s),
      "var codeKind = 'section', custList = [], codeList = [], raList = [], raLoaded = false, raEditId = null;",
      "var ICON = { spinner: 'SPIN', alert: 'ALERT' };",
      "var esc = function(x){ return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };",
      "function raParse(l){ try{ var a = JSON.parse(l || '[]'); return Array.isArray(a) ? a : null; }catch(_){ return null; } }",
      "function renderCustomerList(){ document.getElementById('custList').textContent = 'RENDERED:' + custList.map(function(c){ return c.name; }).join(','); }",
      "function renderCodeList(){ document.getElementById('codeList').textContent = 'RENDERED:' + codeList.map(function(c){ return c.name; }).join(','); }",
      "function raRender(){ document.getElementById('raList').textContent = 'RENDERED:' + raList.map(function(c){ return c.name; }).join(','); }",
      'window.__msgs = []; function custMsgSet(h, t){ __msgs.push({ h: h, t: t }); } function codeMsgSet(h, t){ __msgs.push({ h: h, t: t }); } function raMsgSet(h, t){ __msgs.push({ h: h, t: t }); }',
      'var __pending = []; function hostRequest(cmd, p){ return new Promise(function(res){ __pending.push({ cmd: cmd, p: p, res: res }); }); }',
      extractFn(s, k.fn),
      'function __tick(){ return new Promise(function(res){ setTimeout(res, 0); }); }',
      'window.__probe = async function(mode, withRows, reply){',
      `  var box = document.getElementById('${k.box}');`,
      "  if(withRows) box.innerHTML = '<div class=\"cust-row\" id=\"r1\">a</div><div class=\"cust-row\" id=\"r2\">b</div>';",
      '  var r1 = box.querySelector("#r1");',
      `  var p = ${k.fn}(mode === 'fresh' ? { fresh: true } : undefined);`,
      '  var before = { html: box.innerHTML, sameRow: box.querySelector("#r1") === r1, hasSpin: box.innerHTML.indexOf("SPIN") >= 0 };',
      "  __pending[0].res(reply === 'ok' ? { ok: true, list: " + JSON.stringify(k.ok) + " } : { ok: false });",
      '  await p; await __tick();',
      '  return { before: before, after: { text: box.textContent, sameRow: box.querySelector("#r1") === r1, rows: box.querySelectorAll(".cust-row").length }, msgs: __msgs };',
      '};'].join('\n');
  }
  async function probeMgmt(s, kind, ...args) {
    const dom = new JSDOM('<!doctype html><html><body><div id="custList"></div><div id="codeList"></div><div id="raList"></div></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(mgmtJs(s, kind));
    return JSON.parse(JSON.stringify(await dom.window.__probe(...args)));
  }
  const j7 = async (s, kind) => {
    const k = KINDS[kind];
    //  줄이 있을 때: 회신 전 같은 노드, 스피너 없음. 회신 뒤 새 목록
    let r = await probeMgmt(s, kind, 'plain', true, 'ok');
    assert.ok(r.before.sameRow && !r.before.hasSpin, `${k.fn}: 줄이 있는데 회신 전에 목록을 비웠다(스크롤이 0 으로 튄다)`);
    assert.strictEqual(r.after.text, k.okText, `${k.fn}: 회신 뒤 새 목록이 그려지지 않았다`);
    //  fresh: 회신 전 스피너
    r = await probeMgmt(s, kind, 'fresh', true, 'ok');
    assert.ok(!r.before.sameRow && r.before.hasSpin, `${k.fn}: fresh 인데 회신 전에 스피너를 보이지 않았다`);
    //  줄이 있을 때 실패: 줄은 그대로, 메시지 줄로 알린다
    r = await probeMgmt(s, kind, 'plain', true, 'fail');
    assert.ok(r.after.sameRow && r.after.rows === 2, `${k.fn}: 다시 읽기 실패가 목록을 지웠다`);
    assert.strictEqual(r.msgs.length, 1, `${k.fn}: 실패를 메시지 줄로 알리지 않았다`);
    assert.strictEqual(r.msgs[0].h, 'ALERT ' + k.fail, `${k.fn}: 메시지가 기존 문장이 아니다: ${r.msgs[0].h}`);
    assert.strictEqual(r.msgs[0].t, 'err');
    //  줄이 없을 때 실패: 상자에 기존 문장
    r = await probeMgmt(s, kind, 'plain', false, 'fail');
    assert.strictEqual(r.after.text, k.fail, `${k.fn}: 줄이 없을 때 실패 문장이 상자에 들어가지 않았다`);
    assert.strictEqual(r.msgs.length, 0, `${k.fn}: 상자에 문장을 넣었는데 메시지 줄도 불렀다`);
  };
  for (const kind of ['cust', 'code', 'ra']) {
    test(`스크롤J7(${KINDS[kind].fn}): 줄이 있으면 비우지 않고 회신 뒤 바꾼다, fresh 는 스피너, 실패는 줄을 지키며 기존 문장으로 알린다`, () => j7(src, kind));
  }

  /* ══ (M) 변이 ═════════════════════════════════════════════════════ */
  const M = [
    ['M1 taGrow 의 holdHeight 지우기', () => mutateFn(src, 'taGrow', 'const release = holdHeight(t.parentElement); ', 'const release = () => {}; '), [['S1', S.S1], ['J1', j1]]],
    ['M2 release() 지우기', () => mutateFn(src, 'taGrow', "'px'; release(); }", "'px'; }"), [['J1', j1]]],
    ['M3 atGrow 를 옛 한 줄로', () => mutate('function atGrow(t){ taGrow(t, 0); }', "function atGrow(t){ if(!t) return; t.style.height = 'auto'; const h = t.scrollHeight; if(h > 0) t.style.height = h + 'px'; }"), [['S1', S.S1]]],
    ['M4 ceGrow 를 옛 꼴로', () => mutate('  taGrow(t, 2);   // +2', "  t.style.height = 'auto';\n  if(t.scrollHeight) t.style.height = (t.scrollHeight + 2) + 'px';   // +2"), [['S1', S.S1], ['J2', j2]]],
    ['M5 atBlocksRender 의 holdHeight(box) 지우기', () => mutateFn(src, 'atBlocksRender', 'const release = holdHeight(box);', 'const release = () => {};'), [['S2', S.S2], ['J4', j4]]],
    ['M9 atBlocksRender 의 release() 지우기', () => mutateFn(src, 'atBlocksRender', 'atGrow(mt); }\n  release();\n', 'atGrow(mt); }\n'), [['S2', S.S2]]],
    ['M6 pcRenderWeek 상자를 늘 새로 만들기', () => mutateFn(src, 'pcRenderWeek', "if(!sc || sc.id !== 'pcWScroll'){ body.innerHTML", '{ body.innerHTML'), [['S3', S.S3]], j5],
    ['M7 pcRender 가 껍데기 판정 없이 늘 다시 쓰기', () => mutateFn(src, 'pcRender', 'if(!main0 || !main0.classList.contains(\'pc-main\') || main0.dataset.shell !== shellKey){', 'if(true){'), [['S4', S.S4]], j5],
    ...['reloadCustomerList', 'reloadCodeList', 'raReload'].map((fn, i) => [`M8 ${fn} 에서 if(fresh) 지우기`, () => mutateFn(src, fn, 'if(fresh) box.innerHTML = `<div class="cust-empty">${ICON.spinner}', 'box.innerHTML = `<div class="cust-empty">${ICON.spinner}'),
      [['S5', S.S5], ['J7', (s) => j7(s, ['cust', 'code', 'ra'][i])]]]),
    ['M10 switchCodeKind 에서 fresh 빼기', () => mutateFn(src, 'switchCodeKind', 'reloadCodeList({ fresh: true })', 'reloadCodeList()'), [['S5', S.S5]]],
    ['M11 taGrow 에 scrollTop 저장 복원 끼우기', () => mutateFn(src, 'taGrow', "t.style.height = 'auto';", "const st = t.parentElement && t.parentElement.scrollTop; t.style.height = 'auto';"), [['S6', S.S6]]],
  ];
  for (const [name, make, checks, j5mut] of M) {
    test(`스크롤${name}: 옛 코드로 되돌리면 ${checks.map((c) => c[0]).join(', ')}${j5mut ? ', J5' : ''} 가 실패한다`, async () => {
      const bad = make();
      for (const [id, fn] of checks) assert.ok(await failsAssert(() => fn(bad)), `${name}: ${id} 가 변이를 잡지 못했다`);
      if (j5mut) assert.ok(await failsAssert(() => withBoot(bad, j5)), `${name}: J5 가 변이를 잡지 못했다`);
    });
  }
}
