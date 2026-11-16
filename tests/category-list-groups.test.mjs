// 과제 목록 묶음(docs/CATEGORY-LIST-GROUPS.md §3, 2026-11-13): 보기 팝업, 근태 추가 목록, 월간 상자.
//
//   묶음 규칙은 내 과제와 같다: 공식(catGroupRank 0), 일반(1), 기본(휴가 2, 기타 3, 머리 하나 "기본"), 묶음 안은 state.categories 순서.
//   이 파일이 지키는 것:
//     (U) 머리 끼우기(catGroupWithHeads): 보이는 줄로 세고, 비는 묶음은 머리가 없고, 번호 없는 줄이 있으면 머리 없이.
//         근태 payload 정리(atNormProjects): 묶음 번호 0~3 정수만 남긴다.
//     (R) 보기 팝업: 내 과제 순서, 0건 제자리 흐림, 구분선 없음, 머리 셋과 개수, 찾기로 빈 묶음 머리 숨김,
//         머리는 화살표, 전체 선택, 누름 대상이 아니다. 다른 사람 일정 보기 팝업도 같은 모양.
//         근태 일간, 주간 추가 목록: 메인 창 payload 에 묶음 번호, 머리 셋, 찾기, 체크와 전체 선택이 머리를 건드리지 않음,
//         묶음 번호 없는 payload 는 머리 없이.
//         월간: 과제 상자 머리 class, 기타 상자 휴가 위 선(일반 과제가 있을 때만), 보고서 결과 불변.
//     (M) 변이: 머리를 .fb-opt 로 그리거나, payload 에서 번호를 버리거나, 선 조건을 빼면 같은 검사가 실패한다.
//   과제 이름은 모두 가짜다.
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}

// ══════════════════════════════════════════════════════════════════════
// (U) 순수
// ══════════════════════════════════════════════════════════════════════
test('(U) catGroupWithHeads: 보이는 줄로 센 머리, 휴가와 기타는 머리 하나, 비는 묶음은 머리 없음, 번호 없는 줄이 있으면 머리 없이', () => {
  const fn = new Function(extractFunction(app, 'catGroupWithHeads') + '; return catGroupWithHeads;')();
  const flat = (rs) => rs.map((r) => r.head ? `#${r.head.g}:${r.head.n}` : r.item.n);
  const L = [{ n: 'a', g: 0 }, { n: 'b', g: 0 }, { n: 'c', g: 1 }, { n: 'v', g: 2 }, { n: 'e', g: 3 }];
  assert.deepStrictEqual(flat(fn(L, (x) => x.g)), ['#0:2', 'a', 'b', '#1:1', 'c', '#2:2', 'v', 'e']);
  assert.deepStrictEqual(flat(fn([L[2], L[4]], (x) => x.g)), ['#1:1', 'c', '#2:1', 'e'], '찾기로 거른 뒤 빈 공식 묶음 머리가 남았거나 개수가 보이는 줄 수가 아니다');
  assert.deepStrictEqual(flat(fn([L[0], { n: 'x' }], (x) => x.g)), ['a', 'x'], '번호 없는 줄이 있는데 머리를 그렸다(옛 payload)');
  assert.deepStrictEqual(flat(fn([{ n: 'y', g: 4 }], (x) => x.g)), ['y'], '범위 밖 번호로 머리를 그렸다');
  assert.deepStrictEqual(fn([], (x) => x.g), []);
});

test('(U) atNormProjects: 묶음 번호는 0~3 정수만 남기고 나머지는 뺀다(이름 중복 거르기는 그대로)', () => {
  const fn = new Function('validColor', extractFunction(app, 'atNormProjects') + '; return atNormProjects;')((c) => c || '#000000');
  const out = fn([{ key: 'k1', name: '가', color: '#111111', g: 0 }, { key: 'k2', name: '나', g: 3 }, { key: 'k3', name: '다', g: '1' },
    { key: 'k4', name: '라', g: 4 }, { key: 'k5', name: '마', g: 1.5 }, { key: 'k6', name: '바', g: -1 }, { key: 'k7', name: '가', g: 1 }, { key: 'k8', name: '사' }]);
  assert.deepStrictEqual(out.map((x) => [x.name, 'g' in x ? x.g : null]), [['가', 0], ['나', 3], ['다', null], ['라', null], ['마', null], ['바', null], ['사', null]]);
});

// ══════════════════════════════════════════════════════════════════════
// (R) 런타임(jsdom)
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('category-list-groups: jsdom 미설치, 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const META = { schemaVersion: '22', expectedSchema: '22', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CA = '2026-09-01T00:00:00Z';
  function boot(src, url, host) {
    const posted = [], errors = [];
    const vc = new jsdomMod.VirtualConsole();
    vc.on('jsdomError', (e) => { const s = String(e && (e.stack || e.message) || e); if (!/Not implemented/.test(s)) errors.push(s); });
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc,
      beforeParse(win) {
        if (host) win.chrome = { webview: { postMessage(m) { try { posted.push(JSON.parse(m)); } catch (_) {} }, addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.open = () => null;
      },
    });
    const w = dom.window, d = w.document;
    return { w, d, posted, errors, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)], close: () => { try { w.close(); } catch (_) {} } };
  }
  const stubHost = (X, rep) => X.ev(`window.__rep = ${rep || '{}'};
    hostRequest = function(cmd, p){ var r = __rep[cmd]; if(typeof r === 'function') r = r(p);
      return Promise.resolve(r === undefined ? { ok:false, error:'시험: 회신 없음' } : JSON.parse(JSON.stringify(r))); };`);
  const CAT = (id, name, extra) => Object.assign({ id, name, color: '#3e5be0', desc: '', createdAt: CA }, extra || {});
  const ENT = (id, categoryId) => ({ id, date: '2026-10-14', title: '일정 ' + id, categoryId, allDay: true, startTime: '', endTime: '', endDate: '',
    memo: '', location: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA });
  //  공식 둘(하나는 기록 0), 일반 셋(가운데가 기록 0), 휴가(0), 기타(기록 1). 기록 수 순이면 섞이는 배치다.
  const DATA = {
    categories: [CAT('db-1', '(예시) 관제 고도화', { source: 'db' }), CAT('db-2', '(예시) 해양 관측', { source: 'db' }),
      CAT('c-a', '(예시) 시스템 점검'), CAT('c-b', '(예시) 보고서 작성'), CAT('c-c', '(예시) 사내 정리'), CAT('c-v', '휴가'), CAT('c-e', '기타')],
    entries: [ENT('e1', 'db-1'), ENT('e2', 'db-1'), ENT('e3', 'c-a'), ENT('e4', 'c-c'), ENT('e5', 'c-c'), ENT('e6', 'c-c'), ENT('e7', 'c-e')],
    todos: [], rooms: [], attendance: {}, taskHours: {},
  };
  const ORDER = DATA.categories.map((c) => c.id);
  const HEADS = ['공식 과제 2', '일반 과제 3', '기본 2'];
  async function bootMain(src = app) {
    const W = boot(src, 'https://tcapp.local/', true);
    await tick();
    W.w.__applyState(JSON.stringify(DATA), META);
    W.ev('view = {y: 2026, m: 9}; selectedDate = "2026-10-14"; setCalView("month"); renderAll();');
    await tick();
    return W;
  }
  //  열린 보기 팝업 목록의 자식: 머리는 "#클래스:글", 줄은 id(흐림은 ~)
  const fbKids = (W) => [...W.$('#fbPop .fb-opts').children].map((o) => o.classList.contains('fb-cgrp')
    ? '#' + [...o.classList].filter((k) => k !== 'fb-cgrp').join('') + ':' + o.textContent
    : o.classList.contains('fb-opt') ? (o.classList.contains('zero') ? '~' : '') + o.dataset.id : '?' + o.className);
  const key = (W, el, k) => el.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const typeQ = (W, sel, v) => { const e = W.$(sel); e.value = v; e.dispatchEvent(new W.w.Event('input', { bubbles: true })); };

  const checks = {
    async popup(src) {
      const W = await bootMain(src);
      try {
        assert.deepStrictEqual(W.evJSON('state.categories.map(function(c){ return c.id; })'), ORDER, '사전조건: 내 과제 순서');
        W.$('#filterbar .fb-btn').click();
        const pop = W.$('#fbPop'); assert.ok(pop, '팝업이 열리지 않았다');
        //  내 과제 순서, 묶음 머리 셋, 0건은 제자리에서 흐리게, 구분선 없음
        assert.deepStrictEqual(fbKids(W), ['#off:' + HEADS[0], 'db-1', '~db-2', '#own:' + HEADS[1], 'c-a', '~c-b', 'c-c', '#def:' + HEADS[2], '~c-v', 'c-e'],
          '보기 팝업이 내 과제 순서와 묶음 머리가 아니다: ' + JSON.stringify(fbKids(W)));
        assert.ok(!pop.querySelector('.fb-gap'), '0건 구분선이 남았다');
        const heads = [...pop.querySelectorAll('.fb-cgrp')];
        assert.ok(heads.every((h) => h.getAttribute('role') === 'presentation' && !h.classList.contains('fb-opt') && !h.id && !h.hasAttribute('aria-selected')), '머리가 고를 수 있는 줄 모양이다');
        //  숫자 두 칸은 그대로
        assert.deepStrictEqual([...pop.querySelectorAll('.fb-opt[data-id="c-c"] .n2')].map((x) => x.textContent), ['3', '0']);
        //  키보드: 화살표 대상은 과제 줄만(머리 건너뜀)
        assert.strictEqual(W.ev('FB.items.length'), ORDER.length, '키보드 대상(FB.items)에 머리가 들어갔다');
        const lb = pop.querySelector('.fb-opts'); lb.focus();
        key(W, lb, 'Home'); assert.strictEqual(W.ev('FB.actId'), 'db-1');
        key(W, lb, 'ArrowDown'); key(W, lb, 'ArrowDown'); assert.strictEqual(W.ev('FB.actId'), 'c-a', '화살표가 머리에 멈췄다');
        key(W, lb, 'End'); assert.strictEqual(W.ev('FB.actId'), 'c-e');
        //  머리를 눌러도 아무 일 없다
        heads[1].click();
        assert.strictEqual(W.ev('filterCats'), null, '머리를 누르니 필터가 바뀌었다');
        //  전체 해제, 전체 선택은 과제만(머리는 셈 밖)
        pop.querySelector('[data-act="none"]').click();
        assert.strictEqual(W.ev('filterCats.size'), 0);
        assert.strictEqual(W.$$('#fbPop .fb-cgrp').length, 3, '전체 해제 뒤 머리가 사라졌다');
        pop.querySelector('[data-act="all"]').click();
        assert.strictEqual(W.ev('filterCats'), null);
        //  찾기: 남은 과제가 없는 묶음은 머리도 숨기고, 개수는 보이는 줄 수
        typeQ(W, '#fbPop .fb-q', '시스템');
        assert.deepStrictEqual(fbKids(W), ['#own:일반 과제 1', 'c-a'], '찾기 뒤 빈 묶음 머리가 남았거나 개수가 보이는 줄 수가 아니다: ' + JSON.stringify(fbKids(W)));
        typeQ(W, '#fbPop .fb-q', '휴');
        assert.deepStrictEqual(fbKids(W), ['#def:기본 1', '~c-v']);
        typeQ(W, '#fbPop .fb-q', '없는이름');
        assert.ok(!W.$('#fbPop .fb-cgrp') && W.$('#fbPop .fb-none'), '맞는 과제가 없을 때 머리가 남았거나 빈 목록 글이 없다');
      } finally { W.close(); }
    },
  };
  test('(R) 보기 팝업: 내 과제 순서, 0건 제자리 흐림, 구분선 없음, 머리 셋과 개수, 찾기로 빈 묶음 머리 숨김, 머리는 화살표, 전체 선택, 누름 대상 아님', () => checks.popup());

  test('(R) 다른 사람 일정 보기 팝업도 같은 모양(그 사람 과제 순서와 묶음 머리)', async () => {
    const P = boot(app, 'https://tcapp.local/?peer=1', true);
    try {
      await tick();
      //  서버 순서는 일부러 섞는다(열람 주입이 묶음 정리를 한다)
      P.w.__applyState(JSON.stringify({
        categories: [CAT('p-e', '기타'), CAT('p-a', '(예시) 상대 일반'), CAT('p-1', '(예시) 상대 공식', { source: 'db' })],
        entries: [ENT('t1', 'p-a')], todos: [],
      }), { peerName: '시험 동료', canWrite: false, view: { y: 2026, m: 9, sel: '2026-10-14' } });
      P.ev('view = {y: 2026, m: 9}; selectedDate = "2026-10-14"; renderAll();');
      await tick();
      P.$('#filterbar .fb-btn').click();
      assert.deepStrictEqual(fbKids(P), ['#off:공식 과제 1', '~p-1', '#own:일반 과제 1', 'p-a', '#def:기본 1', '~p-e'], '열람 창 보기 팝업이 묶음 모양이 아니다: ' + JSON.stringify(fbKids(P)));
    } finally { P.close(); }
  });

  // ── 근태 일간, 주간 추가 목록 ─────────────────────────────────────
  const ATTEND_URL = 'https://tcapp.local/index.html?win=attend';
  const MON = '2026-10-26';
  //  메인 창이 만든 payload(묶음 번호 g 가 실려야 한다)
  async function payloads() {
    const W = await bootMain();
    try {
      W.ev("currentUser = { loginId: 'tester', name: '시험자' };");
      const T = W.ev('todayYmd()');
      const day = W.evJSON(`atBuildPayload(${JSON.stringify(T)}, null, false)`);
      const week = W.evJSON(`awBuildPayload(${JSON.stringify(MON)}, null)`);
      return { T, day, week };
    } finally { W.close(); }
  }
  const noG = (p) => Object.assign({}, p, { projects: p.projects.map(({ g, ...x }) => x) });
  const addKids = (A, list, attr) => [...A.$(list).children].map((o) => o.classList.contains('at-grp')
    ? '#' + [...o.classList].filter((k) => k !== 'at-grp').join('') + ':' + o.textContent : o.getAttribute(attr) || '?' + o.className);
  const NAMES = DATA.categories.map((c) => c.name);
  const FULL = (n) => ['#off:' + HEADS[0], n[0], n[1], '#own:' + HEADS[1], n[2], n[3], n[4], '#def:' + HEADS[2], n[5], n[6]];

  test('(R) 메인 창 payload: 일간, 주간 모두 과제마다 묶음 번호(catGroupRank)를 싣는다', async () => {
    const { day, week } = await payloads();
    assert.deepStrictEqual(day.projects.map((x) => x.g), [0, 0, 1, 1, 1, 2, 3], '일간 payload 에 묶음 번호가 없다');
    assert.deepStrictEqual(week.projects.map((x) => x.g), [0, 0, 1, 1, 1, 2, 3], '주간 payload 에 묶음 번호가 없다');
  });

  const dayCheck = async (src) => {
    const { day } = await payloads();
    const A = boot(src || app, ATTEND_URL, true);
    try {
      stubHost(A, '{ reportDailyList: { ok: true, rows: [] } }');
      A.ev('__attendWinOpen(' + JSON.stringify(day) + ')'); await tick();
      A.$('#atAdd').click();
      assert.deepStrictEqual(addKids(A, '#atAddList', 'data-addname'), FULL(NAMES), '일간 [과제 추가] 목록 묶음 머리가 다르다: ' + JSON.stringify(addKids(A, '#atAddList', 'data-addname')));
      const heads = A.$$('#atAddList .at-grp');
      assert.ok(heads.every((h) => h.getAttribute('role') === 'presentation' && h.tagName === 'DIV' && !h.hasAttribute('data-addname')), '머리가 체크 줄 모양이다');
      //  머리를 눌러도 블록이 생기지 않는다
      const before = A.ev('ATE.blocks.length');
      heads[0].click();
      assert.strictEqual(A.ev('ATE.blocks.length'), before, '머리를 누르니 블록이 바뀌었다');
      //  전체 선택: 과제 일곱 개만 블록이 되고 머리는 셈 밖
      A.$('#atAddAll').click();
      assert.deepStrictEqual(A.evJSON('ATE.blocks.map(function(b){ return b.name; })').slice().sort(), NAMES.slice().sort(), '전체 선택이 과제 줄만 넣지 않는다');
      assert.ok(A.$$('#atAddList [data-addname]').every((b) => b.getAttribute('aria-checked') === 'true'));
      A.$('#atAddNone').click();
      assert.strictEqual(A.ev('ATE.blocks.length'), 0, '전체 해제가 빈 블록을 다 지우지 않았다');
      //  찾기: 남은 과제가 없는 묶음은 머리도 숨김
      typeQ(A, '#atAddQ', '관측');
      assert.deepStrictEqual(addKids(A, '#atAddList', 'data-addname'), ['#off:공식 과제 1', NAMES[1]]);
      typeQ(A, '#atAddQ', '없는이름');
      assert.ok(!A.$('#atAddList .at-grp') && A.$('#atAddList .at-none'));
    } finally { A.close(); }
    //  옛 payload(번호 없음): 머리 없이 지금처럼
    const B = boot(src || app, ATTEND_URL, true);
    try {
      stubHost(B, '{ reportDailyList: { ok: true, rows: [] } }');
      B.ev('__attendWinOpen(' + JSON.stringify(noG(day)) + ')'); await tick();
      B.$('#atAdd').click();
      assert.deepStrictEqual(addKids(B, '#atAddList', 'data-addname'), NAMES, '묶음 번호 없는 payload 인데 머리를 그렸다');
    } finally { B.close(); }
  };
  test('(R) 근태 일간 [과제 추가]: 머리 셋, 머리는 체크와 전체 선택, 해제 대상 아님, 찾기로 빈 묶음 숨김, 번호 없는 payload 는 머리 없이', () => dayCheck());

  test('(R) 근태 주간 과제투입시간 추가: 머리 셋, 체크와 전체 선택이 머리를 건드리지 않음, 찾기, 번호 없는 payload 는 머리 없이', async () => {
    const { week } = await payloads();
    const REP = '{ reportDailyList: { ok: true, rows: [] }, reportWeeklyList: { ok: true, rows: [] } }';
    const A = boot(app, ATTEND_URL, true);
    try {
      A.ev("(function(){ for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k && k.indexOf('tc_attWDraft:')===0) localStorage.removeItem(k); } })()");
      stubHost(A, REP);
      A.ev('__attendWinOpen(' + JSON.stringify(week) + ')'); await tick(60);
      A.$('#awEd [data-awadd="hours"]').click();
      assert.deepStrictEqual(addKids(A, '#awAddList', 'data-awaddname'), FULL(NAMES), '주간 추가 목록 묶음 머리가 다르다: ' + JSON.stringify(addKids(A, '#awAddList', 'data-awaddname')));
      assert.ok(A.$$('#awAddList .at-grp').every((h) => h.getAttribute('role') === 'presentation' && !h.hasAttribute('data-awaddname')));
      A.$$('#awAddList .at-grp')[1].click();
      assert.deepStrictEqual(A.evJSON('AWE.hrs'), [], '머리를 누르니 과제가 들어갔다');
      A.$('#awAddAll').click();
      assert.deepStrictEqual(A.evJSON('AWE.hrs'), NAMES, '전체 선택이 과제 줄만(캘린더 순서) 넣지 않는다');
      A.$('#awAddNone').click();
      assert.deepStrictEqual(A.evJSON('AWE.hrs'), []);
      typeQ(A, '#awAddQ', '기');
      assert.deepStrictEqual(addKids(A, '#awAddList', 'data-awaddname'), ['#def:기본 1', '기타']);
    } finally { A.close(); }
    const B = boot(app, ATTEND_URL, true);
    try {
      B.ev("(function(){ for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k && k.indexOf('tc_attWDraft:')===0) localStorage.removeItem(k); } })()");
      stubHost(B, REP);
      B.ev('__attendWinOpen(' + JSON.stringify(noG(week)) + ')'); await tick(60);
      B.$('#awEd [data-awadd="hours"]').click();
      assert.deepStrictEqual(addKids(B, '#awAddList', 'data-awaddname'), NAMES, '묶음 번호 없는 주간 payload 인데 머리를 그렸다');
    } finally { B.close(); }
  });

  // ── 월간 왼쪽 상자 ───────────────────────────────────────────────
  const openSum = async (X, cats) => {
    X.ev('state.categories = ' + JSON.stringify(cats) + ';');
    X.ev("pcSetTab('attend'); atKindSet('sum');"); await tick();
  };
  const etcRows = (X) => X.$$('#rptmEtc .rptm-it').map((r) => (r.classList.contains('defgap') ? '=' : '') + r.dataset.etcKey);
  //  읽은 뒤처럼: 이 기간 출처 캐시에 기타 상자 글을 넣고 다시 그린다
  const readAs = (X, etc) => X.ev(`(function(){ var S = __rptM; S.fillSrc = 'cal';
    netcusWeeklyMerge = { key: ncMergeKey(S.from, S.to, 'cal'), parsed: null, at: '', src: 'cal', weeksRead: 1, auto: { proj: new Map(), etc: ${JSON.stringify(etc)}, unid: [] } };
    rptMRenderEtc(); })()`);
  const monthCheck = async (src) => {
    const X = boot(src || app, 'https://tcapp.local/', false);
    try {
      await tick(200);
      await openSum(X, DATA.categories);
      const h = X.$('#rptmPickBox > .as-boxh');
      assert.ok(h && h.classList.contains('grp-off') && !X.$('#rptmEtcBox > .as-boxh').classList.contains('grp-off'), '과제 상자 머리만 공식 묶음 색(grp-off)이어야 한다');
      //  머리 글자 "과제"(체크 라벨 .as-all)도 파랑이어야 한다. 라벨이 자기 글자색을 가져 바탕만 바뀌던 실위젯 QA 결함(2026-11-16)
      //  .check 가 color 를 !important 로 고정하므로 이 규칙도 !important 여야 실제로 먹는다(jsdom 은 계산 색을 믿을 수 없어 소스로 본다)
      assert.ok(/\.as-boxh\.grp-off \.as-all\{color:var\(--accent-2\) !important\}/.test(src || app), '과제 상자 머리 라벨 글자가 공식 묶음 색이 아니다(.check 의 !important 에 진다)');
      //  읽기 전: 개인 과제 전부, 일반 다음 첫 기본 과제(휴가) 위에만 선
      assert.deepStrictEqual(etcRows(X), ['c-a', 'c-b', 'c-c', '=c-v', 'c-e'], '기타 상자 휴가 위 선이 다르다: ' + JSON.stringify(etcRows(X)));
      //  읽은 뒤: 글이 있는 과제만. 일반 과제가 남으면 선, 기본만 남으면 선 없음
      const etc = [{ key: 'c-a', name: NAMES[2], text: '[(예시) 시스템 점검]\n- 점검' }, { key: 'c-b', name: NAMES[3], text: '' }, { key: 'c-c', name: NAMES[4], text: '' },
        { key: 'c-v', name: '휴가', text: '[휴가]\n- 쉼' }, { key: 'c-e', name: '기타', text: '[기타]\n- 정리' }];
      readAs(X, etc);
      assert.deepStrictEqual(etcRows(X), ['c-a', '=c-v', 'c-e']);
      //  보고서 결과는 그대로(기타 표 = 켠 줄의 글을 순서대로)
      const lines = X.evJSON('rptMPayload(__rptM)').etc.lines.map((l) => l.text).join('\n');
      assert.strictEqual(lines, X.evJSON('rptMLines(rptMEtcText(__rptM, rptMAuto(__rptM)))').map((l) => l.text).join('\n'), '월간 보고서 기타 표가 상자 순서와 다르다');
      assert.ok(lines.indexOf('점검') < lines.indexOf('쉼') && lines.indexOf('쉼') < lines.indexOf('정리'), '월간 보고서 기타 표 순서가 바뀌었다: ' + lines);
      readAs(X, etc.map((e) => e.key === 'c-a' ? Object.assign({}, e, { text: '' }) : e));
      assert.deepStrictEqual(etcRows(X), ['c-v', 'c-e'], '기본 과제만 남았는데 선이 있다');
    } finally { X.close(); }
    //  일반 과제가 하나도 없으면 선이 없다
    const Y = boot(src || app, 'https://tcapp.local/', false);
    try {
      await tick(200);
      await openSum(Y, [DATA.categories[0], DATA.categories[5], DATA.categories[6]]);
      assert.deepStrictEqual(etcRows(Y), ['c-v', 'c-e'], '일반 과제가 없는데 선이 있다');
    } finally { Y.close(); }
  };
  test('(R) 월간: 과제 상자 머리 옅은 파랑 class, 기타 상자 휴가 위 선(일반 과제가 있을 때만), 보고서 결과 불변', () => monthCheck());

  // ══════════════════════════════════════════════════════════════════════
  // (M) 변이
  // ══════════════════════════════════════════════════════════════════════
  test('(M) 보기 팝업 머리를 고를 수 있는 줄(.fb-opt)로 그리면 보기 팝업 시험이 실패한다', async () => {
    const bad = mutate(app, "if(r.kind === 'head') return catGroupHeadHtml(r.g, r.n, 'fb-cgrp');", "if(r.kind === 'head') return catGroupHeadHtml(r.g, r.n, 'fb-cgrp fb-opt');");
    await assert.rejects(() => checks.popup(bad), /고를 수 있는 줄 모양|FB\.items|보기 팝업이 내 과제 순서/);
  });
  test('(M) 근태 payload 정리가 묶음 번호를 버리면 일간 시험이 실패한다', async () => {
    const bad = mutate(app, '    if(Number.isInteger(x.g) && x.g >= 0 && x.g <= 3) p.g = x.g;', '');
    await assert.rejects(() => dayCheck(bad), /일간 \[과제 추가\] 목록 묶음 머리가 다르다/);
  });
  test('(M) 기타 상자 선 조건(앞 줄이 일반 과제)을 빼면 월간 시험이 실패한다', async () => {
    const bad = mutate(app, 'gap = i > 0 && isDef(e) && !isDef(list[i - 1]);', 'gap = isDef(e);');
    await assert.rejects(() => monthCheck(bad), /기타 상자 휴가 위 선이 다르다/);
  });
}
