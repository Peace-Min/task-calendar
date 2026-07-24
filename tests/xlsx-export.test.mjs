// P4 — 사업부 Excel(.xlsx) 추출: 웹 쪽 순수 로직 + 웹/호스트 계약 드리프트 가드.
// 앱 소스에서 함수 선언을 잘라 되살려 단독 검증한다(브라우저·jsdom 불필요).
// 파일 바이트(xlsx) 자체는 호스트(C# XlsxWriter)가 만들므로 여기서는
//  (1) '무엇을 뽑는가'(행 매핑·필터 요약·건수·버튼 상태)와
//  (2) 웹이 보내는 키 ↔ 호스트 컬럼 정의가 어긋나지 않는지를 못박는다.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';
import { readFileSync } from 'node:fs';

const src = loadAppSource();

// 한 줄짜리 const 선언을 소스에서 그대로 가져온다(값 드리프트 방지 — 테스트에 복제하지 않는다).
function constLine(name) {
  const m = new RegExp('^const ' + name + '\\s*=.*$', 'm').exec(src);
  if (!m) throw new Error(`const ${name} 선언을 찾지 못함`);
  return m[0];
}

// 추출 모듈을 단독 스코프로 되살린다. HOST/document/__offExportBusy/dbCatalog/dbCustomers는 주입.
function makeExportCtx(env) {
  const e = env || {};
  const body =
    'const HOST = __env.HOST;\n' +
    'const document = __env.document;\n' +
    'let __offExportBusy = !!__env.busy;\n' +
    'let dbCatalog = __env.dbCatalog || [];\n' +
    'let dbCustomers = __env.dbCustomers || [];\n' +
    // 캐시 제거(2026-07-24) 후 버튼/툴팁이 '연결 안 됨'을 구분하므로 온라인 여부도 주입한다(기본 true).
    'let dbOnline = (__env.dbOnline !== false);\n' +
    constLine('offTrim') + '\n' +
    constLine('offNorm') + '\n' +
    constLine('OFF_SECTIONS') + '\n' +
    constLine('OFF_NO_STATUS') + '\n' +
    constLine('OFF_EXPORT_SCOPE_NOTE') + '\n' +
    extractFunction(src, 'offDate') + '\n' +
    extractFunction(src, 'offSectionOf') + '\n' +
    extractFunction(src, 'offGroups') + '\n' +
    extractFunction(src, 'offExportRow') + '\n' +
    extractFunction(src, 'offExportRows') + '\n' +
    extractFunction(src, 'offExportFilterSummary') + '\n' +
    extractFunction(src, 'offExportSubtitle') + '\n' +
    extractFunction(src, 'offSyncExportBtn') + '\n' +
    extractFunction(src, 'offCustomerExportList') + '\n' +
    'return { offExportRow, offExportRows, offExportFilterSummary, offExportSubtitle, offSyncExportBtn, ' +
    'offCustomerExportList, OFF_NO_STATUS, OFF_EXPORT_SCOPE_NOTE };';
  return new Function('__env', body)(e);
}

const X = makeExportCtx({ HOST: true, document: { getElementById: () => null } });

// ── 필터 요약 문자열 ───────────────────────────────────────────────────
// 목적: 파일만 봐도 '일부만 뽑혔다'를 알 수 있어야 한다.

test('추출 필터 요약: 아무 필터도 없으면 "필터 없음"', () => {
  assert.strictEqual(
    X.offExportFilterSummary({ q: '', qRaw: '', customer: '', section: '', status: '', activeOnly: false }),
    '필터 없음');
  assert.strictEqual(X.offExportFilterSummary(null), '필터 없음');   // 방어 — 크래시 금지
});

test('추출 필터 요약: 필터 1개 — 구분만', () => {
  assert.strictEqual(
    X.offExportFilterSummary({ q: '', qRaw: '', customer: '', section: '일반계약', status: '', activeOnly: false }),
    '필터: 구분=일반계약');
});

// ★ 화면 체크박스 라벨은 '진행중만'이지만 offMatches의 실제 조건은 status !== '종료'다.
//   화면은 사용자가 눈으로 보정하지만 파일은 남에게 전달된다 — 미정·1차 납품완료가 섞인 목록에
//   '진행중만'이라고 적히면 받는 사람이 오해한다. 파일 표기는 '종료 제외'여야 한다.
test('추출 필터 요약: activeOnly는 "진행중만"이 아니라 "종료 제외"로 적는다(파일이 거짓말하지 않게)', () => {
  const s = X.offExportFilterSummary({ q: '', qRaw: '', customer: '', section: '', status: '', activeOnly: true });
  assert.strictEqual(s, '필터: 종료 제외');
  assert.ok(!s.includes('진행중만'), '화면 라벨을 그대로 쓰면 미정·1차 납품완료가 진행중으로 읽힌다');
});

test('추출 필터 요약: 복합(검색+구분+상태+발주처) — 구분·발주처·상태·종료 제외·검색 순서', () => {
  assert.strictEqual(
    X.offExportFilterSummary({ q: '레이더', qRaw: '레이더', customer: '방위사업청', section: '일반계약',
                               status: '진행중', activeOnly: true }),
    '필터: 구분=일반계약, 발주처=방위사업청, 상태=진행중, 종료 제외, 검색="레이더"');
});

test('추출 필터 요약: 검색어는 정규화본(q)이 아니라 사용자가 친 원문(qRaw)을 남긴다', () => {
  const s = X.offExportFilterSummary({ q: 'kf21레이더', qRaw: 'KF21 레이더', customer: '', section: '', status: '', activeOnly: false });
  assert.strictEqual(s, '필터: 검색="KF21 레이더"');
  // qRaw가 없는 옛 호출부(방어) → 정규화본으로 폴백
  assert.strictEqual(
    X.offExportFilterSummary({ q: 'kf21레이더', customer: '', section: '', status: '', activeOnly: false }),
    '필터: 검색="kf21레이더"');
});

test('추출 필터 요약: 상태 센티널(__none__)은 "상태=없음"으로 읽히게 번역', () => {
  assert.strictEqual(
    X.offExportFilterSummary({ q: '', qRaw: '', customer: '', section: '', status: X.OFF_NO_STATUS, activeOnly: false }),
    '필터: 상태=없음');
});

// ── 부제(xlsx 2행) ─────────────────────────────────────────────────────
// v2에서 제목("사업부 과제 목록")은 1행이고 호스트 상수다 — 부제에 제목을 되풀이하지 않는다.

test('추출 부제: 날짜·건수(전체 N건 중 M건)·필터 요약을 한 줄로(제목 반복 없음)', () => {
  const f = { q: '레이더', qRaw: '레이더', customer: '', section: '일반계약', status: '', activeOnly: false };
  assert.strictEqual(
    X.offExportSubtitle(f, 13, 5, '2026-07-22'),
    '2026-07-22 추출 · 전체 13건 중 5건 · 필터: 구분=일반계약, 검색="레이더" · 숨김 과제 제외');
});

test('추출 부제: 기본 상태(체크박스 ON) 그대로 뽑은 실제 모양', () => {
  const f = { q: '', qRaw: '', customer: '', section: '', status: '', activeOnly: true };
  assert.strictEqual(
    X.offExportSubtitle(f, 14, 9, '2026-07-22'),
    '2026-07-22 추출 · 전체 14건 중 9건 · 필터: 종료 제외 · 숨김 과제 제외');
});

test('추출 부제: 필터가 없어도 건수는 항상 적는다(전체=추출)', () => {
  const f = { q: '', qRaw: '', customer: '', section: '', status: '', activeOnly: false };
  assert.strictEqual(
    X.offExportSubtitle(f, 13, 13, '2026-07-22'),
    '2026-07-22 추출 · 전체 13건 중 13건 · 필터 없음 · 숨김 과제 제외');
});

// '사용여부' 열을 뺀 대신 이 문구가 그 정보를 진다 — 필터를 아무것도 안 걸어도 사라지면 안 된다.
test('추출 부제: "숨김 과제 제외"는 필터와 무관하게 상시 표기(모집단의 성질이지 필터가 아니다)', () => {
  const variants = [
    { q: '', qRaw: '', customer: '', section: '', status: '', activeOnly: false },
    { q: '', qRaw: '', customer: '', section: '', status: '', activeOnly: true },
    { q: 'x', qRaw: 'x', customer: 'A', section: '선진행', status: '미정', activeOnly: true },
  ];
  for (const f of variants) {
    assert.ok(X.offExportSubtitle(f, 5, 1, '2026-07-22').endsWith('· ' + X.OFF_EXPORT_SCOPE_NOTE),
      '부제 끝의 범위 표기가 사라짐');
  }
});

test('추출 부제: 건수 방어 — 숫자가 아니면 0으로(NaN이 파일에 박히지 않게)', () => {
  const f = { q: '', qRaw: '', customer: '', section: '', status: '', activeOnly: false };
  assert.ok(X.offExportSubtitle(f, undefined, null, '2026-07-22').includes('전체 0건 중 0건'));
});

// ── 행 매핑 ────────────────────────────────────────────────────────────

test('추출 행 매핑: null/빈 계약명·통상명칭·상태는 빈 문자열("null" 금지)', () => {
  const r = X.offExportRow({
    section: '일반계약', customer: '방위사업청', projectName: '  레이더 성능개량  ',
    contractName: null, commonName: undefined, status: '',
    startDate: '2026-01-01', endDate: '2026-12-31',
  });
  assert.strictEqual(r.contractName, '');
  assert.strictEqual(r.commonName, '');
  assert.strictEqual(r.status, '');
  assert.strictEqual(r.projectName, '레이더 성능개량');   // 앞뒤 공백 제거
});

// '사용여부' 열은 제거됐다 — 호스트 질의가 is_active=1만 읽어 전 행이 "사용"인 상수 열이 되기 때문.
// 되살아나면 장표에 노이즈 열이 다시 나가므로 못박는다(정보는 부제의 '숨김 과제 제외'가 진다).
test('추출 행 매핑: 상수 열이던 사용여부(active)는 행에 담지 않는다', () => {
  assert.strictEqual('active' in X.offExportRow({ active: false }), false);
  assert.strictEqual('active' in X.offExportRow({}), false);
  assert.strictEqual(Object.keys(X.offExportRow({})).length, 8);
  assert.doesNotThrow(() => X.offExportRow(null));   // 방어 — 크래시 금지
});

// 연번(No)은 배열 순서에서 나온다 — 웹이 만들면 필터·정렬이 바뀔 때마다 어긋난다.
test('추출 행 매핑: 연번(No)은 웹이 만들지 않는다(호스트가 배열 순서로 채운다)', () => {
  const keys = Object.keys(X.offExportRow({}));
  assert.ok(!keys.some(k => /^(no|No|seq|index)$/.test(k)), '웹이 연번을 만들면 호스트 연번과 이중 소스가 된다');
});

test('추출 행 매핑: 날짜는 YYYY-MM-DD 앞부분만, 비거나 형식이 아니면 빈 문자열', () => {
  assert.strictEqual(X.offExportRow({ startDate: '2026-03-04T00:00:00' }).startDate, '2026-03-04');
  assert.strictEqual(X.offExportRow({ endDate: '' }).endDate, '');
  assert.strictEqual(X.offExportRow({ endDate: null }).endDate, '');
  assert.strictEqual(X.offExportRow({ startDate: '미정' }).startDate, '미정');   // 형식 아님 → 호스트가 빈 셀로 처리
});

test('추출 행 매핑: 값은 전부 문자열(호스트가 문자열만 읽는다)', () => {
  const r = X.offExportRow({ section: '선진행', customer: 1234, projectName: 0 });
  for (const [k, v] of Object.entries(r)) assert.strictEqual(typeof v, 'string', `${k}가 문자열이 아님`);
});

test('추출 행 순서: 화면과 같은 구분 그룹 순(ENUM 순) → 그룹 안은 이름순', () => {
  const list = [
    { name: '나과제', projectName: '나과제', section: '선진행' },
    { name: '가과제', projectName: '가과제', section: '일반계약' },
    { name: '다과제', projectName: '다과제', section: '일반계약' },
  ];
  assert.deepStrictEqual(X.offExportRows(list).map(r => r.projectName), ['가과제', '다과제', '나과제']);
});

// ── 버튼 상태 ──────────────────────────────────────────────────────────

function fakeBtn() { return { style: {}, disabled: false, textContent: '', title: '' }; }
function ctxWithBtn(btn, env) {
  return makeExportCtx(Object.assign({ HOST: true, document: { getElementById: id => (id === 'offExport' ? btn : null) } }, env || {}));
}

test('추출 버튼: 결과 0건이면 비활성(빈 파일 뽑기 방지)', () => {
  const b = fakeBtn();
  ctxWithBtn(b).offSyncExportBtn(0);
  assert.strictEqual(b.disabled, true);
  ctxWithBtn(b).offSyncExportBtn(5);
  assert.strictEqual(b.disabled, false);
  assert.strictEqual(b.textContent, '⬇ Excel 추출');
});

test('추출 버튼: 브라우저 모드(HOST=false)에서는 숨김 — 호스트만 파일을 쓸 수 있다', () => {
  const b = fakeBtn();
  ctxWithBtn(b, { HOST: false }).offSyncExportBtn(5);
  assert.strictEqual(b.style.display, 'none');
  const b2 = fakeBtn();
  ctxWithBtn(b2, { HOST: true }).offSyncExportBtn(5);
  assert.strictEqual(b2.style.display, '');
});

test('추출 버튼: 진행 중에는 렌더가 라벨/비활성 상태를 되돌리지 않는다', () => {
  const b = fakeBtn();
  b.disabled = true; b.textContent = '추출 중…';
  ctxWithBtn(b, { busy: true }).offSyncExportBtn(5);
  assert.strictEqual(b.disabled, true);
  assert.strictEqual(b.textContent, '추출 중…');
});

// ── 웹 ↔ 호스트 계약(드리프트 가드) ────────────────────────────────────
// 컬럼 정의의 단일 소스는 호스트(MainWindow.xaml.cs의 ProjectExportCols)다.
// 웹은 값만 만들고 순서·제목·너비를 모른다 — 대신 '키 집합'이 어긋나면 열이 통째로 비므로 여기서 잡는다.

function hostSource() {
  return readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
}

function hostExportCols() {
  const cs = hostSource();
  const start = cs.indexOf('ProjectExportCols =');
  assert.ok(start >= 0, 'ProjectExportCols 정의를 찾지 못함');
  const end = cs.indexOf('};', start);
  const block = cs.slice(start, end);
  // ("헤더", "field", 너비, XlsxWriter.Align.X, isDate, wrap)
  return [...block.matchAll(/\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*([\d.]+)\s*,\s*XlsxWriter\.Align\.(\w+)\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/g)]
    .map(m => ({ header: m[1], field: m[2], width: Number(m[3]), align: m[4], isDate: m[5] === 'true', wrap: m[6] === 'true' }));
}

test('추출 계약(v2): 호스트 컬럼 정의는 9개 · No→구분→발주처→사업명→통상명칭→계약명→시작일→종료일→상태', () => {
  const cols = hostExportCols();
  assert.deepStrictEqual(cols.map(c => c.header),
    ['No', '구분', '발주처', '사업명', '통상명칭', '계약명', '시작일', '종료일', '상태']);
  assert.ok(!cols.some(c => c.header === '사용여부'), '상수 열(사용여부)이 되살아났다');
});

test('추출 계약(v2): 웹이 만드는 행의 키 집합 = 호스트가 읽는 필드 집합(No는 호스트 전용이라 제외)', () => {
  const cols = hostExportCols();
  const fields = cols.map(c => c.field).filter(Boolean);   // Field 빈 문자열 = 연번(웹이 안 보냄)
  const keys = Object.keys(X.offExportRow({}));
  assert.deepStrictEqual([...keys].sort(), [...fields].sort());
  assert.strictEqual(cols.filter(c => !c.field).length, 1, '연번 열은 정확히 하나(Field 빈 문자열)');
  assert.strictEqual(cols[0].field, '', '연번은 첫 열이어야 한다');
});

test('추출 계약(v2): 날짜열은 시작일·종료일 둘뿐(나머지는 문자열 셀)', () => {
  const dateFields = hostExportCols().filter(c => c.isDate).map(c => c.field);
  assert.deepStrictEqual(dateFields, ['startDate', 'endDate']);
});

test('추출 계약(v2): 정렬·줄바꿈 — 긴 문장 열(사업명·계약명)만 wrap, 날짜·상태·구분·No는 가운데', () => {
  const cols = hostExportCols();
  assert.deepStrictEqual(cols.filter(c => c.wrap).map(c => c.header), ['사업명', '계약명']);
  assert.deepStrictEqual(cols.filter(c => c.align === 'Center').map(c => c.header),
    ['No', '구분', '시작일', '종료일', '상태']);
});

test('추출 계약(v2): 상태색 규칙은 호스트(도메인)에만 있고 XlsxWriter엔 없다', () => {
  const cs = hostSource();
  const start = cs.indexOf('ProjectStatusAccents');
  assert.ok(start >= 0, 'ProjectStatusAccents 정의를 찾지 못함');
  const block = cs.slice(start, cs.indexOf('};', start));
  const keys = [...block.matchAll(/\["([^"]+)"\]\s*=\s*new XlsxWriter\.Accent\("([0-9A-Fa-f]{8})",\s*"([0-9A-Fa-f]{8})"\)/g)]
    .map(m => ({ k: m[1], fill: m[2], font: m[3] }));
  assert.deepStrictEqual(keys.map(x => x.k), ['진행중', '1차 납품완료', '종료']);
  assert.deepStrictEqual(keys.map(x => x.fill), ['FFE8F3EC', 'FFE9F0FA', 'FFF0F1F3']);
  assert.deepStrictEqual(keys.map(x => x.font), ['FF1E7A45', 'FF1F5FA8', 'FF6B7280']);
  // 도메인 지식 격리 — XlsxWriter는 '어떤 상태가 무슨 색'인지 알면 안 된다(주석은 설명이므로 제외하고 검사).
  const w = xlsxWriterSource().replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const k of ['진행중', '1차 납품완료', 'FFE8F3EC', 'FFE9F0FA', 'FFF0F1F3'])
    assert.ok(!w.includes(k), `XlsxWriter에 도메인 값('${k}')이 하드코딩됐다 — Doc.Accents로 넘길 것`);
});

// ── XlsxWriter 구조 불변식(Excel '복구' 대화상자 회귀 방지) ─────────────
// 파일을 실제로 열어보는 건 빌드가 필요하므로, 여기서는 깨지기 쉬운 규칙 셋만 소스에서 못박는다.

function xlsxWriterSource() {
  return readFileSync(new URL('../widget/XlsxWriter.cs', import.meta.url), 'utf8');
}

test('XlsxWriter: fills는 0=none, 1=gray125로 시작해야 한다(Excel 하드 요구)', () => {
  const cs = xlsxWriterSource();
  // v2는 fills를 StyleBook이 동적으로 쌓는다 → '생성자에서 none, gray125 순으로 먼저 등록'을 검사한다.
  const ctor = cs.slice(cs.indexOf('public StyleBook(Doc doc)'), cs.indexOf('private static int Intern'));
  const none = ctor.indexOf('patternType=\\"none\\"');
  const gray = ctor.indexOf('patternType=\\"gray125\\"');
  assert.ok(none >= 0 && gray >= 0, 'none/gray125 기본 fill 등록을 찾지 못함');
  assert.ok(none < gray, 'fills[0]=none, fills[1]=gray125 순서가 어긋났다');
  // count는 손으로 세지 않고 실제 개수를 쓴다(Emit) — 상수 리터럴로 되돌아가면 어긋난다.
  assert.ok(/Emit\(sb, "fills", _fills\)/.test(cs), 'fills count가 자동 산출(Emit)이 아니다');
  assert.ok(/items\.Count/.test(cs), 'count 속성이 실제 개수에서 나오지 않는다');
});

test('XlsxWriter: 커스텀 날짜 서식은 numFmtId 164 이상(0~163은 예약)', () => {
  const cs = xlsxWriterSource();
  const m = /CustomNumFmtId\s*=\s*(\d+)/.exec(cs);
  assert.ok(m, 'CustomNumFmtId 선언을 찾지 못함');
  assert.ok(Number(m[1]) >= 164, `numFmtId ${m[1]}은 예약 구간 — 164 이상을 쓸 것`);
});

test('XlsxWriter(v2): worksheet 자식 순서 고정 — sheetPr→dimension→sheetViews→sheetFormatPr→cols→sheetData→autoFilter→mergeCells→pageMargins→pageSetup→headerFooter', () => {
  const cs = xlsxWriterSource();
  const at = (needle) => {
    const i = cs.indexOf(needle);
    assert.ok(i >= 0, `${needle} 를 찾지 못함`);
    return i;
  };
  const order = ['<sheetPr>', '<dimension ref=', '<sheetViews>', '<sheetFormatPr ', '<cols>', '<sheetData>',
                 '</sheetData>', '<autoFilter ref=', '<mergeCells count=', '<pageMargins ', '<pageSetup ',
                 '<headerFooter>'].map(at);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], 'worksheet 자식 요소 기록 순서가 어긋남(스키마 위반 = Excel 복구 대화상자)');
  }
});

test('XlsxWriter(v2): 병합 2개(제목·부제)와 앵커 셀 기록 — 병합만 하고 값을 안 쓰면 사라진다', () => {
  const cs = xlsxWriterSource();
  assert.ok(/mergeCells count=\\"2\\"/.test(cs), '제목·부제 병합 2개가 아니다');
  assert.ok(/AppendTextCell\(sb, "A" \+ TitleRow/.test(cs), '제목 앵커 셀(A1)을 쓰지 않는다');
  assert.ok(/AppendTextCell\(sb, "A" \+ SubtitleRow/.test(cs), '부제 앵커 셀(A2)을 쓰지 않는다');
});

test('XlsxWriter(v2): 커스텀 행 높이는 customHeight="1"과 함께 쓴다(없으면 Excel이 무시)', () => {
  const cs = xlsxWriterSource();
  const rows = [...cs.matchAll(/Append\("<row r=[^;]*?;/gs)].map(m => m[0]);
  assert.ok(rows.length > 0, '<row> 기록부를 찾지 못함');
  for (const r of rows) {
    if (!/ht=/.test(r)) continue;
    assert.ok(/customHeight=\\"1\\"/.test(r), '높이를 지정하면서 customHeight="1"이 없다: ' + r.slice(0, 80));
  }
});

test('XlsxWriter(v2): 인쇄 설정 — 가로·너비 1페이지 맞춤·fitToPage·페이지 번호 바닥글', () => {
  const cs = xlsxWriterSource();
  assert.ok(/<pageSetUpPr fitToPage=\\"1\\"\/>/.test(cs), 'sheetPr의 fitToPage가 없으면 fitToWidth가 무시된다');
  assert.ok(/orientation=\\"landscape\\"/.test(cs), '가로 방향이 아니다');
  assert.ok(/fitToWidth=\\"1\\" fitToHeight=\\"0\\"/.test(cs), '너비 1페이지 맞춤이 아니다');
  assert.ok(/oddFooter/.test(cs), '바닥글 기록부가 없다');
  assert.ok(/OddFooter \{ get; set; \} = "&C&P \/ &N"/.test(cs), '기본 바닥글이 페이지 번호가 아니다');
});

test('XlsxWriter(v2): 헤더행 반복 인쇄(_xlnm.Print_Titles) — RepeatHeaderRow 시트만, localSheetId=0-based 인덱스', () => {
  const cs = xlsxWriterSource();
  assert.ok(/_xlnm\.Print_Titles/.test(cs), 'Print_Titles definedName이 없다');
  // localSheetId는 <sheets> 0-based 인덱스(루프 변수 i)에서 나와야 한다 — 시트 지역 이름.
  assert.ok(/localSheetId=\\""\)\.Append\(i\)/.test(cs), 'localSheetId가 시트 인덱스(i)에서 나오지 않는다');
  // RepeatHeaderRow가 false인 시트는 건너뛴다(작은 발주처 시트엔 불필요).
  assert.ok(/if \(!sheets\[i\]\.RepeatHeaderRow\) continue;/.test(cs), 'RepeatHeaderRow 게이팅이 없다');
  // 반복 행 번호는 레이아웃 상수(HeaderRow)에서 나와야 한다 — 숫자를 박으면 레이아웃 변경 시 어긋난다.
  assert.ok(/Append\(HeaderRow\)\.Append\(":\$"\)\.Append\(HeaderRow\)/.test(cs), '반복 인쇄 행이 HeaderRow 상수에서 나오지 않는다');
  // definedNames는 sheets 뒤(CT_Workbook 순서)
  assert.ok(cs.indexOf('<sheets>') < cs.indexOf('<definedNames>'), 'definedNames가 sheets보다 앞에 있다');
});

test('XlsxWriter(v2): 데이터 셀은 값이 비어도 생략하지 않는다(테두리·줄무늬가 빠져 표가 깨진다)', () => {
  const cs = xlsxWriterSource();
  assert.ok(/AppendBlankCell/.test(cs), '빈 셀 기록 경로가 없다');
  assert.ok(/else AppendBlankCell\(sb, reference, style\);/.test(cs), '문자열이 비면 셀을 통째로 건너뛴다');
});

test('XlsxWriter(v2): 스타일 조합은 캐시로 재사용한다(cellXfs 폭발 방지)', () => {
  const cs = xlsxWriterSource();
  assert.ok(/cache\.TryGetValue\(key, out int v\)/.test(cs), '데이터 셀 스타일 캐시가 없다');
  assert.ok(/index\.TryGetValue\(xml, out int i\)/.test(cs), 'font/fill/border 인터닝이 없다');
});

// ── 행 높이 자동 계산 ──────────────────────────────────────────────────
// 고정 높이 + wrapText는 2줄 이상인 행에서 글자가 눌려 잘린다(LibreOffice 렌더로 실측 확인된 결함).
// 아래 참조 구현은 C# 원본의 '상수와 전각 판정 구간을 소스에서 직접 뽑아' 구동한다 —
// 즉 C#에서 계수·상한·유니코드 구간을 바꾸면 이 테스트의 기대값이 함께 움직이거나 파싱이 깨진다(드리프트 가드).
// (호출 자체를 검증하는 건 아니다. 실제 렌더 판정은 xlsx-sample 실행 산출물로 한다.)
function heightSpec() {
  const cs = xlsxWriterSource();
  const num = (re, what) => {
    const m = re.exec(cs);
    assert.ok(m, `${what} 를 소스에서 찾지 못함`);
    return Number(m[1]);
  };
  const bool = (re, what) => {
    const m = re.exec(cs);
    assert.ok(m, `${what} 를 소스에서 찾지 못함`);
    return m[1] === 'true';
  };
  // 전각 판정 구간(BMP) — IsWide 식에서 그대로 파싱
  const wideStart = cs.indexOf('private static bool IsWide(char c) =>');
  assert.ok(wideStart >= 0, 'IsWide 선언을 찾지 못함');
  const wideBlock = cs.slice(wideStart, cs.indexOf(';', wideStart));
  const bmp = [...wideBlock.matchAll(/c >= '\\u([0-9A-Fa-f]{4})' && c <= '\\u([0-9A-Fa-f]{4})'/g)]
    .map(m => [parseInt(m[1], 16), parseInt(m[2], 16)]);
  assert.ok(bmp.length >= 8, `전각 구간이 ${bmp.length}개 — 한글·CJK·전각 구간이 빠졌다`);
  // 보충 평면(이모지·CJK 확장)
  const cpStart = cs.indexOf('private static bool IsWideCodePoint(int cp) =>');
  const cpBlock = cs.slice(cpStart, cs.indexOf(';', cpStart));
  const astral = [...cpBlock.matchAll(/cp >= 0x([0-9A-Fa-f]+) && cp <= 0x([0-9A-Fa-f]+)/g)]
    .map(m => [parseInt(m[1], 16), parseInt(m[2], 16)]);
  assert.ok(astral.length >= 1, '보충 평면(이모지) 구간이 없다');

  return {
    perUnit: num(/WrapCharsPerWidthUnit\s*=\s*([\d.]+)/, 'WrapCharsPerWidthUnit'),
    base: num(/DataRowHeight \{ get; set; \} = ([\d.]+)/, 'DataRowHeight'),
    lineH: num(/WrapLineHeight \{ get; set; \} = ([\d.]+)/, 'WrapLineHeight'),
    maxLines: num(/MaxWrapLines \{ get; set; \} = (\d+)/, 'MaxWrapLines'),
    autoDefault: bool(/AutoRowHeight \{ get; set; \} = (true|false)/, 'AutoRowHeight'),
    bmp, astral,
  };
}
const H = heightSpec();

// C#의 DisplayWidth 참조 구현 — 전각 구간은 위에서 소스로부터 뽑은 표를 그대로 쓴다.
function displayWidth(text) {
  if (!text) return 0;
  let w = 0;
  for (const ch of String(text)) {         // for..of = 코드포인트 단위(서러게이트 쌍 자동 결합)
    const cp = ch.codePointAt(0);
    const table = cp > 0xFFFF ? H.astral : H.bmp;
    w += table.some(([a, b]) => cp >= a && cp <= b) ? 2 : 1;
  }
  return w;
}
function estimateWrapLines(text, colWidth, maxLines) {
  if (maxLines < 1) maxLines = 1;
  if (!text) return 1;
  let perLine = colWidth * H.perUnit;
  if (perLine < 1) perLine = 1;
  let total = 0;
  for (const seg of String(text).split('\n')) {
    const n = Math.ceil(displayWidth(seg.replace(/\r+$/, '')) / perLine);
    total += n < 1 ? 1 : n;
    if (total >= maxLines) return maxLines;
  }
  return total < 1 ? 1 : total;
}
// cols = [{width, wrap}], cells = [문자열]
function dataRowHeight(cols, cells, auto = true) {
  if (!auto) return H.base;
  let lines = 1;
  for (let i = 0; i < cols.length; i++) {
    if (!cols[i].wrap) continue;
    const n = estimateWrapLines(cells[i] || '', cols[i].width, H.maxLines);
    if (n > lines) lines = n;
  }
  return H.base + (lines - 1) * H.lineH;
}

test('행 높이: 기본값 — 자동 계산 ON · 기준 20 · 줄당 +15 · 최대 3줄 · 계수 1.35', () => {
  assert.strictEqual(H.autoDefault, true);
  assert.strictEqual(H.base, 20);
  assert.strictEqual(H.lineH, 15);
  assert.strictEqual(H.maxLines, 3);
  assert.strictEqual(H.perUnit, 1.35);
  // 렌더 실측으로 좁혀진 허용 구간 [1.20, 1.50). 벗어나면 아래 회귀 케이스들이 깨진다.
  // (2에 가까운 값 = CJK 폭 이중 계산 → 잘림 재발 / 1 이하 = 짧은 행까지 부풀어 표가 헐거워짐)
  assert.ok(H.perUnit >= 1.20 && H.perUnit < 1.50, '계수가 실측 허용 구간을 벗어남');
});

test('행 높이: 표시폭 — 한글·CJK·전각·이모지는 2, ASCII는 1', () => {
  assert.strictEqual(displayWidth('abcd'), 4);
  assert.strictEqual(displayWidth('레이더'), 6);            // 한글 3자 = 6
  assert.strictEqual(displayWidth('레이더 A'), 8);          // 6 + 공백1 + A1
  assert.strictEqual(displayWidth('漢字'), 4);              // CJK 통합한자
  assert.strictEqual(displayWidth('ＡＢ'), 4);              // 전각 영문
  assert.strictEqual(displayWidth('🛰'), 2);                // 서러게이트 쌍 1글자 = 2
  assert.strictEqual(displayWidth(''), 0);
  assert.strictEqual(displayWidth(null), 0);
});

test('행 높이: 줄 수 추정 — 1줄/2줄/3줄 (열 너비 40 → 줄당 표시폭 54)', () => {
  const W = 40;   // 사업명 열 너비. 40 * 1.35 = 54 표시폭/줄
  assert.strictEqual(estimateWrapLines('a'.repeat(54), W, 3), 1);   // 딱 맞음
  assert.strictEqual(estimateWrapLines('a'.repeat(55), W, 3), 2);   // 한 글자 초과 → 2줄
  assert.strictEqual(estimateWrapLines('가'.repeat(27), W, 3), 1);  // 한글 27자 = 표시폭 54
  assert.strictEqual(estimateWrapLines('가'.repeat(28), W, 3), 2);  // 56 → 2줄
  assert.strictEqual(estimateWrapLines('가'.repeat(60), W, 3), 3);  // 120/54 = 2.2 → 3줄
});

test('행 높이: 상한 초과는 최대 줄 수로 자른다(긴 값 하나가 표를 망치지 않게)', () => {
  const W = 40;
  assert.strictEqual(estimateWrapLines('가'.repeat(500), W, 3), 3);
  assert.strictEqual(estimateWrapLines('a'.repeat(5000), W, 3), 3);
  assert.strictEqual(estimateWrapLines('가'.repeat(500), W, 1), 1);   // 상한 1이면 언제나 1줄
});

test('행 높이: 빈 값·개행 — 빈 문자열은 1줄, \\n은 강제 줄바꿈으로 센다', () => {
  assert.strictEqual(estimateWrapLines('', 40, 3), 1);
  assert.strictEqual(estimateWrapLines(null, 40, 3), 1);
  assert.strictEqual(estimateWrapLines('짧게\n짧게', 40, 3), 2);
  assert.strictEqual(estimateWrapLines('짧게\n짧게\n짧게\n짧게', 40, 3), 3);   // 상한 적용
});

test('행 높이: Wrap=false 열은 아무리 길어도 높이에 영향을 주지 않는다', () => {
  const cols = [
    { width: 40, wrap: true },    // 사업명
    { width: 20, wrap: false },   // 통상명칭 — 길어도 한 줄로 잘려 보인다
  ];
  assert.strictEqual(dataRowHeight(cols, ['짧은 사업명', '가'.repeat(300)]), 20);
  assert.strictEqual(dataRowHeight(cols, ['가'.repeat(28), '']), 35);   // wrap 열이 2줄 → 20+15
});

test('행 높이: 여러 Wrap 열 중 가장 많은 줄 수를 기준으로 한다', () => {
  const cols = [
    { width: 40, wrap: true },    // 사업명 — 줄당 54
    { width: 34, wrap: true },    // 계약명 — 줄당 45.9
  ];
  assert.strictEqual(dataRowHeight(cols, ['짧게', '짧게']), 20);                      // 둘 다 1줄
  assert.strictEqual(dataRowHeight(cols, ['짧게', '가'.repeat(24)]), 35);             // 계약명만 2줄(48/45.9)
  assert.strictEqual(dataRowHeight(cols, ['가'.repeat(60), '짧게']), 50);             // 사업명 3줄 → 20+30
  assert.strictEqual(dataRowHeight(cols, ['가'.repeat(28), '가'.repeat(100)]), 50);   // 큰 쪽(3줄) 채택
});

// ★ 계수 보정(캘리브레이션) 회귀 — LibreOffice로 실제 렌더한 샘플의 '관측된 줄 수'를 그대로 못박는다.
//   [사업명(너비 40), 계약명(너비 34), 관측 줄 수(사업명, 계약명)]
//   계수를 2 근처로 되돌리면 잘렸던 3셀이 다시 1줄로, 1 이하로 내리면 짧은 셀들이 2줄로 부푼다 — 양쪽 다 여기서 걸린다.
const RENDERED = [
  ['함정용 다기능 위상배열 레이더 성능개량 사업 <2차> & 후속 군수지원 포함',
   '함정용 다기능 위상배열 레이더 성능개량 사업 본계약(2026~2028) 및 부속 합의서', 2, 2],   // ← 잘렸던 행
  ['"따옴표" & <꺾쇠> 시험제어문자 혼입', '계약-2', 1, 1],
  ['지상전술 C4I 체계 성능개량', '지상전술 C4I 체계 성능개량 3차 양산 계약', 1, 1],
  ['위성 🛰 통신 체계 핵심기술 선행연구', '위성 통신 체계 핵심기술 선행연구 위탁계약서(선진행)', 1, 2],   // ← 잘렸던 셀
  ['무인수상정 자율운항 알고리즘 시험평가 지원', '', 1, 1],
  ['사업부 공통 인프라 운영', '사업부 공통 인프라 연간 운영 계약', 1, 1],
  ['상태·발주처·계약명이 모두 빈 행(빈 셀 서식 확인)', '', 1, 1],
  ['차기 사업 제안서 작성 지원', '차기 사업 제안서 작성 지원 용역', 1, 1],
  ['휴대용 표적지시기 후속 양산', '휴대용 표적지시기 후속 양산 계약(2026)', 1, 1],
  ['적외선 탐색추적장비 시제 개발', '적외선 탐색추적장비 시제 개발 계약', 1, 1],
];

test('행 높이: 렌더 실측 줄 수와 추정이 18개 셀 전부 일치(계수 캘리브레이션 고정)', () => {
  for (const [project, contract, pl, cl] of RENDERED) {
    assert.strictEqual(estimateWrapLines(project, 40, 3), pl, `사업명 줄 수 불일치: ${project.slice(0, 24)}`);
    if (contract) assert.strictEqual(estimateWrapLines(contract, 34, 3), cl, `계약명 줄 수 불일치: ${contract.slice(0, 24)}`);
  }
});

test('행 높이: 잘렸던 행은 높아지고(>20), 나머지 행은 그대로(20)', () => {
  const cols = [{ width: 40, wrap: true }, { width: 34, wrap: true }];
  for (const [project, contract, pl, cl] of RENDERED) {
    const h = dataRowHeight(cols, [project, contract]);
    const expected = 20 + (Math.max(pl, contract ? cl : 1) - 1) * 15;
    assert.strictEqual(h, expected, `행 높이 불일치: ${project.slice(0, 24)}`);
  }
  // 잘렸던 두 행만 커지고, 짧은 행 8개는 기본 높이 유지(= '일괄 상향'을 기각한 이유가 지켜짐)
  const heights = RENDERED.map(([p, c]) => dataRowHeight(cols, [p, c]));
  assert.strictEqual(heights.filter(h => h === 20).length, 8);
  assert.strictEqual(heights.filter(h => h > 20).length, 2);
});

test('행 높이: AutoRowHeight를 끄면 전 행이 기준 높이 고정', () => {
  const cols = [{ width: 40, wrap: true }];
  assert.strictEqual(dataRowHeight(cols, ['가'.repeat(300)], false), 20);
});

// C# 쪽 배선 — 계산식·게이팅·호출부가 실제로 존재하는지(참조 구현만 맞고 본체가 안 붙는 사고 방지)
test('XlsxWriter(v2): 행 높이 계산이 데이터행에 실제로 연결돼 있다', () => {
  const cs = xlsxWriterSource();
  assert.ok(/OpenRow\(sb, rowNum, DataRowHeightFor\(doc, cols, cells\)\)/.test(cs),
    '데이터행이 여전히 고정 높이(doc.DataRowHeight)를 쓴다');
  assert.ok(/doc\.DataRowHeight \+ \(lines - 1\) \* doc\.WrapLineHeight/.test(cs), '행 높이 계산식이 다르다');
  assert.ok(/if \(!cols\[i\]\.Wrap\) continue;/.test(cs), 'Wrap=false 열을 건너뛰지 않는다');
  assert.ok(/Math\.Ceiling\(w \/ perLine\)/.test(cs), '줄 수 올림 계산이 없다');
  assert.ok(/if \(total >= maxLines\) return maxLines;/.test(cs), '줄 수 상한이 적용되지 않는다');
  // 제목·부제·여백·헤더는 고정 높이 그대로(자동 계산 대상이 아니다)
  assert.ok(/OpenRow\(sb, TitleRow, doc\.TitleRowHeight\)/.test(cs), '제목행이 고정 높이가 아니다');
  assert.ok(/OpenRow\(sb, HeaderRow, doc\.HeaderRowHeight\)/.test(cs), '헤더행이 고정 높이가 아니다');
});

test('XlsxWriter: 문자열 셀은 sharedStrings 없이 inlineStr로 쓴다 + 고정 파트 5 + 시트 N개 루프', () => {
  const cs = xlsxWriterSource();
  assert.ok(cs.includes('t=\\"inlineStr\\"'), 'inlineStr 셀 기록이 없음');
  assert.ok(!cs.includes('sharedStrings.xml'), 'sharedStrings 파트가 늘었다 — Content_Types/rels도 함께 손봐야 한다');
  // 다중 시트: 고정 5개(Content_Types·.rels·workbook·workbook.rels·styles) + 워크시트는 루프로 sheet{i}.xml.
  // 동적(워크시트) 엔트리는 확장자 없이 잘리므로 완결된 파트명(.xml/.rels)만 추린다.
  const entries = [...cs.matchAll(/AddEntry\(zip, "([^"]+)"/g)].map(m => m[1]).filter(e => /\.(xml|rels)$/.test(e));
  assert.deepStrictEqual(entries, [
    '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
  ]);
  assert.ok(/AddEntry\(zip, "xl\/worksheets\/sheet" \+ \(i \+ 1\) \+ "\.xml"/.test(cs),
    '워크시트 파트를 시트 수만큼 루프로 쓰지 않는다');
});

// ── 다중 시트(2시트) 구조 불변식 ────────────────────────────────────────
// [Content_Types] Override·workbook <sheets>·workbook.rels(styles+worksheet 충돌 없음)가 시트 수에 맞게 일반화됐는지.
test('XlsxWriter(다중): Content_Types는 워크시트 파트마다 Override(루프)', () => {
  const cs = xlsxWriterSource();
  assert.ok(/for \(int i = 1; i <= sheetCount; i\+\+\)/.test(cs), 'Content_Types가 시트 수 루프로 Override를 쓰지 않는다');
  assert.ok(/\/xl\/worksheets\/sheet"\)\.Append\(i\)/.test(cs), '워크시트 Override PartName이 i에서 나오지 않는다');
});

test('XlsxWriter(다중): workbook <sheets> — sheetId 1..N, r:id rId1..rIdN(0-based 인덱스와 정합)', () => {
  const cs = xlsxWriterSource();
  // <sheet name sheetId=(i+1) r:id=rId(i+1)>
  assert.ok(/sheetId=\\""\)\.Append\(i \+ 1\)\.Append\("\\" r:id=\\"rId"\)\.Append\(i \+ 1\)/.test(cs),
    'sheetId/rId가 시트 인덱스와 정합하지 않는다');
});

test('XlsxWriter(다중): workbook.rels — 워크시트 rId1..rIdN + styles=rId(N+1)로 충돌 없이 배치', () => {
  const cs = xlsxWriterSource();
  // 워크시트 관계: rId(i) for i=1..N
  assert.ok(/for \(int i = 1; i <= sheetCount; i\+\+\)[\s\S]{0,220}Id=\\"rId"\)\.Append\(i\)[\s\S]{0,220}relationships\/worksheet/.test(cs),
    '워크시트 관계 rId가 1..N 루프가 아니다');
  // styles는 마지막 번호(N+1) — 워크시트 rId와 겹치지 않게.
  assert.ok(/Id=\\"rId"\)\.Append\(sheetCount \+ 1\)[\s\S]{0,220}relationships\/styles/.test(cs),
    'styles 관계가 rId(N+1)이 아니다(워크시트 rId와 충돌 위험)');
});

test('XlsxWriter(다중): Sheet마다 제목/부제를 쓴다(Doc이 아니라 sheet에서)', () => {
  const cs = xlsxWriterSource();
  assert.ok(/AppendTextCell\(sb, "A" \+ TitleRow, sheet\.Title/.test(cs), '제목이 sheet.Title에서 나오지 않는다');
  assert.ok(/AppendTextCell\(sb, "A" \+ SubtitleRow, sheet\.Subtitle/.test(cs), '부제가 sheet.Subtitle에서 나오지 않는다');
  // 시트별 필드는 Sheet로 옮겼다 — Doc의 옛 SheetName은 사라지고 Sheet엔 TabName이 있어야 한다.
  assert.ok(!/public string SheetName/.test(cs), 'Doc에 옛 SheetName이 남아 있다(Sheet.TabName으로 옮겨야 한다)');
  assert.ok(/public sealed class Sheet/.test(cs) && /public string TabName/.test(cs), 'Sheet 클래스/TabName이 없다');
});

test('XlsxWriter: 임시 파일에 쓰고 성공 시에만 목적지로 이동(깨진 파일 잔존 금지)', () => {
  const cs = xlsxWriterSource();
  assert.ok(/File\.Move\(tmp, path, true\)/.test(cs), '임시 파일 → 목적지 이동이 없음');
  assert.ok(/finally[\s\S]{0,200}File\.Delete\(tmp\)/.test(cs), '실패 시 임시 파일 정리(finally)가 없음');
});

// ── 시트2(발주처) 데이터 매핑 — 웹이 무엇을(활성 마스터·이름순), 호스트가 어떻게(번호) ──────────
test('발주처 시트: 활성 발주처를 이름순으로 뽑는다(마스터 우선)', () => {
  const ctx = makeExportCtx({
    HOST: true, document: { getElementById: () => null },
    dbCustomers: ['LIG넥스원', '방위사업청', '국방과학연구소'],
    dbCatalog: [{ customer: '한화시스템' }],   // 마스터가 있으면 카탈로그는 무시
  });
  assert.deepStrictEqual(ctx.offCustomerExportList(), ['국방과학연구소', '방위사업청', 'LIG넥스원']);
});

test('발주처 시트: 마스터가 비면 카탈로그에서 실제 쓰인 발주처로 폴백(빈 시트 방지)', () => {
  const ctx = makeExportCtx({
    HOST: true, document: { getElementById: () => null },
    dbCustomers: [],
    dbCatalog: [{ customer: '나사' }, { customer: '가사' }, { customer: '나사' }, { customer: '' }],
  });
  assert.deepStrictEqual(ctx.offCustomerExportList(), ['가사', '나사']);   // 중복 제거 + 이름순
});

test('발주처 시트: 중복·공백은 정리하고 이름순 정렬', () => {
  const ctx = makeExportCtx({
    HOST: true, document: { getElementById: () => null },
    dbCustomers: [' 방위사업청 ', '방위사업청', '', '  ', 'LIG넥스원'],
  });
  assert.deepStrictEqual(ctx.offCustomerExportList(), ['방위사업청', 'LIG넥스원']);
});

// 시트2 호스트 컬럼 계약(드리프트 가드) — 2열(No·발주처), 웹은 customers 문자열 배열을 보낸다.
test('발주처 시트 계약: 호스트 컬럼은 No·발주처 2열, 웹은 customers 배열을 payload로 보낸다', () => {
  const cs = hostSource();
  const start = cs.indexOf('CustomerExportColDefs()');
  assert.ok(start >= 0, 'CustomerExportColDefs를 찾지 못함');
  const block = cs.slice(start, cs.indexOf('};', start) > 0 ? cs.indexOf('};', start) : start + 400);
  const headers = [...block.matchAll(/new XlsxWriter\.Col\("([^"]*)"/g)].map(m => m[1]);
  assert.deepStrictEqual(headers, ['No', '발주처']);
  // 웹 payload에 customers가 실려야 호스트가 시트2를 만든다.
  assert.ok(/customers: offCustomerExportList\(\)/.test(src), '추출 payload에 customers가 없다(시트2가 비게 된다)');
  // 호스트는 customers 배열을 읽어 연번을 매긴다(웹이 번호를 만들지 않는다).
  assert.ok(/ReadCustomerExportRows/.test(cs), '호스트에 발주처 행 리더가 없다');
  assert.ok(/TryGetProperty\("customers", out var arr\)/.test(cs), '호스트가 customers 키를 읽지 않는다');
});

test('발주처 시트: 발주처가 0개면 시트2를 추가하지 않는다(빈 시트 방지)', () => {
  const cs = hostSource();
  assert.ok(/if \(customerRows != null && customerRows\.Count > 0\)/.test(cs),
    '발주처 0개일 때 시트2를 건너뛰는 가드가 없다');
});

test('발주처 시트: 시트2는 헤더 반복 인쇄 OFF(작아서 1페이지), 시트1은 ON', () => {
  const cs = hostSource();
  // 시트1(과제목록) RepeatHeaderRow=true
  assert.ok(/ProjectExportSheet[\s\S]{0,160}RepeatHeaderRow = true/.test(cs), '시트1 헤더 반복이 ON이 아니다');
  // 시트2(발주처) RepeatHeaderRow=false
  assert.ok(/CustomerExportSheet[\s\S]{0,160}RepeatHeaderRow = false/.test(cs), '시트2 헤더 반복이 OFF가 아니다');
});

// ── 발주처 CRUD 계약(ProjectDb ↔ 브리지 ↔ 웹) ────────────────────────────
function projectDbSource() {
  return readFileSync(new URL('../widget/ProjectDb.cs', import.meta.url), 'utf8');
}

test('발주처 CRUD: ProjectDb에 add/rename/setActive/refCount 4종 + 전체조회가 있다', () => {
  const db = projectDbSource();
  for (const m of ['AddCustomerAsync', 'RenameCustomerAsync', 'SetCustomerActiveAsync',
                   'CountActiveProjectsByCustomerAsync', 'LoadCustomersFullJsonAsync']) {
    assert.ok(new RegExp('public async Task[^\\n]*' + m).test(db), `${m}가 없다`);
  }
});

test('발주처 CRUD: add — 빈 이름 거부 · 1062는 활성/숨김 구분 안내', () => {
  const db = projectDbSource();
  const b = db.slice(db.indexOf('AddCustomerAsync'), db.indexOf('RenameCustomerAsync'));
  assert.ok(/발주처명을 입력하세요/.test(b), '빈 이름 거부 문구가 없다');
  assert.ok(/mex\.Number == 1062/.test(b), '중복(1062) 처리가 없다');
  assert.ok(/숨김 처리된 동일 발주처가 있습니다\(복구 필요\)/.test(b), '숨김 중복 안내가 없다');
  assert.ok(/이미 등록된 발주처입니다/.test(b), '활성 중복 안내가 없다');
  assert.ok(/INSERT INTO customer \(name\) VALUES \(@n\)/.test(b), '파라미터 바인딩 INSERT가 아니다');
});

test('발주처 CRUD: rename — 빈값 거부·no-op 성공·1062 안내·0행 실패, FK CASCADE 의존', () => {
  const db = projectDbSource();
  const b = db.slice(db.indexOf('RenameCustomerAsync'), db.indexOf('SetCustomerActiveAsync'));
  assert.ok(/새 발주처명을 입력하세요/.test(b), '빈 newName 거부가 없다');
  assert.ok(/string\.Equals\(o, nw, StringComparison\.Ordinal\)\) return \(true/.test(b), 'oldName==newName no-op 성공이 없다');
  assert.ok(/그 이름의 발주처가 이미 있습니다/.test(b), '1062 안내가 없다');
  assert.ok(/발주처를 찾을 수 없습니다/.test(b), '0행(대상 없음) 처리가 없다');
  assert.ok(/UPDATE customer SET name=@new WHERE name=@old/.test(b), '개명 UPDATE가 파라미터 바인딩이 아니다');
});

test('발주처 CRUD: setActive는 UPDATE is_active(하드삭제 없음)', () => {
  const db = projectDbSource();
  const b = db.slice(db.indexOf('SetCustomerActiveAsync'), db.indexOf('CountActiveProjectsByCustomerAsync'));
  assert.ok(/UPDATE customer SET is_active=@a WHERE name=@n/.test(b), 'is_active 소프트삭제 UPDATE가 없다');
  assert.ok(!/DELETE FROM customer/.test(db), '앱이 발주처를 하드삭제하면 안 된다(방침 위반)');
});

test('발주처 CRUD: refCount는 활성 과제만 센다', () => {
  const db = projectDbSource();
  // CountActive… 선언부터 그 다음 멤버(private static string Str)까지로 자른다
  //   (LoadCustomersFullJsonAsync는 이 메서드보다 위에 있어 경계로 못 쓴다.)
  const b = db.slice(db.indexOf('CountActiveProjectsByCustomerAsync'), db.indexOf('private static string Str'));
  assert.ok(/SELECT COUNT\(\*\) FROM project WHERE customer=@c AND is_active=1/.test(b), '활성 과제 카운트 쿼리가 다르다');
});

// 브리지 계약 — 4개 cmd + 회신은 ReplyOnUi(UI 스레드 마샬)로만.
test('발주처 브리지: addCustomer/renameCustomer/setCustomerActive/customerRefCount cmd + ReplyOnUi 회신', () => {
  const cs = hostSource();
  for (const c of ['addCustomer', 'renameCustomer', 'setCustomerActive', 'customerRefCount', 'loadCustomersFull']) {
    assert.ok(new RegExp('case "' + c + '":').test(cs), `case "${c}"가 없다`);
  }
  // 회신은 전부 ReplyOnUi(백그라운드에서 WebView2 직접 접근 금지) — Run*Async가 ReplyOnUi를 쓴다.
  for (const m of ['RunAddCustomerAsync', 'RunRenameCustomerAsync', 'RunSetCustomerActiveAsync',
                   'RunCustomerRefCountAsync', 'RunLoadCustomersFullAsync']) {
    const b = cs.slice(cs.indexOf('private async Task ' + m), cs.indexOf('private async Task ' + m) + 400);
    assert.ok(/ReplyOnUi\(reqId,/.test(b), `${m}가 ReplyOnUi로 회신하지 않는다`);
    assert.ok(!/GitReply\(reqId/.test(b), `${m}가 GitReply를 직접 부른다(UI 스레드 마샬 우회)`);
  }
});

// 웹 관리 UI — 조작은 offEditGuard, 이름변경 성공 시 loadProjects·loadCustomers 재호출, 인라인 추가 후 자동 선택.
test('발주처 관리 UI: 조작은 offEditGuard 게이트를 통과한다(쓰기라 인증 필요)', () => {
  for (const fn of ['custDoAdd', 'custDoHide', 'custDoShow', 'custBeginRename']) {
    const b = extractFunction(src, fn);
    assert.ok(/offEditGuard\(/.test(b), `${fn}가 offEditGuard를 거치지 않는다`);
  }
});

test('발주처 관리 UI: 성공 시 loadCustomers 재호출, 이름변경만 loadProjects까지', () => {
  const b = extractFunction(src, 'custSend');
  assert.ok(/hpost\(\{ cmd: 'loadCustomers' \}\)/.test(b), '성공 후 발주처 드롭다운 갱신(loadCustomers)이 없다');
  assert.ok(/cmd === 'renameCustomer'[\s\S]{0,80}loadProjects/.test(b), '이름변경 후 과제 표기 갱신(loadProjects)이 없다');
  assert.ok(/reloadCustomerList\(\)/.test(b), '관리 목록 재조회가 없다');
});

test('발주처 관리 UI: 숨김은 참조 카운트로 경고 후 진행(막지 않음)', () => {
  const b = extractFunction(src, 'custDoHide');
  assert.ok(/customerRefCount/.test(b), '참조 카운트 조회가 없다');
  assert.ok(/과제 \$\{n\}건이 있습니다/.test(b), '참조 경고 문구가 없다');
  assert.ok(/setCustomerActive/.test(b) && /active: false/.test(b), '숨김 처리 전송이 없다');
});

test('발주처 관리 UI: 편집폼 인라인 추가는 성공 시 드롭다운 갱신 후 그 값 자동 선택', () => {
  const b = extractFunction(src, 'offEdInlineAddCustomer');
  assert.ok(/hostRequest\('addCustomer'/.test(b), 'addCustomer 왕복이 없다');
  assert.ok(/dbCustomers = \[\.\.\.new Set\(\[\.\.\.dbCustomers, name\]\)\]/.test(b), '새 발주처를 로컬 마스터에 즉시 반영하지 않는다');
  assert.ok(/restore\(name\)/.test(b), '성공 시 새 값으로 드롭다운 복원(자동 선택)이 없다');
  assert.ok(/offEdFillCustomers\(selectName/.test(b), '복원이 offEdFillCustomers로 선택값을 세팅하지 않는다');
});

test('발주처 관리 UI: 관리 버튼은 위젯에서만 노출(offSyncExportBtn이 함께 동기화)', () => {
  const b = extractFunction(src, 'offSyncExportBtn');
  assert.ok(/getElementById\('offCustMgr'\)/.test(b), '발주처 관리 버튼 표시 동기화가 없다');
  assert.ok(/cm\.style\.display = HOST \? '' : 'none'/.test(b), '관리 버튼이 위젯에서만 노출되지 않는다');
});
