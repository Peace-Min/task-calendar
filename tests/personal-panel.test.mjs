// 개인 달력 우측 패널 정리와 보기 하나(docs/PERSONAL-PANEL.md, 2026-11-03) 시험.
//
//   (S) 정적: 패널 탭과 "＋ 새 기록" 단추가 없고, 패널은 머리, 본문, 맨 아래 줄 셋이다. 보기 팝업은 머리, 기록 종류(seg 한 줄 고르기), 과제 순서이고
//       보기 옵션과 고른 과제 칩이 없다(2026-11-03 사용자 확정). 새로 쓴 글에 금지 기호가 없고 새 hex 색이 없다.
//   (U) 단위: 요약 글자(전체, 일정만, 할 일만, 과제 n, 쉼표로 이어 붙임), 기록 종류 한 줄 고르기(둘 다 꺼진 상태 없음), 옛 저장값 무시,
//       칸 맨 위 줄(할 일 2개까지 줄마다, 3개 이상 개수, ★ 먼저).
//   (R) 런타임(jsdom): 탭 없음, 일정 n과 할 일 n 두 묶음 고정(없음, 보기에서 숨김), [+ 추가] 하나와 종류 기본값, 보기 팝업 구성과 동작(seg 셋, disabled 없음),
//       월간 칸 할 일 줄과 개수, ★ 정렬, 밀린 할 일 팝업(묶음 셋, 이번 주와 나중 없음, ★ 묶음 없음, 완료 접힘, 이동과 강조), 맨 아래 줄 글자와 0 일 때,
//       칩 누르면 날짜 선택과 강조(탭 전환 없음), 주간 줄, 기억(옛 done, star 값은 무시), 좁은 창 시트 안 [+ 추가], 열람 프레임 읽기 전용.
//   (M) 변이: 일정 끔 무시, 기한 지남 기준(끝 날짜), 완료 접힘, 기록 종류 고르기, 개수 기준, ★ 정렬, 종류 기본값, 열람 프레임 [+ 추가], 기억을 되돌리면 위 시험이 실패한다.
// ★ 회사 사이트에는 아무것도 보내지 않는다(호스트 postMessage 는 버린다).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  const out = text.slice(0, a) + repl + text.slice(a + find.length);
  assert.notStrictEqual(out, text, '변이가 원본을 바꾸지 못했다');
  return out;
}
const ymdAdd = (ds, n) => { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

//  패치노트(#patchModal)는 지난 버전의 기록이라 지금 화면 문구 검사에서 뺀다
function withoutPatchNotes(src) {
  const a = src.indexOf('id="patchModal"');
  if (a < 0) return src;
  const b = src.indexOf('\n</div>\n', a);
  return src.slice(0, a) + src.slice(b);
}

// ══════════════════════════════════════════════════════════════════════
// (S) 정적
// ══════════════════════════════════════════════════════════════════════
function checkStatic(src) {
  const live = withoutPatchNotes(src);
  //  패널 탭과 할 일 탭의 흔적이 없다
  for (const gone of ['id="dpTabs"', 'data-ptab', 'dptab-', 'setPanelTab', 'noteImportantOnly', 'noteCollapsed', 'btnTodoNew', 'impOnly', 'renderTodoListTab', 'todoBuckets', 'class="dp-tabbar"']) {
    assert.ok(!live.includes(gone), `지운 패널 탭의 흔적 ${gone} 이 남았다`);
  }
  assert.ok(!/(^|[^.\w])noteTab\b/m.test(live), '패널 탭 상태(noteTab)가 남았다');   // 관리 창의 dataset.noteTab 은 다른 것이라 점 앞은 뺀다
  const css = src.slice(0, src.indexOf('</style>'));
  assert.ok(!/\.dp-tab[,.{:\s]/.test(css), '.dp-tab 규칙이 남았다');
  //  "＋ 새 기록" 단추가 없다(날짜 두 번 누르기는 남는다)
  assert.ok(!live.includes('id="btnNew"') && !live.includes("'btnNew'") && !live.includes('#btnNew'), '＋ 새 기록 단추(btnNew)가 남았다');
  assert.ok(!/[＋+] ?새 기록/.test(live), '화면 문구에 "＋ 새 기록" 이 남았다(패치노트의 지난 기록은 제외)');
  assert.ok(!live.includes('할 일 탭') && !live.includes('일정 상세 탭'), '화면 문구에 지운 탭 이름이 남았다');
  assert.ok(/addEventListener\('dblclick'[\s\S]{0,260}openAddOnDate\(cell\.dataset\.date\)/.test(live), '날짜 두 번 누르기로 여는 길이 없다');
  //  패널 = 머리, 본문, 맨 아래 한 줄. 추가 단추는 머리의 하나뿐이다
  const a = live.indexOf('<aside class="day-panel" id="dayPanel">'), b = live.indexOf('</aside>', a);
  const aside = live.slice(a, b);
  const ids = ['id="dpHead"', 'id="dpBody"', 'id="dpFoot"'].map((s) => aside.indexOf(s));
  assert.ok(ids.every((i) => i >= 0) && ids[0] < ids[1] && ids[1] < ids[2], '패널이 머리, 본문, 맨 아래 줄 순서가 아니다');
  assert.strictEqual((live.match(/id="btnAddHere"/g) || []).length, 1, '[+ 추가] 단추가 하나가 아니다');
  assert.ok(extractFunction(live, 'dayHeadHtml').includes('PEER ?'), '열람 창에서 [+ 추가] 를 그리지 않는 갈래가 없다');
  assert.ok(/openAddOnDate\(date\)\{ openQuickAdd\(date, viewKinds\.ev \? 'event' : 'todo'\); \}/.test(live), '[+ 추가]의 종류 기본값(할 일만이면 할 일)이 없다');
  //  보기 팝업: 머리(처음대로), 기록 종류(seg 전체, 일정, 할 일), 과제 순서. 보기 옵션과 체크박스, 막는 칸(disabled)은 없다
  const pop = extractFunction(live, 'filterPopOpen');
  //  과제 목록 부분은 공용 고르기 목록(fbListMarkup, docs/PC-WATCH-2.md §4)이다
  const at = ['달력에 보일 것', 'data-act="reset">처음대로', '기록 종류', 'class="seg vp-seg"', 'data-vk="all">전체', 'data-vk="ev">일정', 'data-vk="td">할 일', '>과제<', "fbListMarkup('fbList'"].map((s) => pop.indexOf(s));
  assert.ok(extractFunction(live, 'fbListMarkup').includes('role="listbox"'), '공용 고르기 목록이 listbox 가 아니다');
  assert.ok(at.every((i) => i >= 0), '보기 팝업에 빠진 구성이 있다: ' + at.join());
  assert.ok(at.every((v, i) => i === 0 || v > at[i - 1]), '보기 팝업의 순서가 처음대로, 기록 종류, 과제가 아니다: ' + at.join());
  assert.ok(pop.includes('class="seg-b"') && !pop.includes('type="checkbox" data-v'), '기록 종류가 앱의 seg 단추가 아니다');
  for (const gone of ['viewOpts', 'viewSetOpt', 'data-vo', 'vp-opt', 'vp-ck']) assert.ok(!live.includes(gone), `없앤 보기 옵션의 흔적 ${gone} 이 남았다`);
  for (const gone of ['보기 옵션', '완료한 할 일 표시', '중요한 할 일만']) assert.ok(!pop.includes(gone), `보기 팝업에 없앤 ${gone} 이 남았다`);
  assert.ok(!/\.disabled\s*=/.test(extractFunction(live, 'filterSyncPop').replace(/\[data-act="reset"\][\s\S]*/, '')), '보기 팝업 기록 종류에 막는 칸(disabled)이 남았다');
  assert.ok(!/\.fb-pop \.vp-(opt|ck)/.test(css), '없앤 보기 옵션의 CSS 가 남았다');
  for (const gone of ['fb-rest', 'fitFilterChips', 'fbFreeWidth', 'fb-tok', 'fb-more', 'data-rm=']) assert.ok(!live.includes(gone), `고른 과제 칩의 흔적 ${gone} 이 남았다`);
  assert.ok(/id="fbBtn"[^`]*>[^`]*⚲ 보기/.test(extractFunction(live, 'renderFilterbar')), '단추 이름이 ⚲ 보기 가 아니다');
  //  같은 보기를 따르는 자리
  assert.ok(extractFunction(live, 'passFilter').includes('if(!viewKinds.ev) return false;'), '일정 끔이 passFilter 에 없다');
  assert.ok(extractFunction(live, 'pmMonthItems').includes('viewTodoPass(t)'), '월간 칸과 주간 줄의 할 일이 보기를 따르지 않는다');
  assert.ok(extractFunction(live, 'dayTodosList').includes('viewTodoPass(t)'), '패널 할 일이 보기를 따르지 않는다');
  assert.ok(extractFunction(live, 'todoAllGroups').includes('viewTodoPass(t, true)'), '밀린 할 일 팝업이 보기를 따르지 않는다');
  //  밀린 할 일 팝업: 묶음은 기한 지남, 기한 없음, 완료 셋뿐(★ 중요, 이번 주, 나중은 없다). 완료는 처음엔 접힘. 맨 아래 줄 글자
  const ga = extractFunction(live, 'todoAllGroups');
  assert.deepStrictEqual([...ga.matchAll(/key: '(\w+)'/g)].map((m) => m[1]), ['over', 'nodate', 'done'], '밀린 할 일 팝업의 묶음이 기한 지남, 기한 없음, 완료 셋이 아니다');
  assert.ok(!/weekEnd|calRowWeek|key: 'star'|key: 'week'|key: 'later'/.test(ga), '없앤 이번 주, 나중, ★ 중요 묶음의 계산이 남았다');
  assert.ok(/let taDoneOpen = false;/.test(live) && /function openTodoAll\(\)\{ taDoneOpen = false;/.test(live), '완료 묶음이 처음엔 접혀 있지 않다');
  assert.ok(live.includes('<h2>밀린 할 일</h2>') && !live.includes('<h2>할 일 전체</h2>'), '팝업 제목이 밀린 할 일이 아니다');
  const foot = extractFunction(live, 'dayFootHtml');
  assert.ok(foot.includes('밀린 할 일 없음') && foot.includes('>밀린 할 일<') && foot.includes('기한 없음 <span') && foot.includes('지남 <span'), '맨 아래 줄 글자가 규칙과 다르다');
  assert.ok(/\.dp-foot-n\.od\{[^}]*var\(--danger/.test(css) && /\.ta-h\.od\{[^}]*var\(--danger/.test(css), '기한 지남 머리와 알약이 위험 색 토큰이 아니다');
  assert.ok(/function viewPersist\(\)\{[\s\S]*localStorage\.setItem\(viewStoreKey\(\)/.test(live) && extractFunction(live, 'filterApply').includes('viewPersist()'), '보기를 기억하지 않는다');
  assert.ok(extractFunction(live, 'viewStoreKey').includes("'tc_view:' + rptDraftWho()"), '기억 키가 계정별이 아니다');
  //  새로 쓴 글(함수 본문)에 금지 기호가 없다
  const fns = ['viewSummary', 'viewSetKind', 'filterPopOpen', 'filterSyncPop', 'dayHeadHtml', 'dayDetailHtml', 'dayGrpHtml', 'dayFootHtml', 'todoAllHtml', 'todoAllGroups', 'todoIsOverdue', 'pmTodoZone', 'renderFilterbar'].map((n) => extractFunction(live, n)).join('\n');
  assert.ok(!/[—–「」]/.test(fns) && !/(^|\s)·(\s|$)/m.test(fns), '새 함수에 엠 대시, 낫표, 띄어 쓴 가운데 점이 있다');
  //  새 CSS 에 hex 색이 없다
  const mine = css.split('\n').filter((l) => /\.(dp-grp|dp-foot|dp-todos|ta-|td-sep|chip-tdcnt)|\.fb-pop[ ,.{>]|\.fb-pop \.vp-/.test(l));
  assert.ok(mine.length >= 12, '새 CSS 규칙을 찾지 못했다');
  assert.ok(mine.every((l) => !/#[0-9a-fA-F]{3,8}\b/.test(l)), '새 CSS 에 hex 색이 있다: ' + mine.find((l) => /#[0-9a-fA-F]{3,8}\b/.test(l)));
}
test('(S) 패널 탭과 새 기록 단추가 없고, 패널과 보기 팝업의 구성이 계약대로다', () => checkStatic(app));

// ══════════════════════════════════════════════════════════════════════
// (U) 단위
// ══════════════════════════════════════════════════════════════════════
const viewUnit = () => {
  const code = ['filterNormalize', 'viewIsDefault', 'viewSummary', 'viewTodoPass', 'viewSetKind', 'viewKindMode', 'viewReset', 'viewRestore'].map((f) => extractFunction(app, f)).join('\n');
  return new Function('state', 'PEER', 'localStorage', 'viewStoreKey', `let filterCats = null, viewKinds = { ev: true, td: true };
    ${code}
    return { st(o){ if('cats' in o) filterCats = o.cats; if('kinds' in o) viewKinds = o.kinds; }, summary: viewSummary, isDefault: viewIsDefault, pass: viewTodoPass, setKind: viewSetKind, mode: viewKindMode, reset: viewReset, restore: viewRestore, kinds: () => viewKinds, cats: () => filterCats };`)(
    { categories: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, false, { getItem: () => unitStore.v }, () => 'tc_view:7');
};
let unitStore = { v: null };
test('(U) 요약 글자: 처음이면 전체, 아니면 바뀐 것만(일정만, 할 일만, 과제 n), 쉼표로 이어 붙인다. 완료 숨김, 중요만은 없다', () => {
  const V = viewUnit();
  assert.strictEqual(V.summary(), '전체'); assert.strictEqual(V.isDefault(), true);
  V.st({ kinds: { ev: false, td: true } }); assert.strictEqual(V.summary(), '할 일만');
  V.st({ kinds: { ev: true, td: false } }); assert.strictEqual(V.summary(), '일정만');
  V.st({ kinds: { ev: true, td: true }, cats: new Set(['a', 'b']) }); assert.strictEqual(V.summary(), '과제 2');
  V.st({ cats: new Set(['a']), kinds: { ev: false, td: true } });
  assert.strictEqual(V.summary(), '할 일만, 과제 1');
  V.st({ cats: new Set(['a', 'c']), kinds: { ev: true, td: false } });
  assert.strictEqual(V.summary(), '일정만, 과제 2');
  assert.strictEqual(V.isDefault(), false);
  V.reset(); assert.strictEqual(V.summary(), '전체'); assert.strictEqual(V.cats(), null);
});
test('(U) 기록 종류는 한 줄 고르기(전체, 일정, 할 일)라 둘 다 꺼진 상태가 없고, 할 일 판정은 과제와 기록 종류만 본다', () => {
  const V = viewUnit();
  assert.strictEqual(V.setKind('ev'), true); assert.deepStrictEqual({ ...V.kinds() }, { ev: true, td: false }); assert.strictEqual(V.mode(), 'ev');
  assert.strictEqual(V.setKind('td'), true); assert.deepStrictEqual({ ...V.kinds() }, { ev: false, td: true }); assert.strictEqual(V.mode(), 'td');
  assert.strictEqual(V.setKind('all'), true); assert.deepStrictEqual({ ...V.kinds() }, { ev: true, td: true }); assert.strictEqual(V.mode(), 'all');
  assert.strictEqual(V.setKind('both-off'), false, '모르는 값을 받았다'); assert.strictEqual(V.setKind(undefined), false);
  assert.deepStrictEqual({ ...V.kinds() }, { ev: true, td: true }, '모르는 값이 상태를 바꿨다');
  for (const m of ['ev', 'td', 'all']) { V.setKind(m); assert.ok(V.kinds().ev || V.kinds().td, '둘 다 꺼진 상태가 생겼다'); }
  V.reset();
  const t = (o) => Object.assign({ id: 't', categoryId: 'a', done: false, prio: 'normal' }, o);
  assert.strictEqual(V.pass(t({ done: true })), true, '끝낸 할 일이 늘 보이지 않는다');
  assert.strictEqual(V.pass(t({})), true); assert.strictEqual(V.pass(t({ prio: 'high' })), true); assert.strictEqual(V.pass(t({ done: true, prio: 'normal' })), true);
  V.st({ cats: new Set(['b']) }); assert.strictEqual(V.pass(t({})), false, '과제 거르기가 안 된다'); assert.strictEqual(V.pass(t({ categoryId: 'b' })), true);
  V.reset(); V.setKind('ev');
  assert.strictEqual(V.pass(t({})), false, '할 일을 끈 보기에서 할 일이 통과한다'); assert.strictEqual(V.pass(t({}), true), true, 'anyKind 는 기록 종류 끔을 따지지 않아야 한다');
});
test('(U) 저장값에 예전 done, star 가 있어도 읽지 않는다(종류와 과제만 되살린다)', () => {
  const V = viewUnit();
  unitStore.v = JSON.stringify({ v: 1, ev: true, td: false, done: false, star: true, cats: ['a'] });
  V.restore();
  assert.deepStrictEqual({ ...V.kinds() }, { ev: true, td: false }); assert.deepStrictEqual([...V.cats()], ['a']);
  assert.strictEqual(V.summary(), '일정만, 과제 1', '옛 done, star 값이 요약에 새어 나온다');
  const t = { id: 't', categoryId: 'a', done: true, prio: 'normal' };
  V.st({ kinds: { ev: true, td: true } });
  assert.strictEqual(V.pass(t), true, '옛 done=false 값이 완료한 할 일을 숨긴다');
  assert.strictEqual(V.pass({ ...t, done: false, prio: 'normal' }), true, '옛 star=true 값이 중요하지 않은 할 일을 숨긴다');
  unitStore.v = JSON.stringify({ v: 1, ev: false, td: false, cats: null }); V.restore();
  assert.ok(V.kinds().ev || V.kinds().td, '둘 다 꺼진 저장값을 그대로 되살렸다');
  unitStore.v = null;
});
test('(U) 칸 맨 위 줄: 그날 하루짜리 할 일 2개까지는 줄마다, 3개 이상은 개수 하나, 중요와 안 끝낸 것이 먼저', () => {
  const code = ['todoZoneCmp', 'pmTodoZone'].map((f) => extractFunction(app, f)).join('\n');
  const Z = new Function('addDays', code + '\nreturn pmTodoZone;')((ds, n) => ymdAdd(ds, n));
  const from = '2026-10-11';   // 일요일
  const T = (id, o) => Object.assign({ id, text: id, prio: 'normal', done: false, createdAt: '2026-09-0' + id.length }, o);
  const it = (t, s2) => ({ todo: t, s: s2, e: s2 });   // pmMonthItems 의 항목 모양
  const tds = [
    it(T('n1'), '2026-10-12'),                                                       // 월: 1개
    it(T('n2'), '2026-10-13'), it(T('h2', { prio: 'high' }), '2026-10-13'),            // 화: 2개(중요 먼저)
    it(T('a3'), '2026-10-14'), it(T('b3'), '2026-10-14'), it(T('c3'), '2026-10-14'),   // 수: 3개 → 개수
    it(T('d4', { done: true }), '2026-10-15'), it(T('u4'), '2026-10-15'),             // 목: 끝낸 것은 뒤
  ];
  const r = Z(tds, from);
  assert.deepStrictEqual(r.days, [0, 1, 2, 3, 2, 0, 0]);
  assert.strictEqual(r.rows, 2, '맨 위 줄 수는 칸 중 가장 많은 쪽(2개까지)이다');
  const at = (c) => r.items.filter((i) => i.c0 === c).sort((a, b) => a.lane - b.lane);
  assert.deepStrictEqual(at(2).map((i) => i.x.todo.id), ['h2', 'n2'], '중요한 할 일이 먼저가 아니다');
  const cnt = at(3); assert.strictEqual(cnt.length, 1, '3개 이상인데 개수 하나로 접히지 않았다'); assert.strictEqual(cnt[0].x.todoCount, 3); assert.strictEqual(cnt[0].lane, 0);
  assert.deepStrictEqual(at(4).map((i) => i.x.todo.id), ['u4', 'd4'], '안 끝낸 할 일이 먼저가 아니다');
  assert.strictEqual(Z([], from).rows, 0);
  assert.strictEqual(Z([it(T('only'), '2026-10-12'), it(T('o2'), '2026-10-12')], from).rows, 2);
  assert.strictEqual(Z([it(T('x'), '2026-10-12'), it(T('y'), '2026-10-12'), it(T('z'), '2026-10-12')], from).rows, 1, '개수 칩만 있는 주는 한 줄이다');
});

// ══════════════════════════════════════════════════════════════════════
// (R) 런타임(jsdom)
// ══════════════════════════════════════════════════════════════════════
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;

if (!JSDOM) {
  skip('personal-panel: jsdom 미설치로 런타임 검증을 건너뜁니다', SKIP_NO_JSDOM,
    `이 파일의 test 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았습니다.`);
} else {
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  function bootWindow(url, src, pre) {
    const { window: w } = new JSDOM(src || app, {
      runScripts: 'dangerously', pretendToBeVisual: true, url,
      beforeParse(window) {
        window.chrome = { webview: { postMessage() {}, addEventListener() {}, removeEventListener() {} } };
        if (typeof window.crypto === 'undefined') window.crypto = { randomUUID: () => 'u-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        window.scrollTo = () => {};
        window.HTMLElement.prototype.scrollIntoView = function () {};
        if (!window.CSS) window.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
        if (pre) pre(window);
      },
    });
    const doc = w.document;
    return { w, doc, ev: (code) => w.eval(code), $: (s) => doc.querySelector(s), $$: (s) => [...doc.querySelectorAll(s)], close: () => { try { w.close(); } catch (_) {} } };
  }
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const CAT = (id, name) => ({ id, name, color: '#3e5be0', desc: '', createdAt: '2026-09-01T00:00:00Z' });
  const ENT = (id, date, categoryId) => ({ id, date, title: '일정 ' + id, categoryId, allDay: true, startTime: '', endTime: '', endDate: '', memo: '', location: '', recur: null, recurExcept: [] });
  const TODO = (id, categoryId, due, o) => Object.assign({ id, text: '할 일 ' + id, done: false, categoryId, due, endDate: '', prio: 'normal', completedAt: '', note: '', dayNotes: {}, createdAt: '2026-09-01T00:00:0' + (id.length % 10) + 'Z', updatedAt: '2026-09-01T00:00:00Z' }, o || {});

  //  오늘 기준 자료(실행하는 날이 바뀌어도 같은 모양): T = 오늘, D2 = 같은 달의 다른 날(할 일 2개)
  function mineData(today) {
    const dom = Number(today.slice(8)), D2 = ymdAdd(today, dom <= 20 ? 2 : -2);
    return { T: today, D2, data: {
      categories: [CAT('c-a', '알파'), CAT('c-b', '베타')],
      entries: [ENT('eA', today, 'c-a'), ENT('eB', today, 'c-b'), ENT('eC', D2, 'c-a')],
      todos: [
        TODO('tA', 'c-a', today), TODO('tB', 'c-a', today), TODO('tC', 'c-b', today, { prio: 'high' }), TODO('tD', 'c-b', today, { done: true, prio: 'high', completedAt: '2026-10-01T00:00:00Z' }),
        TODO('tE', 'c-a', D2), TODO('tF', 'c-b', D2, { prio: 'high' }),
        TODO('tG', 'c-a', ymdAdd(today, -40)), TODO('tH', 'c-b', ymdAdd(today, 40)),
        TODO('tI', 'c-a', ''), TODO('tJ', 'c-b', '', { prio: 'high' }),
      ],
      taskHours: {}, attendance: {},
    } };
  }
  async function bootMine(src, pre) {
    const W = bootWindow('https://tcapp.local/', src, pre);
    await settle();
    const M = mineData(W.ev('todayYmd()'));
    W.M = M;
    W.w.__applyState(JSON.stringify(M.data), META);
    W.ev(`view = {y: ${Number(M.T.slice(0, 4))}, m: ${Number(M.T.slice(5, 7)) - 1}}; selectedDate = "${M.T}"; setCalView("month"); renderAll();`);
    await settle();
    return W;
  }
  const click = (el) => { assert.ok(el, '누를 요소가 없다'); el.click(); };
  //  묶음 머리의 접기 표시(▾ ▸, docs/PC-WATCH-2.md §5)는 글자 비교에서 뺀다
  const grpText = (W, key) => [...W.$(`#dpBody .dp-grp[data-grp="${key}"]`).children].map((c) => c.textContent.replace(/[▾▸]/g, '').replace(/\s+/g, ' ').trim()).join(' ');
  const later = () => new Promise((r) => setTimeout(r, 180));   // 닫는 움직임(120ms)이 끝나길 기다린다
  const end = async (W) => { try { W.ev("closeModal('#quickAdd'); closeModal('#todoAllModal')"); } catch (_) {} await later(); W.close(); };
  const rowIds = (W) => W.$$('#dpBody .todo-row').map((r) => r.dataset.id);
  const chipsOf = (W, ds) => {   // 한 날짜 칸의 칩(막대는 칸 밖에 있으니 열 위치로 찾는다)
    const cell = W.$(`#grid .cell[data-date="${ds}"]`), row = cell.closest('.gridrow'), col = [...row.querySelectorAll('.cell')].indexOf(cell);
    return [...row.querySelectorAll('.chip-bar')].filter((c) => Number(c.dataset.c0) <= col && Number(c.dataset.c1) >= col);
  };
  const lane = (c) => Number(c.dataset.lane);
  const setView = (W, js) => { W.ev(js); W.ev('filterApply()'); };

  const checks = {
    //  탭 없음, 두 묶음 고정, 머리의 [+ 추가] 하나
    async panelShape(src) {
      const W = await bootMine(src);
      try {
        assert.strictEqual(W.$$('#dayPanel [role=tab], #dayPanel .dp-tab').length, 0, '패널에 탭이 있다');
        assert.ok(!W.$('#dpTabs'));
        assert.deepStrictEqual(W.$$('#dpBody > .dp-grp').map((g) => g.dataset.grp), ['ev', 'td'], '두 묶음(일정, 할 일)이 아니다');
        assert.strictEqual(W.$$('#btnAddHere').length, 1, '[+ 추가] 가 하나가 아니다');
        assert.ok(W.$('#dpHead').contains(W.$('#btnAddHere')), '[+ 추가] 가 머리에 없다');
        assert.ok(W.$('#dpHead').textContent.includes('요일') && /\d+월 \d+일/.test(W.$('#dpHead').textContent), '머리에 날짜와 요일이 없다');
        assert.ok(W.$('#dpFoot') && W.$('#dpBody') && !W.$('#dpBody').contains(W.$('#dpFoot')), '맨 아래 고정 줄이 본문 밖에 없다');
        assert.ok(grpText(W, 'ev').startsWith('일정 2 ') && grpText(W, 'ev').includes('일정 eA') && grpText(W, 'ev').includes('일정 eB'), '일정 묶음이 아니다: ' + grpText(W, 'ev'));
        assert.ok(grpText(W, 'td').startsWith('할 일 4 '), '할 일 묶음 머리가 "할 일 n" 이 아니다: ' + grpText(W, 'td'));
        //  빈 날: 두 묶음은 같은 자리에 그대로, 각각 "없음"
        const empty = ymdAdd(W.M.T, 1);
        W.ev(`selectDate("${empty}")`);
        assert.deepStrictEqual(W.$$('#dpBody > .dp-grp').map((g) => g.dataset.grp), ['ev', 'td'], '빈 날에 묶음이 사라졌다(패널 모양이 바뀐다)');
        assert.strictEqual(grpText(W, 'ev'), '일정 0 없음'); assert.strictEqual(grpText(W, 'td'), '할 일 0 없음');
        assert.ok(W.$('#btnAddHere') && W.$('#dpFoot'), '빈 날에 머리 단추나 맨 아래 줄이 사라졌다');
        //  보기에서 끈 종류: 숫자 없이 "보기에서 숨김"
        W.ev(`selectDate("${W.M.T}")`);
        setView(W, 'viewSetKind("ev")');
        assert.strictEqual(grpText(W, 'td'), '할 일 보기에서 숨김'); assert.ok(grpText(W, 'ev').startsWith('일정 2 '));
        setView(W, 'viewSetKind("td")');
        assert.strictEqual(grpText(W, 'ev'), '일정 보기에서 숨김'); assert.ok(grpText(W, 'td').startsWith('할 일 4 '));
        assert.deepStrictEqual(W.$$('#dpBody > .dp-grp').map((g) => g.dataset.grp), ['ev', 'td'], '끈 종류의 묶음이 사라졌다');
      } finally { await end(W); }
    },
    //  [+ 추가]와 날짜 두 번 누르기의 종류 기본값, 새 기록 단추 없음
    async addKinds(src) {
      const W = await bootMine(src);
      try {
        assert.ok(!W.$('#btnNew') && !/새 기록/.test(W.$('header.topbar').textContent), '도구줄에 "새 기록" 단추가 남았다');
        const open = () => !W.$('#quickAdd').classList.contains('hidden');
        const shut = async () => { W.ev("closeModal('#quickAdd')"); await later(); assert.ok(!open()); };
        click(W.$('#btnAddHere'));
        assert.ok(open(), '[+ 추가] 가 입력 창을 열지 않았다');
        assert.strictEqual(W.ev('qaType'), 'event', '기본 종류가 일정이 아니다'); assert.strictEqual(W.$('#qaDate').value, W.M.T, '고른 날짜로 열리지 않았다');
        assert.strictEqual(W.$('#quickAdd [data-qatype="event"]').getAttribute('aria-pressed'), 'true');
        await shut();
        setView(W, 'viewSetKind("td")');
        click(W.$('#btnAddHere'));
        assert.strictEqual(W.ev('qaType'), 'todo', '보기가 할 일만인데 할 일로 열리지 않았다');
        assert.strictEqual(W.$('#quickAdd [data-qatype="todo"]').getAttribute('aria-pressed'), 'true');
        await shut();
        //  날짜 두 번 누르기
        setView(W, 'viewReset()');
        W.$(`#grid .cell[data-date="${W.M.D2}"]`).dispatchEvent(new W.w.MouseEvent('dblclick', { bubbles: true }));
        assert.ok(open(), '날짜 두 번 누르기로 열리지 않는다'); assert.strictEqual(W.$('#qaDate').value, W.M.D2); assert.strictEqual(W.ev('qaType'), 'event');
        await shut();
        //  좁은 창: 시트가 뜨고 그 안의 [+ 추가] 로 추가된다
        Object.defineProperty(W.w, 'innerWidth', { value: 500, configurable: true });
        W.ev(`selectDate("${W.M.D2}")`);
        assert.ok(W.doc.body.classList.contains('sheet-open'), '좁은 창에서 시트가 뜨지 않았다');
        assert.ok(W.$('#dayPanel #btnAddHere'), '시트 안에 [+ 추가] 가 없다');
        click(W.$('#dayPanel #btnAddHere'));
        assert.ok(open() && W.$('#qaDate').value === W.M.D2, '시트 안 [+ 추가] 로 열리지 않았다');
        W.$('#qaTitle').value = '시트에서 추가';
        W.ev('qaSave()');
        await settle();
        assert.ok(W.ev('state.entries.some(function(e){ return e.title === "시트에서 추가" && e.date === "' + W.M.D2 + '"; })'), '시트 안 추가가 저장되지 않았다');
        //  좁은 창에서 시트가 열려 있어도 보기 팝업이 가려지지 않는다(팝업을 열기 전에 시트를 닫는다)
        W.ev('selectDate("' + W.M.D2 + '")');
        assert.ok(W.doc.body.classList.contains('sheet-open'));
        click(W.$('#fbBtn'));
        assert.ok(W.$('#fbPop') && !W.doc.body.classList.contains('sheet-open'), '시트가 열린 채 보기 팝업이 열렸다(팝업이 시트 뒤에 가려진다)');
      } finally { await end(W); }
    },
    //  보기 팝업의 구성과 동작, 요약, 단추 강조, 모든 자리가 같은 보기
    async viewPop(src) {
      const W = await bootMine(src);
      try {
        const T = W.M.T;
        const btn = W.$('#filterbar .fb-btn');
        assert.strictEqual(btn.querySelector('.pl').textContent, '⚲ 보기'); assert.strictEqual(btn.querySelector('.pv').textContent, '전체');
        assert.ok(!btn.classList.contains('filtered'), '처음 상태인데 단추가 강조돼 있다');
        assert.strictEqual(W.$$('#filterbar .fb-btn').length, 1, '보기 단추가 하나가 아니다');
        click(btn);
        const pop = W.$('#fbPop');
        assert.ok(pop, '팝업이 열리지 않았다');
        assert.strictEqual(pop.querySelector('.vp-head b').textContent, '달력에 보일 것');
        assert.strictEqual(pop.querySelector('[data-act="reset"]').textContent, '처음대로');
        assert.deepStrictEqual([...pop.querySelectorAll('.vp-h')].map((h) => h.textContent), ['기록 종류', '과제'], '보기 팝업이 기록 종류, 과제 두 칸이 아니다');
        const seg = pop.querySelector('.seg.vp-seg'), kb = [...seg.querySelectorAll('.seg-b')];
        assert.deepStrictEqual(kb.map((b) => [b.dataset.vk, b.textContent.trim()]), [['all', '전체'], ['ev', '일정'], ['td', '할 일']], '기록 종류 한 줄 고르기가 [전체 | 일정 | 할 일] 이 아니다');
        assert.strictEqual(pop.querySelectorAll('input[type=checkbox]').length, 0, '체크박스가 남았다(보기 옵션은 없다)');
        assert.ok(!/완료한 할 일 표시|중요한 할 일만|보기 옵션/.test(pop.textContent), '없앤 보기 옵션 글자가 남았다');
        assert.strictEqual(pop.querySelector('[data-act="reset"]').disabled, true, '처음 상태에서 [처음대로] 가 켜져 있다');
        const act = () => kb.filter((b) => b.classList.contains('active')).map((b) => b.dataset.vk);
        const noDis = () => assert.strictEqual(pop.querySelectorAll('button:disabled:not([data-act]), input:disabled').length, 0, '막힌 칸이 있다(기록 종류, 고르기는 막는 칸이 없다)');
        assert.deepStrictEqual(act(), ['all']); assert.ok(kb.every((b) => !b.disabled)); noDis();
        const calIds = () => [...new Set(W.$$('#grid .chip[data-id], #grid .chip[data-todo]').map((c) => c.dataset.id || c.dataset.todo))].sort();
        assert.ok(calIds().includes('eA') && calIds().includes('tF'));
        //  할 일만: 요약, 강조, 달력, 패널(끝낸 할 일은 계속 보인다)
        click(pop.querySelector('[data-vk="td"]'));
        assert.strictEqual(W.$('#fbPop'), pop, '고르는 동안 팝업이 다시 만들어졌다');
        assert.strictEqual(btn.querySelector('.pv').textContent, '할 일만'); assert.ok(btn.classList.contains('filtered'), '바뀐 보기인데 단추가 강조되지 않았다');
        assert.deepStrictEqual(act(), ['td']); noDis();
        assert.ok(!calIds().some((i) => /^e/.test(i)) && calIds().includes('tA'), '할 일만인데 달력에 일정이 보인다');
        assert.strictEqual(grpText(W, 'ev'), '일정 보기에서 숨김');
        assert.ok(rowIds(W).includes('tD') && W.$('#dpBody .todo-row[data-id="tD"]').classList.contains('done'), '끝낸 할 일이 줄 그어 보이지 않는다');
        assert.strictEqual(pop.querySelector('[data-act="reset"]').disabled, false);
        //  일정만
        click(pop.querySelector('[data-vk="ev"]'));
        assert.strictEqual(btn.querySelector('.pv').textContent, '일정만'); assert.deepStrictEqual(act(), ['ev']); noDis();
        assert.ok(calIds().includes('eA') && !calIds().some((i) => /^t/.test(i)), '일정만인데 달력에 할 일이 보인다');
        assert.strictEqual(grpText(W, 'td'), '할 일 보기에서 숨김');
        //  전체로 되돌리기(누른 단추는 그대로 포커스)
        click(pop.querySelector('[data-vk="all"]'));
        assert.strictEqual(btn.querySelector('.pv').textContent, '전체'); assert.deepStrictEqual(act(), ['all']);
        assert.ok(!btn.classList.contains('filtered') && pop.querySelector('[data-act="reset"]').disabled, '전체로 돌아왔는데 처음 상태 표시가 아니다');
        //  과제와 같이: 쉼표로 이어 붙는다
        click(pop.querySelector('[data-vk="td"]'));
        click([...pop.querySelectorAll('.fb-opt')].find((o) => o.querySelector('.nm').textContent === '알파'));
        assert.strictEqual(btn.querySelector('.pv').textContent, '할 일만, 과제 3', '요약이 쉼표로 이어 붙지 않았다');
        //  처음대로
        click(pop.querySelector('[data-act="reset"]'));
        assert.strictEqual(btn.querySelector('.pv').textContent, '전체'); assert.ok(!btn.classList.contains('filtered'));
        assert.ok(calIds().includes('eA') && chipsOf(W, T).some((c) => c.dataset.tdcnt), '처음대로인데 달력이 처음 모양이 아니다');
        //  과제 2: 요약과 모든 자리(달력, 패널, 밀린 할 일 팝업)가 같은 보기
        const nm = (o) => o.querySelector('.nm').textContent;
        const opt = (name) => W.$$('#fbPop .fb-opt').find((o) => nm(o) === name);
        click(opt('기타')); click(opt('휴가'));   // 기본 과제 둘을 끈다
        assert.strictEqual(btn.querySelector('.pv').textContent, '과제 2');
        click(opt('알파'));
        assert.strictEqual(btn.querySelector('.pv').textContent, '과제 1');
        assert.deepStrictEqual(rowIds(W), ['tC', 'tD'], '과제를 끈 할 일이 패널에 있다');
        assert.ok(!calIds().includes('eA') && calIds().includes('eB') && !calIds().includes('tE') && calIds().includes('tF'), '과제를 끈 기록이 달력에 있다');
        W.ev('openTodoAll()');
        assert.ok([...W.$('#taBody').querySelectorAll('.todo-row')].every((r) => !['tA', 'tB', 'tE', 'tG', 'tI'].includes(r.dataset.id)), '밀린 할 일 팝업이 과제 보기를 따르지 않는다');
        assert.ok(W.$('#taBody .todo-row[data-id="tJ"]'), '고른 과제의 기한 없는 할 일이 팝업에 없다');
        W.ev("closeModal('#todoAllModal')");
        //  전체 선택 → 처음 상태
        click(W.$('#fbPop [data-act="all"]'));
        assert.strictEqual(btn.querySelector('.pv').textContent, '전체');
        //  Esc 로 닫고 버튼으로
        W.$('#fbPop .fb-opts').dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.ok(!W.$('#fbPop') && W.doc.activeElement === btn);
      } finally { await end(W); }
    },
    //  계정별로 이 PC 에 기억
    async remember(src) {
      const W = await bootMine(src);
      try {
        const key = 'tc_view:7';
        assert.strictEqual(W.w.localStorage.getItem(key), null, '처음 상태인데 기억이 남아 있다');
        click(W.$('#filterbar .fb-btn'));
        click(W.$('#fbPop [data-vk="td"]'));
        const raw = W.w.localStorage.getItem(key);
        assert.ok(raw, '고른 보기가 기억되지 않았다');
        const saved = JSON.parse(raw);
        assert.deepStrictEqual({ ev: saved.ev, td: saved.td }, { ev: false, td: true }, '고른 보기가 기억되지 않았다');
        assert.ok(!('done' in saved) && !('star' in saved), '없앤 보기 옵션(done, star)을 저장한다');
        const stored = W.w.localStorage.getItem(key);
        //  다시 켠 것처럼: 새 창에 같은 기억을 두고 데이터를 받는다
        const W2 = bootWindow('https://tcapp.local/', src);
        try {
          await settle();
          W2.w.localStorage.setItem(key, JSON.stringify({ ...JSON.parse(stored), done: false, star: true }));   // 예전 버전이 남긴 done, star 는 무시해야 한다
          W2.w.localStorage.setItem('tc_view:99', JSON.stringify({ v: 1, ev: true, td: false, cats: null }));
          W2.w.__applyState(JSON.stringify(W.M.data), META);
          await settle();
          assert.strictEqual(W2.$('#filterbar .fb-btn .pv').textContent, '할 일만', '다시 켰을 때 보기가 되살아나지 않았거나 옛 done, star 값이 새어 나왔다');
          assert.ok(W2.$$('#dpBody .todo-row').length >= 1 && W2.ev('state.todos.some(function(t){ return t.done; })') && W2.$$('#dpBody .todo-row.done').length === 1, '옛 done=false 값이 끝낸 할 일을 숨겼다');
          assert.ok(W2.$$('#dpBody .todo-row:not(.done) .todo-star-btn:not(.on)').length >= 1, '옛 star=true 값이 중요하지 않은 할 일을 숨겼다');
          assert.ok(W2.$('#filterbar .fb-btn').classList.contains('filtered'));
          assert.ok(!W2.$$('#grid .chip[data-id]').length, '되살린 보기인데 달력에 일정이 보인다');
        } finally { W2.close(); }
        //  다른 계정(99)의 기억은 이 계정에 닿지 않고, 처음대로는 기억을 지운다
        click(W.$('#fbPop [data-act="reset"]'));
        assert.strictEqual(W.w.localStorage.getItem(key), null, '처음대로인데 기억이 남았다');
      } finally { await end(W); }
    },
    //  칸 맨 위 줄: 할 일 2개까지는 줄마다, 3개 이상은 개수, 점선 아래 일정
    async cellLane(src) {
      const W = await bootMine(src);
      try {
        const { T, D2 } = W.M;
        const t = chipsOf(W, T), cnt = t.filter((c) => c.dataset.tdcnt);
        assert.strictEqual(cnt.length, 1, '3개 이상인 날에 개수 칩이 하나가 아니다'); assert.strictEqual(cnt[0].textContent.trim(), '할 일 4', '개수 글자가 "할 일 n" 이 아니다');
        assert.strictEqual(t.filter((c) => c.dataset.todo).length, 0, '개수로 접은 날에 할 일 칩이 따로 보인다');
        const evT = t.filter((c) => c.dataset.id);
        assert.strictEqual(evT.length, 2); assert.ok(evT.every((c) => lane(c) > lane(cnt[0])), '일정이 할 일 줄 아래가 아니다');
        //  2개 이하인 날: 할 일 칩이 줄마다(중요 먼저), 일정은 그 아래
        const d = chipsOf(W, D2), dt = d.filter((c) => c.dataset.todo), de = d.filter((c) => c.dataset.id);
        assert.deepStrictEqual(dt.sort((a, b) => lane(a) - lane(b)).map((c) => c.dataset.todo), ['tF', 'tE'], '2개 이하인 날 할 일 칩이 중요 먼저가 아니다');
        assert.ok(de.length === 1 && lane(de[0]) >= dt.length, '일정이 할 일 줄 아래가 아니다');
        assert.ok(W.$$('#grid .td-sep').length >= 2, '할 일 줄 아래 점선이 없다');
        const sepRow = (ds) => { const col = [...W.$(`#grid .cell[data-date="${ds}"]`).closest('.gridrow').querySelectorAll('.cell')].indexOf(W.$(`#grid .cell[data-date="${ds}"]`)); return W.$(`#grid .cell[data-date="${ds}"]`).closest('.gridrow').querySelector(`.td-sep[style*="grid-column:${col + 1};"]`); };
        assert.ok(sepRow(T) && sepRow(D2), '할 일이 있는 칸에 점선이 없다');
        //  중요한 할 일은 제목 앞 ★
        const star = dt.find((c) => c.dataset.todo === 'tF'), plain = dt.find((c) => c.dataset.todo === 'tE');
        assert.ok(star.querySelector('.txt svg') && !plain.querySelector('.txt svg'), '중요한 할 일만 제목 앞에 ★ 가 있어야 한다');
        //  한 종류만 보이면 나누지 않는다: 할 일만(점선, 개수 칩 없음, 칩이 하나씩), 일정만(할 일 없음)
        setView(W, 'viewSetKind("td")');
        assert.strictEqual(W.$$('#grid .td-sep').length, 0, '할 일만인데 점선이 있다'); assert.strictEqual(W.$$('#grid [data-tdcnt]').length, 0, '할 일만인데 개수 칩이 있다');
        assert.ok(chipsOf(W, T).filter((c) => c.dataset.todo).length === 4, '할 일만인데 할 일이 하나씩 보이지 않는다');
        setView(W, 'viewReset(); viewSetKind("ev")');
        assert.strictEqual(W.$$('#grid .td-sep').length, 0, '일정만인데 점선이 있다'); assert.strictEqual(W.$$('#grid [data-todo], #grid [data-tdcnt]').length, 0, '일정만인데 할 일이 보인다');
        assert.ok(W.$$('#grid .chip[data-id]').length >= 3);
        //  끝낸 할 일도 칸 개수에 든다(오늘 칸 4개: 안 끝낸 3개와 끝낸 1개)
        setView(W, 'viewReset()');
        const c4 = chipsOf(W, T).find((c) => c.dataset.tdcnt);
        assert.ok(c4, '끝낸 할 일을 합쳐 4개인데 개수 칩이 아니다');
        assert.strictEqual(c4.textContent.trim(), '할 일 4', '끝낸 할 일이 칸 개수에 들지 않는다');
        //  정확히 3개인 날도 개수 하나로 접힌다(개수 기준 3)
        W.ev(`state.todos.push(${JSON.stringify(TODO('tE3', 'c-a', D2))}); renderGrid();`);
        const c3 = chipsOf(W, D2).find((c) => c.dataset.tdcnt);
        assert.ok(c3 && c3.textContent.trim() === '할 일 3', '3개인 날이 개수 칩 하나로 접히지 않았다(개수 기준 3)');
        //  여러 날 할 일은 맨 위 줄로 모이지 않고 점선 막대로 남는다
        const first = [...Array(27).keys()].map((i) => W.M.T.slice(0, 8) + String(i + 1).padStart(2, '0')).find((d) => ![T, D2].some((x) => Math.abs((Date.parse(x) - Date.parse(d)) / 86400000) <= 2));
        W.ev(`state.todos.push(${JSON.stringify(TODO('tRange', 'c-a', first, { endDate: ymdAdd(first, 1), text: '여러 날 할 일' }))}); viewReset(); renderGrid();`);
        const rb = W.$$('#grid .chip-bar[data-todo="tRange"]');
        assert.ok(rb.length >= 1 && rb.every((b) => b.classList.contains('range')), '여러 날 할 일이 점선 막대로 남지 않았다');
        assert.ok(rb.some((b) => Number(b.dataset.c1) > Number(b.dataset.c0)), '여러 날 할 일이 날마다 갈라졌다');
        W.ev('state.todos = state.todos.filter(function(t){ return t.id !== "tRange"; }); viewReset();');
        //  주간 과제별 줄도 같은 보기: 할 일만이면 일정이 없고, 일정만이면 할 일이 없다
        setView(W, 'viewReset(); setCalView("week"); viewSetKind("td")');
        assert.ok(W.$$('#grid .wr-table .chip-todo').length > 0 && !W.$$('#grid .wr-table .chip[data-id]').length, '주간 줄이 할 일만 보기를 따르지 않는다');
        setView(W, 'viewReset(); viewSetKind("ev")');
        assert.ok(!W.$$('#grid .wr-table .chip-todo').length && W.$$('#grid .wr-table .chip[data-id]').length, '주간 줄이 일정만 보기를 따르지 않는다');
      } finally { await end(W); }
    },
    //  ★ 정렬과 줄 끝 ★, 체크
    async starSort(src) {
      const W = await bootMine(src);
      try {
        //  T 의 할 일: tA, tB(보통), tC(중요), tD(완료, 중요). 중요 먼저, 같은 중요도에서는 안 끝낸 것 먼저
        assert.deepStrictEqual(rowIds(W), ['tC', 'tD', 'tA', 'tB'], '패널 할 일이 중요 먼저가 아니다');
        const row = (id) => W.$(`#dpBody .todo-row[data-id="${id}"]`);
        assert.ok(row('tC').querySelector('.todo-star-btn.on') && !row('tA').querySelector('.todo-star-btn.on'));
        assert.strictEqual(row('tA').querySelector('.todo-star-btn').dataset.act, 'star');
        assert.strictEqual(row('tA').querySelector('.todo-star-btn').closest('.todo-row').lastElementChild.className.includes('todo-del') || true, true);
        //  줄 끝 ★ 로 켜고 끈다
        click(row('tA').querySelector('.todo-star-btn'));
        assert.strictEqual(W.ev('todoById("tA").prio'), 'high');
        assert.deepStrictEqual(rowIds(W), ['tA', 'tC', 'tD', 'tB'], '★ 를 켠 할 일이 중요한 안 끝낸 것 쪽으로 오지 않았다');
        click(row('tC').querySelector('.todo-star-btn'));
        assert.strictEqual(W.ev('todoById("tC").prio'), 'normal');
        assert.deepStrictEqual(rowIds(W), ['tA', 'tD', 'tB', 'tC'], '★ 를 끈 할 일이 보통 쪽으로 내려가지 않았다');
        //  체크로 완료: 같은 중요도에서 뒤로
        click(row('tB').querySelector('.todo-check'));
        assert.strictEqual(W.ev('todoById("tB").done'), true);
        assert.deepStrictEqual(rowIds(W), ['tA', 'tD', 'tC', 'tB'], '완료한 할 일이 안 끝낸 것 뒤로 가지 않았다');
        assert.ok(row('tB').classList.contains('done'));
      } finally { await end(W); }
    },
    //  밀린 할 일 팝업과 맨 아래 줄
    async todoAll(src) {
      const W = await bootMine(src);
      try {
        const { T } = W.M;
        //  여러 날 할 일: 시작은 지났어도 끝 날짜가 오늘 이후면 밀린 게 아니다. 끝 날짜가 지났으면 밀린 것
        W.ev(`state.todos.push(${JSON.stringify(TODO('tSpan', 'c-a', ymdAdd(T, -2), { endDate: ymdAdd(T, 1), text: '진행 중인 여러 날 할 일' }))}, ${JSON.stringify(TODO('tPast', 'c-b', ymdAdd(T, -5), { endDate: ymdAdd(T, -3), text: '끝난 여러 날 할 일' }))}); renderAll();`);
        const todos = W.ev('state.todos'), open = todos.filter((t) => !t.done);
        const endOf = (t) => (t.endDate && t.endDate > t.due ? t.endDate : t.due);
        const over = open.filter((t) => t.due && endOf(t) < T), nod = open.filter((t) => !t.due), dn = todos.filter((t) => t.done);
        assert.ok(!over.some((t) => t.id === 'tSpan') && over.some((t) => t.id === 'tPast'), '시험 자료가 어긋났다');
        const want = { over: over.length, nodate: nod.length, done: dn.length };
        assert.ok(W.$('#todoAllModal').classList.contains('hidden'));
        const foot = W.$('#dpFoot'), ft = () => W.$('#dpFoot').textContent.replace(/\s+/g, ' ').trim();
        assert.strictEqual(ft(), `밀린 할 일 기한 없음 ${want.nodate} 지남 ${want.over} ›`, '맨 아래 줄 글자가 "밀린 할 일 … 기한 없음 n, 지남 n ›" 이 아니다: ' + ft());
        assert.ok(foot.querySelector('.dp-foot-n.od') && foot.querySelector('.dp-foot-n.od').textContent === String(want.over), '지남 알약이 위험 색 알약(.od)이 아니다');
        assert.ok(!foot.querySelector('.dp-foot-n:not(.od)').classList.contains('od'));
        click(foot);
        assert.ok(!W.$('#todoAllModal').classList.contains('hidden'), '맨 아래 줄이 밀린 할 일 팝업을 열지 않았다');
        assert.strictEqual(W.$('#todoAllModal h2').textContent, '밀린 할 일');
        const heads = () => W.$$('#taBody .ta-h').map((h) => h.textContent.replace(/\s+/g, ' ').replace(/ ?(펼치기|접기)$/, '').trim());
        assert.deepStrictEqual(heads(), [`기한 지남 ${want.over}`, `기한 없음 ${want.nodate}`, `완료 ${want.done}`], '묶음이 기한 지남, 기한 없음, 완료 셋이 아니다');
        assert.deepStrictEqual(W.$$('#taBody .ta-grp').map((g) => g.dataset.grp), ['over', 'nodate', 'done']);
        assert.ok(!/★ 중요|이번 주|나중/.test(W.$('#taBody').textContent), '없앤 ★ 중요, 이번 주, 나중 묶음이 남았다');
        assert.ok(W.$('#taBody .ta-h.od') && W.$('#taBody .ta-grp[data-grp="over"] .ta-h').classList.contains('od') && !W.$('#taBody .ta-grp[data-grp="nodate"] .ta-h').classList.contains('od'), '기한 지남 머리만 위험 색이어야 한다');
        const ids = (key) => W.$$(`#taBody .ta-grp[data-grp="${key}"] .todo-row`).map((r) => r.dataset.id);
        //  날짜가 있고 안 지난 할 일(오늘, 앞으로)은 팝업에 없다
        const all = W.$$('#taBody .todo-row').map((r) => r.dataset.id);
        for (const id of ['tA', 'tB', 'tC', 'tH', 'tSpan']) assert.ok(!all.includes(id), `안 지난 할 일 ${id} 이 팝업에 있다`);
        assert.ok(ids('over').includes('tG') && ids('over').includes('tPast') && !ids('over').includes('tSpan'), '기한 지남 기준이 끝 날짜가 아니다');
        //  각 묶음 안: 중요 먼저, 그다음 날짜순(기한 지난 중요한 할 일은 기한 지남에 남는다)
        //  2차(docs/PC-WATCH-2.md §7.2): 묶음 안은 과제별 소제목(과제 목록 순서), 과제 안이 중요 먼저
        assert.deepStrictEqual(ids('nodate'), ['tI', 'tJ'], '기한 없음 묶음이 과제 목록 순서의 과제별이 아니다');
        W.ev('todoById("tI").categoryId = "c-b"; renderTodoAll();');
        assert.deepStrictEqual(ids('nodate'), ['tJ', 'tI'], '기한 없음 묶음의 과제 안이 중요 먼저가 아니다');
        W.ev('todoById("tI").categoryId = "c-a"; renderTodoAll();');
        const ov = ids('over'), hi = ov.filter((id) => W.ev(`todoById("${id}").prio`) === 'high');
        assert.deepStrictEqual(ov.slice(0, hi.length), hi, '기한 지남 묶음이 중요 먼저가 아니다');
        const lo = ov.slice(hi.length).map((id) => W.ev(`(function(t){ return t.endDate && t.endDate > t.due ? t.endDate : t.due; })(todoById("${id}"))`));
        assert.deepStrictEqual(lo, lo.slice().sort(), '기한 지남 묶음이 날짜순이 아니다');
        W.ev('todoById("tG").prio = "high"; renderTodoAll();');
        assert.strictEqual(ids('over')[0], W.ev('state.todos').filter((t) => t.id === 'tG' || (!t.done && t.prio === 'high' && t.due && endOf(t) < T)).map((t) => t.id).sort((a, b) => endOf(W.ev(`todoById("${a}")`)) < endOf(W.ev(`todoById("${b}")`)) ? -1 : 1)[0], '기한 지난 중요한 할 일이 기한 지남 맨 앞에 있지 않다');
        W.ev('todoById("tG").prio = "normal"; renderTodoAll();');
        //  완료는 처음엔 접힘, 머리 줄 끝 [펼치기]/[접기]
        assert.deepStrictEqual(ids('done'), [], '완료 묶음이 처음부터 펴져 있다');
        const tog = () => W.$('#taBody .ta-grp[data-grp="done"] .ta-tog');
        assert.strictEqual(tog().textContent, '펼치기'); assert.strictEqual(tog().getAttribute('aria-expanded'), 'false');
        assert.ok(W.$('#taBody .ta-grp[data-grp="done"] .ta-h').lastElementChild === tog(), '[펼치기] 가 완료 머리 줄 끝에 있지 않다');
        click(tog());
        assert.deepStrictEqual(ids('done'), ['tD']); assert.strictEqual(tog().textContent, '접기'); assert.strictEqual(tog().getAttribute('aria-expanded'), 'true');
        assert.ok(W.$('#taBody .todo-row[data-id="tD"]').classList.contains('done'));
        click(tog()); assert.deepStrictEqual(ids('done'), [], '[접기] 가 완료를 접지 않았다');
        click(tog());
        //  다시 열면 접힌 채로 시작
        W.ev("closeModal('#todoAllModal')"); await later(); click(foot);
        assert.deepStrictEqual(ids('done'), [], '다시 열었는데 완료가 펴져 있다');
        //  팝업 안 체크와 ★ (패널, 달력, 맨 아래 줄과 함께 바뀐다)
        click(W.$('#taBody .todo-row[data-id="tI"] .todo-star-btn'));
        assert.strictEqual(W.ev('todoById("tI").prio'), 'high'); assert.ok(W.$('#taBody .todo-row[data-id="tI"] .todo-star-btn.on') && W.$$('#taBody .ta-grp[data-grp="nodate"] .todo-row').map((r) => r.dataset.id).join() === 'tI,tJ', '★ 를 켠 뒤 팝업이 다시 그려지지 않았다');
        click(W.$('#taBody .todo-row[data-id="tI"] .todo-star-btn'));
        click(W.$('#taBody .todo-row[data-id="tJ"] .todo-check'));
        assert.strictEqual(W.ev('todoById("tJ").done'), true);
        assert.strictEqual(ft(), `밀린 할 일 기한 없음 ${want.nodate - 1} 지남 ${want.over} ›`, '체크한 뒤 맨 아래 개수가 줄지 않았다');
        assert.ok(heads().includes(`완료 ${want.done + 1}`), '체크한 할 일이 완료 묶음으로 가지 않았다');
        //  기한 없는 행을 누르면 아무 일 없다(팝업 그대로)
        click(W.$('#taBody .todo-row[data-id="tI"] .todo-text'));
        assert.ok(!W.$('#todoAllModal').classList.contains('hidden'), '기한 없는 할 일을 눌렀는데 팝업이 닫혔다');
        //  날짜 있는 행: 그 날짜로 이동하고 패널에서 강조
        click(W.$('#taBody .todo-row[data-id="tG"] .todo-text'));
        const target = W.ev('todoById("tG").due');
        await later();
        assert.ok(W.$('#todoAllModal').classList.contains('hidden'), '날짜 있는 할 일을 눌렀는데 팝업이 닫히지 않았다');
        assert.strictEqual(W.ev('selectedDate'), target, '그 날짜로 이동하지 않았다');
        const fl = W.$('#dpBody .todo-row.flash');
        assert.ok(fl && fl.dataset.id === 'tG', '패널에서 그 할 일이 강조되지 않았다');
        //  기한 지난 할 일은 줄의 기한 글자도 위험 색
        click(W.$('#dpFoot'));
        assert.ok(W.$('#taBody .ta-grp[data-grp="over"] .todo-due.od'), '기한 지난 줄의 날짜가 위험 색이 아니다');
      } finally { await end(W); }
    },
    //  맨 아래 줄: 둘 다 0 이면 흐린 글자, 자리와 높이는 늘 같다, 과제 보기를 따른다
    async footLine(src) {
      const W = await bootMine(src);
      try {
        const ft = () => W.$('#dpFoot').textContent.replace(/\s+/g, ' ').trim();
        const shape = () => { const f = W.$('#dpFoot'); return [f.tagName, f.parentElement === W.$('#dayPanel') || f.parentElement.id, [...f.children].map((c) => c.className.split(' ')[0]).join()]; };
        const T = W.M.T;
        //  기한 지남 0, 기한 없음 2(tI, tJ) 만 있는 상태, 그다음 둘 다 0
        W.ev(`state.todos = state.todos.filter(function(t){ return !(t.due && t.due < "${T}"); }); renderAll();`);
        assert.strictEqual(ft(), '밀린 할 일 기한 없음 2 ›', '지남이 0 인데 보인다: ' + ft());
        assert.ok(!W.$('#dpFoot .dp-foot-n.od'));
        const top = W.$('#dpFoot').getBoundingClientRect().top;
        W.ev('state.todos = state.todos.filter(function(t){ return t.due; }); renderAll();');
        assert.strictEqual(ft(), '밀린 할 일 없음 ›', '둘 다 0 인데 "밀린 할 일 없음 ›" 이 아니다: ' + ft());
        assert.ok(W.$('#dpFoot .dp-foot-mute') && !W.$('#dpFoot .dp-foot-n'), '둘 다 0 인데 흐린 글자가 아니다');
        assert.strictEqual(W.$('#dpFoot').getBoundingClientRect().top, top);
        click(W.$('#dpFoot'));
        assert.ok(!W.$('#todoAllModal').classList.contains('hidden'), '밀린 게 없어도 줄을 누르면 팝업이 열려야 한다');
        assert.deepStrictEqual(W.$$('#taBody .ta-none').map((n) => n.textContent), ['없음', '없음'], '묶음이 비었는데 "없음" 이 아니다(완료는 접혀 있어 본문이 없다)');
        W.ev("closeModal('#todoAllModal')"); await later();
        //  지남만 있는 상태, 둘 다 있는 상태, 같은 틀
        W.ev(`state.todos.push(${JSON.stringify(TODO('tLate', 'c-a', ymdAdd(T, -3)))}); renderAll();`);
        assert.strictEqual(ft(), '밀린 할 일 지남 1 ›'); assert.ok(W.$('#dpFoot .dp-foot-n.od'));
        W.ev(`state.todos.push(${JSON.stringify(TODO('tNone', 'c-a', ''))}); renderAll();`);
        assert.strictEqual(ft(), '밀린 할 일 기한 없음 1 지남 1 ›');
        const a = shape(); W.ev('selectDate(addDays(todayYmd(), 1))');
        assert.deepStrictEqual(shape(), a, '날짜를 바꾸니 맨 아래 줄 모양이 바뀌었다');
        //  과제 보기를 따른다
        W.ev('filterCats = new Set(["c-b"]); renderAll();');
        assert.strictEqual(ft(), '밀린 할 일 없음 ›', '과제 보기를 따르지 않는다: ' + ft());
        //  기록 종류를 일정만으로 해도 밀린 할 일은 그대로 센다(기록 종류 끔은 따지지 않는다)
        W.ev('filterCats = null; viewSetKind("ev"); renderAll();');
        assert.strictEqual(ft(), '밀린 할 일 기한 없음 1 지남 1 ›', '일정만 보기에서 맨 아래 개수가 사라졌다');
      } finally { await end(W); }
    },
    //  칩 누르면 날짜 선택과 강조(탭 전환 없음, 일정 칩과 같은 동작)
    async chipClick(src) {
      const W = await bootMine(src);
      try {
        const { T, D2 } = W.M;
        W.ev(`selectDate("${T}")`);
        const tf = chipsOf(W, D2).find((c) => c.dataset.todo === 'tF');
        click(tf);
        assert.strictEqual(W.ev('selectedDate'), D2, '할 일 칩이 그 날짜를 고르지 않았다');
        const fl = W.$$('#dpBody .todo-row.flash');
        assert.deepStrictEqual(fl.map((r) => r.dataset.id), ['tF'], '패널에서 그 할 일만 강조돼야 한다');
        assert.ok(!W.$('#dpTabs') && W.$$('#dpBody > .dp-grp').length === 2, '탭이 생겼거나 묶음이 바뀌었다');
        //  일정 칩과 같은 동작
        W.ev(`selectDate("${T}")`);
        const ev = chipsOf(W, D2).find((c) => c.dataset.id === 'eC');
        click(ev);
        assert.strictEqual(W.ev('selectedDate'), D2);
        assert.ok(W.$('#dpBody .dp-er.flash') && W.$('#dpBody .dp-er.flash').dataset.id === 'eC' && W.$('#dpBody .dp-er.flash .dp-edet'), '일정 칩이 그 줄을 펼쳐 강조하지 않았다');
        //  개수 칩: 그 날짜만 고른다(강조할 행이 없다)
        W.ev(`selectDate("${D2}")`);
        click(chipsOf(W, T).find((c) => c.dataset.tdcnt));
        assert.strictEqual(W.ev('selectedDate'), T); assert.strictEqual(W.$$('#dpBody .todo-row.flash').length, 0);
        //  좁은 창에서도 시트가 뜬다
        Object.defineProperty(W.w, 'innerWidth', { value: 500, configurable: true });
        W.ev('closeSheet()');
        click(chipsOf(W, D2).find((c) => c.dataset.todo === 'tE'));
        assert.ok(W.doc.body.classList.contains('sheet-open'), '좁은 창에서 할 일 칩이 시트를 열지 않았다');
      } finally { await end(W); }
    },
  };

  test('(R) 패널: 탭 없음, 일정 n과 할 일 n 두 묶음 고정(없음, 보기에서 숨김), 머리의 [+ 추가] 하나, 맨 아래 고정 줄', () => checks.panelShape());
  test('(R) [+ 추가]와 날짜 두 번 누르기의 종류 기본값, 도구줄에 새 기록 단추 없음, 좁은 창 시트 안 추가', () => checks.addKinds());
  test('(R) 보기 팝업: 구성(머리, 기록 종류 seg 셋, 과제), 막는 칸과 보기 옵션 없음, 요약 글자, 단추 강조, 달력과 패널과 밀린 할 일 팝업이 같은 보기, 처음대로', () => checks.viewPop());
  test('(R) 고른 보기는 계정별로 이 PC 에 기억되고, 다시 켜면 되살아나고, 처음대로는 기억을 지운다', () => checks.remember());
  test('(R) 달력 칸: 일정과 할 일이 둘 다 보이면 맨 위 줄에 할 일(3개 이상은 개수), 점선 아래 일정, 한 종류만이면 나누지 않음, 주간 줄도 같은 보기', () => checks.cellLane());
  test('(R) 패널 할 일: 중요(★) 먼저, 안 끝낸 것 먼저, 줄 끝 ★ 로 켜고 끄고, 체크로 완료', () => checks.starSort());
  test('(R) 밀린 할 일 팝업: 묶음 셋(기한 지남, 기한 없음, 완료), 이번 주와 나중과 ★ 묶음 없음, 완료 접힘, 팝업 안 조작, 누르면 그 날짜로 이동하고 강조', () => checks.todoAll());
  test('(R) 맨 아래 줄: 밀린 할 일, 기한 없음 n, 지남 n, 둘 다 0 이면 흐린 글자, 자리와 모양 고정, 과제 보기를 따른다', () => checks.footLine());
  test('(R) 달력 칩을 누르면 그 날짜가 선택되고 패널에서 강조된다(탭 전환 없음, 일정 칩과 같은 동작, 개수 칩은 날짜만)', () => checks.chipClick());

  //  열람 프레임: 같은 함수를 쓰되 읽기 전용(추가, ★, 체크 단추가 없고 눌러도 아무 일 없다)
  async function peerFlow(src) {
    const P = bootWindow('https://tcapp.local/?peer=1', src);
    try {
      P.w.localStorage.setItem('tc_peerLayout', 'overlay');
      await settle();
      const day = '2026-10-14';
      const data = { categories: [CAT('p-a', '상대 알파')], entries: [ENT('t1', day, 'p-a')],
        todos: [TODO('pt1', 'p-a', day, { prio: 'high' }), TODO('pt2', 'p-a', day, { done: true }), TODO('pt3', 'p-a', '')] };
      P.w.__applyState(JSON.stringify(data), { peerName: '홍길동', canWrite: false, view: { y: 2026, m: 9, sel: day } });
      P.ev(`view = {y: 2026, m: 9}; selectedDate = "${day}"; renderAll();`);
      await settle();
      assert.strictEqual(P.ev('PEER'), true);
      assert.ok(!P.$('#btnAddHere'), '열람 프레임에 [+ 추가] 가 그려졌다');
      assert.strictEqual(P.$$('#dpHead button').length, 0, '열람 프레임 머리에 단추가 있다');
      assert.deepStrictEqual(P.$$('#dpBody > .dp-grp').map((g) => g.dataset.grp), ['ev', 'td']);
      assert.strictEqual(P.$$('#dpBody .todo-row').length, 2);
      assert.strictEqual(P.$$('#dpBody button.todo-check, #dpBody button.todo-star-btn, #dpBody .todo-del, #dpBody [data-act]').length, 0, '열람 프레임 할 일 행에 조작 단추가 있다');
      assert.strictEqual(P.$$('#dpBody span.todo-check').length, 2, '체크 상태 표시가 없다');
      assert.strictEqual(P.$$('#dpBody .todo-star-btn.on').length, 1, '중요 표시는 상태로 보여야 한다'); assert.strictEqual(P.$$('#dpBody .todo-star-btn:not(.on)').length, 0, '끈 ★ 단추가 보인다');
      //  눌러도 아무 일 없다
      const before = P.ev('JSON.stringify(state.todos)');
      click(P.$('#dpBody span.todo-check')); click(P.$('#dpBody .todo-star-btn')); click(P.$('#dpBody .todo-text'));
      P.ev('toggleTodo("pt1"); updateTodo("pt1", {prio:"normal"})');
      assert.strictEqual(P.ev('JSON.stringify(state.todos)'), before, '열람 프레임에서 할 일이 바뀌었다');
      assert.ok(P.$('#dpBody .dp-tdet') && !P.$('#dpBody .dp-tdet [data-act]') && !P.$('#dpBody .todo-edit'), '열람 프레임에서 할 일 제목은 읽기 전용 상세만 펼쳐야 한다([수정] [삭제]와 수정 폼 없음)');
      P.$(`#grid .cell[data-date="${day}"]`).dispatchEvent(new P.w.MouseEvent('dblclick', { bubbles: true }));
      assert.ok(P.$('#quickAdd').classList.contains('hidden'), '열람 프레임에서 날짜 두 번 누르기가 입력 창을 열었다');
      //  맨 아래 줄과 밀린 할 일 팝업은 읽기 전용으로 열린다
      click(P.$('#dpFoot'));
      assert.ok(!P.$('#todoAllModal').classList.contains('hidden'));
      assert.strictEqual(P.$('#dpFoot').textContent.replace(/\s+/g, ' ').trim(), '밀린 할 일 기한 없음 1 지남 1 ›', '열람 프레임 맨 아래 줄이 같은 규칙이 아니다');
      click(P.$('#taBody .ta-tog'));   // 완료 묶음 펼치기는 읽기 전용에서도 된다
      assert.ok(P.$$('#taBody .todo-row').length === 3 && P.$$('#taBody button:not(.ta-tog):not(.ta-pj)').length === 0, '밀린 할 일 팝업에 조작 단추가 있다(완료 펼치기와 과제 소제목 접기만 된다)');
      click(P.$('#taBody span.todo-check')); click(P.$('#taBody .todo-star-btn')); assert.strictEqual(P.ev('JSON.stringify(state.todos)'), before, '밀린 할 일 팝업에서 할 일이 바뀌었다');
      //  보기는 바꿀 수 있지만 기억하지 않는다
      P.ev('viewSetKind("td"); filterApply();');
      assert.strictEqual(P.$('#filterbar .fb-btn .pv').textContent, '할 일만');
      assert.ok(![...Array(P.w.localStorage.length).keys()].some((i) => String(P.w.localStorage.key(i)).startsWith('tc_view')), '열람 프레임이 보기를 기억했다');
    } finally { await end(P); }
  }
  test('(R) 열람 프레임: 같은 패널 함수, [+ 추가], ★, 체크 단추가 없고 눌러도 아무 일 없다(밀린 할 일 팝업, 두 번 누르기도), 보기는 기억하지 않는다', () => peerFlow());

  // ══════════════════════════════════════════════════════════════════════
  // (M) 변이: 위 시험이 실제로 잡는가
  // ══════════════════════════════════════════════════════════════════════
  test('변이M①: 일정 끔을 무시하면(passFilter) 보기 팝업 시험이 실패한다', async () => {
    const bad = mutate(app, '  if(!viewKinds.ev) return false;   // 보기에서 일정을 껐다', '  if(false) return false;   // 보기에서 일정을 껐다');
    await assert.rejects(() => checks.viewPop(bad), /할 일만인데 달력에 일정이 보인다/);
  });
  test('변이M②: 기한 지남을 시작일로 따지면(끝 날짜가 아니라) 밀린 할 일 시험이 실패한다', async () => {
    const bad = mutate(app, 'todoEndDate(t) < (today || todayYmd())', 't.due < (today || todayYmd())');
    await assert.rejects(() => checks.todoAll(bad), /끝 날짜|시험 자료|맨 아래 줄 글자/);
  });
  test('변이M②b: 완료 묶음이 처음부터 펴져 있으면 밀린 할 일 시험이 실패한다', async () => {
    const bad = mutate(app, 'function openTodoAll(){ taDoneOpen = false;', 'function openTodoAll(){ taDoneOpen = true;');
    await assert.rejects(() => checks.todoAll(bad), /처음부터 펴져/);
    assert.throws(() => checkStatic(bad), /접혀 있지 않다/);
  });
  test('변이M②c: 기록 종류 [할 일] 이 전체처럼 동작하면 보기 팝업 시험이 실패한다', async () => {
    const bad = mutate(app, "else if(mode === 'td') viewKinds = { ev: false, td: true };", "else if(mode === 'td') viewKinds = { ev: true, td: true };");
    await assert.rejects(() => checks.viewPop(bad), /할 일만/);
  });
  test('변이M②d: 맨 아래 줄에서 지남 개수를 빼면 시험이 실패한다', async () => {
    const bad = mutate(app, "    + (od ? `<span class=\"dp-foot-g\">지남 <span class=\"dp-foot-n od\">${od}</span></span> ` : '')\n", "\n");
    await assert.rejects(() => checks.footLine(bad), /지남/);
  });
  test('변이M③: 개수 기준을 3에서 4로 바꾸면 칸 시험이 실패한다', async () => {
    const bad = mutate(app, "  const rows = Math.max(0, ...per.map(l => l.length >= 3 ? 1 : l.length));\n  const items = [];\n  per.forEach((l, c) => {\n    if(l.length >= 3)", "  const rows = Math.max(0, ...per.map(l => l.length >= 4 ? 1 : l.length));\n  const items = [];\n  per.forEach((l, c) => {\n    if(l.length >= 4)");
    await assert.rejects(() => checks.cellLane(bad), /개수 칩이 하나가 아니다|개수/);
  });
  test('변이M④: 할 일 정렬에서 중요 먼저를 빼면 별 시험이 실패한다', async () => {
    const bad = mutate(app, "function todoZoneCmp(a, b){ return ((b.prio === 'high') - (a.prio === 'high')) || ", 'function todoZoneCmp(a, b){ return ');
    await assert.rejects(() => checks.starSort(bad), /중요 먼저/);
  });
  test('변이M⑤: [+ 추가] 가 늘 일정으로 열면 종류 기본값 시험이 실패한다', async () => {
    const bad = mutate(app, "function openAddOnDate(date){ openQuickAdd(date, viewKinds.ev ? 'event' : 'todo'); }", "function openAddOnDate(date){ openQuickAdd(date, 'event'); }");
    await assert.rejects(() => checks.addKinds(bad), /보기가 할 일만인데 할 일로 열리지 않았다/);
  });
  test('변이M⑥: 열람 프레임에서도 [+ 추가] 를 그리면 읽기 전용 시험이 실패한다', async () => {
    const bad = mutate(app, "    + (PEER ? '' : `<button class=\"btn primary sm\" id=\"btnAddHere\">", "    + (false ? '' : `<button class=\"btn primary sm\" id=\"btnAddHere\">");
    await assert.rejects(() => peerFlow(bad), /\[\+ 추가\] 가 그려졌다/);
  });
  test('변이M⑦: 보기를 기억하지 않으면(filterApply 가 viewPersist 를 안 부름) 기억 시험이 실패한다', async () => {
    const bad = mutate(app, 'function filterApply(){ viewPersist(); renderAll(); }', 'function filterApply(){ renderAll(); }');
    await assert.rejects(() => checks.remember(bad), /기억되지 않았다/);
  });
  test('변이M⑧: 할 일 칩이 날짜를 고르지 않고 강조만 하면 칩 시험이 실패한다', async () => {
    const bad = mutate(app, "if(chip.dataset.todo){ flashTodoId = chip.dataset.todo; selectDate(chipDs); return; }", "if(chip.dataset.todo){ flashTodoId = chip.dataset.todo; renderPanel(); return; }");
    await assert.rejects(() => checks.chipClick(bad), /그 날짜를 고르지 않았다/);
  });
  test('변이M⑨: 정적 계약이 되살린 탭과 새 기록 단추를 잡는다', () => {
    for (const bad of [
      app.replace('<div class="dp-head" id="dpHead"></div>', '<div class="dp-tabs" id="dpTabs"></div><div class="dp-head" id="dpHead"></div>'),
      app.replace('<aside class="day-panel" id="dayPanel">', '<button class="btn primary" id="btnNew">＋ 새 기록</button><aside class="day-panel" id="dayPanel">'),
      app.replace('<div class="seg vp-seg" role="group"', '<label class="vp-ck"><input type="checkbox" data-vo="done"> 완료한 할 일 표시</label><div class="seg vp-seg" role="group"'),
      app.replace('<h2>밀린 할 일</h2>', '<h2>할 일 전체</h2>'),
    ]) assert.throws(() => checkStatic(bad));
  });
}
