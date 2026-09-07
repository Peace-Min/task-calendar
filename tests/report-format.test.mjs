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

// ══ 변이 시험(mutation test) — 위 계약이 정말 '검사하고' 있는지 못박는다 ══
// 위 11건은 "지금 통과한다"만 말한다. reportMarkerAt 을 실제로 망가뜨려도 초록이면
// 그건 계약이 그 분기를 안 본다는 뜻이다 — 그 구분을 여기서 낸다.
//
// 방법: 앱 소스를 한 곳만 고쳐(mutateOnce) reportMarkerAt 을 **다시 잘라 eval** 한 뒤
//   같은 (spec, i)로 불러 값이 실제로 달라지는지(또는 던지는지) 단언한다 — 행위 검사다.
// 각 시험은 (1) 정상 소스의 기대값 → (2) 변이 소스에서 그게 무너짐 을 둘 다 본다.
// ★ 앵커를 못 찾거나 여러 곳이면 조용히 통과하지 않고 실패한다(판정 불가는 통과가 아니다).

function mutateOnce(find, replace) {
  const at = src.indexOf(find);
  assert.ok(at >= 0, '변이 앵커를 앱 소스에서 찾지 못했다(리팩터로 사라졌다면 앵커를 갱신할 것): ' + find);
  assert.strictEqual(at, src.lastIndexOf(find),
    '변이 앵커가 여러 곳에 있다 — 겨냥이 흐려진다. 앞뒤 줄을 붙여 유일하게 만들 것: ' + find);
  const out = src.slice(0, at) + replace + src.slice(at + find.length);
  assert.notStrictEqual(out, src, '변이가 원본을 바꾸지 못했다(find 와 replace 가 같다)');
  return out;
}

// 변이 소스에서 reportMarkerAt 을 다시 잘라 eval — 돌려주는 건 '망가진 함수'다.
// ★ 잘라낸 코드가 원본과 같으면 변이가 이 함수 밖에 떨어진 것 → 실패시킨다(겨냥 확인).
function mutatedMarkerAt(find, replace) {
  const code = extractFunction(mutateOnce(find, replace), 'reportMarkerAt');
  assert.notStrictEqual(code, extractFunction(src, 'reportMarkerAt'),
    '변이가 reportMarkerAt 안에 떨어지지 않았다 — 앵커가 다른 함수를 겨냥했다: ' + find);
  return eval('(' + code + ')');
}

// ── 변이① none 이 spec.ch 를 돌려준다 → 무번호가 undefined 로 샌다 ──
// (깨져야 할 계약: 'reportMarkerAt: 무번호(none) → 빈 문자열' · 'prefix 조립: 무번호는 공백 없음')
test('변이①: none 분기가 spec.ch 를 돌려주면 "무번호 → 빈 문자열" 계약이 깨진다', () => {
  assert.strictEqual(reportMarkerAt({kind:'none'}, 0), '', '사전조건: 정상 소스는 빈 문자열을 준다');
  assert.strictEqual(reportMarkerAt({kind:'none'}, 7), '', '사전조건: i 와 무관하게 빈 문자열');

  const f = mutatedMarkerAt("case 'none': return '';", "case 'none': return spec.ch;");
  assert.strictEqual(f({kind:'none'}, 0), undefined,
    "none 을 spec.ch 로 바꿔도 '' 가 나온다 — 계약이 none 분기를 안 본다");
  const pfx = (spec, i) => { const m = f(spec, i); return m === '' ? '' : (m + ' '); };
  assert.strictEqual(pfx({kind:'none'}, 0), 'undefined ', '조립 규약(prefix)까지 오염된다(빈 줄이 아니라 문자열이 실린다)');
});

// ── 변이② alpha 상한(25) 제거 → Z/z 다음 글자('[', '{')가 새어나온다 ──
// (깨져야 할 계약: 'reportMarkerAt: 영문 — A./a. 대소문자 + 범위(Z/z=25) 초과 시 "?" 폴백')
test('변이②: alpha 범위 상한(i <= 25)을 없애면 "Z/z 초과 → ?" 계약이 깨진다', () => {
  assert.strictEqual(reportMarkerAt({kind:'alpha',base:65}, 25), 'Z.', '사전조건: 경계 25 는 Z.');
  assert.strictEqual(reportMarkerAt({kind:'alpha',base:65}, 26), '?', '사전조건: 26 은 ? 폴백');
  assert.strictEqual(reportMarkerAt({kind:'alpha',base:97}, 26), '?', '사전조건: 소문자도 ? 폴백');

  const f = mutatedMarkerAt('(i >= 0 && i <= 25)', '(i >= 0)');
  assert.strictEqual(f({kind:'alpha',base:65}, 25), 'Z.', '경계 안쪽은 그대로여야 한다(변이가 정상 경로를 죽인 게 아님)');
  assert.strictEqual(f({kind:'alpha',base:65}, 26), '[.', '상한을 없애면 Z 다음 문자 "[" 가 새어나와야 한다');
  assert.strictEqual(f({kind:'alpha',base:97}, 26), '{.', '소문자 쪽은 "{" 가 새어나와야 한다');
});

// ── 변이③ seq 범위 폴백 '?' → '' → 접미만 남은 쓰레기 마커가 된다 ──
// (깨져야 할 계약: 'reportMarkerAt: 범위 초과(가나다/자모/원문자 i≥표 길이) → "?" 폴백(크래시 금지)')
const SEQ_FALLBACK_FIND = "const ch = (spec.seq && i >= 0 && i < spec.seq.length) ? spec.seq[i] : '?';";
const SEQ_FALLBACK_REPL = "const ch = (spec.seq && i >= 0 && i < spec.seq.length) ? spec.seq[i] : '';";
test('변이③: seq 범위 초과 폴백을 "?" 대신 빈 문자열로 하면 폴백 계약이 깨진다', () => {
  assert.strictEqual(reportMarkerAt({kind:'seq',seq:KO_GA,style:'dot'}, 14), '?', '사전조건: 표 길이 초과는 ?');
  assert.strictEqual(reportMarkerAt({kind:'seq',seq:CIRCLE,style:'bare'}, 10), '?', '사전조건: 원문자도 ?');

  const f = mutatedMarkerAt(SEQ_FALLBACK_FIND, SEQ_FALLBACK_REPL);
  assert.strictEqual(f({kind:'seq',seq:KO_GA,style:'dot'}, 0), '가.', '표 안쪽은 그대로여야 한다(겨냥 확인)');
  assert.strictEqual(f({kind:'seq',seq:KO_GA,style:'dot'}, 14), '.', '폴백을 빈 문자열로 바꾸면 접미(.)만 남아야 한다');
  assert.strictEqual(f({kind:'seq',seq:CIRCLE,style:'bare'}, 10), '', 'bare 는 통째로 빈 마커가 된다(번호가 조용히 사라진다)');
});

// ── 변이④ num 의 paren/both 스타일 뒤바꿈 → '1)' 과 '(1)' 이 서로 자리를 바꾼다 ──
// (깨져야 할 계약: 'reportMarkerAt: 숫자 — dot/paren/both, i는 0-base → i+1')
const NUM_FIND = "return spec.style === 'paren' ? (n + ')') : spec.style === 'both' ? ('(' + n + ')') : (n + '.');";
const NUM_REPL = "return spec.style === 'paren' ? ('(' + n + ')') : spec.style === 'both' ? (n + ')') : (n + '.');";
test('변이④: num 의 paren/both 를 뒤바꾸면 숫자 스타일 계약이 깨진다', () => {
  assert.strictEqual(reportMarkerAt({kind:'num',style:'paren'}, 0), '1)', '사전조건: paren=1)');
  assert.strictEqual(reportMarkerAt({kind:'num',style:'both'}, 0), '(1)', '사전조건: both=(1)');

  const f = mutatedMarkerAt(NUM_FIND, NUM_REPL);
  assert.strictEqual(f({kind:'num',style:'paren'}, 0), '(1)', '뒤바꿔도 1) 이 나온다 — 계약이 paren 스타일을 안 본다');
  assert.strictEqual(f({kind:'num',style:'both'}, 4), '5)', '뒤바꿔도 (5) 가 나온다 — 계약이 both 스타일을 안 본다');
  assert.strictEqual(f({kind:'num',style:'dot'}, 2), '3.', 'dot 은 이 변이의 사정권 밖 — 그대로여야 앵커가 정확히 겨냥된 것');
});

// ── 변이⑤ seq 의 bare(원문자 접미 없음)에 '.' 을 붙인다 → ①. 이 된다 ──
// (깨져야 할 계약: 'reportMarkerAt: 원문자 — 접미 없음(bare)')
test('변이⑤: bare(원문자)에 접미 "." 을 붙이면 "접미 없음" 계약이 깨진다', () => {
  const s = {kind:'seq',seq:CIRCLE,style:'bare'};
  assert.strictEqual(reportMarkerAt(s, 0), '①', '사전조건: 원문자는 접미 없이 그대로');
  assert.strictEqual(reportMarkerAt(s, 9), '⑩', '사전조건: 표 끝(⑩)도 접미 없음');

  const f = mutatedMarkerAt("if(spec.style === 'bare') return ch;", "if(spec.style === 'bare') return ch + '.';");
  assert.strictEqual(f(s, 0), '①.', '접미를 붙여도 ① 이 나온다 — 계약이 bare 분기를 안 본다');
  assert.strictEqual(f({kind:'seq',seq:KO_GA,style:'dot'}, 0), '가.', 'dot 스타일은 사정권 밖(겨냥 확인)');
});

// ── 변이⑥ null spec 방어 제거 → 방어 대신 TypeError 로 죽는다 ──
// (깨져야 할 계약: 'reportMarkerAt: 방어 — null spec/미지 kind → 빈 문자열')
const NULLGUARD_FIND = "function reportMarkerAt(spec, i){\n  if(!spec) return '';";
test('변이⑥: null spec 방어를 빼면 방어 계약이 깨진다(빈 문자열 대신 throw)', () => {
  assert.strictEqual(reportMarkerAt(null, 0), '', '사전조건: 정상 소스는 null spec 을 빈 문자열로 막는다');
  assert.strictEqual(reportMarkerAt(undefined, 0), '', '사전조건: undefined 도 막는다');

  const f = mutatedMarkerAt(NULLGUARD_FIND, 'function reportMarkerAt(spec, i){');
  assert.throws(() => f(null, 0), TypeError, '방어를 빼도 안 던진다 — 계약이 null 방어를 안 본다');
  assert.strictEqual(f({kind:'none'}, 0), '', '이 변이는 null 경로만 건드린다(정상 spec 은 그대로 — 겨냥 확인)');
});

// ── 변이⑦ const(불릿) 분기가 빈 문자열을 돌려준다 → 불릿이 통째로 사라진다 ──
// (깨져야 할 계약: 'reportMarkerAt: 불릿 상수 — i와 무관하게 그 문자 그대로')
test('변이⑦: const(불릿) 분기를 빈 문자열로 만들면 불릿 계약이 깨진다', () => {
  for(const ch of ['-','•','▪']) assert.strictEqual(reportMarkerAt({kind:'const',ch}, 5), ch, '사전조건: 불릿은 i 무관하게 그대로');

  const f = mutatedMarkerAt("case 'const': return spec.ch;", "case 'const': return '';");
  assert.strictEqual(f({kind:'const',ch:'-'}, 0), '', '빈 문자열로 바꿔도 - 가 나온다 — 계약이 const 분기를 안 본다');
  assert.strictEqual(f({kind:'custom',ch:'▶'}, 0), '▶', 'custom 분기는 사정권 밖 — 두 분기가 한 줄로 합쳐지지 않았음을 확인');
});
