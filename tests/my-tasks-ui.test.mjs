// 내 과제 창 목록 정리(2026-10-30)의 웹 쪽 계약. 확정 시안: dist/proto/my-tasks-list.html 제안 B.
//
//   (a) 정적: 머리 = 제목과 SVG ✕ 뿐(부제, 추가 단추 없음) · 관리 입구 줄과 푸터 없음 · 열 머리글 과제, 기록 ·
//       한 상자 목록(테두리 하나, 줄 사이 1px 가로선) · 공식 표 토큰 · 0 은 흐린 색 · 아래 점선 [+ 과제 추가] 는 sticky ·
//       금지 문장부호(엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점) · 새 hex 없음.
//   (b) jsdom 런타임: 공식 줄에만 「공식」 표 · 기록 수는 숫자만(0 은 zero 클래스, title) · 아래 단추가 과제 추가 창을 연다 ·
//       일반 줄 ⋯ 메뉴에 「공식 과제로 연결…」이 있고 누르면 연결 창이 열린다.
//   (c) 변이: 표를 모든 줄에 붙이거나, 푸터를 되살리거나, 단추 sticky 를 지우면 같은 검사가 실패한다.
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}
function modalBlock(app) {
  const i = app.indexOf('<div class="overlay hidden" id="categoryModal">');
  assert.ok(i > 0, '#categoryModal 마크업이 없다');
  return app.slice(i, app.indexOf('<!-- ===== 다른 과제와 합치기', i));
}
const noHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
let css = '';
const useCss = (app) => { css = app.slice(0, app.indexOf('</style>')); };
const rule = (sel) => {
  const i = css.indexOf('\n' + sel + '{');
  assert.ok(i >= 0, `CSS 규칙 ${sel} 이 없다`);
  return css.slice(i, css.indexOf('}', i) + 1);
};

const statics = {
  header(app) {
    useCss(app);
    const m = modalBlock(app), body = noHtmlComments(m);
    const head = body.slice(body.indexOf('<div class="modal-head">'), body.indexOf('<div class="modal-body">'));
    assert.ok(/<h2>🏷️ 내 과제<\/h2>/.test(head), '제목이 없다');
    assert.ok(!/cat-sub|내 캘린더에서 쓰는 과제|btnCatAdd|과제 추가|cat-head-act|cat-title/.test(head), '머리에 부제나 추가 단추가 남았다');
    assert.strictEqual((head.match(/<button/g) || []).length, 1, '머리의 단추가 ✕ 하나가 아니다');
    const x = head.match(/<button[^>]*data-close[^>]*>[\s\S]*?<\/button>/);
    assert.ok(x, '닫기 단추(data-close)가 없다');
    assert.ok(/aria-label="닫기"/.test(x[0]), '닫기 단추에 aria-label 이 없다');
    assert.ok(/<svg[^>]*>[\s\S]*<path[^>]*stroke-width="1\.6"[^>]*stroke-linecap="round"/.test(x[0]) && !/×/.test(x[0]), '닫기가 SVG ✕(선 1.6, 둥근 끝)가 아니다');
    const r = rule('.cat-x');
    assert.ok(/width:32px;height:32px/.test(r) && /border-radius:var\(--r-sm\)/.test(r) && /background:transparent/.test(r) && /color:var\(--muted\)/.test(r), '.cat-x 가 32px 투명 아이콘 단추가 아니다');
    assert.ok(/\.cat-x:hover\{background:var\(--hover-bg\);color:var\(--text\)\}/.test(css), '.cat-x 호버가 다르다');
    assert.ok(/\.cat-x:focus-visible\{outline:2px solid var\(--accent\)/.test(css), '.cat-x 포커스 고리가 없다');
    assert.ok(/\.cat-x svg\{width:16px;height:16px\}/.test(css), '✕ 아이콘 크기가 16px 이 아니다');
  },
  noAdminNoFoot(app) {
    const m = modalBlock(app);
    assert.ok(!/catAdminRow|btnCatAdmin|cat-admin-row/.test(app), '관리 입구 줄(catAdminRow, btnCatAdmin)이 남았다');
    assert.ok(!/id="btnRelinkOpen"/.test(app), '하단 [공식 과제로 연결] 이 남았다');
    assert.ok(!m.includes('modal-foot'), '내 과제 창에 푸터가 남았다');
    assert.ok(!/ch-kind|cat-kind/.test(app), '구분 열(ch-kind, cat-kind)이 남았다');
  },
  list(app) {
    useCss(app);
    const m = modalBlock(app);
    assert.ok(/id="catHead"[^>]*>(?:(?!<\/div>)[\s\S])*<span>과제<\/span><span class="ch-tag"><\/span><span class="ch-count">일정<\/span><span class="ch-count">할 일<\/span><span><\/span><\/div>/.test(m), '열 머리글이 과제, (공식 표시 칸, 글자 없음), 일정, 할 일, 빈 칸이 아니다(docs/CAT-COUNTS-SPLIT.md)');
    //  공식, 삭제됨 표시는 이름 뒤가 아니라 고정 칸(.cat-tagcol)에 선다(이름 길이와 상관없이 같은 세로줄, 2026-11-02)
    assert.ok(app.includes('<span class="cat-tagcol">${tag}</span>') && !app.includes('title="${nm}">${nm}</span>${tag}'), '공식 표시가 고정 칸이 아니라 이름 뒤에 붙는다');
    assert.ok(!/건수/.test(noHtmlComments(m)), '「건수」가 남았다');
    const wrap = rule('.cat-wrap');
    assert.ok(/border:1px solid var\(--line\)/.test(wrap) && /border-radius:var\(--r-md\)/.test(wrap) && /container-type:inline-size/.test(wrap), '목록 상자(.cat-wrap)가 테두리 하나, 둥근 모서리, container 가 아니다');
    const head = rule('.cat-head');
    assert.ok(/height:38px/.test(head) && /background:var\(--bg\)/.test(head) && /font-weight:600/.test(head) && /color:var\(--muted\)/.test(head) && /font-size:var\(--fs-meta\)/.test(head), '열 머리글 모양이 다르다');
    assert.ok(/\.cat-row \+ \.cat-row\{border-top:1px solid var\(--line\)\}/.test(css), '줄 사이 1px 가로선이 없다');
    const row = rule('.cat-row');
    assert.ok(/min-height:40px/.test(row) && !/margin-bottom|border:1px/.test(row) && !/background:var\(--panel\)/.test(row), '줄에 카드 테두리, 여백이 남았거나 높이가 40px 이 아니다');
    assert.ok(/\.cat-row:hover\{background:var\(--hover-bg\)\}/.test(css), '줄 호버 배경이 없다');
    assert.ok(/\.cat-desc\{[^}]*color:var\(--muted\)/.test(css), '메모 줄이 muted 가 아니다');
    const tag = rule('.cat-tag');
    assert.ok(/font-size:var\(--fs-micro\)/.test(tag) && /color:var\(--accent-2\)/.test(tag) && /background:var\(--accent-soft\)/.test(tag) && /border-radius:4px/.test(tag) && /padding:0 5px/.test(tag) && /font-weight:600/.test(tag), '공식 표 모양이 다르다');
    const cnt = rule('.cat-count');
    assert.ok(/tabular-nums/.test(cnt) && /text-align:right/.test(cnt), '기록 수가 오른쪽 맞춤 tabular-nums 가 아니다');
    assert.ok(/\.cat-count\.zero\{color:var\(--faint-text\)\}/.test(css), '0 을 흐리게 하는 규칙이 없다');
    assert.ok(!/#b0612a/i.test(css), '갈색이 남았다');
    const fn = app.slice(app.indexOf('function catRowHtml(c){'), app.indexOf('//  숫자 문구 뒤 조사'));
    assert.ok(/kind === 'official' \? `<span class="cat-tag">/.test(fn), '공식 표가 공식 줄에만 붙지 않는다');
    //  두 칸(일정, 할 일), 칸마다 0 은 흐림, title 은 catUsageTip("과제명, 일정 N개, 할 일 N개") 하나(docs/CAT-COUNTS-SPLIT.md)
    assert.ok(fn.includes('<span class="cat-count${u.ev ? \'\' : \' zero\'}" title="${esc(catUsageTip(c.name, u))}">${u.ev}</span>')
      && fn.includes('<span class="cat-count${u.td ? \'\' : \' zero\'}" title="${esc(catUsageTip(c.name, u))}">${u.td}</span>') && !/\}건/.test(fn), '기록 수가 일정, 할 일 두 칸(catUsageTip title)이 아니거나 「건」이 붙었다');
    assert.ok(app.includes("const catUsageTip = (name, v) => name + ', 일정 ' + v.ev + '개, 할 일 ' + v.td + '개';"), '숫자 title 문구가 "과제명, 일정 N개, 할 일 N개" 가 아니다');
    assert.ok(/\.cat-head,\.cat-row\{display:grid;grid-template-columns:16px 12px minmax\(0,1fr\) 3\.8em var\(--cnt-w\) var\(--cnt-w\) 30px;/.test(css), '목록 칸이 숫자 두 칸(--cnt-w 둘) 격자가 아니다');
  },
  addButton(app) {
    useCss(app);
    const m = modalBlock(app);
    const body = m.slice(m.indexOf('<div class="modal-body">'));
    assert.ok(body.indexOf('id="catWrap"') < body.indexOf('id="btnCatAdd"'), '[+ 과제 추가] 가 목록 아래에 있지 않다');
    assert.ok(/<button type="button" class="cat-add" id="btnCatAdd"><span class="cat-plus" aria-hidden="true">\+<\/span>과제 추가<\/button>/.test(m), '[+ 과제 추가] 마크업이 다르다');
    const r = rule('.cat-add');
    assert.ok(/position:sticky;bottom:0/.test(r), '[+ 과제 추가] 가 sticky bottom:0 이 아니다(스크롤돼도 보여야 한다)');
    assert.ok(/width:100%/.test(r) && /height:42px/.test(r) && /margin-top:10px/.test(r) && /border:1\.5px dashed var\(--accent\)/.test(r) && /border-radius:var\(--r-md\)/.test(r)
      && /background:var\(--panel\)/.test(r) && /color:var\(--accent-2\)/.test(r) && /font-weight:700/.test(r) && /box-shadow:0 -10px 12px -8px var\(--panel\)/.test(r), '[+ 과제 추가] 모양이 다르다');
    assert.ok(/\.cat-add:hover\{background:var\(--accent-soft\);border-style:solid\}/.test(css), '호버(연한 바탕, 실선)가 없다');
    assert.ok(/\.cat-add:focus-visible\{outline:2px solid var\(--accent\)/.test(css), '포커스 고리가 없다');
    assert.ok(/\.cat-plus\{[^}]*width:20px;height:20px;border-radius:50%;background:var\(--accent\);color:var\(--on-accent\)/.test(css), '+ 동그라미가 다르다');
    assert.ok(/\.modal-body\{[^}]*overflow-y:auto/.test(css), '스크롤하는 쪽이 .modal-body 가 아니다 — sticky 의 기준이 바뀌었다');
  },
  punct(app) {
    useCss(app);
    const m = noHtmlComments(modalBlock(app));
    const fn = app.slice(app.indexOf('function catRowHtml(c){'), app.indexOf('//  숫자 문구 뒤 조사'));
    const blk = css.slice(css.indexOf('category modal (내 과제'), css.indexOf('과제 수정 창(#catEditModal'));
    const PUNCT = [[/—/, '엠 대시'], [/–/, 'en 대시'], [/「|」/, '낫표'], [/(^|\s)·|·(\s|$)/, '띄어 쓴 가운데 점']];
    for (const [name, t] of [['마크업', m], ['catRowHtml', fn.replace(/\/\/[^\n]*/g, '')], ['CSS 주석 제외', blk.replace(/\/\*[\s\S]*?\*\//g, '')]])
      for (const [re, what] of PUNCT) assert.ok(!re.test(t), `${name} 에 ${what} 가 있다`);
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(blk.replace(/\/\*[\s\S]*?\*\//g, '')), '내 과제 CSS 에 hex 색이 있다(토큰만)');
  },
};

test('정적①: 머리는 제목과 SVG ✕ 뿐(부제, 추가 단추 없음) · ✕ 모양', () => statics.header(src));
test('정적②: 관리 입구 줄, 푸터, 연결 단추, 구분 열이 없다', () => statics.noAdminNoFoot(src));
test('정적③: 한 상자 목록 · 열 머리글(과제, 일정, 할 일) · 공식 표와 기록 수 모양', () => statics.list(src));
test('정적④: [+ 과제 추가] 는 목록 아래 점선 단추이고 sticky 로 아래에 붙는다', () => statics.addButton(src));
test('정적⑤: 새 문구와 CSS 에 금지 문장부호와 hex 가 없다', () => statics.punct(src));
test('변이①s: 표를 모든 줄에 붙이면 정적③ 이 실패한다', () => {
  const bad = mutate("(kind === 'official' ? `<span class=\"cat-tag\">${CAT_KIND_LABEL.official}</span>` : '')", "`<span class=\"cat-tag\">${CAT_KIND_LABEL[kind]}</span>`", src);
  assert.throws(() => statics.list(bad), /공식 줄에만/);
});
test('변이②s: 푸터를 되살리면 정적② 가 실패한다', () => {
  const bad = mutate('<div id="catList" role="list" aria-label="내 과제 목록"></div>', '<div id="catList" role="list" aria-label="내 과제 목록"></div><div class="modal-foot"><button class="btn" data-close>닫기</button></div>', src);
  assert.throws(() => statics.noAdminNoFoot(bad), /푸터/);
});
test('변이③s: 단추의 sticky 를 지우면 정적④ 가 실패한다', () => {
  const bad = mutate('.cat-add{position:sticky;bottom:0;', '.cat-add{', src);
  assert.throws(() => statics.addButton(bad), /sticky/);
});

const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('my-tasks-ui: jsdom 미설치 — 런타임 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CA = '2026-09-01T00:00:00Z';
  const CAT = (id, name, extra) => Object.assign({ id, name, color: '#3e5be0', desc: '', createdAt: CA }, extra || {});
  const ENT = (id, categoryId) => ({ id, date: '2026-10-01', title: '업무 ' + id, categoryId, allDay: true, startTime: '', endTime: '',
    memo: '', location: '', recur: null, recurExcept: [], endDate: '', createdAt: CA, updatedAt: CA });
  const TD = (id, categoryId, done) => ({ id, text: '할 일 ' + id, done, categoryId, due: '', endDate: '', prio: 'normal', completedAt: done ? CA : '', note: '', dayNotes: {} });
  const DATA = {
    categories: [CAT('c-p', '프로젝트', { desc: '내 메모' }), CAT('c-q', '메모 없는 일반'), CAT('db-1', '공식 하나', { source: 'db' }),
      CAT('db-2', '공식 둘', { source: 'db' }), CAT('c-v', '휴가'), CAT('c-e', '기타')],
    entries: [ENT('e-p', 'c-p'), ENT('e-p2', 'c-p'), ENT('e-1', 'db-1')],
    //  할 일은 끝낸 것도 센다(docs/CAT-COUNTS-SPLIT.md). 프로젝트 1개(끝냄), 공식 둘 2개(하나는 끝냄)
    todos: [TD('t-p', 'c-p', true), TD('t-2', 'db-2', false), TD('t-3', 'db-2', true)], rooms: [],
  };

  async function withBoot(source, fn) {
    const log = [];
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/',
      virtualConsole: jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined,
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} log.push({ post: o && o.cmd }); }, addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.setTimeout = () => 0; win.clearTimeout = () => {};
        win.matchMedia = (q) => ({ matches: /prefers-reduced-motion/.test(String(q)), media: String(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      },
    });
    const w = dom.window, d = w.document;
    w.eval('hostRequest = function(cmd, params){ return Promise.resolve({ ok: false, error: "no handler" }); };');
    const W = {
      w, d, ev: (c) => w.eval(c),
      $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)],
      open: (id) => { const e = d.getElementById(id); return !!e && !e.classList.contains('hidden') && !e.classList.contains('closing'); },
      row: (id) => d.querySelector('#catList .cat-row[data-id="' + id + '"]'),
    };
    try {
      W.ev('__applyState(' + JSON.stringify(JSON.stringify(DATA)) + ',' + JSON.stringify(META) + ')');
      await settle();
      W.ev('openCatModal();');
      await settle();
      return await fn(W);
    } finally { await settle(); try { w.close(); } catch (_) {} }
  }

  const checks = {
    async rows(source) {
      await withBoot(source, async (W) => {
        const tags = Object.fromEntries(W.$$('#catList .cat-row').map((r) => [r.dataset.id, r.querySelector('.cat-tag') ? r.querySelector('.cat-tag').textContent : null]));
        assert.deepStrictEqual(tags, { 'c-p': null, 'c-q': null, 'db-1': '공식', 'db-2': '공식', 'c-v': null, 'c-e': null }, '공식 줄에만 「공식」 표가 붙어야 한다: ' + JSON.stringify(tags));
        assert.ok(!W.$('#catList .cat-kind'), '구분 열이 남았다');
        //  줄마다 일정, 할 일 두 칸(docs/CAT-COUNTS-SPLIT.md). 0 은 흐림, title 은 "과제명, 일정 N개, 할 일 N개"
        const cnts = (id) => [...W.row(id).querySelectorAll('.cat-count')];
        const nums = (id) => cnts(id).map((c) => c.textContent + (c.classList.contains('zero') ? '-' : ''));
        assert.deepStrictEqual(nums('c-p'), ['2', '1'], '프로젝트 줄은 일정 2, 할 일 1(끝낸 것 포함)이어야 한다');
        assert.deepStrictEqual(nums('db-1'), ['1', '0-'], '공식 하나는 일정 1, 할 일 0(흐림)이어야 한다');
        assert.deepStrictEqual(nums('db-2'), ['0-', '2'], '공식 둘은 일정 0(흐림), 할 일 2 이어야 한다');
        assert.deepStrictEqual(nums('c-q'), ['0-', '0-'], '0 이 흐리지 않다');
        for (const c of cnts('c-p')) assert.strictEqual(c.title, '프로젝트, 일정 2개, 할 일 1개');
        assert.strictEqual(cnts('c-q')[0].title, '메모 없는 일반, 일정 0개, 할 일 0개');
        for (const c of W.$$('#catList .cat-count')) assert.ok(/^\d+$/.test(c.textContent), '기록 수에 숫자 말고 글자가 있다: ' + c.textContent);
        assert.deepStrictEqual(W.$$('#catHead > span').map((s) => s.textContent), ['', '', '과제', '', '일정', '할 일', ''], '열 머리글 글자가 다르다');
        assert.ok(!W.$('#catAdminRow') && !W.$('#btnCatAdmin') && !W.$('#btnRelinkOpen') && !W.$('#categoryModal .modal-foot'), '없앤 관리 줄, 푸터, 연결 단추가 있다');
      });
    },
    async addOpens(source) {
      await withBoot(source, async (W) => {
        assert.ok(!W.$('#categoryModal .modal-head #btnCatAdd'), '머리에 추가 단추가 있다');
        assert.ok(W.$('#categoryModal .modal-body > #btnCatAdd'), '추가 단추가 본문(스크롤하는 쪽) 안에 없다');
        assert.strictEqual(W.open('catAddModal'), false);
        W.$('#btnCatAdd').click(); await settle();
        assert.ok(W.open('catAddModal'), '[+ 과제 추가] 가 과제 추가 창을 열지 않는다');
      });
    },
    async linkMenu(source) {
      await withBoot(source, async (W) => {
        W.row('c-p').querySelector('[data-catmore]').click(); await settle();
        const it = W.row('c-p').querySelector('.cat-menu [data-catdo="link"]');
        assert.ok(it && /공식 과제로 연결/.test(it.textContent), '일반 줄 ⋯ 메뉴에 「공식 과제로 연결」이 없다');
        W.row('db-1').querySelector('[data-catmore]').click(); await settle();
        assert.strictEqual(W.row('db-1').querySelector('.cat-menu [data-catdo="link"]'), null, '공식 줄 메뉴에 연결이 있다');
        W.row('c-p').querySelector('[data-catmore]').click(); await settle();
        W.row('c-p').querySelector('.cat-menu [data-catdo="link"]').click(); await settle();
        assert.ok(W.open('relinkModal'), '메뉴의 「공식 과제로 연결」이 연결 창을 열지 않는다');
      });
    },
  };

  test('런타임①: 공식 줄에만 표 · 기록 수는 숫자만(0 은 흐림, title) · 열 머리글 · 없앤 요소 없음', () => checks.rows(src));
  test('런타임②: 아래 [+ 과제 추가] 가 과제 추가 창을 연다(머리에는 없다)', () => checks.addOpens(src));
  test('런타임③: 일반 줄 ⋯ 메뉴의 「공식 과제로 연결」이 연결 창을 연다(공식 줄에는 없다)', () => checks.linkMenu(src));
  test('변이④: 표를 모든 줄에 붙이면 런타임① 이 실패한다', async () => {
    const bad = mutate("(kind === 'official' ? `<span class=\"cat-tag\">${CAT_KIND_LABEL.official}</span>` : '')", "`<span class=\"cat-tag\">${CAT_KIND_LABEL[kind]}</span>`", src);
    await assert.rejects(() => checks.rows(bad), /공식 줄에만/);
  });
  test('변이⑤: 메뉴에서 연결 항목을 빼면 런타임③ 이 실패한다', async () => {
    const bad = mutate("  if(kind === 'personal') h += item('link', '공식 과제로 연결…');\n", '', src);
    await assert.rejects(() => checks.linkMenu(bad), /연결/);
  });
}
