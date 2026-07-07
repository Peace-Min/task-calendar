// netcus 보고 채우기 core(tcFillCore) 검증 — 하네스·fixture 재사용, 의존성 0.
// bookmarklet-src.js에서 tcFillCore·tcParseQuery를 extractFunction으로 추출 후 eval.
import { test, assert, extractFunction, FakeDoc } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── core 추출 + eval ─────────────────────────────────────────────────
// bookmarklet-src.js 읽기(tests/ 기준 상위 → tools/netcus-fill/).
const srcUrl = new URL('../tools/netcus-fill/bookmarklet-src.js', import.meta.url);
const src = readFileSync(fileURLToPath(srcUrl), 'utf8');

// tcParseQuery는 tcFillCore가 의존하므로 함께 정의. 둘 다 붙여 eval → tcFillCore 반환.
const coreSrc = extractFunction(src, 'tcFillCore');
const helperSrc = extractFunction(src, 'tcParseQuery');
// eslint 무관 — indirect eval로 함수 참조를 얻는다.
// 두 함수 선언을 정의한 뒤 tcFillCore를 반환하는 IIFE로 감싼다.
const tcFillCore = eval('(function(){' + helperSrc + '\n' + coreSrc + '\nreturn tcFillCore;})()');

// ── fixture 로드 ─────────────────────────────────────────────────────
const dailyHtml = readFileSync(fileURLToPath(new URL('./fixtures/mock-pjm-daily.html', import.meta.url)), 'utf8');
const weeklyHtml = readFileSync(fileURLToPath(new URL('./fixtures/mock-pjm-weekly.html', import.meta.url)), 'utf8');

// 편의: FakeDoc에서 name 첫 요소 얻기.
function first(doc, name) {
  const list = doc.getElementsByName(name);
  return list && list.length ? list[0] : null;
}

// ── 1) daily 정상 ────────────────────────────────────────────────────
test('netcus-fill: daily 정상 채움(날짜 일치)', () => {
  const doc = FakeDoc(dailyHtml);
  const payload = {
    __tc: 'netcus-report', v: 1, kind: 'daily',
    date: { y: 2026, m: 7, d: 7 },
    fields: { status: '5', overtime: 3, content: '오늘 한 일' },
    dryRun: true,
  };
  const loc = { search: '?y=2026&m=7&d=7&id=t' };
  const res = tcFillCore(doc, payload, loc);

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.kind, 'daily');
  assert.deepStrictEqual(res.filled, ['status', 'overtime', 'content']);
  assert.deepStrictEqual(res.warnings, []);
  // 실제 반영 확인
  assert.strictEqual(first(doc, 'status').value, '5');
  assert.strictEqual(first(doc, 'overtime').selectedIndex, 3);
  assert.strictEqual(first(doc, 'content').value, '오늘 한 일');
});

// ── 2) daily 날짜 불일치 ─────────────────────────────────────────────
test('netcus-fill: daily 날짜 불일치 → 채움 + warning 1개', () => {
  const doc = FakeDoc(dailyHtml);
  const payload = {
    __tc: 'netcus-report', v: 1, kind: 'daily',
    date: { y: 2026, m: 7, d: 7 },
    fields: { status: '1', overtime: 0, content: 'x' },
    dryRun: true,
  };
  const loc = { search: '?y=2026&m=7&d=6' }; // 하루 다름
  const res = tcFillCore(doc, payload, loc);

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.filled.length, 3); // 채움은 진행
  assert.strictEqual(res.warnings.length, 1);
  assert.ok(res.warnings[0].includes('날짜를 확인하세요'), 'warning 문구에 안내 포함');
});

// ── 3) weekly 정상 ───────────────────────────────────────────────────
test('netcus-fill: weekly 정상 채움(5필드)', () => {
  const doc = FakeDoc(weeklyHtml);
  const payload = {
    __tc: 'netcus-report', v: 1, kind: 'weekly',
    fields: {
      sdate: '2026-07-06', edate: '2026-07-10',
      subject: '주간 제목', content: '투입시간', endwork: '진행사항',
    },
  };
  const res = tcFillCore(doc, payload, { search: '' });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.kind, 'weekly');
  assert.deepStrictEqual(res.filled, ['sdate', 'edate', 'subject', 'content', 'endwork']);
  assert.strictEqual(first(doc, 'sdate').value, '2026-07-06');
  assert.strictEqual(first(doc, 'edate').value, '2026-07-10');
  assert.strictEqual(first(doc, 'subject').value, '주간 제목');
  assert.strictEqual(first(doc, 'content').value, '투입시간');
  assert.strictEqual(first(doc, 'endwork').value, '진행사항');
});

// ── 4) kind 불일치 ───────────────────────────────────────────────────
test('netcus-fill: kind 불일치(daily payload → weekly 페이지) → ok:false + error', () => {
  const doc = FakeDoc(weeklyHtml);
  const payload = {
    __tc: 'netcus-report', v: 1, kind: 'daily',
    date: { y: 2026, m: 7, d: 7 },
    fields: { status: '1', overtime: 0, content: 'x' },
  };
  const res = tcFillCore(doc, payload, { search: '' });

  assert.strictEqual(res.ok, false);
  assert.ok(typeof res.error === 'string' && res.error.length > 0, 'error 문구 존재');
  assert.ok(res.error.includes('일간') && res.error.includes('주간'), 'error가 kind 불일치 안내');
});

// ── 5) 잘못된 페이로드 ───────────────────────────────────────────────
test('netcus-fill: 잘못된 페이로드({} / __tc 다름) → ok:false', () => {
  const doc = FakeDoc(dailyHtml);
  const r1 = tcFillCore(doc, {}, { search: '' });
  assert.strictEqual(r1.ok, false);
  assert.ok(r1.error);

  const r2 = tcFillCore(doc, { __tc: 'other', v: 1, kind: 'daily', fields: {} }, { search: '' });
  assert.strictEqual(r2.ok, false);
  assert.ok(r2.error);

  const r3 = tcFillCore(doc, null, { search: '' });
  assert.strictEqual(r3.ok, false);
});

// ── 6) 보고 페이지 아님 ──────────────────────────────────────────────
test('netcus-fill: 보고 작성 페이지 아님 → ok:false', () => {
  const doc = FakeDoc('<form></form>');
  const payload = {
    __tc: 'netcus-report', v: 1, kind: 'daily',
    date: { y: 2026, m: 7, d: 7 },
    fields: { status: '1', overtime: 0, content: 'x' },
  };
  const res = tcFillCore(doc, payload, { search: '' });
  assert.strictEqual(res.ok, false);
  assert.ok(res.error.includes('보고 작성 페이지가 아닙니다'), 'error가 페이지 감지 실패 안내');
});
