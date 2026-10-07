#!/usr/bin/env node
/* =====================================================================================
 *  tests/loop-report-include.mjs: 보고서 포함 상태 **실동작** 루프(docs/REPORT-INCLUDE-STATE.md A2~A6)
 * -------------------------------------------------------------------------------------
 *  계약 시험(report-include-state.test.mjs)은 jsdom 과 소스 대조로 규칙을 잠근다. 이 루프는 실제 위젯(Debug,
 *  TC_DEBUG_PORT)에 붙어 로그인한 사용자 **자신의** 캘린더에서 진짜 버튼을 **진짜 마우스로**(CDP Input.dispatchMouseEvent)
 *  누르고, 그 값이 실 호스트와 실 DB 를 지나 다시 읽혀도 그대로인지 본다(reloadState → __applyState 왕복).
 *  loop-category-order.mjs 의 Cdp 클래스, 기록기, 전제 O0 를 그대로 따른다. DB 에 직접 붙지 않는다(비밀번호 불필요).
 *
 *  케이스:
 *    O0  전제: 로그인 · conn ok · bootOk · 새 기능 존재 · 시험 과제 zzRIS-<seed> 를 폼으로 만들고 오늘 일정 1건과 공수 1.5h 를 심는다
 *    R1  내 과제에서 시험 과제의 [기타] 를 진짜 클릭 → saveState 1회(성공) · aria-pressed(기타 눌림) · state 값 etc
 *    R2  reloadState → 서버에서 다시 읽은 그 과제가 여전히 etc
 *    R3  보고서(일간, 오늘): collectReportData 행에 시험 과제가 없고, '기타' 행(사용자 '기타' 과제 또는 미분류)에
 *        그 일정 제목이 있고 hourKeys 에 그 과제가 들어 공수 1.5h 가 합산된다 · '기타로 합친 과제' 표시
 *    R4  미리보기 '기타' 카드의 X 를 진짜 클릭 → 카드가 사라짐 · #rptExcl「뺀 과제 1개」· buildReportText 에 그 제목 없음
 *    R5  주간 탭(진짜 클릭) → buildWeeklyFields(from, to, rptReportSources()) 의 endwork/content 에 그 제목과 [기타] 없음 · 막대 유지
 *        ★ 전송 버튼은 누르지 않는다(회사 시스템에 실제 폼이 뜬다)
 *    R6  창 닫고 다시 열면 막대가 사라지고 '기타' 행이 돌아온다(저장하지 않는 창 단위 상태)
 *    R7  __dbFault{network} 로 끊고 [포함] 진짜 클릭 → 값, aria-pressed, 저장 변화 0 + 잠금 토스트 → 해제 → 자동 복구
 *    정리 장애 off · 시험 과제를 [포함] 으로 되돌림 · 심은 일정 삭제 · 시험 과제 삭제(폼) · reloadState 로 잔재 0 확인
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 로그인된 채 띄운 뒤
 *    node tests/loop-report-include.mjs [--seed=N] [--port=9222] [-v]
 *    출력: 한 줄에 하나씩 PASS <이름> / FAIL <이름>: <기대와 실제>
 *    종료코드: 0 통과 · 1 실패 · 2 판정 불가(전제가 안 서서 증명하지 못함, 초록 아님)
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
  console.log(`사용법: node tests/loop-report-include.mjs [--seed=N] [--port=${OPT.port}] [-v]`);
  process.exit(0);
}
const ZZ_ALL = 'zzRIS-';
const ZZ = `${ZZ_ALL}${OPT.seed}`;
const ZZ_TITLE = `${ZZ} 보고서 묶음 시험 일정`;

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   ·', ...a); };

let pass = 0, fail = 0, undecided = 0;
const F = [], UD = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`PASS ${n}`); return true; }
  fail++; F.push(n + (d ? ': ' + d : ''));
  console.log(`FAIL ${n}${d ? ': ' + String(d).slice(0, 400) : ''}`); return false;
};
const undecide = (n, d = '') => { undecided++; UD.push(n + (d ? ': ' + d : '')); console.log(`판정 불가 ${n}${d ? ': ' + d : ''}`); };
const note = (m) => console.log(`${el()}   · ${m}`);
const head = (m) => console.log(`\n${el()} [${m}]`);

/* ── 최소 CDP(loop-category-order.mjs 와 같은 모양) ─────────────────── */
class Cdp {
  #ws = null; #id = 0; #p = new Map();
  static async attach(port) {
    let list;
    try { list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json(); }
    catch (e) { throw new Error(`CDP 에 붙지 못했다(포트 ${port}): 위젯을 TC_DEBUG_PORT=${port} 로 띄웠나요? (${e.message})`); }
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

/* ── 페이지 기록기(감싸기만 한다. finally 에서 원본으로 되돌린다) ── */
const INSTALL = `(function(){
  if (window.__risRec) return 'already';
  const R = window.__risRec = { log: [], orig: { hostRequest: hostRequest, hpost: hpost, toast: toast,
    applyState: window.__applyState, applyErr: window.__applyStateError } };
  hostRequest = function(cmd, params, t){
    const rec = { t: Date.now(), req: cmd };
    if (cmd === 'saveState' && params && params.state && Array.isArray(params.state.categories))
      rec.rg = params.state.categories.map(function(c){ return [c.id, c.reportGroup === 'etc' ? 'etc' : 'include']; });
    R.log.push(rec);
    return R.orig.hostRequest(cmd, params, t).then(function(res){ rec.done = Date.now(); rec.res = { ok: !!(res && res.ok) }; return res; });
  };
  hpost = function(o){ if (o && !o.reqId) R.log.push({ t: Date.now(), post: o.cmd }); return R.orig.hpost(o); };
  toast = function(m, k, a, ms){ R.log.push({ t: Date.now(), toast: String(m), kind: k }); return R.orig.toast(m, k, a, ms); };
  window.__applyState = function(j, m){ R.log.push({ t: Date.now(), applied: true }); return R.orig.applyState(j, m); };
  window.__applyStateError = function(msg, opt){ R.log.push({ t: Date.now(), applyErr: String(msg) }); return R.orig.applyErr(msg, opt); };
  return 'ok';
})()`;
const UNINSTALL = `(function(){
  const R = window.__risRec; if (!R) return 'none';
  hostRequest = R.orig.hostRequest; hpost = R.orig.hpost; toast = R.orig.toast;
  window.__applyState = R.orig.applyState; window.__applyStateError = R.orig.applyErr;
  delete window.__risRec; return 'ok';
})()`;
const mark = () => cdp.ev('__risRec.log.length');
const since = (m) => J(`__risRec.log.slice(${Number(m)})`);
const reqs = (L, cmd) => L.filter((x) => x.req === cmd);
const toasts = (L) => L.filter((x) => x.toast).map((x) => x.toast);

const LOCK_MSG = '서버에 연결되지 않아 지금은 편집할 수 없습니다';
const isHealthy = 'conn === "ok" && bootOk === true && !unsaved && !document.getElementById("dsError") && !document.getElementById("dbUnsaved")';
const fault = (mode) => J(`hostRequest('__dbFault', { mode: ${JSON.stringify(mode)} }, 8000)`);
const saveIdle = () => waitFor('!__dbSaving && !__dbDirty', 30000, 150);
const isOpen = (sel) => `(function(){ const m = document.querySelector(${JSON.stringify(sel)}); return !!m && !m.classList.contains('hidden') && !m.classList.contains('closing'); })()`;
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
async function closeAll() {
  await cdp.ev(`(function(){ ['#confirmModal','#quickAdd','#entryModal','#reportModal','#categoryModal'].forEach(function(s){
    try { const m = document.querySelector(s); if (m && !m.classList.contains('hidden')) closeModal(s); } catch (_) {} }); return 1; })()`);
  await sleep(400);
}
//  진짜 마우스 클릭: 페이지 식 elExpr 가 가리키는 요소의 가운데를 누른다(사람이 누를 때와 같은 길: 포커스 → click).
async function mouseClick(elExpr) {
  const g = await J(`(function(){ const b = (${elExpr}); if (!b) return null; try { b.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2, w: q.width, h: q.height }; })()`);
  if (!g || !(g.w > 0 && g.h > 0)) return false;
  const mk = (type, extra) => cdp.send('Input.dispatchMouseEvent', Object.assign({ type, x: Math.round(g.x), y: Math.round(g.y), button: 'left', pointerType: 'mouse' }, extra));
  await mk('mouseMoved', { button: 'none', buttons: 0 });
  await mk('mousePressed', { buttons: 1, clickCount: 1 });
  await mk('mouseReleased', { buttons: 0, clickCount: 1 });
  await sleep(150);
  return true;
}
async function openCat() {
  if (await cdp.ev(isOpen('#categoryModal'))) { await cdp.ev("closeModal('#categoryModal'); 1"); await sleep(450); }
  await cdp.ev(`(function(){ const b = document.getElementById('btnCatsTop'); if (b) b.click(); else openCatModal(); return 1; })()`);
  const opened = await waitFor(isOpen('#categoryModal'), 3000, 100);
  await sleep(350);
  return opened;
}
async function openReportUi() {
  if (await cdp.ev(isOpen('#reportModal'))) { await cdp.ev("closeModal('#reportModal'); 1"); await sleep(450); }
  await cdp.ev(`(function(){ const b = document.getElementById('btnReportTop'); if (b) b.click(); else openReport(); return 1; })()`);
  const opened = await waitFor(isOpen('#reportModal'), 3000, 100);
  await sleep(350);
  return opened;
}
const rgBtn = (id, g) => `[].map.call(document.querySelectorAll('#catList .cat-row'), function(x){ return x; }).filter(function(x){ return x.dataset.id === ${JSON.stringify(id)}; }).map(function(x){ return x.querySelector('[data-act="rg-${g}"]'); })[0]`;
const pressed = (id) => J(`(function(){ const r = [].find.call(document.querySelectorAll('#catList .cat-row'), function(x){ return x.dataset.id === ${JSON.stringify(id)}; });
  if (!r) return null; const i = r.querySelector('[data-act="rg-include"]'), e = r.querySelector('[data-act="rg-etc"]');
  return { include: i && i.getAttribute('aria-pressed'), etc: e && e.getAttribute('aria-pressed') }; })()`);
const rgOf = (id) => cdp.ev(`(function(){ const c = catById(${JSON.stringify(id)}); return c ? catReportGroup(c) : null; })()`);
const zzCats = () => J(`state.categories.filter(function(c){ return String(c.name || '').indexOf(${JSON.stringify(ZZ_ALL)}) === 0; }).map(function(c){ return { id: c.id, name: c.name }; })`);
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
async function addCatViaUi(name) {
  if (!(await cdp.ev(isOpen('#categoryModal')))) await openCat();
  await saveIdle();
  await cdp.ev(`(function(){ const n = document.getElementById('cName'); n.value = ${JSON.stringify(name)};
    n.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('btnCatSave').click(); return 1; })()`);
  const got = await waitFor(`state.categories.some(function(c){ return c.name === ${JSON.stringify(name)}; })`, 4000, 100);
  await sleep(150); await saveIdle();
  return got ? cdp.ev(`state.categories.find(function(c){ return c.name === ${JSON.stringify(name)}; }).id`) : null;
}
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
  await sleep(150); await saveIdle();
  return gone;
}

/* ── 본체 ─────────────────────────────────────────────────────────── */
console.log('═'.repeat(74));
console.log(`보고서 포함 상태 실동작 루프 · 시드 ${OPT.seed} · 포트 ${OPT.port} · 시험 과제 ${ZZ}`);
console.log('═'.repeat(74));

let CAT_ID = null, ENTRY_ID = null, faultOk = false, notReady = false, cleanOk = null, healthyAtEnd = null;
const TODAY = todayIso();

async function main() {
  cdp = await Cdp.attach(OPT.port);
  head('O0 전제');
  vlog('기록기:', await cdp.ev(INSTALL));
  if (await cdp.ev("typeof setCategoryReportGroup !== 'function' || typeof rptReportSources !== 'function' || typeof catReportGroup !== 'function'")) {
    notReady = true; undecide('O0 기능 존재', '위젯에 setCategoryReportGroup/rptReportSources 가 없다: 낡은 빌드다(dotnet build -c Debug 후 재시작)'); return;
  }
  const f0 = await fault('off').catch(() => null);
  faultOk = !!(f0 && f0.ok === true);
  if (!faultOk) note(`__dbFault 를 쓸 수 없다(회신=${JSON.stringify(f0)}): R7 은 판정 불가로 남는다`);
  const user = await cdp.ev("(typeof currentUser !== 'undefined' && currentUser && currentUser.loginId) || ''");
  if (!user) { notReady = true; undecide('O0 로그인', '위젯이 로그인 상태가 아니다'); return; }
  if (!(await waitFor(isHealthy, 5000))) {
    await cdp.ev("(() => { const b = document.getElementById('dsErrorRetry') || document.getElementById('dbUnsavedRetry'); if (b) { b.click(); return 'click'; } hpost({ cmd: 'reloadState' }); return 'reload'; })()");
  }
  if (!(await waitFor(isHealthy, 30000))) { notReady = true; undecide('O0 정상 연결', JSON.stringify(await J('({ conn: conn, bootOk: bootOk, unsaved: unsaved })'))); return; }
  ok('O0 로그인, conn ok, bootOk, 잠금 없음', !(await cdp.ev('editLocked()')), `login=${user}`);
  await closeAll();
  for (const c of await zzCats()) await deleteCatViaUi(c.id);   // 지난 실행 잔재
  await closeAll();
  CAT_ID = await addCatViaUi(ZZ);
  if (!CAT_ID) { notReady = true; undecide('O0 시험 과제 만들기', `${ZZ} 를 폼으로 만들지 못했다`); return; }
  ok(`O0 시험 과제 ${ZZ} 추가(포함으로 시작)`, (await rgOf(CAT_ID)) === 'include');
  //  시험 데이터(오늘 일정 1건 + 공수 1.5h). 시험 대상은 보고서 묶음이라 일정 입력 화면은 거치지 않는다(앱 함수, 저장 경로는 같다).
  ENTRY_ID = await cdp.ev(`(function(){ const e = addEntry({ date: ${JSON.stringify(TODAY)}, title: ${JSON.stringify(ZZ_TITLE)}, categoryId: ${JSON.stringify(CAT_ID)}, allDay: true }); return e && e.id; })()`);
  await saveIdle();
  await cdp.ev(`setTaskHours(${JSON.stringify(TODAY)}, ${JSON.stringify(CAT_ID)}, 1.5); 1`);
  await saveIdle();
  ok('O0 시험 일정과 공수가 심겼다', !!ENTRY_ID && (await cdp.ev(`getTaskHours(${JSON.stringify(TODAY)}, ${JSON.stringify(CAT_ID)})`)) === 1.5);

  head('R1 · R2 [기타] 진짜 클릭 → 저장 1회 → 서버에서 다시 읽어도 기타');
  await openCat(); await saveIdle();
  let m = await mark();
  ok('R1 [기타] 버튼을 진짜 마우스로 눌렀다', await mouseClick(rgBtn(CAT_ID, 'etc')));
  await saveIdle();
  let L = await since(m);
  const sv = reqs(L, 'saveState');
  ok('R1 saveState 정확히 1회', sv.length === 1, `${sv.length}회`);
  ok('R1 그 저장이 성공했고 payload 의 시험 과제가 etc', !!(sv[0] && sv[0].res && sv[0].res.ok) && !!(sv[0] && sv[0].rg && sv[0].rg.some((x) => x[0] === CAT_ID && x[1] === 'etc')), JSON.stringify(sv));
  ok('R1 aria-pressed: 기타 true, 포함 false', JSON.stringify(await pressed(CAT_ID)) === JSON.stringify({ include: 'false', etc: 'true' }), JSON.stringify(await pressed(CAT_ID)));
  ok('R1 state 값 etc', (await rgOf(CAT_ID)) === 'etc');
  const r2 = await reload();
  ok('R2 reloadState 가 적용됐다', r2 === 'applied', r2);
  ok('R2 서버에서 다시 읽은 시험 과제가 여전히 etc(DB report_group)', (await rgOf(CAT_ID)) === 'etc', String(await rgOf(CAT_ID)));
  await closeAll();

  head('R3 · R4 보고서(일간, 오늘): 기타 묶기 → 미리보기 X 진짜 클릭');
  ok('R3 [보고서] 로 보고서 창이 열린다', await openReportUi());
  await cdp.ev(`(function(){ const b = document.querySelector('#reportModal [data-rmode="daily"]'); if (b) b.click(); return 1; })()`);
  await sleep(300);
  const R3 = await J(`(function(){ const t = ${JSON.stringify(TODAY)}; const rows = collectReportData(t, t, rptReportSources()).rows;
    const etc = rows.find(function(r){ return (r.hourKeys || []).indexOf(${JSON.stringify(CAT_ID)}) >= 0; });
    return { keys: rows.map(function(r){ return r.key; }), etcKey: etc ? etc.key : null, etcName: etc ? etc.name : null, last: rows.length ? rows[rows.length - 1].key : null,
      hasTitle: !!etc && etc.titles.indexOf(${JSON.stringify(ZZ_TITLE)}) >= 0, rowH: etc ? reportRowHours(etc, t) : null,
      own: etc ? getTaskHours(t, etc.key) : null }; })()`);
  vlog('R3:', JSON.stringify(R3));
  ok('R3 보고서 행에 시험 과제 행이 없다', !R3.keys.includes(CAT_ID), JSON.stringify(R3.keys));
  ok("R3 '기타' 행(이름 기타)에 시험 일정 제목이 있다", !!R3.etcKey && R3.etcName.trim() === '기타' && R3.hasTitle, JSON.stringify(R3));
  ok("R3 '기타' 행이 맨 뒤다", R3.last === R3.etcKey, JSON.stringify(R3.keys));
  ok("R3 '기타' 행 공수 = 자기 공수 + 1.5", R3.rowH != null && Math.abs(R3.rowH - ((R3.own || 0) + 1.5)) < 1e-9, JSON.stringify(R3));
  ok("R3 미리보기 '기타' 카드에 '기타로 합친 과제 1.5h 포함' 표시",
    await cdp.ev(`/기타로 합친 과제 1\\.5h 포함/.test((document.getElementById('rptOut') || {}).textContent || '')`));
  const xSel = `[].find.call(document.querySelectorAll('#rptOut .rcard-x'), function(b){ return b.dataset.rx === ${JSON.stringify(R3.etcKey)}; })`;
  ok("R4 '기타' 카드의 X 를 진짜 마우스로 눌렀다", await mouseClick(xSel));
  await sleep(300);
  ok("R4 '기타' 카드가 미리보기에서 사라졌다", !(await cdp.ev(`!!(${xSel})`)));
  ok('R4 #rptExcl 막대에 「뺀 과제 1개」', await cdp.ev(`(function(){ const b = document.getElementById('rptExcl'); return !!b && !b.hidden && /뺀 과제 1개/.test(b.textContent); })()`),
    await cdp.ev(`String((document.getElementById('rptExcl') || {}).textContent || '')`));
  ok('R4 buildReportText 에 시험 일정 제목이 없다', !(await cdp.ev(`buildReportText().indexOf(${JSON.stringify(ZZ_TITLE)}) >= 0`)));
  ok('R4 포커스가 막대의 되돌리기 버튼으로 갔다', await cdp.ev(`!!document.activeElement && document.activeElement.dataset && document.activeElement.dataset.rxback === ${JSON.stringify(R3.etcKey)}`));

  head('R5 주간 탭(진짜 클릭): 주간 필드에도 없음(전송 버튼은 누르지 않는다)');
  ok('R5 [주간 작성] 탭을 진짜 마우스로 눌렀다', await mouseClick(`document.querySelector('#reportModal [data-rmode="weekly"]')`));
  await sleep(400);
  const R5 = await J(`(function(){ const f = document.getElementById('rptFrom').value, t = document.getElementById('rptTo').value; const wf = buildWeeklyFields(f, t, rptReportSources());
    return { mode: reportMode, from: f, to: t, wf: wf, bar: String((document.getElementById('rptExcl') || {}).textContent || '') }; })()`);
  vlog('R5:', JSON.stringify(R5).slice(0, 400));
  ok('R5 주간 모드', R5.mode === 'weekly', R5.mode);
  ok("R5 buildWeeklyFields(rptReportSources()) 에 시험 제목과 [기타] 가 없다",
    !R5.wf || (!String(R5.wf.endwork).includes(ZZ_TITLE) && !String(R5.wf.endwork).includes('[기타]') && !String(R5.wf.content).includes('[기타]')), JSON.stringify(R5.wf).slice(0, 300));
  ok('R5 주간 탭에서도 막대 「뺀 과제 1개」 유지', /뺀 과제 1개/.test(R5.bar), R5.bar);

  head('R6 창 닫고 다시 열면 복귀');
  await cdp.ev("closeModal('#reportModal'); 1"); await sleep(450);
  ok('R6 닫은 뒤 rptExcluded 가 비었다', (await cdp.ev('rptExcluded.size')) === 0);
  ok('R6 다시 연다', await openReportUi());
  ok('R6 다시 연 창에 막대가 없다', await cdp.ev(`(function(){ const b = document.getElementById('rptExcl'); return !b || b.hidden || b.classList.contains('hidden'); })()`));
  ok("R6 '기타' 행이 돌아왔다", await cdp.ev(`(function(){ const t = ${JSON.stringify(TODAY)}; return collectReportData(t, t, rptReportSources()).rows.some(function(r){ return r.key === ${JSON.stringify(R3.etcKey)}; }); })()`));
  await closeAll();

  head('R7 서버 끊김 중 전환 = 변화 0 + 잠금 토스트');
  if (!faultOk) undecide('R7 끊김 중 전환', '__dbFault 를 쓸 수 없다(디버그 실행이 아니다)');
  else {
    await openCat();
    ok('R7 __dbFault{network} → ok', (await fault('network'))?.ok === true);
    const r7 = await reload();
    ok('R7 reloadState 가 실패로 끝난다', r7 === 'error', r7);
    ok("R7 conn ≠ 'ok' · editLocked() = true", await waitFor("conn !== 'ok' && editLocked()", 8000));
    await sleep(1600);
    m = await mark();
    ok('R7 [포함] 을 진짜 마우스로 눌렀다', await mouseClick(rgBtn(CAT_ID, 'include')));
    await sleep(500);
    L = await since(m);
    ok('R7 값 그대로(etc)', (await rgOf(CAT_ID)) === 'etc');
    ok('R7 aria-pressed 그대로(기타 눌림)', JSON.stringify(await pressed(CAT_ID)) === JSON.stringify({ include: 'false', etc: 'true' }), JSON.stringify(await pressed(CAT_ID)));
    ok('R7 saveState 0건', reqs(L, 'saveState').length === 0, `${reqs(L, 'saveState').length}건`);
    ok(`R7 잠금 토스트 「${LOCK_MSG}」`, toasts(L).includes(LOCK_MSG), JSON.stringify(toasts(L)));
    ok('R7 __dbFault{off} → ok', (await fault('off'))?.ok === true);
    ok('R7 자동 복구(conn ok, bootOk)', await waitFor(isHealthy, 30000, 300), JSON.stringify(await J('({ conn: conn, bootOk: bootOk, unsaved: unsaved })')));
  }
}

let aborted = null;
try { await main(); }
catch (e) { aborted = e; fail++; F.push('중단: ' + (e && e.message ? e.message : e)); console.log(`FAIL 중단: ${e && e.message ? e.message : e}`); }
finally {
  if (cdp && CAT_ID) {
    head('정리: 장애 off · 포함으로 되돌림 · 심은 일정 삭제 · 시험 과제 삭제');
    try {
      if (faultOk) { for (let i = 0; i < 3; i++) { try { const o = await fault('off'); if (o && o.ok) break; } catch (_) { await sleep(500); } } }
      if (!(await waitFor(isHealthy, 3000))) await cdp.ev(`(function(){ const a = document.getElementById('dbUnsavedRetry') || document.getElementById('dsErrorRetry'); if (a) a.click(); else hpost({ cmd: 'reloadState' }); return 1; })()`).catch(() => 0);
      healthyAtEnd = await waitFor(isHealthy, 30000, 300);
      if (healthyAtEnd) {
        await closeAll();
        await openCat();
        if ((await rgOf(CAT_ID)) === 'etc') { await mouseClick(rgBtn(CAT_ID, 'include')); await saveIdle(); }
        const back = (await rgOf(CAT_ID)) === 'include';
        const rr = await reload();
        ok('정리: 시험 과제를 포함으로 되돌리고 서버에서 다시 읽어도 포함', back && rr === 'applied' && (await rgOf(CAT_ID)) === 'include');
        if (ENTRY_ID) { await cdp.ev(`(function(){ if (state.entries.some(function(e){ return e.id === ${JSON.stringify(ENTRY_ID)}; })) deleteEntry(${JSON.stringify(ENTRY_ID)}); return 1; })()`); await saveIdle(); }
        await openCat();
        for (const c of await zzCats()) await deleteCatViaUi(c.id);
        const r3 = await reload();
        const left = await J(`({ cats: state.categories.filter(function(c){ return String(c.name || '').indexOf(${JSON.stringify(ZZ_ALL)}) === 0; }).length,
          ents: state.entries.filter(function(e){ return String(e.title || '').indexOf(${JSON.stringify(ZZ_ALL)}) === 0; }).length })`);
        cleanOk = r3 === 'applied' && left.cats === 0 && left.ents === 0;
        ok('정리: reloadState 뒤 시험 과제, 일정 잔재 0', cleanOk, JSON.stringify(left));
        await closeAll();
      } else cleanOk = false;
    } catch (e) { cleanOk = false; F.push('정리 중 예외: ' + e.message); fail++; console.log('FAIL 정리 중 예외: ' + e.message); }
  }
  if (cdp) { try { await cdp.ev(UNINSTALL); } catch (_) { } cdp.close(); }
}

console.log('\n' + '═'.repeat(74));
if (F.length) { console.log(`실패 ${F.length}건:`); F.forEach((f) => console.log('  FAIL ' + f)); }
if (UD.length) { console.log(`판정 불가 ${UD.length}건:`); UD.forEach((f) => console.log('  ? ' + f)); }
if (CAT_ID && cleanOk === false) console.log(`\n★★ 경고: 시험 과제 ${ZZ} 또는 그 일정이 남았을 수 있다. 내 과제에서 지우세요.`);
console.log(`재현: node tests/loop-report-include.mjs --seed=${OPT.seed} --port=${OPT.port}`);
console.log(`\n통과 ${pass} · 실패 ${fail} · 판정 불가 ${undecided}`);
process.exit(fail > 0 || cleanOk === false ? 1 : (undecided > 0 || notReady ? 2 : 0));
