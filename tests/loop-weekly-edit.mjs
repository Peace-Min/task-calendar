#!/usr/bin/env node
/* =====================================================================================
 *  tests/loop-weekly-edit.mjs: 주간 보고서 글 편집 **실동작** 루프(docs/WEEKLY-EDIT.md §7)
 * -------------------------------------------------------------------------------------
 *  계약 시험(weekly-edit.test.mjs)은 jsdom 으로 규칙을 잠근다. 이 루프는 실제 위젯(Debug, TC_DEBUG_PORT)에 붙어
 *  로그인한 사용자 자신의 보고서 창 「주간 작성」에서 진짜 버튼을 누르고, 실제 WebView2 저장소에서 주간 임시 저장의 수명을 본다.
 *
 *  케이스:
 *    O0   전제: 로그인, conn ok, bootOk, 새 빌드(rptWOutFields 등), 지난 실행 잔재(2099 주간 키) 정리
 *    E1   주간 작성을 2099 시험 주로 연다: 글 편집(회사 폼 모양) 기본, 입력 칸은 진행사항과 차주계획뿐 → 카드로 바꿔 X, 날짜 줄 ✎ 없음
 *    E2   두 과제(A, B)에 시험 주 시간(앱 함수) → 카드의 "이번 주 n h"
 *    E3   X(B): 카드 제자리, 카드와 머리 높이 그대로, 키 tc_rptDraftW: 에 바로 저장
 *    E4   글 편집: 회사 폼 행과 순서, 읽기 전용 과제투입시간(B 빠짐, 합계 다시), 진행사항 상세 줄, 차주계획 → 저장(제목은 자동, 저장 안 함)
 *    E5   창 닫고 다시 열기, 다른 주로 바꾸기, 위젯 다시 읽기(reloadState) 뒤에도 그대로
 *    E6   채우기(가로채기): subject, endwork(&nbsp; 들여쓰기, B 없음), content(B 없음, 합계 3), planwork → 성공 회신 흉내 뒤에도 남음
 *    E7   출처 netcus 일간보고(가짜 병합 캐시, 실제 읽기 없음): 같은 이름 과제의 고친 글과 X 가 따라온다
 *    E8   보고서 묶음(docs/REPORT-GROUP.md): 설정 창에서 B 를 A 위로 끌어 넣기(PointerEvent) → A 카드 안의 작은 카드와 합계, 기간 키의 group, A 의 고친 진행사항은
 *         그대로 두고 낡은 초안 안내, 채우기(가로채기)의 content, planwork, endwork 에 B 머리 줄 없음 → 모두 초안으로가 묶음까지 지운다
 *    정리 2099 주간 키 삭제, 시험 주 시간 지우기(앱으로), 출처와 포함 항목 저장값 원복 → 다시 읽어 잔재 0
 *
 *  ★ 실제로 회사 화면을 채우지 않는다(두 겹): Platform.report.submitWeekly 를 가로채 payload 만 붙잡고,
 *    hpost 도 감싸 'netcus' 로 시작하는 명령은 호스트로 넘기지 않는다. netcus 일간보고도 읽지 않는다(병합 캐시를 페이지에 직접 넣는다).
 *  ★ 남기지 않는다: 시간은 2099-12-07 주에만 적고 finally 에서 앱으로 지운다. DB 에 직접 붙지 않는다.
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 로그인된 채 띄운 뒤
 *    node tests/loop-weekly-edit.mjs [--port=9222] [-v]
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
  console.log(`사용법: node tests/loop-weekly-edit.mjs [--port=${OPT.port}] [-v]`);
  process.exit(0);
}
//  시험 주 — 실데이터와 겹치지 않는 먼 미래(월요일 시작). 정리 뒤 이 날짜들에 시간이나 임시 저장이 남으면 실패다.
const W1 = ['2099-12-07', '2099-12-13'], W2 = ['2099-12-14', '2099-12-20'];
const W1D2 = '2099-12-08', W1D3 = '2099-12-09';
const ALLDAYS = [W1[0], W1D2, W1D3];
const NB = '&nbsp;';
//  제목은 고칠 수 없다(회사 폼처럼 기간에 따라 자동, 2026-10-08). 채우기 payload 의 제목은 앱의 weekSubjectGuess 와 같아야 한다.
const DETAIL = '• 루프 진행 상세\n    - 하위 한 줄\n    - 하위 두 줄';
const PLAN = '• 루프 다음 주 계획';

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

/* ── 페이지 기록기 + 채우기 차단 — 원본을 그대로 부르되 netcus 명령은 호스트로 넘기지 않는다 ── */
//  ★ finally 에서 반드시 원본으로 되돌린다. 차단은 두 겹: submitWeekly(와 submitDaily) 가로채기(payload 붙잡기) + hpost 의 netcus 명령 버리기.
const INSTALL = `(function(){
  if (window.__wkLoop) return 'already';
  const R = window.__wkLoop = { log: [], cap: [], blocked: [], orig: { hostRequest: hostRequest, hpost: hpost,
    applyState: window.__applyState, applyErr: window.__applyStateError, submitDaily: Platform.report.submitDaily, submitWeekly: Platform.report.submitWeekly } };
  hostRequest = function(cmd, params, t){
    const rec = { t: Date.now(), req: cmd };
    R.log.push(rec);
    return R.orig.hostRequest(cmd, params, t).then(function(res){ rec.done = Date.now(); rec.res = { ok: !!(res && res.ok) }; return res; });
  };
  hpost = function(o){ if (o && /^netcus/i.test(String(o.cmd || ''))) { R.blocked.push(String(o.cmd)); return; } return R.orig.hpost(o); };
  Platform.report.submitWeekly = function(p){ R.cap.push(JSON.parse(JSON.stringify(p))); };
  Platform.report.submitDaily = function(p){ R.blocked.push('submitDaily'); };
  window.__applyState = function(j, m){ R.log.push({ t: Date.now(), applied: true }); return R.orig.applyState(j, m); };
  window.__applyStateError = function(msg, opt){ R.log.push({ t: Date.now(), applyErr: String(msg) }); return R.orig.applyErr(msg, opt); };
  return 'ok';
})()`;
const UNINSTALL = `(function(){
  const R = window.__wkLoop; if (!R) return 'none';
  hostRequest = R.orig.hostRequest; hpost = R.orig.hpost;
  Platform.report.submitDaily = R.orig.submitDaily; Platform.report.submitWeekly = R.orig.submitWeekly;
  window.__applyState = R.orig.applyState; window.__applyStateError = R.orig.applyErr;
  delete window.__wkLoop; return 'ok';
})()`;
const mark = () => cdp.ev('__wkLoop.log.length');
const since = (m) => J(`__wkLoop.log.slice(${Number(m)})`);
const interceptOk = () => cdp.ev(`!!window.__wkLoop && Platform.report.submitWeekly !== window.__wkLoop.orig.submitWeekly && hpost !== window.__wkLoop.orig.hpost`);

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
//  보고서를 사람이 여는 문으로 열고 「주간 작성」 탭 → 시험 주(날짜 칸 change = 사람이 고른 것과 같은 처리기)
async function openWeeklyAt(mon) {
  if (await cdp.ev(isOpen('#reportModal'))) { await cdp.ev("closeModal('#reportModal'); 1"); await sleep(450); }
  await cdp.ev(`(function(){ const b = document.getElementById('btnReportTop'); if (b && b.offsetParent) b.click(); else openReport(); return 1; })()`);
  const opened = await waitFor(isOpen('#reportModal'), 3000, 100);
  await cdp.ev(`(function(){ const t = document.querySelector('#reportModal [data-rmode="weekly"]'); if (t) t.click(); else setReportMode('weekly'); return 1; })()`);
  //  포함 항목 셋, 빈 항목 제외 끔(행 = 모든 과제). 사용자 저장값(tc_rptSources)은 O0 에서 받아 두고 끝에 되돌린다.
  await cdp.ev(`(function(){ ['#rptSrcEvent','#rptSrcTodo','#rptSrcGit','#rptWithDesc'].forEach(function(s){ $(s).checked = true; }); $('#rptSkipEmpty').checked = false; return 1; })()`);
  await setWeek(mon);
  return opened;
}
const setWeek = async (mon) => { await cdp.ev(`(function(){ const f = $('#rptFrom'); f.value = ${JSON.stringify(mon)}; f.dispatchEvent(new Event('change')); return 1; })()`); await sleep(150); };
const stored = (from, to) => J(`(function(){ try { return JSON.parse(localStorage.getItem(rptWKey(${JSON.stringify(from)}, ${JSON.stringify(to)})) || 'null'); } catch (_) { return 'ERR'; } })()`);
const loopKeys = () => J(`(function(){ const pre = 'tc_rptDraftW:' + rptDraftWho() + ':2099-'; const a = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(pre) === 0) a.push(k); } return a; })()`);
const dropLoopKeys = () => cdp.ev(`(function(){ const pre = 'tc_rptDraftW:' + rptDraftWho() + ':2099-'; const a = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(pre) === 0) a.push(k); }
  a.forEach(function(k){ localStorage.removeItem(k); });
  [...__rptDraftMem.keys()].forEach(function(k){ if (k.indexOf(pre) === 0) { __rptDraftMem.delete(k); __rptDraftDirty.delete(k); __rptDraftFailed.delete(k); } });
  return a.length; })()`);
const cardsInfo = () => J(`[].map.call(document.querySelectorAll('#rptOut .rcard'), function(c){ return { k: c.dataset.wk, nm: (c.querySelector('.rcard-nm') || {}).textContent,
  out: c.classList.contains('rcard-out'), edited: !!c.querySelector('.rcard-edited'), wh: (c.querySelector('.rcard-wh') || {}).textContent || '',
  h: Math.round(c.getBoundingClientRect().height * 10) / 10, headH: Math.round(c.querySelector('.rcard-head').getBoundingClientRect().height * 10) / 10 }; })`);
const clickInCard = (k, sel) => cdp.ev(`(function(){ const c = [].find.call(document.querySelectorAll('#rptOut .rcard'), function(x){ return x.dataset.wk === ${JSON.stringify(k)}; });
  if (!c) return 'nocard'; const b = c.querySelector(${JSON.stringify(sel)}); if (!b) return 'nobtn'; b.click(); return 'ok'; })()`);
const setView = (v) => cdp.ev(`(function(){ const b = document.querySelector('#rptViewSeg [data-rview="${v}"]'); if (!b) return 'nobtn'; b.click(); return 'ok'; })()`);
const typeIn = (wsec, k, text) => cdp.ev(`(function(){ const t = [].find.call(document.querySelectorAll('#rptOut [data-wsec]'), function(x){ return (x.tagName === 'TEXTAREA' || x.tagName === 'INPUT') && x.dataset.wsec === ${JSON.stringify(wsec)} && (x.dataset.wk || '') === ${JSON.stringify(k || '')}; });
  if (!t) return 'nofield'; t.focus(); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
//  가로챈 채우기 — 가로채기가 없으면 누르지 않는다.
async function fillIntercepted() {
  if (!(await interceptOk())) throw new Error('채우기 가로채기가 제자리에 없다 — 실제 회사 화면 채우기 위험이라 누르지 않는다');
  const n0 = await cdp.ev('__wkLoop.cap.length');
  await cdp.ev(`document.getElementById('btnRptSend').click(); 1`);
  await waitFor(`__wkLoop.cap.length > ${n0}`, 4000, 100);
  await cdp.ev('clearTimeout(Netcus.watchdog); 1');
  return (await cdp.ev('__wkLoop.cap.length')) > n0 ? J('__wkLoop.cap[__wkLoop.cap.length - 1]') : null;
}

/* ── 본체 ─────────────────────────────────────────────────────────── */
console.log('═'.repeat(74));
console.log(`주간 보고서 글 편집 실동작 루프 — 포트 ${OPT.port}, 시험 주 ${W1[0]}~${W1[1]}, ${W2[0]}~${W2[1]}`);
console.log('═'.repeat(74));

let started = false, healthyAtEnd = null, cleaned = null, notReady = false;
let catA = null, catB = null, nameA = '', nameB = '', kA = '', kB = '';
let srcPrefs0 = undefined, srcState0 = 'cal';

async function main() {
  cdp = await Cdp.attach(OPT.port);

  head('O0 전제 — 로그인, 정상 연결, 새 빌드, 지난 실행 잔재 정리');
  if (await cdp.ev("typeof rptWOutFields !== 'function' || typeof rptWDocInput !== 'function' || typeof rptWDraftGet !== 'function'")) {
    notReady = true; undecide('O0 기능 존재', '위젯에 rptWOutFields 가 없다. 낡은 빌드다(dotnet build -c Debug 후 재시작)'); return;
  }
  const user = await cdp.ev("(typeof currentUser !== 'undefined' && currentUser && currentUser.loginId) || ''");
  if (!user) { notReady = true; undecide('O0 로그인', '위젯이 로그인 상태가 아니다'); return; }
  if (!(await waitFor(isHealthy, 30000))) {
    notReady = true; undecide('O0 정상 연결', '시작 상태가 정상이 아니다: ' + JSON.stringify(await J('({ conn: conn, bootOk: bootOk, unsaved: unsaved })'))); return;
  }
  ok('O0 로그인, conn ok, bootOk, 잠금 없음', !(await cdp.ev('editLocked()')), `login=${user}`);
  vlog('기록기:', await cdp.ev(INSTALL));
  ok('O0 채우기 가로채기(submitWeekly) + netcus 명령 차단(hpost) 설치', await interceptOk());
  await closeAll();
  srcPrefs0 = await cdp.ev(`(function(){ try { return localStorage.getItem('tc_rptSources'); } catch (_) { return null; } })()`);
  srcState0 = await cdp.ev('state.reportSource');
  started = true;
  const left0 = await dropLoopKeys();
  if (left0) note(`지난 실행의 2099 주간 임시 저장 키 ${left0}건을 지웠다`);
  const rows = await J(`collectReportData(${JSON.stringify(W1[0])}, ${JSON.stringify(W1[1])}, { event: true, todo: true, git: true, desc: true, skipEmpty: false }).rows.map(function(r){ return { key: r.key, name: r.name }; })`);
  if (!rows || rows.length < 2) { notReady = true; undecide('O0 과제 둘 이상', JSON.stringify(rows)); return; }
  [catA, catB] = [rows[0].key, rows[1].key]; [nameA, nameB] = [rows[0].name, rows[1].name];
  [kA, kB] = await J(`[rptWNameKey(${JSON.stringify(nameA)}), rptWNameKey(${JSON.stringify(nameB)})]`);
  if (kA === kB) { notReady = true; undecide('O0 앞 두 과제 이름이 정규화로 같다', `${nameA} / ${nameB}`); return; }

  head('E1 주간 작성을 시험 주로 연다: 글 편집(회사 폼) 기본 → 카드로 바꿔 X, 날짜 줄 ✎ 없음');
  ok('E1 보고서 창이 열렸다', await openWeeklyAt(W1[0]));
  ok('E1 주간, 시험 주', same(await J(`[reportMode, $('#rptFrom').value, $('#rptTo').value]`), ['weekly', W1[0], W1[1]]));
  ok('E1 기본 보기 = 글 편집(회사 폼), 보기 전환 줄이 보인다', same(await J(`[rptViewW, $('#rptViewBar').classList.contains('hidden'), !!document.querySelector('#rptOut .rwf')]`), ['doc', false, true]));
  ok('E1 회사 폼에 input 이 없고(제목, 세 칸은 입력 아님) 세 칸은 자리만', await cdp.ev(`document.querySelectorAll('#rptOut .rwf input').length === 0 && document.querySelectorAll('#rptOut .rwf-off').length === 3`));
  ok('E1 카드 보기로 바꿨다', (await setView('card')) === 'ok');
  await sleep(150);
  ok('E1 카드마다 X, 날짜 줄 ✎ 없음', await cdp.ev(`document.querySelectorAll('#rptOut .rcard-x').length === document.querySelectorAll('#rptOut .rcard').length && !document.querySelector('#rptOut [data-dnact]')`));

  head('E2 시간 — A 에 월 2 + 화 1, B 에 수 1.5(앱 함수 setTaskHours → 저장)');
  for (const [d, c, h] of [[W1[0], catA, 2], [W1D2, catA, 1], [W1D3, catB, 1.5]]) { await cdp.ev(`setTaskHours(${JSON.stringify(d)}, ${JSON.stringify(c)}, ${h}); 1`); await saveIdle(); }
  await cdp.ev('buildReport(); 1'); await sleep(150);
  const c2 = await cardsInfo();
  ok('E2 카드에 "이번 주 3 h"(A), "이번 주 1.5 h"(B)', (c2.find((x) => x.k === kA) || {}).wh === '이번 주 3 h' && (c2.find((x) => x.k === kB) || {}).wh === '이번 주 1.5 h', JSON.stringify(c2.slice(0, 2)));

  head('E3 X(B) — 제자리에 흐리게, 높이 그대로, 바로 저장');
  const before = await cardsInfo();
  ok('E3 X 를 눌렀다', (await clickInCard(kB, '.rcard-x')) === 'ok');
  await sleep(200);
  const after = await cardsInfo();
  ok('E3 카드 수, 순서 그대로', same(after.map((c) => c.k), before.map((c) => c.k)));
  const bB = before.find((c) => c.k === kB), aB = after.find((c) => c.k === kB);
  ok('E3 B 흐림, 카드와 머리 높이 그대로', aB && aB.out && Math.abs(aB.h - bB.h) < 0.6 && Math.abs(aB.headH - bB.headH) < 0.6, `전 ${bB.h}/${bB.headH} 뒤 ${aB && aB.h}/${aB && aB.headH}`);
  const s3 = await stored(W1[0], W1[1]);
  ok('E3 키 tc_rptDraftW:… 에 바로 저장(out 에 B)', s3 && s3.v === 1 && s3.out.includes(kB) && (await loopKeys()).length === 1, JSON.stringify(s3));

  head('E4 글 편집(회사 폼): 진행사항 상세 줄, 차주계획 → 잠시 뒤 저장');
  ok('E4 글 편집 보기로', (await setView('doc')) === 'ok');
  await sleep(150);
  ok('E4 회사 폼 행과 순서', same(await J(`[].map.call(document.querySelectorAll('#rptOut .rwf > .rwf-lab'), function(x){ return x.textContent; })`), ['기간', '제목', '진행사항', '과제투입시간', '미처리사항', '차주계획', '문제점 및 건의사항', '회의내용']));
  ok('E4 기간과 제목은 잠긴 자동 값', (await cdp.ev(`$('#rptOut .rwf-val[data-wrow="subject"] .rwf-box').textContent`)) === (await cdp.ev(`weekSubjectGuess(${JSON.stringify(W1[0])})`)));
  ok('E4 읽기 전용 과제투입시간에 B 가 없고 합계 3', (await cdp.ev(`$('#rptOut .rwd-hours').textContent`)).endsWith('합계 : 3') && !(await cdp.ev(`$('#rptOut .rwd-hours').textContent`)).includes(`[${nameB}]`));
  //  (제목 칸은 입력이 아니다)
  ok('E4 진행사항 입력', (await typeIn('prog', kA, DETAIL)) === 'ok');
  ok('E4 차주계획 입력', (await typeIn('plan', kA, PLAN)) === 'ok');
  await sleep(700);
  const s4 = await stored(W1[0], W1[1]);
  ok('E4 저장됐다(prog, plan, out, 제목 없음)', s4 && !('subject' in s4) && s4.prog[kA] === DETAIL && s4.plan[kA] === PLAN && s4.out.includes(kB), JSON.stringify(s4));
  ok('E4 "고친 과제 1개", "이 PC에 임시 저장됨"', await cdp.ev(`(function(){ const t = $('#rptEditInfo').textContent; return t.indexOf('고친 과제 1개') >= 0 && t.indexOf('이 PC에 임시 저장됨') >= 0; })()`));

  head('E5 창 닫고 다시 열기, 주 바꾸기, 다시 읽기(reloadState) 뒤에도 그대로');
  await closeAll();
  ok('E5 다시 열었다', await openWeeklyAt(W1[0]));
  const c5 = await cardsInfo();
  ok('E5 다시 열면 글 편집(회사 폼)으로', (await cdp.ev('rptViewW')) === 'doc');
  await setView('card'); await sleep(150);
  const c5b = await cardsInfo();
  ok('E5 B 는 뺐고 A 는 고침', (c5b.find((c) => c.k === kB) || {}).out === true && (c5b.find((c) => c.k === kA) || {}).edited === true);
  await setWeek(W2[0]);
  ok('E5 다른 주는 깨끗(렌더만으로 키가 생기지 않음)', (await cdp.ev(`!document.querySelector('#rptOut .rcard-out, #rptOut .rcard-edited')`)) && (await loopKeys()).length === 1);
  await setWeek(W1[0]);
  await closeAll();
  ok('E5 reloadState → 적용', (await reload()) === 'applied');
  ok('E5 다시 읽은 뒤에도 그대로', (await openWeeklyAt(W1[0])) && (await setView('card')) === 'ok' && (await sleep(150), true) && (await cdp.ev(`!!document.querySelector('#rptOut .rcard-out') && !!document.querySelector('#rptOut .rcard-edited')`)));

  head('E6 채우기(가로채기) — 네 칸 확인, 성공 회신 흉내 뒤에도 임시 저장이 남는다');
  const cap = await fillIntercepted();
  ok('E6 payload 를 붙잡았다(호스트로 나가지 않음)', !!cap);
  if (cap) {
    const f = cap.fields || {};
    ok('E6 subject = 자동 제목(고칠 수 없다)', f.subject === (await cdp.ev(`weekSubjectGuess(${JSON.stringify(W1[0])})`)), f.subject);
    ok('E6 endwork: A 상세 줄이 &nbsp; 들여쓰기, B 없음', String(f.endwork).startsWith(`[${nameA}]\n• 루프 진행 상세\n${NB.repeat(4)}- 하위 한 줄`) && !String(f.endwork).includes(`[${nameB}]`), JSON.stringify(String(f.endwork).slice(0, 160)));
    ok('E6 content: B 줄 없고 합계 3', !String(f.content).includes(`[${nameB}]`) && String(f.content).endsWith('합계 : 3'), f.content);
    ok('E6 planwork: A 계획, B 없음', String(f.planwork).startsWith(`[${nameA}]\n${PLAN}`) && !String(f.planwork).includes(`[${nameB}]`), f.planwork);
    ok('E6 기간 그대로', f.sdate === W1[0] && f.edate === W1[1]);
  }
  ok('E6 netcus 명령은 하나도 나가지 않았다', same(await J('__wkLoop.blocked'), []), JSON.stringify(await J('__wkLoop.blocked')));
  await cdp.ev(`window.__netcusResult(true, '주간보고 작성 폼을 채웠습니다 (루프 흉내, 실제 채우기 아님)'); 1`);
  await sleep(200);
  ok('E6 채우기 성공 회신 흉내 뒤에도 주간 임시 저장이 남는다', !!(await stored(W1[0], W1[1])));

  head('E7 출처 netcus 일간보고(가짜 병합 캐시) — 같은 이름 과제의 고친 글과 X 가 따라온다');
  await cdp.ev(`(function(){ netcusMerge = { key: ncMergeKey(${JSON.stringify(W1[0])}, ${JSON.stringify(W1[1])}),
    parsed: parseNetcusWeek([{ date: ${JSON.stringify(W1[0])}, content: ${JSON.stringify(`[${nameA}] : 2\n• 넷 원문\n[${nameB}]\n• 넷 B 원문`)}, ok: true }], state.categories, { sumTime: true }), at: '00:00' };
    state.reportSource = 'net'; syncReportSourceSeg(); buildReport(); return 1; })()`);
  await sleep(300);
  const c7 = await cardsInfo();
  ok('E7 net 카드에서 A 고침, B 뺌', (c7.find((c) => c.k === kA) || {}).edited === true && (c7.find((c) => c.k === kB) || {}).out === true, JSON.stringify(c7));
  const cap7 = await fillIntercepted();
  ok('E7 net 채우기 endwork 에 고친 글, B 없음', !!cap7 && String(cap7.fields.endwork).startsWith(`[${nameA}]\n• 루프 진행 상세`) && !String(cap7.fields.endwork).includes(`[${nameB}]`));
  await cdp.ev(`window.__netcusResult(true, '주간보고 작성 폼을 채웠습니다 (루프 흉내)'); state.reportSource = 'cal'; clearNetcusMerge(); syncReportSourceSeg(); buildReport(); 1`);   // 시험 동안은 cal(원래 출처는 정리에서 되돌린다)

  head('E8 보고서 묶음(REPORT-GROUP) — 설정 창에서 B 를 A 에 끌어 넣기: 합계, 차주계획, 낡은 초안 안내, 채우기(가로채기), 모두 초안으로');
  ok('E8 시험 주로 다시 열었다', await openWeeklyAt(W1[0]));
  await setView('card'); await sleep(150);
  ok('E8 B 되돌리기(E3 의 X)', (await clickInCard(kB, '.rcard-back')) === 'ok');
  await sleep(150);
  await cdp.ev(`(function(){ const b = document.getElementById('rptGroupOpen'); b.focus(); b.click(); return 1; })()`);
  ok('E8 설정 창이 열렸다', await waitFor(isOpen('#rptGroupModal'), 3000, 100));
  await sleep(250);
  ok('E8 열면 목록의 첫 버튼에 포커스', await cdp.ev(`document.activeElement === document.querySelector('#rgmRows button')`));
  //  끌어 넣기(진짜 PointerEvent): B 를 A 묶음 위로. 주간 키는 이름 키(kA, kB)
  const d8 = await dragRow(kB, kA);
  ok('E8 끄는 동안 그림자와 A 묶음 점선 강조, 놓은 뒤 그림자 없음', !!d8 && d8.ghost === true && d8.lit === true && d8.left === false, JSON.stringify(d8));
  await sleep(200);
  ok('E8 B 는 A 묶음 안의 들여 쓴 줄(X "꺼내기" 있음)', await cdp.ev(`(function(){ const g = rgmFind('grp', ${JSON.stringify(kA)}), b = rgmFind('gk', ${JSON.stringify(kB)}), x = rgmFind('gout', ${JSON.stringify(kB)});
    return !!g && !!b && b.classList.contains('kid') && b.parentElement === g && !!x && x.getAttribute('title') === '꺼내기'; })()`));
  ok('E8 A 줄은 이번 주 합친 시간(4.5시간)', await cdp.ev(`(rgmFind('gk', ${JSON.stringify(kA)}).querySelector('.rgm-meta') || {}).textContent`).then((t) => String(t || '').endsWith('4.5시간')));
  await cdp.ev(`document.querySelector('#rptGroupModal [data-close]').click(); 1`);
  ok('E8 닫았다, 포커스는 "설정" 으로', (await waitFor(`document.getElementById('rptGroupModal').classList.contains('hidden')`, 3000, 100)) && (await sleep(250), await cdp.ev(`document.activeElement === document.getElementById('rptGroupOpen')`)));
  const c8 = await cardsInfo();
  ok('E8 B 는 A 카드 안(머리 카드 아님), A 합계 4.5 h', await cdp.ev(`(function(){ const a = [].find.call(document.querySelectorAll('#rptOut > .rcard'), function(c){ return c.dataset.wk === ${JSON.stringify(kA)}; });
    const sub = a && a.querySelector('.rcard-subs > .rcard'); const g = a && a.querySelector('.rcard-gsum');
    return !!sub && sub.dataset.wk === ${JSON.stringify(kB)} && !!g && g.textContent === '합계 4.5 h' && ![].some.call(document.querySelectorAll('#rptOut > .rcard'), function(c){ return c.dataset.wk === ${JSON.stringify(kB)}; }); })()`), JSON.stringify(c8.slice(0, 3)));
  const s8 = await stored(W1[0], W1[1]);
  ok('E8 기간 키에 묶음이 저장됐다', !!s8 && s8.group && s8.group[kB] === kA, JSON.stringify(s8 && s8.group));
  ok('E8 글 편집: A 진행사항은 고친 글 그대로, 낡은 초안 안내가 뜬다', (await setView('doc')) === 'ok' && (await sleep(150), await cdp.ev(`(function(){ const s = [].find.call(document.querySelectorAll('#rptOut .rdoc-sec'), function(x){ return x.dataset.wsec === 'prog' && x.dataset.wk === ${JSON.stringify(kA)}; });
    return !!s && !s.querySelector('.rdoc-stale').hidden && s.querySelector('.rdoc-ta').value === ${JSON.stringify(DETAIL)}; })()`)));
  const cap8 = await fillIntercepted();
  ok('E8 채우기 payload 를 붙잡았다', !!cap8);
  if (cap8) {
    const f = cap8.fields || {};
    ok('E8 content: A 4.5, B 줄 없음, 합계 4.5', String(f.content).includes(`[${nameA}] : 4.5`) && !String(f.content).includes(`[${nameB}]`) && String(f.content).endsWith('합계 : 4.5'), f.content);
    ok('E8 planwork 와 endwork 에 B 머리 줄 없음', !String(f.planwork).includes(`[${nameB}]`) && !String(f.endwork).includes(`[${nameB}]`));
  }
  ok('E8 netcus 명령은 하나도 나가지 않았다', same(await J('__wkLoop.blocked'), []));
  await cdp.ev(`window.__netcusResult(true, '주간보고 작성 폼을 채웠습니다 (루프 흉내)'); 1`);
  await cdp.ev(`document.querySelector('#rptOut .rdoc-resetall').click(); 1`);
  ok('E8 모두 초안으로 확인창(문구에 "묶음")', (await waitFor(isOpen('#confirmModal'), 4000, 100)) && (await cdp.ev(`document.getElementById('cfMsg').textContent.indexOf('묶음') >= 0`)));
  await cdp.ev(`document.getElementById('cfOk').click(); 1`);
  await waitFor(`document.getElementById('confirmModal').classList.contains('hidden')`, 3000, 100);
  await sleep(200);
  ok('E8 모두 초안으로 → 기간 키(묶음 포함)가 지워졌다', (await stored(W1[0], W1[1])) === null && (await cdp.ev(`$('#rptGroupSum').textContent === '묶은 과제 없음'`)));
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
  //  ★ 무슨 일이 있어도: 2099 주간 키를 지우고, 시험 주의 시간을 앱으로 지우고, 출처와 포함 항목 저장값을 되돌린 뒤 다시 읽어 잔재 0 을 본다.
  if (cdp && started) {
    head('정리 — 2099 주간 키, 시험 주 시간, 출처, 포함 항목 · 다시 읽어 잔재 0');
    try {
      //  출처는 시작할 때 받아 둔 값(srcState0) 그대로 되돌린다(보고서는 닫힌 채라 다시 그리지 않는다, netcus 읽기도 일어나지 않는다).
      await cdp.ev(`clearTimeout(Netcus.watchdog); clearNetcusMerge(); state.reportSource = ${JSON.stringify(srcState0)}; syncReportSourceSeg(); 1`).catch(() => 0);
      await closeAll();
      await dropLoopKeys();
      if (srcPrefs0 !== undefined) await cdp.ev(`(function(){ try { const v = ${JSON.stringify(srcPrefs0)}; if (v == null) localStorage.removeItem('tc_rptSources'); else localStorage.setItem('tc_rptSources', v); } catch (_) {} return 1; })()`);
      healthyAtEnd = await waitFor(isHealthy, 30000, 300);
      if (!healthyAtEnd) { await cdp.ev(`hpost({ cmd: 'reloadState' }); 1`).catch(() => 0); healthyAtEnd = await waitFor(isHealthy, 20000, 300); }
      if (healthyAtEnd) {
        for (const c of [catA, catB].filter(Boolean)) for (const d of ALLDAYS) { await cdp.ev(`setTaskHours(${JSON.stringify(d)}, ${JSON.stringify(c)}, 0); 1`); await saveIdle(); }
        const r = await reload();
        const hoursLeft = await J(`(function(){ const m = (state.taskHours || {}); return ${JSON.stringify(ALLDAYS)}.filter(function(d){ return m[d] && Object.keys(m[d]).length; }); })()`);
        const keysLeft = await loopKeys();
        cleaned = r === 'applied' && hoursLeft.length === 0 && keysLeft.length === 0;
        ok('정리: 다시 읽은 뒤 2099 시간, 주간 임시 저장 키 잔재 0', cleaned, JSON.stringify({ r, hoursLeft, keysLeft }));
        healthyAtEnd = await waitFor(isHealthy, 5000);
      } else cleaned = false;
    } catch (e) { cleaned = false; F.push('정리 중 예외: ' + e.message); fail++; }
  }
  if (cdp) { try { await cdp.ev(UNINSTALL); } catch (_) { } cdp.close(); }
}

const secs = ((Date.now() - T0) / 1000).toFixed(1);
console.log('\n' + '═'.repeat(74));
console.log(`주간 보고서 글 편집 루프 요약 — 소요 ${secs}s`);
if (F.length) { console.log(`실패 ${F.length}건:`); F.forEach((f) => console.log('  ✗ ' + f)); }
if (UD.length) { console.log(`판정 불가 ${UD.length}건:`); UD.forEach((f) => console.log('  ? ' + f)); }
if (started && healthyAtEnd === false) console.log('\n★★ 경고: 끝날 때 위젯이 정상으로 돌아오지 않았다. 화면을 확인하고 필요하면 재시작하세요.');
if (started && cleaned === false) console.log(`\n★★★ 경고: 시험 잔재를 다 지우지 못했다. ${W1[0]}~${W2[1]} 의 과제 시간과 localStorage 의 tc_rptDraftW:*:2099-* 키를 확인하세요.`);
console.log(`재현: node tests/loop-weekly-edit.mjs --port=${OPT.port}`);
console.log(`\n통과 ${pass} · 실패 ${fail} · 판정 불가 ${undecided}`);
console.log('═'.repeat(74));
const cleanOk = !started || (cleaned !== false && healthyAtEnd !== false);
process.exit(fail > 0 || !cleanOk ? 1 : (undecided > 0 || notReady ? 2 : 0));
