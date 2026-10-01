#!/usr/bin/env node
/* =====================================================================================
 *  tests/loop-offline.mjs — 서버(DB) 연결 장애 대응 **실동작** 루프(docs/OFFLINE-RESILIENCE.md §7·§8)
 * -------------------------------------------------------------------------------------
 *  계약 시험(offline-web · offline-host)은 jsdom·소스 대조로 **규칙**을 잠근다. 이 루프는 실제 위젯에
 *  장애를 주입해(호스트 명령 __dbFault — TC_DEBUG_PORT 실행에서만 받는다) 그 규칙이 **실제 호스트·실 DB**
 *  위에서도 성립하는지 본다. 영속은 DB 를 직접 보지 않고 **앱을 통해** 확인한다 — 장애를 걷은 뒤
 *  reloadState 를 보내 호스트가 다시 읽어 준 state(__applyState)에서 센다(호스트 → DB → 호스트 → 웹 왕복).
 *
 *  케이스 ↔ 수용 기준(§8):
 *    O0        전제 — __dbFault{off} 가 ok(아니면 디버그 실행이 아니다 → 판정 불가) · conn ok · bootOk · 기준선
 *    O1  A1    network → reloadState → 연결 상자(네트워크 문구) · 잠금 · 새 기록 진입점 토스트 · 메모리 변화 0
 *    O2  A2    장애 해제 → 25초 안 자동 복구(상자 없음 · conn ok · bootOk · 과제 목록 다시 읽힘)
 *    O1b A3    빠른 3회 실패(실제 호스트 실패를 [수동 재시도]로 앞당겨) 뒤 300초 꼬리가 예약돼 있다 → [다시 시도]로 복구
 *    O1s §4    잠금 중 save() 의 마지막 방어(부팅 뒤) — 보내지 않고 메모리에 남긴다 → 복구되면 **그 편집이 함께 간다**
 *    O3  A5    사용 중 network → 편집 1건 → 막대 · unsavedState · 추가 편집 잠김 → 해제 → 자동 저장 · DB 에 1건
 *    O4  A4    auth → 접근 거부 문구 · db@host · 자동 재시도 0(16초 관찰) → 해제 → [다시 시도] 로 복구
 *    O5  A6    commit-lost → 저장 실패(network, 그러나 COMMIT 은 됨) → 복구 저장이 resolvedConflict · 충돌 상자 없음 · DB 에 1건
 *    O6  A11   정상 상태 45초 관찰 — dbPing 0 · reloadState 0 · 재연결 타이머 없음 · 호스트 로그 「DB 핑」 0
 *    (A10 은 정적 계약 — offline-host.test.mjs. A7 닫기 경고는 네이티브 MessageBox 라 여기서 누르지 않는다 — 수동 1회.)
 *    정리      zz 기록을 앱으로 지우고(deleteEntry → save) reloadState → 잔재 0 · 기록 수 = 기준선
 *
 *  ★ 시험 데이터는 zz 접두 기록만 쓴다(제목 `zzOFF-<seed>-<n>`). 끝나면(중단돼도) 앱으로 지운다.
 *  ★ finally 에서 **반드시** 장애 주입을 off 로 되돌리고, conn ok · bootOk 로 돌아올 때까지 기다린다(못 하면 크게 경고).
 *  ★ DB 에 직접 붙지 않는다 — 비밀번호가 필요 없다.
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 로그인된 채 띄운 뒤(예: powershell -File dist/promo/win.ps1 start)
 *    node tests/loop-offline.mjs [--seed=N] [--port=9222] [-v]
 *    종료코드: 0 통과 · 1 실패 · 2 판정 불가(전제가 안 서서 증명하지 못함 — 초록 아님)
 * ===================================================================================== */
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ARG = new Map(process.argv.slice(2).map((a) => {
  const m = /^--?([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const OPT = {
  seed: Number(ARG.get('seed') || Date.now() % 100000),
  port: Number(ARG.get('port') || process.env.TC_DEBUG_PORT || 9222),
  verbose: ARG.has('verbose') || ARG.has('v'),
};
if (ARG.has('help') || ARG.has('h')) {
  console.log(`사용법: node tests/loop-offline.mjs [--seed=N] [--port=${OPT.port}] [-v]`);
  process.exit(0);
}
const ZZ = `zzOFF-${OPT.seed}-`;
const LOG_FILE = join(process.env.APPDATA || '', 'TaskCalendar', 'widget.log');

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   ·', ...a); };

let pass = 0, fail = 0, undecided = 0;
const F = [], UD = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`${el()}   ✓ ${n}${d && OPT.verbose ? ' — ' + d : ''}`); return true; }
  fail++; F.push(n + (d ? ' — ' + d : ''));
  console.log(`${el()}   ✗ ${n}${d ? ' — ' + String(d).slice(0, 300) : ''}`); return false;
};
const undecide = (n, d = '') => { undecided++; UD.push(n + (d ? ' — ' + d : '')); console.log(`${el()}   ? ${n} — 판정 불가${d ? ': ' + d : ''}`); };
const note = (m) => console.log(`${el()}   · ${m}`);
const head = (m) => console.log(`\n${el()} [${m}]`);

/* ── 최소 CDP(다른 루프와 같은 모양) ─────────────────────────────────── */
class Cdp {
  #ws = null; #id = 0; #p = new Map();
  static async attach(port) {
    let list;
    try { list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json(); }
    catch (e) { throw new Error(`CDP 에 붙지 못했다(포트 ${port}) — 위젯을 TC_DEBUG_PORT=${port} 로 띄웠나요? (${e.message})`); }
    const t = (list || []).filter((x) => x.type === 'page' && x.webSocketDebuggerUrl)
      .find((x) => /tcapp\.local/i.test(x.url || '') && !/peer=1/.test(x.url || ''));
    if (!t) throw new Error(`CDP page 타겟이 없습니다(포트 ${port})`);
    const c = new Cdp();
    const ws = new WebSocket(t.webSocketDebuggerUrl); c.#ws = ws;
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('WS 시간 초과')), 10000);
      ws.addEventListener('open', () => { clearTimeout(to); res(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(to); rej(new Error('WS 실패')); }, { once: true });
    });
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id == null) return;
      const p = c.#p.get(m.id); if (!p) return;
      c.#p.delete(m.id); clearTimeout(p.to);
      m.error ? p.rej(new Error('CDP: ' + m.error.message)) : p.res(m.result);
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { this.#p.delete(id); rej(new Error('CDP 시간 초과: ' + method)); }, 60000);
      this.#p.set(id, { res, rej, to });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('페이지 JS 예외: ' + String((d.exception && (d.exception.description || d.exception.value)) || d.text));
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.#ws.close(); } catch { } }
}

let cdp = null;
const J = (expr) => cdp.ev(`Promise.resolve(${expr}).then(function(v){ return JSON.stringify(v); })`).then((s) => (s == null ? null : JSON.parse(s)));

//  조건이 참이 될 때까지 기다린다. 시간이 다 되면 false(던지지 않는다 — 판정은 ok() 가 한다).
async function waitFor(expr, ms, every = 250) {
  const t = Date.now();
  for (;;) {
    let v = false;
    try { v = await cdp.ev(`!!(${expr})`); } catch (_) { v = false; }
    if (v) return true;
    if (Date.now() - t >= ms) return false;
    await sleep(every);
  }
}

/* ── 페이지 기록기 — hostRequest·hpost·toast·__applyState·__applyStateError 를 감싼다(원본을 그대로 부른다) ── */
//  ★ 감싸기만 한다 — 동작은 바꾸지 않는다. finally 에서 반드시 원본으로 되돌린다.
const INSTALL = `(function(){
  if (window.__offRec) return 'already';
  const R = window.__offRec = { log: [], orig: { hostRequest: hostRequest, hpost: hpost, toast: toast,
    applyState: window.__applyState, applyErr: window.__applyStateError } };
  hostRequest = function(cmd, params, t){
    const rec = { t: Date.now(), req: cmd };
    if (cmd === '__dbFault') rec.mode = params && params.mode;
    R.log.push(rec);
    return R.orig.hostRequest(cmd, params, t).then(function(res){
      rec.done = Date.now();
      rec.res = (cmd === 'saveState' || cmd === 'replaceAllState' || cmd === 'dbPing' || cmd === '__dbFault') ? res : { ok: !!(res && res.ok) };
      return res;
    });
  };
  hpost = function(o){ if (o && !o.reqId) R.log.push({ t: Date.now(), post: o.cmd, on: o.on }); return R.orig.hpost(o); };
  toast = function(m, k, a, ms){ R.log.push({ t: Date.now(), toast: String(m), kind: k }); return R.orig.toast(m, k, a, ms); };
  window.__applyState = function(j, m){ R.log.push({ t: Date.now(), applied: true, rev: m && m.rev }); return R.orig.applyState(j, m); };
  window.__applyStateError = function(msg, opt){ R.log.push({ t: Date.now(), applyErr: String(msg), kind: opt && opt.kind }); return R.orig.applyErr(msg, opt); };
  return 'ok';
})()`;
const UNINSTALL = `(function(){
  const R = window.__offRec; if (!R) return 'none';
  hostRequest = R.orig.hostRequest; hpost = R.orig.hpost; toast = R.orig.toast;
  window.__applyState = R.orig.applyState; window.__applyStateError = R.orig.applyErr;
  delete window.__offRec; return 'ok';
})()`;
const mark = () => cdp.ev('__offRec.log.length');
const since = (m) => J(`__offRec.log.slice(${Number(m)})`);
const reqs = (L, cmd) => L.filter((x) => x.req === cmd);
const posts = (L, cmd) => L.filter((x) => x.post === cmd);
const toasts = (L) => L.filter((x) => x.toast).map((x) => x.toast);

/* ── 앱 조작 ────────────────────────────────────────────────────────── */
const LOCK_MSG = '서버에 연결되지 않아 지금은 편집할 수 없습니다';
const snapConn = () => J(`({ conn: conn, bootOk: bootOk, unsaved: unsaved, locked: editLocked(), loop: __connLoop,
  box: !!document.getElementById('dsError'), boxText: (document.getElementById('dsErrorText') || {}).textContent || '',
  bar: !!document.getElementById('dbUnsaved'), barText: (document.getElementById('dbUnsavedText') || {}).textContent || '',
  conflict: !!document.getElementById('dbConflict'), dbLocked: document.body.classList.contains('db-locked'),
  boot: __bootRetry ? __bootRetry.state() : null, ping: __pingRetry ? __pingRetry.state() : null,
  entries: (state.entries || []).length, todos: (state.todos || []).length, catalog: (dbCatalog || []).length,
  rev: (__bootMeta && __bootMeta.rev), saving: __dbSaving, dirty: __dbDirty })`);
const isHealthy = 'conn === "ok" && bootOk === true && !unsaved && !document.getElementById("dsError") && !document.getElementById("dbUnsaved")';

async function fault(mode) {
  return J(`hostRequest('__dbFault', { mode: ${JSON.stringify(mode)} }, 8000)`);
}
//  reloadState(회신 없는 명령) → 그 결과(__applyState 또는 __applyStateError)가 올 때까지 기다린다.
async function reload(ms = 20000) {
  const m = await mark();
  await cdp.ev(`hpost({ cmd: 'reloadState' }); 1`);
  const t = Date.now();
  while (Date.now() - t < ms) {
    const L = await since(m);
    const r = L.find((x) => x.applied || x.applyErr);
    if (r) { await sleep(150); return r.applied ? 'applied' : 'error'; }
    await sleep(200);
  }
  return 'timeout';
}
const zzList = () => J(`(state.entries || []).filter(function(e){ return String(e.title || '').indexOf('zzOFF-') === 0; })
  .map(function(e){ return { id: e.id, title: e.title }; })`);
const countTitle = async (title) => (await zzList()).filter((e) => e.title === title).length;
const saveIdle = () => waitFor('!__dbSaving && !__dbDirty', 30000, 200);
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const DATE = todayIso();
const addZz = (n) => J(`(function(){ const e = addEntry({ date: ${JSON.stringify(DATE)}, title: ${JSON.stringify(ZZ + n)}, allDay: true }); return { id: e.id, title: e.title }; })()`);

//  zz 기록을 앱으로 지운다(deleteEntry → save). 잠겨 있으면 하지 않는다(그 편집은 갈 곳이 없다).
async function cleanupZz(label) {
  const list = await zzList();
  if (!list.length) return { removed: 0, ok: true };
  if (await cdp.ev('editLocked()')) { note(`${label}: 잠긴 상태라 zz ${list.length}건을 지우지 못했다`); return { removed: 0, ok: false }; }
  const m = await mark();
  await cdp.ev(`(function(){ ${JSON.stringify(list.map((x) => x.id))}.forEach(function(id){ deleteEntry(id); }); return 1; })()`);
  await sleep(300);
  const idle = await saveIdle();
  const L = await since(m);
  const saves = reqs(L, 'saveState');
  const last = saves[saves.length - 1];
  return { removed: list.length, ok: idle && !!(last && last.res && last.res.ok), saves: saves.length };
}

function logSize() { try { return statSync(LOG_FILE).size; } catch { return -1; } }
function logSince(off) {
  //  1MB 를 넘으면 widget.log.1 로 밀린다 — 줄어들었으면 .1 의 꼬리와 새 파일 전체를 함께 본다.
  try {
    const cur = readFileSync(LOG_FILE);
    if (off >= 0 && cur.length >= off) return cur.subarray(off).toString('utf8');
    const old = existsSync(LOG_FILE + '.1') ? readFileSync(LOG_FILE + '.1') : Buffer.alloc(0);
    return (off >= 0 && old.length >= off ? old.subarray(off).toString('utf8') : '') + cur.toString('utf8');
  } catch { return null; }
}

/* ── 본체 ─────────────────────────────────────────────────────────── */
console.log('═'.repeat(74));
console.log(`서버(DB) 연결 장애 대응 실동작 루프 — 시드 ${OPT.seed} · 포트 ${OPT.port} · 기록 ${ZZ}*`);
console.log('═'.repeat(74));

let BASE = null;
let healthyAtEnd = null;
let leftAtEnd = null;
let notDebug = false;

async function main() {
  cdp = await Cdp.attach(OPT.port);

  /* ── O0 전제 ── */
  head('O0 전제 — 디버그 실행 · 정상 연결 · 기준선');
  const inst = await cdp.ev(INSTALL);
  vlog('기록기:', inst);
  const f0 = await fault('off');
  if (!f0 || f0.ok !== true) {
    notDebug = true;
    undecide('O0 장애 주입 사용 가능', `__dbFault{off} 회신=${JSON.stringify(f0)} — 디버그 실행이 아니다(TC_DEBUG_PORT 로 띄운 Debug 위젯이 필요)`);
    return;
  }
  ok('O0 __dbFault{off} → ok:true', true, JSON.stringify(f0));
  const user = await cdp.ev("(typeof currentUser !== 'undefined' && currentUser && currentUser.loginId) || ''");
  if (!user) { undecide('O0 로그인', '위젯이 로그인 상태가 아니다'); return; }
  if (!(await waitFor(isHealthy, 20000))) {
    const s = await snapConn();
    undecide('O0 정상 연결', '시작 상태가 정상이 아니다: ' + JSON.stringify({ conn: s.conn, bootOk: s.bootOk, unsaved: s.unsaved, box: s.box, bar: s.bar }));
    return;
  }
  //  지난 실행이 중단돼 남긴 zz 가 있으면 먼저 앱으로 지운다(기준선을 깨끗하게).
  const left0 = await zzList();
  if (left0.length) {
    const c = await cleanupZz('사전 정리');
    note(`지난 실행의 zz 잔재 ${left0.length}건을 앱으로 지웠다(${c.ok ? '저장 성공' : '저장 실패'})`);
    if (!c.ok) { undecide('O0 사전 정리', 'zz 잔재를 지우지 못했다'); return; }
  }
  BASE = await snapConn();
  ok('O0 conn ok · bootOk · 잠금 없음', BASE.conn === 'ok' && BASE.bootOk === true && BASE.locked === false, JSON.stringify({ conn: BASE.conn, bootOk: BASE.bootOk }));
  note(`기준선: login=${user} · 기록 ${BASE.entries} · 할 일 ${BASE.todos} · 과제 목록 ${BASE.catalog} · rev ${BASE.rev}`);
  if (!BASE.catalog) undecide('O0 과제 목록', '과제 목록이 비어 있다 — O2 의 「과제 목록 다시 읽힘」을 판정할 수 없다');

  /* ── O1 (A1) network → 연결 상자 · 잠금 ── */
  head('O1 (A1) network 장애 → reloadState → 연결 상자 · 편집 잠금 · 메모리 변화 0');
  ok('O1 __dbFault{network} → ok', (await fault('network'))?.ok === true);
  const r1 = await reload();
  ok('O1 reloadState 가 부팅 실패(__applyStateError)로 끝난다', r1 === 'error', r1);
  await waitFor('document.getElementById("dsError")', 5000);
  let s = await snapConn();
  ok('O1 연결 상자(#dsError)가 뜬다', s.box, JSON.stringify({ box: s.box }));
  ok('O1 상자 문구 = 네트워크 종류(「서버에 연결할 수 없습니다(꺼져 있거나 네트워크 문제)」)',
    /서버에 연결할 수 없습니다\(꺼져 있거나 네트워크 문제\)/.test(s.boxText), s.boxText);
  //  실제 동작 기록: reloadState 실패는 화면의 정상 스냅샷을 지우지 않는다 → bootOk 는 참으로 남고,
  //  잠금은 conn='offline' 이 건다(§4: !bootOk || unsaved || conn !== 'ok').
  note(`실측: reloadState 실패 뒤 bootOk=${s.bootOk} · conn=${s.conn} · 루프=${s.loop} — 정상 스냅샷은 화면에 남고 잠금은 conn 이 건다`);
  ok('O1 상자 머리말 = 사용 중 끊김(「서버 연결이 끊겼습니다」 — 부팅 스냅샷이 있으므로)', s.bootOk ? /서버 연결이 끊겼습니다/.test(s.boxText) : /DB 에서 캘린더를 읽지 못했습니다/.test(s.boxText), s.boxText);
  ok("O1 conn = 'offline' · editLocked() = true · body.db-locked", s.conn === 'offline' && s.locked === true && s.dbLocked === true,
    JSON.stringify({ conn: s.conn, locked: s.locked, dbLocked: s.dbLocked }));
  ok('O1 재시도가 예약돼 있다(부팅 재시도 1/3 · 15초)', !!(s.boot && s.boot.pending && s.boot.attempt === 1 && !s.boot.tail),
    JSON.stringify(s.boot));
  ok('O1 루프는 하나(재연결 핑 대기 없음)', !(s.ping && s.ping.pending), JSON.stringify(s.ping));
  ok('O1 상자에 카운트다운(「N초 후 자동 재시도 (1/3)」)', /\d+초 후 자동 재시도 \(1\/3\)/.test(s.boxText), s.boxText);

  //  편집 진입점 — 토스트 한 줄로 끝나고 메모리 변화 0.
  const before = await J('JSON.stringify([state.entries, state.todos, state.categories])');
  let m = await mark();
  const qa = await J(`(function(){ openQuickAdd(${JSON.stringify(DATE)}); return document.getElementById('quickAdd').classList.contains('hidden'); })()`);
  const em = await J(`(function(){ openEntryModal('new', ${JSON.stringify(DATE)}); return document.getElementById('entryModal').classList.contains('hidden'); })()`);
  let L = await since(m);
  ok('O1 빠른 등록(openQuickAdd 새 기록)이 열리지 않는다', qa === true);
  ok('O1 새 기록 창(openEntryModal new)이 열리지 않는다', em === true);
  ok(`O1 잠금 토스트 「${LOCK_MSG}」`, toasts(L).includes(LOCK_MSG), JSON.stringify(toasts(L)));
  ok('O1 메모리 변화 0(기록·할 일·과제)', (await J('JSON.stringify([state.entries, state.todos, state.categories])')) === before);
  ok('O1 저장 요청 0건', reqs(L, 'saveState').length === 0);

  //  S12 — 다른 화면의 DB 조회도 같은 장애를 본다: 과제 목록을 다시 읽으면 비게 된다(O2 에서 다시 채워지는지 본다).
  m = await mark();
  await cdp.ev(`hpost({ cmd: 'loadProjects' }); 1`);
  const emptied = await waitFor('(dbCatalog || []).length === 0', 8000);
  ok('O1 장애 중 과제 목록 조회는 실패한다(목록이 빈다 — 캐시 폴백 없음)', emptied, 'catalog=' + (await cdp.ev('(dbCatalog||[]).length')));
  s = await snapConn();
  ok('O1 과제 목록 실패 뒤에도 루프는 하나(부팅 재시도만 대기)', !!(s.boot && s.boot.pending) && !(s.ping && s.ping.pending), JSON.stringify({ boot: s.boot, ping: s.ping }));

  /* ── O2 (A2) 해제 → 자동 복구 ── */
  head('O2 (A2) 장애 해제 → 25초 안 자동 복구');
  m = await mark();
  ok('O2 __dbFault{off} → ok', (await fault('off'))?.ok === true);
  const t2 = Date.now();
  const rec2 = await waitFor(isHealthy + ' && (dbCatalog || []).length > 0', 25000, 300);
  const dt2 = ((Date.now() - t2) / 1000).toFixed(1);
  s = await snapConn();
  L = await since(m);
  ok(`O2 자동 복구(${dt2}초) — 상자 없음 · conn ok · bootOk · 잠금 해제`, rec2 || (s.conn === 'ok' && s.bootOk && !s.box && !s.locked),
    JSON.stringify({ conn: s.conn, bootOk: s.bootOk, box: s.box, locked: s.locked, boot: s.boot }));
  ok('O2 사람이 누르지 않았다 — 자동 재시도(reloadState)가 붙었다', posts(L, 'reloadState').length >= 1 && L.some((x) => x.applied),
    JSON.stringify(L.filter((x) => x.post || x.applied).map((x) => x.post || 'applied')));
  ok(`O2 과제 목록이 다시 읽혔다(${s.catalog}건 · 기준선 ${BASE.catalog})`, s.catalog > 0 && posts(L, 'loadProjects').length >= 1, `catalog=${s.catalog}`);
  ok('O2 「서버에 다시 연결되었습니다」 토스트 1회', toasts(L).filter((x) => x === '서버에 다시 연결되었습니다').length === 1, JSON.stringify(toasts(L)));
  ok('O2 기록 수 = 기준선', s.entries === BASE.entries, `${s.entries} vs ${BASE.entries}`);
  ok('O2 복구 뒤 타이머 없음(부팅 재시도·핑 모두 대기 없음)', !(s.boot && s.boot.pending) && !(s.ping && s.ping.pending), JSON.stringify({ boot: s.boot, ping: s.ping }));

  /* ── O1b (A3) 빠른 3회 뒤 300초 꼬리 ── */
  head('O1b (A3) 빠른 3회(15·30·60) 실패 뒤 300초 꼬리가 예약된다 — 실제 호스트 실패를 [다시 시도]로 앞당긴다');
  ok('O1b __dbFault{network} → ok', (await fault('network'))?.ok === true);
  ok('O1b reloadState → 실패', (await reload()) === 'error');
  //  수동 재시도는 자동 시리즈를 리셋하지 않는다(createBootRetry.manual) — 매번 진짜 reloadState 를 보내 진짜로 실패한다.
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const st = await J('__bootRetry.state()');
    seen.push(st);
    const mm = await mark();
    await cdp.ev(`document.getElementById('dsErrorRetry').click(); 1`);
    const t = Date.now(); let got = null;
    while (Date.now() - t < 15000) { const LL = await since(mm); got = LL.find((x) => x.applyErr || x.applied); if (got) break; await sleep(200); }
    if (!got || !got.applyErr) { ok(`O1b 수동 재시도 ${i + 1} 이 실패로 끝난다`, false, JSON.stringify(got)); break; }
    await sleep(150);
  }
  const stT = await J('__bootRetry.state()');
  seen.push(stT);
  vlog('재시도 상태 순서:', JSON.stringify(seen));
  ok('O1b 빠른 회차가 1→2→3 으로 진행됐다(수동은 시리즈를 리셋하지 않는다)',
    seen.slice(0, 3).map((x) => x.attempt).join(',') === '1,2,3' && seen.slice(0, 3).every((x) => !x.tail), JSON.stringify(seen.slice(0, 3)));
  ok('O1b 3회 실패 뒤 꼬리 재시도가 예약돼 있다(tail · pending · 약 300초)',
    stT.pending === true && stT.tail === true && stT.secondsLeft > 280 && stT.secondsLeft <= 300, JSON.stringify(stT));
  const tailText = (await cdp.ev(`(document.getElementById('dsErrorText')||{}).textContent||''`));
  ok('O1b 상자 문구 「다음 재시도 N분 N초 후」', /다음 재시도 [45]분 \d+초 후/.test(tailText), tailText);
  ok('O1b 루프는 하나(꼬리 대기 중 핑 없음)', !((await J('__pingRetry && __pingRetry.state()')) || {}).pending);
  ok('O1b __dbFault{off} → ok', (await fault('off'))?.ok === true);
  m = await mark();
  await cdp.ev(`document.getElementById('dsErrorRetry').click(); 1`);
  ok('O1b [다시 시도] → 복구(꼬리를 기다리지 않는다)', await waitFor(isHealthy, 15000));
  ok('O1b 복구 뒤 꼬리 타이머가 걷혔다', !((await J('__bootRetry.state()')) || {}).pending);

  /* ── O1s (§4) 잠금 중 save() — 마지막 방어 ── */
  head('O1s (§4) 잠금 중 save() 의 마지막 방어 — 보내지 않고 메모리에 남긴다 · 복구되면 그 편집이 함께 간다');
  ok('O1s __dbFault{network} → ok', (await fault('network'))?.ok === true);
  ok('O1s reloadState → 실패(부팅 재시도 루프)', (await reload()) === 'error');
  m = await mark();
  //  진입점 관문을 지나지 않는 경로를 흉내 낸다(계약 시험 잠금④ 와 같은 방식) — state 를 직접 바꾸고 save().
  const t0Title = ZZ + '0';
  await cdp.ev(`(function(){ state.entries.push({ id: uid('e'), date: ${JSON.stringify(DATE)}, title: ${JSON.stringify(t0Title)},
    categoryId: null, allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [],
    createdAt: nowIso(), updatedAt: nowIso() }); save(); return 1; })()`);
  await sleep(400);
  L = await since(m);
  s = await snapConn();
  ok('O1s 잠긴 save() 는 저장을 보내지 않는다', reqs(L, 'saveState').length === 0, `saveState ${reqs(L, 'saveState').length}건`);
  ok('O1s 부팅 스냅샷이 있으므로 편집은 메모리에 남는다', (await countTitle(t0Title)) === 1);
  ok('O1s 미저장 표시(unsaved · 막대 · unsavedState{on:true})', s.unsaved === true && s.bar === true && posts(L, 'unsavedState').some((x) => x.on === true),
    JSON.stringify({ unsaved: s.unsaved, bar: s.bar, posts: posts(L, 'unsavedState') }));
  ok('O1s 잠금 토스트', toasts(L).includes(LOCK_MSG), JSON.stringify(toasts(L)));
  ok('O1s 복구는 미저장분을 먼저 저장하는 길(재연결 확인)로 간다 — 부팅 재시도(reloadState)가 덮어쓰지 않게',
    s.loop === 'ping' && !(s.boot && s.boot.pending) && !!(s.ping && s.ping.pending), JSON.stringify({ loop: s.loop, boot: s.boot, ping: s.ping }));
  ok('O1s __dbFault{off} → ok', (await fault('off'))?.ok === true);
  m = await mark();
  const recS = await waitFor(isHealthy, 25000, 300);
  L = await since(m);
  s = await snapConn();
  ok('O1s 25초 안 자동 복구', recS, JSON.stringify({ conn: s.conn, bootOk: s.bootOk, unsaved: s.unsaved, box: s.box, bar: s.bar, loop: s.loop }));
  const sv = reqs(L, 'saveState');
  ok('O1s 복구가 미저장분을 저장했다(saveState ok)', sv.length >= 1 && !!(sv[sv.length - 1].res && sv[sv.length - 1].res.ok), JSON.stringify(sv.map((x) => x.res && { ok: x.res.ok, ins: x.res.ins })));
  ok('O1s reloadState → 적용', (await reload()) === 'applied');
  ok(`O1s 서버에 ${t0Title} 가 정확히 1건(잃지도 겹치지도 않았다)`, (await countTitle(t0Title)) === 1, `${await countTitle(t0Title)}건`);

  /* ── O3 (A5) 사용 중 network → 편집 1건 ── */
  head('O3 (A5) 사용 중 network → 편집 1건 → 막대 · 추가 편집 잠김 → 해제 → 자동 저장 · DB 에 1건');
  ok('O3 시작 상태 정상', await waitFor(isHealthy, 5000));
  ok('O3 __dbFault{network} → ok', (await fault('network'))?.ok === true);
  m = await mark();
  const t1Title = ZZ + '1';
  const e1 = await addZz(1);
  vlog('추가:', JSON.stringify(e1));
  const bar3 = await waitFor('document.getElementById("dbUnsaved")', 10000);
  L = await since(m);
  s = await snapConn();
  const sv3 = reqs(L, 'saveState');
  ok('O3 저장이 1건 나갔고 네트워크로 실패했다', sv3.length === 1 && !!sv3[0].res && sv3[0].res.ok === false && sv3[0].res.kind === 'network',
    JSON.stringify(sv3.map((x) => x.res && { ok: x.res.ok, kind: x.res.kind })));
  ok('O3 「저장되지 않은 변경」 막대(#dbUnsaved)', bar3 && /저장되지 않은 변경이 있습니다/.test(s.barText), s.barText);
  ok('O3 unsaved = true · conn offline · 잠금', s.unsaved === true && s.conn === 'offline' && s.locked === true, JSON.stringify({ unsaved: s.unsaved, conn: s.conn, locked: s.locked }));
  ok('O3 unsavedState{on:true} 를 호스트에 보냈다(닫기 경고의 근거)', posts(L, 'unsavedState').some((x) => x.on === true), JSON.stringify(posts(L, 'unsavedState')));
  ok('O3 편집은 화면에 남는다', (await countTitle(t1Title)) === 1);
  ok('O3 막대가 사정을 말하므로 상자는 없다(같은 말 두 번 안 함)', s.box === false);
  ok('O3 재연결 확인(핑)이 예약돼 있다', !!(s.ping && s.ping.pending) && s.loop === 'ping', JSON.stringify({ loop: s.loop, ping: s.ping }));
  m = await mark();
  const n3 = (await snapConn()).entries;
  const qa3 = await J(`(function(){ openQuickAdd(${JSON.stringify(DATE)}); return document.getElementById('quickAdd').classList.contains('hidden'); })()`);
  await sleep(1700);   // 잠금 토스트는 1.5초에 한 번 — 두 번째 진입점의 토스트도 보이게
  const em3 = await J(`(function(){ openEntryModal('new', ${JSON.stringify(DATE)}); return document.getElementById('entryModal').classList.contains('hidden'); })()`);
  L = await since(m);
  ok('O3 두 번째 편집 시도(빠른 등록·새 기록)가 guardEdit 로 막힌다', qa3 === true && em3 === true && toasts(L).filter((x) => x === LOCK_MSG).length >= 2,
    JSON.stringify({ qa3, em3, toasts: toasts(L) }));
  ok('O3 막힌 시도는 메모리를 바꾸지 않고 저장도 보내지 않는다', (await snapConn()).entries === n3 && reqs(L, 'saveState').length === 0);
  ok('O3 __dbFault{off} → ok', (await fault('off'))?.ok === true);
  m = await mark();
  const t3 = Date.now();
  const rec3 = await waitFor(isHealthy, 25000, 300);
  const dt3 = ((Date.now() - t3) / 1000).toFixed(1);
  L = await since(m);
  s = await snapConn();
  ok(`O3 자동 복구(${dt3}초) — 막대 없음 · unsaved false · conn ok`, rec3, JSON.stringify({ conn: s.conn, unsaved: s.unsaved, bar: s.bar, box: s.box }));
  ok('O3 복구 순서의 첫 단계는 핑(dbPing ok)', reqs(L, 'dbPing').some((x) => x.res && x.res.ok), JSON.stringify(reqs(L, 'dbPing').map((x) => x.res)));
  const sv3b = reqs(L, 'saveState');
  ok('O3 미저장분 자동 저장(saveState ok)', sv3b.length >= 1 && !!(sv3b[0].res && sv3b[0].res.ok), JSON.stringify(sv3b.map((x) => x.res && { ok: x.res.ok, ins: x.res.ins })));
  ok('O3 unsavedState{on:false} 를 보냈다', posts(L, 'unsavedState').some((x) => x.on === false), JSON.stringify(posts(L, 'unsavedState')));
  ok('O3 「서버에 다시 연결되었습니다」 1회', toasts(L).filter((x) => x === '서버에 다시 연결되었습니다').length === 1, JSON.stringify(toasts(L)));
  ok('O3 부팅 스냅샷이 있으므로 회복이 reloadState 를 보내지 않았다', posts(L, 'reloadState').length === 0);
  ok('O3 reloadState → 적용', (await reload()) === 'applied');
  ok(`O3 서버에 ${t1Title} 가 정확히 1건`, (await countTitle(t1Title)) === 1, `${await countTitle(t1Title)}건`);

  /* ── O4 (A4) auth ── */
  head('O4 (A4) auth 장애 → 접근 거부 문구 · db@host · 자동 재시도 0 → 해제 → [다시 시도]');
  const where = await cdp.ev(`(function(){ const m = __bootMeta || {}; return String(m.db || '') + (m.host ? '@' + m.host : ''); })()`);
  ok('O4 __dbFault{auth} → ok', (await fault('auth'))?.ok === true);
  m = await mark();
  ok('O4 reloadState → 실패', (await reload()) === 'error');
  await waitFor('document.getElementById("dsError")', 5000);
  s = await snapConn();
  ok('O4 접근 거부 문구', /DB 접근이 거부되었습니다/.test(s.boxText), s.boxText);
  ok(`O4 DB 이름·호스트 표시(${where})`, !!where && s.boxText.includes(where), s.boxText);
  ok("O4 conn = 'denied' · 잠금", s.conn === 'denied' && s.locked === true, JSON.stringify({ conn: s.conn, locked: s.locked }));
  ok('O4 자동 재시도가 예약돼 있지 않다(부팅·핑 모두)', !(s.boot && s.boot.pending) && !(s.ping && s.ping.pending), JSON.stringify({ boot: s.boot, ping: s.ping }));
  ok('O4 상자는 수동 안내(「[다시 시도]를 누르세요」)', /\[다시 시도\]를 누르세요/.test(s.boxText), s.boxText);
  await sleep(16500);   // 15초(첫 자동 재시도 자리)를 넘겨 본다
  L = await since(m);
  ok('O4 16초 동안 자동 reloadState 0 · dbPing 0', posts(L, 'reloadState').length === 1 && reqs(L, 'dbPing').length === 0,
    `reloadState ${posts(L, 'reloadState').length}(내가 보낸 1 포함) · dbPing ${reqs(L, 'dbPing').length}`);
  ok('O4 __dbFault{off} → ok', (await fault('off'))?.ok === true);
  m = await mark();
  await cdp.ev(`document.getElementById('dsErrorRetry').click(); 1`);
  const rec4 = await waitFor(isHealthy, 15000);
  L = await since(m);
  ok('O4 [다시 시도] → 복구(상자 없음 · conn ok)', rec4 && L.some((x) => x.applied), JSON.stringify(await snapConn().then((x) => ({ conn: x.conn, box: x.box }))));

  /* ── O5 (A6) commit-lost ── */
  head('O5 (A6) commit-lost → 저장 실패(network · COMMIT 은 됨) → 복구 저장이 가짜 충돌 없이 성공 · DB 에 1건');
  ok('O5 시작 상태 정상', await waitFor(isHealthy, 5000));
  const revBefore5 = (await snapConn()).rev;
  ok('O5 __dbFault{commit-lost} → ok', (await fault('commit-lost'))?.ok === true);
  m = await mark();
  const t2Title = ZZ + '2';
  await addZz(2);
  const bar5 = await waitFor('document.getElementById("dbUnsaved")', 10000);
  L = await since(m);
  const sv5 = reqs(L, 'saveState');
  ok('O5 저장이 네트워크 실패로 회신됐다(commit-lost 가 실제로 터졌다)', sv5.length === 1 && !!sv5[0].res && sv5[0].res.ok === false && sv5[0].res.kind === 'network'
    && /commit-lost/.test(String(sv5[0].res.detail || sv5[0].res.error || '')), JSON.stringify(sv5.map((x) => x.res)));
  ok('O5 막대가 선다(편집은 남는다)', bar5 && (await countTitle(t2Title)) === 1);
  //  commit-lost 는 한 발짜리다 — 이미 off 로 돌아갔어야 한다. off 를 다시 걸어도 같은 값이다(멱등).
  ok('O5 __dbFault{off} → ok', (await fault('off'))?.ok === true);
  m = await mark();
  let sawConflict = false;
  const t5 = Date.now();
  let rec5 = false;
  while (Date.now() - t5 < 25000) {
    if (await cdp.ev('!!document.getElementById("dbConflict")')) sawConflict = true;
    if (await cdp.ev(`!!(${isHealthy})`)) { rec5 = true; break; }
    await sleep(300);
  }
  await sleep(300);
  if (await cdp.ev('!!document.getElementById("dbConflict")')) sawConflict = true;
  L = await since(m);
  const sv5b = reqs(L, 'saveState');
  const last5 = sv5b[sv5b.length - 1];
  ok(`O5 자동 복구(${((Date.now() - t5) / 1000).toFixed(1)}초)`, rec5, JSON.stringify(await snapConn().then((x) => ({ conn: x.conn, unsaved: x.unsaved, bar: x.bar, conflict: x.conflict }))));
  ok('O5 복구 저장 = ok · resolvedConflict(가짜 충돌 해소)', !!(last5 && last5.res && last5.res.ok === true && last5.res.resolvedConflict === true),
    JSON.stringify(sv5b.map((x) => x.res)));
  ok('O5 충돌 상자(#dbConflict)는 한 번도 뜨지 않았다', !sawConflict);
  ok('O5 reloadState → 적용', (await reload()) === 'applied');
  ok(`O5 서버에 ${t2Title} 가 정확히 1건(중복 없음)`, (await countTitle(t2Title)) === 1, `${await countTitle(t2Title)}건`);
  const revAfter5 = (await snapConn()).rev;
  ok('O5 rev 가 정확히 1 올랐다(COMMIT 은 한 번 — 복구 저장은 새로 쓰지 않았다)', Number(revAfter5) === Number(revBefore5) + 1, `${revBefore5} → ${revAfter5}`);

  /* ── O6 (A11) 정상 상태 — 폴링 없음 ── */
  head('O6 (A11) 정상 상태 45초 관찰 — dbPing 0 · reloadState 0 · 재연결 타이머 없음');
  ok('O6 시작 상태 정상', await waitFor(isHealthy, 5000));
  const off6 = logSize();
  m = await mark();
  const tm0 = await J('({ boot: __bootRetry ? __bootRetry.state().pending : false, ping: __pingRetry ? __pingRetry.state().pending : false, busy: __pingBusy })');
  await sleep(45000);
  const tm1 = await J('({ boot: __bootRetry ? __bootRetry.state().pending : false, ping: __pingRetry ? __pingRetry.state().pending : false, busy: __pingBusy })');
  L = await since(m);
  ok('O6 45초 동안 dbPing 0건', reqs(L, 'dbPing').length === 0, `${reqs(L, 'dbPing').length}건`);
  ok('O6 45초 동안 reloadState 0건', posts(L, 'reloadState').length === 0);
  ok('O6 재연결·부팅 재시도 타이머가 처음과 끝 모두 없다', !tm0.boot && !tm0.ping && !tm0.busy && !tm1.boot && !tm1.ping && !tm1.busy, JSON.stringify({ tm0, tm1 }));
  const tail6 = logSince(off6);
  if (tail6 == null) undecide('O6 호스트 로그 대조', `로그를 읽지 못했다(${LOG_FILE})`);
  else ok('O6 호스트 로그에 「DB 핑」 0줄(관찰 구간)', !/DB 핑/.test(tail6), (tail6.match(/.*DB 핑.*/g) || []).slice(0, 3).join(' | '));
  note('A7(닫기 경고)은 네이티브 MessageBox 라 이 루프가 누르지 않는다 — 계약 시험(offline-host)과 수동 1회로 확인');
  note('A10(배포 실행에서 __dbFault 거부)은 정적 계약 — offline-host.test.mjs');
}

let aborted = null;
try {
  await main();
} catch (e) {
  aborted = e;
  fail++; F.push('중단: ' + (e && e.message ? e.message : e));
  console.log(`\n${el()} [중단] ${e && e.message ? e.message : e}`);
  if (OPT.verbose && e && e.stack) console.log(e.stack);
} finally {
  //  ★ 무슨 일이 있어도 장애 주입을 끄고, 앱이 정상으로 돌아왔는지 확인한 뒤 zz 를 지운다.
  if (cdp && !notDebug) {
    head('정리 — 장애 off · 정상 복귀 · zz 기록 삭제');
    try {
      let off = null;
      for (let i = 0; i < 3 && !(off && off.ok); i++) { try { off = await fault('off'); } catch (_) { off = null; await sleep(500); } }
      if (!(off && off.ok)) console.log(`${el()}   ★★ 경고: __dbFault{off} 가 확인되지 않았다 — 위젯을 재시작하세요(모드는 프로세스 안에만 있다)`);
      if (!(await waitFor(isHealthy, 3000))) {
        //  상자가 떠 있으면 [다시 시도], 막대면 [지금 다시 시도] — 사람이 누를 문을 그대로 쓴다.
        await cdp.ev(`(function(){ const a = document.getElementById('dbUnsavedRetry') || document.getElementById('dsErrorRetry'); if (a) a.click(); return 1; })()`).catch(() => 0);
      }
      healthyAtEnd = await waitFor(isHealthy, 30000, 300);
      if (!healthyAtEnd) {
        await cdp.ev(`hpost({ cmd: 'reloadState' }); 1`).catch(() => 0);
        healthyAtEnd = await waitFor(isHealthy, 20000, 300);
      }
      if (healthyAtEnd) {
        const c = await cleanupZz('정리');
        if (c.removed) ok(`정리: zz ${c.removed}건 삭제 저장`, c.ok, JSON.stringify(c));
        const r = await reload();
        const left = await zzList();
        leftAtEnd = left.length;
        if (BASE) {
          ok('정리: reloadState → 서버에 zz 잔재 0', r === 'applied' && left.length === 0, `${r} · ${JSON.stringify(left)}`);
          const sEnd = await snapConn();
          ok(`정리: 기록 수 = 기준선(${BASE.entries})`, sEnd.entries === BASE.entries, `${sEnd.entries}`);
          ok(`정리: 할 일 수 = 기준선(${BASE.todos})`, sEnd.todos === BASE.todos, `${sEnd.todos}`);
        }
        healthyAtEnd = await waitFor(isHealthy, 5000);
      }
    } catch (e) {
      healthyAtEnd = false;
      F.push('정리 중 예외: ' + e.message); fail++;
    }
    try { await cdp.ev(UNINSTALL); } catch (_) { }
  }
  if (cdp) cdp.close();
}

const secs = ((Date.now() - T0) / 1000).toFixed(1);
console.log('\n' + '═'.repeat(74));
console.log(`연결 장애 대응 루프 요약 — 시드 ${OPT.seed} · 소요 ${secs}s`);
if (F.length) { console.log(`실패 ${F.length}건:`); F.forEach((f) => console.log('  ✗ ' + f)); }
if (UD.length) { console.log(`판정 불가 ${UD.length}건:`); UD.forEach((f) => console.log('  ? ' + f)); }
if (cdp && !notDebug && healthyAtEnd === false) {
  console.log('\n★★ 경고: 끝날 때 위젯이 정상(conn ok · bootOk · 상자·막대 없음)으로 돌아오지 않았다 — 화면을 확인하고 필요하면 재시작하세요.');
}
if (leftAtEnd) console.log(`\n★★ 경고: zz 기록 ${leftAtEnd}건이 남았다(제목 zzOFF-*) — 다음 실행이 시작할 때 지운다.`);
console.log(`재현: node tests/loop-offline.mjs --seed=${OPT.seed} --port=${OPT.port}`);
console.log(`\n통과 ${pass} · 실패 ${fail} · 판정 불가 ${undecided}`);
console.log('═'.repeat(74));
const healthyOk = notDebug || !cdp || healthyAtEnd !== false;
process.exit(fail > 0 || !healthyOk ? 1 : (undecided > 0 ? 2 : 0));
