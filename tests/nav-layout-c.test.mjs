// 날짜 줄 배치 C(docs/NAV-LAYOUT-C.md): 주간 제목도 "YYYY년 M월"(그 주 월요일이 든 달), 제목 칸 최소 폭은 재서 정한다,
// 과제 필터 묶음(#filterbar)은 날짜 줄(.nav)의 [월간 | 주간] 바로 뒤에 있고 별도 필터 줄은 없다, 날짜 줄은 줄바꿈을 허용한다.
//   (S) 정적: 필터 묶음 위치, 옛 줄과 600px 폭 바꾸기 규칙 없음, 줄바꿈 허용, 제목 폭 재기 배선
//   (U) 단위: calTitleLabel, pcRangeLabel (월간, 같은 달 주, 달이 걸친 주, 해가 걸친 주 2026-12-28)
//   (R) 런타임(jsdom): 월간 주간 전환에도 제목 글자와 최소 폭이 같고 필터 묶음 자리가 그대로, 열람 창도 같다
//   (M) 변이: 주간 제목을 범위로 되돌림, 필터 묶음을 날짜 줄 밖으로 뺌, 제목 폭을 1월 하나만 잼, 600px 단추 폭 규칙을 되살림
import { test, skip, assert, loadAppSource, extractFunction, extractCalCommon, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  const out = text.slice(0, a) + repl + text.slice(a + find.length);
  assert.notStrictEqual(out, text, '변이가 원본을 바꾸지 못했다');
  return out;
}

const cssOf = (src) => src.slice(0, src.indexOf('</style>'));
function navHtml(src) {
  const i = src.indexOf('<div class="nav">');
  assert.ok(i > 0, '.nav 를 찾지 못했다');
  const j = src.indexOf('</header>', i);
  return src.slice(i, j);
}

// ══════════════════════════════════════════════════════════════════════
// (S) 정적
// ══════════════════════════════════════════════════════════════════════
function checkStatic(src) {
  const nav = navHtml(src);
  const seg = nav.indexOf('id="calViewSeg"'), grp = nav.indexOf('id="filterbar"');
  assert.ok(seg > 0 && grp > seg, '필터 묶음(#filterbar)이 [월간 | 주간](#calViewSeg) 뒤에 있지 않다');
  assert.ok(/<\/div>\s*<div class="fb-grp" id="filterbar"><\/div>\s*<\/div>\s*<div class="spacer">/.test(nav), '필터 묶음이 날짜 줄(.nav)의 마지막 칸이 아니다');
  assert.strictEqual(src.split('id="filterbar"').length - 1, 1, '#filterbar 가 둘 이상이다');
  assert.ok(!/<div class="filterbar"/.test(src), '옛 필터 줄(div.filterbar)이 남았다');
  const css = cssOf(src);
  assert.ok(!/(^|[}\s,])\.filterbar\b/.test(css) && !/#filterbar\{/.test(css), '옛 .filterbar 줄 규칙이 남았다');
  assert.ok(!/body\.(pc|at)-on #filterbar/.test(css), '날짜 줄과 함께 숨으므로 #filterbar 숨김 규칙이 따로 필요 없다');
  assert.ok(!/599\.98px\)\{[^}]*\.fb-btn/.test(css) && !/\.fb-btn\{[^}]*[^-]width:\d+px/.test(css), '과제 단추 폭을 600px 기준으로 바꾸는 규칙(또는 고정 폭)이 남았다');
  assert.ok(/\.fb-btn\{[^}]*max-width:min\(240px,40vw\)/.test(css), '과제 단추가 최대 폭 말줄임이 아니다');
  assert.ok(/header\.topbar \.nav\{[^}]*flex-wrap:wrap/.test(css), '날짜 줄이 줄바꿈을 허용하지 않는다');
}
test('정적①: 필터 묶음이 날짜 줄의 [월간 | 주간] 바로 뒤에 있고, 별도 필터 줄과 600px 단추 폭 규칙이 없고, 날짜 줄은 줄바꿈 허용', () => {
  checkStatic(app);
});

test('정적②: 제목 폭은 재서 정한다(12개월 재기, 캐시 키에 글꼴, 박은 숫자 없음)', () => {
  const f = extractFunction(app, 'fitTitleMinWidth');
  assert.ok(/for\(let m = 1; m <= 12; m\+\+\)/.test(f), '1월부터 12월까지 재지 않는다');
  assert.ok(/cs\.fontFamily/.test(f) && /cs\.fontSize/.test(f) && /cs\.fontWeight/.test(f) && /cs\.letterSpacing/.test(f), '캐시 키나 복사한 글꼴에 글꼴 속성이 빠졌다');
  assert.ok(/style\.minWidth = v/.test(f.replace(/\s+/g, ' ').replace('el.style.minWidth = v', 'style.minWidth = v')), 'minWidth 를 정하지 않는다');
  assert.ok(extractFunction(app, 'renderGrid').includes('fitCalTitle()'), '제목을 바꾼 뒤 폭을 다시 재지 않는다');
  assert.ok(extractFunction(app, 'pcRender').includes('fitTitleMinWidth('), '과제 탭 제목(.pc-range)이 폭을 재지 않는다');
  const css = cssOf(app);
  assert.ok(!/\.title-btn\{[^}]*min-width:120px/.test(css), '제목 단추에 박은 최소 폭 120px 이 남았다');
});

test('정적③: 새로 쓴 문구와 주석에 엠 대시, en 대시, 띄어 쓴 가운데 점, 낫표가 없다', () => {
  const src = [extractFunction(app, 'calTitleLabel'), extractFunction(app, 'fitTitleMinWidth'), extractFunction(app, 'renderFilterbar'), extractFunction(app, 'viewSummary'), extractFunction(app, 'filterPopPlace'), extractFunction(app, 'pcRangeLabel')].join('\n');
  assert.ok(!/[—–「」]/.test(src), '금지 기호가 있다');
  assert.ok(!/ · /.test(src), '띄어 쓴 가운데 점이 있다');
});

// ══════════════════════════════════════════════════════════════════════
// (U) 단위
// ══════════════════════════════════════════════════════════════════════
const helpers = [
  'function pad(n){ return String(n).padStart(2, "0"); }',
  'function ymd(d){ return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }',
  'function parseYmd(s){ const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }',
  'function addDays(s, n){ const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }',
  'function todayYmd(){ return "2026-10-30"; }',
  'function diffDays(a, b){ return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }',
  extractCalCommon(app),
].join('\n');

function titleOf(src, mode, viewVal, sel) {
  const code = helpers + '\n' + extractFunction(src, 'calWeekRange') + '\n' + extractFunction(src, 'calTitleLabel');
  return new Function('calViewVal', 'view', 'selectedDate', `function calView(){ return calViewVal; }\n${code}\nreturn calTitleLabel();`)(mode, viewVal, sel);
}
function pcTitleOf(src, view, anchor) {
  const code = helpers + '\n' + extractFunction(src, 'pcWeekRange') + '\n' + extractFunction(src, 'pcRangeLabel');
  return new Function('PCAL', `${code}\nreturn pcRangeLabel();`)({ view, anchor });
}

const WEEKS = [
  ['같은 달 주(10/19~10/25)', '2026-10-21', '2026년 10월'],
  ['달이 걸친 주(10/26~11/1): 월요일이 든 10월', '2026-10-28', '2026년 10월'],
  ['달이 걸친 주의 일요일 쪽 날짜(11/1)도 10월', '2026-11-01', '2026년 10월'],
  ['다음 월요일(11/2)은 11월', '2026-11-02', '2026년 11월'],
  ['해가 걸친 주(2026-12-28~2027-01-03)는 2026년 12월', '2026-12-30', '2026년 12월'],
  ['해가 걸친 주의 1월 쪽 날짜(2027-01-02)도 2026년 12월', '2027-01-02', '2026년 12월'],
  ['월요일이 1일인 주(2026-06-01)', '2026-06-03', '2026년 6월'],
];

test('단위①: calTitleLabel 주간 제목은 그 주 월요일이 든 달 "YYYY년 M월", 월간은 그대로', () => {
  assert.strictEqual(titleOf(app, 'month', { y: 2026, m: 9 }, '2026-10-21'), '2026년 10월');
  for (const [name, sel, want] of WEEKS) assert.strictEqual(titleOf(app, 'week', { y: 2026, m: 9 }, sel), want, name);
});

test('단위②: pcRangeLabel 주간도 그 주 월요일이 든 달, 월간은 그대로', () => {
  assert.strictEqual(pcTitleOf(app, 'month', '2026-10-21'), '2026년 10월');
  for (const [name, sel, want] of WEEKS) assert.strictEqual(pcTitleOf(app, 'week', sel), want, name);
});

test('단위③: 월간과 주간의 제목이 같은 형식이라 글자 폭도 같다(주 이름에 날짜가 없다)', () => {
  for (const [, sel] of WEEKS) {
    const t = titleOf(app, 'week', { y: 2026, m: 9 }, sel);
    assert.ok(/^\d{4}년 \d{1,2}월$/.test(t), t);
    assert.ok(!/일|~|\./.test(t), t);
  }
});

// ══════════════════════════════════════════════════════════════════════
// (R) 런타임(jsdom)
// ══════════════════════════════════════════════════════════════════════
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;

if (!JSDOM) {
  skip('nav-layout-c: jsdom 미설치로 런타임 검증을 건너뜁니다', SKIP_NO_JSDOM,
    `이 파일의 test 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았습니다.`);
} else {
  const bootOpts = (url) => ({
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url,
    beforeParse(window) {
      window.chrome = { webview: { postMessage() {}, addEventListener() {}, removeEventListener() {} } };
      if (typeof window.crypto === 'undefined') window.crypto = { randomUUID: () => 'u-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      if (!window.CSS) window.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
      //  jsdom 은 글자 폭을 재지 못한다. 화면 밖 재기용 span 에만 글자 수 x 10px 을 돌려준다(가장 긴 달 이름이 가장 넓다)
      const orig = window.Element.prototype.getBoundingClientRect;
      window.Element.prototype.getBoundingClientRect = function () {
        if (this.tagName === 'SPAN' && /^\d{4}년 \d{1,2}월$/.test(this.textContent || '') && this.style.left === '-9999px') {
          const w = this.textContent.length * 10;
          return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: 20, width: w, height: 20, toJSON() {} };
        }
        return orig.call(this);
      };
    },
  });
  function bootWindow(url, src) {
    const dom = new JSDOM(src || app, bootOpts(url));
    const w = dom.window;
    return { w, doc: w.document, ev: (code) => w.eval(code), close: () => { try { w.close(); } catch (_) {} } };
  }
  const settle = () => new Promise((r) => setTimeout(r, 40));

  async function flow(url, src) {
    const W = bootWindow(url, src);
    try {
      await settle();
      const d = W.doc;
      const title = d.getElementById('btnTitle'), grp = d.getElementById('filterbar'), seg = d.getElementById('calViewSeg');
      const shape = () => ({
        parent: grp.parentElement.className, prev: grp.previousElementSibling && grp.previousElementSibling.id,
        btn: !!grp.querySelector('.fb-btn'), rows: d.querySelectorAll('#filterbar').length,
      });
      assert.deepStrictEqual(shape(), { parent: 'nav', prev: 'calViewSeg', btn: true, rows: 1 }, '필터 묶음 자리가 날짜 줄 안 [월간 | 주간] 바로 뒤가 아니다');
      assert.ok(seg.contains(d.getElementById('btnCalViewWeek')));
      W.ev('selectedDate = "2026-10-28"; view = {y: 2026, m: 9}; renderGrid();');
      const monthText = title.textContent, monthMin = title.style.minWidth;
      assert.strictEqual(monthText, '2026년 10월');
      assert.ok(/^\d+px$/.test(monthMin), '제목 최소 폭이 재서 정해지지 않았다: ' + monthMin);
      //  제일 넓은 달("2026년 10월" 9글자 x 10px)에 단추의 안쪽 여백을 더한 값(올림)
      const cs = W.w.getComputedStyle(title);
      const pad = cs.boxSizing === 'border-box' ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0) : 0;
      assert.strictEqual(parseFloat(monthMin), Math.ceil(90 + pad), '12개월 중 가장 넓은 폭이 아니다');
      W.ev('setCalView("week")');
      await settle();
      assert.strictEqual(W.ev('calView()'), 'week');
      assert.strictEqual(title.textContent, monthText, '주간으로 바꿨는데 제목 글자가 바뀌었다');
      assert.strictEqual(title.style.minWidth, monthMin, '주간으로 바꿨는데 제목 최소 폭이 바뀌었다');
      assert.deepStrictEqual(shape(), { parent: 'nav', prev: 'calViewSeg', btn: true, rows: 1 }, '주간에서 필터 묶음 자리가 바뀌었다');
      //  다음 주로(10/26 주 -> 11/2 주): 월요일이 11월이라 제목이 11월
      d.getElementById('btnNext').click();
      await settle();
      assert.strictEqual(W.ev('selectedDate'), '2026-11-04');
      assert.strictEqual(title.textContent, '2026년 11월');
      assert.strictEqual(title.style.minWidth, monthMin, '달이 바뀌어도 제목 최소 폭은 같아야 한다');
      d.getElementById('btnPrev').click();
      await settle();
      assert.strictEqual(title.textContent, '2026년 10월');
      //  해가 걸친 주
      W.ev('selectedDate = "2026-12-30"; renderGrid();');
      assert.strictEqual(title.textContent, '2026년 12월');
      W.ev('setCalView("month")');
      await settle();
      assert.strictEqual(title.style.minWidth, monthMin);
      assert.deepStrictEqual(shape(), { parent: 'nav', prev: 'calViewSeg', btn: true, rows: 1 });
      //  과제 필터 팝업은 단추 아래 묶음 안에 달린다(날짜 줄에서 잘리지 않게 묶음 안 absolute)
      const btn = grp.querySelector('.fb-btn');
      if (!btn.disabled) {
        btn.click();
        const pop = d.getElementById('fbPop');
        assert.ok(pop && grp.contains(pop), '팝업이 필터 묶음 안에 없다');
        btn.click();
      }
    } finally { W.close(); }
  }

  test('런타임①: 내 창에서 월간 주간 전환, 주 이동에도 제목 글자(같은 달)와 최소 폭이 같고, 필터 묶음은 [월간 | 주간] 바로 뒤', async () => {
    await flow('https://tcapp.local/');
  });
  test('런타임②: 열람 창(?peer=1)도 같은 날짜 줄과 같은 자리에 필터 묶음', async () => {
    await flow('https://tcapp.local/?peer=1');
  });

  test('런타임③: 과제가 없어도 보기 묶음은 단추 하나(⚲ 보기, 기록 종류와 보기 옵션을 쓴다)이고 날짜 줄 안에 남는다', async () => {
    const W = bootWindow('https://tcapp.local/?peer=1');
    try {
      await settle();
      W.w.__applyState(JSON.stringify({ categories: [], entries: [], todos: [] }), { peerName: '홍길동', canWrite: false });
      await settle();
      const g = W.doc.getElementById('filterbar');
      assert.strictEqual(g.parentElement.className, 'nav');
      assert.strictEqual(g.querySelectorAll('button').length, 1);
      assert.ok(!g.querySelector('.fb-btn').disabled, '과제가 없다고 보기 단추를 끄면 기록 종류, 보기 옵션도 못 쓴다');
      assert.strictEqual(g.querySelector('.fb-btn .pl').textContent, '⚲ 보기');
    } finally { W.close(); }
  });

  // ════════════════════════════════════════════════════════════════════
  // (M) 변이: 런타임이 잡는 자리
  // ════════════════════════════════════════════════════════════════════
  test('변이M①: 제목 폭을 1월 하나만 재면 런타임①의 최대 폭 검사가 잡는다', async () => {
    const bad = mutate(app, 'for(let m = 1; m <= 12; m++){ sp.textContent', 'for(let m = 1; m <= 1; m++){ sp.textContent');
    await assert.rejects(() => flow('https://tcapp.local/', bad), /가장 넓은 폭/);
  });
  test('변이M②: 필터 묶음을 날짜 줄 밖(헤더 뒤)으로 빼면 런타임①이 잡는다', async () => {
    const grpHtml = '    <div class="fb-grp" id="filterbar"></div>\n';
    let bad = mutate(app, grpHtml, '');
    bad = mutate(bad, '</header>', '</header>\n<div class="fb-grp" id="filterbar"></div>');
    await assert.rejects(() => flow('https://tcapp.local/', bad), /날짜 줄 안/);
  });
}

// ══════════════════════════════════════════════════════════════════════
// (M) 변이: 정적, 단위가 잡는 자리
// ══════════════════════════════════════════════════════════════════════
test('변이M③: 주간 제목을 날짜 범위로 되돌리면 단위①이 잡는다', () => {
  const bad = mutate(app, "  const a = parseYmd(calWeekRange(selectedDate).from);\n  return `${a.getFullYear()}년 ${a.getMonth()+1}월`;",
    "  const r = calWeekRange(selectedDate), a = parseYmd(r.from), b = parseYmd(r.to);\n  return `${a.getFullYear()}년 ${a.getMonth()+1}월 ${a.getDate()}일 ~ ${b.getDate()}일`;");
  assert.throws(() => assert.strictEqual(titleOf(bad, 'week', { y: 2026, m: 9 }, '2026-10-21'), '2026년 10월'));
});
test('변이M④: 과제 탭 주간 제목을 날짜 범위로 되돌리면 단위②가 잡는다', () => {
  const bad = mutate(app, "  const a = parseYmd(pcWeekRange(PCAL.anchor).from);   // 주간도 그 주 월요일이 든 달(docs/NAV-LAYOUT-C.md)\n  return a.getFullYear() + '년 ' + (a.getMonth() + 1) + '월';",
    "  const a = parseYmd(pcWeekRange(PCAL.anchor).from);\n  return (a.getMonth() + 1) + '월 ' + a.getDate() + '일 ~';");
  assert.throws(() => assert.strictEqual(pcTitleOf(bad, 'week', '2026-10-21'), '2026년 10월'));
});
test('변이M⑤: 필터 묶음을 [월간 | 주간] 앞으로 옮기거나 옛 필터 줄을 되살리면 정적①이 잡는다', () => {
  const grp = '    <div class="fb-grp" id="filterbar"></div>\n';
  const moved = mutate(mutate(app, grp, ''), '    <div class="seg seg-auto" id="calViewSeg"', grp + '    <div class="seg seg-auto" id="calViewSeg"');
  assert.throws(() => checkStatic(moved), /뒤에 있지 않다|마지막 칸/);
  const row = mutate(app, '<main>\n', '<div class="filterbar" id="filterbar2"></div>\n\n<main>\n');
  assert.throws(() => checkStatic(row), /옛 필터 줄/);
});
test('변이M⑥: 600px 기준 과제 단추 폭 규칙이나 날짜 줄 줄바꿈 금지를 되살리면 정적①이 잡는다', () => {
  const w = mutate(app, 'header.topbar .nav{flex-wrap:wrap;row-gap:6px}', 'header.topbar .nav{flex-wrap:nowrap;row-gap:6px}');
  assert.throws(() => checkStatic(w), /줄바꿈/);
  const m = mutate(app, '/* ---------- main layout ---------- */', '@media (max-width:599.98px){ .fb-btn{width:156px} }\n/* ---------- main layout ---------- */');
  assert.throws(() => checkStatic(m), /600px/);
});
