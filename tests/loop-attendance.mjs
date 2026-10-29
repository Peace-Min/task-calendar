#!/usr/bin/env node
/* =====================================================================================
 *  tests/loop-attendance.mjs: 근태 탭과 근태 보고 창 **실동작** 루프(docs/ATTENDANCE-PLAN.md §5 실제 위젯 QA)
 * -------------------------------------------------------------------------------------
 *  계약 시험(attendance-web.test.mjs, attendance-host)은 jsdom 과 정적 검사로 규칙을 잠근다. 이 루프는 실제 위젯(Debug, TC_DEBUG_PORT)에 붙어
 *  메인 창의 근태 탭과, 따로 뜨는 근태 창(같은 HTML 의 ?win=attend, CDP 의 두 번째 page 대상)을 함께 다룬다.
 *
 *  케이스:
 *    O0   전제: 로그인, conn ok, bootOk, 새 빌드(atOpen, ATTENDWIN), 지난 실행 잔재(tc_attDraft:*:2099-* 키, 떠 있는 근태 창) 정리
 *    A1   근태 탭: pcSetTab('attend') 로 달력이 보이고, 이번 달을 실제 reportDailyList 로 읽어 그린다(읽기만). 미보고 표시는 없다
 *    A2   열기: 근태 달력을 2099-12 로 옮겨 2099-12-02 칸을 누른다. 근태 창 대상이 뜨고 제목과 머리가 근태 보고와 그 날짜,
 *         보고 화면이 보이고, 내 달력은 부팅하지 않았다
 *    A3   가져오기 패널: payload 과제가 있고, 옵션은 패널만 바꾸고, 불러오기가 왼쪽을 채우고, 고친 뒤 불러오기도 묻지 않고 바로 바꾼다.
 *         근태에 미기록이 없고, 회사 달력 표시 미리 보기가 없다
 *    A3b  가져오기 캘린더(다른 날짜 = 오늘): attendSourceReq, 호스트, 메인 창 __attendSourceFor, attendSourcePush, 근태 창 __attendSource 중계로
 *         메인 창이 만든 그날 기록이 오고 카드와 불러오기가 그 기록이다
 *    A3c  가져오기 근태관리(어제): netcusWeekMerge 로 회사 근태관리 일간보고를 읽기만 한다(오류 없음, 글이면 머리 줄 카드, 읽는 동안 보내기 잠금)
 *    A4   임시 저장: 입력 뒤 2초 안에 tc_attDraft:<who>:2099-12-02 가 근태 창 저장소에 생기고 메인 창에서도 보인다(같은 출처).
 *         메인 근태 달력의 그 칸에 ✎ 작성 중
 *    A5   닫기 지키기: __winCloseRequest() = 'ask' 와 묻는 창. 계속 쓰기면 남고, 닫기면 창이 닫힌다(키는 남는다).
 *         다시 열면 되살림 안내와 글, 버리고 처음 상태로는 키를 지운다
 *    A6   날짜 이동: › 가 호스트와 메인 창을 거쳐 같은 창에 2099-12-03 으로 돌아온다. 넘기기 전에 12-02 글을 바로 임시 저장한다
 *    A7   보내기(가로채기, 실제 전송 없음): payload(kind, date, &nbsp; 들여쓰기, 머리 줄 시간, status 코드), 잠금, 연속 클릭 한 번,
 *         실패 회신 흉내 = 공통 안내와 창, 키 유지. 다시 보내고 __reportDailySaved 와 성공 회신 흉내 = 키 삭제, 창은 남고 쓰기 화면에 보낸 글,
 *         고친 것이 없으니 닫기로 창 닫힘
 *    A8   메인 창 무시: 보고서 창이 보내지 않았을 때 __netcusResult 와 __netcusProgress 는 #rptSendStatus 와 토스트를 건드리지 않는다
 *    A9   보고한 날: 이 달에 앱으로 보고한 날(DB, 읽기만)을 열면 바로 쓰기 화면에 DB 와 같은 글이 뜨고, 고치지 않았으면 Esc 로 닫힌다. 없으면 건너뛴다
 *    정리 두 창의 2099 임시 저장 키 삭제, 근태 창 닫기, 탭과 탭 기억 되돌리기, 잔재 0 확인
 *
 *  ★ 실제로 회사에 보내지 않는다(두 겹, loop-report-edit 와 같은 방식): 근태 창의 Platform.report.submitDaily 를 가로채 payload 만 붙잡고,
 *    두 창의 hpost 를 감싸 'netcus' 로 시작하는 명령은 호스트로 넘기지 않고 기록만 한다. 회신은 __netcusResult 를 직접 불러 흉내 낸다.
 *    예외는 근태 창의 netcusWeekMerge 하나다: 회사 근태관리를 읽기만 하는 명령이라 통과시킨다(A3c).
 *    __reportDailySaved 흉내는 근태 창에서만 부른다(메인 창에서 부르면 개인 캘린더의 근태를 고쳐 DB 에 쓴다).
 *  ★ DB 에 쓰지 않는다. 읽는 것은 reportDailyList(이번 달, 2099 날짜)뿐이다. 시험 날짜는 2099-12-02, 2099-12-03(가져오기는 오늘).
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 로그인된 채 띄운 뒤
 *    node tests/loop-attendance.mjs [--port=9222] [-v]
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
  console.log(`사용법: node tests/loop-attendance.mjs [--port=${OPT.port}] [-v]`);
  process.exit(0);
}
const D = '2099-12-02', D2 = '2099-12-03';
const LAB = { [D]: '2099년 12월 2일 (수)', [D2]: '2099년 12월 3일 (목)' };
const FAIL_MSG = '처리를 완료하지 못했습니다. 다시 시도해 주세요.';
//  보낼 글: 머리 줄 두 형식(`[이름] : h`, `[이름] h`), 범위 밖 시간(30), 들여 쓴 줄
const SEND_TEXT = '[루프 과제 가] : 2.5\n- 시험 줄\n  - 하위 줄\n    - 더 하위 줄\n[루프 과제 나] 3\n- 둘째 과제 줄\n[루프 과제 다] : 30\n- 범위 밖 시간';
const SEND_CONTENT = SEND_TEXT.split('\n').map((l) => { const n = /^ */.exec(l)[0].length; return '&nbsp;'.repeat(n) + l.slice(n); }).join('\n');
const SEND_HOURS = [{ name: '루프 과제 가', hours: 2.5 }, { name: '루프 과제 나', hours: 3 }];

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   >', ...a); };

let pass = 0, fail = 0, undecided = 0;
const F = [], UD = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`${el()}   ✓ ${n}${d && OPT.verbose ? ' : ' + d : ''}`); return true; }
  fail++; F.push(n + (d ? ' : ' + d : ''));
  console.log(`${el()}   ✗ ${n}${d ? ' : ' + String(d).slice(0, 300) : ''}`); return false;
};
const undecide = (n, d = '') => { undecided++; UD.push(n + (d ? ' : ' + d : '')); console.log(`${el()}   ? ${n}, 판정 불가${d ? ': ' + d : ''}`); };
const note = (m) => console.log(`${el()}   > ${m}`);
const head = (m) => console.log(`\n${el()} [${m}]`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── 최소 CDP(대상 하나에 붙는다. 대상이 닫히면 기다리던 호출을 바로 실패시킨다) ── */
const isMainUrl = (u) => /tcapp\.local/i.test(u || '') && !/peer(win)?=1/.test(u || '') && !/[?&]win=/.test(u || '');
const isAttendUrl = (u) => /tcapp\.local/i.test(u || '') && /[?&]win=attend\b/.test(u || '');
async function pageTargets() {
  const list = await (await fetch(`http://127.0.0.1:${OPT.port}/json`, { signal: AbortSignal.timeout(4000) })).json();
  return (Array.isArray(list) ? list : []).filter((x) => x.type === 'page' && x.webSocketDebuggerUrl);
}
class Cdp {
  #ws = null; #id = 0; #p = new Map();
  closed = false; targetId = '';
  static async attach(t) {
    const c = new Cdp(); c.targetId = t.id;
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
    ws.addEventListener('close', () => {
      c.closed = true;
      for (const [, p] of c.#p) { clearTimeout(p.to); p.rej(new Error('대상이 닫혔다')); }
      c.#p.clear();
    });
    return c;
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('대상이 닫혔다'));
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
  J(expr) { return this.ev(`Promise.resolve(${expr}).then(function(v){ return JSON.stringify(v); })`).then((s) => (s == null ? null : JSON.parse(s))); }
  async waitFor(expr, ms, every = 200) {
    const t = Date.now();
    for (;;) {
      let v = false;
      try { v = await this.ev(`!!(${expr})`); } catch (_) { v = false; }
      if (v) return true;
      if (this.closed || Date.now() - t >= ms) return false;
      await sleep(every);
    }
  }
  close() { try { this.#ws.close(); } catch { } }
}

let M = null;   // 메인 창
let A = null;   // 근태 창(열릴 때마다 새로 붙는다)

async function attendTargets() { try { return (await pageTargets()).filter((x) => isAttendUrl(x.url)); } catch (_) { return []; } }
//  근태 창 대상이 뜰 때까지(gone 이면 사라질 때까지) 기다린다
async function waitAttendTarget({ timeout = 20000, gone = false } = {}) {
  const t0 = Date.now();
  for (;;) {
    const L = await attendTargets();
    if (gone ? !L.length : L.length) return gone ? true : L[0];
    if (Date.now() - t0 > timeout) return gone ? false : null;
    await sleep(200);
  }
}
//  근태 창에 붙는다(이미 같은 대상에 붙어 있으면 그대로). 웹이 그 날짜로 보고 화면을 열 때까지 기다린다.
async function attachAttend(date, timeout = 20000) {
  const t = await waitAttendTarget({ timeout });
  if (!t) return null;
  if (!A || A.closed || A.targetId !== t.id) { if (A) A.close(); A = await Cdp.attach(t); }
  const ready = await A.waitFor(`typeof ATE === 'object' && ATE.date === ${JSON.stringify(date)} && !ATE.navPending && !document.getElementById('atEd').classList.contains('busy')`, timeout);
  return ready ? t : null;
}

/* ── 기록기와 전송 차단 ──
 *  메인 창: hostRequest 를 감싸 명령, 기간, 성공 여부를 기록. hpost 의 netcus 명령은 넘기지 않는다. 보고서 전송도 붙잡는다. 토스트 기록.
 *  근태 창: hpost 를 감싸 모든 명령을 기록하고 netcus 명령은 넘기지 않는다. submitDaily 는 payload 만 붙잡는다. 토스트 기록.
 *  ★ finally 에서 원본으로 되돌린다(근태 창은 닫히면 함께 사라진다). */
const INSTALL_M = `(function(){
  if (window.__atLoop) return 'already';
  const R = window.__atLoop = { log: [], blocked: [], orig: { hostRequest: hostRequest, toast: toast, hpost: hpost,
    submitDaily: Platform.report.submitDaily, submitWeekly: Platform.report.submitWeekly } };
  hostRequest = function(cmd, params, t){
    const rec = { t: Date.now(), req: cmd, from: params && params.from, to: params && params.to, date: params && params.payload && params.payload.date, refresh: !!(params && params.payload && params.payload.refresh) };
    R.log.push(rec);
    return R.orig.hostRequest(cmd, params, t).then(function(res){ rec.done = Date.now(); rec.ok = !!(res && res.ok); rec.n = res && Array.isArray(res.rows) ? res.rows.length : null; return res; });
  };
  toast = function(m, k, a, ms){ R.log.push({ t: Date.now(), toast: String(m), kind: k }); return R.orig.toast(m, k, a, ms); };
  hpost = function(o){ if (o && /^netcus/i.test(String(o.cmd || ''))) { R.blocked.push(String(o.cmd)); return; } return R.orig.hpost(o); };
  Platform.report.submitDaily = function(p){ R.blocked.push('submitDaily(main)'); };
  Platform.report.submitWeekly = function(p){ R.blocked.push('submitWeekly(main)'); };
  return 'ok';
})()`;
const UNINSTALL_M = `(function(){
  const R = window.__atLoop; if (!R) return 'none';
  hostRequest = R.orig.hostRequest; toast = R.orig.toast; hpost = R.orig.hpost;
  Platform.report.submitDaily = R.orig.submitDaily; Platform.report.submitWeekly = R.orig.submitWeekly;
  delete window.__atLoop; return 'ok';
})()`;
const INSTALL_A = `(function(){
  if (window.__atLoopW) return 'already';
  const R = window.__atLoopW = { posts: [], blocked: [], cap: [], toasts: [], orig: { hpost: hpost, toast: toast, submitDaily: Platform.report.submitDaily } };
  hpost = function(o){ const c = String((o && o.cmd) || ''); R.posts.push({ t: Date.now(), cmd: c, date: o && o.date, refresh: o && o.refresh });
    if (/^netcus/i.test(c) && c !== 'netcusWeekMerge') { R.blocked.push(c); return; } return R.orig.hpost(o); };   // 근태관리 읽기(netcusWeekMerge)만 통과
  toast = function(m, k, a, ms){ R.toasts.push({ t: Date.now(), toast: String(m), kind: k }); return R.orig.toast(m, k, a, ms); };
  Platform.report.submitDaily = function(p){ R.cap.push(JSON.parse(JSON.stringify(p))); };
  return 'ok';
})()`;
const interceptOkA = () => A.ev(`!!window.__atLoopW && Platform.report.submitDaily !== window.__atLoopW.orig.submitDaily && hpost !== window.__atLoopW.orig.hpost`);
const markM = () => M.ev('__atLoop.log.length');
const sinceM = (m) => M.J(`__atLoop.log.slice(${Number(m)})`);

/* ── 앱 조작 ── */
const isHealthy = 'conn === "ok" && bootOk === true && !unsaved && !document.getElementById("dsError") && !document.getElementById("dbUnsaved")';
const keyIn = (C, date) => C.ev(`attDraftKey(${JSON.stringify(date)})`);
const storedIn = (C, key) => C.J(`(function(){ try { return JSON.parse(localStorage.getItem(${JSON.stringify(key)}) || 'null'); } catch (_) { return 'ERR'; } })()`);
//  이 루프가 만들 수 있는 키 = tc_attDraft:<누구든>:2099-*
const LOOP_KEYS_JS = `(function(){ const a = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('tc_attDraft:') === 0 && k.indexOf(':2099-') > 0) a.push(k); } return a; })()`;
const loopKeys = (C) => C.J(LOOP_KEYS_JS);
const dropLoopKeys = (C) => C.ev(`(function(){ const a = ${LOOP_KEYS_JS}; a.forEach(function(k){ localStorage.removeItem(k); });
  if (typeof __attDraftMem !== 'undefined') [...__attDraftMem.keys()].forEach(function(k){ if (k.indexOf(':2099-') > 0) __attDraftMem.delete(k); });
  return a.length; })()`);
//  근태 창 안에서 글 칸에 쓴다(실제 input 처리기)
const typeText = (text) => A.ev(`(function(){ const t = document.getElementById('atText'); t.focus(); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
const setSel = (id, v) => A.ev(`(function(){ const s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
const click = (C, id) => C.ev(`(function(){ const b = document.getElementById(${JSON.stringify(id)}); if (!b) return 'none'; if (b.disabled) return 'disabled'; b.click(); return 'ok'; })()`);
const shown = (C, id) => C.ev(`(function(){ const e = document.getElementById(${JSON.stringify(id)}); if (!e || e.classList.contains('hidden')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
//  근태 창을 강제로 닫는다(정리, 전제). 보내는 중 표지와 글을 내려 놓고 window.close(). 임시 저장을 다시 쓰지 않게 ATE.p 를 비운다.
async function forceCloseAttend() {
  const t = (await attendTargets())[0];
  if (!t) return true;
  try {
    if (!A || A.closed || A.targetId !== t.id) { if (A) A.close(); A = await Cdp.attach(t); }
    await A.ev(`(function(){ try { ATE.armed = false; ATE.sending = false; clearTimeout(ATE.wd); clearTimeout(ATE.timer); ATE.timer = null; atAskHide(); ATE.p = null; } catch (_) {}
      ${LOOP_KEYS_JS}.forEach(function(k){ localStorage.removeItem(k); }); try { window.close(); } catch (_) {} return 1; })()`).catch(() => 0);
  } catch (_) { /* 붙지 못했다 */ }
  return await waitAttendTarget({ gone: true, timeout: 8000 });
}

/* ── 본체 ── */
console.log('═'.repeat(74));
console.log(`근태 탭과 근태 보고 창 실동작 루프, 포트 ${OPT.port}, 시험 날짜 ${D}, ${D2}`);
console.log('═'.repeat(74));

let started = false, healthyAtEnd = null, cleaned = null, notReady = false;
let tab0 = 'personal', pcalKey = '', pcalRaw0 = undefined;

async function main() {
  let mt;
  try { mt = (await pageTargets()).find((x) => isMainUrl(x.url)); }
  catch (e) { throw new Error(`CDP 에 붙지 못했다(포트 ${OPT.port}). 위젯을 TC_DEBUG_PORT=${OPT.port} 로 띄웠나요? (${e.message})`); }
  if (!mt) throw new Error(`메인 창 page 대상이 없습니다(포트 ${OPT.port})`);
  M = await Cdp.attach(mt);

  /* ── O0 전제 ── */
  head('O0 전제: 로그인, 정상 연결, 새 빌드, 지난 실행 잔재 정리');
  if (await M.ev("typeof atOpen !== 'function' || typeof ATTENDWIN === 'undefined' || typeof atEdOpen !== 'function' || typeof window.__attendNavFromWin !== 'function' || !document.getElementById('pcTabAttend')")) {
    notReady = true; undecide('O0 기능 존재', '위젯에 atOpen, ATTENDWIN, #pcTabAttend 가 없다. 낡은 빌드다(빌드 후 재시작)'); return;
  }
  const user = await M.ev("(typeof currentUser !== 'undefined' && currentUser && currentUser.loginId) || ''");
  if (!user) { notReady = true; undecide('O0 로그인', '위젯이 로그인 상태가 아니다'); return; }
  if (!(await M.waitFor(isHealthy, 30000, 250))) {
    notReady = true; undecide('O0 정상 연결', '시작 상태가 정상이 아니다: ' + JSON.stringify(await M.J('({ conn: conn, bootOk: bootOk, unsaved: unsaved })'))); return;
  }
  ok('O0 로그인, conn ok, bootOk, 메인 창은 근태 창이 아니다', (await M.ev('ATTENDWIN')) === false, `login=${user}`);
  tab0 = await M.ev('PCAL.tab');
  pcalKey = await M.ev('pcPrefsKey()');
  pcalRaw0 = await M.ev(`(function(){ try { return localStorage.getItem(${JSON.stringify(pcalKey)}); } catch (_) { return null; } })()`);
  vlog('기록기:', await M.ev(INSTALL_M));
  ok('O0 메인 창 netcus 명령 차단(hpost)과 보고서 전송 가로채기 설치', await M.ev(`!!window.__atLoop && hpost !== window.__atLoop.orig.hpost`));
  started = true;
  if ((await attendTargets()).length) {
    note('지난 실행의 근태 창이 떠 있어 닫는다');
    ok('O0 떠 있던 근태 창을 닫았다', await forceCloseAttend());
  }
  const left0 = await dropLoopKeys(M);
  if (left0) note(`지난 실행의 2099 임시 저장 키 ${left0}건을 지웠다`);
  ok('O0 잔재 없음(근태 창 없음, 2099 키 없음)', !(await attendTargets()).length && !(await loopKeys(M)).length);

  /* ── A1 근태 탭 ── */
  head('A1 근태 탭: 달력이 보이고 이번 달을 실제로 읽어 그린다, 미보고 표시 없음');
  const m1 = await markM();
  await M.ev(`pcSetTab('attend', { force: true }); 1`);   // 위젯이 근태 탭을 기억해 근태 탭으로 떴어도 이번 달을 다시 읽게 한다
  ok('A1 탭 상태(at-on, 근태 탭 선택, 개인 달력 숨김)', await M.ev(`PCAL.tab === 'attend' && document.body.classList.contains('at-on') && document.getElementById('pcTabAttend').getAttribute('aria-selected') === 'true'
    && getComputedStyle(document.querySelector('main > .cal')).display === 'none'`));
  ok('A1 근태 화면(#atView, #atMonth)이 보이고 보고 화면은 숨김', (await shown(M, 'atView')) && (await shown(M, 'atMonth')) && !(await shown(M, 'atEd')));
  const loaded1 = await M.waitFor(`!ATT.loading && !!ATT.from`, 15000);
  const R1 = await M.J(`(function(){ const R = pcMonthRange(todayYmd()); return { from: R.from, to: R.to, weeks: R.weeks, y: R.y, m: R.m }; })()`);
  const L1 = (await sinceM(m1)).filter((x) => x.req === 'reportDailyList');
  ok('A1 reportDailyList 를 이번 달 범위로 실제로 읽었다(성공 회신)', loaded1 && L1.some((x) => x.from === R1.from && x.to === R1.to && x.ok === true), JSON.stringify(L1));
  const st1 = await M.J(`({ err: ATT.err, from: ATT.from, to: ATT.to, rows: ATT.rows.size, cells: document.querySelectorAll('#atGrid .at-day').length,
    has: document.querySelectorAll('#atGrid .at-day[data-has]').length, range: (document.querySelector('#atMonth .at-range') || {}).textContent,
    sum: (document.getElementById('atSum') || {}).textContent, text: document.getElementById('atMonth').textContent })`);
  ok('A1 읽기 오류 없음, 읽은 범위 = 이번 달 격자', st1.err === '' && st1.from === R1.from && st1.to === R1.to, JSON.stringify({ err: st1.err, from: st1.from, to: st1.to }));
  ok('A1 격자 칸 수 = 주 수 x 7, 머리에 이번 달', st1.cells === R1.weeks * 7 && st1.range === `${R1.y}년 ${R1.m + 1}월`, `${st1.cells}칸 ${st1.range}`);
  ok('A1 보고 표시 칸 수 = 읽은 행 수', st1.has === st1.rows, `칸 ${st1.has}, 행 ${st1.rows}(${L1.map((x) => x.n).join(',')})`);
  ok('A1 요약 줄(앱으로 보고 n일, 초과 합계)', /이 달 앱으로 보고 \d+일/.test(st1.sum || '') && /초과 합계 \d+시간/.test(st1.sum || ''), st1.sum);
  ok('A1 미보고 표시는 없다', !/미보고/.test(st1.text || ''));

  /* ── A2 열기 ── */
  head('A2 열기: 2099-12 로 옮겨 2099-12-02 칸을 누른다, 근태 창이 그 날짜로 뜬다');
  await M.ev(`(async function(){ ATT.anchor = '2099-12-01'; await atLoadMonth(); return 1; })()`);
  ok('A2 근태 달력이 2099년 12월(읽기 성공)', await M.ev(`ATT.err === '' && ATT.from <= ${JSON.stringify(D)} && ATT.to >= ${JSON.stringify(D2)} && !!document.querySelector('#atGrid .at-day[data-date="${D}"]')`));
  const m2 = await markM();
  const c2 = await M.ev(`(function(){ const c = document.querySelector('#atGrid .at-day[data-date="${D}"]'); if (!c) return 'nocell'; c.click(); return 'ok'; })()`);
  ok('A2 2099-12-02 칸을 눌렀다(칸 클릭 처리기 = atOpen)', c2 === 'ok', c2);
  const t2 = await attachAttend(D, 20000);
  ok('A2 근태 창 대상(?win=attend)이 떴고 그 날짜로 열렸다', !!t2, t2 ? t2.url : JSON.stringify((await pageTargets()).map((x) => x.url)));
  if (!t2) { notReady = true; undecide('A2 이후', '근태 창에 붙지 못해 나머지를 증명하지 못한다'); return; }
  const L2 = await sinceM(m2);
  ok('A2 메인 창이 attendOpen 을 보냈고 성공 회신', L2.some((x) => x.req === 'attendOpen' && x.date === D && !x.refresh && x.ok === true), JSON.stringify(L2.map((x) => [x.req, x.date || x.from, x.ok])));
  vlog('근태 창 기록기:', await A.ev(INSTALL_A));
  const w2 = await A.J(`({ aw: ATTENDWIN, title: document.title, h: (document.getElementById('atEdTitle') || {}).textContent, date: (document.getElementById('atEdDate') || {}).textContent,
    boot: typeof bootOk === 'undefined' ? null : bootOk, user: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.loginId : null,
    entries: (typeof state === 'object' && state && state.entries) ? Object.keys(state.entries).length : 0, back: getComputedStyle(document.getElementById('atBack')).display,
    tabs: (function(){ const t = document.getElementById('pcTabs'); return !!t && t.getBoundingClientRect().height > 0; })(), me: ATE.p && ATE.p.me })`);
  ok('A2 문서 제목 = 근태 보고 + 날짜', w2.title === '근태 보고 ' + LAB[D], w2.title);
  ok('A2 머리 = 근태 보고, 날짜 표시', w2.h === '근태 보고' && w2.date === LAB[D], `${w2.h} / ${w2.date}`);
  ok('A2 보고 화면과 글 칸이 보인다(← 근태 달력, 탭 줄은 없다)', (await shown(A, 'atEd')) && (await shown(A, 'atText')) && w2.back === 'none' && !w2.tabs);
  ok('A2 내 달력을 부팅하지 않았다(bootOk 아님, 로그인 사용자 없음, 일정 0)', w2.aw === true && w2.boot !== true && !w2.user && w2.entries === 0, JSON.stringify({ boot: w2.boot, user: w2.user, entries: w2.entries }));
  ok('A2 payload 의 내 신원이 메인 창과 같다', !!w2.me && String(w2.me.userId) === String(await M.ev('__bootMeta.userId')) && w2.me.loginId === user, JSON.stringify(w2.me));
  await sleep(3000);
  const L2b = (await sinceM(m2)).filter((x) => x.req === 'attendOpen');
  ok('A2 창이 뜬 뒤 새로 읽기가 되풀이되지 않는다(3초 동안 attendOpen 3번 이하)', L2b.length <= 3, `${L2b.length}번 ${JSON.stringify(L2b.map((x) => x.refresh))}`);

  /* ── A3 불러오기 패널 ── */
  head('A3 불러오기 패널: 옵션은 패널만, 불러오기는 왼쪽을 채우고, 고친 뒤에는 덮어쓰기를 묻는다');
  const p3 = await A.J(`({ rows: ATE.p.source.rows.map(function(r){ return r.name; }), text: document.getElementById('atText').value, cards: document.querySelectorAll('#atCards .at-card').length,
    pick: document.getElementById('atPick').textContent, none: (document.querySelector('#atCards .at-none') || {}).textContent || '', skip: document.getElementById('atOSkip').checked, src: ATE.src })`);
  ok('A3 payload 의 과제가 둘 이상(출처 행)', p3.rows.length >= 2, JSON.stringify(p3.rows.slice(0, 4)));
  ok('A3 처음은 캘린더 출처, 기록 없는 과제 제외 켬', p3.src === 'cal' && p3.skip === true);
  vlog('처음 패널:', p3.cards, p3.pick, p3.none);
  const text3 = p3.text;
  ok('A3 처음 글 = 처음 체크로 한 번 불러온 글', text3 === (await A.ev('atLoadText()')));
  await A.ev(`(function(){ const c = document.getElementById('atOSkip'); c.click(); return c.checked; })()`);
  const p3b = await A.J(`({ cards: document.querySelectorAll('#atCards .at-card').length, checked: document.querySelectorAll('#atCards input[data-atid]:checked').length,
    pick: document.getElementById('atPick').textContent, text: document.getElementById('atText').value })`);
  ok('A3 기록 없는 과제 제외를 끄면 모든 과제 카드(모두 체크)', p3b.cards === p3.rows.length && p3b.checked === p3.rows.length && p3b.pick === `과제 ${p3.rows.length} / ${p3.rows.length}개 선택`, JSON.stringify(p3b));
  ok('A3 옵션을 바꿔도 왼쪽 글은 그대로', p3b.text === text3);
  await A.ev(`(function(){ const c = document.getElementById('atODesc'); c.click(); return 1; })()`);
  ok('A3 설명 포함을 꺼도 왼쪽 글은 그대로', (await A.ev(`document.getElementById('atText').value`)) === text3);
  await A.ev(`(function(){ const c = document.getElementById('atODesc'); c.click(); return 1; })()`);
  //  둘째 카드만 끈다 → n-1 / n
  await A.ev(`(function(){ const c = document.querySelectorAll('#atCards input[data-atid]')[1]; c.click(); return c.checked; })()`);
  ok('A3 카드 하나를 끄면 선택 수가 준다', (await A.ev(`document.getElementById('atPick').textContent`)) === `과제 ${p3.rows.length - 1} / ${p3.rows.length}개 선택`);
  ok('A3 불러오기를 눌렀다', (await click(A, 'atLoad')) === 'ok');
  await sleep(150);
  const t3 = await A.ev(`document.getElementById('atText').value`);
  const heads3 = t3.split('\n').filter((l) => /^\[.+\]/.test(l));
  ok('A3 왼쪽이 체크한 과제의 머리 줄로 채워졌다(끈 과제는 없다)', heads3.length === p3.rows.length - 1 && heads3[0].startsWith(`[${p3.rows[0]}]`) && !heads3.some((h) => h.startsWith(`[${p3.rows[1]}]`)), JSON.stringify(heads3.slice(0, 3)));
  const edited3 = t3 + '\n- 루프가 고친 줄';
  await typeText(edited3);
  ok('A3 고친 뒤 불러오기를 눌렀다', (await click(A, 'atLoad')) === 'ok');
  await sleep(150);
  ok('A3 묻지 않고 바로 불러온 글로 바뀐다(덮어쓰기 확인 없음)', !(await A.ev(`!!document.getElementById('atConfirm')`)) && (await A.ev(`document.getElementById('atText').value`)) === t3);
  ok('A3 근태 목록에 미기록이 없고 기본은 정근 또는 그날 근태', await A.ev(`(function(){ const o = [].map.call(document.getElementById('atStatus').options, function(x){ return x.value; }); return o.indexOf('') < 0 && o.length === ATTEND_STATUS.length && !!document.getElementById('atStatus').value; })()`));
  ok('A3 회사 달력 표시 미리 보기가 없다', await A.ev(`!document.getElementById('atPv')`));

  /* ── A3b 가져오기 캘린더(다른 날짜, 호스트와 메인 창을 거치는 중계) ── */
  head('A3b 가져오기 캘린더: 다른 날짜를 고르면 attendSourceReq, 메인 창 __attendSourceFor, attendSourcePush, __attendSource 로 그날 기록이 온다');
  const TD = await M.ev('todayYmd()');
  ok('A3b 가져오기 머리, 출처 단추, 날짜 칸(처음 값 = 보는 날짜)', (await A.J(`({ h: document.querySelector('#atEd h3').textContent, src: [].map.call(document.querySelectorAll('[data-atsrc]'), function(b){ return b.textContent; }), d: document.getElementById('atSrcDate').value })`)).h === '가져오기'
    && same((await A.J(`[].map.call(document.querySelectorAll('[data-atsrc]'), function(b){ return b.textContent; })`)), ['캘린더', '인트라넷']) && (await A.ev(`document.getElementById('atSrcDate').value`)) === D);
  const p3c = await A.ev('__atLoopW.posts.length');
  await A.ev(`(function(){ const s = document.getElementById('atSrcDate'); s.value = ${JSON.stringify(TD)}; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  const got3c = await A.waitFor(`ATE.cal.date === ${JSON.stringify(TD)} && !ATE.cal.loading && !!ATE.cal.source`, 10000, 100);
  ok('A3b 근태 창이 attendSourceReq(오늘)을 보냈다', (await A.J(`__atLoopW.posts.slice(${p3c}).map(function(p){ return p.cmd + ':' + (p.date || ''); })`)).includes('attendSourceReq:' + TD));
  ok('A3b 중계 회신이 왔다(__attendSource, 10초 안)', got3c, JSON.stringify(await A.J(`({ date: ATE.cal.date, loading: ATE.cal.loading, err: ATE.cal.err })`)));
  const srcM = await M.J(`(function(){ const s = atBuildSource(${JSON.stringify(TD)}); return { names: s.rows.map(function(r){ return r.name; }), hours: s.hours }; })()`);
  const srcA = await A.J(`({ names: ATE.cal.source ? ATE.cal.source.rows.map(function(r){ return r.name; }) : null, hours: ATE.cal.source ? ATE.cal.source.hours : null })`);
  ok('A3b 받은 기록 = 메인 창이 그 날짜로 만든 기록(과제 목록과 시간)', same(srcA, srcM), JSON.stringify({ a: srcA.names && srcA.names.slice(0, 3), m: srcM.names.slice(0, 3) }));
  const c3c = await A.J(`({ cards: document.querySelectorAll('#atCards .at-card').length, items: atPanelItems().length, date: ATE.date })`);
  ok('A3b 카드 = 그 날짜의 출처 과제, 보는 날짜는 그대로', c3c.cards === c3c.items && c3c.date === D, JSON.stringify(c3c));
  if (c3c.items > 0) {
    await click(A, 'atLoad'); await sleep(150);
    ok('A3b 불러오기가 그 날짜의 글로 바로 바꾼다', (await A.ev(`document.getElementById('atText').value === atLoadText() && atLoadText().length > 0`)));
  } else note('오늘 캘린더에 기록이 있는 과제가 없어 불러오기는 건너뛴다(카드 0)');

  /* ── A3c 가져오기 근태관리(회사 사이트 읽기만, netcusWeekMerge) ── */
  head('A3c 가져오기 근태관리: 어제 회사 근태관리 일간보고를 netcusWeekMerge 로 읽는다(쓰기 없음)');
  const ND = await M.ev('addDays(todayYmd(), -1)');
  await A.ev('(function(){ const s = document.getElementById("atSrcDate"); s.value = ' + JSON.stringify(ND) + '; s.dispatchEvent(new Event("change", { bubbles: true })); return 1; })()');
  const p3n = await A.ev('__atLoopW.posts.length');
  await A.ev(`(function(){ document.querySelector('[data-atsrc="net"]').click(); return 1; })()`);
  ok('A3c 읽는 동안 안내와 보내기 잠금', (await A.ev(`ATE.net.loading === true && document.getElementById('atSend').disabled === true`)) || (await A.ev(`ATE.net.loading === false && ATE.net.date === ${JSON.stringify(ND)}`)));
  const got3n = await A.waitFor(`!ATE.net.loading && ATE.net.date === ${JSON.stringify(ND)}`, 120000, 300);
  const n3 = await A.J(`({ err: ATE.net.err, dayOk: ATE.net.dayOk, len: ATE.net.content.length, items: atPanelItems().length, cards: document.querySelectorAll('#atCards .at-card').length,
    none: (document.querySelector('#atCards .at-none') || {}).textContent || '', send: document.getElementById('atSend').disabled })`);
  const sent3n = await A.J(`__atLoopW.posts.slice(${p3n}).map(function(p){ return p.cmd; })`);
  ok('A3c netcusWeekMerge 로 읽었다(netcusSubmit 은 없다)', sent3n.includes('netcusWeekMerge') && !sent3n.includes('netcusSubmit'), JSON.stringify(sent3n));
  ok('A3c 회신이 왔고 오류가 없다', got3n && n3.err === '', JSON.stringify(n3));
  ok('A3c 글이 있으면 머리 줄 카드, 없으면 빈 날 안내', n3.len > 0 ? (n3.items > 0 && n3.cards === n3.items) : /등록된 보고가 없습니다|읽지 못했습니다/.test(n3.none), JSON.stringify(n3));
  ok('A3c 다 읽은 뒤 보내기 잠금이 풀린다', n3.send === false);
  if (n3.items > 0) {
    await click(A, 'atLoad'); await sleep(150);
    ok('A3c 불러오기가 근태관리 글로 바로 바꾼다(&nbsp; 없이)', await A.ev(`(function(){ const v = document.getElementById('atText').value; return v === atLoadText() && v.length > 0 && v.indexOf('&nbsp;') < 0 && v.indexOf('\\u00a0') < 0; })()`));
  }
  note(`근태관리 어제 글 ${n3.len}자, 과제 묶음 ${n3.items}개`);
  //  캘린더 출처, 보는 날짜로 되돌리고 처음 글로 돌려 둔다(다음 단계가 깨끗한 상태에서 시작한다)
  await A.ev(`(function(){ document.querySelector('[data-atsrc="cal"]').click(); const s = document.getElementById('atSrcDate'); s.value = ${JSON.stringify(D)}; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  await typeText(text3);
  ok('A3c 정리: 출처 캘린더, 날짜는 보는 날짜, 고친 것 없음', await A.ev(`ATE.src === 'cal' && ATE.srcDate === ${JSON.stringify(D)} && !atDirty()`));

  /* ── A4 임시 저장 ── */
  head('A4 임시 저장: 입력 뒤 2초 안에 키가 생기고 메인 창에서도 보인다');
  const KEY = await keyIn(A, D);
  ok('A4 키 이름이 두 창에서 같다(tc_attDraft:<who>:날짜)', KEY === (await keyIn(M, D)) && KEY === `tc_attDraft:${await M.ev('rptDraftWho()')}:${D}`, KEY);
  const TXT4 = '[루프 임시 저장] : 1\n- 이어 쓰기 시험 줄\n  - 들여 쓴 줄';
  await typeText(TXT4);
  const t4 = Date.now();
  const got4 = await A.waitFor(`localStorage.getItem(${JSON.stringify(KEY)}) !== null`, 2000, 100);
  ok('A4 2초 안에 근태 창 저장소에 키가 생겼다', got4, `${Date.now() - t4}ms`);
  const s4 = await storedIn(A, KEY);
  ok('A4 값 = {v:1, text, status, overtime, savedAt}', !!s4 && s4.v === 1 && s4.text === TXT4 && typeof s4.status === 'string' && typeof s4.overtime === 'number' && !isNaN(Date.parse(s4.savedAt)), JSON.stringify(s4));
  ok('A4 메인 창 저장소에서도 같은 값(같은 출처)', same(await storedIn(M, KEY), s4));
  ok('A4 상태 줄에 "이 PC에 임시 저장됨 HH:MM"', /^이 PC에 임시 저장됨 \d\d:\d\d$/.test(await A.ev(`document.getElementById('atSaved').textContent`)));
  const drf4 = await M.waitFor(`!!document.querySelector('#atGrid .at-day[data-date="${D}"] .at-drf')`, 3000, 200);
  if (!drf4) {
    await M.ev('atRenderMonth(); 1');
    ok('A4 메인 근태 달력의 그 칸에 ✎ 작성 중(storage 알림으로는 안 그려져 다시 그려서 확인)', await M.ev(`!!document.querySelector('#atGrid .at-day[data-date="${D}"] .at-drf')`));
    note('메인 창이 storage 알림으로 바로 다시 그리지 않았다(다른 WebView2 창의 저장은 storage 이벤트가 오지 않을 수 있다). 창 포커스나 달 이동 때 다시 그린다');
  } else ok('A4 메인 근태 달력의 그 칸에 ✎ 작성 중(storage 알림으로 다시 그림)', true);

  /* ── A5 닫기 지키기 ── */
  head('A5 닫기 지키기: 묻는 창, 계속 쓰기, 닫기, 다시 열어 되살리기, 버리기');
  ok('A5 쓰던 글이 있으면 __winCloseRequest() = ask', (await A.ev('window.__winCloseRequest()')) === 'ask');
  ok('A5 묻는 창이 보인다(계속 쓰기에 포커스)', (await shown(A, 'atAsk')) && (await A.ev(`document.activeElement === document.getElementById('atAskStay')`)));
  await click(A, 'atAskStay');
  await sleep(300);
  ok('A5 계속 쓰기면 묻는 창만 닫히고 창과 글이 남는다', !(await shown(A, 'atAsk')) && (await attendTargets()).length === 1 && (await A.ev(`document.getElementById('atText').value`)) === TXT4);
  ok('A5 다시 닫기 요청 = ask', (await A.ev('window.__winCloseRequest()')) === 'ask');
  await click(A, 'atAskClose').catch(() => 'closed');
  const gone5 = await waitAttendTarget({ gone: true, timeout: 8000 });
  ok('A5 닫기면 근태 창이 닫혔다(대상이 사라짐)', gone5);
  const k5 = await storedIn(M, KEY);
  ok('A5 닫아도 임시 저장은 남는다', !!k5 && k5.text === TXT4, JSON.stringify(k5));
  await M.ev(`atOpen(${JSON.stringify(D)})`);
  ok('A5 다시 열었다(새 근태 창)', !!(await attachAttend(D, 20000)));
  vlog('근태 창 기록기:', await A.ev(INSTALL_A));
  ok('A5 되살림 안내가 보인다("HH:MM 에 임시 저장된 글을 이어서 엽니다")', (await shown(A, 'atRestore')) && /^\d\d:\d\d 에 임시 저장된 글을 이어서 엽니다\.$/.test(await A.ev(`document.getElementById('atRestoreMsg').textContent`)));
  ok('A5 글이 되살아났다', (await A.ev(`document.getElementById('atText').value`)) === TXT4);
  await click(A, 'atDiscard');
  await sleep(200);
  ok('A5 버리고 처음 상태로: 키가 지워졌다(두 창)', (await storedIn(A, KEY)) === null && (await storedIn(M, KEY)) === null);
  ok('A5 안내가 닫히고 글은 처음 상태, 고친 것 없음', !(await shown(A, 'atRestore')) && (await A.ev(`document.getElementById('atText').value === ATE.base.text && !atDirty()`)));
  ok('A5 고친 것이 없으면 __winCloseRequest() = close(창은 호스트가 닫는다, 여기서는 묻기만)', (await A.ev('window.__winCloseRequest()')) === 'close');

  /* ── A6 날짜 이동 ── */
  head('A6 날짜 이동: › 가 메인 창을 거쳐 같은 창에 2099-12-03 으로, 넘기기 전에 바로 임시 저장');
  const TXT6 = '[루프 날짜 이동] : 2\n- 넘기기 직전 글';
  const tid6 = A.targetId;
  const m6 = await markM();
  const r6 = await A.J(`(function(){ const t = document.getElementById('atText'); t.value = ${JSON.stringify(TXT6)}; t.dispatchEvent(new Event('input', { bubbles: true }));
    const before = localStorage.getItem(${JSON.stringify(KEY)}); document.getElementById('atNext').click();
    const after = localStorage.getItem(${JSON.stringify(KEY)}); return { before: before, after: after ? JSON.parse(after).text : null, pending: ATE.navPending }; })()`);
  ok('A6 입력 직후에는 아직 키가 없다(1초 모아 쓰기)', r6.before === null);
  ok('A6 › 를 누르는 즉시 12-02 글을 임시 저장했다', r6.after === TXT6, JSON.stringify(r6));
  ok('A6 넘기는 동안 대기 표시(navPending = 12-03)', r6.pending === D2);
  ok('A6 같은 창이 12-03 으로 돌아왔다', !!(await attachAttend(D2, 20000)) && A.targetId === tid6 && (await attendTargets()).length === 1);
  const L6 = await sinceM(m6);
  ok('A6 메인 창이 attendNav 를 받아 12-03 payload 로 attendOpen', L6.some((x) => x.req === 'attendOpen' && x.date === D2 && !x.refresh && x.ok === true), JSON.stringify(L6.map((x) => [x.req, x.date || x.from, x.ok])));
  ok('A6 근태 창이 보낸 것은 attendNav(12-03, refresh 아님)', (await A.J(`__atLoopW.posts.filter(function(p){ return p.cmd === 'attendNav' && !p.refresh; }).map(function(p){ return p.date; })`)).includes(D2));
  ok('A6 머리 날짜와 문서 제목이 12-03', (await A.ev(`document.getElementById('atEdDate').textContent`)) === LAB[D2] && (await A.ev('document.title')) === '근태 보고 ' + LAB[D2]);
  ok('A6 12-03 은 깨끗하다(되살림 없음, 키 없음), ‹ › 다시 쓸 수 있다', !(await shown(A, 'atRestore')) && (await storedIn(M, await keyIn(M, D2))) === null && (await A.ev(`!document.getElementById('atPrev').disabled && !document.getElementById('atNext').disabled`)));
  await click(A, 'atPrev');
  ok('A6 ‹ 로 12-02 에 돌아오면 넘기기 전 글이 되살아난다', !!(await attachAttend(D, 20000)) && (await shown(A, 'atRestore')) && (await A.ev(`document.getElementById('atText').value`)) === TXT6);

  /* ── A7 보내기(가로채기) ── */
  head('A7 보내기: 실제로 보내지 않고 payload 확인, 잠금, 연속 클릭, 실패 회신, 성공 회신으로 지우고 닫힘');
  ok('A7 근태 창 가로채기(submitDaily)와 netcus 차단(hpost)이 제자리', await interceptOkA());
  await typeText(SEND_TEXT);
  ok('A7 근태 = 정근(1), 초과 없음', (await setSel('atStatus', '1')) === '1' && (await setSel('atOt', '0')) === '0');
  ok('A7 상태 줄 = 과제 3개, 합계 5.5시간(범위 밖 30 은 빼고)', (await A.ev(`document.getElementById('atHours').textContent`)) === '과제 3개, 합계 5.5시간');
  if (!(await interceptOkA())) throw new Error('전송 가로채기가 제자리에 없다. 실제 전송 위험이라 누르지 않는다');
  const n7 = await A.ev('__atLoopW.cap.length');
  const r7 = await A.J(`(function(){ const b = document.getElementById('atSend'); b.click(); const busy = { disabled: b.disabled, label: b.textContent, ta: document.getElementById('atText').disabled,
    st: document.getElementById('atStatus').disabled, prev: document.getElementById('atPrev').disabled, cls: document.getElementById('atEd').classList.contains('busy'), sending: ATE.sending };
    b.click(); atSubmit(); return busy; })()`);
  ok('A7 처리 중 잠금(단추 문구, 글 칸, 근태, 날짜 이동, busy)', r7.disabled && r7.label === '회사에 보고하는 중…' && r7.ta && r7.st && r7.prev && r7.cls && r7.sending, JSON.stringify(r7));
  ok('A7 연속 클릭과 다시 부르기에도 한 번만 붙잡았다', (await A.ev('__atLoopW.cap.length')) === n7 + 1, String((await A.ev('__atLoopW.cap.length')) - n7));
  const cap7 = await A.J('__atLoopW.cap[__atLoopW.cap.length - 1]');
  ok('A7 payload kind daily, 날짜, dryRun false', !!cap7 && cap7.kind === 'daily' && same(cap7.date, { y: 2099, m: 12, d: 2 }) && cap7.dryRun === false && cap7.__tc === 'netcus-report', JSON.stringify(cap7 && { kind: cap7.kind, date: cap7.date, dryRun: cap7.dryRun }));
  ok('A7 status = "1"(정근, null 없음), overtime = 0', !!cap7 && cap7.fields.status === '1' && cap7.fields.overtime === 0, JSON.stringify(cap7 && cap7.fields.status));
  ok('A7 content 는 줄 앞 공백을 &nbsp; 로', !!cap7 && cap7.fields.content === SEND_CONTENT, JSON.stringify(cap7 && cap7.fields.content));
  ok('A7 hours = 머리 줄 두 형식에서 읽은 값(범위 밖 30 은 없다)', !!cap7 && same(cap7.hours, SEND_HOURS), JSON.stringify(cap7 && cap7.hours));
  ok('A7 netcus 명령은 하나도 호스트로 나가지 않았다(두 창)', same(await A.J('__atLoopW.blocked'), []) && same(await M.J('__atLoop.blocked'), []), JSON.stringify([await A.J('__atLoopW.blocked'), await M.J('__atLoop.blocked')]));
  ok('A7 보내기 직전에 임시 저장을 썼다', ((await storedIn(M, KEY)) || {}).text === SEND_TEXT);
  ok('A7 보내는 중에는 창 닫기 요청 = busy', (await A.ev('window.__winCloseRequest()')) === 'busy');
  await A.ev(`window.__netcusResult(false, '시험 실패 회신(루프)'); 1`);
  await sleep(200);
  const f7 = await A.J(`({ msg: document.getElementById('atMsg').textContent, cls: document.getElementById('atMsg').className, title: document.getElementById('atMsg').title,
    send: document.getElementById('atSend').disabled, label: document.getElementById('atSend').textContent, ta: document.getElementById('atText').disabled, text: document.getElementById('atText').value, sending: ATE.sending })`);
  ok('A7 실패 회신 흉내 = 공통 안내', f7.msg === FAIL_MSG && /\berr\b/.test(f7.cls), JSON.stringify(f7));
  ok('A7 호스트 원래 문구는 title 로만', f7.title === '시험 실패 회신(루프)');
  ok('A7 잠금이 풀리고 글 그대로', !f7.send && !f7.ta && !f7.sending && f7.label === '회사에 보고' && f7.text === SEND_TEXT);
  ok('A7 실패해도 창은 남고 임시 저장도 남는다', (await attendTargets()).length === 1 && ((await storedIn(M, KEY)) || {}).text === SEND_TEXT);
  //  다시 보내기: 근태 코드와 초과시간
  ok('A7 근태 = 야근(2), 초과 +2시간', (await setSel('atStatus', '2')) === '2' && (await setSel('atOt', '2')) === '2');
  if (!(await interceptOkA())) throw new Error('전송 가로채기가 제자리에 없다. 실제 전송 위험이라 누르지 않는다');
  await click(A, 'atSend');
  await sleep(150);
  const cap7b = await A.J('__atLoopW.cap[__atLoopW.cap.length - 1]');
  ok('A7 다시 보내기 payload status = "2", overtime = 2, 글 같음', (await A.ev('__atLoopW.cap.length')) === n7 + 2 && cap7b.fields.status === '2' && cap7b.fields.overtime === 2 && cap7b.fields.content === SEND_CONTENT, JSON.stringify(cap7b && cap7b.fields.status));
  ok('A7 메인 창은 근태 창이 보낸 것에 묶이지 않았다(보고서 창 대기 표지 없음)', (await M.ev('__rptSendArmed')) === false && (await M.ev('ATE.armed')) === false);
  //  호스트의 DB 저장 알림 흉내(근태 창에서만): 그날 근태관리 글 기억을 비운다(다음에 고르면 다시 읽는다). 창은 남는다.
  await A.ev(`(function(){ ATE.net.date = ${JSON.stringify(D)}; ATE.net.loading = false; return 1; })()`);
  await A.ev(`window.__reportDailySaved({ date: ${JSON.stringify(D)}, status: '2', overtime: 2 }); 1`);
  ok('A7 __reportDailySaved 흉내: 그날 근태관리 글 기억을 비우고 창은 남는다', (await A.ev(`ATE.net.date === '' && ATE.sending === true`)) && (await attendTargets()).length === 1);
  await A.ev(`window.__netcusResult(true, '시험 회신(루프, 실제 전송 아님)'); 1`);
  await sleep(300);
  ok('A7 성공 회신 흉내 = 근태 창은 닫히지 않는다', (await attendTargets()).length === 1 && !A.closed);
  ok('A7 성공 회신 = 임시 저장이 지워졌다', (await storedIn(M, KEY)) === null);
  const v7 = await A.J(`({ title: document.getElementById('atEdTitle').textContent, date: document.getElementById('atEdDate').textContent,
    text: document.getElementById('atText').value, st: document.getElementById('atStatus').value, ot: document.getElementById('atOt').value,
    sent: document.getElementById('atSent').textContent, msg: document.getElementById('atMsg').textContent, dirty: atDirty(), vw: !!document.getElementById('atVw') })`);
  ok('A7 쓰기 화면 그대로(머리 근태 보고, 날짜만, 보기 화면 없음)', v7.title === '근태 보고' && v7.date === LAB[D] && !v7.vw, JSON.stringify(v7));
  ok('A7 쓰기 화면과 가져오기 패널이 보인다', (await shown(A, 'atEdBody')) && (await shown(A, 'atSend')) && (await shown(A, 'atPanel')));
  ok('A7 창의 글과 근태 = 보낸 글(공백 되돌림), 야근 +2, 보낸 시각', v7.text === SEND_TEXT && v7.st === '2' && v7.ot === '2' && /^보낸 시각 \d{4}-\d\d-\d\d \d\d:\d\d$/.test(v7.sent), JSON.stringify(v7));
  ok('A7 성공 문구', v7.msg === '시험 회신(루프, 실제 전송 아님)');
  ok('A7 성공 뒤 고친 것이 없다(__winCloseRequest = close)', !v7.dirty && (await A.ev('window.__winCloseRequest()')) === 'close');
  ok('A7 고친 것이 없으면 닫기 단추가 창을 닫는다', (await click(A, 'atClose').catch(() => 'closed')) !== 'disabled');
  const gone7 = await waitAttendTarget({ gone: true, timeout: 8000 });
  ok('A7 근태 창이 닫혔다', gone7);
  ok('A7 메인 창으로는 netcus 명령이 나가지 않았다', same(await M.J('__atLoop.blocked'), []));

  /* ── A8 메인 창 무시 ── */
  head('A8 메인 창 무시: 보고서 창이 보내지 않았으면 회신 알림이 문구와 토스트를 건드리지 않는다');
  ok('A8 보고서 창 대기 표지 없음', (await M.ev('__rptSendArmed')) === false);
  //  빈 칸이면 "안 바뀜" 이 약하다. 표지 문구를 넣어 두고 알림 뒤에도 그대로인지 본 다음 원래 값으로 되돌린다.
  const s80 = await M.J(`(function(){ const s = document.getElementById('rptSendStatus'); if (!s) return null; const o = { t: s.innerHTML, c: s.className };
    s.innerHTML = '루프 표지 문구'; s.className = 'rpt-send-status'; return o; })()`);
  ok('A8 #rptSendStatus 가 있다', !!s80);
  const m8 = await markM();
  await M.ev(`window.__netcusProgress('루프 진행 알림(무시돼야 함)'); window.__netcusResult(true, '루프 성공 알림(무시돼야 함)'); window.__netcusResult(false, '루프 실패 알림(무시돼야 함)'); 1`);
  await sleep(300);
  const s8b = await M.J(`(function(){ const s = document.getElementById('rptSendStatus'); return s ? { t: s.innerHTML, c: s.className } : null; })()`);
  if (s80) await M.ev(`(function(){ const s = document.getElementById('rptSendStatus'); s.innerHTML = ${JSON.stringify(s80.t)}; s.className = ${JSON.stringify(s80.c)}; return 1; })()`);
  ok('A8 #rptSendStatus 문구와 모양이 그대로(표지 문구 유지)', same(s8b, { t: '루프 표지 문구', c: 'rpt-send-status' }), JSON.stringify(s8b));
  const toasts8 = (await sinceM(m8)).filter((x) => x.toast);
  ok('A8 보고서 토스트가 뜨지 않았다', !toasts8.length, JSON.stringify(toasts8));

  /* ── A9 보고한 날(실제, 읽기만): 바로 쓰기 화면, 고치지 않았으면 Esc 로 닫힌다 ── */
  head('A9 보고한 날: 이 달에 앱으로 보고한 날을 열면 바로 쓰기 화면에 보고한 글이 뜨고, Esc 로 닫힌다');
  await M.ev(`(async function(){ ATT.anchor = todayYmd(); await atLoadMonth(); return 1; })()`);
  const R9 = await M.J(`(function(){ const a = Array.from(ATT.rows.values()).filter(function(r){ return atDecode(r.content).trim() && attDraftGet(r.date) == null; });
    a.sort(function(x, y){ return x.date < y.date ? -1 : 1; }); const r = a[a.length - 1]; if (!r) return null;
    return { date: r.date, status: r.status || '1', overtime: String(r.overtime || 0), text: atDecode(r.content).replace(/\s+$/, ''), sent: atSentLabel(r.sentAt) }; })()`);
  if (!R9) note('이 달에 앱으로 보고한 날(임시 저장 없는 날)이 없어 보고한 날 실제 확인을 건너뛴다');
  else {
    await M.ev(`atOpen(${JSON.stringify(R9.date)}); 1`);
    ok('A9 근태 창이 그 날짜로 열렸다', !!(await attachAttend(R9.date, 20000)), R9.date);
    const v9 = await A.J(`({ text: document.getElementById('atText').value, st: document.getElementById('atStatus').value, ot: document.getElementById('atOt').value,
      sent: document.getElementById('atSent').textContent, title: document.getElementById('atEdTitle').textContent, dirty: atDirty() })`);
    ok('A9 바로 쓰기 화면(근태 보고)으로 열렸다', v9.title === '근태 보고' && (await shown(A, 'atEdBody')) && (await shown(A, 'atSend')), JSON.stringify({ title: v9.title }));
    ok('A9 내용 = DB 의 그날 보고(글, 근태, 보낸 시각), 고친 것 없음', v9.text === R9.text && v9.st === R9.status && v9.ot === R9.overtime && v9.sent === (R9.sent ? '보낸 시각 ' + R9.sent : '') && !v9.dirty,
      JSON.stringify({ st: [v9.st, R9.status], ot: [v9.ot, R9.overtime], sent: [v9.sent, R9.sent] }));
    await A.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`).catch(() => 0);
    ok('A9 고친 것이 없으면 Esc 로 근태 창이 닫혔다', await waitAttendTarget({ gone: true, timeout: 8000 }));
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
  //  ★ 무슨 일이 있어도: 근태 창을 닫고, 두 창의 2099 임시 저장 키를 지우고, 탭과 탭 기억을 되돌린다.
  if (M && started) {
    head('정리: 근태 창 닫기, 2099 임시 저장 키, 탭과 탭 기억 되돌리기, 잔재 0');
    try {
      const closedA = await forceCloseAttend();
      if (M.closed) throw new Error('메인 창 연결이 끊겼다');
      await dropLoopKeys(M);
      await M.ev(`(function(){ try { ATT.anchor = todayYmd(); } catch (_) {} return 1; })()`);
      await M.ev(`pcSetTab(${JSON.stringify(tab0)}); 1`);
      if (pcalKey && pcalRaw0 !== undefined) await M.ev(`(function(){ try { const v = ${JSON.stringify(pcalRaw0)}; if (v == null) localStorage.removeItem(${JSON.stringify(pcalKey)}); else localStorage.setItem(${JSON.stringify(pcalKey)}, v); } catch (_) {} return 1; })()`);
      healthyAtEnd = await M.waitFor(isHealthy, 20000, 300);
      const left = { attend: (await attendTargets()).length, keys: await loopKeys(M), tab: await M.ev('PCAL.tab'),
        pcal: pcalKey ? await M.ev(`localStorage.getItem(${JSON.stringify(pcalKey)})`) : null };
      cleaned = closedA && left.attend === 0 && left.keys.length === 0 && left.tab === tab0 && (pcalRaw0 === undefined || left.pcal === pcalRaw0);
      ok('정리: 근태 창 없음, 2099 키 0, 탭과 탭 기억이 처음 그대로', cleaned, JSON.stringify({ ...left, pcal: left.pcal === pcalRaw0 ? 'same' : left.pcal }));
    } catch (e) {
      cleaned = false;
      F.push('정리 중 예외: ' + e.message); fail++;
    }
  }
  if (M) { try { await M.ev(UNINSTALL_M); } catch (_) { } M.close(); }
  if (A) A.close();
}

const secs = ((Date.now() - T0) / 1000).toFixed(1);
console.log('\n' + '═'.repeat(74));
console.log(`근태 루프 요약, 소요 ${secs}s`);
if (F.length) { console.log(`실패 ${F.length}건:`); F.forEach((f) => console.log('  ✗ ' + f)); }
if (UD.length) { console.log(`판정 불가 ${UD.length}건:`); UD.forEach((f) => console.log('  ? ' + f)); }
if (started && healthyAtEnd === false) console.log('\n★★ 경고: 끝날 때 위젯이 정상으로 돌아오지 않았다. 화면을 확인하고 필요하면 재시작하세요.');
if (started && cleaned === false) console.log(`\n★★★ 경고: 시험 잔재를 다 지우지 못했다. 근태 창, localStorage 의 tc_attDraft:*:2099-* 키, 메인 창 탭을 확인하세요.`);
console.log(`재현: node tests/loop-attendance.mjs --port=${OPT.port}`);
console.log(`\n통과 ${pass}, 실패 ${fail}, 판정 불가 ${undecided}`);
console.log('═'.repeat(74));
const cleanOk = !started || (cleaned !== false && healthyAtEnd !== false);
process.exit(fail > 0 || !cleanOk ? 1 : (undecided > 0 || notReady ? 2 : 0));
