// 관심 과제(다른 과제 보기 2차) 계약: docs/PC-WATCH-2.md §1~4, §6. 날짜 패널 묶음 접기(§5)는 tests/day-panel-fold.test.mjs.
// 시안: dist/proto/pc-scope-v2.html(D안, 왼쪽 목록 두 탭), dist/proto/pc-watch-v11.html(참여자 필터 = 개인 보기 팝업).
//
// 이 파일이 지키는 것:
//   (S) 정적: 화면 글자에 "보기만", "다른 과제 보기", "보는 중"(사람 고르기의 "(보는 중)" 하나만 남음)이 없다. 관심 과제는 구분 색(sectionColor)을 쓰지 않고
//       회색 토큰 하나(PC_WATCH_C), 빈 동그라미는 CSS 클래스 하나(.pc-ring, 토큰만). 호스트 MsgWatchFull 글자. 공용 고르기 목록을 개인 보기 팝업과 [참여자]가 같이 쓴다.
//   (R) jsdom:
//       관심 과제 회색과 빈 동그라미(왼쪽 목록, 주간 과제 줄, 날짜 팝업 과제 머리, 상세 창 머리), 내 과제는 색점 그대로, 점선 일정은 회색 토큰.
//       왼쪽 두 탭: 탭은 목록만 바꾸고 달력은 두 탭 체크의 합, 탭 기억(pcPrefs side, 옛 값은 내 과제), 키보드(좌우), 서랍(좁은 폭)도 같은 탭, 관심 과제 0개면 빈 안내와 추가 단추.
//       개인 보기 팝업은 공용 함수로 옮긴 뒤에도 마크업, 클래스, id, aria, 키보드가 같다.
//   (M) 변이: 관심 과제에 구분 색을 되살리거나, 탭이 달력까지 거르거나, 개인 보기 팝업 출처가 바뀌면 위 시험이 잡는다.
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM, readText } from './harness.mjs';

const R = (p) => new URL('../' + p, import.meta.url);
const src = loadAppSource();
const pcdb = readText(R('widget/ProjectCalendarDb.cs'));
const css = src.slice(0, src.indexOf('</style>'));
function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}
//  주석(HTML, 블록, 줄)을 뺀 글. 화면 글자와 코드만 남긴다
const noComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/\s.*$/, '')).join('\n');

/* ══ (S) 정적 ═══════════════════════════════════════════════════════════ */
test('이름①: 화면 글자에 "보기만", "다른 과제 보기", "보기로 넣었습니다"가 없고 "보는 중"은 사람 고르기의 "(보는 중)" 하나다', () => {
  const live = noComments(src);
  for (const gone of ['보기만', '다른 과제 보기', '보기로 넣었습니다', '보기 목록에서', '✓ 보는 중']) assert.ok(!live.includes(gone), `옛 이름 "${gone}" 이 화면 글자에 남았다`);
  assert.strictEqual((live.match(/보는 중/g) || []).length, 1, '"보는 중"이 사람 고르기 말고도 있다');
  assert.ok(extractFunction(src, 'pkRowEl').includes("' (보는 중)'"), '사람 고르기(다른 사람 일정 보기)의 "(보는 중)"이 사라졌다(다른 기능이라 그대로여야 한다)');
  for (const t of ["'관심 과제 추가' : '과제 추가'", "'개를 관심 과제로 넣었습니다'", '＋ 관심 과제 추가', "'관심 과제라 고칠 수 없습니다. 참여자만 고칩니다.'", 'title="누르면 관심 과제에서 뺍니다">✓ 관심 과제<']) {
    assert.ok(src.includes(t), `새 이름 글자 ${t} 가 없다`);
  }
});
test('이름②: 호스트 MsgWatchFull 은 "관심 과제는 50개까지 넣을 수 있습니다. 쓰지 않는 과제를 목록에서 빼세요."', () => {
  assert.ok(pcdb.includes('internal const string MsgWatchFull = "관심 과제는 50개까지 넣을 수 있습니다. 쓰지 않는 과제를 목록에서 빼세요.";'), 'MsgWatchFull 글자가 기획과 다르다');
});
test('모양①: 관심 과제는 구분 색(sectionColor)을 쓰지 않고 회색 토큰 하나, 색점 자리는 빈 동그라미 클래스 하나(토큰만)', () => {
  const f = extractFunction(src, 'pcWatchFromDto');
  assert.ok(!/sectionColor/.test(f) && /color: PC_WATCH_C/.test(f), '관심 과제 색이 회색 토큰(PC_WATCH_C)이 아니다');
  assert.ok(/const PC_WATCH_C = 'var\(--[a-z-]+\)';/.test(src), 'PC_WATCH_C 가 CSS 토큰이 아니다(하드코딩 색 금지)');
  assert.ok(extractFunction(src, 'pcDotCls').includes("p.mine === false ? ' pc-ring' : ''"), '빈 동그라미를 관심 과제(mine:false)로 가르지 않는다');
  const ring = css.split('\n').filter((l) => /pc-ring/.test(l));
  assert.ok(ring.length >= 2 && ring.every((l) => !/#[0-9a-fA-F]{3,8}\b/.test(l)) && ring.some((l) => /background:none/.test(l) && /border:1\.5px solid var\(--/.test(l)), '빈 동그라미 CSS 가 토큰만 쓰는 테두리 원이 아니다');
  //  관심 과제 일정은 옅은 배경(--cb)을 만들지 않는다(바탕은 CSS 의 흰 바탕)
  assert.ok(extractFunction(src, 'pcEvHtml').includes("(p.mine === false ? '' : '--cb:' + tint(p.color, .2) + ';')"), '관심 과제 일정이 색 배경을 만든다');
});
test('공용①: 개인 보기 팝업은 공용 고르기 목록 함수(fbListMarkup, fbFill, fbListKey, fbListClick), [참여자]는 그 겉(fbHeadMarkup, fbPopEdgeKey)과 사람 고르기 조직도(§7.3)', () => {
  assert.ok(extractFunction(src, 'filterPopOpen').includes("fbListMarkup('fbList', '과제 검색', '과제')"), '개인 보기 팝업이 공용 목록 마크업을 쓰지 않는다');
  assert.ok(/FB\.src = FB_SRC;/.test(src) && /idp: 'fbo-'/.test(src), '개인 보기 팝업의 출처(FB_SRC, 항목 id fbo-)가 아니다');
  for (const [fn, inner] of [['filterFillList', 'fbFill(FB, initial)'], ['filterSetAct', 'fbSetAct(FB, i, scroll)'], ['filterPickOpt', 'fbPick(FB, o)']]) {
    assert.ok(extractFunction(src, fn).includes(inner), `${fn} 가 공용 함수(${inner})를 부르지 않는다`);
  }
  const bf = extractFunction(src, 'bindFilterbar');
  assert.ok(bf.includes('fbListClick(FB, t)') && bf.includes('fbPopKey(FB, ev, filterPopClose)') && bf.includes('fbListInput(FB)'), '개인 보기 팝업의 누름, 키, 찾기가 공용 함수가 아니다');
  //  2차(§7.3): [참여자] 겉은 개인 보기 팝업의 찾기 칸과 전체 선택/해제(fbHeadMarkup), Esc 와 Tab(fbPopEdgeKey). 속은 다른 사람 일정 보기 조직도
  const who = extractFunction(src, 'caWhoOpen');
  assert.ok(who.includes("fbHeadMarkup('caWhoBody', '이름 찾기')") && extractFunction(src, 'caWhoKey').includes('fbPopEdgeKey(CAWP, ev, caWhoClose)'), '[참여자]가 개인 보기 팝업의 겉을 쓰지 않는다');
  assert.ok(extractFunction(src, 'fbListMarkup').includes('fbHeadMarkup(id, ph)') && extractFunction(src, 'fbPopKey').includes('fbPopEdgeKey(S, ev, close)'), '개인 보기 팝업과 [참여자]가 같은 겉 함수를 쓰지 않는다');
  assert.ok(/pkRenderOrg\(body, P\.wide, P,/.test(extractFunction(src, 'caWhoRender')) && /pkOrgIndex\(r\.data\.units, CAW\.members, pkMe\(\)\)/.test(extractFunction(src, 'caRosterLoad')), '[참여자] 속이 사람 고르기와 같은 명부, 조직 색인(pkOrgIndex), 조직도(pkRenderOrg)가 아니다');
  assert.ok(!/idp: 'cwo-'|CAW_WHO_SRC/.test(src), '1차의 평평한 팀 목록(CAW_WHO_SRC)이 남았다');
});
test('탭①: 고른 탭은 과제 탭 설정(pcPrefsSave)에 같이 기억하고 옛 저장값은 내 과제', () => {
  assert.ok(extractFunction(src, 'pcPrefsSave').includes('side: PCAL.side'), '탭을 과제 탭 설정에 기억하지 않는다');
  assert.ok(extractFunction(src, 'pcPrefsNorm').includes("side: o.side === 'watch' ? 'watch' : 'mine'"), '옛 저장값의 탭이 내 과제가 아니다');
  assert.ok(extractFunction(src, 'pcResetFor').includes('side: p.side'), '계정을 바꿀 때 탭을 되살리지 않는다');
});

/* ══ (R) jsdom ═════════════════════════════════════════════════════════ */
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('pc-watch-2: jsdom 미설치, 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  function fakeClock() {
    let seq = 0, now = 0;
    const timers = new Map();
    return {
      setTimeout(fn, d, ...args) { const id = ++seq; timers.set(id, { fn, args, at: now + (Number(d) || 0) }); return id; },
      clearTimeout(id) { timers.delete(id); },
      advance(ms) {
        const end = now + ms;
        for (;;) {
          let best = null;
          for (const [id, t] of timers) if (t.at <= end && (best === null || t.at < timers.get(best).at)) best = id;
          if (best === null) { now = end; return; }
          const t = timers.get(best); timers.delete(best); now = t.at;
          try { t.fn(...t.args); } catch (_) { /* 앱의 일 */ }
        }
      },
    };
  }
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const P1 = '11111111-1111-4111-8111-111111111111', P3 = '33333333-3333-4333-8333-333333333333';
  const B1 = 'bbbbbbbb-0000-4000-8000-000000000001', B2 = 'bbbbbbbb-0000-4000-8000-000000000002';
  const U = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const META = { schemaVersion: '21', expectedSchema: '21', schemaMismatch: false, gate: 'ok', rev: 1, canWrite: true, userId: 7 };
  const DATA = () => ({
    categories: [{ id: 'c-1', name: '휴가', color: '#9aa2b3' }, { id: 'db-' + P1, name: '장비 개발', color: '#3e5be0' }],
    entries: [{ id: 'e-1', date: today(), title: '휴가 일정', categoryId: 'c-1', allDay: true, startTime: '', endTime: '', endDate: '', memo: '', location: '', recur: null, recurExcept: [] }],
    todos: [], rooms: [] });
  const MINE = [
    { projectUid: P1, name: '장비 개발', color: '#3e5be0', active: true, writable: true, mine: true, members: 6 },
    { projectUid: P3, name: '구형 유지', color: '#8a5cc8', active: false, writable: false, mine: true, members: 2 },
  ];
  const WATCH = [
    { projectUid: B1, name: '함대공 훈련장비', customer: 'D사', status: '진행중', statusId: 1, sectionId: 1, members: 2, hidden: false },
    { projectUid: B2, name: '숨겨진 표본', customer: 'E사', status: '진행중', statusId: 1, sectionId: 1, members: 0, hidden: true },
  ];
  const EV = (n, projectUid, o = {}) => Object.assign({ eventUid: U(n), projectUid, title: '일정 ' + n, startDate: today(), endDate: today(), startTime: null, endTime: null,
    location: '', memo: '', rowVersion: 1, deleted: false, createdBy: '홍길동', updatedBy: '홍길동', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' }, o);

  async function boot({ source = src, narrow = false, prefs = null } = {}) {
    const clock = fakeClock();
    const posts = [];
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quietConsole(),
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posts.push(o || {}); }, addEventListener() {}, removeEventListener() {} } };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.setTimeout = clock.setTimeout; win.clearTimeout = clock.clearTimeout;
        //  좁은 폭(과제 탭 서랍)은 pcNarrow 의 matchMedia 로만 정한다
        if (narrow) win.matchMedia = (q) => ({ matches: /max-width:760px/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        if (prefs) win.localStorage.setItem('tc_pcal:hjlee', JSON.stringify(prefs));
      },
    });
    const w = dom.window, doc = w.document;
    const W = {
      w, doc, clock, posts,
      ev: (c) => w.eval(c),
      el: (id) => doc.getElementById(id),
      q: (s) => doc.querySelector(s), qa: (s) => [...doc.querySelectorAll(s)],
      cmds: (cmd) => posts.filter((p) => p.cmd === cmd),
      last: (cmd) => [...posts].reverse().find((p) => p.cmd === cmd && p.reqId && !p.__done),
      async reply(cmd, res) {
        const p = W.last(cmd);
        assert.ok(p, `${cmd} 요청이 나가지 않았다`);
        p.__done = true;
        w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify(res) + ')');
        await settle();
      },
      async click(sel) { const e = typeof sel === 'string' ? doc.querySelector(sel) : sel; assert.ok(e, `누를 것(${sel})이 없다`); e.click(); await settle(); clock.advance(150); await settle(); },
      async key(el, key) { el.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true })); await settle(); },
      close: () => { try { w.close(); } catch (_) {} },
    };
    await settle();
    await W.reply('userSessionGet', { ok: true, user: { loginId: 'hjlee', name: '이현진' } });
    w.eval('__applyState(' + JSON.stringify(JSON.stringify(DATA())) + ',' + JSON.stringify(META) + ')');
    await settle(); clock.advance(5); await settle();
    for (const p of posts.filter((x) => x.cmd === 'saveState' && x.reqId && !x.__done)) { p.__done = true; w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',{"ok":true})'); }
    await settle();
    return W;
  }
  async function withBoot(opts, fn) { const W = await boot(opts); try { return await fn(W); } finally { W.close(); } }
  async function enter(W, { events = [], watch = WATCH, mine = MINE } = {}) {
    await W.click('#pcTabProject');
    await W.reply('projectCalendarBootstrap', { ok: true, data: { projects: mine, limits: { title: 200, location: 200, memo: 8000 } } });
    await W.reply('pcWatchList', { ok: true, data: { projects: watch, max: 50 } });
    await loadReply(W, events);
  }
  async function loadReply(W, events) {
    const p = W.last('projectCalendarLoad');
    if (!p) return;
    p.__done = true;
    const ps = (p.projectUids || []).map((u) => ({ projectUid: u, writable: u === P1, mine: u === P1 || u === P3 }));
    W.w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify({ ok: true, data: { projects: ps, events, excluded: [], from: p.from, to: p.to } }) + ')');
    await settle();
  }
  //  jsdom 의 월간 칸은 한 칸에 일정 하나만 그리므로 관심 과제 일정은 다른 주(달력 범위 안의 7일 뒤 또는 앞)에 둔다
  const otherDay = (W) => { const rg = W.ev('pcRange()'); let d2 = W.ev('addDays(todayYmd(), 7)'); if (d2 > rg.to) d2 = W.ev('addDays(todayYmd(), -7)'); return d2; };
  const tabs = (W) => W.qa('#pcView .pc-stabs [role="tab"]').map((t) => [t.textContent.replace(/\s+/g, ''), t.getAttribute('aria-selected'), t.tabIndex]);

  test('모양②: 관심 과제는 회색 빈 동그라미와 회색 점선 일정(왼쪽 목록, 주간 과제 줄, 날짜 팝업 과제 머리, 상세 창 머리), 내 과제는 색점 그대로', () => withBoot({}, async (W) => {
    const d2 = otherDay(W), evs = [EV(1, P1), EV(2, B1, { startDate: d2, endDate: d2 }), EV(3, B1)];
    await enter(W, { events: evs });
    //  왼쪽 목록: 내 과제 색점, 관심 과제 빈 동그라미
    const mineDot = W.q(`#pcView .pc-row input[data-uid="${P1}"]`).closest('.pc-row').querySelector('.pc-dot');
    assert.ok(mineDot && !mineDot.classList.contains('pc-ring'), '내 과제 색점이 빈 동그라미가 됐다');
    assert.ok(/--c:#3e5be0/.test(W.q(`#pcView .pc-row input[data-uid="${P1}"]`).closest('.pc-row').getAttribute('style')), '내 과제 색이 바뀌었다');
    await W.click('#pcView #pcStab-watch');
    const wRow = W.q(`#pcView .pc-row input[data-uid="${B1}"]`).closest('.pc-row');
    assert.ok(wRow.querySelector('.pc-dot.pc-ring'), '관심 과제 줄의 색점 자리가 빈 동그라미가 아니다');
    assert.ok(/--c:var\(--faint\)/.test(wRow.getAttribute('style')), '관심 과제 줄 색이 회색 토큰이 아니다');
    assert.strictEqual(W.ev(`pcProj("${B1}").color`), 'var(--faint)', '관심 과제 색이 회색 토큰 하나가 아니다(구분 색을 쓴다)');
    //  달력 일정: 회색 점선(옅은 색 배경 없음)
    const wev = W.q(`#pcView .pc-ev[data-ev="${U(2)}"]`), mev = W.q(`#pcView .pc-ev[data-ev="${U(1)}"]`);
    assert.ok(wev && wev.classList.contains('pc-watchev') && /--c:var\(--faint\)/.test(wev.getAttribute('style')) && !/--cb:/.test(wev.getAttribute('style')), '관심 과제 일정이 회색 점선이 아니다');
    assert.ok(mev && !mev.classList.contains('pc-watchev') && /--cb:/.test(mev.getAttribute('style')), '내 과제 일정 모양이 바뀌었다');
    //  날짜 팝업 과제 머리
    W.ev(`pcOpenDayList(todayYmd(), document.querySelector('#pcView .pc-day[data-date="' + todayYmd() + '"]'))`); await settle();
    const heads = W.qa('.pc-dl-g .pc-dl-gh').map((h) => [h.querySelector('.pc-dl-nm').textContent, !!h.querySelector('i.pc-ring'), (h.querySelector('.pc-dl-ro') || {}).textContent || '']);
    assert.deepStrictEqual(heads, [['장비 개발', false, ''], ['함대공 훈련장비', true, '관심 과제']], '날짜 팝업 과제 머리의 빈 동그라미나 이름표가 틀렸다');
    W.ev('pcClosePop(true)');
    //  상세 창 머리
    W.ev(`pcOpenDetail("${U(2)}")`); await settle();
    assert.ok(W.q('#pcDetailBody .pcd-proj .pc-dot.pc-ring') && W.q('#pcDetailBody .pc-ro').textContent === '관심 과제', '상세 창 머리가 빈 동그라미와 "관심 과제"가 아니다');
    W.ev('closeModal("#pcDetailModal")'); await settle(); W.clock.advance(400); await settle();
    //  주간 과제 줄
    await W.click('#pcView [data-act="view"][data-v="week"]');
    await loadReply(W, evs);
    const names = W.qa('#pcView .pc-wname').map((n) => [n.querySelector('.pc-wpn').textContent, !!n.querySelector('.pc-ring'), (n.querySelector('.pc-state') || {}).textContent || '']);
    assert.deepStrictEqual(names, [['장비 개발', false, ''], ['구형 유지', false, '숨긴 과제, 읽기 전용'], ['함대공 훈련장비', true, '관심 과제']], '주간 과제 줄의 빈 동그라미나 이름표가 틀렸다');
  }));

  test('탭②: 탭은 목록만 바꾼다(달력은 두 탭 체크의 합), 좌우 키로 옮기며 연다, 고른 탭을 기억하고 다시 들어오면 그 탭', () => withBoot({}, async (W) => {
    const d2 = otherDay(W);
    await enter(W, { events: [EV(1, P1), EV(2, B1, { startDate: d2, endDate: d2 })] });
    assert.deepStrictEqual(tabs(W), [['내과제2/2', 'true', 0], ['관심과제1/2', 'false', -1]], '처음은 내 과제 탭(로빙 tabindex)');
    const shown = () => W.qa('#pcView .pc-ev').map((e) => e.dataset.ev).sort();
    assert.deepStrictEqual(shown(), [U(1), U(2)], '내 과제 탭에서도 관심 과제 일정이 달력에 있어야 한다');
    const loads = W.cmds('projectCalendarLoad').length;
    await W.key(W.el('pcStab-mine'), 'ArrowRight');
    assert.deepStrictEqual(tabs(W).map((t) => t[1]), ['false', 'true'], '오른쪽 키로 관심 과제 탭이 열리지 않았다');
    assert.strictEqual(W.doc.activeElement && W.doc.activeElement.id, 'pcStab-watch', '키로 옮긴 뒤 포커스가 새 탭이 아니다');
    assert.deepStrictEqual(shown(), [U(1), U(2)], '탭을 바꿨더니 달력이 바뀌었다(탭은 목록만 바꾼다)');
    assert.strictEqual(W.cmds('projectCalendarLoad').length, loads, '탭을 바꾸며 일정을 다시 읽었다');
    assert.strictEqual(W.q('#pcSideList').getAttribute('aria-labelledby'), 'pcStab-watch');
    assert.strictEqual(JSON.parse(W.w.localStorage.getItem('tc_pcal:hjlee')).side, 'watch');
    await W.key(W.el('pcStab-watch'), 'Home');
    assert.deepStrictEqual(tabs(W).map((t) => t[1]), ['true', 'false'], 'Home 이 내 과제 탭이 아니다');
    //  내 과제 탭의 [전체 해제]는 내 과제만 끈다(관심 과제는 달력에 남는다)
    await W.click('#pcView [data-act="selNone"]');
    await loadReply(W, [EV(2, B1, { startDate: d2, endDate: d2 })]);
    const sel = W.ev('PCAL.sel.slice()');
    assert.ok(sel.includes(B1) && !sel.includes(P1) && !sel.includes(P3), '내 과제 탭의 전체 해제가 내 과제만 끄지 않았다: ' + JSON.stringify(sel));
    assert.deepStrictEqual(shown(), [U(2)]);
  }));

  test('탭③: 저장된 탭(관심 과제)으로 들어오고, 옛 저장값(탭 없음)은 내 과제, 관심 과제 0개면 빈 안내 한 줄과 추가 단추', () => withBoot({ prefs: { tab: 'personal', view: 'month', sel: null, known: [], memo: false, side: 'watch' } }, async (W) => {
    await enter(W, { watch: [] });
    assert.deepStrictEqual(tabs(W).map((t) => t[1]), ['false', 'true'], '기억한 관심 과제 탭으로 들어오지 않았다');
    assert.strictEqual(W.q('#pcSideList .pc-empty').textContent, '관심 과제가 없습니다.');
    assert.ok(W.q('#pcSideList .pc-addw') && W.q('#pcSideList [data-act="selAll"], #pcView [data-act="selAll"]').disabled, '관심 과제 0개 탭에 추가 단추가 없거나 전체 선택이 켜져 있다');
    await W.click('#pcSideList .pc-addw');
    assert.strictEqual(W.el('caHead').textContent, '관심 과제 추가');
  }).then(() => withBoot({ prefs: { tab: 'personal', view: 'month', sel: null, known: [], memo: false } }, async (W) => {
    await enter(W);
    assert.deepStrictEqual(tabs(W).map((t) => t[1]), ['true', 'false'], '옛 저장값(탭 없음)이 내 과제 탭이 아니다');
  })));

  test('탭④: 좁은 폭 서랍(pcSideHtml(true))도 같은 두 탭', () => withBoot({ narrow: true }, async (W) => {
    await enter(W, { events: [EV(1, P1)] });
    assert.ok(!W.q('#pcView aside.pc-side'), '좁은 폭인데 옆 목록이 있다');
    await W.click('#pcScope');
    assert.ok(W.q('#pcDrawer .pc-side.in-drawer .pc-stabs'), '서랍에 두 탭이 없다');
    await W.click('#pcDrawer #pcStab-watch');
    assert.ok(W.q('#pcDrawer .pc-list-w') && W.q('#pcDrawer .pc-addw'), '서랍의 관심 과제 탭이 관심 과제 목록이 아니다');
  }));

  test('공용②: 개인 보기 팝업은 공용 함수로 옮긴 뒤에도 마크업, 클래스, id, aria, 키보드가 같다', () => withBoot({}, async (W) => {
    W.ev('renderAll()');
    await W.click('#fbBtn');
    const pop = W.el('fbPop');
    assert.ok(pop && pop.getAttribute('role') === 'dialog' && pop.getAttribute('aria-label') === '달력에 보일 것');
    const q = pop.querySelector('.fb-q'), lb = pop.querySelector('#fbList');
    assert.ok(q && q.getAttribute('placeholder') === '과제 검색' && q.getAttribute('aria-label') === '과제 검색' && q.getAttribute('aria-controls') === 'fbList' && q.getAttribute('role') === 'searchbox');
    assert.ok(lb && lb.classList.contains('fb-opts') && lb.getAttribute('role') === 'listbox' && lb.getAttribute('aria-label') === '과제' && lb.getAttribute('aria-multiselectable') === 'true' && lb.tabIndex === 0);
    assert.deepStrictEqual([...pop.querySelectorAll('.fb-acts .fb-lk')].map((b) => [b.dataset.act, b.textContent]), [['all', '전체 선택'], ['none', '전체 해제']]);
    //  항목 한 줄의 마크업(체크, 색점, 이름, 기록 수)과 id 머리 fbo-, 묶음 머리 없음
    const o = pop.querySelector('.fb-opt');
    assert.ok(/^<div class="fb-opt" role="option" id="fbo-0" data-id="c-1" aria-selected="true" title="휴가, 기록 1건"><span class="fb-ind" aria-hidden="true"><svg[^>]*>.*<\/svg><\/span><span class="dot" style="background:#9aa2b3"><\/span><span class="nm">휴가<\/span><span class="n">1<\/span><\/div>$/.test(o.outerHTML.replace(/ class="act"|(class="fb-opt) act"/, '$1"')), '개인 보기 팝업 항목 마크업이 바뀌었다: ' + o.outerHTML);
    assert.ok(!pop.querySelector('.fb-gh, .fb-car, .fb-sub'), '개인 보기 팝업에 묶음 머리가 생겼다');
    assert.strictEqual(lb.getAttribute('aria-activedescendant'), 'fbo-0');
    //  키보드: 찾기 칸 ↓ 로 목록, Space 로 끄기, Esc 로 닫고 단추로
    await W.key(q, 'ArrowDown');
    assert.strictEqual(W.doc.activeElement, lb);
    await W.key(lb, ' ');
    assert.strictEqual(W.ev('filterCats === null'), false, 'Space 로 과제를 끄지 못했다');
    assert.strictEqual(W.q('#fbList .fb-opt[data-id="c-1"]').getAttribute('aria-selected'), 'false');
    await W.key(lb, 'Escape');
    assert.ok(!W.el('fbPop'), 'Esc 로 닫히지 않았다');
    assert.strictEqual(W.doc.activeElement && W.doc.activeElement.id, 'fbBtn');
  }));

  /* ══ (M) 변이 ═══════════════════════════════════════════════════════ */
  test('변이①: 관심 과제에 구분 색을 되살리면 모양② 가 잡는다', async () => {
    const bad = mutate('color: PC_WATCH_C, active: !hidden,', 'color: validColor(sectionColor(o.sectionId)), active: !hidden,', src);
    const W = await boot({ source: bad });
    try {
      await enter(W, { events: [EV(2, B1)] });
      assert.notStrictEqual(W.ev(`pcProj("${B1}").color`), 'var(--faint)', '변이가 구분 색을 되살리지 못했다(시험이 잡을 차이가 없다)');
    } finally { W.close(); }
  });
  test('변이②: 탭이 달력까지 거르면(pcVisible 이 지금 탭만) 탭② 가 잡는다', async () => {
    const bad = mutate('return pcAll().filter(p => s.has(p.projectUid) && !p.hidden);', 'return pcSideList().filter(p => s.has(p.projectUid) && !p.hidden);', src);
    const W = await boot({ source: bad });
    try {
      const d2 = otherDay(W);
      await enter(W, { events: [EV(1, P1), EV(2, B1, { startDate: d2, endDate: d2 })] });
      assert.ok(!W.q(`#pcView .pc-ev[data-ev="${U(2)}"]`), '변이가 달력을 지금 탭으로 거르지 못했다(시험이 잡을 차이가 없다)');
    } finally { W.close(); }
  });
  test('변이③: 개인 보기 팝업의 [전체 선택] [전체 해제]가 다른 출처를 보면 공용② 가 잡는 마크업이 바뀐다(묶음 출처를 꽂으면 fbo- 항목이 없다)', async () => {
    const bad = mutate('FB.src = FB_SRC;', 'FB.src = Object.assign({}, FB_SRC, { idp: "x-" });', src);
    const W = await boot({ source: bad });
    try {
      W.ev('renderAll()');
      await W.click('#fbBtn');
      assert.ok(!W.q('#fbList #fbo-0'), '변이가 항목 id 를 바꾸지 못했다(시험이 잡을 차이가 없다)');
    } finally { W.close(); }
  });
}
