#!/usr/bin/env node
/* =====================================================================================
 *  tests/loop-category-order.mjs — 과제 순서 설정 **실동작** 루프(docs/CATEGORY-ORDER.md §3 C1~C7)
 * -------------------------------------------------------------------------------------
 *  계약 시험(category-order.test.mjs)은 jsdom·소스 대조로 **규칙**을 잠근다. 이 루프는 실제 위젯(Debug ·
 *  TC_DEBUG_PORT)에 붙어 로그인한 사용자 **자신의** 캘린더에서 진짜 ▲▼ 버튼을 누르고, 그 순서가
 *  실 호스트·실 DB 를 지나 다시 읽혀도 그대로인지 본다. 영속은 DB 를 직접 보지 않고 **앱을 통해** 확인한다 —
 *  reloadState 를 보내 호스트가 다시 읽어 준 state(__applyState)에서 센다(호스트 → DB → 호스트 → 웹 왕복).
 *
 *  케이스 ↔ 수용 기준(§3):
 *    O0        전제 — 로그인 · conn ok · bootOk · 과제 ≥ 3(모자라면 zz 개인 과제를 폼으로 만든다) · 원래 순서 스냅샷
 *    C1        「과제 관리」(헤더 버튼) 목록 순서 = state.categories · 공식이 개인 사이에 끼어도 다시 열면 그대로(R1)
 *    C2        마지막 행 ▲(focus → click) — 한 칸 이동 · saveState 1회 · 첫 행 ▲ · 마지막 행 ▼ 비활성
 *    C7        옮긴 뒤 포커스 = 옮겨진 행의 같은 ▲ · 모달 스크롤 자리 유지 · 맨 위에 닿으면 포커스가 ▼ 로
 *    C3        reloadState → 다시 읽힌 state.categories 순서 = 옮긴 직후 순서(서버 저장)
 *    C4        collectReportData(이번 달, rptSources()) 행 = 목록 순서(「기타」·미분류 맨 뒤) + 보고서 미리보기 카드 순서
 *    C5        필터 막대 칩 · 새 기록 #fCat · 빠른 추가 #qaCat 옵션 순서 = state.categories
 *    C6        __dbFault{network} → 끊김 → ▼ → 순서·화면 변화 0 · saveState 0 · 잠금 토스트 → 해제 → 복구
 *    정리      장애 off · 원래 순서로 되돌린다(진짜 ▲ 로) · zz 과제 삭제 · reloadState → 원래 순서 확인 · 모달 닫기
 *
 *  ★ 남기지 않는다: finally 에서 장애를 끄고, 순서를 원래대로 되돌리고, 만든 zz 과제(`zzORD-<seed>-<n>`)를 지운다.
 *    되돌리지 못하면 원래 순서를 크게 찍는다(손으로 되돌릴 수 있게).
 *  ★ DB 에 직접 붙지 않는다 — 비밀번호가 필요 없다.
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 로그인된 채 띄운 뒤(예: powershell -File dist/promo/win.ps1 start)
 *    node tests/loop-category-order.mjs [--seed=N] [--port=9222] [-v]
 *    종료코드: 0 통과 · 1 실패 · 2 판정 불가(전제가 안 서서 증명하지 못함 — 초록 아님)
 * ===================================================================================== */

const ARG = new Map(process.argv.slice(2).map((a) => {
  const m = /^--?([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const OPT = {
  seed: Number(ARG.get('seed') || Date.now() % 100000),
  port: Number(ARG.get('port') || process.env.TC_DEBUG_PORT || 9222),
  verbose: ARG.has('verbose') || ARG.has('v'),
};
if (ARG.has('help') || ARG.has('h')) {
  console.log(`사용법: node tests/loop-category-order.mjs [--seed=N] [--port=${OPT.port}] [-v]`);
  process.exit(0);
}
const ZZ_ALL = 'zzORD-';
const ZZ = `${ZZ_ALL}${OPT.seed}-`;

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   ·', ...a); };

let pass = 0, fail = 0, undecided = 0;
const F = [], UD = [], NA = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`${el()}   ✓ ${n}${d && OPT.verbose ? ' — ' + d : ''}`); return true; }
  fail++; F.push(n + (d ? ' — ' + d : ''));
  console.log(`${el()}   ✗ ${n}${d ? ' — ' + String(d).slice(0, 300) : ''}`); return false;
};
const undecide = (n, d = '') => { undecided++; UD.push(n + (d ? ' — ' + d : '')); console.log(`${el()}   ? ${n} — 판정 불가${d ? ': ' + d : ''}`); };
//  해당 없음 — 이 데이터·이 배치에서는 성립 조건이 없다(판정 불가와 다르다: 증명할 대상이 없을 뿐이다).
const na = (n, d = '') => { NA.push(n + (d ? ' — ' + d : '')); console.log(`${el()}   - ${n} — 해당 없음${d ? ': ' + d : ''}`); };
const note = (m) => console.log(`${el()}   · ${m}`);
const head = (m) => console.log(`\n${el()} [${m}]`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
  if (window.__ordRec) return 'already';
  const R = window.__ordRec = { log: [], orig: { hostRequest: hostRequest, hpost: hpost, toast: toast,
    applyState: window.__applyState, applyErr: window.__applyStateError } };
  hostRequest = function(cmd, params, t){
    const rec = { t: Date.now(), req: cmd };
    if (cmd === 'saveState' && params && params.state && Array.isArray(params.state.categories))
      rec.order = params.state.categories.map(function(c){ return c.id; });
    R.log.push(rec);
    return R.orig.hostRequest(cmd, params, t).then(function(res){
      rec.done = Date.now();
      rec.res = (cmd === 'saveState' || cmd === '__dbFault') ? { ok: !!(res && res.ok), kind: res && res.kind, error: res && res.error } : { ok: !!(res && res.ok) };
      return res;
    });
  };
  hpost = function(o){ if (o && !o.reqId) R.log.push({ t: Date.now(), post: o.cmd }); return R.orig.hpost(o); };
  toast = function(m, k, a, ms){ R.log.push({ t: Date.now(), toast: String(m), kind: k }); return R.orig.toast(m, k, a, ms); };
  window.__applyState = function(j, m){ R.log.push({ t: Date.now(), applied: true }); return R.orig.applyState(j, m); };
  window.__applyStateError = function(msg, opt){ R.log.push({ t: Date.now(), applyErr: String(msg) }); return R.orig.applyErr(msg, opt); };
  return 'ok';
})()`;
const UNINSTALL = `(function(){
  const R = window.__ordRec; if (!R) return 'none';
  hostRequest = R.orig.hostRequest; hpost = R.orig.hpost; toast = R.orig.toast;
  window.__applyState = R.orig.applyState; window.__applyStateError = R.orig.applyErr;
  delete window.__ordRec; try { delete window.__ordBtn; } catch (_) {} return 'ok';
})()`;
const mark = () => cdp.ev('__ordRec.log.length');
const since = (m) => J(`__ordRec.log.slice(${Number(m)})`);
const reqs = (L, cmd) => L.filter((x) => x.req === cmd);
const toasts = (L) => L.filter((x) => x.toast).map((x) => x.toast);

/* ── 앱 조작 ────────────────────────────────────────────────────────── */
const LOCK_MSG = '서버에 연결되지 않아 지금은 편집할 수 없습니다';
const isHealthy = 'conn === "ok" && bootOk === true && !unsaved && !document.getElementById("dsError") && !document.getElementById("dbUnsaved")';
const fault = (mode) => J(`hostRequest('__dbFault', { mode: ${JSON.stringify(mode)} }, 8000)`);
const saveIdle = () => waitFor('!__dbSaving && !__dbDirty', 30000, 150);

async function reload(ms = 20000) {
  const m = await mark();
  await cdp.ev(`hpost({ cmd: 'reloadState' }); 1`);
  const t = Date.now();
  while (Date.now() - t < ms) {
    const L = await since(m);
    const r = L.find((x) => x.applied || x.applyErr);
    if (r) { await sleep(200); return r.applied ? 'applied' : 'error'; }
    await sleep(200);
  }
  return 'timeout';
}

const order = () => J('state.categories.map(function(c){ return c.id; })');
const cats = () => J('state.categories.map(function(c){ return { id: c.id, name: String(c.name || ""), off: !!isOfficialCat(c), pick: !!isPickableCat(c) }; })');
const domOrder = () => J("[].map.call(document.querySelectorAll('#catList .cat-row'), function(r){ return r.dataset.id; })");
const domOfficial = () => J("[].map.call(document.querySelectorAll('#catList .cat-row'), function(r){ return !!r.querySelector('.cat-badge.db'); })");
const isOpen = (sel) => `(function(){ const m = document.querySelector(${JSON.stringify(sel)}); return !!m && !m.classList.contains('hidden') && !m.classList.contains('closing'); })()`;
const zzCats = () => J(`state.categories.filter(function(c){ return String(c.name || '').indexOf(${JSON.stringify(ZZ_ALL)}) === 0; }).map(function(c){ return { id: c.id, name: c.name }; })`);

async function closeAll() {
  await cdp.ev(`(function(){ ['#confirmModal','#quickAdd','#entryModal','#reportModal','#categoryModal'].forEach(function(s){
    try { const m = document.querySelector(s); if (m && !m.classList.contains('hidden')) closeModal(s); } catch (_) {} }); return 1; })()`);
  await sleep(400);
}
//  「과제 관리」를 사람이 여는 문(헤더 #btnCatsTop)으로 연다. 모달 A11y 가 여는 순간 첫 칸으로 포커스를 보낸다 — 그 뒤에 누른다.
async function openCat() {
  if (await cdp.ev(isOpen('#categoryModal'))) { await cdp.ev("closeModal('#categoryModal'); 1"); await sleep(450); }
  await cdp.ev(`(function(){ const b = document.getElementById('btnCatsTop'); if (b) b.click(); else openCatModal(); return 1; })()`);
  const opened = await waitFor(isOpen('#categoryModal'), 3000, 100);
  await sleep(350);
  return opened;
}
//  누른다 = 그 행의 진짜 버튼에 focus() → click()(사람이 누를 때와 같은 순서). 그다음 저장 회신까지 기다린다.
async function press(id, act, { idle = true } = {}) {
  if (idle) await saveIdle();
  const m = await mark();
  const r = await cdp.ev(`(function(){
    const row = [].find.call(document.querySelectorAll('#catList .cat-row'), function(x){ return x.dataset.id === ${JSON.stringify(id)}; });
    if (!row) return 'norow';
    const b = row.querySelector('[data-act="${act}"]');
    if (!b) return 'nobtn';
    if (b.disabled) return 'disabled';
    window.__ordBtn = b; b.focus(); b.click(); return 'ok';
  })()`);
  await sleep(120);
  if (idle) await saveIdle();
  const L = await since(m);
  return { r, L, saves: reqs(L, 'saveState') };
}
const swapped = (arr, i, j) => { const a = arr.slice(); const t = a[i]; a[i] = a[j]; a[j] = t; return a; };
const endsDisabled = () => J(`(function(){ const rows = document.querySelectorAll('#catList .cat-row'); if (!rows.length) return null;
  const u = rows[0].querySelector('[data-act="up"]'), d = rows[rows.length - 1].querySelector('[data-act="down"]');
  let midOk = true;
  for (let i = 0; i < rows.length; i++) { const uu = rows[i].querySelector('[data-act="up"]'), dd = rows[i].querySelector('[data-act="down"]');
    if (i > 0 && uu.disabled) midOk = false; if (i < rows.length - 1 && dd.disabled) midOk = false; }
  return { firstUp: !!(u && u.disabled), lastDown: !!(d && d.disabled), midOk: midOk }; })()`);
const focusInfo = () => J(`(function(){ const a = document.activeElement; const b = window.__ordBtn;
  const row = a && a.closest ? a.closest('#catList .cat-row') : null;
  return { same: !!b && a === b, act: a && a.dataset ? (a.dataset.act || '') : '', row: row ? row.dataset.id : null,
    tag: a ? a.tagName : null, label: a && a.getAttribute ? a.getAttribute('aria-label') : null }; })()`);
const BODY = "document.querySelector('#categoryModal .modal-body')";

//  zz 과제를 사람이 지우는 길로 지운다 — 그 행의 [삭제] → 확인 상자 [삭제](#cfOk).
async function deleteCatViaUi(id) {
  if (!(await cdp.ev(isOpen('#categoryModal')))) await openCat();
  await saveIdle();
  const r = await cdp.ev(`(function(){
    const row = [].find.call(document.querySelectorAll('#catList .cat-row'), function(x){ return x.dataset.id === ${JSON.stringify(id)}; });
    const b = row && row.querySelector('[data-act="del"]'); if (!b) return 'nobtn'; b.click(); return 'ok'; })()`);
  if (r !== 'ok') return false;
  if (!(await waitFor(isOpen('#confirmModal'), 3000, 100))) return false;
  await cdp.ev(`document.getElementById('cfOk').click(); 1`);
  const gone = await waitFor(`!state.categories.some(function(c){ return c.id === ${JSON.stringify(id)}; })`, 4000, 100);
  await sleep(150);
  await saveIdle();
  return gone;
}
//  개인 과제를 사람이 만드는 길로 만든다 — 이름 칸 → [과제 추가](#btnCatSave). 새 과제는 맨 뒤에 붙는다(R6).
async function addCatViaUi(name) {
  if (!(await cdp.ev(isOpen('#categoryModal')))) await openCat();
  await saveIdle();
  await cdp.ev(`(function(){ const n = document.getElementById('cName'); n.value = ${JSON.stringify(name)};
    n.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('btnCatSave').click(); return 1; })()`);
  const got = await waitFor(`state.categories.some(function(c){ return c.name === ${JSON.stringify(name)}; })`, 4000, 100);
  await sleep(150);
  await saveIdle();
  return got ? J(`(function(){ const c = state.categories.find(function(c){ return c.name === ${JSON.stringify(name)}; }); return { id: c.id, last: state.categories[state.categories.length - 1] === c }; })()`) : null;
}
function monthRange() {
  const d = new Date(); const y = d.getFullYear(), m = d.getMonth();
  const p = (n) => String(n).padStart(2, '0');
  const last = new Date(y, m + 1, 0).getDate();
  return [`${y}-${p(m + 1)}-01`, `${y}-${p(m + 1)}-${p(last)}`];
}
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
//  보고서 행의 기대 순서 — state.categories 순서에서 「기타」 이름 과제를 뒤로, 미분류(__uncat__)는 맨 뒤.
function expectedReportKeys(cs, rowKeys) {
  const nonG = cs.filter((c) => c.name.trim() !== '기타').map((c) => c.id);
  const g = cs.filter((c) => c.name.trim() === '기타').map((c) => c.id);
  const exp = nonG.concat(g);
  if (rowKeys.includes('__uncat__')) exp.push('__uncat__');
  return exp;
}

/* ── 본체 ─────────────────────────────────────────────────────────── */
console.log('═'.repeat(74));
console.log(`과제 순서 설정 실동작 루프 — 시드 ${OPT.seed} · 포트 ${OPT.port} · 과제 ${ZZ}*`);
console.log('═'.repeat(74));

let ORIG = null;            // 원래 순서(zz 를 만들기 전) — 정리의 목표
const CREATED = [];         // 이 실행이 만든 zz 과제 id
let faultOk = false;
let healthyAtEnd = null;
let restored = null;
let notReady = false;

async function main() {
  cdp = await Cdp.attach(OPT.port);

  /* ── O0 전제 ── */
  head('O0 전제 — 로그인 · 정상 연결 · 과제 ≥ 3 · 원래 순서');
  vlog('기록기:', await cdp.ev(INSTALL));
  if (await cdp.ev("typeof moveCategory !== 'function' || typeof catMoveRow !== 'function'")) {
    notReady = true; undecide('O0 기능 존재', '위젯에 moveCategory/catMoveRow 가 없다 — 낡은 빌드다(dotnet build -c Debug 후 재시작)'); return;
  }
  const f0 = await fault('off').catch(() => null);
  faultOk = !!(f0 && f0.ok === true);
  if (faultOk) ok('O0 __dbFault{off} → ok:true', true);
  else note(`__dbFault 를 쓸 수 없다(회신=${JSON.stringify(f0)}) — 디버그 실행이 아니면 C6 은 판정 불가로 남는다`);
  const user = await cdp.ev("(typeof currentUser !== 'undefined' && currentUser && currentUser.loginId) || ''");
  if (!user) { notReady = true; undecide('O0 로그인', '위젯이 로그인 상태가 아니다'); return; }
  //  앞 루프가 남긴 상태 치유(loop-offline 과 같은 손) — 사람이 [다시 시도] 를 한 번 누르는 것과 같다. 시험 대상이 아니다.
  if (!(await waitFor(isHealthy, 5000))) {
    vlog('시작 상태 치유: 다시 시도 1회');
    await cdp.ev("(() => { const b = document.getElementById('dsErrorRetry') || document.getElementById('dbUnsavedRetry'); if (b) { b.click(); return 'click'; } hpost({ cmd: 'reloadState' }); return 'reload'; })()");
  }
  if (!(await waitFor(isHealthy, 30000))) {
    notReady = true;
    undecide('O0 정상 연결', '시작 상태가 정상이 아니다: ' + JSON.stringify(await J('({ conn: conn, bootOk: bootOk, unsaved: unsaved })')));
    return;
  }
  ok('O0 로그인 · conn ok · bootOk · 잠금 없음', !(await cdp.ev('editLocked()')), `login=${user}`);
  await closeAll();
  //  지난 실행이 중단돼 남긴 zz 과제가 있으면 먼저 앱으로 지운다(원래 순서를 깨끗하게).
  const left0 = await zzCats();
  if (left0.length) {
    let okAll = true;
    for (const c of left0) okAll = (await deleteCatViaUi(c.id)) && okAll;
    note(`지난 실행의 zz 과제 ${left0.length}건을 앱으로 지웠다(${okAll ? '성공' : '일부 실패'})`);
    if (!okAll) { notReady = true; undecide('O0 사전 정리', 'zz 과제 잔재를 지우지 못했다'); return; }
    await closeAll();
  }
  ORIG = await order();
  note(`원래 순서(${ORIG.length}): ${JSON.stringify(ORIG)}`);
  for (let n = 1; (await order()).length < 3; n++) {
    const r = await addCatViaUi(ZZ + n);
    if (!r) { notReady = true; undecide('O0 zz 과제 만들기', `${ZZ + n} 를 폼으로 만들지 못했다`); return; }
    CREATED.push(r.id);
    ok(`O0 zz 과제 ${ZZ + n} 추가 — 맨 뒤에 붙는다(R6)`, r.last === true);
  }
  const cs0 = await cats();
  ok(`O0 과제 ≥ 3(${cs0.length}건 · 개인 ${cs0.filter((c) => !c.off).length} · 공식 ${cs0.filter((c) => c.off).length})`, cs0.length >= 3);

  /* ── C1 목록 = 실제 순서 · 섞임 ── */
  head('C1 「과제 관리」 목록 = state.categories 순서(개인·공식 섞임 그대로)');
  ok('C1 헤더 [과제 관리] 로 모달이 열린다', await openCat());
  ok('C1 목록 행 순서 = state.categories', same(await domOrder(), await order()), JSON.stringify({ dom: await domOrder(), state: await order() }));
  ok('C1 안내 한 줄 「순서는 보고서·필터에 그대로 반영됩니다」가 보인다(R8)',
    await cdp.ev("(function(){ const h = document.getElementById('catOrderHint'); return !!h && !h.classList.contains('hidden') && /순서는 보고서·필터에 그대로 반영됩니다/.test(h.textContent) && h.offsetHeight > 0; })()"));
  ok('C1 각 행 ▲▼ 는 진짜 버튼 + aria-label「위로 이동: 과제명」/「아래로 이동: 과제명」', await cdp.ev(`(function(){
    const rows = document.querySelectorAll('#catList .cat-row'); if (!rows.length) return false;
    return [].every.call(rows, function(r){ const c = catById(r.dataset.id); const u = r.querySelector('[data-act="up"]'), d = r.querySelector('[data-act="down"]');
      return !!c && u && d && u.tagName === 'BUTTON' && d.tagName === 'BUTTON' && u.getAttribute('aria-label') === '위로 이동: ' + c.name && d.getAttribute('aria-label') === '아래로 이동: ' + c.name; }); })()`));
  let C1moves = 0;
  {
    const cs = await cats();
    const nP = cs.filter((c) => !c.off).length, nO = cs.filter((c) => c.off).length;
    const interleaved = (list) => list.some((c, i) => c.off && list.slice(0, i).some((x) => !x.off) && list.slice(i + 1).some((x) => !x.off));
    if (nP >= 2 && nO >= 1) {
      if (!interleaved(cs)) {
        //  공식 하나를 개인 사이로 — 진짜 ▲/▼ 로 한 칸씩(개인을 하나 지나칠 때까지).
        const o = cs.find((c) => c.off);
        const dir = cs.slice(0, cs.indexOf(o)).some((x) => !x.off) ? 'up' : 'down';
        for (let k = 0; k < cs.length && !interleaved(await cats()); k++) {
          const p = await press(o.id, dir);
          C1moves++;
          if (p.r !== 'ok' || p.saves.length !== 1) { ok(`C1 배치용 ${dir === 'up' ? '▲' : '▼'} (${o.name})`, false, JSON.stringify({ r: p.r, saves: p.saves.length })); break; }
        }
        note(`공식 과제 하나를 개인 과제 사이로 옮겼다(${C1moves}칸)`);
      }
      const csN = await cats();
      ok('C1 공식 과제가 개인 과제 사이에 있다(state)', interleaved(csN), JSON.stringify(csN.map((c) => (c.off ? 'O' : 'P')).join('')));
      ok('C1 옮긴 직후 목록 = state.categories', same(await domOrder(), await order()));
      await openCat();   // 다시 연다 = renderCatModal 이 새로 그린다 — 개인 먼저로 다시 묶으면 여기서 갈린다
      const dO = await domOrder(), dOff = await domOfficial();
      ok('C1 다시 연 목록도 state.categories 순서(개인 먼저로 다시 묶지 않는다 — R1)', same(dO, await order()), JSON.stringify(dO));
      ok('C1 다시 연 목록에서 공식(DB 배지) 행이 개인 행 사이에 그려진다',
        dOff.some((off, i) => off && dOff.slice(0, i).some((x) => !x) && dOff.slice(i + 1).some((x) => !x)), JSON.stringify(dOff.map((x) => (x ? 'O' : 'P')).join('')));
    } else {
      na('C1 개인·공식 섞임', `개인 ${nP} · 공식 ${nO} — 공식을 개인 사이에 둘 수 없다`);
    }
  }

  /* ── C2 · C7 마지막 행 ▲ ── */
  head('C2 · C7 마지막 행 ▲(focus → click) — 한 칸 · 저장 1회 · 끝 버튼 비활성 · 포커스·스크롤 유지');
  let EXPECT = await order();
  const n = EXPECT.length;
  const lastId = EXPECT[n - 1];
  const lastName = (await cats()).find((c) => c.id === lastId).name;
  //  스크롤 자리 — 모달 본문(.modal-body)이 스크롤 상자다(#catList 자체는 늘어난다). 마지막 행이 가운데 오게 굴려 둔다.
  const geo = await J(`(function(){ const b = ${BODY}; const rows = document.querySelectorAll('#catList .cat-row'); const r = rows[rows.length - 1];
    if (!b || !r) return null;
    const scrollable = b.scrollHeight > b.clientHeight + 4;
    if (scrollable) { const br = b.getBoundingClientRect(), rr = r.getBoundingClientRect(); b.scrollTop += (rr.top - br.top) - (b.clientHeight / 2 - rr.height / 2); }
    return { scrollable: scrollable, sh: b.scrollHeight, ch: b.clientHeight, st: b.scrollTop }; })()`);
  vlog('스크롤:', JSON.stringify(geo));
  await sleep(150);
  const st0 = await cdp.ev(`${BODY}.scrollTop`);
  const p1 = await press(lastId, 'up');
  EXPECT = swapped(EXPECT, n - 1, n - 2);
  ok(`C2 마지막 행(${lastName}) ▲ 를 눌렀다`, p1.r === 'ok', p1.r);
  ok('C2 한 번 = saveState 1회', p1.saves.length === 1, `${p1.saves.length}회`);
  ok('C2 그 저장이 성공했고 payload 순서 = 옮긴 순서', !!(p1.saves[0] && p1.saves[0].res && p1.saves[0].res.ok) && same(p1.saves[0] && p1.saves[0].order, EXPECT),
    JSON.stringify(p1.saves.map((x) => ({ res: x.res, order: x.order }))));
  ok('C2 한 칸 위로(state.categories)', same(await order(), EXPECT), JSON.stringify(await order()));
  ok('C2 목록 행 순서 = state.categories', same(await domOrder(), EXPECT));
  const e1 = await endsDisabled();
  ok('C2 첫 행 ▲ · 마지막 행 ▼ 비활성 · 그 밖은 켜짐', !!e1 && e1.firstUp && e1.lastDown && e1.midOk, JSON.stringify(e1));
  const f1 = await focusInfo();
  ok('C7 포커스 = 옮겨진 행의 같은 ▲(같은 노드)', f1.same && f1.row === lastId && f1.act === 'up', JSON.stringify(f1));
  if (geo && geo.scrollable) {
    const st1 = await cdp.ev(`${BODY}.scrollTop`);
    ok('C7 모달 스크롤 자리 유지(.modal-body scrollTop)', Math.abs(st1 - st0) < 1, `${st0} → ${st1}`);
  } else na('C7 스크롤 자리', `모달 본문이 스크롤되지 않는다(${JSON.stringify(geo)})`);
  //  맨 위까지 — 한 번에 한 칸 · 매번 저장 1회. 맨 위에 닿아 ▲ 가 꺼지면 포커스는 같은 행의 ▼ 로.
  let perPress = true, steps = 0;
  for (let i = n - 2; i > 0; i--) {
    const p = await press(lastId, 'up');
    steps++;
    EXPECT = swapped(EXPECT, i, i - 1);
    if (p.r !== 'ok' || p.saves.length !== 1 || !same(await order(), EXPECT)) { perPress = false; vlog('맨 위로 가는 중 어긋남:', JSON.stringify({ r: p.r, saves: p.saves.length })); break; }
  }
  ok(`C2 맨 위까지 ${steps}번 더 — 매번 한 칸 · 저장 1회`, perPress);
  ok('C2 맨 위에 닿았다(state · 목록)', (await order())[0] === lastId && same(await domOrder(), await order()));
  const f2 = await focusInfo();
  ok('C7 맨 위에 닿으면 포커스가 같은 행의 ▼ 로 넘어간다(body 로 떨어지지 않는다)', f2.row === lastId && f2.act === 'down', JSON.stringify(f2));
  const e2 = await endsDisabled();
  ok('C2 맨 위로 온 행의 ▲ 비활성 · 마지막 행 ▼ 비활성', !!e2 && e2.firstUp && e2.lastDown && e2.midOk, JSON.stringify(e2));

  /* ── C3 서버에서 다시 읽기 ── */
  head('C3 reloadState → 서버에서 다시 읽은 순서 = 옮긴 직후 순서');
  ok('C3 저장 대기열이 비었다', await saveIdle());
  const rr = await reload();
  ok('C3 reloadState → 적용(__applyState)', rr === 'applied', rr);
  ok('C3 다시 읽힌 state.categories 순서 = 옮긴 직후 순서', same(await order(), EXPECT), JSON.stringify({ got: await order(), want: EXPECT }));

  /* ── C4 보고서 ── */
  head('C4 보고서 행 순서 = 목록 순서(「기타」·미분류 맨 뒤) — collectReportData + 미리보기');
  await closeAll();
  {
    let [from, to] = monthRange();
    const rowsOf = (f, t) => J(`collectReportData(${JSON.stringify(f)}, ${JSON.stringify(t)}, rptSources()).rows.map(function(r){ return { key: r.key, name: r.name, n: r.titles.length }; })`);
    let rows = await rowsOf(from, to);
    //  이번 달에 내용이 없으면 기록이 있는 기간(가장 이른 ~ 가장 늦은 기록 날짜)으로 넓힌다 — 내용 있는 행·미분류가 실제로 줄을 서게.
    if (!rows.some((r) => r.n > 0)) {
      const span = await J(`(function(){ const ds = (state.entries || []).map(function(e){ return e.date; }).filter(function(d){ return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d || ''); }).sort();
        return ds.length ? [ds[0], ds[ds.length - 1]] : null; })()`);
      if (span) { note(`이번 달(${from}~${to})에 보고 내용이 없다 — 기록이 있는 기간 ${span[0]}~${span[1]} 로 본다`); [from, to] = span; rows = await rowsOf(from, to); }
    }
    const src = await J('rptSources()');
    const cs = await cats();
    const keys = rows.map((r) => r.key);
    const exp = expectedReportKeys(cs, keys);
    const expPresent = exp.filter((k) => keys.includes(k));
    note(`기간 ${from}~${to}: 행 ${rows.length} · 내용 있는 행 ${rows.filter((r) => r.n > 0).length} · 미분류 ${keys.includes('__uncat__') ? '있음' : '없음'} · 「기타」 과제 ${cs.some((c) => c.name.trim() === '기타') ? '있음' : '없음'}`);
    ok('C4 보고서 행이 모두 알려진 과제(또는 미분류)다', keys.every((k) => exp.includes(k)), JSON.stringify(keys));
    ok('C4 보고서 행 순서 = state.categories 순서(「기타」 과제 뒤 · 미분류 맨 뒤)', same(keys, expPresent), JSON.stringify({ keys, exp: expPresent }));
    if (!src.skipEmpty) ok('C4 「내용 없는 항목 제외」가 꺼져 있으니 모든 과제가 행이다', cs.every((c) => keys.includes(c.id)), `${keys.length} vs ${cs.length}`);
    else note('「내용 없는 항목 제외」가 켜져 있다 — 빈 과제 행은 빠진다(순서만 본다)');
    if (keys.includes('__uncat__')) ok('C4 미분류는 맨 뒤', keys[keys.length - 1] === '__uncat__');
    else na('C4 미분류 맨 뒤', `${from}~${to} 에 미분류 기록이 없다`);
    const gita = cs.filter((c) => c.name.trim() === '기타').map((c) => c.id);
    if (gita.length) ok('C4 「기타」 과제는 일반 과제 뒤', keys.filter((k) => k !== '__uncat__').slice(-gita.length).every((k) => gita.includes(k)));
    else na('C4 「기타」 과제 맨 뒤', '「기타」 이름의 과제가 없다');
    //  같은 순서가 **옮긴 순서**에서 나온다(옮긴 행이 보고서에서도 맨 앞 — 「기타」가 아니면)
    if (cs[0] && cs[0].name.trim() !== '기타') ok('C4 맨 위로 옮긴 과제가 보고서 첫 행이다', keys[0] === cs[0].id || (src.skipEmpty && !keys.includes(cs[0].id)), JSON.stringify(keys.slice(0, 3)));

    //  보고서 창을 사람이 여는 문(헤더 #btnReportTop)으로 연다 — 일간(오늘) 미리보기 카드 순서.
    await cdp.ev(`(function(){ const b = document.getElementById('btnReportTop'); if (b) b.click(); else openReport(); return 1; })()`);
    const opened = await waitFor(isOpen('#reportModal'), 3000, 100);
    ok('C4 [보고서] 로 보고서 창이 열린다', opened);
    //  미리보기 카드(.rcard .rcard-nm) 순서 = 같은 기간·같은 포함 항목의 collectReportData 행 순서 = state.categories 순서.
    const checkPreview = async (label) => {
      await waitFor("document.querySelectorAll('#rptOut .rcard').length > 0", 5000, 150);
      const pv = await J(`(function(){ const f = document.getElementById('rptFrom').value, t = document.getElementById('rptTo').value;
        const rows = collectReportData(f, t, rptSources()).rows;
        return { from: f, to: t, mode: reportMode, src: state.reportSource,
          dom: [].map.call(document.querySelectorAll('#rptOut .rcard .rcard-nm'), function(x){ return x.textContent; }),
          data: rows.map(function(r){ return r.name; }), keys: rows.map(function(r){ return r.key; }), n: rows.filter(function(r){ return r.titles.length > 0; }).length }; })()`);
      vlog('미리보기:', JSON.stringify(pv));
      if (!pv.dom.length) { undecide(`C4 미리보기 카드(${label})`, `미리보기에 카드가 없다(${pv.mode} · 출처 ${pv.src})`); return; }
      ok(`C4 ${label} 미리보기 카드 순서 = 보고서 행 순서(${pv.from}~${pv.to} · ${pv.dom.length}장 · 내용 있는 행 ${pv.n})`, same(pv.dom, pv.data), JSON.stringify({ dom: pv.dom, data: pv.data }));
      const expK = expectedReportKeys(cs, pv.keys).filter((k) => pv.keys.includes(k));
      ok(`C4 ${label} 미리보기의 행 = state.categories 순서(「기타」·미분류 맨 뒤)`, same(pv.keys, expK), JSON.stringify({ keys: pv.keys, exp: expK }));
      if (pv.keys.includes('__uncat__')) ok(`C4 ${label} 미리보기의 마지막 카드 = 미분류(「기타」)`, pv.keys[pv.keys.length - 1] === '__uncat__' && pv.dom[pv.dom.length - 1] === '기타', JSON.stringify(pv.dom.slice(-2)));
    };
    await checkPreview('일간(오늘)');
    //  기록이 있는 기간이 오늘이 아니면 「기간 취합」 탭으로 그 기간을 그린다 — 내용 있는 카드·미분류 카드까지 줄을 선다.
    if (from !== to || from !== todayIso()) {
      const net = await cdp.ev("state.reportSource === 'net' || state.reportSource === 'week'");
      if (net) na('C4 기간 취합 미리보기', '내용 출처가 netcus 라 기간 취합은 netcus 미리보기다');
      else {
        await cdp.ev(`(function(){ const b = document.querySelector('#reportModal [data-rmode="custom"]'); b.click();
          const f = document.getElementById('rptFrom'), t = document.getElementById('rptTo');
          f.value = ${JSON.stringify(from)}; t.value = ${JSON.stringify(to)}; t.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
        await sleep(300);
        await checkPreview('기간 취합');
      }
    }
    await closeAll();
  }

  /* ── C5 필터 막대 · 과제 선택 ── */
  head('C5 필터 막대 · 새 기록 #fCat · 빠른 추가 #qaCat = state.categories 순서');
  {
    const cs = await cats();
    const ids = cs.map((c) => c.id), pick = cs.filter((c) => c.pick).map((c) => c.id);
    const chips = await J("[].map.call(document.querySelectorAll('#filterbar [data-cat]'), function(b){ return b.dataset.cat; }).filter(Boolean)");
    ok('C5 필터 막대 칩 순서 = state.categories', same(chips, ids), JSON.stringify({ chips, ids }));
    const DATE = todayIso();
    await cdp.ev(`openEntryModal('new', ${JSON.stringify(DATE)}); 1`);
    const fOpen = await waitFor(isOpen('#entryModal'), 3000, 100);
    const fCat = await J("[].map.call(document.querySelectorAll('#fCat option'), function(o){ return o.value; }).filter(Boolean)");
    ok('C5 새 기록 창이 열린다', fOpen);
    ok('C5 새 기록 #fCat 옵션 순서 = state.categories(선택 가능한 것)', same(fCat, pick), JSON.stringify({ fCat, pick }));
    await closeAll();
    await cdp.ev(`openQuickAdd(${JSON.stringify(DATE)}); 1`);
    const qOpen = await waitFor(isOpen('#quickAdd'), 3000, 100);
    const qaCat = await J("[].map.call(document.querySelectorAll('#qaCat option'), function(o){ return o.value; }).filter(Boolean)");
    ok('C5 빠른 추가가 열린다', qOpen);
    ok('C5 빠른 추가 #qaCat 옵션 순서 = state.categories(선택 가능한 것)', same(qaCat, pick), JSON.stringify({ qaCat, pick }));
    await closeAll();
  }

  /* ── C6 연결 끊김 중 이동 불가 ── */
  head('C6 (live) network 장애 → 끊김 → ▼ → 순서·화면·저장 변화 0 → 해제 → 복구');
  if (!faultOk) undecide('C6 연결 끊김 중 이동', '__dbFault 를 쓸 수 없다(디버그 실행이 아니다)');
  else {
    await openCat();
    const before = await order();
    const firstId = before[0];
    ok('C6 __dbFault{network} → ok', (await fault('network'))?.ok === true);
    const r6 = await reload();
    ok('C6 reloadState 가 실패로 끝난다(__applyStateError)', r6 === 'error', r6);
    ok("C6 conn ≠ 'ok' · editLocked() = true", await waitFor("conn !== 'ok' && editLocked()", 8000), JSON.stringify(await J('({ conn: conn, locked: editLocked() })')));
    await sleep(1600);   // 잠금 토스트는 1.5초에 한 번 — 앞선 토스트와 겹치지 않게
    const m6 = await mark();
    const p6 = await press(firstId, 'down', { idle: false });
    await sleep(500);
    const L6 = await since(m6);
    ok('C6 첫 행 ▼ 를 눌렀다(버튼은 켜져 있다)', p6.r === 'ok', p6.r);
    ok('C6 state.categories 순서 변화 0', same(await order(), before), JSON.stringify(await order()));
    ok('C6 목록 화면 순서 변화 0', same(await domOrder(), before), JSON.stringify(await domOrder()));
    ok('C6 saveState 0건', reqs(L6, 'saveState').length === 0, `${reqs(L6, 'saveState').length}건`);
    ok(`C6 잠금 토스트 「${LOCK_MSG}」`, toasts(L6).includes(LOCK_MSG), JSON.stringify(toasts(L6)));
    ok('C6 미저장 표시가 서지 않았다(바뀐 것이 없다)', (await cdp.ev('unsaved')) === false);
    ok('C6 __dbFault{off} → ok', (await fault('off'))?.ok === true);
    const t6 = Date.now();
    const rec6 = await waitFor(isHealthy, 30000, 300);
    ok(`C6 자동 복구(${((Date.now() - t6) / 1000).toFixed(1)}초) — conn ok · bootOk · 상자 없음`, rec6, JSON.stringify(await J('({ conn: conn, bootOk: bootOk, unsaved: unsaved })')));
    ok('C6 복구 뒤 다시 읽힌 순서 = 끊기기 전 순서', same(await order(), before), JSON.stringify(await order()));
  }
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
  //  ★ 무슨 일이 있어도 장애를 끄고, 정상으로 돌아온 뒤, zz 과제를 지우고 원래 순서로 되돌린다.
  if (cdp && ORIG) {
    head('정리 — 장애 off · 정상 복귀 · zz 과제 삭제 · 원래 순서 복원');
    try {
      if (faultOk) {
        let off = null;
        for (let i = 0; i < 3 && !(off && off.ok); i++) { try { off = await fault('off'); } catch (_) { off = null; await sleep(500); } }
        if (!(off && off.ok)) console.log(`${el()}   ★★ 경고: __dbFault{off} 가 확인되지 않았다 — 위젯을 재시작하세요(모드는 프로세스 안에만 있다)`);
      }
      if (!(await waitFor(isHealthy, 3000))) {
        await cdp.ev(`(function(){ const a = document.getElementById('dbUnsavedRetry') || document.getElementById('dsErrorRetry'); if (a) a.click(); return 1; })()`).catch(() => 0);
      }
      healthyAtEnd = await waitFor(isHealthy, 30000, 300);
      if (!healthyAtEnd) {
        await cdp.ev(`hpost({ cmd: 'reloadState' }); 1`).catch(() => 0);
        healthyAtEnd = await waitFor(isHealthy, 20000, 300);
      }
      if (healthyAtEnd) {
        await closeAll();
        await openCat();
        //  zz 과제 — 이 실행이 만든 것 + 이름이 zzORD- 로 시작하는 것(중단 잔재)
        const zz = await zzCats();
        for (const c of zz) ok(`정리: zz 과제 ${c.name} 삭제`, await deleteCatViaUi(c.id));
        //  원래 순서로 — 진짜 ▲ 를 눌러 한 칸씩(moveCategory 경로). 각 목표 자리에 올 과제를 위로 끌어올린다.
        const target = ORIG.slice();
        let stuck = false, moves = 0;
        for (let k = 0; k < target.length && !stuck; k++) {
          for (let guard = 0; guard < target.length + 2; guard++) {
            const cur = await order();
            const i = cur.indexOf(target[k]);
            if (i < 0) { stuck = true; note(`정리: 원래 과제 ${target[k]} 가 목록에 없다`); break; }
            if (i <= k) break;
            let p = await press(target[k], 'up');
            if (p.r !== 'ok') {   // 버튼을 못 찾으면(목록이 어긋났으면) 같은 함수를 직접 부른다
              await cdp.ev(`moveCategory(${JSON.stringify(target[k])}, -1)`); await saveIdle();
            }
            moves++;
          }
        }
        await saveIdle();
        const r = await reload();
        const fin = await order();
        restored = r === 'applied' && same(fin, ORIG);
        if (!restored) {
          //  마지막 수단 — 원래 순서로 배열을 놓고 save() 한 번.
          console.log(`${el()}   · 정리: ▲ 복원이 어긋났다(${r}) — 배열을 원래 순서로 놓고 save() 1회`);
          await cdp.ev(`(function(){ const want = ${JSON.stringify(ORIG)}; const by = new Map(state.categories.map(function(c){ return [c.id, c]; }));
            const rest = state.categories.filter(function(c){ return want.indexOf(c.id) < 0; });
            state.categories = want.filter(function(id){ return by.has(id); }).map(function(id){ return by.get(id); }).concat(rest); save(); return 1; })()`);
          await saveIdle();
          const r2 = await reload();
          restored = r2 === 'applied' && same(await order(), ORIG);
        }
        ok(`정리: 원래 순서 복원(▲ ${moves}번) — reloadState 뒤 서버 순서 = 원래 순서`, restored, JSON.stringify({ got: await order(), want: ORIG }));
        ok('정리: zz 과제 잔재 0', (await zzCats()).length === 0);
        await closeAll();
        healthyAtEnd = await waitFor(isHealthy, 5000);
      } else {
        restored = false;
      }
    } catch (e) {
      healthyAtEnd = false;
      F.push('정리 중 예외: ' + e.message); fail++;
    }
  }
  if (cdp) { try { await cdp.ev(UNINSTALL); } catch (_) { } cdp.close(); }
}

const secs = ((Date.now() - T0) / 1000).toFixed(1);
console.log('\n' + '═'.repeat(74));
console.log(`과제 순서 설정 루프 요약 — 시드 ${OPT.seed} · 소요 ${secs}s`);
if (F.length) { console.log(`실패 ${F.length}건:`); F.forEach((f) => console.log('  ✗ ' + f)); }
if (UD.length) { console.log(`판정 불가 ${UD.length}건:`); UD.forEach((f) => console.log('  ? ' + f)); }
if (NA.length) { console.log(`해당 없음 ${NA.length}건(이 데이터·배치에 성립 조건이 없다):`); NA.forEach((f) => console.log('  - ' + f)); }
if (cdp && ORIG && healthyAtEnd === false) {
  console.log('\n★★ 경고: 끝날 때 위젯이 정상(conn ok · bootOk · 상자·막대 없음)으로 돌아오지 않았다 — 화면을 확인하고 필요하면 재시작하세요.');
}
if (ORIG && restored === false) {
  console.log('\n★★★ 경고: 과제 순서를 원래대로 되돌리지 못했다 — 원래 순서(state.categories id):');
  console.log('    ' + JSON.stringify(ORIG));
}
console.log(`재현: node tests/loop-category-order.mjs --seed=${OPT.seed} --port=${OPT.port}`);
console.log(`\n통과 ${pass} · 실패 ${fail} · 판정 불가 ${undecided}`);
console.log('═'.repeat(74));
const cleanOk = !ORIG || (restored !== false && healthyAtEnd !== false);
process.exit(fail > 0 || !cleanOk ? 1 : (undecided > 0 || notReady ? 2 : 0));
