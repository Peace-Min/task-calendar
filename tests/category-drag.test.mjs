// 「내 과제」 순서 끌어 옮기기 — docs/ADMIN-HUB-3.md M6–M9 · 수용 R5–R7 (순서 계약 정본: docs/CATEGORY-ORDER.md).
//
// 이 파일이 지키는 것(키보드 ↑/↓ · 저장 payload · 보고서 행은 category-order.test.mjs 가 본다):
//   ① ✥ 손잡이(SVG · 진짜 버튼)를 포인터로 끌면 그 줄이 뜨고(.cat-dragging) **다른 줄들이 미끄러져**(transform) 놓일 자리에
//      빈 칸(.cat-drop-slot) 하나가 열린다 — 표시는 그 칸 하나뿐(따로 긋는 선 없음 · 원래 자리에 구멍이 남지 않는다 · 2026-10-02 PM 검토 「sortable」).
//      놓으면 그 자리로 옮기고 잠깐 강조(.cat-flash) · aria-live 「<과제명> — N번째에서 M번째로 옮겼습니다」(R5·R6).
//   ② 여러 칸을 한 번에 옮겨도 저장(saveState)은 **1회** · 필터 막대·과제 선택 상자·보고서가 그 순서를 따른다(R7 · M9).
//   ③ 같은 자리 · 목록 밖에 놓기 · 누르기만(4px 미만) · Esc · pointercancel → 변화 0 · 저장 0 · 선·뜬 줄이 남지 않는다(R5 · M7).
//   ④ 서버 끊김(잠금) 중에는 누르는 순간 잠금 토스트 한 줄 · 줄이 뜨지 않는다 · 순서·저장 변화 0(R7 · M9 · CATEGORY-ORDER C6).
//   ⑤ 변이 — Esc 취소 · 목록 밖 판정 · 저장 1회 · 잠금 관문을 각각 한 줄로 깨면 위 계약이 운다.
//
// ★ jsdom 에는 레이아웃이 없다 — getBoundingClientRect 를 **목록 안 자리(색인)**로 흉내 낸다(줄 높이 32 · 간격 8 · 맨 위 100px).
//   빈 칸은 #catList 안의 절대 위치 상자이고 미끄러짐은 transform 이라 흐름(색인)은 그대로다 — 흉내도 .cat-row 의 DOM 색인만 센다.
//   jsdom 26 에는 PointerEvent 가 없다 → MouseEvent 에 pointerId·pointerType 을 붙여 같은 이름(pointerdown/move/up)으로 보낸다.
//   실제 마우스 끌기(Input.dispatchMouseEvent)는 tests/loop-category-order.mjs 가 실 위젯에서 본다.
// 생략 규약: jsdom 이 없으면 이 파일의 시험은 **등록되지 않고** skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}

//  변이 — 각각 '되돌아가면 안 되는 판'을 만든다.
const MUT = {
  //  Esc 를 눌러도 끌기가 놓기처럼 끝난다(M7 위반)
  noEscCancel: (s) => mutate('  if(cancel){ catDragSettle(d, true); return; }', '', s),
  //  목록 밖 판정을 지운다 — 밖에 놓아도 가장 가까운 자리로 옮긴다(M7 위반)
  noOutside: (s) => mutate('  if(d.x < lr.left || d.x > lr.right || d.y < lr.top - CAT_DRAG_OUT || d.y > lr.bottom + CAT_DRAG_OUT) return -1;\n',
    '', s),
  //  여러 칸을 한 칸씩 나눠 옮긴다 — 저장이 칸 수만큼 나간다(M9 위반)
  stepSaves: (s) => mutate('  catMoveRow(d.id, to - from);\n}',
    '  for(let k = 0; k < Math.abs(to - from); k++) catMoveRow(d.id, Math.sign(to - from));\n}', s),
  //  잠금 관문 없이 끌기를 시작한다 — 잠긴 채 줄이 떠서 따라온다(M9 위반 · 놓아도 moveCategory 가 막지만 화면은 이미 움직였다)
  noLockGate: (s) => mutate("  if(guardEdit()){ ev.preventDefault(); return; }   // 잠금 — 토스트 한 줄 · 줄은 뜨지 않는다(M9)\n", '', s),
};

//  정적 — 끌기 배선이 한 손잡이·한 저장 길을 지난다(jsdom 없이도 판정한다)
test('정적①: 끌기 배선 — #catList pointerdown 위임 · 문서 pointermove/up/cancel · 캡처 단계 Esc · 놓기는 catMoveRow 한 길', () => {
  assert.ok(src.includes("document.addEventListener('pointermove', catDragMove);"), '끄는 동안의 움직임을 문서에서 받지 않는다 — 목록 밖으로 나간 포인터를 놓친다');
  assert.ok(src.includes("document.addEventListener('pointerup', ev => catDragEnd(ev, false));"), '놓기(pointerup)를 문서에서 받지 않는다');
  assert.ok(src.includes("document.addEventListener('pointercancel', ev => catDragEnd(ev, true));"), 'pointercancel 이 끌기 취소가 아니다');
  assert.ok(/if\(ev\.key !== 'Escape' \|\| !__catDrag \|\| !__catDrag\.started\) return;[\s\S]{0,120}catDragEnd\(null, true\);\s*\}, true\);/.test(src),
    'Esc 끌기 취소가 캡처 단계에서 받지 않는다 — 모달 Esc 가 「내 과제」 창까지 닫는다(M7)');
  const end = src.slice(src.indexOf('function catDragEnd('), src.indexOf('function applyCatFormLock('));
  assert.strictEqual((end.match(/catMoveRow\(/g) || []).length, 1, '놓기가 catMoveRow 한 길로 옮기지 않는다(M9 — 저장 1회)');
  assert.ok(!/moveCategory\(|save\(\)/.test(end), '놓기가 저장을 따로 한다 — 저장은 moveCategory 한 번이다');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/\.cat-drop-slot\{[^}]*border:2px dashed var\(--accent\)[^}]*background-color:var\(--accent-soft\)/.test(css), '빈 칸이 accent 점선 + accent-soft 채움이 아니다(M7 · 테마 토큰만)');
  assert.ok(!/cat-drop-line/.test(css + end), '따로 긋는 놓일 선(.cat-drop-line)이 남았다 — 표시는 빈 칸 하나뿐이다(PM 검토)');
  assert.ok(/\.cat-row\.cat-shift\{transition:transform \.14s ease\}/.test(css), '다른 줄의 미끄러짐이 짧은 transform transition(.14s)이 아니다');
  assert.ok(/@media \(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none !important;transition:none !important\}\}/.test(css), '모션 줄이기 전역 규칙이 사라졌다 — 미끄러짐이 그대로 돈다');
  //  포커스 링은 키보드로 왔을 때만 — :focus-visible 만 쓰고, 포인터로 준 포커스(data-pointer-focus)에는 링이 없다
  assert.ok(!/\.cat-grip:focus[{,]/.test(css), '손잡이 링이 :focus 에 걸려 있다 — 마우스로 끌어도 링이 선다');
  assert.ok(css.includes('.cat-grip[data-pointer-focus]:focus-visible{outline:none}'), '포인터로 준 포커스의 링 감춤이 없다(WebView2 는 그것을 :focus-visible 로 친다)');
  assert.ok(/@keyframes catDropFlash\{from\{background-color:var\(--accent-soft\)/.test(src), '놓은 뒤 강조가 accent-soft 가 아니다(M7)');
});

/* ── 행동 — jsdom 위젯 모드 ──────────────────────────────────────────── */

const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('category-drag: jsdom 미설치 — 끌기 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CA = '2026-09-01T00:00:00Z';
  const CAT = (id, name, extra) => Object.assign({ id, name, color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }, extra || {});
  const ENT = (id, categoryId) => ({ id, date: '2026-10-01', title: '업무 ' + id, categoryId, allDay: true, startTime: '', endTime: '',
    memo: '', location: '', source: '', commits: [], createdAt: CA, updatedAt: CA });
  const DATA = {
    categories: [CAT('c-a', '알파'), CAT('c-b', '베타'), CAT('c-c', '감마'), CAT('db-o', '공식 오메가', { source: 'db' })],
    entries: [ENT('e-a', 'c-a'), ENT('e-b', 'c-b'), ENT('e-c', 'c-c'), ENT('e-o', 'db-o')],
    todos: [], rooms: ['201호'],
  };
  //  흉내 레이아웃 — 목록은 (0,100)부터 폭 400 · 줄은 색인 k 에서 top = 100 + 40k · 높이 32.
  const TOP = 100, PITCH = 40, H = 32;
  const rowY = (k) => TOP + PITCH * k + H / 2;   // k 번째 줄의 가운데

  function boot(source) {
    const log = [];
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quietConsole(),
      beforeParse(win) {
        win.chrome = { webview: {
          postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} log.push({ post: o && o.cmd, msg: o }); },
          addEventListener() {}, removeEventListener() {},
        } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        //  시계는 멈춰 둔다 — 재시도·토스트·강조 해제 타이머가 시험 중에 끼어들지 않게(강조 클래스가 남아 있어 잴 수 있다).
        win.setTimeout = () => 0;
        win.clearTimeout = () => {};
        //  레이아웃 흉내 — #catList 와 .cat-row 만 자리를 갖는다(나머지는 0 상자).
        win.HTMLElement.prototype.getBoundingClientRect = function () {
          const R = (top, height, left = 0, width = 400) => ({ top, bottom: top + height, left, right: left + width, width, height, x: left, y: top });
          if (this.id === 'catList') {
            const n = this.querySelectorAll('.cat-row').length;
            return R(TOP, Math.max(0, PITCH * n - (PITCH - H)));
          }
          if (this.classList && this.classList.contains('cat-row') && this.parentElement && this.parentElement.id === 'catList') {
            const k = [...this.parentElement.querySelectorAll('.cat-row')].indexOf(this);
            return R(TOP + PITCH * k, H);
          }
          return R(0, 0, 0, 0);
        };
      },
    });
    const w = dom.window;
    w.__fakeReply = (cmd, params) => { log.push({ req: cmd, params }); return Promise.resolve(cmd === 'saveState' ? { ok: true } : { ok: false, error: 'no handler' }); };
    w.eval('hostRequest = function(cmd, params){ return window.__fakeReply(cmd, params || {}); };');
    w.eval('(function(){ var t = toast; toast = function(m, k, a, ms){ window.__fakeToast(String(m), k); return t(m, k, a, ms); }; })();');
    w.__fakeToast = (m, k) => log.push({ toast: m, kind: k });
    const sess = log.find((x) => x.post === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.msg.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'hjlee', name: '이현진' } }) + ')');
    const doc = w.document;
    const W = {
      w, doc, log,
      ev: (code) => w.eval(code),
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      reqs: (cmd) => log.filter((x) => x.req === cmd),
      saves: () => JSON.parse(JSON.stringify(log.filter((x) => x.req === 'saveState').map((x) => x.params.state.categories.map((c) => c.id)))),
      toasts: () => log.filter((x) => x.toast).map((x) => x.toast),
      applyState: (data) => w.eval('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(META) + ')'),
      order: () => JSON.parse(w.eval('JSON.stringify(state.categories.map(function(c){ return c.id; }))')),
      domOrder: () => [...doc.querySelectorAll('#catList .cat-row')].map((r) => r.dataset.id),
      grip: (id) => doc.querySelector('#catList .cat-row[data-id="' + id + '"] [data-act="grip"]'),
      row: (id) => doc.querySelector('#catList .cat-row[data-id="' + id + '"]'),
      slot: () => doc.querySelector('#catList .cat-drop-slot'),
      slots: () => doc.querySelectorAll('#catList .cat-drop-slot').length,
      lines: () => doc.querySelectorAll('.cat-drop-line').length,
      tf: (id) => String(doc.querySelector('#catList .cat-row[data-id="' + id + '"]').style.transform || ''),
      live: () => String(doc.getElementById('catLive').textContent || ''),
      clear: () => { log.length = 0; },
      close: () => { try { w.close(); } catch (_) {} },
    };
    //  포인터 — MouseEvent 에 pointerId·pointerType 을 얹는다(jsdom 26 에는 PointerEvent 가 없다).
    W.ptr = (target, type, x, y) => {
      const e = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      Object.defineProperty(e, 'pointerType', { value: 'mouse' });
      target.dispatchEvent(e);
      return e;
    };
    W.down = (id) => { const g = W.grip(id); assert.ok(g, `${id} 행의 손잡이(✥)가 없다`); const k = W.domOrder().indexOf(id); return W.ptr(g, 'pointerdown', 20, rowY(k)); };
    W.move = (x, y) => W.ptr(doc, 'pointermove', x, y);
    W.up = (x, y) => W.ptr(doc, 'pointerup', x, y);
    W.esc = () => doc.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return W;
  }
  async function withBoot(source, fn) {
    const W = boot(source);
    try {
      W.applyState(DATA);
      await settle();
      W.ev('openCatModal();');
      await settle();
      W.clear();
      return await fn(W);
    } finally { W.close(); }
  }
  const noDragLeft = (W, why) => {
    assert.strictEqual(W.slots(), 0, `${why}: 빈 칸이 남았다`);
    assert.strictEqual(W.lines(), 0, `${why}: 놓일 선 요소가 있다`);
    assert.strictEqual(W.doc.querySelectorAll('#catList .cat-dragging').length, 0, `${why}: 뜬 줄(.cat-dragging)이 남았다`);
    assert.strictEqual(W.doc.body.classList.contains('cat-drag-on'), false, `${why}: 끄는 중 커서(body.cat-drag-on)가 남았다`);
    assert.ok(W.doc.querySelectorAll('#catList .cat-row[style*="translate"]').length === 0, `${why}: 줄의 transform 이 남았다`);
  };

  const checks = {
    //  R5·R6 — 끌기 → 다른 줄이 미끄러져 빈 칸 → 놓기 → 그 자리 · 강조 · 낭독 · 저장 1회(두 칸)
    async dragDrop(source) {
      await withBoot(source, async (W) => {
        assert.deepStrictEqual(W.order(), ['c-a', 'c-b', 'c-c', 'db-o'], '시드 순서가 다르다');
        const g = W.grip('c-c');
        assert.ok(g.querySelector('svg') && !/[✥⠿▲▼]/.test(g.textContent), '손잡이가 SVG 아이콘이 아니다(글자 기호 금지 · M6)');
        assert.strictEqual(g.getAttribute('title'), '끌어서 순서 바꾸기', '손잡이 툴팁이 다르다(M6)');
        W.down('c-c');
        assert.strictEqual(W.doc.activeElement, g, '누르는 순간 포커스가 손잡이로 가지 않는다 — 놓은 뒤 키보드로 이어 쓸 수 없다(M8)');
        assert.strictEqual(W.slots(), 0, '누르기만 했는데 빈 칸이 열렸다(4px 넘게 움직여야 끌기다)');
        W.move(20, rowY(0) - 6);   // 맨 위 줄의 위쪽 절반
        const row = W.row('c-c');
        assert.ok(row.classList.contains('cat-dragging'), '끄는 줄이 뜨지 않았다(.cat-dragging · M7)');
        assert.ok(W.doc.body.classList.contains('cat-drag-on'), '끄는 중 커서(grabbing)가 문서에 서지 않았다(M6)');
        assert.ok(/translateY\(/.test(row.style.transform), '끄는 줄이 포인터를 따라오지 않는다(transform · M7)');
        assert.strictEqual(W.slots(), 1, '놓일 자리에 빈 칸이 하나 열리지 않았다(M7)');
        assert.strictEqual(W.lines(), 0, '따로 긋는 놓일 선이 섰다 — 표시는 빈 칸 하나뿐이다');
        const sl = W.slot();
        assert.strictEqual(sl.dataset.slot, '0', '빈 칸이 맨 위(0번째)가 아니다');
        assert.strictEqual(sl.style.top, '0px', '빈 칸이 맨 위 줄 자리에 서지 않았다');
        assert.strictEqual(sl.style.height, '32px', '빈 칸 높이가 끄는 줄 높이가 아니다');
        assert.strictEqual(sl.getAttribute('aria-hidden'), 'true', '빈 칸이 낭독기에 읽힌다(장식이다)');
        //  다른 줄 — 알파·베타는 한 칸 아래로 비켜서고, 원래 자리 아래였던 오메가는 그대로(접힘 -1칸 + 빈 칸 +1칸)
        assert.deepStrictEqual([W.tf('c-a'), W.tf('c-b'), W.tf('db-o')], ['translateY(40px)', 'translateY(40px)', ''], '다른 줄이 빈 칸을 열도록 미끄러지지 않았다');
        assert.ok(W.row('c-a').classList.contains('cat-shift'), '다른 줄에 미끄러짐 transition 이 걸리지 않았다');
        assert.deepStrictEqual(W.order(), ['c-a', 'c-b', 'c-c', 'db-o'], '끄는 동안 순서(데이터)가 먼저 바뀌었다 — 놓기 전에는 그대로다');
        assert.strictEqual(W.reqs('saveState').length, 0, '끄는 동안 저장이 나갔다');
        W.up(20, rowY(0) - 6);
        await settle();
        assert.deepStrictEqual(W.order(), ['c-c', 'c-a', 'c-b', 'db-o'], '놓은 자리로 옮기지 않았다(R5)');
        assert.deepStrictEqual(W.domOrder(), W.order(), '놓은 뒤 화면 순서가 데이터와 다르다');
        assert.deepStrictEqual(W.saves(), [['c-c', 'c-a', 'c-b', 'db-o']], '두 칸을 한 번에 옮겼는데 저장이 1회가 아니다(M9)');
        assert.strictEqual(W.row('c-c'), row, '놓을 때 목록을 새로 만들었다 — 스크롤·포커스가 날아간다');
        assert.ok(row.classList.contains('cat-flash'), '놓은 줄이 잠깐 강조되지 않았다(drop flash · M7)');
        assert.strictEqual(W.live(), '감마 — 3번째에서 1번째로 옮겼습니다', 'aria-live 낭독 문구가 다르다(M8)');
        assert.strictEqual(g.getAttribute('aria-label'), '감마 순서 — 1번째. 위/아래 화살표로 옮깁니다', '놓은 뒤 손잡이의 자리 문구가 낡았다(M8)');
        assert.strictEqual(W.doc.activeElement, g, '놓은 뒤 포커스가 옮겨진 줄의 손잡이가 아니다(M8)');
        assert.strictEqual(g.dataset.pointerFocus, '1', '마우스로 놓은 뒤 포커스에 링 감춤 표식(data-pointer-focus)이 없다 — 링이 선다');
        noDragLeft(W, '놓은 뒤');
        assert.ok(!W.row('c-a').classList.contains('cat-shift'), '놓은 뒤 미끄러짐 transition 이 남았다 — DOM 을 옮길 때 한 번 튄다');
        //  키보드로 이어 쓰면 링이 다시 선다(표식이 떨어진다)
        g.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        await settle();
        assert.strictEqual(g.dataset.pointerFocus, undefined, '키보드로 이어 썼는데 링 감춤이 남았다 — ↑/↓ 에는 링이 보여야 한다');
        assert.deepStrictEqual(W.order(), ['c-a', 'c-c', 'c-b', 'db-o'], '놓은 뒤 ↓ 키로 한 칸 이어 옮기지 못했다');
        g.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
        await settle();
        W.clear();
        //  아래로 세 칸(맨 위 → 맨 아래) — 이것도 저장 1회
        W.down('c-c'); W.move(20, rowY(3) + 10); W.up(20, rowY(3) + 10);
        await settle();
        assert.deepStrictEqual(W.order(), ['c-a', 'c-b', 'db-o', 'c-c'], '맨 아래로 끌어 놓지 못했다');
        assert.strictEqual(W.saves().length, 1, '세 칸 끌기가 저장 1회가 아니다(M9)');
        assert.strictEqual(W.live(), '감마 — 1번째에서 4번째로 옮겼습니다');
      });
    },
    //  R7 — 보고서 행 · 필터 막대 · 과제 선택 상자가 끌어 놓은 순서를 따른다(CATEGORY-ORDER 계약 그대로)
    async followers(source) {
      await withBoot(source, async (W) => {
        W.down('db-o'); W.move(20, rowY(1) - 6); W.up(20, rowY(1) - 6);
        await settle();
        assert.deepStrictEqual(W.order(), ['c-a', 'db-o', 'c-b', 'c-c'], '공식 과제를 개인 사이로 끌어 놓지 못했다');
        const chips = W.evJSON("[].map.call(document.querySelectorAll('#filterbar [data-cat]'), function(b){ return b.dataset.cat; }).filter(Boolean)");
        assert.deepStrictEqual(chips, W.order(), '필터 막대가 끌어 놓은 순서를 따르지 않는다(R7)');
        const opts = W.evJSON("(function(){ var s = document.createElement('select'); fillCatSelect(s); return [].map.call(s.querySelectorAll('option'), function(o){ return o.value; }).filter(Boolean); })()");
        assert.deepStrictEqual(opts, W.order(), '과제 선택 상자가 끌어 놓은 순서를 따르지 않는다(R7)');
        const keys = W.evJSON("collectReportData('2026-10-01', '2026-10-01').rows.map(function(r){ return r.key; })");
        assert.deepStrictEqual(keys, W.order(), '보고서 행이 끌어 놓은 순서를 따르지 않는다(R7): ' + JSON.stringify(keys));
        W.ev("closeModal('#categoryModal'); openCatModal();");
        assert.deepStrictEqual(W.domOrder(), ['c-a', 'db-o', 'c-b', 'c-c'], '다시 연 목록이 끌어 놓은 순서가 아니다 — 개인/공식으로 다시 묶었다');
      });
    },
    //  R5 — 같은 자리 · 목록 밖 · 누르기만 → 변화 0 · 저장 0
    async noops(source) {
      await withBoot(source, async (W) => {
        const base = ['c-a', 'c-b', 'c-c', 'db-o'];
        //  같은 자리 — 제 줄 안에서 조금 움직였다 놓는다(선도 서지 않는다)
        W.down('c-c'); W.move(20, rowY(2) + 8);
        assert.ok(W.row('c-c').classList.contains('cat-dragging'), '전제: 8px 움직였으면 끌기다');
        assert.strictEqual(W.slots(), 1, '같은 자리 — 빈 칸이 원래 자리에 열려야 한다');
        assert.strictEqual(W.slot().dataset.slot, '2', '같은 자리인데 빈 칸이 원래 자리(2번째)가 아니다');
        assert.deepStrictEqual([W.tf('c-a'), W.tf('c-b'), W.tf('db-o')], ['', '', ''], '같은 자리인데 다른 줄이 비켜섰다');
        W.up(20, rowY(2) + 8); await settle();
        assert.deepStrictEqual(W.order(), base, '같은 자리에 놓았는데 순서가 바뀌었다(R5)');
        noDragLeft(W, '같은 자리');
        //  목록 밖 — 왼쪽 밖으로 끌어 놓는다(높이는 맨 위 줄)
        W.down('c-c'); W.move(-80, rowY(0));
        assert.ok(!W.slot() || W.slot().style.display === 'none', '목록 밖인데 빈 칸이 열렸다(M7)');
        assert.deepStrictEqual([W.tf('c-a'), W.tf('c-b'), W.tf('db-o')], ['', '', ''], '목록 밖인데 다른 줄이 제자리가 아니다');
        W.up(-80, rowY(0)); await settle();
        assert.deepStrictEqual(W.order(), base, '목록 밖에 놓았는데 순서가 바뀌었다(R5)');
        noDragLeft(W, '목록 밖');
        //  아래 밖 — 목록 끝보다 한참 아래
        W.down('c-a'); W.move(20, rowY(3) + 200); W.up(20, rowY(3) + 200); await settle();
        assert.deepStrictEqual(W.order(), base, '목록 아래 밖에 놓았는데 순서가 바뀌었다(R5)');
        //  누르기만(4px 미만) — 끌기가 아니다
        W.down('c-c'); W.move(22, rowY(2) + 2); W.up(22, rowY(2) + 2); await settle();
        assert.deepStrictEqual(W.order(), base, '누르기만 했는데 순서가 바뀌었다');
        assert.strictEqual(W.reqs('saveState').length, 0, '바뀐 것이 없는데 저장이 나갔다(R5)');
        assert.strictEqual(W.live(), '', '바뀐 것이 없는데 「옮겼습니다」를 낭독했다');
        noDragLeft(W, '누르기만');
      });
    },
    //  M7 — Esc · pointercancel 은 끌기 취소(변화 0) · Esc 는 「내 과제」 창을 닫지 않는다
    async escCancel(source) {
      await withBoot(source, async (W) => {
        W.down('c-c'); W.move(20, rowY(0) - 6);
        assert.ok(W.slots() === 1 && W.slot().dataset.slot === '0', '전제: 끌기 중 빈 칸이 맨 위에 열렸다');
        W.esc();
        noDragLeft(W, 'Esc 뒤');
        assert.strictEqual(W.ev("isOverlayOpen(document.getElementById('categoryModal'))"), true, 'Esc 한 번에 「내 과제」 창까지 닫혔다 — 끌기 취소만 해야 한다');
        W.up(20, rowY(0) - 6); await settle();
        assert.deepStrictEqual(W.order(), ['c-a', 'c-b', 'c-c', 'db-o'], 'Esc 로 취소했는데 놓기처럼 옮겼다(M7)');
        assert.strictEqual(W.reqs('saveState').length, 0, 'Esc 로 취소했는데 저장이 나갔다');
        //  pointercancel(터치 스크롤 가로채기 등)도 취소다
        W.down('c-c'); W.move(20, rowY(0) - 6);
        W.ptr(W.doc, 'pointercancel', 20, rowY(0) - 6); await settle();
        noDragLeft(W, 'pointercancel 뒤');
        assert.deepStrictEqual(W.order(), ['c-a', 'c-b', 'c-c', 'db-o'], 'pointercancel 이 놓기처럼 옮겼다');
        //  끌기 중이 아니면 Esc 는 평소대로 창을 닫는다(가로채지 않는다)
        W.esc(); await settle();
        assert.strictEqual(W.ev("isOverlayOpen(document.getElementById('categoryModal')) && !document.getElementById('categoryModal').classList.contains('closing')"), false,
          '끌기 중이 아닌데 Esc 를 삼켰다 — 창이 닫히지 않는다');
      });
    },
    //  R7·M9 — 잠금(서버 끊김) 중: 누르는 순간 잠금 토스트 · 줄이 뜨지 않는다 · 변화 0 · 저장 0
    async locked(source) {
      await withBoot(source, async (W) => {
        W.ev("__dbConnLost({ kind:'network', detail:'socket closed' })");
        assert.strictEqual(W.ev('editLocked()'), true, '끊김 주입이 잠금을 세우지 않았다(시험 전제)');
        assert.strictEqual(W.grip('c-c').getAttribute('aria-disabled'), 'true', '잠금 중 손잡이가 aria-disabled 가 아니다(M9)');
        W.clear();
        W.down('c-c'); W.move(20, rowY(0) - 6);
        assert.ok(!W.row('c-c').classList.contains('cat-dragging'), '잠긴 채 줄이 떠서 따라온다(M9)');
        assert.strictEqual(W.slots(), 0, '잠긴 채 빈 칸이 열렸다(M9)');
        W.up(20, rowY(0) - 6); await settle();
        assert.deepStrictEqual(W.order(), ['c-a', 'c-b', 'c-c', 'db-o'], '잠긴 채 순서가 바뀌었다(R7)');
        assert.deepStrictEqual(W.domOrder(), ['c-a', 'c-b', 'c-c', 'db-o'], '잠긴 채 화면 순서가 바뀌었다(R7)');
        assert.strictEqual(W.reqs('saveState').length, 0, '잠긴 채 저장을 보냈다(R7)');
        const t = W.toasts().filter((m) => m === '서버에 연결되지 않아 지금은 편집할 수 없습니다');
        assert.strictEqual(t.length, 1, '잠금 토스트가 한 줄이 아니다: ' + JSON.stringify(W.toasts()));
        noDragLeft(W, '잠금');
      });
    },
  };

  test('행동①: 끌기 → 뜬 줄 · 다른 줄이 미끄러져 빈 칸 하나 → 놓기 = 그 자리 · 강조 · 낭독 · 포커스(링은 키보드에만) · 여러 칸 저장 1회(R5·R6·M7·M9)', () => checks.dragDrop(src));
  test('행동②: 끌어 놓은 순서를 보고서 행·필터 막대·과제 선택 상자가 따르고 다시 열어도 그대로다(R7)', () => checks.followers(src));
  test('행동③: 같은 자리(빈 칸 = 원래 자리) · 목록 밖(빈 칸 없음) · 누르기만 → 변화 0 · 저장 0 · 빈 칸·뜬 줄·transform 이 남지 않는다(R5)', () => checks.noops(src));
  test('행동④: Esc · pointercancel = 끌기 취소(변화 0) · Esc 는 끌기 중에만 가로챈다(M7)', () => checks.escCancel(src));
  test('행동⑤: 잠금 중 — 잠금 토스트 한 줄 · 줄이 뜨지 않는다 · 순서·저장 변화 0(R7·M9)', () => checks.locked(src));

  test('변이①: Esc 취소를 놓기로 만들면 행동④ 가 실패한다', async () => {
    await assert.rejects(() => checks.escCancel(MUT.noEscCancel(src)), /Esc 로 취소했는데 놓기처럼 옮겼다|pointercancel 이 놓기처럼 옮겼다/);
  });
  test('변이②: 목록 밖 판정을 지우면 행동③ 이 실패한다', async () => {
    await assert.rejects(() => checks.noops(MUT.noOutside(src)), /목록 밖인데 빈 칸이 열렸다|목록 밖인데 다른 줄이|목록 밖에 놓았는데|아래 밖에 놓았는데/);
  });
  test('변이③: 여러 칸을 한 칸씩 나눠 옮기면(저장 여러 번) 행동① 이 실패한다', async () => {
    await assert.rejects(() => checks.dragDrop(MUT.stepSaves(src)), /저장이? 1회가 아니다/);
  });
  test('변이④: 끌기 시작의 잠금 관문을 지우면 행동⑤ 가 실패한다', async () => {
    await assert.rejects(() => checks.locked(MUT.noLockGate(src)), /잠긴 채 줄이 떠서 따라온다|잠금 토스트가 한 줄이 아니다/);
  });
}
