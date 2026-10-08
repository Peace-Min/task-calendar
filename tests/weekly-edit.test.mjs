// 주간 보고서 글 편집(docs/WEEKLY-EDIT.md, 2026-10-08) — §7 시험.
//
// 이 파일이 지키는 것:
//   (S) 정적: 주간 날짜 줄 ✎ 없음(기간 취합만 남음) · 주간 전송이 buildWeeklyFields / buildNetcus* 를 감싼다(시그니처, 반환 키 그대로) ·
//       확인창을 새로 넣지 않는다 · 임시 저장 키 접두 tc_rptDraftW: 와 PEER 관문 · 채우기 성공 회신은 주간 초안을 건드리지 않는다.
//   (B) jsdom 브라우저 모드(cal 출처): 고친 것도 뺀 것도 없으면 네 칸과 복사가 예전과 바이트 같음(서식 여러 벌, 실제 전송, 복사) ·
//       글 편집(잠긴 머리 줄, 제목, 진행사항 &nbsp; 들여쓰기, 차주계획, 읽기 전용 과제투입시간) · X(제자리, 네 칸과 합계에서 빠짐, 되돌리기) ·
//       동명 과제 · 임시 저장(접두, 닫고 열기, 재시작, 기간별, 14일 정리와 일간 키 분리, 렌더는 쓰지 않음, 막힌 저장소) · custom 그대로.
//   (W) jsdom 위젯 모드(net 출처): 바이트 같음(netcus 조립과) · X 와 고친 글이 출처를 바꿔도 따라옴 · [미분류] 행 · 채우기 성공 회신으로 안 지워짐.
//   (P) 열람 창(PEER): 주간 임시 저장 접근 0.
//   (M) 변이: 위 계약을 되돌리면 같은 검사기가 잡는다.
// ★ 실제 netcus 채우기는 없다. Platform.report.submitWeekly 를 가로채 payload 만 본다.
// 생략 규약: jsdom 이 없으면 (B)(W)(P)와 그에 기대는 변이는 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 120));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 120));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
const countOf = (hay, needle) => hay.split(needle).length - 1;
function weeklySendBranch(src) {
  const a = src.indexOf("rptDraftDisarmSend();   // 주간 채우기 회신");
  const b = src.indexOf("$('#btnRooms').addEventListener", a);
  assert.ok(a > 0 && b > a, '주간 전송 갈래를 찾지 못했다');
  return src.slice(a, b);
}

// ══════════════════════════════════════════════════════════════════════
// (S) 정적 검사기
// ══════════════════════════════════════════════════════════════════════
const S = {
  //  §3.2 — 주간 카드의 날짜 줄은 읽기 전용, 기간 취합만 ✎. 처리기는 기간 취합이 써서 남는다.
  noWeeklyDayNoteEdit(src) {
    const br = extractFunction(src, 'buildReport');
    assert.ok(br.includes('reportDayLinesHtml(m, !weekly, spanMulti)'), '주간 카드의 날짜 줄이 읽기 전용이 아니다(기간 취합만 ✎ 여야 한다)');
    assert.ok(!br.includes('reportDayLinesHtml(m, true, spanMulti)'), '날짜 줄 ✎ 를 늘 여는 호출이 남아 있다');
    assert.strictEqual(typeof extractFunction(src, 'commitDayNoteEdit'), 'string', '대조군: 기간 취합 날짜 줄 저장(commitDayNoteEdit)은 남는다');
  },
  //  §4 — 주간 전송은 예전 조립을 감싼다. buildWeeklyFields 의 시그니처와 반환 키는 그대로. 확인창은 새로 없다.
  sendWraps(src) {
    const wf = extractFunction(src, 'buildWeeklyFields');
    assert.ok(wf.startsWith('function buildWeeklyFields(from, to, sources){'), 'buildWeeklyFields 시그니처가 바뀌었다');
    assert.ok(wf.includes('return { content, endwork, planwork, subject: weekSubjectGuess(from) };'), 'buildWeeklyFields 반환 키가 바뀌었다');
    const o = extractFunction(src, 'rptWOutFields');
    assert.ok(o.includes('base = buildWeeklyFields(from, to, rptSources());') && o.includes('buildNetcusSendText(p)') && o.includes('buildNetcusHoursText(p)') && o.includes('buildNetcusPlanText(p)'), 'rptWOutFields 가 예전 조립을 감싸지 않는다');
    assert.ok(/if\(!L\.any\) return base;/.test(o), '초안이 닿지 않으면 예전 결과를 그대로 돌려주지 않는다');
    const w = weeklySendBranch(src);
    assert.strictEqual(countOf(w, 'rptWOutFields(from, to)'), 2, '주간 전송(net, cal)이 둘 다 rptWOutFields 를 쓰지 않는다');
    assert.ok(!w.includes('confirmBox('), '주간 전송에 확인창이 생겼다(§6)');
  },
  //  §5 — 주간 키 접두는 tc_rptDraftW: (tc_rptDraft:<date> 꼴이 아니다). 임시 저장 함수는 PEER 를 저장소보다 먼저 본다.
  storageKeys(src) {
    assert.ok(src.includes("const RPT_WDRAFT_PREFIX = 'tc_rptDraftW:';"), '주간 키 접두가 tc_rptDraftW: 가 아니다');
    assert.ok(!'tc_rptDraftW:'.startsWith('tc_rptDraft:'), '주간 접두가 일간 접두로 시작한다');
    for (const fn of ['rptWDraftGet', 'rptWDraftPut', 'rptWDraftPrune']) {
      const b = extractFunction(src, fn);
      const g = b.indexOf('PEER');
      const touch = Math.min(...['localStorage', '__rptDraftMem.set', '__rptDraftDirty.add'].map(t => { const i = b.indexOf(t); return i < 0 ? Infinity : i; }));
      assert.ok(g > 0 && g < touch, `${fn} 가 PEER 를 저장소보다 먼저 보지 않는다`);
    }
    //  채우기 성공 회신(일간 대기 표지 처리)은 주간 초안을 모른다
    assert.ok(!/rptW|RPT_WDRAFT/.test(extractFunction(src, 'rptDraftOnSendResult')), '전송 회신 처리가 주간 초안에 닿는다(채우기 성공으로 지우면 안 된다)');
  },
};
test('WS1 (§3.2): 주간 날짜 줄 ✎ 없음 · 기간 취합만 남음', () => S.noWeeklyDayNoteEdit(app));
test('WS2 (§4·§6): 주간 전송은 buildWeeklyFields / buildNetcus* 를 감싼다(시그니처, 반환 키 그대로) · 확인창 없음', () => S.sendWraps(app));
test('WS3 (§5): 주간 키 접두 tc_rptDraftW: · PEER 관문 · 회신 처리는 주간 초안을 모른다', () => S.storageKeys(app));
test('WS4 (§7): 새 문구에 엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점이 없다', () => {
  const phrases = ['미처리사항, 문제점 및 건의사항, 회의내용은 열린 회사 화면에서 직접 쓰세요.', '고친 칸 ', '이번 주 ',
    '회사 주간보고 폼과 같은 순서입니다. 회색 머리 줄과 과제투입시간은 카드에서 정해지고, 나머지는 자유롭게 씁니다. 채우기와 복사는 이 글 그대로 나갑니다. ',
    '이 칸의 고친 내용을 버리고 초안으로 되돌릴까요?', '이 기간의 고친 칸과 뺀 과제를 모두 버리고 초안으로 되돌릴까요?', '계획 없음(쓰려면 여기를 누르세요)',
    '시간 기록 없음', '과제는 카드에서 정합니다', '제목 초안으로 되돌리기', '주간보고 제목',
    'netcus 일간보고를 합친 초안입니다. 고친 글은 회사 일간보고를 바꾸지 않습니다'];
  for (const p of phrases) {
    assert.ok(app.includes(p), '문구가 앱에 없다: ' + p);
    assert.ok(!/—|–|「|」|(^|\s)·|·(\s|$)/.test(p), '금지 기호: ' + p);
  }
});
//  정정 6: 실 위젯 루프는 정리에서 출처를 시작할 때 받아 둔 값으로 되돌린다(늘 cal 로 두지 않는다).
import { readFileSync } from 'node:fs';
const loopSrc = readFileSync(new URL('./loop-weekly-edit.mjs', import.meta.url), 'utf8');
function loopRestoresSource(src) {
  const fin = src.slice(src.indexOf('} finally {'));
  assert.ok(/srcState0 = await cdp\.ev\('state\.reportSource'\);/.test(src), '루프가 시작할 때 출처를 받아 두지 않는다');
  assert.ok(fin.includes('state.reportSource = ${JSON.stringify(srcState0)};'), '루프 정리가 받아 둔 출처(srcState0)로 되돌리지 않는다');
  assert.ok(!/state\.reportSource = \$\{JSON\.stringify\(srcState0 === /.test(fin), '루프 정리가 출처를 조건으로 바꿔 되돌린다(받아 둔 값 그대로가 아니다)');
}
test('WS5 (정정 6): 실 위젯 루프는 정리에서 원래 출처(srcState0)를 그대로 되돌린다', () => loopRestoresSource(loopSrc));
test('변이 WSM4: 루프 정리를 늘 cal 로 되돌리게 하면 WS5 가 잡는다', () => {
  assert.throws(() => loopRestoresSource(mutate(loopSrc, 'state.reportSource = ${JSON.stringify(srcState0)}; syncReportSourceSeg(); 1`)', "state.reportSource = ${JSON.stringify(srcState0 === 'week' ? 'cal' : 'cal')}; 1`)")), /srcState0/);
});
test('변이 WSM1: 주간 날짜 줄 ✎ 를 되살리면 WS1 이 잡는다', () => {
  assert.throws(() => S.noWeeklyDayNoteEdit(mutate(app, 'reportDayLinesHtml(m, !weekly, spanMulti)', 'reportDayLinesHtml(m, true, spanMulti)')), /읽기 전용|늘 여는/);
});
test('변이 WSM2: 감싸기를 빼거나 확인창을 넣으면 WS2 가 잡는다', () => {
  assert.throws(() => S.sendWraps(mutate(app, '  if(!L.any) return base;\n', '')), /그대로 돌려주지 않는다/);
  assert.throws(() => S.sendWraps(mutate(app, "      const wf = rptWOutFields(from, to);", "      const wf = buildWeeklyFields(from, to, rptSources());")), /둘 다/);
  assert.throws(() => S.sendWraps(mutate(app, "        const wo = rptWOutFields(from, to);", "        if(await confirmBox('주간', 'x') !== 'ok') return; const wo = rptWOutFields(from, to);")), /확인창/);
});
test('변이 WSM3: 주간 접두를 일간 접두로 바꾸거나 PEER 관문을 빼면 WS3 이 잡는다', () => {
  assert.throws(() => S.storageKeys(mutate(app, "const RPT_WDRAFT_PREFIX = 'tc_rptDraftW:';", "const RPT_WDRAFT_PREFIX = 'tc_rptDraft:';")), /접두/);
  assert.throws(() => S.storageKeys(mutate(app, '  if(PEER || !_rptWValid(from, to)) return empty;', '  if(!_rptWValid(from, to)) return empty;')), /rptWDraftGet 가 PEER/);
});

// ══════════════════════════════════════════════════════════════════════
// jsdom 실행
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('weekly-edit: jsdom 미설치 — 주간 글 편집 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const quiet = () => (jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(pred, what, ms = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred()) return; await tick(); }
    assert.fail('시간 안에 일어나지 않았다: ' + what);
  }
  const shims = (win) => {
    if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
    win.scrollTo = () => {};
    win.HTMLElement.prototype.scrollIntoView = function () {};
    if (!win.CSS) win.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
  };
  function wrap(dom, posted) {
    const w = dom.window;
    return { w, posted, doc: w.document, ev: (code) => w.eval(code), evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      close: async () => { await tick(); try { w.close(); } catch (_) {} } };
  }
  const bootBrowser = (src) => wrap(new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quiet(), beforeParse: shims }), []);
  function bootWidget(src, url = 'https://tcapp.local/') {
    const posted = [];
    const dom = new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: quiet(),
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); }, addEventListener() {}, removeEventListener() {} } };
        shims(win);
      } });
    const M = wrap(dom, posted);
    const sess = posted.find((x) => x && x.cmd === 'userSessionGet');
    if (sess) M.ev('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'tester', name: '시험자' } }) + ')');
    return M;
  }
  const overlayOpen = (m, id) => { const o = m.doc.getElementById(id); return !!o && !o.classList.contains('hidden') && !o.classList.contains('closing'); };
  const overlayClosed = (m, id) => { const o = m.doc.getElementById(id); return !o || o.classList.contains('hidden'); };
  async function confirmOk(m) {
    await waitFor(() => overlayOpen(m, 'confirmModal'), '확인창이 뜬다');
    m.doc.getElementById('cfOk').click();
    await waitFor(() => overlayClosed(m, 'confirmModal'), '확인창이 닫힌다');
    await tick(); await tick();
  }
  const allKeys = (m, pre) => m.evJSON(`(function(){ var a=[]; for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && k.indexOf(${JSON.stringify(pre)})===0) a.push(k); } return a.sort(); })()`);
  const clearDrafts = (m) => m.ev("(function(){ var a=[]; for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && k.indexOf('tc_rptDraft')===0) a.push(k); } a.forEach(function(k){ localStorage.removeItem(k); }); __rptDraftMem.clear(); __rptDraftDirty.clear(); __rptDraftFailed.clear(); clearTimeout(__rptDraftTimer); })()");
  const getStored = (m, key) => m.evJSON('JSON.parse(localStorage.getItem(' + JSON.stringify(key) + ') || "null")');

  //  예전 buildReportText(028409e) 의 캘린더 경로 — 주간 복사의 기준(앱 전역을 쓴다).
  function REF(indentUnit) {
    indentUnit = indentUnit || ' ';
    const from = $('#rptFrom').value, to = $('#rptTo').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return '';
    const { rows } = collectReportData(from, to, rptSources());
    if (!rows.length) return '';
    const _mkSpec = reportMarkerSpec();
    const _fmt = currentReportFormatPref();
    const _indent = Math.max(0, Math.min(6, _fmt.indent != null ? _fmt.indent : 2));
    const _pad = indentUnit.repeat(_indent * 2);
    const blocks = rows.map(r => '[' + r.name + ']' + r.titles.map((t, i) => {
      const _mk = reportMarkerAt(_mkSpec, i); const _prefix = _mk ? (_mk + ' ') : '';
      const m = (r.titleMeta && r.titleMeta[i]) || null;
      const _sub = _pad + reportSubIndent(_prefix, indentUnit);
      return '\n' + _pad + _prefix + t + reportTextDetails(m, _sub) + reportTextBody(m, _sub);
    }).join(''));
    return blocks.join('\n\n') + '\n';
  }
  const CA = '2026-07-01T00:00:00.000Z';
  const E = (o) => Object.assign({ allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: null,
    endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }, o);
  const MON = '2026-07-13', SUN = '2026-07-19', MON2 = '2026-07-20', SUN2 = '2026-07-26';
  //  알파: 일정(메모) + 커밋(본문) + 기간 할 일(날짜 메모) · 베타: 일정 · 감마: 시간만 · 델타: 아무것도 없음 · '알 파'(동명, 정규화 같음)
  const stateFor = () => ({
    gitAuthor: '', svnAuthor: '',
    categories: [
      { id: 'c-a', name: '알파', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
      { id: 'c-b', name: '베타', color: '#2e9e6b', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
      { id: 'c-c', name: '감마', color: '#d97706', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
      { id: 'c-d', name: '델타', color: '#5b6b7d', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
      { id: 'c-a2', name: '알 파', color: '#888888', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
    ],
    entries: [
      E({ id: 'e-a1', date: MON, title: '로그인 화면 리뷰', categoryId: 'c-a', memo: 'UI 확인\n• 암호화 모듈 확인' }),
      E({ id: 'g-a', date: '2026-07-14', title: '작업일지', categoryId: 'c-a', source: 'git', commits: [{ hash: 'h1', short: 'h1', time: '09:00', subject: '기능 추가', body: '본문 첫 줄\n  - 들여쓴 본문' }] }),
      E({ id: 'e-b1', date: '2026-07-15', title: '고객 회신', categoryId: 'c-b' }),
      E({ id: 'e-a2x', date: '2026-07-16', title: '동명 과제 일', categoryId: 'c-a2' }),
      E({ id: 'e-n1', date: '2026-07-21', title: '다음 주 일', categoryId: 'c-b' }),
    ],
    todos: [{ id: 't-p', text: '기간 할 일', done: false, categoryId: 'c-a', due: MON, endDate: '2026-07-17', prio: 'normal', completedAt: '', note: '',
              dayNotes: { [MON]: '월 메모', '2026-07-15': '수 메모' }, createdAt: CA, updatedAt: CA }],
    rooms: [], attendance: {},
    taskHours: { [MON]: { 'c-a': 2, 'c-b': 1 }, '2026-07-14': { 'c-a': 1.5, 'c-c': 0.5 }, '2026-07-21': { 'c-b': 3 } },
    gitCommitBody: true, reportMarker: '-', reportMarkerCustom: '', reportIndent: 2,
  });
  //  주간 작성을 그 주로 연다(포함 항목 셋, 설명 포함, 빈 항목 제외 끔).
  const openWeekly = (m, mon) => m.ev(`openReport(); setReportMode('weekly'); ['#rptSrcEvent','#rptSrcTodo','#rptSrcGit','#rptWithDesc'].forEach(function(s){ $(s).checked = true; }); $('#rptSkipEmpty').checked = false;`
    + ` $('#rptFrom').value = ${JSON.stringify(mon)}; $('#rptFrom').dispatchEvent(new Event('change'));`);
  const setWeek = (m, mon) => m.ev(`$('#rptFrom').value = ${JSON.stringify(mon)}; $('#rptFrom').dispatchEvent(new Event('change'));`);
  const card = (m, k) => m.ev(`[].find.call(document.querySelectorAll('#rptOut .rcard'), function(c){ return c.dataset.wk === ${JSON.stringify(k)}; })`);
  const clickIn = (m, k, sel) => { const c = card(m, k); assert.ok(c, k + ' 카드가 없다'); const b = c.querySelector(sel); assert.ok(b, k + ' 카드에 ' + sel + ' 가 없다'); b.click(); };
  const setView = (m, v) => m.doc.querySelector(`#rptViewSeg [data-rview="${v}"]`).click();
  const field = (m, wsec, k) => m.ev(`[].find.call(document.querySelectorAll('#rptOut [data-wsec]'), function(t){ return (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') && t.dataset.wsec === ${JSON.stringify(wsec)} && (t.dataset.wk || '') === ${JSON.stringify(k || '')}; })`);
  const typeIn = (m, wsec, k, text) => { const t = field(m, wsec, k); assert.ok(t, `${wsec}/${k} 칸이 없다`); t.value = text; t.dispatchEvent(new m.w.Event('input', { bubbles: true })); };
  const capSend = (m) => m.ev('window.__capW = null; Platform.report.submitWeekly = function(p){ window.__capW = JSON.parse(JSON.stringify(p)); };');
  const sendW = (m) => { capSend(m); m.doc.getElementById('btnRptSend').click(); const c = m.evJSON('window.__capW'); if (m.ev('HOST')) m.ev("clearTimeout(Netcus.watchdog)"); return c; };
  const copyText = async (m) => {
    m.ev("window.__clip = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function(t){ window.__clip = t; return Promise.resolve(); } } });");
    await m.ev('copyReport()');
    return m.ev('window.__clip');
  };
  const baseCal = (m) => m.evJSON('buildWeeklyFields($("#rptFrom").value, $("#rptTo").value, rptSources())');
  const FORMATS = [['-', '', 2], ['1.', '', 3], ['none', '', 0], ['가.', '', 1], ['1.', '▶', 2]];

  //  ── 바이트 같음(cal) 검사기 — 변이 시험이 재사용 ──
  async function assertCalSame(m) {
    m.ev('window.__REF = ' + REF.toString());
    let n = 0;
    for (const [mk, cu, ind] of FORMATS) for (const desc of [true, false]) for (const body of [true, false]) {
      m.ev(`state.reportFormatPrefs = { daily: { marker: '-', markerCustom: '', indent: 2 }, weekly: { marker: ${JSON.stringify(mk)}, markerCustom: ${JSON.stringify(cu)}, indent: ${ind} } }; state.gitCommitBody = ${body}; $('#rptWithDesc').checked = ${desc}; buildReport();`);
      const tag = `${mk}/${cu}/${ind} desc=${desc} body=${body}`;
      const base = baseCal(m);
      assert.ok(base && base.endwork.includes('로그인 화면 리뷰'), '기준이 비었다: ' + tag);
      assert.deepStrictEqual(m.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)'), base, '고친 것 없는 네 칸이 buildWeeklyFields 와 다르다: ' + tag);
      const c = m.evJSON('rptWCompose(rptWModelNow($("#rptFrom").value, $("#rptTo").value), rptWEmpty($("#rptFrom").value, $("#rptTo").value))');
      assert.deepStrictEqual({ content: c.content, endwork: c.endwork, planwork: c.planwork, subject: c.subject }, base, '빈 초안 조립(rptWCompose)이 buildWeeklyFields 와 다르다: ' + tag);
      assert.strictEqual(m.ev('buildReportText()'), m.ev('__REF()'), '주간 복사가 예전과 다르다: ' + tag);
      const cc = m.ev('rptWCopyText(rptWModelNow($("#rptFrom").value, $("#rptTo").value), rptWEmpty($("#rptFrom").value, $("#rptTo").value), "\\u00a0")');
      assert.strictEqual(cc, m.ev('__REF()'), '빈 초안 복사 조립(rptWCopyText)이 예전과 다르다: ' + tag);
      n++;
    }
    m.ev(`state.reportFormatPrefs = { daily: { marker: '-', markerCustom: '', indent: 2 }, weekly: { marker: '-', markerCustom: '', indent: 2 } }; state.gitCommitBody = true; $('#rptWithDesc').checked = true; buildReport();`);
    const cap = sendW(m);
    assert.ok(cap, '주간 전송 payload 를 붙잡지 못했다');
    const b = baseCal(m);
    assert.deepStrictEqual(cap.fields, { sdate: m.ev('$("#rptFrom").value'), edate: m.ev('$("#rptTo").value'), subject: b.subject, content: b.content, endwork: b.endwork, planwork: b.planwork }, '실제 전송 네 칸이 예전과 다르다');
    assert.strictEqual(await copyText(m), m.ev('__REF()'), '복사 버튼 글이 예전과 다르다');
    return n;
  }

  let B = null, bootErr = null;
  try { B = bootBrowser(app); } catch (e) { bootErr = e; }
  if (bootErr) {
    test('WB0: 브라우저 모드 부팅', () => { throw bootErr; });
  } else {
    const fresh = () => { clearDrafts(B); B.ev('state = ' + JSON.stringify(stateFor()) + ';'); openWeekly(B, MON); };
    const done = () => { clearDrafts(B); B.ev("rptViewW = 'card'; rptView = 'card'; state.reportSource = 'cal'; reportMode = 'daily';"); };
    const KEY = () => B.ev(`rptWKey(${JSON.stringify(MON)}, ${JSON.stringify(SUN)})`);

    test('WB1 (§4): 고친 것도 뺀 것도 없으면 네 칸(전송)과 주간 복사가 예전과 바이트 같다(cal, 서식 20벌)', async () => {
      fresh();
      try { assert.ok((await assertCalSame(B)) >= 20); } finally { done(); }
    });

    test('WB2 (§3.2·§3.3): 카드는 읽기 전용 + 이번 주 시간 + X · 글 편집은 회사 폼 순서, 머리 줄은 잠김(입력 아님)', () => {
      fresh();
      try {
        assert.deepStrictEqual([B.ev("$('#rptFrom').value"), B.ev("$('#rptTo').value"), B.ev('rptViewW')], [MON, SUN, 'card'], '전제: 주간, 그 주, 카드 보기');
        const html = B.ev("$('#rptOut').innerHTML");
        assert.ok(!/data-dnact=|rdn-edit-btn/.test(html) && html.includes('월 메모'), '주간 날짜 줄이 읽기 전용이 아니다');
        assert.strictEqual(B.ev("document.querySelectorAll('#rptOut .rcard-x').length"), 5, '카드마다 X');
        assert.strictEqual(card(B, '알파').querySelector('.rcard-wh').textContent, '이번 주 3.5 h', '이번 주 시간 합계');
        assert.ok(!card(B, '델타').querySelector('.rcard-wh'), '시간 기록 없는 과제에 이번 주 시간이 있다');
        assert.ok(card(B, '알파#c-a2'), '동명 과제(뒤의 것)는 이름키#과제id 키로 따로 선다');
        setView(B, 'doc');
        const hs = B.evJSON("[].map.call(document.querySelectorAll('#rptOut .rwd-h'), function(x){ return x.firstChild.textContent; })");
        assert.deepStrictEqual(hs, ['제목', '진행사항', '과제투입시간', '차주계획'], '회사 폼 순서가 아니다');
        assert.ok(B.ev("$('#rptOut .rwd-note').textContent").includes('미처리사항, 문제점 및 건의사항, 회의내용은 열린 회사 화면에서 직접 쓰세요.'));
        assert.strictEqual(B.ev("document.querySelectorAll('#rptOut .rwdoc textarea, #rptOut .rwdoc input').length"), 1 + 5 + 5, '입력은 제목 1 + 진행사항 5 + 차주계획 5 뿐이어야 한다(세 칸 입력 없음)');
        const heads = B.evJSON("[].map.call(document.querySelectorAll('#rptOut .rdoc-head'), function(x){ return x.tagName + '|' + x.textContent; })");
        assert.ok(heads.length === 10 && heads.every(h => h.startsWith('SPAN|[')), '머리 줄이 잠긴 span 이 아니다: ' + JSON.stringify(heads));
        assert.strictEqual(B.ev("$('#rptOut .rdoc-subj').value"), B.ev(`weekSubjectGuess(${JSON.stringify(MON)})`), '제목 초안이 weekSubjectGuess 가 아니다');
        assert.strictEqual(B.ev("$('#rptOut .rwd-hours').textContent"), baseCal(B).content, '과제투입시간 블록이 전송 content 와 다르다');
        assert.strictEqual(field(B, 'plan', '알파').value, '', '차주계획 초안은 빈 칸이어야 한다');
        assert.strictEqual(field(B, 'prog', '알파').value, B.ev("rptWModelNow($('#rptFrom').value, $('#rptTo').value).rows[0].draft"), '진행사항 초안이 본문 함수(공백 단위)와 다르다');
      } finally { done(); }
    });

    test('WB3 (§4): 글 편집 — 진행사항 상세 줄은 endwork 에 &nbsp; 들여쓰기로, 차주계획은 planwork 에, 제목은 subject 에 · 동명 과제는 따로', () => {
      fresh();
      try {
        setView(B, 'doc');
        typeIn(B, 'prog', '알파', '• 로그인 화면 리뷰\n    - UI 확인\n\t1) 암호화');
        typeIn(B, 'plan', '베타', '• 다음 주 회신 마무리\n  - 설치 일정');
        typeIn(B, 'subject', '', '  7월 셋째주 주간보고  ');
        typeIn(B, 'prog', '알파#c-a2', '동명 과제 글');
        const NB = '&nbsp;';
        const base = baseCal(B), o = B.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)');
        assert.ok(o.endwork.startsWith('[알파]\n• 로그인 화면 리뷰\n' + NB.repeat(4) + '- UI 확인\n' + NB.repeat(4) + '1) 암호화\n\n[베타]\n'), 'endwork 에 고친 진행사항이 &nbsp; 들여쓰기로 들어가지 않았다: ' + JSON.stringify(o.endwork.slice(0, 120)));
        assert.ok(o.endwork.endsWith('[알 파]\n동명 과제 글'), '동명 과제의 고친 글이 자기 블록에 들어가지 않았다');
        assert.strictEqual(o.planwork, '[알파]\n\n[베타]\n• 다음 주 회신 마무리\n' + NB.repeat(2) + '- 설치 일정\n\n[감마]\n\n[델타]\n\n[알 파]', '차주계획(planwork) 꼴이 다르다');
        assert.strictEqual(o.subject, '7월 셋째주 주간보고', '제목(subject)이 앞뒤 공백 정리된 고친 글이 아니다');
        assert.strictEqual(o.content, base.content, 'X 가 없는데 content 가 바뀌었다');
        assert.ok(B.ev("$('#rptEditInfo').textContent").includes('고친 칸 4개'), '"고친 칸 4개" 가 없다');
        const cap = sendW(B);
        assert.deepStrictEqual([cap.fields.subject, cap.fields.endwork, cap.fields.planwork, cap.fields.content], [o.subject, o.endwork, o.planwork, o.content], '실제 전송이 글 편집 결과가 아니다');
        const cp = B.ev('buildReportText()');
        assert.ok(cp.startsWith('[알파]\n• 로그인 화면 리뷰\n    - UI 확인\n'), '주간 복사에 고친 진행사항이 U+00A0 으로 들어가지 않았다');
        //  초안과 같게 되돌려 쓰면 "고치지 않음"
        typeIn(B, 'subject', '', B.ev(`weekSubjectGuess(${JSON.stringify(MON)})`));
        assert.strictEqual(B.evJSON('rptWDraftGet($("#rptFrom").value, $("#rptTo").value).subject'), null, '초안과 같은 제목이 고친 칸으로 남는다');
      } finally { done(); }
    });

    test('WB4 (§3.2·§4): X — 카드 제자리, endwork, planwork, content 줄과 합계에서 빠진다 · 되돌리기로 원래대로', () => {
      fresh();
      try {
        const base = baseCal(B);
        const names0 = B.evJSON("[].map.call(document.querySelectorAll('#rptOut .rcard .rcard-nm'), function(x){ return x.textContent; })");
        clickIn(B, '알파', '.rcard-x');
        assert.deepStrictEqual(B.evJSON("[].map.call(document.querySelectorAll('#rptOut .rcard .rcard-nm'), function(x){ return x.textContent; })"), names0, 'X 뒤 카드 수나 순서가 바뀌었다');
        assert.ok(card(B, '알파').classList.contains('rcard-out') && card(B, '알파').querySelector('.rcard-back'), '뺀 카드가 흐리게 제자리에 있지 않다');
        assert.strictEqual(B.doc.activeElement, card(B, '알파').querySelector('.rcard-back'), '포커스가 되돌리기로 가지 않았다');
        const o = B.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)');
        assert.ok(!o.endwork.includes('[알파]') && !o.planwork.includes('[알파]') && !o.content.includes('[알파]'), '뺀 과제가 네 칸에 남아 있다');
        assert.ok(o.content.endsWith('-----\n합계 : 1.5'), '합계가 뺀 과제 없이 다시 나지 않았다: ' + o.content);
        assert.strictEqual(o.planwork, '[베타]\n[감마]\n[델타]\n[알 파]', '고친 계획이 없으면 planwork 는 머리 줄만이어야 한다');
        assert.ok(!B.ev('buildReportText()').includes('[알파]'), '복사에 뺀 과제가 남아 있다');
        setView(B, 'doc');
        assert.strictEqual(B.ev("[].filter.call(document.querySelectorAll('#rptOut .rdoc-outsec'), function(x){ return x.dataset.wk === '알파'; }).length"), 2, '진행사항과 차주계획 모두 "이 보고서에서 뺌" 한 줄이어야 한다');
        assert.ok(!B.ev("$('#rptOut .rwd-hours').textContent").includes('[알파]'), '읽기 전용 과제투입시간에 뺀 과제가 남아 있다');
        setView(B, 'card');
        clickIn(B, '알파', '.rcard-back');
        assert.deepStrictEqual(B.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)'), base, '되돌리기 뒤 네 칸이 원래와 다르다');
        assert.strictEqual(allKeys(B, 'tc_rptDraftW:').length, 0, '고친 것도 뺀 것도 없는데 키가 남았다');
        //  주간 X 에는 시간 안내가 없다(§3.2)
        B.ev('window.__t = []; window.__to = window.__to || toast; toast = function(m){ window.__t.push(String(m)); return window.__to.apply(this, arguments); };');
        try { clickIn(B, '알파', '.rcard-x'); assert.deepStrictEqual(B.evJSON('window.__t'), [], '주간 X 에 안내 토스트가 떴다'); }
        finally { B.ev('toast = window.__to;'); }
        //  전부 빼면 보낼 것이 없다
        for (const k of ['베타', '감마', '델타', '알파#c-a2']) clickIn(B, k, '.rcard-x');
        assert.strictEqual(B.ev('rptWOutFields($("#rptFrom").value, $("#rptTo").value)'), null, '전부 뺐는데 보낼 칸이 있다');
      } finally { done(); }
    });

    test('WB5 (§5): 임시 저장 — 접두 tc_rptDraftW:, 닫고 열기, 재시작, 기간별, 채우기 성공 회신으로 안 지워짐', async () => {
      fresh();
      //  이번 주로 연다: 보고서를 열 때 기간 끝이 14일 넘게 지난 주간 키는 정리되므로(§5) 닫고 열기는 지금 주로 본다.
      const [C0, C1] = B.evJSON('weekRange(new Date(), 0)'), P0 = B.ev(`addDays(${JSON.stringify(C0)}, -7)`), P1 = B.ev(`addDays(${JSON.stringify(C0)}, -1)`);
      const KC = B.ev(`rptWKey(${JSON.stringify(C0)}, ${JSON.stringify(C1)})`);
      openWeekly(B, C0);
      try {
        setView(B, 'doc');
        typeIn(B, 'prog', '베타', '베타 상세');
        await tick(500);
        assert.deepStrictEqual(allKeys(B, 'tc_rptDraft'), [KC], '키가 하나(주간 키)가 아니다');
        assert.ok(KC.startsWith('tc_rptDraftW:') && KC.endsWith(`:${C0}_${C1}`), '키 꼴이 tc_rptDraftW:<who>:<from>_<to> 가 아니다: ' + KC);
        const d = getStored(B, KC);
        assert.deepStrictEqual([d.v, d.from, d.to, d.prog['베타'], typeof d.progBase['베타'], d.out, d.subject], [1, C0, C1, '베타 상세', 'string', [], null]);
        assert.ok(B.ev("$('#rptEditInfo').textContent").includes('이 PC에 임시 저장됨'));
        setView(B, 'card'); clickIn(B, '감마', '.rcard-x');
        B.ev("closeModal('#reportModal')");
        await waitFor(() => overlayClosed(B, 'reportModal'), '보고서가 닫힌다');
        openWeekly(B, C0);
        assert.strictEqual(B.ev('rptViewW'), 'card', '다시 열면 카드 보기');
        assert.ok(card(B, '감마').classList.contains('rcard-out') && card(B, '베타').querySelector('.rcard-free').textContent === '베타 상세', '닫고 열자 X 나 고친 글이 사라졌다');
        B.ev('__rptDraftMem.clear(); __rptDraftDirty.clear(); __rptDraftFailed.clear(); buildReport();');
        assert.ok(card(B, '감마').classList.contains('rcard-out'), '재시작(메모리 비움) 뒤 저장소에서 읽지 못했다');
        setWeek(B, P0);
        assert.deepStrictEqual([B.ev("$('#rptFrom').value"), B.ev("$('#rptTo').value")], [P0, P1]);
        assert.ok(!B.ev("document.querySelectorAll('#rptOut .rcard-out, #rptOut .rcard-edited').length"), '다른 주에 이 주의 초안이 보인다');
        setWeek(B, C0);
        assert.ok(card(B, '감마').classList.contains('rcard-out'), '주를 오가자 초안이 섞였다');
        //  주간 채우기 성공 회신은 지우지 않는다(§5)
        sendW(B);
        B.ev("window.__netcusResult(true, '주간보고 작성 폼을 채웠습니다 (시험)')");
        B.ev("window.__netcusResult(true, '회사 일간보고 전송 완료(시험)')");
        assert.ok(getStored(B, KC), '채우기 성공(또는 다른 성공) 회신이 주간 초안을 지웠다');
        //  모두 초안으로
        setView(B, 'doc');
        B.doc.querySelector('#rptOut .rdoc-resetall').click();
        await confirmOk(B);
        assert.ok(!getStored(B, KC), '"모두 초안으로" 뒤에도 키가 남았다');
        assert.ok(B.doc.activeElement && B.doc.activeElement.classList.contains('rdoc-subj'), '"모두 초안으로" 뒤 포커스가 제목 칸으로 가지 않았다');
      } finally { done(); }
    });

    test('WB6 (§5): 14일 정리 — 기간 끝이 14일 넘게 지난 이 계정 주간 키만 · 일간 정리와 섞이지 않는다', () => {
      clearDrafts(B);
      try {
        const who = B.ev('rptDraftWho()'), d = (n) => B.ev(`addDays(todayYmd(), ${n})`);
        const wOld = `tc_rptDraftW:${who}:${d(-21)}_${d(-15)}`, wKeep = `tc_rptDraftW:${who}:${d(-20)}_${d(-14)}`;
        const wOther = `tc_rptDraftW:other:${d(-40)}_${d(-34)}`, dKeep = `tc_rptDraft:${who}:${d(-3)}`, dOld = `tc_rptDraft:${who}:${d(-30)}`;
        for (const k of [wOld, wKeep, wOther, dKeep, dOld]) B.ev(`localStorage.setItem(${JSON.stringify(k)}, '{"v":1}')`);
        B.ev('rptDraftPrune()');
        let ks = allKeys(B, 'tc_rptDraft');
        assert.ok(ks.includes(wOld) && ks.includes(wKeep), '일간 정리가 주간 키를 지웠다');
        assert.ok(!ks.includes(dOld) && ks.includes(dKeep), '전제: 일간 정리');
        B.ev('openReport()');
        ks = allKeys(B, 'tc_rptDraft');
        assert.ok(!ks.includes(wOld), '기간 끝이 15일 지난 주간 키가 남았다');
        assert.ok(ks.includes(wKeep), '기간 끝이 14일째인 주간 키까지 지웠다');
        assert.ok(ks.includes(wOther), '다른 계정 주간 키를 지웠다');
        assert.ok(ks.includes(dKeep), '주간 정리가 일간 키를 지웠다');
      } finally { done(); }
    });

    test('WB7 (§5): 렌더만으로는 쓰지 않는다 · 막힌 저장소에서도 화면이 동작한다', () => {
      fresh();
      try {
        B.ev(`localStorage.setItem(rptWKey(${JSON.stringify(MON)}, ${JSON.stringify(SUN)}), JSON.stringify({ v:1, from:${JSON.stringify(MON)}, to:${JSON.stringify(SUN)}, subject:'저장된 제목', prog:{ '알파':'저장된 글', '사라진과제':'흔적' }, progBase:{ '알파':'옛 초안' }, plan:{}, out:['델타'], savedAt:'2026-01-01T00:00:00.000Z' }));`);
        B.ev("window.__w = []; (function(){ var P = Storage.prototype, s = P.setItem, r = P.removeItem; P.setItem = function(k){ if(String(k).indexOf('tc_rptDraft')===0) window.__w.push('set '+k); return s.apply(this, arguments); }; P.removeItem = function(k){ if(String(k).indexOf('tc_rptDraft')===0) window.__w.push('rm '+k); return r.apply(this, arguments); }; window.__unspy = function(){ P.setItem = s; P.removeItem = r; }; })();");
        try {
          B.ev('buildReport();'); setView(B, 'doc'); setView(B, 'card'); setWeek(B, MON2); setWeek(B, MON);
          B.ev("buildReportText(); rptWOutFields($('#rptFrom').value, $('#rptTo').value); setReportMode('daily'); setReportMode('weekly');");
          assert.deepStrictEqual(B.evJSON('window.__w'), [], '렌더나 글 만들기가 저장소에 썼다');
        } finally { B.ev('window.__unspy()'); }
        setWeek(B, MON);
        assert.ok(card(B, '델타').classList.contains('rcard-out') && card(B, '알파').querySelector('.rcard-free'), '전제: 저장본을 읽어 그렸다');
        assert.ok(B.ev("$('#rptEditInfo').textContent").includes('고친 칸 2개'), '고친 칸은 지금 행 기준(제목 + 알파)이어야 한다: ' + B.ev("$('#rptEditInfo').textContent"));
        //  막힌 저장소
        B.ev("(function(){ var P = Storage.prototype, g = P.getItem, s = P.setItem, r = P.removeItem, k = P.key; var bad = function(x){ return String(x).indexOf('tc_rptDraft')===0; };"
          + " P.getItem = function(x){ if(bad(x)) throw new Error('blocked'); return g.apply(this, arguments); }; P.setItem = function(x){ if(bad(x)) throw new Error('blocked'); return s.apply(this, arguments); };"
          + " P.removeItem = function(x){ if(bad(x)) throw new Error('blocked'); return r.apply(this, arguments); }; P.key = function(){ throw new Error('blocked'); };"
          + " window.__unblock = function(){ P.getItem = g; P.setItem = s; P.removeItem = r; P.key = k; }; })();");
        try {
          B.ev('__rptDraftMem.clear(); __rptDraftDirty.clear(); __rptDraftFailed.clear(); openReport(); setReportMode("weekly");');
          setWeek(B, MON);
          clickIn(B, '베타', '.rcard-x');
          assert.ok(card(B, '베타').classList.contains('rcard-out'), '막힌 저장소에서 X 가 동작하지 않는다');
          setView(B, 'doc'); typeIn(B, 'prog', '알파', '막힌 저장소 글'); B.ev('rptDraftFlush()');
          const o = B.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)');
          assert.ok(o.endwork.startsWith('[알파]\n막힌 저장소 글\n\n[감마]'), '막힌 저장소에서 고친 글과 X 가 나가지 않는다');
          assert.ok(!B.ev("$('#rptEditInfo').textContent").includes('임시 저장됨'), '막힌 저장소인데 "임시 저장됨" 을 말한다');
        } finally { B.ev('window.__unblock()'); }
      } finally { done(); }
    });

    test('WB8 (§2): 기간 취합(custom)은 그대로 — X, 보기 전환, 주간 초안 없음 · 날짜 줄 ✎ 있음 · 복사는 예전 글', () => {
      fresh();
      try {
        clickIn(B, '베타', '.rcard-x');   // 주간 초안이 있어도
        B.ev(`setReportMode('custom'); $('#rptFrom').value = ${JSON.stringify(MON)}; $('#rptTo').value = ${JSON.stringify(SUN)}; buildReport();`);
        const html = B.ev("$('#rptOut').innerHTML");
        assert.ok(!/rcard-x|data-wk=|rcard-out/.test(html), '기간 취합에 X 나 주간 초안이 보인다');
        assert.ok(/rdn-edit-btn/.test(html), '기간 취합의 날짜 줄 ✎ 가 사라졌다');
        assert.strictEqual(B.ev("$('#rptViewBar').classList.contains('hidden')"), true, '기간 취합에 보기 전환 줄이 보인다');
        B.ev('window.__REF = ' + REF.toString());
        assert.strictEqual(B.ev('buildReportText()'), B.ev('__REF()'), '기간 취합 복사가 예전과 다르다(주간 초안이 섞였다)');
        assert.ok(B.ev('buildReportText()').includes('[베타]'));
      } finally { done(); }
    });

    //  정정 1: 동명 과제 키는 그린 행 자리가 아니라 거르지 않은 과제 목록 기준(첫 과제 = 이름 키, 나머지 = 이름키#과제id).
    //  공식 '기타'(빈 과제) + 개인 '기타'(기록 있음)에서 개인 것을 X 하고 고친 뒤 빈 항목 제외를 켜거나 ▲▼ 로 옮겨도 그 과제에 남아야 한다.
    const dupState = () => { const st = stateFor();
      st.categories.splice(1, 0, { id: 'c-o', name: '기타', color: '#5b6b7d', desc: '', gitRepo: '', svnRepo: '', createdAt: CA });
      st.categories.push({ id: 'c-p', name: '기타', color: '#5b6b7d', desc: '', gitRepo: '', svnRepo: '', createdAt: CA });
      st.entries.push(E({ id: 'e-p1', date: '2026-07-16', title: '개인 기타 일', categoryId: 'c-p' }));
      return st; };
    function checkDupStable(m) {
      m.ev('state = ' + JSON.stringify(dupState()) + ';'); openWeekly(m, MON);
      //  과제 id 로 본다(키 꼴과 무관하게): 지금 행 모델에서 그 과제의 키, 그리고 초안의 out / prog 가 어느 과제에 닿는지.
      const F = '$("#rptFrom").value, $("#rptTo").value';
      const keyOf = (cat) => m.ev(`(function(){ var r = rptWModelNow(${F}).rows.find(function(x){ return x.catId === ${JSON.stringify(cat)}; }); return r ? r.k : null; })()`);
      const hits = (field) => m.evJSON(`(function(){ var M = rptWModelNow(${F}), d = rptWDraftGet(${F}); return M.rows.filter(function(r){ return ${field === 'out' ? 'd.out.indexOf(r.k) >= 0' : 'Object.prototype.hasOwnProperty.call(d.prog, r.k)'}; }).map(function(r){ return r.catId; }); })()`);
      const endw = () => m.evJSON(`rptWOutFields(${F})`).endwork;
      setView(m, 'doc'); typeIn(m, 'prog', keyOf('c-p'), '개인 기타 고친 글'); setView(m, 'card');
      clickIn(m, keyOf('c-p'), '.rcard-x');
      assert.deepStrictEqual([hits('out'), hits('prog')], [['c-p'], ['c-p']], '전제: 개인 기타만 빼고 고쳤다');
      m.ev("$('#rptSkipEmpty').checked = true; buildReport();");   // 공식 기타(빈 과제)가 행에서 빠진다
      assert.strictEqual(keyOf('c-o'), null, '전제: 빈 항목 제외로 공식 기타 행이 빠졌다');
      assert.deepStrictEqual([hits('out'), hits('prog')], [['c-p'], ['c-p']], '빈 항목 제외를 켜자 X 나 고친 글이 개인 기타에서 떨어졌다');
      assert.ok(card(m, keyOf('c-p')).classList.contains('rcard-out'), '빈 항목 제외 뒤 개인 기타 카드가 흐리지 않다');
      assert.ok(!endw().includes('[기타]'), '빈 항목 제외 뒤 개인 기타가 다시 나간다');
      m.ev("$('#rptSkipEmpty').checked = false; buildReport();");
      assert.deepStrictEqual([hits('out'), hits('prog')], [['c-p'], ['c-p']], '빈 항목 제외를 끄자 X 나 고친 글이 다른 기타로 옮겨 갔다');
      clickIn(m, keyOf('c-p'), '.rcard-back');
      assert.ok(endw().includes('[기타]\n개인 기타 고친 글'), '고친 글이 개인 기타 블록에 있지 않다');
      m.ev("moveCategory('c-p', -2); buildReport();");   // ▲▼(다른 과제를 넘어 위로, 공식 기타보다는 아래)
      assert.deepStrictEqual(hits('prog'), ['c-p'], '▲▼ 로 옮기자 고친 글이 다른 과제로 옮겨 갔다');
      assert.ok(card(m, keyOf('c-p')).querySelector('.rcard-edited') && !card(m, keyOf('c-o')).querySelector('.rcard-edited'), '▲▼ 뒤 고침 표시가 다른 기타에 있다');
      assert.deepStrictEqual([keyOf('c-o'), keyOf('c-p')], ['기타', '기타#c-p'], '키 꼴: 첫 기타(목록 순서)는 이름 키(net 과 맞음), 뒤의 기타는 이름키#과제id');
    }
    test('WB9 (정정 1): 동명 과제 키가 빈 항목 제외 켜고 끄기와 ▲▼ 에도 같은 과제에 남는다', () => {
      clearDrafts(B);
      try { checkDupStable(B); } finally { done(); }
    });
    test('변이 WBM3: 동명 키를 그린 행 자리 순서(#2)로 되돌리면 WB9 가 잡는다', () => {
      const bad = mutate(app, "    return { k: rptWCalKey(r.key, r.name), name:", "    return { k: _rptWUniqCal(rptWNameKey(r.name)), name:")
        .replace("  return { src: 'cal', from, to, rows: (rows || []).map(r => {", "  const _rptWUniqCal = _rptWUniq();\n  return { src: 'cal', from, to, rows: (rows || []).map(r => {");
      const X = bootBrowser(bad);
      try { assert.throws(() => checkDupStable(X)); } finally { X.close(); }
    });

    //  정정 5: 소수 시간 합계는 반올림한다(0.1 + 0.2 가 0.30000000000000004 로 나가지 않게). X 한 과제(1.25)는 합계에서 빠진다.
    function checkFrac(m) {
      const st = stateFor();
      st.taskHours = { [MON]: { 'c-a': 0.1, 'c-b': 0.2, 'c-c': 1.25 } };
      m.ev('state = ' + JSON.stringify(st) + ';'); openWeekly(m, MON);
      clickIn(m, '감마', '.rcard-x');
      const c = m.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)').content;
      assert.ok(c.endsWith('-----\n합계 : 0.3'), 'X 뒤 소수 합계가 반올림되지 않았다: ' + JSON.stringify(c));
      assert.ok(!c.includes('[감마]'), '뺀 과제가 content 에 있다');
    }
    test('WB10 (정정 5): X 뒤 소수 시간 합계(0.1 + 0.2, 1.25 뺌)는 0.3 으로 나간다', () => {
      clearDrafts(B);
      try { checkFrac(B); } finally { done(); }
    });
    test('변이 WBM4: rptWCompose 의 합계 반올림을 빼면 WB10 이 잡는다', () => {
      const bad = mutate(app, "    g = Math.round(g * 100) / 100;\n    content = lines.concat", "    content = lines.concat");
      const X = bootBrowser(bad);
      try { assert.throws(() => checkFrac(X), /반올림/); } finally { X.close(); }
    });

    //  정정 7: 공백뿐인 제목은 고친 칸이 아니다(초안 제목이 나간다).
    test('WB11 (정정 7): 공백뿐인 제목은 "고친 칸" 으로 세지 않고 초안 제목이 나간다', () => {
      fresh();
      try {
        setView(B, 'doc');
        typeIn(B, 'subject', '', '   ');
        assert.strictEqual(B.evJSON('rptWDraftGet($("#rptFrom").value, $("#rptTo").value).subject'), null, '공백뿐인 제목이 고친 칸으로 저장됐다');
        assert.ok(!B.ev("$('#rptEditInfo').textContent").includes('고친 칸'), '공백뿐인 제목을 고친 칸으로 센다');
        assert.strictEqual(B.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)').subject, B.ev(`weekSubjectGuess(${JSON.stringify(MON)})`));
        B.ev(`rptWDraftPut(${JSON.stringify(MON)}, ${JSON.stringify(SUN)}, Object.assign(rptWEmpty(${JSON.stringify(MON)}, ${JSON.stringify(SUN)}), { subject: '  ' }), true); buildReport();`);   // 예전 저장본(공백 제목)
        assert.ok(!B.ev("$('#rptEditInfo').textContent").includes('고친 칸'), '저장본의 공백 제목을 고친 칸으로 센다');
        typeIn(B, 'subject', '', ' 고친 제목 ');
        assert.ok(B.ev("$('#rptEditInfo').textContent").includes('고친 칸 1개'), '대조군: 글이 있는 제목은 고친 칸이다');
      } finally { done(); }
    });

    test('변이 WBM1: cal 빈 진행사항 표시(-)를 바꾸면 WB1 의 조립 비교가 잡는다', async () => {
      const bad = mutate(app, "(`[${r.name}]\\n` + (b || '-'))", "(`[${r.name}]\\n` + (b || ''))");
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(stateFor()) + ';'); openWeekly(X, MON); await assert.rejects(() => assertCalSame(X), /rptWCompose/); }
      finally { await X.close(); }
    });
    test('변이 WBM2: X 를 조립에서 거르지 않으면 WB4 가 잡는다', () => {
      const bad = mutate(app, '  const live = M.rows.filter(r => !isOut(r));\n  const prog = r =>', '  const live = M.rows;\n  const prog = r =>');
      const X = bootBrowser(bad);
      try {
        X.ev('state = ' + JSON.stringify(stateFor()) + ';'); openWeekly(X, MON);
        clickIn(X, '알파', '.rcard-x');
        const o = X.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)');
        assert.ok(o.endwork.includes('[알파]'), '변이가 경로에 닿지 않았다');
      } finally { X.close(); }
    });
  }

  // ── (W) 위젯 모드: net 출처 ────────────────────────────────────────
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const NET_DAYS = [
    { date: MON, content: '[알파] : 2\n• 로그인 리뷰\n    - UI 확인\n[베타]\n• 고객 회신', ok: true },
    { date: '2026-07-14', content: '선행 메모\n[알파] : 1.5\n• 로그인 리뷰\n• 추가 작업\n[미등록과제] : 1\n탐색', ok: true },
  ];
  async function widgetNet(src) {
    const M = bootWidget(src);
    clearDrafts(M);
    M.ev('__applyState(' + JSON.stringify(JSON.stringify(stateFor())) + ',' + JSON.stringify(META) + ')');
    await tick();
    openWeekly(M, MON);
    M.ev(`netcusMerge = { key: ncMergeKey(${JSON.stringify(MON)}, ${JSON.stringify(SUN)}), parsed: parseNetcusWeek(${JSON.stringify(NET_DAYS)}, state.categories, { sumTime: true }), at: '09:00' }; state.reportSource = 'net'; syncReportSourceSeg(); buildReport();`);
    return M;
  }
  const netBase = (m) => m.evJSON('(function(){ var p = netcusMerge.parsed; return { content: buildNetcusHoursText(p), endwork: buildNetcusSendText(p), planwork: buildNetcusPlanText(p), subject: weekSubjectGuess($("#rptFrom").value) }; })()');
  //  net 바이트 같음 검사기 — 변이 시험이 재사용
  function assertNetSame(m) {
    for (const [mk, cu, ind] of FORMATS.slice(0, 3)) {
      m.ev(`state.reportFormatPrefs = { daily: { marker: '-', markerCustom: '', indent: 2 }, weekly: { marker: ${JSON.stringify(mk)}, markerCustom: ${JSON.stringify(cu)}, indent: ${ind} } }; buildReport();`);
      const base = netBase(m);
      assert.ok(base.endwork.includes('[미분류]') && base.content.includes('합계'), '전제: net 기준에 미분류와 시간이 있다');
      assert.deepStrictEqual(m.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)'), base, 'net 네 칸이 netcus 조립과 다르다');
      const c = m.evJSON('rptWCompose(rptWModelNow($("#rptFrom").value, $("#rptTo").value), rptWEmpty($("#rptFrom").value, $("#rptTo").value))');
      assert.deepStrictEqual({ content: c.content, endwork: c.endwork, planwork: c.planwork, subject: c.subject }, base, 'net 빈 초안 조립(rptWCompose)이 netcus 조립과 다르다');
      assert.strictEqual(m.ev('buildReportText()'), base.endwork, 'net 주간 복사가 buildNetcusSendText 와 다르다');
      assert.strictEqual(m.ev('rptWCopyText(rptWModelNow($("#rptFrom").value, $("#rptTo").value), rptWEmpty($("#rptFrom").value, $("#rptTo").value), "\\u00a0")'), base.endwork, 'net 빈 초안 복사 조립이 다르다');
    }
    const cap = sendW(m);
    const b = netBase(m);
    assert.deepStrictEqual(cap && cap.fields, { sdate: MON, edate: SUN, subject: b.subject, content: b.content, endwork: b.endwork, planwork: b.planwork }, 'net 실제 전송 네 칸이 예전과 다르다');
  }

  test('WN1 (§4): net 출처 — 고친 것도 뺀 것도 없으면 네 칸, 복사, 실제 전송이 netcus 조립과 바이트 같다', async () => {
    const M = await widgetNet(app);
    try { assertNetSame(M); } finally { clearDrafts(M); await M.close(); }
  });

  test('WN2 (§2·§4): net — [미분류] 도 한 행(X, 고치기) · 차주계획, 과제투입시간에는 없음 · 카드에 미등록 표시 유지', async () => {
    const M = await widgetNet(app);
    try {
      assert.ok(card(M, '@미분류') && card(M, '미등록과제').querySelector('.rnc-badge'), '미분류 행 카드나 미등록 표시가 없다');
      assert.ok(M.ev("$('#rptOut').innerHTML").includes('rnc-why'), '미분류 사유(표시 전용)가 사라졌다');
      clickIn(M, '@미분류', '.rcard-x');
      let o = M.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)');
      assert.ok(!o.endwork.includes('[미분류]') && o.planwork === netBase(M).planwork && o.content === netBase(M).content, '미분류 X 가 진행사항에서만 빠지지 않는다');
      clickIn(M, '@미분류', '.rcard-back');
      setView(M, 'doc');
      assert.ok(!field(M, 'plan', '@미분류'), '차주계획에 미분류 칸이 있다(지금 규칙: 빠진다)');
      typeIn(M, 'prog', '@미분류', '선행 메모 정리');
      o = M.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)');
      assert.ok(o.endwork.endsWith('[미분류]\n선행 메모 정리'), '미분류 고친 글이 endwork 에 없다');
    } finally { clearDrafts(M); await M.close(); }
  });

  //  출처를 바꿔도 같은 이름 과제의 고친 글과 X 가 따라온다 — 변이 시험이 재사용
  function assertFollowsSource(M) {
    M.ev("state.reportSource = 'cal'; syncReportSourceSeg(); buildReport();");
    setView(M, 'doc');
    typeIn(M, 'prog', '알파', '알파 고친 글');
    setView(M, 'card');
    clickIn(M, '베타', '.rcard-x');
    M.ev("state.reportSource = 'net'; syncReportSourceSeg(); buildReport();");
    assert.ok(card(M, '베타') && card(M, '베타').classList.contains('rcard-out'), 'net 으로 바꾸자 같은 이름 과제의 X 가 사라졌다');
    assert.ok(card(M, '알파').querySelector('.rcard-free') && card(M, '알파').querySelector('.rcard-free').textContent === '알파 고친 글', 'net 으로 바꾸자 같은 이름 과제의 고친 글이 사라졌다');
    const o = M.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)');
    assert.ok(o.endwork.startsWith('[알파]\n알파 고친 글') && !o.endwork.includes('[베타]') && !o.content.includes('[베타]'), 'net 네 칸에 고친 글과 X 가 반영되지 않았다');
    M.ev("state.reportSource = 'cal'; syncReportSourceSeg(); buildReport();");
    assert.ok(card(M, '베타').classList.contains('rcard-out') && card(M, '알파').querySelector('.rcard-free'), 'cal 로 돌아오자 초안이 사라졌다(쓰기가 다른 출처의 이름을 걷었다)');
  }
  test('WN3 (§2): 출처를 cal 에서 net 으로 바꿔도 같은 이름 과제의 고친 글과 X 가 따라온다(돌아와도 남는다)', async () => {
    const M = await widgetNet(app);
    try { assertFollowsSource(M); } finally { clearDrafts(M); await M.close(); }
  });
  test('WN4 (§5): 주간 채우기 성공 회신은 주간 초안을 지우지 않는다(위젯, net)', async () => {
    const M = await widgetNet(app);
    try {
      clickIn(M, '베타', '.rcard-x');
      const key = M.ev(`rptWKey(${JSON.stringify(MON)}, ${JSON.stringify(SUN)})`);
      const cap = sendW(M);
      assert.ok(cap && !cap.fields.endwork.includes('[베타]'), '전제: 채우기 payload 에서 뺀 과제가 빠졌다');
      M.ev("window.__netcusResult(true, '주간보고 작성 폼을 채웠습니다 (시험, 호스트 문구와 같은 머리)')");
      assert.ok(allKeys(M, 'tc_rptDraftW:').includes(key), '채우기 성공 회신이 주간 초안을 지웠다');
    } finally { clearDrafts(M); await M.close(); }
  });
  //  정정 2: 낡은 초안 안내는 기준본을 만든 출처에서만. cal 에서 고친 글을 net 에서 보면 안내가 없어야 한다(cal 에서 기록이 늘면 뜬다).
  function checkStaleSrc(M) {
    M.ev("state.reportSource = 'cal'; syncReportSourceSeg(); buildReport();");
    setView(M, 'doc');
    typeIn(M, 'prog', '알파', '알파 고친 글');
    const staleOf = () => M.ev("(function(){ var s = [].find.call(document.querySelectorAll('#rptOut .rdoc-sec'), function(x){ return x.dataset.wsec === 'prog' && x.dataset.wk === '알파'; }); return s ? s.querySelector('.rdoc-stale').hidden : 'nosec'; })()");
    assert.strictEqual(staleOf(), true, '막 고쳤는데 낡았다고 한다');
    M.ev("state.reportSource = 'net'; syncReportSourceSeg(); buildReport();");
    assert.strictEqual(staleOf(), true, 'cal 에서 만든 기준본을 net 초안과 비교해 "캘린더 기록이 바뀌었습니다" 를 띄웠다');
    M.ev("state.reportSource = 'cal'; syncReportSourceSeg(); buildReport();");
    M.ev(`state.entries.push(${JSON.stringify(E({ id: 'e-new', date: MON, title: '새로 생긴 일', categoryId: 'c-a' }))}); notifyDataChanged();`);
    assert.strictEqual(staleOf(), false, '대조군: 같은 출처(cal)에서 기록이 늘면 안내가 떠야 한다');
  }
  test('WN5 (정정 2): 낡은 초안 안내는 기준본을 만든 출처에서만 뜬다(cal → net 전환만으로는 뜨지 않는다)', async () => {
    const M = await widgetNet(app);
    try { checkStaleSrc(M); } finally { clearDrafts(M); await M.close(); }
  });
  test('변이 WNM3: 기준본 출처를 보지 않으면 WN5 가 잡는다', async () => {
    const bad = mutate(app, "  return (_rptOwn(d.progBaseSrc, k) ? d.progBaseSrc[k] : 'cal') === src && d.progBase[k] !== draft;", "  return d.progBase[k] !== draft;");
    const M = await widgetNet(bad);
    try { assert.throws(() => checkStaleSrc(M), /cal 에서 만든 기준본/); } finally { clearDrafts(M); await M.close(); }
  });
  //  정정 3: netcus 새로고침은 buildReport 를 지나지 않는다 — 읽는 동안 보기 전환 줄과 주간 문맥을 걷어야 한다.
  async function checkRefreshHides(M) {
    assert.strictEqual(M.ev("$('#rptViewBar').classList.contains('hidden')"), false, '전제: net 주간 미리보기에 보기 전환 줄이 보인다');
    M.ev('hostRequest = function(){ return new Promise(function(){}); };');   // 실제 netcus 읽기 없음(회신이 오지 않는 가짜)
    M.doc.getElementById('rncRefresh').click();
    await tick();
    assert.ok(M.ev("!!document.getElementById('rncProg')"), '전제: 읽는 중 화면');
    assert.strictEqual(M.ev("$('#rptViewBar').classList.contains('hidden')"), true, '읽는 동안 보기 전환 줄이 남아 있다');
    assert.strictEqual(M.ev('__rptWCtx'), null, '읽는 동안 주간 문맥이 남아 있다');
  }
  test('WN6 (정정 3): netcus 새로고침을 누르면 읽는 동안 보기 전환 줄과 주간 문맥을 걷는다', async () => {
    const M = await widgetNet(app);
    try { await checkRefreshHides(M); } finally { clearDrafts(M); await M.close(); }
  });
  test('변이 WNM4: 새로고침 처리기에서 걷기를 빼면 WN6 이 잡는다', async () => {
    const bad = mutate(app, " rptViewBarSync(false); clearNetcusMerge(); renderNetcusInto(f, tt); });", " clearNetcusMerge(); renderNetcusInto(f, tt); });");
    const M = await widgetNet(bad);
    try { await assert.rejects(() => checkRefreshHides(M), /보기 전환 줄이 남아/); } finally { clearDrafts(M); await M.close(); }
  });
  //  정정 4: 주간 net 배너는 고치는 초안이라고 말한다(읽기전용 아님). 기간 취합 배너는 그대로.
  test('WN7 (정정 4): 주간 net 배너는 "합친 초안" 을 말하고 기간 취합 배너는 예전 그대로', async () => {
    const M = await widgetNet(app);
    try {
      const wb = M.ev("$('#rptOut .rnc-banner-t').textContent");
      assert.ok(wb.includes('netcus 일간보고를 합친 초안입니다. 고친 글은 회사 일간보고를 바꾸지 않습니다') && !wb.includes('읽기전용'), '주간 net 배너가 맞지 않다: ' + wb);
      M.ev("reportMode = 'custom'; renderNetcusPreview(netcusMerge.parsed, '09:00');");
      const cb = M.ev("$('#rptOut .rnc-banner-t').textContent");
      assert.ok(cb.includes('읽기전용: netcus 일간보고를 그대로 가져옴') && !cb.includes('합친 초안'), '기간 취합 배너가 바뀌었다: ' + cb);
      M.ev("reportMode = 'weekly';");
    } finally { clearDrafts(M); await M.close(); }
  });

  test('변이 WNM1: net 빈 본문 과제의 머리 줄 처리를 바꾸면 WN1 이 잡는다', async () => {
    const bad = mutate(app, "('[' + r.name + ']' + (b ? '\\n' + b : ''))", "('[' + r.name + ']\\n' + b)");
    const M = await widgetNet(bad);
    try {
      M.ev(`netcusMerge.parsed = parseNetcusWeek(${JSON.stringify(NET_DAYS.concat([{ date: '2026-07-15', content: '[감마] : 1', ok: true }]))}, state.categories, { sumTime: true }); buildReport();`);
      assert.throws(() => assertNetSame(M), /rptWCompose/);
    } finally { clearDrafts(M); await M.close(); }
  });
  test('변이 WNM2: 이름 키를 과제 id 로 바꾸면 WN3 이 잡는다', async () => {
    const bad = mutate(app, "    return { k: rptWCalKey(r.key, r.name), name: String(r.name == null ? '' : r.name), color: r.color, catId: r.key, plan: true,",
      "    return { k: String(r.key), name: String(r.name == null ? '' : r.name), color: r.color, catId: r.key, plan: true,");
    const M = await widgetNet(bad);
    try { assert.throws(() => assertFollowsSource(M)); } finally { clearDrafts(M); await M.close(); }
  });

  // ── (P) 열람 창 ─────────────────────────────────────────────────
  test('WP1 (§5): 열람 창(PEER)에서는 주간 임시 저장을 읽지도 쓰지도 않는다 · X 없음', async () => {
    const P = bootWidget(app, 'https://tcapp.local/?peer=1');
    try {
      assert.strictEqual(P.ev('PEER'), true);
      P.ev(`localStorage.setItem('tc_rptDraftW:me:${MON}_${SUN}', JSON.stringify({ v:1, from:'${MON}', to:'${SUN}', subject:'부모 제목', prog:{ '알파':'부모 글' }, progBase:{}, plan:{}, out:['베타'], savedAt:'' }));`);
      P.ev("window.__acc = []; (function(){ var Pr = Storage.prototype; ['getItem','setItem','removeItem'].forEach(function(n){ var o = Pr[n]; Pr[n] = function(k){ if(String(k).indexOf('tc_rptDraftW:')===0) window.__acc.push(n+' '+k); return o.apply(this, arguments); }; }); var ok = Pr.key; Pr.key = function(){ window.__acc.push('key'); return ok.apply(this, arguments); }; })();");
      P.w.__applyState(JSON.stringify(stateFor()), { peerName: '홍길동', canWrite: false });
      await tick();
      P.ev(`reportMode = 'weekly'; $('#rptFrom').value = '${MON}'; $('#rptTo').value = '${SUN}'; ['#rptSrcEvent','#rptSrcTodo','#rptSrcGit'].forEach(function(s){ $(s).checked = true; }); buildReport();`);
      assert.ok(P.ev("document.querySelectorAll('#rptOut .rcard').length") > 0, '전제: 카드가 그려졌다');
      assert.strictEqual(P.ev("document.querySelectorAll('#rptOut .rcard-x').length"), 0, '열람 창에 X 가 있다');
      assert.ok(!P.ev('buildReportText()').includes('부모 글'), '열람 창 글에 부모의 주간 초안이 섞였다');
      P.ev(`rptViewW = 'doc'; buildReport(); rptWDraftPut('${MON}', '${SUN}', rptWEmpty('${MON}', '${SUN}'), true); rptWDraftPrune(); rptWOutFields('${MON}', '${SUN}');`);
      assert.deepStrictEqual(P.evJSON('window.__acc'), [], '열람 창이 주간 임시 저장에 닿았다');
    } finally { await P.close(); }
  });
}
