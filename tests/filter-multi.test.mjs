// 과제 필터 다중 선택과 팝업형 필터 줄(docs/FILTER-MULTI.md, 시안 docs/prototypes/filterbar-proto-v3.html 의 V2).
//
// 이 파일이 지키는 것:
//   (S) 정적: 옛 단일 필터(filterCatId), 할 일 탭 전용 필터(noteFilterCat, noteFilterBarHtml, .nd-filter-rs, tc_filterMax),
//       넘침 페이드(syncOverflowFade, .ovf-fade)가 남지 않았다. 필터 줄은 42px 한 줄이고 줄바꿈, 스크롤이 없다.
//       과제 버튼은 aria-haspopup="listbox". 통과 판정은 filterCats === null || filterCats.has(...).
//   (R) 런타임(jsdom):
//       내 창: 버튼 글자(전체, 선택 없음, 이름, 이름 외 N), 팝업(검색칸 포커스, 기록 많은 순, 0건 뒤 구분선),
//       전체 해제와 두 과제 켜기 뒤 월간 막대와 주간 과제별 줄이 고른 과제만, 할 일 탭도 같은 필터,
//       켜고 끄는 동안 팝업이 열린 채 목록에 포커스, 칩 x 로 하나 빼기, 전체 선택으로 null, Esc 로 닫고 버튼으로.
//       과제 삭제 정리(묶음에서 빼고, 비면 전체로), 새 기록 기본 과제.
//       열람 창: 같은 줄이 그 사람 과제로 그려지고, 필터를 바꿔도 내 일정 겹은 그대로.
//   (M) 변이: passFilter 가 필터를 무시, 할 일 탭이 필터를 무시, 과제 삭제가 빈 묶음을 남김 → 위 런타임 시험이 실패한다.
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  const out = text.slice(0, a) + repl + text.slice(a + find.length);
  assert.notStrictEqual(out, text, '변이가 원본을 바꾸지 못했다');
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// (S) 정적
// ══════════════════════════════════════════════════════════════════════
test('정적①: 옛 단일 필터, 할 일 탭 필터, 높이 손잡이, 넘침 페이드의 흔적이 없다', () => {
  for (const gone of ['filterCatId', 'noteFilterCat', 'noteFilterBarHtml', 'filterBarMax', 'tc_filterMax', 'nd-filter', 'syncOverflowFade', 'ovf-fade', 'ovf-scroll']) {
    assert.ok(!app.includes(gone), `옛 필터 흔적 ${gone} 이 남았다`);
  }
});

test('정적②: 필터 묶음은 날짜 줄 안(월간 주간 단추 바로 뒤)에 있고 팝업이 잘리지 않게 overflow 를 걸지 않는다', () => {
  const css = app.slice(0, app.indexOf('</style>'));
  const rules = [...css.matchAll(/(^|[}\s])\.fb-grp\{([^}]*)\}/g)].map((m) => m[2]);
  assert.ok(rules.length >= 1, '.fb-grp 규칙이 없다');
  for (const r of rules) assert.ok(!/overflow/.test(r), '.fb-grp 에 overflow 가 있다(팝업이 잘린다): ' + r);
  assert.ok(!/\.filterbar\{/.test(css), '옛 .filterbar 줄 규칙이 남았다');
  assert.ok(/\.fb-btn\{[^}]*max-width:min\(240px,40vw\)/.test(css) && !/\.fb-btn\{[^}]*[^-]width:\d+px/.test(css), '과제 버튼은 글자에 맞추고 최대 폭만 둔다');
  assert.ok(app.includes('</div>\n    <div class="fb-grp" id="filterbar"></div>\n  </div>'), '#filterbar 가 날짜 줄(.nav) 끝, 월간 주간 단추 뒤에 있지 않다');
});

test('정적③: 과제 버튼은 aria-haspopup="listbox", 목록은 aria-multiselectable, 한글 조합 중 키는 건너뛴다', () => {
  const rf = extractFunction(app, 'renderFilterbar');
  assert.ok(/class="fb-btn"[^`]*aria-haspopup="listbox"/.test(rf), '과제 버튼에 aria-haspopup="listbox" 가 없다');
  const op = extractFunction(app, 'filterPopOpen');
  assert.ok(/role="listbox"[^`]*aria-multiselectable="true"/.test(op), '팝업 목록이 다중 선택 listbox 가 아니다');
  const bf = extractFunction(app, 'bindFilterbar');
  assert.ok(bf.includes('ev.isComposing || ev.keyCode === 229'), '한글 조합 중 키 건너뛰기가 없다');
});

test('정적④: 통과 판정과 할 일 거르기가 filterCats 하나를 본다', () => {
  assert.ok(extractFunction(app, 'passFilter').includes('return filterCats === null || filterCats.has(e.categoryId);'), 'passFilter 가 filterCats 를 보지 않는다');
  assert.ok(extractFunction(app, 'todoBuckets').includes('filterCats !== null && !filterCats.has(t.categoryId)'), '할 일 묶음이 상단 필터를 따르지 않는다');
  assert.ok(extractFunction(app, 'renderTodoListTab').includes('filterCats === null || filterCats.has(t.categoryId)'), '할 일 탭이 상단 필터를 따르지 않는다');
  assert.ok(app.includes("${filterCats !== null ? '고른 과제에 ' : ''}"), '할 일 빈 안내가 "고른 과제에" 가 아니다');
});

test('단위①: 버튼 글자와 과제 토글(모두 고르면 전체로), 삭제 정리', () => {
  const code = ['filterSelCats', 'filterDropCat', 'filterNormalize', 'filterToggleCat', 'filterLabel', 'filterFirstCat'].map((f) => extractFunction(app, f)).join('\n');
  const mk = new Function('state', 'esc', 'validColor', `let filterCats = null;
    ${code}
    return { set(v){ filterCats = v; }, get(){ return filterCats; }, filterLabel, filterToggleCat, filterDropCat, filterFirstCat };`);
  const S = mk({ categories: [{ id: 'a', name: '알파' }, { id: 'b', name: '베타' }, { id: 'c', name: '감마' }] }, (s) => String(s), (c) => c || '#000');
  assert.strictEqual(S.filterLabel().text, '전체');
  S.filterToggleCat('b');
  assert.deepStrictEqual([...S.get()].sort(), ['a', 'c'], '전체에서 하나를 끄면 나머지가 남아야 한다');
  assert.strictEqual(S.filterLabel().text, '알파 외 1');
  S.filterToggleCat('b');
  assert.strictEqual(S.get(), null, '모두 고르면 전체(null)여야 한다');
  S.set(new Set());
  assert.strictEqual(S.filterLabel().text, '선택 없음');
  assert.strictEqual(S.filterFirstCat(), null);
  S.set(new Set(['c', 'b']));
  assert.strictEqual(S.filterLabel().text, '베타 외 1', '버튼 글자의 첫 과제는 목록 순서여야 한다');
  assert.strictEqual(S.filterFirstCat(), 'b', '새 기록 기본 과제는 고른 과제 중 목록 순서로 첫째');
  S.filterDropCat('c');
  assert.strictEqual(S.filterLabel().text, '베타');
  S.filterDropCat('b');
  assert.strictEqual(S.get(), null, '지운 과제 하나만 골라 두었으면 전체로 돌아가야 한다');
  S.set(new Set());
  S.filterDropCat('zz');
  assert.ok(S.get() instanceof Set && S.get().size === 0, '묶음에 없는 과제를 지웠는데 선택 없음이 전체로 바뀌었다');
});

// ══════════════════════════════════════════════════════════════════════
// (R) 런타임(jsdom)
// ══════════════════════════════════════════════════════════════════════
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;

if (!JSDOM) {
  skip('filter-multi: jsdom 미설치로 런타임 검증을 건너뜁니다', SKIP_NO_JSDOM,
    `이 파일의 test 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았습니다.`);
} else {
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const bootOpts = (url) => ({
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url,
    beforeParse(window) {
      window.chrome = { webview: { postMessage() {}, addEventListener() {}, removeEventListener() {} } };
      if (typeof window.crypto === 'undefined') {
        window.crypto = { randomUUID: () => 'u-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
      }
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      if (!window.CSS) window.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
    },
  });
  function bootWindow(url, src) {
    const { window: w } = new JSDOM(src || app, bootOpts(url));
    const doc = w.document;
    return {
      w, doc,
      ev: (code) => w.eval(code),
      $$: (sel) => [...doc.querySelectorAll(sel)],
      close: () => { try { w.close(); } catch (_) {} },
    };
  }
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const CAT = (id, name, color) => ({ id, name, color: color || '#3e5be0', desc: '', createdAt: '2026-09-01T00:00:00Z' });
  const ENT = (id, date, categoryId) => ({ id, date, title: '일정 ' + id, categoryId, allDay: true, startTime: '', endTime: '', endDate: '', memo: '', location: '', recur: null, recurExcept: [] });
  const TODO = (id, categoryId) => ({ id, text: '할 일 ' + id, done: false, categoryId, due: '2026-10-14', endDate: '', prio: 'normal', completedAt: '', note: '', dayNotes: {} });
  //  알파 2건, 베타 1건, 감마 1건, 델타 0건. 할 일은 과제마다 하나(10/14)
  const MINE_DATA = {
    categories: [CAT('c-a', '알파'), CAT('c-b', '베타'), CAT('c-c', '감마'), CAT('c-d', '델타')],
    entries: [ENT('a1', '2026-10-13', 'c-a'), ENT('a2', '2026-10-14', 'c-a'), ENT('b1', '2026-10-14', 'c-b'), ENT('g1', '2026-10-15', 'c-c')],
    todos: [TODO('ta', 'c-a'), TODO('tb', 'c-b'), TODO('tc', 'c-c')],
    taskHours: {}, attendance: {},
  };
  async function bootMine(src) {
    const W = bootWindow('https://tcapp.local/', src);
    await settle();
    W.w.__applyState(JSON.stringify(MINE_DATA), META);
    W.ev('view = {y: 2026, m: 9}; selectedDate = "2026-10-14"; setCalView("month"); renderAll();');
    await settle();
    return W;
  }
  const label = (W) => W.doc.querySelector('#filterbar .fb-btn').getAttribute('aria-label').replace(/^과제 필터, /, '');
  const gridIds = (W) => [...new Set(W.$$('#grid .chip[data-id], #grid .chip[data-todo]').map((c) => c.dataset.id || c.dataset.todo))].sort();   // 일정(data-id)과 할 일(data-todo)
  const chipCats = (W) => W.$$('#filterbar .fb-rest .fb-tok').map((c) => c.dataset.cat);
  const optOf = (W, name) => W.$$('#fbPop .fb-opt').find((o) => o.querySelector('.nm').textContent === name);
  const click = (el) => { assert.ok(el, '누를 요소가 없다'); el.click(); };
  const todoIds = (W) => { W.ev('setPanelTab("todo")'); const r = W.$$('#dpBody .todo-row[data-id]').map((x) => x.dataset.id).sort(); W.ev('setPanelTab("detail")'); return r; };

  //  내 창 흐름: 런타임과 변이 시험이 같이 쓴다
  const checks = {
    async popupFlow(src) {
      const W = await bootMine(src);
      try {
        assert.strictEqual(label(W), '전체');
        assert.strictEqual(W.ev('filterCats'), null);
        assert.deepStrictEqual(chipCats(W), [], '전체일 때는 칩이 없어야 한다');
        assert.deepStrictEqual(gridIds(W), ['a1', 'a2', 'b1', 'g1', 'ta', 'tb', 'tc']);
        const btn = W.doc.querySelector('#filterbar .fb-btn');
        assert.strictEqual(btn.getAttribute('aria-haspopup'), 'listbox');
        click(btn);
        const pop = W.doc.getElementById('fbPop');
        assert.ok(pop, '팝업이 열리지 않았다');
        assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');
        assert.strictEqual(W.doc.activeElement, pop.querySelector('.fb-q'), '열면 검색칸에 포커스가 가야 한다');
        //  기록 많은 순(같으면 가나다), 0건은 구분선 뒤 흐리게
        assert.deepStrictEqual(W.$$('#fbPop .fb-opt').map((o) => o.querySelector('.nm').textContent + o.querySelector('.n').textContent),
          ['알파2', '감마1', '베타1', '기타0', '델타0', '휴가0'], '팝업 목록이 기록 많은 순, 같으면 가나다순이 아니다(0건 묶음 포함)');
        assert.strictEqual(W.$$('#fbPop .fb-opt')[0].querySelector('.nm').textContent, '알파');
        assert.ok(optOf(W, '델타').classList.contains('zero') && W.$$('#fbPop .fb-gap').length === 1, '0건 과제가 구분선 뒤 흐린 묶음이 아니다');
        assert.ok(W.$$('#fbPop .fb-opt').every((o) => o.getAttribute('aria-selected') === 'true'), '전체일 때 모든 과제가 켜져 있어야 한다');
        assert.strictEqual(pop.querySelector('[data-act="all"]').disabled, true, '전체일 때 전체 선택이 꺼져 있어야 한다');
        //  전체 해제 → 선택 없음, 아무것도 안 보인다
        click(pop.querySelector('[data-act="none"]'));
        assert.strictEqual(label(W), '선택 없음');
        assert.ok(W.ev('filterCats instanceof Set && filterCats.size === 0'));
        assert.deepStrictEqual(gridIds(W), [], '선택 없음인데 달력에 기록이 보인다');
        assert.ok(W.doc.getElementById('fbPop'), '전체 해제 뒤 팝업이 닫혔다');
        //  알파, 감마 켜기 → 팝업은 열린 채, 포커스는 목록, 활성 항목은 방금 켠 것
        click(optOf(W, '알파'));
        click(optOf(W, '감마'));
        assert.strictEqual(W.doc.getElementById('fbPop'), pop, '켜고 끄는 동안 팝업이 다시 만들어졌다(깜빡임)');
        assert.strictEqual(W.doc.activeElement, pop.querySelector('.fb-opts'), '켠 뒤 포커스가 목록에 있어야 한다');
        const lb = pop.querySelector('.fb-opts');
        assert.strictEqual(W.doc.getElementById(lb.getAttribute('aria-activedescendant')).querySelector('.nm').textContent, '감마', '활성 항목이 방금 켠 과제가 아니다');
        assert.strictEqual(optOf(W, '알파').getAttribute('aria-selected'), 'true');
        assert.strictEqual(optOf(W, '베타').getAttribute('aria-selected'), 'false');
        assert.strictEqual(label(W), '알파 외 1');
        assert.deepStrictEqual(chipCats(W), ['c-a', 'c-c'], '고른 과제 칩이 목록 순서로 둘이어야 한다');
        assert.deepStrictEqual(gridIds(W), ['a1', 'a2', 'g1', 'ta', 'tc'], '월간 달력이 고른 과제만 보이지 않는다');
        assert.ok(W.doc.querySelector('#dpBody .dp-count').textContent.includes('(필터 적용 중)'), '상세 패널에 필터 표시가 없다');
        //  Esc 로 닫고 버튼으로
        lb.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.ok(!W.doc.getElementById('fbPop'), 'Esc 로 닫히지 않았다');
        assert.strictEqual(W.doc.activeElement, btn, '닫은 뒤 포커스가 버튼으로 돌아오지 않았다');
        assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
        //  할 일 탭도 같은 필터
        assert.deepStrictEqual(todoIds(W), ['ta', 'tc'], '할 일 탭이 상단 필터를 따르지 않는다');
        //  주간 과제별 줄: 고른 과제 줄만, 분류 없음 줄 없음
        W.ev('setCalView("week")');
        assert.deepStrictEqual(W.$$('#grid .wr-name').map((n) => n.textContent.trim()), ['알파', '감마'], '주간 과제별 줄이 고른 과제만이 아니다');
        assert.deepStrictEqual(gridIds(W), ['a1', 'a2', 'g1', 'ta', 'tc']);
        W.ev('setCalView("month")');
        //  칩 x 로 알파 빼기 → 감마 하나, 포커스는 남은 x
        click(W.doc.querySelector('#filterbar .fb-x[data-rm="c-a"]'));
        assert.strictEqual(label(W), '감마');
        assert.deepStrictEqual(chipCats(W), ['c-c']);
        assert.strictEqual(W.doc.activeElement, W.doc.querySelector('#filterbar .fb-x[data-rm="c-c"]'), '뺀 뒤 포커스가 다음 x 로 가지 않았다');
        assert.strictEqual(W.doc.querySelector('#filterbar .fb-x[data-rm="c-c"]').getAttribute('aria-label'), '감마 빼기');
        assert.deepStrictEqual(gridIds(W), ['g1', 'tc']);
        //  전체 선택 → null
        click(W.doc.querySelector('#filterbar .fb-btn'));
        click(W.doc.querySelector('#fbPop [data-act="all"]'));
        assert.strictEqual(W.ev('filterCats'), null, '전체 선택 뒤 filterCats 가 null 이 아니다');
        assert.strictEqual(label(W), '전체');
        assert.deepStrictEqual(chipCats(W), []);
        assert.deepStrictEqual(gridIds(W), ['a1', 'a2', 'b1', 'g1', 'ta', 'tb', 'tc']);
        //  바깥을 누르면 닫힌다
        W.doc.getElementById('grid').dispatchEvent(new W.w.Event('pointerdown', { bubbles: true }));
        assert.ok(!W.doc.getElementById('fbPop'), '바깥을 눌렀는데 팝업이 남았다');
      } finally { W.close(); }
    },
    async deleteCleanup(src) {
      const W = await bootMine(src);
      try {
        W.ev('filterCats = new Set(["c-b", "c-d"]); renderAll();');
        assert.strictEqual(W.ev('deleteCategory("c-d")'), true, '사전조건: 과제가 지워져야 한다');
        assert.strictEqual(W.ev('Array.from(filterCats).join()'), 'c-b', '지운 과제가 묶음에 남았다');
        assert.strictEqual(W.ev('deleteCategory("c-b")'), true);
        W.ev('renderAll()');   // 화면의 삭제 단추도 지운 뒤 renderAll 한다
        assert.strictEqual(W.ev('filterCats'), null, '지운 과제만 골라 두었는데 전체로 돌아가지 않았다(아무것도 안 보인다)');
        assert.strictEqual(label(W), '전체');
      } finally { W.close(); }
    },
  };

  test('런타임①: 팝업에서 전체 해제, 두 과제 켜기, 칩 x, 전체 선택이 달력(월간, 주간 줄), 할 일 탭, 버튼 글자를 함께 바꾼다', () => checks.popupFlow());
  test('런타임②: 과제를 지우면 묶음에서 빠지고, 비면 전체로 돌아간다', () => checks.deleteCleanup());

  test('런타임③: 키보드: 버튼 ↓ 로 열기, 검색칸 ↓ 로 목록, Space 로 켜고 끄기, 검색은 목록만 거른다(달력은 그대로)', async () => {
    const W = await bootMine();
    try {
      const btn = W.doc.querySelector('#filterbar .fb-btn');
      btn.focus();
      btn.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const q = W.doc.querySelector('#fbPop .fb-q');
      assert.strictEqual(W.doc.activeElement, q, '↓ 로 열면 검색칸에 포커스가 가야 한다');
      //  한글 조합 중 키는 건너뛴다
      q.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }));
      assert.strictEqual(W.ev('filterCats'), null, '조합 중 Enter 가 과제를 켜고 껐다');
      const grid0 = W.doc.getElementById('grid').innerHTML;
      q.value = '감';
      q.dispatchEvent(new W.w.Event('input', { bubbles: true }));
      assert.deepStrictEqual(W.$$('#fbPop .fb-opt .nm').map((n) => n.textContent), ['감마'], '검색이 목록을 거르지 않는다');
      assert.ok(W.doc.querySelector('#fbPop .fb-opt mark'), '검색어 표시가 없다');
      assert.strictEqual(W.doc.getElementById('grid').innerHTML, grid0, '검색 입력이 달력을 다시 그렸다');
      q.value = '';
      q.dispatchEvent(new W.w.Event('input', { bubbles: true }));
      q.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const lb = W.doc.querySelector('#fbPop .fb-opts');
      assert.strictEqual(W.doc.activeElement, lb, '검색칸 ↓ 로 목록에 가야 한다');
      lb.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      const last = W.$$('#fbPop .fb-opt').pop();
      assert.strictEqual(lb.getAttribute('aria-activedescendant'), last.id);
      lb.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      assert.ok(W.ev('filterCats instanceof Set') && !W.ev(`filterCats.has(${JSON.stringify(last.dataset.id)})`), 'Space 로 끄지 못했다');
      assert.strictEqual(W.doc.querySelector('#fbPop .fb-opts').getAttribute('aria-activedescendant'), W.$$('#fbPop .fb-opt').pop().id, '켜고 끈 뒤 활성 항목이 바뀌었다');
      //  Tab 으로 나가면 닫고 버튼으로
      lb.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      assert.ok(!W.doc.getElementById('fbPop'), 'Tab 으로 닫히지 않았다');
      assert.strictEqual(W.doc.activeElement, btn);
    } finally { W.close(); }
  });

  test('런타임④: 새 기록의 기본 과제는 고른 과제 중 목록 순서로 첫째', async () => {
    const W = await bootMine();
    try {
      W.ev('filterCats = new Set(["c-c", "c-b"]); renderAll(); openQuickAdd("2026-10-14");');
      assert.strictEqual(W.ev("$('#qaCat').value"), 'c-b');
      W.ev("closeModal('#quickAdd')");
      await settle();
    } finally { W.close(); }
  });

  test('런타임⑤: 과제가 없으면 꺼진 버튼(과제 없음)과 안내 문구 툴팁', async () => {
    const W = bootWindow('https://tcapp.local/?peer=1');
    try {
      await settle();
      W.w.__applyState(JSON.stringify({ categories: [], entries: [], todos: [] }), { peerName: '홍길동', canWrite: false });
      await settle();
      const btn = W.doc.querySelector('#filterbar .fb-btn');
      assert.ok(btn && btn.disabled, '과제가 없으면 꺼진 단추여야 한다');
      assert.strictEqual(btn.textContent.trim(), '과제 없음');
      assert.strictEqual(btn.title, '등록된 수행 과제가 없습니다. [내 과제]에서 추가하세요.');
      assert.ok(!W.doc.querySelector('#filterbar .fb-rest'), '칩 자리가 없어야 한다');
    } finally { W.close(); }
  });

  //  열람 창: 같은 줄이 그 사람 과제로 그려지고, 내 일정 겹은 필터를 타지 않는다
  async function peerFlow(src) {
    const P = bootWindow('https://tcapp.local/?peer=1', src);
    try {
      P.w.localStorage.setItem('tc_peerLayout', 'overlay');
      await settle();
      const mine = (id, date) => ({ id, date, title: '내 ' + id, allDay: true, startTime: '', endTime: '', endDate: '', recur: null, recurExcept: [], categoryId: null, _mine: true });
      P.w.__applyState(JSON.stringify({
        categories: [CAT('p-a', '상대 알파'), CAT('p-b', '상대 베타')],
        entries: [ENT('t1', '2026-10-13', 'p-a'), ENT('t2', '2026-10-14', 'p-b'), mine('m1', '2026-10-13'), mine('m2', '2026-10-15')],
        todos: [],
      }), { peerName: '홍길동', canWrite: false, view: { y: 2026, m: 9, sel: '2026-10-14' } });
      P.ev('setPeerOverlay(true); view = {y: 2026, m: 9}; selectedDate = "2026-10-14"; renderAll();');
      await settle();
      const mineN = () => P.$$('#grid .chip.chip-mine').length;
      const theirs = () => [...new Set(P.$$('#grid .chip[data-id]:not(.chip-mine)').map((c) => c.dataset.id))].sort();
      assert.strictEqual(mineN(), 2, '사전조건: 내 겹이 보여야 한다');
      click(P.doc.querySelector('#filterbar .fb-btn'));
      assert.deepStrictEqual(P.$$('#fbPop .fb-opt .nm').map((n) => n.textContent), ['상대 베타', '상대 알파'].sort((a, b) => a.localeCompare(b, 'ko')), '열람 창 팝업이 그 사람 과제가 아니다');
      click(P.doc.querySelector('#fbPop [data-act="none"]'));
      assert.deepStrictEqual(theirs(), [], '선택 없음인데 그 사람 기록이 보인다');
      assert.strictEqual(mineN(), 2, '과제 필터가 내 일정 겹까지 걷어냈다');
      click(P.$$('#fbPop .fb-opt').find((o) => o.dataset.id === 'p-a'));
      assert.deepStrictEqual(theirs(), ['t1']);
      assert.strictEqual(mineN(), 2);
    } finally { P.close(); }
  }
  test('런타임⑥: 열람 창도 같은 필터 줄(그 사람 과제), 필터를 바꿔도 내 일정 겹은 그대로', () => peerFlow());

  // ══════════════════════════════════════════════════════════════════════
  // (M) 변이: 위 런타임 시험이 실제로 잡는가
  // ══════════════════════════════════════════════════════════════════════
  test('변이M①: passFilter 가 과제 필터를 무시하면 런타임① 이 실패한다', async () => {
    const bad = mutate(app, '  return filterCats === null || filterCats.has(e.categoryId);\n}', '  return true;\n}');
    await assert.rejects(() => checks.popupFlow(bad), /선택 없음인데 달력에 기록이 보인다/);
  });
  test('변이M②: 할 일 탭이 상단 필터를 무시하면 런타임① 이 실패한다', async () => {
    const bad = mutate(app, '  const inCat = t => filterCats === null || filterCats.has(t.categoryId);', '  const inCat = t => true;');
    await assert.rejects(() => checks.popupFlow(bad), /할 일 탭이 상단 필터를 따르지 않는다/);
  });
  test('변이M③: 과제 삭제가 빈 묶음을 전체로 돌리지 않으면 런타임② 가 실패한다', async () => {
    const bad = mutate(app, 'if(filterCats !== null && filterCats.delete(id) && !filterCats.size) filterCats = null;', 'if(filterCats !== null) filterCats.delete(id);');
    await assert.rejects(() => checks.deleteCleanup(bad), /전체로 돌아가지 않았다/);
  });
  test('변이M④: passFilter 의 내 겹 우회를 빼면 런타임⑥ 이 실패한다', async () => {
    const bad = mutate(app, '  if(e && e._mine) return PEER && __peerOverlay;', '  if(e && e._mine && false) return PEER && __peerOverlay;');
    await assert.rejects(() => peerFlow(bad), /내 일정 겹까지 걷어냈다/);
  });
}
