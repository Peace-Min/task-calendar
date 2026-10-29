// 「다른 사람 일정」 바로 가는 입구(docs/PEER-PICKER.md K1–K12 · 수용 R1–R9) — 툴바 👥 · 사람 고르기 팝오버 · 열람 창 ▾ 바꾸기 · ☆/★.
//
// tests/user-info.test.mjs 가 「구성원 보기」(조직도 → 행 클릭 → 열람)를 지킨다면, 이 파일은
// "구성원 보기를 거치지 않고도 **보이는 자리에서** 사람을 골라 열고, 본 사람은 다시 찾지 않는가" 를 지킨다:
//   (S) 정적 — 입구 마크업(aria-label · ⋯ 접기 · 좁은 폭 규칙) · 새 함수에 hpost/save/innerHTML 없음 · 호스트 명령은 membersGet 하나 ·
//       최근 기록은 mountPeerFrame 의 주입 성공 자리에서만 · 새 규칙에 hex 없음(토큰만).
//   (P) 순수 — pkParse(깨진 값 → 빈 목록) · pkModel(즐겨찾기/최근/결과 묶음 · 두 줄 금지 · 20행 제한 · 나 자신 없음 · 명부에 없음).
//   (R) jsdom — R1 입구(내 창 · 열람 창엔 없음) / R2 팝오버(열기·Esc·바깥·포커스·검색·20행·나 없음·회색) / R3 명부 실패 /
//       R4 최근(성공만·맨 앞·당김·5명·구성원 보기 경로·즐겨찾기와 두 줄 금지) / R5 즐겨찾기(토글·순서·20명·계정별·깨진 값) /
//       R6 명부에 없음(✕) / R7 열람 창 ▾ 바꾸기(창 유지·보던 달 잇기·보는 중) / R8 ☆/★ 양방향 / R9 키보드.
//   (M) 변이 — 최근 기록 줄 빼기 · 최근 기록을 조회 전으로 옮기기(실패도 기록) · 즐겨찾기 중복 빼기 제거 · Esc 캡처 빼기 — 각각 잡힌다.
//
// ★ R10(실 DB · 봉인)·R11(테마 대비 · 실 위젯)은 레이아웃·실 호스트가 있어야 한다 → tests/loop-peer-frame.mjs 「사람 고르기」 라운드 · 실 위젯 캡처.
// ★ 2026-10-16(docs/WINDOW-UI.md §4) — 열람은 따로 뜨는 창(호스트 PeerWindow 가 이 파일을 ?peerwin=1 로 띄운다)에서 한다.
//   그래서 jsdom 도 둘을 띄운다: B = 내 창(툴바 👥 · 구성원 보기 → 호스트에 peerOpen 만 보낸다), V = 열람 창(?peerwin=1 ·
//   호스트가 __peerWinOpen 으로 대상을 넘긴다 · ▾ 사람 바꾸기 · ☆/★ · 최근 기록). 실제로는 두 창이 localStorage 를 함께 쓰지만
//   jsdom 은 창마다 따로라서, 두 창을 오가는 저장 공유는 실 위젯 확인(loop-peer-frame ⑤)이 본다.
// ★ jsdom 은 iframe 을 불러오지 않는다(load 이벤트가 없다). 그래서 열람 프레임의 두 함수(__applyState · peerViewNow)를 시험이 대신 세우고
//   load 를 직접 쏜다(landFrame) — 부모 쪽 계약(언제 기록하나 · 무엇을 meta 로 넘기나)만 본다. 프레임 쪽 잇기는 PEER 부팅으로 따로 본다.
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 **등록되지 않고** skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

// 앵커 하나를 정확히 한 번 바꾼다 — 없거나 여럿이면 실패(조용히 통과하는 껍데기 변이를 막는다).
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
// (S) 정적 계약
// ══════════════════════════════════════════════════════════════════════
function styleOf(src) {
  const s = src.indexOf('<style>'), e = src.indexOf('</style>', s);
  assert.ok(s >= 0 && e > s, '<style> 블록을 찾지 못함');
  return src.slice(s + 7, e).replace(/\/\*[\s\S]*?\*\//g, '');
}
const cssRules = (src) => [...styleOf(src).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const PK_FNS = ['pkMe', 'pkKey', 'pkParse', 'pkList', 'pkSave', 'pkIsFav', 'pkNoteRecent', 'pkToggleFav', 'pkForget', 'pvSyncFav',
  'pvFrameView', 'pkNorm', 'pkMatch', 'pkModel', 'pkRowEl', 'pkNote', 'pkSection', 'pkRender', 'pkLoad', 'pkEnsure', 'pkPlace',
  'pkOpen', 'pkClose', 'pkPick', 'pkOnClick', 'pkOnKey', 'peerViewNow', 'peerApplyCarry'];

test('(정적) K1: 툴바 👥 버튼 — .actions 안 · has-label · aria-label 「다른 사람 일정」 · aria-haspopup=dialog · ⋯ 접기 항목', () => {
  const m = /<button class="btn icon has-label" id="btnPeerPick"([^>]*)>/.exec(app);
  assert.ok(m, '#btnPeerPick 이 .btn.icon.has-label 버튼으로 없다');
  assert.match(m[1], /aria-label="다른 사람 일정"/, '라벨이 접혀도 이름이 남아야 한다(aria-label)');
  assert.match(m[1], /aria-haspopup="dialog"/);
  assert.match(m[1], /aria-expanded="false"/);
  const acts = app.slice(app.indexOf('<div class="actions">'), app.indexOf('</header>'));
  assert.ok(acts.includes('id="btnPeerPick"'), '입구가 상단 툴바(.actions) 밖에 있다');
  assert.ok(acts.indexOf('id="btnSearch"') < acts.indexOf('id="btnPeerPick"') && acts.indexOf('id="btnPeerPick"') < acts.indexOf('id="btnReportTop"'),
    '입구는 「검색」·「보고서」 줄에 있어야 한다');
  assert.match(app, /<div class="mm-fold-pk">\s*<button id="btnPeerPickFold">다른 사람 일정<\/button>/, '⋯ 메뉴의 접기 항목이 없다');
  assert.ok(/set\('btnPeerPick', label\(ICON\.users, '다른 사람 일정'\)\)/.test(app), 'applyIcons 가 라벨을 달지 않는다');
});

test('(정적) K1: 좁은 폭 — ≤1199px 라벨 접기 · ≤549px ⋯ 로 접기(.mm-fold-pk) · 보조 4종 ≤440px 규칙은 그대로', () => {
  const css = styleOf(app);
  assert.match(css, /@media \(max-width:1199px\)\{\s*#btnPeerPick \.btn-label\{display:none\}/, '라벨 접기 경계(1199px)가 없다');
  assert.match(css, /\.mm-fold-pk\{display:none\}\s*@media \(max-width:549px\)\{\s*#btnPeerPick\{display:none\}\s*\.mm-fold-pk\{display:block\}\s*\}/,
    '≤549px 에서 버튼을 감추고 ⋯ 접기 항목을 보이는 규칙이 없다 — 숨긴 폭에서 입구가 사라진다');
  assert.match(css, /#btnSearch,#btnCatsTop,#btnFeedback,#btnUser\{display:none\}/, '기존 ≤440px 접기 줄이 바뀌었다');
});

test('(정적) K9·K10: 열람 창 제목 옆 「▾ 사람 바꾸기」(aria-haspopup) · ☆ 즐겨찾기(aria-pressed) — 열람 껍데기(#peerWin) 마크업에 있다', () => {
  const at = app.indexOf('<div class="pv-win hidden" id="peerWin">');
  assert.ok(at > 0, '#peerWin 껍데기를 찾지 못했다');
  const pm = app.slice(at, app.indexOf('<!-- ===== 구성원 편집'));
  assert.ok(!/id="peerModal"/.test(app), '옛 열람 모달(#peerModal)이 남았다');
  assert.ok(!/data-close/.test(pm), '열람 창 껍데기에 닫기 단추가 있다(닫기는 Windows 창 테두리가 맡는다)');
  assert.match(pm, /<h2 id="pvTitle">/);
  assert.match(pm, /<button class="btn sm pv-switch" id="pvSwitch" type="button" aria-haspopup="dialog" aria-expanded="false"[^>]*>▾ 사람 바꾸기<\/button>/);
  assert.match(pm, /<button class="pk-star" id="pvFav" type="button" aria-pressed="false"[^>]*>☆<\/button>/);
  assert.ok(pm.indexOf('id="pvTitle"') < pm.indexOf('id="pvSwitch"') && pm.indexOf('id="pvSwitch"') < pm.indexOf('id="pvHost"'),
    '바꾸기 버튼은 제목 옆(머리 줄)에 있어야 한다 — iframe 안이 아니라');
});

test('(정적) K12: 새 함수는 hpost·save 를 부르지 않고, DB 문자열에 innerHTML 을 쓰지 않는다', () => {
  for (const fn of PK_FNS) {
    const code = body(app, fn);
    assert.ok(!/\bhpost\s*\(/.test(code), `${fn} 가 hpost 를 부른다 — 이 구역은 쓰기 명령을 보내지 않는다`);
    assert.ok(!/\bsave\s*\(/.test(code), `${fn} 가 save() 를 부른다`);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), `${fn} 가 HTML 주입 API 를 쓴다 — 이름·조직은 DB 문자열이다`);
  }
});

test('(정적) K12: 호스트로 가는 것은 membersGet(구성원 보기와 같은 인자) 하나뿐 — 새 명령 없음', () => {
  const calls = PK_FNS.flatMap((fn) => [...body(app, fn).matchAll(/hostRequest\(\s*'([^']+)'\s*,([^)]*)\)/g)].map((m) => [fn, m[1], m[2].trim()]));
  assert.deepStrictEqual(calls.map((c) => c[1]), ['membersGet'], '사람 고르기 구역의 hostRequest: ' + JSON.stringify(calls));
  assert.ok(/^\{ includeInactive: false \}, 12000$/.test(calls[0][2]), '명부 조회 인자가 구성원 보기와 다르다: ' + calls[0][2]);
  assert.ok(/hostRequest\('membersGet', \{ includeInactive: false \}, 12000\)/.test(extractFunction(app, 'openMembers')), '전제: 구성원 보기도 같은 인자');
});

test('(정적) K6: 최근 기록은 mountPeerFrame 의 주입(__applyState) **뒤** 한 곳에서만 — openPeerSchedule 에는 없다', () => {
  const mount = body(app, 'mountPeerFrame');
  const ai = mount.indexOf('__applyState('), ri = mount.indexOf('pkNoteRecent(');
  assert.ok(ai >= 0 && ri > ai, 'pkNoteRecent 가 주입 뒤에 없다');
  assert.ok(!body(app, 'openPeerSchedule').includes('pkNoteRecent'), 'openPeerSchedule 이 최근을 기록한다 — 실패·권한 없음도 남는다');
  const sites = (app.match(/pkNoteRecent\(/g) || []).length;
  assert.strictEqual(sites, 2, `pkNoteRecent 가 정의 1 + 호출 1 이 아니다(${sites}) — 기록 자리가 둘이면 입구마다 규칙이 갈린다`);
});

test('(정적) K9: 바꾸기는 보던 달을 meta.view 로 잇는다 — 프레임 쪽 peerApplyCarry 는 __applyState 의 PEER 갈래에서', () => {
  assert.ok(/view: __pv\.carry \|\| null/.test(extractFunction(app, 'mountPeerFrame')), 'mountPeerFrame 이 meta.view 를 싣지 않는다');
  const as = app.slice(app.indexOf('window.__applyState = function(json, meta){'), app.indexOf('window.__applyStateError = function'));
  const p = as.indexOf('if(PEER){'), c = as.indexOf('peerApplyCarry(meta && meta.view)'), r = as.indexOf('renderAll();');
  assert.ok(p >= 0 && c > p && r > c, '보던 달 잇기가 PEER 갈래에서 renderAll() 보다 먼저 서지 않는다');
});

test('(정적) K12: 새 규칙(.pk-* · .pv-who · #pvFav)에 hex 색이 없다(토큰만 — 테마 5종 대비는 토큰이 지킨다)', () => {
  const rules = cssRules(app).filter((r) => /\.pk-|\.pv-who|\.pv-switch|#pvFav/.test(r.sel));
  assert.ok(rules.length >= 12, '사람 고르기 규칙을 찾지 못했다: ' + rules.length);
  const bad = rules.filter((r) => /#[0-9a-f]{3,8}\b/i.test(r.body)).map((r) => r.sel + '{' + r.body.trim() + '}');
  assert.deepStrictEqual(bad, []);
});

// ══════════════════════════════════════════════════════════════════════
// (P) 순수 함수 — pkParse · pkModel
// ══════════════════════════════════════════════════════════════════════
const pkParse = new Function(extractFunction(app, 'pkParse') + '\nreturn pkParse;')();
function modelFn(src) {
  const code = ['pkNorm', 'pkMatch', 'pkModel'].map((f) => extractFunction(src, f)).join('\n');
  return new Function('PK_RESULT_MAX', code + '\nreturn pkModel;')(20);
}
const M_ = (loginId, name, title, orgUnit, canViewSchedule = true) => ({ loginId, name, title, orgUnit, canViewSchedule });
const ROSTER = [
  M_('phmin', '박현민', '수석연구원', 'SW 3팀'),
  M_('wblee', '이웅빈', '선임', 'SW 2팀'),
  M_('ihyoon', '윤인환', '책임', 'SW 1팀'),
  M_('b1', '차은우', '책임연구원', '시스템 1팀', false),
  ...Array.from({ length: 30 }, (_, i) => M_('g' + String(i).padStart(2, '0'), '김시험' + String(i).padStart(2, '0'), '연구원', '시험팀')),
];

test('(순수) K8: 깨진 값·형식 이상은 빈 목록 · 이상한 항목/중복/나 자신은 버린다 · max 로 자른다', () => {
  for (const raw of ['{bad', '', 'null', '{"a":1}', '"str"', '42', 'true']) assert.deepStrictEqual(pkParse(raw, 5, 'phmin'), [], raw);
  const got = pkParse(JSON.stringify([1, null, 'x', { loginId: '' }, { loginId: '  ' }, { name: '이름만' }, { loginId: 'phmin', name: '나' },
    { loginId: 'wblee', name: '이웅빈' }, { loginId: 'wblee', name: '중복' }, { loginId: 7, name: 3 }]), 5, 'phmin');
  assert.deepStrictEqual(got, [{ loginId: 'wblee', name: '이웅빈' }, { loginId: '7', name: '' }]);
  const many = JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ loginId: 'u' + i, name: 'n' + i })));
  assert.deepStrictEqual(pkParse(many, 5, '').map((x) => x.loginId), ['u0', 'u1', 'u2', 'u3', 'u4']);
});

test('(순수) K3·K4·K7: pkModel — 즐겨찾기 > 최근 > 결과 한 줄씩 · 나 자신 없음 · 20행 + N명 더 · 범위 밖은 canView=false', () => {
  const pkModel = modelFn(app);
  const favs = [{ loginId: 'wblee', name: '이웅빈' }];
  const recents = [{ loginId: 'wblee', name: '이웅빈' }, { loginId: 'ihyoon', name: '윤인환' }, { loginId: 'phmin', name: '나' }];
  let md = pkModel({ favs, recents, members: ROSTER, q: '', me: 'phmin', viewing: '' });
  assert.deepStrictEqual(md.fav.map((r) => r.loginId), ['wblee']);
  assert.deepStrictEqual(md.recent.map((r) => r.loginId), ['ihyoon'], '즐겨찾기에 있는 사람·나 자신이 최근에 남았다');
  assert.deepStrictEqual(md.results, [], '검색어 없이 결과가 나왔다');
  assert.strictEqual(md.fav[0].title, '선임'); assert.strictEqual(md.fav[0].org, 'SW 2팀');
  md = pkModel({ favs, recents, members: ROSTER, q: '시험 팀', me: 'phmin', viewing: '' });
  assert.strictEqual(md.results.length, 20, '결과가 20행으로 잘리지 않았다'); assert.strictEqual(md.more, 10);
  md = pkModel({ favs: [], recents: [], members: ROSTER, q: 'SW', me: 'phmin', viewing: '' });
  assert.ok(!md.results.some((r) => r.loginId === 'phmin'), '나 자신이 검색 결과에 있다');
  md = pkModel({ favs: [], recents: [], members: ROSTER, q: '시스템1', me: 'phmin', viewing: '' });
  assert.deepStrictEqual(md.results.map((r) => [r.loginId, r.canView]), [['b1', false]], '조직으로 못 찾았거나 범위 밖이 열 수 있게 나왔다');
  md = pkModel({ favs: [], recents: [], members: [ROSTER[3], ROSTER[2]], q: '책임', me: 'phmin', viewing: '' });
  assert.deepStrictEqual(md.results.map((r) => r.loginId), ['ihyoon', 'b1'], '열 수 있는 사람이 먼저 오지 않았다(명부 순서는 범위 밖이 먼저)');
  md = pkModel({ favs: [], recents: [], members: ROSTER, q: 'WBLEE', me: 'phmin', viewing: 'wblee' });
  assert.deepStrictEqual(md.results.map((r) => [r.loginId, r.viewing]), [['wblee', true]], '대소문자 무시·보는 중 표시가 안 된다');
  //  명부를 못 읽었으면(members=null) 저장된 이름으로 누를 수 있다 · 읽었는데 없으면 gone
  md = pkModel({ favs: [{ loginId: 'gone1', name: '퇴사자' }], recents: [], members: null, q: '', me: 'phmin', viewing: '' });
  assert.deepStrictEqual([md.fav[0].gone, md.fav[0].canView, md.fav[0].name], [false, true, '퇴사자']);
  md = pkModel({ favs: [{ loginId: 'gone1', name: '퇴사자' }], recents: [], members: ROSTER, q: '', me: 'phmin', viewing: '' });
  assert.deepStrictEqual([md.fav[0].gone, md.fav[0].canView], [true, false]);
});

test('(변이) K7: 최근에서 즐겨찾기를 빼는 줄을 지우면 (순수) pkModel 판정이 잡는다', () => {
  const bad = mutate(app, 'if(x.loginId === me || favIds.has(x.loginId)) continue;', 'if(x.loginId === me) continue;');
  const pkModel = modelFn(bad);
  const md = pkModel({ favs: [{ loginId: 'wblee', name: '이웅빈' }], recents: [{ loginId: 'wblee', name: '이웅빈' }], members: ROSTER, q: '', me: 'phmin', viewing: '' });
  assert.deepStrictEqual(md.recent.map((r) => r.loginId), ['wblee'], '전제: 변이가 두 줄을 만든다');
  assert.throws(() => assert.deepStrictEqual(md.recent.map((r) => r.loginId), [], '두 줄'), /두 줄/);
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('peer-picker: jsdom 미설치 — 팝오버·최근·즐겨찾기·바꾸기 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const ME = { loginId: 'phmin', name: '박현민', title: '수석연구원', orgUnit: 'SW 3팀' };
  //  기본 과제(휴가, 기타)는 서버에 이미 있는 것으로 둔다. 없으면 부팅 보장(DEFAULT-TASKS §3)이 저장(saveState)을 한 번
  //  보내서, 이 파일이 세는 「보낸 명령」에 섞인다(이 파일의 관심사가 아니다). 보장 자체는 tests/default-tasks.test.mjs 가 본다.
  const EMPTY = { categories: [{ id: 'c-vac', name: '휴가', color: '#2e9e6b' }, { id: 'c-etc', name: '기타', color: '#5b6b7d' }],
    entries: [], todos: [], rooms: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '' };
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  function boot(src, url = 'https://tcapp.local/') {
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
      },
    });
    const w = dom.window;
    const B = {
      w, posted, errors, doc: w.document,
      ev: (c) => w.eval(c),
      evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      close: () => { try { w.close(); } catch (_) {} },
    };
    if (url.includes('peer=1')) return B;
    //  호스트 회신 가로채기 — 명령별 회신표(__rep): 객체 = 그 회신 · 'pending' = 영영 안 옴 · 'fail' = {ok:false}.
    w.eval(`window.__calls = []; window.__rep = {};
      hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
        var r = __rep[cmd];
        if(r === 'pending') return new Promise(function(){});
        if(r === undefined || r === 'fail') return Promise.resolve({ ok:false, msg:'시험: 회신 없음' });
        return Promise.resolve(JSON.parse(JSON.stringify(r))); };`);
    //  열람 창(?peerwin=1)은 세션을 묻지도 내 달력을 받지도 않는다. 대상과 내 신원(me)은 호스트가 __peerWinOpen 으로 넘긴다(openPeer).
    if (url.includes('peerwin=1')) return B;
    //  부팅의 세션 조회에 답한다(안 답하면 10초 뒤 로그인 게이트가 다시 덮는다) → 로그인 상태 · 빈 캘린더 주입.
    const sess = posted.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).find((m) => m && m.cmd === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: ME }) + ')');
    //  ★ 회신의 applyUser 는 bootUserSession 의 await 뒤(마이크로태스크)에 돈다 — 부팅 직후 동기로 조작하는 시험(변이)을 위해 지금 세운다.
    w.eval('currentUser = ' + JSON.stringify(ME));
    w.__applyState(JSON.stringify(EMPTY), {});
    return B;
  }
  const membersOk = (members = ROSTER) => ({ ok: true, data: { found: true, scope: 'all', myUnit: 'SW 3팀', units: UNITS, members } });
  //  조직 트리 — 뿌리 하나(회사) 밑에 전부: 구성원 보기의 기본 선택(뿌리)이 전원을 보이게.
  const UNITS = ['SW 1팀', 'SW 2팀', 'SW 3팀', '시스템 1팀', '시험팀'].map((name, i) => ({ name, parent: '회사', sortOrder: i + 1 }))
    .concat([{ name: '회사', parent: null, sortOrder: 0 }]);
  const PEER_OK = { ok: true, allowed: true, categories: [], entries: [], todos: [] };

  // ── 공용 조작 ─────────────────────────────────────────────────────
  //  jsdom 은 iframe 을 불러오지 않는다 → 열람 프레임의 두 함수를 대신 세우고 load 를 쏜다(부모 쪽 계약만 본다).
  async function landFrame(B, view = null) {
    await settle();
    const r = B.ev(`(function(){ var f = document.querySelector('#pvHost iframe'); if(!f) return 'noframe';
      var w = f.contentWindow; w.__metaSeen = null;
      w.__applyState = function(j, meta){ w.__metaSeen = JSON.stringify(meta); };
      w.peerViewNow = function(){ return ${JSON.stringify(view)}; };
      f.dispatchEvent(new Event('load')); return 'ok'; })()`);
    await settle();
    return r;
  }
  const frameMeta = (B) => JSON.parse(B.ev(`(function(){ var f = document.querySelector('#pvHost iframe'); return (f && f.contentWindow.__metaSeen) || 'null'; })()`));
  const keyF = (id = ME.loginId) => 'tc_peerFav:' + id, keyR = (id = ME.loginId) => 'tc_peerRecent:' + id;
  const getLS = (B, k) => B.w.localStorage.getItem(k);
  const setLS = (B, k, v) => (v === null ? B.w.localStorage.removeItem(k) : B.w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
  const list = (B, k) => JSON.parse(getLS(B, k) || '[]').map((x) => x.loginId);
  const calls = (B, cmd) => JSON.parse(B.ev('JSON.stringify(__calls)')).filter((c) => !cmd || c[0] === cmd);
  const pop = (B) => B.doc.getElementById('peerPicker');
  const isOpen = (B) => !!pop(B) && !pop(B).classList.contains('hidden');
  const active = (B) => { const a = B.doc.activeElement; return a ? (a.id || (a.className + ':' + (a.dataset.login || ''))) : ''; };
  const sec = (B, s) => [...B.doc.querySelectorAll(`#pkBody [data-sec="${s}"] .pk-row`)].map((r) => {
    const o = r.querySelector('.pk-open'), st = r.querySelector('.pk-star'), x = r.querySelector('.pk-del');
    return { id: o.dataset.login, text: o.textContent.replace(/\s+/g, ' ').trim(), off: o.getAttribute('aria-disabled') === 'true', tip: o.title,
             star: st ? st.getAttribute('aria-pressed') + ':' + st.textContent : null, del: !!x };
  });
  const notes = (B) => [...B.doc.querySelectorAll('#pkBody .pk-note')].map((n) => n.textContent);
  const openBtn = (B, id) => [...B.doc.querySelectorAll('#pkBody .pk-open')].find((b) => b.dataset.login === id);
  const starBtn = (B, id) => [...B.doc.querySelectorAll('#pkBody .pk-star')].find((b) => b.dataset.login === id);
  const key = (B, el, k) => el.dispatchEvent(new B.w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const type = (B, v) => { const i = B.doc.getElementById('pkSearch'); i.value = v; i.dispatchEvent(new B.w.Event('input', { bubbles: true })); };
  const PW_URL = 'https://tcapp.local/?peerwin=1';
  //  열람 창 껍데기가 펴져 있는가(?peerwin=1 에서만 펴진다 · 닫기는 OS 창이 맡으므로 웹이 접을 일이 없다).
  const pvOpen = (X) => !X.doc.getElementById('peerWin').classList.contains('hidden');
  //  내 창이 호스트에 보낸 열람 창 열기(peerOpen)의 대상들.
  const peerOpens = (X) => X.posted.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } })
    .filter((m) => m && m.cmd === 'peerOpen').map((m) => m.loginId);
  //  다음 시험을 위해 깨끗이 — 팝오버·모달을 닫고(페이드 없이) 저장 키·호출 기록·회신표를 비운다.
  async function reset(B) {
    B.ev(`(function(){ try{ if(__pk) pkClose(false); }catch(_){}
      document.querySelectorAll('.overlay').forEach(function(o){ o.classList.remove('closing'); o.classList.add('hidden'); });
      __calls.length = 0; __rep = {}; currentUser = ${JSON.stringify(ME)}; return 1; })()`);
    for (const k of Object.keys(B.w.localStorage)) if (/^tc_peer(Fav|Recent):/.test(k)) B.w.localStorage.removeItem(k);
    B.posted.length = 0;
    await settle();
  }
  async function openTop(B, rep = membersOk()) {
    B.ev('__rep.membersGet = ' + JSON.stringify(rep));
    B.doc.getElementById('btnPeerPick').click();
    await settle();
  }
  //  열람 창(V)을 「그 사람」으로 열고 프레임까지 띄운다(성공 경로). 호스트가 하는 그대로 __peerWinOpen 으로 넘긴다.
  async function openPeer(X, id, name, view = null) {
    X.ev('__rep.peerSchedule = ' + JSON.stringify(PEER_OK));
    X.ev(`__peerWinOpen(${JSON.stringify({ loginId: id, name, me: ME })})`);
    return landFrame(X, view);
  }

  let B = null, V = null;
  test('(R) 부팅: 내 창(HOST · 로그인 phmin)이 오류 없이 뜨고 열린 모달이 없다 · 열람 창(?peerwin=1)도 오류 없이 뜬다', () => {
    B = boot(app);
    V = boot(app, PW_URL);
    assert.strictEqual(V.ev('PEERWIN'), true);
    assert.ok(pvOpen(V), '열람 창에서 껍데기가 펴지지 않았다');
    assert.ok(!pvOpen(B), '내 창에서 열람 껍데기가 보인다');
    assert.deepStrictEqual(V.errors, [], '열람 창 부팅 중 페이지 오류');
    assert.strictEqual(B.ev('HOST'), true);
    assert.strictEqual(B.ev('currentUser && currentUser.loginId'), 'phmin');
    assert.deepStrictEqual(B.ev('openOverlays().map(function(o){return o.id;}).join(",")'), '', '부팅 뒤 열린 모달이 있다 — 팝오버 시험의 전제가 깨진다');
    assert.deepStrictEqual(B.errors, [], '부팅 중 페이지 오류');
  });

  // ── R1 ──
  test('(R1) 입구: 내 창에는 👥 버튼(라벨 「다른 사람 일정」 · aria-label 보존)과 ⋯ 접기 항목이 있다 · 열람 창(PEER)에는 둘 다 없다', () => {
    const b = B.doc.getElementById('btnPeerPick');
    assert.ok(b, '내 창에 입구가 없다');
    assert.strictEqual(b.getAttribute('aria-label'), '다른 사람 일정');
    assert.strictEqual((b.querySelector('.btn-label') || {}).textContent, '다른 사람 일정', '라벨 span 이 없다(넓은 폭에서 글자가 안 보인다)');
    assert.ok(b.querySelector('svg.ic'), '단색 아이콘으로 바뀌지 않았다');
    assert.ok(B.doc.getElementById('btnPeerPickFold'), '⋯ 접기 항목이 없다');
    const P = boot(app, 'https://tcapp.local/?peer=1');
    try {
      assert.strictEqual(P.ev('PEER'), true);
      assert.strictEqual(P.doc.getElementById('btnPeerPick'), null, '열람 창 안에 👥 입구가 있다');
      assert.strictEqual(P.doc.getElementById('btnPeerPickFold'), null, '열람 창 ⋯ 메뉴에 접기 항목이 있다');
      P.ev("pkOpen('top', document.body)");
      assert.strictEqual(P.doc.getElementById('peerPicker'), null, '열람 창에서 팝오버가 만들어졌다');
      assert.strictEqual(P.ev('JSON.stringify(peerViewNow())') !== 'null', true, '전제: PEER 에서는 peerViewNow 가 값을 준다');
      assert.strictEqual(B.ev('peerViewNow()'), null, '내 창에서 peerViewNow 가 값을 준다 — 열람 창 전용이다');
    } finally { P.close(); }
  });

  // ── R2 ──
  test('(R2) 팝오버: 누르면 열리고(role=dialog · aria-label · aria-expanded) 검색 칸에 포커스 · 명부를 membersGet 으로 읽는다', async () => {
    await reset(B);
    await openTop(B);
    const p = pop(B);
    assert.ok(isOpen(B), '팝오버가 열리지 않았다');
    assert.strictEqual(p.getAttribute('role'), 'dialog');
    assert.ok(/사람 고르기/.test(p.getAttribute('aria-label') || ''));
    assert.ok(!p.hasAttribute('aria-modal'), '모달이 아니다 — aria-modal 을 달지 않는다');
    assert.ok(!B.doc.querySelector('#peerPicker').closest('.overlay'), '툴바 팝오버가 오버레이 안에 있다');
    assert.strictEqual(B.doc.getElementById('btnPeerPick').getAttribute('aria-expanded'), 'true');
    assert.strictEqual(active(B), 'pkSearch', '열리면 검색 칸에 포커스가 가야 한다');
    assert.deepStrictEqual(calls(B, 'membersGet'), [['membersGet', { includeInactive: false }]]);
    assert.deepStrictEqual(calls(B).map((c) => c[0]), ['membersGet'], '명부 말고 다른 명령을 보냈다');
  });

  test('(R2) 검색: 이름·직급·조직 부분 일치(대소문자·공백 무시) · 한 줄에 이름 · 직급 + 조직 · 나 자신 없음', async () => {
    type(B, '이 웅');
    let r = sec(B, 'Result');
    assert.deepStrictEqual(r.map((x) => x.id), ['wblee']);
    assert.ok(/이웅빈 선임/.test(r[0].text) && /SW 2팀/.test(r[0].text), r[0].text);
    assert.strictEqual(r[0].star, 'false:☆');
    type(B, 'sw 1');
    assert.deepStrictEqual(sec(B, 'Result').map((x) => x.id), ['ihyoon'], '조직으로 못 찾는다');
    type(B, '수석연구원');
    assert.deepStrictEqual(sec(B, 'Result'), [], '나 자신(박현민 · 수석연구원)이 결과에 있다');
    assert.ok(notes(B).includes('검색 결과가 없습니다'), notes(B).join('|'));
    type(B, '박현민');
    assert.ok(!B.doc.querySelector('#pkBody .pk-open[data-login="phmin"]'), '나 자신이 목록에 있다');
  });

  test('(R2) 20행 제한: 30명이 맞으면 20행 + 「10명 더 — 이름을 더 입력하세요」', () => {
    type(B, '시험팀');
    assert.strictEqual(sec(B, 'Result').length, 20);
    assert.ok(notes(B).includes('10명 더 있습니다. 이름을 더 입력하세요'), notes(B).join('|'));
  });

  test('(R2) 범위 밖: 회색(aria-disabled) · 툴팁 「일정 열람 범위 밖입니다」 · 눌러도 무반응(조회 0 · 팝오버 그대로)', async () => {
    type(B, '차은우');
    const [r] = sec(B, 'Result');
    assert.ok(r && r.off, '범위 밖 행이 회색이 아니다');
    assert.strictEqual(r.tip, '일정 열람 범위 밖입니다');
    B.ev('__calls.length = 0');
    openBtn(B, 'b1').click();
    await settle();
    assert.deepStrictEqual(calls(B), [], '범위 밖 행을 눌렀더니 조회가 나갔다');
    assert.ok(isOpen(B), '범위 밖 행을 눌렀더니 팝오버가 닫혔다');
    //  Enter(첫 열 수 있는 행)도 회색만 있으면 아무것도 안 연다
    key(B, B.doc.getElementById('pkSearch'), 'Enter');
    await settle();
    assert.deepStrictEqual(calls(B), [], '회색 행만 있는데 Enter 로 열었다');
  });

  test('(R2) 닫기: Esc → 닫히고 입구로 포커스 · 바깥 pointerdown → 닫힘 · 입구 다시 누르기 → 토글로 닫힘', async () => {
    key(B, B.doc.getElementById('pkSearch'), 'Escape');
    assert.ok(!isOpen(B), 'Esc 로 닫히지 않았다');
    assert.strictEqual(active(B), 'btnPeerPick', 'Esc 뒤 포커스가 입구로 돌아오지 않았다');
    assert.strictEqual(B.doc.getElementById('btnPeerPick').getAttribute('aria-expanded'), 'false');
    await openTop(B);
    B.doc.getElementById('grid').dispatchEvent(new B.w.Event('pointerdown', { bubbles: true }));
    assert.ok(!isOpen(B), '바깥을 눌렀는데 닫히지 않았다');
    await openTop(B);
    B.doc.getElementById('pkSearch').dispatchEvent(new B.w.Event('pointerdown', { bubbles: true }));
    assert.ok(isOpen(B), '팝오버 안을 눌렀는데 닫혔다');
    B.doc.getElementById('btnPeerPick').click();
    assert.ok(!isOpen(B), '입구를 다시 눌렀는데 닫히지 않았다(토글)');
  });

  test('(R2) 명부는 열 때마다 새로 읽는다(캐시 없음) · 읽는 중엔 「불러오는 중…」', async () => {
    await reset(B);
    await openTop(B, 'pending');
    assert.ok(notes(B).includes('불러오는 중…'), notes(B).join('|'));
    B.ev('pkClose(false)');
    await openTop(B);
    await openTop(B);   // 토글로 닫힘
    await openTop(B);
    assert.strictEqual(calls(B, 'membersGet').length, 3, '다시 열었는데 명부를 다시 읽지 않았다');
  });

  // ── R3 ──
  test('(R3) 명부 실패: 「명부를 불러오지 못했습니다 · 다시 시도」 — 그래도 즐겨찾기·최근은 저장된 이름으로 보이고 열린다', async () => {
    await reset(B);
    setLS(B, keyF(), [{ loginId: 'wblee', name: '이웅빈' }]);
    setLS(B, keyR(), [{ loginId: 'ihyoon', name: '윤인환' }]);
    await openTop(B, 'fail');
    assert.ok(notes(B).some((t) => /^명부를 불러오지 못했습니다/.test(t) && /다시 시도/.test(t)), notes(B).join('|'));
    assert.ok(B.doc.querySelector('#pkBody [data-act="retry"]'), '다시 시도 버튼이 없다');
    const f = sec(B, 'Fav'), r = sec(B, 'Recent');
    assert.deepStrictEqual([f.map((x) => [x.id, x.off]), r.map((x) => [x.id, x.off])], [[['wblee', false]], [['ihyoon', false]]],
      '명부를 못 읽었다고 즐겨찾기·최근을 감추거나 회색으로 만들었다');
    assert.ok(/이웅빈/.test(f[0].text), '저장된 이름이 안 보인다');
    //  다시 시도 → 성공
    B.ev('__rep.membersGet = ' + JSON.stringify(membersOk()));
    B.doc.querySelector('#pkBody [data-act="retry"]').click();
    await settle();
    assert.strictEqual(calls(B, 'membersGet').length, 2);
    assert.ok(!notes(B).some((t) => /불러오지 못했습니다/.test(t)), '다시 시도 성공 뒤에도 실패 문구가 남았다');
    //  실패 상태에서도 연다(권한은 호스트가 다시 따진다)
    B.ev("__rep.membersGet = 'fail'");
    B.doc.querySelector('#pkBody [data-act="retry"]') || B.ev('pkLoad()');
    await settle();
    openBtn(B, 'ihyoon').click();
    await settle();
    assert.ok(!isOpen(B), '고르면 팝오버가 닫혀야 한다');
    assert.deepStrictEqual(peerOpens(B), ['ihyoon'], '호스트에 열람 창을 열라고(peerOpen) 보내지 않았다');
    assert.deepStrictEqual(calls(B, 'peerSchedule'), [], '내 창이 남의 일정을 직접 조회했다(조회는 열람 창이 한다)');
    assert.ok(!pvOpen(B), '내 창 안에 열람 화면이 펴졌다');
  });

  // ── R4 ──
  test('(R4) 최근: 성공한 열람만 · 맨 앞 · 중복은 앞으로 · 5명 — 실패·권한 없음·뜨기 전 닫힘은 넣지 않는다', async () => {
    await reset(V);
    await openPeer(V, 'wblee', '이웅빈');
    assert.deepStrictEqual(list(V, keyR()), ['wblee']);
    assert.ok(/\{"peerName":"이웅빈","canWrite":false,"view":null\}/.test(JSON.stringify(frameMeta(V))), JSON.stringify(frameMeta(V)));
    await openPeer(V, 'ihyoon', '윤인환');
    await openPeer(V, 'wblee', '이웅빈');
    assert.deepStrictEqual(list(V, keyR()), ['wblee', 'ihyoon'], '중복을 앞으로 당기지 않았다');
    for (let i = 0; i < 5; i++) await openPeer(V, 'g0' + i, '김시험0' + i);
    assert.deepStrictEqual(list(V, keyR()), ['g04', 'g03', 'g02', 'g01', 'g00'], '5명으로 자르지 않았다(최신이 맨 앞)');
    //  실패 · 권한 없음
    const before = getLS(V, keyR());
    V.ev("__rep.peerSchedule = {ok:false, error:'통신 실패'}; openPeerSchedule('b1', '차은우')");
    await settle();
    V.ev("__rep.peerSchedule = {ok:true, allowed:false}; openPeerSchedule('b1', '차은우')");
    await settle();
    assert.ok(/권한이 없습니다/.test(V.doc.getElementById('pvHost').textContent), '전제: 권한 없음 안내');
    assert.strictEqual(getLS(V, keyR()), before, '실패·권한 없음이 최근에 들어갔다');
    //  뜨기 전에 다른 사람으로 바뀜 — 프레임은 생겼지만 주입 전 → 넣지 않는다
    V.ev('__rep.peerSchedule = ' + JSON.stringify(PEER_OK) + "; openPeerSchedule('ihyoon', '윤인환')");
    await settle();
    const stale = V.ev("(function(){ var f = document.querySelector('#pvHost iframe'); if(!f) return 0; f.contentWindow.__applyState = function(){}; closePeerFrame(); f.dispatchEvent(new Event('load')); return 1; })()");
    assert.strictEqual(stale, 1, '전제: 프레임이 생겼다');
    assert.strictEqual(getLS(V, keyR()), before, '주입 전에 닫았는데(늦게 온 load) 최근에 들어갔다');
  });

  test('(R4) 「구성원 보기」에서 연 것도 최근에 남는다(입구와 무관) · 즐겨찾기에 있는 사람은 최근에 두 줄로 안 나온다', async () => {
    await reset(B); await reset(V);
    B.ev('__rep.membersGet = ' + JSON.stringify(membersOk()));
    await B.ev('openMembers()');
    const row = B.doc.querySelector('#mbList .mb-row.is-link[data-login="ihyoon"]');
    assert.ok(row, '전제: 구성원 보기에 윤인환 행');
    row.click();
    assert.deepStrictEqual(peerOpens(B), ['ihyoon'], '구성원 보기 행이 열람 창 열기(peerOpen)를 보내지 않았다');
    //  호스트가 하는 일: 그 대상을 열람 창에 넘긴다 → 최근은 열람 창의 주입 성공 자리에서 남는다(입구와 무관)
    const sent = B.posted.map((s) => JSON.parse(s)).find((m) => m.cmd === 'peerOpen');
    await openPeer(V, sent.loginId, sent.name);
    assert.deepStrictEqual(list(V, keyR()), ['ihyoon'], '구성원 보기에서 연 사람이 최근에 없다');
    B.ev("closeModal('#membersModal')");
    await reset(B);
    setLS(B, keyF(), [{ loginId: 'wblee', name: '이웅빈' }]);
    setLS(B, keyR(), [{ loginId: 'wblee', name: '이웅빈' }, { loginId: 'ihyoon', name: '윤인환' }]);
    await openTop(B);
    assert.deepStrictEqual(sec(B, 'Fav').map((x) => x.id), ['wblee']);
    assert.deepStrictEqual(sec(B, 'Recent').map((x) => x.id), ['ihyoon'], '즐겨찾기에 있는 사람이 최근에도 나왔다');
    assert.strictEqual(B.doc.querySelectorAll('#pkBody .pk-open[data-login="wblee"]').length, 1, '같은 사람이 두 줄');
  });

  // ── R5 ──
  test('(R5) 즐겨찾기: ☆ → ★(aria-pressed) · 다시 누르면 해제 · 추가한 순서대로', async () => {
    await reset(B);
    await openTop(B);
    type(B, 'SW');
    //  사람이 누르면 버튼이 포커스를 받는다(크로뮴) — jsdom 의 .click() 은 포커스를 옮기지 않으므로 먼저 준다.
    starBtn(B, 'ihyoon').focus(); starBtn(B, 'ihyoon').click();
    assert.deepStrictEqual(list(B, keyF()), ['ihyoon']);
    assert.strictEqual(starBtn(B, 'ihyoon').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(starBtn(B, 'ihyoon').textContent, '★');
    assert.ok(/즐겨찾기에서 빼기/.test(starBtn(B, 'ihyoon').getAttribute('aria-label')));
    assert.strictEqual(B.doc.activeElement, starBtn(B, 'ihyoon'), '다시 그린 뒤 포커스가 같은 ☆ 버튼으로 돌아오지 않았다');
    starBtn(B, 'wblee').click();
    assert.deepStrictEqual(list(B, keyF()), ['ihyoon', 'wblee'], '추가한 순서가 아니다');
    type(B, '');
    assert.deepStrictEqual(sec(B, 'Fav').map((x) => x.id), ['ihyoon', 'wblee'], '표시 순서가 추가 순서가 아니다');
    starBtn(B, 'ihyoon').click();
    assert.deepStrictEqual(list(B, keyF()), ['wblee'], '다시 눌렀는데 해제되지 않았다');
  });

  test('(R5) 20명 제한: 21번째는 넣지 않고 「즐겨찾기는 20명까지입니다」', async () => {
    await reset(B);
    setLS(B, keyF(), Array.from({ length: 20 }, (_, i) => ({ loginId: 'g' + String(i).padStart(2, '0'), name: '김시험' + i })));
    await openTop(B);
    type(B, '이웅빈');
    starBtn(B, 'wblee').click();
    assert.strictEqual(list(B, keyF()).length, 20);
    assert.ok(!list(B, keyF()).includes('wblee'), '21번째가 들어갔다');
    assert.ok(/즐겨찾기는 20명까지입니다/.test(B.doc.getElementById('toastStack').textContent), '20명 안내가 없다');
    assert.strictEqual(starBtn(B, 'wblee').getAttribute('aria-pressed'), 'false');
  });

  test('(R5) 계정별 키(tc_peerFav:<내 login_id>) — 다른 계정이면 따로 · 깨진 값은 빈 목록(오류 없이 그린다)', async () => {
    await reset(B);
    setLS(B, keyF(), [{ loginId: 'wblee', name: '이웅빈' }]);
    B.ev("currentUser = {loginId:'hjlee', name:'이현진', title:'', orgUnit:''}");
    await openTop(B);
    assert.deepStrictEqual(sec(B, 'Fav'), [], '다른 계정에 내 즐겨찾기가 보인다');
    starBtn(B, 'wblee') || type(B, '윤인');
    starBtn(B, 'ihyoon').click();
    assert.deepStrictEqual(list(B, keyF('hjlee')), ['ihyoon'], '다른 계정의 키에 쓰지 않았다');
    assert.deepStrictEqual(list(B, keyF()), ['wblee'], '다른 계정의 조작이 내 목록을 바꿨다');
    B.ev('pkClose(false)');
    B.ev(`currentUser = ${JSON.stringify(ME)}`);
    for (const bad of ['{bad', '{"a":1}', '"x"']) {
      setLS(B, keyF(), bad); setLS(B, keyR(), bad);
      await openTop(B);
      assert.deepStrictEqual([sec(B, 'Fav'), sec(B, 'Recent')], [[], []], '깨진 값에서 행이 나왔다: ' + bad);
      B.ev('pkClose(false)');
    }
    assert.deepStrictEqual(B.errors, [], '깨진 값에서 페이지 오류');
  });

  // ── R6 ──
  test('(R6) 명부에 없는 사람(퇴사 등)과 최근 본 사람 지우기: 재직 중인 최근 행에도 ✕ · 전체 지우기 단추 · 포커스는 검색 칸으로', async () => {
    await reset(B);
    setLS(B, keyF(), [{ loginId: 'gone1', name: '퇴사자' }, { loginId: 'wblee', name: '이웅빈' }]);
    setLS(B, keyR(), [{ loginId: 'gone2', name: '전출자' }, { loginId: 'ihyoon', name: '윤인환' }, { loginId: 'g00', name: '김시험00' }]);
    await openTop(B);
    const f = sec(B, 'Fav'), r = sec(B, 'Recent');
    assert.deepStrictEqual(f.map((x) => [x.id, x.off, x.star, x.del]), [['gone1', true, null, true], ['wblee', false, 'true:★', false]]);
    assert.ok(/퇴사자 \(명부에 없음\)/.test(f[0].text), f[0].text);
    assert.deepStrictEqual(r.map((x) => [x.id, x.off, x.star, x.del]), [
      ['gone2', true, null, true],
      ['ihyoon', false, 'false:☆', true],
      ['g00', false, 'false:☆', true],
    ], '최근 본 사람 행에는 재직자도 ☆ 와 ✕ 가 함께 있어야 한다');
    const clrBtn = B.doc.querySelector('#pkBody [data-act="clear-recent"]');
    assert.ok(clrBtn && clrBtn.textContent === '전체 지우기', '최근 본 사람 머리말에 전체 지우기 단추가 없다');
    B.ev('__calls.length = 0');
    openBtn(B, 'gone1').click();
    assert.deepStrictEqual(calls(B), [], '명부에 없는 사람을 눌렀더니 조회가 나갔다');
    B.doc.querySelector('#pkBody [data-act="forget"][data-login="gone1"]').click();
    assert.deepStrictEqual(list(B, keyF()), ['wblee']);
    B.doc.querySelector('#pkBody [data-act="forget"][data-login="gone2"]').click();
    assert.deepStrictEqual(list(B, keyR()), ['ihyoon', 'g00']);
    //  재직 중인 최근 본 사람도 ✕ 로 지운다
    B.doc.querySelector('#pkBody [data-act="forget"][data-login="ihyoon"]').click();
    assert.deepStrictEqual(list(B, keyR()), ['g00']);
    assert.deepStrictEqual(sec(B, 'Recent').map((x) => x.id), ['g00']);
    //  전체 지우기로 남은 최근 목록을 한 번에 비운다
    B.doc.querySelector('#pkBody [data-act="clear-recent"]').click();
    assert.deepStrictEqual(list(B, keyR()), []);
    assert.deepStrictEqual(sec(B, 'Recent'), []);
    assert.strictEqual(active(B), 'pkSearch', '✕/전체 지우기 뒤 포커스가 사라졌다');
  });

  // ── R7 ──
  test('(R7) 열람 창 ▾ 바꾸기: 같은 팝오버가 제목 아래(열람 창 머리 줄)에 뜨고 지금 보는 사람은 「· 보는 중」 · 누를 수 없음', async () => {
    await reset(V);
    setLS(V, keyR(), [{ loginId: 'ihyoon', name: '윤인환' }]);
    await openPeer(V, 'wblee', '이웅빈', { y: 2026, m: 5, sel: '2026-06-11' });
    V.ev('__rep.membersGet = ' + JSON.stringify(membersOk()));
    V.doc.getElementById('pvSwitch').click();
    await settle();
    assert.ok(isOpen(V) && pop(V).parentElement === V.doc.querySelector('#peerWin .modal-head'), '팝오버가 열람 창 머리 줄 아래에 뜨지 않았다');
    assert.ok(pop(V).classList.contains('pk-in'));
    assert.strictEqual(V.doc.getElementById('pvSwitch').getAttribute('aria-expanded'), 'true');
    assert.strictEqual(active(V), 'pkSearch');
    //  ★ 2026-10-02 실 위젯 실측 — 팝오버에 inert·aria-hidden 이 남으면 검색 칸이 포커스를 못 받는다(jsdom 은 inert 를 따르지 않는다 → 속성을 직접 본다).
    assert.ok(!pop(V).hasAttribute('inert') && !pop(V).hasAttribute('aria-hidden'), '머리 줄 팝오버에 inert/aria-hidden 이 남았다 — 실 위젯에서 검색 칸이 포커스를 못 받는다');
    const rec = sec(V, 'Recent');
    assert.deepStrictEqual(rec.map((x) => x.id), ['wblee', 'ihyoon'], '최근 목록(방금 연 이웅빈 + 윤인환)');
    assert.ok(rec[0].off && /이웅빈 선임 \(보는 중\)/.test(rec[0].text) && rec[0].tip === '지금 보고 있는 사람입니다', JSON.stringify(rec[0]));
    V.ev('__calls.length = 0');
    openBtn(V, 'wblee').click();
    assert.deepStrictEqual(calls(V), [], '보는 중인 사람을 다시 열었다');
    //  Esc — 팝오버만 닫고 열람 껍데기는 그대로 · 포커스는 ▾ 로
    key(V, V.doc.getElementById('pkSearch'), 'Escape');
    assert.ok(!isOpen(V), 'Esc 로 팝오버가 닫히지 않았다');
    assert.ok(pvOpen(V), 'Esc 가 열람 화면을 접었다 — 팝오버만 닫아야 한다');
    assert.strictEqual(active(V), 'pvSwitch');
    assert.strictEqual(pop(V).parentElement, V.doc.body, '닫힌 팝오버가 열람 창 머리 줄에 남았다(다음에 열 때 숨은 검색 칸이 포커스를 집는다)');
    assert.ok(!pop(V).hasAttribute('inert'), '열람 창에는 모달이 없는데 body 로 돌아온 팝오버가 inert 다(다음에 열 때 포커스를 못 받는다)');
  });

  test('(R7) 바꾸기: 창을 닫지 않고 그 자리에서 다른 사람으로 — 새 프레임 · 보던 달(meta.view) 잇기 · 최근 앞으로 · 문서 제목(창 제목)도 바뀐다', async () => {
    V.doc.getElementById('pvSwitch').click();
    await settle();
    V.ev('__rep.peerSchedule = ' + JSON.stringify(PEER_OK) + '; __calls.length = 0');
    const oldFrame = V.doc.querySelector('#pvHost iframe');
    openBtn(V, 'ihyoon').click();
    assert.ok(pvOpen(V), '사람을 바꾸는데 열람 화면이 접혔다');
    assert.ok(!isOpen(V), '고르면 팝오버는 닫혀야 한다');
    assert.strictEqual(V.doc.getElementById('pvTitle').textContent, '윤인환 님의 일정');
    assert.strictEqual(V.doc.title, '윤인환 님의 일정', '문서 제목이 안 바뀌었다(호스트가 창 제목으로 쓴다)');
    assert.deepStrictEqual(calls(V, 'peerSchedule').map((c) => c[1].loginId), ['ihyoon']);
    assert.deepStrictEqual(peerOpens(V), [], '열람 창 안의 바꾸기가 호스트에 창 열기를 보냈다(그 자리에서 바꿔야 한다)');
    assert.strictEqual(active(V), 'pvSwitch', '바꾼 뒤 포커스가 ▾ 로 돌아오지 않았다');
    await landFrame(V);
    const frames = V.doc.querySelectorAll('#pvHost iframe');
    assert.strictEqual(frames.length, 1); assert.notStrictEqual(frames[0], oldFrame, '프레임을 새로 만들지 않았다');
    assert.ok(!V.doc.body.contains(oldFrame), '옛 프레임이 남았다');
    assert.deepStrictEqual(frameMeta(V).view, { y: 2026, m: 5, sel: '2026-06-11' }, '보던 달을 새 프레임에 넘기지 않았다');
    assert.strictEqual(frameMeta(V).peerName, '윤인환');
    assert.deepStrictEqual(list(V, keyR()), ['ihyoon', 'wblee']);
    //  메인 창(툴바·구성원 보기)에서 다른 사람을 새로 열 때는 잇지 않는다(그 사람의 첫 달 = 오늘)
    await openPeer(V, 'g01', '김시험01');
    assert.strictEqual(frameMeta(V).view, null, '바꾸기가 아닌데 달을 이었다');
    //  같은 사람을 메인 창에서 다시 고르면 보던 달을 잇는다(다시 읽어 권한도 새로 판정한다)
    await openPeer(V, 'g01', '김시험01', { y: 2026, m: 1, sel: '2026-02-03' });
    await openPeer(V, 'g01', '김시험01');
    assert.deepStrictEqual(frameMeta(V).view, { y: 2026, m: 1, sel: '2026-02-03' }, '같은 사람을 다시 열었는데 보던 달을 잃었다');
  });

  test('(R7) 프레임 쪽: meta.view 를 받으면 그 달로 그린다(보기 방식·밀도는 저장값 그대로) · 이상값은 무시', () => {
    const P = boot(app, 'https://tcapp.local/?peer=1');
    try {
      P.w.localStorage.setItem('tc_peerLayout', 'side'); P.w.localStorage.setItem('tc_peerDensity', 'dense');
      const today = P.evJSON('view');
      P.w.__applyState(JSON.stringify(EMPTY), { peerName: '윤인환', canWrite: false, view: { y: 2025, m: 13, sel: 'x' } });
      assert.deepStrictEqual(P.evJSON('view'), today, '이상한 달(m=13)을 받아들였다');
      P.w.__applyState(JSON.stringify(EMPTY), { peerName: '윤인환', canWrite: false, view: { y: 2026, m: 5, sel: '2026-06-11' } });
      assert.deepStrictEqual(P.evJSON('view'), { y: 2026, m: 5 });
      assert.strictEqual(P.ev('selectedDate'), '2026-06-11');
      assert.ok(/2026/.test(P.doc.getElementById('btnTitle').textContent) && /6월/.test(P.doc.getElementById('btnTitle').textContent),
        '달 제목이 6월이 아니다: ' + P.doc.getElementById('btnTitle').textContent);
      assert.ok(P.doc.querySelector('#grid .cell[data-date="2026-06-11"]'), '격자가 그 달로 그려지지 않았다');
      assert.strictEqual(P.doc.body.dataset.peerLayout, 'side', '보기 방식(저장값)이 이어지지 않았다');
      assert.strictEqual(P.ev('calDensity()'), 'dense', '밀도(저장값)가 이어지지 않았다');
      assert.deepStrictEqual(P.evJSON('peerViewNow()'), { y: 2026, m: 5, sel: '2026-06-11' });
      P.w.__applyState(JSON.stringify(EMPTY), { peerName: '윤인환', canWrite: false, view: { y: 2026, m: 7, sel: '2026-06-11' } });
      assert.strictEqual(P.ev('selectedDate'), '2026-08-01', '다른 달의 날을 그대로 이었다(격자와 상세가 다른 날을 말한다)');
      assert.deepStrictEqual(P.posted.filter((s) => !/"cmd":"(userSessionGet)"/.test(s)), [], '열람 창이 무언가를 내보냈다');
    } finally { P.close(); }
  });

  // ── R8 ──
  test('(R8) 열람 창 ☆/★ = 저장 — 누르면 즐겨찾기 · 팝오버의 ★ 와 양방향으로 같다', async () => {
    await reset(V);
    const B = V;   // 이 시험은 열람 창 안에서만 돈다(☆/★ 와 ▾ 바꾸기의 팝오버)
    await openPeer(B, 'wblee', '이웅빈');
    const fv = B.doc.getElementById('pvFav');
    assert.ok(!fv.classList.contains('hidden'));
    assert.deepStrictEqual([fv.getAttribute('aria-pressed'), fv.textContent], ['false', '☆']);
    fv.click();
    assert.deepStrictEqual(list(B, keyF()), ['wblee']);
    assert.deepStrictEqual([fv.getAttribute('aria-pressed'), fv.textContent, fv.getAttribute('aria-label')], ['true', '★', '즐겨찾기에서 빼기']);
    B.ev('__rep.membersGet = ' + JSON.stringify(membersOk()));
    B.doc.getElementById('pvSwitch').click();
    await settle();
    assert.strictEqual(sec(B, 'Fav')[0].star, 'true:★', '열람 창에서 넣은 즐겨찾기가 팝오버에 ★ 로 안 보인다');
    starBtn(B, 'wblee').click();
    assert.deepStrictEqual(list(B, keyF()), []);
    assert.deepStrictEqual([fv.getAttribute('aria-pressed'), fv.textContent], ['false', '☆'], '팝오버에서 뺐는데 제목 옆 ★ 가 그대로다');
    //  다른 사람으로 바꾸면 그 사람 기준으로 다시 칠한다
    setLS(B, keyF(), [{ loginId: 'ihyoon', name: '윤인환' }]);
    B.ev('__rep.peerSchedule = ' + JSON.stringify(PEER_OK));
    type(B, '윤인');
    openBtn(B, 'ihyoon').click();
    assert.deepStrictEqual([fv.getAttribute('aria-pressed'), fv.textContent], ['true', '★'], '바꾼 사람의 즐겨찾기 상태로 다시 칠하지 않았다');
  });

  // ── R9 ──
  test('(R9) 키보드: 검색 칸 ↓ → 첫 행 · ↓ → 다음 · 끝에서 ↓ → 검색 칸 · ↑ → 마지막 행 · 검색 칸 Enter → 첫 열 수 있는 행 · Esc → 입구', async () => {
    await reset(B);
    setLS(B, keyR(), [{ loginId: 'wblee', name: '이웅빈' }, { loginId: 'ihyoon', name: '윤인환' }]);
    await openTop(B);
    const inp = B.doc.getElementById('pkSearch');
    key(B, inp, 'ArrowDown'); assert.strictEqual(active(B), 'pk-open:wblee');
    key(B, B.doc.activeElement, 'ArrowDown'); assert.strictEqual(active(B), 'pk-open:ihyoon');
    key(B, B.doc.activeElement, 'ArrowDown'); assert.strictEqual(active(B), 'pk-open:phmin', '최근 다음은 내 부서의 본인 행이다');
    key(B, B.doc.activeElement, 'ArrowDown'); assert.strictEqual(active(B), 'pkSearch', '끝에서 ↓ 가 검색 칸으로 돌아오지 않았다');
    key(B, inp, 'ArrowUp'); assert.strictEqual(active(B), 'pk-open:phmin');
    key(B, B.doc.activeElement, 'ArrowUp'); assert.strictEqual(active(B), 'pk-open:ihyoon');
    key(B, B.doc.activeElement, 'ArrowUp'); assert.strictEqual(active(B), 'pk-open:wblee');
    key(B, B.doc.activeElement, 'ArrowUp'); assert.strictEqual(active(B), 'pkSearch');
    //  ☆ 버튼에서도 ↓/↑ 는 행 단위로 움직인다
    starBtn(B, 'wblee').focus();
    key(B, B.doc.activeElement, 'ArrowDown'); assert.strictEqual(active(B), 'pk-open:ihyoon');
    //  ←/→ 가 아래 내 달력을 움직이지 않는다
    const v0 = B.ev('JSON.stringify(view)');
    key(B, B.doc.activeElement, 'ArrowRight');
    assert.strictEqual(B.ev('JSON.stringify(view)'), v0, '팝오버 안의 → 가 내 달력 달을 옮겼다');
    //  Esc → 입구
    key(B, B.doc.activeElement, 'Escape');
    assert.ok(!isOpen(B)); assert.strictEqual(active(B), 'btnPeerPick');
    //  Enter — 검색어 → 첫 열 수 있는 행(범위 밖 차은우는 건너뛴다)
    await openTop(B);
    type(B, '책임');   // 윤인환(책임 · 최근에 있음 → 최근 묶음에서 걸러져 남는다) · 차은우(책임연구원 · 범위 밖 → 결과)
    assert.deepStrictEqual(sec(B, 'Recent').map((x) => [x.id, x.off]), [['ihyoon', false]], '검색어로 최근을 거르지 않았다');
    assert.deepStrictEqual(sec(B, 'Result').map((x) => [x.id, x.off]), [['b1', true]], '최근에 이미 보인 사람이 결과에 또 나왔다');
    B.posted.length = 0;
    key(B, B.doc.getElementById('pkSearch'), 'Enter');
    await settle();
    assert.deepStrictEqual(peerOpens(B), ['ihyoon'], 'Enter 가 첫 열 수 있는 행으로 열람 창을 열지 않았다');
    assert.ok(!isOpen(B));
  });

  test('(R9) ⋯ 접기 항목으로 열면 ⋯ 버튼 아래에 뜨고 Esc 로 ⋯ 버튼에 포커스가 돌아온다', async () => {
    await reset(B);
    B.ev('__rep.membersGet = ' + JSON.stringify(membersOk()));
    B.doc.getElementById('btnPeerPickFold').click();
    await settle();
    assert.ok(isOpen(B), '접기 항목으로 열리지 않았다');
    assert.ok(B.doc.getElementById('moreMenu').classList.contains('hidden'), '⋯ 메뉴가 닫히지 않았다');
    key(B, B.doc.getElementById('pkSearch'), 'Escape');
    assert.strictEqual(active(B), 'btnMore');
  });

  test('(R) 마무리: 조작 내내 페이지 오류 0 · 내 창이 쓰기 명령을 보내지 않았다(사람 고르기 경로) · 열람 창은 읽기 넷만 보냈다', async () => {
    assert.deepStrictEqual(B.errors, [], '페이지 오류: ' + B.errors.slice(0, 2).join(' | '));
    const posts = B.posted.map((s) => { try { return JSON.parse(s).cmd; } catch (_) { return '?'; } });
    const writes = posts.filter((c) => /save|replace|import|delete|update|netcus|report/i.test(String(c)));
    assert.deepStrictEqual(writes, [], '쓰기로 보이는 명령이 나갔다: ' + writes.join(','));
    assert.deepStrictEqual(V.errors, [], '열람 창 페이지 오류: ' + V.errors.slice(0, 2).join(' | '));
    const vposts = V.posted.map((s) => { try { return JSON.parse(s).cmd; } catch (_) { return '?'; } });
    assert.deepStrictEqual(vposts.filter((c) => !['peerWinReady', 'peerSchedule', 'membersGet', 'peerMine'].includes(c)), [],
      '열람 창이 읽기 넷 밖의 명령을 보냈다: ' + vposts.join(','));
    B.close(); V.close();
  });

  // ══════════════════════════════════════════════════════════════════════
  // (M) 변이 — 판정이 정말 무는가
  // ══════════════════════════════════════════════════════════════════════
  async function recentOnlyOnSuccess(src) {
    const X = boot(src, PW_URL);
    try {
      X.ev('currentUser = ' + JSON.stringify(ME));   // 호스트가 __peerWinOpen 의 me 로 이미 알려 준 상태(최근 키가 선다)
      X.ev("__rep.peerSchedule = {ok:true, allowed:false}; openPeerSchedule('b1', '차은우')");
      await settle();
      assert.deepStrictEqual(list(X, keyR()), [], '권한 없음이 최근에 들어갔다');
      X.ev("__rep.peerSchedule = {ok:false, error:'x'}; openPeerSchedule('b2', '누구')");
      await settle();
      assert.deepStrictEqual(list(X, keyR()), [], '실패가 최근에 들어갔다');
      await openPeer(X, 'wblee', '이웅빈');
      assert.deepStrictEqual(list(X, keyR()), ['wblee'], '성공한 열람이 최근에 없다');
    } finally { X.close(); }
  }
  test('(변이) K6: 원본은 「성공만 기록」을 통과한다(아래 변이들의 대조군)', () => recentOnlyOnSuccess(app));
  test('(변이) K6: mountPeerFrame 의 최근 기록 줄을 지우면 잡힌다', async () => {
    const bad = mutate(app, '      pkNoteRecent(__pv.loginId, __pv.name);\n', '');
    await assert.rejects(() => recentOnlyOnSuccess(bad), /성공한 열람이 최근에 없다/);
  });
  test('(변이) K6: 기록을 조회 전(openPeerSchedule 첫머리)으로 옮기면 실패·권한 없음도 남아 잡힌다', async () => {
    let bad = mutate(app, '      pkNoteRecent(__pv.loginId, __pv.name);\n', '');
    bad = mutate(bad, "  pvSyncFav();                                       // K10", "  pkNoteRecent(loginId, name); pvSyncFav();   // K10");
    await assert.rejects(() => recentOnlyOnSuccess(bad), /권한 없음이 최근에 들어갔다/);
  });
  //  K11 — 팝오버의 Esc 는 팝오버만 닫는다. 2026-10-16 부터 열람 화면은 모달이 아니라 따로 뜨는 창이라, 새는 Esc 가 닫을 모달이 없다.
  //    대신 내 창의 전역 Esc 마지막 단계(맨 앞에 띄우기 해제 = hpost focus)가 함께 돈다 → 그것으로 잰다.
  async function escKeepsOthers(src) {
    const X = boot(src);
    try {
      X.ev('window.__big = true');   // 맨 앞에 띄우기 켜짐(호스트가 __setFocus(true) 로 알린 상태)
      X.ev('__rep.membersGet = ' + JSON.stringify(membersOk()));
      X.doc.getElementById('btnPeerPick').click();
      await settle();
      X.posted.length = 0;
      key(X, X.doc.getElementById('pkSearch'), 'Escape');
      assert.ok(!isOpen(X), 'Esc 로 팝오버가 닫히지 않았다');
      const cmds = X.posted.map((s) => JSON.parse(s).cmd);
      assert.ok(!cmds.includes('focus'), '팝오버의 Esc 가 맨 앞에 띄우기까지 풀었다(전역 Esc 로 샜다)');
    } finally { X.close(); }
  }
  test('(변이) K11: 원본은 「팝오버의 Esc 는 팝오버만 닫는다」를 통과한다(대조군)', () => escKeepsOthers(app));
  test('(변이) K11: Esc 캡처의 stopImmediatePropagation 을 빼면 팝오버의 Esc 가 전역 Esc(맨 앞에 띄우기 해제)로 새어 잡힌다', async () => {
    const bad = mutate(app, "    ev.preventDefault(); ev.stopImmediatePropagation();\n    pkClose(true);", '    pkClose(true);');
    await assert.rejects(() => escKeepsOthers(bad), /전역 Esc 로 샜다/);
  });
  test('(변이) R6: 최근 본 사람 행의 ✕ 단추 추가 줄을 빼면 잡힌다', () => {
    const bad = mutate(app, "    if(kind === 'Recent') row.appendChild(mkDel());\n", '');
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const pkRowEl = new Function('document', extractFunction(bad, 'pkRowEl') + '\nreturn pkRowEl;')(dom.window.document);
    const el = pkRowEl({ loginId: 'wblee', name: '이웅빈', title: '선임', org: 'SW 2팀', gone: false, canView: true, viewing: false, isMe: false, fav: false }, 'Recent');
    assert.strictEqual(el.querySelector('.pk-del'), null, '전제: 변이가 최근 행의 ✕ 단추를 지운다');
  });
}
