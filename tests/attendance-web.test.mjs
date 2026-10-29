// 근태 탭과 근태 보고 창(docs/ATTENDANCE-PLAN.md, 2026-10-29), §5 웹 시험.
//
// 이 파일이 지키는 것:
//   (S) 정적: 근태 창 허용 목록(ATTENDWIN_CMD)이 여섯(attendWinReady, attendNav, reportDailyList, netcusSubmit, attendSourceReq, netcusWeekMerge)이고
//       hpost 가 그 밖을 버린다(attendSourcePush 는 메인 창만).
//       'tw:' 번호 머리, SUBWIN 에 근태 창이 들어간다, 탭 줄에 근태 탭이 있다, UI 문구에 금지 기호가 없다.
//   (U) 순수: 근태 표시 문구(야근(+2시간)), 머리 줄 시간 읽기(두 형식, 0 초과 24 이하), 같은 이름 더하기, 상태 줄.
//   (B) jsdom 브라우저(HOST=false): 탭 세 값과 기억, payload 로 초안 만들기(옵션 넷), 근태에 미기록 없음(기본 정근), 불러오기는 묻지 않고 바꾼다,
//       가져오기(다른 날짜 캘린더는 그 자리에서, 근태관리는 위젯 전용 안내), 보기 화면([수정], ← 근태 달력, Esc), 임시 저장(쓰기, 되살리기, 버리기,
//       14일 정리), 화면 전환과 떠날 때 확인(탭 이동, ← 근태 달력, Esc), 브라우저 보내기는 잠그지 않고 임시 저장도 지우지 않는다.
//   (W) jsdom 위젯 메인 창: 근태 달력 그리기(목록 회신 흉내, 근태 표시, 글, 작성 중, 요약, 미보고 표시 없음), 날짜를 누르면 attendOpen
//       payload(§3.3, saved.sentAt), __attendNavFromWin, __attendSourceFor 가 attendSourcePush 로 같은 source 를 보낸다,
//       __reportDailySaved 가 개인 캘린더 근태를 고친다, 보고서 창은 자기가 보내지 않은 회신에 반응하지 않는다.
//   (A) jsdom 근태 창(?win=attend): 내 달력을 부팅하지 않는다(준비 알림 하나), 봉인, 보고한 날은 보기 화면([수정]), 가져오기 캘린더(attendSourceReq 와
//       __attendSource 중계), 가져오기 근태관리(netcusWeekMerge 회신을 머리 줄로 나누기, 오류와 빈 날), 보내기 payload(&nbsp;, hours, 고른 근태 코드),
//       처리 중 잠금과 연속 클릭(한 번만), 성공이면 임시 저장을 지우고 창은 닫지 않고 보기 화면, 실패면 공통 안내와 함께 남긴다, 닫기 지키기(__winCloseRequest).
//   (M) 변이: 봉인 빼기, 성공 시 임시 저장 지우기 빼기, 닫기 전 확인 빼기, 성공 뒤 보기 화면 빼기, 보기 화면의 고침 없음 빼기, 다른 날짜 회신 거르기 빼기를 같은 검사가 잡는다.
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
const ATTEND_CMDS = ['attendNav', 'attendSourceReq', 'attendWinReady', 'netcusSubmit', 'netcusWeekMerge', 'reportDailyList'];
function webAttendSet(src) {
  const m = /const ATTENDWIN_CMD = new Set\(\[([\s\S]*?)\]\);/.exec(src);
  assert.ok(m, 'ATTENDWIN_CMD 를 찾지 못했다');
  return [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
}
test('(S) 근태 창 허용 목록은 여섯이고, hpost 가 그 밖을 버린다, 번호 머리 tw:, SUBWIN 에 든다', () => {
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

  // ── (U) 순수 ────────────────────────────────────────────────────────
  test('(U) 근태 표시 문구와 머리 줄 시간 읽기(두 형식, 범위, 같은 이름 더하기), 상태 줄', () => {
    const X = bootBrowser();
    try {
      assert.strictEqual(X.ev("atStatusLabel('2', 2)"), '야근(+2시간)');
      assert.strictEqual(X.ev("atStatusLabel('1', 0)"), '정근');
      assert.strictEqual(X.ev("atStatusLabel('12', '3')"), '반차(+3시간)');
      assert.strictEqual(X.ev("atStatusLabel(null, 0)"), '');
      const h = (t) => X.evJSON(`atHoursOf(${JSON.stringify(t)})`);
      assert.deepStrictEqual(h('[알파] : 5\n- 일\n[베타] 3\n[감마]：1.5\n[델타]\n[기타] : 0\n[넘침] : 25\n[끝] : 24'),
        [{ name: '알파', hours: 5 }, { name: '베타', hours: 3 }, { name: '감마', hours: 1.5 }, { name: '끝', hours: 24 }]);
      assert.deepStrictEqual(h('[알파] : 2\n[알파] : 1.5'), [{ name: '알파', hours: 3.5 }], '같은 이름의 시간을 더하지 않았다');
      assert.deepStrictEqual(h('    [들여쓴] : 2\n문장 안의 [괄호] 3 은\n[ ] 1'), [{ name: '들여쓴', hours: 2 }], '머리 줄이 아닌 줄을 읽었다');
      assert.deepStrictEqual(X.evJSON("atTextStats('[알파] : 2\\n- 일\\n\\n[베타]')"), { lines: 4, heads: 2, hours: 2 });
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

  test('(B) 날짜를 누르면 화면이 보고 화면으로 바뀌고, 처음 글은 캘린더 기본 불러오기(머리 줄, 일간 서식, 기록 없는 과제 제외)', () => {
    const X = bootBrowser();
    try {
      X.ev("pcSetTab('attend')");
      X.$(`#atGrid .at-day[data-date="${X.T}"]`).click();
      assert.ok(shown(X, '#atEd') && !shown(X, '#atMonth'), '보고 화면으로 바뀌지 않았다');
      const t = X.$('#atText').value;
      const ref = X.ev(`(function(){ var rows = collectReportData(${JSON.stringify(X.T)}, ${JSON.stringify(X.T)}, {event:true,todo:true,desc:true}).rows;
        var hm = new Map(reportDailyHours(rows, ${JSON.stringify(X.T)}).map(function(x){ return [x.key, x.hours]; }));
        return rows.filter(function(r){ return r.titles.length || hm.has(r.key); }).map(function(r){ var b = reportRowBodyText(r, ' ', reportMarkerSpec(), 2); return reportRowHead(r, hm) + (b ? '\\n' + b : ''); }).join('\\n\\n'); })()`);
      assert.strictEqual(t, ref, '처음 글이 기존 보고서 함수로 만든 글과 다르다');
      assert.ok(t.startsWith('[알파] : 2\n') && t.includes('[베타]') && t.includes('[감마] : 1') && !t.includes('[델타]'));
      assert.strictEqual(X.$('#atStatus').value, '6', '근태 기본값이 그날 개인 캘린더 근태(휴가)가 아니다');
      assert.ok(!X.$('#atPv'), '회사 달력 표시 미리 보기가 남아 있다');
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#atStatus option'), function(o){ return o.value; })"), X.evJSON('ATTEND_STATUS.map(function(s){ return s.v; })'), '근태 목록에 미기록(빈 값)이 있거나 목록이 다르다');
      assert.strictEqual(X.ev("ATE.mode"), 'edit');
      assert.strictEqual(X.$('#atLines').textContent, t.split('\n').length + '줄');
      assert.ok(X.$('#atHours').textContent.includes('과제 3개') && X.$('#atHours').textContent.includes('3시간'));
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 옵션 넷(일정, 할 일, 기록 없는 과제 제외, 설명 포함)은 패널만 바꾸고, 불러오기를 눌러야 왼쪽이 바뀐다', () => {
    const X = bootBrowser();
    try {
      openB(X);
      const t0 = X.$('#atText').value;
      const click = (id) => { const c = X.$('#' + id); c.checked = !c.checked; c.dispatchEvent(new X.w.Event('change', { bubbles: true })); };
      const loadNow = () => { X.$('#atLoad').click(); return X.$('#atText').value; };
      click('atODesc');
      assert.strictEqual(X.$('#atText').value, t0, '옵션이 왼쪽을 바로 바꿨다');
      let t = loadNow();
      assert.ok(!t.includes('UI 확인') && !t.includes('세부 메모') && t.includes('로그인 화면 리뷰'), '설명 포함을 끄고 불러왔는데 설명이 남았다');
      click('atODesc'); click('atOEvent');
      t = loadNow();
      assert.ok(!t.includes('로그인 화면 리뷰') && t.includes('보고서 정리') && !t.includes('[베타]'), '일정을 끄면 일정과 일정만 있던 과제가 빠져야 한다: ' + t);
      click('atOEvent'); click('atOTodo');
      t = loadNow();
      assert.ok(t.includes('로그인 화면 리뷰') && !t.includes('보고서 정리') && t.includes('[베타]'));
      click('atOTodo'); click('atOSkip');
      t = loadNow();
      assert.ok(t.includes('[델타]'), '기록 없는 과제 제외를 끄면 내 과제가 모두 나와야 한다');
      assert.strictEqual(X.$('#atPick').textContent, '과제 4 / 4개 선택');
      //  카드 체크 해제 → 그 과제는 빠진다. 전체 해제 → 불러오기 꺼짐
      const cb = X.$('#atCards input[data-atid="c:c-b"]'); cb.checked = false; cb.dispatchEvent(new X.w.Event('change', { bubbles: true }));
      t = loadNow();
      assert.ok(!t.includes('[베타]') && t.includes('[알파]'));
      X.$('#atNone').click();
      assert.strictEqual(X.$('#atLoad').disabled, true, '고른 과제가 없는데 불러오기가 켜져 있다');
      X.$('#atAll').click();
      assert.strictEqual(X.$('#atPick').textContent, '과제 4 / 4개 선택');
    } finally { X.close(); }
  });

  test('(B) 불러오기는 묻지 않고 왼쪽을 바로 바꾼다(덮어쓰기 확인 없음), 근태 미기록 없음(저장 값이 없으면 정근)', () => {
    const X = bootBrowser();
    try {
      openB(X);
      const t0 = X.$('#atText').value;
      assert.ok(!X.$('#atConfirm') && !X.$('#atCfYes'), '덮어쓰기 확인 UI 가 남아 있다');
      input(X, '#atText', t0 + '\n직접 쓴 줄');
      X.$('#atLoad').click();
      assert.strictEqual(X.$('#atText').value, t0, '고친 뒤 불러오기가 왼쪽을 바로 바꾸지 않았다');
      //  그날 개인 캘린더 근태가 없으면 정근
      X.ev(`delete state.attendance[${JSON.stringify(X.T)}]`);
      X.ev(`atShowEditor(atBuildPayload(addDays(todayYmd(), 5), null, false))`);
      assert.strictEqual(X.$('#atStatus').value, '1', '기본 근태가 정근이 아니다');
    } finally { X.close(); }
  });

  test('(B) 가져오기: 아무 날짜나 고르면 그날 캘린더 기록(그 자리에서 만든다), 근태관리는 위젯 전용 안내, 날짜를 넘기면 보는 날짜로 돌아간다', () => {
    const X = bootBrowser();
    try {
      const Y = X.ev('addDays(todayYmd(), -1)');
      X.ev(`state.entries.push(${JSON.stringify(E({ id: 'e-y1', date: Y, title: '어제 일', categoryId: 'c-d' }))});`);
      openB(X);
      assert.strictEqual(X.$('#atEd h3').textContent, '가져오기');
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('[data-atsrc]'), function(b){ return b.dataset.atsrc + ':' + b.textContent; })"), ['cal:캘린더', 'net:근태관리']);
      assert.strictEqual(X.$('#atSrcDate').value, X.T, '가져올 날짜의 처음 값이 보는 날짜가 아니다');
      const sd = X.$('#atSrcDate'); sd.value = Y; sd.dispatchEvent(new X.w.Event('change', { bubbles: true }));
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#atCards .at-cnm'), function(x){ return x.textContent; })"), ['[델타]'], '고른 날짜의 캘린더 기록이 아니다');
      X.$('#atLoad').click();
      const ty = X.$('#atText').value;
      assert.ok(ty.startsWith('[델타]') && ty.includes('어제 일') && !ty.includes('[알파]'), '고른 날짜의 글로 바뀌지 않았다: ' + ty);
      assert.strictEqual(X.ev('ATE.date'), X.T, '가져오기가 보는 날짜를 바꿨다');
      X.$('[data-atsrc="net"]').click();
      assert.ok(X.$('#atCards').textContent.includes('위젯에서만'), '브라우저에서 근태관리 안내가 없다');
      assert.ok(shown(X, '#atOpts') === false, '근태관리인데 캘린더 옵션이 보인다');
      X.$('#atNext').click();
      assert.strictEqual(X.ev('ATE.srcDate'), X.ev('ATE.date'), '날짜를 넘겼는데 가져올 날짜가 보는 날짜로 돌아가지 않았다');
      assert.strictEqual(X.ev('ATE.src'), 'cal');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 보기 화면: 보고한 날은 읽기 전용으로 먼저 연다(근태, 내용, 보낸 시각), [수정]은 보고한 글로 쓰기, 보기는 고친 것이 아니다(Esc 와 ← 근태 달력)', () => {
    const X = bootBrowser();
    try {
      X.ev("pcSetTab('attend')");
      const sv = { status: '2', overtime: 3, content: '[알파] : 5\n&nbsp;&nbsp;- 납품 준비\n', sentAt: '2026-10-29T09:05:00.000Z' };
      X.ev(`atShowEditor(atBuildPayload(${JSON.stringify(X.T)}, ${JSON.stringify(sv)}, false))`);
      assert.strictEqual(X.ev('ATE.mode'), 'view');
      assert.ok(shown(X, '#atVw') && !shown(X, '#atEdBody') && !shown(X, '#atSend') && !shown(X, '#atCopy') && shown(X, '#atVwEdit') && shown(X, '#atVwClose'), '보기 화면이 아니다');
      assert.ok(shown(X, '#atBack'), '브라우저 보기 화면에 ← 근태 달력이 없다');
      assert.strictEqual(X.$('#atEdTitle').textContent, '근태 보기');
      assert.strictEqual(X.$('#atVwStatus').textContent, '야근(+3시간)');
      assert.strictEqual(X.$('#atVwText').textContent, '[알파] : 5\n  - 납품 준비');
      assert.strictEqual(X.$('#atVwSent').textContent, X.ev(`atSentLabel(${JSON.stringify(sv.sentAt)})`));
      assert.ok(/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(X.$('#atVwSent').textContent));
      assert.ok(X.$('#atEdDate').textContent.endsWith(', 보고함'));
      assert.strictEqual(X.ev('atDirty()'), false);
      //  [수정] → 쓰기 화면, 보고한 글과 근태
      X.$('#atVwEdit').click();
      assert.strictEqual(X.ev('ATE.mode'), 'edit');
      assert.ok(shown(X, '#atEdBody') && !shown(X, '#atVw') && shown(X, '#atSend') && shown(X, '#atPanel'));
      assert.strictEqual(X.$('#atText').value, '[알파] : 5\n  - 납품 준비');
      assert.strictEqual(X.$('#atStatus').value, '2'); assert.strictEqual(X.$('#atOt').value, '3');
      assert.strictEqual(X.ev('atDirty()'), false, '[수정]만 눌렀는데 고친 것으로 본다');
      //  보기 화면에서 Esc 는 달력으로(고친 것이 없다)
      X.ev(`atShowEditor(atBuildPayload(addDays(todayYmd(), 9), ${JSON.stringify(sv)}, false))`);
      assert.strictEqual(X.ev('ATE.mode'), 'view');
      esc(X);
      assert.ok(!shown(X, '#atEd') && shown(X, '#atMonth'), '보기 화면에서 Esc 로 달력에 돌아가지 않았다');
      //  ← 근태 달력도 묻지 않는다
      X.ev(`atShowEditor(atBuildPayload(addDays(todayYmd(), 9), ${JSON.stringify(sv)}, false))`);
      X.$('#atBack').click();
      assert.ok(!shown(X, '#atAsk') && shown(X, '#atMonth'), '보기 화면에서 ← 근태 달력이 물었다');
      //  임시 저장이 있으면 쓰기 화면과 되살림 안내로 연다
      const D9 = X.ev('addDays(todayYmd(), 9)');
      X.ev(`localStorage.setItem('tc_attDraft:me:${D9}', JSON.stringify({ v:1, text:'쓰던 글', status:'2', overtime:0, savedAt:'' }))`);
      X.ev(`atShowEditor(atBuildPayload(${JSON.stringify(D9)}, ${JSON.stringify(sv)}, false))`);
      assert.strictEqual(X.ev('ATE.mode'), 'edit', '임시 저장이 있는데 보기 화면으로 열었다');
      assert.ok(shown(X, '#atRestore') && X.$('#atText').value === '쓰던 글');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 임시 저장: 1초 뒤 쓰기, 다시 열면 되살리기(안내), 버리고 처음 상태로, 처음 상태와 같아지면 지움', async () => {
    const X = bootBrowser();
    try {
      openB(X);
      const t0 = X.$('#atText').value;
      input(X, '#atText', t0 + '\n임시 줄');
      assert.strictEqual(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`), null, '1초 전에 썼다');
      await tick(1100);
      const d = JSON.parse(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`));
      assert.strictEqual(d.v, 1); assert.ok(d.text.endsWith('임시 줄')); assert.strictEqual(d.status, '6'); assert.strictEqual(d.overtime, 0); assert.ok(d.savedAt);
      assert.ok(X.$('#atSaved').textContent.startsWith('이 PC에 임시 저장됨 '));
      //  닫고 다시 열기(묻는 창 [닫기]) → 되살리기
      X.$('#atClose').click();
      assert.ok(shown(X, '#atAsk'), '고친 내용이 있는데 닫기가 묻지 않았다');
      X.$('#atAskClose').click();
      assert.ok(shown(X, '#atMonth') && !shown(X, '#atEd'));
      assert.ok(X.$(`#atGrid .at-day[data-date="${X.T}"] .at-drf`), '달력에 작성 중 표시가 없다');
      X.ev(`atOpen(${JSON.stringify(X.T)})`);
      assert.ok(X.$('#atText').value.endsWith('임시 줄'), '임시 저장이 되살아나지 않았다');
      assert.ok(shown(X, '#atRestore') && X.$('#atRestoreMsg').textContent.includes('임시 저장된 글을 이어서 엽니다'));
      X.$('#atDiscard').click();
      assert.strictEqual(X.$('#atText').value, t0);
      assert.ok(!shown(X, '#atRestore'));
      assert.strictEqual(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`), null, '버렸는데 임시 저장이 남았다');
      //  고쳤다가 처음과 같게 되돌리면 지운다
      input(X, '#atText', t0 + 'x'); X.ev('atDraftFlushNow()');
      assert.ok(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`));
      input(X, '#atText', t0);
      assert.strictEqual(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`), null, '처음 상태로 돌아왔는데 임시 저장이 남았다');
    } finally { X.close(); }
  });

  test('(B) 임시 저장 14일 정리: 이 계정의 14일 지난 키만 지운다(14일째와 다른 계정, 날짜 꼴 아닌 키는 남는다)', () => {
    const X = bootBrowser();
    try {
      const v = JSON.stringify({ v: 1, text: 'x', status: '', overtime: 0, savedAt: '' });
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
      input(X, '#atText', '[알파] : 3\n- 고친 글');
      //  Esc: 닫지 않는다
      esc(X);
      assert.ok(shown(X, '#atEd') && !shown(X, '#atAsk'), 'Esc 가 고친 글이 있는 보고 화면을 닫았다');
      //  탭 이동: 묻는다 → 계속 쓰기
      X.$('#pcTabPersonal').click();
      assert.ok(shown(X, '#atAsk'), '탭 이동이 묻지 않았다');
      assert.strictEqual(X.ev('PCAL.tab'), 'attend');
      X.$('#atAskStay').click();
      assert.ok(!shown(X, '#atAsk') && X.$('#atText').value.includes('고친 글'));
      //  ← 근태 달력: 묻는다 → 바깥 누름은 계속 쓰기
      X.$('#atBack').click();
      assert.ok(shown(X, '#atAsk'));
      X.$('#atAsk').dispatchEvent(new X.w.MouseEvent('click', { bubbles: true }));
      assert.ok(!shown(X, '#atAsk') && shown(X, '#atEd'), '바깥을 누르면 계속 쓰기여야 한다');
      //  Esc 로 묻는 창 닫기 = 계속 쓰기
      X.$('#atX').click(); assert.ok(shown(X, '#atAsk'));
      esc(X);
      assert.ok(!shown(X, '#atAsk') && shown(X, '#atEd'));
      //  탭 이동 → [닫기]: 임시 저장을 쓰고 개인 탭으로
      X.$('#pcTabPersonal').click(); X.$('#atAskClose').click();
      assert.strictEqual(X.ev('PCAL.tab'), 'personal');
      assert.ok(X.ev(`localStorage.getItem(${JSON.stringify(KEYB(X))})`).includes('고친 글'), '닫으며 임시 저장을 쓰지 않았다');
      //  고친 것이 없으면 Esc 로 달력으로 돌아간다
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
      input(X, '#atText', '[알파] : 2\n  - 들여쓴 줄');
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
      assert.ok(X.$('#atText').value.includes('들여쓴 줄'), '돌아왔는데 쓰던 글이 없다');
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
  function payloadFrom(T, saved) {
    const B = bootBrowser();
    try {
      B.ev("__bootMeta = { userId: 7 }; currentUser = { loginId: 'tester', name: '시험자' };");
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
      A.ev("hpost({ cmd:'saveState' }); hpost({ cmd:'ready' }); hpost({ cmd:'attendOpen' }); hpost({ cmd:'reportDailyList', reqId:'x' })");
      assert.deepStrictEqual(A.posted.slice(n).map((m) => m.cmd), ['reportDailyList'], '봉인 밖 명령이 나갔다');
      A.ev("hostRequest('reportDailyList', { from:'2026-01-01', to:'2026-01-02' })");
      assert.ok(/^tw:[a-z0-9]+:reportDailyList-\d+$/.test(A.posted[A.posted.length - 1].reqId), "회신 번호가 'tw:' 로 시작하지 않는다");
      openA(A);
      assert.strictEqual(A.$('#atSend').disabled, false);
      assert.ok(A.$('#atText').value.startsWith('[알파] : 2'));
      assert.ok(A.doc.title.startsWith('근태 보고 '));
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  test('(A) 보고한 날은 보기 화면으로 열고, [수정]이면 보고한 글(&nbsp; 를 공백으로)과 근태, 같은 날짜 새로고침은 왼쪽 글을 건드리지 않는다', () => {
    const A = bootAttend();
    try {
      openA(A, { status: '2', overtime: 2, content: '[알파] : 5\n&nbsp;&nbsp;- 납품 준비\n', sentAt: '2026-10-29T09:00:00.000Z' });
      assert.strictEqual(A.ev('ATE.mode'), 'view', '보고한 날인데 보기 화면이 아니다');
      assert.ok(shown(A, '#atVw') && !shown(A, '#atEdBody') && shown(A, '#atVwEdit') && shown(A, '#atVwClose') && !shown(A, '#atSend'));
      assert.strictEqual(A.$('#atVwStatus').textContent, '야근(+2시간)');
      assert.strictEqual(A.$('#atVwText').textContent, '[알파] : 5\n  - 납품 준비');
      assert.strictEqual(A.ev('__winCloseRequest()'), 'close', '보기 화면인데 닫기를 막았다');
      //  보기 화면에서도 ‹ › 는 메인 창에 날짜를 청한다
      A.$('#atNext').click();
      assert.deepStrictEqual(A.posted[A.posted.length - 1], { cmd: 'attendNav', date: A.ev('addDays(todayYmd(), 1)'), refresh: false });
      A.ev('ATE.navPending = ""; atSyncNav(); atMsg("")');
      A.$('#atVwEdit').click();
      assert.strictEqual(A.ev('ATE.mode'), 'edit');
      assert.strictEqual(A.$('#atText').value, '[알파] : 5\n  - 납품 준비');
      assert.strictEqual(A.$('#atStatus').value, '2'); assert.strictEqual(A.$('#atOt').value, '2');
      assert.ok(A.$('#atEdDate').textContent.endsWith(', 보고함'));
      input(A, '#atText', '고치는 중');
      const p = payloadFrom(A.T, { status: '2', overtime: 2, content: '[알파] : 5' }); p.refresh = true; p.source.rows = p.source.rows.slice(0, 1);
      A.ev('__attendWinOpen(' + JSON.stringify(p) + ')');
      assert.strictEqual(A.$('#atText').value, '고치는 중', '새로고침이 왼쪽 글을 바꿨다');
      assert.strictEqual(A.ev('ATE.mode'), 'edit', '새로고침이 보기 화면으로 되돌렸다');
      assert.strictEqual(A.ev('ATE.p.source.rows.length'), 1, '새로고침이 패널 출처를 바꾸지 않았다');
      //  창이 앞으로 오면 attendNav refresh 를 청한다
      A.ev('__attendWinActivated()');
      assert.deepStrictEqual(A.posted[A.posted.length - 1], { cmd: 'attendNav', date: A.T, refresh: true });
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
    //  청하지 않은 날짜의 회신은 버린다
    const src = payloadFrom(A.T).source; src.rows = src.rows.slice(1, 2); src.hours = {};
    A.ev('__attendSource(' + JSON.stringify({ date: Z, source: src }) + '); atPanelRender()');
    assert.ok(A.$('#atCards').textContent.includes('가져오는 중'), '청하지 않은 날짜의 회신을 받았다');
    A.ev('__attendSource(' + JSON.stringify({ date: Y, source: src }) + ')');
    assert.deepStrictEqual(A.evJSON("[].map.call(document.querySelectorAll('#atCards .at-cnm'), function(x){ return x.textContent; })"), ['[베타]'], '중계로 받은 기록이 카드가 아니다');
    input(A, '#atText', '고친 글');
    A.$('#atLoad').click();
    assert.ok(A.$('#atText').value.startsWith('[베타]') && A.$('#atText').value.includes('고객 회신'), '불러오기가 묻지 않고 바꾸지 않았다');
    assert.strictEqual(A.ev('ATE.date'), A.T);
  }
  test('(A) 가져오기 캘린더: 다른 날짜는 attendSourceReq 로 메인 창에 청하고 __attendSource 회신(그 날짜만)으로 카드, 불러오기는 바로 바꾼다', () => {
    const A = bootAttend();
    try { calRelay(A); assert.deepStrictEqual(A.errors, []); } finally { A.close(); }
  });

  test('(A) 가져오기 근태관리: netcusWeekMerge(그날 하루)로 읽어 머리 줄로 나누고, 오류와 빈 날은 안내, 읽는 동안 보내기 잠금', async () => {
    const A = bootAttend();
    try {
      const Y = A.ev('addDays(todayYmd(), -1)');
      stubHost(A, `{ netcusWeekMerge: function(p){ return window.__netReply(p); } }`);
      A.ev(`window.__netReply = function(p){ return { ok: true, error: '', days: [{ date: p.from, ok: true,
        content: '머리 앞 글\\n[베타] : 6\\n\\u00a0\\u00a0- 연동 환경\\n&nbsp;&nbsp;&nbsp;&nbsp;- 세부\\n\\n[기타] 2\\n- 회의' }] }; }`);
      openA(A);
      const sd = A.$('#atSrcDate'); sd.value = Y; sd.dispatchEvent(new A.w.Event('change', { bubbles: true }));
      A.$('[data-atsrc="net"]').click();
      assert.ok(A.$('#atCards').textContent.includes('읽는 중'), '읽는 중 안내가 없다');
      assert.strictEqual(A.$('#atSend').disabled, true, '근태관리를 읽는 동안 보내기가 켜져 있다');
      await tick();
      const calls = A.evJSON("__calls.filter(function(c){ return c[0] === 'netcusWeekMerge'; })");
      assert.deepStrictEqual(calls.map((c) => c[1]), [{ from: Y, to: Y }], '그날 하루로 읽지 않았다');
      assert.ok(!shown(A, '#atOpts'), '근태관리인데 캘린더 옵션이 보인다');
      assert.deepStrictEqual(A.evJSON("[].map.call(document.querySelectorAll('#atCards .at-cnm'), function(x){ return x.textContent; })"), ['머리 줄 없는 글', '[베타]', '[기타]']);
      assert.strictEqual(A.$('#atPick').textContent, '과제 3 / 3개 선택');
      assert.strictEqual(A.$('#atSend').disabled, false);
      const cb = A.$('#atCards input[data-atid="n:0"]'); cb.checked = false; cb.dispatchEvent(new A.w.Event('change', { bubbles: true }));
      input(A, '#atText', '고친 글');
      A.$('#atLoad').click();
      assert.strictEqual(A.$('#atText').value, '[베타] : 6\n  - 연동 환경\n    - 세부\n\n[기타] 2\n- 회의', '근태관리 글을 그대로(공백 되돌림) 채우지 않았다');
      //  다시 고르면 다시 읽지 않는다(같은 날짜)
      A.$('[data-atsrc="cal"]').click(); A.$('[data-atsrc="net"]').click(); await tick();
      assert.strictEqual(A.evJSON("__calls.filter(function(c){ return c[0] === 'netcusWeekMerge'; })").length, 1, '같은 날짜를 다시 읽었다');
      //  빈 날
      A.ev(`window.__netReply = function(p){ return { ok: true, error: '', days: [{ date: p.from, ok: true, content: '' }] }; }`);
      const Z = A.ev('addDays(todayYmd(), -2)');
      sd.value = Z; sd.dispatchEvent(new A.w.Event('change', { bubbles: true })); await tick();
      assert.ok(A.$('#atCards').textContent.includes('등록된 보고가 없습니다'), '빈 날 안내가 없다');
      assert.strictEqual(A.$('#atLoad').disabled, true);
      //  오류(로그인), 다시 읽기
      A.ev(`window.__netReply = function(p){ return { ok: false, error: 'login', days: [] }; }`);
      const W = A.ev('addDays(todayYmd(), -3)');
      sd.value = W; sd.dispatchEvent(new A.w.Event('change', { bubbles: true })); await tick();
      assert.ok(A.$('#atCards').textContent.includes('로그인에 실패'), '오류 안내가 없다: ' + A.$('#atCards').textContent);
      A.ev(`window.__netReply = function(p){ return { ok: true, error: '', days: [{ date: p.from, ok: true, content: '[감마] : 1' }] }; }`);
      A.$('#atCards [data-atretry]').click(); await tick();
      assert.deepStrictEqual(A.evJSON("[].map.call(document.querySelectorAll('#atCards .at-cnm'), function(x){ return x.textContent; })"), ['[감마]'], '다시 읽기가 되지 않았다');
      assert.ok(!A.posted.some((m) => m.cmd === 'netcusSubmit'), '읽기가 회사 보고를 보냈다');
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  //  보내기 + 회신. 변이 시험이 재사용한다.
  function sendFlow(A) {
    openA(A);
    assert.ok(!A.evJSON("[].map.call(document.querySelectorAll('#atStatus option'), function(o){ return o.value; })").includes(''), '근태 목록에 미기록이 있다');
    input(A, '#atStatus', '2');
    input(A, '#atOt', '2');
    input(A, '#atText', '\n[알파] : 5\n    - 납품 준비\n\t- 탭 줄\n[베타] 3\n[범위 밖] : 30\n[없음]\n\n');
    A.$('#atSend').click(); A.$('#atSend').click();   // 연속 클릭
    const sub = A.posted.filter((m) => m.cmd === 'netcusSubmit');
    assert.strictEqual(sub.length, 1, '연속 클릭에 두 번 보냈다');
    return sub[0];
  }
  test('(A) 보내기 payload: 줄 앞 공백은 &nbsp;, hours 는 머리 줄(두 형식, 범위), 고른 근태 코드(null 없음), 처리 중 잠금, 보내기 직전 임시 저장', () => {
    const A = bootAttend();
    try {
      const s = sendFlow(A);
      const NB = '&nbsp;';
      assert.strictEqual(s.content, '[알파] : 5\n' + NB.repeat(4) + '- 납품 준비\n' + NB.repeat(4) + '- 탭 줄\n[베타] 3\n[범위 밖] : 30\n[없음]');
      assert.deepStrictEqual(s.hours, [{ name: '알파', hours: 5 }, { name: '베타', hours: 3 }]);
      assert.strictEqual(s.status, '2', '고른 근태 코드가 아니다(이 화면은 null 을 보내지 않는다)');
      assert.strictEqual(s.overtime, 2);
      assert.deepStrictEqual([s.y, s.m, s.d], A.T.split('-').map(Number));
      assert.strictEqual(s.dryRun, false);
      for (const sel of ['#atText', '#atStatus', '#atOt', '#atSend', '#atClose', '#atLoad', '#atPrev']) assert.strictEqual(A.$(sel).disabled, true, sel + ' 가 처리 중에 잠기지 않았다');
      assert.strictEqual(A.$('#atSend').textContent, '회사에 보고하는 중…');
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
    assert.strictEqual(A.w.__closeCalls, 0, '성공했는데 창을 닫았다(보기 화면으로 바꿔야 한다)');
    assert.strictEqual(A.ev('ATE.mode'), 'view', '성공 뒤 보기 화면이 아니다');
    assert.ok(shown(A, '#atVw') && !shown(A, '#atEdBody') && shown(A, '#atVwEdit') && shown(A, '#atVwClose'), '성공 뒤 보기 화면이 보이지 않는다');
    assert.strictEqual(A.$('#atVwStatus').textContent, '야근(+2시간)');
    assert.strictEqual(A.$('#atVwText').textContent, '[알파] : 5\n    - 납품 준비\n    - 탭 줄\n[베타] 3\n[범위 밖] : 30\n[없음]');
    assert.ok(/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(A.$('#atVwSent').textContent), '보낸 시각이 없다');
    assert.strictEqual(A.$('#atMsg').textContent, '회사 일간보고 전송 완료');
    assert.ok(A.$('#atEdDate').textContent.endsWith(', 보고함'));
    assert.strictEqual(A.ev('__winCloseRequest()'), 'close', '보기 화면인데 닫기를 막았다');
    //  [수정]: 보낸 글과 근태로 쓰기 화면
    A.$('#atVwEdit').click();
    assert.strictEqual(A.ev('ATE.mode'), 'edit');
    assert.ok(A.$('#atText').value.startsWith('[알파] : 5\n    - 납품 준비'));
    assert.strictEqual(A.$('#atStatus').value, '2'); assert.strictEqual(A.$('#atOt').value, '2');
    assert.strictEqual(A.ev('atDirty()'), false);
  }
  test('(A) 성공 회신: 임시 저장을 지우고 창은 닫지 않고 그날 보기 화면, [수정]은 보낸 글로 쓰기', () => {
    const A = bootAttend();
    try { successClears(A); } finally { A.close(); }
  });
  test('(A) 실패 회신: 공통 안내, 잠금 풀림, 임시 저장과 글 유지, 자기가 보내지 않은 회신은 무시', () => {
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
      assert.strictEqual(A.$('#atSend').disabled, false); assert.strictEqual(A.$('#atText').disabled, false);
      assert.ok(A.$('#atText').value.includes('납품 준비'));
      assert.ok(A.ev(`localStorage.getItem(${JSON.stringify(A.KEY)})`), '실패했는데 임시 저장이 지워졌다');
      assert.strictEqual(A.w.__closeCalls, 0);
      A.ev("__netcusResult(true, '다음 회신')");
      assert.strictEqual(A.w.__closeCalls, 0, '이미 받은 뒤의 회신에 창을 닫았다');
    } finally { A.close(); }
  });

  function closeGuard(A) {
    openA(A);
    assert.strictEqual(A.ev('__winCloseRequest()'), 'close', '고친 것이 없는데 닫기를 막았다');
    input(A, '#atText', '[알파] : 1\n- 고친 글');
    assert.strictEqual(A.ev('__winCloseRequest()'), 'ask', '고친 글이 있는데 묻지 않았다');
    assert.ok(shown(A, '#atAsk'));
    assert.strictEqual(A.ev('__winCloseRequest()'), 'ask', '묻는 중에 다시 누르면 기다려야 한다');
    A.$('#atAskStay').click();
    assert.strictEqual(A.w.__closeCalls, 0);
    esc(A);
    assert.strictEqual(A.w.__closeCalls, 0, 'Esc 가 근태 창을 닫았다');
    A.$('#atClose').click();
    assert.ok(shown(A, '#atAsk'), '닫기 단추가 묻지 않았다');
    A.$('#atAskClose').click();
    assert.strictEqual(A.w.__closeCalls, 1, '[닫기]가 창을 닫지 않았다');
    assert.ok(A.ev(`localStorage.getItem(${JSON.stringify(A.KEY)})`).includes('고친 글'), '닫으며 임시 저장을 쓰지 않았다');
  }
  test('(A) 닫기 지키기: __winCloseRequest 는 close / ask / busy, 계속 쓰기, Esc 로는 닫지 않음, [닫기]는 임시 저장 뒤 창 닫기', () => {
    const A = bootAttend();
    try { closeGuard(A); } finally { A.close(); }
  });

  test('(A) ‹ › 는 임시 저장을 쓰고 메인 창에 그 날짜를 청한다(attendNav), 다른 날짜 payload 가 오면 그 날짜로 연다', () => {
    const A = bootAttend();
    try {
      openA(A);
      input(A, '#atText', '넘기기 전 글');
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
  test('변이 M4: 성공 뒤 보기 화면으로 바꾸기를 빼면 성공 검사가 잡는다', () => {
    const bad = mutate(app, "    atDateRender();" + NL + "    atSetMode('view');" + NL, "    atDateRender();" + NL);
    const A = bootAttend(bad);
    try { assert.throws(() => successClears(A), /보기 화면이 아니다/); } finally { A.close(); }
  });
  //  보기 화면은 고친 것이 아니다: 숨은 글 칸 값이 처음과 달라도 닫기는 묻지 않는다.
  function viewNotDirty(A) {
    openA(A, { status: '2', overtime: 2, content: '[알파] : 5', sentAt: '' });
    A.ev("document.getElementById('atText').value = '숨은 칸이 바뀜'");
    assert.strictEqual(A.ev('__winCloseRequest()'), 'close', '보기 화면인데 닫기를 막았다');
  }
  test('(A) 보기 화면은 고친 것으로 보지 않는다(닫기는 묻지 않는다)', () => {
    const A = bootAttend();
    try { viewNotDirty(A); } finally { A.close(); }
  });
  test('변이 M5: atDirty 에서 보기 화면 빼기를 없애면 보기 닫기 검사가 잡는다', () => {
    const bad = mutate(app, "  if(!ATE.p || !ATE.base || ATE.mode === 'view') return false;", '  if(!ATE.p || !ATE.base) return false;');
    const A = bootAttend(bad);
    try { assert.throws(() => viewNotDirty(A), /보기 화면인데 닫기를 막았다/); } finally { A.close(); }
  });
  test('변이 M6: 가져오기 회신의 날짜 거르기를 빼면 중계 검사가 잡는다', () => {
    const bad = mutate(app, "  if(ATE.cal.date !== o.date) return;   // 그 사이 다른 날짜를 골랐다" + NL, '');
    const A = bootAttend(bad);
    try { assert.throws(() => calRelay(A), /청하지 않은 날짜의 회신을 받았다/); } finally { A.close(); }
  });
}
