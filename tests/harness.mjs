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
