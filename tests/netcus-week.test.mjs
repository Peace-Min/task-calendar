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

// ── ok:false 빈 날 → readFailedDays(세션/접근 실패 가시화) ────────────────
test('parseNetcusWeek: ok:false 빈 날 → readFailedDays로 분리(emptyDays 아님), daysRead 미포함', () => {
  const days = [
    day('2026-07-06', '[보고서 작성]\n초안'),   // 정상(읽음)
    day('2026-07-07', '', true),                 // 진짜 빈 날(읽었으나 내용 없음)
    day('2026-07-08', '', false),                // 읽기 실패(요소 없음/세션) — 무음 손실 가시화 대상
  ];
  const p = parseNetcusWeek(days, CATS, {});
  assert.deepStrictEqual(p.stats.emptyDays, ['2026-07-07'], '읽은 빈 날만 emptyDays');
  assert.deepStrictEqual(p.stats.readFailedDays, ['2026-07-08'], '못 읽은 날은 readFailedDays');
  assert.strictEqual(p.stats.daysRead, 2, 'ok:true 2일만 읽음(실패 날 제외)');
  assert.strictEqual(p.unclassified.length, 0);
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

// ══ 변이 시험(mutation test) — 위 계약이 정말 '검사하고' 있는지 못박는다 ══
// 위 24건은 "지금 통과한다"만 말한다. 제품 코드를 실제로 망가뜨려도 초록이면
// 그건 계약이 그 동작을 안 본다는 뜻이다 — 그 구분을 여기서 낸다.
//
// 방법: 앱 소스 문자열을 한 곳만 고쳐(mutateOnce) 대상 함수를 **다시 잘라 eval** 한 뒤
//   같은 입력으로 불러 결과가 실제로 달라지는지(또는 던지는지) 단언한다. 텍스트 grep 이
//   아니라 행위 검사다 — 정규식으로 소스를 구경해선 이 판정을 낼 수 없다.
// 각 시험은 (1) 정상 소스에서 기대값이 실제로 나오는지 → (2) 변이 소스에서 그게 무너지는지
//   둘 다 본다. (1)이 없으면 변이가 무해해서 안 잡힌 건지 계약이 눈먼 건지 구분이 안 된다.
// ★ 앵커를 못 찾거나 여러 곳이면 조용히 통과하지 않고 실패한다(이 저장소 mutate() 관례).
//   앵커 소실은 '통과'가 아니라 판정 불가다.

function mutateOnce(find, replace) {
  const at = src.indexOf(find);
  assert.ok(at >= 0, '변이 앵커를 앱 소스에서 찾지 못했다(리팩터로 사라졌다면 앵커를 갱신할 것): ' + find);
  assert.strictEqual(at, src.lastIndexOf(find),
    '변이 앵커가 여러 곳에 있다 — 겨냥이 흐려진다. 앞뒤 줄을 붙여 유일하게 만들 것: ' + find);
  const out = src.slice(0, at) + replace + src.slice(at + find.length);
  assert.notStrictEqual(out, src, '변이가 원본을 바꾸지 못했다(find 와 replace 가 같다)');
  return out;
}

// 변이 소스에서 fnName 을 다시 잘라 eval — 돌려주는 건 '망가진 함수'다.
// ★ 잘라낸 코드가 원본과 같으면 변이가 그 함수 밖에 떨어진 것 → 실패시킨다(겨냥 확인).
function mutatedFn(fnName, find, replace) {
  const code = extractFunction(mutateOnce(find, replace), fnName);
  assert.notStrictEqual(code, extractFunction(src, fnName),
    '변이가 ' + fnName + ' 안에 떨어지지 않았다 — 앵커가 다른 함수를 겨냥했다: ' + find);
  return eval('(' + code + ')');
}

// ── 변이① 이름 정규화에서 공백 제거를 없앤다 → 표기 흔들림이 서로 다른 과제가 된다 ──
// (깨져야 할 계약: '"[시스템점검]" ↔ "[시스템 점검]" 공백 유무 무관 병합')
// ★ norm 선언은 parseNetcusWeekly 에도 같은 줄로 있다 — 앞 주석을 붙여 유일하게 겨냥한다.
const NORM_FIND = "(카테고리 매칭 키). '시스템점검'↔'시스템 점검' 표기 흔들림 병합.\n" +
  "  const norm = s => String(s == null ? '' : s).normalize('NFC').replace(/\\s+/g, '');";
const NORM_REPL = "(카테고리 매칭 키). '시스템점검'↔'시스템 점검' 표기 흔들림 병합.\n" +
  "  const norm = s => String(s == null ? '' : s).normalize('NFC');";
test('변이①: 이름 정규화에서 공백 제거를 빼면 "공백 유무 무관 병합" 계약이 깨진다', () => {
  const days = [ day('2026-07-06', '[시스템 점검]\n점검 A'), day('2026-07-07', '[시스템점검]\n점검 B') ];
  const okp = parseNetcusWeek(days, CATS, {});
  assert.strictEqual(okp.tasks.length, 1, '사전조건: 정상 소스는 표기 흔들림을 한 과제로 병합한다');
  assert.strictEqual(okp.stats.unregistered, 0, '사전조건: 둘 다 등록 과제로 매칭된다');

  const p = mutatedFn('parseNetcusWeek', NORM_FIND, NORM_REPL)(days, CATS, {});
  assert.strictEqual(p.tasks.length, 2, '공백 제거를 빼도 한 과제로 병합된다 — 계약이 정규화를 안 본다');
  assert.strictEqual(p.stats.unregistered, 1, '변이 뒤 "[시스템점검]" 은 카테고리 매칭도 실패한다(미등록 1)');
});

// ── 변이② reBracket 의 콜론을 필수로 → 콜론 없는 머리표가 본문/미분류로 샌다 ──
// (깨져야 할 계약: '[과제] 머리표 모든 변형이 같은 과제로 병합')
const REBRACKET_FIND = "const reBracket = /^\\s*\\[\\s*(.+?)\\s*\\]\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)?\\s*(?:시간|h|H)?\\s*$/;";
const REBRACKET_REPL = "const reBracket = /^\\s*\\[\\s*(.+?)\\s*\\]\\s*[:：]\\s*(\\d+(?:\\.\\d+)?)?\\s*(?:시간|h|H)?\\s*$/;";
test('변이②: reBracket 의 콜론을 필수로 만들면 "머리표 모든 변형 병합" 계약이 깨진다', () => {
  const cats = [{ id: 'c1', name: '과제' }];
  const days = [
    day('2026-07-06', '[과제] : 3\n작업 A'),
    day('2026-07-07', '[과제]:2\n작업 B'),
    day('2026-07-08', '[과제]4\n작업 C'),        // 콜론 없음 — 변이의 사정권
    day('2026-07-09', '[과제]:  1\n작업 D'),
    day('2026-07-10', '[과제]\n작업 E'),          // 콜론 없음 — 변이의 사정권
    day('2026-07-11', '[과제] : 4시간\n작업 F'),
  ];
  const ALL = ['작업 A','작업 B','작업 C','작업 D','작업 E','작업 F'];
  const okp = parseNetcusWeek(days, cats, {});
  assert.strictEqual(okp.tasks.length, 1, '사전조건: 정상 소스는 6가지 변형을 한 과제로 병합한다');
  assert.deepStrictEqual(okp.tasks[0].lines.map(l => l.text), ALL, '사전조건: 6일치 본문이 모두 모인다');
  assert.strictEqual(okp.unclassified.length, 0, '사전조건: 미분류가 없다');

  const p = mutatedFn('parseNetcusWeek', REBRACKET_FIND, REBRACKET_REPL)(days, cats, {});
  assert.notDeepStrictEqual(p.tasks.length ? p.tasks[0].lines.map(l => l.text) : null, ALL,
    '콜론을 필수로 해도 6일치가 다 모인다 — 계약이 머리표 관대 매칭을 안 본다');
  assert.deepStrictEqual(p.unclassified.map(u => u.text), ['[과제]4','작업 C','[과제]','작업 E'],
    '콜론 없는 머리표와 그 본문이 통째로 미분류로 새야 한다');
});

// ── 변이③ 빈 이름 가드 제거 → '[ ]' 가 이름 없는 팬텀 과제를 만든다 ──
// (깨져야 할 계약: '"[ ]" 빈 이름은 머리표 아님 → 팬텀 과제·미등록 없음')
test('변이③: 빈 이름 가드(mBnm)를 빼면 "[ ] 팬텀 과제 금지" 계약이 깨진다', () => {
  const days = [day('2026-07-06', '[ ]\n실제작업')];
  const okp = parseNetcusWeek(days, CATS, {});
  assert.strictEqual(okp.tasks.length, 0, '사전조건: 정상 소스는 이름 없는 팬텀 과제를 만들지 않는다');
  assert.strictEqual(okp.stats.unregistered, 0, '사전조건: 미등록 카운트도 0');

  const p = mutatedFn('parseNetcusWeek', 'if(mB && mBnm){', 'if(mB){')(days, CATS, {});
  assert.strictEqual(p.tasks.length, 1, '가드를 빼도 팬텀 과제가 안 생긴다 — 계약이 빈 이름 방어를 안 본다');
  assert.strictEqual(p.tasks[0].name, '', '팬텀 과제의 이름은 빈 문자열이다');
  assert.strictEqual(p.stats.unregistered, 1, '팬텀 과제가 미등록으로도 세어진다');
  assert.strictEqual(buildNetcusSendText(p).split('\n')[0], '[]', '전송본 머리에 "[]" 가 실린다(회사 폼 오염)');
});

// ── 변이④ 읽기실패/빈날 분기 붕괴 → 못 읽은 날이 '빈 날'로 둔갑(무음 손실) ──
// (깨져야 할 계약: 'ok:false 빈 날 → readFailedDays로 분리(emptyDays 아님)')
test('변이④: 읽기실패/빈날 분기를 붕괴시키면 "ok:false → readFailedDays" 계약이 깨진다', () => {
  const days = [ day('2026-07-06', '[보고서 작성]\n초안'), day('2026-07-07', '', true), day('2026-07-08', '', false) ];
  const okp = parseNetcusWeek(days, CATS, {});
  assert.deepStrictEqual(okp.stats.readFailedDays, ['2026-07-08'], '사전조건: 정상 소스는 못 읽은 날을 분리한다');
  assert.deepStrictEqual(okp.stats.emptyDays, ['2026-07-07'], '사전조건: 읽은 빈 날만 emptyDays');

  const p = mutatedFn('parseNetcusWeek',
    'if(row.ok === false) readFailedDays.push(date); else emptyDays.push(date);',
    'emptyDays.push(date);')(days, CATS, {});
  assert.deepStrictEqual(p.stats.readFailedDays, [], '분기를 없애도 readFailedDays 가 채워진다 — 앵커가 안 닿았다');
  assert.deepStrictEqual(p.stats.emptyDays, ['2026-07-07', '2026-07-08'],
    '못 읽은 날이 "빈 날"로 둔갑한다 — 계약이 이 무음 손실을 안 본다');
});

// ── 변이⑤ daysRead 를 ok 무관하게 센다 → 못 읽은 날까지 '읽음'으로 보고 ──
// (깨져야 할 계약: 'ok:false … daysRead 미포함')
test('변이⑤: daysRead 를 ok 무관하게 세면 읽음 집계 계약이 깨진다', () => {
  const days = [ day('2026-07-06', '[보고서 작성]\n초안'), day('2026-07-07', '', true), day('2026-07-08', '', false) ];
  assert.strictEqual(parseNetcusWeek(days, CATS, {}).stats.daysRead, 2, '사전조건: 정상 소스는 ok:true 2일만 읽음으로 센다');

  const p = mutatedFn('parseNetcusWeek', 'if(row.ok) daysRead++;', 'daysRead++;')(days, CATS, {});
  assert.strictEqual(p.stats.daysRead, 3, 'ok 검사를 빼도 2가 나온다 — 계약이 daysRead 계산을 안 본다');
});

// ── 변이⑥ '기타 마지막' 정렬을 no-op 으로 → 기타가 first-seen 자리에 그대로 남는다 ──
// (깨져야 할 계약: '주간 병합: 기타 과제는 최초 등장 순서와 무관하게 항상 마지막')
const SORT_FIND = "tasks.sort((a, b) => (norm(a && a.name) === '기타' ? 1 : 0) - (norm(b && b.name) === '기타' ? 1 : 0));";
test('변이⑥: "기타 마지막" 정렬을 no-op 으로 만들면 정렬 계약이 깨진다', () => {
  const cats = [{ id: 'etc', name: '기타' }, { id: 'main', name: '주요 과제' }];
  const days = [day('2026-07-06', '[기타] : 1\n기타 작업\n[주요 과제] : 2\n핵심 작업')];
  const okp = parseNetcusWeek(days, cats, { sumTime: true });
  assert.deepStrictEqual(okp.tasks.map(t => t.name), ['주요 과제', '기타'], '사전조건: 정상 소스는 기타를 뒤로 보낸다');

  const p = mutatedFn('parseNetcusWeek', SORT_FIND, 'void tasks;')(days, cats, { sumTime: true });
  assert.deepStrictEqual(p.tasks.map(t => t.name), ['기타', '주요 과제'],
    '정렬을 꺼도 순서가 같다 — 계약이 재정렬을 안 본다(first-seen 이 우연히 같았을 뿐인지 확인)');
  assert.ok(buildNetcusSendText(p).indexOf('[기타]') < buildNetcusSendText(p).indexOf('[주요 과제]'),
    '전송본 순서도 함께 뒤집힌다');
  assert.strictEqual(buildNetcusHoursText(p), '[기타] : 1\n[주요 과제] : 2\n-----\n합계 : 3',
    '과제투입시간 순서도 함께 뒤집힌다');
});

// ── 변이⑦ 미등록 카운트 반전 → 등록/미등록이 서로 뒤바뀐다 ──
// (깨져야 할 계약: '미등록 [과제] → … stats.unregistered 1' · '공백 유무 무관 병합 … unregistered 0')
test('변이⑦: 미등록 카운트를 반전시키면 unregistered 계약이 양방향으로 깨진다', () => {
  const unregDays = [day('2026-07-06', '[신규 과제] : 5\n탐색 작업')];
  const regDays = [day('2026-07-06', '[보고서 작성]\n초안')];
  assert.strictEqual(parseNetcusWeek(unregDays, CATS, {}).stats.unregistered, 1, '사전조건: 미등록 과제는 1');
  assert.strictEqual(parseNetcusWeek(regDays, CATS, {}).stats.unregistered, 0, '사전조건: 등록 과제는 0');

  const f = mutatedFn('parseNetcusWeek',
    'for(const t of tasks){ if(!t.matched) unregistered++; }',
    'for(const t of tasks){ if(t.matched) unregistered++; }');
  assert.strictEqual(f(unregDays, CATS, {}).stats.unregistered, 0, '반전시켜도 1 이 나온다 — 계약이 미등록 판정을 안 본다');
  assert.strictEqual(f(regDays, CATS, {}).stats.unregistered, 1, '반전시켜도 0 이 나온다 — 등록 과제 쪽도 안 본다');
});

// ── 변이⑧ ambiguous 사유를 no-header 로 뒤바꾼다 → 미분류 사유가 거짓말을 한다 ──
// (깨져야 할 계약: '대괄호 없는 미상 "회의 : 2"(소유 과제 없음) → ambiguous 미분류')
test('변이⑧: ambiguous 사유를 no-header 로 뒤바꾸면 미분류 사유 계약이 깨진다', () => {
  const days = [day('2026-07-06', '회의 : 2')];
  const okp = parseNetcusWeek(days, CATS, {});
  assert.strictEqual(okp.unclassified[0].reason, 'ambiguous', '사전조건: 정상 소스는 형식 모호로 분류한다');
  assert.strictEqual(okp.stats.reasons['ambiguous'], 1, '사전조건: ambiguous 집계 1');
  assert.strictEqual(okp.stats.reasons['no-header'], 0, '사전조건: no-header 집계 0');

  const p = mutatedFn('parseNetcusWeek',
    "unclassified.push({ date, text, reason: 'ambiguous' }); reasons['ambiguous']++; continue;",
    "unclassified.push({ date, text, reason: 'no-header' }); reasons['no-header']++; continue;")(days, CATS, {});
  assert.strictEqual(p.unclassified[0].reason, 'no-header', '사유를 뒤바꿔도 ambiguous 가 나온다 — 계약이 사유를 안 본다');
  assert.strictEqual(p.stats.reasons['ambiguous'], 0, 'ambiguous 집계가 0 으로 비어야 한다');
  assert.strictEqual(p.stats.reasons['no-header'], 1, '집계가 no-header 로 옮겨가야 한다');
});

// ── 변이⑨ buildNetcusSendText 의 중복 제거(seen) 무력화 → 같은 줄이 날 수만큼 실린다 ──
// (깨져야 할 계약: 'buildNetcusSendText: … 동일 라인 중복 제거')
const SEEN_FIND = "for(const ln of lines){ const tx = String(ln && ln.text != null ? ln.text : ''); if(tx && !Object.prototype.hasOwnProperty.call(seen, tx)){ seen[tx] = 1; body.push(tx); } }";
const SEEN_REPL = "for(const ln of lines){ const tx = String(ln && ln.text != null ? ln.text : ''); if(tx){ seen[tx] = 1; body.push(tx); } }";
test('변이⑨: 전송 텍스트의 중복 제거(seen)를 무력화하면 "동일 라인 1회로 접힘" 계약이 깨진다', () => {
  const parsed = parseNetcusWeek([
    day('2026-07-06', '[보고서 작성]\n초안 작성\n초안 작성'),
    day('2026-07-07', '[보고서 작성]\n초안 작성\n검토'),
  ], CATS, {});
  assert.strictEqual((buildNetcusSendText(parsed).match(/초안 작성/g) || []).length, 1,
    '사전조건: 정상 소스는 동일 라인을 1회로 접는다');

  const out = mutatedFn('buildNetcusSendText', SEEN_FIND, SEEN_REPL)(parsed);
  assert.strictEqual((out.match(/초안 작성/g) || []).length, 3,
    '중복 제거를 꺼도 1회로 접힌다 — 계약이 seen 을 안 본다');
  assert.ok(out.includes('검토'), '고유 라인은 그대로 남아야 한다(변이가 본문 자체를 죽인 게 아님)');
});

// ── 변이⑩ Item3 회귀 — 진행사항 헤더에 시간을 되붙인다(과거에 실제로 있던 동작) ──
// (깨져야 할 계약: 'Item3: 진행사항 헤더=과제명만(: n 없음)')
const HEAD_FIND = "const head = '[' + String(t && t.name != null ? t.name : '') + ']';";
const HEAD_REPL = "const head = '[' + String(t && t.name != null ? t.name : '') + ']' + (t && t.hoursSum != null ? ' : ' + t.hoursSum : '');";
test('변이⑩(Item3 회귀): 진행사항 헤더에 시간을 되붙이면 "헤더=과제명만" 계약이 깨진다', () => {
  const parsed = parseNetcusWeek([
    day('2026-07-06', '[보고서 작성] : 6.5\n초안'),
    day('2026-07-07', '[보고서 작성] : 1.5\n검토'),
  ], CATS, { sumTime: true });
  const okOut = buildNetcusSendText(parsed);
  assert.ok(okOut.includes('[보고서 작성]'), '사전조건: 헤더에 과제명이 있다');
  assert.ok(!/\]\s*:\s*\d/.test(okOut), '사전조건: 정상 소스의 진행사항엔 "] : 숫자" 가 없다');

  const out = mutatedFn('buildNetcusSendText', HEAD_FIND, HEAD_REPL)(parsed);
  assert.ok(out.includes('[보고서 작성] : 8'), '시간을 되붙였는데도 헤더가 그대로다 — 앵커가 안 닿았다');
  assert.ok(/\]\s*:\s*\d/.test(out), 'Item3 이전 동작(진행사항에 시간 혼입)이 되살아나도 계약이 안 운다');
});

// ── 변이⑪ buildNetcusHoursText 의 '시간 없는 과제 제외' 가드 제거 → 0시간 줄이 실린다 ──
// (깨져야 할 계약: 'buildNetcusHoursText: 시간 기록 없는 과제는 제외')
test('변이⑪: "시간 기록 없는 과제 제외" 가드를 빼면 과제투입시간 계약이 깨진다', () => {
  const parsed = parseNetcusWeek([day('2026-07-06', '[보고서 작성]\n작업')], CATS, { sumTime: true });
  assert.strictEqual(buildNetcusHoursText(parsed), '', '사전조건: 시간 기록이 없으면 빈 문자열');

  const out = mutatedFn('buildNetcusHoursText', 'if(!hk.length) continue;', 'if(false) continue;')(parsed);
  assert.strictEqual(out, '[보고서 작성] : 0\n-----\n합계 : 0',
    '가드를 꺼도 빈 문자열이 나온다 — 계약이 그 제외 규칙을 안 본다');
});

// ── 변이⑫ 합계줄(-----/합계) 제거 → 전체 합계가 사라진다 ──
// (깨져야 할 계약: 'Item3: … 과제투입시간(content) = 과제별 합계 + 전체 합계' · '기타 마지막'의 합계 기대값)
const SUM_FIND = "return lines.concat(['-----', '합계 : ' + grand]).join('\\n');";
const SUM_REPL = "return lines.join('\\n');";
test('변이⑫: 과제투입시간의 합계줄(-----/합계)을 없애면 합계 기대값 계약이 깨진다', () => {
  const parsed = parseNetcusWeek([
    day('2026-07-06', '[보고서 작성] : 6.5\n초안'),
    day('2026-07-07', '[보고서 작성] : 1.5\n검토'),
    day('2026-07-08', '[시스템 점검] : 0'),
  ], CATS, { sumTime: true });
  assert.strictEqual(buildNetcusHoursText(parsed), '[보고서 작성] : 8\n[시스템 점검] : 0\n-----\n합계 : 8',
    '사전조건: 정상 소스는 구분선과 전체 합계를 붙인다');

  const out = mutatedFn('buildNetcusHoursText', SUM_FIND, SUM_REPL)(parsed);
  assert.strictEqual(out, '[보고서 작성] : 8\n[시스템 점검] : 0',
    '합계줄을 없애도 결과가 같다 — 계약이 합계줄을 안 본다');
});

// ── 변이⑬ buildNetcusPlanText 가 미분류까지 싣는다 → 차주계획에 남의 메모가 섞인다 ──
// (깨져야 할 계약: 'buildNetcusPlanText: 차주계획은 과제 머리표만 자동 생성하고 미분류는 제외')
const PLAN_FIND = "return tasks.map(t => '[' + String(t && t.name != null ? t.name : '') + ']').join('\\n');";
const PLAN_REPL = "return tasks.map(t => '[' + String(t && t.name != null ? t.name : '') + ']')" +
  ".concat((Array.isArray(parsed.unclassified) ? parsed.unclassified : []).map(u => String(u && u.text != null ? u.text : '')))" +
  ".join('\\n');";
test('변이⑬: buildNetcusPlanText 가 미분류까지 실으면 "차주계획=과제 머리표만" 계약이 깨진다', () => {
  const parsed = parseNetcusWeek([
    day('2026-07-06', '머리표 없는 내용\n[보고서 작성]\n진행 내용\n[시스템 점검]\n점검 내용'),
  ], CATS, {});
  assert.strictEqual(buildNetcusPlanText(parsed), '[보고서 작성]\n[시스템 점검]',
    '사전조건: 정상 소스는 과제 머리표만 만든다');

  const out = mutatedFn('buildNetcusPlanText', PLAN_FIND, PLAN_REPL)(parsed);
  assert.ok(out.includes('머리표 없는 내용'), '미분류를 실어도 결과가 같다 — 계약이 차주계획 내용을 안 본다');
  assert.notStrictEqual(out, '[보고서 작성]\n[시스템 점검]', '차주계획 기대값이 무너져야 한다');
});
