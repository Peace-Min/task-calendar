// 화면 혼란 3건 정리(docs/UI-CLARITY-2026-10-01.md U1–U6 · V1–V4) — 이름·전송 모드·중복 버튼.
//
// 이 파일이 지키는 것:
//   (S) 정적 계약 — 「넓게 보기」 → 「맨 앞에 띄우기」(제목줄·☰ 메뉴·안내 · 과거 패치노트는 그대로) · 아이콘 교체 ·
//       회사 전송은 늘 실제 제출(전송 모드 라디오·배지·버튼 톤 없음 · 예전 저장값 미독 · 근태 화면의 일간 보내기 payload 는 dryRun:false 상수) ·
//       제목줄 「_」(트레이로 숨기기) 없음 + ✕ 툴팁이 트레이 상태를 따른다 · 호스트 닫기/숨기기 동작 불변(U6).
//   (R) jsdom 실행 — 위젯 모드(가짜 호스트)로 부팅해 제목줄·트레이 툴팁과 설정에 전송 모드가 없음을 본다.
//       보내기 실행(dryRun === false)은 attendance-web 의 (A) 보내기 시험이 가짜 호스트로 본다.
//       ★ 실제 전송은 없다: 가짜 chrome.webview.postMessage 는 배열에 넣기만 한다(아무 데도 전달하지 않는다).
//   (M) 변이 — #hbHide 복원 · dryRun:true · 옛 이름 복귀 · 예전 저장값 다시 읽기를 각각 잡는다.
//
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, stripCsComments,
         importOptional, countTestsBelow, SKIP_NO_JSDOM, readText } from './harness.mjs';

const app = loadAppSource();
const mainwin = readText(new URL('../widget/MainWindow.xaml.cs', import.meta.url));

const OLD = '넓게 보기';
const TIP = {
  focusOff:  '맨 앞에 띄우기: 크기와 위치는 그대로 두고 다른 창 위에 띄웁니다 (다시 누르거나 Esc 로 해제)',
  focusOn:   '맨 앞 해제 (Esc)',
  closeTray: '닫기: 트레이로 숨깁니다. 미리알림은 계속 동작하고, 완전히 끄려면 ☰ 메뉴의 종료를 누릅니다.',
  closeQuit: '닫기(종료)',
};

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
// 근태 화면의 일간 보내기(보고서 창의 [회사 전송]은 없앴다): payload 를 만드는 atBuildSubmit 과 보내는 atSubmit.
//  제출 전 확인 창은 두지 않는다(UI-FEEDBACK-ATTENDANCE §2.2: 다시 하면 되는 동작은 묻지 않는다).
function dailySendBranch(src) {
  return windowFnDecl(src, 'atBuildSubmit') + '\n' + windowFnDecl(src, 'atSubmit');
}
function windowFnDecl(src, name) {
  const a = src.indexOf('function ' + name + '(');
  assert.ok(a > 0, name + ' 을 찾지 못했다');
  const b = src.indexOf('\n}\n', a);
  assert.ok(b > a, name + ' 의 끝을 찾지 못했다');
  return src.slice(a, b + 3);
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
    assert.ok(/<button data-host="focus" id="hbFocus" title="\$\{HB_TIP\.focusOff\}" aria-label="\$\{HB_TIP\.focusOff\}" aria-pressed="false">\$\{ICON\.front\}<\/button>/.test(mk),
      '#hbFocus 가 HB_TIP.focusOff(title·aria-label) + ICON.front 가 아니다');
    assert.ok(!mk.includes('⤢'), '제목줄 마크업에 확대 글리프(⤢)가 남아 있다 — 「넓게 보기」로 읽힌다');
    const sf = windowFn(src, '__setFocus');
    assert.ok(/HB_TIP\.focusOn/.test(sf) && /HB_TIP\.focusOff/.test(sf) && /aria-label/.test(sf) && /aria-pressed/.test(sf),
      '__setFocus 가 HB_TIP·aria-label·aria-pressed 로 상태를 바꾸지 않는다');
    //  켜짐을 ✕ 로 보이면 바로 옆 창 닫기 ✕ 와 헷갈린다(WINDOW-UI §1). 아이콘은 그대로 두고 눌린 바탕(pinon)만 바꾼다.
    assert.ok(!sf.includes("'✕'") && !/innerHTML/.test(sf), '__setFocus 가 아이콘을 ✕ 로 바꾼다(닫기 버튼과 헷갈린다)');
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
  // U3 · V3 — 일간 보내기는 늘 dryRun:false 상수, 모드 분기와 예전 저장값이 없고, 보내기는 막을 것을 거른 뒤에만 한다.
  //  (U4 의 제출 전 확인 창은 보고서 창의 [회사 전송]과 함께 없앴다. 근태 화면은 묻지 않는다. 실행 쪽은 attendance-web 의 (A) 보내기 시험이 본다.)
  dailyAlwaysReal(src) {
    const d = dailySendBranch(src);
    const b = windowFnDecl(src, 'atBuildSubmit');
    assert.ok(b.includes('dryRun: false }'), '일간 전송 payload 가 dryRun:false 가 아니다');
    assert.ok(!/dryRun:(?!\s*false\b)/.test(d), '일간 전송 payload 의 dryRun 이 false 상수가 아니다(모드 분기가 남았다)');
    assert.ok(!d.includes('localStorage') && !d.includes('tc_netcusMode'), '일간 보내기가 저장값을 읽는다(전송 모드 저장값은 없다)');
    const s = windowFnDecl(src, 'atSubmit');
    const blocked = s.indexOf('if(atSubmitBlocked()) return;');
    const send = s.indexOf('Platform.report.submitDaily(payload);');
    assert.ok(blocked > 0 && send > blocked, '막을 블록을 거르기 전에 보낸다');
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
    assert.strictEqual((mk.match(/<button data-host=/g) || []).length, 6, '제목줄 버튼이 6개(맨 앞, 부착, 메뉴, 최소화, 최대화, 닫기)가 아니다');
    assert.ok(/<button data-host="close" id="hbClose" class="cap-close" title="\$\{HB_TIP\.closeQuit\}" aria-label="\$\{HB_TIP\.closeQuit\}">\$\{CAP_ICON\.close\}<\/button>/.test(mk),
      '닫기가 #hbClose(창 버튼 cap-close) · HB_TIP.closeQuit 기본 툴팁이 아니다');
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
test('S5 (U3·V3): 일간 전송 payload 는 dryRun:false 상수 · 막을 블록을 거른 뒤에만 보낸다', () => S.dailyAlwaysReal(app));
test('S6 (U5·V4): 제목줄에 「_」(#hbHide) 없음 · ✕ 툴팁은 __setTray 가 트레이 상태로 정한다', () => S.trayCloseOnly(app));
test('S7 (U6): 호스트 ✕/숨기기/종료 동작은 그대로다', () => S.hostCloseUnchanged(mainwin));
test('S8 (V2): 사용 안내·설정 안내가 새 이름을 말한다', () => {
  //  WINDOW-UI §2: 맨 앞에 띄우기는 크기를 바꾸지 않는다. 크게 보기는 창 버튼 최대화가 맡는다.
  assert.ok(app.includes('<li><b>맨 앞에 띄우기</b>(제목줄 버튼이나 ☰ 메뉴)는 크기와 위치는 그대로 두고 다른 창 위에 띄웁니다.'), '사용 안내(창 모드와 크기)가 새 동작을 말하지 않는다');
  assert.ok(app.includes("'맨 앞에 띄우기'(크기는 그대로 다른 창 위에) 지원"), '도움말(창 모드)이 새 동작을 말하지 않는다');
  assert.ok(app.includes('제목줄의 최대화 버튼으로 창을 크게 펼치면 가장 잘 보입니다.'), '설정(월 보기 밀도) 안내가 최대화를 말하지 않는다');
  assert.ok(!/다른 창 위에 크게/.test(app.slice(0, patchRange(app)[0]) + app.slice(patchRange(app)[1])), '안내에 예전 동작(다른 창 위에 크게)이 남아 있다');
  assert.ok(app.includes('<b>실제로 제출</b>합니다(근태 탭 일간의 [보고]를 누르면 바로 보냅니다)'), '설정(회사 일간보고) 안내가 「늘 실제 제출」을 말하지 않는다');
});

// ── (M) 정적 변이 ────────────────────────────────────────────────────
test('변이 M1: #hbHide 를 되살리면 S6 이 잡는다', () => {
  const bad = mutate(app, '      <button data-host="pin" id="hbPin"',
    '      <button data-host="hide" id="hbHide" title="트레이로 숨기기" style="display:none">_</button>\n      <button data-host="pin" id="hbPin"');
  assert.throws(() => S.trayCloseOnly(bad), /hbHide|data-host="hide"|4개/);
});
test('변이 M2: payload 를 dryRun:true 로 보내면 S5 가 잡는다', () => {
  const bad = mutate(app, 'hours: atHoursPayload(c.blocks), dryRun: false };', 'hours: atHoursPayload(c.blocks), dryRun: true };');
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
test('변이 M5: 예전 저장값(tc_netcusMode)을 다시 읽으면 S4 가 잡는다', () => {
  const bad = mutate(app, 'hours: atHoursPayload(c.blocks), dryRun: false };',
    "hours: atHoursPayload(c.blocks), dryRun: (function(){ try{ return localStorage.getItem('tc_netcusMode') !== 'real'; }catch(_){ return true; } })() };");
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
  //  닫힘 = 'hidden' 까지(닫는 애니메이션 'closing' 동안은 아직 닫히지 않았다).
  const overlayClosed = (m, id) => { const o = m.doc.getElementById(id); return !o || o.classList.contains('hidden'); };
  let M = null, bootErr = null;
  try { M = boot(app); } catch (e) { bootErr = e; }
  if (bootErr) {
    test('R0: 위젯 모드 부팅', () => { throw bootErr; });
  } else {
    test('R1 (V1): 제목줄 #hbFocus — 「맨 앞에 띄우기」 툴팁·aria · 겹친 창 SVG, 켜면 눌린 바탕 + 「맨 앞 해제 (Esc)」(아이콘은 그대로)', () => {
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
      assert.ok(f.querySelector('svg.ic') && !f.textContent.includes('✕'), '켜짐에서 아이콘이 ✕ 로 바뀌었다(닫기와 헷갈린다)');
      assert.strictEqual(f.getAttribute('aria-pressed'), 'true');
      assert.ok(f.classList.contains('pinon'));
      M.ev('__setFocus(false)');
      assert.strictEqual(f.title, TIP.focusOff);
      assert.ok(f.querySelector('svg.ic') && !f.classList.contains('pinon'), '해제 뒤 아이콘이 돌아오지 않는다');
      assert.strictEqual(f.getAttribute('aria-pressed'), 'false');
      const bar = M.doc.getElementById('hostbar');
      assert.ok(!bar.textContent.includes(OLD) && ![...bar.querySelectorAll('[title]')].some((e) => e.title.includes(OLD)), '제목줄에 「넓게 보기」 가 보인다');
    });

    test('R2 (V4): 제목줄에 「_」 없음 · 닫기 툴팁 = 트레이 켬 「닫기: 트레이로 숨깁니다…」 / 끔 「닫기(종료)」', () => {
      const bar = M.doc.getElementById('hostbar');
      assert.ok(bar, '#hostbar 가 없다(위젯 모드 부팅 실패)');
      assert.strictEqual(M.doc.getElementById('hbHide'), null, '#hbHide 가 있다');
      assert.strictEqual(bar.querySelector('[data-host="hide"]'), null, 'data-host="hide" 버튼이 있다');
      assert.deepStrictEqual([...bar.querySelectorAll('button[data-host]')].map((b) => b.dataset.host), ['focus', 'pin', 'menu', 'winMinimize', 'winMaximizeToggle', 'close']);
      const c = bar.querySelector('button[data-host="close"]');
      assert.strictEqual(c.title, TIP.closeQuit, '기본(호스트가 상태를 알리기 전) ✕ 툴팁');
      M.ev('__setTray(true)');
      assert.strictEqual(c.title, TIP.closeTray);
      assert.strictEqual(c.getAttribute('aria-label'), TIP.closeTray);
      assert.strictEqual(bar.querySelectorAll('button[data-host]').length, 6, '트레이를 켜자 버튼이 늘었다');
      M.ev('__setTray(false)');
      assert.strictEqual(c.title, TIP.closeQuit);
      assert.strictEqual(c.getAttribute('aria-label'), TIP.closeQuit);
    });

    test('R3 (V3): 설정에 전송 모드 라디오가 없고 전송 모드 배지도 없다', async () => {
      M.ev('openSettings()');
      assert.strictEqual(M.doc.querySelectorAll('#settingsModal input[name="ncMode"]').length, 0, '설정에 전송 모드 라디오가 있다');
      assert.ok(!M.doc.getElementById('settingsModal').textContent.includes('미제출 테스트'), '설정에 「미제출 테스트」 문구가 남아 있다');
      M.ev("closeModal('#settingsModal')");
      await waitFor(() => overlayClosed(M, 'settingsModal'), '설정이 닫힌다');
      assert.strictEqual(M.doc.getElementById('rptSendMode'), null, '전송 모드 배지가 있다');
    });

    test('변이 R-M2: #hbHide 를 되살리면 실행 계약(R2)이 잡는다', async () => {
      const bad = mutate(app, '      <button data-host="pin" id="hbPin"',
        '      <button data-host="hide" id="hbHide" title="트레이로 숨기기" style="display:none">_</button>\n      <button data-host="pin" id="hbPin"');
      const B = boot(bad);
      try {
        const hosts = [...B.doc.querySelectorAll('#hostbar button[data-host]')].map((b) => b.dataset.host);
        assert.notDeepStrictEqual(hosts, ['focus', 'pin', 'menu', 'winMinimize', 'winMaximizeToggle', 'close'], '변이가 제목줄에 닿지 않았다');
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
