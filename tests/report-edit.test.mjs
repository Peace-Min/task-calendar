// 일간 보고서 글 편집(docs/REPORT-EDIT.md, 2026-10-07) — §7 시험.
//
// 이 파일이 지키는 것:
//   (S) 정적: 일간 줄 ✎/✕ 와 그 처리기가 없다 · 나가는 글과 글 편집이 같은 본문 함수(reportRowBodyText)를 쓴다 ·
//       전송 payload.hours 가 X 로 뺀 과제를 거른다 · 대기 표지는 확인 뒤, 보내기 직전에만 서고 주간 전송과 워치독이 거둔다 ·
//       성공 회신만(표지가 있을 때) 임시 저장을 지운다 · 임시 저장 함수는 PEER 를 저장소보다 먼저 본다 · X 칸 CSS.
//   (B) jsdom 브라우저 모드: 카드 읽기 전용, 고친 것도 뺀 것도 없을 때 나가는 글 = 예전 buildReportText(바이트 같음, 복사와 전송),
//       X(자리 유지, 흐림, 본문과 hours 에서 빠짐, 되돌리기), 글 편집(잠긴 머리 줄, 시간 칸 연동, &nbsp; / U+00A0 들여쓰기),
//       임시 저장(입력 뒤 키, 닫고 열기, 날짜 바꾸기, 다시 읽기, 14일 정리, 저장소 예외, 렌더는 쓰지 않음, 브라우저는 자동으로 안 지움),
//       낡은 초안 안내, 대괄호 줄 안내.
//   (W) jsdom 위젯 모드(가짜 호스트, 전달 없음): 전송 성공 회신이면 지우고, 실패 회신이면 남고, 주간 채우기 회신으로는 안 지운다.
//   (P) jsdom 열람 창(PEER): 임시 저장 읽기와 쓰기 0, X 와 글 편집 없음.
//   (M) 변이: 위 계약을 되돌리면 같은 검사기가 잡는다.
// ★ 실제 netcus 전송은 없다. Platform.report.submitDaily 를 가로채 payload 만 본다.
// ★ jsdom 창마다 localStorage 가 따로지만, 시험마다 시작과 끝에 tc_rptDraft: 키를 지운다(§7).
// 생략 규약: jsdom 이 없으면 (B)(W)(P)와 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = loadAppSource();
const netcusCs = readFileSync(new URL('../widget/NetcusService.cs', import.meta.url), 'utf8');

// 앵커 하나를 정확히 한 번 바꾼다(없거나 여럿이면 실패 — 조용히 통과하는 껍데기 변이를 막는다).
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 120));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 120));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
const countOf = (hay, needle) => hay.split(needle).length - 1;
function dailySendBranch(src) {
  const a = src.indexOf("$('#btnRptSend').addEventListener('click'");
  const d = src.indexOf("if(mode === 'daily'){", a);
  const e = src.indexOf('Platform.report.submitDaily(payload);', d);
  assert.ok(a > 0 && d > a && e > d, '일간 전송 갈래를 찾지 못했다');
  return src.slice(d, e + 'Platform.report.submitDaily(payload);'.length);
}
function windowFn(src, name) {
  const a = src.indexOf('window.' + name + ' = function(');
  assert.ok(a > 0, name + ' 을 찾지 못했다');
  return src.slice(a, src.indexOf('\n};', a) + 3);
}

// ══════════════════════════════════════════════════════════════════════
// (S) 정적 검사기 — 변이 시험이 같은 함수를 재사용한다
// ══════════════════════════════════════════════════════════════════════
const S = {
  //  §5 — 일간 줄 ✎/✕(캘린더 기록 고치기, 지우기)와 그 처리기가 흔적 없이 없다. 주간 날짜 줄 ✎ 는 남는다.
  noLineEdit(src) {
    for (const t of ['data-ract=', 'rtask-edit-btn', 'rtask-del-btn', "class=\"rtask-edit\"", '.rtask-edit{', 'rtask.editing',
                     'rtask-cancel', 'editingReportKey', 'function commitReportEdit(', 'function setCommitSubject(',
                     'function setEntryTitle(', 'function setTodoText(', '오늘치는 여기서 바로 수정', ', 하루(수정 가능)']) {
      assert.ok(!src.includes(t), `일간 줄편집 흔적이 남아 있다: ${t}`);
    }
    const br = extractFunction(src, 'buildReport');
    assert.ok(br.includes('reportDayLinesHtml(m, false, spanMulti)'), '일간 카드의 기간 할 일 날짜 줄이 읽기 전용(editable=false)이 아니다');
    //  WEEKLY-EDIT §3.2(2026-10-08): 주간 카드도 읽기 전용이다. 날짜 줄 ✎ 는 기간 취합(custom)에만 남는다(!weekly).
    assert.ok(br.includes('reportDayLinesHtml(m, !weekly, spanMulti)'), '주간/기간 취합 갈래의 날짜 줄이 "기간 취합만 ✎" 꼴이 아니다');
    assert.ok(src.includes("$('#rptOut').addEventListener('focusout'") && /commitDayNoteEdit\(ev\.target\)/.test(src), '기간 취합 날짜 줄 편집 처리기(commitDayNoteEdit)가 사라졌다');
  },
  //  §3.1 — 초안 본문은 함수 하나. 나가는 글(buildReportText)과 글 편집(buildReport 의 초안)이 같은 함수를 쓴다.
  sharedBody(src) {
    const bt = extractFunction(src, 'buildReportText');
    assert.ok(bt.includes('reportRowBodyText(r, indentUnit, _mkSpec, _indent)'), 'buildReportText 가 reportRowBodyText 로 본문을 만들지 않는다');
    assert.ok(!/reportTextDetails\(|reportTextBody\(/.test(bt), 'buildReportText 가 본문을 따로 조립한다 — 글 편집 초안과 갈린다');
    assert.ok(/reportDailyHours\(rows, from\)/.test(bt), '머리 줄 시간이 reportDailyHours 에서 나오지 않는다');
    assert.ok(bt.includes('reportRowHead(r, _hmap)'), '머리 줄을 reportRowHead 로 만들지 않는다(글 편집의 잠긴 머리 줄과 갈린다)');
    const br = extractFunction(src, 'buildReport');
    assert.ok(br.includes("reportRowBodyText(r, ' ', _mkSpec, _indent)") && br.includes('reportRowHead(r, _hmap)'), '글 편집 초안이 같은 함수에서 나오지 않는다');
  },
  //  §3.2 · §4 · §6 — 전송: hours 는 X 를 거르고, 대기 표지는 확인 뒤 보내기 직전, 확인창은 하나.
  sendWiring(src) {
    const d = dailySendBranch(src);
    assert.strictEqual(countOf(d, 'confirmBox('), 1, '일간 전송 갈래의 확인창이 하나가 아니다(ui-clarity S5)');
    assert.ok(/\.filter\(x => !_rptOut\.has\(x\.key\)\)/.test(d) && d.includes('const _rptOut = new Set(rptDraftGet(from).out);'), 'payload.hours 가 X 로 뺀 과제를 거르지 않는다');
    const c = d.indexOf("await confirmBox('일간보고 제출'");
    const arm = d.indexOf('rptDraftArmSend(from);');
    const send = d.indexOf('Platform.report.submitDaily(payload);');
    assert.ok(arm > c && c > 0, '대기 표지를 확인보다 먼저 세운다 — 거절해도 표지가 남는다');
    assert.ok(!d.slice(arm, send).includes('\n      ') || d.slice(arm, send).split('\n').length === 2, '대기 표지가 보내기 바로 앞 줄이 아니다');
    assert.strictEqual(countOf(d, 'rptDraftArmSend('), 1, '대기 표지가 일간 갈래에 한 번이 아니다');
    const wk = src.slice(src.indexOf('Platform.report.submitDaily(payload);'), src.indexOf("$('#btnExport').addEventListener"));
    assert.ok(wk.indexOf('rptDraftDisarmSend();') > 0 && wk.indexOf('rptDraftDisarmSend();') < wk.indexOf('Platform.report.submitWeekly('), '주간 전송이 일간 대기 표지를 거두지 않는다 — 주간 채우기 회신이 일간 임시 저장을 지운다');
    assert.ok(extractFunction(src, 'armRptSendWatchdog').includes('rptDraftDisarmSend();'), '워치독 만료가 대기 표지를 거두지 않는다 — 늦게 온 다른 회신이 임시 저장을 지울 수 있다');
    assert.ok(extractFunction(src, 'rptDraftArmSend').includes('Platform.caps.reportAuto'), '브라우저(회신 없음)에서도 표지를 세운다');
  },
  //  §4 — 성공 회신 + 대기 표지가 있을 때만 지운다. 표지는 회신이 오면 비운다.
  resultClears(src, cs = netcusCs) {
    assert.ok(windowFn(src, '__netcusResult').includes('rptDraftOnSendResult(ok, msg);'), '__netcusResult 가 임시 저장 정리를 부르지 않는다');
    const f = extractFunction(src, 'rptDraftOnSendResult');
    assert.ok(f.includes("const key = __rptDraftSending, snap = __rptDraftSendSnap; __rptDraftSending = ''; __rptDraftSendSnap = '';"), '회신이 와도 대기 표지를 비우지 않는다');
    assert.ok(f.includes('if(!key || ok !== true || PEER) return;'), '실패 회신이나 표지 없는 회신(주간 채우기, 바쁨)도 임시 저장을 지운다');
    //  정정 1: 보낸 뒤 고친 글은 지우지 않는다(표지 때의 서명과 지금 초안이 같을 때만 지운다)
    const cmp = f.indexOf('if(rptDraftSig(rptDraftGet(date)) !== snap){'), del = f.indexOf('__rptDraftMem.set(key, null)');
    assert.ok(cmp > 0 && del > cmp, '성공 회신이 보낸 뒤 고친 글까지 지운다(서명 비교가 지우기보다 앞에 없다)');
    assert.ok(extractFunction(src, 'rptDraftArmSend').includes('__rptDraftSendSnap = __rptDraftSending ? rptDraftSig(rptDraftGet(date)) :'), '표지를 세울 때 초안 서명을 남기지 않는다');
    //  정정 3: 주간 채우기 성공 회신은 일간 대기 표지를 건드리지 않는다. 호스트 문구가 그 머리로 시작해야 한다.
    assert.ok(/^\s*if\(ok === true && RPT_WEEKFILL_OK_RE\.test\(String\(msg \|\| ''\)\)\) return;/m.test(f.slice(f.indexOf('{') + 1)), '주간 채우기 성공 회신을 가르지 않는다');
    const m = /NetcusResult\(true, "(주간보고[^"]*)"\)/.exec(cs);
    assert.ok(m && /^주간보고 /.test(m[1]), '호스트의 주간 채우기 성공 문구가 RPT_WEEKFILL_OK_RE(/^주간보고 /) 와 맞지 않는다');
    assert.ok(!/NetcusResult\(true, "주간보고 /.test(cs.slice(0, cs.indexOf('private async Task NetcusWeekFill('))), '일간 경로의 성공 문구가 주간보고 로 시작한다(일간 성공을 주간으로 오인한다)');
  },
  //  정정 4: "고친 과제", "임시 저장됨", "모두 초안으로" 는 지금 행 기준이고, 쓸 때 없어진 과제의 흔적을 걷는다(렌더는 쓰지 않는다).
  liveRows(src) {
    assert.ok(extractFunction(src, 'rptEditInfoRender').includes('const live = rptDraftLive(d, rptCtxKeys(ctx.date));'), '편집 정보가 지금 행이 아니라 저장본 전체를 센다');
    assert.ok(extractFunction(src, 'rptDocHtml').includes('rptDraftIsEmpty(rptDraftLive(d, rptCtxKeys(ctx.date)))'), '"모두 초안으로" 가 없어진 과제의 흔적으로 켜진다');
    const put = extractFunction(src, 'rptDraftPut');
    assert.ok(put.includes("d.out = (d.out || []).filter(k => keys.has(k));") && put.indexOf('if(!keys.has(k)) delete d.body[k]') > 0, '쓸 때 없어진 과제의 흔적을 걷지 않는다');
  },
  //  정정 7: ≤440px 에서 글 편집 링크 히트 32px.
  cssLinks(src) {
    const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
    const m440 = css.indexOf('@media (max-width:440px)');
    assert.ok(/\.rpt-mirror \.rcard-back,\.rpt-mirror \.rdoc-revert,\.rpt-mirror \.rdoc-resetall\{display:inline-flex;align-items:center;min-height:32px;/.test(css.slice(m440)), '440px 이하에서 되돌리기, 초안으로, 모두 초안으로 링크가 32px 히트가 아니다');
  },
  //  §4 — 열람 창은 부모와 localStorage 를 같이 쓴다. 임시 저장 함수는 저장소에 닿기 전에 PEER 를 본다.
  peerNoStorage(src) {
    for (const fn of ['rptDraftGet', 'rptDraftPut', 'rptDraftFlush', 'rptDraftPrune']) {
      const b = extractFunction(src, fn);
      const g = b.indexOf('PEER');
      const touch = Math.min(...['localStorage', '__rptDraftMem.set', '__rptDraftDirty.add'].map(t => { const i = b.indexOf(t); return i < 0 ? Infinity : i; }));
      assert.ok(g > 0 && g < touch, `${fn} 가 PEER 를 저장소보다 먼저 보지 않는다 — 열람 창이 내 임시 저장을 읽거나 쓴다`);
    }
  },
  //  §2.2 — X 는 20px, 440px 이하 32px. 흐림은 rcard-empty 와 다른 클래스. 시간 칸과 X 를 같은 칸에서 맞바꾼다.
  cssXSlot(src) {
    const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
    assert.ok(/\.rpt-mirror \.rcard-x\{[^}]*width:20px;height:20px/.test(css), 'X 버튼이 20px 가 아니다');
    const m440 = css.indexOf('@media (max-width:440px)');
    assert.ok(m440 > 0 && /\.rpt-mirror \.rcard-x\{width:32px;height:32px\}/.test(css.slice(m440)), '440px 이하에서 X 가 32px 가 아니다(loop-ui-visual V7)');
    assert.ok(/\.rpt-mirror \.rcard-out\{/.test(css) && !/\.rcard-out[^{]*\.rcard-empty|\.rcard-empty[^{]*\.rcard-out/.test(css), 'X 흐림이 rcard-empty 와 구별되는 별도 클래스가 아니다');
    assert.ok(/\.rpt-mirror \.rcard-slot > \*\{grid-area:1 \/ 1\}/.test(css) && /\.rpt-mirror \.rcard-out \.rcard-live\{visibility:hidden;max-width:0;overflow:hidden\}/.test(css),
      '시간 칸과 "뺌, 되돌리기" 가 한 칸에서 맞바뀌지 않는다 — X 를 누르면 카드 높이가 흔들릴 수 있다');
  },
};

test('S1 (§5): 일간 줄 ✎/✕ 와 그 처리기, 옛 안내 문구가 없다 · 날짜 줄 ✎ 는 기간 취합에만 남는다', () => S.noLineEdit(app));
test('S2 (§3.1): 나가는 글(buildReportText)과 글 편집 초안이 같은 본문 함수(reportRowBodyText)와 머리 줄 함수를 쓴다', () => S.sharedBody(app));
test('S3 (§3.2·§4·§6): payload.hours 는 X 를 거르고, 대기 표지는 확인 뒤 보내기 직전 · 주간 전송과 워치독이 거둔다', () => S.sendWiring(app));
test('S4 (§4): 성공 회신 + 대기 표지가 있을 때만 임시 저장을 지운다', () => S.resultClears(app));
test('S5 (§4): 임시 저장 함수는 저장소보다 PEER 를 먼저 본다', () => S.peerNoStorage(app));
test('S6 (§2.2): X 20px / 440px 이하 32px · 별도 흐림 클래스 · 한 칸 맞바꿈', () => S.cssXSlot(app));
test('S9 (정정 4): 편집 정보와 "모두 초안으로" 는 지금 행 기준 · 쓸 때 없어진 과제 흔적을 걷는다', () => S.liveRows(app));
test('S10 (정정 7): 440px 이하 글 편집 링크 32px 히트', () => S.cssLinks(app));

//  정정 5: reportEditedBodyOut 다듬기(앞 빈 줄, 끝 공백, 가운데 공백뿐인 줄, CRLF). 순수 함수라 소스에서 떼어 Node 에서 돌린다(변이 시험이 같은 검사를 쓴다).
function bodyOutFn(src) {
  const ctx = { out: null, RPT_TAB_UNITS: 4 };
  vm.runInNewContext(extractFunction(src, 'reportEditedBodyOut') + '\nout = reportEditedBodyOut;', ctx);
  return ctx.out;
}
function checkBodyOut(f) {
  const NB = '&nbsp;';
  assert.strictEqual(f('\n  \n\t\n• 첫 줄', NB), '• 첫 줄', '앞쪽 빈 줄(공백, 탭뿐인 줄 포함)을 걷지 않는다');
  assert.strictEqual(f('• 끝 줄  \n\n \t\n', NB), '• 끝 줄', '끝 공백과 끝 빈 줄을 걷지 않는다');
  assert.strictEqual(f('• 위\n   \n• 아래', NB), '• 위\n\n• 아래', '가운데 공백뿐인 줄이 빈 줄이 아니다(&nbsp; 만 있는 줄이 나간다)');
  assert.strictEqual(f('• 위\r\n  - 아래\r\n', NB), '• 위\n' + NB + NB + '- 아래', 'CRLF 를 붙여 넣은 글이 \\n 로 정리되지 않는다');
  assert.strictEqual(f('\t- 탭 \u00a0안쪽  공백', NB), NB.repeat(4) + '- 탭 \u00a0안쪽  공백', '줄 앞 탭은 단위 4개, 줄 안쪽 공백은 그대로여야 한다');
  assert.strictEqual(f('   \n\t', NB), '', '공백뿐인 글은 빈 본문이어야 한다');
}
test('S11 (정정 5): 고친 글 다듬기 — 앞 빈 줄, 끝 공백, 가운데 공백뿐인 줄, CRLF', () => checkBodyOut(bodyOutFn(app)));
test('변이 SM9: 앞 빈 줄 걷기나 끝 공백 걷기를 빼면 S11 이 잡는다', () => {
  const bad1 = mutate(app, ".replace(/^(?:[ \\t\\u00A0]*\\n)+/, '')", '');
  assert.throws(() => checkBodyOut(bodyOutFn(bad1)), /앞쪽 빈 줄/);
  const bad2 = mutate(app, ".replace(/\\s+$/, '');\n  if(!t) return '';", ";\n  if(!t) return '';");
  assert.throws(() => checkBodyOut(bodyOutFn(bad2)), /끝 공백/);
  const bad3 = mutate(app, "    if(/^[ \\t\\u00A0]*$/.test(l)) return '';", '');
  assert.throws(() => checkBodyOut(bodyOutFn(bad3)), /가운데 공백뿐인 줄/);
});
test('변이 SM10: 편집 정보를 저장본 전체로 세거나 쓸 때 거르기를 빼면 S9 가 잡는다', () => {
  const bad = mutate(app, 'const live = rptDraftLive(d, rptCtxKeys(ctx.date));', 'const live = rptDraftLive(d, null);');
  assert.throws(() => S.liveRows(bad), /저장본 전체/);
  const bad2 = mutate(app, "    d.out = (d.out || []).filter(k => keys.has(k));\n", '');
  assert.throws(() => S.liveRows(bad2), /흔적을 걷지 않는다/);
});
test('변이 SM11: 440px 이하 링크 32px 규칙을 빼면 S10 이 잡는다', () => {
  const bad = mutate(app, '{display:inline-flex;align-items:center;min-height:32px;padding:0 4px}', '{padding:0 4px}');
  assert.throws(() => S.cssLinks(bad), /32px/);
});
test('S7 (§6): closeOverlay 의 reportModal 줄은 그대로이고 정리는 별도 줄이다', () => {
  assert.ok(app.includes("  if(ov.id === 'reportModal'){ clearNetcusMerge(); clearNetcusWeeklyMerge(); }   // 닫기 경로가 하나로 모였으니"), 'reportModal 닫기 줄이 바뀌었다(report-wiring 변이 시험의 대상)');
  assert.ok(app.includes("  if(ov.id === 'reportModal') rptDraftFlush();"), '닫을 때 모아 두던 입력을 쓰는 줄이 없다');
  assert.ok(app.includes("const from = $('#rptFrom').value; const cat = inp.dataset.hcat;"), '시간 입력 처리기의 앵커가 바뀌었다(offline-web)');
});
test('S8 (§7): 새 화면 문구에 엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점이 없다', () => {
  const phrases = ['이 보고서에서 빼기', '이 보고서에서 뺌', '되돌리기', '고침', '글 편집', '카드', '모두 초안으로', '초안으로',
    '복사와 전송은 이 글 그대로 나갑니다. 회색 머리 줄은 카드에서 정해집니다. 그 아래 내용은 상세 줄, 들여쓰기, 번호까지 자유롭게 쓰세요. ',
    '이 보고서에서 뺌, 카드에서 되돌릴 수 있습니다', '캘린더 기록이 바뀌었습니다. 초안으로 되돌리면 새 내용이 들어갑니다',
    '대괄호로 시작하는 줄은 netcus 일간보고 합치기에서 과제 머리 줄로 읽힐 수 있습니다.', '내용 없음(쓰려면 여기를 누르세요)',
    '. 내용은 글 편집에서 고칩니다. 캘린더 기록은 바뀌지 않습니다', '이 PC에 임시 저장됨 ', '고친 과제 ',
    '이 과제의 고친 내용을 버리고 초안으로 되돌릴까요?', '이 날짜의 고친 내용과 뺀 과제, 묶음을 모두 버리고 초안으로 되돌릴까요?',
    '글 편집에서 고친 과제입니다. 캘린더 기록은 바뀌지 않습니다', '보낼 글 전체를 문서처럼 보고 과제마다 내용을 고칩니다',
    '시간은 주간 과제투입시간에는 계속 들어갑니다. 주간에서도 빼려면 시간 칸을 비우세요.'];
  for (const p of phrases) {
    assert.ok(app.includes(p), '문구가 앱에 없다(시험 목록 갱신 필요): ' + p);
    assert.ok(!/—|–|「|」|(^|\s)·|·(\s|$)/.test(p), '금지 기호: ' + p);
  }
});

// ── (M) 정적 변이 ────────────────────────────────────────────────────
test('변이 SM1: 일간 줄 ✕(data-ract="del")를 되살리면 S1 이 잡는다', () => {
  const bad = mutate(app, '<div class="rtask rtask-ro">${_mkS}', '<div class="rtask rtask-ro" data-ract="del">${_mkS}');
  assert.throws(() => S.noLineEdit(bad), /data-ract=/);
});
test('변이 SM2: 일간 날짜 줄 ✎ 를 되살리면(editable=true) S1 이 잡는다', () => {
  const bad = mutate(app, 'reportDayLinesHtml(m, false, spanMulti)', 'reportDayLinesHtml(m, !weekly, spanMulti)');
  assert.throws(() => S.noLineEdit(bad), /읽기 전용/);
});
test('변이 SM3: buildReportText 가 본문을 따로 조립하면 S2 가 잡는다', () => {
  const bad = mutate(app, ': reportRowBodyText(r, indentUnit, _mkSpec, _indent);', ": r.titles.map(t => indentUnit + t + reportTextBody(null, '')).join('\\n');");
  assert.throws(() => S.sharedBody(bad), /reportRowBodyText|따로 조립/);
});
test('변이 SM4: payload.hours 에서 X 거르기를 빼거나 대기 표지를 확인 앞으로 옮기면 S3 이 잡는다', () => {
  const bad1 = mutate(app, '        .filter(x => !_rptOut.has(x.key))\n', '');
  assert.throws(() => S.sendWiring(bad1), /X 로 뺀 과제/);
  const bad2 = mutate(mutate(app, "      rptDraftArmSend(from);   // 일간 전송 대기 표지", '      // (옮김)'),
    '      const at = getAttendance(from), p = from.split', '      rptDraftArmSend(from);\n      const at = getAttendance(from), p = from.split');
  assert.throws(() => S.sendWiring(bad2), /확인보다 먼저/);
  const bad3 = mutate(app, "      rptDraftDisarmSend();   // 주간 채우기 회신", '      // (빠짐)');
  assert.throws(() => S.sendWiring(bad3), /주간 전송이 일간 대기 표지를 거두지 않는다/);
});
test('변이 SM5: 실패 회신도 지우게 바꾸면 S4 가 잡는다', () => {
  const bad = mutate(app, 'if(!key || ok !== true || PEER) return;', 'if(!key || PEER) return;');
  assert.throws(() => S.resultClears(bad), /실패 회신/);
});
test('변이 SM12: 서명 비교나 주간 채우기 가르기를 빼면, 또는 호스트 문구가 바뀌면 S4 가 잡는다', () => {
  const bad1 = mutate(app, 'if(rptDraftSig(rptDraftGet(date)) !== snap){', 'if(false){');
  assert.throws(() => S.resultClears(bad1), /보낸 뒤 고친 글/);
  const bad2 = mutate(app, "  if(ok === true && RPT_WEEKFILL_OK_RE.test(String(msg || ''))) return;", '');
  assert.throws(() => S.resultClears(bad2), /주간 채우기 성공 회신/);
  const badCs = mutate(netcusCs, 'NetcusResult(true, "주간보고 작성 폼을 채웠습니다', 'NetcusResult(true, "폼을 채웠습니다');
  assert.throws(() => S.resultClears(app, badCs), /주간 채우기 성공 문구/);
});
test('변이 SM6: rptDraftGet 의 PEER 관문을 빼면 S5 가 잡는다', () => {
  const bad = mutate(app, "  if(PEER || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date || '')) return empty;", "  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date || '')) return empty;");
  assert.throws(() => S.peerNoStorage(bad), /rptDraftGet 가 PEER/);
});
test('변이 SM7: 440px 이하 X 32px 규칙을 빼면 S6 이 잡는다', () => {
  const bad = mutate(app, '  .rpt-mirror .rcard-x{width:32px;height:32px}', '  .rpt-mirror .rcard-x{width:20px;height:20px}');
  assert.throws(() => S.cssXSlot(bad), /32px/);
});

// ══════════════════════════════════════════════════════════════════════
// (B)(W)(P) jsdom 실행
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('report-edit: jsdom 미설치 — 일간 글 편집 실행 계약(카드, X, 글 편집, 임시 저장, 전송 회신, PEER)을 돌리지 못했다', SKIP_NO_JSDOM,
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
    return {
      w, posted, doc: w.document,
      ev: (code) => w.eval(code),
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      close: async () => { await tick(); try { w.close(); } catch (_) {} },
    };
  }
  //  브라우저 모드(HOST=false) — 회신이 없는 환경. app-context 와 같은 부팅.
  function bootBrowser(src) {
    return wrap(new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quiet(), beforeParse: shims }), []);
  }
  //  위젯 모드 — 가짜 호스트는 메시지를 배열에 넣기만 한다(실제 netcus 제출 경로 없음, ui-clarity 와 같은 부팅).
  function bootWidget(src, url = 'https://tcapp.local/') {
    const posted = [];
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: quiet(),
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); }, addEventListener() {}, removeEventListener() {} } };
        shims(win);
      },
    });
    const M = wrap(dom, posted);
    const sess = posted.find((x) => x && x.cmd === 'userSessionGet');
    if (sess) M.ev('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'tester', name: '시험자' } }) + ')');
    return M;
  }
  const overlayOpen = (m, id) => { const o = m.doc.getElementById(id); return !!o && !o.classList.contains('hidden') && !o.classList.contains('closing'); };
  const overlayClosed = (m, id) => { const o = m.doc.getElementById(id); return !o || o.classList.contains('hidden'); };
  async function confirmOk(m) {
    await waitFor(() => overlayOpen(m, 'confirmModal'), '확인창이 뜬다');
    m.doc.getElementById('cfOk').click();
    await waitFor(() => overlayClosed(m, 'confirmModal'), '확인창이 닫힌다');
    await tick(); await tick();
  }
  const draftKeys = (m) => m.evJSON("(function(){ var a=[]; for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && k.indexOf('tc_rptDraft:')===0) a.push(k); } return a.sort(); })()");
  const clearDrafts = (m) => m.ev("(function(){ var a=[]; for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && k.indexOf('tc_rptDraft:')===0) a.push(k); } a.forEach(function(k){ localStorage.removeItem(k); }); __rptDraftMem.clear(); __rptDraftDirty.clear(); __rptDraftFailed.clear(); clearTimeout(__rptDraftTimer); __rptDraftSending=''; })()");
  const getDraft = (m, key) => m.evJSON('JSON.parse(localStorage.getItem(' + JSON.stringify(key) + ') || "null")');

  //  예전 buildReportText(4b4a018) 의 캘린더 경로 그대로 — "고친 것도 뺀 것도 없으면 바이트까지 같다"(§3.2)의 기준. 앱 전역을 쓴다.
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
    const _hmap = _daily ? new Map(reportDailyHours(rows, from).map(x => [x.key, x.hours])) : null;
    const blocks = rows.map(r => {
      let _head = `[${r.name}]`;
      if (_hmap) { const _h = _hmap.get(r.key); if (_h != null) _head += ` : ${_h}`; }
      return _head + r.titles.map((t, i) => {
        const _mk = reportMarkerAt(_mkSpec, i); const _prefix = _mk ? (_mk + ' ') : '';
        const m = (r.titleMeta && r.titleMeta[i]) || null;
        const _sub = _pad + reportSubIndent(_prefix, indentUnit);
        return '\n' + _pad + _prefix + t + reportTextDetails(m, _sub) + reportTextBody(m, _sub);
      }).join('');
    });
    return blocks.join('\n\n') + '\n';
  }
  const CA = '2026-07-01T00:00:00.000Z';
  const E = (o) => Object.assign({ allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: null,
    endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }, o);
  //  알파: 일정(메모 2줄) + 커밋(본문, 들여쓴 본문 줄) + 기간 할 일(그날 메모) · 베타: 일정 · 감마: 제목 없음, 시간만 · 델타: 아무것도 없음
  const stateFor = (T, Y, N) => ({
    gitAuthor: '', svnAuthor: '',
    categories: [
      { id: 'c-a', name: '알파', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
      { id: 'c-b', name: '베타', color: '#2e9e6b', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
      { id: 'c-c', name: '감마', color: '#d97706', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
      { id: 'c-d', name: '델타', color: '#5b6b7d', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
    ],
    entries: [
      E({ id: 'e-a1', date: T, title: '로그인 화면 리뷰', categoryId: 'c-a', memo: 'UI 확인\n• 암호화 모듈 확인' }),
      E({ id: 'g-a', date: T, title: '작업일지', categoryId: 'c-a', source: 'git',
          commits: [{ hash: 'h1', short: 'h1', time: '09:00', subject: '기능 추가', body: '본문 첫 줄\n  - 들여쓴 본문' }] }),
      E({ id: 'e-b1', date: T, title: '고객 회신', categoryId: 'c-b' }),
      E({ id: 'e-y1', date: Y, title: '어제 업무', categoryId: 'c-b' }),
    ],
    todos: [{ id: 't-p', text: '기간 할 일', done: false, categoryId: 'c-a', due: Y, endDate: N, prio: 'normal', completedAt: '', note: '',
              dayNotes: { [T]: '오늘 메모' }, createdAt: CA, updatedAt: CA }],
    rooms: [], attendance: {},
    taskHours: { [T]: { 'c-a': 2, 'c-b': 1.5, 'c-c': 1 } },
    gitCommitBody: true, reportMarker: '-', reportMarkerCustom: '', reportIndent: 2,
  });
  //  보고서를 일간·그 날짜로 연다(포함 항목 셋 다, 설명 포함, 빈 항목 제외 끔).
  const openDaily = (m, date) => m.ev(`openReport(); ['#rptSrcEvent','#rptSrcTodo','#rptSrcGit','#rptWithDesc'].forEach(function(s){ $(s).checked = true; }); $('#rptSkipEmpty').checked = false;`
    + ` $('#rptFrom').value = ${JSON.stringify(date)}; $('#rptFrom').dispatchEvent(new Event('change'));`);
  const setDate = (m, date) => m.ev(`$('#rptFrom').value = ${JSON.stringify(date)}; $('#rptFrom').dispatchEvent(new Event('change'));`);
  const cardNames = (m) => m.evJSON("[].map.call(document.querySelectorAll('#rptOut .rcard .rcard-nm'), function(x){ return x.textContent; })");
  const card = (m, cat) => m.ev(`[].find.call(document.querySelectorAll('#rptOut .rcard'), function(c){ return c.dataset.rcat === ${JSON.stringify(cat)}; })`);
  const clickIn = (m, cat, sel) => { const c = card(m, cat); assert.ok(c, cat + ' 카드가 없다'); const b = c.querySelector(sel); assert.ok(b, cat + ' 카드에 ' + sel + ' 가 없다'); b.click(); };
  const setView = (m, v) => m.doc.querySelector(`#rptViewSeg [data-rview="${v}"]`).click();
  const ta = (m, cat) => m.ev(`[].find.call(document.querySelectorAll('#rptOut .rdoc-ta'), function(t){ return t.dataset.rcat === ${JSON.stringify(cat)}; })`);
  const typeIn = (m, cat, text) => { const t = ta(m, cat); assert.ok(t, cat + ' 내용 칸이 없다'); t.value = text; t.dispatchEvent(new m.w.Event('input', { bubbles: true })); };
  //  전송 가로채기 — 실제 제출 없음. payload 만 붙잡는다.
  const capSend = (m) => m.ev('window.__cap = null; Platform.report.submitDaily = function(p){ window.__cap = JSON.parse(JSON.stringify(p)); }; Platform.report.submitWeekly = function(p){ window.__capW = p; };');
  const copyText = async (m) => {
    m.ev("window.__clip = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function(t){ window.__clip = t; return Promise.resolve(); } } });");
    await m.ev('copyReport()');
    return m.ev('window.__clip');
  };

  //  ── 기준 비교 검사기(변이 시험이 재사용) — 서식 여러 벌 × 복사(U+00A0)·전송(&nbsp;) × 일간·주간 ──
  const FORMATS = [['-', '', 2], ['1.', '', 3], ['none', '', 0], ['가.', '', 1], ['1.', '▶', 2]];
  async function assertSameAsRef(m, T) {
    m.ev('window.__REF = ' + REF.toString());
    let checked = 0;
    for (const [mk, cu, ind] of FORMATS) for (const desc of [true, false]) for (const body of [true, false]) {
      m.ev(`state.reportFormatPrefs = { daily: { marker: ${JSON.stringify(mk)}, markerCustom: ${JSON.stringify(cu)}, indent: ${ind} }, weekly: { marker: '1.', markerCustom: '', indent: 2 } }; state.gitCommitBody = ${body};`
        + ` $('#rptWithDesc').checked = ${desc}; reportMode = 'daily'; $('#rptFrom').value = ${JSON.stringify(T)}; $('#rptTo').value = ${JSON.stringify(T)}; buildReport();`);
      const tag = `${mk}/${cu}/${ind} desc=${desc} body=${body}`;
      const ref = m.ev('__REF()'), refNb = m.ev("__REF('&nbsp;')");
      assert.ok(ref.includes('[알파]') && ref.includes('로그인 화면 리뷰'), '기준 글이 비었다: ' + tag);
      assert.strictEqual(m.ev('buildReportText()'), ref, '복사 글(U+00A0)이 예전과 다르다: ' + tag);
      assert.strictEqual(m.ev("buildReportText('&nbsp;')"), refNb, '전송 글(&nbsp;)이 예전과 다르다: ' + tag);
      checked++;
    }
    //  실제 복사(클립보드)와 실제 전송(payload)도 같은 글을 싣는다.
    m.ev(`state.reportFormatPrefs = { daily: { marker: '-', markerCustom: '', indent: 2 }, weekly: { marker: '1.', markerCustom: '', indent: 2 } }; state.gitCommitBody = true; $('#rptWithDesc').checked = true; buildReport();`);
    assert.strictEqual(await copyText(m), m.ev('__REF()'), '복사 버튼이 싣는 글이 예전과 다르다');
    capSend(m); m.doc.getElementById('btnRptSend').click(); await tick();
    const cap = m.evJSON('window.__cap');
    assert.ok(cap, '전송 payload 를 붙잡지 못했다');
    assert.strictEqual(cap.fields.content, m.ev("__REF('&nbsp;')"), '전송 content 가 예전과 다르다');
    assert.deepStrictEqual(cap.hours, [{ name: '알파', hours: 2 }, { name: '베타', hours: 1.5 }, { name: '감마', hours: 1 }], 'payload.hours 가 예전과 다르다');
    //  주간은 글 편집과 무관하다(같은 날짜에 초안이 있어도 주간 글은 그대로).
    m.ev(`reportMode = 'weekly'; $('#rptFrom').value = ${JSON.stringify(m.ev(`addDays(${JSON.stringify(T)}, -6)`))}; $('#rptTo').value = ${JSON.stringify(T)};`);
    assert.strictEqual(m.ev('buildReportText()'), m.ev('__REF()'), '주간 복사 글이 예전과 다르다');
    m.ev(`reportMode = 'daily'; $('#rptFrom').value = ${JSON.stringify(T)}; $('#rptTo').value = ${JSON.stringify(T)}; buildReport();`);
    return checked;
  }

  let B = null, bootErr = null;
  try { B = bootBrowser(app); } catch (e) { bootErr = e; }
  if (bootErr) {
    test('B0: 브라우저 모드 부팅', () => { throw bootErr; });
  } else {
    const T = B.ev('todayYmd()'), Y = B.ev('addDays(todayYmd(), -1)'), N = B.ev('addDays(todayYmd(), 1)');
    const KEY = B.ev('rptDraftKey(todayYmd())'), KEY_Y = B.ev('rptDraftKey(addDays(todayYmd(), -1))');
    const fresh = () => { clearDrafts(B); B.ev('state = ' + JSON.stringify(stateFor(T, Y, N)) + ';'); openDaily(B, T); };
    const done = () => { clearDrafts(B); B.ev("rptView = 'card'; reportMode = 'daily';"); };

    test('B1 (§2.2·§5): 일간 카드에는 ✎, ✕, 날짜 줄 ✎ 가 없고 X 는 있다 · 주간도 읽기 전용 + X · 기간 취합만 날짜 줄 ✎, X 없음', () => {
      fresh();
      try {
        const html = B.ev("$('#rptOut').innerHTML");
        assert.ok(html.includes('기간 할 일') && html.includes('오늘 메모'), '전제: 기간 할 일과 그날 메모가 카드에 있다');
        assert.ok(!/rtask-edit-btn|rtask-del-btn|data-ract=|rdn-edit-btn|data-dnact=/.test(html), '일간 카드에 줄 ✎/✕ 나 날짜 줄 ✎ 가 있다');
        assert.ok(/<div class="rdn ro">/.test(html), '일간 날짜 줄이 읽기 전용(.rdn.ro)이 아니다');
        assert.strictEqual(B.ev("document.querySelectorAll('#rptOut .rcard-x').length"), 4, '카드마다 X 가 하나씩 있어야 한다');
        assert.strictEqual(B.ev("$('#rptViewBar').classList.contains('hidden')"), false, '일간 보기 전환 줄이 보이지 않는다');
        assert.strictEqual(B.ev("$('#rptViewSeg [data-rview=\"card\"]').getAttribute('aria-pressed')"), 'true', '기본 보기가 카드가 아니다');
        //  WEEKLY-EDIT(2026-10-08): 주간 작성도 읽기 전용 카드 + X + 보기 전환. 날짜 줄 ✎ 는 기간 취합에만 남는다.
        B.ev(`setReportMode('weekly'); $('#rptFrom').value = ${JSON.stringify(Y)}; $('#rptTo').value = ${JSON.stringify(N)}; buildReport();`);
        assert.ok(B.ev("!!document.querySelector('#rptOut .rwf')"), '주간은 글 편집(회사 폼)으로 열려야 한다(2026-10-08)');
        B.ev("rptViewW = 'card'; buildReport();");
        const wk = B.ev("$('#rptOut').innerHTML");
        assert.ok(wk.includes('오늘 메모') && !/rdn-edit-btn|data-dnact=/.test(wk), '주간 날짜 줄 ✎ 가 남아 있다(주간도 읽기 전용)');
        assert.ok(/rcard-x/.test(wk), '주간 카드에 X 가 없다');
        assert.strictEqual(B.ev("$('#rptViewBar').classList.contains('hidden')"), false, '주간에 보기 전환 줄이 보이지 않는다');
        B.ev(`setReportMode('custom'); $('#rptFrom').value = ${JSON.stringify(Y)}; $('#rptTo').value = ${JSON.stringify(N)}; buildReport();`);
        const cu = B.ev("$('#rptOut').innerHTML");
        assert.ok(/class="rdn-edit-btn"/.test(cu), '대조군: 기간 취합 날짜 줄 ✎ 는 남아 있어야 한다');
        assert.ok(!/rcard-x/.test(cu), '기간 취합 카드에 X 가 있다');
        assert.strictEqual(B.ev("$('#rptViewBar').classList.contains('hidden')"), true, '기간 취합에 보기 전환 줄이 보인다');
      } finally { done(); }
    });

    test('B2 (§3.2): 고친 것도 뺀 것도 없으면 나가는 글 = 예전 buildReportText(바이트 같음) · 복사와 전송 둘 다', async () => {
      fresh();
      try {
        const n = await assertSameAsRef(B, T);
        assert.ok(n >= 20, '비교한 서식 조합이 너무 적다: ' + n);
        //  다른 날짜에 초안이 있어도 이 날짜 글은 그대로다(날짜 단위).
        B.ev(`rptDraftPut(${JSON.stringify(Y)}, { v:1, date:${JSON.stringify(Y)}, body:{ 'c-a':'남의 날 글' }, base:{ 'c-a':'' }, out:['c-b'], savedAt:'' }, true);`);
        assert.strictEqual(B.ev('buildReportText()'), B.ev('__REF()'), '다른 날짜의 초안이 이 날짜 글을 바꿨다');
      } finally { done(); }
    });

    test('B3 (§2.2·§3.2): X — 카드는 그 자리에 흐리게 남고(수, 순서 같음) 나가는 글과 payload.hours 에서 빠진다 · 되돌리기로 원래대로', () => {
      fresh();
      try {
        B.ev('window.__REF = ' + REF.toString());
        const names0 = cardNames(B), ref0 = B.ev('__REF()');
        clickIn(B, 'c-b', '.rcard-x');
        assert.deepStrictEqual(cardNames(B), names0, 'X 뒤 카드 수나 순서가 바뀌었다(제자리에 남아야 한다)');
        const cb = card(B, 'c-b');
        assert.ok(cb.classList.contains('rcard-out') && !cb.classList.contains('rcard-empty'), '뺀 카드가 별도 흐림 클래스(rcard-out)가 아니다');
        assert.ok(cb.querySelector('.rcard-outnote') && cb.querySelector('.rcard-outnote').textContent.includes('이 보고서에서 뺌'), '"이 보고서에서 뺌" 이 없다');
        assert.strictEqual(cb.querySelector('.rcard-slot .rcard-back').textContent, '되돌리기', '되돌리기가 같은 칸(.rcard-slot)에 없다');
        assert.ok(cb.querySelector('.rcard-slot .rcard-live .rcard-h-in'), '시간 칸이 같은 칸에 남아 있지 않다(높이를 지켜야 한다)');
        assert.strictEqual(B.doc.activeElement, cb.querySelector('.rcard-back'), '키보드 포커스가 되돌리기로 가지 않는다');
        assert.ok(B.ev("$('#rptSummary').textContent").includes('1개 뺌'), '요약줄이 뺀 수를 말하지 않는다');
        const txt = B.ev('buildReportText()');
        assert.ok(!txt.includes('[베타]') && !txt.includes('고객 회신'), '뺀 과제가 복사 글에 남아 있다');
        assert.strictEqual(txt, ref0.replace('[베타] : 1.5\n' + B.ev("reportRowBodyText(collectReportData(todayYmd(), todayYmd(), rptSources()).rows[1], '\\u00a0', reportMarkerSpec(), 2)") + '\n\n', ''), '뺀 과제 블록만 빠지지 않았다');
        capSend(B); B.doc.getElementById('btnRptSend').click();
        const cap = B.evJSON('window.__cap');
        assert.ok(!cap.fields.content.includes('[베타]'), '뺀 과제가 전송 content 에 남아 있다');
        assert.deepStrictEqual(cap.hours, [{ name: '알파', hours: 2 }, { name: '감마', hours: 1 }], 'payload.hours 에 뺀 과제가 남아 있다(머리 줄과 hours 가 갈린다)');
        assert.ok(draftKeys(B).includes(KEY) && getDraft(B, KEY).out.includes('c-b'), 'X 가 바로 임시 저장되지 않았다');
        //  되돌리기
        clickIn(B, 'c-b', '.rcard-back');
        assert.ok(!card(B, 'c-b').classList.contains('rcard-out'), '되돌리기 뒤에도 흐리다');
        assert.strictEqual(B.doc.activeElement, card(B, 'c-b').querySelector('.rcard-x'), '되돌리기 뒤 포커스가 X 로 돌아오지 않는다');
        assert.strictEqual(B.ev('buildReportText()'), ref0, '되돌리기 뒤 글이 원래와 다르다');
        assert.ok(!draftKeys(B).includes(KEY), '고친 것도 뺀 것도 없는데 임시 저장 키가 남아 있다');
        //  전부 빼면 보낼 글이 없다
        for (const c of ['c-a', 'c-b', 'c-c', 'c-d']) clickIn(B, c, '.rcard-x');
        assert.strictEqual(B.ev('buildReportText()'), '', '전부 뺐는데 글이 남는다');
      } finally { done(); }
    });

    test('B4 (§2.3·§3.2): 글 편집 — 머리 줄은 잠김(textarea 아님) · 시간 칸을 바꾸면 머리 줄이 바뀌고 고친 글은 남는다 · 상세 줄이 &nbsp; / U+00A0 들여쓰기로 나간다', async () => {
      fresh();
      try {
        setView(B, 'doc');
        assert.strictEqual(B.ev("$('#rptViewSeg [data-rview=\"doc\"]').getAttribute('aria-pressed')"), 'true');
        const heads = B.evJSON("[].map.call(document.querySelectorAll('#rptOut .rdoc-lock .rdoc-head'), function(x){ return x.tagName + '|' + x.textContent; })");
        assert.deepStrictEqual(heads, ['SPAN|[알파] : 2', 'SPAN|[베타] : 1.5', 'SPAN|[감마] : 1', 'SPAN|[델타]'], '머리 줄이 잠긴 줄(span)이 아니거나 값이 다르다');
        assert.strictEqual(B.ev("document.querySelectorAll('#rptOut .rdoc-ta').length"), 4, '내용 칸이 과제마다 하나가 아니다');
        assert.ok(!B.evJSON("[].some.call(document.querySelectorAll('#rptOut textarea'), function(t){ return /^\\s*\\[/.test(t.value) || t.closest('.rdoc-lock'); })"), '머리 줄이 입력 칸 안에 있다');
        const draftA = B.ev("reportRowBodyText(collectReportData(todayYmd(), todayYmd(), rptSources()).rows[0], ' ', reportMarkerSpec(), 2)");
        assert.strictEqual(ta(B, 'c-a').value, draftA, '내용 칸의 처음 값이 초안 본문(같은 함수, 공백 단위)이 아니다');
        //  상세 줄 쓰기(들여쓰기 + 번호)
        const mine = '• 로그인 화면 리뷰\n    - UI 확인\n\t1) 암호화 모듈 확인\n  줄 안쪽   공백은  그대로';
        typeIn(B, 'c-a', mine);
        const sec = ta(B, 'c-a').closest('.rdoc-sec');
        assert.strictEqual(sec.querySelector('.rdoc-revert').hidden, false, '고쳤는데 "초안으로" 가 없다');
        assert.ok(B.ev("$('#rptEditInfo').textContent").includes('고친 과제 1개'), '"고친 과제 1개" 가 없다');
        const NB = '&nbsp;', U = ' ';
        const wantSend = '[알파] : 2\n• 로그인 화면 리뷰\n' + NB.repeat(4) + '- UI 확인\n' + NB.repeat(4) + '1) 암호화 모듈 확인\n' + NB.repeat(2) + '줄 안쪽   공백은  그대로';
        const wantCopy = wantSend.split(NB).join(U);
        assert.ok(B.ev("buildReportText('&nbsp;')").startsWith(wantSend + '\n\n[베타] : 1.5\n'), '전송 글의 상세 줄 들여쓰기가 &nbsp; 가 아니거나 머리 줄이 바뀌었다');
        assert.ok((await copyText(B)).startsWith(wantCopy + '\n\n[베타] : 1.5\n'), '복사 글의 상세 줄 들여쓰기가 U+00A0 이 아니다');
        //  카드 보기: 고친 글 그대로 + "고침"
        setView(B, 'card');
        assert.strictEqual(card(B, 'c-a').querySelector('.rcard-edited').textContent, '고침');
        assert.strictEqual(card(B, 'c-a').querySelector('.rcard-free').textContent, mine.replace('\t', '    '), '카드에 고친 글이 그대로 보이지 않는다');
        //  시간 칸 바꾸기 → 머리 줄이 바뀌고 고친 글은 남는다
        const inp = card(B, 'c-a').querySelector('.rcard-h-in'); inp.value = '3'; inp.dispatchEvent(new B.w.Event('change', { bubbles: true }));
        setView(B, 'doc');
        assert.strictEqual(B.ev("$('#rptOut .rdoc-head').textContent"), '[알파] : 3', '시간 칸을 바꿨는데 잠긴 머리 줄이 그대로다');
        assert.strictEqual(ta(B, 'c-a').value, mine, '시간을 바꾸자 고친 글이 사라졌다');
        assert.ok(B.ev("buildReportText('&nbsp;')").startsWith('[알파] : 3\n• 로그인 화면 리뷰\n'), '나가는 글의 머리 줄이 시간 칸을 따르지 않는다');
        //  X 와 보기 전환을 오가도 고친 글은 남는다
        setView(B, 'card'); clickIn(B, 'c-a', '.rcard-x'); setView(B, 'doc');
        assert.ok(B.ev("$('#rptOut .rdoc-outsec').textContent").includes('[알파] 이 보고서에서 뺌, 카드에서 되돌릴 수 있습니다'), '뺀 과제가 글 편집에서 한 줄 안내가 아니다');
        setView(B, 'card'); clickIn(B, 'c-a', '.rcard-back'); setView(B, 'doc');
        assert.strictEqual(ta(B, 'c-a').value, mine, 'X 와 되돌리기를 오가자 고친 글이 사라졌다');
        //  초안과 같게 되돌려 쓰면 "고치지 않음" 으로 돌아간다
        typeIn(B, 'c-a', draftA);
        assert.strictEqual(ta(B, 'c-a').closest('.rdoc-sec').querySelector('.rdoc-revert').hidden, true, '초안과 같아졌는데 "초안으로" 가 남아 있다');
        B.ev('rptDraftFlush()');
        assert.ok(!draftKeys(B).includes(KEY), '초안과 같아졌는데 임시 저장 키가 남아 있다');
        B.ev("setTaskHours(todayYmd(), 'c-a', 2)");
      } finally { done(); }
    });

    test('B5 (§4): 임시 저장 — 입력 뒤 키가 생기고 닫고 열어도, 다시 읽어도 고친 글과 X 가 그대로 · 날짜를 바꾸면 그 날짜 것', async () => {
      fresh();
      try {
        setView(B, 'doc');
        typeIn(B, 'c-a', '• 상세\n    - 하위');
        assert.ok(!draftKeys(B).includes(KEY), '입력 즉시 쓰면 안 된다(짧게 모아서 쓴다)');
        await tick(500);   // 디바운스(400ms)
        const d = getDraft(B, KEY);
        assert.ok(d, '입력 뒤 키(' + KEY + ')가 생기지 않았다');
        assert.strictEqual(d.v, 1); assert.strictEqual(d.date, T);
        assert.strictEqual(d.body['c-a'], '• 상세\n    - 하위');
        assert.strictEqual(typeof d.base['c-a'], 'string', '기준본(base)이 없다');
        assert.deepStrictEqual(d.out, []);
        assert.ok(!isNaN(Date.parse(d.savedAt)), 'savedAt 이 시각이 아니다');
        assert.ok(B.ev("$('#rptEditInfo').textContent").includes('이 PC에 임시 저장됨'), '"이 PC에 임시 저장됨" 이 없다');
        setView(B, 'card'); clickIn(B, 'c-b', '.rcard-x');
        //  닫고 다시 열기(보고서는 늘 오늘, 카드 보기로 연다)
        B.ev("closeModal('#reportModal')");
        await waitFor(() => overlayClosed(B, 'reportModal'), '보고서가 닫힌다');
        openDaily(B, T);
        assert.strictEqual(B.ev('rptView'), 'card', '다시 열면 카드 보기여야 한다');
        assert.ok(card(B, 'c-b').classList.contains('rcard-out'), '닫고 열자 X 가 사라졌다');
        assert.strictEqual(card(B, 'c-a').querySelector('.rcard-free').textContent, '• 상세\n    - 하위', '닫고 열자 고친 글이 사라졌다');
        //  앱 다시 시작(메모리 비움) 뒤에도 저장소에서 읽는다
        B.ev('__rptDraftMem.clear(); __rptDraftDirty.clear(); __rptDraftFailed.clear(); buildReport();');
        assert.ok(card(B, 'c-b').classList.contains('rcard-out') && B.ev('buildReportText()').startsWith('[알파] : 2\n• 상세\n    - 하위\n\n[감마]'), '다시 읽기 뒤 임시 저장이 반영되지 않는다');
        //  날짜 바꾸기 → 그 날짜 것(어제는 깨끗) → 돌아오면 다시
        setDate(B, Y);
        assert.ok(!B.ev("document.querySelectorAll('#rptOut .rcard-out').length") && !B.ev("document.querySelectorAll('#rptOut .rcard-edited').length"), '다른 날짜에 이 날짜의 X 나 고친 글이 보인다');
        clickIn(B, 'c-a', '.rcard-x');
        assert.ok(draftKeys(B).includes(KEY_Y) && getDraft(B, KEY_Y).out.includes('c-a'), '어제 날짜의 X 가 어제 키에 저장되지 않았다');
        setDate(B, T);
        assert.ok(card(B, 'c-b').classList.contains('rcard-out') && !card(B, 'c-a').classList.contains('rcard-out'), '날짜를 오가자 날짜별 X 가 섞였다');
        //  모두 초안으로 → 이 날짜 키를 지운다(어제 것은 그대로)
        setView(B, 'doc');
        B.doc.querySelector('#rptOut .rdoc-resetall').click();
        await confirmOk(B);
        assert.ok(!draftKeys(B).includes(KEY), '"모두 초안으로" 뒤에도 이 날짜 키가 남아 있다');
        assert.ok(draftKeys(B).includes(KEY_Y), '"모두 초안으로" 가 다른 날짜까지 지웠다');
        assert.ok(B.doc.activeElement && B.doc.activeElement.classList.contains('rdoc-ta'), '"모두 초안으로" 뒤 포커스가 첫 내용 칸으로 가지 않는다(정정 7): ' + (B.doc.activeElement && B.doc.activeElement.tagName));
        assert.strictEqual(B.ev("$('#rptOut .rdoc-resetall').disabled"), true, '지울 것이 없는데 "모두 초안으로" 가 켜져 있다');
      } finally { done(); }
    });

    test('B6 (§4·§7): 렌더만으로는 저장소에 쓰지 않는다(열기, 날짜, 보기 전환, 복사, 글 만들기)', async () => {
      fresh();
      try {
        B.ev(`localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ v:1, date:${JSON.stringify(T)}, body:{ 'c-a':'저장된 글' }, base:{ 'c-a':'옛 초안' }, out:['c-c'], savedAt:'2026-01-01T00:00:00.000Z' }));`);
        B.ev("window.__w = []; (function(){ var P = Storage.prototype, s = P.setItem, r = P.removeItem; P.setItem = function(k, v){ if(String(k).indexOf('tc_rptDraft:')===0) window.__w.push('set '+k); return s.apply(this, arguments); }; P.removeItem = function(k){ if(String(k).indexOf('tc_rptDraft:')===0) window.__w.push('rm '+k); return r.apply(this, arguments); }; window.__unspy = function(){ P.setItem = s; P.removeItem = r; }; })();");
        try {
          B.ev("setReportMode('daily'); buildReport();"); setDate(B, Y); setDate(B, T);
          setView(B, 'doc'); setView(B, 'card');
          B.ev("buildReportText(); buildReportText('&nbsp;');"); await copyText(B);
          B.ev("setReportMode('weekly'); setReportMode('daily');");
          assert.deepStrictEqual(B.evJSON('window.__w'), [], '렌더나 글 만들기가 임시 저장을 썼다');
          assert.ok(card(B, 'c-c').classList.contains('rcard-out'), '전제: 저장된 초안을 읽어 그렸다');
        } finally { B.ev('window.__unspy()'); }
      } finally { done(); }
    });

    test('B7 (§4): 보고서를 열면 이 계정의 14일 지난 임시 저장만 지운다', () => {
      clearDrafts(B);
      try {
        const who = B.ev('rptDraftWho()');
        const k15 = `tc_rptDraft:${who}:${B.ev('addDays(todayYmd(), -15)')}`, k14 = `tc_rptDraft:${who}:${B.ev('addDays(todayYmd(), -14)')}`;
        const other = `tc_rptDraft:other-user:${B.ev('addDays(todayYmd(), -30)')}`, bogus = `tc_rptDraft:${who}:not-a-date`;
        for (const k of [k15, k14, other, bogus]) B.ev(`localStorage.setItem(${JSON.stringify(k)}, '{"v":1}')`);
        B.ev('openReport()');
        const keys = draftKeys(B);
        assert.ok(!keys.includes(k15), '15일 지난 키가 남아 있다');
        assert.ok(keys.includes(k14), '14일째 키까지 지웠다');
        assert.ok(keys.includes(other), '다른 계정의 키를 지웠다');
        assert.ok(keys.includes(bogus), '날짜 꼴이 아닌 키를 지웠다');
      } finally { done(); }
    });

    test('B8 (§4): 저장소가 예외를 던져도 화면은 동작한다(메모리에만, "임시 저장됨" 없음)', () => {
      fresh();
      B.ev("(function(){ var P = Storage.prototype, g = P.getItem, s = P.setItem, r = P.removeItem, k = P.key; var bad = function(x){ return String(x).indexOf('tc_rptDraft:')===0; };"
        + " P.getItem = function(x){ if(bad(x)) throw new Error('blocked'); return g.apply(this, arguments); }; P.setItem = function(x){ if(bad(x)) throw new Error('blocked'); return s.apply(this, arguments); };"
        + " P.removeItem = function(x){ if(bad(x)) throw new Error('blocked'); return r.apply(this, arguments); }; P.key = function(){ throw new Error('blocked'); };"
        + " window.__unblock = function(){ P.getItem = g; P.setItem = s; P.removeItem = r; P.key = k; }; })();");
      try {
        B.ev('openReport(); buildReport();');   // 정리(prune)가 key() 예외를 삼켜야 한다
        clickIn(B, 'c-b', '.rcard-x');
        assert.ok(card(B, 'c-b').classList.contains('rcard-out'), '저장소가 막히자 X 가 동작하지 않는다');
        setView(B, 'doc'); typeIn(B, 'c-a', '막힌 저장소에서 쓴 글');
        B.ev('rptDraftFlush()');
        assert.ok(B.ev("buildReportText()").startsWith('[알파] : 2\n막힌 저장소에서 쓴 글\n\n[감마] : 1'), '저장소가 막히자 고친 글과 X 가 나가는 글에 반영되지 않는다');
        const info = B.ev("$('#rptEditInfo').textContent");
        assert.ok(info.includes('고친 과제 1개') && !info.includes('임시 저장됨'), '막힌 저장소인데 "임시 저장됨" 을 말한다: ' + info);
        setView(B, 'card');
        assert.ok(card(B, 'c-b').classList.contains('rcard-out') && card(B, 'c-a').querySelector('.rcard-free'), '막힌 저장소에서 다시 그리자 메모리 초안이 사라졌다');
      } finally { B.ev('window.__unblock()'); done(); }
    });

    test('B9 (§3.3): 낡은 초안 — 기준본과 지금 초안이 다르면 안내가 뜨고 고친 글은 그대로다 · "초안으로" 로 새 내용', async () => {
      fresh();
      try {
        setView(B, 'doc');
        typeIn(B, 'c-a', '내가 쓴 글');
        assert.strictEqual(ta(B, 'c-a').closest('.rdoc-sec').querySelector('.rdoc-stale').hidden, true, '막 고쳤는데 낡았다고 한다');
        //  그새 커밋이 늘었다
        B.ev(`state.entries.push(${JSON.stringify(E({ id: 'e-a9', date: T, title: '새로 생긴 일', categoryId: 'c-a' }))}); notifyDataChanged();`);
        const sec = ta(B, 'c-a').closest('.rdoc-sec');
        assert.strictEqual(sec.querySelector('.rdoc-stale').hidden, false, '기준본과 초안이 다른데 안내가 없다');
        assert.ok(sec.querySelector('.rdoc-stale').textContent.includes('캘린더 기록이 바뀌었습니다'), '안내 문구가 다르다');
        assert.strictEqual(ta(B, 'c-a').value, '내가 쓴 글', '낡은 초안이 고친 글을 자동으로 덮었다');
        assert.ok(B.ev('buildReportText()').startsWith('[알파] : 2\n내가 쓴 글\n'), '낡은 초안일 때 나가는 글이 고친 글이 아니다');
        sec.querySelector('.rdoc-revert').click();
        await confirmOk(B);
        assert.ok(ta(B, 'c-a').value.includes('새로 생긴 일'), '"초안으로" 뒤에 새 내용이 들어가지 않았다');
        assert.ok(!B.ev("$('#rptEditInfo').textContent").includes('고친 과제'), '"초안으로" 뒤에도 고친 과제로 센다');
      } finally { done(); }
    });

    test('B10 (§2.3): 대괄호 줄 안내 — 머리 줄 꼴이 있으면 안내만(막지 않는다)', () => {
      fresh();
      try {
        setView(B, 'doc');
        typeIn(B, 'c-a', '• 보통 줄\n[다른 과제] : 2\n- 끝');
        const warn = ta(B, 'c-a').closest('.rdoc-sec').querySelector('.rdoc-warn');
        assert.strictEqual(warn.hidden, false, '대괄호 머리 줄 꼴인데 안내가 없다');
        assert.ok(warn.textContent.includes('대괄호로 시작하는 줄은 netcus 일간보고 합치기에서 과제 머리 줄로 읽힐 수 있습니다.'));
        assert.ok(B.ev('buildReportText()').includes('\n[다른 과제] : 2\n'), '안내가 글을 막았다(막지 않는다)');
        typeIn(B, 'c-a', '• 보통 줄\n문장 안의 [괄호] 는 괜찮다\n[ ] 빈 괄호');
        assert.strictEqual(warn.hidden, true, '머리 줄 꼴이 아닌데 안내가 뜬다');
      } finally { done(); }
    });

    test('B11 (§4): 브라우저(회신 없음)는 전송해도 자동으로 지우지 않는다 · 대기 표지를 세우지 않는다', () => {
      fresh();
      try {
        clickIn(B, 'c-b', '.rcard-x');
        capSend(B); B.doc.getElementById('btnRptSend').click();
        assert.ok(B.evJSON('window.__cap'), '전송 payload 를 붙잡지 못했다');
        assert.strictEqual(B.ev('__rptDraftSending'), '', '브라우저에서 대기 표지를 세웠다');
        B.ev("window.__netcusResult(true, '흉내')");
        assert.ok(draftKeys(B).includes(KEY), '브라우저에서 임시 저장이 지워졌다');
      } finally { done(); }
    });

    //  정정 2(2026-10-08 사용자 결정): 시간이 있는 과제를 X 하면 막지 않고 안내만 한다. 시간이 없으면, 되돌리기면 아무 말 없다.
    function checkXHoursNotice(m) {
      m.ev('window.__toasts = []; window.__toastOrig = window.__toastOrig || toast; toast = function(msg, k){ window.__toasts.push([String(msg), k]); return window.__toastOrig.apply(this, arguments); };');
      try {
        clickIn(m, 'c-a', '.rcard-x');   // 알파: 2시간
        let ts = m.evJSON('window.__toasts');
        assert.ok(card(m, 'c-a').classList.contains('rcard-out'), '시간이 있어도 X 는 바로 빼야 한다(막지 않는다)');
        assert.strictEqual(ts.length, 1, '시간이 있는 과제를 뺐는데 안내가 하나가 아니다: ' + JSON.stringify(ts));
        assert.ok(ts[0][0].includes("'알파'") && ts[0][0].includes('2시간') && ts[0][0].includes('주간 과제투입시간') && ts[0][1] === 'info', '안내에 과제명과 시간이 없거나 info 가 아니다: ' + JSON.stringify(ts[0]));
        clickIn(m, 'c-a', '.rcard-back');
        clickIn(m, 'c-d', '.rcard-x');   // 델타: 시간 없음
        ts = m.evJSON('window.__toasts');
        assert.strictEqual(ts.length, 1, '되돌리기나 시간 없는 과제 X 에도 안내가 떴다: ' + JSON.stringify(ts));
        clickIn(m, 'c-d', '.rcard-back');
        clickIn(m, 'c-a', '.rcard-x');   // 뺄 때마다 뜬다
        assert.strictEqual(m.evJSON('window.__toasts').length, 2, '다시 뺐는데 안내가 다시 뜨지 않았다');
      } finally { m.ev('toast = window.__toastOrig;'); }
    }
    test('B13 (정정 2): 시간이 있는 과제 X 는 막지 않고 과제명과 시간을 담은 안내를 띄운다 · 시간 없는 과제와 되돌리기는 조용하다', () => {
      fresh();
      try { checkXHoursNotice(B); } finally { done(); }
    });
    test('변이 BM3: X 의 시간 안내를 빼면 B13 이 잡는다', () => {
      const bad = mutate(app, "          toast(`'${_r ? _r.name : ''}'의 ${_h}시간은", "          void(`'${_r ? _r.name : ''}'의 ${_h}시간은");
      const X = bootBrowser(bad);
      try {
        X.ev('state = ' + JSON.stringify(stateFor(T, Y, N)) + ';'); openDaily(X, T);
        assert.throws(() => checkXHoursNotice(X), /안내가 하나가 아니다/);
      } finally { X.close(); }
    });

    test('B12 (정정 4): 없어진 과제의 흔적만 남은 저장본은 "임시 저장됨", "모두 초안으로" 를 켜지 않고, 다음 쓰기 때 걷힌다(렌더는 쓰지 않는다)', () => {
      fresh();
      try {
        const raw = JSON.stringify({ v: 1, date: T, body: { 'c-gone': '지운 과제의 글' }, base: { 'c-gone': '' }, out: ['c-gone2'], savedAt: '2026-01-01T00:00:00.000Z' });
        B.ev(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(raw)}); buildReport();`);
        assert.strictEqual(B.ev("$('#rptEditInfo').textContent"), '', '없어진 과제의 흔적으로 "고친 과제" 나 "임시 저장됨" 을 말한다');
        setView(B, 'doc');
        assert.strictEqual(B.ev("$('#rptOut .rdoc-resetall').disabled"), true, '없어진 과제의 흔적만 있는데 "모두 초안으로" 가 켜져 있다');
        assert.strictEqual(B.ev(`localStorage.getItem(${JSON.stringify(KEY)})`), raw, '렌더가 저장본을 고쳐 썼다');
        setView(B, 'card'); clickIn(B, 'c-b', '.rcard-x');
        const d = getDraft(B, KEY);
        assert.deepStrictEqual([Object.keys(d.body), Object.keys(d.base), d.out], [[], [], ['c-b']], '쓸 때 없어진 과제의 흔적을 걷지 않았다: ' + JSON.stringify(d));
        clickIn(B, 'c-b', '.rcard-back');
        assert.ok(!draftKeys(B).includes(KEY), '흔적을 걷고 나면 키가 지워져야 한다');
      } finally { done(); }
    });

    test('변이 BM1: 본문 함수를 바꾸면(줄 사이 빈 줄) B2 의 기준 비교가 잡는다', async () => {
      const bad = mutate(app, "    return _pad + _prefix + t + reportTextDetails(m, _sub) + reportTextBody(m, _sub);   // 일정 메모/할일 노트(설명) + 커밋 전체 본문: 주간 전송과 같은 함수\n  }).join('\\n');",
        "    return _pad + _prefix + t + reportTextDetails(m, _sub) + reportTextBody(m, _sub);\n  }).join('\\n\\n');");
      const X = bootBrowser(bad);
      try {
        X.ev('state = ' + JSON.stringify(stateFor(T, Y, N)) + ';'); openDaily(X, T);
        await assert.rejects(() => assertSameAsRef(X, T), /예전과 다르다/);
      } finally { await X.close(); }
    });
    test('변이 BM2: X 를 카드 지우기로 바꾸면(제자리에 남지 않음) B3 의 자리 검사가 잡는다', () => {
      const bad = mutate(app, "  else for(const r of rows){\n", "  else for(const r of rows.filter(r => !(_dr && _dr.out.includes(r.key)))){\n");
      const X = bootBrowser(bad);
      try {
        X.ev('state = ' + JSON.stringify(stateFor(T, Y, N)) + ';'); openDaily(X, T);
        const before = cardNames(X);
        clickIn(X, 'c-b', '.rcard-x');
        assert.notDeepStrictEqual(cardNames(X), before, '변이가 경로에 닿지 않았다');
      } finally { X.close(); }
    });
  }

  // ── (W) 위젯 모드: 전송 회신과 임시 저장 수명 ────────────────────────
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  async function widgetFixture(src) {
    const M = bootWidget(src);
    const T = M.ev('todayYmd()'), Y = M.ev('addDays(todayYmd(), -1)'), N = M.ev('addDays(todayYmd(), 1)');
    clearDrafts(M);
    M.ev('__applyState(' + JSON.stringify(JSON.stringify(stateFor(T, Y, N))) + ',' + JSON.stringify(META) + ')');
    await tick();
    openDaily(M, T);
    return { M, T, KEY: 'tc_rptDraft:7:' + T };
  }
  //  고친 글 + X 를 만들고 전송(확인 수락)까지. 반환: 붙잡은 payload.
  async function editAndSend(M) {
    setView(M, 'doc');
    typeIn(M, 'c-a', '• 로그인 화면 리뷰\n    - UI 확인\n    - 암호화 모듈 확인');
    setView(M, 'card'); clickIn(M, 'c-b', '.rcard-x');
    capSend(M);
    M.doc.getElementById('btnRptSend').click();
    await confirmOk(M);
    const cap = M.evJSON('window.__cap');
    assert.ok(cap, '확인 뒤 전송 payload 가 나가지 않았다');
    return cap;
  }
  //  실패 회신은 지우지 않고, 표지는 비운다(그 뒤 성공 회신이 와도 지우지 않는다) — 변이 시험이 재사용한다.
  async function failureKeeps(M, KEY) {
    await editAndSend(M);
    M.ev("window.__netcusResult(false, '전송 실패(시험)')");
    assert.ok(draftKeys(M).includes(KEY), '실패 회신에 임시 저장이 지워졌다');
    M.ev("window.__netcusResult(true, '주간 채우기(시험)')");
    assert.ok(draftKeys(M).includes(KEY), '표지 없는 성공 회신(주간 채우기 등)에 임시 저장이 지워졌다');
  }

  test('W1 (§3.2·§4): 위젯 일간 전송 — 고친 글은 &nbsp; 들여쓰기로, 뺀 과제는 본문과 hours 에서 빠지고, 성공 회신이면 임시 저장을 지운다', async () => {
    const { M, T, KEY } = await widgetFixture(app);
    try {
      const cap = await editAndSend(M);
      const NB = '&nbsp;'.repeat(4);
      assert.ok(cap.fields.content.startsWith('[알파] : 2\n• 로그인 화면 리뷰\n' + NB + '- UI 확인\n' + NB + '- 암호화 모듈 확인\n\n[감마] : 1'),
        '전송 content 가 고친 글(&nbsp; 들여쓰기)이 아니거나 뺀 과제가 남았다: ' + JSON.stringify(cap.fields.content.slice(0, 160)));
      assert.ok(!cap.fields.content.includes('[베타]'));
      assert.deepStrictEqual(cap.hours, [{ name: '알파', hours: 2 }, { name: '감마', hours: 1 }], 'hours 에 뺀 과제가 남았다');
      assert.strictEqual(M.ev('__rptDraftSending'), KEY, '확인 뒤 대기 표지가 서지 않았다');
      assert.ok(draftKeys(M).includes(KEY), '전송 전 임시 저장이 없다');
      M.ev("window.__netcusResult(true, '회사 일간보고 전송 완료(시험)')");
      assert.ok(!draftKeys(M).includes(KEY), '성공 회신인데 임시 저장이 남아 있다');
      assert.strictEqual(M.ev('__rptDraftSending'), '', '회신 뒤에도 대기 표지가 남아 있다');
      assert.ok(M.ev("$('#rptSendStatus').textContent").includes('전송 완료(시험)'), '다시 그리며 전송 결과 문구를 지웠다');
      assert.ok(!M.ev("document.querySelectorAll('#rptOut .rcard-out, #rptOut .rcard-edited').length"), '지운 뒤 미리보기가 옛 초안을 보인다');
    } finally { clearDrafts(M); await M.close(); }
  });

  test('W2 (§4): 실패 회신이면 남고, 표지 없는 성공 회신(주간 채우기 등)으로는 지우지 않는다', async () => {
    const { M, KEY } = await widgetFixture(app);
    try { await failureKeeps(M, KEY); } finally { clearDrafts(M); await M.close(); }
  });

  test('W3 (§4): 일간 전송 뒤 회신 없이 주간 채우기를 보내면 그 회신은 일간 임시 저장을 지우지 않는다', async () => {
    const { M, T, KEY } = await widgetFixture(app);
    try {
      await editAndSend(M);
      assert.strictEqual(M.ev('__rptDraftSending'), KEY);
      M.ev('clearTimeout(Netcus.watchdog);');
      M.ev(`setReportMode('weekly'); updateRptSendVis(); window.__capW = null;`);
      M.ev("Platform.report.submitWeekly = function(p){ window.__capW = p; };");
      M.doc.getElementById('btnRptSend').click(); await tick();
      assert.ok(M.ev('!!window.__capW'), '주간 채우기가 나가지 않았다(시험 전제)');
      assert.strictEqual(M.ev('__rptDraftSending'), '', '주간 전송이 일간 대기 표지를 거두지 않았다');
      M.ev("window.__netcusResult(true, '주간보고 작성 폼을 채웠습니다(시험)')");
      assert.ok(draftKeys(M).includes(KEY), '주간 채우기 회신이 일간 임시 저장을 지웠다');
    } finally { clearDrafts(M); await M.close(); }
  });

  test('변이 WM1: 실패 회신도 지우게 바꾸면 W2 의 실행 검사가 잡는다', async () => {
    const bad = mutate(app, 'if(!key || ok !== true || PEER) return;', 'if(!key || PEER) return;');
    const { M, KEY } = await widgetFixture(bad);
    try { await assert.rejects(() => failureKeeps(M, KEY), /실패 회신에 임시 저장이 지워졌다/); }
    finally { clearDrafts(M); await M.close(); }
  });

  //  정정 1: 보낸 뒤 고친 글은 성공 회신이 지우지 않는다(안내 토스트, 쓰던 칸은 그대로) — 변이 시험이 재사용한다.
  async function editAfterSendKept(M, KEY) {
    M.ev('window.__toasts = []; (function(){ var o = toast; toast = function(m){ window.__toasts.push(String(m)); return o.apply(this, arguments); }; })();');
    await editAndSend(M);
    setView(M, 'doc');
    const t = ta(M, 'c-a'); t.focus();
    typeIn(M, 'c-a', '• 로그인 화면 리뷰\n    - UI 확인\n    - 보낸 뒤에 더 쓴 줄');
    t.setSelectionRange(5, 5);
    M.ev("window.__netcusResult(true, '회사 일간보고 전송 완료(시험)')");
    M.ev('rptDraftFlush()');
    const d = getDraft(M, KEY);
    assert.ok(d && String(d.body['c-a']).includes('보낸 뒤에 더 쓴 줄'), '성공 회신이 보낸 뒤 고친 글까지 지웠다');
    assert.ok(M.evJSON('window.__toasts').includes('전송한 뒤에 고친 내용은 임시 저장에 남겨 두었습니다'), '남겨 두었다는 안내가 없다');
    assert.strictEqual(ta(M, 'c-a'), t, '쓰던 내용 칸을 다시 그려 바꿔치웠다');
    assert.ok(t.value.includes('보낸 뒤에 더 쓴 줄') && M.doc.activeElement === t, '쓰던 글이나 포커스를 잃었다');
    assert.strictEqual(M.ev('__rptDraftSending'), '', '회신 뒤에도 대기 표지가 남아 있다');
  }
  test('W4 (정정 1): 전송을 누른 뒤 회신 전에 고친 글은 성공 회신이 지우지 않는다(안내만)', async () => {
    const { M, KEY } = await widgetFixture(app);
    try { await editAfterSendKept(M, KEY); } finally { clearDrafts(M); await M.close(); }
  });
  test('W5 (정정 3): 일간 전송 대기 중 온 주간 채우기 성공 회신은 일간 표지와 임시 저장을 건드리지 않는다', async () => {
    const { M, KEY } = await widgetFixture(app);
    try {
      await editAndSend(M);
      M.ev("window.__netcusResult(true, '주간보고 작성 폼을 채웠습니다 (시험)')");
      assert.ok(draftKeys(M).includes(KEY), '주간 채우기 성공 회신이 일간 임시 저장을 지웠다');
      assert.strictEqual(M.ev('__rptDraftSending'), KEY, '주간 채우기 회신이 일간 대기 표지를 거뒀다(뒤에 올 일간 성공이 지우지 못한다)');
      M.ev("window.__netcusResult(true, '회사 일간보고 전송 완료(시험)')");
      assert.ok(!draftKeys(M).includes(KEY), '대조군: 뒤이은 일간 성공 회신은 지운다');
    } finally { clearDrafts(M); await M.close(); }
  });
  test('변이 WM2: 서명 비교를 빼면 W4 의 실행 검사가 잡는다', async () => {
    const bad = mutate(app, 'if(rptDraftSig(rptDraftGet(date)) !== snap){', 'if(false){');
    const { M, KEY } = await widgetFixture(bad);
    try { await assert.rejects(() => editAfterSendKept(M, KEY), /보낸 뒤 고친 글까지 지웠다/); }
    finally { clearDrafts(M); await M.close(); }
  });

  // ── (P) 열람 창: 임시 저장 읽기·쓰기 0, X·글 편집 없음 ─────────────────
  test('P1 (§4): 열람 창(PEER)에서는 임시 저장을 읽지도 쓰지도 않고 X 와 글 편집이 없다', async () => {
    const P = bootWidget(app, 'https://tcapp.local/?peer=1');
    try {
      assert.strictEqual(P.ev('PEER'), true);
      const T = P.ev('todayYmd()'), Y = P.ev('addDays(todayYmd(), -1)'), N = P.ev('addDays(todayYmd(), 1)');
      //  부모 창이 같은 저장소에 남긴 내 초안(열람 창이 읽으면 남의 보고서에 섞인다)
      P.ev(`localStorage.setItem('tc_rptDraft:me:' + todayYmd(), JSON.stringify({ v:1, date: todayYmd(), body:{ 'c-a':'부모 창의 글' }, base:{}, out:['c-b'], savedAt:'' }));`);
      P.ev(`localStorage.setItem('tc_rptDraft:7:' + todayYmd(), JSON.stringify({ v:1, date: todayYmd(), body:{ 'c-a':'부모 창의 글' }, base:{}, out:['c-b'], savedAt:'' }));`);
      P.ev("window.__acc = []; (function(){ var Pr = Storage.prototype; ['getItem','setItem','removeItem'].forEach(function(n){ var o = Pr[n]; Pr[n] = function(k){ if(String(k).indexOf('tc_rptDraft:')===0) window.__acc.push(n+' '+k); return o.apply(this, arguments); }; }); var ok = Pr.key; Pr.key = function(){ window.__acc.push('key'); return ok.apply(this, arguments); }; })();");
      P.w.__applyState(JSON.stringify(stateFor(T, Y, N)), { peerName: '홍길동', canWrite: false });
      await tick();
      P.ev(`reportMode = 'daily'; $('#rptFrom').value = todayYmd(); $('#rptTo').value = todayYmd(); ['#rptSrcEvent','#rptSrcTodo','#rptSrcGit'].forEach(function(s){ $(s).checked = true; }); buildReport();`);
      assert.strictEqual(P.ev("document.querySelectorAll('#rptOut .rcard').length"), 4, '전제: 열람 창에서 카드가 그려졌다');
      assert.strictEqual(P.ev("document.querySelectorAll('#rptOut .rcard-x').length"), 0, '열람 창에 X 가 있다');
      assert.strictEqual(P.ev("$('#rptViewBar').classList.contains('hidden')"), true, '열람 창에 글 편집 전환이 보인다');
      assert.ok(!P.ev("$('#rptSummary').textContent").includes('글 편집'), '열람 창 요약줄에 글 편집 안내가 붙는다(정정 7)');
      assert.ok(!P.ev("document.querySelectorAll('#rptOut .rcard-out, #rptOut .rcard-edited').length"), '열람 창이 부모의 임시 저장을 읽어 그렸다');
      const txt = P.ev('buildReportText()');
      assert.ok(txt.includes('[베타]') && !txt.includes('부모 창의 글'), '열람 창의 글에 부모의 임시 저장이 섞였다');
      P.ev("rptView = 'doc'; buildReport(); rptDraftPut(todayYmd(), { v:1, date: todayYmd(), body:{ 'c-a':'x' }, base:{}, out:[], savedAt:'' }, true); rptDraftFlush(); rptDraftPrune(); rptDraftArmSend(todayYmd()); window.__netcusResult(true, '시험');");
      assert.strictEqual(P.ev("document.querySelectorAll('#rptOut .rdoc-ta').length"), 0, '열람 창에 글 편집 칸이 그려졌다');
      assert.deepStrictEqual(P.evJSON('window.__acc'), [], '열람 창이 임시 저장 키를 읽거나 썼다');
    } finally { await P.close(); }
  });
}
