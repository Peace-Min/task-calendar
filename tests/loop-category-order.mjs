#!/usr/bin/env node
/* =====================================================================================
 *  tests/loop-category-order.mjs: 내 과제 순서 **실동작** 루프(docs/CATEGORY-ORDER.md, docs/CATEGORY-GROUPS.md)
 * -------------------------------------------------------------------------------------
 *  계약 시험(category-order.test.mjs, category-groups.test.mjs)은 jsdom 과 소스 대조로 **규칙**을 잠근다. 이 루프는 실제 위젯
 *  (Debug, TC_DEBUG_PORT)에 붙어 로그인한 사용자 **자신의** 캘린더에서 줄의 ⋯ 메뉴 순서 단추와 ⠿ 끌기를 **진짜 마우스로**
 *  (CDP Input.dispatchMouseEvent) 누르고 끌어, 그 순서가 실 호스트와 실 DB 를 지나 다시 읽혀도 그대로인지 본다.
 *  영속은 DB 를 직접 보지 않고 **앱을 통해** 확인한다. reloadState 를 보내 호스트가 다시 읽어 준 state(__applyState)에서 센다.
 *
 *  묶음 규칙(CATEGORY-GROUPS §1, 2026-11-13): 순서는 공식, 일반, 휴가, 기타 묶음 순서로 고정이다. 묶음 안 순서만 사용자가 정한다.
 *    끌기와 ⋯ 순서 단추(맨 위로, 위로, 아래로, 맨 아래로)는 같은 묶음 안에서만 움직이고, 묶음 끝에서는 그 방향 단추가 꺼진다.
 *    휴가와 기타는 ⠿ 와 ⋯ 가 없다. 새 일반 과제는 일반 묶음 끝(휴가 위)에 들어간다.
 *
 *  케이스:
 *    O0   전제: 로그인, conn ok, bootOk, 일반 과제 ≥ 3(모자라면 zz 일반 과제를 폼으로 만든다, 일반 묶음 끝에 붙는다), 원래 순서 스냅샷
 *    C1   「내 과제」 목록 순서 = state.categories = 묶음 순서(공식, 일반, 휴가, 기타). 묶음 머리 줄과 개수, 휴가와 기타는 ⠿ ⋯ 없음
 *    C2   일반 묶음 마지막 줄 ⋯ → 위로(진짜 마우스): 한 칸, 저장 1회, aria-live. 묶음 첫 자리까지 올리고 묶음 밖으로 못 나간다.
 *         줄마다 순서 단추 꺼짐 = 묶음 끝과 정확히 같다. 꺼진 단추를 눌러도 변화 0, 저장 0.
 *         맨 아래로는 일반 묶음 끝(휴가 위)까지, 맨 위로는 일반 묶음 첫 자리까지. 공식 묶음 끝 줄의 아래로도 꺼져 있다.
 *    C7   옮긴 뒤 포커스 = 옮겨진 줄의 ⋯, 목록을 다시 만들지 않는다, 모달 스크롤 자리 유지, 반짝임 없음
 *    C8   ⠿ 끌기(진짜 마우스): 같은 묶음 줄 위에 놓으면 그 자리로(선이 생기고 저장 1회). 다른 묶음(공식, 휴가) 위에서는
 *         선이 생기지 않고 놓아도 변화 0, 저장 0. 휴가 줄은 ⠿ 칸이 비어 있어 끌기가 시작되지 않는다.
 *    C3   reloadState → 다시 읽힌 state.categories 순서 = 옮긴 직후 순서(서버 저장)
 *    C4   collectReportData(근태 일간 가져오기와 같은 출처) 행 = 목록 순서 그대로, 기타는 맨 뒤(묶음 규칙)
 *    C5   보기에서 고른 과제와 빠른 추가 #qaCat 옵션 순서 = state.categories
 *    C6   __dbFault{network} → 끊김 → 아래로 → 순서, 화면 변화 0, saveState 0, 잠금 토스트 → 해제 → 복구
 *    정리 장애 off, zz 과제 삭제, 원래 순서로 되돌린다(진짜 위로), reloadState → 원래 순서 확인, 모달 닫기
 *
 *  ★ 남기지 않는다: finally 에서 장애를 끄고, 만든 zz 과제(`zzORD-<seed>-<n>`)를 지우고, 순서를 원래대로 되돌린다.
 *    되돌리지 못하면 원래 순서를 크게 찍는다(손으로 되돌릴 수 있게).
 *  ★ DB 에 직접 붙지 않는다. 비밀번호가 필요 없다.
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 로그인된 채 띄운 뒤(예: powershell -File dist/promo/win.ps1 start)
 *    node tests/loop-category-order.mjs [--seed=N] [--port=9222] [-v]
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
  console.log(`사용법: node tests/loop-category-order.mjs [--seed=N] [--port=${OPT.port}] [-v]`);
  process.exit(0);
}
const ZZ_ALL = 'zzORD-';
const ZZ = `${ZZ_ALL}${OPT.seed}-`;

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   .', ...a); };

let pass = 0, fail = 0, undecided = 0;
const F = [], UD = [], NA = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`${el()}   ✓ ${n}${d && OPT.verbose ? ' : ' + d : ''}`); return true; }
  fail++; F.push(n + (d ? ' : ' + d : ''));
  console.log(`${el()}   ✗ ${n}${d ? ' : ' + String(d).slice(0, 300) : ''}`); return false;
};
const undecide = (n, d = '') => { undecided++; UD.push(n + (d ? ' : ' + d : '')); console.log(`${el()}   ? ${n}, 판정 불가${d ? ': ' + d : ''}`); };
//  해당 없음: 이 데이터, 이 배치에서는 성립 조건이 없다(판정 불가와 다르다. 증명할 대상이 없을 뿐이다).
const na = (n, d = '') => { NA.push(n + (d ? ' : ' + d : '')); console.log(`${el()}   - ${n}, 해당 없음${d ? ': ' + d : ''}`); };
const note = (m) => console.log(`${el()}   . ${m}`);
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
      .find((x) => /tcapp\.local/i.test(x.url || '') && !/peer(win)?=1|[?&]win=admin/.test(x.url || ''));
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

/* ── 페이지 기록기: hostRequest, hpost, toast, __applyState, __applyStateError 를 감싼다(원본을 그대로 부른다) ── */
//  ★ 감싸기만 한다. 동작은 바꾸지 않는다. finally 에서 반드시 원본으로 되돌린다.
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
  delete window.__ordRec; try { delete window.__ordRow; } catch (_) {} return 'ok';
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
//  g = 묶음 번호(catGroupRank: 0 공식, 1 일반, 2 휴가, 3 기타)
const cats = () => J('state.categories.map(function(c){ return { id: c.id, name: String(c.name || ""), off: !!isOfficialCat(c), pick: !!isPickableCat(c), g: catGroupRank(c), def: !!isDefaultTask(c) }; })');
const domOrder = () => J("[].map.call(document.querySelectorAll('#catList .cat-row'), function(r){ return r.dataset.id; })");
const isOpen = (sel) => `(function(){ const m = document.querySelector(${JSON.stringify(sel)}); return !!m && !m.classList.contains('hidden') && !m.classList.contains('closing'); })()`;
const zzCats = () => J(`state.categories.filter(function(c){ return String(c.name || '').indexOf(${JSON.stringify(ZZ_ALL)}) === 0; }).map(function(c){ return { id: c.id, name: c.name }; })`);
//  묶음 g 의 id 들(state 순서)
const groupIds = (cs, g) => cs.filter((c) => c.g === g).map((c) => c.id);
//  묶음 번호가 앞에서 뒤로 줄지 않는다(공식, 일반, 휴가, 기타 순서)
const grouped = (cs) => cs.every((c, i) => i === 0 || cs[i - 1].g <= c.g);
const moved = (arr, i, j) => { const a = arr.slice(); const t = a.splice(i, 1)[0]; a.splice(j, 0, t); return a; };

async function closeAll() {
  await cdp.ev(`(function(){ try{ catMenuClose(false); }catch(_){} ['#confirmModal','#catEditModal','#catAddModal','#quickAdd','#categoryModal'].forEach(function(s){
    try { const m = document.querySelector(s); if (m && !m.classList.contains('hidden')) closeModal(s); } catch (_) {} }); return 1; })()`);
  await sleep(400);
}
//  「내 과제」를 사람이 여는 문(헤더 #btnCatsTop)으로 연다. 모달 A11y 가 여는 순간 첫 칸으로 포커스를 보낸다. 그 뒤에 누른다.
async function openCat() {
  if (await cdp.ev(isOpen('#categoryModal'))) { await cdp.ev("closeModal('#categoryModal'); 1"); await sleep(450); }
  await cdp.ev(`(function(){ const b = document.getElementById('btnCatsTop'); if (b) b.click(); else openCatModal(); return 1; })()`);
  const opened = await waitFor(isOpen('#categoryModal'), 3000, 100);
  await sleep(350);
  return opened;
}
//  진짜 마우스 한 번 누르기(CDP Input.dispatchMouseEvent, 사람이 누를 때와 같은 길)
const mouse = (type, x, y, extra) => cdp.send('Input.dispatchMouseEvent', Object.assign({ type, x: Math.round(x), y: Math.round(y), button: 'left', pointerType: 'mouse' }, extra));
async function click(g) {
  await mouse('mouseMoved', g.x, g.y, { button: 'none', buttons: 0 });
  await mouse('mousePressed', g.x, g.y, { buttons: 1, clickCount: 1 });
  await mouse('mouseReleased', g.x, g.y, { buttons: 0, clickCount: 1 });
}
//  누른다 = 그 줄의 ⋯ 를 진짜 마우스로 눌러 메뉴를 열고, 메뉴 항목(위로 'up', 아래로 'down', 맨 위로 'top', 맨 아래로 'bottom')을
//   진짜 마우스로 누른다. 꺼진 항목은 기본으로 누르지 않고 'end' 를 돌려준다. { end: true } 면 일부러 눌러 '변화 0'을 본다.
//   그다음 저장 회신까지 기다린다.
async function press(id, act, { idle = true, end = false } = {}) {
  if (idle) await saveIdle();
  const m = await mark();
  const at = (sel) => J(`(function(){
    const row = [].find.call(document.querySelectorAll('#catList .cat-row'), function(x){ return x.dataset.id === ${JSON.stringify(id)}; });
    if (!row) return { r: 'norow' };
    const b = row.querySelector(${JSON.stringify(sel)});
    if (!b) return { r: 'nobtn' };
    try { b.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    const q = b.getBoundingClientRect();
    return { r: b.disabled ? 'end' : 'ok', x: q.left + q.width / 2, y: q.top + q.height / 2 };
  })()`);
  let g = await at('[data-catmore]');
  if (g && g.r === 'ok') { await click(g); await sleep(80); g = await at('.cat-menu [data-catdo="' + act + '"]'); }
  const r = g ? g.r : 'norow';
  if (r === 'ok' || (r === 'end' && end)) await click(g);
  await cdp.ev('(function(){ try{ catMenuClose(false); }catch(_){} return 1; })()');   // 꺼진 항목이면 메뉴가 열린 채다
  await sleep(120);
  if (idle) await saveIdle();
  const L = await since(m);
  return { r: r === 'end' && end ? 'ok' : r, L, saves: reqs(L, 'saveState') };
}
//  끈다 = id 줄의 ⠿ 를 진짜 마우스로 눌러 잡고 여러 번 나눠 움직여 targetId 줄 가운데에 놓는다.
//   놓기 직전에 그 줄에 놓을 자리 선(.cat-drop-before/after)이 생겼는지 본다. ⠿ 가 없으면 그 칸(빈 칸)을 잡는다.
//   돌려주는 값 = { r, line, ghost, L, saves }. r: 'ok' | 'norow' | 'hidden'(좁은 창이라 ⠿ 가 숨었다) | 'offscreen'
async function drag(id, targetId) {
  await saveIdle();
  const m = await mark();
  const g = await J(`(function(){
    const rows = [].slice.call(document.querySelectorAll('#catList .cat-row'));
    const r = rows.find(function(x){ return x.dataset.id === ${JSON.stringify(id)}; }), t = rows.find(function(x){ return x.dataset.id === ${JSON.stringify(targetId)}; });
    if (!r || !t) return { r: 'norow' };
    const h = r.querySelector('.cat-grip'); if (!h) return { r: 'norow' };
    try { t.scrollIntoView({ block: 'nearest' }); h.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    let a = h.getBoundingClientRect();
    const b = t.getBoundingClientRect(), body = document.querySelector('#categoryModal .modal-body').getBoundingClientRect();
    //  고정 줄(휴가, 기타)의 빈 ⠿ 칸은 크기가 없다. 다른 줄 ⠿ 의 가로 자리와 이 줄의 세로 가운데를 누른다(사람이 같은 자리를 누르는 것과 같다).
    if (!h.hasAttribute('data-catgrip') && (!a.width || !a.height)) {
      const o = document.querySelector('#catList [data-catgrip]'), q = o && o.getBoundingClientRect(), rr = r.getBoundingClientRect();
      if (q && q.width) a = { left: q.left, width: q.width, top: rr.top + rr.height / 2 - 4, height: 8, bottom: rr.top + rr.height / 2 + 4 };
    }
    if (!a.width || !a.height) return { r: 'hidden' };
    if (b.top < body.top || b.bottom > body.bottom || a.top < body.top || a.bottom > body.bottom) return { r: 'offscreen' };
    return { r: 'ok', grip: !!h.hasAttribute('data-catgrip'), x0: a.left + a.width / 2, y0: a.top + a.height / 2, x1: b.left + b.width / 2, y1: b.top + b.height / 2 };
  })()`);
  if (!g || g.r !== 'ok') return { r: g ? g.r : 'norow', line: false, ghost: false, L: [], saves: [] };
  await mouse('mouseMoved', g.x0, g.y0, { button: 'none', buttons: 0 });
  await mouse('mousePressed', g.x0, g.y0, { buttons: 1, clickCount: 1 });
  const N = 10;
  for (let k = 1; k <= N; k++) {
    await mouse('mouseMoved', g.x0 + (g.x1 - g.x0) * k / N, g.y0 + (g.y1 - g.y0) * k / N, { buttons: 1 });
    await sleep(25);
  }
  await sleep(120);
  const st = await J(`(function(){ const t = [].find.call(document.querySelectorAll('#catList .cat-row'), function(x){ return x.dataset.id === ${JSON.stringify(targetId)}; });
    return { line: !!t && (t.classList.contains('cat-drop-before') || t.classList.contains('cat-drop-after')),
             anyLine: !!document.querySelector('#catList .cat-drop-before, #catList .cat-drop-after'),
             ghost: !!document.querySelector('.cat-drag-ghost') }; })()`);
  await mouse('mouseReleased', g.x1, g.y1, { buttons: 0, clickCount: 1 });
  await sleep(200);
  await saveIdle();
  const L = await since(m);
  return { r: 'ok', grip: g.grip, line: st.line, anyLine: st.anyLine, ghost: st.ghost, L, saves: reqs(L, 'saveState') };
}
//  순서 단추 꺼짐 = 묶음 끝과 정확히 같은가. 메뉴를 그리는 함수(catMenuHtml)로 줄마다 본다(메뉴를 하나씩 열지 않는다).
//   순서를 바꿀 수 있는 줄(공식, 일반): 묶음 첫 자리면 위로와 맨 위로가, 묶음 끝 자리면 아래로와 맨 아래로가 꺼지고 그 밖은 켜진다.
//   휴가, 기타 줄: ⠿ 와 ⋯ 가 없다.
const edgesCheck = () => J(`(function(){ const rows = document.querySelectorAll('#catList .cat-row'); if (!rows.length) return null;
  const bad = [];
  [].forEach.call(rows, function(r){
    const c = catById(r.dataset.id); if (!c) { bad.push('nocat'); return; }
    if (!catOrderable(c)) {
      if (r.querySelector('[data-catmore]') || r.querySelector('[data-catgrip]')) bad.push(c.name + ': 고정 줄에 ⠿ 나 ⋯');
      return;
    }
    const i = state.categories.indexOf(c), rg = catGroupRange(c.id);
    const d = document.createElement('div'); d.innerHTML = catMenuHtml(c);
    const off = function(act){ const b = d.querySelector('[data-catdo="' + act + '"]'); return b ? b.disabled : null; };
    const first = i === rg[0], last = i === rg[1];
    if (off('up') !== first || off('top') !== first) bad.push(c.name + ': 위로 꺼짐 ' + off('up') + ' 기대 ' + first);
    if (off('down') !== last || off('bottom') !== last) bad.push(c.name + ': 아래로 꺼짐 ' + off('down') + ' 기대 ' + last);
  });
  return bad; })()`);
const live = () => cdp.ev("String((document.getElementById('catLive') || {}).textContent || '')");
const focusInfo = () => J(`(function(){ const a = document.activeElement;
  const row = a && a.closest ? a.closest('#catList .cat-row') : null;
  return { more: !!a && a.hasAttribute && a.hasAttribute('data-catmore'), row: row ? row.dataset.id : null,
    tag: a ? a.tagName : null, label: a && a.getAttribute ? a.getAttribute('aria-label') : null }; })()`);
const BODY = "document.querySelector('#categoryModal .modal-body')";

//  zz 과제를 사람이 지우는 길로 지운다: 그 줄 ⋯ 의 [삭제…] → 확인 상자 [삭제](#cfOk).
async function deleteCatViaUi(id) {
  if (!(await cdp.ev(isOpen('#categoryModal')))) await openCat();
  await saveIdle();
  const r = await cdp.ev(`(function(){
    const row = [].find.call(document.querySelectorAll('#catList .cat-row'), function(x){ return x.dataset.id === ${JSON.stringify(id)}; });
    if (!row || !row.querySelector('[data-catmore]')) return 'nobtn'; row.querySelector('[data-catmore]').click();
    const b = row.querySelector('.cat-menu [data-catdo="del"]'); if (!b) return 'nobtn'; b.click(); return 'ok'; })()`);
  if (r !== 'ok') return false;
  if (!(await waitFor(isOpen('#confirmModal'), 3000, 100))) return false;
  await cdp.ev(`document.getElementById('cfOk').click(); 1`);
  const gone = await waitFor(`!state.categories.some(function(c){ return c.id === ${JSON.stringify(id)}; })`, 4000, 100);
  await sleep(150);
  await saveIdle();
  return gone;
}
//  일반 과제를 사람이 만드는 길로 만든다: [＋ 과제 추가] → 일반 과제 탭 → 이름 → [추가](TASK-ADD-UX).
//   새 과제는 일반 묶음 끝에 붙는다(휴가, 기타 위, CATEGORY-GROUPS §1-7).
async function addCatViaUi(name) {
  if (!(await cdp.ev(isOpen('#categoryModal')))) await openCat();
  await saveIdle();
  await cdp.ev(`(function(){ document.getElementById('btnCatAdd').click(); document.getElementById('caTabOwn').click();
    const n = document.getElementById('caName'); n.value = ${JSON.stringify(name)};
    n.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('caAddOwn').click(); return 1; })()`);
  const got = await waitFor(`state.categories.some(function(c){ return c.name === ${JSON.stringify(name)}; })`, 4000, 100);
  await sleep(150);
  await saveIdle();
  return got ? J(`(function(){ const a = state.categories, i = a.findIndex(function(c){ return c.name === ${JSON.stringify(name)}; }), c = a[i], rg = catGroupRange(c.id);
    return { id: c.id, grp: catGroupRank(c), groupEnd: i === rg[1], nextFixed: !a[i + 1] || catGroupRank(a[i + 1]) >= 2 }; })()`) : null;
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

/* ── 본체 ─────────────────────────────────────────────────────────── */
console.log('═'.repeat(74));
console.log(`내 과제 순서 실동작 루프, 시드 ${OPT.seed}, 포트 ${OPT.port}, 과제 ${ZZ}*`);
console.log('═'.repeat(74));

let ORIG = null;            // 원래 순서(zz 를 만들기 전), 정리의 목표
const CREATED = [];         // 이 실행이 만든 zz 과제 id
let faultOk = false;
let healthyAtEnd = null;
let restored = null;
let notReady = false;

async function main() {
  cdp = await Cdp.attach(OPT.port);

  /* ── O0 전제 ── */
  head('O0 전제: 로그인, 정상 연결, 일반 과제 ≥ 3, 원래 순서');
  vlog('기록기:', await cdp.ev(INSTALL));
  if (await cdp.ev("typeof moveCategory !== 'function' || typeof catGroupRange !== 'function' || typeof catOrderable !== 'function'")) {
    notReady = true; undecide('O0 기능 존재', '위젯에 moveCategory 나 묶음 함수(catGroupRange, catOrderable)가 없다. 낡은 빌드다(dotnet build -c Debug 후 재시작)'); return;
  }
  const f0 = await fault('off').catch(() => null);
  faultOk = !!(f0 && f0.ok === true);
  if (faultOk) ok('O0 __dbFault{off} → ok:true', true);
  else note(`__dbFault 를 쓸 수 없다(회신=${JSON.stringify(f0)}). 디버그 실행이 아니면 C6 은 판정 불가로 남는다`);
  const user = await cdp.ev("(typeof currentUser !== 'undefined' && currentUser && currentUser.loginId) || ''");
  if (!user) { notReady = true; undecide('O0 로그인', '위젯이 로그인 상태가 아니다'); return; }
  //  앞 루프가 남긴 상태 치유(loop-offline 과 같은 손). 사람이 [다시 시도] 를 한 번 누르는 것과 같다. 시험 대상이 아니다.
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
  for (let n = 1; groupIds(await cats(), 1).length < 3; n++) {
    const r = await addCatViaUi(ZZ + n);
    if (!r) { notReady = true; undecide('O0 zz 과제 만들기', `${ZZ + n} 를 폼으로 만들지 못했다`); return; }
    CREATED.push(r.id);
    ok(`O0 zz 과제 ${ZZ + n} 추가: 일반 묶음 끝(휴가, 기타 위)에 붙는다(CATEGORY-GROUPS §1-7)`, r.grp === 1 && r.groupEnd && r.nextFixed, JSON.stringify(r));
  }
  const cs0 = await cats();
  ok(`O0 일반 과제 ≥ 3(전체 ${cs0.length}, 공식 ${groupIds(cs0, 0).length}, 일반 ${groupIds(cs0, 1).length})`, groupIds(cs0, 1).length >= 3);

  /* ── C1 목록 = 실제 순서 = 묶음 순서 ── */
  head('C1 「내 과제」 목록 = state.categories = 묶음 순서(공식, 일반, 휴가, 기타)');
  ok('C1 헤더 [내 과제] 로 모달이 열린다', await openCat());
  {
    const cs = await cats();
    ok('C1 목록 줄 순서 = state.categories', same(await domOrder(), await order()), JSON.stringify({ dom: await domOrder(), state: await order() }));
    ok('C1 state.categories 가 묶음 순서다(공식, 일반, 휴가, 기타)', grouped(cs), cs.map((c) => c.g).join(''));
    const tail = cs.slice(-2);
    ok('C1 맨 아래 두 줄 = 휴가, 기타(기본 과제, 그 순서로 고정)', tail.length === 2 && tail[0].name === '휴가' && tail[0].def && tail[1].name === '기타' && tail[1].def, JSON.stringify(tail));
    //  묶음 머리 줄(A'): 비지 않은 묶음마다 하나, 이름과 개수가 맞고 자기 묶음 첫 줄 바로 앞에 있다.
    const heads = await J(`[].map.call(document.querySelectorAll('#catList .cat-grp'), function(h){
      const nx = h.nextElementSibling; return { cls: h.className, text: h.textContent.replace(/\\s+/g, ' ').trim(), next: nx && nx.dataset ? nx.dataset.id : null }; })`);
    const want = [];
    const nO = groupIds(cs, 0).length, nP = groupIds(cs, 1).length, nD = cs.filter((c) => c.g >= 2).length;
    if (nO) want.push({ k: 'off', text: `공식 과제 ${nO}`, next: groupIds(cs, 0)[0] });
    if (nP) want.push({ k: 'own', text: `일반 과제 ${nP}`, next: groupIds(cs, 1)[0] });
    if (nD) want.push({ k: 'def', text: `기본 ${nD}`, next: cs.find((c) => c.g >= 2).id });
    ok('C1 묶음 머리 줄(공식 과제 n, 일반 과제 n, 기본 n)이 각 묶음 첫 줄 앞에 있다', heads.length === want.length
      && want.every((w, i) => heads[i].cls.split(/\s+/).includes(w.k) && heads[i].text === w.text && heads[i].next === w.next), JSON.stringify({ heads, want }));
    ok('C1 옛 안내 한 줄(#catOrderHint)과 줄의 ▲▼ 가 없다(TASK-ADD-UX D1, D3)',
      await cdp.ev("!document.getElementById('catOrderHint') && !document.querySelector('#catList [data-act=\"up\"], #catList [data-act=\"down\"]')"));
    ok('C1 공식, 일반 줄의 ⋯ 는 진짜 메뉴 버튼 + aria-label「과제명 더 보기」, ⠿ 가 있다', await cdp.ev(`(function(){
      const rows = [].filter.call(document.querySelectorAll('#catList .cat-row'), function(r){ return catOrderable(catById(r.dataset.id)); }); if (!rows.length) return false;
      return rows.every(function(r){ const c = catById(r.dataset.id); const b = r.querySelector('[data-catmore]');
        return !!c && b && b.tagName === 'BUTTON' && b.getAttribute('aria-haspopup') === 'menu' && b.getAttribute('aria-label') === c.name + ' 더 보기' && !!r.querySelector('[data-catgrip]'); }); })()`));
    ok('C1 휴가, 기타 줄에는 ⠿ 와 ⋯ 가 없다(§1-5)', await cdp.ev(`(function(){
      const rows = [].filter.call(document.querySelectorAll('#catList .cat-row'), function(r){ return isDefaultTask(catById(r.dataset.id)); });
      return rows.length === 2 && rows.every(function(r){ return !r.querySelector('[data-catmore]') && !r.querySelector('[data-catgrip]') && r.dataset.default === '1'; }); })()`));
    const bad = await edgesCheck();
    ok('C1 줄마다 순서 단추 꺼짐 = 묶음 끝과 같다(공식 끝 줄의 아래로, 일반 첫 줄의 위로도 꺼짐)', Array.isArray(bad) && bad.length === 0, JSON.stringify(bad));
  }

  /* ── C2, C7 일반 묶음 마지막 줄 위로 ── */
  head('C2, C7 일반 묶음 마지막 줄 ⋯ → 위로: 한 칸, 저장 1회, 묶음 끝 꺼짐, 포커스, 스크롤 유지, 목록 그대로');
  let EXPECT = await order();
  const cs2 = await cats();
  const P = groupIds(cs2, 1);
  const lo = EXPECT.indexOf(P[0]), hi = EXPECT.indexOf(P[P.length - 1]);
  const lastId = P[P.length - 1];
  const lastName = cs2.find((c) => c.id === lastId).name;
  //  스크롤 자리: 모달 본문(.modal-body)이 스크롤 상자다(#catList 자체는 늘어난다). 그 줄이 가운데 오게 굴려 둔다.
  const geo = await J(`(function(){ const b = ${BODY}; const r = [].find.call(document.querySelectorAll('#catList .cat-row'), function(x){ return x.dataset.id === ${JSON.stringify(lastId)}; });
    if (!b || !r) return null;
    const scrollable = b.scrollHeight > b.clientHeight + 4;
    if (scrollable) { const br = b.getBoundingClientRect(), rr = r.getBoundingClientRect(); b.scrollTop += (rr.top - br.top) - (b.clientHeight / 2 - rr.height / 2); }
    return { scrollable: scrollable, sh: b.scrollHeight, ch: b.clientHeight, st: b.scrollTop }; })()`);
  vlog('스크롤:', JSON.stringify(geo));
  await sleep(150);
  const st0 = await cdp.ev(`${BODY}.scrollTop`);
  await cdp.ev(`(function(){ window.__ordRow = [].find.call(document.querySelectorAll('#catList .cat-row'), function(x){ return x.dataset.id === ${JSON.stringify(lastId)}; }); return 1; })()`);
  const p1 = await press(lastId, 'up');
  EXPECT = moved(EXPECT, hi, hi - 1);
  ok(`C2 일반 묶음 마지막 줄(${lastName}) ⋯ 의 위로를 눌렀다`, p1.r === 'ok', p1.r);
  ok('C2 한 번 = saveState 1회', p1.saves.length === 1, `${p1.saves.length}회`);
  ok('C2 그 저장이 성공했고 payload 순서 = 옮긴 순서', !!(p1.saves[0] && p1.saves[0].res && p1.saves[0].res.ok) && same(p1.saves[0] && p1.saves[0].order, EXPECT),
    JSON.stringify(p1.saves.map((x) => ({ res: x.res, order: x.order }))));
  ok('C2 한 칸 위로(state.categories)', same(await order(), EXPECT), JSON.stringify(await order()));
  ok('C2 목록 줄 순서 = state.categories', same(await domOrder(), EXPECT));
  const e1 = await edgesCheck();
  ok('C2 옮긴 뒤에도 순서 단추 꺼짐 = 묶음 끝', Array.isArray(e1) && e1.length === 0, JSON.stringify(e1));
  ok('C2 aria-live 낭독 「<과제명>: N번째에서 N-1번째로 옮겼습니다」', (await live()) === `${lastName}: ${hi + 1}번째에서 ${hi}번째로 옮겼습니다`, await live());
  ok('C2 ⋯ 가 줄 맨 오른쪽(기록 수 뒤)이다', await cdp.ev(`(function(){ const r = [].find.call(document.querySelectorAll('#catList .cat-row'), function(x){ return !!x.querySelector('[data-catmore]'); });
    const c = r && r.querySelector('.cat-count'), b = r && r.querySelector('[data-catmore]');
    return !!(c && b) && !!(c.compareDocumentPosition(b) & 4) && r.lastElementChild === b; })()`));
  const f1 = await focusInfo();
  ok('C7 포커스 = 옮겨진 줄의 ⋯', f1.more && f1.row === lastId, JSON.stringify(f1));
  ok('C7 옮길 때 목록을 다시 만들지 않았다(옮긴 줄이 같은 노드, 반짝임 없음)', await cdp.ev(`(function(){ const r = [].find.call(document.querySelectorAll('#catList .cat-row'), function(x){ return x.dataset.id === ${JSON.stringify(lastId)}; }); return !!r && r === window.__ordRow && !r.classList.contains('cat-flash'); })()`));
  if (geo && geo.scrollable) {
    const st1 = await cdp.ev(`${BODY}.scrollTop`);
    ok('C7 모달 스크롤 자리 유지(.modal-body scrollTop)', Math.abs(st1 - st0) < 1, `${st0} → ${st1}`);
  } else na('C7 스크롤 자리', `모달 본문이 스크롤되지 않는다(${JSON.stringify(geo)})`);
  //  일반 묶음 첫 자리까지: 한 번에 한 칸, 매번 저장 1회.
  let perPress = true, steps = 0;
  for (let i = hi - 1; i > lo; i--) {
    const p = await press(lastId, 'up');
    steps++;
    EXPECT = moved(EXPECT, i, i - 1);
    if (p.r !== 'ok' || p.saves.length !== 1 || !same(await order(), EXPECT)) { perPress = false; vlog('묶음 첫 자리로 가는 중 어긋남:', JSON.stringify({ r: p.r, saves: p.saves.length })); break; }
  }
  ok(`C2 일반 묶음 첫 자리까지 ${steps}번 더: 매번 한 칸, 저장 1회`, perPress);
  ok('C2 일반 묶음 첫 자리에 닿았다(state, 목록)', (await order())[lo] === lastId && same(await domOrder(), await order()), JSON.stringify(await order()));
  ok('C2 묶음 순서가 그대로다(공식 위로 넘어가지 않았다)', grouped(await cats()));
  const f2 = await focusInfo();
  ok('C7 묶음 첫 자리에 닿아도 포커스는 그 줄의 ⋯ 다(body 로 떨어지지 않는다)', f2.more && f2.row === lastId, JSON.stringify(f2));
  const e2 = await edgesCheck();
  ok('C2 묶음 첫 자리 줄의 위로, 맨 위로 = 꺼짐(나머지 꺼짐도 묶음 끝과 같다)', Array.isArray(e2) && e2.length === 0, JSON.stringify(e2));
  //  꺼진 항목을 진짜로 눌러도 바뀌는 것 0, 저장 0(묶음 경계 위로)
  const pe = await press(lastId, 'up', { end: true });
  ok('C2 일반 묶음 첫 줄의 위로(꺼짐)를 눌러도 변화 0, 저장 0(공식 묶음으로 못 넘어간다)', pe.r === 'ok' && pe.saves.length === 0 && same(await order(), EXPECT), JSON.stringify({ r: pe.r, saves: pe.saves.length }));
  const pt = await press(lastId, 'top', { end: true });
  ok('C2 일반 묶음 첫 줄의 맨 위로(꺼짐)도 변화 0, 저장 0', pt.r === 'ok' && pt.saves.length === 0 && same(await order(), EXPECT), JSON.stringify({ r: pt.r, saves: pt.saves.length }));
  //  맨 아래로 = 일반 묶음 끝(휴가 바로 위)까지, 저장 1회. 다시 맨 위로 = 일반 묶음 첫 자리, 저장 1회.
  {
    const pb = await press(lastId, 'bottom');
    EXPECT = moved(EXPECT, lo, hi);
    const now = await cats();
    ok('C2 맨 아래로 = 일반 묶음 끝(휴가, 기타 위), 저장 1회', pb.r === 'ok' && pb.saves.length === 1 && same(now.map((c) => c.id), EXPECT)
      && now[hi].id === lastId && now[hi + 1] && now[hi + 1].g >= 2, JSON.stringify({ r: pb.r, saves: pb.saves.length, got: now.map((c) => c.id), want: EXPECT }));
    const pd = await press(lastId, 'down', { end: true });
    ok('C2 일반 묶음 끝 줄의 아래로(꺼짐)를 눌러도 변화 0, 저장 0(휴가 아래로 못 간다)', pd.r === 'ok' && pd.saves.length === 0 && same(await order(), EXPECT), JSON.stringify({ r: pd.r, saves: pd.saves.length }));
    const pT = await press(lastId, 'top');
    EXPECT = moved(EXPECT, hi, lo);
    ok('C2 맨 위로 = 일반 묶음 첫 자리(공식 아래), 저장 1회', pT.r === 'ok' && pT.saves.length === 1 && same(await order(), EXPECT), JSON.stringify({ r: pT.r, saves: pT.saves.length }));
  }
  //  공식 묶음 끝 줄의 아래로도 꺼져 있다(일반 묶음으로 못 내려간다).
  {
    const O = groupIds(await cats(), 0);
    if (O.length) {
      const po = await press(O[O.length - 1], 'down', { end: true });
      ok('C2 공식 묶음 끝 줄의 아래로(꺼짐)를 눌러도 변화 0, 저장 0(일반 묶음으로 못 내려간다)', po.r === 'ok' && po.saves.length === 0 && same(await order(), EXPECT), JSON.stringify({ r: po.r, saves: po.saves.length }));
    } else na('C2 공식 묶음 경계', '공식 과제가 없다');
  }

  /* ── C8 ⠿ 끌기 ── */
  head('C8 ⠿ 끌기(진짜 마우스): 같은 묶음 안에서만, 다른 묶음 위에서는 선 없음과 변화 0');
  {
    const cs = await cats();
    const Pn = groupIds(cs, 1);
    const a = Pn[Pn.length - 1], b = Pn[0];
    const d1 = await drag(a, b);
    if (d1.r === 'hidden' || d1.r === 'offscreen') undecide('C8 같은 묶음 끌기', `⠿ 나 대상 줄을 화면에서 누를 수 없다(${d1.r})`);
    else {
      const i = EXPECT.indexOf(a), j = EXPECT.indexOf(b);
      EXPECT = moved(EXPECT, i, j);
      ok('C8 일반 묶음 끝 줄을 첫 줄 위로 끄는 동안 대상 줄에 놓을 자리 선이 생긴다', d1.line && d1.ghost, JSON.stringify({ line: d1.line, ghost: d1.ghost }));
      ok('C8 놓으면 그 자리로 간다, 저장 1회, 성공', d1.saves.length === 1 && !!(d1.saves[0].res && d1.saves[0].res.ok) && same(await order(), EXPECT),
        JSON.stringify({ saves: d1.saves.length, got: await order(), want: EXPECT }));
      ok('C8 끌기 뒤 목록 줄 순서 = state.categories', same(await domOrder(), await order()));
      //  다른 묶음 위로 끌기: 일반 줄 → 공식 줄(있으면), 일반 줄 → 휴가 줄. 선이 생기지 않고 놓아도 그대로다.
      const O = groupIds(cs, 0);
      if (O.length) {
        const d2 = await drag(a, O[0]);
        if (d2.r !== 'ok') undecide('C8 일반 → 공식 끌기', d2.r);
        else ok('C8 일반 줄을 공식 줄 위로 끌면 선이 생기지 않고 놓아도 변화 0, 저장 0', !d2.anyLine && d2.saves.length === 0 && same(await order(), EXPECT),
          JSON.stringify({ anyLine: d2.anyLine, saves: d2.saves.length }));
      } else na('C8 일반 → 공식 끌기', '공식 과제가 없다');
      const vac = cs.find((c) => c.def && c.name === '휴가');
      const d3 = await drag(a, vac.id);
      if (d3.r !== 'ok') undecide('C8 일반 → 휴가 끌기', d3.r);
      else ok('C8 일반 줄을 휴가 줄 위로 끌면 선이 생기지 않고 놓아도 변화 0, 저장 0', !d3.anyLine && d3.saves.length === 0 && same(await order(), EXPECT),
        JSON.stringify({ anyLine: d3.anyLine, saves: d3.saves.length }));
      //  휴가 줄의 ⠿ 칸(비어 있다)을 잡고 일반 줄로 끌어도 끌기가 시작되지 않는다.
      const d4 = await drag(vac.id, b);
      if (d4.r !== 'ok') undecide('C8 휴가 줄 끌기', d4.r);
      else ok('C8 휴가 줄은 ⠿ 칸이 비어 끌기가 시작되지 않는다(복제본, 선, 변화, 저장 0)', d4.grip === false && !d4.ghost && !d4.anyLine && d4.saves.length === 0 && same(await order(), EXPECT),
        JSON.stringify({ grip: d4.grip, ghost: d4.ghost, anyLine: d4.anyLine, saves: d4.saves.length }));
      //  공식 묶음 안 끌기(공식이 둘 이상일 때): 첫 줄을 끝 줄 위로 놓으면 공식 묶음 끝으로 간다.
      if (O.length >= 2) {
        const d5 = await drag(O[0], O[O.length - 1]);
        if (d5.r !== 'ok') undecide('C8 공식 묶음 안 끌기', d5.r);
        else {
          EXPECT = moved(EXPECT, EXPECT.indexOf(O[0]), EXPECT.indexOf(O[O.length - 1]));
          ok('C8 공식 묶음 안 끌기도 된다(첫 줄 → 끝 자리), 저장 1회', d5.line && d5.saves.length === 1 && same(await order(), EXPECT) && grouped(await cats()),
            JSON.stringify({ line: d5.line, saves: d5.saves.length, got: await order(), want: EXPECT }));
        }
      } else na('C8 공식 묶음 안 끌기', `공식 과제 ${O.length}건`);
    }
  }

  /* ── C3 서버에서 다시 읽기 ── */
  head('C3 reloadState → 서버에서 다시 읽은 순서 = 옮긴 직후 순서');
  ok('C3 저장 대기열이 비었다', await saveIdle());
  const rr = await reload();
  ok('C3 reloadState → 적용(__applyState)', rr === 'applied', rr);
  ok('C3 다시 읽힌 state.categories 순서 = 옮긴 직후 순서', same(await order(), EXPECT), JSON.stringify({ got: await order(), want: EXPECT }));
  ok('C3 다시 읽은 뒤에도 묶음 순서다', grouped(await cats()));

  /* ── C4 보고서 ── */
  head('C4 보고서 행 순서 = 목록 순서 그대로(미분류 합성 행 없음, 기타는 묶음 규칙으로 맨 뒤): collectReportData');
  await closeAll();
  {
    let [from, to] = monthRange();
    //  2026-11-04: 취합 출처를 앱 주간보고 DB 로 바꾸며 rptSources(포함 항목)를 지웠다. 일정과 할 일로 행을 만드는 곳은 근태 일간 가져오기(atBuildSource)뿐이고 이 출처를 쓴다.
    const rowsOf = (f, t) => J(`collectReportData(${JSON.stringify(f)}, ${JSON.stringify(t)}, { event: true, todo: true, desc: true }).rows.map(function(r){ return { key: r.key, name: r.name, n: r.titles.length }; })`);
    let rows = await rowsOf(from, to);
    //  이번 달에 내용이 없으면 기록이 있는 기간(가장 이른 ~ 가장 늦은 기록 날짜)으로 넓힌다. 내용 있는 행이 실제로 줄을 서게.
    if (!rows.some((r) => r.n > 0)) {
      const span = await J(`(function(){ const ds = (state.entries || []).map(function(e){ return e.date; }).filter(function(d){ return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d || ''); }).sort();
        return ds.length ? [ds[0], ds[ds.length - 1]] : null; })()`);
      if (span) { note(`이번 달(${from}~${to})에 보고 내용이 없다. 기록이 있는 기간 ${span[0]}~${span[1]} 로 본다`); [from, to] = span; rows = await rowsOf(from, to); }
    }
    const cs = await cats();
    const keys = rows.map((r) => r.key);
    const exp = cs.map((c) => c.id);
    const expPresent = exp.filter((k) => keys.includes(k));
    note(`기간 ${from}~${to}: 행 ${rows.length}, 내용 있는 행 ${rows.filter((r) => r.n > 0).length}`);
    ok('C4 보고서 행이 모두 내 과제 목록의 과제다(미분류 합성 행 없음)', keys.every((k) => exp.includes(k)) && !keys.includes('__uncat__'), JSON.stringify(keys));
    ok('C4 보고서 행 순서 = state.categories 순서 그대로', same(keys, expPresent), JSON.stringify({ keys, exp: expPresent }));
    ok('C4 「내용 없는 항목 제외」가 없으니 모든 과제가 행이다', cs.every((c) => keys.includes(c.id)), `${keys.length} vs ${cs.length}`);
    const gita = cs.filter((c) => c.def && c.name === '기타').map((c) => c.id);
    ok('C4 기본 과제 기타가 목록에 있다(부팅 보장)', gita.length === 1, JSON.stringify(cs.map((c) => c.name)));
    if (gita.length && keys.includes(gita[0])) ok('C4 기타 행은 맨 뒤다(목록 자리 그대로, 묶음 규칙)', keys[keys.length - 1] === gita[0], JSON.stringify(keys.slice(-3)));
    else na('C4 기타 행 자리', '기타 행이 이 기간 보고서에 없다');
    //  같은 순서가 **옮긴 순서**에서 나온다(옮긴 일반 과제가 보고서에서도 일반 묶음 첫 행)
    const P0 = groupIds(cs, 1)[0];
    ok('C4 옮긴 일반 묶음 첫 과제가 보고서에서도 공식 다음 첫 행이다', keys.indexOf(P0) === groupIds(cs, 0).filter((k) => keys.includes(k)).length, JSON.stringify(keys.slice(0, 6)));
    //  취합 미리보기 카드 순서 검사는 2026-11-04 에 걷었다. 취합 글은 이 앱 주간보고 DB(또는 인트라넷 주간)의 과제 머리 순서라
    //  내 과제 목록 순서 계약의 대상이 아니다(docs/ATTEND-SUMMARY.md 7절).
    await closeAll();
  }

  /* ── C5 보기에서 고른 과제, 과제 선택 ── */
  head('C5 보기에서 고른 과제, 빠른 추가 #qaCat = state.categories 순서');
  {
    const cs = await cats();
    const ids = cs.map((c) => c.id), pick = cs.filter((c) => c.pick).map((c) => c.id);
    //  보기에서 고른 과제(filterSelCats, FILTER-MULTI)는 목록 순서다. 모두 고르면 전체라 맨 끝 하나를 빼고 고른다.
    //  고른 과제 칩은 2026-11-03 에 없앴다(PERSONAL-PANEL). 새 기록의 기본 과제와 같은 함수로 본다.
    await J("(filterCats = new Set(state.categories.slice(0, -1).map(function(c){ return c.id; })), renderFilterbar(), true)");
    const chips = await J("filterSelCats().map(function(c){ return c.id; })");
    await J("(filterCats = null, renderFilterbar(), true)");
    ok('C5 보기에서 고른 과제 순서 = state.categories', chips.length > 0 && same(chips, ids.slice(0, chips.length)), JSON.stringify({ chips, ids }));
    const DATE = todayIso();
    await cdp.ev(`openQuickAdd(${JSON.stringify(DATE)}); 1`);
    const qOpen = await waitFor(isOpen('#quickAdd'), 3000, 100);
    const qaCat = await J("[].map.call(document.querySelectorAll('#qaCat option'), function(o){ return o.value; }).filter(Boolean)");
    ok('C5 빠른 추가가 열린다', qOpen);
    ok('C5 빠른 추가 #qaCat 옵션 순서 = state.categories(선택 가능한 것)', same(qaCat, pick), JSON.stringify({ qaCat, pick }));
    await closeAll();
  }

  /* ── C6 연결 끊김 중 이동 불가 ── */
  head('C6 (live) network 장애 → 끊김 → 아래로 → 순서, 화면, 저장 변화 0 → 해제 → 복구');
  if (!faultOk) undecide('C6 연결 끊김 중 이동', '__dbFault 를 쓸 수 없다(디버그 실행이 아니다)');
  else {
    await openCat();
    const before = await order();
    const firstP = groupIds(await cats(), 1)[0];   // 일반 묶음 첫 줄: 아래로가 켜져 있다
    ok('C6 __dbFault{network} → ok', (await fault('network'))?.ok === true);
    const r6 = await reload();
    ok('C6 reloadState 가 실패로 끝난다(__applyStateError)', r6 === 'error', r6);
    ok("C6 conn ≠ 'ok', editLocked() = true", await waitFor("conn !== 'ok' && editLocked()", 8000), JSON.stringify(await J('({ conn: conn, locked: editLocked() })')));
    await sleep(1600);   // 잠금 토스트는 1.5초에 한 번. 앞선 토스트와 겹치지 않게
    const m6 = await mark();
    const p6 = await press(firstP, 'down', { idle: false });
    await sleep(500);
    const L6 = await since(m6);
    ok('C6 일반 묶음 첫 줄 아래로를 눌렀다(항목은 켜져 있다)', p6.r === 'ok', p6.r);
    ok('C6 state.categories 순서 변화 0', same(await order(), before), JSON.stringify(await order()));
    ok('C6 목록 화면 순서 변화 0', same(await domOrder(), before), JSON.stringify(await domOrder()));
    ok('C6 saveState 0건', reqs(L6, 'saveState').length === 0, `${reqs(L6, 'saveState').length}건`);
    ok(`C6 잠금 토스트 「${LOCK_MSG}」`, toasts(L6).includes(LOCK_MSG), JSON.stringify(toasts(L6)));
    ok('C6 미저장 표시가 서지 않았다(바뀐 것이 없다)', (await cdp.ev('unsaved')) === false);
    ok('C6 __dbFault{off} → ok', (await fault('off'))?.ok === true);
    const t6 = Date.now();
    const rec6 = await waitFor(isHealthy, 30000, 300);
    ok(`C6 자동 복구(${((Date.now() - t6) / 1000).toFixed(1)}초): conn ok, bootOk, 상자 없음`, rec6, JSON.stringify(await J('({ conn: conn, bootOk: bootOk, unsaved: unsaved })')));
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
    head('정리: 장애 off, 정상 복귀, zz 과제 삭제, 원래 순서 복원');
    try {
      if (faultOk) {
        let off = null;
        for (let i = 0; i < 3 && !(off && off.ok); i++) { try { off = await fault('off'); } catch (_) { off = null; await sleep(500); } }
        if (!(off && off.ok)) console.log(`${el()}   ★★ 경고: __dbFault{off} 가 확인되지 않았다. 위젯을 재시작하세요(모드는 프로세스 안에만 있다)`);
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
        //  zz 과제: 이 실행이 만든 것 + 이름이 zzORD- 로 시작하는 것(중단 잔재)
        const zz = await zzCats();
        for (const c of zz) ok(`정리: zz 과제 ${c.name} 삭제`, await deleteCatViaUi(c.id));
        //  원래 순서로: 진짜 위로를 눌러 한 칸씩(moveCategory 경로). 각 목표 자리에 올 과제를 위로 끌어올린다.
        //   원래 순서도 묶음 순서이고 묶음 소속은 바뀌지 않으니, 끌어올리는 길은 늘 같은 묶음 안이다.
        const target = ORIG.slice();
        let stuck = false, moves = 0;
        for (let k = 0; k < target.length && !stuck; k++) {
          for (let guard = 0; guard < target.length + 2; guard++) {
            const cur = await order();
            const i = cur.indexOf(target[k]);
            if (i < 0) { stuck = true; note(`정리: 원래 과제 ${target[k]} 가 목록에 없다`); break; }
            if (i <= k) break;
            const p = await press(target[k], 'up');
            if (p.r !== 'ok') {   // 단추를 못 찾으면(목록이 어긋났으면) 같은 함수를 직접 부른다
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
          //  마지막 수단: 원래 순서로 배열을 놓고 save() 한 번(원래 순서는 묶음 순서라 규칙에 맞다).
          console.log(`${el()}   . 정리: 위로 복원이 어긋났다(${r}). 배열을 원래 순서로 놓고 save() 1회`);
          await cdp.ev(`(function(){ const want = ${JSON.stringify(ORIG)}; const by = new Map(state.categories.map(function(c){ return [c.id, c]; }));
            const rest = state.categories.filter(function(c){ return want.indexOf(c.id) < 0; });
            state.categories = want.filter(function(id){ return by.has(id); }).map(function(id){ return by.get(id); }).concat(rest); save(); return 1; })()`);
          await saveIdle();
          const r2 = await reload();
          restored = r2 === 'applied' && same(await order(), ORIG);
        }
        ok(`정리: 원래 순서 복원(위로 ${moves}번), reloadState 뒤 서버 순서 = 원래 순서`, restored, JSON.stringify({ got: await order(), want: ORIG }));
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
console.log(`내 과제 순서 루프 요약, 시드 ${OPT.seed}, 소요 ${secs}s`);
if (F.length) { console.log(`실패 ${F.length}건:`); F.forEach((f) => console.log('  ✗ ' + f)); }
if (UD.length) { console.log(`판정 불가 ${UD.length}건:`); UD.forEach((f) => console.log('  ? ' + f)); }
if (NA.length) { console.log(`해당 없음 ${NA.length}건(이 데이터, 배치에 성립 조건이 없다):`); NA.forEach((f) => console.log('  - ' + f)); }
if (cdp && ORIG && healthyAtEnd === false) {
  console.log('\n★★ 경고: 끝날 때 위젯이 정상(conn ok, bootOk, 상자와 막대 없음)으로 돌아오지 않았다. 화면을 확인하고 필요하면 재시작하세요.');
}
if (ORIG && restored === false) {
  console.log('\n★★★ 경고: 과제 순서를 원래대로 되돌리지 못했다. 원래 순서(state.categories id):');
  console.log('    ' + JSON.stringify(ORIG));
}
console.log(`재현: node tests/loop-category-order.mjs --seed=${OPT.seed} --port=${OPT.port}`);
console.log(`\n통과 ${pass} · 실패 ${fail} · 판정 불가 ${undecided}`);
console.log('═'.repeat(74));
const cleanOk = !ORIG || (restored !== false && healthyAtEnd !== false);
process.exit(fail > 0 || !cleanOk ? 1 : (undecided > 0 || notReady ? 2 : 0));
