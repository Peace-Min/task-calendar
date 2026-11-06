// 날짜 패널 묶음 접기(docs/PC-WATCH-2.md §5, docs/PERSONAL-PANEL.md 2.1 의 연장)와 일정 카드, 늘 보이는 묶음 머리(docs/DAY-PANEL-CARDS.md 결정 1~10).
// 시안 dist/proto/day-panel-v6.html(애프터: 여백 조금 줄임, 메모 전부). 11/5 의 한 줄 일정과 줄 펼침 상세(dpEvRowHtml, dpEvDetHtml)는 11/6 카드로 되돌렸다.
// 할 일 줄과 할 일 들여쓴 상세(dpTdDetHtml)의 계약은 tests/pc-watch-7.test.mjs.
//
// 이 파일이 지키는 것:
//   (S) 정적: 일정은 카드(cardHtml), 한 줄 줄과 줄 펼침 상세는 없다. 5개 제한, 더 보기 열쇠(ev, td, 열람 창 두 묶음 peer, mine), 접기 기억 키(계정별, 열람 창은 기억 안 함).
//       늘 보이는 머리 CSS(sticky, 묶음 상자 display:contents, 일정 top 0, 할 일 top 머리 높이와 bottom 0, 아래에 붙으면 그림자), 본문 scroll-padding(위 둘, 아래 하나).
//       카드 여백(바깥 4, 안쪽 5/8, 줄 간격 2), 메모 전부(줄 자르기 없음). 꼬리표 글자 대비: 테마 다섯마다 어떤 과제 색이든 4.5:1 이상(토큰으로 계산).
//       새 함수와 CSS 에 금지 기호와 hex 색이 없다.
//   (R) 런타임(jsdom):
//       카드 내용(꼬리표, 제목, 시각과 장소, 기간 n일째, 반복, 메모 전부와 링크, [수정] [삭제]), [수정]은 일정 수정 창, 반복 [삭제]는 반복 확인 창.
//       정렬(종일 먼저, 시각순) 뒤 5개, n개 더 보기와 줄이기, 날짜를 바꾸면 다시 5개. 할 일 머리 숫자는 남은 개수/전체.
//       머리 누르기: 위에 붙은 일정 머리는 일정 맨 위로, 아래에 붙은 할 일 머리와 위에 붙은 할 일 머리는 할 일 처음으로(접지 않음), 제자리면 접는다.
//       붙은 머리의 읽히는 이름과 그림자. 접기와 줄이기 뒤 누른 것이 같은 자리(출렁임 없음). 접기 기억. 달력 칩 강조(카드 강조, 5개 밖이면 더 보기, 접혔으면 편다).
//   (M) 변이: 5개 제한, 날짜 바뀜 정리, 접기 기억, 강조 더 보기, 붙은 머리 이동, 출렁임 맞춤, 남은 개수, 꼬리표 섞는 몫을 망가뜨리면 위 시험이 잡는다.
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
const css = app.slice(0, app.indexOf('</style>'));
const ymdAdd = (ds, n) => { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('(S) 좁은 폭 터치 하한: 시트 닫기 손잡이는 위아래 10px(높이 24px), 참여자 팝업 조직 경로 단추도 사람 고르기와 같은 32px 규칙(2026-11-06 loop-ui-visual V7)', () => {
  assert.ok(/\.dp-sheet-handle\{display:flex;justify-content:center;align-items:center;padding:10px 0;/.test(css), '시트 손잡이 높이가 24px 아래로 줄었다');
  assert.ok(css.includes('@media (max-width:440px){ :is(.pk-pop,.fb-pop-who) :is(.pk-more,.pk-crumb button){ min-height:32px;'), '참여자 팝업 경로 단추가 좁은 폭 터치 하한 규칙에서 빠졌다');
});
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}

// ══════════════════════════════════════════════════════════════════════
// 꼬리표 대비(결정 4): 글자 = color-mix(in srgb, 과제 색 --tag-mix, --text), 바탕 = tint(과제 색, .13) 를 --panel 위에 얹은 색
// ══════════════════════════════════════════════════════════════════════
const THEMES = { light: /\n:root\{/, dark: /\nhtml\.dark\{/, forest: /\n:root\[data-theme="forest"\]\{/, sepia: /\n:root\[data-theme="sepia"\]\{/, contrast: /\n:root\[data-theme="contrast"\]\{/ };
function themeTokens(src) {
  const c = src.slice(0, src.indexOf('</style>'));
  const block = (re) => { const m = re.exec(c); assert.ok(m, '테마 토큰 블록을 찾지 못했다: ' + re); return c.slice(m.index, c.indexOf('}', m.index)); };
  const read = (b, name) => { const m = new RegExp('--' + name + ':\\s*([^;]+);').exec(b); return m ? m[1].trim() : null; };
  const root = block(THEMES.light), out = {};
  for (const [k, re] of Object.entries(THEMES)) {
    const b = block(re);
    out[k] = { panel: read(b, 'panel') || read(root, 'panel'), text: read(b, 'text') || read(root, 'text'), mix: read(b, 'tag-mix') || read(root, 'tag-mix') };
  }
  return out;
}
const hex = (x) => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(x); assert.ok(m, '색 토큰이 hex 가 아니다: ' + x); const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]; return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const mixRgb = (a, b, p) => a.map((v, i) => v * p + b[i] * (1 - p));
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function paletteOf(src) { const m = /const PALETTE = \[([^\]]+)\]/.exec(src); assert.ok(m, 'PALETTE 를 찾지 못했다'); return m[1].match(/#[0-9a-fA-F]{6}/g); }
//  테마마다 가장 낮은 대비(팔레트 + 이름 없는 과제 회색 + 직접 고른 색을 대신하는 RGB 격자 4096색)
function tagContrast(src) {
  const T = themeTokens(src), cols = [...paletteOf(src), '#8a93a6'].map(hex);
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) cols.push([r, g, b]);
  const out = {};
  for (const [k, t] of Object.entries(T)) {
    const p = parseFloat(t.mix) / 100;
    assert.ok(/%$/.test(t.mix) && p > 0 && p < 1, `${k}: --tag-mix 가 백분율이 아니다: ${t.mix}`);
    const panel = hex(t.panel), text = hex(t.text);
    let min = Infinity, pal = Infinity;
    cols.forEach((c, i) => { const v = ratio(mixRgb(c, text, p), mixRgb(c, panel, 0.13)); if (v < min) min = v; if (i < 19 && v < pal) pal = v; });
    out[k] = { min: Math.round(min * 100) / 100, palette: Math.round(pal * 100) / 100, mix: t.mix };
  }
  return out;
}
const checkContrast = (src) => { for (const [k, v] of Object.entries(tagContrast(src))) assert.ok(v.min >= 4.5, `${k} 테마 꼬리표 대비가 4.5:1 미만이다: ${JSON.stringify(v)}`); };

// ══════════════════════════════════════════════════════════════════════
// (S) 정적
// ══════════════════════════════════════════════════════════════════════
test('(S) 일정은 카드(cardHtml), 한 줄 줄과 줄 펼침 상세는 없다. 묶음마다 5개 제한, 열람 창 두 묶음도 같은 카드와 제한', () => {
  assert.ok(/const DP_LIMIT = 5;/.test(app), '5개 제한 값이 없다');
  for (const gone of ['function dpEvRowHtml(', 'function dpEvDetHtml(', 'function dpEvKey(', 'dp-er-b', '.dp-er{', 'dp-edet']) assert.ok(!app.includes(gone), `걷어야 할 한 줄 일정 흔적 ${gone} 이 남았다`);
  const dd = extractFunction(app, 'dayDetailHtml');
  assert.ok(dd.includes("dpLimit('ev', list).map(e => cardHtml(e))") && dd.includes("dpMoreHtml('ev', list.length)"), '일정 묶음이 카드 5개 제한이 아니다');
  assert.ok(dd.includes("dpLimit('td', tds)") && dd.includes("dpMoreHtml('td', tds.length)"), '할 일 묶음에 5개 제한이 없다');
  assert.ok(dd.includes('dpLimit(cls, items).map(card)') && dd.includes('dpMoreHtml(cls, items.length)') && dd.includes('const card = e => cardHtml(e, ov[ovlKey(e)]);'), '열람 창 두 묶음(상대 일정, 내 일정)이 같은 카드와 제한이 아니다');
  assert.ok(dd.includes('entriesOn(selectedDate).slice().sort(entrySort)'), '일정이 종일 먼저, 시각순(entrySort)으로 서지 않는다');
  assert.ok(dd.indexOf('dpSync()') < dd.indexOf('dpReveal('), '날짜 바뀜 정리(dpSync)가 강조 펼치기(dpReveal)보다 먼저가 아니다');
  const card = extractFunction(app, 'cardHtml');
  assert.ok(/\(PEER \? '' : '<div class="card-actions">/.test(card), '열람 창에서 카드의 [수정] [삭제]를 그린다');
  assert.ok(card.includes('<span class="badge cat-tag" style="background:${tint(col)}"') && !/color:\$\{col\}/.test(card), '꼬리표가 바탕만 과제 색 옅게이고 글자는 CSS 섞음이 아니다');
});
test('(S) 접기 기억: 계정별 이 PC(tc_dpfold:<계정>, 보기 설정 tc_view 와 같은 방식), 열람 창은 기억하지 않는다', () => {
  assert.ok(extractFunction(app, 'dpFoldKey').includes("'tc_dpfold:' + rptDraftWho()"), '접기 기억 키가 계정별이 아니다');
  assert.ok(/if\(PEER\) return;/.test(extractFunction(app, 'dpFoldSave')), '열람 창이 접기를 기억한다');
  assert.ok(/if\(PEER\) return DP\.fold;/.test(extractFunction(app, 'dpFoldSet')), '열람 창이 저장된 접기를 읽는다');
});
test('(S) 늘 보이는 머리 CSS: sticky(본문 스크롤 상자 안), 묶음 상자 display:contents, 일정 top 0, 할 일 top 머리 높이와 bottom 0, 아래에 붙으면 그림자, scroll-padding', () => {
  const body = /\n\.dp-body\{([^}]*)\}/.exec(css);
  assert.ok(body && /overflow-y:auto/.test(body[1]) && /--dp-gh:\d+px/.test(body[1]), '본문이 스크롤 상자가 아니거나 머리 높이 변수가 없다');
  assert.ok(/scroll-padding-top:calc\(var\(--dp-gh\) \* 2\)/.test(body[1]) && /scroll-padding-bottom:var\(--dp-gh\)/.test(body[1]), '본문 scroll-padding 이 위 머리 둘, 아래 머리 하나 높이가 아니다(결정 10)');
  assert.ok(/\n\.dp-grp\{display:contents\}/.test(css), '묶음 상자가 display:contents 가 아니다(할 일 머리가 자기 묶음 밖에서 아래에 붙지 못한다)');
  const h = /\n\.dp-grp-h\{([^}]*)\}/.exec(css);
  assert.ok(h && /position:sticky/.test(h[1]) && /height:var\(--dp-gh\)/.test(h[1]) && /background:var\(--panel\)/.test(h[1]) && /z-index:\d/.test(h[1]), '묶음 머리가 sticky(높이 고정, 바탕 칠함)가 아니다');
  assert.ok(/\n\.dp-grp\[data-grp="ev"\] > \.dp-grp-h\{top:0;/.test(css), '일정 머리가 본문 위에 붙지 않는다');
  assert.ok(/\n\.dp-grp\[data-grp="td"\] > \.dp-grp-h\{top:var\(--dp-gh\);bottom:0;/.test(css), '할 일 머리가 일정 머리 밑과 본문 아래에 붙지 않는다');
  assert.ok(/\n\.dp-grp-h\.stuck\{box-shadow:[^}]*var\(--seg-sh\)\}/.test(css), '아래에 붙은 머리의 그림자가 없다');
  assert.ok(!/\n\.dp-grp \+ \.dp-grp\{/.test(css), '묶음 상자 경계선이 남았다(display:contents 라 그려지지 않는다, 머리가 선을 진다)');
});
test('(S) 카드 여백 조금 줄임(바깥 4, 안쪽 5/8, 줄 간격 2), 메모 전부(줄 자르기 없음), 메타 줄 그림은 읽히지 않음', () => {
  const card = /\n\.card\{([^}]*)\}/.exec(css);
  assert.ok(card && /display:flex;flex-direction:column;gap:2px/.test(card[1]) && /padding:5px 8px/.test(card[1]), '카드 안쪽 5/8, 줄 간격 2 가 아니다');
  assert.ok(/\.dp-list\.dp-cards\{gap:4px;padding:4px 10px\}/.test(css), '카드 바깥 여백 4 가 아니다');
  const memo = /\n\.card-memo\{([^}]*)\}/.exec(css);
  assert.ok(memo && !/max-height|overflow:hidden|line-clamp/.test(memo[1]) && /white-space:pre-wrap/.test(memo[1]), '메모가 잘린다(결정 3)');
  assert.ok(/aria-hidden="true">\$\{inner\}<\/svg>/.test(extractFunction(app, 'svgIc')), '메타 줄 그림(svgIc)이 aria-hidden 이 아니다');
  assert.ok(/\n\.card \.cat-tag\{color:color-mix\(in srgb,var\(--c\) var\(--tag-mix\),var\(--text\)\)\}/.test(css), '꼬리표 글자가 과제 색과 본문 글자색 섞음(토큰)이 아니다');
});
test('(S) 꼬리표 대비: 테마 다섯(light, dark, forest, sepia, contrast)마다 어떤 과제 색이든 꼬리표 글자와 바탕이 4.5:1 이상', () => {
  const r = tagContrast(app);
  assert.deepStrictEqual(Object.keys(r), ['light', 'dark', 'forest', 'sepia', 'contrast']);
  checkContrast(app);
  console.log('      꼬리표 대비(최소, 팔레트 최소, 섞는 몫): ' + Object.entries(r).map(([k, v]) => `${k} ${v.min}/${v.palette}/${v.mix}`).join(', '));
});
test('(S) 새 함수와 CSS: 금지 기호 없음, hex 색 없음(토큰만)', () => {
  const fns = ['dpFoldSet', 'dpFoldSave', 'dpSync', 'dpLimit', 'dpMoreHtml', 'cardHtml', 'dpTdDetHtml', 'dpDetLn', 'dpReveal', 'dpHeadEl', 'dpHeadGeom', 'dpHeadPlan', 'dpHeadJump', 'dpScrollTo', 'dpMarkStuck', 'dpStuckSoon', 'dpOnClick', 'dayGrpHtml', 'dayDetailHtml'].map((n) => extractFunction(app, n)).join('\n');
  assert.ok(!/[—–「」]/.test(fns) && !/(^|\s)·(\s|$)/m.test(fns), '새 함수에 엠 대시, 낫표, 띄어 쓴 가운데 점이 있다');
  const mine = css.split('\n').filter((l) => /\.dp-(fold|tw|more|det|grp|cards|body)|\.dp-todos \.todo-text|\.cat-tag|^\.card-(top|when|memo|actions|span)/.test(l));
  assert.ok(mine.length >= 14, '새 CSS 규칙을 찾지 못했다: ' + mine.length);
  assert.ok(mine.every((l) => !/#[0-9a-fA-F]{3,8}\b/.test(l)), '새 CSS 에 hex 색이 있다: ' + mine.find((l) => /#[0-9a-fA-F]{3,8}\b/.test(l)));
  assert.ok(/\.dp-todos \.todo-text\{[^}]*-webkit-line-clamp:2[^}]*overflow:hidden/.test(css), '할 일 제목이 두 줄 자르기가 아니다(한 줄 말줄임은 좁은 패널에서 앞머리만 남는다)');
});
test('(S) 머리 누르기 판정(dpHeadPlan): 제자리면 null(접기), 붙어 있으면 그 묶음 처음으로 갈 scrollTop', () => {
  const plan = new Function(extractFunction(app, 'dpHeadPlan') + '; return dpHeadPlan;')();
  //  (scrollTop, 제자리, 보이는 자리, 위에 붙는 머리 높이)
  assert.strictEqual(plan(0, 0, 0, 0), null, '맨 위의 일정 머리는 제자리다');
  assert.strictEqual(plan(240, 0, 0, 0), 0, '위에 붙은 일정 머리는 일정 맨 위(0)로');
  assert.strictEqual(plan(0, 900, 568, 32), 868, '아래에 붙은 할 일 머리는 할 일 처음(일정 머리 밑)으로');
  assert.strictEqual(plan(1000, 900, 32, 32), 868, '위에 붙은 할 일 머리는 할 일 처음으로');
  assert.strictEqual(plan(100, 400, 300, 32), null, '제자리의 할 일 머리는 접는다');
  assert.strictEqual(plan(100, 400, 300.6, 32), null, '1px 안쪽 차이는 제자리다(소수 픽셀)');
  assert.strictEqual(plan(20, 10, 32, 32), 0, '이동 값은 0 아래로 가지 않는다');
});

// ══════════════════════════════════════════════════════════════════════
// (R) 런타임(jsdom)
// ══════════════════════════════════════════════════════════════════════
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;

if (!JSDOM) {
  skip('day-panel-fold: jsdom 미설치로 런타임 검증을 건너뜁니다', SKIP_NO_JSDOM,
    `이 파일의 test 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았습니다.`);
} else {
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const FOLD_KEY = 'tc_dpfold:7';
  function bootWindow(src, pre) {
    const { window: w } = new JSDOM(src || app, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/',
      beforeParse(window) {
        window.chrome = { webview: { postMessage() {}, addEventListener() {}, removeEventListener() {} } };
        if (typeof window.crypto === 'undefined') window.crypto = { randomUUID: () => 'u-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        window.scrollTo = () => {};
        window.HTMLElement.prototype.scrollIntoView = function () {};
        if (!window.CSS) window.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
        if (pre) pre(window);
      },
    });
    const doc = w.document;
    return { w, doc, ev: (code) => w.eval(code), $: (s) => doc.querySelector(s), $$: (s) => [...doc.querySelectorAll(s)], close: () => { try { w.close(); } catch (_) {} } };
  }
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const later = () => new Promise((r) => setTimeout(r, 180));
  const CAT = (id, name) => ({ id, name, color: '#3e5be0', desc: '', createdAt: '2026-09-01T00:00:00Z' });
  const ENT = (id, date, o) => Object.assign({ id, date, title: '일정 ' + id, categoryId: 'c-a', allDay: false, startTime: '', endTime: '', endDate: '', memo: '', location: '', recur: null, recurExcept: [] }, o || {});
  const TODO = (id, due, o) => Object.assign({ id, text: '할 일 ' + id, done: false, categoryId: 'c-a', due, endDate: '', prio: 'normal', completedAt: '', note: '', dayNotes: {}, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }, o || {});
  const MEMO = '첫 줄 안건\n둘째 줄 https://example.com/alpha 참고\n셋째 줄\n넷째 줄\n다섯째 줄 끝';
  //  T = 오늘: 일정 8건(넣는 차례는 뒤죽박죽, 종일 하나, 시각 08:00 ~ 14:00), 할 일 7건(하나는 끝냄). D2 = 같은 달 다른 날: 일정 3건, 할 일 2건(보통 날)
  function data(T, D2) {
    const LONG = '아주 긴 할 일 제목 '.repeat(8).trim();
    const timed = [1, 2, 3, 4, 5, 6, 7].map((i) => ENT('e' + i, T, { startTime: String(7 + i).padStart(2, '0') + ':00', endTime: String(8 + i).padStart(2, '0') + ':00', location: '회의실 ' + i, createdAt: '2026-09-0' + (9 - i) + 'T00:00:00Z' }));
    timed[0].memo = MEMO;
    timed[1].recur = { freq: 'weekly', interval: 1, until: '', count: 0 };
    Object.assign(timed[2], { date: ymdAdd(T, -1), endDate: ymdAdd(T, 1) });
    return {
      categories: [CAT('c-a', '알파')],
      entries: [...timed.reverse(), ENT('e0', T, { allDay: true, title: '종일 일정' }),
        ENT('f1', D2, { startTime: '09:00' }), ENT('f2', D2, { startTime: '10:00' }), ENT('f3', D2, { startTime: '11:00' })],
      todos: [...[1, 2, 3, 4, 5, 6].map((i) => TODO('t' + i, T, i === 2 ? { done: true, completedAt: '2026-09-02T00:00:00Z' } : null)), TODO('t7', T, { text: LONG }), TODO('u1', D2), TODO('u2', D2)],
      taskHours: {}, attendance: {},
    };
  }
  async function boot(src, pre) {
    const W = bootWindow(src, pre);
    await settle();
    const T = W.ev('todayYmd()'), dom = Number(T.slice(8)), D2 = ymdAdd(T, dom <= 20 ? 2 : -2);
    W.T = T; W.D2 = D2;
    W.w.__applyState(JSON.stringify(data(T, D2)), META);
    W.ev(`view = {y: ${Number(T.slice(0, 4))}, m: ${Number(T.slice(5, 7)) - 1}}; selectedDate = "${T}"; setCalView("month"); renderAll();`);
    await settle();
    return W;
  }
  const end = async (W) => { try { W.ev("closeModal('#quickAdd'); closeModal('#confirmModal')"); } catch (_) {} await later(); W.close(); };
  const evRows = (W) => W.$$('#dpBody .dp-grp[data-grp="ev"] .card').map((r) => r.dataset.id);
  const tdRows = (W) => W.$$('#dpBody .dp-grp[data-grp="td"] .todo-row').map((r) => r.dataset.id);
  const more = (W, k) => W.$(`#dpBody .dp-more[data-k="${k}"]`);
  const head = (W, k) => W.$(`#dpBody [data-dp="fold"][data-k="${k}"]`);
  const pick = (W, ds) => { W.ev(`selectedDate = "${ds}"; renderAll();`); };
  //  jsdom 은 배치를 모른다. 본문 scrollTop, scrollTo, 머리와 더 보기 단추의 자리를 __G 로 흉내 낸다(머리는 position static 이면 제자리, 아니면 보이는 자리)
  function geo(W) {
    W.ev(`(function(){
      var G = window.__G = { st: 0, bodyTop: 100, h: 32, ev: { cur: 0, nat: 0 }, td: { cur: 300, nat: 300 }, more: null, to: null, after: null };
      var body = document.getElementById('dpBody');
      Object.defineProperty(body, 'scrollTop', { configurable: true, get: function(){ return G.st; }, set: function(v){ G.st = v; } });
      body.scrollTo = function(o){ G.to = o.top; };
      Element.prototype.getBoundingClientRect = function(){
        var t = 0, h = 0;
        if(this === body) t = G.bodyTop;
        else if(this.classList.contains('dp-grp-h')){ var g = G[this.parentElement.dataset.grp]; h = G.h; t = G.bodyTop + (this.style.position === 'static' ? g.nat - G.st : g.cur); }
        else if(this.classList.contains('dp-more') && G.more) t = G.bodyTop + G.more(this);
        return { top: t, bottom: t + h, left: 0, right: 0, width: 0, height: h, x: 0, y: t, toJSON: function(){ return {}; } };
      };
      var rp = window.renderPanel;
      window.renderPanel = function(){ rp(); if(G.after){ var f = G.after; G.after = null; f(); } };
    })()`);
  }
  const G = (W) => JSON.parse(W.ev('JSON.stringify({ st: __G.st, to: __G.to })'));

  const checks = {
    //  5개 제한(종일 먼저, 시각순), 더 보기와 줄이기, 날짜를 바꾸면 다시 5개, 보통 날은 더 보기 없음
    async limit(src) {
      const W = await boot(src);
      try {
        assert.deepStrictEqual(W.$$('#dpBody > .dp-grp').map((g) => g.dataset.grp), ['ev', 'td'], '두 묶음 고정이 깨졌다');
        assert.deepStrictEqual(evRows(W), ['e0', 'e1', 'e2', 'e3', 'e4'], '일정이 종일 먼저, 시각순으로 5개까지가 아니다(넣은 차례와 무관)');
        assert.strictEqual(tdRows(W).length, 5, '할 일이 5개까지만 보이지 않는다');
        assert.strictEqual(more(W, 'ev').textContent, '3개 더 보기');
        assert.strictEqual(more(W, 'td').textContent, '2개 더 보기');
        assert.ok(/일정\s*8/.test(W.$('#dpBody .dp-grp[data-grp="ev"] .dp-grp-h').textContent), '묶음 머리 수는 전체 수여야 한다');
        more(W, 'ev').click();
        assert.deepStrictEqual(evRows(W), ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'], '더 보기가 다 펼치지 않았거나 차례가 틀렸다');
        assert.strictEqual(more(W, 'ev').textContent, '줄이기');
        assert.strictEqual(W.doc.activeElement, more(W, 'ev'), '더 보기 뒤 포커스가 줄이기 단추가 아니다');
        assert.strictEqual(tdRows(W).length, 5, '일정 더 보기가 할 일까지 펼쳤다');
        more(W, 'ev').click();
        assert.strictEqual(evRows(W).length, 5, '줄이기가 5개로 돌아가지 않았다');
        more(W, 'ev').click(); more(W, 'td').click();
        assert.strictEqual(tdRows(W).length, 7);
        //  날짜를 바꾸면 처음으로(보통 날: 더 보기 없음)
        pick(W, W.D2);
        assert.strictEqual(evRows(W).length, 3); assert.strictEqual(tdRows(W).length, 2);
        assert.ok(!W.$('#dpBody .dp-more'), '5개 이하인 보통 날에 더 보기가 있다');
        pick(W, W.T);
        assert.strictEqual(evRows(W).length, 5, '날짜를 바꿨다 돌아왔는데 더 보기가 남았다');
        assert.strictEqual(tdRows(W).length, 5);
      } finally { await end(W); }
    },
    //  할 일 머리 숫자는 남은 개수/전체(결정 8), 일정 머리는 개수 그대로
    async count(src) {
      const W = await boot(src);
      try {
        const h = W.$('#dpBody .dp-grp[data-grp="td"] .dp-grp-n');
        assert.strictEqual(h.textContent, '6/7', '할 일 머리가 남은 개수/전체가 아니다');
        assert.strictEqual(h.getAttribute('title'), '남은 할 일 6개, 전체 7개');
        assert.strictEqual(W.$('#dpBody .dp-grp[data-grp="ev"] .dp-grp-n').textContent, '8', '일정 머리는 개수 그대로여야 한다');
        W.$('#dpBody .todo-row[data-id="t1"] [data-act="toggle"]').click();
        assert.strictEqual(W.$('#dpBody .dp-grp[data-grp="td"] .dp-grp-n').textContent, '5/7', '끝내도 남은 개수가 줄지 않는다');
      } finally { await end(W); }
    },
    //  카드 내용(결정 1~4): 꼬리표, 제목, 시각과 장소, 기간 n일째, 반복, 메모 전부와 링크, [수정] [삭제]
    async cards(src) {
      const W = await boot(src);
      try {
        assert.ok(!W.$('#dpBody .dp-er, #dpBody .dp-edet'), '한 줄 일정이나 줄 펼침 상세가 남았다');
        const c1 = W.$('#dpBody .card[data-id="e1"]');
        assert.ok(c1 && /--c:#3e5be0/.test(c1.getAttribute('style')), '카드에 과제 색(--c)이 없다');
        const tag = c1.querySelector('.card-top .badge.cat-tag');
        assert.ok(tag && tag.textContent === '알파' && /background:rgba\(62,91,224,0\.13\)/.test(tag.getAttribute('style').replace(/\s/g, '')) && !/(^|;)\s*color:/.test(tag.getAttribute('style')), '과제 꼬리표(옅은 바탕, 글자색은 CSS)가 아니다');
        assert.strictEqual(c1.querySelector('.card-title').textContent, '일정 e1');
        const when = c1.querySelector('.card-when');
        assert.ok(/08:00~09:00/.test(when.textContent) && /회의실 1/.test(when.textContent), '시각과 장소 줄이 아니다: ' + when.textContent);
        assert.ok([...when.querySelectorAll('svg')].every((s) => s.getAttribute('aria-hidden') === 'true'), '메타 줄 그림이 읽힌다');
        const memo = c1.querySelector('.card-memo');
        assert.strictEqual(memo.textContent, MEMO, '메모가 전부가 아니다(결정 3)');
        assert.ok(memo.querySelector('a.memo-link'), '메모의 주소가 링크가 아니다');
        assert.deepStrictEqual([...c1.querySelectorAll('.card-actions [data-act]')].map((b) => [b.dataset.act, b.textContent]), [['edit', '수정'], ['del', '삭제']], '카드 끝 [수정] [삭제]가 없다');
        const f = (d) => { const x = new Date(d + 'T00:00:00'); return (x.getMonth() + 1) + '/' + x.getDate(); };
        assert.strictEqual(W.$('#dpBody .card[data-id="e3"] .card-span').textContent.trim(), `${f(ymdAdd(W.T, -1))} ~ ${f(ymdAdd(W.T, 1))} (2일째 / 3일)`, '여러 날 기간 줄이 아니다');
        assert.ok(/매주/.test(W.$('#dpBody .card[data-id="e2"] .card-recur').textContent), '반복 줄이 없다');
        assert.ok(/종일/.test(W.$('#dpBody .card[data-id="e0"] .card-when').textContent), '종일 일정의 시각 줄이 종일이 아니다');
        assert.ok(!W.$('#dpBody .card[data-id="e4"] .card-memo') && !W.$('#dpBody .card[data-id="e4"] .card-span') && !W.$('#dpBody .card[data-id="e4"] .card-recur'), '없는 줄이 그려졌다');
        //  [수정]은 일정 수정 창(openQuickAdd)
        W.$('#dpBody .card[data-id="e1"] [data-act="edit"]').click();
        await settle();
        assert.ok(!W.$('#quickAdd').classList.contains('hidden') && W.$('#qaEditTitle').textContent === '일정 수정' && W.$('#qaTitle').value === '일정 e1', '카드 [수정]이 일정 수정 창을 열지 않았다');
        W.ev("closeModal('#quickAdd')"); await later();
        //  반복 일정 [삭제]는 반복 확인 창(이 날짜만 / 전체), 이 날짜만이면 그날 카드가 빠진다
        W.$('#dpBody .card[data-id="e2"] [data-act="del"]').click();
        await settle();
        assert.ok(!W.$('#confirmModal').classList.contains('hidden') && W.$('#cfTitle').textContent === '반복 일정 삭제', '반복 일정 [삭제]가 반복 확인 창을 열지 않았다');
        W.$('#cfOk').click();
        await later();
        assert.ok(W.ev('entryById("e2").recurExcept').includes(W.T) && !W.$('#dpBody .card[data-id="e2"]'), '이 날짜만 삭제가 그날 반복을 건너뛰지 않았다');
      } finally { await end(W); }
    },
    //  머리 누르기 세 경우와 제자리 접기(결정 6), 붙은 머리의 읽히는 이름과 그림자
    async heads(src) {
      const W = await boot(src);
      try {
        geo(W);
        const set = (code) => W.ev(code + '; dpMarkStuck();');
        //  위에 붙은 일정 머리 = 일정 맨 위로(접지 않음)
        set('__G.st = 240; __G.ev = { cur: 0, nat: 0 }; __G.td = { cur: 600, nat: 900 }');
        assert.strictEqual(head(W, 'ev').getAttribute('aria-label'), '일정 맨 위로', '위에 붙은 일정 머리의 읽히는 이름');
        assert.ok(!W.$('#dpBody .dp-grp[data-grp="ev"] > .dp-grp-h').classList.contains('stuck'), '위에 붙은 머리에 아래 그림자가 생겼다');
        head(W, 'ev').click();
        assert.strictEqual(G(W).to, 0, '위에 붙은 일정 머리가 일정 맨 위로 가지 않았다');
        assert.strictEqual(head(W, 'ev').getAttribute('aria-expanded'), 'true', '붙은 일정 머리를 누르자 접혔다');
        //  아래에 붙은 할 일 머리 = 할 일 처음으로(일정 머리 밑)
        W.ev('__G.to = null'); set('__G.st = 0; __G.td = { cur: 568, nat: 900 }');
        assert.ok(W.$('#dpBody .dp-grp[data-grp="td"] > .dp-grp-h').classList.contains('stuck'), '아래에 붙은 할 일 머리에 그림자(.stuck)가 없다');
        assert.strictEqual(head(W, 'td').getAttribute('aria-label'), '할 일로 이동');
        assert.ok(!head(W, 'ev').hasAttribute('aria-label'), '제자리의 일정 머리에 이동 이름이 남았다');
        head(W, 'td').click();
        assert.strictEqual(G(W).to, 868, '아래에 붙은 할 일 머리가 할 일 처음으로 가지 않았다');
        assert.strictEqual(head(W, 'td').getAttribute('aria-expanded'), 'true', '붙은 할 일 머리를 누르자 접혔다');
        //  위에 붙은 할 일 머리 = 할 일 처음으로
        W.ev('__G.to = null'); set('__G.st = 1200; __G.td = { cur: 32, nat: 900 }');
        assert.ok(!W.$('#dpBody .dp-grp[data-grp="td"] > .dp-grp-h').classList.contains('stuck'), '위에 붙은 할 일 머리에 아래 그림자가 남았다');
        assert.strictEqual(head(W, 'td').getAttribute('aria-label'), '할 일로 이동');
        head(W, 'td').click();
        assert.strictEqual(G(W).to, 868, '위에 붙은 할 일 머리가 할 일 처음으로 가지 않았다');
        assert.strictEqual(W.w.localStorage.getItem(FOLD_KEY), null, '붙은 머리를 누르자 접기를 기억했다');
        //  제자리의 할 일 머리 = 접는다
        W.ev('__G.to = null'); set('__G.st = 0; __G.td = { cur: 300, nat: 300 }');
        assert.ok(!head(W, 'td').hasAttribute('aria-label'), '제자리의 할 일 머리에 이동 이름이 남았다');
        head(W, 'td').click();
        assert.strictEqual(G(W).to, null, '제자리 머리를 눌렀는데 스크롤했다');
        assert.strictEqual(head(W, 'td').getAttribute('aria-expanded'), 'false', '제자리의 할 일 머리를 누르자 접히지 않았다');
        assert.strictEqual(W.w.localStorage.getItem(FOLD_KEY), '["td"]');
      } finally { await end(W); }
    },
    //  접기와 줄이기 뒤 출렁임 없음(결정 7): 누른 머리, 줄이기면 그 자리에 다시 서는 더 보기가 본문의 같은 높이에 남는다
    async steady(src) {
      const W = await boot(src);
      try {
        geo(W);
        //  제자리 할 일 머리(보이는 자리 180)를 접자 위 내용이 30 줄어든 자리(270)에 다시 섰다 = scrollTop 을 30 줄여 180 에 둔다
        W.ev('__G.st = 120; __G.td = { cur: 180, nat: 300 }; __G.after = function(){ __G.td = { cur: 150, nat: 270 }; }');
        head(W, 'td').click();
        assert.strictEqual(head(W, 'td').getAttribute('aria-expanded'), 'false');
        assert.strictEqual(G(W).st, 90, '접은 뒤 누른 머리가 같은 자리에 있지 않다(출렁임)');
        assert.strictEqual(W.doc.activeElement, head(W, 'td'), '접은 뒤 포커스가 머리 단추가 아니다');
        //  일정 줄이기: 줄이기(보이는 자리 500)를 누르자 더 보기가 200 에 섰다 = scrollTop 을 300 줄인다
        more(W, 'ev').click();
        W.ev('__G.st = 400; __G.more = function(el){ return el.dataset.dp === "less" ? 500 : 200; }');
        more(W, 'ev').click();
        assert.strictEqual(more(W, 'ev').textContent, '3개 더 보기');
        assert.strictEqual(G(W).st, 100, '줄이기 뒤 누른 자리가 튀었다(출렁임)');
        //  더 보기는 맞추지 않는다(누른 자리 아래로 카드가 늘 뿐)
        W.ev('__G.st = 100; __G.more = function(el){ return el.dataset.dp === "less" ? 900 : 200; }');
        more(W, 'ev').click();
        assert.strictEqual(G(W).st, 100, '더 보기가 스크롤을 옮겼다');
      } finally { await end(W); }
    },
    //  접기와 기억
    async fold(src) {
      const W = await boot(src);
      try {
        assert.strictEqual(head(W, 'ev').getAttribute('aria-expanded'), 'true');
        assert.ok(/▾/.test(head(W, 'ev').textContent));
        head(W, 'ev').click();
        assert.strictEqual(head(W, 'ev').getAttribute('aria-expanded'), 'false');
        assert.ok(/▸/.test(head(W, 'ev').textContent) && /일정\s*8/.test(head(W, 'ev').textContent), '접어도 머리(▸ 일정 n)는 남아야 한다');
        assert.strictEqual(W.$$('#dpBody .dp-grp[data-grp="ev"] .card, #dpBody .dp-grp[data-grp="ev"] .dp-more').length, 0, '접었는데 카드가 보인다');
        assert.strictEqual(tdRows(W).length, 5, '일정을 접었는데 할 일 묶음이 바뀌었다');
        assert.strictEqual(W.doc.activeElement, head(W, 'ev'), '접은 뒤 포커스가 머리 단추가 아니다');
        assert.strictEqual(W.w.localStorage.getItem(FOLD_KEY), '["ev"]', '접은 상태를 계정별로 기억하지 않는다');
        //  날짜를 바꿔도 접힌 채(기억)
        pick(W, W.D2);
        assert.strictEqual(head(W, 'ev').getAttribute('aria-expanded'), 'false', '날짜를 바꾸자 접기가 풀렸다');
        head(W, 'ev').click();
        assert.strictEqual(W.w.localStorage.getItem(FOLD_KEY), null, '다 펴면 기억을 지워야 한다');
      } finally { await end(W); }
      //  다시 띄워도 접힌 채(같은 계정)
      const W2 = await boot(src, (w) => { w.localStorage.setItem(FOLD_KEY, '["td"]'); });
      try {
        assert.strictEqual(W2.$('#dpBody [data-dp="fold"][data-k="td"]').getAttribute('aria-expanded'), 'false', '기억한 접기를 되살리지 않았다');
        assert.strictEqual(tdRows(W2).length, 0);
        assert.strictEqual(evRows(W2).length, 5);
      } finally { await end(W2); }
    },
    //  달력 칩에서 온 강조: 그 카드를 강조, 5개 밖이면 더 보기를 열고 접힌 묶음은 편다. 할 일도 5개 밖이면 더 보기
    async flash(src) {
      const W = await boot(src, (w) => { w.localStorage.setItem(FOLD_KEY, '["ev"]'); });
      try {
        pick(W, W.D2);
        W.ev(`selectedDate = "${W.T}"; flashTargetId = "e7"; renderAll();`);
        assert.strictEqual(head(W, 'ev').getAttribute('aria-expanded'), 'true', '강조한 일정의 묶음이 접힌 채다');
        assert.strictEqual(evRows(W).length, 8, '5개 밖의 일정을 강조했는데 더 보기가 열리지 않았다');
        assert.deepStrictEqual(W.$$('#dpBody .card.flash').map((c) => c.dataset.id), ['e7'], '강조한 일정 카드만 강조되지 않았다');
        W.ev('flashTodoId = "t7"; renderPanel();');
        assert.strictEqual(tdRows(W).length, 7, '5개 밖의 할 일을 강조했는데 더 보기가 열리지 않았다');
        assert.ok(W.$('#dpBody .todo-row.flash[data-id="t7"]'));
      } finally { await end(W); }
    },
    //  할 일 줄: 지금 줄(체크, ★, ✕) 그대로, 제목 두 줄까지와 전체는 title, 제목을 누르면 들여쓴 상세(§7.1, 인라인 수정 폼 없음)
    async todos(src) {
      const W = await boot(src);
      try {
        more(W, 'td').click();
        const r = W.$('#dpBody .todo-row[data-id="t7"]');
        const t = r.querySelector('.todo-text');
        assert.strictEqual(t.getAttribute('title'), t.textContent, '할 일 제목 전체가 title 에 없다');
        assert.ok(r.querySelector('[data-act="toggle"]') && r.querySelector('[data-act="star"]') && r.querySelector('[data-act="del"]'), '할 일 줄의 체크, ★, ✕ 가 없다');
        assert.strictEqual(t.dataset.dp, 'td', '할 일 제목을 눌러 상세를 펼치지 않는다');
        assert.strictEqual(t.dataset.act, undefined, '할 일 제목이 아직 인라인 수정을 연다');
        t.click();
        assert.ok(W.$('#dpBody .todo-row.open[data-id="t7"] + .dp-tdet') && !W.$('#dpBody .todo-edit'), '제목을 누르면 들여쓴 상세가 펼쳐져야 한다(인라인 수정 폼 없음)');
        W.$('#dpBody .todo-row[data-id="t7"] [data-act="toggle"]').click();
        assert.ok(W.$('#dpBody .todo-row[data-id="t7"]').classList.contains('done'), '체크가 돌지 않는다');
      } finally { await end(W); }
    },
  };

  test('(R) 일정은 종일 먼저, 시각순으로 5개, n개 더 보기와 줄이기, 날짜를 바꾸면 다시 5개, 보통 날은 더 보기 없음', () => checks.limit());
  test('(R) 할 일 머리 숫자는 남은 개수/전체(끝내면 줄어든다), 일정 머리는 개수 그대로', () => checks.count());
  test('(R) 카드: 꼬리표, 제목, 시각과 장소, 기간 n일째, 반복, 메모 전부와 링크, [수정]은 일정 수정 창, 반복 [삭제]는 반복 확인 창', () => checks.cards());
  test('(R) 머리 누르기: 위에 붙은 일정 머리는 맨 위로, 아래에 붙은 할 일 머리와 위에 붙은 할 일 머리는 할 일 처음으로, 제자리면 접는다(읽히는 이름, 그림자)', () => checks.heads());
  test('(R) 접기와 줄이기 뒤 누른 머리와 더 보기가 같은 자리(출렁임 없음), 더 보기는 스크롤을 옮기지 않는다', () => checks.steady());
  test('(R) 묶음 머리를 누르면 접히고(▾ ▸) 계정별로 기억한다, 다시 띄워도 접힌 채', () => checks.fold());
  test('(R) 달력 칩 강조: 그 카드를 강조, 5개 밖이면 더 보기를 열고 접힌 묶음은 편다, 할 일도 같다', () => checks.flash());
  test('(R) 할 일 줄은 체크, ★, ✕ 그대로이고 제목 전체는 title, 제목을 누르면 들여쓴 상세', () => checks.todos());

  // ══════════════════════════════════════════════════════════════════════
  // (M) 변이
  // ══════════════════════════════════════════════════════════════════════
  test('(M) 5개 제한을 빼면 제한 시험이 잡는다', async () => {
    const bad = mutate(app, 'function dpLimit(k, items){ return DP.more.has(k) ? items : items.slice(0, DP_LIMIT); }', 'function dpLimit(k, items){ return items; }');
    await assert.rejects(() => checks.limit(bad));
  });
  test('(M) 날짜를 바꿔도 더 보기를 남기면 제한 시험이 잡는다', async () => {
    const bad = mutate(app, "function dpSync(){ if(DP.date !== selectedDate){ DP.date = selectedDate; DP.more.clear(); DP.open = ''; } }", 'function dpSync(){}');
    await assert.rejects(() => checks.limit(bad));
  });
  test('(M) 접기를 기억하지 않으면 접기 시험이 잡는다', async () => {
    const bad = mutate(app, 'function dpFoldSave(){\n  if(PEER) return;', 'function dpFoldSave(){\n  return;');
    await assert.rejects(() => checks.fold(bad));
  });
  test('(M) 강조가 더 보기를 열지 않으면 강조 시험이 잡는다', async () => {
    const bad = mutate(app, '      if(sub.indexOf(e) >= DP_LIMIT) DP.more.add(k);\n', '');
    await assert.rejects(() => checks.flash(bad));
  });
  test('(M) 붙은 머리도 접게(이동 없음) 되돌리면 머리 누르기 시험이 잡는다', async () => {
    const bad = mutate(app, '  if(Math.abs((nat - st) - cur) <= 1) return null;', '  return null;');
    await assert.rejects(() => checks.heads(bad), /일정 맨 위로|할 일 처음으로/);
  });
  test('(M) 접기와 줄이기 뒤 스크롤 맞춤을 빼면 출렁임 시험이 잡는다', async () => {
    const bad = mutate(app, '  if(keep){ const el = document.querySelector(\'#dpBody \' + keep.sel); if(el){ body.scrollTop += at(el) - keep.before; dpMarkStuck(); } }', '');
    await assert.rejects(() => checks.steady(bad), /출렁임/);
  });
  test('(M) 할 일 머리를 전체 개수로 되돌리면 개수 시험이 잡는다', async () => {
    const bad = mutate(app, 'tdInner, tds.length ? `${left}/${tds.length}` : null,', 'tdInner, null,');
    await assert.rejects(() => checks.count(bad), /남은 개수/);
  });
  test('(M) 카드 메모를 자르면(한 줄) 카드 시험이 잡는다', async () => {
    const bad = mutate(app, "    + (e.memo ? `<div class=\"card-memo\">${linkifyHtml(e.memo)}</div>` : '')", "    + (e.memo ? `<div class=\"card-memo\">${linkifyHtml(e.memo.split('\\n')[0])}</div>` : '')");
    await assert.rejects(() => checks.cards(bad), /메모가 전부/);
  });
  test('(M) 꼬리표 섞는 몫을 과제 색 쪽으로 올리거나 어두운 테마도 검정 쪽으로 섞으면 대비 시험이 잡는다', () => {
    assert.throws(() => checkContrast(mutate(app, '  --tag-mix:35%;', '  --tag-mix:70%;')), /4\.5:1 미만/);
    assert.throws(() => checkContrast(mutate(app, '--ovl-dot:#a8720a; --tag-mix:25%; }', '--ovl-dot:#a8720a; --tag-mix:45%; }')), /sepia/);
    assert.throws(() => checkContrast(mutate(app, '  --text:#e6e9f2;', '  --text:#1d2433;')), /dark/);
  });
}
