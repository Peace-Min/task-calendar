// 직급·소속 관리 — 화면 계약(docs/ORG-TITLE-ADMIN.md §5 · §7)
//
// 이 파일이 존재하는 이유:
//   「직급·소속 관리」는 **사람의 소속·직급 마스터**를 앱에서 고치는 첫 화면이다. 고치는 대상이
//   title_code · org_unit 둘뿐이라 화면은 작지만, 그 작은 화면이 지켜야 할 것은 휴지통과 같은 종류다:
//     ① 행도 버튼도 **마크업에 없다** — 목록은 전부 JS 가 만든다(이름이 DB 문자열이라 innerHTML 을 안 쓴다).
//     ② 진입 문(#uaOrgTitle)은 관리자·비순서편집일 때만 DOM 에 있다(숨김이 아니라 부재 · 「퇴사자 휴지통」과 같은 자리).
//     ③ 화면은 정렬하지 않는다 — units 는 호스트가 깊이우선으로 준 그대로 그리고 depth 로만 들여쓴다.
//        순서를 정하는 곳이 둘이면 반드시 갈린다(USER-ADMIN §5.3 과 같은 규칙).
//     ④ 숨길 수 없는 행은 [숨김] 이 꺼지고 **사유가 title 에** 붙는다(휴지통의 deletable/why 와 같은 손).
//     ⑤ 쓰기 왕복은 hostRequest 한 길이고, 회신의 갱신 목록이 화면에 닿는 문은 **하나**(otSeat)다.
//     ⑥ 닫을 때 「구성원 편집」이 드롭다운 소스와 명부를 다시 받는다(otAfterClose → uaReload).
//     ⑦ 모듈 상태는 다섯을 넘지 않는다 — 요청 표·워치독·보류 큐가 배달을 둘로 가른다(USER-ADMIN §11-34).
//     ⑧ ▲▼ 는 화면이 맞바꾼 **활성 배열 전체**를 보낸다(호스트가 집합을 대조해 낡은 화면을 거부한다).
//
//   ★ 소스 문자열 검사만으로는 ④⑤ 를 증명할 수 없다 — 그리는 코드는 어차피 파일 안에 있고, 문제는
//     '그 코드가 무엇을 그리는가'다. 그래서 실제로 그려 보고 DOM 을 센다(trash-web.test.mjs 와 같은 방식).
//   ★ 앱 전체를 부팅하지 않는다 — ot* 구역만 떼어 내 빈 문서에 심는다.
//   ★ 검사와 변이가 **같은 함수**를 쓴다. 변이로 안 깨지는 검사는 장식이다.
import { test, assert, loadAppSource, extractFunction, importOptional, useJsdom, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
const jsdom = useJsdom(await importOptional('jsdom'));

function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

// ── 오려내기 ────────────────────────────────────────────────────────
//   못 오려 내면 '판정 불가'로 죽는다(통과가 아니다).
function slice(web, startMark, endMark, label) {
  const s = web.indexOf(startMark);
  assert.ok(s >= 0, `${label} 를 찾지 못함(${startMark}) — 판정 불가`);
  const e = web.indexOf(endMark, s);
  assert.ok(e > s, `${label} 뒤의 경계(${endMark})를 찾지 못했다 — 판정 불가`);
  return web.slice(s, e);
}
//  마크업 — 주석은 지운다: "왜 행을 마크업에 적지 않는가"를 **적어 둔 문장**이 계약을 통과시키면 안 된다.
const otModalMarkup = (web) =>
  slice(web, '<div class="overlay hidden" id="orgTitleModal">', '<!-- ===== 휴지통(TRASH-DELETE §5.1)', '#orgTitleModal 마크업')
    .replace(/<!--[\s\S]*?-->/g, '');
//  ot* 구역 통째 — 함수를 하나씩 이름으로 떼어 오면 새로 생긴 ot 함수가 하네스에서 조용히 빠진다.
const otRegion = (web) =>
  slice(web, '/* ---------- 직급·소속 관리 — title_code/org_unit 마스터', '/* ---------- 기존 과제 재연결(P3.4)', 'ot* 구역');

//  ★ async 함수는 extractFunction 이 'function 이름(' 부터 오려 내므로 **async 가 떨어진다**(trash-web 과 같은 함정).
//    여기서는 구역을 통째로 싣기 때문에 그 문제가 없지만, 형태 검사용으로 하나씩 떼어 올 때는 필요하다.
function extractFn(web, name) {
  const isAsync = new RegExp('async\\s+function\\s+' + name + '\\s*\\(').test(web);
  return (isAsync ? 'async ' : '') + extractFunction(web, name);
}

// ── 회신 본보기 ─────────────────────────────────────────────────────
//   직급 셋(활성 둘 · 숨김 하나 · 재직자가 있는 직급 하나) · 조직 여섯(시드 트리의 축소판).
//   ★ units 는 호스트가 준 **깊이우선 순서 그대로**다 — 화면이 다시 묶거나 정렬하지 않는다(계약③).
const TITLES = [
  { name: '전무', sort: 10, active: true, users: 3 },
  { name: '수석', sort: 40, active: true, users: 0 },
  { name: '옛직급', sort: 90, active: false, users: 0 },
];
const UNITS = [
  { orgId: 1, name: '기술개발총괄', parentId: null, depth: 0, sort: 10, active: true, users: 1, children: 2 },
  { orgId: 2, name: 'SW개발본부', parentId: 1, depth: 1, sort: 20, active: true, users: 0, children: 2 },
  { orgId: 6, name: 'SW 1팀', parentId: 2, depth: 2, sort: 21, active: true, users: 5, children: 0 },
  { orgId: 7, name: 'SW 2팀', parentId: 2, depth: 2, sort: 22, active: true, users: 0, children: 0 },
  { orgId: 3, name: '사업부', parentId: 1, depth: 1, sort: 40, active: true, users: 0, children: 0 },
  { orgId: 9, name: '옛팀', parentId: 3, depth: 2, sort: 50, active: false, users: 0, children: 0 },
];
const PAYLOAD = { found: true, admin: true, titles: TITLES, units: UNITS };
const DENY = { found: true, admin: false };
//  쓰기 회신이 실어 오는 갱신 목록 — 직급이 하나 늘었다(행 수가 바뀌어야 '앉았다'고 말할 수 있다).
const SEATED = {
  found: true, admin: true,
  titles: TITLES.concat([{ name: 'zzJ신규', sort: 100, active: true, users: 0 }]),
  units: UNITS,
};
const TITLE_WHY = '이 직급인 재직자가 3명 있습니다 — 먼저 직급을 바꾸세요';
const UNIT_WHY = '이 조직에 재직자 0명 · 하위 조직 2개가 있습니다 — 먼저 옮기거나 숨기세요';
//  ★ <option> 안의 들여쓰기는 **줄바꿈 없는 공백**(U+00A0)이다 — 보통 공백은 목록에서 접혀 사라진다.
const NB2 = '  ', NB4 = '    ';
const ROOT_WHY = '최상위 조직은 숨길 수 없습니다';

// ══════════════════════════════════════════════════════════════════════
//  형태 계약 — 소스를 읽어 판정한다(jsdom 없이도 돈다)
// ══════════════════════════════════════════════════════════════════════

const checks = {
  // ① 마크업에는 행도 행 버튼도 없다(부재). 목록은 JS 가 만든다 — 이름이 DB 문자열이기 때문이다.
  markupHasNoRows(web) {
    const m = otModalMarkup(web);
    assert.ok(/id="otList"[^>]*><\/div>/.test(m.replace(/\s+/g, ' ')),
      '#otList 가 마크업에서 비어 있지 않다 — 행은 전부 JS 가 만든다(innerHTML 금지)');
    assert.ok(!/data-otop/.test(m), '마크업에 행 버튼(data-otop)이 박혀 있다 — 권한과 무관하게 서는 컨트롤이 생긴다');
    assert.ok(!/cust-row/.test(m), '마크업에 행(.cust-row)이 박혀 있다 — 목록의 정본은 회신이다');
    assert.ok(/<select id="otNewParent"[^>]*class="hidden"/.test(m),
      '#otNewParent 가 처음부터 보인다 — 직급 탭에는 상위가 없다(빈 칸만 두면 무엇을 고르는 자리인지 흐려진다)');
    //  탭 둘은 마크업에 있다(행이 아니라 화면의 뼈대다).
    assert.ok(/id="otTabTitle"/.test(m) && /id="otTabUnit"/.test(m), '탭 둘(직급·소속)이 마크업에 없다');
  },

  // ② 진입 — 「구성원 편집」 상단 막대의 세 번째 자리. **비관리자·순서편집 조기 return 뒤**여야 한다.
  //    앞에 두면 그 버튼만 비관리자에게도 만들어진다(숨김이 아니라 부재라는 계약이 그 한 줄로 깨진다).
  entryIsAfterGuards(web) {
    const bar = extractFunction(web, 'uaAdminBar');
    const mk = bar.indexOf("mk('직급·소속 관리', 'uaOrgTitle'");
    assert.ok(mk >= 0, 'uaAdminBar 가 「직급·소속 관리」(#uaOrgTitle)를 만들지 않는다 — 진입 문이 없다');
    const guard = bar.indexOf('if(!__uaAdmin) return;');
    assert.ok(guard >= 0, 'uaAdminBar 의 비관리자 조기 return 을 찾지 못했다 — 판정 불가');
    assert.ok(guard < mk,
      '「직급·소속 관리」가 비관리자 조기 return **앞**에 있다 — 관리자가 아닌 사람의 DOM 에 그 문이 선다');
    const ordRet = bar.indexOf('return;   // ★ 순서 편집 중에는 #uaFoot');
    assert.ok(ordRet >= 0, 'uaAdminBar 의 순서편집 조기 return 을 찾지 못했다 — 판정 불가');
    assert.ok(ordRet < mk,
      '「직급·소속 관리」가 순서 편집 분기 안에 있다 — 열면 명부를 다시 읽어 편집 중인 순서가 날아간다');
    //  잠금 집합에도 들어 있어야 한다 — 그 자리에서 끄는 집합과 렌더가 잠그는 집합이 갈리면 재렌더가 잠금을 뒤집는다.
    assert.ok(/'uaNew', 'uaOrderEdit', 'uaOrderSave', 'uaTrash', 'uaOrgTitle'/.test(extractFunction(web, 'uaSyncControls')),
      "uaSyncControls 의 잠금 집합에 'uaOrgTitle' 이 없다 — 왕복 중에 그 문이 켜진 채로 남는다");
  },

  // ③ 화면은 정렬하지 않는다 — 순서의 정본은 호스트 회신 하나다(두 곳이면 반드시 갈린다).
  noSortInWeb(web) {
    for (const fn of ['otRender', 'otApplyData', 'otSyncAdd', 'otMove']) {
      assert.ok(!/\.sort\(/.test(extractFunction(web, fn)),
        `${fn} 이 목록을 다시 정렬한다 — 화면은 호스트가 준 순서를 그대로 그린다(ORG-TITLE-ADMIN §5.1)`);
    }
  },

  // ⑤-소스 회신의 갱신 목록이 화면에 닿는 문은 **하나**다 — 그 구역에서 JSON.parse 는 한 번뿐이어야 한다.
  seatIsOneDoor(web) {
    const region = otRegion(web);
    const n = (region.match(/JSON\.parse\(/g) || []).length;
    assert.strictEqual(n, 1,
      `ot* 구역에서 JSON.parse 가 ${n}곳이다 — 회신 목록을 앉히는 문은 otSeat 하나여야 한다(둘이면 한쪽만 낡는다)`);
    assert.ok(/JSON\.parse\(/.test(extractFunction(web, 'otSeat')), 'otSeat 가 회신 목록을 풀지 않는다');
    assert.ok(/otSeat\(rep\.orgTitle\)/.test(extractFn(web, 'otSend')),
      'otSend 가 회신의 orgTitle 을 앉히지 않는다 — 고친 결과가 화면에 닿지 않는다');
  },

  // ⑥ 닫기 부수효과는 **닫기 경로 한 곳**(closeOverlay)에 있다. 그리고 그 뒤처리는 「구성원 편집」이
  //    열려 있을 때만 한다 — 닫혀 있는 화면을 위해 호스트 왕복을 만들지 않는다.
  closeReloadsMembers(web) {
    const co = extractFunction(web, 'closeOverlay');
    assert.ok(/if\(ov\.id === 'orgTitleModal'\) otAfterClose\(\);/.test(co),
      'closeOverlay 가 #orgTitleModal 의 뒤처리를 부르지 않는다 — 고친 직급·소속이 편집 폼 드롭다운에 닿지 않는다');
    const ac = extractFunction(web, 'otAfterClose');
    assert.ok(/getElementById\('userAdminModal'\)/.test(ac) && /uaReload\(\)/.test(ac),
      'otAfterClose 가 「구성원 편집」이 열려 있는지 보고 uaReload 하지 않는다');
    assert.ok(!/__uaTitles|__uaUnits/.test(ac),
      'otAfterClose 가 드롭다운 소스를 직접 앉힌다 — 정본은 membersGet 회신 하나다(한 벌 더 두면 두 벌이 된다)');
  },

  // ⑦ 모듈 상태는 다섯뿐이다(설계 §5.1). 요청 표·워치독·보류 큐가 생기면 여기서 운다.
  moduleStateIsFive(web) {
    const m = /^let __ot.*$/m.exec(web);
    assert.ok(m, 'ot* 모듈 상태 선언(let __ot…)을 찾지 못했다 — 판정 불가');
    const names = (m[0].match(/__ot\w+/g) || []);
    assert.deepStrictEqual(names, ['__otData', '__otTab', '__otShowHidden', '__otBusy', '__otSaving'],
      `모듈 상태가 [${names.join(', ')}] 이다 — 다섯(회신 덩어리·탭·숨김표시·조회 재진입·쓰기 왕복)을 넘기지 않는다(§5.1)`);
    const decls = (web.match(/\b(?:let|var)\s+__ot\w+/g) || []);
    assert.strictEqual(decls.length, 1,
      `__ot 상태 선언이 ${decls.length}곳이다(${decls.join(', ')}) — 한 줄이어야 한다`);
  },

  // ⑧ ▲▼ 는 **활성 배열 전체**를 보낸다 — 화면이 자기 목록을 미리 고쳐 두지 않는다(정본은 DB 다).
  moveSendsWholeSet(web) {
    const mv = extractFunction(web, 'otMove');
    assert.ok(/otSend\('unitReorder', \{ parentId:/.test(mv) && /orgIds: arr\.map/.test(mv),
      'otMove 가 형제 집합 전체(orgIds)를 보내지 않는다 — 절반만 보내면 호스트가 낡은 화면으로 거부한다');
    assert.ok(/otSend\('titleReorder', \{ names: arr \}\)/.test(mv),
      'otMove 가 활성 직급 전체(names)를 보내지 않는다');
    assert.ok(!/__otData\.titles\s*=|__otData\.units\s*=/.test(mv),
      'otMove 가 화면의 목록을 미리 고친다 — 순서의 정본은 DB 이고, 새 순서는 회신(orgTitle)으로 온다');
  },
};

test('계약①: #orgTitleModal 마크업에 행도 행 버튼도 없다(목록은 JS 가 만든다)', () => checks.markupHasNoRows(app));
test('계약②: 「직급·소속 관리」 문은 비관리자·순서편집 조기 return 뒤에 만들어진다', () => checks.entryIsAfterGuards(app));
test('계약③: 렌더·적용·추가줄·재정렬 어디에도 .sort( 가 없다(정렬은 호스트가 한다)', () => checks.noSortInWeb(app));
test('계약⑤-소스: 회신 목록이 화면에 닿는 문은 otSeat 하나다(JSON.parse 가 한 곳)', () => checks.seatIsOneDoor(app));
test('계약⑥: 닫을 때 「구성원 편집」이 열려 있으면 uaReload 한다(드롭다운 소스는 membersGet 이 정본)', () => checks.closeReloadsMembers(app));
test('계약⑦: ot* 모듈 상태는 다섯뿐이다(요청 표·워치독·보류 큐 금지)', () => checks.moduleStateIsFive(app));
test('계약⑧-소스: ▲▼ 는 활성 집합 전체를 보내고 화면 목록을 미리 고치지 않는다', () => checks.moveSendsWholeSet(app));

// ══════════════════════════════════════════════════════════════════════
//  DOM 계약 — 실제로 그려 보고 센다
// ══════════════════════════════════════════════════════════════════════

//  ★ 하네스는 ot* 구역을 **통째로** 싣는다(함수를 이름으로 하나씩 떼어 오면 새 함수가 조용히 빠진다).
//    협력자는 이 계약과 무관한 최소한만 대역으로 둔다.
function otHarnessJs(src) {
  return [
    'var HOST = true, __toasts = [], __sent = [], __resolve = null, __uaReloads = 0;',
    'function toast(m, k){ __toasts.push({ msg: String(m), kind: String(k || "") }); }',
    //  왕복은 **우리 손에 있다** — 언제 풀릴지 시험이 정한다(잠금이 걸린 '그 순간'을 봐야 한다).
    'function hostRequest(cmd, params, timeoutMs){',
    '  __sent.push({ cmd: String(cmd), timeoutMs: timeoutMs, params: JSON.parse(JSON.stringify(params || {})) });',
    '  return new Promise(function(res){ __resolve = res; });',
    '}',
    'function openModal(sel){ var ov = document.querySelector(sel); if(ov) ov.classList.remove("hidden"); }',
    'function confirmBox(){ return Promise.resolve("ok"); }',
    'function uaReload(){ __uaReloads++; return true; }',
    extractFunction(src, 'hostWriteMsg'),
    extractFunction(src, 'otAfterClose'),
    otRegion(src),
    //  ── 탐침 ──
    'function __rows(){',
    '  return Array.prototype.map.call(document.querySelectorAll("#otList .cust-row"), function(r){',
    '    var nm = r.querySelector(".cust-nm");',
    '    var cnt = r.querySelector(".ot-cnt");',
    '    return { key: String(r.dataset.otkey || ""),',
    '      name: (nm && nm.childNodes[0]) ? String(nm.childNodes[0].nodeValue || "") : "",',
    '      pad: nm ? String(nm.style.paddingLeft || "") : "",',
    '      badge: !!r.querySelector(".cust-badge"),',
    '      cnt: cnt ? String(cnt.textContent || "") : "",',
    '      btns: Array.prototype.map.call(r.querySelectorAll("button"), function(b){',
    '        return { op: String(b.dataset.otop || ""), label: String(b.textContent || ""),',
    '                 disabled: !!b.disabled, title: String(b.title || "") }; }) };',
    '  });',
    '}',
    'function __btn(rows, key, op){',
    '  for(var i = 0; i < rows.length; i++) if(rows[i].key === String(key)){',
    '    var bs = rows[i].btns;',
    '    for(var j = 0; j < bs.length; j++) if(bs[j].op === op) return bs[j];',
    '  }',
    '  return null;',
    '}',
    'function __snap(){',
    '  var sel = document.getElementById("otNewParent");',
    '  var add = document.getElementById("otAddBtn");',
    '  var inp = document.getElementById("otNewName");',
    '  return { rows: __rows(),',
    '    scope: String((document.getElementById("otScope") || {}).textContent || ""),',
    '    hints: document.querySelectorAll("#otList .set-hint").length,',
    '    hintText: (function(h){ return h ? String(h.textContent || "") : ""; })(document.querySelector("#otList .set-hint")),',
    '    empty: document.querySelectorAll("#otList .cust-empty").length,',
    '    ops: document.querySelectorAll("#otList [data-otop]").length,',
    '    addDisabled: !!(add && add.disabled), inputDisabled: !!(inp && inp.disabled),',
    '    parentHidden: !!(sel && sel.classList.contains("hidden")),',
    '    parentOpts: sel ? Array.prototype.map.call(sel.options, function(o){',
    '      return { value: String(o.value), text: String(o.textContent || "") }; }) : [],',
    '    posts: __sent.length, toasts: __toasts.slice(), reloads: __uaReloads };',
    '}',
    'function __reset(payload, tab, showHidden){',
    '  __otData = null; __otTab = "title"; __otBusy = false; __otSaving = false;',
    '  __otShowHidden = !!showHidden;',
    '  __sent.length = 0; __toasts.length = 0; __resolve = null; __uaReloads = 0;',
    '  var sh = document.getElementById("otShowHidden"); if(sh) sh.checked = !!showHidden;',
    '  otApplyData(payload ? JSON.parse(JSON.stringify(payload)) : null);',
    '  if(tab === "unit") otSwitchTab("unit");',
    '}',
    'window.__probe = function(payload, tab, showHidden){ __reset(payload, tab, showHidden); return __snap(); };',
    //  [상위 변경] 후보 — 자기 자신도 자기 자손도 없다(자기 밑으로 옮기면 트리가 끊긴다).
    'window.__probeMove = function(payload, key){',
    '  __reset(payload, "unit", false);',
    '  otBeginMove(String(key));',
    '  var row = otRowOf(String(key));',
    '  var sel = row ? row.querySelector("select") : null;',
    '  return { found: !!sel,',
    '    opts: sel ? Array.prototype.map.call(sel.options, function(o){',
    '      return { value: String(o.value), text: String(o.textContent || "") }; }) : [],',
    '    btns: row ? Array.prototype.map.call(row.querySelectorAll("button"), function(b){',
    '      return String(b.dataset.otop || ""); }) : [] };',
    '};',
    //  [추가]는 상위를 고를 때 켜진다(소속 탭) — 직급 탭에는 상위가 없으므로 처음부터 켜져 있다.
    'window.__probeAddGate = function(payload){',
    '  __reset(payload, "unit", false);',
    '  var before = !!document.getElementById("otAddBtn").disabled;',
    '  var sel = document.getElementById("otNewParent");',
    '  sel.value = "2";',
    '  otSyncControls();',
    '  var after = !!document.getElementById("otAddBtn").disabled;',
    '  otSwitchTab("title");',
    '  var onTitle = !!document.getElementById("otAddBtn").disabled;',
    '  return { before: before, after: after, onTitle: onTitle };',
    '};',
    //  ▲▼ 가 실제로 보내는 페이로드 — 화면이 맞바꾼 **활성 배열 전체**다.
    'window.__probeMoveSend = function(payload, tab, key, dir){',
    '  __reset(payload, tab, false);',
    '  otMove(String(key), dir);',
    '  return { sent: __sent.slice() };',
    '};',
    //  쓰기 왕복 — 잠금이 걸린 '그 순간'과 풀린 뒤를 함께 본다. 회신은 시험이 푼다.
    'window.__probeBusy = function(payload, reply){',
    '  __reset(payload, "title", false);',
    '  var ov = document.getElementById("orgTitleModal");',
    '  var idle = { rows: __rows().length, busy: ov.getAttribute("data-busy"),',
    '               ops: __rows()[0] ? __rows()[0].btns.map(function(b){ return b.disabled; }) : [] };',
    '  var p = otSend("titleAdd", { name: "zzJ신규" });',
    '  var during = { rows: __rows().length, busy: ov.getAttribute("data-busy"),',
    '                 ops: __rows()[0].btns.map(function(b){ return b.disabled; }),',
    '                 add: !!document.getElementById("otAddBtn").disabled,',
    '                 tab: !!document.getElementById("otTabUnit").disabled, posts: __sent.length };',
    //  왕복 중 두 번째 클릭 — **조용히 버리지 않는다**. otSend 는 async 라 늘 Promise 를 돌려주므로
    //  '요청을 만들었나'는 그 값이 아니라 **호스트로 나간 수**(posts)로 본다.
    '  var second = otSend("titleAdd", { name: "zzJ또" });',
    '  var refused = { posts: __sent.length, toasts: __toasts.slice() };',
    '  __resolve(reply);',
    '  return Promise.all([p, second]).then(function(rs){',
    '    var r = rs[0];',
    '    refused.value = rs[1];',
    '    return { idle: idle, during: during, refused: refused, reply: r,',
    '             done: { rows: __rows().length, busy: ov.getAttribute("data-busy"),',
    '                     ops: __rows()[0].btns.map(function(b){ return b.disabled; }),',
    '                     add: !!document.getElementById("otAddBtn").disabled },',
    '             sent: __sent.slice(), toasts: __toasts.slice() };',
    '  });',
    '};',
    //  닫기 뒤처리 — 「구성원 편집」이 열려 있을 때만 다시 읽는다.
    'window.__probeAfterClose = function(openMembers){',
    '  __uaReloads = 0;',
    '  var ua = document.getElementById("userAdminModal");',
    '  if(openMembers) ua.classList.remove("hidden"); else ua.classList.add("hidden");',
    '  otAfterClose();',
    '  return { reloads: __uaReloads };',
    '};',
  ].join('\n');
}

const otFixture = (src = app) => '<!doctype html><html><body>' + otModalMarkup(src) +
  '<div class="overlay hidden" id="userAdminModal"></div></body></html>';

function boot(src = app) {
  const dom = new jsdom.JSDOM(otFixture(src), { runScripts: 'outside-only' });
  dom.window.eval(otHarnessJs(src));
  return dom.window;
}
const call = (name, src, ...args) => {
  const w = boot(src);
  const fn = w[name];
  assert.ok(typeof fn === 'function', `${name} 창구가 없다 — 판정 불가`);
  return JSON.parse(JSON.stringify(fn(...args)));
};
async function callAsync(name, src, ...args) {
  const w = boot(src);
  const fn = w[name];
  assert.ok(typeof fn === 'function', `${name} 창구가 없다 — 판정 불가`);
  return JSON.parse(JSON.stringify(await fn(...args)));
}
const probe = (payload, tab, showHidden, src = app) => call('__probe', src, payload, tab, showHidden);
const probeMove = (payload, key, src = app) => call('__probeMove', src, payload, key);
const probeAddGate = (payload, src = app) => call('__probeAddGate', src, payload);
const probeMoveSend = (payload, tab, key, dir, src = app) => call('__probeMoveSend', src, payload, tab, key, dir);
const probeBusy = (payload, reply, src = app) => callAsync('__probeBusy', src, payload, reply);
const probeAfterClose = (openMembers, src = app) => call('__probeAfterClose', src, openMembers);

//  DOM 계약을 **검사 함수로** 묶는다 — 변이가 같은 함수를 다시 부를 수 있어야 '잡았다'고 말할 수 있다.
const dom = {
  // ④-직급 회신 순서 그대로 · 숨김은 걸러진다 · 숨길 수 없는 행은 사유가 title 에.
  titleRows(src) {
    const r = probe(PAYLOAD, 'title', false, src);
    assert.deepStrictEqual(r.rows.map((x) => x.key), ['전무', '수석'],
      `직급 탭이 회신 순서대로 활성 둘을 그리지 않는다: ${JSON.stringify(r.rows.map((x) => x.key))}`);
    const hideJ = r.rows[0].btns.find((b) => b.op === 'hide');
    assert.ok(hideJ, '재직자 3명인 직급에 [숨김] 버튼 자체가 없다 — 부재는 사유를 알려 주지 않는다');
    assert.strictEqual(hideJ.disabled, true, '재직자 3명인 직급의 [숨김] 이 켜져 있다 — 눌러 봐야 호스트가 거부한다');
    assert.strictEqual(hideJ.title, TITLE_WHY, `[숨김] 의 사유가 다르다: ${JSON.stringify(hideJ.title)}`);
    const hideS = r.rows[1].btns.find((b) => b.op === 'hide');
    assert.strictEqual(hideS.disabled, false, '재직자 0명인 직급의 [숨김] 이 꺼져 있다');
    //  ▲▼ 는 활성끼리 — 첫 행의 ▲ 와 마지막 행의 ▼ 만 꺼진다.
    assert.deepStrictEqual(r.rows.map((x) => [x.btns.find((b) => b.op === 'up').disabled,
                                              x.btns.find((b) => b.op === 'down').disabled]),
      [[true, false], [false, true]],
      `▲▼ 의 끝 처리가 계약과 다르다: ${JSON.stringify(r.rows.map((x) => x.btns))}`);
    //  숨긴 값도 표시 — 셋이 되고, 숨긴 행에는 [복구] 가 선다([숨김] 이 아니다).
    const h = probe(PAYLOAD, 'title', true, src);
    assert.deepStrictEqual(h.rows.map((x) => x.key), ['전무', '수석', '옛직급'],
      `「숨긴 값도 표시」가 숨긴 직급을 그리지 않는다: ${JSON.stringify(h.rows.map((x) => x.key))}`);
    const old = h.rows[2];
    assert.strictEqual(old.badge, true, '숨긴 직급에 [숨김] 배지가 없다');
    assert.deepStrictEqual(old.btns.map((b) => b.op), ['show'],
      `숨긴 직급의 버튼이 [복구] 하나가 아니다: ${JSON.stringify(old.btns)}`);
    assert.strictEqual(old.btns[0].label, '복구', '숨긴 행의 버튼 문구가 [복구] 가 아니다');
  },

  // ④-소속 들여쓰기 = 깊이 · 최상위는 숨길 수 없다 · 활성 하위가 있으면 숨길 수 없다 · ▲▼ 는 형제끼리.
  unitRows(src) {
    const r = probe(PAYLOAD, 'unit', false, src);
    assert.deepStrictEqual(r.rows.map((x) => x.key), ['1', '2', '6', '7', '3'],
      `소속 탭이 호스트가 준 깊이우선 순서를 지키지 않는다: ${JSON.stringify(r.rows.map((x) => x.key))}`);
    assert.deepStrictEqual(r.rows.map((x) => x.pad), ['0px', '16px', '32px', '32px', '16px'],
      `들여쓰기가 깊이×16px 이 아니다: ${JSON.stringify(r.rows.map((x) => x.pad))}`);
    const hide = (key) => r.rows.find((x) => x.key === key).btns.find((b) => b.op === 'hide');
    assert.strictEqual(hide('1').disabled, true, '최상위 조직의 [숨김] 이 켜져 있다 — 루트는 하나뿐이다');
    assert.strictEqual(hide('1').title, ROOT_WHY, `최상위의 [숨김] 사유가 다르다: ${JSON.stringify(hide('1').title)}`);
    assert.strictEqual(hide('2').disabled, true, '활성 하위 2개인 조직의 [숨김] 이 켜져 있다');
    assert.strictEqual(hide('2').title, UNIT_WHY, `하위가 있는 조직의 [숨김] 사유가 다르다: ${JSON.stringify(hide('2').title)}`);
    assert.strictEqual(hide('7').disabled, false, '재직자 0명·하위 0개인 조직의 [숨김] 이 꺼져 있다');
    //  ▲▼ 는 **같은 부모의 활성 형제끼리**만 오간다.
    const ord = (key) => {
      const row = r.rows.find((x) => x.key === key);
      return [row.btns.find((b) => b.op === 'up').disabled, row.btns.find((b) => b.op === 'down').disabled];
    };
    assert.deepStrictEqual(ord('6'), [true, false], 'SW 1팀(형제 중 첫째)의 ▲▼ 가 계약과 다르다');
    assert.deepStrictEqual(ord('7'), [false, true], 'SW 2팀(형제 중 막내)의 ▲▼ 가 계약과 다르다');
    assert.deepStrictEqual(ord('3'), [false, true], '사업부(루트의 둘째 자식)의 ▲▼ 가 계약과 다르다');
    assert.deepStrictEqual(ord('1'), [true, true], '최상위는 형제가 없으므로 ▲▼ 둘 다 꺼져 있어야 한다');
    //  소속 행에는 [상위 변경] 이 있다(직급에는 없다).
    assert.ok(r.rows.every((x) => x.btns.some((b) => b.op === 'move')), '소속 행에 [상위 변경] 이 없다');
    //  숨긴 조직 — 상위가 활성이면 [복구] 가 켜진다.
    const h = probe(PAYLOAD, 'unit', true, src);
    const old = h.rows.find((x) => x.key === '9');
    assert.ok(old, '「숨긴 값도 표시」가 숨긴 조직을 그리지 않는다');
    assert.deepStrictEqual(old.btns.map((b) => b.op), ['show'], `숨긴 조직의 버튼이 [복구] 하나가 아니다: ${JSON.stringify(old.btns)}`);
    assert.strictEqual(old.btns[0].disabled, false, '상위가 활성인데 숨긴 조직의 [복구] 가 꺼져 있다');
    assert.strictEqual(old.pad, '32px', '숨긴 조직의 들여쓰기가 깊이를 따르지 않는다');
  },

  // ④-추가줄 상위 드롭다운은 **활성 조직만** 들여쓰기와 함께 싣는다. 직급 탭에서는 숨는다.
  addRow(src) {
    const t = probe(PAYLOAD, 'title', false, src);
    assert.strictEqual(t.parentHidden, true, '직급 탭인데 상위 드롭다운이 보인다');
    const u = probe(PAYLOAD, 'unit', false, src);
    assert.strictEqual(u.parentHidden, false, '소속 탭인데 상위 드롭다운이 숨어 있다');
    assert.deepStrictEqual(u.parentOpts.map((o) => o.value), ['', '1', '2', '6', '7', '3'],
      `상위 후보에 활성 조직 전부(숨김 제외)가 있지 않다: ${JSON.stringify(u.parentOpts)}`);
    assert.deepStrictEqual(u.parentOpts.map((o) => o.text),
      ['상위 조직 선택', '기술개발총괄', NB2 + 'SW개발본부', NB4 + 'SW 1팀', NB4 + 'SW 2팀', NB2 + '사업부'],
      `상위 후보의 들여쓰기(깊이×2칸)가 계약과 다르다: ${JSON.stringify(u.parentOpts.map((o) => o.text))}`);
    const g = probeAddGate(PAYLOAD, src);
    assert.strictEqual(g.before, true, '소속 탭에서 상위를 고르지 않았는데 [추가] 가 켜져 있다 — 상위 없는 조직은 새 최상위가 된다');
    assert.strictEqual(g.after, false, '상위를 골랐는데 [추가] 가 꺼진 채다');
    assert.strictEqual(g.onTitle, false, '직급 탭인데 [추가] 가 꺼져 있다 — 직급에는 상위가 없다');
  },

  // ④-비관리자 admin:false 면 행도 컨트롤도 없다(숨김이 아니라 부재) — 안내 한 줄만 남는다.
  denyHasNoControls(src) {
    const r = probe(DENY, 'title', false, src);
    assert.strictEqual(r.rows.length, 0, '관리자가 아닌데 행이 그려졌다');
    assert.strictEqual(r.ops, 0, `관리자가 아닌데 행 버튼이 ${r.ops}개 있다 — 부재여야 한다`);
    assert.strictEqual(r.hints, 1, `안내가 ${r.hints}줄이다 — 빈 화면은 고장으로 보이므로 한 줄은 남긴다`);
    assert.strictEqual(r.hintText, '관리자만 사용할 수 있습니다.', `비관리자 안내 문구가 다르다: ${JSON.stringify(r.hintText)}`);
    assert.strictEqual(r.addDisabled, true, '관리자가 아닌데 [추가] 가 켜져 있다');
    assert.strictEqual(r.inputDisabled, true, '관리자가 아닌데 이름 입력칸이 켜져 있다');
    //  호스트가 사유를 실어 보내면 그것을 쓴다(비활성 계정은 '관리자가 아니다'와 이유가 다르다).
    const why = probe({ found: true, admin: false, msg: '비활성 처리된 계정입니다.' }, 'title', false, src);
    assert.strictEqual(why.hintText, '비활성 처리된 계정입니다.', '호스트가 준 사유를 화면이 제 문장으로 덮는다');
  },

  // ④-상위 변경 후보에서 자기 자신과 자기 자손을 뺀다.
  moveCandidates(src) {
    const r = probeMove(PAYLOAD, '2', src);
    assert.strictEqual(r.found, true, '[상위 변경] 을 눌러도 행 안에 <select> 가 서지 않는다');
    assert.deepStrictEqual(r.opts.map((o) => o.value), ['', '1', '3'],
      `상위 후보에 자기 자신(2)이나 자손(6·7)이 남아 있다: ${JSON.stringify(r.opts)}`);
    assert.deepStrictEqual(r.btns, ['moveok', 'cancel'], `상위 변경 줄의 버튼이 [적용][취소] 가 아니다: ${JSON.stringify(r.btns)}`);
  },

  // ⑧ ▲▼ 가 보내는 페이로드 — 맞바꾼 활성 배열 전체다.
  movePayload(src) {
    const u = probeMoveSend(PAYLOAD, 'unit', '6', 'down', src);
    assert.deepStrictEqual(u.sent.map((s) => s.cmd), ['unitReorder'], `소속 ▲▼ 가 보낸 명령이 다르다: ${JSON.stringify(u.sent)}`);
    assert.deepStrictEqual(u.sent[0].params, { parentId: 2, orgIds: [7, 6] },
      `소속 ▼ 의 페이로드가 계약과 다르다: ${JSON.stringify(u.sent[0].params)}`);
    const t = probeMoveSend(PAYLOAD, 'title', '수석', 'up', src);
    assert.deepStrictEqual(t.sent.map((s) => s.cmd), ['titleReorder'], `직급 ▲▼ 가 보낸 명령이 다르다: ${JSON.stringify(t.sent)}`);
    assert.deepStrictEqual(t.sent[0].params, { names: ['수석', '전무'] },
      `직급 ▲ 의 페이로드가 계약과 다르다: ${JSON.stringify(t.sent[0].params)}`);
  },

  // ⑤ 쓰기 왕복 — 잠금·재진입 거부·좌석(otSeat)·busy 표식.
  async writeRoundTrip(src) {
    const seat = JSON.stringify(SEATED);
    const r = await probeBusy(PAYLOAD, { ok: true, msg: '직급을 추가했습니다.', orgTitle: seat }, src);
    assert.strictEqual(r.idle.rows, 2, `전제 붕괴: 시작 화면의 행이 2가 아니다(${r.idle.rows})`);
    assert.strictEqual(r.idle.busy, null, '아무것도 안 보냈는데 overlay 에 busy 표식이 서 있다');
    assert.ok(r.idle.ops.some((d) => d === false), '전제 붕괴: 평소에도 행 버튼이 전부 꺼져 있다');
    //  왕복 중 — 행 버튼·[추가]·탭이 전부 잠기고, overlay 는 닫기를 막는다.
    assert.ok(r.during.ops.every((d) => d === true),
      `왕복 중인데 행 버튼이 켜져 있다: ${JSON.stringify(r.during.ops)} — 같은 쓰기가 두 번 나간다`);
    assert.strictEqual(r.during.add, true, '왕복 중인데 [추가] 가 켜져 있다');
    assert.strictEqual(r.during.tab, true, '왕복 중인데 탭이 켜져 있다 — 결과를 기다리는 목록을 갈아치울 수 있다');
    assert.strictEqual(r.during.busy, '1', '왕복 중인데 overlay 에 busy 표식이 없다 — 결과를 알릴 곳이 사라질 수 있다');
    assert.strictEqual(r.during.rows, 2, '회신이 오기도 전에 목록이 바뀌었다 — 화면이 결과를 미리 추측한다');
    //  두 번째 클릭은 **조용히 버리지 않는다** — 사유를 말하고 왕복을 만들지 않는다.
    assert.strictEqual(r.refused.value, null, '왕복 중 두 번째 쓰기가 회신을 돌려받았다 — 보내지 못했으면 null 이어야 한다');
    assert.strictEqual(r.refused.posts, 1, `왕복 중 두 번째 클릭이 호스트로 나갔다(posts=${r.refused.posts})`);
    assert.ok(r.refused.toasts.some((t) => /처리 중/.test(t.msg)),
      `두 번째 클릭이 조용히 버려졌다: ${JSON.stringify(r.refused.toasts)}`);
    //  회신 뒤 — 잠금이 풀리고, 실려 온 목록이 앉는다(행 수가 바뀐다).
    assert.strictEqual(r.done.busy, null, '회신이 왔는데 busy 표식이 남아 있다 — 화면을 닫을 수 없게 된다');
    assert.ok(r.done.ops.some((d) => d === false), `회신이 왔는데 행 버튼이 잠긴 채다: ${JSON.stringify(r.done.ops)}`);
    assert.strictEqual(r.done.add, false, '회신이 왔는데 [추가] 가 잠긴 채다');
    assert.strictEqual(r.done.rows, 3, `회신의 갱신 목록이 앉지 않았다(행 ${r.done.rows}) — 고친 결과가 화면에 닿지 않는다`);
    assert.deepStrictEqual(r.sent.map((s) => s.cmd), ['titleAdd'], `보낸 명령이 다르다: ${JSON.stringify(r.sent)}`);
    assert.ok(r.toasts.some((t) => t.kind === 'success'), `성공 회신인데 성공 토스트가 없다: ${JSON.stringify(r.toasts)}`);
  },

  // ⑤-b 목록이 안 실려 온 회신은 화면을 건드리지 않는다 — 추측한 목록을 그리지 않는다.
  async replyWithoutList(src) {
    const r = await probeBusy(PAYLOAD, { ok: false, msg: '이미 있는 직급입니다.' }, src);
    assert.strictEqual(r.done.rows, 2,
      `목록이 안 실려 온 회신인데 행이 ${r.done.rows}이 됐다 — 빈 화면보다 낡은 화면이 낫다`);
    assert.strictEqual(r.done.busy, null, '실패 회신인데 busy 표식이 남아 있다');
    assert.ok(r.toasts.some((t) => t.kind === 'error' && /이미 있는 직급입니다\./.test(t.msg)),
      `호스트 문장을 그대로 내지 않는다: ${JSON.stringify(r.toasts)}`);
  },

  // ⑥ 닫기 뒤처리 — 「구성원 편집」이 열려 있을 때만 다시 읽는다.
  afterClose(src) {
    assert.strictEqual(probeAfterClose(true, src).reloads, 1,
      '「구성원 편집」이 열려 있는데 닫기 뒤처리가 uaReload 를 부르지 않는다 — 드롭다운이 옛 값을 계속 보여 준다');
    assert.strictEqual(probeAfterClose(false, src).reloads, 0,
      '「구성원 편집」이 닫혀 있는데도 uaReload 를 부른다 — 아무도 안 보는 화면을 위해 호스트 왕복을 만든다');
  },
};

if (!jsdom) {
  const { skip } = await import('./harness.mjs');
  skip('계약④-DOM(a): 직급 탭은 회신 순서대로 그리고 숨길 수 없는 행은 사유가 title 에 붙는다', SKIP_NO_JSDOM, '이 파일의 DOM 계약 8건이 세어지지 않음');
  skip('계약④-DOM(b): 소속 트리는 깊이×16px 로 들여쓰고 ▲▼ 는 형제끼리만 오간다', SKIP_NO_JSDOM);
  skip('계약④-DOM(c): 추가줄의 상위 후보는 활성 조직뿐이고, 안 고르면 [추가] 가 꺼진다', SKIP_NO_JSDOM);
  skip('계약④-DOM(d): admin:false 면 행도 컨트롤도 없다(안내 한 줄뿐)', SKIP_NO_JSDOM);
  skip('계약④-DOM(e): [상위 변경] 후보에 자기 자신도 자기 자손도 없다', SKIP_NO_JSDOM);
  skip('계약⑧-DOM: ▲▼ 는 맞바꾼 활성 배열 전체를 보낸다', SKIP_NO_JSDOM);
  skip('계약⑤-DOM: 왕복 중에는 잠기고, 회신의 갱신 목록이 otSeat 한 곳으로 앉는다', SKIP_NO_JSDOM);
  skip('계약⑤-DOM(b): 목록이 안 실려 온 회신은 화면을 건드리지 않는다', SKIP_NO_JSDOM);
  skip('계약⑥-DOM: 닫기 뒤처리는 「구성원 편집」이 열려 있을 때만 uaReload 한다', SKIP_NO_JSDOM);
  skip('변이②: 진입 문을 비관리자 조기 return 앞으로 올리면 계약② 가 실패한다', SKIP_NO_JSDOM);
  skip('변이③: otRender 에 .sort( 를 넣으면 계약③ 이 실패한다', SKIP_NO_JSDOM);
  skip('변이④: 재직자 사유를 지우면 계약④-DOM(a) 가 실패한다', SKIP_NO_JSDOM);
  skip('변이④-b: 들여쓰기를 깊이와 끊으면 계약④-DOM(b) 가 실패한다', SKIP_NO_JSDOM);
  skip('변이④-c: [상위 변경] 후보에서 자손을 빼지 않으면 계약④-DOM(e) 가 실패한다', SKIP_NO_JSDOM);
  skip('변이⑤: 회신의 갱신 목록을 안 앉히면 계약⑤-DOM 이 실패한다', SKIP_NO_JSDOM);
  skip('변이⑤-b: 왕복 중 두 번째 클릭을 조용히 버리면 계약⑤-DOM 이 실패한다', SKIP_NO_JSDOM);
  skip('변이⑥: closeOverlay 의 한 줄을 지우면 계약⑥ 이 실패한다', SKIP_NO_JSDOM);
  skip('변이⑦: 모듈 상태를 하나 더 늘리면 계약⑦ 이 실패한다', SKIP_NO_JSDOM);
  skip('변이⑧: ▲▼ 가 두 건만 보내면 계약⑧-DOM 이 실패한다', SKIP_NO_JSDOM);
} else {
  test('계약④-DOM(a): 직급 탭은 회신 순서대로 그리고 숨길 수 없는 행은 사유가 title 에 붙는다', () => dom.titleRows(app));
  test('계약④-DOM(b): 소속 트리는 깊이×16px 로 들여쓰고 ▲▼ 는 형제끼리만 오간다', () => dom.unitRows(app));
  test('계약④-DOM(c): 추가줄의 상위 후보는 활성 조직뿐이고, 안 고르면 [추가] 가 꺼진다', () => dom.addRow(app));
  test('계약④-DOM(d): admin:false 면 행도 컨트롤도 없다(안내 한 줄뿐)', () => dom.denyHasNoControls(app));
  test('계약④-DOM(e): [상위 변경] 후보에 자기 자신도 자기 자손도 없다', () => dom.moveCandidates(app));
  test('계약⑧-DOM: ▲▼ 는 맞바꾼 활성 배열 전체를 보낸다', () => dom.movePayload(app));
  test('계약⑤-DOM: 왕복 중에는 잠기고, 회신의 갱신 목록이 otSeat 한 곳으로 앉는다', async () => { await dom.writeRoundTrip(app); });
  test('계약⑤-DOM(b): 목록이 안 실려 온 회신은 화면을 건드리지 않는다', async () => { await dom.replyWithoutList(app); });
  test('계약⑥-DOM: 닫기 뒤처리는 「구성원 편집」이 열려 있을 때만 uaReload 한다', () => dom.afterClose(app));

  // ══════════════════════════════════════════════════════════════════
  //  변이 주입 — 위 계약이 실효성이 있는지 증명한다(안 잡으면 그 계약은 장식이다).
  //  각 변이마다 **통제군**(원본은 통과한다)을 함께 둔다.
  // ══════════════════════════════════════════════════════════════════

  test('변이②: 진입 문을 비관리자 조기 return 앞으로 올리면 계약② 가 실패한다', () => {
    const bad = mutate(app, '  if(!__uaAdmin) return;   // ★ 비관리자',
      "  mk('직급·소속 관리', 'uaOrgTitle', 'btn sm', () => openOrgTitle()).disabled = __uaSaving;\n  if(!__uaAdmin) return;   // ★ 비관리자");
    assert.throws(() => checks.entryIsAfterGuards(bad), /비관리자 조기 return \*\*앞\*\*에 있다/);
    assert.doesNotThrow(() => checks.entryIsAfterGuards(app));   // 통제군
  });

  test('변이③: otRender 에 .sort( 를 넣으면 계약③ 이 실패한다', () => {
    const bad = mutate(app, '  const rows = (unit ? otUnits() : otTitles()).filter(',
      '  const rows = (unit ? otUnits() : otTitles()).sort((a, b) => String(a.name).localeCompare(String(b.name))).filter(');
    assert.throws(() => checks.noSortInWeb(bad), /otRender 이 목록을 다시 정렬한다/);
    assert.doesNotThrow(() => checks.noSortInWeb(app));   // 통제군
  });

  test('변이④: 재직자 사유를 지우면 계약④-DOM(a) 가 실패한다(눌러 봐야 거부되는 버튼이 된다)', () => {
    const bad = mutate(app, "      else if(!unit && users > 0) why = '이 직급인 재직자가 ' + users + '명 있습니다 — 먼저 직급을 바꾸세요';",
      "      else if(false) why = '';");
    assert.throws(() => dom.titleRows(bad), /재직자 3명인 직급의 \[숨김\] 이 켜져 있다/);
    assert.doesNotThrow(() => dom.titleRows(app));   // 통제군
  });

  test('변이④-b: 들여쓰기를 깊이와 끊으면 계약④-DOM(b) 가 실패한다(트리가 평평해진다)', () => {
    const bad = mutate(app, "    if(unit) nmEl.style.paddingLeft = ((Number(it.depth) || 0) * 16) + 'px';",
      "    if(unit) nmEl.style.paddingLeft = '0px';");
    assert.throws(() => dom.unitRows(bad), /들여쓰기가 깊이×16px 이 아니다/);
    assert.doesNotThrow(() => dom.unitRows(app));   // 통제군
  });

  test('변이④-c: [상위 변경] 후보에서 자손을 빼지 않으면 계약④-DOM(e) 가 실패한다(트리가 끊긴다)', () => {
    const bad = mutate(app, '    if(!u || u.active === false || banned.has(String(u.orgId))) continue;',
      '    if(!u || u.active === false) continue;');
    assert.throws(() => dom.moveCandidates(bad), /자기 자신\(2\)이나 자손\(6·7\)이 남아 있다/);
    assert.doesNotThrow(() => dom.moveCandidates(app));   // 통제군
  });

  test('변이⑤: 회신의 갱신 목록을 안 앉히면 계약⑤-DOM 이 실패한다(고친 결과가 화면에 안 닿는다)', async () => {
    const bad = mutate(app, '  if(rep && rep.orgTitle) otSeat(rep.orgTitle);', '  if(false) otSeat(rep.orgTitle);');
    await assert.rejects(() => dom.writeRoundTrip(bad), /회신의 갱신 목록이 앉지 않았다/);
    await dom.writeRoundTrip(app);   // 통제군
  });

  test('변이⑤-b: 왕복 중 두 번째 클릭을 조용히 버리면 계약⑤-DOM 이 실패한다', async () => {
    const bad = mutate(app, "  if(__otSaving){ toast('처리 중입니다 — 잠시 후 다시 시도하세요', 'warn'); return null; }",
      '  if(__otSaving){ return null; }');
    await assert.rejects(() => dom.writeRoundTrip(bad), /두 번째 클릭이 조용히 버려졌다/);
    await dom.writeRoundTrip(app);   // 통제군
  });

  test('변이⑥: closeOverlay 의 한 줄을 지우면 계약⑥ 이 실패한다(닫아도 드롭다운이 옛 값이다)', () => {
    const bad = mutate(app, "  if(ov.id === 'orgTitleModal') otAfterClose();", '');
    assert.throws(() => checks.closeReloadsMembers(bad), /#orgTitleModal 의 뒤처리를 부르지 않는다/);
    assert.doesNotThrow(() => checks.closeReloadsMembers(app));   // 통제군
  });

  test('변이⑦: 모듈 상태를 하나 더 늘리면 계약⑦ 이 실패한다(요청 표·보류 큐가 그렇게 자란다)', () => {
    const bad = mutate(app, 'let __otData = null, __otTab = ', 'let __otPending = null;\nlet __otData = null, __otTab = ');
    assert.throws(() => checks.moduleStateIsFive(bad), /모듈 상태가 \[__otPending\] 이다|__ot 상태 선언이 2곳이다/);
    assert.doesNotThrow(() => checks.moduleStateIsFive(app));   // 통제군
  });

  test('변이⑧: ▲▼ 가 맞바꾼 둘만 보내면 계약⑧-DOM 이 실패한다(호스트가 낡은 화면으로 거부한다)', () => {
    const bad = mutate(app, "    otSend('unitReorder', { parentId: pid == null ? null : Number(pid), orgIds: arr.map(u => Number(u.orgId)) });",
      "    otSend('unitReorder', { parentId: pid == null ? null : Number(pid), orgIds: arr.slice(0, 1).map(u => Number(u.orgId)) });");
    assert.throws(() => dom.movePayload(bad), /소속 ▼ 의 페이로드가 계약과 다르다/);
    assert.doesNotThrow(() => dom.movePayload(app));   // 통제군
  });
}

// 형태 계약 쪽 변이 — jsdom 이 없어도 돈다(소스만 읽는다).
test('변이①: 마크업에 행 하나를 박아 두면 계약① 이 실패한다(권한과 무관하게 서는 컨트롤)', () => {
  const bad = mutate(app, '<div class="cust-list" id="otList" role="list" aria-label="직급·소속 목록"></div>',
    '<div class="cust-list" id="otList" role="list" aria-label="직급·소속 목록">' +
    '<div class="cust-row"><button data-otop="hide">숨김</button></div></div>');
  assert.throws(() => checks.markupHasNoRows(bad), /#otList 가 마크업에서 비어 있지 않다|행 버튼\(data-otop\)이 박혀 있다/);
  assert.doesNotThrow(() => checks.markupHasNoRows(app));   // 통제군
});

test('변이⑤-소스: 목록을 앉히는 문을 하나 더 만들면 계약⑤-소스 가 실패한다(한쪽만 낡는다)', () => {
  const bad = mutate(app, 'function otApplyData(d){\n  __otData = d || null;',
    'function otApplyData(d){\n  if(typeof d === "string") d = JSON.parse(d);\n  __otData = d || null;');
  assert.throws(() => checks.seatIsOneDoor(bad), /JSON\.parse 가 2곳이다/);
  assert.doesNotThrow(() => checks.seatIsOneDoor(app));   // 통제군
});
