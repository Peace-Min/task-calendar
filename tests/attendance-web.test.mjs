// 근태 탭과 근태 보고 창(docs/ATTENDANCE-PLAN.md, 2026-10-29), §5 웹 시험과 §12.5 과제 블록(결정 12) 시험.
//
// 이 파일이 지키는 것:
//   (S) 정적: 근태 창 허용 목록(ATTENDWIN_CMD)이 일곱(attendWinReady, attendNav, reportDailyList, netcusSubmit, attendSourceReq, netcusViewMonth, attendCatNew)이고
//       hpost 가 그 밖을 버린다(attendSourcePush 는 메인 창만, netcusWeekMerge 는 근태 창에서 뺐다).
//       'tw:' 번호 머리, SUBWIN 에 근태 창이 들어간다, 탭 줄에 근태 탭이 있다, UI 문구에 금지 기호가 없다.
//   (U) 순수: 근태 표시 문구(야근(+2시간)), 조립(정수와 소수, 빈 과제 : 0, 내용 끝 공백, 자유 메모가 맨 앞), hours(0 제외), 막는 까닭,
//       되살리기(정확한 머리만, 시간 없는 [과제명], [일정] 은 내용, 첫 머리 앞은 자유 메모, 모르는 이름은 과제 미정).
//   (B) jsdom 브라우저(HOST=false): 탭 세 값과 기억, payload 로 처음 블록 만들기(옵션 넷, 공수표 시간, 서식), 과제명 잠금, 근태에 미기록 없음(기본 정근),
//       과제 추가(목록, 중복 금지, 새 과제 창), 블록 순서(캘린더 순서 자동 정렬, ▲ ▼ 없음), 시간 칸(↑ ↓, 0.5 맞춤, 휠 없음), 지우기, 고침 판단, 미리보기 탭(기억, 처음 탭, 접힘 이름), 전체 초기화와 되돌리기, 보내기 막기 넷과 빈 과제 : 0,
//       가져오기(다른 날짜 캘린더는 그 자리에서, 이전 보고는 위젯 전용 안내), 보고한 날도 바로 쓰기 화면(블록으로 되살림, 보낸 시각),
//       임시 저장 v2(쓰기, 되살리기, 버리기, 14일 정리)와 v1 바꿔 열기, 화면 전환과 떠날 때 확인(탭 이동, ← 근태 달력, Esc),
//       브라우저 보내기는 잠그지 않고 임시 저장도 지우지 않는다.
//   (W) jsdom 위젯 메인 창: 근태 달력 그리기(목록 회신 흉내, 근태 표시, 글, 작성 중, 요약, 미보고 표시 없음), 날짜를 누르면 attendOpen
//       payload(§3.3, saved.sentAt), __attendNavFromWin, __attendSourceFor 가 attendSourcePush 로 같은 source 를 보낸다,
//       __reportDailySaved 가 개인 캘린더 근태를 고친다, 보고서 창은 자기가 보내지 않은 회신에 반응하지 않는다.
//   (A) jsdom 근태 창(?win=attend): 내 달력을 부팅하지 않는다(준비 알림 하나), 봉인, 보고한 날도 바로 쓰기 화면, 새로고침은 과제 목록만 바꾼다,
//       새 과제 만들기 요청(attendCatNew), 가져오기 캘린더(attendSourceReq 와 __attendSource 중계), 가져오기 이전 보고(reportDailyList 하루를
//       자유 메모, 블록, 과제 미정으로 되살리기, 없는 날, 오류와 다시 읽기), 보내기 payload(조립, &nbsp;, hours, 고른 근태 코드, 단추 이름),
//       처리 중 잠금과 연속 클릭(한 번만), 성공이면 임시 저장을 지우고 창은 닫지 않고 보낸 글이 새 처음 상태, 실패면 공통 안내와 함께 남긴다, 닫기 지키기(__winCloseRequest, Esc 는 닫기와 같다).
//   (M) 변이(과제 추가 뒤 정렬 빼기 포함): 봉인 빼기, 성공 시 임시 저장 지우기 빼기, 닫기 전 확인 빼기, 성공 뒤 처음 상태 바꾸기 빼기, Esc 의 닫기 빼기, 다른 날짜 회신 거르기 빼기,
//       내용 있는 0시간 막기 빼기, 새로고침의 과제 목록 바꾸기 빼기를 같은 검사가 잡는다.
// ★ 회사 사이트에는 아무것도 보내지 않는다. Platform.report.submitDaily 와 chrome.webview.postMessage 를 가로채 보기만 한다.
// 생략 규약: jsdom 이 없으면 (B)(W)(A)(M)은 등록되지 않고 skip(판정 없음)으로 계수된다.
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
const NL = String.fromCharCode(10);
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}

// ══ (S) 정적 ══════════════════════════════════════════════════════════
const ATTEND_CMDS = ['attendCatNew', 'attendNav', 'attendSourceReq', 'attendWinReady', 'netcusSubmit', 'netcusViewMonth', 'reportDailyList'];
function webAttendSet(src) {
  const m = /const ATTENDWIN_CMD = new Set\(\[([\s\S]*?)\]\);/.exec(src);
  assert.ok(m, 'ATTENDWIN_CMD 를 찾지 못했다');
  return [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
}
test('(S) 근태 창 허용 목록은 일곱이고(netcusWeekMerge 없음, attendCatNew 있음), hpost 가 그 밖을 버린다, 번호 머리 tw:, SUBWIN 에 든다', () => {
  assert.deepStrictEqual(webAttendSet(app), ATTEND_CMDS);
  assert.ok(app.includes("  if(ATTENDWIN && !ATTENDWIN_CMD.has(String((o && o.cmd) || ''))) return;\n"), 'hpost 에 근태 창 봉인이 없다');
  assert.ok(/const __reqPfx = [^\n]*ATTENDWIN \? 'tw:'/.test(app), "근태 창 번호 머리가 'tw:' 가 아니다");
  assert.ok(/const SUBWIN = PEERWIN \|\| ADMINWIN \|\| ATTENDWIN;/.test(app), 'SUBWIN 에 근태 창이 없다');
  assert.ok(/get\('win'\) === 'attend'/.test(app), '?win=attend 판별이 없다');
  assert.ok(/<button type="button" class="pc-tab" role="tab" id="pcTabAttend"[^>]*data-pctab="attend">근태<\/button>/.test(app), '탭 줄에 근태 탭이 없다');
});
test('(S) 근태 화면 문구에 엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점이 없다', () => {
  const a = app.indexOf('<section class="at-view" id="atView"'), b = app.indexOf('</section>', a);
  const j0 = app.indexOf('/* ===== 근태 탭과 근태 보고 화면(docs/ATTENDANCE-PLAN.md, 2026-10-29'), j1 = app.indexOf('function atInit(){', j0);
  assert.ok(a > 0 && b > a && j0 > 0 && j1 > j0);
  for (const part of [app.slice(a, b), app.slice(j0, j1)]) {
    assert.ok(!/[—–「」]/.test(part), '금지 기호가 있다');
    assert.ok(!/(^|\s)·|·(\s|$)/m.test(part), '띄어 쓴 가운데 점이 있다');
  }
});

// ══ jsdom ═════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
if (!JSDOM) {
  skip('attendance-web: jsdom 미설치, 근태 탭과 보고 화면 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const shims = (win) => {
    if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
    win.scrollTo = () => {};
    win.HTMLElement.prototype.scrollIntoView = function () {};
    win.open = () => null;   // 브라우저 보내기의 netcus 창 열기를 막는다(회사 사이트에 가지 않는다)
    win.__closeCalls = 0; win.__realClose = win.close;
    win.close = function () { win.__closeCalls++; };   // 근태 창의 window.close() = 호스트가 창을 닫는 길
  };
  function boot(src, url, host) {
    const posted = [], errors = [];
    const vc = new jsdomMod.VirtualConsole();
    vc.on('jsdomError', (e) => { const s = String(e && (e.stack || e.message) || e); if (!/Not implemented/.test(s)) errors.push(s); });
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc,
      beforeParse(win) {
        if (host) win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); }, addEventListener() {}, removeEventListener() {} } };
        shims(win);
      },
    });
    const w = dom.window;
    return { w, doc: w.document, posted, errors, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      $: (s) => w.document.querySelector(s), close: () => { try { w.__realClose.call(w); } catch (_) {} } };
  }
  //  hostRequest 를 바꿔 회신을 정한다(호출은 __calls 에). __rep[cmd] 가 함수면 인자로 회신을 만든다.
  const stubHost = (X, rep) => X.ev(`window.__calls = []; window.__rep = ${rep || '{}'};
    hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
      var r = __rep[cmd]; if(typeof r === 'function') r = r(p);
      return Promise.resolve(r === undefined ? { ok:false, error:'시험: 회신 없음' } : JSON.parse(JSON.stringify(r))); };`);
  const toastSpy = (X) => X.ev('window.__toasts = []; (function(){ var o = toast; toast = function(m, k){ window.__toasts.push([String(m), k]); return o.apply(this, arguments); }; })();');
  const input = (X, sel, v) => { const e = X.$(sel); e.value = v; e.dispatchEvent(new X.w.Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  const shown = (X, sel) => { const e = X.$(sel); return !!e && !e.classList.contains('hidden'); };
  const esc = (X) => X.doc.dispatchEvent(new X.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  const CA = '2026-07-01T00:00:00.000Z';
  const E = (o) => Object.assign({ allDay: true, startTime: '', endTime: '', location: '', memo: '', hours: null, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }, o);
  //  알파: 일정(메모) + 할 일(노트), 베타: 일정, 감마: 시간만, 델타: 아무것도 없음
  const stateFor = (T) => ({
    categories: [
      { id: 'c-a', name: '알파', color: '#3e5be0', desc: '', createdAt: CA },
      { id: 'c-b', name: '베타', color: '#2e9e6b', desc: '', createdAt: CA },
      { id: 'c-c', name: '감마', color: '#d97706', desc: '', createdAt: CA },
      { id: 'c-d', name: '델타', color: '#5b6b7d', desc: '', createdAt: CA },
    ],
    entries: [E({ id: 'e-a1', date: T, title: '로그인 화면 리뷰', categoryId: 'c-a', memo: 'UI 확인' }),
              E({ id: 'e-b1', date: T, title: '고객 회신', categoryId: 'c-b' })],
    todos: [{ id: 't-a', text: '보고서 정리', done: false, categoryId: 'c-a', due: T, endDate: '', prio: 'normal', completedAt: '', note: '세부 메모', dayNotes: {}, createdAt: CA, updatedAt: CA }],
    rooms: [], attendance: { [T]: { status: '6', overtime: 0 } },
    taskHours: { [T]: { 'c-a': 2, 'c-c': 1 } },
    reportMarker: '-', reportMarkerCustom: '', reportIndent: 2,
  });
  function bootBrowser(src = app) {
    const X = boot(src, 'https://tcapp.local/', false);
    X.T = X.ev('todayYmd()');
    X.ev('state = ' + JSON.stringify(stateFor(X.T)) + ';');
    X.ev("(function(){ for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k && (k.indexOf('tc_attDraft:')===0 || k.indexOf('tc_pcal:')===0)) localStorage.removeItem(k); } })()");
    return X;
  }
  const KEYB = (X) => 'tc_attDraft:me:' + X.T;
  const openB = (X, date) => { X.ev("pcSetTab('attend')"); X.ev(`atOpen(${JSON.stringify(date || X.T)})`); };

  //  과제 블록(결정 12) 조작: i 번째 블록의 내용, 시간 칸, 자유 메모에 실제 입력 처리기로 쓴다.
  const blk = (X) => X.evJSON('ATE.blocks.map(function(b){ return { name: b.name, hours: b.hours, text: b.text }; })');
  const names = (X) => blk(X).map((b) => b.name);
  const typeBlock = (X, i, v) => input(X, `#atBlocks textarea[data-bt="${i}"]`, v);
  const setHours = (X, i, v) => input(X, `#atBlocks input[data-bh="${i}"]`, String(v));
  const typeMemo = (X, v) => input(X, '#atBlocks textarea[data-memo]', v);
  const isBad = (X, i) => X.$(`#atBlocks .at-blk[data-bi="${i}"]`).classList.contains('bad');

  // ── (U) 순수 ────────────────────────────────────────────────────────
  test('(U) 근태 표시 문구, 조립(정수와 소수, 빈 과제 : 0, 내용 끝 공백, 자유 메모가 맨 앞), hours(0 제외), 막는 까닭', () => {
    const X = bootBrowser();
    try {
      assert.strictEqual(X.ev("atStatusLabel('2', 2)"), '야근(+2시간)');
      assert.strictEqual(X.ev("atStatusLabel('1', 0)"), '정근');
      assert.strictEqual(X.ev("atStatusLabel('12', '3')"), '반차(+3시간)');
      assert.strictEqual(X.ev("atStatusLabel(null, 0)"), '');
      const B = [{ name: '알파', hours: 6, text: '\n  - 한 일\n\t- 탭 줄  \n\n' }, { name: '베타', hours: 2.5, text: '- 둘째' }, { name: '감마', hours: 0, text: '   ' }];
      const cp = (b, m) => X.ev(`atCompose(${JSON.stringify(b)}, ${JSON.stringify(m)})`);
      assert.strictEqual(cp(B, ''), '[알파] : 6\n  - 한 일\n\t- 탭 줄\n\n[베타] : 2.5\n- 둘째\n\n[감마] : 0');
      assert.strictEqual(cp(B.slice(1, 2), '* 대전 ADD 외근\n\n'), '* 대전 ADD 외근\n\n[베타] : 2.5\n- 둘째', '자유 메모가 맨 앞에 빈 줄 하나로 붙지 않았다');
      assert.strictEqual(cp([], '  '), '', '빈 메모만 있으면 빈 글이어야 한다');
      assert.strictEqual(cp([{ name: '', hours: 3, text: '미정' }], ''), '', '과제 미정 블록이 조립에 들어갔다');
      assert.deepStrictEqual(X.evJSON(`atHoursPayload(${JSON.stringify(B)})`), [{ name: '알파', hours: 6 }, { name: '베타', hours: 2.5 }], 'hours 에 0 이 들어갔거나 빠졌다');
      const pr = (b) => X.ev(`atBlockProblem(${JSON.stringify(b)})`);
      assert.ok(pr({ name: '', hours: 1, text: '' }).includes('과제를 고르세요'));
      assert.ok(pr({ name: '알파', hours: 25, text: '' }).includes('0 이상 24 이하'));
      assert.ok(pr({ name: '알파', hours: -1, text: '' }).includes('0 이상 24 이하'));
      assert.ok(pr({ name: '알파', hours: 0, text: '- 한 일' }).includes('0시간'));
      assert.strictEqual(pr({ name: '알파', hours: 0, text: '  ' }), '', '빈 과제(0시간)를 막았다');
      assert.strictEqual(pr({ name: '알파', hours: 24, text: 'x' }), '');
    } finally { X.close(); }
  });

  test('(U) 되살리기: 정확한 머리만(캘린더 과제명), 시간 없는 [과제명] 은 0시간, [일정] 은 내용, 첫 머리 앞은 자유 메모, 모르는 이름과 두 번째 머리는 미정', () => {
    const X = bootBrowser();
    try {
      const text = '* 대전 ADD 외근\n\n[알파] : 5\n[일정]\n    - 연동\n◈ 알파 3\n[알파] 3\n[모름] : 2\n- 기타 일\n[베타]\n\n[감마] : 1.5\n[알파] : 1';
      const r = X.evJSON(`atParseReport(${JSON.stringify(text)}, ['알파', '베타', '감마', '델타'])`);
      assert.strictEqual(r.memo, '* 대전 ADD 외근', '첫 머리 앞의 글이 자유 메모가 아니다');
      assert.deepStrictEqual(r.blocks, [
        { name: '알파', hours: 5, text: '[일정]\n    - 연동\n◈ 알파 3\n[알파] 3', raw: '' },
        { name: '', hours: 2, text: '[모름] : 2\n- 기타 일', raw: '[모름] : 2' },
        { name: '베타', hours: 0, text: '', raw: '' },
        { name: '감마', hours: 1.5, text: '', raw: '' },
        { name: '', hours: 1, text: '[알파] : 1', raw: '[알파] : 1' },
      ]);
      //  &nbsp; 는 공백으로, 앞에 공백이 있는 머리는 머리가 아니다
      const r2 = X.evJSON(`atParseReport('[알파] : 2\\n&nbsp;&nbsp;- 들여쓴 줄\\n  [베타] : 1', ['알파', '베타'])`);
      assert.deepStrictEqual(r2, { memo: '', blocks: [{ name: '알파', hours: 2, text: '  - 들여쓴 줄\n  [베타] : 1', raw: '' }] });
      //  조립한 글은 그대로 되살아난다
      const B = [{ name: '알파', hours: 6, text: '  - 한 일' }, { name: '델타', hours: 0, text: '' }];
      const back = X.evJSON(`atParseReport(atCompose(${JSON.stringify(B)}, '메모'), ['알파', '델타'])`);
      assert.deepStrictEqual([back.memo, back.blocks.map((b) => [b.name, b.hours, b.text])], ['메모', [['알파', 6, '  - 한 일'], ['델타', 0, '']]]);
    } finally { X.close(); }
  });

  // ── (B) 브라우저 ─────────────────────────────────────────────────────
  test('(B) 탭 세 값: 근태 탭이 body.at-on 과 aria 를 세우고 기억된다(tc_pcal:local), 키보드 End/Home', () => {
    const X = bootBrowser();
    try {
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#pcTabs [data-pctab]'), function(b){ return b.dataset.pctab; })"), ['personal', 'project', 'attend']);
      X.$('#pcTabAttend').click();
      assert.ok(X.doc.body.classList.contains('at-on') && !X.doc.body.classList.contains('pc-on'));
      assert.strictEqual(X.$('#pcTabAttend').getAttribute('aria-selected'), 'true');
      assert.strictEqual(X.$('#pcTabPersonal').getAttribute('aria-selected'), 'false');
      assert.strictEqual(JSON.parse(X.ev("localStorage.getItem('tc_pcal:local')")).tab, 'attend', '근태 탭이 기억되지 않았다');
      assert.strictEqual(X.ev("pcPrefsNorm('{\"tab\":\"attend\"}').tab"), 'attend');
      assert.strictEqual(X.ev("pcPrefsNorm('{\"tab\":\"zz\"}').tab"), 'personal');
      assert.ok(X.$('#atGrid'), '근태 달력이 그려지지 않았다');
      assert.ok(X.$('#atMonth .at-note').textContent.includes('위젯'), '브라우저 안내가 없다');
      X.$('#pcTabs').dispatchEvent(new X.w.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      assert.strictEqual(X.ev('PCAL.tab'), 'personal');
      assert.ok(!X.doc.body.classList.contains('at-on'));
      X.$('#pcTabs').dispatchEvent(new X.w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      assert.strictEqual(X.ev('PCAL.tab'), 'attend');
      X.$('#pcTabs').dispatchEvent(new X.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      assert.strictEqual(X.ev('PCAL.tab'), 'project');
    } finally { X.close(); }
  });

  test('(B) 날짜를 누르면 보고 화면, 처음은 캘린더 기본 불러오기 블록(공수표 시간, 본문은 기존 보고서 함수, 기록 없는 과제 제외), 과제명은 잠김', () => {
    const X = bootBrowser();
    try {
      X.ev("pcSetTab('attend')");
      X.$(`#atGrid .at-day[data-date="${X.T}"]`).click();
      assert.ok(shown(X, '#atEd') && !shown(X, '#atMonth'), '보고 화면으로 바뀌지 않았다');
      assert.ok(!X.$('#atText'), '한 칸 글(#atText)이 남아 있다');
      const ref = X.evJSON(`(function(){ var rows = collectReportData(${JSON.stringify(X.T)}, ${JSON.stringify(X.T)}, {event:true,todo:true,desc:true}).rows;
        return rows.filter(function(r){ return r.titles.length || getTaskHours(${JSON.stringify(X.T)}, r.key) > 0; }).map(function(r){ return reportRowBodyText(r, ' ', reportMarkerSpec(), 2); }); })()`);
      const b = blk(X);
      assert.deepStrictEqual(b.map((x) => [x.name, x.hours]), [['알파', 2], ['베타', 0], ['감마', 1]], '블록이 캘린더 기록 있는 과제와 공수표 시간이 아니다');
      assert.deepStrictEqual(b.map((x) => x.text), ref, '블록 내용이 기존 보고서 본문 함수로 만든 것과 다르다');
      assert.ok(b[0].text.includes('로그인 화면 리뷰') && b[0].text.includes('UI 확인') && b[2].text === '');
      //  화면: 과제명은 표시(잠금, 입력 칸 아님), 시간은 숫자 칸(0~24, 0.5), 내용은 글 칸, 자유 메모가 맨 위
      const h0 = X.$('#atBlocks .at-blk[data-bi="0"] .at-bh');
      assert.strictEqual(h0.querySelector('.at-bn').textContent, '알파');
      assert.ok(!h0.querySelector('.at-lock'), '자물쇠 표시가 남아 있다(2026-10-29 사용자: 번잡해서 뺀다)');
      assert.ok(!h0.querySelector('select, [contenteditable]') && h0.querySelectorAll('input').length === 1 && h0.querySelector('input[data-bh]'), '과제명을 고칠 수 있는 칸이 있다');
      const hn = X.$('#atBlocks input[data-bh="0"]');
      assert.deepStrictEqual([hn.type, hn.min, hn.max, hn.step, hn.value], ['number', '0', '24', '0.5', '2'], '시간 칸이 기본 숫자 칸(0~24, 0.5)이 아니다');
      assert.strictEqual(X.$('#atBlocks textarea[data-bt="0"]').value, b[0].text);
      assert.ok(X.$('#atBlocks').firstElementChild.querySelector('textarea[data-memo]'), '자유 메모가 맨 위에 없다');
      assert.strictEqual(X.$('#atBlocks textarea[data-memo]').value, '', '처음 자유 메모가 비어 있지 않다');
      assert.strictEqual(X.$('#atStatus').value, '6', '근태 기본값이 그날 개인 캘린더 근태(휴가)가 아니다');
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#atStatus option'), function(o){ return o.value; })"), X.evJSON('ATTEND_STATUS.map(function(s){ return s.v; })'), '근태 목록에 미기록(빈 값)이 있거나 목록이 다르다');
      assert.strictEqual(X.$('#atHours').textContent, '과제 3개, 합계 3시간');
      assert.strictEqual(X.$('#atSend').textContent, '보고', '보내기 단추 이름이 보고가 아니다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 옵션 넷과 과제 체크는 패널만 바꾸고, 불러오기를 눌러야 왼쪽 블록이 바뀐다(기록 없는 과제는 0시간 블록), 자유 메모는 그대로', () => {
    const X = bootBrowser();
    try {
      openB(X);
      const b0 = JSON.stringify(blk(X));
      typeMemo(X, '* 외근');
      const click = (id) => { const c = X.$('#' + id); c.checked = !c.checked; c.dispatchEvent(new X.w.Event('change', { bubbles: true })); };
      const loadNow = () => { X.$('#atLoad').click(); return blk(X); };
      click('atODesc');
      assert.strictEqual(JSON.stringify(blk(X)), b0, '옵션이 왼쪽을 바로 바꿨다');
      let b = loadNow();
      assert.ok(!b[0].text.includes('UI 확인') && !b[0].text.includes('세부 메모') && b[0].text.includes('로그인 화면 리뷰'), '설명 포함을 끄고 불러왔는데 설명이 남았다');
      assert.strictEqual(X.ev('ATE.memo'), '* 외근', '캘린더 불러오기가 자유 메모를 바꿨다');
      click('atODesc'); click('atOEvent');
      b = loadNow();
      assert.ok(!b[0].text.includes('로그인 화면 리뷰') && b[0].text.includes('보고서 정리') && !b.some((x) => x.name === '베타'), '일정을 끄면 일정과 일정만 있던 과제가 빠져야 한다');
      click('atOEvent'); click('atOTodo');
      b = loadNow();
      assert.ok(b[0].text.includes('로그인 화면 리뷰') && !b[0].text.includes('보고서 정리') && b.some((x) => x.name === '베타'));
      click('atOTodo'); click('atOSkip');
      b = loadNow();
      assert.deepStrictEqual(b.map((x) => [x.name, x.hours]), [['알파', 2], ['베타', 0], ['감마', 1], ['델타', 0]], '기록 없는 과제 제외를 끄면 내 과제가 모두 0시간 블록으로 나와야 한다');
      assert.strictEqual(X.$('#atPick').textContent, '과제 4 / 4개 선택');
      const cb = X.$('#atCards input[data-atid="c:c-b"]'); cb.checked = false; cb.dispatchEvent(new X.w.Event('change', { bubbles: true }));
      assert.deepStrictEqual(names(X), ['알파', '베타', '감마', '델타'], '체크만으로 왼쪽이 바뀌었다');
      assert.deepStrictEqual(loadNow().map((x) => x.name), ['알파', '감마', '델타']);
      X.$('#atNone').click();
      assert.strictEqual(X.$('#atLoad').disabled, true, '고른 과제가 없는데 불러오기가 켜져 있다');
      X.$('#atAll').click();
      assert.strictEqual(X.$('#atPick').textContent, '과제 4 / 4개 선택');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 가져오기 서식: 처음은 보고서 일간 서식, 머리기호와 들여쓰기를 고르면 블록 내용에 쓰고 이 PC에 기억한다(보고서 설정은 그대로)', () => {
    const X = bootBrowser();
    try {
      openB(X);
      assert.strictEqual(X.$('#atOMk').value, X.ev('atFmtKeyOf(atDailyFmt().mkSpec)'), '처음 머리기호가 보고서 일간 서식이 아니다');
      assert.strictEqual(X.$('#atOInd').value, String(X.ev('atDailyFmt().indent')), '처음 들여쓰기가 보고서 일간 서식이 아니다');
      assert.strictEqual(X.$('#atOMk').options.length, X.$('#rptMarker').options.length, '머리기호 목록이 보고서 창과 다르다');
      const before = X.ev('JSON.stringify(atDailyFmt())');
      input(X, '#atOMk', '1.'); input(X, '#atOInd', '0');
      X.$('#atLoad').click();
      const t = blk(X)[0].text;
      assert.ok(/^1\. /m.test(t) && /^2\. /m.test(t), '고른 머리기호(1. 2.)와 들여쓰기 0단으로 불러오지 않았다: ' + t);
      const saved = JSON.parse(X.ev('localStorage.getItem(AT_FMT_PREFIX + atWho())'));
      assert.deepStrictEqual([saved.mk, saved.indent], ['1.', 0], '고른 서식을 기억하지 않았다');
      assert.strictEqual(X.ev('JSON.stringify(atDailyFmt())'), before, '보고서 창 서식 설정이 바뀌었다');
      X.ev(`atShowEditor(atBuildPayload(addDays(todayYmd(), 3), null, false))`);
      assert.deepStrictEqual([X.$('#atOMk').value, X.$('#atOInd').value], ['1.', '0'], '다시 열었는데 고른 서식이 아니다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 날짜 검사: 꼴과 실제로 있는 날짜(달마다 다른 끝날, 윤년 2월 29일)', () => {
    const X = bootBrowser();
    try {
      const ok = (d) => X.ev(`atIsYmd(${JSON.stringify(d)})`);
      for (const d of ['2026-01-31', '2026-04-30', '2026-08-31', '2026-10-31', '2026-11-30', '2026-12-31', '2028-02-29', '2024-02-29', '2027-02-28']) assert.strictEqual(ok(d), true, d);
      for (const d of ['2026-04-31', '2026-06-31', '2026-09-31', '2026-11-31', '2027-02-29', '2100-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-1', '']) assert.strictEqual(ok(d), false, d);
    } finally { X.close(); }
  });

  test('(B) 과제 추가: 내 과제 목록에서 검색해 고른다(이미 있는 과제는 흐림, 중복 금지), 새 블록은 0시간, Esc 는 메뉴만 닫는다', () => {
    const X = bootBrowser();
    try {
      openB(X);
      X.$('#atAdd').click();
      assert.ok(shown(X, '#atAddMenu'), '과제 추가 메뉴가 열리지 않았다');
      const items = () => X.evJSON("[].map.call(document.querySelectorAll('#atAddList [data-addname]'), function(b){ return b.dataset.addname + (b.disabled ? ':x' : ''); })");
      assert.deepStrictEqual(items(), ['알파:x', '베타:x', '감마:x', '델타'], '목록이 내 과제 순서가 아니거나 이미 있는 과제가 흐리지 않다');
      X.$('#atAddList [data-addname="알파"]').click();
      assert.deepStrictEqual(names(X), ['알파', '베타', '감마'], '이미 있는 과제를 또 더했다');
      X.ev("atAddPick('알파'); atAddPick('없는 과제')");
      assert.deepStrictEqual(names(X), ['알파', '베타', '감마'], '중복이나 내 과제에 없는 이름을 더했다');
      input(X, '#atAddQ', '델');
      assert.deepStrictEqual(items(), ['델타'], '검색이 거르지 않았다');
      X.$('#atAddQ').dispatchEvent(new X.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      assert.deepStrictEqual(blk(X)[3], { name: '델타', hours: 0, text: '' }, '새 블록이 0시간 빈 블록이 아니다');
      assert.ok(!shown(X, '#atAddMenu'), '고른 뒤 메뉴가 닫히지 않았다');
      assert.strictEqual(X.doc.activeElement, X.$('#atBlocks textarea[data-bt="3"]'), '새 블록 내용 칸으로 가지 않았다');
      assert.strictEqual(X.$('#atHours').textContent, '과제 4개, 합계 3시간');
      X.$('#atAdd').click();
      assert.deepStrictEqual(items(), ['알파:x', '베타:x', '감마:x', '델타:x']);
      esc(X);
      assert.ok(!shown(X, '#atAddMenu') && shown(X, '#atEd') && !shown(X, '#atAsk'), 'Esc 가 메뉴만 닫지 않았다');
      //  브라우저의 새 과제 만들기는 같은 화면의 과제 창을 연다. 만든 과제는 바로 목록에 나온다(지금 내 달력을 본다)
      X.$('#atAdd').click(); X.$('#atAddNew').click();
      assert.ok(shown(X, '#categoryModal'), '브라우저에서 과제 창이 열리지 않았다');
      X.ev("addCategory('엡실론', '#123456', ''); closeTopModal()");
      X.$('#atAdd').click();
      assert.ok(items().includes('엡실론'), '새로 만든 과제가 목록에 없다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 블록 순서: ▲ ▼ 없이 늘 캘린더 과제 순서(과제 미정은 맨 끝), 추가와 고르기와 불러오기 뒤에도 정렬, 자리가 바뀐 블록은 반짝인다', () => {
    const X = bootBrowser();
    try {
      openB(X);
      assert.ok(!X.$('#atBlocks [data-bup], #atBlocks [data-bdn]'), '▲ ▼ 단추가 남아 있다');
      assert.ok(X.$('.at-sorthint') && X.$('.at-sorthint').textContent === '캘린더 과제 순서대로 정렬됩니다', '정렬 안내가 없다');
      //  머리 순서: 점, 과제명, 시간 칸, 시간, ✕(맨 끝)
      const h0 = X.$('#atBlocks .at-blk[data-bi="0"] .at-bh');
      assert.deepStrictEqual([].map.call(h0.children, (e) => e.className.split(' ')[0]), ['at-dot', 'at-bn', 'at-bhr', 'at-bx']);
      X.$('#atBlocks [data-bx="0"]').click();   // 알파 지우기 → 베타, 감마
      X.ev("ATE.blocks.push({ name: '', hours: 1, text: '옛 글', raw: '' }); atBlocksRender()");
      X.ev("atAddPick('알파')");
      assert.deepStrictEqual(names(X), ['알파', '베타', '감마', ''], '추가한 과제가 캘린더 순서 자리에 들어가지 않았거나 과제 미정이 맨 끝이 아니다');
      assert.ok(X.$('#atBlocks .at-blk[data-bi="0"]').classList.contains('flash'), '추가한 블록이 반짝이지 않았다');
      X.ev("atAddPick('델타')");
      assert.deepStrictEqual(names(X), ['알파', '베타', '감마', '델타', '']);
      X.$('#atBlocks [data-bx="3"]').click();
      input(X, '#atBlocks select[data-bpick="3"]', '델타');
      assert.deepStrictEqual(names(X), ['알파', '베타', '감마', '델타'], '과제를 고른 뒤 정렬하지 않았다');
      //  과제 목록 순서가 기준이다(브라우저는 지금 내 달력 순서)
      X.ev("state.categories = [state.categories[3], state.categories[2], state.categories[1], state.categories[0]]");
      X.$('#atBlocks [data-bx="0"]').click();
      X.ev("atAddPick('알파')");
      assert.deepStrictEqual(names(X), ['델타', '감마', '베타', '알파'], '캘린더 과제 순서(바뀐 순서)로 정렬하지 않았다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 시간 칸: 기본 숫자 칸(0~24, 0.5, 칸 안 화살표), ↑ ↓ 0.5, Shift 1, 0~24 로 묶고, 휠로 바뀌지 않고, 떠나면 0.5 단위로 맞추며 비우면 0', () => {
    const X = bootBrowser();
    try {
      openB(X);
      const hn = () => X.$('#atBlocks input[data-bh="0"]');
      assert.deepStrictEqual([hn().type, hn().step, hn().value], ['number', '0.5', '2']);
      const key = (k, shift) => hn().dispatchEvent(new X.w.KeyboardEvent('keydown', { key: k, shiftKey: !!shift, bubbles: true, cancelable: true }));
      key('ArrowUp');
      assert.deepStrictEqual([hn().value, blk(X)[0].hours], ['2.5', 2.5]);
      key('ArrowUp', true);
      assert.deepStrictEqual([hn().value, blk(X)[0].hours], ['3.5', 3.5]);
      key('ArrowDown'); key('ArrowDown', true);
      assert.strictEqual(hn().value, '2');
      for (let i = 0; i < 30; i++) key('ArrowUp', true);
      assert.strictEqual(blk(X)[0].hours, 24, '24 에서 멈추지 않았다');
      for (let i = 0; i < 60; i++) key('ArrowDown');
      assert.strictEqual(blk(X)[0].hours, 0, '0 에서 멈추지 않았다');
      hn().dispatchEvent(new X.w.WheelEvent('wheel', { deltaY: -100, bubbles: true }));
      assert.strictEqual(blk(X)[0].hours, 0, '휠로 시간이 바뀌었다');
      //  칸 밖 단추는 없다(화살표는 기본 숫자 칸 안에 있다, 2026-10-29 사용자). 포커스가 있을 때 휠은 막는다
      assert.ok(!X.$('#atBlocks .at-bsb, #atBlocks [data-bsu], #atBlocks [data-bsd]'), '칸 밖 위아래 단추가 남아 있다');
      hn().focus();
      const we = new X.w.WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
      hn().dispatchEvent(we);
      assert.strictEqual(we.defaultPrevented, true, '포커스가 있는 시간 칸에서 휠을 막지 않았다');
      hn().blur();
      const we2 = new X.w.WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
      hn().dispatchEvent(we2);
      assert.strictEqual(we2.defaultPrevented, false, '포커스가 없는데 휠을 막아 목록 스크롤까지 막았다');
      const blur = () => hn().dispatchEvent(new X.w.FocusEvent('focusout', { bubbles: true }));
      setHours(X, 0, '7.3'); blur();
      assert.deepStrictEqual([hn().value, blk(X)[0].hours], ['7.5', 7.5], '떠날 때 0.5 단위로 맞추지 않았다');
      setHours(X, 0, '8.0'); blur();
      assert.deepStrictEqual([hn().value, blk(X)[0].hours], ['8', 8]);
      //  숫자 칸은 글자를 받지 않는다(브라우저가 빈 값으로 바꾼다). 비우면 0시간
      setHours(X, 0, ''); blur();
      assert.deepStrictEqual([hn().value, blk(X)[0].hours], ['0', 0], '비운 시간 칸이 0 이 아니다');
      setHours(X, 0, '6.5'); blur();
      assert.strictEqual(blk(X)[0].hours, 6.5);
      //  범위 밖은 그대로 두고(보내기에서 막는다) 빨간 시간 칸
      setHours(X, 0, '30'); blur();
      assert.strictEqual(blk(X)[0].hours, 30);
      X.ev('ATE.showErr = true; atBlockMark(0)');
      assert.ok(hn().classList.contains('bad') && X.$('#atBlocks .at-blk[data-bi="0"]').classList.contains('bad'), '범위 밖 시간 칸과 블록이 빨갛지 않다');
      assert.ok(X.$('#atBlocks .at-blk[data-bi="0"] [data-bmsg] .at-bmsg-i').textContent === '!', '안내 줄에 ! 표시가 없다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) ✕ 로 지우기, 고침 판단(블록, 자유 메모, 근태), 글로 보기 없음', () => {
    const X = bootBrowser();
    try {
      openB(X);
      assert.ok(!X.$('#atAsText'), '[글로 보기]가 남아 있다');
      assert.strictEqual(X.ev('atDirty()'), false);
      setHours(X, 1, '1.5');
      assert.strictEqual(X.$('#atHours').textContent, '과제 3개, 합계 4.5시간');
      assert.strictEqual(X.ev('atDirty()'), true);
      setHours(X, 1, '0');
      assert.strictEqual(X.ev('atDirty()'), false);
      typeMemo(X, '* 외근');
      assert.strictEqual(X.ev('atDirty()'), true, '자유 메모를 고쳤는데 고친 것이 아니다');
      typeMemo(X, '');
      assert.strictEqual(X.ev('atDirty()'), false);
      input(X, '#atStatus', '2');
      assert.strictEqual(X.ev('atDirty()'), true);
      input(X, '#atStatus', '6');
      X.$('#atBlocks [data-bx="1"]').click();
      assert.deepStrictEqual(names(X), ['알파', '감마']);
      assert.strictEqual(X.$('#atHours').textContent, '과제 2개, 합계 3시간');
      assert.ok(X.$('#atList').lastElementChild === X.$('#atAddWrap') && X.$('#atBlocks').nextElementSibling === X.$('#atAddWrap'), '[+ 과제 추가]가 마지막 블록 바로 아래(같은 스크롤 목록)가 아니다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 미리보기 탭: 보낼 때와 같은 조립 글(읽기만), 0.2초 뒤 따라가고, 막는 블록 줄은 빨갛다, n줄 n자와 복사, 탭 기억과 처음 탭 규칙, 접힘 이름', async () => {
    const X = bootBrowser();
    try {
      openB(X);
      assert.ok(!X.$('#atEd h3'), '가져오기 제목(h3)이 남아 있다');
      const tabs = X.evJSON("[].map.call(document.querySelectorAll('#atPanel [data-attab]'), function(b){ return b.dataset.attab + ':' + b.textContent; })");
      assert.deepStrictEqual(tabs, ['pv:미리보기', 'imp:가져오기']);
      assert.strictEqual(X.ev('ATE.ptab'), 'pv', '블록이 있는 날인데 처음 탭이 미리보기가 아니다');
      assert.ok(shown(X, '#atPreview') && !shown(X, '#atImp') && shown(X, '#atPvFoot') && !shown(X, '#atImpFoot'));
      const pv = () => X.$('#atPreview');
      assert.strictEqual(pv().textContent, X.ev('atCompose(ATE.blocks, ATE.memo)'), '미리보기가 보낼 글과 다르다');
      assert.ok(!pv().matches('textarea, input, [contenteditable]'), '미리보기를 고칠 수 있다');
      //  미리보기는 색 표시가 없다(베타는 내용이 있는데 0시간이지만 빨갛지 않다, 2026-10-29 사용자)
      assert.strictEqual(X.$('#atPreview .bad, #atPreview span'), null, '미리보기에 색 표시가 남아 있다');
      const t0 = pv().textContent;
      assert.strictEqual(X.$('#atPvStat').textContent, t0.split('\n').length + '줄, ' + t0.length + '자');
      typeMemo(X, '* 외근');
      assert.strictEqual(pv().textContent, t0, '0.2초 전에 다시 그렸다');
      await tick(260);
      assert.strictEqual(pv().textContent, '* 외근\n\n' + t0, '입력 뒤 미리보기가 따라가지 않았다');
      //  복사 단추는 없다(미리보기 글을 드래그해 복사한다, 2026-10-29 사용자)
      assert.ok(!X.$('#atCopy') && !X.$('#atPvCopy'), '복사 단추가 남아 있다');
      //  탭 기억: 가져오기를 고르면 기억하고, 블록이 있는 다른 날은 기억한 탭, 블록이 없는 날은 가져오기
      X.$('#atPanel [data-attab="imp"]').click();
      assert.ok(!shown(X, '#atPreview') && shown(X, '#atImp') && shown(X, '#atImpFoot') && !shown(X, '#atPvFoot'));
      assert.strictEqual(X.ev(`localStorage.getItem('tc_attPanelTab')`), 'imp');
      X.ev(`atShowEditor(atBuildPayload(${JSON.stringify(X.T)}, null, false))`);
      X.ev(`localStorage.setItem('tc_attPanelTab', 'pv')`);
      X.ev(`atShowEditor(atBuildPayload(addDays(todayYmd(), 9), null, false))`);
      assert.strictEqual(X.ev('ATE.blocks.length'), 0);
      assert.strictEqual(X.ev('ATE.ptab'), 'imp', '블록이 없는 날인데 가져오기 탭이 아니다');
      X.ev(`atShowEditor(atBuildPayload(${JSON.stringify(X.T)}, null, false))`);
      assert.strictEqual(X.ev('ATE.ptab'), 'pv', '블록이 있는 날인데 기억한 탭(미리보기)이 아니다');
      //  접기: 접힌 동안 "미리보기 열기 ›", 펼치면 미리보기 탭
      X.$('#atPanel [data-attab="imp"]').click();
      X.$('#atFold').click();
      assert.strictEqual(X.$('#atFold').textContent, '미리보기 열기 ›');
      X.$('#atFold').click();
      assert.strictEqual(X.ev('ATE.ptab'), 'pv', '펼쳤는데 미리보기 탭이 아니다');
      assert.notStrictEqual(X.$('#atFold').textContent, '미리보기 열기 ›');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 전체 초기화: 메모와 블록을 지우고 정근, 초과 없음, 묻지 않고 되돌리기도 없다, 빈 상태와 보내는 중에는 잠김', async () => {
    const X = bootBrowser();
    try {
      openB(X);
      const r = () => X.$('#atReset');
      assert.strictEqual(r().textContent, '전체 초기화');
      typeMemo(X, '* 외근'); input(X, '#atStatus', '2'); input(X, '#atOt', '3'); setHours(X, 1, '1.5');
      r().click();
      assert.ok(!shown(X, '#atAsk'), '전체 초기화가 물었다');
      assert.deepStrictEqual([X.ev('ATE.memo'), X.ev('ATE.blocks.length'), X.$('#atStatus').value, X.$('#atOt').value], ['', 0, '1', '0']);
      assert.ok(!X.$('#atUndo') && X.$('#atMsg').textContent === '', '전체 초기화 뒤에 안내나 되돌리기가 나왔다');
      assert.strictEqual(r().disabled, true, '이미 빈 상태인데 전체 초기화가 켜져 있다');
      X.ev('atDraftFlushNow()');
      const d = JSON.parse(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`));
      assert.deepStrictEqual([d.memo, d.blocks, d.status, d.overtime], ['', [], '1', 0], '빈 상태가 임시 저장되지 않았다');
      //  보내는 중에는 잠김
      typeMemo(X, '다시 쓴 메모');
      X.ev('ATE.sending = true; atSetBusy(true)');
      assert.strictEqual(r().disabled, true, '보내는 중에 전체 초기화가 켜져 있다');
      X.ev('ATE.sending = false; atSetBusy(false)');
      assert.strictEqual(r().disabled, false);
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 보내기를 막는다: 내용 있는 0시간, 범위 밖 시간, 과제 미정, 블록 없음(빨간 블록, 안내, 보내지 않음), 빈 과제는 : 0 으로 보낸다', () => {
    const X = bootBrowser();
    try {
      openB(X);
      X.ev('window.__cap = []; Platform.report.submitDaily = function(p){ __cap.push(JSON.parse(JSON.stringify(p))); };');
      const cap = () => X.evJSON('__cap').length;
      assert.ok(!isBad(X, 1), '보내기 전에 빨간 블록을 보였다');
      //  베타: 내용이 있는데 0시간
      X.$('#atSend').click();
      assert.strictEqual(cap(), 0, '내용 있는 0시간 블록이 있는데 보냈다');
      assert.ok(isBad(X, 1) && !isBad(X, 0) && !isBad(X, 2), '그 블록만 빨갛지 않다');
      assert.ok(X.$('#atBlocks .at-blk[data-bi="1"] [data-bmsg]').textContent.includes('0시간'));
      assert.ok(X.$('#atMsg').textContent.includes('고칠 과제가 1개'));
      assert.strictEqual(X.doc.activeElement, X.$('#atBlocks input[data-bh="1"]'), '첫 빨간 블록의 시간 칸으로 가지 않았다');
      //  고치면 바로 풀린다, 범위 밖 시간
      setHours(X, 1, '1');
      assert.ok(!isBad(X, 1), '고쳤는데 빨간 표시가 남았다');
      setHours(X, 0, '25');
      assert.ok(isBad(X, 0), '보내기를 한 번 막은 뒤에는 고치는 동안 바로 빨개져야 한다');
      X.$('#atSend').click();
      assert.strictEqual(cap(), 0, '범위 밖 시간인데 보냈다');
      setHours(X, 0, '2');
      //  과제 미정
      X.ev("ATE.blocks.push({ name: '', hours: 1, text: '옛 글', raw: '' }); atBlocksRender()");
      assert.ok(isBad(X, 3) && X.$('#atBlocks select[data-bpick="3"]'), '과제 미정 블록이 빨갛지 않거나 고르기 칸이 없다');
      X.$('#atSend').click();
      assert.strictEqual(cap(), 0, '과제 미정 블록이 있는데 보냈다');
      X.$('#atBlocks [data-bx="3"]').click();
      //  감마를 빈 과제로: [감마] : 0 으로 보내고 hours 에는 없다
      setHours(X, 2, '0');
      X.$('#atSend').click();
      assert.strictEqual(cap(), 1, '고칠 것이 없는데 보내지 않았다');
      const s = X.evJSON('__cap[0]');
      assert.ok(s.fields.content.endsWith('[감마] : 0'), '빈 과제가 [감마] : 0 으로 나가지 않았다: ' + s.fields.content);
      assert.deepStrictEqual(s.hours, [{ name: '알파', hours: 2 }, { name: '베타', hours: 1 }]);
      //  블록 없음
      for (let i = 0; i < 3; i++) X.$('#atBlocks [data-bx="0"]').click();
      assert.ok(X.$('#atBlocks .at-bempty'), '블록이 없을 때 안내가 없다');
      X.$('#atSend').click();
      assert.strictEqual(cap(), 1, '블록이 없는데 보냈다');
      assert.ok(X.$('#atMsg').textContent.includes('보낼 과제가 없습니다'));
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 가져오기: 출처는 캘린더와 이전 보고, 아무 날짜나 고르면 그날 캘린더 기록(그 자리에서), 이전 보고는 위젯 전용 안내, 날짜를 넘기면 보는 날짜로', () => {
    const X = bootBrowser();
    try {
      const Y = X.ev('addDays(todayYmd(), -1)');
      X.ev(`state.entries.push(${JSON.stringify(E({ id: 'e-y1', date: Y, title: '어제 일', categoryId: 'c-d' }))});`);
      openB(X);
      X.$('#atPanel [data-attab="imp"]').click();
      assert.ok(shown(X, '#atImp'), '가져오기 탭이 보이지 않는다');
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('[data-atsrc]'), function(b){ return b.dataset.atsrc + ':' + b.textContent; })"), ['cal:캘린더', 'prev:이전 보고']);
      assert.strictEqual(X.$('#atSrcDate').value, X.T, '가져올 날짜의 처음 값이 보는 날짜가 아니다');
      const sd = X.$('#atSrcDate'); sd.value = Y; sd.dispatchEvent(new X.w.Event('change', { bubbles: true }));
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#atCards .at-cnm'), function(x){ return x.textContent; })"), ['[델타]'], '고른 날짜의 캘린더 기록이 아니다');
      X.$('#atLoad').click();
      const b = blk(X);
      assert.ok(b.length === 1 && b[0].name === '델타' && b[0].hours === 0 && b[0].text.includes('어제 일'), '고른 날짜의 블록으로 바뀌지 않았다: ' + JSON.stringify(b));
      assert.strictEqual(X.ev('ATE.date'), X.T, '가져오기가 보는 날짜를 바꿨다');
      X.$('[data-atsrc="prev"]').click();
      assert.ok(X.$('#atCards').textContent.includes('위젯에서만'), '브라우저에서 이전 보고 안내가 없다');
      assert.ok(shown(X, '#atOpts') === false, '이전 보고인데 캘린더 옵션이 보인다');
      X.$('#atNext').click();
      assert.strictEqual(X.ev('ATE.srcDate'), X.ev('ATE.date'), '날짜를 넘겼는데 가져올 날짜가 보는 날짜로 돌아가지 않았다');
      assert.strictEqual(X.ev('ATE.src'), 'cal');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 보고한 날도 바로 쓰기 화면(보고한 글을 블록으로, 근태, 보낸 시각), 고친 것 없으면 Esc 와 ← 근태 달력은 묻지 않는다', () => {
    const X = bootBrowser();
    try {
      X.ev("pcSetTab('attend')");
      const sv = { status: '2', overtime: 3, content: '* 외근\n\n[알파] : 5\n&nbsp;&nbsp;- 납품 준비\n\n[델타]\n', sentAt: '2026-10-29T09:05:00.000Z' };
      X.ev(`atShowEditor(atBuildPayload(${JSON.stringify(X.T)}, ${JSON.stringify(sv)}, false))`);
      assert.ok(!X.$('#atVw') && !X.$('#atVwEdit') && !X.$('#atX'), '보기 화면이나 머리의 × 가 남아 있다');
      assert.ok(shown(X, '#atEdBody') && shown(X, '#atSend') && shown(X, '#atPanel') && shown(X, '#atBack'), '쓰기 화면이 아니다');
      assert.strictEqual(X.$('#atEdTitle').textContent, '근태 보고');
      assert.deepStrictEqual(blk(X), [{ name: '알파', hours: 5, text: '  - 납품 준비' }, { name: '델타', hours: 0, text: '' }], '보고한 글을 블록으로 되살리지 않았다(시간 없는 [델타] 는 0시간 블록)');
      assert.strictEqual(X.$('#atBlocks textarea[data-memo]').value, '* 외근', '첫 머리 앞의 글이 자유 메모가 아니다');
      assert.strictEqual(X.$('#atStatus').value, '2'); assert.strictEqual(X.$('#atOt').value, '3');
      assert.strictEqual(X.$('#atSent').textContent, '보낸 시각 ' + X.ev(`atSentLabel(${JSON.stringify(sv.sentAt)})`));
      assert.strictEqual(X.ev('atDirty()'), false, '열기만 했는데 고친 것으로 본다');
      esc(X);
      assert.ok(!shown(X, '#atEd') && shown(X, '#atMonth'), 'Esc 로 달력에 돌아가지 않았다');
      X.ev(`atShowEditor(atBuildPayload(addDays(todayYmd(), 9), ${JSON.stringify(sv)}, false))`);
      X.$('#atBack').click();
      assert.ok(!shown(X, '#atAsk') && shown(X, '#atMonth'), '고친 것이 없는데 ← 근태 달력이 물었다');
      X.ev(`atShowEditor(atBuildPayload(addDays(todayYmd(), 8), null, false))`);
      assert.strictEqual(X.$('#atSent').textContent, '');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 임시 저장 v2: 1초 뒤 쓰기({v:2, memo, blocks}), 다시 열면 안내 없이 되살리기, 처음과 같아지면 지움', async () => {
    const X = bootBrowser();
    try {
      openB(X);
      const t0 = blk(X)[0].text;
      typeBlock(X, 0, t0 + '\n임시 줄');
      typeMemo(X, '* 외근');
      assert.strictEqual(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`), null, '1초 전에 썼다');
      await tick(1100);
      const d = JSON.parse(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`));
      assert.strictEqual(d.v, 2); assert.strictEqual(d.memo, '* 외근');
      assert.deepStrictEqual(d.blocks.map((b) => Object.keys(b).sort().join()), ['hours,name,text', 'hours,name,text', 'hours,name,text'], '블록 모양이 {name, hours, text} 가 아니다');
      assert.ok(d.blocks[0].name === '알파' && d.blocks[0].hours === 2 && d.blocks[0].text.endsWith('임시 줄'));
      assert.strictEqual(d.status, '6'); assert.strictEqual(d.overtime, 0); assert.ok(d.savedAt);
      assert.ok(X.$('#atSaved').textContent.startsWith('이 PC에 임시 저장됨 '));
      X.$('#atClose').click();
      assert.ok(shown(X, '#atAsk'), '고친 내용이 있는데 닫기가 묻지 않았다');
      X.$('#atAskClose').click();
      assert.ok(shown(X, '#atMonth') && !shown(X, '#atEd'));
      assert.ok(X.$(`#atGrid .at-day[data-date="${X.T}"] .at-drf`), '달력에 작성 중 표시가 없다');
      X.ev(`atOpen(${JSON.stringify(X.T)})`);
      assert.ok(blk(X)[0].text.endsWith('임시 줄') && X.ev('ATE.memo') === '* 외근', '임시 저장이 되살아나지 않았다');
      assert.ok(!X.$('#atRestore') && !X.$('#atDiscard'), '되살림 안내나 버리고 처음 상태로가 남아 있다');
      typeMemo(X, ''); typeBlock(X, 0, t0);
      assert.strictEqual(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`), null, '처음 상태로 돌아왔는데 임시 저장이 남았다');
      typeBlock(X, 0, t0 + 'x'); X.ev('atDraftFlushNow()');
      assert.ok(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`));
      typeBlock(X, 0, t0);
      assert.strictEqual(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`), null, '처음 상태로 돌아왔는데 임시 저장이 남았다');
    } finally { X.close(); }
  });

  test('(B) 옛 임시 저장: v1 글은 되살리기 규칙으로 블록과 자유 메모로, v2 의 캘린더에 없는 이름은 과제 미정 블록(고르면 머리 줄을 지운다)', () => {
    const X = bootBrowser();
    try {
      X.ev("pcSetTab('attend')");
      const D9 = X.ev('addDays(todayYmd(), 9)'), D8 = X.ev('addDays(todayYmd(), 8)');
      X.ev(`localStorage.setItem('tc_attDraft:me:${D9}', JSON.stringify({ v:1, text:'메모 줄\\n[알파] : 3\\n- 옛 글\\n[감마]', status:'2', overtime:0, savedAt:'' }))`);
      X.ev(`atShowEditor(atBuildPayload(${JSON.stringify(D9)}, null, false))`);
      assert.strictEqual(X.ev('ATE.memo'), '메모 줄');
      assert.deepStrictEqual(blk(X), [{ name: '알파', hours: 3, text: '- 옛 글' }, { name: '감마', hours: 0, text: '' }]);
      assert.strictEqual(X.$('#atStatus').value, '2');
      X.ev(`localStorage.setItem('tc_attDraft:me:${D8}', JSON.stringify({ v:2, memo:'', blocks:[{ name:'옛 과제', hours:4, text:'- 한 일' }, { name:'베타', hours:1, text:'' }], status:'1', overtime:0, savedAt:'' }))`);
      X.ev(`atShowEditor(atBuildPayload(${JSON.stringify(D8)}, null, false))`);
      assert.deepStrictEqual(blk(X), [{ name: '베타', hours: 1, text: '' }, { name: '', hours: 4, text: '[옛 과제] : 4\n- 한 일' }], '캘린더에 없는 이름이 미정 블록(맨 끝)이 아니다');
      const sel = X.$('#atBlocks select[data-bpick="1"]');
      assert.deepStrictEqual([].map.call(sel.options, (o) => o.value), ['', '알파', '감마', '델타'], '고르기 칸이 이미 블록이 있는 과제를 빼지 않았다');
      input(X, '#atBlocks select[data-bpick="1"]', '델타');
      assert.deepStrictEqual(blk(X)[1], { name: '델타', hours: 4, text: '- 한 일' }, '과제를 골랐는데 원래 머리 줄을 지우지 않았다');
      assert.ok(!isBad(X, 1));
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 임시 저장 14일 정리: 이 계정의 14일 지난 키만 지운다(14일째와 다른 계정, 날짜 꼴 아닌 키는 남는다)', () => {
    const X = bootBrowser();
    try {
      const v = JSON.stringify({ v: 2, memo: '', blocks: [], status: '', overtime: 0, savedAt: '' });
      const keys = { old: 'tc_attDraft:me:' + X.ev('addDays(todayYmd(), -15)'), edge: 'tc_attDraft:me:' + X.ev('addDays(todayYmd(), -14)'),
        other: 'tc_attDraft:zz9:' + X.ev('addDays(todayYmd(), -30)'), odd: 'tc_attDraft:me:abc' };
      for (const k of Object.values(keys)) X.ev(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
      openB(X);
      const has = (k) => X.ev(`localStorage.getItem(${JSON.stringify(k)}) !== null`);
      assert.strictEqual(has(keys.old), false, '15일 지난 키가 남았다');
      assert.strictEqual(has(keys.edge), true, '14일째 키를 지웠다');
      assert.strictEqual(has(keys.other), true, '다른 계정의 키를 지웠다');
      assert.strictEqual(has(keys.odd), true, '날짜 꼴이 아닌 키를 지웠다');
    } finally { X.close(); }
  });

  test('(B) 떠날 때 확인: 고친 글이 있으면 탭 이동, ← 근태 달력, Esc 가 바로 닫지 않는다. 계속 쓰기, 바깥 누름은 남는다', () => {
    const X = bootBrowser();
    try {
      openB(X);
      typeBlock(X, 0, '- 고친 글');
      esc(X);
      assert.ok(shown(X, '#atEd') && shown(X, '#atAsk'), 'Esc 가 고친 글이 있는데 묻지 않았다');
      X.$('#atAskStay').click();
      assert.ok(shown(X, '#atEd') && !shown(X, '#atAsk'));
      X.$('#pcTabPersonal').click();
      assert.ok(shown(X, '#atAsk'), '탭 이동이 묻지 않았다');
      assert.strictEqual(X.ev('PCAL.tab'), 'attend');
      X.$('#atAskStay').click();
      assert.ok(!shown(X, '#atAsk') && blk(X)[0].text === '- 고친 글');
      X.$('#atBack').click();
      assert.ok(shown(X, '#atAsk'));
      X.$('#atAsk').dispatchEvent(new X.w.MouseEvent('click', { bubbles: true }));
      assert.ok(!shown(X, '#atAsk') && shown(X, '#atEd'), '바깥을 누르면 계속 쓰기여야 한다');
      X.$('#atClose').click(); assert.ok(shown(X, '#atAsk'));
      esc(X);
      assert.ok(!shown(X, '#atAsk') && shown(X, '#atEd'));
      X.$('#pcTabPersonal').click(); X.$('#atAskClose').click();
      assert.strictEqual(X.ev('PCAL.tab'), 'personal');
      assert.ok(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`).includes('고친 글'), '닫으며 임시 저장을 쓰지 않았다');
      X.ev(`localStorage.removeItem(${JSON.stringify(KEYB(X))})`);
      openB(X);
      esc(X);
      assert.ok(!shown(X, '#atEd') && shown(X, '#atMonth'), '고친 것이 없는데 Esc 로 돌아가지 않았다');
    } finally { X.close(); }
  });

  test('(B) 브라우저 보내기: 직접 입력 안내만, 잠그지 않고 임시 저장도 지우지 않는다, ‹ › 는 그 자리에서 다른 날짜', () => {
    const X = bootBrowser();
    try {
      openB(X);
      X.ev('window.__cap = []; var __o = Platform.report.submitDaily; Platform.report.submitDaily = function(p){ __cap.push(JSON.parse(JSON.stringify(p))); };');
      setHours(X, 1, '1');
      typeBlock(X, 0, '  - 들여쓴 줄');
      X.$('#atSend').click();
      assert.strictEqual(X.evJSON('__cap').length, 1);
      assert.strictEqual(X.$('#atSend').disabled, false, '브라우저에서 잠갔다(회신이 오지 않는다)');
      assert.ok(X.$('#atMsg').textContent.includes('직접 입력'));
      assert.ok(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`), '보내기 직전에 임시 저장을 쓰지 않았다');
      X.$('#atNext').click();
      const N = X.ev('addDays(todayYmd(), 1)');
      assert.strictEqual(X.ev('ATE.date'), N, '다음날로 넘어가지 않았다');
      assert.ok(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`).includes('들여쓴 줄'), '날짜를 넘기며 임시 저장이 사라졌다');
      X.$('#atPrev').click();
      assert.strictEqual(blk(X)[0].text, '  - 들여쓴 줄', '돌아왔는데 쓰던 글이 없다');
    } finally { X.close(); }
  });

  // ── (W) 위젯 메인 창 ─────────────────────────────────────────────────
  const META = { schemaVersion: '19', expectedSchema: '19', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  async function bootMain(src = app) {
    const X = boot(src, 'https://tcapp.local/', true);
    const sess = X.posted.find((x) => x && x.cmd === 'userSessionGet');
    if (sess) X.ev('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'tester', name: '시험자' } }) + ')');
    X.T = X.ev('todayYmd()');
    X.ev('__applyState(' + JSON.stringify(JSON.stringify(stateFor(X.T))) + ',' + JSON.stringify(META) + ')');
    await tick();
    X.ev("(function(){ for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k && k.indexOf('tc_attDraft:')===0) localStorage.removeItem(k); } })()");
    return X;
  }
  const ROWS = (T) => [
    { date: T, status: '2', overtime: 2, content: '[알파] : 5\n&nbsp;&nbsp;&nbsp;&nbsp;- 납품 준비\n[베타] : 3', sentAt: '2026-10-29T09:00:00.000Z' },
    { date: '2000-01-01', status: '1', overtime: 0, content: '범위 밖', sentAt: '' },
  ];
  test('(W) 근태 달력: 목록 회신으로 칸을 그린다(근태 표시, &nbsp; 를 공백으로, 작성 중), 요약 줄, 미보고 표시 없음', async () => {
    const X = await bootMain();
    try {
      stubHost(X, `{ reportDailyList: { ok: true, rows: ${JSON.stringify(ROWS(X.T))} } }`);
      const Y = X.ev('addDays(todayYmd(), -1)');
      X.ev(`localStorage.setItem('tc_attDraft:7:${Y}', JSON.stringify({ v:1, text:'쓰던 글', status:'', overtime:0, savedAt:'' }))`);
      X.$('#pcTabAttend').click(); await tick();
      const calls = X.evJSON('__calls');
      assert.strictEqual(calls[0][0], 'reportDailyList');
      assert.deepStrictEqual(Object.keys(calls[0][1]).sort(), ['from', 'to']);
      const cell = X.$(`#atGrid .at-day[data-date="${X.T}"]`);
      assert.strictEqual(cell.querySelector('.at-st').textContent, '야근(+2시간)');
      assert.strictEqual(cell.querySelector('.at-txt').textContent, '[알파] : 5\n    - 납품 준비\n[베타] : 3');
      assert.ok(X.$(`#atGrid .at-day[data-date="${Y}"] .at-drf`) || X.ev(`!document.querySelector('#atGrid .at-day[data-date="${Y}"]')`), '임시 저장이 있는 날에 작성 중 표시가 없다');
      if (X.$(`#atGrid .at-day[data-date="${Y}"]`)) assert.strictEqual(X.$(`#atGrid .at-day[data-date="${Y}"] .at-drf`).textContent, '✎ 작성 중');
      const sum = X.$('#atSum').textContent;
      assert.ok(sum.includes('보고 1일') && sum.includes('초과 합계 2시간'), '요약 줄이 다르다: ' + sum);
      assert.ok(!X.$('#atMonth').textContent.includes('미보고'), '미보고 표시가 있다');
      //  마우스를 올리면 전체 글
      cell.dispatchEvent(new X.w.MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }));
      assert.ok(X.$('#atTip') && X.$('#atTip').textContent.includes('납품 준비') && X.$('#atTip').textContent.startsWith('야근(+2시간)'));
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(W) 날짜를 누르면 attendOpen 하나(payload §3.3: 보고한 행, 근태, 행, 시간, 서식, 나), __attendNavFromWin 은 refresh 를 넘긴다', async () => {
    const X = await bootMain();
    try {
      stubHost(X, `{ reportDailyList: { ok: true, rows: ${JSON.stringify(ROWS(X.T))} }, attendOpen: { ok: true, error: '' } }`);
      X.$('#pcTabAttend').click(); await tick();
      X.$(`#atGrid .at-day[data-date="${X.T}"]`).click(); await tick();
      const ops = X.evJSON("__calls.filter(function(c){ return c[0] === 'attendOpen'; })");
      assert.strictEqual(ops.length, 1);
      const p = ops[0][1].payload;
      assert.strictEqual(p.v, 1); assert.strictEqual(p.date, X.T); assert.strictEqual(p.refresh, false);
      assert.deepStrictEqual(p.me, { userId: 7, loginId: 'tester', name: '시험자' });
      assert.deepStrictEqual(p.saved, { status: '2', overtime: 2, content: ROWS(X.T)[0].content, sentAt: ROWS(X.T)[0].sentAt }, '달력 캐시의 보고한 행이 아니다');
      assert.strictEqual(p.attend, '6');
      assert.deepStrictEqual(p.source.rows.map((r) => r.name).slice(0, 4), ['알파', '베타', '감마', '델타'], '행이 내 과제 목록 순서가 아니다');
      assert.deepStrictEqual(p.source.rows[0].titleMeta, [{ kind: 'event', details: ['UI 확인'] }, { kind: 'todo', details: ['세부 메모'] }]);
      assert.deepStrictEqual(p.source.hours, { 'c-a': 2, 'c-c': 1 });
      assert.deepStrictEqual(p.source.fmt, { mkSpec: { kind: 'const', ch: '-' }, indent: 2 });
      assert.deepStrictEqual(p.projects.slice(0, 4), [{ key: 'c-a', name: '알파', color: '#3e5be0' }, { key: 'c-b', name: '베타', color: '#2e9e6b' },
        { key: 'c-c', name: '감마', color: '#d97706' }, { key: 'c-d', name: '델타', color: '#5b6b7d' }], 'payload 에 내 과제 목록(이름, 키, 색, 목록 순서)이 없다');
      assert.strictEqual(X.evJSON("__calls.filter(function(c){ return c[0] === 'reportDailyList'; })").length, 1, '캐시에 있는 날인데 다시 읽었다');
      //  캐시 밖 날짜 → 그날을 읽고 연다
      X.ev("__attendNavFromWin('2001-02-03', true)"); await tick();
      const last = X.evJSON('__calls.slice(-2)');
      assert.deepStrictEqual(last[0], ['reportDailyList', { from: '2001-02-03', to: '2001-02-03' }]);
      assert.strictEqual(last[1][0], 'attendOpen'); assert.strictEqual(last[1][1].payload.date, '2001-02-03'); assert.strictEqual(last[1][1].payload.refresh, true);
      assert.strictEqual(last[1][1].payload.saved, null);
      assert.ok(!shown(X, '#atEd'), '위젯 메인 창에서 보고 화면을 그 자리에 열었다(근태 창에서 열어야 한다)');
    } finally { X.close(); }
  });

  test('(W) 가져오기 중계: __attendSourceFor(date) 는 payload 와 같은 source 를 attendSourcePush 로 보낸다(날짜 꼴이 아니면 보내지 않는다)', async () => {
    const X = await bootMain();
    try {
      const n = X.posted.length;
      X.ev(`__attendSourceFor(${JSON.stringify(X.T)})`);
      const out = X.posted.slice(n).filter((m) => m.cmd === 'attendSourcePush');
      assert.strictEqual(out.length, 1, 'attendSourcePush 를 한 번 보내지 않았다');
      assert.strictEqual(out[0].date, X.T);
      assert.deepStrictEqual(out[0].source, X.evJSON(`atBuildPayload(${JSON.stringify(X.T)}, null, false).source`), 'payload 의 source 와 모양이 다르다');
      assert.deepStrictEqual(out[0].source.hours, { 'c-a': 2, 'c-c': 1 });
      assert.ok(!('reqId' in out[0]), '회신 번호 없이 보내야 한다(호스트가 근태 창으로 넘긴다)');
      const k = X.posted.length;
      X.ev("__attendSourceFor('2026-1-2'); __attendSourceFor('<x>'); __attendSourceFor(null)");
      assert.strictEqual(X.posted.length, k, '날짜 꼴이 아닌데 보냈다');
    } finally { X.close(); }
  });

  test('(W) __attendCatNew: 메인 창은 과제 창을 연다(근태 창의 새 과제 만들기 요청)', async () => {
    const X = await bootMain();
    try {
      assert.ok(!shown(X, '#categoryModal'));
      X.ev('__attendCatNew()');
      assert.ok(shown(X, '#categoryModal'), '메인 창이 과제 창을 열지 않았다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(W) __reportDailySaved: 개인 캘린더 근태를 고치고(미기록이면 그대로), 보고서 창은 자기가 보내지 않은 회신에 토스트를 내지 않는다', async () => {
    const X = await bootMain();
    try {
      stubHost(X, `{ reportDailyList: { ok: true, rows: [] } }`);
      X.ev(`__reportDailySaved({ date: ${JSON.stringify(X.T)}, status: '2', overtime: 3 })`);
      assert.deepStrictEqual(X.evJSON(`getAttendance(${JSON.stringify(X.T)})`), { status: '2', overtime: 3 });
      X.ev(`__reportDailySaved({ date: ${JSON.stringify(X.T)}, status: '', overtime: 0 })`);
      assert.deepStrictEqual(X.evJSON(`getAttendance(${JSON.stringify(X.T)})`), { status: '2', overtime: 3 }, '미기록 보고가 개인 캘린더 근태를 지웠다');
      toastSpy(X);
      X.ev("__netcusProgress('근태 창의 진행'); __netcusResult(true, '회사 일간보고 전송 완료(근태 창)')");
      assert.deepStrictEqual(X.evJSON('__toasts'), [], '보고서 창이 근태 창의 회신에 토스트를 냈다');
      assert.ok(!X.$('#rptSendStatus').textContent.includes('근태 창'), '보고서 창 상태 줄에 근태 창 회신이 찍혔다');
      X.ev('armRptSendWatchdog()');
      X.ev("__netcusResult(false, '보고서 창의 실패')");
      assert.deepStrictEqual(X.evJSON('__toasts'), [['보고서 창의 실패', 'error']], '보고서 창이 보낸 회신은 그대로 알려야 한다');
      X.ev('clearTimeout(Netcus.watchdog)');
    } finally { X.close(); }
  });

  // ── (A) 근태 창 ─────────────────────────────────────────────────────
  const ATTEND_URL = 'https://tcapp.local/index.html?win=attend';
  function payloadFrom(T, saved, extraCats) {
    const B = bootBrowser();
    try {
      B.ev("__bootMeta = { userId: 7 }; currentUser = { loginId: 'tester', name: '시험자' };");
      if (extraCats) B.ev(`state.categories = state.categories.concat(${JSON.stringify(extraCats)})`);
      return B.evJSON(`atBuildPayload(${JSON.stringify(T)}, ${JSON.stringify(saved || null)}, false)`);
    } finally { B.close(); }
  }
  function bootAttend(src = app) {
    const A = boot(src, ATTEND_URL, true);
    A.T = A.ev('todayYmd()');
    A.KEY = 'tc_attDraft:7:' + A.T;
    A.ev("(function(){ for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k && k.indexOf('tc_attDraft:')===0) localStorage.removeItem(k); } })()");
    return A;
  }
  const openA = (A, saved) => A.ev('__attendWinOpen(' + JSON.stringify(payloadFrom(A.T, saved)) + ')');

  test('(A) ?win=attend: 내 달력을 부팅하지 않는다(준비 알림 하나), 보고 화면만 보인다, 봉인과 tw: 번호', () => {
    const A = bootAttend();
    try {
      assert.strictEqual(A.ev('ATTENDWIN'), true); assert.strictEqual(A.ev('SUBWIN'), true);
      assert.strictEqual(A.doc.documentElement.dataset.attendwin, '1');
      assert.deepStrictEqual(A.posted.map((m) => m.cmd), ['attendWinReady'], '근태 창이 준비 알림 말고 다른 것을 보냈다(내 달력을 부팅했다)');
      assert.strictEqual(A.doc.title, '근태 보고');
      assert.strictEqual(A.$('#atEd').parentElement, A.doc.body, '보고 화면이 창 전체(body 바로 아래)로 옮겨지지 않았다');
      assert.ok(!A.$('#pcTabs'), '근태 창에 탭 줄이 있다');
      const gate = A.$('#loginGate'); assert.ok(!gate || gate.classList.contains('hidden'), '근태 창에 로그인 화면이 떴다');
      assert.strictEqual(A.$('#atSend').disabled, true, 'payload 전에 보내기가 켜져 있다');
      const n = A.posted.length;
      A.ev("hpost({ cmd:'saveState' }); hpost({ cmd:'ready' }); hpost({ cmd:'attendOpen' }); hpost({ cmd:'netcusWeekMerge', reqId:'y' }); hpost({ cmd:'reportDailyList', reqId:'x' })");
      assert.deepStrictEqual(A.posted.slice(n).map((m) => m.cmd), ['reportDailyList'], '봉인 밖 명령이 나갔다(netcusWeekMerge 는 근태 창에서 뺐다)');
      A.ev("hostRequest('reportDailyList', { from:'2026-01-01', to:'2026-01-02' })");
      assert.ok(/^tw:[a-z0-9]+:reportDailyList-\d+$/.test(A.posted[A.posted.length - 1].reqId), "회신 번호가 'tw:' 로 시작하지 않는다");
      openA(A);
      assert.strictEqual(A.$('#atSend').disabled, false);
      assert.strictEqual(A.$('#atSend').textContent, '보고');
      assert.deepStrictEqual(names(A), ['알파', '베타', '감마']);
      assert.deepStrictEqual(A.evJSON('ATE.p.projects.map(function(x){ return x.name; })'), ['알파', '베타', '감마', '델타'], 'payload 의 과제 목록을 쓰지 않는다');
      assert.ok(A.doc.title.startsWith('근태 보고 '));
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  test('(A) 보고한 날도 바로 쓰기 화면(블록으로 되살림, &nbsp; 를 공백으로, 근태), 같은 날짜 새로고침은 블록을 건드리지 않고 과제 목록만 바꾼다', () => {
    const A = bootAttend();
    try {
      openA(A, { status: '2', overtime: 2, content: '[알파] : 5\n&nbsp;&nbsp;- 납품 준비\n', sentAt: '2026-10-29T09:00:00.000Z' });
      assert.ok(shown(A, '#atEdBody') && shown(A, '#atSend') && !A.$('#atVw') && !A.$('#atX'), '보고한 날인데 쓰기 화면이 아니다');
      assert.deepStrictEqual(blk(A), [{ name: '알파', hours: 5, text: '  - 납품 준비' }]);
      assert.strictEqual(A.$('#atStatus').value, '2'); assert.strictEqual(A.$('#atOt').value, '2');
      assert.ok(A.$('#atSent').textContent.startsWith('보낸 시각 '), '보낸 시각이 없다');
      assert.strictEqual(A.ev('__winCloseRequest()'), 'close', '고친 것이 없는데 닫기를 막았다');
      A.$('#atNext').click();
      assert.deepStrictEqual(A.posted[A.posted.length - 1], { cmd: 'attendNav', date: A.ev('addDays(todayYmd(), 1)'), refresh: false });
      A.ev('ATE.navPending = ""; atSyncNav(); atMsg("")');
      typeBlock(A, 0, '고치는 중');
      typeMemo(A, '* 메모');
      A.ev("ATE.blocks.push({ name: '', hours: 1, text: '[모름] : 1', raw: '[모름] : 1' }); atBlocksRender()");
      //  메인 창에서 새 과제(엡실론)를 만들고 돌아왔다: 새로고침 payload 가 과제 목록을 바꾼다
      const p = payloadFrom(A.T, { status: '2', overtime: 2, content: '[알파] : 5' }, [{ id: 'c-e', name: '엡실론', color: '#123456', desc: '', createdAt: CA }]);
      p.refresh = true; p.source.rows = p.source.rows.slice(0, 1);
      A.ev('__attendWinOpen(' + JSON.stringify(p) + ')');
      assert.deepStrictEqual(blk(A), [{ name: '알파', hours: 5, text: '고치는 중' }, { name: '', hours: 1, text: '[모름] : 1' }], '새로고침이 왼쪽 블록을 바꿨다');
      assert.strictEqual(A.ev('ATE.memo'), '* 메모', '새로고침이 자유 메모를 바꿨다');
      assert.strictEqual(A.ev('ATE.p.source.rows.length'), 1, '새로고침이 패널 출처를 바꾸지 않았다');
      assert.ok([].map.call(A.$('#atBlocks select[data-bpick="1"]').options, (o) => o.value).includes('엡실론'), '새 과제가 미정 블록의 고르기 칸에 없다');
      A.$('#atAdd').click();
      assert.ok(A.$('#atAddList [data-addname="엡실론"]'), '새 과제가 과제 추가 목록에 없다');
      A.$('#atAddList [data-addname="엡실론"]').click();
      assert.deepStrictEqual(names(A), ['알파', '엡실론', ''], '새 블록이 캘린더 순서 자리(과제 미정 앞)에 들어가지 않았다');
      A.ev('__attendWinActivated()');
      assert.deepStrictEqual(A.posted[A.posted.length - 1], { cmd: 'attendNav', date: A.T, refresh: true });
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  test('(A) 새 과제 만들기: [+ 캘린더에 새 과제 만들기]는 attendCatNew 하나를 보내고 안내한다(근태 창은 과제를 만들지 않는다)', () => {
    const A = bootAttend();
    try {
      openA(A);
      const n = A.posted.length;
      A.$('#atAdd').click();
      A.$('#atAddNew').click();
      assert.deepStrictEqual(A.posted.slice(n), [{ cmd: 'attendCatNew' }], 'attendCatNew 를 보내지 않았다');
      assert.ok(!shown(A, '#atAddMenu'), '메뉴가 닫히지 않았다');
      assert.ok(A.$('#atMsg').textContent.includes('메인 창'), '안내가 없다');
      assert.ok(!shown(A, '#categoryModal'), '근태 창에서 과제 창을 열었다');
    } finally { A.close(); }
  });

  test('(A) [인트라넷에서 확인]: 보고한 날만 보이고, 누르면 netcusViewMonth(y, m, d)를 청하고 여는 동안 잠근다, 실패면 안내', async () => {
    const A = bootAttend();
    try {
      A.ev('__attendWinOpen(' + JSON.stringify(payloadFrom(A.ev('addDays(todayYmd(), 1)'))) + ')');
      assert.strictEqual(A.$('#atIntra').hidden, true, '보고하지 않은 날인데 인트라넷 확인 링크가 보인다');
      stubHost(A, `{ netcusViewMonth: function(p){ return window.__vmReply; } }`);
      A.ev(`window.__vmReply = { ok: true, error: '', marked: true }`);
      openA(A, { status: '1', overtime: 0, content: '[알파] : 8', sentAt: '2026-10-29T09:00:00.000Z' });
      const b = A.$('#atIntra');
      assert.ok(!b.hidden && !b.disabled && b.textContent === '인트라넷에서 확인', '보고한 날인데 링크가 없다');
      b.click();
      assert.strictEqual(b.disabled, true, '여는 동안 잠그지 않았다');
      assert.strictEqual(b.textContent, '인트라넷 여는 중…');
      await tick();
      const [y, m, d] = A.T.split('-').map(Number);
      assert.deepStrictEqual(A.evJSON("__calls.filter(function(c){ return c[0] === 'netcusViewMonth'; })"), [['netcusViewMonth', { y, m, d }]]);
      assert.ok(!b.disabled && b.textContent === '인트라넷에서 확인');
      assert.strictEqual(A.$('#atMsg').textContent, '', '성공했는데 안내를 띄웠다');
      A.ev(`window.__vmReply = { ok: false, error: 'busy', marked: false }`);
      b.click(); await tick();
      assert.ok(A.$('#atMsg').textContent.includes('다른 작업'), '바쁨 안내가 없다');
      A.ev(`window.__vmReply = { ok: false, error: 'login', marked: false }`);
      b.click(); await tick();
      assert.ok(A.$('#atMsg').textContent.includes('로그인에 실패'), '로그인 실패 안내가 없다');
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  //  가져오기 캘린더(다른 날짜): 근태 창은 attendSourceReq 로 청하고 __attendSource 로 받는다. 변이 시험이 재사용한다.
  function calRelay(A) {
    openA(A);
    const Y = A.ev('addDays(todayYmd(), -1)'), Z = A.ev('addDays(todayYmd(), -2)');
    const n = A.posted.length;
    const sd = A.$('#atSrcDate'); sd.value = Y; sd.dispatchEvent(new A.w.Event('change', { bubbles: true }));
    assert.deepStrictEqual(A.posted.slice(n), [{ cmd: 'attendSourceReq', date: Y }], '다른 날짜의 캘린더 기록을 메인 창에 청하지 않았다');
    assert.ok(A.$('#atCards').textContent.includes('가져오는 중'), '기다리는 안내가 없다');
    const src = payloadFrom(A.T).source; src.rows = src.rows.slice(1, 2); src.hours = { 'c-b': 1.5 };
    A.ev('__attendSource(' + JSON.stringify({ date: Z, source: src }) + '); atPanelRender()');
    assert.ok(A.$('#atCards').textContent.includes('가져오는 중'), '청하지 않은 날짜의 회신을 받았다');
    A.ev('__attendSource(' + JSON.stringify({ date: Y, source: src }) + ')');
    assert.deepStrictEqual(A.evJSON("[].map.call(document.querySelectorAll('#atCards .at-cnm'), function(x){ return x.textContent; })"), ['[베타]'], '중계로 받은 기록이 카드가 아니다');
    typeBlock(A, 0, '고친 글');
    A.$('#atLoad').click();
    const b = blk(A);
    assert.ok(b.length === 1 && b[0].name === '베타' && b[0].hours === 1.5 && b[0].text.includes('고객 회신'), '불러오기가 그 날짜의 블록(공수표 시간)으로 바로 바꾸지 않았다: ' + JSON.stringify(b));
    assert.strictEqual(A.ev('ATE.date'), A.T);
  }
  test('(A) 가져오기 캘린더: 다른 날짜는 attendSourceReq 로 메인 창에 청하고 __attendSource 회신(그 날짜만)으로 카드, 불러오기는 바로 바꾼다', () => {
    const A = bootAttend();
    try { calRelay(A); assert.deepStrictEqual(A.errors, []); } finally { A.close(); }
  });

  test('(A) 가져오기 이전 보고: reportDailyList(그날 하루)로 읽어 자유 메모, 블록, 과제 미정으로 되살리고, 없는 날과 오류는 안내, 같은 날은 다시 읽지 않는다', async () => {
    const A = bootAttend();
    try {
      const Y = A.ev('addDays(todayYmd(), -1)');
      stubHost(A, `{ reportDailyList: function(p){ return window.__prevReply(p); } }`);
      A.ev(`window.__prevReply = function(p){ return { ok: true, rows: [{ date: p.from, status: '1', overtime: 0, sentAt: '',
        content: '* 외근\\n\\n[알파] : 5\\n[일정]\\n&nbsp;&nbsp;- 연동\\n\\n[모름] : 2\\n- 기타 일\\n\\n[베타]' }] }; }`);
      openA(A);
      typeMemo(A, '지금 메모');
      const sd = A.$('#atSrcDate'); sd.value = Y; sd.dispatchEvent(new A.w.Event('change', { bubbles: true }));
      A.$('[data-atsrc="prev"]').click();
      assert.ok(A.$('#atCards').textContent.includes('읽는 중'), '읽는 중 안내가 없다');
      await tick();
      assert.deepStrictEqual(A.evJSON("__calls.filter(function(c){ return c[0] === 'reportDailyList'; }).map(function(c){ return c[1]; })"), [{ from: Y, to: Y }], '그날 하루로 읽지 않았다');
      assert.ok(!shown(A, '#atOpts'), '이전 보고인데 캘린더 옵션이 보인다');
      assert.deepStrictEqual(A.evJSON("[].map.call(document.querySelectorAll('#atCards .at-cnm'), function(x){ return x.textContent; })"), ['자유 메모', '[알파]', '과제 미정', '[베타]']);
      assert.strictEqual(A.$('#atPick').textContent, '과제 4 / 4개 선택');
      A.$('#atLoad').click();
      assert.strictEqual(A.ev('ATE.memo'), '* 외근', '이전 보고의 자유 메모를 불러오지 않았다');
      assert.deepStrictEqual(blk(A), [{ name: '알파', hours: 5, text: '[일정]\n  - 연동' }, { name: '베타', hours: 0, text: '' }, { name: '', hours: 2, text: '[모름] : 2\n- 기타 일' }], '불러온 블록이 캘린더 순서(과제 미정은 맨 끝)가 아니다');
      assert.ok(isBad(A, 2) && !isBad(A, 0), '과제 미정 블록만 빨갛지 않다');
      input(A, '#atBlocks select[data-bpick="2"]', '감마');
      assert.deepStrictEqual(blk(A)[2], { name: '감마', hours: 2, text: '- 기타 일' }, '과제를 고르면 원래 머리 줄을 지워야 한다');
      //  메모 카드를 끄고 불러오면 메모는 그대로
      typeMemo(A, '지금 메모');
      const cm = A.$('#atCards input[data-atid="p:memo"]'); cm.checked = false; cm.dispatchEvent(new A.w.Event('change', { bubbles: true }));
      A.$('#atLoad').click();
      assert.strictEqual(A.ev('ATE.memo'), '지금 메모', '메모 카드를 끄고 불러왔는데 메모가 바뀌었다');
      //  같은 날짜는 다시 읽지 않는다
      A.$('[data-atsrc="cal"]').click(); A.$('[data-atsrc="prev"]').click(); await tick();
      assert.strictEqual(A.evJSON("__calls.filter(function(c){ return c[0] === 'reportDailyList'; })").length, 1, '같은 날짜를 다시 읽었다');
      //  없는 날
      A.ev(`window.__prevReply = function(p){ return { ok: true, rows: [] }; }`);
      const Z = A.ev('addDays(todayYmd(), -2)');
      sd.value = Z; sd.dispatchEvent(new A.w.Event('change', { bubbles: true })); await tick();
      assert.ok(A.$('#atCards').textContent.includes('보낸 보고가 없습니다'), '없는 날 안내가 없다');
      assert.strictEqual(A.$('#atLoad').disabled, true);
      //  오류, 다시 읽기
      A.ev(`window.__prevReply = function(p){ return { ok: false, error: 'db' }; }`);
      const W = A.ev('addDays(todayYmd(), -3)');
      sd.value = W; sd.dispatchEvent(new A.w.Event('change', { bubbles: true })); await tick();
      assert.ok(A.$('#atCards').textContent.includes('읽지 못했습니다'), '오류 안내가 없다');
      A.ev(`window.__prevReply = function(p){ return { ok: true, rows: [{ date: p.from, status: '1', overtime: 0, content: '[감마] : 1', sentAt: '' }] }; }`);
      A.$('#atCards [data-atretry]').click(); await tick();
      assert.deepStrictEqual(A.evJSON("[].map.call(document.querySelectorAll('#atCards .at-cnm'), function(x){ return x.textContent; })"), ['[감마]'], '다시 읽기가 되지 않았다');
      assert.ok(!A.posted.some((m) => /^netcus/.test(m.cmd)), '이전 보고가 회사 사이트 명령을 보냈다');
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  //  보내기 + 회신. 변이 시험이 재사용한다.
  function sendFlow(A) {
    openA(A);
    assert.ok(!A.evJSON("[].map.call(document.querySelectorAll('#atStatus option'), function(o){ return o.value; })").includes(''), '근태 목록에 미기록이 있다');
    input(A, '#atStatus', '2');
    input(A, '#atOt', '2');
    typeMemo(A, '* 대전 ADD 외근\n');
    typeBlock(A, 0, '\n    - 납품 준비\n\t- 탭 줄\n\n');
    setHours(A, 0, '2.5');
    typeBlock(A, 1, '- 회신');
    setHours(A, 1, '3');
    setHours(A, 2, '0');
    A.$('#atSend').click(); A.$('#atSend').click();   // 연속 클릭
    const sub = A.posted.filter((m) => m.cmd === 'netcusSubmit');
    assert.strictEqual(sub.length, 1, '연속 클릭에 두 번 보냈다');
    return sub[0];
  }
  test('(A) 보내기 payload: 자유 메모 먼저, [과제명] : 시간 조립(소수, 빈 과제 : 0), 줄 앞 공백은 &nbsp;, hours 는 블록(0 제외), 고른 근태 코드, 처리 중 잠금', () => {
    const A = bootAttend();
    try {
      const s = sendFlow(A);
      const NB = '&nbsp;';
      assert.strictEqual(s.content, '* 대전 ADD 외근\n\n[알파] : 2.5\n' + NB.repeat(4) + '- 납품 준비\n' + NB.repeat(4) + '- 탭 줄\n\n[베타] : 3\n- 회신\n\n[감마] : 0');
      assert.deepStrictEqual(s.hours, [{ name: '알파', hours: 2.5 }, { name: '베타', hours: 3 }]);
      assert.strictEqual(s.status, '2', '고른 근태 코드가 아니다(이 화면은 null 을 보내지 않는다)');
      assert.strictEqual(s.overtime, 2);
      assert.deepStrictEqual([s.y, s.m, s.d], A.T.split('-').map(Number));
      assert.strictEqual(s.dryRun, false);
      for (const sel of ['#atBlocks textarea[data-bt="0"]', '#atBlocks textarea[data-memo]', '#atBlocks input[data-bh="0"]', '#atBlocks [data-bx="0"]', '#atAdd', '#atStatus', '#atOt', '#atSend', '#atClose', '#atLoad', '#atPrev'])
        assert.strictEqual(A.$(sel).disabled, true, sel + ' 가 처리 중에 잠기지 않았다');
      assert.strictEqual(A.$('#atSend').textContent, '보고하는 중…');
      assert.ok(A.ev(`localStorage.getItem(${JSON.stringify(A.KEY)})`), '보내기 직전에 임시 저장을 쓰지 않았다');
      assert.strictEqual(A.ev('__winCloseRequest()'), 'busy', '보내는 중인데 창 닫기를 막지 않았다');
      A.ev("__netcusProgress('로그인 중')");
      assert.strictEqual(A.$('#atMsg').textContent, '로그인 중');
    } finally { A.close(); }
  });

  function successClears(A) {
    sendFlow(A);
    A.ev(`__reportDailySaved({ date: ${JSON.stringify(A.T)}, status: '2', overtime: 2 })`);
    A.ev("__netcusResult(true, '회사 일간보고 전송 완료')");
    assert.strictEqual(A.ev(`localStorage.getItem(${JSON.stringify(A.KEY)})`), null, '성공했는데 임시 저장이 남았다');
    assert.strictEqual(A.w.__closeCalls, 0, '성공했는데 창을 닫았다');
    assert.ok(shown(A, '#atEdBody') && shown(A, '#atSend') && !A.$('#atVw'), '성공 뒤 쓰기 화면이 아니다');
    assert.strictEqual(A.$('#atBlocks textarea[data-bt="0"]').value, '    - 납품 준비\n\t- 탭 줄', '성공 뒤 보낸 글이 창에 남지 않았다(앞뒤 빈 줄 정리)');
    assert.deepStrictEqual(names(A), ['알파', '베타', '감마']);
    assert.strictEqual(A.$('#atSend').textContent, '보고');
    assert.strictEqual(A.$('#atStatus').value, '2'); assert.strictEqual(A.$('#atOt').value, '2');
    assert.ok(/^보낸 시각 \d{4}-\d\d-\d\d \d\d:\d\d$/.test(A.$('#atSent').textContent), '보낸 시각이 없다');
    assert.strictEqual(A.$('#atMsg').textContent, '회사 일간보고 전송 완료');
    assert.strictEqual(A.ev('atDirty()'), false, '성공 뒤에도 고친 것으로 본다');
    assert.strictEqual(A.ev('__winCloseRequest()'), 'close', '성공 뒤 닫기를 막았다');
    //  보낸 글을 다시 되살리면 같은 블록이 된다(다음에 열 때와 같다. 탭은 보낼 때 &nbsp; 넷이 되어 공백 넷으로 돌아온다)
    const back = A.evJSON('atParseReport(ATE.p.saved.content, ATE.p.projects.map(function(x){ return x.name; }))');
    assert.deepStrictEqual([back.memo, back.blocks.map((b) => [b.name, b.hours, b.text])], [A.ev('ATE.memo'), blk(A).map((b) => [b.name, b.hours, b.text.replace(/\t/g, '    ')])], '보낸 글을 되살리면 지금 블록과 다르다');
  }
  test('(A) 성공 회신: 임시 저장을 지우고 창은 닫지 않고 쓰기 화면 그대로, 보낸 블록이 새 처음 상태(고친 것 없음), 보낸 시각', () => {
    const A = bootAttend();
    try { successClears(A); } finally { A.close(); }
  });
  test('(A) 실패 회신: 공통 안내, 잠금 풀림, 임시 저장과 블록 유지, 자기가 보내지 않은 회신은 무시', () => {
    const A = bootAttend();
    try {
      A.ev("__netcusResult(false, '남의 회신')");
      openA(A);
      assert.strictEqual(A.$('#atMsg').textContent, '', '보내지 않았는데 회신에 반응했다');
      A.ev('localStorage.clear()');
      sendFlow(A);
      A.ev("__netcusResult(false, '세션이 만료됐거나 로그인이 필요합니다.')");
      assert.strictEqual(A.$('#atMsg').textContent, '처리를 완료하지 못했습니다. 다시 시도해 주세요.');
      assert.strictEqual(A.$('#atMsg').title, '세션이 만료됐거나 로그인이 필요합니다.');
      assert.strictEqual(A.$('#atSend').disabled, false); assert.strictEqual(A.$('#atBlocks textarea[data-bt="0"]').disabled, false);
      assert.strictEqual(A.$('#atSend').textContent, '보고');
      assert.ok(blk(A)[0].text.includes('납품 준비'));
      assert.ok(A.ev(`localStorage.getItem(${JSON.stringify(A.KEY)})`), '실패했는데 임시 저장이 지워졌다');
      assert.strictEqual(A.w.__closeCalls, 0);
      A.ev("__netcusResult(true, '다음 회신')");
      assert.strictEqual(A.w.__closeCalls, 0, '이미 받은 뒤의 회신에 창을 닫았다');
    } finally { A.close(); }
  });

  function closeGuard(A) {
    openA(A);
    assert.strictEqual(A.ev('__winCloseRequest()'), 'close', '고친 것이 없는데 닫기를 막았다');
    typeBlock(A, 0, '- 고친 글');
    assert.strictEqual(A.ev('__winCloseRequest()'), 'ask', '고친 글이 있는데 묻지 않았다');
    assert.ok(shown(A, '#atAsk'));
    assert.strictEqual(A.ev('__winCloseRequest()'), 'ask', '묻는 중에 다시 누르면 기다려야 한다');
    A.$('#atAskStay').click();
    assert.strictEqual(A.w.__closeCalls, 0);
    esc(A);
    assert.ok(shown(A, '#atAsk'), 'Esc 가 고친 글이 있는데 묻지 않았다');
    assert.strictEqual(A.w.__closeCalls, 0, 'Esc 가 묻지 않고 근태 창을 닫았다');
    A.$('#atAskStay').click();
    A.$('#atClose').click();
    assert.ok(shown(A, '#atAsk'), '닫기 단추가 묻지 않았다');
    A.$('#atAskClose').click();
    assert.strictEqual(A.w.__closeCalls, 1, '[닫기]가 창을 닫지 않았다');
    assert.ok(A.ev(`localStorage.getItem(${JSON.stringify(A.KEY)})`).includes('고친 글'), '닫으며 임시 저장을 쓰지 않았다');
  }
  test('(A) 닫기 지키기: __winCloseRequest 는 close / ask / busy, 계속 쓰기, Esc 는 닫기와 같다, [닫기]는 임시 저장 뒤 창 닫기', () => {
    const A = bootAttend();
    try { closeGuard(A); } finally { A.close(); }
  });

  test('(A) ‹ › 는 임시 저장을 쓰고 메인 창에 그 날짜를 청한다(attendNav), 다른 날짜 payload 가 오면 그 날짜로 연다', () => {
    const A = bootAttend();
    try {
      openA(A);
      typeBlock(A, 0, '넘기기 전 글');
      A.$('#atNext').click();
      const N = A.ev('addDays(todayYmd(), 1)');
      assert.deepStrictEqual(A.posted[A.posted.length - 1], { cmd: 'attendNav', date: N, refresh: false });
      assert.ok(A.ev(`localStorage.getItem(${JSON.stringify(A.KEY)})`).includes('넘기기 전 글'));
      assert.strictEqual(A.$('#atNext').disabled, true, '청한 날짜가 오기 전에 또 넘길 수 있다');
      A.ev('__attendWinOpen(' + JSON.stringify(payloadFrom(N)) + ')');
      assert.strictEqual(A.ev('ATE.date'), N);
      assert.strictEqual(A.$('#atNext').disabled, false);
    } finally { A.close(); }
  });

  // ── (M) 변이 ─────────────────────────────────────────────────────────
  test('변이 M1: 근태 창 봉인을 빼면 부팅 검사가 잡는다', () => {
    const bad = mutate(app, "  if(ATTENDWIN && !ATTENDWIN_CMD.has(String((o && o.cmd) || ''))) return;\n", '');
    const A = bootAttend(bad);
    try {
      assert.notDeepStrictEqual(A.posted.map((m) => m.cmd), ['attendWinReady'], '변이가 경로에 닿지 않았다');
    } finally { A.close(); }
  });
  test('변이 M2: 성공 회신에서 임시 저장 지우기를 빼면 성공 검사가 잡는다', () => {
    const bad = mutate(app, "    clearTimeout(ATE.timer); ATE.timer = null;\n    attDraftDel(ATE.date);\n", '    clearTimeout(ATE.timer); ATE.timer = null;\n');
    const A = bootAttend(bad);
    try { assert.throws(() => successClears(A), /임시 저장이 남았다/); } finally { A.close(); }
  });
  test('변이 M3: 닫기 전 확인(고친 글)을 빼면 닫기 지키기 검사가 잡는다', () => {
    const bad = mutate(app, "  if(atDirty()){ atAsk(() => atWinCloseNow()); return 'ask'; }\n", '');
    const A = bootAttend(bad);
    try { assert.throws(() => closeGuard(A), /묻지 않았다/); } finally { A.close(); }
  });
  test('변이 M4: 성공 뒤 창 블록을 보낸 그대로 맞추기를 빼면 성공 검사가 잡는다', () => {
    const bad = mutate(app, '    ATE.memo = sentMemo; ATE.blocks = sent.map(b => Object.assign({}, b));', '');
    const A = bootAttend(bad);
    try { assert.throws(() => successClears(A), /보낸 글이 창에 남지 않았다/); } finally { A.close(); }
  });
  test('변이 M5: Esc 의 닫기를 빼면 닫기 지키기 검사가 잡는다', () => {
    const bad = mutate(app, "  if(atAddShown()){ atAddOpen(false); const a = $('#atAdd'); if(a) try{ a.focus(); }catch(_){} return true; }   // 과제 추가 메뉴만 닫는다" + NL + "  atRequestClose();" + NL,
      "  if(atAddShown()){ atAddOpen(false); const a = $('#atAdd'); if(a) try{ a.focus(); }catch(_){} return true; }   // 과제 추가 메뉴만 닫는다" + NL);
    const A = bootAttend(bad);
    try { assert.throws(() => closeGuard(A), /Esc 가 고친 글이 있는데 묻지 않았다/); } finally { A.close(); }
  });
  test('변이 M6: 가져오기 회신의 날짜 거르기를 빼면 중계 검사가 잡는다', () => {
    const bad = mutate(app, "  if(ATE.cal.date !== o.date) return;   // 그 사이 다른 날짜를 골랐다" + NL, '');
    const A = bootAttend(bad);
    try { assert.throws(() => calRelay(A), /청하지 않은 날짜의 회신을 받았다/); } finally { A.close(); }
  });
  test('변이 M7: 내용 있는 0시간 막기를 빼면 보내기 막기 검사가 잡는다', () => {
    const bad = mutate(app, "  if(String(b.text || '').trim() && b.hours === 0) return '내용이 있는데 0시간입니다. 시간을 적으세요.';" + NL, '');
    const X = bootBrowser(bad);
    try {
      openB(X);
      X.ev('window.__cap = []; Platform.report.submitDaily = function(p){ __cap.push(1); };');
      X.$('#atSend').click();
      assert.strictEqual(X.evJSON('__cap').length, 1, '변이가 경로에 닿지 않았다');
    } finally { X.close(); }
  });
  test('변이 M9: 과제 추가 뒤 정렬을 빼면 새 블록이 맨 끝에 붙는다(순서 검사가 잡는다)', () => {
    const bad = mutate(app, '  const moved = atSortBlocks();' + NL + '  atBlocksRender();' + NL + '  atFlash(moved.includes(nb)', '  const moved = [];' + NL + '  atBlocksRender();' + NL + '  atFlash(moved.includes(nb)');
    const X = bootBrowser(bad);
    try {
      openB(X);
      X.$('#atBlocks [data-bx="0"]').click();
      X.ev("atAddPick('알파')");
      assert.deepStrictEqual(names(X), ['베타', '감마', '알파'], '변이가 경로에 닿지 않았다');
    } finally { X.close(); }
  });
  test('변이 M8: 새로고침의 과제 목록 바꾸기를 빼면 새 과제가 목록에 나오지 않는다', () => {
    const bad = mutate(app, 'ATE.p.source = p.source; ATE.p.projects = p.projects;', 'ATE.p.source = p.source;');
    const A = bootAttend(bad);
    try {
      openA(A);
      const p = payloadFrom(A.T, null, [{ id: 'c-e', name: '엡실론', color: '#123456', desc: '', createdAt: CA }]); p.refresh = true;
      A.ev('__attendWinOpen(' + JSON.stringify(p) + ')');
      A.$('#atAdd').click();
      assert.ok(!A.$('#atAddList [data-addname="엡실론"]'), '변이가 경로에 닿지 않았다');
    } finally { A.close(); }
  });
}
