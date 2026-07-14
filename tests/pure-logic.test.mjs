// Layer 1 — 의존성 0 순수 함수 단위테스트.
// 앱 소스에서 함수 선언을 extractFunction으로 잘라 eval/new Function으로 되살려 단독 검증한다.
// (브라우저·jsdom 불필요 — Node 내장만. 값 의미는 소스를 읽어 '실제 동작'을 그대로 단언한다.)
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';

const src = loadAppSource();

// ── defaultState(): 신규 설치 시 실제 사용자 데이터로 오해하지 않는 명시적 샘플 ─────
const defaultState = new Function(
  "const ymd = d => d.toISOString().slice(0, 10);\n" +
  "let seq = 0; const uid = prefix => prefix + '-' + (++seq);\n" +
  "const nowIso = () => '2026-07-01T00:00:00.000Z';\n" +
  "const DEFAULT_ROOMS = [];\n" +
  extractFunction(src, 'defaultState') + '\nreturn defaultState;'
)();

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
