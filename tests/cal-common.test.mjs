// 공용 달력(docs/CALENDAR-COMMON.md) 시험. 주 규칙을 한 곳(웹의 공용 달력 구간)에 모은 것이 화면마다 새로 생기지 않게 지킨다.
//   달력 한 주 = 일~토, 주간 보기 = 월~일, 회사 보고 기간 = 그 달력 한 주의 월~토.
//
// 이 파일이 지키는 것:
//   (R) 공용 함수 실행: 1일이 일요일인 달(2026-11), 1일이 토요일인 달(2026-08), 7월 다섯째주와 8월 첫째주가 걸친 주, 일요일 당일,
//       연말연초(2026-12-27 ~ 2027-01-02), 회사 기간 월~토, 주간 보기 월~일, 칸 클래스.
//   (S) 정적: 화면 함수들이 공용 함수를 부른다. 공용 밖에 주 계산 식과 요일 배열이 다시 없다. awBuildSubmit 의 edate 는 토요일이다.
//       주간보고 제목 칸은 readonly 다. 주 고르기는 일요일 칸을 막는다.
//   (B) jsdom 주 고르기: 일요일 시작 7열 + 줄 머리, 보고 있는 달의 월~토만 누른다(일요일 칸, 앞뒤 달 날짜는 막힘), 걸친 주 제목, 공휴일, 주말 색.
//   (M) 변이: 공용 밖에 요일 배열이나 getDay 주 식을 다시 넣으면 실패, edate 를 +6 으로 되돌리면 실패, 제목 칸 readonly 를 빼면 실패,
//       일요일 칸 막기를 빼면 실패.
// ★ 회사 사이트에는 아무것도 보내지 않는다(주 고르기 화면만 연다).
// 생략 규약: jsdom 이 없으면 (B)(M 의 화면 변이)는 등록되지 않고 skip(판정 없음)으로 계수된다.
import vm from 'node:vm';
import { test, skip, assert, loadAppSource, extractFunction, extractCalCommon, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}

// ══ (R) 공용 함수 실행 ═════════════════════════════════════════════════
const HOL = { '2026-10-09': '한글날', '2026-12-25': '성탄절' };
function calCtx(src = app) {
  const code = [
    'const pad = n => String(n).padStart(2, "0");',
    'const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;',
    'const parseYmd = s => { const [y,m,dd] = s.split("-").map(Number); return new Date(y, m-1, dd); };',
    'const addDays = (s, n) => { const d = parseYmd(s); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate()+n)); };',
    'const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);',
    'const holidayOn = ds => (globalThis.__HOL || {})[ds] || "";',
    extractCalCommon(src),
    ';globalThis.__c = { CAL_DOW, CAL_ORD, calDow, calRowWeek, calViewWeek, calReportPeriod, calMonthGrid, calWeekTitle, calTone, calCellCls, calNumCls, calAria };',
  ].join('\n');
  const ctx = vm.createContext({ __HOL: HOL });
  vm.runInContext(code, ctx);
  return ctx.__c;
}
const C = calCtx();
const J = (x) => JSON.parse(JSON.stringify(x));

test('(R) 요일 이름은 일요일부터 하나', () => {
  assert.deepStrictEqual(J(C.CAL_DOW), ['일', '월', '화', '수', '목', '금', '토']);
});

test('(R) 1일이 일요일인 달(2026-11): 첫 줄이 1일 자신, 5줄, 11/1 이 든 줄이 첫째주', () => {
  assert.deepStrictEqual(J(C.calMonthGrid(2026, 10)), { from: '2026-11-01', to: '2026-12-05', weeks: 5 });
  assert.strictEqual(C.calWeekTitle('2026-11-01', 2026, 10), '11월 첫째주');
  assert.strictEqual(C.calWeekTitle('2026-11-08', 2026, 10), '11월 둘째주');
  assert.strictEqual(C.calWeekTitle('2026-11-29', 2026, 10), '11월 다섯째주', '11/29(일) 줄 = 11/30 이 든 마지막 줄');
  assert.deepStrictEqual(J(C.calReportPeriod('2026-11-10')), { mon: '2026-11-09', sat: '2026-11-14' }, '기획의 예: 11/10 을 누르면 11/9 ~ 11/14');
  assert.strictEqual(C.calWeekTitle('2026-11-10'), '11월 둘째주', '기획의 예: 제목 11월 둘째주');
});

test('(R) 1일이 토요일인 달(2026-08): 앞 줄은 7월 26일부터, 6줄, 8/1 이 첫째주', () => {
  assert.deepStrictEqual(J(C.calMonthGrid(2026, 7)), { from: '2026-07-26', to: '2026-09-05', weeks: 6 });
  assert.strictEqual(C.calWeekTitle('2026-08-01', 2026, 7), '8월 첫째주');
  assert.strictEqual(C.calWeekTitle('2026-08-30', 2026, 7), '8월 여섯째주', '8/30(일) 줄은 8/31 이 든 여섯째 줄');
  assert.deepStrictEqual(J(C.calMonthGrid(2026, 1)), { from: '2026-02-01', to: '2026-02-28', weeks: 4 }, '2026-02 는 4줄');
});

test('(R) 달이 걸친 주: 7/27 ~ 8/1 은 7월 달력에서 7월 다섯째주, 8월 달력에서 8월 첫째주, 기본은 월요일이 든 달', () => {
  assert.strictEqual(C.calWeekTitle('2026-07-27', 2026, 6), '7월 다섯째주');
  assert.strictEqual(C.calWeekTitle('2026-07-27', 2026, 7), '8월 첫째주');
  assert.strictEqual(C.calWeekTitle('2026-07-29'), '7월 다섯째주', '월요일 7/27 이 든 달');
  assert.strictEqual(C.calWeekTitle('2026-08-01'), '7월 다섯째주', '토요일 8/1 도 같은 주라 월요일이 든 7월');
  assert.deepStrictEqual(J(C.calReportPeriod('2026-08-01')), { mon: '2026-07-27', sat: '2026-08-01' }, '기간은 달 경계를 넘어도 월~토');
});

test('(R) 일요일 당일: 달력 한 주는 그날 시작하는 일~토, 회사 기간은 그 다음 날 월요일부터, 주간 보기는 지난 월~일', () => {
  assert.deepStrictEqual(J(C.calRowWeek('2026-11-01')), { sun: '2026-11-01', sat: '2026-11-07' });
  assert.deepStrictEqual(J(C.calReportPeriod('2026-11-01')), { mon: '2026-11-02', sat: '2026-11-07' });
  assert.deepStrictEqual(J(C.calViewWeek('2026-11-01')), { mon: '2026-10-26', sun: '2026-11-01' });
  assert.strictEqual(C.calWeekTitle('2026-11-01'), '11월 첫째주', '일요일 당일의 기본 제목은 그 줄의 월요일(11/2)이 든 달');
});

test('(R) 연말연초(2026-12-27 ~ 2027-01-02): 한 줄이 해를 넘고 12월 다섯째주 또는 1월 첫째주', () => {
  assert.deepStrictEqual(J(C.calRowWeek('2026-12-30')), { sun: '2026-12-27', sat: '2027-01-02' });
  assert.deepStrictEqual(J(C.calReportPeriod('2027-01-01')), { mon: '2026-12-28', sat: '2027-01-02' });
  assert.strictEqual(C.calWeekTitle('2026-12-30', 2026, 11), '12월 다섯째주');
  assert.strictEqual(C.calWeekTitle('2026-12-30', 2027, 0), '1월 첫째주', '1월 달력에서 고르면 1월 첫째주');
  assert.strictEqual(C.calWeekTitle('2026-12-30'), '12월 다섯째주', '월요일 12/28 이 든 달');
  assert.deepStrictEqual(J(C.calMonthGrid(2027, 0)), { from: '2026-12-27', to: '2027-02-06', weeks: 6 });
});

test('(R) 회사 보고 기간은 월~토, 주간 보기는 월~일, 달력 한 주는 일~토(한 줄의 모든 날이 같은 값)', () => {
  const sun = '2026-11-08';
  for (let k = 0; k < 7; k++) {
    const d = new Date(2026, 10, 8 + k), ds = `2026-11-${String(8 + k).padStart(2, '0')}`;
    assert.deepStrictEqual(J(C.calRowWeek(ds)), { sun: '2026-11-08', sat: '2026-11-14' }, ds + ' 의 달력 한 주');
    assert.deepStrictEqual(J(C.calReportPeriod(ds)), { mon: '2026-11-09', sat: '2026-11-14' }, ds + ' 의 회사 기간');
    assert.strictEqual(d.getDay(), k);
  }
  assert.strictEqual(new Date(2026, 10, 9).getDay(), 1);
  assert.strictEqual(new Date(2026, 10, 14).getDay(), 6);
  //  주간 보기: 일요일은 지난 월~일 쪽
  assert.deepStrictEqual(J(C.calViewWeek('2026-11-08')), { mon: '2026-11-02', sun: '2026-11-08' });
  assert.deepStrictEqual(J(C.calViewWeek('2026-11-09')), { mon: '2026-11-09', sun: '2026-11-15' });
  assert.deepStrictEqual(J(C.calViewWeek('2026-11-14')), { mon: '2026-11-09', sun: '2026-11-15' });
  assert.deepStrictEqual(J(C.calViewWeek('2026-12-30')), { mon: '2026-12-28', sun: '2027-01-03' }, '해를 넘는 주간 보기');
  assert.ok(sun);
});

test('(R) 칸 클래스: 다른 달 dim, 오늘, 고른 날, 주말 틴트, 날짜 숫자 색(일요일, 공휴일 sun, 토요일 sat)', () => {
  assert.strictEqual(C.calCellCls('2026-10-31', 'cell', { m: 9, today: '2026-10-31', sel: '2026-10-31' }), 'cal-c cell today sel wknd-sat');
  assert.strictEqual(C.calCellCls('2026-11-01', 'at-day', { m: 9 }), 'cal-c at-day dim wknd-sun');
  assert.strictEqual(C.calCellCls('2026-10-28', 'pc-day', { m: 9 }), 'cal-c pc-day');
  assert.strictEqual(C.calCellCls('2026-10-28', 'pc-wday', {}), 'cal-c pc-wday', '달을 안 주면 dim 을 붙이지 않는다');
  assert.strictEqual(C.calNumCls('2026-10-11'), 'num sun');
  assert.strictEqual(C.calNumCls('2026-10-10'), 'num sat');
  assert.strictEqual(C.calNumCls('2026-10-09'), 'num sun', '평일 공휴일(한글날)은 sun 색');
  assert.strictEqual(C.calNumCls('2026-10-08'), 'num');
  assert.strictEqual(C.calAria('2026-10-09', '2026-10-09'), '10월 9일 금요일, 한글날, 오늘');
});

// ══ (S) 정적 ══════════════════════════════════════════════════════════
//  공용 구간을 뺀 나머지 소스. 주 계산 식과 요일 배열은 여기에 없어야 한다.
function outsideCommon(src) {
  const a = src.indexOf('/* ---------- 공용 달력'), b = src.indexOf('/* ---------- /공용 달력', a);
  assert.ok(a > 0 && b > a, '공용 달력 구간을 찾지 못했다');
  return src.slice(0, a) + src.slice(src.indexOf('\n', b));
}
const fnText = (src, name) => extractFunction(src, name);
const statics = {
  noOwnWeekMath(src) {
    const rest = outsideCommon(src);
    assert.ok(!/getDay\(\)\s*\+\s*6\)\s*%\s*7/.test(rest), '공용 밖에 월요일 시작 주 계산(getDay()+6)%7 이 있다');
    assert.ok(!/-\s*[\w.()]*\.getDay\(\)\s*\)/.test(rest) && !/,\s*-\s*[\w.()]*getDay\(\)/.test(rest), '공용 밖에 일요일로 되돌리는 getDay 식(-first.getDay())이 있다');
    assert.ok(!/1\s*-\s*[\w.()]*\.getDay\(\)/.test(rest), '공용 밖에 달 격자 시작 계산(1 - first.getDay())이 있다');
    assert.ok(!/\[\s*'일'\s*,\s*'월'/.test(rest) && !/\[\s*'월'\s*,\s*'화'/.test(rest), '공용 밖에 요일 이름 배열이 있다');
    assert.ok(!/\b(WEEKDAYS|PC_DOW|DOW_K|AW_ORD)\b/.test(rest), '옛 요일 배열 이름이 남아 있다');
    assert.ok(!/function\s+(weekRange|weekSubjectGuess|awMonOf|awMonthRows|awPickTitle)\s*\(/.test(rest), '옛 주 계산 함수가 되살아났다');
  },
  screensUseCommon(src) {
    const need = {
      renderMonthGrid: ['calMonthGrid(', 'calCellCls(', 'calNumCls(', 'calAria('],
      renderMonthBars: ['calMonthGrid(', 'calCellCls(', 'calNumCls(', 'calAria('],
      renderWeekdays: ['CAL_DOW'],
      calWeekRange: ['calViewWeek('],
      pcMonthRange: ['calMonthGrid('],
      pcWeekRange: ['calViewWeek('],
      pcRenderMonth: ['calCellCls(', 'calNumCls(', 'CAL_DOW'],
      pcRenderWeek: ['calCellCls(', 'CAL_DOW'],
      atRenderMonth: ['calCellCls(', 'calNumCls(', 'CAL_DOW'],
      rptMPlanDefault: ['calViewWeek('],
      setReportRange: ['calRowRange('],
      calRowRange: ['calRowWeek('],
      awCalRender: ['calMonthGrid(', 'calReportPeriod(', 'calWeekTitle(', 'calCellCls(', 'calNumCls(', 'CAL_DOW', 'CAL_ORD'],
      awPeriodLabel: ['calReportPeriod('],
      awIsMon: ['calDow('],
    };
    for (const [fn, calls] of Object.entries(need)) {
      const body = fnText(src, fn);
      for (const c of calls) assert.ok(body.includes(c), fn + ' 가 공용 ' + c + ' 를 부르지 않는다');
    }
    assert.ok(/subject: calWeekTitle\(from\)/.test(fnText(src, 'buildWeeklyFields')), '보고서 창 주간 제목이 calWeekTitle 이 아니다');
    assert.ok(src.includes('const mon = calReportPeriod(todayYmd()).mon') && src.includes('awOpen(calReportPeriod(todayYmd()).mon)'), '주간보고 목록, 새 주의 기본 주가 공용 함수가 아니다');
  },
  submitSaturday(src) {
    const body = fnText(src, 'awBuildSubmit');
    assert.ok(/edate:\s*calReportPeriod\(AWE\.mon\)\.sat\b/.test(body), 'awBuildSubmit 의 edate 가 회사 보고 기간의 토요일이 아니다');
    assert.ok(!/addDays\(AWE\.mon,\s*6\)/.test(src), 'AWE.mon + 6(일요일)로 기간 끝을 만드는 곳이 남아 있다');
    assert.ok(/reportMode === 'weekly'[^\n]*calReportPeriod\(v\)[^\n]*\$\('#rptTo'\)\.value = r\.sat/.test(src), '보고서 창 주간 전송 기간이 월~토로 스냅되지 않는다');
  },
  subjectReadonly(src) {
    assert.ok(/<input type="text" id="awSubj"[^>]*\sreadonly[\s>]/.test(src), '주간보고 제목 칸(#awSubj)이 readonly 가 아니다');
    assert.ok(!/AWE\.subjAuto|subjAuto:/.test(src), '손으로 고친 제목을 기억하던 subjAuto 가 남아 있다');
    assert.ok(!/t\.id === 'awSubj'/.test(src) && !/on\('awSubj'/.test(src), '제목 칸 입력 처리기가 남아 있다');
    assert.ok(/\.aw-ed input\[type=text\]\.aw-subj\{[^}]*var\(--dim-bg\)/.test(src), '제목 칸이 읽기 전용 모양(--dim-bg)이 아니다');
  },
  pickerBlocksOutOfRange(src) {
    const body = fnText(src, 'awCalRender');
    assert.ok(/const ok = inPer && parseYmd\(ds\)\.getMonth\(\) === m;/.test(body), '주 고르기가 보고 있는 달의 월~토만 누르게 하지 않는다');
    const click = src.slice(src.indexOf("(b = c('tr[data-awpick]'))"), src.indexOf("(b = c('[data-awtab]')"));
    assert.ok(click.includes("c('td.off')"), '막힌 칸(td.off)을 눌러도 줄이 골라진다');
  },
};
test('(S) 화면 함수들이 공용 함수를 부른다', () => statics.screensUseCommon(app));
test('(S) 공용 밖에 주 계산 식, 요일 배열, 옛 주 계산 함수가 없다', () => statics.noOwnWeekMath(app));
test('(S) awBuildSubmit 의 edate 는 토요일이고 보고서 창 주간 전송도 월~토다', () => statics.submitSaturday(app));
test('(S) 주간보고 제목 칸은 readonly 이고 손으로 고친 제목 기억 로직이 없다', () => statics.subjectReadonly(app));
test('(S) 주 고르기는 일요일 칸과 앞뒤 달 날짜를 막는다(정적)', () => statics.pickerBlocksOutOfRange(app));
//  칸 디자인 CSS 는 .cal-c 공용 블록 하나뿐. 화면별 주말, 흐림, 오늘 규칙이 다시 생기면 실패한다.
statics.calCssOnce = function(src) {
  const css = src.slice(0, src.indexOf('</style>'));
  const bad = css.match(/\.(cell|pc-day|pc-wday|at-day|cal-pk td|pc-whday|wr-hd|wr-c)\.(wknd-(sun|sat)|dim\b|today \.num)|\.cal-pk td\.(wknd-|dim|today)|\.(cell|pc-day|at-day|pc-whday)\.today \.num/);
  assert.ok(!bad, '화면별 칸 디자인 규칙이 있다(공용 .cal-c 블록 하나만): ' + (bad && bad[0]));
  const blk = (css.match(/\.cal-c\.wknd-sat:not/g) || []).length;
  assert.strictEqual(blk, 1, '공용 .cal-c 주말 틴트 규칙이 하나가 아니다: ' + blk);
  assert.ok(/\.cal-c\.dim,\.cal-c\.dim:hover\{background:var\(--dim-bg\)\}/.test(css) && /\.cal-c\.dim \.num\{color:var\(--faint-text\)\}/.test(css), '공용 흐림 규칙이 없다');
  assert.ok(/\.cal-c\.today \.num\{background:var\(--accent-fill\);color:var\(--on-accent\)/.test(css), '공용 오늘 배지 규칙이 없다');
  assert.ok(/\.cal-c\.wknd-sun:not\(\.sel\):not\(\.dim\):not\(:hover\)\{background:var\(--wknd-sun-bg\)\}/.test(css) && !/\.cal-c\.wknd-s(un|at):not\([^{]*:not\(\.today\)/.test(css), '주말 틴트 조건이 규칙(sel, dim, hover 만 제외)과 다르다');
  const fn = fnText(src, 'calCellCls');
  assert.ok(/return 'cal-c ' \+ base/.test(fn), 'calCellCls 가 cal-c 를 붙이지 않는다');
  //  주 고르기 줄 선택, hover 는 주말 틴트(특정성 0,5,0)보다 높아야 한다
  assert.ok(/\.cal-pk tr\.aw-cw\.sel td\.inp\.cal-c\{background:var\(--accent-fill\)\}/.test(css) && /\.cal-pk tr\.aw-cw:hover td\.inp\.cal-c/.test(css), '주 고르기 줄 선택, hover 가 틴트를 이기지 못한다');
};
test('(S) 칸 디자인 CSS 는 공용 .cal-c 블록 하나뿐이고 calCellCls 가 cal-c 를 붙인다', () => statics.calCssOnce(app));
test('(S) 머리 칸(.pc-whday, 개인 주간 .wr-hd)도 calCellCls 를 쓴다', () => {
  assert.ok(fnText(app, 'pcRenderWeek').includes("calCellCls(ds, 'pc-whday'"), '과제 주간 머리가 calCellCls 가 아니다');
  assert.ok(fnText(app, 'renderWeekRows').includes("calCellCls(ds, 'cell wr-hd'"), '개인 주간 머리가 calCellCls 가 아니다');
});
test('(M) 화면별 칸 규칙을 하나 되살리면 칸 CSS 검사가 잡는다', () => {
  const add = (rule) => mutate(app, '.cal-c.dim .num{color:var(--faint-text)}', '.cal-c.dim .num{color:var(--faint-text)}\n' + rule);
  for (const rule of ['.cell.wknd-sat:not(.sel){background:var(--wknd-sat-bg)}', '.pc-day.wknd-sun{background:var(--wknd-sun-bg)}', '.at-day.dim{background:var(--dim-bg)}',
    '.cal-pk td.wknd-sat{background:var(--wknd-sat-bg)}', '.pc-wday.wknd-sat{background:var(--wknd-sat-bg)}', '.at-day.today .num{background:var(--accent-fill)}', '.pc-whday.today .num{color:red}'])
    assert.throws(() => statics.calCssOnce(add(rule)), /화면별 칸 디자인/, rule);
  assert.throws(() => statics.calCssOnce(mutate(app, "return 'cal-c ' + base", 'return base')), /cal-c/);
  assert.throws(() => statics.calCssOnce(mutate(app, '.cal-c.wknd-sat:not(.sel):not(.dim):not(:hover)', '.cal-c.wknd-sat:not(.sel):not(.today):not(.dim):not(:hover)')), /틴트 조건/);
  assert.throws(() => statics.calCssOnce(mutate(app, '.cal-pk tr.aw-cw.sel td.inp.cal-c{', '.cal-pk tr.aw-cw.sel td.inp{')), /틴트를 이기지/);
});
test('(S) 새 문구와 주석에 엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점이 없다', () => {
  const part = extractCalCommon(app) + '\n' + fnText(app, 'awCalRender');
  assert.ok(!/[—–「」]/.test(part), '금지 기호가 있다');
  assert.ok(!/(^|\s)·|·(\s|$)/m.test(part), '띄어 쓴 가운데 점이 있다');
});

// ══ (M) 변이: 정적 쪽 ═════════════════════════════════════════════════
test('(M) 공용 밖에 요일 배열이나 getDay 주 식을 다시 넣으면 정적 검사가 잡는다', () => {
  const bads = [
    mutate(app, 'function awIsMon(s){', "const X_DOW = ['일','월','화','수','목','금','토'];\nfunction awIsMon(s){"),
    mutate(app, 'function awIsMon(s){', "function awMonX(d){ const t = parseYmd(d); return addDays(d, -((t.getDay() + 6) % 7)); }\nfunction awIsMon(s){"),
    mutate(app, 'function awIsMon(s){', "function awSunX(first){ return addDays('2026-01-01', -first.getDay()); }\nfunction awIsMon(s){"),
    mutate(app, 'function awIsMon(s){', "function awStartX(y, m){ const first = new Date(y, m, 1); return new Date(y, m, 1 - first.getDay()); }\nfunction awIsMon(s){"),
    mutate(app, 'function awIsMon(s){', "const WEEKDAYS = ['a'];\nfunction awIsMon(s){"),
  ];
  for (const bad of bads) assert.throws(() => statics.noOwnWeekMath(bad), /공용 밖|남아 있다|되살아났다/);
});
test('(M) 화면이 공용 함수 대신 자체 계산으로 돌아가면 잡는다', () => {
  assert.throws(() => statics.screensUseCommon(mutate(app, "  const G = calMonthGrid(view.y, view.m), startDs = G.from, weeks = G.weeks, endDs = G.to;", "  const startDs = ymd(new Date(view.y, view.m, 1)), weeks = 5, endDs = addDays(startDs, 34);")), /calMonthGrid/);
  assert.throws(() => statics.screensUseCommon(mutate(app, "const w = calViewWeek(anchor);\n  return { from: w.mon, to: w.sun, weeks: 1 };", "const w = { mon: anchor, sun: anchor };\n  return { from: w.mon, to: w.sun, weeks: 1 };")), /calViewWeek/);
});
test('(M) edate 를 +6(일요일)으로 되돌리면 잡는다', () => {
  assert.throws(() => statics.submitSaturday(mutate(app, 'edate: calReportPeriod(AWE.mon).sat,', 'edate: addDays(AWE.mon, 6),')), /edate|일요일/);
});
test('(M) 제목 칸 readonly 를 빼거나 제목 입력 처리기를 되살리면 잡는다', () => {
  assert.throws(() => statics.subjectReadonly(mutate(app, 'id="awSubj" class="aw-subj" readonly tabindex="-1"', 'id="awSubj" class="aw-subj" tabindex="-1"')), /readonly/);
  assert.throws(() => statics.subjectReadonly(mutate(app, "      if(t.id === 'awAddQ') awAddRender();", "      if(t.id === 'awSubj'){ AWE.subj = t.value; }\n      if(t.id === 'awAddQ') awAddRender();")), /입력 처리기/);
});
test('(M) 일요일 칸 막기를 빼면 정적 검사가 잡는다', () => {
  assert.throws(() => statics.pickerBlocksOutOfRange(mutate(app, 'const ok = inPer && parseYmd(ds).getMonth() === m;', 'const ok = parseYmd(ds).getMonth() === m;')), /월~토/);
  assert.throws(() => statics.pickerBlocksOutOfRange(mutate(app, "if(!c('td.off')) awCalPick(", 'awCalPick(')), /td\.off/);
});

// ══ (B) jsdom 주 고르기 ═══════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
if (!JSDOM) {
  skip('cal-common: jsdom 미설치, 주 고르기 화면 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  function boot(src) {
    const errors = [];
    const vc = new jsdomMod.VirtualConsole();
    vc.on('jsdomError', (e) => { const s = String(e && (e.stack || e.message) || e); if (!/Not implemented/.test(s)) errors.push(s); });
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: vc,
      beforeParse(win) {
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.open = () => null;
      },
    });
    const w = dom.window;
    return { w, errors, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      $: (s) => w.document.querySelector(s), $$: (s) => [...w.document.querySelectorAll(s)], close: () => { try { w.close(); } catch (_) {} } };
  }
  const CATS = [{ id: 'c-a', name: '알파', color: '#3e5be0', desc: '', createdAt: '2026-07-01T00:00:00.000Z' }];
  function bootPicker(src, mon, y, m) {
    const X = boot(src);
    X.ev('state = ' + JSON.stringify({ categories: CATS, entries: [], todos: [], rooms: [], attendance: {}, taskHours: {}, reportMarker: '-', reportMarkerCustom: '', reportIndent: 2 }) + ';');
    X.ev("localStorage.setItem('tc_attKind', 'week'); pcSetTab('attend')");
    X.ev(`awOpen(${JSON.stringify(mon)})`);
    X.$('#awWeekBtn').click();
    X.ev(`AWE.cal.y = ${y}; AWE.cal.m = ${m}; awCalRender();`);
    return X;
  }
  const td = (X, ds) => X.$(`#awWCal td[data-pd="${ds}"]`);
  const rowsOf = (X) => X.evJSON("[].map.call(document.querySelectorAll('#awWCal .cal-pk tbody tr'), function(r){ return [r.cells[0].textContent, r.dataset.awpick || '', r.dataset.awttl || '', r.classList.contains('sel')]; })");

  test('(B) 주 고르기: 2026-11 은 일요일 시작 7열, 줄 머리 n째주, 일요일 칸과 앞뒤 달 날짜는 막히고 월~토만 눌린다', () => {
    const X = bootPicker(app, '2026-11-02', 2026, 10);
    try {
      assert.deepStrictEqual(X.$$('#awWCal .cal-pk thead th').map((e) => e.textContent), ['', '일', '월', '화', '수', '목', '금', '토']);
      assert.strictEqual(X.$('#awWCal .cal-pk thead th.sun').textContent, '일');
      assert.strictEqual(X.$('#awWCal .cal-pk thead th.sat').textContent, '토');
      assert.deepStrictEqual(rowsOf(X), [
        ['첫째주', '2026-11-02', '11월 첫째주', true], ['둘째주', '2026-11-09', '11월 둘째주', false], ['셋째주', '2026-11-16', '11월 셋째주', false],
        ['넷째주', '2026-11-23', '11월 넷째주', false], ['다섯째주', '2026-11-30', '11월 다섯째주', false]]);
      for (const sun of ['2026-11-01', '2026-11-08', '2026-11-29']) assert.ok(td(X, sun).classList.contains('off') && td(X, sun).classList.contains('wknd-sun'), sun + ' 일요일 칸이 막히지 않았다');
      for (const out of ['2026-12-01', '2026-12-05']) assert.ok(td(X, out).classList.contains('off') && td(X, out).classList.contains('dim'), out + ' 다음 달 날짜가 막히지 않았다');
      for (const ok of ['2026-11-02', '2026-11-07', '2026-11-30']) assert.ok(!td(X, ok).classList.contains('off'), ok + ' 이 눌리지 않는다');
      assert.ok(td(X, '2026-11-02').classList.contains('inp') && !td(X, '2026-11-01').classList.contains('inp'), '월~토만 기간 칸(inp)이다');
      //  일요일 칸을 눌러도 주가 바뀌지 않는다(달력은 열린 채)
      td(X, '2026-11-15').click();
      assert.strictEqual(X.ev('AWE.mon'), '2026-11-02', '일요일 칸을 눌렀는데 주가 바뀌었다');
      td(X, '2026-12-01').click();
      assert.strictEqual(X.ev('AWE.mon'), '2026-11-02', '다음 달 날짜를 눌렀는데 주가 바뀌었다');
      //  월~토 날짜를 누르면 그 줄: 11/10 = 11/9 ~ 11/14, 11월 둘째주
      td(X, '2026-11-10').click();
      assert.strictEqual(X.ev('AWE.mon'), '2026-11-09');
      assert.strictEqual(X.$('#awSubj').value, '11월 둘째주');
      assert.strictEqual(X.$('#awWeekBtn').textContent, '2026-11-09 ~ 2026-11-14 ▾', '기간 단추가 월~토가 아니다');
      assert.strictEqual(X.$('#awTitle').textContent, '11월 둘째주 (11/9~11/14)');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 주 고르기: 걸친 주는 사용자가 달을 골라 정한다(7월 달력 27~31 = 7월 다섯째주, 8월 달력 1일 = 8월 첫째주)', () => {
    const X = bootPicker(app, '2026-07-27', 2026, 6);
    try {
      const r7 = rowsOf(X), last7 = r7[r7.length - 1];
      assert.deepStrictEqual(last7, ['다섯째주', '2026-07-27', '7월 다섯째주', true], '7월 달력 마지막 줄');
      for (const ds of ['2026-07-27', '2026-07-31']) assert.ok(!td(X, ds).classList.contains('off'), ds + ' 이 7월 달력에서 눌리지 않는다');
      assert.ok(td(X, '2026-08-01').classList.contains('off'), '7월 달력에서 8/1 은 막힌다');
      X.ev('AWE.cal.y = 2026; AWE.cal.m = 7; awCalRender();');
      const r8 = rowsOf(X);
      assert.strictEqual(r8.length, 6, '2026-08 은 6줄');
      assert.deepStrictEqual(r8[0], ['첫째주', '2026-07-27', '8월 첫째주', true], '8월 달력 첫 줄');
      assert.ok(!td(X, '2026-08-01').classList.contains('off'), '8월 달력에서 8/1(토)은 눌린다');
      assert.ok(td(X, '2026-07-31').classList.contains('off') && td(X, '2026-07-31').classList.contains('dim'), '8월 달력에서 7/31 은 막힌다');
      td(X, '2026-08-01').click();
      assert.strictEqual(X.$('#awSubj').value, '8월 첫째주', '같은 주를 8월 달력에서 고르면 8월 첫째주');
      assert.strictEqual(X.ev('AWE.mon'), '2026-07-27');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 주 고르기: 개인 달력과 같은 칸 클래스(주말 틴트, 공휴일 sun 색, 오늘, 다른 달 dim)와 키보드(줄 tabindex, Enter)', () => {
    const X = bootPicker(app, '2026-10-05', 2026, 9);
    try {
      assert.ok(td(X, '2026-10-09').querySelector('.num.sun'), '공휴일(한글날)이 sun 색이 아니다');
      assert.strictEqual(td(X, '2026-10-09').title, '한글날');
      assert.ok(td(X, '2026-10-10').classList.contains('wknd-sat') && td(X, '2026-10-10').querySelector('.num.sat'), '토요일 칸이 sat 색이 아니다');
      assert.ok(td(X, '2026-10-11').classList.contains('wknd-sun') && td(X, '2026-10-11').querySelector('.num.sun'), '일요일 칸이 sun 색이 아니다');
      assert.ok(td(X, '2026-09-27').classList.contains('dim') && !td(X, '2026-10-01').classList.contains('dim'), '앞 달 날짜가 dim 이 아니다');
      const today = X.ev('todayYmd()');
      X.ev(`AWE.cal.y = ${today.slice(0, 4)}; AWE.cal.m = ${Number(today.slice(5, 7)) - 1}; awCalRender();`);
      assert.ok(td(X, today).classList.contains('today'), '오늘 칸 표시가 없다');
      assert.strictEqual(X.$$('#awWCal tr[data-awpick]').every((r) => r.getAttribute('tabindex') === '0'), true, '고를 수 있는 줄은 키보드로 닿는다');
      //  Enter 로 줄 고르기
      X.ev('AWE.cal.y = 2026; AWE.cal.m = 9; awCalRender();');
      const row = X.$('#awWCal tr[data-awpick="2026-10-12"]');
      row.dispatchEvent(new X.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      assert.strictEqual(X.ev('AWE.mon'), '2026-10-12');
      assert.strictEqual(X.$('#awSubj').value, '10월 셋째주');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 주간보고 제목 칸: readonly, 입력 이벤트로 바뀌지 않고 이미 저장된 주의 제목은 그대로 보인다', () => {
    const X = bootPicker(app, '2026-10-12', 2026, 9);
    try {
      const s = X.$('#awSubj');
      assert.strictEqual(s.readOnly, true);
      assert.strictEqual(s.value, '10월 셋째주');
      s.value = '내 제목'; s.dispatchEvent(new X.w.Event('input', { bubbles: true })); s.dispatchEvent(new X.w.Event('change', { bubbles: true }));
      assert.strictEqual(X.ev('AWE.subj'), '10월 셋째주', '읽기 전용 제목이 입력으로 바뀌었다');
      //  완료한 주(DB 기록)의 제목은 기록대로 보인다
      const p = { v: 1, kind: 'week', mon: '2026-10-19', me: { userId: 1, loginId: 'me', name: '나' }, projects: [],
        saved: { periodStart: '2026-10-19', periodEnd: '2026-10-24', subject: '10월 넷째주 (기록)', content: '', endwork: '', plan: '', meeting: '', composedAt: '2026-10-23T09:00:00.000Z' } };
      X.ev(`awOpen = awOpen; awShowEditor(${JSON.stringify(p)})`);
      assert.strictEqual(X.ev('AWE.mon'), '2026-10-19');
      assert.strictEqual(X.$('#awSubj').value, '10월 넷째주 (기록)', '저장된 주의 제목이 기록대로 보이지 않는다');
      assert.strictEqual(X.$('#awSubj').readOnly, true);
    } finally { X.close(); }
  });

  test('(M) 일요일 칸 막기를 빼면 주 고르기 실행 검사가 잡는다', () => {
    const bad = mutate(app, 'const ok = inPer && parseYmd(ds).getMonth() === m;', 'const ok = parseYmd(ds).getMonth() === m;');
    const X = bootPicker(bad, '2026-11-02', 2026, 10);
    try {
      assert.ok(!td(X, '2026-11-01').classList.contains('off') || td(X, '2026-11-08').classList.contains('off') === false, '변이가 일요일 칸을 열지 못했다');
      assert.ok(!td(X, '2026-11-08').classList.contains('off'), '변이한 소스에서도 일요일 칸이 막혀 있다(검사가 장식이다)');
    } finally { X.close(); }
  });
  test('(M) 클릭 처리에서 막힌 칸 검사를 빼면 일요일을 눌러 주가 바뀐다', () => {
    const bad = mutate(app, "if(!c('td.off')) awCalPick(", 'awCalPick(');
    const X = bootPicker(bad, '2026-11-02', 2026, 10);
    try {
      td(X, '2026-11-15').click();
      assert.strictEqual(X.ev('AWE.mon'), '2026-11-16', '변이한 소스에서 일요일 클릭이 주를 바꾸지 않았다(검사가 장식이다)');
    } finally { X.close(); }
  });
}
