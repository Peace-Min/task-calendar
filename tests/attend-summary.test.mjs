// 근태 탭 취합(docs/ATTEND-SUMMARY.md, 2026-11-03)과 주간보고 목록 찾기 시험.
//
//   (S) 정적: 보고서 버튼과 창이 없고, 취합 화면(#atSum)이 근태 탭 안에 있고, 출처는 둘(netcus 일간 없음), 기간 빠른 단추 없음,
//       결과 형태 seg 가 오른쪽 위에 있고 월간 설정은 왼쪽 맨 아래(#asMon), 기간 취합 함수는 한 벌.
//   (B) jsdom 브라우저: [취합] 진입, 처음 값(지난달), 출처 둘과 포함 항목 막힘, 인트라넷 주간은 [읽어 오기] 전에 호스트 요청이 없다,
//       결과 형태에 따라 단추와 월간 설정이 바뀐다, 주간보고 목록의 기간 겹침과 찾기와 쪽.
//   (M) 변이: 보고서 버튼, netcus 일간 출처, 결과 형태 탭 위치, 기간 취합 함수 두 벌, 겹침 판정, 찾기 범위를 되살리면 위 검사가 실패한다.
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
    return { w, d, posted, ev: (c) => w.eval(c), $: (s) => d.querySelector(s), shown: (s) => { const e = d.querySelector(s); return !!e && !e.classList.contains('hidden'); } };
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
  test('(B) 포함 항목은 인트라넷 주간이면 자리는 두고 막힌다(title), 출처를 눌러도 호스트 요청이 없다', async () => {
    const X = boot(app, true);
    await tick(200);
    await openSum(X);
    stub(X, '{}');
    X.$('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
    const inc = [...X.d.querySelectorAll('#asInc input')];
    assert.strictEqual(inc.length, 4); assert.ok(inc.every((i) => i.disabled));
    assert.strictEqual(X.$('#asInc').title, '캘린더 기록일 때만 씁니다');
    assert.ok(X.$('#asInc').offsetParent !== undefined);
    X.$('#rptFrom').value = '2026-01-01'; X.$('#rptFrom').dispatchEvent(new X.w.Event('change', { bubbles: true })); await tick();
    assert.strictEqual(X.ev('__calls.length'), 0, '출처와 날짜를 바꾸는 것만으로 호스트 요청이 나갔다');
    assert.ok(!X.posted.some((p) => /netcus/i.test(JSON.stringify(p))), '회사 요청이 나갔다');
    X.$('#rptSrcSeg [data-rsrc="cal"]').click(); await tick();
    assert.ok(inc.every((i) => !i.disabled));
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
