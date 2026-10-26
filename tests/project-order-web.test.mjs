// 과제 관리 화면 개선(웹), docs/PROJECT-ADMIN-UX.md §1.1 순서(No), §1.2 상태 체크박스, §1.3 참조 id, §1.4 연결 규칙 삭제(2026-10-26).
//
// 지키는 것:
//   (S) 정적, 옮긴 뒤 자리 계산(맨 위로, 한 칸 위로, 한 칸 아래로, 맨 아래로, N번째)과 끌어 놓은 자리, 구분 안 정렬(sortNo, 빈 값은 뒤, 이름),
//       순서 저장 왕복은 한 함수(offOrderSend) 한 곳, 참조 id 줄과 옛 '진행중만' 체크와 코드 행 보호가 없다, 기억은 try 로 감싼다.
//   (R) jsdom, 관리 창(⚙ 관리에 도킹된 공식 과제)에서 No 칸(거른 뒤에도 전체 기준), 손잡이와 ⋯ 는 도킹일 때만, 필터를 쓰면 끌기만 꺼짐,
//       ⋯ 메뉴 다섯 동작이 그 구분 전체의 uid 순서를 한 번에 보냄, stale 회신이면 되돌리고 새로 받음, 끌어 놓기도 같은 길,
//       Esc 는 메뉴만 닫고 ⋯ 로 포커스, 상태 체크박스는 상태표에서 만들고 이 PC 에 기억되며 Excel 부제에 뺀 상태를 적는다.
//   (M) 변이, 위 계약이 각각 한 줄 변이로 깨진다(안 깨지면 그 검사는 장식이다).
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, extractCodeIdsBlock, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다(리팩터로 사라졌다면 앵커를 갱신할 것): ' + find.slice(0, 120));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 120));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
function constLine(src, name) {
  const m = new RegExp('^const ' + name + '\\s*=.*$', 'm').exec(src);
  if (!m) throw new Error(`const ${name} 선언을 찾지 못함`);
  return m[0];
}

// ══ (S) 정적 ══════════════════════════════════════════════════════════
function pure(src) {
  return new Function([extractCodeIdsBlock(src), constLine(src, 'offTrim'), 'let offSections = [{id:1,name:"일반계약"},{id:2,name:"선진행"}];',
    extractFunction(src, 'offSectionOf'), extractFunction(src, 'offGroups'), extractFunction(src, 'offOrderTarget'), extractFunction(src, 'offDropIndex'),
    'return { offGroups, offOrderTarget, offDropIndex };'].join('\n'))();
}
const statics = {
  target(src) {
    const X = pure(src);
    const t = (from, how) => X.offOrderTarget(from, 5, how);
    assert.deepStrictEqual([t(2, 'top'), t(2, 'up'), t(2, 'down'), t(2, 'bottom')], [0, 1, 3, 4], '맨 위로, 한 칸 위로, 한 칸 아래로, 맨 아래로의 자리가 틀렸다');
    assert.deepStrictEqual([t(0, 'up'), t(4, 'down')], [0, 4], '끝에서 한 칸 더 가면 끝에 붙어야 한다');
    assert.deepStrictEqual([t(2, 1), t(2, 5), t(2, 9), t(2, 0), t(2, '3')], [0, 4, 4, 0, 2], 'N번째(1부터)의 자리가 틀렸거나 범위 밖을 끝에 붙이지 않는다');
  },
  drop(src) {
    const X = pure(src), rows = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    assert.deepStrictEqual([X.offDropIndex(rows, 'a', 'c'), X.offDropIndex(rows, 'd', 'b'), X.offDropIndex(rows, 'a', 'zz')], [2, 1, -1],
      '끌어 놓은 자리는 놓은 줄의 자리여야 한다(시안 C), 모르는 줄이면 -1');
  },
  order(src) {
    const X = pure(src);
    const list = [
      { id: '1', name: '다', sectionId: 2, sortNo: 1 }, { id: '2', name: '가', sectionId: 1 }, { id: '3', name: '나', sectionId: 1, sortNo: 2 },
      { id: '4', name: '라', sectionId: 1, sortNo: 1 }, { id: '5', name: '마', sectionId: 1, sortNo: null }, { id: '6', name: '바', sectionId: 1, sortNo: 10 },
    ];
    assert.deepStrictEqual(X.offGroups(list).map(([, rows]) => rows.map((c) => c.id)), [['4', '3', '6', '2', '5'], ['1']],
      '구분 순서, 그 안은 sortNo(숫자 순, 빈 값은 뒤), 그다음 이름순이 아니다');
  },
  oneHelper(src) {
    const code = stripJsComments(src);
    const hits = code.match(/hostRequest\('projectReorder'/g) || [];
    assert.strictEqual(hits.length, 1, `순서 저장 명령을 부르는 곳이 ${hits.length}곳이다(한 함수 offOrderSend 에만 둔다)`);
    assert.ok(/hostRequest\('projectReorder', \{ sectionId: sectionId, uids: uids \}/.test(stripJsComments(extractFunction(src, 'offOrderSend'))), 'offOrderSend 가 { sectionId, uids } 를 보내지 않는다');
  },
  removed(src) {
    //  패치노트(#patchModal)는 지난 판의 기록이라 옛 문구를 그대로 둔다. 그 구역은 빼고 본다.
    const pa = src.indexOf('id="patchModal"'), pb = pa < 0 ? -1 : src.indexOf('<!-- =====', pa);
    const live = pa < 0 || pb < 0 ? src : src.slice(0, pa) + src.slice(pb);
    const html = stripHtmlComments(live), code = stripJsComments(html);
    assert.ok(!/참조 id/.test(code) && !/\.off-d-ref\b/.test(code), '과제 상세의 참조 id 줄이나 그 CSS 가 남아 있다(§1.3)');
    for (const id of ['offActiveOnly', 'rlpActiveOnly', 'offStatus', 'rlpStatus'])
      assert.ok(!new RegExp(`id="${id}"`).test(html) && !new RegExp(`'#?${id}'`).test(code), `옛 상태 거르기(#${id})가 남아 있다(§1.2)`);
    assert.ok(!/진행중만/.test(code), "화면에 '진행중만'이 남아 있다(§1.2)");
    assert.ok(!/CODE_PROTECT_WHY|codeProtectedWhy|data-codelock/.test(code), '코드 행 보호(CODE_PROTECT_WHY, data-codelock)가 남아 있다(§1.4)');
    assert.ok(/id="offStChecks"/.test(html) && /id="rlpStChecks"/.test(html), '상태 체크박스 자리(#offStChecks, #rlpStChecks)가 없다');
  },
  storageGuarded(src) {
    for (const fn of ['offStOffSet', 'offStSave']) {
      const b = extractFunction(src, fn);
      assert.ok(/try\{[^}]*localStorage\./.test(b), `${fn} 의 localStorage 접근이 try 로 감싸여 있지 않다(사생활 창, 막힌 저장소에서 화면이 죽는다)`);
    }
    assert.ok(/const OFF_ST_KEY = 'tc_projStatusOff';/.test(src), '상태 체크박스 기억 열쇠가 tc_projStatusOff 하나가 아니다');
  },
};
test('순서(S)①: 맨 위로, 한 칸 위로, 한 칸 아래로, 맨 아래로, N번째 자리', () => statics.target(app));
test('순서(S)②: 끌어 놓은 자리 = 놓은 줄의 자리', () => statics.drop(app));
test('순서(S)③: 구분 순서, sortNo(빈 값은 뒤), 이름순', () => statics.order(app));
test('순서(S)④: 순서 저장 명령은 한 함수(offOrderSend) 한 곳에서 { sectionId, uids } 로', () => statics.oneHelper(app));
test('정리(S)⑤: 참조 id, 진행중만, 상태 셀렉트, 코드 행 보호가 없고 상태 체크박스 자리가 있다', () => statics.removed(app));
test('정리(S)⑥: 상태 체크박스 기억은 tc_projStatusOff 하나, 읽기와 쓰기 모두 try', () => statics.storageGuarded(app));
test('변이(S)①: 한 칸 위로를 아래로 바꾸면 (S)① 이 잡는다', () => {
  assert.throws(() => statics.target(mutate(app, "  if(how === 'up') return Math.max(0, from - 1);", "  if(how === 'up') return Math.min(n - 1, from + 1);")), /자리가 틀렸다/);
});
test('변이(S)③: 빈 sortNo 를 앞에 두면 (S)③ 이 잡는다', () => {
  assert.throws(() => statics.order(mutate(app, '    if(x !== y){ if(x == null) return 1; if(y == null) return -1; return x - y; }', '    if(x !== y){ if(x == null) return -1; if(y == null) return 1; return x - y; }')), /빈 값은 뒤/);
});
test('변이(S)④: 순서 저장을 다른 곳에서 또 부르면 (S)④ 가 잡는다', () => {
  assert.throws(() => statics.oneHelper(mutate(app, 'function offOrderReload(){', "function offOrderX(){ return hostRequest('projectReorder', {}, 1); }\nfunction offOrderReload(){")), /한 함수/);
});
test('변이(S)⑤: 참조 id 줄을 되살리면 (S)⑤ 가 잡는다', () => {
  assert.throws(() => statics.removed(mutate(app, '    + `</dl>`\n', '    + `</dl>`\n    + `<div class="off-d-ref">참조 id: ${esc(c.id)}</div>`\n')), /참조 id/);
});

// ══ (R) jsdom ═════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
if (!JSDOM) {
  skip('project-order-web: jsdom 미설치, 관리 목록 순서, 상태 체크박스 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const ME = { loginId: 'phmin', name: '박현민', title: '수석연구원', orgUnit: 'SW 3팀' };
  const EMPTY = { categories: [], entries: [], todos: [], rooms: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '' };
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const ADMIN_URL = 'https://tcapp.local/?win=admin', MAIN_URL = 'https://tcapp.local/';
  const SECTIONS = [{ id: 1, name: '일반계약' }, { id: 2, name: '선진행' }];
  const STATUSES = [{ id: 1, name: '진행중' }, { id: 2, name: '종료' }, { id: 3, name: '1차 납품완료' }];
  const P = (uid, name, sectionId, sortNo, statusId) => ({ id: 'db-' + uid, name, color: '#3e5be0', source: 'db', customer: 'zzC', customerId: 7,
    section: SECTIONS.find((s) => s.id === sectionId).name, sectionId, status: statusId ? STATUSES.find((s) => s.id === statusId).name : '', statusId: statusId || null,
    sortNo, projectName: name, commonName: name, contractName: '', startDate: '', endDate: '', devStartDate: '', devEndDate: '' });
  //  일반계약: a(1) b(2) c(3, 종료) d(4) e(번호 없음), 선진행: f(1)
  const CATALOG = [P('e', 'zz마', 1, null, 1), P('c', 'zz다', 1, 3, 2), P('a', 'zz가', 1, 1, 1), P('d', 'zz라', 1, 4, 3), P('b', 'zz나', 1, 2, null), P('f', 'zz바', 2, 1, 1)];

  function boot(src, url = ADMIN_URL) {
    const posted = [], errors = [];
    const vc = new jsdomMod.VirtualConsole();
    vc.on('jsdomError', (e) => errors.push(String(e && (e.stack || e.message) || e)));
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc,
      beforeParse(win) {
        win.chrome = { webview: { postMessage: (s) => posted.push(String(s)), addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.__realClose = win.close; win.close = function () {};
      },
    });
    const w = dom.window;
    const B = { w, posted, errors, doc: w.document, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      close: () => { try { w.__realClose.call(w); } catch (_) {} } };
    w.eval(`window.__calls = []; window.__rep = {}; window.__toasts = [];
      hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
        var r = __rep[cmd];
        if(r === undefined) return Promise.resolve({ ok:false, msg:'시험: 회신 없음' });
        return Promise.resolve(JSON.parse(JSON.stringify(r))); };
      (function(){ var t = toast; toast = function(m, k, a, ms){ __toasts.push([String(m), String(k || '')]); return t(m, k, a, ms); }; })();`);
    const sess = posted.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).find((m) => m && m.cmd === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: ME }) + ')');
    w.eval('currentUser = ' + JSON.stringify(ME));
    w.__applyState(JSON.stringify(EMPTY), {});
    w.eval('dbOnline = true;');
    w.__applyCodes(JSON.stringify(SECTIONS), JSON.stringify(STATUSES));
    B.ev(`dbCatalog = ${JSON.stringify(CATALOG)}; __rep = { userInfoGet: { ok: true, info: { edit_role: 'admin', is_active: 1 } }, projectReorder: { ok: true } };
      ahNoteRole(true); 1`);
    return B;
  }
  const $ = (B, s) => B.doc.querySelector(s);
  const $$ = (B, s) => [...B.doc.querySelectorAll(s)];
  const calls = (B, cmd) => B.evJSON('__calls').filter((c) => c[0] === cmd);
  const rowsIn = (B, sid) => $$(B, `#offList .off-row[data-sid="${sid}"]`).map((r) => [r.dataset.id.slice(3), r.querySelector('.off-no').textContent]);
  const openHub = async (B) => { B.ev("openAdminHub('projects')"); await settle(80);
    assert.ok($(B, '#officialModal').classList.contains('docked'), '전제: 공식 과제가 관리 화면에 도킹되지 않았다'); };
  async function withB(src, url, fn) { const B = boot(src, url); try { await fn(B); assert.deepStrictEqual(B.errors, [], '페이지 오류'); } finally { B.close(); } }
  const more = (B, uid) => $(B, `#offList [data-offmore="db-${uid}"]`);
  async function menu(B, uid, how, n) {
    more(B, uid).click(); await settle(10);
    assert.ok($(B, '#offList .off-ordmenu'), `전제: ${uid} 의 ⋯ 메뉴가 열리지 않았다`);
    if (how === 'to') { $(B, '#offOrdTo').value = String(n); }
    $(B, `#offList .off-ordmenu [data-offmv="${how}"]`).click(); await settle(30);
  }
  const lastOrder = (B) => { const c = calls(B, 'projectReorder'); return c.length ? c[c.length - 1][1] : null; };

  const dom = {
    //  R1 No 칸: 구분마다 1부터, 화면 순서 = sortNo(빈 값은 뒤). 상태를 꺼서 줄이 빠져도 No 는 전체 기준이다.
    async noColumn(src) {
      await withB(src, ADMIN_URL, async (B) => {
        B.ev('offStReset()'); await openHub(B);
        assert.deepStrictEqual(rowsIn(B, 1), [['a', '1'], ['b', '2'], ['c', '3'], ['d', '4'], ['e', '5']], '일반계약의 순서나 No 가 틀렸다');
        assert.deepStrictEqual(rowsIn(B, 2), [['f', '1']], '선진행의 No 가 1부터가 아니다');
        assert.ok(/No/.test($(B, '#offList .off-hrow').textContent), '머리줄에 No 가 없다');
        B.doc.querySelector('#offStChecks [data-offst="2"]').click(); await settle(10);   // 종료 끄기
        assert.deepStrictEqual(rowsIn(B, 1), [['a', '1'], ['b', '2'], ['d', '4'], ['e', '5']], '상태를 꺼서 줄이 빠지자 No 가 다시 매겨졌다(전체 기준이어야 한다)');
      });
    },
    //  R2 손잡이와 ⋯ 는 도킹(관리 화면)에서만, 단독 찾아보기에는 없다(No 는 둘 다)
    async dockOnly(src) {
      await withB(src, ADMIN_URL, async (B) => {
        await openHub(B);
        assert.strictEqual($$(B, '#offList [data-offmore]').length, 6, '관리 화면 줄마다 ⋯ 가 서지 않았다');
        assert.strictEqual($$(B, '#offList [data-offdrag]').length, 6, '관리 화면 줄마다 끌기 손잡이가 서지 않았다');
        assert.ok($(B, '#offList').classList.contains('ord'), '관리 화면 목록에 .ord 가 없다(칸 배치)');
      });
      await withB(src, MAIN_URL, async (B) => {
        B.ev('openOfficialModal()'); await settle(60);
        assert.ok(!$(B, '#officialModal').classList.contains('docked'), '전제: 단독으로 열리지 않았다');
        assert.strictEqual($$(B, '#offList .off-drag, #offList [data-offmore]').length, 0, '단독 찾아보기(읽기 전용)에 순서 옮기기가 섰다');
        assert.strictEqual($$(B, '#offList .off-no').length, 6, '단독 찾아보기에 No 칸이 없다');
        B.ev("offOrderMove('db-b', 0)"); await settle(20);
        assert.strictEqual(calls(B, 'projectReorder').length, 0, '단독 찾아보기에서 순서 저장이 나갔다');
      });
    },
    //  R3 필터를 쓰면 끌기만 꺼지고(이유 title) ⋯ 는 그대로, 번호는 전체 기준
    async dragOffUnderFilter(src) {
      await withB(src, ADMIN_URL, async (B) => {
        await openHub(B);
        const s = $(B, '#offSearch'); s.value = 'zz라'; s.dispatchEvent(new B.w.Event('input', { bubbles: true })); await settle(10);
        assert.strictEqual($$(B, '#offList [data-offdrag]').length, 0, '검색 중인데 끌기 손잡이가 켜져 있다');
        const off = $(B, '#offList .off-drag.off-drag-off');
        assert.ok(off && /필터를 쓰는 동안/.test(off.title), '꺼진 손잡이에 이유(title)가 없다');
        assert.ok(more(B, 'd'), '검색 중에 ⋯ 메뉴가 사라졌다(메뉴는 늘 된다)');
        await menu(B, 'd', 'top');
        assert.deepStrictEqual(lastOrder(B), { sectionId: 1, uids: ['d', 'a', 'b', 'c', 'e'] }, '검색 중의 ⋯ 이동이 전체 목록 기준이 아니다');
      });
    },
    //  R4 ⋯ 다섯 동작 → 그 구분 전체 uid 순서를 한 번에(낙관적으로 먼저 옮겨 보인다)
    async menuMoves(src) {
      await withB(src, ADMIN_URL, async (B) => {
        await openHub(B);
        await menu(B, 'c', 'top');
        assert.deepStrictEqual(lastOrder(B), { sectionId: 1, uids: ['c', 'a', 'b', 'd', 'e'] }, '맨 위로');
        assert.deepStrictEqual(rowsIn(B, 1).map((x) => x[0]), ['c', 'a', 'b', 'd', 'e'], '맨 위로 옮긴 뒤 화면 순서가 그대로다(낙관적 반영 없음)');
        await menu(B, 'b', 'up');
        assert.deepStrictEqual(lastOrder(B).uids, ['c', 'b', 'a', 'd', 'e'], '한 칸 위로');
        await menu(B, 'c', 'down');
        assert.deepStrictEqual(lastOrder(B).uids, ['b', 'c', 'a', 'd', 'e'], '한 칸 아래로');
        await menu(B, 'b', 'bottom');
        assert.deepStrictEqual(lastOrder(B).uids, ['c', 'a', 'd', 'e', 'b'], '맨 아래로');
        await menu(B, 'e', 'to', 1);
        assert.deepStrictEqual(lastOrder(B).uids, ['e', 'c', 'a', 'd', 'b'], 'N번째로 이동');
        assert.ok(calls(B, 'projectReorder').every((c) => c[1].sectionId === 1 && c[1].uids.length === 5), '다른 구분이 섞였거나 일부만 보냈다');
        //  맨 위 줄은 맨 위로, 한 칸 위로가 꺼져 있다
        more(B, 'e').click(); await settle(10);
        const dis = $$(B, '#offList .off-ordmenu [role="menuitem"]').map((b) => [b.dataset.offmv, b.disabled]);
        assert.deepStrictEqual(dis, [['top', true], ['up', true], ['down', false], ['bottom', false]], '맨 위 줄의 메뉴 켜짐이 틀렸다');
        assert.strictEqual(B.doc.activeElement && B.doc.activeElement.dataset.offmv, 'down', '메뉴를 열면 켜진 첫 항목에 포커스가 가야 한다');
        //  범위 밖 N 은 저장하지 않는다
        const n0 = calls(B, 'projectReorder').length;
        $(B, '#offOrdTo').value = '9'; $(B, '#offList .off-ordmenu [data-offmv="to"]').click(); await settle(20);
        assert.strictEqual(calls(B, 'projectReorder').length, n0, '범위 밖 순서(9)로 저장이 나갔다');
      });
    },
    //  R5 stale 회신: 원래 순서로 돌리고, 알리고, 목록을 새로 받는다
    async staleReload(src) {
      await withB(src, ADMIN_URL, async (B) => {
        await openHub(B);
        B.ev("__rep.projectReorder = { ok: false, kind: 'stale', error: '목록이 바뀌었습니다' }; 1");
        const p0 = B.posted.length;
        await menu(B, 'd', 'top'); await settle(30);
        assert.deepStrictEqual(rowsIn(B, 1).map((x) => x[0]), ['a', 'b', 'c', 'd', 'e'], 'stale 인데 옮긴 순서가 남았다(되돌려야 한다)');
        const t = B.evJSON('__toasts').pop();
        assert.ok(t && /바뀌어/.test(t[0]) && t[1] === 'warn', 'stale 을 알리지 않는다: ' + JSON.stringify(t));
        const sent = B.posted.slice(p0).map((s) => { try { return JSON.parse(s).cmd; } catch (_) { return ''; } });
        assert.ok(sent.includes('loadProjects'), 'stale 뒤에 목록을 새로 받지 않는다(loadProjects)');
      });
    },
    //  R6 끌어 놓기(포인터), 같은 저장 길
    async dragDrop(src) {
      await withB(src, ADMIN_URL, async (B) => {
        await openHub(B);
        const W = B.w, h = $(B, '#offList [data-offdrag="db-a"]'), target = $(B, '#offList .off-row[data-id="db-d"]');
        B.doc.elementFromPoint = () => target;
        const pe = (type, el, x, y) => el.dispatchEvent(new W.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
        pe('pointerdown', h, 10, 10); pe('pointermove', B.doc, 10, 40);
        assert.ok(target.classList.contains('off-drop-after'), '아래로 끌 때 놓을 자리 표시(off-drop-after)가 없다');
        pe('pointermove', B.doc, 10, 60); pe('pointerup', B.doc, 10, 60); await settle(30);
        assert.deepStrictEqual(lastOrder(B), { sectionId: 1, uids: ['b', 'c', 'd', 'a', 'e'] }, '끌어 놓기의 순서가 틀렸다');
        assert.strictEqual($$(B, '.off-drag-ghost').length, 0, '끌기가 끝났는데 그림자 줄이 남았다');
        //  다른 구분 줄에 놓으면 아무것도 보내지 않는다
        const n0 = calls(B, 'projectReorder').length, other = $(B, '#offList .off-row[data-id="db-f"]');
        B.doc.elementFromPoint = () => other;
        pe('pointerdown', $(B, '#offList [data-offdrag="db-b"]'), 10, 10); pe('pointermove', B.doc, 10, 80); pe('pointerup', B.doc, 10, 80); await settle(20);
        assert.strictEqual(calls(B, 'projectReorder').length, n0, '다른 구분의 줄에 놓았는데 순서 저장이 나갔다');
      });
    },
    //  R7 Esc 는 메뉴만 닫고 ⋯ 로 포커스(창은 그대로)
    async escKeepsModal(src) {
      await withB(src, ADMIN_URL, async (B) => {
        await openHub(B);
        more(B, 'b').click(); await settle(10);
        const item = $(B, '#offList .off-ordmenu [role="menuitem"]:not(:disabled)');
        item.dispatchEvent(new B.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        assert.strictEqual(B.doc.activeElement.dataset.offmv, 'up', '메뉴에서 ↓ 가 다음 항목으로 가지 않는다');
        B.doc.activeElement.dispatchEvent(new B.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle(20);
        assert.ok(!$(B, '#offList .off-ordmenu'), 'Esc 로 메뉴가 닫히지 않았다');
        assert.strictEqual(B.doc.activeElement, more(B, 'b'), 'Esc 뒤 포커스가 ⋯ 로 돌아오지 않았다');
        assert.ok(!$(B, '#officialModal').classList.contains('hidden') && B.ev("isOverlayOpen(document.getElementById('adminHub'))"), 'Esc 가 메뉴가 아니라 창을 닫았다');
      });
    },
    //  R8 상태 체크박스: 상태표에서 만들고(상태 없음은 그런 과제가 있을 때만), 이 PC 에 기억, 재연결 고르기와 한 벌, Excel 부제와 행
    async statusChecks(src) {
      await withB(src, ADMIN_URL, async (B) => {
        B.w.localStorage.removeItem('tc_projStatusOff');
        B.ev('offStOff = null; 1');
        await openHub(B);
        const boxes = () => $$(B, '#offStChecks [data-offst]').map((i) => [i.dataset.offst, i.closest('label').textContent.trim(), i.checked]);
        assert.deepStrictEqual(boxes(), [['1', '진행중', true], ['2', '종료', true], ['3', '1차 납품완료', true], ['__none__', '상태 없음', true]],
          '상태 체크박스가 상태표 순서 + 상태 없음(그런 과제가 있음)으로, 모두 켠 채 서지 않았다');
        //  상태를 더하면 체크박스가 따라온다(켜진 채)
        B.w.__applyCodes(JSON.stringify(SECTIONS), JSON.stringify(STATUSES.concat([{ id: 9, name: '보류' }]))); await settle(10);
        assert.deepStrictEqual(boxes().map((x) => x[0]), ['1', '2', '3', '9', '__none__'], '상태를 더했는데 체크박스가 따라오지 않는다');
        assert.strictEqual(boxes()[3][2], true, '새 상태가 꺼진 채 나왔다(기본은 켬)');
        const cb = $(B, '#offStChecks [data-offst="2"]'); cb.click(); await settle(10);
        assert.deepStrictEqual(JSON.parse(B.w.localStorage.getItem('tc_projStatusOff')), ['2'], '끈 상태를 이 PC 에 기억하지 않는다(tc_projStatusOff)');
        assert.ok(!$(B, '#offList .off-row[data-id="db-c"]'), '종료를 껐는데 종료 과제가 보인다');
        assert.ok(/필터 1개/.test($(B, '#offFilterCount').textContent), '상태를 끄면 필터 하나로 세야 한다');
        //  다시 그려도(새로 열어도) 기억대로다
        B.ev('offStOff = null; renderOfficial(); 1');
        assert.strictEqual($(B, '#offStChecks [data-offst="2"]').checked, false, '다시 그리자 끈 상태가 켜졌다(기억을 읽지 않는다)');
        //  Excel: 지금 거른 그대로, 순서대로, 부제에 뺀 상태
        B.ev("__rep.exportProjectsXlsx = { ok: true, path: 'C:/x/a.xlsx', dir: 'C:/x', count: 5 }; 1");
        B.ev('runOfficialXlsxExport()'); await settle(30);
        const ex = calls(B, 'exportProjectsXlsx').pop();
        assert.ok(ex, '전제: 추출 요청이 나가지 않았다');
        assert.deepStrictEqual(ex[1].rows.map((r) => [r.commonName, r.no]), [['zz가', 1], ['zz나', 2], ['zz라', 4], ['zz마', 5], ['zz바', 1]], 'Excel 행이 거른 그대로, 화면 순서와 No 로 가지 않는다');
        assert.ok(/뺀 상태=종료/.test(ex[1].subtitle) && !/종료 제외/.test(ex[1].subtitle), 'Excel 부제에 뺀 상태가 없다: ' + ex[1].subtitle);
        //  재연결 고르기도 같은 기억이다
        B.ev('rlpFillSelects(); 1');
        assert.strictEqual($(B, '#rlpStChecks [data-offst="2"]').checked, false, '재연결 고르기의 체크박스가 같은 기억을 쓰지 않는다');
        //  초기화 = 모두 켬(기억도)
        $(B, '#offReset').click(); await settle(10);
        assert.deepStrictEqual(JSON.parse(B.w.localStorage.getItem('tc_projStatusOff')), [], '초기화가 기억을 비우지 않는다');
        assert.ok($(B, '#offList .off-row[data-id="db-c"]'), '초기화했는데 종료 과제가 안 보인다');
      });
      //  상태 없는 과제가 없으면 '상태 없음' 체크박스도 없다
      await withB(src, ADMIN_URL, async (B) => {
        B.ev(`dbCatalog = dbCatalog.filter(function(c){ return c.statusId != null; }); 1`);
        await openHub(B);
        assert.ok(!$(B, '#offStChecks [data-offst="__none__"]'), "상태 없는 과제가 없는데 '상태 없음' 체크박스가 섰다");
      });
    },
  };
  test('순서(R)①: No 칸은 구분 안 순서(1부터), 상태를 꺼서 줄이 빠져도 전체 기준', () => dom.noColumn(app));
  test('순서(R)②: 손잡이와 ⋯ 는 관리 화면(도킹)에만, 단독 찾아보기는 No 만', () => dom.dockOnly(app));
  test('순서(R)③: 필터를 쓰면 끌기만 꺼지고(이유 title) ⋯ 는 전체 목록 기준으로 된다', () => dom.dragOffUnderFilter(app));
  test('순서(R)④: ⋯ 의 맨 위로, 한 칸 위로, 한 칸 아래로, 맨 아래로, N번째가 그 구분 전체 uid 순서를 한 번에 보낸다', () => dom.menuMoves(app));
  test('순서(R)⑤: stale 회신이면 되돌리고 알리고 목록을 새로 받는다', () => dom.staleReload(app));
  test('순서(R)⑥: 끌어 놓기(포인터)도 같은 저장 길, 다른 구분 줄에는 놓이지 않는다', () => dom.dragDrop(app));
  test('순서(R)⑦: ⋯ 메뉴는 화살표로 다니고 Esc 는 메뉴만 닫고 ⋯ 로 돌아온다', () => dom.escKeepsModal(app));
  test('상태(R)⑧: 체크박스는 상태표에서 만들고 이 PC 에 기억, 재연결 고르기와 한 벌, Excel 부제에 뺀 상태', () => dom.statusChecks(app));

  test('변이(R)①: No 를 보이는 줄 기준으로 매기면 (R)① 이 잡는다', () => assert.rejects(() => dom.noColumn(
    mutate(app, 'rows.map(c => offRowHtml(c, no.get(c.id), ord))', 'rows.map((c, i) => offRowHtml(c, i + 1, ord))')), /다시 매겨졌다/));
  test('변이(R)②: 단독 찾아보기에도 순서 옮기기를 세우면 (R)② 가 잡는다', () => assert.rejects(() => dom.dockOnly(
    mutate(app, "  return !!(HOST && m && m.classList.contains('docked'));", '  return !!HOST;')), /단독 찾아보기/));
  test('변이(R)③: 필터 중에도 끌기를 켜 두면 (R)③ 이 잡는다', () => assert.rejects(() => dom.dragOffUnderFilter(
    mutate(app, 'const ord = canOrd ? { drag: nf === 0 } : null;', 'const ord = canOrd ? { drag: true } : null;')), /손잡이가 켜져 있다/));
  test('변이(R)④: 옮긴 과제를 늘 맨 뒤에 넣으면 (R)④ 가 잡는다', () => assert.rejects(() => dom.menuMoves(
    mutate(app, '  const next = rows.slice(); next.splice(from, 1); next.splice(t, 0, c);', '  const next = rows.slice(); next.splice(from, 1); next.push(c);')), /맨 위로/));
  test('변이(R)⑤: stale 뒤 새로 받기를 빼면 (R)⑤ 가 잡는다', () => assert.rejects(() => dom.staleReload(
    mutate(app, "  else toast((res && (res.error || res.msg)) || '순서를 저장하지 못했습니다. 목록을 새로 불러옵니다', 'error');\n  offOrderReload();",
                "  else toast((res && (res.error || res.msg)) || '순서를 저장하지 못했습니다. 목록을 새로 불러옵니다', 'error');")), /loadProjects/));
  test('변이(R)⑦: Esc 뒤 포커스를 ⋯ 로 돌리지 않으면 (R)⑦ 이 잡는다', () => assert.rejects(() => dom.escKeepsModal(
    mutate(app, "          if(ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); offOrdMenuClose(true); return; }",
                "          if(ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); offOrdMenuClose(false); return; }")), /포커스가/));
  test('변이(R)⑧: 기억 쓰기를 빼면 (R)⑧ 이 잡는다', () => assert.rejects(() => dom.statusChecks(
    mutate(app, "function offStSave(){ try{ localStorage.setItem(OFF_ST_KEY, JSON.stringify([...offStOffSet()])); }catch(_){} }", 'function offStSave(){}')), /기억하지 않는다/));
}
