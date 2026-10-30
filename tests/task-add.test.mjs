// 내 과제 창과 과제 추가 창(docs/TASK-ADD-UX.md D1~D18)의 웹 쪽 계약.
//
// 이 파일이 지키는 것:
//   (a) 정적: 내 과제 창은 목록만(입력 폼, 입구 카드, 안내 줄, 「DB」 배지, ▲▼ 없음) · 머리의 [＋ 과제 추가] · 열 머리글(과제, 구분, 건수) ·
//       수정 창, 합치기 창, 과제 추가 창(탭 둘, 표 칸 container 760/400) 마크업 · 버튼 문구 · 새 화면의 금지 문장부호.
//   (b) jsdom 런타임(위젯 모드): 목록 줄 구조와 구분 열 값 · ⋯ 메뉴 항목이 과제 종류마다 맞다(한 번에 하나, Esc, 바깥 클릭, 화살표) ·
//       줄을 누르면 수정 창 · 수정 저장(일반 이름 바꾸기, 줄바꿈은 공백, 공식 이름 불변, 같은 이름과 빈 이름 거절) ·
//       합치기 + 체크(일반 삭제, 공식 빼기, 기본은 체크 없음, 확인창 없음) · 빼기(사용 중 꺼짐, 0건 즉시, 시간이 있을 때만 확인) ·
//       순서 메뉴가 moveCategory 를 한 번 거쳐 한 번 저장 · 추가 창 공식 탭(가짜 카탈로그 주입: 표 줄, 그룹 접기, 펼침, [추가] 뒤 「✓ 내 과제」, 창은 열린 채) ·
//       일반 탭(추가 뒤 창이 닫힘) · 근태 창 진입이 일반 탭으로 연다 · 긴 이름 줄이기(앞부분 … 끝 8자).
//   (c) 변이: 핵심 줄을 되돌린 소스에서 같은 검사가 실패한다(빼기 즉시 → 확인창, 공식 추가 뒤 창 닫힘, 줄 클릭이 수정 창을 안 엶,
//       끝 8자 보존 제거, 일반 추가 뒤 창이 안 닫힘, 합치기 체크 무시).
//
// 검사 함수를 시험과 변이 시험이 함께 쓴다(같은 함수를 변이된 소스에 돌려 정말 잡는지 증명한다).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}
//  마크업 한 덩이: 그 overlay 의 여는 줄부터 다음 '<!-- =====' 또는 다음 overlay 앞까지
function block(app, id) {
  const i = app.indexOf(`<div class="overlay hidden" id="${id}">`);
  assert.ok(i > 0, `#${id} 마크업이 없다`);
  const ends = [app.indexOf('\n<!-- =====', i + 10), app.indexOf('\n<div class="overlay', i + 10)].filter((x) => x > 0);
  return app.slice(i, Math.min(...ends));
}
const PUNCT = [[/—/, '엠 대시'], [/–/, 'en 대시'], [/「|」/, '낫표'], [/(^|\s)·|·(\s|$)/, '띄어 쓴 가운데 점']];
//  HTML 주석과 JS 주석을 걷은 글(문자열 리터럴은 남긴다)
const noHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
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
const NEW_FNS = ['catRowHtml', 'catMenuHtml', 'renderCatModal', 'openCatMoveModal', 'runCatMove', 'catUnsub', 'catDelete', 'saveCatEdit',
  'openCatEdit', 'ceGrow', 'caRowHtml', 'renderCaList', 'openCatAdd', 'catAddOfficial', 'catAddOwn', 'catAnnounce'];

/* ── (a) 정적 ──────────────────────────────────────────────────────────── */

const statics = {
  //  내 과제 창 = 목록만(D1, D2, D17)
  myTasksMarkup(app) {
    const m = block(app, 'categoryModal');
    assert.ok(/<button type="button" class="btn sm primary" id="btnCatAdd">＋ 과제 추가<\/button>/.test(m), '머리에 [＋ 과제 추가] 가 없다(D1)');
    assert.ok(/id="catHead"[^>]*>.*<span>과제<\/span><span class="ch-kind">구분<\/span><span class="ch-count">건수<\/span>/.test(m), '열 머리글(과제, 구분, 건수)이 없다(D2)');
    assert.ok(/<div id="catList" role="list"/.test(m), '목록(#catList role=list)이 없다');
    for (const gone of ['id="cName"', 'id="cDesc"', 'id="cPalette"', 'id="btnCatSave"', 'id="btnCatCancelEdit"', 'id="btnOfficialOpen"', 'id="offEntryMeta"', 'id="catOrderHint"', 'class="cat-form"', 'cat-sec-lb'])
      assert.ok(!app.includes(gone), `없앤 입력 폼, 입구 카드, 안내 줄이 남았다: ${gone}(D1)`);
    assert.ok(!/개인과 공식\(DB\) 통합 목록|순서는 보고서·필터에 그대로 반영됩니다|공식 과제\(DB\) 찾아보기/.test(app), '없앤 안내 문구가 남았다(D1)');
    assert.ok(/<button class="btn" type="button" id="btnRelinkOpen" title="공식 과제로 연결" aria-label="공식 과제로 연결">🔗<span class="btn-label"> 공식 과제로 연결<\/span><\/button>/.test(m), '하단 버튼이 「🔗 공식 과제로 연결」(title, aria 포함)이 아니다(D8)');
    const rl = noHtmlComments(block(app, 'relinkModal'));
    assert.ok(!/기존 과제 재연결|개인 과제/.test(rl + noHtmlComments(m)), '연결 창이나 내 과제 창에 「기존 과제 재연결」「개인 과제」가 남았다(D8, D17)');
    assert.ok(/<h2>공식 과제로 연결<\/h2>/.test(rl), '연결 창 제목이 「공식 과제로 연결」이 아니다(D8)');
    const row = stripJs(extractFunction(app, 'catRowHtml'));
    assert.ok(!/cat-badge|>DB<|data-act="(up|down|edit|del|unsub|movedata)"|▲|▼|🔒/.test(row), '줄에 「DB」 배지, ▲▼, 옛 버튼, 잠금 아이콘이 남았다(D2, D17)');
    assert.ok(/const CAT_KIND_LABEL = \{ official: '공식', default: '기본', personal: '일반' \};/.test(app), '구분 열의 말이 공식, 기본, 일반이 아니다(D17)');
    assert.ok(row.includes('삭제됨') && row.includes('c.dbGone'), 'DB 에서 사라진 공식 과제를 구분 칸에 「삭제됨」으로 보이지 않는다');
    assert.ok(row.includes('${catUsageCount(c.id)}건'), '건수가 catUsageCount(빼기 관문과 같은 숫자)가 아니다');
  },
  //  수정 창, 합치기 창, 추가 창 마크업과 버튼 문구(D4, D6, D9~D16)
  dialogsMarkup(app) {
    const e = block(app, 'catEditModal');
    assert.ok(/<textarea id="ceName" rows="1" maxlength="60"/.test(e), '수정 창 이름 칸이 한 줄에서 시작하는 60자 textarea 가 아니다(D4)');
    assert.ok(/id="cePalette" data-pal/.test(e) && /id="ceDesc" maxlength="200"/.test(e) && /id="ceSave"[^>]*>저장</.test(e), '수정 창의 색상, 메모, 저장이 없다');
    assert.ok(/<h2>과제 수정<\/h2>/.test(e));
    const mv = block(app, 'catMoveModal');
    assert.ok(/<h2>다른 과제와 합치기<\/h2>/.test(mv) && /id="cmvRun" type="button">합치기<\/button>/.test(mv), '합치기 창 제목이나 버튼이 「다른 과제와 합치기」「합치기」가 아니다(D6)');
    assert.ok(/<input type="checkbox" id="cmvAfter">/.test(mv), '합치기 창에 체크가 없다(D6)');
    assert.ok(!/옮기기/.test(noHtmlComments(mv)), '합치기 창에 옛 말 「옮기기」가 남았다');
    const a = block(app, 'catAddModal');
    assert.ok(/role="tablist"/.test(a) && /role="tab" id="caTabOff" data-catab="off" aria-selected="true"[^>]*>공식 과제</.test(a)
      && /role="tab" id="caTabOwn" data-catab="own" aria-selected="false"[^>]*>일반 과제</.test(a), '추가 창의 탭(공식 과제 처음, 일반 과제)이 없다(D9)');
    for (const id of ['caSearch', 'caCustomer', 'caSection', 'caStChecks', 'caList', 'caName', 'caPalette', 'caDesc', 'caAdded', 'caAddOwn'])
      assert.ok(a.includes(`id="${id}"`), `추가 창에 #${id} 가 없다`);
    assert.ok(/id="caName" maxlength="60"/.test(a), '일반 과제 이름이 60자 제한이 아니다');
    assert.ok(/id="caAddOwn" type="button">추가<\/button>/.test(a), '일반 탭 [추가] 문구가 다르다');
    const foot = a.slice(a.indexOf('<div class="modal-foot">'));
    assert.ok(/^<div class="modal-foot">\s*<button class="btn" data-close>닫기<\/button>/.test(foot), '추가 창 하단 왼쪽(첫 자리)이 [닫기] 가 아니다(D16)');
    assert.ok(!/안내|설명|선택하세요/.test(noHtmlComments(a).replace(/placeholder="[^"]*"/g, '')), '추가 창에 안내 문구가 있다(D9, D15)');
    //  표 칸이 열 줄이기의 기준이다(container, 760px 미만, 400px 미만)
    const css = app.slice(0, app.indexOf('</style>'));
    assert.ok(/\.ca-res\{[^}]*container-type:inline-size/.test(css), '추가 창 표 칸(.ca-res)이 container 가 아니다(D11)');
    assert.ok(/@container \(max-width:759px\)\{[^@]*\.ca-c-ctr,\.ca-c-per\{display:none\}/.test(css), '760px 미만에서 계약명, 계약기간을 숨기지 않는다(D11)');
    assert.ok(/@container \(max-width:399px\)\{[^@]*\.ca-c-cust,\.ca-c-st\{display:none\}/.test(css), '400px 미만에서 발주처, 상태를 숨기지 않는다(D11)');
    assert.ok(/#catAddModal \.modal\{height:/.test(css), '추가 창 높이가 고정이 아니다(탭을 바꾸면 출렁인다, D9)');
    //  버튼과 상태 문구
    assert.ok(app.includes('<span class="ca-have">✓ 내 과제</span>'), '「✓ 내 과제」 표시가 없다(D12)');
    const menu = extractFunction(app, 'catMenuHtml');
    for (const t of ["'다른 과제와 합치기…'", "'공식 과제로 연결…'", "'내 캘린더에서 빼기'", "'삭제…'", "'수정'", "'맨 위로'", "'맨 아래로'"])
      assert.ok(menu.includes(t), `⋯ 메뉴에 ${t} 가 없다(D5)`);
    assert.ok(app.includes('`이번에 ${__caAdded}개 추가`'), '공식 탭 하단 상태(이번에 n개 추가)가 없다(D16)');
  },
  //  새 화면의 문구에 금지 문장부호가 없다(마크업, 새 함수의 문자열)
  punct(app) {
    const parts = ['categoryModal', 'catMoveModal', 'catEditModal', 'catAddModal', 'relinkModal'].map((id) => [id, noHtmlComments(block(app, id))])
      .concat(NEW_FNS.map((f) => [f, stripJs(extractFunction(app, f))]));
    for (const [name, text] of parts)
      for (const [re, what] of PUNCT) assert.ok(!re.test(text), `${name} 에 ${what} 가 있다: ${(text.match(re) || [])[0]}`);
  },
};

test('정적①: 내 과제 창은 목록만 · [＋ 과제 추가] · 열 머리글 · 입력 폼, 입구 카드, 안내 줄, 「DB」 배지, ▲▼ 없음 · 🔗 공식 과제로 연결(D1, D2, D8, D17)', () => statics.myTasksMarkup(src));
test('정적②: 수정 창, 합치기 창, 과제 추가 창 마크업 · 탭 · 표 칸 container · 버튼 문구(D4, D6, D9~D16)', () => statics.dialogsMarkup(src));
test('정적③: 새 화면 문구에 엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점이 없다', () => statics.punct(src));
test('변이①s: 입구 카드를 되살리면 정적① 이 실패한다', () => {
  const bad = mutate('<div class="cat-wrap" id="catWrap">', '<button type="button" class="off-entry" id="btnOfficialOpen">📁 공식 과제(DB) 찾아보기</button>\n      <div class="cat-wrap" id="catWrap">', src);
  assert.throws(() => statics.myTasksMarkup(bad), /입구 카드|안내 문구/);
});
test('변이②s: 구분 열 대신 「DB」 배지를 붙이면 정적① 이 실패한다', () => {
  const bad = mutate('<span class="cat-nm" data-full="${nm}" title="${nm}">${nm}</span></div>`', '<span class="cat-nm" data-full="${nm}" title="${nm}">${nm}</span> <span class="cat-badge db">DB</span></div>`', src);
  assert.throws(() => statics.myTasksMarkup(bad), /DB/);
});
test('변이③s: 합치기 창 제목에 낫표를 넣으면 정적③ 이 실패한다', () => {
  const bad = mutate('<h2>다른 과제와 합치기</h2>', '<h2>「다른 과제와 합치기」</h2>', src);
  assert.throws(() => statics.punct(bad), /낫표/);
});
test('변이④s: 추가 창 하단 [닫기] 를 오른쪽으로 옮기면 정적② 가 실패한다', () => {
  const bad = mutate('      <button class="btn" data-close>닫기</button>\n      <span class="ca-added"', '      <span class="ca-added"', src)
    .replace('      <button class="btn primary hidden" id="caAddOwn" type="button">추가</button>', '      <button class="btn primary hidden" id="caAddOwn" type="button">추가</button>\n      <button class="btn" data-close>닫기</button>');
  assert.throws(() => statics.dialogsMarkup(bad), /\[닫기\]/);
});

/* ── (b) jsdom 런타임(위젯 모드) ───────────────────────────────────────── */

const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('task-add: jsdom 미설치 — 런타임 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CA = '2026-09-01T00:00:00Z';
  const CAT = (id, name, extra) => Object.assign({ id, name, color: '#3e5be0', desc: '', createdAt: CA }, extra || {});
  const ENT = (id, categoryId) => ({ id, date: '2026-10-01', title: '업무 ' + id, categoryId, allDay: true, startTime: '', endTime: '',
    memo: '', location: '', recur: null, recurExcept: [], endDate: '', createdAt: CA, updatedAt: CA });
  const TODO = (id, categoryId) => ({ id, text: '할 일 ' + id, done: false, categoryId, due: '2026-10-02', endDate: '', prio: 'normal',
    completedAt: '', note: '', dayNotes: {}, createdAt: CA, updatedAt: CA });
  //  공식 과제 카탈로그(호스트 회신 모양 그대로 __applyProjects 로 주입). 1, 2 는 이미 내 과제, 3, 4 는 아니다. 구분 둘.
  const ROW = (uid, name, sec, secId, extra) => Object.assign({ uid, common_name: name, project_name: '사업 ' + name, contract_name: '계약 ' + uid,
    customer: '발주처' + uid, customerId: Number(uid), section: sec, sectionId: secId, status: '진행중', statusId: 1,
    start_date: '2026-01-01', end_date: '2026-12-31', dev_start_date: '2026-02-01', dev_end_date: '' }, extra || {});
  const CATALOG = [ROW('1', '공식 하나', '일반계약', 1), ROW('2', '공식 둘', '일반계약', 1), ROW('3', '공식 셋', '선진행', 2), ROW('4', '공식 넷', '일반계약', 1)];
  const DATA = {
    categories: [CAT('c-p', '프로젝트', { desc: '내 메모' }), CAT('db-1', '공식 하나', { source: 'db' }), CAT('db-2', '공식 둘', { source: 'db' }),
      CAT('db-g', '사라진 공식', { source: 'db' }), CAT('c-v', '휴가'), CAT('c-e', '기타')],
    entries: [ENT('e-p', 'c-p'), ENT('e-1', 'db-1')],
    todos: [TODO('t-p', 'c-p')], rooms: [],
  };

  function boot(source) {
    const log = [];
    const handlers = { saveState: { ok: true } };
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/',
      virtualConsole: jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined,
      beforeParse(win) {
        win.chrome = { webview: {
          postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} log.push({ post: o && o.cmd, msg: o }); },
          addEventListener() {}, removeEventListener() {},
        } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.setTimeout = () => 0;   // 시계는 흐르지 않는다(토스트, 재시도 타이머가 끼어들지 않게)
        win.clearTimeout = () => {};
        //  닫기 애니메이션 없이 바로 닫히게(감속 모드)
        win.matchMedia = (q) => ({ matches: /prefers-reduced-motion/.test(String(q)), media: String(q),
          addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      },
    });
    const w = dom.window;
    w.__fakeReply = (cmd, params) => {
      log.push({ req: cmd, params });
      const h = handlers[cmd];
      return Promise.resolve(h === undefined ? { ok: false, error: 'no handler' } : h);
    };
    w.eval('hostRequest = function(cmd, params){ return window.__fakeReply(cmd, params || {}); };');
    w.eval('(function(){ var t = toast; toast = function(m, k, a, ms){ window.__fakeToast(String(m), k); return t(m, k, a, ms); }; })();');
    w.__fakeToast = (m, k) => log.push({ toast: m, kind: k });
    w.eval("window.__cf = []; window.__cfAns = 'ok'; confirmBox = function(t, m, ok){ window.__cf.push([String(t), String(m), String(ok)]); return Promise.resolve(window.__cfAns); };");
    const sess = log.find((x) => x.post === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.msg.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'hjlee', name: '이현진' } }) + ')');
    const d = w.document;
    const W = {
      w, d, log,
      ev: (code) => w.eval(code),
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      $: (sel) => d.querySelector(sel),
      $$: (sel) => [...d.querySelectorAll(sel)],
      saves: () => log.filter((x) => x.req === 'saveState').length,
      toasts: () => log.filter((x) => x.toast).map((x) => x.toast),
      confirms: () => JSON.parse(w.eval('JSON.stringify(window.__cf)')),
      open: (id) => { const e = d.getElementById(id); return !!e && !e.classList.contains('hidden') && !e.classList.contains('closing'); },
      ids: () => JSON.parse(w.eval('JSON.stringify(state.categories.map(function(c){ return c.id; }))')),
      row: (id) => d.querySelector('#catList .cat-row[data-id="' + id + '"]'),
      //  ⋯ 를 눌러 그 줄의 메뉴를 연다(이미 열려 있으면 그대로) — 항목 [act, 꺼짐] 목록
      menu: (id) => {
        const r = d.querySelector('#catList .cat-row[data-id="' + id + '"]');
        if (!r.querySelector('.cat-menu')) r.querySelector('[data-catmore]').click();
        return [...r.querySelectorAll('.cat-menu [data-catdo]')].map((b) => b.dataset.catdo + (b.disabled ? ':off' : ''));
      },
      item: (id, act) => {
        const r = d.querySelector('#catList .cat-row[data-id="' + id + '"]');
        if (!r.querySelector('.cat-menu')) r.querySelector('[data-catmore]').click();
        return r.querySelector('.cat-menu [data-catdo="' + act + '"]');
      },
      key: (el, key) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
      clear: () => { log.length = 0; w.eval('window.__cf = []'); },
      close: async () => { await settle(); try { w.close(); } catch (_) {} },
    };
    return W;
  }
  async function withBoot(source, fn, data = DATA, catalog = CATALOG) {
    const W = boot(source);
    try {
      W.ev('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(META) + ')');
      await settle();
      W.ev('__applyProjects(' + JSON.stringify(catalog ? JSON.stringify(catalog) : '') + ')');
      await settle();
      W.ev('openCatModal();');
      await settle();
      W.clear();
      return await fn(W);
    } finally { await W.close(); }
  }

  const checks = {
    //  줄 구조: ⠿, 색 점, 이름(2줄 칸 + data-full + title), 메모 줄(있을 때만), 구분 열, 건수(catUsageCount), ⋯ · 하단 연결 버튼은 일반 과제가 있을 때만
    async listRows(source) {
      await withBoot(source, async (W) => {
        assert.deepStrictEqual(W.$$('#catList .cat-row').map((r) => r.dataset.id), W.ids(), '목록이 state.categories 순서가 아니다');
        assert.ok(W.open('categoryModal') && !W.$('#catHead').classList.contains('hidden'), '열 머리글이 안 보인다');
        const kinds = W.$$('#catList .cat-row').map((r) => r.dataset.id + ':' + r.querySelector('.cat-kind').textContent);
        assert.deepStrictEqual(kinds, ['c-p:일반', 'db-1:공식', 'db-2:공식', 'db-g:삭제됨', 'c-v:기본', 'c-e:기본'], '구분 열 값이 다르다: ' + JSON.stringify(kinds));
        const r = W.row('c-p');
        assert.deepStrictEqual([...r.children].map((c) => c.className), ['cat-grip', 'cat-dot', 'cat-main', 'cat-kind personal', 'cat-count', 'cat-more'], '줄의 칸 순서가 다르다(D2)');
        const nm = r.querySelector('.cat-nm');
        assert.ok(nm.dataset.full === '프로젝트' && nm.title === '프로젝트' && nm.textContent === '프로젝트', '이름 칸에 원래 이름(data-full), title 이 없다(D14)');
        assert.strictEqual(r.querySelector('.cat-desc').textContent, '내 메모', '메모 줄이 없다');
        assert.strictEqual(W.row('db-2').querySelector('.cat-desc'), null, '메모가 없는데 메모 줄이 있다');
        assert.strictEqual(r.querySelector('.cat-count').textContent, '2건', '건수가 일정과 할 일 합계가 아니다');
        assert.strictEqual(r.querySelector('.cat-count').title, '일정 1건, 할 일 1건', '건수 title 이 일정과 할 일로 나뉘지 않는다');
        assert.strictEqual(W.row('db-1').querySelector('.cat-count').textContent, '1건');
        assert.strictEqual(r.querySelector('[data-catmore]').getAttribute('aria-haspopup'), 'menu');
        assert.ok(!W.$('#catList .cat-badge') && !W.$('#catList [data-act]'), '「DB」 배지나 옛 줄 버튼이 남았다');
        assert.strictEqual(W.$('#btnRelinkOpen').classList.contains('hidden'), false, '일반 과제가 있는데 연결 버튼이 숨었다(D8)');
        W.ev("state.categories = state.categories.filter(function(c){ return c.id !== 'c-p'; }); renderCatModal();");
        assert.strictEqual(W.$('#btnRelinkOpen').classList.contains('hidden'), true, '일반 과제가 없는데 연결 버튼이 보인다(D8)');
      });
    },
    //  ⋯ 메뉴 항목이 종류마다 맞다(D5, D7) · 한 번에 하나 · Esc 는 메뉴만 · 바깥 클릭 · 화살표
    async menuItems(source) {
      await withBoot(source, async (W) => {
        assert.deepStrictEqual(W.menu('c-p'), ['edit', 'merge', 'link', 'up:off', 'down', 'top:off', 'bottom', 'del'], '일반 과제 메뉴가 다르다');
        assert.deepStrictEqual(W.menu('db-1'), ['edit', 'merge', 'up', 'down', 'top', 'bottom', 'unsub:off'], '사용 중 공식 과제 메뉴가 다르다');
        assert.strictEqual(W.item('db-1', 'unsub').querySelector('small').textContent, '일정과 할 일 1건이 있습니다', '빼기가 꺼진 이유가 없다(D7)');
        assert.deepStrictEqual(W.menu('db-2'), ['edit', 'up', 'down', 'top', 'bottom', 'unsub'], '데이터 없는 공식 과제 메뉴가 다르다(합치기 없음, 빼기 켜짐)');
        assert.deepStrictEqual(W.menu('c-e'), ['edit', 'up', 'down:off', 'top', 'bottom:off'], '기본 과제 메뉴에 빼기나 삭제가 있다(D5)');
        assert.strictEqual(W.$$('.cat-menu').length, 1, '메뉴가 한 번에 하나만 열리지 않는다');
        assert.strictEqual(W.row('c-e').querySelector('[data-catmore]').getAttribute('aria-expanded'), 'true');
        //  화살표: 꺼진 항목을 건너뛴다
        const first = W.item('c-p', 'edit');
        assert.strictEqual(W.d.activeElement, first, '메뉴를 열면 첫 항목에 포커스가 가지 않는다');
        W.key(first, 'ArrowDown'); W.key(W.d.activeElement, 'ArrowDown'); W.key(W.d.activeElement, 'ArrowDown');
        assert.strictEqual(W.d.activeElement.dataset.catdo, 'down', '아래 화살표가 꺼진 항목(위로)을 건너뛰지 않는다');
        W.key(W.d.activeElement, 'End');
        assert.strictEqual(W.d.activeElement.dataset.catdo, 'del');
        //  Esc 는 메뉴만 닫고 ⋯ 로 돌아온다(창은 그대로)
        W.key(W.d.activeElement, 'Escape');
        assert.strictEqual(W.$$('.cat-menu').length, 0, 'Esc 가 메뉴를 닫지 않았다');
        assert.ok(W.open('categoryModal'), 'Esc 가 내 과제 창까지 닫았다');
        assert.strictEqual(W.d.activeElement, W.row('c-p').querySelector('[data-catmore]'), 'Esc 뒤 포커스가 ⋯ 로 돌아오지 않았다');
        //  바깥을 누르면 닫힌다
        W.menu('db-2');
        W.$('#catHead').dispatchEvent(new W.w.MouseEvent('pointerdown', { bubbles: true }));
        assert.strictEqual(W.$$('.cat-menu').length, 0, '바깥을 눌렀는데 메뉴가 닫히지 않았다');
        //  같은 ⋯ 를 다시 누르면 닫힌다
        W.menu('db-2'); W.row('db-2').querySelector('[data-catmore]').click();
        assert.strictEqual(W.$$('.cat-menu').length, 0, '같은 ⋯ 를 다시 눌렀는데 메뉴가 닫히지 않았다');
      });
    },
    //  줄을 누르면 수정 창(⋯ 의 「수정」과 같다). ⋯, ⠿, 메뉴 안을 누르면 열리지 않는다. 줄에서 Enter 도 연다.
    async rowOpensEdit(source) {
      await withBoot(source, async (W) => {
        W.row('c-p').querySelector('[data-catmore]').click();
        assert.ok(!W.open('catEditModal'), '⋯ 를 눌렀는데 수정 창이 열렸다');
        W.ev('catMenuClose(false)');
        W.row('c-p').querySelector('[data-catgrip]').click();
        assert.ok(!W.open('catEditModal'), '⠿ 를 눌렀는데 수정 창이 열렸다');
        W.row('c-p').querySelector('.cat-nm').click();
        assert.ok(W.open('catEditModal'), '줄을 눌렀는데 수정 창이 열리지 않았다(D4)');
        assert.strictEqual(W.ev('__catEditId'), 'c-p');
        assert.strictEqual(W.$('#ceName').value, '프로젝트');
        assert.strictEqual(W.$('#ceDesc').value, '내 메모');
        W.ev("closeModal('#catEditModal')");
        W.key(W.row('db-1'), 'Enter');
        assert.ok(W.open('catEditModal') && W.ev('__catEditId') === 'db-1', '줄에서 Enter 로 수정 창이 열리지 않았다');
        W.ev("closeModal('#catEditModal')");
        W.item('c-e', 'edit').click();
        assert.ok(W.open('catEditModal') && W.ev('__catEditId') === 'c-e', '⋯ 의 「수정」이 수정 창을 열지 않았다');
      });
    },
    //  수정 저장: 일반 이름 바꾸기(줄바꿈은 공백, 글자 수) · 같은 이름, 빈 이름 거절 · 공식 과제는 이름을 읽지 않는다
    async editSave(source) {
      await withBoot(source, async (W) => {
        W.row('c-p').click();
        const t = W.$('#ceName');
        t.value = '새\n이름'; t.dispatchEvent(new W.w.Event('input', { bubbles: true }));
        assert.strictEqual(t.value, '새 이름', '붙여넣은 줄바꿈이 공백이 되지 않았다(D4)');
        assert.strictEqual(W.$('#ceCount').textContent, '4 / 60자', '글자 수 표시가 다르다');
        W.$('#ceDesc').value = '고친 메모';
        W.$('#ceSave').click();
        assert.strictEqual(W.ev("catById('c-p').name"), '새 이름', '일반 과제 이름이 바뀌지 않았다');
        assert.strictEqual(W.ev("catById('c-p').desc"), '고친 메모');
        assert.ok(!W.open('catEditModal'), '저장 뒤 수정 창이 닫히지 않았다');
        assert.strictEqual(W.row('c-p').querySelector('.cat-nm').textContent, '새 이름', '목록 줄이 새 이름으로 바뀌지 않았다');
        assert.strictEqual(W.saves(), 1, '수정 저장이 한 번이 아니다');
        //  같은 이름, 빈 이름
        W.row('c-p').click();
        W.$('#ceName').value = '휴가'; W.$('#ceSave').click();
        assert.strictEqual(W.ev("catById('c-p').name"), '새 이름', '같은 이름으로 바꿨다');
        assert.ok(W.toasts().includes('같은 이름의 과제가 이미 있습니다'), '같은 이름을 막으며 이유를 말하지 않는다');
        assert.ok(W.open('catEditModal'), '거절했는데 창이 닫혔다');
        W.$('#ceName').value = '   '; W.$('#ceSave').click();
        assert.strictEqual(W.ev("catById('c-p').name"), '새 이름', '빈 이름으로 바꿨다');
        assert.ok(W.toasts().includes('과제 이름을 입력하세요'));
        W.ev("closeModal('#catEditModal')");
        //  공식 과제: 이름은 글자로만, 저장은 이름을 읽지 않는다(칸을 조작해도)
        W.row('db-1').click();
        assert.ok(W.$('#ceName').classList.contains('hidden') && W.$('#ceFixed').textContent === '공식 하나', '공식 과제 이름이 글자로만 보이지 않는다');
        W.ev("$('#ceName').classList.remove('hidden'); $('#ceName').value = '조작'; $('#ceDesc').value = '공식 메모';");
        W.$('#ceSave').click();
        assert.strictEqual(W.ev("catById('db-1').name"), '공식 하나', '공식 과제 이름이 바뀌었다(이름은 회사 DB 소유)');
        assert.strictEqual(W.ev("catById('db-1').desc"), '공식 메모', '공식 과제 메모가 저장되지 않았다');
      });
    },
    //  합치기(D6): 확인창 없음 · 체크하면 일반은 삭제, 공식은 빼기 · 기본 과제는 체크 없음 · 기본값 꺼짐
    async mergeAfter(source) {
      await withBoot(source, async (W) => {
        W.item('c-e', 'edit'); W.ev('catMenuClose(false)');
        //  기본 과제: 데이터를 하나 주고 합치기 창 열기 → 체크 없음
        W.ev("addEntry({ date:'2026-10-03', title:'휴가 기록', categoryId:'c-v' }); renderCatModal();");
        W.item('c-v', 'merge').click();
        assert.ok(W.open('catMoveModal'), '합치기 창이 열리지 않았다');
        assert.ok(W.$('#cmvAfterWrap').classList.contains('hidden'), '기본 과제의 합치기 창에 체크가 있다(D6)');
        W.ev("closeModal('#catMoveModal')");
        //  일반 과제 + 체크 → 합친 뒤 삭제
        W.clear();
        W.item('c-p', 'merge').click();
        assert.strictEqual(W.$('#cmvAfterLb').textContent, '합친 뒤 이 과제 삭제');
        assert.ok(!W.$('#cmvAfterWrap').classList.contains('hidden') && W.$('#cmvAfter').checked === false, '체크가 안 보이거나 기본값이 켜져 있다');
        W.ev("$('#cmvTarget').value = 'c-e'; $('#cmvTarget').dispatchEvent(new Event('change')); $('#cmvAfter').checked = true; $('#cmvRun').click();");
        await settle();
        assert.strictEqual(W.confirms().length, 0, '합치기 창이 확인인데 확인창을 또 띄웠다(D6)');
        assert.ok(!W.ids().includes('c-p'), '체크했는데 일반 과제가 지워지지 않았다');
        assert.strictEqual(W.ev("entryById('e-p').categoryId"), 'c-e', '일정이 합칠 과제로 옮겨지지 않았다');
        assert.strictEqual(W.ev("todoById('t-p').categoryId"), 'c-e', '할 일이 합칠 과제로 옮겨지지 않았다');
        assert.ok(!W.open('catMoveModal'), '합친 뒤 창이 닫히지 않았다');
        //  공식 과제 + 체크 → 합친 뒤 빼기
        W.item('db-1', 'merge').click();
        assert.strictEqual(W.$('#cmvAfterLb').textContent, '합친 뒤 내 캘린더에서 빼기');
        W.ev("$('#cmvTarget').value = 'c-e'; $('#cmvTarget').dispatchEvent(new Event('change')); $('#cmvAfter').checked = true; $('#cmvRun').click();");
        await settle();
        assert.ok(!W.ids().includes('db-1'), '체크했는데 공식 과제가 내 캘린더에서 빠지지 않았다');
        assert.strictEqual(W.ev("entryById('e-1').categoryId"), 'c-e');
        assert.strictEqual(W.confirms().length, 0);
      });
    },
    //  빼기(D7): 사용 중이면 꺼짐 · 0건이면 묻지 않고 바로 · 과제별 시간이 있을 때만 확인
    async unsubNow(source) {
      await withBoot(source, async (W) => {
        assert.strictEqual(W.item('db-1', 'unsub').disabled, true, '사용 중인 공식 과제의 빼기가 켜져 있다');
        W.item('db-1', 'unsub').click();
        await settle();
        assert.ok(W.ids().includes('db-1'), '사용 중인 공식 과제가 빠졌다');
        W.item('db-2', 'unsub').click();
        await settle();
        assert.strictEqual(W.confirms().length, 0, '시간 기록이 없는데 빼기 전에 물었다(D7)');
        assert.ok(!W.ids().includes('db-2'), '데이터 없는 공식 과제가 바로 빠지지 않았다');
        assert.strictEqual(W.saves(), 1, '빼기가 한 번의 저장으로 나가지 않았다');
        assert.ok(W.toasts().includes("'공식 둘'을(를) 내 캘린더에서 뺐습니다"), '빼기 결과 토스트가 다르다: ' + JSON.stringify(W.toasts()));
      });
      //  과제별 시간만 있으면 그때만 묻는다(시간이 함께 지워진다)
      const withHours = Object.assign({}, DATA, { taskHours: { '2026-10-01': { 'db-2': 2 } } });
      await withBoot(source, async (W) => {
        W.item('db-2', 'unsub').click();
        await settle();
        const cf = W.confirms();
        assert.ok(cf.length === 1 && /과제별 시간 1일이 함께 지워집니다/.test(cf[0][1]), '시간 기록이 있는데 묻지 않았다: ' + JSON.stringify(cf));
        assert.ok(!W.ids().includes('db-2'));
      }, withHours);
    },
    //  순서 메뉴(맨 위로 등)는 moveCategory 를 한 번 거쳐 저장 한 번
    async orderViaMoveCategory(source) {
      await withBoot(source, async (W) => {
        W.ev("window.__mc = 0; (function(){ var f = moveCategory; moveCategory = function(){ window.__mc++; return f.apply(this, arguments); }; })();");
        W.item('c-e', 'top').click();
        await settle();
        assert.strictEqual(W.ids()[0], 'c-e', '「맨 위로」가 맨 위로 옮기지 않았다');
        assert.strictEqual(W.ev('window.__mc'), 1, '「맨 위로」가 moveCategory 를 한 번 거치지 않았다(관문, 저장 1회)');
        assert.strictEqual(W.saves(), 1, '여러 칸 옮겼는데 저장이 한 번이 아니다');
        assert.deepStrictEqual(W.$$('#catList .cat-row').map((r) => r.dataset.id), W.ids(), '화면 순서가 state 와 다르다');
      });
    },
    //  과제 추가 창 공식 탭: 표 줄, 그룹, 펼침, [추가] 뒤 그 줄만 「✓ 내 과제」, 창은 열린 채, 이번에 n개 추가
    async addOfficial(source) {
      await withBoot(source, async (W) => {
        W.$('#btnCatAdd').click();
        assert.ok(W.open('catAddModal'), '[＋ 과제 추가] 가 추가 창을 열지 않았다');
        assert.strictEqual(W.$('#caTabOff').getAttribute('aria-selected'), 'true', '처음 탭이 공식 과제가 아니다(D9)');
        assert.ok(!W.$('#caPaneOff').hidden && W.$('#caPaneOwn').hidden, '공식 탭 칸이 보이지 않는다');
        assert.ok(W.$('#caAddOwn').classList.contains('hidden'), '공식 탭에 일반 탭의 [추가] 가 보인다(D16)');
        const rows = () => W.$$('#caList .ca-r').map((r) => r.dataset.caid);
        assert.deepStrictEqual(rows().sort(), ['db-1', 'db-2', 'db-3', 'db-4'], '표 줄이 카탈로그와 다르다');
        //  그룹 순서는 offGroups(코드 순서, 코드표가 없으면 가나다)와 같다
        assert.deepStrictEqual(W.$$('#caList .ca-g').map((g) => g.dataset.casec), ['선진행', '일반계약'], '구분 그룹 머리줄이 다르다(D10)');
        assert.ok(W.$('#caList .ca-h'), '표 머리줄이 없다');
        assert.strictEqual(W.$('#caCount').textContent, '4 / 4건');
        const act = (id) => W.$('#caList .ca-r[data-caid="' + id + '"] .ca-act');
        assert.strictEqual(act('db-1').textContent, '✓ 내 과제', '이미 있는 과제가 「✓ 내 과제」가 아니다(D12)');
        assert.strictEqual(act('db-3').textContent, '추가');
        //  줄을 누르면 아래로 펼친다(사업명, 개발시작, 개발종료)
        const r3 = W.$('#caList .ca-r[data-caid="db-3"]'), x3 = r3.nextElementSibling;
        assert.ok(x3.hidden && r3.getAttribute('aria-expanded') === 'false');
        r3.click();
        assert.ok(!x3.hidden && r3.getAttribute('aria-expanded') === 'true', '줄을 눌렀는데 펼쳐지지 않았다(D13)');
        assert.ok(/사업명사업 공식 셋/.test(x3.textContent) && /개발시작2026-02-01/.test(x3.textContent) && /개발종료미정/.test(x3.textContent), '펼침 내용이 다르다: ' + x3.textContent);
        W.key(r3, 'Enter');
        assert.ok(x3.hidden, 'Enter 로 접히지 않았다');
        //  [추가]: 내 캘린더로, 그 줄만 바뀐다(다른 줄 노드는 그대로), 창은 열린 채
        const r4 = W.$('#caList .ca-r[data-caid="db-4"]');
        W.clear();
        W.$('#caList [data-caadd="db-3"]').click();
        await settle();
        assert.ok(W.ids().includes('db-3'), '[추가] 가 내 캘린더에 넣지 않았다');
        assert.ok(W.open('catAddModal'), '[추가] 뒤 창이 닫혔다(연달아 추가해야 한다, D12)');
        assert.strictEqual(act('db-3').textContent, '✓ 내 과제', '추가한 줄이 「✓ 내 과제」로 바뀌지 않았다');
        assert.strictEqual(W.$('#caList .ca-r[data-caid="db-4"]'), r4, '[추가] 뒤 표를 통째로 다시 그렸다(스크롤 자리가 날아간다)');
        assert.strictEqual(W.$('#caAdded').textContent, '이번에 1개 추가', '하단 상태가 다르다(D16)');
        assert.strictEqual(W.saves(), 1, '추가가 한 번의 저장으로 나가지 않았다');
        assert.ok(W.row('db-3'), '내 과제 목록에 새 과제 줄이 없다');
        assert.strictEqual(W.ev("catById('db-3').color"), W.ev('sectionColor(2)'), '추가한 공식 과제의 색이 구분 색 초기값이 아니다(D12)');
        W.$('#caList [data-caadd="db-4"]').click();
        assert.strictEqual(W.$('#caAdded').textContent, '이번에 2개 추가');
        //  그룹 머리줄을 누르면 접힌다
        W.$('#caList .ca-g[data-casec="선진행"]').click();
        assert.ok(!W.$('#caList .ca-r[data-caid="db-3"]'), '그룹을 눌렀는데 접히지 않았다');
        assert.strictEqual(W.$('#caList .ca-g[data-casec="선진행"]').getAttribute('aria-expanded'), 'false');
        W.$('#caList .ca-g[data-casec="선진행"]').click();
        //  검색: 계약명으로 찾는다 · 없으면 짧은 빈 상태
        W.$('#caSearch').value = '계약 3'; W.$('#caSearch').dispatchEvent(new W.w.Event('input', { bubbles: true }));
        assert.deepStrictEqual(rows(), ['db-3'], '계약명 검색이 다르다');
        W.$('#caSearch').value = '없는 과제'; W.$('#caSearch').dispatchEvent(new W.w.Event('input', { bubbles: true }));
        assert.strictEqual(W.$('#caList').textContent, '조건에 맞는 공식 과제가 없습니다.');
      });
      //  연결이 끊겼으면(카탈로그 비어 있음) 연결 안 됨 상태
      await withBoot(source, async (W) => {
        W.ev("openCatAdd()");
        assert.strictEqual(W.$('#caList').textContent, '서버에 연결되지 않아 공식 과제를 불러올 수 없습니다.', '연결 안 됨 빈 상태가 다르다');
      }, DATA, null);
    },
    //  일반 탭: 이름, 색상, 메모 · [추가] 하면 창이 닫히고 목록에 · 빈 이름 거절 · [닫기] 는 두 탭에서 같은 자리
    async addOwn(source) {
      await withBoot(source, async (W) => {
        W.$('#btnCatAdd').click();
        const foot = W.$('#catAddModal .modal-foot');
        const closeBtn = foot.querySelector('[data-close]');
        assert.strictEqual(foot.firstElementChild, closeBtn, '공식 탭 하단 첫 자리가 [닫기] 가 아니다');
        W.$('#caTabOwn').click();
        assert.strictEqual(W.$('#caTabOwn').getAttribute('aria-selected'), 'true');
        assert.ok(W.$('#caPaneOff').hidden && !W.$('#caPaneOwn').hidden, '일반 탭 칸이 보이지 않는다');
        assert.ok(!W.$('#caAddOwn').classList.contains('hidden') && W.$('#caAdded').classList.contains('hidden'), '일반 탭 하단이 [추가] 가 아니다(D16)');
        assert.strictEqual(foot.firstElementChild, closeBtn, '일반 탭 하단 첫 자리가 [닫기] 가 아니다(같은 자리, D16)');
        assert.ok(!/공식/.test(W.$('#caPaneOwn').textContent), '일반 탭에 공식 과제 목록이나 안내가 나온다(D15)');
        W.$('#caName').value = '   '; W.$('#caAddOwn').click();
        assert.ok(W.toasts().includes('과제 이름을 입력하세요') && W.open('catAddModal'), '빈 이름을 막지 않았다');
        W.$('#caName').value = '새 일반'; W.$('#caDesc').value = '새 메모';
        W.$('#caPalette .swatch:not(.on)').click();
        const color = W.ev("palValue($('#caPalette'))");
        W.$('#caAddOwn').click();
        await settle();
        const c = W.evJSON("state.categories.find(function(c){ return c.name === '새 일반'; })");
        assert.ok(c && c.desc === '새 메모' && c.color === color && !c.source, '일반 과제가 이름, 메모, 색으로 추가되지 않았다: ' + JSON.stringify(c));
        assert.ok(!W.open('catAddModal'), '일반 과제를 추가했는데 창이 닫히지 않았다(D16)');
        assert.ok(W.row(c.id), '내 과제 목록에 새 줄이 없다');
        assert.strictEqual(W.row(c.id).querySelector('.cat-kind').textContent, '일반');
      });
    },
    //  근태 창의 「캘린더에 새 과제 만들기」(호스트가 __attendCatNew 를 부른다) = 과제 추가 창 일반 탭
    async attendEntry(source) {
      await withBoot(source, async (W) => {
        W.ev("closeModal('#categoryModal')");
        W.ev('__attendCatNew()');
        assert.ok(W.open('categoryModal') && W.open('catAddModal'), '근태 창 진입이 과제 추가 창을 열지 않았다');
        assert.strictEqual(W.$('#caTabOwn').getAttribute('aria-selected'), 'true', '근태 창 진입이 일반 과제 탭이 아니다');
      });
    },
    //  긴 이름(D14): 두 줄을 넘으면 앞부분 … 끝 8자 · 원래 이름은 data-full · 들어가면 그대로
    async fitName(source) {
      await withBoot(source, async (W) => {
        const full = '2026년 차세대 통합 관제 시스템 고도화 및 대외 연동 인터페이스 개선 과제 (1차 사업)';
        const tail = full.slice(-8);
        W.ev(`(function(){
          var el = document.createElement('span'); el.className = 'cat-nm'; el.dataset.full = ${JSON.stringify(full)}; el.id = 'fitProbe';
          document.body.appendChild(el);
          Object.defineProperty(el, 'clientHeight', { get: function(){ return 40; } });
          Object.defineProperty(el, 'scrollHeight', { get: function(){ return el.textContent.length > 24 ? 80 : 40; } });
          catFitName(el);
        })()`);
        const out = W.$('#fitProbe').textContent;
        assert.ok(out.length <= 24 && out.includes('…'), '두 줄을 넘는 이름을 줄이지 않았다: ' + out);
        assert.ok(out.endsWith(tail), '줄인 이름이 끝 8자를 남기지 않는다: ' + out);
        assert.ok(full.startsWith(out.slice(0, out.indexOf('…')).trimEnd()), '앞부분이 원래 이름의 앞이 아니다: ' + out);
        assert.strictEqual(W.$('#fitProbe').dataset.full, full, '원래 이름(data-full)이 바뀌었다');
        W.ev("(function(){ var el = document.getElementById('fitProbe'); el.dataset.full = '짧은 이름'; catFitName(el); })()");
        assert.strictEqual(W.$('#fitProbe').textContent, '짧은 이름', '들어가는 이름을 바꿨다');
      });
    },
  };

  test('런타임①: 목록 줄 구조 · 구분 열(일반, 공식, 삭제됨, 기본) · 건수 · 메모 줄 · 연결 버튼은 일반 과제가 있을 때만', () => checks.listRows(src));
  test('런타임②: ⋯ 메뉴 항목이 과제 종류마다 맞다 · 한 번에 하나 · 화살표 · Esc 는 메뉴만 · 바깥 클릭', () => checks.menuItems(src));
  test('런타임③: 줄을 누르면 수정 창(⋯, ⠿ 는 아님) · 줄에서 Enter · ⋯ 의 수정', () => checks.rowOpensEdit(src));
  test('런타임④: 수정 저장 — 일반 이름 바꾸기(줄바꿈은 공백), 같은 이름과 빈 이름 거절, 공식 과제 이름 불변', () => checks.editSave(src));
  test('런타임⑤: 합치기 — 확인창 없음, 체크하면 일반 삭제, 공식 빼기, 기본 과제는 체크 없음', () => checks.mergeAfter(src));
  test('런타임⑥: 빼기 — 사용 중이면 꺼짐, 0건이면 바로, 과제별 시간이 있을 때만 묻는다', () => checks.unsubNow(src));
  test('런타임⑦: 순서 메뉴는 moveCategory 를 한 번 거쳐 저장 한 번', () => checks.orderViaMoveCategory(src));
  test('런타임⑧: 추가 창 공식 탭 — 표, 그룹, 펼침, [추가] 뒤 그 줄만 「✓ 내 과제」, 창은 열린 채, 연결 안 됨 상태', () => checks.addOfficial(src));
  test('런타임⑨: 추가 창 일반 탭 — 추가 뒤 창이 닫힘, [닫기] 는 같은 자리, 빈 이름 거절', () => checks.addOwn(src));
  test('런타임⑩: 근태 창의 새 과제 만들기는 과제 추가 창을 일반 과제 탭으로 연다', () => checks.attendEntry(src));
  test('런타임⑪: 긴 이름은 앞부분 … 끝 8자(두 줄을 넘을 때만)', () => checks.fitName(src));

  //  (c) 변이 — 되돌아가면 안 되는 판을 만들고 같은 검사가 잡는지 본다
  test('변이①: 빼기를 늘 확인창으로 되돌리면 런타임⑥ 이 실패한다', async () => {
    const bad = mutate("  if(hrs && await confirmBox('내 캘린더에서 빼기',", "  if(await confirmBox('내 캘린더에서 빼기',", src);
    await assert.rejects(() => checks.unsubNow(bad), /묻었다|물었다/);
  });
  test('변이②: 공식 과제 [추가] 뒤 창을 닫으면 런타임⑧ 이 실패한다', async () => {
    const bad = mutate("  toast(`'${src.name}'을(를) 내 캘린더에 추가했습니다`, 'success');\n  return true;",
      "  closeModal('#catAddModal');\n  toast(`'${src.name}'을(를) 내 캘린더에 추가했습니다`, 'success');\n  return true;", src);
    await assert.rejects(() => checks.addOfficial(bad), /창이 닫혔다/);
  });
  test('변이③: 줄 클릭이 수정 창을 열지 않으면 런타임③ 이 실패한다', async () => {
    const bad = mutate('      if(row) openCatEdit(row.dataset.id);\n', '', src);
    await assert.rejects(() => checks.rowOpensEdit(bad), /수정 창이 열리지 않았다/);
  });
  test('변이④: 끝 8자 보존을 빼면 런타임⑪ 이 실패한다', async () => {
    const bad = mutate("const catEllipsize = (full, k) => full.slice(0, k).trimEnd() + '…' + full.slice(-CAT_NAME_TAIL);",
      "const catEllipsize = (full, k) => full.slice(0, k).trimEnd() + '…';", src);
    await assert.rejects(() => checks.fitName(bad), /끝 8자/);
  });
  test('변이⑤: 일반 과제 추가 뒤 창을 닫지 않으면 런타임⑨ 가 실패한다', async () => {
    const bad = mutate("  addCategory(name, palValue($('#caPalette')), $('#caDesc').value.trim());\n  closeModal('#catAddModal');\n",
      "  addCategory(name, palValue($('#caPalette')), $('#caDesc').value.trim());\n", src);
    await assert.rejects(() => checks.addOwn(bad), /창이 닫히지 않았다/);
  });
  test('변이⑥: 합치기 체크를 무시하면 런타임⑤ 가 실패한다', async () => {
    const bad = mutate("after = kind !== 'default' && $('#cmvAfter').checked;", "after = false;", src);
    await assert.rejects(() => checks.mergeAfter(bad), /지워지지 않았다|빠지지 않았다/);
  });
  test('변이⑦: 공식 과제 수정이 이름 칸을 읽으면 런타임④ 가 실패한다', async () => {
    const bad = mutate('  if(isOfficialCat(c)) updateOfficialLocalFields(id, desc, color);\n  else if(isDefaultTask(c))',
      "  if(isOfficialCat(c)){ updateOfficialLocalFields(id, desc, color); c.name = catNameClean($('#ceName').value) || c.name; }\n  else if(isDefaultTask(c))", src);
    await assert.rejects(() => checks.editSave(bad), /공식 과제 이름이 바뀌었다/);
  });
  test('변이⑧: 메뉴가 기본 과제에도 삭제를 주면 런타임② 가 실패한다', async () => {
    const bad = mutate("  }else if(kind === 'personal'){\n    h += sep + item('del', '삭제…', { cls: 'danger' });", "  }else{\n    h += sep + item('del', '삭제…', { cls: 'danger' });", src);
    await assert.rejects(() => checks.menuItems(bad), /기본 과제 메뉴/);
  });
}
