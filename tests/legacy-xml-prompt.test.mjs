// 이전 버전 기록 감지 · 상단 DB 표시 정리 (2026-09-30 사용자 결정)
//
// 이 파일이 지키는 것:
//   A. 빈 캘린더 + 이 PC 데이터 폴더에 옛 XML → 「가져올까요?」를 **한 번 묻는다**.
//      ★ 묻는 단계는 읽지도 적용하지도 않는다. 「가져오기」를 **눌러야** 호스트가 읽는다(readLegacyXml).
//        그래서 2026-09-01 의 「자동이관 폐기, 명시적 가져오기」(설계 §3b)와 부딪치지 않는다.
//      ★ 「가져오기」 = **바로 교체**(2026-10-01 사용자 결정) — 두 번째 미리보기(#importModal)는 없다.
//        applyImport('replace') → saveFull → replaceAllState. 병합은 이 경로에서 절대 부르지 않는다.
//        누른 순간 캘린더가 비어 있지 않으면(그새 무언가를 적었다) 말없이 지우지 않고 미리보기(병합/교체)로 간다.
//        성공 토스트는 저장이 들어간 뒤 한 번: 「이전 기록을 가져왔습니다 — 과제 N개 · 기록 M개 · 할 일 K개」.
//      ★ ⋯ 메뉴 「XML 가져오기」(startImport → pickImportXml → showImportPreview)는 그대로다(data-source 표시등③).
//      호스트 두 명령:
//        · legacyXmlProbe — 데이터 폴더 최상위 *.xml 의 **이름·크기·시각만**(내용은 읽지 않는다)
//        · readLegacyXml  — 이름만 받아 데이터 폴더 안으로만 푼다(구분자·「..」 거절 · .xml · 64MB)
//      ★ 부팅 조건은 스키마 불일치를 **조용히** 본다(__bootMeta.schemaMismatch) — schemaBlocked() 는 토스트를
//        띄우므로 아무도 누르지 않은 부팅 때 부르면 안 된다. 사용자가 누른 「가져오기」에서만 부른다.
//   B. 상단 DB 배지는 **문제가 있을 때만** 뜬다(스키마 불일치·읽기 전용). 정상 연결 정보는
//      「사용자 정보」의 한 줄로 옮겼다. 안내·배지의 자리는 **제목줄 아래**다(예전엔 위에 떴다).
//
// 검사 함수(checks)를 테스트와 변이 시험이 공유한다 — 검사가 정말 잡는지 증명하기 위해서다.
// 행동 검사는 앱 소스에서 함수를 잘라 node:vm 에서 가짜 전역으로 돌린다(jsdom 불필요).
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { test, skip, assert, loadAppSource, extractFunction, stripCsComments, extractCsMember,
  importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';
import { mutate } from './ps-guard-lib.mjs';

const app = loadAppSource();
const WIDGET_DIR = new URL('../widget/', import.meta.url);
//  ★ 최상위에서 던지지 않는다 — run-tests.mjs 의 import 루프에서 던지면 전 스위트 판정이 증발한다.
//    기준 파일 부재는 아래 '감지⓪' 한 건의 실패로 강등한다.
const missing = [];
function readWidget(name) {
  try { return readFileSync(new URL(name, WIDGET_DIR), 'utf8'); }
  catch (_) { missing.push('widget/' + name); return ''; }
}
const mainwin = readWidget('MainWindow.xaml.cs');
const probeCs = readWidget('LegacyXmlProbe.cs');
let hostAll = [];
try {
  hostAll = readdirSync(WIDGET_DIR).filter((f) => f.endsWith('.cs')).sort()
    .map((f) => ({ name: 'widget/' + f, src: readFileSync(new URL(f, WIDGET_DIR), 'utf8') }));
} catch (_) { missing.push('widget/*.cs'); }

// JS 주석 제거(문자열·템플릿 리터럴은 보존) — 계약이 보는 것은 **호출**이지 설명 글자가 아니다.
function stripJs(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === c) { j++; break; } j++; }
      out += s.slice(i, j); i = j; continue;
    }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}
const fnBody = (src, name) => stripJs(extractFunction(src, name));

// 마크업 블록 — 여는 태그부터 다음 모달 주석 직전까지.
function markupBlock(src, open, endMarker) {
  const s = src.indexOf(open);
  assert.ok(s >= 0, `${open} 를 찾지 못했다`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `${open} 뒤의 ${endMarker} 를 찾지 못했다`);
  return src.slice(s, e);
}

//  물음 경로의 함수 전부(저장소 접근 검사 대상).
const PROMPT_FNS = ['maybeAskLegacyImport', 'showLegacyPrompt', 'legacyPromptImport', 'legacyPromptNever',
  'legacyPromptKey', 'legacyPromptSig', 'legacyPromptDismissed'];
//  그중 **묻기만 하는** 함수 — 이 안에서는 읽기·적용·저장이 **한 글자도** 없어야 한다.
//  (적용은 사용자가 누르는 legacyPromptImport 한 곳뿐이다 — 2026-10-01 바로 교체)
const ASK_ONLY_FNS = PROMPT_FNS.filter((f) => f !== 'legacyPromptImport');
//  성공 토스트 — 결정 문구(2026-10-01)
const OK_TOAST = (c, e, t) => `이전 기록을 가져왔습니다 — 과제 ${c}개 · 기록 ${e}개 · 할 일 ${t}개`;
const SANDBOX_FNS = ['calendarIsEmpty', 'insertBelowTitleBar', 'legacyPromptKey', 'legacyPromptSig',
  'legacyPromptDismissed', 'legacyTimeText', 'legacySizeText', 'maybeAskLegacyImport', 'showLegacyPrompt',
  'legacyPromptImport', 'legacyPromptNever', 'renderEmptyHint', 'renderDataSourceBadge', 'usDbLineText',
  'ensureBootErrorBox', 'showDbConflict', 'schemaServerOlder'];   // schemaServerOlder — 불일치 배지의 방향 판정(S7, 2026-10-01)

// ── 가짜 전역(node:vm) ───────────────────────────────────────────────
//  제목줄(header.topbar) 하나와 그 다음 형제(filterbar)가 있는 최소 DOM. 삽입은 전부 기록한다.
function fakeDom() {
  const inserted = [];
  const byId = new Map();
  const bar = { tag: 'header.topbar', nextSibling: { tag: 'filterbar' } };
  const put = (where) => (el, ref) => { inserted.push({ el, ref, where }); if (el.id) byId.set(el.id, el); };
  bar.parentNode = { insertBefore: put('appSurface') };
  const mkEl = (tag) => {
    const el = { tag, id: '', style: {}, textContent: '', innerHTML: '', children: [], listeners: {},
      appendChild(c) { this.children.push(c); }, addEventListener(k, f) { this.listeners[k] = f; },
      remove() { el.removed = true; byId.delete(el.id); } };
    return el;
  };
  const document = {
    querySelector: (sel) => (sel === 'header.topbar' ? bar : null),
    //  삽입된 상자의 자식(id 가 붙은 span 등)까지 찾는다 — showDbConflict 가 #dbConflictText 를 곧바로 찾는다.
    getElementById: (id) => {
      if (byId.has(id)) return byId.get(id);
      for (const el of byId.values()) { const c = (el.children || []).find((x) => x && x.id === id); if (c) return c; }
      return null;
    },
    createElement: mkEl,
    body: { firstChild: { tag: 'body-first' }, insertBefore: put('body') },
  };
  return { document, inserted, bar, byId };
}

function sandbox(src, over = {}) {
  //  apply — applyImport 호출마다 [mode, quiet, 그 순간의 pendingImport]
  const calls = { host: [], preview: [], open: [], close: [], toast: [], apply: [], save: 0, blocked: 0, guard: 0 };
  const store = new Map();
  const dom = fakeDom();
  const ctx = {
    state: { categories: [], entries: [], todos: [] },
    HOST: true, PEER: false,
    __bootMeta: { userId: 7, schemaMismatch: false, canWrite: true, schemaVersion: '12', rev: 5 },
    currentUser: { loginId: 'hjlee' },
    __legacyPromptTried: false, __legacyProbe: null,
    __replies: {
      legacyXmlProbe: { ok: true, found: true, name: 'old.xml', size: 2048, mtime: '2026-09-01T00:00:00Z' },
      readLegacyXml: { ok: true, name: 'old.xml', text: '<taskCalendar/>' },
    },
    //  진짜 schemaBlocked() 처럼 **부를 때마다 센다** — 막힐 때는 토스트까지 흉내 낸다.
    __blocked: false,
    schemaBlocked: () => { calls.blocked++; if (ctx.__blocked) calls.toast.push(['스키마 불일치', 'error']); return ctx.__blocked; },
    //  연결 잠금 관문 — 진짜처럼 막힐 때 토스트를 띄운다.
    __locked: false,
    guardEdit: () => { calls.guard++; if (ctx.__locked) calls.toast.push(['서버에 연결되지 않아 지금은 편집할 수 없습니다', 'warn']); return ctx.__locked; },
    //  XML 해석 — 'BAD' 로 시작하면 진짜 fromXML 처럼 던진다. 그 밖에는 과제 1 · 기록 2 · 할 일 1.
    pendingImport: null,
    fromXML: (t) => {
      if (/^BAD/.test(String(t))) throw new Error('XML 파싱 오류 — 올바른 XML 파일이 아닙니다.');
      return { categories: [{ id: 'c1' }], entries: [{ id: 'e1' }, { id: 'e2' }], todos: [{ id: 't1' }] };
    },
    //  적용 — 진짜 applyImport('replace') 처럼 state 를 갈아끼우고 saveFull() 의 Promise<boolean> 을 돌려준다.
    //  __applyResult: 'ok' | 'fail'(저장 실패) | 'blocked'(관문에 막혀 undefined)
    __applyResult: 'ok',
    applyImport: (mode, opt) => {
      calls.apply.push([mode, !!(opt && opt.quiet), ctx.pendingImport]);
      if (ctx.__applyResult === 'blocked') return undefined;
      if (mode === 'replace' && ctx.pendingImport) {
        const p = ctx.pendingImport;
        ctx.state = { categories: p.categories.slice(), entries: p.entries.slice(), todos: (p.todos || []).slice() };
      }
      ctx.pendingImport = null;
      return Promise.resolve(ctx.__applyResult === 'ok');
    },
    isDbHost: () => true,
    bootRetry: () => ({ manual() {} }),
    hpost: () => {},
    hostRequest: async (cmd, params) => { calls.host.push([cmd, params || {}]); return ctx.__replies[cmd]; },
    showImportPreview: (n, t) => { calls.preview.push([n, t]); },
    save: () => { calls.save++; },
    saveFull: () => { calls.save++; },
    dbSave: () => { calls.save++; },
    startImport: () => {},
    openModal: (s) => { calls.open.push(s); },
    closeModal: (s) => { calls.close.push(s); },
    toast: (m, k) => { calls.toast.push([m, k]); },
    $: () => ({ innerHTML: '' }),
    esc: (s) => String(s),
    ICON: { file: '' },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
    },
    document: dom.document,
  };
  Object.assign(ctx, over);
  vm.createContext(ctx);
  //  extractFunction 은 'function 이름(' 부터 자른다 — 앞의 async 를 되붙인다(없으면 await 가 문법 오류다).
  const code = SANDBOX_FNS.map((n) => {
    const f = extractFunction(src, n);
    const at = src.indexOf(f);
    return (src.slice(Math.max(0, at - 6), at) === 'async ' ? 'async ' : '') + f;
  }).join('\n');
  vm.runInContext(code, ctx);
  return { ctx, calls, store, dom };
}
const flush = () => new Promise((r) => setImmediate(r));
const probes = (calls) => calls.host.filter(([c]) => c === 'legacyXmlProbe').length;

// ── 검사 ─────────────────────────────────────────────────────────────
const checks = {
  // ── 호스트 ──
  //  H1 두 명령이 디스패치된다(없으면 웹이 불러도 무동작 — 20초 뒤 시간 초과로만 보인다)
  hostDispatch(mw) {
    const code = stripCsComments(mw);
    for (const [name, call] of [
      ['legacyXmlProbe', /ProbeLegacyXml\(GetStr\(doc, "reqId"\)\);/],
      ['readLegacyXml', /ReadLegacyXml\(GetStr\(doc, "reqId"\), GetStr\(doc, "name"\)\);/],
    ]) {
      const s = code.indexOf(`case "${name}":`);
      assert.ok(s >= 0, `호스트에 case "${name}" 이 없다 — 웹이 불러도 무동작이다`);
      const e = code.indexOf('break;', s);
      assert.ok(e > s && call.test(code.slice(s, e)), `case "${name}" 이 구현 함수를 부르지 않는다`);
    }
  },

  //  H2 감지는 **이름·크기·시각만** — 데이터 폴더 최상위 *.xml, 가장 최근 것. 내용은 읽지 않는다.
  probeMetaOnly(cs) {
    const b = extractCsMember(cs, 'private void ProbeLegacyXml(string reqId)');
    assert.ok(/new DirectoryInfo\(_dataDir\)/.test(b), '감지가 데이터 폴더(_dataDir)를 보지 않는다');
    assert.ok(/\.EnumerateFiles\("\*\.xml", SearchOption\.TopDirectoryOnly\)/.test(b),
      '감지가 데이터 폴더 최상위의 *.xml 만 열거하지 않는다(하위 폴더·다른 확장자까지 본다)');
    assert.ok(!/AllDirectories/.test(b), '감지가 하위 폴더까지 훑는다 — 데이터 폴더 최상위만 본다');
    assert.ok(/EndsWith\("\.xml", StringComparison\.OrdinalIgnoreCase\)/.test(b),
      '확장자를 한 번 더 거르지 않는다 — Win32 와일드카드 "*.xml" 은 "a.xmlx" 까지 맞춘다');
    assert.ok(/OrderByDescending\(f => f\.LastWriteTimeUtc\)/.test(b), '가장 최근에 고친 파일을 고르지 않는다');
    assert.ok(!/ReadAll(Text|Bytes|Lines)|ReadLines|OpenRead|OpenText|StreamReader|File\.Open/.test(b),
      '감지가 파일 **내용**을 읽는다 — 묻기 전에 읽으면 그것이 자동이관의 첫걸음이다');
    assert.ok(/found = false/.test(b), '없을 때 { ok:true, found:false } 를 회신하지 않는다');
    assert.ok(/found = true, name = fi\.Name, size = fi\.Length, mtime/.test(b),
      '있을 때 { found, name, size, mtime } 를 회신하지 않는다');
    assert.ok(/LastWriteTimeUtc\.ToString\("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo\.InvariantCulture\)/.test(b),
      'mtime 이 ISO-8601 UTC 가 아니다 — 「다시 묻지 않기」 서명(name|mtime)이 문화권마다 달라진다');
    assert.ok(/Log\(/.test(b), '감지가 로그를 남기지 않는다');
    assert.ok(!/new \{[^}]*\b(path|FullName)\b/.test(b), '감지 회신에 경로가 실린다 — 웹에는 이름만 나간다');
  },

  //  H3 읽기는 이름을 **데이터 폴더 안으로만** 푼다 · .xml · 64MB · UTF-8 · _lastImportPath · 회신 모양
  readValidated(cs, mw) {
    const r = extractCsMember(cs, 'private string? ResolveLegacyXmlPath(string name, out string why)');
    assert.ok(r.includes(String.raw`n.IndexOfAny(new[] { '/', '\\', ':' }) >= 0`),
      '이름에 경로 구분자(/ \\ :)가 있어도 거절하지 않는다 — 웹이 데이터 폴더 밖 파일을 읽게 할 수 있다');
    assert.ok(r.includes('n.Contains("..")'), '이름의 「..」 를 거절하지 않는다 — 상위 폴더로 빠져나간다');
    assert.ok(/EndsWith\("\.xml", StringComparison\.OrdinalIgnoreCase\)/.test(r), '.xml 이 아닌 파일도 읽는다');
    assert.ok(/Path\.GetFullPath\(Path\.Combine\(data, n\)\)/.test(r) &&
      /string\.Equals\(dir, data, StringComparison\.OrdinalIgnoreCase\)/.test(r),
      '푼 경로가 데이터 폴더 **바로 안**인지 확인하지 않는다');
    assert.ok(/File\.Exists\(full\)/.test(r), '파일이 실재하는지 확인하지 않는다');
    const b = extractCsMember(cs, 'private void ReadLegacyXml(string reqId, string name)');
    assert.ok(/ResolveLegacyXmlPath\(name, out string why\)/.test(b) && /if \(path == null\)/.test(b),
      '읽기가 이름 검증(ResolveLegacyXmlPath)을 거치지 않는다');
    assert.ok(/const long LegacyXmlMaxBytes = 64L \* 1024 \* 1024;/.test(stripCsComments(cs)) &&
      /fi\.Length > LegacyXmlMaxBytes/.test(b), '64MB 상한이 없다 — 엉뚱한 큰 파일에 위젯이 굳는다');
    const pick = extractCsMember(mw, 'private void PickImportXml(string reqId)');
    assert.ok(/fi\.Length > 64L \* 1024 \* 1024/.test(pick),
      '파일창 가져오기의 상한이 64MB 가 아니다 — 두 문의 상한이 갈라졌다(함께 바꿀 것)');
    const iNull = b.indexOf('_lastImportPath = null;');
    const iRead = b.indexOf('File.ReadAllText(path, Encoding.UTF8)');
    const iSet = b.indexOf('_lastImportPath = path;');
    assert.ok(iRead > 0, 'UTF-8 로 읽지 않는다');
    assert.ok(iNull >= 0 && iNull < iRead, '읽기 전에 지난 선택(_lastImportPath)을 비우지 않는다 — 실패해도 옛 경로가 남는다');
    assert.ok(iSet > iRead, '읽은 뒤에 개명 대상(_lastImportPath)을 기억하지 않는다 — 이관 뒤 원본이 개명되지 않는다');
    const reply = 'GitReply(reqId, new { ok = true, name = fi.Name, text });';
    assert.ok(b.includes(reply) && pick.includes(reply), '회신 모양이 pickImportXml 과 다르다 — 웹은 한 모양만 안다');
    assert.ok(!/new \{[^}]*\b(path|FullName)\s*=/.test(b), '읽기 회신에 경로가 실린다 — 웹에는 내용만 나간다');
  },

  //  H4 개명 대상(_lastImportPath)을 세우는 곳은 파일창·개명·이 읽기 셋뿐이다(widget/*.cs 전체)
  lastImportPathOwners(hosts) {
    const owners = [
      ['widget/MainWindow.xaml.cs', 'private void PickImportXml(string reqId)'],
      ['widget/MainWindow.xaml.cs', 'private (string, string) RenameImportedSource()'],
      ['widget/LegacyXmlProbe.cs', 'private void ReadLegacyXml(string reqId, string name)'],
    ];
    const count = (s) => (stripCsComments(s).match(/_lastImportPath\s*=(?!=)/g) || []).length;
    const total = hosts.reduce((n, h) => n + count(h.src), 0);
    const mine = owners.reduce((n, [f, sig]) => {
      const h = hosts.find((x) => x.name === f);
      assert.ok(h, f + ' 가 없다');
      return n + count(extractCsMember(h.src, sig));
    }, 0);
    assert.ok(mine > 0, '개명 대상을 세우는 곳을 하나도 찾지 못했다 — 판정 불가');
    assert.strictEqual(total, mine,
      '_lastImportPath 를 파일창·개명·이전 기록 읽기 밖에서도 세운다 — 사용자가 고르지 않은 파일이 개명 대상이 된다');
  },

  // ── 웹 ──
  //  W1 조건: 빈 캘린더 && HOST && !PEER && !schemaBlocked() — 그리고 페이지당 한 번
  triggerGuards(src) {
    const b = fnBody(src, 'maybeAskLegacyImport');
    const at = b.indexOf("hostRequest('legacyXmlProbe'");
    assert.ok(at > 0, "감지가 hostRequest('legacyXmlProbe') 를 부르지 않는다");
    const pre = b.slice(0, at);
    assert.ok(pre.includes('calendarIsEmpty()'), '빈 캘린더 조건이 없다 — 기록이 있는 사람에게도 이관을 묻는다');
    assert.ok(/\bHOST\b/.test(pre), 'HOST 조건이 없다');
    assert.ok(pre.includes('!PEER'), '!PEER 조건이 없다 — 남의 일정 창에서 **내** 이관을 묻는다');
    assert.ok(!/schemaBlocked\(/.test(b),
      '감지 조건이 schemaBlocked() 를 부른다 — 그 함수는 토스트를 띄운다. 부팅 때 아무도 누르지 않았는데 토스트가 뜬다');
    assert.ok(pre.includes('!(__bootMeta && __bootMeta.schemaMismatch)'),
      '스키마 불일치 조건이 없다 — 낡은 위젯이 가져오기를 권한다(전량 교체는 거부된다)');
    assert.ok(/if\(__legacyPromptTried\) return;/.test(pre) && /__legacyPromptTried = true;/.test(pre),
      '페이지당 한 번 가드가 감지보다 앞에 없다 — 재시도·[새로고침] 마다 다시 묻는다');
    //  빈 판정은 안내와 **같은 정의**다
    assert.ok(/calendarIsEmpty\(\)/.test(fnBody(src, 'renderEmptyHint')),
      '빈 캘린더 안내가 calendarIsEmpty() 를 쓰지 않는다 — 두 판정이 갈라진다');
    //  부팅 성공 자리(내 창)에서 부른다
    const boot = stripJs(src.slice(src.indexOf('window.__applyState = function(json, meta){')));
    const fromBoot = boot.slice(0, boot.indexOf('hideDbConflict();'));
    assert.ok(/if\(!PEER\) maybeAskLegacyImport\(\);/.test(fromBoot),
      '부팅 성공 뒤(내 창에서) 감지를 부르지 않는다');
  },

  //  W1' 행동: 조건 하나라도 어기면 호스트에 묻지도 않는다 · 두 번 불러도 한 번만 묻는다
  async triggerBehaves(src) {
    for (const [why, over] of [
      ['기록이 있다', { state: { categories: [{ id: 'c' }], entries: [], todos: [] } }],
      ['브라우저(HOST=false)', { HOST: false }],
      ['남의 일정 창(PEER)', { PEER: true }],
      ['스키마 불일치', { __bootMeta: { userId: 7, schemaMismatch: true, canWrite: true }, __blocked: true }],
    ]) {
      const s = sandbox(src, over);
      await s.ctx.maybeAskLegacyImport();
      assert.strictEqual(probes(s.calls), 0, `${why} 인데 감지를 호스트에 물었다`);
      assert.strictEqual(s.calls.open.length, 0, `${why} 인데 물음 창이 떴다`);
      assert.strictEqual(s.calls.toast.length, 0, `${why} — 부팅 감지가 토스트를 띄웠다(아무도 누르지 않았다)`);
      assert.strictEqual(s.calls.blocked, 0, `${why} — 부팅 감지가 schemaBlocked()(토스트 게이트)를 불렀다`);
    }
    const s = sandbox(src);
    await s.ctx.maybeAskLegacyImport();
    assert.strictEqual(s.calls.blocked, 0, '부팅 감지가 schemaBlocked()(토스트 게이트)를 불렀다');
    await s.ctx.maybeAskLegacyImport();
    assert.strictEqual(probes(s.calls), 1, '페이지당 한 번이 아니다 — 부팅 주입마다 다시 묻는다');
    assert.deepStrictEqual(s.calls.open, ['#legacyModal'], '조건이 맞는데 물음 창이 뜨지 않았다');
    //  없으면 조용히
    const none = sandbox(src, {});
    none.ctx.__replies.legacyXmlProbe = { ok: true, found: false };
    await none.ctx.maybeAskLegacyImport();
    assert.strictEqual(none.calls.open.length, 0, '파일이 없는데 물음 창이 떴다');
  },

  //  W2 묻는 단계는 읽기·적용·저장을 하지 않는다. 「가져오기」(legacyPromptImport)는 **바로 교체**한다:
  //     관문(guardEdit·schemaBlocked) → readLegacyXml → fromXML → 누른 순간 빈 캘린더인가(아니면 미리보기)
  //     → pendingImport → applyImport('replace', {quiet}) → 저장이 들어간 뒤 성공 토스트 한 번.
  promptPathContract(src) {
    for (const fn of ASK_ONLY_FNS) {
      const b = fnBody(src, fn);
      for (const bad of ['applyImport', 'save(', 'replaceAll', 'dbSave', 'saveFull', 'fromXML', 'pendingImport', 'readLegacyXml']) {
        assert.ok(!b.includes(bad),
          `${fn}() 가 ${bad} 를 부른다 — 묻는 단계가 스스로 읽거나 적용·저장하면 그것이 자동이관이다(설계 §3b)`);
      }
    }
    const imp = fnBody(src, 'legacyPromptImport');
    const read = imp.indexOf("hostRequest('readLegacyXml', { name: p.name }");
    assert.ok(read > 0, '「가져오기」가 readLegacyXml 로 이름만 보내지 않는다');
    for (const [gate, why] of [['guardEdit()', '연결 잠금(guardEdit)'], ['schemaBlocked()', '스키마 게이트(schemaBlocked)']]) {
      const g = imp.indexOf(gate);
      assert.ok(g >= 0 && g < read, `「가져오기」가 읽기 전에 ${why}를 거치지 않는다 — 막혀야 할 때 파일을 읽고 전량 교체까지 간다`);
    }
    //  병합·직접 저장·두 번째 미리보기 창은 이 경로에 없다
    assert.ok(!/'merge'|"merge"/.test(imp), '「가져오기」가 병합을 부른다 — 이 경로는 교체 하나다(2026-10-01)');
    for (const bad of ['save(', 'saveFull', 'dbSave', 'replaceAll', 'openModal(', '#importModal']) {
      assert.ok(!imp.includes(bad), `「가져오기」가 ${bad} 를 직접 쓴다 — 적용·저장은 applyImport('replace') 한 문으로, 미리보기 창은 열지 않는다`);
    }
    const parse = imp.indexOf('fromXML(text)');
    const recheck = imp.indexOf('if(!calendarIsEmpty()){ showImportPreview(name, text); return; }');
    const pend = imp.indexOf('pendingImport = data;');
    const apply = imp.indexOf("applyImport('replace', { quiet: true })");
    assert.ok(parse > read, '「가져오기」가 읽은 내용을 fromXML 로 해석하지 않는다');
    assert.ok(/try\{ data = fromXML\(text\); \}catch\(err\)\{ toast\('가져오기 실패: ' \+ err\.message, 'error'\); return; \}/.test(imp),
      '해석 실패를 「가져오기 실패: …」 토스트로 알리고 멈추지 않는다');
    assert.ok(recheck > read,
      '「가져오기」가 누른 순간 빈 캘린더인지 다시 보지 않는다 — 물음이 떠 있는 사이 적은 기록을 교체가 말없이 지운다');
    assert.ok(apply > 0, "「가져오기」가 applyImport('replace', { quiet: true }) 로 바로 교체하지 않는다");
    assert.ok(parse < apply && recheck < apply && pend > recheck && pend < apply,
      '순서가 어긋났다 — 해석 → 빈 캘린더 재확인 → pendingImport → 교체 여야 한다');
    assert.strictEqual((imp.match(/showImportPreview\(/g) || []).length, 1,
      '미리보기는 「비어 있지 않을 때」 한 곳에서만 연다 — 빈 캘린더 경로에서 두 번째 창을 띄우지 않는다');
    assert.ok(imp.includes('saved.then(ok => { if(ok) toast(`이전 기록을 가져왔습니다 — 과제 ${nc}개 · 기록 ${ne}개 · 할 일 ${nt}개`); });'),
      '성공 토스트가 저장이 들어간 뒤(ok) 한 번이 아니거나 문구가 결정과 다르다');
    //  applyImport 쪽: quiet 이면 자기 토스트를 끄고, 저장 결과를 돌려준다
    const ap = fnBody(src, 'applyImport');
    assert.ok(/function applyImport\(mode, opt\)\{/.test(ap), 'applyImport 가 opt 를 받지 않는다');
    assert.ok(ap.includes('if(!quiet) toast(`데이터를 교체했습니다') && ap.includes('if(!quiet) toast(`데이터를 병합했습니다'),
      'applyImport 가 quiet 일 때도 자기 토스트를 띄운다 — 이전 기록 가져오기에 성공 토스트가 둘 뜬다');
    assert.ok(/const saved = saveFull\(\);[^\n]*\n\s*return saved;/.test(ap), 'applyImport 가 saveFull() 의 결과를 돌려주지 않는다');
    const sf = fnBody(src, 'saveFull');
    assert.ok(/return dbSave\(\{ replaceAll: true \}\);/.test(sf), 'saveFull 이 dbSave 의 Promise<boolean> 을 돌려주지 않는다');
    //  배선
    assert.ok(/\$\('#btnLegacyImport'\)\.addEventListener\('click', \(\) => legacyPromptImport\(\)\);/.test(src),
      '「가져오기」 버튼 배선이 끊겼다');
    assert.ok(/\$\('#btnLegacyNever'\)\.addEventListener\('click', \(\) => legacyPromptNever\(\)\);/.test(src),
      '「다시 묻지 않기」 버튼 배선이 끊겼다');
  },

  //  W2' 행동(node:vm): 빈 캘린더 → 읽기 → 바로 교체(병합 0 · 미리보기 0) → 저장 뒤 토스트 한 번.
  //     비어 있지 않으면 미리보기 · 해석 실패는 토스트 · 관문이 막으면 읽지도 않는다 · 저장 실패면 성공 토스트 없음.
  async importBehaves(src) {
    const readCalls = (s) => s.calls.host.filter(([c]) => c === 'readLegacyXml');
    const s = sandbox(src);
    await s.ctx.maybeAskLegacyImport();
    s.calls.toast.length = 0;
    s.ctx.legacyPromptImport();
    await flush(); await flush();
    //  ★ JSON 으로 비교한다 — 인자 객체는 vm 영역에서 만들어져 프로토타입이 달라 deepStrictEqual 이 늘 실패한다.
    assert.strictEqual(JSON.stringify(readCalls(s)), JSON.stringify([['readLegacyXml', { name: 'old.xml' }]]),
      '「가져오기」가 감지한 그 이름으로 읽기를 요청하지 않았다');
    assert.ok(s.calls.apply.every(([m]) => m === 'replace'), '「가져오기」가 병합을 불렀다 — 이 경로는 교체 하나다');
    assert.strictEqual(s.calls.apply.length, 1, '빈 캘린더인데 바로 교체(applyImport)하지 않았다');
    assert.strictEqual(s.calls.apply[0][1], true, '교체를 quiet 로 부르지 않았다 — 「데이터를 교체했습니다」 토스트가 하나 더 뜬다');
    assert.strictEqual(JSON.stringify(s.calls.apply[0][2] && s.calls.apply[0][2].entries), JSON.stringify([{ id: 'e1' }, { id: 'e2' }]),
      'pendingImport 가 해석한 파일 내용이 아니다');
    assert.strictEqual(s.calls.preview.length, 0, '빈 캘린더인데 미리보기(두 번째 창)를 띄웠다');
    assert.ok(!s.calls.open.includes('#importModal'), '빈 캘린더인데 #importModal 을 열었다');
    assert.strictEqual(s.calls.save, 0, '「가져오기」가 applyImport 를 건너뛰고 직접 저장했다');
    assert.ok(s.calls.close.includes('#legacyModal'), '「가져오기」가 물음 창을 닫지 않았다');
    assert.strictEqual(JSON.stringify(s.calls.toast), JSON.stringify([[OK_TOAST(1, 2, 1), undefined]]),
      '성공 토스트가 정확히 한 번(과제 1 · 기록 2 · 할 일 1)이 아니다: ' + JSON.stringify(s.calls.toast));
    //  누른 순간 비어 있지 않다 — 지우지 않고 미리보기로
    const busy = sandbox(src);
    await busy.ctx.maybeAskLegacyImport();
    busy.ctx.state = { categories: [{ id: 'mine' }], entries: [], todos: [] };
    busy.ctx.legacyPromptImport();
    await flush(); await flush();
    assert.strictEqual(busy.calls.apply.length, 0, '물음이 떠 있는 사이 기록을 적었는데(비어 있지 않은데) 바로 교체했다 — 말없이 지운다');
    assert.deepStrictEqual(busy.calls.preview, [['old.xml', '<taskCalendar/>']], '비어 있지 않은데 미리보기(병합/교체 고르기)로 넘기지 않았다');
    //  해석 실패
    const bad = sandbox(src);
    bad.ctx.__replies.readLegacyXml = { ok: true, name: 'old.xml', text: 'BAD<' };
    await bad.ctx.maybeAskLegacyImport();
    bad.ctx.legacyPromptImport();
    await flush(); await flush();
    assert.strictEqual(bad.calls.apply.length + bad.calls.preview.length, 0, '해석이 실패했는데 적용하거나 미리보기를 띄웠다');
    assert.ok(bad.calls.toast.some(([m, k]) => k === 'error' && /^가져오기 실패: XML 파싱 오류/.test(m)), '해석 실패를 「가져오기 실패: …」로 알리지 않는다');
    assert.ok(!bad.calls.open.includes('#legacyModal') || bad.calls.close.includes('#legacyModal'), '해석 실패 뒤 물음 창이 열린 채다');
    //  스키마 게이트 · 연결 잠금 — 읽기 전에 막는다
    for (const [why, key] of [['스키마가 막혔는데', '__blocked'], ['연결이 잠겼는데', '__locked']]) {
      const blk = sandbox(src);
      await blk.ctx.maybeAskLegacyImport();
      blk.calls.toast.length = 0;
      blk.ctx[key] = true;
      blk.ctx.legacyPromptImport();
      await flush(); await flush();
      assert.strictEqual(readCalls(blk).length, 0, `${why} 「가져오기」가 파일을 읽었다`);
      assert.strictEqual(blk.calls.apply.length, 0, `${why} 「가져오기」가 교체했다`);
      assert.ok(blk.calls.toast.length > 0, `${why} 「가져오기」가 사유를 알리지 않았다`);
    }
    //  읽기 실패
    const f = sandbox(src);
    f.ctx.__replies.readLegacyXml = { ok: false, error: '파일이 없습니다' };
    await f.ctx.maybeAskLegacyImport();
    f.ctx.legacyPromptImport();
    await flush(); await flush();
    assert.strictEqual(f.calls.preview.length + f.calls.apply.length, 0, '읽기가 실패했는데 미리보기나 교체가 일어났다');
    assert.ok(f.calls.toast.some(([m, k]) => k === 'error' && /파일이 없습니다/.test(m)), '읽기 실패를 토스트로 알리지 않는다');
    //  저장 실패 · 관문에 막힘 — 성공 토스트 없음(실패는 dbSave·관문이 이미 말한다)
    for (const [why, r] of [['저장이 실패했는데', 'fail'], ['적용이 관문에 막혔는데', 'blocked']]) {
      const x = sandbox(src);
      await x.ctx.maybeAskLegacyImport();
      x.ctx.__applyResult = r;
      x.ctx.legacyPromptImport();
      await flush(); await flush();
      assert.strictEqual(x.calls.apply.length, 1, `${why} — 교체가 불리지 않았다(시험 전제)`);
      assert.ok(!x.calls.toast.some(([m]) => /이전 기록을 가져왔습니다/.test(m)), `${why} 성공 토스트가 떴다`);
    }
  },

  //  W3 「다시 묻지 않기」 = 키 tc.legacyPrompt.dismissed.<userId|loginId|me> · 값 name|mtime · 저장소가 던져도 동작
  async dismissBehaves(src) {
    const fk = (ctxOver) => sandbox(src, ctxOver).ctx.legacyPromptKey();
    assert.strictEqual(fk({}), 'tc.legacyPrompt.dismissed.7', '키가 부팅 meta 의 userId 를 쓰지 않는다');
    assert.strictEqual(fk({ __bootMeta: {} }), 'tc.legacyPrompt.dismissed.hjlee', 'userId 가 없을 때 loginId 로 떨어지지 않는다');
    assert.strictEqual(fk({ __bootMeta: null, currentUser: null }), 'tc.legacyPrompt.dismissed.me', "둘 다 없을 때 'me' 로 떨어지지 않는다");
    const s = sandbox(src);
    await s.ctx.maybeAskLegacyImport();
    s.ctx.legacyPromptNever();
    assert.strictEqual(s.store.get('tc.legacyPrompt.dismissed.7'), 'old.xml|2026-09-01T00:00:00Z',
      '「다시 묻지 않기」가 name|mtime 을 저장하지 않는다');
    assert.ok(s.calls.close.includes('#legacyModal'), '「다시 묻지 않기」가 창을 닫지 않는다');
    //  같은 파일이면 묻지 않고, 다른(또는 고쳐진) 파일이면 다시 묻는다
    const again = sandbox(src, { localStorage: { getItem: (k) => s.store.get(k) ?? null, setItem() {} } });
    await again.ctx.maybeAskLegacyImport();
    assert.strictEqual(again.calls.open.length, 0, '같은 파일인데 다시 물었다');
    const newer = sandbox(src, { localStorage: { getItem: (k) => s.store.get(k) ?? null, setItem() {} } });
    newer.ctx.__replies.legacyXmlProbe = { ok: true, found: true, name: 'old.xml', size: 2048, mtime: '2026-09-20T00:00:00Z' };
    await newer.ctx.maybeAskLegacyImport();
    assert.deepStrictEqual(newer.calls.open, ['#legacyModal'], '그 뒤에 고쳐진 파일인데 묻지 않았다(시각이 서명에 없다)');
    //  저장소가 던지는 환경(시크릿·정책)
    const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const t = sandbox(src, { localStorage: boom });
    await t.ctx.maybeAskLegacyImport();
    assert.deepStrictEqual(t.calls.open, ['#legacyModal'], '저장소가 던지면 물음이 죽는다');
    assert.doesNotThrow(() => t.ctx.legacyPromptNever(), '저장소가 던지면 「다시 묻지 않기」가 예외를 낸다');
    assert.ok(t.calls.close.includes('#legacyModal'), '저장소가 던지면 창이 닫히지 않는다');
  },

  //  W3' 저장소 접근은 전부 try 안이다(정적)
  storageGuarded(src) {
    for (const fn of PROMPT_FNS) {
      const b = fnBody(src, fn);
      const n = (b.match(/localStorage\./g) || []).length;
      const guarded = (b.match(/try\{[^}]*localStorage\.[^}]*\}catch/g) || []).length;
      assert.strictEqual(n, guarded, `${fn}() 의 localStorage 접근이 try 밖에 있다 — 저장소가 막힌 환경에서 죽는다`);
    }
  },

  //  W4 안내·배지는 제목줄 **아래**에 들어간다
  placementBelowTitleBar(src) {
    const ins = fnBody(src, 'insertBelowTitleBar');
    assert.ok(/querySelector\('header\.topbar'\)/.test(ins) && /nextSibling/.test(ins),
      '삽입 기준이 제목줄 다음 자리가 아니다');
    for (const [fn, v] of [['renderEmptyHint', 'b'], ['renderDataSourceBadge', 'b'], ['ensureBootErrorBox', 'box'], ['showDbConflict', 'b']]) {
      const b = fnBody(src, fn);
      assert.ok(new RegExp('insertBelowTitleBar\\(' + v + '\\)').test(b), `${fn}() 가 제목줄 아래에 넣지 않는다`);
      assert.ok(!/firstChild/.test(b) && !/'\.wrap'/.test(b),
        `${fn}() 가 아직 맨 앞(firstChild)에 넣는다 — 제목줄 **위**에 뜬다(스크린샷의 그 결함)`);
    }
    //  행동: 빈 캘린더 안내가 제목줄 다음 자리로 들어간다
    const s = sandbox(src);
    s.ctx.renderEmptyHint();
    assert.strictEqual(s.dom.inserted.length, 1, '빈 캘린더 안내가 들어가지 않았다');
    assert.strictEqual(s.dom.inserted[0].ref, s.dom.bar.nextSibling, '빈 캘린더 안내가 제목줄 바로 아래가 아니다');
    assert.notStrictEqual(s.dom.inserted[0].where, 'body', '빈 캘린더 안내가 body 맨 앞(제목줄 위)에 들어갔다');
    //  부팅 실패 상자 · 충돌 안내도 같은 자리
    for (const [what, run, id] of [
      ['부팅 실패 상자', (c) => c.ensureBootErrorBox(), 'dsError'],
      ['충돌 안내', (c) => c.showDbConflict('다른 곳에서 먼저 수정되었습니다'), 'dbConflict'],
    ]) {
      const x = sandbox(src);
      run(x.ctx);
      assert.strictEqual(x.dom.inserted.length, 1, `${what}가 들어가지 않았다`);
      assert.strictEqual(x.dom.inserted[0].el.id, id);
      assert.strictEqual(x.dom.inserted[0].ref, x.dom.bar.nextSibling, `${what}가 제목줄 바로 아래가 아니다`);
      assert.notStrictEqual(x.dom.inserted[0].where, 'body', `${what}가 body 맨 앞(제목줄 위)에 들어갔다`);
    }
    //  죽은 .wrap 폴백이 앱 어디에도 남지 않는다(이 앱에는 .wrap 이 없다 — 남으면 곧 body 맨 앞이다)
    assert.ok(!/querySelector\('\.wrap'\)/.test(src), "querySelector('.wrap') 폴백이 남아 있다 — 그 상자는 제목줄 위에 뜬다");
  },

  //  W5 배지는 문제가 있을 때만(불일치 = 빨강 · 읽기 전용) — 정상이면 없다(있으면 걷는다)
  badgeOnlyWhenWrong(src) {
    const ok = sandbox(src);
    ok.ctx.renderDataSourceBadge({ schemaMismatch: false, canWrite: true, schemaVersion: '12', rev: 3 });
    assert.strictEqual(ok.dom.inserted.length, 0, '정상 상태인데 배지가 뜬다 — 문제 있을 때만 띄운다(2026-09-30)');
    const bad = sandbox(src);
    bad.ctx.renderDataSourceBadge({ schemaMismatch: true, schemaVersion: '13', expectedSchema: '12', rev: 3, canWrite: true });
    assert.strictEqual(bad.dom.inserted.length, 1, '스키마 불일치인데 배지가 뜨지 않는다');
    const el = bad.dom.inserted[0].el;
    assert.ok(/서버 스키마 v13/.test(el.textContent) && /위젯 업데이트 필요/.test(el.textContent) && /차단/.test(el.textContent),
      '불일치 배지 문구가 달라졌다: ' + el.textContent);
    assert.strictEqual(el.style.borderColor, 'var(--danger)', '불일치 배지가 경고 톤(--danger)이 아니다');
    assert.strictEqual(bad.dom.inserted[0].ref, bad.dom.bar.nextSibling, '배지가 제목줄 바로 아래가 아니다');
    //  정상으로 돌아오면 걷는다
    bad.ctx.renderDataSourceBadge({ schemaMismatch: false, canWrite: true });
    assert.ok(el.removed, '정상으로 돌아왔는데 배지가 남았다');
    const ro = sandbox(src);
    ro.ctx.renderDataSourceBadge({ schemaMismatch: false, canWrite: false });
    assert.strictEqual(ro.dom.inserted.length, 1, '읽기 전용인데 배지가 뜨지 않는다');
    assert.ok(/DB 읽기 전용/.test(ro.dom.inserted[0].el.textContent), '읽기 전용 배지 문구가 없다');
  },

  //  W6 정상 연결 정보는 「사용자 정보」의 한 줄로 옮겼다
  userInfoDbLine(src) {
    const md = markupBlock(src, '<div class="overlay hidden" id="userModal">', '<!-- ===== 구성원 =====');
    assert.ok(/<div class="set-hint hidden" id="usDbLine"/.test(md), '「사용자 정보」에 DB 한 줄(#usDbLine)이 없다');
    const u = fnBody(src, 'updateUserUi');
    assert.ok(/usDbLineText\(__bootMeta\)/.test(u) && /set\('usDbLine', dbl\)/.test(u),
      'updateUserUi 가 DB 한 줄을 채우지 않는다(값은 textContent 로)');
    const s = sandbox(src);
    assert.strictEqual(s.ctx.usDbLineText({ schemaVersion: '12', rev: 5, canWrite: true }), '캘린더 DB 연결됨 · 스키마 v12 · rev 5');
    assert.strictEqual(s.ctx.usDbLineText(null), '', '부팅 meta 가 없는데 연결됨이라고 말한다');
  },

  //  W7 물음 창 마크업 — 문구·버튼·닫기 경로·토큰만
  modalMarkup(src) {
    const md = markupBlock(src, '<div class="overlay hidden" id="legacyModal">', '<!-- ===== 확인 모달');
    assert.ok(md.includes('<h2>이전 버전 기록을 찾았습니다</h2>'), '제목이 다르다');
    assert.ok(md.includes('이 PC에 이전 버전(XML 저장)에서 쓰던 기록 파일이 있습니다. 「가져오기」를 누르면 이 파일의 기록으로 캘린더를 채우고, 원본 파일은 이름 끝에 「.migrated-날짜」가 붙어 그대로 보관됩니다.'),
      '안내 문장이 결정 문구(2026-10-01)와 다르다');
    assert.ok(!/「교체」|병합/.test(md), '물음 창이 아직 병합/교체 고르기를 말한다 — 이 창의 「가져오기」는 바로 교체다');
    //  세 버튼의 순서: 다시 묻지 않기 · 나중에 · 가져오기
    const iN = md.indexOf('id="btnLegacyNever"'), iL = md.indexOf('data-close>나중에<'), iI = md.indexOf('id="btnLegacyImport"');
    assert.ok(iN > 0 && iN < iL && iL < iI, '버튼 순서가 다시 묻지 않기 · 나중에 · 가져오기 가 아니다');
    assert.ok(/id="btnLegacyNever"[^>]*>다시 묻지 않기</.test(md), '「다시 묻지 않기」 버튼이 없다');
    assert.ok(/<button class="btn" data-close>나중에<\/button>/.test(md), '「나중에」가 그냥 닫기가 아니다');
    assert.ok(/<button class="btn primary" id="btnLegacyImport"[^>]*>가져오기</.test(md), '「가져오기」(주 버튼)가 없다');
    assert.ok(/<button class="x" data-close aria-label="닫기">×<\/button>/.test(md), '× 닫기가 없다(Esc·× = 나중에)');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(md), '물음 창에 하드코딩 hex 색이 있다 — var(--토큰)만 쓸 것');
    assert.ok(!/onclick/i.test(md), '물음 창에 인라인 onclick 이 있다 — 배선은 bind() 한 곳');
    const show = fnBody(src, 'showLegacyPrompt');
    assert.ok(/esc\(p\.name\)/.test(show), '파일 이름을 이스케이프하지 않는다(innerHTML)');
    assert.ok(/legacyTimeText\(p\.mtime\)/.test(show) && /legacySizeText\(p\.size\)/.test(show), '시각·크기를 보여 주지 않는다');
    const s = sandbox(src);
    assert.match(s.ctx.legacyTimeText('2026-09-01T00:00:00Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '시각이 YYYY-MM-DD HH:mm 이 아니다');
    assert.strictEqual(s.ctx.legacyTimeText('nope'), '—');
    assert.strictEqual(s.ctx.legacySizeText(2048), '2 KB');
  },
};

// ── 등록 ─────────────────────────────────────────────────────────────
test('감지⓪: 기준 파일이 실재한다(개명되면 조용히 넘어가지 않는다)', () => {
  assert.deepStrictEqual(missing, [], '기준 파일을 읽지 못했다: ' + missing.join(', '));
});
test('감지①(호스트): legacyXmlProbe · readLegacyXml 두 명령이 디스패치된다', () => checks.hostDispatch(mainwin));
test('감지②(호스트): 감지는 데이터 폴더 최상위 *.xml 의 이름·크기·시각만 — 내용은 읽지 않는다', () => checks.probeMetaOnly(probeCs));
test('감지③(호스트): 읽기는 이름을 데이터 폴더 안으로만 푼다 · .xml · 64MB · UTF-8 · 회신은 pickImportXml 과 같다', () =>
  checks.readValidated(probeCs, mainwin));
test('감지④(호스트): 개명 대상(_lastImportPath)을 세우는 곳은 파일창·개명·이전 기록 읽기뿐이다(widget/*.cs 전체)', () =>
  checks.lastImportPathOwners(hostAll));
test('감지⑤(웹): 조건 = 빈 캘린더 && HOST && !PEER && 스키마 불일치 아님(조용히 — schemaBlocked() 미호출) · 페이지당 한 번 · 부팅 성공 뒤', () => checks.triggerGuards(app));
test('감지⑥(웹·행동): 조건을 어기면 묻지도 않고(불일치 포함 · 토스트 0), 두 번 불러도 한 번만 묻는다', () => checks.triggerBehaves(app));
test('감지⑦(웹): 묻는 단계는 읽기·적용·저장 0 · 「가져오기」는 관문 → readLegacyXml → 해석 → 빈 캘린더 재확인 → 교체(병합·미리보기 창 없음)', () => checks.promptPathContract(app));
test('감지⑧(웹·행동): 「가져오기」 빈 캘린더 → 바로 교체 + 토스트 1회 · 비어 있지 않으면 미리보기 · 해석/읽기 실패·관문은 교체 0', () => checks.importBehaves(app));
test('감지⑨(웹·행동): 「다시 묻지 않기」는 name|mtime 으로 그 파일에만 · 저장소가 던져도 동작', () => checks.dismissBehaves(app));
test('감지⑩(웹): 물음 경로의 저장소 접근은 전부 try 안이다', () => checks.storageGuarded(app));
test('감지⑪(웹): 물음 창 마크업 — 결정 문구·세 버튼·닫기 경로·토큰만', () => checks.modalMarkup(app));
test('상단①(웹): 빈 캘린더 안내·DB 배지·부팅 실패 상자·충돌 안내는 제목줄 아래에 들어간다', () => checks.placementBelowTitleBar(app));
test('상단②(웹): DB 배지는 문제가 있을 때만(불일치=빨강·읽기 전용) — 정상이면 없다', () => checks.badgeOnlyWhenWrong(app));
test('상단③(웹): 정상 연결 정보는 「사용자 정보」의 한 줄로 옮겼다', () => checks.userInfoDbLine(app));

// ── 변이 시험 — 게이트가 정말 발화하는지 ─────────────────────────────
test('변이⑩a: 감지 조건에서 !PEER 를 빼면 감지⑤·⑥ 이 실패한다', async () => {
  const bad = mutate(app, 'calendarIsEmpty() && HOST && !PEER && !(__bootMeta', 'calendarIsEmpty() && HOST && !(__bootMeta');
  assert.throws(() => checks.triggerGuards(bad), /!PEER 조건이 없다/);
  await assert.rejects(() => checks.triggerBehaves(bad), /남의 일정 창\(PEER\) 인데/);
});

test('변이⑩b: 「가져오기」가 병합을 부르면 감지⑦·⑧ 이 실패한다', async () => {
  const bad = mutate(app, "applyImport('replace', { quiet: true })", "applyImport('merge', { quiet: true })");
  assert.throws(() => checks.promptPathContract(bad), /병합을 부른다/);
  await assert.rejects(() => checks.importBehaves(bad), /병합을 불렀다/);
});

test('변이⑩b2: 누른 순간의 빈 캘린더 재확인을 빼면 감지⑦·⑧ 이 실패한다(그새 적은 기록을 말없이 지운다)', async () => {
  const bad = mutate(app, '    if(!calendarIsEmpty()){ showImportPreview(name, text); return; }   // 그새 무언가를 적었다', '    //');
  assert.throws(() => checks.promptPathContract(bad), /빈 캘린더인지 다시 보지 않는다/);
  await assert.rejects(() => checks.importBehaves(bad), /비어 있지 않은데\) 바로 교체했다/);
});

test('변이⑩b3: 빈 캘린더 경로에서 미리보기를 띄우면 감지⑦·⑧ 이 실패한다(두 번째 창 부활)', async () => {
  const bad = mutate(app, "    pendingImport = data;                                              // showImportPreview",
    "    showImportPreview(name, text); pendingImport = data;               // showImportPreview");
  assert.throws(() => checks.promptPathContract(bad), /두 번째 창을 띄우지 않는다/);
  await assert.rejects(() => checks.importBehaves(bad), /빈 캘린더인데 미리보기/);
});

test('변이⑩b4: 옛 동작(늘 미리보기로만)으로 되돌리면 감지⑦·⑧ 이 실패한다', async () => {
  const bad = mutate(app, '    if(!calendarIsEmpty()){ showImportPreview(name, text); return; }',
    '    if(true){ showImportPreview(name, text); return; }');
  assert.throws(() => checks.promptPathContract(bad), /빈 캘린더인지 다시 보지 않는다/);
  await assert.rejects(() => checks.importBehaves(bad), /바로 교체\(applyImport\)하지 않았다/);
});

test('변이⑩b5: 성공 토스트를 저장 결과와 무관하게 띄우면 감지⑦·⑧ 이 실패한다', async () => {
  const bad = mutate(app, 'saved.then(ok => { if(ok) toast(`이전 기록을', 'saved.then(ok => { toast(`이전 기록을');
  assert.throws(() => checks.promptPathContract(bad), /저장이 들어간 뒤\(ok\) 한 번이 아니거나/);
  await assert.rejects(() => checks.importBehaves(bad), /저장이 실패했는데 성공 토스트가 떴다/);
});

test('변이⑩b6: 해석 실패를 삼키고 진행하면 감지⑦·⑧ 이 실패한다', async () => {
  const bad = mutate(app, "    try{ data = fromXML(text); }catch(err){ toast('가져오기 실패: ' + err.message, 'error'); return; }",
    '    try{ data = fromXML(text); }catch(err){ data = { categories:[], entries:[], todos:[] }; }');
  assert.throws(() => checks.promptPathContract(bad), /해석 실패를/);
  await assert.rejects(() => checks.importBehaves(bad), /해석이 실패했는데 적용하거나/);
});

test('변이⑩c: readLegacyXml 이 경로 구분자·「..」 를 받아들이면 감지③ 이 실패한다', () => {
  const bad = mutate(probeCs, String.raw`n.IndexOfAny(new[] { '/', '\\', ':' }) >= 0 || n.Contains("..") ||`, '');
  assert.throws(() => checks.readValidated(bad, mainwin), /경로 구분자/);
});

test('변이⑩d: 정상 상태에서도 배지를 띄우면 상단② 가 실패한다', () => {
  const bad = mutate(app, '  if(!mismatch && !readOnly){ if(b) b.remove(); return; }   // 정상 — 배지 없음\n', '');
  assert.throws(() => checks.badgeOnlyWhenWrong(bad), /정상 상태인데 배지가 뜬다/);
});

test('변이⑩e: 감지가 파일 내용을 읽으면 감지② 가 실패한다', () => {
  const bad = mutate(probeCs, '                string mtime = ', '                File.ReadAllText(fi.FullName);\r\n                string mtime = ');
  assert.throws(() => checks.probeMetaOnly(bad), /내용\*\*을 읽는다/);
});

test('변이⑩f: 페이지당 한 번 가드를 없애면 감지⑤·⑥ 이 실패한다', async () => {
  const bad = mutate(app, '  if(__legacyPromptTried) return;\n  __legacyPromptTried = true;\n', '');
  assert.throws(() => checks.triggerGuards(bad), /페이지당 한 번 가드/);
  await assert.rejects(() => checks.triggerBehaves(bad), /페이지당 한 번이 아니다/);
});

test('변이⑩g: 「다시 묻지 않기」 서명에서 시각을 빼면 감지⑨ 가 실패한다(고쳐진 파일을 다시 묻지 않는다)', async () => {
  const bad = mutate(app, "function legacyPromptSig(p){ return String((p && p.name) || '') + '|' + String((p && p.mtime) || ''); }",
    "function legacyPromptSig(p){ return String((p && p.name) || ''); }");
  await assert.rejects(() => checks.dismissBehaves(bad), /name\|mtime 을 저장하지 않는다/);
});

test('변이⑩h: 저장소 읽기를 try 밖으로 빼면 감지⑨·⑩ 이 실패한다', async () => {
  const bad = mutate(app, '  try{ return localStorage.getItem(legacyPromptKey()) === legacyPromptSig(p); }catch(_){ return false; }',
    '  return localStorage.getItem(legacyPromptKey()) === legacyPromptSig(p);');
  assert.throws(() => checks.storageGuarded(bad), /try 밖에 있다/);
  await assert.rejects(() => checks.dismissBehaves(bad), /denied|물음이 죽는다/);
});

test('변이⑩i: 안내를 다시 맨 앞(제목줄 위)에 넣으면 상단① 이 실패한다', () => {
  const bad = mutate(app, '  insertBelowTitleBar(b);                           // 제목줄 아래',
    '  document.body.insertBefore(b, document.body.firstChild);   // 제목줄 아래');
  assert.throws(() => checks.placementBelowTitleBar(bad), /renderEmptyHint\(\) 가 제목줄 아래에 넣지 않는다/);
});

test('변이⑩j: 다른 .cs 가 _lastImportPath 를 세우면 감지④ 가 실패한다', () => {
  const planted = hostAll.map((h) => h.name === 'widget/Reminders.cs'
    ? { name: h.name, src: h.src + '\nclass X { void Y() { _lastImportPath = "x"; } }\n' } : h);
  assert.ok(planted.some((h) => h.name === 'widget/Reminders.cs'), 'Reminders.cs 앵커가 없다 — 다른 .cs 로 갱신할 것');
  assert.throws(() => checks.lastImportPathOwners(planted), /밖에서도 세운다/);
});

test('변이⑩k: 감지 조건을 토스트 게이트 schemaBlocked() 로 되돌리면 감지⑤·⑥ 이 실패한다(부팅 토스트)', async () => {
  const bad = mutate(app, '!(__bootMeta && __bootMeta.schemaMismatch))) return;', '!schemaBlocked())) return;');
  assert.throws(() => checks.triggerGuards(bad), /토스트를 띄운다/);
  await assert.rejects(() => checks.triggerBehaves(bad), /토스트/);
});

test('변이⑩l: 감지 조건에서 스키마 불일치를 빼면 감지⑤·⑥ 이 실패한다', async () => {
  const bad = mutate(app, ' && !(__bootMeta && __bootMeta.schemaMismatch))) return;', ')) return;');
  assert.throws(() => checks.triggerGuards(bad), /스키마 불일치 조건이 없다/);
  await assert.rejects(() => checks.triggerBehaves(bad), /스키마 불일치 인데 감지를 호스트에 물었다/);
});

test('변이⑩m: 「가져오기」의 스키마 게이트를 빼면 감지⑦·⑧ 이 실패한다', async () => {
  const bad = mutate(app, '  if(!p || guardEdit() || schemaBlocked()) return;\n', '  if(!p || guardEdit()) return;\n');
  assert.throws(() => checks.promptPathContract(bad), /스키마 게이트\(schemaBlocked\)를 거치지 않는다/);
  await assert.rejects(() => checks.importBehaves(bad), /스키마가 막혔는데 「가져오기」가 파일을 읽었다/);
});

test('변이⑩m2: 「가져오기」의 연결 잠금 관문을 빼면 감지⑦·⑧ 이 실패한다', async () => {
  const bad = mutate(app, '  if(!p || guardEdit() || schemaBlocked()) return;\n', '  if(!p || schemaBlocked()) return;\n');
  assert.throws(() => checks.promptPathContract(bad), /연결 잠금\(guardEdit\)를 거치지 않는다/);
  await assert.rejects(() => checks.importBehaves(bad), /연결이 잠겼는데 「가져오기」가 파일을 읽었다/);
});

test('변이⑩n: 부팅 실패 상자·충돌 안내를 다시 맨 앞(제목줄 위)에 넣으면 상단① 이 실패한다', () => {
  const bad1 = mutate(app, '  insertBelowTitleBar(box);                         // 제목줄 아래',
    '  document.body.insertBefore(box, document.body.firstChild);   // 제목줄 아래');
  assert.throws(() => checks.placementBelowTitleBar(bad1), /ensureBootErrorBox\(\) 가 제목줄 아래에 넣지 않는다/);
  const bad2 = mutate(app, '    insertBelowTitleBar(b);                         // 제목줄 아래(insertBelowTitleBar 머리말)\n  }\n  document.getElementById(\'dbConflictText\')',
    '    document.body.insertBefore(b, document.body.firstChild);\n  }\n  document.getElementById(\'dbConflictText\')');
  assert.throws(() => checks.placementBelowTitleBar(bad2), /showDbConflict\(\) 가 제목줄 아래에 넣지 않는다/);
});

// ── 실행(jsdom 위젯 모드) — 진짜 앱 전체로 「가져오기」 = 바로 교체를 끝까지 돌린다 ──────────
//  node:vm 검사는 함수를 잘라 가짜 applyImport 로 돈다. 여기서는 진짜 fromXML·applyImport·saveFull·dbSave 가
//  돌고, 호스트로 나간 replaceAllState 의 내용과 실제 토스트를 본다(offline-web 과 같은 부팅 방식).
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('legacy-xml-prompt: jsdom 미설치 — 실행 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const EMPTY = { categories: [], entries: [], todos: [], rooms: ['201호'] };
  //  과제 1 · 기록 2 · 할 일 1 짜리 옛 XML(taskCalendar v1)
  const LEGACY_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<taskCalendar version="1">' +
    '<categories><category id="c1" createdAt="2026-08-01T00:00:00Z"><name>옛 과제</name></category></categories>' +
    '<entries>' +
    '<entry id="e1" date="2026-08-03" categoryId="c1" allDay="true"><title>옛 기록 1</title></entry>' +
    '<entry id="e2" date="2026-08-04" categoryId="c1" allDay="true"><title>옛 기록 2</title></entry>' +
    '</entries>' +
    '<todos><todo id="t1" due="2026-08-05"><text>옛 할 일</text></todo></todos>' +
    '</taskCalendar>';

  function boot(source) {
    const log = [];
    const handlers = {};
    const dom = new JSDOM(source, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://tcapp.local/',
      virtualConsole: jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined,
      beforeParse(win) {
        win.chrome = { webview: {
          postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} log.push({ post: o && o.cmd, msg: o }); },
          addEventListener() {}, removeEventListener() {},
        } };
        if (typeof win.crypto === 'undefined') {
          win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        }
        win.scrollTo = () => {};
        //  타이머는 흐르지 않는다(토스트 자동 닫힘·재시도 타이머가 시험 밖으로 새지 않게)
        win.setTimeout = () => 0;
        win.clearTimeout = () => {};
      },
    });
    const w = dom.window;
    w.__fakeReply = (cmd, params) => {
      log.push({ req: cmd, params });
      const h = handlers[cmd];
      const r = typeof h === 'function' ? h(params) : h;
      return Promise.resolve(r === undefined ? { ok: false, error: 'no handler' } : r);
    };
    w.eval('hostRequest = function(cmd, params){ return window.__fakeReply(cmd, params || {}); };');
    w.eval('(function(){ var t = toast; toast = function(m, k, a, ms){ window.__fakeToast(String(m), k); return t(m, k, a, ms); }; })();');
    w.eval('(function(){ var o = openModal; openModal = function(sel){ window.__fakeOpen(typeof sel === "string" ? sel : (sel && sel.id)); return o(sel); }; })();');
    w.__fakeToast = (m, k) => log.push({ toast: m, kind: k === undefined ? 'success' : k });
    w.__fakeOpen = (sel) => log.push({ open: sel });
    const sess = log.find((x) => x.post === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.msg.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'hjlee', name: '이현진' } }) + ')');
    return {
      w, log, handlers,
      ev: (code) => w.eval(code),
      reqs: (cmd) => log.filter((x) => x.req === cmd),
      toasts: () => log.filter((x) => x.toast),
      opened: () => log.filter((x) => x.open).map((x) => x.open),
      el: (id) => w.document.getElementById(id),
      isOpen: (id) => { const e = w.document.getElementById(id); return !!e && !e.classList.contains('hidden') && !e.classList.contains('closing'); },
      applyState: (data, meta = META) => w.eval('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(meta) + ')'),
      clear: () => { log.length = 0; },
      close: () => { try { w.close(); } catch (_) {} },
    };
  }
  //  빈 캘린더로 부팅 → 물음 창이 뜬 상태까지. replaceAll = replaceAllState 회신.
  async function bootToPrompt(source, replaceAll) {
    const W = boot(source);
    W.handlers.legacyXmlProbe = { ok: true, found: true, name: 'old.xml', size: 4096, mtime: '2026-09-01T00:00:00Z' };
    W.handlers.readLegacyXml = { ok: true, name: 'old.xml', text: LEGACY_XML };
    W.handlers.replaceAllState = replaceAll;
    W.applyState(EMPTY);
    await settle();
    assert.ok(W.isOpen('legacyModal'), '빈 캘린더 + 옛 XML 인데 물음 창이 뜨지 않았다(시험 전제)');
    W.clear();
    return W;
  }

  const runtime = {
    //  성공: 읽기 → 진짜 교체 → replaceAllState 한 번(내용 = 파일) → 성공 토스트 정확히 한 번 · 미리보기 창 없음
    async replacesDirectly(source) {
      const W = await bootToPrompt(source, { ok: true });
      try {
        W.el('btnLegacyImport').click();
        await settle();
        const order = W.log.filter((x) => x.req).map((x) => x.req);
        assert.ok(order.indexOf('readLegacyXml') >= 0 && order.indexOf('readLegacyXml') < order.indexOf('replaceAllState'),
          '읽기(readLegacyXml) 뒤에 전량 교체(replaceAllState)가 나가지 않았다: ' + order.join(','));
        assert.strictEqual(W.reqs('readLegacyXml')[0].params.name, 'old.xml', '감지한 그 이름으로 읽지 않았다');
        assert.strictEqual(W.reqs('replaceAllState').length, 1, '전량 교체가 정확히 한 번 나가지 않았다');
        assert.strictEqual(W.reqs('saveState').length, 0, '교체가 통상(차분) 저장으로 나갔다');
        const sent = W.reqs('replaceAllState')[0].params.state;
        assert.deepStrictEqual(JSON.parse(JSON.stringify([sent.categories.map((c) => c.id), sent.entries.map((e) => e.id), sent.todos.map((t) => t.id)])),
          [['c1'], ['e1', 'e2'], ['t1']], '호스트로 보낸 상태가 파일 내용(과제 1 · 기록 2 · 할 일 1)이 아니다');
        assert.strictEqual(W.ev('JSON.stringify([state.categories.length, state.entries.length, state.todos.length])'), '[1,2,1]',
          '화면 상태가 파일 내용으로 바뀌지 않았다');
        assert.ok(!W.opened().includes('#importModal') && !W.isOpen('importModal'), '바로 교체 경로인데 미리보기(#importModal)가 열렸다');
        assert.ok(!W.isOpen('legacyModal'), '물음 창이 닫히지 않았다');
        const ok = W.toasts().filter((x) => x.kind === 'success').map((x) => x.toast);
        assert.deepStrictEqual(ok, [OK_TOAST(1, 2, 1)], '성공 토스트가 정확히 한 번(과제 1 · 기록 2 · 할 일 1)이 아니다: ' + JSON.stringify(ok));
        assert.ok(!W.toasts().some((x) => /데이터를 (교체|병합)했습니다/.test(x.toast)), 'applyImport 의 교체/병합 토스트가 함께 떴다');
        assert.ok(!W.el('emptyHint'), '교체 뒤에도 빈 캘린더 안내가 남았다');
      } finally { W.close(); }
    },
    //  저장 실패: 성공 토스트 없음 — 실패 처리(저장 실패 토스트)만
    async failSaysNothingMore(source) {
      const W = await bootToPrompt(source, { ok: false, error: '쓰기 거부' });
      try {
        W.el('btnLegacyImport').click();
        await settle();
        assert.strictEqual(W.reqs('replaceAllState').length, 1, '교체 저장이 나가지 않았다(시험 전제)');
        assert.ok(!W.toasts().some((x) => /이전 기록을 가져왔습니다/.test(x.toast)), '저장이 실패했는데 성공 토스트가 떴다');
        assert.ok(W.toasts().some((x) => x.kind === 'error' && /저장 실패 — 쓰기 거부/.test(x.toast)), '저장 실패를 기존 실패 처리가 알리지 않았다');
      } finally { W.close(); }
    },
    //  누른 순간 비어 있지 않다 → 지우지 않고 늘 쓰던 미리보기(병합/교체)로
    async nonEmptyGoesToPreview(source) {
      const W = await bootToPrompt(source, { ok: true });
      try {
        W.ev("state.categories.push({ id: 'mine', name: '방금 만든 과제', color: '', desc: '', gitRepo: '', svnRepo: '', createdAt: '' })");
        W.el('btnLegacyImport').click();
        await settle();
        assert.strictEqual(W.reqs('replaceAllState').length, 0, '비어 있지 않은데 바로 교체했다 — 방금 만든 과제를 말없이 지운다');
        assert.ok(W.opened().includes('#importModal') && W.isOpen('importModal'), '비어 있지 않은데 미리보기(병합/교체)를 열지 않았다');
        assert.strictEqual(W.ev("state.categories.map(c => c.id).join(',')"), 'mine', '미리보기 전에 상태가 바뀌었다');
      } finally { W.close(); }
    },
  };

  test('실행①(jsdom): 빈 캘린더 「가져오기」 → readLegacyXml → 진짜 교체(replaceAllState 1회, 내용=파일) · 성공 토스트 1회 · 미리보기 창 없음',
    () => runtime.replacesDirectly(app));
  test('실행②(jsdom): 교체 저장이 실패하면 성공 토스트 없이 기존 실패 처리만', () => runtime.failSaysNothingMore(app));
  test('실행③(jsdom): 누른 순간 비어 있지 않으면 교체하지 않고 미리보기(병합/교체)로', () => runtime.nonEmptyGoesToPreview(app));
  test('실행④(jsdom): ⋯ 메뉴 「XML 가져오기」는 그대로 미리보기(병합/교체)를 연다', async () => {
    const W = boot(app);
    try {
      W.handlers.legacyXmlProbe = { ok: true, found: false };
      W.handlers.pickImportXml = { ok: true, name: 'pick.xml', text: LEGACY_XML };
      W.applyState(EMPTY);
      await settle();
      W.clear();
      W.ev('startImport()');
      await settle();
      assert.strictEqual(W.reqs('pickImportXml').length, 1, '⋯ 메뉴 가져오기가 호스트 파일창을 열지 않았다');
      assert.ok(W.isOpen('importModal'), '⋯ 메뉴 가져오기가 미리보기(병합/교체)를 열지 않았다');
      assert.strictEqual(W.reqs('replaceAllState').length, 0, '⋯ 메뉴 가져오기가 고르기 전에 저장했다');
    } finally { W.close(); }
  });

  test('변이⑩r(jsdom): applyImport 의 quiet 를 빼면 실행① 이 실패한다(토스트 둘)', async () => {
    const bad = mutate(app, "applyImport('replace', { quiet: true })", "applyImport('replace')");
    await assert.rejects(() => runtime.replacesDirectly(bad), /성공 토스트가 정확히 한 번|교체\/병합 토스트가 함께 떴다/);
  });
  test('변이⑩s(jsdom): 재확인을 빼면 실행③ 이 실패한다', async () => {
    const bad = mutate(app, '    if(!calendarIsEmpty()){ showImportPreview(name, text); return; }   // 그새 무언가를 적었다', '    //');
    await assert.rejects(() => runtime.nonEmptyGoesToPreview(bad), /비어 있지 않은데 바로 교체했다/);
  });
}
