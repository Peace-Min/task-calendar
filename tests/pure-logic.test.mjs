// Layer 1 — 의존성 0 순수 함수 단위테스트.
// 앱 소스에서 함수 선언을 extractFunction으로 잘라 eval/new Function으로 되살려 단독 검증한다.
// (브라우저·jsdom 불필요 — Node 내장만. 값 의미는 소스를 읽어 '실제 동작'을 그대로 단언한다.)
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';

const src = loadAppSource();

// ── defaultState(): 신규 설치 시 실제 사용자 데이터로 오해하지 않는 명시적 샘플 ─────
// ★ 이 절은 '문구'뿐 아니라 defaultState가 만들어내는 날짜 값·참조·키까지 판정한다.
//   defaultState가 사용자에게 닿는 경로는 load() 폴백(localStorage 빈 상태의 첫 방문) 하나인데,
//   그 폴백은 load()의 정규화 블록(e.date = String(e.date ?? '') …) 밖에 있다 —
//   즉 여기서 깨진 date/끊긴 categoryId는 아무 하류 보정 없이 렌더 경로로 그대로 들어간다.
//
// ymd/pad는 소스와 '같은 정의'를 주입한다(아래 weekRange 절과 동일 원칙).
// 날짜 '값'을 판정하려면 헬퍼가 소스 그대로여야 하므로, 정의가 갈라지면
// '하네스 충실도' 계약(바로 아래 test)이 운다.
const PAD_SRC = "const pad = n => String(n).padStart(2, '0');";
const YMD_SRC = 'const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;';

// 임의의 소스 문자열에서 defaultState를 되살린다 — 본 테스트와 변이 주입이 같은 경로를 쓴다.
function buildDefaultState(source) {
  return new Function(
    PAD_SRC + '\n' + YMD_SRC + '\n' +
    "let seq = 0; const uid = prefix => prefix + '-' + (++seq);\n" +
    "const nowIso = () => '2026-07-01T00:00:00.000Z';\n" +
    "const DEFAULT_ROOMS = [];\n" +
    extractFunction(source, 'defaultState') + '\nreturn defaultState;'
  )();
}
const defaultState = buildDefaultState(src);

// 주입한 헬퍼가 소스와 갈라지면 이 파일의 날짜 계약 전체가 딴 세상을 재는 셈이 된다.
test('하네스 충실도: 주입하는 pad·ymd 정의가 소스와 글자 그대로 같다', () => {
  assert.ok(src.includes(PAD_SRC), `소스의 pad 정의가 하네스와 다르다 — 주입값: ${PAD_SRC}`);
  assert.ok(src.includes(YMD_SRC), `소스의 ymd 정의가 하네스와 다르다 — 주입값: ${YMD_SRC}`);
});

test('defaultState: 신규 설치 과제·일정·할 일은 모두 샘플임을 제목에서 명시', () => {
  const initial = defaultState();
  assert.ok(initial.categories.every(category => category.name.includes('[샘플]')));
  assert.ok(initial.entries.every(entry => entry.title.includes('[샘플 일정]')));
  assert.ok(initial.todos.every(todo => todo.text.includes('[샘플 할 일]')));
});

test('defaultState: 샘플 과제 설명과 일정 메모에 수정·삭제 가능한 예시임을 명시', () => {
  const initial = defaultState();
  assert.ok(initial.categories.every(category => /예시/.test(category.desc) && /수정하거나 삭제/.test(category.desc)));
  assert.ok(initial.entries.every(entry => /예시/.test(entry.memo) && /수정하거나 삭제/.test(entry.memo)));
});

// ══ defaultState 구조 계약(검사 함수 — 테스트 + 변이 주입이 같은 함수를 쓴다) ══════════
// 위 두 계약은 title/desc/memo '문자열'만 본다. 그래서 샘플 일정의 date를 파싱 불가 문자열로
// 바꾸거나 categoryId를 없는 과제로 끊어도 전 스위트가 침묵했다. 아래가 그 구멍이다.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 형식만 보면 '2026-13-45'·'2026-02-30'이 통과한다 — 로컬 Date로 되짚어 실재 여부까지 확인.
// (로컬 생성/로컬 조회라 타임존과 무관하게 성립한다.)
function isRealCalendarDay(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// 배열을 통째로 비우면 every(...)는 공허하게 참이 된다 — 모든 검사의 진입 조건으로 둔다.
function assertSamplesPresent(initial) {
  for (const [key, label] of [['categories', '과제'], ['entries', '일정'], ['todos', '할 일']]) {
    assert.ok(Array.isArray(initial[key]) && initial[key].length > 0,
      `샘플 ${label}(${key})이 비었다 — 신규 설치 첫 화면이 텅 빈다(공허한 통과 방지)`);
  }
}

const checks = {
  // ① 날짜 값: 달력 셀에 렌더되고 날짜 정렬에 쓰이는 값이다. 형식 + 실재 왕복 둘 다 본다.
  sampleDatesAreRealCalendarDays(initial) {
    assertSamplesPresent(initial);
    initial.entries.forEach(entry => {
      assert.ok(isRealCalendarDay(entry.date),
        `샘플 일정의 date가 실재하는 달력 날짜가 아니다: ${JSON.stringify(entry.date)} (${entry.title})`);
    });
    initial.todos.forEach(todo => {
      assert.ok(todo.due === '' || isRealCalendarDay(todo.due),
        `샘플 할 일의 due가 실재하는 달력 날짜가 아니다: ${JSON.stringify(todo.due)} (${todo.text})`);
    });
  },

  // ② 참조무결성: 끊기면 과제 필터·색상이 깨지고 DB 이관 시 FK 위반이 난다.
  sampleCategoryRefsResolve(initial) {
    assertSamplesPresent(initial);
    const ids = new Set(initial.categories.map(category => category.id));
    [...initial.entries, ...initial.todos].forEach(row => {
      assert.ok(ids.has(row.categoryId),
        `샘플 데이터가 실재하지 않는 과제를 가리킨다: categoryId=${JSON.stringify(row.categoryId)} (${row.title || row.text})`);
    });
    // 아무 데이터도 딸리지 않은 샘플 과제는 첫 화면에서 빈 껍데기로 보인다.
    const used = new Set([...initial.entries, ...initial.todos].map(row => row.categoryId));
    initial.categories.forEach(category => {
      assert.ok(used.has(category.id),
        `샘플 과제에 딸린 일정·할 일이 하나도 없다: ${category.name}`);
    });
  },

  // ③ 키 유일성: 중복 id는 편집·삭제가 엉뚱한 행을 건드리고 DB 이관 시 PK 충돌이 난다.
  sampleIdsUnique(initial) {
    assertSamplesPresent(initial);
    const all = [...initial.categories, ...initial.entries, ...initial.todos].map(row => row.id);
    assert.ok(all.every(id => typeof id === 'string' && id.length > 0), '샘플 id에 빈 값·비문자열이 있다');
    const dup = all.filter((id, i) => all.indexOf(id) !== i);
    assert.strictEqual(new Set(all).size, all.length, `샘플 id가 중복됐다(중복 키 금지): ${[...new Set(dup)].join(', ')}`);
  },

  // ④ 시각 정합: 종일=시각 없음, 시간 일정=HH:mm이고 끝이 있으면 시작 이후.
  sampleTimesConsistent(initial) {
    assertSamplesPresent(initial);
    initial.entries.forEach(entry => {
      if (entry.allDay) {
        assert.strictEqual(entry.startTime + entry.endTime, '',
          `종일 일정에 시각이 남아 있다: ${entry.title} (${entry.startTime}~${entry.endTime})`);
        return;
      }
      assert.ok(/^\d{2}:\d{2}$/.test(entry.startTime),
        `시간 일정의 startTime이 HH:mm이 아니다: ${entry.title} (${JSON.stringify(entry.startTime)})`);
      assert.ok(entry.endTime === '' || /^\d{2}:\d{2}$/.test(entry.endTime),
        `시간 일정의 endTime이 HH:mm도 빈칸도 아니다: ${entry.title} (${JSON.stringify(entry.endTime)})`);
      if (entry.endTime !== '') {
        assert.ok(entry.startTime <= entry.endTime,
          `시간 일정의 시작이 끝보다 늦다: ${entry.title} (${entry.startTime}~${entry.endTime})`);
      }
    });
  },
};

test('defaultState: 샘플 일정·할 일의 날짜는 실재하는 달력 날짜(YYYY-MM-DD)다', () => {
  checks.sampleDatesAreRealCalendarDays(defaultState());
});

test('defaultState: 모든 일정·할 일의 categoryId는 실재하는 과제를 가리킨다', () => {
  checks.sampleCategoryRefsResolve(defaultState());
});

test('defaultState: id는 전부 유일하다(중복 키 금지)', () => {
  checks.sampleIdsUnique(defaultState());
});

test('defaultState: 종일 일정은 시각이 비어 있고, 시간 일정은 HH:mm·시작≤끝이다', () => {
  checks.sampleTimesConsistent(defaultState());
});

// ── fmtH(min): 분 → 시간 표시(정수면 정수, 아니면 소수 둘째자리 반올림) ──────────────
const fmtH = eval('(' + extractFunction(src, 'fmtH') + ')');

test('fmtH: 0→"0", 60→"1", 90→"1.5", 150→"2.5"', () => {
  assert.strictEqual(fmtH(0), '0');
  assert.strictEqual(fmtH(60), '1');
  assert.strictEqual(fmtH(90), '1.5');
  assert.strictEqual(fmtH(150), '2.5');
});

test('fmtH: 30→"0.5", 100→"1.67"(소수 둘째자리 반올림)', () => {
  assert.strictEqual(fmtH(30), '0.5');
  assert.strictEqual(fmtH(100), '1.67');   // 100/60=1.666… → round(166.66)/100=1.67
  assert.strictEqual(fmtH(1440), '24');
});

// 위 계약의 반올림 방어는 fmtH(100)==='1.67' 한 줄에 전부 걸려 있었다(나머지 값은 전부
// 소수 2자리 이내라 String(h)로도 통과한다). 그 한 줄이 지워져도 반올림이 무방비가 되지
// 않도록 내림/올림/자릿수를 각각 갈라내는 값을 따로 고정한다.
test('fmtH: 반올림 규약 — 내림/올림/자릿수를 값으로 갈라낸다', () => {
  assert.strictEqual(fmtH(70), '1.17');   // 1.1666… → round 1.17 (내림이면 "1.16")
  assert.strictEqual(fmtH(25), '0.42');   // 0.41666… → round 0.42 (내림이면 "0.41")
  assert.strictEqual(fmtH(50), '0.83');   // 0.8333… → round 0.83 (올림이면 "0.84")
  assert.strictEqual(fmtH(10), '0.17');   // 소수 2자리(×100)여야 한다 (×10이면 "0.2")
});

// null/무효 입력의 '실제' 동작(소스 그대로). fmtH는 호출부에서 검증된 분 정수에만 쓰이지만,
// 방어적으로 값을 확정: null은 0으로 강제되어 "0", undefined/NaN은 "NaN"(문자열)로 나온다.
test('fmtH: null→"0"(null/60=0), undefined→"NaN", NaN→"NaN"', () => {
  assert.strictEqual(fmtH(null), '0');
  assert.strictEqual(fmtH(undefined), 'NaN');
  assert.strictEqual(fmtH(NaN), 'NaN');
});

// ── numMin(시간소수 문자열) → 분 정수|null (폼 입력 경계) ─────────────────────────────
const numMin = eval('(' + extractFunction(src, 'numMin') + ')');

test('numMin: "2.5"→150, "1"→60, "0"→0(명시적 0 보존)', () => {
  assert.strictEqual(numMin('2.5'), 150);
  assert.strictEqual(numMin('1'), 60);
  assert.strictEqual(numMin('0'), 0);      // 미입력(null)과 구분되는 명시적 0
  assert.strictEqual(numMin('0.5'), 30);
});

test('numMin: 빈칸/null/undefined → null(미입력)', () => {
  assert.strictEqual(numMin(''), null);
  assert.strictEqual(numMin(null), null);
  assert.strictEqual(numMin(undefined), null);
});

test('numMin: 쓰레기/음수 → null', () => {
  assert.strictEqual(numMin('garbage'), null);
  assert.strictEqual(numMin('abc'), null);
  assert.strictEqual(numMin('-5'), null);   // 음수 거부
});

test('numMin: 반올림·클램프(0~1440분) — "2.51"→151, "100"→1440, "24.5"→1440', () => {
  assert.strictEqual(numMin('2.51'), 151);  // round(150.6)
  assert.strictEqual(numMin('100'), 1440);  // 6000분 → 1440 클램프
  assert.strictEqual(numMin('24'), 1440);
  assert.strictEqual(numMin('24.5'), 1440); // 1470 → 1440 클램프
});

// ── normCommits(arr): 커밋 배열 정규화 ──────────────────────────────────────────────
const normCommits = eval('(' + extractFunction(src, 'normCommits') + ')');

test('normCommits: 비배열 → []', () => {
  assert.deepStrictEqual(normCommits(null), []);
  assert.deepStrictEqual(normCommits(undefined), []);
  assert.deepStrictEqual(normCommits('nope'), []);
  assert.deepStrictEqual(normCommits({}), []);
});

test('normCommits: subject 공백 접기+트림, hash/short/subject 문자열 강제', () => {
  const out = normCommits([{ hash: 123, short: 456, time: '09:00', subject: '  여러   공백\n줄바꿈  ' }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].hash, '123');       // 숫자 → 문자열
  assert.strictEqual(out[0].short, '456');
  assert.strictEqual(out[0].time, '09:00');     // 유효 HH:mm 유지
  assert.strictEqual(out[0].subject, '여러 공백 줄바꿈');   // \s+ → 단일 공백 + trim
});

test('normCommits: 잘못된 time → "", 누락 필드 → ""', () => {
  const out = normCommits([{ time: '9:00' }, { time: '25:61', subject: 'x' }, {}]);
  assert.strictEqual(out[0].time, '');   // "9:00"은 2자리 시가 아니라 무효
  assert.strictEqual(out[0].hash, '');   // 누락 → ''
  assert.strictEqual(out[0].short, '');
  assert.strictEqual(out[0].subject, '');
  assert.strictEqual(out[1].time, '');   // "25:61" 무효
  assert.strictEqual(out[1].subject, 'x');
  assert.strictEqual(out[2].time, '');
});

test('normCommits: body 보존(줄바꿈 유지, subject처럼 접지 않음) · 부재→""', () => {
  const out = normCommits([
    { subject: '제목', body: '본문 첫 줄\n둘째  줄' },   // body는 \s+ 접기 안 함(줄바꿈·다중공백 보존)
    { subject: '제목만' },                                 // body 부재 → ''
    { subject: 'n', body: 123 },                           // 숫자 → 문자열 강제
  ]);
  assert.strictEqual(out[0].body, '본문 첫 줄\n둘째  줄');   // 원문 그대로(줄바꿈·공백 보존)
  assert.strictEqual(out[0].subject, '제목');
  assert.strictEqual(out[1].body, '');                       // 하위호환: 기본 ''
  assert.strictEqual(out[2].body, '123');                    // String() 강제
});

// ── weekRange / monthRange: 소스가 실제로 쓰는 주/월 경계(ymd·pad 헬퍼 주입) ──────────
// weekRange/monthRange는 ymd(→pad)에 의존 → 두 헬퍼를 소스와 동일 정의로 주입해 함수 본문만 실측.
// (주 시작 규약은 '추정 금지' 원칙에 따라 소스에서 확인: back=(getDay()+6)%7 → 월요일 시작 ISO 주)
const { weekRange, monthRange } = (function () {
  const helperSrc =
    "const pad = n => String(n).padStart(2, '0');\n" +
    "const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;\n";
  const factory = new Function(
    helperSrc +
    extractFunction(src, 'weekRange') + '\n' +
    extractFunction(src, 'monthRange') + '\n' +
    'return { weekRange, monthRange };'
  );
  return factory();
})();

test('weekRange: 수요일(2026-07-08) 기준 이번 주 = 월~일 [2026-07-06, 2026-07-12]', () => {
  const base = new Date(2026, 6, 8);           // 2026-07-08 (수)
  assert.deepStrictEqual(weekRange(base, 0), ['2026-07-06', '2026-07-12']);
  assert.deepStrictEqual(weekRange(base, -1), ['2026-06-29', '2026-07-05']);  // 지난 주
  assert.deepStrictEqual(weekRange(base, 1), ['2026-07-13', '2026-07-19']);   // 다음 주
});

test('weekRange: 월요일 시작 규약 — 월요일/일요일 모두 같은 주로 귀속', () => {
  const mon = new Date(2026, 6, 6);            // 2026-07-06 (월)
  const sun = new Date(2026, 6, 12);           // 2026-07-12 (일)
  assert.deepStrictEqual(weekRange(mon, 0), ['2026-07-06', '2026-07-12']);
  assert.deepStrictEqual(weekRange(sun, 0), ['2026-07-06', '2026-07-12']);   // 일요일은 이전 월요일 주
  // 시작일은 월요일(getDay()===1)
  const [s] = weekRange(new Date(2026, 6, 8), 0);
  const [y, m, d] = s.split('-').map(Number);
  assert.strictEqual(new Date(y, m - 1, d).getDay(), 1);
});

test('monthRange: 이번 달/지난 달, 연도 경계', () => {
  const base = new Date(2026, 6, 8);           // 2026-07
  assert.deepStrictEqual(monthRange(base, 0), ['2026-07-01', '2026-07-31']);
  assert.deepStrictEqual(monthRange(base, -1), ['2026-06-01', '2026-06-30']);
  // 1월에서 -1 → 전년 12월(연도 경계)
  assert.deepStrictEqual(monthRange(new Date(2026, 0, 15), -1), ['2025-12-01', '2025-12-31']);
  // 2월 말일(비윤년 2026 → 28일)
  assert.deepStrictEqual(monthRange(new Date(2026, 1, 10), 0), ['2026-02-01', '2026-02-28']);
});

// ══ 변이 주입(검사가 실효성이 있는지 증명) ════════════════════════════
// 각 변이는 "실제로 날 수 있는 회귀"다. 검사가 안 잡으면 그 검사는 장식이다.
// ★ 앵커가 소스에서 안 찾히면 여기서 실패한다 — 조용히 통과하지 않는다.
// ★ 접미사 변이가 아니라 원형이 남지 않는 치환이다(부분문자열 검사에 걸리지 않게).

function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

// ── ① 날짜 값 ────────────────────────────────────────────────────────
test('변이Ⓐ: 샘플 일정 date를 파싱 불가 문자열로 바꾸면 날짜 계약이 잡는다', () => {
  const bad = mutate(src, "{id:uid('e'), date:d2, title:'[샘플 일정] 보고서 제출'",
                          "{id:uid('e'), date:'ZZBROKENZZ', title:'[샘플 일정] 보고서 제출'");
  assert.throws(() => checks.sampleDatesAreRealCalendarDays(buildDefaultState(bad)()),
    /샘플 일정의 date가 실재하는 달력 날짜가 아니다/);
});

test('변이Ⓑ: 형식만 맞고 실재하지 않는 날짜(2026-02-30)도 잡는다 — 왕복 검증이 있어야 잡힌다', () => {
  const bad = mutate(src, "{id:uid('e'), date:d2, title:'[샘플 일정] 보고서 제출'",
                          "{id:uid('e'), date:'2026-02-30', title:'[샘플 일정] 보고서 제출'");
  // 형식(정규식)만 보는 검사였다면 여기서 통과했을 값이다.
  assert.ok(DATE_RE.test('2026-02-30'), '이 변이는 형식 검사만으로는 안 잡힌다는 전제');
  assert.throws(() => checks.sampleDatesAreRealCalendarDays(buildDefaultState(bad)()),
    /샘플 일정의 date가 실재하는 달력 날짜가 아니다/);
});

test('변이Ⓒ: 샘플 할 일 due를 없는 달(2026-13-45)로 바꾸면 잡는다', () => {
  const bad = mutate(src, "due:d2,  prio:'normal'", "due:'2026-13-45',  prio:'normal'");
  assert.throws(() => checks.sampleDatesAreRealCalendarDays(buildDefaultState(bad)()),
    /샘플 할 일의 due가 실재하는 달력 날짜가 아니다/);
});

// ── ② 참조무결성 ─────────────────────────────────────────────────────
test('변이Ⓓ: 샘플 일정 categoryId를 없는 과제로 끊으면 참조무결성이 잡는다', () => {
  const bad = mutate(src, "title:'[샘플 일정] 프로젝트 회의', categoryId:c1",
                          "title:'[샘플 일정] 프로젝트 회의', categoryId:'ZZNOCATZZ'");
  assert.throws(() => checks.sampleCategoryRefsResolve(buildDefaultState(bad)()),
    /샘플 데이터가 실재하지 않는 과제를 가리킨다/);
});

test('변이Ⓔ: 샘플 할 일 categoryId를 없는 과제로 끊어도 잡는다(할 일 쪽도 검사한다)', () => {
  const bad = mutate(src, "categoryId:c2, due:d0,  prio:'normal', note:",
                          "categoryId:'ZZNOCATZZ', due:d0,  prio:'normal', note:");
  assert.throws(() => checks.sampleCategoryRefsResolve(buildDefaultState(bad)()),
    /샘플 데이터가 실재하지 않는 과제를 가리킨다/);
});

// ── ③ 키 유일성 ──────────────────────────────────────────────────────
test('변이Ⓕ: 샘플 과제 두 개가 같은 id를 쓰면 유일성 계약이 잡는다', () => {
  // 참조는 전부 풀리므로(둘 다 c1) 참조무결성으로는 안 잡힌다 — 유일성 검사만이 잡는다.
  const bad = mutate(src, "const c1 = uid('c'), c2 = uid('c');", "const c1 = uid('c'), c2 = c1;");
  const initial = buildDefaultState(bad)();
  assert.doesNotThrow(() => checks.sampleCategoryRefsResolve(initial));
  assert.throws(() => checks.sampleIdsUnique(initial), /샘플 id가 중복됐다/);
});

// ── ④ 시각 정합 ──────────────────────────────────────────────────────
test('변이Ⓖ: 종일 일정에 시각을 남기면 시각 정합이 잡는다', () => {
  const bad = mutate(src, "allDay:true,\n       startTime:'', endTime:''",
                          "allDay:true,\n       startTime:'09:00', endTime:'18:00'");
  assert.throws(() => checks.sampleTimesConsistent(buildDefaultState(bad)()),
    /종일 일정에 시각이 남아 있다/);
});

test('변이Ⓗ: 시간 일정의 시작을 끝보다 늦게 만들면 잡는다', () => {
  const bad = mutate(src, "startTime:'10:00', endTime:'11:30'", "startTime:'13:00', endTime:'11:30'");
  assert.throws(() => checks.sampleTimesConsistent(buildDefaultState(bad)()),
    /시간 일정의 시작이 끝보다 늦다/);
});

test('변이Ⓘ: 시간 일정의 startTime을 HH:mm이 아닌 값으로 바꾸면 잡는다', () => {
  const bad = mutate(src, "startTime:'10:00', endTime:'11:30'", "startTime:'10시', endTime:'11:30'");
  assert.throws(() => checks.sampleTimesConsistent(buildDefaultState(bad)()),
    /startTime이 HH:mm이 아니다/);
});

// ── ⑤ 공허한 통과 ────────────────────────────────────────────────────
test('변이Ⓙ: 샘플 일정을 통째로 비우면 공허한 통과 방지 계약이 잡는다', () => {
  const bad = mutate(src, "entries: [\n      {id:uid('e')", "entries: [], _retiredEntries: [\n      {id:uid('e')");
  const initial = buildDefaultState(bad)();
  // ★ 옛 문구 계약은 every(...)라 빈 배열에서 공허하게 통과한다 — 이 구멍의 실체를 못 박아 둔다.
  assert.strictEqual(initial.entries.length, 0);
  assert.ok(initial.entries.every(entry => entry.title.includes('[샘플 일정]')));
  assert.throws(() => checks.sampleDatesAreRealCalendarDays(initial), /샘플 일정\(entries\)이 비었다/);
});

// ── ⑥ fmtH 반올림 ────────────────────────────────────────────────────
test('변이Ⓚ: fmtH의 반올림을 내림으로 바꾸면 반올림 계약이 잡는다', () => {
  const bad = mutate(src, 'Math.round(h * 100)', 'Math.floor(h * 100)');
  const floored = eval('(' + extractFunction(bad, 'fmtH') + ')');
  assert.throws(() => assert.strictEqual(floored(70), '1.17'));   // 내림이면 "1.16"
  assert.throws(() => assert.strictEqual(floored(25), '0.42'));   // 내림이면 "0.41"
});

test('변이Ⓛ: fmtH의 자릿수를 ×100 → ×10 으로 바꾸면 잡는다', () => {
  const bad = mutate(src, 'String(Math.round(h * 100) / 100)', 'String(Math.round(h * 10) / 10)');
  const coarse = eval('(' + extractFunction(bad, 'fmtH') + ')');
  assert.throws(() => assert.strictEqual(coarse(10), '0.17'));    // ×10이면 "0.2"
});

// ── ⑦ 하네스 자체 ────────────────────────────────────────────────────
test('변이Ⓜ: 소스의 ymd 정의가 바뀌면 하네스 충실도 계약이 잡는다', () => {
  const bad = mutate(src, PAD_SRC, "const pad = n => String(n);");
  assert.ok(!bad.includes(PAD_SRC), '치환 후 원형이 남았다 — 부분문자열 검사가 무의미해진다');
});
