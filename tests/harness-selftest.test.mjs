// 하네스 자체 검증 — extractFunction / FakeDoc 동작 보장.
// 이후 브리프(북마클릿 등)가 이 하네스를 믿고 쓰기 위한 안전망.
import { readFileSync } from 'node:fs';
import { test, assert, loadAppSource, extractFunction, FakeDoc } from './harness.mjs';

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
