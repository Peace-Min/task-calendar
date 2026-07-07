// 공용 테스트 하네스 — 의존성 0(Node 내장 모듈만).
// 브라우저 없는 Node에서 앱의 순수 함수 단위테스트 + 폼 채우기 로직 검증을 돕는다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

// ── 테스트 등록·실행 ────────────────────────────────────────────────
// test(name, fn)으로 등록하고 run()으로 일괄 실행. fn은 sync/async 모두 지원.
// 러너(run-tests.mjs)가 *.test.mjs를 전부 import한 뒤 run()을 한 번 호출하는 구조라
// 모든 테스트가 같은 큐에 모인다. import 순서와 무관하게 동작.
const _tests = [];

export function test(name, fn) {
  _tests.push({ name, fn });
}

export async function run() {
  let pass = 0;
  let fail = 0;
  for (const t of _tests) {
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
  console.log(`\n${pass} pass / ${fail} fail`);
  if (fail > 0) process.exitCode = 1;
  return { pass, fail };
}

// assert도 재수출(테스트 파일이 한 곳에서 import하도록 편의 제공).
export { assert };

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
