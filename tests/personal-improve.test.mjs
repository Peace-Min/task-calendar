// 개인 탭 개선(docs/PERSONAL-IMPROVE-PLAN.md 결정 1~10)의 웹 쪽 계약.
//
// 이 파일이 지키는 것:
//   ① 월간 기간 막대(결정 1, 4): 내 창의 #grid 는 주 줄 격자(.bars)다. 여러 날 일정과 여러 날 할 일은 칸을 가로지르는 막대 하나이고
//      주 경계에서 나뉘며 잘린 쪽에 ◂ ▸, 사흘 이상이면 기간 글자. 할 일 막대는 점선(range), 완료(done), 중요 별을 그대로 갖는다.
//      하루 시간 일정은 색 점 + 시각 + 제목. 반복 발생, 휴일, +N, 월 보기 밀도(고정, 촘촘히, 펼침)가 그대로 돈다.
//   ② 누르기(결정 2): 막대를 누르면 누른 자리의 날짜(막대 시작일이 아니라)를 고르고 오른쪽 패널이 바뀐다. 목록 창은 없다.
//   ③ 끌어 옮기기(결정 3): 잡은 자리 기준. (놓은 날 - 잡은 날)만큼 시작과 종료를 함께 옮긴다(길이 유지). 놓을 칸은 손가락 아래 칸
//      (막대 위에 놓아도). 주 경계, 달 경계를 넘어도 같다. 반복 일정은 끌 수 없다. 저장은 예전 save() 그대로.
//   ④ 열람 창(PEER)은 예전 칸별 칩 그대로다(계획 §3).
//   ⑤ 한 화면 폼(결정 6, 8, 9, 10): 옵션 더보기 없음, 모든 칸이 처음부터 보인다. 반복은 안 함, 매주, 매월. 예전 세부 값(간격, 끝)은
//      지우지 않고 보존하며 한 줄 요약을 보인다. 좁은 창은 아래 시트(본문 스크롤, 저장 줄 고정). 모든 일정 수정이 한 화면 폼이다(예전 기록 창은 2026-10-26 Git 기능과 함께 없앴다).
//   ⑥ 시각 칸(결정 7): 개인 폼과 과제 폼의 시각 칸 넷이 모두 앱이 만든 시와 분 고르기(timeField)다. 위젯(WebView2)의
//      input type=time 은 step=300 을 무시하고 분을 1분 단위로 다 보였다(2026-10-23 실제 앱 확인). 분 목록은 정확히 12개(5분 단위),
//      고르면 'HH:MM' 과 input, change, 직접 치기는 칸을 떠날 때 맞춤(9:3 = 09:30), 못 읽는 값은 되돌림, Esc 는 목록만 닫는다.
//      5분 단위가 아닌 값(11:38)은 그대로 보이고 그대로 저장된다(목록은 시 11 만 골라진 표시).
//
// 검사 함수를 시험과 변이 시험이 공유한다. 변이는 '되돌아가면 안 되는 판'을 만들고, 같은 검사가 그것을 잡는지 본다.
import vm from 'node:vm';
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();

function mutate(from, to, base = src) {
  const i = base.indexOf(from);
  assert.ok(i >= 0, `변이 앵커가 없다: ${from.slice(0, 90)}`);
  assert.strictEqual(base.indexOf(from, i + 1), -1, `변이 앵커가 여러 번 나온다(모호): ${from.slice(0, 90)}`);
  return base.slice(0, i) + to + base.slice(i + from.length);
}
//  CSS 규칙 하나(앵커부터 다음 '}' 까지). 앵커는 소스에 정확히 1번.
function rule(text, anchor) {
  const s = text.indexOf(anchor);
  assert.ok(s >= 0, `CSS 규칙 앵커를 찾지 못함: ${anchor}`);
  assert.strictEqual(text.indexOf(anchor, s + 1), -1, `CSS 규칙 앵커가 여러 번 나온다: ${anchor}`);
  return text.slice(s, text.indexOf('}', s) + 1);
}
//  마크업 부분(스크립트 앞). 시각 칸, 폼 칸을 셀 때 스크립트의 문자열(주석의 예시 등)을 세지 않게 한다.
const markupOf = (app) => app.slice(0, app.indexOf('<script'));

/* ── (P) 순수 계산 ───────────────────────────────────────────────────── */
const PURE = ['pmMonthCap', 'pmLayoutWeek', 'pmFitWeek', 'shiftByGrab'];
function pureCtx(app = src) {
  const consts = ['const pad = ', 'const ymd = ', 'const parseYmd = ', 'const addDays = ', 'const diffDays = ', 'const PM_LANE = ']
    .map((k) => { const i = app.indexOf(k); assert.ok(i >= 0, k + ' 를 찾지 못했다'); return app.slice(i, app.indexOf('\n', i)); });
  const code = consts.join('\n') + '\n' + PURE.map((f) => extractFunction(app, f)).join('\n') + '\n;globalThis.__x = {' + PURE.join(',') + '};';
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx);
  return ctx.__x;
}
const J = (x) => JSON.parse(JSON.stringify(x));
const item = (key, s, e) => ({ key, s, e: e || s });

const pure = {
  //  주 나누기, 잘림, 차선(여러 날 먼저, 하루 기록은 빈 차선을 위부터)
  layout(P) {
    const long = item('a', '2026-10-05', '2026-10-13');
    const w1 = J(P.pmLayoutWeek([long], '2026-10-04')), w2 = J(P.pmLayoutWeek([long], '2026-10-11'));
    assert.deepStrictEqual([w1.items[0].c0, w1.items[0].c1, w1.items[0].cl, w1.items[0].cr], [1, 6, false, true], '첫 주 조각(월~토, 뒤로 이어짐)이 아니다');
    assert.deepStrictEqual([w2.items[0].c0, w2.items[0].c1, w2.items[0].cl, w2.items[0].cr], [0, 2, true, false], '둘째 주 조각(일~화, 앞에서 이어짐)이 아니다');
    assert.strictEqual(J(P.pmLayoutWeek([long], '2026-10-18')).items.length, 0, '범위 밖 주에 조각이 생겼다');
    //  겹치는 여러 날은 다른 차선, 하루 기록은 그 칸의 빈 차선(위부터)
    const L = J(P.pmLayoutWeek([item('b', '2026-10-06', '2026-10-08'), long, item('s1', '2026-10-04'), item('s2', '2026-10-07'), item('s3', '2026-10-10')], '2026-10-04'));
    const lane = Object.fromEntries(L.items.map((i) => [i.x.key, i.lane]));
    //  s1(일요일)은 a 가 없는 칸이라 차선 0, s2(수요일)는 a, b 아래 차선 2, s3(토요일)는 a 아래 빈 차선 1
    assert.deepStrictEqual(lane, { a: 0, b: 1, s1: 0, s2: 2, s3: 1 }, '차선 배치가 다르다: ' + JSON.stringify(lane));
    assert.strictEqual(L.lanes, 3);
    assert.ok(L.items.find((i) => i.x.key === 'a').multi && !L.items.find((i) => i.x.key === 's1').multi, 'multi 표시가 틀렸다');
    //  하루 기록끼리의 순서는 cmp 를 따른다(같은 칸이면 앞선 것이 위 차선)
    const L2 = J(P.pmLayoutWeek([item('y', '2026-10-07'), item('x', '2026-10-07')], '2026-10-04', (p, q) => (p.key < q.key ? -1 : 1)));
    assert.deepStrictEqual(L2.items.map((i) => [i.x.key, i.lane]), [['x', 0], ['y', 1]], '하루 기록 순서가 cmp 를 따르지 않는다');
  },
  //  보일 차선: 높이를 모르면 전부, 넘치는 칸만 +N 자리, 막대는 덮는 칸 모두에서 보일 때만
  fit(P) {
    const it = (c0, c1, lane) => ({ c0, c1, lane });
    const none = J(P.pmFitWeek([it(0, 0, 0), it(0, 0, 9)], 0, [0, 1, 0, 0, 0, 0, 0]));
    assert.deepStrictEqual(none, { vis: [true, true], cap: null, hiddenBy: [0, 1, 0, 0, 0, 0, 0] }, '높이를 모를 때 전부 보이고 그리지 않은 수만 +N 이어야 한다');
    //  높이 106: 다 들어가면 3 차선, +N 자리를 남기면 2 차선
    assert.strictEqual(P.pmMonthCap(106, 3), 3); assert.strictEqual(P.pmMonthCap(106, 5), 2); assert.strictEqual(P.pmMonthCap(0, 5), 1); assert.strictEqual(P.pmMonthCap(0, 0), 0);
    const items = [it(4, 4, 0), it(4, 4, 1), it(4, 4, 2), it(4, 4, 3), it(4, 4, 4), it(0, 0, 0), it(0, 0, 1), it(0, 0, 2), it(2, 5, 2)];
    const R = J(P.pmFitWeek(items, 106, []));
    assert.deepStrictEqual(R.vis, [true, true, false, false, false, true, true, true, false], '보임이 다르다: ' + JSON.stringify(R.vis));
    assert.strictEqual(R.cap[0], 3, '다 들어가는 칸(일)이 3 차선을 다 쓰지 않는다');
    assert.strictEqual(R.cap[4], 2, '넘치는 칸(목)이 +N 자리를 남기지 않았다');
    //  화~금을 덮는 차선 2 막대는 목요일(2 차선)에서 숨으므로 덮는 칸 모두의 +N 에 든다
    assert.deepStrictEqual(R.hiddenBy, [0, 0, 1, 1, 4, 1, 0], '+N 이 다르다: ' + JSON.stringify(R.hiddenBy));
  },
  //  잡은 자리 기준 이동
  shift(P) {
    assert.deepStrictEqual(J(P.shiftByGrab('2026-10-05', '2026-10-13', '2026-10-09', '2026-10-11')), { delta: 2, start: '2026-10-07', end: '2026-10-15' }, '잡은 날 기준 이동이 아니다');
    assert.deepStrictEqual(J(P.shiftByGrab('2026-10-05', '2026-10-13', '2026-10-12', '2026-10-19')), { delta: 7, start: '2026-10-12', end: '2026-10-20' }, '주를 넘는 이동이 다르다');
    assert.deepStrictEqual(J(P.shiftByGrab('2026-10-29', '2026-11-03', '2026-11-01', '2026-11-03')), { delta: 2, start: '2026-10-31', end: '2026-11-05' }, '달을 넘는 이동이 다르다');
    assert.deepStrictEqual(J(P.shiftByGrab('2026-10-07', '2026-10-08', '2026-10-08', '2026-09-30')), { delta: -8, start: '2026-09-29', end: '2026-09-30' }, '앞 달로 옮기기가 다르다');
    assert.deepStrictEqual(J(P.shiftByGrab('2026-10-15', '', '', '2026-10-14')), { delta: -1, start: '2026-10-14', end: '' }, '잡은 날이 없으면 시작일 기준이어야 한다');
  },
};
test('순수①: 막대 배치(주 경계에서 나눔, 잘림 cl/cr, 여러 날 먼저, 하루 기록은 빈 차선을 위부터)', () => pure.layout(pureCtx()));
test('순수②: 보일 차선과 +N(높이 모름 = 전부, 넘치는 칸만 +N 자리, 막대는 덮는 칸 모두에서 보일 때만)', () => pure.fit(pureCtx()));
test('순수③: 잡은 자리 기준 이동(잡은 날 차이만큼, 주와 달을 넘어도 길이 유지)', () => pure.shift(pureCtx()));
test('변이P: 하루 기록이 빈 차선을 채우지 않거나, 숨은 막대를 +N 에 안 넣거나, 시작일 기준으로 옮기면 순수 검사가 잡는다', () => {
  assert.throws(() => pure.layout(pureCtx(mutate('  multi.forEach(place); single.forEach(place);', '  multi.forEach(place); single.forEach(it => { it.lane = occ.length; place(it); it.lane = occ.length - 1; });'))), /차선/);
  assert.throws(() => pure.fit(pureCtx(mutate("    items.forEach((it, i) => { if(!vis[i]) for(let c = it.c0; c <= it.c1; c++) hiddenBy[c]++; });", "    items.forEach((it, i) => { if(!vis[i]) hiddenBy[it.c0]++; });"))), /\+N|보임/);
  assert.throws(() => pure.shift(pureCtx(mutate('  const delta = diffDays(grab || start, target);', '  const delta = diffDays(start, target);'))), /잡은 날/);
});

/* ── (S) 정적 계약 ───────────────────────────────────────────────────── */
const TIME_IDS = ['qaStart', 'qaEnd', 'pcfST', 'pcfET'];   // (기록 창의 fStart, fEnd 는 2026-10-26 기록 창과 함께 없앴다)
const statics = {
  //  결정 7: 시각 칸은 모두 앱이 만든 고르기(data-time-field, bind 의 timeFieldAll). 브라우저 시각 칸(type=time)은 없다(WebView2 가 step 을 무시).
  //  분 간격은 5. 예전 시/분 고르기(select)는 없다. 앱은 폼 검증을 부르지 않는다.
  timeStep(app) {
    const mk = markupOf(app);
    assert.ok(!/<input[^>]*type="time"/.test(mk), '브라우저 시각 칸(type=time)이 남아 있다: WebView2 는 step 을 무시하고 분을 1분 단위로 보인다');
    const inputs = mk.match(/<input[^>]*\sdata-time-field[^>]*>/g) || [];
    assert.strictEqual(inputs.length, TIME_IDS.length, '앱 시각 칸(data-time-field) 수가 다르다: ' + inputs.length);
    for (const id of TIME_IDS) assert.ok(inputs.some((t) => t.includes(`id="${id}"`) && /type="text"/.test(t)), `시각 칸 #${id} 가 앱 시각 칸(data-time-field)이 아니다`);
    assert.ok(/\n  timeFieldAll\(\);/.test(extractFunction(app, 'bind')), 'bind 가 시각 칸을 앱 고르기로 바꾸지 않는다(timeFieldAll)');
    assert.ok(/\nconst TF_STEP = 5;/.test(app), '분 목록이 5분 단위(TF_STEP = 5)가 아니다');
    assert.ok(!/id="(qa|f)(Start|End)[HM]"/.test(mk) && !/class="timepick"/.test(mk), '예전 시/분 고르기(select)가 남아 있다');
    assert.ok(!/\.(checkValidity|reportValidity)\(/.test(app), '앱이 폼 검증을 부른다: step 어긋남(11:38)이 저장을 막을 수 있다');
  },
  //  결정 6, 8: 한 화면 폼. 옵션 더보기와 자세히 편집이 없고 모든 칸이 마크업에 있다. 반복은 안 함, 매주, 매월 셋.
  oneScreenForm(app) {
    const mk = markupOf(app);
    const a = mk.indexOf('<div class="overlay hidden" id="quickAdd">'), b = mk.indexOf('<!-- ===== 과제 관리 모달 ===== -->', a);
    assert.ok(a > 0 && b > a, '#quickAdd 마크업을 찾지 못했다');
    const qa = mk.slice(a, b);
    for (const gone of ['id="qaMore"', 'id="qaDetail"', 'id="qaAdvanced"', '옵션 더보기']) assert.ok(!qa.includes(gone), `한 화면 폼에 ${gone} 가 남아 있다`);
    assert.ok(!/qaToggleDetail|qaRenderDetail|qaMoreLabel|#qaAdvanced'\)\.addEventListener/.test(app), '옵션 더보기, 자세히 편집 배선이 남아 있다');
    for (const id of ['qaTitle', 'qaDate', 'qaEndDate', 'qaCat', 'qaAllDay', 'qaStart', 'qaEnd', 'qaRemBlock', 'qaRecur', 'qaRecurHint', 'qaLoc', 'qaPrio', 'qaMemo', 'qaSave'])
      assert.ok(qa.includes(`id="${id}"`), `한 화면 폼에 #${id} 가 없다`);
    const sel = /<select id="qaRecur">([\s\S]*?)<\/select>/.exec(qa);
    assert.ok(sel, '반복 고르기가 없다');
    assert.deepStrictEqual([...sel[1].matchAll(/value="([^"]*)"/g)].map((m) => m[1]), ['', 'weekly', 'monthly'], '반복은 안 함, 매주, 매월 셋이어야 한다');
    assert.ok(!/id="qaRecur(Interval|Until|Count)"/.test(qa), '반복 세부 칸(간격, 끝)이 폼에 있다(결정 8)');
  },
  //  결정 9: 좁은 창(440px 이하)은 아래 시트. 한 화면 폼은 .qa-modal 이고, 그 폭 규칙이 높이 88vh, 본문만 스크롤, 저장 줄 고정을 준다.
  narrowSheet(app) {
    assert.ok(/<div class="modal qa-modal[^"]*\bqa-one\b[^"]*"/.test(app), '#quickAdd 의 창이 .qa-modal(시트 규칙 대상)이 아니다');
    const i = app.indexOf('  .modal,.modal.wide,.qa-modal{width:100%;max-width:100%;max-height:88vh;border-radius:14px 14px 0 0}');
    assert.ok(i > 0, '좁은 폭에서 .qa-modal 을 아래 시트(88vh)로 바꾸는 규칙이 없다');
    const head = app.lastIndexOf('@media', i);
    assert.ok(/^@media \(max-width:440px\)\{/.test(app.slice(head, head + 30)), '아래 시트 규칙이 440px 이하 규칙 안에 있지 않다');
    assert.ok(app.includes('  .overlay{align-items:flex-end;padding:0}'), '좁은 폭에서 창이 아래에 붙지 않는다');
    assert.ok(/flex:1 1 auto;min-height:0;overflow-y:auto/.test(rule(app, '\n.qa-body{')), '폼 본문이 스크롤 상자가 아니다');
    assert.ok(/flex:none/.test(rule(app, '\n.qa-foot{')), '저장 줄이 고정(flex:none)이 아니다');
  },
  //  결정 10: 모든 일정(반복 포함)이 한 화면 폼으로 간다. 예전 기록 창(작업일지 전용)은 2026-10-26 Git 기능과 함께 없앴다.
  editRouting(app) {
    const b = extractFunction(app, 'editEntry');
    assert.ok(/if\(e\) openQuickAdd\(null, 'event', id\);/.test(b), '일정이 한 화면 폼으로 가지 않는다');
    assert.ok(!/openEntryModal|source/.test(b), '없앤 기록 창이나 작업일지 갈래가 되살아났다');
    assert.ok(!/recur/.test(b), '반복 일정을 기록 창으로 보내는 갈래가 남아 있다');
  },
  //  결정 1~4 와 PEER-RANGE-BARS: 내 창과 열람 창 모두 막대(renderMonthBars)로 그린다. 할 일 막대 점선, 좁은 폭 숨김 규칙.
  barsWiring(app) {
    const g = extractFunction(app, 'renderGrid');
    assert.ok(!/renderMonthGrid/.test(g) && /renderMonthBars\(\$\('#grid'\), dens/.test(g), '내 창과 열람 창을 모두 막대(renderMonthBars)로 그리지 않는다');
    assert.ok(/border-style:dashed/.test(rule(app, '.chip-todo.chip-bar.range{')), '기간 할 일 막대가 점선이 아니다(결정 4)');
    assert.ok(/@media \(max-width:760px\)\{ \.chip-span\{display:none\} \}/.test(app), '좁은 폭에서 기간 글자를 숨기지 않는다(과제 탭 규칙)');
    assert.ok(/@media \(max-width:560px\)\{[^@]*\.chip-arrow\{display:none\}/.test(app), '좁은 폭에서 ◂ ▸ 를 숨기지 않는다(과제 탭 규칙)');
    assert.ok(/flex:none;height:176px/.test(rule(app, '.grid.bars.dense > .gridrow{')), '촘촘히 밀도가 막대 달력에 닿지 않는다');
    assert.ok(/flex:1 0 auto;min-height:74px/.test(rule(app, '.grid.bars.expand > .gridrow{')), '펼침 밀도가 막대 달력에 닿지 않는다');
  },
};
test('정적①: 시각 칸(개인 폼, 과제 폼) 넷이 모두 앱 시각 칸(5분 단위)이고 type=time 이 없으며 폼 검증을 부르지 않는다(결정 7)', () => statics.timeStep(src));
test('정적②: 한 화면 폼에 옵션 더보기와 자세히 편집이 없고 모든 칸이 있으며 반복은 셋뿐이다(결정 6, 8)', () => statics.oneScreenForm(src));
test('정적③: 좁은 창(440px 이하)은 아래 시트, 본문 스크롤, 저장 줄 고정(결정 9)', () => statics.narrowSheet(src));
test('정적④: 모든 일정이 한 화면 폼으로, 반복 일정도 한 화면 폼으로(결정 10)', () => statics.editRouting(src));
test('정적⑤: 내 창과 열람 창 모두 막대. 할 일 점선, 좁은 폭 숨김, 밀도 규칙(결정 1~4)', () => statics.barsWiring(src));
test('변이S: type=time 부활, 앱 시각 칸 표시 빠짐, bind 배선 빠짐, 분 간격 1, 옵션 더보기 부활, 반복 세부 칸 부활, 시트 규칙 삭제, 반복을 다른 갈래로, 옛 칸별 칩 부활을 잡는다', () => {
  assert.throws(() => statics.timeStep(mutate('<input type="text" id="qaStart" data-time-field>', '<input type="time" id="qaStart" step="300">')), /type=time/);
  assert.throws(() => statics.timeStep(mutate('<input type="text" id="pcfET" data-time-field>', '<input type="text" id="pcfET">')), /data-time-field/);
  assert.throws(() => statics.timeStep(mutate('\n  timeFieldAll();   //', '\n  //')), /timeFieldAll/);
  assert.throws(() => statics.timeStep(mutate('\nconst TF_STEP = 5;', '\nconst TF_STEP = 1;')), /5분 단위/);
  assert.throws(() => statics.timeStep(mutate('function qaSave(){\n  if(guardEdit()) return;', 'function qaSave(){\n  if(guardEdit()) return; if(!document.getElementById(\'quickAdd\').querySelector(\'form\') || true){ const f = document.createElement(\'form\'); f.checkValidity(); }')), /폼 검증/);
  assert.throws(() => statics.oneScreenForm(mutate('    <div class="qa-foot">\n      <button type="button" class="btn" data-close>취소</button>', '    <div class="qa-foot">\n      <button type="button" class="qa-more" id="qaMore">옵션 더보기 ▾</button>\n      <button type="button" class="btn" data-close>취소</button>')), /qaMore|옵션 더보기/);
  assert.throws(() => statics.oneScreenForm(mutate('<span class="qa-hint hidden" id="qaRecurHint" aria-live="polite"></span>', '<input type="number" id="qaRecurInterval"><span class="qa-hint hidden" id="qaRecurHint" aria-live="polite"></span>')), /세부 칸/);
  assert.throws(() => statics.narrowSheet(mutate('  .modal,.modal.wide,.qa-modal{width:100%;max-width:100%;max-height:88vh;border-radius:14px 14px 0 0}', '  .modal,.modal.wide{width:100%;max-width:100%;max-height:88vh;border-radius:14px 14px 0 0}')), /아래 시트/);
  assert.throws(() => statics.editRouting(mutate("  if(e) openQuickAdd(null, 'event', id);", "  if(e && !(e.recur && e.recur.freq)) openQuickAdd(null, 'event', id);")), /한 화면 폼|기록 창/);
  assert.throws(() => statics.barsWiring(mutate("  renderMonthBars($('#grid'), dens,", "  renderMonthGrid($('#grid'), dens,")), /막대/);
});

/* ── (R) 행동: jsdom 위젯 모드 ───────────────────────────────────────── */
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('personal-improve: jsdom 미설치. 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CA = '2026-09-01T00:00:00Z';
  const ENT = (id, date, extra) => Object.assign({ id, date, title: '(예시) 일정 ' + id, categoryId: 'c-a', allDay: true, startTime: '', endTime: '',
    memo: '', location: '', createdAt: CA, updatedAt: CA }, extra || {});
  const TODO = (id, due, extra) => Object.assign({ id, text: '(예시) 할 일 ' + id, done: false, categoryId: 'c-a', due, endDate: '',
    prio: 'normal', createdAt: CA }, extra || {});
  //  2026년 10월: 1일이 목요일. 달력 주 = 9/27, 10/4, 10/11, 10/18, 10/25 (일요일 시작).
  const DATA = {
    categories: [{ id: 'c-a', name: '(예시) 알파', color: '#3e5be0', desc: '', createdAt: CA },
                 { id: 'c-b', name: '(예시) 베타', color: '#1f9d6b', desc: '', createdAt: CA }],
    entries: [
      ENT('e-long', '2026-10-05', { endDate: '2026-10-13', title: '(예시) 시제품 조립' }),          // 10/5(월)~10/13(화): 두 주에 걸침
      ENT('e-two', '2026-10-07', { endDate: '2026-10-08', title: '(예시) 출장', categoryId: 'c-b' }), // 이틀(기간 글자 없음)
      ENT('e-time', '2026-10-15', { allDay: false, startTime: '10:00', endTime: '11:00', title: '(예시) 설계 검토' }),
      ENT('e-wk', '2026-10-05', { allDay: false, startTime: '09:30', endTime: '10:00', title: '(예시) 주간 회의', recur: { freq: 'weekly', interval: 1 } }),
      ENT('e-sep', '2026-09-29', { endDate: '2026-10-02', title: '(예시) 포팅' }),                   // 9월에서 10월로
      ENT('e-odd', '2026-10-21', { allDay: false, startTime: '11:38', endTime: '12:07', title: '(예시) 5분 단위 아님' }),
      ENT('e-rc', '2026-10-06', { allDay: false, startTime: '14:00', endTime: '15:00', title: '(예시) 격주 점검', location: '(예시) 회의실 A', memo: '(예시) 메모',
        recur: { freq: 'weekly', interval: 2, until: '', count: 10 }, recurExcept: ['2026-10-20'] }),
      ENT('e-git', '2026-10-22', { title: '(예시) 작업일지', source: 'git', commits: [{ hash: 'abc1234', subject: '(예시) 커밋', date: '2026-10-22' }] }),
      ...['1', '2', '3', '4', '5'].map((n) => ENT('e-d' + n, '2026-10-23', { allDay: false, startTime: `1${n}:00`, endTime: `1${n}:30`, title: '(예시) 바쁜 날 ' + n })),
    ],
    todos: [
      TODO('t-range', '2026-10-14', { endDate: '2026-10-16', text: '(예시) 시험 성적서 정리' }),
      TODO('t-done', '2026-10-08', { done: true, completedAt: '2026-10-08T09:00:00Z', text: '(예시) 끝낸 일' }),
      TODO('t-star', '2026-10-21', { prio: 'high', text: '(예시) 중요한 일' }),
    ],
    rooms: ['(예시) 회의실 A'],
  };

  function boot(source, url) {
    const log = [];
    let closed = false;   // 닫은 뒤에 저장 회신이 돌아와 없는 문서를 만지지 않게(회신을 영영 보류한다)
    const handlers = { saveState: { ok: true } };
    const dom = new JSDOM(source, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: url || 'https://tcapp.local/',
      virtualConsole: quietConsole(),
      beforeParse(win) {
        win.chrome = { webview: {
          postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} log.push({ post: o && o.cmd, msg: o }); },
          addEventListener() {}, removeEventListener() {},
        } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.setTimeout = () => 0;   // 강조 해제, 토스트, 닫기 애니메이션 타이머가 시험 중에 끼어들지 않게
        win.clearTimeout = () => {};
      },
    });
    const w = dom.window;
    w.__fakeReply = (cmd, params) => {
      if (closed) return new Promise(() => {});
      log.push({ req: cmd, params });
      const h = handlers[cmd];
      const r = typeof h === 'function' ? h(params) : h;
      return Promise.resolve(r === undefined ? { ok: false, error: 'no handler' } : r);
    };
    w.eval('hostRequest = function(cmd, params){ return window.__fakeReply(cmd, params || {}); };');
    const sess = log.find((x) => x.post === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.msg.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'demo', name: '(예시) 사용자' } }) + ')');
    const doc = w.document;
    return {
      w, doc, log,
      ev: (code) => w.eval(code),
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      $: (sel) => doc.querySelector(sel),
      $$: (sel) => [...doc.querySelectorAll(sel)],
      show: (y, m, sel) => w.eval(`view = {y:${y}, m:${m}}; selectedDate = '${sel}'; focusDs = null; noteTab = 'detail'; renderAll();`),
      entry: (id) => JSON.parse(w.eval(`JSON.stringify(entryById(${JSON.stringify(id)}))`)),
      todo: (id) => JSON.parse(w.eval(`JSON.stringify(todoById(${JSON.stringify(id)}))`)),
      close: () => { closed = true; try { w.close(); } catch (_) {} },
    };
  }
  async function withBoot(source, fn, url, meta) {
    const W = boot(source, url);
    try {
      W.w.__applyState(JSON.stringify(DATA), meta || META);
      await settle();
      W.show(2026, 9, '2026-10-15');
      return await fn(W);
    } finally { await settle(); W.close(); }
  }
  //  date 를 덮는 막대(주 줄의 .chip-bar). __col 에 그 날의 칸 번호를 실어 돌려준다.
  function barAt(W, date, sel) {
    for (const wk of W.$$('#grid .gridrow[data-from]')) {
      const col = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(wk.dataset.from + 'T00:00:00Z')) / 86400000);
      if (col < 0 || col > 6) continue;
      const b = [...wk.querySelectorAll('.chip-bar' + sel)].find((x) => Number(x.dataset.c0) <= col && Number(x.dataset.c1) >= col);
      if (b) { b.__col = col; return b; }
    }
    return null;
  }
  //  주 줄 폭을 700px 로 둔다(칸 하나 100px). jsdom 에는 배치가 없어서 좌표를 시험이 정한다.
  const sizeWeek = (el) => { const wk = el.closest('.gridrow'); wk.getBoundingClientRect = () => ({ left: 0, top: 0, right: 700, bottom: 100, width: 700, height: 100, x: 0, y: 0 }); return wk; };
  function clickAt(W, el, col) {
    sizeWeek(el);
    el.dispatchEvent(new W.w.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: col * 100 + 50, clientY: 40 }));
  }
  function dnd(W) {
    const store = {};
    const dt = { setData: (k, v) => { store[k] = v; }, getData: (k) => store[k] || '', effectAllowed: '', dropEffect: '' };
    const fire = (el, type, col) => {
      const e = new W.w.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: dt });
      if (col != null) { sizeWeek(el); Object.defineProperty(e, 'clientX', { value: col * 100 + 50 }); Object.defineProperty(e, 'clientY', { value: 40 }); }
      el.dispatchEvent(e);
      return e;
    };
    return { store, fire };
  }
  const shown = (el) => { for (let n = el; n && n.id !== 'quickAdd'; n = n.parentElement) if (n.classList && n.classList.contains('hidden')) return false; return true; };

  const R = {
    //  막대 모양(결정 1, 4)
    async bars(source) {
      await withBoot(source, async (W) => {
        assert.ok(W.$('#grid').classList.contains('bars'), '내 창 달력이 막대 달력(.bars)이 아니다');
        assert.strictEqual(W.$$('#grid .cell .chip').length, 0, '칸 안에 예전 칩이 남아 있다');
        const segs = W.$$('#grid .chip-bar[data-id="e-long"]');
        assert.strictEqual(segs.length, 2, '10/5~10/13 막대가 주 경계에서 둘로 나뉘지 않았다: ' + segs.length);
        const [a, b] = segs;
        assert.ok(a.classList.contains('cr') && !a.classList.contains('cl') && b.classList.contains('cl') && !b.classList.contains('cr'), '잘린 쪽(cl/cr) 표시가 틀렸다');
        assert.ok(/grid-column:\s*2 \/ 8/.test(a.getAttribute('style')) && /grid-column:\s*1 \/ 4/.test(b.getAttribute('style')), '막대가 칸을 가로지르지 않는다: ' + a.getAttribute('style') + ' | ' + b.getAttribute('style'));
        assert.ok(a.textContent.includes('▸') && b.textContent.includes('◂'), '잘린 쪽에 ◂ ▸ 가 없다');
        assert.ok(a.textContent.includes('(예시) 시제품 조립') && b.textContent.includes('(예시) 시제품 조립'), '조각마다 제목을 쓰지 않는다');
        assert.strictEqual(a.querySelector('.chip-span').textContent, '10/5 ~ 10/13', '사흘 이상 막대에 기간 글자가 없다');
        assert.ok(!W.$('#grid .chip-bar[data-id="e-two"] .chip-span'), '이틀 막대에 기간 글자가 붙었다');
        //  할 일: 점선(range), 완료, 중요 별
        const tr = W.$$('#grid .chip-bar[data-todo="t-range"]');
        assert.ok(tr.length === 1 && tr[0].classList.contains('chip-todo') && tr[0].classList.contains('range') && /grid-column:\s*4 \/ 7/.test(tr[0].getAttribute('style')), '기간 할 일이 점선 막대(.chip-todo.range, 수~금)가 아니다');
        assert.ok(W.$('#grid .chip-bar[data-todo="t-done"]').classList.contains('done'), '완료 할 일에 완료 모양이 없다');
        assert.ok(W.$('#grid .chip-bar[data-todo="t-star"] .txt svg'), '중요 할 일에 별이 없다');
        //  하루 시간 일정 = 색 점 + 시각 + 제목
        const tm = W.$('#grid .chip-bar[data-id="e-time"]');
        assert.ok(tm.classList.contains('chip-timed') && tm.querySelector('.cdot') && tm.querySelector('.chip-t').textContent === '10:00', '하루 시간 일정이 점 + 시각 모양이 아니다');
        //  반복 발생: 월요일마다, 끌 수 없음
        const wk = W.$$('#grid .chip-bar[data-id="e-wk"]');
        assert.deepStrictEqual(wk.map((x) => x.dataset.occ), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'], '반복 발생이 다르다');
        assert.ok(wk.every((x) => x.dataset.kind === 'recur' && x.getAttribute('draggable') === 'false'), '반복 발생을 끌 수 있다');
        //  옛 작업일지 기록은 읽지 않으므로 칸에 없다(2026-10-26 Git 삭제), 휴일 글자
        assert.ok(!W.$('#grid .chip-bar[data-id="e-git"]'), '작업일지가 달력에 그려졌다');
        assert.ok(/개천절/.test(W.$('#grid .cell[data-date="2026-10-03"] .hol').textContent), '휴일 이름이 없다');
        //  칸 접근성 이름에 그날 기록 수(막대 포함)
        assert.ok(/기록 2건/.test(W.$('#grid .cell[data-date="2026-10-12"]').getAttribute('aria-label')), '칸의 기록 수가 막대를 세지 않는다: ' + W.$('#grid .cell[data-date="2026-10-12"]').getAttribute('aria-label'));
      });
    },
    //  +N 과 밀도
    async moreAndDensity(source) {
      await withBoot(source, async (W) => {
        const wk = W.$('#grid .gridrow[data-from="2026-10-18"]');
        Object.defineProperty(wk, 'clientHeight', { configurable: true, get: () => 106 });
        W.ev('fitChips()');
        const more = [...wk.querySelectorAll('.more')];
        assert.deepStrictEqual(more.map((m) => [m.dataset.more, m.firstChild.textContent]), [['2026-10-23', '+3']], '+N 이 다르다');
        assert.strictEqual(more[0].style.gridRow, '4', '+N 이 보이는 마지막 차선 다음 줄에 있지 않다');
        assert.strictEqual([...wk.querySelectorAll('.chip-bar')].filter((b) => b.style.display === 'none').length, 3, '넘친 기록이 숨지 않았다');
        assert.strictEqual(more[0].getAttribute('aria-label'), '+3개 더보기');
        more[0].dispatchEvent(new W.w.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(W.ev('selectedDate'), '2026-10-23', '+N 을 눌러 그 날짜를 고르지 않았다');
        //  밀도: 촘촘히, 펼침, 고정
        W.ev("setCalDensity('dense')");
        assert.ok(W.$('#grid').classList.contains('bars') && W.$('#grid').classList.contains('dense'), '촘촘히가 막대 달력에 걸리지 않았다');
        W.ev("setCalDensity('expand')");
        assert.ok(W.$('#grid').classList.contains('expand') && !W.$('#grid').classList.contains('dense'), '펼침이 걸리지 않았다');
        assert.strictEqual(W.$$('#grid .more').length, 0, '펼침인데 +N 이 있다');
        W.ev("setCalDensity('fixed')");
        assert.ok(!W.$('#grid').classList.contains('expand') && !W.$('#grid').classList.contains('dense'), '고정으로 돌아오지 않았다');
      });
    },
    //  누르기(결정 2): 누른 칸의 날짜, 좌표가 없으면 그 조각의 첫 칸
    async click(source) {
      await withBoot(source, async (W) => {
        const b = barAt(W, '2026-10-12', '[data-id="e-long"]');
        clickAt(W, b, b.__col);
        assert.strictEqual(W.ev('selectedDate'), '2026-10-12', '막대를 누른 칸(10/12)이 아니라 다른 날을 골랐다: ' + W.ev('selectedDate'));
        assert.strictEqual(W.ev('noteTab'), 'detail');
        assert.ok(W.$('#dpBody .card.flash[data-id="e-long"]'), '오른쪽 패널에 그 일정 카드가 강조되지 않았다');
        assert.ok(!W.$('.pc-pop, #pcPop'), '목록 창이 열렸다(개인 탭에는 없다)');
        const sel = W.$$('#grid .cell.sel').map((c) => c.dataset.date);
        assert.deepStrictEqual(sel, ['2026-10-12'], '달력 선택 표시가 누른 칸이 아니다');
        //  할 일 막대 → 할 일 탭
        const t = barAt(W, '2026-10-16', '[data-todo="t-range"]');
        clickAt(W, t, t.__col);
        assert.strictEqual(W.ev('selectedDate'), '2026-10-16'); assert.strictEqual(W.ev('noteTab'), 'todo');
        assert.ok(W.$('#dpBody .todo-row.flash[data-id="t-range"]'), '할 일 행이 강조되지 않았다');
        //  좌표 없는 누르기(키보드 등) → 그 주 조각의 첫 칸(시작일 10/5 의 달로 튀지 않는다)
        b.dispatchEvent(new W.w.MouseEvent('click', { bubbles: true, cancelable: true }));
        assert.strictEqual(W.ev('selectedDate'), '2026-10-11', '좌표 없는 누르기가 그 조각의 첫 칸이 아니다');
        //  9월에서 이어진 막대를 10/1 칸에서 → 10월 그대로
        const s = barAt(W, '2026-10-01', '[data-id="e-sep"]');
        clickAt(W, s, s.__col);
        assert.deepStrictEqual(W.evJSON('view'), { y: 2026, m: 9 }, '달이 바뀌었다');
        assert.strictEqual(W.ev('selectedDate'), '2026-10-01');
        //  키보드 이동은 그대로(칸에서 → 다음 날)
        const c = W.$('#grid .cell[data-date="2026-10-14"]');
        W.ev("focusGridDate('2026-10-14')");
        c.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        assert.strictEqual(W.doc.activeElement && W.doc.activeElement.dataset.date, '2026-10-15', '방향키 이동이 깨졌다');
      });
    },
    //  끌어 옮기기(결정 3)
    async drag(source) {
      //  ① 잡은 자리: 10/9 를 잡아 10/11 칸에 → +2일, 길이 유지, 저장
      await withBoot(source, async (W) => {
        const { store, fire } = dnd(W);
        const b = barAt(W, '2026-10-09', '[data-id="e-long"]');
        fire(b, 'dragstart', b.__col);
        assert.strictEqual(JSON.parse(store['text/plain']).grab, '2026-10-09', '잡은 날이 실리지 않았다');
        const before = W.log.filter((x) => x.req === 'saveState').length;
        fire(W.$('#grid .cell[data-date="2026-10-11"]'), 'drop');
        await settle();
        const e = W.entry('e-long');
        assert.deepStrictEqual([e.date, e.endDate], ['2026-10-07', '2026-10-15'], '잡은 자리 기준 이동이 아니다: ' + e.date + '~' + e.endDate);
        assert.ok(W.log.filter((x) => x.req === 'saveState').length > before, '옮긴 뒤 저장(saveState)이 없다');
        assert.strictEqual(W.ev('selectedDate'), '2026-10-11', '놓은 칸이 선택되지 않았다');
      });
      //  ② 주를 넘어: 둘째 주 조각의 10/12 를 잡아 10/19 에 → +7
      await withBoot(source, async (W) => {
        const { fire } = dnd(W);
        const b = barAt(W, '2026-10-12', '[data-id="e-long"]');
        fire(b, 'dragstart', b.__col);
        fire(W.$('#grid .cell[data-date="2026-10-19"]'), 'drop');
        const e = W.entry('e-long');
        assert.deepStrictEqual([e.date, e.endDate], ['2026-10-12', '2026-10-20'], '주를 넘는 이동이 다르다');
      });
      //  ③ 달을 넘어: 9/29~10/2 의 10/1 을 잡아 10/6 에 → +5(10/4~10/7) / 10/7~10/8 의 10/8 을 잡아 흐린 9/30 칸에 → -8(9/29~9/30)
      await withBoot(source, async (W) => {
        const { fire } = dnd(W);
        const b = barAt(W, '2026-10-01', '[data-id="e-sep"]');
        fire(b, 'dragstart', b.__col);
        fire(W.$('#grid .cell[data-date="2026-10-06"]'), 'drop');
        const e = W.entry('e-sep');
        assert.deepStrictEqual([e.date, e.endDate], ['2026-10-04', '2026-10-07'], '9월에서 10월로 넘는 이동이 다르다');
        W.show(2026, 9, '2026-10-15');
        const t = barAt(W, '2026-10-08', '[data-id="e-two"]');
        fire(t, 'dragstart', t.__col);
        fire(W.$('#grid .cell[data-date="2026-09-30"]'), 'drop');
        const e2 = W.entry('e-two');
        assert.deepStrictEqual([e2.date, e2.endDate], ['2026-09-29', '2026-09-30'], '앞 달 칸으로 옮기기가 다르다');
      });
      //  ④ 기간 할 일: 10/16 을 잡아 10/20 에 → +4 / ⑤ 놓은 곳이 막대여도 손가락 아래 칸 / ⑥ 반복은 끌 수 없다
      await withBoot(source, async (W) => {
        const { store, fire } = dnd(W);
        const t = barAt(W, '2026-10-16', '[data-todo="t-range"]');
        fire(t, 'dragstart', t.__col);
        fire(W.$('#grid .cell[data-date="2026-10-20"]'), 'drop');
        const td = W.todo('t-range');
        assert.deepStrictEqual([td.due, td.endDate], ['2026-10-18', '2026-10-20'], '기간 할 일 이동이 잡은 자리 기준이 아니다');
        W.show(2026, 9, '2026-10-15');
        const s = barAt(W, '2026-10-15', '[data-id="e-time"]');
        fire(s, 'dragstart', s.__col);
        const over = barAt(W, '2026-10-12', '[data-id="e-long"]');   // 10/11~10/13 막대 위, 10/12 자리에 놓는다
        fire(over, 'drop', 1);
        assert.strictEqual(W.entry('e-time').date, '2026-10-12', '막대 위에 놓았을 때 손가락 아래 칸을 찾지 못했다');
        for (const k of Object.keys(store)) delete store[k];
        const r = barAt(W, '2026-10-12', '[data-id="e-wk"]');
        const ev = fire(r, 'dragstart', r.__col);
        assert.ok(ev.defaultPrevented && !store['text/plain'], '반복 일정을 끌 수 있다');
      });
    },
    //  열람 창(PEER)도 같은 주 단위 기간 막대(docs/PEER-RANGE-BARS.md 시안 B)
    async peer(source) {
      await withBoot(source, async (W) => {
        assert.strictEqual(W.ev('PEER'), true, '사전조건: ?peer=1 은 열람 창이다');
        W.show(2026, 9, '2026-10-15');
        assert.ok(W.$('#grid').classList.contains('bars'), '열람 창 달력이 막대 달력(.bars)이 아니다');
        const segs = W.$$('#grid .chip-bar[data-id="e-long"]');
        assert.strictEqual(segs.length, 2, '열람 창의 10/5~10/13 기간 일정이 주 경계에서 두 막대로 나뉘지 않았다: ' + segs.length);
        assert.ok(segs[0].classList.contains('cr') && segs[1].classList.contains('cl'), '열람 창 막대의 잘린 쪽(cl/cr) 표시가 없다');
        assert.ok(W.$$('#grid .chip').every((c) => c.getAttribute('draggable') === 'false'), '열람 창 칩을 끌 수 있다');
      }, 'https://tcapp.local/?peer=1', { peerName: '(예시) 상대', canWrite: false });
    },
    //  한 화면 폼(결정 6): 모든 칸이 처음부터, 할 일은 칸이 바뀐다
    async form(source) {
      await withBoot(source, async (W) => {
        W.ev("openQuickAdd('2026-10-15')");
        const ev = ['qaTitle', 'qaDate', 'qaEndDate', 'qaCat', 'qaAllDay', 'qaStart', 'qaEnd', 'qaRemBlock', 'qaRecur', 'qaLoc', 'qaMemo', 'qaSave'];
        for (const id of ev) assert.ok(W.$('#' + id) && shown(W.$('#' + id)), `일정 폼에 #${id} 가 처음부터 보이지 않는다`);
        assert.ok(!shown(W.$('#qaPrio')), '일정 폼에 중요가 보인다');
        assert.ok(!W.$('#qaMore') && !W.$('#qaDetail') && !W.$('#qaAdvanced'), '옵션 더보기나 자세히 편집이 있다');
        assert.strictEqual(W.$('#qaEndDate').value, '2026-10-15', '새 일정의 종료일 기본값이 시작일이 아니다');
        assert.strictEqual(W.$('#qaMemoLb').textContent, '메모');
        //  할 일로 바꾸면: 시각, 미리알림, 반복, 장소가 빠지고 중요가 생긴다. 종료일은 비운다(선택).
        W.$('#quickAdd [data-qatype="todo"]').dispatchEvent(new W.w.MouseEvent('click', { bubbles: true }));
        for (const id of ['qaTitle', 'qaDate', 'qaEndDate', 'qaCat', 'qaPrio', 'qaMemo']) assert.ok(shown(W.$('#' + id)), `할 일 폼에 #${id} 가 보이지 않는다`);
        for (const id of ['qaWhen', 'qaRecurWrap', 'qaLocWrap']) assert.ok(!shown(W.$('#' + id)), `할 일 폼에 #${id} 가 보인다`);
        assert.strictEqual(W.$('#qaEndDate').value, '', '할 일 종료일 기본값이 비어 있지 않다');
        assert.strictEqual(W.$('#qaDateLb').textContent, '기한');
        W.$('#qaEndDate').value = '2026-10-17'; W.$('#qaEndDate').dispatchEvent(new W.w.Event('input'));
        assert.ok(/시작일 설명/.test(W.$('#qaMemoLb').textContent), '기간 할 일 설명 라벨이 바뀌지 않았다');
        //  할 일 저장: 저장 형식은 예전 addTodo 그대로(기간 할 일 설명은 시작일 dayNote)
        W.ev("$('#qaTitle').value = '(예시) 새 할 일'; $('#qaMemo').value = '(예시) 첫날 설명'; $('#qaPrio').checked = true; qaSave();");
        const t = W.evJSON("state.todos.find(function(t){ return t.text === '(예시) 새 할 일'; })");
        assert.ok(t && t.due === '2026-10-15' && t.endDate === '2026-10-17' && t.prio === 'high' && t.dayNotes && t.dayNotes['2026-10-15'] === '(예시) 첫날 설명', '할 일 저장 형식이 다르다: ' + JSON.stringify(t));
        //  새 일정(여러 날 + 장소 + 반복 매월): 저장 형식은 addEntry 그대로
        W.ev("openQuickAdd('2026-10-26')");
        W.ev("$('#qaTitle').value = '(예시) 새 기간 일정'; $('#qaEndDate').value = '2026-10-28'; $('#qaAllDay').checked = true; $('#qaLoc').value = '(예시) 현장'; $('#qaRecur').value = 'monthly'; qaSave();");
        const e = W.evJSON("state.entries.find(function(e){ return e.title === '(예시) 새 기간 일정'; })");
        assert.ok(e && e.date === '2026-10-26' && e.endDate === '2026-10-28' && e.allDay === true && e.location === '(예시) 현장', '새 일정 저장 형식이 다르다: ' + JSON.stringify(e));
        assert.deepStrictEqual(e.recur, { freq: 'monthly', interval: 1, until: '', count: 0 }, '새 반복 일정의 반복 값이 기본값이 아니다');
      });
    },
    //  반복 세부 값 보존과 요약(결정 8), 옛 작업일지 기록은 읽지 않는다(2026-10-26 Git 삭제)
    async recur(source) {
      await withBoot(source, async (W) => {
        W.ev("editEntry('e-rc')");
        assert.ok(W.ev("isOverlayOpen(document.getElementById('quickAdd'))"), '반복 일정 수정이 한 화면 폼으로 열리지 않았다');
        assert.strictEqual(W.$('#qaRecur').value, 'weekly');
        const hint = W.$('#qaRecurHint');
        assert.ok(!hint.classList.contains('hidden') && /2주마다/.test(hint.textContent) && /10회/.test(hint.textContent), '반복 세부 값 요약이 없다: ' + hint.textContent);
        assert.strictEqual(W.$('#qaLoc').value, '(예시) 회의실 A'); assert.strictEqual(W.$('#qaMemo').value, '(예시) 메모');
        W.ev("$('#qaTitle').value = '(예시) 격주 점검 고침'; qaSave();");
        const e = W.entry('e-rc');
        assert.strictEqual(e.title, '(예시) 격주 점검 고침');
        assert.deepStrictEqual(e.recur, { freq: 'weekly', interval: 2, until: '', count: 10 }, '반복 세부 값(간격, 횟수)이 저장에서 지워졌다');
        assert.deepStrictEqual(e.recurExcept, ['2026-10-20'], '건너뛴 날짜가 지워졌다');
        assert.strictEqual(e.location, '(예시) 회의실 A');
        //  매월로 바꾸면 세부 값은 기본(간격 1, 끝 없음), 건너뛴 날짜는 뜻을 잃어 비운다
        W.ev("editEntry('e-rc'); $('#qaRecur').value = 'monthly'; $('#qaRecur').dispatchEvent(new Event('change'));");
        assert.ok(/매월/.test(W.$('#qaRecurHint').textContent) && !/10회/.test(W.$('#qaRecurHint').textContent), '종류를 바꿔도 예전 세부 값 요약이 남았다');
        W.ev('qaSave()');
        const e2 = W.entry('e-rc');
        assert.deepStrictEqual([e2.recur, e2.recurExcept], [{ freq: 'monthly', interval: 1, until: '', count: 0 }, []], '종류를 바꾼 반복 값이 다르다');
        //  옛 작업일지 기록(source git)은 부팅 때 버려져 state 에 없다(2026-10-26 Git 삭제)
        assert.strictEqual(W.ev("entryById('e-git')"), null, '옛 작업일지 기록이 state 에 남았다');
      });
    },
    //  시각 칸(결정 7): 5분 단위가 아닌 값은 그대로 보이고 그대로 저장된다
    async oddTime(source) {
      await withBoot(source, async (W) => {
        W.ev("editEntry('e-odd')");
        const s = W.$('#qaStart'), e = W.$('#qaEnd');
        assert.ok(s.__tf && e.__tf && s.type === 'text', '시각 칸이 앱 시각 칸(timeField)이 아니다');
        assert.deepStrictEqual([s.value, e.value], ['11:38', '12:07'], '5분 단위가 아닌 값이 그대로 보이지 않는다');
        W.ev('qaSave()');
        const x = W.entry('e-odd');
        assert.deepStrictEqual([x.startTime, x.endTime], ['11:38', '12:07'], '5분 단위가 아닌 값이 저장에서 바뀌었다');
        assert.ok(!W.ev("isOverlayOpen(document.getElementById('quickAdd'))") || W.$('#quickAdd').classList.contains('closing'), '저장이 막혀 창이 닫히지 않았다');
        //  과제 폼의 시각 칸도 같은 값을 그대로 둔다
        const pv = W.evJSON("pcValidate({ projectUid: 'p1', title: '(예시)', startDate: '2026-10-21', endDate: '2026-10-21', startTime: '11:38', endTime: '12:07', location: '', memo: '' }, PCAL_LIMITS)");
        assert.strictEqual(pv.ok, true, '과제 폼 검증이 5분 단위가 아닌 시각을 막는다: ' + JSON.stringify(pv));
      });
    },
    //  시각 고르기(결정 7): 앱이 만든 목록. 위젯의 type=time 은 step 을 무시했다. 직접 치기는 없다(읽기 전용 칸).
    async picker(source) {
      await withBoot(source, async (W) => {
        const w = W.w;
        const key = (el, k, o) => el.dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})));
        const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
        const down = (el) => el.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        const pop = (el) => el.__tf.pop;
        const isOpen = (el) => !pop(el).classList.contains('hidden') && el.getAttribute('aria-expanded') === 'true';
        const opts = (el, c) => [...pop(el).querySelectorAll(`#${el.id}Tf${c} .tf-opt`)];
        const opt = (el, c, txt) => opts(el, c).find((o) => o.textContent === txt);
        const sel = (el, c) => opts(el, c).filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.textContent);
        const act = (el) => { const a = el.getAttribute('aria-activedescendant'); return a ? w.document.getElementById(a).textContent : null; };
        const MIN12 = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
        //  네 칸 모두 같은 부품: 읽기 전용 combobox, 시계 단추, 창(.overlay)에 붙은 목록, 시 24개, 분 정확히 12개(5분 단위)
        for (const id of TIME_IDS) {
          const el = W.$('#' + id);
          assert.ok(el && el.__tf && el.type === 'text' && el.readOnly && el.getAttribute('role') === 'combobox' && el.getAttribute('aria-haspopup') === 'listbox', `#${id} 가 읽기 전용 앱 시각 칸(combobox)이 아니다`);
          assert.ok(el.parentElement.classList.contains('tf') && el.parentElement.querySelector('.tf-btn'), `#${id} 에 시계 단추가 없다`);
          assert.strictEqual(el.getAttribute('placeholder'), '--:--');
          const p = pop(el);
          assert.ok(p.parentElement.classList.contains('overlay') && !el.closest('.modal').contains(p), `#${id} 목록이 창(.overlay)에 붙지 않았다(창 본문 overflow 에 잘린다)`);
          assert.strictEqual(p.querySelectorAll('[role="listbox"]').length, 2, `#${id} 목록에 시와 분 listbox 가 없다`);
          assert.strictEqual(opts(el, 'H').length, 24, `#${id} 시 목록이 24개가 아니다`);
          assert.deepStrictEqual(opts(el, 'M').map((o) => o.textContent), MIN12, `#${id} 분 목록이 5분 단위 12개가 아니다`);
          assert.ok(opts(el, 'M').every((o) => o.getAttribute('role') === 'option'), `#${id} 분 항목이 option 이 아니다`);
          assert.ok(p.querySelector('.tf-clr'), `#${id} 목록에 지우기가 없다`);
        }
        //  11:38: 그대로 보이고, 목록은 시 11 만 골라진 표시(분 없음)
        W.ev("editEntry('e-odd')");
        const s = W.$('#qaStart'), e = W.$('#qaEnd');
        s.focus(); click(s);
        assert.ok(isOpen(s), '칸을 눌러도 목록이 뜨지 않는다');
        assert.strictEqual(s.value, '11:38');
        assert.deepStrictEqual([sel(s, 'H'), sel(s, 'M')], [['11'], []], '11:38 의 골라진 표시가 시 11, 분 없음이 아니다');
        assert.strictEqual(act(s), '11', '키보드 자리가 지금 시(11)가 아니다');
        //  Esc 는 목록만 닫는다(창은 그대로). 한 번 더 누르면 그때 창의 Esc(맨 위 창 닫기)가 돈다
        key(s, 'Escape');
        await settle();
        assert.ok(!isOpen(s), 'Esc 로 목록이 닫히지 않았다');
        assert.ok(W.ev("isOverlayOpen(document.getElementById('quickAdd')) && !document.getElementById('quickAdd').classList.contains('closing') && openOverlays().pop().id === 'quickAdd'"), 'Esc 가 목록과 함께 창까지 닫았다(또는 확인 창을 띄웠다)');
        key(s, 'Escape');
        await settle();
        assert.ok(!W.ev("isOverlayOpen(document.getElementById('quickAdd'))") || W.$('#quickAdd').classList.contains('closing'), '목록이 닫힌 뒤의 Esc 가 창을 닫지 않는다(전역 Esc 순서가 깨졌다)');
        //  고르기: 새 일정. 시를 고르면 분은 00, input 과 change 가 가고 시작 변경 처리(종료 +1시간)가 돈다. 분을 고르면 값이 정해지고 닫힌다
        W.ev("closeOverlay(document.getElementById('quickAdd')); document.getElementById('quickAdd').classList.remove('closing'); document.getElementById('quickAdd').classList.add('hidden'); openQuickAdd('2026-10-16', 'event')");
        const n = { input: 0, change: 0 };
        s.addEventListener('input', () => n.input++); s.addEventListener('change', () => n.change++);
        assert.strictEqual(s.value, '');
        s.focus(); click(s.parentElement.querySelector('.tf-btn'));
        assert.ok(isOpen(s), '시계 단추로 목록이 뜨지 않는다');
        assert.strictEqual(act(s), '09', '빈 칸의 키보드 자리가 09 가 아니다');
        click(opt(s, 'H', '10'));
        assert.deepStrictEqual([s.value, n.input, n.change, isOpen(s)], ['10:00', 1, 1, true], '시를 고르면 HH:00, input 과 change 한 번씩, 목록은 열린 채여야 한다');
        assert.strictEqual(e.value, '11:00', '시작을 고르면 종료가 1시간 뒤로 따라오지 않는다(change 처리가 돌지 않았다)');
        click(opt(s, 'M', '05'));
        assert.deepStrictEqual([s.value, n.input, n.change, isOpen(s)], ['10:05', 2, 2, false], '분을 고르면 값이 정해지고 목록이 닫혀야 한다');
        assert.strictEqual(e.value, '11:05');
        //  시를 고르면 분은 그대로(11:38 류 포함)
        W.ev("writeTimeIn($('#qaStart'), '11:38')");
        click(s); click(opt(s, 'H', '14'));
        assert.strictEqual(s.value, '14:38', '시를 고르면 분이 그대로여야 한다');
        key(s, 'Escape');
        //  키보드: Alt+아래로 열고, 위아래로 한 열 안에서, 오른쪽으로 분 열, Enter 로 고른다. Space 와 Enter 도 연다
        e.focus(); key(e, 'ArrowDown', { altKey: true });
        assert.ok(isOpen(e) && act(e) === '15', 'Alt+아래로 열리지 않거나 키보드 자리가 지금 시(15)가 아니다: ' + act(e));
        key(e, 'ArrowDown'); key(e, 'ArrowDown'); assert.strictEqual(act(e), '17');
        key(e, 'ArrowUp'); assert.strictEqual(act(e), '16');
        key(e, 'Enter');
        assert.deepStrictEqual([e.value, isOpen(e)], ['16:38', true], 'Enter 로 시를 고르지 못했다(분은 그대로여야 한다)');
        key(e, 'ArrowRight'); assert.strictEqual(act(e), '00', '오른쪽으로 분 열에 가지 않는다');
        key(e, 'ArrowDown'); key(e, 'ArrowDown'); key(e, 'ArrowDown');
        key(e, 'Enter');
        assert.deepStrictEqual([e.value, isOpen(e)], ['16:15', false], '분 열에서 Enter 로 고르고 닫히지 않았다');
        key(e, ' '); assert.ok(isOpen(e), 'Space 로 열리지 않는다'); key(e, 'Escape');
        key(e, 'Enter'); assert.ok(isOpen(e), 'Enter 로 열리지 않는다');
        assert.ok(e.getAttribute('aria-activedescendant') && e.getAttribute('aria-controls') === e.id + 'TfH', 'aria-activedescendant, aria-controls 가 없다');
        //  지우기(목록 안). 시각 없는 일정이 된다
        click(pop(e).querySelector('.tf-clr'));
        assert.deepStrictEqual([e.value, isOpen(e)], ['', false], '지우기가 값을 비우고 닫지 않았다');
        s.focus(); key(s, 'Delete');
        assert.strictEqual(s.value, '', 'Delete 로 비워지지 않는다');
        //  바깥 누르기, 창 닫기에 목록이 닫힌다
        click(s); assert.ok(isOpen(s));
        down(W.$('#qaTitle')); assert.ok(!isOpen(s), '바깥을 눌러도 목록이 닫히지 않는다');
        click(s); W.ev("closeOverlay(document.getElementById('quickAdd'))");
        assert.ok(!isOpen(s), '창을 닫아도 목록이 남아 있다');
        //  종일은 시각 줄을 숨긴다(예전 그대로)
        W.ev("document.getElementById('quickAdd').classList.remove('closing'); document.getElementById('quickAdd').classList.add('hidden'); openQuickAdd('2026-10-16', 'event'); $('#qaAllDay').checked = true; $('#qaAllDay').dispatchEvent(new Event('change', { bubbles: true }))");
        assert.strictEqual(W.$('#qaTimeRow').style.display, 'none', '종일인데 시각 줄이 보인다');
        //  과제 폼: 고르면 pcFormSync(안내)가 돌고, 둘 다 또는 둘 다 비움, 하루 일정만 규칙이 그대로
        const ps = W.$('#pcfST'), pe = W.$('#pcfET');
        W.ev("document.getElementById('pcfTitle').value = '(예시)'; document.getElementById('pcfStart').value = '2026-10-21'; document.getElementById('pcfEnd').value = '2026-10-22'; writeTimeIn($('#pcfST'), ''); writeTimeIn($('#pcfET'), ''); pcFormSync();");
        const pv = () => W.evJSON("pcValidate(Object.assign(pcFormRead(), { projectUid: 'p1' }), PCAL_LIMITS)");
        assert.strictEqual(pv().ok, true, '시각 없는 여러 날 일정이 막힌다');
        ps.focus(); click(ps); click(opt(ps, 'H', '09')); key(ps, 'Escape');
        assert.strictEqual(ps.value, '09:00');
        assert.ok(/하루 일정에서만/.test(W.$('#pcfTimeHint').textContent), '과제 폼 시각을 골라도 안내(pcFormSync)가 돌지 않았다: ' + W.$('#pcfTimeHint').textContent);
        assert.ok(/둘 다 적거나 둘 다 비웁니다/.test(pv().error || pv().msg || JSON.stringify(pv())), '시작 시각만 있는데 막지 않는다: ' + JSON.stringify(pv()));
        pe.focus(); click(pe); click(opt(pe, 'H', '10')); click(opt(pe, 'M', '00'));
        assert.ok(/하루 일정에서만/.test(JSON.stringify(pv())), '여러 날 일정에 시각이 있는데 막지 않는다: ' + JSON.stringify(pv()));
        W.ev("document.getElementById('pcfEnd').value = '2026-10-21'; document.getElementById('pcfEnd').dispatchEvent(new Event('change', { bubbles: true }))");
        assert.strictEqual(pv().ok, true, '하루 일정 09:00~10:00 이 막힌다: ' + JSON.stringify(pv()));
        click(ps); click(pop(ps).querySelector('.tf-clr')); click(pe); click(pop(pe).querySelector('.tf-clr'));
        assert.deepStrictEqual([ps.value, pe.value, pv().ok], ['', '', true], '지우기로 날짜만 있는 일정이 되지 않는다');
        assert.ok(/날짜만 있는 일정/.test(W.$('#pcfTimeHint').textContent), '시각을 비워도 안내가 바뀌지 않는다');
      });
    },
  };

  test('R①: 막대 모양(주 경계 나눔, ◂ ▸, 기간 글자, 할 일 점선과 완료와 별, 시간 일정 점, 반복 발생, 휴일)', () => R.bars(src));
  test('R②: +N(넘친 칸만, 누르면 그 날짜)과 월 보기 밀도(고정, 촘촘히, 펼침)', () => R.moreAndDensity(src));
  test('R③: 막대를 누르면 누른 칸의 날짜, 패널 강조, 목록 창 없음, 좌표 없으면 그 조각 첫 칸, 키보드 이동 그대로', () => R.click(src));
  test('R④: 끌어 옮기기는 잡은 자리 기준(주와 달을 넘어도 길이 유지), 막대 위에 놓아도 아래 칸, 반복은 못 끈다, 저장', () => R.drag(src));
  test('R⑤: 열람 창(PEER)도 같은 주 단위 기간 막대로 그려지고 읽기 전용(draggable=false)이다', () => R.peer(src));
  test('R⑥: 한 화면 폼(일정과 할 일 칸, 옵션 더보기 없음, 저장 형식 그대로)', () => R.form(src));
  test('R⑦: 반복 세부 값 보존과 한 줄 요약, 종류를 바꾸면 기본값, 옛 작업일지 기록은 읽지 않는다', () => R.recur(src));
  test('R⑧: 5분 단위가 아닌 시각(11:38)이 그대로 보이고 저장된다(개인 폼, 과제 폼 검증)', () => R.oddTime(src));
  test('R⑨: 앱 시각 고르기(네 칸 같은 부품, 분 12개, 고르면 HH:MM 과 input change, 11:38 표시, Esc 는 목록만, 키보드, 지우기, 과제 폼 규칙)', () => R.picker(src));

  test('변이R①: 할 일 막대에서 점선 표시(range)를 빼면 R① 이 잡는다', async () => {
    await assert.rejects(() => R.bars(mutate("  const edge = (it.multi ? ' range' : '') + (it.cl ? ' cl' : '') + (it.cr ? ' cr' : '');", "  const edge = (it.cl ? ' cl' : '') + (it.cr ? ' cr' : '');")), /점선/);
  });
  test('변이R②: 누른 칸 대신 막대 첫 칸을 고르면 R③ 이 잡는다', async () => {
    await assert.rejects(() => R.click(mutate('  col = Math.max(c0, Math.min(c1, col));\n  return addDays(wk.dataset.from, col);', '  col = c0;\n  return addDays(wk.dataset.from, col);')), /누른 칸/);
  });
  test('변이R③: 끌기를 예전 시작일 기준으로 되돌리면 R④ 가 잡는다', async () => {
    await assert.rejects(() => R.drag(mutate('shiftByGrab(e.date, e.endDate, p.grab || p.occ || e.date, target)', 'shiftByGrab(e.date, e.endDate, p.occ || e.date, target)')), /잡은 자리/);
  });
  test('변이R④: 열람 창을 옛 칸별 칩으로 되돌리면 R⑤ 가 잡는다', async () => {
    await assert.rejects(() => R.peer(mutate("  renderMonthBars($('#grid'), dens,", "  renderMonthGrid($('#grid'), dens,")), /열람 창/);
  });
  test('변이R⑤: 반복 세부 값을 버리면(늘 간격 1) R⑦ 이 잡는다', async () => {
    await assert.rejects(() => R.recur(mutate('  if(qaRecurOrig && qaRecurOrig.freq === f) return { freq:f, interval:qaRecurOrig.interval, until:qaRecurOrig.until, count:qaRecurOrig.count };', '')), /세부 값/);
  });
  test('변이R⑦: 분 간격 1, Esc 가 창까지 닫기, change 를 안 보내기, 지우기 없애기를 R⑨ 가 잡는다', async () => {
    await assert.rejects(() => R.picker(mutate('\nconst TF_STEP = 5;', '\nconst TF_STEP = 1;')), /5분 단위 12개/);
    await assert.rejects(() => R.picker(mutate('    ev.preventDefault(); ev.stopImmediatePropagation();\n    tfClose(__tfOpen);', '    tfClose(__tfOpen);')), /창까지 닫았다/);
    await assert.rejects(() => R.picker(mutate("  T.el.dispatchEvent(new Event('change', { bubbles: true }));\n  if(__tfOpen === T) tfRender(T);", '  if(__tfOpen === T) tfRender(T);')), /change/);
    await assert.rejects(() => R.picker(mutate("if(t.closest && t.closest('.tf-clr')){ tfCommit(T, ''); tfClose(T); return; }", '')), /지우기/);
  });
  test('변이R⑥: 시각을 5분 단위로 깎아 읽으면 R⑧ 이 잡는다', async () => {
    await assert.rejects(() => R.oddTime(mutate("function readTimeIn(el){ const v = el ? String(el.value || '') : ''; return HM_RE.test(v) ? v : ''; }", "function readTimeIn(el){ const v = el ? String(el.value || '') : ''; return HM_RE.test(v) ? v.slice(0, 4) + (Number(v[4]) < 5 ? '0' : '5') : ''; }")), /저장에서 바뀌었다/);
  });
}
