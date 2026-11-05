// 날짜 패널 묶음 접기(docs/PC-WATCH-2.md §5, docs/PERSONAL-PANEL.md 2.1 의 연장). 시안 dist/proto/day-panel-v1.html(B안).
// 펼침은 2차(§7.1, 시안 dist/proto/day-panel-v3.html)에서 카드 상자 대신 들여쓴 상세로 바뀌었다. 자세한 계약은 tests/pc-watch-7.test.mjs.
//
// 이 파일이 지키는 것:
//   (S) 정적: 일정 줄과 들여쓴 상세(dpEvDetHtml, 카드 상자 없음), 5개 제한, 더 보기 열쇠(ev, td, 열람 창 두 묶음 peer, mine), 접기 기억 키(계정별, 열람 창은 기억 안 함),
//       새 CSS 는 토큰만(hex 없음), 금지 기호 없음.
//   (R) 런타임(jsdom):
//       두 묶음 고정은 그대로, 머리를 누르면 접히고(▾ ▸, aria-expanded) 계정별로 기억, 다시 열어도 접힌 채.
//       묶음마다 5개까지, "n개 더 보기"와 "줄이기", 날짜를 바꾸면 다시 5개. 보통 날(5개 이하)은 더 보기가 없다.
//       일정은 한 줄 줄(시간 또는 종일, 제목), 누르면 그 자리에서 들여쓴 상세로(한 번에 하나), 상세의 수정 단추(data-act)가 그대로 돈다.
//       달력 칩에서 온 강조(flash): 5개 밖의 일정이면 더 보기를 열고 그 줄을 펼친다, 접힌 묶음은 편다. 할 일도 5개 밖이면 더 보기.
//       할 일 줄은 제목 두 줄까지(전체는 title), 체크와 ★ 그대로, 제목을 누르면 같은 들여쓴 상세(인라인 수정 폼 없음).
//   (M) 변이: 5개 제한을 빼거나, 날짜를 바꿔도 더 보기가 남거나, 접기를 기억하지 않으면 위 시험이 잡는다.
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
test('(S) 일정은 한 줄 줄이고 펼치면 들여쓴 상세(dpEvDetHtml, 카드 상자 없음), 묶음마다 5개 제한, 열람 창 두 묶음도 같은 줄과 제한', () => {
  assert.ok(/const DP_LIMIT = 5;/.test(app), '5개 제한 값이 없다');
  const row = extractFunction(app, 'dpEvRowHtml');
  assert.ok(row.includes('dpEvDetHtml(e, ov)') && !row.includes('cardHtml(') && row.includes('data-dp="ev"') && row.includes('aria-expanded'), '일정 줄이 펼치면 들여쓴 상세(dpEvDetHtml)가 아니다(§7.1, 카드 상자 없음)');
  const dd = extractFunction(app, 'dayDetailHtml');
  assert.ok(dd.includes("dpLimit('ev', list)") && dd.includes("dpMoreHtml('ev', list.length)"), '일정 묶음에 5개 제한이 없다');
  assert.ok(dd.includes("dpLimit('td', tds)") && dd.includes("dpMoreHtml('td', tds.length)"), '할 일 묶음에 5개 제한이 없다');
  assert.ok(dd.includes('dpLimit(cls, items)') && dd.includes('dpMoreHtml(cls, items.length)'), '열람 창 두 묶음(상대 일정, 내 일정)에 같은 제한이 없다');
  assert.ok(!dd.includes('cardHtml('), '패널 본문이 아직 카드를 바로 그린다(한 줄 줄이어야 한다)');
  assert.ok(dd.indexOf('dpSync()') < dd.indexOf('dpReveal('), '날짜 바뀜 정리(dpSync)가 강조 펼치기(dpReveal)보다 먼저가 아니다');
});
test('(S) 접기 기억: 계정별 이 PC(tc_dpfold:<계정>, 보기 설정 tc_view 와 같은 방식), 열람 창은 기억하지 않는다', () => {
  assert.ok(extractFunction(app, 'dpFoldKey').includes("'tc_dpfold:' + rptDraftWho()"), '접기 기억 키가 계정별이 아니다');
  assert.ok(/if\(PEER\) return;/.test(extractFunction(app, 'dpFoldSave')), '열람 창이 접기를 기억한다');
  assert.ok(/if\(PEER\) return DP\.fold;/.test(extractFunction(app, 'dpFoldSet')), '열람 창이 저장된 접기를 읽는다');
});
test('(S) 새 함수와 CSS: 금지 기호 없음, hex 색 없음(토큰만)', () => {
  const fns = ['dpFoldSet', 'dpFoldSave', 'dpSync', 'dpLimit', 'dpMoreHtml', 'dpEvRowHtml', 'dpEvDetHtml', 'dpTdDetHtml', 'dpDetLn', 'dpReveal', 'dpOnClick', 'dayGrpHtml', 'dayDetailHtml'].map((n) => extractFunction(app, n)).join('\n');
  assert.ok(!/[—–「」]/.test(fns) && !/(^|\s)·(\s|$)/m.test(fns), '새 함수에 엠 대시, 낫표, 띄어 쓴 가운데 점이 있다');
  const mine = css.split('\n').filter((l) => /\.dp-(fold|tw|er|more|det)|\.dp-grp\.folded|\.dp-rows|\.dp-todos \.todo-text/.test(l));
  assert.ok(mine.length >= 12, '새 CSS 규칙을 찾지 못했다: ' + mine.length);
  assert.ok(mine.every((l) => !/#[0-9a-fA-F]{3,8}\b/.test(l)), '새 CSS 에 hex 색이 있다: ' + mine.find((l) => /#[0-9a-fA-F]{3,8}\b/.test(l)));
  assert.ok(/\.dp-todos \.todo-text\{[^}]*-webkit-line-clamp:2[^}]*overflow:hidden/.test(css), '할 일 제목이 두 줄 자르기가 아니다(한 줄 말줄임은 좁은 패널에서 앞머리만 남는다)');
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
  //  T = 오늘: 일정 8건(시간 08:00 ~ 15:00, 첫째는 종일), 할 일 7건. D2 = 같은 달 다른 날: 일정 3건, 할 일 2건(보통 날)
  function data(T, D2) {
    const LONG = '아주 긴 할 일 제목 '.repeat(8).trim();
    return {
      categories: [CAT('c-a', '알파')],
      entries: [
        ENT('e0', T, { allDay: true, title: '종일 일정' }),
        ...[1, 2, 3, 4, 5, 6, 7].map((i) => ENT('e' + i, T, { startTime: String(7 + i).padStart(2, '0') + ':00', endTime: String(8 + i).padStart(2, '0') + ':00', location: '회의실 ' + i })),
        ENT('f1', D2, { startTime: '09:00' }), ENT('f2', D2, { startTime: '10:00' }), ENT('f3', D2, { startTime: '11:00' }),
      ],
      todos: [...[1, 2, 3, 4, 5, 6].map((i) => TODO('t' + i, T)), TODO('t7', T, { text: LONG }), TODO('u1', D2), TODO('u2', D2)],
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
  const end = async (W) => { try { W.ev("closeModal('#quickAdd')"); } catch (_) {} await later(); W.close(); };
  const evRows = (W) => W.$$('#dpBody .dp-grp[data-grp="ev"] .dp-er').map((r) => r.dataset.id);
  const tdRows = (W) => W.$$('#dpBody .dp-grp[data-grp="td"] .todo-row').map((r) => r.dataset.id);
  const more = (W, k) => W.$(`#dpBody .dp-more[data-k="${k}"]`);
  const pick = (W, ds) => { W.ev(`selectedDate = "${ds}"; renderAll();`); };

  const checks = {
    //  5개 제한, 더 보기와 줄이기, 날짜를 바꾸면 다시 5개, 보통 날은 더 보기 없음
    async limit(src) {
      const W = await boot(src);
      try {
        assert.deepStrictEqual(W.$$('#dpBody > .dp-grp').map((g) => g.dataset.grp), ['ev', 'td'], '두 묶음 고정이 깨졌다');
        assert.strictEqual(evRows(W).length, 5, '일정이 5개까지만 보이지 않는다');
        assert.strictEqual(tdRows(W).length, 5, '할 일이 5개까지만 보이지 않는다');
        assert.strictEqual(more(W, 'ev').textContent, '3개 더 보기');
        assert.strictEqual(more(W, 'td').textContent, '2개 더 보기');
        assert.ok(/일정\s*8/.test(W.$('#dpBody .dp-grp[data-grp="ev"] .dp-grp-h').textContent), '묶음 머리 수는 전체 수여야 한다');
        more(W, 'ev').click();
        assert.strictEqual(evRows(W).length, 8, '더 보기가 다 펼치지 않았다');
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
    //  일정 한 줄 줄과 펼치기(하나만), 펼친 상세의 수정 단추
    async rows(src) {
      const W = await boot(src);
      try {
        const r0 = W.$('#dpBody .dp-er[data-id="e0"]'), r1 = W.$('#dpBody .dp-er[data-id="e1"]');
        assert.strictEqual(r0.querySelector('.dp-er-tm').textContent, '종일');
        assert.strictEqual(r1.querySelector('.dp-er-tm').textContent, '08:00');
        assert.strictEqual(r1.querySelector('.dp-er-t').textContent, '일정 e1');
        assert.ok(r1.querySelector('.dp-er-bar') && /--c:#3e5be0/.test(r1.getAttribute('style')), '줄에 과제 색 띠가 없다');
        assert.ok(!W.$('#dpBody .card'), '처음부터 카드로 펼쳐진 줄이 있다');
        r1.querySelector('.dp-er-b').click();
        const open = () => W.$$('#dpBody .dp-er.open').map((r) => r.dataset.id);
        assert.deepStrictEqual(open(), ['e1']);
        const card = W.$('#dpBody .dp-er[data-id="e1"] .dp-edet');
        assert.ok(card && card.dataset.id === 'e1' && /회의실 1/.test(card.textContent) && card.querySelector('[data-act="edit"]') && card.querySelector('[data-act="del"]'), '펼친 줄이 들여쓴 상세(장소, 수정, 삭제)가 아니다');
        assert.ok(!W.$('#dpBody .card'), '펼친 줄에 카드 상자가 붙었다(§7.1)');
        assert.strictEqual(W.$('#dpBody .dp-er[data-id="e1"] .dp-er-b').getAttribute('aria-expanded'), 'true');
        assert.strictEqual(W.doc.activeElement, W.$('#dpBody .dp-er[data-id="e1"] .dp-er-b'), '펼친 뒤 포커스가 그 줄이 아니다');
        //  하나만: 다른 줄을 누르면 앞의 줄은 접힌다. 같은 줄을 다시 누르면 접힌다
        W.$('#dpBody .dp-er[data-id="e2"] .dp-er-b').click();
        assert.deepStrictEqual(open(), ['e2'], '한 번에 하나만 펼쳐져야 한다');
        W.$('#dpBody .dp-er[data-id="e2"] .dp-er-b').click();
        assert.deepStrictEqual(open(), []);
        //  펼친 상세의 수정(data-act 클릭 위임 그대로): 입력 창이 그 일정으로 열린다
        W.$('#dpBody .dp-er[data-id="e3"] .dp-er-b').click();
        W.$('#dpBody .dp-er[data-id="e3"] .dp-edet [data-act="edit"]').click();
        await settle();
        assert.ok(!W.$('#quickAdd').classList.contains('hidden'), '펼친 상세의 [수정]이 입력 창을 열지 않았다');
      } finally { await end(W); }
    },
    //  접기와 기억
    async fold(src) {
      const W = await boot(src);
      try {
        const h = (k) => W.$(`#dpBody [data-dp="fold"][data-k="${k}"]`);
        assert.strictEqual(h('ev').getAttribute('aria-expanded'), 'true');
        assert.ok(/▾/.test(h('ev').textContent));
        h('ev').click();
        assert.strictEqual(h('ev').getAttribute('aria-expanded'), 'false');
        assert.ok(/▸/.test(h('ev').textContent) && /일정\s*8/.test(h('ev').textContent), '접어도 머리(▸ 일정 n)는 남아야 한다');
        assert.strictEqual(W.$$('#dpBody .dp-grp[data-grp="ev"] .dp-er, #dpBody .dp-grp[data-grp="ev"] .dp-more').length, 0, '접었는데 줄이 보인다');
        assert.strictEqual(tdRows(W).length, 5, '일정을 접었는데 할 일 묶음이 바뀌었다');
        assert.strictEqual(W.doc.activeElement, h('ev'), '접은 뒤 포커스가 머리 단추가 아니다');
        assert.strictEqual(W.w.localStorage.getItem(FOLD_KEY), '["ev"]', '접은 상태를 계정별로 기억하지 않는다');
        //  날짜를 바꿔도 접힌 채(기억)
        pick(W, W.D2);
        assert.strictEqual(h('ev').getAttribute('aria-expanded'), 'false', '날짜를 바꾸자 접기가 풀렸다');
        h('ev').click();
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
    //  달력 칩에서 온 강조: 5개 밖이면 더 보기를 열고 그 줄을 펼친다(접힌 묶음은 편다). 할 일도 5개 밖이면 더 보기
    async flash(src) {
      const W = await boot(src, (w) => { w.localStorage.setItem(FOLD_KEY, '["ev"]'); });
      try {
        pick(W, W.D2);
        W.ev(`selectedDate = "${W.T}"; flashTargetId = "e7"; renderAll();`);
        assert.strictEqual(W.$('#dpBody [data-dp="fold"][data-k="ev"]').getAttribute('aria-expanded'), 'true', '강조한 일정의 묶음이 접힌 채다');
        assert.strictEqual(evRows(W).length, 8, '5개 밖의 일정을 강조했는데 더 보기가 열리지 않았다');
        assert.deepStrictEqual(W.$$('#dpBody .dp-er.open').map((r) => r.dataset.id), ['e7'], '강조한 일정 줄이 펼쳐지지 않았다');
        assert.ok(W.$('#dpBody .dp-er.flash[data-id="e7"] .dp-edet'), '펼친 줄이 강조되지 않았다');
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

  test('(R) 묶음마다 5개 제한, n개 더 보기와 줄이기, 날짜를 바꾸면 다시 5개, 보통 날은 더 보기 없음', () => checks.limit());
  test('(R) 일정은 한 줄 줄(색 띠, 시간 또는 종일, 제목), 누르면 그 자리에서 들여쓴 상세로(하나만), 상세의 수정이 그대로 돈다', () => checks.rows());
  test('(R) 묶음 머리를 누르면 접히고(▾ ▸) 계정별로 기억한다, 다시 띄워도 접힌 채', () => checks.fold());
  test('(R) 달력 칩 강조: 5개 밖이면 더 보기를 열고 그 줄을 펼친다, 접힌 묶음은 편다, 할 일도 같다', () => checks.flash());
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
}
