// 이전 버전 기록 감지 · 상단 DB 표시 정리 (2026-09-30 사용자 결정)
//
// 이 파일이 지키는 것:
//   A. 빈 캘린더 + 이 PC 데이터 폴더에 옛 XML → 「가져올까요?」를 **한 번 묻는다**.
//      ★ 묻기만 한다. 물음 창의 어느 경로도 데이터를 적용·저장하지 않는다 — 「가져오기」는 호스트가
//        읽은 내용을 늘 쓰던 미리보기(showImportPreview)로 넘길 뿐이고, 병합/교체는 거기서 사용자가 고른다.
//        그래서 2026-09-01 의 「자동이관 폐기, 명시적 가져오기」(설계 §3b)와 부딪치지 않는다.
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
import { test, assert, loadAppSource, extractFunction, stripCsComments, extractCsMember } from './harness.mjs';
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

//  물음 경로의 함수 전부 — 이 안에서는 적용·저장이 **한 글자도** 없어야 한다.
const PROMPT_FNS = ['maybeAskLegacyImport', 'showLegacyPrompt', 'legacyPromptImport', 'legacyPromptNever',
  'legacyPromptKey', 'legacyPromptSig', 'legacyPromptDismissed'];
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
  const calls = { host: [], preview: [], open: [], close: [], toast: [], applyImport: 0, save: 0, blocked: 0 };
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
    isDbHost: () => true,
    bootRetry: () => ({ manual() {} }),
    hpost: () => {},
    hostRequest: async (cmd, params) => { calls.host.push([cmd, params || {}]); return ctx.__replies[cmd]; },
    showImportPreview: (n, t) => { calls.preview.push([n, t]); },
    applyImport: () => { calls.applyImport++; },
    save: () => { calls.save++; },
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

  //  W2 물음 경로는 적용·저장을 **직접 부르지 않는다** — 미리보기로만 넘긴다
  noAutoApply(src) {
    for (const fn of PROMPT_FNS) {
      const b = fnBody(src, fn);
      for (const bad of ['applyImport', 'save(', 'replaceAll', 'dbSave', 'saveFull', 'fromXML', 'pendingImport']) {
        assert.ok(!b.includes(bad),
          `${fn}() 가 ${bad} 를 부른다 — 물음 창이 스스로 적용·저장하면 그것이 자동이관이다(설계 §3b)`);
      }
    }
    const imp = fnBody(src, 'legacyPromptImport');
    assert.ok(imp.includes("hostRequest('readLegacyXml', { name: p.name }"), '「가져오기」가 readLegacyXml 로 이름만 보내지 않는다');
    assert.ok(imp.includes('showImportPreview('), '「가져오기」가 미리보기(showImportPreview)로 넘기지 않는다');
    const g = imp.indexOf('schemaBlocked()');
    assert.ok(g >= 0 && g < imp.indexOf("hostRequest('readLegacyXml'"),
      '「가져오기」가 읽기 전에 스키마 게이트(schemaBlocked)를 거치지 않는다 — 낡은 위젯이 전량 교체까지 가서야 거부당한다');
    assert.ok(/\$\('#btnLegacyImport'\)\.addEventListener\('click', \(\) => legacyPromptImport\(\)\);/.test(src),
      '「가져오기」 버튼 배선이 끊겼다');
    assert.ok(/\$\('#btnLegacyNever'\)\.addEventListener\('click', \(\) => legacyPromptNever\(\)\);/.test(src),
      '「다시 묻지 않기」 버튼 배선이 끊겼다');
  },

  //  W2' 행동: 가져오기 → readLegacyXml → 미리보기. 적용·저장은 0회. 실패는 토스트.
  async importBehaves(src) {
    const s = sandbox(src);
    await s.ctx.maybeAskLegacyImport();
    s.ctx.legacyPromptImport();
    await flush();
    //  ★ JSON 으로 비교한다 — 인자 객체는 vm 영역에서 만들어져 프로토타입이 달라 deepStrictEqual 이 늘 실패한다.
    assert.strictEqual(JSON.stringify(s.calls.host.filter(([c]) => c === 'readLegacyXml')),
      JSON.stringify([['readLegacyXml', { name: 'old.xml' }]]),
      '「가져오기」가 감지한 그 이름으로 읽기를 요청하지 않았다');
    assert.deepStrictEqual(s.calls.preview, [['old.xml', '<taskCalendar/>']], '읽은 내용이 미리보기로 가지 않았다');
    assert.strictEqual(s.calls.applyImport + s.calls.save, 0, '물음 경로가 적용·저장을 직접 불렀다');
    const blk = sandbox(src);
    await blk.ctx.maybeAskLegacyImport();
    blk.ctx.__blocked = true;
    blk.ctx.legacyPromptImport();
    await flush();
    assert.strictEqual(blk.calls.host.filter(([c]) => c === 'readLegacyXml').length, 0,
      '스키마가 막혔는데 「가져오기」가 파일을 읽었다');
    assert.ok(blk.calls.toast.length > 0, '스키마가 막혔는데 「가져오기」가 사유를 알리지 않았다');
    const f = sandbox(src);
    f.ctx.__replies.readLegacyXml = { ok: false, error: '파일이 없습니다' };
    await f.ctx.maybeAskLegacyImport();
    f.ctx.legacyPromptImport();
    await flush();
    assert.strictEqual(f.calls.preview.length, 0, '읽기가 실패했는데 미리보기가 떴다');
    assert.ok(f.calls.toast.some(([m, k]) => k === 'error' && /파일이 없습니다/.test(m)), '읽기 실패를 토스트로 알리지 않는다');
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
    assert.ok(md.includes('이 PC에 이전 버전(XML 저장)에서 쓰던 기록 파일이 있습니다. 가져오면 서버 캘린더로 옮겨지고, 원본 파일은 지우지 않습니다(「교체」로 옮기면 이름 끝에 「.migrated-날짜」가 붙어 보관됩니다).'),
      '안내 문장이 결정 문구와 다르다');
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
test('감지⑦(웹): 물음 경로는 적용·저장을 직접 부르지 않는다 — 미리보기로만 넘긴다', () => checks.noAutoApply(app));
test('감지⑧(웹·행동): 「가져오기」 → readLegacyXml → 미리보기, 적용·저장 0회 · 실패는 토스트', () => checks.importBehaves(app));
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

test('변이⑩b: 물음 창이 applyImport 를 부르면 감지⑦·⑧ 이 실패한다(자동이관 부활)', async () => {
  const bad = mutate(app, "    showImportPreview(res.name || p.name, String(res.text || ''));\n",
    "    showImportPreview(res.name || p.name, String(res.text || '')); applyImport('replace');\n");
  assert.throws(() => checks.noAutoApply(bad), /legacyPromptImport\(\) 가 applyImport 를 부른다/);
  await assert.rejects(() => checks.importBehaves(bad), /적용·저장을 직접 불렀다/);
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
  const bad = mutate(app, '  if(!p || schemaBlocked()) return;\n', '  if(!p) return;\n');
  assert.throws(() => checks.noAutoApply(bad), /스키마 게이트\(schemaBlocked\)를 거치지 않는다/);
  await assert.rejects(() => checks.importBehaves(bad), /스키마가 막혔는데 「가져오기」가 파일을 읽었다/);
});

test('변이⑩n: 부팅 실패 상자·충돌 안내를 다시 맨 앞(제목줄 위)에 넣으면 상단① 이 실패한다', () => {
  const bad1 = mutate(app, '  insertBelowTitleBar(box);                         // 제목줄 아래',
    '  document.body.insertBefore(box, document.body.firstChild);   // 제목줄 아래');
  assert.throws(() => checks.placementBelowTitleBar(bad1), /ensureBootErrorBox\(\) 가 제목줄 아래에 넣지 않는다/);
  const bad2 = mutate(app, '    insertBelowTitleBar(b);                         // 제목줄 아래(insertBelowTitleBar 머리말)\n  }\n  document.getElementById(\'dbConflictText\')',
    '    document.body.insertBefore(b, document.body.firstChild);\n  }\n  document.getElementById(\'dbConflictText\')');
  assert.throws(() => checks.placementBelowTitleBar(bad2), /showDbConflict\(\) 가 제목줄 아래에 넣지 않는다/);
});
