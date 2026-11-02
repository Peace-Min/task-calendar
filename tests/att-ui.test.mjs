// 근태 편집 창(일간 #atEd, 주간 #awEd)의 두 UI 작업 시험.
//   1) 왼쪽 편집 칸과 오른쪽 패널 사이의 끌개(.at-split): 폭 변수 --atpw, 저장 tc_attPanelW, 비율 한계, 키보드, 두 번 누르기, 접힘과 좁은 배치에서 숨김.
//   2) 일간 [+ 과제 추가]를 주간과 같은 체크 목록으로: 체크 = 블록 있음, 빈 블록만 체크를 풀어 지움, 내용 있는 블록은 잠금, 전체 선택과 해제, 열어 둔 채 이어서.
//   긴 과제 이름은 두 줄까지(catFitName), "이미 있음" 글은 없다.
// (S) 정적, (B) jsdom 실행, (M) 변이. jsdom 이 없으면 (B)(M)은 skip(판정 없음).
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
const NL = String.fromCharCode(10);
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, '구간을 찾지 못했다: ' + a); return src.slice(i, j); };

// ══ (S) 정적 ══════════════════════════════════════════════════════════
test('(S) 끌개: 일간과 주간 몸통에 하나씩(separator, 세로, 키보드), 왼쪽 칸과 패널 사이', () => {
  for (const [id, pid] of [['atEdBody', 'atPanel'], ['awBody', 'awPanel']]) {
    const body = between(app, '<div class="at-ed-body" id="' + id + '">', '</aside>');
    const m = /<div class="at-split" role="separator" aria-orientation="vertical"[^>]*>/.exec(body);
    assert.ok(m, id + ' 에 끌개가 없다');
    assert.ok(/tabindex="0"/.test(m[0]) && /title="끌어서 폭 조절, 두 번 누르면 기본 폭"/.test(m[0]), id + ' 끌개의 키보드 접근이나 안내가 없다');
    assert.ok(body.indexOf('class="at-split"') < body.indexOf('<aside class="at-panel" id="' + pid + '"'), id + ' 끌개가 패널 앞에 있지 않다');
    assert.ok(body.indexOf('class="at-left"') < body.indexOf('class="at-split"'), id + ' 끌개가 왼쪽 칸 뒤에 있지 않다');
  }
});
test('(S) 끌개 CSS: 폭은 --atpw 변수(기본 360px)와 6px 칸, 접히면 숨고, 좁은 쌓기 배치에서 숨는다. 새 색 hex 없음', () => {
  assert.ok(/\.at-ed-body\{[^}]*grid-template-columns:minmax\(0,1fr\) 6px minmax\(280px,min\(var\(--atpw,360px\),60%\)\)/.test(app), '격자가 --atpw 변수를 쓰지 않는다');
  const left = app.replace(/var\(--atpw,360px\)/g, '');
  assert.ok(!/\.at-ed-body\{[^}]*grid-template-columns:[^;}]*\b360px/.test(left), '고정 360px 격자가 남아 있다');
  assert.ok(/\.at-ed-body\.folded \.at-panel,\.at-ed-body\.folded \.at-split\{display:none\}/.test(app), '접히면 끌개가 숨지 않는다');
  const nar = between(app, '@media (max-width:760px){\n  .at-ed-body{', '.at-grid{grid-auto-rows');
  assert.ok(/\.at-split\{display:none\}/.test(nar), '좁은 배치에서 끌개가 숨지 않는다');
  const css = between(app, '.at-split{position:relative', '.at-split + .at-panel');
  assert.ok(/cursor:col-resize/.test(css) && /var\(--line\)/.test(css) && /var\(--accent\)/.test(css), '끌개 모양이 토큰이 아니다');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), '끌개 CSS 에 새 hex 색이 있다');
});
test('(S) 끌개 JS: 저장 키 tc_attPanelW, pointer capture, rAF, 키보드 24/96, 두 번 누르기, 비율 한계(60%, 280px), 시작 때 한 번 배선', () => {
  const js = between(app, 'const AT_PW_KEY', 'function setupGuideResize(){');
  assert.ok(/AT_PW_KEY = 'tc_attPanelW'/.test(js) && /AT_PW_DEF = 360/.test(js) && /AT_PW_MIN = 280/.test(js) && /AT_PW_RATIO = 0\.6/.test(js), '상수가 다르다');
  assert.ok(js.includes('setPointerCapture') && js.includes('requestAnimationFrame') && js.includes("'dblclick'"), '끌기 세 가지(캡처, rAF, 두 번 누르기) 중 빠진 것이 있다');
  assert.ok(/ev\.shiftKey \? 96 : 24/.test(js) && js.includes("'ArrowLeft'") && js.includes("'ArrowRight'"), '키보드 걸음이 24/96 이 아니다');
  assert.ok(/try\{ localStorage\.setItem\(AT_PW_KEY/.test(js) && /try\{ const sv = parseInt\(localStorage\.getItem\(AT_PW_KEY\)/.test(js), '저장과 복원이 try/catch 안에 있지 않다');
  assert.ok(js.includes("window.addEventListener('resize'"), '창 크기 변화에 다시 묶지 않는다');
  assert.ok(/\nsetupSplitter\(\);\nsetupAttSplit\(\);/.test(app), '시작 순서에 setupAttSplit 이 없다(근태 창도 같은 시작 경로를 탄다)');
  assert.ok(!/[—–「」]/.test(js.replace(/\/\*[\s\S]*?\*\//g, '')), '금지 기호가 있다');
});
test('(S) 체크 목록: 일간 메뉴에 전체 선택, 전체 해제, 닫기, 새 과제 만들기가 있고(주간과 같은 클래스), "이미 있음" 글이 앱 어디에도 없다', () => {
  const m = between(app, '<div class="at-menu hidden" id="atAddMenu"', '<div class="at-stat"><span id="atHours">');
  for (const id of ['atAddQ', 'atAddAll', 'atAddNone', 'atAddList', 'atAddNew', 'atAddDone']) assert.ok(m.includes('id="' + id + '"'), id + ' 가 없다');
  assert.ok(m.includes('class="aw-mall"') && m.includes('class="aw-mfoot"'), '주간과 같은 클래스를 쓰지 않는다');
  assert.ok(!app.includes('이미 있음</small>') && !/small>이미 있음/.test(app), '"이미 있음" 글이 남아 있다');
  const fn = between(app, 'function atAddRender(){', 'function atAddApplied(');
  assert.ok(!fn.includes('이미 있음') && !/disabled/.test(fn), '일간 목록이 아직 이미 있음 흐림(disabled)을 쓴다');
});
test('(S) 공용 체크 줄(atCkItem): 일간과 주간이 같은 줄을 쓰고, 긴 이름은 .cat-nm + data-full 로 두 줄 맞춤, 잠금은 aria-disabled 와 안내 한 줄뿐', () => {
  const ck = between(app, 'function atCkItem(', 'function atCkFit(');
  assert.ok(ck.includes('role="menuitemcheckbox"') && ck.includes('class="cat-nm"') && ck.includes('data-full=') && ck.includes('aria-disabled="true"'), '체크 줄 모양이 다르다');
  assert.ok(app.includes("const AT_CK_LOCK_TIP = '내용이 있는 블록은 블록의 ✕ 로 지웁니다';"), '잠금 안내 문구가 다르다');
  assert.ok(between(app, 'function awAddRender(){', 'function awAddPick(').includes("atCkItem(x, 'data-awaddname'") && between(app, 'function awAddRender(){', 'function awAddPick(').includes('atCkFit(L)'), '주간이 공용 줄과 이름 맞춤을 쓰지 않는다');
  assert.ok(between(app, 'function atAddRender(){', 'function atAddApplied(').includes('atCkFit(L)'), '일간이 이름 맞춤을 부르지 않는다');
  assert.ok(/\.at-mi \.cat-nm\{flex:1;min-width:0\}/.test(app), '체크 줄의 이름 칸 CSS 가 없다');
  assert.ok(/#atAddMenu\{position:fixed;/.test(app), '일간 메뉴가 화면 기준(fixed)이 아니다(스크롤 칸에 잘린다)');
});

// ══ jsdom ═════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
if (!JSDOM) {
  skip('att-ui: jsdom 미설치, 끌개와 일간 체크 목록 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const CA = '2026-07-01T00:00:00.000Z';
  const LONG = '2026년도 차세대 통합 관제 시스템 구축 및 운영 고도화 사업 1차 추진 과제';
  const CATS = [
    { id: 'c-a', name: '알파', color: '#3e5be0', desc: '', createdAt: CA },
    { id: 'c-b', name: '베타', color: '#2e9e6b', desc: '', createdAt: CA },
    { id: 'c-c', name: '감마', color: '#d97706', desc: '', createdAt: CA },
    { id: 'c-d', name: LONG, color: '#5b6b7d', desc: '', createdAt: CA },
  ];
  const stateFor = () => ({ categories: CATS, entries: [], todos: [], rooms: [], attendance: {}, taskHours: {}, reportMarker: '-', reportMarkerCustom: '', reportIndent: 2 });
  function boot(src) {
    const errors = [];
    const vc = new jsdomMod.VirtualConsole();
    vc.on('jsdomError', (e) => { const s = String(e && (e.stack || e.message) || e); if (!/Not implemented/.test(s)) errors.push(s); });
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: vc,
      beforeParse(win) {
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {}; win.HTMLElement.prototype.scrollIntoView = function () {}; win.open = () => null;
        win.__realClose = win.close; win.close = function () {};
      },
    });
    const w = dom.window;
    const X = { w, doc: w.document, errors, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      $: (s) => w.document.querySelector(s), close: () => { try { w.__realClose.call(w); } catch (_) {} } };
    X.T = X.ev('todayYmd()');
    X.ev('state = ' + JSON.stringify(stateFor()) + ';');
    X.ev("(function(){ for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k && (k.indexOf('tc_att')===0)) localStorage.removeItem(k); } })()");
    return X;
  }
  const bootX = (src = app) => boot(src);
  const openDay = (X) => { X.ev("pcSetTab('attend')"); X.ev(`atOpen(${JSON.stringify(X.T)})`); };
  const openWeek = (X) => { X.ev("localStorage.setItem('tc_attKind', 'week'); pcSetTab('attend')"); X.ev("awOpen('2026-10-26')"); };
  const shown = (X, sel) => { const e = X.$(sel); return !!e && !e.classList.contains('hidden'); };
  const esc = (X) => X.doc.dispatchEvent(new X.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const input = (X, sel, v) => { const e = X.$(sel); e.value = v; e.dispatchEvent(new X.w.Event('input', { bubbles: true })); };
  const blocks = (X) => X.evJSON('ATE.blocks.map(function(b){ return { name: b.name, hours: b.hours, text: b.text }; })');
  const names = (X) => blocks(X).map((b) => b.name);
  const row = (X, n) => X.$('#atAddList [data-addname="' + n + '"]');
  const marks = (X) => X.evJSON("[].map.call(document.querySelectorAll('#atAddList [data-addname]'), function(b){ return b.dataset.addname + (b.getAttribute('aria-checked') === 'true' ? ':v' : '') + (b.getAttribute('aria-disabled') === 'true' ? ':x' : ''); })");
  const pkey = (X, sel, key, o = {}) => X.$(sel).dispatchEvent(new X.w.KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, o)));
  const KEYS = '#atEdBody .at-split';
  const root = (X) => X.doc.documentElement.style.getPropertyValue('--atpw');
  //  jsdom 은 배치를 계산하지 않는다. 몸통 폭을 실제처럼 돌려 주어 비율 한계가 움직이게 한다.
  const fakeWidth = (X, px) => X.ev(`(function(){ Element.prototype.getBoundingClientRect = function(){ var w = this.classList && this.classList.contains('at-ed-body') ? ${px} : 0; return { left: 0, top: 0, right: w, bottom: 0, width: w, height: 0, x: 0, y: 0 }; };
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: function(){ return this.classList && this.classList.contains('at-ed-body') ? ${px} : 0; } }); })()`);

  // ── 일간 체크 목록 ──
  test('(B) 일간 체크 목록: 체크하면 0시간 빈 블록, 빈 블록만 체크를 풀어 지우고, 내용 있는 블록은 체크된 채 잠기며(aria-disabled와 안내), 열어 둔 채 이어서 고른다', () => {
    const X = bootX();
    try {
      openDay(X);
      X.$('#atAdd').click();
      assert.ok(shown(X, '#atAddMenu'));
      assert.deepStrictEqual(marks(X), ['알파', '베타', '감마', LONG], '처음엔 아무것도 체크되지 않아야 한다');
      row(X, '알파').click(); row(X, '감마').click();
      assert.deepStrictEqual(names(X), ['알파', '감마'], '캘린더 순서 자리에 빈 블록이 생기지 않았다');
      assert.deepStrictEqual(blocks(X)[0], { name: '알파', hours: 0, text: '' });
      assert.ok(shown(X, '#atAddMenu'), '고른 뒤 메뉴가 닫혔다');
      assert.deepStrictEqual(marks(X), ['알파:v', '베타', '감마:v', LONG]);
      //  내용을 쓰면 잠긴다
      X.ev("ATE.blocks[0].hours = 2; atAddRender()");
      assert.strictEqual(marks(X)[0], '알파:v:x', '시간이 있는 블록이 잠기지 않았다');
      assert.strictEqual(row(X, '알파').title, '내용이 있는 블록은 블록의 ✕ 로 지웁니다');
      row(X, '알파').click();
      assert.deepStrictEqual(names(X), ['알파', '감마'], '내용 있는 블록을 체크 해제로 지웠다');
      X.ev("ATE.blocks[0].hours = 0; ATE.blocks[0].text = '- 한 일'; atAddRender()");
      assert.strictEqual(marks(X)[0], '알파:v:x', '글이 있는 블록이 잠기지 않았다');
      X.ev("ATE.blocks[0].text = '   '; atAddRender()");
      assert.strictEqual(marks(X)[0], '알파:v', '공백뿐인 글은 빈 블록이다');
      row(X, '알파').click();
      assert.deepStrictEqual(names(X), ['감마'], '빈 블록의 체크를 풀어도 지워지지 않았다');
      assert.ok(shown(X, '#atAddMenu'));
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });
  test('(B) 일간 전체 선택과 전체 해제: 선택은 빠진 과제를 모두, 해제는 빈 블록만(내용 있는 블록은 남는다), 검색으로 거른 과제에만, 닫지 않는다', () => {
    const X = bootX();
    try {
      openDay(X);
      X.$('#atAdd').click();
      X.$('#atAddAll').click();
      assert.deepStrictEqual(names(X), ['알파', '베타', '감마', LONG], '전체 선택이 모두 넣지 않았다');
      X.ev("ATE.blocks[1].hours = 3; atAddRender()");
      X.$('#atAddNone').click();
      assert.deepStrictEqual(names(X), ['베타'], '전체 해제가 내용 있는 블록을 지웠거나 빈 블록을 남겼다');
      assert.ok(shown(X, '#atAddMenu'), '전체 선택, 해제 뒤 메뉴가 닫혔다');
      input(X, '#atAddQ', '알');
      X.$('#atAddAll').click();
      assert.deepStrictEqual(names(X), ['알파', '베타'], '검색으로 거른 목록에만 적용되지 않았다');
      input(X, '#atAddQ', '');
      X.$('#atAddNone').click();
      assert.deepStrictEqual(names(X), ['베타']);
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });
  test('(B) 일간 체크 목록 닫기: Esc, [닫기]는 추가 단추로 포커스를 돌리고, 바깥을 누르면 닫는다. 긴 이름은 두 줄 맞춤용 data-full, 이미 있음 글 없음', () => {
    const X = bootX();
    try {
      openDay(X);
      X.$('#atAdd').click();
      assert.ok(!X.$('#atAddList').textContent.includes('이미 있음'));
      const nm = X.$('#atAddList [data-addname] .cat-nm[data-full]');
      assert.ok(nm, '이름 칸이 .cat-nm + data-full 이 아니다');
      assert.strictEqual(X.$('#atAddList [data-addname="' + LONG + '"] .cat-nm').dataset.full, LONG);
      assert.strictEqual(X.$('#atAddList [data-addname="' + LONG + '"] .cat-nm').textContent, LONG, 'jsdom(크기를 못 잼)에서는 원래 이름 그대로여야 한다');
      row(X, '알파').click();
      esc(X);
      assert.ok(!shown(X, '#atAddMenu') && shown(X, '#atEd'), 'Esc 가 메뉴만 닫지 않았다');
      assert.strictEqual(X.doc.activeElement, X.$('#atAdd'));
      X.$('#atAdd').click(); X.$('#atAddDone').click();
      assert.ok(!shown(X, '#atAddMenu')); assert.strictEqual(X.doc.activeElement, X.$('#atAdd'));
      X.$('#atAdd').click();
      X.$('#atBlocks').dispatchEvent(new X.w.MouseEvent('mousedown', { bubbles: true }));
      assert.ok(!shown(X, '#atAddMenu'), '바깥을 눌러도 닫히지 않았다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });
  test('(B) 일간 체크 목록 자리: 줄의 오른쪽 끝에 맞춘 fixed 상자(스크롤 칸에 잘리지 않음), 아래가 좁으면 위로 연다', () => {
    const X = bootX();
    try {
      openDay(X);
      X.ev(`(function(){ var w = document.getElementById('atAddWrap'); w.getBoundingClientRect = function(){ return { left: 20, right: 620, top: 700, bottom: 730, width: 600, height: 30, x: 20, y: 700 }; };
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 760 }); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 }); })()`);
      X.$('#atAdd').click();
      const m = X.$('#atAddMenu');
      assert.strictEqual(m.style.left, '320px', '줄의 오른쪽 끝(620)에 폭 300 이 맞지 않았다');
      assert.ok(m.style.top === 'auto' && m.style.bottom === '64px', '아래가 좁은데 위로 열지 않았다: top=' + m.style.top + ' bottom=' + m.style.bottom);
      X.ev(`document.getElementById('atAddWrap').getBoundingClientRect = function(){ return { left: 20, right: 620, top: 100, bottom: 130, width: 600, height: 30, x: 20, y: 100 }; }; atAddPlace()`);
      assert.ok(m.style.bottom === 'auto' && m.style.top === '134px', '아래가 넉넉한데 아래로 열지 않았다');
      assert.strictEqual(X.w.getComputedStyle(m).position, 'fixed');
    } finally { X.close(); }
  });
  test('(B) 주간 체크 목록은 그대로: 체크 목록에 이름 두 줄 맞춤용 칸이 생겼을 뿐 넣고 빼기, 전체 선택, 닫지 않음은 같다', () => {
    const X = bootX();
    try {
      openWeek(X);
      X.$('#awEd [data-awadd="hours"]').click();
      const L = '#awAddList [data-awaddname="';
      assert.ok(X.$(L + LONG + '"] .cat-nm[data-full]'), '주간 이름 칸이 .cat-nm + data-full 이 아니다');
      X.$(L + '알파"]').click();
      assert.deepStrictEqual(X.evJSON('AWE.hrs'), ['알파']);
      assert.strictEqual(X.$(L + '알파"]').getAttribute('aria-checked'), 'true');
      assert.ok(!X.$(L + '알파"]').hasAttribute('aria-disabled'), '주간 줄은 잠기지 않는다');
      X.$(L + '알파"]').click();
      assert.deepStrictEqual(X.evJSON('AWE.hrs'), [], '주간 체크 해제가 빼지 않았다');
      X.$('#awAddAll').click();
      assert.strictEqual(X.evJSON('AWE.hrs').length, 4);
      X.$('#awAddNone').click();
      assert.deepStrictEqual(X.evJSON('AWE.hrs'), []);
      assert.ok(shown(X, '#awAddMenu'));
      assert.ok(!X.$('#awAddList').textContent.includes('이미 있음'));
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  // ── 끌개 ──
  test('(B) 끌개: 시작 때 --atpw 기본 360px, aria 값, 두 화면이 한 변수를 쓴다', () => {
    const X = bootX();
    try {
      fakeWidth(X, 1000);
      X.ev('window.dispatchEvent(new Event("resize"))');
      assert.strictEqual(root(X), '360px');
      for (const s of ['#atEdBody .at-split', '#awBody .at-split']) {
        const e = X.$(s);
        assert.strictEqual(e.getAttribute('aria-valuenow'), '360'); assert.strictEqual(e.getAttribute('aria-valuemin'), '280'); assert.strictEqual(e.getAttribute('aria-valuemax'), '600');
      }
      assert.strictEqual(X.w.localStorage.getItem('tc_attPanelW'), null, '손대지 않았는데 저장했다');
    } finally { X.close(); }
  });
  test('(B) 끌개 키보드: ← 는 24px 넓히고(Shift 96), → 는 좁히며, 저장하고, 비율 한계(280~몸통 60%)에서 멈춘다. 두 번 누르면 360', () => {
    const X = bootX();
    try {
      fakeWidth(X, 1000);
      X.ev('window.dispatchEvent(new Event("resize"))');
      pkey(X, KEYS, 'ArrowLeft'); assert.strictEqual(root(X), '384px');
      pkey(X, KEYS, 'ArrowLeft', { shiftKey: true }); assert.strictEqual(root(X), '480px');
      assert.strictEqual(X.w.localStorage.getItem('tc_attPanelW'), '480', '키보드 조절을 저장하지 않았다');
      pkey(X, KEYS, 'ArrowRight'); assert.strictEqual(root(X), '456px');
      for (let i = 0; i < 12; i++) pkey(X, KEYS, 'ArrowLeft', { shiftKey: true });
      assert.strictEqual(root(X), '600px', '몸통의 60% 를 넘었다');
      for (let i = 0; i < 12; i++) pkey(X, KEYS, 'ArrowRight', { shiftKey: true });
      assert.strictEqual(root(X), '280px', '최소 280px 밑으로 내려갔다');
      X.$(KEYS).dispatchEvent(new X.w.MouseEvent('dblclick', { bubbles: true }));
      assert.strictEqual(root(X), '360px', '두 번 눌러도 기본 폭으로 돌아오지 않았다');
      assert.strictEqual(X.w.localStorage.getItem('tc_attPanelW'), '360');
      assert.strictEqual(X.$(KEYS).getAttribute('aria-valuenow'), '360');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });
  test('(B) 끌개 끌기: 포인터로 끌면 변수만 바뀌다가(rAF) 놓을 때 저장하고, 주간 화면의 끌개도 같은 폭을 쓴다', async () => {
    const X = bootX();
    try {
      fakeWidth(X, 1000);
      X.ev('window.dispatchEvent(new Event("resize"))');
      const ev = (t, x) => { const e = new X.w.MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, button: 0 }); X.$(KEYS).dispatchEvent(e); };
      ev('pointerdown', 637); ev('pointermove', 500);
      assert.ok(X.$(KEYS).classList.contains('dragging'));
      assert.strictEqual(X.w.localStorage.getItem('tc_attPanelW'), null, '끄는 동안 저장했다');
      await new Promise((r) => setTimeout(r, 60));
      assert.strictEqual(root(X), '497px', '끌기 폭(몸통 오른쪽 1000 - 500 - 3)이 아니다');
      ev('pointermove', 100); ev('pointerup', 100);
      assert.ok(!X.$(KEYS).classList.contains('dragging'));
      assert.strictEqual(root(X), '600px', '끌어도 60% 한계를 넘었다');
      assert.strictEqual(X.w.localStorage.getItem('tc_attPanelW'), '600');
      assert.strictEqual(X.$('#awBody .at-split').getAttribute('aria-valuenow'), '600', '주간 끌개가 같은 폭을 쓰지 않는다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });
  test('(B) 끌개 복원과 묶기: 저장한 폭을 되살리고, 창이 좁아지면 한계 안으로 묶되 저장값은 그대로, 넓어지면 되돌린다. 깨진 저장값은 기본', () => {
    const X = bootX();
    try {
      X.w.localStorage.setItem('tc_attPanelW', '560');
      X.ev('setupAttSplit()');   // 같은 문서에 다시 배선(저장값 읽기만 본다)
      fakeWidth(X, 1000); X.ev('window.dispatchEvent(new Event("resize"))');
      assert.strictEqual(root(X), '560px', '저장 폭을 되살리지 않았다');
      fakeWidth(X, 700); X.ev('window.dispatchEvent(new Event("resize"))');
      assert.strictEqual(root(X), '420px', '창이 좁아졌는데 60% 로 묶지 않았다');
      assert.strictEqual(X.w.localStorage.getItem('tc_attPanelW'), '560', '묶느라 저장값을 덮어썼다');
      fakeWidth(X, 1000); X.ev('window.dispatchEvent(new Event("resize"))');
      assert.strictEqual(root(X), '560px', '창이 넓어져도 기억한 폭으로 돌아오지 않았다');
      const Y = bootX();
      try { Y.w.localStorage.setItem('tc_attPanelW', 'abc'); Y.ev('setupAttSplit()'); fakeWidth(Y, 1000); Y.ev('window.dispatchEvent(new Event("resize"))'); assert.strictEqual(root(Y), '360px', '깨진 저장값이 기본 폭이 아니다'); } finally { Y.close(); }
    } finally { X.close(); }
  });
  test('(B) 접으면 끌개가 숨고 펼치면 기억한 폭으로 돌아온다(일간 .folded)', () => {
    const X = bootX();
    try {
      openDay(X);
      fakeWidth(X, 1000); X.ev('window.dispatchEvent(new Event("resize"))');
      pkey(X, KEYS, 'ArrowLeft'); assert.strictEqual(root(X), '384px');
      X.$('#atFold').click();
      assert.ok(X.$('#atEdBody').classList.contains('folded'));
      assert.ok(/\.at-ed-body\.folded \.at-split\{display:none\}|\.at-ed-body\.folded \.at-panel,\.at-ed-body\.folded \.at-split\{display:none\}/.test(app));
      X.$('#atFold').click();
      assert.ok(!X.$('#atEdBody').classList.contains('folded'));
      assert.strictEqual(root(X), '384px', '펼쳤는데 기억한 폭이 아니다');
    } finally { X.close(); }
  });

  // ══ (M) 변이 ══
  test('변이 U1: 체크 해제가 내용 있는 블록을 지우면(잠금 검사 빼기) 일간 시험이 잡는다', () => {
    const bad = mutate(app, '    if(!atBlockEmpty(cur)) return;   // 내용이 있는 블록은 ✕ 로만 지운다' + NL, '');
    const X = bootX(bad);
    try {
      openDay(X);
      X.$('#atAdd').click(); row(X, '알파').click();
      X.ev("ATE.blocks[0].hours = 2; atAddRender()");
      X.ev("atAddPick('알파')");
      assert.deepStrictEqual(names(X), [], '변이가 경로에 닿지 않았다(내용 있는 블록이 지워져야 한다)');
    } finally { X.close(); }
  });
  test('변이 U2: 전체 해제가 내용 있는 블록까지 지우면(빈 블록 조건 빼기) 일간 시험이 잡는다', () => {
    const bad = mutate(app, 'ATE.blocks.filter(b => !(names.includes(b.name) && atBlockEmpty(b)))', 'ATE.blocks.filter(b => !names.includes(b.name))');
    const X = bootX(bad);
    try {
      openDay(X);
      X.$('#atAdd').click(); X.$('#atAddAll').click();
      X.ev("ATE.blocks[0].hours = 3; atAddRender()");
      X.$('#atAddNone').click();
      assert.deepStrictEqual(names(X), [], '변이가 경로에 닿지 않았다');
    } finally { X.close(); }
  });
  test('변이 U3: 고른 뒤 메뉴를 닫으면(열어 둔 채 이어서 고르기 빼기) 일간 시험이 잡는다', () => {
    const bad = mutate(app, '  atAddRender();' + NL + '  atAddPlace();' + NL + '  atOnEdit();' + NL + '}', '  atAddOpen(false);' + NL + '  atOnEdit();' + NL + '}');
    const X = bootX(bad);
    try {
      openDay(X);
      X.$('#atAdd').click(); row(X, '알파').click();
      assert.ok(!shown(X, '#atAddMenu'), '변이가 경로에 닿지 않았다');
    } finally { X.close(); }
  });
  test('변이 K1: 폭 한계(60%)를 빼면 끌개 시험이 잡는다', () => {
    const bad = mutate(app, 'const AT_PW_KEY = \'tc_attPanelW\', AT_PW_DEF = 360, AT_PW_MIN = 280, AT_PW_RATIO = 0.6;', 'const AT_PW_KEY = \'tc_attPanelW\', AT_PW_DEF = 360, AT_PW_MIN = 280, AT_PW_RATIO = 5;');
    const X = bootX(bad);
    try {
      fakeWidth(X, 1000); X.ev('window.dispatchEvent(new Event("resize"))');
      for (let i = 0; i < 12; i++) pkey(X, KEYS, 'ArrowLeft', { shiftKey: true });
      assert.notStrictEqual(root(X), '600px', '변이가 경로에 닿지 않았다');
    } finally { X.close(); }
  });
  test('변이 K2: 두 번 누르기 초기화를 빼면 끌개 시험이 잡는다', () => {
    const bad = mutate(app, "sp.addEventListener('dblclick', () => commit(AT_PW_DEF));", "sp.addEventListener('dblclick', () => {});");
    const X = bootX(bad);
    try {
      fakeWidth(X, 1000); X.ev('window.dispatchEvent(new Event("resize"))');
      pkey(X, KEYS, 'ArrowLeft', { shiftKey: true });
      X.$(KEYS).dispatchEvent(new X.w.MouseEvent('dblclick', { bubbles: true }));
      assert.notStrictEqual(root(X), '360px', '변이가 경로에 닿지 않았다');
    } finally { X.close(); }
  });
}
