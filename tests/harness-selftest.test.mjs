// 하네스 자체 검증 — extractFunction / FakeDoc 동작 보장.
// 이후 브리프(북마클릿 등)가 이 하네스를 믿고 쓰기 위한 안전망.
import { readFileSync } from 'node:fs';
import { test, assert, loadAppSource, extractFunction, FakeDoc, filesWithNoTests, extractCsMember } from './harness.mjs';

// fixture 로더(tests/ 기준 상대 경로).
function loadFixture(name) {
  return readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
}

// 1) extractFunction: 앱 소스에서 fmtH 추출 → eval → 값 검증.
test('extractFunction: fmtH 추출·eval → fmtH(90)==="1.5", fmtH(60)==="1"', () => {
  const src = loadAppSource();
  const code = extractFunction(src, 'fmtH');
  assert.match(code, /^function\s+fmtH\s*\(/); // 선언으로 시작
  assert.ok(code.trim().endsWith('}'), 'body가 } 로 닫혀야 함');
  // eval: 선언을 노출시켜 참조 → 호출.
  const fmtH = eval('(' + code + ')');
  assert.strictEqual(fmtH(90), '1.5');
  assert.strictEqual(fmtH(60), '1');
});

// 2) FakeDoc(daily): status/overtime/content 접근·세팅.
test('FakeDoc(daily): status value 세팅·재독, overtime selectedIndex→value, content 세팅·재독', () => {
  const doc = FakeDoc(loadFixture('mock-pjm-daily.html'));

  const status = doc.getElementsByName('status')[0];
  assert.ok(status, 'status 요소 존재해야 함');
  status.value = '3';
  assert.strictEqual(status.value, '3');

  const overtime = doc.getElementsByName('overtime')[0];
  assert.ok(overtime, 'overtime 요소 존재해야 함');
  overtime.selectedIndex = 5;
  assert.strictEqual(overtime.value, '5'); // selectedIndex 세팅 시 value 동기화

  const content = doc.getElementsByName('content')[0];
  assert.ok(content, 'content 요소 존재해야 함');
  content.value = '테스트 본문';
  assert.strictEqual(content.value, '테스트 본문');
});

// 3) FakeDoc(weekly): 5필드 존재 + value 세팅·재독.
test('FakeDoc(weekly): sdate/edate/subject/content/endwork 5필드 세팅·재독', () => {
  const doc = FakeDoc(loadFixture('mock-pjm-weekly.html'));
  const fields = ['sdate', 'edate', 'subject', 'content', 'endwork'];
  for (const name of fields) {
    const el = doc.getElementsByName(name)[0];
    assert.ok(el, `${name} 요소 존재해야 함`);
    const v = 'v_' + name;
    el.value = v;
    assert.strictEqual(el.value, v, `${name} value 재독 일치해야 함`);
  }
});

// 4) FakeDoc: 없는 이름 / querySelector(password) 없음.
test('FakeDoc: 없는 name → 길이 0, querySelector(password) → null', () => {
  const doc = FakeDoc(loadFixture('mock-pjm-daily.html'));
  assert.strictEqual(doc.getElementsByName('nope').length, 0);
  assert.strictEqual(doc.querySelector('input[type=password]'), null);
});

// 5) extractFunction: 문자열/템플릿 리터럴·주석 안의 중괄호는 균형 카운트에서 뺀다.
//    ★ 1)의 fmtH 에는 리터럴이 하나도 없어서 이 동작을 아무 계약도 안 보고 있었다(아래 변이② 감사에서 드러남).
//    앱 소스에는 '}' 를 품은 리터럴이 흔하므로(정규식·JSON 조립) 여기서 따로 못박는다.
const LITERAL_PROBE =
  'function tf(a){\n' +
  "  const s = '}';        // 작은따옴표 안의 닫는 중괄호\n" +
  '  const t = "{{";       // 큰따옴표 안의 여는 중괄호\n' +
  '  const u = `${a} }`;   // 템플릿 리터럴 안의 중괄호\n' +
  '  /* 블록 주석 안의 } */\n' +
  '  return s + t + u;\n' +
  '}\n꼬리 텍스트 { } 는 잘려 나가야 한다\n';
test('extractFunction: 리터럴·주석 안의 중괄호는 세지 않는다(오탐 방지)', () => {
  const code = extractFunction(LITERAL_PROBE, 'tf');
  assert.match(code, /^function\s+tf\s*\(/, '선언으로 시작');
  assert.ok(code.trim().endsWith('}'), 'body가 } 로 닫혀야 함');
  assert.ok(!code.includes('꼬리 텍스트'), '함수 뒤 텍스트까지 삼키면 안 됨');
  assert.strictEqual(eval('(' + code + ')')('x'), '}{{x }', '잘라낸 코드가 실제로 돌고 리터럴이 온전해야 함');
});

// 6) extractCsMember: 식(=>) 본문 멤버는 **자기 문장에서 끝난다** — 다음 멤버를 삼키지 않는다.
//    ★ 2026-09-11 적대 검토(R2-W5): 옛 판은 '{' 만 찾았다. 중괄호가 없는 식 본문 멤버에서는 **다음 멤버의**
//      여는 중괄호를 자기 것으로 잡고 그 본문까지 통째로 삼켰다. 그 슬라이스로 "이 멤버가 X 를 부른다"를
//      보면 실제로 부르는 것은 옆 멤버인데 초록이 뜬다(반대로 "안 부른다" 계약은 거짓 실패가 난다).
const CS_EXPR_PROBE = [
  'public class P {',
  '    private void Ping(bool ok, string msg = "") =>',
  '        JsCall("window.__ping(" + (ok ? "true" : "false") + ";" + msg + ")");',
  '',
  '    private async Task ReloadAsync() {',
  '        await LoadEverythingAsync();',
  '    }',
  '}',
].join('\n');

test('extractCsMember: 식(=>) 본문 멤버는 ; 에서 끝난다(다음 멤버를 삼키지 않는다)', () => {
  const one = extractCsMember(CS_EXPR_PROBE, 'private void Ping(');
  assert.ok(one.startsWith('private void Ping('), '시그니처부터 잘라야 한다: ' + JSON.stringify(one.slice(0, 40)));
  assert.ok(one.trim().endsWith(';'), '식 본문은 ; 로 닫혀야 한다: ' + JSON.stringify(one.slice(-20)));
  assert.ok(!one.includes('ReloadAsync'), '다음 멤버의 머리까지 삼켰다 — 옆 멤버가 판정에 섞인다');
  assert.ok(!one.includes('LoadEverythingAsync'), '다음 멤버의 본문까지 삼켰다');
  assert.ok(one.includes('window.__ping'), '자기 본문이 잘려 나갔다');
  //  ★ 리터럴 안의 ';' 는 문장 끝이 아니다 — probe 의 + ";" + 가 그 덫이다.
  assert.ok(one.includes('msg + ")")'), '리터럴 안의 ; 를 문장 끝으로 오인해 잘렸다: ' + JSON.stringify(one));
  //  중괄호 본문 경로는 그대로여야 한다(겨냥 확인 — 식 본문 처리가 옆길을 건드리지 않았다).
  const two = extractCsMember(CS_EXPR_PROBE, 'private async Task ReloadAsync(');
  assert.ok(two.trim().endsWith('}') && two.includes('LoadEverythingAsync'), '중괄호 본문 경로가 깨졌다: ' + JSON.stringify(two));
});

// 7) 실물 — 호스트의 UserSaved 가 바로 그 모양이다(식 본문 + 곧바로 다음 멤버).
test('extractCsMember(실물): UserSaved 슬라이스에 옆 멤버(LoadMembersToWebAsync)가 섞이지 않는다', () => {
  const main = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
  const b = extractCsMember(main, 'private void UserSaved(');
  assert.ok(/window\.__userSaved/.test(b), 'UserSaved 자기 본문이 없다 — 엉뚱한 곳을 잘랐다');
  assert.ok(!/LoadMembersToWebAsync/.test(b),
    '식 본문 멤버가 다음 멤버(LoadMembersToWebAsync)까지 삼켰다 — 이 슬라이스를 믿는 계약은 옆 멤버를 보고 초록이 된다');
  assert.ok(b.length < 600, '슬라이스가 지나치게 길다(다음 멤버까지 삼켰을 때의 증상): ' + b.length);
});

// ══ 변이 시험(mutation test) — 하네스 자신을 망가뜨려도 위 4건이 초록인가 ══
// 위 4건은 "지금 통과한다"만 말한다. 여기서 겨냥하는 건 앱 소스가 아니라 **하네스 자신**
// (tests/harness.mjs)이다 — 이 파일의 존재 이유가 '하네스를 믿고 쓰기 위한 안전망'이니,
// 하네스를 실제로 부러뜨려도 안 울면 안전망이 아니다.
//
// 방법: harness.mjs 를 한 곳만 고친 **임시 사본**을 만들어 동적 import 한 뒤, 같은 입력으로
//   그 사본의 extractFunction/FakeDoc 을 불러 결과가 무너지는지 단언한다.
//   ★ 사본은 반드시 tests/ 안에 둔다 — harness.mjs 가 '../task-calendar-prototype.html' 과
//     fixtures 상대 경로를 import.meta.url 기준으로 쓰기 때문에, 다른 폴더에 두면
//     '변이 때문에' 가 아니라 '경로 때문에' 깨져서 판정이 거짓이 된다.
//   ★ 사본 이름은 *.test.mjs 로 끝나면 안 된다(run-tests.mjs 가 주워 큐에 올린다).
//     점 프리픽스(.harness-mutant-*)로 피하고, finally 에서 반드시 지운다.
// ★ 앵커를 못 찾거나 여러 곳이면 조용히 통과하지 않고 실패한다(판정 불가는 통과가 아니다).
import { writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const HARNESS_SRC = readFileSync(new URL('./harness.mjs', import.meta.url), 'utf8');
const TESTS_DIR = fileURLToPath(new URL('./', import.meta.url));

// 강제 종료(Ctrl+C·크래시)로 finally 가 못 돈 회차의 잔재를 먼저 치운다 — 조용히 쌓이면
// 러너가 줍진 않아도 워킹트리가 더러워지고 다음 감사에서 혼란을 준다.
for (const f of readdirSync(TESTS_DIR)) {
  if (f.startsWith('.harness-mutant-')) { try { unlinkSync(join(TESTS_DIR, f)); } catch (_) {} }
}

async function withMutatedHarness(find, replace, fn) {
  const at = HARNESS_SRC.indexOf(find);
  assert.ok(at >= 0, '변이 앵커를 harness.mjs 에서 찾지 못했다(리팩터로 사라졌다면 앵커를 갱신할 것): ' + find);
  assert.strictEqual(at, HARNESS_SRC.lastIndexOf(find),
    '변이 앵커가 여러 곳에 있다 — 겨냥이 흐려진다. 앞뒤를 붙여 유일하게 만들 것: ' + find);
  const mutated = HARNESS_SRC.slice(0, at) + replace + HARNESS_SRC.slice(at + find.length);
  assert.notStrictEqual(mutated, HARNESS_SRC, '변이가 원본을 바꾸지 못했다(find 와 replace 가 같다)');

  const path = join(TESTS_DIR, '.harness-mutant-' + Math.random().toString(36).slice(2, 10) + '.mjs');
  writeFileSync(path, mutated, 'utf8');
  try {
    return await fn(await import(pathToFileURL(path).href));
  } finally {
    try { unlinkSync(path); } catch (_) {}   // 뒷정리 실패로 시험이 빨개지진 않게
  }
}

// ── 변이① 중괄호 균형 카운트에서 닫는 괄호를 '더한다' → 짝이 영원히 안 맞는다 ──
// (깨져야 할 계약: 'extractFunction: fmtH 추출·eval → fmtH(90)==="1.5", fmtH(60)==="1"')
test('변이①: extractFunction 의 닫는 중괄호 카운트를 뒤집으면 fmtH 추출이 깨진다', async () => {
  const src = loadAppSource();
  const ok = extractFunction(src, 'fmtH');
  assert.match(ok, /^function\s+fmtH\s*\(/, '사전조건: 정상 하네스는 선언부터 자른다');
  assert.ok(ok.trim().endsWith('}'), '사전조건: body 가 } 로 닫힌다');
  assert.strictEqual(eval('(' + ok + ')')(90), '1.5', '사전조건: 잘라낸 코드가 실제로 돈다');

  await withMutatedHarness('depth--;', 'depth++;', (m) => {
    assert.throws(() => m.extractFunction(src, 'fmtH'), /중괄호 짝이 맞지 않음/,
      '닫는 중괄호를 안 세는데도 추출이 성공한다 — 이 파일의 계약이 균형 카운트를 안 본다');
  });
});

// ── 변이② 균형 카운트가 문자열 리터럴을 건너뛰지 않게 한다 → 리터럴 안 '}' 에 오탐 ──
// (깨져야 할 계약: 'extractFunction: … body가 } 로 닫혀야 함' — 리터럴 오탐이면 잘린 코드가 나온다)
test('변이②: extractFunction 이 문자열 리터럴을 건너뛰지 않으면 리터럴 안 중괄호에 오탐한다', async () => {
  const ok = extractFunction(LITERAL_PROBE, 'tf');
  assert.strictEqual(eval('(' + ok + ')')('x'), '}{{x }', '사전조건: 정상 하네스는 리터럴 안 중괄호를 균형 카운트에서 뺀다');
  assert.ok(ok.trim().endsWith('}'), '사전조건: body 가 } 로 닫힌다');

  await withMutatedHarness('j = skipString(source, j);', 'j = j + 1;', (m) => {
    const bad = m.extractFunction(LITERAL_PROBE, 'tf');
    assert.notStrictEqual(bad, ok, '리터럴 스킵을 꺼도 같은 코드가 나온다 — 계약이 리터럴 방어를 안 본다');
    assert.ok(bad.endsWith("const s = '}"), "리터럴 안 '}' 를 닫는 중괄호로 오인해 거기서 잘려야 한다: " + JSON.stringify(bad));
    assert.throws(() => eval('(' + bad + ')'), SyntaxError, '잘린 코드는 eval 조차 안 된다');
  });
});

// ── 변이③ FakeDoc select 의 selectedIndex→value 동기화 제거 → 폼 값이 안 따라온다 ──
// (깨져야 할 계약: 'FakeDoc(daily): … overtime selectedIndex→value …')
test('변이③: FakeDoc 의 selectedIndex→value 동기화를 없애면 overtime 계약이 깨진다', async () => {
  const html = loadFixture('mock-pjm-daily.html');
  const okSel = FakeDoc(html).getElementsByName('overtime')[0];
  okSel.selectedIndex = 5;
  assert.strictEqual(okSel.value, '5', '사전조건: 정상 하네스는 selectedIndex 세팅 시 value 를 동기화한다');

  await withMutatedHarness('_value = options[_selectedIndex].value;', 'void 0;', (m) => {
    const sel = m.FakeDoc(html).getElementsByName('overtime')[0];
    sel.selectedIndex = 5;
    assert.strictEqual(sel.selectedIndex, 5, 'selectedIndex 자체는 그대로여야 한다(동기화만 껐다 — 겨냥 확인)');
    assert.notStrictEqual(sel.value, '5', '동기화를 꺼도 value 가 따라온다 — 계약이 동기화를 안 본다');
    assert.strictEqual(sel.value, '0', '동기화가 없으면 value 는 첫 option 값에 머문다(회사 폼에 0시간이 실린다)');
  });
});

// ── 변이④ FakeDoc 의 password 판별을 느슨하게 한다 → 아무 input 이나 password 로 오인 ──
// (깨져야 할 계약: 'FakeDoc: 없는 name → 길이 0, querySelector(password) → null')
test('변이④: FakeDoc 의 password 판별을 느슨하게 하면 "password 없음 → null" 계약이 깨진다', async () => {
  const html = loadFixture('mock-pjm-daily.html');
  assert.strictEqual(FakeDoc(html).querySelector('input[type=password]'), null,
    '사전조건: 이 픽스처(로그인 후 화면)엔 password 입력이 없다');

  await withMutatedHarness(
    "if (el.tagName === 'INPUT' && el.type === 'password') return el;",
    "if (el.tagName === 'INPUT') return el;",
    (m) => {
      const doc = m.FakeDoc(html);
      const got = doc.querySelector('input[type=password]');
      assert.notStrictEqual(got, null, '판별을 느슨하게 해도 null 이 나온다 — 계약이 password 판별을 안 본다');
      assert.strictEqual(got.tagName, 'INPUT', '아무 input 이나 password 로 오인해 돌려준다(로그인 여부 오판)');
      assert.notStrictEqual(got.type, 'password', '돌려준 요소는 사실 password 가 아니다');
      assert.strictEqual(doc.getElementsByName('nope').length, 0, '없는 name 경로는 사정권 밖(겨냥 확인)');
    });
});

// ── 변이⑤ extractCsMember 의 식(=>) 본문 갈래를 없앤다 → 다음 멤버를 다시 삼킨다 ──
// (깨져야 할 계약: 'extractCsMember: 식(=>) 본문 멤버는 ; 에서 끝난다…' · 'extractCsMember(실물): …')
test('변이⑤: extractCsMember 가 식(=>) 본문을 모르면 다음 멤버를 통째로 삼킨다', async () => {
  const ok = extractCsMember(CS_EXPR_PROBE, 'private void Ping(');
  assert.ok(!ok.includes('LoadEverythingAsync'), '사전조건: 정상 하네스는 옆 멤버를 삼키지 않는다');

  await withMutatedHarness('if (arrow >= 0 && (open < 0 || arrow < open)) {', 'if (false) {', (m) => {
    const bad = m.extractCsMember(CS_EXPR_PROBE, 'private void Ping(');
    assert.notStrictEqual(bad, ok, '식 본문 갈래를 껐는데 같은 슬라이스가 나온다 — 계약이 그 갈래를 안 본다');
    assert.ok(bad.includes('LoadEverythingAsync'),
      '식 본문 갈래 없이도 옆 멤버를 안 삼킨다 — 이 계약이 겨냥한 것이 아니다');
    //  실물에서도 같은 일이 난다(계약 7 이 겨냥한 그 자리다).
    const main = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
    assert.ok(/LoadMembersToWebAsync/.test(m.extractCsMember(main, 'private void UserSaved(')),
      '실물 UserSaved 에서도 옆 멤버가 섞이지 않는다 — 변이가 겨냥을 빗나갔다(앵커를 갱신할 것)');
  });
});

// ── 등록 인구조사(census) — 게이트가 '조용히 줄어드는 것' 을 보는가 ─────────────────
//
//  하네스 맨 위 주석이 이미 같은 사고를 적어 뒀다: jsdom 이 없을 때 218건이 **등록조차 되지
//  않은 채** 요약은 pass 1건이 늘고 exit 0 이 났다(실측 820 → 602 pass). 그건 skip 규약으로
//  막았다. 그런데 그 규약도 못 보는 두 갈래가 남아 있었다 — 둘 다 skip 조차 남기지 않는다:
//    ① 시험 파일이 통째로 사라진다(개명·삭제). 러너는 *.test.mjs 만 수집하므로 **수집조차** 안 한다.
//    ② 한 파일이 0건을 등록한다(전부 조건 밖으로 밀려남·이른 return).
//  둘 다 "pass 가 줄고 fail 은 0" 으로만 나타나, 사람이 총합을 외우고 있어야 보인다.
//
//  ★ 2026-09-07 실측 — 시험 파일 하나(holiday.test.mjs)를 감추자 1085 → 1060 pass 로
//    24건이 증발했다. 러너①/러너② 를 넣기 전이었다면 그대로 **0 fail / exit 0** 이다.
//    아래는 그 두 계약이 기대는 순수 함수와 배선을 잠근다.
const runnerSrc = readFileSync(new URL('./run-tests.mjs', import.meta.url), 'utf8');

test('census①: filesWithNoTests 가 0건 파일만 골라낸다(정렬·방어 포함)', () => {
  assert.deepStrictEqual(filesWithNoTests({ 'b.test.mjs': 0, 'a.test.mjs': 3 }), ['b.test.mjs']);
  assert.deepStrictEqual(filesWithNoTests({ 'z.test.mjs': 0, 'a.test.mjs': 0 }), ['a.test.mjs', 'z.test.mjs'], '이름순 정렬');
  assert.deepStrictEqual(filesWithNoTests({ 'a.test.mjs': 5 }), [], '전부 등록했으면 빈 배열');
  //  방어 — undefined·NaN·음수는 전부 '등록 못 함' 으로 본다(판정 불가 ≠ 통과)
  assert.deepStrictEqual(filesWithNoTests({ 'a.test.mjs': undefined }), ['a.test.mjs']);
  assert.deepStrictEqual(filesWithNoTests({ 'a.test.mjs': NaN }), ['a.test.mjs']);
  assert.deepStrictEqual(filesWithNoTests({ 'a.test.mjs': -1 }), ['a.test.mjs']);
  assert.deepStrictEqual(filesWithNoTests(null), [], 'null 입력에 터지지 않는다');
});

test('census②: 러너가 파일별 등록 수를 실제로 세고 두 계약을 건다(배선)', () => {
  //  ★ 순수 함수만 잠그면 '맞게 만들어 두고 안 쓰는' 상태를 못 본다 — commit-merge.test.mjs 가
  //    호출부 2곳을 지워도 전 스위트가 초록이던 사고로 배운 것이다. 배선까지 본다.
  assert.ok(/queuedCount\(\)/.test(runnerSrc), '러너가 queuedCount() 로 큐 증가분을 세지 않는다');
  assert.ok(/counts\[f\]\s*=\s*queuedCount\(\)\s*-\s*before/.test(runnerSrc),
    '러너가 파일별 등록 수(counts[f])를 큐 증가분으로 잡지 않는다 — 인구조사의 원천이 사라졌다');
  assert.ok(/filesWithNoTests\(counts\)/.test(runnerSrc), '러너가 filesWithNoTests(counts) 를 부르지 않는다');
  assert.ok(/러너①/.test(runnerSrc) && /러너②/.test(runnerSrc), '러너①·러너② 계약이 러너에 등록되지 않는다');
  assert.ok(/const MIN_TEST_FILES\s*=\s*\d+\s*;/.test(runnerSrc), 'MIN_TEST_FILES 하한 선언이 없다');
});

test('census③: MIN_TEST_FILES 하한이 실제 수집 파일 수 이하다(항상 실패하는 게이트 금지)', () => {
  //  ★ 하한을 실제보다 높게 적어 두면 게이트가 **영원히 빨갛다**. 통과 불가능한 게이트는
  //    "원래 빨간 거야" 로 학습돼 결국 무시된다 — 그것도 결함이다(xml-retirement 변이⑯과 같은 취지).
  const m = /const MIN_TEST_FILES\s*=\s*(\d+)\s*;/.exec(runnerSrc);
  assert.ok(m, 'MIN_TEST_FILES 를 읽지 못했다 — 선언 형태가 바뀌었다면 여기를 갱신할 것');
  const floor = Number(m[1]);
  const actual = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.test.mjs')).length;
  assert.ok(floor > 0, 'MIN_TEST_FILES 가 0 이면 하한이 아무것도 막지 않는다');
  assert.ok(floor <= actual,
    `MIN_TEST_FILES(${floor}) 가 실제 시험 파일 수(${actual})보다 크다 — 게이트가 영원히 실패한다`);
});

// ── 변이 — 인구조사 계약이 정말 발화하는지 ────────────────────────────
test('변이C①: filesWithNoTests 가 0건을 통과시키면 census① 이 실패한다', async () => {
  assert.deepStrictEqual(filesWithNoTests({ 'b.test.mjs': 0 }), ['b.test.mjs'], '사전조건: 정상 하네스는 0건 파일을 잡는다');
  await withMutatedHarness(
    "return Object.keys(c).filter((f) => !(c[f] > 0)).sort();",
    "return Object.keys(c).filter((f) => c[f] < 0).sort();",
    (m) => {
      assert.deepStrictEqual(m.filesWithNoTests({ 'b.test.mjs': 0 }), [],
        '0건을 음수만 걸러 내게 바꿔도 여전히 잡힌다 — 계약이 0건 판정을 안 본다');
      assert.deepStrictEqual(m.filesWithNoTests({ 'a.test.mjs': 3 }), [], '겨냥 확인: 정상 파일은 양쪽 다 통과');
    });
});

test('변이C②: 러너에서 인구조사 배선을 걷어내면 census② 가 실패한다', () => {
  //  텍스트 계약이므로 러너 소스 문자열을 변이한다(원본은 건드리지 않는다).
  const FIND = 'counts[f] = queuedCount() - before;';
  const at = runnerSrc.indexOf(FIND);
  assert.ok(at >= 0, '변이 앵커를 run-tests.mjs 에서 찾지 못했다 — 앵커 없음은 통과가 아니다');
  assert.strictEqual(at, runnerSrc.lastIndexOf(FIND), '변이 앵커가 여러 곳이다 — 겨냥이 흐리다');
  const bad = runnerSrc.slice(0, at) + 'counts[f] = 1;' + runnerSrc.slice(at + FIND.length);
  assert.ok(!/counts\[f\]\s*=\s*queuedCount\(\)\s*-\s*before/.test(bad),
    '배선을 상수로 바꿨는데도 계약의 정규식이 여전히 걸린다 — 계약이 배선을 안 보고 있다');
  //  통제군 — 원본은 걸린다(위 판정이 '변이 때문' 임을 증명)
  assert.ok(/counts\[f\]\s*=\s*queuedCount\(\)\s*-\s*before/.test(runnerSrc));
});
