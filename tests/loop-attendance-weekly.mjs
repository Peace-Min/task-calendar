#!/usr/bin/env node
/* =====================================================================================
 *  tests/loop-attendance-weekly.mjs: 근태 주간보고 **실동작** 루프(docs/ATTENDANCE-PLAN.md §13.5 실제 위젯)
 * -------------------------------------------------------------------------------------
 *  계약 시험(attendance-weekly-web.test.mjs, attendance-host 주간⑫)은 jsdom 과 정적 검사로 규칙을 잠근다. 이 루프는 실제 위젯(Debug, TC_DEBUG_PORT)에 붙어
 *  메인 창 근태 탭의 [주간] 목록과, 따로 뜨는 근태 창(?win=attend)의 주간 모드를 함께 다룬다. loop-attendance.mjs 와 같은 CDP 틀이다.
 *
 *  케이스:
 *    O0   전제: 로그인, conn ok, bootOk, 새 빌드(awOpen, ATTENDWIN_CMD 의 reportWeeklyList), 지난 실행 잔재(tc_attWDraft:*:2099-*, 떠 있는 근태 창) 정리
 *    W1   [일간][주간]: 근태 탭 머리의 [주간]을 누르면 목록(#awList)이 보이고 reportWeeklyList(52주, 읽기만)를 성공으로 읽는다. tc_attKind 기억
 *    W2   열기: 메인 창 awOpen(2099-12-07) 이 그 주의 기록을 읽고(reportWeeklyList 하루) attendOpen(kind week). 근태 창이 주간 편집만 보이고
 *         처음 여는 주라 두 가져오기를 한 번 해 둔다(2099 라 기록 없음 안내), 고친 것 없음
 *    W3   편집(결정 14): 진행사항, 차주계획은 자유 글, 과제투입시간은 따로 움직이는 목록([+ 과제 추가], 숫자 칸, 합계), 회의내용, 미리보기(인트라넷 폼 모양) = 조립 글
 *    W4   임시 저장: 2초 안에 tc_attWDraft:<who>:2099-12-07 이 생기고 메인 창 목록에 작성 중으로 보인다
 *    W5   이동: › 는 그 주 기록을 읽어 2099-12-14 를 열고(넘기기 전에 임시 저장), ‹ 로 돌아오면 글이 되살아난다. 주 고르기 달력이 그 달 줄을 보인다
 *    W6   보내기(가로채기, 실제 전송 없음): 과제투입시간 0개는 막고, payload(기간, 제목, 네 칸, resultwork, &nbsp;, hours 구조), 잠금, 연속 클릭 한 번,
 *         실패 회신 흉내 = 공통 안내, 성공 회신 흉내 = 처음 상태(임시 저장은 남음), 저장 알림 흉내 = 임시 저장 지움
 *    W7   창 안 목록: [‹ 목록]이 창 안의 목록(reportWeeklyList)을 보이고 [일간][주간]은 없다. [작성]은 이번 주를 그 자리에서 연다
 *    W8   닫기 지키기: 고친 글이 있으면 __winCloseRequest() = ask, [닫기]면 창이 닫히고 키는 남는다
 *    정리 근태 창 닫기, 두 창의 2099 주간 임시 저장 키 삭제, 탭과 [일간][주간] 기억 되돌리기, 잔재 0 확인
 *
 *  ★ 실제로 회사에 보내지 않는다(두 겹, loop-attendance 와 같은 방식): 근태 창의 Platform.report.submitWeekly 를 가로채 payload 만 붙잡고,
 *    두 창의 hpost 를 감싸 'netcus' 로 시작하는 명령은 호스트로 넘기지 않고 기록만 한다. 회신은 __netcusResult 를 직접 불러 흉내 낸다.
 *    __reportWeeklySaved 흉내는 근태 창에서만 부른다(DB 에 쓰지 않는다. 임시 저장을 지우는 웹 동작만 본다).
 *  ★ DB 에 쓰지 않는다. 읽는 것은 reportWeeklyList(목록, 2099 주, 지난주)와 reportDailyList(2099 주 7일)뿐이다.
 *  ★ 과제투입시간은 이 계정의 실제 캘린더 과제(payload.projects) 앞의 둘로 만든다. 셋이 안 되면 W3 이후를 판정 불가로 둔다.
 *  ★ 보내기를 가로채므로 시간 줄이 DB 에 남는지는 이 루프가 볼 수 없다. 대신 W7 에서 reportWeeklyList 가 오류 없이 돌아오는지(시간 줄 표를 읽는 질의 포함) 읽기만 확인한다.
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 로그인된 채 띄운 뒤
 *    node tests/loop-attendance-weekly.mjs [--port=9222] [-v]
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
  console.log(`사용법: node tests/loop-attendance-weekly.mjs [--port=${OPT.port}] [-v]`);
  process.exit(0);
}
const W = '2099-12-07', W2 = '2099-12-14', WL = '2099-11-30';   // 시험 주(월요일). 지난주 = 11-30
const FAIL_MSG = '처리를 완료하지 못했습니다. 다시 시도해 주세요.';
const nbsp = (t) => t.split('\n').map((l) => { const n = /^ */.exec(l)[0].length; return '&nbsp;'.repeat(n) + l.slice(n); }).join('\n');

//  CDP 틀과 판정 도우미는 loop-attendance.mjs 와 같다(그 파일에서 옮겨 왔다).
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
let A = null;   // 근태 창

async function attendTargets() { try { return (await pageTargets()).filter((x) => isAttendUrl(x.url)); } catch (_) { return []; } }
async function waitAttendTarget({ timeout = 20000, gone = false } = {}) {
  const t0 = Date.now();
  for (;;) {
    const L = await attendTargets();
    if (gone ? !L.length : L.length) return gone ? true : L[0];
    if (Date.now() - t0 > timeout) return gone ? false : null;
    await sleep(200);
  }
}
//  근태 창에 붙어 주간 편집이 그 주로 열리고 가져오기와 이동이 끝날 때까지 기다린다.
async function attachWeek(mon, timeout = 20000) {
  const t = await waitAttendTarget({ timeout });
  if (!t) return null;
  if (!A || A.closed || A.targetId !== t.id) { if (A) A.close(); A = await Cdp.attach(t); }
  const ready = await A.waitFor(`typeof AWE === 'object' && AWE.mon === ${JSON.stringify(mon)} && !AWE.busy && !AWE.nav && ATW.view === 'wedit'`, timeout);
  return ready ? t : null;
}

/* ── 기록기와 전송 차단(loop-attendance 와 같다. 주간 전송도 붙잡는다) ── */
const INSTALL_M = `(function(){
  if (window.__awLoop) return 'already';
  const R = window.__awLoop = { log: [], blocked: [], orig: { hostRequest: hostRequest, hpost: hpost, submitDaily: Platform.report.submitDaily, submitWeekly: Platform.report.submitWeekly } };
  hostRequest = function(cmd, params, t){
    const p = params || {}, rec = { t: Date.now(), req: cmd, from: p.from, to: p.to, kind: p.payload && p.payload.kind, mon: p.payload && p.payload.mon };
    R.log.push(rec);
    return R.orig.hostRequest(cmd, params, t).then(function(res){ rec.ok = !!(res && res.ok); rec.n = res && Array.isArray(res.rows) ? res.rows.length : null; return res; });
  };
  hpost = function(o){ if (o && /^netcus/i.test(String(o.cmd || ''))) { R.blocked.push(String(o.cmd)); return; } return R.orig.hpost(o); };
  Platform.report.submitDaily = function(){ R.blocked.push('submitDaily(main)'); };
  Platform.report.submitWeekly = function(){ R.blocked.push('submitWeekly(main)'); };
  return 'ok';
})()`;
const UNINSTALL_M = `(function(){
  const R = window.__awLoop; if (!R) return 'none';
  hostRequest = R.orig.hostRequest; hpost = R.orig.hpost; Platform.report.submitDaily = R.orig.submitDaily; Platform.report.submitWeekly = R.orig.submitWeekly;
  delete window.__awLoop; return 'ok';
})()`;
const INSTALL_A = `(function(){
  if (window.__awLoopW) return 'already';
  const R = window.__awLoopW = { posts: [], blocked: [], cap: [], log: [], orig: { hpost: hpost, hostRequest: hostRequest, submitDaily: Platform.report.submitDaily, submitWeekly: Platform.report.submitWeekly } };
  hpost = function(o){ const c = String((o && o.cmd) || ''); R.posts.push({ cmd: c, date: o && o.date, refresh: o && o.refresh });
    if (/^netcus/i.test(c)) { R.blocked.push(c); return; } return R.orig.hpost(o); };   // netcus 명령은 하나도 통과시키지 않는다
  hostRequest = function(cmd, params, t){ const p = params || {}, rec = { req: cmd, from: p.from, to: p.to }; R.log.push(rec);
    if (/^netcus/i.test(String(cmd))) { R.blocked.push(String(cmd)); return Promise.resolve({ ok: false, error: 'loop-blocked' }); }
    return R.orig.hostRequest(cmd, params, t).then(function(res){ rec.ok = !!(res && res.ok); rec.n = res && Array.isArray(res.rows) ? res.rows.length : null; return res; }); };
  Platform.report.submitDaily = function(p){ R.blocked.push('submitDaily'); };
  Platform.report.submitWeekly = function(p){ R.cap.push(JSON.parse(JSON.stringify(p))); };
  return 'ok';
})()`;
const interceptOkA = () => A.ev(`!!window.__awLoopW && Platform.report.submitWeekly !== window.__awLoopW.orig.submitWeekly && hpost !== window.__awLoopW.orig.hpost`);
const markM = () => M.ev('__awLoop.log.length');
const sinceM = (m) => M.J(`__awLoop.log.slice(${Number(m)})`);

/* ── 앱 조작 ── */
const isHealthy = 'conn === "ok" && bootOk === true && !unsaved && !document.getElementById("dsError") && !document.getElementById("dbUnsaved")';
const storedIn = (C, key) => C.J(`(function(){ try { return JSON.parse(localStorage.getItem(${JSON.stringify(key)}) || 'null'); } catch (_) { return 'ERR'; } })()`);
const LOOP_KEYS_JS = `(function(){ const a = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('tc_attWDraft:') === 0 && k.indexOf(':2099-') > 0) a.push(k); } return a; })()`;
const loopKeys = (C) => C.J(LOOP_KEYS_JS);
const dropLoopKeys = (C) => C.ev(`(function(){ const a = ${LOOP_KEYS_JS}; a.forEach(function(k){ localStorage.removeItem(k); });
  if (typeof __awDraftMem !== 'undefined') [...__awDraftMem.keys()].forEach(function(k){ if (k.indexOf(':2099-') > 0) __awDraftMem.delete(k); });
  return a.length; })()`);
const click = (C, id) => C.ev(`(function(){ const b = document.getElementById(${JSON.stringify(id)}); if (!b) return 'none'; if (b.disabled) return 'disabled'; b.click(); return 'ok'; })()`);
const shown = (C, id) => C.ev(`(function(){ const e = document.getElementById(${JSON.stringify(id)}); if (!e || e.classList.contains('hidden')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
//  근태 창 안에서 주간 칸을 채운다(모두 실제 처리기, 결정 14). list = { prog:'글', plan:'글', hours:[{name, hours}] }, meet = 회의내용.
//    과제투입시간은 ✕ 로 모두 빼고 [+ 과제 추가] 메뉴로 다시 더한 뒤 숫자 칸에 쓴다.
const setWeek = (list, meet) => A.ev(`(function(){
  let g = 50; while (AWE.hrs.length && g--) document.querySelector('#awHours [data-whx="0"]').click();
  const L = ${JSON.stringify(list)};
  const put = function(id, v){ const t = document.getElementById(id); t.value = v; t.dispatchEvent(new Event('input', { bubbles: true })); };
  put('awProg', L.prog); put('awPlan', L.plan);
  //  [+ 과제 추가]는 열어 둔 채 체크로 넣는 패널이다(2026-10-30). 한 번 열고 이어서 체크한 뒤 [닫기]
  if (document.getElementById('awAddMenu').classList.contains('hidden')) document.querySelector('#awEd [data-awadd="hours"]').click();
  for (const b of L.hours) {
    const it = [].find.call(document.querySelectorAll('#awAddList [data-awaddname]'), function(x){ return x.dataset.awaddname === b.name; });
    if (!it || it.getAttribute('aria-checked') === 'true') return 'noitem:' + b.name; it.click();
  }
  document.getElementById('awAddDone').click();
  L.hours.forEach(function(b){ const i = AWE.hrs.indexOf(b.name); const h = document.querySelector('#awHours input[data-wh="' + i + '"]');
    h.value = String(b.hours); h.dispatchEvent(new Event('input', { bubbles: true })); h.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
  put('awMeet', ${JSON.stringify(meet)});
  return 'ok'; })()`);
const curWeek = () => A.J(`({ prog: AWE.prog, plan: AWE.plan, hrs: AWE.hrs.slice(), hours: awHoursFor(AWE.hrs, AWE.hours), meet: AWE.meet })`);
async function forceCloseAttend() {
  const t = (await attendTargets())[0];
  if (!t) return true;
  try {
    if (!A || A.closed || A.targetId !== t.id) { if (A) A.close(); A = await Cdp.attach(t); }
    await A.ev(`(function(){ try { AWE.armed = false; AWE.sending = false; clearTimeout(AWE.wd); clearTimeout(AWE.timer); AWE.timer = null; AWE.p = null; } catch (_) {}
      try { ATE.armed = false; ATE.sending = false; clearTimeout(ATE.timer); ATE.timer = null; ATE.p = null; } catch (_) {}
      ${LOOP_KEYS_JS}.forEach(function(k){ localStorage.removeItem(k); }); try { window.close(); } catch (_) {} return 1; })()`).catch(() => 0);
  } catch (_) { /* 붙지 못했다 */ }
  return await waitAttendTarget({ gone: true, timeout: 8000 });
}

/* ── 본체 ── */
console.log('═'.repeat(74));
console.log(`근태 주간보고 실동작 루프, 포트 ${OPT.port}, 시험 주 ${W}, ${W2}`);
console.log('═'.repeat(74));

let started = false, healthyAtEnd = null, cleaned = null, notReady = false;
let tab0 = 'personal', pcalKey = '', pcalRaw0 = undefined, kind0 = null;

async function main() {
  let mt;
  try { mt = (await pageTargets()).find((x) => isMainUrl(x.url)); }
  catch (e) { throw new Error(`CDP 에 붙지 못했다(포트 ${OPT.port}). 위젯을 TC_DEBUG_PORT=${OPT.port} 로 띄웠나요? (${e.message})`); }
  if (!mt) throw new Error(`메인 창 page 대상이 없습니다(포트 ${OPT.port})`);
  M = await Cdp.attach(mt);

  /* ── O0 전제 ── */
  head('O0 전제: 로그인, 정상 연결, 새 빌드(주간보고), 지난 실행 잔재 정리');
  if (await M.ev("typeof awOpen !== 'function' || typeof awEdOpen !== 'function' || !ATTENDWIN_CMD.has('reportWeeklyList') || !ATTENDWIN_CMD.has('netcusWeekSubmit') || !document.getElementById('awList')")) {
    notReady = true; undecide('O0 기능 존재', '위젯에 awOpen, #awList, 근태 창 허용 목록의 주간 명령이 없다. 낡은 빌드다(빌드 후 재시작)'); return;
  }
  const user = await M.ev("(typeof currentUser !== 'undefined' && currentUser && currentUser.loginId) || ''");
  if (!user) { notReady = true; undecide('O0 로그인', '위젯이 로그인 상태가 아니다'); return; }
  if (!(await M.waitFor(isHealthy, 30000, 250))) {
    notReady = true; undecide('O0 정상 연결', '시작 상태가 정상이 아니다: ' + JSON.stringify(await M.J('({ conn: conn, bootOk: bootOk, unsaved: unsaved })'))); return;
  }
  ok('O0 로그인, conn ok, bootOk', true, `login=${user}`);
  tab0 = await M.ev('PCAL.tab');
  pcalKey = await M.ev('pcPrefsKey()');
  pcalRaw0 = await M.ev(`(function(){ try { return localStorage.getItem(${JSON.stringify(pcalKey)}); } catch (_) { return null; } })()`);
  kind0 = await M.ev(`(function(){ try { return localStorage.getItem('tc_attKind'); } catch (_) { return null; } })()`);
  vlog('기록기:', await M.ev(INSTALL_M));
  ok('O0 메인 창 netcus 명령 차단(hpost)과 보고서 전송 가로채기 설치', await M.ev(`!!window.__awLoop && hpost !== window.__awLoop.orig.hpost`));
  started = true;
  if ((await attendTargets()).length) { note('떠 있던 근태 창을 닫는다'); ok('O0 떠 있던 근태 창을 닫았다', await forceCloseAttend()); }
  const left0 = await dropLoopKeys(M);
  if (left0) note(`지난 실행의 2099 주간 임시 저장 키 ${left0}건을 지웠다`);
  ok('O0 잔재 없음(근태 창 없음, 2099 키 없음)', !(await attendTargets()).length && !(await loopKeys(M)).length);

  /* ── W1 [일간][주간] ── */
  head('W1 [일간][주간]: [주간]을 누르면 주간 목록이 보이고 reportWeeklyList 를 읽는다');
  await M.ev(`(function(){ if (ATT.screen === 'edit' || ATT.screen === 'wedit') { ATT.screen = 'month'; } ATT.kind = 'day'; pcSetTab('attend', { force: true }); return 1; })()`);
  const m1 = await markM();
  ok('W1 근태 달력 머리에 [일간][주간]', same(await M.J(`[].map.call(document.querySelectorAll('#atMonth [data-atkind]'), function(b){ return b.textContent; })`), ['일간', '주간']));
  await M.ev(`(function(){ document.querySelector('#atMonth [data-atkind="week"]').click(); return 1; })()`);
  const got1 = await M.waitFor(`!AWL.loading && !!AWL.from`, 15000);
  ok('W1 주간 목록이 보이고 달력은 숨김', (await shown(M, 'awList')) && !(await shown(M, 'atMonth')));
  ok('W1 [주간]을 기억한다(tc_attKind)', (await M.ev(`localStorage.getItem('tc_attKind')`)) === 'week');
  const L1 = (await sinceM(m1)).filter((x) => x.req === 'reportWeeklyList');
  ok('W1 reportWeeklyList(52주)를 성공으로 읽었다', got1 && L1.some((x) => x.ok === true) && (await M.ev('AWL.err')) === '', JSON.stringify(L1));
  ok('W1 목록 줄 = 기록과 임시 저장의 주(번호, 제목, 기간, 상태, 날짜 다섯 칸)', await M.ev(`(function(){ const r = document.querySelectorAll('#awList tr.aw-row'); return r.length === awListItems().length && [].every.call(r, function(x){ return x.cells.length === 5; }); })()`));
  ok('W1 목록 아래 안내 줄이 없고 그 말은 [작성] 의 title, [작성]은 작은 단추', await M.ev(`(function(){ const b = document.querySelector('#awList [data-awact="new"]'); return !document.querySelector('#awList .aw-lnote') && !!b && b.classList.contains('sm') && b.title.indexOf('이 앱으로 쓴 주만') === 0; })()`));

  /* ── W2 열기 ── */
  head('W2 열기: awOpen(2099-12-07) 이 근태 창을 주간 모드로 연다. 처음 여는 주라 두 가져오기를 해 둔다');
  const m2 = await markM();
  await M.ev(`awOpen(${JSON.stringify(W)}); 1`);
  const t2 = await attachWeek(W, 25000);
  ok('W2 근태 창이 그 주의 주간 편집으로 열렸다', !!t2);
  if (!t2) { notReady = true; undecide('W2 이후', '근태 창에 붙지 못해 나머지를 증명하지 못한다'); return; }
  const L2 = await sinceM(m2);
  ok('W2 메인 창이 그 주 기록을 읽고(reportWeeklyList 하루) attendOpen(kind week)', L2.some((x) => x.req === 'reportWeeklyList' && x.from === W && x.to === W && x.ok) && L2.some((x) => x.req === 'attendOpen' && x.kind === 'week' && x.mon === W && x.ok),
    JSON.stringify(L2.map((x) => [x.req, x.from || x.mon, x.ok])));
  vlog('근태 창 기록기:', await A.ev(INSTALL_A));
  const v2 = await A.J(`({ view: ATW.view, title: document.title, head: document.getElementById('awTitle').textContent, h2: document.getElementById('awHead').textContent, subj: document.getElementById('awSubj').value,
    msg: document.getElementById('awMsg').textContent, msgCls: document.getElementById('awMsg').className, imp: document.getElementById('awImpMsg').textContent, dirty: awDirty(),
    back: document.getElementById('awBack').textContent, backIc: !!document.querySelector('#awBack svg.ic'), seg: !!document.querySelector('#awEd [data-atkind]'),
    resetInMeta: document.getElementById('awReset').parentElement === document.querySelector('#awEd .aw-meta'), how: !!document.getElementById('awSubjHow') || !!document.getElementById('awStat') || !!document.getElementById('awPvStat') })`);
  ok('W2 주간 편집만 보인다(일간 보고 화면과 목록은 숨김)', (await shown(A, 'awEd')) && !(await shown(A, 'atEd')) && !(await shown(A, 'awList')) && v2.view === 'wedit');
  ok('W2 제목 = 월요일이 든 달 기준(12월 둘째주), 머리에 기간, 문서 제목', v2.subj === '12월 둘째주' && v2.head === '12월 둘째주 (12/7~12/13)' && v2.title === '주간보고 12월 둘째주 (12/7~12/13)', JSON.stringify(v2));
  ok('W2 머리 = [‹ 목록](아이콘) | 주간 보고 ‹ 제목 (기간) ›, [전체 초기화]는 기간, 제목 줄 끝', v2.back === '목록' && v2.backIc && v2.h2 === '주간 보고' && v2.resetInMeta, JSON.stringify({ back: v2.back, h2: v2.h2 }));
  ok('W2 보이는 것을 되풀이하는 안내 글이 없다(제목 기준, 개수, 미리보기 줄 수)', !v2.how);
  ok('W2 처음 여는 주의 가져오기 결과: 바닥은 한 문장(흐린 색), 지난주 없음은 가져오기 패널, 고친 것 없음', v2.msg === '이번 주 일간 보고가 없습니다.' && v2.msgCls === 'at-msg' && v2.imp === '지난주 주간보고가 없습니다.' && !v2.dirty, JSON.stringify({ msg: v2.msg, imp: v2.imp }));

  /* ── W3 편집 ── */
  head('W3 편집: 자유 글 두 칸, 과제투입시간 목록(진행사항과 따로), 합계, 회의내용, 미리보기(인트라넷 폼 모양)');
  const P = await A.J('ATW.ctx.projects.map(function(x){ return x.name; })');
  ok('W3 payload 과제 목록 = 메인 창 내 과제 목록', same(P, await M.J('state.categories.map(function(c){ return c.name; })')), JSON.stringify(P.slice(0, 4)));
  if (P.length < 3) { undecide('W3 이후', `이 계정의 캘린더 과제가 ${P.length}개라 블록 셋을 만들 수 없다`); return; }
  const LIST = { prog: `[${P[2]}](~'28/12)\n- 루프 진행 줄\n  - 들여 쓴 줄`, plan: '- 루프 다음 주 계획', hours: [{ name: P[0], hours: 12.5 }, { name: P[1], hours: 3 }] };
  const MEET = '- 루프 회의내용';
  ok('W3 주간에 과제 블록이 없다(진행사항, 차주계획은 자유 글)', await A.ev(`!document.querySelector('#awEd .at-blk') && document.getElementById('awProg').tagName === 'TEXTAREA' && document.getElementById('awPlan').tagName === 'TEXTAREA'`));
  ok('W3 칸을 채웠다(자유 글, 과제 추가 메뉴, 시간 칸, 회의내용)', (await setWeek(LIST, MEET)) === 'ok');
  const c3 = await curWeek();
  ok('W3 과제투입시간 = 고른 과제(진행사항 글의 [과제]와 상관없다)', same(c3.hrs, [P[0], P[1]]) && same(c3.hours, { [P[0]]: 12.5, [P[1]]: 3 }), JSON.stringify(c3.hours));
  ok('W3 합계 줄', (await A.ev(`document.getElementById('awHSum').textContent`)) === '합계 15.5시간');
  await A.ev(`(function(){ awPTabSet('pv', false); awPvRender(); return 1; })()`);
  const pv3 = await A.J(`(function(){ const c = awCompose(awCur()); const box = function(k){ const e = document.querySelector('#awNf .nf-box[data-nf="' + k + '"]'); return e ? e.textContent : null; };
    return { ok: box('진행사항') === c.endwork && box('과제투입시간') === c.content && box('차주계획') === c.planwork && box('회의내용') === c.resultwork && box('미처리사항') === '' && box('문제점 및건의사항') === '',
      bg: getComputedStyle(document.getElementById('awNf')).backgroundColor, th: [].map.call(document.querySelectorAll('#awNf th'), function(t){ return t.textContent; }), c: c }; })()`);
  ok('W3 미리보기 칸 = 조립 글(미처리사항, 문제점은 빈칸)', pv3.ok, JSON.stringify(pv3.c));
  ok('W3 미리보기는 흰 바탕(테마와 상관없음)과 인트라넷 항목 여덟', pv3.bg === 'rgb(255, 255, 255)' && pv3.th.length === 8, JSON.stringify(pv3.th));
  ok('W3 진행사항 조립 = 칸의 글 그대로', pv3.c.endwork === LIST.prog);
  ok('W3 과제투입시간 조립(----- 와 합계)', pv3.c.content === `[${P[0]}] : 12.5\n[${P[1]}] : 3\n-----\n합계 : 15.5`);

  /* ── W4 임시 저장 ── */
  head('W4 임시 저장: 2초 안에 키가 생기고 메인 창 목록에 작성 중');
  const KEY = await A.ev(`awDraftKey(${JSON.stringify(W)})`);
  ok('W4 키 이름이 두 창에서 같다(tc_attWDraft:<who>:월요일)', KEY === `tc_attWDraft:${await M.ev('rptDraftWho()')}:${W}`, KEY);
  const got4 = await A.waitFor(`localStorage.getItem(${JSON.stringify(KEY)}) !== null`, 2500, 100);
  const s4 = await storedIn(M, KEY);
  ok('W4 키가 생겼고 값 = {v:2, prog, plan, hrs, hours, meet}', got4 && !!s4 && s4.v === 2 && s4.prog === LIST.prog && s4.plan === LIST.plan && same(s4.hrs, [P[0], P[1]]) && s4.meet === MEET, JSON.stringify(s4));
  await M.ev('awListRender(); 1');
  ok('W4 메인 창 목록에 그 주가 작성 중', (await M.ev(`(function(){ const r = document.querySelector('#awList tr[data-awmon="${W}"] .aw-badge'); return r ? r.textContent : ''; })()`)) === '작성 중');

  /* ── W5 이동 ── */
  head('W5 이동: › 로 다음 주(그 주 기록 읽기), ‹ 로 돌아오면 글이 그대로, 주 고르기 달력');
  ok('W5 › 를 눌렀다', (await click(A, 'awNext')) === 'ok');
  ok('W5 다음 주(2099-12-14)가 같은 창에 열렸다', !!(await attachWeek(W2, 20000)));
  ok('W5 다음 주는 깨끗하다(진행사항, 과제투입시간 없음)', (await A.ev('AWE.prog')) === '' && (await A.ev('AWE.hrs.length')) === 0);
  ok('W5 그 주 기록을 읽었다(reportWeeklyList 하루)', (await A.J('__awLoopW.log')).some((x) => x.req === 'reportWeeklyList' && x.from === W2 && x.to === W2 && x.ok));
  await click(A, 'awPrev');
  ok('W5 ‹ 로 돌아오면 글이 그대로(임시 저장)', !!(await attachWeek(W, 20000)) && same(await curWeek(), c3) && (await A.ev('AWE.meet')) === MEET);
  await click(A, 'awWeekBtn');
  const cal5 = await A.J(`({ open: !document.getElementById('awWCal').classList.contains('hidden'), head: (document.querySelector('#awWCal .aw-cmh b') || {}).textContent,
    rows: [].map.call(document.querySelectorAll('#awWCal tr.aw-cw'), function(r){ return r.dataset.awpick + '|' + r.dataset.awttl + (r.classList.contains('sel') ? '*' : ''); }) })`);
  ok('W5 주 고르기 달력 = 2099년 12월, 월요일 시작 줄, 지금 주 표시', cal5.open && cal5.head === '2099년 12월' && cal5.rows.includes(`${W}|12월 둘째주*`) && cal5.rows[0] === '2099-11-30|12월 첫째주', JSON.stringify(cal5));
  await A.ev(`(function(){ document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1; })()`);
  ok('W5 Esc 는 달력만 닫는다', (await A.ev(`document.getElementById('awWCal').classList.contains('hidden')`)) && (await shown(A, 'awEd')));

  /* ── W6 보내기(가로채기) ── */
  head('W6 보내기: 실제로 보내지 않고 막기, payload, 잠금, 연속 클릭, 실패와 성공 회신, 저장 알림');
  ok('W6 근태 창 가로채기(submitWeekly)와 netcus 차단(hpost)이 제자리', await interceptOkA());
  if (!(await interceptOkA())) throw new Error('전송 가로채기가 제자리에 없다. 실제 전송 위험이라 누르지 않는다');
  const keep6 = await curWeek();
  await A.ev(`(function(){ let g = 50; while (AWE.hrs.length && g--) document.querySelector('#awHours [data-whx="0"]').click(); return 1; })()`);
  const n6a = await A.ev('__awLoopW.cap.length');
  await click(A, 'awSend'); await sleep(100);
  ok('W6 과제투입시간에 과제가 없으면 보내지 않고 안내', (await A.ev('__awLoopW.cap.length')) === n6a && /과제투입시간에 과제가 없습니다/.test(await A.ev(`document.getElementById('awMsg').textContent`)) && !(await A.ev('AWE.sending')));
  ok('W6 칸을 다시 채웠다', (await setWeek(LIST, MEET)) === 'ok' && same(await curWeek(), keep6));
  if (!(await interceptOkA())) throw new Error('전송 가로채기가 제자리에 없다. 실제 전송 위험이라 누르지 않는다');
  const n6 = await A.ev('__awLoopW.cap.length');
  const r6 = await A.J(`(function(){ const b = document.getElementById('awSend'); b.click(); const busy = { disabled: b.disabled, label: b.textContent, meet: document.getElementById('awMeet').disabled,
    back: document.getElementById('awBack').disabled, next: document.getElementById('awNext').disabled, sending: AWE.sending }; b.click(); awSubmit(); return busy; })()`);
  ok('W6 처리 중 잠금(보고하는 중…, 회의내용, 목록, 이동)', r6.disabled && r6.label === '보고하는 중…' && r6.meet && r6.back && r6.next && r6.sending, JSON.stringify(r6));
  ok('W6 연속 클릭과 다시 부르기에도 한 번만 붙잡았다', (await A.ev('__awLoopW.cap.length')) === n6 + 1);
  const cap6 = await A.J('__awLoopW.cap[__awLoopW.cap.length - 1]');
  ok('W6 payload kind weekly, 기간(월~토), 제목', !!cap6 && cap6.kind === 'weekly' && cap6.fields.sdate === W && cap6.fields.edate === '2099-12-12' && cap6.fields.subject === '12월 둘째주', JSON.stringify(cap6 && cap6.fields));
  ok('W6 네 칸(endwork, content, planwork, resultwork), 줄 앞 공백은 &nbsp;', !!cap6 && cap6.fields.endwork === nbsp(pv3.c.endwork) && cap6.fields.content === pv3.c.content
    && cap6.fields.planwork === LIST.plan && cap6.fields.resultwork === MEET, JSON.stringify(cap6 && cap6.fields));
  const PK = await A.J('ATW.ctx.projects.slice(0, 2).map(function(x){ return x.key; })');
  const uidOf = (k) => (/^db-([0-9a-fA-F-]{36})$/.exec(k || '') || [])[1] || '';
  ok('W6 hours 구조 = 과제투입시간(이름, 공식 과제 uid, 시간)', !!cap6 && same(cap6.hours, [{ name: P[0], projectUid: uidOf(PK[0]), hours: 12.5 }, { name: P[1], projectUid: uidOf(PK[1]), hours: 3 }]), JSON.stringify(cap6 && cap6.hours));
  ok('W6 netcus 명령은 하나도 호스트로 나가지 않았다(두 창)', same(await A.J('__awLoopW.blocked'), []) && same(await M.J('__awLoop.blocked'), []));
  ok('W6 보내는 중에는 창 닫기 요청 = busy', (await A.ev('window.__winCloseRequest()')) === 'busy');
  await A.ev(`window.__netcusResult(false, '시험 실패 회신(루프)'); 1`);
  await sleep(200);
  const f6 = await A.J(`({ msg: document.getElementById('awMsg').textContent, title: document.getElementById('awMsg').title, send: document.getElementById('awSend').disabled, sending: AWE.sending })`);
  ok('W6 실패 회신 흉내 = 공통 안내(원래 문구는 title), 잠금 풀림', f6.msg === FAIL_MSG && f6.title === '시험 실패 회신(루프)' && !f6.send && !f6.sending, JSON.stringify(f6));
  ok('W6 실패해도 임시 저장이 남는다', !!(await storedIn(M, KEY)));
  if (!(await interceptOkA())) throw new Error('전송 가로채기가 제자리에 없다. 실제 전송 위험이라 누르지 않는다');
  await click(A, 'awSend'); await sleep(150);
  await A.ev(`window.__netcusResult(true, '주간보고 작성 폼을 채웠습니다(루프, 실제 전송 아님).'); 1`);
  await sleep(200);
  ok('W6 성공 회신 흉내 = 창은 남고 고친 것 없음, 임시 저장은 아직 남는다(DB 저장 알림 전)', (await attendTargets()).length === 1 && !(await A.ev('awDirty()')) && !!(await storedIn(M, KEY)));
  await A.ev(`window.__reportWeeklySaved({ periodStart: ${JSON.stringify(W)} }); 1`);
  await sleep(200);
  ok('W6 저장 알림 흉내 = 보낸 모양 그대로인 임시 저장을 지웠다, 작성한 시각', (await storedIn(M, KEY)) === null && /^작성한 시각 /.test(await A.ev(`document.getElementById('awSent').textContent`)));

  /* ── W7 창 안 목록 ── */
  head('W7 창 안 목록: [‹ 목록], [작성]은 이번 주를 그 자리에서');
  const n7 = (await A.J('__awLoopW.log')).length;
  ok('W7 [‹ 목록]을 눌렀다(묻는 창 없음)', (await click(A, 'awBack')) === 'ok' && !(await A.ev(`!!document.getElementById('awAsk')`)));
  const got7 = await A.waitFor(`ATW.view === 'wlist' && !AWL.loading && !!AWL.from`, 15000);
  ok('W7 reportWeeklyList(시간 줄 표를 읽는 질의 포함)가 오류 없이 돌아왔다(읽기만)', (await A.ev('AWL.err')) === '');
  ok('W7 창 안의 목록이 보이고 reportWeeklyList 를 읽었다', got7 && (await shown(A, 'awList')) && (await A.J('__awLoopW.log')).slice(n7).some((x) => x.req === 'reportWeeklyList' && x.ok));
  ok('W7 근태 창 목록에는 [일간][주간]이 없다', !(await A.ev(`!!document.querySelector('#awList [data-atkind]')`)));
  const TM = await A.ev('calReportPeriod(todayYmd()).mon');
  await A.ev(`(function(){ document.querySelector('#awList [data-awact="new"]').click(); return 1; })()`);
  ok('W7 [작성]이 이번 주를 그 창에서 연다', !!(await attachWeek(TM, 25000)));
  if ((await A.ev('awDirty()')) === false) await A.ev(`awGoWeek(${JSON.stringify(W)}); 1`);
  else note('이번 주에 쓰던 글이 있어 W8 은 그 주에서 확인한다');

  /* ── W8 닫기 지키기 ── */
  head('W8 닫기: 고친 글이 있어도 묻지 않고(2026-10-30) [닫기]면 창이 닫히고 키는 남는다');
  await A.waitFor(`!AWE.nav && !AWE.busy`, 15000);
  const KEY8 = await A.ev('awDraftKey(AWE.mon)');
  const own8 = KEY8.endsWith(':' + W);   // 이 루프의 2099 주일 때만 키를 남겼다가 정리에서 지운다(이번 주의 사람 글은 건드리지 않는다)
  if (own8) {
    await A.ev(`(function(){ const m = document.getElementById('awMeet'); m.value = '루프 닫기 시험'; m.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    ok('W8 쓰던 글이 있어도 __winCloseRequest() = close(창 X 는 묻지 않는다)', (await A.ev('window.__winCloseRequest()')) === 'close');
    await click(A, 'awClose').catch(() => 'closed');
    ok('W8 [닫기]면 근태 창이 닫혔다', await waitAttendTarget({ gone: true, timeout: 8000 }));
    ok('W8 닫아도 임시 저장은 남는다', ((await storedIn(M, KEY8)) || {}).meet === '루프 닫기 시험');
  } else note('2099 주로 돌아가지 못해 닫기 지키기는 건너뛴다');
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
  //  ★ 무슨 일이 있어도: 근태 창을 닫고, 두 창의 2099 주간 임시 저장 키를 지우고, 탭과 [일간][주간] 기억을 되돌린다.
  if (M && started) {
    head('정리: 근태 창 닫기, 2099 주간 임시 저장 키, 탭과 기억 되돌리기, 잔재 0');
    try {
      const closedA = await forceCloseAttend();
      if (M.closed) throw new Error('메인 창 연결이 끊겼다');
      await dropLoopKeys(M);
      await M.ev(`(function(){ try { const v = ${JSON.stringify(kind0)}; if (v == null) localStorage.removeItem('tc_attKind'); else localStorage.setItem('tc_attKind', v); ATT.kind = v === 'week' ? 'week' : 'day'; ATT.screen = 'month'; } catch (_) {} return 1; })()`);
      await M.ev(`pcSetTab(${JSON.stringify(tab0)}); 1`);
      if (pcalKey && pcalRaw0 !== undefined) await M.ev(`(function(){ try { const v = ${JSON.stringify(pcalRaw0)}; if (v == null) localStorage.removeItem(${JSON.stringify(pcalKey)}); else localStorage.setItem(${JSON.stringify(pcalKey)}, v); } catch (_) {} return 1; })()`);
      healthyAtEnd = await M.waitFor(isHealthy, 20000, 300);
      const left = { attend: (await attendTargets()).length, keys: await loopKeys(M), tab: await M.ev('PCAL.tab'), kind: await M.ev(`localStorage.getItem('tc_attKind')`) };
      cleaned = closedA && left.attend === 0 && left.keys.length === 0 && left.tab === tab0 && left.kind === kind0;
      ok('정리: 근태 창 없음, 2099 주간 키 0, 탭과 [일간][주간] 기억이 처음 그대로', cleaned, JSON.stringify(left));
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
console.log(`근태 주간보고 루프 요약, 소요 ${secs}s`);
if (F.length) { console.log(`실패 ${F.length}건:`); F.forEach((f) => console.log('  ✗ ' + f)); }
if (UD.length) { console.log(`판정 불가 ${UD.length}건:`); UD.forEach((f) => console.log('  ? ' + f)); }
if (started && healthyAtEnd === false) console.log('\n★★ 경고: 끝날 때 위젯이 정상으로 돌아오지 않았다. 화면을 확인하고 필요하면 재시작하세요.');
if (started && cleaned === false) console.log(`\n★★★ 경고: 시험 잔재를 다 지우지 못했다. 근태 창, localStorage 의 tc_attWDraft:*:2099-* 키, 메인 창 탭을 확인하세요.`);
console.log(`재현: node tests/loop-attendance-weekly.mjs --port=${OPT.port}`);
console.log(`\n통과 ${pass}, 실패 ${fail}, 판정 불가 ${undecided}`);
console.log('═'.repeat(74));
const cleanOk = !started || (cleaned !== false && healthyAtEnd !== false);
process.exit(fail > 0 || !cleanOk ? 1 : (undecided > 0 || notReady ? 2 : 0));
