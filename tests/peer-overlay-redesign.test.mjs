// 「내 일정 겹쳐보기」 다시 그리기(docs/PEER-OVERLAY-REDESIGN.md O1–O7 · 수용 R1–R6) — 열람 창(`?peer=1`)의 겹 **모양** 계약.
//
// tests/peer-overlay.test.mjs 가 "겹에 무엇이 실리고 무엇이 안 실리는가 · 봉인" 을 지킨다면, 이 파일은
// "겹이 상용 캘린더처럼 읽히는가" 를 지킨다:
//   (S) 정적 — 내 칩·카드 규칙에 점선이 없다 · 새 색은 전부 토큰이고 테마 5종에 다 정의돼 있다(대비 AA 계산) ·
//       범례 마크업(칩 두 개 · 토글 버튼 aria-pressed) · 시간 겹침 판정이 순수 함수다.
//   (P) 순수 — peerTimeOverlaps 의 판정표(겹침 / 맞닿기 / 종일 / 여러 날 / 끝 없음 / 같은 편끼리 / 커밋).
//   (R) jsdom — 범례 토글 ↔ 겹 · aria-pressed · body 속성 / 칸 안 순서(남 → 나) / 상세 두 묶음과 개수 /
//       겹침 배지는 겹친 두 카드에만 · 종일은 없음 / 격자 겹침 점은 겹친 날에만 / setPeerOverlay 직접 호출도 토글과 맞는다(O6).
//   (M) 변이 — 점선 복귀 · 순서 섞임 · 종일을 겹침으로 셈 · 토글 표시 어긋남 — 각각 잡힌다.
//
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 **등록되지 않고** skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

// 앵커 하나를 정확히 한 번 바꾼다 — 없거나 여럿이면 실패(조용히 통과하는 껍데기 변이를 막는다).
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
// 가장 안쪽 규칙 { selector, body } 목록(@media/@container 안쪽 규칙도 selector 만 떼어 나온다).
function cssRules(src) {
  return [...styleOf(src).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
}
// R1 — 내 칩·카드(·범례)에 점선/점 테두리가 남아 있는 규칙.
function dashedMineRules(src) {
  return cssRules(src)
    .filter(r => /chip-mine|card-mine|peer-legend|pl-chip|pl-sw|mine-sep/.test(r.sel))
    .filter(r => /\b(dashed|dotted)\b/.test(r.body))
    .map(r => r.sel + '{' + r.body.trim() + '}');
}

test('(정적) R1: 내 칩·카드·범례 규칙에 점선(dashed/dotted) 테두리가 없다', () => {
  assert.deepStrictEqual(dashedMineRules(app), [], '점선 규칙이 남아 있다 — 미완성(끌기 잔상)처럼 보인다');
});

test('(정적) R1/O2: 내 칩·카드는 연한 채움(--mine-bg) + 진한 왼쪽 막대(--mine-bar) 토큰으로 칠한다', () => {
  const rules = cssRules(app);
  const chip = rules.find(r => r.sel === 'body[data-peer] .chip.chip-mine');
  const card = rules.find(r => r.sel === 'body[data-peer] .card.card-mine');
  assert.ok(chip && card, '내 칩/카드 기본 규칙을 찾지 못했다');
  for (const [nm, r] of [['칩', chip], ['카드', card]]) {
    assert.match(r.body, /background:\s*var\(--mine-bg\)/, `내 ${nm} 바탕이 --mine-bg 가 아니다: ${r.body}`);
    assert.match(r.body, /border-left-color:\s*var\(--mine-bar\)/, `내 ${nm} 왼쪽 막대가 --mine-bar 가 아니다: ${r.body}`);
    assert.ok(!/#[0-9a-f]{3,8}/i.test(r.body), `내 ${nm} 규칙에 hex 가 박혀 있다(토큰으로): ${r.body}`);
  }
  // 시간 칩은 기본 규칙(.chip-timed)이 바탕을 !important 로 비운다 — 내 시간 칩도 채움이 이겨야 한다.
  const timed = rules.find(r => r.sel === 'body[data-peer] .chip.chip-mine.chip-timed');
  assert.ok(timed && /background:\s*var\(--mine-bg\)\s*!important/.test(timed.body),
    '내 시간 칩이 .chip-timed 의 투명 바탕(!important)에 진다 — 시간 일정만 빈 상자로 남는다');
});

// 토큰 블록(정의처) — app-context 의 HEX 래칫이 제외하는 바로 그 자리들이다.
const TOKEN_NAMES = ['--mine-bar', '--mine-bg', '--mine-text', '--mine-sep', '--ovl-bg', '--ovl-ink', '--ovl-dot'];
function tokenBlocks(src) {
  const css = styleOf(src);
  const pick = (re) => { const m = re.exec(css); return m ? m[1] : null; };
  const parse = (body) => Object.fromEntries([...String(body || '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  return {
    light: parse(pick(/(?:^|\n):root\{([^}]*)\}/)),
    dark: parse(pick(/html\.dark\{([^}]*)\}/)),
    forest: parse(pick(/:root\[data-theme="forest"\]\{([^}]*)\}/)),
    sepia: parse(pick(/:root\[data-theme="sepia"\]\{([^}]*)\}/)),
    contrast: parse(pick(/:root\[data-theme="contrast"\]\{([^}]*)\}/)),
  };
}
test('(정적) O7: 겹 토큰 7종이 라이트·다크·포레스트·세피아·고대비 블록에 전부 hex 로 정의돼 있다', () => {
  const B = tokenBlocks(app);
  const miss = [];
  for (const [th, blk] of Object.entries(B)) {
    for (const t of TOKEN_NAMES) if (!/^#[0-9a-f]{3,8}$/i.test(blk[t] || '')) miss.push(`${th}:${t}=${blk[t]}`);
  }
  assert.deepStrictEqual(miss, [], '테마 블록에 겹 토큰이 빠졌다(물려받은 라이트 값이 그 테마 바탕과 맞는다는 보장이 없다)');
  assert.ok(!('--mine-ink' in B.light) && !('--mine-ink' in B.dark), '옛 점선 잉크(--mine-ink)가 남았다 — 쓰는 곳 없는 토큰');
});

const lum = (hex) => {
  let h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
test('(정적) O7: 대비 — 내 글자/내 채움 ≥ 4.5 · 겹침 배지 글자 ≥ 4.5 · 막대/패널 · 겹침 점/패널 ≥ 3 (테마 5종)', () => {
  const B = tokenBlocks(app);
  const bad = [];
  for (const th of ['light', 'dark', 'forest', 'sepia', 'contrast']) {
    const t = { ...B.light, ...(th === 'light' ? {} : B[th]) };
    const checks = [
      ['--mine-text', '--mine-bg', 4.5], ['--ovl-ink', '--ovl-bg', 4.5],
      ['--mine-bar', '--panel', 3], ['--mine-bar', '--mine-bg', 3], ['--ovl-dot', '--panel', 3],
    ];
    for (const [fg, bg, min] of checks) {
      const r = ratio(t[fg], t[bg]);
      if (!(r >= min)) bad.push(`${th}: ${fg}(${t[fg]}) / ${bg}(${t[bg]}) = ${r.toFixed(2)} < ${min}`);
    }
  }
  assert.deepStrictEqual(bad, [], 'AA 미달');
});

// 범례 마크업 — 함수만 잘라 의존(esc · __peerOverlay)을 주입해 돌린다.
function legendFn(src) {
  const code = extractFunction(src, 'peerLegendHtml');
  return (on) => new Function('esc', '__peerOverlay', code + '\nreturn peerLegendHtml;')(
    (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), on);
}
test('(정적) O1: 범례 = 칩 두 개 — [견본 이름](끄지 않음) · [견본 내 일정](button type=button · aria-pressed = 상태)', () => {
  const mk = legendFn(app);
  for (const on of [true, false]) {
    const h = mk(on)('<홍>');
    assert.strictEqual((h.match(/class="pl-chip /g) || []).length, 2, '범례 칩이 두 개가 아니다: ' + h);
    assert.ok(h.includes('&lt;홍&gt;') && !h.includes('<홍>'), '이름(남의 DB 문자열)이 이스케이프되지 않았다');
    assert.match(h, /<span class="pl-chip pl-peer"[^>]*><span class="pl-sw pl-sw-peer"/, '그 사람 칩에 견본이 없다');
    const btn = /<button ([^>]*)>/.exec(h);
    assert.ok(btn, '「내 일정」 토글이 button 이 아니다');
    assert.match(btn[1], /type="button"/);
    assert.match(btn[1], /id="peerOverlayToggle"/);
    assert.match(btn[1], new RegExp(`aria-pressed="${on}"`), 'aria-pressed 가 상태와 다르다');
    assert.match(btn[1], /aria-label="내 일정 겹쳐보기"/, '토글의 접근성 이름이 없다');
    assert.ok(!/type="checkbox"/.test(h) && !/점선/.test(h), '옛 체크박스·점선 범례가 남았다');
  }
});

// ══════════════════════════════════════════════════════════════════════
// (P) peerTimeOverlaps — 순수 판정표
// ══════════════════════════════════════════════════════════════════════
function overlapFnFrom(src) {
  const code = extractFunction(src, 'peerTimeOverlaps');
  return new Function(code + '\nreturn peerTimeOverlaps;')();
}
test('(정적) O5: peerTimeOverlaps 는 전역·DOM 을 쓰지 않는다(잘라서 단독으로 돈다)', () => {
  const code = extractFunction(app, 'peerTimeOverlaps');
  for (const g of ['document', 'window', 'state.', '__peer', 'localStorage', 'selectedDate', 'PEER']) {
    assert.ok(!code.includes(g), `peerTimeOverlaps 가 '${g}' 를 참조한다 — 순수 함수가 아니다`);
  }
  assert.strictEqual(typeof overlapFnFrom(app), 'function');
});

const T = (id, s, e, more = {}) => ({ id, date: '2026-09-08', title: 'T' + id, allDay: false, startTime: s, endTime: e, ...more });
const M = (id, s, e, more = {}) => T(id, s, e, { _mine: true, ...more });
function overlapCases(fn) {
  const r = {};
  r.basic = fn([T('a', '10:00', '11:00'), M('b', '10:30', '11:30')]);
  r.touch = fn([T('a', '10:00', '11:00'), M('b', '11:00', '12:00')]);
  r.allDay = fn([T('a', '10:00', '11:00'), M('b', '10:15', '10:45', { allDay: true })]);   // 종일인데 옛 시각이 남은 일정
  r.allDayPeer = fn([T('a', '10:15', '10:45', { allDay: true }), M('b', '10:00', '11:00')]);
  r.noEnd = fn([T('a', '10:00', ''), M('b', '10:20', '')]);          // 끝 없음 = 30분
  r.noEndFar = fn([T('a', '10:00', ''), M('b', '10:30', '')]);       // 10:00–10:30 · 10:30– → 맞닿기
  r.same = fn([T('a', '10:00', '11:00'), T('c', '10:00', '11:00'), M('b', '13:00', '14:00'), M('d', '13:00', '14:00')]);
  r.multi = fn([T('a', '10:00', '11:00', { endDate: '2026-09-09' }), M('b', '10:00', '11:00')]);
  r.occ = fn([T('a', '10:00', '11:00', { _occStart: '2026-09-07', _occEnd: '2026-09-08' }), M('b', '10:00', '11:00')]);
  r.git = fn([T('a', '10:00', '11:00', { source: 'git' }), M('b', '10:00', '11:00')]);
  r.noStart = fn([T('a', '', '11:00'), M('b', '10:00', '11:00')]);
  r.idClash = fn([T('7', '09:00', '10:00'), M('7', '09:30', '10:30')]);
  r.bad = [fn(null), fn(undefined), fn('x'), fn({})];
  return r;
}
test('(순수) O5: 상대 ↔ 나 시간 겹침만 · 맞닿기·종일·여러 날·커밋·시작 없음은 아님 · 끝 없음 = 30분', () => {
  const r = overlapCases(overlapFnFrom(app));
  assert.deepStrictEqual(Object.keys(r.basic).sort(), ['m:b', 'p:a']);
  assert.deepStrictEqual(r.basic['p:a'].map(o => [o.id, o.startTime, o.endTime, o.mine]), [['b', '10:30', '11:30', true]],
    '상대 카드에는 겹친 **내** 일정의 시간이 실려야 한다');
  assert.deepStrictEqual(r.basic['m:b'].map(o => [o.id, o.startTime, o.endTime, o.mine]), [['a', '10:00', '11:00', false]]);
  assert.deepStrictEqual(r.touch, {}, '맞닿기(11:00 끝 · 11:00 시작)는 겹침이 아니다');
  assert.deepStrictEqual(r.allDay, {}, '종일 일정(옛 시각이 남아 있어도)은 겹침 대상이 아니다');
  assert.deepStrictEqual(r.allDayPeer, {}, '상대의 종일 일정도 겹침 대상이 아니다');
  assert.deepStrictEqual(Object.keys(r.noEnd).sort(), ['m:b', 'p:a'], '끝 시각이 없으면 30분짜리로 본다(10:00–10:30 과 10:20–)');
  assert.deepStrictEqual(r.noEndFar, {}, '끝 없음 30분 — 10:30 시작과는 맞닿기다');
  assert.deepStrictEqual(r.same, {}, '같은 편끼리(상대–상대 · 나–나)는 겹침으로 세지 않는다');
  assert.deepStrictEqual(r.multi, {}, '여러 날 일정은 종일 막대로 그린다 — 겹침 대상이 아니다');
  assert.deepStrictEqual(r.occ, {}, '여러 날 occurrence(_occStart≠_occEnd)도 대상이 아니다');
  assert.deepStrictEqual(r.git, {}, '커밋 기록은 대상이 아니다');
  assert.deepStrictEqual(r.noStart, {}, '시작 시각이 없으면 대상이 아니다');
  assert.deepStrictEqual(Object.keys(r.idClash).sort(), ['m:7', 'p:7'], '두 DB 의 id 가 같아도 p:/m: 로 갈린다');
  for (const b of r.bad) assert.deepStrictEqual(b, {}, '비배열 입력은 {}');
});
test('(순수) O5: 입력 목록·항목을 변형하지 않는다', () => {
  const fn = overlapFnFrom(app);
  const list = [T('a', '10:00', '11:00'), M('b', '10:30', '')];
  const before = JSON.stringify(list);
  const out = fn(list);
  out['p:a'][0].title = '바뀜';
  assert.strictEqual(JSON.stringify(list), before, '판정이 입력을 건드렸다');
});
test('변이(종일을 겹침으로 셈): allDay 거르기를 빼면 판정표가 잡는다', () => {
  const fn = overlapFnFrom(mutate(app, "    if(!e || e.allDay || e.source === 'git') continue;", "    if(!e || e.source === 'git') continue;"));
  const r = overlapCases(fn);
  assert.notDeepStrictEqual(r.allDay, {}, '변이가 판정에 닿지 않았다(앵커 재검토)');
  assert.throws(() => assert.deepStrictEqual(r.allDay, {}), '종일 계약이 변이를 통과시킨다');
});
test('변이(점선 복귀): 내 칩 규칙에 점선 테두리를 되살리면 R1 이 잡는다', () => {
  const mut = mutate(app, 'body[data-peer] .chip.chip-mine{ background:var(--mine-bg);',
    'body[data-peer] .chip.chip-mine{ border:1.5px dashed var(--mine-bar); background:var(--mine-bg);');
  assert.ok(dashedMineRules(mut).length > 0, '점선 규칙을 되살렸는데 R1 이 못 잡는다');
  const mut2 = mutate(app, 'body[data-peer] .card.card-mine{ background:var(--mine-bg);',
    'body[data-peer] .card.card-mine{ outline:1.5px dashed var(--mine-bar); background:var(--mine-bg);');
  assert.ok(dashedMineRules(mut2).length > 0, '카드 점선 윤곽을 되살렸는데 R1 이 못 잡는다');
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom — 열람 창을 실제로 띄운다
// ══════════════════════════════════════════════════════════════════════
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;

if (!JSDOM) {
  skip('peer-overlay-redesign: jsdom 미설치 — 범례·순서·묶음·겹침 렌더 계약을 돌리지 못했다', SKIP_NO_JSDOM,
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
  const PEER_URL = 'https://tcapp.local/?peer=1';
  function boot(src) {
    const posted = [];
    const dom = new JSDOM(src, bootOpts(PEER_URL, posted));
    const w = dom.window;
    return {
      w, posted, ev: (c) => w.eval(c),
      evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      close: () => { try { w.close(); } catch (_) {} },
    };
  }
  const settle = () => new Promise(r => setTimeout(r, 60));

  // ── 픽스처 — 9/8: 상대 종일 1 + 상대 시간 2(10–11 · 14–15) · 내 시간 1(10:30–11:30, 상대 10–11 과 겹침) + 내 종일 1(옛 시각 10:15 남음)
  //             9/9: 상대 09–10 · 내 10–11(맞닿기 — 겹침 아님)   9/15~17: 상대 기간 막대 · 9/16~18: 내 기간 막대 · 9/22: 내 것만
  const CATS = [{ id: 'c-A', name: '설계 검토', color: '#c0392b' }, { id: 'c-B', name: '보고서 작성', color: '#2980b9' }];
  const mine = (o) => ({ endDate: '', recur: null, recurExcept: [], categoryId: null, _mine: true, ...o });
  const ENTRIES = [
    { id: 'p-all', date: '2026-09-08', categoryId: 'c-B', title: '상대: 주간보고', allDay: true, startTime: '', endTime: '' },
    { id: 'p-10', date: '2026-09-08', categoryId: 'c-A', title: '상대: 설계회의', allDay: false, startTime: '10:00', endTime: '11:00' },
    { id: 'p-14', date: '2026-09-08', categoryId: 'c-A', title: '상대: 고객통화', allDay: false, startTime: '14:00', endTime: '15:00' },
    { id: 'p-09', date: '2026-09-09', categoryId: 'c-A', title: '상대: 아침회의', allDay: false, startTime: '09:00', endTime: '10:00' },
    { id: 'p-rng', date: '2026-09-15', categoryId: 'c-A', title: '상대: 통합시험', allDay: true, endDate: '2026-09-17' },
    mine({ id: 'm-1030', date: '2026-09-08', title: '나: 회의 준비', allDay: false, startTime: '10:30', endTime: '11:30' }),
    mine({ id: 'm-all', date: '2026-09-08', title: '나: 외근', allDay: true, startTime: '10:15', endTime: '' }),
    mine({ id: 'm-10', date: '2026-09-09', title: '나: 정리', allDay: false, startTime: '10:00', endTime: '11:00' }),
    mine({ id: 'm-rng', date: '2026-09-16', title: '나: 출장', allDay: true, startTime: '', endTime: '', endDate: '2026-09-18' }),
    mine({ id: 'm-22', date: '2026-09-22', title: '나: 혼자 있는 날', allDay: false, startTime: '09:00', endTime: '10:00' }),
  ];
  const DATA = { categories: CATS, entries: ENTRIES, todos: [], rooms: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '' };
  function inject(m, data = DATA) {
    m.ev('view = {y:2026, m:8}; selectedDate = "2026-09-08";');
    m.w.__applyState(JSON.stringify(data), { peerName: '홍길동', canWrite: false });
  }
  // 칸 하나의 자식 순서 — 'p'(상대 칩) · 'm'(내 칩) · '|'(구분줄) · '_'(빈 칸)
  const cellSeq = (m, ds) => m.ev(`Array.prototype.map.call(document.querySelectorAll('#grid .cell[data-date="${ds}"] .chips > *'), function(c){
      return c.classList.contains('mine-sep') ? (c.classList.contains('blank') ? '.' : '|') : c.classList.contains('chip-spacer') ? '_' : c.classList.contains('chip-mine') ? 'm' : 'p'; }).join('')`);
  const ordered = (seq) => !/m.*p/.test(seq.replace(/[|._]/g, ''));   // 내 것 뒤에 상대 것이 오면 섞인 것
  const pressed = (m) => m.ev('document.getElementById("peerOverlayToggle").getAttribute("aria-pressed")');

  let P = null, bootErr = null;
  try { P = boot(app); } catch (e) { bootErr = e; }

  if (bootErr) {
    test('peer-overlay-redesign: jsdom 부팅 실패(조사 필요)', () => { throw bootErr; });
  } else {
    test('(jsdom) 준비: 열람 창에 혼합본이 들어가고 겹이 켜진 채 뜬다', async () => {
      await settle();
      P.ev('try{ localStorage.removeItem("tc_peerOverlay"); }catch(_){}');
      inject(P);
      await settle();
      assert.strictEqual(P.ev('PEER'), true);
      assert.strictEqual(P.ev('state.entries.filter(function(e){return e._mine;}).length'), 5);
      assert.strictEqual(pressed(P), 'true');
      assert.deepStrictEqual(P.posted, [], '열람 창은 호스트로 아무것도 안 보낸다');
    });

    test('(jsdom) R2: 범례 칩 두 개 — 이름 칩(견본 = 상대 과제 색) · 「내 일정」 토글', () => {
      const chips = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#peerBanner .peer-legend .pl-chip"), function(c){ return [c.tagName, c.textContent.trim()]; })');
      assert.deepStrictEqual(chips, [['SPAN', '홍길동'], ['BUTTON', '내 일정']]);
      const sw = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#peerBanner .pl-sw-peer b"), function(b){ return b.style.backgroundColor || b.style.background; })');
      assert.strictEqual(sw.length, 3, '견본 막대가 세 개가 아니다');
      assert.ok(sw.some(c => /192,\s*57,\s*43|c0392b/i.test(c)), '견본이 그 사람 과제 색이 아니다: ' + JSON.stringify(sw));
      assert.strictEqual(P.ev('document.querySelectorAll("#peerBanner input[type=checkbox]").length'), 0, '옛 체크박스가 남았다');
    });

    test('(jsdom) R2: 「내 일정」 칩 클릭 → 겹·aria-pressed·body 속성·저장값이 함께 바뀐다(그리고 되돌아온다)', () => {
      P.ev('document.getElementById("peerOverlayToggle").click();');
      assert.strictEqual(P.ev('__peerOverlay'), false);
      assert.strictEqual(pressed(P), 'false');
      assert.strictEqual(P.ev('document.getElementById("peerOverlayToggle").classList.contains("on")'), false);
      assert.strictEqual(P.ev('String(document.body.dataset.peerOverlay)'), 'undefined');
      assert.strictEqual(P.ev('localStorage.getItem("tc_peerOverlay")'), '0');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), 0);
      assert.strictEqual(P.ev('document.querySelectorAll("#dpBody .dp-sec").length'), 0, '겹을 끄면 상세는 한 목록(묶음 없음)');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .ovl-dot").length'), 0, '겹을 끄면 겹침 점도 없다');
      P.ev('document.getElementById("peerOverlayToggle").click();');
      assert.strictEqual(P.ev('__peerOverlay'), true);
      assert.strictEqual(pressed(P), 'true');
      assert.strictEqual(P.ev('document.getElementById("peerOverlayToggle").classList.contains("on")'), true);
      assert.strictEqual(P.ev('String(document.body.dataset.peerOverlay)'), '1');
      assert.ok(P.ev('document.querySelectorAll("#grid .chip.chip-mine").length') > 0);
    });

    test('(jsdom) R6/O6: setPeerOverlay 직접 호출(프로그램 경로)도 토글 표시와 늘 맞는다', () => {
      for (const v of [false, true, false, true]) {
        P.ev(`setPeerOverlay(${v});`);
        assert.strictEqual(pressed(P), String(v), `setPeerOverlay(${v}) 뒤 aria-pressed 가 어긋났다`);
        assert.strictEqual(P.ev('document.getElementById("peerOverlayToggle").classList.contains("on")'), v);
      }
    });

    test('(jsdom) R6/O6: 저장값 "0" 으로 다시 주입되면 토글이 꺼진 채로 그려진다(초기 렌더가 상태를 읽는다)', async () => {
      P.ev('localStorage.setItem("tc_peerOverlay","0");');
      inject(P);
      await settle();
      assert.strictEqual(P.ev('__peerOverlay'), false);
      assert.strictEqual(pressed(P), 'false');
      P.ev('setPeerOverlay(true);');
      inject(P);
      await settle();
      assert.strictEqual(pressed(P), 'true');
    });

    test('(jsdom) R1/O2: 내 칩은 과제 색 인라인 style 이 없고(토큰이 칠한다) 내 시간 칩에는 점이 없다', () => {
      const st = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#grid .chip.chip-mine"), function(c){ return c.getAttribute("style"); })');
      assert.ok(st.length >= 4, '내 칩이 그려지지 않았다');
      assert.deepStrictEqual(st.filter(s => s !== null), [], '내 칩에 과제 색 style 이 박혔다: ' + JSON.stringify(st));
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip.chip-mine .cdot").length'), 0);
      assert.ok(P.ev('document.querySelectorAll("#grid .chip:not(.chip-mine)[style*=border-left-color]").length') > 0,
        '상대 칩 모양은 그대로여야 한다(과제 색 막대)');
    });

    test('(jsdom) R3: 한 칸 안에서 상대 일정 먼저 · 내 일정은 그 아래 · 둘 다 있을 때만 구분줄', () => {
      const s8 = cellSeq(P, '2026-09-08');
      assert.strictEqual(s8, 'ppp|mm', '9/8 칸 순서: ' + s8);
      // 각 묶음 안의 순서는 그대로(종일 → 시간순)
      const t8 = P.evJSON(`Array.prototype.map.call(document.querySelectorAll('#grid .cell[data-date="2026-09-08"] .chip'), function(c){ return c.dataset.id; })`);
      assert.deepStrictEqual(t8, ['p-all', 'p-10', 'p-14', 'm-all', 'm-1030']);
      assert.strictEqual(cellSeq(P, '2026-09-09'), 'p|m');
      assert.strictEqual(cellSeq(P, '2026-09-22'), 'm', '상대 것이 없는 날에는 구분줄이 없다');
      assert.strictEqual(cellSeq(P, '2026-09-15'), 'p', '내 것이 없는 날에는 구분줄이 없다');
      for (const ds of ['2026-09-08', '2026-09-09', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']) {
        assert.ok(ordered(cellSeq(P, ds)), `${ds} 에서 내 일정 뒤에 상대 일정이 온다: ${cellSeq(P, ds)}`);
      }
    });

    test('(jsdom) R3: 내 기간 막대는 한 주 안에서 같은 줄에 선다(상대 묶음을 빈 칸으로 맞춤)', () => {
      const idx = P.evJSON(`['2026-09-16','2026-09-17','2026-09-18'].map(function(ds){
        var kids = Array.prototype.slice.call(document.querySelectorAll('#grid .cell[data-date="' + ds + '"] .chips > *'));
        return kids.findIndex(function(c){ return c.dataset && c.dataset.id === 'm-rng'; }); })`);
      assert.ok(idx.every(i => i >= 0), '내 기간 막대가 안 그려졌다: ' + JSON.stringify(idx));
      assert.strictEqual(new Set(idx).size, 1, '내 기간 막대의 줄이 칸마다 다르다(끊긴 막대): ' + JSON.stringify(idx));
      assert.strictEqual(cellSeq(P, '2026-09-18'), '_.m', '상대 막대가 없는 날은 빈 칸 + 빈 구분 자리로 맞춘다');
      assert.strictEqual(P.ev(`document.querySelector('#grid .cell[data-date="2026-09-18"] .chips').dataset.extra`), '0',
        '빈 칸·구분 자리가 「+N」 에 섞였다');
    });

    test('(jsdom) R4: 상세 패널 = 두 묶음 「홍길동 님 일정 (3)」 · 「내 일정 (2)」, 카드는 제 묶음에만', () => {
      const secs = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#dpBody .dp-sec"), function(s){ return [s.querySelector(".dp-sec-h").textContent.replace(/\\s+/g," ").trim(), s.querySelectorAll(".card").length, s.querySelectorAll(".card.card-mine").length]; })');
      assert.deepStrictEqual(secs, [['홍길동 님 일정 (3)', 3, 0], ['내 일정 (2)', 2, 2]]);
      P.ev('selectedDate = "2026-09-15"; renderAll();');
      const s15 = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#dpBody .dp-sec"), function(s){ return [s.querySelector(".dp-sec-h").textContent.replace(/\\s+/g," ").trim(), !!s.querySelector(".dp-sec-empty")]; })');
      assert.deepStrictEqual(s15, [['홍길동 님 일정 (1)', false], ['내 일정 (0)', true]], '빈 묶음은 머리말 + 「없습니다」');
      P.ev('selectedDate = "2026-09-08"; renderAll();');
    });

    test('(jsdom) R5: 「시간 겹침」 배지는 겹친 두 카드에만 — 상대 시간이 함께 · 종일/다른 시간은 없음', () => {
      const b = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#dpBody .card"), function(c){ var x = c.querySelector(".ovl-badge"); return [c.dataset.id, x ? x.textContent.trim() : null, x ? x.getAttribute("title") : null]; })');
      const by = Object.fromEntries(b.map(([id, t, ti]) => [id, { t, ti }]));
      assert.ok(by['p-10'].t && by['p-10'].t.includes('시간 겹침') && by['p-10'].t.includes('10:30~11:30'),
        '상대 카드 배지에 겹친 내 시간이 없다: ' + by['p-10'].t);
      assert.ok(by['p-10'].ti.includes('내 일정과 시간이 겹칩니다') && by['p-10'].ti.includes('나: 회의 준비'), by['p-10'].ti);
      assert.ok(by['m-1030'].t && by['m-1030'].t.includes('10:00~11:00'), '내 카드 배지에 겹친 상대 시간이 없다: ' + by['m-1030'].t);
      assert.ok(by['m-1030'].ti.includes('홍길동 님 일정과 시간이 겹칩니다'), by['m-1030'].ti);
      for (const id of ['p-all', 'p-14', 'm-all']) assert.strictEqual(by[id].t, null, `${id} 에 겹침 배지가 붙었다`);
      P.ev('selectedDate = "2026-09-09"; renderAll();');
      assert.strictEqual(P.ev('document.querySelectorAll("#dpBody .ovl-badge").length'), 0, '맞닿기(9/9)에 배지가 붙었다');
      P.ev('selectedDate = "2026-09-08"; renderAll();');
    });

    test('(jsdom) R5: 격자 겹침 점은 겹친 날(9/8)에만 · 툴팁/접근성 문구', () => {
      const dots = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#grid .ovl-dot"), function(d){ return [d.closest(".cell").dataset.date, d.getAttribute("title"), d.getAttribute("aria-label")]; })');
      assert.deepStrictEqual(dots, [['2026-09-08', '시간이 겹치는 일정이 있습니다', '시간이 겹치는 일정이 있습니다']]);
      assert.ok(P.ev(`document.querySelector('#grid .cell[data-date="2026-09-08"]').getAttribute('aria-label')`).includes('시간이 겹치는 일정 있음'));
    });

    // ══════════════════════════════════════════════════════════════════
    // (M) 변이 — 부팅이 필요한 것
    // ══════════════════════════════════════════════════════════════════
    async function withMutated(find, repl, fn) {
      const m = boot(mutate(app, find, repl));
      try { await settle(); m.ev('try{ localStorage.removeItem("tc_peerOverlay"); }catch(_){}'); inject(m); await settle(); return await fn(m); }
      finally { m.close(); }
    }

    test('변이(순서 섞임): 묶음 나누기를 끄면 R3 판정이 섞인 순서를 잡는다', async () => {
      await withMutated('    if(!mineItems.length){ cellLay[ds] =', '    if(true){ cellLay[ds] =', async (m) => {
        const s = cellSeq(m, '2026-09-08');
        assert.ok(s.includes('m'), '사전조건: 변이 앱에도 내 칩은 그려진다: ' + s);
        assert.strictEqual(ordered(s), false, '변이했는데도 순서가 남 → 나 다 — 변이가 배치에 닿지 않았다(앵커 재검토): ' + s);
        assert.notStrictEqual(s, 'ppp|mm', 'R3 의 기대값이 변이를 통과시킨다');
      });
    });

    test('변이(토글 표시 어긋남): syncPeerOverlayAttr 가 토글을 안 고치면 O6 판정이 잡는다', async () => {
      await withMutated('  }catch(_){}\n  syncPeerOverlayToggle();\n}', '  }catch(_){}\n}', async (m) => {
        assert.strictEqual(pressed(m), 'true', '사전조건: 초기 렌더는 상태를 읽는다');
        m.ev('setPeerOverlay(false);');
        assert.strictEqual(m.ev('__peerOverlay'), false);
        assert.strictEqual(pressed(m), 'true', '변이했는데도 토글이 따라온다 — 변이가 동기화 경로에 닿지 않았다(앵커 재검토)');
        assert.notStrictEqual(pressed(m), String(m.ev('__peerOverlay')), 'O6 판정이 어긋남을 통과시킨다');
      });
    });

    test('peer-overlay-redesign: 뒷정리(창 닫기)', () => { P.close(); });
  }
}
