// 근태 탭 취합(docs/ATTEND-SUMMARY.md, 2026-11-03)과 주간보고 목록 찾기 시험.
//
//   (S) 정적: 보고서 버튼과 창이 없고, 취합 화면(#atSum)이 근태 탭 안에 있고, 출처는 둘(netcus 일간 없음), 기간 빠른 단추 없음,
//       결과 형태 seg 가 오른쪽 위에 있고 월간 설정은 왼쪽 맨 아래(#asMon), 기간 취합 함수는 한 벌.
//   (B) jsdom 브라우저: [취합] 진입, 처음 값(지난달), 출처 둘(포함 항목 칸은 없다), 읽어 오기 전에는 호스트 요청이 없다,
//       캘린더 기록 = 이 앱 주간보고 DB 읽기(reportWeeklyList, 겹치는 주만, 나눠 읽기, hours 줄, 글 미리 보기와 월간 문서가 읽기 한 번의 결과를 같이 쓴다,
//       collectReportData 와 회사 사이트 명령 0, 빈 결과 문구), 결과 형태에 따라 단추와 월간 설정이 바뀐다, 주간보고 목록의 기간 겹침과 찾기와 쪽.
//   (M) 변이: 보고서 버튼, netcus 일간 출처, 결과 형태 탭 위치, 기간 취합 함수 두 벌, 겹침 판정, 찾기 범위, 포함 항목 칸, 일정 모으기, 읽기 함수 두 벌, 나눠 읽기 빼기, 주 겹침 판정 빼기, hours 무시를 되살리면 위 검사가 실패한다.
// ★ 회사 사이트에는 아무것도 보내지 않는다(hostRequest 를 가로챈다).
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 80));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳이다: ' + find.slice(0, 80));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
function fnText(src, name) {
  const a = src.indexOf('function ' + name + '(');
  assert.ok(a >= 0, name + ' 이 없다');
  const e = src.indexOf('\n}\n', a);
  return src.slice(a, e + 2);
}

// 정적 계약(변이가 같은 함수를 부른다)
function checkStatic(src) {
  assert.ok(!/id="btnReportTop"|id="btnReportFold"|id="reportModal"|id="rptGroupModal"/.test(src), '보고서 버튼이나 창이 남았다');
  assert.ok(!/function (openReport|setReportMode|setReportRange|buildWeeklyFields)\(/.test(src), '지운 보고서 창 함수가 남았다');
  const a = src.indexOf('<section class="at-view" id="atView"'), b = src.indexOf('</section>', a);
  const view = src.slice(a, b);
  assert.ok(view.includes('id="atSum"'), '취합 화면이 근태 탭 안에 없다');
  const seg = /<div class="seg seg-auto" id="rptSrcSeg"[\s\S]*?<\/div>/.exec(view);
  assert.ok(seg, '출처 seg 가 없다');
  assert.deepStrictEqual([...seg[0].matchAll(/data-rsrc="(\w+)"/g)].map((m) => m[1]), ['cal', 'week'], '출처가 둘이 아니다');
  assert.ok(!/netcus 일간|data-rsrc="net"/.test(view), 'netcus 일간 출처가 화면에 있다');
  assert.ok(!/data-rpreset|setReportRange|이번 달<|지난달</.test(view), '기간 빠른 단추가 있다');
  const right = view.slice(view.indexOf('id="asRight"'));
  assert.ok(right.indexOf('id="asOut"') >= 0 && right.indexOf('id="asOut"') < right.indexOf('id="btnRptCopy"'), '결과 형태 seg 가 오른쪽 위 줄에 없다');
  const left = view.slice(view.indexOf('id="asLeft"'), view.indexOf('id="asRight"'));
  assert.ok(!left.includes('id="asOut"'), '결과 형태 탭이 왼쪽에 있다');
  assert.ok(left.lastIndexOf('id="asMon"') > left.indexOf('id="asLoad"'), '월간 설정이 왼쪽 맨 아래가 아니다');
  assert.ok(view.includes('class="at-split as-split"'), '공용 끌개(.at-split)가 아니다');
  const one = (n) => (src.match(new RegExp('function ' + n + '\\(', 'g')) || []).length;
  for (const n of ['buildReport', 'buildReportText', 'collectReportData', 'copyReport', 'rptMSave']) assert.strictEqual(one(n), 1, n + ' 이 한 벌이 아니다');
  assert.ok(/awfMatch[\s\S]{0,400}periodEnd[\s\S]{0,200}R\.from/.test(src) && src.includes('pe < R.from') && src.includes('ps > R.to'), '목록 기간 겹침 판정이 없다');
  assert.ok(/t\.push\(r\.subject, r\.endwork, r\.plan, r\.meeting\)/.test(src), '찾기 범위가 제목, 진행사항, 차주계획, 회의내용이 아니다');
  //  2026-11-03 사용자: 캘린더 기록 = 이 앱 주간보고 DB. 포함 항목 칸은 없고, 일정과 할 일을 하루 단위로 모으지 않는다.
  assert.ok(!/id="(asInc|rptSrcEvent|rptSrcTodo|rptWithDesc|rptSkipEmpty)"/.test(src), '포함 항목 칸이 되살아났다');
  for (const n of ['buildReport', 'buildReportText', 'rptMReadApp', 'rptMFill', 'atSumLoad']) assert.ok(!fnText(src, n).includes('collectReportData'), n + ' 이 달력의 일정과 할 일을 모은다');
  const readApp = fnText(src, 'rptMReadApp');
  assert.ok(readApp.includes('awRowsFetch(') && !readApp.includes("'reportWeeklyList'") && !/netcus/.test(readApp), '캘린더 기록 읽기가 근태 주간 목록과 같은 함수(awRowsFetch)가 아니다(두 벌)');
  assert.ok(fnText(src, 'awListLoad').includes('awRowsFetch(') && !fnText(src, 'awListLoad').includes("'reportWeeklyList'"), '주간 목록이 awRowsFetch 를 쓰지 않는다(두 벌)');
  assert.strictEqual((src.match(/hostRequest\('reportWeeklyList'/g) || []).filter(Boolean).length >= 1, true);
  assert.ok(fnText(src, 'awRowsFetch').includes("hostRequest('reportWeeklyList'"), 'awRowsFetch 가 reportWeeklyList 를 읽지 않는다');
}
test('(S) 취합 화면 정적 계약', () => checkStatic(app));
test('(S) 취합 화면 문구에 금지 기호가 없다', () => {
  const a = app.indexOf('id="atSum"'), b = app.indexOf('id="atEd"', a);
  //  머리기호 고르기의 선택지는 기호 자체라 뺀다
  const part = app.slice(a, b).replace(/<select id="rptMarker"[\s\S]*?<\/select>/, '');
  assert.ok(!/[—「」]/.test(part) && !/(^|\s)·|·(\s|$)/m.test(part));
});
test('(M) 변이: 지운 것을 되살리면 정적 계약이 잡는다', () => {
  const cases = [
    ['보고서 버튼', (s) => s.replace('<section class="at-view" id="atView"', '<button id="btnReportTop"></button><section class="at-view" id="atView"')],
    ['netcus 일간 출처', (s) => mutate(s, 'data-rsrc="week" aria-pressed="false"', 'data-rsrc="net" aria-pressed="false" title="netcus 일간">netcus 일간</button><button type="button" class="seg-b" data-rsrc="week" aria-pressed="false"')],
    ['결과 형태 탭을 왼쪽으로', (s) => mutate(s, '<div class="as-sec as-loadrow">', '<div class="seg seg-auto" id="asOut2"></div><div class="as-sec as-loadrow">').replace('<div class="seg seg-auto" id="asOut" role', '<div class="seg seg-auto" id="asOutX" role').replace('<div class="seg seg-auto" id="asOut2">', '<div class="seg seg-auto" id="asOut">')],
    ['기간 취합 함수 두 벌', (s) => s + '\nfunction buildReport(){}\n'],
    ['겹침 판정 빼기', (s) => mutate(s, 'if(R.from !== \'\' && pe < R.from) return false;', '')],
    ['찾기 범위 줄이기', (s) => mutate(s, 't.push(r.subject, r.endwork, r.plan, r.meeting)', 't.push(r.subject)')],
    ['포함 항목 칸', (s) => s.replace('<details class="as-sec as-fmt" id="asFmt">', '<div class="as-sec" id="asInc"><input type="checkbox" id="rptSrcEvent"></div><details class="as-sec as-fmt" id="asFmt">')],
    ['buildReport 가 일정을 모음', (s) => mutate(s, "  atSumSub();\n  if(!/^", "  atSumSub();\n  collectReportData('2026-01-01', '2026-01-02', {});\n  if(!/^")],
    ['읽기 함수 두 벌', (s) => mutate(s, "  const f = await awRowsFetch({ from, to }, null);", "  const f = { rows: [] }; await hostRequest('reportWeeklyList', { from, to });")],
    ['월간 설정을 위로', (s) => mutate(s, '<div class="as-mon hidden" id="asMon">', '<div class="as-mon hidden" id="asMonX">').replace('<div class="as-left" id="asLeft">', '<div class="as-left" id="asLeft"><div id="asMon"></div>')],
  ];
  for (const [name, f] of cases) {
    let caught = false;
    try { checkStatic(f(app)); } catch (_) { caught = true; }
    assert.ok(caught, '변이가 잡히지 않았다: ' + name);
  }
});

const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
if (!JSDOM) {
  skip('attend-summary: jsdom 미설치, 취합 화면 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  function boot(src, host) {
    const posted = [];
    const vc = new jsdomMod.VirtualConsole();
    const dom = new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: vc,
      beforeParse(win) {
        win.scrollTo = () => {}; win.HTMLElement.prototype.scrollIntoView = function () {}; win.open = () => null;
        if (host) win.chrome = { webview: { postMessage(m) { try { posted.push(JSON.parse(m)); } catch (_) {} }, addEventListener() {}, removeEventListener() {} } };
      } });
    const w = dom.window, d = w.document;
    return { w, d, posted, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')), $: (s) => d.querySelector(s), shown: (s) => { const e = d.querySelector(s); return !!e && !e.classList.contains('hidden'); } };
  }
  const openSum = async (X) => { X.ev("pcSetTab('attend'); atKindSet('sum');"); await tick(); };
  const stub = (X, rep) => X.ev(`window.__calls = []; window.__rep = ${rep}; hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
    var r = __rep[cmd]; if(typeof r === 'function') r = r(p); return Promise.resolve(r === undefined ? { ok:false, error:'시험: 회신 없음' } : JSON.parse(JSON.stringify(r))); };`);

  test('(B) [취합] 진입: 화면 전환, 머리 단추 셋, 처음 기간은 지난달, 출처 캘린더 기록, 결과 형태 과제별 글', async () => {
    const X = boot(app, false);
    await tick(200);
    X.ev("pcSetTab('attend')"); await tick();
    assert.deepStrictEqual([...X.d.querySelectorAll('#atMonth [data-atkind]')].map((b) => b.textContent), ['일간', '주간', '취합']);
    X.ev("atKindSet('sum')"); await tick();
    assert.ok(X.shown('#atSum') && !X.shown('#atMonth') && !X.shown('#awList'));
    assert.deepStrictEqual([...X.d.querySelectorAll('#asBar [data-atkind]')].map((b) => b.textContent), ['일간', '주간', '취합']);
    const r = X.ev('monthRange(new Date(), -1)');
    assert.strictEqual(X.$('#rptFrom').value, r[0]); assert.strictEqual(X.$('#rptTo').value, r[1]);
    assert.strictEqual(X.$('#rptSrcSeg .active').dataset.rsrc, 'cal');
    assert.ok(X.shown('#asText') && !X.shown('#asDoc') && !X.shown('#asMon') && X.shown('#btnRptCopy') && !X.shown('#asDocAct'));
    assert.strictEqual(X.d.querySelectorAll('[id="atSum"]').length, 1, 'id atSum 이 둘이다');
    assert.ok(!X.$('#reportModal') && !X.$('#btnReportTop'));
    X.w.close();
  });
  test('(B) 포함 항목 칸이 없고(출처를 바꿔도 칸이 생기거나 사라지지 않는다), 출처나 기간을 바꾸는 것만으로는 호스트 요청이 없다', async () => {
    const X = boot(app, true);
    await tick(200);
    await openSum(X);
    stub(X, '{}');
    assert.strictEqual(X.d.querySelectorAll('#asInc, #rptSrcEvent, #rptSrcTodo, #rptWithDesc, #rptSkipEmpty, #atSum .rpt-chips').length, 0, '포함 항목 칸이 남았다');
    const shape = () => X.d.querySelector('#asLeft').innerHTML.replace(/ (class|aria-pressed)="[^"]*"/g, '');
    const before = shape();
    X.$('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
    assert.strictEqual(shape(), before, '출처를 바꾸니 왼쪽 칸 구조가 바뀌었다(칸이 생기거나 사라졌다)');
    assert.strictEqual(X.$('#rptSrcSeg [data-rsrc="cal"]').title, '이 앱 근태 탭에서 쓴 주간보고를 읽습니다');
    assert.strictEqual(X.$('#rptSrcSeg [data-rsrc="week"]').title, '회사 인트라넷의 주간보고를 읽습니다');
    X.$('#rptFrom').value = '2026-01-01'; X.$('#rptFrom').dispatchEvent(new X.w.Event('change', { bubbles: true })); await tick();
    assert.strictEqual(X.ev('__calls.length'), 0, '출처와 날짜를 바꾸는 것만으로 호스트 요청이 나갔다');
    assert.ok(!X.posted.some((p) => /netcus/i.test(JSON.stringify(p))), '회사 요청이 나갔다');
    X.$('#rptSrcSeg [data-rsrc="cal"]').click(); await tick();
    assert.strictEqual(X.ev('__calls.length'), 0);
    X.w.close();
  });

  //  캘린더 기록 = 이 앱 주간보고 DB(2026-11-03). 시험 DB 는 아래 주들이다(기간 2026-10-01 ~ 10-31, 호스트는 period_start 가 [from-7, to] 안인 주를 준다).
  //   E 09-28~09-29 겹치지 않는다(시작 쪽 한 주 더 읽기로 오지만 걸러진다), A 10-05 hours 있음(content 는 무시), B 10-12 hours 없음(content 에서 되살림),
  //   F 10-26~10-31 끝에서 겹친다, G 11-02 기간 뒤(오지 않는다).
  const WROW = (ps, pe, endwork, extra) => Object.assign({ periodStart: ps, periodEnd: pe, subject: ps + ' 주간보고', content: '', endwork, plan: '', meeting: '', composedAt: ps + 'T09:00:00.000Z', hours: null }, extra || {});
  const DB_ROWS = [
    WROW('2026-09-28', '2026-09-29', '[과제가]\n  - 겹치지 않는 주'),
    WROW('2026-10-05', '2026-10-10', '[과제가]\n  - A-진행\n    A-세부', { content: '이 글은 무시', hours: [{ name: '과제가', projectUid: '', hours: 8 }] }),
    WROW('2026-10-12', '2026-10-17', '[과제가]\n  - B-진행\n[과제나]\n  - 나-진행', { content: '[과제나] : 4\n합계 : 4' }),
    WROW('2026-10-26', '2026-10-31', '[과제나]\n  - F-진행'),
    WROW('2026-11-02', '2026-11-07', '[과제가]\n  - 기간 뒤 주'),
  ];
  const stubDb = (X, rows) => stub(X, '{ reportWeeklyList: function(p){ return { ok:true, rows: ' + JSON.stringify(rows) + '.filter(function(r){ return r.periodStart >= p.from && r.periodStart <= p.to; }) }; } }');
  const asCat = (id, name) => ({ id, name, color: '#3e5be0', desc: '', createdAt: '2026-01-01T00:00:00.000Z' });
  const loadCal = async (X, from, to) => {
    X.$('#rptFrom').value = from; X.$('#rptTo').value = to;
    X.$('#asLoad').click(); await tick(120);
  };
  //  실행 계약(변이도 같은 검사기를 부른다)
  async function checkCalRead(src) {
    const X = boot(src, true);
    try {
      await tick(200);
      await openSum(X);
      X.ev("state.categories = " + JSON.stringify([asCat('c-ga', '과제가'), asCat('c-na', '과제나')]) + ";");
      stubDb(X, DB_ROWS);
      X.ev("window.__crd = 0; (function(){ var o = collectReportData; collectReportData = function(){ __crd++; return o.apply(this, arguments); }; })();");
      assert.strictEqual(X.$('#rptSrcSeg .active').dataset.rsrc, 'cal');
      await loadCal(X, '2026-10-01', '2026-10-31');
      const calls = X.ev("__calls.map(function(c){ return c[0]; })");
      const dbCalls = X.evJSON("__calls.filter(function(c){ return c[0] === 'reportWeeklyList'; }).map(function(c){ return c[1]; })");
      assert.strictEqual(dbCalls.length, 1, '캘린더 기록 읽기가 reportWeeklyList 를 한 번 부르지 않았다');
      assert.deepStrictEqual(dbCalls[0], { from: '2026-09-24', to: '2026-10-31' }, '시작 쪽 한 주 더 읽기가 아니다');
      assert.ok(!calls.includes('netcusWeeklyRangeRead') && !X.posted.some((p) => /netcus/i.test(JSON.stringify(p))), '캘린더 기록이 회사 사이트 명령을 보냈다');
      assert.strictEqual(X.ev('__crd'), 0, '캘린더 기록이 collectReportData(일정과 할 일 모으기)를 불렀다');
      //  겹치는 주만: E(겹치지 않음)와 G(기간 뒤)는 없고 A, B, F 만 읽는다
      const m = X.evJSON('({ weeksRead: netcusWeeklyMerge.weeksRead, src: netcusWeeklyMerge.src, key: netcusWeeklyMerge.key, tasks: netcusWeeklyMerge.parsed.tasks.map(function(t){ return { name: t.name, hours: t.hours, blocks: t.blocks.map(function(b){ return b.title + \'|\' + b.period + \'|\' + b.lines.join(\'/\'); }) }; }) })');
      assert.strictEqual(m.weeksRead, 3, '겹치는 주(A, B, F)만 읽어야 한다: ' + m.weeksRead);
      assert.deepStrictEqual([m.src, m.key], ['cal', 'cal|2026-10-01|2026-10-31'], '출처별 키가 아니다');
      const all = JSON.stringify(m.tasks);
      assert.ok(!all.includes('겹치지 않는 주') && !all.includes('기간 뒤 주'), '겹치지 않는 주가 들어갔다');
      //  hours 줄: A 는 hours 표(8), B 는 hours 가 없어 content 줄([과제나] : 4), A 의 content 는 무시
      const byName = Object.fromEntries(m.tasks.map((t) => [t.name, t]));
      assert.strictEqual(byName['과제가'].hours, 8, 'hours 표가 [이름] : 시간 줄로 바뀌지 않았다(또는 content 를 읽었다)');
      assert.strictEqual(byName['과제나'].hours, 4, 'hours 가 없는 주가 content 줄을 쓰지 않았다');
      assert.deepStrictEqual(byName['과제가'].blocks, ['2026-10-05 주간보고|2026-10-05 ~ 2026-10-10|  - A-진행/    A-세부', '2026-10-12 주간보고|2026-10-12 ~ 2026-10-17|  - B-진행'], '제목과 기간(시작 ~ 끝) 모양이 다르다');
      //  글 미리 보기, 복사, 월간 문서가 읽기 한 번의 결과를 같이 쓴다
      const out = X.ev("$('#rptOut').textContent");
      assert.ok(out.includes('[과제가]') && out.includes('A-진행') && out.includes('나-진행') && out.includes('F-진행') && out.includes('이 앱의 주간보고 기록'), '글 미리 보기에 읽은 결과가 없다');
      assert.strictEqual(X.ev("$('#rptSummary').textContent"), '과제 2개, 3주 병합');
      const copy = X.ev('buildReportText()');
      assert.ok(copy.includes('A-진행') && copy.includes('F-진행') && !copy.includes('겹치지 않는 주'), '복사 글이 같은 결과가 아니다');
      const doc = X.evJSON('rptMPayload(__rptM)');
      const etc = doc.etc.lines.map((l) => l.text).join('\n');
      assert.ok(etc.includes('A-진행') && etc.includes('나-진행') && etc.includes('F-진행') && !etc.includes('겹치지 않는 주'), '월간 문서가 같은 결과를 쓰지 않는다: ' + etc);
      assert.strictEqual(X.ev("$('#rptmSrcMsg').textContent").startsWith('주간보고 기록 3주를 읽어 과제별로 모았습니다.'), true, '읽은 뒤 안내 문구가 다르다: ' + X.ev("$('#rptmSrcMsg').textContent"));
      assert.strictEqual(X.ev('__rptM.fillSrc'), 'cal');
      //  인트라넷 주간으로 바꾸면 읽은 글은 그 출처의 것이 아니라서 미리 보기는 읽어 오기를 기다린다(섞이지 않는다)
      X.$('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
      assert.ok(X.ev("$('#rptOut').textContent").includes('읽어 오기를 눌러 주세요') && X.ev('buildReportText()') === '', '다른 출처의 읽은 글이 섞였다');
    } finally { X.w.close(); }
  }
  test('(B) 캘린더 기록은 이 앱 주간보고 DB 를 읽는다: reportWeeklyList 한 번, 겹치는 주만, hours 줄, 미리 보기와 복사와 월간 문서가 같은 결과, collectReportData 와 회사 사이트 명령 0', async () => { await checkCalRead(app); });
  test('(B) 캘린더 기록 읽기: 호스트 상한을 넘는 기간은 나눠 읽고(시작 쪽 한 주 더), 기록이 없으면 한 줄 안내', async () => {
    const X = boot(app, true);
    await tick(200);
    await openSum(X);
    stubDb(X, []);
    const today = X.ev('todayYmd()');
    const from = X.ev(`addDays('${today}', -900)`);
    await loadCal(X, from, today);
    const calls = X.evJSON("__calls.filter(function(c){ return c[0] === 'reportWeeklyList'; }).map(function(c){ return c[1]; })");
    assert.strictEqual(calls.length, 3, '900일을 380일씩 세 번에 나눠 읽지 않았다: ' + JSON.stringify(calls));
    assert.ok(calls.every((c) => (new Date(c.to) - new Date(c.from)) / 86400000 <= 400), '400일 안으로 나눠 읽지 않았다');
    assert.strictEqual(calls[calls.length - 1].from, X.ev(`addDays('${from}', -7)`), '시작 쪽 한 주 더 읽지 않았다');
    assert.strictEqual(calls[0].to, today);
    assert.ok(X.ev("$('#rptOut').textContent").includes('이 기간에 이 앱으로 쓴 주간보고가 없습니다.'), '빈 결과 문구가 없다');
    assert.strictEqual(X.ev("$('#rptmSrcMsg').textContent"), '이 기간에 이 앱으로 쓴 주간보고가 없습니다.');
    assert.ok(X.d.querySelectorAll('#rptOut .rcard').length === 0 && !/netcus/i.test(X.ev("$('#rptOut').textContent")), '빈 결과 화면이 인트라넷 문구를 쓴다');
    X.w.close();
  });
  test('(B) 캘린더 기록 읽기 실패는 이유를 보이고, 브라우저(위젯 아님)에서는 위젯 안내만 나오며 호스트 요청이 없다', async () => {
    const X = boot(app, true);
    await tick(200);
    await openSum(X);
    stub(X, "{ reportWeeklyList: { ok:false, error:'서버에 연결할 수 없습니다.' } }");
    await loadCal(X, '2026-10-01', '2026-10-31');
    const msg = X.ev("$('#rptmSrcMsg').textContent");
    assert.ok(msg.includes('주간보고 기록을 읽지 못했습니다.') && msg.includes('서버에 연결할 수 없습니다.'), '실패 이유가 없다: ' + msg);
    X.w.close();
    const Bw = boot(app, false);
    await tick(200);
    await openSum(Bw);
    await loadCal(Bw, '2026-10-01', '2026-10-31');
    assert.ok(Bw.ev("$('#rptmSrcMsg').textContent").includes('데스크톱 위젯에서만'), '브라우저 안내가 없다');
    assert.strictEqual(Bw.posted.length, 0, '브라우저에서 호스트 요청이 나갔다');
    Bw.w.close();
  });
  test('(M) 변이: 일정 모으기, 회사 사이트 명령, 겹침 판정 빼기, 나눠 읽기 빼기, hours 무시를 되살리면 캘린더 기록 시험이 잡는다', async () => {
    const cases = [
      ['일정 모으기', (t) => mutate(t, "  const f = await awRowsFetch({ from, to }, null);", "  collectReportData(from, to, { event: true, todo: true });\n  const f = await awRowsFetch({ from, to }, null);")],
      ['회사 사이트 명령', (t) => mutate(t, "  const f = await awRowsFetch({ from, to }, null);", "  hostRequest('netcusWeeklyRangeRead', { from, to }, 1000);\n  const f = await awRowsFetch({ from, to }, null);")],
      ['겹침 판정 빼기', (t) => mutate(t, 'r.periodEnd >= from && r.periodStart <= to', 'true')],
      ['한 주 더 읽기 빼기', (t) => mutate(t, "const floor = R.from ? addDays(R.from, -7) : '2020-01-01';", "const floor = R.from ? R.from : '2020-01-01';")],
      ['hours 무시', (t) => mutate(t, "content: hrs.length ? hrs.map(h => '[' + h.name + '] : ' + h.hours).join('\\n') : r.content,", 'content: r.content,')],
      ['출처 열쇠 섞기', (t) => mutate(t, "function ncMergeKey(from, to, src){ return (src === 'cal' ? 'cal' : 'week') + '|' + from + '|' + to; }", "function ncMergeKey(from, to, src){ return from + '|' + to; }")],
    ];
    for (const [name, f] of cases) {
      let caught = false;
      try { await checkCalRead(f(app)); } catch (_) { caught = true; }
      assert.ok(caught, '변이가 잡히지 않았다: ' + name);
    }
    //  나눠 읽기 빼기: 한 번에 다 읽으면 호스트 상한을 넘는다(세 번이어야 한다)
    const X = boot(mutate(app, "    if(from <= floor) break;\n    empty = got.length", "    break;\n    empty = got.length"), true);
    await tick(200); await openSum(X); stubDb(X, []);
    const today = X.ev('todayYmd()');
    await loadCal(X, X.ev(`addDays('${today}', -900)`), today);
    assert.notStrictEqual(X.evJSON("__calls.filter(function(c){ return c[0] === 'reportWeeklyList'; }).length"), 3, '나눠 읽기를 빼도 시험이 통과한다');
    X.w.close();
  });

  test('(B) 인트라넷 주간은 [읽어 오기]를 눌러야 읽고, 결과를 미리 보기와 월간 보고가 한 번만 읽어 같이 쓴다', async () => {
    const X = boot(app, true);
    await tick(200);
    await openSum(X);
    stub(X, `{ netcusWeeklyRangeRead: { ok:true, weeks:[] } }`);
    X.$('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
    assert.strictEqual(X.ev('__calls.length'), 0);
    X.$('#asLoad').click(); await tick(100);
    assert.strictEqual(X.ev("__calls.filter(c => c[0] === 'netcusWeeklyRangeRead').length"), 1, '읽기는 한 번이어야 한다');
    X.w.close();
  });
  test('(B) 결과 형태: 문서면 DOCX 저장과 월간 설정(#asMon)이 펼쳐지고 복사는 숨는다, 과제별 글이면 반대', async () => {
    const X = boot(app, false);
    await tick(200);
    await openSum(X);
    X.$('#asOut [data-aso="doc"]').click(); await tick();
    assert.ok(X.shown('#asMon') && X.shown('#asDoc') && X.shown('#asDocAct') && !X.shown('#btnRptCopy') && !X.shown('#asText'));
    assert.ok(X.$('#rptmPick').children.length >= 1);
    X.$('#asOut [data-aso="text"]').click(); await tick();
    assert.ok(!X.shown('#asMon') && X.shown('#asText') && X.shown('#btnRptCopy') && !X.shown('#asDocAct'));
    X.w.close();
  });
  test('(B) 주간보고 목록: 기간은 보고 대상 기간 겹침, 찾기(진행사항, 과제명), 쪽 20건, 호스트 상한을 나눠 읽는다', async () => {
    const X = boot(app, true);
    await tick(200);
    const today = X.ev('todayYmd()');
    const mon = X.ev('calReportPeriod(todayYmd()).mon');
    const row = (m, extra) => Object.assign({ periodStart: m, periodEnd: X.ev(`calReportPeriod('${m}').sat`), subject: '주간 ' + m, content: '', endwork: '', plan: '', meeting: '', composedAt: m + 'T01:00:00.000Z', hours: [] }, extra || {});
    const rows = [];
    for (let i = 0; i < 25; i++) rows.push(row(X.ev(`addDays('${mon}', ${-7 * i})`), i === 3 ? { endwork: '유일한 진행사항낱말' } : i === 4 ? { hours: [{ name: '특수과제명', projectUid: '', hours: 4 }] } : {}));
    X.ev("pcSetTab('attend'); atKindSet('week');"); await tick();
    stub(X, '{ reportWeeklyList: function(p){ return { ok:true, rows: ' + JSON.stringify(rows) + '.filter(function(r){ return r.periodStart >= p.from && r.periodStart <= p.to; }) }; } }');
    X.ev('awListLoad()'); await tick(80);
    //  최근 3개월: 약 13주
    const n3 = X.d.querySelectorAll('#awRows tr.aw-row').length;
    assert.ok(n3 >= 12 && n3 <= 15, '최근 3개월 줄 수: ' + n3);
    const sel = X.$('#awfKind'); sel.value = 'all'; sel.dispatchEvent(new X.w.Event('change', { bubbles: true })); await tick(100);
    assert.strictEqual(X.d.querySelectorAll('#awRows tr.aw-row').length, 20, '한 쪽 20건');
    assert.ok(X.$('#awPager'), '쪽 이동이 없다');
    assert.strictEqual(X.$('#awCnt').textContent, '25건');
    X.$('#awPager [data-awpage="1"]').click();
    assert.strictEqual(X.d.querySelectorAll('#awRows tr.aw-row').length, 5);
    const q = X.$('#awfQ'); q.value = '유일한 진행사항낱말'; q.dispatchEvent(new X.w.Event('input', { bubbles: true })); await tick(250);
    assert.strictEqual(X.d.querySelectorAll('#awRows tr.aw-row').length, 1);
    q.value = '특수과제명'; q.dispatchEvent(new X.w.Event('input', { bubbles: true })); await tick(250);
    assert.strictEqual(X.d.querySelectorAll('#awRows tr.aw-row').length, 1);
    q.value = '없는낱말'; q.dispatchEvent(new X.w.Event('input', { bubbles: true })); await tick(250);
    assert.strictEqual(X.$('#awCnt').textContent, '0건');
    //  직접 지정: 호스트 상한(400일)을 넘는 범위는 나눠 읽는다
    q.value = ''; q.dispatchEvent(new X.w.Event('input', { bubbles: true })); await tick(250);
    sel.value = 'custom'; sel.dispatchEvent(new X.w.Event('change', { bubbles: true })); await tick(50);
    X.$('#awfFrom').value = X.ev(`addDays('${today}', -900)`); X.$('#awfFrom').dispatchEvent(new X.w.Event('change', { bubbles: true })); await tick(100);
    const calls = X.ev("__calls.filter(c => c[0] === 'reportWeeklyList').slice(-3).map(c => c[1])");
    assert.ok(calls.length >= 3 && calls.every((c) => (new Date(c.to) - new Date(c.from)) / 86400000 <= 400), '400일 안으로 나눠 읽지 않았다');
    X.w.close();
  });
}
