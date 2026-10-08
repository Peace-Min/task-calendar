#!/usr/bin/env node
/* =====================================================================================
 *  tests/loop-report-edit.mjs — 일간 보고서 글 편집 **실동작** 루프(docs/REPORT-EDIT.md §7)
 * -------------------------------------------------------------------------------------
 *  계약 시험(report-edit.test.mjs)은 jsdom 으로 규칙을 잠근다. 이 루프는 실제 위젯(Debug, TC_DEBUG_PORT)에 붙어
 *  로그인한 사용자 자신의 보고서 창에서 진짜 버튼을 누르고, 실제 WebView2 저장소(localStorage)에서 임시 저장의 수명을 본다.
 *
 *  케이스:
 *    O0   전제 — 로그인, conn ok, bootOk, 새 빌드(rptDraftGet 등), 지난 실행 잔재(2099 임시 저장 키) 정리
 *    E1   일간 보고서를 2099 시험 날짜로 연다 — 기본 보기는 카드, 카드마다 X, 줄 ✎/✕ 없음
 *    E2   시간 칸 두 과제(A, B)에 시간을 적는다(실제 시간 입력 처리기 → save)
 *    E3   X(B) — 카드가 제자리에 흐리게 남는다(수, 순서, **높이** 같음) · 키에 바로 저장 · 되돌리기 칸이 같은 자리
 *    E4   글 편집 — 잠긴 머리 줄(span) · A 내용 칸에 상세 줄 입력 → 잠시 뒤 키에 저장
 *    E5   창 닫고 다시 열기 — 고친 글과 X 가 그대로
 *    E6   날짜 바꾸기 — 다른 날짜는 깨끗하고, 돌아오면 다시 그대로
 *    E7   위젯 다시 읽기(reloadState) 뒤에도 그대로
 *    E8   전송(가로채기) — content 의 상세 줄이 &nbsp; 들여쓰기, B 는 본문과 hours 에서 빠짐 · 대기 표지
 *         → __netcusResult(true) 흉내 → 임시 저장이 지워진다
 *    E9   실패 회신 흉내 → 임시 저장이 남는다(그리고 표지는 비워진다)
 *    E10  보고서 묶음(docs/REPORT-GROUP.md): 깨끗한 날짜(D2)에서 왼쪽 "설정" → 설정 창(첫 버튼 포커스) → B 를 A 위로 끌어 넣기(PointerEvent)
 *         → X 로 꺼내기 → ⋯ 메뉴(Esc 는 메뉴만) → A 고르기 → 닫기(포커스가
 *         "설정" 으로), B 는 A 카드 안의 작은 카드, A 합계 3.5, 묶음만으로 키, 머리 줄과 hours 가 합친 값(가로채기 전송) → 성공 회신 흉내로 지워진다
 *    정리 2099 임시 저장 키 삭제, 시험 날짜의 시간 지우기(앱으로) → 다시 읽어 잔재 0 확인
 *
 *  ★ 실제로 netcus 에 보내지 않는다(두 겹): Platform.report.submitDaily 를 가로채 payload 만 붙잡고,
 *    hpost 도 감싸 'netcus' 로 시작하는 명령은 호스트로 넘기지 않고 기록만 한다. 회신은 __netcusResult 를 직접 불러 흉내 낸다.
 *  ★ 남기지 않는다: 시험 날짜는 2099-12-02(그리고 2099-12-03). 시간은 그 날짜에만 적고 finally 에서 앱으로 지운다.
 *    임시 저장 키 tc_rptDraft:<who>:2099-* 도 지운다. DB 에 직접 붙지 않는다.
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 로그인된 채 띄운 뒤(예: powershell -File dist/promo/win.ps1 start)
 *    node tests/loop-report-edit.mjs [--port=9222] [-v]
 *    종료코드: 0 통과, 1 실패, 2 판정 불가(전제가 안 서서 증명하지 못함, 초록 아님)
 * ===================================================================================== */

const ARG = new Map(process.argv.slice(2).map((a) => {
  const m = /^--?([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const OPT = {
  port: Number(ARG.get('port') || process.env.TC_DEBUG_PORT || 9222),
  verbose: ARG.has('verbose') || ARG.has('v'),
};
if (ARG.has('help') || ARG.has('h')) {
  console.log(`사용법: node tests/loop-report-edit.mjs [--port=${OPT.port}] [-v]`);
  process.exit(0);
}
//  시험 날짜 — 실데이터와 겹치지 않는 먼 미래. 정리 뒤 이 날짜에 시간이나 임시 저장이 남으면 실패다.
const D = '2099-12-02', D2 = '2099-12-03';
const NB = '&nbsp;';
const DETAIL = '• 시험 상세 줄 루프\n    - 하위 한 줄\n    - 하위 두 줄';

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

/* ── 페이지 기록기 + 전송 차단 — 원본을 그대로 부르되 netcus 명령만은 호스트로 넘기지 않는다 ── */
//  ★ finally 에서 반드시 원본으로 되돌린다. 차단은 두 겹: submitDaily 가로채기(payload 붙잡기) + hpost 의 netcus 명령 버리기.
const INSTALL = `(function(){
  if (window.__rptLoop) return 'already';
  const R = window.__rptLoop = { log: [], cap: [], blocked: [], orig: { hostRequest: hostRequest, toast: toast, hpost: hpost,
    applyState: window.__applyState, applyErr: window.__applyStateError, submitDaily: Platform.report.submitDaily, submitWeekly: Platform.report.submitWeekly } };
  hostRequest = function(cmd, params, t){
    const rec = { t: Date.now(), req: cmd };
    R.log.push(rec);
    return R.orig.hostRequest(cmd, params, t).then(function(res){ rec.done = Date.now(); rec.res = { ok: !!(res && res.ok) }; return res; });
  };
  toast = function(m, k, a, ms){ R.log.push({ t: Date.now(), toast: String(m), kind: k }); return R.orig.toast(m, k, a, ms); };
  hpost = function(o){ if (o && /^netcus/i.test(String(o.cmd || ''))) { R.blocked.push(String(o.cmd)); return; } return R.orig.hpost(o); };
  Platform.report.submitDaily = function(p){ R.cap.push(JSON.parse(JSON.stringify(p))); };
  Platform.report.submitWeekly = function(p){ R.blocked.push('submitWeekly'); };
  window.__applyState = function(j, m){ R.log.push({ t: Date.now(), applied: true }); return R.orig.applyState(j, m); };
  window.__applyStateError = function(msg, opt){ R.log.push({ t: Date.now(), applyErr: String(msg) }); return R.orig.applyErr(msg, opt); };
  return 'ok';
})()`;
const UNINSTALL = `(function(){
  const R = window.__rptLoop; if (!R) return 'none';
  hostRequest = R.orig.hostRequest; toast = R.orig.toast; hpost = R.orig.hpost;
  Platform.report.submitDaily = R.orig.submitDaily; Platform.report.submitWeekly = R.orig.submitWeekly;
  window.__applyState = R.orig.applyState; window.__applyStateError = R.orig.applyErr;
  delete window.__rptLoop; return 'ok';
})()`;
const mark = () => cdp.ev('__rptLoop.log.length');
const since = (m) => J(`__rptLoop.log.slice(${Number(m)})`);
//  가로채기가 제자리에 있는가(보내기 직전마다 확인한다 — 없으면 누르지 않는다)
const interceptOk = () => cdp.ev(`!!window.__rptLoop && Platform.report.submitDaily !== window.__rptLoop.orig.submitDaily && hpost !== window.__rptLoop.orig.hpost`);

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
//  보고서 묶음 설정 창 끌어 놓기(REPORT-GROUP §4, 2026-10-08): 진짜 PointerEvent 로 누르고(줄 이름) 5px 넘게 움직이고 놓는다.
//    놓을 곳은 rgmFind('grp', over) 묶음(null 이면 창 제목 = 묶음 밖). 포인터 아래 판정은 실제 elementFromPoint 다.
//    돌려주는 것: { lit: 놓기 직전 놓을 곳 점선 강조, ghost: 끄는 동안 그림자 } 또는 'no-src' / 'no-over'.
async function dragRow(src, over) {
  return J(`(function(){
    const s = rgmFind('gk', ${JSON.stringify(src)});
    const o = ${JSON.stringify(over)} === null ? document.querySelector('#rptGroupModal .modal-head h2') : rgmFind('grp', ${JSON.stringify(over)});
    if(!s) return 'no-src'; if(!o) return 'no-over';
    s.scrollIntoView({ block: 'nearest' }); o.scrollIntoView({ block: 'nearest' });
    const a = s.querySelector('.rgm-t').getBoundingClientRect(), b = o.getBoundingClientRect();
    const x0 = a.left + 4, y0 = a.top + a.height / 2, x1 = b.left + Math.min(40, b.width / 2), y1 = b.top + Math.min(14, b.height / 2);
    const P = function(t, el, x, y){ el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: t === 'pointerup' ? 0 : 1, clientX: x, clientY: y })); };
    P('pointerdown', s.querySelector('.rgm-t'), x0, y0);
    P('pointermove', document, x0 + 8, y0 + 8);
    P('pointermove', document, x1, y1);
    const lit = ${JSON.stringify(over)} !== null && o.classList.contains('drop'), ghost = !!document.querySelector('#rptGroupModal .rgm-ghost');
    P('pointerup', document, x1, y1);
    return { lit: lit, ghost: ghost, left: !!document.querySelector('#rptGroupModal .rgm-ghost') };
  })()`);
}
async function closeAll() {
  await cdp.ev(`(function(){ ['#confirmModal','#rptGroupModal','#reportModal'].forEach(function(s){
    try { const m = document.querySelector(s); if (m && !m.classList.contains('hidden')) closeModal(s); } catch (_) {} }); return 1; })()`);
  await sleep(400);
}
//  보고서를 사람이 여는 문(헤더 #btnReportTop)으로 열고 시험 날짜로 옮긴다(날짜 칸 change = 사람이 날짜를 고른 것과 같은 처리기)
async function openReportAt(date) {
  if (await cdp.ev(isOpen('#reportModal'))) { await cdp.ev("closeModal('#reportModal'); 1"); await sleep(450); }
  await cdp.ev(`(function(){ const b = document.getElementById('btnReportTop'); if (b && b.offsetParent) b.click(); else openReport(); return 1; })()`);
  const opened = await waitFor(isOpen('#reportModal'), 3000, 100);
  //  포함 항목을 셋 다, 빈 항목 제외는 끈다(행 = 모든 과제). buildReport 가 이 선택을 tc_rptSources 에 저장하므로 원래 값은 O0 에서 받아 두고 끝에 되돌린다.
  await cdp.ev(`(function(){ ['#rptSrcEvent','#rptSrcTodo','#rptSrcGit','#rptWithDesc'].forEach(function(s){ $(s).checked = true; }); $('#rptSkipEmpty').checked = false; return 1; })()`);
  await setDate(date);
  return opened;
}
const setDate = async (date) => { await cdp.ev(`(function(){ const f = $('#rptFrom'); f.value = ${JSON.stringify(date)}; f.dispatchEvent(new Event('change')); return 1; })()`); await sleep(150); };
const keyOf = (date) => cdp.ev(`rptDraftKey(${JSON.stringify(date)})`);
const stored = (date) => J(`(function(){ try { return JSON.parse(localStorage.getItem(rptDraftKey(${JSON.stringify(date)})) || 'null'); } catch (_) { return 'ERR'; } })()`);
const loopKeys = () => J(`(function(){ const pre = 'tc_rptDraft:' + rptDraftWho() + ':2099-'; const a = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(pre) === 0) a.push(k); } return a; })()`);
const dropLoopKeys = () => cdp.ev(`(function(){ const pre = 'tc_rptDraft:' + rptDraftWho() + ':2099-'; const a = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(pre) === 0) a.push(k); }
  a.forEach(function(k){ localStorage.removeItem(k); __rptDraftMem.delete(k); __rptDraftDirty.delete(k); __rptDraftFailed.delete(k); });
  [...__rptDraftMem.keys()].forEach(function(k){ if (k.indexOf(pre) === 0) { __rptDraftMem.delete(k); __rptDraftDirty.delete(k); } });
  if (String(__rptDraftSending).indexOf(pre) === 0) __rptDraftSending = '';
  return a.length; })()`);
const cardsInfo = () => J(`[].map.call(document.querySelectorAll('#rptOut .rcard'), function(c){ return { cat: c.dataset.rcat, nm: (c.querySelector('.rcard-nm') || {}).textContent,
  out: c.classList.contains('rcard-out'), edited: !!c.querySelector('.rcard-edited'), h: Math.round(c.getBoundingClientRect().height * 10) / 10,
  headH: Math.round(c.querySelector('.rcard-head').getBoundingClientRect().height * 10) / 10 }; })`);
const clickInCard = (cat, sel) => cdp.ev(`(function(){ const c = [].find.call(document.querySelectorAll('#rptOut .rcard'), function(x){ return x.dataset.rcat === ${JSON.stringify(cat)}; });
  if (!c) return 'nocard'; const b = c.querySelector(${JSON.stringify(sel)}); if (!b) return 'nobtn'; b.click(); return 'ok'; })()`);
const setView = (v) => cdp.ev(`(function(){ const b = document.querySelector('#rptViewSeg [data-rview="${v}"]'); if (!b) return 'nobtn'; b.click(); return 'ok'; })()`);
const confirmOk = async () => {
  if (!(await waitFor(isOpen('#confirmModal'), 4000, 100))) return false;
  await cdp.ev(`document.getElementById('cfOk').click(); 1`);
  await waitFor(`document.getElementById('confirmModal').classList.contains('hidden')`, 3000, 100);
  await sleep(200);
  return true;
};
//  가로챈 전송 — 확인창까지 누르고 붙잡은 payload 를 돌려준다. 가로채기가 없으면 누르지 않는다.
async function sendIntercepted() {
  if (!(await interceptOk())) throw new Error('전송 가로채기가 제자리에 없다 — 실제 전송 위험이라 누르지 않는다');
  const n0 = await cdp.ev('__rptLoop.cap.length');
  await cdp.ev(`document.getElementById('btnRptSend').click(); 1`);
  const asked = await confirmOk();
  await waitFor(`__rptLoop.cap.length > ${n0}`, 4000, 100);
  const cap = await J(`__rptLoop.cap[__rptLoop.cap.length - 1]`);
  return { asked, cap: (await cdp.ev('__rptLoop.cap.length')) > n0 ? cap : null };
}

/* ── 본체 ─────────────────────────────────────────────────────────── */
console.log('═'.repeat(74));
console.log(`보고서 글 편집 실동작 루프 — 포트 ${OPT.port}, 시험 날짜 ${D}, ${D2}`);
console.log('═'.repeat(74));

let started = false;       // 전제가 서서 시험 데이터를 만들기 시작했다(정리 대상이 있을 수 있다)
let healthyAtEnd = null;
let cleaned = null;
let notReady = false;
let catA = null, catB = null, nameA = '', nameB = '';
let srcPrefs0 = undefined;   // 사용자의 포함 항목 저장값(tc_rptSources) 원문 — 끝에 그대로 되돌린다

async function main() {
  cdp = await Cdp.attach(OPT.port);

  /* ── O0 전제 ── */
  head('O0 전제 — 로그인, 정상 연결, 새 빌드, 지난 실행 잔재 정리');
  if (await cdp.ev("typeof rptDraftGet !== 'function' || typeof rptDocInput !== 'function' || typeof rptDraftOnSendResult !== 'function'")) {
    notReady = true; undecide('O0 기능 존재', '위젯에 rptDraftGet/rptDocInput 이 없다. 낡은 빌드다(dotnet build -c Debug 후 재시작)'); return;
  }
  const user = await cdp.ev("(typeof currentUser !== 'undefined' && currentUser && currentUser.loginId) || ''");
  if (!user) { notReady = true; undecide('O0 로그인', '위젯이 로그인 상태가 아니다'); return; }
  if (!(await waitFor(isHealthy, 30000))) {
    notReady = true;
    undecide('O0 정상 연결', '시작 상태가 정상이 아니다: ' + JSON.stringify(await J('({ conn: conn, bootOk: bootOk, unsaved: unsaved })')));
    return;
  }
  ok('O0 로그인, conn ok, bootOk, 잠금 없음', !(await cdp.ev('editLocked()')), `login=${user}`);
  vlog('기록기:', await cdp.ev(INSTALL));
  ok('O0 전송 가로채기(submitDaily) + netcus 명령 차단(hpost) 설치', await interceptOk());
  await closeAll();
  srcPrefs0 = await cdp.ev(`(function(){ try { return localStorage.getItem('tc_rptSources'); } catch (_) { return null; } })()`);
  started = true;
  const left0 = await dropLoopKeys();
  if (left0) note(`지난 실행의 2099 임시 저장 키 ${left0}건을 지웠다`);
  //  시험 과제 = 보고서 행의 앞 두 과제(휴가, 기타가 늘 있으므로 둘 이상이다). 시간은 2099 날짜에만 적는다.
  const rows = await J(`collectReportData(${JSON.stringify(D)}, ${JSON.stringify(D)}, { event: true, todo: true, git: true, desc: true, skipEmpty: false }).rows.map(function(r){ return { key: r.key, name: r.name }; })`);
  if (!rows || rows.length < 2) { notReady = true; undecide('O0 과제 둘 이상', JSON.stringify(rows)); return; }
  [catA, catB] = [rows[0].key, rows[1].key]; [nameA, nameB] = [rows[0].name, rows[1].name];
  const pre = await J(`[getTaskHours(${JSON.stringify(D)}, ${JSON.stringify(catA)}), getTaskHours(${JSON.stringify(D)}, ${JSON.stringify(catB)})]`);
  if (pre.some((v) => v != null)) note(`시험 날짜에 지난 실행의 시간이 남아 있었다(${JSON.stringify(pre)}) — 이번 실행이 덮고 끝에 지운다`);
  const KEY = await keyOf(D), KEY2 = await keyOf(D2);
  vlog('시험 과제:', nameA, nameB, KEY);

  /* ── E1 열기 ── */
  head('E1 일간 보고서를 시험 날짜로 연다 — 기본 카드 보기, X, 줄 ✎/✕ 없음');
  ok('E1 보고서 창이 열렸다', await openReportAt(D));
  ok('E1 일간, 시험 날짜', same(await J(`[reportMode, $('#rptFrom').value, $('#rptTo').value]`), ['daily', D, D]));
  ok('E1 기본 보기 = 카드(보기 전환 줄이 보인다)', same(await J(`[rptView, $('#rptViewBar').classList.contains('hidden'), $('#rptViewSeg [data-rview="card"]').getAttribute('aria-pressed')]`), ['card', false, 'true']));
  const c0 = await cardsInfo();
  ok('E1 카드 = 보고서 행(수, 순서)', same(c0.map((c) => c.cat), rows.map((r) => r.key)), JSON.stringify(c0.map((c) => c.nm)));
  ok('E1 카드마다 X, 줄 ✎/✕ 와 날짜 줄 ✎ 는 없다', await cdp.ev(`document.querySelectorAll('#rptOut .rcard-x').length === document.querySelectorAll('#rptOut .rcard').length && !document.querySelector('#rptOut [data-ract], #rptOut .rdn-edit-btn')`));

  /* ── E2 시간 ── */
  head('E2 시간 칸 — A=2, B=1.5(실제 시간 입력 처리기)');
  for (const [cat, v] of [[catA, '2'], [catB, '1.5']]) {
    await cdp.ev(`(function(){ const c = [].find.call(document.querySelectorAll('#rptOut .rcard'), function(x){ return x.dataset.rcat === ${JSON.stringify(cat)}; });
      const i = c.querySelector('.rcard-h-in'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    await saveIdle();
  }
  ok('E2 시간이 저장됐다', same(await J(`[getTaskHours(${JSON.stringify(D)}, ${JSON.stringify(catA)}), getTaskHours(${JSON.stringify(D)}, ${JSON.stringify(catB)})]`), [2, 1.5]));

  /* ── E3 X ── */
  head('E3 X(B) — 제자리에 흐리게, 높이 그대로, 바로 저장');
  const before = await cardsInfo();
  ok('E3 X 를 눌렀다', (await clickInCard(catB, '.rcard-x')) === 'ok');
  await sleep(200);
  const after = await cardsInfo();
  ok('E3 카드 수, 순서가 그대로(지우지 않고 제자리)', same(after.map((c) => c.cat), before.map((c) => c.cat)));
  const bB = before.find((c) => c.cat === catB), aB = after.find((c) => c.cat === catB);
  ok('E3 B 카드가 흐림(rcard-out)', aB && aB.out);
  ok('E3 B 카드와 머리 높이가 바뀌지 않았다(시간 칸과 "뺌, 되돌리기" 가 한 칸에서 맞바뀜)', aB && Math.abs(aB.h - bB.h) < 0.6 && Math.abs(aB.headH - bB.headH) < 0.6, `전 ${bB.h}/${bB.headH} 뒤 ${aB && aB.h}/${aB && aB.headH}`);
  ok('E3 되돌리기가 같은 칸에 있고 포커스가 거기로 갔다', await cdp.ev(`(function(){ const b = document.activeElement; return !!b && b.classList.contains('rcard-back') && !!b.closest('.rcard-slot'); })()`));
  const s3 = await stored(D);
  ok('E3 X 가 바로 저장됐다(out 에 B)', s3 && s3.v === 1 && Array.isArray(s3.out) && s3.out.includes(catB), JSON.stringify(s3));

  /* ── E4 글 편집 ── */
  head('E4 글 편집 — 잠긴 머리 줄, 상세 줄 입력 → 잠시 뒤 저장');
  ok('E4 글 편집 보기로', (await setView('doc')) === 'ok');
  await sleep(150);
  const heads = await J(`[].map.call(document.querySelectorAll('#rptOut .rdoc-head'), function(x){ return x.tagName + '|' + x.textContent; })`);
  ok('E4 A 머리 줄은 잠긴 줄(span)이고 시간 칸 값을 보인다', heads[0] === `SPAN|[${nameA}] : 2`, JSON.stringify(heads.slice(0, 3)));
  ok('E4 뺀 B 는 한 줄 안내', await cdp.ev(`[].some.call(document.querySelectorAll('#rptOut .rdoc-outsec'), function(x){ return x.dataset.rcat === ${JSON.stringify(catB)} && x.textContent.indexOf('이 보고서에서 뺌') >= 0; })`));
  await cdp.ev(`(function(){ const t = [].find.call(document.querySelectorAll('#rptOut .rdoc-ta'), function(x){ return x.dataset.rcat === ${JSON.stringify(catA)}; });
    t.focus(); t.value = ${JSON.stringify(DETAIL)}; t.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  await sleep(700);   // 입력은 짧게 모아서(약 400ms) 쓴다
  const s4 = await stored(D);
  ok('E4 고친 글이 저장됐다(body, base, savedAt)', s4 && s4.body && s4.body[catA] === DETAIL && typeof s4.base[catA] === 'string' && !isNaN(Date.parse(s4.savedAt)), JSON.stringify(s4));
  ok('E4 "고친 과제 1개", "이 PC에 임시 저장됨" 표시', await cdp.ev(`(function(){ const t = $('#rptEditInfo').textContent; return t.indexOf('고친 과제 1개') >= 0 && t.indexOf('이 PC에 임시 저장됨') >= 0; })()`));

  /* ── E5 닫고 다시 열기 ── */
  head('E5 창 닫고 다시 열기 — 고친 글과 X 가 그대로');
  await cdp.ev("closeModal('#reportModal'); 1");
  await waitFor(`document.getElementById('reportModal').classList.contains('hidden')`, 3000, 100);
  ok('E5 다시 열었다', await openReportAt(D));
  const c5 = await cardsInfo();
  ok('E5 카드 보기로 열린다', (await cdp.ev('rptView')) === 'card');
  ok('E5 B 는 여전히 뺐다', (c5.find((c) => c.cat === catB) || {}).out === true);
  ok('E5 A 는 고친 글 그대로', await cdp.ev(`(function(){ const c = [].find.call(document.querySelectorAll('#rptOut .rcard'), function(x){ return x.dataset.rcat === ${JSON.stringify(catA)}; });
    const f = c && c.querySelector('.rcard-free'); return !!f && f.textContent === ${JSON.stringify(DETAIL)} && !!c.querySelector('.rcard-edited'); })()`));

  /* ── E6 날짜 바꾸기 ── */
  head('E6 날짜 바꾸기 — 다른 날짜는 깨끗, 돌아오면 그대로');
  await setDate(D2);
  ok('E6 다른 날짜엔 뺀 것도 고친 것도 없다', await cdp.ev(`!document.querySelector('#rptOut .rcard-out, #rptOut .rcard-edited')`));
  ok('E6 다른 날짜 키는 렌더만으로 생기지 않는다', !(await loopKeys()).includes(KEY2));
  await setDate(D);
  ok('E6 돌아오면 그대로', await cdp.ev(`!!document.querySelector('#rptOut .rcard-out') && !!document.querySelector('#rptOut .rcard-edited')`));

  /* ── E7 다시 읽기 ── */
  head('E7 위젯 다시 읽기(reloadState) 뒤에도 그대로');
  await closeAll();
  const r7 = await reload();
  ok('E7 reloadState → 적용', r7 === 'applied', r7);
  ok('E7 다시 열면 고친 글과 X 가 그대로', (await openReportAt(D)) && (await cdp.ev(`!!document.querySelector('#rptOut .rcard-out') && !!document.querySelector('#rptOut .rcard-edited')`)));
  ok('E7 나가는 글 머리 줄과 상세 줄', (await cdp.ev('buildReportText()')).startsWith(`[${nameA}] : 2\n• 시험 상세 줄 루프\n    - 하위 한 줄\n`));

  /* ── E8 전송(가로채기) → 성공 회신 흉내 ── */
  head('E8 전송 — 실제로 보내지 않고 payload 확인 → 성공 회신 흉내 → 임시 저장이 지워진다');
  const s8 = await sendIntercepted();
  ok('E8 제출 확인창을 거쳤다', s8.asked);
  ok('E8 payload 를 붙잡았다(호스트로 나가지 않음)', !!s8.cap);
  if (s8.cap) {
    const ct = String(s8.cap.fields && s8.cap.fields.content || '');
    ok('E8 content 의 상세 줄이 &nbsp; 들여쓰기로', ct.startsWith(`[${nameA}] : 2\n• 시험 상세 줄 루프\n${NB.repeat(4)}- 하위 한 줄\n${NB.repeat(4)}- 하위 두 줄`), JSON.stringify(ct.slice(0, 200)));
    ok('E8 뺀 B 는 content 에 없다', !ct.includes(`[${nameB}]`));
    ok('E8 hours 에서 B 가 빠지고 A 는 있다', Array.isArray(s8.cap.hours) && s8.cap.hours.some((x) => x.name === nameA && x.hours === 2) && !s8.cap.hours.some((x) => x.name === nameB), JSON.stringify(s8.cap.hours));
    ok('E8 dryRun 은 false 상수 그대로(가로채기만 했다)', s8.cap.dryRun === false);
  }
  ok('E8 netcus 명령은 하나도 호스트로 나가지 않았다', same(await J('__rptLoop.blocked'), []), JSON.stringify(await J('__rptLoop.blocked')));
  ok('E8 대기 표지가 이 날짜 키', (await cdp.ev('__rptDraftSending')) === KEY);
  ok('E8 회신 전에는 임시 저장이 남아 있다', !!(await stored(D)));
  await cdp.ev(`window.__netcusResult(true, '시험 회신(루프, 실제 전송 아님)'); 1`);
  await sleep(200);
  ok('E8 성공 회신 흉내 → 임시 저장이 지워졌다', (await stored(D)) === null);
  ok('E8 표지가 비고, 미리보기도 초안으로 돌아왔다', (await cdp.ev('__rptDraftSending')) === '' && (await cdp.ev(`!document.querySelector('#rptOut .rcard-out, #rptOut .rcard-edited')`)));

  /* ── E9 실패 회신 흉내 ── */
  head('E9 실패 회신 흉내 → 임시 저장이 남는다');
  ok('E9 X(B) 다시', (await clickInCard(catB, '.rcard-x')) === 'ok');
  const s9 = await sendIntercepted();
  ok('E9 payload 를 붙잡았다', !!s9.cap);
  await cdp.ev(`window.__netcusResult(false, '시험 실패 회신(루프)'); 1`);
  await sleep(200);
  const k9 = await stored(D);
  ok('E9 실패 회신 → 임시 저장이 남는다', !!k9 && Array.isArray(k9.out) && k9.out.includes(catB), JSON.stringify(k9));
  ok('E9 표지는 비워졌다(뒤이은 다른 성공 회신이 지우지 않게)', (await cdp.ev('__rptDraftSending')) === '');
  await cdp.ev(`window.__netcusResult(true, '표지 없는 성공 회신(루프)'); 1`);
  ok('E9 표지 없는 성공 회신으로는 지우지 않는다', !!(await stored(D)));

  /* ── E10 보고서 묶음 ── */
  head('E10 보고서 묶음 — 설정 창에서 B 를 A 에 끌어 넣기, X, ⋯ 메뉴, 카드와 합계, 키, 가로챈 전송, 성공 회신으로 지움');
  for (const [cat, h] of [[catA, 2], [catB, 1.5]]) { await cdp.ev(`setTaskHours(${JSON.stringify(D2)}, ${JSON.stringify(cat)}, ${h}); 1`); await saveIdle(); }
  ok('E10 깨끗한 날짜로 열었다', await openReportAt(D2));
  await setView('card'); await sleep(150);
  ok('E10 "보고서 묶음" 줄과 "묶은 과제 없음"', await cdp.ev(`!$('#rptGroupRow').classList.contains('hidden') && $('#rptGroupSum').textContent === '묶은 과제 없음'`));
  ok('E10 렌더만으로는 키가 없다', (await stored(D2)) === null);
  await cdp.ev(`(function(){ const b = document.getElementById('rptGroupOpen'); b.focus(); b.click(); return 1; })()`);
  ok('E10 설정 창이 열렸다', await waitFor(isOpen('#rptGroupModal'), 3000, 100));
  await sleep(250);
  ok('E10 열면 목록의 첫 버튼에 포커스', await cdp.ev(`document.activeElement === document.querySelector('#rgmRows button')`));
  ok('E10 A, B 는 시간이 있어 펼쳐져 있고 묶인 과제가 없다', await cdp.ev(`!!rgmFind('gk', ${JSON.stringify(catA)}) && !!rgmFind('gk', ${JSON.stringify(catB)}) && !document.querySelector('#rgmRows .rgm-row.kid')`));
  //  끌어 넣기(진짜 PointerEvent): B 를 A 묶음 위로
  const d10 = await dragRow(catB, catA);
  ok('E10 끄는 동안 그림자와 A 묶음 점선 강조, 놓은 뒤 그림자 없음', !!d10 && d10.ghost === true && d10.lit === true && d10.left === false, JSON.stringify(d10));
  await sleep(200);
  ok('E10 B 는 A 묶음 안의 들여 쓴 줄, A 는 ⠿ 와 ⋯ 가 없다(한 단계)', await cdp.ev(`(function(){ const g = rgmFind('grp', ${JSON.stringify(catA)}), b = rgmFind('gk', ${JSON.stringify(catB)}), a = rgmFind('gk', ${JSON.stringify(catA)});
    return !!g && !!b && b.classList.contains('kid') && b.parentElement === g && a.getAttribute('data-dr') === '0' && !a.querySelector('button'); })()`));
  ok('E10 A 줄은 합친 시간(3.5시간)', await cdp.ev(`(rgmFind('gk', ${JSON.stringify(catA)}).querySelector('.rgm-meta') || {}).textContent`).then((t) => String(t || '').endsWith('3.5시간')));
  //  끌기 없이: X(꺼내기) → 제자리, 포커스는 B 의 ⋯ / ⋯ 메뉴에서 A 고르기 → 다시 묶임, 포커스는 B 의 X
  await cdp.ev(`rgmFind('gout', ${JSON.stringify(catB)}).click(); 1`); await sleep(200);
  ok('E10 X 로 꺼냈다(묶음 없음), 포커스는 B 의 ⋯', await cdp.ev(`!document.querySelector('#rgmRows .rgm-row.kid') && document.activeElement === rgmFind('gmenu', ${JSON.stringify(catB)})`));
  await cdp.ev(`rgmFind('gmenu', ${JSON.stringify(catB)}).click(); 1`); await sleep(150);
  ok('E10 ⋯ 메뉴 "넣을 곳" 이 열리고 첫 항목에 포커스', await cdp.ev(`!!document.getElementById('rgmMenu') && document.activeElement === document.querySelector('#rgmMenu [role="menuitem"]')`));
  await cdp.ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); 1`); await sleep(200);
  ok('E10 메뉴에서 Esc 는 메뉴만 닫는다(설정 창은 열려 있고 포커스는 ⋯)', (await cdp.ev(isOpen('#rptGroupModal'))) && (await cdp.ev(`!document.getElementById('rgmMenu') && document.activeElement === rgmFind('gmenu', ${JSON.stringify(catB)})`)));
  await cdp.ev(`rgmFind('gmenu', ${JSON.stringify(catB)}).click(); 1`); await sleep(150);
  await cdp.ev(`[].find.call(document.querySelectorAll('#rgmMenu [data-ginto]'), function(x){ return x.getAttribute('data-ginto') === ${JSON.stringify(catA)}; }).click(); 1`); await sleep(200);
  ok('E10 메뉴로 다시 묶었다, 포커스는 B 의 X', await cdp.ev(`!!rgmFind('gout', ${JSON.stringify(catB)}) && document.activeElement === rgmFind('gout', ${JSON.stringify(catB)})`));
  await cdp.ev(`document.querySelector('#rptGroupModal [data-close]').click(); 1`);
  ok('E10 닫기로 닫혔다(보고서 창은 남는다)', (await waitFor(`document.getElementById('rptGroupModal').classList.contains('hidden')`, 3000, 100)) && (await cdp.ev(isOpen('#reportModal'))));
  await sleep(250);
  ok('E10 닫으면 포커스가 "설정" 으로 돌아온다', await cdp.ev(`document.activeElement === document.getElementById('rptGroupOpen')`));
  ok('E10 B 는 A 카드 안의 작은 카드("묶음"), A 합계 3.5 h', await cdp.ev(`(function(){ const a = [].find.call(document.querySelectorAll('#rptOut > .rcard'), function(c){ return c.dataset.rcat === ${JSON.stringify(catA)}; });
    if (!a) return false; const sub = a.querySelector('.rcard-subs > .rcard'); const g = a.querySelector('.rcard-gsum');
    return !!sub && sub.dataset.rcat === ${JSON.stringify(catB)} && !!sub.querySelector('.rcard-grp') && !!g && g.textContent === '합계 3.5 h'; })()`));
  const s10 = await stored(D2);
  ok('E10 묶음만으로 그 날짜 키가 생겼다', !!s10 && s10.group && s10.group[catB] === catA && Object.keys(s10.body || {}).length === 0, JSON.stringify(s10));
  ok('E10 나가는 글 머리 줄은 합친 시간, B 머리 줄 없음', await cdp.ev(`(function(){ const t = buildReportText(); return t.indexOf(${JSON.stringify(`[${nameA}] : 3.5\n`)}) === 0 && t.indexOf(${JSON.stringify(`[${nameB}]`)}) < 0; })()`));
  const s10b = await sendIntercepted();
  ok('E10 payload 를 붙잡았다', !!s10b.cap);
  if (s10b.cap) {
    ok('E10 hours = 머리 줄(A 3.5, B 없음)', Array.isArray(s10b.cap.hours) && s10b.cap.hours.some((x) => x.name === nameA && x.hours === 3.5) && !s10b.cap.hours.some((x) => x.name === nameB), JSON.stringify(s10b.cap.hours));
    ok('E10 content 에 B 머리 줄 없음', !String(s10b.cap.fields.content).includes(`[${nameB}]`));
  }
  ok('E10 netcus 명령은 하나도 나가지 않았다', same(await J('__rptLoop.blocked'), []));
  await cdp.ev(`window.__netcusResult(true, '시험 회신(루프, 실제 전송 아님)'); 1`);
  await sleep(200);
  ok('E10 성공 회신 흉내 → 묶음까지 지워졌다', (await stored(D2)) === null && (await cdp.ev(`!document.querySelector('#rptOut .rcard-subs')`)));
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
  //  ★ 무슨 일이 있어도: 2099 임시 저장 키를 지우고, 시험 날짜의 시간을 앱으로 지운 뒤 다시 읽어 잔재 0 을 본다.
  if (cdp && started) {
    head('정리 — 2099 임시 저장 키, 시험 날짜 시간 · 다시 읽어 잔재 0');
    try {
      await cdp.ev(`clearTimeout(Netcus.watchdog); 1`).catch(() => 0);
      await closeAll();
      await dropLoopKeys();
      if (srcPrefs0 !== undefined) await cdp.ev(`(function(){ try { const v = ${JSON.stringify(srcPrefs0)}; if (v == null) localStorage.removeItem('tc_rptSources'); else localStorage.setItem('tc_rptSources', v); } catch (_) {} return 1; })()`);
      healthyAtEnd = await waitFor(isHealthy, 30000, 300);
      if (!healthyAtEnd) {
        await cdp.ev(`hpost({ cmd: 'reloadState' }); 1`).catch(() => 0);
        healthyAtEnd = await waitFor(isHealthy, 20000, 300);
      }
      if (healthyAtEnd) {
        for (const c of [catA, catB].filter(Boolean)) {
          for (const d of [D, D2]) { await cdp.ev(`setTaskHours(${JSON.stringify(d)}, ${JSON.stringify(c)}, 0); 1`); await saveIdle(); }
        }
        const r = await reload();
        const hoursLeft = await J(`(function(){ const m = (state.taskHours || {}); return [${JSON.stringify(D)}, ${JSON.stringify(D2)}].filter(function(d){ return m[d] && Object.keys(m[d]).length; }); })()`);
        const keysLeft = await loopKeys();
        cleaned = r === 'applied' && hoursLeft.length === 0 && keysLeft.length === 0;
        ok('정리: 다시 읽은 뒤 2099 시간, 임시 저장 키 잔재 0', cleaned, JSON.stringify({ r, hoursLeft, keysLeft }));
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
console.log(`보고서 글 편집 루프 요약 — 소요 ${secs}s`);
if (F.length) { console.log(`실패 ${F.length}건:`); F.forEach((f) => console.log('  ✗ ' + f)); }
if (UD.length) { console.log(`판정 불가 ${UD.length}건:`); UD.forEach((f) => console.log('  ? ' + f)); }
if (started && healthyAtEnd === false) console.log('\n★★ 경고: 끝날 때 위젯이 정상으로 돌아오지 않았다. 화면을 확인하고 필요하면 재시작하세요.');
if (started && cleaned === false) console.log(`\n★★★ 경고: 시험 잔재를 다 지우지 못했다. ${D}, ${D2} 의 과제 시간과 localStorage 의 tc_rptDraft:*:2099-* 키를 확인하세요.`);
console.log(`재현: node tests/loop-report-edit.mjs --port=${OPT.port}`);
console.log(`\n통과 ${pass} · 실패 ${fail} · 판정 불가 ${undecided}`);
console.log('═'.repeat(74));
const cleanOk = !started || (cleaned !== false && healthyAtEnd !== false);
process.exit(fail > 0 || !cleanOk ? 1 : (undecided > 0 || notReady ? 2 : 0));
