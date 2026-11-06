// 작성 보조: 근태 본문 수준과 문단 모양(docs/WRITING-ASSIST.md, 이슈 #19). 시안 writing-assist-v3 의 시험(wa-test-v3 핵심, wa-dom-v3 화면)을 앱으로 옮겼다.
//
// 이 파일이 지키는 것:
//   (S) 정적: wa-core 구역 표지, 도구 자리 두 곳(일간 머리 [패널 접기] 왼쪽, 주간 머리 오른쪽 끝), 저장 키 tc_attOutline:, 정리 고리(닫기, 화면 전환, 숨기기, 보내는 중, Esc).
//   (U) 순수: wa-core 를 떼어 돌린다(수준 읽기, 수준 올리고 내리기, 번호 다시 매기기, Enter, Shift+Enter, Backspace, 붙여넣기, 표 규칙, 5줄 표 읽기).
//   (B) jsdom 근태 창(?win=attend): 일간 본문과 자유 메모, 주간 세 칸에서 키(Tab, Alt+화살표, Alt+0~7, Enter, Shift+Enter, Backspace, 붙여넣기, 한글 조합),
//       고친 뒤 ATE, AWE 가 따라온다, 문단 모양 창(7줄, 막힌 칸 수, 보이는 보고만 다시 쓰기, 창 안 Ctrl+Z, Esc 는 창만 닫기),
//       계정별 저장과 5줄 표 읽기, 열기와 초점으로는 글을 고치지 않는다, 숨기기와 화면 전환 정리, 보내는 중 잠금.
//       2차(2026-11-06): 가져오기 [서식] 줄이 없고 캘린더 불러오기는 제목 1수준, 설명 2수준(문단 모양 표, 번호), 표를 바꾸면 패널 카드도 새 모양,
//       이전 보고 출처는 그대로. 변이 셋(설명 1수준, 카드 다시 그리기 빼기, 예전 보고서 서식 함수)을 같은 검사가 잡는다.
//   3차(2026-11-06, 결정 10~15): 수준은 표와 꼭 맞는 줄만. 판정 셋(본문 0, 수준 1~7, 표와 다른 줄 WA.OTHER = 수준 칸 빈칸).
//       check3 이 기획 시험 목록(사용자 글, 먼 줄 불변, 붙여넣기, 표 바꿈 넷, 다른 줄 수준 키, Enter 는 문단 모양만 등)을 돌리고,
//       변이 넷(기호 우선 infer, 0칸 다른 줄을 항목으로, 표 바꿈이 다른 줄도 그림, 다른 줄 Enter 머리 이어 쓰기)을 같은 검사가 잡는다.
//       옛 시험 가운데 새 계약과 어긋난 것(M2 기호 우선, L2 늘 읽는 번호, 본문 Enter 들여쓰기 잇기, 이어 쓰기 줄 Tab 은 자식 등)은 새 계약으로 고쳐 두었다.
// 생략 규약: jsdom 이 없으면 (B)는 등록되지 않고 skip(판정 없음)으로 계수된다.
import vm from 'node:vm';
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
const CORE_A = '/* ----- wa-core 시작', CORE_B = '/* ----- wa-core 끝 ----- */';

// ══ (S) 정적 ══════════════════════════════════════════════════════════
test('(S) wa-core 구역이 하나 있고 DOM 을 쓰지 않는다, 도구 자리는 일간과 주간 머리에 하나씩, 저장 키는 tc_attOutline:', () => {
  const a = app.indexOf(CORE_A), b = app.indexOf(CORE_B);
  assert.ok(a > 0 && b > a && app.indexOf(CORE_A, a + 1) < 0, 'wa-core 구역 표지가 없거나 둘이다');
  assert.ok(!/document\.|window\./.test(app.slice(a, b)), 'wa-core 가 DOM 을 쓴다');
  const dh = app.slice(app.indexOf('<div class="at-ed hidden" id="atEd"'), app.indexOf('<div class="at-ed-body" id="atEdBody">'));
  assert.ok(/<span class="spacer"><\/span>\s*<!--[^>]*-->\s*<span class="wa-tools" data-watools="d"><\/span>\s*<button type="button" class="at-fold" id="atFold"/.test(dh), '일간 도구가 spacer 와 패널 접기 사이에 없다');
  const wh = app.slice(app.indexOf('<div class="at-ed aw-ed hidden" id="awEd"'), app.indexOf('<div class="at-ed-body" id="awBody">'));
  assert.ok(/<span class="spacer"><\/span>\s*<span class="wa-tools" data-watools="w"><\/span>\s*<\/div>\s*$/.test(wh), '주간 도구가 머리 줄 오른쪽 끝에 없다');
  assert.strictEqual((app.match(/class="wa-tools"/g) || []).length, 2, '도구 자리가 두 곳이 아니다');
  assert.ok(app.includes("const WA_KEY_PREFIX = 'tc_attOutline:';"), '저장 키가 다르다');
});
//  근태 창은 body 바로 아래 요소를 허용 목록으로만 보인다. jsdom 은 이 :not 사슬의 !important 를 계산하지 못해
//  2026-11-05 실제 Chromium 에서만 문단 모양 창이 안 뜨는 결함이 났다. 그래서 선택자 글자로 지킨다.
test('(S) 근태 창 허용 목록에 문단 모양 창(#waPop)이 들어 있다', () => {
  const m = /html\[data-attendwin\] body > ((?::not\(#[\w-]+\))+)\s*\{\s*display:\s*none !important/.exec(app);
  assert.ok(m, '근태 창 허용 목록 규칙을 찾지 못했다');
  assert.ok(m[1].includes(':not(#waPop)'), '근태 창 허용 목록에 #waPop 이 없다: ' + m[1]);
});
test('(S) 정리 고리: 편집 닫기(일간, 주간), 화면 전환, 근태 창 숨기기, 보내는 중(일간, 주간), 다시 그리기, Esc', () => {
  const body = (name) => { const i = app.indexOf('function ' + name + '('); assert.ok(i > 0, name + ' 가 없다'); return app.slice(i, app.indexOf('\n}', i)); };
  for (const f of ['atCloseEditor', 'awCloseEditor', 'atSyncScreen', 'atwSync']) assert.ok(body(f).includes('waReset();'), f + ' 가 작성 보조를 비우지 않는다');
  for (const f of ['atSetBusy', 'awSetBusy', 'atBlocksRender']) assert.ok(body(f).includes('waRefresh();'), f + ' 가 작성 보조 도구를 고치지 않는다');
  assert.ok(/window\.__attendWinHidden = function\(\)\{[\s\S]*?try\{ waReset\(\); \}catch\(_\)\{\}[\s\S]*?\n\};/.test(app), '__attendWinHidden 이 작성 보조를 비우지 않는다');
  assert.ok(/function atEscape\(\)\{\n  if\(waPopEscape\(\)\) return true;/.test(app), 'Esc 가 문단 모양 창을 먼저 닫지 않는다');
  assert.ok(/function atInit\(\)\{\n  awInit\(\);[^\n]*\n  waInit\(\);/.test(app), 'atInit 이 waInit 을 부르지 않는다');
});

// ══ (U) 순수: wa-core ═════════════════════════════════════════════════
function loadCore() {
  const a = app.indexOf(CORE_A), b = app.indexOf(CORE_B);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(app.slice(a, b) + '\nglobalThis.WA = WA;', ctx);
  return ctx.WA;
}
const WA = loadCore();
const SYM = WA.preset('sym'), REP = WA.preset('report'), NUM = WA.preset('num');
//  커서 표기: '|' 는 커서, '[' ']' 는 선택
function split(src) { const s = src.indexOf('['); if (s >= 0) { const e = src.indexOf(']'); return { v: src.replace('[', '').replace(']', ''), s, e: e - 1 }; } const c = src.indexOf('|'); return c < 0 ? { v: src, s: 0, e: 0 } : { v: src.replace('|', ''), s: c, e: c }; }
function show(v, s, e) { return s === e ? v.slice(0, s) + '|' + v.slice(s) : v.slice(0, s) + '[' + v.slice(s, e) + ']' + v.slice(e); }
function T(name, src, fn, exp) { const { v, s, e } = split(src); const op = fn(v, s, e); const got = op ? show(WA.applyOp(v, op), op.selS, op.selE) : null; assert.strictEqual(got, exp, name + '\n got ' + JSON.stringify(got) + '\n exp ' + JSON.stringify(exp)); }
function B(name, got, exp) { assert.strictEqual(JSON.stringify(got), JSON.stringify(exp), name + ' got ' + JSON.stringify(got)); }
const lvl = (v, t) => WA.parse(v, t).P.map((p) => p.level);
const sh = (t, d) => (v, s, e) => WA.shiftLevel(v, s, e, t, d), set = (t, L) => (v, s, e) => WA.setLevel(v, s, e, t, L);
const en = (t) => (v, s, e) => WA.enter(v, s, e, t), ce = (t) => (v, s, e) => WA.contEnter(v, s, e, t), rn = (t) => (v, s, e) => WA.renumber(v, s, e, t);
const um = (t) => (v, s, e) => WA.unmark(v, s, e, t);
const sample = '- 비행제어 법칙 V3.2 시험 절차서 검토\n  * 종축 모드 전환 조건 3건 수정 요청\n  * 횡축 감쇠 계수 근거 자료 확인\n- HILS 연동 시험\n  * 시나리오 12~18 수행\n    - 시나리오 15 응답 지연 40ms, 원인 분석 중\n  * 결과 보고서 초안 작성';
const rs = (v, a, b) => { const op = WA.reshape(v, a, b, 0, 0); return op ? WA.applyOp(v, op) : v; };
const wide = SYM.map((r, i) => ({ mk: r.mk, indent: i * 4 }));
const UN = [{ mk: '-', indent: 0 }, { mk: '*', indent: 4 }, { mk: '-', indent: 8 }, { mk: '*', indent: 12 }, { mk: '•', indent: 2 }, { mk: '*', indent: 16 }, { mk: '-', indent: 20 }];

test('(U) 시안 핵심 시험: level inference', () => {
  B('infer 기호형 sample',lvl('- a\n  * b\n    - c\n      * d\n        - e\n          * f\n            - g\n본문\n  이어',SYM),[1,2,3,4,5,6,7,0,0]);
  B('infer 보고서형',lvl('□ a\n  ○ b\n    - c\n      · d\n        * e\n          ▪ f\n            ◦ g',REP),[1,2,3,4,5,6,7]);
  B('infer 번호형',lvl('1. a\n  가. b\n    1) c\n      가) d\n        (1) e\n2. f\n  나. g',NUM),[1,2,3,4,5,1,2]);
  B('infer 번호형 numbers parsed',WA.parse('    12) x\n  다. y\n        (3) z',NUM).P.map(p=>[p.kind,p.num]),[['1)',12],['가.',3],['(1)',3]]);
  B('1.5시간 not a marker',lvl('1.5시간\n가.나\n-5도\n(1)x',NUM),[0,0,0,0]);
  B('1.5시간 not marker under 기호형',lvl('1.5시간 투입',SYM),[0]);
  B('same indent, marker decides',lvl('- a\n* b',[{mk:'-',indent:0},{mk:'*',indent:0},{mk:'○',indent:2},{mk:'·',indent:4},{mk:'*',indent:6}]),[1,2]);
  B('levelAt single',WA.levelAt('- a\n  * b',6,6,SYM),2);
  B('levelAt mixed',WA.levelAt('- a\n  * b',0,7,SYM),null);
  B('levelAt multi same (blank skipped)',WA.levelAt('- a\n\n- b',0,7,SYM),1);
  B('levelAt body',WA.levelAt('본문',1,1,SYM),0);
});
test('(U) 시안 핵심 시험: increase / decrease', () => {
  T('increase single 기호형','- a\n- b|',sh(SYM,1),'- a\n  * b|');
  T('increase caret mid keeps relative','- a\n- b|c',sh(SYM,1),'- a\n  * b|c');
  T('decrease single','- a\n  * b|',sh(SYM,-1),'- a\n- b|');
  T('decrease 1수준 to 본문 at col 0','- a\n- b|',sh(SYM,-1),'- a\nb|');
  T('decrease 1수준 first line to 본문','- a|',sh(SYM,-1),'a|');
  T('increase at 5 -> 6 (7 levels)','        - e|',sh(SYM,1),'          * e|');
  T('increase at 7 no-op','            - g|',sh(SYM,1),null);
  T('decrease 본문 no-op','abc|',sh(SYM,-1),null);
  T('increase 본문 becomes 1수준','abc|',sh(SYM,1),'- abc|');
  T('increase empty line starts item','- a\n|',sh(SYM,1),'- a\n- |');
  //  3차(결정 12): 표와 꼭 맞지 않는 줄(이어 쓰기 줄 포함)은 늘 본문에서 시작한다. 올리면 1수준
  T('increase continuation starts from 본문 (3차)','- a\n  b|',sh(SYM,1),'- a\n- b|');
  T('increase multi','[- a\n- b\n  * c]',sh(SYM,1),'[  * a\n  * b\n    - c]');
  T('decrease multi, continuation follows','- x\n[  * a\n    이어\n  * b]',sh(SYM,-1),'- x\n[- a\n  이어\n- b]');
  T('multi end at line start excludes next','[- a\n]- b',sh(SYM,1),'[  * a\n]- b');
  T('increase multi skips blank lines','[- a\n\n- b]',sh(SYM,1),'[  * a\n\n  * b]');
  // numbering after level change
  T('번호형 increase renumbers following siblings','1. a\n2. b|\n3. c',sh(NUM,1),'1. a\n  가. b|\n2. c');
  T('번호형 decrease renumbers','1. a\n  가. b\n  나. c|\n2. d',sh(NUM,-1),'1. a\n  가. b\n2. c|\n3. d');
  T('번호형 outer level resets deeper counter','1. a\n  가. b\n2. c\n  가. d|',sh(NUM,1),'1. a\n  가. b\n2. c\n    1) d|');
  T('보고서형 increase replaces marker','□ a\n□ b|',sh(REP,1),'□ a\n  ○ b|');
  T('set level 3 directly','- a\n- b|',set(SYM,3),'- a\n    - b|');
  T('set 본문 directly at col 0','- a\n  * b|',set(SYM,0),'- a\nb|');
  T('set 본문 on indented 본문 line moves to col 0','- a\n  b|',set(SYM,0),'- a\nb|');
  T('set 본문 restarts numbering below','1. a\n2. b|\n3. c',set(NUM,0),'1. a\nb|\n1. c');
  T('set level multi 번호형','[a\nb\nc]',set(NUM,1),'[1. a\n2. b\n3. c]');
});
test('(U) 시안 핵심 시험: renumber after deleting a middle item (renumber runs after the deletion input)', () => {
  T('renumber after middle item deleted','1. a\n3. c|\n4. d',rn(NUM),'1. a\n2. c|\n3. d');
  T('renumber 가나다 after delete','1. x\n  가. a\n  다. c|',rn(NUM),'1. x\n  가. a\n  나. c|');
  T('renumber nothing to do','1. a\n2. b|',rn(NUM),null);
  T('renumber leaves symbol-level lines alone','- a\n- b|',rn(SYM),null);
});
test('(U) 시안 핵심 시험: Enter', () => {
  T('enter same level symbol','- a|',en(SYM),'- a\n- |');
  T('enter keeps indent and marker','  * b|',en(SYM),'  * b\n  * |');
  T('enter next number','1. a|',en(NUM),'1. a\n2. |');
  T('enter next number renumbers following','1. a|\n2. b',en(NUM),'1. a\n2. |\n3. b');
  T('enter 가. -> 나.','1. x\n  가. a|',en(NUM),'1. x\n  가. a\n  나. |');
  T('enter (1) -> (2)','        (1) a|',en(NUM),'        (1) a\n        (2) |');
  T('enter mid-line splits','- ab|cd',en(SYM),'- ab\n- |cd');
  T('enter mid-line drops spaces after caret','- ab| cd',en(SYM),'- ab\n- |cd');
  T('enter on indented 본문 makes 0칸 empty line (3차 결정 15)','  이어|',en(SYM),'  이어\n|');
  T('enter 1.5시간 plain','1.5시간|',en(NUM),'1.5시간\n|');
  // M3: caret in item head inserts empty same-level item above (was: split inside leading ws)
  T('enter caret inside leading ws -> empty item above','  |  - x',en(SYM),'    - \n  |  - x');
  // empty item Enter: 수준을 바꾸지 않는다(2026-11-05 사용자 결정)
  T('empty 2수준 item keeps level','- a\n  * |',en(SYM),'- a\n  * \n  * |');
  T('empty 1수준 item keeps level','- a\n- |',en(SYM),'- a\n- \n- |');
  T('empty 번호 2수준 keeps level next number','1. a\n  가. b\n  나. |',en(NUM),'1. a\n  가. b\n  나. \n  다. |');
  T('empty 1수준 numbered keeps level','1. a\n2. |\n3. c',en(NUM),'1. a\n2. \n3. |\n4. c');
  // Shift+Enter: 맨 앞(0칸) 본문 줄(2026-11-05 사용자 결정)
  T('shift+enter 본문 line at col 0','- abc|',ce(SYM),'- abc\n|');
  T('shift+enter 번호형 본문 line','  가. abc|',ce(NUM),'  가. abc\n|');
  T('shift+enter mid-line moves rest','- ab| cd',ce(SYM),'- ab\n|cd');
  T('shift+enter on indented 본문 line','- a\n  bc|',ce(SYM),'- a\n  bc\n|');
});
test('(U) 시안 핵심 시험: preset switch reshape', () => {
  B('reshape 기호형 -> 번호형',rs(sample,SYM,NUM),'1. 비행제어 법칙 V3.2 시험 절차서 검토\n  가. 종축 모드 전환 조건 3건 수정 요청\n  나. 횡축 감쇠 계수 근거 자료 확인\n2. HILS 연동 시험\n  가. 시나리오 12~18 수행\n    1) 시나리오 15 응답 지연 40ms, 원인 분석 중\n  나. 결과 보고서 초안 작성');
  B('reshape 기호형 -> 보고서형',rs(sample,SYM,REP),'□ 비행제어 법칙 V3.2 시험 절차서 검토\n  ○ 종축 모드 전환 조건 3건 수정 요청\n  ○ 횡축 감쇠 계수 근거 자료 확인\n□ HILS 연동 시험\n  ○ 시나리오 12~18 수행\n    - 시나리오 15 응답 지연 40ms, 원인 분석 중\n  ○ 결과 보고서 초안 작성');
  B('reshape round trip 번호형 -> 기호형',rs(rs(sample,SYM,NUM),NUM,SYM),sample);
  B('reshape 보고서형 round trip',rs(rs(sample,SYM,REP),REP,SYM),sample);
  B('reshape moves aligned continuation',rs('1. abc\n   이어\n2. d',NUM,SYM),'- abc\n  이어\n- d');
  B('reshape indent change',rs('- a\n  * b\n    - c',SYM,wide),'- a\n    * b\n        - c');
  B('reshape no change -> null',WA.reshape(sample,SYM,SYM,0,0),null);
  B('reshape keeps 1.5시간 line',rs('- 투입\n1.5시간 소요',SYM,NUM),'1. 투입\n1.5시간 소요');
  { const v='- a\n  * b'; const op=WA.reshape(v,SYM,NUM,8,8); B('reshape maps caret',[WA.applyOp(v,op),op.selS],['1. a\n  가. b',10]); }
  // single replacement: diff op is one contiguous range
  { const v='1. a\n2. b\n3. c'; const op=WA.shiftLevel(v,6,6,NUM,1); B('op is one contiguous replacement',[op.from,op.to,op.text],[5,11,'  가. b\n2']); }
});
test('(U) 시안 핵심 시험: review 2', () => {
  // H3 (2026-11-05 relaxed): only same marker + same indent is blocked; order is free
  B('H3 indentBlocked level1 (- at 4,8,12)',WA.indentBlocked(SYM,0),[4,8,12]);
  B('H3 indentBlocked level2 (* at 6,10)',WA.indentBlocked(SYM,1),[6,10]);
  B('H3 indentBlocked level3',WA.indentBlocked(SYM,2),[0,8,12]);
  B('H3 indentBlocked level7',WA.indentBlocked(SYM,6),[0,4,8]);
  B('H3 indentBlocked unique numbered marker',WA.indentBlocked(NUM,0),[]);
  B('H3 indentBlocked with candidate marker',WA.indentBlocked(NUM,0,'가.'),[2]);
  // M1: numbering restart under a 0-indent body line
  T('M1 heading restarts numbering','1. a\n2. b\n회의\n3. c|\n4. d',rn(NUM),'1. a\n2. b\n회의\n1. c|\n2. d');
  T('M1 blank line does not restart','1. a\n\n3. b|',rn(NUM),'1. a\n\n2. b|');
  T('M1 continuation line does not restart','1. a\n   이어\n3. b|',rn(NUM),'1. a\n   이어\n2. b|');
  T('M1 enter after heading starts at 1','1. a\n회의\n1. x|',en(NUM),'1. a\n회의\n1. x\n2. |');
  T('M1 1.5시간 at 0 indent is a heading','1. a\n1.5시간 소요\n2. b|',rn(NUM),'1. a\n1.5시간 소요\n1. b|');
  // M2: marker-first inference
  //  3차(결정 10~12): 기호만 맞고 칸 수가 다르면 항목이 아니다. 0칸이면 본문(0), 들여 썼으면 표와 다른 줄(OTHER)
  B('M2->3차 numbered marker with wrong indent is not an item',lvl('가. x\n      1. y\n(1) z',NUM),[0,WA.OTHER,0]);
  B('M2->3차 symbol with wrong indent is not an item (보고서형)',lvl('- x\n○ y\n        □ z',REP),[0,0,WA.OTHER]);
  B('M2 symbol on several levels uses indent',lvl('- a\n    - b\n        - c\n  * d\n      * e',SYM),[1,3,5,2,4]);
  B('M2->3차 symbol not in table: 본문 at 0칸, 표와 다른 줄 when indented',lvl('• a\n  • b\n    • c',SYM),[0,WA.OTHER,WA.OTHER]);
  B('M2 U+3000 and NBSP read as whitespace',WA.parse('　* a\n  * b',SYM).P.map(p=>[p.item,p.level,p.ws.length]),[[true,2,1],[true,2,2]]);
  B('M2 U+3000 counts two columns',lvl('- a\n　　- b',SYM),[1,3]);
  //  3차: 표와 다른 번호 줄은 번호를 다시 매기지 않는다(먼 줄 불변). 표에 없는 형식(나.)은 글이다
  B('M2->3차 foreign numbered lines are left alone on renumber',WA.renumber('1. a\n  나. b\n  1) c\n  1) d',0,0,[{mk:'1.',indent:0},{mk:'-',indent:2},{mk:'1)',indent:4},{mk:'*',indent:6},{mk:'-',indent:8}]),null);
  { const t=[{mk:'가.',indent:0},{mk:'-',indent:2},{mk:'1)',indent:4},{mk:'*',indent:6},{mk:'-',indent:8}]; const v='1. a\n2. b|\n3. c'; const s=v.indexOf('|'); const w=v.replace('|',''); const op=WA.enter(w,s,s,t); B('M2->3차 enter on 본문 "2. b" (1. not in table) is a 0칸 empty line, no renumber',WA.applyOp(w,op),'1. a\n2. b\n\n3. c'); }
  // M2: paste normalisation
  B('M2 normPaste tab/ideographic/nbsp',WA.normPaste('\t- a\n　* b\n  - c\r\nx\ty'),'  - a\n  * b\n  - c\nx\ty');
  B('M2 normPaste mixed leading',WA.normPaste('　\t z'),'     z');
  { const v='1. a\n2. b'; const op=WA.pasteOp(v,4,4,'\n1. x\n1. y',NUM); B('M2 pasteOp inserts normalised and renumbers in one op',[WA.applyOp(v,op),op.selS],['1. a\n2. x\n3. y\n4. b',14]); }
  { const v='- a\n'; const op=WA.pasteOp(v,4,4,'\t* b',SYM); B('M2 pasteOp tab -> 2 spaces',WA.applyOp(v,op),'- a\n  * b'); }
  // L2: BASE_NUMS only when the table has a numbered format
  B('L2 symbol-only table: "1. 일정" not an item',lvl('1. 일정\n가. 회의\n(1) x',SYM),[0,0,0]);
  B('L2 보고서형 (no numbers): not an item',lvl('1. 일정',REP),[0]);
  //  3차(결정 13): 시험 184 뒤집기. 표에 A. 만 있으면 1. 가. 는 글이다(늘 읽던 번호 형식을 걷었다)
  B('L2->3차 table with only A. does not read 1. or 가.',lvl('1. 일정\n가. 회의\n    A. 셋',[{mk:'-',indent:0},{mk:'*',indent:2},{mk:'A.',indent:4},{mk:'*',indent:6},{mk:'-',indent:8}]),[0,0,3]);
  T('L2 enter on "1. 일정" under symbol table is plain','1. 일정|',en(SYM),'1. 일정\n|');
  // M3: Enter edge cases
  T('M3 caret at line start of item inserts above','- a\n|- b',en(SYM),'- a\n- \n|- b');
  T('M3 caret after marker before gap inserts above','- a\n-| b',en(SYM),'- a\n- \n- |b');
  T('M3 numbered head insert renumbers original','1. a\n2|. b\n3. c',en(NUM),'1. a\n2. \n3. |b\n4. c');
  T('M3 numbered head insert caret in ws stays','  가. a\n  |나. b',en([{mk:'1.',indent:0},{mk:'가.',indent:2},{mk:'1)',indent:4},{mk:'가)',indent:6},{mk:'(1)',indent:8}]),'  가. a\n  나. \n  |다. b');
  //  3차(결정 15): 본문 줄(빈칸만 있는 줄 포함)의 Enter 는 0칸 빈 줄. 커서 앞뒤 빈칸은 걷는다
  T('whitespace-only line: Enter makes 0칸 line','- a\n  |\n- b',en(SYM),'- a\n\n|\n- b');
  T('whitespace-only line caret mid ws','- a\n  |  ',en(SYM),'- a\n\n|');
  T('M3 empty line Enter still adds line','- a\n|',en(SYM),'- a\n\n|');
  T('M3 mid text trims trailing spaces before caret','- ab  |cd',en(SYM),'- ab\n- |cd');
  T('M3 mid text trims both sides','- ab  |  cd',en(SYM),'- ab\n- |cd');
  T('M3 body line mid text trims, rest goes to 0칸','  이어  |다음',en(SYM),'  이어\n|다음');
  T('M3 trim never eats into head','- |ab',en(SYM),'- \n- |ab');
  T('M3 shift+enter also trims before caret','- ab  |cd',ce(SYM),'- ab\n|cd');
  // M4: Backspace at end of head removes marker -> continuation line
  T('M4 backspace at head end makes continuation','- a\n- |b',um(SYM),'- a\n  |b');
  T('M4 nested item to continuation under parent text','- a\n  * |b',um(SYM),'- a\n  |b');
  T('M4 numbered renumbers following','1. a\n2. |b\n3. c',um(NUM),'1. a\n   |b\n2. c');
  T('M4 first line becomes 0-indent body','- |a',um(SYM),'|a');
  T('M4 empty item','- a\n- |',um(SYM),'- a\n  |');
  T('M4 not at head end: null (native)','- a|',um(SYM),null);
  T('M4 body line: null (native)','- a\n  |b',um(SYM),null);
  T('M4 selection: null (native)','- [a]',um(SYM),null);
  T('M4 caret inside marker: null','-| a',um(SYM),null);
});
test('(U) 시안 핵심 시험: 7 levels', () => {
  B('LEVELS 7, presets 7 rows',[WA.LEVELS,WA.IND_MAX,SYM.length,REP.length,NUM.length],[7,20,7,7,7]);
  B('preset sym markers/indents',SYM.map(r=>r.mk+r.indent).join(' '),'-0 *2 -4 *6 -8 *10 -12');
  B('presets valid (no conflicts)',[WA.conflicts(SYM),WA.conflicts(REP),WA.conflicts(NUM)],[[],[],[]]);
  T('7L decrease 7 -> 6','            - g|',sh(SYM,-1),'          * g|');
  T('7L set level 6 (Alt+6)','- a|',set(SYM,6),'          * a|');
  T('7L set level 7 (Alt+7)','- a|',set(SYM,7),'            - a|');
  T('7L set level 7 numbered','1. a\n  가. b|',set(NUM,7),'1. a\n            ① b|');
  T('7L enter level 7 ① -> ②','            ① a|',en(NUM),'            ① a\n            ② |');
  T('7L enter level 6 (가) -> (나)','          (가) a|',en(NUM),'          (가) a\n          (나) |');
  B('7L infer 번호형 6/7',lvl('1. a\n  가. b\n    1) c\n      가) d\n        (1) e\n          (가) f\n            ① g\n            ② h\n          (나) i',NUM),[1,2,3,4,5,6,7,7,6]);
  T('7L renumber 6/7 counters reset under 6','1. a\n          (가) b\n            ① c\n            ③ d\n          (다) e\n            ⑤ f|',rn(NUM),'1. a\n          (가) b\n            ① c\n            ② d\n          (나) e\n            ① f|');
  T('7L increase 5 -> 6 numbered renumbers','        (1) a\n        (2) b|',sh(NUM,1),'        (1) a\n          (가) b|');
  T('7L multi increase stops at 7','[          * f\n            - g]',sh(SYM,1),'[            - f\n            - g]');
  // unordered indents: 5수준 at 2 with its own marker
  B('unordered table valid',WA.conflicts(UN),[]);
  B('unordered infer: unique • is 5 at indent 2',lvl('- a\n  • b\n    * c\n        - d\n            * e\n                * f\n                    - g',UN),[1,5,2,3,4,6,7]);
  //  3차(결정 12): 칸 수가 표와 다른 줄은 가까운 수준으로 짐작하지 않는다. 표와 다른 줄이고, 수준 키는 본문에서 시작
  B('unordered 3차: shared * at other indents are 표와 다른 줄',lvl('   * x\n              * y\n                 * z',UN),[WA.OTHER,WA.OTHER,WA.OTHER]);
  B('unordered 3차: shared - at other indents are 표와 다른 줄',lvl('  - x\n      - y\n                   - z',UN),[WA.OTHER,WA.OTHER,WA.OTHER]);
  T('unordered 3차: Tab on 표와 다른 줄 gives 1수준','   * x\n              * y|',sh(UN,1),'   * x\n- y|');
  T('unordered 3차: Alt+4 on 표와 다른 줄','  - x|\n      - y',set(UN,4),'            * x|\n      - y');
  B('unordered reshape round trip',rs(rs(sample,SYM,UN),UN,SYM),sample);
  B('unordered reshape renders 5수준 shallow',rs('- a\n  * b\n    - c\n      * d\n        - e',SYM,UN),'- a\n    * b\n        - c\n            * d\n  • e');
  T('unordered set level 5','- a\n- b|',set(UN,5),'- a\n  • b|');
  T('unordered decrease from 5 -> 4','- a\n  • b|',sh(UN,-1),'- a\n            * b|');
  // duplicate marker + indent detection
  B('conflicts detects same mk + indent',WA.conflicts([{mk:'-',indent:0},{mk:'*',indent:2},{mk:'-',indent:0},{mk:'*',indent:6},{mk:'1.',indent:2},{mk:'1.',indent:2},{mk:'*',indent:2}]),[[0,2],[1,6],[4,5]]);
  B('conflicts: same indent different marker is fine',WA.conflicts([{mk:'-',indent:0},{mk:'*',indent:0},{mk:'1.',indent:0},{mk:'가.',indent:0},{mk:'□',indent:0},{mk:'○',indent:0},{mk:'·',indent:0}]),[]);
  // auto-move indent on marker change
  B('setMarker no conflict keeps indent',WA.setMarker(SYM,1,'-')[1],{mk:'-',indent:2});
  B('setMarker 4수준 * -> - at 6 is free',WA.setMarker(SYM,3,'-')[3],{mk:'-',indent:6});
  { const t=SYM.map(r=>({...r})); t[5].indent=4; B('setMarker conflict at 4 -> 5 (deeper first)',WA.setMarker(t,5,'-')[5],{mk:'-',indent:5}); B('setMarker result has no conflicts',WA.conflicts(WA.setMarker(t,5,'-')),[]); }
  { const t=[{mk:'-',indent:20},{mk:'*',indent:20},{mk:'-',indent:0},{mk:'*',indent:2},{mk:'-',indent:4},{mk:'*',indent:6},{mk:'-',indent:8}]; B('setMarker at cap 20 goes shallower',WA.setMarker(t,1,'-')[1],{mk:'-',indent:19}); }
  B('setMarker 20 and 19 taken -> 18',WA.setMarker([{mk:'-',indent:20},{mk:'-',indent:19},{mk:'*',indent:20}],2,'-')[2],{mk:'-',indent:18});
  B('setMarker does not mutate input',[WA.setMarker(SYM,3,'-')!==SYM,SYM[3].mk],[true,'*']);
  B('freeIndent prefers deeper at same distance',WA.freeIndent([{mk:'-',indent:4},{mk:'-',indent:0}],1,4),5);
  // loading a saved 5-row table
  B('fitTable 5-row sym -> defaults appended',WA.fitTable(SYM.slice(0,5)),SYM);
  B('fitTable 5-row num keeps rows, adds * and -',WA.fitTable(NUM.slice(0,5)).map(r=>r.mk+r.indent).join(' '),'1.0 가.2 1)4 가)6 (1)8 *10 -12');
  B('fitTable 5-row conflict -> smallest >= prev+2',WA.fitTable([{mk:'-',indent:0},{mk:'*',indent:2},{mk:'-',indent:4},{mk:'*',indent:10},{mk:'-',indent:12}]).slice(5),[{mk:'*',indent:14},{mk:'-',indent:16}]);
  B('fitTable 5-row conflict capped at 20',WA.fitTable([{mk:'-',indent:0},{mk:'-',indent:2},{mk:'*',indent:10},{mk:'-',indent:12},{mk:'*',indent:20}]).map(r=>r.mk+r.indent).join(' '),'-0 -2 *10 -12 *20 *19 -20');
  B('fitTable 7-row passes through',WA.fitTable(UN),UN);
  B('fitTable rejects junk',[WA.fitTable(null),WA.fitTable([]),WA.fitTable([{mk:'',indent:0}]),WA.fitTable([{mk:'-',indent:21}]),WA.fitTable(SYM.concat(SYM))],[null,null,null,null,null]);
  B('fitTable repairs saved duplicate',WA.fitTable([{mk:'-',indent:0},{mk:'-',indent:0}]).slice(0,2),[{mk:'-',indent:0},{mk:'-',indent:1}]);
});

// ── 3차(2026-11-06, docs/WRITING-ASSIST.md 결정 10~15): 수준은 표와 꼭 맞는 줄만 ──
//  판정 셋: 0 본문(0칸 줄, 빈 줄), 1~7 수준(앞 칸 수와 머리기호가 표와 꼭 맞는 줄), WA.OTHER 표와 다른 줄(들여 쓴 다른 줄, 수준 칸 빈칸).
//  앱이 고치는 것은 수준 줄뿐이고, 본문 줄과 표와 다른 줄은 수준 키를 누를 때만 바뀐다(늘 본문에서 시작).
//  사용자 표 U = 1수준 '-' 0칸, 2수준 '1.' 2칸, 나머지 기본(- 4, * 6, - 8, * 10, - 12).
function check3(W) {
  const sym = W.preset('sym'), num = W.preset('num'), U = W.setMarker(sym, 1, '1.'), O = W.OTHER;
  const run = (name, src, fn, exp) => { const { v, s, e } = split(src); const op = fn(v, s, e); const got = op ? show(W.applyOp(v, op), op.selS, op.selE) : null; assert.strictEqual(got, exp, name + '\n got ' + JSON.stringify(got) + '\n exp ' + JSON.stringify(exp)); };
  const eq = (name, got, exp) => assert.strictEqual(JSON.stringify(got), JSON.stringify(exp), name + ' got ' + JSON.stringify(got));
  const shown = (v, t) => { let pos = 0; return v.split('\n').map((l) => { const r = W.levelAt(v, pos, pos, t); pos += l.length + 1; return r; }); };
  const reshape = (v, a, b) => { const op = W.reshape(v, a, b, 0, 0); return op ? W.applyOp(v, op) : v; };
  const kE = (t) => (v, s, e) => W.enter(v, s, e, t), kS = (t, d) => (v, s, e) => W.shiftLevel(v, s, e, t, d), kL = (t, L) => (v, s, e) => W.setLevel(v, s, e, t, L);
  //  사용자 글 그대로(2026-11-06 사용자 화면)
  const doc = '1.구현\n- 기능개발\n  1.  UI/UX 구현\n  2.  보완\n  3.\n2. 기획';
  eq('사용자 글 수준 칸(levelAt)', shown(doc, U), [0, 1, 2, 2, O, 0]);
  eq('사용자 글 판정(parse level)', W.parse(doc, U).P.map((p) => p.level), [0, 1, 2, 2, 0, 0]);
  run('2. 기획| Enter 는 0칸 빈 본문 줄(번호 이어 쓰기 없음)', doc + '|', kE(U), doc + '\n|');
  //  먼 줄 번호 불변
  const far = '1. 구현\n- 개발\n2. 회의\n- 회의록\n3. 기타';
  run('renumber 가 본문 번호 줄을 고치지 않는다', far + '|', (v, s, e) => W.renumber(v, s, e, U), null);
  run('맨 윗줄 Enter 에 아래 본문 번호 그대로', '- 개발|\n1. 구현\n2. 회의\n- 회의록\n3. 기타', kE(U), '- 개발\n- |\n1. 구현\n2. 회의\n- 회의록\n3. 기타');
  run('다른 수준과 차례 안 나눔(- 다음 가. 회의)', '- a\n- b\n가. 회의|', (v, s, e) => W.renumber(v, s, e, U), null);
  run('다른 수준과 차례 안 나눔(- 다음 2. 회의)', '- a\n2. 회의|', (v, s, e) => W.renumber(v, s, e, U), null);
  run('본문 번호 줄은 차례 경계(아래 표 번호는 1부터)', '- a\n  1. x\n2. 회의\n- b\n  3. y|', (v, s, e) => W.renumber(v, s, e, U), '- a\n  1. x\n2. 회의\n- b\n  1. y|');
  //  이전 보고 붙여넣기: 한 글자도 안 바뀜
  const prev = '1. 구현\n- 기능개발\n  1.  UI/UX 구현\n  2.  보완\n    * 손으로 쓴 세부\n2. 기획\n3.기타';
  { const v = '- 기존\n'; const op = W.pasteOp(v, v.length, v.length, prev, U); eq('이전 보고 붙여넣기 그대로', W.applyOp(v, op), v + prev); }
  //  표 바꿈 네 가지: 수준 줄만 다시 그리고 본문 번호 줄과 표와 다른 줄은 그대로
  const D = '1. 구현\n- 기능개발\n  1. UI\n  2. 보완\n    * 손 세부\n  - 다른 줄\n2. 기획';
  eq('D 판정', W.parse(D, U).P.map((p) => p.level), [0, 1, 2, 2, O, O, 0]);
  eq('표 바꿈: 1수준 기호 - -> □', reshape(D, U, W.setMarker(U, 0, '□')), '1. 구현\n□ 기능개발\n  1. UI\n  2. 보완\n    * 손 세부\n  - 다른 줄\n2. 기획');
  eq('표 바꿈: 2수준 형식 1. -> 가.', reshape(D, U, W.setMarker(U, 1, '가.')), '1. 구현\n- 기능개발\n  가. UI\n  나. 보완\n    * 손 세부\n  - 다른 줄\n2. 기획');
  eq('표 바꿈: 2수준을 기호 * 로', reshape(D, U, W.setMarker(U, 1, '*')), '1. 구현\n- 기능개발\n  * UI\n  * 보완\n    * 손 세부\n  - 다른 줄\n2. 기획');
  { const t = U.map((r) => ({ ...r })); t[0].indent = 1; eq('표 바꿈: 1수준 칸 수 0 -> 1', reshape(D, U, t), '1. 구현\n - 기능개발\n  1. UI\n  2. 보완\n    * 손 세부\n  - 다른 줄\n2. 기획'); }
  //  표와 다른 줄과 앞 칸만 있는 글: 수준 키는 늘 본문에서 시작(Alt+→, Tab = 1수준, Alt+N = 그 수준, Alt+←, Alt+0 = 0칸 본문)
  for (const src of [' - 세부|', '   * 세부|', ' 세부|']) {
    eq('수준 칸 빈칸: ' + src, W.levelAt(src.replace('|', ''), 1, 1, sym), O);
    run('Alt+→ ' + src, src, kS(sym, 1), '- 세부|');
    run('Alt+2 ' + src, src, kL(sym, 2), '  * 세부|');
    run('Alt+← ' + src, src, kS(sym, -1), '세부|');
    run('Alt+0 ' + src, src, kL(sym, 0), '세부|');
  }
  run('표와 다른 번호 줄에서 Tab 은 1수준', '- a\n    1. 가|', kS(U, 1), '- a\n- 가|');
  run('표와 다른 번호 줄에서 Alt+2 는 표 모양', '- a\n    1. 가|', kL(U, 2), '- a\n  1. 가|');
  //  본문 번호 줄: Backspace, Alt+0, Alt+← 는 하지 않는다(글 그대로)
  run('본문 번호 줄 Backspace 는 기본 동작', '- a\n2. |기획', (v, s, e) => W.unmark(v, s, e, U), null);
  run('본문 번호 줄 Alt+0 은 그대로', '- a\n2. 기|획', kL(U, 0), null);
  run('본문 번호 줄 Alt+← 는 그대로', '- a\n2. 기|획', kS(U, -1), null);
  //  0칸 * 참고 = 본문
  eq('0칸 * 참고 는 본문', shown('- a\n* 참고', sym), [1, 0]);
  run('0칸 * 참고 Enter 는 빈 줄', '* 참고|', kE(sym), '* 참고\n|');
  //  탭과 전각 공백은 두 칸, 줄 바꿈 없는 공백은 한 칸
  eq('탭, 전각 공백 2칸', W.parse('\t1. a\n　1. b\n\t- c\n 1. d\n  * e', U).P.map((p) => p.level), [2, 2, O, O, O]);
  eq('전각 공백 2칸이면 기호형 2수준', W.parse('　* a\n　　- b', sym).P.map((p) => p.level), [2, 3]);
  //  한계 고정: 번호형 기본 표(1수준 1. 0칸)에서는 0칸 1. 구현 이 1수준 항목
  eq('번호형 기본 표 0칸 1. 구현 은 1수준(한계)', shown('1. 구현\n2. 회의', num), [1, 1]);
  run('번호형 기본 표 Enter 는 다음 번호(한계)', '1. 구현|', kE(num), '1. 구현\n2. |');
  //  Enter 는 문단 모양만(결정 15)
  run('다른 줄 Enter(1) 이 표에 없음)', '- a\n  1) 가|', kE(U), '- a\n  1) 가\n|');
  run('다른 줄 Enter(번호형 표의 1) 을 2칸에)', '1. a\n  1) 가|', kE(num), '1. a\n  1) 가\n|');
  run('본문 3. 회의 Enter', '- a\n3. 회의|', kE(U), '- a\n3. 회의\n|');
  run('표 줄 Enter 는 표 모양(번호)', '- a\n  1. 가|', kE(U), '- a\n  1. 가\n  2. |');
  run('표 줄 Enter 는 표 모양(탭 들여쓰기도 표 칸 수로)', '- a\n\t* b|', kE(sym), '- a\n\t* b\n  * |');
  run('표 줄 Enter 는 표 모양(빈칸 둘 뒤 기호도 빈칸 하나)', '- a\n  1.  UI|', kE(U), '- a\n  1.  UI\n  2. |');
  run('앞 한 칸 - 세부 끝 Enter 는 0칸 빈 줄', ' - 세부|', kE(sym), ' - 세부\n|');
  eq('그 새 줄 수준 칸은 본문', W.levelAt(' - 세부\n', 6, 6, sym), 0);
  run('표와 다른 줄 Enter 는 아래 표 번호를 다시 세지 않는다', '- a\n    1. 손|\n  3. b', kE(U), '- a\n    1. 손\n|\n  3. b');
  //  근태 가져오기(WA.compose)는 도구가 만드는 글이라 그대로
  eq('compose 번호형', W.compose([{ level: 1, body: 'a' }, { level: 2, body: 'b' }, { level: 2, body: 'c' }, { level: 1, body: 'd' }], num), '1. a\n  가. b\n  나. c\n2. d');
  eq('compose 사용자 표', W.compose([{ level: 1, body: 'a' }, { level: 2, body: 'b' }], U), '- a\n  1. b');
}
test('(U) 3차: 표와 꼭 맞는 줄만 수준(사용자 글, 먼 줄 불변, 붙여넣기, 표 바꿈 넷, 다른 줄 수준 키, 본문 번호 줄, 칸 세기, Enter 는 문단 모양만)', () => { check3(WA); });
//  변이: 옛 동작으로 되돌리면 같은 검사가 잡는다
const WA_MUT = [
  ['수준을 기호 우선으로 읽으면(옛 infer)', "for(let L = 1; L <= T.length; L++){ const r = T[L - 1]; if(r.indent === w && sameMk(p, r)) return L; }",
    "const hit = []; for(let L = 1; L <= T.length; L++) if(sameMk(p, T[L - 1])) hit.push(L); if(hit.length === 1) return hit[0]; for(const L of hit) if(T[L - 1].indent === w) return L;"],
  ['0칸 다른 줄을 항목으로 읽으면', "else { p.mk = ''; p.kind = ''; p.num = 0; p.gap = ''; p.body = raw; }",
    "else { p.item = true; p.level = Math.max(1, T.findIndex(r => sameMk(p, r)) + 1); }"],
  ['표 바꿈이 다른 줄도 다시 그리면', "else if(p.level === OTHER) col = -1;", "else if(p.level === OTHER){ p.level = 1; p.mode = 'render'; col = p.pre; }"],
  ['다른 줄 Enter 가 줄 머리를 이어 쓰면', "    if(p.item){\n      const r = T[p.level - 1]", "    if(p.item || p.level === OTHER){\n      const r = T[Math.max(1, p.level) - 1]"],
];
for (const [name, find, repl] of WA_MUT) {
  test('변이: ' + name + ' 3차 시험이 잡는다', () => {
    const a = app.indexOf(CORE_A), b = app.indexOf(CORE_B), core = app.slice(a, b), i = core.indexOf(find);
    assert.ok(i > 0 && i === core.lastIndexOf(find), '변이 앵커가 없거나 여럿이다: ' + find.slice(0, 60));
    const ctx = {}; vm.createContext(ctx);
    vm.runInContext(core.slice(0, i) + repl + core.slice(i + find.length) + '\nglobalThis.WA = WA;', ctx);
    assert.throws(() => check3(ctx.WA), assert.AssertionError);
  });
}

// ══ (B) jsdom 근태 창 ═════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
if (!JSDOM) {
  skip('writing-assist: jsdom 미설치, 작성 보조 화면 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const ATTEND_URL = 'https://tcapp.local/index.html?win=attend';
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
  const dayPayload = (X, uid, content) => ({ v: 1, date: X.ev('todayYmd()'), me: { userId: uid, loginId: 'u' + uid, name: '시험자' },
    saved: { status: '1', overtime: 0, content: content || '* 외근\n\n[알파] : 2\n- 한 일\n- 두 일\n\n[베타] : 1\n- 회신', sentAt: '' }, projects: PROJ });
  const openDay = (X, uid = 7, content) => X.ev('__attendWinOpen(' + JSON.stringify(dayPayload(X, uid, content)) + ')');
  const MON = '2026-10-26';
  async function openWeek(X, uid = 7) {
    X.ev('__attendWinOpen(' + JSON.stringify({ v: 1, kind: 'week', mon: MON, me: { userId: uid, loginId: 'u' + uid, name: '시험자' }, saved: null, projects: PROJ, refresh: false }) + ')');
    await tick(40);
  }
  function key(X, el, k, o = {}) {
    const ev = new X.w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o));
    if (o.keyCode) Object.defineProperty(ev, 'keyCode', { get: () => o.keyCode });
    el.dispatchEvent(ev); return ev.defaultPrevented;
  }
  const caret = (ta, pos) => { ta.focus(); ta.setSelectionRange(pos, pos); };
  const setVal = (X, ta, v) => { ta.value = v; ta.dispatchEvent(new X.w.Event('input', { bubbles: true })); };
  const blk = (X, i) => X.$('#atBlocks textarea[data-bt="' + i + '"]');
  const tools = (X, ed) => X.$(ed + ' .wa-tools');
  const lvOf = (X, ed) => X.$(ed + ' .wa-tools .wa-lv');
  const table = (X) => X.evJSON('waT()').map((r) => r.mk + r.indent).join(' ');
  const change = (X, el, v) => { el.value = v; el.dispatchEvent(new X.w.Event('change', { bubbles: true })); };
  const pop = (X) => X.$('#waPop');
  const dis = (X, i) => [...pop(X).querySelector('.wa-ind[data-r="' + i + '"]').options].filter((o) => o.disabled).map((o) => +o.value);
  const rowsOf = (X) => [...pop(X).querySelectorAll('.wa-sym')].map((e, i) => e.value + pop(X).querySelector('.wa-ind[data-r="' + i + '"]').value).join(' ');

  test('(B) 도구 줄: 일간 머리와 주간 머리에 같은 [수준][문단 모양], 수준 줄 이름과 키, 문단 모양 창은 body 끝 하나, 고칠 본문이 없으면 수준이 꺼져 있다', () => {
    const X = boot();
    try {
      //  payload 전(불러오는 중 잠금): 도구가 꺼져 있고 수준 칸은 빈칸(수준)
      assert.deepStrictEqual([lvOf(X, '#atEd').disabled, lvOf(X, '#atEd').value, X.$('#atEd .wa-b').disabled], [true, '', true], 'payload 전에 도구가 켜져 있다');
      openDay(X);
      //  열면 첫 과제 글 칸에 초점이 간다(atFocusFirst). 다른 칸(근태 고르기)으로 옮겨도 고칠 본문은 마지막에 쓰던 본문 그대로
      assert.strictEqual(X.doc.activeElement, blk(X, 0));
      X.$('#atStatus').focus();
      assert.deepStrictEqual([lvOf(X, '#atEd').disabled, lvOf(X, '#atEd').value], [false, '1'], '본문 밖으로 초점이 가면 고칠 본문을 잃는다');
      X.ev('waReset()');
      for (const ed of ['#atEd', '#awEd']) {
        assert.deepStrictEqual([...tools(X, ed).children].map((e) => e.tagName + '.' + e.className), ['SELECT.wa-lv', 'BUTTON.btn sm wa-b'], ed + ' 도구 줄이 다르다');
      }
      assert.strictEqual(tools(X, '#atEd').nextElementSibling.id, 'atFold', '일간 도구가 패널 접기 바로 왼쪽이 아니다');
      assert.strictEqual(tools(X, '#awEd').nextElementSibling, null, '주간 도구가 머리 줄 오른쪽 끝이 아니다');
      assert.deepStrictEqual([...lvOf(X, '#atEd').options].slice(1).map((o) => o.textContent),
        ['본문   Alt+0', '1수준   Alt+1', '2수준   Alt+2', '3수준   Alt+3', '4수준   Alt+4', '5수준   Alt+5', '6수준   Alt+6', '7수준   Alt+7', '한 수준 이동   Alt+← →']);
      assert.strictEqual(lvOf(X, '#atEd').querySelector('option[value="mv"]').disabled, true);
      assert.strictEqual(X.doc.querySelectorAll('#waPop').length, 1); assert.strictEqual(pop(X).parentElement, X.doc.body);
      assert.deepStrictEqual([...pop(X).querySelectorAll('.wa-keys > span')].map((s) => s.textContent), ['Alt+←→ 한 수준 이동', 'Alt+0 본문', 'Shift+Enter 본문 줄']);
      assert.strictEqual(pop(X).querySelector('.pop-head b').textContent, '문단 모양'); assert.ok(pop(X).querySelector('.pop-head [data-popx]'), '머리줄 × 가 없다');
      assert.strictEqual(lvOf(X, '#atEd').disabled, true, '고칠 본문이 없는데 수준이 켜져 있다');
      assert.strictEqual(lvOf(X, '#atEd').value, '', '고칠 본문이 없는데 수준 칸이 빈칸(수준)이 아니다');
      assert.strictEqual(X.$('#atEd .wa-b').disabled, false);
      caret(blk(X, 0), 3);
      assert.deepStrictEqual([lvOf(X, '#atEd').disabled, lvOf(X, '#atEd').value], [false, '1'], '본문에 들어가면 수준 칸이 커서 줄 수준을 보이지 않는다');
      assert.ok(X.$('#atBlocks .at-blk[data-bi="0"]').classList.contains('wa-tgt'), '고칠 본문 표시(wa-tgt)가 없다');
      assert.strictEqual(X.doc.documentElement.classList.contains('wa-hold'), false);
      lvOf(X, '#atEd').focus();
      assert.strictEqual(X.doc.documentElement.classList.contains('wa-hold'), true, '도구에 초점이 있는데 고칠 본문 테두리 유지(wa-hold)가 없다');
      assert.ok(X.$('#atBlocks .at-blk[data-bi="0"]').classList.contains('wa-tgt'), '도구로 초점이 가면서 고칠 본문 표시를 잃었다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 일간 키: Alt+2, Tab, Alt+화살표, Alt+0, Alt+7(숫자 줄만, 숫자 패드와 오른쪽 Alt, Shift+Tab, Ctrl+Tab 은 그대로), 수준 칸, 자유 메모, 고친 글이 ATE 와 임시 저장으로 간다', () => {
    const X = boot();
    try {
      openDay(X);
      const ta = blk(X, 0);
      assert.strictEqual(ta.value, '- 한 일\n- 두 일');
      caret(ta, ta.value.length);
      assert.strictEqual(key(X, ta, '2', { code: 'Digit2', altKey: true }), true);
      assert.strictEqual(ta.value, '- 한 일\n  * 두 일');
      assert.strictEqual(X.ev('ATE.blocks[0].text'), '- 한 일\n  * 두 일', '고친 글이 ATE 로 가지 않았다(input 처리가 돌지 않았다)');
      assert.strictEqual(X.ev('atDirty()'), true);
      assert.strictEqual(lvOf(X, '#atEd').value, '2');
      caret(ta, ta.value.length); key(X, ta, 'Tab', { code: 'Tab' });
      assert.strictEqual(ta.value, '- 한 일\n    - 두 일', 'Tab 이 한 수준 올리지 않았다');
      caret(ta, ta.value.length);
      assert.deepStrictEqual([key(X, ta, 'Tab', { code: 'Tab', shiftKey: true }), ta.value], [false, '- 한 일\n    - 두 일'], 'Shift+Tab 을 가로챘다');
      assert.strictEqual(key(X, ta, 'Tab', { code: 'Tab', ctrlKey: true }), false, 'Ctrl+Tab 을 가로챘다');
      key(X, ta, 'ArrowLeft', { code: 'ArrowLeft', altKey: true });
      assert.strictEqual(ta.value, '- 한 일\n  * 두 일', 'Alt+왼쪽이 한 수준 내리지 않았다');
      key(X, ta, 'ArrowRight', { code: 'ArrowRight', altKey: true });
      assert.strictEqual(ta.value, '- 한 일\n    - 두 일');
      assert.deepStrictEqual([key(X, ta, '7', { code: 'Numpad7', altKey: true }), ta.value], [false, '- 한 일\n    - 두 일'], '숫자 패드를 받았다');
      key(X, ta, 'Alt', { code: 'AltRight', altKey: true });
      assert.deepStrictEqual([key(X, ta, '3', { code: 'Digit3', altKey: true }), ta.value], [false, '- 한 일\n    - 두 일'], '오른쪽 Alt 를 받았다');
      ta.dispatchEvent(new X.w.KeyboardEvent('keyup', { key: 'Alt', code: 'AltRight', bubbles: true }));
      assert.deepStrictEqual([key(X, ta, '8', { code: 'Digit8', altKey: true }), ta.value], [false, '- 한 일\n    - 두 일'], 'Alt+8 을 받았다');
      key(X, ta, '7', { code: 'Digit7', altKey: true });
      assert.deepStrictEqual([ta.value, lvOf(X, '#atEd').value], ['- 한 일\n            - 두 일', '7']);
      key(X, ta, '0', { code: 'Digit0', altKey: true });
      assert.strictEqual(ta.value, '- 한 일\n두 일', 'Alt+0 이 맨 앞 본문이 아니다');
      //  수준 고르기 칸(머리 줄)도 같은 일을 한다
      caret(ta, ta.value.length); change(X, lvOf(X, '#atEd'), '3');
      assert.strictEqual(ta.value, '- 한 일\n    - 두 일');
      assert.strictEqual(X.ev('ATE.blocks[0].text'), ta.value);
      //  자유 메모도 본문이다
      const memo = X.$('#atBlocks textarea[data-memo]');
      assert.strictEqual(memo.value, '* 외근');
      caret(memo, memo.value.length); key(X, memo, 'Tab', { code: 'Tab' });
      //  3차: 0칸 '* 외근' 은 표(2수준 * 2칸)와 다른 0칸 줄이라 본문이다(수준 칸 0). Tab 은 본문에서 1수준(글은 그대로 두고 머리를 붙인다)
      assert.deepStrictEqual([memo.value, X.ev('ATE.memo')], ['- * 외근', '- * 외근'], '자유 메모에서 Tab 이 수준을 올리지 않았거나 ATE.memo 가 따라오지 않았다');
      X.ev('atDraftFlushNow()');
      const d = JSON.parse(X.ev('localStorage.getItem(attDraftKey(ATE.date))'));
      assert.deepStrictEqual([d.blocks[0].text, d.memo], ['- 한 일\n    - 두 일', '- * 외근'], '임시 저장에 고친 글이 없다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 일간 Enter(같은 수준, 머리 안이면 위에 빈 항목), Shift+Enter(맨 앞 본문 줄), Backspace(기호 지우기), 붙여넣기(탭, 전각 공백), 한글 조합 중 Tab', async () => {
    const X = boot();
    try {
      openDay(X);
      const ta = blk(X, 0);
      setVal(X, ta, '- a\n  * b');
      caret(ta, ta.value.length); key(X, ta, 'Enter');
      assert.deepStrictEqual([ta.value, ta.selectionStart], ['- a\n  * b\n  * ', 14]);
      key(X, ta, 'Enter');
      assert.strictEqual(ta.value, '- a\n  * b\n  * \n  * ', '빈 항목 Enter 가 수준을 바꿨다');
      assert.strictEqual(X.ev('ATE.blocks[0].text'), ta.value);
      setVal(X, ta, '- abc'); caret(ta, 5); key(X, ta, 'Enter', { shiftKey: true });
      assert.deepStrictEqual([ta.value, ta.selectionStart], ['- abc\n', 6], 'Shift+Enter 가 맨 앞 본문 줄이 아니다');
      setVal(X, ta, '- a\n- b'); caret(ta, 4); key(X, ta, 'Enter');
      assert.deepStrictEqual([ta.value, ta.selectionStart], ['- a\n- \n- b', 7], '머리 안 Enter 가 위에 빈 항목을 넣지 않았다');
      setVal(X, ta, '- a\n- b'); caret(ta, 6);
      assert.strictEqual(key(X, ta, 'Backspace'), true);
      assert.deepStrictEqual([ta.value, ta.selectionStart], ['- a\n  b', 6]);
      assert.strictEqual(key(X, ta, 'Backspace'), false, '두 번째 Backspace 를 가로챘다');
      setVal(X, ta, '- a\n'); caret(ta, 4);
      const pe = new X.w.Event('paste', { bubbles: true, cancelable: true }); pe.clipboardData = { getData: () => '\t* b\n　* c' }; ta.dispatchEvent(pe);
      assert.strictEqual(ta.value, '- a\n  * b\n  * c', '붙여넣기 줄 앞 공백을 고르지 않았다');
      assert.strictEqual(X.ev('ATE.blocks[0].text'), ta.value);
      //  한글 조합: 조합 중 Tab 은 막고 조합 글자가 들어간 뒤 한 번
      setVal(X, ta, '- a\n- 진'); caret(ta, ta.value.length);
      ta.dispatchEvent(new X.w.CompositionEvent('compositionstart', { bubbles: true }));
      assert.strictEqual(key(X, ta, 'Process', { code: 'Tab', keyCode: 229, isComposing: true }), true, '조합 중 Tab 의 기본 동작(초점 이동)을 막지 않았다');
      assert.strictEqual(ta.value, '- a\n- 진');
      ta.value = '- a\n- 진행'; ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.dispatchEvent(new X.w.CompositionEvent('compositionend', { bubbles: true, data: '행' }));
      await tick(10);
      assert.strictEqual(ta.value, '- a\n  * 진행', '조합이 끝난 뒤 Tab 이 한 번 돌지 않았다');
      assert.strictEqual(X.ev('ATE.blocks[0].text'), '- a\n  * 진행');
      setVal(X, ta, '- a\n- b'); caret(ta, 6);
      assert.strictEqual(key(X, ta, 'Backspace', { keyCode: 229, isComposing: true }), false, '조합 중 Backspace 를 가로챘다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 문단 모양: 7줄, 같은 기호의 칸 수만 막는다, 바꾸면 보이는 일간 본문을 다시 쓰고 ATE 가 따라온다, 창 안 Ctrl+Z 는 표와 본문을 한 번에, Esc 는 창만 닫는다, 계정별 저장', () => {
    const X = boot();
    try {
      openDay(X);
      const ta = blk(X, 0), b1 = blk(X, 1), memo = X.$('#atBlocks textarea[data-memo]');
      setVal(X, b1, '- 회신\n  * 세부');
      caret(ta, 2);
      X.$('#atEd .wa-b').click();
      assert.strictEqual(pop(X).classList.contains('hidden'), false, '문단 모양 창이 열리지 않았다');
      assert.strictEqual(X.$('#atEd .wa-b').getAttribute('aria-expanded'), 'true');
      assert.deepStrictEqual([...pop(X).querySelectorAll('.wa-tbl tbody tr')].map((r) => r.querySelector('.wa-lvn').textContent + ' ' + r.querySelector('.wa-k').textContent),
        ['1수준 Alt+1', '2수준 Alt+2', '3수준 Alt+3', '4수준 Alt+4', '5수준 Alt+5', '6수준 Alt+6', '7수준 Alt+7']);
      assert.strictEqual([...pop(X).querySelector('.wa-ind[data-r="0"]').options].map((o) => o.textContent).join(','), Array.from({ length: 21 }, (_, i) => i + '칸').join(','));
      assert.strictEqual(rowsOf(X), '-0 *2 -4 *6 -8 *10 -12');
      assert.deepStrictEqual([dis(X, 0), dis(X, 1), dis(X, 2), dis(X, 6)], [[4, 8, 12], [6, 10], [0, 8, 12], [0, 4, 8]]);
      const before = [memo.value, ta.value, b1.value];
      const sym = pop(X).querySelector('.wa-sym[data-r="0"]');
      sym.focus(); change(X, sym, '1.');
      //  자유 메모도 보이는 본문이지만 '* 외근'(0칸)은 표와 다른 본문 줄이라 그대로 둔다(3차 결정 14)
      assert.deepStrictEqual([ta.value, b1.value, memo.value], ['1. 한 일\n2. 두 일', '1. 회신\n  * 세부', '* 외근'], '보이는 일간 본문을 새 표대로 다시 쓰지 않았다');
      assert.strictEqual(X.ev('ATE.memo'), '* 외근');
      assert.deepStrictEqual(X.evJSON('ATE.blocks.map(function(b){ return b.text; })'), ['1. 한 일\n2. 두 일', '1. 회신\n  * 세부'], 'ATE 가 다시 쓴 글을 따라오지 않았다');
      assert.strictEqual(X.doc.activeElement, sym, '표를 바꾼 뒤 초점이 문단 모양 창에 남지 않았다');
      assert.strictEqual(X.ev("localStorage.getItem('tc_attOutline:7')"), JSON.stringify({ v: 1, rows: [{ mk: '1.', indent: 0 }, ...SYM.slice(1)] }),'계정 키에 { v:1, rows } 로 저장하지 않았다');
      assert.deepStrictEqual(dis(X, 0), [], '번호 형식이 하나뿐인데 막힌 칸이 있다');
      //  같은 칸 수 강제는 받지 않는다
      const ind3 = pop(X).querySelector('.wa-ind[data-r="2"]'); change(X, ind3, '8');
      assert.deepStrictEqual([table(X).split(' ')[2], ind3.value], ['-4', '4'], '같은 기호, 같은 칸 수를 받았다');
      //  창 안 Ctrl+Z: 표와 본문을 한 번에
      assert.strictEqual(key(X, sym, 'z', { code: 'KeyZ', ctrlKey: true }), true);
      assert.deepStrictEqual([table(X), sym.value, memo.value, ta.value, b1.value], ['-0 *2 -4 *6 -8 *10 -12', '-', ...before], '창 안 Ctrl+Z 가 표와 본문을 되돌리지 않았다');
      assert.deepStrictEqual(X.evJSON('ATE.blocks.map(function(b){ return b.text; })'), [before[1], before[2]], '되돌린 글을 ATE 가 따라오지 않았다');
      assert.strictEqual(key(X, sym, 'z', { code: 'KeyZ', ctrlKey: true }), true, '기록이 비었을 때 Ctrl+Z 가 해롭다');
      //  Esc: 창만 닫고 편집 화면은 그대로, 초점은 고칠 본문으로
      change(X, sym, '□');
      sym.dispatchEvent(new X.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert.strictEqual(pop(X).classList.contains('hidden'), true, 'Esc 로 창이 닫히지 않았다');
      assert.ok(X.ev('!!ATE.p'), 'Esc 가 근태 보고 화면까지 닫았다');
      assert.strictEqual(X.doc.activeElement, ta, 'Esc 뒤 초점이 고칠 본문으로 돌아가지 않았다');
      assert.strictEqual(X.$('#atEd .wa-b').getAttribute('aria-expanded'), 'false');
      //  바깥 누르기, × 로 닫힌다
      X.$('#atEd .wa-b').click();
      X.$('#atStatus').dispatchEvent(new X.w.MouseEvent('mousedown', { bubbles: true }));
      assert.strictEqual(pop(X).classList.contains('hidden'), true, '바깥을 눌러도 창이 닫히지 않았다');
      X.$('#atEd .wa-b').click(); pop(X).querySelector('[data-popx]').click();
      assert.strictEqual(pop(X).classList.contains('hidden'), true, '× 로 닫히지 않았다');
      //  다른 계정은 제 표
      X.ev('__attendWinHidden()'); openDay(X, 8);
      assert.strictEqual(table(X), '-0 *2 -4 *6 -8 *10 -12', '다른 계정이 7번 계정 표를 썼다');
      X.ev('__attendWinHidden()'); openDay(X, 7);
      assert.strictEqual(table(X), '□0 *2 -4 *6 -8 *10 -12', '7번 계정 표를 다시 읽지 않았다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 열기와 초점만으로는 글을 고치지 않는다(저장한 표가 달라도), 5줄 표는 7줄로 읽고 바꾸기 전까지 저장값을 그대로 둔다, 깨진 값은 기본 표', () => {
    const old5 = [{ mk: '1.', indent: 0 }, { mk: '가.', indent: 2 }, { mk: '1)', indent: 4 }, { mk: '가)', indent: 6 }, { mk: '(1)', indent: 8 }];
    const X = boot((w) => w.localStorage.setItem('tc_attOutline:7', JSON.stringify(old5)));
    try {
      openDay(X);
      const ta = blk(X, 0);
      caret(ta, 3);
      assert.strictEqual(ta.value, '- 한 일\n- 두 일', '열거나 초점을 준 것만으로 글을 다시 썼다');
      assert.strictEqual(X.ev('atDirty()'), false);
      assert.strictEqual(table(X), '1.0 가.2 1)4 가)6 (1)8 *10 -12', '5줄 표에 6, 7수준 기본값을 붙이지 않았다');
      X.$('#atEd .wa-b').click();
      assert.strictEqual(rowsOf(X), '1.0 가.2 1)4 가)6 (1)8 *10 -12');
      setVal(X, ta, '1. a\n2. b'); caret(ta, 9);
      key(X, ta, '7', { code: 'Digit7', altKey: true });
      assert.strictEqual(ta.value, '1. a\n            - b');
      assert.strictEqual(JSON.parse(X.ev("localStorage.getItem('tc_attOutline:7')")).length, 5, '바꾸기 전에 저장값을 고쳐 썼다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
    const Y = boot((w) => w.localStorage.setItem('tc_attOutline:7', '{깨짐'));
    try { openDay(Y); assert.strictEqual(table(Y), '-0 *2 -4 *6 -8 *10 -12'); assert.deepStrictEqual(Y.errors, []); } finally { Y.close(); }
  });

  test('(B) 주간: 진행사항, 차주계획, 회의내용이 본문이고 고친 글이 AWE 로 간다, 표를 바꾸면 주간 칸만 다시 쓴다, 숨기기와 화면 전환은 창과 고칠 본문을 비운다', async () => {
    const X = boot();
    try {
      await openWeek(X);
      const prog = X.$('#awProg'), plan = X.$('#awPlan'), meet = X.$('#awMeet');
      setVal(X, prog, '[알파]\n- 한 일\n- 두 일'); setVal(X, plan, '- 다음'); setVal(X, meet, '- 회의');
      caret(prog, prog.value.length);
      assert.strictEqual(lvOf(X, '#awEd').value, '1');
      key(X, prog, 'Tab', { code: 'Tab' });
      assert.strictEqual(prog.value, '[알파]\n- 한 일\n  * 두 일');
      assert.strictEqual(X.ev('AWE.prog'), prog.value, '고친 글이 AWE.prog 로 가지 않았다');
      caret(meet, meet.value.length); key(X, meet, 'Enter');
      assert.deepStrictEqual([meet.value, X.ev('AWE.meet')], ['- 회의\n- ', '- 회의\n- ']);
      caret(plan, plan.value.length); key(X, plan, '2', { code: 'Digit2', altKey: true });
      assert.deepStrictEqual([plan.value, X.ev('AWE.plan')], ['  * 다음', '  * 다음']);
      assert.ok(plan.classList.contains('wa-tgt'), '주간 고칠 본문 표시(wa-tgt)가 글 칸에 없다');
      X.$('#awEd .wa-b').click();
      assert.strictEqual(pop(X).classList.contains('hidden'), false);
      change(X, pop(X).querySelector('.wa-ind[data-r="1"]'), '3');
      assert.deepStrictEqual([prog.value, plan.value, meet.value], ['[알파]\n- 한 일\n   * 두 일', '   * 다음', '- 회의\n- '], '주간 칸을 새 표대로 다시 쓰지 않았다');
      assert.deepStrictEqual([X.ev('AWE.prog'), X.ev('AWE.plan')], [prog.value, plan.value]);
      assert.strictEqual(X.ev('awDirty()'), true);
      X.ev('__attendWinHidden()');
      assert.strictEqual(pop(X).classList.contains('hidden'), true, '숨길 때 문단 모양 창을 닫지 않았다');
      assert.deepStrictEqual([X.ev('WAS.last'), X.doc.querySelectorAll('.wa-tgt').length], [null, 0], '숨길 때 고칠 본문을 비우지 않았다');
      await openWeek(X);
      caret(X.$('#awProg'), 0); X.$('#awEd .wa-b').click();
      assert.strictEqual(pop(X).classList.contains('hidden'), false);
      openDay(X);
      //  일간이 열리면 첫 과제 글 칸이 새 고칠 본문이다(주간 칸이 남지 않는다)
      assert.deepStrictEqual([pop(X).classList.contains('hidden'), X.ev("!!WAS.last && document.getElementById('awEd').contains(WAS.last)"), X.ev('WAS.last') === null || X.ev('WAS.last === document.querySelector(\'#atBlocks textarea[data-bt="0"]\')')],
        [true, false, true], '주간에서 일간으로 바꿔도 창이나 주간 고칠 본문이 남았다');
      assert.strictEqual(X.doc.querySelectorAll('#awEd .wa-tgt').length, 0);
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 보내는 중(일간 ATE.sending, 주간 AWE.sending)에는 도구가 꺼지고 문단 모양 창이 닫힌다, 끝나면 다시 켜진다', async () => {
    const X = boot();
    try {
      openDay(X);
      caret(blk(X, 0), 2);
      X.$('#atEd .wa-b').click();
      X.ev('ATE.sending = true; atSetBusy(true)');
      assert.deepStrictEqual([X.$('#atEd .wa-b').disabled, lvOf(X, '#atEd').disabled, pop(X).classList.contains('hidden')], [true, true, true], '보내는 중인데 도구가 켜져 있거나 창이 열려 있다');
      X.ev('ATE.sending = false; atSetBusy(false)');
      caret(blk(X, 0), 2);
      assert.deepStrictEqual([X.$('#atEd .wa-b').disabled, lvOf(X, '#atEd').disabled], [false, false], '보내기가 끝났는데 도구가 꺼져 있다');
      await openWeek(X);
      caret(X.$('#awProg'), 0);
      X.ev('AWE.sending = true; awSetBusy(true)');
      assert.deepStrictEqual([X.$('#awEd .wa-b').disabled, lvOf(X, '#awEd').disabled], [true, true], '주간 보내는 중인데 도구가 켜져 있다');
      X.ev('AWE.sending = false; awSetBusy(false)');
      caret(X.$('#awProg'), 0);
      assert.deepStrictEqual([X.$('#awEd .wa-b').disabled, lvOf(X, '#awEd').disabled], [false, false]);
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  test('(B) 3차: 표와 다른 줄은 수준 칸이 빈칸, 0칸 번호 줄은 본문, Enter 는 0칸 빈 줄, Alt+→ 는 1수준', () => {
    const X = boot();
    try {
      openDay(X);
      const ta = blk(X, 0), at = (pos) => { caret(ta, pos); X.ev('waRefresh()'); };   // jsdom 은 같은 칸 안 커서 이동에 selectionchange 를 내지 않는다
      setVal(X, ta, '- a\n - 세부\n2. 기획');
      at(2);
      assert.strictEqual(lvOf(X, '#atEd').value, '1');
      at(9);
      assert.strictEqual(lvOf(X, '#atEd').value, '', '표와 다른 줄인데 수준 칸이 비지 않았다');
      at(ta.value.length);
      assert.strictEqual(lvOf(X, '#atEd').value, '0', '0칸 번호 줄이 본문이 아니다');
      caret(ta, 9); key(X, ta, 'Enter');
      assert.deepStrictEqual([ta.value, ta.selectionStart, lvOf(X, '#atEd').value], ['- a\n - 세부\n\n2. 기획', 10, '0'], '표와 다른 줄 Enter 가 0칸 빈 본문 줄이 아니다');
      caret(ta, 9); key(X, ta, 'ArrowRight', { code: 'ArrowRight', altKey: true });
      assert.strictEqual(ta.value, '- a\n- 세부\n\n2. 기획', '표와 다른 줄 Alt+→ 가 1수준이 아니다');
      assert.strictEqual(X.ev('ATE.blocks[0].text'), ta.value);
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  // ── 2차(2026-11-06): 가져오기 서식을 문단 모양으로 합침 ──
  //  캘린더 출처 payload(그날 보고 없음). 알파 = 일정(설명 하나), 할 일(설명 없음), 베타 = 할 일(설명 하나)
  const IMP_SRC = { rows: [
    { key: 'c-a', name: '알파', color: '#3e5be0', titles: ['설계 검토', '시험 정리'], titleMeta: [{ kind: 'event', details: ['범위 확정'] }, { kind: 'todo', details: [] }] },
    { key: 'c-b', name: '베타', color: '#2e9e6b', titles: ['업체 회신'], titleMeta: [{ kind: 'todo', details: ['견적 비교'] }] },
  ], hours: { 'c-a': 2, 'c-b': 1 }, fmt: { mkSpec: { kind: 'const', ch: '*' }, indent: 3 } };
  const PREV = '[알파] : 3\n- 옛 줄\n  * 옛 설명';
  function openImport(X, uid = 7) {
    X.ev('hostRequest = function(cmd, p){ __calls.push(cmd); return Promise.resolve(cmd === "reportDailyList" ? { ok: true, rows: [{ date: p.from, content: ' + JSON.stringify(PREV) + ', status: "1", overtime: 0 }] } : { ok: true, rows: [] }); };');
    X.ev('__attendWinOpen(' + JSON.stringify({ v: 1, date: X.ev('todayYmd()'), me: { userId: uid, loginId: 'u' + uid, name: '시험자' }, saved: null, source: IMP_SRC, projects: PROJ }) + ')');
  }
  const cardLines = (X, i) => [...X.doc.querySelectorAll('#atCards .at-card')[i].querySelectorAll('.at-recs li')].map((li) => li.textContent);
  const bodies = (X) => X.evJSON('ATE.blocks.map(function(b){ return b.text; })');
  async function checkImport(X) {
    openImport(X);
    //  서식 줄이 없다(서식은 문단 모양 하나)
    assert.ok(!X.$('#atOMk') && !X.$('#atOInd'), '가져오기 서식 칸이 남아 있다');
    assert.ok(![...X.doc.querySelectorAll('#atOpts .at-lb')].some((e) => e.textContent === '서식'), '[서식] 줄이 남아 있다');
    //  기본 표(1수준 '-' 0칸, 2수준 '*' 2칸): 제목은 1수준, 설명은 2수준. payload 의 보고서 일간 서식(source.fmt)은 쓰지 않는다
    assert.deepStrictEqual(bodies(X), ['- 설계 검토\n  * 범위 확정\n- 시험 정리', '- 업체 회신\n  * 견적 비교'], '처음 블록이 문단 모양 기본 표(제목 1수준, 설명 2수준)가 아니다');
    assert.deepStrictEqual(cardLines(X, 0), ['- 설계 검토 일정', '  * 범위 확정', '- 시험 정리 할 일'], '패널 카드가 불러올 모양이 아니다');
    //  문단 모양 1수준을 '1.' 로: 패널 카드를 다시 그린다(번호는 같은 수준 형제끼리)
    caret(blk(X, 0), 0);
    X.$('#atEd .wa-b').click();
    change(X, pop(X).querySelector('.wa-sym[data-r="0"]'), '1.');
    assert.deepStrictEqual(cardLines(X, 0), ['1. 설계 검토 일정', '  * 범위 확정', '2. 시험 정리 할 일'], '문단 모양을 바꿨는데 패널 카드가 새 모양이 아니다');
    assert.deepStrictEqual(cardLines(X, 1), ['1. 업체 회신 할 일', '  * 견적 비교'], '과제마다 번호를 1부터 세지 않았다');
    X.$('#atLoad').click();
    assert.deepStrictEqual(bodies(X), ['1. 설계 검토\n  * 범위 확정\n2. 시험 정리', '1. 업체 회신\n  * 견적 비교'], '불러온 글이 문단 모양 표(1수준 1. 2.)가 아니다');
    //  설명 포함을 끄면 1수준만
    const d = X.$('#atODesc'); d.checked = false; d.dispatchEvent(new X.w.Event('change', { bubbles: true }));
    assert.deepStrictEqual(cardLines(X, 0), ['1. 설계 검토 일정', '2. 시험 정리 할 일']);
    X.$('#atLoad').click();
    assert.deepStrictEqual(bodies(X)[0], '1. 설계 검토\n2. 시험 정리', '설명 포함을 끄고 불러왔는데 설명이 남았다');
    //  이전 보고 출처는 그날 보낸 글 그대로(문단 모양을 입히지 않는다)
    X.$('#atEd [data-atsrc="prev"]').click();
    await tick(30);
    assert.deepStrictEqual(cardLines(X, 0), ['- 옛 줄', '  * 옛 설명'], '이전 보고 카드에 문단 모양을 입혔다');
    X.$('#atLoad').click();
    assert.deepStrictEqual(bodies(X)[0], '- 옛 줄\n  * 옛 설명', '이전 보고를 그대로 불러오지 않았다');
    assert.deepStrictEqual(X.errors, []);
  }
  test('(B) 가져오기 서식은 문단 모양 하나: [서식] 줄 없음, 제목 1수준 설명 2수준, 문단 모양을 바꾸면 카드와 불러온 글이 새 모양(번호), 이전 보고는 그대로', async () => {
    const X = boot((w) => w.localStorage.setItem('tc_attFmt:7', JSON.stringify({ v: 1, mk: '(1)', custom: '', indent: 3 })));   // 예전 가져오기 서식 값은 읽지 않는다
    try { await checkImport(X); } finally { X.close(); }
  });
  //  변이: 같은 검사가 잡는다
  const IMP_MUT = [
    ['설명을 1수준으로 넣으면', 'items.push({ level: 2, body: one(d) })', 'items.push({ level: 1, body: one(d) })'],
    ['문단 모양을 바꾼 뒤 패널 카드를 다시 그리지 않으면', '  waRefresh(); waImportRedraw();\n}\n//  가져오기 패널의', '  waRefresh();\n}\n//  가져오기 패널의'],
    ['캘린더 블록이 예전처럼 보고서 서식 함수를 쓰면', "function atCalBody(row){ return atCalLines(row).map(g => g.join('\\n')).join('\\n'); }",
      "function atCalBody(row){ const f = (ATE.p.source.fmt); return reportRowBodyText({ titles: row.kept.map(x => x.text), titleMeta: row.kept.map(x => ({ details: ATE.opt.desc ? x.details : [] })) }, ' ', f.mkSpec, f.indent); }"],
  ];
  for (const [name, find, repl] of IMP_MUT) {
    test('변이: ' + name + ' 가져오기 시험이 잡는다', async () => {
      const a = app.indexOf(find);
      assert.ok(a > 0 && a === app.lastIndexOf(find), '변이 앵커가 없거나 여럿이다: ' + find.slice(0, 60));
      const X = boot(null, app.slice(0, a) + repl + app.slice(a + find.length));
      try { await assert.rejects(() => checkImport(X), assert.AssertionError); } finally { X.close(); }
    });
  }
}
