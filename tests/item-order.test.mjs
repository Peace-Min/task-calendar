// 일정과 할 일 순서 바꾸기(0.28.0, docs/ITEM-ORDER.md, 시안 docs/prototypes/day-panel-order.html 손잡이 자리 1번)와 같은 판의 F1, F6.
//
// 이 파일이 지키는 것:
//   (S) 정적: 순서 비교(entrySort, todoZoneCmp)는 배열 자리 하나(itemOrderCmp)이고 시각, 중요, 완료를 보지 않는다. 날짜 패널은 다시 정렬하지 않는다.
//       손잡이 ⠿ 는 카드 맨 윗줄 과제 표 앞, 할 일 줄 체크 앞(날짜 패널만), 열람 창(PEER)에는 없다. 끌기는 내 과제와 같은 클래스(.cat-drag-ghost 등).
//       F1: 업데이트 배너에 [변경내역](#updNotes)과 그 창(#updNotesModal)이 없다. F6: 그림 넣기 뒤 두 경로 모두 칸으로 포커스를 돌린다.
//   (R) 런타임(jsdom):
//       배열 순서가 날짜 패널, 월간 칸, 주간 줄, 검색 결과에 그대로 보인다(시각, 중요, 완료로 다시 세우지 않음).
//       끌기: 놓으면 보이는 이웃 앞으로 배열에서 옮기고 저장, 그날 안 보이는 항목의 상대 순서는 그대로, 끄는 동안 접힌 일정을 펴고 놓으면 되돌림,
//       Esc 는 취소(배열, 저장, 접힘 그대로). 할 일도 같다. Alt+↑↓ 는 한 칸이고 포커스는 옮긴 항목에 남고 접힌 자리로 내리면 편다.
//       열람 창에는 손잡이가 없고 Alt+↑↓ 도 아무것도 바꾸지 않는다. F1 배너, F6 칸 다시 그린 뒤 포커스.
//   (M) 변이: 시각순 되살리기, 끌기 펼침 빼기, 저장 빼기를 망가뜨리면 위 시험이 잡는다.
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

// ══════════════════════════════════════════════════════════════════════
// (S) 정적
// ══════════════════════════════════════════════════════════════════════
test('(S) 순서 비교는 배열 자리 하나: entrySort, todoZoneCmp 가 itemOrderCmp 이고 시각, 중요, 완료를 보지 않는다. 패널은 다시 정렬하지 않는다', () => {
  const es = extractFunction(app, 'entrySort'), tz = extractFunction(app, 'todoZoneCmp');
  assert.ok(es.includes("itemOrderCmp('e', a, b)") && tz.includes("itemOrderCmp('t', a, b)"), '비교가 배열 자리(itemOrderCmp)가 아니다');
  for (const [n, f] of [['entrySort', es], ['todoZoneCmp', tz], ['pmCellCmp', extractFunction(app, 'pmCellCmp')], ['segSort', extractFunction(app, 'segSort')]]) {
    assert.ok(!/startTime|allDay|prio|\.done|createdAt/.test(f), `${n} 가 시각, 종일, 중요, 완료, 만든 시각을 본다`);
  }
  assert.ok(/if\(ax !== ay\) return ax \? -1 : 1;/.test(extractFunction(app, 'segSort')), '여러 날 막대가 위로 가지 않는다(segSort)');
  assert.ok(!/\.sort\(/.test(extractFunction(app, 'dayDetailHtml')), '날짜 패널이 다시 정렬한다');
  assert.ok(extractFunction(app, 'groupByDateHtml').includes('.sort(entrySort)'), '검색 결과가 배열 순서(entrySort)가 아니다');
  assert.ok(/for\(const e of state\.entries\)/.test(extractFunction(app, 'collectReportData')), '일간보고 캘린더 가져오기가 배열 순서로 돌지 않는다');
});
test('(S) 손잡이 ⠿: 카드 맨 윗줄 과제 표 앞, 할 일 줄 체크 앞(날짜 패널만), 열람 창은 없음. 늘 보이고 눌리는 영역 24px. 끌기 모양은 내 과제와 같은 클래스', () => {
  assert.ok(/function dpCanOrder\(\)\{ return !PEER; \}/.test(app), '열람 창(PEER)에서 순서를 바꿀 수 있다');
  assert.ok(extractFunction(app, 'dpGripHtml').includes('<span class="dp-grip" data-dpgrip aria-hidden="true">⠿</span>'));
  const card = extractFunction(app, 'cardHtml');
  assert.ok(card.includes('`<div class="card-top">${grip}${c ?'), '카드 손잡이가 맨 윗줄 과제 표 앞이 아니다');
  assert.ok(extractFunction(app, 'todoRowHtml').includes("${opts.panel ? dpGripHtml() : ''}${check}"), '할 일 손잡이가 체크 앞(날짜 패널만)이 아니다');
  const g = /\n\.dp-grip\{([^}]*)\}/.exec(css);
  assert.ok(g && /width:24px;height:24px/.test(g[1]) && /cursor:grab/.test(g[1]) && !/opacity:0|visibility:hidden|display:none/.test(g[1]), '손잡이가 24px 이 아니거나 늘 보이지 않는다');
  assert.ok(!/:hover \.dp-grip\{[^}]*(opacity|visibility|display)/.test(css), '손잡이가 마우스를 올릴 때만 나타난다');
  assert.ok(/#dpBody \.cat-drag-src\{opacity:\.45\}|#dpBody \.cat-drag-src\{opacity:\.45/.test(css.replace('.cat-row.cat-drag-src,', '')), '원래 자리가 45%로 흐려지지 않는다');
  //  끌기는 내 과제와 같은 공용 손(ordDragInit)이고 클래스 앞머리는 기본(cat)이다
  const init = extractFunction(app, 'dpOrderInit');
  assert.ok(init.includes('ordDragInit({') && !/cls:/.test(init), '날짜 패널 끌기가 공용 손(ordDragInit, cat- 클래스)을 쓰지 않는다');
  const hand = extractFunction(app, 'ordDragInit');
  for (const k of ["const C = o.cls || 'cat'", 'classList.add(`${C}-drag-ghost`)', 'classList.add(`${C}-drag-src`)', '`${C}-drop-before`', '`${C}-drop-after`', 'classList.add(`${C}-dragging`)', "ev.key === 'Escape'", "window.addEventListener('blur'", '< 5) return;']) {
    assert.ok(hand.includes(k), '공용 끌기 손이 내 과제 손과 다르다: ' + k);
  }
  const fns = ['restoreAt', 'restoreEntry', 'restoreTodo', 'ordKey', 'ordIndexOf', 'itemOrderCmp', 'dpCanOrder', 'dpGripHtml', 'dpOrderIds', 'orderMoveRel', 'dpOrderApply', 'dpOrderApplyRel', 'dpOrderFocus', 'dpOrderKey', 'ordDragInit', 'dpOrderInit'].map((n) => extractFunction(app, n)).join('\n');
  assert.ok(!/[—–「」]/.test(fns) && !/(^|\s)·(\s|$)/m.test(fns), '새 함수에 엠 대시, 낫표, 띄어 쓴 가운데 점이 있다');
});
test('(S) 끌어서 순서 바꾸기는 공용 손 하나(ordDragInit): 내 과제, 공식 과제 목록, 날짜 패널이 모두 부르고 5px 문턱, 복제본, 놓을 자리 규칙의 사본이 없다', () => {
  const script = app.slice(app.indexOf('</style>'));
  assert.strictEqual((script.match(/function ordDragInit\(/g) || []).length, 1, '공용 손이 없거나 둘이다');
  assert.strictEqual((script.match(/ordDragInit\(\{/g) || []).length, 3, '공용 손을 부르는 곳이 셋(내 과제, 공식 목록, 날짜 패널)이 아니다');
  assert.ok(extractFunction(app, 'dpOrderInit').includes('ordDragInit({'), '날짜 패널이 공용 손을 부르지 않는다');
  assert.ok(script.includes("ordDragInit({\n      root: list, grip: '[data-catgrip]'"), '내 과제가 공용 손을 부르지 않는다');
  assert.ok(script.includes("ordDragInit({\n        root: box, grip: '[data-offdrag]', row: '.off-row', cls: 'off'"), '공식 과제 목록이 공용 손을 부르지 않는다');
  //  사본 흔적: 문턱, 복제본 클래스, 포인터 따라가기 처리기, 놓을 자리 방향 계산은 한 곳뿐
  assert.strictEqual((script.match(/Math\.hypot\(/g) || []).length, 1, '5px 문턱이 여러 곳에 있다');
  assert.strictEqual((script.match(/classList\.add\([^)]*drag-ghost/g) || []).length, 1, '복제본(drag-ghost) 만들기가 여러 곳에 있다');
  assert.strictEqual((script.match(/cloneNode\(true\); gh\./g) || []).length, 1, '줄 복제가 여러 곳에 있다');
  assert.strictEqual((script.match(/addEventListener\('pointermove', move, true\)/g) || []).length, 1, '끌기 포인터 처리기가 여러 곳에 있다');
  assert.ok(!/drop-before' : '|-drop-before'\); d\.to|'cat-drop-before'|'off-drop-before'/.test(script.replace(/querySelectorAll\('[^']*'\)/g, '')), '놓을 자리 선을 공용 손 밖에서 긋는다');
});
test('(S) F1: 업데이트 배너에 [변경내역]과 그 창이 없다(버전 글과 [지금 업데이트], ✕ 는 남는다). F6: 그림 넣기 두 경로가 칸으로 포커스를 돌린다', () => {
  assert.ok(!/id="updNotes"|id="updNotesModal"|updNotesVer|updNotesBody|dataset\.notes|\.upd-nv\{|\.upd-nbody\{/.test(app), '배너 변경내역 흔적이 남았다');
  const b = app.slice(app.indexOf('<div id="updateBanner"'), app.indexOf('<div id="updateBanner"') + 900);
  assert.ok(b.includes('id="updNow"') && b.includes('id="updClose"') && b.includes('id="updMsg"'), '배너의 버전 글, [지금 업데이트], ✕ 가 빠졌다');
  assert.ok(!b.includes('변경내역'), '배너에 변경내역 글자가 남았다');
  const bind = extractFunction(app, 'rptMBind');
  assert.ok(bind.includes("rptMImgAdd(uid, 'clipboard').then(() => rptMFocusBack(uid));"), 'Ctrl+V 넣기 뒤 포커스를 칸으로 돌리지 않는다');
  assert.ok(bind.includes('await rptMImgAdd(id, mode);\n    rptMFocusBack(id);'), '메뉴로 넣은 뒤 포커스를 칸으로 돌리지 않는다');
});

// ══════════════════════════════════════════════════════════════════════
// (R) 런타임(jsdom)
// ══════════════════════════════════════════════════════════════════════
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;

if (!JSDOM) {
  skip('item-order: jsdom 미설치로 런타임 검증을 건너뜁니다', SKIP_NO_JSDOM,
    `이 파일의 test 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았습니다.`);
} else {
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  function bootWindow(src, url) {
    const { window: w } = new JSDOM(src || app, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: url || 'https://tcapp.local/',
      beforeParse(window) {
        window.chrome = { webview: { postMessage() {}, addEventListener() {}, removeEventListener() {} } };
        if (typeof window.crypto === 'undefined') window.crypto = { randomUUID: () => 'u-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        window.scrollTo = () => {};
        window.HTMLElement.prototype.scrollIntoView = function () {};
        if (!window.CSS) window.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
      },
    });
    const doc = w.document;
    return { w, doc, ev: (code) => w.eval(code), $: (s) => doc.querySelector(s), $$: (s) => [...doc.querySelectorAll(s)], close: () => { try { w.close(); } catch (_) {} } };
  }
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const CAT = (id, name) => ({ id, name, color: '#3e5be0', desc: '', createdAt: '2026-09-01T00:00:00Z' });
  const ENT = (id, date, o) => Object.assign({ id, date, title: '(예시) 일정 ' + id, categoryId: 'c-a', allDay: false, startTime: '', endTime: '', endDate: '', memo: '', location: '', recur: null, recurExcept: [], createdAt: '2026-09-01T00:00:00Z' }, o || {});
  const TODO = (id, due, o) => Object.assign({ id, text: '(예시) 할 일 ' + id, done: false, categoryId: 'c-a', due, endDate: '', prio: 'normal', completedAt: '', note: '', dayNotes: {}, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }, o || {});
  //  T = 오늘: 일정 7건(배열 순서 e1..e7, 시각은 거꾸로, 종일은 가운데), 그 사이에 다른 날 일정 x1. 할 일 4건(중요, 완료가 섞임)
  function data(T) {
    const D2 = ymdAdd(T, Number(T.slice(8)) <= 20 ? 2 : -2);
    return { D2, data: {
      categories: [CAT('c-a', '(예시) 관제 고도화')],
      entries: [
        ENT('e1', T, { startTime: '16:00', endTime: '17:00' }), ENT('x1', D2, { startTime: '09:00' }), ENT('e2', T, { startTime: '15:00' }),
        ENT('e3', T, { allDay: true }), ENT('e4', T, { startTime: '13:00' }), ENT('e5', T, { startTime: '11:00' }),
        ENT('e6', T, { startTime: '09:00' }), ENT('e7', T, { startTime: '08:00', createdAt: '2026-08-01T00:00:00Z' }),
      ],
      todos: [TODO('t1', T, { done: true, completedAt: '2026-09-02T00:00:00Z' }), TODO('t2', T), TODO('t3', T, { prio: 'high' }), TODO('t4', T, { prio: 'high', done: true, completedAt: '2026-09-02T00:00:00Z' })],
      taskHours: {}, attendance: {},
    } };
  }
  async function boot(src, url, meta, mk) {
    const W = bootWindow(src, url);
    await settle();
    const T = W.ev('todayYmd()'), d = (mk || data)(T);
    W.T = T; W.D2 = d.D2;
    W.w.__applyState(JSON.stringify(d.data), meta || META);
    W.ev(`view = {y: ${Number(T.slice(0, 4))}, m: ${Number(T.slice(5, 7)) - 1}}; selectedDate = "${T}"; setCalView("month"); renderAll();`);
    await settle();
    //  저장 횟수를 센다(dpOrderApply 는 앱의 save() 길로 저장한다)
    W.ev('window.__saves = 0; (function(){ var s = window.save; window.save = function(){ window.__saves++; return s.apply(this, arguments); }; })();');
    //  jsdom 은 배치를 모른다. 본문은 크고(자동 스크롤 없음), 카드와 할 일 줄은 50px 간격으로 선다
    W.ev(`Element.prototype.getBoundingClientRect = function(){
      var t = 0, h = 0;
      if(this.id === 'dpBody'){ t = 0; h = 10000; }
      else if(this.matches && this.matches('.dp-cards > .card, .dp-todos > .todo-row')){
        var sib = Array.prototype.filter.call(this.parentElement.children, function(x){ return x.matches('.card, .todo-row'); });
        t = (this.classList.contains('card') ? 100 : 2000) + sib.indexOf(this) * 50; h = 40;
      }
      return { top: t, bottom: t + h, left: 0, right: 200, width: 200, height: h, x: 0, y: t, toJSON: function(){ return {}; } };
    };`);
    return W;
  }
  const evRows = (W) => W.$$('#dpBody .dp-grp[data-grp="ev"] .card').map((r) => r.dataset.id);
  const tdRows = (W) => W.$$('#dpBody .dp-grp[data-grp="td"] .todo-row').map((r) => r.dataset.id);
  const ids = (W, k) => W.ev(`JSON.stringify(state.${k}.map(function(x){ return x.id; }))`);
  const arr = (W, k) => JSON.parse(ids(W, k));
  const saves = (W) => W.ev('window.__saves');
  //  포인터: jsdom 에 PointerEvent 가 없어 MouseEvent 에 이름만 붙인다(pointerId 없음 = 같은 포인터)
  const ptr = (W, el, type, y) => el.dispatchEvent(new W.w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: y }));
  const yOf = (i, base) => (base || 100) + i * 50 + 10;
  const key = (W, el, k, o) => el.dispatchEvent(new W.w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})));
  //  월간 칸(막대 달력)과 주간 줄에서 그날을 덮는 칩을 차선 순서로
  const cellOrder = (W, ds) => W.ev(`(function(){
    var c = document.querySelector('#grid .cell[data-date="${ds}"]'); var row = c.closest('.gridrow') || c.closest('.wr-table');
    var cells = Array.prototype.slice.call(row.querySelectorAll('.cell[data-date]')); var col = cells.indexOf(c) % 7;
    return JSON.stringify(Array.prototype.filter.call(row.querySelectorAll('.chip-bar'), function(b){ return Number(b.dataset.c0) <= col && Number(b.dataset.c1) >= col; })
      .sort(function(a, b){ return Number(a.dataset.lane) - Number(b.dataset.lane); }).map(function(b){ return b.dataset.todo || b.dataset.id; }));
  })()`);

  const checks = {
    //  배열 순서가 패널, 월간 칸, 주간 줄, 검색 결과에 그대로
    async order(src) {
      const W = await boot(src);
      try {
        assert.deepStrictEqual(evRows(W), ['e1', 'e2', 'e3', 'e4', 'e5'], '날짜 패널 일정이 배열 순서가 아니다(시각, 종일로 다시 세웠다)');
        assert.deepStrictEqual(tdRows(W), ['t1', 't2', 't3', 't4'], '날짜 패널 할 일이 배열 순서가 아니다(중요 먼저, 완료는 아래로 다시 세웠다)');
        assert.deepStrictEqual(JSON.parse(cellOrder(W, W.T)), ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 't1', 't2', 't3', 't4'], '월간 칸이 일정(배열 순서) 다음 할 일(배열 순서)이 아니다');
        W.ev('setCalView("week"); renderAll();');
        const wk = W.ev(`(function(){
          var hd = Array.prototype.slice.call(document.querySelectorAll('#grid .wr-hd[data-date]')); var col = hd.findIndex(function(h){ return h.dataset.date === "${W.T}"; });
          return JSON.stringify(Array.prototype.filter.call(document.querySelectorAll('#grid .wr-table .chip-bar'), function(b){ return Number(b.dataset.c0) <= col && Number(b.dataset.c1) >= col; })
            .sort(function(a, b){ return Number(a.dataset.lane) - Number(b.dataset.lane); }).map(function(b){ return b.dataset.todo || b.dataset.id; }));
        })()`);
        assert.deepStrictEqual(JSON.parse(wk), ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 't1', 't2', 't3', 't4'], '주간 줄이 배열 순서가 아니다');
        W.ev('setCalView("month"); renderAll();');
        //  검색 결과: 넣은 목록 순서와 무관하게 그 날짜 안은 배열 순서
        const html = W.ev('groupByDateHtml(state.entries.slice().reverse(), "", true)');
        const box = W.doc.createElement('div'); box.innerHTML = html;
        const s = [...box.querySelectorAll('.s-row')].map((b) => b.dataset.id).filter((id) => id !== 'x1');
        assert.deepStrictEqual(s, ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'], '검색 결과가 배열 순서가 아니다');
        //  ★ 를 켜고 끝내도 자리는 그대로
        W.$('#dpBody .todo-row[data-id="t2"] [data-act="star"]').click();
        W.$('#dpBody .todo-row[data-id="t3"] [data-act="toggle"]').click();
        assert.deepStrictEqual(tdRows(W), ['t1', 't2', 't3', 't4'], '★ 나 완료로 할 일 자리가 바뀌었다');
      } finally { W.close(); }
    },
    //  일정 끌기: 접힌 일정 펴기, 놓을 자리 선, 놓으면 배열에서 보이는 이웃 앞으로, 저장, 다시 접힘, 달력도 같은 순서
    async dragEvent(src) {
      const W = await boot(src);
      try {
        assert.strictEqual(evRows(W).length, 5);
        const grip = W.$('#dpBody .card[data-id="e5"] .card-top > .dp-grip');
        assert.ok(grip && grip.textContent === '⠿' && grip.nextElementSibling.classList.contains('cat-tag'), '카드 손잡이가 맨 윗줄 과제 표 앞에 없다');
        ptr(W, grip, 'pointerdown', yOf(4));
        ptr(W, W.doc, 'pointermove', yOf(4) + 3);
        assert.strictEqual(evRows(W).length, 5, '5px 안쪽 움직임에 끌기가 시작됐다');
        ptr(W, W.doc, 'pointermove', yOf(4) + 12);
        assert.deepStrictEqual(evRows(W), ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'], '끌기를 시작했는데 접힌 일정이 펴지지 않았다');
        assert.ok(!W.$('#dpBody .dp-more[data-k="ev"]'), '끄는 동안 더 보기가 남았다');
        assert.ok(W.$('#dpBody .card[data-id="e5"]').classList.contains('cat-drag-src'), '원래 자리가 흐려지지 않았다');
        const gh = W.$('body > .card.cat-drag-ghost');
        assert.ok(gh && W.doc.body.classList.contains('cat-dragging') && !gh.hasAttribute('data-id'), '복제본(.cat-drag-ghost)이 따라오지 않는다');
        ptr(W, W.doc, 'pointermove', 105);   // 첫 카드 가운데(120)보다 위
        assert.ok(W.$('#dpBody .card[data-id="e1"]').classList.contains('cat-drop-before'), '놓을 자리 선이 첫 카드 위에 없다');
        ptr(W, W.doc, 'pointerup', 105);
        assert.deepStrictEqual(arr(W, 'entries'), ['e5', 'e1', 'x1', 'e2', 'e3', 'e4', 'e6', 'e7'], '보이는 이웃(e1) 앞으로 옮기지 않았거나 그날 안 보이는 x1 의 자리가 바뀌었다');
        assert.strictEqual(saves(W), 1, '놓은 뒤 저장하지 않았다');
        assert.strictEqual(W.ev('DP.dragAll'), false);
        assert.deepStrictEqual(evRows(W), ['e5', 'e1', 'e2', 'e3', 'e4'], '놓은 뒤 다시 5개로 접히지 않았거나 패널이 새 순서가 아니다');
        assert.ok(W.$('#dpBody .dp-more[data-k="ev"]') && !W.$('.cat-drag-ghost') && !W.doc.body.classList.contains('cat-dragging') && !W.$('#dpBody .cat-drag-src, #dpBody .cat-drop-before'), '끌기 흔적이 남았다');
        assert.strictEqual(JSON.parse(cellOrder(W, W.T))[0], 'e5', '월간 칸이 새 순서로 다시 그려지지 않았다');
        //  제자리에 놓으면 아무것도 바꾸지 않는다
        ptr(W, W.$('#dpBody .card[data-id="e2"] .dp-grip'), 'pointerdown', yOf(2));
        ptr(W, W.doc, 'pointermove', yOf(2) + 10);
        assert.ok(!W.$('#dpBody .cat-drop-before, #dpBody .cat-drop-after'), '제자리에 선을 그었다');
        ptr(W, W.doc, 'pointerup', yOf(2) + 10);
        assert.strictEqual(saves(W), 1, '제자리에 놓았는데 저장했다');
        assert.deepStrictEqual(evRows(W).length, 5, '제자리에 놓은 뒤 접힘이 돌아오지 않았다');
      } finally { W.close(); }
    },
    //  Esc 는 취소: 배열, 저장, 접힘 그대로
    async esc(src) {
      const W = await boot(src);
      try {
        const before = ids(W, 'entries');
        ptr(W, W.$('#dpBody .card[data-id="e4"] .dp-grip'), 'pointerdown', yOf(3));
        ptr(W, W.doc, 'pointermove', 105);
        assert.strictEqual(evRows(W).length, 7, '끌기를 시작했는데 펴지지 않았다');
        key(W, W.doc.body, 'Escape');
        assert.strictEqual(ids(W, 'entries'), before, 'Esc 가 순서를 바꿨다');
        assert.strictEqual(saves(W), 0, 'Esc 뒤 저장했다');
        assert.deepStrictEqual(evRows(W), ['e1', 'e2', 'e3', 'e4', 'e5'], 'Esc 뒤 접힘이 돌아오지 않았다');
        assert.ok(!W.$('.cat-drag-ghost') && !W.doc.body.classList.contains('cat-dragging'), 'Esc 뒤 끌기 흔적이 남았다');
        ptr(W, W.doc, 'pointerup', 105);
        assert.strictEqual(ids(W, 'entries'), before, 'Esc 뒤 놓기가 순서를 바꿨다');
        //  창 포커스를 잃어도 취소
        ptr(W, W.$('#dpBody .card[data-id="e4"] .dp-grip'), 'pointerdown', yOf(3));
        ptr(W, W.doc, 'pointermove', 105);
        W.w.dispatchEvent(new W.w.Event('blur'));
        assert.ok(!W.$('.cat-drag-ghost') && evRows(W).length === 5 && ids(W, 'entries') === before, '창 포커스를 잃었는데 끌기가 남았다');
      } finally { W.close(); }
    },
    //  할 일 끌기: 체크 앞 손잡이, 아래로 놓기
    async dragTodo(src) {
      const W = await boot(src);
      try {
        const g = W.$('#dpBody .todo-row[data-id="t1"] > .dp-grip');
        assert.ok(g && g.nextElementSibling.classList.contains('todo-check'), '할 일 손잡이가 체크 앞에 없다');
        ptr(W, g, 'pointerdown', yOf(0, 2000));
        ptr(W, W.doc, 'pointermove', yOf(2, 2000) + 20);   // t3 위(내 과제와 같은 규칙: 포인터 아래 항목이 대상, 아래로 옮기면 그 항목 아래쪽 선)
        assert.ok(W.$('#dpBody .todo-row[data-id="t3"]').classList.contains('cat-drop-after'), '할 일을 아래로 옮길 때 대상(t3) 아래쪽에 선이 없다(내 과제와 다른 규칙)');
        assert.ok(!W.$('#dpBody .todo-row[data-id="t4"]').classList.contains('cat-drop-before'), '다음 항목 위쪽에 선을 긋는다(옛 가운데 규칙)');
        ptr(W, W.doc, 'pointerup', yOf(2, 2000) + 20);
        assert.deepStrictEqual(arr(W, 'todos'), ['t2', 't3', 't1', 't4'], '할 일을 t3 뒤로 옮기지 않았다');
        assert.deepStrictEqual(tdRows(W), ['t2', 't3', 't1', 't4']);
        assert.strictEqual(saves(W), 1);
      } finally { W.close(); }
    },
    //  Alt+↑↓: 한 칸, 포커스는 옮긴 항목의 같은 자리, 접힌 자리로 내리면 편다
    async keys(src) {
      const W = await boot(src);
      try {
        const ed = W.$('#dpBody .card[data-id="e2"] [data-act="edit"]'); ed.focus();
        key(W, ed, 'ArrowUp', { altKey: true });
        assert.deepStrictEqual(arr(W, 'entries'), ['e2', 'e1', 'x1', 'e3', 'e4', 'e5', 'e6', 'e7'], 'Alt+↑ 가 한 칸 올리지 않았다');
        assert.deepStrictEqual(evRows(W).slice(0, 2), ['e2', 'e1']);
        const a = W.doc.activeElement;
        assert.ok(a && a.dataset.act === 'edit' && a.closest('.card').dataset.id === 'e2', 'Alt+↑ 뒤 포커스가 옮긴 카드의 [수정]이 아니다');
        key(W, a, 'ArrowUp', { altKey: true });
        assert.strictEqual(saves(W), 1, '맨 위에서 Alt+↑ 가 저장했다');
        //  다섯째(e5)를 Alt+↓: 접힌 자리로 가니 편다
        const e5 = W.$('#dpBody .card[data-id="e5"] [data-act="edit"]'); e5.focus();
        key(W, e5, 'ArrowDown', { altKey: true });
        assert.deepStrictEqual(evRows(W), ['e2', 'e1', 'e3', 'e4', 'e6', 'e5', 'e7'], 'Alt+↓ 가 접힌 자리로 내리면서 펴지 않았다');
        assert.strictEqual(W.doc.activeElement.closest('.card').dataset.id, 'e5', 'Alt+↓ 뒤 포커스가 옮긴 카드가 아니다');
        //  할 일 제목에서 Alt+↓
        const tt = W.$('#dpBody .todo-row[data-id="t1"] .todo-text'); tt.focus();
        key(W, tt, 'ArrowDown', { altKey: true });
        assert.deepStrictEqual(arr(W, 'todos'), ['t2', 't1', 't3', 't4'], '할 일 Alt+↓ 가 한 칸 내리지 않았다');
        assert.ok(W.doc.activeElement.classList.contains('todo-text') && W.doc.activeElement.closest('.todo-row').dataset.id === 't1', '할 일 Alt+↓ 뒤 포커스가 그 제목이 아니다');
        assert.strictEqual(saves(W), 3);
        //  Alt 없는 화살표는 순서를 바꾸지 않는다
        key(W, W.doc.activeElement, 'ArrowDown');
        assert.deepStrictEqual(arr(W, 'todos'), ['t2', 't1', 't3', 't4']);
      } finally { W.close(); }
    },
  };

  test('(R) 배열 순서가 날짜 패널, 월간 칸, 주간 줄, 검색 결과에 그대로(시각, 중요, 완료로 다시 세우지 않음)', () => checks.order());
  test('(R) 일정 끌기: 5px 넘어야 시작, 접힌 일정 펴기, 복제본과 45%와 놓을 자리 선, 보이는 이웃 앞으로 옮기고 저장, 다시 접힘, 달력도 새 순서, 제자리면 그대로', () => checks.dragEvent());
  test('(R) Esc 와 창 포커스 잃기는 취소: 배열, 저장, 접힘 그대로', () => checks.esc());
  test('(R) 할 일 끌기: 손잡이는 체크 앞, 놓은 자리로 옮기고 저장', () => checks.dragTodo());
  test('(R) Alt+↑ / Alt+↓: 한 칸, 포커스는 옮긴 항목에, 접힌 자리로 내리면 편다', () => checks.keys());

  test('(R) 열람 창(PEER): 손잡이가 없고 Alt+↑ 도 순서를 바꾸지 않는다. 보이는 순서는 그 사람의 배열 순서', async () => {
    const W = await boot(app, 'https://tcapp.local/?peer=1', { peerName: '(예시) 홍길동', canWrite: false });
    try {
      assert.strictEqual(W.ev('PEER'), true);
      assert.ok(evRows(W).length === 5 && tdRows(W).length === 4, '열람 창에 카드와 할 일이 그려지지 않았다');
      assert.deepStrictEqual(evRows(W), ['e1', 'e2', 'e3', 'e4', 'e5'], '열람 창의 순서가 그 사람의 배열 순서가 아니다');
      assert.strictEqual(W.$$('#dpBody .dp-grip, #dpBody [data-dpgrip]').length, 0, '열람 창에 손잡이가 있다');
      const before = ids(W, 'entries');
      const t = W.$('#dpBody .card[data-id="e2"]'); t.setAttribute('tabindex', '-1'); t.focus();
      key(W, t, 'ArrowUp', { altKey: true });
      assert.strictEqual(ids(W, 'entries'), before, '열람 창에서 Alt+↑ 가 순서를 바꿨다');
    } finally { W.close(); }
  });

  test('(R) F1: 새 버전 배너는 버전 글, [지금 업데이트], ✕ 뿐이고 [변경내역]이 없다', async () => {
    const W = bootWindow(app);
    try {
      await settle();
      W.w.__updateAvailable(JSON.stringify({ version: '9.9.9', notes: '' }));
      const b = W.$('#updateBanner');
      assert.ok(!b.classList.contains('hidden') && /9\.9\.9/.test(W.$('#updMsg').textContent), '배너가 버전을 알리지 않는다');
      assert.deepStrictEqual([...b.querySelectorAll('button')].map((x) => x.id), ['updNow', 'updClose'], '배너 단추가 [지금 업데이트], ✕ 가 아니다');
      assert.ok(!W.$('#updNotes, #updNotesModal') && !/변경내역/.test(b.textContent), '배너 변경내역이 남았다');
    } finally { W.close(); }
  });

  test('(R) F6: 그림을 넣고 칸이 다시 그려져 포커스가 빠지면(견본이 늦게 와도) 그 칸으로 돌아온다. 사용자가 옮긴 포커스는 그대로', async () => {
    const W = bootWindow(app);
    try {
      await settle();
      W.ev(extractFunction(app, 'rptMFocusBack') + '; window.__fb = rptMFocusBack;');
      const pick = W.$('#rptmPick');
      assert.ok(pick, '#rptmPick 이 없다');
      const slot = (html) => { W.$('#rptmPick .rptm-it[data-uid="u1"] [data-slot]').innerHTML = html; };
      pick.innerHTML = '<div class="rptm-it" data-uid="u1"><label class="check"><input type="checkbox" data-act="pick"></label><span class="rptm-slotw" data-slot></span></div>';
      slot('<button type="button" class="rptm-slot" data-act="imgAdd" disabled>+</button>');   // 넣는 동안(잠김)
      W.doc.body.focus();
      W.ev('__fb("u1")');
      //  넣기가 끝나 그림 칸으로 다시 그려졌다
      slot('<span class="rptm-slot has"><button type="button" class="z" data-act="imgZoom">z</button><button type="button" class="x" data-act="imgDel">x</button></span>');
      await settle();
      assert.strictEqual(W.doc.activeElement && W.doc.activeElement.dataset.act, 'imgZoom', '다시 그린 뒤 포커스가 칸으로 돌아오지 않았다');
      //  견본 그림이 와서 또 다시 그렸다(포커스가 빠진다)
      slot('<span class="rptm-slot has"><button type="button" class="z" data-act="imgZoom"><img alt=""></button><button type="button" class="x" data-act="imgDel">x</button></span>');
      await settle();
      assert.strictEqual(W.doc.activeElement && W.doc.activeElement.dataset.act, 'imgZoom', '견본이 온 뒤 포커스가 칸으로 돌아오지 않았다');
      //  사용자가 다른 곳으로 옮긴 포커스는 건드리지 않는다
      const cb = W.$('#rptmPick input[data-act="pick"]'); cb.focus();
      slot('<span class="rptm-slot has"><button type="button" class="z" data-act="imgZoom">z2</button></span>');
      await settle();
      assert.strictEqual(W.doc.activeElement, cb, '사용자가 옮긴 포커스를 빼앗았다');
    } finally { W.close(); }
  });

  // ── 0.28.0 검토 P2 ──
  //  실행 취소는 지운 자리로(배열 자리가 곧 순서). 자리를 모르거나 배열이 짧아졌으면 끝
  checks.undo = async (src) => {
    const W = await boot(src);
    try {
      W.ev(`window.__e = entryById('e3'); window.__ei = state.entries.indexOf(__e); deleteEntry('e3');
        window.__t = todoById('t2'); window.__ti = state.todos.indexOf(__t); deleteTodo('t2');`);
      W.ev('restoreEntry(__e, __ei); restoreTodo(__t, __ti); renderAll();');
      assert.deepStrictEqual(arr(W, 'entries'), ['e1', 'x1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'], '실행 취소가 일정을 지운 자리로 되돌리지 않았다');
      assert.deepStrictEqual(arr(W, 'todos'), ['t1', 't2', 't3', 't4'], '실행 취소가 할 일을 지운 자리로 되돌리지 않았다');
      assert.deepStrictEqual(evRows(W), ['e1', 'e2', 'e3', 'e4', 'e5'], '되살린 일정이 패널에서 원래 자리가 아니다');
      W.ev("window.__e = entryById('e1'); deleteEntry('e1'); restoreEntry(__e, 99);");
      assert.strictEqual(arr(W, 'entries').at(-1), 'e1', '자리가 배열보다 크면 끝에 붙이지 않았다');
    } finally { W.close(); }
  };
  //  한 날에 같은 반복 일정이 두 번 그려지면(주간 반복, 8일 이상) 줄 번호와 보이는 id 목록이 한 칸 어긋난다. 놓을 대상 id 로 옮긴다
  checks.dupDrag = async (src) => {
    const mk = (T) => ({ D2: T, data: {
      categories: [CAT('c-a', '(예시) 관제 고도화')],
      entries: [ENT('e1', T), ENT('r1', ymdAdd(T, -7), { endDate: ymdAdd(T, 1), recur: { freq: 'weekly', interval: 1 } }), ENT('e2', T), ENT('e3', T)],
      todos: [], taskHours: {}, attendance: {},
    } });
    const W = await boot(src, null, null, mk);
    try {
      assert.deepStrictEqual(evRows(W), ['e1', 'r1', 'r1', 'e2', 'e3'], '시험 전제: 반복 일정이 그날 두 번 그려지지 않는다');
      ptr(W, W.$$('#dpBody .card[data-id="e3"] .dp-grip')[0], 'pointerdown', yOf(4));
      ptr(W, W.doc, 'pointermove', yOf(3));
      assert.ok(W.$('#dpBody .card[data-id="e2"]').classList.contains('cat-drop-before'), '놓을 자리 선이 e2 위에 없다');
      ptr(W, W.doc, 'pointerup', yOf(3));
      assert.deepStrictEqual(arr(W, 'entries'), ['e1', 'r1', 'e3', 'e2'], '선을 그은 e2 앞으로 옮기지 않았다(줄 번호로 옮겨 한 칸 어긋남)');
      assert.strictEqual(saves(W), 1, '옮긴 뒤 저장하지 않았다');
      assert.deepStrictEqual(evRows(W), ['e1', 'r1', 'r1', 'e3', 'e2'], '패널이 새 순서로 다시 그려지지 않았다');
    } finally { W.close(); }
  };
  test('(R) 실행 취소는 지운 자리로 되돌린다(일정, 할 일), 자리가 배열보다 크면 끝', () => checks.undo());
  test('(R) 같은 반복 일정이 한 날 두 번 그려져도 끌어 놓기는 선을 그은 항목 앞뒤로 옮긴다', () => checks.dupDrag());
  test('(S) 실행 취소를 주는 삭제 네 곳이 지우기 전 자리를 잡아 restoreEntry/restoreTodo 에 넘긴다', () => {
    const script = app.slice(app.indexOf('</style>'));
    const calls = script.match(/restore(Entry|Todo)\([^)]*\)/g).filter((c) => !/\(e, idx\)|\(t, idx\)/.test(c));
    assert.strictEqual(calls.length, 4, '실행 취소 부르는 곳이 넷이 아니다: ' + calls.join(', '));
    for (const c of calls) assert.ok(/, (ix|at)\)$/.test(c), '지운 자리를 넘기지 않는다: ' + c);
  });
  checks.ordIdx = async (src) => {
    const W = await boot(src);
    try {
      const r = JSON.parse(W.ev(`(function(){
        itemOrderCmp('e', state.entries[0], state.entries[1]);
        state.entries[2] = Object.assign({}, state.entries[2], { id: 'z9' });
        return JSON.stringify([ordIndexOf('e', { id: 'z9' }), ordIndexOf('e', { id: 'e1', _mine: true }) === undefined]);
      })()`));
      assert.strictEqual(r[0], 2, '제자리 교체로 들어온 id 의 자리를 찾지 못했다(낡은 자리표)');
      assert.strictEqual(r[1], true, '내 겹 항목에 자리를 주었다');
    } finally { W.close(); }
  };
  test('(R) ordIndexOf: 같은 배열에서 길이는 그대로 내용만 바뀌어도(제자리 교체) 새 id 의 자리를 찾는다. 내 겹(m:)은 여전히 없음', () => checks.ordIdx());
  test('(M) ordIndexOf 의 빠른 길을 모든 열쇠에 열면 제자리 교체 시험이 잡는다', async () => {
    const bad = mutate(app, " && c.n === arr.length && k.startsWith('m:')) return undefined;", ' && c.n === arr.length) return undefined;');
    await assert.rejects(() => checks.ordIdx(bad), /낡은 자리표/);
  });
  //  월간 큰 그림: 동시에 둘, 회신 묶음마다 다시 그리기 한 번, 다시 열면 비운다
  checks.prev = async (src) => {
    const W = bootWindow(src || app);
    try {
      await settle();
      W.ev(`window.__pend = []; window.__pv = 0;
        hostRequest = function(cmd, p){ if(cmd !== 'scheduleImagePreview') return new Promise(function(){}); return new Promise(function(res){ __pend.push({ id: p.id, res: res }); }); };
        rptMPreview = function(){ __pv++; }; rptMZoomSync = function(){};
        window.__ok = function(i){ __pend[i].res({ ok: true, data: { dataUrl: 'data:image/png;base64,AA' } }); };
        for(var i = 0; i < 5; i++) rptMImgPrevLoad('u' + i, { id: i, sha256: 's' + i });`);
      assert.strictEqual(W.ev('__pend.length'), 2, '큰 그림 요청이 한꺼번에 나간다(동시에 둘까지가 아니다)');
      W.ev('__ok(0); __ok(1);');
      await settle();
      assert.strictEqual(W.ev('__pend.length'), 4, '회신 뒤 다음 요청이 이어 나가지 않는다');
      assert.strictEqual(W.ev('__pv'), 1, '회신 둘에 문서를 두 번 다시 그렸다(한 프레임에 한 번이 아니다)');
      assert.strictEqual(W.ev('__rptMPrevs.size'), 2);
      W.ev('__ok(2); __ok(3);');
      await settle();
      W.ev('__ok(4);');
      await settle();
      assert.strictEqual(W.ev('__rptMPrevs.size'), 5, '큰 그림 다섯을 다 받지 못했다');
      //  다시 열면 비우고, 그 전 요청의 늦은 회신은 버린다
      W.ev("rptMImgPrevLoad('u9', { id: 9, sha256: 's9' });");
      W.ev('rptMOpen();');
      assert.strictEqual(W.ev('__rptMPrevs.size'), 0, '월간을 다시 열었는데 큰 그림을 비우지 않았다');
      W.ev('__ok(5);');
      await settle();
      assert.strictEqual(W.ev('__rptMPrevs.size'), 0, '다시 연 뒤 지난 요청의 늦은 회신을 받아 두었다');
      assert.strictEqual(W.ev("rptMImgSrc('s0')"), '', '시험 전제: 견본도 없는데 그림이 있다');
      W.ev("__rptMThumbs.set('s0', 'data:image/jpeg;base64,BB')");
      assert.strictEqual(W.ev("rptMImgSrc('s0')"), 'data:image/jpeg;base64,BB', '큰 그림이 없을 때 견본으로 넘어가지 않는다');
    } finally { W.close(); }
  };
  test('(R) 월간 큰 그림: 요청은 동시에 둘, 회신 묶음마다 다시 그리기 한 번, 다시 열면 비우고 늦은 회신은 버린다', () => checks.prev());
  test('(S) 월간을 떠날 때(일간, 주간으로)와 다시 열 때 큰 그림을 놓고, 다시 들어오면 다시 받는다', () => {
    assert.ok(extractFunction(app, 'rptMOpen').includes('rptMPrevReset()'), '다시 열 때 큰 그림을 비우지 않는다');
    assert.ok(extractFunction(app, 'atKindSet').includes("if(ATT.kind === 'sum' && k !== 'sum') rptMPrevReset();"), '월간을 떠날 때 큰 그림을 놓지 않는다');
    assert.ok(extractFunction(app, 'atSumEnter').includes('rptMPrevReload();'), '다시 들어올 때 큰 그림을 다시 받지 않는다');
  });
  //  F6 포커스 되돌리기: 사용자가 누르거나 키를 치면 그만 지킨다
  checks.focusStop = async (src, evType) => {
    const W = bootWindow(src || app);
    try {
      await settle();
      W.ev(extractFunction(src || app, 'rptMFocusBack') + '; window.__fb = rptMFocusBack;');
      const pick = W.$('#rptmPick');
      pick.innerHTML = '<div class="rptm-it" data-uid="u1"><span class="rptm-slotw" data-slot></span></div>';
      const slot = (html) => { W.$('#rptmPick .rptm-it[data-uid="u1"] [data-slot]').innerHTML = html; };
      slot('<span class="rptm-slot has"><button type="button" class="z" data-act="imgZoom">z</button></span>');
      W.doc.body.focus();
      W.ev('__fb("u1")');
      assert.strictEqual(W.doc.activeElement && W.doc.activeElement.dataset.act, 'imgZoom', '시험 전제: 처음 되돌리기가 되지 않았다');
      //  사용자가 빈 곳을 눌렀다(또는 키를 쳤다): 포커스는 body 로 간다
      if (evType === 'key') W.doc.body.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      else W.doc.body.dispatchEvent(new W.w.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      W.doc.activeElement.blur();
      slot('<span class="rptm-slot has"><button type="button" class="z" data-act="imgZoom"><img alt=""></button></span>');
      await settle();
      assert.ok(!W.doc.activeElement || W.doc.activeElement.dataset.act !== 'imgZoom', '사용자가 누른 뒤에도 다시 그리기가 포커스를 칸으로 끌어왔다');
    } finally { W.close(); }
  };
  test('(R) F6: 사용자가 누르면(pointerdown) 포커스 되돌리기를 멈춘다', () => checks.focusStop(app, 'ptr'));
  test('(R) F6: 사용자가 키를 치면(keydown) 포커스 되돌리기를 멈춘다', () => checks.focusStop(app, 'key'));

  // ══════════════════════════════════════════════════════════════════════
  // (M) 변이
  // ══════════════════════════════════════════════════════════════════════
  test('(M) 실행 취소를 끝에 붙이기(push)로 되돌리면 실행 취소 시험이 잡는다', async () => {
    const bad = mutate(app, 'if(Number.isInteger(idx) && idx >= 0 && idx <= arr.length) arr.splice(idx, 0, x); else arr.push(x);', 'arr.push(x);');
    await assert.rejects(() => checks.undo(bad), /지운 자리로/);
  });
  test('(M) 끌어 놓기를 줄 번호(dpOrderApply index)로 되돌리면 반복 두 번 시험이 잡는다', async () => {
    const bad = mutate(app, 'dpOrderApplyRel(d.k, drop.id, drop.target, drop.after)', 'dpOrderApply(d.k, drop.id, drop.index)');
    await assert.rejects(() => checks.dupDrag(bad), /한 칸 어긋남|저장하지 않았다/);
  });
  test('(M) 큰 그림 동시 요청 한도를 빼면 월간 큰 그림 시험이 잡는다', async () => {
    const bad = mutate(app, 'while(P.busy < RPTM_PREV_MAX && P.q.length){', 'while(P.q.length){');
    await assert.rejects(() => checks.prev(bad), /동시에 둘/);
  });
  test('(M) 다시 그리기 묶기를 빼면 월간 큰 그림 시험이 잡는다', async () => {
    const bad = mutate(app, '  P.zoom.add(id);\n  if(P.paint) return;\n', '  P.zoom.add(id);\n  P.paint = 0;\n');
    await assert.rejects(() => checks.prev(bad), /한 프레임에 한 번/);
  });
  test('(M) 다시 열 때 큰 그림을 비우지 않으면 월간 큰 그림 시험이 잡는다', async () => {
    const bad = mutate(app, '  __rptMPrevs.clear(); __rptMPrevReq.clear();\n', '  __rptMPrevReq.clear();\n');
    await assert.rejects(() => checks.prev(bad), /비우지 않았다/);
  });
  test('(M) F6 에서 사용자 입력에 멈추지 않으면 포커스 시험이 잡는다', async () => {
    const bad = mutate(app, "    document.addEventListener('pointerdown', stop, true); document.addEventListener('keydown', stop, true);\n", '');
    await assert.rejects(() => checks.focusStop(bad, 'ptr'), /끌어왔다/);
  });
  test('(M) 일정 비교를 시각순으로 되돌리면 순서 시험이 잡는다', async () => {
    const bad = mutate(app, "function entrySort(a, b){ return itemOrderCmp('e', a, b); }", "function entrySort(a, b){ return (a.startTime||'99:99').localeCompare(b.startTime||'99:99'); }");
    await assert.rejects(() => checks.order(bad), /배열 순서/);
  });
  test('(M) 할 일 비교에 중요 먼저를 되살리면 순서 시험이 잡는다', async () => {
    const bad = mutate(app, "function todoZoneCmp(a, b){ return itemOrderCmp('t', a, b); }", "function todoZoneCmp(a, b){ return ((b.prio === 'high') - (a.prio === 'high')) || itemOrderCmp('t', a, b); }");
    await assert.rejects(() => checks.order(bad), /배열 순서|중요 먼저/);
  });
  test('(M) 끌 때 접힌 일정을 펴지 않으면 끌기 시험이 잡는다', async () => {
    const bad = mutate(app, "{ DP.dragAll = true; renderPanel(); }", '{}');
    await assert.rejects(() => checks.dragEvent(bad), /펴지지 않았다/);
  });
  test('(M) 옮긴 뒤 저장하지 않으면 끌기 시험이 잡는다', async () => {
    const bad = mutate(app, '  if(!orderMoveRel(arr, id, target, after)) return false;\n  save();\n', '  if(!orderMoveRel(arr, id, target, after)) return false;\n');
    await assert.rejects(() => checks.dragEvent(bad), /저장하지 않았다/);
  });
  test('(M) Esc 를 받지 않으면 Esc 시험이 잡는다', async () => {
    const bad = mutate(app, "  function key(ev){ if(ev.key === 'Escape' && d && d.on){ ev.preventDefault(); ev.stopImmediatePropagation(); end(false); } }\n  root.addEventListener('pointerdown'", "  function key(){}\n  root.addEventListener('pointerdown'");
    await assert.rejects(() => checks.esc(bad), /Esc/);
  });
  test('(M) 공용 손의 놓을 자리 규칙을 옛 가운데 기준(늘 다음 항목 위쪽)으로 되돌리면 할 일 끌기 시험이 잡는다', async () => {
    const bad = mutate(app, '    const after = ti > from;\n', '    const after = false;\n');
    await assert.rejects(() => checks.dragTodo(bad), /아래쪽에 선이 없다/);
  });
  test('(M) Alt+↓ 가 접힌 자리에서 펴지 않으면 키보드 시험이 잡는다', async () => {
    const bad = mutate(app, "  if(!up && i + 1 >= DP_LIMIT) DP.more.add(kind === 't' ? 'td' : 'ev');", '');
    await assert.rejects(() => checks.keys(bad), /펴지 않았다|포커스/);
  });
}
