// 관심 과제 2차 수정(docs/PC-WATCH-2.md §7, 2026-11-05 사용자) 계약. 시안 dist/proto/day-panel-v3.html, dist/proto/pc-watch-v12.html.
//
// 이 파일이 지키는 것(§7.4):
//   (S) 정적: 패널 안 할 일 수정 폼(todoEditHtml, editingTodoId)과 그 길이 없다. 일정은 카드(cardHtml), 할 일은 들여쓴 상세.
//       (2026-11-06 docs/DAY-PANEL-CARDS.md: 7.1 의 한 줄 일정과 줄 펼침 상세는 카드로 되돌렸다. 카드 자체의 계약은 tests/day-panel-fold.test.mjs)
//       열람 창(PEER)은 상세의 [수정] [삭제]가 없다. 상태 미지정 글자(과제 추가 창과 관리 창 공통), 정렬 머리 공용 함수(세 상태, aria-sort).
//       조직도 함수는 P 를 생략하면 사람 고르기(__pk) 그대로(한 명 고르기 불변). 새 글에 금지 기호 없음, 새 CSS 는 토큰만.
//   (R) jsdom:
//       7.1 일정은 카드(꼬리표, 시각 범위와 장소, 기간 n일째 / n일, 반복, 메모, [수정] [삭제]), 누르면 펼치는 갈래는 없다.
//           할 일 제목을 누르면 들여쓴 상세(기한, 과제, 설명). 펼침은 할 일끼리 하나.
//           할 일 [수정] = [+ 추가] 창(openQuickAdd)의 할 일 수정: 제목 "할 일 수정", 종류 단추 숨김, 칸 채움, 저장, 취소, 삭제(실행 취소), 여러 날 할 일의 그날 설명.
//       7.2 밀린 할 일 팝업의 과제별 소제목(과제 목록 순서, 과제 없음은 끝, 개수, 기한 지남은 가장 오래된 기한), 소제목 접기(기억 안 함), 줄에 과제 색점 없음.
//   (M) 변이: 카드에서 기간 줄을 빼거나, 할 일 [수정]이 창을 열지 않거나, 소제목을 빼면 위 시험이 잡는다.
// ★ 회사 사이트에는 아무것도 보내지 않는다(호스트 postMessage 는 버린다).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
const css = app.slice(0, app.indexOf('</style>'));
const ymdAdd = (ds, n) => { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}

/* ══ (S) 정적 ═══════════════════════════════════════════════════════════ */
test('(S) 병합(SCROLL-STABILITY 와 관심 과제 탭): 왼쪽 목록은 겉틀을 두고 안만 바꾸며(pcSideInner, 서랍 × 포함), 탭을 바꿀 때만 목록을 맨 위로', () => {
  const r = extractFunction(app, 'pcRender');
  assert.ok(r.includes("sd.innerHTML = pcSideInner(sd.classList.contains('in-drawer'))"), '다시 그릴 때 .pc-side 안만 바꾸지 않거나 서랍 여부를 넘기지 않는다');
  assert.ok(/function pcSideInner\(inDrawer\)/.test(app) && extractFunction(app, 'pcSideInner').includes("(inDrawer ? popXHtml() : '')"), '서랍 머리의 × 가 안쪽 함수에 없다');
  assert.ok(extractFunction(app, 'pcSideInner').includes('pcStab-'), '안쪽 함수에 관심 과제 탭이 없다');
  const t = extractFunction(app, 'pcSideTabSet');
  assert.ok(/if\(changed\) document\.querySelectorAll\('#pcView \.pc-side'\)\.forEach\(sd => \{ sd\.scrollTop = 0; \}\)/.test(t), '탭을 바꿀 때 목록을 맨 위로 올리지 않는다(앞 목록의 스크롤 자리가 남는다)');
});
test('(S) 관심 과제 전용 칸(.ca-wo)은 과제 추가 창에서 숨는다: .check 의 display:flex !important 를 이기도록 숨김도 !important(jsdom 은 이 겨룸을 못 본다, 2026-11-05 사용자)', () => {
  assert.ok(/#catAddModal:not\(\.ca-watch\) \.ca-wo\{display:none !important\}/.test(css), '과제 추가 창에 일정 없는 과제 숨김이 보인다');
  assert.ok(/\n\.check\{display:flex !important/.test(css), '.check 규칙이 바뀌었다(이 시험의 전제를 다시 볼 것)');
});
test('(S) 7.1: 펼친 할 일 줄만 옅은 바탕이고 상세는 바탕 없이 왼쪽 가는 선으로 들여쓴다(상세까지 칠하면 상자처럼 보인다, 2026-11-05 실제 위젯 점검)', () => {
  const hi = css.match(/([^}]*)\{background:var\(--accent-soft\)\}[^\n]*펼친 할 일 줄만/);
  assert.ok(hi && hi[1].includes('.todo-row.open') && !hi[1].includes('dp-det'), '펼친 바탕이 줄이 아닌 묶음(상세 포함)에 칠해진다');
  const det = css.match(/\n\.dp-det\{([^}]*)\}/);
  assert.ok(det && /border-left:1px solid var\(--line\)/.test(det[1]) && !/background/.test(det[1]), '상세가 왼쪽 선 들여쓰기가 아니거나 바탕을 칠한다');
});
test('(S) 7.1: 패널 안 할 일 수정 폼과 그 상태(todoEditHtml, editingTodoId, te-, canceledit)가 없고, 일정은 카드(11/6 되돌림, 한 줄 줄과 줄 펼침 없음)', () => {
  for (const gone of ['todoEditHtml', 'editingTodoId', 'class="todo-edit"', '.todo-edit', 'te-text', 'te-daynote', "'canceledit'", 'todo-memo', 'todo-daymemo']) assert.ok(!app.includes(gone), `걷어야 할 패널 수정 폼 흔적 ${gone} 이 남았다`);
  assert.ok(app.includes('function cardHtml(') && !app.includes('function dpEvRowHtml(') && !app.includes('function dpEvDetHtml('), '일정이 카드가 아니거나 한 줄 줄과 줄 펼침 상세가 남았다(docs/DAY-PANEL-CARDS.md 결정 1)');
  const card = extractFunction(app, 'cardHtml');
  assert.ok(/class="badge cat-tag"/.test(card) && /timeLabel\(e\)/.test(card), '카드에 과제 꼬리표나 시각 줄이 없다');
  assert.ok(!/else if\(a === 'ev'\)/.test(extractFunction(app, 'dpOnClick')), '일정을 눌러 펼치는 갈래가 남았다');
  assert.ok(extractFunction(app, 'dpDetAcHtml').startsWith("function dpDetAcHtml(){ return PEER ? ''"), '열람 창에서 상세의 [수정] [삭제]를 그린다');
  assert.ok(/openQuickAdd\(null, 'todo', null, id\)/.test(extractFunction(app, 'openTodoEdit')), '할 일 [수정]이 [+ 추가] 창(openQuickAdd)의 할 일 수정이 아니다');
  const qa = extractFunction(app, 'openQuickAdd');
  assert.ok(/function openQuickAdd\(date, type, entryId, todoId\)/.test(qa) && qa.includes("'할 일 수정' : '일정 수정'"), '입력 창에 할 일 수정이 없다');
  assert.ok(/if\(!entryId && !todoId && guardEdit\(\)\) return;/.test(qa), '수정 열기(읽기)까지 연결 잠금에 막힌다');
});
test('(S) 7.3: "상태 미지정"(과제 추가 창과 관리 창 공통 offStOptions), 정렬 머리 공용 함수(세 상태, button, aria-sort), 정렬 전환 단추 없음', () => {
  assert.ok(extractFunction(app, 'offStOptions').includes("t:'상태 미지정'") && !extractFunction(app, 'offStOptions').includes('상태 없음'), '상태 체크의 글자가 "상태 미지정"이 아니다');
  assert.ok(!app.includes('id="caSort"') && !/data-casort="(act|name)"/.test(app) && !/일정 있는 과제만|최근 활동순/.test(app.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')), '정렬 전환이나 옛 글자가 남았다');
  assert.ok(app.includes('> 일정 없는 과제 숨김</label>'), '"일정 없는 과제 숨김"이 없다');
  assert.ok(/<span class="ca-stsep ca-wo" aria-hidden="true"><\/span><label class="check ca-wo"><input type="checkbox" id="caOnlyAct" checked> 일정 없는 과제 숨김<\/label><span class="ca-count"/.test(app), '"일정 없는 과제 숨김"이 상태 줄 끝(구분선 뒤, 개수 앞)이 아니다');
  assert.ok(/<button type="button" class="sort-h/.test(extractFunction(app, 'sortHeadHtml')), '정렬 머리가 button 이 아니다');
  assert.ok(/aria-sort="' \+ sortAria\(CAW\.sort\)/.test(extractFunction(app, 'renderCaWatchList')), '열 머리에 aria-sort 가 없다');
});
test('(S) 7.3: 조직도 함수는 P 를 생략하면 사람 고르기(__pk) 그대로(한 명 고르기 불변), 체크 모드는 P.check 일 때만', () => {
  for (const fn of ['pkTreeEl', 'pkUnitListEl', 'pkRenderOrg', 'pkSelectUnit', 'pkToggleOpen', 'pkTreeKey']) assert.ok(/\n  P = P \|\| __pk;/.test(extractFunction(app, fn)), `${fn} 가 P 를 생략하면 __pk 를 보지 않는다`);
  const ul = extractFunction(app, 'pkUnitListEl');
  assert.ok(/if\(P\.check\) for\(const m of ms\) g\.appendChild\(pkCheckRowEl\(m, P, false\)\);/.test(ul) && /pkRowEl\(pkDirRow\(m, favIds, viewing, me\), null\)/.test(ul), '한 명 고르기의 사람 줄(pkRowEl)이 바뀌었거나 체크 모드가 P.check 로 갈리지 않는다');
  assert.ok(/\(P\.render \|\| pkRender\)\(\)/.test(extractFunction(app, 'pkSelectUnit')), '조직 고르기가 사람 고르기에서 pkRender 를 부르지 않는다');
  assert.ok(!/__pk/.test(extractFunction(app, 'caWhoRender')), '[참여자] 팝업이 사람 고르기 상태(__pk)를 건드린다');
});
test('(S) 새 함수와 CSS: 금지 기호 없음, hex 색 없음(토큰만)', () => {
  const fns = ['cardHtml', 'dpTdDetHtml', 'dpDetLn', 'dpDetAcHtml', 'todoRowHtml', 'qaDeleteTodo', 'openTodoEdit', 'todoAllByProject', 'todoAllPjHtml', 'todoAllHtml',
    'sortNext', 'sortAria', 'sortHeadHtml', 'caWatchRows', 'caWhoAll', 'caWhoUnits', 'caWhoFoundEl', 'caWhoRender', 'caWhoApply', 'caWhoPlace', 'caWhoOpen', 'caWhoClick', 'caWhoChange', 'caWhoKey',
    'pkUnitMembers', 'pkCheckRowEl', 'pkAllEl', 'fbHeadMarkup', 'fbPopEdgeKey'].map((n) => extractFunction(app, n)).join('\n');
  assert.ok(!/[—–「」]/.test(fns) && !/(^|\s)·(\s|$)/m.test(fns), '새 함수에 엠 대시, 낫표, 띄어 쓴 가운데 점이 있다');
  const mine = css.split('\n').filter((l) => /\.dp-det|\.ta-pj|\.sort-h|\.sort-ar|\.ca-stsep|\.ca-c-no|\.pk-mpick|\.pk-all|\.pk-pn|\.pk-dotsel|\.fb-pop-who/.test(l));
  assert.ok(mine.length >= 20, '새 CSS 규칙을 찾지 못했다: ' + mine.length);
  assert.ok(mine.every((l) => !/#[0-9a-fA-F]{3,8}\b/.test(l)), '새 CSS 에 hex 색이 있다: ' + mine.find((l) => /#[0-9a-fA-F]{3,8}\b/.test(l)));
});

/* ══ (R) jsdom ═════════════════════════════════════════════════════════ */
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;

if (!JSDOM) {
  skip('pc-watch-7: jsdom 미설치로 런타임 검증을 건너뜁니다', SKIP_NO_JSDOM,
    `이 파일의 test 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았습니다.`);
} else {
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  function bootWindow(src) {
    const { window: w } = new JSDOM(src || app, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/',
      beforeParse(window) {
        window.chrome = { webview: { postMessage() {}, addEventListener() {}, removeEventListener() {} } };
        if (typeof window.crypto === 'undefined') window.crypto = { randomUUID: () => 'u-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        window.scrollTo = () => {};
        window.HTMLElement.prototype.scrollIntoView = function () {};
        if (!window.CSS) window.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
      },
    });
    const doc = w.document;
    return { w, doc, ev: (code) => w.eval(code), $: (s) => doc.querySelector(s), $$: (s) => [...doc.querySelectorAll(s)], close: () => { try { w.close(); } catch (_) {} } };
  }
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const later = () => new Promise((r) => setTimeout(r, 180));
  const CAT = (id, name, color) => ({ id, name, color, desc: '', createdAt: '2026-09-01T00:00:00Z' });
  const ENT = (id, date, o) => Object.assign({ id, date, title: '일정 ' + id, categoryId: 'c-a', allDay: false, startTime: '', endTime: '', endDate: '', memo: '', location: '', recur: null, recurExcept: [] }, o || {});
  const TODO = (id, due, o) => Object.assign({ id, text: '할 일 ' + id, done: false, categoryId: 'c-a', due, endDate: '', prio: 'normal', completedAt: '', note: '', dayNotes: {}, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }, o || {});
  //  T = 오늘(기간 일정과 여러 날 할 일은 T 를 가운데 둔다)
  function data(T) {
    return {
      categories: [CAT('c-a', '알파', '#3e5be0'), CAT('c-b', '베타', '#2e9e6b'), CAT('c-c', '감마', '#9333ea')],
      entries: [
        ENT('eFull', T, { startTime: '10:00', endTime: '11:00', location: '3층 대회의실', memo: '안건: 납품 일정' }),
        ENT('eSpan', ymdAdd(T, -2), { endDate: ymdAdd(T, 2), allDay: true, title: '기간 일정' }),
        ENT('eBare', T, { allDay: true, title: '빈 일정', categoryId: 'c-b' }),
        ENT('eRec', T, { startTime: '14:00', title: '반복 일정', recur: { freq: 'weekly', interval: 1, until: '', count: 0 } }),
      ],
      todos: [
        TODO('tOne', T, { note: '설명 한 줄', prio: 'high' }),
        TODO('tSpan', ymdAdd(T, -1), { endDate: ymdAdd(T, 1), categoryId: 'c-b', dayNotes: { [T]: '오늘 설명' } }),
        //  밀린 할 일: 기한 지남(알파 둘, 감마 하나, 과제 없음 하나), 기한 없음(베타)
        TODO('o1', ymdAdd(T, -10), { categoryId: 'c-a' }), TODO('o2', ymdAdd(T, -30), { categoryId: 'c-a', prio: 'high' }),
        TODO('o3', ymdAdd(T, -5), { categoryId: 'c-c' }), TODO('o4', ymdAdd(T, -3), { categoryId: 'gone' }),
        TODO('n1', '', { categoryId: 'c-b' }),
      ],
      taskHours: {}, attendance: {},
    };
  }
  async function boot(src) {
    const W = bootWindow(src);
    await settle();
    const T = W.ev('todayYmd()');
    W.T = T;
    W.w.__applyState(JSON.stringify(data(T)), META);
    W.ev(`view = {y: ${Number(T.slice(0, 4))}, m: ${Number(T.slice(5, 7)) - 1}}; selectedDate = "${T}"; setCalView("month"); renderAll();`);
    await settle();
    return W;
  }
  const end = async (W) => { try { W.ev("closeModal('#quickAdd'); closeModal('#todoAllModal')"); } catch (_) {} await later(); W.close(); };
  const card = (W, id) => W.$(`#dpBody .card[data-id="${id}"]`);
  const cardLines = (el) => [...el.querySelectorAll('.card-top, .card-title, .card-when, .card-span, .card-recur, .card-memo')].map((x) => x.textContent.replace(/\s+/g, ' ').trim());
  const lines = (el) => [...el.querySelectorAll('.dp-det-ln, .dp-det-memo')].map((x) => x.textContent.replace(/\s+/g, ' ').trim());
  const opened = (W) => W.$$('#dpBody .todo-row.open').map((r) => r.dataset.id);

  const checks = {
    //  7.1 일정은 카드(2026-11-06 docs/DAY-PANEL-CARDS.md 되돌림): 꼬리표, 제목, 시각 범위와 장소, 기간 n일째 / n일, 반복, 메모. 할 일은 들여쓴 상세(펼침은 할 일끼리 하나)
    async detail(src) {
      const W = await boot(src);
      try {
        const T = W.T, f = (d) => { const x = new Date(d + 'T00:00:00'); return (x.getMonth() + 1) + '/' + x.getDate(); };
        assert.ok(!W.$('#dpBody .dp-er, #dpBody .dp-edet, #dpBody [data-dp="ev"]'), '한 줄 일정이나 줄 펼침 상세가 남았다');
        let d = card(W, 'eFull');
        assert.deepStrictEqual(cardLines(d), ['알파', '일정 eFull', '10:00~11:00 3층 대회의실', '안건: 납품 일정'], '일정 카드가 꼬리표, 제목, 시각과 장소, 메모가 아니다');
        assert.deepStrictEqual([...d.querySelectorAll('.card-actions [data-act]')].map((b) => [b.dataset.act, b.textContent]), [['edit', '수정'], ['del', '삭제']], '카드 끝 [수정] [삭제] 글자 단추가 없다');
        d = card(W, 'eSpan');
        assert.deepStrictEqual(cardLines(d), ['알파', '기간 일정', '종일', `${f(ymdAdd(T, -2))} ~ ${f(ymdAdd(T, 2))} (3일째 / 5일)`], '기간 일정 카드가 종일과 기간(n일째 / n일)이 아니다');
        d = card(W, 'eBare');
        assert.deepStrictEqual(cardLines(d), ['베타', '빈 일정', '종일'], '더 보일 게 없는 일정에 줄이 붙었다');
        assert.ok(d.querySelector('[data-act="edit"]') && d.querySelector('[data-act="del"]'), '더 보일 게 없는 일정도 [수정] [삭제]는 있어야 한다');
        d = card(W, 'eRec');
        assert.deepStrictEqual(cardLines(d).slice(0, 3), ['알파', '반복 일정', '14:00'], '반복 일정 카드의 시각 줄이 아니다');
        assert.ok(/매주/.test(d.querySelector('.card-recur').textContent), '반복 줄이 없다');
        //  할 일 제목: 들여쓴 상세
        W.$('#dpBody .todo-row[data-id="tOne"] .todo-text').click();
        assert.deepStrictEqual(opened(W), ['tOne']);
        const td = W.$('#dpBody .todo-row.open[data-id="tOne"] + .dp-tdet');
        assert.ok(td && !W.$('#dpBody .todo-edit'), '할 일 상세가 없거나 인라인 수정 폼이 열렸다');
        assert.deepStrictEqual(lines(td), ['기한 오늘', '알파', '설명 한 줄'], '할 일 상세가 기한, 과제, 설명이 아니다');
        assert.strictEqual(W.$('#dpBody .todo-row[data-id="tOne"] .todo-text').getAttribute('aria-expanded'), 'true');
        assert.strictEqual(W.doc.activeElement, W.$('#dpBody .todo-row[data-id="tOne"] .todo-text'), '펼친 뒤 포커스가 그 제목이 아니다');
        //  여러 날 할 일: 기한은 줄에 있으니 상세에는 과제와 그날 설명. 펼침은 할 일끼리 하나
        W.$('#dpBody .todo-row[data-id="tSpan"] .todo-text').dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.deepStrictEqual(opened(W), ['tSpan'], 'Enter 로 펼쳐지지 않았거나 앞 할 일 펼침이 남았다');
        assert.deepStrictEqual(lines(W.$('#dpBody .dp-tdet')), ['베타', '오늘 설명'], '여러 날 할 일 상세가 과제와 그날 설명이 아니다');
        //  카드의 [수정]은 일정 수정 창
        card(W, 'eFull').querySelector('[data-act="edit"]').click(); await settle();
        assert.ok(!W.$('#quickAdd').classList.contains('hidden') && W.$('#qaEditTitle').textContent === '일정 수정' && W.$('#qaDel').classList.contains('hidden'), '일정 [수정]이 일정 수정 창(삭제 단추 없음)을 열지 않았다');
        assert.strictEqual(W.$('#qaTitle').value, '일정 eFull');
      } finally { await end(W); }
    },
    //  7.1 할 일 [수정] = [+ 추가] 창의 할 일 수정: 칸, 저장, 취소, 삭제(실행 취소), 여러 날 할 일
    async todoEdit(src) {
      const W = await boot(src);
      try {
        const T = W.T;
        W.$('#dpBody .todo-row[data-id="tOne"] .todo-text').click();
        W.$('#dpBody .dp-tdet [data-act="edit"]').click(); await settle();
        const qa = W.$('#quickAdd');
        assert.ok(!qa.classList.contains('hidden'), '할 일 [수정]이 [+ 추가] 창을 열지 않았다');
        assert.strictEqual(W.$('#qaEditTitle').textContent, '할 일 수정');
        assert.ok(!W.$('#qaEditTitle').classList.contains('hidden') && W.$('#quickAdd .qa-tg').classList.contains('hidden'), '수정 제목과 종류 단추 숨김이 아니다');
        assert.ok(!W.$('#qaDel').classList.contains('hidden'), '할 일 수정에 [삭제]가 없다');
        assert.ok(W.$('#qaWhen').classList.contains('hidden') && !W.$('#qaPrioWrap').classList.contains('hidden'), '할 일 칸(중요)이 아니다');
        assert.deepStrictEqual([W.$('#qaTitle').value, W.$('#qaDate').value, W.$('#qaEndDate').value, W.$('#qaCat').value, W.$('#qaPrio').checked, W.$('#qaMemo').value],
          ['할 일 tOne', T, '', 'c-a', true, '설명 한 줄'], '할 일 칸이 채워지지 않았다');
        assert.ok(!W.$('#dpBody .todo-edit'), '패널 안 수정 폼이 열렸다');
        //  취소: 바뀌지 않는다
        W.$('#qaTitle').value = '바꾼 제목';
        W.ev("closeModal('#quickAdd')"); await later();
        assert.strictEqual(W.ev('todoById("tOne").text'), '할 일 tOne', '취소했는데 바뀌었다');
        //  저장: 제목, 기간(여러 날 할 일로), 과제, 중요, 설명
        W.ev('openTodoEdit("tOne")'); await settle();
        W.$('#qaTitle').value = '고친 할 일';
        W.$('#qaEndDate').value = ymdAdd(T, 2);
        W.$('#qaCat').value = 'c-b';
        W.$('#qaPrio').checked = false;
        W.$('#qaMemo').value = '고친 설명';
        W.$('#qaSave').click(); await later();
        assert.ok(qa.classList.contains('hidden'), '저장해도 창이 닫히지 않았다');
        const t = W.ev('todoById("tOne")');
        assert.deepStrictEqual([t.text, t.due, t.endDate, t.categoryId, t.prio, t.note, t.dayNotes[T]], ['고친 할 일', T, ymdAdd(T, 2), 'c-b', 'normal', '', '고친 설명'], '저장이 할 일을 고치지 않았다(여러 날 할 일은 그날 설명)');
        assert.strictEqual(W.ev('state.todos.length'), 7, '수정이 새 할 일을 만들었다');
        //  여러 날 할 일 수정: 설명 칸은 고른 날짜의 설명, 비우면 지워지고 되살아나지 않는다
        W.ev('openTodoEdit("tOne")'); await settle();
        assert.strictEqual(W.$('#qaMemo').value, '고친 설명');
        assert.ok(/설명/.test(W.$('#qaMemoLb').textContent));
        W.$('#qaMemo').value = ''; W.$('#qaEndDate').value = '';
        W.$('#qaSave').click(); await later();
        assert.deepStrictEqual([W.ev('todoById("tOne").endDate'), W.ev('todoById("tOne").note'), JSON.stringify(W.ev('todoById("tOne").dayNotes'))], ['', '', '{}'], '비운 설명이 되살아났거나 기간이 풀리지 않았다');
        //  삭제: 바로 지우고 실행 취소를 준다
        W.ev('openTodoEdit("tSpan")'); await settle();
        assert.strictEqual(W.$('#qaMemo').value, '오늘 설명', '여러 날 할 일의 설명 칸이 그날 설명이 아니다');
        W.$('#qaDel').click(); await later();
        assert.ok(qa.classList.contains('hidden') && !W.ev('todoById("tSpan")'), '[삭제]가 지우고 닫지 않았다');
        const undo = [...W.doc.querySelectorAll('.toast button')].find((b) => /실행 취소/.test(b.textContent));
        assert.ok(undo, '삭제 뒤 실행 취소가 없다');
        undo.click(); await settle();
        assert.ok(W.ev('todoById("tSpan")'), '실행 취소가 되살리지 않았다');
        //  새 기록은 그대로: 종류 단추가 보이고 [삭제]가 없다
        W.ev('openAddOnDate(selectedDate)'); await settle();
        assert.ok(!W.$('#quickAdd .qa-tg').classList.contains('hidden') && W.$('#qaDel').classList.contains('hidden') && W.$('#qaEditTitle').classList.contains('hidden'), '새 기록 창에 수정 모양이 남았다');
        W.$('#quickAdd [data-qatype="todo"]').click();
        W.$('#qaTitle').value = '새 할 일'; W.$('#qaSave').click(); await later();
        assert.strictEqual(W.ev('state.todos.length'), 8, '새 할 일 추가가 깨졌다');
      } finally { await end(W); }
    },
    //  7.2 밀린 할 일 팝업: 과제별 소제목, 접기(기억 안 함), 줄에 색점 없음
    async overdue(src) {
      const W = await boot(src);
      try {
        W.$('#dpFoot').click(); await settle();
        const pj = (g) => W.$$(`#taBody .ta-grp[data-grp="${g}"] .ta-pj`).map((b) => b.querySelector('.ta-pj-nm').textContent + ' ' + b.querySelector('.ta-pj-n').textContent + (b.querySelector('.ta-pj-old') ? ' ' + b.querySelector('.ta-pj-old').textContent : ''));
        const f = (d) => { const x = new Date(d + 'T00:00:00'); return (x.getMonth() + 1) + '/' + x.getDate(); };
        assert.deepStrictEqual(pj('over'), [`알파 2 가장 오래됨 ${f(ymdAdd(W.T, -30))}`, `감마 1 가장 오래됨 ${f(ymdAdd(W.T, -5))}`, `과제 없음 1 가장 오래됨 ${f(ymdAdd(W.T, -3))}`], '기한 지남 소제목이 과제 목록 순서, 개수, 가장 오래된 기한이 아니다(과제 없음은 끝)');
        assert.deepStrictEqual(pj('nodate'), ['베타 1'], '기한 없음 소제목에 가장 오래된 기한이 붙었거나 과제별이 아니다');
        assert.ok(W.$('#taBody .ta-pj .ta-pj-dot[style*="background"]'), '소제목에 과제 색점이 없다');
        assert.strictEqual(W.$$('#taBody .todo-row .todo-dot').length, 0, '소제목에 색점이 있는데 줄에도 과제 색점이 있다');
        const rows = (g) => W.$$(`#taBody .ta-grp[data-grp="${g}"] .todo-row`).map((r) => r.dataset.id);
        assert.deepStrictEqual(rows('over'), ['o2', 'o1', 'o3', 'o4'], '과제 안 순서가 ★ 먼저, 날짜순이 아니다');
        //  소제목을 누르면 그 과제만 접힌다(포커스는 그 소제목)
        const head = () => W.$('#taBody .ta-grp[data-grp="over"] .ta-pj');
        assert.strictEqual(head().getAttribute('aria-expanded'), 'true');
        head().click();
        assert.deepStrictEqual(rows('over'), ['o3', 'o4'], '소제목을 눌러 그 과제만 접히지 않았다');
        assert.strictEqual(head().getAttribute('aria-expanded'), 'false');
        assert.strictEqual(W.doc.activeElement, head(), '접은 뒤 포커스가 소제목이 아니다');
        assert.deepStrictEqual(rows('nodate'), ['n1'], '다른 묶음까지 접혔다');
        //  기억하지 않는다: 다시 열면 다 펼침
        W.ev("closeModal('#todoAllModal')"); await later();
        W.$('#dpFoot').click(); await settle();
        assert.deepStrictEqual(rows('over'), ['o2', 'o1', 'o3', 'o4'], '다시 열었는데 접힌 과제가 남았다');
        //  완료 묶음도 과제별(펼치면)
        W.ev('toggleTodo("n1"); renderTodoAll();');
        W.$('#taBody .ta-tog').click();
        assert.deepStrictEqual(pj('done'), ['베타 1'], '완료 묶음 안이 과제별이 아니다');
      } finally { await end(W); }
    },
  };

  test('(R) 7.1 일정은 카드(꼬리표, 시각과 장소, 기간, 반복, 메모, 있는 줄만), 할 일은 들여쓴 상세(할 일끼리 하나), 카드 [수정]은 일정 수정', () => checks.detail());
  test('(R) 7.1 할 일 [수정] = [+ 추가] 창의 할 일 수정(칸 채움, 취소, 저장, 여러 날 할 일의 그날 설명, 삭제와 실행 취소), 새 기록은 그대로', () => checks.todoEdit());
  test('(R) 7.2 밀린 할 일 팝업: 과제별 소제목(과제 순서, 개수, 가장 오래된 기한, 과제 없음은 끝), 소제목 접기(기억 안 함), 줄에 색점 없음', () => checks.overdue());
  test('(R) 7.3 정렬 머리 공용 함수: 세 상태 순환과 aria-sort', async () => {
    const W = await boot();
    try {
      assert.deepStrictEqual([null, 'desc', 'asc'].map((c) => W.ev(`sortNext(${JSON.stringify(c)})`)), ['desc', 'asc', null], '최근 순 → 오래된 순 → 기본 순서가 아니다');
      assert.deepStrictEqual([null, 'desc', 'asc'].map((c) => W.ev(`sortAria(${JSON.stringify(c)})`)), ['none', 'descending', 'ascending']);
      const h = W.ev(`sortHeadHtml('최근 활동', 'desc', ' data-x="1"')`);
      assert.ok(/^<button type="button" class="sort-h on" data-x="1">최근 활동<span class="sort-ar" aria-hidden="true">▼<\/span><\/button>$/.test(h), '정렬 머리 마크업: ' + h);
      assert.ok(/<span class="sort-ar" aria-hidden="true"><\/span>/.test(W.ev(`sortHeadHtml('a<b', null)`)) && /a&lt;b/.test(W.ev(`sortHeadHtml('a<b', null)`)), '기본 상태 화살표가 비어 있지 않거나 글자를 이스케이프하지 않는다');
    } finally { await end(W); }
  });

  /* ══ (M) 변이 ═══════════════════════════════════════════════════════ */
  test('(M) 카드에서 기간 줄(n일째 / n일)을 빼면 상세 시험이 잡는다', async () => {
    const bad = mutate(app, '    + top + `<div class="card-title">${esc(e.title)}</div>` + whenRow + rangeLine + recurLine', '    + top + `<div class="card-title">${esc(e.title)}</div>` + whenRow + recurLine');
    await assert.rejects(() => checks.detail(bad), /기간/);
  });
  test('(M) 할 일 [수정]이 [+ 추가] 창을 열지 않으면 수정 시험이 잡는다', async () => {
    const bad = mutate(app, "function openTodoEdit(id){ if(todoById(id)) openQuickAdd(null, 'todo', null, id); }", 'function openTodoEdit(id){}');
    await assert.rejects(() => checks.todoEdit(bad), /\[\+ 추가\] 창을 열지 않았다/);
  });
  test('(M) 밀린 할 일 팝업에서 과제별 소제목을 빼면 팝업 시험이 잡는다', async () => {
    const bad = mutate(app, "todoAllByProject(x.items).map(p => todoAllPjHtml(x.key, p)).join('')", "`<div class=\"dp-todos\">${x.items.map(t => todoRowHtml(t, { all: true })).join('')}</div>`");
    await assert.rejects(() => checks.overdue(bad), /소제목/);
  });
}
