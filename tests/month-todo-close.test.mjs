// 달력 칸 일정과 할 일 합쳐 채우기, 팝업 닫기 × 계약(docs/MONTH-TODO-POPUP-CLOSE.md, 2026-11-05 사용자).
//
// 이 파일이 지키는 것(기획 §3):
//   (S) 정적: 칸 맨 위 할 일 구역(pmTodoZone, 점선 .td-sep)과 "할 일 n" 개수 칩(.chip-tdcnt, data-tdcnt)이 없다.
//       비모달 팝업(role=dialog, aria-modal 없음) 목록이 정해진 것뿐이고 모두 닫기 단추가 있다(× 는 공용 popXHtml, popHeadHtml, popHeadEl).
//       × 는 모달 × 와 같은 .x, aria-label 과 title 이 "닫기". 새 글에 금지 기호 없음, 새 CSS 는 토큰만.
//   (R) jsdom:
//       §1 월간 칸: 여러 날 막대 다음 하루짜리 일정(시간순), 그다음 하루짜리 할 일(중요 먼저, 안 끝낸 것 먼저). 할 일 많은 날이 옆 칸을 밀지 않는다.
//          넘치면 일정과 할 일을 합친 "+n개 더보기" 하나, 누르면 그 날짜. 할 일만 보기와 일정만 보기는 예전 순서 그대로.
//       §2 팝업마다(#fbPop, #peerPicker, #awWCal, #pcPop, #pcDrawer, #caWhoPop) 머리줄 × 가 있고, 누르면 닫히고, 포커스는 연 단추로, 고른 상태는 그대로.
//   (M) 변이: 칸 안에서 할 일을 일정보다 먼저 놓거나, × 를 받는 갈래를 빼면 위 시험이 실패한다.
// ★ 회사 사이트에는 아무것도 보내지 않는다(호스트 postMessage 는 시험 안에서 버리거나 가짜로 답한다).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
const css = app.slice(0, app.indexOf('</style>'));
const ymdAdd = (ds, n) => { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}

/* ══ (S) 정적 ═══════════════════════════════════════════════════════════ */
test('(S) §1: 칸 맨 위 할 일 구역, 점선, "할 일 n" 개수 칩과 그 CSS 가 없고, 칸 안 순서는 pmCellCmp(일정 다음 할 일) 하나다', () => {
  for (const gone of ['pmTodoZone', 'todoCount', 'tdcnt', '.td-sep', 'chip-tdcnt', 'dayTodo = ']) assert.ok(!app.includes(gone), `걷어야 할 할 일 구역 흔적 ${gone} 이 남았다`);
  const rb = extractFunction(app, 'renderMonthBars');
  assert.ok(/const cmp = both \? pmCellCmp :/.test(rb), '둘 다 보일 때 칸 안 순서가 pmCellCmp 가 아니다');
  assert.ok(/cnt\[c\]\+\+;/.test(rb), '칸 기록 수가 항목마다 하나로 세어지지 않는다');
});
test('(S) §2: 비모달 팝업(role=dialog, aria-modal 없음)은 정해진 것뿐이고 모두 닫기 단추가 있다', () => {
  //  마크업의 role="dialog" 와 setAttribute('role', 'dialog') 중 모달(aria-modal, .modal)이 아닌 것의 id
  const ids = new Set();
  for (const m of app.matchAll(/<div[^>]*role="dialog"[^>]*>/g)) if (!/aria-modal|class="modal/.test(m[0])) ids.add((/id="([^"]+)"/.exec(m[0]) || [])[1] || '?');
  for (const m of app.matchAll(/(\w+)\.id = '([^']+)'[^\n]*\n[^\n]*\n?[^\n]*setAttribute\('role', 'dialog'\)/g)) ids.add(m[2]);
  for (const m of app.matchAll(/pop\.className = '[^']*'; pop\.id = '([^']+)';\n\s*pop\.setAttribute\('role', 'dialog'\)/g)) ids.add(m[1]);
  ids.add('peerPicker');   // pkEnsure 는 id 와 role 사이에 줄이 더 있다
  assert.deepStrictEqual([...ids].sort(), ['atAddMenu', 'awAddMenu', 'awWCal', 'caWhoPop', 'fbPop', 'pcDrawer', 'pcPop', 'peerPicker'].sort(), '비모달 팝업 목록이 바뀌었다(새 팝업이면 닫기 × 를 붙이고 이 목록에 더한다)');
  //  이미 [닫기] 가 있는 두 과제 추가 메뉴는 그대로
  assert.ok(app.includes('<button type="button" class="btn sm" id="atAddDone">닫기</button>') && app.includes('<button type="button" class="btn sm" id="awAddDone">닫기</button>'), '과제 추가 메뉴의 [닫기] 가 바뀌었다');
  //  나머지는 공용 머리줄 × 를 쓴다
  assert.ok(/popHeadHtml\('달력에 보일 것', '<button type="button" class="fb-lk" data-act="reset">처음대로<\/button>', 'vp-head'\)/.test(extractFunction(app, 'filterPopOpen')), '개인 보기 팝업 머리줄이 공용 함수가 아니다');
  assert.ok(extractFunction(app, 'caWhoOpen').includes("popHeadHtml('참여자', '', 'vp-head')"), '참여자 팝업에 제목 "참여자" 머리줄이 없다');
  assert.ok(extractFunction(app, 'pkEnsure').includes("popHeadEl('사람 고르기')"), '사람 고르기 팝업에 머리줄이 없다');
  assert.ok(extractFunction(app, 'awCalRender').includes("popHeadHtml('주 고르기', '')"), '주 고르기 달력에 머리줄이 없다');
  assert.ok(extractFunction(app, 'pcOpenDayList').includes('popXHtml()'), '과제 탭 날짜 팝업 머리에 × 가 없다');
  assert.ok(extractFunction(app, 'pcSideHtml').includes("(inDrawer ? popXHtml() : '')"), '과제 목록 서랍 머리에 × 가 없다');
});
test('(S) §2: × 는 모달 × 와 같은 .x, aria-label 과 title 이 "닫기"(문자열과 DOM 두 함수가 같다), 새 글에 금지 기호 없음, 새 CSS 는 토큰만', () => {
  assert.strictEqual(extractFunction(app, 'popXHtml'), `function popXHtml(){ return '<button type="button" class="x pop-x" data-popx aria-label="닫기" title="닫기">×</button>'; }`);
  const el = extractFunction(app, 'popHeadEl');
  assert.ok(el.includes("x.className = 'x pop-x'") && el.includes("setAttribute('aria-label', '닫기')") && el.includes("x.title = '닫기'") && !/innerHTML/.test(el), 'DOM 머리줄의 × 가 문자열 판과 다르거나 HTML 주입을 쓴다');
  const fns = ['popXHtml', 'popHeadHtml', 'popHeadEl', 'pmCellCmp', 'todoZoneCmp'].map((n) => extractFunction(app, n)).join('\n');
  assert.ok(!/[—–「」]/.test(fns) && !/(^|\s)·(\s|$)/m.test(fns), '새 함수에 엠 대시, 낫표, 띄어 쓴 가운데 점이 있다');
  const mine = css.split('\n').filter((l) => /\.pop-head|\.pop-x/.test(l));
  assert.ok(mine.length >= 4, '머리줄 CSS 를 찾지 못했다');
  assert.ok(mine.every((l) => !/#[0-9a-fA-F]{3,8}\b/.test(l)), '새 CSS 에 hex 색이 있다');
});

/* ══ (R) jsdom ═════════════════════════════════════════════════════════ */
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('month-todo-close: jsdom 미설치로 런타임 검증을 건너뜁니다', SKIP_NO_JSDOM,
    `이 파일의 test 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았습니다.`);
} else {
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const quiet = () => new jsdomMod.VirtualConsole();
  //  개인 탭 창. host = 호스트(chrome.webview) 흉내 여부. 보낸 글은 posts 에 모으고 아무 데도 보내지 않는다
  function bootPlain(src, host) {
    const posts = [], errors = [];
    const vc = quiet();
    vc.on('jsdomError', (e) => { const s = String(e && (e.stack || e.message) || e); if (!/Not implemented/.test(s)) errors.push(s); });
    const { window: w } = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: vc,
      beforeParse(win) {
        if (host) win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posts.push(o || {}); }, addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'u-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.open = () => null;
      },
    });
    const doc = w.document;
    return { w, doc, posts, errors, ev: (c) => w.eval(c), $: (s) => doc.querySelector(s), $$: (s) => [...doc.querySelectorAll(s)], close: () => { try { w.close(); } catch (_) {} } };
  }
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CAT = (id, name) => ({ id, name, color: '#3e5be0', desc: '', createdAt: '2026-09-01T00:00:00Z' });
  const ENT = (id, date, o) => Object.assign({ id, date, title: '일정 ' + id, categoryId: 'c-a', allDay: true, startTime: '', endTime: '', endDate: '', memo: '', location: '', recur: null, recurExcept: [], createdAt: '2026-09-01T00:00:00Z' }, o || {});
  const TODO = (id, due, n, o) => Object.assign({ id, text: '할 일 ' + id, done: false, categoryId: 'c-a', due, endDate: '', prio: 'normal', completedAt: '', note: '', dayNotes: {}, createdAt: `2026-09-01T00:00:0${n}Z`, updatedAt: '2026-09-01T00:00:00Z' }, o || {});
  //  T = 오늘, N = 같은 주 옆 날(토요일이면 앞날). 여러 날 일정 eM 이 T 와 N 을 덮는다.
  //  T: 일정 둘(종일 eA, 09:00 eB)과 할 일 여섯. N: 일정 하나와 할 일 하나.
  function monthData(T) {
    const N = new Date(T + 'T00:00:00').getDay() === 6 ? ymdAdd(T, -1) : ymdAdd(T, 1);
    const lo = T < N ? T : N, hi = T < N ? N : T;
    return { T, N, data: {
      categories: [CAT('c-a', '알파')],
      entries: [ENT('eB', T, { allDay: false, startTime: '09:00', endTime: '10:00' }), ENT('eA', T), ENT('eM', lo, { endDate: hi }), ENT('eN', N)],
      todos: [TODO('t1', T, 1), TODO('t2', T, 2, { prio: 'high' }), TODO('t3', T, 3, { done: true, completedAt: '2026-10-01T00:00:00Z' }),
        TODO('t4', T, 4), TODO('t5', T, 5, { prio: 'high', done: true, completedAt: '2026-10-01T00:00:00Z' }), TODO('t6', T, 6), TODO('tN', N, 7)],
      taskHours: {}, attendance: {},
    } };
  }
  async function bootMonth(src) {
    const W = bootPlain(src || app, true);
    await settle();
    const M = monthData(W.ev('todayYmd()'));
    W.M = M;
    W.w.__applyState(JSON.stringify(M.data), META);
    W.ev(`view = {y: ${Number(M.T.slice(0, 4))}, m: ${Number(M.T.slice(5, 7)) - 1}}; selectedDate = "${M.T}"; setCalView("month"); viewReset(); renderAll();`);
    await settle();
    return W;
  }
  const chipsOf = (W, ds) => {
    const cell = W.$(`#grid .cell[data-date="${ds}"]`), row = cell.closest('.gridrow'), col = [...row.querySelectorAll('.cell')].indexOf(cell);
    return [...row.querySelectorAll('.chip-bar')].filter((c) => Number(c.dataset.c0) <= col && Number(c.dataset.c1) >= col);
  };
  const order = (W, ds) => chipsOf(W, ds).sort((a, b) => Number(a.dataset.lane) - Number(b.dataset.lane)).map((c) => c.dataset.todo || c.dataset.id);
  const setView = (W, js) => { W.ev(js); W.ev('filterApply()'); };

  const checks = {
    async cellOrder(src) {
      const W = await bootMonth(src);
      try {
        const { T, N } = W.M;
        assert.strictEqual(W.$$('#grid .td-sep, #grid [data-tdcnt]').length, 0, '할 일 구역 점선이나 개수 칩이 있다');
        assert.deepStrictEqual(order(W, T), ['eM', 'eA', 'eB', 't2', 't5', 't1', 't4', 't6', 't3'], '칸 안 순서가 막대, 일정(시간순), 할 일(중요 먼저, 안 끝낸 것 먼저)이 아니다');
        //  옆 칸: 할 일 많은 T 가 있어도 N 은 막대 바로 아래부터 자기 일정, 할 일
        assert.deepStrictEqual(chipsOf(W, N).sort((a, b) => a.dataset.lane - b.dataset.lane).map((c) => [c.dataset.todo || c.dataset.id, Number(c.dataset.lane)]),
          [['eM', 0], ['eN', 1], ['tN', 2]], '할 일 많은 날이 옆 칸을 밀어냈다');
        //  T 의 할 일을 더 늘려도 N 은 그대로
        W.ev(`var base = ${JSON.stringify(TODO('x', T, 8))}; for(var i = 0; i < 8; i++) state.todos.push(Object.assign({}, base, { id: 'x' + i })); renderGrid();`);
        assert.deepStrictEqual(chipsOf(W, N).map((c) => Number(c.dataset.lane)).sort(), [0, 1, 2], '옆 칸 할 일을 늘렸더니 이 칸 차선이 바뀌었다');
      } finally { W.close(); }
    },
  };

  test('(R) §1 칸 안 순서: 여러 날 막대, 하루짜리 일정(시간순), 하루짜리 할 일(중요 먼저, 안 끝낸 것 먼저). 할 일 구역과 개수 칩 없음, 할 일 많은 날이 옆 칸을 밀지 않는다', () => checks.cellOrder());

  test('(R) §1 넘치면 일정과 할 일을 합친 "+n개 더보기" 하나(할 일만 따로 세지 않는다), 누르면 그 날짜', async () => {
    const W = await bootMonth();
    try {
      const { T, N } = W.M;
      //  주 줄 높이 91px = 머리 27 + 더보기 18 + 여백 4 + 차선 둘(42). 칸에 다 들어가지 않으면 두 차선만 보인다
      const wk = W.$(`#grid .cell[data-date="${T}"]`).closest('.gridrow');
      Object.defineProperty(wk, 'clientHeight', { value: 91, configurable: true });
      W.ev("fitBars(document.getElementById('grid'))");
      const vis = (ds) => chipsOf(W, ds).filter((c) => c.style.display !== 'none').sort((a, b) => a.dataset.lane - b.dataset.lane).map((c) => c.dataset.todo || c.dataset.id);
      assert.deepStrictEqual(vis(T), ['eM', 'eA'], '보이는 칩이 막대와 첫 일정이 아니다');
      assert.deepStrictEqual(vis(N), ['eM', 'eN'], '옆 칸에 보이는 칩이 막대와 자기 일정이 아니다');
      const more = (ds) => wk.querySelector(`.more[data-more="${ds}"]`);
      assert.ok(more(T), '넘친 칸에 +n 이 없다');
      assert.strictEqual(more(T).textContent, '+7개 더보기', '넘친 일정 하나와 할 일 여섯이 합쳐 +7 이 아니다');
      assert.strictEqual(more(T).getAttribute('aria-label'), '+7개 더보기');
      assert.strictEqual(wk.querySelectorAll(`.more[data-more="${T}"]`).length, 1, '+n 이 하나가 아니다');
      assert.strictEqual(more(N).textContent, '+1개 더보기', '옆 칸 +n 이 자기 할 일 하나가 아니다');
      W.ev(`selectDate("${N}")`);
      more(T).click(); await settle();
      assert.strictEqual(W.ev('selectedDate'), T, '+n 을 눌렀는데 그 날짜가 골라지지 않았다');
    } finally { W.close(); }
  });

  test('(R) §1 할 일만 보기와 일정만 보기는 예전 그대로(한 종류만, 할 일만은 만든 순서)', async () => {
    const W = await bootMonth();
    try {
      const { T } = W.M;
      setView(W, 'viewSetKind("td")');
      assert.deepStrictEqual(order(W, T), ['t1', 't2', 't3', 't4', 't5', 't6'], '할 일만 보기의 칸 순서가 바뀌었다');
      setView(W, 'viewReset(); viewSetKind("ev")');
      assert.deepStrictEqual(order(W, T), ['eM', 'eA', 'eB'], '일정만 보기의 칸이 바뀌었다');
      assert.strictEqual(W.$$('#grid [data-todo]').length, 0);
    } finally { W.close(); }
  });

  //  ── §2 팝업 닫기 × ─────────────────────────────────────────────────
  const xOf = (pop) => pop && pop.querySelector('.pop-head [data-popx], .pc-pop-top > [data-popx], .pc-side-h > [data-popx]');
  function xShape(pop, what) {
    const x = xOf(pop);
    assert.ok(x, `${what}: 머리줄에 × 가 없다`);
    assert.ok(x.classList.contains('x') && x.getAttribute('aria-label') === '닫기' && x.getAttribute('title') === '닫기' && x.textContent === '×' && x.type === 'button', `${what}: × 모양이나 이름이 다르다`);
    const head = x.closest('.pop-head, .pc-pop-top, .pc-side-h');
    assert.strictEqual(head.lastElementChild === x || head.lastElementChild.lastElementChild === x, true, `${what}: × 가 머리줄 오른쪽 끝이 아니다`);
    return x;
  }

  const popChecks = {
    async fbPop(src) {
      const W = await bootMonth(src);
      try {
        W.$('#fbBtn').click();
        const pop = W.$('#fbPop');
        assert.ok(pop, '보기 팝업이 열리지 않았다');
        assert.strictEqual(pop.querySelector('.vp-head b').textContent, '달력에 보일 것');
        const x = xShape(pop, '보기 팝업');
        assert.ok(x.previousElementSibling && x.previousElementSibling.dataset.act === 'reset', '× 가 [처음대로] 오른쪽이 아니다');
        pop.querySelector('[data-vk="td"]').click();
        x.click();
        assert.ok(!W.$('#fbPop'), '× 를 눌렀는데 보기 팝업이 닫히지 않았다');
        assert.strictEqual(W.doc.activeElement && W.doc.activeElement.id, 'fbBtn', '닫은 뒤 포커스가 [보기] 단추가 아니다');
        assert.strictEqual(W.ev('viewKindMode()'), 'td', '× 가 고른 보기를 되돌렸다');
        assert.strictEqual(W.$('#fbBtn').getAttribute('aria-expanded'), 'false');
        //  Esc 는 그대로
        W.$('#fbBtn').click();
        W.$('#fbPop .fb-q').dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        assert.ok(!W.$('#fbPop'), 'Esc 로 닫히지 않는다');
      } finally { W.close(); }
    },
    async peerPicker(src) {
      const W = bootPlain(src || app, false);
      try {
        await settle();
        const btn = W.$('#btnPeerPick');
        W.ev("pkOpen('top', document.getElementById('btnPeerPick'))");
        const pop = W.$('#peerPicker');
        assert.ok(pop && !pop.classList.contains('hidden'), '사람 고르기가 열리지 않았다');
        assert.strictEqual(pop.querySelector('.pop-head b').textContent, '사람 고르기');
        assert.strictEqual(pop.firstElementChild.classList.contains('pop-head') && pop.children[1].id, 'pkSearch', '머리줄 다음이 검색 칸이 아니다');
        assert.strictEqual(W.doc.activeElement && W.doc.activeElement.id, 'pkSearch', '열면 검색 칸에 포커스가 가야 한다(한 명 고르기 불변)');
        xShape(pop, '사람 고르기').click();
        assert.ok(pop.classList.contains('hidden') && !W.ev('__pk'), '× 를 눌렀는데 사람 고르기가 닫히지 않았다');
        assert.strictEqual(W.doc.activeElement, btn, '닫은 뒤 포커스가 [다른 사람 일정] 단추가 아니다');
        assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
        assert.ok(!W.posts.some((p) => p.cmd === 'peerOpen'), '× 가 누군가의 일정을 열었다');
        assert.deepStrictEqual(W.errors, []);
      } finally { W.close(); }
    },
    async awWCal(src) {
      const W = bootPlain(src || app, false);
      try {
        await settle();
        W.ev("state = { categories: [{ id: 'c-a', name: '알파', color: '#3e5be0', desc: '', createdAt: '2026-07-01T00:00:00.000Z' }], entries: [], todos: [], rooms: [], attendance: {}, taskHours: {}, reportMarker: '-', reportMarkerCustom: '', reportIndent: 2 };");
        W.ev("localStorage.setItem('tc_attKind', 'week'); pcSetTab('attend')");
        W.ev("awOpen('2026-10-05')");
        const btn = W.$('#awWeekBtn');
        btn.click();
        const cal = W.$('#awWCal');
        assert.ok(!cal.classList.contains('hidden'), '주 고르기 달력이 열리지 않았다');
        assert.strictEqual(cal.querySelector('.pop-head b').textContent, '주 고르기');
        assert.strictEqual(cal.querySelector('.aw-cmh b').textContent, '2026년 10월', '달 머리가 그대로가 아니다');
        cal.querySelector('[data-awcm="-1"]').click();
        xShape(cal, '주 고르기').click();
        assert.ok(cal.classList.contains('hidden'), '× 를 눌렀는데 주 고르기 달력이 닫히지 않았다');
        assert.strictEqual(W.doc.activeElement, btn, '닫은 뒤 포커스가 기간 단추가 아니다');
        assert.strictEqual(W.ev('AWE.mon'), '2026-10-05', '× 가 주를 바꿨다');
        assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
        assert.deepStrictEqual(W.errors, []);
      } finally { W.close(); }
    },
  };

  test('(R) §2 개인 [보기] 팝업: 머리줄 [처음대로] 오른쪽 끝에 ×, 누르면 고른 보기 그대로 닫히고 포커스는 [보기], Esc 그대로', () => popChecks.fbPop());
  test('(R) §2 다른 사람 일정 사람 고르기: 제목 "사람 고르기"와 ×, 검색 칸 포커스 불변, 누르면 닫히고 포커스는 연 단추, 아무도 열지 않음', () => popChecks.peerPicker());
  test('(R) §2 근태 주 고르기 달력: 제목 "주 고르기"와 ×, 누르면 닫히고 포커스는 기간 단추, 주는 그대로', () => popChecks.awWCal());

  //  과제 탭(호스트 흉내): 날짜 팝업, 좁은 폭 서랍, 관심 과제 추가 창 [참여자]
  function fakeClock() {
    let seq = 0, now = 0;
    const timers = new Map();
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
  const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const P1 = '11111111-1111-4111-8111-111111111111', B1 = 'bbbbbbbb-0000-4000-8000-000000000001';
  const PMETA = { schemaVersion: '21', expectedSchema: '21', schemaMismatch: false, gate: 'ok', rev: 1, canWrite: true, userId: 7 };
  const PDATA = () => ({ categories: [{ id: 'c-1', name: '휴가', color: '#9aa2b3' }, { id: 'db-' + P1, name: '장비 개발', color: '#3e5be0' }], entries: [], todos: [], rooms: [] });
  const MINE = [{ projectUid: P1, name: '장비 개발', color: '#3e5be0', active: true, writable: true, mine: true, members: 6 }];
  const WATCH = [{ projectUid: B1, name: '함대공 훈련장비', customer: 'D사', status: '진행중', statusId: 1, sectionId: 1, members: 2, hidden: false }];
  const MEMBERS = [
    { loginId: 'u1', name: '김하늘', title: '책임', orgUnit: '개발1팀', canViewSchedule: true },
    { loginId: 'u2', name: '박서준', title: '선임', orgUnit: '개발1팀', canViewSchedule: true },
    { loginId: 'hjlee', name: '이현진', title: '책임', orgUnit: '개발1팀', canViewSchedule: true },
  ];
  const UNITS = [{ name: '개발본부', parent: null, sortOrder: 1 }, { name: '개발1팀', parent: '개발본부', sortOrder: 1 }];
  async function bootProject({ source = app, narrow = false } = {}) {
    const clock = fakeClock();
    const posts = [];
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quiet(),
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posts.push(o || {}); }, addEventListener() {}, removeEventListener() {} } };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.setTimeout = clock.setTimeout; win.clearTimeout = clock.clearTimeout;
        if (narrow) win.matchMedia = (q) => ({ matches: /max-width:760px/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      },
    });
    const w = dom.window, doc = w.document;
    const W = {
      w, doc, clock, posts,
      ev: (c) => w.eval(c), el: (id) => doc.getElementById(id), q: (s) => doc.querySelector(s), qa: (s) => [...doc.querySelectorAll(s)],
      last: (cmd) => [...posts].reverse().find((p) => p.cmd === cmd && p.reqId && !p.__done),
      async reply(cmd, res) {
        const p = W.last(cmd);
        assert.ok(p, `${cmd} 요청이 나가지 않았다`);
        p.__done = true;
        w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify(res) + ')');
        await tick();
      },
      async click(sel) { const e = typeof sel === 'string' ? doc.querySelector(sel) : sel; assert.ok(e, `누를 것(${sel})이 없다`); e.click(); await tick(); clock.advance(150); await tick(); },
      close: () => { try { w.close(); } catch (_) {} },
    };
    await tick();
    await W.reply('userSessionGet', { ok: true, user: { loginId: 'hjlee', name: '이현진' } });
    w.eval('__applyState(' + JSON.stringify(JSON.stringify(PDATA())) + ',' + JSON.stringify(PMETA) + ')');
    await tick(); clock.advance(5); await tick();
    for (const p of posts.filter((x) => x.cmd === 'saveState' && x.reqId && !x.__done)) { p.__done = true; w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',{"ok":true})'); }
    await tick();
    return W;
  }
  async function enterProject(W) {
    await W.click('#pcTabProject');
    await W.reply('projectCalendarBootstrap', { ok: true, data: { projects: MINE, limits: { title: 200, location: 200, memo: 8000 } } });
    await W.reply('pcWatchList', { ok: true, data: { projects: WATCH, max: 50 } });
    const p = W.last('projectCalendarLoad');
    if (p) {
      p.__done = true;
      const ps = (p.projectUids || []).map((u) => ({ projectUid: u, writable: u === P1, mine: u === P1 }));
      W.w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify({ ok: true, data: { projects: ps, events: [], excluded: [], from: p.from, to: p.to } }) + ')');
      await tick();
    }
  }
  const withProject = async (opts, fn) => { const W = await bootProject(opts); try { return await fn(W); } finally { W.close(); } };

  const projChecks = {
    pcPop: (source) => withProject({ source }, async (W) => {
      await enterProject(W);
      const day = W.q('#pcView .pc-day[data-date]');
      const ds = day.dataset.date;
      await W.click(day);
      const pop = W.el('pcPop');
      assert.ok(pop, '날짜 팝업이 열리지 않았다');
      const x = xShape(pop, '과제 탭 날짜 팝업');
      assert.ok(x.parentElement.classList.contains('pc-pop-top'), '× 가 날짜 머리줄 안이 아니다');
      await W.click(x);
      assert.ok(!W.el('pcPop'), '× 를 눌렀는데 날짜 팝업이 닫히지 않았다');
      assert.strictEqual(W.doc.activeElement, day, '닫은 뒤 포커스가 누른 날짜 칸이 아니다');
      assert.strictEqual(W.ev('PCAL.anchor'), ds, '× 가 고른 날짜를 바꿨다');
    }),
    pcDrawer: (source) => withProject({ source, narrow: true }, async (W) => {
      await enterProject(W);
      await W.click('#pcScope');
      const dr = W.el('pcDrawer');
      assert.ok(dr, '과제 목록 서랍이 열리지 않았다');
      assert.notStrictEqual(W.doc.activeElement && W.doc.activeElement.dataset.popx, '', '서랍을 열면 포커스가 × 에 간다(첫 탭이나 단추여야 한다)');
      await W.click('#pcDrawer #pcStab-watch');
      const x = xShape(W.el('pcDrawer'), '과제 목록 서랍');
      await W.click(x);
      assert.ok(!W.el('pcDrawer'), '× 를 눌렀는데 서랍이 닫히지 않았다');
      assert.strictEqual(W.doc.activeElement && W.doc.activeElement.id, 'pcScope', '닫은 뒤 포커스가 과제 목록 단추가 아니다');
      assert.strictEqual(W.ev('pcSideTab()'), 'watch', '× 가 고른 탭을 되돌렸다');
      assert.ok(!W.q('#pcView aside.pc-side .pop-x'), '넓은 폭 옆 목록에 × 가 있다');
    }),
    caWho: (source) => withProject({ source }, async (W) => {
      await enterProject(W);
      W.ev('openCatAdd("watch")'); await tick();
      await W.reply('pcWatchCatalog', { ok: true, data: { projects: [{ projectUid: P1, lastActivity: null, memberIds: ['u1'] }, { projectUid: B1, lastActivity: null, memberIds: ['u2'] }] } });
      await W.reply('membersGet', { ok: true, data: { members: MEMBERS, units: UNITS, myUnit: '개발1팀' } });
      W.clock.advance(50); await tick();
      const btn = W.el('caWho');
      await W.click(btn);
      const pop = W.el('caWhoPop');
      assert.ok(pop, '참여자 팝업이 열리지 않았다');
      assert.strictEqual(pop.querySelector('.vp-head b').textContent, '참여자', '참여자 팝업 제목이 없다');
      assert.ok(pop.firstElementChild.classList.contains('vp-head') && pop.querySelector('.fb-q'), '머리줄 아래 찾기 칸이 아니다');
      await W.click(pop.querySelector('.fb-lk[data-act="none"]'));
      const label = W.el('caWhoT').textContent;
      assert.notStrictEqual(label, '전체', '시험 준비: 전체 해제가 먹지 않았다');
      await W.click(xShape(pop, '참여자 팝업'));
      assert.ok(!W.el('caWhoPop'), '× 를 눌렀는데 참여자 팝업이 닫히지 않았다');
      assert.strictEqual(W.doc.activeElement, btn, '닫은 뒤 포커스가 [참여자] 단추가 아니다');
      assert.strictEqual(W.el('caWhoT').textContent, label, '× 가 고른 참여자를 되돌렸다');
      assert.ok(!W.el('catAddModal').classList.contains('hidden'), '× 가 과제 추가 창까지 닫았다');
    }),
  };
  test('(R) §2 과제 탭 날짜 팝업: 날짜 머리 오른쪽 끝(등록 옆)에 ×, 누르면 닫히고 포커스는 누른 칸, 고른 날짜 그대로', () => projChecks.pcPop());
  test('(R) §2 과제 목록 서랍(좁은 폭): 머리 "과제" 줄 오른쪽 끝에 ×, 누르면 닫히고 포커스는 과제 목록 단추, 고른 탭 그대로', () => projChecks.pcDrawer());
  test('(R) §2 관심 과제 추가 [참여자]: 제목 "참여자" 머리줄과 ×, 누르면 고른 참여자 그대로 닫히고 포커스는 [참여자], 창은 열린 채', () => projChecks.caWho());

  /* ══ (M) 변이 ═══════════════════════════════════════════════════════ */
  test('(M) 칸 안에서 할 일을 일정보다 먼저 놓으면 순서 시험이 실패한다', async () => {
    const bad = mutate(app, 'if(!!a.todo !== !!b.todo) return a.todo ? 1 : -1;', 'if(!!a.todo !== !!b.todo) return a.todo ? -1 : 1;');
    await assert.rejects(() => checks.cellOrder(bad), /칸 안 순서/);
  });
  test('(M) 할 일 구역을 되살리면(하루짜리 할 일을 맨 위 차선에) 옆 칸 시험이 실패한다', async () => {
    const bad = mutate(app, "  const cmp = both ? pmCellCmp :", "  const cmp = both ? ((a, b) => (!!b.todo - !!a.todo) || pmCellCmp(a, b)) :");
    await assert.rejects(() => checks.cellOrder(bad), /칸 안 순서|옆 칸/);
  });
  test('(M) 보기 팝업 × 갈래를 빼면 보기 팝업 시험이 실패한다', async () => {
    const bad = mutate(app, "      if(t.closest('[data-popx]')){ filterPopClose(true); return; }\n", '');
    await assert.rejects(() => popChecks.fbPop(bad), /닫히지 않았다/);
  });
  test('(M) 사람 고르기 × 가 포커스를 돌려주지 않으면 시험이 실패한다', async () => {
    const bad = mutate(app, "closest('[data-popx]')){ pkClose(true); return; }", "closest('[data-popx]')){ pkClose(false); return; }");
    await assert.rejects(() => popChecks.peerPicker(bad), /포커스/);
  });
  test('(M) 참여자 × 갈래를 빼면 참여자 시험이 실패한다', async () => {
    const bad = mutate(app, "  if(t.closest('[data-popx]')){ caWhoClose(true); return; }\n", '');
    await assert.rejects(() => projChecks.caWho(bad), /닫히지 않았다/);
  });
  test('(M) 날짜 팝업 × 가 포커스를 돌려주지 않으면 시험이 실패한다', async () => {
    const bad = mutate(app, "if(ev.target.closest('[data-popx]')){ pcClosePop(false); return; }", "if(ev.target.closest('[data-popx]')){ pcClosePop(true); return; }");
    await assert.rejects(() => projChecks.pcPop(bad), /포커스/);
  });
}
