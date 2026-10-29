// 근태 주간보고(docs/ATTENDANCE-PLAN.md §13, 결정 13, 2026-10-29) 웹 시험. §13.5 의 웹 항목.
//
// 이 파일이 지키는 것:
//   (S) 정적: 근태 창 허용 목록에 reportWeeklyList, netcusWeekSubmit 이 있다. 위젯 주간 전송은 회의내용(resultwork)을 실린 요청에만 붙인다
//       (보고서 창의 옛 요청은 그대로). 미리보기 색은 :root 의 --nf-* 토큰이다. 주간 화면 문구에 금지 기호가 없다.
//   (U) 순수: 진행사항, 차주계획 조립(빈 내용은 `-`, 블록 사이 빈 줄, 과제 미정은 빼기), 과제투입시간(진행사항을 따라감, `-----`, `합계 : n`),
//       제목 규칙 둘(달력에서 고른 달의 몇째 줄, 월요일이 든 달), 주 고르기 달력의 줄, 되살리기(`[과제명]` 머리, 캘린더에 없는 이름은 미정, `-` 는 빈 내용),
//       일간 모으기(같은 줄은 한 번, 시간 합계, 시간만 있는 과제, 과제 미정은 넣지 않음), 막는 규칙.
//   (B) jsdom 브라우저: [일간][주간] 전환과 기억, 목록(작성 중, 최근이 위, 번호), [작성]은 이번 주이고 화면 전환, 편집 네 칸,
//       과제투입시간이 진행사항을 따라감과 합계, 시간 칸 범위, 주 고르기 달력과 제목, 미리보기가 인트라넷 폼 모양이고 보낼 글과 같음,
//       막는 규칙(진행사항 없음, 과제 미정), 임시 저장(안내 없이 되살리기)과 [전체 초기화], [‹ 목록]과 묻기, 브라우저 보내기는 잠그지 않는다.
//       화면에 보이는 것을 되풀이하는 안내 글이 없다(2026-10-29 UI 검토): 목록 아래 안내 줄, 제목 기준 표시, 진행사항과 차주계획 수,
//       빈 블록 안내, 회의내용 (자유롭게), 미리보기 줄 수. 머리는 [‹ 목록] | 주간 보고 ‹ 제목 (기간) › 이고 [전체 초기화]는 기간, 제목 줄 끝.
//   (W) jsdom 위젯 메인 창: 목록이 reportWeeklyList 회신과 임시 저장을 합친다, 행과 [작성]은 attendOpen(kind 'week') 하나, __reportWeeklySaved 는 목록을 다시 읽는다.
//   (A) jsdom 근태 창: 주간 payload 는 주간 편집을 보이고 일간 화면을 숨긴다, 처음 여는 주는 두 가져오기(reportDailyList 그 주 7일, reportWeeklyList 지난주)로
//       채우고 그것이 처음 상태다, 완료한 주는 DB 기록으로 연다, 가져오기 단추, 보내기(netcusWeekSubmit 의 네 칸과 resultwork, &nbsp;, 잠금),
//       성공 회신 뒤 처음 상태, __reportWeeklySaved 가 보낸 모양의 임시 저장만 지운다, 창 안 목록과 ‹ ›, 닫기 지키기, 새로고침은 과제 목록만 바꾼다.
//   (M) 변이: 빈 내용 `-` 빼기, 과제투입시간이 진행사항을 따라가지 않게 하기, 진행사항 없음 막기 빼기, 임시 저장 지우기 조건 빼기를 같은 검사가 잡는다.
// ★ 회사 사이트에는 아무것도 보내지 않는다. chrome.webview.postMessage 와 hostRequest 를 가로채 보기만 한다.
// 생략 규약: jsdom 이 없으면 (U)(B)(W)(A)(M)은 등록되지 않고 skip(판정 없음)으로 계수된다.
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}

// ══ (S) 정적 ══════════════════════════════════════════════════════════
test('(S) 근태 창 허용 목록에 주간 기록 읽기와 주간 폼 채우기가 있다', () => {
  const m = /const ATTENDWIN_CMD = new Set\(\[([\s\S]*?)\]\);/.exec(app);
  assert.ok(m, 'ATTENDWIN_CMD 를 찾지 못했다');
  const set = [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
  for (const c of ['reportWeeklyList', 'netcusWeekSubmit']) assert.ok(set.includes(c), c + ' 가 근태 창 허용 목록에 없다');
  assert.ok(!set.includes('netcusWeekMerge'), 'netcusWeekMerge 가 되살아났다');
});
test('(S) 위젯 주간 전송은 resultwork 를 실린 요청에만 붙인다(보고서 창의 옛 요청은 그대로)', () => {
  const a = app.indexOf('const WidgetPlatform = {'), b = app.indexOf('const BrowserPlatform = {', a);
  const w = app.slice(a, b);
  assert.ok(/submitWeekly\(p\)\{ hpost\(Object\.assign\(\{ cmd: 'netcusWeekSubmit', sdate: p\.fields\.sdate, edate: p\.fields\.edate, subject: p\.fields\.subject, content: p\.fields\.content, endwork: p\.fields\.endwork, planwork: p\.fields\.planwork \}/.test(w), '주간 전송의 기본 칸이 바뀌었다');
  assert.ok(/typeof p\.fields\.resultwork === 'string' \? \{ resultwork: p\.fields\.resultwork \} : \{\}/.test(w), 'resultwork 를 실린 요청에만 붙이지 않는다');
});
test('(S) 미리보기 색은 :root 의 --nf-* 토큰이고(테마와 상관없이), 주간 화면 문구에 엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점이 없다', () => {
  const root = app.slice(app.indexOf(':root{'), app.indexOf('}', app.indexOf(':root{')));
  for (const t of ['--nf-paper', '--nf-ink', '--nf-edge', '--nf-th', '--nf-td', '--nf-box']) assert.ok(new RegExp(t + ':#[0-9a-f]{6};').test(root), t + ' 토큰이 :root 에 없다');
  assert.ok(/\.nf\{background:var\(--nf-paper\);color:var\(--nf-ink\)/.test(app), '.nf 가 토큰을 쓰지 않는다');
  const h0 = app.indexOf('<div class="at-ed aw-ed hidden" id="awEd"'), h1 = app.indexOf('id="awAskClose"', h0);
  const j0 = app.indexOf('/* ===== 근태 주간보고(docs/ATTENDANCE-PLAN.md §13, 결정 13'), j1 = app.indexOf('function awInit(){', j0);
  assert.ok(h0 > 0 && h1 > h0 && j0 > 0 && j1 > j0);
  for (const part of [app.slice(h0, h1), app.slice(j0, j1)]) {
    assert.ok(!/[—–「」]/.test(part), '금지 기호가 있다');
    assert.ok(!/(^|\s)·|·(\s|$)/m.test(part), '띄어 쓴 가운데 점이 있다');
  }
});

// ══ jsdom ═════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
if (!JSDOM) {
  skip('attendance-weekly-web: jsdom 미설치, 주간보고 화면 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  function boot(src, url, host) {
    const posted = [], errors = [];
    const vc = new jsdomMod.VirtualConsole();
    vc.on('jsdomError', (e) => { const s = String(e && (e.stack || e.message) || e); if (!/Not implemented/.test(s)) errors.push(s); });
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc,
      beforeParse(win) {
        if (host) win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); }, addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.open = () => null;   // 브라우저 보내기의 netcus 창 열기를 막는다(회사 사이트에 가지 않는다)
        win.__closeCalls = 0; win.__realClose = win.close;
        win.close = function () { win.__closeCalls++; };
      },
    });
    const w = dom.window;
    return { w, doc: w.document, posted, errors, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      $: (s) => w.document.querySelector(s), close: () => { try { w.__realClose.call(w); } catch (_) {} } };
  }
  const stubHost = (X, rep) => X.ev(`window.__calls = []; window.__rep = ${rep || '{}'};
    hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
      var r = __rep[cmd]; if(typeof r === 'function') r = r(p);
      return Promise.resolve(r === undefined ? { ok:false, error:'시험: 회신 없음' } : JSON.parse(JSON.stringify(r))); };`);
  const input = (X, sel, v) => { const e = X.$(sel); e.value = v; e.dispatchEvent(new X.w.Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  const blur = (X, sel) => X.$(sel).dispatchEvent(new X.w.FocusEvent('focusout', { bubbles: true }));
  const shown = (X, sel) => { const e = X.$(sel); return !!e && !e.classList.contains('hidden'); };
  const esc = (X) => X.doc.dispatchEvent(new X.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const clearDrafts = (X) => X.ev("(function(){ for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k && (k.indexOf('tc_attWDraft:')===0 || k.indexOf('tc_attDraft:')===0 || k==='tc_attKind')) localStorage.removeItem(k); } })()");

  const CA = '2026-07-01T00:00:00.000Z';
  const CATS = [
    { id: 'c-a', name: '알파', color: '#3e5be0', desc: '', createdAt: CA },
    { id: 'c-b', name: '베타', color: '#2e9e6b', desc: '', createdAt: CA },
    { id: 'c-c', name: '감마', color: '#d97706', desc: '', createdAt: CA },
    { id: 'c-d', name: '휴가', color: '#5b6b7d', desc: '', createdAt: CA },
  ];
  const NAMES = CATS.map((c) => c.name);
  const stateFor = () => ({ categories: CATS, entries: [], todos: [], rooms: [], attendance: {}, taskHours: {}, reportMarker: '-', reportMarkerCustom: '', reportIndent: 2 });
  const MON = '2026-10-26';   // 한 주 = 10/26(월) ~ 11/1(일). 10월 달력 다섯째 줄, 월요일이 든 달 = 10월
  function bootBrowser() {
    const X = boot(app, 'https://tcapp.local/', false);
    X.T = X.ev('todayYmd()');
    X.ev('state = ' + JSON.stringify(stateFor()) + ';');
    clearDrafts(X);
    return X;
  }
  //  화면 조작: kind 'prog' | 'plan' 의 i 번째 블록
  const blocks = (X, k) => X.evJSON(`AWE.${k}.map(function(b){ return { name: b.name, text: b.text }; })`);
  const typeBlock = (X, k, i, v) => input(X, `#awEd textarea[data-wt="${k}:${i}"]`, v);
  const addBlock = (X, k, name) => { X.$(`#awEd [data-awadd="${k}"]`).click(); X.$(`#awAddList [data-awaddname="${name}"]`).click(); };
  const hoursRows = (X) => X.evJSON("[].map.call(document.querySelectorAll('#awHours .aw-hr'), function(l){ return [l.querySelector('.aw-hn').textContent, l.querySelector('input').value]; })");
  const nfBox = (X, k) => X.$(`#awNf .nf-box[data-nf="${k}"]`).textContent;

  // ── (U) 순수 ────────────────────────────────────────────────────────
  test('(U) 조립: 진행사항과 차주계획은 [과제명] 줄 + 내용(비면 -), 블록 사이 빈 줄, 과제 미정은 빼고, 과제투입시간은 진행사항을 따라가며 ----- 와 합계', () => {
    const X = bootBrowser();
    try {
      const prog = [{ name: '알파', text: '\n  - 연동 환경 구축\n- 회의  \n\n' }, { name: '베타', text: '   ' }, { name: '', text: '미정 글' }];
      const s = { subj: '10월 다섯째주', prog, plan: [{ name: '감마', text: '' }], hours: { '알파': 12, '베타': 2.5, '감마': 9, '없음': 3 }, meet: '\n- 주간회의\n\n' };
      const c = X.evJSON(`awCompose(${JSON.stringify(s)})`);
      assert.strictEqual(c.endwork, '[알파]\n  - 연동 환경 구축\n- 회의\n\n[베타]\n-', '진행사항 조립이 다르다');
      assert.strictEqual(c.planwork, '[감마]\n-', '빈 차주계획 블록이 - 가 아니다');
      assert.strictEqual(c.content, '[알파] : 12\n[베타] : 2.5\n-----\n합계 : 14.5', '과제투입시간이 진행사항 과제만 따르지 않거나 끝 줄이 다르다');
      assert.strictEqual(c.resultwork, '- 주간회의');
      assert.strictEqual(X.ev(`awHoursText([], { '알파': 3 })`), '', '진행사항이 없으면 과제투입시간은 빈 글이어야 한다');
      assert.strictEqual(X.ev(`awHoursText([{ name: '알파', text: '' }], {})`), '[알파] : 0\n-----\n합계 : 0', '값 없는 과제는 0 이어야 한다');
      const pr = (st) => X.evJSON(`awProblems(${JSON.stringify(st)})`);
      assert.deepStrictEqual(pr({ prog: [], plan: [] }), { noProg: true, bad: [] });
      assert.deepStrictEqual(pr({ prog: [{ name: '알파' }, { name: '' }], plan: [{ name: '' }] }), { noProg: false, bad: [{ kind: 'prog', i: 1 }, { kind: 'plan', i: 0 }] });
      assert.deepStrictEqual(pr({ prog: [{ name: '' }], plan: [] }).noProg, true, '과제 미정만 있으면 진행사항이 없는 것이다');
    } finally { X.close(); }
  });

  test('(U) 제목 규칙 둘: 달력에서 고르면 그 달 달력의 몇째 줄, 고르지 않으면 월요일이 든 달(weekSubjectGuess). 달력 줄은 월요일 시작', () => {
    const X = bootBrowser();
    try {
      assert.deepStrictEqual(X.evJSON('awMonthRows(2026, 9)'), ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'], '10월 달력 줄이 다르다');
      assert.deepStrictEqual(X.evJSON('awMonthRows(2026, 8)'), ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'], '9월 달력 줄이 다르다');
      assert.strictEqual(X.ev('awPickTitle(8, 4)'), '9월 다섯째주', '같은 주의 9월 달력 마지막 줄 제목');
      assert.strictEqual(X.ev('awPickTitle(9, 0)'), '10월 첫째주', '같은 주의 10월 달력 첫 줄 제목');
      assert.strictEqual(X.ev("weekSubjectGuess('2026-09-28')"), '9월 다섯째주', '고르지 않으면 월요일이 든 달 기준');
      assert.strictEqual(X.ev(`weekSubjectGuess('${MON}')`), '10월 다섯째주');
      assert.strictEqual(X.ev("awMonOf('2026-11-01')"), MON, '일요일의 월요일이 다르다');
      assert.strictEqual(X.ev("awMonOf('2026-10-26')"), MON);
      assert.strictEqual(X.ev("awIsMon('2026-10-27')"), false);
    } finally { X.close(); }
  });

  test('(U) 되살리기: [과제명] 머리(캘린더 과제만, 같은 과제 둘째는 미정), 첫 머리 앞 글은 미정, - 는 빈 내용, 과제투입시간 줄 읽기', () => {
    const X = bootBrowser();
    try {
      const text = '머리 앞 글\n[알파]\n&nbsp;&nbsp;- 연동\n[모름]\n- 다른 일\n[베타]\n-\n\n[알파]\n- 둘째';
      const r = X.evJSON(`awParseBlocks(${JSON.stringify(text)}, ${JSON.stringify(NAMES)})`);
      assert.deepStrictEqual(r, [
        { name: '', text: '머리 앞 글', raw: '' },
        { name: '알파', text: '  - 연동', raw: '' },
        { name: '', text: '[모름]\n- 다른 일', raw: '[모름]' },
        { name: '베타', text: '', raw: '' },
        { name: '', text: '[알파]\n- 둘째', raw: '[알파]' },
      ]);
      //  조립한 글은 그대로 되살아난다
      const back = X.evJSON(`awParseBlocks(awBlocksText([{ name: '알파', text: '  - 한 일' }, { name: '감마', text: '' }]), ${JSON.stringify(NAMES)})`);
      assert.deepStrictEqual(back.map((b) => [b.name, b.text]), [['알파', '  - 한 일'], ['감마', '']]);
      assert.deepStrictEqual(X.evJSON("awParseHours('[알파] : 12\\n[베타] : 2.5\\n-----\\n합계 : 14.5')"), { '알파': 12, '베타': 2.5 });
    } finally { X.close(); }
  });

  test('(U) 일간 모으기: 과제마다 내용 줄을 날짜 순으로(같은 줄은 한 번), 시간 합계, 시간만 있는 과제도 블록, 과제 미정과 자유 메모는 넣지 않는다', () => {
    const X = bootBrowser();
    try {
      const rows = [
        { date: '2026-10-27', content: '[알파] : 4\n- 연동 환경 구축 중\n- 요구사항 구현\n\n[베타] : 4\n- 회신' },
        { date: '2026-10-26', content: '* 외근\n\n[알파] : 6\n- 연동 환경 구축 중\n\n[모름] : 2\n- 무엇' },
        { date: '2026-10-30', content: '[휴가] : 8' },
        { date: '2026-10-28', content: '[감마] : 0' },
      ];
      const c = X.evJSON(`awDailyCollect(${JSON.stringify(rows)}, ${JSON.stringify(NAMES)})`);
      assert.deepStrictEqual(c.prog, [
        { name: '알파', text: '- 연동 환경 구축 중\n- 요구사항 구현', raw: '' },
        { name: '베타', text: '- 회신', raw: '' },
        { name: '휴가', text: '', raw: '' },
      ], '진행사항 블록이 다르다(날짜 순, 같은 줄 한 번, 시간만 있는 과제, 빈 0시간 과제 제외)');
      assert.deepStrictEqual(c.hours, { '알파': 10, '베타': 4, '휴가': 8 });
      assert.strictEqual(c.skipped, 2, '자유 메모와 과제 미정 글을 세지 않았다');
      assert.strictEqual(c.days, 4);
    } finally { X.close(); }
  });

  // ── (B) 브라우저 ─────────────────────────────────────────────────────
  test('(B) [일간][주간]: 근태 탭 머리에서 고르면 달력과 주간 목록이 바뀌고 이 PC에 기억한다', () => {
    const X = bootBrowser();
    try {
      X.ev("pcSetTab('attend')");
      assert.ok(shown(X, '#atMonth') && !shown(X, '#awList'), '처음은 일간(근태 달력)이어야 한다');
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#atMonth [data-atkind]'), function(b){ return b.textContent + (b.classList.contains('active') ? '*' : ''); })"), ['일간*', '주간']);
      X.$('#atMonth [data-atkind="week"]').click();
      assert.ok(!shown(X, '#atMonth') && shown(X, '#awList'), '[주간]을 눌렀는데 목록이 아니다');
      assert.strictEqual(X.ev("localStorage.getItem('tc_attKind')"), 'week', '고른 쪽을 기억하지 않았다');
      assert.ok(X.$('#awList [data-atkind="week"]').classList.contains('active'));
      assert.ok(X.$('#awList .at-note').textContent.includes('위젯'), '브라우저 안내가 없다');
      //  다시 켤 때(탭에 들어올 때) 기억한 쪽
      X.ev("pcSetTab('personal'); ATT.kind = ''; pcSetTab('attend')");
      assert.ok(shown(X, '#awList') && X.ev('ATT.kind') === 'week', '기억한 주간으로 열리지 않았다');
      X.$('#awList [data-atkind="day"]').click();
      assert.ok(shown(X, '#atMonth') && !shown(X, '#awList'));
      assert.strictEqual(X.ev("localStorage.getItem('tc_attKind')"), 'day');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 목록: 임시 저장한 주가 작성 중으로(최근이 위, 번호, 제목, 기간), [작성]은 이번 주를 화면 전환으로 연다', () => {
    const X = bootBrowser();
    try {
      //  날짜는 오늘에서 센다(이번 주는 비워 두고 지난주와 그 전 주에 임시 저장). 남의 계정 키는 목록에 나오지 않는다
      const TM = X.ev('awMonOf(todayYmd())'), W1 = X.ev(`addDays('${TM}', -7)`), W2 = X.ev(`addDays('${TM}', -14)`);
      X.ev(`localStorage.setItem('tc_attWDraft:me:${W2}', JSON.stringify({ v:1, subj:'앞 제목', subjAuto:true, prog:[], plan:[], hours:{}, meet:'', savedAt:'2026-10-23T01:00:00.000Z' }))`);
      X.ev(`localStorage.setItem('tc_attWDraft:me:${W1}', JSON.stringify({ v:1, subj:'손 제목', subjAuto:false, prog:[], plan:[], hours:{}, meet:'x', savedAt:'2026-10-29T01:00:00.000Z' }))`);
      X.ev(`localStorage.setItem('tc_attWDraft:other:${W1}', JSON.stringify({ v:1, subj:'남의 것', prog:[], plan:[], hours:{}, meet:'', savedAt:'' }))`);
      X.ev("localStorage.setItem('tc_attKind', 'week'); pcSetTab('attend')");
      const rows = X.evJSON("[].map.call(document.querySelectorAll('#awList tr.aw-row'), function(r){ return [].map.call(r.cells, function(c){ return c.textContent; }); })");
      const per = (m) => X.ev(`awPeriodLabel('${m}')`);
      assert.deepStrictEqual(rows, [['2', '손 제목', per(W1), '작성 중', '2026-10-29'], ['1', '앞 제목', per(W2), '작성 중', '2026-10-23']], '목록 줄이 다르다');
      assert.strictEqual(X.$('#awList .aw-cnt').textContent, '2건');
      //  목록 아래 안내 줄은 없고 그 말은 [작성] 의 title 에 있다. [작성]은 작은 단추(머리 세그와 같은 높이)
      assert.ok(!X.$('#awList .aw-lnote'), '목록 안내 줄이 남아 있다');
      const nb = X.$('#awList [data-awact="new"]');
      assert.ok(nb.classList.contains('sm') && nb.classList.contains('primary') && nb.title.includes('이 앱으로 쓴 주만 보입니다'), '[작성] 이 btn sm primary 가 아니거나 title 에 안내가 없다');
      X.$('#awList [data-awact="new"]').click();
      const mon = TM;
      assert.ok(shown(X, '#awEd') && !shown(X, '#awList') && !shown(X, '#atMonth'), '[작성]이 편집 화면으로 바뀌지 않았다');
      assert.strictEqual(X.ev('AWE.mon'), mon, '[작성]이 이번 주가 아니다');
      assert.strictEqual(X.ev('ATT.screen'), 'wedit');
      assert.ok(X.$('#awTitle').textContent.startsWith(X.ev(`weekSubjectGuess('${mon}')`)), '제목이 월요일이 든 달 기준이 아니다');
      //  편집 화면: 표 네 줄과 단추들
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#awEd .aw-k'), function(k){ return k.textContent; })"), ['진행사항', '과제투입시간', '차주계획', '회의내용']);
      //  머리: [‹ 목록](앱의 ‹ 아이콘) | 주간 보고 ‹ 제목 (기간) ›, [전체 초기화]는 기간, 제목 줄 끝
      assert.strictEqual(X.$('#awBack').textContent, '목록');
      assert.ok(X.$('#awBack svg.ic') && X.$('#awBack').classList.contains('btn') && X.$('#awBack').classList.contains('sm'), '목록 단추에 ‹ 아이콘이 없다');
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelector('#awEd .at-ed-head').children, function(e){ return e.id || e.className; })"), ['awBack', 'aw-sep', 'awHead', 'at-ed-nav']);
      assert.strictEqual(X.$('#awHead').textContent, '주간 보고');
      assert.ok(X.$('#awTitle').classList.contains('at-ed-date') && X.$('#awTitle').parentElement.classList.contains('at-ed-nav'), '제목 (기간) 이 ‹ › 사이(at-ed-nav)에 있지 않다');
      assert.strictEqual(X.$('#awReset').parentElement, X.$('#awEd .aw-meta'), '[전체 초기화]가 기간, 제목 줄에 있지 않다');
      //  화면에 보이는 것을 되풀이하는 안내 글이 없다
      assert.ok(!X.$('#awSubjHow') && !X.$('#awStat') && !X.$('#awPvStat') && !X.$('#awPvFoot'), '제목 기준, 개수, 미리보기 줄 수 안내가 남아 있다');
      assert.strictEqual(X.$('#awMeet').placeholder, '', '회의내용 (자유롭게) 안내가 남아 있다');
      assert.strictEqual(X.$('#awProg').textContent, '', '빈 진행사항에 안내 글이 있다(단추만 보인다)');
      assert.strictEqual(X.$('#awPlan').textContent, '', '빈 차주계획에 안내 글이 있다');
      assert.deepStrictEqual([X.$('#awClose').textContent, X.$('#awSend').textContent], ['닫기', '보고']);
      assert.ok(!X.$('#awEd [id*="Copy"], #awEd [data-copy]'), '복사 단추가 있다');
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#awPanel [data-awtab]'), function(b){ return b.textContent; })"), ['미리보기', '가져오기']);
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#awImp .aw-ibtn b'), function(b){ return b.textContent; })"), ['← 이번 주 일간 보고', '← 지난주 차주계획']);
      //  목록의 행을 누르면 그 주(임시 저장으로 안내 없이)
      X.$('#awBack').click();
      assert.ok(shown(X, '#awList'), '← 주간 목록이 목록으로 돌아가지 않았다');
      X.$(`#awList tr[data-awmon="${W1}"]`).click();
      assert.strictEqual(X.ev('AWE.mon'), W1);
      assert.deepStrictEqual([X.$('#awSubj').value, X.$('#awMeet').value, X.ev('AWE.subjAuto')], ['손 제목', 'x', false], '임시 저장으로 열리지 않았다');
      assert.strictEqual(X.$('#awMsg').textContent, '', '임시 저장을 이어서 열며 안내를 띄웠다(일간처럼 안내 없이)');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  function openWeekB(X, mon) { X.ev("localStorage.setItem('tc_attKind', 'week'); pcSetTab('attend')"); X.ev(`awOpen(${JSON.stringify(mon || MON)})`); }

  test('(B) 과제 추가와 과제투입시간: 진행사항 블록을 따라 칸이 생기고 빠진다(2열, 0~168, 0.5), 합계, 캘린더 순서 정렬, 차주계획은 따로', () => {
    const X = bootBrowser();
    try {
      openWeekB(X);
      assert.strictEqual(X.$('#awHours').textContent.trim(), '', '빈 과제투입시간에 설명 문구가 남아 있다(2026-10-29 사용자: 설명 문구를 두지 않는다)');
      addBlock(X, 'prog', '감마'); addBlock(X, 'prog', '알파');
      assert.deepStrictEqual(blocks(X, 'prog').map((b) => b.name), ['알파', '감마'], '캘린더 순서로 정렬하지 않았다');
      X.$('#awEd [data-awadd="prog"]').click();
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#awAddList [data-awaddname]'), function(b){ return b.dataset.awaddname + (b.disabled ? ':x' : ''); })"), ['알파:x', '베타', '감마:x', '휴가'], '이미 있는 과제가 흐리지 않다');
      esc(X);
      assert.ok(X.$('#awAddMenu').classList.contains('hidden') && shown(X, '#awEd'), 'Esc 가 메뉴만 닫지 않았다');
      assert.deepStrictEqual(hoursRows(X), [['알파', '0'], ['감마', '0']]);
      const hi = X.$('#awHours input[data-wh="0"]');
      assert.deepStrictEqual([hi.type, hi.min, hi.max, hi.step], ['number', '0', '168', '0.5'], '시간 칸이 0~168, 0.5 숫자 칸이 아니다');
      input(X, '#awHours input[data-wh="0"]', '12.3'); blur(X, '#awHours input[data-wh="0"]');
      input(X, '#awHours input[data-wh="1"]', '300'); blur(X, '#awHours input[data-wh="1"]');
      assert.deepStrictEqual(hoursRows(X), [['알파', '12.5'], ['감마', '168']], '떠날 때 0.5 단위와 0~168 로 맞추지 않았다');
      assert.strictEqual(X.$('#awHSum').textContent, '합계 180.5시간');
      //  차주계획에 더해도 과제투입시간은 그대로
      addBlock(X, 'plan', '베타');
      assert.deepStrictEqual(hoursRows(X).map((r) => r[0]), ['알파', '감마'], '차주계획 과제가 과제투입시간에 들어갔다');
      //  진행사항에서 빼면 같이 빠진다
      X.$('#awEd [data-wx="prog:1"]').click();
      assert.deepStrictEqual(hoursRows(X), [['알파', '12.5']]);
      assert.strictEqual(X.ev("'감마' in AWE.hours"), false, '뺀 과제의 시간이 남았다');
      //  과제명은 글자(고칠 수 없다)
      const h0 = X.$('#awEd .at-blk[data-wk="prog:0"] .at-bh');
      assert.ok(h0.querySelector('.at-bn') && !h0.querySelector('input, select'), '과제명을 고칠 수 있는 칸이 있다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 미리보기: 인트라넷 폼 모양(기간, 제목과 여섯 칸, 미처리사항과 문제점은 빈칸)이고 칸의 글은 보낼 글과 같다', async () => {
    const X = bootBrowser();
    try {
      openWeekB(X);
      addBlock(X, 'prog', '알파'); addBlock(X, 'prog', '베타'); addBlock(X, 'plan', '감마');
      typeBlock(X, 'prog', 0, '  - 연동 환경 구축');
      input(X, '#awHours input[data-wh="0"]', '6'); input(X, '#awHours input[data-wh="1"]', '2');
      input(X, '#awMeet', '- 주간회의');
      await tick(AW_WAIT);
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#awNf .nf-t th'), function(t){ return t.textContent; })"),
        ['기간', '제목', '진행사항', '과제투입시간', '미처리사항', '차주계획', '문제점 및건의사항', '회의내용'], '폼 항목이 인트라넷과 다르다');
      const c = X.evJSON('awCompose(awCur())');
      assert.strictEqual(nfBox(X, '진행사항'), c.endwork);
      assert.strictEqual(nfBox(X, '진행사항'), '[알파]\n  - 연동 환경 구축\n\n[베타]\n-');
      assert.strictEqual(nfBox(X, '과제투입시간'), '[알파] : 6\n[베타] : 2\n-----\n합계 : 8');
      assert.strictEqual(nfBox(X, '차주계획'), '[감마]\n-');
      assert.strictEqual(nfBox(X, '회의내용'), '- 주간회의');
      assert.strictEqual(nfBox(X, '미처리사항'), ''); assert.strictEqual(nfBox(X, '문제점 및건의사항'), '');
      assert.ok(X.$('#awNf .nf-box[data-nf="미처리사항"]').classList.contains('empty'));
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#awNf .nf-in'), function(e){ return e.textContent; })"), [MON, '2026-11-01', '10월 다섯째주']);
      //  테마와 상관없는 흰 바탕: 클래스가 토큰만 쓴다(정적 시험이 토큰 값을 본다)
      assert.ok(X.$('#awNf').classList.contains('nf'));
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 주 고르기 달력: 열면 그 달, 줄을 누르면 그 주와 그 달 기준 제목(같은 주를 9월 달력에서 고르면 9월 다섯째주), ‹ › 는 7일씩', () => {
    const X = bootBrowser();
    try {
      openWeekB(X, '2026-10-05');
      X.$('#awWeekBtn').click();
      assert.ok(shown(X, '#awWCal'), '주 고르기 달력이 열리지 않았다');
      assert.strictEqual(X.$('#awWCal .aw-cmh b').textContent, '2026년 10월');
      assert.deepStrictEqual(X.evJSON("[].map.call(document.querySelectorAll('#awWCal tr.aw-cw'), function(r){ return r.dataset.awpick + (r.classList.contains('sel') ? '*' : ''); })"),
        ['2026-09-28', '2026-10-05*', '2026-10-12', '2026-10-19', '2026-10-26']);
      X.$('#awWCal [data-awcm="-1"]').click();
      assert.strictEqual(X.$('#awWCal .aw-cmh b').textContent, '2026년 9월');
      X.$('#awWCal tr[data-awpick="2026-09-28"]').click();
      assert.ok(!shown(X, '#awWCal'), '고른 뒤 달력이 닫히지 않았다');
      assert.strictEqual(X.ev('AWE.mon'), '2026-09-28');
      assert.strictEqual(X.$('#awSubj').value, '9월 다섯째주', '9월 달력의 마지막 줄 제목이 아니다');
      assert.strictEqual(X.ev('AWE.picked'), '9월 다섯째주');
      //  같은 주를 10월 달력의 첫 줄로 고르면 10월 첫째주
      X.$('#awWeekBtn').click();
      X.$('#awWCal [data-awcm="1"]').click();
      X.$('#awWCal tr[data-awpick="2026-09-28"]').click();
      assert.strictEqual(X.$('#awSubj').value, '10월 첫째주');
      assert.ok(X.$('#awTitle').textContent === '10월 첫째주 (9/28~10/4)', '머리 제목(기간)이 다르다: ' + X.$('#awTitle').textContent);
      //  ‹ › 는 고르지 않은 주라 월요일이 든 달 기준
      X.$('#awNext').click();
      assert.strictEqual(X.ev('AWE.mon'), '2026-10-05');
      assert.strictEqual(X.$('#awSubj').value, '10월 둘째주', '10월 1일(목)이 든 주가 첫째주라 10/5 주는 둘째주');
      X.$('#awPrev').click(); X.$('#awPrev').click();
      assert.strictEqual(X.ev('AWE.mon'), '2026-09-21');
      assert.strictEqual(X.$('#awSubj').value, '9월 넷째주');
      //  손으로 고친 제목은 그 값(빈 칸으로 떠나면 규칙대로)
      input(X, '#awSubj', '내 제목');
      assert.ok(X.$('#awTitle').textContent.startsWith('내 제목'));
      const s = X.$('#awSubj'); s.value = '  '; s.dispatchEvent(new X.w.Event('input', { bubbles: true })); s.dispatchEvent(new X.w.Event('change', { bubbles: true }));
      assert.strictEqual(X.$('#awSubj').value, '9월 넷째주');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 막는 규칙: 진행사항 블록 없음, 과제 미정 블록(빨강)은 보내지 않는다. 시간 합계 검사는 없다. 브라우저 보내기는 잠그지 않는다', () => {
    const X = bootBrowser();
    try {
      openWeekB(X);
      X.ev('window.__sent = []; Platform.report.submitWeekly = function(p){ __sent.push(JSON.parse(JSON.stringify(p))); };');
      X.$('#awSend').click();
      assert.ok(X.$('#awMsg').textContent.includes('진행사항에 과제가 없습니다'), '진행사항 없음을 막지 않았다');
      assert.strictEqual(X.evJSON('__sent').length, 0);
      //  과제 미정 블록(차주계획의 모르는 이름)
      X.ev(`AWE.plan = awParseBlocks('[모름]\\n- 할 일', ${JSON.stringify(NAMES)}); awRender();`);
      addBlock(X, 'prog', '알파');
      assert.ok(X.$('#awEd .at-blk[data-wk="plan:0"]').classList.contains('bad'), '과제 미정 블록이 빨갛지 않다');
      X.$('#awSend').click();
      assert.ok(X.$('#awMsg').textContent.includes('과제를 고를 블록이 1개'), '과제 미정을 막지 않았다');
      assert.strictEqual(X.evJSON('__sent').length, 0);
      //  고르면 머리 줄이 지워지고 보낼 수 있다(시간은 0 이어도 된다)
      input(X, '#awEd select[data-wpick="plan:0"]', '감마');
      assert.deepStrictEqual(blocks(X, 'plan'), [{ name: '감마', text: '- 할 일' }]);
      X.$('#awSend').click();
      const sent = X.evJSON('__sent');
      assert.strictEqual(sent.length, 1, '막을 것이 없는데 보내지 않았다');
      assert.strictEqual(sent[0].kind, 'weekly');
      assert.deepStrictEqual(Object.keys(sent[0].fields).sort(), ['content', 'edate', 'endwork', 'planwork', 'resultwork', 'sdate', 'subject']);
      assert.deepStrictEqual([sent[0].fields.sdate, sent[0].fields.edate, sent[0].fields.content], [MON, '2026-11-01', '[알파] : 0\n-----\n합계 : 0']);
      assert.strictEqual(X.$('#awSend').disabled, false, '브라우저 보내기가 잠갔다');
      assert.ok(X.$('#awMsg').textContent.includes('브라우저에서는'), '브라우저 안내가 없다');
      assert.ok(X.ev(`localStorage.getItem('tc_attWDraft:me:${MON}')`), '브라우저 보내기가 임시 저장을 지웠거나 쓰지 않았다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  const AW_WAIT = 1150;   // 임시 저장은 1초 모아 쓴다(AT_DRAFT_DEBOUNCE_MS)
  test('(B) 임시 저장: 1초 뒤 주(월요일)마다 쓰고, 다시 열면 안내 없이 되살린다. [전체 초기화]는 네 칸을 비우고(기간, 제목 그대로) 묻지 않는다', async () => {
    const X = bootBrowser();
    try {
      openWeekB(X);
      assert.strictEqual(X.$('#awReset').disabled, true, '빈 상태에서 전체 초기화가 켜져 있다');
      addBlock(X, 'prog', '알파'); typeBlock(X, 'prog', 0, '- 한 일');
      input(X, '#awHours input[data-wh="0"]', '7');
      addBlock(X, 'plan', '베타');
      input(X, '#awMeet', '회의 메모');
      await tick(AW_WAIT);
      const KEY = `tc_attWDraft:me:${MON}`;
      const d = JSON.parse(X.ev(`localStorage.getItem('${KEY}')`));
      assert.deepStrictEqual([d.v, d.prog, d.plan, d.hours, d.meet], [1, [{ name: '알파', text: '- 한 일' }], [{ name: '베타', text: '' }], { '알파': 7 }, '회의 메모']);
      assert.ok(X.$('#awSaved').textContent.startsWith('이 PC에 임시 저장됨'));
      //  다른 주로 갔다가 돌아오면 그대로
      X.$('#awNext').click();
      assert.deepStrictEqual(blocks(X, 'prog'), []);
      X.$('#awPrev').click();
      assert.deepStrictEqual(blocks(X, 'prog'), [{ name: '알파', text: '- 한 일' }]);
      assert.strictEqual(X.$('#awMeet').value, '회의 메모');
      assert.strictEqual(X.$('#awMsg').textContent, '');
      //  전체 초기화
      const subj = X.$('#awSubj').value;
      X.$('#awReset').click();
      assert.ok(!shown(X, '#awAsk'), '전체 초기화가 물었다');
      assert.deepStrictEqual([blocks(X, 'prog'), blocks(X, 'plan'), X.$('#awMeet').value, X.$('#awSubj').value, X.ev('AWE.mon')], [[], [], '', subj, MON]);
      assert.strictEqual(X.$('#awReset').disabled, true);
      await tick(AW_WAIT);
      assert.strictEqual(X.ev(`localStorage.getItem('${KEY}')`), null, '처음 상태(빈 주)와 같아졌는데 임시 저장이 남았다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 떠날 때 확인: 고친 글이 있으면 ← 주간 목록, Esc, 탭 이동이 묻고, [닫기]면 임시 저장을 쓰고 목록으로', () => {
    const X = bootBrowser();
    try {
      openWeekB(X);
      X.$('#awBack').click();
      assert.ok(shown(X, '#awList') && !shown(X, '#awAsk'), '고친 것이 없는데 물었다');
      X.ev(`awOpen('${MON}')`);
      input(X, '#awMeet', '고친 글');
      X.$('#awBack').click();
      assert.ok(shown(X, '#awAsk') && shown(X, '#awEd'), '← 주간 목록이 묻지 않았다');
      X.$('#awAskStay').click();
      assert.ok(!shown(X, '#awAsk') && shown(X, '#awEd'));
      esc(X);
      assert.ok(shown(X, '#awAsk'), 'Esc 가 묻지 않았다');
      esc(X);
      assert.ok(!shown(X, '#awAsk') && shown(X, '#awEd'), '묻는 창의 Esc 는 계속 쓰기여야 한다');
      X.$('#pcTabPersonal').click();
      assert.ok(shown(X, '#awAsk') && X.ev('PCAL.tab') === 'attend', '탭 이동이 묻지 않았다');
      X.$('#awAskClose').click();
      assert.strictEqual(X.ev('PCAL.tab'), 'personal');
      assert.ok(X.ev(`localStorage.getItem('tc_attWDraft:me:${MON}')`).includes('고친 글'), '떠나며 임시 저장을 쓰지 않았다');
      X.ev("pcSetTab('attend')");
      assert.ok(shown(X, '#awList'), '돌아오면 주간 목록이어야 한다');
      assert.strictEqual(X.$(`#awList tr[data-awmon="${MON}"] .aw-badge`).textContent, '작성 중');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  // ── (W) 위젯 메인 창 ─────────────────────────────────────────────────
  const META = { schemaVersion: '20', expectedSchema: '20', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  async function bootMain() {
    const X = boot(app, 'https://tcapp.local/', true);
    const sess = X.posted.find((x) => x && x.cmd === 'userSessionGet');
    if (sess) X.ev('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'tester', name: '시험자' } }) + ')');
    X.ev('__applyState(' + JSON.stringify(JSON.stringify(stateFor())) + ',' + JSON.stringify(META) + ')');
    await tick();
    clearDrafts(X);
    return X;
  }
  const WROW = (mon, o) => Object.assign({ periodStart: mon, periodEnd: '', subject: '', content: '[알파] : 8\n-----\n합계 : 8', endwork: '[알파]\n&nbsp;&nbsp;- 한 일',
    plan: '[베타]\n- 다음 일', meeting: '- 회의', composedAt: '2026-10-23T09:00:00.000Z' }, o || {});

  test('(W) 목록: reportWeeklyList(52주) 회신과 이 PC 임시 저장을 합쳐 완료와 작성 중, [작성]과 행은 attendOpen(kind week) 하나, __reportWeeklySaved 는 다시 읽는다', async () => {
    const X = await bootMain();
    try {
      const thisMon = X.ev('awMonOf(todayYmd())');
      stubHost(X, `{ reportWeeklyList: { ok: true, rows: ${JSON.stringify([WROW('2026-10-19', { subject: '10월 넷째주' }), WROW('2026-10-12', { subject: '10월 셋째주' }), { periodStart: '2026-10-14', subject: '월요일 아님' }])} }, attendOpen: { ok: true, error: '' } }`);
      X.ev(`localStorage.setItem('tc_attWDraft:7:${MON}', JSON.stringify({ v:1, subj:'10월 다섯째주', prog:[], plan:[], hours:{}, meet:'', savedAt:'2026-10-29T01:00:00.000Z' }))`);
      X.ev("localStorage.setItem('tc_attKind', 'week')");
      X.$('#pcTabAttend').click(); await tick();
      const calls = X.evJSON('__calls');
      assert.deepStrictEqual(calls[0], ['reportWeeklyList', { from: X.ev(`addDays('${thisMon}', -364)`), to: X.ev(`addDays('${thisMon}', 7)`) }], '목록 기간이 다르다');
      const rows = X.evJSON("[].map.call(document.querySelectorAll('#awList tr.aw-row'), function(r){ return [].map.call(r.cells, function(c){ return c.textContent; }); })");
      assert.deepStrictEqual(rows.map((r) => [r[0], r[1], r[3]]), [['3', '10월 다섯째주', '작성 중'], ['2', '10월 넷째주', '완료'], ['1', '10월 셋째주', '완료']], '목록이 DB 기록과 임시 저장을 합치지 않았다(월요일이 아닌 기록은 빠진다)');
      assert.ok(/^\d{4}-\d\d-\d\d$/.test(rows[1][4]), '완료한 주의 날짜(작성한 날)가 없다');
      assert.ok(!shown(X, '#awEd'), '위젯 메인 창에서 편집 화면을 그 자리에 열었다');
      //  행 → 그 주의 기록을 실은 attendOpen
      X.$('#awList tr[data-awmon="2026-10-19"]').click(); await tick();
      let ops = X.evJSON("__calls.filter(function(c){ return c[0] === 'attendOpen'; })");
      assert.strictEqual(ops.length, 1);
      const p = ops[0][1].payload;
      assert.deepStrictEqual([p.v, p.kind, p.mon, p.refresh], [1, 'week', '2026-10-19', false]);
      assert.deepStrictEqual(p.me, { userId: 7, loginId: 'tester', name: '시험자' });
      assert.strictEqual(p.saved.subject, '10월 넷째주', '목록 캐시의 기록을 싣지 않았다');
      assert.deepStrictEqual(p.projects.map((x) => x.name).slice(0, 4), NAMES, '과제 목록을 싣지 않았다');
      assert.strictEqual(X.evJSON("__calls.filter(function(c){ return c[0] === 'reportWeeklyList'; })").length, 1, '캐시에 있는 주인데 다시 읽었다');
      //  [작성] = 이번 주
      X.$('#awList [data-awact="new"]').click(); await tick();
      ops = X.evJSON("__calls.filter(function(c){ return c[0] === 'attendOpen'; })");
      assert.strictEqual(ops.length, 2);
      assert.strictEqual(ops[1][1].payload.mon, thisMon, '[작성]이 이번 주가 아니다');
      //  DB 저장 알림 → 다시 읽기
      const n = X.evJSON('__calls').length;
      X.ev("__reportWeeklySaved({ periodStart: '2026-10-19' })"); await tick();
      assert.deepStrictEqual(X.evJSON('__calls').slice(n).map((c) => c[0]), ['reportWeeklyList'], '저장 알림 뒤 목록을 다시 읽지 않았다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  // ── (A) 근태 창 ─────────────────────────────────────────────────────
  const ATTEND_URL = 'https://tcapp.local/index.html?win=attend';
  const PROJ = CATS.map((c) => ({ key: c.id, name: c.name, color: c.color }));
  const wpayload = (mon, saved) => ({ v: 1, kind: 'week', mon: mon || MON, me: { userId: 7, loginId: 'tester', name: '시험자' }, saved: saved || null, projects: PROJ, refresh: false });
  const DAILY = [
    { date: '2026-10-26', status: '1', overtime: 0, content: '[알파] : 6\n&nbsp;&nbsp;- 연동 환경 구축 중\n\n[휴가] : 2', sentAt: '' },
    { date: '2026-10-27', status: '1', overtime: 0, content: '[알파] : 4\n&nbsp;&nbsp;- 연동 환경 구축 중\n- 요구사항 구현\n\n[베타] : 4\n- 회신', sentAt: '' },
  ];
  const LAST = WROW('2026-10-19', { plan: '[베타]\n- 다음 일\n\n[모름]\n- 무엇' });
  const REP = `{ reportDailyList: { ok: true, rows: ${JSON.stringify(DAILY)} },
    reportWeeklyList: function(p){ return { ok: true, rows: (p.from <= '2026-10-19' && p.to >= '2026-10-19') ? [${JSON.stringify(LAST)}] : [] }; } }`;
  function bootAttend() {
    const A = boot(app, ATTEND_URL, true);
    clearDrafts(A);
    stubHost(A, REP);
    return A;
  }
  const KEYA = `tc_attWDraft:7:${MON}`;
  async function openNewA(A) { A.ev('__attendWinOpen(' + JSON.stringify(wpayload()) + ')'); await tick(40); }

  test('(A) 주간 payload: 주간 편집만 보이고, 처음 여는 주는 이번 주 일간 보고(그 주 7일)와 지난주 차주계획을 가져와 처음 상태로 삼는다', async () => {
    const A = bootAttend();
    try {
      await openNewA(A);
      assert.ok(shown(A, '#awEd') && !shown(A, '#atEd') && !shown(A, '#awList'), '주간 편집만 보이지 않는다');
      assert.strictEqual(A.$('#awEd').parentElement, A.doc.body, '주간 편집이 창 전체로 옮겨지지 않았다');
      const calls = A.evJSON('__calls');
      assert.deepStrictEqual(calls.map((c) => c[0]), ['reportDailyList', 'reportWeeklyList'], '두 가져오기를 하지 않았다');
      assert.deepStrictEqual(calls[0][1], { from: MON, to: '2026-11-01' });
      assert.deepStrictEqual(calls[1][1], { from: '2026-10-19', to: '2026-10-19' });
      assert.deepStrictEqual(blocks(A, 'prog'), [{ name: '알파', text: '  - 연동 환경 구축 중\n- 요구사항 구현' }, { name: '베타', text: '- 회신' }, { name: '휴가', text: '' }]);
      assert.deepStrictEqual(A.evJSON('awHoursFor(AWE.prog, AWE.hours)'), { '알파': 10, '베타': 4, '휴가': 2 });
      assert.deepStrictEqual(blocks(A, 'plan'), [{ name: '베타', text: '- 다음 일' }, { name: '', text: '[모름]\n- 무엇' }], '지난주 차주계획이 블록이 아니다(모르는 이름은 미정)');
      assert.strictEqual(A.ev('awDirty()'), false, '가져온 결과가 처음 상태가 아니다');
      assert.strictEqual(A.ev(`localStorage.getItem('${KEYA}')`), null, '가져오기만으로 임시 저장을 썼다');
      //  바닥 안내는 한 문장, 흐린 색(초록은 보고 성공만). 지난주 기록이 없다는 말은 가져오기 패널의 단추 곁에
      assert.strictEqual(A.$('#awMsg').textContent, '일간 보고 2일에서 과제 3개를 가져왔습니다.');
      assert.strictEqual(A.$('#awMsg').className, 'at-msg', '가져오기 안내가 초록(ok)이다');
      assert.strictEqual(A.$('#awImpMsg').textContent, '', '지난주 기록이 있는데 패널 안내가 있다');
      assert.strictEqual(A.$('#awSend').disabled, false);
      assert.ok(A.doc.title.startsWith('주간보고 '));
      //  진행사항에 과제를 더하면 시간 칸이 그 주 일간 합계로 생긴다
      A.ev('AWE.prog = AWE.prog.filter(function(b){ return b.name !== "베타"; }); delete AWE.hours["베타"]; awRender();');
      addBlock(A, 'prog', '베타');
      assert.deepStrictEqual(hoursRows(A).find((r) => r[0] === '베타'), ['베타', '4'], '더한 과제의 시간 칸이 그 주 일간 합계가 아니다');
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  test('(A) 완료한 주는 DB 기록으로 열고(가져오기 없음, 회의내용 포함, 작성한 시각), 가져오기 단추는 그 칸만 바꾼다', async () => {
    const A = bootAttend();
    try {
      A.ev('__attendWinOpen(' + JSON.stringify(wpayload(MON, WROW(MON, { subject: '10월 다섯째주', content: '[알파] : 8\n[휴가] : 2\n-----\n합계 : 10', endwork: '[알파]\n&nbsp;&nbsp;- 한 일\n\n[휴가]\n-', meeting: '- 회의&nbsp;내용' }))) + ')');
      await tick(40);
      assert.deepStrictEqual(A.evJSON('__calls').map((c) => c[0]), ['reportDailyList'], '완료한 주인데 가져오기를 했다(일간 합계 읽기만 해야 한다)');
      assert.deepStrictEqual(blocks(A, 'prog'), [{ name: '알파', text: '  - 한 일' }, { name: '휴가', text: '' }]);
      assert.deepStrictEqual(hoursRows(A), [['알파', '8'], ['휴가', '2']]);
      assert.deepStrictEqual(blocks(A, 'plan'), [{ name: '베타', text: '- 다음 일' }]);
      assert.strictEqual(A.$('#awMeet').value, '- 회의 내용');
      assert.ok(/^작성한 시각 \d{4}-\d\d-\d\d \d\d:\d\d$/.test(A.$('#awSent').textContent), '작성한 시각이 없다');
      assert.strictEqual(A.ev('awDirty()'), false);
      //  가져오기 패널: ← 지난주 차주계획 은 차주계획만
      A.$('#awPanel [data-awtab="imp"]').click();
      assert.ok(shown(A, '#awImp') && !shown(A, '#awPv'));
      A.$('#awImpPlan').click(); await tick(40);
      assert.deepStrictEqual(blocks(A, 'plan').map((b) => b.name), ['베타', '']);
      assert.deepStrictEqual(blocks(A, 'prog').map((b) => b.name), ['알파', '휴가'], '차주계획 가져오기가 진행사항을 바꿨다');
      A.$('#awImpDaily').click(); await tick(40);
      assert.deepStrictEqual(blocks(A, 'prog').map((b) => b.name), ['알파', '베타', '휴가']);
      assert.deepStrictEqual(hoursRows(A), [['알파', '10'], ['베타', '4'], ['휴가', '2']], '일간 가져오기가 과제투입시간을 합계로 채우지 않았다');
      assert.strictEqual(A.ev('awDirty()'), true);
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  function sendWeekly(A) {
    A.ev('AWE.plan = AWE.plan.filter(function(b){ return b.name; }); awRender(); awOnEdit();');
    typeBlock(A, 'prog', 2, '\t- 연차');
    input(A, '#awMeet', '  - 주간회의');
    const n = A.posted.length;
    A.$('#awSend').click();
    const out = A.posted.slice(n).filter((m) => m.cmd === 'netcusWeekSubmit');
    assert.strictEqual(out.length, 1, 'netcusWeekSubmit 을 한 번 보내지 않았다');
    return out[0];
  }
  test('(A) 보내기: netcusWeekSubmit(기간, 제목, 네 칸과 resultwork, 줄 앞 공백은 &nbsp;), 처리 중 잠금과 닫기 막기, 연속 클릭은 한 번', async () => {
    const A = bootAttend();
    try {
      await openNewA(A);
      const s = sendWeekly(A);
      const NB = '&nbsp;';
      assert.deepStrictEqual(Object.keys(s).sort(), ['cmd', 'content', 'edate', 'endwork', 'planwork', 'resultwork', 'sdate', 'subject']);
      assert.deepStrictEqual([s.sdate, s.edate, s.subject], [MON, '2026-11-01', '10월 다섯째주']);
      assert.strictEqual(s.endwork, '[알파]\n' + NB.repeat(2) + '- 연동 환경 구축 중\n- 요구사항 구현\n\n[베타]\n- 회신\n\n[휴가]\n' + NB.repeat(4) + '- 연차');
      assert.strictEqual(s.content, '[알파] : 10\n[베타] : 4\n[휴가] : 2\n-----\n합계 : 16');
      assert.strictEqual(s.planwork, '[베타]\n- 다음 일');
      assert.strictEqual(s.resultwork, NB.repeat(2) + '- 주간회의');
      for (const sel of ['#awSend', '#awClose', '#awBack', '#awPrev', '#awWeekBtn', '#awMeet', '#awSubj', '#awReset', '#awImpDaily'])
        assert.strictEqual(A.$(sel).disabled, true, sel + ' 가 처리 중에 잠기지 않았다');
      assert.strictEqual(A.$('#awSend').textContent, '보고하는 중…');
      assert.ok(A.ev(`localStorage.getItem('${KEYA}')`), '보내기 직전에 임시 저장을 쓰지 않았다');
      assert.strictEqual(A.ev('__winCloseRequest()'), 'busy', '보내는 중인데 창 닫기를 막지 않았다');
      const n = A.posted.length;
      A.ev('awSubmit(); awSubmit();');
      assert.strictEqual(A.posted.length, n, '처리 중에 또 보냈다');
      A.ev("__netcusProgress('로그인 중…')");
      assert.strictEqual(A.$('#awMsg').textContent, '로그인 중…');
    } finally { A.close(); }
  });

  test('(A) 성공 회신: 보낸 상태가 처음 상태, 임시 저장은 DB 저장 알림(보낸 모양 그대로일 때만)이 와야 지운다. 실패는 공통 안내', async () => {
    const A = bootAttend();
    try {
      await openNewA(A);
      sendWeekly(A);
      A.ev("__netcusResult(true, '주간보고 작성 폼을 채웠습니다. 열린 창에서 직접 제출하세요.')");
      assert.strictEqual(A.$('#awSend').textContent, '보고'); assert.strictEqual(A.$('#awSend').disabled, false);
      assert.strictEqual(A.$('#awMsg').textContent, '주간보고 작성 폼을 채웠습니다. 열린 창에서 직접 제출하세요.');
      assert.strictEqual(A.ev('awDirty()'), false, '성공 뒤에도 고친 것으로 본다');
      assert.ok(A.ev(`localStorage.getItem('${KEYA}')`), 'DB 저장 알림 전에 임시 저장을 지웠다');
      assert.strictEqual(A.ev('__winCloseRequest()'), 'close');
      A.ev(`__reportWeeklySaved({ periodStart: '${MON}' })`);
      assert.strictEqual(A.ev(`localStorage.getItem('${KEYA}')`), null, 'DB 저장 알림 뒤 임시 저장이 남았다');
      assert.ok(A.$('#awSent').textContent.startsWith('작성한 시각 '), '작성한 시각이 없다');
      assert.strictEqual(A.w.__closeCalls, 0, '성공했는데 창을 닫았다');
      //  보낸 뒤 고친 것은 남긴다
      sendWeekly(A);
      A.ev("__netcusResult(true, '주간보고 같은 기간에 이미 있는 글을 고치는 화면으로 열었습니다.')");
      input(A, '#awMeet', '보낸 뒤 고침'); A.ev('awDraftFlushNow()');
      A.ev(`__reportWeeklySaved({ periodStart: '${MON}' })`);
      assert.ok(A.ev(`localStorage.getItem('${KEYA}')`).includes('보낸 뒤 고침'), '보낸 뒤 고친 임시 저장을 지웠다');
      //  실패
      A.ev("__netcusResult(false, '남의 회신')");
      sendWeekly(A);
      A.ev("__netcusResult(false, '자격증명이 없습니다.')");
      assert.strictEqual(A.$('#awMsg').textContent, '처리를 완료하지 못했습니다. 다시 시도해 주세요.');
      assert.strictEqual(A.$('#awMsg').title, '자격증명이 없습니다.');
      assert.strictEqual(A.$('#awSend').disabled, false);
      assert.ok(A.ev(`localStorage.getItem('${KEYA}')`), '실패했는데 임시 저장이 지워졌다');
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  test('(A) 창 안 목록과 이동: ← 주간 목록은 창 안의 목록(reportWeeklyList), 행은 그 자리에서 열고, ‹ › 는 그 주 기록을 읽어 연다. 닫기 지키기', async () => {
    const A = bootAttend();
    try {
      await openNewA(A);
      A.$('#awBack').click(); await tick(40);
      assert.ok(shown(A, '#awList') && !shown(A, '#awEd') && !shown(A, '#atEd'), '창 안의 목록이 아니다');
      assert.ok(!A.$('#awList [data-atkind]'), '근태 창 목록에 [일간][주간]이 있다');
      assert.strictEqual(A.evJSON('__calls').slice(-1)[0][0], 'reportWeeklyList');
      assert.strictEqual(A.ev('__winCloseRequest()'), 'close');
      A.$('#awList tr[data-awmon="2026-10-19"]').click(); await tick(40);
      assert.ok(shown(A, '#awEd'));
      assert.strictEqual(A.ev('AWE.mon'), '2026-10-19');
      assert.deepStrictEqual(blocks(A, 'plan').map((b) => b.name), ['베타', ''], '완료한 주를 기록으로 열지 않았다');
      A.$('#awNext').click(); await tick(40);
      assert.strictEqual(A.ev('AWE.mon'), MON);
      //  닫기 지키기
      input(A, '#awMeet', '고친 글');
      assert.strictEqual(A.ev('__winCloseRequest()'), 'ask');
      assert.ok(shown(A, '#awAsk'));
      A.$('#awAskStay').click();
      A.$('#awClose').click();
      assert.ok(shown(A, '#awAsk'), '닫기 단추가 묻지 않았다');
      A.$('#awAskClose').click();
      assert.strictEqual(A.w.__closeCalls, 1, '[닫기]가 창을 닫지 않았다');
      assert.ok(A.ev(`localStorage.getItem('${KEYA}')`).includes('고친 글'), '닫으며 임시 저장을 쓰지 않았다');
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  test('(A) 새로고침과 모드 바꾸기: 주간 화면의 새로고침은 attendNav refresh 를 청하고 그 회신의 과제 목록만 받는다, 일간 payload 가 오면 일간으로', async () => {
    const A = bootAttend();
    try {
      await openNewA(A);
      const n = A.posted.length;
      A.ev('__attendWinActivated()');
      assert.deepStrictEqual(A.posted.slice(n), [{ cmd: 'attendNav', date: MON, refresh: true }]);
      const prog = JSON.stringify(blocks(A, 'prog'));
      const daily = { v: 1, date: MON, me: { userId: 7, loginId: 'tester', name: '시험자' }, saved: null, attend: '', attendOt: 0,
        source: { rows: [], hours: {}, fmt: { mkSpec: { kind: 'const', ch: '-' }, indent: 2 } }, projects: PROJ.concat([{ key: 'c-e', name: '엡실론', color: '#123456' }]), refresh: true };
      A.ev('__attendWinOpen(' + JSON.stringify(daily) + ')');
      assert.ok(shown(A, '#awEd') && !shown(A, '#atEd'), '새로고침 회신이 일간으로 바꿨다');
      assert.strictEqual(JSON.stringify(blocks(A, 'prog')), prog, '새로고침이 블록을 바꿨다');
      A.$('#awEd [data-awadd="plan"]').click();
      assert.ok(A.$('#awAddList [data-awaddname="엡실론"]'), '새 과제가 과제 추가 목록에 없다');
      //  새 과제 만들기는 메인 창에 청한다
      const k = A.posted.length;
      A.$('#awAddNew').click();
      assert.deepStrictEqual(A.posted.slice(k), [{ cmd: 'attendCatNew' }]);
      //  일간 payload(새로고침 아님)는 일간 보고로 바꾼다(쓰던 주간 글은 임시 저장)
      input(A, '#awMeet', '주간 글');
      A.ev('__attendWinOpen(' + JSON.stringify(Object.assign({}, daily, { refresh: false })) + ')');
      assert.ok(shown(A, '#atEd') && !shown(A, '#awEd'), '일간 payload 로 일간 보고가 열리지 않았다');
      assert.strictEqual(A.ev('ATE.date'), MON);
      assert.ok(A.ev(`localStorage.getItem('${KEYA}')`).includes('주간 글'), '일간으로 바꾸며 주간 임시 저장을 쓰지 않았다');
      assert.strictEqual(A.ev('__winCloseRequest()'), 'close', '일간 화면인데 주간 닫기 묻기를 썼다');
      //  다시 주간 payload
      A.ev('__attendWinOpen(' + JSON.stringify(wpayload()) + ')'); await tick(40);
      assert.ok(shown(A, '#awEd') && !shown(A, '#atEd'));
      assert.strictEqual(A.$('#awMeet').value, '주간 글', '주간으로 돌아왔는데 임시 저장으로 열지 않았다');
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  test('(A) 빈 목록과 지난주 기록 없음: 목록은 "작성한 주간보고가 없습니다." 한 줄, 지난주 기록이 없다는 말은 가져오기 패널(바닥은 일간 결과 한 문장)', async () => {
    const A = boot(app, ATTEND_URL, true);
    try {
      clearDrafts(A);
      stubHost(A, `{ reportDailyList: { ok: true, rows: [] }, reportWeeklyList: { ok: true, rows: [] } }`);
      await openNewA(A);
      assert.strictEqual(A.$('#awMsg').textContent, '이번 주 일간 보고가 없습니다.');
      assert.strictEqual(A.$('#awMsg').className, 'at-msg');
      assert.strictEqual(A.$('#awImpMsg').textContent, '지난주 주간보고가 없습니다.');
      assert.ok(A.$('#awImpMsg').previousElementSibling === A.$('#awImpPlan'), '안내가 지난주 차주계획 단추 곁에 있지 않다');
      A.$('#awBack').click(); await tick(40);
      assert.strictEqual(A.$('#awList .aw-lempty').textContent, '작성한 주간보고가 없습니다.');
      assert.ok(!A.$('#awList .aw-tblwrap'), '빈 목록에 표 상자가 있다');
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  // ── (M) 변이 ─────────────────────────────────────────────────────────
  function runOn(src, fn) {
    const X = boot(src, 'https://tcapp.local/', false);
    try { X.ev('state = ' + JSON.stringify(stateFor()) + ';'); return fn(X); } finally { X.close(); }
  }
  test('변이 W1: 빈 내용의 - 를 빼면 조립 검사가 잡는다', () => {
    const bad = mutate(app, "return '[' + b.name + ']\\n' + (body.trim() ? body : '-');", "return '[' + b.name + ']\\n' + body;");
    runOn(bad, (X) => assert.notStrictEqual(X.ev("awBlocksText([{ name: '알파', text: '' }])"), '[알파]\n-'));
  });
  test('변이 W2: 과제투입시간이 진행사항을 따라가지 않으면(시간표 전부) 조립 검사가 잡는다', () => {
    const bad = mutate(app, 'function awHoursFor(prog, hours){ const o = {}, h = hours || {}; for(const n of awProgNames(prog)) o[n] = awHoursVal(h[n]); return o; }',
      'function awHoursFor(prog, hours){ const o = {}, h = hours || {}; for(const n of Object.keys(h)) o[n] = awHoursVal(h[n]); return o; }');
    runOn(bad, (X) => assert.notStrictEqual(X.ev("awHoursText([{ name: '알파', text: '' }], { '알파': 1, '없음': 2 })"), '[알파] : 1\n-----\n합계 : 1'));
  });
  test('변이 W3: 진행사항 없음 막기를 빼면 막는 규칙 검사가 잡는다', () => {
    const bad = mutate(app, "  return { noProg: !awProgNames(s.prog).length, bad };", "  return { noProg: false, bad };");
    runOn(bad, (X) => assert.notStrictEqual(X.ev('awProblems({ prog: [], plan: [] }).noProg'), true));
  });
  test('변이 W4: 저장 알림의 모양 비교를 빼면(늘 지움) 보낸 뒤 고친 임시 저장이 사라진다', async () => {
    const bad = mutate(app, '  if(sig && dr && awSig(dr) === sig) awDraftDel(mon);', '  if(dr) awDraftDel(mon);');
    const A = boot(bad, ATTEND_URL, true);
    try {
      clearDrafts(A); stubHost(A, REP);
      await openNewA(A);
      sendWeekly(A);
      A.ev("__netcusResult(true, '주간보고 작성 폼을 채웠습니다.')");
      input(A, '#awMeet', '보낸 뒤 고침'); A.ev('awDraftFlushNow()');
      A.ev(`__reportWeeklySaved({ periodStart: '${MON}' })`);
      assert.strictEqual(A.ev(`localStorage.getItem('${KEYA}')`), null, '변이가 임시 저장을 지우지 않았다(검사가 이 변이를 못 잡는다)');
    } finally { A.close(); }
  });
}
