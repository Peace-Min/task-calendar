// Layer 1 — netcus 주간 병합 파서(parseNetcusWeek) + 전송 텍스트(buildNetcusSendText) 순수 함수 단위테스트.
// 두 함수 모두 전역·DOM 무의존이라 extractFunction으로 잘라 단독 검증한다(dependency-0).
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';

const src = loadAppSource();
const parseNetcusWeek = eval('(' + extractFunction(src, 'parseNetcusWeek') + ')');
const buildNetcusSendText = eval('(' + extractFunction(src, 'buildNetcusSendText') + ')');

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
test('buildNetcusSendText: 과제 블록 [과제명]+(M/D) 라인, 미분류는 [미분류] 아래 verbatim', () => {
  const parsed = parseNetcusWeek([
    day('2026-07-06', '[보고서 작성]\n초안 작성'),
    day('2026-07-07', '회의 : 2'),
  ], CATS, {});
  const out = buildNetcusSendText(parsed);
  assert.ok(out.includes('[보고서 작성]'), '과제 머리 포함');
  assert.ok(out.includes('(7/6) 초안 작성'), 'M/D 라인 포함');
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

test('buildNetcusSendText: 결정론(같은 입력 → 같은 출력) + 빈 parsed 방어', () => {
  const parsed = parseNetcusWeek([day('2026-07-06', '[보고서 작성]\n작업')], CATS, {});
  assert.strictEqual(buildNetcusSendText(parsed), buildNetcusSendText(parsed));
  assert.strictEqual(buildNetcusSendText(null), '');
  assert.strictEqual(buildNetcusSendText({}), '');
});
