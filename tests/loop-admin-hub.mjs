#!/usr/bin/env node
/* =====================================================================================
 * tests/loop-admin-hub.mjs — 「⚙ 관리」 화면(docs/ADMIN-HUB.md · 수용 R10) 실 위젯 라운드
 *
 * ★ 이 파일은 `node tests/run-tests.mjs` 의 기본 스위트에 **포함되지 않는다**(.test.mjs 가 아니다) · run-loops 에도
 *   아직 묶지 않았다 — 사람이 직접 돌린다. 실 위젯(관리자 로그인)이 있어야 하는 시험은 상시 게이트에 넣지 않는다.
 *
 * 무엇을 하나(한 라운드 H0~H7):
 *   H0 전제 — 9222 위젯 · 로그인 · 관리자(사용자 정보의 권한 회신 edit_role=admin). 아니면 판정 없음(exit 2).
 *   H1 「사용자 정보」 = 계정 · 권한 · 로그아웃뿐(docs/ADMIN-HUB-2.md J5) — 구성원 줄·「⚙ 관리」 카드가 없다. 권한 회신이 관리자인지 본다.
 *   H2 입구 ① ⋯ 메뉴(J1) — 실제로 ⋯ 를 눌러 「⚙ 관리 · 관리자」(「설정」 바로 위)를 누른다 → ⋯ 가 닫히고 관리 화면(마지막 항목) ·
 *      닫으면 ⋯ 로 돌아갈 자리. ☰ 는 원래대로(J2) — 누르는 동안만 'menu' 메시지를 가로채(삼켜) {cmd:'menu'} 하나인지 본다.
 *   H3 👥 사람 › 👤 구성원 — 실제 명부(#uaList)가 **관리 화면 오른쪽 칸 안에** 그려진다 · 보이는 오버레이는 관리 화면 + 도킹 창뿐 ·
 *      도킹 창의 사각형이 오른쪽 칸 안에 있다 · inert 가 칸 안에 번지지 않았다.
 *   H3b 이름·편집만(docs/ADMIN-HUB-3.md R1·R2 · 보기만 한다) — 왼쪽 두 휴지통 항목 = 「🗑 휴지통」(id gone · trash) · 위치 줄 ·
 *      📁 회사 과제 › 📁 공식 과제(도킹)의 상세·목록에 「캘린더에 추가 · ✓ 추가됨 · 제거」 · ✓ · 왼쪽 막대가 보이지 않는다(편집·숨김은 보인다).
 *   H3c 항목 분리(docs/ADMIN-HUB-4.md N4 · 보기만 한다) — 왼쪽 9개(사람 4 · 회사 과제 5) · 직급/소속/구분/상태가 그 탭으로 도킹 ·
 *      머리 제목 = 그 이름 · 화면 안 탭 전환 숨김 · 위치 줄 · 직급·소속 줄에 사용 개수 배지 없음(N1) · 꺼진 [숨김] = aria-disabled + 이유(N2).
 *      구분·상태는 고정 번호 2번 줄만 [숨김]이 잠긴다(CODE-TABLE-IDS §3). 그 버튼을 눌러도 확인창과 호스트 요청이 없다(이것만 누른다).
 *   H4 📁 회사 과제 › 🏭 발주처 — zz 발주처 하나를 **화면으로** 추가(＋ 추가) → 목록·DB(선택)에 생긴다.
 *   H5 같은 발주처를 **화면으로** 숨김 → 📁 회사 과제 › 🗑 휴지통 › 발주처 탭 → 영구 삭제(이름 입력) → 목록·휴지통·DB(선택)에서 사라진다.
 *      (2026-10-02 ADMIN-HUB-3 M2 — 항목 이름 「삭제된 항목」→「🗑 휴지통」 · 항목 id 는 그대로 trash.)
 *      ★ 가역 — 이 시험은 데이터를 남기지 않는다. 중간에 실패해도 마지막 정리(H7)가 같은 화면 길(숨김 → 영구 삭제)로 지운다.
 *   H6 Esc — 관리 화면이 닫히고 도킹 창은 제자리(body)로 돌아간다 · inert 가 남지 않는다.
 *   H7 복원 — 이 시험이 건드린 localStorage(tc_adminLast:*)를 시작 값으로 되돌린다 · 남은 zz 발주처 정리.
 *
 * 비밀번호:
 *   · DB 대조는 **선택**이다(TC_TEST_DB_ADMIN_PW 가 있을 때만). 화면 판정은 비밀번호 없이 돈다.
 *   · ★ 비밀번호를 명령줄 인자(-p…)로 넘기지 않는다 — 자식 프로세스의 **환경변수 MYSQL_PWD** 로만 준다(ps/작업관리자 명령줄에
 *     안 보인다). 다른 루프의 sql() 은 아직 -p 를 쓴다(그 파일들은 이 작업 범위 밖).
 *   · 이 스크립트는 비밀번호를 출력·저장하지 않는다.
 *
 * 전제(이 스크립트가 하지 않는 것): 위젯을 띄우거나 닫지 않는다 · 로그인을 대신하지 않는다 · 앱 코드를 고치지 않는다.
 *
 * 실행:
 *   node tests/loop-admin-hub.mjs [--seed=N] [--port=9222] [-v]
 *   (선택) $env:TC_TEST_DB_ADMIN_PW='...'; $env:TC_TEST_DB_NAME='taskcalendar'   — DB 대조까지
 *
 * 종료코드: 0 = 전부 통과 · 1 = 위반 있음 · 2 = 판정 없음(전제 미충족)
 * ===================================================================================== */

import { spawnSync } from 'node:child_process';

const ARG = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const OPT = {
  seed: Number(ARG.get('seed') || Date.now() % 100000),
  port: Number(ARG.get('port') || process.env.TC_DEBUG_PORT || 9222),
  verbose: ARG.has('verbose') || ARG.has('v'),
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  db: process.env.TC_TEST_DB_NAME || 'taskcalendar',
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',   // ← 비밀. 기본값 없음 · 없으면 DB 대조만 건너뛴다
};
if (ARG.has('help') || ARG.has('h')) {
  console.log(`사용법: node tests/loop-admin-hub.mjs [--seed=N] [--port=${OPT.port}] [-v]
  (선택) TC_TEST_DB_ADMIN_PW · TC_TEST_DB_NAME — 있으면 발주처 추가/삭제를 MySQL 로도 대조한다`);
  process.exit(0);
}
const ZZ = `zzC_hub${OPT.seed}`;   // zzC 접두 — loop-trash·loop-ui-integrity 의 정리 규칙(zzC%)과 같은 이름 공간
//  고정 번호 잠금 문장(ProjectDb.CodeIds 와 웹 CODE_PROTECT_WHY 와 글자까지 같다, CODE-TABLE-IDS §3)
const PROTECT_WHY = {
  section: '이 구분은 과제 날짜 규칙(선진행)에 쓰여 숨기거나 지울 수 없습니다. 이름은 바꿀 수 있습니다.',
  status: '이 상태는 목록 필터와 엑셀 강조(종료)에 쓰여 숨기거나 지울 수 없습니다. 이름은 바꿀 수 있습니다.',
};

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const log = (...a) => console.log(el(), ...a);
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   ·', ...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);

let pass = 0, fail = 0;
const FAILED = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(el(), `  ✓ ${name}`); return true; }
  fail++; FAILED.push(name + (detail ? ' — ' + detail : ''));
  console.log(el(), `  ✗ ${name}${detail ? ' — ' + String(detail).slice(0, 400) : ''}`);
  return false;
}
//  판정 없음 — 바로 끝내지 않고 던진다: 마지막 정리(localStorage 복원 · 남은 zz 발주처)는 언제나 돈다.
class NotDecided extends Error {}
function notDecided(msg) { throw new NotDecided(msg); }

/* ── (선택) MySQL — 비밀번호는 환경변수 MYSQL_PWD 로만 ── */
function sqlCount(q) {
  if (!OPT.adminPw) return null;
  const r = spawnSync(OPT.mysql, [`-u${OPT.adminUser}`, '--default-character-set=utf8mb4', '-N', '-B', '--connect-timeout=5', '-D', OPT.db],
    { input: Buffer.from(q + ';\n', 'utf8'), env: { ...process.env, MYSQL_PWD: OPT.adminPw }, windowsHide: true, timeout: 30000, maxBuffer: 1 << 20 });
  if (r.error || r.status !== 0) { log('  · DB 대조 실패(건너뜀):', String((r.error && r.error.message) || r.stderr || '').split('\n')[0]); return null; }
  const n = parseInt(String(r.stdout || '').trim().split(/\r?\n/).pop(), 10);
  return Number.isFinite(n) ? n : null;
}
const dbCust = () => sqlCount(`SELECT COUNT(*) FROM customer WHERE name = '${ZZ.replace(/'/g, "''")}'`);

/* ── 최소 CDP(loop-user-admin 과 같은 모양) ── */
class Cdp {
  #ws = null; #id = 0; #p = new Map(); #closed = false;
  static async attach(port) {
    let list;
    try { list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json(); }
    catch (e) { throw new Error(`CDP 에 붙지 못했다(포트 ${port}) — 위젯을 TC_DEBUG_PORT=${port} 로 먼저 띄우세요. 원인: ${e.message}`); }
    const t = (list || []).filter((x) => x.type === 'page' && x.webSocketDebuggerUrl && /tcapp\.local/i.test(x.url || '') && !/peer=1/.test(x.url || ''))[0];
    if (!t) throw new Error('부모 page 타겟이 없다 — 위젯이 떠 있고 로그인돼 있어야 한다');
    const c = new Cdp();
    const ws = new WebSocket(t.webSocketDebuggerUrl); c.#ws = ws;
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('WebSocket 연결 시간 초과')), 10000);
      ws.addEventListener('open', () => { clearTimeout(to); res(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(to); rej(new Error('WebSocket 연결 실패')); }, { once: true });
    });
    ws.addEventListener('close', () => { c.#closed = true; });
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.id == null) return;
      const p = c.#p.get(m.id); if (!p) return;
      c.#p.delete(m.id); clearTimeout(p.to);
      m.error ? p.rej(new Error('CDP: ' + m.error.message)) : p.res(m.result);
    });
    return c;
  }
  send(method, params = {}) {
    if (this.#closed) return Promise.reject(new Error('CDP 연결이 끊겼다(위젯 종료?)'));
    const id = ++this.#id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { this.#p.delete(id); rej(new Error('CDP 시간 초과: ' + method)); }, 40000);
      this.#p.set(id, { res, rej, to });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('페이지 JS 예외: ' + String((d.exception && (d.exception.description || d.exception.value)) || d.text).split('\n')[0]);
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.#ws && this.#ws.close(); } catch { } }
}
let cdp = null;
const ev = (e) => cdp.ev(e);
const evj = async (e) => JSON.parse(await cdp.ev(e));

/* ── 페이지 상태 한 덩어리 ── */
const PSTATE = `JSON.stringify({
  login: (typeof currentUser !== 'undefined' && currentUser) ? String(currentUser.loginId || '') : '',
  hub: isOverlayOpen(document.getElementById('adminHub')),
  item: (__ah && __ah.item) || '',
  docked: (function(){ var d = document.querySelector('#ahSlot > .overlay.docked'); return d ? d.id : ''; })(),
  stack: _modalStack.map(function(s){ return s.ov.id; }),
  visible: [].filter.call(document.querySelectorAll('.overlay'), function(o){ return getComputedStyle(o).display !== 'none'; }).map(function(o){ return o.id; }),
  role: (document.getElementById('usEditRole') || {}).textContent || '',
  usNoMembers: !document.getElementById('usMembersSec') && !document.getElementById('usUserAdmin') && !document.getElementById('usMembers') && !document.getElementById('usHubSec'),
  moreOpen: !document.getElementById('moreMenu').classList.contains('hidden'),
  mmAdmin: (function(){ var e = document.getElementById('mmAdmin'); return !!e && !e.classList.contains('hidden'); })(),
  userOpen: isOverlayOpen(document.getElementById('userModal')),
  uaLines: document.querySelectorAll('#ahSlot #userAdminModal #uaList .mba-line').length,
  uaBusy: !!__uaBusy,
  custRows: [].map.call(document.querySelectorAll('#ahSlot #customerModal #custList .cust-row'), function(r){ return String(r.dataset.name || ''); }),
  custLoading: /불러오는 중/.test((document.getElementById('custList') || {}).textContent || ''),
  custBusy: !!custBusy,
  trBusy: !!__trBusy, trSaving: !!__trSaving, trTab: String(__trTab || ''),
  trKeys: [].map.call(document.querySelectorAll('#ahSlot #trashModal #trList [data-top="delete"]'), function(b){ return String(b.dataset.tkey || ''); }),
  cfOpen: isOverlayOpen(document.getElementById('confirmModal')),
  ctOpen: isOverlayOpen(document.getElementById('confirmTypedModal')),
  inertInHub: !!document.querySelector('#adminHub [inert]') || !!(document.getElementById('adminHub') && document.getElementById('adminHub').closest('[inert]')),
  inertAny: document.querySelectorAll('[inert]').length
})`;
const pstate = () => evj(PSTATE);
async function waitPage(pred, { timeout = 15000, interval = 100 } = {}) {
  const t = Date.now();
  for (;;) {
    const s = await pstate();
    if (pred(s)) return s;
    if (Date.now() - t > timeout) { vlog('시간 초과 상태: ' + JSON.stringify(s).slice(0, 600)); return null; }
    await sleep(interval);
  }
}
const click = (sel) => ev(`(function(){ var b = document.querySelector(${J(sel)}); if(!b || b.disabled) return false; b.click(); return true; })()`);
const noStack = (s, docked) => JSON.stringify(s.stack) === J(['adminHub']) && JSON.stringify(s.visible.slice().sort()) === J(['adminHub', docked].sort());

/* ── 정리 길(화면 그대로): 숨김 → 영구 삭제 ── */
//  ★ v13(CODE-TABLE-IDS §4): 발주처 버튼(data-custhide)과 휴지통 키(data-tkey)는 이름이 아니라 번호(customer_id)다.
//    이름은 줄의 data-name 과 호스트 목록(loadCustomersFull 의 {id, name, active})으로만 찾는다.
const custIdByName = (name) => evj(`(async function(){ var r = await hostRequest('loadCustomersFull', {}, 20000);
  var row = r && r.ok ? JSON.parse(r.list || '[]').find(function(x){ return x && x.name === ${J(name)}; }) : null;
  return JSON.stringify(row ? String(row.id) : ''); })()`);
async function hideViaHub(name) {
  if (!(await click('#ahNav [data-ahitem="cust"]'))) return false;
  const s0 = await waitPage((x) => x.docked === 'customerModal' && !x.custLoading && !x.custBusy, { timeout: 20000 });
  if (!s0 || !s0.custRows.includes(name)) return !s0 ? false : 'absent';
  const hid = await ev(`(function(){ var rs = document.querySelectorAll('#custList .cust-row');
    for(var i=0;i<rs.length;i++){ if(String(rs[i].dataset.name || '') !== ${J(name)}) continue;
      var b = rs[i].querySelector('[data-custhide]'); if(!b || b.getAttribute('data-custhide') !== String(rs[i].dataset.id || '')) return false;
      b.click(); return true; } return false; })()`);
  if (!hid) return false;
  const s1 = await waitPage((x) => x.cfOpen || (!x.custBusy && !x.custLoading && !x.custRows.includes(name)), { timeout: 20000 });
  if (s1 && s1.cfOpen) { await click('#cfOk'); }
  return !!(await waitPage((x) => !x.cfOpen && !x.custBusy && !x.custLoading && !x.custRows.includes(name), { timeout: 20000 }));
}
async function purgeViaHub(name) {
  const key = await custIdByName(name);   // 휴지통 키 = customer_id 문자열
  if (!key) return 'absent';
  if (!(await click('#ahNav [data-ahitem="trash"]'))) return false;
  const s0 = await waitPage((x) => x.docked === 'trashModal' && !x.trBusy, { timeout: 20000 });
  if (!s0) return false;
  await click('#trTabs [data-trtab="customer"]');
  const s1 = await waitPage((x) => x.trTab === 'customer', { timeout: 6000 });
  if (!s1) return false;
  if (!s1.trKeys.includes(key)) return 'absent';
  const pressed = await ev(`(function(){ var bs = document.querySelectorAll('#trList [data-top="delete"]');
    for(var i=0;i<bs.length;i++) if(String(bs[i].dataset.tkey||'') === ${J(key)} && !bs[i].disabled){ bs[i].click(); return true; } return false; })()`);
  if (!pressed) return false;
  if (!(await waitPage((x) => x.ctOpen, { timeout: 8000 }))) return false;
  //  ★ 이 화면에서 쓰는 stack 판정(확인창은 관리 화면 **위**에 쌓인다 — 겹침이 아니라 확인창이다)
  const sc = await pstate();
  ok('H5 영구 삭제 확인창은 관리 화면 위에 쌓인다(body 의 뒤쪽 형제 · 칸 안이 아니다)',
    JSON.stringify(sc.stack) === J(['adminHub', 'confirmTypedModal']), J(sc.stack));
  await ev(`(function(){ var i = document.getElementById('ctInput'); i.value = ${J(name)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  await click('#ctOk');   // 확인창에는 번호가 아니라 이름을 친다(위 ctInput)
  return !!(await waitPage((x) => !x.ctOpen && !x.trSaving && !x.trKeys.includes(key), { timeout: 20000 }));
}

/* ── 본문 ── */
let LS0 = null;
async function main() {
  cdp = await Cdp.attach(OPT.port);
  log(`붙음(포트 ${OPT.port}) · seed=${OPT.seed} · 이름=${ZZ} · DB 대조 ${OPT.adminPw ? '켬(MYSQL_PWD)' : '끔'}`);
  //  H0 — 전제
  const s0 = await pstate();
  if (!s0.login) notDecided('위젯이 로그인돼 있지 않다');
  if (!(await ev(`typeof openAdminHub === 'function' && !!document.getElementById('adminHub')`))) notDecided('이 위젯에는 「⚙ 관리」 화면이 없다(옛 빌드)');
  LS0 = await evj(`JSON.stringify(Object.keys(localStorage).filter(function(k){ return /^tc_adminLast:/.test(k); }).reduce(function(o,k){ o[k] = localStorage.getItem(k); return o; }, {}))`);
  await ev(`(function(){ document.querySelectorAll('.overlay').forEach(function(o){ if(isOverlayOpen(o)) closeOverlay(o); }); return 1; })()`);
  await sleep(400);

  //  H1 — 사용자 정보(J5)
  log('H1 「사용자 정보」 — 계정 · 권한 · 로그아웃뿐');
  await ev(`openUserInfo(), 1`);
  const s1 = await waitPage((x) => x.userOpen && /관리자/.test(x.role), { timeout: 15000 });
  if (!s1) notDecided('권한 회신이 관리자가 아니다 — 관리자(edit_role=admin) 계정으로 돌린다');
  ok('H1 사용자 정보에 구성원 줄·「⚙ 관리」 카드가 없다(J5)', s1.usNoMembers === true);
  await ev(`closeOverlay(document.getElementById('userModal')), 1`);
  await waitPage((x) => !x.userOpen, { timeout: 5000 });

  //  H2 — 입구 ① ⋯ 메뉴(J1) · ☰ 원복(J2)
  log('H2 입구 ① ⋯ → 「⚙ 관리」 · ☰ 는 원래대로');
  const sent = await evj(`JSON.stringify((function(){
    var wv = window.chrome && window.chrome.webview; if(!wv) return null;
    var orig = wv.postMessage, got = [];
    wv.postMessage = function(m){ try{ var o = typeof m === 'string' ? JSON.parse(m) : m; if(o && o.cmd === 'menu'){ got.push(o); return; } }catch(_){} return orig.apply(this, arguments); };
    try{ document.querySelector('#hostbar button[data-host="menu"]').click(); } finally { wv.postMessage = orig; }
    return got; })())`);
  ok('H2 ☰ = {cmd:"menu"} 하나(J2 — admin 필드 없음)', J(sent) === J([{ cmd: 'menu' }]), J(sent));
  await ev(`(document.getElementById('btnMore').focus(), document.getElementById('btnMore').click(), 1)`);
  const s2 = await waitPage((x) => x.moreOpen && x.mmAdmin, { timeout: 8000 });
  ok('H2 ⋯ 메뉴에 「⚙ 관리 · 관리자」(관리자) · 「설정」 바로 위', !!s2 && await ev(`/⚙ 관리\\s*관리자/.test(document.getElementById('btnAdminHub').textContent) && document.getElementById('mmAdmin').nextElementSibling.id === 'btnSettings'`));
  const last0 = await ev(`localStorage.getItem('tc_adminLast:' + currentUser.loginId) || 'members'`);
  const last = ({ orgtitle: 'title', codes: 'section' })[last0] || last0;   // 옛 기억값은 별칭으로 연다(ADMIN-HUB-4 N5)
  await click('#btnAdminHub');
  const s2b = await waitPage((x) => x.hub && !!x.docked && !x.moreOpen, { timeout: 15000 });
  ok('H2 ⋯ 가 닫히고 관리 화면이 마지막 항목으로 열린다', !!s2b && s2b.item === last, s2b && J({ item: s2b.item, last, more: s2b.moreOpen }));
  ok('H2 닫으면 ⋯ 로 돌아갈 자리', await ev(`(function(){ var s = _modalStack.find(function(x){ return x.ov.id === 'adminHub'; }); return !!(s && s.opener && s.opener.id === 'btnMore'); })()`));

  //  H3 — 구성원
  log('H3 👥 사람 › 👤 구성원 — 명부가 관리 화면 안에');
  await click('#ahNav [data-ahitem="members"]') || await ev(`(document.getElementById('ahGrpPeople').click(), document.querySelector('#ahNav [data-ahitem="members"]').click(), 1)`);
  const s3 = await waitPage((x) => x.docked === 'userAdminModal' && !x.uaBusy && x.uaLines > 0, { timeout: 20000 });
  ok('H3 구성원 명부(#uaList)가 오른쪽 칸 안에 그려졌다', !!s3, s3 && `행 ${s3.uaLines}`);
  if (s3) {
    ok('H3 겹침 없음 — 스택 = 관리 화면 · 보이는 오버레이 = 관리 화면 + 구성원 편집', noStack(s3, 'userAdminModal'), J({ stack: s3.stack, visible: s3.visible }));
    const geo = await evj(`JSON.stringify((function(){ var a = document.getElementById('ahSlot').getBoundingClientRect(), b = document.querySelector('#userAdminModal > .modal').getBoundingClientRect();
      var cs = getComputedStyle(document.querySelector('#userAdminModal > .modal'));
      return { inside: b.left >= a.left - 1 && b.top >= a.top - 1 && b.right <= a.right + 1 && b.bottom <= a.bottom + 1, shadow: cs.boxShadow, radius: cs.borderTopLeftRadius,
               x: getComputedStyle(document.querySelector('#userAdminModal .modal-head > .x')).display }; })())`);
    ok('H3 도킹 창 사각형이 오른쪽 칸 안 · 그림자/둥근 테두리/× 없음(창 위의 창이 아니다)', geo.inside && geo.shadow === 'none' && geo.radius === '0px' && geo.x === 'none', J(geo));
    ok('H3 inert 가 관리 화면 안으로 번지지 않았다', !s3.inertInHub);
  }

  //  H3b — 이름(R2) · 관리 화면의 공식 과제 = 편집만(R1) — **보기만 한다**(아무것도 누르지 않는다: 캘린더 추가·편집·숨김 없음)
  log('H3b 두 휴지통 이름 · 위치 줄 · 공식 과제(도킹)에 내 캘린더 표시 없음');
  {
    const names = await evj(`JSON.stringify(['gone','trash'].map(function(k){ var b = document.querySelector('#ahNav [data-ahitem="' + k + '"]'); return b ? b.textContent.replace(/\\d+$/, '').trim() : null; }))`);
    ok('H3b 왼쪽 두 휴지통 항목 = 「🗑휴지통」(사람 · 회사 과제)', names.every((t) => t && /^🗑\s*휴지통$/.test(t)), J(names));
    await click('#ahNav [data-ahitem="gone"]');
    const sg = await waitPage((x) => x.docked === 'trashModal' && !x.trBusy, { timeout: 20000 });
    const wg = await ev(`(document.getElementById('ahWhere').textContent || '').replace(/\\s+/g, ' ').trim()`);
    ok('H3b 사람 휴지통 위치 줄 「👥 사람 › 🗑 휴지통」 · 탭 구성원 · 직급 · 소속(ADMIN-HUB-4 N6)', !!sg && /👥 사람 ›\s*🗑 휴지통/.test(wg)
      && J(await evj(`JSON.stringify([].map.call(document.querySelectorAll('#trTabs [data-trtab]'), function(b){ return b.dataset.trtab; }))`)) === J(['user', 'title', 'unit']), wg);
    await click('#ahGrpProj');
    await click('#ahNav [data-ahitem="projects"]');
    const sp = await waitPage((x) => x.docked === 'officialModal', { timeout: 15000 });
    //  내 캘린더에 든 공식 과제가 있으면 그것을, 없으면 첫 행을 고른다(offSelect — 선택은 쓰기가 아니다)
    const m1 = sp && await evj(`JSON.stringify((function(){
      var rows = [].slice.call(document.querySelectorAll('#offList .off-row')); if(!rows.length) return { rows: 0 };
      var r = rows.find(function(x){ return x.classList.contains('subbed'); }) || rows[0];
      offSelect(r.dataset.id);
      var vis = function(el){ return !!el && getComputedStyle(el).display !== 'none'; };
      var sub = document.querySelector('#offDetail .off-d-sub'), act = document.querySelector('#offDetail .off-d-act');
      var subbed = document.querySelectorAll('#offList .off-row.subbed');
      return { rows: rows.length, subbedRows: subbed.length,
        sub: vis(sub), act: vis(act), tick: [].some.call(document.querySelectorAll('#offList .off-subtick'), vis),
        bar: [].some.call(subbed, function(x){ return getComputedStyle(x).boxShadow !== 'none'; }) }; })())`);
    if (!m1 || !m1.rows) log('H3b 공식 과제 목록이 비어 있다(오프라인?) — 표시 판정 생략');
    else {
      ok('H3b 관리 화면 공식 과제 상세에 「캘린더에 추가 · ✓ 추가됨 · 제거」가 보이지 않는다(R1)', m1.sub === false, J(m1));
      ok('H3b 관리 화면 공식 과제 상세에 편집 · 숨김은 보인다(R1)', m1.act === true, J(m1));
      if (m1.subbedRows) ok('H3b 관리 화면 공식 과제 목록에 ✓ · 왼쪽 막대가 없다(R1)', m1.tick === false && m1.bar === false, J(m1));
      else log('H3b 내 캘린더에 든 공식 과제가 없다 — ✓ · 왼쪽 막대 판정 생략');
    }
  }

  //  H3c — 항목 분리(N4) · 배지 없음(N1) · 꺼진 숨김의 이유(N2) — 보기만 한다(아무것도 누르지 않는다: 숨김·순서 없음)
  log('H3c 항목 9개 · 직급/소속/구분/상태 = 그 탭으로 도킹 · 제목 · 탭 전환 숨김 · 배지 없음 · 꺼진 숨김 이유');
  {
    const items = await evj(`JSON.stringify([].map.call(document.querySelectorAll('#ahNav [data-ahitem]'), function(b){ return b.dataset.ahitem; }))`);
    ok('H3c 왼쪽 항목 9개 = 사람 4 · 회사 과제 5', J(items) === J(['members', 'title', 'unit', 'gone', 'projects', 'cust', 'section', 'status', 'trash']), J(items));
    const SPEC = [['title', 'orgTitleModal', '직급', 'people'], ['unit', 'orgTitleModal', '소속', 'people'], ['section', 'codeModal', '구분', 'proj'], ['status', 'codeModal', '상태', 'proj']];
    for (const [it, ov, nm, grp] of SPEC) {
      await click(grp === 'proj' ? '#ahGrpProj' : '#ahGrpPeople');
      await click(`#ahNav [data-ahitem="${it}"]`);
      const s = await waitPage((x) => x.docked === ov && x.item === it, { timeout: 20000 });
      await sleep(400);
      const v = await evj(`JSON.stringify((function(){ var o = document.getElementById(${J(ov)});
        var tabs = o.querySelector('.code-tabs');
        return { head: o.querySelector('.modal-head h2').textContent, tabs: !!tabs && getComputedStyle(tabs).display !== 'none',
          where: (document.getElementById('ahWhere').textContent || '').replace(/\\s+/g, ' ').trim(),
          kind: ${J(ov)} === 'orgTitleModal' ? __otTab : codeKind,
          badges: o.querySelectorAll('#otList .ot-cnt, #otList .badge').length,
          hides: [].map.call(o.querySelectorAll('#otList [data-otop="hide"][aria-disabled="true"]'), function(b){
            var d = document.getElementById(b.getAttribute('aria-describedby') || ''); return { t: b.title, d: d ? d.textContent : null, dis: b.disabled }; }),
          codeRows: o.querySelectorAll('#codeList .cust-row').length,
          locks: [].map.call(o.querySelectorAll('#codeList [data-codelock="1"]'), function(b){
            var d = document.getElementById(b.getAttribute('aria-describedby') || ''), r = b.closest('.cust-row');
            return { id: b.getAttribute('data-codehide'), rowId: r ? String(r.dataset.id || '') : null, aria: b.getAttribute('aria-disabled'),
                     t: b.title, d: d ? d.textContent : null, dis: b.disabled }; }) }; })())`);
      ok(`H3c ${nm}: 그 탭으로 도킹 · 제목 「${nm}」 · 화면 안 탭 전환 숨김 · 위치 줄`, !!s && v.kind === it && v.head === nm && v.tabs === false && v.where.endsWith(nm), J(v));
      if (ov === 'orgTitleModal') {
        ok(`H3c ${nm}: 줄에 사용 개수 배지가 없다(N1)`, v.badges === 0, String(v.badges));
        if (v.hides.length) ok(`H3c ${nm}: 꺼진 [숨김] = aria-disabled(포커스 가능) + title = aria-describedby 문장 「…있어 숨길 수 없습니다」(N2)`,
          v.hides.every((h) => !h.dis && h.t && h.t === h.d && /숨길 수 없습니다/.test(h.t)), J(v.hides.slice(0, 3)));
        else log(`H3c ${nm}: 숨길 수 없는 줄이 없다 — N2 판정 생략`);
      } else if (!v.codeRows) log(`H3c ${nm}: 코드 목록이 비어 있다(오프라인?), 고정 번호 잠금 판정 생략`);
      else {
        //  고정 번호 잠금(CODE-TABLE-IDS §3): 구분 2(선진행), 상태 2(종료)만 [숨김]이 꺼진다. 이유 문장은 호스트 거부 문장과 같다.
        const want = PROTECT_WHY[it];
        ok(`H3c ${nm}: 꺼진 [숨김]은 2번 줄 하나뿐 = data-codelock + aria-disabled(포커스 가능) + title = aria-describedby = 고정 문장`,
          v.locks.length === 1 && v.locks.every((h) => h.id === '2' && h.rowId === '2' && h.aria === 'true' && !h.dis && h.t === want && h.d === want),
          J(v.locks));
        //  눌러도 아무것도 나가지 않는다. 누르는 동안만 hostRequest 를 감싸 명령을 센다(원본은 그대로 부른다).
        if (v.locks.length) {
          const pressed = await evj(`(async function(){
            var oH = window.hostRequest, got = [];
            window.hostRequest = function(cmd){ got.push(String(cmd)); return oH.apply(this, arguments); };
            try{ var b = document.querySelector('#codeList [data-codelock="1"]'); if(b) b.click(); await new Promise(function(r){ setTimeout(r, 600); }); }
            finally { window.hostRequest = oH; }
            return JSON.stringify({ got: got, cf: isOverlayOpen(document.getElementById('confirmModal')) }); })()`);
          ok(`H3c ${nm}: 꺼진 [숨김]을 눌러도 확인창도 호스트 요청도 없다`, pressed.got.length === 0 && pressed.cf === false, J(pressed));
          if (pressed.cf) await ev(`(function(){ var b = document.querySelector('#confirmModal [data-close]'); if(b) b.click(); return 1; })()`);
        }
      }
    }
  }

  //  H4 — 발주처 추가(화면)
  log(`H4 📁 회사 과제 › 🏭 발주처 — '${ZZ}' 추가`);
  await click('#ahGrpProj');
  await click('#ahNav [data-ahitem="cust"]');
  const s4 = await waitPage((x) => x.docked === 'customerModal' && !x.custLoading && !x.custBusy, { timeout: 20000 });
  ok('H4 발주처 목록이 오른쪽 칸 안에 그려졌다', !!s4 && s4.custRows.length > 0, s4 && `행 ${s4.custRows.length}`);
  if (s4 && s4.custRows.includes(ZZ)) notDecided(`'${ZZ}' 가 이미 있다 — 다른 --seed 로 돌리세요`);
  if (s4) ok('H4 겹침 없음(관리 화면 + 발주처)', noStack(s4, 'customerModal'), J({ stack: s4.stack, visible: s4.visible }));
  const db0 = dbCust();
  await ev(`(function(){ var i = document.getElementById('custNewName'); i.value = ${J(ZZ)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  await click('#custAddBtn');
  const s4b = await waitPage((x) => !x.custBusy && !x.custLoading && x.custRows.includes(ZZ), { timeout: 20000 });
  ok(`H4 화면으로 추가 → 목록에 '${ZZ}'`, !!s4b);
  const db1 = dbCust();
  if (db1 !== null) ok('H4 DB 대조 — customer 에 1행', db0 === 0 && db1 === 1, `전 ${db0} · 후 ${db1}`);

  //  H5 — 숨김 → 영구 삭제(화면) = 원복
  log(`H5 '${ZZ}' 숨김 → 📁 회사 과제 › 🗑 휴지통 › 발주처 → 영구 삭제`);
  const hidden = await hideViaHub(ZZ);
  ok('H5 화면으로 숨김 → 활성 목록에서 빠졌다', hidden === true, String(hidden));
  const purged = await purgeViaHub(ZZ);
  ok('H5 회사 과제 휴지통에서 영구 삭제 → 휴지통에서도 사라졌다', purged === true, String(purged));
  const s5 = await pstate();
  ok('H5 겹침 없음(관리 화면 + 휴지통)', noStack(s5, 'trashModal'), J({ stack: s5.stack, visible: s5.visible }));
  const db2 = dbCust();
  if (db2 !== null) ok('H5 DB 대조 — customer 에서 0행(원복)', db2 === 0, `후 ${db2}`);
  const hostList = await evj(`(async function(){ var r = await hostRequest('loadCustomersFull', {}, 20000); return JSON.stringify(r && r.ok ? JSON.parse(r.list || '[]').map(function(x){ return x.name; }) : null); })()`);
  ok(`H5 호스트 목록(loadCustomersFull)에 '${ZZ}' 가 없다`, Array.isArray(hostList) && !hostList.includes(ZZ));

  //  H6 — Esc
  log('H6 Esc — 관리 화면 닫힘 · 제자리 · inert 없음');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  const s6 = await waitPage((x) => !x.hub && !x.docked, { timeout: 5000 });
  ok('H6 Esc 로 관리 화면이 닫혔다', !!s6);
  ok('H6 도킹 창이 제자리(body 직계)로 돌아갔다', await ev(`['userAdminModal','orgTitleModal','trashModal','officialModal','customerModal','codeModal'].every(function(id){ var e = document.getElementById(id); return e.parentElement === document.body && !e.classList.contains('docked'); })`));
  ok('H6 inert 가 남지 않았다', !!s6 && s6.inertAny === 0, s6 && String(s6.inertAny));
}

async function cleanup() {
  if (!cdp) return;
  try {
    //  남은 zz 발주처 — 같은 화면 길로(숨김 → 영구 삭제). 이미 없으면 아무것도 안 한다.
    const left = await evj(`(async function(){ var r = await hostRequest('loadCustomersFull', {}, 20000); return JSON.stringify(r && r.ok ? JSON.parse(r.list || '[]').filter(function(x){ return x.name === ${J(ZZ)}; }) : []); })()`);
    if (left.length) {
      log(`정리 — 남은 '${ZZ}' 를 지운다`);
      await ev(`openAdminHub('cust'), 1`); await sleep(300);
      if (left[0].active !== false) await hideViaHub(ZZ);
      await purgeViaHub(ZZ);
      const again = await evj(`(async function(){ var r = await hostRequest('loadCustomersFull', {}, 20000); return JSON.stringify(r && r.ok ? JSON.parse(r.list || '[]').some(function(x){ return x.name === ${J(ZZ)}; }) : true); })()`);
      ok(`정리 — '${ZZ}' 가 남지 않았다`, again === false);
    }
    await ev(`(function(){ var h = document.getElementById('adminHub'); if(isOverlayOpen(h)) closeOverlay(h); return 1; })()`);
    await sleep(300);
    if (LS0) {
      await ev(`(function(){ var want = ${J(LS0)};
        Object.keys(localStorage).filter(function(k){ return /^tc_adminLast:/.test(k); }).forEach(function(k){ if(!(k in want)) localStorage.removeItem(k); });
        Object.keys(want).forEach(function(k){ localStorage.setItem(k, want[k]); }); return 1; })()`);
      log('복원 — tc_adminLast:* 를 시작 값으로 되돌렸다');
    }
  } catch (e) { log('정리 중 오류: ' + e.message); fail++; FAILED.push('정리: ' + e.message); }
  cdp.close();
}

let undecided = '';
try { await main(); }
catch (e) {
  if (e instanceof NotDecided) undecided = e.message;
  else { fail++; FAILED.push('예외: ' + e.message); log('예외: ' + e.message); }
}
finally { await cleanup(); }
console.log(`\n${pass} pass / ${fail} fail  (${((Date.now() - T0) / 1000).toFixed(1)}s)`);
if (FAILED.length) console.log(FAILED.map((f) => '  ✗ ' + f).join('\n'));
if (fail) process.exit(1);
if (undecided) { console.error('[판정 없음] ' + undecided); process.exit(2); }
process.exit(0);
