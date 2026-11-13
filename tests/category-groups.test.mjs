// 내 과제 묶음(docs/CATEGORY-GROUPS.md §4, 2026-11-13)의 웹 쪽 계약.
//
//   순서 규칙: state.categories 는 늘 공식(DB 과제), 일반, 휴가, 기타 순이다. 묶음 안 순서는 사용자가 정한다.
//   이 파일이 지키는 것(§4 의 항목 순서):
//     ① 묶음 순서가 모든 순서 소비처(근태 보고, 월간, 필터, 선택 상자, 보고서, 다른 사람 일정 보기)에 반영된다.
//     ② 끌기와 ⋯ 순서 단추는 묶음 밖으로 못 나간다(자세한 끌기, 메뉴 시험은 category-order.test.mjs).
//     ③ 휴가와 기타에는 ⠿ 와 ⋯ 가 없고, 누르면 수정 창이 열린다.
//     ④ 합치기, 옮기기, 연결에서 휴가와 기타가 양쪽 다 빠진다(화면 목록과 함수 자체).
//     ⑤ 새 과제와 연결된 과제가 묶음 끝에 들어간다(일반은 휴가 위, 공식은 일반 위).
//     ⑥ 부팅 정리는 몇 번 돌아도 같다(바뀌었으면 부팅 뒤 한 번 저장, 같으면 저장 없음, 열람 창은 저장 없이 보이는 순서만).
//   판 데이터 단계(배포 SQL) 시험은 release-sql.test.mjs 의 데이터 단계e~g.
//   (c) 변이: 정리를 빼거나, 추가가 맨 뒤에 붙이거나, 대상 거르기를 빼면 같은 검사가 실패한다.
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}

const MUT = {
  //  묶음 정리를 뺀다(부팅, 가져오기가 서버 순서를 그대로 둔다)
  noNormalize: (s) => mutate('  const moved = catGroupNormalize(s);\n  return changed || moved;', '  return changed;', s),
  //  새 일반 과제를 예전처럼 맨 뒤(기타 아래)에 붙인다
  addAtEnd: (s) => mutate('  catGroupInsert(state, c); save(); return c;', '  state.categories.push(c); save(); return c;', s),
  //  공식 과제 편입을 맨 뒤에 붙인다
  subAtEnd: (s) => mutate('  return catGroupInsert(s, c);   // 공식 묶음 끝', '  s.categories.push(c); return c;   // 공식 묶음 끝', s),
  //  합치기 대상에서 휴가, 기타 거르기를 뺀다
  mergeTargets: (s) => mutate('isPickableCat(c) && !isDefaultTask(c));', 'isPickableCat(c));', s),
  //  옮기기 함수의 휴가, 기타 막기를 뺀다
  moveGuard: (s) => mutate("  if(isDefaultTask(from) || isDefaultTask(to)) return null;", '', s),
  //  묶음 정리의 안정성을 깬다(묶음 안을 이름순으로)
  unstable: (s) => mutate('.sort((x, y) => x[0] - y[0] || x[1] - y[1])', ".sort((x, y) => x[0] - y[0] || String(x[2].name).localeCompare(String(y[2].name), 'ko'))", s),
};

/* ── 정적: 정리 함수 하나와 그 자리 ─────────────────────────────────── */
const statics = {
  normalizer(app) {
    //  정리 함수는 하나(catGroupNormalize)이고, 보장 함수(부팅, 다시 읽기, 가져오기, 초기화가 부르는 한 곳)가 부른다
    assert.strictEqual((app.match(/function catGroupNormalize\(/g) || []).length, 1, '묶음 정리 함수가 하나가 아니다');
    const ens = app.slice(app.indexOf('function ensureDefaultTasks(s){'), app.indexOf('function catGroupRank('));
    assert.ok(/const moved = catGroupNormalize\(s\);\n  return changed \|\| moved;/.test(ens), 'ensureDefaultTasks 가 묶음 정리를 함께 하지 않는다(부팅, 가져오기 경로)');
    //  열람 창은 보장 대신 정리만(저장 없음)
    assert.ok(/if\(!PEER\) __bootDefaultsDirty = ensureDefaultTasks\(state\);\n    else catGroupNormalize\(state\);/.test(app), '열람 창 주입이 묶음 정리를 하지 않는다');
    //  추가와 편입은 묶음 끝 넣기를 쓴다
    assert.ok(/catGroupInsert\(state, c\); save\(\); return c;/.test(app), '일반 과제 추가가 묶음 끝 넣기를 쓰지 않는다');
    assert.ok(/return catGroupInsert\(s, c\);/.test(app), '공식 과제 편입이 묶음 끝 넣기를 쓰지 않는다');
    //  state.categories 에 직접 push 하는 곳은 기본 과제 보장 하나뿐(그 뒤에 정리가 돈다)
    const pushes = [...app.matchAll(/categories\.push\(/g)].length;
    assert.strictEqual(pushes, 2, 'state.categories 에 직접 push 하는 곳이 늘었다(묶음 끝 넣기를 거칠 것): ' + pushes);
  },
};
test('정적①: 묶음 정리 함수는 하나, 보장 함수와 열람 주입이 부르고 추가와 편입은 묶음 끝 넣기를 쓴다', () => statics.normalizer(src));
test('변이①s: 보장 함수에서 정리를 빼면 정적① 이 실패한다', () => {
  assert.throws(() => statics.normalizer(MUT.noNormalize(src)), /묶음 정리를 함께 하지 않는다/);
});

const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('category-groups: jsdom 미설치, 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '22', expectedSchema: '22', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CA = '2026-09-01T00:00:00Z';
  const CAT = (id, name, extra) => Object.assign({ id, name, color: '#3e5be0', desc: '', createdAt: CA }, extra || {});
  const ENT = (id, categoryId) => ({ id, date: '2026-10-01', title: '업무 ' + id, categoryId, allDay: true, startTime: '', endTime: '',
    memo: '', location: '', recur: null, recurExcept: [], endDate: '', createdAt: CA, updatedAt: CA });
  //  서버 순서는 일부러 섞는다: 기타가 맨 앞, 공식이 일반 사이, 휴가가 가운데
  const DATA = {
    categories: [CAT('c-e', '기타'), CAT('c-a', '알파'), CAT('db-1', '공식 하나', { source: 'db' }), CAT('c-v', '휴가'),
      CAT('c-b', '베타'), CAT('db-2', '공식 둘', { source: 'db' })],
    entries: [ENT('e-a', 'c-a'), ENT('e-b', 'c-b'), ENT('e-1', 'db-1'), ENT('e-2', 'db-2'), ENT('e-v', 'c-v'), ENT('e-e', 'c-e')],
    todos: [], rooms: [],
  };
  const NORM = ['db-1', 'db-2', 'c-a', 'c-b', 'c-v', 'c-e'];
  //  호스트가 주는 공식 과제 목록(DB 행 모양, id 는 db-<uid>)
  const ROW = (uid, name) => ({ uid, common_name: name, project_name: '사업 ' + name, contract_name: '계약 ' + uid, customer: '발주처' + uid, customerId: Number(uid),
    section: '일반계약', sectionId: 1, status: '진행중', statusId: 1, start_date: '2026-01-01', end_date: '2026-12-31', dev_start_date: '2026-02-01', dev_end_date: '' });
  const CATALOG = [ROW('1', '공식 하나'), ROW('2', '공식 둘'), ROW('3', '공식 셋'), ROW('4', '공식 넷')];

  function boot(source, url = 'https://tcapp.local/') {
    const log = [], timers = [];
    const handlers = { saveState: { ok: true }, replaceAllState: { ok: true }, reportRelink: { ok: true, daily: 0, weekly: 0 } };
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true, url,
      virtualConsole: jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined,
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} log.push({ post: o && o.cmd, msg: o }); }, addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        //  시계는 흐르지 않는다. 예약된 콜백을 모아 두고 부팅 보장 저장(bootDefaultsFlush)만 골라 돌린다
        win.setTimeout = (fn) => { timers.push(fn); return timers.length; };
        win.clearTimeout = () => {};
        win.matchMedia = (q) => ({ matches: /prefers-reduced-motion/.test(String(q)), media: String(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      },
    });
    const w = dom.window;
    w.__fakeReply = (cmd, params) => {
      log.push({ req: cmd, params });
      const h = handlers[cmd];
      const r = typeof h === 'function' ? h(params) : h;
      return Promise.resolve(r === undefined ? { ok: false, error: 'no handler' } : r);
    };
    w.eval('hostRequest = function(cmd, params){ return window.__fakeReply(cmd, params || {}); };');
    w.eval("window.__cf = []; confirmBox = function(t, m, ok){ window.__cf.push([String(t), String(m)]); return Promise.resolve('ok'); };");
    const sess = log.find((x) => x.post === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.msg.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'tester', name: '시험자' } }) + ')');
    const d = w.document;
    return {
      w, d, log, handlers, timers,
      ev: (c) => w.eval(c),
      evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)],
      ids: () => JSON.parse(w.eval('JSON.stringify(state.categories.map(function(c){ return c.id; }))')),
      saves: () => JSON.parse(JSON.stringify(log.filter((x) => x.req === 'saveState').map((x) => x.params.state.categories.map((c) => c.id)))),
      row: (id) => d.querySelector('#catList .cat-row[data-id="' + id + '"]'),
      open: (id) => { const e = d.getElementById(id); return !!e && !e.classList.contains('hidden') && !e.classList.contains('closing'); },
      apply: (data, meta = META) => w.eval('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(meta) + ')'),
      runBootFlush: () => { let n = 0; for (let i = timers.length - 1; i >= 0; i--) if (timers[i] === w.bootDefaultsFlush) { timers.splice(i, 1); n++; } if (n) w.bootDefaultsFlush(); return n; },
      clear: () => { log.length = 0; w.eval('window.__cf = []'); },
      close: async () => { await settle(); try { w.close(); } catch (_) {} },
    };
  }
  async function withBoot(source, fn, data = DATA) {
    const W = boot(source);
    try {
      W.apply(data); await settle();
      W.ev('__applyProjects(' + JSON.stringify(JSON.stringify(CATALOG)) + ')'); await settle();
      return await fn(W);
    } finally { await W.close(); }
  }

  const checks = {
    //  ⑥ 부팅 정리: 섞인 서버 순서 → 묶음 순서, 부팅 뒤 한 번 저장, 저장한 것을 다시 받으면 그대로(저장 없음), 정리는 몇 번 돌아도 같다
    async bootIdempotent(source) {
      const W = boot(source);
      try {
        W.apply(DATA); await settle();
        assert.deepStrictEqual(W.ids(), NORM, '부팅이 묶음 순서(공식, 일반, 휴가, 기타)로 맞추지 않았다: ' + JSON.stringify(W.ids()));
        assert.strictEqual(W.saves().length, 0, '__applyState 안에서 바로 저장했다(저장은 부팅 뒤 한 번)');
        assert.strictEqual(W.runBootFlush(), 1, '순서를 고쳤는데 부팅 뒤 저장이 예약되지 않았다');
        await settle();
        assert.deepStrictEqual(W.saves(), [NORM], '부팅 정리 저장이 한 번이 아니거나 payload 가 묶음 순서가 아니다');
        //  정리는 멱등이다(같은 배열에 다시 돌리면 바뀌지 않는다)
        assert.strictEqual(W.ev('catGroupNormalize(state)'), false, '정리를 다시 돌렸더니 또 바뀌었다(멱등이 아니다)');
        assert.strictEqual(W.ev('ensureDefaultTasks(state)'), false, '보장 함수를 다시 돌렸더니 바뀌었다고 한다');
        //  서버가 돌려준 것(이미 묶음 순서)을 다시 받으면 저장하지 않는다(다시 읽기, reloadState 도 같은 주입이다)
        W.clear();
        W.apply(Object.assign({}, DATA, { categories: NORM.map((id) => DATA.categories.find((c) => c.id === id)) })); await settle();
        assert.deepStrictEqual(W.ids(), NORM);
        assert.strictEqual(W.runBootFlush(), 0, '이미 묶음 순서인데 부팅 저장을 예약했다');
        assert.strictEqual(W.saves().length, 0, '이미 묶음 순서인데 저장했다');
        //  묶음 안 순서는 지킨다(서버가 베타를 알파 앞에 두면 그대로)
        W.apply(Object.assign({}, DATA, { categories: [DATA.categories[4], DATA.categories[0], DATA.categories[1], DATA.categories[5], DATA.categories[2], DATA.categories[3]] })); await settle();
        assert.deepStrictEqual(W.ids(), ['db-2', 'db-1', 'c-b', 'c-a', 'c-v', 'c-e'], '묶음 안 순서(사용자가 정한 순서)를 지키지 않았다');
      } finally { await W.close(); }
    },
    //  ⑥ 열람 창: 그 사람의 과제도 묶음 순서로 보이지만 저장은 없다(기본 과제도 만들지 않는다)
    async peerOrder(source) {
      const W = boot(source, 'https://tcapp.local/?peer=1');
      try {
        W.apply({ categories: [CAT('p-e', '기타'), CAT('p-a', '남의 일반'), CAT('db-9', '남의 공식', { source: 'db' })], entries: [], todos: [], rooms: [] }, { peerName: '홍길동', canWrite: false });
        await settle();
        assert.strictEqual(W.ev('PEER'), true, '시험 전제: 열람 창이 아니다');
        assert.deepStrictEqual(W.ids(), ['db-9', 'p-a', 'p-e'], '다른 사람 일정 보기의 과제 순서가 묶음 순서가 아니다');
        assert.strictEqual(W.runBootFlush(), 0, '열람 창에서 저장을 예약했다');
        assert.strictEqual(W.log.filter((x) => x.req === 'saveState' || x.post === 'saveState').length, 0, '열람 창에서 저장했다');
      } finally { await W.close(); }
    },
    //  ① 소비처: 근태 보고 과제 목록, 월간(공식, 그 밖), 필터, 선택 상자, 보고서 행이 같은 순서
    async consumers(source) {
      await withBoot(source, async (W) => {
        assert.deepStrictEqual(W.ids(), NORM);
        const nameOf = Object.fromEntries(DATA.categories.map((c) => [c.id, c.name]));
        assert.deepStrictEqual(W.evJSON('atProjNames()'), NORM.map((id) => nameOf[id]), '근태 보고 과제 목록이 묶음 순서가 아니다');
        assert.deepStrictEqual(W.evJSON('rptMOfficial().map(function(c){ return c.id; })'), ['db-1', 'db-2'], '월간 공식 과제 순서가 다르다');
        assert.deepStrictEqual(W.evJSON('rptMEtcCats().map(function(c){ return c.key; })'), ['c-a', 'c-b', 'c-v', 'c-e'], '월간 그 밖 과제 순서가 일반, 휴가, 기타가 아니다');
        W.ev("filterCats = new Set(['c-e', 'db-2', 'c-a']); renderFilterbar();");
        assert.deepStrictEqual(W.evJSON('filterSelCats().map(function(c){ return c.id; })'), ['db-2', 'c-a', 'c-e'], '필터에서 고른 과제가 묶음 순서가 아니다');
        W.ev('filterCats = null; renderFilterbar();');
        assert.deepStrictEqual(W.evJSON("(function(){ var s = document.createElement('select'); fillCatSelect(s); return [].map.call(s.options, function(o){ return o.value; }); })()"), NORM, '과제 선택 상자가 묶음 순서가 아니다');
        assert.deepStrictEqual(W.evJSON("collectReportData('2026-10-01', '2026-10-01').rows.map(function(r){ return r.key; })"), NORM, '보고서 행이 묶음 순서가 아니다');
        //  묶음 안에서 옮기면 소비처도 따라간다
        W.ev('openCatModal();'); await settle();
        W.ev("catReorder('c-b', 2);"); await settle();
        assert.deepStrictEqual(W.evJSON('atProjNames()').slice(2, 4), ['베타', '알파'], '옮긴 순서를 근태 보고가 따르지 않는다');
      });
    },
    //  ② ③ 내 과제 창: 묶음 머리, 휴가와 기타는 ⠿ 와 ⋯ 가 없고 누르면 수정 창, 순서 단추는 묶음 끝에서 꺼진다
    async windowRules(source) {
      await withBoot(source, async (W) => {
        W.ev('openCatModal();'); await settle();
        const seq = W.$$('#catList > *').map((x) => x.classList.contains('cat-grp') ? x.textContent : x.dataset.id);
        assert.deepStrictEqual(seq, ['공식 과제 2', 'db-1', 'db-2', '일반 과제 2', 'c-a', 'c-b', '기본 2', 'c-v', 'c-e'], '묶음 머리 줄이 다르다: ' + JSON.stringify(seq));
        for (const id of ['c-v', 'c-e']) {
          assert.strictEqual(W.row(id).querySelector('[data-catgrip]'), null, `${id} 에 ⠿ 가 있다`);
          assert.strictEqual(W.row(id).querySelector('[data-catmore]'), null, `${id} 에 ⋯ 가 있다`);
          W.row(id).querySelector('.cat-nm').click();
          assert.ok(W.open('catEditModal') && W.ev('__catEditId') === id, `${id} 줄을 눌렀는데 수정 창이 열리지 않았다`);
          assert.ok(W.ev("$('#ceName').classList.contains('hidden')"), `${id} 의 이름을 고칠 수 있다(기본 과제 규칙)`);
          W.ev("closeModal('#catEditModal')");
        }
        //  일반 묶음 끝(c-b)의 아래로, 공식 묶음 끝(db-2)의 아래로는 꺼져 있다
        const menu = (id) => { W.row(id).querySelector('[data-catmore]').click(); const m = [...W.row(id).querySelectorAll('.cat-menu-ord [data-catdo]')].map((b) => b.dataset.catdo + (b.disabled ? ':off' : '')); W.ev('catMenuClose(false)'); return m; };
        assert.deepStrictEqual(menu('c-b'), ['top', 'up', 'down:off', 'bottom:off'], '일반 묶음 끝의 아래로가 꺼지지 않았다');
        assert.deepStrictEqual(menu('db-2'), ['top', 'up', 'down:off', 'bottom:off'], '공식 묶음 끝의 아래로가 꺼지지 않았다');
        assert.deepStrictEqual(menu('c-a'), ['top:off', 'up:off', 'down', 'bottom'], '일반 묶음 첫 줄의 위로가 꺼지지 않았다');
        //  함수도 막는다(화면 우회)
        W.clear();
        //  묶음 첫 줄을 공식 쪽으로, 공식 끝 줄을 일반 쪽으로, 휴가와 기타를 어디로든: 묶음 안으로 잘려 제자리라 아무것도 하지 않는다
        for (const [id, to] of [['c-a', 0], ['db-2', 5], ['c-v', 0], ['c-e', 2]]) assert.strictEqual(W.ev(`catReorder('${id}', ${to})`), false, `catReorder(${id} → ${to}) 가 묶음 밖으로 옮겼다`);
        for (const [id, d] of [['c-a', -1], ['db-2', 1], ['c-v', -1], ['c-e', -1]]) assert.strictEqual(W.ev(`moveCategory('${id}', ${d})`), false, `moveCategory(${id}, ${d}) 가 묶음 밖으로 옮겼다`);
        assert.deepStrictEqual(W.ids(), ['db-1', 'db-2', 'c-a', 'c-b', 'c-v', 'c-e'], '묶음 밖으로 옮겨졌다: ' + JSON.stringify(W.ids()));
        assert.strictEqual(W.saves().length, 0, '묶음 밖 옮기기가 저장했다');
      });
    },
    //  ④ 합치기, 옮기기, 연결: 휴가와 기타는 출발도 대상도 아니다(목록과 함수)
    async mergeBlocked(source) {
      await withBoot(source, async (W) => {
        W.ev('openCatModal();'); await settle();
        W.ev("openCatMoveModal('c-a')");
        assert.ok(W.open('catMoveModal'), '합치기 창이 열리지 않았다(시험 전제)');
        assert.deepStrictEqual(W.$$('#cmvTarget option').map((o) => o.value).filter(Boolean), ['db-1', 'db-2', 'c-b'], '합치기 대상에 휴가나 기타가 있다');
        W.ev("closeModal('#catMoveModal')");
        for (const id of ['c-v', 'c-e']) {
          W.ev(`openCatMoveModal('${id}')`);
          assert.ok(!W.open('catMoveModal'), `${id} 에서 합치기 창이 열렸다`);
        }
        W.clear();
        for (const [a, b] of [['c-v', 'c-a'], ['c-e', 'db-1'], ['c-a', 'c-v'], ['db-1', 'c-e'], ['c-v', 'c-e']])
          assert.strictEqual(W.ev(`moveCategoryData('${a}', '${b}')`), null, `moveCategoryData(${a} → ${b}) 가 막히지 않았다`);
        assert.deepStrictEqual(W.evJSON("state.entries.map(function(e){ return e.id + ':' + e.categoryId; })"), ['e-a:c-a', 'e-b:c-b', 'e-1:db-1', 'e-2:db-2', 'e-v:c-v', 'e-e:c-e'], '막혔는데 기록의 과제가 바뀌었다');
        assert.strictEqual(W.saves().length, 0, '막혔는데 저장했다');
        //  대조군: 일반끼리는 된다
        assert.ok(W.evJSON("moveCategoryData('c-b', 'c-a')"), '대조군: 일반 과제 합치기가 막혔다');
        //  공식 과제로 연결: 목록에 없고, 고르기 팝업이 열리지 않고, 짝을 지어도 실행에서 건너뛴다
        W.ev('openRelinkModal();');
        assert.deepStrictEqual(W.$$('#rlList .rl-row').map((r) => r.dataset.cat), ['c-a', 'c-b'], '연결 목록에 휴가나 기타가 있다');
        W.ev("openRelinkPick('c-v')");
        assert.ok(!W.open('relinkPickModal'), '휴가의 연결 고르기 팝업이 열렸다');
        W.ev("rlpFor = 'c-e'; rlpChoose('db-3');");
        assert.strictEqual(W.ev("rlPick.has('c-e')"), false, '기타에 공식 과제를 짝지었다');
        W.ev("rlPick.set('c-v', 'db-3'); runRelink();"); for (let i = 0; i < 8; i++) await settle();
        assert.ok(W.ids().includes('c-v') && W.ev("entryById('e-v').categoryId") === 'c-v', '휴가가 공식 과제로 연결됐다');
        assert.strictEqual(W.log.filter((x) => x.req === 'reportRelink').length, 0, '휴가의 공수 옮기기를 호스트에 보냈다');
      });
    },
    //  ⑤ 새 과제의 자리: 일반은 일반 묶음 끝(휴가 위), 공식 추가와 연결은 공식 묶음 끝(일반 위)
    async newAtGroupEnd(source) {
      await withBoot(source, async (W) => {
        W.ev("openCatAdd('own'); $('#caName').value = '새 일반'; catAddOwn();"); await settle();
        const nid = W.ids()[4];
        assert.strictEqual(W.ev(`catById('${nid}').name`), '새 일반', '새 일반 과제가 일반 묶음 끝(휴가 위)에 들어가지 않았다: ' + JSON.stringify(W.ids()));
        assert.deepStrictEqual(W.ids().slice(5), ['c-v', 'c-e'], '새 과제 뒤에 휴가, 기타가 아니다');
        W.ev("catAddOfficial('db-3')"); await settle();
        assert.deepStrictEqual(W.ids().slice(0, 3), ['db-1', 'db-2', 'db-3'], '공식 과제 추가가 공식 묶음 끝에 들어가지 않았다: ' + JSON.stringify(W.ids()));
        //  공식 과제로 연결: c-a 를 db-4 로 → db-4 는 공식 묶음 끝, c-a 는 지워진다
        W.ev("openRelinkModal(); rlPick.set('c-a', 'db-4'); runRelink();");
        for (let i = 0; i < 12; i++) await settle();
        const ids = W.ids();
        assert.ok(!ids.includes('c-a'), '연결한 옛 과제가 남았다(시험 전제): ' + JSON.stringify(ids));
        assert.deepStrictEqual(ids.slice(0, 4), ['db-1', 'db-2', 'db-3', 'db-4'], '연결된 공식 과제가 공식 묶음 끝에 들어가지 않았다: ' + JSON.stringify(ids));
        assert.deepStrictEqual(ids.slice(-2), ['c-v', 'c-e'], '연결 뒤 휴가, 기타가 맨 아래가 아니다');
        assert.strictEqual(W.ev("entryById('e-a').categoryId"), 'db-4', '연결이 일정을 옮기지 않았다(시험 전제)');
      });
    },
    //  ⑥ 가져오기(XML 교체)도 묶음 순서로 정리한다
    async importNormalized(source) {
      await withBoot(source, async (W) => {
        const FILE = { categories: [CAT('f-e', '기타'), CAT('f-p', '파일 과제'), CAT('f-v', '휴가'), CAT('db-o', '공식', { source: 'db' })], entries: [], todos: [], rooms: [] };
        W.ev('pendingImport = ' + JSON.stringify(FILE) + '; applyImport({ quiet: true });'); await settle();
        assert.deepStrictEqual(W.ids(), ['db-o', 'f-p', 'f-v', 'f-e'], '가져오기 뒤 묶음 순서가 아니다: ' + JSON.stringify(W.ids()));
        const sent = W.log.filter((x) => x.req === 'replaceAllState');
        assert.strictEqual(sent.length, 1, '가져오기가 전량 교체 한 번이 아니다(시험 전제)');
        assert.deepStrictEqual(JSON.parse(JSON.stringify(sent[0].params.state.categories.map((c) => c.id))), ['db-o', 'f-p', 'f-v', 'f-e'], '가져오기로 보낸 순서가 묶음 순서가 아니다');
      });
    },
  };

  test('행동①: 부팅 정리. 섞인 순서를 묶음 순서로, 부팅 뒤 한 번 저장, 다시 받으면 저장 없음, 정리는 멱등, 묶음 안 순서 유지', () => checks.bootIdempotent(src));
  test('행동②: 다른 사람 일정 보기도 묶음 순서로 보이고 저장하지 않는다', () => checks.peerOrder(src));
  test('행동③: 근태 보고, 월간, 필터, 선택 상자, 보고서 행이 묶음 순서를 따른다', () => checks.consumers(src));
  test('행동④: 묶음 머리 줄 · 휴가와 기타는 ⠿ 와 ⋯ 없이 누르면 수정 창 · 순서 단추와 catReorder 는 묶음 끝에서 멈춘다', () => checks.windowRules(src));
  test('행동⑤: 합치기, 옮기기, 공식 과제로 연결에서 휴가와 기타는 출발도 대상도 아니다(목록과 함수)', () => checks.mergeBlocked(src));
  test('행동⑥: 새 일반 과제는 일반 묶음 끝, 공식 과제 추가와 연결은 공식 묶음 끝', () => checks.newAtGroupEnd(src));
  test('행동⑦: XML 가져오기도 묶음 순서로 정리해 보낸다', () => checks.importNormalized(src));

  test('변이①: 보장 함수에서 정리를 빼면 행동① 이 실패한다', async () => {
    await assert.rejects(() => checks.bootIdempotent(MUT.noNormalize(src)), /묶음 순서\(공식, 일반, 휴가, 기타\)로 맞추지 않았다/);
  });
  test('변이②: 정리가 묶음 안 순서를 이름순으로 바꾸면 행동① 이 실패한다', async () => {
    await assert.rejects(() => checks.bootIdempotent(MUT.unstable(src)), /묶음 안 순서|묶음 순서/);
  });
  test('변이③: 새 일반 과제를 맨 뒤에 붙이면 행동⑥ 이 실패한다', async () => {
    await assert.rejects(() => checks.newAtGroupEnd(MUT.addAtEnd(src)), /일반 묶음 끝/);
  });
  test('변이④: 공식 과제 편입을 맨 뒤에 붙이면 행동⑥ 이 실패한다', async () => {
    await assert.rejects(() => checks.newAtGroupEnd(MUT.subAtEnd(src)), /공식 묶음 끝/);
  });
  test('변이⑤: 합치기 대상에서 휴가, 기타를 거르지 않으면 행동⑤ 가 실패한다', async () => {
    await assert.rejects(() => checks.mergeBlocked(MUT.mergeTargets(src)), /합치기 대상에 휴가나 기타가 있다/);
  });
  test('변이⑥: 옮기기 함수의 휴가, 기타 막기를 빼면 행동⑤ 가 실패한다', async () => {
    await assert.rejects(() => checks.mergeBlocked(MUT.moveGuard(src)), /막히지 않았다/);
  });
  test('변이⑦: 열람 창 정리를 빼면 행동② 가 실패한다', async () => {
    const bad = mutate('    if(!PEER) __bootDefaultsDirty = ensureDefaultTasks(state);\n    else catGroupNormalize(state);', '    if(!PEER) __bootDefaultsDirty = ensureDefaultTasks(state);', src);
    await assert.rejects(() => checks.peerOrder(bad), /묶음 순서가 아니다/);
  });
}
