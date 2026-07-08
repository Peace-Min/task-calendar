// Layer 1 — 보고서 머리기호(index marker) 순수 헬퍼 단위테스트.
// reportMarkerAt(spec, i)는 전역 무의존(spec+i만) → extractFunction으로 잘라 단독 검증한다.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';

const src = loadAppSource();
const reportMarkerAt = eval('(' + extractFunction(src, 'reportMarkerAt') + ')');

const KO_GA = '가나다라마바사아자차카타파하';
const KO_JA = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ';
const CIRCLE = '①②③④⑤⑥⑦⑧⑨⑩';

test('reportMarkerAt: 불릿 상수 — i와 무관하게 그 문자 그대로', () => {
  for(const ch of ['-','•','·','*','▪','◦','–']){
    assert.strictEqual(reportMarkerAt({kind:'const',ch}, 0), ch);
    assert.strictEqual(reportMarkerAt({kind:'const',ch}, 5), ch);   // 리셋 무관
  }
});

test('reportMarkerAt: 숫자 — dot/paren/both, i는 0-base → i+1', () => {
  assert.strictEqual(reportMarkerAt({kind:'num',style:'dot'}, 0), '1.');
  assert.strictEqual(reportMarkerAt({kind:'num',style:'dot'}, 2), '3.');
  assert.strictEqual(reportMarkerAt({kind:'num',style:'paren'}, 0), '1)');
  assert.strictEqual(reportMarkerAt({kind:'num',style:'paren'}, 9), '10)');
  assert.strictEqual(reportMarkerAt({kind:'num',style:'both'}, 0), '(1)');
  assert.strictEqual(reportMarkerAt({kind:'num',style:'both'}, 4), '(5)');
});

test('reportMarkerAt: 가나다 — seq[i] + 접미', () => {
  const s = {kind:'seq',seq:KO_GA};
  assert.strictEqual(reportMarkerAt({...s,style:'dot'}, 0), '가.');
  assert.strictEqual(reportMarkerAt({...s,style:'dot'}, 2), '다.');
  assert.strictEqual(reportMarkerAt({...s,style:'paren'}, 1), '나)');
  assert.strictEqual(reportMarkerAt({...s,style:'both'}, 0), '(가)');
  assert.strictEqual(reportMarkerAt({...s,style:'both'}, 3), '(라)');
});

test('reportMarkerAt: 자모 — seq[i] + 접미(dot/paren)', () => {
  const s = {kind:'seq',seq:KO_JA};
  assert.strictEqual(reportMarkerAt({...s,style:'dot'}, 0), 'ㄱ.');
  assert.strictEqual(reportMarkerAt({...s,style:'dot'}, 3), 'ㄹ.');
  assert.strictEqual(reportMarkerAt({...s,style:'paren'}, 1), 'ㄴ)');
});

test('reportMarkerAt: 영문 — A./a. 대소문자 + 범위(Z/z=25) 초과 시 "?" 폴백', () => {
  assert.strictEqual(reportMarkerAt({kind:'alpha',base:65}, 0), 'A.');
  assert.strictEqual(reportMarkerAt({kind:'alpha',base:65}, 2), 'C.');
  assert.strictEqual(reportMarkerAt({kind:'alpha',base:65}, 25), 'Z.');   // 경계
  assert.strictEqual(reportMarkerAt({kind:'alpha',base:65}, 26), '?');    // Z 초과 → '['가 아니라 '?'
  assert.strictEqual(reportMarkerAt({kind:'alpha',base:97}, 0), 'a.');
  assert.strictEqual(reportMarkerAt({kind:'alpha',base:97}, 25), 'z.');   // 경계
  assert.strictEqual(reportMarkerAt({kind:'alpha',base:97}, 26), '?');    // z 초과 → '{'가 아니라 '?'
  assert.strictEqual(reportMarkerAt({kind:'alpha',base:97}, 99), '?');
});

test('reportMarkerAt: 원문자 — 접미 없음(bare)', () => {
  const s = {kind:'seq',seq:CIRCLE,style:'bare'};
  assert.strictEqual(reportMarkerAt(s, 0), '①');
  assert.strictEqual(reportMarkerAt(s, 2), '③');
  assert.strictEqual(reportMarkerAt(s, 9), '⑩');
});

test('reportMarkerAt: 무번호(none) → 빈 문자열', () => {
  assert.strictEqual(reportMarkerAt({kind:'none'}, 0), '');
  assert.strictEqual(reportMarkerAt({kind:'none'}, 7), '');
});

test('reportMarkerAt: custom → 그 문자 그대로', () => {
  assert.strictEqual(reportMarkerAt({kind:'custom',ch:'▶'}, 0), '▶');
  assert.strictEqual(reportMarkerAt({kind:'custom',ch:'✅'}, 3), '✅');
});

test('reportMarkerAt: 범위 초과(가나다/자모/원문자 i≥표 길이) → "?" 폴백(크래시 금지)', () => {
  assert.strictEqual(reportMarkerAt({kind:'seq',seq:KO_GA,style:'dot'}, 14), '?');   // 길이 14
  assert.strictEqual(reportMarkerAt({kind:'seq',seq:KO_JA,style:'paren'}, 14), '?'); // 길이 14
  assert.strictEqual(reportMarkerAt({kind:'seq',seq:CIRCLE,style:'bare'}, 10), '?'); // 길이 10
  // 폴백은 접미 없이 순수 '?'
  assert.strictEqual(reportMarkerAt({kind:'seq',seq:KO_GA,style:'both'}, 99), '?');
});

test('reportMarkerAt: 방어 — null spec/미지 kind → 빈 문자열', () => {
  assert.strictEqual(reportMarkerAt(null, 0), '');
  assert.strictEqual(reportMarkerAt({kind:'zzz'}, 0), '');
});

// prefix 조립 규약: mark==='' ? '' : (mark + ' ')  — 무번호는 공백도 없음.
test('prefix 조립: 무번호는 공백 없음, 그 외는 마커+공백', () => {
  const pfx = (spec, i) => { const m = reportMarkerAt(spec, i); return m === '' ? '' : (m + ' '); };
  assert.strictEqual(pfx({kind:'none'}, 0), '');
  assert.strictEqual(pfx({kind:'const',ch:'-'}, 0), '- ');
  assert.strictEqual(pfx({kind:'num',style:'dot'}, 0), '1. ');
});
