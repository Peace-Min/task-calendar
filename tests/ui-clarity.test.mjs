// 화면 혼란 3건 정리(docs/UI-CLARITY-2026-10-01.md U1–U6 · V1–V4) — 이름·전송 모드·중복 버튼.
//
// 이 파일이 지키는 것:
//   (S) 정적 계약 — 「넓게 보기」 → 「맨 앞에 띄우기」(제목줄·☰ 메뉴·안내 · 과거 패치노트는 그대로) · 아이콘 교체 ·
//       회사 전송은 늘 실제 제출(전송 모드 라디오·배지·버튼 톤 없음 · 예전 저장값 미독 · 제출 전 확인 한 번) ·
//       제목줄 「_」(트레이로 숨기기) 없음 + ✕ 툴팁이 트레이 상태를 따른다 · 호스트 닫기/숨기기 동작 불변(U6).
//   (R) jsdom 실행 — 위젯 모드(가짜 호스트)로 부팅해 제목줄·트레이 툴팁을 보고, 보고서 전송을 확인창 수락까지
//       눌러 **호스트로 나가려던 메시지만** 붙잡아 dryRun === false 를 본다.
//       ★ 실제 전송은 없다: 가짜 chrome.webview.postMessage 는 배열에 넣기만 한다(아무 데도 전달하지 않는다).
//   (M) 변이 — #hbHide 복원 · dryRun:true · 옛 이름 복귀 · 확인 제거 · 예전 저장값 다시 읽기를 각각 잡는다.
//
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, stripCsComments,
         importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';
import { readFileSync } from 'node:fs';

const app = loadAppSource();
const mainwin = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');

const OLD = '넓게 보기';
const TIP = {
  focusOff:  '맨 앞에 띄우기 — 다른 창 위에 크게 띄워 작업합니다 (Esc 로 해제)',
  focusOn:   '맨 앞 해제 (Esc)',
  closeTray: '트레이로 숨기기 (종료는 ☰ 메뉴)',
  closeQuit: '닫기(종료)',
};
const CONFIRM_MSG = '회사 보고 시스템에 실제로 제출합니다. 계속할까요?';

// 앵커 하나를 정확히 한 번 바꾼다 — 없거나 여럿이면 실패(조용히 통과하는 껍데기 변이를 막는다).
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다(리팩터로 사라졌다면 앵커를 갱신할 것): ' + find.slice(0, 120));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 120));
  const out = text.slice(0, a) + repl + text.slice(a + find.length);
  assert.notStrictEqual(out, text, '변이가 원본을 바꾸지 못했다');
  return out;
}
const countOf = (hay, needle) => hay.split(needle).length - 1;

// #patchModal(과거 버전 패치노트) 구간 — 기록이라 옛 이름이 남아 있어도 된다(U2).
function patchRange(src) {
  const a = src.indexOf('<div class="overlay hidden" id="patchModal">');
  assert.ok(a > 0, '#patchModal 을 찾지 못했다');
  const b = src.indexOf('<!-- 업데이트 배너', a);
  assert.ok(b > a, '#patchModal 의 끝(업데이트 배너 주석)을 찾지 못했다');
  return [a, b];
}
// buildHostBar 의 마크업 템플릿만.
function hostBarMarkup(src) {
  const fn = extractFunction(src, 'buildHostBar');
  const a = fn.indexOf('bar.innerHTML = `');
  assert.ok(a > 0, 'buildHostBar 의 마크업 템플릿을 찾지 못했다');
  const b = fn.indexOf('`;', a);
  return fn.slice(a, b);
}
// window.__setX = function(...){...} 본문.
function windowFn(src, name) {
  const a = src.indexOf('window.' + name + ' = function(');
  assert.ok(a > 0, name + ' 을 찾지 못했다');
  const b = src.indexOf('\n};', a);
  assert.ok(b > a, name + ' 의 끝을 찾지 못했다');
  return src.slice(a, b + 3);
}
// #btnRptSend 핸들러의 일간 갈래(전송 직전까지).
function dailySendBranch(src) {
  const a = src.indexOf("$('#btnRptSend').addEventListener('click'");
  assert.ok(a > 0, '#btnRptSend 배선을 찾지 못했다');
  const d = src.indexOf("if(mode === 'daily'){", a);
  const e = src.indexOf('Platform.report.submitDaily(payload);', d);
  assert.ok(d > a && e > d, '일간 전송 갈래를 찾지 못했다');
  return src.slice(d, e + 'Platform.report.submitDaily(payload);'.length);
}

// ══════════════════════════════════════════════════════════════════════
// (S) 정적 검사기 — 변이 시험이 같은 함수를 재사용한다
// ══════════════════════════════════════════════════════════════════════
const S = {
  // U2 · V2 — 앱 안 「넓게 보기」 는 과거 패치노트에만 남는다(주석 포함 0 — 내부 이름은 호스트 C# 에만).
  noOldLabelOutsideHistory(src) {
    const [a, b] = patchRange(src);
    const outside = src.slice(0, a) + src.slice(b);
    const n = countOf(outside, OLD);
    assert.strictEqual(n, 0, `「${OLD}」 가 과거 패치노트 밖에 ${n}곳 남아 있다 — 버튼 이름은 「맨 앞에 띄우기」다(U1·U2)`);
    assert.ok(countOf(src.slice(a, b), OLD) >= 1, '과거 패치노트의 기록까지 고쳤다 — 기록은 그대로 둔다(U2)');
  },
  // U1 · V1 — 제목줄 버튼: 새 이름·새 아이콘. 툴팁 문구는 HB_TIP 한 곳.
  hostBarFocus(src) {
    for (const [k, v] of Object.entries(TIP)) {
      assert.ok(src.includes(`  ${k}:`) && src.includes(`'${v}'`), `HB_TIP.${k} 가 「${v}」 가 아니다`);
    }
    const mk = hostBarMarkup(src);
    assert.ok(/<button data-host="focus" id="hbFocus" title="\$\{HB_TIP\.focusOff\}" aria-label="\$\{HB_TIP\.focusOff\}">\$\{ICON\.front\}<\/button>/.test(mk),
      '#hbFocus 가 HB_TIP.focusOff(title·aria-label) + ICON.front 가 아니다');
    assert.ok(!mk.includes('⤢'), '제목줄 마크업에 확대 글리프(⤢)가 남아 있다 — 「넓게 보기」로 읽힌다');
    const sf = windowFn(src, '__setFocus');
    assert.ok(/HB_TIP\.focusOn/.test(sf) && /HB_TIP\.focusOff/.test(sf) && /ICON\.front/.test(sf) && /aria-label/.test(sf),
      '__setFocus 가 HB_TIP·ICON.front·aria-label 로 상태를 바꾸지 않는다');
    assert.ok(!sf.includes('⤢'), '__setFocus 가 확대 글리프(⤢)로 되돌린다');
    // 아이콘: 겹친 두 창 — 앞 창이 채워짐(currentColor). svgIc 를 쓴다(다른 제목줄 아이콘과 같은 크기 규칙 .ic).
    const m = /\n {2}front: +svgIc\('([^']*)'/.exec(src);
    assert.ok(m, 'ICON.front 가 svgIc 로 정의돼 있지 않다');
    const rects = m[1].match(/<rect /g) || [];
    assert.strictEqual(rects.length, 2, 'ICON.front 가 겹친 두 창(rect 2개)이 아니다');
    assert.ok(/<rect [^>]*fill="currentColor"/.test(m[1]), 'ICON.front 의 앞 창이 채워져 있지 않다(강조 없음)');
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(m[1]), 'ICON.front 에 색 값이 박혀 있다 — currentColor 만 쓴다');
  },
  // U1 · V1 — 호스트 ☰ 메뉴 머리말.
  hostMenu(cs) {
    const code = stripCsComments(cs);
    assert.ok(code.includes('var focus = new MenuItem { Header = _focusMode ? "맨 앞 해제 (Esc)" : "맨 앞에 띄우기" };'),
      '☰ 메뉴 항목이 「맨 앞에 띄우기」/「맨 앞 해제 (Esc)」 가 아니다');
    //  사용자에게 보이는 문자열(메뉴·툴팁·대화상자)에 옛 이름이 없어야 한다. 위젯 로그(Log("…"))는 내부 기록이라 내부 이름을 써도 된다.
    const shown = code.split('\n').filter((l) => /"[^"\n]*넓게 보기[^"\n]*"/.test(l) && !/^\s*Log\("[^"\n]*"\);\s*$/.test(l.replace(/\r+$/, '')));
    assert.deepStrictEqual(shown, [], '호스트 C# 의 사용자 문구에 「넓게 보기」 가 남아 있다');
  },
  // U3 · V3 — 전송 모드 UI·저장값이 없다.
  noSendModeUi(src) {
    assert.ok(!/name="ncMode"/.test(src), '설정에 전송 모드 라디오(name="ncMode")가 남아 있다');
    assert.ok(!src.includes('rptSendMode'), '보고서 창에 전송 모드 배지(#rptSendMode)가 남아 있다');
    assert.ok(!src.includes('rpt-send-mode'), '전송 모드 배지 CSS(.rpt-send-mode)가 남아 있다');
    assert.ok(!src.includes('#btnRptSend.real') && !/classList\.(?:toggle|add)\('real'/.test(src),
      '전송 버튼의 「실제 제출」 톤 분기가 남아 있다');
    assert.ok(!src.includes('tc_netcusMode'), '예전 전송 모드 저장값(tc_netcusMode)을 아직 읽거나 쓴다 — 무시해야 한다(U3)');
    assert.ok(!/\bncMode\s*\(/.test(src), 'ncMode() 가 남아 있다');
  },
  // U3·U4 · V3 — 일간 전송은 늘 dryRun:false, 제출 전 확인은 한 번, 확인보다 먼저 버튼을 잠그거나 보내지 않는다.
  dailyAlwaysReal(src) {
    const d = dailySendBranch(src);
    assert.ok(/\bdryRun: false \}/.test(d), '일간 전송 payload 가 dryRun:false 가 아니다');
    assert.ok(!/dryRun:(?!\s*false\b)/.test(d), '일간 전송 payload 의 dryRun 이 false 상수가 아니다(모드 분기가 남았다)');
    const c = d.indexOf(`await confirmBox('일간보고 제출', '${CONFIRM_MSG}'`);
    assert.ok(c > 0, `실제 제출 전 확인(「${CONFIRM_MSG}」)이 없다(U4)`);
    assert.strictEqual(countOf(d, 'confirmBox('), 1, '제출 확인이 한 번이 아니다');
    assert.ok(/Platform\.caps\.reportAuto && await confirmBox\([^\n]*\) !== 'ok'\) return;/.test(d),
      "확인을 거절해도 진행한다(!== 'ok' → return 이 아니다) — 또는 위젯 조건이 빠졌다");
    const lock = d.indexOf('if(b) b.disabled = true;');
    const send = d.indexOf('Platform.report.submitDaily(payload);');
    assert.ok(lock > c && send > c, '확인보다 먼저 버튼을 잠그거나 전송한다');
    assert.ok(/\$\('#btnRptSend'\)\.addEventListener\('click', async \(\) => \{/.test(src), '전송 핸들러가 async 가 아니다(확인을 기다릴 수 없다)');
    // 어댑터는 payload 의 값을 그대로 싣는다(여기서 다시 true 로 바꾸는 길이 없다).
    assert.ok(/submitDaily\(p\)\{ hpost\(\{ cmd: 'netcusSubmit',[^\n]*dryRun: p\.dryRun,/.test(src), 'WidgetPlatform.submitDaily 가 payload 의 dryRun 을 그대로 싣지 않는다');
    // 주간은 「채우고 열어두기」(직접 제출) — dryRun 개념이 없다. 그래도 true 를 싣는 길이 생기면 안 된다.
    assert.ok(!/dryRun:\s*true/.test(src), 'dryRun:true 를 싣는 길이 있다');
  },
  // U5 · V4 — 「_」 버튼 없음 · ✕ 툴팁이 트레이 상태를 따른다.
  trayCloseOnly(src) {
    const mk = hostBarMarkup(src);
    assert.ok(!src.includes('hbHide'), '제목줄 「_」(#hbHide) 가 남아 있다 — ✕ 가 같은 일을 한다(U5)');
    assert.ok(!/data-host="hide"/.test(src), 'data-host="hide" 버튼이 남아 있다');
    assert.strictEqual((mk.match(/<button data-host=/g) || []).length, 4, '제목줄 버튼이 4개(맨 앞·부착·메뉴·✕)가 아니다');
    assert.ok(/<button data-host="close" id="hbClose" title="\$\{HB_TIP\.closeQuit\}" aria-label="\$\{HB_TIP\.closeQuit\}">✕<\/button>/.test(mk),
      '✕ 가 #hbClose · HB_TIP.closeQuit 기본 툴팁이 아니다');
    const st = windowFn(src, '__setTray');
    assert.ok(/getElementById\('hbClose'\)/.test(st) && /on \? HB_TIP\.closeTray : HB_TIP\.closeQuit/.test(st) && /aria-label/.test(st),
      '__setTray 가 ✕ 툴팁(트레이로 숨기기 / 닫기(종료))을 바꾸지 않는다');
  },
  // U6 — 호스트 동작은 그대로: ✕ = 트레이 사용 시 숨김, 아니면 종료(미저장 경고는 ExitApp 안).
  hostCloseUnchanged(cs) {
    const code = stripCsComments(cs);
    assert.ok(/case "close":\s*if \(_settings\.TrayEnabled\) HideToTray\(\);\s*else ExitApp\(\);\s*break;/.test(code),
      '호스트 case "close" 가 바뀌었다(트레이=숨김 · 아니면 종료)');
    assert.ok(/case "hide": HideToTray\(\); break;/.test(code), '호스트 case "hide" 가 바뀌었다(U6 — 호스트는 그대로 둔다)');
    assert.ok(/private void ExitApp\(\)\s*\{\s*if \(!ConfirmCloseIfUnsaved\("종료"\)\) return;/.test(code), '종료 경로의 미저장 경고가 사라졌다');
  },
};

test('S1 (U2·V2): 「넓게 보기」 는 과거 패치노트(#patchModal)에만 남는다', () => S.noOldLabelOutsideHistory(app));
test('S2 (U1·V1): 제목줄 #hbFocus = 「맨 앞에 띄우기」 툴팁·aria + 겹친 창 아이콘(⤢ 없음)', () => S.hostBarFocus(app));
test('S3 (U1·V1): 호스트 ☰ 메뉴 = 「맨 앞에 띄우기」 / 켜짐 「맨 앞 해제 (Esc)」', () => S.hostMenu(mainwin));
test('S4 (U3·V3): 전송 모드 라디오·배지·버튼 톤·예전 저장값 읽기가 없다', () => S.noSendModeUi(app));
test('S5 (U3·U4·V3): 일간 전송 payload 는 dryRun:false 상수 · 제출 전 확인 한 번 · 확인 뒤에야 잠금/전송', () => S.dailyAlwaysReal(app));
test('S6 (U5·V4): 제목줄에 「_」(#hbHide) 없음 · ✕ 툴팁은 __setTray 가 트레이 상태로 정한다', () => S.trayCloseOnly(app));
test('S7 (U6): 호스트 ✕/숨기기/종료 동작은 그대로다', () => S.hostCloseUnchanged(mainwin));
test('S8 (V2): 사용 안내·설정 안내가 새 이름을 말한다', () => {
  assert.ok(app.includes('<li><b>맨 앞에 띄우기</b>(제목줄 버튼 · ☰ 메뉴)로 다른 창 위에 크게 띄워'), '사용 안내(창 모드·크기)가 새 이름이 아니다');
  assert.ok(app.includes("‘맨 앞에 띄우기’(다른 창 위에 크게) 지원"), '도움말(창 모드)이 새 이름이 아니다');
  assert.ok(app.includes('「맨 앞에 띄우기」로 창을 크게 펼치면 가장 잘 보입니다.'), '설정(월 보기 밀도) 안내가 새 이름이 아니다');
  assert.ok(app.includes('<b>실제로 제출</b>합니다(제출 직전에 한 번 확인합니다)'), '설정(회사 일간보고) 안내가 「늘 실제 제출」을 말하지 않는다');
});

// ── (M) 정적 변이 ────────────────────────────────────────────────────
test('변이 M1: #hbHide 를 되살리면 S6 이 잡는다', () => {
  const bad = mutate(app, '      <button data-host="pin" id="hbPin"',
    '      <button data-host="hide" id="hbHide" title="트레이로 숨기기" style="display:none">_</button>\n      <button data-host="pin" id="hbPin"');
  assert.throws(() => S.trayCloseOnly(bad), /hbHide|data-host="hide"|4개/);
});
test('변이 M2: payload 를 dryRun:true 로 보내면 S5 가 잡는다', () => {
  const bad = mutate(app, 'hours: rptHours, dryRun: false };', 'hours: rptHours, dryRun: true };');
  assert.throws(() => S.dailyAlwaysReal(bad), /dryRun/);
});
test('변이 M3: 옛 이름(툴팁·안내·☰ 메뉴)을 되돌리면 S1·S2·S3 이 잡는다', () => {
  const badTip = mutate(app, `  focusOff:  '${TIP.focusOff}',`, "  focusOff:  '넓게 보기 — 크게 펼쳐서 작업',");
  assert.throws(() => S.noOldLabelOutsideHistory(badTip), /넓게 보기/);
  assert.throws(() => S.hostBarFocus(badTip), /HB_TIP\.focusOff/);
  const badHelp = mutate(app, '<li><b>맨 앞에 띄우기</b>(제목줄 버튼', '<li><b>넓게 보기</b>(제목줄 버튼');
  assert.throws(() => S.noOldLabelOutsideHistory(badHelp), /넓게 보기/);
  const badGlyph = mutate(app, '">${ICON.front}</button>', '">⤢</button>');
  assert.throws(() => S.hostBarFocus(badGlyph), /ICON\.front|⤢/);
  const badMenu = mutate(mainwin, '"맨 앞 해제 (Esc)" : "맨 앞에 띄우기"', '"넓게 보기 닫기" : "넓게 보기"');
  assert.throws(() => S.hostMenu(badMenu), /맨 앞|넓게 보기/);
});
test('변이 M4: 제출 전 확인을 빼면 S5 가 잡는다', () => {
  const at = app.indexOf("      if(Platform.caps.reportAuto && await confirmBox('일간보고 제출'");
  assert.ok(at > 0);
  const end = app.indexOf('\n', at) + 1;
  const bad = app.slice(0, at) + app.slice(end);
  assert.throws(() => S.dailyAlwaysReal(bad), /확인/);
});
test('변이 M5: 예전 저장값(tc_netcusMode)을 다시 읽으면 S4 가 잡는다', () => {
  const bad = mutate(app, 'hours: rptHours, dryRun: false };',
    "hours: rptHours, dryRun: (function(){ try{ return localStorage.getItem('tc_netcusMode') !== 'real'; }catch(_){ return true; } })() };");
  assert.throws(() => S.noSendModeUi(bad), /tc_netcusMode/);
  assert.throws(() => S.dailyAlwaysReal(bad), /dryRun/);
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom 실행 — 위젯 모드 · 가짜 호스트(전달 없음)
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('ui-clarity: jsdom 미설치 — 제목줄·트레이 툴팁·보고서 전송(dryRun) 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const quietConsole = () => (jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CA = '2026-09-01T00:00:00Z';
  const tick = () => new Promise((r) => setTimeout(r, 20));
  async function waitFor(pred, what, ms = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred()) return; await tick(); }
    assert.fail('시간 안에 일어나지 않았다: ' + what);
  }

  // ★ 가짜 호스트 — 메시지를 **배열에 넣기만** 한다. 어디에도 전달하지 않는다(실제 netcus 제출 불가).
  function boot(source) {
    const posted = [];
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/',
      virtualConsole: quietConsole(),
      beforeParse(win) {
        win.chrome = { webview: {
          postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); },
          addEventListener() {}, removeEventListener() {},
        } };
        if (typeof win.crypto === 'undefined') {
          win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        }
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        if (!win.CSS) win.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => '\\' + c) };
      },
    });
    const w = dom.window;
    const ev = (code) => w.eval(code);
    // 로그인 복원 회신(게이트 내리기) — 부팅이 보낸 userSessionGet 에만 답한다.
    const sess = posted.find((x) => x.cmd === 'userSessionGet');
    if (sess) ev('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'tester', name: '시험자' } }) + ')');
    return {
      w, posted, ev, doc: w.document,
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      //  닫기 전에 한 번 양보한다 — 부팅의 로그인 복원 회신(마이크로태스크)이 닫힌 창에서 돌면 document 가 없어 터진다.
      close: async () => { await tick(); try { w.close(); } catch (_) {} },
    };
  }
  // 오늘 날짜(앱의 todayYmd)에 일정 하나 — 일간 보고서 본문이 비지 않게.
  function seed(m) {
    const today = m.ev('todayYmd()');
    const data = {
      categories: [{ id: 'c-a', name: '알파', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }],
      entries: [{ id: 'e-1', date: today, title: '보고 대상 업무', categoryId: 'c-a', allDay: true, startTime: '', endTime: '',
                  memo: '', location: '', source: '', commits: [], createdAt: CA, updatedAt: CA }],
      todos: [], rooms: [],
    };
    m.ev('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(META) + ')');
    return today;
  }
  const overlayOpen = (m, id) => { const o = m.doc.getElementById(id); return !!o && !o.classList.contains('hidden') && !o.classList.contains('closing'); };
  //  닫힘 = 'hidden' 까지(닫는 애니메이션 'closing' 동안은 confirmBox 가 아직 결과를 돌려주지 않았다).
  const overlayClosed = (m, id) => { const o = m.doc.getElementById(id); return !o || o.classList.contains('hidden'); };
  const submits = (m) => m.posted.filter((x) => x && /^netcus/.test(String(x.cmd || '')) && x.cmd !== 'netcusCredsGet');

  // 보고서 열기 → 일간 전송 누르기 → (확인창) → 수락/거절. 반환: 확인창 상태 + 그 뒤 호스트로 나가려던 netcus 메시지.
  async function sendDaily(m, accept) {
    // 예전 사용자가 「미제출 테스트」를 골라 두었던 PC — 그 값은 이제 아무 영향이 없어야 한다(U3).
    m.ev("try{ localStorage.setItem('tc_netcusMode', 'dry'); }catch(_){}");
    const today = seed(m);
    await tick();
    m.ev("openReport(); ['#rptSrcEvent','#rptSrcTodo','#rptSrcGit'].forEach(function(s){ var e=$(s); if(e) e.checked = true; }); buildReport(); updateRptSendVis();");
    assert.strictEqual(m.ev("$('#btnRptSend').dataset.mode"), 'daily', '보고서가 일간으로 열리지 않았다');
    const before = submits(m).length;
    m.doc.getElementById('btnRptSend').click();
    await waitFor(() => overlayOpen(m, 'confirmModal'), '제출 확인창이 뜬다');
    const cf = { title: m.ev("$('#cfTitle').textContent"), msg: m.ev("$('#cfMsg').textContent"), ok: m.ev("$('#cfOk').textContent") };
    const whileAsking = submits(m).length - before;
    if (accept) m.doc.getElementById('cfOk').click();
    else m.doc.querySelector('#confirmModal [data-close]').click();
    await waitFor(() => overlayClosed(m, 'confirmModal'), '확인창이 닫힌다');
    await tick(); await tick();
    return { today, cf, whileAsking, sent: submits(m).slice(before) };
  }
  // 실행 검사기 — 변이 시험이 재사용한다.
  function assertRealSubmit(r) {
    assert.strictEqual(r.whileAsking, 0, '확인창이 떠 있는 동안 이미 호스트로 전송했다');
    assert.strictEqual(r.cf.msg, CONFIRM_MSG, '확인창 문구가 다르다');
    assert.strictEqual(r.sent.length, 1, '확인 뒤 netcus 메시지가 정확히 1건이 아니다: ' + JSON.stringify(r.sent.map((x) => x.cmd)));
    const msg = r.sent[0];
    assert.strictEqual(msg.cmd, 'netcusSubmit', '일간 전송 명령이 netcusSubmit 이 아니다');
    assert.strictEqual(msg.dryRun, false, '일간 전송의 dryRun 이 false 가 아니다(예전 저장값 dry 가 남아 있어도 실제 제출이어야 한다)');
    const [y, mo, d] = r.today.split('-').map(Number);
    assert.deepStrictEqual([msg.y, msg.m, msg.d], [y, mo, d], '전송 날짜가 오늘이 아니다');
    assert.ok(String(msg.content || '').includes('보고 대상 업무'), '전송 본문에 오늘 일정이 없다');
  }

  let M = null, bootErr = null;
  try { M = boot(app); } catch (e) { bootErr = e; }
  if (bootErr) {
    test('R0: 위젯 모드 부팅', () => { throw bootErr; });
  } else {
    test('R1 (V1): 제목줄 #hbFocus — 「맨 앞에 띄우기」 툴팁·aria · 겹친 창 SVG, 켜면 ✕ + 「맨 앞 해제 (Esc)」', () => {
      const f = M.doc.getElementById('hbFocus');
      assert.ok(f, '#hbFocus 가 없다');
      assert.strictEqual(f.title, TIP.focusOff);
      assert.strictEqual(f.getAttribute('aria-label'), TIP.focusOff);
      assert.ok(f.querySelector('svg.ic'), '#hbFocus 에 SVG 아이콘(.ic)이 없다');
      assert.strictEqual(f.querySelectorAll('svg rect').length, 2, '아이콘이 겹친 두 창이 아니다');
      assert.ok(!f.textContent.includes('⤢'), '확대 글리프(⤢)가 남아 있다');
      M.ev('__setFocus(true)');
      assert.strictEqual(f.title, TIP.focusOn);
      assert.strictEqual(f.getAttribute('aria-label'), TIP.focusOn);
      assert.strictEqual(f.textContent.trim(), '✕');
      assert.ok(f.classList.contains('pinon'));
      M.ev('__setFocus(false)');
      assert.strictEqual(f.title, TIP.focusOff);
      assert.ok(f.querySelector('svg.ic') && !f.classList.contains('pinon'), '해제 뒤 아이콘이 돌아오지 않는다');
      const bar = M.doc.getElementById('hostbar');
      assert.ok(!bar.textContent.includes(OLD) && ![...bar.querySelectorAll('[title]')].some((e) => e.title.includes(OLD)), '제목줄에 「넓게 보기」 가 보인다');
    });

    test('R2 (V4): 제목줄에 「_」 없음 · ✕ 툴팁 = 트레이 켬 「트레이로 숨기기 (종료는 ☰ 메뉴)」 / 끔 「닫기(종료)」', () => {
      const bar = M.doc.getElementById('hostbar');
      assert.ok(bar, '#hostbar 가 없다(위젯 모드 부팅 실패)');
      assert.strictEqual(M.doc.getElementById('hbHide'), null, '#hbHide 가 있다');
      assert.strictEqual(bar.querySelector('[data-host="hide"]'), null, 'data-host="hide" 버튼이 있다');
      assert.deepStrictEqual([...bar.querySelectorAll('button[data-host]')].map((b) => b.dataset.host), ['focus', 'pin', 'menu', 'close']);
      const c = bar.querySelector('button[data-host="close"]');
      assert.strictEqual(c.title, TIP.closeQuit, '기본(호스트가 상태를 알리기 전) ✕ 툴팁');
      M.ev('__setTray(true)');
      assert.strictEqual(c.title, TIP.closeTray);
      assert.strictEqual(c.getAttribute('aria-label'), TIP.closeTray);
      assert.strictEqual(bar.querySelectorAll('button[data-host]').length, 4, '트레이를 켜자 버튼이 늘었다');
      M.ev('__setTray(false)');
      assert.strictEqual(c.title, TIP.closeQuit);
      assert.strictEqual(c.getAttribute('aria-label'), TIP.closeQuit);
    });

    test('R3 (V3): 설정에 전송 모드 라디오가 없고, 보고서 창에 모드 배지·실제 제출 톤이 없다', async () => {
      M.ev('openSettings()');
      assert.strictEqual(M.doc.querySelectorAll('#settingsModal input[name="ncMode"]').length, 0, '설정에 전송 모드 라디오가 있다');
      assert.ok(!M.doc.getElementById('settingsModal').textContent.includes('미제출 테스트'), '설정에 「미제출 테스트」 문구가 남아 있다');
      M.ev("closeModal('#settingsModal')");
      await waitFor(() => overlayClosed(M, 'settingsModal'), '설정이 닫힌다');
      M.ev("try{ localStorage.setItem('tc_netcusMode', 'real'); }catch(_){}; openReport(); updateRptSendVis();");
      assert.strictEqual(M.doc.getElementById('rptSendMode'), null, '보고서 창에 전송 모드 배지가 있다');
      const b = M.doc.getElementById('btnRptSend');
      assert.ok(!b.classList.contains('real'), '전송 버튼이 「실제 제출」 톤을 입었다(모드 분기가 남았다)');
      assert.ok(b.title.includes('실제로 제출됩니다'), '위젯 일간 전송 버튼 툴팁이 「실제로 제출」을 말하지 않는다');
      M.ev("closeModal('#reportModal')");
      await waitFor(() => overlayClosed(M, 'reportModal'), '보고서가 닫힌다');
    });

    test('R4 (V3·U4): 일간 전송 — 확인창 수락 뒤에만 netcusSubmit 1건 · dryRun === false(예전 저장값 dry 무시)', async () => {
      const r = await sendDaily(M, true);
      assert.strictEqual(r.cf.title, '일간보고 제출');
      assert.strictEqual(r.cf.ok, '제출');
      assertRealSubmit(r);
      M.ev("window.__netcusResult(true, '시험 회신'); closeModal('#reportModal')");   // 버튼 잠금 해제(호스트 회신 흉내 — 아무것도 보내지 않는다)
      await waitFor(() => overlayClosed(M, 'reportModal'), '보고서가 닫힌다');
    });

    test('R5 (U4): 확인창에서 취소하면 호스트로 아무것도 나가지 않고 버튼도 잠기지 않는다', async () => {
      const r = await sendDaily(M, false);
      assert.strictEqual(r.whileAsking, 0);
      assert.strictEqual(r.sent.length, 0, '취소했는데 netcus 메시지가 나갔다: ' + JSON.stringify(r.sent.map((x) => x.cmd)));
      assert.strictEqual(M.ev("$('#btnRptSend').disabled"), false, '취소했는데 전송 버튼이 잠겼다');
      M.ev("closeModal('#reportModal')");
      await waitFor(() => overlayClosed(M, 'reportModal'), '보고서가 닫힌다');
    });

    test('R6: 가짜 호스트는 받은 메시지를 어디에도 전달하지 않는다(실제 netcus 제출 경로 없음)', () => {
      //  postMessage 는 배열 push 뿐 — 응답·전달 경로가 없다. netcus 메시지는 R4 의 netcusSubmit 1건뿐이어야 한다.
      const nc = M.posted.filter((x) => /^netcus/.test(String(x.cmd || '')));
      assert.deepStrictEqual(nc.map((x) => [x.cmd, x.dryRun]), [['netcusSubmit', false]]);
    });

    // ── (M) 실행 변이 ─────────────────────────────────────────────────
    test('변이 R-M1: payload 를 dryRun:true 로 바꾸면 실행 계약(R4)이 잡는다', async () => {
      const bad = mutate(app, 'hours: rptHours, dryRun: false };', 'hours: rptHours, dryRun: true };');
      const B = boot(bad);
      try {
        const r = await sendDaily(B, true);
        assert.strictEqual(r.sent.length, 1, '변이 앱에서 전송이 일어나지 않았다(변이가 경로에 닿지 않았다)');
        assert.throws(() => assertRealSubmit(r), /dryRun/);
      } finally { await B.close(); }
    });
    test('변이 R-M2: #hbHide 를 되살리면 실행 계약(R2)이 잡는다', async () => {
      const bad = mutate(app, '      <button data-host="pin" id="hbPin"',
        '      <button data-host="hide" id="hbHide" title="트레이로 숨기기" style="display:none">_</button>\n      <button data-host="pin" id="hbPin"');
      const B = boot(bad);
      try {
        const hosts = [...B.doc.querySelectorAll('#hostbar button[data-host]')].map((b) => b.dataset.host);
        assert.notDeepStrictEqual(hosts, ['focus', 'pin', 'menu', 'close'], '변이가 제목줄에 닿지 않았다');
        assert.ok(B.doc.getElementById('hbHide'), '변이 앱에 #hbHide 가 없다');
      } finally { await B.close(); }
    });
    test('변이 R-M3: 옛 툴팁을 되돌리면 실행 계약(R1)이 잡는다', async () => {
      const bad = mutate(app, `  focusOff:  '${TIP.focusOff}',`, "  focusOff:  '넓게 보기 — 크게 펼쳐서 작업',");
      const B = boot(bad);
      try {
        const f = B.doc.getElementById('hbFocus');
        assert.notStrictEqual(f.title, TIP.focusOff, '변이가 툴팁에 닿지 않았다');
        assert.ok(f.title.includes(OLD));
      } finally { await B.close(); }
    });
    test('R 정리: 부팅한 위젯 창을 닫는다(타이머가 러너 종료를 붙잡지 않게)', async () => { await M.close(); });
  }
}
