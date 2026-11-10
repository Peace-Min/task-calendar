// Layer 1 — netcus 주간보고 범위 병합 파서(parseNetcusWeekly) + 복사 텍스트(buildNetcusWeeklyText) 순수 함수 단위테스트.
// 두 함수 모두 전역·DOM 무의존이라 extractFunction으로 잘라 단독 검증한다(dependency-0).
// ※ 픽스처는 실물 조회 캡처의 '구조'만 재현하고 과제명은 전부 합성(알파/베타/감마/기타/휴가)이다. 실제 국방 과제명 없음.
import { test, assert, loadAppSource, extractFunction, readText } from './harness.mjs';

const src = loadAppSource();
const parseNetcusWeekly = eval('(' + extractFunction(src, 'parseNetcusWeekly') + ')');
const buildNetcusWeeklyText = eval('(' + extractFunction(src, 'buildNetcusWeeklyText') + ')');

// 등록 과제(매칭) — 알파/베타만 등록, 감마/기타/휴가는 미등록.
const CATS = [{ id: 'a', name: '알파' }, { id: 'b', name: '베타' }];

// 실물 진행사항 구조 재현(합성 과제명):
//  · 컬럼0 [과제] = 헤더 / 들여쓰기 [내부] = 본문(헤더 오인 금지) / '-'만 = 빈 과제 / 컬럼0 여러 헤더
const WEEK_A = {
  regdate: '2026-07-10', title: '7월 둘째주', period: '2026-07-06 ~ 2026-07-11',
  endwork:
    '[알파]\n' +
    '1. 구현\n' +
    '    - 알파 작업 하나\n' +
    '    - 알파 작업 둘\n' +
    '\n' +
    '[베타]\n' +
    '1. 구현\n' +
    '    [내부 항목]\n' +               // 들여쓰기 대괄호 = 본문(별도 과제 아님)
    '    - 베타 작업\n' +
    '\n' +
    '[감마]\n' +
    '-\n' +                            // 빈 과제(이 주)
    '\n' +
    '[기타]\n' +
    '    - 회의',
  content:
    '[알파] : 10\n' +
    '[베타] : 5\n' +
    '[감마] : 0\n' +
    '[기타] : 3\n' +
    '----------------------------\n' +
    '합계 : 18',
  plan: '',
};
const WEEK_B = {
  regdate: '2026-07-03', title: '7월 첫째주', period: '2026-06-29 ~ 2026-07-04',
  endwork:
    '[알파]\n' +
    '1. 구현\n' +
    '    - 알파 추가 작업\n' +
    '\n' +
    '[휴가]\n' +
    '    - 오전 반차',
  content:
    '[알파] : 8\n' +
    '[휴가] : 4\n' +
    '-----\n' +
    '합계 : 12',
  plan: '',
};

// ══ 검사 함수(테스트 + 변이 주입이 같은 함수를 쓴다) ══════════════════════
// 아래 검사들은 "이름은 계약을 주장하는데 픽스처가 그 분기를 한 번도 안 밟는" 구멍을 메운 것이다.
// 파일 하단의 변이 주입이 같은 함수를 재사용해 "깨뜨리면 실제로 운다"를 증명한다.
// 인자로 구현(parse/build)을 받는 이유가 그것이다 — 변이 소스로 만든 구현을 그대로 먹인다.
const checks = {
  // ① 부동소수 보정 — Math.round(sum*100)/100.
  //    2진 정확값(2.5+1.25)은 오차가 없어 이 분기를 밟지 못한다. 1.1+2.2 라야 밟는다.
  decimalRounding(parse) {
    assert.notStrictEqual(1.1 + 2.2, 3.3,
      '픽스처 전제 붕괴: 1.1+2.2 에 오차가 없으면 이 검사는 반올림 분기를 밟지 못한다(=장식)');
    const p = parse([
      { title: '주1', period: '', endwork: '[알파]\n작업1', content: '[알파] : 1.1' },
      { title: '주2', period: '', endwork: '[알파]\n작업2', content: '[알파] : 2.2' },
    ], CATS);
    assert.strictEqual(p.tasks[0].hours, 3.3,
      '소수 2자리로 보정하지 않았다 — 보고서 헤더가 "[알파] — 투입 3.3000000000000003h" 로 나간다');
    assert.strictEqual(p.hoursByTask['알파'], 3.3, 'hoursByTask 에도 보정된 값이 실려야 한다');
    // 보정이 멀쩡한 값을 훼손하지도 않는다(2진 정확값은 그대로).
    const q = parse([
      { title: '주1', period: '', endwork: '[알파]\n작업1', content: '[알파] : 2.5' },
      { title: '주2', period: '', endwork: '[알파]\n작업2', content: '[알파] : 1.25' },
    ], CATS);
    assert.strictEqual(q.tasks[0].hours, 3.75, '오차 없는 합은 보정으로도 값이 안 바뀐다');
  },

  // ② 같은 줄의 기본값 계약 — 시간 기록이 없으면 hours 는 '숫자 0'(null/undefined 아님).
  //    buildNetcusWeeklyText 는 typeof 'number' 로 걸러 조용히 넘어가므로 여기가 유일한 방어선이다.
  zeroHoursDefault(parse) {
    const p = parse([{ title: '주', period: '', endwork: '[알파]\n작업', content: '' }], CATS);
    assert.strictEqual(p.tasks[0].hours, 0, '시간 기록 없는 과제의 hours 기본값은 숫자 0');
    assert.strictEqual(typeof p.tasks[0].hours, 'number', 'hours 는 언제나 number 여야 한다');
    assert.deepStrictEqual(p.hoursByTask, { 알파: 0 }, 'hoursByTask 값도 숫자 0');
  },

  // ③ 병합 키의 공백 제거 규칙 — 회사양식은 주마다 '[알파 시스템]'/'[알파시스템]' 로 흔들린다.
  //    깨지면 같은 과제가 둘로 쪼개지고 등록명과도 안 붙어 미등록 취급된다(주간보고 본문 파손).
  normSpaceMerge(parse) {
    const p = parse([
      { title: '주1', period: '', endwork: '[알파 시스템]\n작업1', content: '[알파 시스템] : 3' },
      { title: '주2', period: '', endwork: '[알파시스템]\n작업2', content: '[알파시스템] : 2' },
    ], [{ id: 'a', name: '알파시스템' }]);
    assert.strictEqual(p.tasks.length, 1, '공백 표기 흔들림은 한 과제로 병합');
    assert.strictEqual(p.tasks[0].blocks.length, 2, '두 주 블록이 한 과제 밑에 누적');
    assert.strictEqual(p.tasks[0].hours, 5, '3+2 — 시간도 같은 키로 합산');
    assert.strictEqual(p.tasks[0].matched, true, '등록명과 공백만 다른 헤더도 등록 과제로 붙는다');
    assert.strictEqual(p.tasks[0].catId, 'a');
  },

  // ④ 병합 키의 NFC 정규화 규칙 — 자모 분해형(NFD)으로 들어오는 붙여넣기가 실재한다.
  //    ③과 규칙이 다르므로 따로 시험해야 각각의 제거를 잡는다.
  normNfcMerge(parse) {
    const NAME = '알파시스템', NFD = NAME.normalize('NFD');
    assert.notStrictEqual(NFD, NAME, '픽스처 전제 붕괴: NFD 분해형이 NFC 와 같으면 이 검사는 장식이다');
    const p = parse([
      { title: '주1', period: '', endwork: '[' + NAME + ']\n작업1', content: '[' + NAME + '] : 3' },
      { title: '주2', period: '', endwork: '[' + NFD + ']\n작업2', content: '[' + NFD + '] : 2' },
    ], [{ id: 'a', name: NAME }]);
    assert.strictEqual(p.tasks.length, 1, '자모 흔들림도 한 과제로 병합');
    assert.strictEqual(p.tasks[0].blocks.length, 2, '두 주 블록이 한 과제 밑에 누적');
    assert.strictEqual(p.tasks[0].hours, 5, '3+2 — 시간도 같은 키로 합산');
    assert.strictEqual(p.tasks[0].matched, true, '등록명과 정규화형만 다른 헤더도 등록 과제로 붙는다');
    assert.strictEqual(p.tasks[0].catId, 'a');
  },

  // ⑤ '합계' 가드 — 양식이 '합계 : 18'(대괄호 없음)이면 정규식이 알아서 거른다.
  //    '[합계] : 18' 로 바뀌는 순간 norm(nm)==='합계' 가드가 유일한 방어선이 된다.
  totalLineGuard(parse) {
    const p = parse([{
      title: '주', period: '',
      endwork: '[알파]\n- 작업\n\n[합계]\n- 집계 메모',
      content: '[알파] : 10\n[합계] : 18',
    }], CATS);
    assert.strictEqual(p.tasks.find(t => t.name === '알파').hours, 10, '실제 과제 시간은 그대로');
    const total = p.tasks.find(t => t.name === '합계');
    assert.ok(total, '픽스처 전제: 진행사항에 [합계] 블록이 있어 과제로 남는다');
    assert.strictEqual(total.hours, 0,
      "'[합계] : 18' 은 과제 시간으로 누적하면 안 된다 — 가드가 없으면 18 이 실린다");
    assert.strictEqual(p.hoursByTask['합계'], 0, 'hoursByTask 에도 합계 시간이 새면 안 된다');
  },

  // ⑥ 주차별 원문 라인 2칸 접두 — 평면(flat)과 대비되는 유일한 형식 차이다.
  weeklyLinePrefix(parse, build) {
    const p = parse([WEEK_A, WEEK_B], CATS);
    const week = build(p, false), flat = build(p, true);
    assert.ok(week.includes('\n  1. 구현'), '주차별 원문 라인은 2칸 접두');
    assert.ok(week.includes('\n      - 알파 작업 하나'), '주차별은 원문4+접두2=6칸');
    assert.ok(!flat.includes('\n  1. 구현'), '평면엔 2칸 접두가 없다(형식이 실제로 갈린다)');
  },
};

// ── 다주 병합 + 순서(first-seen) + 감마('-'만) 생략 ─────────────────────────
test('parseNetcusWeekly: 여러 주 병합 + first-seen 순서 + 빈(-) 과제 생략', () => {
  const p = parseNetcusWeekly([WEEK_A, WEEK_B], CATS);
  // 감마는 두 주 모두 '-'뿐 → 생략. 순서 = 첫 등장 순.
  assert.deepStrictEqual(p.order, ['알파', '베타', '기타', '휴가']);
  assert.deepStrictEqual(p.tasks.map(t => t.name), ['알파', '베타', '기타', '휴가']);
  assert.strictEqual(p.weekCount, 2);
});

test('parseNetcusWeekly: 같은 과제(알파)가 여러 주 블록으로 누적(주차 순서 보존)', () => {
  const p = parseNetcusWeekly([WEEK_A, WEEK_B], CATS);
  const alpha = p.tasks.find(t => t.name === '알파');
  assert.strictEqual(alpha.blocks.length, 2, '두 주 등장 → 블록 2');
  assert.strictEqual(alpha.blocks[0].period, '2026-07-06 ~ 2026-07-11');
  assert.strictEqual(alpha.blocks[1].period, '2026-06-29 ~ 2026-07-04');
  assert.deepStrictEqual(alpha.blocks[0].lines, ['1. 구현', '    - 알파 작업 하나', '    - 알파 작업 둘']);
  assert.deepStrictEqual(alpha.blocks[1].lines, ['1. 구현', '    - 알파 추가 작업']);
});

// ── 시간 합산(과제투입시간) + '합계' 라인 제외 ────────────────────────────
test('parseNetcusWeekly: 과제투입시간 과제별 합산, 합계 라인 제외', () => {
  const p = parseNetcusWeekly([WEEK_A, WEEK_B], CATS);
  assert.deepStrictEqual(p.hoursByTask, { 알파: 18, 베타: 5, 기타: 3, 휴가: 4 });
  assert.strictEqual(p.tasks.find(t => t.name === '알파').hours, 18);   // 10 + 8
  assert.ok(!Object.prototype.hasOwnProperty.call(p.hoursByTask, '합계'), '합계는 과제로 안 잡힘');
});

// ※ 2026-09-04: 이 테스트는 2.5+1.25 만 썼다 — 둘 다 2진 정확값이라 오차가 안 나고
//    Math.round 분기를 한 번도 밟지 않았다(반올림을 통째로 지워도 조용했다).
//    1.1+2.2(=3.3000000000000003) 를 검사 함수 안에 넣어 실제로 분기를 밟게 했고,
//    기존 3.75 계약은 그대로 유지한다(조이기, 지우기 아님).
test('parseNetcusWeekly: 소수 시간 합산(부동소수 반올림)', () => {
  checks.decimalRounding(parseNetcusWeekly);
});

test('parseNetcusWeekly: 시간 기록 없는 과제의 hours 기본값은 숫자 0', () => {
  checks.zeroHoursDefault(parseNetcusWeekly);
});

// ── 과제명 정규화 키(NFC + 공백 제거) — 표기 흔들림 병합 ──────────────────
// 기존 픽스처(알파/베타/감마/기타/휴가)는 표기가 이미 완전히 일치해 정규화를 발동시키지 못했다.
// 형제 파서 netcus-week.test.mjs 가 같은 계약을 시험하는 방식을 이식한다.
test('parseNetcusWeekly: 표기 흔들림(공백)이 있어도 같은 과제로 병합·matched 유지', () => {
  checks.normSpaceMerge(parseNetcusWeekly);
});

test('parseNetcusWeekly: 자모 분해형(NFD)과 완성형(NFC)도 같은 과제로 병합', () => {
  checks.normNfcMerge(parseNetcusWeekly);
});

test("parseNetcusWeekly: '[합계] : N'(대괄호 있는 합계 행)은 과제 시간에 누적되지 않는다", () => {
  checks.totalLineGuard(parseNetcusWeekly);
});

// ── 들여쓰기 [..]가 헤더로 오인되지 않음 ─────────────────────────────────
test('parseNetcusWeekly: 들여쓰기 [내부 항목]은 헤더 아님(본문 라인으로 유지)', () => {
  const p = parseNetcusWeekly([WEEK_A, WEEK_B], CATS);
  assert.ok(!p.tasks.some(t => t.name === '내부 항목'), '들여쓰기 대괄호는 과제로 안 만들어짐');
  const beta = p.tasks.find(t => t.name === '베타');
  assert.deepStrictEqual(beta.lines === undefined ? beta.blocks[0].lines : beta.blocks[0].lines,
    ['1. 구현', '    [내부 항목]', '    - 베타 작업']);
  assert.ok(beta.blocks[0].lines.some(l => l.trim() === '[내부 항목]'), '[내부 항목]은 본문 라인으로 보존');
});

test('parseNetcusWeekly: 선두 &nbsp;(U+00A0) 들여쓰기도 \\s로 취급 — 들여쓰기 [x]는 본문', () => {
  const NB = '    ';   // 실물 innerText는 &nbsp;→U+00A0
  const p = parseNetcusWeekly([{
    title: '주', period: '',
    endwork: '[알파]\n1. 구현\n' + NB + '[내부]\n' + NB + '- 작업',
    content: '[알파] : 1',
  }], CATS);
  assert.strictEqual(p.tasks.length, 1, '알파 하나');
  assert.ok(!p.tasks.some(t => t.name === '내부'), 'nbsp 들여쓰기 [내부]는 헤더 아님');
  assert.ok(p.tasks[0].blocks[0].lines.some(l => l.trim() === '[내부]'), '본문 라인으로 유지');
});

// ── 미등록/미등장 과제 처리 ──────────────────────────────────────────────
test('parseNetcusWeekly: 등록 과제=matched true / 미등록=false, 미등장 과제는 생략', () => {
  const p = parseNetcusWeekly([WEEK_A, WEEK_B], CATS);
  assert.strictEqual(p.tasks.find(t => t.name === '알파').matched, true);
  assert.strictEqual(p.tasks.find(t => t.name === '알파').catId, 'a');
  assert.strictEqual(p.tasks.find(t => t.name === '베타').matched, true);
  assert.strictEqual(p.tasks.find(t => t.name === '기타').matched, false);
  assert.strictEqual(p.tasks.find(t => t.name === '휴가').matched, false);
  assert.ok(!p.tasks.some(t => t.name === '델타'), '등장 안 한 과제는 없음');
});

// ── 빈(-)만 있는 과제는 완전 생략 ─────────────────────────────────────────
test('parseNetcusWeekly: 전 주가 빈(-)인 과제는 tasks에서 완전 생략', () => {
  const p = parseNetcusWeekly([
    { title: '주1', period: '', endwork: '[감마]\n-', content: '[감마] : 0' },
    { title: '주2', period: '', endwork: '[감마]\n   -   ', content: '[감마] : 0' },
  ], CATS);
  assert.strictEqual(p.tasks.length, 0, '진행사항 라인 0 → 과제 생략');
  assert.deepStrictEqual(p.hoursByTask, {}, '생략 과제는 시간 맵에도 없음');
});

// ── 첫 헤더가 들여쓰기여도 인식(cur 없을 때 관대) ─────────────────────────
test('parseNetcusWeekly: 첫 과제 헤더가 들여쓰기여도 헤더로 인식(cur 없음)', () => {
  const p = parseNetcusWeekly([{ title: '주', period: '', endwork: '  [알파]\n1. 구현\n    - 작업', content: '[알파] : 1' }], CATS);
  assert.strictEqual(p.tasks.length, 1);
  assert.strictEqual(p.tasks[0].name, '알파');
  assert.deepStrictEqual(p.tasks[0].blocks[0].lines, ['1. 구현', '    - 작업']);
});

// ── 경계/방어 ────────────────────────────────────────────────────────────
test('parseNetcusWeekly: 빈 weeks → 빈 결과', () => {
  const p = parseNetcusWeekly([], CATS);
  assert.deepStrictEqual(p.tasks, []);
  assert.deepStrictEqual(p.order, []);
  assert.deepStrictEqual(p.hoursByTask, {});
  assert.strictEqual(p.weekCount, 0);
});

test('parseNetcusWeekly: null/누락 입력 방어', () => {
  const p = parseNetcusWeekly(null, null);
  assert.deepStrictEqual(p.tasks, []);
  assert.strictEqual(p.weekCount, 0);
  // 완전 빈 주(endwork/content 모두 공백)는 weekCount 증가 안 함
  const p2 = parseNetcusWeekly([{ title: 't', period: 'p', endwork: '   ', content: '' }], CATS);
  assert.strictEqual(p2.weekCount, 0);
  assert.deepStrictEqual(p2.tasks, []);
});

// ── buildNetcusWeeklyText(복사/미리보기 WYSIWYG) ─────────────────────────
test('buildNetcusWeeklyText: 과제별 묶음 + 투입시간 병기 + 주차 소제목 + 라인 들여쓰기', () => {
  const p = parseNetcusWeekly([WEEK_A, WEEK_B], CATS);
  const out = buildNetcusWeeklyText(p);
  assert.ok(out.includes('[알파] — 투입 18h'), '과제명 옆 투입시간 총합 병기');
  assert.ok(out.includes('· 7월 둘째주 (2026-07-06 ~ 2026-07-11)'), '주차 소제목(제목+기간)');
  assert.ok(out.includes('\n  1. 구현'), '라인은 2칸 들여 소제목 아래');
  assert.ok(out.includes('\n      - 알파 작업 하나'), '원문 들여쓰기(4)+접두(2)=6칸 보존');
  // 과제 순서 = tasks 순서
  assert.ok(out.indexOf('[알파]') < out.indexOf('[베타]'), '알파 먼저');
  assert.ok(out.indexOf('[베타]') < out.indexOf('[기타]'), '베타 다음 기타');
  // 들여쓰기 대괄호는 별도 과제 헤더가 아니라 본문
  assert.ok(out.includes('[내부 항목]'), '본문 [내부 항목] 유지');
  assert.ok(!/^\[내부 항목\]/m.test(out), '[내부 항목]이 과제 헤더(줄머리)로 나오지 않음');
});

test('buildNetcusWeeklyText: 투입시간 없는 과제는 헤더에 — 투입 없음', () => {
  const p = parseNetcusWeekly([{ title: '주', period: '2026-07-06 ~ 2026-07-11', endwork: '[알파]\n작업', content: '' }], CATS);
  const out = buildNetcusWeeklyText(p);
  assert.ok(out.startsWith('[알파]'), '과제 헤더');
  assert.ok(!out.includes('투입'), '시간 기록 없으면 투입 병기 없음');
  assert.ok(out.includes('· 주 (2026-07-06 ~ 2026-07-11)'));
});

test('buildNetcusWeeklyText: 결정론 + 빈 parsed 방어', () => {
  const p = parseNetcusWeekly([WEEK_A], CATS);
  assert.strictEqual(buildNetcusWeeklyText(p), buildNetcusWeeklyText(p));
  assert.strictEqual(buildNetcusWeeklyText(null), '');
  assert.strictEqual(buildNetcusWeeklyText({}), '');
  assert.strictEqual(buildNetcusWeeklyText({ tasks: [] }), '');
});

// ── 평면 모드(flat=true) — 주차 헤더 없이 과제 아래 전 주 원문 나열 ─────────
test('buildNetcusWeeklyText(flat): 주차 소제목 제거·원문 무들여쓰기·주 사이 빈 줄', () => {
  const p = parseNetcusWeekly([WEEK_A, WEEK_B], CATS);
  const out = buildNetcusWeeklyText(p, true);
  assert.ok(out.includes('[알파] — 투입 18h'), '과제 헤더+투입시간은 유지');
  assert.ok(!out.includes('· 7월'), '주차 소제목(· 제목) 없음');
  assert.ok(!out.includes('(2026-07-06 ~ 2026-07-11)'), '기간 소제목 없음');
  // 원문 라인은 2칸 접두 없이 그대로(주차별의 "\n  1. 구현"과 대비)
  assert.ok(out.includes('\n1. 구현\n    - 알파 작업 하나'), '무들여쓰기 원문 보존');
  assert.ok(!out.includes('\n  1. 구현'), '2칸 접두는 평면에서 없음');
  // 알파는 두 주 → 주 사이 빈 줄 하나
  assert.ok(out.includes('- 알파 작업 둘\n\n1. 구현\n    - 알파 추가 작업'), '주 블록 사이 빈 줄 구분');
});

test('buildNetcusWeeklyText(flat) vs 주차별: 같은 parsed에서 형식만 다름(결정론)', () => {
  const p = parseNetcusWeekly([WEEK_A, WEEK_B], CATS);
  const week = buildNetcusWeeklyText(p, false), flat = buildNetcusWeeklyText(p, true);
  assert.notStrictEqual(week, flat, '두 형식은 다르다');
  assert.strictEqual(buildNetcusWeeklyText(p, true), buildNetcusWeeklyText(p, true), '평면도 결정론');
  assert.ok(week.includes('· 7월 둘째주'), '주차별엔 소제목');
  // flat 쪽 단언(!includes)만으로는 주차별 접두가 사라져도 침묵한다 — 주차별 전용 단언으로 2겹화.
  checks.weeklyLinePrefix(parseNetcusWeekly, buildNetcusWeeklyText);
});

// ── 메타(제목/기간) 공백 정리 — netcus 원문 &nbsp; 선두공백 제거 ───────────
test('parseNetcusWeekly: title/period 선두·중복 공백 정리(본문 들여쓰기는 보존)', () => {
  const p = parseNetcusWeekly([{
    title: '  주  제목 ', period: '  2026-07-06 ~ 2026-07-11 ',
    endwork: '[알파]\n1. 구현\n    - 들여쓴 작업', content: '[알파] : 1',
  }], CATS);
  const b = p.tasks[0].blocks[0];
  assert.strictEqual(b.title, '주 제목', '제목 선두공백 제거+중복 접기');
  assert.strictEqual(b.period, '2026-07-06 ~ 2026-07-11', '기간 선두공백 제거');
  assert.deepStrictEqual(b.lines, ['1. 구현', '    - 들여쓴 작업'], '본문 들여쓰기는 보존');
  const out = buildNetcusWeeklyText(p);
  assert.ok(out.includes('· 주 제목 (2026-07-06 ~ 2026-07-11)'), '소제목에 여분 공백 없음');
});

// ══ 변이 주입(위 검사가 실효성이 있는지 증명) ══════════════════════════════
// 각 변이는 "실제로 날 수 있는 회귀"다. 검사가 안 잡으면 그 검사는 장식이다.
// ★ 앵커가 소스에서 안 찾히면 여기서 실패한다 — 조용히 통과하지 않는다.
// ★ norm 선언은 형제 파서(parseNetcusWeek)에도 글자 그대로 같은 줄이 있다.
//    반드시 대상 함수 선언 이후 첫 등장만 치환한다(엉뚱한 함수를 변이시키면 증명이 거짓이 된다).
const SIG_PARSE = 'function parseNetcusWeekly(';
const SIG_BUILD = 'function buildNetcusWeeklyText(';

function mutateIn(source, sig, from, to) {
  const s = source.indexOf(sig);
  assert.ok(s >= 0, `변이 대상 함수를 찾지 못함: ${sig}`);
  const tail = source.slice(s);
  const out = tail.replace(from, to);
  assert.notStrictEqual(out, tail, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return source.slice(0, s) + out;
}
const parserFrom = source => eval('(' + extractFunction(source, 'parseNetcusWeekly') + ')');
const builderFrom = source => eval('(' + extractFunction(source, 'buildNetcusWeeklyText') + ')');

const A_HOURS = 't.hours = h ? Math.round(h.sum * 100) / 100 : 0;';
const A_NORM = String.raw`const norm = s => String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, '');`;
//  2026-11-10: 시간 줄이 안쪽 시간을 읽게 되며 이름 줄과 합계 가드 줄이 나뉘었다(가드 계약은 그대로)
const A_TOTAL = "if(!nm || norm(nm) === '합계') continue;";
const A_INDENT = "parts.push('  ' + ln);";

test('변이①: 반올림(Math.round)을 빼면 소수 합산 계약이 잡는다', () => {
  const bad = mutateIn(src, SIG_PARSE, A_HOURS, 't.hours = h ? h.sum : 0;');
  assert.throws(() => checks.decimalRounding(parserFrom(bad)), /소수 2자리로 보정하지 않았다/);
});

test('변이②: hours 기본값을 0 → null 로 바꾸면 기본값 계약이 잡는다', () => {
  const bad = mutateIn(src, SIG_PARSE, A_HOURS, 't.hours = h ? Math.round(h.sum * 100) / 100 : null;');
  assert.throws(() => checks.zeroHoursDefault(parserFrom(bad)), /기본값은 숫자 0/);
  // 반올림은 살아 있으므로 ①은 여전히 통과한다(두 계약이 서로 독립임을 못박는다).
  checks.decimalRounding(parserFrom(bad));
});

test('변이③: norm 에서 공백 제거를 빼면 공백 표기 흔들림 병합이 잡는다', () => {
  const bad = mutateIn(src, SIG_PARSE, A_NORM, "const norm = s => String(s == null ? '' : s).normalize('NFC');");
  assert.throws(() => checks.normSpaceMerge(parserFrom(bad)), /공백 표기 흔들림은 한 과제로 병합/);
  checks.normNfcMerge(parserFrom(bad));   // NFC 규칙은 살아 있다 — 두 규칙이 각각 시험됨
});

test('변이④: norm 에서 NFC 정규화를 빼면 자모(NFD/NFC) 병합이 잡는다', () => {
  const bad = mutateIn(src, SIG_PARSE, A_NORM, String.raw`const norm = s => String(s == null ? '' : s).replace(/\s+/g, '');`);
  assert.throws(() => checks.normNfcMerge(parserFrom(bad)), /자모 흔들림도 한 과제로 병합/);
  checks.normSpaceMerge(parserFrom(bad));   // 공백 규칙은 살아 있다
});

test('변이⑤: norm 을 항등함수로 만들면 병합 계약 둘이 모두 잡는다', () => {
  const bad = mutateIn(src, SIG_PARSE, A_NORM, "const norm = s => String(s == null ? '' : s);");
  const parse = parserFrom(bad);
  assert.throws(() => checks.normSpaceMerge(parse), /공백 표기 흔들림은 한 과제로 병합/);
  assert.throws(() => checks.normNfcMerge(parse), /자모 흔들림도 한 과제로 병합/);
});

test("변이⑥: '합계' 가드를 빼면 [합계] 행이 과제 시간으로 새는 것을 잡는다", () => {
  const bad = mutateIn(src, SIG_PARSE, A_TOTAL, 'if(!nm) continue;');
  assert.throws(() => checks.totalLineGuard(parserFrom(bad)), /과제 시간으로 누적하면 안 된다/);
});

test('변이⑦: 주차별 2칸 접두를 빼면 들여쓰기 계약이 잡는다', () => {
  const bad = mutateIn(src, SIG_BUILD, A_INDENT, 'parts.push(ln);');
  assert.throws(() => checks.weeklyLinePrefix(parseNetcusWeekly, builderFrom(bad)), /2칸 접두/);
});

// ══ 2026-11-10 머리와 시간 읽기 넓힘(docs/MONTHLY-HEAD-MAPPING.md 결정 1, 9) ══════════════
// 사례 = tests/fixtures/weekly-head-cases.json(인트라넷 실제 글 모양 17건, 이름은 가짜). 기대값은 픽스처를 눈으로 읽고 손으로 적었다.
//   과제 이름 = 남는 과제(본문이 '-' 뿐이거나 빈 머리는 빠진다, 기존 규칙), 첫 등장 순서. hours = 그 과제들의 시간.
//   ◈ 머리, 괄호 머리는 지원하지 않는다(결정 6): c05 는 과제가 없고, c13, c14 는 0칸 태그([구현] 등)가 머리가 된다.
const HEAD_CASES = JSON.parse(readText(new URL('./fixtures/weekly-head-cases.json', import.meta.url))).cases;
const caseById = (id) => { const c = HEAD_CASES.find((x) => x.id.startsWith(id + '-')); assert.ok(c, '사례가 없다: ' + id); return c; };
const caseWeek = (c) => ({ title: c.id, period: '', endwork: c['진행사항'], content: c['과제투입시간'] });
const HEAD_WANT = {
  c00: { names: ['과제A', '과제B', '과제C', '휴가', '기타'], hours: { 과제A: 12.5, 과제B: 17.5, 과제C: 1, 휴가: 4, 기타: 5 } },
  c01: { names: ['과제C', '기타'], hours: { 과제C: 30.5, 기타: 9.5 } },                       // 들여 쓴 [과제D] [과제E] 는 기타 본문
  c02: { names: ['과제A', '과제B'], hours: { 과제A: 12, 과제B: 4 } },                        // [X] 12
  c03: { names: ['과제A', '과제B', '과제E', '과제G'], hours: { 과제A: 34, 과제B: 0, 과제E: 0, 과제G: 8 } },   // 꼬리 (~'27/11/20) 뗌, [과제B] :0
  c04: { names: ['과제A', '과제B', '기타'], hours: { 과제A: 20, 과제B: 18, 기타: 3 } },          // [X]:N
  c05: { names: [], hours: {} },                                                             // 괄호 머리만: 과제 없음
  c06: { names: ['과제A', '과제B', '과제C'], hours: { 과제A: 3, 과제B: 46, 과제C: 1 } },        // [X] - N
  c07: { names: ['과제A', '과제B', '과제C'], hours: { 과제A: 0, 과제B: 5, 과제C: 39 } },        // '- [과제D]' 는 본문
  c08: { names: ['과제A', '과제C', '과제D'], hours: { 과제A: 13, 과제C: 5.5, 과제D: 26.5 } },   // 머리 꼬리 ': 13h' 뗌, 시간 13h
  c09: { names: ['과제B', '과제E', '과제F', '과제G'], hours: { 과제B: 0, 과제E: 1, 과제F: 7.5, 과제G: 0 } },   // 꼬리 ' - 2026 9월', '(내용)' 뗌
  c10: { names: ['과제C', '과제D', '과제E'], hours: { 과제C: 4, 과제D: 24, 과제E: 8 } },
  c11: { names: ['과제A', '과제B', '과제C', '과제E', '과제F'], hours: { 과제A: 6, 과제B: 3, 과제C: 18, 과제E: 8, 과제F: 0 } },   // [과제F:1] -> 과제F
  c12: { names: ['과제A', '과제B', '과제C', '과제D', '기타'], hours: { 과제A: 2, 과제B: 1, 과제C: 2, 과제D: 3, 기타: 32 } },   // 꼬리 ' : 2' 뗌
  c13: { names: ['구현', '시험'], hours: { 구현: 0, 시험: 0 } },                                // ◈ 머리 미지원
  c14: { names: ['관리', '설계/구현', '문서 작성', '구현/시험/회의', '분석/설계/구현'], hours: { 관리: 0, '설계/구현': 0, '문서 작성': 0, '구현/시험/회의': 0, '분석/설계/구현': 0 } },
  c15: { names: ['기능구현', '출장', '과제B', '과제C', '과제D', '과제E', '과제F', '기타'], hours: { 기능구현: 0, 출장: 0, 과제B: 0, 과제C: 10, 과제D: 0, 과제E: 18, 과제F: 12, 기타: 0 } },
  c16: { names: ['과제A', '과제B', '과제C', '보안', '과제O', '구매', '정산', '기타', '휴가'], hours: { 과제A: 0, 과제B: 0, 과제C: 0, 보안: 0, 과제O: 0, 구매: 0, 정산: 0, 기타: 0, 휴가: 0 } },
};
const headChecks = {
  //  사례 17건의 과제 이름과 시간(꼬리 뗌, 안쪽 시간 뗌, 시간 표기 여러 벌)
  cases(parse) {
    assert.strictEqual(HEAD_CASES.length, 17, '픽스처 전제: 사례 17건');
    assert.deepStrictEqual(Object.keys(HEAD_WANT).sort(), HEAD_CASES.map((c) => c.id.slice(0, 3)).sort(), '기대값이 사례마다 하나가 아니다');
    for (const [id, want] of Object.entries(HEAD_WANT)) {
      const p = parse([caseWeek(caseById(id))], []);
      assert.deepStrictEqual(p.order, want.names, id + ': 과제 이름(머리 읽기)이 다르다');
      assert.deepStrictEqual(p.hoursByTask, want.hours, id + ': 과제 시간이 다르다');
    }
  },
  //  들여 쓰거나 기호 뒤의 [ 는 본문으로 남는다(c01, c07, c12)
  bodyBrackets(parse) {
    const lines = (id, name) => parse([caseWeek(caseById(id))], []).tasks.find((t) => t.name === name).blocks[0].lines;
    const c01 = lines('c01', '기타');
    assert.ok(c01.includes('    [과제D]') && c01.includes('    [과제E]'), 'c01: 들여 쓴 [과제D] [과제E] 가 기타 본문에 남지 않았다');
    const c07 = lines('c07', '과제C');
    assert.ok(c07.includes('- [과제D]') && c07.includes('- [과제E] 내용 내용 내용 내용(내용)'), 'c07: 기호 뒤 [과제] 가 과제C 본문에 남지 않았다');
    assert.ok(lines('c12', '기타').includes('  * [과제E]'), 'c12: 들여 쓴 * [과제E] 가 기타 본문에 남지 않았다');
  },
  //  머리 꼬리: 버리고 이름만(본문 첫 줄은 꼬리 다음 줄)
  headTail(parse) {
    const p = parse([caseWeek(caseById('c03'))], [{ id: 'a', name: '과제A' }]);
    const a = p.tasks.find((t) => t.name === '과제A');
    assert.ok(a && a.matched && a.catId === 'a', 'c03: 꼬리 붙은 [과제A](~...) 가 내 과제와 맞지 않았다');
    assert.strictEqual(a.blocks[0].lines[0], '◈ 내용', 'c03: 꼬리 다음 줄이 본문 첫 줄이 아니다');
    const q = parse([{ title: '주', period: '', endwork: '[과제A : 13h]\n- 일\n[: 3]\n- 이름 없는 머리는 본문\n[]\n- 빈 머리도 본문', content: '' }], []);
    assert.deepStrictEqual(q.order, ['과제A'], '안쪽 시간 [과제A : 13h] 을 떼지 않았거나 이름이 빈 머리를 과제로 만들었다');
    assert.deepStrictEqual(q.tasks[0].blocks[0].lines, ['- 일', '[: 3]', '- 이름 없는 머리는 본문', '[]', '- 빈 머리도 본문']);
  },
  //  시간 표기(결정 9). 실제 사례 모양에 합성 몇 줄
  hoursForms(parse) {
    const h = (content) => parse([{ title: '주', period: '', endwork: '[X]\n- 일', content }], []).hoursByTask.X;
    assert.strictEqual(h('[X] 12'), 12, '[X] N(c02)');
    assert.strictEqual(h('[X] - 46'), 46, '[X] - N(c06)');
    assert.strictEqual(h('[X] : 13h'), 13, 'Nh(c08)');
    assert.strictEqual(h('[X] : .5'), 0.5, '[X] : .5 는 0.5');
    assert.strictEqual(h('[X]8'), 8, '[X]N');
    assert.strictEqual(h('[X] :8'), 8, '[X] :N');
    assert.strictEqual(h('[X]: 2.5'), 2.5, '[X]: N');
    assert.strictEqual(h('[X : 3]'), 3, '[X : N] 안쪽 시간');
    assert.strictEqual(h('[X:1]'), 1, '[X:N] 안쪽 시간');
    assert.strictEqual(h('[X] :\n[X] 내용'), 0, '숫자가 없으면 시간 없음');
    //  c10 의 안쪽 시간 줄 [과제F : 0] 을 실제 모양 그대로 숫자만 바꿔 본다(0 이면 없음과 구별되지 않아서)
    const c10 = caseById('c10');
    assert.ok(c10['과제투입시간'].includes('[과제F : 0]'), '픽스처 전제: c10 에 [과제F : 0] 줄이 있다');
    const p = parse([{ title: 'c10', period: '', endwork: c10['진행사항'] + '\n[과제F]\n- 내용', content: c10['과제투입시간'].replace('[과제F : 0]', '[과제F : 6]') }], []);
    assert.strictEqual(p.hoursByTask['과제F'], 6, 'c10: [과제F : N] 안쪽 시간을 읽지 않았다');
  },
};
test('parseNetcusWeekly 머리(2026-11-10): 사례 17건의 과제 이름(꼬리, 안쪽 시간 뗌)과 시간', () => headChecks.cases(parseNetcusWeekly));
test('parseNetcusWeekly 머리(2026-11-10): 들여 쓰거나 기호 뒤의 [과제] 는 본문(c01, c07, c12)', () => headChecks.bodyBrackets(parseNetcusWeekly));
test('parseNetcusWeekly 머리(2026-11-10): 꼬리 붙은 머리도 내 과제와 맞고, 이름이 빈 [ ] 는 본문', () => headChecks.headTail(parseNetcusWeekly));
test('parseNetcusWeekly 시간(2026-11-10): [X] N, [X] - N, Nh, .5, [X]N, [X : N], 숫자 없음', () => headChecks.hoursForms(parseNetcusWeekly));
//  QA 0.27.0: 0칸 '[' 줄이라도 꼬리가 잰 모양(빈 꼬리, 괄호, 쌍점 시간, 숫자 시간, 대시 뒤 숫자나 괄호)이 아니면 본문(0.26.0 과 같음)
const tailBody = (parse) => {
  const p = parse([{ title: '주', period: '', endwork: '[(예시) 관제 고도화]\n- 화면 검토\n[완료] 설계서 제출\n  - 검토 의견 반영\n[보류]: 외부 연동 일정\n- 마지막 줄', content: '' }], []);
  assert.deepStrictEqual(p.order, ['(예시) 관제 고도화'], '꼬리가 글인 [완료] 설계서 제출 을 새 머리로 읽었다');
  assert.deepStrictEqual(p.tasks[0].blocks[0].lines, ['- 화면 검토', '[완료] 설계서 제출', '  - 검토 의견 반영', '[보류]: 외부 연동 일정', '- 마지막 줄'], '[완료] 설계서 제출 뒤 글이 지금 과제 본문에 남지 않았다');
};
const tailHeads = (parse) => {
  const forms = ['', "(~'27/11/20)", '(내용)', ' : 13h', ' : 2', ' :', ':', ' : .5', ' 12', '8h', ' .5', ' - 46', ' - 2026 9월', ' - (3내용 내용)2028년 04월 15내용', '：3'];
  for (const tail of forms) {
    const p = parse([{ title: '주', period: '', endwork: '[앞 과제]\n- 앞 일\n[과제X]' + tail + '\n- 일', content: '' }], []);
    assert.deepStrictEqual(p.order, ['앞 과제', '과제X'], '잰 꼬리 ' + JSON.stringify(tail) + ' 인 줄을 머리로 읽지 않았다');
    assert.deepStrictEqual(p.tasks[1].blocks[0].lines, ['- 일'], '잰 꼬리 ' + JSON.stringify(tail) + ' 머리의 본문이 다르다');
  }
};
test('parseNetcusWeekly 머리 꼬리(QA 0.27.0): [완료] 설계서 제출 처럼 꼬리가 글이면 지금 과제의 본문', () => tailBody(parseNetcusWeekly));
test('parseNetcusWeekly 머리 꼬리(QA 0.27.0): 잰 꼬리(빈, 괄호, 쌍점 시간, 숫자, 대시)는 그대로 머리', () => tailHeads(parseNetcusWeekly));
test('변이⑩: 꼬리 검사를 빼면 [완료] 설계서 제출 본문 검사가 잡는다', () => {
  const bad = parserFrom(mutateIn(src, SIG_PARSE, '(mh && reHeadTail.test(trimmed.slice(mh[0].length)))', 'mh'));
  assert.throws(() => tailBody(bad), /새 머리/);
  tailHeads(bad);
});

const A_HEAD = String.raw`const reHead = /^\[([^\]]*)\]/;`;
const A_HOURS_RE = String.raw`const reHours = /^\s*\[([^\]]*)\](.*)$/;`;
test('변이⑧: 머리를 옛 규칙(줄 전체가 대괄호)으로 되돌리면 사례 머리 검사가 잡는다', () => {
  const bad = parserFrom(mutateIn(src, SIG_PARSE, A_HEAD, String.raw`const reHead = /^\[\s*(.+?)\s*\]$/;`));
  assert.throws(() => headChecks.cases(bad), /머리 읽기/);
  assert.throws(() => headChecks.headTail(bad), /꼬리/);
});
test('변이⑨: 시간 줄을 옛 규칙([X] : N 만)으로 되돌리면 시간 표기 검사가 잡는다', () => {
  //  옛 정규식은 '[X] 12', '[X] - 46', '[X : 3]' 같은 줄에 아예 맞지 않는다
  const bad = parserFrom(mutateIn(src, SIG_PARSE, A_HOURS_RE, String.raw`const reHours = /^\s*\[\s*(.+?)\s*\]\s*[:：]\s*(\d+(?:\.\d+)?)/;`));
  assert.throws(() => headChecks.hoursForms(bad), /\[X\] N|\[X\] - N|안쪽/);
  assert.throws(() => headChecks.cases(bad), /시간이 다르다/);
});
