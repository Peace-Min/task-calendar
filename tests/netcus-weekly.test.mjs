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

test('parseNetcusWeekly: 소수 시간 합산(부동소수 반올림)', () => {
  const p = parseNetcusWeekly([
    { title: '주1', period: '', endwork: '[알파]\n작업1', content: '[알파] : 2.5' },
    { title: '주2', period: '', endwork: '[알파]\n작업2', content: '[알파] : 1.25' },
  ], CATS);
  assert.strictEqual(p.tasks[0].hours, 3.75);
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
