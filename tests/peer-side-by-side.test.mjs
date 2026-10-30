// 「나란히 보기」(docs/PEER-SIDE-BY-SIDE.md S1–S12 · 수용 R1·R2·R4–R7) — 열람 창(`?peer=1`)의 두 번째 보기 방식.
//
// tests/peer-overlay-redesign.test.mjs 가 「겹쳐 보기」의 모양을 지킨다면, 이 파일은
// "같은 데이터를 **섞지 않고** 두 달력으로 나눠 보이는가 · 그러면서도 겹쳐 보기(기본)는 그대로인가" 를 지킨다:
//   (S) 정적 — 분할 버튼 마크업(aria-pressed = 상태) · 새 규칙에 hex 없음(토큰만, S12) · 새 함수에 hpost 없음(봉인, S11) ·
//       「끈 상태」 감추기 규칙이 나란히 보기를 빼놓는다(S9).
//   (R) jsdom — R1 전환·저장·다시 열기·이상값·내 창에는 없음 / R2 두 달력·이름 탭·내용 나누기 / R4 접힌 패널 → 시트 · 두 묶음 · 닫기 /
//       R5 달 이동·선택 양쪽 동기 / R6 겹침 점 양쪽 / R7 겹 토글 감춤 · tc_peerOverlay 보존 /
//       S4 줄 맞춤(측정값을 주입해 판정 — jsdom 은 레이아웃이 없다) / S11 오른쪽 달력은 클릭 선택뿐 · 아무것도 안 나감 /
//       겹쳐 보기 기본값 회귀 없음(#gridMine 비어 있음 · 왕복 뒤 #grid 바이트 동일).
//   (M) 변이 — 왼쪽 거르기 빼기 · 오른쪽 선택 동기 빼기 · 「끈 상태」 규칙에서 나란히 보기 빼기 되돌림 — 각각 잡힌다.
//
// ★ R3(실제 줄 높이 ±1px)·R8(좁은 창 쌓기)·R9(실 위젯 봉인 루프)는 레이아웃이 있어야 한다 → 실 위젯(tests/loop-peer-frame.mjs 나란히 보기 라운드).
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 **등록되지 않고** skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

// 앵커 하나를 정확히 한 번 바꾼다 — 없거나 여럿이면 실패(조용히 통과하는 껍데기 변이를 막는다).
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다(리팩터로 사라졌다면 앵커를 갱신할 것): ' + find.slice(0, 120));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 120));
  const out = text.slice(0, a) + repl + text.slice(a + find.length);
  assert.notStrictEqual(out, text, '변이가 원본을 바꾸지 못했다');
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// (S) 정적 계약
// ══════════════════════════════════════════════════════════════════════
function styleOf(src) {
  const s = src.indexOf('<style>'), e = src.indexOf('</style>', s);
  assert.ok(s >= 0 && e > s, '<style> 블록을 찾지 못함');
  return src.slice(s + 7, e).replace(/\/\*[\s\S]*?\*\//g, '');
}
const cssRules = (src) => [...styleOf(src).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));

function layoutFn(src) {
  const code = extractFunction(src, 'peerLayoutHtml');
  return (cur) => new Function('__peerLayout', code + '\nreturn peerLayoutHtml;')(cur);
}
test('(정적) S1: 분할 버튼 = button type=button 두 개(겹쳐 보기 · 나란히 보기) · aria-pressed 가 상태와 같다 · 묶음 이름', () => {
  for (const cur of ['overlay', 'side']) {
    const h = layoutFn(app)(cur)();
    assert.match(h, /^<span class="seg seg-auto peer-layout" role="group" aria-label="보기 방식\(이 창에만 적용\)">/, h);
    const btns = [...h.matchAll(/<button ([^>]*)>([^<]*)<\/button>/g)].map(m => [m[1], m[2]]);
    assert.deepStrictEqual(btns.map(b => b[1]), ['겹쳐 보기', '나란히 보기']);
    for (const [attrs] of btns) {
      assert.match(attrs, /type="button"/);
      const v = /data-layout="(\w+)"/.exec(attrs)[1];
      assert.match(attrs, new RegExp(`aria-pressed="${v === cur}"`), `${cur}: ${v} 버튼의 aria-pressed 가 상태와 다르다`);
      assert.strictEqual(/class="seg-b active"/.test(attrs), v === cur, `${cur}: ${v} 버튼의 active 가 상태와 다르다`);
    }
  }
});

test('(정적) S12: 나란히 보기 규칙(.cal-tab · .cal-mine · .peer-layout · data-peer-layout)에 hex 가 없다(토큰만)', () => {
  const rules = cssRules(app).filter(r => /cal-tab|cal-mine|peer-layout/.test(r.sel));
  assert.ok(rules.length >= 8, '나란히 보기 규칙을 찾지 못했다: ' + rules.length);
  const bad = rules.filter(r => /#[0-9a-f]{3,8}\b/i.test(r.body)).map(r => r.sel + '{' + r.body.trim() + '}');
  assert.deepStrictEqual(bad, [], '새 색은 토큰으로(테마 5종 대비는 토큰이 지킨다)');
});

test('(정적) S9: 「겹 끈 상태」 감추기 규칙은 나란히 보기를 빼놓는다(안 그러면 겹을 꺼 둔 사람의 오른쪽 달력이 빈다)', () => {
  const hide = cssRules(app).filter(r => /not\(\[data-peer-overlay\]\)/.test(r.sel) && /display:\s*none/.test(r.body));
  assert.ok(hide.length >= 1, '「끈 상태」 규칙을 찾지 못했다');
  for (const r of hide) {
    for (const sel of r.sel.split(',')) {
      assert.ok(sel.includes(':not([data-peer-layout="side"])'), '나란히 보기를 빼놓지 않은 「끈 상태」 선택자: ' + sel.trim());
    }
  }
  assert.ok(cssRules(app).some(r => r.sel === 'body[data-peer][data-peer-layout="side"] #peerOverlayToggle' && /display:\s*none/.test(r.body)),
    '나란히 보기에서 「내 일정」 겹 토글 칩을 감추는 규칙이 없다(S9)');
});

test('(정적) S11: 나란히 보기의 새 함수들은 호스트로 나가는 문(hpost)·저장(save)을 부르지 않는다', () => {
  for (const fn of ['peerLayoutRead', 'setPeerLayout', 'syncPeerLayoutAttr', 'peerLayoutHtml', 'paintPeerTabs',
                    'renderMonthGrid', 'peerOverlapDays', 'peerSyncRows', 'peerSideByRow', 'peerScrollLink']) {
    const code = extractFunction(app, fn);
    assert.ok(!/\bhpost\s*\(/.test(code), `${fn} 가 hpost 를 부른다 — 열람 창의 문을 늘리지 않는다`);
    assert.ok(!/\bsave\s*\(/.test(code), `${fn} 가 save() 를 부른다`);
  }
  //  저장 키는 열람 창 전용 하나뿐(내 화면 키와 섞이지 않는다 · S1)
  assert.ok(extractFunction(app, 'peerLayoutRead').includes("'tc_peerLayout'"));
  assert.ok(extractFunction(app, 'setPeerLayout').includes("'tc_peerLayout'"));
});

test('(정적) TDZ: __peerLayout · __peerScrollLock 은 렌더 함수보다 위(파일 앞 __peerOverlay 근처)에서 선언된다', () => {
  const at = (s) => app.indexOf(s);
  const ov = at('let __peerOverlay = true;');
  for (const d of ["let __peerLayout = 'overlay';", 'let __peerScrollLock = false;']) {
    assert.ok(at(d) > ov && at(d) < at('function renderGrid('), `${d} 가 렌더보다 아래에 있다 — 열람 창 부팅이 TDZ 로 끊긴다`);
  }
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom — 열람 창을 실제로 띄운다
// ══════════════════════════════════════════════════════════════════════
const JSDOM = (await importOptional('jsdom'))?.JSDOM || null;

if (!JSDOM) {
  skip('peer-side-by-side: jsdom 미설치 — 두 달력·전환·시트·동기 렌더 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const bootOpts = (url, posted) => ({
    runScripts: 'dangerously', pretendToBeVisual: true, url,
    beforeParse(window) {
      window.chrome = { webview: { postMessage: (s) => posted.push(String(s)), addEventListener() {}, removeEventListener() {} } };
      if (typeof window.crypto === 'undefined') {
        window.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: a => a };
      }
      window.scrollTo = () => {};
    },
  });
  const PEER_URL = 'https://tcapp.local/?peer=1';
  const MAIN_URL = 'https://tcapp.local/';
  function boot(src, url = PEER_URL) {
    const posted = [];
    const dom = new JSDOM(src, bootOpts(url, posted));
    const w = dom.window;
    return {
      w, posted, ev: (c) => w.eval(c),
      evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      close: () => { try { w.close(); } catch (_) {} },
    };
  }
  const settle = () => new Promise(r => setTimeout(r, 60));

  // ── 픽스처 — peer-overlay-redesign 과 같은 9월(9/8 겹침 · 9/9 맞닿기 · 9/15~17 상대 막대 · 9/16~18 내 막대 · 9/22 내 것만) + 상대 할 일 1건
  const CATS = [{ id: 'c-A', name: '설계 검토', color: '#c0392b' }, { id: 'c-B', name: '보고서 작성', color: '#2980b9' }];
  const mine = (o) => ({ endDate: '', recur: null, recurExcept: [], categoryId: null, _mine: true, ...o });
  const ENTRIES = [
    { id: 'p-all', date: '2026-09-08', categoryId: 'c-B', title: '상대: 주간보고', allDay: true, startTime: '', endTime: '' },
    { id: 'p-10', date: '2026-09-08', categoryId: 'c-A', title: '상대: 설계회의', allDay: false, startTime: '10:00', endTime: '11:00' },
    { id: 'p-14', date: '2026-09-08', categoryId: 'c-A', title: '상대: 고객통화', allDay: false, startTime: '14:00', endTime: '15:00' },
    { id: 'p-09', date: '2026-09-09', categoryId: 'c-A', title: '상대: 아침회의', allDay: false, startTime: '09:00', endTime: '10:00' },
    { id: 'p-rng', date: '2026-09-15', categoryId: 'c-A', title: '상대: 통합시험', allDay: true, endDate: '2026-09-17' },
    { id: 'p-oct', date: '2026-10-20', categoryId: 'c-B', title: '상대: 10월 회의', allDay: false, startTime: '13:00', endTime: '14:00' },
    mine({ id: 'm-1030', date: '2026-09-08', title: '나: 회의 준비', allDay: false, startTime: '10:30', endTime: '11:30' }),
    mine({ id: 'm-all', date: '2026-09-08', title: '나: 외근', allDay: true, startTime: '10:15', endTime: '' }),
    mine({ id: 'm-10', date: '2026-09-09', title: '나: 정리', allDay: false, startTime: '10:00', endTime: '11:00' }),
    mine({ id: 'm-rng', date: '2026-09-16', title: '나: 출장', allDay: true, startTime: '', endTime: '', endDate: '2026-09-18' }),
    mine({ id: 'm-22', date: '2026-09-22', title: '나: 혼자 있는 날', allDay: false, startTime: '09:00', endTime: '10:00' }),
    mine({ id: 'm-oct', date: '2026-10-20', title: '나: 10월 점검', allDay: false, startTime: '15:00', endTime: '16:00' }),
  ];
  const TODOS = [{ id: 't-1', text: '상대: 검토 의견 회신', due: '2026-09-10', endDate: '', done: false, categoryId: 'c-A', prio: '' }];
  const DATA = { categories: CATS, entries: ENTRIES, todos: TODOS, rooms: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '' };
  function inject(m, data = DATA, meta = { peerName: '홍길동', canWrite: false }) {
    //  focusDs 도 비운다 — 앞 시험의 클릭이 남긴 키보드 포커스 날짜가 roving tabindex 를 바꿔 「바이트 동일」 비교를 흐린다.
    m.ev('view = {y:2026, m:8}; selectedDate = "2026-09-08"; focusDs = null;');
    m.w.__applyState(JSON.stringify(data), meta);
  }
  const q = (m, sel) => m.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const pressedOf = (m) => m.evJSON('Array.prototype.map.call(document.querySelectorAll("#peerBanner .peer-layout [data-layout]"), function(b){ return [b.dataset.layout, b.getAttribute("aria-pressed"), b.classList.contains("active")]; })');
  const clickLayout = (m, v) => m.ev(`document.querySelector('#peerBanner .peer-layout [data-layout="${v}"]').click()`);
  const display = (m, sel) => m.ev(`(function(){ var e = document.querySelector(${JSON.stringify(sel)}); return e ? getComputedStyle(e).display : null; })()`);
  const sels = (m, g) => m.evJSON(`Array.prototype.map.call(document.querySelectorAll('#${g} .cell.sel'), function(c){ return c.dataset.date; })`);
  // 겹쳐 보기 기준 출력(왕복 뒤 바이트 비교용)
  const gridHtml = (m) => m.ev('document.getElementById("grid").outerHTML');

  let P = null, bootErr = null;
  try { P = boot(app); } catch (e) { bootErr = e; }

  if (bootErr) {
    test('peer-side-by-side: jsdom 부팅 실패(조사 필요)', () => { throw bootErr; });
  } else {
    let overlayHtml = '';
    test('(jsdom) 준비: 저장값이 없으면 겹쳐 보기로 뜬다 · 오른쪽 달력은 비어 있고 감춰진다(기본값 회귀 없음)', async () => {
      await settle();
      P.ev('try{ localStorage.removeItem("tc_peerLayout"); localStorage.removeItem("tc_peerOverlay"); }catch(_){}');
      inject(P);
      await settle();
      assert.strictEqual(P.ev('__peerLayout'), 'overlay');
      assert.strictEqual(P.ev('String(document.body.dataset.peerLayout)'), 'undefined');
      assert.deepStrictEqual(pressedOf(P), [['overlay', 'true', true], ['side', 'false', false]]);
      assert.strictEqual(P.ev('document.getElementById("gridMine").innerHTML'), '', '겹쳐 보기인데 오른쪽 달력에 무언가 그려졌다');
      assert.strictEqual(display(P, '#calMine'), 'none', '겹쳐 보기인데 오른쪽 달력 자리가 보인다');
      assert.strictEqual(display(P, '#calTabPeer'), 'none', '겹쳐 보기인데 이름 탭이 보인다');
      assert.strictEqual(P.ev('document.getElementById("grid").style.gridTemplateRows'), '', '겹쳐 보기 격자에 인라인 줄 높이가 박혔다');
      // 겹쳐 보기 화면 그대로 — 내 겹 막대와 roving tabindex 한 칸
      assert.ok(q(P, '#grid .chip.chip-mine') > 0, '겹쳐 보기의 내 겹이 사라졌다');
      assert.strictEqual(q(P, '#grid .cell[tabindex="0"]'), 1);
      assert.strictEqual(q(P, '#grid .cell:not([tabindex])'), 0, '겹쳐 보기 칸에서 tabindex 가 빠졌다');
      assert.deepStrictEqual(P.posted, [], '열람 창은 호스트로 아무것도 안 보낸다');
      overlayHtml = gridHtml(P);
    });

    test('(jsdom) R1: 「나란히 보기」 클릭 → 상태·body 스위치·aria-pressed·저장값(tc_peerLayout)이 함께 바뀐다', () => {
      clickLayout(P, 'side');
      assert.strictEqual(P.ev('__peerLayout'), 'side');
      assert.strictEqual(P.ev('document.body.dataset.peerLayout'), 'side');
      assert.strictEqual(P.ev('localStorage.getItem("tc_peerLayout")'), 'side');
      assert.deepStrictEqual(pressedOf(P), [['overlay', 'false', false], ['side', 'true', true]]);
    });

    test('(jsdom) R2: 두 달력 · 각자 요일 머리줄 · 이름 탭 두 개(그 사람 = 과제 색 견본 · 나 = 내 색 견본)', () => {
      assert.strictEqual(display(P, '#calMine'), 'flex', '오른쪽 달력이 안 보인다');
      assert.strictEqual(q(P, '#grid .cell'), 35);
      assert.strictEqual(q(P, '#gridMine .cell'), 35, '오른쪽 달력의 칸 수가 왼쪽과 다르다');
      assert.strictEqual(q(P, '#weekdaysMine > div'), 7, '오른쪽 달력의 요일 머리줄이 없다');
      assert.strictEqual(P.ev('document.getElementById("calTabPeer").textContent.trim()'), '홍길동 님');
      assert.strictEqual(P.ev('document.getElementById("calTabMine").textContent.trim()'), '내 일정');
      assert.strictEqual(display(P, '#calTabPeer'), 'flex');
      const sw = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#calTabPeer .pl-sw-peer b"), function(b){ return b.style.backgroundColor || b.style.background; })');
      assert.strictEqual(sw.length, 3);
      assert.ok(sw.some(c => /192,\s*57,\s*43|c0392b/i.test(c)), '왼쪽 탭 견본이 그 사람 과제 색이 아니다: ' + JSON.stringify(sw));
      assert.strictEqual(q(P, '#calTabMine .pl-sw b.m'), 1, '오른쪽 탭 견본이 내 색(--mine-bar)이 아니다');
      assert.ok(P.ev('document.getElementById("calTabPeer").innerHTML').includes('홍길동'), '이름이 안 들어갔다');
    });

    test('(jsdom) R2/S3: 왼쪽에 _mine 칩 0 · 오른쪽에 _mine 아닌 칩 0 · 구분줄 없음 · 할 일은 왼쪽에만', () => {
      assert.strictEqual(q(P, '#grid .chip.chip-mine'), 0, '왼쪽(그 사람) 달력에 내 칩이 섞였다');
      assert.ok(q(P, '#grid .chip') >= 5, '왼쪽에 그 사람 칩이 안 그려졌다');
      assert.strictEqual(q(P, '#gridMine .chip:not(.chip-mine)'), 0, '오른쪽(내) 달력에 내 것 아닌 칩이 섞였다');
      assert.ok(q(P, '#gridMine .chip.chip-mine') >= 5, '오른쪽에 내 칩이 안 그려졌다');
      assert.strictEqual(q(P, '#grid .mine-sep') + q(P, '#gridMine .mine-sep'), 0, '한 달력에 한 사람 — 남/내 구분줄은 없다');
      assert.strictEqual(q(P, '#grid .chip-todo'), 1, '그 사람 할 일이 왼쪽 달력에 없다');
      assert.strictEqual(q(P, '#gridMine .chip-todo'), 0, '오른쪽 달력에 할 일이 실렸다(내 겹은 일정만)');
      // 오른쪽 칩 = 겹쳐 보기의 내 칩과 같은 모양(과제 색 인라인 style 없음 · 끌 수 없음)
      const st = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#gridMine .chip"), function(c){ return [c.getAttribute("style"), c.getAttribute("draggable")]; })');
      assert.ok(st.every(([s, d]) => !/border-left-color|background/i.test(s || '') && d === 'false'), JSON.stringify(st));
      // 내 기간 막대는 오른쪽에서 주 안에 하나의 연속 막대(.chip-bar.range)로 그려진다
      const bar = P.evJSON(`(function(){
        var b = document.querySelector('#gridMine .chip-bar[data-id="m-rng"]');
        return b ? [Number(b.dataset.c0), Number(b.dataset.c1), Number(b.dataset.lane)] : null;
      })()`);
      assert.deepStrictEqual(bar, [3, 5, 0], '오른쪽 달력의 내 기간 막대가 연속 막대(9/16~9/18)로 그려지지 않았다');
    });

    test('(jsdom) S11: 과제 필터는 왼쪽(그 사람)에만 걸린다 — 오른쪽 내 칩 수는 그대로', () => {
      const before = q(P, '#gridMine .chip');
      P.ev('filterCatId = "c-A"; renderAll();');
      const leftIds = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#grid .chip[data-id]"), function(c){ return c.dataset.id; })');
      assert.ok(leftIds.length && leftIds.every(id => ['p-10', 'p-14', 'p-09', 'p-rng'].includes(id)), JSON.stringify(leftIds));
      assert.strictEqual(q(P, '#gridMine .chip'), before, '과제 필터가 오른쪽(내) 달력까지 걸렸다');
      P.ev('filterCatId = null; renderAll();');
    });

    test('(jsdom) R4/S5: 상세 패널은 접혀 있고 날짜를 누르면 시트로 열린다 · 두 묶음 머리말 · 닫기 손잡이로 닫힌다', () => {
      assert.strictEqual(P.ev('panelSheetOpen'), false, '나란히 보기로 바꿨는데 시트가 열린 채다');
      assert.strictEqual(P.ev('document.body.classList.contains("sheet-open")'), false);
      assert.ok(P.ev('window.innerWidth') > 760, '사전조건: 넓은 창(좁은 폭 시트 규칙이 아니라 나란히 보기 규칙을 시험한다)');
      P.ev(`document.querySelector('#grid .cell[data-date="2026-09-08"]').click()`);
      assert.strictEqual(P.ev('document.body.classList.contains("sheet-open")'), true, '왼쪽 칸을 눌렀는데 시트가 안 열린다');
      const secs = P.evJSON('Array.prototype.map.call(document.querySelectorAll("#dpBody .dp-sec"), function(s){ return [s.querySelector(".dp-sec-h").textContent.replace(/\\s+/g," ").trim(), s.querySelectorAll(".card").length, s.querySelectorAll(".card.card-mine").length]; })');
      assert.deepStrictEqual(secs, [['홍길동 님 일정 (3)', 3, 0], ['내 일정 (2)', 2, 2]], 'S7 — 시트의 상세가 겹쳐 보기와 같은 두 묶음이 아니다');
      assert.ok(q(P, '#dpBody .ovl-badge') === 2, 'S7 — 시간 겹침 배지가 두 카드에 없다');
      P.ev('document.getElementById("dpSheetClose").click()');
      assert.strictEqual(P.ev('document.body.classList.contains("sheet-open")'), false, '닫기 손잡이로 안 닫힌다');
      P.ev(`document.querySelector('#gridMine .cell[data-date="2026-09-09"]').click()`);
      assert.strictEqual(P.ev('document.body.classList.contains("sheet-open")'), true, '오른쪽 칸을 눌러도 시트가 열려야 한다');
      P.ev('closeSheet()');
    });

    test('(jsdom) R5/S6: 오른쪽 칸 클릭 → 양쪽 .sel(같은 날짜) · roving 은 왼쪽 · 달 이동은 두 달력이 같이', () => {
      P.ev(`document.querySelector('#gridMine .cell[data-date="2026-09-22"]').click()`);
      assert.strictEqual(P.ev('selectedDate'), '2026-09-22');
      assert.deepStrictEqual(sels(P, 'grid'), ['2026-09-22']);
      assert.deepStrictEqual(sels(P, 'gridMine'), ['2026-09-22']);
      assert.strictEqual(P.ev(`document.querySelector('#grid .cell[data-date="2026-09-22"]').getAttribute('tabindex')`), '0', '키보드 roving 이 왼쪽 선택을 안 따른다');
      assert.strictEqual(q(P, '#gridMine .cell[tabindex]'), 0, '오른쪽 칸은 키보드 roving 대상이 아니다(S11)');
      P.ev(`document.querySelector('#grid .cell[data-date="2026-09-15"]').click()`);
      assert.deepStrictEqual(sels(P, 'gridMine'), ['2026-09-15'], '왼쪽 칸을 눌렀는데 오른쪽 선택 테두리가 안 따라온다');
      P.ev('document.getElementById("btnNext").click()');
      assert.strictEqual(P.ev('view.m'), 9);
      assert.ok(q(P, '#grid .cell[data-date="2026-10-20"]') === 1 && q(P, '#gridMine .cell[data-date="2026-10-20"]') === 1, '달 이동이 두 달력에 같이 반영되지 않았다');
      assert.strictEqual(q(P, '#gridMine .chip[data-id="m-oct"]'), 1, '10월 오른쪽 달력에 내 10월 일정이 없다');
      assert.strictEqual(q(P, '#grid .chip[data-id="m-oct"]'), 0);
      P.ev(`document.querySelector('#gridMine .cell[data-date="2026-10-20"]').click()`);
      assert.deepStrictEqual([sels(P, 'grid'), sels(P, 'gridMine')], [['2026-10-20'], ['2026-10-20']]);
      P.ev('document.getElementById("btnPrev").click(); closeSheet();');
      assert.strictEqual(P.ev('view.m'), 8);
      // 다른 달의 흐린 칸을 오른쪽에서 누르면 그 달로 — 두 달력이 함께 넘어간다
      P.ev(`document.querySelector('#gridMine .cell[data-date="2026-10-01"]').click()`);
      assert.strictEqual(P.ev('view.m'), 9);
      assert.deepStrictEqual([sels(P, 'grid'), sels(P, 'gridMine')], [['2026-10-01'], ['2026-10-01']]);
      P.ev('view = {y:2026, m:8}; selectedDate = "2026-09-08"; renderAll(); closeSheet();');
    });

    test('(jsdom) R6/S8: 시간 겹침 점은 겹친 날(9/8)에만 · 두 달력 그 칸 모두', () => {
      const dots = (g) => P.evJSON(`Array.prototype.map.call(document.querySelectorAll('#${g} .ovl-dot'), function(d){ return d.closest('.cell').dataset.date; })`);
      assert.deepStrictEqual(dots('grid'), ['2026-09-08'], '왼쪽 달력의 겹침 점');
      assert.deepStrictEqual(dots('gridMine'), ['2026-09-08'], '오른쪽 달력의 겹침 점');
      assert.ok(P.ev(`document.querySelector('#gridMine .cell[data-date="2026-09-08"]').getAttribute('aria-label')`).includes('시간이 겹치는 일정 있음'));
      // 10/20 은 13–14 · 15–16 → 겹침 아님(같은 날에 둘 다 있어도)
      P.ev('view = {y:2026, m:9}; renderGrid();');
      assert.strictEqual(q(P, '#grid .ovl-dot') + q(P, '#gridMine .ovl-dot'), 0, '겹치지 않는 날에 점이 찍혔다');
      P.ev('view = {y:2026, m:8}; renderGrid();');
    });

    test('(jsdom) R7/S9: 나란히 보기에서 「내 일정」 겹 토글 칩은 감춰지고, 겹을 꺼 둔 사람도 오른쪽 달력·시트에 내 것이 보인다', () => {
      assert.strictEqual(display(P, '#peerOverlayToggle'), 'none', '나란히 보기인데 겹 토글 칩이 보인다');
      // 겹쳐 보기에서 겹을 꺼 두었던 사람(저장값 '0')이 나란히 보기로 다시 연 경우
      clickLayout(P, 'overlay');
      P.ev('setPeerOverlay(false);');
      assert.strictEqual(P.ev('localStorage.getItem("tc_peerOverlay")'), '0');
      clickLayout(P, 'side');
      assert.strictEqual(P.ev('__peerOverlay'), false, '나란히 보기로 바꾸면서 겹 토글 값을 건드렸다');
      assert.strictEqual(P.ev('localStorage.getItem("tc_peerOverlay")'), '0', '나란히 보기가 tc_peerOverlay 를 덮었다');
      assert.ok(q(P, '#gridMine .chip.chip-mine') >= 5, '겹을 꺼 둔 사람의 오른쪽 달력이 비었다');
      assert.strictEqual(display(P, '#gridMine .chip.chip-mine'), 'flex', '「끈 상태」 CSS 가 오른쪽 달력의 내 칩을 감춘다');
      P.ev('selectedDate = "2026-09-08"; renderAll();');
      assert.strictEqual(q(P, '#dpBody .dp-sec'), 2, '겹을 꺼 두었어도 나란히 보기의 상세는 두 묶음이다(S7)');
      assert.strictEqual(display(P, '#dpBody .card.card-mine'), 'block', '「끈 상태」 CSS 가 시트의 내 카드를 감춘다');
      assert.deepStrictEqual(P.evJSON('Array.prototype.map.call(document.querySelectorAll("#gridMine .ovl-dot"), function(d){ return getComputedStyle(d).display === "none"; })'), [false],
        '「끈 상태」 CSS 가 오른쪽 겹침 점을 감춘다');
      // 겹쳐 보기로 돌아오면 원래 값(꺼짐) 그대로
      clickLayout(P, 'overlay');
      assert.strictEqual(P.ev('__peerOverlay'), false);
      assert.strictEqual(P.ev('document.getElementById("peerOverlayToggle").getAttribute("aria-pressed")'), 'false');
      assert.strictEqual(q(P, '#grid .chip.chip-mine'), 0, '겹쳐 보기 복귀 — 겹을 꺼 둔 값대로 내 칩이 없어야 한다');
      assert.strictEqual(display(P, '#peerOverlayToggle'), 'inline-flex', '겹쳐 보기로 돌아왔는데 겹 토글 칩이 안 보인다');
      P.ev('setPeerOverlay(true);');
      clickLayout(P, 'side');
      assert.strictEqual(P.ev('localStorage.getItem("tc_peerOverlay")'), '1');
    });

    test('(jsdom) S4: 줄 맞춤 — 주마다 두 달력 칸 높이 중 큰 값을 두 격자에 같은 grid-template-rows 로 박는다(측정값 주입)', () => {
      // jsdom 은 레이아웃이 없다 → 각 주 첫 칸의 높이를 data-fake-h 로 주입해 판정만 본다(실제 ±1px 은 실 위젯 R3).
      const L = [100, 80, 140, 74, 90], R = [74, 120, 140, 160, 74];
      const tpl = P.evJSON(`(function(){
        var L = ${JSON.stringify(L)}, R = ${JSON.stringify(R)};
        var proto = window.HTMLElement.prototype, orig = proto.getBoundingClientRect;
        proto.getBoundingClientRect = function(){ var h = Number(this.dataset && this.dataset.fakeH || 0); return { height:h, width:10, top:0, left:0, right:10, bottom:h, x:0, y:0 }; };
        try{
          [['grid', L], ['gridMine', R]].forEach(function(p){
            Array.prototype.forEach.call(document.querySelectorAll('#' + p[0] + ' .gridrow'), function(r, i){ r.querySelector('.cell').dataset.fakeH = p[1][i]; });
          });
          peerSyncRows();
          return [document.getElementById('grid').style.gridTemplateRows, document.getElementById('gridMine').style.gridTemplateRows];
        } finally { proto.getBoundingClientRect = orig; }
      })()`);
      const want = L.map((h, i) => Math.max(h, R[i]) + 'px').join(' ');
      assert.deepStrictEqual(tpl, [want, want], '두 격자의 줄 높이가 큰 쪽으로 같게 맞지 않았다');
      // 측정이 안 되면(레이아웃 없음) 박지 않고 걷는다 — 0px 로 줄을 접지 않는다
      P.ev('peerSyncRows();');
      assert.deepStrictEqual(P.evJSON('[document.getElementById("grid").style.gridTemplateRows, document.getElementById("gridMine").style.gridTemplateRows]'), ['', '']);
    });

    test('(jsdom) S11: 오른쪽 달력은 읽기 전용 — 더블클릭 새 기록 없음 · 끌기 시작 막힘 · 지금까지 아무것도 안 나갔다', () => {
      const cell = '#gridMine .cell[data-date="2026-09-23"]';
      P.ev(`document.querySelector('${cell}').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));`);
      assert.strictEqual(P.ev('(function(){ var o = document.querySelector(".overlay:not(.hidden)"); return o ? o.id : ""; })()'), '', '오른쪽 칸 더블클릭으로 무언가 열렸다');
      const ok = P.ev(`(function(){ var c = document.querySelector('#gridMine .chip'); var e = new Event('dragstart', { bubbles: true, cancelable: true }); c.dispatchEvent(e); return e.defaultPrevented; })()`);
      assert.strictEqual(ok, true, '오른쪽 칩의 끌기 시작이 안 막힌다');
      assert.strictEqual(q(P, '#gridMine [draggable="true"]'), 0);
      assert.deepStrictEqual(P.posted, [], '나란히 보기 조작 중 호스트로 무언가 나갔다(봉인)');
    });

    test('(jsdom) R1: 다시 열어도(재주입) 나란히 보기가 유지된다 · 이상값이면 겹쳐 보기 · 겹쳐 보기 왕복 뒤 #grid 가 바이트 단위로 같다', async () => {
      inject(P);
      await settle();
      assert.strictEqual(P.ev('__peerLayout'), 'side', '다시 열었는데 나란히 보기가 풀렸다');
      assert.strictEqual(q(P, '#gridMine .cell'), 35);
      for (const bad of ['SIDE', 'grid', '', '1', 'undefined']) {
        P.ev(`localStorage.setItem("tc_peerLayout", ${JSON.stringify(bad)});`);
        inject(P);
        await settle();
        assert.strictEqual(P.ev('__peerLayout'), 'overlay', `이상값 ${JSON.stringify(bad)} 이 겹쳐 보기로 떨어지지 않았다`);
        assert.strictEqual(P.ev('String(document.body.dataset.peerLayout)'), 'undefined');
        assert.strictEqual(P.ev('document.getElementById("gridMine").innerHTML'), '');
      }
      // 겹쳐 보기 → 나란히 → 겹쳐: 왼쪽 격자가 처음 겹쳐 보기와 바이트 단위로 같다(잔재 없음 — 인라인 줄 높이·필터·tabindex)
      P.ev('localStorage.removeItem("tc_peerLayout"); localStorage.removeItem("tc_peerOverlay");');
      inject(P);
      await settle();
      assert.strictEqual(gridHtml(P), overlayHtml, '같은 데이터·같은 선택인데 겹쳐 보기 격자가 처음과 다르다');
      clickLayout(P, 'side');
      assert.notStrictEqual(gridHtml(P), overlayHtml, '사전조건: 나란히 보기의 왼쪽 격자는 내 칩이 빠져 달라야 한다');
      clickLayout(P, 'overlay');
      assert.strictEqual(gridHtml(P), overlayHtml, '나란히 보기를 다녀오자 겹쳐 보기 격자가 달라졌다');
      assert.strictEqual(P.ev('document.getElementById("gridMine").innerHTML'), '', '겹쳐 보기로 돌아왔는데 오른쪽 달력이 남았다');
    });

    // ── 내 창(PEER 아님) — 버튼도 두 번째 달력도 없다 ──────────────────
    test('(jsdom) R1: 내 창(PEER 아님)에는 분할 버튼이 없고, 저장값이 side 여도 두 번째 달력을 그리지 않는다', async () => {
      const C = boot(app, MAIN_URL);
      try {
        await settle();
        C.ev('localStorage.setItem("tc_peerLayout", "side");');
        C.ev('view = {y:2026, m:8}; selectedDate = "2026-09-08";');
        C.w.__applyState(JSON.stringify({ ...DATA, entries: ENTRIES.filter(e => !e._mine) }), { canWrite: true });
        await settle();
        assert.strictEqual(C.ev('PEER'), false);
        assert.strictEqual(q(C, '.peer-layout'), 0, '내 창에 분할 버튼이 생겼다');
        assert.strictEqual(C.ev('String(document.body.dataset.peerLayout)'), 'undefined');
        assert.strictEqual(C.ev('document.getElementById("gridMine").innerHTML'), '', '내 창에 두 번째 달력이 그려졌다');
        assert.strictEqual(display(C, '#calMine'), 'none');
        C.ev(`document.querySelector('#grid .cell[data-date="2026-09-10"]').click()`);
        assert.strictEqual(C.ev('document.body.classList.contains("sheet-open")'), false, '내 넓은 창에서 날짜 클릭이 시트를 띄웠다');
      } finally { C.ev('try{ localStorage.removeItem("tc_peerLayout"); }catch(_){}'); C.close(); }
    });

    // ══════════════════════════════════════════════════════════════════
    // (M) 변이
    // ══════════════════════════════════════════════════════════════════
    async function withMutated(find, repl, fn) {
      const m = boot(mutate(app, find, repl));
      try {
        await settle();
        m.ev('localStorage.setItem("tc_peerLayout","side"); localStorage.removeItem("tc_peerOverlay");');
        inject(m); await settle();
        return await fn(m);
      } finally { m.close(); }
    }

    test('변이(왼쪽 거르기 빼기): 왼쪽 달력이 내 것까지 실으면 R2 판정이 잡는다', async () => {
      await withMutated("renderMonthBars($('#grid'), dens, side ? (e => !e._mine) : null,", "renderMonthBars($('#grid'), dens, null,", async (m) => {
        assert.strictEqual(m.ev('__peerLayout'), 'side', '사전조건: 나란히 보기');
        assert.ok(q(m, '#grid .chip.chip-mine') > 0, '변이했는데도 왼쪽에 내 칩이 없다 — 변이가 거르기에 닿지 않았다(앵커 재검토)');
      });
    });

    test('변이(오른쪽 선택 동기 빼기): selectDate 가 #gridMine 의 .sel 을 안 옮기면 R5 판정이 잡는다', async () => {
      await withMutated("    if(cm){ cm.classList.add('sel'); cm.setAttribute('aria-selected','true'); }", '', async (m) => {
        m.ev(`document.querySelector('#gridMine .cell[data-date="2026-09-22"]').click()`);
        assert.deepStrictEqual(sels(m, 'grid'), ['2026-09-22'], '사전조건: 왼쪽은 옮겨진다');
        assert.notDeepStrictEqual(sels(m, 'gridMine'), ['2026-09-22'], '변이했는데도 오른쪽 선택이 따라온다 — 변이가 동기 경로에 닿지 않았다');
      });
    });

    test('변이(통과 줄 빼기): passFilter 가 나란히 보기에서도 겹 토글을 따르면 R7(겹 끈 사람의 오른쪽 달력) 판정이 잡는다', async () => {
      await withMutated("  if(e && e._mine && PEER && __peerLayout === 'side') return true;\n", '', async (m) => {
        m.ev('setPeerOverlay(false);');
        assert.strictEqual(m.ev('__peerLayout'), 'side');
        assert.strictEqual(q(m, '#gridMine .chip.chip-mine'), 0, '변이했는데도 오른쪽에 내 칩이 남는다 — 변이가 통과 경로에 닿지 않았다');
      });
    });

    test('peer-side-by-side: 뒷정리(창 닫기)', () => {
      P.ev('try{ localStorage.removeItem("tc_peerLayout"); localStorage.removeItem("tc_peerOverlay"); }catch(_){}');
      P.close();
    });
  }
}
