// 근태 탭 취합(docs/ATTEND-SUMMARY.md, 2026-11-03)과 주간보고 목록 찾기 시험.
//
//   (S) 정적: 보고서 버튼과 창이 없고, 취합 화면(#atSum)이 근태 탭 안에 있고, 출처는 둘(netcus 일간 없음), 기간 빠른 단추 없음,
//       윗줄은 불러오기만(실적 글자 단추, 출처, 읽어 오기), 월간 문서 값은 결과 칸 머리 줄(2026-11-10 시안 v4 결정 14~16, 21.
//       v2 의 둘째 줄 #asDocBar 와 2026-11-03 의 왼쪽 패널과 띠는 없앴다), 날짜 칸은 띄움 칸 하나(#asPop).
//       2026-11-10 v6 결정 22, 23: 결과는 월간 보고 문서 하나(과제별 글 탭, 글 미리 보기, 복사, [서식] 글꼴, 기간 취합 글 함수가 없다), 왼쪽 상자는 늘 보이고,
//       머리 줄은 보고서 양식, 주간보고 제목 넣기, 작성, 계획, DOCX 저장 순서.
//   (B) jsdom 브라우저: [취합] 진입, 처음 값(지난달), 출처 둘(포함 항목 칸은 없다), 읽어 오기 전에는 호스트 요청이 없다,
//       캘린더 기록 = 이 앱 주간보고 DB 읽기(reportWeeklyList, 겹치는 주만, 나눠 읽기, hours 줄, 글 미리 보기와 월간 문서가 읽기 한 번의 결과를 같이 쓴다,
//       collectReportData 와 회사 사이트 명령 0, 빈 결과 문구), 진입하면 문서 머리 줄과 왼쪽 상자가 보인다, 주간보고 목록의 기간 겹침과 찾기와 쪽.
//   (M) 변이: 보고서 버튼, netcus 일간 출처, 결과 형태 탭과 복사와 서식 칸 되살림, 기간 취합 함수 되살림, 주간보고 제목 넣기 빠짐, 상자 처음 숨김, 겹침 판정, 찾기 범위, 포함 항목 칸, 일정 모으기, 읽기 함수 두 벌, 나눠 읽기 빼기, 주 겹침 판정 빼기, hours 무시를 되살리면 위 검사가 실패한다.
// ★ 회사 사이트에는 아무것도 보내지 않는다(hostRequest 를 가로챈다).
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 80));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳이다: ' + find.slice(0, 80));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
function fnText(src, name) {
  const a = src.indexOf('function ' + name + '(');
  assert.ok(a >= 0, name + ' 이 없다');
  const e = src.indexOf('\n}\n', a);
  return src.slice(a, e + 2);
}

// 정적 계약(변이가 같은 함수를 부른다)
function checkStatic(src) {
  assert.ok(!/id="btnReportTop"|id="btnReportFold"|id="reportModal"|id="rptGroupModal"/.test(src), '보고서 버튼이나 창이 남았다');
  assert.ok(!/function (openReport|setReportMode|setReportRange|buildWeeklyFields)\(/.test(src), '지운 보고서 창 함수가 남았다');
  const a = src.indexOf('<section class="at-view" id="atView"'), b = src.indexOf('</section>', a);
  const view = src.slice(a, b);
  assert.ok(view.includes('id="atSum"'), '취합 화면이 근태 탭 안에 없다');
  const seg = /<div class="seg seg-auto" id="rptSrcSeg"[\s\S]*?<\/div>/.exec(view);
  assert.ok(seg, '출처 seg 가 없다');
  assert.deepStrictEqual([...seg[0].matchAll(/data-rsrc="(\w+)"/g)].map((m) => m[1]), ['cal', 'week'], '출처가 둘이 아니다');
  assert.ok(!/netcus 일간|data-rsrc="net"/.test(view), 'netcus 일간 출처가 화면에 있다');
  assert.ok(!/data-rpreset|setReportRange|이번 달<|지난달</.test(view), '기간 빠른 단추가 있다');
  //  시안 v4(docs/MONTHLY-UX-V2.md 결정 14~16, 21). 예전 기대(v2): 윗줄 한 줄에 결과 형태, 날짜 상자 둘, 출처, 읽어 오기, [서식], 주 단추, 그 아래 문서 값 둘째 줄.
  assert.ok(!/id="(asLeft|asBand|asBandH|asBandSum|asSub|asDocBar|rptmName|rptmPlanDef)"|data-atsplit="s"|class="at-split as-split"/.test(view), '없앤 왼쪽 패널, 끌개, 띠, 둘째 줄, 이름, 계획 기본값 단추가 남았다');
  //  윗줄(결정 14) = 실적 글자 단추, 출처, 읽어 오기, 읽은 결과. 날짜 상자, 결과 형태, 주 단추, [서식]은 없다
  const top = /<div class="as-top" id="asTop">[\s\S]*?\n      <\/div>/.exec(view);
  assert.ok(top, '윗줄(#asTop)이 없다');
  assert.deepStrictEqual([...top[0].matchAll(/ id="(\w+)"/g)].map((m) => m[1]), ['asTop', 'asActBtn', 'asActTxt', 'rptSrcSeg', 'asLoad', 'rptmSrcMsg'], '윗줄이 실적 글자 단추, 출처, 읽어 오기, 읽은 결과가 아니다');
  assert.ok(!/<input/.test(top[0]), '윗줄에 날짜 상자가 있다(결정 16)');
  assert.ok(/<button type="button" class="as-dt" id="asActBtn" data-aspk="act" aria-expanded="false" aria-controls="asPop"><span class="k">실적<\/span><b id="asActTxt"><\/b><span class="car">▾<\/span><\/button>/.test(top[0]), '실적이 글자 단추(짧은 이름, 값, ▾)가 아니다');
  assert.ok(/<button type="button" class="btn primary" id="asLoad">/.test(view), '읽기 전 읽어 오기가 강조 단추가 아니다(결정 18)');
  //  결과 칸(결정 15, v6 결정 22, 23): 머리 줄(보고서 양식 [SW|HW], 주간보고 제목 넣기, 작성, 계획, 오른쪽 끝 DOCX 저장, 폴더 열기)과 문서 미리 보기만.
  //  예전 기대(v4): 맨 위 탭(과제별 글 | 월간 보고 문서), 머리 줄의 [서식], 오른쪽 끝 복사, 글 미리 보기(#asText). v6 결정 22 로 없앴다.
  const card = view.slice(view.indexOf('<div class="as-out" id="asOutCard">'), view.indexOf('<div class="as-pane" id="asDoc">'));
  assert.ok(card.length > 100, '결과 칸이 없다');
  const cids = [...card.matchAll(/ id="(asOut|asHead|asDocHead|rptmTpl|rptmWeekHead|asDateBtn|asPlanBtn|asFmtBtn|asDocAct|rptmSave|rptmOpenDir|btnRptCopy)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(cids, ['asHead', 'asDocHead', 'rptmTpl', 'rptmWeekHead', 'asDateBtn', 'asPlanBtn', 'asDocAct', 'rptmSave', 'rptmOpenDir'], '결과 칸 머리 줄이 양식, 주간보고 제목 넣기, 작성, 계획, 저장 순서가 아니다');
  assert.ok(!/class="as-tabs"|data-aso=|id="(asOut|asText|rptOut|rptSummary|btnRptCopy|asFmtBtn|asFmt|rptFontRow|rptFontFamily|rptFontSize)"/.test(view), '과제별 글 탭, 글 미리 보기, 복사, 서식 칸, 글꼴이 남았다(v6 결정 22)');
  assert.ok(/<span class="rptm-lb">보고서 양식<\/span>\s*<div class="seg seg-auto" id="rptmTpl"/.test(card), '양식 세그 바로 앞에 짧은 이름 보고서 양식이 없다');
  assert.ok(/<label class="check as-wk"><input type="checkbox" id="rptmWeekHead" checked>주간보고 제목 넣기<\/label>/.test(card), '주간보고 제목 넣기가 라벨 붙은 체크가 아니다(v6 결정 23)');
  assert.ok(card.indexOf('class="as-sp"') > card.indexOf('id="asPlanBtn"') && card.indexOf('class="as-sp"') < card.indexOf('id="asDocAct"'), '주 단추가 머리 줄 오른쪽 끝에 있지 않다');
  assert.ok(/class="as-dt rptm-plan" id="asPlanBtn"/.test(card), '계획 단추에 HW 숨김 표시(rptm-plan)가 없다');
  assert.ok(!/class="[^"]*\bhidden\b[^"]*" id="(asDocHead|asDocAct|asDoc)"/.test(view), '문서 머리 줄, 주 단추, 문서 미리 보기가 처음 숨어 있다(결과는 늘 문서다)');
  assert.strictEqual((card.match(/class="btn primary"/g) || []).length, 0, '읽기 전 결과 칸에 강조 단추가 있다(결정 18)');
  assert.ok(/<button type="button" class="btn" id="rptmSave" disabled>/.test(card), '읽기 전 DOCX 저장이 보통+잠금이 아니다');
  //  띄움 칸 하나(결정 16): 실적, 작성, 계획 날짜 칸(서식은 v6 결정 22 로 없앴다). role=dialog 가 아니다(month-todo-close 비모달 팝업 목록 밖, 근거 주석)
  const pop = view.slice(view.indexOf('<div class="as-pop hidden" id="asPop">'), view.indexOf('<div class="at-ed hidden" id="atEd"'));
  assert.ok(pop.length > 100 && !/role="dialog"/.test(pop.slice(0, pop.indexOf('>'))), '띄움 칸이 없거나 role=dialog 다');
  assert.deepStrictEqual([...pop.matchAll(/data-pk="(\w+)"/g)].map((m) => m[1]), ['act', 'date', 'plan'], '띄움 칸 안이 실적, 작성, 계획이 아니다');
  assert.deepStrictEqual([...pop.matchAll(/<input type="date" id="(\w+)"/g)].map((m) => m[1]), ['rptFrom', 'rptTo', 'rptmDate', 'rptmPFrom', 'rptmPTo'], '날짜 칸이 띄움 칸에 없다');
  //  두 칸(결정 21): 왼쪽 상자(과제, 기타, 미식별)와 결과 칸
  const main = view.slice(view.indexOf('<div class="as-main" id="asRight">'), view.indexOf('<div class="as-pop hidden"'));
  assert.ok(main.indexOf('id="asBoxes"') >= 0 && main.indexOf('id="asBoxes"') < main.indexOf('id="asOutCard"') && main.indexOf('id="rptmPick"') < main.indexOf('id="rptmEtc"') && main.indexOf('id="rptmEtc"') < main.indexOf('id="rptmUnid"') && main.indexOf('id="rptmPv"') > main.indexOf('id="asOutCard"'), '상자(과제, 기타, 미식별)와 결과 칸(미리 보기) 순서가 아니다');
  assert.ok(/<div class="as-boxes" id="asBoxes">/.test(main) && /<div class="as-box" id="rptmEtcBox"><div class="as-boxh"><label class="check as-all"><input type="checkbox" id="rptmEtcAll" aria-label="기타 모두 선택">기타<\/label> <span class="rptm-cnt" id="rptmEtcCnt"><\/span><\/div><div class="rptm-list" id="rptmEtc"><\/div><\/div>/.test(main)
    && /<div class="as-box" id="rptmPickBox"><div class="as-boxh"><label class="check as-all"><input type="checkbox" id="rptmPickAll" aria-label="과제 모두 선택">과제<\/label> <span class="rptm-cnt" id="rptmPickCnt"><\/span><\/div>/.test(main), '상자가 처음 숨어 있거나(v6 결정 22: 늘 보인다) 기타 상자가 과제와 같은 목록(켠 수/전체)이 아니거나 머리에 모두 선택 체크가 없다(v7 결정 26)');
  //  v7 결정 28: 읽기 전 빈 아이콘 자리(예전 기대: 결정 18 의 #asBoxBlank, #rptmPvBlank, 상자 숨김 as-wait)는 없다. 종이 칸은 처음부터 보인다
  assert.ok(!/id="(asBoxBlank|rptmPvBlank)"|as-wait|as-paperblank/.test(src) && /<div class="rptm-pvwrap" id="rptmPvWrap">/.test(main), '읽기 전 빈 아이콘 자리나 상자 숨김이 남았거나 종이 칸이 처음 숨어 있다(v7 결정 28)');
  assert.ok(/\.as-main\{[^}]*display:grid;grid-template-columns:minmax\(300px,400px\) minmax\(0,1fr\)/.test(src) && /@media \(max-width:900px\)\{\s*\.as-main\{display:block/.test(src) && !/\.as-main\.doc/.test(src), '두 칸(늘 나란히, 좁은 폭 위아래) CSS 가 아니다');
  assert.ok(!/\.as-band|\.as-left|\.as-split|\.as-view \.rptm-set|\.as-mon|\.as-docbar|\.as-docm|\.as-fmtpop|\.rptm-etc-cats/.test(src), '옛 왼쪽 패널, 끌개, 띠, 둘째 줄, 서식 칸, 기타 칩 CSS 가 남았다');
  const one = (n) => (src.match(new RegExp('function ' + n + '\\(', 'g')) || []).length;
  for (const n of ['collectReportData', 'rptMSave', 'asWeekHeadSet']) assert.strictEqual(one(n), 1, n + ' 이 한 벌이 아니다');
  //  v6 결정 22: 기간 취합 글 함수(미리 보기, 복사 글, 복사, 탭 전환, 글꼴)는 없다
  for (const n of ['buildReport', 'buildReportText', 'buildReportHtml', 'copyReport', 'atSumOutSet', 'renderNetcusWeeklyPreview', 'syncReportFontUI', 'reportFontSet']) assert.strictEqual(one(n), 0, n + ' 이 되살아났다');
  assert.ok(/awfMatch[\s\S]{0,400}periodEnd[\s\S]{0,200}R\.from/.test(src) && src.includes('pe < R.from') && src.includes('ps > R.to'), '목록 기간 겹침 판정이 없다');
  assert.ok(/t\.push\(r\.subject, r\.endwork, r\.plan, r\.meeting\)/.test(src), '찾기 범위가 제목, 진행사항, 차주계획, 회의내용이 아니다');
  //  2026-11-03 사용자: 캘린더 기록 = 이 앱 주간보고 DB. 포함 항목 칸은 없고, 일정과 할 일을 하루 단위로 모으지 않는다.
  assert.ok(!/id="(asInc|rptSrcEvent|rptSrcTodo|rptWithDesc|rptSkipEmpty)"/.test(src), '포함 항목 칸이 되살아났다');
  for (const n of ['rptMReadApp', 'rptMFill', 'atSumLoad']) assert.ok(!fnText(src, n).includes('collectReportData'), n + ' 이 달력의 일정과 할 일을 모은다');
  const readApp = fnText(src, 'rptMReadApp');
  assert.ok(readApp.includes('awRowsFetch(') && !readApp.includes("'reportWeeklyList'") && !/netcus/.test(readApp), '캘린더 기록 읽기가 근태 주간 목록과 같은 함수(awRowsFetch)가 아니다(두 벌)');
  assert.ok(fnText(src, 'awListLoad').includes('awRowsFetch(') && !fnText(src, 'awListLoad').includes("'reportWeeklyList'"), '주간 목록이 awRowsFetch 를 쓰지 않는다(두 벌)');
  assert.strictEqual((src.match(/hostRequest\('reportWeeklyList'/g) || []).filter(Boolean).length >= 1, true);
  assert.ok(fnText(src, 'awRowsFetch').includes("hostRequest('reportWeeklyList'"), 'awRowsFetch 가 reportWeeklyList 를 읽지 않는다');
}
test('(S) 취합 화면 정적 계약', () => checkStatic(app));
test('(S) 취합 화면 문구에 금지 기호가 없다', () => {
  const a = app.indexOf('id="atSum"'), b = app.indexOf('id="atEd"', a);
  //  (숨긴 머리기호 고르기 #rptMarker 는 v6 결정 22 로 [서식] 칸과 함께 없앴다. 예전에는 그 선택지를 빼고 보았다)
  const part = app.slice(a, b);
  assert.ok(!/[—「」]/.test(part) && !/(^|\s)·|·(\s|$)/m.test(part));
});
test('(M) 변이: 지운 것을 되살리면 정적 계약이 잡는다', () => {
  const cases = [
    ['보고서 버튼', (s) => s.replace('<section class="at-view" id="atView"', '<button id="btnReportTop"></button><section class="at-view" id="atView"')],
    ['netcus 일간 출처', (s) => mutate(s, 'data-rsrc="week" aria-pressed="false"', 'data-rsrc="net" aria-pressed="false" title="netcus 일간">netcus 일간</button><button type="button" class="seg-b" data-rsrc="week" aria-pressed="false"')],
    ['결과 형태를 윗줄로', (s) => mutate(s, '<button type="button" class="btn primary" id="asLoad">', '<div class="seg seg-auto" id="asOut"></div><button type="button" class="btn primary" id="asLoad">')],
    ['결과 형태 탭 되살림', (s) => mutate(s, '          <div class="as-head" id="asHead">', '          <div class="as-tabs" id="asOut" role="group"><button type="button" class="as-tab" data-aso="text">과제별 글</button></div>\n          <div class="as-head" id="asHead">')],
    ['복사 단추 되살림', (s) => mutate(s, '            </span>\n          </div>\n          <div class="as-pane" id="asDoc">', '            </span>\n            <button type="button" class="btn" id="btnRptCopy" disabled>복사</button>\n          </div>\n          <div class="as-pane" id="asDoc">')],
    ['서식 칸 되살림', (s) => mutate(s, '<span class="as-pk hidden" data-pk="plan">', '<div class="as-pk hidden" data-pk="fmt" id="asFmt"></div><span class="as-pk hidden" data-pk="plan">')],
    ['글 미리 보기 되살림', (s) => mutate(s, '<div class="as-pane" id="asDoc">', '<div class="as-pane" id="asText"><div id="rptOut"></div></div><div class="as-pane" id="asDoc">')],
    ['주간보고 제목 넣기 빠짐', (s) => mutate(s, '<label class="check as-wk"><input type="checkbox" id="rptmWeekHead" checked>주간보고 제목 넣기</label>', '')],
    ['주간보고 제목 넣기를 작성 뒤로', (s) => mutate(mutate(s, '<label class="check as-wk"><input type="checkbox" id="rptmWeekHead" checked>주간보고 제목 넣기</label>', ''), '<span class="as-sp"></span>\n            <span class="as-docact"', '<label class="check as-wk"><input type="checkbox" id="rptmWeekHead" checked>주간보고 제목 넣기</label><span class="as-sp"></span>\n            <span class="as-docact"')],
    ['상자 처음 숨김', (s) => mutate(s, '<div class="as-boxes" id="asBoxes">', '<div class="as-boxes hidden" id="asBoxes">')],
    ['문서 머리 줄 처음 숨김', (s) => mutate(s, '<div class="as-hd" id="asDocHead">', '<div class="as-hd hidden" id="asDocHead">')],
    ['날짜 상자를 윗줄로', (s) => mutate(s, '<button type="button" class="btn primary" id="asLoad">', '<input type="date" id="rptFromX"><button type="button" class="btn primary" id="asLoad">')],
    ['읽기 전 저장을 강조', (s) => mutate(s, '<button type="button" class="btn" id="rptmSave" disabled>', '<button type="button" class="btn primary" id="rptmSave" disabled>')],
    ['계획 기본값 단추 되살림', (s) => mutate(s, '<input type="date" id="rptmPTo" aria-label="계획 기간 종료일">', '<input type="date" id="rptmPTo" aria-label="계획 기간 종료일"><button type="button" class="btn" id="rptmPlanDef">↺</button>')],
    ['보고서 양식 이름 빠짐', (s) => mutate(s, '<span class="rptm-lb">보고서 양식</span>\n', '')],
    ['띄움 칸을 dialog 로', (s) => mutate(s, '<div class="as-pop hidden" id="asPop">', '<div class="as-pop hidden" id="asPop" role="dialog">')],
    ['끌개 되살림', (s) => mutate(s, '<div class="as-main" id="asRight">', '<div class="at-split as-split" data-atsplit="s"></div><div class="as-main" id="asRight">')],
    ['왼쪽 패널 되살림', (s) => mutate(s, '<div class="as-main" id="asRight">', '<div class="as-left" id="asLeft"></div><div class="as-main" id="asRight">')],
    ['계획을 작성 앞으로', (s) => mutate(s, '              <button type="button" class="as-dt" id="asDateBtn"', '              <span id="asPlanBtn"></span><button type="button" class="as-dt" id="asDateBtn"')],
    ['기간 취합 글 함수 되살림', (s) => s + '\nfunction buildReport(){}\n'],
    ['복사 함수 되살림', (s) => s + '\nasync function copyReport(){}\n'],
    ['겹침 판정 빼기', (s) => mutate(s, 'if(R.from !== \'\' && pe < R.from) return false;', '')],
    ['찾기 범위 줄이기', (s) => mutate(s, 't.push(r.subject, r.endwork, r.plan, r.meeting)', 't.push(r.subject)')],
    ['포함 항목 칸', (s) => mutate(s, '<span class="as-pk hidden" data-pk="plan">', '<div class="as-sec" id="asInc"><input type="checkbox" id="rptSrcEvent"></div><span class="as-pk hidden" data-pk="plan">')],
    ['읽어 오기가 일정을 모음', (s) => mutate(s, "  await rptMLoadClick();", "  collectReportData('2026-01-01', '2026-01-02', {});\n  await rptMLoadClick();")],
    ['읽기 함수 두 벌', (s) => mutate(s, "  const f = await awRowsFetch({ from, to }, null);", "  const f = { rows: [] }; await hostRequest('reportWeeklyList', { from, to });")],
    ['문서 설정 띠 되살림', (s) => mutate(s, '<div class="as-main" id="asRight">', '<div class="as-band hidden" id="asBand"></div><div class="as-main" id="asRight">')],
    ['두 칸을 늘 위아래로', (s) => mutate(s, 'padding-top:10px;display:grid;grid-template-columns:minmax(300px,400px) minmax(0,1fr)', 'padding-top:10px;display:block')],
    ['옛 왼쪽 CSS 되살림', (s) => s.replace('.as-sep{', '.as-left{overflow:auto} .as-sep{')],
    //  v7 결정 26, 28
    ['과제 머리 모두 선택 체크 빠짐', (s) => mutate(s, '<label class="check as-all"><input type="checkbox" id="rptmPickAll" aria-label="과제 모두 선택">과제</label>', '과제')],
    ['읽기 전 빈 아이콘 자리 되살림', (s) => mutate(s, '<div class="as-boxes" id="asBoxes">', '<div class="as-boxes" id="asBoxes"><div class="as-box as-blank" id="asBoxBlank"></div>')],
    ['종이 칸 처음 숨김', (s) => mutate(s, '<div class="rptm-pvwrap" id="rptmPvWrap">', '<div class="rptm-pvwrap hidden" id="rptmPvWrap">')],
  ];
  for (const [name, f] of cases) {
    let caught = false;
    try { checkStatic(f(app)); } catch (_) { caught = true; }
    assert.ok(caught, '변이가 잡히지 않았다: ' + name);
  }
});

const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
if (!JSDOM) {
  skip('attend-summary: jsdom 미설치, 취합 화면 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  function boot(src, host) {
    const posted = [];
    const vc = new jsdomMod.VirtualConsole();
    const dom = new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: vc,
      beforeParse(win) {
        win.scrollTo = () => {}; win.HTMLElement.prototype.scrollIntoView = function () {}; win.open = () => null;
        if (host) win.chrome = { webview: { postMessage(m) { try { posted.push(JSON.parse(m)); } catch (_) {} }, addEventListener() {}, removeEventListener() {} } };
      } });
    const w = dom.window, d = w.document;
    return { w, d, posted, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')), $: (s) => d.querySelector(s), shown: (s) => { const e = d.querySelector(s); return !!e && !e.classList.contains('hidden'); } };
  }
  const openSum = async (X) => { X.ev("pcSetTab('attend'); atKindSet('sum');"); await tick(); };
  const stub = (X, rep) => X.ev(`window.__calls = []; window.__rep = ${rep}; hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
    var r = __rep[cmd]; if(typeof r === 'function') r = r(p); return Promise.resolve(r === undefined ? { ok:false, error:'시험: 회신 없음' } : JSON.parse(JSON.stringify(r))); };`);

  //  v6 결정 22: 결과 형태는 월간 보고 문서 하나라 진입하면 문서 머리 줄, 왼쪽 상자, 문서 미리 보기가 보인다(예전 기대: 과제별 글 탭과 복사 단추).
  test('(B) [취합] 진입: 화면 전환, 머리 단추 셋, 처음 기간은 지난달, 출처 캘린더 기록, 문서 머리 줄과 왼쪽 상자', async () => {
    const X = boot(app, false);
    await tick(200);
    X.ev("pcSetTab('attend')"); await tick();
    assert.deepStrictEqual([...X.d.querySelectorAll('#atMonth [data-atkind]')].map((b) => b.textContent), ['일간', '주간', '월간']);   // v7 결정 27(예전 기대: 취합)
    X.ev("atKindSet('sum')"); await tick();
    assert.ok(X.shown('#atSum') && !X.shown('#atMonth') && !X.shown('#awList'));
    assert.deepStrictEqual([...X.d.querySelectorAll('#asBar [data-atkind]')].map((b) => b.textContent), ['일간', '주간', '월간']);   // v7 결정 27(예전 기대: 취합)
    const r = X.ev('monthRange(new Date(), -1)');
    assert.strictEqual(X.$('#rptFrom').value, r[0]); assert.strictEqual(X.$('#rptTo').value, r[1]);
    assert.strictEqual(X.$('#rptSrcSeg .active').dataset.rsrc, 'cal');
    assert.ok(X.shown('#asDoc') && X.shown('#asDocHead') && X.shown('#asBoxes') && X.shown('#asDocAct') && !X.$('#asText') && !X.$('#btnRptCopy') && !X.$('#asOut'));
    assert.strictEqual(X.$('#rptmWeekHead').checked, !X.ev('weeklyFlat'), '주간보고 제목 넣기 체크가 기억한 형식과 다르다');
    assert.strictEqual(X.d.querySelectorAll('[id="atSum"]').length, 1, 'id atSum 이 둘이다');
    assert.ok(!X.$('#reportModal') && !X.$('#btnReportTop'));
    X.w.close();
  });
  test('(B) 포함 항목 칸이 없고(출처를 바꿔도 칸이 생기거나 사라지지 않는다), 출처나 기간을 바꾸는 것만으로는 호스트 요청이 없다', async () => {
    const X = boot(app, true);
    await tick(200);
    await openSum(X);
    stub(X, '{}');
    assert.strictEqual(X.d.querySelectorAll('#asInc, #rptSrcEvent, #rptSrcTodo, #rptWithDesc, #rptSkipEmpty, #atSum .rpt-chips').length, 0, '포함 항목 칸이 남았다');
    const shape = () => X.d.querySelector('#asTop').innerHTML.replace(/ (class|aria-pressed)="[^"]*"/g, '');
    const before = shape();
    X.$('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
    assert.strictEqual(shape(), before, '출처를 바꾸니 왼쪽 칸 구조가 바뀌었다(칸이 생기거나 사라졌다)');
    assert.strictEqual(X.$('#rptSrcSeg [data-rsrc="cal"]').title, '이 앱 근태 탭에서 쓴 주간보고를 읽습니다');
    assert.strictEqual(X.$('#rptSrcSeg [data-rsrc="week"]').title, '회사 인트라넷의 주간보고를 읽습니다');
    X.$('#rptFrom').value = '2026-01-01'; X.$('#rptFrom').dispatchEvent(new X.w.Event('change', { bubbles: true })); await tick();
    assert.strictEqual(X.ev('__calls.length'), 0, '출처와 날짜를 바꾸는 것만으로 호스트 요청이 나갔다');
    assert.ok(!X.posted.some((p) => /netcus/i.test(JSON.stringify(p))), '회사 요청이 나갔다');
    X.$('#rptSrcSeg [data-rsrc="cal"]').click(); await tick();
    assert.strictEqual(X.ev('__calls.length'), 0);
    X.w.close();
  });

  //  캘린더 기록 = 이 앱 주간보고 DB(2026-11-03). 시험 DB 는 아래 주들이다(기간 2026-10-01 ~ 10-31, 호스트는 period_start 가 [from-7, to] 안인 주를 준다).
  //   E 09-28~09-29 겹치지 않는다(시작 쪽 한 주 더 읽기로 오지만 걸러진다), A 10-05 hours 있음(content 는 무시), B 10-12 hours 없음(content 에서 되살림),
  //   F 10-26~10-31 끝에서 겹친다, G 11-02 기간 뒤(오지 않는다).
  const WROW = (ps, pe, endwork, extra) => Object.assign({ periodStart: ps, periodEnd: pe, subject: ps + ' 주간보고', content: '', endwork, plan: '', meeting: '', composedAt: ps + 'T09:00:00.000Z', hours: null }, extra || {});
  const DB_ROWS = [
    WROW('2026-09-28', '2026-09-29', '[과제가]\n  - 겹치지 않는 주'),
    WROW('2026-10-05', '2026-10-10', '[과제가]\n  - A-진행\n    A-세부', { content: '이 글은 무시', hours: [{ name: '과제가', projectUid: '', hours: 8 }] }),
    WROW('2026-10-12', '2026-10-17', '[과제가]\n  - B-진행\n[과제나]\n  - 나-진행', { content: '[과제나] : 4\n합계 : 4' }),
    WROW('2026-10-26', '2026-10-31', '[과제나]\n  - F-진행'),
    WROW('2026-11-02', '2026-11-07', '[과제가]\n  - 기간 뒤 주'),
  ];
  const stubDb = (X, rows) => stub(X, '{ reportWeeklyList: function(p){ return { ok:true, rows: ' + JSON.stringify(rows) + '.filter(function(r){ return r.periodStart >= p.from && r.periodStart <= p.to; }) }; } }');
  const asCat = (id, name) => ({ id, name, color: '#3e5be0', desc: '', createdAt: '2026-01-01T00:00:00.000Z' });
  const loadCal = async (X, from, to) => {
    X.$('#rptFrom').value = from; X.$('#rptTo').value = to;
    X.$('#asLoad').click(); await tick(120);
  };
  //  실행 계약(변이도 같은 검사기를 부른다)
  async function checkCalRead(src) {
    const X = boot(src, true);
    try {
      await tick(200);
      await openSum(X);
      X.ev("state.categories = " + JSON.stringify([asCat('c-ga', '과제가'), asCat('c-na', '과제나')]) + ";");
      stubDb(X, DB_ROWS);
      X.ev("window.__crd = 0; (function(){ var o = collectReportData; collectReportData = function(){ __crd++; return o.apply(this, arguments); }; })();");
      assert.strictEqual(X.$('#rptSrcSeg .active').dataset.rsrc, 'cal');
      await loadCal(X, '2026-10-01', '2026-10-31');
      const calls = X.ev("__calls.map(function(c){ return c[0]; })");
      const dbCalls = X.evJSON("__calls.filter(function(c){ return c[0] === 'reportWeeklyList'; }).map(function(c){ return c[1]; })");
      assert.strictEqual(dbCalls.length, 1, '캘린더 기록 읽기가 reportWeeklyList 를 한 번 부르지 않았다');
      assert.deepStrictEqual(dbCalls[0], { from: '2026-09-24', to: '2026-10-31' }, '시작 쪽 한 주 더 읽기가 아니다');
      assert.ok(!calls.includes('netcusWeeklyRangeRead') && !X.posted.some((p) => /netcus/i.test(JSON.stringify(p))), '캘린더 기록이 회사 사이트 명령을 보냈다');
      assert.strictEqual(X.ev('__crd'), 0, '캘린더 기록이 collectReportData(일정과 할 일 모으기)를 불렀다');
      //  겹치는 주만: E(겹치지 않음)와 G(기간 뒤)는 없고 A, B, F 만 읽는다
      const m = X.evJSON('({ weeksRead: netcusWeeklyMerge.weeksRead, src: netcusWeeklyMerge.src, key: netcusWeeklyMerge.key, tasks: netcusWeeklyMerge.parsed.tasks.map(function(t){ return { name: t.name, hours: t.hours, blocks: t.blocks.map(function(b){ return b.title + \'|\' + b.period + \'|\' + b.lines.join(\'/\'); }) }; }) })');
      assert.strictEqual(m.weeksRead, 3, '겹치는 주(A, B, F)만 읽어야 한다: ' + m.weeksRead);
      assert.deepStrictEqual([m.src, m.key], ['cal', 'cal|2026-10-01|2026-10-31'], '출처별 키가 아니다');
      const all = JSON.stringify(m.tasks);
      assert.ok(!all.includes('겹치지 않는 주') && !all.includes('기간 뒤 주'), '겹치지 않는 주가 들어갔다');
      //  hours 줄: A 는 hours 표(8), B 는 hours 가 없어 content 줄([과제나] : 4), A 의 content 는 무시
      const byName = Object.fromEntries(m.tasks.map((t) => [t.name, t]));
      assert.strictEqual(byName['과제가'].hours, 8, 'hours 표가 [이름] : 시간 줄로 바뀌지 않았다(또는 content 를 읽었다)');
      assert.strictEqual(byName['과제나'].hours, 4, 'hours 가 없는 주가 content 줄을 쓰지 않았다');
      assert.deepStrictEqual(byName['과제가'].blocks, ['2026-10-05 주간보고|2026-10-05 ~ 2026-10-10|  - A-진행/    A-세부', '2026-10-12 주간보고|2026-10-12 ~ 2026-10-17|  - B-진행'], '제목과 기간(시작 ~ 끝) 모양이 다르다');
      //  월간 문서가 읽기 한 번의 결과를 쓴다(글 미리 보기와 복사는 v6 결정 22 로 없앴다)
      const doc = X.evJSON('rptMPayload(__rptM)');
      const etc = doc.etc.lines.map((l) => l.text).join('\n');
      assert.ok(etc.includes('A-진행') && etc.includes('나-진행') && etc.includes('F-진행') && !etc.includes('겹치지 않는 주'), '월간 문서가 같은 결과를 쓰지 않는다: ' + etc);
      //  시안 v2 결정 6: 읽은 결과는 윗줄 '✓ n주' 하나, 원래 문장은 풍선(title)
      assert.ok(X.ev("$('#rptmSrcMsg').textContent") === '3주' && X.ev("$('#rptmSrcMsg').title").startsWith('주간보고 기록 3주를 읽어 과제별로 모았습니다.') && X.ev("!!$('#rptmSrcMsg svg')"), '읽은 뒤 결과가 ✓ 3주(풍선에 원래 문장)가 아니다: ' + X.ev("$('#rptmSrcMsg').textContent"));
      assert.strictEqual(X.ev('__rptM.fillSrc'), 'cal');
      //  인트라넷 주간으로 바꾸면 읽은 글은 그 출처의 것이 아니라서 읽어 오기를 기다린다(섞이지 않는다). 출처 열쇠는 ncMergeKey 가 정한다
      X.$('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
      assert.ok(X.ev("netcusWeeklyMerge.key") !== X.ev("ncMergeKey('2026-10-01', '2026-10-31', 'week')"), '다른 출처의 읽은 글이 섞였다');
    } finally { X.w.close(); }
  }
  test('(B) 캘린더 기록은 이 앱 주간보고 DB 를 읽는다: reportWeeklyList 한 번, 겹치는 주만, hours 줄, 월간 문서가 그 결과, collectReportData 와 회사 사이트 명령 0', async () => { await checkCalRead(app); });
  test('(B) 캘린더 기록 읽기: 호스트 상한을 넘는 기간은 나눠 읽고(시작 쪽 한 주 더), 기록이 없으면 한 줄 안내', async () => {
    const X = boot(app, true);
    await tick(200);
    await openSum(X);
    stubDb(X, []);
    const today = X.ev('todayYmd()');
    const from = X.ev(`addDays('${today}', -900)`);
    await loadCal(X, from, today);
    const calls = X.evJSON("__calls.filter(function(c){ return c[0] === 'reportWeeklyList'; }).map(function(c){ return c[1]; })");
    assert.strictEqual(calls.length, 3, '900일을 380일씩 세 번에 나눠 읽지 않았다: ' + JSON.stringify(calls));
    assert.ok(calls.every((c) => (new Date(c.to) - new Date(c.from)) / 86400000 <= 400), '400일 안으로 나눠 읽지 않았다');
    assert.strictEqual(calls[calls.length - 1].from, X.ev(`addDays('${from}', -7)`), '시작 쪽 한 주 더 읽지 않았다');
    assert.strictEqual(calls[0].to, today);
    assert.deepStrictEqual([X.ev("$('#rptmSrcMsg').textContent"), X.ev("$('#rptmSrcMsg').title")], ['0주', '이 기간에 이 앱으로 쓴 주간보고가 없습니다.'], '빈 결과가 0주(풍선에 원래 문장)가 아니다');
    assert.ok(!/netcus/i.test(X.ev("$('#rptmSrcMsg').textContent + $('#rptmSrcMsg').title")), '빈 결과 화면이 인트라넷 문구를 쓴다');
    X.w.close();
  });
  test('(B) 캘린더 기록 읽기 실패는 이유를 보이고, 브라우저(위젯 아님)에서는 위젯 안내만 나오며 호스트 요청이 없다', async () => {
    const X = boot(app, true);
    await tick(200);
    await openSum(X);
    stub(X, "{ reportWeeklyList: { ok:false, error:'서버에 연결할 수 없습니다.' } }");
    await loadCal(X, '2026-10-01', '2026-10-31');
    const msg = X.ev("$('#rptmSrcMsg').textContent");
    assert.ok(msg.includes('주간보고 기록을 읽지 못했습니다.') && msg.includes('서버에 연결할 수 없습니다.'), '실패 이유가 없다: ' + msg);
    X.w.close();
    const Bw = boot(app, false);
    await tick(200);
    await openSum(Bw);
    await loadCal(Bw, '2026-10-01', '2026-10-31');
    assert.ok(Bw.ev("$('#rptmSrcMsg').textContent").includes('데스크톱 위젯에서만'), '브라우저 안내가 없다');
    assert.strictEqual(Bw.posted.length, 0, '브라우저에서 호스트 요청이 나갔다');
    Bw.w.close();
  });
  test('(M) 변이: 일정 모으기, 회사 사이트 명령, 겹침 판정 빼기, 나눠 읽기 빼기, hours 무시를 되살리면 캘린더 기록 시험이 잡는다', async () => {
    const cases = [
      ['일정 모으기', (t) => mutate(t, "  const f = await awRowsFetch({ from, to }, null);", "  collectReportData(from, to, { event: true, todo: true });\n  const f = await awRowsFetch({ from, to }, null);")],
      ['회사 사이트 명령', (t) => mutate(t, "  const f = await awRowsFetch({ from, to }, null);", "  hostRequest('netcusWeeklyRangeRead', { from, to }, 1000);\n  const f = await awRowsFetch({ from, to }, null);")],
      ['겹침 판정 빼기', (t) => mutate(t, 'r.periodEnd >= from && r.periodStart <= to', 'true')],
      ['한 주 더 읽기 빼기', (t) => mutate(t, "const floor = R.from ? addDays(R.from, -7) : '2020-01-01';", "const floor = R.from ? R.from : '2020-01-01';")],
      ['hours 무시', (t) => mutate(t, "content: hrs.length ? hrs.map(h => '[' + h.name + '] : ' + h.hours).join('\\n') : r.content,", 'content: r.content,')],
      ['출처 열쇠 섞기', (t) => mutate(t, "function ncMergeKey(from, to, src){ return (src === 'cal' ? 'cal' : 'week') + '|' + from + '|' + to; }", "function ncMergeKey(from, to, src){ return from + '|' + to; }")],
    ];
    for (const [name, f] of cases) {
      let caught = false;
      try { await checkCalRead(f(app)); } catch (_) { caught = true; }
      assert.ok(caught, '변이가 잡히지 않았다: ' + name);
    }
    //  나눠 읽기 빼기: 한 번에 다 읽으면 호스트 상한을 넘는다(세 번이어야 한다)
    const X = boot(mutate(app, "    if(from <= floor) break;\n    empty = got.length", "    break;\n    empty = got.length"), true);
    await tick(200); await openSum(X); stubDb(X, []);
    const today = X.ev('todayYmd()');
    await loadCal(X, X.ev(`addDays('${today}', -900)`), today);
    assert.notStrictEqual(X.evJSON("__calls.filter(function(c){ return c[0] === 'reportWeeklyList'; }).length"), 3, '나눠 읽기를 빼도 시험이 통과한다');
    X.w.close();
  });

  test('(B) 인트라넷 주간은 [읽어 오기]를 눌러야 읽고, 결과를 미리 보기와 월간 보고가 한 번만 읽어 같이 쓴다', async () => {
    const X = boot(app, true);
    await tick(200);
    await openSum(X);
    stub(X, `{ netcusWeeklyRangeRead: { ok:true, weeks:[] } }`);
    X.$('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
    assert.strictEqual(X.ev('__calls.length'), 0);
    X.$('#asLoad').click(); await tick(100);
    assert.strictEqual(X.ev("__calls.filter(c => c[0] === 'netcusWeeklyRangeRead').length"), 1, '읽기는 한 번이어야 한다');
    X.w.close();
  });
  //  2026-11-10 시안 v4(결정 15, 21)의 결과 형태 탭 시험(문서와 과제별 글을 오가며 단추와 상자가 바뀐다)은 v6 결정 22 로 탭이 없어져 아래로 바꿨다.
  //  탭, 머리 줄, 띄움 칸 자세한 시험은 tests/monthly-ux-v2.test.mjs 에 있다.
  test('(B) 결과 칸: 탭 없이 문서 머리 줄, 왼쪽 상자, 문서 미리 보기가 늘 보이고 복사와 [서식]은 없다(v6 결정 22)', async () => {
    const X = boot(app, false);
    await tick(200);
    await openSum(X);
    assert.ok(X.shown('#asDocHead') && X.shown('#asBoxes') && X.shown('#asDoc') && X.shown('#asDocAct'));
    assert.ok(!X.$('#asOut') && !X.$('#btnRptCopy') && !X.$('#asFmtBtn') && !X.$('#asText') && !X.$('#rptOut') && !X.$('#rptFontFamily'));
    assert.ok(X.$('#rptmPick').children.length >= 1);
    X.ev("atKindSet('day')"); await tick(); X.ev("atKindSet('sum')"); await tick();
    assert.ok(X.shown('#asDocHead') && X.shown('#asBoxes') && X.shown('#asDoc'), '다시 들어오니 문서나 상자가 숨었다');
    X.w.close();
  });
  test('(B) 주간보고 목록: 기간은 보고 대상 기간 겹침, 찾기(진행사항, 과제명), 쪽 20건, 호스트 상한을 나눠 읽는다', async () => {
    const X = boot(app, true);
    await tick(200);
    const today = X.ev('todayYmd()');
    const mon = X.ev('calReportPeriod(todayYmd()).mon');
    const row = (m, extra) => Object.assign({ periodStart: m, periodEnd: X.ev(`calReportPeriod('${m}').sat`), subject: '주간 ' + m, content: '', endwork: '', plan: '', meeting: '', composedAt: m + 'T01:00:00.000Z', hours: [] }, extra || {});
    const rows = [];
    for (let i = 0; i < 25; i++) rows.push(row(X.ev(`addDays('${mon}', ${-7 * i})`), i === 3 ? { endwork: '유일한 진행사항낱말' } : i === 4 ? { hours: [{ name: '특수과제명', projectUid: '', hours: 4 }] } : {}));
    X.ev("pcSetTab('attend'); atKindSet('week');"); await tick();
    stub(X, '{ reportWeeklyList: function(p){ return { ok:true, rows: ' + JSON.stringify(rows) + '.filter(function(r){ return r.periodStart >= p.from && r.periodStart <= p.to; }) }; } }');
    X.ev('awListLoad()'); await tick(80);
    //  최근 3개월: 약 13주
    const n3 = X.d.querySelectorAll('#awRows tr.aw-row').length;
    assert.ok(n3 >= 12 && n3 <= 15, '최근 3개월 줄 수: ' + n3);
    const sel = X.$('#awfKind'); sel.value = 'all'; sel.dispatchEvent(new X.w.Event('change', { bubbles: true })); await tick(100);
    assert.strictEqual(X.d.querySelectorAll('#awRows tr.aw-row').length, 20, '한 쪽 20건');
    assert.ok(X.$('#awPager'), '쪽 이동이 없다');
    assert.strictEqual(X.$('#awCnt').textContent, '25건');
    X.$('#awPager [data-awpage="1"]').click();
    assert.strictEqual(X.d.querySelectorAll('#awRows tr.aw-row').length, 5);
    const q = X.$('#awfQ'); q.value = '유일한 진행사항낱말'; q.dispatchEvent(new X.w.Event('input', { bubbles: true })); await tick(250);
    assert.strictEqual(X.d.querySelectorAll('#awRows tr.aw-row').length, 1);
    q.value = '특수과제명'; q.dispatchEvent(new X.w.Event('input', { bubbles: true })); await tick(250);
    assert.strictEqual(X.d.querySelectorAll('#awRows tr.aw-row').length, 1);
    q.value = '없는낱말'; q.dispatchEvent(new X.w.Event('input', { bubbles: true })); await tick(250);
    assert.strictEqual(X.$('#awCnt').textContent, '0건');
    //  직접 지정: 호스트 상한(400일)을 넘는 범위는 나눠 읽는다
    q.value = ''; q.dispatchEvent(new X.w.Event('input', { bubbles: true })); await tick(250);
    sel.value = 'custom'; sel.dispatchEvent(new X.w.Event('change', { bubbles: true })); await tick(50);
    X.$('#awfFrom').value = X.ev(`addDays('${today}', -900)`); X.$('#awfFrom').dispatchEvent(new X.w.Event('change', { bubbles: true })); await tick(100);
    const calls = X.ev("__calls.filter(c => c[0] === 'reportWeeklyList').slice(-3).map(c => c[1])");
    assert.ok(calls.length >= 3 && calls.every((c) => (new Date(c.to) - new Date(c.from)) / 86400000 <= 400), '400일 안으로 나눠 읽지 않았다');
    X.w.close();
  });
}
