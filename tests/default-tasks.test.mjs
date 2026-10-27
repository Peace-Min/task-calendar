// 기본 과제 휴가, 기타(docs/DEFAULT-TASKS.md §2~§6)의 웹 쪽 계약.
//
// 이 파일이 지키는 것(설계 §6 의 새 시험 목록과 같은 순서):
//   ① 부팅 뒤 휴가, 기타가 정확히 하나씩 있다. 이미 있으면 새로 만들지 않는다. 열람 창(PEER)에서는 만들지 않는다.
//      저장은 __applyState 본문이 아니라 부팅이 끝난 뒤 한 번(bootDefaultsFlush)이고, 편집 잠금 중에는 보내지 않는다.
//   ② 기본 과제는 삭제 버튼이 없고 이름이 잠기며 deleteCategory 가 거부한다. 재연결 대상에 없다.
//   ③ 기록 폼의 과제 선택 상자에 빈 선택지가 없고 새 기록 기본값이 기타다. 데이터 함수도 빈 값을 기타로 채운다.
//   ④ 보고서에 __uncat__, gitaCat, '기타 맨 뒤' 가 없다(행동은 app-context, category-order 가 본다. 여기서는 흔적 0).
//   ⑤ 과제 삭제가 그 과제의 일정, 할 일, 시간을 지우고 참조를 하나도 남기지 않는다. 확인창 숫자가 맞다.
//   ⑥ 옮기기: 일정, 할 일, 시간이 옮겨지고 겹친 날짜의 시간은 더해지며 24 를 넘지 않는다. 출발 과제는 남는다.
//   ⑦ XML 가져오기: 과제 없는 기록, 없는 과제를 가리키는 기록이 기타로 간다. 파일에 '기타' 가 있으면 그것을 쓴다.
//      없는 과제의 시간은 버린다.
//   ⑧ 빈 캘린더 판정: 기본 과제만 있으면 비어 있다.
//   ⑨ 실행 취소로 되살린 기록의 과제가 그사이 지워졌으면 기타로 붙는다. 전체 초기화 뒤에도 기본 과제가 있다.
//   ⑩ 정정 이력 2차(독립 리뷰): 가져오기의 목록에 없는 공식 과제는 기타가 아니라 편입 · 공식 과제 제거가 시간도 걷는다(FK) ·
//      다시 주입되면 보장 저장 플래그를 새로 정한다 ·
//      이전 기록 가져오기는 진행 중인 저장을 기다린 뒤 교체한다 · 공백 붙은 ' 기타' 도 기본 과제다 ·
//      이관 도구(xml-to-db)도 앱 가져오기와 같은 규칙을 따른다(정적).
//
// 검사 함수를 시험과 변이 시험이 함께 쓴다(같은 함수를 변이된 소스에 돌려 정말 잡는지 증명한다).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM, readText } from './harness.mjs';

const src = loadAppSource();
//  이관 도구 — 배포자가 data.xml 을 DB 로 대량 이관한다. 앱 가져오기와 같은 과제 정리 규칙을 따라야 한다(정정 이력 2차).
const TOOL_SRC = readText(new URL('../db/deploy/xml-to-db/Program.cs', import.meta.url));

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}
// JS 주석 제거(문자열, 템플릿 리터럴은 보존). 계약이 보는 것은 코드지 설명 글자가 아니다.
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
const fnBody = (app, name) => stripJs(extractFunction(app, name));
const applyStateBody = (app) => {
  const at = app.indexOf('window.__applyState = function(json, meta){');
  assert.ok(at > 0, '__applyState 를 찾지 못했다');
  return stripJs(app.slice(at, app.indexOf('\n};', at)));
};
//  <script> 안의 코드만(주석 제거) — CSS, HTML 문구와 섞이지 않게
const scriptCode = (app) => stripJs(app.slice(app.indexOf('<script>'), app.lastIndexOf('</script>')));

/* ── 정적 계약(jsdom 불필요) ─────────────────────────────────────────── */

const statics = {
  //  ① 부팅 보장: 내 창에서만, 상태만 고치고, 저장은 본문 밖(타이머)에서 잠금이 아닐 때 한 번
  bootEnsure(app) {
    const b = applyStateBody(app);
    const st = b.indexOf('state = buildStateFrom(');
    const en = b.indexOf('ensureDefaultTasks(');
    assert.ok(en > st && st > 0, '__applyState 가 부팅 state 를 만든 뒤 기본 과제를 보장하지 않는다(DEFAULT-TASKS §3)');
    assert.ok(/if\(!PEER\) __bootDefaultsDirty = ensureDefaultTasks\(state\);/.test(b), '부팅 보장이 열람 창(PEER)을 거르지 않거나, 다시 주입될 때 저장 플래그를 새로 정하지 않는다 — 남의 데이터에 휴가, 기타를 만들거나 쓸데없는 전체 저장이 나간다');
    assert.ok(!/\bsave\(\)/.test(b) && !/\bbootDefaultsFlush\(\)/.test(b), '__applyState 본문이 저장한다(직접 save() 또는 bootDefaultsFlush() 동기 호출) — 읽기 경로 계약(data-source ⑤) 위반');
    assert.ok(/setTimeout\(bootDefaultsFlush, 0\)/.test(b), '부팅 보장의 저장이 부팅이 끝난 뒤로 미뤄지지 않는다');
    assert.ok(b.indexOf('setTimeout(bootDefaultsFlush') > b.indexOf('connOnBootApplied()'), '저장 예약이 연결 상태(bootOk)를 세우기 전이다');
    const f = fnBody(app, 'bootDefaultsFlush');
    const g = f.indexOf('editLocked()'), p = f.indexOf('PEER'), s = f.indexOf('save()');
    assert.ok(g > 0 && p > 0 && s > g && s > p, 'bootDefaultsFlush 가 잠금(editLocked)과 열람 창(PEER)을 저장보다 먼저 보지 않는다');
    const e = fnBody(app, 'ensureDefaultTasks');
    assert.ok(!/save\(\)|saveFull\(\)|dbSave\(/.test(e), 'ensureDefaultTasks 가 직접 저장한다 — 부팅, 가져오기, 초기화가 저장 시점을 정한다');
  },
  //  ③ 보장 함수를 부르는 곳(§3): 데모 첫 실행, localStorage 읽기, 가져오기(정리), 전체 초기화
  ensureCallSites(app) {
    assert.ok(/ensureDefaultTasks\(s\)/.test(fnBody(app, 'defaultState')), 'defaultState 가 기본 과제를 보장하지 않는다(브라우저 첫 실행)');
    assert.ok(/ensureDefaultTasks\(s\)/.test(fnBody(app, 'load')), 'load() 가 기본 과제를 보장하지 않는다(브라우저 저장본)');
    const imp = fnBody(app, 'applyImport');
    assert.ok(imp.indexOf('importNormalizeCats(state)') > 0 && imp.indexOf('importNormalizeCats(state)') < imp.indexOf('saveFull()'),
      'applyImport 가 저장(saveFull) 전에 가져온 state 를 정리하지 않는다(DEFAULT-TASKS §4.7)');
    assert.ok(/ensureDefaultTasks\(s\)/.test(fnBody(app, 'importNormalizeCats')), '가져오기 정리가 기본 과제를 보장하지 않는다');
    const ca = fnBody(app, 'clearAll');
    assert.ok(ca.indexOf('ensureDefaultTasks(state)') > 0 && ca.indexOf('ensureDefaultTasks(state)') < ca.indexOf('saveFull()'),
      '전체 초기화가 저장 전에 기본 과제를 보장하지 않는다');
  },
  //  ④ 지운 것의 흔적 0 — 미분류 합성 행, gitaCat 병합, 미분류 전용 안내, 빈 선택지 문구
  removedTraces(app) {
    const code = scriptCode(app);
    assert.ok(!code.includes('__uncat__'), "앱 코드에 '__uncat__'(미분류 합성 행)가 남아 있다(DEFAULT-TASKS §4.3)");
    assert.ok(!/\bgitaCat\b/.test(code), 'gitaCat(미분류를 기타 과제로 병합)이 남아 있다');
    assert.ok(!app.includes('rcard-hnote'), '미분류 기타 행 전용 안내(.rcard-hnote)가 남아 있다');
    assert.ok(!/'미분류'/.test(fnBody(app, 'fillCatSelect')), "과제 선택 상자의 기본 빈 선택지 '미분류' 가 남아 있다");
    assert.ok(!/과제 없음/.test(fnBody(app, 'todoEditHtml')), "할 일 편집의 '과제 없음' 선택지가 남아 있다");
    assert.ok(!/과제 없음/.test(fnBody(app, 'openQuickAdd')), "빠른 추가의 '과제 없음' 선택지가 남아 있다");
    assert.ok(!/'미분류'/.test(fnBody(app, 'sRowHtml')), "검색 결과가 과제 없는 기록을 '미분류' 라고 부른다");
    assert.ok(!/categoryId = null/.test(fnBody(app, 'deleteCategory')), "deleteCategory 가 아직 참조를 null('미분류')로 푼다");
  },
  //  ⑤ 삭제, 옮기기의 관문 — 열람 창과 잠금을 첫 쓰기보다 먼저 본다(deleteCategory 는 이름 때문에 offline-web 목록에 못 싣는다)
  gates(app) {
    for (const [fn, firstWrite] of [['deleteCategory', 'state.entries = '], ['moveCategoryData', 'e.categoryId = toId']]) {
      const b = fnBody(app, fn);
      const p = b.indexOf('PEER'), g = b.indexOf('guardEdit()'), w = b.indexOf(firstWrite);
      assert.ok(p > 0 && g > 0 && w > g && w > p, `${fn} 가 열람 창, 잠금을 첫 쓰기보다 먼저 막지 않는다`);
      assert.strictEqual((b.match(/\bsave\(\)/g) || []).length, 1, `${fn} 의 저장이 한 번이 아니다(한 번의 save 로 나간다 · §4.5, §4.6)`);
    }
    assert.ok(/isDefaultTask\(c\)/.test(fnBody(app, 'deleteCategory')), 'deleteCategory 가 기본 과제를 거르지 않는다(화면 우회 방어 · §4.4)');
    //  과제의 시간을 걷는 곳은 한 함수(dropCatHours)다 — 삭제와 공식 과제 제거가 같은 정리를 쓴다(정정 이력 2차)
    for (const fn of ['deleteCategory', 'unsubscribeDbCat'])
      assert.ok(/dropCatHours\(id\)/.test(fnBody(app, fn)), `${fn} 가 그 과제의 시간을 같은 저장에서 걷지 않는다 — 과제 DELETE 가 FK(1451)로 실패한다`);
  },
  //  ⑩ 이관 도구(xml-to-db) — 앱 가져오기(importNormalizeCats)와 같은 규칙. 실 DB 왕복은 tests/migrate-tool.mjs ⑧ 이 본다.
  toolSameRule(cs) {
    const code = cs.replace(/\/\/.*$/gm, '');
    assert.ok(/\("휴가", "#2e9e6b"\), \("기타", "#5b6b7d"\)/.test(code), '이관 도구가 기본 과제 휴가, 기타(앱과 같은 색)를 보장하지 않는다');
    assert.ok(/T\(c\.Element\("name"\)\)\.Trim\(\) == dn/.test(code) && /A\(c, "source"\) != "db"/.test(code),
      "이관 도구가 있는 개인 '휴가', '기타'(앞뒤 공백 무시)를 다시 쓰지 않는다 — 기본 과제가 둘 생긴다");
    assert.ok((code.match(/object\? cno = catNo\[MapCat\(A\([et], "categoryId"\)\)\];/g) || []).length === 2,
      '이관 도구의 일정, 할 일이 과제 정리(MapCat: 없거나 빈 과제 → 기타)를 거치지 않는다 — cat_no NULL 기록은 보고서에서 사라진다');
    assert.ok(/return gitaId;/.test(code), 'MapCat 이 기타로 보내지 않는다');
    assert.ok(/NoteDbRef\(A\(x, "cat"\)\)/.test(code) && /extraCats\.Add\(\(id, true,/.test(code),
      '이관 도구가 목록에 없는 공식 과제 참조(일정, 할 일, 공수)를 편입하지 않는다 — 앱 가져오기와 규칙이 갈린다');
    assert.ok(!/미분류/.test(code), "이관 도구가 아직 '미분류' 를 말한다(그 상태는 없다)");
    assert.ok(!/cno = null|cno = cv; else orphanCat/.test(code), '이관 도구가 예전처럼 없는 과제를 cat_no NULL 로 넣는다');
  },
};

test('정적①: 부팅 보장은 내 창에서 상태만 고치고, 저장은 부팅이 끝난 뒤 잠금이 아닐 때 한 번(__applyState 본문에 save 없음)', () => statics.bootEnsure(src));
test('정적②: 보장 함수를 부르는 곳 — 데모 첫 실행, 저장본 읽기, 가져오기(저장 전), 전체 초기화(저장 전)', () => statics.ensureCallSites(src));
test('정적③: 미분류 합성 행, gitaCat, 미분류 안내, 빈 선택지 문구, 삭제의 null 풀기 흔적이 없다', () => statics.removedTraces(src));
test('정적④: 과제 삭제, 옮기기는 열람 창과 잠금을 첫 쓰기 전에 막고 저장은 한 번이다', () => statics.gates(src));
test('변이①s: 부팅 보장에서 PEER 거르기를 빼면 정적① 이 실패한다', () => {
  assert.throws(() => statics.bootEnsure(mutate('if(!PEER) __bootDefaultsDirty = ensureDefaultTasks(state);', '__bootDefaultsDirty = ensureDefaultTasks(state);', src)), /PEER/);
});
test('변이②s: __applyState 가 보장 저장을 바로 부르면 정적① 이 실패한다', () => {
  assert.throws(() => statics.bootEnsure(mutate('setTimeout(bootDefaultsFlush, 0);', 'bootDefaultsFlush();', src)), /본문이 저장한다/);
});
test('변이③s: 미분류 합성 행을 되살리면 정적③ 이 실패한다', () => {
  assert.throws(() => statics.removedTraces(mutate("  const catKey = e => e.categoryId || '';", "  const catKey = e => e.categoryId || '__uncat__';", src)), /__uncat__/);
});
test('정적⑤: 이관 도구(xml-to-db)가 앱 가져오기와 같은 과제 정리 규칙을 따른다(기본 과제, 기타로 붙이기, 공식 과제 편입)', () => statics.toolSameRule(TOOL_SRC));
test('변이⑤s: 이관 도구가 예전처럼 없는 과제를 NULL 로 넣으면 정적⑤ 가 실패한다', () => {
  const bad = mutate('object? cno = catNo[MapCat(A(e, "categoryId"))];', 'object? cno = null;', TOOL_SRC);
  assert.throws(() => statics.toolSameRule(bad), /MapCat|NULL/);
});
test('변이⑥s: 공식 과제 제거가 시간을 걷지 않으면 정적④ 가 실패한다', () => {
  assert.throws(() => statics.gates(mutate('  dropCatHours(id);\n  state.categories = state.categories.filter(x => x.id !== id);\n  if(filterCatId === id) filterCatId = null;\n  if(noteFilterCat === id) noteFilterCat = null;\n  return true;',
    '  state.categories = state.categories.filter(x => x.id !== id);\n  if(filterCatId === id) filterCatId = null;\n  if(noteFilterCat === id) noteFilterCat = null;\n  return true;', src)), /unsubscribeDbCat/);
});
test('변이④s: deleteCategory 의 기본 과제 거르기를 빼면 정적④ 가 실패한다', () => {
  assert.throws(() => statics.gates(mutate('if(!c || isDefaultTask(c) || isOfficialCat(c)) return false;', 'if(!c || isOfficialCat(c)) return false;', src)), /기본 과제/);
});

/* ── 행동 — jsdom 위젯 모드 ──────────────────────────────────────────── */

const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('default-tasks: jsdom 미설치 — 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CA = '2026-09-01T00:00:00Z';
  const CAT = (id, name, extra) => Object.assign({ id, name, color: '#3e5be0', desc: '', createdAt: CA }, extra || {});
  const ENT = (id, categoryId, extra) => Object.assign({ id, date: '2026-10-01', title: '업무 ' + id, categoryId, allDay: true, startTime: '', endTime: '',
    memo: '', location: '', recur: null, recurExcept: [], endDate: '', createdAt: CA, updatedAt: CA }, extra || {});
  const TODO = (id, categoryId) => ({ id, text: '할 일 ' + id, done: false, categoryId, due: '2026-10-02', endDate: '', prio: 'normal',
    completedAt: '', note: '', dayNotes: {}, createdAt: CA, updatedAt: CA });
  const EMPTY = { categories: [], entries: [], todos: [], rooms: ['201호'] };
  const WITH_DEFAULTS = (extra) => Object.assign({ categories: [CAT('c-v', '휴가'), CAT('c-e', '기타')], entries: [], todos: [], rooms: ['201호'] }, extra || {});

  function boot(source, url = 'https://tcapp.local/') {
    const log = [];
    const timers = [];
    const handlers = { saveState: { ok: true }, replaceAllState: { ok: true } };
    const dom = new JSDOM(source, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url,
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
        win.HTMLElement.prototype.scrollIntoView = function () {};
        //  시계는 흐르지 않는다 — 대신 예약된 콜백을 모아 두고, 시험이 부팅 보장 저장(bootDefaultsFlush)만 골라 돌린다.
        win.setTimeout = (fn) => { timers.push(fn); return timers.length; };
        win.clearTimeout = () => {};
        //  닫기 애니메이션 없이 바로 닫히게(감속 모드) — 타이머가 흐르지 않아도 창이 닫힌다.
        win.matchMedia = (q) => ({ matches: /prefers-reduced-motion/.test(String(q)), media: String(q),
          addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
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
    w.__fakeToast = (m, k) => log.push({ toast: m, kind: k });
    //  확인창은 묻는 말을 적어 두고 바로 답한다(기본 'ok').
    w.eval("window.__cf = []; window.__cfAns = 'ok'; confirmBox = function(t, m, ok){ window.__cf.push([String(t), String(m), String(ok)]); return Promise.resolve(window.__cfAns); };");
    const sess = log.find((x) => x.post === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.msg.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'hjlee', name: '이현진' } }) + ')');
    const W = {
      w, log, handlers, timers,
      ev: (code) => w.eval(code),
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      reqs: (cmd) => log.filter((x) => x.req === cmd),
      saves: () => JSON.parse(JSON.stringify(log.filter((x) => x.req === 'saveState').map((x) => x.params.state))),
      toasts: () => log.filter((x) => x.toast).map((x) => x.toast),
      confirms: () => JSON.parse(w.eval('JSON.stringify(window.__cf)')),
      applyState: (data, meta = META) => w.eval('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(meta) + ')'),
      //  예약된 부팅 보장 저장만 돌린다(다른 타이머는 흘리지 않는다)
      runBootFlush: () => { const fs = timers.filter((f) => f === w.bootDefaultsFlush); for (let i = timers.length - 1; i >= 0; i--) if (timers[i] === w.bootDefaultsFlush) timers.splice(i, 1); fs.forEach((f) => f()); return fs.length; },
      cats: () => JSON.parse(w.eval('JSON.stringify(state.categories.map(function(c){ return { id: c.id, name: c.name, source: c.source || "" }; }))')),
      idOf: (name) => w.eval("(function(){ var c = defaultTaskOf(" + JSON.stringify(name) + "); return c ? c.id : null; })()"),
      btn: (id, act) => w.document.querySelector('#catList .cat-row[data-id="' + id + '"] [data-act="' + act + '"]'),
      clear: () => { log.length = 0; w.eval('window.__cf = []'); },
      //  닫기 전에 저장 왕복(dbSave 의 Promise 사슬)을 끝까지 흘린다 — 닫힌 창에서 회신이 돌면 document 가 없어 터진다.
      close: async () => { await settle(); try { w.close(); } catch (_) {} },
    };
    return W;
  }
  async function withBoot(source, data, fn, url) {
    const W = boot(source, url);
    try {
      W.applyState(data);
      await settle();
      W.runBootFlush();
      await settle();
      W.clear();
      return await fn(W);
    } finally { await W.close(); }
  }
  const named = (W, name) => W.cats().filter((c) => c.name === name && c.source !== 'db');

  const checks = {
    //  ① 부팅 보장 — 빈 캘린더로 부팅하면 휴가, 기타가 하나씩(맨 뒤) 생기고, 저장은 부팅 뒤 한 번. 다시 받으면 새로 만들지 않는다.
    async bootCreatesOnce(source) {
      const W = boot(source);
      try {
        W.applyState({ categories: [CAT('c-p', '프로젝트')], entries: [], todos: [], rooms: [] });
        await settle();
        assert.deepStrictEqual(W.cats().map((c) => c.name), ['프로젝트', '휴가', '기타'], '부팅 뒤 기본 과제(휴가, 기타)가 목록 맨 뒤에 하나씩 생기지 않았다');
        assert.strictEqual(W.reqs('saveState').length, 0, '__applyState 안에서 바로 저장했다 — 저장은 부팅이 끝난 뒤(타이머)여야 한다');
        assert.strictEqual(W.runBootFlush(), 1, '부팅 보장 저장(bootDefaultsFlush)이 예약되지 않았다');
        await settle();
        const saves = W.saves();
        assert.strictEqual(saves.length, 1, '부팅 보장 저장이 정확히 한 번이 아니다');
        assert.deepStrictEqual(saves[0].categories.map((c) => c.name), ['프로젝트', '휴가', '기타'], '저장 payload 에 기본 과제가 없다');
        //  서버가 돌려준 최신(기본 과제 포함)으로 다시 부팅 → 새로 만들지도, 저장하지도 않는다
        W.clear();
        W.applyState(saves[0]);
        await settle();
        assert.strictEqual(W.runBootFlush(), 0, '이미 있는데 보장 저장을 또 예약했다');
        assert.strictEqual(named(W, '휴가').length, 1, '휴가가 정확히 하나가 아니다');
        assert.strictEqual(named(W, '기타').length, 1, '기타가 정확히 하나가 아니다');
        assert.strictEqual(W.reqs('saveState').length, 0, '이미 있는데 저장했다');
      } finally { await W.close(); }
    },
    //  ① 공식 과제는 이름이 같아도 기본 과제가 아니다 · 개인 '기타' 가 이미 있으면 그것을 쓴다
    async bootRespectsExisting(source) {
      await withBoot(source, { categories: [CAT('db-v', '휴가', { source: 'db' }), CAT('c-mine', '기타')], entries: [], todos: [], rooms: [] }, async (W) => {
        assert.strictEqual(named(W, '휴가').length, 1, '공식 과제 휴가만 있을 때 개인 휴가를 만들지 않았다(공식은 기본 과제가 아니다)');
        assert.strictEqual(named(W, '기타').length, 1, "개인 '기타' 가 있는데 하나 더 만들었다");
        assert.strictEqual(W.idOf('기타'), 'c-mine', "있는 개인 '기타' 를 기본 과제로 쓰지 않는다");
        assert.strictEqual(W.ev("isDefaultTask(catById('db-v'))"), false, '공식 과제를 기본 과제로 본다');
      });
    },
    //  ① 열람 창에서는 만들지 않는다(남의 데이터) · 옮기기, 삭제도 막힌다
    async peerUntouched(source) {
      const W = boot(source, 'https://tcapp.local/?peer=1');
      try {
        W.applyState({ categories: [CAT('p-1', '남의 과제')], entries: [ENT('pe', 'p-1')], todos: [], rooms: [] }, { peerName: '윤인환', canWrite: false });
        await settle();
        assert.strictEqual(W.ev('PEER'), true, '시험 전제: 열람 창이 아니다');
        assert.deepStrictEqual(W.cats().map((c) => c.id), ['p-1'], '열람 창에서 남의 캘린더에 기본 과제를 만들었다');
        assert.strictEqual(W.runBootFlush(), 0, '열람 창에서 보장 저장을 예약했다');
        assert.strictEqual(W.ev("moveCategoryData('p-1', 'p-1')"), null);
        assert.strictEqual(W.ev("deleteCategory('p-1')"), false, '열람 창에서 과제 삭제가 됐다');
        assert.deepStrictEqual(W.cats().map((c) => c.id), ['p-1']);
      } finally { await W.close(); }
    },
    //  ① 편집 잠금 중에는 보장 저장을 보내지 않는다(상태에는 있고, 다음 저장이 함께 싣는다)
    async lockedNoBootSave(source) {
      const W = boot(source);
      try {
        W.applyState(EMPTY);
        await settle();
        W.ev("__dbConnLost({ kind:'network', detail:'socket closed' })");
        assert.strictEqual(W.ev('editLocked()'), true, '시험 전제: 잠금이 서지 않았다');
        W.clear();
        W.runBootFlush();
        await settle();
        assert.strictEqual(W.reqs('saveState').length, 0, '편집 잠금 중에 기본 과제 저장을 보냈다');
        assert.ok(!W.toasts().length, '아무도 누르지 않았는데 토스트가 떴다(마지막 방어까지 갔다)');
        assert.strictEqual(named(W, '기타').length, 1, '잠금 중이라도 화면 state 에는 기본 과제가 있어야 한다');
      } finally { await W.close(); }
    },
    //  ② 기본 과제 보호 — 삭제 버튼 없음, 이름 잠금, deleteCategory 거부, 재연결 대상 아님, 같은 이름 새 과제 막음
    async protectedDefaults(source) {
      await withBoot(source, WITH_DEFAULTS({ categories: [CAT('c-p', '프로젝트'), CAT('c-v', '휴가'), CAT('c-e', '기타')] }), async (W) => {
        W.ev('openCatModal();');
        for (const id of ['c-v', 'c-e']) {
          assert.strictEqual(W.btn(id, 'del'), null, `기본 과제(${id}) 행에 삭제 버튼이 있다`);
          assert.ok(W.btn(id, 'edit') && W.btn(id, 'movedata') && W.btn(id, 'up'), `기본 과제(${id}) 행에 수정, 옮기기, 순서 버튼이 없다`);
        }
        assert.ok(W.btn('c-p', 'del'), '대조군: 일반 개인 과제에는 삭제 버튼이 있다');
        //  삭제 버튼을 주입해 눌러도 확인창조차 뜨지 않는다(위임이 먼저 돌아온다)
        W.ev("(function(){ var r = document.querySelector('#catList .cat-row[data-id=\"c-e\"]'); var b = document.createElement('button'); b.dataset.act = 'del'; r.appendChild(b); b.click(); })()");
        await settle();
        assert.strictEqual(W.confirms().length, 0, '기본 과제에서 삭제 확인창이 떴다');
        assert.strictEqual(W.ev("deleteCategory('c-e')"), false, 'deleteCategory 가 기본 과제를 지웠다(화면 우회)');
        assert.strictEqual(named(W, '기타').length, 1, '기본 과제 기타가 사라졌다');
        assert.strictEqual(W.reqs('saveState').length, 0, '거부했는데 저장했다');
        //  이름 잠금 — 수정 폼은 열리되 이름 칸이 잠기고 기본 과제용 안내가 선다. 색은 바뀐다.
        W.btn('c-v', 'edit').click();
        assert.strictEqual(W.ev("$('#cName').readOnly"), true, '기본 과제의 이름 칸이 잠기지 않았다');
        assert.ok(/기본 과제라 이름을 바꿀 수 없습니다/.test(W.ev("$('#cLockNote').textContent")), '기본 과제 잠금 안내가 없다');
        assert.strictEqual(W.ev("$('#cLockNote').classList.contains('hidden')"), false, '잠금 안내가 숨어 있다');
        W.ev("$('#cName').value = '연차'; selColor = '#d6494e'; saveCatFromForm();");
        await settle();
        const v = W.evJSON("catById('c-v')");
        assert.strictEqual(v.name, '휴가', '잠긴 이름 칸을 조작하니 기본 과제 이름이 바뀌었다');
        assert.strictEqual(v.color, '#d6494e', '기본 과제의 색은 바꿀 수 있어야 한다');
        W.ev("updateCategory('c-e', '그 외', '#5b6b7d', '', '', '')");
        assert.strictEqual(W.ev("catById('c-e').name"), '기타', 'updateCategory 가 기본 과제 이름을 바꿨다(폼 우회)');
        //  같은 이름의 새 과제는 기존 중복 검사가 막는다
        const n0 = W.cats().length;
        W.ev("resetCatForm(); renderCatModal(); $('#cName').value = '휴가'; saveCatFromForm();");
        assert.strictEqual(W.cats().length, n0, "'휴가' 라는 이름의 과제를 하나 더 만들었다");
        assert.ok(W.toasts().includes('같은 이름의 과제가 이미 있습니다'), '중복 이름을 막으며 이유를 말하지 않는다');
        //  재연결 대상에 없다
        W.ev('openRelinkModal();');
        const rl = W.evJSON("[].map.call(document.querySelectorAll('#rlList .rl-row'), function(r){ return r.dataset.cat; })");
        assert.deepStrictEqual(rl, ['c-p'], '재연결 목록에 기본 과제가 있다(또는 일반 개인 과제가 없다): ' + JSON.stringify(rl));
      });
    },
    //  ③ 선택 상자와 데이터 함수 — 빈 선택지 없음, 새 기록 기본값 = 기타(필터로 고른 과제가 있으면 그 과제)
    async pickersDefaultToGita(source) {
      await withBoot(source, WITH_DEFAULTS({ categories: [CAT('c-p', '프로젝트'), CAT('c-v', '휴가'), CAT('c-e', '기타')],
        entries: [ENT('e-x', 'c-gone')], todos: [TODO('t-n', null)] }), async (W) => {
        const optVals = (sel) => W.evJSON("[].map.call(document.querySelectorAll('" + sel + " option'), function(o){ return o.value; })");
        //  (예전 기록 창 #fCat 은 2026-10-26 Git 기능과 함께 없앴다. 새 기록과 편집은 모두 한 화면 폼 #qaCat 이다.)
        W.ev("filterCatId = 'c-p'; openQuickAdd('2026-10-05');");
        assert.strictEqual(W.ev("$('#qaCat').value"), 'c-p', '필터로 고른 과제가 새 기록의 기본값이 아니다');
        W.ev("closeModal('#quickAdd'); filterCatId = null;");
        //  편집: 목록에 없는 과제는 '(알 수 없는 과제)' 로 보존된다(조용히 첫 과제로 바뀌지 않는다)
        W.ev("openQuickAdd(null, 'event', 'e-x');");
        assert.strictEqual(W.ev("$('#qaCat').value"), 'c-gone', '목록에 없는 과제를 가리키는 기록을 열자 값이 바뀌었다');
        assert.strictEqual(W.ev("$('#qaCat').selectedOptions[0].textContent"), '(알 수 없는 과제)');
        W.ev("closeModal('#quickAdd');");
        W.ev("openQuickAdd('2026-10-05');");
        assert.ok(!optVals('#qaCat').includes(''), '#qaCat 에 빈 선택지(과제 없음)가 있다');
        assert.strictEqual(W.ev("$('#qaCat').value"), 'c-e', '빠른 추가의 기본 과제가 기타가 아니다');
        //  할 일 인라인 편집 — 빈 선택지 없음, 과제가 빈 할 일은 기타가 선택된다
        const te = W.ev("todoEditHtml(todoById('t-n'))");
        assert.ok(!/<option value="">/.test(te), '할 일 편집에 빈 선택지(과제 없음)가 있다');
        assert.ok(/<option value="c-e" selected>/.test(te), '과제가 빈 할 일 편집에서 기타가 선택되지 않는다');
        //  데이터 함수 — 마지막 방어선
        assert.strictEqual(W.ev("addEntry({ date:'2026-10-06', title:'빈 과제', categoryId:'' }).categoryId"), 'c-e', 'addEntry 가 빈 과제를 기타로 채우지 않는다');
        assert.strictEqual(W.ev("addEntry({ date:'2026-10-06', title:'없음', categoryId:null }).categoryId"), 'c-e');
        W.ev("updateEntry('e-x', { date:'2026-10-01', title:'고침', categoryId:'' })");
        assert.strictEqual(W.ev("entryById('e-x').categoryId"), 'c-e', 'updateEntry 가 빈 과제를 기타로 채우지 않는다');
        assert.strictEqual(W.ev("addTodo('새 할 일', {}).categoryId"), 'c-e', 'addTodo 가 빈 과제를 기타로 채우지 않는다');
        W.ev("updateTodo('t-n', { categoryId: '' })");
        assert.strictEqual(W.ev("todoById('t-n').categoryId"), 'c-e', 'updateTodo 가 빈 과제를 기타로 채우지 않는다');
        assert.strictEqual(W.ev("addEntry({ date:'2026-10-06', title:'지정', categoryId:'c-p' }).categoryId"), 'c-p', '대조군: 고른 과제는 그대로');
      });
    },
    //  ⑤ 과제 삭제 = 데이터 삭제 · 확인창 숫자 · 참조 0 · 저장 한 번
    async deleteRemovesData(source) {
      const data = WITH_DEFAULTS({
        categories: [CAT('c-x', '지울 과제'), CAT('c-k', '남길 과제'), CAT('c-v', '휴가'), CAT('c-e', '기타')],
        entries: [ENT('e-1', 'c-x'), ENT('e-2', 'c-x', { allDay: true }), ENT('e-k', 'c-k')],
        todos: [TODO('t-1', 'c-x'), TODO('t-k', 'c-k')],
        taskHours: { '2026-10-01': { 'c-x': 3, 'c-k': 2 }, '2026-10-02': { 'c-x': 1 } },
      });
      await withBoot(source, data, async (W) => {
        W.ev('openCatModal();');
        W.btn('c-x', 'del').click();
        await settle();
        const cf = W.confirms();
        assert.strictEqual(cf.length, 1, '삭제 확인창이 한 번 뜨지 않았다');
        assert.strictEqual(cf[0][1], "'지울 과제' 과제를 삭제할까요?\n이 과제의 일정 2개, 할 일 1개, 과제별 시간 2일이 함께 삭제되고 되돌릴 수 없습니다.\n남기려면 먼저 '옮기기'로 다른 과제에 옮기세요.",
          '확인창이 무엇이 몇 개 지워지는지 정확히 말하지 않는다: ' + cf[0][1]);
        assert.deepStrictEqual(W.cats().map((c) => c.id), ['c-k', 'c-v', 'c-e'], '과제가 지워지지 않았다');
        assert.deepStrictEqual(W.evJSON('state.entries.map(function(e){ return e.id; })'), ['e-k'], '그 과제의 일정이 남았다');
        assert.deepStrictEqual(W.evJSON('state.todos.map(function(t){ return t.id; })'), ['t-k'], '그 과제의 할 일이 남았다');
        assert.deepStrictEqual(W.evJSON('state.taskHours'), { '2026-10-01': { 'c-k': 2 } }, '그 과제의 시간이 남았거나 다른 과제 시간이 지워졌다');
        const saves = W.saves();
        assert.strictEqual(saves.length, 1, '삭제가 한 번의 저장으로 나가지 않았다');
        const p = saves[0];
        const refs = p.entries.concat(p.todos).filter((r) => r.categoryId === 'c-x').length
          + Object.values(p.taskHours || {}).filter((d) => d && d['c-x'] !== undefined).length;
        assert.strictEqual(refs, 0, '지운 과제를 가리키는 일정, 할 일, 시간이 저장 payload 에 남았다 — 호스트에서 과제 DELETE 가 FK(1451)로 실패한다');
        assert.ok(!p.categories.some((c) => c.id === 'c-x'), 'payload 에 지운 과제가 남았다');
      });
    },
    //  ⑤ 대조: 데이터가 없는 과제의 확인창, 취소하면 아무것도 바뀌지 않는다
    async deleteEmptyAndCancel(source) {
      await withBoot(source, WITH_DEFAULTS({ categories: [CAT('c-x', '빈 과제'), CAT('c-v', '휴가'), CAT('c-e', '기타')], entries: [ENT('e-1', 'c-x')] }), async (W) => {
        W.ev("window.__cfAns = false;");
        W.ev('openCatModal();');
        W.btn('c-x', 'del').click();
        await settle();
        assert.strictEqual(named(W, '빈 과제').length, 1, '취소했는데 지웠다');
        assert.strictEqual(W.reqs('saveState').length, 0, '취소했는데 저장했다');
        W.ev("state.entries = []; window.__cfAns = 'ok'; window.__cf = [];");
        W.btn('c-x', 'del').click();
        await settle();
        assert.strictEqual(W.confirms()[0][1], "'빈 과제' 과제를 삭제할까요?\n이 과제에는 일정, 할 일, 과제별 시간이 없습니다.");
        assert.strictEqual(named(W, '빈 과제').length, 0);
      });
    },
    //  ⑥ 옮기기 — 화면 경로 그대로(행의 [옮기기] → 대상 고르기 → [옮기기] → 확인창)
    async moveSumsHours(source) {
      const data = WITH_DEFAULTS({
        categories: [CAT('c-a', '연차'), CAT('c-b', '프로젝트'), CAT('db-g', '사라진 공식', { source: 'db', dbGone: true }), CAT('c-v', '휴가'), CAT('c-e', '기타')],
        entries: [ENT('e-a1', 'c-a'), ENT('e-a2', 'c-a', { allDay: true }), ENT('e-b', 'c-b')],
        todos: [TODO('t-a', 'c-a'), TODO('t-b', 'c-b')],
        taskHours: { '2026-10-01': { 'c-a': 5, 'c-v': 3 }, '2026-10-02': { 'c-a': 20, 'c-v': 10 }, '2026-10-03': { 'c-a': 2.5 }, '2026-10-04': { 'c-b': 1 } },
      });
      await withBoot(source, data, async (W) => {
        W.ev('openCatModal();');
        W.btn('c-a', 'movedata').click();
        await settle();
        assert.ok(W.ev("!$('#catMoveModal').classList.contains('hidden')"), '옮기기 창이 열리지 않았다');
        const opts = W.evJSON("[].map.call(document.querySelectorAll('#cmvTarget option'), function(o){ return o.value; })");
        assert.deepStrictEqual(opts, ['', 'c-b', 'c-v', 'c-e'], '대상 목록이 자기 자신을 빼고 고를 수 있는 과제(isPickableCat)만이 아니다: ' + JSON.stringify(opts));
        assert.strictEqual(W.ev("$('#cmvRun').disabled"), true, '대상을 고르기 전에 [옮기기]가 켜져 있다');
        W.ev("$('#cmvTarget').value = 'c-v'; $('#cmvTarget').dispatchEvent(new Event('change'));");
        assert.strictEqual(W.ev("$('#cmvRun').disabled"), false);
        W.ev("$('#cmvRun').click();");
        await settle();
        const cf = W.confirms();
        assert.strictEqual(cf.length, 1, '옮기기 확인창이 뜨지 않았다');
        assert.ok(cf[0][1].startsWith("'연차' 과제의 일정 2개, 할 일 1개, 과제별 시간 3일을 '휴가' 과제로 옮깁니다."), '확인창 숫자, 문구가 다르다: ' + cf[0][1]);
        assert.deepStrictEqual(W.evJSON("state.entries.map(function(e){ return e.id + ':' + e.categoryId; })"), ['e-a1:c-v', 'e-a2:c-v', 'e-b:c-b'], '일정이 옮겨지지 않았다');
        assert.deepStrictEqual(W.evJSON("state.todos.map(function(t){ return t.id + ':' + t.categoryId; })"), ['t-a:c-v', 't-b:c-b'], '할 일이 옮겨지지 않았다');
        assert.deepStrictEqual(W.evJSON('state.taskHours'), { '2026-10-01': { 'c-v': 8 }, '2026-10-02': { 'c-v': 24 }, '2026-10-03': { 'c-v': 2.5 }, '2026-10-04': { 'c-b': 1 } },
          '시간이 옮겨지지 않았거나, 겹친 날을 더하지 않았거나, 하루 24 상한을 넘겼다: ' + W.ev('JSON.stringify(state.taskHours)'));
        assert.strictEqual(named(W, '연차').length, 1, '출발 과제가 사라졌다 — 옮기기는 지우지 않는다');
        assert.strictEqual(W.saves().length, 1, '옮기기가 한 번의 저장으로 나가지 않았다');
        assert.ok(W.ev("$('#catMoveModal').classList.contains('hidden')"), '옮긴 뒤 창이 닫히지 않았다');
        //  옮긴 뒤 출발 과제를 지우면 지울 데이터가 없다(빈 과제)
        W.ev("window.__cf = [];");
        W.btn('c-a', 'del').click();
        await settle();
        assert.strictEqual(W.confirms()[0][1], "'연차' 과제를 삭제할까요?\n이 과제에는 일정, 할 일, 과제별 시간이 없습니다.", '옮긴 뒤에도 출발 과제를 가리키는 것이 남았다');
      });
    },
    //  ⑥ 잠금 중에는 옮기지 않는다 · 대상이 같거나 없으면 거부
    async moveGuarded(source) {
      await withBoot(source, WITH_DEFAULTS({ categories: [CAT('c-a', '가'), CAT('c-v', '휴가'), CAT('c-e', '기타')], entries: [ENT('e-1', 'c-a')] }), async (W) => {
        assert.strictEqual(W.ev("moveCategoryData('c-a', 'c-a')"), null, '자기 자신으로 옮겼다');
        assert.strictEqual(W.ev("moveCategoryData('c-a', 'nope')"), null, '없는 과제로 옮겼다');
        W.ev("__dbConnLost({ kind:'network', detail:'x' })");
        W.clear();
        assert.strictEqual(W.ev("moveCategoryData('c-a', 'c-e')"), null, '잠긴 채 옮겼다');
        assert.strictEqual(W.ev("entryById('e-1').categoryId"), 'c-a', '잠긴 채 기록의 과제가 바뀌었다');
        assert.strictEqual(W.ev("deleteCategory('c-a')"), false, '잠긴 채 과제를 지웠다');
        assert.strictEqual(W.reqs('saveState').length, 0, '잠긴 채 저장을 보냈다');
      });
    },
    //  ⑦ XML 가져오기(교체) — 과제 없는 기록과 없는 과제를 가리키는 기록은 기타로, 파일의 '기타' 를 쓴다, 없는 과제의 시간은 버린다
    async importAttachesToGita(source) {
      await withBoot(source, WITH_DEFAULTS(), async (W) => {
        const FILE = {
          categories: [CAT('f-g', '기타'), CAT('f-p', '파일 과제'), CAT('db-o', '공식', { source: 'db' })],
          entries: [ENT('e-null', null), ENT('e-gone', 'f-gone'), ENT('e-p', 'f-p'), ENT('e-o', 'db-o')],
          todos: [TODO('t-null', null), TODO('t-gone', 'f-gone2')],
          taskHours: { '2026-10-01': { 'f-p': 1, 'f-gone': 3 }, '2026-10-02': { 'f-gone': 2 } },
          rooms: [],
        };
        W.ev('pendingImport = ' + JSON.stringify(FILE) + '; applyImport({ quiet: true });');
        await settle();
        assert.deepStrictEqual(W.cats().map((c) => c.id === 'f-g' || c.id === 'f-p' || c.id === 'db-o' ? c.id : c.name), ['f-g', 'f-p', 'db-o', '휴가'],
          "파일의 '기타' 를 쓰지 않고 하나 더 만들었거나, 휴가를 만들지 않았다: " + JSON.stringify(W.cats()));
        assert.deepStrictEqual(W.evJSON("state.entries.map(function(e){ return e.id + ':' + e.categoryId; })"), ['e-null:f-g', 'e-gone:f-g', 'e-p:f-p', 'e-o:db-o'],
          '과제 없는 기록, 없는 과제를 가리키는 기록이 기타로 가지 않았다(또는 멀쩡한 기록이 바뀌었다)');
        assert.deepStrictEqual(W.evJSON("state.todos.map(function(t){ return t.id + ':' + t.categoryId; })"), ['t-null:f-g', 't-gone:f-g'], '할 일이 기타로 가지 않았다');
        assert.deepStrictEqual(W.evJSON('state.taskHours'), { '2026-10-01': { 'f-p': 1 } }, '없는 과제 키의 과제별 시간을 버리지 않았다(빈 날도 지운다)');
        const sent = W.reqs('replaceAllState');
        assert.strictEqual(sent.length, 1, '가져오기가 전량 교체 한 번으로 나가지 않았다');
        const st = JSON.parse(JSON.stringify(sent[0].params.state));
        assert.strictEqual(st.entries.concat(st.todos).filter((r) => !st.categories.some((c) => c.id === r.categoryId)).length, 0,
          '보낸 state 에 실재하지 않는 과제를 가리키는 기록이 있다');
      });
    },
    //  ⑧ 빈 캘린더 판정 — 기본 과제만 있으면 비어 있다. 일정, 할 일, 시간, 다른 과제 중 하나라도 있으면 비어 있지 않다
    async emptyWithDefaultsOnly(source) {
      await withBoot(source, EMPTY, async (W) => {
        assert.deepStrictEqual(W.cats().map((c) => c.name), ['휴가', '기타'], '시험 전제: 기본 과제만 있다');
        assert.strictEqual(W.ev('calendarIsEmpty()'), true, '기본 과제만 있는데 빈 캘린더가 아니라고 본다. 이전 기록 물음이 사라진다');
        assert.ok(!W.ev("!!document.getElementById('emptyHint')"), '빈 캘린더 안내 띠가 떴다(2026-10-27 에 없앴다)');
        const probe = (code) => { W.ev('var __s = JSON.stringify(state);' + code); const v = W.ev('calendarIsEmpty()'); W.ev('state = JSON.parse(__s);'); return v; };
        assert.strictEqual(probe("state.entries.push({ id:'e', date:'2026-10-01', title:'x', categoryId: gitaTaskId() });"), false, '일정이 있는데 비었다고 본다');
        assert.strictEqual(probe("state.todos.push({ id:'t', text:'x', categoryId: gitaTaskId() });"), false, '할 일이 있는데 비었다고 본다');
        assert.strictEqual(probe("state.taskHours = { '2026-10-01': {} }; state.taskHours['2026-10-01'][gitaTaskId()] = 2;"), false, '과제별 시간이 있는데 비었다고 본다');
        assert.strictEqual(probe("state.categories.push({ id:'c-n', name:'새 과제' });"), false, '사용자가 만든 과제가 있는데 비었다고 본다');
      });
    },
    //  ⑨ 실행 취소가 되살린 기록의 과제가 그사이 지워졌으면 기타로 붙는다 · 전체 초기화 뒤에도 기본 과제가 있다
    async undoAndClear(source) {
      await withBoot(source, WITH_DEFAULTS({ categories: [CAT('c-x', '지울 과제'), CAT('c-v', '휴가'), CAT('c-e', '기타')], entries: [ENT('e-1', 'c-x')], todos: [TODO('t-1', 'c-x')] }), async (W) => {
        W.ev("window.__e = entryById('e-1'); window.__t = todoById('t-1'); deleteEntry('e-1'); deleteTodo('t-1'); deleteCategory('c-x');");
        W.ev('restoreEntry(window.__e); restoreTodo(window.__t);');
        assert.strictEqual(W.ev("entryById('e-1').categoryId"), 'c-e', '지워진 과제를 가리키는 일정을 되살리며 기타로 붙이지 않았다');
        assert.strictEqual(W.ev("todoById('t-1').categoryId"), 'c-e', '지워진 과제를 가리키는 할 일을 되살리며 기타로 붙이지 않았다');
        await settle();   // 앞 저장 왕복을 끝낸다(저장 중이면 전량 교체가 다음 통상 저장으로 밀린다 · dbSave 직렬화)
        W.ev('clearAll();');
        await settle();
        assert.deepStrictEqual(W.cats().map((c) => c.name), ['휴가', '기타'], '전체 초기화 뒤 기본 과제(휴가, 기타)가 없다');
        const last = W.reqs('replaceAllState').pop();
        assert.ok(last && last.params.state.categories.map((c) => c.name).join(',') === '휴가,기타', '초기화의 전량 교체 저장에 기본 과제가 실리지 않았다');
      });
    },
    //  ⑩-a 가져오기: 목록에 없는 공식 과제를 가리키는 기록, 시간은 기타가 아니라 그 공식 과제로(편입) — 카탈로그에 있으면 그 이름
    async importKeepsOfficialRefs(source) {
      await withBoot(source, WITH_DEFAULTS(), async (W) => {
        const ON = 'db-11111111-2222-3333-4444-555555555555', GONE = 'db-99999999-8888-7777-6666-555555555555';
        W.ev('dbCatalog = ' + JSON.stringify([{ id: ON, name: '카탈로그 과제', color: '#3e5be0', source: 'db', section: '' }]) + ';');
        const FILE = { categories: [CAT('f-p', '파일 과제')],
          entries: [ENT('e-on', ON), ENT('e-gone', GONE), ENT('e-x', 'c-x')], todos: [TODO('t-on', ON)],
          taskHours: { '2026-10-01': { [ON]: 2, [GONE]: 1.5, 'c-x': 4 } }, rooms: [] };
        W.ev('pendingImport = ' + JSON.stringify(FILE) + '; applyImport({ quiet: true });');
        await settle();
        const cats = W.cats();
        const on = W.evJSON(`catById(${JSON.stringify(ON)})`), gone = W.evJSON(`catById(${JSON.stringify(GONE)})`);
        assert.ok(cats.some((c) => c.id === ON && c.source === 'db') && on.name === '카탈로그 과제', '카탈로그에 있는 공식 과제를 편입하지 않았다: ' + JSON.stringify(cats));
        assert.ok(cats.some((c) => c.id === GONE && c.source === 'db') && gone.dbGone === true && gone.name === '(공식 과제)', '카탈로그에 없는 공식 과제를 dbGone 자리표시로 편입하지 않았다: ' + JSON.stringify(gone));
        assert.deepStrictEqual(W.evJSON("state.entries.map(function(e){ return e.id + ':' + e.categoryId; })"), ['e-on:' + ON, 'e-gone:' + GONE, 'e-x:' + W.idOf('기타')],
          '공식 과제를 가리키는 기록이 기타로 갔다(또는 개인 과제의 없는 참조가 기타로 가지 않았다)');
        assert.strictEqual(W.ev("todoById('t-on').categoryId"), ON, '공식 과제를 가리키는 할 일이 기타로 갔다');
        assert.deepStrictEqual(W.evJSON('state.taskHours'), { '2026-10-01': { [ON]: 2, [GONE]: 1.5 } }, '공식 과제의 시간이 버려졌다(또는 없는 개인 과제의 시간이 남았다)');
      });
    },
    //  ⑩-b 공식 과제 제거(일정, 할 일 0건) — 그 과제의 시간도 같은 저장에서 걷는다. 남기면 호스트의 과제 DELETE 가 FK 로 실패한다.
    async unsubscribeDropsHours(source) {
      const OFF = 'db-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      await withBoot(source, WITH_DEFAULTS({ categories: [CAT(OFF, '공식 과제', { source: 'db' }), CAT('c-v', '휴가'), CAT('c-e', '기타')],
        taskHours: { '2026-10-01': { [OFF]: 3, 'c-e': 1 }, '2026-10-02': { [OFF]: 2 } } }), async (W) => {
        W.ev('openCatModal();');
        W.btn(OFF, 'unsub').click();
        await settle();
        const cf = W.confirms();
        assert.ok(cf.length === 1 && /과제별 시간 2일은 함께 지워집니다/.test(cf[0][1]), '제거 확인창이 함께 지워지는 시간을 말하지 않는다: ' + JSON.stringify(cf));
        assert.ok(!W.cats().some((c) => c.id === OFF), '공식 과제가 제거되지 않았다');
        assert.deepStrictEqual(W.evJSON('state.taskHours'), { '2026-10-01': { 'c-e': 1 } }, '제거한 공식 과제의 시간이 state 에 남았다');
        const saves = W.saves();
        assert.strictEqual(saves.length, 1, '제거가 한 번의 저장으로 나가지 않았다');
        assert.strictEqual(Object.values(saves[0].taskHours || {}).filter((d) => d && d[OFF] !== undefined).length, 0,
          '제거한 공식 과제의 시간이 저장 payload 에 남았다 — 호스트에서 과제 DELETE 가 FK(1451)로 실패하고 그 뒤 모든 저장이 실패한다');
      });
    },
    //  (⑩-c 커밋 가져오기 시험은 2026-10-26 Git, SVN 기능과 함께 없앴다.)
    //  ⑩-d 다시 주입되면 보장 저장 플래그를 새로 정한다 — 잠금으로 미뤄진 저장이 서버가 이미 기본 과제를 돌려준 뒤에 나가지 않는다
    async reapplyResetsDirty(source) {
      const W = boot(source);
      try {
        W.applyState(EMPTY);
        await settle();
        W.ev("__dbConnLost({ kind:'network', detail:'x' })");
        W.runBootFlush();
        await settle();
        assert.strictEqual(W.reqs('saveState').length, 0, '시험 전제: 잠금 중이라 보장 저장이 나가지 않아야 한다');
        W.clear();
        W.applyState(WITH_DEFAULTS());   // 서버가 이미 기본 과제를 갖고 있다(다른 PC 가 만들었다 등)
        await settle();
        assert.strictEqual(W.ev('__bootDefaultsDirty'), false, '다시 주입됐는데 앞 주입의 보장 플래그가 남았다');
        W.runBootFlush();
        await settle();
        assert.strictEqual(W.reqs('saveState').length, 0, '서버가 이미 기본 과제를 돌려줬는데 쓸데없는 전체 저장을 보냈다');
      } finally { await W.close(); }
    },
    //  ⑩-e 이전 기록 가져오기 — 저장 왕복 중이면 끝난 뒤에 교체한다(전량 교체가 차분 저장으로 밀리지 않는다)
    async legacyWaitsForSave(source) {
      await withBoot(source, EMPTY, async (W) => {
        let release;
        W.handlers.saveState = () => new Promise((r) => { release = () => r({ ok: true }); });
        W.handlers.readLegacyXml = { ok: true, name: 'old.xml', text: '<?xml version="1.0" encoding="UTF-8"?><taskCalendar version="1"><categories><category id="c1"><name>옛 과제</name></category></categories><entries><entry id="e1" date="2026-08-03" categoryId="c1" allDay="true"><title>옛 기록</title></entry></entries></taskCalendar>' };
        W.handlers.replaceAllState = { ok: true };
        W.ev("setAttendance('2026-10-01', '2', 0);");   // 근태는 빈 캘린더 판정과 무관 — 저장 왕복만 하나 띄운다
        await settle();
        assert.strictEqual(W.ev('__dbSaving'), true, '시험 전제: 저장 왕복이 진행 중이어야 한다');
        W.ev("__legacyProbe = { name: 'old.xml', size: 1, mtime: '' }; legacyPromptImport();");
        await settle();
        release();
        await settle(); await settle();
        assert.strictEqual(W.reqs('replaceAllState').length, 1, '저장 왕복 중에 가져오기를 눌렀더니 전량 교체가 나가지 않았다(차분 저장으로 밀렸다)');
        assert.ok(W.ev("state.entries.some(function(e){ return e.id === 'e1'; })"), '교체가 적용되지 않았다');
      });
    },
    //  ⑩-f 공백 붙은 ' 기타 ' 개인 과제도 기본 과제다 — 두 번째 기타를 만들지 않고 이름을 바로잡는다(부팅, 가져오기 모두)
    async trimmedNames(source) {
      await withBoot(source, { categories: [CAT('c-sp', ' 기타 '), CAT('c-v', '휴가')], entries: [], todos: [], rooms: [] }, async (W) => {
        assert.strictEqual(W.cats().filter((c) => c.name.trim() === '기타').length, 1, "' 기타 ' 가 있는데 기타를 하나 더 만들었다");
        assert.strictEqual(W.idOf('기타'), 'c-sp', "' 기타 ' 를 기본 과제로 보지 않는다");
        assert.strictEqual(W.ev("catById('c-sp').name"), '기타', '기본 과제 이름의 앞뒤 공백을 바로잡지 않았다(보고서 머리가 회사 양식과 달라진다)');
        assert.strictEqual(W.ev("isDefaultTask(catById('c-sp'))"), true);
      });
      await withBoot(source, WITH_DEFAULTS(), async (W) => {
        W.ev('pendingImport = ' + JSON.stringify({ categories: [CAT('f-sp', '  휴가'), CAT('f-g', '기타')], entries: [], todos: [], rooms: [] }) + '; applyImport({ quiet: true });');
        await settle();
        assert.deepStrictEqual(W.cats().map((c) => c.id + ':' + c.name), ['f-sp:휴가', 'f-g:기타'], "가져온 파일의 '  휴가' 를 쓰지 않고 휴가를 또 만들었다");
      });
    },
  };

  test('행동①: 부팅 뒤 휴가, 기타가 하나씩(맨 뒤) 생기고 저장은 부팅이 끝난 뒤 한 번 · 다시 받으면 새로 만들지 않는다', () => checks.bootCreatesOnce(src));
  test('행동②: 같은 이름의 공식 과제는 기본 과제가 아니다 · 있는 개인 기타를 그대로 쓴다', () => checks.bootRespectsExisting(src));
  test('행동③: 열람 창(PEER)에서는 기본 과제를 만들지 않는다 · 옮기기, 삭제도 막힌다', () => checks.peerUntouched(src));
  test('행동④: 편집 잠금 중에는 부팅 보장 저장을 보내지 않는다(state 에는 있다)', () => checks.lockedNoBootSave(src));
  test('행동⑤: 기본 과제는 삭제 버튼이 없고 이름이 잠기며 deleteCategory 가 거부한다 · 재연결 대상이 아니다 · 같은 이름 새 과제를 막는다', () => checks.protectedDefaults(src));
  test('행동⑥: 선택 상자에 빈 선택지가 없고 새 기록 기본값은 기타(필터 과제 우선) · 데이터 함수도 빈 값을 기타로 채운다', () => checks.pickersDefaultToGita(src));
  test('행동⑦: 과제 삭제가 그 과제의 일정, 할 일, 시간을 지운다 · 확인창 숫자 · 저장 payload 에 참조 0 · 저장 한 번', () => checks.deleteRemovesData(src));
  test('행동⑧: 데이터 없는 과제의 확인창 문구 · 취소하면 아무것도 바뀌지 않는다', () => checks.deleteEmptyAndCancel(src));
  test('행동⑨: 옮기기 — 일정, 할 일, 시간이 옮겨지고 겹친 날은 더해지며 24 를 넘지 않는다 · 출발 과제는 남는다 · 저장 한 번', () => checks.moveSumsHours(src));
  test('행동⑩: 옮기기는 잠금 중, 같은 과제, 없는 과제를 거부한다', () => checks.moveGuarded(src));
  test("행동⑪: XML 가져오기 — 과제 없는/없는 과제의 기록은 기타로 · 파일의 '기타' 를 쓴다 · 없는 과제의 시간은 버린다", () => checks.importAttachesToGita(src));
  test('행동⑫: 빈 캘린더 판정 — 기본 과제만 있으면 비어 있다', () => checks.emptyWithDefaultsOnly(src));
  test('행동⑬: 실행 취소로 되살린 기록은 지워진 과제 대신 기타로 · 전체 초기화 뒤에도 기본 과제가 있다', () => checks.undoAndClear(src));

  test('행동⑭: 가져오기 — 목록에 없는 공식 과제의 기록과 시간은 기타가 아니라 그 공식 과제로(카탈로그 이름 또는 dbGone 자리표시)', () => checks.importKeepsOfficialRefs(src));
  test('행동⑮: 공식 과제 제거가 그 과제의 시간도 같은 저장에서 걷는다(FK 1451 방지) · 확인창이 말한다', () => checks.unsubscribeDropsHours(src));
  test('행동⑰: 다시 주입되면 보장 저장 플래그를 새로 정한다(쓸데없는 전체 저장 없음)', () => checks.reapplyResetsDirty(src));
  test('행동⑱: 이전 기록 가져오기는 진행 중인 저장을 기다린 뒤 전량 교체로 보낸다', () => checks.legacyWaitsForSave(src));
  test("행동⑲: 앞뒤 공백이 붙은 ' 기타 ', '  휴가' 도 기본 과제로 보고 이름을 바로잡는다(부팅, 가져오기)", () => checks.trimmedNames(src));

  //  변이 — 되돌아가면 안 되는 판을 만들고 같은 검사가 잡는지 본다
  test('변이①: 부팅 보장을 지우면 행동① 이 실패한다', async () => {
    const bad = mutate('    if(!PEER) __bootDefaultsDirty = ensureDefaultTasks(state);\n', '', src);
    await assert.rejects(() => checks.bootCreatesOnce(bad), /하나씩 생기지 않았다/);
  });
  test('변이②: 보장 저장이 잠금을 보지 않으면 행동④ 가 실패한다', async () => {
    const bad = mutate('  if(!HOST || PEER || editLocked()) return;\n  __bootDefaultsDirty = false;', '  if(!HOST || PEER) return;\n  __bootDefaultsDirty = false;', src);
    await assert.rejects(() => checks.lockedNoBootSave(bad), /잠금 중에 기본 과제 저장을 보냈다|토스트/);
  });
  test('변이③: 과제 삭제가 예전처럼 참조를 null 로 풀면 행동⑦ 이 실패한다', async () => {
    const bad = mutate("  state.entries = state.entries.filter(e => !e || e.categoryId !== id);\n  state.todos = (state.todos || []).filter(t => !t || t.categoryId !== id);",
      "  state.entries.forEach(e => { if(e.categoryId === id) e.categoryId = null; });\n  (state.todos || []).forEach(t => { if(t.categoryId === id) t.categoryId = null; });", src);
    await assert.rejects(() => checks.deleteRemovesData(bad), /그 과제의 일정이 남았다/);
  });
  test('변이④: 옮기기가 겹친 날의 시간을 더하지 않고 덮으면 행동⑨ 가 실패한다', async () => {
    const bad = mutate('const v = Math.round(Math.min(a + b, 24) * 100) / 100;', 'const v = Math.round(Math.min(a, 24) * 100) / 100;', src);
    await assert.rejects(() => checks.moveSumsHours(bad), /겹친 날을 더하지 않았거나/);
  });
  test('변이⑤: 옮기기에 24 상한이 없으면 행동⑨ 가 실패한다', async () => {
    const bad = mutate('const v = Math.round(Math.min(a + b, 24) * 100) / 100;', 'const v = Math.round((a + b) * 100) / 100;', src);
    await assert.rejects(() => checks.moveSumsHours(bad), /24 상한/);
  });
  test('변이⑥: 과제 선택 상자에 빈 선택지를 되살리면 행동⑥ 이 실패한다', async () => {
    const bad = mutate("  const head = placeholder ? `<option value=\"\">${esc(placeholder)}</option>` : '';",
      "  const head = `<option value=\"\">${esc(placeholder || '미분류')}</option>`;", src);
    await assert.rejects(() => checks.pickersDefaultToGita(bad), /빈 선택지/);
  });
  test('변이⑦: deleteCategory 의 기본 과제 거르기를 빼면 행동⑤ 가 실패한다', async () => {
    const bad = mutate('if(!c || isDefaultTask(c) || isOfficialCat(c)) return false;', 'if(!c || isOfficialCat(c)) return false;', src);
    await assert.rejects(() => checks.protectedDefaults(bad), /deleteCategory 가 기본 과제를 지웠다/);
  });
  test('변이⑧: 빈 캘린더 판정을 옛 정의(과제 0개)로 되돌리면 행동⑫ 가 실패한다', async () => {
    const bad = mutate('  const cats = (state.categories || []).filter(c => !isDefaultTask(c));', '  const cats = (state.categories || []);', src);
    await assert.rejects(() => checks.emptyWithDefaultsOnly(bad), /빈 캘린더가 아니라고 본다/);
  });
  test('변이⑨: 가져오기 정리를 빼면 행동⑪ 이 실패한다', async () => {
    const bad = mutate('  importNormalizeCats(state);\n', '', src);
    await assert.rejects(() => checks.importAttachesToGita(bad), /휴가를 만들지 않았다|기타로 가지 않았다/);
  });
  test('변이⑩: 재연결 목록이 기본 과제를 거르지 않으면 행동⑤ 가 실패한다', async () => {
    const bad = mutate('filter(c => !isOfficialCat(c) && !isDefaultTask(c));', 'filter(c => !isOfficialCat(c));', src);
    await assert.rejects(() => checks.protectedDefaults(bad), /재연결 목록에 기본 과제가 있다/);
  });
  test('변이⑫: 가져오기가 공식 과제를 편입하지 않으면 행동⑭ 가 실패한다', async () => {
    const bad = mutate("  for(const id of refs) subscribeDbCat(dbCatalogById(id) || { id, name:'(공식 과제)', color:'#5b6b7d', dbGone:true }, s);\n", '', src);
    await assert.rejects(() => checks.importKeepsOfficialRefs(bad), /편입하지 않았다/);
  });
  test('변이⑬: 공식 과제 제거가 시간을 걷지 않으면 행동⑮ 가 실패한다', async () => {
    const bad = mutate('  dropCatHours(id);\n  state.categories = state.categories.filter(x => x.id !== id);\n  if(filterCatId === id) filterCatId = null;\n  if(noteFilterCat === id) noteFilterCat = null;\n  return true;',
      '  state.categories = state.categories.filter(x => x.id !== id);\n  if(filterCatId === id) filterCatId = null;\n  if(noteFilterCat === id) noteFilterCat = null;\n  return true;', src);
    await assert.rejects(() => checks.unsubscribeDropsHours(bad), /시간이 state 에 남았다/);
  });
  test('변이⑮: 다시 주입될 때 보장 플래그를 남기면(예전 판) 행동⑰ 이 실패한다', async () => {
    const bad = mutate('    if(!PEER) __bootDefaultsDirty = ensureDefaultTasks(state);', '    if(!PEER && ensureDefaultTasks(state)) __bootDefaultsDirty = true;', src);
    await assert.rejects(() => checks.reapplyResetsDirty(bad), /플래그가 남았다/);
  });
  test('변이⑯: 이전 기록 가져오기가 저장 왕복을 기다리지 않으면 행동⑱ 이 실패한다', async () => {
    const bad = mutate('    await awaitSaveIdle();', '', src);
    await assert.rejects(() => checks.legacyWaitsForSave(bad), /차분 저장으로 밀렸다/);
  });
  test("변이⑰: 기본 과제 판정이 공백을 빼지 않으면 행동⑲ 가 실패한다", async () => {
    const bad = mutate("const catNameKey = c => String((c && c.name) || '').trim();", "const catNameKey = c => String((c && c.name) || '');", src);
    await assert.rejects(() => checks.trimmedNames(bad), /하나 더 만들었다|기본 과제로 보지 않는다/);
  });
  test('변이⑪: 실행 취소가 지워진 과제를 그대로 되살리면 행동⑬ 이 실패한다', async () => {
    const bad = mutate('function restoreEntry(e){ if(!e) return; state.entries.push(reattachToLiveCat(e)); save(); }',
      'function restoreEntry(e){ if(!e) return; state.entries.push(e); save(); }', src);
    await assert.rejects(() => checks.undoAndClear(bad), /기타로 붙이지 않았다/);
  });
}
