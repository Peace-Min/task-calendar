// Layer 1 — netcus 주간보고 범위 병합 파서(parseNetcusWeekly) + 복사 텍스트(buildNetcusWeeklyText) 순수 함수 단위테스트.
// 두 함수 모두 전역·DOM 무의존이라 extractFunction으로 잘라 단독 검증한다(dependency-0).
// ※ 픽스처는 실물 조회 캡처의 '구조'만 재현하고 과제명은 전부 합성(알파/베타/감마/기타/휴가)이다. 실제 국방 과제명 없음.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';

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
const A_TOTAL = "const nm = mh[1].trim(); if(!nm || norm(nm) === '합계') continue;";
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
  const bad = mutateIn(src, SIG_PARSE, A_TOTAL, 'const nm = mh[1].trim(); if(!nm) continue;');
  assert.throws(() => checks.totalLineGuard(parserFrom(bad)), /과제 시간으로 누적하면 안 된다/);
});

test('변이⑦: 주차별 2칸 접두를 빼면 들여쓰기 계약이 잡는다', () => {
  const bad = mutateIn(src, SIG_BUILD, A_INDENT, 'parts.push(ln);');
  assert.throws(() => checks.weeklyLinePrefix(parseNetcusWeekly, builderFrom(bad)), /2칸 접두/);
});
