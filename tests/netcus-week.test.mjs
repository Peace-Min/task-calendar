// Layer 1 — netcus 주간 병합 파서(parseNetcusWeek) + 전송 텍스트(buildNetcusSendText) 순수 함수 단위테스트.
// 두 함수 모두 전역·DOM 무의존이라 extractFunction으로 잘라 단독 검증한다(dependency-0).
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';

const src = loadAppSource();
const parseNetcusWeek = eval('(' + extractFunction(src, 'parseNetcusWeek') + ')');
const buildNetcusSendText = eval('(' + extractFunction(src, 'buildNetcusSendText') + ')');
const buildNetcusHoursText = eval('(' + extractFunction(src, 'buildNetcusHoursText') + ')');
const buildNetcusPlanText = eval('(' + extractFunction(src, 'buildNetcusPlanText') + ')');

const CATS = [{ id: 'c1', name: '보고서 작성' }, { id: 'c2', name: '시스템 점검' }];
const day = (date, content, ok = true) => ({ date, content, ok });

// ── 머리표 변형 관대 매칭 ────────────────────────────────────────────────
test('parseNetcusWeek: [과제] 머리표 모든 변형이 같은 과제로 병합', () => {
  const cats = [{ id: 'c1', name: '과제' }];
  const days = [
    day('2026-07-06', '[과제] : 3\n작업 A'),
    day('2026-07-07', '[과제]:2\n작업 B'),
    day('2026-07-08', '[과제]4\n작업 C'),
    day('2026-07-09', '[과제]:  1\n작업 D'),
    day('2026-07-10', '[과제]\n작업 E'),
    day('2026-07-11', '[과제] : 4시간\n작업 F'),
  ];
  const p = parseNetcusWeek(days, cats, {});
  assert.strictEqual(p.tasks.length, 1, '변형 모두 한 과제');
  assert.strictEqual(p.tasks[0].matched, true);
  assert.strictEqual(p.tasks[0].catId, 'c1');
  assert.deepStrictEqual(p.tasks[0].lines.map(l => l.text), ['작업 A','작업 B','작업 C','작업 D','작업 E','작업 F']);
  assert.strictEqual(p.unclassified.length, 0);
});

// ── 대괄호 없는 머리표 후보 ──────────────────────────────────────────────
test('parseNetcusWeek: 대괄호 없는 알려진 과제명 "이름 : n" → 머리표로 인정', () => {
  const p = parseNetcusWeek([day('2026-07-06', '보고서 작성 : 3\n주간보고 정리')], CATS, {});
  assert.strictEqual(p.tasks.length, 1);
  assert.strictEqual(p.tasks[0].matched, true);
  assert.strictEqual(p.tasks[0].catId, 'c1');
  assert.deepStrictEqual(p.tasks[0].lines.map(l => l.text), ['주간보고 정리']);
  assert.strictEqual(p.unclassified.length, 0);
});

test('parseNetcusWeek: 대괄호 없는 미상 "회의 : 2"(소유 과제 없음) → ambiguous 미분류', () => {
  const p = parseNetcusWeek([day('2026-07-06', '회의 : 2')], CATS, {});
  assert.strictEqual(p.tasks.length, 0);
  assert.strictEqual(p.unclassified.length, 1);
  assert.strictEqual(p.unclassified[0].reason, 'ambiguous');
  assert.strictEqual(p.unclassified[0].text, '회의 : 2');
  assert.strictEqual(p.stats.reasons['ambiguous'], 1);
  assert.strictEqual(p.stats.reasons['no-header'], 0);
});

// ── 머리표 이전 내용 → no-header ─────────────────────────────────────────
test('parseNetcusWeek: 머리표 이전 내용 라인 → no-header 미분류', () => {
  const p = parseNetcusWeek([day('2026-07-06', '그냥 메모\n[보고서 작성]\n초안 작성')], CATS, {});
  assert.strictEqual(p.tasks.length, 1);
  assert.deepStrictEqual(p.tasks[0].lines.map(l => l.text), ['초안 작성']);
  assert.strictEqual(p.unclassified.length, 1);
  assert.strictEqual(p.unclassified[0].reason, 'no-header');
  assert.strictEqual(p.unclassified[0].text, '그냥 메모');
  assert.strictEqual(p.stats.reasons['no-header'], 1);
});

// ── 미등록 과제(대괄호 매칭 but 카테고리 없음) → matched:false, 미분류 아님 ─
test('parseNetcusWeek: 미등록 [과제] → 자기 블록(matched:false), unclassified 아님', () => {
  const p = parseNetcusWeek([day('2026-07-06', '[신규 과제] : 5\n탐색 작업')], CATS, {});
  assert.strictEqual(p.tasks.length, 1);
  assert.strictEqual(p.tasks[0].matched, false);
  assert.strictEqual(p.tasks[0].catId, null);
  assert.deepStrictEqual(p.tasks[0].lines.map(l => l.text), ['탐색 작업']);
  assert.strictEqual(p.unclassified.length, 0);
  assert.strictEqual(p.stats.unregistered, 1);
});

// ── 빈 날 → emptyDays ────────────────────────────────────────────────────
test('parseNetcusWeek: 빈 content 날 → stats.emptyDays 기록(미분류 아님)', () => {
  const days = [ day('2026-07-06', '[보고서 작성]\n초안'), day('2026-07-07', '   '), day('2026-07-08', '', true) ];
  const p = parseNetcusWeek(days, CATS, {});
  assert.deepStrictEqual(p.stats.emptyDays, ['2026-07-07', '2026-07-08']);
  assert.strictEqual(p.unclassified.length, 0);
  assert.strictEqual(p.stats.daysTotal, 3);
  assert.strictEqual(p.stats.daysRead, 3);   // ok:true 모두 읽음(빈 날 포함)
});

// ── 다중일 병합 + 정규화(공백 차이) ──────────────────────────────────────
test('parseNetcusWeek: 여러 날 동일 과제(정규화 공백 무시)로 병합, lines 누적', () => {
  const days = [
    day('2026-07-06', '[보고서 작성]\n월요일 작업'),
    day('2026-07-07', '[보고서  작성]\n화요일 작업'),   // 내부 공백 2칸 → 정규화 동일
    day('2026-07-08', '[시스템 점검]\n점검 A'),
  ];
  const p = parseNetcusWeek(days, CATS, {});
  assert.strictEqual(p.tasks.length, 2, '보고서 작성 1 + 시스템 점검 1');
  assert.strictEqual(p.tasks[0].catId, 'c1');
  assert.deepStrictEqual(p.tasks[0].lines.map(l => l.text), ['월요일 작업', '화요일 작업']);
  assert.deepStrictEqual(p.tasks[0].lines.map(l => l.date), ['2026-07-06', '2026-07-07']);
  assert.strictEqual(p.tasks[1].catId, 'c2');
  // 순서 = first-seen 보존
  assert.deepStrictEqual(p.tasks.map(t => t.name), ['보고서 작성', '시스템 점검']);
});

// ── 공백 없는 표기 병합(정규화 = 공백 전부 제거) ─────────────────────────
test('parseNetcusWeek: "[시스템점검]" ↔ "[시스템 점검]" 공백 유무 무관 병합', () => {
  const days = [
    day('2026-07-06', '[시스템 점검]\n점검 A'),
    day('2026-07-07', '[시스템점검]\n점검 B'),   // 공백 제거 표기 → 같은 과제로 병합(약속 동작)
  ];
  const p = parseNetcusWeek(days, CATS, {});
  assert.strictEqual(p.tasks.length, 1, '공백 유무 무관 한 과제');
  assert.strictEqual(p.tasks[0].matched, true);
  assert.strictEqual(p.tasks[0].catId, 'c2');
  assert.deepStrictEqual(p.tasks[0].lines.map(l => l.text), ['점검 A', '점검 B']);
  assert.strictEqual(p.stats.unregistered, 0, '미등록 아님');
});

// ── 빈 이름 대괄호 방어(팬텀 과제 금지) ───────────────────────────────────
test('parseNetcusWeek: "[ ]" 빈 이름은 머리표 아님 → 팬텀 과제·미등록 없음', () => {
  const p = parseNetcusWeek([day('2026-07-06', '[ ]\n실제작업')], CATS, {});
  assert.strictEqual(p.tasks.length, 0, '이름 없는 팬텀 과제 생성 안 됨');
  assert.strictEqual(p.stats.unregistered, 0);
  assert.ok(p.unclassified.some(u => u.text === '실제작업' && u.reason === 'no-header'), '내용은 no-header 미분류로');
});

// ── sumTime 기본 off → hoursSum null ─────────────────────────────────────
test('parseNetcusWeek: sumTime 기본 off → hoursSum null (hoursByDate는 채움)', () => {
  const p = parseNetcusWeek([ day('2026-07-06', '[보고서 작성] : 3\n작업'), day('2026-07-07', '[보고서 작성] : 2\n작업2') ], CATS, {});
  assert.strictEqual(p.tasks[0].hoursSum, null);
  assert.deepStrictEqual(p.tasks[0].hoursByDate, { '2026-07-06': 3, '2026-07-07': 2 });
});

test('parseNetcusWeek: sumTime on → hoursSum = 날짜별 합', () => {
  const p = parseNetcusWeek([ day('2026-07-06', '[보고서 작성] : 3\n작업'), day('2026-07-07', '[보고서 작성] : 2.5\n작업2') ], CATS, { sumTime: true });
  assert.strictEqual(p.tasks[0].hoursSum, 5.5);
});

// ── 통계 종합 ────────────────────────────────────────────────────────────
test('parseNetcusWeek: stats 종합(과제/미분류/미등록/빈날 카운트)', () => {
  const days = [
    day('2026-07-06', '선행 메모\n[보고서 작성]\n작업1'),   // no-header 1 + task
    day('2026-07-07', '회의 : 2'),                          // ambiguous 1
    day('2026-07-08', '[신규] : 1\n탐색'),                  // 미등록 1
    day('2026-07-09', '   '),                               // 빈 날
  ];
  const p = parseNetcusWeek(days, CATS, {});
  assert.strictEqual(p.tasks.length, 2, '보고서 작성 + 신규(미등록)');
  assert.strictEqual(p.stats.unregistered, 1);
  assert.strictEqual(p.unclassified.length, 2);
  assert.strictEqual(p.stats.reasons['no-header'], 1);
  assert.strictEqual(p.stats.reasons['ambiguous'], 1);
  assert.deepStrictEqual(p.stats.emptyDays, ['2026-07-09']);
});

// ── 방어: 잘못된 입력 ────────────────────────────────────────────────────
test('parseNetcusWeek: 비배열/누락 입력 방어 → 빈 결과', () => {
  const p = parseNetcusWeek(null, null, null);
  assert.strictEqual(p.tasks.length, 0);
  assert.strictEqual(p.unclassified.length, 0);
  assert.strictEqual(p.stats.daysTotal, 0);
  assert.deepStrictEqual(p.stats.emptyDays, []);
});

// ── buildNetcusSendText ──────────────────────────────────────────────────
test('buildNetcusSendText: [과제명] 블록 + 날짜 프리픽스 없음 + 동일 라인 중복 제거, 미분류 verbatim', () => {
  const parsed = parseNetcusWeek([
    day('2026-07-06', '[보고서 작성]\n초안 작성\n초안 작성'),   // 같은 날 중복
    day('2026-07-07', '[보고서 작성]\n초안 작성\n검토'),         // 다른 날 동일 라인 → 접힘
    day('2026-07-08', '회의 : 2'),
  ], CATS, {});
  const out = buildNetcusSendText(parsed);
  assert.ok(out.includes('[보고서 작성]'), '과제 머리 포함');
  assert.ok(!/\(\d+\/\d+\)/.test(out), '날짜 프리픽스 (M/D) 없어야 함');
  assert.strictEqual((out.match(/초안 작성/g) || []).length, 1, '동일 라인 1회로 접힘');
  assert.ok(out.includes('검토'), '고유 라인 유지');
  assert.ok(out.includes('[미분류]'), '미분류 블록 포함');
  assert.ok(out.includes('회의 : 2'), '미분류 원문(verbatim) 포함');
});

test('buildNetcusSendText: // 사유 주석·통계 라인 절대 없음(전송 텍스트 순수)', () => {
  const parsed = parseNetcusWeek([
    day('2026-07-06', '선행 메모\n[보고서 작성]\n초안'),
    day('2026-07-07', '회의 : 2'),
    day('2026-07-08', '[신규] : 1\n탐색'),
  ], CATS, {});
  const out = buildNetcusSendText(parsed);
  assert.ok(!out.includes('//'), '// 주석 없어야 함');
  assert.ok(!out.includes('머리표 없음'), '사유(머리표 없음) 없어야 함');
  assert.ok(!out.includes('형식 모호'), '사유(형식 모호) 없어야 함');
  assert.ok(!out.includes('일 읽음'), '통계 라인 없어야 함');
  assert.ok(!out.includes('미등록'), '미등록 뱃지 텍스트 없어야 함');
});

// Item3 — 진행사항(endwork) 헤더엔 시간 안 붙음(과제명만) / 시간은 과제투입시간(content)으로만 감(위치만 이동, 사라지지 않음).
test('Item3: 진행사항 헤더=과제명만(: n 없음) · 과제투입시간엔 주간 합계 유지', () => {
  const parsed = parseNetcusWeek([
    day('2026-07-06', '[보고서 작성] : 6.5\n초안'),
    day('2026-07-07', '[보고서 작성] : 1.5\n검토'),   // 합계 8
    day('2026-07-08', '[시스템 점검] : 0'),           // 0 명시(시간 기록 있음)
  ], CATS, { sumTime: true });
  const send = buildNetcusSendText(parsed);
  assert.ok(send.includes('[보고서 작성]'), '진행사항 헤더에 과제명');
  assert.ok(!send.includes('[보고서 작성] : 8'), '진행사항 헤더에 시간(: 8) 안 붙음(Item3)');
  assert.ok(!/\]\s*:\s*\d/.test(send), '어떤 과제 헤더에도 "] : 숫자" 없음');
  assert.ok(send.includes('초안') && send.includes('검토'), '설명(본문) 라인은 유지');
  // 시간은 사라지지 않고 위치만 content(과제투입시간)로 이동
  assert.strictEqual(buildNetcusHoursText(parsed), '[보고서 작성] : 8\n[시스템 점검] : 0\n-----\n합계 : 8', '과제투입시간(content) = 과제별 합계 + 전체 합계');
});
test('buildNetcusHoursText: 시간 기록 없는 과제는 제외', () => {
  const parsed = parseNetcusWeek([day('2026-07-06', '[보고서 작성]\n작업')], CATS, { sumTime: true });   // 시간 없음
  assert.strictEqual(buildNetcusHoursText(parsed), '', '시간 없으면 빈 문자열');
  assert.ok(!/:/.test(buildNetcusSendText(parsed)), '헤더에 : n 없음');
});

test('buildNetcusSendText: 결정론(같은 입력 → 같은 출력) + 빈 parsed 방어', () => {
  const parsed = parseNetcusWeek([day('2026-07-06', '[보고서 작성]\n작업')], CATS, {});
  assert.strictEqual(buildNetcusSendText(parsed), buildNetcusSendText(parsed));
  assert.strictEqual(buildNetcusSendText(null), '');
  assert.strictEqual(buildNetcusSendText({}), '');
});

test('주간 병합: 기타 과제는 최초 등장 순서와 무관하게 항상 마지막', () => {
  const cats = [{ id: 'etc', name: '기타' }, { id: 'main', name: '주요 과제' }];
  const parsed = parseNetcusWeek([
    day('2026-07-06', '[기타] : 1\n기타 작업\n[주요 과제] : 2\n핵심 작업'),
  ], cats, { sumTime: true });
  assert.deepStrictEqual(parsed.tasks.map(t => t.name), ['주요 과제', '기타']);
  assert.ok(buildNetcusSendText(parsed).indexOf('[주요 과제]') < buildNetcusSendText(parsed).indexOf('[기타]'));
  // PR#3(전체 합계)과 PR#4(기타 마지막) 결합 기대값 — 합계줄 포함
  assert.strictEqual(buildNetcusHoursText(parsed), '[주요 과제] : 2\n[기타] : 1\n-----\n합계 : 3');
});

test('buildNetcusPlanText: 차주계획은 과제 머리표만 자동 생성하고 미분류는 제외', () => {
  const parsed = parseNetcusWeek([
    day('2026-07-06', '머리표 없는 내용\n[보고서 작성]\n진행 내용\n[시스템 점검]\n점검 내용'),
  ], CATS, {});
  assert.strictEqual(buildNetcusPlanText(parsed), '[보고서 작성]\n[시스템 점검]');
  assert.ok(!buildNetcusPlanText(parsed).includes('미분류'));
  assert.strictEqual(buildNetcusPlanText(null), '');
});
