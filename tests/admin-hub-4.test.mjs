// 「⚙ 관리」 4차 — docs/ADMIN-HUB-4.md N4·N5 · 수용 R3·R4(배지·숨김 이유 N1·N2 는 org-title-web.test.mjs · ▲▼ N3 은 category-order.test.mjs).
//
// 지키는 것:
//   (S) 정적 — 왼쪽 항목 9개(사람 4 · 회사 과제 5) · 직급/소속 · 구분/상태 항목이 같은 모달을 그 탭으로 연다 · 도킹 중 모달 안 탭 전환을
//       숨기는 CSS(단독 창은 그대로) · 옛 항목 id 별칭(orgtitle → title · codes → section) · 개수는 이미 받은 데이터만.
//   (R) jsdom — 직급/소속/구분/상태 항목 = 그 탭으로 도킹 · 머리 제목 = 그 항목 하나의 이름 · 도킹 중 탭 전환 숨김 · 위치 줄 ·
//       관리 화면을 닫으면 제목·탭 전환이 단독 모달 그대로 돌아온다 · 옛 기억값(codes)과 openAdminHub('orgtitle') 별칭.
//   (S·후속) 발주처 · 구분 · 상태도 편집 화면은 쓰는 항목과 [숨김]뿐(「숨긴 값도 표시」·제자리 [복구] 없음 — 복구는 회사 과제 휴지통) ·
//       숨기면 직급·소속과 같은 토스트 · 아랫줄 안내는 지금 칸의 문장만(직급 · 소속 · 구분 · 상태).
//   (M) 변이 — 도킹 탭 숨김 CSS 빼기 · 별칭 빼기 · 머리 제목 되돌림 빼기 · 숨긴 값 다시 그리기 · 안내 칸 고르기 빼기 — 각각 잡힌다.
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 **등록되지 않고** skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

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
const statics = {
  groups(src) {
    assert.ok(src.includes("{ id: 'people', ic: '👥', t: '사람',      items: ['members', 'title', 'unit', 'gone'] },"), '👥 사람 = 구성원 · 직급 · 소속 · 휴지통이 아니다(N4)');
    assert.ok(src.includes("{ id: 'proj',   ic: '📁', t: '회사 과제', items: ['projects', 'cust', 'section', 'status', 'trash'] },"), '📁 회사 과제 = 공식 과제 · 발주처 · 구분 · 상태 · 휴지통이 아니다(N4)');
    assert.ok(/title:\s+\{ ic: '🏷', t: '직급',\s+ov: 'orgTitleModal',\s+open: \(\) => openOrgTitle\('title'\), tab: 'title' \},/.test(src), '「직급」 항목이 직급·소속 화면을 직급 탭으로 열지 않는다(N4)');
    assert.ok(/unit:\s+\{ ic: '🏢', t: '소속',\s+ov: 'orgTitleModal',\s+open: \(\) => openOrgTitle\('unit'\),\s+tab: 'unit' \},/.test(src), '「소속」 항목이 직급·소속 화면을 소속 탭으로 열지 않는다(N4)');
    assert.ok(/section:\s+\{[^}]*ov: 'codeModal',\s+open: \(\) => ahPress\('offCodeMgr'\), tab: 'section' \},/.test(src), '「구분」 항목이 지금 문(#offCodeMgr · 구분 탭)을 지나지 않는다(N4)');
    assert.ok(/status:\s+\{[^}]*ov: 'codeModal',\s+open: \(\) => offEditGuard\(\(\) => openCodeModal\('status'\)\), tab: 'status' \},/.test(src), '「상태」 항목이 같은 관문(offEditGuard)을 지나 상태 탭으로 열지 않는다(N4)');
    assert.ok(!/^\s*(orgtitle|codes):\s*\{/m.test(src), '옛 합친 항목(orgtitle · codes)이 남았다(N4)');
    const io = extractFunction(src, 'ahItemOfOv');
    assert.ok(/if\(id === 'orgTitleModal'\) return \(__otTab === 'unit'\) \? 'unit' : 'title';/.test(io) && /if\(id === 'codeModal'\) return \(codeKind === 'status'\) \? 'status' : 'section';/.test(io),
      '도킹된 창 → 항목 판정이 열린 탭을 보지 않는다 — 위치 줄·왼쪽 목록이 화면과 갈린다(N4)');
  },
  dockCss(src) {
    const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(css.includes('#adminHub .ah-slot > #orgTitleModal.docked .code-tabs,#adminHub .ah-slot > #codeModal.docked .code-tabs{display:none}'),
      '도킹 중 모달 안 [직급 | 소속] · [구분 | 상태] 전환을 숨기지 않는다(N4)');
    assert.ok(/<div class="code-tabs" role="tablist">\s*<button type="button" class="code-tab on" id="otTabTitle"/.test(src) && /<div class="code-tabs" role="tablist">\s*<button type="button" class="code-tab on" id="codeTabSection"/.test(src),
      '단독 모달의 탭 전환 마크업이 사라졌다 — 관리 밖에서 연 창은 지금처럼 전환을 보인다(N4)');
  },
  alias(src) {
    assert.ok(src.includes("const AH_ALIAS = { orgtitle: 'title', codes: 'section' };"), '옛 항목 id 별칭 표가 없다(N5)');
    assert.ok(/return ahHasItem\(v\) \? ahItemId\(v\) : 'members';/.test(extractFunction(src, 'ahLast')), '마지막 항목 기억의 옛 값을 별칭으로 읽지 않는다(N5)');
    assert.ok(/v = ahItemId\(v\);/.test(extractFunction(src, 'ahLastIn')), '묶음별 기억의 옛 값을 별칭으로 읽지 않는다(N5)');
    assert.ok(/ahHasItem\(item\) \? ahItemId\(item\) : ahLast\(\)/.test(extractFunction(src, 'openAdminHub')), "openAdminHub('orgtitle'|'codes') 를 받지 않는다(N5)");
    assert.ok(/item = ahHasItem\(item\) \? ahItemId\(item\) : 'members';/.test(extractFunction(src, 'ahSelect')), 'ahSelect 가 옛 id 를 받지 않는다(N5)');
  },
  counts(src) {
    const c = extractFunction(src, 'ahCount');
    for (const k of ['title', 'unit', 'section', 'status']) assert.ok(new RegExp("case '" + k + "':").test(c), `${k} 항목의 개수 규칙이 없다(N4)`);
    assert.ok(!/hostRequest|hpost/.test(c), '개수를 얻으려고 조회를 보낸다(H2 · N4 — 이미 받은 데이터만)');
  },
};
test('(S) N4: 왼쪽 항목 9개(사람 4 · 회사 과제 5) · 직급/소속 · 구분/상태 = 같은 모달을 그 탭으로 · 도킹 창 → 항목은 열린 탭', () => statics.groups(app));
test('(S) N4: 도킹 중 모달 안 탭 전환을 숨기는 CSS · 단독 모달 마크업은 그대로', () => statics.dockCss(app));
test('(S) N5: 옛 항목 id 별칭(orgtitle → title · codes → section) — 기억 · openAdminHub · ahSelect', () => statics.alias(app));
test('(S) N4: 직급 · 소속 · 구분 · 상태 개수 규칙 — 이미 받은 데이터만(조회 없음)', () => statics.counts(app));
//  ADMIN-HUB-4 후속(2026-10-06 PM) — 편집 화면은 숨김만(발주처 · 구분 · 상태도) · 같은 토스트 · 칸별 아랫줄 안내
const follow = {
  hideOnly(src) {
    const code = src.replace(/<!--[\s\S]*?-->/g, '');
    for (const id of ['custShowHidden', 'codeShowHidden']) assert.ok(!code.includes('id="' + id + '"') && !new RegExp('\\b' + id + '\\b').test(code.replace(/\/\/[^\n]*/g, '')), `「숨긴 값도 표시」(${id})가 남았다 — 편집 화면은 쓰는 항목과 [숨김]뿐이다(복구는 🗑 휴지통)`);
    for (const a of ['data-custshow', 'data-codeshow', 'function custDoShow', 'function codeDoShow']) assert.ok(!code.includes(a), `제자리 [복구](${a})가 남았다 — 복구는 회사 과제 휴지통이다`);
    assert.ok(/const rows = custList\.filter\(c => c\.active\);/.test(extractFunction(src, 'renderCustomerList')), '발주처 목록이 숨긴 발주처까지 그린다');
    assert.ok(/const rows = codeList\.filter\(c => c\.active\);/.test(extractFunction(src, 'renderCodeList')), '구분·상태 목록이 숨긴 값까지 그린다');
    //  ★ 2026-10-15 — 숨김은 번호(customerId · id)로 보낸다(CODE-TABLE-IDS §4).
    assert.ok(/custSend\('setCustomerActive', \{ customerId, active: false \}, '발주처를 숨겼습니다', null, OT_HIDDEN_MSG\)/.test(extractFunction(src, 'custDoHide')), '발주처 숨김 토스트가 「휴지통으로 옮겼습니다 · 복구는 🗑 휴지통에서」가 아니다');
    assert.ok(/codeSend\('codeSetActive', \{ id, active: false \}, codeKindLabel\(\) \+ '을\(를\) 숨겼습니다', null, OT_HIDDEN_MSG\)/.test(extractFunction(src, 'codeDoHide')), '구분·상태 숨김 토스트가 「휴지통으로 옮겼습니다 · 복구는 🗑 휴지통에서」가 아니다');
    for (const fn of ['custSend', 'codeSend']) assert.ok(/toast\(forceToast \|\| res\.msg \|\| okToast, 'success'\)/.test(extractFunction(src, fn)), `${fn} 가 화면이 정한 토스트를 쓰지 않는다`);
  },
  notes(src) {
    const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(css.includes('#orgTitleModal[data-note-tab="title"] [data-note="unit"],#orgTitleModal[data-note-tab="unit"] [data-note="title"],\n#codeModal[data-note-tab="section"] [data-note="status"],#codeModal[data-note-tab="status"] [data-note="section"]{display:none}'),
      '아랫줄 안내를 지금 칸의 문장만 남기는 규칙이 없다');
    for (const k of ['title', 'unit', 'section', 'status']) assert.ok(new RegExp('<span data-note="' + k + '">[^<]*').test(src), `${k} 칸의 아랫줄 문장이 없다`);
    assert.ok(/ov\.dataset\.noteTab = __otTab;/.test(extractFunction(src, 'otRender')), '직급·소속 화면이 지금 칸을 아랫줄 안내에 알리지 않는다');
    assert.ok(/ov\.dataset\.noteTab = codeKind;/.test(extractFunction(src, 'codeSyncTabs')), '구분·상태 화면이 지금 칸을 아랫줄 안내에 알리지 않는다');
    assert.ok(/숨긴 발주처는 새 과제의 발주처 선택과 이 목록에서 빠지지만, 기존 과제 표기는 유지됩니다\(복구는 🗑 휴지통\)/.test(src), '발주처 아랫줄 안내가 복구 자리(🗑 휴지통)를 말하지 않는다');
  },
};
test('(S) 후속: 발주처 · 구분 · 상태 = 쓰는 항목과 [숨김]뿐 · 「숨긴 값도 표시」·제자리 [복구] 없음 · 숨김 토스트 = 직급·소속과 같은 말', () => follow.hideOnly(app));
test('(S) 후속: 아랫줄 안내 = 지금 칸의 문장만(직급 · 소속 · 구분 · 상태) · 발주처 안내가 복구 자리를 말한다', () => follow.notes(app));
test('변이(S)③: 구분·상태 목록이 숨긴 값을 다시 그리면 (S) 후속이 실패한다', () => {
  assert.throws(() => follow.hideOnly(mutate(app, '  const rows = codeList.filter(c => c.active);', '  const rows = codeList.filter(c => c);')), /숨긴 값까지 그린다/);
});
test('변이(S)④: 칸별 안내 고르기를 빼면 (S) 후속 안내가 실패한다', () => {
  assert.throws(() => follow.notes(mutate(app, "  const ov = document.getElementById('codeModal'); if(ov) ov.dataset.noteTab = codeKind;", '')), /구분·상태 화면이 지금 칸을/);
});
test('변이(S)①: 도킹 탭 숨김 CSS 를 빼면 (S) N4 CSS 가 실패한다', () => {
  assert.throws(() => statics.dockCss(mutate(app, '#adminHub .ah-slot > #orgTitleModal.docked .code-tabs,#adminHub .ah-slot > #codeModal.docked .code-tabs{display:none}', '')), /전환을 숨기지 않는다/);
});
test('변이(S)②: 별칭 표를 비우면 (S) N5 가 실패한다', () => {
  assert.throws(() => statics.alias(mutate(app, "const AH_ALIAS = { orgtitle: 'title', codes: 'section' };", 'const AH_ALIAS = {};')), /별칭 표가 없다/);
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom — 실제 앱을 위젯 모드로(admin-hub-3.test.mjs 와 같은 부팅)
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('admin-hub-4: jsdom 미설치 — 관리 4차 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const ME = { loginId: 'phmin', name: '박현민', title: '수석연구원', orgUnit: 'SW 3팀' };
  const EMPTY = { categories: [], entries: [], todos: [], rooms: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '' };
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const FADE = 200;
  const ORG = { found: true, admin: true,
    titles: [{ titleId: 1, name: '수석', sort: 10, active: true, users: 1 }, { titleId: 2, name: '선임', sort: 20, active: true, users: 0 }, { titleId: 3, name: '책임', sort: 30, active: true, users: 0 }],
    units: [{ orgId: 1, name: '회사', parentId: null, depth: 0, sort: 10, active: true, users: 0, children: 1 },
            { orgId: 2, name: 'SW 1팀', parentId: 1, depth: 1, sort: 20, active: true, users: 1, children: 0 }] };
  const CODES = (kind) => ({ ok: true, list: JSON.stringify(kind === 'status'
    ? [{ id: 1, name: 'zz진행중', active: true, sort: 1 }, { id: 2, name: 'zz종료', active: true, sort: 2 }, { id: 3, name: 'zz보류', active: true, sort: 3 }]
    : [{ id: 1, name: 'zz일반계약', active: true, sort: 1 }, { id: 4, name: 'zz연구과제', active: true, sort: 2 }]) });
  function boot(src) {
    const posted = [], errors = [];
    const vc = new jsdomMod.VirtualConsole();
    vc.on('jsdomError', (e) => errors.push(String(e && (e.stack || e.message) || e)));
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: vc,
      beforeParse(win) {
        win.chrome = { webview: { postMessage: (s) => posted.push(String(s)), addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
      },
    });
    const w = dom.window;
    const B = { w, errors, doc: w.document, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')), close: () => { try { w.close(); } catch (_) {} } };
    w.__CODES = CODES;
    w.eval(`window.__calls = [];
      hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
        if(cmd === 'orgTitleGet') return Promise.resolve({ ok: true, data: ${JSON.stringify(ORG)} });
        if(cmd === 'getCodesFull') return Promise.resolve(window.__CODES(p && p.kind));
        if(cmd === 'userInfoGet') return Promise.resolve(window.__INFO || { ok:false, msg:'시험: 회신 없음' });   // 관리자 확인(관문 · 2026-10-06)
        if(cmd === 'membersGet') return Promise.resolve({ ok: true, data: { found: true, admin: true, includeInactive: false, units: [], titles: [], members: [] } });
        return Promise.resolve({ ok:false, msg:'시험: 회신 없음' }); };`);
    const sess = posted.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).find((m) => m && m.cmd === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: ME }) + ')');
    w.eval('currentUser = ' + JSON.stringify(ME));
    w.__applyState(JSON.stringify(EMPTY), {});
    w.eval('dbOnline = true; offSections = [{id:1,name:"zz일반계약"},{id:4,name:"zz연구과제"}]; offStatuses = [{id:1,name:"zz진행중"},{id:2,name:"zz종료"},{id:3,name:"zz보류"}];');
    w.eval('window.__toasts = []; (function(){ var t = toast; toast = function(m, k, a, ms){ __toasts.push(String(m)); return t(m, k, a, ms); }; })();');
    w.eval('ahNoteRole(true)');
    return B;
  }
  const $ = (B, s) => B.doc.querySelector(s);
  const isOpen = (B, id) => B.ev(`isOverlayOpen(document.getElementById(${JSON.stringify(id)}))`);
  const navOn = (B) => B.ev("(function(){ var b = document.querySelector('#ahNav [data-ahitem].on'); return b ? b.dataset.ahitem : ''; })()");
  const docked = (B) => B.ev("(function(){ var d = document.querySelector('#ahSlot > .overlay.docked'); return d ? d.id : ''; })()");
  const where = (B) => $(B, '#ahWhere').textContent.replace(/\s+/g, ' ').trim();
  const shown = (B, sel) => { const e = $(B, sel); return !!e && B.w.getComputedStyle(e).display !== 'none'; };
  const pick = async (B, item) => { B.ev(`(function(){ var b = document.querySelector('#ahNav [data-ahitem="${item}"]'); if(b.closest('.ah-navgrp').classList.contains('hidden')) document.getElementById(b.closest('[data-ahnavgrp]').dataset.ahnavgrp === 'proj' ? 'ahGrpProj' : 'ahGrpPeople').click(); b.click(); return 1; })()`); await settle(80); };
  const closeHub = async (B) => { B.ev("closeOverlay(document.getElementById('adminHub'))"); await settle(FADE); };

  const dom = {
    //  직급 · 소속 — 같은 #orgTitleModal 을 그 탭으로 · 머리 「직급」/「소속」 · 탭 전환 숨김 · 닫으면 단독 그대로
    async orgItems(src) {
      const B = boot(src);
      try {
        B.ev(`openAdminHub('title')`); await settle(120);
        assert.strictEqual(navOn(B), 'title'); assert.strictEqual(docked(B), 'orgTitleModal');
        assert.strictEqual(B.ev('__otTab'), 'title', '「직급」 항목이 직급 탭으로 열리지 않았다(N4)');
        assert.strictEqual($(B, '#orgTitleModal .modal-head h2').textContent, '직급', '도킹 중 머리 제목이 「직급」이 아니다(N4)');
        assert.strictEqual(shown(B, '#orgTitleModal .code-tabs'), false, '도킹 중 [직급 | 소속] 전환이 보인다(N4)');
        assert.strictEqual(where(B), '👥 사람 ›🏷 직급');
        assert.ok(shown(B, '#orgTitleModal [data-note="title"]') && !shown(B, '#orgTitleModal [data-note="unit"]'), '직급 칸의 아랫줄에 직급 문장만 서야 한다(후속)');
        assert.deepStrictEqual([...B.doc.querySelectorAll('#otList .cust-row')].map((r) => r.dataset.otkey), ['1', '2', '3']);
        assert.strictEqual($(B, '#ahNtitle').textContent, '3'); assert.strictEqual($(B, '#ahNunit').textContent, '2', '소속 개수(같은 회신)가 없다(N4)');
        await pick(B, 'unit');
        assert.strictEqual(navOn(B), 'unit'); assert.strictEqual(docked(B), 'orgTitleModal');
        assert.strictEqual(B.ev('__otTab'), 'unit', '「소속」 항목이 소속 탭으로 열리지 않았다(N4)');
        assert.strictEqual($(B, '#orgTitleModal .modal-head h2').textContent, '소속');
        assert.strictEqual(where(B), '👥 사람 ›🏢 소속');
        assert.ok(shown(B, '#orgTitleModal [data-note="unit"]') && !shown(B, '#orgTitleModal [data-note="title"]'), '소속 칸의 아랫줄에 소속 문장만 서야 한다(후속)');
        assert.deepStrictEqual([...B.doc.querySelectorAll('#otList .cust-row')].map((r) => r.dataset.otkey), ['1', '2']);
        await closeHub(B);
        B.ev('openOrgTitle()'); await settle(120);
        assert.ok(!$(B, '#orgTitleModal').classList.contains('docked') && isOpen(B, 'orgTitleModal'), '전제: 단독으로 열리지 않았다');
        assert.strictEqual($(B, '#orgTitleModal .modal-head h2').textContent, '직급·소속 관리', '단독 모달의 제목이 원래대로 돌아오지 않았다(N4)');
        assert.strictEqual(shown(B, '#orgTitleModal .code-tabs'), true, '단독 모달의 탭 전환이 사라졌다(N4 — 관리 밖은 그대로)');
        assert.deepStrictEqual(B.errors, [], '페이지 오류');
      } finally { B.close(); }
    },
    //  구분 · 상태 — 같은 #codeModal 을 그 탭으로 · 머리 「구분」/「상태」 · 탭 전환 숨김 · 조회 인자 kind
    async codeItems(src) {
      const B = boot(src);
      try {
        B.ev(`openAdminHub('section')`); await settle(120);
        assert.strictEqual(navOn(B), 'section'); assert.strictEqual(docked(B), 'codeModal');
        assert.strictEqual(B.ev('codeKind'), 'section');
        assert.strictEqual($(B, '#codeModal .modal-head h2').textContent, '구분', '도킹 중 머리 제목이 「구분」이 아니다(N4)');
        assert.strictEqual(shown(B, '#codeModal .code-tabs'), false, '도킹 중 [구분 | 상태] 전환이 보인다(N4)');
        assert.strictEqual($(B, '#ahNsection').textContent, '2'); assert.strictEqual($(B, '#ahNstatus').textContent, '3');
        assert.ok(shown(B, '#codeModal [data-note="section"]') && !shown(B, '#codeModal [data-note="status"]'), '구분 칸의 아랫줄에 구분 문장만 서야 한다(후속)');
        assert.ok(!$(B, '#codeShowHidden') && !/zz숨김/.test($(B, '#codeList').textContent), '구분 목록에 숨긴 값·「숨긴 값도 표시」가 섰다(후속)');
        await pick(B, 'status');
        assert.strictEqual(navOn(B), 'status'); assert.strictEqual(docked(B), 'codeModal');
        assert.strictEqual(B.ev('codeKind'), 'status', '「상태」 항목이 상태 탭으로 열리지 않았다(N4)');
        assert.strictEqual($(B, '#codeModal .modal-head h2').textContent, '상태');
        assert.strictEqual(where(B), '📁 회사 과제 ›🔖 상태');
        assert.ok(shown(B, '#codeModal [data-note="status"]') && !shown(B, '#codeModal [data-note="section"]'), '상태 칸의 아랫줄에 상태 문장만 서야 한다(후속)');
        const kinds = B.evJSON('__calls').filter((c) => c[0] === 'getCodesFull').map((c) => c[1].kind);
        assert.deepStrictEqual(kinds, ['section', 'status'], `조회가 그 탭으로 나가지 않았다: ${JSON.stringify(kinds)}`);
        assert.ok(/zz보류/.test($(B, '#codeList').textContent), '상태 목록이 그려지지 않았다');
        await closeHub(B);
        B.ev("openCodeModal('section')"); await settle(120);
        assert.strictEqual($(B, '#codeModal .modal-head h2').textContent, '구분·상태 관리', '단독 모달의 제목이 원래대로 돌아오지 않았다');
        assert.strictEqual(shown(B, '#codeModal .code-tabs'), true, '단독 모달의 탭 전환이 사라졌다');
        assert.deepStrictEqual(B.errors, [], '페이지 오류');
      } finally { B.close(); }
    },
    //  N5 — 옛 기억값(codes)·옛 id(orgtitle)
    async aliases(src) {
      const B = boot(src);
      try {
        B.w.localStorage.setItem('tc_adminLast:phmin', 'codes');
        B.w.localStorage.setItem('tc_adminLast:phmin:people', 'orgtitle');
        B.ev('openAdminHub(null)'); await settle(120);
        assert.strictEqual(navOn(B), 'section', '옛 기억값 codes 가 「구분」으로 열리지 않았다(N5)');
        $(B, '#ahGrpPeople').click(); await settle(120);
        assert.strictEqual(navOn(B), 'title', '묶음별 옛 기억값 orgtitle 이 「직급」으로 열리지 않았다(N5)');
        await closeHub(B);
        B.ev("openAdminHub('orgtitle')"); await settle(120);
        assert.strictEqual(navOn(B), 'title', "openAdminHub('orgtitle') 가 「직급」이 아니다(N5)");
        B.ev("ahSelect('codes')"); await settle(120);
        assert.strictEqual(navOn(B), 'section', "ahSelect('codes') 가 「구분」이 아니다(N5)");
        assert.strictEqual(B.w.localStorage.getItem('tc_adminLast:phmin'), 'section', '기억이 새 id 로 다시 적히지 않았다');
      } finally { B.close(); }
    },
  };
  test('(R3) 직급 · 소속 항목 = 같은 화면을 그 탭으로 도킹 · 머리 제목 · 탭 전환 숨김 · 위치 줄 · 개수 · 닫으면 단독 그대로', () => dom.orgItems(app));
  test('(R3) 구분 · 상태 항목 = 같은 화면을 그 탭으로 도킹 · 머리 제목 · 탭 전환 숨김 · 조회 kind · 닫으면 단독 그대로', () => dom.codeItems(app));
  test('(R4) 옛 항목 id·기억값 별칭 — codes → 구분 · orgtitle → 직급 · ahSelect 도', () => dom.aliases(app));

  test('변이(R)①: 도킹 중 머리 제목을 그 항목 이름으로 바꾸지 않으면 (R3) 이 실패한다', async () => {
    const bad = mutate(app, "  h.textContent = (it && it.tab) ? it.t : ov.__ahHead;", "  h.textContent = ov.__ahHead;");
    await assert.rejects(() => dom.orgItems(bad), /머리 제목이 「직급」이 아니다/);
  });
  test('변이(R)②: 닫을 때 제목을 되돌리지 않으면 (R3) 의 단독 모달 계약이 실패한다', async () => {
    const bad = mutate(app, "  { const h = ov.querySelector('.modal-head h2'); if(h && ov.__ahHead != null){ h.textContent = ov.__ahHead; ov.__ahHead = null; } }", '');
    await assert.rejects(() => dom.orgItems(bad), /원래대로 돌아오지 않았다/);
  });
  //  ── 관문(2026-10-06 사용자 지적) — 관리자가 아니면 관리 화면의 틀조차 열리지 않는다 · 토스트 한 줄 ──
  const INFO = (role) => ({ ok: true, info: { name: ME.name, title: ME.title, org_unit: ME.orgUnit, view_scope: 'all', edit_role: role, is_active: 1 } });
  const hubShown = (B) => B.ev("(function(){ var h = document.getElementById('adminHub'); return !!h && !h.classList.contains('hidden'); })()");
  const denyCount = (B) => B.evJSON('__toasts').filter((m) => m === '관리자만 사용할 수 있습니다').length;
  const guard = {
    //  역할을 정해 두고(known: 'viewer'|'editor'|null=모름) 확인 회신(probe)을 정한 뒤, 입구 여러 개로 열어 본다.
    async denied(src, known, probe) {
      const B = boot(src);
      try {
        await settle(60);
        B.ev("__toasts.length = 0; __calls.length = 0; __ahRole = { login: '', admin: null };" + (known ? ' ahNoteRole(false);' : '') + (probe ? ` window.__INFO = ${JSON.stringify(probe)};` : ' window.__INFO = null;'));
        B.ev("openAdminHub('members')"); await settle(120);
        assert.strictEqual(hubShown(B), false, `관리자가 아닌데(${known || '모름'} · 확인 ${probe ? probe.info.edit_role : '실패'}) 관리 화면의 틀이 열렸다`);
        assert.strictEqual(denyCount(B), 1, `거절 토스트가 한 번이 아니다: ${JSON.stringify(B.evJSON('__toasts'))}`);
        assert.strictEqual(B.evJSON('__calls').filter((c) => c[0] === 'membersGet').length, 0, '열지 않았는데 구성원 조회가 나갔다');
        if (!known) assert.strictEqual(B.evJSON('__calls').filter((c) => c[0] === 'userInfoGet').length, 1, '모를 때 기존 확인(userInfoGet)을 한 번 묻지 않았다');
        //  다른 입구도 같은 관문을 지난다 — 옛 id 별칭 · ⋯ · 내 과제 링크 · 도킹 길(H9)
        B.ev("__toasts.length = 0; ahNoteRole(false)");
        B.ev("openAdminHub('orgtitle')"); await settle(60);
        B.ev("ahOpenFromMore()"); await settle(60);
        B.ev("(function(){ var b = document.getElementById('btnCatAdmin'); if(b) b.click(); return 1; })()"); await settle(60);
        B.ev("openAdminHub(null, { dock: document.getElementById('customerModal') })"); await settle(60);
        B.ev("ahSelect('members')"); await settle(60);
        assert.strictEqual(hubShown(B), false, '다른 입구(별칭 · ⋯ · 내 과제 · 도킹 · ahSelect)로 관리 화면이 열렸다');
        assert.strictEqual(denyCount(B), 4, `입구마다 토스트 한 줄이 아니다: ${JSON.stringify(B.evJSON('__toasts'))}`);
        assert.deepStrictEqual(B.errors, [], '페이지 오류');
      } finally { B.close(); }
    },
    async allowed(src) {
      const B = boot(src);
      try {
        await settle(60);
        B.ev(`__toasts.length = 0; __ahRole = { login: '', admin: null }; window.__INFO = ${JSON.stringify(INFO('admin'))};`);
        B.ev("openAdminHub('members')"); await settle(150);
        assert.strictEqual(hubShown(B), true, '모를 때 확인 회신이 관리자인데 관리 화면이 열리지 않았다');
        assert.strictEqual(navOn(B), 'members');
        assert.strictEqual(denyCount(B), 0, '관리자인데 거절 토스트가 떴다');
        //  열린 뒤 권한이 회수되면(다음 확인이 관리자 아님) 틀을 닫는다
        await closeHub(B);
        B.ev(`window.__INFO = ${JSON.stringify(INFO('viewer'))}; openAdminHub('members')`); await settle(150);
        assert.strictEqual(hubShown(B), false, '열 때 다시 확인한 권한이 관리자 아님인데 관리 화면이 남았다');
        assert.strictEqual(denyCount(B), 1);
      } finally { B.close(); }
    },
  };
  test('(관문) 관리자 아님으로 확인된 viewer — 어떤 입구로도 틀이 열리지 않는다 · 입구마다 토스트 한 줄', () => guard.denied(app, 'viewer', null));
  test('(관문) 모름 → 확인 회신 editor — 열리지 않는다 · 토스트 한 줄 · 확인은 한 번', () => guard.denied(app, null, INFO('editor')));
  test('(관문) 모름 → 확인 회신 viewer — 열리지 않는다', () => guard.denied(app, null, INFO('viewer')));
  test('(관문) 모름 → 확인 실패(회신 없음) — 열리지 않는다(모르면 열지 않는다)', () => guard.denied(app, null, null));
  test('(관문) 모름 → 확인 회신 admin — 열린다 · 열 때 다시 확인해 회수됐으면 틀을 닫는다', () => guard.allowed(app));
  test('변이(관문)①: 관리자 아님 갈래를 빼면 (관문) viewer 가 실패한다', async () => {
    const bad = mutate(app, "    if(role === false){ toast(AH_DENY_MSG, 'warn'); return; }\n", '');
    await assert.rejects(() => guard.denied(bad, 'viewer', null), /틀이 열렸다/);
  });
  test('변이(관문)②: 모름 갈래(확인 뒤 열기)를 빼면 (관문) 모름 → editor 가 실패한다', async () => {
    const bad = mutate(app, "    if(role === null){\n      ahProbe().then(ok => { if(ok === true) openAdminHub(item, opt); else toast(AH_DENY_MSG, 'warn'); });\n      return;\n    }\n", '');
    await assert.rejects(() => guard.denied(bad, null, INFO('editor')), /틀이 열렸다|토스트/);
  });

  test('변이(R)③: 도킹 창 → 항목 판정이 열린 탭을 보지 않으면 「소속」 항목이 직급으로 칠해진다', async () => {
    const bad = mutate(app, "  if(id === 'orgTitleModal') return (__otTab === 'unit') ? 'unit' : 'title';", '');
    await assert.rejects(() => dom.orgItems(bad), /Expected|unit|title/);
  });
}
