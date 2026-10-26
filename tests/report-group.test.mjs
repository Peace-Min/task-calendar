// 보고서 묶음(docs/REPORT-GROUP.md, 2026-10-08): §6 시험.
//
// 이 파일이 지키는 것:
//   (S) 정적: 묶음이 없을 때의 예전 길(머리 줄 시간 함수, 주간 네 칸 감싸기, 복사 갈래)이 그대로 남아 있다, 묶음 함수는 PEER 를
//       저장소보다 먼저 본다, 설정 창 마크업(제목, 모두 풀기와 닫기, X 와 ⋯ 이름, 머리 과제만 넣을 곳,
//       예전 선택 상자 없음, 포인터 끌기, 터치는 ⠿ 에만 touch-action), 좁은 폭 CSS, 새 문구 기호, 끌어 놓기 판정 rptGroupDropTarget(순수 함수).
//   (B) jsdom 브라우저 모드, 일간: 묶음 없을 때 바이트 같음(복사, 전송, 낡은 묶음 흔적이 있어도), 묶음 적용(머리 줄 목록, 합친 시간과
//       소수 반올림, 본문 초안 꼴: 이름 줄 + 한 단계 더 들여쓰기, 머리기호 번호 이어짐, payload.hours = 머리 줄), 한 단계 규칙(설정 창 구조, 넣을 곳, 끌기),
//       공식 과제 묶기, X(대상은 묶음 전체, 작은 카드는 그 과제만), 임시 저장(묶음만으로 키, 닫고 열기, 재시작, 날짜별, 새 날짜는 묶음 없음,
//       모두 초안으로가 묶음까지 지움, 렌더는 쓰지 않음), 낡은 초안 안내, 묶인 과제의 고친 글은 묶음 동안 쉬었다가 풀면 다시 쓰인다, 설정 창 접근성(⋯ 메뉴 키보드, 포커스),
//       내용 없는 과제 접기, 끌어 놓기(포인터 이벤트를 MouseEvent 로 흉내, elementFromPoint 바꿔 끼우기), 모두 풀기.
//   (B) 주간 캘린더 출처: 바이트 같음, 과제투입시간과 합계, 진행사항, 차주계획, 복사, 기간별 저장, X 와 묶음, 설정 창(이번 주 문구, 업무와 시간, 끌기).
//   (W) jsdom 위젯 모드: 일간 전송 성공 회신이 묶음까지 지운다, 보낸 뒤 묶음을 바꾸면 지우지 않는다, 주간 net 출처 묶음과 바이트 같음.
//   (P) 열람 창(PEER): 묶음 줄이 없고 임시 저장 접근 0.
//   (M) 변이: 위 계약을 되돌리면 같은 검사기가 잡는다.
// ★ 실제 netcus 전송과 채우기는 없다. Platform.report.submitDaily / submitWeekly 를 가로채 payload 만 본다.
// ★ 시험마다 시작과 끝에 tc_rptDraft 키를 지운다(렌더는 쓰지 않으므로 키는 사용자 동작으로만 생긴다).
// 생략 규약: jsdom 이 없으면 (B)(W)(P)와 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

// 앵커 하나를 정확히 한 번 바꾼다(없거나 여럿이면 실패: 조용히 통과하는 껍데기 변이를 막는다).
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 120));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 120));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}

// ══════════════════════════════════════════════════════════════════════
// (S) 정적 검사기
// ══════════════════════════════════════════════════════════════════════
const S = {
  //  §3, §6: 묶음이 없으면 예전 길: 머리 줄 시간은 getTaskHours 그대로, 주간은 예전 조립을 그대로 돌려주고, 복사는 예전 갈래.
  fastPaths(src) {
    const dh = extractFunction(src, 'reportDailyHours');
    assert.ok(dh.includes('const _g = rptDayGroup(rows, date);') && /: getTaskHours\(date, r\.key\) \}\)\)/.test(dh), 'reportDailyHours 가 묶음이 없을 때 예전 값(getTaskHours)을 그대로 쓰지 않는다');
    const lv = extractFunction(src, 'rptGroupLive');
    assert.ok(lv.includes('ks.has(group[k])') && lv.includes('if(!cand.has(t)) live.set(s, t);'), '지금 행에 없는 대상이나 두 단계 묶음을 거르지 않는다(낡은 흔적이 글을 바꾼다)');
    const o = extractFunction(src, 'rptWOutFields');
    assert.ok(/if\(!L\.any\) return base;/.test(o), '주간: 초안이 닿지 않으면 예전 결과를 그대로 돌려주지 않는다');
    assert.ok(o.includes('content: (L.out.length || L.group.length) ? c.content : base.content,'), '주간: 묶음이 과제투입시간과 합계를 다시 내지 않는다');
    const bt = extractFunction(src, 'buildReportText');
    assert.ok(bt.includes(': reportRowBodyText(r, indentUnit, _mkSpec, _indent);') && bt.includes('(_dg && _dg.kids.has(r.key)) ? reportGroupBodyText('), '일간 복사, 전송 글이 묶음 대상만 묶음 본문으로 만들지 않는다');
  },
  //  §5: 열람 창은 부모와 localStorage 를 같이 쓴다. 묶음 문맥은 저장소보다 PEER 를 먼저 본다.
  peerFirst(src) {
    const b = extractFunction(src, 'rptGroupCtx');
    const g = b.indexOf('if(PEER) return null;');
    const touch = Math.min(...['rptDraftGet(', 'rptWDraftGet('].map(t => { const i = b.indexOf(t); return i < 0 ? Infinity : i; }));
    assert.ok(g > 0 && g < touch, 'rptGroupCtx 가 PEER 를 저장소보다 먼저 보지 않는다: 열람 창에 묶음 설정이 생기거나 내 초안을 읽는다');
    const on = src.slice(src.indexOf("$('#rptGroupOpen').addEventListener('click'"), src.indexOf("$('#rgmRows').addEventListener('click'"));
    assert.ok(on.includes('if(PEER || !rptGroupCtx()) return;'), '설정 링크 처리기가 열람 창을 막지 않는다');
  },
  //  §4(2026-10-08 끌어넣기): 설정 창: 보고서 창 뒤 형제(위에 뜬다), 제목, 아래 "모두 풀기"와 닫기, 줄마다 X(꺼내기)와 ⋯(메뉴) 이름,
  //    넣을 곳 메뉴는 머리 과제만(한 단계), 예전 선택 상자와 그 CSS 는 없다, 끌기는 포인터 이벤트, 터치 끌기는 ⠿ 에만 touch-action, 좁은 폭 32px.
  dialogMarkup(src) {
    const a = src.indexOf('<div class="overlay hidden" id="reportModal">'), b = src.indexOf('<div class="overlay hidden" id="rptGroupModal">');
    assert.ok(a > 0 && b > a, '설정 창이 보고서 창보다 앞에 있다(뒤에 깔린다)');
    const m = src.slice(b, src.indexOf('\n</div>\n', b));
    assert.ok(m.includes('<h2>보고서 묶음</h2>'), '설정 창 제목이 없다');
    assert.strictEqual(m.split('<button').length - 1, 2, '설정 창 아래 버튼은 "모두 풀기"와 닫기 둘이어야 한다');
    assert.ok(m.includes('data-close>닫기</button>') && m.includes('id="rgmClear" disabled>모두 풀기</button>'), '닫기([data-close])나 모두 풀기가 없다');
    assert.ok(!m.includes('<select') && !m.includes('rgm-sel'), '예전 선택 상자가 남았다');
    const r = extractFunction(src, 'rptGroupDlgRender');
    assert.ok(r.includes('aria-label="${esc(x.name)} 꺼내기"') && r.includes('title="꺼내기"'), '묶인 과제 X 에 "이름 꺼내기" 이름이 없다');
    assert.ok(r.includes('aria-haspopup="menu"') && r.includes('aria-label="${esc(x.name)} 메뉴"') && r.includes('role="menuitem"') && r.includes('role="menu"'), '⋯ 메뉴의 접근성 표지(haspopup, 이름, role)가 없다');
    assert.ok(r.includes('tops.filter(y => y.k !== __rgm.menuFor)'), '한 단계 규칙: 넣을 곳 메뉴가 머리 과제만이 아니다(자기 자신이나 묶인 과제가 들어간다)');
    assert.ok(!/<select|<option/.test(r), '설정 창이 아직 선택 상자를 그린다');
    const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
    assert.ok(!/\.rgm-sel|\.rgm-tip|\.rgm-name/.test(css), '예전 선택 상자 CSS(.rgm-sel, .rgm-tip, .rgm-name)가 남았다');
    const ta = [...css.matchAll(/#rptGroupModal[^{}]*\{[^{}]*touch-action:none/g)].map(x => x[0]);
    assert.ok(ta.length === 1 && ta[0].includes('.rgm-hdl') && css.lastIndexOf('@media', css.indexOf(ta[0])) === css.lastIndexOf('@media (pointer:coarse)', css.indexOf(ta[0])), '터치 끌기 touch-action:none 이 ⠿ 에만(굵은 포인터에서만) 있지 않다: ' + JSON.stringify(ta));
    const on = src.slice(src.indexOf("$('#rgmRows').addEventListener('click'"), src.indexOf("window.addEventListener('blur', () => { if(_rgmDrag) _rgmEnd(false); });"));
    assert.ok(on.includes("addEventListener('pointerdown'") && on.includes("'pointercancel'") && !/draggable|dragstart|dataTransfer/.test(on), '끌기가 포인터 이벤트가 아니다(HTML5 끌어 놓기는 자동화와 터치에서 다르다)');
    assert.ok(on.includes("if(ev.pointerType === 'touch' && !t.closest('.rgm-hdl')) return;"), '터치는 ⠿ 에서만 끌기를 시작해야 한다(목록 스크롤)');
    //  좁은 폭(440px 이하) 규칙: 바로 앞의 @media 가 440px 이하 블록이어야 한다.
    for (const rule of ['#rptGroupModal .rgm-ib{width:32px;height:32px}', '#rptGroupModal .rgm-who{flex-wrap:wrap;row-gap:0}']) {
      const at = css.indexOf(rule), mm = css.lastIndexOf('@media', at);
      assert.ok(at > 0 && css.startsWith('@media (max-width:440px)', mm) && !css.slice(mm, at).includes('\n}'), '440px 이하에서 설정 창 버튼이 32px 가 아니거나 이름 줄이 접히지 않는다: ' + rule);
    }
  },
  //  끌어 놓기 판정(순수 함수 rptGroupDropTarget): 앱 소스에서 떼어 돌린다.
  dropRules(src) {
    const f = new Function('return (' + extractFunction(src, 'rptGroupDropTarget') + ')')();
    const L = (o) => new Map(Object.entries(o));
    const live = L({ b: 'a', c: 'a' });   // b, c 가 a 에 묶였다. d, e 는 머리 과제
    const cases = [
      ['d', 'a', 'a', '머리 과제를 다른 묶음 위에 놓으면 그 과제에 묶인다'],
      ['d', 'e', 'e', '빈 머리 과제 위에도 넣는다'],
      ['d', 'd', null, '자기 위에 놓으면 그대로'],
      ['d', null, null, '묶이지 않은 과제를 묶음 밖에 놓으면 그대로'],
      ['a', 'd', null, '다른 과제가 묶인 과제는 끌 수 없다(한 단계)'],
      ['a', null, null, '다른 과제가 묶인 과제는 끌 수 없다(밖)'],
      ['b', null, 'b', '묶인 과제를 묶음 밖에 놓으면 푼다'],
      ['b', '', 'b', '묶인 과제를 묶음 밖에 놓으면 푼다(빈 키)'],
      ['b', 'a', null, '묶인 과제를 지금 부모 위에 놓으면 그대로'],
      ['b', 'd', 'd', '묶인 과제를 다른 머리 과제로 옮긴다'],
      ['d', 'b', null, '묶인 과제 위(키)에는 넣지 않는다(두 단계)'],
    ];
    for (const [s0, over, want, why] of cases) assert.strictEqual(f(live, s0, over), want, why + ': ' + s0 + ' → ' + over);
    assert.strictEqual(f(new Map(), 'x', 'y'), 'y', '묶음이 없을 때 넣기');
    assert.strictEqual(f(new Map(), 'x', null), null, '묶음이 없을 때 밖');
  },
};

test('GS1 (§3, §6): 묶음이 없을 때의 예전 길이 남아 있다(머리 줄 시간, 주간 감싸기, 복사 갈래), 낡은 묶음 흔적을 거른다', () => S.fastPaths(app));
test('GS2 (§5): 묶음 문맥과 설정 링크는 PEER 를 저장소보다 먼저 본다', () => S.peerFirst(app));
test('GS3 (§4): 설정 창: 보고서 창 위, 제목, 모두 풀기와 닫기, X 와 ⋯ 이름, 머리 과제만 넣을 곳, 선택 상자 없음, 포인터 끌기, 좁은 폭 32px', () => S.dialogMarkup(app));
test('GS5 (§4): 끌어 놓기 판정 rptGroupDropTarget: 넣기, 옮기기, 밖에 놓아 풀기, 자기와 부모 위는 그대로, 묶음이 있는 과제는 못 끈다', () => S.dropRules(app));
test('GS4 (§6): 새 화면 문구에 엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점이 없다', () => {
  const phrases = ['보고서 묶음', '설정', '묶은 과제 없음', '묶음', '합계 ', ' 자체',
    '이 보고서에는 묶을 과제가 없습니다.',
    '과제를 끌어다 다른 과제 위에 놓으면, 이 보고서에서는 그 과제 안에 함께 씁니다. 시간도 더해지고, 다음 보고서에는 남지 않습니다.',
    '묶인 과제의 고친 글은 지워지지 않고, 꺼내면 다시 쓰입니다.', '모두 풀기', '넣을 곳', '꺼내기', '} 꺼내기"', '} 메뉴"',
    "'이번 주' : '오늘'} 내용 없는 과제 ${emp}개", '>보기</button>', '>접기</button>', '내용 없는 과제 접기', '업무 ${n}건', '${h}시간',
    '이 과제 시간과 묶인 과제 시간의 합', '이 보고서에서 위 과제의 머리 줄 아래로 묶었습니다', '에 묶은 과제', ', 묶은 과제 ',
    '이 날짜의 고친 내용과 뺀 과제, 묶음을 모두 버리고 초안으로 되돌릴까요?', '이 기간의 고친 내용과 뺀 과제, 묶음을 모두 버리고 초안으로 되돌릴까요?',
    '자체 시간(회사 일간보고용, 묶인 과제 시간은 따로)', '고친 글에 묶은 과제 줄이 없습니다. 글 편집에서 초안으로 되돌리면 들어갑니다.',
    'aria-label="보고서 묶음 설정"'];
  for (const p of phrases) {
    assert.ok(app.includes(p), '문구가 앱에 없다(시험 목록 갱신 필요): ' + p);
    assert.ok(!/—|–|「|」|(^|\s)·|·(\s|$)/.test(p), '금지 기호: ' + p);
  }
});
test('변이 GSM1: 낡은 대상 거르기나 한 단계 거르기를 빼면 GS1 이 잡는다', () => {
  assert.throws(() => S.fastPaths(mutate(app, ' && group[k] !== k && ks.has(group[k])) cand.set', ' && group[k] !== k) cand.set')), /거르지 않는다/);
  assert.throws(() => S.fastPaths(mutate(app, 'if(!cand.has(t)) live.set(s, t);', 'live.set(s, t);')), /거르지 않는다/);
});
test('변이 GSM2: rptGroupCtx 의 PEER 관문을 빼면 GS2 가 잡는다', () => {
  assert.throws(() => S.peerFirst(mutate(app, "function rptGroupCtx(){\n  if(PEER) return null;\n", 'function rptGroupCtx(){\n')), /PEER/);
});
test('변이 GSM3: X 이름을 빼거나, 묶인 과제를 넣을 곳에 넣거나, 터치 끌기를 줄 전체로 넓히면 GS3 이 잡는다', () => {
  assert.throws(() => S.dialogMarkup(mutate(app, 'title="꺼내기" aria-label="${esc(x.name)} 꺼내기"', 'title="꺼내기"')), /꺼내기/);
  assert.throws(() => S.dialogMarkup(mutate(app, 'tops.filter(y => y.k !== __rgm.menuFor)', 'g.rows.filter(y => y.k !== __rgm.menuFor)')), /한 단계/);
  assert.throws(() => S.dialogMarkup(mutate(app, "    if(ev.pointerType === 'touch' && !t.closest('.rgm-hdl')) return;", '')), /터치/);
  assert.throws(() => S.dialogMarkup(mutate(app, '#rptGroupModal .rgm-row[data-dr="1"]{cursor:grab}', '#rptGroupModal .rgm-row[data-dr="1"]{cursor:grab;touch-action:none}')), /touch-action/);
});
test('변이 GSM4: 끌어 놓기 판정의 규칙 하나를 빼면 GS5 가 잡는다', () => {
  for (const [find, repl, re] of [
    ['  if([...live.values()].includes(src)) return null;\n  const par', '  const par', /한 단계/],
    ["  if(over == null || over === '') return par ? src : null;", "  if(over == null || over === '') return null;", /푼다/],
    ['  if(over === src || over === par || live.has(over)) return null;', '  if(over === src || live.has(over)) return null;', /부모/],
    ['  if(over === src || over === par || live.has(over)) return null;', '  if(over === src || over === par) return null;', /두 단계/],
  ]) assert.throws(() => S.dropRules(mutate(app, find, repl)), re);
});

// ══════════════════════════════════════════════════════════════════════
// (B)(W)(P) jsdom 실행
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('report-group: jsdom 미설치: 보고서 묶음 실행 계약(바이트 같음, 묶음 적용, 설정 창, 임시 저장, 전송 회신, PEER)을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const quiet = () => (jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(pred, what, ms = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred()) return; await tick(); }
    assert.fail('시간 안에 일어나지 않았다: ' + what);
  }
  const shims = (win) => {
    if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
    win.scrollTo = () => {};
    win.HTMLElement.prototype.scrollIntoView = function () {};
    if (!win.CSS) win.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
  };
  function wrap(dom, posted) {
    const w = dom.window;
    return { w, posted, doc: w.document, ev: (code) => w.eval(code), evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      close: async () => { await tick(); try { w.close(); } catch (_) {} } };
  }
  const bootBrowser = (src) => wrap(new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quiet(), beforeParse: shims }), []);
  //  위젯 모드: 가짜 호스트는 메시지를 배열에 넣기만 한다(실제 netcus 제출 경로 없음).
  function bootWidget(src, url = 'https://tcapp.local/') {
    const posted = [];
    const dom = new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: quiet(),
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); }, addEventListener() {}, removeEventListener() {} } };
        shims(win);
      } });
    const M = wrap(dom, posted);
    const sess = posted.find((x) => x && x.cmd === 'userSessionGet');
    if (sess) M.ev('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'tester', name: '시험자' } }) + ')');
    return M;
  }
  const overlayOpen = (m, id) => { const o = m.doc.getElementById(id); return !!o && !o.classList.contains('hidden') && !o.classList.contains('closing'); };
  const overlayClosed = (m, id) => { const o = m.doc.getElementById(id); return !o || o.classList.contains('hidden'); };
  async function confirmOk(m, wantMsg) {
    await waitFor(() => overlayOpen(m, 'confirmModal'), '확인창이 뜬다');
    if (wantMsg) assert.ok(m.doc.getElementById('cfMsg').textContent.includes(wantMsg), '확인 문구에 "' + wantMsg + '" 가 없다: ' + m.doc.getElementById('cfMsg').textContent);
    m.doc.getElementById('cfOk').click();
    await waitFor(() => overlayClosed(m, 'confirmModal'), '확인창이 닫힌다');
    await tick(); await tick();
  }
  const allKeys = (m, pre) => m.evJSON(`(function(){ var a=[]; for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && k.indexOf(${JSON.stringify(pre)})===0) a.push(k); } return a.sort(); })()`);
  const clearDrafts = (m) => m.ev("(function(){ var a=[]; for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && k.indexOf('tc_rptDraft')===0) a.push(k); } a.forEach(function(k){ localStorage.removeItem(k); }); __rptDraftMem.clear(); __rptDraftDirty.clear(); __rptDraftFailed.clear(); clearTimeout(__rptDraftTimer); __rptDraftSending=''; })()");
  const getStored = (m, key) => m.evJSON('JSON.parse(localStorage.getItem(' + JSON.stringify(key) + ') || "null")');
  const setView = (m, v) => m.doc.querySelector(`#rptViewSeg [data-rview="${v}"]`).click();
  const copyText = async (m) => {
    m.ev("window.__clip = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function(t){ window.__clip = t; return Promise.resolve(); } } });");
    await m.ev('copyReport()');
    return m.ev('window.__clip');
  };
  //  설정 창을 사람처럼 연다(왼쪽 "설정" 링크).
  const openDlg = async (m) => { m.doc.getElementById('rptGroupOpen').click(); await waitFor(() => overlayOpen(m, 'rptGroupModal'), '설정 창이 열린다'); await tick(); };
  const closeDlg = async (m) => { m.doc.querySelector('#rptGroupModal [data-close]').click(); await waitFor(() => overlayClosed(m, 'rptGroupModal'), '설정 창이 닫힌다'); };
  //  설정 창 줄과 묶음(키는 이름일 수 있어 앱의 rgmFind 로 찾는다)
  const rowEl = (m, k) => m.ev(`rgmFind('gk', ${JSON.stringify(k)})`);
  const grpEl = (m, k) => m.ev(`rgmFind('grp', ${JSON.stringify(k)})`);
  const findIn = (m, attr, k) => m.ev(`rgmFind(${JSON.stringify(attr)}, ${JSON.stringify(k)})`);
  const groupsOf = (m) => m.evJSON("[].map.call(document.querySelectorAll('#rgmRows [data-grp]'), function(g){ return [g.getAttribute('data-grp')].concat([].map.call(g.querySelectorAll('.rgm-row.kid'), function(r){ return r.getAttribute('data-gk'); })); })");
  const showEmpty = (m) => { const b = m.doc.querySelector('#rgmRows [data-gmore]'); if (b && b.getAttribute('aria-expanded') === 'false') b.click(); };
  //  묶음 하나를 사람처럼 정한다(끌기 없이): 묶인 과제는 X(꺼내기), 머리 과제는 ⋯ 메뉴의 넣을 곳. tgt === src 는 꺼내기.
  function pick(m, src, tgt) {
    if (!rowEl(m, src)) showEmpty(m);
    assert.ok(rowEl(m, src), src + ' 줄이 설정 창에 없다');
    const x = findIn(m, 'gout', src);
    if (x && x.closest('[data-grp]').getAttribute('data-grp') === tgt) return;   // 이미 그 과제에 묶여 있다
    if (x) x.click();
    if (tgt === src) return;
    const b = findIn(m, 'gmenu', src);
    assert.ok(b, src + ' 에 ⋯ 메뉴가 없다(다른 과제가 묶여 있거나 머리 과제가 하나뿐이다)');
    b.click();
    const it = [...m.doc.querySelectorAll('#rgmMenu [data-ginto]')].find((e) => e.getAttribute('data-ginto') === tgt);
    assert.ok(it, src + ' 의 넣을 곳에 ' + tgt + ' 가 없다');
    it.click();
  }
  //  ⋯ 메뉴의 넣을 곳 목록(열었다가 다시 눌러 닫는다). ⋯ 가 없으면 null.
  const menuOf = (m, k) => { const b = findIn(m, 'gmenu', k); if (!b) return null; b.click(); const r = m.evJSON("[].map.call(document.querySelectorAll('#rgmMenu [data-ginto]'), function(e){ return e.getAttribute('data-ginto'); })"); findIn(m, 'gmenu', k).click(); return r; };
  //  끌기를 사람처럼: 누르고 움직이고 놓는다. jsdom 에는 PointerEvent 와 elementFromPoint 가 없어 MouseEvent 에 pointer 이름과 속성을 주고,
  //    포인터 아래 요소는 document.elementFromPoint 를 바꿔 끼워 정한다(실 위젯 루프는 진짜 PointerEvent 를 쓴다).
  function pev(m, type, x, y, extra) {
    const e = new m.w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    for (const [k, v] of Object.entries(Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, extra || {}))) Object.defineProperty(e, k, { value: v });
    return e;
  }
  const dragDown = (m, k, o = {}) => { const r = rowEl(m, k); assert.ok(r, k + ' 줄이 없다'); r.querySelector(o.from || '.rgm-t').dispatchEvent(pev(m, 'pointerdown', 10, 10, o.ev)); };
  const dragMove = (m, overEl, o = {}) => { m.doc.elementFromPoint = () => overEl; m.doc.dispatchEvent(pev(m, 'pointermove', 10, 40, o.ev)); };
  const dragUp = (m, overEl, o = {}) => { m.doc.elementFromPoint = () => overEl; m.doc.dispatchEvent(pev(m, 'pointerup', 10, 40, o.ev)); delete m.doc.elementFromPoint; };
  const dragTo = (m, k, overEl) => { dragDown(m, k); dragMove(m, overEl); dragUp(m, overEl); };
  const dlgHead = (m) => m.doc.querySelector('#rptGroupModal .modal-head h2');
  //  묶음을 사람처럼 정한다: 설정 창을 열고 고르고 닫는다.
  async function groupVia(m, pairs) { await openDlg(m); for (const [s, t] of pairs) pick(m, s, t); await closeDlg(m); }
  const heads = (txt) => String(txt).split('\n\n').map(b => b.split('\n')[0]);
  const headHours = (txt) => heads(txt).map(h => { const mm = /^\[(.+?)\](?: : (.+))?$/.exec(h); return mm ? (mm[2] != null ? { name: mm[1], hours: Number(mm[2]) } : null) : 'bad:' + h; }).filter(Boolean);

  const CA = '2026-07-01T00:00:00.000Z';
  const E = (o) => Object.assign({ allDay: true, startTime: '', endTime: '', location: '', memo: '', hours: null,
    endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }, o);

  // ───────────────────────── 일간 ─────────────────────────
  //  알파: 일정(메모 2줄) + 일정(메모, 들여쓴 메모 줄) + 기간 할 일(그날 메모), 베타: 일정, 감마: 시간만, 델타: 아무것도 없음, 기타: 기본 과제(빈 과제)
  const dayState = (T, Y, N) => ({
    categories: [
      { id: 'c-a', name: '알파', color: '#3e5be0', desc: '', createdAt: CA },
      { id: 'c-b', name: '베타', color: '#2e9e6b', desc: '', createdAt: CA },
      { id: 'c-c', name: '감마', color: '#d97706', desc: '', createdAt: CA },
      { id: 'c-d', name: '델타', color: '#5b6b7d', desc: '', createdAt: CA },
      { id: 'c-etc', name: '기타', color: '#5b6b7d', desc: '', createdAt: CA },
    ],
    entries: [
      E({ id: 'e-a1', date: T, title: '로그인 화면 리뷰', categoryId: 'c-a', memo: 'UI 확인\n• 암호화 모듈 확인' }),
      E({ id: 'g-a', date: T, title: '기능 추가', categoryId: 'c-a', memo: '본문 첫 줄\n  - 들여쓴 본문' }),
      E({ id: 'e-b1', date: T, title: '고객 회신', categoryId: 'c-b' }),
      E({ id: 'e-y1', date: Y, title: '어제 업무', categoryId: 'c-b' }),
    ],
    todos: [{ id: 't-p', text: '기간 할 일', done: false, categoryId: 'c-a', due: Y, endDate: N, prio: 'normal', completedAt: '', note: '',
              dayNotes: { [T]: '오늘 메모' }, createdAt: CA, updatedAt: CA }],
    rooms: [], attendance: {},
    taskHours: { [T]: { 'c-a': 2, 'c-b': 1.5, 'c-c': 1 } },
    reportMarker: '-', reportMarkerCustom: '', reportIndent: 2,
    reportFormatPrefs: { daily: { marker: '-', markerCustom: '', indent: 2 }, weekly: { marker: '-', markerCustom: '', indent: 2 } },
  });
  //  예전 buildReportText(4b4a018) 의 캘린더 경로 그대로: "묶음이 없으면 바이트까지 같다"(§3)의 기준. 앱 전역을 쓴다.
  function REF(indentUnit) {
    indentUnit = indentUnit || ' ';
    const from = $('#rptFrom').value, to = $('#rptTo').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return '';
    const { rows } = collectReportData(from, to, rptSources());
    if (!rows.length) return '';
    const _mkSpec = reportMarkerSpec();
    const _fmt = currentReportFormatPref();
    const _indent = Math.max(0, Math.min(6, _fmt.indent != null ? _fmt.indent : 2));
    const _pad = indentUnit.repeat(_indent * 2);
    const _daily = (reportMode === 'daily');
    const _hmap = _daily ? new Map(rows.map(r => [r.key, getTaskHours(from, r.key)]).filter(x => x[1] != null)) : null;
    const blocks = rows.map(r => {
      let _head = `[${r.name}]`;
      if (_hmap) { const _h = _hmap.get(r.key); if (_h != null) _head += ` : ${_h}`; }
      return _head + r.titles.map((t, i) => {
        const _mk = reportMarkerAt(_mkSpec, i); const _prefix = _mk ? (_mk + ' ') : '';
        const m = (r.titleMeta && r.titleMeta[i]) || null;
        const _sub = _pad + reportSubIndent(_prefix, indentUnit);
        return '\n' + _pad + _prefix + t + reportTextDetails(m, _sub);
      }).join('');
    });
    return blocks.join('\n\n') + '\n';
  }
  //  예전 payload.hours(묶음 없음): 과제 순서대로 시간이 있는 것만.
  const REF_HOURS = "collectReportData($('#rptFrom').value, $('#rptFrom').value, rptSources()).rows.map(function(r){ return { name: r.name, hours: getTaskHours($('#rptFrom').value, r.key) }; }).filter(function(x){ return x.hours != null; })";
  const openDaily = (m, date) => m.ev(`openReport(); ['#rptSrcEvent','#rptSrcTodo','#rptWithDesc'].forEach(function(s){ $(s).checked = true; }); $('#rptSkipEmpty').checked = false;`
    + ` $('#rptFrom').value = ${JSON.stringify(date)}; $('#rptFrom').dispatchEvent(new Event('change'));`);
  const setDate = (m, date) => m.ev(`$('#rptFrom').value = ${JSON.stringify(date)}; $('#rptFrom').dispatchEvent(new Event('change'));`);
  const dcard = (m, cat) => m.ev(`[].find.call(document.querySelectorAll('#rptOut .rcard'), function(c){ return c.dataset.rcat === ${JSON.stringify(cat)}; })`);
  const topCats = (m) => m.evJSON("[].map.call(document.querySelectorAll('#rptOut > .rcard'), function(c){ return c.dataset.rcat; })");
  const subCats = (m, cat) => m.evJSON(`(function(){ var c = [].find.call(document.querySelectorAll('#rptOut > .rcard'), function(c){ return c.dataset.rcat === ${JSON.stringify(cat)}; }); return c ? [].map.call(c.querySelectorAll('.rcard-subs > .rcard'), function(x){ return x.dataset.rcat; }) : null; })()`);
  const capSend = (m) => m.ev('window.__cap = null; Platform.report.submitDaily = function(p){ window.__cap = JSON.parse(JSON.stringify(p)); };');
  const sendDailyBrowser = (m) => { capSend(m); m.doc.getElementById('btnRptSend').click(); return m.evJSON('window.__cap'); };
  const NB = ' ', NBS = '&nbsp;';

  //  ── 바이트 같음 검사기(일간): 변이 시험이 재사용. 묶음 없음 + 낡은 묶음 흔적(지금 행에 없는 과제, 두 단계, 자기 자신) 둘 다 ──
  const FORMATS = [['-', '', 2], ['1.', '', 3], ['none', '', 0], ['가.', '', 1], ['1.', '▶', 2]];
  async function assertDailySame(m, T, KEY) {
    m.ev('window.__REF = ' + REF.toString());
    //  낡은 흔적: 없는 과제에서 / 없는 과제로 / 자기 자신. 지금 행에 닿는 묶음이 아니라 무시돼야 한다.
    const stale = { v: 1, date: T, body: {}, base: {}, out: [], group: { 'c-gone': 'c-a', 'c-a': 'c-gone2', 'c-b': 'c-b' }, savedAt: '' };
    let n = 0;
    for (const variant of ['none', 'stale']) {
      if (variant === 'stale') m.ev(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(stale))}); __rptDraftMem.clear(); __rptDraftDirty.clear();`);
      for (const [mk, cu, ind] of FORMATS) for (const desc of [true, false]) {
        m.ev(`state.reportFormatPrefs = { daily: { marker: ${JSON.stringify(mk)}, markerCustom: ${JSON.stringify(cu)}, indent: ${ind} }, weekly: { marker: '-', markerCustom: '', indent: 2 } };`
          + ` $('#rptWithDesc').checked = ${desc}; reportMode = 'daily'; $('#rptFrom').value = ${JSON.stringify(T)}; $('#rptTo').value = ${JSON.stringify(T)}; buildReport();`);
        const tag = `${variant} ${mk}/${cu}/${ind} desc=${desc}`;
        assert.ok(m.ev('__REF()').includes('[알파] : 2'), '기준 글이 비었다: ' + tag);
        assert.strictEqual(m.ev('buildReportText()'), m.ev('__REF()'), '복사 글(U+00A0)이 예전과 다르다: ' + tag);
        assert.strictEqual(m.ev("buildReportText('&nbsp;')"), m.ev("__REF('&nbsp;')"), '전송 글(&nbsp;)이 예전과 다르다: ' + tag);
        assert.deepStrictEqual(m.evJSON("reportDailyHours(collectReportData($('#rptFrom').value, $('#rptFrom').value, rptSources()).rows, $('#rptFrom').value).map(function(x){ return { name: x.name, hours: x.hours }; })"), m.evJSON(REF_HOURS), '머리 줄 시간이 예전과 다르다: ' + tag);
        assert.ok(!m.ev("document.querySelector('#rptOut .rcard-subs, #rptOut .rcard-gsum, #rptOut .rcard-own')"), '묶음이 없는데 묶음 카드가 보인다: ' + tag);
        n++;
      }
      m.ev(`state.reportFormatPrefs = { daily: { marker: '-', markerCustom: '', indent: 2 }, weekly: { marker: '-', markerCustom: '', indent: 2 } }; $('#rptWithDesc').checked = true; buildReport();`);
      assert.strictEqual(await copyText(m), m.ev('__REF()'), '복사 버튼이 싣는 글이 예전과 다르다: ' + variant);
      const cap = sendDailyBrowser(m);
      assert.ok(cap, '전송 payload 를 붙잡지 못했다');
      assert.strictEqual(cap.fields.content, m.ev("__REF('&nbsp;')"), '전송 content 가 예전과 다르다: ' + variant);
      assert.deepStrictEqual(cap.hours, m.evJSON(REF_HOURS), 'payload.hours 가 예전과 다르다: ' + variant);
      assert.ok(!m.ev("$('#rptSummary').textContent").includes('묶은 과제'), '묶음이 없는데 요약줄에 묶은 과제가 있다: ' + variant);
      assert.strictEqual(m.ev("$('#rptGroupSum').textContent"), '묶은 과제 없음', '왼쪽 요약이 "묶은 과제 없음" 이 아니다: ' + variant);
    }
    return n;
  }

  //  ── 묶음 적용 검사기(일간): 변이 시험이 재사용 ──
  //  ① '-' 2단: 베타 → 델타(빈 대상). 델타 머리 줄 = 베타 시간, 본문 = 이름 줄 + 한 단계 더(머리기호 '- ' 폭 2) 들여 쓴 베타 본문.
  //  ② '1.' 1단: 베타, 감마 → 알파. 번호는 알파 업무 셋 다음 4, 5 로 이어지고, 베타 본문은 자기 번호(1.)로 '4. ' 폭(3)만큼 더 들여 쓴다. 감마는 빈 과제라 이름 줄만.
  async function assertDailyGrouped(m, T) {
    m.ev('window.__REF = ' + REF.toString());
    const refBlocks = (unit) => m.ev(`__REF(${JSON.stringify(unit)})`).replace(/\n$/, '').split('\n\n');
    //  ①
    await groupVia(m, [['c-b', 'c-d']]);
    for (const unit of [NB, NBS]) {
      const rb = refBlocks(unit);
      const want = [rb[0], rb[2], `[델타] : 1.5\n${unit.repeat(4)}- 베타\n${unit.repeat(6)}- 고객 회신`, rb[4]].join('\n\n') + '\n';
      assert.strictEqual(m.ev(`buildReportText(${unit === NB ? '' : "'&nbsp;'"})`), want, '묶음 ① 글이 다르다(' + (unit === NB ? '복사' : '전송') + ')');
    }
    assert.deepStrictEqual(topCats(m), ['c-a', 'c-c', 'c-d', 'c-etc'], '묶인 베타가 머리 카드로 남았다');
    assert.deepStrictEqual(subCats(m, 'c-d'), ['c-b'], '베타가 델타 카드 안의 작은 카드가 아니다');
    assert.ok(dcard(m, 'c-b').querySelector('.rcard-grp') && dcard(m, 'c-b').querySelector('.rcard-grp').textContent === '묶음', '작은 카드에 "묶음" 표시가 없다');
    assert.strictEqual(dcard(m, 'c-d').querySelector('.rcard-gsum').textContent, '합계 1.5 h', '대상 머리에 합계가 없다');
    assert.ok(dcard(m, 'c-d').querySelector('.rcard-own .rcard-h-in[data-hcat="c-d"]') && dcard(m, 'c-d').querySelector('.rcard-own').textContent.startsWith('델타 자체'), '대상 자체 시간 칸 "델타 자체 [ ] h" 가 없다');
    assert.ok(dcard(m, 'c-b').querySelector('.rcard-h-in[data-hcat="c-b"]'), '묶인 과제의 시간 칸이 작은 카드에 없다');
    assert.ok(m.ev("$('#rptSummary').textContent").includes(', 묶은 과제 1개'), '요약줄에 "묶은 과제 1개" 가 없다');
    assert.strictEqual(m.ev("$('#rptGroupSum').textContent"), '베타 → 델타', '왼쪽 요약이 다르다');
    let cap = sendDailyBrowser(m);
    assert.deepStrictEqual(cap.hours, headHours(cap.fields.content), 'payload.hours 가 머리 줄(이름, 값, 순서)과 다르다 ①');
    assert.deepStrictEqual(cap.hours, [{ name: '알파', hours: 2 }, { name: '감마', hours: 1 }, { name: '델타', hours: 1.5 }], 'payload.hours ①');
    //  시간 칸을 바꾸면 다시 그리지 않고 합계만 맞춘다(포커스 유지). 머리 줄도 따라온다.
    const inp = dcard(m, 'c-b').querySelector('.rcard-h-in'); inp.focus(); inp.value = '2.25'; inp.dispatchEvent(new m.w.Event('change', { bubbles: true }));
    assert.strictEqual(dcard(m, 'c-d').querySelector('.rcard-gsum').textContent, '합계 2.25 h', '시간 칸을 바꿨는데 합계가 따라오지 않는다');
    assert.strictEqual(m.doc.activeElement, inp, '시간 칸 입력 뒤 포커스를 잃었다(다시 그렸다)');
    assert.ok(m.ev('buildReportText()').includes('[델타] : 2.25\n'), '머리 줄 시간이 바뀐 시간 칸을 따르지 않는다');
    inp.value = '1.5'; inp.dispatchEvent(new m.w.Event('change', { bubbles: true }));
    //  ②
    await openDlg(m); pick(m, 'c-b', 'c-b'); pick(m, 'c-b', 'c-a'); pick(m, 'c-c', 'c-a'); await closeDlg(m);
    m.ev(`state.reportFormatPrefs = { daily: { marker: '1.', markerCustom: '', indent: 1 }, weekly: { marker: '-', markerCustom: '', indent: 2 } }; buildReport();`);
    for (const unit of [NB, NBS]) {
      const rb = refBlocks(unit);
      const alpha = rb[0].replace('[알파] : 2\n', '[알파] : 4.5\n') + `\n${unit.repeat(2)}4. 베타\n${unit.repeat(5)}1. 고객 회신\n${unit.repeat(2)}5. 감마`;
      assert.strictEqual(m.ev(`buildReportText(${unit === NB ? '' : "'&nbsp;'"})`), [alpha, rb[3], rb[4]].join('\n\n') + '\n', '묶음 ② 글이 다르다(' + (unit === NB ? '복사' : '전송') + ')');
    }
    cap = sendDailyBrowser(m);
    assert.deepStrictEqual(cap.hours, headHours(cap.fields.content), 'payload.hours 가 머리 줄과 다르다 ②');
    assert.deepStrictEqual(cap.hours, [{ name: '알파', hours: 4.5 }], 'payload.hours ②');
    //  글 편집: 대상 머리 줄은 합친 시간, 옆에 "베타, 감마 묶음", 묶인 과제는 칸이 없고 대상 칸 초안에 들어 있다(공백 단위)
    setView(m, 'doc');
    const sec = m.ev("[].find.call(document.querySelectorAll('#rptOut .rdoc-sec'), function(s){ return s.dataset.rcat === 'c-a'; })");
    assert.strictEqual(sec.querySelector('.rdoc-head').textContent, '[알파] : 4.5', '글 편집 머리 줄이 합친 시간이 아니다');
    assert.strictEqual(sec.querySelector('.rdoc-grp').textContent, '베타, 감마 묶음', '머리 줄 옆 묶음 표시가 없다');
    assert.ok(sec.querySelector('.rdoc-ta').value.endsWith('\n  4. 베타\n     1. 고객 회신\n  5. 감마'), '글 편집 초안에 묶인 과제 줄이 없다: ' + JSON.stringify(sec.querySelector('.rdoc-ta').value.slice(-60)));
    assert.deepStrictEqual(m.evJSON("[].map.call(document.querySelectorAll('#rptOut .rdoc-sec'), function(s){ return s.dataset.rcat; })"), ['c-a', 'c-d', 'c-etc'], '묶인 과제에 글 편집 칸이 있다');
    setView(m, 'card');
  }
  //  소수 합계(0.1 + 0.2 → 0.3): 머리 줄, payload.hours, 카드 합계가 같은 반올림: 변이 시험이 재사용
  async function assertDailyFrac(m, T) {
    m.ev(`state.taskHours = { ${JSON.stringify(T)}: { 'c-a': 0.1, 'c-b': 0.2 } }; buildReport();`);
    await groupVia(m, [['c-b', 'c-a']]);
    assert.ok(m.ev('buildReportText()').startsWith('[알파] : 0.3\n'), '소수 합계가 0.3 이 아니다: ' + JSON.stringify(m.ev('buildReportText()').slice(0, 20)));
    assert.strictEqual(dcard(m, 'c-a').querySelector('.rcard-gsum').textContent, '합계 0.3 h', '카드 합계가 0.3 이 아니다');
    const cap = sendDailyBrowser(m);
    assert.deepStrictEqual(cap.hours, [{ name: '알파', hours: 0.3 }], 'payload.hours 소수 합계');
  }

  let B = null, bootErr = null;
  try { B = bootBrowser(app); } catch (e) { bootErr = e; }
  if (bootErr) {
    test('GB0: 브라우저 모드 부팅', () => { throw bootErr; });
  } else {
    const T = B.ev('todayYmd()'), Y = B.ev('addDays(todayYmd(), -1)'), N = B.ev('addDays(todayYmd(), 1)');
    const KEY = B.ev('rptDraftKey(todayYmd())'), KEY_Y = B.ev('rptDraftKey(addDays(todayYmd(), -1))');
    const fresh = () => { clearDrafts(B); B.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(B, T); };
    const done = () => { clearDrafts(B); B.ev("rptView = 'card'; rptViewW = 'card'; reportMode = 'daily'; state.reportSource = 'cal';"); if (overlayOpen(B, 'rptGroupModal')) B.ev("closeModal('#rptGroupModal')"); };

    test('GB1 (§3, §6): 일간: 묶음이 없으면(낡은 묶음 흔적만 있어도) 복사, 전송 글과 payload.hours 가 예전과 바이트 같다', async () => {
      fresh();
      try { assert.ok((await assertDailySame(B, T, KEY)) >= 20); } finally { done(); }
    });
    test('GB2 (§3): 일간 묶음: 머리 줄 목록, 합친 시간, 본문 초안 꼴(이름 줄 + 한 단계 더, 머리기호 번호 이어짐), payload.hours = 머리 줄, 카드', async () => {
      fresh();
      try { await assertDailyGrouped(B, T); } finally { done(); }
    });
    test('GB3 (§3): 일간 묶음 소수 합계(0.1 + 0.2)는 0.3 으로 머리 줄, 카드, payload.hours 가 같다', async () => {
      fresh();
      try { await assertDailyFrac(B, T); } finally { done(); }
    });

    //  한 단계 규칙(§3, §4): 설정 창 선택지: 변이 시험이 재사용
    async function assertOneLevel(m) {
      await groupVia(m, [['c-b', 'c-d']]);
      await openDlg(m);
      //  보고서 순서 그대로: 알파, 감마, 델타(안에 베타). 빈 기타는 접혀 있다
      assert.deepStrictEqual(groupsOf(m), [['c-a'], ['c-c'], ['c-d', 'c-b']], '설정 창 묶음 구조(보고서 순서, 델타 안에 베타)가 다르다');
      const gd = grpEl(m, 'c-d'), rd = rowEl(m, 'c-d'), rb = rowEl(m, 'c-b');
      assert.ok(gd.classList.contains('has') && rb.classList.contains('kid') && rb.parentElement === gd, '베타가 델타 묶음 안의 들여 쓴 줄이 아니다');
      assert.ok(rd.getAttribute('data-dr') === '0' && rd.querySelector('.rgm-hdl').textContent === '' && !rd.querySelector('button'), '다른 과제가 묶인 델타에 ⠿ 나 ⋯ 가 있다(한 단계)');
      assert.strictEqual(rd.querySelector('.rgm-meta').textContent, '업무 1건, 1.5시간', '델타 줄이 묶인 과제까지 더한 업무와 시간이 아니다');
      assert.strictEqual(rb.querySelector('.rgm-meta').textContent, '업무 1건, 1.5시간', '묶인 베타 줄의 자기 업무와 시간이 다르다');
      assert.strictEqual(rowEl(m, 'c-a').querySelector('.rgm-meta').textContent, '업무 3건, 2시간', '알파 줄의 업무와 시간이 다르다');
      assert.strictEqual(rowEl(m, 'c-c').querySelector('.rgm-meta').textContent, '1시간', '시간만 있는 감마 줄은 시간만 보여야 한다');
      const bx = findIn(m, 'gout', 'c-b');
      assert.ok(bx && bx.getAttribute('aria-label') === '베타 꺼내기' && bx.getAttribute('title') === '꺼내기', '묶인 베타에 X(베타 꺼내기)가 없다');
      //  넣을 곳: 머리 과제만(자기 자신과 묶인 베타는 없다). 접힌 빈 기타도 넣을 곳이다
      assert.deepStrictEqual(menuOf(m, 'c-a'), ['c-c', 'c-d', 'c-etc'], '알파의 넣을 곳이 다르다(자기 자신이나 묶인 과제가 들어 있다)');
      assert.deepStrictEqual(menuOf(m, 'c-c'), ['c-a', 'c-d', 'c-etc'], '감마의 넣을 곳이 다르다');
      //  끌어 놓기: 다른 과제가 묶인 델타는 끌리지 않는다. 베타를 지금 부모(델타) 위, 알파를 자기 위에 놓으면 그대로
      dragDown(m, 'c-d'); dragMove(m, grpEl(m, 'c-a'));
      assert.ok(!m.doc.querySelector('#rptGroupModal .rgm-ghost') && !grpEl(m, 'c-a').classList.contains('drop'), '다른 과제가 묶인 델타를 끌 수 있다');
      dragUp(m, grpEl(m, 'c-a'));
      dragTo(m, 'c-b', rowEl(m, 'c-d'));
      dragTo(m, 'c-a', rowEl(m, 'c-a'));
      assert.deepStrictEqual(m.evJSON(`rptDraftGet(${JSON.stringify(T)}).group`), { 'c-b': 'c-d' }, '규칙에 어긋난 끌어 놓기(묶음 있는 과제, 부모 위, 자기 위)가 묶음을 바꿨다');
      assert.strictEqual(m.ev("rptGroupSet('c-d', 'c-a')"), false, '다른 과제가 묶인 델타를 다른 곳에 묶을 수 있다');
      assert.strictEqual(m.ev("rptGroupSet('c-a', 'c-b')"), false, '묶인 베타를 대상으로 고를 수 있다');
      assert.strictEqual(m.ev("rptGroupSet('c-a', 'c-a')"), true, '대조군: 그대로는 늘 된다');
      assert.deepStrictEqual(m.evJSON(`rptDraftGet(${JSON.stringify(T)}).group`), { 'c-b': 'c-d' }, '규칙에 어긋난 선택이 저장됐다');
      await closeDlg(m);
    }
    test('GB4 (§3, §4): 한 단계 규칙: 대상 후보에 자기 자신과 묶인 과제가 없고, 다른 과제가 묶인 과제는 묶일 수 없다', async () => {
      fresh();
      try { await assertOneLevel(B); } finally { done(); }
    });

    test('GB5 (§1, §4): 공식 과제도 묶을 수 있다(기타로), 설정 창에 "공식" 표시', async () => {
      clearDrafts(B);
      const st = dayState(T, Y, N); st.categories[0].source = 'db';
      B.ev('state = ' + JSON.stringify(st) + ';'); openDaily(B, T);
      try {
        await openDlg(B);
        const row = rowEl(B, 'c-a');
        assert.ok(row.querySelector('.cat-badge') && row.querySelector('.cat-badge').textContent === '공식', '공식 과제에 "공식" 표시가 없다');
        assert.ok(!rowEl(B, 'c-b').querySelector('.cat-badge'), '개인 과제에 "공식" 표시가 있다');
        pick(B, 'c-a', 'c-etc'); await closeDlg(B);
        const txt = B.ev('buildReportText()');
        assert.ok(!txt.includes('[알파]') && txt.includes('[기타] : 2\n' + NB.repeat(4) + '- 알파\n' + NB.repeat(6) + '- 로그인 화면 리뷰'), '공식 과제가 기타 아래로 묶이지 않았다: ' + JSON.stringify(txt.slice(-300)));
        assert.deepStrictEqual(topCats(B), ['c-b', 'c-c', 'c-d', 'c-etc']);
      } finally { done(); }
    });

    //  X 와 묶음(§3): 대상 X 는 묶음 전체, 작은 카드 X 는 그 과제만: 변이 시험이 재사용
    async function assertXGroup(m) {
      await groupVia(m, [['c-b', 'c-a'], ['c-c', 'c-a']]);
      const n0 = m.ev("document.querySelectorAll('#rptOut .rcard').length");
      //  작은 카드(베타) X: 그 과제만 빠진다(줄과 시간)
      dcard(m, 'c-b').querySelector('.rcard-x').click();
      assert.strictEqual(m.ev("document.querySelectorAll('#rptOut .rcard').length"), n0, '작은 카드 X 가 카드를 지웠다(제자리에 남아야 한다)');
      assert.ok(dcard(m, 'c-b').classList.contains('rcard-out') && dcard(m, 'c-b').querySelector('.rcard-back'), '작은 카드가 흐려지지 않았거나 되돌리기가 없다');
      let txt = m.ev('buildReportText()');
      assert.ok(txt.startsWith('[알파] : 3\n') && !txt.includes('베타') && txt.includes('- 감마'), '작은 카드 X 뒤 대상에서 그 과제 줄과 시간만 빠지지 않았다: ' + JSON.stringify(txt.slice(0, 30)));
      let cap = sendDailyBrowser(m);
      assert.deepStrictEqual(cap.hours, [{ name: '알파', hours: 3 }], '작은 카드 X 뒤 payload.hours');
      dcard(m, 'c-b').querySelector('.rcard-back').click();
      assert.ok(m.ev('buildReportText()').startsWith('[알파] : 4.5\n'), '작은 카드 되돌리기 뒤 시간이 돌아오지 않았다');
      //  대상(알파) X: 대상과 묶음 전체가 빠진다
      dcard(m, 'c-a').querySelector('.rcard-x').click();
      txt = m.ev('buildReportText()');
      assert.ok(!/\[알파\]|베타|감마/.test(txt), '대상 X 뒤에도 묶음이 남았다: ' + JSON.stringify(txt));
      cap = sendDailyBrowser(m);
      assert.deepStrictEqual(cap.hours, [], '대상 X 뒤 payload.hours 에 묶음이 남았다');
      assert.ok(dcard(m, 'c-a').classList.contains('rcard-out') && dcard(m, 'c-b').closest('.rcard-out'), '대상 카드와 작은 카드가 함께 흐려지지 않았다');
      dcard(m, 'c-a').querySelector('.rcard-back').click();
      assert.ok(m.ev('buildReportText()').startsWith('[알파] : 4.5\n'), '대상 되돌리기 뒤 묶음이 돌아오지 않았다');
    }
    test('GB6 (§3): X: 대상 X 는 대상과 묶음 전체를, 작은 카드 X 는 그 과제만(줄과 시간) 이 보고서에서 뺀다', async () => {
      fresh();
      try { await assertXGroup(B); } finally { done(); }
    });

    //  임시 저장 수명(§5): 변이 시험이 재사용
    async function assertStorage(m) {
      assert.deepStrictEqual(allKeys(m, 'tc_rptDraft'), [], '전제: 키 없음');
      await groupVia(m, [['c-b', 'c-a']]);
      assert.deepStrictEqual(allKeys(m, 'tc_rptDraft'), [KEY], '묶음만으로 그 날짜 키가 생기지 않았다');
      const d = getStored(m, KEY);
      assert.deepStrictEqual([d.v, d.date, d.group, d.body, d.out], [1, T, { 'c-b': 'c-a' }, {}, []], '저장본 꼴이 다르다: ' + JSON.stringify(d));
      assert.ok(m.ev("$('#rptEditInfo').textContent").includes('이 PC에 임시 저장됨'), '묶음만 있을 때 "임시 저장됨" 이 없다');
      m.ev("closeModal('#reportModal')");
      await waitFor(() => overlayClosed(m, 'reportModal'), '보고서가 닫힌다');
      openDaily(m, T);
      assert.deepStrictEqual(subCats(m, 'c-a'), ['c-b'], '닫고 열자 묶음이 사라졌다');
      m.ev('__rptDraftMem.clear(); __rptDraftDirty.clear(); __rptDraftFailed.clear(); buildReport();');
      assert.deepStrictEqual(subCats(m, 'c-a'), ['c-b'], '재시작(메모리 비움) 뒤 저장소에서 묶음을 읽지 못했다');
      setDate(m, Y);
      assert.ok(!m.ev("document.querySelector('#rptOut .rcard-subs')") && m.ev("$('#rptGroupSum').textContent") === '묶은 과제 없음', '다른 날짜(새 날짜)가 묶음 없이 시작하지 않는다');
      assert.ok(!allKeys(m, 'tc_rptDraft').includes(KEY_Y), '다른 날짜 키가 렌더만으로 생겼다');
      setDate(m, T);
      assert.deepStrictEqual(subCats(m, 'c-a'), ['c-b'], '날짜를 오가자 묶음이 섞이거나 사라졌다');
      //  모두 초안으로: 확인 문구에 "묶음", 키와 묶음이 모두 지워진다
      setView(m, 'doc');
      assert.strictEqual(m.ev("$('#rptOut .rdoc-resetall').disabled"), false, '묶음만 있을 때 "모두 초안으로" 가 꺼져 있다');
      m.doc.querySelector('#rptOut .rdoc-resetall').click();
      await confirmOk(m, '묶음');
      assert.ok(!allKeys(m, 'tc_rptDraft').includes(KEY), '"모두 초안으로" 뒤에도 키가 남았다');
      setView(m, 'card');
      assert.ok(!m.ev("document.querySelector('#rptOut .rcard-subs')"), '"모두 초안으로" 뒤에도 묶음이 남았다');
      //  묶음을 다 풀고 다른 것도 없으면 키를 지운다
      await groupVia(m, [['c-c', 'c-a']]);
      assert.ok(allKeys(m, 'tc_rptDraft').includes(KEY));
      await groupVia(m, [['c-c', 'c-c']]);
      assert.ok(!allKeys(m, 'tc_rptDraft').includes(KEY), '묶음을 다 풀었는데 키가 남았다');
    }
    test('GB7 (§5): 임시 저장: 묶음만으로 키, 닫고 열기와 재시작 뒤 유지, 날짜별(새 날짜는 묶음 없음), 모두 초안으로가 묶음까지 지움, 다 풀면 키 삭제', async () => {
      fresh();
      try { await assertStorage(B); } finally { done(); }
    });

    test('GB8 (§5): 렌더와 글 만들기, 설정 창 열고 닫기만으로는 저장소에 쓰지 않는다', async () => {
      fresh();
      try {
        B.ev(`localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ v:1, date:${JSON.stringify(T)}, body:{}, base:{}, out:[], group:{ 'c-b':'c-a', 'c-gone':'c-a' }, savedAt:'2026-01-01T00:00:00.000Z' }));`);
        B.ev("window.__w = []; (function(){ var P = Storage.prototype, s = P.setItem, r = P.removeItem; P.setItem = function(k){ if(String(k).indexOf('tc_rptDraft')===0) window.__w.push('set '+k); return s.apply(this, arguments); }; P.removeItem = function(k){ if(String(k).indexOf('tc_rptDraft')===0) window.__w.push('rm '+k); return r.apply(this, arguments); }; window.__unspy = function(){ P.setItem = s; P.removeItem = r; }; })();");
        try {
          B.ev('buildReport();'); setView(B, 'doc'); setView(B, 'card'); setDate(B, Y); setDate(B, T);
          await openDlg(B); await closeDlg(B);
          B.ev("buildReportText(); buildReportText('&nbsp;'); reportDailyHours(collectReportData($('#rptFrom').value, $('#rptFrom').value, rptSources()).rows, $('#rptFrom').value); setReportMode('weekly'); setReportMode('daily');");
          setDate(B, T);
          assert.deepStrictEqual(B.evJSON('window.__w'), [], '렌더나 글 만들기, 설정 창 열고 닫기가 저장소에 썼다');
        } finally { B.ev('window.__unspy()'); }
        assert.deepStrictEqual(subCats(B, 'c-a'), ['c-b'], '전제: 저장본의 묶음을 읽어 그렸다(없는 과제 흔적은 무시)');
      } finally { done(); }
    });

    //  낡은 초안 안내(§3): 대상 본문을 고친 뒤 묶음을 바꾸면 고친 글은 그대로, "캘린더 기록이 바뀌었습니다" 가 뜬다: 변이 시험이 재사용
    async function assertStale(m) {
      setView(m, 'doc');
      const taA = () => m.ev("[].find.call(document.querySelectorAll('#rptOut .rdoc-ta'), function(t){ return t.dataset.rcat === 'c-a'; })");
      const staleA = () => m.ev("[].find.call(document.querySelectorAll('#rptOut .rdoc-sec'), function(s){ return s.dataset.rcat === 'c-a'; }).querySelector('.rdoc-stale').hidden");
      const t = taA(); t.value = '• 알파 고친 글'; t.dispatchEvent(new m.w.Event('input', { bubbles: true }));
      assert.strictEqual(staleA(), true, '막 고쳤는데 낡았다고 한다');
      await groupVia(m, [['c-b', 'c-a']]);
      assert.strictEqual(staleA(), false, '대상 본문을 고친 뒤 묶음을 바꿨는데 낡은 초안 안내가 없다');
      assert.strictEqual(taA().value, '• 알파 고친 글', '묶음이 고친 글을 덮었다');
      assert.ok(m.ev('buildReportText()').startsWith('[알파] : 3.5\n• 알파 고친 글\n\n[감마]'), '나가는 글이 고친 글 그대로가 아니다(머리 줄은 합친 시간)');
      await groupVia(m, [['c-b', 'c-b']]);
      assert.strictEqual(staleA(), true, '묶음을 풀어 초안이 기준본과 같아졌는데 안내가 남았다');
      setView(m, 'card');
    }
    test('GB9 (§3): 낡은 초안 안내: 대상 본문을 고친 뒤 묶음을 바꾸면 고친 글은 그대로 두고 안내가 뜬다', async () => {
      fresh();
      try { await assertStale(B); } finally { done(); }
    });

    test('GB10 (§3): 묶인 과제의 고친 글은 묶음 동안 쓰이지 않고 남았다가 묶음을 풀면 다시 쓰인다', async () => {
      fresh();
      try {
        setView(B, 'doc');
        const t = B.ev("[].find.call(document.querySelectorAll('#rptOut .rdoc-ta'), function(t){ return t.dataset.rcat === 'c-b'; })");
        t.value = '• 베타 고친 글'; t.dispatchEvent(new B.w.Event('input', { bubbles: true }));
        B.ev('rptDraftFlush()');
        await groupVia(B, [['c-b', 'c-a']]);
        let txt = B.ev('buildReportText()');
        assert.ok(!txt.includes('베타 고친 글') && txt.includes(NB.repeat(4) + '- 베타\n' + NB.repeat(6) + '- 고객 회신'), '묶음 동안 묶인 과제의 고친 글이 쓰였다(자동 초안이어야 한다)');
        assert.strictEqual(getStored(B, KEY).body['c-b'], '• 베타 고친 글', '묶을 때 묶인 과제의 고친 글이 지워졌다');
        assert.ok(!B.ev("$('#rptEditInfo').textContent").includes('고친 과제'), '쉬고 있는 고친 글을 "고친 과제" 로 센다');
        await groupVia(B, [['c-b', 'c-b']]);
        txt = B.ev('buildReportText()');
        assert.ok(txt.includes('[베타] : 1.5\n• 베타 고친 글'), '묶음을 풀었는데 고친 글이 돌아오지 않았다');
      } finally { done(); }
    });

    //  설정 창 접근성(§4): 라벨, 첫 선택 상자 포커스, Esc, 닫기, 포커스가 돌아갈 자리: 변이 시험이 재사용
    async function assertDlgA11y(m) {
      assert.ok(!m.doc.getElementById('rptGroupRow').classList.contains('hidden'), '일간에 "보고서 묶음" 줄이 없다');
      assert.strictEqual(m.ev("$('#rptGroupRow .rpt-opt-lb').textContent"), '보고서 묶음');
      const link = m.doc.getElementById('rptGroupOpen');
      assert.strictEqual(link.textContent, '설정');
      link.focus();
      await openDlg(m);
      const modal = m.doc.querySelector('#rptGroupModal .modal');
      assert.strictEqual(modal.getAttribute('role'), 'dialog', '설정 창에 role=dialog 가 없다');
      assert.ok(modal.getAttribute('aria-labelledby') && m.doc.getElementById(modal.getAttribute('aria-labelledby')).textContent === '보고서 묶음', '설정 창 이름이 제목에 이어지지 않는다');
      const mb = findIn(m, 'gmenu', 'c-a');
      assert.ok(mb && mb.getAttribute('aria-label') === '알파 메뉴' && mb.getAttribute('aria-haspopup') === 'menu' && mb.getAttribute('aria-expanded') === 'false', '⋯ 에 이름(알파 메뉴), aria-haspopup, aria-expanded 가 없다');
      for (const b of m.doc.querySelectorAll('#rgmRows button')) assert.ok((b.getAttribute('aria-label') || b.textContent).trim(), '이름 없는 버튼이 있다');
      assert.strictEqual(m.doc.activeElement, mb, '열면 목록의 첫 버튼(알파 ⋯)에 포커스가 가지 않는다');
      assert.strictEqual(m.ev("_modalStack[_modalStack.length - 1].opener && _modalStack[_modalStack.length - 1].opener.id"), 'rptGroupOpen', '닫으면 포커스가 "설정" 링크로 돌아가지 않는다(opener)');
      assert.deepStrictEqual([...m.doc.querySelectorAll('#rptGroupModal .modal-foot button')].map(b => b.textContent), ['모두 풀기', '닫기'], '아래 줄이 "모두 풀기"와 닫기가 아니다');
      assert.ok(m.doc.getElementById('rgmClear').disabled, '묶음이 없는데 "모두 풀기" 가 켜져 있다');
      //  ⋯ 메뉴 키보드: 열면 첫 항목, 화살표로 돌고, Esc 는 메뉴만 닫고 ⋯ 로 돌아온다(설정 창은 그대로)
      mb.click();
      const items = () => [...m.doc.querySelectorAll('#rgmMenu [role="menuitem"]')];
      const menu = m.doc.getElementById('rgmMenu');
      assert.ok(menu && menu.getAttribute('role') === 'menu' && menu.textContent.startsWith('넣을 곳'), '"넣을 곳" 메뉴(role=menu)가 열리지 않았다');
      assert.strictEqual(findIn(m, 'gmenu', 'c-a').getAttribute('aria-expanded'), 'true', '메뉴가 열렸는데 aria-expanded 가 true 가 아니다');
      assert.deepStrictEqual(items().map(e => e.getAttribute('data-ginto')), ['c-b', 'c-c', 'c-d', 'c-etc'], '알파의 넣을 곳이 다른 머리 과제 전부가 아니다');
      assert.strictEqual(m.doc.activeElement, items()[0], '메뉴를 열면 첫 항목에 포커스가 가지 않는다');
      const key = (k) => m.doc.activeElement.dispatchEvent(new m.w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      key('ArrowDown'); assert.strictEqual(m.doc.activeElement, items()[1], '아래 화살표가 다음 항목으로 가지 않는다');
      key('ArrowUp'); key('ArrowUp'); assert.strictEqual(m.doc.activeElement, items()[3], '위 화살표가 끝으로 돌지 않는다');
      key('Escape');
      await tick();
      assert.ok(!m.doc.getElementById('rgmMenu') && overlayOpen(m, 'rptGroupModal'), 'Esc 가 메뉴만 닫지 않았다(설정 창까지 닫혔거나 메뉴가 남았다)');
      assert.strictEqual(m.doc.activeElement, findIn(m, 'gmenu', 'c-a'), 'Esc 뒤 포커스가 ⋯ 로 돌아가지 않았다');
      //  메뉴 바깥(창 제목)을 누르면 메뉴만 닫힌다
      findIn(m, 'gmenu', 'c-a').click();
      assert.ok(m.doc.getElementById('rgmMenu'), '전제: 메뉴가 열렸다');
      dlgHead(m).click();
      assert.ok(!m.doc.getElementById('rgmMenu') && overlayOpen(m, 'rptGroupModal'), '메뉴 바깥을 눌렀는데 메뉴가 닫히지 않았다');
      //  고르기(알파 → 감마): 포커스는 넣은 알파의 X 로. X: 제자리로 돌아오고 포커스는 알파 ⋯ 로
      findIn(m, 'gmenu', 'c-a').click();
      items().find(e => e.getAttribute('data-ginto') === 'c-c').click();
      assert.deepStrictEqual(groupsOf(m), [['c-b'], ['c-c', 'c-a']], '메뉴로 고른 묶음이 설정 창에 보이지 않는다');
      assert.strictEqual(m.ev("$('#rptGroupSum').textContent"), '알파 → 감마');
      assert.strictEqual(m.doc.activeElement, findIn(m, 'gout', 'c-a'), '넣은 뒤 포커스가 알파의 X 로 가지 않았다');
      assert.ok(!m.doc.getElementById('rgmClear').disabled, '묶음이 있는데 "모두 풀기" 가 꺼져 있다');
      findIn(m, 'gout', 'c-a').click();
      assert.deepStrictEqual(groupsOf(m), [['c-a'], ['c-b'], ['c-c']], 'X 로 꺼낸 알파가 제자리(보고서 순서)로 돌아오지 않았다');
      assert.strictEqual(m.doc.activeElement, findIn(m, 'gmenu', 'c-a'), 'X 뒤 포커스가 알파 ⋯ 로 가지 않았다');
      assert.deepStrictEqual(m.evJSON(`rptDraftGet(${JSON.stringify(T)}).group`), {}, 'X 뒤에도 묶음이 남았다');
      //  Esc 로 닫힌다(보고서 창은 남는다)
      m.doc.dispatchEvent(new m.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await waitFor(() => overlayClosed(m, 'rptGroupModal'), 'Esc 로 설정 창이 닫힌다');
      assert.ok(overlayOpen(m, 'reportModal'), 'Esc 가 보고서 창까지 닫았다');
      //  닫기 버튼으로도 닫힌다
      await openDlg(m); await closeDlg(m);
      assert.ok(overlayOpen(m, 'reportModal'));
    }
    test('GB11 (§4): 설정 창 접근성: 열면 첫 버튼, ⋯ 메뉴(이름, 화살표, Esc 는 메뉴만, 바깥 누르기), 고르기 뒤 X 로, X 뒤 ⋯ 로, Esc 와 닫기, 닫으면 "설정" 으로', async () => {
      fresh();
      try { await assertDlgA11y(B); } finally { done(); }
    });

    test('GB12 (§2, §4): 기간 취합(custom)에는 "보고서 묶음" 줄이 없고 묶음이 적용되지 않는다', async () => {
      fresh();
      try {
        await groupVia(B, [['c-b', 'c-a']]);
        B.ev(`setReportMode('custom'); $('#rptFrom').value = ${JSON.stringify(T)}; $('#rptTo').value = ${JSON.stringify(T)}; buildReport();`);
        assert.ok(B.doc.getElementById('rptGroupRow').classList.contains('hidden'), '기간 취합에 "보고서 묶음" 줄이 보인다');
        assert.ok(!B.ev("document.querySelector('#rptOut .rcard-subs')") && B.ev('buildReportText()').includes('[베타]'), '기간 취합에 일간 묶음이 적용됐다');
      } finally { done(); }
    });

    // ── 독립 리뷰 뒤 정정(REPORT-GROUP 정정 이력 "리뷰 뒤") ──
    const setSkip = (m, on) => m.ev(`$('#rptSkipEmpty').checked = ${on}; $('#rptSkipEmpty').dispatchEvent(new Event('change'));`);
    //  정정 1: 대상을 고친 뒤 묶으면 나가는 글에는 묶인 과제 줄이 없다. 카드가 그것을 말한다(고친 글은 덮지 않는다) — 변이 시험이 재사용
    async function assertCardStale(m) {
      setView(m, 'doc');
      const t = m.ev("[].find.call(document.querySelectorAll('#rptOut .rdoc-ta'), function(t){ return t.dataset.rcat === 'c-a'; })");
      t.value = '• 알파 고친 글'; t.dispatchEvent(new m.w.Event('input', { bubbles: true }));
      setView(m, 'card');
      assert.ok(!dcard(m, 'c-a').querySelector('.rcard-gstale'), '묶기 전에는 묶음 안내가 없어야 한다');
      await groupVia(m, [['c-b', 'c-a']]);
      const n = dcard(m, 'c-a').querySelector('.rcard-gstale');
      assert.ok(n && n.textContent === '고친 글에 묶은 과제 줄이 없습니다. 글 편집에서 초안으로 되돌리면 들어갑니다.', '고친 대상 카드에 "묶은 과제 줄이 없다" 안내가 없다');
      assert.ok(m.ev('buildReportText()').startsWith('[알파] : 3.5\n• 알파 고친 글\n\n'), '안내가 고친 글을 덮었다');
      setView(m, 'doc');
      m.doc.querySelector('#rptOut .rdoc-sec[data-rcat="c-a"] .rdoc-revert').click();
      await confirmOk(m);
      setView(m, 'card');
      assert.ok(!dcard(m, 'c-a').querySelector('.rcard-gstale'), '초안으로 되돌린 뒤에도 안내가 남았다');
    }
    test('GB13 (리뷰 정정 1): 대상을 고친 뒤 묶으면 카드에 "고친 글에 묶은 과제 줄이 없습니다" 안내, 초안으로 되돌리면 사라진다', async () => {
      fresh();
      try { await assertCardStale(B); } finally { done(); }
    });

    //  정정 2: 빈 [기타] 로 묶고 "내용 없는 항목 제외" 를 켜도 대상은 행으로 남고, 걸러진 묶인 과제의 묶음도 쓰기 때 버리지 않는다. 지운 과제를 가리키는 묶음만 걷는다 — 변이 시험이 재사용
    async function assertSkipEmptyKeeps(m) {
      await groupVia(m, [['c-b', 'c-etc']]);
      setSkip(m, true);
      assert.deepStrictEqual(topCats(m), ['c-a', 'c-c', 'c-etc'], '내용 없는 항목 제외를 켜자 묶음 대상 [기타] 가 빠졌다');
      assert.deepStrictEqual(subCats(m, 'c-etc'), ['c-b'], '내용 없는 항목 제외를 켜자 묶음이 풀렸다');
      const txt = m.ev('buildReportText()');
      assert.ok(txt.endsWith('[기타] : 1.5\n' + NB.repeat(4) + '- 베타\n' + NB.repeat(6) + '- 고객 회신\n'), '빈 [기타] 대상 글이 다르다: ' + JSON.stringify(txt.slice(-80)));
      const cap = sendDailyBrowser(m);
      assert.deepStrictEqual(cap.hours, [{ name: '알파', hours: 2 }, { name: '감마', hours: 1 }, { name: '기타', hours: 1.5 }], '내용 없는 항목 제외 + 묶음 payload.hours');
      //  걸러진 묶인 과제(빈 델타 → 알파): 다른 쓰기가 있어도 묶음이 남는다
      setSkip(m, false);
      await groupVia(m, [['c-d', 'c-a']]);
      setSkip(m, true);
      assert.ok(!m.ev("document.querySelector('#rptOut .rcard[data-rcat=\"c-d\"]')"), '전제: 빈 델타는 걸러진다');
      dcard(m, 'c-c').querySelector('.rcard-x').click();
      dcard(m, 'c-c').querySelector('.rcard-back').click();
      assert.deepStrictEqual(getStored(m, KEY).group, { 'c-b': 'c-etc', 'c-d': 'c-a' }, '걸러진 행 때문에 쓰기가 묶음을 버렸다');
      setSkip(m, false);
      assert.deepStrictEqual(subCats(m, 'c-a'), ['c-d'], '내용 없는 항목 제외를 끄자 묶음이 돌아오지 않았다');
      //  지운 과제를 가리키는 묶음은 다음 쓰기 때 걷는다
      m.ev(`(function(){ var k = ${JSON.stringify(KEY)}, d = JSON.parse(localStorage.getItem(k)); d.group['c-gone'] = 'c-a'; d.group['c-c'] = 'c-gone2'; localStorage.setItem(k, JSON.stringify(d)); __rptDraftMem.clear(); __rptDraftDirty.clear(); buildReport(); })()`);
      dcard(m, 'c-c').querySelector('.rcard-x').click();
      assert.deepStrictEqual(getStored(m, KEY).group, { 'c-b': 'c-etc', 'c-d': 'c-a' }, '지운 과제를 가리키는 묶음을 쓰기 때 걷지 않았다');
      setSkip(m, false);
    }
    test('GB14 (리뷰 정정 2, 4): 빈 [기타] 로 묶고 내용 없는 항목 제외를 켜도 묶음 유지(행, 글, hours) · 걸러진 묶인 과제의 묶음도 쓰기 때 남고 지운 과제 묶음만 걷는다', async () => {
      fresh();
      try { await assertSkipEmptyKeeps(B); } finally { setSkip(B, false); done(); }
    });

    //  정정 3: 숨은 묶음이 되살아나지 않는다(a → b 가 숨어 있을 때 b → 다른 과제로 묶었다가 풀면 a 는 머리 줄로 남는다) — 변이 시험이 재사용
    async function assertNoResurrect(m) {
      await groupVia(m, [['c-d', 'c-b']]);
      setSkip(m, true);   // 빈 델타가 걸러져 델타 → 베타 는 숨는다(베타는 대상이 아니게 보인다)
      await openDlg(m);
      assert.ok(findIn(m, 'gmenu', 'c-b'), '전제: 델타 → 베타 가 숨어 있어 베타는 묶음 없는 머리 과제(⋯ 가 있다)');
      pick(m, 'c-b', 'c-a'); await closeDlg(m);
      assert.deepStrictEqual(getStored(m, KEY).group, { 'c-b': 'c-a' }, '베타를 묶을 때 베타를 대상으로 삼던 숨은 묶음(델타 → 베타)을 지우지 않았다');
      setSkip(m, false);
      await groupVia(m, [['c-b', 'c-b']]);
      assert.ok(m.ev("!!document.querySelector('#rptOut > .rcard[data-rcat=\"c-d\"]')") && !m.ev("document.querySelector('#rptOut .rcard-subs')"), '묶음을 풀자 숨어 있던 델타 → 베타 가 되살아났다');
    }
    test('GB15 (리뷰 정정 3): a → b 가 숨어 있을 때 b → 다른 과제로 묶었다가 풀어도 a → b 가 되살아나지 않는다(내용 없는 항목 제외 켜고 끄기)', async () => {
      fresh();
      try { await assertNoResurrect(B); } finally { setSkip(B, false); done(); }
    });

    //  정정 6: 설정 링크 이름, 요약은 글이 바뀔 때만 쓴다(aria-live 되풀이 방지) — 변이 시험이 재사용
    async function assertSumQuiet(m) {
      assert.strictEqual(m.doc.getElementById('rptGroupOpen').getAttribute('aria-label'), '보고서 묶음 설정', '설정 링크의 접근 이름이 "보고서 묶음 설정" 이 아니다');
      const n0 = m.doc.getElementById('rptGroupSum').firstChild;
      m.ev('buildReport(); buildReport();');
      assert.strictEqual(m.doc.getElementById('rptGroupSum').firstChild, n0, '글이 같은데 요약을 다시 썼다(aria-live 가 다시 읽는다)');
      await groupVia(m, [['c-b', 'c-a']]);
      const n1 = m.doc.getElementById('rptGroupSum').firstChild;
      assert.ok(n1 !== n0 && m.ev("$('#rptGroupSum').textContent") === '베타 → 알파', '묶음이 바뀌었는데 요약이 바뀌지 않았다');
      m.ev('buildReport();');
      assert.strictEqual(m.doc.getElementById('rptGroupSum').firstChild, n1, '글이 같은데 요약을 다시 썼다(묶음 뒤)');
    }
    test('GB16 (리뷰 정정 6): 설정 링크 aria-label, 요약(aria-live)은 글이 바뀔 때만 쓴다', async () => {
      fresh();
      try { await assertSumQuiet(B); } finally { done(); }
    });

    test('변이 GBM11: 카드 묶음 안내를 빼면 GB13 이 잡는다', async () => {
      const bad = mutate(app, '      if(_gStale) html += `<div class="rcard-gstale"', '      if(false) html += `<div class="rcard-gstale"');
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertCardStale(X), /안내가 없다/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GBM12: 빈 대상을 살리지 않거나, 걸러진 행 기준으로 묶음을 걷거나, 지운 과제 묶음을 걷지 않으면 GB14 가 잡는다', async () => {
      const cases = [
        [mutate(app, 'if(_keep.size) rows = _rowsAll.filter(r => rows.includes(r) || _keep.has(r.key));', ''), /\[기타\] 가 빠졌다/],
        [mutate(app, "if(!_cats.has(k) || !_cats.has(d.group[k])) delete d.group[k]; }", "if(!_cats.has(k) || !_cats.has(d.group[k]) || (keys && (!keys.has(k) || !keys.has(d.group[k])))) delete d.group[k]; }"), /쓰기가 묶음을 버렸다/],
        [mutate(app, "  if(d && d.group){ const _cats = new Set((state.categories || []).map(c => c.id)); for(const k of Object.keys(d.group)) if(!_cats.has(k) || !_cats.has(d.group[k])) delete d.group[k]; }\n", ''), /지운 과제를 가리키는 묶음/],
      ];
      for (const [bad, re] of cases) {
        const X = bootBrowser(bad);
        try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertSkipEmptyKeeps(X), re); }
        finally { clearDrafts(X); await X.close(); }
      }
    });
    test('변이 GBM13: 묶을 때 숨은 묶음을 지우지 않으면 GB15 가 잡는다', async () => {
      const bad = mutate(app, 'for(const x of Object.keys(d.group)) if(d.group[x] === src) delete d.group[x]; ', '');
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertNoResurrect(X), /숨은 묶음/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GBM14: 요약을 다시 그릴 때마다 쓰면 GB16 이 잡는다', async () => {
      const bad = mutate(app, 'if(sum && sum.innerHTML !== sumHtml) sum.innerHTML = sumHtml;', 'if(sum) sum.innerHTML = sumHtml;');
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertSumQuiet(X), /다시 썼다/); }
      finally { clearDrafts(X); await X.close(); }
    });

    // ── 변이(일간) ──
    test('변이 GBM1: 머리 줄 시간 함수가 묶음을 무시하면 GB2 가 잡는다', async () => {
      const bad = mutate(app, '  const _g = rptDayGroup(rows, date);\n', '  const _g = null;\n');
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertDailyGrouped(X, T), /글이 다르다|payload\.hours|합계/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GBM2: 묶인 과제 줄의 한 단계 들여쓰기를 빼면 GB2 가 잡는다', async () => {
      const bad = mutate(app, "(kidBody ? '\\n' + String(kidBody).split('\\n').map(l => sub + l).join('\\n') : '')", "(kidBody ? '\\n' + String(kidBody) : '')");
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertDailyGrouped(X, T), /글이 다르다/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GBM3: 묶인 과제 번호를 이어 매기지 않으면 GB2 가 잡는다', async () => {
      const bad = mutate(app, 'const mk = reportMarkerAt(spec, r.titles.length + j);', 'const mk = reportMarkerAt(spec, j);');
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertDailyGrouped(X, T), /묶음 ② 글이 다르다/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GBM4: 합계 반올림을 빼면 GB3 이 잡는다', async () => {
      const bad = mutate(app, '  return any ? Math.round(s * 100) / 100 : null;', '  return any ? s : null;');
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertDailyFrac(X, T), /0\.3/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GBM5: 낡은 대상(없는 과제)을 거르지 않으면 GB1 의 바이트 비교가 잡는다', async () => {
      const bad = mutate(app, ' && group[k] !== k && ks.has(group[k])) cand.set', ' && group[k] !== k) cand.set');
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertDailySame(X, T, KEY), /예전과 다르다|묶음 카드|묶은 과제/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GBM6: 넣을 곳 메뉴에 묶인 과제를 넣으면(두 단계) GB4 가 잡는다', async () => {
      const bad = mutate(app, 'tops.filter(y => y.k !== __rgm.menuFor)', 'g.rows.filter(y => y.k !== __rgm.menuFor)');
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertOneLevel(X), /넣을 곳/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GBM7: 대상 X 가 묶인 과제를 남기면(묶인 과제를 머리 줄로 되살리면) GB6 이 잡는다', async () => {
      const bad = mutate(app, "  const blocks = rows.filter(r => !(_dr && _dr.out.includes(r.key))).filter(r => !(_dg && _dg.kid.has(r.key))).map(r => {",
        "  const blocks = rows.filter(r => !(_dr && _dr.out.includes(r.key))).filter(r => !(_dg && _dg.kid.has(r.key) && !_dr.out.includes(_dg.kid.get(r.key)))).map(r => {");
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertXGroup(X), /대상 X 뒤에도 묶음이 남았다/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GBM8: 묶음만 있는 저장본을 빈 것으로 치거나 읽을 때 묶음을 버리면 GB7 이 잡는다', async () => {
      const bad1 = mutate(app, " && !Object.keys(d.group || {}).length); }\n// 저장본 → 정규화", "); }\n// 저장본 → 정규화");
      let X = bootBrowser(bad1);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertStorage(X), /키가 생기지 않았다/); }
      finally { clearDrafts(X); await X.close(); }
      const bad2 = mutate(app, "savedAt: typeof o.savedAt === 'string' ? o.savedAt : '', group: rptGroupNorm(o.group) };   // group: 보고서 묶음(REPORT-GROUP §5)\n}\n// 그 날짜의 초안",
        "savedAt: typeof o.savedAt === 'string' ? o.savedAt : '', group: {} };\n}\n// 그 날짜의 초안");
      X = bootBrowser(bad2);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertStorage(X), /사라졌다|임시 저장됨/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GBM9: 대상 초안을 묶음 없이 만들면(낡은 초안 비교가 묶음을 못 보면) GB9 가 잡는다', async () => {
      const bad = mutate(app, "        draft: _gk.length ? reportGroupBodyText(r, _gk, ' ', _mkSpec, _indent) : reportRowBodyText(r, ' ', _mkSpec, _indent),",
        "        draft: reportRowBodyText(r, ' ', _mkSpec, _indent),");
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertStale(X), /낡은 초안 안내가 없다/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GBM10: 열면 첫 버튼 포커스를 잃거나, 메뉴 Esc 가 설정 창까지 닫으면 GB11 이 잡는다', async () => {
      for (const [bad, re] of [
        [mutate(app, "    ov.__focusFirst = () => $('#rgmRows button') || null;\n", ''), /첫 버튼/],
        [mutate(app, 'ev.preventDefault(); ev.stopPropagation(); _rgmMenuClose(true); return;', 'ev.preventDefault(); _rgmMenuClose(true); return;'), /Esc 가 메뉴만/],
      ]) {
        const X = bootBrowser(bad);
        try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertDlgA11y(X), re); }
        finally { clearDrafts(X); await X.close(); }
      }
    });

    //  ── 설정 창(2026-10-08 끌어넣기): 내용 없는 과제 접기, 끌어 놓기, 모두 풀기 ──
    //  내용 없는 과제(업무 줄, 시간, 묶인 과제가 모두 없음)는 "오늘 내용 없는 과제 N개 [보기]" 뒤에 접힌다. 보기 = 흐리게 펼침, 접기. 열 때마다 접힘. 변이 시험이 재사용
    async function assertFold(m) {
      await openDlg(m);
      assert.deepStrictEqual(groupsOf(m), [['c-a'], ['c-b'], ['c-c']], '내용 없는 델타, 기타가 접혀 있지 않다');
      const more = () => m.doc.querySelector('#rgmRows .rgm-more');
      assert.ok(more() && more().textContent === '오늘 내용 없는 과제 2개보기', '"오늘 내용 없는 과제 2개 [보기]" 줄이 없다: ' + (more() && more().textContent));
      m.doc.querySelector('#rgmRows [data-gmore]').click();
      assert.deepStrictEqual(groupsOf(m), [['c-a'], ['c-b'], ['c-c'], ['c-d'], ['c-etc']], '보기를 눌렀는데 내용 없는 과제가 제자리에 나오지 않았다');
      assert.ok(rowEl(m, 'c-d').classList.contains('dim') && rowEl(m, 'c-etc').classList.contains('dim') && !rowEl(m, 'c-c').classList.contains('dim'), '내용 없는 과제만 흐려야 한다');
      assert.ok(!rowEl(m, 'c-d').querySelector('.rgm-meta'), '내용 없는 과제에 업무나 시간 표시가 있다');
      assert.strictEqual(more().textContent, '접기', '펼친 뒤 "접기" 가 없다');
      assert.strictEqual(m.doc.activeElement, m.doc.querySelector('#rgmRows [data-gmore]'), '보기 뒤 포커스가 접기로 가지 않았다');
      m.doc.querySelector('#rgmRows [data-gmore]').click();
      assert.deepStrictEqual(groupsOf(m), [['c-a'], ['c-b'], ['c-c']], '접기를 눌렀는데 접히지 않았다');
      //  빈 기타에 베타를 넣으면 기타는 내용이 생겨 펼쳐진다(묶인 과제가 있는 과제는 내용 있음)
      pick(m, 'c-b', 'c-etc');
      assert.deepStrictEqual(groupsOf(m), [['c-a'], ['c-c'], ['c-etc', 'c-b']], '베타가 들어간 기타가 보이지 않는다');
      assert.strictEqual(more().textContent, '오늘 내용 없는 과제 1개보기');
      //  내용 없는 델타를 감마에 넣었다가 꺼내면, 꺼낸 델타는 이번 창에서는 보인다(사라지지 않게)
      assert.strictEqual(m.ev("rptGroupSet('c-d', 'c-c')"), true);   // 접힌 채로(보기를 누르지 않고) 묶는다
      assert.ok(rowEl(m, 'c-d') && rowEl(m, 'c-d').classList.contains('kid'), '전제: 접힌 채로 델타가 감마 안에 보인다');
      findIn(m, 'gout', 'c-d').click();
      assert.ok(rowEl(m, 'c-d'), '꺼낸 빈 델타가 다시 접혀 사라졌다');
      assert.ok(!more(), '접을 과제가 없는데 보기 줄이 있다');
      await closeDlg(m);
      await openDlg(m);
      assert.ok(!rowEl(m, 'c-d') && more() && more().textContent === '오늘 내용 없는 과제 1개보기', '다시 열었는데 창 상태(펼침, 꺼낸 과제)가 처음으로 돌아가지 않았다');
      await closeDlg(m);
    }
    test('GB17 (§4): 설정 창: 내용 없는 과제는 "오늘 내용 없는 과제 N개 [보기]" 뒤에 접히고, 보기는 흐리게 펼치고 접기로 접는다, 꺼낸 과제는 남고, 열 때마다 처음으로', async () => {
      fresh();
      try { await assertFold(B); } finally { done(); }
    });

    //  끌어 놓기(포인터 이벤트): 넣기(점선 강조, 그림자, 흐린 원래 줄), 옮기기, 밖에 놓아 풀기, Esc 와 pointercancel 취소, 5px 안은 끌기 아님, 터치는 ⠿ 에서만. 변이 시험이 재사용
    async function assertDrag(m) {
      await openDlg(m);
      const K = () => m.evJSON(`rptDraftGet(${JSON.stringify(T)}).group`);
      //  베타 → 알파: 움직이는 동안 알파 묶음이 점선, 그림자는 창 안, 원래 줄은 흐림. 놓으면 묶인다
      dragDown(m, 'c-b'); dragMove(m, rowEl(m, 'c-a'));
      const gh = m.doc.querySelector('#rptGroupModal .rgm-ghost');
      assert.ok(gh && gh.getAttribute('aria-hidden') === 'true' && !gh.querySelector('button'), '끄는 동안 그림자(눌리지 않는 본뜬 줄)가 창 안에 없다');
      assert.ok(grpEl(m, 'c-a').classList.contains('drop') && rowEl(m, 'c-b').classList.contains('src') && m.doc.body.classList.contains('rgm-dragging'), '놓을 곳 강조나 흐린 원래 줄이 없다');
      dragUp(m, rowEl(m, 'c-a'));
      assert.ok(!m.doc.querySelector('.rgm-ghost') && !m.doc.body.classList.contains('rgm-dragging') && !m.doc.querySelector('#rgmRows .drop'), '놓은 뒤 그림자나 강조가 남았다');
      assert.deepStrictEqual(K(), { 'c-b': 'c-a' }, '베타를 알파 위에 놓았는데 묶이지 않았다');
      assert.deepStrictEqual(groupsOf(m), [['c-a', 'c-b'], ['c-c']]);
      //  묶인 베타를 감마로 옮긴다
      dragTo(m, 'c-b', rowEl(m, 'c-c'));
      assert.deepStrictEqual(K(), { 'c-b': 'c-c' }, '묶인 베타를 다른 머리 과제로 옮기지 못했다');
      //  다른 과제가 묶인 감마는 끌리지 않는다
      dragTo(m, 'c-c', rowEl(m, 'c-a'));
      assert.deepStrictEqual(K(), { 'c-b': 'c-c' }, '다른 과제가 묶인 감마를 끌어 묶었다(두 단계)');
      //  묶인 베타를 지금 부모(감마) 위에 놓으면 그대로
      dragTo(m, 'c-b', rowEl(m, 'c-c'));
      assert.deepStrictEqual(K(), { 'c-b': 'c-c' }, '묶인 베타를 지금 부모 위에 놓았는데 그대로가 아니다');
      //  묶인 베타를 묶음 밖(창 제목)에 놓으면 푼다
      dragTo(m, 'c-b', dlgHead(m));
      assert.deepStrictEqual(K(), {}, '묶인 베타를 묶음 밖에 놓았는데 풀리지 않았다');
      assert.deepStrictEqual(groupsOf(m), [['c-a'], ['c-b'], ['c-c']], '푼 베타가 제자리로 돌아오지 않았다');
      //  Esc 는 끌기만 취소한다(설정 창은 그대로)
      dragDown(m, 'c-b'); dragMove(m, rowEl(m, 'c-a'));
      m.doc.body.dispatchEvent(new m.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await tick();
      assert.ok(!m.doc.querySelector('.rgm-ghost') && overlayOpen(m, 'rptGroupModal'), 'Esc 가 끌기를 취소하지 않았거나 설정 창을 닫았다');
      dragUp(m, rowEl(m, 'c-a'));
      assert.deepStrictEqual(K(), {}, 'Esc 로 취소한 끌기가 묶었다');
      //  pointercancel 도 취소
      dragDown(m, 'c-b'); dragMove(m, rowEl(m, 'c-a'));
      m.doc.dispatchEvent(pev(m, 'pointercancel', 10, 40));
      assert.ok(!m.doc.querySelector('.rgm-ghost'), 'pointercancel 뒤 그림자가 남았다');
      dragUp(m, rowEl(m, 'c-a'));
      assert.deepStrictEqual(K(), {}, 'pointercancel 로 취소한 끌기가 묶었다');
      //  5px 안에서 놓으면 끌기가 아니다
      dragDown(m, 'c-b');
      m.doc.elementFromPoint = () => rowEl(m, 'c-a');
      m.doc.dispatchEvent(pev(m, 'pointermove', 12, 12)); m.doc.dispatchEvent(pev(m, 'pointerup', 12, 12));
      delete m.doc.elementFromPoint;
      assert.deepStrictEqual(K(), {}, '5px 안의 누르기가 끌기로 묶었다');
      //  버튼(⋯)에서 시작하면 끌기가 아니다
      dragDown(m, 'c-b', { from: '[data-gmenu]' }); dragMove(m, rowEl(m, 'c-a')); dragUp(m, rowEl(m, 'c-a'));
      assert.deepStrictEqual(K(), {}, '⋯ 버튼에서 끌기가 시작됐다');
      //  터치: 줄을 밀면 스크롤(끌기 아님), ⠿ 에서는 끈다
      const touch = { ev: { pointerType: 'touch' } };
      dragDown(m, 'c-b', touch); dragMove(m, rowEl(m, 'c-a'), touch); dragUp(m, rowEl(m, 'c-a'), touch);
      assert.deepStrictEqual(K(), {}, '터치로 줄을 밀었는데 끌기가 됐다(목록이 스크롤되지 않는다)');
      dragDown(m, 'c-b', { from: '.rgm-hdl', ev: { pointerType: 'touch' } }); dragMove(m, rowEl(m, 'c-a'), touch); dragUp(m, rowEl(m, 'c-a'), touch);
      assert.deepStrictEqual(K(), { 'c-b': 'c-a' }, '터치로 ⠿ 를 끌어 놓았는데 묶이지 않았다');
      await closeDlg(m);
      assert.ok(m.ev('buildReportText()').startsWith('[알파] : 3.5\n'), '끌어 넣은 묶음이 나가는 글에 들어가지 않았다');
    }
    test('GB18 (§4): 끌어 놓기(포인터 이벤트): 넣기와 강조, 옮기기, 묶음 있는 과제는 못 끔, 부모 위는 그대로, 밖에 놓아 풀기, Esc 와 pointercancel 취소, 5px, 버튼에서 시작 안 함, 터치는 ⠿ 에서만', async () => {
      fresh();
      try { await assertDrag(B); } finally { delete B.doc.elementFromPoint; done(); }
    });

    //  모두 풀기: 지금 묶음을 모두 푼다(키도 지운다). 꺼지고 포커스는 목록의 첫 버튼. 변이 시험이 재사용
    async function assertClearAll(m) {
      await groupVia(m, [['c-b', 'c-a'], ['c-c', 'c-a']]);
      await openDlg(m);
      const clr = m.doc.getElementById('rgmClear');
      assert.ok(!clr.disabled, '묶음이 있는데 "모두 풀기" 가 꺼져 있다');
      assert.deepStrictEqual(groupsOf(m), [['c-a', 'c-b', 'c-c']]);
      assert.strictEqual(rowEl(m, 'c-a').querySelector('.rgm-meta').textContent, '업무 4건, 4.5시간', '머리 줄이 묶인 과제까지 더한 업무와 시간이 아니다');
      clr.click();
      assert.deepStrictEqual(m.evJSON(`rptDraftGet(${JSON.stringify(T)}).group`), {}, '"모두 풀기" 뒤에도 묶음이 남았다');
      assert.ok(!allKeys(m, 'tc_rptDraft').includes(KEY), '"모두 풀기" 로 다 풀었는데 키가 남았다');
      assert.deepStrictEqual(groupsOf(m), [['c-a'], ['c-b'], ['c-c']], '"모두 풀기" 뒤 과제가 제자리로 돌아오지 않았다');
      assert.ok(m.doc.getElementById('rgmClear').disabled, '다 풀었는데 "모두 풀기" 가 켜져 있다');
      assert.strictEqual(m.doc.activeElement, m.doc.querySelector('#rgmRows button'), '"모두 풀기" 뒤 포커스가 목록의 첫 버튼이 아니다');
      assert.strictEqual(m.ev("$('#rptGroupSum').textContent"), '묶은 과제 없음');
      await closeDlg(m);
    }
    test('GB19 (§4): 모두 풀기: 묶음을 모두 풀고 키를 지운다, 꺼지고 포커스는 첫 버튼, 요약은 "묶은 과제 없음"', async () => {
      fresh();
      try { await assertClearAll(B); } finally { done(); }
    });
    test('변이 GBM15: 접기를 빼거나, 꺼낸 과제를 남기지 않으면 GB17 이 잡는다', async () => {
      for (const [bad, re] of [
        [mutate(app, '  const vis = tops.filter(x => __rgm.showEmpty || full(x) || __rgm.keep.has(x.k));', '  const vis = tops;'), /접혀 있지 않다/],
        [mutate(app, '      __rgm.keep.add(k);   // 꺼낸 과제는', '      // 꺼낸 과제는'), /사라졌다/],
      ]) {
        const X = bootBrowser(bad);
        try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertFold(X), re); }
        finally { clearDrafts(X); await X.close(); }
      }
    });
    test('변이 GBM16: 놓기가 판정을 건너뛰거나, 밖에 놓아 풀기를 빼거나, Esc 취소나 터치 ⠿ 제한을 빼면 GB18 이 잡는다', async () => {
      for (const [bad, re] of [
        [mutate(app, '    const tgt = rptGroupDropTarget(d.live, d.k, d.over);\n    if(tgt == null) return;', '    const tgt = d.over;\n    if(tgt == null) return;'), /두 단계|그대로|풀리지/],
        [mutate(app, "  if(over == null || over === '') return par ? src : null;", "  if(over == null || over === '') return null;"), /풀리지 않았다/],
        [mutate(app, "  function _rgmKey(ev){ if(ev.key === 'Escape' && _rgmDrag && _rgmDrag.on){ ev.preventDefault(); ev.stopImmediatePropagation(); _rgmEnd(false); } }", '  function _rgmKey(ev){}'), /Esc/],
        [mutate(app, "    if(ev.pointerType === 'touch' && !t.closest('.rgm-hdl')) return;", ''), /터치로 줄을 밀었는데/],
      ]) {
        const X = bootBrowser(bad);
        try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertDrag(X), re); }
        finally { delete X.doc.elementFromPoint; clearDrafts(X); await X.close(); }
      }
    });
    test('변이 GBM17: 모두 풀기가 묶음을 풀지 않으면 GB19 가 잡는다', async () => {
      const bad = mutate(app, '    for(const s of [...live.keys()]){ __rgm.keep.add(s); rptGroupSet(s, s); }\n', '');
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(dayState(T, Y, N)) + ';'); openDaily(X, T); await assert.rejects(() => assertClearAll(X), /모두 풀기/); }
      finally { clearDrafts(X); await X.close(); }
    });

    // ───────────────────────── 주간(캘린더 출처) ─────────────────────────
    const MON = '2026-07-13', SUN = '2026-07-19', MON2 = '2026-07-20', SUN2 = '2026-07-26';
    //  weekly-edit 과 같은 상태: 알파(3.5), 베타(1), 감마(0.5), 델타(없음), '알 파'(동명, 키 알파#c-a2)
    const weekState = () => ({
      categories: [
        { id: 'c-a', name: '알파', color: '#3e5be0', desc: '', createdAt: CA },
        { id: 'c-b', name: '베타', color: '#2e9e6b', desc: '', createdAt: CA },
        { id: 'c-c', name: '감마', color: '#d97706', desc: '', createdAt: CA },
        { id: 'c-d', name: '델타', color: '#5b6b7d', desc: '', createdAt: CA },
        { id: 'c-a2', name: '알 파', color: '#888888', desc: '', createdAt: CA },
      ],
      entries: [
        E({ id: 'e-a1', date: MON, title: '로그인 화면 리뷰', categoryId: 'c-a', memo: 'UI 확인\n• 암호화 모듈 확인' }),
        E({ id: 'g-a', date: '2026-07-14', title: '기능 추가', categoryId: 'c-a', memo: '본문 첫 줄\n  - 들여쓴 본문' }),
        E({ id: 'e-b1', date: '2026-07-15', title: '고객 회신', categoryId: 'c-b' }),
        E({ id: 'e-a2x', date: '2026-07-16', title: '동명 과제 일', categoryId: 'c-a2' }),
        E({ id: 'e-n1', date: '2026-07-21', title: '다음 주 일', categoryId: 'c-b' }),
      ],
      todos: [],
      rooms: [], attendance: {},
      taskHours: { [MON]: { 'c-a': 2, 'c-b': 1 }, '2026-07-14': { 'c-a': 1.5, 'c-c': 0.5 }, '2026-07-21': { 'c-b': 3 } },
      reportMarker: '-', reportMarkerCustom: '', reportIndent: 2,
      reportFormatPrefs: { daily: { marker: '-', markerCustom: '', indent: 2 }, weekly: { marker: '-', markerCustom: '', indent: 2 } },
    });
    //  예전 buildReportText(028409e) 의 캘린더 경로: 주간 복사의 기준(앱 전역을 쓴다).
    function WREF(indentUnit) {
      indentUnit = indentUnit || ' ';
      const from = $('#rptFrom').value, to = $('#rptTo').value;
      const { rows } = collectReportData(from, to, rptSources());
      if (!rows.length) return '';
      const _mkSpec = reportMarkerSpec();
      const _fmt = currentReportFormatPref();
      const _indent = Math.max(0, Math.min(6, _fmt.indent != null ? _fmt.indent : 2));
      const _pad = indentUnit.repeat(_indent * 2);
      return rows.map(r => '[' + r.name + ']' + r.titles.map((t, i) => {
        const _mk = reportMarkerAt(_mkSpec, i); const _prefix = _mk ? (_mk + ' ') : '';
        const m = (r.titleMeta && r.titleMeta[i]) || null;
        const _sub = _pad + reportSubIndent(_prefix, indentUnit);
        return '\n' + _pad + _prefix + t + reportTextDetails(m, _sub);
      }).join('')).join('\n\n') + '\n';
    }
    const openWeekly = (m, mon) => m.ev(`openReport(); setReportMode('weekly'); ['#rptSrcEvent','#rptSrcTodo','#rptWithDesc'].forEach(function(s){ $(s).checked = true; }); $('#rptSkipEmpty').checked = false;`
      + ` $('#rptFrom').value = ${JSON.stringify(mon)}; $('#rptFrom').dispatchEvent(new Event('change'));`);
    const setWeek = (m, mon) => m.ev(`$('#rptFrom').value = ${JSON.stringify(mon)}; $('#rptFrom').dispatchEvent(new Event('change'));`);
    const wcard = (m, k) => m.ev(`[].find.call(document.querySelectorAll('#rptOut .rcard'), function(c){ return c.dataset.wk === ${JSON.stringify(k)}; })`);
    const wTop = (m) => m.evJSON("[].map.call(document.querySelectorAll('#rptOut > .rcard'), function(c){ return c.dataset.wk; })");
    const wSubs = (m, k) => m.evJSON(`(function(){ var c = [].find.call(document.querySelectorAll('#rptOut > .rcard'), function(c){ return c.dataset.wk === ${JSON.stringify(k)}; }); return c ? [].map.call(c.querySelectorAll('.rcard-subs > .rcard'), function(x){ return x.dataset.wk; }) : null; })()`);
    const sendW = (m) => { m.ev('window.__capW = null; Platform.report.submitWeekly = function(p){ window.__capW = JSON.parse(JSON.stringify(p)); };'); m.doc.getElementById('btnRptSend').click(); const c = m.evJSON('window.__capW'); if (m.ev('HOST')) m.ev('clearTimeout(Netcus.watchdog)'); return c; };
    const baseCal = (m) => m.evJSON('buildWeeklyFields($("#rptFrom").value, $("#rptTo").value, rptSources())');
    const WKEY = () => B.ev(`rptWKey(${JSON.stringify(MON)}, ${JSON.stringify(SUN)})`);
    const wfresh = () => { clearDrafts(B); B.ev('state = ' + JSON.stringify(weekState()) + ';'); openWeekly(B, MON); setView(B, 'card'); };

    //  바이트 같음(주간 cal): 묶음 없음 + 낡은 묶음 흔적(다른 이름, 자기 자신): 변이 시험이 재사용
    async function assertWeekSame(m) {
      m.ev('window.__WREF = ' + WREF.toString());
      let n = 0;
      for (const variant of ['none', 'stale']) {
        if (variant === 'stale') m.ev(`localStorage.setItem(rptWKey(${JSON.stringify(MON)}, ${JSON.stringify(SUN)}), JSON.stringify({ v:1, from:${JSON.stringify(MON)}, to:${JSON.stringify(SUN)}, prog:{}, progBase:{}, progBaseSrc:{}, plan:{}, out:[], group:{ '사라진과제':'알파', '알파':'없는대상', '베타':'베타' }, savedAt:'' })); __rptDraftMem.clear(); __rptDraftDirty.clear();`);
        for (const [mk, cu, ind] of FORMATS) {
          m.ev(`state.reportFormatPrefs = { daily: { marker: '-', markerCustom: '', indent: 2 }, weekly: { marker: ${JSON.stringify(mk)}, markerCustom: ${JSON.stringify(cu)}, indent: ${ind} } }; buildReport();`);
          const tag = `${variant} ${mk}/${cu}/${ind}`;
          const base = baseCal(m);
          assert.deepStrictEqual(m.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)'), base, '네 칸이 buildWeeklyFields 와 다르다: ' + tag);
          assert.strictEqual(m.ev('buildReportText()'), m.ev('__WREF()'), '주간 복사가 예전과 다르다: ' + tag);
          assert.ok(!m.ev("document.querySelector('#rptOut .rcard-subs, #rptOut .rcard-gsum')"), '묶음이 없는데 묶음 카드가 보인다: ' + tag);
          n++;
        }
        m.ev(`state.reportFormatPrefs = { daily: { marker: '-', markerCustom: '', indent: 2 }, weekly: { marker: '-', markerCustom: '', indent: 2 } }; buildReport();`);
        const cap = sendW(m), b = baseCal(m);
        assert.deepStrictEqual(cap.fields, { sdate: MON, edate: SUN, subject: b.subject, content: b.content, endwork: b.endwork, planwork: b.planwork }, '실제 채우기 네 칸이 예전과 다르다: ' + variant);
        assert.strictEqual(await copyText(m), m.ev('__WREF()'), '복사 버튼 글이 예전과 다르다: ' + variant);
      }
      return n;
    }
    test('GW1 (§3, §6): 주간(캘린더): 묶음이 없으면(낡은 묶음 흔적만 있어도) 네 칸, 복사, 실제 채우기가 예전과 바이트 같다', async () => {
      wfresh();
      try { assert.ok((await assertWeekSame(B)) >= 10); } finally { done(); }
    });

    //  주간(cal) 묶음 적용: 베타 → 알파: 변이 시험이 재사용
    async function assertWeekGrouped(m) {
      const base = baseCal(m), bw = base.endwork.split('\n\n');
      await groupVia(m, [['베타', '알파']]);
      const o = m.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)');
      assert.strictEqual(o.content, '[알파] : 4.5\n[감마] : 0.5\n[델타]\n[알 파]\n-----\n합계 : 5', '과제투입시간과 합계가 묶음 뒤 값이 아니다');
      assert.strictEqual(o.planwork, '[알파]\n[감마]\n[델타]\n[알 파]', '차주계획 머리 줄에 묶인 과제가 남았다');
      assert.strictEqual(o.endwork, [bw[0] + `\n${NBS.repeat(4)}- 베타\n${NBS.repeat(6)}- 고객 회신`, bw[2], bw[3], bw[4]].join('\n\n'), '진행사항에 묶인 과제 줄(이름 줄 + 한 단계 더)이 없다');
      assert.strictEqual(o.subject, base.subject);
      const cap = sendW(m);
      assert.deepStrictEqual(cap.fields, { sdate: MON, edate: SUN, subject: o.subject, content: o.content, endwork: o.endwork, planwork: o.planwork }, '실제 채우기 네 칸이 묶음 결과와 다르다');
      const cp = m.ev('buildReportText()');
      assert.ok(cp.includes(`${NB.repeat(4)}- 베타\n${NB.repeat(6)}- 고객 회신\n\n[감마]`) && !cp.includes('[베타]'), '주간 복사에 묶음이 반영되지 않았다');
      assert.deepStrictEqual(wTop(m), ['알파', '감마', '델타', '알파#c-a2'], '묶인 베타가 머리 카드로 남았다');
      assert.deepStrictEqual(wSubs(m, '알파'), ['베타'], '베타가 알파 카드 안에 없다');
      assert.strictEqual(wcard(m, '알파').querySelector('.rcard-gsum').textContent, '합계 4.5 h', '주간 대상 카드에 합계가 없다');
      assert.strictEqual(wcard(m, '베타').querySelector('.rcard-wh').textContent, '이번 주 1 h', '묶인 작은 카드의 이번 주 시간');
      assert.ok(m.ev("$('#rptSummary').textContent").includes(', 묶은 과제 1개'), '주간 요약줄에 "묶은 과제 1개" 가 없다');
      setView(m, 'doc');
      assert.strictEqual(m.ev("$('#rptOut .rwd-hours').textContent"), o.content, '글 편집 과제투입시간이 묶음 뒤 값이 아니다');
      assert.ok(!m.ev("[].some.call(document.querySelectorAll('#rptOut [data-wsec]'), function(x){ return x.dataset.wk === '베타'; })"), '묶인 과제에 진행사항이나 차주계획 칸이 있다');
      const sec = m.ev("[].find.call(document.querySelectorAll('#rptOut .rdoc-sec'), function(s){ return s.dataset.wsec === 'prog' && s.dataset.wk === '알파'; })");
      assert.strictEqual(sec.querySelector('.rdoc-grp').textContent, '베타 묶음');
      assert.ok(sec.querySelector('.rdoc-ta').value.endsWith('\n    - 베타\n      - 고객 회신'), '주간 글 편집 초안에 묶인 과제 줄이 없다');
      setView(m, 'card');
    }
    test('GW2 (§3): 주간(캘린더) 묶음: 과제투입시간과 합계, 진행사항(이름 줄 + 한 단계 더), 차주계획 머리 줄, 복사, 카드, 글 편집', async () => {
      wfresh();
      try { await assertWeekGrouped(B); } finally { done(); }
    });

    test('GW3 (§3, §5): 주간: X(대상은 묶음 전체, 작은 카드는 그 과제만), 기간별 임시 저장(묶음만으로 키, 다른 주는 묶음 없음), 모두 초안으로', async () => {
      wfresh();
      try {
        await groupVia(B, [['베타', '알파'], ['감마', '알파']]);
        const K = WKEY();
        assert.deepStrictEqual(allKeys(B, 'tc_rptDraft'), [K], '주간 묶음만으로 그 기간 키가 생기지 않았다');
        assert.deepStrictEqual(getStored(B, K).group, { '베타': '알파', '감마': '알파' });
        wcard(B, '감마').querySelector('.rcard-x').click();
        let o = B.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)');
        assert.ok(o.content.startsWith('[알파] : 4.5\n[델타]') && o.content.endsWith('합계 : 4.5') && !o.endwork.includes('감마'), '작은 카드 X 뒤 그 과제 시간과 줄만 빠지지 않았다: ' + o.content);
        wcard(B, '알파').querySelector('.rcard-x').click();
        o = B.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)');
        assert.ok(!/알파\]|베타|감마/.test(o.endwork.replace('[알 파]', '')) && o.content === '[델타]\n[알 파]\n-----\n합계 : 0' && o.planwork === '[델타]\n[알 파]', '대상 X 뒤에도 묶음이 남았다: ' + JSON.stringify(o));
        wcard(B, '알파').querySelector('.rcard-back').click();
        setWeek(B, MON2);
        assert.ok(!B.ev("document.querySelector('#rptOut .rcard-subs')") && B.ev("$('#rptGroupSum').textContent") === '묶은 과제 없음', '다른 주가 묶음 없이 시작하지 않는다');
        assert.deepStrictEqual(allKeys(B, 'tc_rptDraft'), [K], '다른 주 키가 렌더만으로 생겼다');
        setWeek(B, MON);
        assert.deepStrictEqual(wSubs(B, '알파'), ['베타', '감마'], '주를 오가자 묶음이 사라졌다');
        setView(B, 'doc');
        B.doc.querySelector('#rptOut .rdoc-resetall').click();
        await confirmOk(B, '묶음');
        assert.deepStrictEqual(allKeys(B, 'tc_rptDraft'), [], '주간 "모두 초안으로" 뒤에도 키가 남았다');
        assert.deepStrictEqual(B.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)'), baseCal(B), '"모두 초안으로" 뒤 네 칸이 예전과 같지 않다');
      } finally { done(); }
    });

    test('GW9 (§4): 주간 설정 창: "이번 주 내용 없는 과제", 이번 주 업무와 시간(묶인 과제까지 더한 머리 줄), 끌어 넣기와 밖에 놓아 풀기', async () => {
      wfresh();
      try {
        await openDlg(B);
        assert.deepStrictEqual(groupsOf(B), [['알파'], ['베타'], ['감마'], ['알파#c-a2']], '주간 설정 창 순서나 접기가 다르다(빈 델타는 접힌다)');
        assert.strictEqual(B.doc.querySelector('#rgmRows .rgm-more').textContent, '이번 주 내용 없는 과제 1개보기', '주간 문구가 "이번 주 내용 없는 과제" 가 아니다');
        const nA = B.ev("collectReportData($('#rptFrom').value, $('#rptTo').value, rptSources()).rows.find(function(r){ return r.key === 'c-a'; }).titles.length");
        assert.ok(nA > 0, '전제: 알파에 이번 주 업무 줄이 있다');
        assert.strictEqual(rowEl(B, '알파').querySelector('.rgm-meta').textContent, `업무 ${nA}건, 3.5시간`, '주간 알파 줄의 업무와 시간이 다르다');
        assert.strictEqual(rowEl(B, '감마').querySelector('.rgm-meta').textContent, '0.5시간', '시간만 있는 감마 줄은 시간만 보여야 한다');
        dragTo(B, '베타', rowEl(B, '알파'));
        assert.deepStrictEqual(getStored(B, WKEY()).group, { '베타': '알파' }, '주간: 끌어 넣기가 기간 키에 묶음을 쓰지 않았다');
        assert.strictEqual(rowEl(B, '알파').querySelector('.rgm-meta').textContent, `업무 ${nA + 1}건, 4.5시간`, '주간 머리 줄이 묶인 과제까지 더한 값이 아니다');
        assert.ok(B.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)').content.startsWith('[알파] : 4.5\n'), '주간 과제투입시간에 끌어 넣은 묶음이 들어가지 않았다');
        dragTo(B, '베타', dlgHead(B));
        assert.deepStrictEqual(allKeys(B, 'tc_rptDraft'), [], '주간: 밖에 놓아 다 풀었는데 키가 남았다');
        await closeDlg(B);
      } finally { delete B.doc.elementFromPoint; done(); }
    });

    //  리뷰 정정(주간 캘린더): 고친 대상 카드 안내(1), 빈 대상 살리기(2), 묶인 과제의 쉬는 고친 글은 "고친 과제" 로 세지 않음(4) — 변이 시험이 재사용
    async function assertWeekReview(m) {
      setView(m, 'doc');
      const typeW = (wsec, k, text) => { const t = m.ev(`[].find.call(document.querySelectorAll('#rptOut textarea[data-wsec]'), function(t){ return t.dataset.wsec === ${JSON.stringify(wsec)} && t.dataset.wk === ${JSON.stringify(k)}; })`); t.value = text; t.dispatchEvent(new m.w.Event('input', { bubbles: true })); };
      typeW('prog', '알파', '• 알파 주간 고친 글');
      typeW('prog', '베타', '• 베타 주간 고친 글');
      assert.ok(m.ev("$('#rptEditInfo').textContent").includes('고친 과제 2개'), '전제: 고친 과제 2개');
      await groupVia(m, [['베타', '알파']]);
      assert.ok(m.ev("$('#rptEditInfo').textContent").includes('고친 과제 1개'), '묶인 베타의 쉬는 고친 글을 "고친 과제" 로 센다: ' + m.ev("$('#rptEditInfo').textContent"));
      setView(m, 'card');
      const n = wcard(m, '알파').querySelector('.rcard-gstale');
      assert.ok(n && n.textContent.startsWith('고친 글에 묶은 과제 줄이 없습니다'), '주간 고친 대상 카드에 묶음 안내가 없다');
      //  빈 델타로 감마를 묶고 내용 없는 항목 제외를 켜도 델타가 남는다
      await groupVia(m, [['감마', '델타']]);
      m.ev("$('#rptSkipEmpty').checked = true; $('#rptSkipEmpty').dispatchEvent(new Event('change'));");
      try {
        assert.deepStrictEqual(wSubs(m, '델타'), ['감마'], '주간: 내용 없는 항목 제외를 켜자 빈 대상 델타가 빠졌다');
        assert.ok(m.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)').content.includes('[델타] : 0.5'), '주간: 빈 대상 델타 시간이 나가지 않는다');
      } finally { m.ev("$('#rptSkipEmpty').checked = false; $('#rptSkipEmpty').dispatchEvent(new Event('change'));"); }
    }
    test('GW7 (리뷰 정정 1, 2, 4): 주간 — 고친 대상 카드 안내, 빈 대상 살리기, 묶인 과제의 쉬는 고친 글은 "고친 과제" 로 세지 않음', async () => {
      wfresh();
      try { await assertWeekReview(B); } finally { done(); }
    });
    test('변이 GWM6: 주간 고친 과제 셈에서 묶인 과제를 거르지 않거나 카드 안내를 빼면 GW7 이 잡는다', async () => {
      for (const [bad, re] of [
        [mutate(app, '.filter(k => !grp.has(k));   // 고친 과제', ';   // 고친 과제'), /고친 과제/],
        [mutate(app, "        : !!(_gw && _gw.kidNames && _gw.kidNames.length && rptWStale(_wd, _w.k, 'cal', _gw.draft));", '        : false;'), /묶음 안내가 없다/],
      ]) {
        const X = bootBrowser(bad);
        try { X.ev('state = ' + JSON.stringify(weekState()) + ';'); openWeekly(X, MON); setView(X, 'card'); await assert.rejects(() => assertWeekReview(X), re); }
        finally { clearDrafts(X); await X.close(); }
      }
    });

    test('변이 GWM1: 주간 네 칸에서 묶음이 과제투입시간을 다시 내지 않으면 GW2 가 잡는다', async () => {
      const bad = mutate(app, 'content: (L.out.length || L.group.length) ? c.content : base.content,', 'content: L.out.length ? c.content : base.content,');
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(weekState()) + ';'); openWeekly(X, MON); setView(X, 'card'); await assert.rejects(() => assertWeekGrouped(X), /과제투입시간과 합계/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GWM2: 주간 조립이 묶음을 적용하지 않으면 GW2 가 잡는다', async () => {
      const bad = mutate(app, "  M = rptWGroupModel(M, d);   // 보고서 묶음: 묶인 행은 빠지고 대상의 본문과 시간이 합쳐진다(묶음이 없으면 M 그대로)\n", '');
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(weekState()) + ';'); openWeekly(X, MON); setView(X, 'card'); await assert.rejects(() => assertWeekGrouped(X), /묶음 뒤 값이 아니다|남았다/); }
      finally { clearDrafts(X); await X.close(); }
    });
    test('변이 GWM3: 낡은 묶음 흔적을 거르지 않으면 GW1 이 잡는다', async () => {
      const bad = mutate(app, ' && group[k] !== k && ks.has(group[k])) cand.set', ' && group[k] !== k) cand.set');
      const X = bootBrowser(bad);
      try { X.ev('state = ' + JSON.stringify(weekState()) + ';'); openWeekly(X, MON); setView(X, 'card'); await assert.rejects(() => assertWeekSame(X)); }
      finally { clearDrafts(X); await X.close(); }
    });
  }

  // ── (W) 위젯 모드 ──────────────────────────────────────────────────
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  async function widgetDaily(src) {
    const M = bootWidget(src);
    const T = M.ev('todayYmd()'), Y = M.ev('addDays(todayYmd(), -1)'), N = M.ev('addDays(todayYmd(), 1)');
    clearDrafts(M);
    M.ev('__applyState(' + JSON.stringify(JSON.stringify(dayState(T, Y, N))) + ',' + JSON.stringify(META) + ')');
    await tick();
    openDaily(M, T);
    return { M, T, KEY: 'tc_rptDraft:7:' + T };
  }
  async function groupAndSend(M) {
    await groupVia(M, [['c-b', 'c-a']]);
    M.ev('window.__cap = null; Platform.report.submitDaily = function(p){ window.__cap = JSON.parse(JSON.stringify(p)); };');
    M.doc.getElementById('btnRptSend').click();
    await confirmOk(M);
    const cap = M.evJSON('window.__cap');
    assert.ok(cap, '확인 뒤 전송 payload 가 나가지 않았다');
    M.ev('clearTimeout(Netcus.watchdog)');
    return cap;
  }
  //  보낸 뒤 묶음을 바꾸면 성공 회신이 지우지 않는다(서명에 묶음이 들어 있다): 변이 시험이 재사용
  async function changedAfterSendKept(M, KEY) {
    await groupAndSend(M);
    await groupVia(M, [['c-c', 'c-a']]);
    M.ev("window.__netcusResult(true, '회사 일간보고 전송 완료(시험)')");
    M.ev('rptDraftFlush()');
    assert.ok(allKeys(M, 'tc_rptDraft').includes(KEY), '보낸 뒤 바꾼 묶음까지 성공 회신이 지웠다');
    assert.deepStrictEqual(M.evJSON(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).group`), { 'c-b': 'c-a', 'c-c': 'c-a' });
  }
  test('GW4 (§5): 위젯 일간 전송: payload 는 묶음 뒤 값(hours = 머리 줄)이고 성공 회신이면 묶음까지 지운다', async () => {
    const { M, KEY } = await widgetDaily(app);
    try {
      const cap = await groupAndSend(M);
      assert.ok(cap.fields.content.startsWith('[알파] : 3.5\n') && !cap.fields.content.includes('[베타]'), '전송 content 에 묶음이 반영되지 않았다');
      assert.deepStrictEqual(cap.hours, headHours(cap.fields.content), 'payload.hours 가 머리 줄과 다르다');
      assert.deepStrictEqual(cap.hours, [{ name: '알파', hours: 3.5 }, { name: '감마', hours: 1 }]);
      assert.ok(allKeys(M, 'tc_rptDraft').includes(KEY), '전제: 회신 전에는 묶음 저장본이 있다');
      M.ev("window.__netcusResult(false, '전송 실패(시험)')");
      assert.ok(allKeys(M, 'tc_rptDraft').includes(KEY), '실패 회신이 묶음을 지웠다');
      await groupAndSend(M);
      M.ev("window.__netcusResult(true, '회사 일간보고 전송 완료(시험)')");
      assert.ok(!allKeys(M, 'tc_rptDraft').includes(KEY), '성공 회신인데 묶음 저장본이 남았다');
      assert.ok(!M.ev("document.querySelector('#rptOut .rcard-subs')"), '지운 뒤에도 미리보기가 묶음을 보인다');
    } finally { clearDrafts(M); await M.close(); }
  });
  test('GW5 (§5): 전송을 누른 뒤 회신 전에 묶음을 바꾸면 성공 회신이 지우지 않는다', async () => {
    const { M, KEY } = await widgetDaily(app);
    try { await changedAfterSendKept(M, KEY); } finally { clearDrafts(M); await M.close(); }
  });
  test('변이 GWM4: 초안 서명에서 묶음을 빼면 GW5 가 잡는다', async () => {
    const bad = mutate(app, "  return JSON.stringify({ body, out: [...((d && d.out) || [])].sort(), group });", "  return JSON.stringify({ body, out: [...((d && d.out) || [])].sort() });");
    const { M, KEY } = await widgetDaily(bad);
    try { await assert.rejects(() => changedAfterSendKept(M, KEY), /보낸 뒤 바꾼 묶음/); } finally { clearDrafts(M); await M.close(); }
  });

  //  주간 net 출처: 바이트 같음(낡은 흔적) + 묶음(미등록과제 → 베타). net 본문은 원문 줄이라 이름 줄에 들여쓰기가 없다.
  const MONn = '2026-07-13', SUNn = '2026-07-19';
  const NET_DAYS = [
    { date: MONn, content: '[알파] : 2\n• 로그인 리뷰\n    - UI 확인\n[베타]\n• 고객 회신', ok: true },
    { date: '2026-07-14', content: '선행 메모\n[알파] : 1.5\n• 로그인 리뷰\n• 추가 작업\n[미등록과제] : 1\n탐색', ok: true },
  ];
  async function widgetNet(src) {
    const M = bootWidget(src);
    clearDrafts(M);
    const st = { categories: [
      { id: 'c-a', name: '알파', color: '#3e5be0', desc: '', createdAt: CA },
      { id: 'c-b', name: '베타', color: '#2e9e6b', desc: '', createdAt: CA }],
      entries: [], todos: [], rooms: [], attendance: {}, taskHours: {}, reportMarker: '-', reportMarkerCustom: '', reportIndent: 2,
      reportFormatPrefs: { daily: { marker: '-', markerCustom: '', indent: 2 }, weekly: { marker: '-', markerCustom: '', indent: 2 } } };
    M.ev('__applyState(' + JSON.stringify(JSON.stringify(st)) + ',' + JSON.stringify(META) + ')');
    await tick();
    M.ev(`openReport(); setReportMode('weekly'); $('#rptFrom').value = ${JSON.stringify(MONn)}; $('#rptFrom').dispatchEvent(new Event('change'));`);
    setView(M, 'card');
    M.ev(`netcusMerge = { key: ncMergeKey(${JSON.stringify(MONn)}, ${JSON.stringify(SUNn)}), parsed: parseNetcusWeek(${JSON.stringify(NET_DAYS)}, state.categories, { sumTime: true }), at: '09:00' }; state.reportSource = 'net'; syncReportSourceSeg(); buildReport();`);
    return M;
  }
  const netBase = (m) => m.evJSON('(function(){ var p = netcusMerge.parsed; return { content: buildNetcusHoursText(p), endwork: buildNetcusSendText(p), planwork: buildNetcusPlanText(p), subject: weekSubjectGuess($("#rptFrom").value) }; })()');
  function sendWN(m) { m.ev('window.__capW = null; Platform.report.submitWeekly = function(p){ window.__capW = JSON.parse(JSON.stringify(p)); };'); m.doc.getElementById('btnRptSend').click(); m.ev('clearTimeout(Netcus.watchdog)'); return m.evJSON('window.__capW'); }
  async function assertNetGrouped(M) {
    const base = netBase(M);
    assert.deepStrictEqual(M.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)'), base, 'net: 묶음 없을 때 네 칸이 netcus 조립과 다르다');
    assert.strictEqual(M.ev('buildReportText()'), base.endwork, 'net: 묶음 없을 때 복사가 다르다');
    M.ev(`localStorage.setItem(rptWKey(${JSON.stringify(MONn)}, ${JSON.stringify(SUNn)}), JSON.stringify({ v:1, from:${JSON.stringify(MONn)}, to:${JSON.stringify(SUNn)}, prog:{}, progBase:{}, progBaseSrc:{}, plan:{}, out:[], group:{ '@미분류':'알파', '없음':'베타' }, savedAt:'' })); __rptDraftMem.clear(); __rptDraftDirty.clear(); buildReport();`);
    assert.deepStrictEqual(M.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)'), base, 'net: 미분류나 없는 이름을 가리키는 묶음 흔적이 네 칸을 바꿨다');
    let cap = sendWN(M);
    assert.deepStrictEqual(cap && cap.fields, { sdate: MONn, edate: SUNn, subject: base.subject, content: base.content, endwork: base.endwork, planwork: base.planwork }, 'net: 실제 채우기가 예전과 다르다');
    await openDlg(M);
    showEmpty(M);
    assert.ok(!rowEl(M, '@미분류') && !(menuOf(M, '알파') || []).includes('@미분류'), '미분류가 묶음 설정에 있다(과제가 아니다)');
    pick(M, '미등록과제', '베타'); await closeDlg(M);
    const o = M.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)');
    assert.strictEqual(o.content, '[알파] : 3.5\n[베타] : 1\n-----\n합계 : 4.5', 'net 과제투입시간과 합계가 묶음 뒤 값이 아니다');
    assert.strictEqual(o.planwork, '[알파]\n[베타]', 'net 차주계획에 묶인 과제가 남았다');
    assert.strictEqual(o.endwork, '[알파]\n• 로그인 리뷰\n- UI 확인\n• 추가 작업\n\n[베타]\n• 고객 회신\n- 미등록과제\n' + NBS.repeat(2) + '탐색\n\n[미분류]\n선행 메모', 'net 진행사항에 묶인 과제 줄이 없다: ' + JSON.stringify(o.endwork));
    cap = sendWN(M);
    assert.deepStrictEqual(cap.fields.content, o.content);
    assert.deepStrictEqual(M.evJSON("[].map.call(document.querySelectorAll('#rptOut > .rcard'), function(c){ return c.dataset.wk; })"), ['알파', '베타', '@미분류'], 'net 카드에서 묶인 과제가 머리 카드로 남았다');
    assert.strictEqual(M.ev("[].find.call(document.querySelectorAll('#rptOut > .rcard'), function(c){ return c.dataset.wk === '베타'; }).querySelector('.rcard-subs > .rcard').dataset.wk"), '미등록과제');
    assert.ok(M.ev("$('#rptSummary').textContent").includes('묶은 과제 1개'), 'net 요약줄에 "묶은 과제 1개" 가 없다');
  }
  test('GW6 (§2, §3): 주간 net 출처: 묶음이 없으면(흔적만 있어도) 바이트 같고, 묶으면 과제투입시간, 합계, 진행사항, 차주계획, 카드가 묶음을 따른다, 미분류는 묶지 않는다', async () => {
    const M = await widgetNet(app);
    try { await assertNetGrouped(M); } finally { clearDrafts(M); await M.close(); }
  });
  //  리뷰 정정 1(net): 고친 대상 카드 안내 — 변이 시험이 재사용
  async function assertNetStale(M) {
    setView(M, 'doc');
    const t = M.ev("[].find.call(document.querySelectorAll('#rptOut textarea[data-wsec]'), function(t){ return t.dataset.wsec === 'prog' && t.dataset.wk === '베타'; })");
    t.value = '• 베타 넷 고친 글'; t.dispatchEvent(new M.w.Event('input', { bubbles: true }));
    setView(M, 'card');
    const card = () => M.ev("[].find.call(document.querySelectorAll('#rptOut > .rcard'), function(c){ return c.dataset.wk === '베타'; })");
    assert.ok(!card().querySelector('.rcard-gstale'), '묶기 전에는 안내가 없어야 한다');
    await groupVia(M, [['미등록과제', '베타']]);
    assert.ok(card().querySelector('.rcard-gstale'), 'net 고친 대상 카드에 묶음 안내가 없다');
    assert.ok(M.evJSON('rptWOutFields($("#rptFrom").value, $("#rptTo").value)').endwork.includes('[베타]\n• 베타 넷 고친 글\n\n'), '안내가 고친 글을 덮었다');
  }
  test('GW8 (리뷰 정정 1): 주간 net — 대상을 고친 뒤 묶으면 카드에 묶음 안내', async () => {
    const M = await widgetNet(app);
    try { await assertNetStale(M); } finally { clearDrafts(M); await M.close(); }
  });
  test('변이 GWM7: net 카드 묶음 안내를 빼면 GW8 이 잡는다', async () => {
    const bad = mutate(app, "if(_gw && _gw.kidNames && _gw.kidNames.length && rptWStale(_wd, _w.k, 'net', _gw.draft)) html +=", 'if(false) html +=');
    const M = await widgetNet(bad);
    try { await assert.rejects(() => assertNetStale(M), /안내가 없다/); } finally { clearDrafts(M); await M.close(); }
  });
  test('변이 GWM5: net 카드가 묶음을 무시하면 GW6 이 잡는다', async () => {
    const bad = mutate(app, "    if(_ngl && _ngl.has(_gk)) continue;   // 묶인 과제는 대상 카드 안에서 그린다\n", '');
    const M = await widgetNet(bad);
    try { await assert.rejects(() => assertNetGrouped(M), /머리 카드로 남았다/); } finally { clearDrafts(M); await M.close(); }
  });

  // ── (P) 열람 창 ─────────────────────────────────────────────────
  async function assertPeer(P) {
    assert.strictEqual(P.ev('PEER'), true);
    const T = P.ev('todayYmd()'), Y = P.ev('addDays(todayYmd(), -1)'), N = P.ev('addDays(todayYmd(), 1)');
    P.ev(`localStorage.setItem('tc_rptDraft:me:' + todayYmd(), JSON.stringify({ v:1, date: todayYmd(), body:{}, base:{}, out:[], group:{ 'c-b':'c-a' }, savedAt:'' }));`);
    P.ev("window.__acc = []; (function(){ var Pr = Storage.prototype; ['getItem','setItem','removeItem'].forEach(function(n){ var o = Pr[n]; Pr[n] = function(k){ if(String(k).indexOf('tc_rptDraft')===0) window.__acc.push(n+' '+k); return o.apply(this, arguments); }; }); var ok = Pr.key; Pr.key = function(){ window.__acc.push('key'); return ok.apply(this, arguments); }; })();");
    P.w.__applyState(JSON.stringify(dayState(T, Y, N)), { peerName: '홍길동', canWrite: false });
    await tick();
    P.ev(`reportMode = 'daily'; $('#rptFrom').value = todayYmd(); $('#rptTo').value = todayYmd(); ['#rptSrcEvent','#rptSrcTodo'].forEach(function(s){ $(s).checked = true; }); buildReport();`);
    assert.ok(P.ev("document.querySelectorAll('#rptOut .rcard').length") > 0, '전제: 열람 창에서 카드가 그려졌다');
    assert.ok(P.doc.getElementById('rptGroupRow').classList.contains('hidden'), '열람 창에 "보고서 묶음" 줄이 보인다');
    assert.ok(!P.ev("document.querySelector('#rptOut .rcard-subs')") && P.ev('buildReportText()').includes('[베타]'), '열람 창이 부모의 묶음을 읽어 적용했다');
    P.doc.getElementById('rptGroupOpen').click(); await tick();
    assert.ok(overlayClosed(P, 'rptGroupModal'), '열람 창에서 설정 창이 열렸다');
    assert.strictEqual(P.ev("rptGroupSet('c-b', 'c-a')"), false, '열람 창에서 묶음을 정할 수 있다');
    P.ev(`reportMode = 'weekly'; $('#rptFrom').value = '2026-07-13'; $('#rptTo').value = '2026-07-19'; buildReport();`);
    assert.ok(P.doc.getElementById('rptGroupRow').classList.contains('hidden'), '열람 창 주간에 "보고서 묶음" 줄이 보인다');
    assert.deepStrictEqual(P.evJSON('window.__acc'), [], '열람 창이 임시 저장(묶음)을 읽거나 썼다');
  }
  test('GP1 (§4, §5): 열람 창(PEER): "보고서 묶음" 줄과 설정 창이 없고 임시 저장 접근 0', async () => {
    const P = bootWidget(app, 'https://tcapp.local/?peer=1');
    try { await assertPeer(P); } finally { await P.close(); }
  });
  test('변이 GPM1: 묶음 문맥의 PEER 관문을 빼면 GP1 이 잡는다', async () => {
    const bad = mutate(app, "function rptGroupCtx(){\n  if(PEER) return null;\n", 'function rptGroupCtx(){\n');
    const P = bootWidget(bad, 'https://tcapp.local/?peer=1');
    try { await assert.rejects(() => assertPeer(P), /열람 창/); } finally { await P.close(); }
  });
}
