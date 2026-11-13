// 자정 넘김: 달력의 오늘 표시만 옮긴다(docs/DAY-ROLLOVER-FABLE.md "시험", 2026-11-13 확정)와 알림 끊김 고침(같은 문서 "범위 밖 결함").
//
// 이 파일이 지키는 것:
//   (R) jsdom(위젯 모드, 가짜 호스트). 시간은 부팅 전에 창의 Date 를 바꿔 끼워 옮기고, 타이머는 창의 setTimeout, clearTimeout 을
//       가로채 건 함수와 길이를 적어 둔 뒤 시험이 직접 부른다(앱에 시계 주입 장치를 넣지 않는다).
//       기준 하나: 표시만 옮긴 화면이 같은 날짜로 새로 그린 화면과 같다(칸마다 클래스와 읽어 주는 이름).
//       문서의 시험 13개(1~13)와 알림 시험 셋(R1~R3).
//   (M) 변이: 문서의 변이 9개와 알림 변이 둘. 망가뜨린 앱으로 해당 시험을 다시 돌려 실패해야 한다.
// 시험 8 은 문서와 조금 다르다: 알림 끊김 고침이 같은 자정 타이머에 얹혀, 날이 바뀐 타이머는 reminderSync 를 한 번 보낸다.
//   그래서 표시 맞추기(daySync) 자체는 hpost 0번, 타이머 전체는 hostRequest 0번에 hpost 는 reminderSync 한 번뿐으로 본다.
// 생략 규약: jsdom 이 없으면 skip(판정 없음)으로 계수된다.
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}

if (!JSDOM) {
  skip('today-mark: jsdom 미설치로 런타임 검증을 건너뜁니다', SKIP_NO_JSDOM,
    `이 파일의 test 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았습니다.`);
} else {
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  const ms = (y, m, d, h = 10, mi = 0, s = 0, x = 0) => new Date(y, m - 1, d, h, mi, s, x).getTime();
  const P1 = '11111111-1111-4111-8111-111111111111';
  const PROJECTS = [{ projectUid: P1, name: '장비 개발', color: '#3e5be0', active: true, writable: true, members: 3 }];
  const META = { schemaVersion: '22', expectedSchema: '22', schemaMismatch: false, gate: 'ok', rev: 1, canWrite: true, userId: 7 };
  const ENT = (id, date, o) => Object.assign({ id, date, title: '일정 ' + id, categoryId: 'c-1', allDay: true, startTime: '', endTime: '', endDate: '', memo: '', location: '', recur: null, recurExcept: [] }, o || {});
  //  11/13 에 기록 셋(", 기록 3건"), 11/15 에 시각 일정 하나(11/12 기준 알림 목록 밖, 11/13 기준 안).
  const DATA = () => ({
    categories: [{ id: 'c-1', name: '휴가', color: '#9aa2b3' }, { id: 'c-2', name: '기타', color: '#6b7a90' }],
    entries: [ENT('a1', '2026-11-13'), ENT('a2', '2026-11-13'), ENT('a3', '2026-11-13'),
      ENT('r1', '2026-11-15', { allDay: false, startTime: '09:00', endTime: '10:00', title: '모레 다음 회의' }),
      ENT('x1', '2026-12-25', { title: '성탄 일정' })],
    todos: [], rooms: [],
  });
  const PCEV = (n, d) => ({ eventUid: 'aaaaaaaa-0000-4000-8000-' + String(n).padStart(12, '0'), projectUid: P1, title: '공용 ' + n, startDate: d, endDate: d,
    startTime: null, endTime: null, location: '', memo: '', recurFreq: null, recurExcept: [], rowVersion: 1, deleted: false,
    createdBy: '홍길동', updatedBy: '홍길동', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' });

  //  창 하나를 띄운다. query = '' | '?peer=1' | '?win=attend' | '?win=admin' | '?peerwin=1'
  async function boot({ src = app, query = '', start = ms(2026, 11, 12) } = {}) {
    const C = { now: start, timers: new Map(), seq: 0 };
    const posts = [];
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/' + query, virtualConsole: new jsdomMod.VirtualConsole(),
      beforeParse(win) {
        const RD = win.Date;
        function FD(...a) { if (!new.target) return new RD(C.now).toString(); return a.length ? new RD(...a) : new RD(C.now); }
        FD.prototype = RD.prototype; FD.now = () => C.now; FD.UTC = RD.UTC; FD.parse = RD.parse;
        win.Date = FD;
        win.setTimeout = (fn, d, ...args) => { const id = ++C.seq; C.timers.set(id, { fn, d: Number(d) || 0, args }); return id; };
        win.clearTimeout = (id) => { C.timers.delete(id); };
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posts.push(o || {}); }, addEventListener() {}, removeEventListener() {} } };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        if (!win.CSS) win.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
      },
    });
    const w = dom.window, doc = w.document;
    const W = {
      w, doc, C, posts,
      ev: (code) => w.eval(code),
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      q: (s) => doc.querySelector(s),
      at(y, m, d, h, mi, s, x) { C.now = ms(y, m, d, h, mi, s, x); },
      //  살아 있는 자정 예약(dayTick 을 건 것)
      dayTimers: () => [...C.timers.entries()].filter(([, t]) => t.fn && t.fn.name === 'dayTick'),
      //  자정 예약을 뜨게 한다(앱이 던져도 시험은 이어 간다. 결과는 예약과 칸으로 본다)
      fire() {
        const list = W.dayTimers();
        assert.strictEqual(list.length, 1, '살아 있는 자정 예약이 1개가 아니다: ' + list.length);
        const [id, t] = list[0];
        C.timers.delete(id);
        try { t.fn(...t.args); } catch (_) { /* 앱의 일 */ }
      },
      send: (type, target) => { (target === 'doc' ? doc : w).dispatchEvent(new w.Event(type)); },
      cmds: (cmd) => posts.filter((p) => p.cmd === cmd),
      async reply(cmd, res) {
        const p = [...posts].reverse().find((x) => x.cmd === cmd && x.reqId && !x.__done);
        assert.ok(p, `${cmd} 요청이 나가지 않았다`);
        p.__done = true;
        w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify(res) + ')');
        await settle();
      },
      //  칸 적기: [날짜, 정렬한 클래스, 읽어 주는 이름]
      snap: (sel) => W.evJSON(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => [e.dataset.date || e.dataset.hdate || '', [...e.classList].sort().join(' '), e.getAttribute('aria-label')])`),
      todays: (sel) => W.evJSON(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.classList.contains('today')).map(e => e.dataset.date || e.dataset.hdate)`),
      close: () => { try { w.close(); } catch (_) {} },
    };
    await settle();
    return W;
  }
  //  메인 창: 로그인과 상태 주입까지
  async function bootMain(opt) {
    const W = await boot(opt);
    await W.reply('userSessionGet', { ok: true, user: { loginId: 'hjlee', name: '이현진' } });
    W.ev('__applyState(' + JSON.stringify(JSON.stringify(DATA())) + ',' + JSON.stringify(META) + ')');
    await settle();
    W.ev('setCalView("month"); renderAll();');
    return W;
  }
  //  열람 프레임: 부모가 넣어 주는 상태
  async function bootPeer(opt) {
    const W = await boot(Object.assign({ query: '?peer=1' }, opt));
    W.ev('__applyState(' + JSON.stringify(JSON.stringify(DATA())) + ',' + JSON.stringify(META) + ')');
    await settle();
    W.ev('setCalView("month"); renderAll();');
    return W;
  }
  async function enterProject(W) {
    W.ev("pcSetTab('project')"); await settle();
    await W.reply('projectCalendarBootstrap', { ok: true, data: { projects: PROJECTS, limits: { title: 200, location: 200, memo: 8000 } } });
    await W.reply('pcWatchList', { ok: true, data: { projects: [], max: 50 } });
    const p = [...W.posts].reverse().find((x) => x.cmd === 'projectCalendarLoad' && !x.__done);
    await W.reply('projectCalendarLoad', { ok: true, data: { projects: [{ projectUid: P1, writable: true, mine: true }],
      events: [PCEV(1, '2026-11-13'), PCEV(2, '2026-11-13'), PCEV(3, '2026-11-12')], excluded: [], from: p.from, to: p.to } });
    assert.ok(W.q('#pcView .pc-day'), '과제 월간 달력이 그려지지 않았다');
  }
  async function enterAttend(W) {
    W.ev("pcSetTab('attend')"); await settle();
    await W.reply('reportDailyList', { ok: true, rows: [{ date: '2026-11-13', status: '', overtime: 0, content: '보고 내용', sentAt: '2026-11-13T09:00:00Z' }] });
    assert.ok(W.q('#atMonth .at-day'), '근태 일간 달력이 그려지지 않았다');
  }
  async function withW(make, fn) { const W = await make(); try { return await fn(W); } finally { W.close(); } }

  //  기준: from 의 화면을 새로 그리고, 날짜를 to 로 옮겨 자정 예약을 띄운 뒤 적은 칸이, 그 자리에서 새로 그린 칸과 같다.
  function crossCheck(W, box, rerender, from, to, expectTo = true) {
    W.at(...from); W.ev(rerender);
    const ymdOf = (a) => `${a[0]}-${String(a[1]).padStart(2, '0')}-${String(a[2]).padStart(2, '0')}`;
    const f = ymdOf(from), t = ymdOf(to), sel = box.split(',').map((b) => b.trim() + ' .cal-c').join(', ');
    W.at(...to); W.fire();
    const A = W.snap(sel);
    W.ev(rerender);
    const B = W.snap(sel);
    assert.ok(A.length > 0, box + ' 에 칸이 없다');
    assert.deepStrictEqual(A, B, `${box}: 표시만 옮긴 칸이 ${t} 로 새로 그린 칸과 다르다`);
    assert.ok(!W.todays(sel).includes(f), `${box}: 옛 오늘(${f})에 표시가 남았다`);
    if (expectTo) assert.ok(W.todays(sel).includes(t), `${box}: 새 오늘(${t})에 표시가 붙지 않았다`);
    return A;
  }

  const checks = {
    //  1. 새로 그린 것과 같다: 개인 월간, 개인 주간, 과제 월간, 과제 주간, 근태 일간(메인 창)과 나란히 보기 양쪽(열람 프레임)
    async fresh(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        crossCheck(W, '#grid', 'setCalView("month"); renderAll();', [2026, 11, 12], [2026, 11, 13]);
        crossCheck(W, '#grid', 'setCalView("week"); renderAll();', [2026, 11, 12], [2026, 11, 13]);
        W.ev('setCalView("month"); renderAll();');
        W.at(2026, 11, 12); W.fire();
        await enterProject(W);
        crossCheck(W, '#pcView', 'PCAL.view = "month"; pcRender();', [2026, 11, 12], [2026, 11, 13]);
        crossCheck(W, '#pcView', 'PCAL.view = "week"; pcRender();', [2026, 11, 12], [2026, 11, 13]);
        assert.ok(W.q('#pcView .pc-whday.today[data-hdate="2026-11-13"]'), '과제 주간 머리에 새 오늘 표시가 없다');
        W.ev('PCAL.view = "month"; pcRender();');
        W.at(2026, 11, 12); W.fire();
        await enterAttend(W);
        crossCheck(W, '#atMonth', 'atRenderMonth();', [2026, 11, 12], [2026, 11, 13]);
      });
      await withW(() => bootPeer({ src }), async (W) => {
        W.ev('setPeerLayout("side")');
        crossCheck(W, '#grid, #gridMine', 'setCalView("month"); renderAll();', [2026, 11, 12], [2026, 11, 13]);
        assert.ok(W.q('#gridMine .cal-c.today[data-date="2026-11-13"]'), '나란히 보기 오른쪽 달력에 새 오늘 표시가 없다');
        crossCheck(W, '#grid, #gridMine', 'setCalView("week"); renderAll();', [2026, 11, 12], [2026, 11, 13]);
      });
    },
    //  2. 주간 몸통 칸(wr-c, pc-wday)에는 today 가 붙지 않는다
    async bodies(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        W.ev('setCalView("week"); renderAll();');
        assert.ok(W.q('#grid .wr-c[data-date="2026-11-12"]'), '개인 주간 몸통 칸이 없다(시험 전제)');
        W.at(2026, 11, 13); W.fire();
        assert.strictEqual(W.doc.querySelectorAll('#grid .wr-c.today').length, 0, '개인 주간 몸통 칸에 오늘 표시가 붙었다');
        assert.ok(W.q('#grid .wr-hd.today[data-date="2026-11-13"]'), '개인 주간 머리에 오늘 표시가 없다');
        W.at(2026, 11, 12); W.fire();
        await enterProject(W);
        W.ev('PCAL.view = "week"; pcRender();');
        assert.ok(W.q('#pcView .pc-wday[data-date="2026-11-12"]'), '과제 주간 몸통 칸이 없다(시험 전제)');
        W.at(2026, 11, 13); W.fire();
        assert.strictEqual(W.doc.querySelectorAll('#pcView .pc-wday.today').length, 0, '과제 주간 몸통 칸에 오늘 표시가 붙었다');
        assert.ok(W.q('#pcView .pc-whday.today[data-hdate="2026-11-13"]'), '과제 주간 머리에 오늘 표시가 없다');
      });
    },
    //  3. 읽어 주는 이름: ", 오늘" 만 옮기고 뒤의 글과 공휴일 이름은 그대로
    async labels(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        const lab = (s) => W.q(s).getAttribute('aria-label');
        W.at(2026, 11, 13); W.fire();
        assert.strictEqual(lab('#grid .cal-c[data-date="2026-11-12"]'), '11월 12일 목요일, 기록 없음', '개인 월간 옛 칸의 이름');
        assert.strictEqual(lab('#grid .cal-c[data-date="2026-11-13"]'), '11월 13일 금요일, 오늘, 기록 3건', '개인 월간 새 칸의 이름');
        //  공휴일: 12/24 에서 12/25(성탄절)
        W.ev('view = {y: 2026, m: 11}; selectedDate = "2026-12-24"; renderAll();');
        W.at(2026, 12, 24); W.ev('renderAll()');
        W.at(2026, 12, 25); W.fire();
        assert.strictEqual(lab('#grid .cal-c[data-date="2026-12-25"]'), '12월 25일 금요일, 성탄절, 오늘, 기록 1건', '공휴일 칸의 이름');
        assert.strictEqual(lab('#grid .cal-c[data-date="2026-12-24"]'), '12월 24일 목요일, 기록 없음', '공휴일 앞 칸의 이름');
        W.ev('view = {y: 2026, m: 10}; selectedDate = "2026-11-12"; renderAll();');
        W.at(2026, 11, 12); W.fire();
        await enterProject(W);
        W.at(2026, 11, 13); W.fire();
        assert.strictEqual(lab('#pcView .pc-day[data-date="2026-11-13"]'), '11월 13일 금요일, 오늘, 일정 2건', '과제 월간 새 칸의 이름');
        assert.strictEqual(lab('#pcView .pc-day[data-date="2026-11-12"]'), '11월 12일 목요일, 일정 1건', '과제 월간 옛 칸의 이름');
        W.at(2026, 11, 12); W.fire();
        await enterAttend(W);
        W.at(2026, 11, 13); W.fire();
        assert.ok(lab('#atMonth .at-day[data-date="2026-11-13"]').startsWith('11월 13일 금요일, 오늘, 보고함'), '근태 새 칸의 이름: ' + lab('#atMonth .at-day[data-date="2026-11-13"]'));
        assert.strictEqual(lab('#atMonth .at-day[data-date="2026-11-12"]'), '11월 12일 목요일', '근태 옛 칸의 이름');
      });
    },
    //  4. 새 오늘 칸이 화면에 없다
    async offscreen(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        W.at(2026, 12, 7); W.fire();
        assert.deepStrictEqual(W.todays('#grid .cal-c'), [], '11월 화면에 오늘 표시가 남았다');
        assert.deepStrictEqual(W.evJSON('view'), { y: 2026, m: 10 }, '보는 달이 바뀌었다');
        W.ev('view = {y: 2026, m: 2}; renderAll();');
        const before = W.snap('#grid .cal-c');
        W.at(2026, 12, 8); W.fire();
        assert.deepStrictEqual(W.snap('#grid .cal-c'), before, '3월을 보는 중에 칸이 바뀌었다');
      });
    },
    //  5. 월말과 연말: 이웃 달 칸에 붙고 보는 달은 그대로
    async monthEnd(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        crossCheck(W, '#grid', 'renderAll();', [2026, 11, 30, 23, 59], [2026, 12, 1, 0, 0, 1]);
        assert.ok(W.q('#grid .cal-c.dim.today[data-date="2026-12-01"]'), '11월 달력의 이웃 달 칸(12/1)에 붙지 않았다');
        assert.deepStrictEqual(W.evJSON('view'), { y: 2026, m: 10 }, '보는 달이 바뀌었다');
        W.ev('view = {y: 2026, m: 11}; renderAll();');
        crossCheck(W, '#grid', 'renderAll();', [2026, 12, 31, 23, 59], [2027, 1, 1, 0, 0, 1]);
        assert.ok(W.q('#grid .cal-c.dim.today[data-date="2027-01-01"]'), '12월 달력의 이웃 달 칸(1/1)에 붙지 않았다');
        assert.deepStrictEqual(W.evJSON('view'), { y: 2026, m: 11 }, '보는 달이 바뀌었다');
      });
    },
    //  6. 시계 되돌림
    async rollback(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        crossCheck(W, '#grid', 'renderAll();', [2026, 11, 13], [2026, 11, 12]);
      });
    },
    //  7. 칸이 같은 요소다: 노드, 초점, 고른 날, 보는 달, 기준일, 열린 모달과 그날 목록
    async same(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        const state = () => W.evJSON('({ sel: selectedDate, view, pc: PCAL.anchor, at: ATT.anchor })');
        W.ev('window.__n0 = [...document.querySelectorAll(".cal-c")]; document.querySelector(\'#grid .cal-c[data-date="2026-11-12"]\').focus();');
        const s0 = state(), ae0 = W.doc.activeElement;
        assert.ok(ae0 && ae0.dataset.date === '2026-11-12', '시험 전제: 칸에 초점이 없다');
        W.at(2026, 11, 13); W.fire();
        assert.ok(W.ev('window.__n0.length > 0 && window.__n0.every(e => e.isConnected) && [...document.querySelectorAll(".cal-c")].every((e, i) => e === window.__n0[i])'), '칸 노드가 바뀌었다(다시 그렸다)');
        assert.strictEqual(W.doc.activeElement, ae0, '초점을 가진 요소가 바뀌었다');
        assert.deepStrictEqual(state(), s0, '고른 날, 보는 달, 기준일이 바뀌었다');
        //  모달을 연 채로
        W.ev('openQuickAdd("2026-11-12")'); await settle();
        const m0 = W.q('#quickAdd').outerHTML;
        W.at(2026, 11, 14); W.fire();
        assert.strictEqual(W.q('#quickAdd').outerHTML, m0, '열린 입력 창이 바뀌었다');
        W.ev('closeModal("#quickAdd")'); await settle();
        //  과제 그날 목록을 연 채로
        W.at(2026, 11, 12); W.fire();
        await enterProject(W);
        W.ev('pcOpenDayList("2026-11-13", document.querySelector(\'#pcView .pc-day[data-date="2026-11-13"]\')); window.__pop0 = PCAL.pop; window.__p0 = [...document.querySelectorAll("#pcView .cal-c")];');
        assert.ok(W.ev('!!(PCAL.pop && PCAL.pop.el && PCAL.pop.el.isConnected)'), '시험 전제: 그날 목록이 열리지 않았다');
        const s1 = state(), pop0 = W.ev('PCAL.pop.el.outerHTML');
        W.at(2026, 11, 13); W.fire();
        assert.ok(W.ev('PCAL.pop === window.__pop0 && PCAL.pop.el.isConnected'), '그날 목록이 닫혔다');
        assert.strictEqual(W.ev('PCAL.pop.el.outerHTML'), pop0, '그날 목록이 바뀌었다');
        assert.ok(W.ev('[...document.querySelectorAll("#pcView .cal-c")].every((e, i) => e === window.__p0[i])'), '과제 칸 노드가 바뀌었다');
        assert.deepStrictEqual(state(), s1, '고른 날, 보는 달, 기준일이 바뀌었다(과제 탭)');
      });
    },
    //  8. 밖으로 나가는 것이 없다
    async quiet(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        W.ev(`window.__calls = []; for (const n of ['renderGrid', 'renderPanel', 'pcRender', 'atRenderMonth', 'hostRequest', 'hpost', 'selectDate']) {
          const f = window[n]; window[n] = function(){ __calls.push(n === 'hpost' ? 'hpost:' + ((arguments[0] && arguments[0].cmd) || '') : n); return f.apply(this, arguments); }; }`);
        //  표시 맞추기 자체
        W.at(2026, 11, 13); W.ev('daySync()');
        assert.ok(W.q('#grid .cal-c.today[data-date="2026-11-13"]'), '시험 전제: 표시가 옮겨지지 않았다');
        assert.deepStrictEqual(W.evJSON('__calls'), [], '표시 맞추기가 그리기나 호스트를 불렀다');
        //  자정 타이머 전체: 알림 다시 보내기 한 번 말고는 없다
        W.at(2026, 11, 14); W.fire();
        assert.deepStrictEqual(W.evJSON('__calls'), ['hpost:reminderSync'], '자정 타이머가 알림 말고 다른 것을 불렀다');
      });
    },
    //  9. 타이머 하나
    async oneTimer(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        assert.strictEqual(W.dayTimers().length, 1, '설치 뒤 예약이 1개가 아니다');
        for (let i = 0; i < 50; i++) { W.send('visibilitychange', 'doc'); W.send('focus'); }
        assert.strictEqual(W.dayTimers().length, 1, '보임과 포커스 뒤 예약이 쌓였다');
        W.send('pagehide');
        assert.strictEqual(W.dayTimers().length, 0, 'pagehide 뒤 예약이 남았다');
        W.send('pageshow');
        assert.strictEqual(W.dayTimers().length, 1, 'pageshow 뒤 예약이 1개가 아니다');
      });
    },
    //  10. 예약 길이
    async length(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        W.at(2026, 11, 12, 23, 59, 30); W.send('focus');
        const d1 = W.dayTimers()[0][1].d;
        assert.ok(d1 >= 30500 && d1 <= 31500, '23:59:30 에 건 예약이 31초쯤이 아니다: ' + d1);
        W.at(2026, 11, 12, 23, 59, 59, 995); W.fire();
        const d2 = W.dayTimers()[0][1].d;
        assert.ok(d2 >= 1000, '자정 몇 ms 전에 뜬 타이머의 다음 예약이 1초보다 짧다: ' + d2);
      });
    },
    //  11. 실패해도 다음 자정
    async failSafe(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        W.ev('window.__warns = []; console.warn = function(){ __warns.push(String(arguments[0])); }; window.__ca = calAria; calAria = function(){ throw new Error("깨짐"); };');
        const old = W.snap('#grid .cal-c[data-date="2026-11-12"], #grid .cal-c[data-date="2026-11-13"]');
        W.at(2026, 11, 13); W.fire();
        assert.strictEqual(W.dayTimers().length, 1, '표시가 실패하자 다음 자정 예약이 사라졌다');
        assert.ok(W.evJSON('__warns').some((x) => x.includes('[day]')), 'console.warn 이 찍히지 않았다');
        assert.deepStrictEqual(W.snap('#grid .cal-c[data-date="2026-11-12"], #grid .cal-c[data-date="2026-11-13"]'), old, '던진 칸의 클래스나 이름이 옛 것과 다르다(색과 이름이 어긋났다)');
        W.ev('calAria = window.__ca;');
        W.fire();
        const A = W.snap('#grid .cal-c');
        W.ev('renderAll()');
        assert.deepStrictEqual(A, W.snap('#grid .cal-c'), '되돌린 뒤 클래스와 이름이 함께 맞지 않는다');
      });
    },
    //  12. 설치하지 않는 창
    async noInstall(src = app) {
      for (const query of ['?win=attend', '?win=admin', '?peerwin=1']) {
        await withW(() => boot({ src, query }), async (W) => {
          assert.strictEqual(W.dayTimers().length, 0, query + ' 에 자정 예약이 있다');
          W.send('focus'); W.send('pageshow');
          assert.strictEqual(W.dayTimers().length, 0, query + ' 에 창 복귀 뒤 자정 예약이 생겼다');
        });
      }
      await withW(() => bootPeer({ src }), async (W) => { assert.strictEqual(W.dayTimers().length, 1, '열람 프레임에 자정 예약이 없다'); });
    },
    //  13. 숨은 문서
    async hidden(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        Object.defineProperty(W.doc, 'visibilityState', { configurable: true, get: () => 'hidden' });
        W.at(2026, 11, 13); W.fire();
        assert.ok(W.q('#grid .cal-c.today[data-date="2026-11-13"]'), '숨은 채 뜬 타이머가 표시를 맞추지 않았다');
        const ids = W.dayTimers().map(([id]) => id);
        assert.strictEqual(ids.length, 1, '숨은 채 뜬 타이머가 다음 예약을 걸지 않았다');
        W.send('focus'); W.send('visibilitychange', 'doc');
        assert.deepStrictEqual(W.dayTimers().map(([id]) => id), ids, '숨은 채 온 focus 가 예약을 건드렸다');
      });
    },
    //  R1. 자정을 넘기면 알림 목록을 한 번 다시 보낸다(새 기간의 일정이 실린다)
    async remCross(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        const n0 = W.cmds('reminderSync').length;
        assert.ok(n0 >= 1, '시험 전제: 부팅에서 알림 목록을 보내지 않았다');
        assert.ok(!W.cmds('reminderSync').at(-1).occ.some((o) => o.occStart === '2026-11-15'), '시험 전제: 11/12 기준 목록에 11/15 가 있다');
        W.at(2026, 11, 13, 0, 0, 1); W.fire();
        assert.strictEqual(W.cmds('reminderSync').length, n0 + 1, '자정을 넘겼는데 알림 목록을 한 번 보내지 않았다');
        assert.ok(W.cmds('reminderSync').at(-1).occ.some((o) => o.occStart === '2026-11-15'), '다시 보낸 목록에 새 기간(11/15)의 일정이 없다');
        W.at(2026, 11, 13, 8); W.fire();
        W.send('focus'); W.send('visibilitychange', 'doc'); W.send('pageshow');
        assert.strictEqual(W.cmds('reminderSync').length, n0 + 1, '같은 날 다시 보냈다');
      });
    },
    //  R2. 같은 날 창 복귀는 보내지 않고, 숨은 사이 날이 바뀐 뒤의 창 복귀는 한 번 보낸다
    async remReturn(src = app) {
      await withW(() => bootMain({ src }), async (W) => {
        const n0 = W.cmds('reminderSync').length;
        W.at(2026, 11, 12, 18);
        for (let i = 0; i < 5; i++) { W.send('focus'); W.send('visibilitychange', 'doc'); }
        assert.strictEqual(W.cmds('reminderSync').length, n0, '같은 날 창 복귀에서 알림 목록을 보냈다');
        W.at(2026, 11, 14, 9);
        W.send('focus'); W.send('focus'); W.send('visibilitychange', 'doc');
        assert.strictEqual(W.cmds('reminderSync').length, n0 + 1, '날이 바뀐 뒤 창 복귀에서 한 번 보내지 않았다');
      });
    },
    //  R3. 열람 프레임과 따로 뜨는 창은 날이 바뀌어도 보내지 않는다
    async remOwner(src = app) {
      const spy = (W) => W.ev('window.__pr = 0; const f = pushReminders; pushReminders = function(){ __pr++; return f.apply(this, arguments); };');
      await withW(() => bootPeer({ src }), async (W) => {
        spy(W);
        W.at(2026, 11, 13, 0, 0, 1); W.fire();
        W.at(2026, 11, 14); W.send('focus'); W.ev('dayRemCheck()');
        assert.strictEqual(W.ev('__pr'), 0, '열람 프레임이 알림 목록을 보냈다');
        assert.strictEqual(W.ev('dayRemSent'), '', '열람 프레임이 보낸 날을 적었다');
      });
      for (const query of ['?win=attend', '?win=admin', '?peerwin=1']) {
        await withW(() => boot({ src, query }), async (W) => {
          W.ev('pushReminders()');   // 보내도(호스트 봉인이 버린다) 적지 않는다
          spy(W);
          W.at(2026, 11, 13); W.send('focus'); W.send('pageshow'); W.ev('dayRemCheck()');
          assert.strictEqual(W.ev('__pr'), 0, query + ' 가 알림 목록을 보냈다');
          assert.strictEqual(W.cmds('reminderSync').length, 0, query + ' 에서 reminderSync 가 나갔다');
          assert.strictEqual(W.ev('dayRemSent'), '', query + ' 가 보낸 날을 적었다');
        });
      }
    },
  };

  const NAMES = {
    fresh: '1. 새로 그린 것과 같다: 개인 월간과 주간, 나란히 보기 양쪽, 과제 월간과 주간, 근태 일간(11/12 에서 11/13)',
    bodies: '2. 주간 몸통 칸(wr-c, pc-wday)에는 today 가 붙지 않고 머리에만 붙는다',
    labels: '3. 읽어 주는 이름: ", 오늘" 만 옮기고 기록 n건, 일정 n건, 보고함, 공휴일 이름은 그대로',
    offscreen: '4. 새 오늘 칸이 화면에 없다: 옛 표시만 지워지고, 다른 달을 보는 중이면 변화가 없다',
    monthEnd: '5. 월말과 연말: 이웃 달 칸(12/1, 1/1)에 붙고 보는 달은 그대로',
    rollback: '6. 시계 되돌림: 11/13 에서 11/12 로 표시가 돌아간다',
    same: '7. 칸이 같은 요소다: 노드, 초점, 고른 날, 보는 달, 기준일, 열린 입력 창, 과제 그날 목록이 그대로',
    quiet: '8. 밖으로 나가는 것이 없다: 표시 맞추기는 그리기와 호스트 0번, 자정 타이머는 reminderSync 한 번뿐',
    oneTimer: '9. 타이머 하나: 보임과 포커스 50번 뒤에도 1개, pagehide 뒤 0개, pageshow 뒤 1개',
    length: '10. 예약 길이: 23:59:30 에 31초쯤, 자정 몇 ms 전에 떠도 다음 예약은 1초 이상',
    failSafe: '11. 실패해도 다음 자정: 예약 1개, console.warn, 던진 칸은 옛 그대로, 되돌리면 함께 맞는다',
    noInstall: '12. 설치하지 않는 창: 근태 창, 관리 창, 열람 창 껍데기는 예약 0개(열람 프레임은 1개)',
    hidden: '13. 숨은 문서: 타이머는 표시를 맞추고, 숨은 채 온 focus 는 예약을 건드리지 않는다',
    remCross: 'R1. 알림: 자정을 넘기면 메인 창이 reminderSync 를 한 번 보내고(새 기간 실림) 같은 날에는 다시 보내지 않는다',
    remReturn: 'R2. 알림: 같은 날 창 복귀는 보내지 않고, 날이 바뀐 뒤 창 복귀는 한 번 보낸다',
    remOwner: 'R3. 알림: 열람 프레임, 근태 창, 관리 창, 열람 창 껍데기는 날이 바뀌어도 보내지 않고 보낸 날도 적지 않는다',
  };
  for (const [k, name] of Object.entries(NAMES)) test('(R) ' + name, () => checks[k]());

  /* ── (M) 변이 ──────────────────────────────────────────────────────── */
  const MUT = [
    ['DAY_CELLS 에서 :not(.wr-c) 를 뺀다', "'.cal-c.cell:not(.wr-c)[data-date], ", "'.cal-c.cell[data-date], ", ['fresh', 'bodies']],
    ['DAY_CELLS 의 과제 머리를 .pc-wday[data-date] 로 바꾼다', '.cal-c.pc-whday[data-hdate]', '.cal-c.pc-wday[data-date]', ['fresh', 'bodies']],
    ['이름을 calAria(ds, t) 로 통째로 덮어쓴다', "if(a && a.startsWith(from)) el.setAttribute('aria-label', to + a.slice(from.length));", "if(a) el.setAttribute('aria-label', calAria(ds, t));", ['labels']],
    ['dayTick 의 순서를 바꾸고 try/catch 를 뺀다', 'function dayTick(){ dayArm(); daySync(); dayRemCheck(); }', 'function dayTick(){ dayMark(); dayArm(); dayRemCheck(); }', ['failSafe']],
    ['Math.max(1000, ...) 과 + 1000 을 뺀다', 'Math.max(1000, next - n + 1000)', 'next - n', ['length']],
    ['clearTimeout 을 뺀다', '  clearTimeout(dayTimer);\n  const n = new Date(), next', '  const n = new Date(), next', ['oneTimer']],
    ['if(SUBWIN) return; 을 뺀다', '  if(SUBWIN) return;                                              // 메인 창', '  // 메인 창', ['noInstall']],
    ['dayMark 대신 renderGrid() 를 부른다', 'function daySync(){ try{ dayMark(); }', 'function daySync(){ try{ renderGrid(); }', ['same', 'quiet']],
    ['dayMark 에서 클래스를 이름 계산보다 먼저 바꾼다', "    const a = el.getAttribute('aria-label');\n    const from = a ? calAria(ds, on ? '' : ds) : '', to = a ? calAria(ds, on ? ds : '') : '';\n    el.classList.toggle('today', on);",
      "    el.classList.toggle('today', on);\n    const a = el.getAttribute('aria-label');\n    const from = a ? calAria(ds, on ? '' : ds) : '', to = a ? calAria(ds, on ? ds : '') : '';", ['failSafe']],
    ['알림: 날짜 비교를 뺀다(같은 날에도 보낸다)', 'dayRemSent && dayRemSent !== todayYmd()) pushReminders();', 'dayRemSent) pushReminders();', ['remCross', 'remReturn']],
    ['알림: 보낸 날을 적지 않는다', ' if(!PEER && !SUBWIN) dayRemSent = todayYmd(); }catch(_){} }', ' }catch(_){} }', ['remCross']],
  ];
  for (const [name, find, repl, keys] of MUT) {
    test(`(M) 변이 "${name}" 를 ${keys.join(', ')} 시험이 잡는다`, async () => {
      const bad = mutate(app, find, repl);
      for (const k of keys) {
        let failed = false;
        try { await checks[k](bad); } catch (_) { failed = true; if (process.env.TM_DEBUG) console.log("      [" + k + "] " + String(_ && _.message).split('\n')[0]); }
        assert.ok(failed, `변이 "${name}" 를 ${k} 시험이 잡지 못했다`);
      }
    });
  }
}
