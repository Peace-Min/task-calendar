// 한글 조합 중 휠 확정 장치 계약 (docs/SCROLL-STABILITY.md 11절, 2026-11-05)
//
// 지키는 것: 조합 중인 편집 칸이 있을 때 휠이 오면, 스크롤 전(window capture, non-passive)에 blur 로 조합을 확정하고
// 두 프레임 뒤(rAF 안의 rAF) 같은 칸으로 preventScroll 로 돌아오며 선택 범위를 지킨다. 조합이 없으면 아무것도 안 한다.
// 휠을 막지 않고, 스크롤 위치를 저장했다 되돌리지 않는다. 확정용 blur 와 재포커스 동안 locBind 의 blur, focus 처리기는 건너뛴다.
//   (I) 정적 계약  (J) jsdom 행동  (M) 변이(핵심 줄을 되돌리면 실패)
// jsdom 은 실제 IME, 스크롤, reveal 을 흉내 내지 못한다. 실제 입력기 확인은 문서 11.8 을 손으로 한다.
import { test, skip, assert, loadAppSource, extractFunction, importOptional, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();

function mutate(from, to, base = src) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${String(from).slice(0, 80)}`);
  return out;
}
//  한 함수 안에서만 바꾼다. all 이면 그 함수 안의 같은 문자열을 모두 바꾼다.
function mutateFn(base, fnName, from, to, all = false) {
  const body = extractFn(base, fnName);
  const nb = all ? body.split(from).join(to) : body.replace(from, to);
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
const count = (s, needle) => s.split(needle).length - 1;
const IME_FNS = ['imeFlushing', 'imeOnStart', 'imeOnEnd', 'imeOnWheel', 'imeGuardInstall'];
function imeConstLine(s) {
  const m = s.match(/^const IME = \{[^\n]*\};$/m);
  assert.ok(m, 'const IME = { ... }; 줄이 없다');
  return m[0];
}

/* ══ (I) 정적 계약 ═══════════════════════════════════════════════════ */
const I = {
  I1(s) {
    assert.strictEqual(count(s, 'function imeGuardInstall('), 1, 'imeGuardInstall 정의가 하나가 아니다');
    const rest = s.replace(extractFn(s, 'imeGuardInstall'), '');
    assert.strictEqual(count(rest, 'imeGuardInstall();'), 1, '정의 밖 imeGuardInstall(); 호출이 하나가 아니다');
    const iStart = s.indexOf('/* ---------- 시작 ---------- */'), iCall = s.indexOf('imeGuardInstall();', iStart);
    const iNext = s.indexOf('renderWeekdays();', iStart);
    assert.ok(iStart >= 0 && iCall > iStart && iCall < iNext, '설치 호출이 시작 절의 renderWeekdays(); 앞에 있지 않다');
  },
  I2(s) {
    const f = noComments(extractFn(s, 'imeGuardInstall'));
    assert.ok(f.includes("window.addEventListener('wheel', imeOnWheel, { capture: true, passive: false })"), 'wheel 을 window 에 capture, passive false 로 걸지 않는다');
    assert.ok(f.includes("document.addEventListener('compositionstart', imeOnStart, true)"), 'compositionstart 를 document capture 로 걸지 않는다');
    assert.ok(f.includes("document.addEventListener('compositionend', imeOnEnd, true)"), 'compositionend 를 document capture 로 걸지 않는다');
    assert.strictEqual(count(f, 'addEventListener('), 3, '설치 함수의 리스너가 셋이 아니다');
  },
  I3(s) {
    for (const fn of ['imeGuardInstall', 'imeOnWheel']) {
      const f = noComments(extractFn(s, fn));
      for (const ev of ['scroll', 'touchmove', 'touchstart', 'pointerdown', 'mousedown', 'keydown']) {
        assert.ok(!f.includes(`'${ev}'`), `${fn} 에 '${ev}' 가 있다(문서 11.5, 걸지 않는 신호)`);
      }
    }
  },
  I4(s) {
    const f = noComments(extractFn(s, 'imeOnWheel'));
    for (const bad of ['preventDefault', 'scrollTop', 'scrollTo', 'scrollIntoView', 'setTimeout']) {
      assert.ok(!f.includes(bad), `imeOnWheel 에 ${bad} 가 있다`);
    }
  },
  I5(s) {
    const f = noComments(extractFn(s, 'imeOnWheel'));
    const iRaf = f.indexOf('requestAnimationFrame(() => requestAnimationFrame(() => {');
    assert.ok(iRaf >= 0, '재포커스가 두 겹 requestAnimationFrame 안에 있지 않다');
    assert.strictEqual(count(f, '.focus('), 1, 'imeOnWheel 의 .focus( 가 하나가 아니다');
    assert.ok(f.indexOf('.focus(') > iRaf, '.focus( 가 두 겹 rAF 앞에 있다');
    assert.ok(f.includes('el.focus({ preventScroll: true })'), '재포커스가 preventScroll: true 를 쓰지 않는다');
  },
  I6(s) {
    const rest = s.replace(extractFn(s, 'imeFlushing'), '');
    assert.strictEqual(count(rest, 'imeFlushing()'), 2, '정의 밖 imeFlushing() 호출이 두 번이 아니다(문서 11.6)');
    const lb = extractFn(s, 'locBind');
    assert.strictEqual(count(lb, 'imeFlushing()'), 2, 'imeFlushing() 두 곳이 locBind 안에 있지 않다');
    assert.ok(lb.includes("inp.addEventListener('focus', () => { if(imeFlushing()) return;"), 'locBind focus 처리기 맨 앞에 건너뛰기가 없다');
    assert.ok(lb.includes("inp.addEventListener('blur', () => { if(imeFlushing()) return;"), 'locBind blur 처리기 맨 앞에 건너뛰기가 없다');
  },
  I7(s) {
    const PUNCT = [[/—/, '엠 대시'], [/–/, 'en 대시'], [/「|」/, '낫표'], [/(^|\s)·|·(\s|$)/, '띄어 쓴 가운데 점']];
    const i0 = s.indexOf('/* ---------- 한글 조합 중 휠');
    assert.ok(i0 >= 0, '장치 머리 주석이 없다');
    const block = s.slice(i0, s.indexOf(extractFn(s, 'imeGuardInstall')) + extractFn(s, 'imeGuardInstall').length);
    for (const [re, name] of PUNCT) assert.ok(!re.test(block), `장치 코드와 주석에 ${name}가 있다`);
  },
};
test('IME I1: 설치 함수는 하나, 정의 밖 호출도 하나이고 시작 절 renderWeekdays 앞이다', () => I.I1(src));
test('IME I2: wheel 은 window 에 capture, passive false, 조합 둘은 document capture', () => I.I2(src));
test('IME I3: 설치 함수와 휠 처리기에 scroll, touch, pointerdown, mousedown, keydown 이 없다', () => I.I3(src));
test('IME I4: 휠 처리기에 preventDefault, scrollTop, scrollTo, scrollIntoView, setTimeout 이 없다', () => I.I4(src));
test('IME I5: 재포커스는 두 겹 rAF 안에서만, preventScroll: true', () => I.I5(src));
test('IME I6: imeFlushing() 은 locBind 의 blur, focus 두 곳에서만 쓴다', () => I.I6(src));
test('IME I7: 장치 코드와 주석에 엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점이 없다', () => I.I7(src));

/* ══ (J) jsdom ═══════════════════════════════════════════════════════ */
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('IME J: jsdom 미설치, 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM, 'J1~J12 와 그에 기대는 변이가 등록되지 않았다');
} else {
  const FIX = '<!doctype html><html><body><div id="page">'
    + '<textarea id="ta">가나다라마바사아자차</textarea><input id="txt" type="text" value="가나다라마바사"><input id="srch" type="search" value="가나다라마바사">'
    + '<input id="other" type="text" value="x"><div id="pane"></div>'
    + '<div class="loc-combo"><input id="qaLoc" type="text" value="회의실"><button class="loc-tog"></button><button class="loc-clr"></button></div><div id="qaLocPop"></div>'
    + '</div></body></html>';
  const STUBS = [
    'var __loc = {}; var LOC = { open: 0, close: 0 };',
    'function locInput(p){ return document.getElementById(p + "Loc"); }',
    'function locOpen(p){ LOC.open++; __loc[p].open = true; }',
    'function locClose(p){ LOC.close++; __loc[p].open = false; }',
    'function locSyncClear(){} function locItems(){ return { list: [] }; } function locRender(){} function locPick(){}',
  ].join('\n');

  //  앱의 장치 코드와 locBind 를 jsdom 창에 올린다. rAF, setTimeout 은 손으로 비우는 큐, focus 와 blur 는 감시.
  function boot(s) {
    const dom = new JSDOM(FIX, { runScripts: 'outside-only' });
    const w = dom.window, d = w.document;
    const raf = [], timers = []; let now = 0;
    w.requestAnimationFrame = (f) => { raf.push(f); return raf.length; };
    w.setTimeout = (f, ms) => { timers.push({ f, at: now + (ms || 0) }); return timers.length; };
    const log = [];
    const P = w.HTMLElement.prototype, of = P.focus, ob = P.blur;
    P.focus = function (o) { log.push({ k: 'focus', id: this.id, arg: o === undefined ? null : JSON.parse(JSON.stringify(o)) }); return of.call(this, o); };
    P.blur = function () { log.push({ k: 'blur', id: this.id }); return ob.call(this); };
    w.eval([imeConstLine(s), ...IME_FNS.map((n) => extractFn(s, n)), STUBS, extractFn(s, 'locBind'), 'imeGuardInstall(); window.__IME = IME;'].join('\n'));   // eval 안의 const 는 밖에서 안 보여 창에 걸어 둔다
    const h = {
      w, d, log, $: (id) => d.getElementById(id),
      blurs: () => log.filter((x) => x.k === 'blur').length,
      focuses: () => log.filter((x) => x.k === 'focus').length,
      clear: () => { log.length = 0; },
      raf: () => { const q = raf.splice(0); for (const f of q) f(); },
      rafLen: () => raf.length,
      advance: (ms) => { now += ms; for (;;) { const i = timers.findIndex((t) => t.at <= now); if (i < 0) break; const [t] = timers.splice(i, 1); t.f(); } },
      comp: (el, type) => {
        const C = w.CompositionEvent || w.Event;
        el.dispatchEvent(new C(type, { bubbles: true, cancelable: true, data: '뮻' }));
      },
      wheel: (target) => {
        const W = w.WheelEvent || w.Event;
        const ev = new W('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
        (target || d.getElementById('pane')).dispatchEvent(ev);
        return ev;
      },
      ime: () => w.__IME,
      flushing: () => w.eval('imeFlushing()'),
      LOC: () => JSON.parse(JSON.stringify(w.eval('LOC'))),
    };
    return h;
  }
  //  칸에 포커스, 선택 3~5, 조합 시작 뒤 휠. 감시 기록은 휠 직전부터.
  function composeAndWheel(h, id, sel = [3, 5]) {
    const el = h.$(id);
    el.focus(); el.setSelectionRange(sel[0], sel[1]);
    h.comp(el, 'compositionstart');
    h.clear();
    return { el, ev: h.wheel() };
  }

  const j1For = (id) => (s) => {
    const h = boot(s);
    const { el, ev } = composeAndWheel(h, id);
    assert.strictEqual(h.blurs(), 1, `${id}: 조합 중 휠에 blur 가 한 번이 아니다`);
    assert.strictEqual(h.focuses(), 0, `${id}: 휠 처리기 안에서 바로 focus 했다`);
    assert.strictEqual(h.d.activeElement, h.d.body, `${id}: blur 뒤 activeElement 가 body 가 아니다`);
    assert.strictEqual(ev.defaultPrevented, false, `${id}: 휠을 막았다(스크롤이 사라진다)`);
    h.raf();
    assert.strictEqual(h.focuses(), 0, `${id}: 한 프레임 만에 재포커스했다(두 프레임이어야 한다)`);
    h.raf();
    assert.strictEqual(h.focuses(), 1, `${id}: 두 프레임 뒤 재포커스가 한 번이 아니다`);
    const f = h.log.find((x) => x.k === 'focus');
    assert.strictEqual(f.id, id);
    assert.deepStrictEqual(f.arg, { preventScroll: true }, `${id}: 재포커스 인자가 { preventScroll: true } 가 아니다`);
    assert.strictEqual(h.d.activeElement, el, `${id}: 재포커스 뒤 activeElement 가 그 칸이 아니다`);
    assert.deepStrictEqual([el.selectionStart, el.selectionEnd], [3, 5], `${id}: 선택 범위가 바뀌었다`);
    assert.strictEqual(h.rafLen(), 0, `${id}: 남은 rAF 가 있다`);
  };
  const j1 = j1For('ta');
  const j2 = (s) => {
    const h = boot(s);
    const el = h.$('ta'); el.focus(); h.clear();
    h.wheel(); h.raf(); h.raf();
    assert.strictEqual(h.blurs(), 0, '조합이 없는데 휠에 blur 했다');
    assert.strictEqual(h.d.activeElement, el);
  };
  const j3 = (s) => {
    const h = boot(s);
    const el = h.$('ta'); el.focus();
    h.comp(el, 'compositionstart'); h.comp(el, 'compositionend'); h.clear();
    h.wheel(); h.raf(); h.raf();
    assert.strictEqual(h.blurs(), 0, 'compositionend 뒤 휠에 blur 했다');
    assert.strictEqual(h.ime().el, null, 'compositionend 뒤 조합 기억이 남았다');
  };
  const j4 = (s) => {
    const h = boot(s);
    composeAndWheel(h, 'ta'); h.raf(); h.raf();
    h.clear();
    h.wheel(); h.raf(); h.raf();
    assert.strictEqual(h.blurs(), 0, '한 바퀴 돈 뒤 휠에 다시 blur 했다');
    assert.strictEqual(h.d.activeElement, h.$('ta'));
  };
  const j5 = (s) => {
    const h = boot(s);
    composeAndWheel(h, 'ta');
    for (let i = 0; i < 4; i++) h.wheel();
    h.raf(); h.raf(); h.raf();
    assert.strictEqual(h.blurs(), 1, '휠 다섯 번에 blur 가 한 번이 아니다');
    assert.strictEqual(h.focuses(), 1, '휠 다섯 번에 focus 가 한 번이 아니다');
  };
  const j6 = (s) => {
    const h = boot(s);
    composeAndWheel(h, 'ta');
    h.raf();
    const other = h.$('other'); other.focus();
    h.raf();
    assert.strictEqual(h.d.activeElement, other, '두 프레임 사이 다른 칸에 간 포커스를 되돌렸다');
    assert.strictEqual(h.log.filter((x) => x.k === 'focus' && x.id === 'ta').length, 0, '조합 칸으로 재포커스를 불렀다');
  };
  const j7 = (s) => {
    const h = boot(s);
    const { el } = composeAndWheel(h, 'ta');
    h.raf();
    el.remove();
    h.raf();
    assert.strictEqual(h.focuses(), 0, '문서에서 빠진 칸에 재포커스를 불렀다');
    assert.strictEqual(h.d.activeElement, h.d.body);
  };
  const j8 = (s) => {
    const h = boot(s);
    const el = h.$('ta'); el.focus();
    h.comp(el, 'compositionstart');
    h.$('other').focus();
    h.clear();
    h.wheel(); h.raf(); h.raf();
    assert.strictEqual(h.blurs(), 0, '조합 칸이 이미 포커스를 잃었는데 휠에 blur 했다');
    assert.strictEqual(h.d.activeElement, h.$('other'));
  };
  const j9 = (s) => {
    const h = boot(s);
    const el = h.$('ta'), seen = [];
    el.focus(); el.setSelectionRange(3, 5); h.comp(el, 'compositionstart');
    el.addEventListener('blur', () => seen.push(['blur', h.flushing()]));
    el.addEventListener('focus', () => seen.push(['focus', h.flushing()]));
    h.wheel();
    assert.strictEqual(h.flushing(), false, '휠 처리 뒤 imeFlushing() 이 참으로 남았다');
    h.raf(); h.raf();
    assert.deepStrictEqual(seen, [['blur', true], ['focus', true]], '확정용 blur 와 재포커스 동안 imeFlushing() 이 참이 아니다');
    assert.strictEqual(h.flushing(), false, '재포커스 뒤 imeFlushing() 이 참으로 남았다');
  };
  const j10 = (s) => {
    const h = boot(s);
    const el = h.$('ta');
    const pf = h.w.HTMLElement.prototype.focus;
    el.focus = function (o) { pf.call(this, o); this.setSelectionRange(this.value.length, this.value.length); };
    composeAndWheel(h, 'ta');
    h.raf(); h.raf();
    assert.strictEqual(h.d.activeElement, el);
    assert.deepStrictEqual([el.selectionStart, el.selectionEnd], [3, 5], '재포커스가 선택을 끝으로 옮겼는데 되돌리지 않았다');
  };
  const j11 = (s) => {
    //  목록이 열린 채 조합 중 휠, 느린 프레임(200ms)이어도 닫히지 않는다
    let h = boot(s);
    h.w.eval("locBind('qa')");
    let inp = h.$('qaLoc'); inp.focus();
    assert.deepStrictEqual(h.LOC(), { open: 1, close: 0 }, '준비: 포커스로 목록이 열리지 않았다');
    h.comp(inp, 'compositionstart'); h.wheel();
    h.advance(200);
    assert.strictEqual(h.LOC().close, 0, '확정용 blur 뒤 느린 프레임에 장소 목록이 닫혔다');
    h.raf(); h.raf(); h.advance(200);
    assert.deepStrictEqual(h.LOC(), { open: 1, close: 0 }, '재포커스 뒤 목록 열기, 닫기 횟수가 바뀌었다');
    assert.strictEqual(h.d.activeElement, inp);
    //  목록이 닫힌 채(Esc 로 닫음) 조합 중 휠, 재포커스가 목록을 새로 열지 않는다
    h = boot(s);
    h.w.eval("locBind('qa')");
    inp = h.$('qaLoc'); inp.focus();
    h.w.eval("locClose('qa')");
    h.comp(inp, 'compositionstart'); h.wheel();
    h.raf(); h.raf(); h.advance(200);
    assert.deepStrictEqual(h.LOC(), { open: 1, close: 1 }, '재포커스가 닫힌 장소 목록을 새로 열었다');
    //  진짜 blur 는 그대로 닫는다(건너뛰기가 지나치지 않다)
    h.$('other').focus(); h.advance(200);
    assert.strictEqual(h.LOC().close, 2, '진짜 blur 에 목록을 닫지 않았다');
  };
  test('IME J1: textarea 조합 중 휠은 바로 blur 한 번, 두 프레임 뒤 preventScroll 재포커스 한 번, 선택 3~5 그대로, 휠은 막지 않음', () => j1(src));
  test('IME J2: 조합이 없으면 휠에 blur 가 없다', () => j2(src));
  test('IME J3: compositionend 뒤 휠에 blur 가 없고 기억이 지워진다', () => j3(src));
  test('IME J4: 한 바퀴 돈 뒤 다시 휠(compositionend 없이)에 blur 가 없다', () => j4(src));
  test('IME J5: 휠 다섯 번을 몰아도 blur 한 번, focus 한 번', () => j5(src));
  test('IME J6: 두 프레임 사이 다른 칸에 포커스가 가면 되돌리지 않는다', () => j6(src));
  test('IME J7: 두 프레임 사이 칸이 문서에서 빠지면 재포커스하지 않고 오류가 없다', () => j7(src));
  test('IME J8: 조합 시작 뒤 포커스가 다른 칸으로 갔으면 휠에 blur 가 없다', () => j8(src));
  test('IME J9: 확정용 blur 와 재포커스 처리기 안에서만 imeFlushing() 이 참이다', () => j9(src));
  test('IME J10: focus 가 선택을 끝으로 옮겨도 재포커스 뒤 3~5 로 돌아온다', () => j10(src));
  test('IME J11: 장소 칸은 느린 프레임에도 목록이 닫히지 않고, 재포커스가 목록을 새로 열지 않으며, 진짜 blur 는 닫는다', () => j11(src));
  const j12t = j1For('txt'), j12s = j1For('srch');
  const j12 = (s) => { j12t(s); j12s(s); };
  test('IME J12: input type=text 와 search 도 J1 과 같다', () => j12(src));

  /* ══ (M) 변이 ═════════════════════════════════════════════════════ */
  const W = 'imeOnWheel';
  const M = [
    ['M1 passive false 를 true 로', () => mutateFn(src, 'imeGuardInstall', 'passive: false', 'passive: true'), [['I2', I.I2]]],
    ['M2 capture 빼기', () => mutateFn(src, 'imeGuardInstall', '{ capture: true, passive: false }', '{ passive: false }'), [['I2', I.I2]]],
    ['M3 wheel 을 scroll 로', () => mutateFn(src, 'imeGuardInstall', "addEventListener('wheel'", "addEventListener('scroll'"), [['I2', I.I2], ['I3', I.I3], ['J1', j1]]],
    ['M4 el.blur() 지우기', () => mutateFn(src, W, 'try{ el.blur(); }', 'try{ }'), [['J1', j1]]],
    ['M5 휠 처리기의 기억 지우기 없애기', () => mutateFn(src, W, '  IME.el = null;\n', ''), [['J4', j4]]],
    ['M6 imeOnEnd 의 지우기 없애기', () => mutateFn(src, 'imeOnEnd', 'IME.el = null;', '{}'), [['J3', j3]]],
    ['M7 activeElement 판정 지우기', () => mutateFn(src, W, 'el !== document.activeElement || ', ''), [['J8', j8]]],
    ['M8 재포커스 activeElement 판정 지우기', () => mutateFn(src, W, ' || (a && a !== document.body)', ''), [['J6', j6]]],
    ['M9 재포커스 isConnected 판정 지우기', () => mutateFn(src, W, 'if(!el.isConnected || (a', 'if((a'), [['J7', j7]]],
    ['M10 rAF 한 겹', () => mutateFn(mutateFn(src, W, 'requestAnimationFrame(() => requestAnimationFrame(() => {', 'requestAnimationFrame(() => {'), W, '  }));\n}', '  });\n}'), [['I5', I.I5], ['J1', j1]]],
    ['M11 동기 재포커스', () => mutateFn(src, W, 'requestAnimationFrame(() => requestAnimationFrame(() => {', '[0].forEach(() => [0].forEach(() => {'), [['I5', I.I5], ['J1', j1]]],
    ['M12 preventScroll 빼기', () => mutateFn(src, W, 'el.focus({ preventScroll: true })', 'el.focus()'), [['I5', I.I5], ['J1', j1]]],
    ['M13 setSelectionRange 지우기', () => mutateFn(src, W, "try{ el.setSelectionRange(s, e, dir || 'none'); }catch(_){}", ''), [['J10', j10]]],
    ['M14 flushing 참 대입 지우기', () => mutateFn(src, W, 'IME.flushing = true;', '', true), [['J9', j9], ['J11', j11]]],
    ['M15 locBind blur 건너뛰기 지우기', () => mutateFn(src, 'locBind', "inp.addEventListener('blur', () => { if(imeFlushing()) return; ", "inp.addEventListener('blur', () => { "), [['I6', I.I6], ['J11', j11]]],
    ['M16 locBind focus 건너뛰기 지우기', () => mutateFn(src, 'locBind', "inp.addEventListener('focus', () => { if(imeFlushing()) return; ", "inp.addEventListener('focus', () => { "), [['I6', I.I6], ['J11', j11]]],
    ['M17 ev.preventDefault() 더하기', () => mutateFn(src, W, 'function imeOnWheel(){', 'function imeOnWheel(ev){ ev.preventDefault();'), [['I4', I.I4], ['J1', j1]]],
    ['M18 설치 호출 지우기', () => mutate(/\nimeGuardInstall\(\);[^\n]*/, ''), [['I1', I.I1]]],
  ];
  for (const [name, make, checks] of M) {
    test(`IME ${name}: ${checks.map((c) => c[0]).join(', ')} 가 실패한다`, async () => {
      const bad = make();
      for (const [id, fn] of checks) assert.ok(await failsAssert(() => fn(bad)), `${name}: ${id} 가 변이를 잡지 못했다`);
    });
  }
}
