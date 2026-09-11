// 공용 테스트 하네스 — 의존성 0(Node 내장 모듈만).
// 브라우저 없는 Node에서 앱의 순수 함수 단위테스트 + 폼 채우기 로직 검증을 돕는다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

// ── 테스트 등록·실행 ────────────────────────────────────────────────
// test(name, fn)으로 등록하고 run()으로 일괄 실행. fn은 sync/async 모두 지원.
// 러너(run-tests.mjs)가 *.test.mjs를 전부 import한 뒤 run()을 한 번 호출하는 구조라
// 모든 테스트가 같은 큐에 모인다. import 순서와 무관하게 동작.
//
// ★ skip 은 '통과'가 아니다 — '판정 없음'이다.
//   옛 판은 의존성(jsdom)이 없을 때 빈 함수를 test() 로 등록해 두었다. 그 결과 218건이
//   등록조차 되지 않은 채 요약은 「pass」1건이 늘고 exit 0 이 나왔다(실측 2026-09-02:
//   jsdom 을 막으면 820 → 602 pass / 0 fail / exit 0). 새 클론·폐쇄망 반입 PC 처럼
//   tests/node_modules 가 없는 곳에서는 그게 상시 상태다 — 게이트가 조용히 거짓말을 했다.
//   그래서 skip 을 별도 종류로 세고, 하나라도 있으면 exit 2(판정 없음)로 끝낸다.
//   loop-*.mjs 가 이미 쓰는 0/1/2 규약과 같은 뜻이다(README「종료코드」).
const _queue = [];

export function test(name, fn) {
  _queue.push({ kind: 'test', name, fn });
}

// skip(name, reason, detail)
//   reason — 집계 키. 짧게(예: 'jsdom 미설치'). 요약에 「사유별」로 묶여 나온다.
//   detail — 그 줄에만 붙는 자유 문구(예: '이 파일의 jsdom 테스트 213건이 세어지지 않음').
export function skip(name, reason, detail) {
  _queue.push({
    kind: 'skip',
    name,
    reason: String(reason || '(사유 없음)'),
    detail: detail ? String(detail) : '',
  });
}
// test.skip(...) 표기도 허용(다른 러너 관례에 익숙한 사람 대비).
test.skip = skip;

// ── 등록 인구조사(census) ────────────────────────────────────────────
//  위 주석의 사고("등록조차 되지 않은 채 exit 0")는 skip 규약으로 한 갈래를 막았다.
//  남은 두 갈래는 skip 조차 남기지 않아 더 조용하다:
//    ① 시험 파일이 통째로 사라진다 — 개명(foo.test.mjs → foo.tests.mjs)·삭제.
//       러너는 *.test.mjs 만 수집하므로 **수집조차 안 되고**, 큐에 아무 흔적이 없다.
//    ② 한 파일이 0건을 등록한다 — 전부 조건 밖으로 밀려나거나 이른 return 이 생긴 경우.
//  둘 다 "pass 가 줄고 fail 은 0" 으로 나타난다. 사람이 총합을 외우고 있지 않으면 못 본다.
//  그래서 러너가 파일별 등록 수를 세고, 아래 두 함수로 계약을 만든다(run-tests.mjs).
export function queuedCount() {
  return _queue.length;
}

// counts = { '파일명': 등록건수 } → 0건인 파일 이름들(정렬). 순수 함수라 단독 시험 대상.
export function filesWithNoTests(counts) {
  const c = counts || {};
  return Object.keys(c).filter((f) => !(c[f] > 0)).sort();
}

// TC_TEST_STRICT=1 — skip 을 fail 로 취급한다(릴리스 게이트가 켜는 스위치).
export function isStrict() {
  return String(process.env.TC_TEST_STRICT || '') === '1';
}

export async function run() {
  const strict = isStrict();
  let pass = 0;
  let fail = 0;
  let skipped = 0;
  const skipReasons = new Map(); // 사유 → 건수

  for (const t of _queue) {
    if (t.kind === 'skip') {
      const line = t.detail ? `${t.name} — ${t.detail}` : t.name;
      skipReasons.set(t.reason, (skipReasons.get(t.reason) || 0) + 1);
      if (strict) {
        // 엄격 모드: 판정 없음도 실패다. 게이트가 '환경 때문에 안 돌았다'를 통과로 읽지 못하게.
        fail++;
        console.log(`  ✗ ${line}`);
        console.log(`      TC_TEST_STRICT=1 — 생략(${t.reason})을 실패로 취급합니다.`);
      } else {
        skipped++;
        console.log(`  ○ ${line}`); // ○ = 판정 없음
      }
      continue;
    }
    try {
      await t.fn();
      pass++;
      console.log(`  ✓ ${t.name}`); // ✓
    } catch (err) {
      fail++;
      console.log(`  ✗ ${t.name}`); // ✗
      const msg = err && err.stack ? err.stack : String(err);
      console.log(msg.split('\n').map((l) => '      ' + l).join('\n'));
    }
  }

  console.log(`\n${pass} pass / ${fail} fail / ${skipped} skip`);
  if (skipped > 0) {
    const parts = [...skipReasons.entries()].map(([r, n]) => `${r}: ${n}`);
    console.log(`  skip ${skipped} — ${parts.join(' · ')}`);
    console.log('  ※ skip 은 통과가 아니다 — 그만큼은 판정하지 않았다(exit 2).');
  }
  if (strict && skipReasons.size > 0) {
    const parts = [...skipReasons.entries()].map(([r, n]) => `${r}: ${n}`);
    console.log(`  strict — 생략 사유별: ${parts.join(' · ')}`);
  }

  // 종료코드: fail>0 → 1(위반) · fail=0 & skip>0 → 2(판정 없음) · 둘 다 0 → 0.
  if (fail > 0) process.exitCode = 1;
  else if (skipped > 0) process.exitCode = 2;

  return { pass, fail, skip: skipped, skipReasons, strict };
}

// assert도 재수출(테스트 파일이 한 곳에서 import하도록 편의 제공).
export { assert };

// ── 선택 의존성 로드 ────────────────────────────────────────────────
// Layer 2(jsdom) 처럼 '없을 수도 있는' 모듈을 부른다. 없으면 null — 던지지 않는다.
// ★ TC_TEST_FORCE_MISSING=jsdom  — 있어도 없는 척한다(게이트 자체를 시험하는 주입구).
//   loop-*.mjs 의 TC_TEST_INJECT_TRUNC / TC_TEST_MUTATE_NOOP 과 같은 관례다.
//   이 스위치가 없으면 "jsdom 없을 때 정말 exit 2 가 나오는가"를 증명할 방법이
//   node_modules 를 지우는 것뿐인데, 그 심링크는 main 워크트리와 공유된 실물이다.
export const SKIP_NO_JSDOM = 'jsdom 미설치';

export async function importOptional(spec) {
  const forced = String(process.env.TC_TEST_FORCE_MISSING || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (forced.includes(spec)) return null;
  try {
    return await import(spec);
  } catch (_) {
    return null; // 미설치
  }
}

// ── jsdom 부팅 한 곳 ────────────────────────────────────────────────
// 여러 시험 파일이 같은 다섯 줄(JSDOM 만들기 → eval → 창구 호출 → JSON 왕복)을 각자 적어 두고 있었다.
// 사본은 반드시 낡는다 — 한쪽만 runScripts 옵션이 바뀌면 그 파일만 다른 realm 에서 돌게 된다.
//   ★ JSON 왕복이 핵심이다: jsdom 의 Array 는 **다른 realm** 이라, 그대로 돌려주면
//     deepStrictEqual 이 프로토타입 불일치로 늘 실패한다(값은 같은데 판정이 거짓말을 한다).
//   ★ jsdom 은 선택 의존성이라 harness 가 최상위에서 부르지 않는다. 쓰는 파일이
//     useJsdom(await importOptional('jsdom')) 으로 한 번 등록하고 쓴다 —
//     harness 가 스스로 import 하면, jsdom 을 쓰지 않는 시험 파일까지 그 비용을 문다.
let _jsdom = null;
export function useJsdom(mod) { _jsdom = mod || null; return mod; }

// fixture HTML 로 창을 세우고 js 를 심은 뒤, 창구(window[name])를 args 로 부른 결과를 돌려준다.
export function runInJsdom(fixture, js, name = '__probe', ...args) {
  if (!_jsdom) throw new Error('runInJsdom: jsdom 이 등록되지 않았다 — useJsdom(await importOptional("jsdom")) 을 먼저 부른다');
  //  runScripts: outside-only — window 가 실제 realm 으로 선다(없으면 eval 안에서 window 가 미정의다).
  const dom = new _jsdom.JSDOM(fixture, { runScripts: 'outside-only' });
  dom.window.eval(js);
  const fn = dom.window[name];
  if (typeof fn !== 'function') throw new Error(`runInJsdom: window.${name} 창구가 없다 — 판정 불가`);
  return JSON.parse(JSON.stringify(fn(...args)));
}

// 파일 안에서 marker 뒤에 있는 test( 호출 '자리 수'를 정적으로 센다.
// skip 줄에 "얼마나 사라졌는가"의 규모를 붙이기 위한 것 — 정확한 건수가 아니다.
//   · 루프 안에서 등록하는 자리는 1로 세지만 실제로는 여러 건이다(실측: app-context 는
//     정적 124곳 vs 실제 185건).
//   · 부팅 실패 때만 등록하는 조건부 test( 도 1로 센다(정상 부팅이면 0건).
// 주석·문자열 안의 test( 는 제외한다.
export function countTestsBelow(fileUrl, marker) {
  let src;
  try {
    src = readFileSync(new URL(fileUrl), 'utf8');
  } catch (_) {
    return 0;
  }
  const at = src.indexOf(marker);
  if (at < 0) return 0;

  let n = 0;
  let i = at + marker.length;
  const len = src.length;
  while (i < len) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = skipString(src, i); continue; }
    if (c === '/' && src[i + 1] === '/') { i = skipLineComment(src, i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = skipBlockComment(src, i); continue; }
    // 식별자 경계에서 시작하는 test( 만 센다(latest( · .test( 제외).
    if (c === 't' && src.startsWith('test', i) && !/[.\w$]/.test(src[i - 1] || '')) {
      const rest = src.slice(i + 4);
      const m = /^\s*\(/.exec(rest);
      if (m) { n++; i += 4 + m[0].length; continue; }
    }
    i++;
  }
  return n;
}

// ── 앱 소스 로드 ────────────────────────────────────────────────────
// task-calendar-prototype.html을 UTF-8 텍스트로 읽어 반환. 경로는 tests/ 기준 상위 폴더.
export function loadAppSource() {
  const url = new URL('../task-calendar-prototype.html', import.meta.url);
  return readFileSync(url, 'utf8');
}

// ── 함수 추출 ───────────────────────────────────────────────────────
// 소스 문자열에서 `function fnName(...){...}` 선언을 중괄호 짝을 맞춰 잘라 문자열로 반환.
// 문자열/템플릿 리터럴('...' "..." `...`) 내부의 중괄호는 카운트에서 제외해 오탐 방지.
// 라인 주석(//)·블록 주석(/* */) 안의 중괄호도 무시. 못 찾으면 에러 throw.
export function extractFunction(source, fnName) {
  // `function fnName` 뒤에 여는 괄호가 오는 선언을 찾는다(공백 허용).
  const re = new RegExp('function\\s+' + escapeRe(fnName) + '\\s*\\(');
  const m = re.exec(source);
  if (!m) throw new Error(`extractFunction: '${fnName}' 선언을 찾지 못함`);

  const start = m.index;
  // 선언부의 여는 중괄호 '{' 위치를 찾는다(파라미터 목록의 괄호 이후 첫 '{').
  let i = start;
  const len = source.length;
  // 함수 body 시작 '{' 탐색 — 리터럴/주석은 건너뛰며 진행.
  let bodyOpen = -1;
  while (i < len) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(source, i);
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i);
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i);
      continue;
    }
    if (c === '{') { bodyOpen = i; break; }
    i++;
  }
  if (bodyOpen < 0) throw new Error(`extractFunction: '${fnName}' body의 '{'를 찾지 못함`);

  // 중괄호 균형 카운트 — 리터럴/주석 내부는 제외.
  let depth = 0;
  let j = bodyOpen;
  while (j < len) {
    const c = source[j];
    if (c === "'" || c === '"' || c === '`') {
      j = skipString(source, j);
      continue;
    }
    if (c === '/' && source[j + 1] === '/') {
      j = skipLineComment(source, j);
      continue;
    }
    if (c === '/' && source[j + 1] === '*') {
      j = skipBlockComment(source, j);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, j + 1);
    }
    j++;
  }
  throw new Error(`extractFunction: '${fnName}' 중괄호 짝이 맞지 않음(닫힘 없음)`);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── C# 소스 오려내기 ────────────────────────────────────────────────
// 호스트(widget/*.cs)의 계약을 형태로 보는 시험들이 같은 슬라이서를 각자 안고 있었다. 사본은 반드시
// 낡는다 — 한쪽만 문자열 이스케이프나 식(=>) 본문 처리를 고치면 나머지는 그대로 오탐을 안고 통과한다.
// 그래서 정본을 여기 둔다.
//   ★ **아직 옮기지 않은 파일이 있다**(2026-09-11 R2-W6 — "한 곳에 있다"는 서술은 그때까지 거짓이었다):
//     admin-auth · code-tables · user-login · user-info · schema-integrity 다섯 파일은 여전히 자기 사본을
//     쓴다. 옮긴 것은 user-admin · trash-host 둘뿐이다. 이 목록은 사본을 없앨 때 함께 줄여야 한다 —
//     여기 적힌 것이 사실이 아니게 되는 순간, 이 주석도 사본과 똑같이 낡은 것이 된다.
//
// 주석 제거(문자열 리터럴은 보존) — "왜 안 하는지"를 적어 둔 **주석이** 계약을 통과시키면 안 된다.
const _CS_BS = String.fromCharCode(92);
export function stripCsComments(s) {
  const src = String(s == null ? '' : s);
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length) { if (src[j] === _CS_BS) { j += 2; continue; } if (src[j] === c) { j++; break; } j++; }
      out += src.slice(i, j); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// 문자열 리터럴 시작 위치 i(따옴표)에서 **닫는 따옴표의 위치**를 돌려준다(백슬래시 이스케이프 처리).
//   ★ C# 용이다 — 아래 두 곳이 같은 규칙을 쓴다(자바스크립트용 skipString 과 반환 규약이 다르니 섞지 말 것).
function _csCloseQuote(code, i) {
  const q = code[i];
  let j = i + 1;
  while (j < code.length) {
    if (code[j] === _CS_BS) { j += 2; continue; }
    if (code[j] === q) break;
    j++;
  }
  return j;
}

// C# 멤버 본문 슬라이스 — 시그니처 조각부터 중괄호 짝이 맞는 곳까지(주석 제거본 기준).
//   ★ 못 찾으면 던진다. '판정 불가'는 통과가 아니다.
//   ★ 식(=>) 본문 멤버는 중괄호가 없다 — 옛 판은 그때 **다음 멤버의 여는 중괄호**를 자기 것으로 잡아
//     남의 본문까지 통째로 삼켰다(2026-09-11 적대 검토 R2-W5). 그 슬라이스로 "이 멤버가 X 를 부른다"를
//     보면, 실제로 부르는 것은 옆 멤버인데 초록이 뜬다. 그래서 '=>' 가 '{' 보다 먼저면 ';' 까지만 자른다.
export function extractCsMember(source, sig) {
  const code = stripCsComments(source);
  const s = code.indexOf(sig);
  if (s < 0) throw new Error(`extractCsMember: C# 멤버를 찾지 못함: ${sig}`);
  const open = code.indexOf('{', s);
  const arrow = code.indexOf('=>', s);
  if (arrow >= 0 && (open < 0 || arrow < open)) {
    //  식 본문의 끝은 문장의 ';' 다 — 문자열 리터럴 안의 ';' 는 세지 않는다.
    for (let k = arrow; k < code.length; k++) {
      const c = code[k];
      if (c === '"' || c === "'") { k = _csCloseQuote(code, k); continue; }
      if (c === ';') return code.slice(s, k + 1);
    }
    throw new Error(`extractCsMember: ${sig} 의 식(=>) 본문을 닫는 ';' 를 찾지 못했다`);
  }
  if (open <= s) throw new Error(`extractCsMember: ${sig} 의 여는 중괄호를 찾지 못함`);
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    const c = code[k];
    if (c === '"' || c === "'") {
      let j = k + 1;
      while (j < code.length) { if (code[j] === _CS_BS) { j += 2; continue; } if (code[j] === c) break; j++; }
      k = j; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth -= 1; if (depth === 0) return code.slice(s, k + 1); }
  }
  throw new Error(`extractCsMember: ${sig} 의 중괄호 짝이 맞지 않는다`);
}

// 문자열 리터럴 시작 위치 i(따옴표)에서 닫는 따옴표 다음 인덱스를 반환.
// 백슬래시 이스케이프 처리. 템플릿 리터럴(`)의 ${...} 내부 중괄호는 어차피
// 리터럴로 통째로 건너뛰므로 균형 카운트에 영향 없음(오탐 방지 목적 충족).
function skipString(src, i) {
  const quote = src[i];
  let k = i + 1;
  const len = src.length;
  while (k < len) {
    const c = src[k];
    if (c === '\\') { k += 2; continue; } // 이스케이프 문자 스킵
    if (c === quote) return k + 1;
    k++;
  }
  return len; // 닫힘 없으면 끝까지
}

function skipLineComment(src, i) {
  let k = i + 2;
  const len = src.length;
  while (k < len && src[k] !== '\n') k++;
  return k;
}

function skipBlockComment(src, i) {
  let k = i + 2;
  const len = src.length;
  while (k < len) {
    if (src[k] === '*' && src[k + 1] === '/') return k + 2;
    k++;
  }
  return len;
}

// ── FakeDoc — 초경량 가짜 DOM ───────────────────────────────────────
// 브라우저 없이 폼 채우기 로직(getElementsByName로 value/selectedIndex 세팅)을 검증하기 위한 최소 구현.
// fixture HTML에서 name 속성이 있는 input/select/textarea를 정규식으로 파싱해 요소 객체로 만든다.
export function FakeDoc(fixtureHtml) {
  const byName = new Map(); // name → [element, ...]

  const register = (el) => {
    if (!el.name) return;
    if (!byName.has(el.name)) byName.set(el.name, []);
    byName.get(el.name).push(el);
  };

  // input: <input ...> (self-closing, 내용 없음)
  const inputRe = /<input\b([^>]*)>/gi;
  let m;
  while ((m = inputRe.exec(fixtureHtml)) !== null) {
    register(makeInput(m[1]));
  }

  // textarea: <textarea ...>...</textarea>
  const taRe = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi;
  while ((m = taRe.exec(fixtureHtml)) !== null) {
    register(makeTextarea(m[1], m[2]));
  }

  // select: <select ...>...</select> (내부 <option> 파싱)
  const selRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  while ((m = selRe.exec(fixtureHtml)) !== null) {
    register(makeSelect(m[1], m[2]));
  }

  return {
    getElementsByName(name) {
      return byName.get(name) ? byName.get(name).slice() : [];
    },
    querySelector(sel) {
      // input[type=password] 정도만 지원. 없으면 null.
      if (/^input\[type=(['"]?)password\1\]$/i.test(sel.trim())) {
        for (const arr of byName.values()) {
          for (const el of arr) {
            if (el.tagName === 'INPUT' && el.type === 'password') return el;
          }
        }
        return null;
      }
      return null;
    },
    // 동작하는 시늉만(에러 안 나게).
    createElement(tag) {
      return { tagName: String(tag).toUpperCase(), children: [], appendChild() {}, value: '' };
    },
    appendChild() {},
  };
}

// 속성 문자열에서 attr="val" 또는 attr='val' 값을 추출(없으면 undefined).
function attr(attrs, key) {
  const re = new RegExp(key + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i');
  const m = re.exec(attrs);
  if (!m) return undefined;
  return m[1] !== undefined ? m[1] : m[2];
}

function makeInput(attrs) {
  let _value = attr(attrs, 'value') || '';
  const el = {
    tagName: 'INPUT',
    name: attr(attrs, 'name') || '',
    type: (attr(attrs, 'type') || 'text').toLowerCase(),
    get value() { return _value; },
    set value(v) { _value = String(v); },
  };
  return el;
}

function makeTextarea(attrs, inner) {
  let _value = (inner || '');
  const el = {
    tagName: 'TEXTAREA',
    name: attr(attrs, 'name') || '',
    type: 'textarea',
    get value() { return _value; },
    set value(v) { _value = String(v); },
  };
  return el;
}

function makeSelect(attrs, inner) {
  // <option value="..">text</option> 파싱. value 없으면 text를 value로.
  const options = [];
  const optRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let om;
  while ((om = optRe.exec(inner)) !== null) {
    const text = om[2].trim();
    const val = attr(om[1], 'value');
    options.push({ value: val !== undefined ? val : text, text });
  }

  let _selectedIndex = options.length ? 0 : -1;
  let _value = options.length ? options[0].value : '';

  const el = {
    tagName: 'SELECT',
    name: attr(attrs, 'name') || '',
    type: 'select-one',
    options,
    get selectedIndex() { return _selectedIndex; },
    set selectedIndex(i) {
      _selectedIndex = Number(i);
      // set 시 value도 해당 option.value로 동기화.
      if (_selectedIndex >= 0 && _selectedIndex < options.length) {
        _value = options[_selectedIndex].value;
      }
    },
    get value() { return _value; },
    set value(v) {
      _value = String(v);
      // 일치 option 있으면 selectedIndex 동기화.
      const idx = options.findIndex((o) => o.value === _value);
      if (idx >= 0) _selectedIndex = idx;
    },
  };
  return el;
}
