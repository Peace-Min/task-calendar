// 월간 보고 탭(docs/MONTHLY-REPORT-PLAN.md §5, 단계 B): §10.1 의 monthly-report 시험.
//
// 이 파일이 지키는 것:
//   (S) 정적: 네 번째 탭 버튼, setReportMode 의 분기는 표시를 붙이고 rptMOpen 으로 돌아갈 뿐, 월간 함수(rptM*)는 회사로 보내는
//       길(Platform.report, netcusSubmit, netcusWeekSubmit, NetcusWeekFill, #btnRptSend)을 부르지 않고 호스트 명령은 RPTM_HOST_CMDS 뿐,
//       그림 함수는 단계 A 명령(scheduleImage*)만, 초안 키 접두와 6건, 월간 탭에서 보내기와 복사 버튼을 숨기는 CSS.
//   (W) jsdom 위젯 모드(지어낸 상태): 기간이 payload 로 그대로, 과제 수행 기간 = 개발 시작일 ~ 개발종료일, 실적 글 = 기간 취합 복사 글의
//       과제별 블록(글자 그대로, 서식 여러 벌), 공용 일정 제외, 계획과 변경이력은 자동으로 안 채우고 다시 읽어 오기도 안 덮음,
//       그림 버튼(파일, 붙여넣기, 순서, 삭제 확인, 끊김 사본 목록), 저장(회신 경로, 폴더 열기, notice, 오류 그대로),
//       초안 키와 6건, 막힌 저장소, 기타 제외 기억, 주간보고 출처(가짜 회신, 로그인 없음, 400일), 보내는 명령 0(가로채기).
//   (B) jsdom 브라우저 모드: 안내 문구, 저장과 주간보고 막힘, 미리 보기는 동작, 기존 탭(일간, 주간, 기간 취합)이 그대로.
//   (M) 변이: 위 정적 계약을 되돌리면 같은 검사기가 잡는다.
// ★ 실제 netcus 읽기, 그림 올리기, 파일 저장은 없다. 호스트 회신은 __hostReply 로 흉내 낸다. 회사로 보내는 함수는 가로채 0 회를 본다.
// 생략 규약: jsdom 이 없으면 (W)(B)는 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 120));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 120));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
//  월간 함수 이름 전부(선언 순서). 하나도 없으면 검사기가 눈을 감은 것이다.
const rptMNames = (src) => [...new Set([...src.matchAll(/\bfunction\s+(rptM\w+)\s*\(/g)].map((m) => m[1]))];
const rptMCode = (src) => rptMNames(src).map((n) => extractFunction(src, n)).join('\n');

// ══════════════════════════════════════════════════════════════════════
// (S) 정적 검사기
// ══════════════════════════════════════════════════════════════════════
const S = {
  tabs(src) {
    const tl = src.slice(src.indexOf('<div class="rpt-presets" role="tablist" aria-label="보고 유형">'));
    const end = tl.indexOf('</div>');
    const btns = [...tl.slice(0, end).matchAll(/data-rmode="(\w+)"[^>]*>([^<]+)</g)].map((m) => m[1] + ':' + m[2]);
    assert.deepStrictEqual(btns, ['daily:일간 작성', 'weekly:주간 작성', 'custom:기간 취합', 'monthly:월간 보고'], '보고 유형 탭이 일간, 주간, 기간 취합, 월간 보고 순서가 아니다');
    assert.ok(/data-rmode="monthly" role="tab" aria-controls="rptMonthlyPane"/.test(src), '월간 탭이 월간 영역을 가리키지 않는다');
  },
  modeBranch(src) {
    const f = extractFunction(src, 'setReportMode');
    const a = f.indexOf("_rm.classList.toggle('rptm-on', mode === 'monthly')");
    const b = f.indexOf("if(mode === 'monthly'){ rptMOpen(); return; }");
    const c = f.indexOf("const from = $('#rptFrom'), to = $('#rptTo');");
    assert.ok(a > 0 && b > a && c > b, 'setReportMode 의 월간 분기(표시 토글, rptMOpen 후 return)가 기존 기간 처리 앞에 없다');
    assert.ok(f.includes('buildReport();') && f.includes('applyRptSourcePrefs();'), '대조군: 기존 탭의 길(applyRptSourcePrefs, buildReport)이 남아 있다');
  },
  noSend(src) {
    const names = rptMNames(src);
    assert.ok(names.length >= 30, '월간 함수(rptM*)를 거의 찾지 못했다: ' + names.length);
    const code = rptMCode(src);
    for (const bad of ['Platform.report', 'netcusSubmit', 'netcusWeekSubmit', 'NetcusWeekFill', 'submitDaily', 'submitWeekly', 'btnRptSend', 'copyReport(']) {
      assert.ok(!code.includes(bad), '월간 함수가 회사로 보내는 길을 부른다: ' + bad);
    }
    const allowed = new Set(JSON.parse(/const RPTM_HOST_CMDS = (\[[^\]]*\]);/.exec(src)[1].replace(/'/g, '"')));
    assert.deepStrictEqual([...allowed].sort(), ['exportMonthlyDocx', 'netcusWeeklyRangeRead', 'openFolder', 'scheduleImageAdd', 'scheduleImageDelete', 'scheduleImageList', 'scheduleImageMove', 'scheduleImageThumb'], '호스트 명령 목록이 바뀌었다');
    const used = [...code.matchAll(/hostRequest\('(\w+)'/g)].map((m) => m[1]).concat([...code.matchAll(/hpost\(\{\s*cmd:\s*'(\w+)'/g)].map((m) => m[1]));
    assert.ok(used.length >= 7, '호스트 호출을 거의 찾지 못했다');
    for (const u of used) assert.ok(allowed.has(u), '목록 밖 호스트 명령: ' + u);
    assert.ok(!/hostRequest\((?!')/.test(code) && !/hpost\((?!\{ cmd: ')/.test(code), '명령 이름을 글자로 쓰지 않는 호스트 호출이 있다(검사를 피한다)');
    assert.ok(!/PCAL/.test(code), '월간 함수가 과제 캘린더 공용 일정(PCAL)을 읽는다(§4 끝: 개인 기록만)');
  },
  imageCmds(src) {
    const code = rptMNames(src).filter((n) => /^rptMImg|^rptMThumbs/.test(n)).map((n) => extractFunction(src, n)).join('\n');
    const used = [...code.matchAll(/hostRequest\('(\w+)'/g)].map((m) => m[1]);
    assert.deepStrictEqual([...new Set(used)].sort(), ['scheduleImageAdd', 'scheduleImageDelete', 'scheduleImageList', 'scheduleImageMove', 'scheduleImageThumb'], '그림 함수가 단계 A 명령 다섯만 쓰지 않는다');
    assert.ok(/mode: mode === 'clipboard' \? 'clipboard' : 'file'/.test(code), '그림 넣기가 {mode:file|clipboard} 로 가지 않는다');
  },
  draft(src) {
    assert.ok(src.includes("const RPTM_DRAFT_PREFIX = 'tc_rptDraftM:';") && src.includes('const RPTM_DRAFT_KEEP = 6;'), '월간 초안 키 접두나 보관 수(6)가 다르다');
    for (const fn of ['rptMDraftLoad', 'rptMDraftSave', 'rptMDraftPrune', 'rptMEtcOffGet', 'rptMEtcOffSet']) {
      const b = extractFunction(src, fn);
      const g = b.indexOf('PEER'), ls = b.indexOf('localStorage');
      assert.ok(g > 0 && ls > g, fn + ' 가 PEER 를 저장소보다 먼저 보지 않는다');
      assert.ok(b.indexOf('try{') > 0 && b.indexOf('try{') < ls, fn + ' 의 저장소 접근이 try 안에 있지 않다');
    }
  },
  css(src) {
    const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
    assert.ok(css.includes('#reportModal.rptm-on #btnRptSend,#reportModal.rptm-on #btnRptCopy,#reportModal.rptm-on #rptSendStatus,#reportModal.rptm-on #rptSendHint{display:none !important}'), '월간 탭에서 보내기, 복사 버튼을 숨기는 규칙이 없다');
    assert.ok(css.includes('#reportModal.rptm-on .rpt-rail > :not(.rpt-presets),#reportModal.rptm-on .rpt-preview{display:none !important}'), '월간 탭에서 기존 레일 칸과 미리보기를 숨기는 규칙이 없다');
    assert.ok(css.includes('#reportModal:not(.rptm-on) .rptm-only{display:none !important}'), '다른 탭에서 월간 버튼을 숨기는 규칙이 없다');
  },
};
test('MS1 (§5.1): 보고 유형 탭은 일간, 주간, 기간 취합, 월간 보고 네 개', () => S.tabs(app));
test('MS2 (§5.1): setReportMode 는 월간이면 표시를 붙이고 rptMOpen 으로 돌아간다(기존 탭의 길은 그대로)', () => S.modeBranch(app));
test('MS3 (§10.1): 월간 함수는 회사로 보내는 길을 부르지 않고, 호스트 명령은 RPTM_HOST_CMDS 뿐, 공용 일정을 읽지 않는다', () => S.noSend(app));
test('MS4 (§6.3, §12): 그림 함수는 단계 A 명령(scheduleImage*)만, 넣기는 file 또는 clipboard', () => S.imageCmds(app));
test('MS5 (§5.4): 초안 키 tc_rptDraftM:, 6건, PEER 관문과 try', () => S.draft(app));
test('MS6 (§5.1): 월간 탭 CSS 는 보내기와 복사, 기존 레일과 미리보기를 숨긴다', () => S.css(app));
test('변이 MSM1: 월간 저장에 Platform.report 를 넣거나 목록 밖 명령을 쓰면 MS3 이 잡는다', () => {
  assert.throws(() => S.noSend(mutate(app, "  try{ res = await hostRequest('exportMonthlyDocx', rptMPayload(S), 300000); }", "  try{ Platform.report.submitWeekly({ fields: {} }); res = await hostRequest('exportMonthlyDocx', rptMPayload(S), 300000); }")), /Platform\.report|submitWeekly/);
  assert.throws(() => S.noSend(mutate(app, "  const res = await hostRequest('netcusWeeklyRangeRead', { from, to }, 180000);", "  const res = await hostRequest('netcusWeekSubmit', { from, to }, 180000);")), /netcusWeekSubmit/);
  assert.throws(() => S.noSend(mutate(app, "function rptMOpenDir(){ if(HOST && __rptMDir) hpost({ cmd: 'openFolder', path: __rptMDir }); }", "function rptMOpenDir(){ if(HOST && __rptMDir) hpost({ cmd: 'netcusSubmit', path: __rptMDir }); }")), /netcusSubmit|목록 밖/);
});
test('변이 MSM2: 분기를 지우거나 그림 명령을 바꾸거나 PEER 관문을 빼면 MS2, MS4, MS5 가 잡는다', () => {
  assert.throws(() => S.modeBranch(mutate(app, "  if(mode === 'monthly'){ rptMOpen(); return; }\n", '')), /월간 분기/);
  assert.throws(() => S.imageCmds(mutate(app, ": await hostRequest('scheduleImageMove', params, 30000); }", ": await hostRequest('scheduleImageReorder', params, 30000); }")), /다섯/);
  assert.throws(() => S.noSend(mutate(app, ": await hostRequest('scheduleImageMove', params, 30000); }", ": await hostRequest(cmd, params, 30000); }")), /글자로 쓰지 않는|거의/);
  assert.throws(() => S.draft(mutate(app, '  if(PEER || !_rptMValid(from) || !_rptMValid(to)) return null;\n  try{ const raw', '  if(!_rptMValid(from) || !_rptMValid(to)) return null;\n  try{ const raw')), /PEER/);
  assert.throws(() => S.draft(mutate(app, 'const RPTM_DRAFT_KEEP = 6;', 'const RPTM_DRAFT_KEEP = 7;')), /6/);
});

// ══════════════════════════════════════════════════════════════════════
// jsdom 실행
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('monthly-report: jsdom 미설치: 월간 보고 탭 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
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
    w.eval('window.__toasts = []; (function(){ var t = toast; toast = function(m, k, a, ms){ __toasts.push(String(m)); return t(m, k, a, ms); }; })();');
    return { w, posted, doc: w.document, answered: new Set(), ev: (code) => w.eval(code), evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      close: async () => { await tick(); try { w.close(); } catch (_) {} } };
  }
  const bootBrowser = (src) => wrap(new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quiet(), beforeParse: shims }), []);
  function bootWidget(src) {
    const posted = [];
    const dom = new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quiet(),
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); }, addEventListener() {}, removeEventListener() {} } };
        shims(win);
      } });
    const M = wrap(dom, posted);
    const sess = posted.find((x) => x && x.cmd === 'userSessionGet');
    if (sess) M.ev('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'tester', name: '시험자' } }) + ')');
    return M;
  }
  //  아직 회신하지 않은 그 명령의 요청들(오래된 것부터)
  const pending = (m, cmd) => m.posted.filter((x) => x && x.cmd === cmd && x.reqId && !m.answered.has(x.reqId));
  function reply(m, cmd, res, pick) {
    const list = pending(m, cmd).filter(pick || (() => true));
    assert.ok(list.length, cmd + ' 요청이 없다');
    m.answered.add(list[0].reqId);
    m.ev('__hostReply(' + JSON.stringify(list[0].reqId) + ', ' + JSON.stringify(res) + ')');
    return list[0];
  }
  //  화면이 보낸 그림 목록, 미리 보기 요청을 모두 빈 회신으로 닫는다(다른 시험을 보는 동안)
  function drainImages(m) {
    for (const x of pending(m, 'scheduleImageList')) reply(m, 'scheduleImageList', { ok: true, data: { projectUid: x.projectUid, images: [], stale: false, notice: '' } }, (y) => y.reqId === x.reqId);
    for (const x of pending(m, 'scheduleImageThumb')) reply(m, 'scheduleImageThumb', { ok: false, error: { kind: 'notFound', message: '없음' } }, (y) => y.reqId === x.reqId);
  }
  const overlayOpen = (m, id) => { const o = m.doc.getElementById(id); return !!o && !o.classList.contains('hidden') && !o.classList.contains('closing'); };
  const overlayClosed = (m, id) => { const o = m.doc.getElementById(id); return !o || o.classList.contains('hidden'); };
  async function confirmAnswer(m, ok) {
    await waitFor(() => overlayOpen(m, 'confirmModal'), '확인창이 뜬다');
    const msg = m.doc.getElementById('cfMsg').textContent;
    if (ok) m.doc.getElementById('cfOk').click(); else m.ev("closeOverlay($('#confirmModal'))");
    await waitFor(() => overlayClosed(m, 'confirmModal'), '확인창이 닫힌다');
    await tick(); await tick();
    return msg;
  }
  const clearStore = (m) => m.ev("(function(){ var a=[]; for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && (k.indexOf('tc_rptDraftM:')===0 || k.indexOf('tc_rptMEtcOff:')===0)) a.push(k); } a.forEach(function(k){ localStorage.removeItem(k); }); })()");
  const monthKeys = (m) => m.evJSON("(function(){ var a=[], p='tc_rptDraftM:' + rptDraftWho() + ':'; for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && k.indexOf(p)===0) a.push(k.slice(p.length)); } return a.sort(); })()");
  const $id = (m, id) => m.doc.getElementById(id);
  const card = (m, uid) => [...m.doc.querySelectorAll('#rptmCards .rptm-card[data-uid]')].find((c) => c.dataset.uid === uid) || null;
  const setVal = (m, el, v, type = 'input') => { el.value = v; el.dispatchEvent(new m.w.Event(type, { bubbles: true })); };
  async function loadPeriod(m, from, to) {
    $id(m, 'rptmFrom').value = from; $id(m, 'rptmTo').value = to;
    $id(m, 'rptmLoad').click();
    await tick(); await tick();
  }

  // ── 지어낸 상태 ─────────────────────────────────────────────────────
  const U1 = 'aaaaaaaa-0000-4000-8000-000000000001', U2 = 'aaaaaaaa-0000-4000-8000-000000000002',
        U3 = 'aaaaaaaa-0000-4000-8000-000000000003', U4 = 'aaaaaaaa-0000-4000-8000-000000000004';
  const P1 = 'db-' + U1, P2 = 'db-' + U2, P3 = 'db-' + U3, P4 = 'db-' + U4;
  const ROWS = [
    { uid: U1, project_name: '(예시) 관제 고도화 사업', common_name: '(예시) 관제 고도화', sectionId: 1, start_date: '2025-07-01', end_date: '2027-01-29', dev_start_date: '2025-08-01', dev_end_date: '2026-12-31' },
    { uid: U2, project_name: '(예시) 해양 관측 체계', common_name: '', sectionId: 1, start_date: '2026-02-01', end_date: '2027-03-31', dev_start_date: '2026-03-02', dev_end_date: '' },
    { uid: U3, project_name: '(예시) 보안 점검 도구', common_name: '', sectionId: 2, start_date: '2026-01-01', end_date: '2026-12-31', dev_start_date: '', dev_end_date: '' },
    { uid: U4, project_name: '(예시) 기록 없는 과제', common_name: '', sectionId: 2, start_date: '', end_date: '', dev_start_date: '', dev_end_date: '' },
  ];
  const CA = '2026-07-01T00:00:00.000Z';
  const E = (o) => Object.assign({ allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: null,
    endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }, o);
  const FROM = '2026-09-01', TO = '2026-09-30';
  const cat = (id, name, source) => Object.assign({ id, name, color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }, source ? { source } : {});
  const stateFor = () => ({
    gitAuthor: '', svnAuthor: '',
    categories: [cat(P1, '(예시) 관제 고도화', 'db'), cat('c-in', '(예시) 사내 업무'), cat(P2, '(예시) 해양 관측 체계', 'db'), cat(P3, '(예시) 보안 점검 도구', 'db'),
      cat(P4, '(예시) 기록 없는 과제', 'db'), cat('c-ed', '(예시) 교육')],
    entries: [
      E({ id: 'e1', date: '2026-09-03', title: '화면 응답 속도 개선', categoryId: P1, memo: '목록 갱신 횟수 줄임\n• 첫 화면 읽기 순서 정리' }),
      E({ id: 'g1', date: '2026-09-08', title: '작업일지', categoryId: P1, source: 'git', commits: [{ hash: 'h1', short: 'h1', time: '09:00', subject: '알람 기준값 화면 추가', body: '본문 첫 줄\n  - 들여쓴 본문' }] }),
      E({ id: 'e2', date: '2026-09-15', title: '중간 점검 회의 (09.15, 고객사)', categoryId: P1 }),
      E({ id: 'e3', date: '2026-09-10', title: '관측 자료 수신 모듈 정리', categoryId: P2 }),
      E({ id: 'e4', date: '2026-10-14', title: '점검 항목 화면 착수', categoryId: P3 }),   // 계획 기간에만 기록
      E({ id: 'e5', date: '2026-09-04', title: '주간 회의 자료 정리', categoryId: 'c-in', memo: '팀 공용 폴더 정리' }),
      E({ id: 'e6', date: '2026-09-11', title: '보안 교육 이수', categoryId: 'c-ed' }),
      E({ id: 'e7', date: '2026-08-20', title: '기간 밖 일', categoryId: P1 }),
    ],
    todos: [{ id: 't1', text: '자료 보관 주기 설정', done: false, categoryId: P2, due: '2026-09-14', endDate: '2026-09-18', prio: 'normal', completedAt: '', note: '',
              dayNotes: { '2026-09-14': '월 메모', '2026-09-16': '수 메모' }, createdAt: CA, updatedAt: CA }],
    rooms: [], attendance: {},
    taskHours: { '2026-09-03': { [P1]: 2 }, '2026-09-10': { [P2]: 1.5 } },
    gitCommitBody: true, reportMarker: '-', reportMarkerCustom: '', reportIndent: 2,
    reportFormatPrefs: { daily: { marker: '-', markerCustom: '', indent: 2 }, weekly: { marker: '-', markerCustom: '', indent: 2 } },
  });
  const META = { schemaVersion: '17', expectedSchema: '17', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  //  기간 취합(custom) 복사 글: 월간 실적 글의 기준
  const customCopy = (m) => m.ev(`(function(){ setReportMode('custom'); $('#rptFrom').value = ${JSON.stringify(FROM)}; $('#rptTo').value = ${JSON.stringify(TO)}; buildReport(); return buildReportText(); })()`);
  //  월간 상태로 기간 취합 복사 글을 다시 짓는다: 내 카테고리 순서, [이름] + ('\n' + 그 칸 글). 공식 과제 = 카드 실적, 나머지 = 기타 항목 글.
  const monthlyAsCopy = (m) => m.ev(`(function(){ var S = __rptM, etc = rptMAuto(S, false).etc; var blocks = state.categories.map(function(c){
      var t = isOfficialCat(c) ? S.cards[c.id].actual : (etc.find(function(e){ return e.key === c.id; }) || { text: '' }).text;
      return '[' + c.name + ']' + (t ? '\\n' + t : ''); }); return blocks.join('\\n\\n') + '\\n'; })()`);

  async function widget() {
    const M = bootWidget(app);
    clearStore(M);
    M.ev('__applyState(' + JSON.stringify(JSON.stringify(stateFor())) + ',' + JSON.stringify(META) + ')');
    M.ev('__applyProjects(' + JSON.stringify(JSON.stringify(ROWS)) + ')');
    await tick();
    M.ev('state.categories = ' + JSON.stringify(stateFor().categories) + ';');   // 기본 과제 자동 보충 등과 무관하게 이 순서로 시험한다
    M.ev("openReport(); setReportMode('monthly');");
    await tick();
    drainImages(M);
    await loadPeriod(M, FROM, TO);
    drainImages(M);
    await tick();
    return M;
  }

  let W = null, bootErr = null;
  try { W = await widget(); } catch (e) { bootErr = e; }
  if (bootErr) {
    test('MW0: 위젯 모드 부팅', () => { throw bootErr; });
  } else {
    const fresh = async () => {
      clearStore(W);
      W.ev("__rptM = null; __rptMWeek = null; setReportMode('daily'); setReportMode('monthly');");
      await tick(); drainImages(W);
      await loadPeriod(W, FROM, TO); drainImages(W); await tick();
    };

    test('MW1 (§5.2): 열면 실적 기간은 지난달 1일 ~ 말일, 작성일은 오늘, 계획 기간은 다음 월요일부터 같은 주 수 금요일까지', async () => {
      clearStore(W);
      W.ev("__rptM = null; setReportMode('daily'); setReportMode('monthly');"); await tick(); drainImages(W);
      const lm = W.evJSON('monthRange(new Date(), -1)');
      assert.deepStrictEqual([$id(W, 'rptmFrom').value, $id(W, 'rptmTo').value], lm, '기본 실적 기간이 지난달이 아니다');
      assert.strictEqual($id(W, 'rptmDate').value, W.ev('todayYmd()'), '작성일 기본이 오늘이 아니다');
      assert.deepStrictEqual(W.evJSON("rptMPlanDefault('2026-08-03', '2026-09-18')"), { from: '2026-09-21', to: '2026-11-06' }, '계획 기본값 예시(§5.2)가 다르다');
      assert.deepStrictEqual(W.evJSON('rptMPlanDefault(' + JSON.stringify(lm[0]) + ',' + JSON.stringify(lm[1]) + ')'), { from: $id(W, 'rptmPFrom').value, to: $id(W, 'rptmPTo').value }, '화면 계획 기간이 기본값이 아니다');
      assert.strictEqual($id(W, 'rptmName').value, '시험자', '이름 기본이 로그인 계정 표시 이름이 아니다');
      assert.ok(W.doc.getElementById('reportModal').classList.contains('rptm-on'), '월간 표시(rptm-on)가 없다');
      await fresh();
    });

    test('MW2 (§4, §7.4): 실적 기간, 직접 고친 계획 기간, 작성일, 이름이 payload 에 그대로 간다, 저장 회신(경로 토스트, notice, 폴더 열기)', async () => {
      await fresh();
      setVal(W, $id(W, 'rptmPFrom'), '2026-10-05', 'change'); setVal(W, $id(W, 'rptmPTo'), '2026-11-13', 'change');
      setVal(W, $id(W, 'rptmDate'), '2026-10-23', 'change'); setVal(W, $id(W, 'rptmName'), '홍길동');
      $id(W, 'rptmSave').click(); await tick();
      const req = pending(W, 'exportMonthlyDocx')[0];
      assert.ok(req, 'exportMonthlyDocx 요청이 없다');
      assert.deepStrictEqual([req.actual, req.plan, req.reportDate, req.name], [{ from: FROM, to: TO }, { from: '2026-10-05', to: '2026-11-13' }, '2026-10-23', '홍길동'], '기간, 작성일, 이름이 그대로 가지 않았다');
      assert.ok(Array.isArray(req.projects) && req.etc && Array.isArray(req.etc.lines), 'payload 모양(projects, etc.lines)이 아니다');
      assert.ok(!('images' in req) && !JSON.stringify(req).includes('base64'), 'payload 에 그림 바이트가 실렸다');
      assert.ok($id(W, 'rptmSave').disabled, '저장 중 버튼이 잠기지 않았다');
      reply(W, 'exportMonthlyDocx', { ok: true, path: 'C:\\시험\\월간보고_홍길동_261023.docx', dir: 'C:\\시험', projects: 3, images: 0, imageSource: 'cache', notice: '서버에 연결되지 않아 PC 에 받아 둔 그림으로 넣었습니다.' });
      await tick();
      const ts = W.evJSON('__toasts');
      assert.ok(ts.some((t) => t.includes('C:\\시험\\월간보고_홍길동_261023.docx')), '저장 경로 토스트가 없다');
      assert.ok(ts.some((t) => t.includes('PC 에 받아 둔 그림')), 'notice 를 보여 주지 않았다');
      assert.ok(!$id(W, 'rptmOpenDir').classList.contains('hidden'), '폴더 열기 버튼이 없다');
      $id(W, 'rptmOpenDir').click();
      const of = W.posted.filter((x) => x && x.cmd === 'openFolder').pop();
      assert.deepStrictEqual(of && of.path, 'C:\\시험', '폴더 열기가 호스트가 준 dir 로 가지 않았다');
      //  실패는 이유를 그대로
      $id(W, 'rptmSave').click(); await tick();
      reply(W, 'exportMonthlyDocx', { ok: false, error: '파일이 열려 있어 저장할 수 없습니다. Word 나 한글에서 닫고 다시 시도하세요.' }); await tick();
      assert.ok(W.evJSON('__toasts').includes('파일이 열려 있어 저장할 수 없습니다. Word 나 한글에서 닫고 다시 시도하세요.'), '저장 실패 이유를 그대로 보여 주지 않았다');
      //  취소는 조용히
      const n = W.evJSON('__toasts').length;
      $id(W, 'rptmSave').click(); await tick();
      reply(W, 'exportMonthlyDocx', { ok: false, cancelled: true }); await tick();
      assert.strictEqual(W.evJSON('__toasts').length, n, '저장 창 취소에 토스트가 떴다');
      assert.ok(!$id(W, 'rptmSave').disabled, '회신 뒤 저장 버튼이 풀리지 않았다');
    });

    test('MW3 (§4): 과제 수행 기간 = DB 개발 시작일 ~ 개발종료일(YYYY/MM), 빈 쪽은 빈칸(계약 날짜로 대신하지 않음), 카드는 미정', async () => {
      await fresh();
      W.ev(`[${JSON.stringify(P1)}, ${JSON.stringify(P2)}, ${JSON.stringify(P3)}].forEach(function(id){ __rptM.checked[id] = true; }); rptMRenderAll();`);
      drainImages(W);
      const p = W.evJSON('rptMPayload(__rptM)');
      const term = (id) => p.projects.find((x) => x.uid === id).term;
      assert.strictEqual(term(P1), '2025/08 ~ 2026/12');
      assert.strictEqual(term(P2).trim(), '2026/03 ~', '종료가 빈 과제의 기간이 다르다(계약 종료로 채우면 안 된다)');
      assert.strictEqual(term(P3), '', '둘 다 빈 과제의 기간은 빈칸이어야 한다(계약 기간으로 대신하지 않는다)');
      assert.ok(card(W, P2).querySelector('.rptm-term').textContent.includes('2026/03 ~ 미정'), '빈 쪽이 카드에 미정으로 보이지 않는다');
      assert.ok(card(W, P3).querySelector('.rptm-badge.tbd'), '둘 다 빈 과제 카드에 미정 표시가 없다');
      assert.ok(card(W, P1).querySelector('input[data-f="title"]').value === '(예시) 관제 고도화' && p.projects.find((x) => x.uid === P2).title === '(예시) 해양 관측 체계', '과제명 기본이 통상명칭, 없으면 사업명이 아니다');
    });

    test('MW4 (§5.3-4): 실적 글 = 같은 기간 기간 취합 복사 글의 과제별 블록(글자 그대로, 서식 여러 벌), 공용 일정은 들어가지 않는다', async () => {
      const FMTS = [['-', '', 2, true, true], ['1.', '', 3, true, false], ['none', '', 0, false, true], ['가.', '', 1, true, true], ['1.', '▶', 2, false, false]];
      W.ev("PCAL.events = [{ eventUid: 'pe1', projectUid: " + JSON.stringify(U1) + ", title: '공용 착수 회의(시험)', date: '2026-09-09', endDate: '', allDay: true }];");
      try {
        for (const [mk, cu, ind, desc, body] of FMTS) {
          const tag = `${mk}/${cu}/${ind} desc=${desc} body=${body}`;
          W.ev(`state.reportFormatPrefs.weekly = { marker: ${JSON.stringify(mk)}, markerCustom: ${JSON.stringify(cu)}, indent: ${ind} }; state.gitCommitBody = ${body};`);
          W.ev(`setReportMode('custom'); $('#rptWithDesc').checked = ${desc}; buildReport();`);
          const copy = customCopy(W);
          assert.ok(copy.includes('화면 응답 속도 개선') && copy.includes('관측 자료 수신 모듈 정리'), '전제: 기간 취합 글이 비었다 ' + tag);
          W.ev("setReportMode('monthly'); __rptM = rptMFresh(" + JSON.stringify(FROM) + ',' + JSON.stringify(TO) + ", 'cal'); rptMRenderAll();");
          drainImages(W);
          assert.strictEqual(monthlyAsCopy(W), copy, '월간 실적 글을 이어 붙인 것이 기간 취합 복사 글과 다르다: ' + tag);
          const a1 = W.ev(`__rptM.cards[${JSON.stringify(P1)}].actual`);
          assert.ok(!a1.includes('공용 착수 회의') && !a1.includes('기간 밖 일'), '공용 일정이나 기간 밖 기록이 실적에 들어갔다: ' + tag);
          assert.strictEqual(card(W, P1).querySelector('textarea[data-f="actual"]').value, a1, '카드 실적 칸이 상태와 다르다: ' + tag);
        }
      } finally {
        W.ev("PCAL.events = []; state.reportFormatPrefs.weekly = { marker: '-', markerCustom: '', indent: 2 }; state.gitCommitBody = true; setReportMode('custom'); $('#rptWithDesc').checked = true; buildReport();");
        await fresh();
      }
    });

    test('MW5 (§5.3-1): 기록이 있는 과제(실적 기간 기록, 공수, 계획 기간 기록)만 처음부터 체크, 내 카테고리 순서, 위아래로 순서가 바뀌고 문서에도 그 순서', async () => {
      await fresh();
      const order = W.evJSON('__rptM.order');
      assert.deepStrictEqual(order, [P1, P2, P3, P4], '과제 목록이 내 카테고리 순서의 공식 과제가 아니다');
      assert.deepStrictEqual(order.map((id) => W.ev(`!!__rptM.checked[${JSON.stringify(id)}]`)), [true, true, true, false], '기본 체크가 기록 있는 과제가 아니다(계획 기간 기록 포함)');
      const rows = [...W.doc.querySelectorAll('#rptmPick .rptm-pi')];
      assert.strictEqual(rows.length, 4);
      assert.strictEqual(rows[3].querySelector('.rptm-badge').textContent, '기록 없음');
      rows[1].querySelector('[data-act="up"]').click(); drainImages(W);
      assert.deepStrictEqual(W.evJSON('__rptM.order').slice(0, 2), [P2, P1], '위로가 순서를 바꾸지 않았다');
      assert.deepStrictEqual(W.evJSON('rptMPayload(__rptM).projects.map(function(p){ return p.uid; })'), [P2, P1, P3], '문서 과제 순서가 목록 순서가 아니다(체크 안 한 과제는 빠진다)');
      const cb = [...W.doc.querySelectorAll('#rptmPick .rptm-pi')].find((x) => x.dataset.uid === P4).querySelector('input');
      cb.checked = true; cb.dispatchEvent(new W.w.Event('change', { bubbles: true })); drainImages(W);
      assert.ok(card(W, P4), '체크한 과제의 카드가 생기지 않았다');
    });

    test('MW6 (§4, §5.3-5): 계획 두 칸과 변경이력은 자동으로 채우지 않고, 다시 읽어 오기(확인 뒤)는 실적만 다시 붙인다', async () => {
      await fresh();
      const c1 = card(W, P1);
      assert.deepStrictEqual([c1.querySelector('[data-f="prev"]').value, c1.querySelector('[data-f="next"]').value, c1.querySelector('[data-cf="what"]').value], ['', '', ''], '계획 칸이나 변경이력이 자동으로 채워졌다');
      const auto = W.ev(`__rptM.cards[${JSON.stringify(P1)}].actual`);
      assert.ok(auto.length > 0, '전제: 실적이 붙었다');
      setVal(W, c1.querySelector('[data-f="prev"]'), '지난 계획(직접)');
      setVal(W, c1.querySelector('[data-f="next"]'), '- 다음 계획(직접)\n  ; 세부');
      setVal(W, c1.querySelector('[data-cf="what"]'), '통합 시험 연기'); setVal(W, c1.querySelector('[data-cf="date"]'), '2026.09.10'); setVal(W, c1.querySelector('[data-cf="why"]'), '장비 입고 지연');
      setVal(W, c1.querySelector('[data-f="title"]'), '(예시) 고친 과제명');
      setVal(W, c1.querySelector('[data-f="actual"]'), '고친 실적');
      $id(W, 'rptmLoad').click();
      const msg = await confirmAnswer(W, false);
      assert.ok(msg.includes('그대로 둡니다'), '다시 읽어 오기 확인 문구가 계획과 변경이력을 둔다고 말하지 않는다');
      assert.strictEqual(W.ev(`__rptM.cards[${JSON.stringify(P1)}].actual`), '고친 실적', '취소했는데 실적이 바뀌었다');
      $id(W, 'rptmLoad').click();
      await confirmAnswer(W, true); drainImages(W);
      const c = W.evJSON(`__rptM.cards[${JSON.stringify(P1)}]`);
      assert.strictEqual(c.actual, auto, '다시 읽어 오기가 실적을 기록에서 다시 붙이지 않았다');
      assert.deepStrictEqual([c.prev, c.next, c.title, c.changes], ['지난 계획(직접)', '- 다음 계획(직접)\n  ; 세부', '(예시) 고친 과제명', [{ what: '통합 시험 연기', date: '2026.09.10', why: '장비 입고 지연' }]], '다시 읽어 오기가 계획, 과제명, 변경이력을 덮었다');
      const p = W.evJSON('rptMPayload(__rptM)').projects.find((x) => x.uid === P1);
      assert.deepStrictEqual(p.nextPlan, [{ level: 0, text: '- 다음 계획(직접)' }, { level: 1, text: '; 세부' }], '본문 칸 줄이 {level, text} 로 가지 않는다');
      assert.deepStrictEqual(p.changes, [{ what: '통합 시험 연기', date: '2026.09.10', why: '장비 입고 지연' }]);
      //  카드 하나만 다시 읽어 오기
      setVal(W, card(W, P1).querySelector('[data-f="actual"]'), '또 고친 실적');
      card(W, P1).querySelector('[data-act="reload"]').click();
      await confirmAnswer(W, true);
      assert.strictEqual(W.ev(`__rptM.cards[${JSON.stringify(P1)}].actual`), auto, '카드의 실적 다시 읽어 오기가 되돌리지 않았다');
      assert.strictEqual(W.ev(`__rptM.cards[${JSON.stringify(P1)}].next`), '- 다음 계획(직접)\n  ; 세부', '카드 다시 읽어 오기가 계획을 덮었다');
    });

    test('MW7 (§5.3-4): 줄 앞 들여쓰기 깊이 → level(0..3, 칸 안의 순위), 글자는 들여쓰기만 떼고 그대로, 앞뒤 빈 줄 제거', () => {
      const r = W.evJSON("rptMLines('\\n- 가\\n\\u00a0\\u00a0; 나 \\n\\n\\u00a0\\u00a0\\u00a0\\u00a0\\u00a0\\u00a0본문\\n\\t\\t\\t깊이\\n\\n')");
      assert.deepStrictEqual(r, [{ level: 0, text: '- 가' }, { level: 1, text: '; 나' }, { level: 0, text: '' }, { level: 2, text: '본문' }, { level: 3, text: '깊이' }]);
      assert.deepStrictEqual(W.evJSON("rptMLines('    - 들여 쓴 첫 줄\\n      ; 세부')"), [{ level: 0, text: '- 들여 쓴 첫 줄' }, { level: 1, text: '; 세부' }], '가장 얕은 들여쓰기가 level 0 이 아니다');
      assert.deepStrictEqual(W.evJSON("rptMLines('')"), []);
    });

    test('MW8 (§6, §12): 그림 버튼은 단계 A 명령만 쓴다(목록, 미리 보기, 파일, 붙여넣기, Ctrl+V, 순서, 삭제 확인), 끊기면 사본 목록과 안내, 추가 삭제 막힘', async () => {
      await fresh();
      W.ev('__rptMThumbs.clear(); __rptMThumbReq.clear(); __rptMImgs.clear(); rptMRenderCards();');
      const ln0 = W.posted.length;
      const IMG = (id, seq, by) => ({ id, seq, mime: 'image/png', width: 640, height: 200, bytes: 1000, sha256: String(id).repeat(64).slice(0, 64), uploadedBy: by, uploadedAt: '2026-10-02T05:10:00.000Z' });
      reply(W, 'scheduleImageList', { ok: true, data: { projectUid: U1, images: [IMG(1, 1, '김예시'), IMG(2, 2, '박예시')], stale: false, notice: '' } }, (x) => x.projectUid === P1);
      //  P2 는 서버가 끊겨 사본 목록(stale)
      reply(W, 'scheduleImageList', { ok: false, data: { projectUid: U2, images: [IMG(3, 1, '홍길동')], stale: true, notice: '서버에 연결되지 않아 PC 에 받아 둔 그림만 보여 줍니다. 추가와 삭제는 연결된 뒤에 하세요.' }, error: { kind: 'connection', message: '서버에 연결할 수 없습니다.' } }, (x) => x.projectUid === P2);
      reply(W, 'scheduleImageList', { ok: false, error: { kind: 'forbidden', message: '로그인이 필요합니다.' } }, (x) => x.projectUid === P3);
      await tick();
      const c1 = card(W, P1);
      assert.strictEqual(c1.querySelectorAll('.rptm-img').length, 2, '그림 두 장이 보이지 않는다');
      assert.ok(c1.querySelector('.rptm-img .meta').textContent.includes('김예시'), '등록한 사람이 보이지 않는다');
      reply(W, 'scheduleImageThumb', { ok: true, data: { id: 1, sha256: IMG(1).sha256, dataUrl: 'data:image/jpeg;base64,AAAA', width: 10, height: 4, stale: false } }, (x) => x.id === 1);
      await tick();
      assert.strictEqual(card(W, P1).querySelector('.rptm-img img').getAttribute('src'), 'data:image/jpeg;base64,AAAA', '미리 보기 그림이 붙지 않았다');
      const c2 = card(W, P2);
      assert.ok(c2.querySelector('[data-act="imgFile"]').disabled && c2.querySelector('[data-act="imgDel"]').disabled && c2.querySelector('[data-act="imgPaste"]').disabled, '끊긴 과제에서 추가와 삭제가 막히지 않았다');
      assert.ok(c2.querySelector('[data-msg]').textContent.includes('PC 에 받아 둔 그림만'), '끊김 안내(notice)가 없다');
      assert.strictEqual(c2.querySelectorAll('.rptm-img').length, 1, '사본 목록이 보이지 않는다');
      assert.ok(card(W, P3).querySelector('[data-msg]').textContent.includes('로그인이 필요합니다.') && card(W, P3).querySelector('[data-act="imgFile"]').disabled, '목록 거부 이유가 그대로 보이지 않거나 추가가 열려 있다');
      //  파일 고르기 → 취소
      card(W, P1).querySelector('[data-act="imgFile"]').click(); await tick();
      const add1 = reply(W, 'scheduleImageAdd', { ok: false, cancelled: true });
      assert.deepStrictEqual([add1.projectUid, add1.mode], [P1, 'file']);
      await tick();
      //  붙여넣기 → 성공(세 장)
      card(W, P1).querySelector('[data-act="imgPaste"]').click(); await tick();
      const add2 = reply(W, 'scheduleImageAdd', { ok: true, data: { projectUid: U1, image: IMG(4, 3, '시험자'), images: [IMG(1, 1, '김예시'), IMG(2, 2, '박예시'), IMG(4, 3, '시험자')] } });
      assert.strictEqual(add2.mode, 'clipboard');
      await tick();
      assert.strictEqual(card(W, P1).querySelectorAll('.rptm-img').length, 3, '넣은 뒤 목록이 갱신되지 않았다');
      assert.ok(card(W, P1).querySelector('[data-msg]').textContent.includes('그림을 넣었습니다'));
      //  Ctrl+V(글 칸 밖) → 클립보드
      const zone = card(W, P1).querySelector('[data-act="zone"]');
      zone.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true })); await tick();
      const add3 = reply(W, 'scheduleImageAdd', { ok: false, error: { kind: 'invalid', message: '같은 그림이 이 과제에 이미 있습니다.' } });
      assert.strictEqual(add3.mode, 'clipboard', 'Ctrl+V 가 클립보드 넣기로 가지 않았다');
      await tick();
      assert.ok(card(W, P1).querySelector('[data-msg]').textContent.includes('같은 그림이 이 과제에 이미 있습니다.'), '거절 이유가 그대로 보이지 않는다');
      //  글 칸 안의 Ctrl+V 는 글 붙여넣기 그대로(그림 요청 없음)
      const before = pending(W, 'scheduleImageAdd').length;
      card(W, P1).querySelector('textarea[data-f="next"]').dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true })); await tick();
      assert.strictEqual(pending(W, 'scheduleImageAdd').length, before, '글 칸 Ctrl+V 가 그림 넣기를 불렀다');
      //  순서 ▶
      card(W, P1).querySelector('.rptm-img [data-act="imgR"]').click(); await tick();
      const mv = reply(W, 'scheduleImageMove', { ok: true, data: { projectUid: U1, images: [IMG(2, 1, '박예시'), IMG(1, 2, '김예시'), IMG(4, 3, '시험자')], stale: false, notice: '' } });
      assert.deepStrictEqual([mv.id, mv.seq], [1, 2], '뒤로 가 첫 그림을 2번 자리로 보내지 않았다');
      await tick();
      //  삭제: 확인 창 취소 → 요청 없음, 확인 → 요청
      card(W, P1).querySelector('.rptm-img [data-act="imgDel"]').click();
      const dmsg = await confirmAnswer(W, false);
      assert.ok(dmsg.includes('되돌릴 수 없습니다') && dmsg.includes('박예시'), '삭제 확인 문구에 등록자와 되돌릴 수 없음이 없다');
      assert.strictEqual(pending(W, 'scheduleImageDelete').length, 0, '취소했는데 삭제 요청이 갔다');
      card(W, P1).querySelector('.rptm-img [data-act="imgDel"]').click();
      await confirmAnswer(W, true);
      const del = reply(W, 'scheduleImageDelete', { ok: true, data: { projectUid: U1, images: [IMG(1, 1, '김예시'), IMG(4, 2, '시험자')], stale: false, notice: '' } });
      assert.strictEqual(del.id, 2);
      await tick();
      assert.strictEqual(card(W, P1).querySelectorAll('.rptm-img').length, 2);
      //  그동안 나간 그림 명령은 단계 A 다섯뿐
      const cmds = new Set(W.posted.slice(ln0).map((x) => x && x.cmd).filter((c) => /^scheduleImage|Monthly|netcus/i.test(c || '')));
      for (const c of cmds) assert.ok(['scheduleImageList', 'scheduleImageThumb', 'scheduleImageAdd', 'scheduleImageDelete', 'scheduleImageMove'].includes(c), '그림 버튼이 다른 명령을 보냈다: ' + c);
      drainImages(W);
    });

    test('MW9 (§5.4): 초안 키 tc_rptDraftM:<who>:<from>_<to>, 계정별 최근 6건, 다시 열면 직접 쓴 칸이 남는다, 저장소가 막혀도 깨지지 않는다', async () => {
      await fresh();
      const who = W.ev('rptDraftWho()');
      assert.strictEqual(who, '7', '전제: 계정 = userId');
      setVal(W, card(W, P1).querySelector('[data-f="next"]'), '초안에 남을 계획');
      await tick(450);
      assert.ok(W.ev(`localStorage.getItem('tc_rptDraftM:7:${FROM}_${TO}') !== null`), '초안 키가 tc_rptDraftM:<who>:<from>_<to> 가 아니다');
      const months = [['2026-01-01', '2026-01-31'], ['2026-02-01', '2026-02-28'], ['2026-03-01', '2026-03-31'], ['2026-04-01', '2026-04-30'], ['2026-05-01', '2026-05-31'], ['2026-06-01', '2026-06-30'], ['2026-07-01', '2026-07-31']];
      for (const [f, t] of months) { await loadPeriod(W, f, t); drainImages(W); await tick(5); }
      const keys = monthKeys(W);
      assert.strictEqual(keys.length, 6, '초안이 6건으로 정리되지 않았다: ' + keys.join(', '));
      assert.ok(!keys.includes('2026-01-01_2026-01-31') && !keys.includes(FROM + '_' + TO) && keys.includes('2026-07-01_2026-07-31'), '가장 오래된 초안부터 지우지 않았다: ' + keys.join(', '));
      W.ev("localStorage.setItem('tc_rptDraftM:other:2026-01-01_2026-01-31', '{}'); localStorage.setItem('tc_rptDraftW:7:2026-01-05_2026-01-11', '{}');");
      await loadPeriod(W, '2026-08-01', '2026-08-31'); drainImages(W);
      assert.ok(W.ev("localStorage.getItem('tc_rptDraftM:other:2026-01-01_2026-01-31') !== null && localStorage.getItem('tc_rptDraftW:7:2026-01-05_2026-01-11') !== null"), '다른 계정이나 주간 초안을 지웠다');
      //  초안이 있는 기간으로 돌아가면 이어서 연다
      setVal(W, card(W, P1) ? card(W, P1).querySelector('[data-f="prev"]') : W.doc.querySelector('#rptmCards textarea[data-f="etc"]'), '8월에 쓴 글');
      await loadPeriod(W, '2026-07-01', '2026-07-31'); drainImages(W);
      await loadPeriod(W, '2026-08-01', '2026-08-31'); drainImages(W);
      assert.ok(W.ev("JSON.stringify(__rptM).indexOf('8월에 쓴 글') >= 0"), '초안이 있는 기간으로 돌아왔는데 직접 쓴 글이 없다');
      //  저장소가 막힘
      W.ev("window.__ls = [Storage.prototype.getItem, Storage.prototype.setItem]; Storage.prototype.getItem = function(){ throw new Error('blocked'); }; Storage.prototype.setItem = function(){ throw new Error('blocked'); };");
      try {
        assert.strictEqual(W.ev('rptMDraftSave()'), false, '막힌 저장소에서 저장이 성공했다고 한다');
        assert.ok($id(W, 'rptmDraftSt').textContent.includes('저장하지 못했습니다'), '막힌 저장소 안내가 없다');
        assert.strictEqual(W.ev("rptMDraftLoad('2026-07-01', '2026-07-31')"), null);
        assert.strictEqual(W.ev('rptMEtcOffGet().size'), 0);
        W.ev("rptMEtcOffSet(new Set(['c-in'])); rptMDraftPrune();");
        await loadPeriod(W, '2026-05-01', '2026-05-31');
        drainImages(W);
      } finally { W.ev('Storage.prototype.getItem = __ls[0]; Storage.prototype.setItem = __ls[1];'); }
      await fresh();
    });

    test('MW10 (§11.2-3): 기타는 공식 과제가 아닌 카테고리 전부, 뺀 카테고리는 계정별로 기억하고 다시 열어도 빠져 있다', async () => {
      await fresh();
      const etc0 = W.ev('__rptM.etcText');
      assert.ok(etc0.includes('주간 회의 자료 정리') && etc0.includes('보안 교육 이수'), '기타 본문에 공식 과제가 아닌 카테고리 글이 없다');
      assert.ok(!etc0.includes('화면 응답 속도 개선'), '기타 본문에 공식 과제 글이 들어갔다');
      const cb = W.doc.querySelector('#rptmCards input[data-etc="c-ed"]');
      cb.checked = false; cb.dispatchEvent(new W.w.Event('change', { bubbles: true })); await tick();
      assert.deepStrictEqual(W.evJSON("JSON.parse(localStorage.getItem('tc_rptMEtcOff:7'))"), ['c-ed'], '뺀 카테고리를 계정별 키에 기억하지 않았다');
      assert.ok(!W.ev('__rptM.etcText').includes('보안 교육 이수') && W.ev('__rptM.etcText').includes('주간 회의 자료 정리'), '뺀 카테고리 글이 기타 본문에 남았다');
      assert.ok(!JSON.stringify(W.evJSON('rptMPayload(__rptM).etc.lines')).includes('보안 교육'), 'payload 기타에 뺀 카테고리가 있다');
      W.ev("__rptM = null; setReportMode('daily'); setReportMode('monthly');"); await tick(); drainImages(W);
      assert.strictEqual(W.doc.querySelector('#rptmCards input[data-etc="c-ed"]').checked, false, '다시 열었는데 뺀 카테고리가 다시 들어갔다');
      assert.strictEqual(W.doc.querySelector('#rptmCards input[data-etc="c-in"]').checked, true);
      //  고친 기타 본문이 있으면 다시 붙이기 전에 묻는다
      await loadPeriod(W, FROM, TO); drainImages(W);
      setVal(W, W.doc.querySelector('#rptmCards textarea[data-f="etc"]'), '고친 기타');
      const cb2 = W.doc.querySelector('#rptmCards input[data-etc="c-ed"]');
      cb2.checked = true; cb2.dispatchEvent(new W.w.Event('change', { bubbles: true }));
      await confirmAnswer(W, false);
      assert.strictEqual(W.ev('__rptM.etcText'), '고친 기타', '취소했는데 고친 기타 본문을 덮었다');
      assert.deepStrictEqual(W.evJSON("JSON.parse(localStorage.getItem('tc_rptMEtcOff:7'))"), [], '넣기로 바꾼 것을 기억하지 않았다');
      clearStore(W);
    });

    const WEEKS = [
      { regdate: '2026-09-07', title: '9월 1주 주간보고', period: '2026.09.01~2026.09.05', endwork: '[(예시) 관제 고도화]\n- 화면 응답 개선\n  ; 목록 갱신 줄임\n[(예시) 사내 업무]\n- 회의 자료 정리\n[(예시) 없는 과제]\n- 미등록 일', content: '[(예시) 관제 고도화] : 10\n합계 : 10', plan: '' },
      { regdate: '2026-09-14', title: '9월 2주 주간보고', period: '2026.09.07~2026.09.11', endwork: '[(예시) 관제 고도화]\n- 알람 기준값 화면\n[(예시) 해양 관측 체계]\n- 수신 모듈 정리', content: '', plan: '' },
    ];
    test('MW11 (§5.3-4): 주간보고 출처: netcusWeeklyRangeRead(읽기)만 부르고, 과제별 글 = buildNetcusWeeklyText 과제 블록(머리 줄 뺌), 미등록 과제는 기타에 따로', async () => {
      await fresh();
      for (const flat of [false, true]) {
        W.ev('weeklyFlat = ' + flat + ';');
        W.doc.querySelector('#rptmSrc [data-msrc="week"]').click(); await tick();
        assert.strictEqual(W.ev('__rptM.src'), 'week');
        $id(W, 'rptmLoad').click();
        await confirmAnswer(W, true);
        assert.ok($id(W, 'rptmLoad').disabled, '읽는 동안 읽어 오기가 잠기지 않았다');
        const rq = reply(W, 'netcusWeeklyRangeRead', { ok: true, error: '', weeks: WEEKS });
        assert.deepStrictEqual([rq.from, rq.to], [FROM, TO], '주간보고를 실적 기간으로 읽지 않았다');
        await tick(); drainImages(W);
        const want = W.evJSON(`(function(){ var p = parseNetcusWeekly(JSON.parse(${JSON.stringify(JSON.stringify(WEEKS))}), state.categories); var o = {}; p.tasks.forEach(function(t){ var b = buildNetcusWeeklyText({ tasks: [t] }, weeklyFlat); o[t.name] = b.slice(b.indexOf('\\n') + 1); }); o.__all = buildNetcusWeeklyText(p, weeklyFlat); return o; })()`);
        assert.strictEqual(W.ev(`__rptM.cards[${JSON.stringify(P1)}].actual`), want['(예시) 관제 고도화'], '관제 고도화 실적이 주간보고 과제 블록과 다르다(flat=' + flat + ')');
        assert.strictEqual(W.ev(`__rptM.cards[${JSON.stringify(P2)}].actual`), want['(예시) 해양 관측 체계'], '해양 관측 실적이 다르다');
        assert.ok(want.__all.includes(want['(예시) 관제 고도화']), '전제: 과제 블록이 전체 글 안에 있다');
        assert.ok(W.ev('__rptM.etcText').includes(want['(예시) 사내 업무']) && W.ev('__rptM.etcText').includes('미등록 일'), '기타에 사내 업무나 미등록 과제 글이 없다');
        assert.ok([...W.doc.querySelectorAll('#rptmCards [data-etc]')].some((x) => x.parentElement.textContent.includes('(예시) 없는 과제 (미등록)')), '미등록 과제가 기타 고르기에 없다');
        assert.ok(card(W, P1).querySelector('.rptm-tag').textContent.includes('주간보고'), '실적 표시가 주간보고 출처가 아니다');
        W.doc.querySelector('#rptmSrc [data-msrc="cal"]').click(); await tick();
        $id(W, 'rptmLoad').click(); await confirmAnswer(W, true); drainImages(W);
      }
      W.ev('weeklyFlat = false;');
    });

    test('MW12 (§5.2): 주간보고를 못 읽으면(로그인 없음, 400일 넘음, 시간 초과) 이유를 보이고 캘린더로 되돌린다(실적은 그대로)', async () => {
      await fresh();
      const a0 = W.ev(`__rptM.cards[${JSON.stringify(P1)}].actual`);
      W.doc.querySelector('#rptmSrc [data-msrc="week"]').click(); await tick();
      $id(W, 'rptmLoad').click(); await confirmAnswer(W, true);
      reply(W, 'netcusWeeklyRangeRead', { ok: false, error: 'no-creds', weeks: [] }); await tick(); drainImages(W);
      assert.ok($id(W, 'rptmSrcMsg').textContent.includes('netcus 로그인 정보가 없습니다'), '로그인 없음 이유를 보이지 않는다');
      assert.strictEqual(W.ev('__rptM.src'), 'cal', '실패 뒤 출처가 캘린더로 돌아오지 않았다');
      assert.ok(W.doc.querySelector('#rptmSrc [data-msrc="cal"]').classList.contains('active'), '캘린더 칸이 켜지지 않았다');
      assert.strictEqual(W.ev(`__rptM.cards[${JSON.stringify(P1)}].actual`), a0, '실패했는데 실적이 바뀌었다');
      //  400일 넘는 기간: 호스트에 묻지 않는다
      W.doc.querySelector('#rptmSrc [data-msrc="week"]').click(); await tick();
      const n0 = W.posted.filter((x) => x && x.cmd === 'netcusWeeklyRangeRead').length;
      await loadPeriod(W, '2025-01-01', '2026-03-01'); await tick(); drainImages(W);
      assert.strictEqual(W.posted.filter((x) => x && x.cmd === 'netcusWeeklyRangeRead').length, n0, '400일 넘는 기간을 호스트에 물었다');
      assert.ok($id(W, 'rptmSrcMsg').textContent.includes('400일'), '400일 한도 안내가 없다');
      assert.strictEqual(W.ev('__rptM.src'), 'cal');
      //  시간 초과
      await loadPeriod(W, FROM, TO); drainImages(W);
      W.doc.querySelector('#rptmSrc [data-msrc="week"]').click(); await tick();
      $id(W, 'rptmLoad').click(); await confirmAnswer(W, true);
      reply(W, 'netcusWeeklyRangeRead', { ok: false, error: '호스트 응답 시간 초과', timeout: true }); await tick(); drainImages(W);
      assert.ok($id(W, 'rptmSrcMsg').textContent.includes('시간이 지났습니다'), '시간 초과 안내가 없다');
      await fresh();
    });

    test('MW13 (§10.1, §10.3): 월간 흐름 전체에서 회사로 보내는 명령과 함수는 0회(가로채기), 나간 명령은 RPTM_HOST_CMDS 와 기존 부팅 명령뿐', async () => {
      W.ev("window.__sent = []; Platform.report.submitDaily = function(){ __sent.push('daily'); }; Platform.report.submitWeekly = function(){ __sent.push('weekly'); };");
      const ln0 = W.posted.length;
      await fresh();
      W.doc.querySelector('#rptmSrc [data-msrc="week"]').click(); await tick();
      $id(W, 'rptmLoad').click(); await confirmAnswer(W, true);
      reply(W, 'netcusWeeklyRangeRead', { ok: true, error: '', weeks: WEEKS }); await tick(); drainImages(W);
      card(W, P1).querySelector('[data-act="reload"]').click(); await confirmAnswer(W, true);
      $id(W, 'rptmPvBtn').click(); await tick();
      $id(W, 'rptmSave').click(); await tick();
      reply(W, 'exportMonthlyDocx', { ok: false, cancelled: true }); await tick();
      W.ev("setReportMode('custom'); setReportMode('monthly');"); await tick(); drainImages(W);
      const allowed = new Set(W.evJSON('RPTM_HOST_CMDS'));
      const sent = W.posted.slice(ln0).map((x) => x && x.cmd).filter(Boolean);
      assert.deepStrictEqual(W.evJSON('__sent'), [], 'Platform.report 가 불렸다');
      for (const bad of ['netcusSubmit', 'netcusWeekSubmit']) assert.ok(!sent.includes(bad), '회사로 보내는 명령이 나갔다: ' + bad);
      const extra = [...new Set(sent.filter((c) => !allowed.has(c)))];
      assert.ok(extra.every((c) => !/netcus|report|submit/i.test(c)), '월간 흐름에서 목록 밖 보고 명령이 나갔다: ' + extra.join(', '));
      W.ev("state.reportSource = 'cal';");
      await fresh();
    });

    test('MW14 (§5.1): 기존 탭은 그대로: 월간을 다녀와도 기간 취합 글, 기간, 보내기 버튼, 출처가 같다', async () => {
      W.ev("setReportMode('custom'); $('#rptFrom').value = '2026-09-01'; $('#rptTo').value = '2026-09-30'; buildReport();");
      const copy0 = W.ev('buildReportText()'), send0 = W.ev("$('#btnRptSend').textContent + '|' + $('#btnRptSend').disabled");
      W.ev("setReportMode('monthly');"); await tick(); drainImages(W);
      assert.ok(W.doc.getElementById('reportModal').classList.contains('rptm-on'));
      W.ev("setReportMode('custom');");
      assert.ok(!W.doc.getElementById('reportModal').classList.contains('rptm-on'), '다른 탭에서 월간 표시가 남았다');
      assert.deepStrictEqual([W.ev("$('#rptFrom').value"), W.ev("$('#rptTo').value")], ['2026-09-01', '2026-09-30'], '월간을 다녀오니 기간 취합 기간이 바뀌었다');
      assert.strictEqual(W.ev('buildReportText()'), copy0, '월간을 다녀오니 기간 취합 글이 바뀌었다');
      assert.strictEqual(W.ev("$('#btnRptSend').textContent + '|' + $('#btnRptSend').disabled"), send0);
      W.ev("setReportMode('weekly');");
      assert.ok(W.ev("$('#rptTo').disabled") && W.ev("$('#btnRptSend').dataset.mode") === 'weekly', '주간 탭이 예전처럼 동작하지 않는다');
      W.ev("setReportMode('daily');");
      assert.ok(W.ev("$('#btnRptSend').dataset.mode") === 'daily' && W.ev("$('#rptFrom').value") === W.ev('todayYmd()'), '일간 탭이 예전처럼 동작하지 않는다');
      //  화살표 키 탭 이동도 네 번째 탭까지
      W.ev("setReportMode('custom'); document.querySelector('#reportModal [data-rmode=\"custom\"]').focus();");
      W.doc.querySelector('#reportModal [data-rmode="custom"]').dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await tick(); drainImages(W);
      assert.strictEqual(W.ev('reportMode'), 'monthly', '화살표 키로 월간 탭에 가지 않는다');
      W.ev("setReportMode('daily'); setReportMode('monthly');"); await tick(); drainImages(W);
    });

    test('MW15 (§5.3): 문서 미리 보기는 칸 글과 같은 값(과제명, 기간, 실적 줄, 기타)', async () => {
      await fresh();
      if (!W.ev('__rptMPv')) $id(W, 'rptmPvBtn').click();
      await tick();
      const sheet = $id(W, 'rptmSheet').textContent;
      assert.ok(sheet.includes('월간 실적: 09월 01일 ~ 09월 30일') && sheet.includes('(예시) 관제 고도화') && sheet.includes('2025/08 ~ 2026/12') && sheet.includes('화면 응답 속도 개선') && sheet.includes('기타'), '미리 보기가 칸 글을 보이지 않는다');
      $id(W, 'rptmPvBtn').click();
    });

    test('MW16: 정리', async () => { clearStore(W); await W.close(); });
  }

  // ── (B) 브라우저 모드 ───────────────────────────────────────────────
  let B = null, bErr = null;
  try { B = bootBrowser(app); } catch (e) { bErr = e; }
  if (bErr) {
    test('MB0: 브라우저 모드 부팅', () => { throw bErr; });
  } else {
    test('MB1 (§5, 9번): 브라우저만 있을 때: 위젯 안내, 저장과 주간보고 막힘, 그림 안내, 실적 채우기와 미리 보기는 동작', async () => {
      clearStore(B);
      B.ev('state = ' + JSON.stringify(stateFor()) + ';');
      B.ev("openReport(); setReportMode('monthly');"); await tick();
      await loadPeriod(B, FROM, TO);
      assert.ok(!$id(B, 'rptmHostNote').classList.contains('hidden'), '위젯 안내가 보이지 않는다');
      assert.ok($id(B, 'rptmSave').disabled, '브라우저에서 저장이 열려 있다');
      assert.ok(B.doc.querySelector('#rptmSrc [data-msrc="week"]').disabled, '브라우저에서 주간보고 출처가 열려 있다');
      assert.ok(card(B, P1) && card(B, P1).querySelector('[data-imgs]').textContent.includes('데스크톱 위젯에서만'), '그림 칸 안내가 없다');
      assert.ok(B.ev(`__rptM.cards[${JSON.stringify(P1)}].actual`).includes('화면 응답 속도 개선'), '브라우저에서 실적이 채워지지 않았다');
      $id(B, 'rptmPvBtn').click(); await tick();
      assert.ok($id(B, 'rptmSheet').textContent.includes('화면 응답 속도 개선'), '브라우저에서 미리 보기가 안 된다');
      B.ev("rptMSave()"); await tick();
      assert.ok(B.evJSON('__toasts').some((t) => t.includes('위젯에서만')), '브라우저 저장 시도에 안내가 없다');
      clearStore(B);
      await B.close();
    });
  }
}
