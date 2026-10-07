#!/usr/bin/env node
/* =====================================================================================
 *  tests/loop-default-tasks.mjs — 기본 과제 휴가, 기타 **실동작** 루프(docs/DEFAULT-TASKS.md §3~§6)
 * -------------------------------------------------------------------------------------
 *  계약 시험(default-tasks.test.mjs)은 jsdom 으로 규칙을 잠근다. 이 루프는 실제 위젯(Debug, TC_DEBUG_PORT)에 붙어
 *  로그인한 사용자 **자신의** 캘린더에서 진짜 버튼을 누르고, 그 결과가 실 호스트, 실 DB 를 지나 다시 읽혀도 그대로인지 본다.
 *  영속은 DB 를 직접 보지 않고 **앱을 통해** 확인한다: reloadState 를 보내 호스트가 다시 읽어 준 state(__applyState)에서 센다.
 *
 *  케이스:
 *    O0   전제 — 로그인, conn ok, bootOk, 새 기능(ensureDefaultTasks, moveCategoryData)이 있는 빌드, 지난 실행 잔재 정리
 *    D1   부팅 보장 — reloadState 뒤 개인 과제 휴가, 기타가 **정확히 하나씩**. 한 번 더 다시 읽어도 같은 id(서버에 저장됐다)
 *    D2   기본 과제는 지울 수 없다 — 행에 [삭제]가 없고, deleteCategory 가 거부하고, 다시 읽어도 그대로다
 *    D3   과제 삭제 = 데이터 삭제 — zz 과제에 일정 2, 할 일 1, 시간 2일을 만들고 [삭제] → 확인창 숫자 → [삭제]
 *         → 저장 ok(과제 DELETE 가 FK 로 실패하지 않는다) → 다시 읽으면 과제, 일정, 할 일, 시간이 모두 없다
 *    D4   옮기기 — zz 과제 A(일정 2, 할 일 1, 시간 3일) → B(시간 2일, 같은 날 겹침) 를 화면으로 옮긴다
 *         → 다시 읽으면 일정, 할 일이 B, 겹친 날 시간은 더해지고 24 상한, A 는 빈 과제로 남는다
 *    정리 zz 과제를 [삭제]로 지운다(딸린 일정, 할 일, 시간도 함께 지워진다) → 다시 읽어 잔재 0 확인
 *
 *  ★ 남기지 않는다: 시험 데이터는 전부 zz 접두어(과제 `zzDEF-<seed>-`, 일정과 할 일 제목도 같은 접두어)이고,
 *    시간은 2099-12 의 날짜에만 적는다(실데이터와 겹치지 않게). finally 에서 앱으로 지운다.
 *  ★ DB 에 직접 붙지 않는다 — 비밀번호가 필요 없다.
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 로그인된 채 띄운 뒤(예: powershell -File dist/promo/win.ps1 start)
 *    node tests/loop-default-tasks.mjs [--seed=N] [--port=9222] [-v]
 *    종료코드: 0 통과, 1 실패, 2 판정 불가(전제가 안 서서 증명하지 못함, 초록 아님)
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
  console.log(`사용법: node tests/loop-default-tasks.mjs [--seed=N] [--port=${OPT.port}] [-v]`);
  process.exit(0);
}
const ZZ_ALL = 'zzDEF-';
const ZZ = `${ZZ_ALL}${OPT.seed}-`;
//  시간을 적는 날짜 — 실데이터와 겹치지 않는 먼 미래(정리 뒤 이 날짜들에 zz 과제의 시간이 남으면 실패다)
const D1 = '2099-12-01', D2 = '2099-12-02', D3 = '2099-12-03';

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   ·', ...a); };

let pass = 0, fail = 0, undecided = 0;
const F = [], UD = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`${el()}   ✓ ${n}${d && OPT.verbose ? ' : ' + d : ''}`); return true; }
  fail++; F.push(n + (d ? ' : ' + d : ''));
  console.log(`${el()}   ✗ ${n}${d ? ' : ' + String(d).slice(0, 300) : ''}`); return false;
};
const undecide = (n, d = '') => { undecided++; UD.push(n + (d ? ' : ' + d : '')); console.log(`${el()}   ? ${n}, 판정 불가${d ? ': ' + d : ''}`); };
const note = (m) => console.log(`${el()}   · ${m}`);
const head = (m) => console.log(`\n${el()} [${m}]`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── 최소 CDP(다른 루프와 같은 모양) ─────────────────────────────────── */
class Cdp {
  #ws = null; #id = 0; #p = new Map();
  static async attach(port) {
    let list;
    try { list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json(); }
    catch (e) { throw new Error(`CDP 에 붙지 못했다(포트 ${port}). 위젯을 TC_DEBUG_PORT=${port} 로 띄웠나요? (${e.message})`); }
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

/* ── 페이지 기록기 — hostRequest, toast, __applyState, __applyStateError 를 감싼다(원본을 그대로 부른다) ── */
//  ★ 감싸기만 한다. 동작은 바꾸지 않는다. finally 에서 반드시 원본으로 되돌린다.
const INSTALL = `(function(){
  if (window.__defRec) return 'already';
  const R = window.__defRec = { log: [], orig: { hostRequest: hostRequest, toast: toast,
    applyState: window.__applyState, applyErr: window.__applyStateError } };
  hostRequest = function(cmd, params, t){
    const rec = { t: Date.now(), req: cmd };
    R.log.push(rec);
    return R.orig.hostRequest(cmd, params, t).then(function(res){
      rec.done = Date.now();
      rec.res = { ok: !!(res && res.ok), kind: res && res.kind, error: res && res.error };
      return res;
    });
  };
  toast = function(m, k, a, ms){ R.log.push({ t: Date.now(), toast: String(m), kind: k }); return R.orig.toast(m, k, a, ms); };
  window.__applyState = function(j, m){ R.log.push({ t: Date.now(), applied: true }); return R.orig.applyState(j, m); };
  window.__applyStateError = function(msg, opt){ R.log.push({ t: Date.now(), applyErr: String(msg) }); return R.orig.applyErr(msg, opt); };
  return 'ok';
})()`;
const UNINSTALL = `(function(){
  const R = window.__defRec; if (!R) return 'none';
  hostRequest = R.orig.hostRequest; toast = R.orig.toast;
  window.__applyState = R.orig.applyState; window.__applyStateError = R.orig.applyErr;
  delete window.__defRec; return 'ok';
})()`;
const mark = () => cdp.ev('__defRec.log.length');
const since = (m) => J(`__defRec.log.slice(${Number(m)})`);
const reqs = (L, cmd) => L.filter((x) => x.req === cmd);

/* ── 앱 조작 ────────────────────────────────────────────────────────── */
const isHealthy = 'conn === "ok" && bootOk === true && !unsaved && !document.getElementById("dsError") && !document.getElementById("dbUnsaved")';
const saveIdle = () => waitFor('!__dbSaving && !__dbDirty', 30000, 150);
const isOpen = (sel) => `(function(){ const m = document.querySelector(${JSON.stringify(sel)}); return !!m && !m.classList.contains('hidden') && !m.classList.contains('closing'); })()`;

async function reload(ms = 20000) {
  await saveIdle();
  const m = await mark();
  await cdp.ev(`hpost({ cmd: 'reloadState' }); 1`);
  const t = Date.now();
  while (Date.now() - t < ms) {
    const L = await since(m);
    const r = L.find((x) => x.applied || x.applyErr);
    if (r) { await sleep(300); await saveIdle(); return r.applied ? 'applied' : 'error'; }
    await sleep(200);
  }
  return 'timeout';
}
//  기본 과제 현황 — 개인 과제 중 이름이 정확히 휴가/기타 인 것(공식 과제는 이름이 같아도 아니다)
const defaults = () => J(`(function(){ const p = state.categories.filter(function(c){ return !isOfficialCat(c); });
  return { vac: p.filter(function(c){ return c.name === '휴가'; }).map(function(c){ return c.id; }),
           etc: p.filter(function(c){ return c.name === '기타'; }).map(function(c){ return c.id; }),
           vacDef: !!defaultTaskOf('휴가') && isDefaultTask(defaultTaskOf('휴가')), etcDef: !!defaultTaskOf('기타') && isDefaultTask(defaultTaskOf('기타')) }; })()`);
const catIdByName = (name) => cdp.ev(`(function(){ const c = state.categories.find(function(c){ return c.name === ${JSON.stringify(name)}; }); return c ? c.id : null; })()`);
const zzCats = () => J(`state.categories.filter(function(c){ return String(c.name || '').indexOf(${JSON.stringify(ZZ_ALL)}) === 0; }).map(function(c){ return { id: c.id, name: c.name }; })`);
//  한 과제에 딸린 것 — 일정 id, 할 일 id, 시간(시험 날짜만)
const dataOf = (id) => J(`(function(){ const id = ${JSON.stringify(id)};
  const h = {}; [${JSON.stringify(D1)}, ${JSON.stringify(D2)}, ${JSON.stringify(D3)}].forEach(function(d){ const v = getTaskHours(d, id); if (v != null) h[d] = v; });
  return { entries: state.entries.filter(function(e){ return e.categoryId === id; }).map(function(e){ return e.title; }).sort(),
           todos: (state.todos || []).filter(function(t){ return t.categoryId === id; }).map(function(t){ return t.text; }).sort(), hours: h }; })()`);
const zzLeft = () => J(`(function(){ const z = ${JSON.stringify(ZZ_ALL)};
  return { cats: state.categories.filter(function(c){ return String(c.name || '').indexOf(z) === 0; }).length,
           entries: state.entries.filter(function(e){ return String(e.title || '').indexOf(z) === 0; }).length,
           todos: (state.todos || []).filter(function(t){ return String(t.text || '').indexOf(z) === 0; }).length }; })()`);

async function closeAll() {
  await cdp.ev(`(function(){ ['#confirmModal','#catMoveModal','#quickAdd','#entryModal','#reportModal','#categoryModal'].forEach(function(s){
    try { const m = document.querySelector(s); if (m && !m.classList.contains('hidden')) closeModal(s); } catch (_) {} }); return 1; })()`);
  await sleep(400);
}
//  「내 과제」를 사람이 여는 문(헤더 #btnCatsTop)으로 연다
async function openCat() {
  if (await cdp.ev(isOpen('#categoryModal'))) { await cdp.ev("closeModal('#categoryModal'); 1"); await sleep(450); }
  await cdp.ev(`(function(){ const b = document.getElementById('btnCatsTop'); if (b) b.click(); else openCatModal(); return 1; })()`);
  const opened = await waitFor(isOpen('#categoryModal'), 3000, 100);
  await sleep(350);
  return opened;
}
//  개인 과제를 사람이 만드는 길로 만든다 — 이름 칸 → [과제 추가](#btnCatSave)
async function addCatViaUi(name) {
  if (!(await cdp.ev(isOpen('#categoryModal')))) await openCat();
  await saveIdle();
  await cdp.ev(`(function(){ const n = document.getElementById('cName'); n.value = ${JSON.stringify(name)};
    n.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('btnCatSave').click(); return 1; })()`);
  const got = await waitFor(`state.categories.some(function(c){ return c.name === ${JSON.stringify(name)}; })`, 4000, 100);
  await sleep(150);
  await saveIdle();
  return got ? catIdByName(name) : null;
}
//  행의 버튼을 누른다(그 행이 없거나 버튼이 없으면 이유를 돌려준다)
const rowBtn = (id, act) => cdp.ev(`(function(){
  const row = [].find.call(document.querySelectorAll('#catList .cat-row'), function(x){ return x.dataset.id === ${JSON.stringify(id)}; });
  if (!row) return 'norow'; const b = row.querySelector('[data-act="${act}"]'); if (!b) return 'nobtn';
  try { b.scrollIntoView({ block: 'nearest' }); } catch (_) {} b.click(); return 'ok'; })()`);
//  과제를 사람이 지우는 길로 지운다 — 그 행의 [삭제] → 확인 상자의 문구를 읽고 [삭제](#cfOk). 돌려주는 값 = { gone, msg, saves }
async function deleteCatViaUi(id) {
  if (!(await cdp.ev(isOpen('#categoryModal')))) await openCat();
  await saveIdle();
  const m = await mark();
  const r = await rowBtn(id, 'del');
  if (r !== 'ok') return { gone: false, msg: '', why: r };
  if (!(await waitFor(isOpen('#confirmModal'), 3000, 100))) return { gone: false, msg: '', why: 'noconfirm' };
  const msg = await cdp.ev("document.getElementById('cfMsg').textContent");
  await cdp.ev(`document.getElementById('cfOk').click(); 1`);
  const gone = await waitFor(`!state.categories.some(function(c){ return c.id === ${JSON.stringify(id)}; })`, 4000, 100);
  await sleep(150);
  await saveIdle();
  const L = await since(m);
  return { gone, msg, saves: reqs(L, 'saveState'), toasts: L.filter((x) => x.toast).map((x) => x.toast) };
}
//  시험 데이터 — 앱의 데이터 함수로 만든다(addEntry, addTodo, setTaskHours 는 저장까지 한다)
async function seedData(catId, tag, hours) {
  await saveIdle();
  await cdp.ev(`(function(){ const c = ${JSON.stringify(catId)}, z = ${JSON.stringify(ZZ + tag)};
    addEntry({ date: ${JSON.stringify(D1)}, title: z + ' 일정1', categoryId: c, allDay: true });
    addEntry({ date: ${JSON.stringify(D2)}, title: z + ' 일정2', categoryId: c, allDay: true });
    addTodo(z + ' 할 일', { categoryId: c, due: ${JSON.stringify(D1)} });
    return 1; })()`);
  await saveIdle();
  for (const [d, h] of Object.entries(hours || {})) { await cdp.ev(`setTaskHours(${JSON.stringify(d)}, ${JSON.stringify(catId)}, ${JSON.stringify(h)}); 1`); await saveIdle(); }
}

/* ── 본체 ─────────────────────────────────────────────────────────── */
console.log('═'.repeat(74));
console.log(`기본 과제 실동작 루프 — 시드 ${OPT.seed}, 포트 ${OPT.port}, 시험 과제 ${ZZ}*`);
console.log('═'.repeat(74));

let started = false;       // 전제가 서서 시험 데이터를 만들기 시작했다(정리 대상이 있을 수 있다)
let healthyAtEnd = null;
let cleaned = null;
let notReady = false;

async function main() {
  cdp = await Cdp.attach(OPT.port);

  /* ── O0 전제 ── */
  head('O0 전제 — 로그인, 정상 연결, 새 빌드, 지난 실행 잔재 정리');
  vlog('기록기:', await cdp.ev(INSTALL));
  if (await cdp.ev("typeof ensureDefaultTasks !== 'function' || typeof moveCategoryData !== 'function' || typeof isDefaultTask !== 'function'")) {
    notReady = true; undecide('O0 기능 존재', '위젯에 ensureDefaultTasks/moveCategoryData 가 없다. 낡은 빌드다(dotnet build -c Debug 후 재시작)'); return;
  }
  const user = await cdp.ev("(typeof currentUser !== 'undefined' && currentUser && currentUser.loginId) || ''");
  if (!user) { notReady = true; undecide('O0 로그인', '위젯이 로그인 상태가 아니다'); return; }
  if (!(await waitFor(isHealthy, 5000))) {
    vlog('시작 상태 치유: 다시 시도 1회');
    await cdp.ev("(() => { const b = document.getElementById('dsErrorRetry') || document.getElementById('dbUnsavedRetry'); if (b) { b.click(); return 'click'; } hpost({ cmd: 'reloadState' }); return 'reload'; })()");
  }
  if (!(await waitFor(isHealthy, 30000))) {
    notReady = true;
    undecide('O0 정상 연결', '시작 상태가 정상이 아니다: ' + JSON.stringify(await J('({ conn: conn, bootOk: bootOk, unsaved: unsaved })')));
    return;
  }
  ok('O0 로그인, conn ok, bootOk, 잠금 없음', !(await cdp.ev('editLocked()')), `login=${user}`);
  await closeAll();
  started = true;
  const left0 = await zzCats();
  if (left0.length) {
    let okAll = true;
    for (const c of left0) okAll = (await deleteCatViaUi(c.id)).gone && okAll;
    note(`지난 실행의 zz 과제 ${left0.length}건을 앱으로 지웠다(${okAll ? '성공' : '일부 실패'})`);
    if (!okAll) { notReady = true; undecide('O0 사전 정리', 'zz 과제 잔재를 지우지 못했다'); return; }
    await closeAll();
  }

  /* ── D1 부팅 보장 ── */
  head('D1 부팅 보장 — 다시 읽은 뒤 휴가, 기타가 정확히 하나씩 · 서버에 저장돼 id 가 그대로');
  {
    const m = await mark();
    const r1 = await reload();
    ok('D1 reloadState → 적용(__applyState)', r1 === 'applied', r1);
    const L = await since(m);
    const bootSaves = reqs(L, 'saveState');
    if (bootSaves.length) note(`부팅 보장이 저장을 ${bootSaves.length}번 보냈다(이 사용자에게 기본 과제가 없었다)`);
    ok('D1 부팅 보장 저장은 많아야 한 번이고 성공했다', bootSaves.length <= 1 && bootSaves.every((x) => x.res && x.res.ok), JSON.stringify(bootSaves));
    const a = await defaults();
    ok('D1 개인 과제 휴가가 정확히 하나', a.vac.length === 1, JSON.stringify(a));
    ok('D1 개인 과제 기타가 정확히 하나', a.etc.length === 1, JSON.stringify(a));
    ok('D1 둘 다 기본 과제로 판정된다(isDefaultTask)', a.vacDef && a.etcDef, JSON.stringify(a));
    const m2 = await mark();
    const r2 = await reload();
    const b = await defaults();
    ok('D1 한 번 더 다시 읽어도 같은 id(서버에 저장돼 있다, 새로 만들지 않는다)', r2 === 'applied' && same(a.vac, b.vac) && same(a.etc, b.etc), JSON.stringify({ a, b }));
    ok('D1 이미 있으면 부팅이 저장하지 않는다', reqs(await since(m2), 'saveState').length === 0);
  }

  /* ── D2 기본 과제 보호 ── */
  head('D2 기본 과제는 지울 수 없다 — [삭제] 없음 · deleteCategory 거부 · 다시 읽어도 그대로');
  {
    const gita = await cdp.ev('gitaTaskId()');
    const vac = await cdp.ev("(defaultTaskOf('휴가') || {}).id || null");
    await openCat();
    ok('D2 기타 행에 [삭제] 버튼이 없다', (await rowBtn(gita, 'del')) === 'nobtn');
    ok('D2 휴가 행에 [삭제] 버튼이 없다', (await rowBtn(vac, 'del')) === 'nobtn');
    const m = await mark();
    ok('D2 deleteCategory(기타) 가 거부한다(화면 우회 방어)', (await cdp.ev(`deleteCategory(${JSON.stringify(gita)})`)) === false);
    await saveIdle();
    ok('D2 거부했으니 저장도 없다', reqs(await since(m), 'saveState').length === 0);
    await closeAll();
    const r = await reload();
    ok('D2 다시 읽어도 기타가 그대로 있다', r === 'applied' && (await cdp.ev('gitaTaskId()')) === gita);
  }

  /* ── D3 과제 삭제 = 데이터 삭제 ── */
  head('D3 과제 삭제 = 그 과제의 일정, 할 일, 시간도 삭제 — 확인창 숫자 · 저장 ok(FK) · 다시 읽어 0');
  {
    const x = await addCatViaUi(ZZ + 'X');
    if (!x) { undecide('D3 zz 과제 만들기', `${ZZ}X 를 폼으로 만들지 못했다`); }
    else {
      const gita = await cdp.ev('gitaTaskId()');
      await seedData(x, 'X', { [D1]: 3, [D2]: 1 });
      //  기타에도 같은 날 시간을 적는다 — 지운 과제의 시간만 사라지고 이웃은 남는지 본다
      await cdp.ev(`setTaskHours(${JSON.stringify(D1)}, ${JSON.stringify(gita)}, 2); 1`); await saveIdle();
      const r0 = await reload();
      const before = await dataOf(x);
      ok('D3 시험 데이터가 서버에 들어갔다(일정 2, 할 일 1, 시간 2일)', r0 === 'applied' && before.entries.length === 2 && before.todos.length === 1 && Object.keys(before.hours).length === 2, JSON.stringify(before));
      await openCat();
      const d = await deleteCatViaUi(x);
      ok('D3 확인창이 지워질 것을 숫자로 말한다', /일정 2개, 할 일 1개, 과제별 시간 2일이 함께 삭제되고 되돌릴 수 없습니다/.test(d.msg || ''), d.msg || d.why);
      ok('D3 과제가 화면에서 지워졌다', d.gone);
      ok('D3 저장이 한 번, 성공(과제 DELETE 가 FK 로 막히지 않았다)', (d.saves || []).length >= 1 && d.saves.every((s) => s.res && s.res.ok), JSON.stringify(d.saves));
      ok('D3 저장 실패 토스트가 없다', !(d.toasts || []).some((t) => /저장 실패/.test(t)), JSON.stringify(d.toasts));
      await closeAll();
      const r1 = await reload();
      const after = await J(`(function(){ const z = ${JSON.stringify(ZZ + 'X')};
        return { cat: state.categories.some(function(c){ return c.id === ${JSON.stringify(x)}; }),
                 entries: state.entries.filter(function(e){ return String(e.title || '').indexOf(z) === 0; }).length,
                 todos: (state.todos || []).filter(function(t){ return String(t.text || '').indexOf(z) === 0; }).length,
                 hx: getTaskHours(${JSON.stringify(D1)}, ${JSON.stringify(x)}), hg: getTaskHours(${JSON.stringify(D1)}, ${JSON.stringify(gita)}) }; })()`);
      ok('D3 다시 읽으면 과제, 일정, 할 일, 시간이 모두 없다', r1 === 'applied' && !after.cat && after.entries === 0 && after.todos === 0 && after.hx == null, JSON.stringify(after));
      ok('D3 다른 과제(기타)의 같은 날 시간은 남았다', after.hg === 2, JSON.stringify(after));
      await cdp.ev(`setTaskHours(${JSON.stringify(D1)}, ${JSON.stringify(gita)}, 0); 1`); await saveIdle();   // 기타에 적은 시험 시간을 걷는다
    }
  }

  /* ── D4 옮기기 ── */
  head('D4 다른 과제로 옮기기 — 일정, 할 일, 시간이 옮겨지고 겹친 날은 더해지며 24 상한 · 출발 과제는 남는다');
  {
    const a = await addCatViaUi(ZZ + 'A');
    const b = a && await addCatViaUi(ZZ + 'B');
    if (!a || !b) { undecide('D4 zz 과제 만들기', 'A/B 를 폼으로 만들지 못했다'); }
    else {
      await seedData(a, 'A', { [D1]: 5, [D2]: 20, [D3]: 2.5 });
      await cdp.ev(`setTaskHours(${JSON.stringify(D1)}, ${JSON.stringify(b)}, 3); 1`); await saveIdle();
      await cdp.ev(`setTaskHours(${JSON.stringify(D2)}, ${JSON.stringify(b)}, 10); 1`); await saveIdle();
      await reload();
      await openCat();
      const m = await mark();
      const r = await rowBtn(a, 'movedata');
      const opened = r === 'ok' && await waitFor(isOpen('#catMoveModal'), 3000, 100);
      ok('D4 [옮기기]로 옮기기 창이 열린다', opened, r);
      if (opened) {
        const opts = await J("[].map.call(document.querySelectorAll('#cmvTarget option'), function(o){ return o.value; })");
        ok('D4 대상 목록에 자기 자신이 없다', !opts.includes(a) && opts.includes(b), JSON.stringify(opts));
        await cdp.ev(`(function(){ const s = document.getElementById('cmvTarget'); s.value = ${JSON.stringify(b)}; s.dispatchEvent(new Event('change')); document.getElementById('cmvRun').click(); return 1; })()`);
        const cf = await waitFor(isOpen('#confirmModal'), 3000, 100);
        const msg = cf ? await cdp.ev("document.getElementById('cfMsg').textContent") : '';
        ok('D4 확인창이 무엇을 어디로 옮기는지 숫자로 말한다', /일정 2개, 할 일 1개, 과제별 시간 3일을/.test(msg), msg);
        if (cf) await cdp.ev(`document.getElementById('cfOk').click(); 1`);
        await waitFor(`!state.entries.some(function(e){ return e.categoryId === ${JSON.stringify(a)}; })`, 4000, 100);
        await sleep(150); await saveIdle();
        const saves = reqs(await since(m), 'saveState');
        ok('D4 저장이 한 번, 성공', saves.length === 1 && saves[0].res && saves[0].res.ok, JSON.stringify(saves));
        await closeAll();
        const r1 = await reload();
        const da = await dataOf(a), db = await dataOf(b);
        ok('D4 다시 읽으면 출발 과제는 비었고 남아 있다', r1 === 'applied' && da.entries.length === 0 && da.todos.length === 0 && !Object.keys(da.hours).length
          && (await cdp.ev(`state.categories.some(function(c){ return c.id === ${JSON.stringify(a)}; })`)), JSON.stringify(da));
        ok('D4 일정, 할 일이 대상 과제로 옮겨졌다', db.entries.length === 2 && db.todos.length === 1, JSON.stringify(db));
        ok('D4 시간: 겹친 날은 더하고(5+3=8) 24 상한(20+10→24), 안 겹친 날은 그대로(2.5)', same(db.hours, { [D1]: 8, [D2]: 24, [D3]: 2.5 }), JSON.stringify(db.hours));
      }
    }
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
  //  ★ 무슨 일이 있어도 zz 과제를 앱으로 지운다(삭제가 딸린 일정, 할 일, 시간을 함께 지운다) → 다시 읽어 잔재 0 을 본다.
  if (cdp && started) {
    head('정리 — zz 과제 삭제(딸린 데이터 포함) · 다시 읽어 잔재 0');
    try {
      healthyAtEnd = await waitFor(isHealthy, 30000, 300);
      if (!healthyAtEnd) {
        await cdp.ev(`hpost({ cmd: 'reloadState' }); 1`).catch(() => 0);
        healthyAtEnd = await waitFor(isHealthy, 20000, 300);
      }
      if (healthyAtEnd) {
        await closeAll();
        await openCat();
        for (const c of await zzCats()) ok(`정리: zz 과제 ${c.name} 삭제`, (await deleteCatViaUi(c.id)).gone);
        //  과제 없이 남은 zz 일정, 할 일(중단 잔재)도 지운다
        await cdp.ev(`(function(){ const z = ${JSON.stringify(ZZ_ALL)}; let n = 0;
          state.entries.filter(function(e){ return String(e.title || '').indexOf(z) === 0; }).forEach(function(e){ deleteEntry(e.id); n++; });
          (state.todos || []).filter(function(t){ return String(t.text || '').indexOf(z) === 0; }).forEach(function(t){ deleteTodo(t.id); n++; });
          return n; })()`);
        await saveIdle();
        await closeAll();
        const r = await reload();
        const left = await zzLeft();
        cleaned = r === 'applied' && left.cats === 0 && left.entries === 0 && left.todos === 0;
        ok('정리: 다시 읽은 뒤 zz 과제, 일정, 할 일 잔재 0', cleaned, JSON.stringify(left));
        healthyAtEnd = await waitFor(isHealthy, 5000);
      } else cleaned = false;
    } catch (e) {
      cleaned = false;
      F.push('정리 중 예외: ' + e.message); fail++;
    }
  }
  if (cdp) { try { await cdp.ev(UNINSTALL); } catch (_) { } cdp.close(); }
}

const secs = ((Date.now() - T0) / 1000).toFixed(1);
console.log('\n' + '═'.repeat(74));
console.log(`기본 과제 루프 요약 — 시드 ${OPT.seed}, 소요 ${secs}s`);
if (F.length) { console.log(`실패 ${F.length}건:`); F.forEach((f) => console.log('  ✗ ' + f)); }
if (UD.length) { console.log(`판정 불가 ${UD.length}건:`); UD.forEach((f) => console.log('  ? ' + f)); }
if (started && healthyAtEnd === false) console.log('\n★★ 경고: 끝날 때 위젯이 정상으로 돌아오지 않았다. 화면을 확인하고 필요하면 재시작하세요.');
if (started && cleaned === false) console.log(`\n★★★ 경고: 시험 데이터(${ZZ_ALL}*)를 다 지우지 못했다. 「내 과제」에서 zz 과제를 지우세요(딸린 일정, 할 일, 시간도 함께 지워집니다).`);
console.log(`재현: node tests/loop-default-tasks.mjs --seed=${OPT.seed} --port=${OPT.port}`);
console.log(`\n통과 ${pass} · 실패 ${fail} · 판정 불가 ${undecided}`);
console.log('═'.repeat(74));
const cleanOk = !started || (cleaned !== false && healthyAtEnd !== false);
process.exit(fail > 0 || !cleanOk ? 1 : (undecided > 0 || notReady ? 2 : 0));
