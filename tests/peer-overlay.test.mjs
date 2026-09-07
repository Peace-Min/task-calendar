// C4.1 「내 일정 겹쳐보기」 — 타인 일정 열람 창(`?peer=1`)에 **내 일정을 한 겹** 얹는 기능의 계약.
//
// 이 기능이 왜 시험하기 까다로운가:
//   · 열람 창은 **봉인된 창**이다(호스트로 나가는 문이 둘뿐이고 둘 다 잠겨 있다). 내 일정을
//     거기 넣는 일은 그 봉인을 건드리기 가장 쉬운 종류의 변경이다 — 그래서 "겹이 보인다"보다
//     "겹을 넣어도 여전히 아무것도 안 나간다"가 더 값진 계약이다.
//   · 반대로 "0 이 나왔다"는 **스텁이 고장 나도** 나온다. 그래서 통제군(C·PEER 아님)을 나란히
//     띄워 같은 스텁으로 `ready` 와 `saveState` 가 **실제로 나가는지**를 함께 본다.
//     통제군이 없으면 봉인 계약은 아무것도 증명하지 않는다.
//
// 층위: (1) jsdom 없이 도는 순수·정적 계약 → (2) jsdom 부팅 계약 → (3) 변이 시험.
// 생략 규약: jsdom 이 없으면 (2)(3)은 **등록되지 않고** skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

// ══════════════════════════════════════════════════════════════════════
// 0. 소스 변이 헬퍼 — 이 저장소 관례(app-context.test.mjs 의 withMutatedApp)와 같은 규칙:
//    앵커가 없거나 여러 곳이면 **조용히 통과하지 않고 실패**한다. 리팩터로 앵커가 사라졌는데
//    초록이면 그 변이 시험은 아무것도 지키지 않는 껍데기가 된다.
//    ★ 부팅이 필요 없는 변이(순수 함수·정적 배선)는 여기서 문자열만 바꿔 쓴다 — jsdom 부팅
//      1회 ≈ 0.4초를 아끼면서도 겨냥하는 것은 **실제 제품 텍스트** 그대로다.
// ══════════════════════════════════════════════════════════════════════
function mutateSource(find, replace) {
  const src = loadAppSource();
  const at = src.indexOf(find);
  assert.ok(at >= 0, '변이 앵커를 앱 소스에서 찾지 못했다(리팩터로 사라졌다면 앵커를 갱신할 것): ' + find);
  assert.strictEqual(at, src.lastIndexOf(find),
    '변이 앵커가 여러 곳에 있다 — 겨냥이 흐려진다. 앞뒤 줄을 붙여 유일하게 만들 것: ' + find);
  const mutated = src.slice(0, at) + replace + src.slice(at + find.length);
  assert.notStrictEqual(mutated, src, '변이가 원본을 바꾸지 못했다(find 와 replace 가 같다)');
  return mutated;
}

// 앱 소스에서 buildMineOverlay 만 잘라 **단독 함수**로 만든다.
// 전역·DOM 을 하나도 안 쓰는 함수라야 이게 가능하다 — 그 자체가 이 함수의 계약 중 하나다.
function overlayFnFrom(src) {
  const code = extractFunction(src, 'buildMineOverlay');
  return new Function(code + '\nreturn buildMineOverlay;')();
}

// ══════════════════════════════════════════════════════════════════════
// 1. buildMineOverlay 순수 계약 — "무엇을 보내는가"보다 **"무엇을 안 보내는가"**가 요점이다.
//    상대에게 주는 payload 를 최소로 깎아 둔(§C4) 것과 같은 원칙을 내 쪽에도 그대로 적용한다.
// ══════════════════════════════════════════════════════════════════════
// 결과 객체가 가져도 되는 키 — 이 목록이 곧 계약이다(늘리려면 여기부터 고쳐야 한다).
const ALLOWED_KEYS = ['id', 'date', 'title', 'allDay', 'startTime', 'endTime', 'endDate',
                      'recur', 'recurExcept', 'categoryId', '_mine'];
// 한 건이라도 새면 남의 화면에 내 개인 기록이 실린다.
const FORBIDDEN_KEYS = ['memo', 'location', 'remind', 'hours', 'source', 'commits',
                        'createdAt', 'updatedAt', 'taskHours', 'attendance'];

// 부모 state.entries 를 흉내낸 픽스처 — '진짜 엔트리'가 달고 다니는 필드를 일부러 다 붙여 둔다.
const PARENT_ENTRIES = Object.freeze([
  { id: 'e-m1', date: '2026-09-08', categoryId: 'c-me-A', title: '나: 회의 준비',
    allDay: false, startTime: '09:00', endTime: '10:00', endDate: '',
    location: '3층 소회의실', memo: '발표자료 인쇄', remind: 30, hours: 90,
    source: '', commits: [], recur: null, recurExcept: [],
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' },
  { id: 'e-m2', date: '2026-09-16', categoryId: 'c-me-B', title: '나: 출장',
    allDay: true, startTime: '', endTime: '', endDate: '2026-09-18',
    location: '', memo: '숙소 예약 완료', remind: 0, hours: null,
    source: '', commits: [],
    recur: { freq: 'weekly', interval: 2, until: '2026-12-31', count: 0, bogus: '이 키는 넘어가면 안 된다' },
    recurExcept: ['2026-09-30'],
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
  { id: 'e-g1', date: '2026-09-08', categoryId: 'c-me-A', title: '나: 커밋 기록',
    source: 'git', commits: [{ hash: 'abc', title: 'fix' }], memo: '', recur: null, recurExcept: [] },
]);

test('(순수) buildMineOverlay: 결과 객체의 키는 허용 목록과 정확히 일치한다(늘지도 줄지도 않는다)', () => {
  const fn = overlayFnFrom(loadAppSource());
  const out = fn(PARENT_ENTRIES);
  assert.strictEqual(out.length, 2, 'git 을 뺀 2건이 나와야 한다: ' + JSON.stringify(out.map(e => e.id)));
  for (const o of out) {
    assert.deepStrictEqual(Object.keys(o).slice().sort(), ALLOWED_KEYS.slice().sort(),
      `허용 키와 다르다(id=${o.id}): ` + JSON.stringify(Object.keys(o)));
  }
});

test('(순수) buildMineOverlay: 메모·장소·알림·공수·커밋·생성시각은 한 건도 넘어가지 않는다', () => {
  const fn = overlayFnFrom(loadAppSource());
  const out = fn(PARENT_ENTRIES);
  const leaked = [];
  for (const o of out) for (const k of FORBIDDEN_KEYS) if (k in o) leaked.push(`${o.id}.${k}`);
  assert.deepStrictEqual(leaked, [], '금지 키가 겹에 실렸다 — 남의 화면에 내 개인 기록이 간다');
  // 값으로도 확인한다 — 키 이름을 바꿔 담는 경우까지 잡는다.
  const blob = JSON.stringify(out);
  for (const secret of ['발표자료 인쇄', '3층 소회의실', '숙소 예약 완료', 'abc']) {
    assert.ok(!blob.includes(secret), `겹 payload 에 '${secret}' 이 남아 있다: ` + blob);
  }
});

test('(순수) buildMineOverlay: source==="git"(커밋 기록)은 겹에서 제외한다', () => {
  const fn = overlayFnFrom(loadAppSource());
  const ids = fn(PARENT_ENTRIES).map(e => e.id);
  assert.deepStrictEqual(ids, ['e-m1', 'e-m2'], '커밋 기록이 겹에 섞였다: ' + JSON.stringify(ids));
});

test('(순수) buildMineOverlay: 모든 항목이 _mine:true · categoryId:null 이다(과제 구분 없는 한 겹)', () => {
  const fn = overlayFnFrom(loadAppSource());
  for (const o of fn(PARENT_ENTRIES)) {
    assert.strictEqual(o._mine, true, `_mine 태그가 없다(id=${o.id}) — 렌더가 내 겹을 구분하지 못한다`);
    assert.strictEqual(o.categoryId, null, `categoryId 가 남았다(id=${o.id}) — 내 과제가 상대 필터바로 샌다`);
  }
});

test('(순수) buildMineOverlay: recur 는 freq/interval/until/count 만 복사하고 예외일은 recurExcept 로 간다', () => {
  const fn = overlayFnFrom(loadAppSource());
  const out = fn(PARENT_ENTRIES);
  const m1 = out.find(e => e.id === 'e-m1'), m2 = out.find(e => e.id === 'e-m2');
  assert.strictEqual(m1.recur, null, '반복 없는 일정의 recur 는 null 이어야 한다');
  assert.deepStrictEqual(m1.recurExcept, [], '반복 없는 일정의 예외일은 빈 배열');
  assert.deepStrictEqual(Object.keys(m2.recur).slice().sort(), ['count', 'freq', 'interval', 'until'],
    'recur 에 계약 밖 키가 실렸다: ' + JSON.stringify(Object.keys(m2.recur)));
  assert.strictEqual(m2.recur.freq, 'weekly');
  assert.strictEqual(m2.recur.interval, 2);
  assert.strictEqual(m2.recur.until, '2026-12-31');
  // ★ 예외일은 **엔트리 레벨**이다(expandOccurrences 가 e.recurExcept 를 본다).
  //   recur 안에 넣으면 전개가 못 읽어 내가 지운 반복 회차가 열람 창에서 되살아난다.
  assert.deepStrictEqual(m2.recurExcept, ['2026-09-30'], '예외일이 recurExcept 로 안 왔다');
});

test('(순수) buildMineOverlay: 비배열 입력은 [] 를 돌려준다(부모 state 가 아직 안 섰을 때 방어)', () => {
  const fn = overlayFnFrom(loadAppSource());
  for (const bad of [null, undefined, 0, '', 'entries', {}, { length: 2 }]) {
    assert.deepStrictEqual(fn(bad), [], '비배열 입력에서 [] 가 아니다: ' + JSON.stringify(bad));
  }
});

test('(순수) buildMineOverlay: 입력 배열·항목·예외일 배열을 변형하지 않는다(부모 state 는 읽기만)', () => {
  const fn = overlayFnFrom(loadAppSource());
  const before = JSON.stringify(PARENT_ENTRIES);
  const out = fn(PARENT_ENTRIES);
  // 결과를 마음껏 헤집어도 부모가 안 흔들려야 한다 — 참조로 넘기면 여기서 터진다.
  out[1].recurExcept.push('2026-10-31');
  out[0].title = '바뀜';
  assert.strictEqual(JSON.stringify(PARENT_ENTRIES), before,
    '겹을 만들면서 부모 entries 를 건드렸다 — 부모 state 는 읽기만 해야 한다');
});

// ══════════════════════════════════════════════════════════════════════
// 2. 정적 배선 계약 — 부모가 **state.entries 를 그대로** 보내지 않는다.
//    (이건 런타임으로도 볼 수 있지만, mountPeerFrame 은 iframe load 이벤트 안에서만 도는
//     경로라 부팅만으로는 지나가지 않는다. 그래서 텍스트로 못박는다.)
// ══════════════════════════════════════════════════════════════════════
function peerFrameWiringHasFilter(src) {
  return extractFunction(src, 'mountPeerFrame').includes('buildMineOverlay(');
}

test('(정적) 배선: mountPeerFrame 은 부모 state 를 buildMineOverlay 로 걸러서 내려보낸다', () => {
  const src = loadAppSource();
  assert.ok(peerFrameWiringHasFilter(src),
    'mountPeerFrame 이 buildMineOverlay 를 부르지 않는다 — 걸러지지 않은 내 데이터가 열람 창으로 간다');
  assert.ok(extractFunction(src, 'mountPeerFrame').includes('.concat(buildMineOverlay(state.entries))'),
    '겹이 상대 entries 뒤에 붙는 형태가 아니다(배선이 바뀌었다면 이 계약도 함께 갱신할 것)');
});

// ── 변이③ buildMineOverlay 가 memo 를 복사한다 → 최소 payload 계약이 깨진다 ──
test('변이③: buildMineOverlay 가 memo 를 복사하면 최소 payload 계약이 깨진다(개인 기록 유출)', () => {
  const ok = overlayFnFrom(loadAppSource())(PARENT_ENTRIES);
  assert.ok(!JSON.stringify(ok).includes('발표자료 인쇄'), '사전조건: 정상 앱은 메모를 안 보낸다');

  const fn = overlayFnFrom(mutateSource(
    '      id: e.id, date: e.date, title: e.title,',
    '      id: e.id, date: e.date, title: e.title, memo: e.memo,'));
  const out = fn(PARENT_ENTRIES);
  assert.ok(JSON.stringify(out).includes('발표자료 인쇄'),
    '변이했는데도 메모가 안 실린다 — 변이가 실제 복사 경로에 닿지 않았다(앵커 재검토)');
  const leaked = out.some(o => FORBIDDEN_KEYS.some(k => k in o));
  assert.ok(leaked, '금지 키가 실렸는데도 계약이 못 잡는다 — 허용 키 계약이 키 목록을 안 본다');
  assert.throws(() => {
    for (const o of out) {
      assert.deepStrictEqual(Object.keys(o).slice().sort(), ALLOWED_KEYS.slice().sort());
    }
  }, '허용 키 계약이 늘어난 키를 통과시킨다');
});

// ── 변이④ buildMineOverlay 가 커밋을 안 거른다 → 캘린더에 안 그리는 기록이 남의 화면에 뜬다 ──
test('변이④: buildMineOverlay 가 source==="git" 을 안 거르면 커밋 제외 계약이 깨진다', () => {
  assert.deepStrictEqual(overlayFnFrom(loadAppSource())(PARENT_ENTRIES).map(e => e.id), ['e-m1', 'e-m2'],
    '사전조건: 정상 앱은 커밋 기록을 겹에서 뺀다');

  const fn = overlayFnFrom(mutateSource(
    "    if(!e || e.source === 'git') continue;",
    '    if(!e) continue;'));
  const ids = fn(PARENT_ENTRIES).map(e => e.id);
  assert.ok(ids.includes('e-g1'),
    '변이했는데도 커밋이 안 실린다 — 변이가 걸러내는 자리에 닿지 않았다(앵커 재검토): ' + JSON.stringify(ids));
  assert.notDeepStrictEqual(ids, ['e-m1', 'e-m2'], '커밋 제외 계약이 결과 id 목록을 안 본다');
});

// ── 변이⑤ 부모가 state.entries 를 그대로 concat → 걸러지지 않은 내 데이터가 통째로 간다 ──
test('변이⑤: 부모가 buildMineOverlay 를 건너뛰고 state.entries 를 그대로 보내면 배선 계약이 깨진다', () => {
  assert.ok(peerFrameWiringHasFilter(loadAppSource()), '사전조건: 정상 앱은 걸러서 보낸다');
  const mutated = mutateSource('.concat(buildMineOverlay(state.entries))', '.concat(state.entries)');
  assert.ok(!peerFrameWiringHasFilter(mutated),
    '변이했는데도 배선 계약이 통과한다 — 계약이 mountPeerFrame 본문을 안 본다');
});

// ══════════════════════════════════════════════════════════════════════
// 3. jsdom 부팅 계약
// ══════════════════════════════════════════════════════════════════════
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;

if (!JSDOM) {
  // ★ 통과가 아니라 '판정 없음'이다 — 러너가 exit 2 로 끝난다(strict 에서는 fail).
  skip('peer-overlay: jsdom 미설치 — 열람 창 부팅·렌더·봉인 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  // ★ 부팅 옵션은 **팩토리 하나**에서만 나온다 — 정상 창과 변이 창의 옵션이 갈리면
  //   "변이 때문에 결과가 달라졌다"고 말할 수 없다(부팅 차이가 설명이 돼 버린다).
  //   WebView2 는 iframe 에도 chrome.webview 를 주입한다(§C4 실측) → 열람 창도 HOST=true 로 띄운다.
  const bootOpts = (url, posted) => ({
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url,
    beforeParse(window) {
      window.chrome = { webview: {
        postMessage: (s) => posted.push(String(s)),
        addEventListener() {}, removeEventListener() {},
      } };
      if (typeof window.crypto === 'undefined') {
        window.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: a => a };
      }
      window.scrollTo = () => {};
    },
  });

  const PEER_URL = 'https://tcapp.local/?peer=1';
  const MAIN_URL = 'https://tcapp.local/';

  // 창 하나를 띄우고 헬퍼 묶음을 돌려준다. src 를 받으므로 변이 소스에도 그대로 쓴다.
  function boot(src, url) {
    const posted = [];
    const dom = new JSDOM(src, bootOpts(url, posted));
    const w = dom.window;
    const ev = (code) => w.eval(code);
    return {
      dom, w, posted, ev,
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      cmds: () => posted.map(s => { try { return JSON.parse(s).cmd; } catch (_) { return '(비JSON)'; } }),
      close: () => { try { w.close(); } catch (_) {} },
    };
  }

  // ── 결정적 픽스처 — 상대 과제 2개·일정 3건(하나는 기간) + 내 일정 2건(하나는 기간, 하나는 시간).
  //    9월 8일에 상대 2건과 내 1건이 **같은 날 겹치게** 놓았다(겹의 존재 이유가 그 날에 보인다).
  const PEER_CATS = [
    { id: 'c-A', name: '설계 검토', color: '#c0392b' },
    { id: 'c-B', name: '보고서 작성', color: '#2980b9' },
  ];
  const PEER_ES = [
    { id: 'e-p1', date: '2026-09-08', categoryId: 'c-A', title: '상대: 설계회의', startTime: '10:00', endTime: '11:00' },
    { id: 'e-p2', date: '2026-09-08', categoryId: 'c-B', title: '상대: 주간보고' },
    { id: 'e-p3', date: '2026-09-15', categoryId: 'c-A', title: '상대: 통합시험', endDate: '2026-09-17' },
  ];
  // buildMineOverlay 가 만들어 내는 것과 **같은 모양**(계약 1이 그 모양을 지킨다).
  const MINE_ES = [
    { id: 'e-m1', date: '2026-09-08', title: '나: 회의 준비', allDay: false,
      startTime: '09:00', endTime: '10:00', endDate: '', recur: null, recurExcept: [], categoryId: null, _mine: true },
    { id: 'e-m2', date: '2026-09-16', title: '나: 출장', allDay: true,
      startTime: '', endTime: '', endDate: '2026-09-18', recur: null, recurExcept: [], categoryId: null, _mine: true },
  ];
  const MIX = {
    categories: PEER_CATS, entries: [...PEER_ES, ...MINE_ES],
    todos: [], rooms: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '',
  };
  // 격자에 뜨는 칩 수 — 기간 일정은 날짜마다 한 조각이다.
  const MINE_CHIPS = 4;   // e-m1(1일) + e-m2(16·17·18)
  const PEER_CHIPS = 5;   // e-p1 + e-p2 + e-p3(15·16·17)

  const settle = () => new Promise(r => setTimeout(r, 60));
  // 창에 픽스처를 넣고 9월 8일을 고른다(선택 날짜가 겹치는 날이라야 일자 패널 계약이 성립한다).
  function inject(m, data = MIX, meta = { peerName: '홍길동', canWrite: false }) {
    m.ev('view = {y:2026, m:8}; selectedDate = "2026-09-08";');
    m.w.__applyState(JSON.stringify(data), meta);
  }

  let P = null, C = null, bootErr = null;
  try {
    const src = loadAppSource();
    P = boot(src, PEER_URL);
    C = boot(src, MAIN_URL);
  } catch (e) {
    bootErr = e;
  }

  if (bootErr) {
    test('peer-overlay: jsdom 부팅 실패(조사 필요)', () => { throw bootErr; });
  } else {
    // ── 계약 2. 열람 창 부팅 조건 ────────────────────────────────────
    test('P 부팅: ?peer=1 은 PEER=true · HOST=true 이고 호스트로 아무것도 안 보낸다(ready 미전송)', async () => {
      await settle();
      assert.strictEqual(P.ev('PEER'), true, '?peer=1 인데 PEER 가 안 섰다');
      assert.strictEqual(P.ev('HOST'), true, 'WebView2 는 iframe 에도 chrome.webview 를 넣는다 — HOST 는 true 여야 한다');
      assert.deepStrictEqual(P.posted, [],
        '열람 창 부팅이 호스트로 무언가 보냈다 — ready 를 보내면 호스트가 **내** 캘린더를 그 창에 주입한다');
    });

    test('P 부팅: 데이터가 오기 전 씨앗은 비어 있다(localStorage 를 읽어 오지 않는다)', () => {
      assert.strictEqual(P.ev('state.entries.length'), 0);
      assert.strictEqual(P.ev('state.categories.length'), 0);
    });

    // ── 계약 3. 혼합본 주입 ──────────────────────────────────────────
    test('P 주입: 혼합본(상대 3 + 내 2)이 그대로 들어가고 _mine 태그가 보존된다', async () => {
      inject(P);
      await settle();
      assert.strictEqual(P.ev('state.entries.length'), 5);
      assert.strictEqual(P.ev('state.categories.length'), 2, '내 과제는 안 보내므로 상대 과제 2개뿐이어야 한다');
      assert.strictEqual(P.ev('state.entries.filter(function(e){return e._mine;}).length'), 2,
        '_mine 이 사라지면 렌더가 내 겹을 구분하지 못한다');
    });

    test('P 주입: 겹을 넣어도 호스트로 나간 메시지는 여전히 0(pushReminders 까지 봉인 — 알림 이중발화 없음)', () => {
      assert.deepStrictEqual(P.posted, [],
        '내 일정을 넣은 뒤 호스트로 메시지가 나갔다 — 내 알림이 열람 창에서 한 번 더 발화한다');
    });

    // ── 계약 4. 렌더 ────────────────────────────────────────────────
    test('P 렌더: 월 격자에 상대 일정과 내 일정이 함께 그려진다', () => {
      const t = P.ev('document.getElementById("grid").textContent');
      for (const s of ['상대: 설계회의', '상대: 통합시험', '나: 회의 준비', '나: 출장']) {
        assert.ok(t.includes(s), `격자에 '${s}' 가 없다`);
      }
    });

    test('P 렌더: 내 칩만 .chip-mine 이고 전부 draggable="false" 다(끌 수 있는 척하지 않는다)', () => {
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip").length'), MINE_CHIPS + PEER_CHIPS);
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), MINE_CHIPS);
      assert.deepStrictEqual(
        P.evJSON('Array.prototype.map.call(document.querySelectorAll("#grid .chip.chip-mine"), function(c){return c.getAttribute("draggable");})'),
        new Array(MINE_CHIPS).fill('false'));
      // 상대 칩은 그대로 둔다 — 이번 변경이 남의 칩 모양을 건드리면 안 된다.
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip.chip-mine.chip-git").length'), 0);
    });

    test('P 렌더: 일자 패널(9/8)에 상대 카드 2 + 내 카드 1(.card-mine) 이 함께 선다', () => {
      assert.strictEqual(P.ev('document.querySelectorAll("#dpBody .card").length'), 3);
      assert.strictEqual(P.ev('document.querySelectorAll("#dpBody .card.card-mine").length'), 1);
      assert.strictEqual(P.ev('document.querySelector("#dpBody .card.card-mine .card-title").textContent'), '나: 회의 준비');
    });

    test('P 배너: 이름 · 읽기 전용 · 겹 토글 · 범례가 함께 뜬다(체크 초기값 = 저장값)', () => {
      const b = P.ev('document.getElementById("peerBanner").textContent');
      assert.ok(b.includes('홍길동 님의 일정'), '배너에 이름이 없다: ' + b);
      assert.ok(b.includes('읽기 전용'), '배너에 읽기 전용 표시가 없다: ' + b);
      assert.ok(b.includes('내 일정 겹쳐보기'), '배너에 겹 토글이 없다: ' + b);
      assert.ok(b.includes('점선 = 내 일정'), '배너에 범례가 없다 — 점선이 무엇인지 알 방법이 없다: ' + b);
      assert.strictEqual(P.ev('document.getElementById("peerOverlayToggle").checked'), true);
      assert.strictEqual(P.ev('String(document.body.dataset.peerOverlay)'), '1');
    });

    // ── 계약 5. 필터 — 내 겹은 상대 과제 축을 타지 않는다 ──────────────
    test('P 필터(과제): 상대 과제 하나만 켜면 상대 일정만 걸러지고 내 겹은 그대로 남는다', () => {
      P.ev('filterCatId = "c-A"; renderAll();');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), MINE_CHIPS,
        '상대 과제 필터가 내 겹까지 걷어냈다 — 내 일정이 없는 날처럼 보인다');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip:not(.chip-mine)").length'), 4,
        'c-A(e-p1 1조각 + e-p3 3조각)만 남아야 한다');
      assert.ok(!P.ev('document.getElementById("grid").textContent').includes('상대: 주간보고'),
        '상대 과제 필터가 상대 일정에는 걸려야 한다');
      P.ev('filterCatId = null; renderAll();');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip").length'), MINE_CHIPS + PEER_CHIPS);
    });

    test('P 필터(출처): filterSource 를 켜도 내 겹은 그대로다(겹은 소스 축과도 무관)', () => {
      P.ev('filterSource = "git"; renderAll();');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), MINE_CHIPS,
        '출처 필터가 내 겹을 걷어냈다');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip:not(.chip-mine)").length'), 0,
        '사전조건: 상대 일정에는 source 가 없으므로 git 필터에서 전부 빠져야 한다');
      P.ev('filterSource = null; renderAll();');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip").length'), MINE_CHIPS + PEER_CHIPS);
    });

    // ── 계약 6. 필터바 ──────────────────────────────────────────────
    test('P 필터바: 칩은 「전체」+ 상대 과제뿐이고, 상대 과제 건수에 내 일정이 안 섞인다', () => {
      const chips = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#filterbar .fchip"), function(b){return b.textContent.trim().replace(/\\s+/g," ");})');
      assert.strictEqual(chips.length, PEER_CATS.length + 1,
        '필터바 칩 수가 「전체」+ 상대 과제와 다르다(내 과제가 샜다): ' + JSON.stringify(chips));
      assert.deepStrictEqual(chips, ['전체', '설계 검토 2', '보고서 작성 1'],
        '내 일정이 상대 과제 건수에 섞이면 숫자가 커진다: ' + JSON.stringify(chips));
    });

    // ── 계약 7. 토글 ────────────────────────────────────────────────
    test('P 토글: 끄면 겹이 사라지고(data-peer-overlay 해제 · localStorage "0"), 켜면 돌아온다', () => {
      P.ev('setPeerOverlay(false);');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), 0);
      assert.strictEqual(P.ev('document.querySelectorAll("#dpBody .card.card-mine").length'), 0);
      assert.strictEqual(P.ev('String(document.body.dataset.peerOverlay)'), 'undefined',
        'CSS 스위치가 안 풀렸다 — 렌더가 늦어도 겹이 즉시 사라져야 한다');
      assert.strictEqual(P.ev('localStorage.getItem("tc_peerOverlay")'), '0');
      // 상대 일정은 토글과 무관하다.
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip").length'), PEER_CHIPS);

      P.ev('setPeerOverlay(true);');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), MINE_CHIPS);
      assert.strictEqual(P.ev('String(document.body.dataset.peerOverlay)'), '1');
      assert.strictEqual(P.ev('localStorage.getItem("tc_peerOverlay")'), '1');
    });

    test('P 토글: 배너 체크박스를 조작하면 그대로 반영된다(핸들러가 붙어 있다)', () => {
      const t = 'document.getElementById("peerOverlayToggle")';
      P.ev(t + '.checked = false; ' + t + '.dispatchEvent(new Event("change"));');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), 0,
        '체크박스 change 가 겹을 안 끈다 — 토글이 배선되지 않았다');
      P.ev(t + '.checked = true; ' + t + '.dispatchEvent(new Event("change"));');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), MINE_CHIPS);
    });

    test('P 토글: 새로 뜬 열람 창은 저장된 설정을 읽는다(꺼 뒀으면 꺼진 채로 뜬다)', async () => {
      const P2 = boot(loadAppSource(), PEER_URL);
      try {
        await settle();
        P2.ev('localStorage.setItem("tc_peerOverlay","0");');   // 지난번에 꺼 두고 닫았다
        inject(P2);
        await settle();
        assert.strictEqual(P2.ev('__peerOverlay'), false, '저장된 "0" 을 안 읽었다');
        assert.strictEqual(P2.ev('document.getElementById("peerOverlayToggle").checked'), false,
          '체크박스가 저장값과 어긋난다 — 화면과 상태가 다른 말을 한다');
        assert.strictEqual(P2.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), 0);
        assert.strictEqual(P2.ev('document.querySelectorAll("#grid .chip").length'), PEER_CHIPS,
          '상대 일정은 저장값과 무관하게 그대로 떠야 한다');
        assert.deepStrictEqual(P2.posted, [], '설정을 읽는 경로에서도 호스트로는 아무것도 안 나간다');
      } finally { P2.close(); }
    });

    // ── 계약 8. 봉인(혼합본 상태) ────────────────────────────────────
    test('P 봉인: 내 것·상대 것 삭제·추가·직접주입+save() 를 다 해도 state 가 원본으로 되돌아온다', async () => {
      const before = P.evJSON('state.entries.map(function(e){return e.id;})');
      assert.deepStrictEqual(before.slice().sort(), ['e-m1', 'e-m2', 'e-p1', 'e-p2', 'e-p3'], '사전조건: 혼합본 5건');
      P.ev('deleteEntry("e-m1");');                                            // 내 겹을 지워 본다
      P.ev('deleteEntry("e-p1");');                                            // 남의 것을 지워 본다
      P.ev('try{ addEntry({date:"2026-09-09", title:"침입"}); }catch(_){}');
      P.ev('state.entries.push({id:"e-inject", date:"2026-09-09", title:"직접주입"}); save();');
      await settle();
      assert.deepStrictEqual(P.evJSON('state.entries.map(function(e){return e.id;})'), before,
        'peerRevert 가 원본으로 못 되돌렸다');
      assert.strictEqual(P.ev('state.entries.filter(function(e){return e._mine;}).length'), 2,
        '되돌린 뒤 _mine 이 사라졌다 — 겹이 통째로 안 보이게 된다');
    });

    test('P 봉인: 편집 시도를 다 하고도 호스트로 나간 메시지가 0 이다(hostRequest·hpost 직접 호출까지)', async () => {
      P.ev('try{ hostRequest("peerSchedule", {loginId:"x"}, 50).catch(function(){}); }catch(_){}');
      P.ev('try{ hpost({cmd:"saveState"}); }catch(_){}');
      await settle();
      assert.deepStrictEqual(P.posted, [],
        '겹을 얹은 뒤에도 문은 둘뿐이고 둘 다 잠겨 있어야 한다: ' + JSON.stringify(P.posted));
    });

    // ── 계약 9. 통제군 — 위의 "0" 이 스텁 고장이 아님을 증명한다 ────────
    test('C 통제군: ?peer=1 없이 뜬 창은 PEER=false 이고 부팅이 ready 를 실제로 보낸다', async () => {
      await settle();
      assert.strictEqual(C.ev('PEER'), false);
      assert.strictEqual(C.ev('HOST'), true);
      assert.ok(C.cmds().includes('ready'),
        '같은 스텁인데 ready 도 안 나갔다 — P 의 "0" 은 봉인의 증거가 아니라 스텁 고장의 증거가 된다: '
        + JSON.stringify(C.cmds()));
    });

    test('C 통제군: push + save() 가 state 를 바꾸고 saveState 를 실제로 내보낸다', async () => {
      inject(C, { ...MIX, entries: [...PEER_ES] }, { canWrite: true });
      await settle();
      const n = C.ev('state.entries.length');
      C.ev('state.entries.push({id:"e-ctl", date:"2026-09-09", title:"통제군 추가"}); save();');
      await settle();
      assert.strictEqual(C.ev('state.entries.length'), n + 1, '통제군에서는 state 가 실제로 바뀌어야 한다');
      assert.ok(C.cmds().includes('saveState'),
        '통제군에서 saveState 가 안 나갔다 — 스텁이 죽었다면 P 의 봉인 계약은 아무것도 증명하지 않는다: '
        + JSON.stringify(C.cmds()));
    });

    test('C 통제군: 열람 창이 아닌 창에 _mine 이 들어와도 그리지 않는다(passFilter 의 PEER && )', async () => {
      inject(C, MIX, { canWrite: true });
      await settle();
      assert.strictEqual(C.ev('state.entries.filter(function(e){return e._mine;}).length'), 2,
        '사전조건: 통제군 state 에도 _mine 이 2건 들어가 있다');
      assert.strictEqual(C.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), 0);
      const t = C.ev('document.getElementById("grid").textContent');
      assert.ok(!t.includes('나: 회의 준비') && !t.includes('나: 출장'),
        '내 창에 겹이 그려졌다 — 겹은 열람 창 전용이다');
      assert.ok(t.includes('상대: 설계회의'), '사전조건: 나머지 일정은 정상적으로 그려진다');
    });

    // ══════════════════════════════════════════════════════════════════
    // 4. 변이 시험(부팅이 필요한 것만) — "통과한다"가 "검사하고 있다"인지 못박는다.
    //    ★ 앵커가 없거나 여러 곳이면 실패한다(mutateSource). 옵션은 정상 부팅과 공유한다.
    // ══════════════════════════════════════════════════════════════════
    async function withMutatedApp(find, replace, url, fn) {
      const m = boot(mutateSource(find, replace), url);
      try {
        await settle();
        return await fn(m);
      } finally { m.close(); }
    }

    // ── 변이① passFilter 의 _mine 우회를 없앤다 → 상대 과제를 켜는 순간 내 겹이 사라진다 ──
    test('변이①: passFilter 에서 _mine 우회를 빼면 「겹은 상대 과제 필터를 안 탄다」 계약이 깨진다', async () => {
      P.ev('filterCatId = "c-A"; renderAll();');
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), MINE_CHIPS,
        '사전조건: 정상 앱은 상대 과제를 켜도 내 겹을 남긴다');
      P.ev('filterCatId = null; renderAll();');

      await withMutatedApp(
        '  if(e && e._mine) return PEER && __peerOverlay;',
        '  if(e && e._mine && false) return PEER && __peerOverlay;',
        PEER_URL,
        async (m) => {
          inject(m);
          await settle();
          assert.strictEqual(m.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), MINE_CHIPS,
            '사전조건: 필터가 꺼져 있으면 변이 앱에서도 겹이 보인다(변이는 과제 축만 건드린다)');
          m.ev('filterCatId = "c-A"; renderAll();');
          assert.strictEqual(m.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), 0,
            '변이했는데도 겹이 남아 있다 — 변이가 필터 경로에 닿지 않았다(앵커 재검토)');
        });
    });

    // ── 변이② chipHtml 이 chip-mine 을 안 붙인다 → 내 겹이 상대 칩과 구분되지 않는다 ──
    test('변이②: chipHtml 이 chip-mine 을 안 붙이면 「내 칩은 점선으로 구분된다」 계약이 깨진다', async () => {
      assert.strictEqual(P.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), MINE_CHIPS,
        '사전조건: 정상 앱은 내 칩에 chip-mine 을 붙인다');

      await withMutatedApp(
        "${mine?' chip-mine':''}",
        "${false?' chip-mine':''}",
        PEER_URL,
        async (m) => {
          inject(m);
          await settle();
          assert.strictEqual(m.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), 0,
            '변이했는데도 chip-mine 이 붙는다 — 변이가 칩 생성 경로에 닿지 않았다(앵커 재검토)');
          // ★ 겹 자체는 여전히 그려진다 — 사라지는 건 '구분'뿐이다. 이걸 확인해야
          //   "겹이 안 보여서 0" 과 "구분이 없어서 0" 을 혼동하지 않는다.
          assert.ok(m.ev('document.getElementById("grid").textContent').includes('나: 회의 준비'),
            '변이가 겹을 통째로 없앴다 — 이 변이는 클래스만 겨냥해야 한다');
          assert.strictEqual(m.ev('document.querySelectorAll("#grid .chip").length'), MINE_CHIPS + PEER_CHIPS);
        });
    });

    // ── 변이⑥ passFilter 의 PEER && 를 뺀다 → 내 창에도 _mine 이 그려진다 ──
    test('변이⑥: passFilter 에서 PEER && 를 빼면 「겹은 열람 창 전용」 계약이 깨진다', async () => {
      assert.strictEqual(C.ev('document.querySelectorAll("#grid .chip.chip-mine").length'), 0,
        '사전조건: 정상 앱의 내 창에는 겹이 안 그려진다');

      await withMutatedApp(
        '  if(e && e._mine) return PEER && __peerOverlay;',
        '  if(e && e._mine) return __peerOverlay;',
        MAIN_URL,
        async (m) => {
          inject(m, MIX, { canWrite: true });
          await settle();
          assert.strictEqual(m.ev('PEER'), false, '사전조건: 통제군 URL 이라 PEER 는 false 다');
          assert.ok(m.ev('document.querySelectorAll("#grid .chip.chip-mine").length') > 0,
            '변이했는데도 내 창에 겹이 안 그려진다 — 변이가 필터 경로에 닿지 않았다(앵커 재검토)');
          assert.ok(m.ev('document.getElementById("grid").textContent').includes('나: 회의 준비'),
            '변이 앱의 내 창에 겹이 실제로 떠야 한다(계약 10 이 잡아야 할 상태)');
        });
    });

    // 뒷정리 — 다음 파일이 열린 창·타이머를 물려받지 않게.
    test('peer-overlay: 뒷정리(창 닫기)', () => {
      P.close(); C.close();
    });
  }
}
