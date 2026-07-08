// mergeCommitsPreserveEdits 단위테스트 — 재-불러오기 시 사용자 편집(subject) 보존 규칙 검증.
// 앱 소스에서 순수 함수만 추출·eval해 앱 전역 없이 단독 실행한다(하네스 패턴: harness-selftest 참고).
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';

const src = loadAppSource();
const code = extractFunction(src, 'mergeCommitsPreserveEdits');
const mergeCommitsPreserveEdits = eval('(' + code + ')');

// 헬퍼: 커밋 생성
const C = (hash, subject, extra) => ({ hash, short: hash ? hash.slice(0, 7) : '', time: '09:00', subject, ...(extra || {}) });

// 추출 자체 sanity — 선언 형태 확인
test('mergeCommitsPreserveEdits: 함수로 추출·eval 됨', () => {
  assert.match(code, /^function\s+mergeCommitsPreserveEdits\s*\(/);
  assert.strictEqual(typeof mergeCommitsPreserveEdits, 'function');
});

// (a) hash 일치 시 prev(사용자 편집) subject가 fetched를 이김
test('(a) hash 일치 → prev의 편집된 subject가 우선', () => {
  const prev = [C('aaa111', '내가 고친 메시지')];
  const fetched = [C('aaa111', 'git 원본 메시지')];
  const out = mergeCommitsPreserveEdits(prev, fetched);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].hash, 'aaa111');
  assert.strictEqual(out[0].subject, '내가 고친 메시지');   // prev 우선
  // 다른 필드는 fetched 것 유지(스프레드 기반)
  assert.strictEqual(out[0].short, fetched[0].short);
});

// (b) prev에 없는 새 fetched 커밋은 자기 subject 그대로 추가
test('(b) prev에 없는 새 커밋 → fetched subject 그대로', () => {
  const prev = [C('aaa111', '고친 것')];
  const fetched = [C('aaa111', '원본'), C('bbb222', '새 커밋')];
  const out = mergeCommitsPreserveEdits(prev, fetched);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].subject, '고친 것');    // (a) 규칙
  assert.strictEqual(out[1].hash, 'bbb222');
  assert.strictEqual(out[1].subject, '새 커밋');     // 그대로
});

// (c) prev엔 있으나 fetched엔 없는 커밋은 결과에서 빠짐(fetched 집합이 진실)
test('(c) prev에만 있고 fetched엔 없는 커밋 → 결과에서 드롭', () => {
  const prev = [C('aaa111', '고친 것'), C('ccc333', 'prev에만 있음')];
  const fetched = [C('aaa111', '원본')];
  const out = mergeCommitsPreserveEdits(prev, fetched);
  assert.strictEqual(out.length, 1);                 // fetched 크기와 동일
  assert.ok(!out.some(c => c.hash === 'ccc333'), 'ccc333은 빠져야 함');
});

// (d) 사용자가 "삭제"(prev에서 제거)했지만 git엔 여전히 있는 커밋 → git subject로 재등장
test('(d) 사용자가 삭제한(=prev 부재) 커밋이 git엔 있음 → git subject로 재추가', () => {
  const prev = [];                                   // 사용자가 지워서 prev엔 없음
  const fetched = [C('ddd444', 'git의 현재 메시지')];
  const out = mergeCommitsPreserveEdits(prev, fetched);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].hash, 'ddd444');
  assert.strictEqual(out[0].subject, 'git의 현재 메시지');   // git 진실로 부활
});

// (e) hash 없는(레거시) fetched 커밋은 매칭 없이 그대로 통과
test('(e) hash 없는 fetched 커밋 → 그대로 통과(참조 동일)', () => {
  const noHash = C('', '해시 없는 커밋');
  const prev = [C('aaa111', '고친 것')];
  const fetched = [noHash];
  const out = mergeCommitsPreserveEdits(prev, fetched);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].subject, '해시 없는 커밋');
  assert.strictEqual(out[0], noHash);                // 매칭 안 되면 원본 객체 그대로 통과
});

// (f) prev가 비었거나 undefined면 fetched를 그대로 반환
test('(f) prev empty/undefined → fetched 그대로', () => {
  const fetched = [C('aaa111', 'x'), C('bbb222', 'y')];
  const out1 = mergeCommitsPreserveEdits([], fetched);
  assert.deepStrictEqual(out1.map(c => c.subject), ['x', 'y']);
  const out2 = mergeCommitsPreserveEdits(undefined, fetched);
  assert.deepStrictEqual(out2.map(c => c.subject), ['x', 'y']);
  // fetched가 비정상(undefined)이면 빈 배열
  assert.deepStrictEqual(mergeCommitsPreserveEdits(prevUndefinedGuard(), undefined), []);
});
function prevUndefinedGuard(){ return undefined; }

// 추가: prev에 hash는 있으나 subject가 빈 문자열이어도 그 값을 씀(사용자가 빈값 저장은 UI에서 막지만 순수함수는 값을 신뢰)
test('보강: prev subject가 빈 문자열이면 그 빈 문자열이 반영(맵에 존재하므로)', () => {
  const prev = [C('aaa111', '')];
  const fetched = [C('aaa111', '원본')];
  const out = mergeCommitsPreserveEdits(prev, fetched);
  assert.strictEqual(out[0].subject, '');            // pm.has(hash) true → prev값('') 사용
});
