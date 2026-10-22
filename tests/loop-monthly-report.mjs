#!/usr/bin/env node
/* =====================================================================================
 *  tests/loop-monthly-report.mjs: 월간 보고 탭 **실동작** 루프(docs/MONTHLY-REPORT-PLAN.md §5, §10.3)
 * -------------------------------------------------------------------------------------
 *  계약 시험(monthly-report.test.mjs)은 jsdom 과 가짜 회신으로 규칙을 잠근다. 이 루프는 실제 위젯(Debug, TC_DEBUG_PORT)에 붙어
 *  로그인한 사용자 자신의 보고서 창 '월간 보고' 탭을 사람이 여는 문으로 열고, 실제 DB(구조 17)의 그림 목록 회신을 본다.
 *
 *  케이스:
 *    O0  전제: 로그인, conn ok, 새 빌드(rptMOpen), 구조 17(DB 과제에 devStartDate 칸), 가로채기 설치
 *    M1  보고서 버튼 → 월간 보고 탭: 월간 표시, 기존 레일 칸과 미리보기, 보내기와 복사 버튼이 안 보임, 월간 버튼이 보임
 *    M2  기간과 과제: 실적 기간 = 지난달, 계획 기간 = 기본값, 과제 목록 = 구독한 공식 과제(내 순서), 체크한 과제마다 카드
 *    M3  다시 읽어 오기(캘린더, 확인 창): 카드 실적 = 기간 취합 복사 글의 과제 블록(글자 그대로), 계획 칸과 변경이력은 그대로
 *    M4  그림 목록: 카드마다 scheduleImageList 회신(정상이면 목록, 끊겼으면 사본 목록과 안내). 넣기, 지우기는 하지 않는다
 *    M5  저장 payload 모양(rptMPayload): 기간, 과제 uid, 본문 {level, text}. 실제 저장은 저장 창이 떠서 사람이 한다(아래 안내)
 *    정리 이 루프가 바꾼 초안 키를 원래 값으로 되돌리고, 가로채기를 풀고, 보고서 창을 닫는다
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
  return 'ok';
})()`;
const UNINSTALL = `(function(){
  const R = window.__mrLoop; if (!R) return 'none';
  hostRequest = R.orig.hostRequest; hpost = R.orig.hpost;
  Platform.report.submitDaily = R.orig.submitDaily; Platform.report.submitWeekly = R.orig.submitWeekly;
  delete window.__mrLoop; return 'ok';
})()`;

async function main() {
  cdp = await Cdp.attach(OPT.port);
  let draftKey = null, draftWas = null, snap = null;
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
    if (await cdp.ev(isOpen('#reportModal'))) { await cdp.ev("closeModal('#reportModal'); 1"); await sleep(450); }
    await cdp.ev(`(function(){ const b = document.getElementById('btnReportTop'); if (b) b.click(); else openReport(); return 1; })()`);
    ok('M1 보고서 창이 열린다', await waitFor(isOpen('#reportModal'), 5000));
    await cdp.ev(`document.querySelector('#reportModal [data-rmode="monthly"]').click(); 1`);
    ok('M1 월간 표시(rptm-on)', await waitFor(`document.getElementById('reportModal').classList.contains('rptm-on')`, 3000));
    const vis = await J(`({ pane: ${shown('#rptMonthlyPane')}, send: ${shown('#btnRptSend')}, copy: ${shown('#btnRptCopy')}, rail: ${shown('#rptSourceRow')} || ${shown('.rpt-range')}, prev: ${shown('.rpt-preview')}, save: ${shown('#rptmSave')}, tabs: ${shown('.rpt-presets')} })`);
    ok('M1 월간 영역과 탭 줄이 보이고, 보내기, 복사, 기존 레일 칸, 미리보기는 숨는다', vis.pane && vis.tabs && vis.save && !vis.send && !vis.copy && !vis.rail && !vis.prev, JSON.stringify(vis));

    head('M2 기간과 과제');
    const st = await J(`({ from: __rptM.from, to: __rptM.to, lm: monthRange(new Date(), -1), plan: [__rptM.pFrom, __rptM.pTo], pd: rptMPlanDefault(__rptM.from, __rptM.to), planEdited: __rptM.planEdited,
      order: __rptM.order, off: rptMOfficial().map(function(c){ return c.id; }), picked: rptMPicked(__rptM), cards: [].map.call(document.querySelectorAll('#rptmCards .rptm-card[data-uid]'), function(c){ return c.dataset.uid; }),
      terms: rptMPicked(__rptM).map(function(id){ return rptMTerm(id).text; }) })`);
    vlogJSON(st);
    draftKey = await cdp.ev('rptMDraftKey(__rptM.from, __rptM.to)');
    draftWas = await cdp.ev(`(function(){ try { return localStorage.getItem(${JSON.stringify(draftKey)}); } catch (_) { return null; } })()`);
    //  월간 초안 키를 통째로 받아 둔다(이 루프의 저장이 6건 정리로 남의 초안을 밀어내도 정리에서 그대로 되돌린다)
    snap = await J(`(function(){ var o = {}; try { for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf('tc_rptDraftM:') === 0) o[k] = localStorage.getItem(k); } } catch (_) {} return o; })()`);
    if (draftWas == null) ok('M2 초안이 없으면 실적 기간 = 지난달', st.from === st.lm[0] && st.to === st.lm[1], JSON.stringify([st.from, st.to]));
    else note('이 기간 초안이 이미 있어 기간 기본값은 보지 않는다: ' + draftKey);
    if (!st.planEdited) ok('M2 계획 기간 = 기본값', st.plan[0] === st.pd.from && st.plan[1] === st.pd.to, JSON.stringify(st.plan));
    ok('M2 과제 목록 = 구독한 공식 과제 전부', JSON.stringify([...st.order].sort()) === JSON.stringify([...st.off].sort()), JSON.stringify(st.order));
    ok('M2 체크한 과제마다 카드(목록 순서)', JSON.stringify(st.cards) === JSON.stringify(st.picked), JSON.stringify(st.cards));
    note('과제 수행 기간: ' + JSON.stringify(st.terms));

    head('M3 다시 읽어 오기(캘린더)');
    await cdp.ev(`(function(){ const b = document.querySelector('#rptmSrc [data-msrc="cal"]'); if (b) b.click(); return 1; })()`);
    const ids = st.picked;
    const mine = await J(`(function(){ var o = {}; rptMPicked(__rptM).forEach(function(id){ var c = __rptM.cards[id]; o[id] = { prev: c.prev, next: c.next, ch: JSON.stringify(c.changes) }; }); return o; })()`);
    await cdp.ev(`document.getElementById('rptmLoad').click(); 1`);
    if (await waitFor(isOpen('#confirmModal'), 4000)) {
      await cdp.ev(`document.getElementById('cfOk').click(); 1`);
      await waitFor(`!${isOpen('#confirmModal')}`, 4000);
      await sleep(400);
      const cmp = await J(`(function(){ var a = rptMBuildCal(__rptM.from, __rptM.to); var bad = []; rptMPicked(__rptM).forEach(function(id){ if (__rptM.cards[id].actual !== (a.proj.get(id) || '')) bad.push(id); }); return bad; })()`);
      ok('M3 카드 실적 = 캘린더 과제별 글', cmp.length === 0, JSON.stringify(cmp));
      //  기간 취합 복사 글과 글자 그대로(같은 기간으로 탭을 바꿔 보고 돌아온다)
      const eq = await J(`(function(){ var S = __rptM, etc = rptMAuto(S, false).etc; var joined = state.categories.map(function(c){ var t = isOfficialCat(c) ? (S.cards[c.id] ? S.cards[c.id].actual : '') : (etc.find(function(e){ return e.key === c.id; }) || { text: '' }).text; return '[' + c.name + ']' + (t ? '\\n' + t : ''); }).join('\\n\\n') + '\\n';
        var f0 = $('#rptFrom').value, t0 = $('#rptTo').value; setReportMode('custom'); $('#rptFrom').value = S.from; $('#rptTo').value = S.to; var prefs = loadRptSourcePrefs().weekly; buildReport(); var copy = buildReportText(); var skip = !!prefs.skipEmpty; $('#rptFrom').value = f0; $('#rptTo').value = t0; setReportMode('monthly'); return { same: joined === copy, skip: skip, a: joined.length, b: copy.length }; })()`);
      if (eq.skip) undecide('M3 기간 취합 글과 글자 비교', '기간 취합에 "내용 없는 항목 제외" 가 켜져 있어 블록 수가 달라 비교하지 않는다');
      else ok('M3 이어 붙인 실적 글 = 기간 취합 복사 글(글자 그대로)', eq.same, JSON.stringify(eq));
      const after = await J(`(function(){ var o = {}; rptMPicked(__rptM).forEach(function(id){ var c = __rptM.cards[id]; o[id] = { prev: c.prev, next: c.next, ch: JSON.stringify(c.changes) }; }); return o; })()`);
      ok('M3 계획 칸과 변경이력은 그대로', JSON.stringify(after) === JSON.stringify(mine));
    } else undecide('M3 확인 창', '같은 기간 읽어 오기에 확인 창이 뜨지 않았다');

    head('M4 그림 목록');
    await cdp.ev(`setReportMode('custom'); setReportMode('monthly'); 1`);
    const okList = await waitFor(`(function(){ var L = __mrLoop.log.filter(function(x){ return x.req === 'scheduleImageList' && x.done; }); return L.length >= ${ids.length}; })()`, 20000);
    const L = await J(`__mrLoop.log.filter(function(x){ return x.req === 'scheduleImageList'; })`);
    if (!ids.length) undecide('M4 그림 목록', '체크한 공식 과제가 없다');
    else {
      ok('M4 체크한 과제마다 scheduleImageList 회신', okList, JSON.stringify(L.map((x) => [x.projectUid, x.res])));
      for (const x of L.filter((y) => y.res)) note(`${x.projectUid}: ${x.res.ok ? '정상' : x.res.stale ? '사본 목록(끊김)' : '실패'} ${x.res.n == null ? '' : x.res.n + '장'} ${x.res.err || ''}`);
    }

    head('M5 저장 payload 모양');
    const p = await J('rptMPayload(__rptM)');
    ok('M5 기간, 작성일, 과제, 본문 줄 모양', !!p && /^\d{4}-\d{2}-\d{2}$/.test(p.reportDate) && p.actual && p.plan && Array.isArray(p.projects)
      && p.projects.every((x) => /^db-/.test(x.uid) && Array.isArray(x.actual) && x.actual.every((l) => Number.isInteger(l.level) && l.level >= 0 && l.level <= 3 && typeof l.text === 'string' && l.text === l.text.replace(/^[ \t ]+/, ''))), JSON.stringify(p && p.projects && p.projects.map((x) => x.uid)));
    const blocked = await J('__mrLoop');
    ok('회사로 보낸 것 없음(Platform.report 0회)', blocked.sent.length === 0, JSON.stringify(blocked.sent));
    if (blocked.blocked.length) note('막은 netcus 명령: ' + blocked.blocked.join(', '));

    console.log(`\n${el()} [PM 이 눈으로 볼 것: DOCX 저장은 저장 창이 떠서 루프가 누르지 않는다]
    1. 월간 보고 탭 아래 [DOCX 저장] → 저장 창 기본 이름이 월간보고_<이름>_<작성일 YYMMDD>.docx 인지, 임시 폴더(예: %TEMP%)에 저장
    2. 성공 토스트에 경로와 [폴더 열기], 아래쪽 [폴더 열기] 버튼이 그 폴더를 여는지
    3. 같은 파일을 Word 로 연 채 다시 저장 → "파일이 열려 있어" 이유가 그대로 뜨는지
    4. 저장한 문서를 Word 와 한컴에서 열어 과제 표, 과제 수행 기간, 개발 일정 그림, 실적 들여쓰기, 기타 표를 보기
    5. 그림: 카드에서 [파일 고르기]와 [붙여넣기](잘라 복사한 그림), ◀▶ 순서, [삭제] 확인 창, 다른 계정에서 같은 그림이 보이는지
    6. 출처 [주간보고]는 netcus 를 실제로 읽는다(로그인). QA 중에는 읽기만 하고, 호스트 로그에 NetcusSubmit, NetcusWeekFill 이 없는지 본다`);
  } finally {
    try {
      if (snap) await cdp.ev(`(function(){ var S = ${JSON.stringify(snap)}; try { var a = []; for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf('tc_rptDraftM:') === 0 && !(k in S)) a.push(k); }
        a.forEach(function(k){ localStorage.removeItem(k); }); Object.keys(S).forEach(function(k){ localStorage.setItem(k, S[k]); }); } catch (_) {} clearTimeout(__rptMTimer); __rptM = null; return 1; })()`);
      await cdp.ev(UNINSTALL);
      await cdp.ev(`(function(){ ['#confirmModal', '#reportModal'].forEach(function(s){ try { const m = document.querySelector(s); if (m && !m.classList.contains('hidden')) closeModal(s); } catch (_) {} }); return 1; })()`);
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
