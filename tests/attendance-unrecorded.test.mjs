// 근태 '미기록' 3상태 계약 — 웹(null) ↔ 경계(빈 문자열) ↔ 호스트(사이트 기존값 유지)
//
// 이 파일이 존재하는 이유(실사용 결함):
//   getAttendance()가 미기록과 정근을 같은 값('1')으로 흡수했다. 그 값이 그대로 회사 시스템으로 나가
//   폼 채우기(st.value=)와 제출(H('status',…))이 페이지의 기존 값을 덮었다.
//   → netcus에 직접 휴가·병가를 적어 둔 날짜에 캘린더로 일간보고를 보내면 '정근'으로 덮였다.
//     근태는 로컬 data.xml에만 있으므로 다른 자리 PC에서 보내도 같은 사고가 난다.
//
// 그래서 잠그는 계약은 넷이다:
//   ① 웹: 미기록 = null (정근'1'로 흡수 금지) · (미기록) 선택 = 기록 삭제
//   ② 웹→호스트: 페이로드가 null을 그대로 싣는다(|| '1' 같은 폴백 금지)
//   ③ 호스트 폼 채우기: 미기록이면 st.value에 아예 대입하지 않는다(페이지 값 보존)
//   ④ 호스트 제출: 미기록이면 페이지의 현재 status 값을 읽어 되싣는다(필드 제거도, 하드코딩 '1'도 아님)
//
// ③④는 정규식 구경이 아니라 'C# 소스가 실제로 조립하는 JS'를 재조립해 FakeDoc 위에서 실행해 확인한다
// (조립식이 바뀌면 재조립도 함께 바뀌므로 검사가 코드를 따라간다).
import { readFileSync } from 'node:fs';
import { test, assert, loadAppSource, extractFunction, FakeDoc } from './harness.mjs';

const src = loadAppSource();
const netcus = readFileSync(new URL('../widget/NetcusService.cs', import.meta.url), 'utf8');
const mainwin = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('./fixtures/mock-pjm-daily.html', import.meta.url), 'utf8');

// ── 공용 도우미 ──────────────────────────────────────────────────────
function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

// ATTEND_STATUS 상수 배열(사이트 코드값 목록) 추출.
function attendStatus(source) {
  const m = /const ATTEND_STATUS = (\[[\s\S]*?\]);/.exec(source);
  assert.ok(m, 'ATTEND_STATUS 배열 선언을 찾지 못함');
  return eval('(' + m[1] + ')');
}
const statusSet = (source) => new Set(attendStatus(source).map((s) => s.v));

// 앱 소스에서 함수를 잘라 단독 실행 가능한 형태로 만든다(전역 의존은 인자로 주입).
function mkGetAttendance(source) {
  const code = extractFunction(source, 'getAttendance');
  return (map) => new Function('loadAttendanceMap', 'ATTEND_STATUS_SET', code + '\nreturn getAttendance;')(
    () => map, statusSet(source));
}
function mkSetAttendance(source) {
  const code = extractFunction(source, 'setAttendance');
  return (map) => new Function('loadAttendanceMap', 'ATTEND_STATUS_SET', 'save', code + '\nreturn setAttendance;')(
    () => map, statusSet(source), () => {});
}

// 근태 드롭다운 옵션 HTML — 실제 조립식(const stOpts = …)을 잘라 그대로 평가한다.
function stOptsHtml(source, atStatus) {
  const i = source.indexOf('const stOpts =');
  assert.ok(i >= 0, 'const stOpts 선언을 찾지 못함');
  const m = /;\r?\n/.exec(source.slice(i));
  assert.ok(m, 'const stOpts 선언의 끝(;)을 찾지 못함');
  const expr = source.slice(i + 'const stOpts ='.length, i + m.index);
  assert.ok(/ATTEND_STATUS\.map/.test(expr), 'stOpts 조립식을 잘못 잘랐다(ATTEND_STATUS.map 없음)');
  return new Function('at', 'ATTEND_STATUS', 'esc', 'return (' + expr + ');')(
    { status: atStatus }, attendStatus(source), (s) => String(s));
}

// 전송 페이로드의 status 표현식(폴백이 끼었는지 보기 위해 원문 그대로 뽑는다).
function payloadStatusExpr(source) {
  const m = /fields:\s*\{\s*status:\s*([^,]+),\s*overtime:/.exec(source);
  assert.ok(m, '일간 전송 페이로드의 fields.status를 찾지 못함');
  return m[1].trim();
}

// ── C# → JS 재조립 ───────────────────────────────────────────────────
// NetcusService.cs가 문자열을 이어붙여 만드는 스크립트를, 같은 순서로 다시 조립한다.
// 보간식({req.Overtime} 등)은 테스트 값으로 치환하고, 중간 변수(stFill/stPost)는 삼항의 해당 가지를 넣는다.

// startMarker로 시작하는 C# 문장 한 개(문자열 리터럴 안의 ';'은 끝으로 보지 않는다).
function csStatement(code, startMarker) {
  const i = code.indexOf(startMarker);
  assert.ok(i >= 0, `C# 문장을 찾지 못함: ${startMarker}`);
  let j = i, inStr = false;
  while (j < code.length) {
    const c = code[j];
    if (inStr) {
      if (c === '\\') { j += 2; continue; }
      if (c === '"') { inStr = false; }
      j++; continue;
    }
    if (c === '"') { inStr = true; j++; continue; }
    if (c === ';') return code.slice(i, j + 1);
    j++;
  }
  throw new Error(`C# 문장의 끝(;)을 찾지 못함: ${startMarker}`);
}

// s[i]='"'인 C# 문자열 리터럴 하나를 읽는다. interpolated면 {{ }} 이스케이프 해제 + {식} 치환.
function readCsString(s, i, interpolated, subs) {
  assert.strictEqual(s[i], '"', 'C# 문자열 리터럴 시작(")을 찾지 못함');
  let j = i + 1, raw = '';
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { raw += s[j + 1]; j += 2; continue; }
    if (c === '"') { j++; break; }
    raw += c; j++;
  }
  if (!interpolated) return { text: raw, end: j };
  const OB = '\u0001', CB = '\u0002';   // {{ }} 이스케이프를 잠시 치워 두는 센티널
  let t = raw.split('{{').join(OB).split('}}').join(CB);
  t = t.replace(/\{([^{}]+)\}/g, (_, e) => {
    assert.ok(Object.prototype.hasOwnProperty.call(subs, e), `C# 보간식에 대응하는 테스트 값이 없다: {${e}}`);
    return subs[e];
  });
  return { text: t.split(OB).join('{').split(CB).join('}'), end: j };
}

// from 이후 첫 리터럴($"…" 또는 "…")을 읽는다.
function readLiteralAt(s, from, subs) {
  let i = from;
  while (i < s.length && s[i] !== '"' && s[i] !== '$') i++;
  assert.ok(i < s.length, 'C# 문자열 리터럴을 찾지 못함');
  return s[i] === '$' ? readCsString(s, i + 1, true, subs) : readCsString(s, i, false, subs);
}

// `… = cond ? "A" : "B";` 두 가지를 각각 문자열로.
function csTernaryBranches(stmt, subs) {
  const q = stmt.indexOf('?');
  assert.ok(q >= 0, `삼항 연산자가 없다(조건 분기가 사라졌다): ${stmt}`);
  const t = readLiteralAt(stmt, q + 1, subs);
  const colon = stmt.indexOf(':', t.end);
  assert.ok(colon >= 0, '삼항의 : 를 찾지 못함');
  const f = readLiteralAt(stmt, colon + 1, subs);
  return { whenTrue: t.text, whenFalse: f.text };
}

// `string x = "a" + v + $"b{expr}";` → 실제 JS 문자열.
function csAssembleJs(stmt, subs, vars) {
  const rhs = stmt.slice(stmt.indexOf('=') + 1, stmt.lastIndexOf(';'));
  let out = '', i = 0;
  while (i < rhs.length) {
    const c = rhs[i];
    if (c === '$' && rhs[i + 1] === '"') { const r = readCsString(rhs, i + 1, true, subs); out += r.text; i = r.end; continue; }
    if (c === '"') { const r = readCsString(rhs, i, false, subs); out += r.text; i = r.end; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let k = i; while (k < rhs.length && /[A-Za-z0-9_]/.test(rhs[k])) k++;
      const id = rhs.slice(i, k);
      assert.ok(Object.prototype.hasOwnProperty.call(vars, id), `C# 조립에 모르는 식별자: ${id}`);
      out += vars[id]; i = k; continue;
    }
    i++;   // '+' · 공백 · 개행
  }
  return out;
}

const OUR_STATUS = '3';                 // 우리(캘린더)가 고른 근태 = 특근
const PAGE_STATUS = '6';                // netcus 페이지에 이미 들어 있는 근태 = 휴가(덮이면 안 되는 값)
const FILL_SUBS = { 'req.Overtime': '2', 'J(req.Content)': JSON.stringify('보고서 본문'), 'J(req.Status)': JSON.stringify(OUR_STATUS) };
const POST_SUBS = { 'req.Y': '2026', 'req.M': '8', 'req.D': '7', 'J(id)': JSON.stringify('tester'),
  'J(req.Overtime.ToString())': JSON.stringify('2'), 'J(req.Content)': JSON.stringify('보고서 본문'), 'J(req.Status)': JSON.stringify(OUR_STATUS) };

const fillJs = (source, unrecorded) => {
  const b = csTernaryBranches(csStatement(source, 'string stFill ='), FILL_SUBS);
  return csAssembleJs(csStatement(source, 'string fill ='), FILL_SUBS, { stFill: unrecorded ? b.whenTrue : b.whenFalse });
};
const postJs = (source, unrecorded) => {
  const b = csTernaryBranches(csStatement(source, 'string stPost ='), POST_SUBS);
  return csAssembleJs(csStatement(source, 'string post ='), POST_SUBS, { stPost: unrecorded ? b.whenTrue : b.whenFalse });
};

// 폼 채우기용 문서(모의 netcus 일간보고 폼) — 페이지에 이미 휴가(6)가 들어 있는 상태로 만든다.
function fillDoc() {
  const doc = FakeDoc(fixture);
  doc.getElementsByName('status')[0].value = PAGE_STATUS;
  return doc;
}
// 제출용 문서 — 동적 <form>에 실리는 hidden 필드를 수집한다.
function submitDoc() {
  const base = FakeDoc(fixture);
  base.getElementsByName('status')[0].value = PAGE_STATUS;
  const sent = [];
  const doc = {
    getElementsByName: (n) => base.getElementsByName(n),
    querySelector: (s) => base.querySelector(s),
    createElement(tag) {
      const t = String(tag).toUpperCase();
      return {
        tagName: t, name: '', type: '', value: '', method: '', enctype: '', acceptCharset: '', action: '',
        appendChild(c) { sent.push({ tag: c.tagName, name: c.name, value: c.value }); },
        submit() { doc.submitted = true; },
      };
    },
    body: { appendChild() {} },
    submitted: false,
    sent,
  };
  return doc;
}
const runJs = (js, doc) => new Function('document', 'return ' + js)(doc);
const sentValue = (doc, name) => { const h = doc.sent.find((x) => x.name === name); return h ? h.value : undefined; };

// ══ 검사 함수(테스트와 변이 주입이 같은 함수를 쓴다) ════════════════════
const checks = {
  // ① 미기록 = null. '1'(정근)로 흡수하면 회사 기록이 덮인다.
  getAttendanceNullsUnrecorded(source) {
    const get = mkGetAttendance(source);
    assert.deepStrictEqual(get({})('2026-08-07'), { status: null, overtime: 0 },
      '미기록 날짜의 status가 null이 아니다 — 미기록을 정근으로 흡수하면 netcus의 기존 근태가 덮인다');
    assert.deepStrictEqual(get({ '2026-08-07': { status: '99', overtime: 3 } })('2026-08-07'), { status: null, overtime: 3 },
      '미지 코드도 null이어야 한다(정근으로 흡수 금지)');
    assert.deepStrictEqual(get({ '2026-08-07': { status: '6', overtime: 2 } })('2026-08-07'), { status: '6', overtime: 2 },
      '유효 코드는 그대로 반환해야 한다');
  },

  // ① (계속) (미기록) 저장 = 기록 삭제(빈 값 저장이 아니다).
  setAttendanceDeletesOnUnrecorded(source) {
    const set = mkSetAttendance(source);
    const map = { '2026-08-07': { status: '6', overtime: 1 }, '2026-08-08': { status: '2', overtime: 0 } };
    set(map)('2026-08-07', '', '0');
    assert.deepStrictEqual(map, { '2026-08-08': { status: '2', overtime: 0 } },
      '(미기록) 저장이 기록을 지우지 않는다 — 빈 값/정근이 남으면 전송 시 회사 근태를 덮는다');
    const map2 = { '2026-08-07': { status: '6', overtime: 1 } };
    set(map2)('2026-08-07', '99', '0');
    assert.deepStrictEqual(map2, {}, '미지 코드 저장도 기록 삭제(정근으로 흡수 금지)');
  },

  // ② 드롭다운에 value=""인 (미기록)이 있고, 미기록이면 그것이 selected.
  dropdownHasUnrecordedOption(source) {
    const html = stOptsHtml(source, null);
    assert.ok(/<option value=""[^>]*>\(미기록\)<\/option>/.test(html),
      '근태 드롭다운에 value=""인 (미기록) 옵션이 없다 — 사용자가 미기록으로 되돌릴 방법이 사라진다');
    assert.ok(/<option value="" selected>/.test(html),
      'at.status==null인데 (미기록)이 selected가 아니다 — 미기록인 날 정근이 선택된 것처럼 보인다');
    assert.ok(!/<option value="1" selected>/.test(html), '미기록인데 정근(1)이 selected다');
    // 유효 코드면 그 코드가 selected이고 (미기록)은 풀린다.
    const h6 = stOptsHtml(source, '6');
    assert.ok(/<option value="6" selected>/.test(h6), '저장된 근태 코드가 selected여야 한다');
    assert.ok(!/<option value="" selected>/.test(h6), '저장된 근태가 있는데 (미기록)이 selected다');
  },

  // ③ 전송 페이로드는 null을 그대로 싣는다(|| '1' 같은 폴백 금지).
  payloadCarriesNull(source) {
    assert.strictEqual(payloadStatusExpr(source), 'at.status',
      "일간 전송 페이로드의 fields.status에 폴백이 끼었다 — null(미기록)이 코드값으로 바뀌면 회사 근태가 덮인다");
    assert.ok(/submitDaily\(p\)\{[^}]*status:\s*p\.fields\.status\s*,/.test(source),
      '위젯 어댑터가 p.fields.status를 그대로 넘기지 않는다');
  },

  // ③ (계속) 웹→호스트 경계 규약: 빈 문자열 = 미기록. GetStr이 JSON null을 ""로 환원하는 것에 의존한다.
  hostBoundaryKeepsUnrecorded(mainSource, netcusSource) {
    // 같은 모양의 지역 헬퍼(S)가 따로 있어서, GetStr 선언 본문만 잘라 본다.
    const g = /private static string GetStr\(JsonDocument d, string key\) =>\s*([^;]+);/.exec(mainSource);
    assert.ok(g, 'GetStr 선언을 찾지 못함');
    assert.ok(/v\.ValueKind == JsonValueKind\.String \? \(v\.GetString\(\) \?\? ""\) : ""/.test(g[1]),
      'GetStr이 문자열 아닌 값(JSON null)을 ""로 환원하지 않는다 — 미기록 규약(빈 문자열)이 깨진다');
    assert.ok(/bool keepStatus = string\.IsNullOrEmpty\(req\.Status\);/.test(netcusSource),
      '호스트가 빈 Status를 미기록으로 판정하지 않는다 — 미기록 경로가 아예 발동하지 않는다');
  },

  // ④ 폼 채우기: 미기록이면 st.value에 대입하지 않는다(페이지 값 보존).
  fillKeepsPageStatus(source) {
    const doc = fillDoc();
    const r = runJs(fillJs(source, true), doc);
    assert.strictEqual(r, 1, '폼 채우기 스크립트가 성공(1)을 돌려주지 않았다');
    assert.strictEqual(doc.getElementsByName('status')[0].value, PAGE_STATUS,
      '미기록인데 폼의 status를 덮었다 — netcus에 직접 적어 둔 휴가·병가가 이 순간 사라진다');
    assert.strictEqual(doc.getElementsByName('content')[0].value, '보고서 본문', '내용은 정상적으로 채워져야 한다');
    assert.strictEqual(doc.getElementsByName('overtime')[0].value, '2', '초과시간은 정상적으로 채워져야 한다');
  },

  // ④ (계속) 기록이 있으면 우리 값으로 채운다(미기록 처리가 정상 경로를 죽이지 않았는지).
  fillWritesOurStatus(source) {
    const doc = fillDoc();
    assert.strictEqual(runJs(fillJs(source, false), doc), 1);
    assert.strictEqual(doc.getElementsByName('status')[0].value, OUR_STATUS,
      '기록이 있는데 우리 근태를 폼에 채우지 않았다');
  },

  // ⑤ 제출: 미기록이면 페이지의 현재 status를 읽어 되싣는다(필드 제거도, 하드코딩 '1'도 아님).
  submitReloadsPageStatus(source) {
    const doc = submitDoc();
    assert.strictEqual(runJs(postJs(source, true), doc), 'SUBMITTED', '제출 폼 조립이 실패했다');
    assert.strictEqual(sentValue(doc, 'status'), PAGE_STATUS,
      '미기록 제출이 페이지의 현재 근태를 되싣지 않았다 — 하드코딩 값이면 회사 기록이 덮인다');
    assert.strictEqual(sentValue(doc, 'dbstatus'), '0', 'dbstatus 되싣기(기존 동작)가 깨졌다');
    assert.strictEqual(sentValue(doc, 'overtime'), '2', 'overtime 전송이 깨졌다');
  },

  // ⑤ (계속) status 필드를 폼에서 빼면 안 된다 — netcus가 필드 부재를 어떻게 다루는지 모른다.
  submitAlwaysSendsStatus(source) {
    for (const unrecorded of [true, false]) {
      const doc = submitDoc();
      assert.strictEqual(runJs(postJs(source, unrecorded), doc), 'SUBMITTED');
      assert.ok(doc.sent.some((x) => x.name === 'status'),
        `제출 폼에 status 필드가 없다(미기록=${unrecorded}) — 빈 값으로 저장될 수 있다`);
    }
    const doc = submitDoc();
    runJs(postJs(source, false), doc);
    assert.strictEqual(sentValue(doc, 'status'), OUR_STATUS, '기록이 있으면 우리 근태를 제출해야 한다');
  },

  // ⑥ 미기록 경로는 로그를 남긴다 — "왜 안 바뀌었지"를 추적할 유일한 근거.
  logsUnrecordedPath(source) {
    assert.ok(/Log\("netcus 근태: 미기록 → 사이트 기존값 유지\(" \+ cur \+ "\)"\);/.test(source),
      '미기록 경로에 로그가 없다 — 사이트 기존값을 유지했다는 사실을 나중에 확인할 방법이 사라진다');
    assert.ok(/if \(keepStatus\)/.test(source), '미기록 로그가 keepStatus 분기 안에 있지 않다');
  },

  // ⑦ ATTEND_STATUS 상수 배열은 사이트 코드값 목록이다 — (미기록)을 여기에 끼워 넣으면 안 된다.
  attendStatusUnchanged(source) {
    assert.deepStrictEqual(attendStatus(source), [
      { v: '1', label: '정근' }, { v: '2', label: '야근' }, { v: '3', label: '특근' }, { v: '4', label: '외근' },
      { v: '5', label: '출장' }, { v: '6', label: '휴가' }, { v: '12', label: '반차' }, { v: '7', label: '조퇴' },
      { v: '9', label: '지각' }, { v: '10', label: '지각+야근' }, { v: '11', label: '병가' },
    ], 'ATTEND_STATUS가 바뀌었다 — 사이트 select와 동일한 코드값 목록이라 임의로 항목을 넣거나 빼면 안 된다');
  },
};

// ══ 본 검사 ═══════════════════════════════════════════════════════════

test('근태 미기록: getAttendance는 미기록·미지 코드에 null을 돌려준다(정근으로 흡수 금지)', () => {
  checks.getAttendanceNullsUnrecorded(src);
});

test('근태 미기록: setAttendance는 빈 값·미지 코드에 기록을 삭제한다(빈 값 저장 아님)', () => {
  checks.setAttendanceDeletesOnUnrecorded(src);
});

test('근태 미기록: 드롭다운에 value=""인 (미기록)이 있고 미기록이면 selected', () => {
  checks.dropdownHasUnrecordedOption(src);
});

test('근태 미기록: 안내 문구가 "기존 근태를 그대로 둔다"는 사실을 알린다(.ra-hint 자리)', () => {
  assert.ok(/class="ra-hint"[^>]*>미기록이면 회사 시스템의 기존 근태를 그대로 둡니다</.test(src),
    '(미기록)의 의미를 알리는 안내가 없다 — 사용자가 "안 보낸 것"으로 오해한다');
});

test('근태 미기록: 안내 문구는 미기록일 때만 보인다(근태를 고르면 숨는다)', () => {
  assert.ok(/syncHint\s*=\s*\(\)\s*=>/.test(src),
    'syncHint가 없다 — 근태를 고른 뒤에도 "미기록이면…"이 남아 현재 상태를 잘못 설명한다');
  assert.ok(/classList\.toggle\('hidden',\s*!!\(s\s*&&\s*s\.value\)\)/.test(src),
    '안내 문구 표시 조건이 status 값에 묶여 있지 않다');
  assert.ok(/const sv = \(\) => \{ setAttendance\(.*?\); syncHint\(\); \}/.test(src),
    'change 저장 경로에서 syncHint를 부르지 않는다 — 선택을 바꿔도 안내가 그대로 남는다');
  // 레일에서 말줄임으로 잘리면 안내가 아니다
  assert.ok(/\.rpt-attend-rail \.rpt-attend \.ra-hint\{[^}]*white-space:normal[^}]*\}/.test(src),
    '레일의 안내 문구가 여전히 nowrap+ellipsis라 문장이 잘린다');
});

test('근태 미기록: 전송 페이로드가 status:null을 그대로 싣는다(폴백 금지)', () => {
  checks.payloadCarriesNull(src);
});

test('근태 미기록: 웹→호스트 경계에서 미기록이 빈 문자열로 보존된다(GetStr·keepStatus)', () => {
  checks.hostBoundaryKeepsUnrecorded(mainwin, netcus);
});

test('근태 미기록: 호스트 폼 채우기가 페이지의 기존 status를 건드리지 않는다', () => {
  checks.fillKeepsPageStatus(netcus);
});

test('근태 기록됨: 호스트 폼 채우기가 우리 근태로 정상 대입한다(정상 경로 보존)', () => {
  checks.fillWritesOurStatus(netcus);
});

test('근태 미기록: 호스트 제출이 페이지의 현재 status를 읽어 되싣는다(dbstatus와 같은 패턴)', () => {
  checks.submitReloadsPageStatus(netcus);
});

test('근태: 제출 폼에서 status 필드를 빼지 않는다(부재 시 빈 값 저장 위험)', () => {
  checks.submitAlwaysSendsStatus(netcus);
});

test('근태 미기록: 호스트가 미기록 경로를 로그로 남긴다', () => {
  checks.logsUnrecordedPath(netcus);
});

test('근태: ATTEND_STATUS 상수 배열은 사이트 코드값 목록 그대로다', () => {
  checks.attendStatusUnchanged(src);
});

// ══ 변이 주입(검사가 실효성이 있는지 증명) ════════════════════════════
// 각 변이는 '되돌아갈 수 있는 회귀'다 — 검사가 안 잡으면 그 검사는 장식이다.

test('변이①: getAttendance가 미기록을 다시 \'1\'로 흡수하면 검사가 실패한다', () => {
  const bad = mutate("ATTEND_STATUS_SET.has(String(a.status))) ? String(a.status) : null,",
    "ATTEND_STATUS_SET.has(String(a.status))) ? String(a.status) : '1',", src);
  assert.throws(() => checks.getAttendanceNullsUnrecorded(bad), /미기록 날짜의 status가 null이 아니다/);
});

test('변이②: setAttendance가 (미기록)을 삭제 대신 정근으로 저장하면 검사가 실패한다', () => {
  const bad = mutate("if(!ATTEND_STATUS_SET.has(st)){ delete m[date]; save(); return; }",
    "if(!ATTEND_STATUS_SET.has(st)){ m[date] = { status: '1', overtime: 0 }; save(); return; }", src);
  assert.throws(() => checks.setAttendanceDeletesOnUnrecorded(bad), /기록을 지우지 않는다|미지 코드 저장도 기록 삭제/);
});

test('변이③: 드롭다운에서 (미기록) 옵션을 빼면 검사가 실패한다', () => {
  const bad = mutate('const stOpts = `<option value=""${at.status == null ? \' selected\' : \'\'}>(미기록)</option>`\n      + ',
    'const stOpts = ', src);
  assert.throws(() => checks.dropdownHasUnrecordedOption(bad), /\(미기록\) 옵션이 없다/);
});

test('변이④: (미기록)의 selected 판정을 지우면 검사가 실패한다(미기록인데 정근이 선택됨)', () => {
  const bad = mutate("`<option value=\"\"${at.status == null ? ' selected' : ''}>(미기록)</option>`",
    "`<option value=\"\">(미기록)</option>`", src);
  assert.throws(() => checks.dropdownHasUnrecordedOption(bad), /\(미기록\)이 selected가 아니다/);
});

test('변이⑤: 전송 페이로드에 || \'1\' 폴백이 끼면 검사가 실패한다', () => {
  const bad = mutate('fields: { status: at.status, overtime: at.overtime, content }',
    "fields: { status: at.status || '1', overtime: at.overtime, content }", src);
  assert.throws(() => checks.payloadCarriesNull(bad), /폴백이 끼었다/);
});

test('변이⑥: keepStatus 판정을 없애면(항상 기록으로 취급) 경계 검사가 실패한다', () => {
  const bad = mutate('bool keepStatus = string.IsNullOrEmpty(req.Status);', 'bool keepStatus = false;', netcus);
  assert.throws(() => checks.hostBoundaryKeepsUnrecorded(mainwin, bad), /빈 Status를 미기록으로 판정하지 않는다/);
});

test('변이⑦: GetStr이 null을 빈 문자열로 환원하지 않으면 경계 검사가 실패한다', () => {
  const bad = mutate('d.RootElement.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";',
    'd.RootElement.TryGetProperty(key, out var v) ? (v.GetString() ?? "1") : "1";', mainwin);
  assert.throws(() => checks.hostBoundaryKeepsUnrecorded(bad, netcus), /""로 환원하지 않는다/);
});

test('변이⑧: 미기록인데도 폼의 status에 대입하면(원래 버그) 폼 채우기 검사가 실패한다', () => {
  const bad = mutate('string stFill = keepStatus ? "" : $"if(st){{st.value={J(req.Status)};}}";',
    'string stFill = keepStatus ? $"if(st){{st.value=\'1\';}}" : $"if(st){{st.value={J(req.Status)};}}";', netcus);
  assert.throws(() => checks.fillKeepsPageStatus(bad), /폼의 status를 덮었다/);
});

test('변이⑨: 미기록 제출을 하드코딩 \'1\'로 되돌리면 제출 검사가 실패한다', () => {
  const bad = mutate("string stPost = keepStatus ? \"H('status',(st&&st.value)?st.value:'1');\"",
    "string stPost = keepStatus ? \"H('status','1');\"", netcus);
  assert.throws(() => checks.submitReloadsPageStatus(bad), /페이지의 현재 근태를 되싣지 않았다/);
});

test('변이⑩: 제출 폼에서 status 필드를 빼면 검사가 실패한다', () => {
  const bad = mutate("string stPost = keepStatus ? \"H('status',(st&&st.value)?st.value:'1');\"",
    'string stPost = keepStatus ? ""', netcus);
  assert.throws(() => checks.submitAlwaysSendsStatus(bad), /제출 폼에 status 필드가 없다/);
});

test('변이⑪: 제출 스크립트가 페이지 status를 읽지 않으면(var st 제거) 제출이 실패한다', () => {
  const bad = mutate('"var st=document.getElementsByName(\'status\')[0];"', '""', netcus);
  assert.throws(() => checks.submitReloadsPageStatus(bad), /제출 폼 조립이 실패했다/);
});

test('변이⑫: 미기록 로그를 지우면 로그 검사가 실패한다', () => {
  const bad = mutate('Log("netcus 근태: 미기록 → 사이트 기존값 유지(" + cur + ")");', '', netcus);
  assert.throws(() => checks.logsUnrecordedPath(bad), /미기록 경로에 로그가 없다/);
});

test('변이⑬: ATTEND_STATUS에 (미기록)을 끼워 넣으면 상수 검사가 실패한다', () => {
  const bad = mutate("const ATTEND_STATUS = [\n", "const ATTEND_STATUS = [\n  {v:'',label:'(미기록)'},\n", src);
  assert.throws(() => checks.attendStatusUnchanged(bad), /ATTEND_STATUS가 바뀌었다/);
});
