// 개인 일정 및 다른 사람 일정 월간/주간 모드 계약(docs/PERSONAL-PEER-WEEK-VIEW.md).
//
// 이 파일이 지키는 것:
//   (S) 정적 및 단위 계약:
//       calViewKey(), calViewDefault(), calView(), setCalView(), calWeekRange(),
//       calTitleLabel(), syncCalViewSeg(), moveWeek(), stepCal() 존재 및 동작
//       상단 탐색바(header.topbar .nav) 안에 #calViewSeg (#btnCalViewMonth, #btnCalViewWeek) 존재
//   (R) 런타임(jsdom) 통합 검증(내 창 !PEER 및 열람 창 PEER 모두):
//       기본값은 month(#btnCalViewMonth.active, aria-pressed="true", #weekdays 는 일 월 화 수 목 금 토)
//       #btnCalViewWeek 클릭 시 calView() === 'week', localStorage 에 내 창은 tc_calView="week",
//       열람 창은 tc_peerView="week" 로 따로 저장됨(내 창과 열람 창 간 간섭 없음)
//       주간 모드에서 #weekdays (및 나란히 보기의 #weekdaysMine)가 월 화 수 목 금 토 일 순서로 바뀌고
//       토요일(.sat, index 5), 일요일(.sun, index 6) 클래스가 맞음
//       주간 모드에서 #grid (및 나란히 보기의 #gridMine)는 과제별 줄 표(.grid.wrows, renderWeekRows)다:
//       머리 7칸(.wr-hd, 월~일) + 과제마다 한 줄(빈 과제도), 분류 없는 기록은 "분류 없음" 줄(2026-10-30 사용자 결정)
//       열람 창 겹쳐 보기: 같은 DB 과제(db-<uid>)면 상대 줄 안에 내 막대, 겹치지 않는 내 과제는 굵은 선 아래 내 과제 줄. 겹을 끄면 둘 다 빠진다
//       나란히 보기: 같은 DB 과제가 위(양쪽 차선 수 같음), 각자 과제가 아래
//       주간 모드에서 날짜 제목(#btnTitle)이 그 주 월요일이 든 달 "YYYY년 M월"로 표시됨(docs/NAV-LAYOUT-C.md)
//       주간 모드에서 #btnPrev / #btnNext 클릭 시 ±7일 이동하고, 월간 모드에서는 기존처럼 ±1달 이동함
//   (M) 변이 시험(mutation test):
//       calViewKey 에서 PEER 분기 제거, calWeekRange 의 월요일 시작 오프셋 변경, stepCal 에서 moveWeek 호출 제거 시 실패 검증.
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

// ══════════════════════════════════════════════════════════════════════
// (S) 정적 및 단위 계약
// ══════════════════════════════════════════════════════════════════════

test('정적①: 상단 탐색바 안에 #calViewSeg 분할 버튼(#btnCalViewMonth, #btnCalViewWeek)이 존재한다', () => {
  const navIdx = app.indexOf('<div class="nav">');
  assert.ok(navIdx > 0, '.nav 영역을 찾지 못했다');
  const navEnd = app.indexOf('</div>', navIdx);
  const navHtml = app.slice(navIdx, navEnd);

  assert.ok(navHtml.includes('id="calViewSeg"'), '#calViewSeg 가 .nav 안에 없다');
  assert.ok(navHtml.includes('id="btnCalViewMonth"'), '#btnCalViewMonth 가 없다');
  assert.ok(navHtml.includes('id="btnCalViewWeek"'), '#btnCalViewWeek 가 없다');
  assert.ok(navHtml.includes('data-calview="month"'), 'data-calview="month" 속성이 없다');
  assert.ok(navHtml.includes('data-calview="week"'), 'data-calview="week" 속성이 없다');
});

test('정적②: 주간/월간 관련 핵심 함수들이 모두 정의되어 있다', () => {
  for (const fn of ['calViewKey', 'calViewDefault', 'calView', 'setCalView', 'calWeekRange', 'calTitleLabel', 'syncCalViewSeg', 'moveWeek', 'stepCal']) {
    const code = extractFunction(app, fn);
    assert.ok(code && code.length > 0, `${fn} 함수를 추출하지 못했다`);
  }
});

// 순수 단위 검증
test('단위①: calViewKey 는 PEER 플래그에 따라 tc_peerView 또는 tc_calView 를 반환한다', () => {
  const code = extractFunction(app, 'calViewKey');
  const fn = new Function('PEER', code + '\nreturn calViewKey();');
  assert.strictEqual(fn(false), 'tc_calView', '내 창에서는 tc_calView 여야 한다');
  assert.strictEqual(fn(true), 'tc_peerView', '열람 창에서는 tc_peerView 여야 한다');
});

test('단위②: calViewDefault 는 항상 month 를 반환한다', () => {
  const code = extractFunction(app, 'calViewDefault');
  const fn = new Function(code + '\nreturn calViewDefault();');
  assert.strictEqual(fn(), 'month');
});

test('단위③: calWeekRange 는 주어진 날짜가 속한 월요일부터 일요일까지 7일 범위를 계산한다', () => {
  const helpers = [
    'function pad(n){ return String(n).padStart(2, "0"); }',
    'function ymd(d){ return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }',
    'function parseYmd(s){ const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }',
    'function addDays(s, n){ const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }',
    'function todayYmd(){ return "2026-10-30"; }',
  ].join('\n');
  const code = helpers + '\n' + extractFunction(app, 'calWeekRange');
  const fn = new Function(code + '\nreturn calWeekRange;');

  const range = fn();
  // 2026-10-28 은 수요일, 그 주 월요일은 2026-10-26, 일요일은 2026-11-01
  const rWed = range('2026-10-28');
  assert.deepStrictEqual(rWed, { from: '2026-10-26', to: '2026-11-01', weeks: 1 });

  // 2026-10-26 은 월요일 (시작일)
  const rMon = range('2026-10-26');
  assert.deepStrictEqual(rMon, { from: '2026-10-26', to: '2026-11-01', weeks: 1 });

  // 2026-11-01 은 일요일 (종료일)
  const rSun = range('2026-11-01');
  assert.deepStrictEqual(rSun, { from: '2026-10-26', to: '2026-11-01', weeks: 1 });

  // 연도를 넘어가는 주: 2026-12-30 수요일 -> 2026-12-28(월) ~ 2027-01-03(일)
  const rCross = range('2026-12-30');
  assert.deepStrictEqual(rCross, { from: '2026-12-28', to: '2027-01-03', weeks: 1 });
});

test('단위④: calTitleLabel 은 월간 모드와 주간 모드(같은 달, 다른 달, 다른 해)에 맞춰 올바른 제목을 반환한다', () => {
  const helpers = [
    'function pad(n){ return String(n).padStart(2, "0"); }',
    'function ymd(d){ return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }',
    'function parseYmd(s){ const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }',
    'function addDays(s, n){ const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }',
    'function todayYmd(){ return "2026-10-30"; }',
    extractFunction(app, 'calWeekRange'),
  ].join('\n');
  const code = helpers + '\n' + extractFunction(app, 'calTitleLabel');

  function getLabel(calViewVal, viewVal, selectedDateVal) {
    const runner = new Function('calViewVal', 'view', 'selectedDate', `
      function calView(){ return calViewVal; }
      ${code}
      return calTitleLabel();
    `);
    return runner(calViewVal, viewVal, selectedDateVal);
  }

  // 월간 모드
  assert.strictEqual(getLabel('month', { y: 2026, m: 9 }, '2026-10-21'), '2026년 10월');

  // 주간 모드: 제목은 그 주 월요일이 든 달(docs/NAV-LAYOUT-C.md). 같은 달 내 1주 (2026-10-19 ~ 2026-10-25)
  assert.strictEqual(getLabel('week', { y: 2026, m: 9 }, '2026-10-21'), '2026년 10월');

  // 주간 모드: 다른 달에 걸친 1주 (2026-10-26 ~ 2026-11-01)
  assert.strictEqual(getLabel('week', { y: 2026, m: 9 }, '2026-10-28'), '2026년 10월');

  // 주간 모드: 다른 해에 걸친 1주 (2026-12-28 ~ 2027-01-03)
  assert.strictEqual(getLabel('week', { y: 2026, m: 11 }, '2026-12-30'), '2026년 12월');
});

// ══════════════════════════════════════════════════════════════════════
// (R) 런타임(jsdom) 통합 검증
// ══════════════════════════════════════════════════════════════════════
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;

if (!JSDOM) {
  skip('personal-peer-week-view: jsdom 미설치로 런타임 검증을 건너뜁니다', SKIP_NO_JSDOM,
    `이 파일의 test 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았습니다.`);
} else {
  const bootOpts = (url) => ({
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url,
    beforeParse(window) {
      window.chrome = {
        webview: {
          postMessage() {},
          addEventListener() {},
          removeEventListener() {},
        },
      };
      if (typeof window.crypto === 'undefined') {
        window.crypto = { randomUUID: () => 'u-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
      }
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      if (!window.CSS) window.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
    },
  });

  function bootWindow(url, src) {
    const dom = new JSDOM(src || app, bootOpts(url));
    const w = dom.window;
    return {
      w,
      ev: (code) => w.eval(code),
      close: () => { try { w.close(); } catch (_) {} },
    };
  }

  const settle = () => new Promise((r) => setTimeout(r, 40));

  test('런타임①: 내 창(!PEER)에서 기본값은 month 이고 #btnCalViewWeek 클릭 시 주간 모드로 전환된다', async () => {
    const main = bootWindow('https://tcapp.local/');
    try {
      await settle();
      const doc = main.w.document;

      // 초기 상태: 월간 모드
      const btnMonth = doc.getElementById('btnCalViewMonth');
      const btnWeek = doc.getElementById('btnCalViewWeek');
      assert.ok(btnMonth && btnWeek, '전환 버튼들이 존재해야 한다');
      assert.ok(btnMonth.classList.contains('active'), '기본으로 월간 버튼이 active 여야 한다');
      assert.strictEqual(btnMonth.getAttribute('aria-pressed'), 'true');
      assert.strictEqual(btnWeek.classList.contains('active'), false);
      assert.strictEqual(btnWeek.getAttribute('aria-pressed'), 'false');

      // 요일 헤더: 일 월 화 수 목 금 토
      const weekdays = [...doc.querySelectorAll('#weekdays > div')].map((el) => el.textContent.trim());
      assert.deepStrictEqual(weekdays, ['일', '월', '화', '수', '목', '금', '토']);
      assert.ok(doc.querySelector('#weekdays > div:nth-child(1)').classList.contains('sun'));
      assert.ok(doc.querySelector('#weekdays > div:nth-child(7)').classList.contains('sat'));

      // 주간 버튼 클릭
      btnWeek.click();
      await settle();

      assert.strictEqual(main.ev('calView()'), 'week', 'calView() 가 week 여야 한다');
      assert.strictEqual(main.w.localStorage.getItem('tc_calView'), 'week', 'localStorage 에 tc_calView 가 저장되어야 한다');
      assert.strictEqual(main.w.localStorage.getItem('tc_peerView'), null, '열람 창 키 tc_peerView 는 건드리지 않아야 한다');

      assert.strictEqual(btnWeek.classList.contains('active'), true);
      assert.strictEqual(btnWeek.getAttribute('aria-pressed'), 'true');
      assert.strictEqual(btnMonth.classList.contains('active'), false);
      assert.strictEqual(btnMonth.getAttribute('aria-pressed'), 'false');

      // 주간 모드 요일 헤더: 월 화 수 목 금 토 일
      const weekDaysAfter = [...doc.querySelectorAll('#weekdays > div')].map((el) => el.textContent.trim());
      assert.deepStrictEqual(weekDaysAfter, ['월', '화', '수', '목', '금', '토', '일']);
      assert.ok(doc.querySelector('#weekdays > div:nth-child(6)').classList.contains('sat'), '토요일은 6번째(index 5) 여야 한다');
      assert.ok(doc.querySelector('#weekdays > div:nth-child(7)').classList.contains('sun'), '일요일은 7번째(index 6) 여야 한다');

      // 그리드: 과제별 줄 표(머리 7칸 + 과제마다 한 줄, 빈 과제도)
      const grid = doc.getElementById('grid');
      assert.ok(grid.classList.contains('wrows') && !grid.classList.contains('bars'), '주간은 과제별 줄 표(wrows)여야 한다');
      assert.deepStrictEqual([...grid.querySelectorAll('.wr-hd')].map((el) => el.textContent.trim().split(' ')[0]), ['월', '화', '수', '목', '금', '토', '일']);
      const nCat = main.ev('state.categories.length');
      assert.strictEqual(grid.querySelectorAll('.wr-name').length, nCat, '과제마다 한 줄이어야 한다(빈 과제도)');
      assert.strictEqual(grid.querySelectorAll('.gridrow').length, nCat);
      // 월간으로 돌아오면 막대 달력
      doc.getElementById('btnCalViewMonth').click();
      await settle();
      assert.ok(grid.classList.contains('bars') && !grid.classList.contains('wrows'), '월간으로 돌아오면 막대 달력이어야 한다');
    } finally {
      main.close();
    }
  });

  test('런타임②: 열람 창(PEER)에서 주간 모드 전환 시 tc_peerView 에 독립 저장되고 나란히 보기(#weekdaysMine, #gridMine)도 1주로 렌더된다', async () => {
    const peer = bootWindow('https://tcapp.local/?peer=1');
    try {
      await settle();
      const doc = peer.w.document;

      // 주간 버튼 클릭
      const btnWeek = doc.getElementById('btnCalViewWeek');
      btnWeek.click();
      await settle();

      assert.strictEqual(peer.ev('calView()'), 'week');
      assert.strictEqual(peer.w.localStorage.getItem('tc_peerView'), 'week', '열람 창에서는 tc_peerView 에 저장되어야 한다');
      assert.strictEqual(peer.w.localStorage.getItem('tc_calView'), null, '내 창 키 tc_calView 는 건드리지 않아야 한다');

      // 나란히 보기 활성화
      peer.ev('setPeerLayout("side");');
      await settle();

      // 양쪽 요일 헤더 모두 월 화 수 목 금 토 일
      const w1 = [...doc.querySelectorAll('#weekdays > div')].map((el) => el.textContent.trim());
      const w2 = [...doc.querySelectorAll('#weekdaysMine > div')].map((el) => el.textContent.trim());
      assert.deepStrictEqual(w1, ['월', '화', '수', '목', '금', '토', '일']);
      assert.deepStrictEqual(w2, ['월', '화', '수', '목', '금', '토', '일']);
      assert.ok(doc.querySelector('#weekdaysMine > div:nth-child(6)').classList.contains('sat'));
      assert.ok(doc.querySelector('#weekdaysMine > div:nth-child(7)').classList.contains('sun'));

      // 양쪽 모두 과제별 줄 표(머리 7칸)
      const g1 = doc.getElementById('grid');
      const g2 = doc.getElementById('gridMine');
      assert.ok(g1.classList.contains('wrows') && g2.classList.contains('wrows'));
      assert.strictEqual(g1.querySelectorAll('.wr-hd').length, 7);
      assert.strictEqual(g2.querySelectorAll('.wr-hd').length, 7);
    } finally {
      peer.close();
    }
  });

  //  열람 창 데이터: 상대 과제 셋(공식 db-u1 은 나도 가진 과제, 공식 db-u2 와 개인 p-own 은 상대만), 내 과제 둘(db-u1 공유, 개인 m:me-own)
  function peerWeekData(peer, layout) {
    peer.w.localStorage.setItem('tc_peerView', 'week');
    if (layout) peer.w.localStorage.setItem('tc_peerLayout', layout);
    const mine = (id, date, key, name) => ({ id, date, title: id, allDay: true, startTime: '', endTime: '', endDate: '', recur: null, recurExcept: [], categoryId: null, _cat: key ? { key, name, color: '#5a6886' } : null, _mine: true });
    peer.w.__applyState(JSON.stringify({
      categories: [
        { id: 'db-u1', name: '공유 과제', color: '#3e7be0', source: 'db' },
        { id: 'db-u2', name: '상대 공식', color: '#2f9a6b', source: 'db' },
        { id: 'p-own', name: '상대 개인', color: '#c4782b' },
      ],
      entries: [
        { id: 't1', date: '2026-10-27', title: '상대 공유', categoryId: 'db-u1', allDay: true, endDate: '2026-10-28' },
        { id: 't2', date: '2026-10-29', title: '상대 개인', categoryId: 'p-own', allDay: true },
        { id: 't3', date: '2026-10-30', title: '상대 분류 없음', categoryId: null, allDay: true },
        mine('m1', '2026-10-27', 'db-u1', '공유 과제'),
        mine('m2', '2026-10-27', 'db-u1', '공유 과제'),
        mine('m3', '2026-10-29', 'm:me-own', '내 개인'),
        mine('m4', '2026-10-31', null, ''),
      ],
      todos: [], taskHours: {}, attendance: {},
    }), { peerName: '홍길동', canWrite: false, view: { y: 2026, m: 9, sel: '2026-10-28' },
          mineCats: [{ key: 'db-u1', name: '공유 과제', color: '#3e7be0' }, { key: 'm:me-own', name: '내 개인', color: '#c4447a' }, { key: 'm:me-empty', name: '내 빈 과제', color: '#888' }] });
    peer.ev('selectedDate = "2026-10-28"; view = {y: 2026, m: 9}; renderAll();');
  }
  const names = (g) => [...g.querySelectorAll('.wr-name')].map((n) => n.textContent.trim() + (n.classList.contains('mine') ? '(나)' : ''));
  const rowOf = (g, name) => { const n = [...g.querySelectorAll('.wr-name')].find((x) => x.textContent.trim() === name); return n ? n.nextElementSibling : null; };

  test('런타임④: 열람 창 겹쳐 보기 주간: 같은 DB 과제 줄 안에 내 막대(아래 차선), 겹치지 않는 내 과제는 굵은 선 아래 내 과제 줄(빈 과제도), 겹을 끄면 빠진다', async () => {
    const peer = bootWindow('https://tcapp.local/?peer=1');
    try {
      await settle();
      peerWeekData(peer, 'overlay');
      await settle();
      const g = peer.w.document.getElementById('grid');
      assert.ok(g.classList.contains('wrows'), '주간 과제별 줄이 아니다');
      assert.deepStrictEqual(names(g), ['공유 과제', '상대 공식', '상대 개인', '분류 없음', '내 개인(나)', '내 빈 과제(나)', '분류 없음(나)']);
      const shared = rowOf(g, '공유 과제');
      assert.deepStrictEqual([...shared.querySelectorAll('.chip')].map((c) => c.dataset.id + (c.classList.contains('chip-mine') ? '(나)' : '')), ['t1', 'm1(나)', 'm2(나)'], '공유 과제 줄에 상대 막대와 내 막대가 함께 있어야 한다');
      const lanes = (ids) => ids.map((id) => Number(shared.querySelector('.chip[data-id="' + id + '"]').dataset.lane));
      assert.ok(Math.min(...lanes(['m1', 'm2'])) > Math.max(...lanes(['t1'])), '내 막대는 상대 막대 아래 차선이어야 한다');
      assert.ok(!rowOf(g, '상대 공식').querySelector('.chip'), '상대만 가진 빈 공식 과제도 빈 줄로 보여야 한다');
      assert.strictEqual(g.querySelectorAll('.wr-gap').length, 1, '같은 과제 줄과 내 과제 줄 사이 굵은 선이 하나여야 한다');
      assert.ok(rowOf(g, '내 개인').querySelector('.chip[data-id="m3"].chip-mine'));
      // 겹 끄기: 내 막대와 내 과제 줄이 빠진다
      peer.ev('setPeerOverlay(false)');
      await settle();
      assert.deepStrictEqual(names(g), ['공유 과제', '상대 공식', '상대 개인', '분류 없음']);
      assert.ok(!g.querySelector('.chip-mine'), '겹을 껐는데 내 막대가 남았다');
    } finally {
      peer.close();
    }
  });

  test('런타임⑤: 열람 창 나란히 보기 주간: 같은 DB 과제가 위(양쪽 차선 수 같음), 각자 과제는 굵은 선 아래, 왼쪽에 내 막대 없음', async () => {
    const peer = bootWindow('https://tcapp.local/?peer=1');
    try {
      await settle();
      peerWeekData(peer, 'side');
      await settle();
      const doc = peer.w.document;
      const g1 = doc.getElementById('grid'), g2 = doc.getElementById('gridMine');
      assert.deepStrictEqual(names(g1), ['공유 과제', '상대 공식', '상대 개인', '분류 없음']);
      assert.deepStrictEqual(names(g2), ['공유 과제(나)', '내 개인(나)', '내 빈 과제(나)', '분류 없음(나)']);
      assert.ok(!g1.querySelector('.chip-mine'), '왼쪽(상대)에 내 막대가 있다');
      assert.ok(g2.querySelector('.chip') && [...g2.querySelectorAll('.chip')].every((c) => c.classList.contains('chip-mine')), '오른쪽은 내 막대만이어야 한다');
      // 공유 과제 줄은 양쪽 차선 수가 같다(상대 1, 나 2 → 둘 다 2)
      const tpl = (g) => rowOf(g, '공유 과제').style.gridTemplateRows;
      assert.strictEqual(tpl(g1), tpl(g2), '같은 DB 과제 줄 높이가 양쪽에서 다르다');
      assert.ok(/repeat\(2, 19px\)/.test(tpl(g1)), '공유 과제 줄이 큰 쪽 차선 수(2)를 따르지 않는다: ' + tpl(g1));
      assert.strictEqual(g1.querySelectorAll('.wr-gap').length, 1);
      assert.strictEqual(g2.querySelectorAll('.wr-gap').length, 1);
      // 주간에서도 [겹쳐 | 나란히] 단추는 그대로다(2026-10-30 사용자: 단추가 사라지지 않게)
      assert.strictEqual(doc.querySelectorAll('.peer-layout [data-layout]').length, 2, '주간에서 보기 방식 단추가 사라졌다');
    } finally {
      peer.close();
    }
  });

  test('변이M④: 같은 DB 과제 줄에서 내 막대 묶음을 빼면 공유 과제 줄에 내 막대가 없어진다(런타임④가 잡는 자리)', async () => {
    const bad = mutate(app, '[ofCat(theirs, c.id), showMine && shared.has(c.id) ? mineOf(c.id) : []]', '[ofCat(theirs, c.id), []]');
    const peer = bootWindow('https://tcapp.local/?peer=1', bad);
    try {
      await settle();
      peerWeekData(peer, 'overlay');
      await settle();
      const g = peer.w.document.getElementById('grid');
      assert.ok(!rowOf(g, '공유 과제').querySelector('.chip-mine'), '변이가 경로에 닿지 않았다');
    } finally {
      peer.close();
    }
  });

  test('런타임③: 주간 모드에서 날짜 제목(#btnTitle)과 탐색 버튼(#btnPrev, #btnNext)이 7일 단위로 이동한다', async () => {
    const main = bootWindow('https://tcapp.local/');
    try {
      await settle();
      const doc = main.w.document;

      // 특정 날짜로 기준 설정: 2026-10-21 (수요일)
      main.ev('selectedDate = "2026-10-21"; view = {y: 2026, m: 9}; setCalView("week");');
      await settle();

      const btnTitle = doc.getElementById('btnTitle');
      // 2026-10-19 ~ 25일, 월요일이 든 달
      assert.strictEqual(btnTitle.textContent, '2026년 10월');

      // 다음 주 이동 (#btnNext)
      doc.getElementById('btnNext').click();
      await settle();

      assert.strictEqual(main.ev('selectedDate'), '2026-10-28', 'selectedDate 가 +7일 이동해야 한다');
      // 2026-10-26 ~ 11월 1일, 월요일이 든 달(10월)
      assert.strictEqual(btnTitle.textContent, '2026년 10월');

      // 이전 주 이동 (#btnPrev)
      doc.getElementById('btnPrev').click();
      await settle();

      assert.strictEqual(main.ev('selectedDate'), '2026-10-21', 'selectedDate 가 -7일 이동해야 한다');
      assert.strictEqual(btnTitle.textContent, '2026년 10월');

      // 월간 모드로 복귀 시 ±1달 이동 검증
      main.ev('setCalView("month");');
      await settle();

      assert.strictEqual(btnTitle.textContent, '2026년 10월');
      doc.getElementById('btnNext').click();
      await settle();

      assert.strictEqual(main.ev('view.m'), 10, '월간 모드에서는 다음 달로 이동해야 한다');
      assert.strictEqual(btnTitle.textContent, '2026년 11월');
    } finally {
      main.close();
    }
  });
}

// ══════════════════════════════════════════════════════════════════════
// (M) 변이 시험(Mutation tests)
// ══════════════════════════════════════════════════════════════════════

test('변이M①: calViewKey 에서 PEER 분기를 제거하고 tc_calView 만 반환하면 검증이 실패한다', () => {
  const mutated = mutate(
    app,
    "function calViewKey(){ return PEER ? 'tc_peerView' : 'tc_calView'; }",
    "function calViewKey(){ return 'tc_calView'; }"
  );
  const code = extractFunction(mutated, 'calViewKey');
  const fn = new Function('PEER', code + '\nreturn calViewKey();');
  assert.throws(() => {
    assert.strictEqual(fn(true), 'tc_peerView');
  });
});

test('변이M②: calWeekRange 에서 월요일 시작 오프셋을 일요일 시작으로 바꾸면 검증이 실패한다', () => {
  const mutated = mutate(
    app,
    'const from = addDays(ds, -((parseYmd(ds).getDay() + 6) % 7));',
    'const from = addDays(ds, -parseYmd(ds).getDay());'
  );
  const helpers = [
    'function pad(n){ return String(n).padStart(2, "0"); }',
    'function ymd(d){ return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }',
    'function parseYmd(s){ const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }',
    'function addDays(s, n){ const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }',
    'function todayYmd(){ return "2026-10-30"; }',
  ].join('\n');
  const code = helpers + '\n' + extractFunction(mutated, 'calWeekRange');
  const fn = new Function(code + '\nreturn calWeekRange;');

  assert.throws(() => {
    // 2026-10-28 수요일에 대해 정상은 from: 2026-10-26(월)이지만 일요일 시작 변이는 from: 2026-10-25(일)가 됨
    const res = fn()('2026-10-28');
    assert.deepStrictEqual(res, { from: '2026-10-26', to: '2026-11-01', weeks: 1 });
  });
});

test('변이M③: stepCal 에서 moveWeek 호출을 빼버리면 주간 모드 이동 검증이 실패한다', () => {
  const mutated = mutate(
    app,
    "function stepCal(delta){\n  if(calView() === 'week') moveWeek(delta);\n  else moveMonth(delta);\n}",
    "function stepCal(delta){\n  moveMonth(delta);\n}"
  );
  const code = extractFunction(mutated, 'stepCal');
  let weekMoved = false, monthMoved = false;
  const runner = new Function('calViewVal', 'delta', `
    function calView(){ return calViewVal; }
    function moveWeek(){ weekMoved = true; }
    function moveMonth(){ monthMoved = true; }
    ${code}
    stepCal(delta);
  `);

  runner('week', 1);
  assert.throws(() => {
    assert.strictEqual(weekMoved, true, '주간 모드에서는 moveWeek 가 호출되어야 한다');
  });
});
