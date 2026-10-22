// 「⚙ 관리」 3차 — docs/ADMIN-HUB-3.md M1–M5 · 수용 R1–R4(끌어 옮기기 M6–M9 는 category-drag.test.mjs · category-order.test.mjs).
//
// 지키는 것:
//   (S) 정적 — 두 휴지통 항목 이름 「🗑 휴지통」(id gone · trash 그대로) · 도킹 공식 과제에서 내 캘린더 표시를 숨기는 CSS(M1) ·
//       사람 휴지통 탭 표(구성원 · 소속 · 직급 · 소속·직급은 영구 삭제 없음 + 안내) · 소속·직급 조회/복구 = 직급·소속 화면이 쓰던
//       명령 그대로(orgTitleGet · unitSetActive · titleSetActive — 새 명령 없음 · M10) · 직급·소속 화면은 쓰는 항목만(M4) ·
//       사용자에게 보이는 「퇴사자 휴지통」「삭제된 항목」이 없다(M5).
//   (R) jsdom — R1 도킹 공식 과제 = 추가/추가됨/제거 · ✓ · 왼쪽 막대 0(단독 찾아보기엔 그대로) / R2 왼쪽 항목·위치 줄·머리말 /
//       R3 사람 휴지통 탭 셋 · 구성원 탭 기존 동작 · 소속/직급 탭 복구(상위 숨김 → 끔 + 보이는 이유) · 영구 삭제 버튼 없음 + 안내 ·
//       받기 전 '—' · 못 읽으면 사유 / R4 직급·소속 화면에 숨긴 항목 없음 · 숨김 → 토스트 「휴지통으로 옮겼습니다 · 복구는 🗑 휴지통에서」
//       → 사람 휴지통 소속·직급 탭에 나타난다.
//   (M) 변이 — 도킹 CSS 빼기 · 소속·직급에 영구 삭제 되살리기 · 상위 숨김 규칙 빼기 · 숨긴 값 다시 그리기 · 옛 이름 되살리기 — 각각 잡힌다.
//
// ★ 실 DB 왕복(zz 소속 숨김 → 사람 휴지통에서 복구 · 원복)은 tests/loop-org-title.mjs(수동 · 실 위젯)가 본다.
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
const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
const body = (src, fn) => stripJsComments(extractFunction(src, fn));
const constBlock = (src, head) => {
  const a = src.indexOf(head);
  assert.ok(a >= 0, `${head} 를 찾지 못했다`);
  const e = src.indexOf('\n];', a);
  return src.slice(a, e + 3);
};

// ══════════════════════════════════════════════════════════════════════
// (S) 정적 계약
// ══════════════════════════════════════════════════════════════════════
const statics = {
  //  R2 — 두 휴지통 항목 = 「🗑 휴지통」 · id 는 그대로(기억 tc_adminLast · 시험 · 루프가 그 id 로 고른다)
  itemNames(src) {
    assert.match(src, /<button type="button" data-ahitem="gone" tabindex="-1"><span class="ah-ic" aria-hidden="true">🗑<\/span>휴지통<span class="ah-n" id="ahNgone"><\/span><\/button>/,
      '사람 묶음의 휴지통 항목이 「🗑 휴지통」(id gone)이 아니다(M3)');
    assert.match(src, /<button type="button" data-ahitem="trash" tabindex="-1"><span class="ah-ic" aria-hidden="true">🗑<\/span>휴지통<span class="ah-n" id="ahNtrash"><\/span><\/button>/,
      '회사 과제 묶음의 휴지통 항목이 「🗑 휴지통」(id trash)이 아니다(M2)');
    assert.match(src, /^\s*gone:\s*\{ ic: '🗑', t: '휴지통',\s+ov: 'trashModal',\s+open: \(\) => openTrash\('user'\) \},$/m, "AH_ITEMS.gone 이 「🗑 휴지통」 · openTrash('user') 가 아니다(위치 줄·고르기 상자가 이 이름을 쓴다)");
    assert.match(src, /^\s*trash:\s*\{ ic: '🗑', t: '휴지통',\s+ov: 'trashModal',\s+open: \(\) => ahPress\('offTrash'\) \},$/m, 'AH_ITEMS.trash 가 「🗑 휴지통」 · #offTrash 문이 아니다');
  },
  //  M1 — 도킹된 공식 과제(관리 화면)에서만 내 캘린더 표시·동작을 숨긴다. 단독(찾아보기)의 규칙은 그대로 남는다.
  dockedOfficialCss(src) {
    const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(css.includes('#adminHub .ah-slot > .overlay.docked .off-d-sub,#adminHub .ah-slot > .overlay.docked .off-subtick{display:none !important}'),
      '관리 화면(도킹)의 공식 과제에서 「캘린더에 추가 · 추가됨 · 제거」(.off-d-sub)·목록 ✓(.off-subtick)를 숨기지 않는다(M1)');
    assert.ok(css.includes('#adminHub .ah-slot > .overlay.docked .off-row.subbed{box-shadow:none}'),
      '관리 화면(도킹)의 공식 과제에서 내 캘린더에 든 줄의 왼쪽 accent 막대를 걷지 않는다(M1)');
    assert.ok(/\n\.off-row\.subbed\{box-shadow:inset 3px 0 0 var\(--accent\)\}/.test(css), '단독(찾아보기)의 왼쪽 막대 규칙이 사라졌다 — 거기서는 이 표시가 주인공이다(M1)');
    //  노드·배선은 그대로(display 만) — 상세 렌더가 편입 줄을 계속 만든다
    assert.ok(/\+\s+offSubHtml\(c\)/.test(extractFunction(src, 'renderOfficialDetail')), '상세 렌더가 편입 줄을 만들지 않는다 — 단독 찾아보기의 주인공이 사라진다');
  },
  //  M3 — 사람 휴지통 탭 표: 구성원 · 소속 · 직급(소속·직급은 org · 안내 note) · 과제 쪽 넷은 그대로
  trashTabs(src) {
    const blk = constBlock(src, 'const TR_TABS = [');
    const rows = [...blk.matchAll(/\{ kind: '(\w+)',\s+label: '([^']+)',[^\n]*scope: '(\w+)'(, org: true)?/g)].map((m) => [m[1], m[2], m[3], !!m[4]]);
    assert.deepStrictEqual(rows, [['project', '과제', 'project', false], ['user', '구성원', 'user', false], ['customer', '발주처', 'project', false],
      ['section', '구분', 'project', false], ['status', '상태', 'project', false], ['title', '직급', 'user', true], ['unit', '소속', 'user', true]],   // ADMIN-HUB-4 N6 — [구성원 · 직급 · 소속]
      `휴지통 탭 표가 계약과 다르다: ${JSON.stringify(rows)} — 사람 쪽 = 구성원 · 소속 · 직급(M3)`);
    assert.ok(blk.includes("note: '퇴사 처리한 구성원입니다. 복구하면 다시 로그인·명부 대상이 됩니다"), '구성원 탭 안내 한 줄이 계약과 다르다(M3)');
    assert.strictEqual((blk.match(/note: '소속·직급은 지난 기록이 이름을 가리키므로 영구 삭제하지 않습니다/g) || []).length, 2, '소속·직급 탭의 「영구 삭제하지 않습니다」 안내가 둘 다 있지 않다(M3)');
  },
  //  M10 — 새 호스트 명령 없음: 소속·직급 조회 = orgTitleGet · 복구 = unitSetActive / titleSetActive(active:true) — 직급·소속 화면이 쓰던 그대로
  noNewCommands(src) {
    const load = body(src, 'trLoadOrg');
    assert.deepStrictEqual([...load.matchAll(/hostRequest\('(\w+)'/g)].map((m) => m[1]), ['orgTitleGet'], '사람 휴지통의 소속·직급 조회가 직급·소속 화면의 orgTitleGet 이 아니다(M10)');
    const rs = body(src, 'trOrgRestore');
    //  ★ 2026-10-15 — 직급도 번호(titleId)로 보낸다(CODE-TABLE-IDS §4). 명령 이름은 그대로다(새 명령 없음).
    assert.ok(/cmd: 'unitSetActive', orgId: Number\(key\), active: true/.test(rs) && /cmd: 'titleSetActive', titleId: Number\(key\), active: true/.test(rs),
      '소속·직급 복구가 직급·소속 화면이 쓰던 명령(unitSetActive · titleSetActive · active:true)이 아니다(M10)');
    assert.ok(/trSend\(p\)/.test(rs), '소속·직급 복구가 휴지통의 왕복 한 곳(trSend — 잠금·회신 문장)을 지나지 않는다');
    assert.ok(/trSeatOrg\(rep\.orgTitle\)/.test(rs), '복구 회신의 갱신 목록(orgTitle)을 앉히지 않는다 — 복구한 항목이 휴지통에 남는다');
    assert.ok(/otAfterClose\(\)/.test(rs), '복구 뒤 「구성원 편집」 드롭다운 소스를 다시 받지 않는다 — 직급·소속 화면에서 복구하던 때와 결과가 다르다');
    //  웹이 새로 부르는 명령은 0 — 이 기능의 명령 셋 전부가 기존 목록에 있다
    const cs = src.slice(src.indexOf('<script'), src.lastIndexOf('</script>'));
    for (const c of ['orgTitleGet', 'unitSetActive', 'titleSetActive']) assert.ok(new RegExp("otSend\\('" + c + "'|hostRequest\\('" + c + "'").test(cs), `${c} 가 직급·소속 화면의 기존 명령이 아니다`);
  },
  //  M3 — 소속·직급 줄에 영구 삭제를 만들지 않는다(끈 채 두는 것이 아니라 부재) · 상위 숨김이면 복구를 끄고 이유를 보이는 줄로
  orgRowsRules(src) {
    const r = body(src, 'trRender');
    assert.ok(/if\(!def\.org\)\{\s*const db = document\.createElement\('button'\);/.test(r), '소속·직급 줄에도 [영구 삭제]를 만든다(M3 — 영구 삭제 없음)');
    const o = body(src, 'trOrgRows');
    assert.ok(/why: \(p && p\.active === false\) \? '상위 조직을 먼저 복구하세요' : ''/.test(o), '상위가 숨김인 소속의 복구 이유가 직급·소속 화면과 같은 문장이 아니다(M3)');
    assert.ok(/deletable: false/.test(o), '소속·직급 줄이 deletable:false 가 아니다 — 이유 줄(data-trwhy)이 서지 않는다');
    assert.ok(!/\.sort\(/.test(o), '숨긴 소속·직급을 다시 정렬한다 — 순서는 호스트가 준 깊이우선 그대로다');
  },
  //  M4 — 직급·소속 화면: 쓰는 항목만 · 「숨긴 값도 표시」·[복구] 없음 · 숨김 토스트가 어디로 갔는지 말한다
  orgTitleScreen(src) {
    const r = body(src, 'otRender');
    assert.ok(/const rows = \(unit \? otUnits\(\) : otTitles\(\)\)\.filter\(x => x && x\.active !== false\);/.test(r), '직급·소속 화면이 숨긴 항목을 그린다(M4)');
    assert.ok(!/otBtn\('show'/.test(r) && !/'숨김'; nmEl/.test(r), '직급·소속 화면에 [복구]·「숨김」 배지가 남았다(M4 — 복구는 휴지통)');
    assert.ok(!/id="otShowHidden"/.test(stripHtmlComments(src)), '「숨긴 값도 표시」 체크박스가 남았다(M4)');
    assert.ok(src.includes("const OT_HIDDEN_MSG = '휴지통으로 옮겼습니다. 복구는 🗑 휴지통에서 할 수 있습니다';"), '숨김 토스트 문구가 계약과 다르다(M4)');
    const h = body(src, 'otDoHide');
    assert.strictEqual((h.match(/, OT_HIDDEN_MSG\)/g) || []).length, 2, '소속·직급 숨김 둘 다 휴지통 토스트를 쓰지 않는다(M4)');
  },
  //  M5 — 사용자에게 보이는 「퇴사자 휴지통」「삭제된 항목」이 없다(주석 제외) · 동작 이름 「퇴사 처리」·「퇴사자 보기」는 그대로
  wording(src) {
    const visible = stripJsComments(stripHtmlComments(src));
    for (const w of ['퇴사자 휴지통', '삭제된 항목']) assert.ok(!visible.includes(w), `사용자에게 보이는 「${w}」가 남았다 — 「휴지통」으로(M5)`);
    assert.ok(/mk\('휴지통', 'uaTrash', 'btn sm', \(\) => openTrash\('user'\)\)\.disabled = __uaSaving;/.test(src), '「구성원 편집」의 문이 「휴지통」이 아니다(M5)');
    assert.ok(/if\(h\) h\.textContent = '휴지통';/.test(body(src, 'openTrash')), '휴지통 머리말이 두 문 모두 「휴지통」이 아니다(M5)');
    assert.ok(visible.includes('퇴사자 보기') && visible.includes('퇴사 처리'), '동작 이름 「퇴사 처리」·「퇴사자 보기」가 사라졌다 — 동작 이름은 사실대로 둔다(M5)');
  },
};

test('(S) R2: 두 휴지통 항목 = 「🗑 휴지통」(id gone · trash 그대로) · AH_ITEMS 이름·여는 길', () => statics.itemNames(app));
test('(S) M1: 도킹 공식 과제에서만 추가/추가됨/제거 · ✓ · 왼쪽 막대를 숨기는 CSS · 단독 규칙은 그대로', () => statics.dockedOfficialCss(app));
test('(S) M3: 사람 휴지통 탭 표 = 구성원 · 소속 · 직급 + 안내 한 줄 · 과제 쪽 넷 그대로', () => statics.trashTabs(app));
test('(S) M10: 소속·직급 조회·복구 = 직급·소속 화면의 명령 그대로(orgTitleGet · unitSetActive · titleSetActive) — 새 명령 없음', () => statics.noNewCommands(app));
test('(S) M3: 소속·직급 줄 — 영구 삭제 없음(부재) · 상위 숨김 = 복구 끔 + 같은 이유 문장 · 정렬 없음', () => statics.orgRowsRules(app));
test('(S) M4: 직급·소속 화면 = 쓰는 항목만 · 「숨긴 값도 표시」·[복구] 없음 · 숨김 토스트', () => statics.orgTitleScreen(app));
test('(S) M5: 「퇴사자 휴지통」「삭제된 항목」 문구 없음 · 동작 이름은 그대로', () => statics.wording(app));

test('변이(S)①: 항목 이름을 「퇴사자」로 되돌리면 (S) R2 가 실패한다', () => {
  const bad = mutate(app, '<span class="ah-ic" aria-hidden="true">🗑</span>휴지통<span class="ah-n" id="ahNgone">', '<span class="ah-ic" aria-hidden="true">🚪</span>퇴사자<span class="ah-n" id="ahNgone">');
  assert.throws(() => statics.itemNames(bad), /사람 묶음의 휴지통 항목/);
});
test('변이(S)②: 소속·직급에 [영구 삭제]를 되살리면 (S) M3 가 실패한다', () => {
  const bad = mutate(app, '    if(!def.org){\n    const db = document.createElement', '    if(true){\n    const db = document.createElement');
  assert.throws(() => statics.orgRowsRules(bad), /영구 삭제 없음/);
});
test('변이(S)③: 「퇴사자 휴지통」 버튼 문구를 되살리면 (S) M5 가 실패한다', () => {
  const bad = mutate(app, "mk('휴지통', 'uaTrash'", "mk('퇴사자 휴지통', 'uaTrash'");
  assert.throws(() => statics.wording(bad), /퇴사자 휴지통/);
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom — 실제 앱을 위젯 모드로 띄워 본다(admin-hub.test.mjs 와 같은 부팅)
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('admin-hub-3: jsdom 미설치 — 관리 3차 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const ME = { loginId: 'phmin', name: '박현민', title: '수석연구원', orgUnit: 'SW 3팀' };
  const EMPTY = { categories: [], entries: [], todos: [], rooms: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '' };
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const FADE = 200;   // MD_OUT(120ms) 페이드보다 넉넉히
  //  회신 본보기 — 숨긴 소속 셋(9: 상위 활성 · 10: 숨긴 상위 · 11: 숨긴 10 의 자식) · 숨긴 직급 하나 · 숨길 수 있는 활성 직급 하나.
  const ROSTER = { found: true, admin: true, includeInactive: false, units: [], titles: [],
    members: [{ userId: 11, loginId: 'zzA', name: 'zzA_가', title: '선임', orgUnit: 'SW 1팀', isActive: true }] };
  const U = (orgId, name, parentId, depth, active, extra) => Object.assign({ orgId, name, parentId, depth, sort: orgId * 10, active, users: 0, children: 0 }, extra || {});
  //  직급 행 열쇠는 번호(titleId)다(CODE-TABLE-IDS §4).
  const T = (titleId, name, active, users = 0) => ({ titleId, name, sort: 10, active, users });
  const ORG = { found: true, admin: true,
    titles: [T(1, '수석', true, 1), T(2, 'zz빈직급', true, 0), T(3, 'zz옛직급', false)],
    units: [U(1, '회사', null, 0, true, { children: 2 }), U(2, 'SW 1팀', 1, 1, true, { users: 1, children: 0 }),
            U(9, 'zz숨긴팀', 2, 2, false), U(10, 'zz숨긴본부', 1, 1, false, { children: 1 }), U(11, 'zz숨긴본부의팀', 10, 2, false)] };
  //  zz숨긴팀(9)을 복구한 뒤의 회신 / zz빈직급을 숨긴 뒤의 회신
  const ORG_RESTORED = JSON.parse(JSON.stringify(ORG)); ORG_RESTORED.units.find((u) => u.orgId === 9).active = true;
  const ORG_HIDDEN = JSON.parse(JSON.stringify(ORG)); ORG_HIDDEN.titles.find((t) => t.name === 'zz빈직급').active = false;
  const TRASH = { found: true, admin: true,
    projects: [{ key: 'zzP1', name: 'zzP 과제', sub: '', refs: 0, deletable: true, why: '' }],
    users: [{ key: '31', name: 'zzU_퇴사', sub: 'SW 1팀', refs: 0, deletable: true, why: '' }],
    customers: [], sections: [], statuses: [] };
  const CATALOG = [
    { id: 'db-701', name: 'zz공식 하나', color: '#3e5be0', source: 'db', customer: 'zzC', section: '일반', status: '진행중', projectName: 'zz사업 하나' },
    { id: 'db-702', name: 'zz공식 둘', color: '#2e9e6b', source: 'db', customer: 'zzC', section: '일반', status: '진행중', projectName: 'zz사업 둘' },
  ];
  const REP = {
    membersGet: { ok: true, data: ROSTER },
    orgTitleGet: { ok: true, data: ORG },
    trashGet: { ok: true, data: TRASH },
    loadCustomersFull: { ok: true, list: '[]' },
    getCodesFull: { ok: true, list: '[]' },
  };
  //  이 기능이 부를 수 있는 명령 전부 — 이 밖의 명령이 나가면 '새 명령'이다(M10)
  const KNOWN = new Set(['userInfoGet', 'membersGet', 'orgTitleGet', 'trashGet', 'loadCustomersFull', 'getCodesFull', 'unitSetActive', 'titleSetActive', 'trashRestore', 'trashDelete']);

  //  ★ 2026-10-22(docs/ADMIN-WINDOW.md) — 관리 화면은 관리 창(?win=admin)에서만 열린다. 허브 시험은 그 창에서, 단독 찾아보기는 메인 창에서 본다.
  //    관리 창의 window.close() 는 호스트가 창을 닫는 길이라 시험에서는 횟수만 센다.
  const ADMIN_URL = 'https://tcapp.local/?win=admin', MAIN_URL = 'https://tcapp.local/';
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
        win.__realClose = win.close; win.__closeCalls = 0;
        win.close = function () { win.__closeCalls++; };
      },
    });
    const w = dom.window;
    const B = {
      w, posted, errors, doc: w.document,
      ev: (c) => w.eval(c),
      evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      close: () => { try { w.__realClose.call(w); } catch (_) {} },
    };
    w.eval(`window.__calls = []; window.__rep = {}; window.__toasts = [];
      hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
        var r = __rep[cmd];
        if(typeof r === 'function') r = r(p || {});
        if(r === 'pending') return new Promise(function(){});
        if(r === undefined || r === 'fail') return Promise.resolve({ ok:false, msg:'시험: 회신 없음' });
        return Promise.resolve(JSON.parse(JSON.stringify(r))); };
      (function(){ var t = toast; toast = function(m, k, a, ms){ __toasts.push([String(m), String(k || '')]); return t(m, k, a, ms); }; })();`);
    const sess = posted.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).find((m) => m && m.cmd === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: ME }) + ')');
    w.eval('currentUser = ' + JSON.stringify(ME));
    w.__applyState(JSON.stringify(EMPTY), {});
    w.eval('dbOnline = true;');
    return B;
  }
  const $ = (B, s) => B.doc.querySelector(s);
  const $$ = (B, s) => [...B.doc.querySelectorAll(s)];
  const isOpen = (B, id) => B.ev(`isOverlayOpen(document.getElementById(${JSON.stringify(id)}))`);
  const calls = (B, cmd) => B.evJSON('__calls').filter((c) => !cmd || c[0] === cmd);
  const toasts = (B) => B.evJSON('__toasts');
  const docked = (B) => B.ev("(function(){ var d = document.querySelectorAll('#ahSlot > .overlay.docked'); return [].map.call(d, function(o){ return o.id; }).join(','); })()");
  const where = (B) => $(B, '#ahWhere').textContent.replace(/\s+/g, ' ').trim();
  const cs = (B, el, prop) => B.w.getComputedStyle(typeof el === 'string' ? $(B, el) : el)[prop];
  const tabKinds = (B) => $$(B, '#trTabs [data-trtab]').map((b) => b.dataset.trtab);
  const ops = (B) => $$(B, '#trList [data-top]').map((b) => ({ op: b.dataset.top, key: b.dataset.tkey, disabled: !!b.disabled, title: String(b.title || '') }));
  const rowNames = (B) => $$(B, '#trList .mb-row b').map((b) => b.textContent);
  async function reset(B, rep = REP) {
    B.ev(`(function(){
      if(isOverlayOpen(document.getElementById('adminHub'))) closeOverlay(document.getElementById('adminHub'));
      return 1; })()`);
    await settle(FADE);
    B.ev(`(function(){ document.querySelectorAll('.overlay').forEach(function(o){ o.classList.remove('closing'); o.classList.add('hidden'); });
      __calls.length = 0; __toasts.length = 0; __rep = ${JSON.stringify(rep)}; currentUser = ${JSON.stringify(ME)};
      __ahRole = { login: '', admin: null };
      __otData = null; __trData = null; __trAdmin = false; __trOrg = null; __uaAdmin = false; __uaMembers = []; return 1; })()`);
    for (const k of Object.keys(B.w.localStorage)) if (/^tc_admin(Last|Seen):/.test(k)) B.w.localStorage.removeItem(k);
    B.ev('ahNoteRole(true)');
    await settle(FADE);
  }
  const openHub = async (B, item) => { B.ev(`openAdminHub(${JSON.stringify(item)})`); await settle(80); };
  const pick = async (B, item) => { $(B, `#ahNav [data-ahitem="${item}"]`).click(); await settle(80); };
  const tab = async (B, kind) => { $(B, `#trTabs [data-trtab="${kind}"]`).click(); await settle(40); };
  //  확인창 [확인] — confirmBox 는 닫힘 뒤(페이드)에 해소된다
  const confirmOk = async (B) => { await settle(40); assert.strictEqual(isOpen(B, 'confirmModal'), true, '확인창이 뜨지 않았다'); $(B, '#cfOk').click(); await settle(FADE + 60); };
  //  공식 과제 본보기 — 하나는 내 캘린더에 들어 있다(db-701 · 편입), 하나는 아니다
  const seedCatalog = (B) => B.ev(`dbCatalog = ${JSON.stringify(CATALOG)};
    state.categories = [{ id: 'db-701', name: 'zz공식 하나', color: '#3e5be0', source: 'db', desc: '', gitRepo: '', svnRepo: '', createdAt: '2026-10-01T00:00:00Z' }]; 1`);

  //  R1 — 도킹(관리 화면) vs 단독(찾아보기)의 내 캘린더 표시
  const officialProbe = (B) => ({
    sub: cs(B, '#offDetail .off-d-sub', 'display'),
    act: cs(B, '#offDetail .off-d-act', 'display'),
    tick: $(B, '#offList .off-row[data-id="db-701"] .off-subtick') ? cs(B, '#offList .off-row[data-id="db-701"] .off-subtick', 'display') : '(없음)',
    bar: cs(B, '#offList .off-row[data-id="db-701"]', 'boxShadow'),
    btns: $$(B, '#offDetail button').filter((b) => B.w.getComputedStyle(b.closest('.off-d-sub') || b).display !== 'none' && !(b.closest('.off-d-sub') && B.w.getComputedStyle(b.closest('.off-d-sub')).display === 'none')).map((b) => b.textContent.trim()),
  });
  const dom = {
    async dockedOfficial(src) {
      let B = boot(src);
      try {
        await reset(B); seedCatalog(B);
        await openHub(B, 'projects');
        assert.strictEqual(docked(B), 'officialModal', '전제: 공식 과제가 관리 화면 칸에 도킹되지 않았다');
        B.ev("offSelect('db-701')"); await settle(20);
        const d = officialProbe(B);
        assert.strictEqual(d.sub, 'none', `관리 화면의 공식 과제 상세에 「✓ 추가됨 · 제거」가 보인다(display=${d.sub}) — 편집 화면은 편집만(R1)`);
        assert.strictEqual(d.tick, 'none', `관리 화면의 공식 과제 목록에 ✓(내 캘린더에 있음)가 보인다(display=${d.tick})(R1)`);
        assert.strictEqual(d.bar, 'none', `관리 화면의 공식 과제 목록에 왼쪽 accent 막대가 남았다(box-shadow=${d.bar})(R1)`);
        assert.notStrictEqual(d.act, 'none', '관리 화면의 공식 과제 상세에 편집·숨김이 사라졌다 — 남는 것: 편집 · 숨김(R1)');
        assert.deepStrictEqual(d.btns, ['편집', '숨김'], `관리 화면 상세에 보이는 버튼이 편집·숨김 둘이 아니다: ${JSON.stringify(d.btns)}`);
        //  미편입 과제도 — 「＋ 캘린더에 추가」가 보이지 않는다
        B.ev("offSelect('db-702')"); await settle(20);
        assert.strictEqual(cs(B, '#offDetail .off-d-sub', 'display'), 'none', '관리 화면에 「＋ 캘린더에 추가」가 보인다(R1)');
        assert.ok($(B, '#offDetail [data-offadd="db-702"]'), '「＋ 캘린더에 추가」 노드가 사라졌다 — 숨김은 display 만이다(단독과 같은 렌더)');
        assert.notStrictEqual(cs(B, '#offNew', 'display'), 'none', '관리 화면에 「＋ 새 공식 과제」가 사라졌다(R1 — 남는 것)');
        assert.deepStrictEqual(B.errors, [], '페이지 오류');
        B.close();
        //  단독(찾아보기, 메인 창) — 그대로다(이 표시들이 주인공)
        B = boot(src, MAIN_URL);
        await reset(B); seedCatalog(B);
        B.ev('openOfficialModal()'); await settle(60);
        assert.ok(!$(B, '#officialModal').classList.contains('docked'), '전제: 단독으로 열리지 않았다');
        B.ev("offSelect('db-701')"); await settle(20);
        const s = officialProbe(B);
        assert.notStrictEqual(s.sub, 'none', '단독 찾아보기에서 「✓ 추가됨 · 제거」가 사라졌다(R1 — 단독은 그대로)');
        assert.notStrictEqual(s.tick, 'none', '단독 찾아보기에서 목록 ✓ 가 사라졌다(R1)');
        assert.match(s.bar, /inset 3px 0 0 var\(--accent\)/, `단독 찾아보기에서 왼쪽 accent 막대가 사라졌다: ${s.bar}`);
        assert.ok(/추가됨/.test($(B, '#offDetail .off-d-sub').textContent) && $(B, '#offDetail [data-offremove="db-701"]'), '단독 찾아보기 상세에 「✓ 추가됨 · 제거」가 없다');
        assert.strictEqual(s.act, 'none', '단독 찾아보기에 편집·숨김이 섰다 — 찾아보기는 읽기 전용(ADMIN-HUB-2 J3)');
        B.ev("offSelect('db-702')"); await settle(20);
        assert.notStrictEqual(cs(B, '#offDetail .off-d-sub', 'display'), 'none', '단독 찾아보기에서 「＋ 캘린더에 추가」가 사라졌다');
        assert.deepStrictEqual(B.errors, [], '페이지 오류');
      } finally { B.close(); }
    },
    //  R2 — 왼쪽 항목 · 위치 줄 · 머리말
    async names(src) {
      const B = boot(src);
      try {
        await reset(B);
        await openHub(B, 'gone');
        assert.strictEqual(where(B), '👥 사람 ›🗑 휴지통', `사람 휴지통의 위치 줄이 다르다: ${JSON.stringify(where(B))}(R2)`);
        assert.strictEqual($(B, '#trTitle').textContent, '휴지통');
        assert.deepStrictEqual(B.evJSON("[].map.call(document.querySelectorAll('#ahSel option'), function(o){ return o.textContent.replace(/ \\(.*\\)$/, ''); })"),
          ['👤 구성원', '🏷 직급', '🏢 소속', '🗑 휴지통'], '좁은 창 고르기 상자의 사람 묶음 이름이 다르다(R2 · ADMIN-HUB-4 N4 — 직급·소속 분리)');
        $(B, '#ahGrpProj').click(); await settle(80);
        await pick(B, 'trash');
        assert.strictEqual(where(B), '📁 회사 과제 ›🗑 휴지통', `회사 과제 휴지통의 위치 줄이 다르다: ${JSON.stringify(where(B))}(R2)`);
        assert.strictEqual($(B, '#trTitle').textContent, '휴지통');
        assert.deepStrictEqual(tabKinds(B), ['project', 'customer', 'section', 'status'], '회사 과제 휴지통 안 탭이 바뀌었다(M2 — 안 내용은 그대로)');
        assert.ok(ops(B).some((o) => o.op === 'delete'), '회사 과제 휴지통에서 영구 삭제가 사라졌다(M2 — 그대로)');
      } finally { B.close(); }
    },
    //  R3 — 사람 휴지통 탭 셋 · 구성원 기존 동작 · 소속/직급 복구 규칙 · 영구 삭제 없음 + 안내
    async peopleTrash(src) {
      const B = boot(src);
      try {
        await reset(B);
        B.ev(`__rep.unitSetActive = function(p){ return { ok: true, msg: '복구했습니다', orgTitle: ${JSON.stringify(JSON.stringify(ORG_RESTORED))} }; }; 1`);
        await openHub(B, 'gone'); await settle(60);
        //  탭 순서 = 왼쪽 항목 순서(ADMIN-HUB-4 N6 — 구성원 · 직급 · 소속)
        assert.deepStrictEqual(tabKinds(B), ['user', 'title', 'unit'], `사람 휴지통 탭이 구성원 · 직급 · 소속이 아니다: ${JSON.stringify(tabKinds(B))}(R3·N6)`);
        assert.deepStrictEqual($$(B, '#trTabs [data-trtab]').map((b) => b.textContent), ['구성원1', '직급1', '소속3'], '탭 이름·건수가 다르다(R3)');
        assert.strictEqual($(B, '#trTabs').getAttribute('role'), 'tablist');
        assert.strictEqual($(B, '#ahNgone').textContent, '5', '관리 화면의 사람 휴지통 개수가 세 탭의 합이 아니다(1 + 3 + 1)');
        assert.ok(/퇴사 처리한 구성원 1명, 숨긴 직급 1개, 숨긴 소속 3개/.test($(B, '#trScope').textContent), `부제가 다르다: ${$(B, '#trScope').textContent}`);
        //  구성원 탭 = 지금의 퇴사자 휴지통 그대로(복구 · 영구 삭제) + 안내 한 줄
        assert.deepStrictEqual(rowNames(B), ['zzU_퇴사']);
        assert.deepStrictEqual(ops(B).map((o) => o.op), ['restore', 'delete'], '구성원 탭의 [복구][영구 삭제]가 사라졌다(R3 — 기존 동작)');
        assert.ok(!$(B, '#trNote').classList.contains('hidden') && /퇴사 처리한 구성원입니다\. 복구하면 다시 로그인·명부 대상이 됩니다/.test($(B, '#trNote').textContent), '구성원 탭 안내 한 줄이 없다(M3)');
        //  소속 탭 — 숨긴 셋 · 호스트가 준 순서 · 상위가 숨김인 11 은 복구가 꺼지고 이유가 보이는 줄로 · 영구 삭제 없음
        await tab(B, 'unit');
        assert.deepStrictEqual(rowNames(B), ['zz숨긴팀', 'zz숨긴본부', 'zz숨긴본부의팀'], `소속 탭 목록이 다르다: ${JSON.stringify(rowNames(B))}`);
        assert.strictEqual(ops(B).filter((o) => o.op === 'delete').length, 0, '소속 탭에 [영구 삭제]가 있다 — 소속·직급은 영구 삭제하지 않는다(R3)');
        const r = Object.fromEntries(ops(B).map((o) => [o.key, o]));
        assert.strictEqual(r['9'].disabled, false, '상위가 활성인 숨긴 소속의 [복구]가 꺼져 있다');
        assert.strictEqual(r['10'].disabled, false, '최상위 바로 아래 숨긴 소속의 [복구]가 꺼져 있다');
        assert.strictEqual(r['11'].disabled, true, '상위가 숨김인 소속의 [복구]가 켜져 있다 — 트리에서 갈 곳이 없다(R3)');
        assert.strictEqual(r['11'].title, '상위 조직을 먼저 복구하세요');
        const why = $(B, '#trList [data-trwhy="11"]');
        assert.ok(why && why.textContent === '상위 조직을 먼저 복구하세요', '상위 숨김 이유가 보이는 줄로 나오지 않는다(꺼진 버튼의 title 은 뜨지 않는다)(R3)');
        assert.ok(/상위: zz숨긴본부/.test($(B, '#trList').textContent), '숨긴 소속 줄에 상위 이름이 없다');
        assert.ok(/소속·직급은 지난 기록이 이름을 가리키므로 영구 삭제하지 않습니다/.test($(B, '#trNote').textContent) && !$(B, '#trNote').classList.contains('hidden'),
          '소속 탭에 「영구 삭제하지 않습니다」 안내 한 줄이 없다(R3)');
        //  복구 — 확인 → 직급·소속 화면의 명령 그대로(unitSetActive · active:true) → 회신의 목록이 앉아 그 줄이 사라진다
        $(B, '#trList [data-top="restore"][data-tkey="9"]').click();
        await confirmOk(B);
        await settle(60);
        const sent = calls(B, 'unitSetActive');
        assert.strictEqual(sent.length, 1, '복구가 unitSetActive 로 한 번 나가지 않았다(M10)');
        assert.strictEqual(sent[0][1].orgId, 9); assert.strictEqual(sent[0][1].active, true);
        assert.deepStrictEqual(rowNames(B), ['zz숨긴본부', 'zz숨긴본부의팀'], '복구한 소속이 휴지통에 남았다 — 회신의 갱신 목록이 앉지 않았다');
        assert.ok(toasts(B).some((t) => t[0] === '복구했습니다' && t[1] === 'success'), `복구 토스트가 없다: ${JSON.stringify(toasts(B))}`);
        assert.strictEqual($(B, '#ahNgone').textContent, '4', '복구 뒤 관리 화면 개수가 줄지 않았다');
        //  직급 탭 — 숨긴 직급 하나 · 복구 켜짐 · 영구 삭제 없음
        await tab(B, 'title');
        assert.deepStrictEqual(rowNames(B), ['zz옛직급']);
        assert.deepStrictEqual(ops(B).map((o) => [o.op, o.disabled]), [['restore', false]], '직급 탭의 버튼이 [복구] 하나가 아니다(R3)');
        assert.ok(/영구 삭제하지 않습니다/.test($(B, '#trNote').textContent), '직급 탭에 안내 한 줄이 없다');
        //  새 명령 없음
        const extra = calls(B).map((c) => c[0]).filter((c) => !KNOWN.has(c));
        assert.deepStrictEqual(extra, [], `이 기능이 새 호스트 명령을 부른다: ${JSON.stringify(extra)}(M10)`);
        assert.deepStrictEqual(B.errors, [], '페이지 오류');
      } finally { B.close(); }
    },
    //  R3 — 소속·직급을 아직 못 받았으면 건수 '—' · '불러오는 중…' · 못 읽으면 사유(빈 목록으로 거짓말하지 않는다)
    async orgPendingFail(src) {
      const B = boot(src);
      try {
        await reset(B, Object.assign({}, REP, { orgTitleGet: 'pending' }));
        await openHub(B, 'gone'); await settle(60);
        assert.deepStrictEqual($$(B, '#trTabs [data-trtab]').map((b) => b.textContent), ['구성원1', '직급-', '소속-'], '받기 전 소속·직급 건수가 — 가 아니다(0 은 없다로 읽힌다)');
        await tab(B, 'unit');
        assert.strictEqual($(B, '#trList').textContent, '불러오는 중…', '받기 전 소속 탭이 「불러오는 중…」이 아니다');
        assert.ok($(B, '#trEmpty').classList.contains('hidden'), '받기 전인데 「숨긴 소속이 없습니다」를 말한다');
        await reset(B, Object.assign({}, REP, { orgTitleGet: 'fail' }));
        await openHub(B, 'gone'); await settle(60);
        await tab(B, 'title');
        assert.ok(/시험: 회신 없음|불러오지 못했습니다/.test($(B, '#trList').textContent), `못 읽은 직급 탭이 사유를 말하지 않는다: ${$(B, '#trList').textContent}`);
        assert.ok($(B, '#trEmpty').classList.contains('hidden'), '못 읽었는데 「숨긴 직급이 없습니다」를 말한다');
        assert.deepStrictEqual(ops(B), [], '못 읽었는데 복구 버튼이 섰다');
      } finally { B.close(); }
    },
    //  R4 — 직급·소속 화면에 숨긴 항목 없음 · 숨김 → 토스트 · 사람 휴지통 직급 탭에 나타난다
    async orgTitleHide(src) {
      const B = boot(src);
      try {
        await reset(B);
        B.ev(`__rep.titleSetActive = function(p){ return { ok: true, msg: '숨겼습니다', orgTitle: ${JSON.stringify(JSON.stringify(ORG_HIDDEN))} }; }; 1`);
        await openHub(B, 'orgtitle'); await settle(60);
        const names = () => $$(B, '#otList .cust-row').map((r) => r.dataset.otkey);
        assert.deepStrictEqual(names(), ['1', '2'], `직급 탭에 숨긴 직급이 섰다: ${JSON.stringify(names())}(R4)`);
        assert.strictEqual($$(B, '#otList .cust-badge').length, 0, '「숨김」 배지가 남았다(R4)');
        assert.strictEqual($$(B, '#otList [data-otop="show"]').length, 0, '직급·소속 화면에 [복구]가 남았다(R4 — 복구는 휴지통)');
        assert.strictEqual($(B, '#otShowHidden'), null, '「숨긴 값도 표시」가 남았다(R4)');
        //  ADMIN-HUB-4 N4 — 직급·소속은 왼쪽 항목이 따로다(도킹 중엔 화면 안 [직급 | 소속] 전환이 숨는다) — 항목으로 바꾼다
        await pick(B, 'unit'); await settle(60);
        assert.deepStrictEqual(names(), ['1', '2'], `소속 탭에 숨긴 소속이 섰다: ${JSON.stringify(names())}(R4)`);
        await pick(B, 'title'); await settle(60);
        //  숨김 — 확인 → titleSetActive(active:false) → 목록에서 빠지고 토스트가 어디로 갔는지 말한다
        $(B, '#otList [data-otop="hide"][data-otkey="2"]').click();
        await confirmOk(B);
        await settle(60);
        const sent = calls(B, 'titleSetActive');
        assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0][1].titleId, 2); assert.strictEqual(sent[0][1].active, false);
        assert.deepStrictEqual(names(), ['1'], '숨긴 직급이 직급·소속 목록에 남았다(R4)');
        assert.ok(toasts(B).some((t) => t[0] === '휴지통으로 옮겼습니다. 복구는 🗑 휴지통에서 할 수 있습니다' && t[1] === 'success'),
          `숨김 토스트가 「휴지통으로 옮겼습니다. 복구는 🗑 휴지통에서 할 수 있습니다」가 아니다: ${JSON.stringify(toasts(B))}(R4)`);
        //  사람 휴지통 직급 탭에 나타난다(그 사이 호스트 목록도 바뀌었다)
        B.ev(`__rep.orgTitleGet = { ok: true, data: ${JSON.stringify(ORG_HIDDEN)} }; 1`);
        await pick(B, 'gone'); await settle(60);
        await tab(B, 'title');
        assert.deepStrictEqual(rowNames(B), ['zz빈직급', 'zz옛직급'], `숨긴 직급이 사람 휴지통 직급 탭에 나타나지 않았다: ${JSON.stringify(rowNames(B))}(R4)`);
        assert.deepStrictEqual(B.errors, [], '페이지 오류');
      } finally { B.close(); }
    },
  };

  test('(R1) 도킹 공식 과제: 추가/추가됨/제거 · ✓ · 왼쪽 막대 0 · 편집·숨김·새 과제는 남는다 — 단독 찾아보기엔 그대로', () => dom.dockedOfficial(app));
  test('(R2) 왼쪽 항목·고르기 상자·위치 줄 = 「👥 사람 › 🗑 휴지통」 · 「📁 회사 과제 › 🗑 휴지통」 · 머리말 「휴지통」 · 회사 과제 휴지통 안은 그대로', () => dom.names(app));
  test('(R3) 사람 휴지통: 탭 셋 · 구성원 기존 동작 + 안내 · 소속/직급 복구(상위 숨김 = 끔 + 보이는 이유) · 영구 삭제 없음 + 안내 · 새 명령 없음', () => dom.peopleTrash(app));
  test('(R3) 소속·직급을 받기 전엔 — 와 「불러오는 중…」 · 못 읽으면 사유(빈 목록으로 말하지 않는다)', () => dom.orgPendingFail(app));
  test('(R4) 직급·소속 화면: 숨긴 항목 없음 · 숨김 → 휴지통 토스트 → 사람 휴지통 직급 탭에 나타난다', () => dom.orgTitleHide(app));

  test('변이(R)①: 도킹 공식 과제 CSS 를 빼면 (R1) 이 실패한다', async () => {
    const bad = mutate(app, '#adminHub .ah-slot > .overlay.docked .off-d-sub,#adminHub .ah-slot > .overlay.docked .off-subtick{display:none !important}', '');
    await assert.rejects(() => dom.dockedOfficial(bad), /관리 화면의 공식 과제 상세에 「✓ 추가됨 · 제거」가 보인다|목록에 ✓/);
  });
  test('변이(R)②: 상위 숨김 규칙을 빼면 (R3) 이 실패한다', async () => {
    const bad = mutate(app, "why: (p && p.active === false) ? '상위 조직을 먼저 복구하세요' : ''", "why: ''");
    await assert.rejects(() => dom.peopleTrash(bad), /상위가 숨김인 소속의 \[복구\]가 켜져 있다/);
  });
  test('변이(R)③: 직급·소속 화면이 숨긴 값을 다시 그리면 (R4) 가 실패한다', async () => {
    const bad = mutate(app, '  const rows = (unit ? otUnits() : otTitles()).filter(x => x && x.active !== false);', '  const rows = (unit ? otUnits() : otTitles()).filter(x => x);');
    await assert.rejects(() => dom.orgTitleHide(bad), /숨긴 직급이 섰다/);
  });
  test('변이(R)④: 받기 전 건수를 0 으로 쓰면 (R3) 받기 전 계약이 실패한다', async () => {
    const bad = mutate(app, "n.textContent = (t.org && !trOrgReady()) ? '-' : String(trRows(t.kind).length);", 'n.textContent = String(trRows(t.kind).length);');
    await assert.rejects(() => dom.orgPendingFail(bad), /받기 전 소속·직급 건수가 — 가 아니다/);
  });
}
