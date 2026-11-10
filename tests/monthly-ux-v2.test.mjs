// 근태 취합과 월간 보고 화면 시안 v4(docs/MONTHLY-UX-V2.md 끝 "v4 조정" 결정 14~21, 시안 dist/proto/monthly-ux-v4.html) 웹 쪽 시험.
//  v2(결정 1~13) 가운데 v4 가 바꾸지 않은 것(그림 1장, 양식 SW/HW, payload template, 텍스트 다이어트)도 여기서 본다.
//  2026-11-10 v6(결정 22~25, dist/proto/monthly-ux-v6.html): 과제별 글 탭, [서식], 복사, 글꼴을 없앴다(결정 22). 머리 줄에 주간보고 제목 넣기(결정 23),
//  미식별 콤보 처음 값 이름 미선택(결정 24). 탭을 오가던 시험은 '없음' 계약으로 바꿨다.
//
//   (S) 정적: 윗줄은 불러오기만(날짜 상자 없음, 결정 14), 결과 칸 머리 줄(보고서 양식 [SW|HW], 주간보고 제목 넣기, 작성, 계획, 저장, 결정 15, 23), 미선택 이름(결정 24),
//       띄움 칸 하나(role=dialog 아님, 결정 16), 계획 기본값 단추와 이름 줄 없음(결정 16, 19), 그림 1장, payload template, 양식 기억 없음, 텍스트 다이어트.
//   (W) jsdom 위젯 모드(지어낸 상태): 머리 줄(탭 없음), 띄움 칸 열고 닫기(바깥, 같은 글자, Esc), 기본값 계산(실적 끝 토, 금, 월, 일),
//       실적을 바꿔 읽으면 다시 계산, 손으로 고친 값은 같은 기간 다시 읽기에서 남음, 강조 전환(읽기 전후, class 만), 기타는 글 있는 것만,
//       왼쪽 상자는 늘 보임, 양식 전환, 그림 1장 흐름.
//   (M) 변이: 기본값 옛 규칙, 계획 ↺ 부활, 둘 다 강조, 날짜 상자를 윗줄로, template 빠짐, 그림 5장 등을 넣으면 위 검사가 잡는다.
// ★ 회사 사이트로 아무것도 보내지 않는다. 호스트 회신은 __hostReply 로 흉내 낸다. 과제와 사람 이름은 지어낸 (예시) 값이다.
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳이다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
const sumHtml = (src) => src.slice(src.indexOf('<div class="as-view hidden" id="atSum"'), src.indexOf('<div class="at-ed hidden" id="atEd"'));
const rptMCode = (src) => [...new Set([...src.matchAll(/\bfunction\s+(rptM\w+)\s*\(/g)].map((m) => m[1]))].map((n) => extractFunction(src, n)).join('\n');

// ── (S) 정적 ──────────────────────────────────────────────────────────────
function checkStatic(src) {
  const view = sumHtml(src);
  assert.ok(view.length > 1000, '취합 화면 마크업을 찾지 못했다');
  assert.ok(!/id="asLeft"|id="asBand"|data-atsplit="s"|as-split/.test(view), '왼쪽 패널, 끌개, 문서 설정 띠가 남았다(v2 결정 1, 3)');
  //  결정 14: 윗줄에 날짜 상자, 결과 형태, 주 단추, [서식]이 없다
  const top = /<div class="as-top" id="asTop">[\s\S]*?\n      <\/div>/.exec(view);
  assert.ok(top && !/<input|id="asOut"|id="rptmSave"|id="btnRptCopy"|id="asFmtBtn"/.test(top[0]) && top[0].includes('id="asActBtn"'), '윗줄이 불러오기만(실적 글자 단추, 출처, 읽어 오기)이 아니다');
  //  결정 15, 16, 19: 둘째 줄, 계획 기본값 단추, 이름 줄이 없다. 머리 줄에 보고서 양식 이름(2026-11-10 사용자 추가 요청)
  assert.ok(!/id="asDocBar"|id="rptmPlanDef"|id="rptmName"/.test(src) && !/rptmPlanDef|rptmName/.test(rptMCode(src)), '둘째 줄, 계획 기본값 단추, 이름 줄이 남았다');
  assert.ok(/<span class="rptm-lb">보고서 양식<\/span>\s*<div class="seg seg-auto" id="rptmTpl"/.test(view), '양식 세그 앞에 보고서 양식 이름이 없다');
  //  양식 세그 SW | HW, SW 가 처음 켜짐
  const tpl = /<div class="seg seg-auto" id="rptmTpl"[\s\S]*?<\/div>/.exec(view);
  assert.ok(tpl && [...tpl[0].matchAll(/data-tpl="(\w+)"/g)].map((m) => m[1]).join() === 'sw,hw' && /class="seg-b active" data-tpl="sw"/.test(tpl[0]), '양식 세그가 [SW | HW](처음 SW)가 아니다');
  //  결정 16: 띄움 칸 하나, role=dialog 아님(× 없는 내림 칸)
  assert.ok(/<div class="as-pop hidden" id="asPop">/.test(view) && (view.match(/data-aspk="/g) || []).length === 3, '띄움 칸 하나를 세 단추(실적, 작성, 계획)가 쓰지 않는다(서식은 v6 결정 22 로 없앴다)');
  //  v6 결정 22: 과제별 글 탭, [서식], 복사, 글꼴, 글 미리 보기가 없다
  assert.ok(!/id="(asOut|asFmtBtn|asFmt|btnRptCopy|rptFontRow|rptFontFamily|rptFontSize|asText|rptOut)"|data-aso=|data-pk="fmt"/.test(view), '과제별 글 탭, 서식, 복사, 글꼴이 남았다(v6 결정 22)');
  //  v6 결정 23: 머리 줄 순서 = 보고서 양식, 주간보고 제목 넣기, 작성, 계획, DOCX 저장
  const hd = view.slice(view.indexOf('<div class="as-head" id="asHead">'), view.indexOf('<div class="as-pane" id="asDoc">'));
  const pos = ['id="rptmTpl"', 'id="rptmWeekHead"', 'id="asDateBtn"', 'id="asPlanBtn"', 'id="rptmSave"'].map((k) => hd.indexOf(k));
  assert.ok(pos.every((x, k) => x > 0 && (!k || x > pos[k - 1])), '머리 줄이 보고서 양식, 주간보고 제목 넣기, 작성, 계획, DOCX 저장 순서가 아니다');
  assert.ok(/<label class="check as-wk"><input type="checkbox" id="rptmWeekHead" checked>주간보고 제목 넣기<\/label>/.test(hd), '주간보고 제목 넣기가 라벨 붙은 체크가 아니다');
  //  v6 결정 24: 미식별 콤보 처음 값 이름은 미선택(값은 빈 것)
  const unid = extractFunction(src, 'rptMRenderUnid');
  assert.ok(unid.includes('<option value="">미선택</option>') && !src.includes('<option value="">넣지 않음</option>'), '미식별 콤보 처음 값이 미선택이 아니다');
  //  결정 17: 계획 기본값은 다음 주 월요일 ~ 6주째 금요일, 작성일은 실적 끝
  assert.ok(/return \{ from: m, to: addDays\(m, 5 \* 7 \+ 4\) \};/.test(extractFunction(src, 'rptMPlanDefault')) && /\n    date: to,/.test(extractFunction(src, 'rptMFresh')), '기본값 규칙이 결정 17 이 아니다');
  //  그림 1장(v2 결정 8, 9)
  assert.ok(/const RPTM_IMG_MAX = 1;/.test(src), 'RPTM_IMG_MAX 가 1 이 아니다');
  const cmds = /const RPTM_HOST_CMDS = (\[[^\]]*\]);/.exec(src)[1];
  assert.ok(!cmds.includes('scheduleImageMove') && !/scheduleImageMove/.test(rptMCode(src)), '순서 바꾸기(scheduleImageMove)가 화면에 남았다');
  //  payload template(v2 결정 13)
  assert.ok(/template: __rptMTpl === 'hw' \? 'hw' : 'sw',/.test(extractFunction(src, 'rptMPayload')), 'payload 에 template 이 없다');
  //  양식은 기억하지 않는다(v2 결정 10): rptMOpen 이 SW 로 열고 저장소를 쓰지 않는다
  assert.ok(/__rptMTpl = 'sw'/.test(extractFunction(src, 'rptMOpen')), 'rptMOpen 이 양식을 SW 로 되돌리지 않는다');
  assert.ok(!/localStorage|sessionStorage/.test(extractFunction(src, 'rptMTplSet') + extractFunction(src, 'rptMTplUi')), '양식을 저장소에 기억한다');
  //  강조 전환은 class 와 hidden, disabled 만(결정 18): 다시 그리기를 부르지 않는다
  assert.ok(!/innerHTML|rptMRender|rptMPreview/.test(extractFunction(src, 'asStageSync')), '강조 전환이 다시 그린다');
  //  텍스트 다이어트(v2 결정 5~7): 빠진 문구가 화면 마크업과 월간 함수에 다시 생기지 않는다
  const text = view + rptMCode(src);
  for (const gone of ['기록 없음</span>', '>고르기<', '모두 넣음', '읽기 전용', '문서 설정', '나만 봅니다', '읽어 오기를 누르면', '고른 과제가 없습니다', '문서에 넣지 않음', "'개 넣음'", '과제마다 5장', '또는 Ctrl+V', '읽어 과제별로 모았습니다.\', \'ok\')', '로그인 이름 없음', 'rpt-chip'])
    assert.ok(!text.includes(gone), '빠진 문구가 다시 생겼다: ' + gone);
}
test('(S) 시안 v4, v6 정적 계약: 윗줄 불러오기만, 머리 줄(탭, 서식, 복사 없음, 주간보고 제목 넣기 자리)과 보고서 양식 이름, 미선택 이름, 띄움 칸 하나, 기본값 규칙, ↺와 이름 없음, 그림 1장, payload template, 양식 기억 없음, 텍스트 다이어트', () => checkStatic(app));
test('(M) 변이: 끌개, 날짜 상자를 윗줄로, ↺ 부활, 옛 기본값, 작성일 오늘, 보고서 양식 이름 빠짐, 그림 5장, 순서 명령, template 빠짐, 양식 기억, 기록 없음 글, 서식과 글꼴 되살림, 주간보고 제목 넣기 자리, 넣지 않음 이름을 넣으면 정적 계약이 잡는다', () => {
  const cases = [
    ['끌개', (s) => mutate(s, '<div class="as-main" id="asRight">', '<div class="at-split as-split" data-atsplit="s"></div><div class="as-main" id="asRight">')],
    ['날짜 상자를 윗줄로', (s) => mutate(s, '<button type="button" class="btn primary" id="asLoad">', '<input type="date" id="rptX"><button type="button" class="btn primary" id="asLoad">')],
    ['↺ 부활', (s) => mutate(s, '<input type="date" id="rptmPTo" aria-label="계획 기간 종료일">', '<input type="date" id="rptmPTo" aria-label="계획 기간 종료일"><button type="button" class="btn" id="rptmPlanDef">↺</button>')],
    ['옛 기본값', (s) => mutate(s, '  return { from: m, to: addDays(m, 5 * 7 + 4) };', '  const weeks = Math.max(1, Math.ceil(rptMDays(from, to) / 7));\n  return { from: m, to: addDays(m, weeks * 7 - 3) };')],
    ['작성일 오늘', (s) => mutate(s, '\n    date: to,', '\n    date: todayYmd(),')],
    ['보고서 양식 이름 빠짐', (s) => mutate(s, '<span class="rptm-lb">보고서 양식</span>\n', '')],
    ['그림 5장', (s) => mutate(s, 'const RPTM_IMG_MAX = 1;', 'const RPTM_IMG_MAX = 5;')],
    ['순서 명령', (s) => mutate(s, "'scheduleImageDelete', 'exportMonthlyDocx'", "'scheduleImageDelete', 'scheduleImageMove', 'exportMonthlyDocx'")],
    ['template 빠짐', (s) => mutate(s, "    template: __rptMTpl === 'hw' ? 'hw' : 'sw',\n", '')],
    ['양식 기억', (s) => mutate(s, '  __rptMTpl = v;\n', "  __rptMTpl = v;\n  try{ localStorage.setItem('tc_rptMTpl', v); }catch(_){}\n")],
    ['기록 없음 글', (s) => mutate(s, "    + (HOST ? `<span class=\"rptm-slotw", "    + '<span class=\"rptm-none\">기록 없음</span>'\n    + (HOST ? `<span class=\"rptm-slotw")],
    ['서식 단추 되살림', (s) => mutate(s, '            <span class="as-sp"></span>', '            <button type="button" class="btn" id="asFmtBtn" data-aspk="fmt">서식</button>\n            <span class="as-sp"></span>')],
    ['글꼴 되살림', (s) => mutate(s, '<span class="as-pk hidden" data-pk="date">', '<select id="rptFontFamily"></select><span class="as-pk hidden" data-pk="date">')],
    ['주간보고 제목 넣기를 계획 뒤로', (s) => mutate(mutate(s, '<label class="check as-wk"><input type="checkbox" id="rptmWeekHead" checked>주간보고 제목 넣기</label>', ''), '            <span class="as-sp"></span>', '<label class="check as-wk"><input type="checkbox" id="rptmWeekHead" checked>주간보고 제목 넣기</label>\n            <span class="as-sp"></span>')],
    ['넣지 않음 이름', (s) => mutate(s, '<option value="">미선택</option>', '<option value="">넣지 않음</option>')],
  ];
  for (const [name, f] of cases) {
    let caught = false;
    try { checkStatic(f(app)); } catch (_) { caught = true; }
    assert.ok(caught, '변이가 잡히지 않았다: ' + name);
  }
});

// ── (W) jsdom 위젯 모드 ────────────────────────────────────────────────────
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
if (!JSDOM) {
  skip('monthly-ux-v2: jsdom 미설치, 화면 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(pred, what, ms = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred()) return; await tick(); }
    assert.fail('시간 안에 일어나지 않았다: ' + what);
  }
  const U1 = 'bbbbbbbb-0000-4000-8000-000000000001', U2 = 'bbbbbbbb-0000-4000-8000-000000000002';
  const P1 = 'db-' + U1, P2 = 'db-' + U2;
  const ROWS = [
    { uid: U1, project_name: '(예시) 관측 장비 고도화', common_name: '', sectionId: 1, start_date: '2026-01-01', end_date: '2026-12-31', dev_start_date: '2026-03-02', dev_end_date: '2026-12-31' },
    { uid: U2, project_name: '(예시) 자료 수집 체계', common_name: '', sectionId: 1, start_date: '2026-01-01', end_date: '', dev_start_date: '2026-05-04', dev_end_date: '' },
  ];
  const CA = '2026-07-01T00:00:00.000Z';
  const cat = (id, name, source) => Object.assign({ id, name, color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }, source ? { source } : {});
  //  개인 과제 둘: c-etc 는 9월 주간보고에 글이 있고, c-none 은 없다(결정 20: 글 있는 것만 보인다)
  const CATS = [cat(P1, '(예시) 관측 장비 고도화', 'db'), cat(P2, '(예시) 자료 수집 체계', 'db'), cat('c-etc', '(예시) 사내 업무'), cat('c-none', '(예시) 글 없는 개인 과제')];
  const STATE = { gitAuthor: '', svnAuthor: '', categories: CATS, entries: [], todos: [], rooms: [], attendance: {} };
  const META = { schemaVersion: '17', expectedSchema: '17', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const FROM = '2026-09-01', TO = '2026-09-30';
  const WEEKS = [{ endwork: '[(예시) 관측 장비 고도화]\n  - 점검 항목 정리\n[(예시) 사내 업무]\n  - 회의 자료', content: '', title: '주간', period: '2026-09-07 ~ 2026-09-12', regdate: '2026-09-12' }];
  //  이 앱 주간보고 DB 흉내(캘린더 기록 출처의 reportWeeklyList 회신)
  const WK = (ps, pe, endwork) => ({ periodStart: ps, periodEnd: pe, subject: ps + ' 주간보고', content: '', endwork, plan: '', meeting: '', composedAt: ps + 'T09:00:00.000Z', hours: null });
  const WROWS = [WK('2026-09-07', '2026-09-12', WEEKS[0].endwork), WK('2026-10-12', '2026-10-17', '[(예시) 관측 장비 고도화]\n  - 시월 일')];
  const IMG = (id) => ({ id, seq: 1, mime: 'image/png', width: 640, height: 200, bytes: 1000, sha256: String(id).repeat(64).slice(0, 64), uploadedAt: '2026-10-02T05:10:00.000Z' });

  function boot(src) {
    const posted = [];
    const dom = new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: new jsdomMod.VirtualConsole(),
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); }, addEventListener() {}, removeEventListener() {} } };
        win.scrollTo = () => {}; win.HTMLElement.prototype.scrollIntoView = function () {};
      } });
    const w = dom.window;
    const M = { w, d: w.document, posted, answered: new Set(), ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')) };
    M.$ = (s) => M.d.querySelector(s);
    M.shown = (s) => { const e = M.d.querySelector(s); return !!e && !e.classList.contains('hidden'); };
    const sess = posted.find((x) => x && x.cmd === 'userSessionGet');
    if (sess) M.ev('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'tester', name: '(예시) 시험자' } }) + ')');
    M.ev('window.__toasts = []; (function(){ var t = toast; toast = function(m, k, a, ms){ __toasts.push(String(m)); return t(m, k, a, ms); }; })();');
    M.ev("window.__lsw = []; (function(){ var P = Storage.prototype, s = P.setItem; P.setItem = function(k, v){ __lsw.push(k); return s.call(this, k, v); }; })();");
    return M;
  }
  const pending = (m, cmd) => m.posted.filter((x) => x && x.cmd === cmd && x.reqId && !m.answered.has(x.reqId));
  function reply(m, cmd, res, pick) {
    const list = pending(m, cmd).filter(pick || (() => true));
    assert.ok(list.length, cmd + ' 요청이 없다');
    m.answered.add(list[0].reqId);
    m.ev('__hostReply(' + JSON.stringify(list[0].reqId) + ', ' + JSON.stringify(res) + ')');
    return list[0];
  }
  //  그림 목록: P1 은 빈 목록, P2 는 한 장. 썸네일은 data URL 하나
  function answerImages(m, p2has = true) {
    for (const x of pending(m, 'scheduleImageList')) reply(m, 'scheduleImageList', { ok: true, data: { projectUid: x.projectUid, images: x.projectUid === P2 && p2has ? [IMG(9)] : [], stale: false, notice: '' } }, (y) => y.reqId === x.reqId);
  }
  function answerThumbs(m) {
    for (const x of pending(m, 'scheduleImageThumb')) reply(m, 'scheduleImageThumb', { ok: true, data: { id: x.id, sha256: IMG(x.id).sha256, dataUrl: 'data:image/jpeg;base64,QUJD', width: 10, height: 4, stale: false } }, (y) => y.reqId === x.reqId);
  }
  //  캘린더 기록 읽기(나눠 읽기)에 모두 회신한다
  async function answerWeekly(m) {
    for (let n = 0; n < 40; n++) {
      await tick(5);
      const list = pending(m, 'reportWeeklyList');
      if (!list.length) { if (n > 1) break; continue; }
      for (const x of list) { m.answered.add(x.reqId); m.ev('__hostReply(' + JSON.stringify(x.reqId) + ', ' + JSON.stringify({ ok: true, rows: WROWS.filter((r) => r.periodStart >= x.from && r.periodStart <= x.to) }) + ')'); }
    }
    await tick();
    answerImages(m);
  }
  //  [읽어 오기] 누르기(지금 날짜 칸 값으로)
  async function load(m) { m.$('#asLoad').click(); await tick(); await answerWeekly(m); }
  const setDate = (m, id, v) => { const e = m.$('#' + id); e.value = v; e.dispatchEvent(new m.w.Event('change', { bubbles: true })); };
  //  취합을 열고(결과는 월간 보고 문서 하나), 9월 주간보고를 읽어 둔 상태(그릇에 직접 둔다), 두 과제 체크
  async function open(src = app) {
    const M = boot(src);
    M.ev('__applyState(' + JSON.stringify(JSON.stringify(STATE)) + ',' + JSON.stringify(META) + ')');
    M.ev('__applyProjects(' + JSON.stringify(JSON.stringify(ROWS)) + ')');
    await tick();
    M.ev('state.categories = ' + JSON.stringify(CATS) + ';');
    M.ev("pcSetTab('attend'); atKindSet('sum'); atSumInit();");
    M.ev(`$('#rptFrom').value = '${FROM}'; $('#rptTo').value = '${TO}'; atSumPeriod();`);
    M.ev(`rptMStoreRead('cal', '${FROM}', '${TO}', parseNetcusWeekly(${JSON.stringify(WEEKS)}, state.categories), 1); __rptM.fillSrc = 'cal'; __rptMHas = rptMHasSet(__rptM); __rptM.checked[${JSON.stringify(P1)}] = true; __rptM.checked[${JSON.stringify(P2)}] = true;`);
    M.ev('rptMRenderAll();');
    await tick();
    answerImages(M); await tick(); answerThumbs(M); await tick();
    return M;
  }
  const row = (m, uid) => [...m.d.querySelectorAll('#rptmPick .rptm-it[data-uid]')].find((r) => r.dataset.uid === uid) || null;
  const ctrlV = (m, el) => el.dispatchEvent(new m.w.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  const visPrimary = (m) => [...m.d.querySelectorAll('#atSum .btn.primary')].filter((b) => !b.closest('.hidden')).map((b) => b.id);

  //  예전 기대(v4 결정 15, 21): 결과 칸 맨 위 탭(과제별 글 | 월간 보고 문서)을 오가면 머리 줄이 [서식], 복사로 바뀌고 상자가 숨었다. v6 결정 22 로 탭이 없다.
  test('(W) 결정 15, 21, v6 결정 22: 결과 칸은 탭 없이 머리 줄(보고서 양식 [SW|HW], 주간보고 제목 넣기, 작성, 계획, 오른쪽 끝 DOCX 저장)과 문서, 왼쪽 상자는 늘 보인다', async () => {
    const M = await open();
    try {
      assert.ok(!M.$('#asOut') && !M.$('#asFmtBtn') && !M.$('#btnRptCopy') && !M.$('#asText') && !M.$('#rptFontRow'), '탭, 서식, 복사, 글 미리 보기, 글꼴이 남았다');
      assert.ok(M.shown('#asDocHead') && M.shown('#asDocAct') && M.shown('#asBoxes') && M.shown('#asDoc'), '머리 줄, 저장, 상자, 문서가 늘 보이지 않는다');
      assert.strictEqual(M.$('#asDocHead .rptm-lb').textContent, '보고서 양식', '양식 세그 앞 이름이 보고서 양식이 아니다');
      assert.ok(M.$('#asDocHead .rptm-lb').nextElementSibling === M.$('#rptmTpl'), '보고서 양식 이름이 세그 바로 앞이 아니다');
      assert.ok(M.$('#rptmTpl').nextElementSibling === M.$('#rptmWeekHead').closest('label') && M.$('#rptmWeekHead').closest('label').nextElementSibling === M.$('#asDateBtn'), '주간보고 제목 넣기가 양식 세그 다음, 작성 앞이 아니다');
      assert.deepStrictEqual([M.$('#asActTxt').textContent, M.$('#asDateTxt').textContent, M.$('#asPlanTxt').textContent], ['9/1 ~ 9/30', '9월 30일', '10/5 ~ 11/13'], '글자 단추 값이 실적, 작성(실적 끝), 계획(다음 주 월 ~ 6주째 금)이 아니다');
      assert.ok(!M.$('#asRight').classList.contains('doc') && M.w.getComputedStyle(M.$('#asRight')).display === 'grid', '두 칸 격자가 늘 있지 않다(.doc 전환이 남았다)');
      assert.ok(!M.$('#rptmName') && !M.$('#asDocBar'), '이름 줄이나 둘째 줄이 있다(결정 19, 15)');
      //  ✓ n주: 읽기 결과 표시(풍선에 원래 문장)
      M.ev("rptMSrcMsg('3주', 'ok', '주간보고 기록 3주를 읽어 과제별로 모았습니다.')");
      assert.ok(M.$('#rptmSrcMsg').textContent === '3주' && M.$('#rptmSrcMsg svg') && M.$('#rptmSrcMsg').title.startsWith('주간보고 기록 3주'), '읽은 결과가 ✓ n주(풍선)가 아니다');
      M.ev("rptMSrcMsg('주간보고 기록을 읽지 못했습니다.', 'err')");
      assert.ok(M.$('#rptmSrcMsg').textContent === '주간보고 기록을 읽지 못했습니다.' && !M.$('#rptmSrcMsg svg') && !M.$('#rptmSrcMsg').title, '실패가 글로 보이지 않는다');
    } finally { M.w.close(); }
  });

  test('(W) 결정 16: 띄움 칸 하나. 실적, 작성, 계획 단추가 같은 칸을 열고(그 칸만 보임), 같은 단추 다시 누르기, 바깥 누르기, Esc 로 닫힌다. HW 로 바꾸면 닫힌다(서식 칸은 v6 결정 22 로 없앴다)', async () => {
    const M = await open();
    try {
      const pop = M.$('#asPop');
      const openK = () => (M.shown('#asPop') ? [...pop.querySelectorAll('[data-pk]')].filter((e) => !e.classList.contains('hidden')).map((e) => e.dataset.pk) : []);
      const exp = () => [...M.d.querySelectorAll('#atSum [data-aspk]')].filter((b) => b.getAttribute('aria-expanded') === 'true').map((b) => b.dataset.aspk);
      assert.deepStrictEqual(openK(), [], '처음부터 열려 있다');
      assert.ok(pop.closest('#atSum') && pop.parentElement !== M.d.body && pop.getAttribute('role') !== 'dialog', '띄움 칸이 취합 화면 밖에 있거나 role=dialog 다');
      for (const [btn, k, ids] of [['#asActBtn', 'act', ['rptFrom', 'rptTo']], ['#asDateBtn', 'date', ['rptmDate']], ['#asPlanBtn', 'plan', ['rptmPFrom', 'rptmPTo']]]) {
        M.$(btn).click();
        assert.deepStrictEqual([openK(), exp()], [[k], [k]], btn + ' 가 자기 칸 하나를 열지 않는다');
        assert.ok(ids.every((id) => pop.querySelector('[data-pk="' + k + '"]').contains(M.$('#' + id))), btn + ' 칸에 날짜 칸이 없다');
        M.$(btn).click();
        assert.deepStrictEqual([openK(), exp()], [[], []], btn + ' 를 다시 눌러도 닫히지 않는다');
      }
      //  다른 단추로 옮기면 칸 내용만 바뀐다
      M.$('#asActBtn').click(); M.$('#asDateBtn').click();
      assert.deepStrictEqual([openK(), exp()], [['date'], ['date']], '다른 단추를 누르면 그 칸으로 바뀌어야 한다');
      //  칸 안 누르기는 그대로, 바깥 누르기는 닫힘
      M.$('#rptmDate').dispatchEvent(new M.w.MouseEvent('mousedown', { bubbles: true }));
      assert.deepStrictEqual(openK(), ['date'], '칸 안을 누르니 닫혔다');
      M.$('#rptmSheet').dispatchEvent(new M.w.MouseEvent('mousedown', { bubbles: true }));
      assert.deepStrictEqual([openK(), exp()], [[], []], '바깥을 눌러도 닫히지 않는다');
      //  Esc 는 닫고 연 단추로 포커스
      M.$('#asPlanBtn').click();
      M.$('#rptmPFrom').focus();
      M.d.dispatchEvent(new M.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.ok(!M.shown('#asPop') && M.d.activeElement === M.$('#asPlanBtn'), 'Esc 로 닫히지 않거나 포커스가 연 단추로 돌아오지 않았다');
      //  날짜를 고르면 글자 단추 값이 바로 바뀐다
      M.$('#asDateBtn').click(); setDate(M, 'rptmDate', '2026-10-06');
      assert.strictEqual(M.$('#asDateTxt').textContent, '10월 6일', '작성일을 골랐는데 글자가 바뀌지 않았다');
      assert.ok(M.shown('#asPop'), '날짜를 고르니 칸이 닫혔다');
      //  HW 로 바꾸면 계획 단추가 숨고 열린 계획 칸이 닫힌다
      M.$('#asDateBtn').click(); M.$('#asPlanBtn').click();
      M.$('#rptmTpl [data-tpl="hw"]').click(); await tick();
      assert.ok(!M.shown('#asPlanBtn') && !M.shown('#asPop'), 'HW 인데 계획 단추나 계획 칸이 남았다');
      M.$('#rptmTpl [data-tpl="sw"]').click(); await tick();
    } finally { M.w.close(); }
  });

  //  기본값 검사기(변이가 같은 검사기를 부른다)
  function checkDefaults(M) {
    const pd = (f, t) => M.evJSON(`rptMPlanDefault('${f}', '${t}')`);
    //  실적 끝 토(10/31), 금(10/30), 일(11/01)이면 다음 주 월 11/02 ~ 6주째 금 12/11. 월(11/02)이면 그다음 주 11/09 ~ 12/18
    assert.deepStrictEqual(pd('2026-10-01', '2026-10-31'), { from: '2026-11-02', to: '2026-12-11' }, '실적 끝 토요일');
    assert.deepStrictEqual(pd('2026-10-01', '2026-10-30'), { from: '2026-11-02', to: '2026-12-11' }, '실적 끝 금요일');
    assert.deepStrictEqual(pd('2026-10-05', '2026-11-01'), { from: '2026-11-02', to: '2026-12-11' }, '실적 끝 일요일');
    assert.deepStrictEqual(pd('2026-10-05', '2026-11-02'), { from: '2026-11-09', to: '2026-12-18' }, '실적 끝 월요일');
    //  실적 길이와 무관(옛 규칙은 같은 주 수였다)
    assert.deepStrictEqual(pd('2026-10-26', '2026-10-31'), { from: '2026-11-02', to: '2026-12-11' }, '짧은 실적도 6주');
    assert.deepStrictEqual(pd('2026-10-31', '2026-10-01'), { from: '', to: '' }, '거꾸로 된 기간');
    const S = M.evJSON("rptMFresh('2026-10-01', '2026-10-31', 'cal')");
    assert.deepStrictEqual([S.date, S.pFrom, S.pTo], ['2026-10-31', '2026-11-02', '2026-12-11'], '새 기간의 작성일이 실적 끝, 계획이 기본값이 아니다');
  }
  test('(W) 결정 17: 기본값 계산(실적 끝 토, 금, 일, 월, 짧은 실적, 거꾸로 된 기간), 작성일 = 실적 끝', async () => {
    const M = await open();
    try { checkDefaults(M); } finally { M.w.close(); }
  });
  test('(M) 변이: 옛 기본값 규칙(같은 주 수), 작성일 오늘을 넣으면 기본값 시험이 잡는다', async () => {
    const cases = [
      ['옛 기본값', (s) => mutate(s, '  return { from: m, to: addDays(m, 5 * 7 + 4) };', '  const weeks = Math.max(1, Math.ceil(rptMDays(from, to) / 7));\n  return { from: m, to: addDays(m, weeks * 7 - 3) };')],
      ['작성일 오늘', (s) => mutate(s, '\n    date: to,', '\n    date: todayYmd(),')],
    ];
    for (const [name, f] of cases) {
      const M = await open(f(app));
      let caught = false;
      try { checkDefaults(M); } catch (_) { caught = true; } finally { M.w.close(); }
      assert.ok(caught, '변이가 잡히지 않았다: ' + name);
    }
  });

  test('(W) 결정 17: 손으로 고친 작성일과 계획은 같은 기간 다시 읽기에서 남고, 실적을 바꿔 읽으면(날짜 칸 고르기, 값만 넣고 읽어 오기) 둘 다 다시 계산한다', async () => {
    const M = await open();
    try {
      setDate(M, 'rptmDate', '2026-10-06'); setDate(M, 'rptmPFrom', '2026-10-12'); setDate(M, 'rptmPTo', '2026-11-20');
      await load(M);   // 같은 기간(9월) 다시 읽기
      assert.ok(M.ev('!!rptMAuto(__rptM)'), '전제: 다시 읽었다');
      assert.deepStrictEqual(M.evJSON('[__rptM.date, __rptM.pFrom, __rptM.pTo]'), ['2026-10-06', '2026-10-12', '2026-11-20'], '같은 기간 다시 읽기가 손으로 고친 값을 버렸다');
      assert.deepStrictEqual([M.$('#rptmDate').value, M.$('#asDateTxt').textContent, M.$('#asPlanTxt').textContent], ['2026-10-06', '10월 6일', '10/12 ~ 11/20'], '고친 값이 칸이나 글자에 남지 않았다');
      //  실적 날짜 칸을 고르면(change) 새 기간: 작성일과 계획이 기본값으로
      M.$('#asActBtn').click();
      setDate(M, 'rptFrom', '2026-10-01'); setDate(M, 'rptTo', '2026-10-31');
      assert.deepStrictEqual(M.evJSON('[__rptM.date, __rptM.pFrom, __rptM.pTo]'), ['2026-10-31', '2026-11-02', '2026-12-11'], '실적을 바꿨는데 작성일과 계획을 다시 계산하지 않았다');
      assert.deepStrictEqual([M.$('#asActTxt').textContent, M.$('#asDateTxt').textContent, M.$('#asPlanTxt').textContent, M.$('#rptmPFrom').value], ['10/1 ~ 10/31', '10월 31일', '11/2 ~ 12/11', '2026-11-02'], '글자 단추나 날짜 칸이 새 기본값이 아니다');
      await load(M);
      setDate(M, 'rptmDate', '2026-11-03');
      //  값만 넣고(change 없이) 읽어 오기: 그때 새 기간으로 다시 계산
      M.$('#rptFrom').value = '2026-08-03'; M.$('#rptTo').value = '2026-08-28';
      await load(M);
      assert.deepStrictEqual(M.evJSON('[__rptM.from, __rptM.date, __rptM.pFrom, __rptM.pTo]'), ['2026-08-03', '2026-08-28', '2026-08-31', '2026-10-09'], '값만 넣고 읽어 오기가 새 기본값을 계산하지 않았다');
      assert.strictEqual(M.$('#asActTxt').textContent, '8/3 ~ 8/28', '실적 글자가 새 기간이 아니다');
    } finally { M.w.close(); }
  });

  //  강조 검사기(결정 18)
  async function checkStage(src) {
    const M = await open(src);
    try {
      const load0 = M.$('#asLoad'), save0 = M.$('#rptmSave');
      //  읽은 뒤(문서 탭): DOCX 저장만 파랑, 읽어 오기는 보통, 종이가 보이고 빈 아이콘은 숨음
      assert.deepStrictEqual(visPrimary(M), ['rptmSave'], '읽은 뒤 문서 탭 강조가 DOCX 저장 하나가 아니다');
      assert.ok(!M.$('#rptmSave').disabled && M.shown('#rptmPvWrap') && !M.shown('#rptmPvBlank') && !M.shown('#asBoxBlank') && !M.$('#rptmPickBox').classList.contains('as-wait'), '읽은 뒤인데 저장이 잠기거나 빈 자리가 보인다');
      const r1 = row(M, P1);   // 여기부터 같은 줄이어야 한다(예전 글 탭 강조 복사는 v6 결정 22 로 없앴다)
      //  읽기 전으로(같은 그릇을 비운다): 읽어 오기만 파랑, 저장은 보통+잠금, 상자 자리와 종이 자리는 빈 아이콘
      M.ev('clearNetcusWeeklyMerge(); asStageSync();');
      assert.deepStrictEqual(visPrimary(M), ['asLoad'], '읽기 전 강조가 읽어 오기 하나가 아니다');
      assert.ok(M.$('#rptmSave').disabled && !M.$('#rptmSave').classList.contains('primary'), '읽기 전 저장이 잠기지 않았거나 파랗다');
      assert.ok(M.shown('#asBoxBlank') && M.$('#asBoxBlank svg') && !M.$('#asBoxBlank').textContent.trim() && M.$('#rptmPickBox').classList.contains('as-wait'), '읽기 전 상자 자리가 빈 아이콘(글 없음)이 아니다');
      assert.ok(M.shown('#rptmPvBlank') && M.$('#rptmPvBlank svg') && !M.$('#rptmPvBlank').textContent.trim() && !M.shown('#rptmPvWrap'), '읽기 전 종이 자리가 빈 아이콘(글 없음)이 아니다');
      //  전환은 class 만: 단추와 과제 줄이 같은 요소다
      assert.ok(M.$('#asLoad') === load0 && M.$('#rptmSave') === save0 && row(M, P1) === r1, '강조 전환이 다시 그렸다');
      //  다시 읽으면 되돌아온다
      await load(M);
      assert.deepStrictEqual(visPrimary(M), ['rptmSave'], '다시 읽은 뒤 강조가 DOCX 저장 하나가 아니다');
      assert.ok(!M.$('#asLoad').classList.contains('primary') && M.$('#asLoad') === load0, '읽은 뒤 읽어 오기가 보통 단추가 아니다');
    } finally { M.w.close(); }
  }
  test('(W) 결정 18: 강조는 다음 할 일 하나. 읽기 전 읽어 오기와 빈 아이콘, 읽은 뒤 DOCX 저장. 전환은 class 만', async () => { await checkStage(app); });
  test('(M) 변이: 둘 다 강조(저장을 늘 파랑), 읽은 뒤에도 읽어 오기 파랑을 넣으면 강조 시험이 잡는다', async () => {
    const cases = [
      ['둘 다 강조', (s) => mutate(s, "sv.classList.toggle('primary', read);", "sv.classList.toggle('primary', true);")],
      ['읽어 오기 늘 파랑', (s) => mutate(s, "ld.classList.toggle('primary', !read);", "ld.classList.toggle('primary', true);")],
    ];
    for (const [name, f] of cases) {
      let caught = false;
      try { await checkStage(f(app)); } catch (_) { caught = true; }
      assert.ok(caught, '변이가 잡히지 않았다: ' + name);
    }
  });

  //  양식 전환 검사기(변이가 같은 검사기를 부른다)
  async function checkTemplate(src) {
    const M = await open(src);
    try {
      M.ev("$('#rptmPFrom').value = '2026-10-05'; $('#rptmPTo').value = '2026-11-13'; $('#rptmPFrom').dispatchEvent(new Event('change')); $('#rptmPTo').dispatchEvent(new Event('change'));");
      M.ev("$('#rptmDate').value = '2026-10-06'; $('#rptmDate').dispatchEvent(new Event('change'));");
      const rowEl = row(M, P1), sheet = M.$('#rptmSheet');
      const lsw0 = M.ev('__lsw.length');
      //  SW 처음
      assert.strictEqual(M.ev('rptMPayload(__rptM).template'), 'sw', 'payload template 이 처음에 sw 가 아니다');
      assert.ok(M.shown('#asPlanBtn') && !row(M, P1).querySelector('[data-slot]').classList.contains('hidden'), 'SW 인데 계획이나 그림 칸이 숨었다');
      assert.ok(row(M, P2).querySelector('.rptm-slot.has img'), '전제: P2 에 썸네일이 있다');
      //  HW
      M.$('#rptmTpl [data-tpl="hw"]').click(); await tick();
      assert.ok(M.$('#rptmTpl [data-tpl="hw"]').classList.contains('active') && M.$('#rptmTpl [data-tpl="hw"]').getAttribute('aria-pressed') === 'true', 'HW 세그가 켜지지 않았다');
      assert.ok(!M.shown('#asPlanBtn'), 'HW 인데 계획 단추가 보인다');
      assert.ok([P1, P2].every((id) => row(M, id).querySelector('[data-slot]').classList.contains('hidden')), 'HW 인데 그림 칸이 보인다');
      assert.ok(row(M, P1) === rowEl, '양식을 바꾸니 과제 목록을 다시 그렸다(출렁임)');
      const p = M.evJSON('rptMPayload(__rptM)');
      assert.strictEqual(p.template, 'hw', 'payload template 이 hw 가 아니다');
      assert.deepStrictEqual([p.plan, p.reportDate], [{ from: '2026-10-05', to: '2026-11-13' }, '2026-10-06'], 'HW 로 바꾸니 계획 값이나 작성일이 바뀌었다');
      //  HW 미리 보기(MONTHLY-TEMPLATE-HW 3장)
      assert.ok(sheet.classList.contains('hw'), '미리 보기 종이에 HW 표시가 없다');
      assert.strictEqual(sheet.querySelector('.ttl').textContent, '월간보고 – H/W팀 ((예시) 시험자) – 2026년 10월 6일', 'HW 제목(H/W팀, 앞 0 없음)이 아니다');
      assert.strictEqual(sheet.querySelector('.per').textContent, '[ 2026. 9. 1 ~ 2026. 9. 30 ]', 'HW 실적 기간 줄이 아니다');
      assert.ok(!sheet.querySelector('td.a') && !sheet.textContent.includes('월간 계획') && !sheet.textContent.includes('변경이력'), 'HW 에 파랑 머리 줄, 계획 기간, 일정 변경이력이 있다');
      const t1 = sheet.querySelector(`table[data-pv-uid="${P1}"]`), t2 = sheet.querySelector(`table[data-pv-uid="${P2}"]`);
      assert.ok(t1 && t2, 'HW 미리 보기에 과제 표가 없다');
      const widths = [...t1.querySelectorAll('col')].map((c) => parseFloat(c.style.width));
      const want = [1416, 992, 2974, 1274, 1132, 2268, 4670].map((w) => w / 14726 * 100);
      assert.ok(widths.length === 7 && widths.every((w, i) => Math.abs(w - want[i]) < 0.01), 'HW 격자 7열 폭 비율이 아니다: ' + widths.join());
      assert.strictEqual(t1.querySelectorAll('tr').length, 5, 'HW 과제 표 줄 수가 5가 아니다');
      assert.strictEqual(t1.querySelector('td.nm').getAttribute('rowspan'), '5', '과제명이 끝까지 세로 병합이 아니다');
      assert.strictEqual(t1.querySelectorAll('tr')[0].querySelector('td.bv').textContent, '2026년 3월 ~ 2026년 12월', 'HW 과제 수행 기간 형식이 아니다');
      assert.strictEqual(t2.querySelectorAll('tr')[0].querySelector('td.bv').textContent, '2026년 5월 ~', '끝이 빈 HW 과제 수행 기간이 아니다');
      assert.deepStrictEqual([...t1.querySelectorAll('tr')[1].querySelectorAll('td')].map((x) => x.textContent), ['개발일정', '개발 항목', '시작', '종료', '상세 내용'], 'HW 개발 일정 머리가 아니다');
      assert.ok([...t1.querySelectorAll('[data-pv="dev"] td')].every((x) => x.textContent === '') && !t1.querySelector('img') && !sheet.querySelector('img'), 'HW 개발 일정이 빈 표가 아니거나 그림이 들어갔다');
      const head = t1.querySelectorAll('tr')[3].querySelectorAll('td');
      assert.ok([...head].every((x) => x.classList.contains('w') && !x.classList.contains('b')), 'HW 본문 칸 이름 줄이 흰 바탕(굵게)이 아니다');
      assert.ok(t1.querySelector('[data-pv="actual"]').textContent.includes('점검 항목 정리'), 'HW 실적 칸에 실적 글이 없다');
      const et = sheet.querySelector('table[data-pv-etc]');
      assert.ok(et && et.querySelectorAll('tr').length === 3 && et.querySelector('td.nm').textContent === '기타' && et.querySelectorAll('td.thin').length === 2 && et.querySelectorAll('td.body').length === 3 && et.querySelectorAll('td.body')[1].textContent.includes('회의 자료'), 'HW 기타 표가 3칸(얇은 회색 줄, 계획 실적 계획)이 아니다');
      //  HW 에서는 계획 기간이 틀려도 저장을 막지 않는다(쓰지 않는 값)
      M.ev("__rptM.pFrom = '2026-12-01'; __rptM.pTo = '2026-11-01';");
      assert.strictEqual(M.ev('rptMCheck(__rptM)'), '', 'HW 인데 계획 기간 때문에 저장을 막는다');
      //  SW 로 돌아오면 계획과 그림 칸, 그림이 그대로
      M.$('#rptmTpl [data-tpl="sw"]').click(); await tick();
      assert.ok(M.shown('#asPlanBtn') && !row(M, P2).querySelector('[data-slot]').classList.contains('hidden') && row(M, P2).querySelector('.rptm-slot.has img'), 'SW 로 돌아왔는데 계획이나 그림 칸이 숨어 있거나 그림이 사라졌다');
      assert.ok(!sheet.classList.contains('hw') && sheet.querySelector('td.a') && sheet.querySelector('td.img img'), 'SW 로 돌아왔는데 미리 보기가 SW 모양이 아니다');
      assert.ok(M.ev('rptMCheck(__rptM)').includes('계획 기간'), 'SW 에서는 계획 기간을 검사해야 한다');
      //  기억하지 않는다: 저장소를 쓰지 않고, 다시 열면 SW
      M.$('#rptmTpl [data-tpl="hw"]').click(); await tick();
      assert.deepStrictEqual(M.evJSON('__lsw.slice(' + lsw0 + ')').filter((k) => /tpl|rptm/i.test(k)), [], '양식을 저장소에 썼다');
      M.ev("atSumInit();"); await tick();
      assert.ok(M.ev('rptMPayload(__rptM).template') === 'sw' && M.$('#rptmTpl [data-tpl="sw"]').classList.contains('active') && M.shown('#asPlanBtn'), '다시 열었는데 SW 가 아니다(양식을 기억했다)');
    } finally { M.w.close(); }
  }
  test('(W) 양식 SW/HW: HW 는 계획과 그림 칸을 숨기고 미리 보기를 HW 모양(제목, 기간 줄, 7열 폭, 빈 개발 일정 표, 흰 칸 이름, 기타 3칸)으로, payload template, 목록은 다시 그리지 않음, 값과 그림 그대로, 기억 안 함', async () => { await checkTemplate(app); });
  test('(M) 변이: template 빠짐, HW 에서 계획 보임, HW 미리 보기를 SW 로 그림, 양식 전환이 목록을 다시 그림을 넣으면 양식 시험이 잡는다', async () => {
    const cases = [
      ['template 빠짐', (s) => mutate(s, "    template: __rptMTpl === 'hw' ? 'hw' : 'sw',\n", '')],
      ['HW 에서 계획 보임', (s) => mutate(s, "  $$('#asHead .rptm-plan').forEach(e => e.classList.toggle('hidden', hw));\n", '')],
      ['HW 미리 보기 없음', (s) => mutate(s, "  const hw = p.template === 'hw';\n", '  const hw = false;\n')],
      ['전체 다시 그리기', (s) => mutate(s, '  rptMTplUi();\n  rptMPreview();\n}', '  rptMRenderAll();\n}')],
    ];
    for (const [name, f] of cases) {
      let caught = false;
      try { await checkTemplate(f(app)); } catch (_) { caught = true; }
      assert.ok(caught, '변이가 잡히지 않았다: ' + name);
    }
  });

  //  그림 1장 흐름 검사기
  async function checkImage(src) {
    const M = await open(src);
    try {
      const slot = (id) => row(M, id).querySelector('[data-slot]');
      //  비면 그림 아이콘 단추, 있으면 썸네일과 ✕
      assert.ok(slot(P1).querySelector('button.rptm-slot[data-act="imgAdd"] svg') && !slot(P1).querySelector('img'), '빈 칸이 그림 아이콘 단추가 아니다');
      assert.ok(slot(P2).querySelector('.rptm-slot.has [data-act="imgZoom"] img') && slot(P2).querySelector('.rptm-slot.has [data-act="imgDel"]'), '그림 칸이 썸네일과 ✕ 가 아니다');
      //  넣기(파일)
      slot(P1).querySelector('[data-act="imgAdd"]').click(); await tick();
      const a1 = reply(M, 'scheduleImageAdd', { ok: true, data: { projectUid: U1, image: IMG(7), images: [IMG(7)] } });
      assert.deepStrictEqual([a1.projectUid, a1.mode], [P1, 'file'], '빈 칸 누르기가 파일 고르기 넣기가 아니다');
      await tick(); answerThumbs(M); await tick();
      assert.ok(slot(P1).querySelector('[data-act="imgZoom"] img'), '넣은 뒤 썸네일이 되지 않았다');
      //  두 번째 넣기 막음: 붙여넣기도, 직접 부르기도 요청 없이 토스트 하나
      const adds = () => M.posted.filter((x) => x && x.cmd === 'scheduleImageAdd').length;
      const n0 = adds(), t0 = M.ev('__toasts.length');
      row(M, P1).dispatchEvent(new M.w.MouseEvent('mouseover', { bubbles: true }));
      ctrlV(M, M.d.body); await tick();
      M.ev(`rptMImgAdd(${JSON.stringify(P1)}, 'file')`); await tick();
      assert.strictEqual(adds(), n0, '이미 1장인데 넣기 요청이 나갔다');
      const ts = M.evJSON('__toasts').slice(t0);
      assert.ok(ts.length === 2 && ts.every((t) => t === '그림은 과제마다 1장입니다. 빼고 다시 넣으세요'), '두 번째 넣기에 짧은 토스트가 아니다: ' + ts.join(' | '));
      //  크게 보기: 띄움 칸(#shotViewer 재사용), [빼기][닫기], 머리 × 는 숨김
      slot(P2).querySelector('[data-act="imgZoom"]').click(); await tick();
      const sv = M.$('#shotViewer');
      assert.ok(!sv.classList.contains('hidden') && M.shown('#shotViewerFoot') && !M.shown('#shotViewerClose') && M.$('#shotViewerImg').getAttribute('src') === 'data:image/jpeg;base64,QUJD', '크게 보기 창이 그림과 [빼기][닫기]로 뜨지 않았다');
      assert.deepStrictEqual([...M.d.querySelectorAll('#shotViewerFoot button')].map((b) => b.textContent), ['빼기', '닫기']);
      ctrlV(M, M.d.body); await tick();
      assert.strictEqual(adds(), n0, '크게 보기가 떠 있는데 Ctrl+V 가 넣기를 불렀다');
      M.$('#shotViewerDone').click(); await tick();
      assert.ok(sv.classList.contains('hidden') && !M.shown('#shotViewerFoot') && M.shown('#shotViewerClose'), '닫기 뒤 창이 남았거나 사용설명서 모드(× )로 돌아오지 않았다');
      //  크게 보기 [빼기] → 확인 → scheduleImageDelete → 빈 칸
      slot(P2).querySelector('[data-act="imgZoom"]').click(); await tick();
      M.$('#shotViewerDel').click(); await tick();
      await waitFor(() => !M.$('#confirmModal').classList.contains('hidden'), '빼기 확인 창');
      assert.ok(sv.classList.contains('hidden'), '빼기를 누르면 크게 보기 창이 닫혀야 한다');
      M.$('#cfOk').click(); await tick(150);
      const del = reply(M, 'scheduleImageDelete', { ok: true, data: { projectUid: U2, images: [], stale: false, notice: '' } });
      assert.strictEqual(del.id, 9, '빼기가 그 그림을 지우지 않았다');
      await tick();
      assert.ok(slot(P2).querySelector('[data-act="imgAdd"]'), '뺀 뒤 빈 칸(넣기)이 아니다');
      //  ✕ 도 같은 흐름(확인 취소면 요청 없음)
      slot(P1).querySelector('[data-act="imgDel"]').click(); await tick();
      await waitFor(() => !M.$('#confirmModal').classList.contains('hidden'), '✕ 확인 창');
      M.ev("closeOverlay($('#confirmModal'))"); await tick(200);
      assert.strictEqual(pending(M, 'scheduleImageDelete').length, 0, '취소했는데 빼기 요청이 갔다');
      //  HW 에서는 그림 칸이 없고 붙여넣기도 하지 않는다
      M.$('#rptmTpl [data-tpl="hw"]').click(); await tick();
      row(M, P2).dispatchEvent(new M.w.MouseEvent('mouseover', { bubbles: true }));
      ctrlV(M, M.d.body); await tick();
      assert.strictEqual(adds(), n0, 'HW 에서 Ctrl+V 가 그림 넣기를 불렀다');
      //  그림 명령은 넷뿐(순서 바꾸기 없음)
      assert.ok(!M.posted.some((x) => x && x.cmd === 'scheduleImageMove'), '순서 바꾸기 명령이 나갔다');
    } finally { M.w.close(); }
  }
  test('(W) 그림 과제당 1장: 비면 아이콘 단추(파일), 넣으면 썸네일, 두 번째 넣기와 붙여넣기는 토스트 하나로 막음, 크게 보기([빼기][닫기], 머리 × 숨김), 빼기 확인 뒤 삭제, HW 에서는 붙여넣기 없음', async () => { await checkImage(app); });
  test('(M) 변이: 그림 5장 허용, 크게 보기의 닫기 단추 둘(머리 × 를 숨기지 않음)을 넣으면 그림 시험이 잡는다', async () => {
    const cases = [
      ['그림 5장', (s) => mutate(s, 'const RPTM_IMG_MAX = 1;', 'const RPTM_IMG_MAX = 5;')],
      ['닫기 둘', (s) => mutate(s, "  if(x) x.classList.add('hidden');\n  const del = $('#shotViewerDel');", "  const del = $('#shotViewerDel');")],
    ];
    for (const [name, f] of cases) {
      let caught = false;
      try { await checkImage(f(app)); } catch (_) { caught = true; }
      assert.ok(caught, '변이가 잡히지 않았다: ' + name);
    }
  });

  test('(W) 텍스트 다이어트와 결정 20: 기록 없는 과제는 흐린 이름과 풍선(글 없음), 넣지 않은 과제는 줄 표시(off), 기타는 글 있는 개인 과제의 체크 줄(켠 수/전체), 미식별 없으면 상자 숨김', async () => {
    const M = await open();
    try {
      M.ev(`__rptM.checked[${JSON.stringify(P2)}] = false; rptMRenderPick();`); answerImages(M); await tick();
      const r2 = row(M, P2);
      assert.ok(r2.classList.contains('norec') && r2.classList.contains('off') && r2.querySelector('.nm').title === '이 기간 기록 없음', '기록 없는 과제가 흐린 이름과 풍선, 줄 표시가 아니다');
      assert.ok(!M.$('#rptmPick').textContent.includes('기록 없음'), '기록 없음 글이 보인다');
      assert.ok(!row(M, P1).classList.contains('norec') && !row(M, P1).querySelector('.nm').title, '기록 있는 과제가 흐리다');
      //  결정 20: 글 있는 c-etc 만 줄이 있고 c-none 은 없다. 과제와 같은 줄 모양(.rptm-it, label.check), 머리 켠 수/전체
      const etcRows = [...M.d.querySelectorAll('#rptmEtc .rptm-it')];
      assert.deepStrictEqual(etcRows.map((r) => [r.dataset.etcKey, r.querySelector('label.check input[data-etc]').checked, r.querySelector('.nm').textContent]), [['c-etc', true, '(예시) 사내 업무']], '기타 줄이 글 있는 개인 과제만이 아니다');
      assert.ok(M.shown('#rptmEtcBox') && M.$('#rptmEtcCnt').textContent === '1/1' && !M.d.querySelector('#rptmEtc .rpt-chip'), '기타 상자 머리가 켠 수/전체가 아니거나 칩이 남았다');
      const er = etcRows[0], cb = er.querySelector('input');
      cb.checked = false; cb.dispatchEvent(new M.w.Event('change', { bubbles: true }));
      assert.ok(M.d.querySelector('#rptmEtc .rptm-it') === er && er.classList.contains('off') && M.$('#rptmEtcCnt').textContent === '0/1' && M.ev("__rptM.etcOff.has('c-etc')"), '기타 줄을 빼면 그 줄만 off, 머리 0/1 이어야 한다(다시 그리지 않는다)');
      assert.ok(!M.$('#rptmSheet').textContent.includes('회의 자료'), '뺀 기타 글이 미리 보기에 남았다');
      assert.ok(!M.shown('#rptmUnid') && M.$('#rptmUnid').textContent === '', '미식별이 없는데 상자나 안내 글이 보인다');
      //  읽기 전에는 흐린 이름과 기타 줄이 없다(아직 모른다)
      M.ev("clearNetcusWeeklyMerge(); __rptMHas = rptMHasSet(__rptM); rptMRenderPick(); rptMRenderEtc();"); answerImages(M); await tick();
      assert.ok(!M.d.querySelector('#rptmPick .rptm-it.norec'), '읽기 전인데 흐린 이름이 있다');
      assert.ok(!M.shown('#rptmEtcBox') && !M.d.querySelector('#rptmEtc .rptm-it'), '읽기 전인데 기타 줄이 있다');
    } finally { M.w.close(); }
  });
}
