// 사람 고르기 — [사람 | 조직도] 탭 · 「내 부서」 기본 표시 · 조직도(docs/PEER-PICKER-ORG.md G1–G10 · 수용 R1–R9).
//
// tests/peer-picker.test.mjs 가 K1–K12(입구 · 검색 · 즐겨찾기 · 최근 · 바꾸기)를 지킨다면, 이 파일은
// "검색어를 몰라도 **내 부서부터** 보이고, 다른 부서는 **조직도**로 찾아 들어갈 수 있는가" 를 지킨다:
//   (S) 정적 — 새 함수에 hpost/save/innerHTML/hostRequest 없음(호스트로 가는 것은 여전히 pkLoad 의 membersGet 하나) ·
//       조직 순서·루트 규칙은 「구성원 보기」의 mbCmp · mbChildMap 을 그대로 쓴다.
//   (P) 순수 — pkModel 의 내 부서(직속 · 나 제외 · 두 줄 금지 · N명) · pkOrgIndex(순서 · 하위 포함 인원 · 나 제외 · 순환 가드 · 고아 루트) · pkOrgPath.
//   (R) jsdom — R1 탭(마크업·aria · 열 때 늘 사람 · 검색 우선 · 탭 누르면 검색어 지움) / R2 사람 탭(순서 · 내 부서 · N명 · 링크) /
//       R3 처음 쓰는 사람 / R4 조직도 넓음(두 칸 · 순서 = 구성원 보기 · 인원 · 내 소속 · 처음 선택 · 펼침) /
//       R5 오른쪽 목록(경로 · 하위 조직 줄 · 직속 · 회색 · 빈 조직) / R6 좁음(한 칸 내려가기 · 창 폭 경계) /
//       R7 열람 창 바꾸기(탭·조직도 · 보는 중 · 머리 폭 안) / R8 키보드(탭 ←/→ · 트리 ↓/↑/→/← · Enter) / R9 myUnit 없음·모름 · 명부 실패.
//   (M) 변이 — 내 부서에서 「나 제외」 줄 빼기 · 「두 줄 금지」 줄 빼기 · 조직 인원에서 「나 제외」 빼기 — 각각 잡힌다.
//
// ★ R10(실 DB)은 tests/loop-peer-frame.mjs 「사람 고르기 · 조직도」 라운드 · R11(테마 대비 · 실 위젯)은 실 위젯 캡처.
// ★ jsdom 은 레이아웃이 없다 — 「넓음/좁음」은 창 폭(window.innerWidth) · 열람 창 머리 폭(clientWidth)을 시험이 세워서 본다.
// 생략 규약: jsdom 이 없으면 (R)은 **등록되지 않고** skip(판정 없음)으로 계수된다(러너 exit 2).
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
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
const body = (src, fn) => stripJsComments(extractFunction(src, fn));

// ══════════════════════════════════════════════════════════════════════
// (S) 정적
// ══════════════════════════════════════════════════════════════════════
const ORG_FNS = ['pkOrgIndex', 'pkOrgPath', 'pkDirRow', 'pkFailNote', 'pkView', 'pkAvailW', 'pkWantWide', 'pkSyncTabs', 'pkMineSection',
  'pkTreeEl', 'pkUnitListEl', 'pkRenderOrg', 'pkFocusTarget', 'pkSetTab', 'pkSelectUnit', 'pkToggleOpen', 'pkOrgInit', 'pkTreeKey',
  'pkRender', 'pkLoad', 'pkEnsure', 'pkPlace', 'pkOpen', 'pkOnClick', 'pkOnKey', 'pkModel'];

test('(정적) G10·K12: 탭·조직도 함수는 hpost·save·HTML 주입 API 를 쓰지 않는다 · 호스트 명령은 pkLoad 의 membersGet 하나', () => {
  const sent = [];
  for (const fn of ORG_FNS) {
    const code = body(app, fn);
    assert.ok(!/\bhpost\s*\(/.test(code), `${fn} 가 hpost 를 부른다`);
    assert.ok(!/\bsave\s*\(/.test(code), `${fn} 가 save() 를 부른다`);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), `${fn} 가 HTML 주입 API 를 쓴다 — 조직·이름은 DB 문자열이다`);
    for (const m of code.matchAll(/hostRequest\(\s*'([^']+)'/g)) sent.push(fn + ':' + m[1]);
  }
  assert.deepStrictEqual(sent, ['pkLoad:membersGet'], '새 호스트 명령이 생겼다(G9): ' + sent.join(','));
});

test('(정적) G4: 조직 순서·루트는 「구성원 보기」 규칙을 재사용한다(pkOrgIndex 가 mbCmp · mbChildMap 을 쓴다) · 순환 가드가 있다', () => {
  const ix = body(app, 'pkOrgIndex');
  assert.ok(/mbChildMap\(/.test(ix) && /\.sort\(mbCmp\)/.test(ix), '조직 순서를 따로 만들었다 — 구성원 보기와 갈린다');
  assert.ok(/if\(reach\.has\(k\)\) continue;/.test(ix), '순환(parent 가 돌아오는) 가드가 없다');
});

// ══════════════════════════════════════════════════════════════════════
// (P) 순수 — pkModel(내 부서) · pkOrgIndex · pkOrgPath
// ══════════════════════════════════════════════════════════════════════
function modelFn(src) {
  const code = ['pkNorm', 'pkMatch', 'pkModel'].map((f) => extractFunction(src, f)).join('\n');
  return new Function('PK_RESULT_MAX', code + '\nreturn pkModel;')(20);
}
function orgFns(src) {
  const code = ['mbCmp', 'mbChildMap', 'pkOrgIndex', 'pkOrgPath'].map((f) => extractFunction(src, f)).join('\n');
  return new Function(code + '\nreturn { pkOrgIndex, pkOrgPath };')();
}
const M_ = (loginId, name, title, orgUnit, canViewSchedule = true) => ({ loginId, name, title, orgUnit, canViewSchedule });
//  조직 — 회사 밑에 셋(본부·연구소·사업본부) · 연구소 밑 팀 셋(sortOrder 가 이름 순과 **다르게**: SW 2팀이 SW 1팀보다 앞) ·
//    부모가 목록에 없는 고아(외부팀 → 루트) · 서로를 부모로 삼는 순환 둘(트리에 없다 — 구성원 보기와 같다).
const U_ = (name, parent, sortOrder) => ({ name, parent, sortOrder });
const UNITS = [
  U_('회사', null, 0),
  U_('경영지원본부', '회사', 1), U_('인사팀', '경영지원본부', 1), U_('재무팀', '경영지원본부', 2),
  U_('연구소', '회사', 2), U_('SW 2팀', '연구소', 1), U_('SW 1팀', '연구소', 2), U_('HW팀', '연구소', 3),
  U_('사업본부', '회사', 3), U_('영업팀', '사업본부', 1),
  U_('외부팀', '없는조직', 9),
  U_('X순환A', 'X순환B', 1), U_('X순환B', 'X순환A', 1),
];
const ROSTER = [
  M_('ceo', '박대표', '대표', '회사'),
  M_('h1', '최인사', '팀장', '인사팀', false),
  M_('lab', '윤소장', '소장', '연구소'),
  M_('phmin', '박현민', '수석연구원', 'SW 2팀'),
  M_('wblee', '이웅빈', '선임', 'SW 2팀'), M_('s21', '임재원', '부장', 'SW 2팀'), M_('s22', '문아린', '선임', 'SW 2팀', false),
  M_('ihyoon', '윤인환', '책임', 'SW 1팀'), M_('s12', '조민재', '선임', 'SW 1팀'),
  M_('hw1', '배하드', '책임', 'HW팀'),
  M_('b1', '서영업', '팀장', '영업팀'),
  M_('cyc', '순환씨', '연구원', 'X순환A'),
  M_('nou', '무소속', '연구원', ''),
];

test('(순수) G2: pkModel 내 부서 — myUnit 직속 · 나 제외 · 즐겨찾기/최근에 나온 사람 제외 · N명 = 나 뺀 직속 · 검색 중엔 없음', () => {
  const pkModel = modelFn(app);
  let md = pkModel({ favs: [{ loginId: 's21', name: '임재원' }], recents: [{ loginId: 'wblee', name: '이웅빈' }], members: ROSTER, q: '', me: 'phmin', viewing: '', myUnit: 'SW 2팀' });
  assert.deepStrictEqual(md.mine.map((r) => r.loginId), ['s22'], '나·즐겨찾기·최근이 내 부서에 또 나왔다');
  assert.strictEqual(md.mineCount, 3, 'N명은 나만 빼고 센다(위에 이미 나온 사람도 센다)');
  assert.deepStrictEqual([md.mine[0].canView, md.mine[0].org], [false, 'SW 2팀'], '범위 밖은 canView=false');
  md = pkModel({ favs: [], recents: [], members: ROSTER, q: '', me: 'phmin', viewing: '', myUnit: 'SW 2팀' });
  assert.deepStrictEqual(md.mine.map((r) => r.loginId), ['wblee', 's21', 's22'], '명부 순서 그대로가 아니다');
  md = pkModel({ favs: [], recents: [], members: ROSTER, q: '이웅', me: 'phmin', viewing: '', myUnit: 'SW 2팀' });
  assert.deepStrictEqual([md.mine, md.mineCount], [[], 0], '검색 중에 내 부서 묶음이 나왔다(검색이 탭보다 우선 · G1)');
  md = pkModel({ favs: [], recents: [], members: ROSTER, q: '', me: 'phmin', viewing: '' });
  assert.deepStrictEqual(md.mine, [], 'myUnit 없이 내 부서가 나왔다(G9)');
  md = pkModel({ favs: [], recents: [], members: null, q: '', me: 'phmin', viewing: '', myUnit: 'SW 2팀' });
  assert.deepStrictEqual(md.mine, [], '명부를 못 읽었는데 내 부서가 나왔다');
});

test('(순수) G4: pkOrgIndex — 루트(부모 없음·고아) · mbCmp 순서 · 인원(하위 포함 · 나 제외) · 직속 · 순환은 트리에 없음 · 경로', () => {
  const { pkOrgIndex, pkOrgPath } = orgFns(app);
  const ix = pkOrgIndex(UNITS, ROSTER, 'phmin');
  assert.deepStrictEqual(ix.roots, ['회사', '외부팀']);
  assert.deepStrictEqual(ix.kids.get('회사'), ['경영지원본부', '연구소', '사업본부']);
  assert.deepStrictEqual(ix.kids.get('연구소'), ['SW 2팀', 'SW 1팀', 'HW팀'], 'sortOrder 가 이름보다 먼저가 아니다');
  const cnt = Object.fromEntries([...ix.count]);
  assert.deepStrictEqual(cnt, { 회사: 10, 경영지원본부: 1, 인사팀: 1, 재무팀: 0, 연구소: 7, 'SW 2팀': 3, 'SW 1팀': 2, HW팀: 1, 사업본부: 1, 영업팀: 1, 외부팀: 0 });
  assert.deepStrictEqual((ix.direct.get('SW 2팀') || []).map((m) => m.loginId), ['wblee', 's21', 's22'], '직속에 내가 있다');
  assert.ok(!ix.has('X순환A') && !ix.has('X순환B'), '순환 조직이 트리에 들어왔다');
  assert.ok(ix.has('외부팀') && !ix.has('없는조직'));
  assert.deepStrictEqual(pkOrgPath(ix, 'SW 2팀'), ['회사', '연구소', 'SW 2팀']);
  assert.deepStrictEqual(pkOrgPath(ix, '없는팀'), []);
  //  같은 사람·같은 조직 이름이 두 번 와도 한 번만
  const ix2 = pkOrgIndex(UNITS.concat([U_('연구소', '사업본부', 0)]), ROSTER.concat([M_('wblee', '이웅빈', '선임', 'SW 2팀')]), 'phmin');
  assert.strictEqual(ix2.count.get('SW 2팀'), 3);
  assert.deepStrictEqual(ix2.kids.get('사업본부'), ['영업팀'], '중복 이름 조직이 두 번째 부모에 붙었다');
  //  빈 회신·이상값에도 던지지 않는다
  const ix3 = pkOrgIndex(null, null, '');
  assert.deepStrictEqual([ix3.roots, ix3.has('회사')], [[], false]);
});

test('(변이) G2: 내 부서의 「나 제외」 줄을 지우면 (순수) 판정이 잡는다', () => {
  const bad = mutate(app, '      if(id === me) continue;          // G2 — 나는 내 부서 목록에 없다\n', '');
  const md = modelFn(bad)({ favs: [], recents: [], members: ROSTER, q: '', me: 'phmin', viewing: '', myUnit: 'SW 2팀' });
  assert.ok(md.mine.some((r) => r.loginId === 'phmin'), '전제: 변이가 나를 내 부서에 넣는다');
  assert.notStrictEqual(md.mineCount, 3, '전제: 변이가 N명을 바꾼다');
});
test('(변이) G2: 내 부서의 「두 줄 금지」 줄을 지우면 즐겨찾기·최근에 있는 사람이 또 나와 잡힌다', () => {
  const bad = mutate(app, '      if(shown.has(id)) continue;      // G2 — 즐겨찾기·최근에 이미 나온 사람은 다시 안 그린다(같은 사람 두 줄 금지)\n', '');
  const md = modelFn(bad)({ favs: [{ loginId: 's21', name: '임재원' }], recents: [{ loginId: 'wblee', name: '이웅빈' }], members: ROSTER, q: '', me: 'phmin', viewing: '', myUnit: 'SW 2팀' });
  assert.throws(() => assert.deepStrictEqual(md.mine.map((r) => r.loginId), ['s22'], '두 줄'), /두 줄/);
});
test('(변이) G4: 조직 인원에서 「나 제외」를 지우면 내 조직·상위의 N 이 하나씩 늘어 잡힌다', () => {
  const bad = mutate(app, '    if(id === meId) continue;          // G4 — 인원 수·목록에서 나를 뺀다\n', '');
  const ix = orgFns(bad).pkOrgIndex(UNITS, ROSTER, 'phmin');
  assert.deepStrictEqual([ix.count.get('SW 2팀'), ix.count.get('회사')], [4, 11], '전제: 변이가 나를 센다');
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('peer-picker-org: jsdom 미설치 — 탭·내 부서·조직도 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const ME = { loginId: 'phmin', name: '박현민', title: '수석연구원', orgUnit: 'SW 2팀' };
  const EMPTY = { categories: [], entries: [], todos: [], rooms: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '' };
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
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
    const B = { w, posted, errors, doc: w.document, ev: (c) => w.eval(c), close: () => { try { w.close(); } catch (_) {} } };
    w.eval(`window.__calls = []; window.__rep = {};
      hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
        var r = __rep[cmd];
        if(r === 'pending') return new Promise(function(){});
        if(r === undefined || r === 'fail') return Promise.resolve({ ok:false, msg:'시험: 회신 없음' });
        return Promise.resolve(JSON.parse(JSON.stringify(r))); };`);
    const sess = posted.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).find((m) => m && m.cmd === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: ME }) + ')');
    w.eval('currentUser = ' + JSON.stringify(ME));
    w.__applyState(JSON.stringify(EMPTY), {});
    return B;
  }
  const membersOk = (o = {}) => ({ ok: true, data: { found: true, scope: 'unit_tree', myUnit: 'myUnit' in o ? o.myUnit : 'SW 2팀', units: o.units || UNITS, members: o.members || ROSTER } });
  const PEER_OK = { ok: true, allowed: true, categories: [], entries: [], todos: [] };
  const keyF = 'tc_peerFav:' + ME.loginId, keyR = 'tc_peerRecent:' + ME.loginId;
  const setLS = (B, k, v) => B.w.localStorage.setItem(k, JSON.stringify(v));
  const calls = (B, cmd) => JSON.parse(B.ev('JSON.stringify(__calls)')).filter((c) => !cmd || c[0] === cmd);
  const pop = (B) => B.doc.getElementById('peerPicker');
  const isOpen = (B) => !!pop(B) && !pop(B).classList.contains('hidden');
  const tab = (B, k) => B.doc.querySelector(`#peerPicker .pk-tab[data-tab="${k}"]`);
  const viewOf = (B) => pop(B).dataset.view;
  const secOrder = (B) => [...B.doc.querySelectorAll('#pkBody [data-sec]')].map((g) => g.dataset.sec);
  const rows = (B, s) => [...B.doc.querySelectorAll(`#pkBody [data-sec="${s}"] .pk-row`)].map((r) => {
    const o = r.querySelector('.pk-open');
    return { id: o.dataset.login, text: o.textContent.replace(/\s+/g, ' ').trim(), off: o.getAttribute('aria-disabled') === 'true', tip: o.title };
  });
  const notes = (B) => [...B.doc.querySelectorAll('#pkBody .pk-note')].map((n) => n.textContent);
  const nodes = (B) => [...B.doc.querySelectorAll('#pkBody .pk-tree .pk-node')].map((b) => ({
    unit: b.dataset.unit, level: b.getAttribute('aria-level'), exp: b.getAttribute('aria-expanded'), sel: b.getAttribute('aria-selected') === 'true',
    tw: b.querySelector('.pk-tw').textContent, cnt: b.querySelector('.pk-nc').firstChild.textContent, mine: !!b.querySelector('.pk-mine'), ti: b.tabIndex }));
  const node = (B, u) => [...B.doc.querySelectorAll('#pkBody .pk-tree .pk-node')].find((b) => b.dataset.unit === u);
  const twist = (B, u) => node(B, u).querySelector('[data-act="twist"]');
  const crumb = (B) => [...B.doc.querySelectorAll('#pkBody .pk-crumb button, #pkBody .pk-crumb b')].map((e) => (e.tagName === 'B' ? '[' + e.textContent + ']' : e.textContent));
  const crumbBtn = (B, u) => [...B.doc.querySelectorAll('#pkBody .pk-crumb button')].find((b) => b.dataset.unit === u);
  const subs = (B) => [...B.doc.querySelectorAll('#pkBody .pk-olist .pk-sub')].map((b) => b.querySelector('.pk-nm').textContent + ':' + b.querySelector('.pk-nc').textContent);
  const subBtn = (B, u) => [...B.doc.querySelectorAll('#pkBody .pk-olist .pk-sub')].find((b) => b.dataset.unit === u);
  const openBtn = (B, id) => [...B.doc.querySelectorAll('#pkBody .pk-open')].find((b) => b.dataset.login === id);
  const key = (B, el, k) => el.dispatchEvent(new B.w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const type = (B, v) => { const i = B.doc.getElementById('pkSearch'); i.value = v; i.dispatchEvent(new B.w.Event('input', { bubbles: true })); };
  const act = (B) => { const a = B.doc.activeElement; if (!a) return '';
    return a.id || (a.classList.contains('pk-node') ? 'node:' + a.dataset.unit : a.className + ':' + (a.dataset.login || a.dataset.unit || '')); };
  const pvOpen = (B) => { const m = B.doc.getElementById('peerModal'); return !m.classList.contains('hidden') && !m.classList.contains('closing'); };
  //  창 폭 — jsdom 의 innerWidth 는 고정값이다 → 시험이 덮어쓰고 resize 를 쏜다(G6 경계).
  const setVW = (B, px) => { Object.defineProperty(B.w, 'innerWidth', { value: px, configurable: true, writable: true }); B.w.dispatchEvent(new B.w.Event('resize')); };
  async function reset(B) {
    B.ev(`(function(){ try{ if(__pk) pkClose(false); }catch(_){}
      document.querySelectorAll('.overlay').forEach(function(o){ o.classList.remove('closing'); o.classList.add('hidden'); });
      __calls.length = 0; __rep = {}; currentUser = ${JSON.stringify(ME)}; return 1; })()`);
    for (const k of Object.keys(B.w.localStorage)) if (/^tc_peer(Fav|Recent):/.test(k)) B.w.localStorage.removeItem(k);
    setVW(B, 1024);
    await settle();
  }
  async function openTop(B, rep = membersOk()) {
    B.ev('__rep.membersGet = ' + JSON.stringify(rep));
    B.doc.getElementById('btnPeerPick').click();
    await settle();
  }
  async function landFrame(B) {
    await settle();
    B.ev(`(function(){ var f = document.querySelector('#pvHost iframe'); if(!f) return 0;
      var w = f.contentWindow; w.__applyState = function(){}; w.peerViewNow = function(){ return null; };
      f.dispatchEvent(new Event('load')); return 1; })()`);
    await settle();
  }

  let B = null;
  test('(R) 부팅: 내 창이 오류 없이 뜬다 · 창 폭 1024(jsdom) = 조직도 두 칸이 들어가는 폭', () => {
    B = boot(app);
    assert.strictEqual(B.ev('HOST'), true);
    assert.ok(B.ev('window.innerWidth') - 16 >= B.ev('PK_ORG_MIN_W'), '전제: 기본 창 폭에서 두 칸');
    assert.deepStrictEqual(B.errors, []);
  });

  // ── R1 ──
  test('(R1) 탭 마크업: 검색 칸 아래 role=tablist · [사람 | 조직도] role=tab + aria-selected · aria-controls=본문(tabpanel) · 로빙 tabindex', async () => {
    await reset(B);
    await openTop(B);
    const p = pop(B), tl = p.querySelector('[role="tablist"]');
    assert.ok(tl, 'tablist 가 없다');
    assert.ok(p.querySelector('.pk-search').compareDocumentPosition(tl) & B.w.Node.DOCUMENT_POSITION_FOLLOWING, '탭이 검색 칸 아래가 아니다');
    const ts = [...tl.querySelectorAll('[role="tab"]')];
    assert.deepStrictEqual(ts.map((t) => [t.textContent, t.getAttribute('aria-selected'), t.tabIndex, t.getAttribute('aria-controls')]),
      [['사람', 'true', 0, 'pkBody'], ['조직도', 'false', -1, 'pkBody']]);
    const bd = B.doc.getElementById('pkBody');
    assert.strictEqual(bd.getAttribute('role'), 'tabpanel');
    assert.strictEqual(bd.getAttribute('aria-labelledby'), 'pkTabPeople');
    assert.strictEqual(viewOf(B), 'people');
    tab(B, 'org').click();
    assert.deepStrictEqual(ts.map((t) => [t.getAttribute('aria-selected'), t.tabIndex]), [['false', -1], ['true', 0]]);
    assert.strictEqual(bd.getAttribute('aria-labelledby'), 'pkTabOrg');
    assert.strictEqual(act(B), 'pkTabOrg', '누른 탭에 포커스가 남지 않았다');
  });

  test('(R1) 열 때마다 「사람」 탭으로 시작한다(조직도에서 닫았다 다시 열어도) — 저장하지 않는다', async () => {
    assert.strictEqual(viewOf(B), 'org-wide');
    B.ev('pkClose(false)');
    await openTop(B);
    assert.strictEqual(tab(B, 'people').getAttribute('aria-selected'), 'true', '다시 열었는데 조직도 탭이다');
    assert.strictEqual(viewOf(B), 'people');
    assert.ok(!Object.keys(B.w.localStorage).some((k) => /peer(Tab|Org)/i.test(k)), '탭·조직도 상태를 저장했다');
  });

  test('(R1) 검색어가 있으면 어느 탭이든 검색 결과 · 탭은 흐려진다 · 탭을 누르면 검색어를 지우고 그 탭으로', async () => {
    tab(B, 'org').click();
    type(B, '윤인');
    assert.strictEqual(viewOf(B), 'search', '조직도 탭에서 검색어가 결과로 바뀌지 않았다');
    assert.ok(B.doc.querySelector('#peerPicker .pk-tabs').classList.contains('pk-dim'), '검색 중인데 탭이 흐리지 않다');
    assert.deepStrictEqual(rows(B, 'Result').map((r) => r.id), ['ihyoon']);
    assert.ok(!B.doc.querySelector('#pkBody .pk-tree'), '검색 중인데 트리가 보인다');
    assert.ok(!pop(B).classList.contains('pk-wide'), '검색 결과인데 팝오버가 넓다');
    tab(B, 'org').click();   // 지금 탭이어도 — 검색에서 빠져나온다
    assert.strictEqual(B.doc.getElementById('pkSearch').value, '', '탭을 눌렀는데 검색어가 남았다');
    assert.strictEqual(viewOf(B), 'org-wide');
    assert.ok(!B.doc.querySelector('#peerPicker .pk-tabs').classList.contains('pk-dim'));
    type(B, '윤인');
    tab(B, 'people').click();
    assert.deepStrictEqual([B.doc.getElementById('pkSearch').value, viewOf(B)], ['', 'people']);
  });

  // ── R2 ──
  test('(R2) 「사람」: ★ 즐겨찾기 → 최근 → 내 부서 순서 · 내 부서는 나·즐겨찾기·최근 제외 · 머리말 「내 부서 · SW 2팀 3명」 + 링크', async () => {
    await reset(B);
    setLS(B, keyF, [{ loginId: 's21', name: '임재원' }]);
    setLS(B, keyR, [{ loginId: 'ihyoon', name: '윤인환' }, { loginId: 'wblee', name: '이웅빈' }]);
    await openTop(B);
    assert.deepStrictEqual(secOrder(B), ['Fav', 'Recent', 'Mine'], '묶음 순서가 다르다');
    assert.deepStrictEqual(rows(B, 'Mine').map((r) => [r.id, r.off]), [['s22', true]], '내 부서에 나·중복이 있거나 범위 밖이 회색이 아니다');
    assert.strictEqual(rows(B, 'Mine')[0].tip, '일정 열람 범위 밖입니다');
    assert.ok(!B.doc.querySelector('#pkBody .pk-open[data-login="phmin"]'), '나 자신이 목록에 있다');
    for (const id of ['s21', 'wblee']) assert.strictEqual(B.doc.querySelectorAll(`#pkBody .pk-open[data-login="${id}"]`).length, 1, '같은 사람 두 줄: ' + id);
    const h = [...B.doc.querySelectorAll('#pkBody .pk-sec-h')].pop();
    assert.strictEqual(h.querySelector('span').textContent, '내 부서: SW 2팀');
    assert.strictEqual(h.querySelector('.pk-cnt').textContent, '3명', 'N명 = 나를 뺀 직속 인원(위에 나온 사람 포함)');
    const more = h.querySelector('[data-act="goorg"]');
    assert.ok(more && more.textContent === '조직도에서 다른 부서 ›', '「조직도에서 다른 부서 ›」 링크가 없다');
    assert.ok(!notes(B).some((t) => /☆ 를 누르면/.test(t)), '쓰던 사람에게 처음 안내가 나왔다');
  });

  test('(R2) 「조직도에서 다른 부서 ›」 → 조직도 탭 · 내 부서 선택 · 포커스는 트리의 내 부서', async () => {
    B.doc.querySelector('#pkBody [data-act="goorg"]').click();
    assert.strictEqual(tab(B, 'org').getAttribute('aria-selected'), 'true');
    assert.strictEqual(viewOf(B), 'org-wide');
    assert.deepStrictEqual(nodes(B).filter((n) => n.sel).map((n) => n.unit), ['SW 2팀']);
    assert.strictEqual(act(B), 'node:SW 2팀');
    //  다른 조직을 골랐다가 사람 탭에서 링크를 다시 누르면 내 부서로 돌아온다
    node(B, '사업본부').click();
    tab(B, 'people').click();
    B.doc.querySelector('#pkBody [data-act="goorg"]').click();
    assert.deepStrictEqual(nodes(B).filter((n) => n.sel).map((n) => n.unit), ['SW 2팀'], '링크가 내 부서를 고르지 않았다');
  });

  // ── R3 ──
  test('(R3) 처음 쓰는 사람: 맨 위 안내 한 줄 + 그 아래 바로 내 부서(빈 화면 금지)', async () => {
    await reset(B);
    await openTop(B);
    const bd = B.doc.getElementById('pkBody');
    assert.strictEqual(bd.firstElementChild.className, 'pk-note', '맨 위가 안내가 아니다');
    //  J8(2026-10-02 · ADMIN-HUB-2) — 두 문장 · 인용 없음(「최근 본 사|람」 처럼 인용 중간에서 끊겨 읽혔다)
    assert.strictEqual(bd.firstElementChild.textContent, '☆ 를 누르면 즐겨찾기에 남습니다. 한 번 연 사람은 최근 목록에 쌓입니다.');
    assert.deepStrictEqual(secOrder(B), ['Mine']);
    assert.deepStrictEqual(rows(B, 'Mine').map((r) => r.id), ['wblee', 's21', 's22']);
    //  검색 칸 ↓ → 내 부서 첫 행(K11 — 지금 보이는 본문의 첫 행)
    key(B, B.doc.getElementById('pkSearch'), 'ArrowDown');
    assert.strictEqual(act(B), 'pk-open:wblee');
  });

  // ── R4 ──
  test('(R4) 조직도(넓음): 두 칸(트리 | 목록) · 팝오버 660px(화면 안) · 처음 선택 = 내 부서 · 펼침 = 루트 + 내 부서까지의 경로', async () => {
    await reset(B);
    await openTop(B);
    tab(B, 'org').click();
    const p = pop(B);
    assert.ok(p.classList.contains('pk-wide') && viewOf(B) === 'org-wide');
    assert.strictEqual(p.style.width, '660px');
    const left = parseFloat(p.style.left);
    assert.ok(left >= 8 && left + 660 <= 1024 - 8, '넓어진 팝오버가 화면 밖으로 나갔다: left=' + p.style.left);
    assert.ok(B.doc.querySelector('#pkBody .pk-org2 > .pk-tree[role="tree"]') && B.doc.querySelector('#pkBody .pk-org2 > .pk-olist'), '두 칸이 아니다');
    assert.deepStrictEqual(nodes(B).map((n) => [n.unit, n.level, n.exp, n.tw]), [
      ['회사', '1', 'true', '▾'], ['경영지원본부', '2', 'false', '▸'], ['연구소', '2', 'true', '▾'],
      ['SW 2팀', '3', null, ''], ['SW 1팀', '3', null, ''], ['HW팀', '3', null, ''],
      ['사업본부', '2', 'false', '▸'], ['외부팀', '1', null, ''],
    ], '처음 펼침이 루트 + 경로가 아니다(또는 순서가 mbCmp 가 아니다)');
    assert.deepStrictEqual(nodes(B).filter((n) => n.sel).map((n) => n.unit), ['SW 2팀']);
    assert.deepStrictEqual(nodes(B).filter((n) => n.ti === 0).map((n) => n.unit), ['SW 2팀'], '로빙 tabindex 가 고른 조직에 있지 않다');
    assert.deepStrictEqual(nodes(B).filter((n) => n.mine).map((n) => n.unit), ['SW 2팀'], '「내 소속」 꼬리표');
    assert.deepStrictEqual(Object.fromEntries(nodes(B).map((n) => [n.unit, n.cnt])),
      { 회사: '10', 경영지원본부: '1', 연구소: '7', 'SW 2팀': '3', 'SW 1팀': '2', HW팀: '1', 사업본부: '1', 외부팀: '0' }, '인원 수(하위 포함 · 나 제외)');
    assert.ok(!nodes(B).some((n) => /순환/.test(n.unit)), '순환 조직이 트리에 나왔다');
    assert.deepStrictEqual(crumb(B), ['회사', '연구소', '[SW 2팀]']);
    assert.deepStrictEqual(rows(B, 'Unit').map((r) => r.id), ['wblee', 's21', 's22'], '오른쪽 목록 = 내 부서 직속(나 제외)');
  });

  test('(R4) ▸/▾ 는 펼침만 바꾼다(고른 조직 그대로) · 다 펼친 트리 순서 = 「구성원 보기」 트리 순서', async () => {
    twist(B, '경영지원본부').click();
    assert.deepStrictEqual(nodes(B).slice(1, 4).map((n) => n.unit), ['경영지원본부', '인사팀', '재무팀']);
    assert.strictEqual(node(B, '경영지원본부').getAttribute('aria-expanded'), 'true');
    assert.deepStrictEqual(nodes(B).filter((n) => n.sel).map((n) => n.unit), ['SW 2팀'], '▸ 를 눌렀는데 선택이 바뀌었다');
    assert.strictEqual(act(B), 'node:경영지원본부', '▸ 를 누른 노드에 포커스가 남지 않았다');
    twist(B, '사업본부').click();
    const ours = nodes(B).map((n) => n.unit);
    twist(B, '경영지원본부').click();
    assert.ok(!node(B, '인사팀'), '▾ 를 다시 눌렀는데 접히지 않았다');
    assert.strictEqual(node(B, '경영지원본부').getAttribute('aria-expanded'), 'false');
    //  구성원 보기 — 같은 회신으로 연다(그 화면은 바뀌지 않았다: 트리 전부 · 내 소속 꼬리표). 모달이 열리면 팝오버는 닫힌다(포커스가 나간다).
    B.ev('pkClose(false)');
    B.ev('__rep.membersGet = ' + JSON.stringify(membersOk()));
    await B.ev('openMembers()');
    const theirs = [...B.doc.querySelectorAll('#mbTree .mb-node')].map((b) => b.dataset.unit);
    assert.deepStrictEqual(ours, theirs, '조직 순서가 「구성원 보기」와 다르다');
    assert.ok(/내 소속/.test(B.doc.querySelector('#mbTree .mb-node.is-mine').textContent), '전제: 구성원 보기 그대로');
  });

  // ── R5 ──
  test('(R5) 오른쪽 목록: 상위 조직을 골라도 비지 않는다 — 경로 · 하위 조직 줄(이름 · N명) · 구분선 · 직속 사람', async () => {
    await reset(B);
    await openTop(B);
    tab(B, 'org').click();
    node(B, '연구소').click();
    assert.deepStrictEqual(nodes(B).filter((n) => n.sel).map((n) => n.unit), ['연구소']);
    assert.strictEqual(act(B), 'node:연구소');
    assert.deepStrictEqual(crumb(B), ['회사', '[연구소]']);
    assert.deepStrictEqual(subs(B), ['SW 2팀:3명', 'SW 1팀:2명', 'HW팀:1명']);
    assert.ok(B.doc.querySelector('#pkBody .pk-olist .pk-subsep'), '하위 조직 줄과 사람 사이 구분선이 없다');
    assert.deepStrictEqual(rows(B, 'Unit').map((r) => r.id), ['lab'], '직속만이어야 한다(하위 조직 사람은 하위 줄로)');
    //  경로의 조상을 누르면 그 조직으로
    crumbBtn(B, '회사').click();
    assert.deepStrictEqual(nodes(B).filter((n) => n.sel).map((n) => n.unit), ['회사']);
    assert.deepStrictEqual(subs(B), ['경영지원본부:1명', '연구소:7명', '사업본부:1명']);
    assert.deepStrictEqual(rows(B, 'Unit').map((r) => r.id), ['ceo']);
    assert.strictEqual(act(B), 'pk-sub:경영지원본부', '경로를 누른 뒤 포커스가 목록 첫 줄로 가지 않았다');
    //  하위 조직 줄을 누르면 그 조직으로(트리도 따라 펼친다)
    subBtn(B, '사업본부').click();
    assert.deepStrictEqual(nodes(B).filter((n) => n.sel).map((n) => n.unit), ['사업본부']);
    assert.strictEqual(node(B, '사업본부').getAttribute('aria-expanded'), 'true', '고른 조직이 펼쳐지지 않았다');
    assert.ok(node(B, '영업팀'), '트리가 고른 조직을 따라 펼쳐지지 않았다');
    //  범위 밖 회색 · 빈 조직
    subBtn(B, '영업팀') || null;
    node(B, '경영지원본부').click();
    subBtn(B, '인사팀').click();
    assert.deepStrictEqual(rows(B, 'Unit').map((r) => [r.id, r.off, r.tip]), [['h1', true, '일정 열람 범위 밖입니다']]);
    B.ev('__calls.length = 0');
    openBtn(B, 'h1').click();
    assert.deepStrictEqual(calls(B), [], '범위 밖 행을 눌렀더니 조회가 나갔다');
    crumbBtn(B, '경영지원본부').click();
    subBtn(B, '재무팀').click();
    assert.ok(notes(B).includes('이 조직에는 사람이 없습니다'), notes(B).join('|'));
    node(B, '외부팀').click();
    assert.ok(notes(B).includes('이 조직에는 사람이 없습니다'));
  });

  test('(R5) 조직도 목록에서 사람을 누르면 팝오버가 닫히고 열람 창이 그 사람으로 뜬다(openPeerSchedule 그대로)', async () => {
    node(B, '연구소').click();
    subBtn(B, 'SW 1팀').click();
    B.ev('__rep.peerSchedule = ' + JSON.stringify(PEER_OK) + '; __calls.length = 0');
    openBtn(B, 'ihyoon').click();
    await settle();
    assert.ok(!isOpen(B) && pvOpen(B));
    assert.deepStrictEqual(calls(B, 'peerSchedule').map((c) => c[1].loginId), ['ihyoon']);
    assert.strictEqual(B.doc.getElementById('pvTitle').textContent, '윤인환 님의 일정');
  });

  // ── R6 ──
  test('(R6) 좁은 창(쓸 수 있는 폭 < PK_ORG_MIN_W): 한 칸 — 경로 + 하위 조직 줄 + 직속 사람 · 한 단계씩 내려가기', async () => {
    await reset(B);
    setVW(B, 500);
    await openTop(B);
    tab(B, 'org').click();
    const p = pop(B);
    assert.strictEqual(viewOf(B), 'org-narrow');
    assert.ok(!p.classList.contains('pk-wide') && !B.doc.querySelector('#pkBody .pk-tree'), '좁은데 트리가 있다');
    assert.ok(parseFloat(p.style.width) <= 360, '좁은데 넓어졌다: ' + p.style.width);
    assert.deepStrictEqual(crumb(B), ['회사', '연구소', '[SW 2팀]'], '좁을 때도 처음 자리는 내 부서');
    assert.deepStrictEqual(rows(B, 'Unit').map((r) => r.id), ['wblee', 's21', 's22']);
    crumbBtn(B, '회사').click();
    assert.deepStrictEqual(subs(B), ['경영지원본부:1명', '연구소:7명', '사업본부:1명']);
    subBtn(B, '연구소').click();
    assert.deepStrictEqual(crumb(B), ['회사', '[연구소]']);
    assert.strictEqual(act(B), 'pk-sub:SW 2팀', '내려간 뒤 포커스가 새 목록 첫 줄이 아니다');
    subBtn(B, 'HW팀').click();
    assert.deepStrictEqual([crumb(B), subs(B), rows(B, 'Unit').map((r) => r.id)], [['회사', '연구소', '[HW팀]'], [], ['hw1']]);
    //  창을 넓히면 그 자리에서 두 칸으로(고른 조직 유지) · 다시 좁히면 한 칸
    setVW(B, 1024);
    assert.strictEqual(viewOf(B), 'org-wide');
    assert.deepStrictEqual(nodes(B).filter((n) => n.sel).map((n) => n.unit), ['HW팀']);
    setVW(B, 615);   // 615 − 16 = 599 < 600
    assert.strictEqual(viewOf(B), 'org-narrow', '경계(600) 바로 아래에서 두 칸이다');
    setVW(B, 616);
    assert.strictEqual(viewOf(B), 'org-wide', '경계(600)에서 두 칸이 아니다');
    assert.strictEqual(pop(B).style.width, '600px', '두 칸 폭을 쓸 수 있는 폭 안으로 당기지 않았다');
  });

  // ── R7 ──
  test('(R7) 열람 창 ▾ 바꾸기: 탭·조직도가 똑같이 있다 · 넓어져도 머리 폭 안 · 지금 보는 사람은 조직도 목록에서도 「· 보는 중」 회색', async () => {
    await reset(B);
    B.ev('__rep.peerSchedule = ' + JSON.stringify(PEER_OK));
    B.ev("openPeerSchedule('wblee', '이웅빈')");
    await landFrame(B);
    const head = B.doc.querySelector('#peerModal .modal-head');
    let hw = 900;
    Object.defineProperty(head, 'clientWidth', { get: () => hw, configurable: true });
    B.ev('__rep.membersGet = ' + JSON.stringify(membersOk()));
    B.doc.getElementById('pvSwitch').click();
    await settle();
    const p = pop(B);
    assert.ok(isOpen(B) && p.parentElement === head && tab(B, 'people'), '바꾸기 팝오버에 탭이 없다');
    assert.strictEqual(tab(B, 'people').getAttribute('aria-selected'), 'true');
    assert.deepStrictEqual(secOrder(B), ['Recent', 'Mine']);
    assert.ok(rows(B, 'Recent')[0].off && /보는 중/.test(rows(B, 'Recent')[0].text));
    tab(B, 'org').click();
    assert.strictEqual(viewOf(B), 'org-wide');
    const pw = parseFloat(p.style.width), left = parseFloat(p.style.left);
    assert.strictEqual(pw, 660);
    assert.ok(left >= 8 && left + pw <= hw - 8, `머리 폭(${hw}) 밖: left=${left} width=${pw}`);
    const me = rows(B, 'Unit').find((r) => r.id === 'wblee');
    assert.ok(me && me.off && /이웅빈 선임 \(보는 중\)/.test(me.text) && me.tip === '지금 보고 있는 사람입니다', JSON.stringify(me));
    //  머리가 좁으면 그 폭 안으로 — 경계 밑이면 한 칸
    hw = 640; B.w.dispatchEvent(new B.w.Event('resize'));
    assert.strictEqual(viewOf(B), 'org-wide');
    assert.ok(parseFloat(p.style.width) <= hw - 16 && parseFloat(p.style.left) + parseFloat(p.style.width) <= hw - 8, '머리 폭 밖: ' + p.style.width + '/' + p.style.left);
    hw = 520; B.w.dispatchEvent(new B.w.Event('resize'));
    assert.strictEqual(viewOf(B), 'org-narrow', '열람 창 머리가 좁은데 두 칸이다');
    assert.ok(parseFloat(p.style.width) <= hw - 16);
    //  조직도에서 다른 사람으로 바꾸기 — 창은 그대로
    B.ev('__calls.length = 0');
    subBtn(B, 'SW 1팀') || crumbBtn(B, '연구소').click();
    subBtn(B, 'SW 1팀').click();
    openBtn(B, 'ihyoon').click();
    assert.ok(pvOpen(B) && !isOpen(B));
    assert.deepStrictEqual(calls(B, 'peerSchedule').map((c) => c[1].loginId), ['ihyoon']);
    assert.strictEqual(B.doc.getElementById('pvTitle').textContent, '윤인환 님의 일정');
    assert.strictEqual(act(B), 'pvSwitch');
    delete head.clientWidth;
  });

  // ── R8 ──
  test('(R8) 키보드 — 탭: ←/→ 로 옮기며 바로 연다(포커스도 그 탭) · 달력 단축키로 새지 않는다', async () => {
    await reset(B);
    await openTop(B);
    const v0 = B.ev('JSON.stringify(view)');
    tab(B, 'people').focus();
    key(B, tab(B, 'people'), 'ArrowRight');
    assert.deepStrictEqual([act(B), viewOf(B)], ['pkTabOrg', 'org-wide']);
    key(B, tab(B, 'org'), 'ArrowLeft');
    assert.deepStrictEqual([act(B), viewOf(B)], ['pkTabPeople', 'people']);
    key(B, tab(B, 'people'), 'ArrowLeft');
    assert.deepStrictEqual([act(B), viewOf(B)], ['pkTabOrg', 'org-wide'], '←/→ 가 두 탭 사이를 돌지 않는다');
    assert.strictEqual(B.ev('JSON.stringify(view)'), v0, '탭의 ←/→ 가 내 달력 달을 옮겼다');
    //  탭에서 ↓ → 본문으로(조직도 두 칸이면 트리의 고른 조직)
    key(B, tab(B, 'org'), 'ArrowDown');
    assert.strictEqual(act(B), 'node:SW 2팀');
  });

  test('(R8) 키보드 — 트리: ↓/↑ 이동(선택은 그대로) · ← 접기/부모로 · → 펼치기/첫 하위로 · Enter 선택 · Esc 는 팝오버만', async () => {
    const sel = () => nodes(B).filter((n) => n.sel).map((n) => n.unit)[0];
    key(B, B.doc.activeElement, 'ArrowUp');
    assert.deepStrictEqual([act(B), sel()], ['node:연구소', 'SW 2팀'], '↑ 가 이동만 하지 않았다');
    assert.strictEqual(node(B, '연구소').tabIndex, 0, '로빙 tabindex 가 따라가지 않았다');
    key(B, B.doc.activeElement, 'ArrowLeft');
    assert.strictEqual(node(B, '연구소').getAttribute('aria-expanded'), 'false', '← 가 접지 않았다');
    assert.ok(!node(B, 'SW 2팀'), '접었는데 하위가 보인다');
    assert.strictEqual(act(B), 'node:연구소');
    key(B, B.doc.activeElement, 'ArrowLeft');
    assert.strictEqual(act(B), 'node:회사', '접힌 노드의 ← 가 부모로 가지 않았다');
    key(B, B.doc.activeElement, 'ArrowRight');
    assert.strictEqual(act(B), 'node:경영지원본부', '펼친 노드의 → 가 첫 하위로 가지 않았다');
    key(B, B.doc.activeElement, 'ArrowRight');
    assert.strictEqual(node(B, '경영지원본부').getAttribute('aria-expanded'), 'true', '→ 가 펼치지 않았다');
    assert.strictEqual(act(B), 'node:경영지원본부');
    key(B, B.doc.activeElement, 'ArrowDown');
    assert.strictEqual(act(B), 'node:인사팀');
    key(B, B.doc.activeElement, 'Enter');
    assert.deepStrictEqual([sel(), act(B), crumb(B)], ['인사팀', 'node:인사팀', ['회사', '경영지원본부', '[인사팀]']], 'Enter 가 고르지 않았다');
    key(B, B.doc.activeElement, 'ArrowDown');
    key(B, B.doc.activeElement, ' ');
    assert.strictEqual(sel(), '재무팀', 'Space 가 고르지 않았다');
    key(B, B.doc.activeElement, 'Home');
    assert.strictEqual(act(B), 'node:회사');
    key(B, B.doc.activeElement, 'ArrowUp');
    assert.strictEqual(act(B), 'pkSearch', '맨 위 ↑ 가 검색 칸으로 가지 않았다');
    key(B, B.doc.activeElement, 'ArrowDown');
    assert.strictEqual(act(B), 'node:재무팀', '검색 칸 ↓ 가 트리의 고른 조직으로 가지 않았다');
    key(B, B.doc.activeElement, 'Escape');
    assert.ok(!isOpen(B));
    assert.strictEqual(act(B), 'btnPeerPick', 'Esc 뒤 포커스가 입구로 돌아오지 않았다(K11)');
  });

  test('(R8) 키보드 — 목록 칸: 하위 조직 줄 · 사람 행을 ↓/↑ 로 오가고 끝에서 검색 칸 · 좁을 때 검색 칸 ↓ = 목록 첫 줄', async () => {
    await reset(B);
    await openTop(B);
    tab(B, 'org').click();
    node(B, '연구소').click();
    subBtn(B, 'SW 2팀').focus();
    key(B, B.doc.activeElement, 'ArrowDown');
    assert.strictEqual(act(B), 'pk-sub:SW 1팀', '하위 조직 줄 사이 이동');
    key(B, B.doc.activeElement, 'ArrowDown'); key(B, B.doc.activeElement, 'ArrowDown');
    assert.strictEqual(act(B), 'pk-open:lab', '하위 조직 줄 다음이 직속 사람이 아니다');
    key(B, B.doc.activeElement, 'ArrowDown');
    assert.strictEqual(act(B), 'pkSearch');
    setVW(B, 500);
    assert.strictEqual(viewOf(B), 'org-narrow');
    key(B, B.doc.getElementById('pkSearch'), 'ArrowDown');
    assert.strictEqual(act(B), 'pk-sub:SW 2팀', '좁을 때 검색 칸 ↓ 가 목록 첫 줄이 아니다');
    //  검색 칸 Enter 는 사람 행만 연다(하위 조직 줄을 고르지 않는다)
    B.ev('__rep.peerSchedule = ' + JSON.stringify(PEER_OK) + '; __calls.length = 0');
    B.doc.getElementById('pkSearch').focus();
    key(B, B.doc.getElementById('pkSearch'), 'Enter');
    await settle();
    assert.deepStrictEqual(calls(B, 'peerSchedule').map((c) => c[1].loginId), ['lab']);
  });

  // ── R9 ──
  test('(R9) myUnit 없음 · 트리에 없는 조직: 「사람」 탭에 내 부서 묶음 없음 · 조직도는 첫 루트 선택', async () => {
    for (const mu of ['', '없는팀', null]) {
      await reset(B);
      await openTop(B, membersOk({ myUnit: mu }));
      assert.deepStrictEqual(secOrder(B), [], 'myUnit=' + mu + ' 인데 내 부서 묶음이 있다');
      assert.ok(!B.doc.querySelector('#pkBody [data-act="goorg"]'), '내 부서가 없는데 링크가 있다');
      assert.ok(notes(B).some((t) => /☆ 를 누르면/.test(t)) && notes(B).some((t) => /조직도/.test(t)), '빈 화면 — 안내가 없다: ' + notes(B).join('|'));
      tab(B, 'org').click();
      assert.deepStrictEqual(nodes(B).filter((n) => n.sel).map((n) => n.unit), ['회사'], '첫 루트를 고르지 않았다');
      assert.ok(!nodes(B).some((n) => n.mine), '내 소속 꼬리표가 붙었다');
      assert.deepStrictEqual(nodes(B).map((n) => n.unit), ['회사', '경영지원본부', '연구소', '사업본부', '외부팀'], '루트만 펼쳐야 한다');
    }
    assert.deepStrictEqual(B.errors, []);
  });

  test('(R9) 명부 실패: 조직도 탭에 「명부를 불러오지 못했습니다 · 다시 시도」(K3 와 같은 문구·버튼) → 다시 시도하면 트리', async () => {
    await reset(B);
    await openTop(B, 'fail');
    tab(B, 'org').click();
    assert.strictEqual(viewOf(B), 'org-wide');
    assert.ok(notes(B).some((t) => /^명부를 불러오지 못했습니다/.test(t) && /다시 시도/.test(t)), notes(B).join('|'));
    assert.ok(!B.doc.querySelector('#pkBody .pk-tree'));
    B.ev('__rep.membersGet = ' + JSON.stringify(membersOk()));
    B.doc.querySelector('#pkBody [data-act="retry"]').click();
    await settle();
    assert.strictEqual(calls(B, 'membersGet').length, 2);
    assert.deepStrictEqual(nodes(B).filter((n) => n.sel).map((n) => n.unit), ['SW 2팀'], '다시 시도 뒤 트리가 내 부서로 서지 않았다');
    //  읽는 중
    B.ev('pkClose(false)');
    await openTop(B, 'pending');
    tab(B, 'org').click();
    assert.ok(notes(B).includes('불러오는 중…'), notes(B).join('|'));
  });

  test('(R) 마무리: 조작 내내 페이지 오류 0 · 쓰기 명령 없음 · 「구성원 보기」 트리 마크업은 그대로(.mb-node)', async () => {
    await reset(B);
    assert.deepStrictEqual(B.errors, [], '페이지 오류: ' + B.errors.slice(0, 2).join(' | '));
    const posts = B.posted.map((s) => { try { return JSON.parse(s).cmd; } catch (_) { return '?'; } });
    const writes = posts.filter((c) => /save|replace|import|delete|update|netcus|report/i.test(String(c)));
    assert.deepStrictEqual(writes, []);
    assert.ok(!B.doc.querySelector('#mbTree .pk-node'), '구성원 보기 트리에 사람 고르기 노드가 섞였다');
    B.close();
  });
}
