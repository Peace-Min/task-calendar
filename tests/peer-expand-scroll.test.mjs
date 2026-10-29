// 「펼침」 밀도의 스크롤 상자 계약(2026-10-16 버그: 열람 창 겹쳐 보기 + 펼침에서 스크롤이 안 생기고 칩이 다음 주 줄 밑으로 깔림).
//
// 원인: `.grid.expand{grid-auto-rows:minmax(74px,auto)}`. 격자는 `.cal`(flex 세로) 안의 `flex:1; min-height:0` 이라 높이가 정해져 있다.
//   줄 최소값이 고정 길이면 격자 트랙 크기 계산이 **남는 높이만** 나눠 줘서 줄이 내용만큼 늘지 않는다.
//   칸은 펼침에서 overflow:visible 이라 넘친 칩이 다음 주 줄 밑으로 깔리고, 격자 내용 높이가 안 늘어 스크롤도 안 생긴다.
//   겹쳐 보기는 내 일정까지 얹혀 칸마다 칩이 많아 바로 드러났다(내 창 펼침도 같은 규칙이라 같았다).
// 고침: 줄 최소값 = min-content(내용 높이), 칸 최소 74px 는 칸이 진다. 나란히 보기(S4)가 따로 갖고 있던 값을 기본 규칙으로 올렸다.
//
//   (S) 정적: 스크롤 상자가 되는 CSS 사슬 전체(main → .cal → .grid → .grid.expand → 칸 → 칩 묶음, 열람 창 틀)
//   (R) jsdom: 열람 창(?peer=1)을 띄워 겹쳐 보기, 겹 끔, 나란히 보기에서 #grid 의 계산된 값을 본다. 고정, 촘촘히는 그대로(회귀 없음)
//   (M) 변이: 옛 값 되돌림, 열람 창 전용 덮어쓰기 추가, 칸 최소 높이 빼기, 격자 min-height:0 빼기, 열람 창 틀 min-height:0 빼기
//
// ★ 실제 줄 높이(레이아웃)는 jsdom 에 없다. 실측은 dist/rehearsal/window-ui/task2-* 캡처(넘친 칩 188 → 0, 격자 scrollHeight 711 → 1591).
// 생략 규약: jsdom 이 없으면 (R)과 jsdom 변이는 등록되지 않고 skip(판정 없음)으로 계수된다.
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다(리팩터로 사라졌다면 앵커를 갱신할 것): ' + find.slice(0, 120));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 120));
  const out = text.slice(0, a) + repl + text.slice(a + find.length);
  assert.notStrictEqual(out, text, '변이가 원본을 바꾸지 못했다');
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// (S) 정적 계약
// ══════════════════════════════════════════════════════════════════════
function styleOf(src) {
  const s = src.indexOf('<style>'), e = src.indexOf('</style>', s);
  assert.ok(s >= 0 && e > s, '<style> 블록을 찾지 못함');
  return src.slice(s + 7, e).replace(/\/\*[\s\S]*?\*\//g, '');
}
// @media 안의 규칙도 함께 나온다(바깥 @media 머리는 선택자로 잡히지 않는다). 선택자 목록은 쉼표로 편다.
// 괄호 안의 쉼표(:is(a, b), :not(...))로는 자르지 않는다.
function splitSel(list) {
  const out = []; let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
}
const cssRules = (src) => [...styleOf(src).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(m => ({ sels: splitSel(m[1].trim()), body: m[2] }));
function decl(body, prop) {
  let v = null;
  for (const d of body.split(';')) {
    const i = d.indexOf(':'); if (i < 0) continue;
    if (d.slice(0, i).trim().toLowerCase() === prop) v = d.slice(i + 1).replace(/!important/i, '').trim().replace(/\s+/g, ' ');
  }
  return v;   // 같은 규칙 안에서는 마지막 선언이 이긴다
}
const rulesFor = (src, re) => cssRules(src).filter(r => r.sels.some(s => re.test(s)));
function exactRule(src, sel) {
  const rs = cssRules(src).filter(r => r.sels.includes(sel));
  return rs;
}
// 줄 크기 값이 「내용만큼 늘 수 있는가」. 최소값이 고정 길이(px·%·fr 등)면 격자 높이가 정해진 자리에서 남는 높이만 받는다.
const CONTENT_MIN = new Set(['min-content', 'max-content', 'auto']);
function rowSizeOk(v) {
  if (!v) return false;
  const t = v.replace(/\s+/g, '');
  const mm = /^minmax\(([^,]+),([^)]+)\)$/.exec(t);
  if (mm) return CONTENT_MIN.has(mm[1]) && (mm[2] === 'auto' || mm[2] === 'max-content');
  return CONTENT_MIN.has(t);
}

// 사슬 판정: 문제 목록을 돌려준다(빈 배열 = 통과). 변이 시험이 같은 함수를 쓴다.
function expandProblems(src) {
  const P = [];
  // 1) .grid.expand 를 겨냥하는 모든 규칙(열람 창, 나란히 보기, @media 포함)의 줄 크기는 내용 기반 최소값이어야 한다.
  const rowRules = rulesFor(src, /\.grid\.expand$/).filter(r => decl(r.body, 'grid-auto-rows') !== null || decl(r.body, 'grid-template-rows') !== null);
  if (!rowRules.length) P.push('.grid.expand 의 줄 크기 규칙이 없다');
  for (const r of rowRules) {
    for (const prop of ['grid-auto-rows', 'grid-template-rows']) {
      const v = decl(r.body, prop);
      if (v !== null && !rowSizeOk(v)) P.push(`${r.sels.join(', ')} { ${prop}: ${v} }: 최소값이 고정이라 줄이 내용만큼 안 는다`);
    }
  }
  // 2) 기본 규칙: 펼침 격자가 세로 스크롤 상자다.
  const base = exactRule(src, '.grid.expand');
  if (!base.some(r => decl(r.body, 'overflow-y') === 'auto')) P.push('.grid.expand 에 overflow-y:auto 가 없다(스크롤 상자 아님)');
  if (!base.some(r => rowSizeOk(decl(r.body, 'grid-auto-rows')))) P.push('.grid.expand 기본 규칙의 grid-auto-rows 가 내용 기반이 아니다');
  // 3) 칸: 넘침 보임 + 최소 74px(줄 최소값을 내용으로 바꿨으니 빈 주가 납작해지지 않게 칸이 진다). 높이 상한 금지.
  const cell = rulesFor(src, /\.grid\.expand \.cell$/);
  if (!cell.some(r => decl(r.body, 'overflow') === 'visible')) P.push('.grid.expand .cell 에 overflow:visible 이 없다');
  if (!cell.some(r => decl(r.body, 'min-height') === '74px')) P.push('.grid.expand .cell 에 min-height:74px 가 없다(빈 주 줄이 납작해진다)');
  for (const r of cell) for (const p of ['height', 'max-height']) {
    const v = decl(r.body, p); if (v !== null && v !== 'none' && v !== 'auto') P.push(`${r.sels.join(', ')} 에 ${p}:${v}, 칸이 내용만큼 못 큰다`);
  }
  // 4) 칩 묶음: 칸 안에서 줄어들지 않고(flex:none) 넘침 보임.
  const chips = exactRule(src, '.grid.expand .chips');
  if (!chips.some(r => decl(r.body, 'flex') === 'none' && decl(r.body, 'overflow') === 'visible')) P.push('.grid.expand .chips 에 flex:none + overflow:visible 이 없다');
  // 5) 스크롤 상자의 높이가 정해지는 사슬: main(min-height:0) → .cal(flex 세로) → .grid(flex:1, min-height:0)
  const grid = exactRule(src, '.grid');
  if (!grid.some(r => /^1\b/.test(decl(r.body, 'flex') || '') && decl(r.body, 'min-height') === '0')) P.push('.grid 에 flex:1 + min-height:0 이 없다(격자가 스크롤 대신 커져 버린다)');
  const cal = exactRule(src, '.cal');
  if (!cal.some(r => decl(r.body, 'display') === 'flex' && decl(r.body, 'flex-direction') === 'column')) P.push('.cal 이 flex 세로가 아니다');
  if (!exactRule(src, 'main').some(r => decl(r.body, 'min-height') === '0')) P.push('main 에 min-height:0 이 없다');
  // 6) 열람 창 틀(WINDOW-UI §4 독립 창의 #peerWin): 본문이 iframe 에 남은 높이를 주고(min-height:0, 넘침 숨김), iframe 은 flex:1 로 그 높이를 받는다.
  const mb = exactRule(src, '#peerWin .pv-body');
  if (!mb.some(r => decl(r.body, 'min-height') === '0' && decl(r.body, 'overflow') === 'hidden' && decl(r.body, 'display') === 'flex'))
    P.push('#peerWin .pv-body 에 display:flex + min-height:0 + overflow:hidden 이 없다');
  if (!exactRule(src, '#peerWin :is(.pv-frame, .pv-skeleton)').some(r => /^1 1\b/.test(decl(r.body, 'flex') || '')))
    P.push('#peerWin 의 .pv-frame 이 flex:1 로 남은 높이를 받지 않는다');
  // 7) 펼침이 실제로 격자에 걸린다: 렌더가 expand 클래스를 붙이고, 열람 창 기본 밀도가 펼침이다.
  if (!/g\.classList\.toggle\('expand', dens === 'expand'\)/.test(src)) P.push('renderMonthGrid 가 .expand 를 토글하지 않는다');
  if (!/function calDensityDefault\(\)\{ return PEER \? 'expand' : 'fixed'; \}/.test(src)) P.push('열람 창 기본 밀도가 펼침이 아니다');
  return P;
}

test('(정적) 펼침 스크롤 사슬: main, .cal, .grid(flex:1, min-height:0), .grid.expand(내용 기반 줄, overflow-y:auto), 칸 74px, 칩 묶음, 열람 창 틀까지', () => {
  assert.deepStrictEqual(expandProblems(app), []);
});

test('(정적) 고정, 촘촘히 밀도 규칙은 그대로다(회귀 없음): .grid = 1fr + overflow:hidden, .grid.dense = 176px + overflow-y:auto', () => {
  assert.ok(exactRule(app, '.grid').some(r => decl(r.body, 'grid-auto-rows') === '1fr' && decl(r.body, 'overflow') === 'hidden'));
  assert.ok(exactRule(app, '.grid.dense').some(r => decl(r.body, 'grid-auto-rows') === '176px' && decl(r.body, 'overflow-y') === 'auto'));
});

test('변이(옛 값 되돌림): .grid.expand 를 minmax(74px,auto) 로 되돌리면 사슬 판정이 잡는다', () => {
  const m = mutate(app, '.grid.expand{grid-auto-rows:minmax(min-content,auto);', '.grid.expand{grid-auto-rows:minmax(74px,auto);');
  const p = expandProblems(m);
  assert.ok(p.some(x => /minmax\(74px,auto\)/.test(x)), '옛 값이 통과했다: ' + JSON.stringify(p));
});

test('변이(열람 창 전용 덮어쓰기): body[data-peer] .grid.expand 에 고정 최소값을 덧붙이면 잡는다', () => {
  const m = mutate(app, '.grid.expand .chips{overflow:visible;flex:none}',
    '.grid.expand .chips{overflow:visible;flex:none}\nbody[data-peer]:not([data-peer-layout="side"]) .grid.expand{grid-auto-rows:minmax(74px, auto)}');
  const p = expandProblems(m);
  assert.ok(p.some(x => /body\[data-peer\]/.test(x)), '열람 창 덮어쓰기가 통과했다: ' + JSON.stringify(p));
});

test('변이(칸 최소 높이 빼기, 격자 min-height:0 빼기, 열람 창 틀 min-height:0 빼기): 각각 잡는다', () => {
  const a = expandProblems(mutate(app, '.grid.expand .cell{overflow:visible;min-height:74px}', '.grid.expand .cell{overflow:visible}'));
  assert.ok(a.some(x => /min-height:74px/.test(x)), JSON.stringify(a));
  const b = expandProblems(mutate(app, '  overflow:hidden;min-height:0;\n}\n/* 월 보기 밀도', '  overflow:hidden;\n}\n/* 월 보기 밀도'));
  assert.ok(b.some(x => /^\.grid 에 flex:1/.test(x)), JSON.stringify(b));
  const c = expandProblems(mutate(app, '#peerWin .pv-body{ padding:4px; flex:1 1 auto; min-height:0;', '#peerWin .pv-body{ padding:4px; flex:1 1 auto;'));
  assert.ok(c.some(x => /#peerWin \.pv-body/.test(x)), JSON.stringify(c));
});

test('(정적) 판정 함수 자체: 내용 기반 줄 값만 통과시킨다', () => {
  for (const v of ['minmax(min-content,auto)', 'minmax(min-content, auto)', 'auto', 'min-content', 'minmax(auto,auto)']) assert.ok(rowSizeOk(v), v);
  for (const v of ['minmax(74px,auto)', '1fr', '176px', 'minmax(0,auto)', 'minmax(10%,auto)', 'minmax(min-content,200px)', null]) assert.ok(!rowSizeOk(v), String(v));
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom: 열람 창을 실제로 띄워 계산된 값(캐스케이드 결과)을 본다
// ══════════════════════════════════════════════════════════════════════
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;

if (!JSDOM) {
  skip('peer-expand-scroll: jsdom 미설치, 열람 창의 계산된 줄 크기를 보지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const bootOpts = (url, posted) => ({
    runScripts: 'dangerously', pretendToBeVisual: true, url,
    beforeParse(window) {
      window.chrome = { webview: { postMessage: (s) => posted.push(String(s)), addEventListener() {}, removeEventListener() {} } };
      if (typeof window.crypto === 'undefined') {
        window.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: a => a };
      }
      window.scrollTo = () => {};
    },
  });
  function boot(src) {
    const posted = [];
    const dom = new JSDOM(src, bootOpts('https://tcapp.local/?peer=1', posted));
    const w = dom.window;
    return { w, posted, ev: (c) => w.eval(c), close: () => { try { w.close(); } catch (_) {} } };
  }
  const settle = () => new Promise(r => setTimeout(r, 60));

  // 칸마다 칩이 많은 10월(상대 6건 + 내 3건/일). 줄 높이는 jsdom 이 못 재므로 「칩이 많다」 는 상태만 만든다.
  const CATS = [{ id: 'c-A', name: '설계 검토', color: '#c0392b' }, { id: 'c-B', name: '보고서 작성', color: '#2980b9' }];
  const ENTRIES = [];
  for (let d = 1; d <= 31; d++) {
    const ds = '2026-10-' + String(d).padStart(2, '0');
    for (let i = 0; i < 6; i++) ENTRIES.push({ id: `p-${d}-${i}`, date: ds, categoryId: i % 2 ? 'c-A' : 'c-B', title: `상대 ${i}`, allDay: false, startTime: `${String(8 + i).padStart(2, '0')}:00`, endTime: `${String(9 + i).padStart(2, '0')}:00` });
    for (let i = 0; i < 3; i++) ENTRIES.push({ id: `m-${d}-${i}`, date: ds, categoryId: null, title: `나 ${i}`, allDay: false, startTime: `${String(9 + i).padStart(2, '0')}:30`, endTime: `${String(10 + i).padStart(2, '0')}:30`, endDate: '', recur: null, recurExcept: [], _mine: true });
  }
  const DATA = { categories: CATS, entries: ENTRIES, todos: [], rooms: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '' };
  function inject(m) {
    m.ev('try{ localStorage.removeItem("tc_peerLayout"); localStorage.removeItem("tc_peerOverlay"); localStorage.removeItem("tc_peerDensity"); }catch(_){}');
    m.ev('view = {y:2026, m:9}; selectedDate = "2026-10-15"; focusDs = null;');
    m.w.__applyState(JSON.stringify(DATA), { peerName: '홍길동', canWrite: false });
  }
  const probe = (m) => JSON.parse(m.ev(`(function(){
    var g = document.getElementById('grid'), s = getComputedStyle(g), c = g.querySelector('.cell'), cs = c ? getComputedStyle(c) : null;
    var ch = g.querySelector('.cell .chips'), chs = ch ? getComputedStyle(ch) : null;
    return JSON.stringify({ cls: g.className, rows: s.gridAutoRows, ovy: s.overflowY, minH: s.minHeight,
      cellMinH: cs && cs.minHeight, cellOv: cs && cs.overflow, chipsFlex: chs && chs.flex, chipsOv: chs && chs.overflow,
      chips: g.querySelectorAll('.chip').length, mine: g.querySelectorAll('.chip.chip-mine').length, more: g.querySelectorAll('.more').length,
      layout: document.body.dataset.peerLayout || 'overlay', ovl: document.body.dataset.peerOverlay || null, dens: calDensity() });
  })()`));
  const expandOk = (p, what) => {
    assert.strictEqual(p.cls, 'grid bars expand', what + ': 펼침인데 격자에 bars expand 클래스가 없다');
    assert.ok(rowSizeOk(p.rows), `${what}: 계산된 grid-auto-rows 가 고정 최소값이다: ${p.rows}`);
    assert.strictEqual(p.ovy, 'auto', what + ': 격자가 스크롤 상자가 아니다');
    assert.ok(p.minH === '0' || p.minH === '0px', what + ': 격자 min-height 가 0 이 아니다: ' + p.minH);
    // ★ 칸(.cell)의 min-height, overflow 는 여기서 보지 않는다. jsdom 26 의 getComputedStyle 은 선택자 우선순위를 무시하고
    //   소스 순서로만 덮어써서(.grid.expand .cell 보다 뒤에 있는 .cell{min-height:0} 이 이긴다) 실제 화면과 다른 값을 낸다.
    //   그 둘은 위 (정적) 사슬 판정이 지킨다. 격자의 줄 크기는 .grid.expand 가 .grid 보다 뒤라 jsdom 값이 실제와 같다.
    assert.strictEqual(p.more, 0, what + ': 펼침에 +N 이 생겼다');
  };

  let P = null, bootErr = null;
  try { P = boot(app); } catch (e) { bootErr = e; }
  if (bootErr) {
    test('peer-expand-scroll: jsdom 부팅 실패(조사 필요)', () => { throw bootErr; });
  } else {
    test('(jsdom) 겹쳐 보기 + 내 일정 켬 + 펼침(기본): 격자가 내용 기반 줄의 스크롤 상자다(이번 버그 자리)', async () => {
      await settle(); inject(P); await settle();
      const p = probe(P);
      assert.strictEqual(p.layout, 'overlay'); assert.strictEqual(p.ovl, '1'); assert.strictEqual(p.dens, 'expand');
      assert.ok(p.mine > 0 && p.chips > p.mine, '사전조건: 겹쳐 보기에 남 칩과 내 칩이 함께 그려진다: ' + JSON.stringify(p));
      expandOk(p, '겹쳐 보기');
      assert.deepStrictEqual(P.posted, [], '열람 창은 호스트로 아무것도 안 보낸다');
    });
    test('(jsdom) 겹 끔, 나란히 보기에서도 같은 값(펼침 규칙이 보기 방식마다 갈라지지 않는다)', async () => {
      P.ev('document.getElementById("peerOverlayToggle").click()'); await settle();
      expandOk(probe(P), '겹 끔');
      P.ev('document.getElementById("peerOverlayToggle").click()');
      P.ev(`document.querySelector('#peerBanner .peer-layout [data-layout="side"]').click()`); await settle();
      const s = probe(P); assert.strictEqual(s.layout, 'side'); expandOk(s, '나란히 보기');
      assert.ok(rowSizeOk(P.ev('getComputedStyle(document.getElementById("gridMine")).gridAutoRows')), '오른쪽 달력(#gridMine) 줄 크기');
      P.ev(`document.querySelector('#peerBanner .peer-layout [data-layout="overlay"]').click()`); await settle();
    });
    test('(jsdom) 고정, 촘촘히로 바꾸면 예전 값 그대로(1fr, 176px, 펼침 규칙이 새지 않는다)', async () => {
      const set = (v) => P.ev(`(function(){ var x = document.querySelector('#peerBanner input[name="peerDensity"][value="${v}"]'); x.checked = true; x.dispatchEvent(new Event('change')); return calDensity(); })()`);
      assert.strictEqual(set('fixed'), 'fixed'); await settle();
      let p = probe(P); assert.strictEqual(p.cls, 'grid bars'); assert.strictEqual(p.rows, '1fr');
      assert.strictEqual(set('dense'), 'dense'); await settle();
      p = probe(P); assert.strictEqual(p.cls, 'grid bars dense'); assert.strictEqual(p.rows, '176px');
      assert.strictEqual(set('expand'), 'expand'); await settle();
      expandOk(probe(P), '다시 펼침');
      P.close();
    });

    test('변이(jsdom, 열람 창 전용 덮어쓰기): 계산된 값 판정이 고정 최소값을 잡는다', async () => {
      const m = mutate(app, '.grid.expand .chips{overflow:visible;flex:none}',
        '.grid.expand .chips{overflow:visible;flex:none}\nbody[data-peer] .grid.expand{grid-auto-rows:minmax(74px,auto)}');
      const M = boot(m);
      try {
        await settle(); inject(M); await settle();
        const p = probe(M);
        assert.strictEqual(p.cls, 'grid bars expand', '사전조건: 변이 앱도 펼침이다');
        assert.ok(!rowSizeOk(p.rows), '변이했는데도 계산된 값이 내용 기반이다(변이가 캐스케이드에 닿지 않았다): ' + p.rows);
        assert.throws(() => expandOk(p, '변이'), '계산된 값 판정이 변이를 통과시킨다');
      } finally { M.close(); }
    });
  }
}
