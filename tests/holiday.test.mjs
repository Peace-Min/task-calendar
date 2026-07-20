// 공휴일 조회 — 순수 로직 단위테스트.
// 근태(연차/휴일) 판단에 쓰이는 표라, '구조가 무너지지 않았는지'를 기계로 잠근다.
// (개별 음력 날짜의 사실 여부는 관공서 공고 대조 문제 — 여기서는 검증할 수 없다.
//  대신 표 자체의 내부 정합성: 연휴 3일 연속, 대체공휴일은 평일, 키 형식·연도 범위를 단언한다.)
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';

const src = loadAppSource();

// HOLIDAYS_FIXED + HOLIDAYS_DATED 선언부를 통째로 잘라 holidayOn과 함께 되살린다.
const tableSrc = (() => {
  const i = src.indexOf('const HOLIDAYS_FIXED');
  assert.ok(i > 0, 'HOLIDAYS_FIXED 선언을 찾지 못함');
  const j = src.indexOf('};', src.indexOf('const HOLIDAYS_DATED'));
  assert.ok(j > i, 'HOLIDAYS_DATED 선언을 찾지 못함');
  return src.slice(i, j + 2);
})();

const { holidayOn, FIXED, DATED } = new Function(
  tableSrc + '\n' + extractFunction(src, 'holidayOn') +
  '\nreturn { holidayOn, FIXED: HOLIDAYS_FIXED, DATED: HOLIDAYS_DATED };'
)();

const dow = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const plusDays = (ds, n) => {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// ── 매년 고정 양력 ──────────────────────────────────────────────────
test('holidayOn: 고정 양력 공휴일은 연도와 무관하게 매년 적용', () => {
  for (const y of [2024, 2026, 2030, 2041]) {
    assert.strictEqual(holidayOn(`${y}-01-01`), '신정');
    assert.strictEqual(holidayOn(`${y}-03-01`), '삼일절');
    assert.strictEqual(holidayOn(`${y}-06-06`), '현충일');
    assert.strictEqual(holidayOn(`${y}-08-15`), '광복절');
    assert.strictEqual(holidayOn(`${y}-12-25`), '성탄절');
  }
});

test('holidayOn: 평일은 undefined', () => {
  assert.strictEqual(holidayOn('2026-07-20'), undefined);
  assert.strictEqual(holidayOn('2026-02-19'), undefined);   // 설날 연휴 다음날
});

// ── 연도별(음력·대체) ───────────────────────────────────────────────
test('holidayOn: 음력 명절은 해마다 다른 양력 날짜로 조회된다', () => {
  assert.strictEqual(holidayOn('2026-02-17'), '설날');
  assert.strictEqual(holidayOn('2027-02-06'), '설날');
  assert.strictEqual(holidayOn('2028-01-26'), '설날');
  assert.strictEqual(holidayOn('2029-02-13'), '설날');
  assert.strictEqual(holidayOn('2030-02-03'), '설날');
  assert.strictEqual(holidayOn('2026-09-25'), '추석');
  assert.strictEqual(holidayOn('2030-09-12'), '추석');
});

// 이게 MM-DD 단일표를 못 쓰는 이유 — 같은 '02-17'이 2026년만 설날이다.
test('holidayOn: 음력 날짜는 다른 해에 새어나가지 않는다(MM-DD 표였다면 충돌)', () => {
  assert.strictEqual(holidayOn('2026-02-17'), '설날');
  assert.strictEqual(holidayOn('2027-02-17'), undefined);
  assert.strictEqual(holidayOn('2028-02-17'), undefined);
});

test('holidayOn: 연도별 표가 고정 표를 덮어쓴다(2028-10-03 = 개천절이자 추석 → 추석)', () => {
  assert.strictEqual(holidayOn('2028-10-03'), '추석');
  assert.strictEqual(holidayOn('2027-10-03'), '개천절');   // 겹치지 않는 해는 고정 표 그대로
});

test('holidayOn: 방어 — null/빈문자열/짧은 문자열은 undefined(크래시 금지)', () => {
  assert.strictEqual(holidayOn(null), undefined);
  assert.strictEqual(holidayOn(undefined), undefined);
  assert.strictEqual(holidayOn(''), undefined);
  assert.strictEqual(holidayOn('2026-02'), undefined);
  assert.strictEqual(holidayOn(20260217), undefined);
});

// ── 표 자체의 정합성(사람이 손으로 고칠 표라 형식을 기계로 잠근다) ────
test('HOLIDAYS_DATED: 모든 키는 2026~2030 범위의 유효한 YYYY-MM-DD', () => {
  for (const k of Object.keys(DATED)) {
    assert.match(k, /^20(2[6-9]|30)-\d{2}-\d{2}$/, `키 형식/연도 범위 위반: ${k}`);
    const [y, m, d] = k.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    assert.strictEqual(dt.toISOString().slice(0, 10), k, `존재하지 않는 날짜: ${k}`);
    assert.ok(String(DATED[k]).length > 0, `이름이 빈 항목: ${k}`);
  }
});

test('HOLIDAYS_DATED: 설날·추석은 2026~2030 각 해에 정확히 1일씩(연휴 3일 = 당일+연휴 2일)', () => {
  for (const y of [2026, 2027, 2028, 2029, 2030]) {
    for (const nm of ['설날', '추석']) {
      const days = Object.keys(DATED).filter(k => k.startsWith(y + '-') && DATED[k] === nm);
      assert.strictEqual(days.length, 1, `${y} ${nm} 당일이 ${days.length}건`);
      const 연휴 = Object.keys(DATED).filter(k => k.startsWith(y + '-') && DATED[k] === nm + ' 연휴');
      assert.strictEqual(연휴.length, 2, `${y} ${nm} 연휴가 ${연휴.length}일`);
      // 당일 전날·다음날이어야 한다(연속 3일)
      assert.deepStrictEqual(연휴.sort(), [plusDays(days[0], -1), plusDays(days[0], 1)].sort(),
        `${y} ${nm} 연휴가 당일과 붙어있지 않음`);
    }
  }
});

test('HOLIDAYS_DATED: 부처님오신날은 2026~2030 각 해에 정확히 1일', () => {
  for (const y of [2026, 2027, 2028, 2029, 2030]) {
    const days = Object.keys(DATED).filter(k => k.startsWith(y + '-') && DATED[k] === '부처님오신날');
    assert.strictEqual(days.length, 1, `${y} 부처님오신날이 ${days.length}건`);
  }
});

// 대체공휴일의 존재 이유가 '주말에 먹힌 휴일을 평일로 옮기는 것'이라, 토·일에 있으면 그 자체가 오기다.
test('HOLIDAYS_DATED: 대체공휴일은 반드시 평일(월~금)이며 다른 공휴일과 겹치지 않는다', () => {
  const subs = Object.keys(DATED).filter(k => DATED[k].includes('대체공휴일'));
  assert.ok(subs.length >= 8, `대체공휴일이 ${subs.length}건 — 표가 유실된 듯`);
  for (const k of subs) {
    const w = dow(k);
    assert.ok(w >= 1 && w <= 5, `${k}(${DATED[k]})가 주말에 있음`);
    assert.strictEqual(FIXED[k.slice(5, 10)], undefined, `${k} 대체공휴일이 고정 공휴일과 겹침`);
  }
});

// 대체공휴일이 붙는 원인(원 공휴일이 주말/중복)이 실제로 그 해에 존재하는지 역검증.
test('HOLIDAYS_DATED: 어린이날 대체공휴일은 그 해 5/5가 주말인 해에만 있다', () => {
  const yearsWithSub = Object.keys(DATED)
    .filter(k => DATED[k] === '어린이날 대체공휴일').map(k => +k.slice(0, 4));
  for (const y of [2026, 2027, 2028, 2029, 2030]) {
    const w = dow(`${y}-05-05`);
    const weekend = (w === 0 || w === 6);
    assert.strictEqual(yearsWithSub.includes(y), weekend,
      `${y} 어린이날(요일 ${w}) 대체공휴일 유무 불일치`);
  }
});

test('HOLIDAYS_DATED: 삼일절/광복절/개천절/한글날/성탄절 대체공휴일은 그 해 원일이 일요일인 해에만 있다', () => {
  const map = { '삼일절': '03-01', '광복절': '08-15', '개천절': '10-03', '한글날': '10-09', '성탄절': '12-25' };
  for (const [nm, md] of Object.entries(map)) {
    const yearsWithSub = Object.keys(DATED)
      .filter(k => DATED[k] === nm + ' 대체공휴일').map(k => +k.slice(0, 4));
    for (const y of [2026, 2027, 2028, 2029, 2030]) {
      // 그 해 원일이 추석/설날 연휴로 덮인 경우는 이 규칙 밖(2028 개천절=추석)
      if (DATED[`${y}-${md}`]) continue;
      assert.strictEqual(yearsWithSub.includes(y), dow(`${y}-${md}`) === 0,
        `${y} ${nm}(요일 ${dow(`${y}-${md}`)}) 대체공휴일 유무 불일치`);
    }
  }
});
