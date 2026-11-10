#!/usr/bin/env node
/* =====================================================================================
 *  tests/loop-monthly-report.mjs: 월간 보고 탭 **실동작** 루프(docs/MONTHLY-REPORT-PLAN.md §5, §10.3)
 * -------------------------------------------------------------------------------------
 *  계약 시험(monthly-report.test.mjs)은 jsdom 과 가짜 회신으로 규칙을 잠근다. 이 루프는 실제 위젯(Debug, TC_DEBUG_PORT)에 붙어
 *  로그인한 사용자 자신의 근태 탭 [취합] 화면(결과 형태 월간 보고 문서)을 사람이 여는 문으로 열고, 실제 DB(구조 17)의 그림 목록 회신을 본다.
 *
 *  케이스:
 *    O0  전제: 로그인, conn ok, 새 빌드(rptMOpen), 구조 17(DB 과제에 devStartDate 칸), 가로채기 설치
 *    M1  근태 탭 [취합](결과는 월간 보고 문서 하나, v6 결정 22): 보고서 창과 옛 월간 칸(#rptMonthlyPane, #rptmSub 등)이 없고, 월간 설정과 문서 미리 보기와 저장 단추가 보임, 탭, 복사, 글 미리 보기, 보내기 단추는 없음
 *    M2  기간과 과제: 실적 기간 = 지난달(기억하는 값이 없다), 계획 기간 = 기본값, 과제 목록 = 구독한 공식 과제(내 과제 순서 그대로, ▲▼ 없음),
 *        고치는 칸 없음(입력은 날짜와 체크뿐, 머리 체크 둘과 주간보고 제목 넣기 체크 포함, v6 결정 23, v7 결정 26), 체크한 과제마다 미리 보기 표(목록 순서)
 *    L1  배치(2026-11-10 시안 v2): 왼쪽 상자 #asBoxes, 오른쪽 미리 보기 #rptmPv 가 둘 다 보이는지, 미리 보기 종이가 칸 폭에 맞게 줄었는지,
 *        과제 줄 라벨에 앱 폼 라벨 여백(위 16px)이 걸리지 않는지, 체크를 끄고 켜면 미리 보기 표가 바로 빠지고 돌아오는지(돌려 놓는다)
 *    M3  다시 읽어 오기(캘린더 기록 = 이 앱 주간보고 DB, 확인 창 없음): 과제별 실적 = 읽은 주간보고의 과제별 글(복사 글 대조는 v6 결정 22 로 복사가 없어 뺐다)
 *    M4  그림 목록: 과제 줄마다 scheduleImageList 회신(정상이면 목록, 끊겼으면 사본 목록과 안내)과 그림 단추(그림 n 또는 + 그림). 넣기, 지우기는 하지 않는다
 *    M5  저장 payload 모양(rptMPayload): 기간, 과제 uid, 본문 {level, text}, 계획 두 칸과 변경이력은 빈 배열.
 *        실제 저장은 저장 창이 떠서 사람이 한다(아래 안내)
 *    정리 가로채기를 풀고, 개인 탭으로 돌아간다(pcSetTab('personal')). 루프 동안 월간 키(rptM)를 저장소에 쓴 것이 없는지 본다(기억하는 값이 없다, 2026-10-23)
 *  2026-10-23: 월간 탭은 모으기와 읽기 전용 미리 보기만 한다(docs/MONTHLY-REPORT-PLAN.md 11.3, 15장).
 *
 *  ★ 회사 사이트로 아무것도 보내지 않는다(세 겹): hpost 가 netcus 로 시작하는 명령은 호스트로 넘기지 않는다(주간보고 읽기도),
 *    Platform.report.submitDaily, submitWeekly 를 가로채 부르면 실패로 센다, 출처는 캘린더만 쓴다.
 *  ★ DOCX 저장은 호스트가 늘 저장 창을 띄운다(시험용 경로 없음). 그래서 이 루프는 저장 버튼을 누르지 않고 PM 확인 목록을 찍는다.
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 로그인된 채(구조 17 복사본 DB) 띄운 뒤
 *    node tests/loop-monthly-report.mjs [--port=9222] [-v]
 *    종료코드: 0 통과, 1 실패, 2 판정 불가(전제가 안 서서 증명하지 못함, 초록 아님)
 * ===================================================================================== */

const ARG = new Map(process.argv.slice(2).map((a) => {
  const m = /^--?([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const OPT = { port: Number(ARG.get('port') || process.env.TC_DEBUG_PORT || 9222), verbose: ARG.has('verbose') || ARG.has('v') };
if (ARG.has('help') || ARG.has('h')) { console.log(`사용법: node tests/loop-monthly-report.mjs [--port=${OPT.port}] [-v]`); process.exit(0); }

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0, undecided = 0;
const F = [], UD = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`${el()}   ✓ ${n}${d && OPT.verbose ? ' : ' + d : ''}`); return true; }
  fail++; F.push(n + (d ? ' : ' + d : '')); console.log(`${el()}   ✗ ${n}${d ? ' : ' + String(d).slice(0, 300) : ''}`); return false;
};
const undecide = (n, d = '') => { undecided++; UD.push(n + (d ? ' : ' + d : '')); console.log(`${el()}   ? ${n}, 판정 불가${d ? ': ' + d : ''}`); };
const note = (m) => console.log(`${el()}   > ${m}`);
const head = (m) => console.log(`\n${el()} [${m}]`);

/* ── 최소 CDP(다른 루프와 같은 모양) ─────────────────────────────────── */
class Cdp {
  #ws = null; #id = 0; #p = new Map();
  static async attach(port) {
    let list;
    try { list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json(); }
    catch (e) { throw new Error(`CDP 에 붙지 못했다(포트 ${port}). 위젯을 TC_DEBUG_PORT=${port} 로 띄웠나요? (${e.message})`); }
    const t = (list || []).filter((x) => x.type === 'page' && x.webSocketDebuggerUrl)
      .find((x) => /tcapp\.local/i.test(x.url || '') && !/peer(win)?=1|[?&]win=(admin|attend)/.test(x.url || ''));
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
    if (r.exceptionDetails) { const d = r.exceptionDetails; throw new Error('페이지 JS 예외: ' + String((d.exception && (d.exception.description || d.exception.value)) || d.text)); }
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
const isOpen = (sel) => `(function(){ const m = document.querySelector(${JSON.stringify(sel)}); return !!m && !m.classList.contains('hidden') && !m.classList.contains('closing'); })()`;
const shown = (sel) => `(function(){ const e = document.querySelector(${JSON.stringify(sel)}); return !!e && getComputedStyle(e).display !== 'none'; })()`;

/* ── 가로채기: 기록하고, netcus 명령과 회사 전송은 막는다 ─────────────── */
const INSTALL = `(function(){
  if (window.__mrLoop) return 'already';
  const R = window.__mrLoop = { log: [], blocked: [], sent: [], orig: { hostRequest: hostRequest, hpost: hpost, submitDaily: Platform.report.submitDaily, submitWeekly: Platform.report.submitWeekly } };
  hostRequest = function(cmd, params, t){
    const rec = { t: Date.now(), req: cmd, projectUid: params && params.projectUid };
    R.log.push(rec);
    return R.orig.hostRequest(cmd, params, t).then(function(res){ rec.done = Date.now(); rec.res = { ok: !!(res && res.ok), stale: !!(res && res.data && res.data.stale), n: (res && res.data && Array.isArray(res.data.images)) ? res.data.images.length : null, err: res && res.error ? (res.error.message || String(res.error)) : '' }; return res; });
  };
  hpost = function(o){ if (o && /^netcus/i.test(String(o.cmd || ''))) { R.blocked.push(String(o.cmd)); return; } return R.orig.hpost(o); };
  Platform.report.submitDaily = function(){ R.sent.push('submitDaily'); };
  Platform.report.submitWeekly = function(){ R.sent.push('submitWeekly'); };
  R.orig.setItem = Storage.prototype.setItem; R.ls = [];
  Storage.prototype.setItem = function(k, v){ R.ls.push(String(k)); return R.orig.setItem.call(this, k, v); };
  return 'ok';
})()`;
const UNINSTALL = `(function(){
  const R = window.__mrLoop; if (!R) return 'none';
  hostRequest = R.orig.hostRequest; hpost = R.orig.hpost;
  Platform.report.submitDaily = R.orig.submitDaily; Platform.report.submitWeekly = R.orig.submitWeekly;
  if (R.orig.setItem) Storage.prototype.setItem = R.orig.setItem;
  delete window.__mrLoop; return 'ok';
})()`;

async function main() {
  cdp = await Cdp.attach(OPT.port);
  try {
    head('O0 전제');
    const pre = await J(`({ conn: typeof conn === 'string' ? conn : '', boot: typeof bootOk === 'undefined' ? null : bootOk, fn: typeof rptMOpen === 'function' && typeof rptMPayload === 'function',
      user: !!(currentUser && currentUser.loginId), db: dbOnline, n: dbCatalog.length, s17: dbCatalog.length ? dbCatalog.every(function(c){ return 'devStartDate' in c; }) : null })`);
    note(JSON.stringify(pre));
    if (!pre.fn) { undecide('O0 새 빌드', 'rptMOpen 이 없다(이 브랜치 빌드가 아니다)'); return; }
    if (!pre.user || pre.conn !== 'ok') { undecide('O0 로그인과 연결', JSON.stringify(pre)); return; }
    if (!pre.db || !pre.n) undecide('O0 DB 과제 목록', '공식 과제를 읽지 못했다(그림, 과제 수행 기간 판정이 약해진다)');
    else ok('O0 DB 과제에 개발 시작일 칸(구조 17)', pre.s17 === true);
    ok('O0 가로채기 설치', ['ok', 'already'].includes(await cdp.ev(INSTALL)));

    head('M1 월간 보고 탭 열기');
    //  보고서 창은 없다(2026-11-03). 근태 탭 [취합] 을 처음 값으로 새로 연다(atSumInit, 요청 없음). 결과는 월간 보고 문서 하나다(v6 결정 22).
    ok('M1 보고서 창(#reportModal)과 보고서 버튼(#btnReportTop)이 없다', await cdp.ev(`!document.getElementById('reportModal') && !document.getElementById('btnReportTop')`));
    await cdp.ev(`pcSetTab('attend'); atKindSet('sum'); atSumInit(); 1`);
    ok('M1 근태 탭 [취합] 화면(#atSum)이 보인다', await waitFor(shown('div#atSum'), 5000));
    ok('M1 월간 보고 문서(#asDocHead, #asDoc 보임)', await waitFor(`${shown('#asDocHead')} && ${shown('#asDoc')}`, 3000));
    const vis = await J(`({ band: ${shown('#asDocHead')}, doc: ${shown('#asDoc')}, text: !!document.getElementById('asText'), copy: !!document.getElementById('btnRptCopy'), tabs: !!document.getElementById('asOut'), send: !!document.getElementById('btnRptSend'), save: ${shown('#rptmSave')}, dir: !!document.getElementById('rptmOpenDir'), act: ${shown('#asDocAct')} })`);
    ok('M1 문서 값 머리 줄(#asDocHead), 문서 미리 보기, 저장 단추가 보이고, 결과 형태 탭, 과제별 글 미리 보기, 복사, 보내기 단추는 없다', vis.band && vis.doc && vis.act && vis.save && vis.dir && !vis.text && !vis.copy && !vis.tabs && !vis.send, JSON.stringify(vis));
    const gone = await J(`({ pane: !!document.getElementById('rptMonthlyPane'), grid: !!document.querySelector('.rptm-grid'), sub: !!document.getElementById('rptmSub'), rf: !!document.getElementById('rptmFrom'), rt: !!document.getElementById('rptmTo'), src: !!document.getElementById('rptmSrc'), load: !!document.getElementById('rptmLoad') })`);
    ok('M1 사라진 것이 없다(#rptMonthlyPane, .rptm-grid, #rptmSub, #rptmFrom, #rptmTo, #rptmSrc, #rptmLoad)', Object.values(gone).every((v) => v === false), JSON.stringify(gone));

    //  캘린더 기록은 이 앱 주간보고 DB 를 읽어 온다(2026-11-03). 처음 체크가 읽은 주간보고에서 정해지므로 먼저 한 번 읽는다(회사 사이트 요청 없음, DB 에 쓰지 않음).
    await cdp.ev(`document.getElementById('asLoad').click(); 1`);
    await sleep(1500);

    head('M2 기간과 과제');
    const st = await J(`({ from: __rptM.from, to: __rptM.to, lm: monthRange(new Date(), -1), plan: [__rptM.pFrom, __rptM.pTo], pd: rptMPlanDefault(__rptM.from, __rptM.to),
      fromTo: [document.getElementById('rptFrom').value, document.getElementById('rptTo').value],
      arrows: (document.getElementById('asDoc').textContent.match(/[▲▼]/g) || []).length + document.querySelectorAll('#asDoc [data-act="up"], #asDoc [data-act="down"]').length,
      order: __rptM.order, off: rptMOfficial().map(function(c){ return c.id; }), picked: rptMPicked(__rptM), cards: [].map.call(document.querySelectorAll('#rptmSheet table[data-pv-uid]'), function(c){ return c.dataset.pvUid; }),
      editors: [].filter.call(document.querySelectorAll('#asDocHead input, #asDocHead textarea, #asDocHead select, #asDocHead [contenteditable], #asBoxes input:not([data-unid-to]), #asBoxes textarea'), function(i){ return !((i.type === 'date') || (i.type === 'checkbox' && (i.matches('#rptmPick input[data-act="pick"]') || i.matches('#rptmEtc input[data-etc]') || i.matches('#rptmPickAll, #rptmEtcAll, #rptmWeekHead')))); }).length,
      terms: rptMPicked(__rptM).map(function(id){ return rptMTerm(id).text; }) })`);
    vlogJSON(st);
    ok('M2 실적 기간 = 지난달(기억하는 값이 없다), 날짜 칸 #rptFrom, #rptTo 하나뿐', st.from === st.lm[0] && st.to === st.lm[1] && st.fromTo[0] === st.from && st.fromTo[1] === st.to, JSON.stringify([st.from, st.to, st.fromTo]));
    ok('M2 계획 기간 = 기본값', st.plan[0] === st.pd.from && st.plan[1] === st.pd.to, JSON.stringify(st.plan));
    ok('M2 과제 목록 = 구독한 공식 과제 전부, 내 과제 순서 그대로', JSON.stringify(st.order) === JSON.stringify(st.off), JSON.stringify(st.order));
    ok('M2 순서 단추(▲▼) 없음', st.arrows === 0, String(st.arrows));
    ok('M2 체크한 과제마다 미리 보기 표(목록 순서)', JSON.stringify(st.cards) === JSON.stringify(st.picked), JSON.stringify(st.cards));
    ok('M2 고치는 칸 없음(입력은 날짜와 체크뿐)', st.editors === 0, String(st.editors));
    note('과제 수행 기간: ' + JSON.stringify(st.terms));

    head('L1 배치(근태 취합 화면: 시안 v2: 왼쪽 상자 #asBoxes, 오른쪽 미리 보기 #rptmPv)');
    const lay = await J(`(function(){ var wrap = document.getElementById('rptmPvWrap'), sh = document.getElementById('rptmSheet');
      var lb = document.querySelector('#rptmPick .rptm-it label.check');
      return { w: innerWidth, left: getComputedStyle(document.getElementById('asBoxes')).display, right: getComputedStyle(document.getElementById('rptmPv')).display,
        fz: sh.style.getPropertyValue('--fz'), sheetW: sh.getBoundingClientRect().width, wrapW: wrap.clientWidth, lbTop: lb ? getComputedStyle(lb).marginTop : null, lbW: lb ? getComputedStyle(lb).fontWeight : null }; })()`);
    vlogJSON(lay);
    ok('L1 왼쪽 상자와 오른쪽 미리 보기가 둘 다 보인다', lay.left !== 'none' && lay.right !== 'none', JSON.stringify(lay));
    ok('L1 미리 보기 종이가 칸 폭 안에 맞게 줄었다', !!lay.fz && lay.sheetW <= lay.wrapW + 1, JSON.stringify([lay.fz, lay.sheetW, lay.wrapW]));
    if (lay.lbTop == null) undecide('L1 과제 줄 라벨 여백', '과제 줄이 없다');
    else ok('L1 과제 줄 라벨에 앱 폼 라벨 여백과 굵기가 걸리지 않는다', lay.lbTop === '0px' && String(lay.lbW) === '400', JSON.stringify([lay.lbTop, lay.lbW]));
    //  체크를 끄고 켜면 미리 보기 표가 바로 빠지고 돌아온다(원래대로 돌려 놓는다)
    //  v7 결정 29: 읽은 뒤에는 기록 있는 과제만 체크라 기록이 없는 달이면 체크가 0 이다. 그때는 첫 과제를 켜고 보고 끈다(돌려 놓는다).
    const live = await J(`(function(){ var id = rptMPicked(__rptM)[0], tmp = false; if (!id && __rptM.order.length) { id = __rptM.order[0]; tmp = true; __rptM.checked[id] = true; rptMRenderAll(); } if (!id) return null; var cb = [].find.call(document.querySelectorAll('#rptmPick .rptm-it'), function(r){ return r.dataset.uid === id; }).querySelector('input[data-act="pick"]');
      var has = function(){ return [].some.call(document.querySelectorAll('#rptmSheet table[data-pv-uid]'), function(t){ return t.dataset.pvUid === id; }); };
      cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); var off = has();
      cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); var on = has(); if (tmp) { __rptM.checked[id] = false; rptMRenderAll(); } return { off: off, on: on }; })()`);
    if (!live) undecide('L1 체크와 미리 보기', '체크한 과제가 없다');
    else ok('L1 체크를 끄면 미리 보기 표가 바로 빠지고, 켜면 바로 돌아온다', live.off === false && live.on === true, JSON.stringify(live));

    head('M3 다시 읽어 오기(캘린더 기록 = 이 앱 주간보고 DB)');
    //  출처는 캘린더 기록(#rptSrcSeg data-rsrc="cal")만 쓴다. 이 앱 주간보고 DB 를 읽는다(reportWeeklyList). 인트라넷 주간(week)은 실제로 읽지 않는다(회사 사이트).
    await cdp.ev(`(function(){ const b = document.querySelector('#rptSrcSeg [data-rsrc="cal"]'); if (b) b.click(); return 1; })()`);
    await cdp.ev(`document.getElementById('asLoad').click(); 1`);
    await sleep(1500);
    ok('M3 같은 기간 읽어 오기에 확인 창이 뜨지 않는다', !(await cdp.ev(isOpen('#confirmModal'))));
    const cmp = await J(`(function(){ var c = netcusWeeklyMerge; if (!c || !c.parsed || c.src !== 'cal') return ['읽은 결과 없음']; var a = rptMBuildWeek(c.parsed), m = rptMAuto(__rptM); var bad = []; if (!m) return ['문서 글 없음']; rptMPicked(__rptM).forEach(function(id){ if ((m.proj.get(id) || '') !== (a.proj.get(id) || '')) bad.push(id); }); return bad; })()`);
    ok('M3 과제별 실적 = 읽은 주간보고의 과제별 글', cmp.length === 0, JSON.stringify(cmp));
    //  (예전에는 복사 글과 문서가 같은 읽기 결과인지 보았다. 취합 복사는 v6 결정 22 로 없앴다)

    head('M4 그림 목록');
    await cdp.ev(`atSumInit(); 1`);   // 처음 값으로 다시 열면 그림 목록을 다시 묻는다(요청은 DB 그림 목록뿐)
    const ids = st.order;
    const okList = await waitFor(`(function(){ var L = __mrLoop.log.filter(function(x){ return x.req === 'scheduleImageList' && x.done; }); return L.length >= ${ids.length}; })()`, 20000);
    const L = await J(`__mrLoop.log.filter(function(x){ return x.req === 'scheduleImageList'; })`);
    if (!ids.length) undecide('M4 그림 목록', '구독한 공식 과제가 없다');
    else {
      ok('M4 과제 줄마다 scheduleImageList 회신', okList, JSON.stringify(L.map((x) => [x.projectUid, x.res])));
      //  2026-11-10 시안 v2 결정 8: 과제 줄마다 그림 칸 하나(비면 넣기 단추, 있으면 썸네일). 넣기, 빼기는 하지 않는다
      const slots = await J(`[].map.call(document.querySelectorAll('#rptmPick [data-slot]'), function(s){ return s.querySelector('[data-act="imgZoom"]') ? 'has' : s.querySelector('[data-act="imgAdd"]') ? 'empty' : '?'; })`);
      ok('M4 과제 줄마다 그림 칸 하나(썸네일 또는 넣기 단추)', slots.length === ids.length && slots.every((s) => s === 'has' || s === 'empty'), JSON.stringify(slots));
      ok('M4 미리 보기 쪽에는 그림 버튼이 없다', (await cdp.ev(`document.querySelectorAll('#rptmPvWrap button').length`)) === 0);
      for (const x of L.filter((y) => y.res)) note(`${x.projectUid}: ${x.res.ok ? '정상' : x.res.stale ? '사본 목록(끊김)' : '실패'} ${x.res.n == null ? '' : x.res.n + '장'} ${x.res.err || ''}`);
    }

    head('M5 저장 payload 모양');
    const p = await J('rptMPayload(__rptM)');
    ok('M5 기간, 작성일, 과제, 본문 줄 모양', !!p && /^\d{4}-\d{2}-\d{2}$/.test(p.reportDate) && p.actual && p.plan && Array.isArray(p.projects)
      && p.projects.every((x) => /^db-/.test(x.uid) && Array.isArray(x.actual) && x.actual.every((l) => Number.isInteger(l.level) && l.level >= 0 && l.level <= 3 && typeof l.text === 'string' && l.text === l.text.replace(/^[ \t ]+/, ''))), JSON.stringify(p && p.projects && p.projects.map((x) => x.uid)));
    ok('M5 과제명은 공식 이름, 계획 두 칸과 변경이력은 빈 배열(문서에서 빈칸)', !!p && p.projects.every((x) => x.title === '' + x.title && JSON.stringify([x.prevPlan, x.nextPlan, x.changes]) === '[[],[],[]]'));
    const blocked = await J('__mrLoop');
    ok('회사로 보낸 것 없음(Platform.report 0회)', blocked.sent.length === 0, JSON.stringify(blocked.sent));
    if (blocked.blocked.length) note('막은 netcus 명령: ' + blocked.blocked.join(', '));
    ok('월간 키를 저장소에 쓰지 않았다(기억하는 값이 없다)', !blocked.ls.some((k) => /rptM|rptm|monthly/i.test(k)), JSON.stringify(blocked.ls));

    console.log(`\n${el()} [PM 이 눈으로 볼 것: DOCX 저장은 저장 창이 떠서 루프가 누르지 않는다]
    1. 근태 [취합] 월간 보고 문서의 [DOCX 저장] → 저장 창 기본 이름이 월간보고_<이름>_<작성일 YYMMDD>.docx 인지, 임시 폴더(예: %TEMP%)에 저장
    2. 성공 토스트에 경로와 [폴더 열기], 아래쪽 [폴더 열기] 버튼이 그 폴더를 여는지
    3. 같은 파일을 Word 로 연 채 다시 저장 → "파일이 열려 있어" 이유가 그대로 뜨는지
    4. 저장한 문서를 Word 와 한컴에서 열어 과제 표, 과제 수행 기간, 개발 일정 그림, 실적 들여쓰기, 기타 표를 보기
    5. 그림: 과제 줄의 [그림 n] 또는 [+ 그림]으로 서랍을 열어 [파일 고르기], [붙여넣기], 그 줄이나 서랍에 마우스를 두고 Ctrl+V, 줄을 누른 뒤 Ctrl+V,
       ◀▶ 순서, ✕ 삭제 확인 창. 탭을 닫았다 열어도 [그림 n] 이 보이는지. 다른 계정에서는 그 그림이 **보이지 않는지**(사람별 그림)
    6. 출처 [주간보고]는 netcus 를 실제로 읽는다(로그인). QA 중에는 읽기만 하고, 호스트 로그에 NetcusSubmit, NetcusWeekFill 이 없는지 본다
    7. 주간보고 출처에서 내 과제와 맞지 않은 [과제] 가 왼쪽 칸 미식별 항목(읽기만, 접기)에 나오고 문서에 없는지
    9. 넓은 창(900px 이상)에서 왼쪽 칸과 오른쪽 미리 보기가 따로 스크롤되는지, 위젯 폭(400px)에서 [설정] [미리 보기] 세그로 오가는지
   10. 기타 표 [고르기] 로 칩을 펼쳐 빼면 오른쪽 기타 표가 바로 바뀌는지, 탭을 다시 열면 모두 넣음(기억하지 않음)인지
    8. 저장한 문서의 수행 계획 두 칸이 비어 있고 일정 변경이력이 빈 줄 하나인지, 과제명이 공식 이름인지`);
  } finally {
    try {
      await cdp.ev(UNINSTALL);
      await cdp.ev(`(function(){ ['#confirmModal'].forEach(function(s){ try { const m = document.querySelector(s); if (m && !m.classList.contains('hidden')) closeModal(s); } catch (_) {} }); pcSetTab('personal'); return 1; })()`);
    } catch (e) { console.log('정리 실패: ' + e.message); fail++; }
    cdp.close();
  }
}
function vlogJSON(o) { if (OPT.verbose) console.log(el(), '   >', JSON.stringify(o)); }

main().then(() => {
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패 / ${undecided} 판정 불가 (${el()})`);
  if (F.length) console.log('실패:\n  ' + F.join('\n  '));
  if (UD.length) console.log('판정 불가:\n  ' + UD.join('\n  '));
  process.exit(fail ? 1 : undecided ? 2 : 0);
}).catch((e) => { console.log('루프 중단: ' + (e && e.message || e)); process.exit(2); });
