// 월간 보고 문서(docs/MONTHLY-REPORT-PLAN.md §5, docs/ATTEND-SUMMARY.md): §10.1 의 monthly-report 시험.
//
// 2026-11-03 구조 변경: 보고서 창(#reportModal)과 그 안의 [월간 보고] 탭(#rptMonthlyPane)은 없다. 월간 보고는 근태 탭 [취합] 화면(#atSum)의
// 결과 형태 [월간 보고 문서] 로 합쳤다. 진입은 `pcSetTab('attend'); atKindSet('sum'); atSumOutSet('doc');`, 새로 열기는 atSumInit().
//   기간은 #rptFrom, #rptTo 하나, 내용 출처는 #rptSrcSeg(cal | week 둘), 읽어 오기는 #asLoad, 월간 문서 설정은 오른쪽 탭 줄 아래 띠 #asBand(문서일 때만 보임).
//   옛 보고 유형 탭, setReportMode 분기, 월간 탭 전용 #reportModal CSS, 두 칸 격자와 좁은 폭 세그(.rptm-grid, #rptmSub), 모달 라벨 되돌림은 없앴다.
// 2026-10-23 사용자 결정(그대로): 이 문서는 **모으기와 읽기 전용 미리 보기**만 한다. 고치는 칸(과제명, 수행 계획 두 칸, 일정 변경이력,
// 실적 글 칸)과 초안 저장, 미식별 이관과 기억한 이관은 없다. 문서에는 수행 실적과 개발 일정 그림만 채우고 계획과 변경이력은 빈칸이다.
//   과제 순서는 내 과제 순서 그대로(▲▼ 없음), 기억하는 값이 없다(localStorage 를 쓰지 않는다, 열 때마다 처음 값).
//
// 이 파일이 지키는 것:
//   (S) 정적: 월간 함수(rptM*)는 회사로 보내는 길을 부르지 않고 호스트 명령은 RPTM_HOST_CMDS 뿐, 그림 함수는 scheduleImage* 만,
//       월간 함수에 저장소(localStorage 등)가 없다, 없앤 기능(초안, 이관 기억, 고른 것 기억, 순서 단추)이 없다,
//       월간 문서 설정과 미리 보기 영역에 고치는 칸(textarea, 글 입력, contenteditable)이 없고 입력은 날짜 셋과 체크뿐,
//       취합 화면의 새 구조(보고서 창 없음, 출처 둘, 결과 형태 둘, atSumInit 이 월간 처음 값으로 연다).
//   (W) jsdom 위젯 모드(지어낸 상태): 열 때마다 처음 값(두 번 열어도), 저장소 쓰기 0, 기간이 payload 로 그대로,
//       과제명은 공식 이름, 과제 수행 기간 = 개발 시작일 ~ 개발종료일, 실적 글 = 과제별 글(기간 취합 복사 글)의 과제별 블록(글자 그대로, 서식 여러 벌),
//       공용 일정 제외, payload 의 계획 두 칸과 변경이력은 빈 배열, 순서 = 내 과제 순서, 체크와 기타 칩과 읽어 오기가 미리 보기를 바로 바꾼다,
//       그림 서랍(그림 n, + 그림, 열기, 파일, 붙여넣기, 줄과 서랍의 포커스와 마우스 Ctrl+V, 순서, 삭제 확인, 끊김 사본 목록, 다시 열어도 그림 n),
//       저장(회신 경로, 폴더 열기, notice, 오류 그대로), 인트라넷 주간 출처(읽어 오기를 눌러야 읽는다, 가짜 회신, 미식별은 왼쪽 칸에만, 로그인 없음, 400일),
//       보내는 명령 0(가로채기), 미리 보기 = payload, 과제별 글 쪽은 월간 문서를 다녀와도 그대로.
//   (B) jsdom 브라우저 모드: 안내 문구, 저장과 주간과 그림 막힘, 미리 보기는 동작.
//   (M) 변이: 위 정적 계약을 되돌리면 같은 검사기가 잡는다.
// ★ 실제 netcus 읽기, 그림 올리기, 파일 저장은 없다. 호스트 회신은 __hostReply 로 흉내 낸다. 회사로 보내는 함수는 가로채 0 회를 본다.
// 생략 규약: jsdom 이 없으면 (W)(B)는 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 120));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 120));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
//  월간 함수 이름 전부(선언 순서). 하나도 없으면 검사기가 눈을 감은 것이다.
const rptMNames = (src) => [...new Set([...src.matchAll(/\bfunction\s+(rptM\w+)\s*\(/g)].map((m) => m[1]))];
const rptMCode = (src) => rptMNames(src).map((n) => extractFunction(src, n)).join('\n');
const DATE_IDS = ['rptmPFrom', 'rptmPTo', 'rptmDate'];
//  월간 문서 설정 띠(#asBand)와 문서 미리 보기(#asDoc) 마크업. 취합 화면의 공용 설정(기간, 출처, 포함 항목, 서식)은 월간 전용이 아니라서 뺀다.
const paneHtml = (src) => {
  const a = src.indexOf('<div class="as-band hidden" id="asBand">'), b = src.indexOf('<div class="as-pane" id="asText">', a);
  const c = src.indexOf('<div class="as-pane hidden" id="asDoc">'), d = src.indexOf('id="rptmSheet"></div>', c);
  assert.ok(a > 0 && b > a && c > b && d > c, '월간 문서 영역(#asBand, #asDoc) 마크업을 찾지 못했다');
  return src.slice(a, b) + src.slice(c, d);
};

// ══════════════════════════════════════════════════════════════════════
// (S) 정적 검사기
// ══════════════════════════════════════════════════════════════════════
const S = {
  noSend(src) {
    const names = rptMNames(src);
    assert.ok(names.length >= 30, '월간 함수(rptM*)를 거의 찾지 못했다: ' + names.length);
    const code = rptMCode(src);
    for (const bad of ['Platform.report', 'netcusSubmit', 'netcusWeekSubmit', 'NetcusWeekFill', 'submitDaily', 'submitWeekly', 'btnRptSend', 'copyReport(']) {
      assert.ok(!code.includes(bad), '월간 함수가 회사로 보내는 길을 부른다: ' + bad);
    }
    const allowed = new Set(JSON.parse(/const RPTM_HOST_CMDS = (\[[^\]]*\]);/.exec(src)[1].replace(/'/g, '"')));
    assert.deepStrictEqual([...allowed].sort(), ['exportMonthlyDocx', 'netcusWeeklyRangeRead', 'openFolder', 'reportWeeklyList', 'scheduleImageAdd', 'scheduleImageDelete', 'scheduleImageList', 'scheduleImageMove', 'scheduleImageThumb'], '호스트 명령 목록이 바뀌었다');
    const used = [...code.matchAll(/hostRequest\('(\w+)'/g)].map((m) => m[1]).concat([...code.matchAll(/hpost\(\{\s*cmd:\s*'(\w+)'/g)].map((m) => m[1]));
    assert.ok(used.length >= 7, '호스트 호출을 거의 찾지 못했다');
    for (const u of used) assert.ok(allowed.has(u), '목록 밖 호스트 명령: ' + u);
    assert.ok(!/hostRequest\((?!')/.test(code) && !/hpost\((?!\{ cmd: ')/.test(code), '명령 이름을 글자로 쓰지 않는 호스트 호출이 있다(검사를 피한다)');
    assert.ok(!/PCAL/.test(code), '월간 함수가 과제 캘린더 공용 일정(PCAL)을 읽는다(§4 끝: 개인 기록만)');
    //  2026-11-03: 캘린더 기록 = 이 앱 주간보고 DB. 월간 함수는 일정과 할 일을 하루 단위로 모으지 않는다
    assert.ok(!/collectReportData|reportRowBodyText|state\.entries|state\.todos/.test(code), '월간 함수가 달력의 일정과 할 일을 모은다(캘린더 기록은 주간보고 DB 에서 읽는다)');
  },
  imageCmds(src) {
    const code = rptMNames(src).filter((n) => /^rptMImg|^rptMThumbs/.test(n)).map((n) => extractFunction(src, n)).join('\n');
    const used = [...code.matchAll(/hostRequest\('(\w+)'/g)].map((m) => m[1]);
    assert.deepStrictEqual([...new Set(used)].sort(), ['scheduleImageAdd', 'scheduleImageDelete', 'scheduleImageList', 'scheduleImageMove', 'scheduleImageThumb'], '그림 함수가 단계 A 명령 다섯만 쓰지 않는다');
    assert.ok(/mode: mode === 'clipboard' \? 'clipboard' : 'file'/.test(code), '그림 넣기가 {mode:file|clipboard} 로 가지 않는다');
    //  그림 서랍은 과제 줄에 그린다: 줄(rptMRowEl) 안의 [data-imgtog] 와 [data-strip]
    const r = extractFunction(src, 'rptMImgRender');
    assert.ok(r.includes('rptMRowEl(id)') && r.includes("'[data-imgtog]'") && r.includes("'[data-strip]'"), '그림 서랍이 과제 줄에 그려지지 않는다');
  },
  //  기억하는 값이 없다(2026-10-23): 월간 함수와 상수에 브라우저 저장소가 없다
  noMemory(src) {
    const code = rptMCode(src);
    assert.ok(!/localStorage|sessionStorage|indexedDB/.test(code), '월간 함수가 브라우저 저장소를 쓴다(기억하는 값이 없어야 한다)');
    assert.ok(!/tc_rptM|tc_rptDraftM/.test(code), '월간 함수가 월간 저장 키를 다룬다');
    assert.ok(!/const RPTM_(SEL|ETC|DRAFT|NCMAP)_/.test(src), '월간 저장 키 상수(고른 것, 기타 제외, 초안, 이관)가 남아 있다');
    //  열 때마다 처음 값: rptMOpen 은 지난달로 새 상태를 만든다(기억에서 읽지 않는다)
    const open = extractFunction(src, 'rptMOpen');
    assert.ok(open.includes('monthRange(new Date(), -1)') && open.includes("__rptM = rptMFresh(r[0], r[1], 'cal');"), 'rptMOpen 이 열 때마다 지난달, 캘린더 기록으로 새로 열지 않는다');
  },
  removed(src) {
    const names = new Set(rptMNames(src));
    for (const gone of ['rptMDraftSave', 'rptMDraftLoad', 'rptMDraftPrune', 'rptMNcMapGet', 'rptMNcMapSet', 'rptMUnidMove', 'rptMUnidForget', 'rptMChgRender', 'rptMReloadCard', 'rptMCardHtml', 'rptMApply',
      'rptMSelKey', 'rptMSelNorm', 'rptMSelLoad', 'rptMSelSave', 'rptMEtcOffGet', 'rptMEtcOffSet', 'rptMReopen']) {
      assert.ok(!names.has(gone), '없앤 기능의 함수가 남아 있다: ' + gone);
    }
    //  순서 바꾸기 없음(2026-10-23): ▲▼ 단추도, up/down 동작도, 순서를 손대는 splice 도 없다. 목록 = 내 과제 순서
    const code = rptMCode(src);
    assert.ok(!/[▲▼]/.test(code + paneHtml(src)), '월간 탭에 ▲▼ 순서 단추가 남아 있다');
    assert.ok(!/data-act="(up|down)"|act === 'up'|act === 'down'|\.order\.splice/.test(code), '월간 함수에 과제 순서 바꾸기가 남아 있다');
    assert.ok(/S\.order = rptMOfficial\(\)\.map\(c => c\.id\);/.test(extractFunction(src, 'rptMSync')), '과제 목록이 내 과제(카테고리) 순서 그대로가 아니다');
  },
  noEditors(src) {
    const pane = paneHtml(src);
    assert.ok(!/<textarea|contenteditable|<select/i.test(pane), '월간 문서 영역 마크업에 고치는 칸(textarea, select, contenteditable)이 있다');
    const inputs = [...pane.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
    assert.deepStrictEqual(inputs.map((x) => (/type="(\w+)"/.exec(x) || [])[1] + ':' + (/id="(\w+)"/.exec(x) || [])[1]), DATE_IDS.map((id) => 'date:' + id), '월간 문서 영역의 입력이 날짜 셋(계획 시작, 계획 끝, 작성일)이 아니다');
    const code = rptMCode(src);
    assert.ok(!/<textarea|contenteditable=|type="text"/i.test(code), '월간 함수가 고치는 칸을 그린다');
    //  2026-11-10(MONTHLY-HEAD-MAPPING 결정 4): 고르는 칸은 미식별 줄의 넣을 곳 콤보(rptMRenderUnid) 하나뿐이고 글을 고치지 않는다.
    //  예전에는 <select> 도 금지였다(미식별은 읽기만). 결정이 바뀌어 그 하나만 허용한다
    const sels = [...code.matchAll(/<select\b[^>`]*/g)].map((m) => m[0]);
    assert.ok(sels.length === 1 && sels[0].startsWith('<select data-unid-to') && extractFunction(src, 'rptMRenderUnid').includes(sels[0]), '월간 함수가 미식별 넣을 곳 콤보 말고 다른 고르는 칸을 그린다: ' + sels.join(' | '));
    const gen = [...code.matchAll(/<input\b[^>`]*/g)].map((m) => m[0]);
    assert.ok(gen.length >= 2 && gen.every((x) => /^<input type="checkbox" data-(act="pick"|etc=)/.test(x)), '월간 함수가 그리는 입력이 과제 체크와 기타 체크가 아니다: ' + gen.join(' | '));
  },
};
test('MS3 (§10.1): 월간 함수는 회사로 보내는 길을 부르지 않고, 호스트 명령은 RPTM_HOST_CMDS 뿐, 공용 일정을 읽지 않는다', () => S.noSend(app));
test('MS4 (§6.3, §5.3): 그림 함수는 단계 A 명령(scheduleImage*)만, 넣기는 file 또는 clipboard, 그림 서랍은 과제 줄', () => S.imageCmds(app));
test('MS5 (§5.4, 2026-10-23): 기억하는 값이 없다(월간 함수에 저장소와 저장 키가 없고, 열 때마다 지난달로 새로 연다)', () => S.noMemory(app));
test('MS7 (§5, 2026-10-23, 2026-11-10): 월간 문서 영역에 고치는 칸이 없다. 입력은 날짜 셋(#asBand 마크업)과 과제 체크, 기타 체크, 미식별 넣을 곳 콤보(그리는 것)뿐', () => S.noEditors(app));
test('MS8 (§14, 2026-10-23): 없앤 기능(초안, 변경이력 행, 실적 다시 붙이기, 미식별 이관과 기억, 고른 것 기억, ▲▼ 순서)의 함수와 단추가 없다', () => S.removed(app));
//  취합 화면의 새 구조(docs/ATTEND-SUMMARY.md): 보고서 창과 보고 유형 탭이 없고, 월간 보고는 [취합] 의 결과 형태 하나다.
S.sumStructure = function (src) {
  assert.ok(!/id="reportModal"|id="rptMonthlyPane"|data-rmode=|id="btnRptSend"|id="rptmSub"|class="rptm-grid"/.test(src), '없앤 보고서 창, 월간 탭, 보내기 단추, 두 칸 격자 마크업이 남아 있다');
  assert.ok(!/function setReportMode|function openReport/.test(src), '없앤 보고서 창 함수(setReportMode, openReport)가 남아 있다');
  const seg = (id) => { const a = src.indexOf('id="' + id + '"'); const b = src.indexOf('</div>', a); return [...src.slice(a, b).matchAll(/data-(?:rsrc|aso)="(\w+)"/g)].map((m) => m[1]); };
  assert.deepStrictEqual(seg('rptSrcSeg'), ['cal', 'week'], '내용 출처가 캘린더 기록, 인트라넷 주간 둘이 아니다');
  assert.deepStrictEqual(seg('asOut'), ['text', 'doc'], '결과 형태가 과제별 글, 월간 보고 문서 둘이 아니다');
  //  월간 문서 설정은 문서일 때만 보이고(처음 hidden), 오른쪽 위 단추는 형태에 따라 바뀐다
  const out = extractFunction(src, 'atSumOutSet');
  assert.ok(out.includes("$('#asBand').classList.toggle('hidden', !doc)") && out.includes("$('#btnRptCopy').classList.toggle('hidden', doc)") && out.includes("$('#asDocAct').classList.toggle('hidden', !doc)"), 'atSumOutSet 이 문서 설정 띠와 단추를 형태에 맞춰 바꾸지 않는다');
  //  처음 열기: 지난달, 캘린더, 과제별 글, 그리고 월간 처음 값(rptMOpen)
  const init = extractFunction(src, 'atSumInit');
  assert.ok(init.includes('monthRange(new Date(), -1)') && init.includes("state.reportSource = 'cal'") && init.includes('rptMOpen();') && init.includes("atSumOutSet('text')"), 'atSumInit 이 지난달, 캘린더, 과제별 글, rptMOpen 으로 열지 않는다');
  //  인트라넷 주간은 [읽어 오기] 를 눌러야 읽는다: 출처 고르기와 기간 바꾸기는 호스트 요청을 부르지 않는다
  for (const n of ['atSumSource', 'atSumPeriod']) assert.ok(!/hostRequest|netcusWeeklyRangeRead|rptMLoadClick|rptMFill|rptMReadNetcus/.test(extractFunction(src, n)), n + ' 이 회사 사이트 읽기를 부른다(읽어 오기를 눌러야 읽는다)');
  assert.ok(extractFunction(src, 'atSumLoad').includes('await rptMLoadClick()'), '읽어 오기(atSumLoad)가 rptMLoadClick 으로 읽지 않는다');
  //  캘린더 기록은 이 앱 주간보고 DB(rptMReadApp), 인트라넷 주간은 회사 사이트(rptMReadNetcus). 어느 쪽도 일정 모으기(collectReportData)를 부르지 않는다
  const fill = extractFunction(src, 'rptMFill');
  assert.ok(fill.includes('rptMReadNetcus(') && fill.includes('rptMReadApp('), 'rptMFill 이 두 출처(주간보고 DB, 인트라넷)를 읽지 않는다');
  for (const n of ['buildReport', 'buildReportText', 'rptMReadApp', 'rptMFill', 'rptMAuto', 'rptMHasSet']) assert.ok(!extractFunction(src, n).includes('collectReportData'), n + ' 이 달력의 일정과 할 일을 모은다');
  const app2 = extractFunction(src, 'rptMReadApp');
  assert.ok(app2.includes('awRowsFetch(') && !app2.includes("'reportWeeklyList'") && !app2.includes('netcus'), 'rptMReadApp 이 근태 주간 목록과 같은 읽기 함수(awRowsFetch)를 쓰지 않는다(두 벌)');
  assert.ok(extractFunction(src, 'awListLoad').includes('awRowsFetch(') && !extractFunction(src, 'awListLoad').includes("'reportWeeklyList'"), '근태 주간 목록이 awRowsFetch 를 쓰지 않는다(두 벌)');
  assert.ok(/r\.periodEnd >= from && r\.periodStart <= to/.test(app2), '주 고르기가 기간 겹침이 아니다(인트라넷 주간과 같은 규칙)');
  assert.ok(app2.includes('parseNetcusWeekly(') && app2.includes("rptMStoreRead('cal'"), '캘린더 기록이 parseNetcusWeekly 와 같은 그릇(rptMStoreRead)을 쓰지 않는다');
};
test('MS11 (ATTEND-SUMMARY §2, §4): 보고서 창과 월간 탭이 없고, 출처 둘, 결과 형태 둘, atSumInit 이 월간 처음 값으로 열며, 출처와 기간 바꾸기는 회사 읽기를 부르지 않는다', () => S.sumStructure(app));
test('변이 MSM1: 월간 저장에 Platform.report 를 넣거나 목록 밖 명령을 쓰면 MS3 이 잡는다', () => {
  assert.throws(() => S.noSend(mutate(app, "  try{ res = await hostRequest('exportMonthlyDocx', rptMPayload(S), 300000); }", "  try{ Platform.report.submitWeekly({ fields: {} }); res = await hostRequest('exportMonthlyDocx', rptMPayload(S), 300000); }")), /Platform\.report|submitWeekly/);
  assert.throws(() => S.noSend(mutate(app, "  const res = await hostRequest('netcusWeeklyRangeRead', { from, to }, 180000);", "  const res = await hostRequest('netcusWeekSubmit', { from, to }, 180000);")), /netcusWeekSubmit/);
  assert.throws(() => S.noSend(mutate(app, "function rptMOpenDir(){ if(HOST && __rptMDir) hpost({ cmd: 'openFolder', path: __rptMDir }); }", "function rptMOpenDir(){ if(HOST && __rptMDir) hpost({ cmd: 'netcusSubmit', path: __rptMDir }); }")), /netcusSubmit|목록 밖/);
});
test('변이 MSM2: 그림 명령을 바꾸거나 저장소에 기억을 되살리거나 열 때마다 새로 열기를 바꾸면 MS3, MS4, MS5 가 잡는다', () => {
  assert.throws(() => S.imageCmds(mutate(app, ": await hostRequest('scheduleImageMove', params, 30000); }", ": await hostRequest('scheduleImageReorder', params, 30000); }")), /다섯/);
  assert.throws(() => S.noSend(mutate(app, ": await hostRequest('scheduleImageMove', params, 30000); }", ": await hostRequest(cmd, params, 30000); }")), /글자로 쓰지 않는|거의/);
  assert.throws(() => S.noMemory(mutate(app, "  if(on) S.etcOff.delete(key); else S.etcOff.add(key);\n", "  if(on) S.etcOff.delete(key); else S.etcOff.add(key);\n  try{ localStorage.setItem('tc_rptMEtcOff:' + key, '1'); }catch(_){}\n")), /저장소/);
  assert.throws(() => S.noMemory(mutate(app, "  __rptM = rptMFresh(r[0], r[1], 'cal');\n", "  __rptM = __rptM || rptMFresh(r[0], r[1], 'cal');\n")), /새로 열지 않는다/);
});
test('변이 MSM3: 과제 줄에 글 칸이나 ▲ 를 넣거나 마크업에 textarea 를 넣거나 없앤 함수를 되살리면 MS7, MS8 이 잡는다', () => {
  assert.throws(() => S.noEditors(mutate(app, "    + ((has || !rptMAuto(S)) ? '' : '<span class=\"rptm-none' + (rptMUnidHas(S, id) ? ' hidden' : '') + '\">기록 없음</span>')", "    + '<textarea data-f=\"memo\"></textarea>' + ((has || !rptMAuto(S)) ? '' : '<span class=\"rptm-none' + (rptMUnidHas(S, id) ? ' hidden' : '') + '\">기록 없음</span>')")), /고치는 칸/);
  assert.throws(() => S.noEditors(mutate(app, '<div class="rptm-list" id="rptmPick"></div>', '<div class="rptm-list" id="rptmPick"></div><input type="text" id="rptmTitle">')), /날짜 셋/);
  assert.throws(() => S.removed(mutate(app, 'function rptMEtcToggle(key, on){', 'function rptMSelSave(){}\nfunction rptMEtcToggle(key, on){')), /rptMSelSave/);
  assert.throws(() => S.removed(mutate(app, "    + ((has || !rptMAuto(S)) ? '' : '<span class=\"rptm-none' + (rptMUnidHas(S, id) ? ' hidden' : '') + '\">기록 없음</span>')", "    + '<button type=\"button\" class=\"btn\" data-act=\"up\">▲</button>' + ((has || !rptMAuto(S)) ? '' : '<span class=\"rptm-none' + (rptMUnidHas(S, id) ? ' hidden' : '') + '\">기록 없음</span>')")), /▲▼|순서/);
});

test('변이 MSM6 (2026-11-10): 미식별 고른 것(unidTo)을 저장소에 기억하거나 콤보를 하나 더 그리면 MS5, MS7 이 잡는다', () => {
  assert.throws(() => S.noMemory(mutate(app, '  if(ok) S.unidTo.set(key, to); else S.unidTo.delete(key);\n', "  if(ok) S.unidTo.set(key, to); else S.unidTo.delete(key);\n  try{ localStorage.setItem('tc_rptMUnid:' + key, to); }catch(_){}\n")), /저장소/);
  assert.throws(() => S.noEditors(mutate(app, "    + ((has || !rptMAuto(S)) ? '' : '<span class=\"rptm-none' + (rptMUnidHas(S, id) ? ' hidden' : '') + '\">기록 없음</span>')", "    + '<select data-act=\"plan\"></select>' + ((has || !rptMAuto(S)) ? '' : '<span class=\"rptm-none' + (rptMUnidHas(S, id) ? ' hidden' : '') + '\">기록 없음</span>')")), /다른 고르는 칸/);
});
test('변이 MSM5:읽어 오기 없이 읽거나 처음 열기에서 월간을 빼거나 보고서 창을 되살리면 MS11 이 잡는다', () => {
  assert.throws(() => S.sumStructure(mutate(app, "  state.reportSource = src;\n  syncReportSourceSeg();", "  state.reportSource = src;\n  if(src === 'week') rptMReadNetcus($('#rptFrom').value, $('#rptTo').value);\n  syncReportSourceSeg();")), /읽어 오기를 눌러야/);
  assert.throws(() => S.sumStructure(mutate(app, "  clearNetcusWeeklyMerge();\n  const r = monthRange(new Date(), -1);\n  $('#rptFrom').value = r[0]; $('#rptTo').value = r[1];\n  rptMOpen();", "  clearNetcusWeeklyMerge();\n  const r = monthRange(new Date(), -1);\n  $('#rptFrom').value = r[0]; $('#rptTo').value = r[1];")), /rptMOpen/);
  assert.throws(() => S.sumStructure(app.replace('<div class="as-view hidden" id="atSum"', '<div id="reportModal"></div><div class="as-view hidden" id="atSum"')), /보고서 창/);
  assert.throws(() => S.sumStructure(mutate(app, '<button type="button" class="seg-b" data-rsrc="week" aria-pressed="false"', '<button type="button" class="seg-b" data-rsrc="day" aria-pressed="false"></button><button type="button" class="seg-b" data-rsrc="week" aria-pressed="false"')), /출처가/);
});

// ══════════════════════════════════════════════════════════════════════
// jsdom 실행
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('monthly-report: jsdom 미설치: 월간 보고 탭 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
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
    w.eval('window.__toasts = []; (function(){ var t = toast; toast = function(m, k, a, ms){ __toasts.push(String(m)); return t(m, k, a, ms); }; })();');
    return { w, posted, doc: w.document, answered: new Set(), ev: (code) => w.eval(code), evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      close: async () => { await tick(); try { w.close(); } catch (_) {} } };
  }
  const bootBrowser = (src) => wrap(new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quiet(), beforeParse: shims }), []);
  function bootWidget(src) {
    const posted = [];
    const dom = new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quiet(),
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); }, addEventListener() {}, removeEventListener() {} } };
        shims(win);
      } });
    const M = wrap(dom, posted);
    const sess = posted.find((x) => x && x.cmd === 'userSessionGet');
    if (sess) M.ev('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'tester', name: '시험자' } }) + ')');
    return M;
  }
  //  아직 회신하지 않은 그 명령의 요청들(오래된 것부터)
  const pending = (m, cmd) => m.posted.filter((x) => x && x.cmd === cmd && x.reqId && !m.answered.has(x.reqId));
  function reply(m, cmd, res, pick) {
    const list = pending(m, cmd).filter(pick || (() => true));
    assert.ok(list.length, cmd + ' 요청이 없다');
    m.answered.add(list[0].reqId);
    m.ev('__hostReply(' + JSON.stringify(list[0].reqId) + ', ' + JSON.stringify(res) + ')');
    return list[0];
  }
  //  화면이 보낸 그림 목록, 미리 보기 요청을 모두 빈 회신으로 닫는다(다른 시험을 보는 동안)
  function drainImages(m) {
    for (const x of pending(m, 'scheduleImageList')) reply(m, 'scheduleImageList', { ok: true, data: { projectUid: x.projectUid, images: [], stale: false, notice: '' } }, (y) => y.reqId === x.reqId);
    for (const x of pending(m, 'scheduleImageThumb')) reply(m, 'scheduleImageThumb', { ok: false, error: { kind: 'notFound', message: '없음' } }, (y) => y.reqId === x.reqId);
  }
  const overlayOpen = (m, id) => { const o = m.doc.getElementById(id); return !!o && !o.classList.contains('hidden') && !o.classList.contains('closing'); };
  const overlayClosed = (m, id) => { const o = m.doc.getElementById(id); return !o || o.classList.contains('hidden'); };
  async function confirmAnswer(m, ok) {
    await waitFor(() => overlayOpen(m, 'confirmModal'), '확인창이 뜬다');
    const msg = m.doc.getElementById('cfMsg').textContent;
    if (ok) m.doc.getElementById('cfOk').click(); else m.ev("closeOverlay($('#confirmModal'))");
    await waitFor(() => overlayClosed(m, 'confirmModal'), '확인창이 닫힌다');
    await tick(); await tick();
    return msg;
  }
  //  예전 월간 키(이제는 읽지도 쓰지도 않는다)를 지운다
  const clearStore = (m) => m.ev("(function(){ var a=[]; for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && (k.indexOf('tc_rptMSel:')===0 || k.indexOf('tc_rptDraftM:')===0 || k.indexOf('tc_rptMEtcOff:')===0 || k.indexOf('tc_rptMNcMap:')===0)) a.push(k); } a.forEach(function(k){ localStorage.removeItem(k); }); })()");
  //  저장소 쓰기 감시: setItem, removeItem, clear 의 키를 모두 적는다(월간 흐름은 하나도 쓰지 않아야 한다)
  const spyStore = (m) => m.ev("(function(){ if (window.__lsw) return; window.__lsw = []; var P = Storage.prototype, s = P.setItem, r = P.removeItem, c = P.clear; P.setItem = function(k, v){ __lsw.push('set:' + k); return s.call(this, k, v); }; P.removeItem = function(k){ __lsw.push('remove:' + k); return r.call(this, k); }; P.clear = function(){ __lsw.push('clear'); return c.call(this); }; })()");
  const lsMark = (m) => m.ev('__lsw.length');
  const lsSince = (m, n) => m.evJSON('__lsw.slice(' + n + ')');
  const $id = (m, id) => m.doc.getElementById(id);
  const row = (m, uid) => [...m.doc.querySelectorAll('#rptmPick .rptm-it[data-uid]')].find((c) => c.dataset.uid === uid) || null;
  const pvTable = (m, uid) => [...m.doc.querySelectorAll('#rptmSheet table[data-pv-uid]')].find((t) => t.dataset.pvUid === uid) || null;
  const setVal = (m, el, v, type = 'input') => { el.value = v; el.dispatchEvent(new m.w.Event(type, { bubbles: true })); };
  const check = (m, el, on) => { el.checked = on; el.dispatchEvent(new m.w.Event('change', { bubbles: true })); };
  const ctrlV = (m, el) => el.dispatchEvent(new m.w.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  //  근태 탭 [취합] 을 열고 결과 형태를 월간 보고 문서로 한다. atSumInit 은 처음 값(지난달, 캘린더, 과제별 글, 월간 처음 값)으로 새로 연다.
  const openSum = (m) => m.ev("pcSetTab('attend'); atKindSet('sum'); atSumInit(); atSumOutSet('doc');");
  const reopen = (m) => m.ev("atSumInit(); atSumOutSet('doc');");
  //  이 앱 주간보고 읽기(reportWeeklyList)에 회신한다. 호스트는 period_start 가 from 이상 to 이하인 주를 준다. WEEK_FAIL 이면 실패 회신.
  const weekly = { fail: null, calls: [] };
  async function answerWeekly(m) {
    for (let n = 0; n < 40; n++) {
      await tick(5);
      const list = pending(m, 'reportWeeklyList');
      if (!list.length) { if (n > 1) break; continue; }
      for (const x of list) {
        m.answered.add(x.reqId); weekly.calls.push({ from: x.from, to: x.to });
        const res = weekly.fail ? weekly.fail : { ok: true, rows: WEEK_ROWS.filter((r) => r.periodStart >= x.from && r.periodStart <= x.to) };
        m.ev('__hostReply(' + JSON.stringify(x.reqId) + ', ' + JSON.stringify(res) + ')');
      }
    }
    await tick();
  }
  async function loadPeriod(m, from, to) {
    $id(m, 'rptFrom').value = from; $id(m, 'rptTo').value = to;
    $id(m, 'asLoad').click();
    await tick(); await tick();
    await answerWeekly(m);
  }
  //  같은 기간을 지금 출처로 다시 읽는다(읽어 오기)
  async function readAgain(m) { $id(m, 'asLoad').click(); await tick(); await answerWeekly(m); drainImages(m); }

  // ── 지어낸 상태 ─────────────────────────────────────────────────────
  const U1 = 'aaaaaaaa-0000-4000-8000-000000000001', U2 = 'aaaaaaaa-0000-4000-8000-000000000002',
        U3 = 'aaaaaaaa-0000-4000-8000-000000000003', U4 = 'aaaaaaaa-0000-4000-8000-000000000004';
  const P1 = 'db-' + U1, P2 = 'db-' + U2, P3 = 'db-' + U3, P4 = 'db-' + U4;
  const ROWS = [
    { uid: U1, project_name: '(예시) 관제 고도화 사업', common_name: '(예시) 관제 고도화', sectionId: 1, start_date: '2025-07-01', end_date: '2027-01-29', dev_start_date: '2025-08-01', dev_end_date: '2026-12-31' },
    { uid: U2, project_name: '(예시) 해양 관측 체계', common_name: '', sectionId: 1, start_date: '2026-02-01', end_date: '2027-03-31', dev_start_date: '2026-03-02', dev_end_date: '' },
    { uid: U3, project_name: '(예시) 보안 점검 도구', common_name: '', sectionId: 2, start_date: '2026-01-01', end_date: '2026-12-31', dev_start_date: '', dev_end_date: '' },
    { uid: U4, project_name: '(예시) 기록 없는 과제', common_name: '', sectionId: 2, start_date: '', end_date: '', dev_start_date: '', dev_end_date: '' },
  ];
  const CA = '2026-07-01T00:00:00.000Z';
  const E = (o) => Object.assign({ allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: null,
    endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }, o);
  const FROM = '2026-09-01', TO = '2026-09-30';
  const cat = (id, name, source) => Object.assign({ id, name, color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }, source ? { source } : {});
  const stateFor = () => ({
    gitAuthor: '', svnAuthor: '',
    categories: [cat(P1, '(예시) 관제 고도화', 'db'), cat('c-in', '(예시) 사내 업무'), cat(P2, '(예시) 해양 관측 체계', 'db'), cat(P3, '(예시) 보안 점검 도구', 'db'),
      cat(P4, '(예시) 기록 없는 과제', 'db'), cat('c-ed', '(예시) 교육')],
    entries: [
      E({ id: 'e1', date: '2026-09-03', title: '화면 응답 속도 개선', categoryId: P1, memo: '목록 갱신 횟수 줄임\n• 첫 화면 읽기 순서 정리' }),
      E({ id: 'g1', date: '2026-09-08', title: '알람 기준값 화면 추가', categoryId: P1, memo: '본문 첫 줄\n  - 들여쓴 본문' }),
      E({ id: 'e2', date: '2026-09-15', title: '중간 점검 회의 (09.15, 고객사)', categoryId: P1 }),
      E({ id: 'e3', date: '2026-09-10', title: '관측 자료 수신 모듈 정리', categoryId: P2 }),
      E({ id: 'e4', date: '2026-10-14', title: '점검 항목 화면 착수', categoryId: P3 }),   // 계획 기간에만 기록
      E({ id: 'e5', date: '2026-09-04', title: '주간 회의 자료 정리', categoryId: 'c-in', memo: '팀 공용 폴더 정리' }),
      E({ id: 'e6', date: '2026-09-11', title: '보안 교육 이수', categoryId: 'c-ed' }),
      E({ id: 'e7', date: '2026-08-20', title: '기간 밖 일', categoryId: P1 }),
    ],
    todos: [{ id: 't1', text: '자료 보관 주기 설정', done: false, categoryId: P2, due: '2026-09-14', endDate: '2026-09-18', prio: 'normal', completedAt: '', note: '',
              dayNotes: { '2026-09-14': '월 메모', '2026-09-16': '수 메모' }, createdAt: CA, updatedAt: CA }],
    rooms: [], attendance: {},   //  (작성 중 시간 taskHours 와 보고서 서식 report* 는 구조 22 에서 state 에서 빠졌다)
  });
  //  이 앱 주간보고 DB(cal_report_weekly)를 흉내 낸다. 캘린더 기록 출처는 이 행들을 reportWeeklyList 로 읽는다(2026-11-03).
  //  읽는 기간은 시작 쪽을 한 주 더 읽으므로(9월이면 8월 25일부터) 8월 17일 주는 9월 읽기에 오지 않고, 8월 31일 주는 겹쳐서 온다.
  const WK = (ps, pe, endwork, extra) => Object.assign({ periodStart: ps, periodEnd: pe, subject: ps + ' 주간보고', content: '', endwork, plan: '', meeting: '', composedAt: ps + 'T09:00:00.000Z', hours: null }, extra || {});
  const WEEK_ROWS = [
    WK('2026-08-17', '2026-08-22', '[(예시) 관제 고도화]\n  - 기간 밖 일'),
    WK('2026-08-31', '2026-09-05', '[(예시) 관제 고도화]\n  - 화면 응답 속도 개선\n    목록 갱신 횟수 줄임\n    첫 화면 읽기 순서 정리\n[(예시) 사내 업무]\n  - 주간 회의 자료 정리\n    팀 공용 폴더 정리',
       { hours: [{ name: '(예시) 관제 고도화', projectUid: U1, hours: 2 }] }),
    WK('2026-09-07', '2026-09-12', '[(예시) 관제 고도화]\n  - 알람 기준값 화면 추가\n[(예시) 해양 관측 체계]\n  - 관측 자료 수신 모듈 정리\n  - 자료 보관 주기 설정\n[(예시) 교육]\n  - 보안 교육 이수\n[(예시) 보안 점검 도구]\n  - 점검 항목 도구 준비',
       { content: '[(예시) 해양 관측 체계] : 1.5\n합계 : 1.5' }),
    WK('2026-09-14', '2026-09-19', '[(예시) 관제 고도화]\n  - 중간 점검 회의 (09.15, 고객사)'),
    WK('2026-10-12', '2026-10-17', '[(예시) 관제 고도화]\n  - 기간 뒤 일'),
  ];
  const META = { schemaVersion: '17', expectedSchema: '17', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  //  읽어 둔 주간보고(그릇 netcusWeeklyMerge)의 과제별 글. 이름 -> 머리 줄을 뺀 글. 월간 실적 글의 기준이다.
  const blocksOf = (m) => m.evJSON(`(function(){ var c = netcusWeeklyMerge, o = {}; (c.parsed ? c.parsed.tasks : []).forEach(function(t){ var b = buildNetcusWeeklyText({ tasks: [t] }, weeklyFlat); o[t.name] = b.slice(b.indexOf('\\n') + 1); }); return o; })()`);
  const actualOf = (m, id) => m.ev(`((rptMAuto(__rptM) || { proj: new Map() }).proj.get(${JSON.stringify(id)})) || ''`);
  const payloadOf = (m) => m.evJSON('rptMPayload(__rptM)');

  async function widget() {
    const M = bootWidget(app);
    clearStore(M);
    spyStore(M);
    M.ev('__applyState(' + JSON.stringify(JSON.stringify(stateFor())) + ',' + JSON.stringify(META) + ')');
    M.ev('__applyProjects(' + JSON.stringify(JSON.stringify(ROWS)) + ')');
    await tick();
    M.ev('state.categories = ' + JSON.stringify(stateFor().categories) + ';');   // 기본 과제 자동 보충 등과 무관하게 이 순서로 시험한다
    openSum(M);
    await tick();
    drainImages(M);
    await loadPeriod(M, FROM, TO);
    drainImages(M);
    await tick();
    return M;
  }

  let W = null, bootErr = null;
  try { W = await widget(); } catch (e) { bootErr = e; }
  if (bootErr) {
    test('MW0: 위젯 모드 부팅', () => { throw bootErr; });
  } else {
    const fresh = async () => {
      reopen(W);
      await tick(); drainImages(W);
      await loadPeriod(W, FROM, TO); drainImages(W); await tick();
    };
    //  지금 화면의 처음 값 모양(열 때마다 같아야 한다)
    const defaultsNow = () => ({
      from: $id(W, 'rptFrom').value, to: $id(W, 'rptTo').value, pFrom: $id(W, 'rptmPFrom').value, pTo: $id(W, 'rptmPTo').value, date: $id(W, 'rptmDate').value,
      src: W.ev('__rptM.src'), srcBtn: W.doc.querySelector('#rptSrcSeg .seg-b.active').dataset.rsrc,
      checked: W.evJSON('__rptM.order.filter(function(id){ return __rptM.checked[id]; })'), has: W.evJSON('__rptM.order.filter(function(id){ return __rptMHas.has(id); })'),
      etcOn: [...W.doc.querySelectorAll('#rptmEtc input[data-etc]')].filter((x) => x.checked).map((x) => x.dataset.etc), etcAll: W.evJSON('rptMEtcCats().map(function(c){ return c.key; })'),
      etcOpen: !$id(W, 'rptmEtc').classList.contains('hidden'), out: W.ev('AS.out'),
    });

    test('MW1 (§5.2, 2026-10-23): 열 때마다 처음 값: 실적 기간 지난달, 출처 캘린더, 기록 있는 과제만 체크, 기타 모두 넣음(접힘), 계획 기본값, 작성일 오늘, 이름은 로그인 이름(읽기만)', async () => {
      //  예전에 기억해 둔 키가 남아 있어도 읽지 않는다
      W.ev(`localStorage.setItem('tc_rptMSel:7', JSON.stringify({ v: 1, from: '2026-05-01', to: '2026-05-31', src: 'week', pFrom: '2026-06-01', pTo: '2026-06-30', planEdited: true, order: [${JSON.stringify(P4)}], checked: {} })); localStorage.setItem('tc_rptMEtcOff:7', JSON.stringify(['c-ed']));`);
      W.ev('atSumInit()'); await tick(); drainImages(W);
      assert.strictEqual(W.ev('AS.out'), 'text', '처음 열 때 결과 형태가 과제별 글이 아니다');
      assert.ok($id(W, 'asBand').classList.contains('hidden') && $id(W, 'asDoc').classList.contains('hidden') && !$id(W, 'asText').classList.contains('hidden'), '과제별 글일 때 월간 문서 설정과 문서 미리 보기가 숨지 않았다');
      W.ev("atSumOutSet('doc')"); drainImages(W);
      assert.ok(!$id(W, 'asBand').classList.contains('hidden') && !$id(W, 'asDoc').classList.contains('hidden') && $id(W, 'asText').classList.contains('hidden'), '월간 보고 문서일 때 설정과 문서 미리 보기가 보이지 않는다');
      const lm = W.evJSON('monthRange(new Date(), -1)');
      const d0 = defaultsNow();
      assert.deepStrictEqual([d0.from, d0.to], lm, '기본 실적 기간이 지난달이 아니다(예전 기억을 읽었나)');
      assert.strictEqual(d0.date, W.ev('todayYmd()'), '작성일 기본이 오늘이 아니다');
      assert.deepStrictEqual(W.evJSON("rptMPlanDefault('2026-08-03', '2026-09-18')"), { from: '2026-09-21', to: '2026-11-06' }, '계획 기본값 예시(§5.2)가 다르다');
      assert.deepStrictEqual(W.evJSON('rptMPlanDefault(' + JSON.stringify(lm[0]) + ',' + JSON.stringify(lm[1]) + ')'), { from: d0.pFrom, to: d0.pTo }, '화면 계획 기간이 기본값이 아니다');
      assert.deepStrictEqual([d0.src, d0.srcBtn], ['cal', 'cal'], '출처 기본이 캘린더가 아니다');
      assert.deepStrictEqual(d0.checked, d0.has, '처음 체크가 기록 있는 과제가 아니다');
      assert.deepStrictEqual([d0.etcOn, d0.etcOpen], [d0.etcAll, false], '기타가 모두 넣음(접힘)으로 열리지 않았다');
      assert.strictEqual($id(W, 'rptmEtcSum').textContent, d0.etcAll.length + '개 모두 넣음', '기타 한 줄 요약이 아니다');
      assert.strictEqual($id(W, 'rptmName').textContent, '시험자', '이름이 로그인 계정 표시 이름이 아니다');
      assert.strictEqual($id(W, 'rptmName').tagName, 'SPAN', '이름이 고치는 칸이다(읽기만이어야 한다)');
      assert.ok(!W.doc.getElementById('reportModal') && !W.doc.getElementById('rptMonthlyPane'), '없앤 보고서 창이 되살아났다');
      clearStore(W);
      await fresh();
    });

    //  [취합] 을 열면 취합 화면(div.as-view#atSum)이 보이고 달력과 주간 목록은 숨는다. 근태 달력 요약 span 도 id 가 atSum 이라(공유 id) 달력이 먼저 그려진
    //  상태에서는 atSyncScreen 의 $('#atSum') 이 그 span 을 집는다(앱 쪽 결함 후보: 이 시험이 실패하면 앱의 id 겹침을 고친다).
    test('MW22 (docs/ATTEND-SUMMARY.md §2): 근태 탭 [취합] 을 열면 취합 화면이 보이고 달력과 주간 목록은 숨는다(달력을 먼저 그린 뒤에도)', async () => {
      await fresh();
      assert.ok(W.doc.querySelector('#atMonth .at-bar'), '전제: 달력이 먼저 그려져 있다(근태 달력 요약 span 이 있다)');
      const sumView = W.doc.querySelector('#atView .as-view');
      assert.ok(sumView, '전제: 취합 화면 요소가 있다');
      assert.strictEqual(W.doc.querySelectorAll('#atSum').length, 1, '#atSum id 가 둘 이상이다(근태 달력 요약 span 과 취합 화면이 같은 id 를 쓴다)');
      assert.ok(!sumView.classList.contains('hidden'), '[취합] 을 열었는데 취합 화면이 숨어 있다');
      assert.ok(W.doc.getElementById('atMonth').classList.contains('hidden') && W.doc.getElementById('awList').classList.contains('hidden'), '[취합] 인데 달력이나 주간 목록이 보인다');
    });

    test('MW2 (§4, §7.4): 실적 기간, 고친 계획 기간, 작성일, 로그인 이름이 payload 에 그대로 간다, 저장 회신(경로 토스트, notice, 폴더 열기)', async () => {
      await fresh();
      setVal(W, $id(W, 'rptmPFrom'), '2026-10-05', 'change'); setVal(W, $id(W, 'rptmPTo'), '2026-11-13', 'change');
      setVal(W, $id(W, 'rptmDate'), '2026-10-23', 'change');
      $id(W, 'rptmSave').click(); await tick();
      const req = pending(W, 'exportMonthlyDocx')[0];
      assert.ok(req, 'exportMonthlyDocx 요청이 없다');
      assert.deepStrictEqual([req.actual, req.plan, req.reportDate, req.name], [{ from: FROM, to: TO }, { from: '2026-10-05', to: '2026-11-13' }, '2026-10-23', '시험자'], '기간, 작성일, 이름이 그대로 가지 않았다');
      assert.ok(Array.isArray(req.projects) && req.etc && Array.isArray(req.etc.lines), 'payload 모양(projects, etc.lines)이 아니다');
      assert.ok(!('images' in req) && !JSON.stringify(req).includes('base64'), 'payload 에 그림 바이트가 실렸다');
      assert.ok($id(W, 'rptmSave').disabled, '저장 중 버튼이 잠기지 않았다');
      reply(W, 'exportMonthlyDocx', { ok: true, path: 'C:\\시험\\월간보고_시험자_261023.docx', dir: 'C:\\시험', projects: 3, images: 0, imageSource: 'cache', notice: '서버에 연결되지 않아 PC 에 받아 둔 그림으로 넣었습니다.' });
      await tick();
      const ts = W.evJSON('__toasts');
      assert.ok(ts.some((t) => t.includes('C:\\시험\\월간보고_시험자_261023.docx')), '저장 경로 토스트가 없다');
      assert.ok(ts.some((t) => t.includes('PC 에 받아 둔 그림')), 'notice 를 보여 주지 않았다');
      assert.ok(!$id(W, 'rptmOpenDir').classList.contains('hidden'), '폴더 열기 버튼이 없다');
      $id(W, 'rptmOpenDir').click();
      const of = W.posted.filter((x) => x && x.cmd === 'openFolder').pop();
      assert.deepStrictEqual(of && of.path, 'C:\\시험', '폴더 열기가 호스트가 준 dir 로 가지 않았다');
      //  실패는 이유를 그대로
      $id(W, 'rptmSave').click(); await tick();
      reply(W, 'exportMonthlyDocx', { ok: false, error: '파일이 열려 있어 저장할 수 없습니다. Word 나 한글에서 닫고 다시 시도하세요.' }); await tick();
      assert.ok(W.evJSON('__toasts').includes('파일이 열려 있어 저장할 수 없습니다. Word 나 한글에서 닫고 다시 시도하세요.'), '저장 실패 이유를 그대로 보여 주지 않았다');
      //  취소는 조용히
      const n = W.evJSON('__toasts').length;
      $id(W, 'rptmSave').click(); await tick();
      reply(W, 'exportMonthlyDocx', { ok: false, cancelled: true }); await tick();
      assert.strictEqual(W.evJSON('__toasts').length, n, '저장 창 취소에 토스트가 떴다');
      assert.ok(!$id(W, 'rptmSave').disabled, '회신 뒤 저장 버튼이 풀리지 않았다');
      //  취합 화면은 기간 칸을 바꾸면(change) 월간 문서도 그 기간으로 바로 새로 열린다(옛 월간 탭의 읽어 오기 전 저장 막기는 없다): 저장은 바꾼 기간으로 간다
      setVal(W, $id(W, 'rptFrom'), '2026-08-01', 'change'); drainImages(W);
      await readAgain(W);   // 기간을 바꾸면 읽어 둔 글은 버려지고 문서가 비므로, 바꾼 기간을 읽어 온 뒤 저장한다
      $id(W, 'rptmSave').click(); await tick();
      const req2 = pending(W, 'exportMonthlyDocx')[0];
      assert.ok(req2 && req2.actual.from === '2026-08-01' && req2.actual.to === TO, '바꾼 기간이 저장 payload 에 따라가지 않았다(옛 기간으로 저장한다)');
      reply(W, 'exportMonthlyDocx', { ok: false, cancelled: true }); await tick();
      await fresh();
    });

    test('MW3 (§4): 과제명은 공식 이름(통상명칭, 없으면 사업명), 과제 수행 기간 = DB 개발 시작일 ~ 개발종료일(YYYY/MM), 빈 쪽은 빈칸', async () => {
      await fresh();
      W.ev(`[${JSON.stringify(P1)}, ${JSON.stringify(P2)}, ${JSON.stringify(P3)}].forEach(function(id){ __rptM.checked[id] = true; }); rptMRenderAll();`);
      drainImages(W);
      const p = payloadOf(W);
      const pr = (id) => p.projects.find((x) => x.uid === id);
      assert.strictEqual(pr(P1).term, '2025/08 ~ 2026/12');
      assert.strictEqual(pr(P2).term.trim(), '2026/03 ~', '종료가 빈 과제의 기간이 다르다(계약 종료로 채우면 안 된다)');
      assert.strictEqual(pr(P3).term, '', '둘 다 빈 과제의 기간은 빈칸이어야 한다(계약 기간으로 대신하지 않는다)');
      assert.deepStrictEqual([pr(P1).title, pr(P2).title], ['(예시) 관제 고도화', '(예시) 해양 관측 체계'], '과제명이 통상명칭, 없으면 사업명이 아니다');
      //  카테고리 이름을 바꿔도 문서 과제명은 공식 이름
      W.ev(`catById(${JSON.stringify(P1)}).name = '(예시) 내가 바꾼 이름';`);
      assert.strictEqual(payloadOf(W).projects.find((x) => x.uid === P1).title, '(예시) 관제 고도화', '문서 과제명이 공식 이름이 아니다');
      W.ev(`catById(${JSON.stringify(P1)}).name = '(예시) 관제 고도화';`);
      assert.strictEqual(pvTable(W, P2).querySelector('td.bv').textContent.trim(), '2026/03 ~', '미리 보기 과제 수행 기간이 문서 값과 다르다');
    });

    test('MW4 (§5.3-4, 2026-11-03): 캘린더 기록 실적 글 = 이 앱 주간보고 DB 에서 읽은 주를 과제별로 모은 글의 과제 블록(글자 그대로, 주차별과 평면), 겹치는 주만, 달력의 일정과 공용 일정은 들어가지 않는다', async () => {
      W.ev("PCAL.events = [{ eventUid: 'pe1', projectUid: " + JSON.stringify(U1) + ", title: '공용 착수 회의(시험)', date: '2026-09-09', endDate: '', allDay: true }];");
      try {
        for (const flat of [false, true]) {
          W.ev('weeklyFlat = ' + flat + ';');
          await fresh();
          const want = blocksOf(W);
          assert.ok(want['(예시) 관제 고도화'].includes('화면 응답 속도 개선') && want['(예시) 해양 관측 체계'].includes('관측 자료 수신 모듈 정리'), '전제: 읽은 주간보고 글이 비었다 flat=' + flat);
          assert.strictEqual(actualOf(W, P1), want['(예시) 관제 고도화'], '관제 고도화 실적이 읽은 주간보고 과제 블록과 다르다 flat=' + flat);
          assert.strictEqual(actualOf(W, P2), want['(예시) 해양 관측 체계'], '해양 관측 실적이 다르다 flat=' + flat);
          const a1 = actualOf(W, P1);
          assert.ok(!a1.includes('공용 착수 회의') && !a1.includes('기간 밖 일') && !a1.includes('기간 뒤 일'), '공용 일정이나 겹치지 않는 주의 글이 실적에 들어갔다 flat=' + flat);
          assert.ok(a1.includes('중간 점검 회의') && a1.includes('알람 기준값 화면 추가'), '겹치는 주의 글이 실적에 없다');
          //  달력의 일정은 실적에 들어가지 않는다(주간보고에 쓴 글만)
          assert.ok(!a1.includes('점검 항목 화면 착수') && !actualOf(W, P3).includes('점검 항목 화면 착수'), '달력의 일정이 실적에 들어갔다');
          assert.deepStrictEqual(payloadOf(W).projects.find((x) => x.uid === P1).actual, W.evJSON('rptMLines(' + JSON.stringify(a1) + ')'), 'payload 실적이 모은 글과 다르다 flat=' + flat);
          const pv = [...pvTable(W, P1).querySelectorAll('[data-pv="actual"] .ln')].map((x) => x.textContent);
          assert.deepStrictEqual(pv, W.evJSON('rptMLines(' + JSON.stringify(a1) + ')').map((l) => l.text), '미리 보기 실적이 모은 글과 다르다 flat=' + flat);
          //  과제별 글의 복사 글도 같은 읽기 한 번의 결과다
          assert.ok(W.ev('buildReportText()').includes(want['(예시) 관제 고도화']), '복사 글이 같은 결과를 쓰지 않는다 flat=' + flat);
        }
      } finally {
        W.ev("PCAL.events = []; weeklyFlat = false;");
        await fresh();
      }
    });

    test('MW5 (§5.3-1, 2026-10-23): 기록이 있는 과제만 처음부터 체크, 순서는 내 과제 순서 그대로(▲▼ 없음), 체크하면 미리 보기와 문서가 바로 바뀐다', async () => {
      await fresh();
      const order = W.evJSON('__rptM.order');
      assert.deepStrictEqual(order, [P1, P2, P3, P4], '과제 목록이 내 카테고리 순서의 공식 과제가 아니다');
      assert.deepStrictEqual(order.map((id) => W.ev(`!!__rptM.checked[${JSON.stringify(id)}]`)), [true, true, true, false], '기본 체크가 기록 있는 과제가 아니다(계획 기간 기록 포함)');
      const rows = [...W.doc.querySelectorAll('#rptmPick .rptm-it')];
      assert.strictEqual(rows.length, 4);
      assert.deepStrictEqual(rows.map((r) => (r.querySelector('.rptm-none') || { textContent: '' }).textContent), ['', '', '', '기록 없음'], '기록 없음 표시가 기록 없는 과제에만 있지 않다');
      assert.strictEqual($id(W, 'rptmPickCnt').textContent, '3/4', '과제 머리의 체크 수가 다르다');
      //  순서 단추 없음
      const pane = $id(W, 'asBand');
      assert.ok(!/[▲▼]/.test(pane.textContent) && !pane.querySelector('[data-act="up"], [data-act="down"], .rptm-ord'), '월간 문서 설정에 ▲▼ 순서 단추가 있다');
      assert.deepStrictEqual(payloadOf(W).projects.map((p) => p.uid), [P1, P2, P3], '문서 과제 순서가 내 과제 순서가 아니다(체크 안 한 과제는 빠진다)');
      assert.deepStrictEqual([...W.doc.querySelectorAll('#rptmSheet table[data-pv-uid]')].map((t) => t.dataset.pvUid), [P1, P2, P3], '미리 보기 순서가 내 과제 순서가 아니다');
      //  체크하면 바로(다른 호출 없이) 미리 보기 표가 생기고, 끄면 바로 빠진다
      check(W, row(W, P4).querySelector('input[data-act="pick"]'), true);
      assert.ok(pvTable(W, P4) && payloadOf(W).projects.some((p) => p.uid === P4), '체크한 과제가 미리 보기와 문서에 바로 들어가지 않았다');
      assert.deepStrictEqual([...W.doc.querySelectorAll('#rptmSheet table[data-pv-uid]')].map((t) => t.dataset.pvUid), [P1, P2, P3, P4], '체크한 과제가 내 과제 순서 자리에 들어가지 않았다');
      assert.ok(!row(W, P4).classList.contains('off') && $id(W, 'rptmPickCnt').textContent === '4/4' && $id(W, 'rptmPvSum').textContent.startsWith('과제 4개'), '체크한 줄 표시나 개수가 바로 바뀌지 않았다');
      check(W, row(W, P1).querySelector('input[data-act="pick"]'), false);
      assert.ok(!pvTable(W, P1) && row(W, P1).classList.contains('off'), '체크를 끈 과제가 미리 보기에서 바로 빠지지 않았다');
      //  내 과제 순서를 바꾸면(내 과제 창에서) 다음에 열 때 그 순서
      W.ev(`(function(){ var c = state.categories, i = c.findIndex(function(x){ return x.id === ${JSON.stringify(P2)}; }); var p2 = c.splice(i, 1)[0]; c.unshift(p2); })()`);
      try {
        await fresh();
        assert.deepStrictEqual(W.evJSON('__rptM.order'), [P2, P1, P3, P4], '내 과제 순서를 바꿨는데 목록 순서가 따르지 않았다');
        assert.deepStrictEqual([...W.doc.querySelectorAll('#rptmSheet table[data-pv-uid]')].map((t) => t.dataset.pvUid), [P2, P1, P3], '미리 보기가 내 과제 순서를 따르지 않았다');
      } finally {
        W.ev('state.categories = ' + JSON.stringify(stateFor().categories) + ';');
        await fresh();
      }
    });

    test('MW6 (§4, §5, 2026-10-23): 고치는 칸이 없다(입력은 날짜 셋과 체크뿐), payload 의 계획 두 칸과 변경이력은 비고, 미리 보기도 빈칸, 같은 기간 읽어 오기는 확인 없이 다시 읽는다', async () => {
      await fresh();
      W.ev('rptMOfficial().forEach(function(c){ __rptMImgOpen.add(c.id); }); rptMRenderPick();'); drainImages(W); await tick();   // 그림 칸까지 펼쳐 본다
      //  월간 문서 영역 = 월간 문서 설정 띠(#asBand)와 문서 미리 보기(#asDoc). 기간, 출처, 포함 항목, 서식은 취합 화면 공용이라 뺀다.
      const panes = ['asBand', 'asDoc'].map((id) => $id(W, id));
      const qa = (sel) => panes.flatMap((p) => [...p.querySelectorAll(sel)]);
      assert.strictEqual(qa('textarea, select, [contenteditable]').length, 0, '월간 문서 영역에 textarea, select, contenteditable 이 있다');
      const inputs = qa('input');
      const bad = inputs.filter((i) => !((i.type === 'date' && DATE_IDS.includes(i.id)) || (i.type === 'checkbox' && (i.matches('#rptmPick input[data-act="pick"]') || i.matches('#rptmEtc input[data-etc]')))));
      assert.deepStrictEqual(bad.map((i) => i.outerHTML), [], '고르는 것 말고 다른 입력이 있다');
      assert.strictEqual(inputs.filter((i) => i.type === 'date').length, 3);
      assert.ok(!$id(W, 'rptmCards') && !qa('[data-f], [data-cf], [data-act="reload"], [data-act="chgAdd"], [data-act="unidMove"]').length, '과제 카드나 고치는 칸, 다시 붙이기, 변경이력 행, 이관이 남았다');
      const p = payloadOf(W);
      assert.ok(p.projects.length === 3, '전제: 과제 셋');
      for (const pr of p.projects) {
        assert.deepStrictEqual([pr.prevPlan, pr.nextPlan, pr.changes], [[], [], []], '계획 두 칸이나 변경이력이 비어 있지 않다: ' + pr.uid);
        assert.strictEqual(pr.title, W.ev('rptMCatName(' + JSON.stringify(pr.uid) + ')'));
      }
      assert.ok(p.projects.find((x) => x.uid === P1).actual.length > 0, '전제: 실적이 모였다');
      const t1 = pvTable(W, P1);
      assert.strictEqual(t1.querySelectorAll('tr').length, 7, '미리 보기 과제 표 줄 수가 양식(변경이력 빈 줄 하나)과 다르다');
      assert.deepStrictEqual(['prev', 'next'].map((k) => t1.querySelector(`[data-pv="${k}"]`).textContent), ['', ''], '미리 보기 계획 칸이 비어 있지 않다');
      assert.strictEqual(t1.querySelector('[data-pv="chg"]').textContent, '', '미리 보기 변경이력 줄이 비어 있지 않다');
      //  같은 기간 읽어 오기: 확인 창 없이 주간보고 기록을 다시 읽는다
      const extra = WK('2026-09-21', '2026-09-26', '[(예시) 관제 고도화]\n  - 새로 넣은 기록(시험)');
      WEEK_ROWS.push(extra);
      try {
        assert.ok(!actualOf(W, P1).includes('새로 넣은 기록'), '전제: 아직 읽지 않았다');
        const n0 = weekly.calls.length;
        await readAgain(W);
        assert.ok(overlayClosed(W, 'confirmModal'), '같은 기간 읽어 오기에 확인 창이 떴다(덮을 글이 없다)');
        assert.ok(weekly.calls.length > n0, '다시 읽어 오기가 주간보고 기록을 다시 읽지 않았다');
        assert.ok(actualOf(W, P1).includes('새로 넣은 기록') && JSON.stringify(payloadOf(W)).includes('새로 넣은 기록'), '다시 읽어 오기가 새로 읽은 글을 담지 않았다');
        assert.ok(pvTable(W, P1).textContent.includes('새로 넣은 기록'), '다시 읽어 오기 뒤 미리 보기가 바로 바뀌지 않았다');
      } finally { WEEK_ROWS.splice(WEEK_ROWS.indexOf(extra), 1); }
      W.ev('__rptMImgOpen.clear();');
      await fresh();
    });

    test('MW7 (§5.3-4): 줄 앞 들여쓰기 깊이 → level(0..3, 칸 안의 순위), 글자는 들여쓰기만 떼고 그대로, 앞뒤 빈 줄 제거', () => {
      const r = W.evJSON("rptMLines('\\n- 가\\n\\u00a0\\u00a0; 나 \\n\\n\\u00a0\\u00a0\\u00a0\\u00a0\\u00a0\\u00a0본문\\n\\t\\t\\t깊이\\n\\n')");
      assert.deepStrictEqual(r, [{ level: 0, text: '- 가' }, { level: 1, text: '; 나' }, { level: 0, text: '' }, { level: 2, text: '본문' }, { level: 3, text: '깊이' }]);
      assert.deepStrictEqual(W.evJSON("rptMLines('    - 들여 쓴 첫 줄\\n      ; 세부')"), [{ level: 0, text: '- 들여 쓴 첫 줄' }, { level: 1, text: '; 세부' }], '가장 얕은 들여쓰기가 level 0 이 아니다');
      assert.deepStrictEqual(W.evJSON("rptMLines('')"), []);
    });

    test('MW8 (§6, §5.3, B안): 그림은 과제 줄의 서랍에서(그림 n, + 그림, 열기, 파일, 붙여넣기, 줄과 서랍의 포커스와 마우스 Ctrl+V, 순서, 삭제 확인), 사람별 그림 명령만, 끊기면 사본 목록과 안내, 다시 열어도 그림 n, 미리 보기 쪽에는 그림 버튼이 없다', async () => {
      await fresh();
      W.ev('__rptMThumbs.clear(); __rptMThumbReq.clear(); __rptMImgs.clear(); __rptMImgOpen.clear(); rptMRenderPick();');
      const ln0 = W.posted.length;
      const IMG = (id, seq) => ({ id, seq, mime: 'image/png', width: 640, height: 200, bytes: 1000, sha256: String(id).repeat(64).slice(0, 64), uploadedAt: '2026-10-02T05:10:00.000Z' });
      assert.deepStrictEqual(pending(W, 'scheduleImageList').map((x) => x.projectUid).sort(), [P1, P2, P3, P4].sort(), '목록의 과제마다(체크와 상관없이) 그림 목록을 묻지 않았다');
      reply(W, 'scheduleImageList', { ok: true, data: { projectUid: U1, images: [IMG(1, 1), IMG(2, 2)], stale: false, notice: '' } }, (x) => x.projectUid === P1);
      reply(W, 'scheduleImageList', { ok: false, data: { projectUid: U2, images: [IMG(3, 1)], stale: true, notice: '서버에 연결되지 않아 PC 에 받아 둔 그림만 보여 줍니다. 추가와 삭제는 연결된 뒤에 하세요.' }, error: { kind: 'connection', message: '서버에 연결할 수 없습니다.' } }, (x) => x.projectUid === P2);
      reply(W, 'scheduleImageList', { ok: false, error: { kind: 'forbidden', message: '로그인이 필요합니다.' } }, (x) => x.projectUid === P3);
      reply(W, 'scheduleImageList', { ok: true, data: { projectUid: U4, images: [], stale: false, notice: '' } }, (x) => x.projectUid === P4);
      await tick();
      const tog = (id) => row(W, id).querySelector('[data-act="imgTog"]');
      const togText = (id) => tog(id).textContent.replace(/\s*[▾▴]$/, '');
      const strip = (id) => row(W, id).querySelector('[data-strip]');
      assert.deepStrictEqual([P1, P2, P4].map(togText), ['그림 2', '그림 1', '+ 그림'], '줄의 그림 단추가 그림 n, + 그림이 아니다');
      assert.ok(tog(P2).classList.contains('warn') && tog(P3).classList.contains('warn') && tog(P3).title.includes('로그인이 필요합니다.'), '끊김이나 거부가 단추에 보이지 않는다');
      assert.ok([P1, P2, P3, P4].every((id) => strip(id).classList.contains('hidden') && tog(id).getAttribute('aria-expanded') === 'false'), '그림 서랍이 처음부터 열려 있다(줄은 작게)');
      assert.strictEqual(W.doc.querySelectorAll('#rptmPv [data-act], #rptmPv button').length, 0, '미리 보기 쪽에 그림 버튼이 있다(그림은 과제 줄에서만)');
      //  펼치기
      tog(P1).click(); await tick();
      assert.ok(!strip(P1).classList.contains('hidden') && tog(P1).getAttribute('aria-expanded') === 'true', '그림 단추가 서랍을 열지 않는다');
      assert.strictEqual(strip(P1).querySelectorAll('.rptm-card').length, 2, '그림 두 장이 보이지 않는다');
      assert.ok(strip(P1).querySelector('.rptm-card').title.includes('넣음') && strip(P1).querySelector('.rptm-dr-h').textContent.includes('2/5') && strip(P1).textContent.includes('나만 봅니다'), '넣은 시각, 장 수, 사람별 안내가 없다');
      //  안내는 짧게: 긴 설명은 풍선(title) 하나에만
      const tip = strip(P1).querySelectorAll('.rptm-tip[title]');
      assert.ok(tip.length === 1 && tip[0].title.includes('5MB') && tip[0].title.includes('Ctrl+V') && strip(P1).querySelectorAll('.rptm-hint').length === 0, '서랍 안내가 풍선 하나로 모이지 않았다');
      assert.ok(tog(P1).classList.contains('open') && tog(P1).textContent.includes('▴'), '열린 서랍 단추 표시가 없다');
      reply(W, 'scheduleImageThumb', { ok: true, data: { id: 1, sha256: IMG(1).sha256, dataUrl: 'data:image/jpeg;base64,AAAA', width: 10, height: 4, stale: false } }, (x) => x.id === 1);
      await tick();
      assert.strictEqual(strip(P1).querySelector('.rptm-card img').getAttribute('src'), 'data:image/jpeg;base64,AAAA', '줄의 미리 보기 그림이 붙지 않았다');
      assert.strictEqual(pvTable(W, P1).querySelector('td.img img').getAttribute('src'), 'data:image/jpeg;base64,AAAA', '문서 미리 보기에 그림이 들어가지 않았다');
      tog(P2).click(); await tick();
      assert.ok(strip(P2).querySelector('[data-act="imgFile"]').disabled && strip(P2).querySelector('[data-act="imgDel"]').disabled && strip(P2).querySelector('[data-act="imgPaste"]').disabled, '끊긴 과제에서 추가와 삭제가 막히지 않았다');
      assert.ok(strip(P2).querySelector('[data-msg]').textContent.includes('PC 에 받아 둔 그림만'), '끊김 안내(notice)가 없다');
      tog(P3).click(); await tick();
      assert.ok(strip(P3).querySelector('[data-msg]').textContent.includes('로그인이 필요합니다.') && strip(P3).querySelector('[data-act="imgFile"]').disabled, '목록 거부 이유가 그대로 보이지 않거나 추가가 열려 있다');
      //  파일 고르기 → 취소
      strip(P1).querySelector('[data-act="imgFile"]').click(); await tick();
      const add1 = reply(W, 'scheduleImageAdd', { ok: false, cancelled: true });
      assert.deepStrictEqual([add1.projectUid, add1.mode], [P1, 'file']);
      await tick();
      //  붙여넣기 → 성공(세 장)
      strip(P1).querySelector('[data-act="imgPaste"]').click(); await tick();
      const add2 = reply(W, 'scheduleImageAdd', { ok: true, data: { projectUid: U1, image: IMG(4, 3), images: [IMG(1, 1), IMG(2, 2), IMG(4, 3)] } });
      assert.strictEqual(add2.mode, 'clipboard');
      await tick();
      assert.strictEqual(strip(P1).querySelectorAll('.rptm-card').length, 3, '넣은 뒤 목록이 갱신되지 않았다');
      assert.ok(strip(P1).querySelector('[data-msg]').textContent.includes('그림을 넣었습니다') && togText(P1) === '그림 3');
      //  Ctrl+V: 줄 안에 포커스(과제 체크)
      ctrlV(W, row(W, P1).querySelector('input[data-act="pick"]')); await tick();
      const add3 = reply(W, 'scheduleImageAdd', { ok: false, error: { kind: 'invalid', message: '같은 그림이 이 과제에 이미 있습니다.' } });
      assert.deepStrictEqual([add3.projectUid, add3.mode], [P1, 'clipboard'], '포커스가 있는 줄의 Ctrl+V 가 그 과제 붙여넣기로 가지 않았다');
      await tick();
      assert.ok(strip(P1).querySelector('[data-msg]').textContent.includes('같은 그림이 이 과제에 이미 있습니다.'), '거절 이유가 그대로 보이지 않는다');
      //  Ctrl+V: 서랍 안에 포커스(그림 카드 단추)
      ctrlV(W, strip(P1).querySelector('.rptm-card [data-act="imgR"]')); await tick();
      const add3b = reply(W, 'scheduleImageAdd', { ok: false, cancelled: true });
      assert.deepStrictEqual([add3b.projectUid, add3b.mode], [P1, 'clipboard'], '서랍 안 포커스의 Ctrl+V 가 그 과제 붙여넣기로 가지 않았다');
      await tick();
      //  Ctrl+V: 마우스가 올라간 줄(닫혀 있던 P4). 결과가 보이게 서랍을 연다
      row(W, P4).querySelector('.rptm-row').dispatchEvent(new W.w.MouseEvent('mouseover', { bubbles: true }));
      ctrlV(W, W.doc.body); await tick();
      const add4 = reply(W, 'scheduleImageAdd', { ok: false, cancelled: true });
      assert.deepStrictEqual([add4.projectUid, add4.mode], [P4, 'clipboard'], '마우스가 올라간 줄의 Ctrl+V 가 그 과제 붙여넣기로 가지 않았다');
      await tick();
      assert.ok(!strip(P4).classList.contains('hidden'), 'Ctrl+V 로 넣을 때 그 줄의 서랍을 열지 않았다');
      //  마우스가 목록 밖, 날짜 칸 안, 다른 탭의 Ctrl+V 는 그림 넣기가 아니다
      const adds = () => W.posted.filter((x) => x && x.cmd === 'scheduleImageAdd').length;
      $id(W, 'rptmPick').dispatchEvent(new W.w.MouseEvent('mouseleave'));
      const before = adds();
      ctrlV(W, W.doc.body); ctrlV(W, $id(W, 'rptmDate')); await tick();
      assert.strictEqual(adds(), before, '줄 밖이나 날짜 칸의 Ctrl+V 가 그림 넣기를 불렀다');
      //  결과 형태가 과제별 글이면(월간 문서 설정이 숨은 때) 마우스가 줄 위에 있어도 Ctrl+V 는 그림 넣기가 아니다
      row(W, P1).querySelector('.rptm-row').dispatchEvent(new W.w.MouseEvent('mouseover', { bubbles: true }));
      W.ev("AS.out = 'text';");
      ctrlV(W, W.doc.body); await tick();
      W.ev("AS.out = 'doc';");
      assert.strictEqual(adds(), before, '과제별 글 화면에서 Ctrl+V 가 그림 넣기를 불렀다');

      $id(W, 'rptmPick').dispatchEvent(new W.w.MouseEvent('mouseleave'));
      //  순서 ▶
      strip(P1).querySelector('.rptm-card [data-act="imgR"]').click(); await tick();
      const mv = reply(W, 'scheduleImageMove', { ok: true, data: { projectUid: U1, images: [IMG(2, 1), IMG(1, 2), IMG(4, 3)], stale: false, notice: '' } });
      assert.deepStrictEqual([mv.id, mv.seq], [1, 2], '뒤로 가 첫 그림을 2번 자리로 보내지 않았다');
      await tick();
      //  삭제: 확인 창 취소 → 요청 없음, 확인 → 요청
      strip(P1).querySelector('.rptm-card [data-act="imgDel"]').click();
      const dmsg = await confirmAnswer(W, false);
      assert.ok(dmsg.includes('되돌릴 수 없습니다') && dmsg.includes('내 그림만'), '삭제 확인 문구가 내 그림만 지운다고 말하지 않는다');
      assert.strictEqual(pending(W, 'scheduleImageDelete').length, 0, '취소했는데 삭제 요청이 갔다');
      strip(P1).querySelector('.rptm-card [data-act="imgDel"]').click();
      await confirmAnswer(W, true);
      const del = reply(W, 'scheduleImageDelete', { ok: true, data: { projectUid: U1, images: [IMG(1, 1), IMG(4, 2)], stale: false, notice: '' } });
      assert.strictEqual(del.id, 2);
      await tick();
      assert.strictEqual(strip(P1).querySelectorAll('.rptm-card').length, 2);
      //  그동안 나간 그림 명령은 단계 A 다섯뿐
      const cmds = new Set(W.posted.slice(ln0).map((x) => x && x.cmd).filter((c) => /^scheduleImage|Monthly|netcus/i.test(c || '')));
      for (const c of cmds) assert.ok(['scheduleImageList', 'scheduleImageThumb', 'scheduleImageAdd', 'scheduleImageDelete', 'scheduleImageMove'].includes(c), '그림 버튼이 다른 명령을 보냈다: ' + c);
      //  다시 열면: 서랍은 닫히고, 사람별 DB 목록을 다시 물어 그림 n 이 보인다(그림만 DB 에 있다)
      reopen(W); await tick();
      assert.ok(pending(W, 'scheduleImageList').some((x) => x.projectUid === P1), '다시 열었는데 그림 목록을 묻지 않았다');
      reply(W, 'scheduleImageList', { ok: true, data: { projectUid: U1, images: [IMG(1, 1), IMG(4, 2)], stale: false, notice: '' } }, (x) => x.projectUid === P1);
      drainImages(W); await tick();
      assert.ok(togText(P1) === '그림 2' && strip(P1).classList.contains('hidden'), '다시 열었을 때 그림 n 이 보이지 않거나 서랍이 열려 있다');
      drainImages(W);
      W.ev('__rptMImgOpen.clear();');
      await fresh();
    });

    test('MW9 (§5.4, 2026-10-23): 기억하는 값이 없다: 바꾼 뒤 다시 열면(두 번) 처음 값, 월간 흐름은 저장소에 아무것도 쓰지 않는다, 저장소가 막혀도 깨지지 않는다', async () => {
      await fresh();
      reopen(W); await tick(); drainImages(W);
      const d0 = defaultsNow();
      const n0 = lsMark(W);
      const sink = [];
      //  고를 수 있는 것을 모두 바꾼다: 과제 체크, 기타 칩(펼쳐서), 출처, 계획 기간, 작성일, 세그, 실적 기간
      check(W, row(W, P3).querySelector('input[data-act="pick"]'), false);
      check(W, row(W, P4).querySelector('input[data-act="pick"]'), true);
      $id(W, 'rptmEtcTog').click();
      check(W, W.doc.querySelector('#rptmEtc input[data-etc="c-ed"]'), false);
      W.doc.querySelector('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
      setVal(W, $id(W, 'rptmPFrom'), '2026-10-05', 'change'); setVal(W, $id(W, 'rptmPTo'), '2026-11-13', 'change');
      setVal(W, $id(W, 'rptmDate'), '2026-10-23', 'change');
      W.ev("atSumOutSet('text'); atSumOutSet('doc');");   // 결과 형태도 오간다
      W.doc.querySelector('#rptSrcSeg [data-rsrc="cal"]').click(); await tick();
      await loadPeriod(W, '2026-08-01', '2026-08-31'); drainImages(W);
      assert.strictEqual(W.ev('__rptM.from'), '2026-08-01', '전제: 기간을 바꿨다');
      //  월간 문서의 조작(체크, 기타, 계획, 작성일, 결과 형태, 읽어 오기)은 월간 키를 저장소에 쓰지 않는다. 취합 화면 공용 설정(포함 항목, tc_rptSources)을
      //  글을 다시 그릴 때 쓰는 것은 취합 화면의 일이다(월간 보고만의 기억이 아니다).
      assert.deepStrictEqual(lsSince(W, n0).filter((k) => k !== 'set:tc_rptSources'), [], '월간 문서 안의 조작이 취합 공용 설정 말고 다른 것을 저장소에 썼다');
      const n1 = lsMark(W);
      //  두 번 열어도 처음 값
      for (const k of [1, 2]) {
        reopen(W); await tick(); drainImages(W);
        assert.deepStrictEqual(defaultsNow(), d0, k + '번째 다시 연 화면이 처음 값이 아니다(무언가 기억했다)');
      }
      //  다시 연 동안에도 월간 키는 쓰지 않는다(취합 공용 설정 tc_rptSources 를 쓰는 것은 취합 화면의 일)
      const wrote = lsSince(W, n1);
      assert.deepStrictEqual(wrote.filter((k) => /rptM|rptm|monthly/i.test(k)), [], '월간 흐름이 월간 키를 저장소에 썼다');
      void sink;
      //  저장소가 막혀도: 열기, 체크, 기타, 읽어 오기가 그대로 된다
      W.ev("window.__ls = [Storage.prototype.getItem, Storage.prototype.setItem]; Storage.prototype.getItem = function(){ throw new Error('blocked'); }; Storage.prototype.setItem = function(){ throw new Error('blocked'); };");
      try {
        reopen(W); await tick(); drainImages(W);
        await loadPeriod(W, '2026-05-01', '2026-05-31'); drainImages(W);
        assert.strictEqual(W.ev('__rptM.from'), '2026-05-01', '막힌 저장소에서 읽어 오기가 깨졌다');
        check(W, W.doc.querySelector('#rptmEtc input[data-etc="c-in"]'), false);
        assert.strictEqual($id(W, 'rptmEtcSum').textContent, '1/2', '막힌 저장소에서 기타 넣기 빼기가 깨졌다');
      } finally { W.ev('Storage.prototype.getItem = __ls[0]; Storage.prototype.setItem = __ls[1];'); }
      await fresh();
    });

    test('MW10 (§11.2-3, B안): 기타는 공식 과제가 아닌 카테고리 전부, 처음은 한 줄 요약(모두 넣음), 고르기로 칩을 펼쳐 빼면 미리 보기와 문서가 바로 바뀐다, 다시 열면 모두 넣음', async () => {
      await fresh();
      const etcText = () => payloadOf(W).etc.lines.map((l) => l.text).join('\n');
      const etcPv = () => (W.doc.querySelector('#rptmSheet table[data-pv-etc]') || { textContent: '' }).textContent;
      assert.ok(etcText().includes('주간 회의 자료 정리') && etcText().includes('보안 교육 이수'), '기타에 공식 과제가 아닌 카테고리 글이 없다');
      assert.ok(!etcText().includes('화면 응답 속도 개선'), '기타에 공식 과제 글이 들어갔다');
      assert.ok($id(W, 'rptmEtc').classList.contains('hidden') && $id(W, 'rptmEtcSum').textContent === '2개 모두 넣음' && $id(W, 'rptmEtcTog').getAttribute('aria-expanded') === 'false', '기타가 한 줄 요약으로 접혀 열리지 않았다');
      $id(W, 'rptmEtcTog').click();
      assert.ok(!$id(W, 'rptmEtc').classList.contains('hidden') && $id(W, 'rptmEtcTog').textContent === '접기' && $id(W, 'rptmEtcTog').getAttribute('aria-expanded') === 'true', '고르기가 칩을 펼치지 않았다');
      const chips = [...W.doc.querySelectorAll('#rptmEtc label.rpt-chip input[data-etc]')];
      assert.deepStrictEqual(chips.map((x) => [x.dataset.etc, x.checked]), [['c-in', true], ['c-ed', true]], '기타 칩이 내 순서의 모든 카테고리(모두 넣음)가 아니다');
      const n0 = lsMark(W);
      check(W, W.doc.querySelector('#rptmEtc input[data-etc="c-ed"]'), false);
      assert.ok(!etcText().includes('보안 교육 이수') && etcText().includes('주간 회의 자료 정리'), '뺀 카테고리 글이 기타에 남았다');
      assert.ok(!etcPv().includes('보안 교육') && etcPv().includes('주간 회의 자료 정리'), '미리 보기 기타 표가 바로 바뀌지 않았다');
      assert.strictEqual($id(W, 'rptmEtcSum').textContent, '1/2', '기타 요약이 바뀌지 않았다');
      assert.ok(overlayClosed(W, 'confirmModal'), '기타 넣기 빼기에 확인 창이 떴다');
      //  둘 다 빼면 기타 표가 미리 보기에서 사라진다
      check(W, W.doc.querySelector('#rptmEtc input[data-etc="c-in"]'), false);
      assert.ok(!W.doc.querySelector('#rptmSheet table[data-pv-etc]') && !$id(W, 'rptmPvSum').textContent.includes('기타'), '기타를 모두 뺐는데 미리 보기에 기타 표가 남았다');
      check(W, W.doc.querySelector('#rptmEtc input[data-etc="c-in"]'), true);
      assert.deepStrictEqual(lsSince(W, n0), [], '기타 넣기 빼기가 저장소에 썼다');
      //  접어도 뺀 것은 그대로, 다시 열면 모두 넣음
      $id(W, 'rptmEtcTog').click();
      assert.ok($id(W, 'rptmEtc').classList.contains('hidden') && $id(W, 'rptmEtcSum').textContent === '1/2', '접으니 고른 것이 바뀌었다');
      reopen(W); await tick(); drainImages(W);
      assert.ok(W.doc.querySelector('#rptmEtc input[data-etc="c-ed"]').checked && $id(W, 'rptmEtcSum').textContent === '2개 모두 넣음', '다시 열었는데 뺀 카테고리가 빠져 있다(기억하지 않아야 한다)');
      await fresh();
    });

    const WEEKS = [
      { regdate: '2026-09-07', title: '9월 1주 주간보고', period: '2026.09.01~2026.09.05', endwork: '[(예시) 관제 고도화]\n- 화면 응답 개선\n  ; 목록 갱신 줄임\n[(예시) 사내 업무]\n- 회의 자료 정리\n[(예시) 없는 과제]\n- 미등록 일', content: '[(예시) 관제 고도화] : 10\n합계 : 10', plan: '' },
      { regdate: '2026-09-14', title: '9월 2주 주간보고', period: '2026.09.07~2026.09.11', endwork: '[(예시) 관제 고도화]\n- 알람 기준값 화면\n[(예시) 해양 관측 체계]\n- 수신 모듈 정리', content: '', plan: '' },
    ];
    const unidKeys = () => [...W.doc.querySelectorAll('#rptmUnid [data-unid] [data-unid-key]')].map((r) => r.dataset.unidKey);
    test('MW11 (§5.3-4, §14, B안): 주간보고 출처: netcusWeeklyRangeRead(읽기)만 부르고, 과제별 글 = buildNetcusWeeklyText 과제 블록(머리 줄 뺌), 안 맞은 과제는 문서 설정 띠의 미식별(문서에 없음)', async () => {
      await fresh();
      for (const flat of [false, true]) {
        W.ev('weeklyFlat = ' + flat + ';');
        const nRead = () => W.posted.filter((x) => x && x.cmd === 'netcusWeeklyRangeRead').length;
        const r0 = nRead();
        W.doc.querySelector('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
        assert.strictEqual(W.ev('__rptM.src'), 'week');
        assert.ok($id(W, 'rptmSrcHint').textContent.includes('읽어 오기를 누르면'), '다른 출처의 글이 떠 있을 때 출처 안내(짧게)가 없다');
        //  출처 단추를 누른 것, 기간 칸을 바꾼 것만으로는 회사 사이트를 읽지 않는다(읽어 오기를 눌러야 읽는다)
        setVal(W, $id(W, 'rptTo'), TO, 'change'); await tick(); drainImages(W);
        assert.strictEqual(W.ev('__rptM.src'), 'week', '기간 칸을 바꾸니 출처가 바뀌었다');
        assert.strictEqual(nRead(), r0, '읽어 오기를 누르기 전에 회사 사이트 읽기 요청이 나갔다');
        assert.ok($id(W, 'rptOut').textContent.includes('읽어 오기를 눌러 주세요'), '아직 안 읽은 과제별 글 쪽 안내가 없다');
        $id(W, 'asLoad').click(); await tick();
        assert.ok(overlayClosed(W, 'confirmModal'), '읽어 오기에 확인 창이 떴다');
        assert.ok($id(W, 'asLoad').disabled, '읽는 동안 읽어 오기가 잠기지 않았다');
        const rq = reply(W, 'netcusWeeklyRangeRead', { ok: true, error: '', weeks: WEEKS });
        assert.deepStrictEqual([rq.from, rq.to], [FROM, TO], '주간보고를 실적 기간으로 읽지 않았다');
        await tick(); drainImages(W);
        const want = W.evJSON(`(function(){ var p = parseNetcusWeekly(JSON.parse(${JSON.stringify(JSON.stringify(WEEKS))}), state.categories); var o = {}; p.tasks.forEach(function(t){ var b = buildNetcusWeeklyText({ tasks: [t] }, weeklyFlat); o[t.name] = b.slice(b.indexOf('\\n') + 1); }); o.__all = buildNetcusWeeklyText(p, weeklyFlat); return o; })()`);
        assert.strictEqual(actualOf(W, P1), want['(예시) 관제 고도화'], '관제 고도화 실적이 주간보고 과제 블록과 다르다(flat=' + flat + ')');
        assert.strictEqual(actualOf(W, P2), want['(예시) 해양 관측 체계'], '해양 관측 실적이 다르다');
        assert.ok(want.__all.includes(want['(예시) 관제 고도화']), '전제: 과제 블록이 전체 글 안에 있다');
        const p = payloadOf(W);
        assert.ok(p.etc.lines.map((l) => l.text).join('\n').includes('회의 자료 정리'), '기타에 사내 업무 글이 없다');
        assert.ok(!JSON.stringify(p).includes('미등록 일'), '안 맞은 과제 글이 문서 payload 에 들어갔다(미식별은 문서에 넣지 않는다)');
        assert.ok(!$id(W, 'rptmSheet').textContent.includes('미등록 일'), '안 맞은 과제 글이 문서 미리 보기(종이)에 들어갔다');
        assert.ok(![...W.doc.querySelectorAll('#rptmEtc input[data-etc]')].some((x) => x.parentElement.textContent.includes('없는 과제')), '안 맞은 과제가 기타 고르기에 있다');
        const ui = [...W.doc.querySelectorAll('#rptmUnid [data-unid] [data-unid-key]')];
        assert.ok(ui.length === 1 && ui[0].querySelector('summary b').textContent === '[(예시) 없는 과제]' && ui[0].querySelector('summary span').textContent === ui[0].querySelector('.tx').textContent.split('\n').find((l) => l.trim()) && ui[0].querySelector('.tx').textContent.includes('미등록 일'), '안 맞은 과제가 미식별 항목(머리 이름, 첫 줄, 글)에 없다');
        assert.ok($id(W, 'asBand').contains(ui[0]) && !$id(W, 'asLeft').contains(ui[0]), '미식별 항목이 오른쪽 문서 설정 띠 안에 있지 않다');
        //  2026-11-10: 예전에는 조작 0개(읽기만)였다. 이제 줄마다 넣을 곳 콤보 하나(처음 값 넣지 않음)이고 단추나 글 칸은 없다
        assert.strictEqual($id(W, 'rptmUnid').querySelectorAll('button, input, textarea').length, 0, '미식별 항목에 옮기기나 기억 같은 단추, 글 칸이 남았다');
        assert.ok(ui[0].querySelectorAll('select[data-unid-to]').length === 1 && ui[0].querySelector('select').value === '', '미식별 줄에 넣을 곳 콤보 하나(넣지 않음)가 없다');
        W.doc.querySelector('#rptSrcSeg [data-rsrc="cal"]').click(); await tick();
        await readAgain(W);
      }
      W.ev('weeklyFlat = false;');
    });

    //  §14 주간보고 과제 나누기 정책. 머리 이름: 사업명(P1 의 카테고리 이름은 통상명칭), 띄어쓰기만 다른 이름(P2), 개인 카테고리(교육),
    //  내 카테고리 어디에도 없는 둘(외부 지원, 미정 업무).
    const WEEKS2 = [
      { regdate: '2026-09-07', title: '9월 1주 주간보고', period: '2026.09.01~2026.09.05',
        endwork: '[(예시) 관제 고도화 사업]\n- 사업명 일\n[(예시) 해양관측  체계]\n- 해양 일\n[(예시) 교육]\n- 교육 일\n[(예시) 외부 지원]\n- 외부 지원 일\n[(예시) 미정 업무]\n- 미정 업무 일', content: '', plan: '' },
    ];
    const K_EXT = '(예시)외부지원', K_TBD = '(예시)미정업무';
    async function readWeek2(first) {
      if (first) { W.doc.querySelector('#rptSrcSeg [data-rsrc="week"]').click(); await tick(); }
      $id(W, 'asLoad').click(); await tick();
      reply(W, 'netcusWeeklyRangeRead', { ok: true, error: '', weeks: WEEKS2 }); await tick(); drainImages(W);
    }
    const payloadText = () => JSON.stringify(payloadOf(W));

    test('MW17 (§14): 사업명과 띄어쓰기만 다른 이름은 그 과제로, 개인 카테고리는 기타로(넣기 빼기 그대로), 안 맞은 것은 미식별(접기)이고 고르기 전에는 문서에 없다', async () => {
      await fresh();
      const n0 = W.posted.length;
      await readWeek2(true);
      assert.ok(actualOf(W, P1).includes('사업명 일'), '사업명(project_name) 머리가 그 공식 과제에 가지 않았다');
      assert.ok(actualOf(W, P2).includes('해양 일'), '띄어쓰기만 다른 머리가 그 과제에 가지 않았다(정규화)');
      assert.ok(payloadText().includes('교육 일'), '개인 카테고리 머리가 기타에 가지 않았다');
      assert.deepStrictEqual(unidKeys().sort(), [K_EXT, K_TBD].sort(), '미식별 항목이 안 맞은 둘이 아니다');
      assert.ok(!/외부 지원 일|미정 업무 일/.test(payloadText()), '미식별 항목이 문서 payload 에 들어갔다');
      assert.ok($id(W, 'rptmSrcMsg').textContent.includes('미식별'), '읽은 뒤 안내에 미식별 개수가 없다');
      //  접기: 칸 전체와 항목마다 details. 띠는 한 줄로 접어 두고 시작(2026-11-03 시안), 사용자가 연 것은 다시 그려도 그대로
      const sec = $id(W, 'rptmUnid').querySelector('details[data-unid]');
      assert.ok(sec && !sec.open && sec.querySelector('.rptm-badge').textContent === '2', '미식별 칸이 접힌 details 가 아니거나 개수가 없다');
      sec.open = true; W.ev('rptMRenderAll();'); drainImages(W);
      assert.strictEqual($id(W, 'rptmUnid').querySelector('details[data-unid]').open, true, '다시 그리니 연 미식별 칸이 접혔다');
      $id(W, 'rptmUnid').querySelector('details[data-unid]').open = false; W.ev('rptMRenderAll();'); drainImages(W);
      assert.strictEqual($id(W, 'rptmUnid').querySelector('details[data-unid]').open, false, '다시 그리니 접은 미식별 칸이 펼쳐졌다');
      //  맞은 개인 카테고리도 기타 넣기, 빼기를 그대로 따른다
      check(W, W.doc.querySelector('#rptmEtc input[data-etc="c-ed"]'), false); await tick();
      assert.ok(!payloadText().includes('교육 일'), '기타에서 뺀 개인 카테고리 글이 남았다');
      check(W, W.doc.querySelector('#rptmEtc input[data-etc="c-ed"]'), true); await tick();
      assert.ok(payloadText().includes('교육 일'), '다시 넣은 개인 카테고리 글이 돌아오지 않았다');
      const sent = W.posted.slice(n0).map((x) => x && x.cmd).filter(Boolean);
      assert.ok(!sent.some((c) => /netcusSubmit|netcusWeekSubmit|NetcusWeekFill/i.test(c)), '회사로 보내는 명령이 나갔다');
      W.doc.querySelector('#rptSrcSeg [data-rsrc="cal"]').click(); await tick();
      await readAgain(W);
    });

    test('MW18 (§14, 2026-10-23): 예전에 기억한 이관(tc_rptMNcMap:)은 읽지 않는다. 그 머리도 미식별로 나오고 과제를 체크하지 않는다', async () => {
      await fresh();
      W.ev(`localStorage.setItem('tc_rptMNcMap:7', JSON.stringify({ ${JSON.stringify(K_EXT)}: ${JSON.stringify(P4)}, ${JSON.stringify(K_TBD)}: 'etc' }));`);
      await readWeek2(true);
      assert.deepStrictEqual(unidKeys().sort(), [K_EXT, K_TBD].sort(), '예전 기억한 이관이 머리를 옮겼다');
      assert.ok(!actualOf(W, P4).includes('외부 지원 일') && !W.ev(`!!__rptM.checked[${JSON.stringify(P4)}]`), '예전 기억으로 과제에 글이 붙거나 체크됐다');
      assert.ok(!/외부 지원 일|미정 업무 일/.test(payloadText()), '예전 기억으로 문서에 들어갔다');
      assert.ok(!$id(W, 'rptmUnid').textContent.includes('기억한 이관'), '기억한 이관 목록이 남았다');
      W.doc.querySelector('#rptSrcSeg [data-rsrc="cal"]').click(); await tick();
      await readAgain(W);
      clearStore(W);
    });

    //  2026-11-10(docs/MONTHLY-HEAD-MAPPING.md 결정 4, 5): 미식별 줄마다 넣을 곳 콤보. 처음은 넣지 않음, 공식 과제는 그 실적 뒤에 붙고 체크, 기타는 기타 표 뒤, 기억 없음
    const unidRow = (k) => [...W.doc.querySelectorAll('#rptmUnid [data-unid-key]')].find((r) => r.dataset.unidKey === k) || null;
    const unidSel = (k) => unidRow(k).querySelector('select[data-unid-to]');
    const unidPick = (k, v) => { const s = unidSel(k); s.value = v; s.dispatchEvent(new W.w.Event('change', { bubbles: true })); };
    const unidCnt = () => $id(W, 'rptmUnid').querySelector('.rptm-unid > summary .rptm-cnt').textContent;
    //  고른 것이 payload 에 들어가는지(변이 MWM1 이 같은 검사기를 쓴다)
    function unidPayloadCheck() {
      W.ev(`__rptM.unidTo.clear(); __rptM.unidTo.set(${JSON.stringify(K_EXT)}, ${JSON.stringify(P1)}); __rptM.unidTo.set(${JSON.stringify(K_TBD)}, 'etc');`);
      try {
        const p = payloadOf(W), a1 = (p.projects.find((x) => x.uid === P1) || { actual: [] }).actual.map((l) => l.text).join('\n'), et = p.etc.lines.map((l) => l.text).join('\n');
        assert.ok(a1.includes('사업명 일') && a1.indexOf('외부 지원 일') > a1.indexOf('사업명 일'), '공식 과제로 고른 미식별 글이 payload 의 그 과제 실적 뒤에 없다');
        assert.ok(et.includes('교육 일') && et.indexOf('미정 업무 일') > et.indexOf('교육 일'), '기타로 고른 미식별 글이 payload 의 기타 뒤에 없다');
      } finally { W.ev('__rptM.unidTo.clear();'); }
    }
    test('MW23 (MONTHLY-HEAD-MAPPING 결정 4, 5): 미식별 콤보: 처음 넣지 않음(문서에 없음), 공식 과제는 실적 뒤에 붙고 체크, 기타는 기타 표 뒤, 되돌리면 빠짐, 콤보는 줄을 접고 펴지 않음, 저장소에 안 씀, 같은 기간 다시 읽기는 남고 기간을 바꾸면 처음 값', async () => {
      await fresh();
      await readWeek2(true);
      const n0 = lsMark(W);
      assert.ok(!/외부 지원 일|미정 업무 일/.test(payloadText()) && unidCnt() === '문서에 넣지 않음', '처음 값이 넣지 않음이 아니다');
      assert.deepStrictEqual([...unidSel(K_EXT).options].map((o) => [o.value, o.textContent]),
        [['', '넣지 않음'], ...W.evJSON('rptMOfficial().map(function(c){ return [c.id, rptMCatName(c.id)]; })'), ['etc', '기타']], '콤보 선택지가 넣지 않음, 내 공식 과제 순서, 기타가 아니다');
      assert.ok(!W.ev(`!!__rptM.checked[${JSON.stringify(P4)}]`), '전제: 기록 없는 과제는 처음에 체크가 아니다');
      //  칸과 줄을 펼쳐 두고 고른다. 콤보는 summary 밖이고, 눌러도 줄이 접히거나 펴지지 않는다
      const sec = $id(W, 'rptmUnid').querySelector('details[data-unid]'); sec.open = true;
      const it = unidRow(K_EXT).querySelector('details.rptm-ui'); it.open = true;
      const sel = unidSel(K_EXT);
      assert.ok(!sel.closest('summary') && !sel.closest('details.rptm-ui'), '콤보가 줄의 summary 나 details 안에 있다');
      sel.dispatchEvent(new W.w.MouseEvent('click', { bubbles: true }));
      assert.strictEqual(it.open, true, '콤보를 누르니 줄이 접혔다');
      unidPick(K_EXT, P4);
      const p4 = () => (payloadOf(W).projects.find((x) => x.uid === P4) || { actual: [] }).actual.map((l) => l.text).join('\n');
      assert.ok(W.ev(`!!__rptM.checked[${JSON.stringify(P4)}]`) && row(W, P4).querySelector('[data-act="pick"]').checked && !row(W, P4).classList.contains('off'), '공식 과제를 고르니 그 과제가 체크되지 않았다');
      assert.ok(p4().includes('외부 지원 일'), '공식 과제로 고른 글이 그 카드 실적에 없다');
      const noRec = () => row(W, P4).querySelector('.rptm-none');
      assert.ok(noRec() && noRec().classList.contains('hidden'), '미식별 글을 받은 과제에 기록 없음이 남았다');
      assert.ok(pvTable(W, P4) && pvTable(W, P4).textContent.includes('외부 지원 일'), '미리 보기가 바로 바뀌지 않았다');
      assert.strictEqual(unidCnt(), '1개 넣음', '칸 머리가 n개 넣음이 아니다');
      assert.ok(unidSel(K_EXT) === sel && it.isConnected && it.open && sec.open, '콤보를 바꾸니 칸을 다시 그려 포커스나 펼침을 잃었다');
      unidPick(K_TBD, 'etc');
      const et = payloadOf(W).etc.lines.map((l) => l.text).join('\n');
      assert.ok(et.indexOf('미정 업무 일') > et.indexOf('교육 일') && et.includes('교육 일'), '기타로 고른 글이 기타 표 뒤에 붙지 않았다');
      assert.strictEqual(unidCnt(), '2개 넣음');
      unidPick(K_EXT, '');
      assert.ok(!p4().includes('외부 지원 일') && !payloadText().includes('외부 지원 일'), '넣지 않음으로 되돌렸는데 글이 남았다');
      assert.ok(noRec() && !noRec().classList.contains('hidden'), '넣지 않음으로 되돌렸는데 기록 없음이 다시 보이지 않는다');
      assert.strictEqual(unidCnt(), '1개 넣음');
      unidPayloadCheck();
      unidPick(K_TBD, 'etc');
      assert.deepStrictEqual(lsSince(W, n0), [], '미식별 고르기가 저장소에 썼다(기억하지 않아야 한다)');
      //  같은 기간 다시 읽기: 남는다
      await readWeek2(false);
      assert.ok(unidSel(K_TBD).value === 'etc' && payloadText().includes('미정 업무 일'), '같은 기간 다시 읽으니 고른 것이 사라졌다');
      //  기간을 바꿔 읽으면 처음 값(같은 머리가 다시 나와도)
      $id(W, 'rptFrom').value = '2026-08-01'; $id(W, 'rptTo').value = '2026-08-31';
      $id(W, 'asLoad').click(); await tick(); await tick();
      reply(W, 'netcusWeeklyRangeRead', { ok: true, error: '', weeks: WEEKS2 }); await tick(); drainImages(W);
      assert.ok(W.ev('__rptM.unidTo.size') === 0 && unidSel(K_TBD).value === '' && !payloadText().includes('미정 업무 일') && unidCnt() === '문서에 넣지 않음', '기간을 바꿨는데 고른 것이 남았다');
      //  다시 열어도 처음 값
      unidPick(K_TBD, 'etc'); reopen(W); await tick(); drainImages(W);
      assert.strictEqual(W.ev('__rptM.unidTo.size'), 0, '다시 열었는데 고른 것이 남았다');
      assert.deepStrictEqual(lsSince(W, n0), [], '미식별 흐름이 저장소에 썼다');
      W.doc.querySelector('#rptSrcSeg [data-rsrc="cal"]').click(); await tick();
      await fresh();
    });
    test('변이 MWM1: payload 가 고른 미식별(unidTo)을 무시하면 MW23 의 payload 검사가 잡는다', async () => {
      await fresh();
      await readWeek2(true);
      unidPayloadCheck();   //  전제: 원본은 통과한다
      const orig = extractFunction(app, 'rptMPayload');
      const bad = mutate(mutate(orig, "join(auto.proj.get(id) || '', rptMUnidText(S, auto, id))", "(auto.proj.get(id) || '')"), "join(rptMEtcText(S, auto), rptMUnidText(S, auto, 'etc'))", 'rptMEtcText(S, auto)');
      W.ev(bad);
      try { assert.throws(() => unidPayloadCheck(), /payload/); } finally { W.ev(orig); }
      unidPayloadCheck();   //  되돌렸다
      W.doc.querySelector('#rptSrcSeg [data-rsrc="cal"]').click(); await tick();
      await fresh();
    });

    test('MW12 (§5.2): 주간보고를 못 읽으면(로그인 없음, 400일 넘음, 시간 초과, 주간보고 기록 읽기 실패) 이유를 보이고, 읽어 둔 글과 미리 보기는 그대로다', async () => {
      await fresh();
      const a0 = actualOf(W, P1);
      assert.ok(a0.includes('화면 응답 속도 개선'), '전제: 캘린더 기록 실적이 읽혀 있다');
      W.doc.querySelector('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
      $id(W, 'asLoad').click(); await tick();
      reply(W, 'netcusWeeklyRangeRead', { ok: false, error: 'no-creds', weeks: [] }); await tick(); drainImages(W);
      assert.ok($id(W, 'rptmSrcMsg').textContent.includes('netcus 로그인 정보가 없습니다'), '로그인 없음 이유를 보이지 않는다');
      assert.strictEqual(actualOf(W, P1), a0, '실패했는데 실적이 바뀌었다(읽어 둔 글은 그대로여야 한다)');
      assert.ok(!$id(W, 'asLoad').disabled, '실패한 뒤 읽어 오기가 풀리지 않았다');
      //  400일 넘는 기간: 호스트에 묻지 않는다(인트라넷 주간만의 한도)
      const n0 = W.posted.filter((x) => x && x.cmd === 'netcusWeeklyRangeRead').length;
      await loadPeriod(W, '2025-01-01', '2026-03-01'); await tick(); drainImages(W);
      assert.strictEqual(W.posted.filter((x) => x && x.cmd === 'netcusWeeklyRangeRead').length, n0, '400일 넘는 기간을 호스트에 물었다');
      assert.ok($id(W, 'rptmSrcMsg').textContent.includes('400일'), '400일 한도 안내가 없다');
      //  시간 초과
      await loadPeriod(W, FROM, TO); drainImages(W);
      W.doc.querySelector('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
      $id(W, 'asLoad').click(); await tick();
      //  읽는 동안 저장은 막는다
      $id(W, 'rptmSave').click(); await tick();
      assert.strictEqual(pending(W, 'exportMonthlyDocx').length, 0, '주간보고를 읽는 동안 저장했다');
      reply(W, 'netcusWeeklyRangeRead', { ok: false, error: '호스트 응답 시간 초과', timeout: true }); await tick(); drainImages(W);
      assert.ok($id(W, 'rptmSrcMsg').textContent.includes('시간이 지났습니다'), '시간 초과 안내가 없다');
      //  이 앱 주간보고 기록 읽기 실패(캘린더 기록): 이유를 그대로, 읽어 둔 글은 그대로
      W.doc.querySelector('#rptSrcSeg [data-rsrc="cal"]').click(); await tick();
      await readAgain(W);
      const a1 = actualOf(W, P1);
      assert.ok(a1.includes('화면 응답 속도 개선'), '전제: 다시 읽었다');
      weekly.fail = { ok: false, error: '서버에 연결할 수 없습니다.' };
      try {
        await readAgain(W);
        assert.ok($id(W, 'rptmSrcMsg').textContent.includes('주간보고 기록을 읽지 못했습니다') && $id(W, 'rptmSrcMsg').textContent.includes('서버에 연결할 수 없습니다.'), '기록 읽기 실패 이유를 보이지 않는다');
        assert.strictEqual(actualOf(W, P1), a1, '기록 읽기에 실패했는데 읽어 둔 글이 바뀌었다');
      } finally { weekly.fail = null; }
      await fresh();
    });

    test('MW13 (§10.1, §10.3): 월간 흐름 전체에서 회사로 보내는 명령과 함수는 0회(가로채기), 나간 명령은 RPTM_HOST_CMDS 와 기존 부팅 명령뿐', async () => {
      W.ev("window.__sent = []; Platform.report.submitDaily = function(){ __sent.push('daily'); }; Platform.report.submitWeekly = function(){ __sent.push('weekly'); };");
      const ln0 = W.posted.length;
      await fresh();
      W.doc.querySelector('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
      $id(W, 'asLoad').click(); await tick();
      reply(W, 'netcusWeeklyRangeRead', { ok: true, error: '', weeks: WEEKS }); await tick(); drainImages(W);
      row(W, P1).querySelector('[data-act="imgTog"]').click(); await tick();
      check(W, W.doc.querySelector('#rptmEtc input[data-etc="c-ed"]'), false); await tick();
      $id(W, 'rptmSave').click(); await tick();
      reply(W, 'exportMonthlyDocx', { ok: false, cancelled: true }); await tick();
      reopen(W); await tick(); drainImages(W);
      const allowed = new Set(W.evJSON('RPTM_HOST_CMDS'));
      const sent = W.posted.slice(ln0).map((x) => x && x.cmd).filter(Boolean);
      assert.deepStrictEqual(W.evJSON('__sent'), [], 'Platform.report 가 불렸다');
      for (const bad of ['netcusSubmit', 'netcusWeekSubmit']) assert.ok(!sent.includes(bad), '회사로 보내는 명령이 나갔다: ' + bad);
      const extra = [...new Set(sent.filter((c) => !allowed.has(c)))];
      assert.ok(extra.every((c) => !/netcus|report|submit/i.test(c)), '월간 흐름에서 목록 밖 보고 명령이 나갔다: ' + extra.join(', '));
      W.ev("state.reportSource = 'cal'; __rptMImgOpen.clear();");
      await fresh();
    });

    test('MW14 (§5.1): 과제별 글 쪽은 그대로: 월간 보고 문서를 다녀와도 과제별 글, 기간, 복사 단추, 출처, 서식이 같다', async () => {
      await fresh();
      W.ev("atSumOutSet('text');");
      setVal(W, $id(W, 'rptFrom'), '2026-09-01', 'change'); setVal(W, $id(W, 'rptTo'), '2026-09-30', 'change'); drainImages(W);
      await readAgain(W);
      W.ev('buildReport();');
      const snap = () => ({ copy: W.ev('buildReportText()'), out: $id(W, 'rptOut').innerHTML, sum: $id(W, 'rptSummary').textContent, period: [$id(W, 'rptFrom').value, $id(W, 'rptTo').value],
        src: W.ev('state.reportSource'), seg: W.doc.querySelector('#rptSrcSeg .seg-b.active').dataset.rsrc, fmt: W.evJSON('currentReportFormatPref()'), copyBtn: $id(W, 'btnRptCopy').classList.contains('hidden') });
      const s0 = snap();
      assert.ok(s0.copy.includes('화면 응답 속도 개선') && !s0.copyBtn, '전제: 과제별 글이 만들어졌고 복사 단추가 보인다');
      W.ev("atSumOutSet('doc');"); await tick(); drainImages(W);
      assert.ok($id(W, 'btnRptCopy').classList.contains('hidden') && !$id(W, 'asDocAct').classList.contains('hidden'), '월간 문서 형태에서 복사 단추가 숨고 DOCX 저장 단추가 보여야 한다');
      W.ev("atSumOutSet('text');"); await tick();
      assert.deepStrictEqual(snap(), s0, '월간 문서를 다녀오니 과제별 글 쪽(글, 기간, 출처, 서식, 단추)이 바뀌었다');
      assert.ok($id(W, 'asDocAct').classList.contains('hidden'), '과제별 글로 돌아왔는데 DOCX 저장 단추가 남았다');
      //  회사로 보내는 길(보내기 단추)은 없다
      assert.ok(!$id(W, 'btnRptSend') && !$id(W, 'rptSendStatus'), '보내기 단추나 보낸 상태 표시가 남아 있다');
      await fresh();
    });

    test('MW15 (§5.3, B안): 문서 미리 보기는 오른쪽 칸(결과 형태가 문서일 때)에 보이고 읽기만 한다. payload 와 같은 값(과제명, 기간, 그림 칸, 실적 줄, 빈 계획, 기타), 머리와 상태 줄의 개수', async () => {
      await fresh();
      assert.ok(!$id(W, 'rptmPv').classList.contains('hidden') && !$id(W, 'asDoc').classList.contains('hidden') && $id(W, 'asRight').contains($id(W, 'rptmPv')) && !$id(W, 'asLeft').contains($id(W, 'rptmPv')) && !$id(W, 'rptmPvBtn'), '미리 보기가 오른쪽 칸에 보이지 않거나 켜기 버튼이 남았다');
      assert.strictEqual($id(W, 'rptmPvSum').textContent, '과제 3개, 기타 표', '미리 보기 머리의 개수가 다르다');
      const sheet = $id(W, 'rptmSheet');
      const p = payloadOf(W);
      assert.ok(sheet.textContent.includes('월간보고 (시험자)') && sheet.textContent.includes('월간 실적: 09월 01일 ~ 09월 30일') && sheet.textContent.includes('2025/08 ~ 2026/12'), '미리 보기 머리가 다르다');
      for (const pr of p.projects) {
        const t = pvTable(W, pr.uid);
        assert.ok(t, '미리 보기에 과제 표가 없다: ' + pr.uid);
        assert.strictEqual(t.querySelector('td.nm').textContent, pr.title);
        assert.deepStrictEqual([...t.querySelectorAll('[data-pv="actual"] .ln')].map((x) => x.textContent), pr.actual.length ? pr.actual.map((l) => l.text) : [''], '미리 보기 실적 줄이 payload 와 다르다');
      }
      assert.deepStrictEqual([...sheet.querySelectorAll('table[data-pv-etc] td.body .ln')].map((x) => x.textContent), p.etc.lines.map((l) => l.text), '미리 보기 기타가 payload 와 다르다');
      assert.strictEqual(sheet.querySelectorAll('input, textarea, button, [contenteditable]').length, 0, '미리 보기에 조작 칸이 있다');
      //  아무것도 안 고르면 안내
      W.ev('__rptM.order.forEach(function(id){ __rptM.checked[id] = false; }); rptMEtcCats().forEach(function(c){ __rptM.etcOff.add(c.key); }); rptMPreview();');
      assert.ok(!$id(W, 'rptmPvEmpty').classList.contains('hidden'), '고른 과제가 없을 때 안내가 없다');
      await fresh();
      assert.ok($id(W, 'rptmPvEmpty').classList.contains('hidden'));
    });

    test('MW19 (§5, 2026-11-03 결정): 취합 화면의 두 칸 구조(왼쪽 기간, 출처, 서식, 읽어 오기만 / 오른쪽 결과 형태, 그 아래 문서 설정 띠, 미리 보기)와 가운데 끌개, 종이 배율은 칸 폭에 맞춘다', async () => {
      await fresh();
      const left = $id(W, 'asLeft'), right = $id(W, 'asRight');
      const main = W.doc.querySelector('#atView .as-view .as-main');
      assert.ok(main && left.parentElement === main && right.parentElement === main, '취합 화면이 왼쪽 칸과 오른쪽 칸 둘로 나뉘지 않았다');
      const split = main.querySelector('.as-split[data-atsplit="s"]');
      assert.ok(split && (left.compareDocumentPosition(split) & 4) && (split.compareDocumentPosition(right) & 4), '왼쪽 칸과 오른쪽 칸 사이에 끌개가 없다');
      for (const id of ['rptFrom', 'rptTo', 'rptSrcSeg', 'asLoad']) assert.ok(left.contains($id(W, id)), '왼쪽 칸에 없다: ' + id);
      for (const id of ['asBand', 'rptmPFrom', 'rptmPTo', 'rptmPlanDef', 'rptmDate', 'rptmName', 'rptmPick', 'rptmPickCnt', 'rptmEtc', 'rptmEtcTog', 'rptmUnid']) assert.ok(right.contains($id(W, id)) && !left.contains($id(W, id)), '문서 설정은 오른쪽 띠에 있어야 한다: ' + id);
      for (const id of ['asOut', 'btnRptCopy', 'rptmSave', 'rptmOpenDir', 'rptmSheet', 'rptOut']) assert.ok(right.contains($id(W, id)) && !left.contains($id(W, id)), '오른쪽 칸에 없거나 왼쪽 칸에 있다: ' + id);
      assert.ok(($id(W, 'asOut').compareDocumentPosition($id(W, 'asBand')) & 4) && ($id(W, 'asBand').compareDocumentPosition($id(W, 'rptmPv')) & 4), '문서 설정 띠가 결과 형태 탭 아래, 미리 보기 위에 있지 않다');
      assert.ok(!left.querySelector('.rptm-set, .rptm-list, .rptm-etc, .rptm-unid'), '왼쪽에 월간 설정 칸이 남았다');
      assert.ok(($id(W, 'rptmPFrom').compareDocumentPosition($id(W, 'rptmPick')) & 4), '월간 문서 설정(계획, 작성일)이 과제 목록 위에 있지 않다');
      assert.ok(($id(W, 'asOut').compareDocumentPosition($id(W, 'rptmSheet')) & 4), '결과 형태 탭이 미리 보기 위에 있지 않다');
      //  종이 배율: 칸 폭(안쪽 여백 20px 뺌) / 1000, 1 을 넘지 않는다. 칸이 숨어 폭이 0 이면 그대로 둔다
      const wrap = $id(W, 'rptmPvWrap'), sheet = $id(W, 'rptmSheet');
      assert.ok(sheet.classList.contains('fit'), '미리 보기 종이에 맞춤(fit)이 없다');
      for (const [cw, want] of [[520, '0.500'], [2000, '1.000']]) {
        Object.defineProperty(wrap, 'clientWidth', { value: cw, configurable: true });
        W.ev('rptMFit()');
        assert.strictEqual(sheet.style.getPropertyValue('--fz'), want, '종이 배율이 칸 폭에 맞지 않는다: ' + cw);
      }
      Object.defineProperty(wrap, 'clientWidth', { value: 0, configurable: true });
      W.ev('rptMFit()');
      assert.strictEqual(sheet.style.getPropertyValue('--fz'), '1.000', '숨은 칸(폭 0)에서 배율을 바꿨다');
      delete wrap.clientWidth;
    });

    test('MW20 (§5, B안): 왼쪽에서 바꾸면 미리 보기가 바로 바뀐다(과제 체크, 기타 칩, 읽어 오기 뒤 기간, 계획 기간, 작성일)', async () => {
      await fresh();
      const sheetText = () => $id(W, 'rptmSheet').textContent;
      check(W, row(W, P2).querySelector('input[data-act="pick"]'), false);
      assert.ok(!pvTable(W, P2) && !sheetText().includes('관측 자료 수신 모듈 정리'), '과제 체크를 끈 것이 미리 보기에 바로 보이지 않는다');
      check(W, row(W, P2).querySelector('input[data-act="pick"]'), true);
      assert.ok(pvTable(W, P2) && sheetText().includes('관측 자료 수신 모듈 정리'), '과제 체크를 켠 것이 미리 보기에 바로 보이지 않는다');
      check(W, W.doc.querySelector('#rptmEtc input[data-etc="c-in"]'), false);
      assert.ok(!sheetText().includes('주간 회의 자료 정리'), '기타 칩을 뺀 것이 미리 보기에 바로 보이지 않는다');
      check(W, W.doc.querySelector('#rptmEtc input[data-etc="c-in"]'), true);
      assert.ok(sheetText().includes('주간 회의 자료 정리'), '기타 칩을 넣은 것이 미리 보기에 바로 보이지 않는다');
      setVal(W, $id(W, 'rptmPFrom'), '2026-10-05', 'change'); setVal(W, $id(W, 'rptmPTo'), '2026-11-13', 'change');
      assert.ok(sheetText().includes('월간 계획: 10월 05일 ~ 11월 13일'), '계획 기간이 미리 보기 머리에 바로 보이지 않는다');
      setVal(W, $id(W, 'rptmDate'), '2026-10-22', 'change');
      assert.ok(sheetText().includes('2026년 10월 22일'), '작성일이 미리 보기 제목에 바로 보이지 않는다');
      //  기간 칸에 값만 넣고(change 없이) 읽어 오기를 누르면 그때 새 기간으로 바뀐다
      $id(W, 'rptFrom').value = '2026-08-01'; $id(W, 'rptTo').value = '2026-08-31';
      assert.ok(sheetText().includes('월간 실적: 09월 01일 ~ 09월 30일'), '읽어 오기 전에 기간이 바뀌었다');
      await readAgain(W);
      assert.ok(sheetText().includes('월간 실적: 08월 01일 ~ 08월 31일') && sheetText().includes('기간 밖 일'), '읽어 오기 뒤 미리 보기가 새 기간으로 바뀌지 않았다');
      //  날짜 칸을 고르면(change) 월간 문서도 그 기간으로 바로 새로 열린다(요청은 나가지 않는다)
      setVal(W, $id(W, 'rptFrom'), '2026-07-01', 'change'); setVal(W, $id(W, 'rptTo'), '2026-07-31', 'change'); drainImages(W);
      //  읽어 둔 글이 없어 과제 표가 없으니(머리는 표 안에 있다) 새로 연 상태로 본다
      assert.deepStrictEqual(W.evJSON('[__rptM.from, __rptM.to, rptMAuto(__rptM)]'), ['2026-07-01', '2026-07-31', null], '기간 칸을 고쳤는데 월간 문서가 새 기간으로 새로 열리지 않았다');
      assert.ok(!$id(W, 'rptmPvEmpty').classList.contains('hidden') && $id(W, 'rptmSheet').textContent.includes('월간보고'), '읽기 전 미리 보기가 안내와 제목만이 아니다');
      await fresh();
    });

    test('MW16: 정리', async () => { clearStore(W); await W.close(); });
  }

  // ── (B) 브라우저 모드 ───────────────────────────────────────────────
  let B = null, bErr = null;
  try { B = bootBrowser(app); } catch (e) { bErr = e; }
  if (bErr) {
    test('MB0: 브라우저 모드 부팅', () => { throw bErr; });
  } else {
    test('MB1 (§5, 9번): 브라우저만 있을 때: 위젯 안내, 저장과 주간보고 읽기와 그림 막힘, 달력 일정은 취합에 나오지 않는다', async () => {
      clearStore(B);
      B.ev('state = ' + JSON.stringify(stateFor()) + ';');
      openSum(B); await tick();
      await loadPeriod(B, FROM, TO);
      assert.ok(!$id(B, 'rptmHostNote').classList.contains('hidden'), '위젯 안내가 보이지 않는다');
      assert.ok($id(B, 'rptmSave').disabled, '브라우저에서 저장이 열려 있다');
      assert.ok(row(B, P1) && !B.doc.querySelector('#rptmPick [data-imgtog], #rptmPick [data-strip]'), '브라우저에서 그림 단추가 있다');
      //  캘린더 기록(이 앱 주간보고 DB)과 인트라넷 주간(회사 사이트)은 둘 다 위젯에서만 읽는다: 읽어 오기를 눌러도 호스트 요청 없이 이유를 보인다
      assert.ok($id(B, 'rptmSrcMsg').textContent.includes('위젯에서만') && B.ev('__rptM.src') === 'cal', '브라우저의 캘린더 기록 안내가 없다');
      B.doc.querySelector('#rptSrcSeg [data-rsrc="week"]').click(); await tick();
      $id(B, 'asLoad').click(); await tick(); await tick();
      assert.ok($id(B, 'rptmSrcMsg').textContent.includes('위젯에서만') && B.ev('__rptM.src') === 'week' && B.ev('state.reportSource') === 'week', '브라우저의 주간보고 출처 안내가 없다');
      assert.ok(!B.posted.length || !B.posted.some((x) => x && (/^scheduleImage/.test(x.cmd || '') || x.cmd === 'reportWeeklyList' || x.cmd === 'netcusWeeklyRangeRead')), '브라우저에서 그림이나 주간보고 읽기 명령을 보냈다');
      //  달력에 일정이 있어도 취합 글은 읽어 올 때까지 비어 있다(일정과 할 일을 모으지 않는다)
      assert.ok(B.ev('rptMAuto(__rptM)') === null, '브라우저에서 읽지 않았는데 실적이 모였다');
      assert.ok($id(B, 'rptOut').textContent.includes('읽어 오기를 눌러 주세요') && !$id(B, 'rptmSheet').textContent.includes('화면 응답 속도 개선'), '브라우저에서 달력의 일정이 취합 미리 보기에 나온다');
      B.ev('rptMSave()'); await tick();
      assert.ok(B.evJSON('__toasts').some((t) => t.includes('위젯에서만')), '브라우저 저장 시도에 안내가 없다');
      clearStore(B);
      await B.close();
    });
  }
}
