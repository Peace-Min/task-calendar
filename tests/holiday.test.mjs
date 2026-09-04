// 공휴일 조회 — 순수 로직 단위테스트.
// 근태(연차/휴일) 판단에 쓰이는 표라, '구조가 무너지지 않았는지'를 기계로 잠근다.
// (개별 음력 날짜의 사실 여부는 관공서 공고 대조 문제 — 여기서는 검증할 수 없다.
//  대신 표 자체의 내부 정합성: 연휴 3일 연속, 대체공휴일은 평일, 키 형식·연도 범위를 단언한다.)
//
// ★ 2026-09-04 보강 — 변이 감사에서 뚫린 구멍을 메웠다.
//   HOLIDAYS_FIXED 8항목 중 어린이날(05-05)·한글날(10-09)에 대한 단언이 0건이었다.
//   항목을 통째로 지워도, 이름을 쓰레기 문자열로 바꿔도 전 스위트가 초록이었다 —
//   매년 5/5·10/9 의 공휴일 표시(달력 셀 빨강 num.sun · 일정상세 dp-hol)가 통째로
//   사라지는데도 게이트가 통과시켰다. 개천절(10-03)이 살아 있던 건
//   holidayOn('2027-10-03')==='개천절' 이라는 '덮어쓰기' 테스트에 우연히 걸린 덕이지
//   설계된 방어가 아니었다.
//   더 나쁜 건 아래 '겹치지 않는다' 의 assert.strictEqual(FIXED[md], undefined) 가
//   부정 방향이라는 점이다 — 표 항목이 사라질수록 통과가 쉬워진다. 유실을 막는 게 아니라
//   보상해 준다. 그래서 (1) 표 전체를 값까지 잠그고 (2) 조회 경로까지 8항목 전부 확인하고
//   (3) 대체공휴일 원 공휴일의 '실재'를 긍정 방향으로 단언한다.
//   그리고 그 세 계약이 정말 우는지를 파일 끝의 변이 주입 테스트로 증명한다.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';

const src = loadAppSource();

// HOLIDAYS_FIXED + HOLIDAYS_DATED 선언부를 통째로 잘라 holidayOn과 함께 되살린다.
// ★ 변이 주입 테스트도 같은 경로를 쓴다 — 검사가 '실제 소스를 읽어서' 우는지 증명하기 위해서다.
function buildTables(source) {
  const i = source.indexOf('const HOLIDAYS_FIXED');
  assert.ok(i > 0, 'HOLIDAYS_FIXED 선언을 찾지 못함');
  const j = source.indexOf('};', source.indexOf('const HOLIDAYS_DATED'));
  assert.ok(j > i, 'HOLIDAYS_DATED 선언을 찾지 못함');
  const tableSrc = source.slice(i, j + 2);
  return new Function(
    tableSrc + '\n' + extractFunction(source, 'holidayOn') +
    '\nreturn { holidayOn, FIXED: HOLIDAYS_FIXED, DATED: HOLIDAYS_DATED };'
  )();
}

const TABLES = buildTables(src);
const { holidayOn, FIXED, DATED } = TABLES;

const dow = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const plusDays = (ds, n) => {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// ══ 검사 함수(테스트 + 변이 주입이 같은 함수를 쓴다) ══════════════════
// 표를 인자로 받는다 — 실제 소스로도, 변이된 소스로도 같은 계약을 돌리기 위해서다.
const checks = {
  // ① 고정표 전체를 '항목 수·키·이름' 까지 한 줄로 잠근다.
  //    항목 삭제 · 이름 변조 · 날짜 이동 · 항목 추가를 전부 여기서 잡는다.
  fixedTableLocked({ FIXED }) {
    assert.deepStrictEqual(FIXED, {
      '01-01': '신정', '03-01': '삼일절', '05-05': '어린이날', '06-06': '현충일',
      '08-15': '광복절', '10-03': '개천절', '10-09': '한글날', '12-25': '성탄절',
    }, 'HOLIDAYS_FIXED 표가 바뀌었다 — 매년 고정 공휴일의 항목/날짜/이름이 어긋나면 '
     + '달력 셀 빨강(num.sun)과 일정상세(dp-hol) 가 통째로 틀어진다. '
     + '표를 의도적으로 고쳤다면 이 기대값도 같이 고쳐라(그게 이 단언의 목적이다).');
  },

  // ② 표만이 아니라 '조회 경로'까지 잠근다 — holidayOn 이 8항목을 매년 돌려주는가.
  //    (표가 멀쩡해도 holidayOn 의 slice(5,10) 같은 조회 코드가 깨지면 여기서 운다.)
  fixedEveryYear({ holidayOn }) {
    for (const y of [2024, 2026, 2030, 2041]) {
      assert.strictEqual(holidayOn(`${y}-01-01`), '신정', `${y}-01-01 이 신정으로 조회되지 않는다`);
      assert.strictEqual(holidayOn(`${y}-03-01`), '삼일절', `${y}-03-01 이 삼일절로 조회되지 않는다`);
      assert.strictEqual(holidayOn(`${y}-05-05`), '어린이날', `${y}-05-05 가 어린이날로 조회되지 않는다`);
      assert.strictEqual(holidayOn(`${y}-06-06`), '현충일', `${y}-06-06 이 현충일로 조회되지 않는다`);
      assert.strictEqual(holidayOn(`${y}-08-15`), '광복절', `${y}-08-15 가 광복절로 조회되지 않는다`);
      assert.strictEqual(holidayOn(`${y}-10-03`), '개천절', `${y}-10-03 이 개천절로 조회되지 않는다`);
      assert.strictEqual(holidayOn(`${y}-10-09`), '한글날', `${y}-10-09 가 한글날로 조회되지 않는다`);
      assert.strictEqual(holidayOn(`${y}-12-25`), '성탄절', `${y}-12-25 가 성탄절로 조회되지 않는다`);
    }
  },

  // ③ 대체공휴일 규칙 테스트들이 참조하는 '원 공휴일'이 고정표에 실재하는가 — 공허한 통과 금지.
  //    아래 '겹치지 않는다' 의 FIXED[md]===undefined 는 부정 방향이라 표 유실을 보상한다.
  //    (실측 비대칭: 05-05 삭제=통과 / 05-05→05-06 이동=실패, 그 실패조차 2030년 항목 1건에 의존.)
  //    긍정 방향으로 뒤집어 그 구멍을 막는다.
  substituteOriginsInFixed({ FIXED }) {
    const origins = { '삼일절': '03-01', '어린이날': '05-05', '광복절': '08-15',
                      '개천절': '10-03', '한글날': '10-09', '성탄절': '12-25' };
    for (const [nm, md] of Object.entries(origins)) {
      assert.ok(FIXED[md], `${nm} 원일 ${md} 가 고정표에서 사라짐 — 대체공휴일 규칙 테스트가 공허하게 통과한다`);
      assert.strictEqual(FIXED[md], nm,
        `고정표 ${md} 가 '${nm}' 이 아니라 '${FIXED[md]}' — 대체공휴일 이름 대조가 헛돈다`);
    }
  },
};

// ── 고정 표 자체 ────────────────────────────────────────────────────
test('HOLIDAYS_FIXED: 표 전체를 잠근다(항목 8개·날짜·이름 정확)', () => {
  checks.fixedTableLocked(TABLES);
});

// ── 매년 고정 양력 ──────────────────────────────────────────────────
test('holidayOn: 고정 양력 공휴일은 연도와 무관하게 매년 적용', () => {
  checks.fixedEveryYear(TABLES);
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
    // ★ 이 단언은 부정 방향이다 — FIXED 항목이 사라질수록 통과가 쉬워진다.
    //   그래서 아래 '원 공휴일이 고정표에 실재한다' 로 반드시 짝을 맞춰 둘 것.
    assert.strictEqual(FIXED[k.slice(5, 10)], undefined, `${k} 대체공휴일이 고정 공휴일과 겹침`);
  }
});

// 부정 단언(위)이 표 유실을 '보상'하는 구멍을 막는 짝. 원 공휴일이 없으면 규칙 검증 자체가 공허하다.
test('HOLIDAYS_DATED: 대체공휴일의 원 공휴일이 고정표에 실재한다(공허한 통과 금지)', () => {
  checks.substituteOriginsInFixed(TABLES);
});

// 대체공휴일이 붙는 원인(원 공휴일이 주말/중복)이 실제로 그 해에 존재하는지 역검증.
test('HOLIDAYS_DATED: 어린이날 대체공휴일은 그 해 5/5가 주말인 해에만 있다', () => {
  // 원일이 고정표에 없으면 아래 규칙 검증은 '없는 휴일에 대한 규칙'이라 공허하다.
  assert.strictEqual(FIXED['05-05'], '어린이날', "고정표 '05-05' 가 어린이날이 아니다 — 이 규칙 검증이 공허해진다");
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
    // 원일이 고정표에서 사라지면 이 루프는 '존재하지 않는 공휴일의 대체 규칙'을 돌리는 셈이다.
    assert.ok(FIXED[md], `${nm} 원일 ${md} 가 고정표에서 사라짐 — 이 규칙 검증이 공허해진다`);
    assert.strictEqual(FIXED[md], nm, `고정표 ${md} 가 '${nm}' 이 아니라 '${FIXED[md]}'`);
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

// ══ 변이 주입 — 위 계약이 '정말 우는지' 증명한다 ═══════════════════════
// ★ 앵커가 소스에서 안 찾히면 여기서 실패한다 — 조용히 통과하지 않는다.
// ★ 접미사 변이(어린이날 → 어린이날_X)는 부분문자열 검사에 그대로 걸리므로
//   원형이 남지 않게 통째로 치환한다.
function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

test('변이①: 고정표에서 어린이날(05-05) 항목을 통째로 지우면 fixedTableLocked 가 실패한다', () => {
  const bad = buildTables(mutate(src, "'05-05':'어린이날',", ''));
  assert.strictEqual(bad.FIXED['05-05'], undefined, '변이가 실제로 05-05 를 지우지 못했다');
  assert.throws(() => checks.fixedTableLocked(bad), /HOLIDAYS_FIXED 표가 바뀌었다/);
});

test('변이①-b: 어린이날 항목을 지우면 조회 경로(fixedEveryYear)도 실패한다', () => {
  const bad = buildTables(mutate(src, "'05-05':'어린이날',", ''));
  assert.throws(() => checks.fixedEveryYear(bad), /05-05 가 어린이날로 조회되지 않는다/);
});

test('변이①-c: 어린이날 항목을 지우면 대체공휴일 원일 실재 단언이 실패한다(부정단언 보상 차단)', () => {
  const bad = buildTables(mutate(src, "'05-05':'어린이날',", ''));
  assert.throws(() => checks.substituteOriginsInFixed(bad), /어린이날 원일 05-05 가 고정표에서 사라짐/);
});

test('변이②: 한글날(10-09) 이름을 쓰레기 문자열로 바꾸면 fixedTableLocked 가 실패한다', () => {
  const bad = buildTables(mutate(src, "'10-09':'한글날'", "'10-09':'ZZREMOVEDZZ'"));
  assert.strictEqual(bad.FIXED['10-09'], 'ZZREMOVEDZZ', '변이가 실제로 한글날 이름을 바꾸지 못했다');
  assert.throws(() => checks.fixedTableLocked(bad), /HOLIDAYS_FIXED 표가 바뀌었다/);
});

test('변이②-b: 한글날 이름을 바꾸면 조회 경로(fixedEveryYear)도 실패한다', () => {
  const bad = buildTables(mutate(src, "'10-09':'한글날'", "'10-09':'ZZREMOVEDZZ'"));
  assert.throws(() => checks.fixedEveryYear(bad), /10-09 가 한글날로 조회되지 않는다/);
});

test('변이②-c: 한글날 이름을 바꾸면 대체공휴일 원일 이름 대조가 실패한다', () => {
  const bad = buildTables(mutate(src, "'10-09':'한글날'", "'10-09':'ZZREMOVEDZZ'"));
  assert.throws(() => checks.substituteOriginsInFixed(bad), /대체공휴일 이름 대조가 헛돈다/);
});

test('변이③: 어린이날을 05-05 → 05-06 으로 옮기면 fixedTableLocked 가 실패한다', () => {
  const bad = buildTables(mutate(src, "'05-05':'어린이날'", "'05-06':'어린이날'"));
  assert.throws(() => checks.fixedTableLocked(bad), /HOLIDAYS_FIXED 표가 바뀌었다/);
  assert.throws(() => checks.fixedEveryYear(bad), /05-05 가 어린이날로 조회되지 않는다/);
});

test('변이④: 개천절(10-03) 이름을 바꾸면 잡힌다(우연한 커버리지가 아니라 설계된 방어인지 확인)', () => {
  const bad = buildTables(mutate(src, "'10-03':'개천절'", "'10-03':'ZZREMOVEDZZ'"));
  assert.throws(() => checks.fixedTableLocked(bad), /HOLIDAYS_FIXED 표가 바뀌었다/);
  assert.throws(() => checks.fixedEveryYear(bad), /10-03 이 개천절로 조회되지 않는다/);
});

test('변이⑤: 고정표에 없던 항목을 끼워 넣어도 잡힌다(표 확장도 게이트를 지나야 한다)', () => {
  const bad = buildTables(mutate(src, "'12-25':'성탄절'}", "'12-25':'성탄절','02-29':'가짜휴일'}"));
  assert.throws(() => checks.fixedTableLocked(bad), /HOLIDAYS_FIXED 표가 바뀌었다/);
});

test('변이⑥: 신정(01-01)을 지우면 잡힌다(원래 열거돼 있던 항목도 표 단언이 이중으로 잠근다)', () => {
  const bad = buildTables(mutate(src, "'01-01':'신정',", ''));
  assert.throws(() => checks.fixedTableLocked(bad), /HOLIDAYS_FIXED 표가 바뀌었다/);
  assert.throws(() => checks.fixedEveryYear(bad), /01-01 이 신정으로 조회되지 않는다/);
});
