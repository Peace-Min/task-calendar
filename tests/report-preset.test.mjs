// 근태 보고 프리셋: 자주 쓰는 글 9칸을 Ctrl+1~9 로 본문에 넣는다(docs/REPORT-PRESET.md, 채택 B안 시안 report-preset-v2.html#B-open).
//
// 이 파일이 지키는 것:
//   (S) 정적: [프리셋] 단추는 waToolsHtml 한 벌로 일간, 주간 머리 줄 모두에 [문단 모양] 바로 뒤, 저장 키 tc_attPreset:,
//       근태 창 허용 목록은 그대로(#waPop 을 모드로 다시 쓴다, body 아래 새 띄움 창 없음), 창 안 Ctrl+Z 와 표 바꿈은 문단 모양 모드에서만.
//   (U) 순수: wa-core 의 fitPresets(깨진 값, 옛 값, 9칸 아닌 값), presetSlot(숫자 줄 Ctrl+1~9 만), presetLabel(이름, 첫 글 줄, 빈 칸).
//   (B) jsdom 근태 창(?win=attend): Ctrl+1~9 가 일간 과제 블록, 자유 메모, 주간 글 칸의 커서 자리에 글을 그대로 넣는다(고른 글은 바꾼다),
//       insertText 로 넣어 되돌리기 한 번에 빠지고 ATE, AWE 가 따라온다, 빈 칸은 바닥 줄 한 줄, 한글 조합 중이면 끝난 뒤 한 번,
//       보내는 중에는 넣지 않는다, 프리셋 창 열기, 바꾸기, 닫기, 고치면 계정별로 바로 저장, [넣기], 창 안 Ctrl+Z 는 글 칸 제 것, Esc.
//   변이: Shift+숫자로 바꾸기, 넣은 글을 문단 모양으로 다시 그리기, value 대입으로 넣기(되돌리기 깨짐)를 같은 검사가 잡는다.
// 생략 규약: jsdom 이 없으면 (B)와 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다.
import vm from 'node:vm';
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
const CORE_A = '/* ----- wa-core 시작', CORE_B = '/* ----- wa-core 끝 ----- */';
const fnBody = (name) => { const i = app.indexOf('function ' + name + '('); assert.ok(i > 0, name + ' 가 없다'); return app.slice(i, app.indexOf('\n}', i)); };

// ══ (S) 정적 ══════════════════════════════════════════════════════════
test('(S) [프리셋] 단추는 waToolsHtml 한 벌로 일간, 주간 머리 줄 모두에 [문단 모양] 바로 뒤, 저장 키 tc_attPreset:', () => {
  const th = fnBody('waToolsHtml');
  const a = th.indexOf('>문단 모양</button>'), b = th.indexOf('>프리셋</button>');
  assert.ok(a > 0 && b > a, '[프리셋] 이 [문단 모양] 뒤에 없다');
  assert.ok(/<button type="button" class="btn sm wa-b" data-wa-tool data-wa-pop="shape"[^>]*>문단 모양<\/button>/.test(th), '[문단 모양] 에 모드 표시가 없다');
  const pb = /<button [^>]*data-wa-pop="preset"[^>]*>프리셋<\/button>/.exec(th);
  assert.ok(pb, '[프리셋] 에 모드 표시가 없다');
  for (const attr of ['class="btn sm wa-b"', 'data-wa-tool', 'title="자주 쓰는 글(Ctrl+1~9)"', 'aria-controls="waPop"', 'aria-haspopup="dialog"', 'aria-expanded="false"'])
    assert.ok(pb[0].includes(attr), '[프리셋] 에 ' + attr + ' 가 없다');
  assert.strictEqual((app.match(/class="wa-tools"/g) || []).length, 2, '도구 자리가 두 곳이 아니다');
  assert.ok(fnBody('waInit').includes("document.querySelectorAll('.wa-tools').forEach(box => { box.innerHTML = waToolsHtml(); });"), '두 도구 자리를 waToolsHtml 한 벌로 채우지 않는다');
  assert.ok(app.includes("const WP_KEY_PREFIX = 'tc_attPreset:';"), '저장 키가 다르다');
  assert.ok(/localStorage\.setItem\(WP_KEY_PREFIX \+ WPS\.who, JSON\.stringify\(\{ v: 1, slots: WPS\.slots \}\)\)/.test(fnBody('wpSave')), '{ v: 1, slots } 로 저장하지 않는다');
});
test('(S) 근태 창 허용 목록은 그대로이고 작성 보조가 body 에 다는 띄움 창은 #waPop 하나다', () => {
  const m = /html\[data-attendwin\] body > ((?::not\(#[\w-]+\))+)\s*\{\s*display:\s*none !important/.exec(app);
  assert.ok(m, '근태 창 허용 목록 규칙을 찾지 못했다');
  assert.strictEqual(m[1], ':not(#atEd):not(#awEd):not(#awList):not(#confirmModal):not(#toastWrap):not(#vgGate):not(#waPop)', '근태 창 허용 목록이 바뀌었다');
  const ws = app.slice(app.indexOf("const WA_KEY_PREFIX = 'tc_attOutline:';"), app.indexOf('/* ===== 작성 보조 끝 ===== */'));
  assert.strictEqual((ws.match(/document\.body\.appendChild/g) || []).length, 1, '작성 보조가 body 에 띄움 창을 하나 넘게 단다');
  assert.ok(fnBody('wpPopHtml').includes("popHeadHtml('프리셋')"), '프리셋 모드에 공용 머리줄(× 포함)이 없다');
});
test('(S) 창 안 Ctrl+Z(waUndoTable)와 표 바꿈(waOnPopChange)은 문단 모양 모드에서만', () => {
  assert.ok(/function waUndoTable\(\)\{\n  if\(WAS\.mode !== 'shape'\) return;/.test(app), 'waUndoTable 이 모드를 보지 않는다');
  assert.ok(/function waOnPopChange\(ev\)\{\n  if\(WAS\.mode !== 'shape'\) return;/.test(app), 'waOnPopChange 가 모드를 보지 않는다');
  assert.ok(/if\(waPopShown\(\) && WAS\.mode === 'shape' && pop\.contains\(ev\.target\)[^\n]*waUndoTable\(\); return; \}/.test(fnBody('waInit')), '창 안 Ctrl+Z 가 모드를 보지 않는다');
});

// ══ (U) 순수: wa-core ═════════════════════════════════════════════════
function loadCore(core) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(core + '\nglobalThis.WA = WA;', ctx);
  return ctx.WA;
}
const coreSrc = () => app.slice(app.indexOf(CORE_A), app.indexOf(CORE_B));
const WA = loadCore(coreSrc());
const E9 = () => Array.from({ length: 9 }, () => ({ name: '', text: '' }));
const J = (x) => JSON.stringify(x);

test('(U) fitPresets: 늘 9칸 { name, text } 글자 값(깨진 값, 옛 값, 9칸 아닌 값)', () => {
  assert.strictEqual(WA.PRESET_SLOTS, 9);
  for (const bad of [null, undefined, '', 'x', 42, true, {}, { v: 1 }, { v: 1, slots: 'x' }, { v: 2, slots: [{ name: 'a', text: 'b' }] }, { slots: [{ name: 'a', text: 'b' }] }])
    assert.strictEqual(J(WA.fitPresets(bad)), J(E9()), '깨진 값 ' + J(bad) + ' 을 빈 9칸으로 읽지 않았다');
  const one = WA.fitPresets({ v: 1, slots: [{ name: '머리', text: 'A\nB' }] });
  assert.strictEqual(J(one), J([{ name: '머리', text: 'A\nB' }, ...E9().slice(1)]));
  //  칸 배열만 있어도 읽는다. 글자가 아닌 값, 빈 칸, 남는 칸
  const arr = WA.fitPresets([null, 5, { name: 7, text: ['x'] }, { text: 'T' }, { name: 'N' }, 'str', { name: 'a', text: 'b', extra: 1 }, {}, { name: '', text: '' }, { name: '열번째', text: 'x' }, { name: '열한번째', text: 'y' }]);
  assert.strictEqual(arr.length, 9, '남는 칸을 자르지 않았다');
  assert.strictEqual(J(arr), J([{ name: '', text: '' }, { name: '', text: '' }, { name: '', text: '' }, { name: '', text: 'T' }, { name: 'N', text: '' }, { name: '', text: '' }, { name: 'a', text: 'b' }, { name: '', text: '' }, { name: '', text: '' }]));
  const short = WA.fitPresets([{ name: '1', text: '하나' }, { name: '2', text: '둘' }]);
  assert.strictEqual(J(short.slice(0, 2)), J([{ name: '1', text: '하나' }, { name: '2', text: '둘' }]));
  assert.strictEqual(short.length, 9);
  //  글은 손대지 않는다(앞뒤 빈칸, 탭, 줄 끝)
  assert.strictEqual(WA.fitPresets([{ name: ' n ', text: '\t* 탭\n  \n' }])[0].text, '\t* 탭\n  \n');
  //  돌려준 값을 고쳐도 원본이 바뀌지 않는다(새 객체)
  const src = [{ name: 'a', text: 'b' }]; WA.fitPresets(src)[0].name = 'z'; assert.strictEqual(src[0].name, 'a');
});
//  변이 M1 이 같은 검사를 쓰므로 함수로 둔다
function checkSlot(W) {
  for (let n = 1; n <= 9; n++) {
    assert.strictEqual(W.presetSlot({ code: 'Digit' + n, ctrlKey: true }), n - 1, 'Ctrl+' + n);
    assert.strictEqual(W.presetSlot({ code: 'Digit' + n, metaKey: true }), n - 1, 'Meta+' + n);
  }
  const no = [
    { code: 'Digit0', ctrlKey: true }, { code: 'Numpad1', ctrlKey: true }, { code: 'Digit1' }, { code: 'Digit1', shiftKey: true },
    { code: 'Digit1', ctrlKey: true, shiftKey: true }, { code: 'Digit1', ctrlKey: true, altKey: true }, { code: 'Digit1', altKey: true },
    { code: 'KeyA', ctrlKey: true }, { key: '1', ctrlKey: true }, { code: '', ctrlKey: true },
  ];
  for (const e of no) assert.strictEqual(W.presetSlot(e), -1, J(e) + ' 를 프리셋 키로 받았다');
  assert.strictEqual(W.presetSlot(null), -1);
}
test('(U) presetSlot: 숫자 줄 Ctrl+1~9 만(숫자 패드, Ctrl+0, Shift, Alt, Ctrl 없음은 -1)', () => { checkSlot(WA); });
test('(U) presetLabel: 이름, 없으면 글의 첫 글 줄, 둘 다 없으면 빈 칸', () => {
  assert.strictEqual(WA.presetLabel({ name: '머리', text: 'A' }), '머리');
  assert.strictEqual(WA.presetLabel({ name: '  ', text: '\n   \n  ***\n> 시스템운용 : 홍길동' }), '***');
  assert.strictEqual(WA.presetLabel({ name: '', text: '' }), '');
  assert.strictEqual(WA.presetLabel({ name: '', text: '  \n\t\n' }), '');
  assert.strictEqual(WA.presetLabel({ name: '이름만', text: '' }), '이름만');
  assert.strictEqual(WA.presetLabel(null), '');
});
const MUT_CORE = ['M1 Ctrl 대신 Shift+숫자', 'if(!m || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return -1;', 'if(!m || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return -1;'];
test('변이: ' + MUT_CORE[0] + ' 을 키 판정 검사가 잡는다', () => {
  const core = coreSrc(), i = core.indexOf(MUT_CORE[1]);
  assert.ok(i > 0 && i === core.lastIndexOf(MUT_CORE[1]), '변이 앵커가 없거나 여럿이다');
  const W = loadCore(core.slice(0, i) + MUT_CORE[2] + core.slice(i + MUT_CORE[1].length));
  assert.throws(() => checkSlot(W), assert.AssertionError);
});

// ══ (B) jsdom 근태 창 ═════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
if (!JSDOM) {
  skip('report-preset: jsdom 미설치, 프리셋 화면 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const ATTEND_URL = 'https://tcapp.local/index.html?win=attend';
  const HEAD = '***\n> 시스템운용 : 홍길동/김철수\n***\n[가상 훈련장비](~\'28/12)\n';
  const TABBY = '\t* 탭 줄\n3. 번호 그대로\n　전각';
  const SEED = { v: 1, slots: [{ name: '머리', text: HEAD }, { name: '', text: TABBY }, { name: '짧은', text: '짧은 글' }] };
  //  위젯처럼 insertText 를 받는 execCommand(되돌리기 한 단계가 되는 길). 부른 기록은 __exec
  function fakeExec(win) {
    win.__exec = [];
    win.document.execCommand = function (cmd, ui, val) {
      const ta = win.document.activeElement;
      if (!ta || ta.tagName !== 'TEXTAREA' || (cmd !== 'insertText' && cmd !== 'delete')) return false;
      const t = cmd === 'insertText' ? String(val) : '';
      win.__exec.push([cmd, t]);
      ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: cmd === 'insertText' ? 'insertText' : 'deleteContentBackward', data: t || null }));
      return true;
    };
  }
  function boot(pre, src = app) {
    const posted = [], errors = [];
    const vc = new jsdomMod.VirtualConsole();
    vc.on('jsdomError', (e) => { const s = String(e && (e.stack || e.message) || e); if (!/Not implemented/.test(s)) errors.push(s); });
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: ATTEND_URL, virtualConsole: vc,
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); }, addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.open = () => null;
        win.__realClose = win.close; win.close = function () {};
        win.localStorage.clear();
        win.localStorage.setItem('tc_attPreset:7', JSON.stringify(SEED));
        fakeExec(win);
        if (pre) pre(win);
      },
    });
    const w = dom.window;
    const X = { w, doc: w.document, posted, errors, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      $: (s) => w.document.querySelector(s), close: () => { try { w.__realClose.call(w); } catch (_) {} } };
    X.ev('window.__calls = []; hostRequest = function(cmd, p){ __calls.push(cmd); return Promise.resolve({ ok: true, rows: [] }); };');
    return X;
  }
  const PROJ = [{ key: 'c-a', name: '알파', color: '#3e5be0' }, { key: 'c-b', name: '베타', color: '#2e9e6b' }];
  const dayPayload = (X, uid) => ({ v: 1, date: X.ev('todayYmd()'), me: { userId: uid, loginId: 'u' + uid, name: '시험자' },
    saved: { status: '1', overtime: 0, content: '* 외근\n\n[알파] : 2\n- 한 일\n- 두 일\n\n[베타] : 1\n- 회신', sentAt: '' }, projects: PROJ });
  const openDay = (X, uid = 7) => X.ev('__attendWinOpen(' + JSON.stringify(dayPayload(X, uid)) + ')');
  async function openWeek(X, uid = 7) {
    X.ev('__attendWinOpen(' + JSON.stringify({ v: 1, kind: 'week', mon: '2026-10-26', me: { userId: uid, loginId: 'u' + uid, name: '시험자' }, saved: null, projects: PROJ, refresh: false }) + ')');
    await tick(40);
  }
  function key(X, el, k, o = {}) {
    const ev = new X.w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o));
    if (o.keyCode) Object.defineProperty(ev, 'keyCode', { get: () => o.keyCode });
    el.dispatchEvent(ev); return ev.defaultPrevented;
  }
  const ctrl = (X, el, n, o = {}) => key(X, el, String(n), Object.assign({ code: 'Digit' + n, ctrlKey: true }, o));
  const caret = (ta, s, e = s) => { ta.focus(); ta.setSelectionRange(s, e); };
  const setVal = (X, el, v) => { el.value = v; el.dispatchEvent(new X.w.Event('input', { bubbles: true })); };
  const blk = (X, i) => X.$('#atBlocks textarea[data-bt="' + i + '"]');
  const pop = (X) => X.$('#waPop');
  const shown = (X) => !pop(X).classList.contains('hidden');
  const pane = (X, m) => pop(X).querySelector('[data-pane="' + m + '"]');
  const btn = (X, ed, m) => X.$(ed + ' .wa-tools .wa-b[data-wa-pop="' + m + '"]');
  const labels = (X) => [...pop(X).querySelectorAll('.wp-row')].map((r) => (r.classList.contains('empty') ? '~' : '') + r.querySelector('.wp-n').textContent);
  const inserts = (X) => X.evJSON('__exec').filter((c) => c[0] === 'insertText').map((c) => c[1]);

  //  넣기 핵심(변이 M2, M3 이 같은 검사를 쓴다): 커서 자리, 고른 글 바꾸기, 글 그대로, insertText 로, ATE 가 따라온다
  async function checkInsert(X) {
    openDay(X);
    const ta = blk(X, 0);
    assert.strictEqual(ta.value, '- 한 일\n- 두 일');
    caret(ta, 0);
    assert.strictEqual(ctrl(X, ta, 1), true, 'Ctrl+1 의 기본 동작을 막지 않았다');
    assert.deepStrictEqual([ta.value, ta.selectionStart, ta.selectionEnd], [HEAD + '- 한 일\n- 두 일', HEAD.length, HEAD.length], 'Ctrl+1 이 커서 자리에 글을 넣지 않았다');
    assert.deepStrictEqual(inserts(X), [HEAD], 'insertText 로 넣지 않았다(되돌리기 한 번에 빠지지 않는다)');
    assert.strictEqual(X.ev('ATE.blocks[0].text'), ta.value, 'ATE 가 넣은 글을 따라오지 않았다');
    //  고른 글은 바꾼다. 탭, 번호, 전각 공백도 글자 그대로(문단 모양으로 다시 그리지 않는다)
    const at = ta.value.indexOf('한 일');
    caret(ta, at, at + 3);
    assert.strictEqual(ctrl(X, ta, 2), true);
    const want = HEAD + '- ' + TABBY + '\n- 두 일';
    assert.deepStrictEqual([ta.value, ta.selectionStart], [want, at + TABBY.length], '고른 글을 프리셋 글 그대로 바꾸지 않았다');
    assert.deepStrictEqual(inserts(X), [HEAD, TABBY]);
    assert.strictEqual(X.ev('ATE.blocks[0].text'), want);
    X.ev('atDraftFlushNow()');
    assert.strictEqual(JSON.parse(X.ev('localStorage.getItem(attDraftKey(ATE.date))')).blocks[0].text, want, '임시 저장에 넣은 글이 없다');
  }

  test('(B) Ctrl+1~9: 일간 과제 블록 커서 자리에 그대로 넣고 고른 글은 바꾼다, insertText 라 되돌리기 한 번, ATE 와 임시 저장이 따라온다', async () => {
    const X = boot();
    try { await checkInsert(X); assert.deepStrictEqual(X.errors, []); } finally { X.close(); }
  });

  test('(B) 자유 메모와 주간 세 칸에서도 넣고 AWE 가 따라온다, Shift, 숫자 패드, Ctrl+0 은 그대로, 빈 칸은 바닥 줄 한 줄(일간, 주간)', async () => {
    const X = boot();
    try {
      openDay(X);
      const memo = X.$('#atBlocks textarea[data-memo]');
      caret(memo, memo.value.length);
      ctrl(X, memo, 3);
      assert.deepStrictEqual([memo.value, X.ev('ATE.memo')], ['* 외근짧은 글', '* 외근짧은 글'], '자유 메모에 넣지 않았거나 ATE.memo 가 따라오지 않았다');
      const ta = blk(X, 1), v0 = ta.value;
      caret(ta, 0);
      assert.strictEqual(ctrl(X, ta, 1, { shiftKey: true }), false, 'Ctrl+Shift+1 을 가로챘다');
      assert.strictEqual(ctrl(X, ta, 1, { code: 'Numpad1' }), false, '숫자 패드를 받았다');
      assert.strictEqual(ctrl(X, ta, 0), false, 'Ctrl+0 을 받았다');
      assert.strictEqual(ta.value, v0);
      //  빈 칸: 글은 그대로, 기본 동작은 막고, 바닥 줄 한 줄
      assert.strictEqual(ctrl(X, ta, 9), true, '빈 칸 Ctrl+9 의 기본 동작을 막지 않았다');
      assert.deepStrictEqual([ta.value, X.$('#atMsg').textContent], [v0, '9번 프리셋이 비어 있습니다.'], '빈 칸 메시지가 일간 바닥 줄에 없다');
      assert.strictEqual(X.doc.querySelectorAll('#toastWrap .toast').length, 0, '빈 칸에 토스트를 띄웠다');
      await openWeek(X);
      const prog = X.$('#awProg'), plan = X.$('#awPlan'), meet = X.$('#awMeet');
      setVal(X, prog, '[알파]\n- 한 일'); setVal(X, plan, '- 다음'); setVal(X, meet, '');
      caret(prog, 4); ctrl(X, prog, 3);
      caret(plan, plan.value.length); ctrl(X, plan, 3);
      caret(meet, 0); ctrl(X, meet, 1);
      assert.deepStrictEqual([prog.value, plan.value, meet.value], ['[알파]짧은 글\n- 한 일', '- 다음짧은 글', HEAD], '주간 칸에 넣지 않았다');
      assert.deepStrictEqual(X.evJSON('[AWE.prog, AWE.plan, AWE.meet]'), [prog.value, plan.value, meet.value], 'AWE 가 넣은 글을 따라오지 않았다');
      caret(plan, 0); ctrl(X, plan, 5);
      assert.deepStrictEqual([plan.value, X.$('#awMsg').textContent], ['- 다음짧은 글', '5번 프리셋이 비어 있습니다.'], '빈 칸 메시지가 주간 바닥 줄에 없다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 한글 조합 중 Ctrl+1 은 조합이 끝난 뒤 한 번 넣는다, 보내는 중에는 넣지 않는다', async () => {
    const X = boot();
    try {
      openDay(X);
      const ta = blk(X, 0);
      setVal(X, ta, '- 진'); caret(ta, ta.value.length);
      ta.dispatchEvent(new X.w.CompositionEvent('compositionstart', { bubbles: true }));
      assert.strictEqual(ctrl(X, ta, 3, { key: 'Process', keyCode: 229, isComposing: true }), true, '조합 중 Ctrl+3 의 기본 동작을 막지 않았다');
      assert.strictEqual(ta.value, '- 진', '조합 중에 바로 넣었다');
      ta.value = '- 진행'; ta.setSelectionRange(4, 4);
      ta.dispatchEvent(new X.w.CompositionEvent('compositionend', { bubbles: true, data: '행' }));
      await tick(10);
      assert.strictEqual(ta.value, '- 진행짧은 글', '조합이 끝난 뒤 넣지 않았다');
      await tick(10);
      assert.deepStrictEqual(inserts(X), ['짧은 글'], '한 번이 아니다');
      assert.strictEqual(X.ev('ATE.blocks[0].text'), '- 진행짧은 글');
      //  보내는 중(ATE.sending): 칸이 아직 잠기지 않았어도 넣지 않는다. 잠근 뒤에도 그대로
      X.ev('ATE.sending = true');
      caret(ta, 0); ctrl(X, ta, 3);
      X.ev('atSetBusy(true)'); ctrl(X, ta, 3);
      assert.strictEqual(ta.value, '- 진행짧은 글', '보내는 중에 넣었다');
      X.ev('ATE.sending = false; atSetBusy(false)');
      const tb = blk(X, 0);   // 잠금을 풀면 블록을 다시 그린다
      caret(tb, 0); ctrl(X, tb, 3);
      assert.strictEqual(tb.value, '짧은 글- 진행짧은 글', '보내기가 끝났는데 넣지 않는다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 프리셋 창: #waPop 을 프리셋 모드로 연다, 같은 단추는 닫고 다른 단추는 내용만 바꾼다, 9칸 목록 이름, 보내는 중이면 닫힌다', () => {
    const X = boot();
    try {
      openDay(X);
      const pb = btn(X, '#atEd', 'preset'), sb = btn(X, '#atEd', 'shape');
      assert.strictEqual(X.$('#atEd .wa-b'), sb, '첫 .wa-b 가 [문단 모양] 이 아니다');
      assert.ok(btn(X, '#awEd', 'preset'), '주간 머리 줄에 [프리셋] 이 없다');
      assert.strictEqual(pb.disabled, false);
      pb.click();
      assert.deepStrictEqual([shown(X), pane(X, 'preset').classList.contains('hidden'), pane(X, 'shape').classList.contains('hidden'), pop(X).getAttribute('aria-label')],
        [true, false, true, '프리셋'], '프리셋 모드로 열리지 않았다');
      assert.deepStrictEqual([pb.getAttribute('aria-expanded'), sb.getAttribute('aria-expanded')], ['true', 'false']);
      assert.ok(pop(X).classList.contains('wa-pop-pre'));
      assert.strictEqual(pane(X, 'preset').querySelector('.pop-head b').textContent, '프리셋');
      assert.deepStrictEqual(labels(X), ['머리', '\t* 탭 줄'.trim(), '짧은', '~비어 있음', '~비어 있음', '~비어 있음', '~비어 있음', '~비어 있음', '~비어 있음'], '목록 이름이 다르다');
      assert.deepStrictEqual([...pop(X).querySelectorAll('.wp-row .wp-k')].map((k) => k.textContent), Array.from({ length: 9 }, (_, i) => 'Ctrl+' + (i + 1)));
      assert.ok(pop(X).querySelector('.wp-row[data-slot="0"]').classList.contains('sel'), '처음 고른 칸이 1번이 아니다');
      assert.deepStrictEqual([pop(X).querySelector('.wp-name').value, pop(X).querySelector('.wp-text').value], ['머리', HEAD]);
      assert.deepStrictEqual([pop(X).querySelector('.wp-name').placeholder, pop(X).querySelector('.wp-text').placeholder, pop(X).querySelector('.wp-put').textContent], ['이름(선택)', '넣을 글', '넣기']);
      //  다른 단추: 닫지 않고 문단 모양으로 바꾼다
      sb.click();
      assert.deepStrictEqual([shown(X), pane(X, 'shape').classList.contains('hidden'), pane(X, 'preset').classList.contains('hidden'), pop(X).getAttribute('aria-label'), pop(X).classList.contains('wa-pop-pre')],
        [true, false, true, '문단 모양', false], '문단 모양으로 바뀌지 않았다');
      assert.deepStrictEqual([pb.getAttribute('aria-expanded'), sb.getAttribute('aria-expanded')], ['false', 'true']);
      sb.click();
      assert.strictEqual(shown(X), false, '같은 단추로 닫히지 않았다');
      pb.click(); pb.click();
      assert.strictEqual(shown(X), false, '[프리셋] 을 두 번 눌러도 닫히지 않았다');
      assert.deepStrictEqual([pb.getAttribute('aria-expanded'), sb.getAttribute('aria-expanded')], ['false', 'false']);
      //  × 로 닫힌다(프리셋 모드의 머리줄)
      pb.click(); pane(X, 'preset').querySelector('[data-popx]').click();
      assert.strictEqual(shown(X), false, '프리셋 머리줄 × 로 닫히지 않았다');
      //  바깥 누르기
      pb.click(); X.$('#atStatus').dispatchEvent(new X.w.MouseEvent('mousedown', { bubbles: true }));
      assert.strictEqual(shown(X), false, '바깥을 눌러도 닫히지 않았다');
      //  보내는 중이면 닫히고 두 단추 모두 꺼진다
      pb.click();
      X.ev('ATE.sending = true; atSetBusy(true)');
      assert.deepStrictEqual([shown(X), pb.disabled, sb.disabled], [false, true, true], '보내는 중인데 창이 열려 있거나 단추가 켜져 있다');
      X.ev('ATE.sending = false; atSetBusy(false)');
      assert.deepStrictEqual([pb.disabled, sb.disabled], [false, false]);
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 고치면 계정별로 바로 저장하고 목록 이름이 따라온다, 다른 계정은 제 칸, 다시 열면 읽는다, 고친 칸을 Ctrl+숫자로 넣는다', () => {
    const X = boot();
    try {
      openDay(X);
      btn(X, '#atEd', 'preset').click();
      pop(X).querySelector('.wp-row[data-slot="3"]').click();
      assert.ok(pop(X).querySelector('.wp-row[data-slot="3"]').classList.contains('sel'));
      assert.deepStrictEqual([pop(X).querySelector('.wp-name').value, pop(X).querySelector('.wp-text').value, pop(X).querySelector('.wp-ed-k').textContent], ['', '', 'Ctrl+4']);
      setVal(X, pop(X).querySelector('.wp-text'), '\n  [가상 운용 지원]\n- 정기 점검');
      assert.strictEqual(labels(X)[3], '[가상 운용 지원]', '글을 고쳤는데 목록 이름이 첫 글 줄로 바뀌지 않았다');
      setVal(X, pop(X).querySelector('.wp-name'), '운용 지원');
      assert.strictEqual(labels(X)[3], '운용 지원');
      const saved = JSON.parse(X.ev("localStorage.getItem('tc_attPreset:7')"));
      assert.strictEqual(saved.v, 1);
      assert.strictEqual(J(saved.slots[3]), J({ name: '운용 지원', text: '\n  [가상 운용 지원]\n- 정기 점검' }), '고친 칸을 바로 저장하지 않았다');
      assert.strictEqual(J(saved.slots.slice(0, 3)), J(SEED.slots), '다른 칸이 바뀌었다');
      //  창 안 글 칸의 Ctrl+숫자는 아무것도 하지 않는다
      const tx = pop(X).querySelector('.wp-text');
      assert.strictEqual(ctrl(X, tx, 1), false, '창 안 글 칸의 Ctrl+1 을 가로챘다');
      pop(X).querySelector('.wp-row[data-slot="0"]').click();
      assert.strictEqual(pop(X).querySelector('.wp-text').value, HEAD, '다른 칸을 고르면 그 칸 글이 보이지 않는다');
      X.ev('waClosePop(false)');
      const ta = blk(X, 1); caret(ta, 0); ctrl(X, ta, 4);
      assert.strictEqual(ta.value, '\n  [가상 운용 지원]\n- 정기 점검- 회신', '고친 칸을 Ctrl+4 로 넣지 않았다');
      //  다른 계정은 제 칸(빈 9칸), 7번으로 돌아오면 저장값
      X.ev('__attendWinHidden()'); openDay(X, 8);
      btn(X, '#atEd', 'preset').click();
      assert.deepStrictEqual(labels(X), Array(9).fill('~비어 있음'), '다른 계정이 7번 계정 칸을 썼다');
      setVal(X, pop(X).querySelector('.wp-text'), '팔번');
      assert.strictEqual(JSON.parse(X.ev("localStorage.getItem('tc_attPreset:8')")).slots[0].text, '팔번');
      X.ev('__attendWinHidden()'); openDay(X, 7);
      btn(X, '#atEd', 'preset').click();
      assert.deepStrictEqual(labels(X).slice(0, 4), ['머리', '* 탭 줄', '짧은', '운용 지원'], '7번 계정 칸을 다시 읽지 않았다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
    //  깨진 저장값: 빈 9칸으로 열리고 오류 없음
    const Y = boot((w) => w.localStorage.setItem('tc_attPreset:7', '{깨짐'));
    try {
      openDay(Y); btn(Y, '#atEd', 'preset').click();
      assert.deepStrictEqual(labels(Y), Array(9).fill('~비어 있음'));
      const ta = blk(Y, 0), v0 = ta.value; caret(ta, 0); ctrl(Y, ta, 1);
      assert.strictEqual(ta.value, v0);
      assert.deepStrictEqual(Y.errors, []);
    } finally { Y.close(); }
  });

  test('(B) [넣기]: 마지막에 쓰던 본문 칸에 넣고 창을 닫고 커서는 넣은 글 뒤, 본문이 없거나 빈 칸이면 바닥 줄 한 줄이고 창은 그대로', () => {
    const X = boot();
    try {
      openDay(X);
      const ta = blk(X, 1);
      caret(ta, 2);
      btn(X, '#atEd', 'preset').click();
      pop(X).querySelector('.wp-row[data-slot="2"]').click();
      pop(X).querySelector('.wp-name').focus();
      pop(X).querySelector('.wp-put').click();
      assert.strictEqual(shown(X), false, '[넣기] 뒤에 창이 닫히지 않았다');
      assert.strictEqual(X.doc.activeElement, ta, '[넣기] 뒤 초점이 본문으로 가지 않았다');
      assert.deepStrictEqual([ta.value, ta.selectionStart, ta.selectionEnd], ['- 짧은 글회신', 6, 6], '[넣기] 가 커서 자리에 넣지 않았다');
      assert.strictEqual(X.ev('ATE.blocks[1].text'), '- 짧은 글회신');
      assert.deepStrictEqual(inserts(X), ['짧은 글']);
      //  빈 칸: 창은 그대로
      btn(X, '#atEd', 'preset').click();
      pop(X).querySelector('.wp-row[data-slot="6"]').click();
      pop(X).querySelector('.wp-put').click();
      assert.deepStrictEqual([shown(X), X.$('#atMsg').textContent, ta.value], [true, '7번 프리셋이 비어 있습니다.', '- 짧은 글회신']);
      //  고칠 본문이 없을 때(도구는 켜져 있다)
      X.ev('waReset()');
      assert.strictEqual(btn(X, '#atEd', 'preset').disabled, false, '고칠 본문이 없다고 [프리셋] 이 꺼졌다');
      btn(X, '#atEd', 'preset').click();
      pop(X).querySelector('.wp-row[data-slot="0"]').click();
      pop(X).querySelector('.wp-put').click();
      assert.deepStrictEqual([shown(X), X.$('#atMsg').textContent], [true, '넣을 본문 칸을 먼저 누르세요.'], '본문이 없을 때 메시지가 없거나 창이 닫혔다');
      assert.deepStrictEqual(inserts(X), ['짧은 글'], '본문이 없는데 넣었다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 프리셋 모드의 창 안 Ctrl+Z 는 글 칸 제 되돌리기(waUndoTable 을 부르지 않는다), 문단 모양 모드는 그대로, Esc 는 창만 닫는다', () => {
    const X = boot();
    try {
      openDay(X);
      X.ev('window.__undo = 0; (function(){ var u = waUndoTable; waUndoTable = function(){ __undo++; return u(); }; })()');
      caret(blk(X, 0), 0);
      btn(X, '#atEd', 'preset').click();
      const tx = pop(X).querySelector('.wp-text'), nm = pop(X).querySelector('.wp-name');
      tx.focus();
      assert.strictEqual(key(X, tx, 'z', { code: 'KeyZ', ctrlKey: true }), false, '프리셋 글 칸의 Ctrl+Z 를 가로챘다');
      assert.strictEqual(key(X, nm, 'z', { code: 'KeyZ', ctrlKey: true }), false, '프리셋 이름 칸의 Ctrl+Z 를 가로챘다');
      assert.strictEqual(X.ev('__undo'), 0, '프리셋 모드에서 waUndoTable 을 불렀다');
      //  프리셋 칸의 change 는 표를 건드리지 않는다
      const t0 = X.ev('JSON.stringify(waT())');
      tx.dispatchEvent(new X.w.Event('change', { bubbles: true }));
      assert.strictEqual(X.ev('JSON.stringify(waT())'), t0);
      //  문단 모양 모드는 그대로 창 안 Ctrl+Z
      btn(X, '#atEd', 'shape').click();
      const sym = pop(X).querySelector('.wa-sym[data-r="0"]');
      assert.strictEqual(key(X, sym, 'z', { code: 'KeyZ', ctrlKey: true }), true);
      assert.strictEqual(X.ev('__undo'), 1, '문단 모양 모드의 창 안 Ctrl+Z 가 waUndoTable 을 부르지 않았다');
      //  Esc: 프리셋 모드에서도 창만 닫고 초점은 고칠 본문으로
      btn(X, '#atEd', 'preset').click();
      tx.focus();
      tx.dispatchEvent(new X.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert.strictEqual(shown(X), false, 'Esc 로 창이 닫히지 않았다');
      assert.ok(X.ev('!!ATE.p'), 'Esc 가 근태 보고 화면까지 닫았다');
      assert.strictEqual(X.doc.activeElement, blk(X, 0), 'Esc 뒤 초점이 고칠 본문으로 돌아가지 않았다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  //  변이: 넣은 글을 문단 모양으로 다시 그리거나(붙여넣기 처리), value 대입으로 넣으면(되돌리기 깨짐) 넣기 핵심 검사가 잡는다
  const MUT_B = [
    ['M2 넣은 글을 문단 모양으로 다시 그리기', 'return { from: s, to: e, text: t, selS: s + t.length, selE: s + t.length };', 'return WA.pasteOp(v, s, e, t, waT());'],
    ['M3 waEdit 대신 value 대입', '  if(op){ waEdit(ta, op); waRefresh(); }\n  return !!op;',
      "  if(op){ ta.value = WA.applyOp(ta.value, op); ta.setSelectionRange(op.selS, op.selE); ta.dispatchEvent(new Event('input', { bubbles: true })); waRefresh(); }\n  return !!op;"],
  ];
  for (const [name, find, repl] of MUT_B) {
    test('변이: ' + name + ' 를 넣기 검사가 잡는다', async () => {
      const a = app.indexOf(find);
      assert.ok(a > 0 && a === app.lastIndexOf(find), '변이 앵커가 없거나 여럿이다: ' + find.slice(0, 60));
      const X = boot(null, app.slice(0, a) + repl + app.slice(a + find.length));
      try { await assert.rejects(() => checkInsert(X), assert.AssertionError); } finally { X.close(); }
    });
  }
}
