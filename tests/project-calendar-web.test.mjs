// 과제 공용 캘린더 P2: 과제 탭 화면(docs/PROJECT-CALENDAR-PLAN.md §6, §6.6, 시안 docs/prototypes/project-calendar.html 2차).
//
// 이 파일이 지키는 것:
//   (S) 정적: 웹 글자 상한(PCAL_LIMITS)이 호스트 상수(ProjectCalendarDb.Limits)와 DDL 칸 폭, 입력 칸 maxlength 와 같다.
//       보내는 명령은 여섯뿐(호스트 Commands 와 같은 목록)이고 pcReq 한 문으로만 나간다. 열람 창과 관리 창 목록에 없다.
//       주기 확인(setInterval)이 없다. 장애 띠 자리는 탭 줄 아래. 전역 Esc 와 방향키가 과제 탭을 안다. 기호 규칙.
//   (P) 순수 계산(node:vm): 막대 차선 배치, 주 경계 자르기, 정렬 고정, 윤년과 같은 날짜와 366일, 월간 보이는 차선 수,
//       범위, 설정(설정 없음과 빈 선택 구분), 선택 맞추기, 메모 첫 줄, DTO 왕복, 폼 검사, 변경 이력의 전과 후.
//   (R) jsdom(위젯 모드, 가짜 호스트): 탭 전환이 숨기고 보이는 것, 탭 진입과 새로고침과 창 복귀의 읽기, 늦은 회신 버리기,
//       글자로만 그리기, 메모 첫 줄을 켜도 보이는 수가 같음, 그날 일정 목록과 [수정], 미리보기 [수정], 폼 검사와 저장,
//       충돌(최신 내용 확인, 내 입력 유지), 최근 변경의 종류 필터와 더 보기, 개인 일정에 등록과 개인 탭 배지,
//       계정별 설정, 열람 창과 관리 창과 브라우저에서는 보내지 않음.
//   (M) 변이: 핵심 줄을 빼면 위 검사가 잡는다.
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다(러너 exit 2).
import vm from 'node:vm';
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM, readText } from './harness.mjs';

const src = loadAppSource();
const R = (p) => new URL('../' + p, import.meta.url);
const hostCs = readText(R('widget/ProjectCalendarDb.cs'));
const canon = readText(R('db/deploy/schema-calendar.sql'));

function mutate(from, to, base = src) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}
//  과제 탭 모듈 구역(상수부터 호스트 다리 앞까지).
function moduleOf(app) {
  const a = app.indexOf('const PCAL_LIMITS = '), b = app.indexOf('/* 호스트(WPF) 비동기 요청/응답 브리지');
  assert.ok(a > 0 && b > a, '과제 탭 모듈 구역(PCAL_LIMITS ~ 호스트 다리)을 찾지 못했다');
  return app.slice(a, b);
}
const PUNCT = [[/—/, '엠 대시'], [/–/, 'en 대시'], [/「|」/, '낫표'], [/(^|\s)·|·(\s|$)/, '띄어 쓴 가운데 점']];
const punctBad = (t) => PUNCT.filter(([re]) => re.test(t)).map(([, n]) => n);

/* ── (S) 정적 ─────────────────────────────────────────────────────────── */
const statics = {
  limits(app) {
    const web = /const PCAL_LIMITS = Object\.freeze\(\{ title: (\d+), location: (\d+), memo: (\d+) \}\);/.exec(app);
    assert.ok(web, '웹 글자 상한 상수 PCAL_LIMITS 가 없다(한 곳에 두어야 한다)');
    const host = (k) => { const m = new RegExp(`public const int ${k} = (\\d+);`).exec(hostCs); assert.ok(m, `호스트 Limits.${k} 가 없다`); return Number(m[1]); };
    assert.deepStrictEqual([+web[1], +web[2], +web[3]], [host('Title'), host('Location'), host('Memo')], '웹 글자 상한이 호스트 ProjectCalendarDb.Limits 와 다르다');
    const ev = /CREATE TABLE cal_project_event \(([\s\S]*?)\) ENGINE=/.exec(canon);
    assert.ok(ev, '정본에 cal_project_event 가 없다');
    const width = (col) => { const m = new RegExp(`\\n\\s+${col}\\s+VARCHAR\\((\\d+)\\)`).exec(ev[1]); assert.ok(m, `DDL ${col} 폭을 찾지 못했다`); return Number(m[1]); };
    assert.strictEqual(width('title'), +web[1], 'DDL title 폭이 웹 상한과 다르다');
    assert.strictEqual(width('location'), +web[2], 'DDL location 폭이 웹 상한과 다르다');
    const ml = (id) => { const m = new RegExp(`id="${id}"[^>]*maxlength="(\\d+)"`).exec(app); assert.ok(m, `#${id} 에 maxlength 가 없다`); return Number(m[1]); };
    assert.deepStrictEqual([ml('pcfTitle'), ml('pcfLoc'), ml('pcfMemo')], [+web[1], +web[2], +web[3]], '입력 칸 maxlength 가 글자 상한과 다르다');
  },
  commands(app) {
    const m = moduleOf(app);
    const web = /const PCAL_CMDS = Object\.freeze\(\[([^\]]*)\]\);/.exec(m);
    assert.ok(web, 'PCAL_CMDS 가 없다');
    const list = [...web[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
    const hostList = /internal static readonly string\[\] Commands =\s*\{([^}]*)\}/.exec(hostCs);
    assert.ok(hostList, '호스트 Commands 목록을 찾지 못했다');
    assert.deepStrictEqual(list, [...hostList[1].matchAll(/"(\w+)"/g)].map((x) => x[1]), '웹 명령 목록이 호스트 Commands 와 다르다');
    //  모듈 안에서 호스트로 나가는 길은 pcReq 하나다. 다른 곳에서 hostRequest 나 hpost 를 부르지 않는다.
    const hr = [...m.matchAll(/\bhostRequest\(/g)].length, hp = [...m.matchAll(/\bhpost\(/g)].length;
    assert.strictEqual(hr, 1, `과제 탭 모듈이 hostRequest 를 ${hr}곳에서 부른다(pcReq 한 곳이어야 한다)`);
    assert.strictEqual(hp, 0, '과제 탭 모듈이 hpost 로 직접 보낸다');
    assert.ok(/hostRequest\(cmd, params \|\| \{\}, ms \|\| 20000\)/.test(extractFunction(m, 'pcReq')), 'hostRequest 를 부르는 곳이 pcReq 가 아니다');
    assert.ok(/if\(PCAL_CMDS\.indexOf\(cmd\) < 0\) return/.test(extractFunction(m, 'pcReq')), 'pcReq 가 목록 밖 명령을 거르지 않는다');
    assert.ok(/if\(!HOST \|\| PEER \|\| SUBWIN\) return/.test(extractFunction(m, 'pcReq')), 'pcReq 가 열람 창, 따로 뜬 창, 브라우저에서 보낸다');
    const sent = new Set([...m.matchAll(/pcReq\('(\w+)'/g)].map((x) => x[1]));
    for (const c of sent) assert.ok(list.includes(c), `목록 밖 명령 ${c} 를 보낸다`);
    assert.deepStrictEqual([...sent].sort(), [...list].sort(), '여섯 명령 중 쓰지 않는 것이 있다(또는 이름이 다르다)');
    //  관리 창과 열람 창의 웹 허용 목록에 없다(호스트도 같은 목록으로 거른다, project-calendar-host 시험).
    for (const set of ['ADMINWIN_CMD', 'PEERWIN_CMD', 'PEER_SILENT_CMD']) {
      const b = new RegExp(`const ${set} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(app);
      assert.ok(b, `${set} 를 찾지 못했다`);
      for (const c of list) assert.ok(!b[1].includes(`'${c}'`), `${set} 에 ${c} 가 들어갔다`);
    }
    assert.ok(/if\(PEER \|\| SUBWIN\)\{ if\(tabs\) tabs\.remove\(\); return; \}/.test(extractFunction(m, 'pcInit')), '열람 창과 따로 뜬 창에서 탭 줄을 지우지 않는다');
  },
  wiring(app) {
    const m = moduleOf(app);
    assert.ok(!/setInterval\(/.test(m), '과제 탭이 주기 확인(setInterval)을 한다(OFFLINE-RESILIENCE A11, 기획 §5.6)');
    const ins = extractFunction(app, 'insertBelowTitleBar');
    assert.ok(/document\.getElementById\('pcTabs'\) \|\| document\.querySelector\('header\.topbar'\)/.test(ins), '장애 띠 자리가 탭 줄 아래가 아니다(기획 §6.3)');
    assert.ok(/if\(pcEscape\(\)\)\{ ev\.preventDefault\(\); return; \}/.test(app), '전역 Esc 목록에 과제 탭 팝오버가 없다');
    assert.ok(/if\(pcOn\(\)\)\{ pcKeyNav\(ev\.key\); return; \}/.test(app), '과제 탭에서 방향키가 개인 달력을 움직인다');
    assert.ok(/\$\{pcCopyBadge\(e\.id\)\}/.test(extractFunction(app, 'cardHtml')), '개인 카드에 복사 배지 자리가 없다');
    assert.ok(/if\(!PEER\) pcOnBootApplied\(\);/.test(app), '부팅 주입이 과제 탭에 계정을 알리지 않는다');
    assert.ok(/ov\.id==='pcFormModal'/.test(extractFunction(app, 'isGuardedModal')), '과제 일정 폼이 닫기 확인(Esc, 배경 누름) 대상이 아니다');
    assert.ok(/<section class="pc-view" id="pcView"/.test(app) && /<div class="pc-tabs" id="pcTabs" role="tablist"/.test(app), '탭 줄이나 과제 화면 자리가 마크업에 없다');
    const css = app.slice(app.indexOf('<style>'), app.indexOf('</style>'));
    for (const sel of ['body.pc-on #filterbar', 'body.pc-on main > .cal', 'body.pc-on #dayPanel', 'body.pc-on .topbar .nav', 'body.pc-on #btnSearch',
      'body.pc-on #btnPeerPick', 'body.pc-on #btnReportTop', 'body.pc-on #btnNew']) assert.ok(css.includes(sel), `과제 탭에서 ${sel} 를 숨기지 않는다`);
    assert.ok(!/공식 과제 추가/.test(m), '과제 탭에 "공식 과제 추가" 진입이 생겼다(기획 §6.6: 내 과제 창에서만)');
    //  텍스트로만 그린다: 사용자 글을 담는 innerHTML 조립에 esc 없이 붙는 필드가 없다.
    for (const f of ['title', 'memo', 'location', 'name', 'actor', 'createdBy', 'updatedBy']) {
      const raw = new RegExp(`\\+ (?:e|p|c|solo|L)\\.${f} \\+`, 'g');
      const lines = m.split('\n').filter((l) => l.includes("'<")).map((l) => l.replace(/esc\([^()]*\)/g, ''));
      assert.ok(!lines.some((l) => raw.test(l)), `${f} 를 esc 없이 HTML 에 붙인다`);
    }
  },
  punct(app) {
    const m = moduleOf(app);
    const bad = punctBad(m);
    assert.deepStrictEqual(bad, [], '과제 탭 모듈(주석 포함)에 금지 기호가 있다: ' + bad.join(', '));
    const a = app.indexOf('<!-- ===== 과제 공용 캘린더'), b = app.indexOf('<div class="overlay hidden" id="confirmModal">');
    assert.deepStrictEqual(punctBad(app.slice(a, b)), [], '과제 탭 모달 마크업에 금지 기호가 있다');
  },
};
test('정적①: 글자 상한이 웹, 호스트, DDL, 입력 칸에서 같다', () => statics.limits(src));
test('정적②: 명령 여섯만 pcReq 한 문으로, 열람 창과 관리 창 목록 밖, 그 창에서는 탭 줄 없음', () => statics.commands(src));
test('정적③: 주기 확인 없음, 띠 자리, Esc, 방향키, 복사 배지, 부팅 알림, 숨김 규칙, 글자 이스케이프', () => statics.wiring(src));
test('정적④: 과제 탭 문구와 주석의 기호 규칙', () => statics.punct(src));
test('변이S①: 웹 상한을 바꾸면 정적① 이 잡는다', () => {
  assert.throws(() => statics.limits(mutate('const PCAL_LIMITS = Object.freeze({ title: 200,', 'const PCAL_LIMITS = Object.freeze({ title: 100,')), /호스트 ProjectCalendarDb\.Limits 와 다르다/);
});
test('변이S②: 목록 밖 명령을 보내거나 열람 창 목록에 넣거나 탭 줄을 남기면 정적② 가 잡는다', () => {
  assert.throws(() => statics.commands(mutate("pcReq('projectCalendarChanges', q)", "pcReq('projectCalendarPurge', q)")), /목록 밖 명령|쓰지 않는 것/);
  assert.throws(() => statics.commands(mutate("const PEERWIN_CMD = new Set(['peerWinReady',", "const PEERWIN_CMD = new Set(['projectCalendarLoad','peerWinReady',")), /PEERWIN_CMD 에 projectCalendarLoad/);
  assert.throws(() => statics.commands(mutate('if(PEER || SUBWIN){ if(tabs) tabs.remove(); return; }', 'if(false){ return; }')), /탭 줄을 지우지 않는다/);
});
test('변이S③: 주기 확인을 넣거나 띠 자리를 되돌리거나 esc 를 빼면 정적③ 이 잡는다', () => {
  assert.throws(() => statics.wiring(mutate('function pcOnActivate(){', 'function pcOnActivate(){ setInterval(pcLoad, 30000);')), /주기 확인/);
  assert.throws(() => statics.wiring(mutate("const bar = document.getElementById('pcTabs') || document.querySelector('header.topbar')", "const bar = document.querySelector('header.topbar')")), /탭 줄 아래/);
  assert.throws(() => statics.wiring(mutate("'<div class=\"pc-pop-title\">' + esc(e.title) + '</div>'", "'<div class=\"pc-pop-title\">' + e.title + '</div>'")), /title 를 esc 없이/);
});

/* ── (P) 순수 계산 ───────────────────────────────────────────────────── */
const PURE_FNS = ['pcLen', 'pcFirstLine', 'pcEvSort', 'pcLayoutWeek', 'pcMonthCap', 'pcMonthRange', 'pcWeekRange', 'pcPrefsNorm',
  'pcSelReconcile', 'pcFromDto', 'pcEventPayload', 'pcValidate', 'pcDiffRows', 'pcMd', 'pcWhenText'];
function pureCtx(app = src) {
  const consts = ['const pad = ', 'const ymd = ', 'const parseYmd = ', 'const fmtShort = ', 'const addDays = ', 'const diffDays = ', 'const PC_DOW = ', 'const PCAL_LIMITS = ']
    .map((k) => { const i = app.indexOf(k); assert.ok(i >= 0, k + ' 를 찾지 못했다'); return app.slice(i, app.indexOf('\n', i)); });
  const code = consts.join('\n') + '\n' + PURE_FNS.map((f) => extractFunction(app, f)).join('\n')
    + '\n;globalThis.__x = {' + PURE_FNS.join(',') + ', PCAL_LIMITS };';
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx);
  return ctx.__x;
}
const P = pureCtx();
const J = (x) => JSON.parse(JSON.stringify(x));   // vm 영역의 배열과 객체를 이쪽 것으로
const ev = (uid, s, e, o = {}) => Object.assign({ eventUid: uid, projectUid: 'p1', startDate: s, endDate: e || s, startTime: null, title: uid }, o);

test('순수①: 차선 배치(겹치면 다음 차선, 안 겹치면 같은 차선) + 정렬(시작일, 긴 것 먼저, 과제 순서, 시각, uid)', () => {
  const from = '2026-10-18';   // 일요일
  const L = P.pcLayoutWeek([ev('c', '2026-10-20', '2026-10-21'), ev('a', '2026-10-18', '2026-10-19'), ev('b', '2026-10-18', '2026-10-24'),
    ev('d', '2026-10-22'), ev('e', '2026-10-20', '2026-10-20', { projectUid: 'p2' }), ev('f', '2026-10-20', '2026-10-20', { projectUid: 'p1', startTime: '09:00' })], from, { p1: 0, p2: 1 });
  assert.deepStrictEqual(J(L.items.map((x) => x.e.eventUid)), ['b', 'a', 'c', 'f', 'e', 'd'], '정렬이 시작일, 종료일 내림차순, 과제 순서, 시각, uid 가 아니다');
  const lane = Object.fromEntries(L.items.map((x) => [x.e.eventUid, x.lane]));
  assert.deepStrictEqual(J(lane), { b: 0, a: 1, c: 1, f: 2, e: 3, d: 1 });
  assert.strictEqual(L.lanes, 4);
  //  같은 입력 순서를 섞어도 결과가 같다(정렬 고정)
  const L2 = P.pcLayoutWeek([ev('d', '2026-10-22'), ev('f', '2026-10-20', '2026-10-20', { startTime: '09:00' }), ev('e', '2026-10-20', '2026-10-20', { projectUid: 'p2' }),
    ev('b', '2026-10-18', '2026-10-24'), ev('c', '2026-10-20', '2026-10-21'), ev('a', '2026-10-18', '2026-10-19')], from, { p1: 0, p2: 1 });
  assert.deepStrictEqual(J(L2.items.map((x) => [x.e.eventUid, x.lane])), J(L.items.map((x) => [x.e.eventUid, x.lane])));
});
test('순수②: 주 경계 자르기(앞뒤로 이어짐 표시), 같은 날짜, 윤년 2월 29일, 366일', () => {
  const long = ev('L', '2026-10-15', '2026-10-27');
  const w1 = P.pcLayoutWeek([long], '2026-10-11'), w2 = P.pcLayoutWeek([long], '2026-10-18'), w3 = P.pcLayoutWeek([long], '2026-10-25');
  assert.deepStrictEqual([w1.items[0].c0, w1.items[0].c1, w1.items[0].cl, w1.items[0].cr], [4, 6, false, true]);
  assert.deepStrictEqual([w2.items[0].c0, w2.items[0].c1, w2.items[0].cl, w2.items[0].cr], [0, 6, true, true]);
  assert.deepStrictEqual([w3.items[0].c0, w3.items[0].c1, w3.items[0].cl, w3.items[0].cr], [0, 2, true, false]);
  assert.strictEqual(P.pcLayoutWeek([long], '2026-11-01').items.length, 0, '범위 밖 일정이 들어왔다');
  const one = P.pcLayoutWeek([ev('s', '2026-10-21')], '2026-10-18').items[0];
  assert.deepStrictEqual([one.c0, one.c1, one.cl, one.cr], [3, 3, false, false], '하루 일정은 한 칸이다');
  const leap = P.pcLayoutWeek([ev('y', '2028-02-28', '2028-03-01')], '2028-02-27').items[0];
  assert.deepStrictEqual([leap.c0, leap.c1], [1, 3], '윤년 2월 29일을 건너뛰었다');
  const year = ev('Y', '2028-01-01', '2028-12-31');
  const mid = P.pcLayoutWeek([year], '2028-06-04').items[0];
  assert.deepStrictEqual([mid.c0, mid.c1, mid.cl, mid.cr], [0, 6, true, true]);
  assert.ok(P.pcValidate({ projectUid: 'p', title: 't', startDate: '2028-01-01', endDate: '2028-12-31' }, P.PCAL_LIMITS).ok, '366일(윤년 한 해)을 거절했다');
  assert.strictEqual(P.pcValidate({ projectUid: 'p', title: 't', startDate: '2028-01-01', endDate: '2029-01-01' }, P.PCAL_LIMITS).field, 'end', '367일을 받았다');
});
test('순수③: 월간 보이는 차선 수는 높이만 본다(메모 첫 줄과 무관), 범위(일요일 시작 월간, 월요일 시작 주간)', () => {
  assert.strictEqual(P.pcMonthCap.length, 2, '보이는 차선 수가 높이와 차선 수 말고 다른 것(메모 표시)에 기댄다');
  assert.strictEqual(P.pcMonthCap(200, 3), 3, '다 들어가는데 줄였다');
  assert.strictEqual(P.pcMonthCap(100, 9), 2, '넘칠 때 +n 줄 자리를 남기지 않았다');
  assert.strictEqual(P.pcMonthCap(0, 5), 1, '높이를 모를 때 최소 1 차선이 아니다');
  assert.strictEqual(P.pcMonthCap(0, 0), 0);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(P.pcMonthRange('2026-10-22'))), { from: '2026-09-27', to: '2026-10-31', weeks: 5, y: 2026, m: 9 });
  assert.strictEqual(P.pcMonthRange('2026-02-10').weeks, 4, '2026년 2월(일요일 시작, 28일)은 4주다');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(P.pcWeekRange('2026-10-25'))), { from: '2026-10-19', to: '2026-10-25', weeks: 1 }, '주간이 월요일 시작이 아니다');
  assert.strictEqual(P.pcWeekRange('2026-10-19').from, '2026-10-19');
});
test('순수④: 설정 고치기(설정 없음 null 과 빈 선택 [] 구분), 선택 맞추기(새 과제 켬, 빠진 과제 정리)', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(P.pcPrefsNorm(null))), { tab: 'personal', view: 'month', sel: null, known: [], memo: false });
  assert.deepStrictEqual(J(P.pcPrefsNorm('{"sel":[]}').sel), [], '빈 선택이 설정 없음으로 바뀌었다');
  assert.strictEqual(P.pcPrefsNorm('{"sel":"x"}').sel, null);
  assert.strictEqual(P.pcPrefsNorm('{깨진').tab, 'personal');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(P.pcPrefsNorm('{"tab":"project","view":"week","sel":["a","a",3,""],"memo":true}'))), { tab: 'project', view: 'week', sel: ['a'], known: [], memo: true });
  assert.deepStrictEqual(J(P.pcSelReconcile(null, [], ['a', 'b'])), ['a', 'b'], '설정 없음이면 전체 선택');
  assert.deepStrictEqual(J(P.pcSelReconcile([], ['a', 'b'], ['a', 'b'])), [], '빈 선택이 전체로 되살아났다');
  assert.deepStrictEqual(J(P.pcSelReconcile(['a'], ['a', 'b'], ['a', 'b', 'c'])), ['a', 'c'], '새로 내 과제에 넣은 과제를 켜지 않았다');
  assert.deepStrictEqual(J(P.pcSelReconcile(['a', 'gone'], ['a', 'gone'], ['a'])), ['a'], '빠진 과제를 정리하지 않았다');
});
test('순수⑤: 메모 첫 줄, DTO 왕복(호스트 회신 → 화면 → 저장 요청), 글자 수는 코드 포인트', () => {
  assert.strictEqual(P.pcFirstLine('\n   \n  첫 줄 \r\n둘째'), '첫 줄');
  assert.strictEqual(P.pcFirstLine(''), '');
  const dto = { eventUid: 'e1', projectUid: 'p1', title: '회의', startDate: '2026-10-22', endDate: '2026-10-22', startTime: '09:00', endTime: '10:00',
    location: '3층', memo: '안건\n둘째', rowVersion: 4, deleted: false, createdBy: '가', updatedBy: '나', createdAt: '2026-10-21T01:00:00.000Z', updatedAt: '2026-10-22T01:00:00.000Z' };
  const e = P.pcFromDto(dto);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(e)), dto, 'DTO 를 화면 모양으로 바꾸며 값이 변했다');
  const back = P.pcEventPayload(e);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(back)), { title: '회의', startDate: '2026-10-22', endDate: '2026-10-22', startTime: '09:00', endTime: '10:00', location: '3층', memo: '안건\n둘째' });
  const day = P.pcFromDto({ eventUid: 'e2', startDate: '2026-10-01', endDate: null, startTime: null });
  assert.deepStrictEqual([day.endDate, day.startTime, day.endTime], ['2026-10-01', null, null], '하루 일정의 종료일이나 빈 시각 처리가 다르다');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(P.pcEventPayload({ title: '  t  ', startDate: '2026-10-01', endDate: '', startTime: '09:00:00', endTime: '', location: ' 곳 ', memo: ' m ' }))),
    { title: 't', startDate: '2026-10-01', endDate: '2026-10-01', startTime: '09:00', endTime: null, location: '곳', memo: ' m ' });
  assert.strictEqual(P.pcLen('가😀'), 2, '서로게이트 쌍을 두 글자로 셌다');
});
test('순수⑥: 폼 검사(과제, 제목, 날짜, 기간, 시각 둘 다, 하루 일정만, 종료 시각, 장소와 메모 상한)', () => {
  const L = P.PCAL_LIMITS;
  const base = { projectUid: 'p', title: '제목', startDate: '2026-10-22', endDate: '2026-10-22', startTime: '', endTime: '', location: '', memo: '' };
  const f = (o) => P.pcValidate(Object.assign({}, base, o), L);
  assert.ok(f({}).ok);
  assert.strictEqual(f({ projectUid: '' }).field, 'proj');
  assert.strictEqual(f({ title: '   ' }).field, 'title');
  assert.strictEqual(f({ title: '가'.repeat(201) }).field, 'title');
  assert.ok(f({ title: '가'.repeat(199) + '😀' }).ok, '200 글자(코드 포인트) 제목을 거절했다');
  assert.strictEqual(f({ endDate: '' }).field, 'start');
  assert.strictEqual(f({ endDate: '2026-10-21' }).field, 'end');
  assert.strictEqual(f({ startTime: '09:00' }).field, 'et', '시작 시각만 있는데 받았다');
  assert.strictEqual(f({ endTime: '09:00' }).field, 'st');
  assert.strictEqual(f({ startTime: '09:00', endTime: '10:00', endDate: '2026-10-23' }).field, 'st', '여러 날 일정에 시각을 받았다');
  assert.strictEqual(f({ startTime: '10:00', endTime: '10:00' }).field, 'et');
  assert.ok(f({ startTime: '09:00', endTime: '10:00' }).ok);
  assert.strictEqual(f({ location: '장'.repeat(201) }).field, 'loc');
  assert.strictEqual(f({ memo: 'm'.repeat(8001) }).field, 'memo');
  assert.ok(f({ memo: 'm'.repeat(8000) }).ok);
  assert.strictEqual(f({ memo: 'm'.repeat(8001) }).msg, '메모는 8,000자까지 쓸 수 있습니다.');
});
test('순수⑦: 변경 이력의 전과 후(추가는 후만, 삭제는 전만, 수정은 바뀐 칸, 시각 둘이면 한 줄)', () => {
  const c = P.pcDiffRows('create', null, { title: 't', startDate: '2026-10-22', endDate: '2026-10-23', startTime: null, endTime: null, location: '', memo: 'm' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c)), [{ label: '날짜', b: null, a: '10/22 ~ 10/23', memo: false }, { label: '메모', b: null, a: 'm', memo: true }]);
  const d = P.pcDiffRows('delete', { startDate: '2026-10-20', endDate: '2026-10-20', startTime: '09:00', endTime: '10:00', location: '창고' }, null);
  assert.deepStrictEqual(J(d.map((x) => [x.label, x.b, x.a])), [['날짜', '10/20', null], ['시간', '09:00 ~ 10:00', null], ['장소', '창고', null]]);
  const u = P.pcDiffRows('update', { endDate: '2026-10-22', startTime: '09:00', endTime: '09:30', location: '' }, { endDate: '2026-10-23', startTime: '09:30', endTime: '10:00', location: 'B' });
  assert.deepStrictEqual(J(u.map((x) => [x.label, x.b, x.a])), [['종료일', '10/22', '10/23'], ['시간', '09:00 ~ 09:30', '09:30 ~ 10:00'], ['장소', '', 'B']]);
  const one = P.pcDiffRows('update', { endTime: '10:00' }, { endTime: '11:00' });
  assert.deepStrictEqual(J(one.map((x) => x.label)), ['종료 시각']);
});
test('변이P①: 정렬에서 종료일 내림차순을 빼면 순수① 이 잡는다', () => {
  const bad = mutate("if(a.endDate !== b.endDate) return a.endDate > b.endDate ? -1 : 1;\n  const oa", 'const oa');
  const Q = pureCtx(bad);
  const L = Q.pcLayoutWeek([ev('a', '2026-10-18', '2026-10-19'), ev('b', '2026-10-18', '2026-10-24')], '2026-10-18', {});
  assert.notDeepStrictEqual(L.items.map((x) => x.e.eventUid), ['b', 'a'], '변이가 정렬을 바꾸지 못했다');
});

/* ── (R) jsdom 위젯 모드 ──────────────────────────────────────────────── */
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('project-calendar-web: jsdom 미설치, 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  function fakeClock() {
    let seq = 0, now = 0;
    const timers = new Map();
    return {
      setTimeout(fn, d, ...args) { const id = ++seq; timers.set(id, { fn, args, at: now + (Number(d) || 0) }); return id; },
      clearTimeout(id) { timers.delete(id); },
      advance(ms) {
        const end = now + ms;
        for (;;) {
          let best = null;
          for (const [id, t] of timers) if (t.at <= end && (best === null || t.at < timers.get(best).at)) best = id;
          if (best === null) { now = end; return; }
          const t = timers.get(best); timers.delete(best); now = t.at;
          try { t.fn(...t.args); } catch (_) { /* 앱의 일 */ }
        }
      },
    };
  }
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222', P3 = '33333333-3333-4333-8333-333333333333';
  const U = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const PROJECTS = [
    { projectUid: P1, name: '<b>장비</b> 개발', color: '#3e5be0', active: true, writable: true, members: 6 },
    { projectUid: P2, name: '플랫폼 개선', color: '#1f9d6b', active: true, writable: true, members: 4 },
    { projectUid: P3, name: '구형 유지', color: '#8a5cc8', active: false, writable: false, members: 2 },
  ];
  const META = { schemaVersion: '16', expectedSchema: '16', schemaMismatch: false, gate: 'ok', rev: 1, canWrite: true, userId: 7 };
  const DATA = (entries = []) => ({
    categories: [{ id: 'c-1', name: '휴가', color: '#9aa2b3' }, { id: 'c-2', name: '기타', color: '#6b7a90' }, { id: 'db-' + P1, name: '장비 개발', color: '#3e5be0' }],
    entries, todos: [], rooms: [] });
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  async function boot({ url = '', host = true, login = 'hjlee', prefs = null, bootstrapReply = true, source = src } = {}) {
    const clock = fakeClock();
    const posts = [];
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/' + url, virtualConsole: quietConsole(),
      beforeParse(win) {
        if (host) win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posts.push(o || {}); }, addEventListener() {}, removeEventListener() {} } };
        win.scrollTo = () => {};
        win.setTimeout = clock.setTimeout; win.clearTimeout = clock.clearTimeout;
        if (prefs) for (const [k, v] of Object.entries(prefs)) win.localStorage.setItem(k, v);
      },
    });
    const w = dom.window, doc = w.document;
    const W = {
      w, doc, clock, posts,
      ev: (code) => w.eval(code),
      el: (id) => doc.getElementById(id),
      q: (s) => doc.querySelector(s), qa: (s) => [...doc.querySelectorAll(s)],
      cmds: (cmd) => posts.filter((p) => p.cmd === cmd),
      last: (cmd) => [...posts].reverse().find((p) => p.cmd === cmd && p.reqId),
      async reply(cmd, res) {
        const p = W.last(cmd);
        assert.ok(p, `${cmd} 요청이 나가지 않았다`);
        p.__done = true;
        w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify(res) + ')');
        await settle();
      },
      pending: (cmd) => posts.filter((p) => p.cmd === cmd && p.reqId && !p.__done),
      async applyState(entries) {
        w.eval('__applyState(' + JSON.stringify(JSON.stringify(DATA(entries))) + ',' + JSON.stringify(META) + ')');
        await settle(); clock.advance(5); await settle();
        for (const p of posts.filter((x) => x.cmd === 'saveState' && x.reqId && !x.__done)) { p.__done = true; w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',{"ok":true})'); }
        await settle();
      },
      async bootstrap(projects = PROJECTS, copies = []) { await W.reply('projectCalendarBootstrap', { ok: true, data: { projects, copies, limits: { title: 200, location: 200, memo: 8000 } } }); },
      async load(events, extra = {}) {
        const p = W.last('projectCalendarLoad');
        await W.reply('projectCalendarLoad', { ok: true, data: Object.assign({ projects: (p.projectUids || []).map((u) => ({ projectUid: u, rev: 1, writable: u !== P3 })), events, excluded: [], from: p.from, to: p.to }, extra) });
      },
      async click(sel) { const e = typeof sel === 'string' ? doc.querySelector(sel) : sel; assert.ok(e, `누를 것(${sel})이 없다`); e.click(); await settle(); clock.advance(150); await settle(); },
      async tab(t) { await W.click(t === 'project' ? '#pcTabProject' : '#pcTabPersonal'); },
      async enter(events = [], projects = PROJECTS) { await W.tab('project'); await W.bootstrap(projects); await W.load(events); },
      toasts: () => W.qa('#toastStack .toast, #toastStackErr .toast').map((t) => t.textContent),
      close: () => { try { w.close(); } catch (_) {} },
    };
    await settle();
    if (host && login && !url) {
      await W.reply('userSessionGet', { ok: true, user: { loginId: login, name: '이현진' } });
      await W.applyState();
      if (bootstrapReply) await W.bootstrap();
    }
    return W;
  }
  async function withBoot(opts, fn) { const W = await boot(opts); try { return await fn(W); } finally { W.close(); } }
  const EV = (n, o = {}) => Object.assign({ eventUid: U(n), projectUid: P1, title: '일정 ' + n, startDate: today(), endDate: today(), startTime: null, endTime: null,
    location: '', memo: '', rowVersion: 1, deleted: false, createdBy: '홍길동', updatedBy: '홍길동', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' }, o);

  test('화면①: 탭 전환이 개인 화면과 상단 단추를 숨기고 되돌린다, 탭 줄 아래로 장애 띠, 탭 진입은 목록과 범위를 읽는다', () => withBoot({}, async (W) => {
    assert.ok(W.el('pcTabs') && !W.doc.body.classList.contains('pc-on'), '처음은 개인 탭이어야 한다');
    assert.strictEqual(W.cmds('projectCalendarBootstrap').length, 1, '부팅 뒤 복사 배지를 위한 목록 읽기가 한 번이 아니다');
    assert.strictEqual(W.cmds('projectCalendarLoad').length, 0, '개인 탭인데 과제 일정을 읽었다');
    await W.tab('project');
    assert.ok(W.doc.body.classList.contains('pc-on'), '과제 탭 표시(body.pc-on)가 없다');
    assert.strictEqual(W.el('pcTabProject').getAttribute('aria-selected'), 'true');
    for (const id of ['filterbar', 'dayPanel', 'btnSearch', 'btnPeerPick', 'btnReportTop', 'btnNew']) {
      assert.strictEqual(W.w.getComputedStyle(W.el(id)).display, 'none', `과제 탭에서 #${id} 가 보인다`);
    }
    assert.strictEqual(W.w.getComputedStyle(W.q('.topbar .nav')).display, 'none', '과제 탭에서 상단바 달 이동이 보인다');
    assert.notStrictEqual(W.w.getComputedStyle(W.el('pcView')).display, 'none', '과제 화면이 보이지 않는다');
    assert.strictEqual(W.cmds('projectCalendarBootstrap').length, 2, '탭 진입이 과제 목록을 다시 읽지 않았다');
    await W.bootstrap();
    const ld = W.last('projectCalendarLoad');
    assert.ok(ld, '탭 진입이 범위 일정을 읽지 않았다');
    assert.deepStrictEqual(ld.projectUids, [P1, P2, P3], '처음(설정 없음)은 전체 선택이어야 한다');
    await W.load([]);
    assert.ok(/1개 과제|3개 과제 표시/.test(W.el('pcView').textContent), W.el('pcView').textContent.slice(0, 200));
    W.ev("insertBelowTitleBar(Object.assign(document.createElement('div'), { id: 'zzBand' }))");
    assert.strictEqual(W.el('pcTabs').nextElementSibling.id, 'zzBand', '장애 띠가 탭 줄 바로 아래가 아니다');
    await W.tab('personal');
    assert.ok(!W.doc.body.classList.contains('pc-on'));
    assert.notStrictEqual(W.w.getComputedStyle(W.el('filterbar')).display, 'none', '개인 탭으로 돌아왔는데 필터바가 숨어 있다');
    assert.strictEqual(W.w.getComputedStyle(W.el('pcView')).display, 'none', '개인 탭에서 과제 화면이 보인다');
  }));

  test('화면②: 새로고침은 목록과 범위, 창 복귀는 범위만, 늦게 온 옛 범위 회신은 버린다', () => withBoot({}, async (W) => {
    await W.enter([EV(1)]);
    const b0 = W.cmds('projectCalendarBootstrap').length, l0 = W.cmds('projectCalendarLoad').length;
    await W.click('#pcRefresh');
    assert.strictEqual(W.cmds('projectCalendarBootstrap').length, b0 + 1, '새로고침이 과제 목록을 다시 읽지 않았다');
    await W.bootstrap();
    assert.strictEqual(W.cmds('projectCalendarLoad').length, l0 + 1);
    await W.load([EV(1)]);
    W.ev("PCAL.actAt = 0; window.dispatchEvent(new Event('focus'))"); await settle();
    assert.strictEqual(W.cmds('projectCalendarLoad').length, l0 + 2, '창 복귀가 범위를 다시 읽지 않았다');
    assert.strictEqual(W.cmds('projectCalendarBootstrap').length, b0 + 1, '창 복귀가 과제 목록까지 읽었다');
    await W.load([EV(1)]);
    //  옛 회신 버리기: 다음 달로 갔다가 회신 전에 또 다음 달로. 첫 회신이 나중에 와도 화면에 들지 않는다.
    await W.click('#pcView [data-act="next"]');
    const first = W.last('projectCalendarLoad');
    await W.click('#pcView [data-act="next"]');
    const second = W.last('projectCalendarLoad');
    assert.notStrictEqual(first.reqId, second.reqId);
    W.ev('__hostReply(' + JSON.stringify(second.reqId) + ',' + JSON.stringify({ ok: true, data: { projects: [], events: [], excluded: [] } }) + ')'); await settle();
    W.ev('__hostReply(' + JSON.stringify(first.reqId) + ',' + JSON.stringify({ ok: true, data: { projects: [], events: [EV(9, { title: 'zz늦은회신', startDate: first.from, endDate: first.from })], excluded: [] } }) + ')'); await settle();
    assert.ok(!/zz늦은회신/.test(W.el('pcView').textContent), '늦게 온 옛 범위 회신이 화면에 들어왔다');
    assert.strictEqual(W.ev('PCAL.events.length'), 0);
  }));

  test('화면③: 글자로만 그린다(제목, 장소, 메모, 과제 이름의 HTML 같은 글), 메모 첫 줄을 켜도 보이는 일정 수가 같다', () => withBoot({}, async (W) => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    await W.enter([EV(1, { title: evil, memo: '<script>window.__pwned=2</script>\n둘째', location: '<b>곳</b>' }),
      EV(2, { title: '긴 일정', startDate: today(), endDate: today() }), EV(3, { projectUid: P2, title: '셋' })]);
    const v = W.el('pcView');
    assert.ok(!v.querySelector('img, script, .pc-name b, .pc-ev b'), '사용자 글이 요소로 그려졌다');
    assert.ok(v.textContent.includes(evil), '제목이 글자 그대로 보이지 않는다');
    assert.ok(v.textContent.includes('<b>장비</b> 개발'), '과제 이름이 글자 그대로 보이지 않는다');
    const n0 = W.qa('#pcView .pc-ev').length, more0 = W.qa('#pcView .pc-more').map((b) => b.textContent).join(',');
    assert.ok(!W.q('#pcView .pc-mline'));
    await W.click('#pcView input[data-act="memoLine"]');
    assert.strictEqual(W.qa('#pcView .pc-ev').length, n0, '메모 첫 줄을 켜자 보이는 일정 수가 바뀌었다');
    assert.strictEqual(W.qa('#pcView .pc-more').map((b) => b.textContent).join(','), more0, '메모 첫 줄을 켜자 "+n" 이 바뀌었다');
    const ml = W.q('#pcView .pc-mline');
    assert.ok(ml && ml.textContent === '<script>window.__pwned=2</script>', '월간에 메모 첫 줄이 제목 뒤에 보이지 않는다');
    await W.click('#pcView [data-act="view"][data-v="week"]');
    await W.load([EV(1, { title: evil, memo: '첫째 줄\n둘째', startTime: '09:00', endTime: '10:00' })]);
    const l2 = W.q('#pcView .pc-wcells .pc-l2');
    assert.ok(l2 && l2.textContent === '첫째 줄', '주간에 메모 첫 줄이 제목 아래 줄에 보이지 않는다');
    await W.click('#pcView .pc-ev');
    assert.ok(!W.el('pcPop').querySelector('img, script, .pc-pop-loc b'), '미리보기가 사용자 글을 요소로 그렸다');
    assert.strictEqual(W.w.__pwned, undefined);
  }));

  test('화면④: 왼쪽 목록(전체 선택, 전체 해제, 체크, 단독 보기, 종료 읽기 전용), 계정별 설정에 빈 선택이 남는다', () => withBoot({}, async (W) => {
    await W.enter([]);
    assert.ok(/3 \/ 3/.test(W.q('#pcView .pc-side-h').textContent));
    assert.ok(/종료, 읽기 전용/.test(W.q(`#pcView .pc-row input[data-uid="${P3}"]`).closest('.pc-row').textContent), '종료된 과제에 읽기 전용 표시가 없다');
    await W.click(`#pcView input[data-uid="${P2}"]`);
    assert.deepStrictEqual(W.last('projectCalendarLoad').projectUids, [P1, P3], '체크를 끄면 그 과제를 읽지 않아야 한다');
    await W.load([]);
    await W.click(`#pcView .pc-name[data-uid="${P2}"]`);
    assert.deepStrictEqual(W.last('projectCalendarLoad').projectUids, [P2], '이름을 누르면 그 과제만(단독 보기)');
    assert.ok(/플랫폼 개선/.test(W.q('#pcView .pc-title').textContent));
    await W.load([]);
    await W.click('#pcView [data-act="selNone"]');
    assert.ok(/표시할 과제를 선택하세요/.test(W.el('pcView').textContent), '0개 선택 안내가 없다');
    const saved = JSON.parse(W.w.localStorage.getItem('tc_pcal:hjlee'));
    assert.deepStrictEqual([saved.tab, saved.sel], ['project', []], '계정별 키에 빈 선택이 남지 않았다');
    await W.click('#pcView [data-act="selAll"]');
    assert.deepStrictEqual(W.last('projectCalendarLoad').projectUids, [P1, P2, P3]);
  }));

  test('화면⑤: 저장된 빈 선택은 다시 켜도 빈 선택이다(설정 없음과 다름), 마지막 탭과 주간을 되살린다, 날짜는 오늘', () => withBoot(
    { prefs: { 'tc_pcal:hjlee': JSON.stringify({ tab: 'project', view: 'week', sel: [], known: [P1, P2, P3], memo: true }), 'tc_pcal:other': JSON.stringify({ tab: 'personal' }) }, bootstrapReply: false },
    async (W) => {
      assert.ok(W.doc.body.classList.contains('pc-on'), '마지막 탭(과제)을 되살리지 않았다');
      await W.bootstrap();
      assert.strictEqual(W.cmds('projectCalendarLoad').length, 0, '빈 선택인데 일정을 읽었다');
      assert.ok(/표시할 과제를 선택하세요/.test(W.el('pcView').textContent));
      assert.strictEqual(W.ev('PCAL.view'), 'week');
      assert.strictEqual(W.ev('PCAL.memoLine'), true);
      assert.strictEqual(W.ev('PCAL.anchor'), today(), '날짜를 기억해 되살렸다(켤 때 오늘이어야 한다)');
    }));

  test('화면⑥: 날짜 칸을 누르면 그날 일정 목록, 줄마다 [수정], [수정]은 수정 폼, "이 날짜에 일정 등록" 은 그 날짜의 등록 폼', () => withBoot({}, async (W) => {
    await W.enter([EV(1, { title: '첫째' }), EV(2, { title: '둘째', projectUid: P2, startTime: '14:00', endTime: '15:00' }), EV(3, { title: '종료 과제', projectUid: P3 })]);
    await W.click(`#pcView .pc-day[data-date="${today()}"]`);
    const pop = W.el('pcPop');
    assert.ok(pop, '그날 일정 목록이 뜨지 않았다');
    const rows = [...pop.querySelectorAll('.pc-dl-row')];
    assert.strictEqual(rows.length, 3);
    assert.ok(/플랫폼 개선, 14:00 ~ 15:00/.test(pop.textContent), '줄에 과제명과 시각이 없다');
    assert.strictEqual(pop.querySelectorAll('[data-act="edit"]').length, 2, '쓸 수 있는 과제의 줄에만 [수정]이 있어야 한다');
    assert.ok(pop.querySelector('[data-act="newOn"]'), '"이 날짜에 일정 등록" 이 없다');
    await W.click(pop.querySelector(`[data-act="edit"][data-ev="${U(2)}"]`));
    assert.ok(!W.el('pcFormModal').classList.contains('hidden'), '[수정]이 폼을 열지 않았다');
    assert.strictEqual(W.el('pcfHead').textContent, '과제 일정 수정');
    assert.strictEqual(W.el('pcfTitle').value, '둘째');
    assert.ok(W.el('pcfProj').disabled, '수정 때 과제를 바꿀 수 있다');
    W.ev("closeModal('#pcFormModal')"); W.clock.advance(500); await settle();
    await W.click(`#pcView .pc-day[data-date="${today()}"] .num`);
    await W.click('#pcPop [data-act="newOn"]');
    assert.strictEqual(W.el('pcfHead').textContent, '과제 일정 등록');
    assert.strictEqual(W.el('pcfStart').value, today());
    assert.strictEqual(W.el('pcfProj').value, '', '전체 보기에서 과제가 미리 골라져 있다(과제를 선택하세요 여야 한다)');
    assert.ok(![...W.el('pcfProj').options].some((o) => o.value === P3), '종료된 과제가 등록 목록에 있다');
    W.ev('pcEscape()');
  }));

  test('화면⑦: 막대 미리보기의 [수정]은 바로 폼, 상세는 전체 메모와 글쓴이와 마지막 수정, Esc 는 팝오버를 닫는다', () => withBoot({}, async (W) => {
    await W.enter([EV(1, { title: '미리보기', memo: '1\n2\n3\n4\n5', location: '3층', createdBy: '가', updatedBy: '나' })]);
    await W.click('#pcView .pc-ev');
    assert.ok(W.el('pcPop'), '미리보기가 뜨지 않았다');
    assert.ok(/메모 일부만 보입니다/.test(W.el('pcPop').textContent));
    W.doc.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
    assert.ok(!W.el('pcPop'), 'Esc 가 미리보기를 닫지 않았다');
    await W.click('#pcView .pc-ev');
    await W.click('#pcPop [data-act="edit"]');
    assert.ok(!W.el('pcFormModal').classList.contains('hidden'), '미리보기 [수정]이 폼을 열지 않았다');
    assert.strictEqual(W.el('pcfTitle').value, '미리보기');
    W.ev("closeModal('#pcFormModal')"); W.clock.advance(500); await settle();
    await W.click('#pcView .pc-ev');
    await W.click('#pcPop [data-act="detail"]');
    const body = W.el('pcDetailBody').textContent;
    assert.ok(/1\n2\n3\n4\n5/.test(body) && /3층/.test(body) && /글쓴이가/.test(body) && /마지막 수정나/.test(body), body);
    assert.ok(W.q('#pcDetailFoot [data-act="copy"]') && /개인 일정에 등록/.test(W.el('pcDetailFoot').textContent));
  }));

  test('화면⑧: 폼 검사가 저장을 막고, 맞는 값은 여섯 명령 중 저장 하나로 간다(DTO), 저장 뒤 범위를 다시 읽는다', () => withBoot({}, async (W) => {
    await W.enter([]);
    await W.click('#pcView [data-act="new"]');
    W.el('pcfTitle').value = '새 일정';
    await W.click('#pcfSave');
    assert.strictEqual(W.el('pcfErr').textContent, '저장할 과제를 선택하세요.');
    W.el('pcfProj').value = P1;
    W.el('pcfST').value = '09:00';
    await W.click('#pcfSave');
    assert.ok(/둘 다 적거나 둘 다 비웁니다/.test(W.el('pcfErr').textContent));
    assert.strictEqual(W.cmds('projectCalendarSave').length, 0, '검사에 걸렸는데 저장을 보냈다');
    W.el('pcfET').value = '10:00'; W.el('pcfLoc').value = ' 3층 '; W.el('pcfMemo').value = '메모';
    await W.click('#pcfSave');
    const s = W.last('projectCalendarSave');
    assert.ok(s, '저장을 보내지 않았다');
    assert.strictEqual(s.projectUid, P1);
    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.eventUid) && /^[0-9a-f-]{36}$/.test(s.mutationUid), '일정 id 나 변경 id 가 uuid 가 아니다');
    assert.ok(!('expectedVersion' in s), '새 일정인데 판을 보냈다');
    assert.deepStrictEqual(s.event, { title: '새 일정', startDate: today(), endDate: today(), startTime: '09:00', endTime: '10:00', location: '3층', memo: '메모' });
    assert.strictEqual(W.el('pcfSave').disabled, true, '저장 중에 다시 누를 수 있다');
    const l0 = W.cmds('projectCalendarLoad').length;
    await W.reply('projectCalendarSave', { ok: true, data: { event: EV(5, { eventUid: s.eventUid, title: '새 일정' }), rowVersion: 1, projectRev: 2, replayed: false } });
    W.clock.advance(500); await settle();
    assert.ok(W.el('pcFormModal').classList.contains('hidden'), '저장했는데 폼이 남았다');
    assert.strictEqual(W.cmds('projectCalendarLoad').length, l0 + 1, '저장 직후 범위를 다시 읽지 않았다');
    const all = new Set(W.posts.map((p) => p.cmd).filter((c) => /^projectCalendar/.test(c)));
    for (const c of all) assert.ok(['projectCalendarBootstrap', 'projectCalendarLoad', 'projectCalendarSave', 'projectCalendarDelete', 'projectCalendarChanges', 'projectCalendarCopy'].includes(c), c);
  }));

  test('화면⑨: 저장 실패(연결)면 입력과 변경 id 를 남기고, 다시 누르면 같은 변경 id 로 보낸다(멱등)', () => withBoot({}, async (W) => {
    await W.enter([]);
    await W.click('#pcView [data-act="new"]');
    W.el('pcfProj').value = P1; W.el('pcfTitle').value = '재시도';
    await W.click('#pcfSave');
    const a = W.last('projectCalendarSave');
    await W.reply('projectCalendarSave', { ok: false, error: { kind: 'network', message: '' } });
    assert.ok(/저장하지 못했습니다/.test(W.el('pcfErr').textContent) && /입력은 그대로/.test(W.el('pcfErr').textContent));
    assert.strictEqual(W.el('pcfTitle').value, '재시도');
    await W.click('#pcfSave');
    const b = W.last('projectCalendarSave');
    assert.notStrictEqual(a.reqId, b.reqId);
    assert.deepStrictEqual([b.eventUid, b.mutationUid], [a.eventUid, a.mutationUid], '재시도가 다른 id 로 나갔다(응답만 잃었으면 중복이 생긴다)');
  }));

  test('화면⑩: 충돌이면 입력을 지키고 고르게 한다. 최신 내용 확인은 칸을 채우고, 내 입력 유지는 다음 저장을 최신 판 위에', () => withBoot({}, async (W) => {
    await W.enter([EV(1, { title: '원래', rowVersion: 3 })]);
    await W.click('#pcView .pc-ev');
    await W.click('#pcPop [data-act="edit"]');
    W.el('pcfTitle').value = '내가 고침';
    await W.click('#pcfSave');
    assert.strictEqual(W.last('projectCalendarSave').expectedVersion, 3);
    const latest = EV(1, { title: '남이 고침', rowVersion: 4, updatedBy: '김철수', location: '회의실 B' });
    await W.reply('projectCalendarSave', { ok: false, data: { latest }, error: { kind: 'conflict', message: '다른 사람이 먼저 고쳤습니다. 최신 내용을 확인한 뒤 다시 저장하세요.' } });
    assert.ok(/다른 사람이 먼저 고쳤습니다/.test(W.el('pcfConflict').textContent) && /김철수/.test(W.el('pcfConflict').textContent));
    assert.strictEqual(W.el('pcfTitle').value, '내가 고침', '충돌에서 내 입력이 사라졌다');
    const n = W.cmds('projectCalendarSave').length;
    await W.click('#pcfSave');
    assert.strictEqual(W.cmds('projectCalendarSave').length, n, '고르기 전인데 저장을 보냈다');
    await W.click('#pcfConflict [data-act="cfKeep"]');
    await W.click('#pcfSave');
    const k = W.last('projectCalendarSave');
    assert.deepStrictEqual([k.expectedVersion, k.event.title], [4, '내가 고침'], '내 입력 유지가 최신 판 위에 내 입력으로 저장하지 않았다');
    await W.reply('projectCalendarSave', { ok: false, data: { latest: Object.assign({}, latest, { rowVersion: 5 }) }, error: { kind: 'conflict', message: 'x' } });
    await W.click('#pcfConflict [data-act="cfLatest"]');
    assert.deepStrictEqual([W.el('pcfTitle').value, W.el('pcfLoc').value], ['남이 고침', '회의실 B'], '최신 내용 확인이 칸을 채우지 않았다');
    await W.click('#pcfSave');
    assert.strictEqual(W.last('projectCalendarSave').expectedVersion, 5);
  }));

  test('화면⑪: 최근 변경은 표시 중인 과제만, 종류 필터(전체, 추가, 수정, 삭제)를 보낸다, 전과 후, 긴 메모 펼치기, 더 보기 커서', () => withBoot({}, async (W) => {
    await W.enter([EV(1, { title: '지금 제목' })]);
    await W.click(`#pcView input[data-uid="${P3}"]`); await W.load([EV(1, { title: '지금 제목' })]);
    await W.click('#pcChanges');
    assert.ok(!W.el('pcChangesModal').classList.contains('hidden'));
    let q = W.last('projectCalendarChanges');
    assert.deepStrictEqual([q.projectUids, q.kind, q.limit], [[P1, P2], 'all', 50], '표시 중인 과제와 기본 종류(전체)로 읽지 않았다');
    assert.ok(typeof q.changedFrom === 'string' && !Number.isNaN(Date.parse(q.changedFrom)), '기본 기간(최근 7일)을 보내지 않았다');
    const kind = W.el('pccKind');
    kind.value = 'delete'; kind.dispatchEvent(new W.w.Event('change', { bubbles: true })); await settle();
    q = W.last('projectCalendarChanges');
    assert.strictEqual(q.kind, 'delete', '종류 필터가 요청에 실리지 않았다');
    const at = new Date().toISOString();
    await W.reply('projectCalendarChanges', { ok: true, data: { rows: [
      { changeNo: 9, projectUid: P1, eventUid: U(7), action: 'delete', actor: '<i>김</i>', title: '지운 일정', before: { startDate: '2026-10-20', endDate: '2026-10-20', location: '창고' }, after: null, changedAt: at },
      { changeNo: 8, projectUid: P1, eventUid: U(1), action: 'update', actor: '이', title: '옛 제목', before: { memo: '짧다' }, after: { memo: '길다\n'.repeat(30) }, changedAt: at },
    ], hasMore: true, nextCursor: { changedAt: at, changeNo: 8 }, excluded: [] } });
    const body = W.el('pccBody');
    assert.ok(/지운 일정 \(삭제됨\)/.test(body.textContent), '지운 일정이 (삭제됨)으로 보이지 않는다');
    assert.ok(/<i>김<\/i>/.test(body.textContent) && !body.querySelector('i'), '사람 이름이 요소로 그려졌다');
    assert.ok(/창고/.test(body.textContent) && /10\/20/.test(body.textContent), '삭제의 전 값이 보이지 않는다');
    assert.ok(W.q('#pccBody [data-act="rcOpen"]') && /지금 제목/.test(W.q('#pccBody [data-act="rcOpen"]').textContent), '살아 있는 일정의 지금 제목 단추가 없다');
    const exp = W.q('#pccBody [data-act="rcExp"]');
    assert.ok(exp && W.q('#pccBody .pcc-mb.clamp'), '긴 메모가 접혀 있지 않다');
    await W.click(exp);
    assert.ok(!W.q('#pccBody .pcc-mb.clamp') && exp.textContent === '접기', '펼치기가 동작하지 않는다');
    assert.ok(/더 있음/.test(W.el('pccMeta').textContent) && !W.el('pccMore').disabled);
    await W.click('#pccMore');
    q = W.last('projectCalendarChanges');
    assert.deepStrictEqual(q.cursor, { changedAt: at, changeNo: 8 }, '더 보기가 커서를 보내지 않았다');
    const grp = W.el('pccTools').querySelector('[data-v="date"]');
    await W.click(grp);
    assert.ok(W.q('#pccBody .pcc-proj'), '날짜순 묶기에 과제 표시가 없다');
  }));

  test('화면⑫: 개인 일정에 등록은 개인 저장이 끝난 뒤에만 보내고, 성공하면 등록됨과 개인 탭 배지', () => withBoot({}, async (W) => {
    await W.enter([EV(1, { title: '복사할 일정', rowVersion: 2 })]);
    await W.click('#pcView .pc-ev');
    await W.click('#pcPop [data-act="detail"]');
    //  개인 저장이 진행 중이면 기다린다(그 저장이 끝나기 전에는 복사를 보내지 않는다)
    W.ev("state.entries.push({ id:'e-mine', date:'2026-10-01', title:'내 것', categoryId:'c-2', allDay:true, startTime:'', endTime:'', memo:'', location:'', source:'', commits:[] }); save();");
    await settle();
    const sv = W.pending('saveState');
    assert.strictEqual(sv.length, 1, '개인 저장이 나가지 않았다(시험 준비)');
    await W.click('#pcDetailFoot [data-act="copy"]');
    await W.click('#cfOk');
    assert.strictEqual(W.cmds('projectCalendarCopy').length, 0, '개인 저장이 끝나기 전에 복사를 보냈다');
    sv[0].__done = true; W.ev('__hostReply(' + JSON.stringify(sv[0].reqId) + ',{"ok":true})'); await settle();
    const c = W.last('projectCalendarCopy');
    assert.ok(c, '개인 저장이 끝났는데 복사를 보내지 않았다');
    assert.deepStrictEqual([c.projectUid, c.eventUid, c.expectedVersion], [P1, U(1), 2]);
    await W.reply('projectCalendarCopy', { ok: true, data: { entryUid: 'e-copy-1', eventUid: U(1), projectUid: P1, existed: false, personalRev: 3 } });
    assert.ok(/개인 일정에 등록됨/.test(W.el('pcDetailFoot').textContent) && W.q('#pcDetailFoot [data-act="copy"]').disabled, '등록 뒤 상세가 "등록됨" 으로 바뀌지 않았다');
    //  호스트가 개인 스냅샷을 다시 실으면(§5.5 3번) 개인 탭 카드에 출처 배지가 붙는다
    W.ev("closeModal('#pcDetailModal')"); W.clock.advance(500); await settle();
    await W.applyState([{ id: 'e-copy-1', date: today(), title: '복사할 일정', categoryId: 'db-' + P1, allDay: false, startTime: '', endTime: '', memo: '', location: '', source: '', commits: [], createdAt: '', updatedAt: '' }]);
    await W.tab('personal');
    W.ev(`selectedDate = ${JSON.stringify(today())}; renderAll();`);
    const card = W.q('#dpBody .card[data-id="e-copy-1"]');
    assert.ok(card && card.querySelector('.pc-copy-badge') && /과제 캘린더에서 복사/.test(card.textContent), '개인 탭 카드에 복사 배지가 없다');
  }));

  test('화면⑬: 내 개인 저장이 막혀 있으면(미저장) 복사하지 않는다, 종료 과제는 수정 삭제가 꺼지고 등록은 된다', () => withBoot({}, async (W) => {
    await W.enter([EV(3, { projectUid: P3, title: '종료 과제 일정' })]);
    await W.click('#pcView .pc-ev');
    assert.ok(!W.q('#pcPop [data-act="edit"]'), '종료 과제 미리보기에 [수정]이 있다');
    await W.click('#pcPop [data-act="detail"]');
    assert.ok(W.q('#pcDetailFoot [data-act="edit"]').disabled && W.q('#pcDetailFoot [data-act="delete"]').disabled, '종료 과제의 수정, 삭제가 켜져 있다');
    assert.ok(!W.q('#pcDetailFoot [data-act="copy"]').disabled, '종료 과제도 개인 등록은 된다(기획 §6.6)');
    W.ev('setUnsaved(true)');
    await W.click('#pcDetailFoot [data-act="copy"]');
    assert.ok(W.el('confirmModal').classList.contains('hidden'), '편집 잠금인데 확인 창을 띄웠다');
    assert.strictEqual(W.cmds('projectCalendarCopy').length, 0, '미저장 변경이 있는데 복사를 보냈다');
  }));

  test('화면⑭: 과제가 없으면 내 과제 창 안내(공식 과제 추가 진입 없음), 목록 읽기 실패는 다시 시도', () => withBoot({ bootstrapReply: false }, async (W) => {
    await W.tab('project');
    await W.reply('projectCalendarBootstrap', { ok: false, error: { kind: 'network', message: '서버에 연결할 수 없습니다' } });
    assert.ok(/읽지 못했습니다/.test(W.el('pcView').textContent) && W.q('#pcView [data-act="retry"]'));
    await W.click('#pcView [data-act="retry"]');
    await W.bootstrap([]);
    const t = W.el('pcView').textContent;
    assert.ok(/과제 캘린더가 비어 있습니다/.test(t) && /내 과제 창/.test(t) && !/공식 과제 추가/.test(t), t);
    assert.ok(W.q('#pcView [data-act="cats"]'), '내 과제 창 단추가 없다');
  }));

  test('화면⑮: 관리 창, 열람 창 껍데기, 브라우저에서는 과제 명령을 보내지 않는다(탭 줄 없음, 브라우저는 안내 한 장)', async () => {
    await withBoot({ url: '?win=admin' }, async (W) => {
      assert.ok(!W.el('pcTabs'), '관리 창에 탭 줄이 있다');
      const r = await W.ev("pcReq('projectCalendarLoad', { projectUids: [], from: '2026-10-01', to: '2026-10-31' })");
      assert.strictEqual(r.error.kind, 'host');
      assert.strictEqual(W.posts.filter((p) => /^projectCalendar/.test(p.cmd)).length, 0, '관리 창이 과제 명령을 보냈다');
    });
    await withBoot({ url: '?peerwin=1' }, async (W) => {
      assert.ok(!W.el('pcTabs'), '열람 창에 탭 줄이 있다');
      W.ev("pcSetTab('project')"); await settle();
      assert.strictEqual(W.posts.filter((p) => /^projectCalendar/.test(p.cmd)).length, 0, '열람 창이 과제 명령을 보냈다');
    });
    await withBoot({ host: false }, async (W) => {
      assert.ok(W.el('pcTabs'), '브라우저에도 탭 줄은 있다');
      await W.tab('project');
      assert.ok(/서버에 연결된 위젯에서만/.test(W.el('pcView').textContent), '브라우저 단독 안내가 없다');
      assert.strictEqual(W.posts.length, 0);
    });
  });

  test('화면⑯: 삭제는 확인 뒤 판(rowVersion)과 함께, 방향키는 과제 달력을 움직인다', () => withBoot({}, async (W) => {
    await W.enter([EV(1, { title: '지울 일정', rowVersion: 7 })]);
    const m0 = W.ev('PCAL.anchor');
    W.doc.body.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await settle();
    assert.notStrictEqual(W.ev('PCAL.anchor'), m0, '→ 가 과제 달력을 움직이지 않았다');
    W.doc.body.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'Home', bubbles: true })); await settle();
    await W.load([EV(1, { title: '지울 일정', rowVersion: 7 })]);
    await W.click('#pcView .pc-ev');
    await W.click('#pcPop [data-act="detail"]');
    await W.click('#pcDetailFoot [data-act="delete"]');
    assert.ok(/이 일정을 삭제할까요/.test(W.el('confirmModal').textContent));
    await W.click('#cfOk');
    const d = W.last('projectCalendarDelete');
    assert.deepStrictEqual([d.projectUid, d.eventUid, d.expectedVersion], [P1, U(1), 7]);
    await W.reply('projectCalendarDelete', { ok: true, data: { eventUid: U(1), rowVersion: 8, deleted: true, projectRev: 3 } });
    assert.ok(!/지울 일정/.test(W.el('pcView').textContent), '지운 일정이 달력에 남았다');
  }));

  test('화면⑰: 그려진 과제 탭 문구(본문, title, aria-label, placeholder)의 기호 규칙(엠 대시, en 대시, 띄어 쓴 가운데 점, 낫표)', () => withBoot({}, async (W) => {
    const seen = [];
    const grab = (root) => {
      if (!root) return;
      seen.push(root.textContent);
      root.querySelectorAll('[title],[aria-label],[placeholder]').forEach((e) => seen.push((e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('placeholder') || '')));
    };
    grab(W.el('pcTabs'));
    await W.enter([EV(1, { memo: '메모', startTime: '09:00', endTime: '10:00' }), EV(2, { startDate: today(), endDate: today() })]);
    grab(W.el('pcView'));
    await W.click('#pcView .pc-ev'); grab(W.el('pcPop'));
    await W.click(`#pcView .pc-day[data-date="${today()}"]`); grab(W.el('pcPop'));
    await W.click('#pcPop [data-act="newOn"]'); grab(W.el('pcFormModal'));
    W.ev("closeModal('#pcFormModal')"); W.clock.advance(500); await settle();
    await W.click('#pcView .pc-ev'); await W.click('#pcPop [data-act="detail"]'); grab(W.el('pcDetailModal'));
    W.ev("closeModal('#pcDetailModal')"); W.clock.advance(500); await settle();
    await W.click('#pcChanges'); grab(W.el('pcChangesModal'));
    await W.click('#pcView [data-act="view"][data-v="week"]'); grab(W.el('pcView'));
    const bad = seen.flatMap((t) => punctBad(t).map((n) => n + ': ' + t.slice(0, 60)));
    assert.deepStrictEqual(bad, [], '과제 탭 화면 문구에 금지 기호가 있다');
  }));

  test('변이R①: 복사 전 개인 저장 기다리기를 빼면 화면⑫ 가 잡는다', async () => {
    const bad = mutate('  await awaitSaveIdle();\n  if(unsaved || __dbSaving', '  if(false && unsaved || __dbSaving');
    const W = await boot({ source: bad });
    try {
      await W.enter([EV(1, { rowVersion: 2 })]);
      await W.click('#pcView .pc-ev'); await W.click('#pcPop [data-act="detail"]');
      W.ev("state.entries.push({ id:'e-mine', date:'2026-10-01', title:'내 것', categoryId:'c-2', allDay:true, startTime:'', endTime:'', memo:'', location:'', source:'', commits:[] }); save();"); await settle();
      await W.click('#pcDetailFoot [data-act="copy"]'); await W.click('#cfOk');
      //  변이본은 저장 중(__dbSaving)이라 보내지 않는다. 원본의 기다림이 없어지면 끝까지 보내지 못한다.
      assert.strictEqual(W.cmds('projectCalendarCopy').length, 0);
      W.pending('saveState').forEach((p) => { p.__done = true; W.ev('__hostReply(' + JSON.stringify(p.reqId) + ',{"ok":true})'); }); await settle();
      assert.strictEqual(W.cmds('projectCalendarCopy').length, 0, '변이(기다림 제거)에서도 저장 뒤 복사가 나갔다. 화면⑫ 가 기다림을 지키지 못한다');
    } finally { W.close(); }
  });
  test('변이R②: 저장 실패 때 변경 id 를 새로 만들면 화면⑨ 의 멱등 검사가 잡는다', async () => {
    const bad = mutate("  pcFormErr('저장하지 못했습니다. ' + pcErrText(r.error) + ' 입력은 그대로 있습니다.');", "  F.mutationUid = pcUuid(); pcFormErr('저장하지 못했습니다. ' + pcErrText(r.error) + ' 입력은 그대로 있습니다.');");
    const W = await boot({ source: bad });
    try {
      await W.enter([]);
      await W.click('#pcView [data-act="new"]');
      W.el('pcfProj').value = P1; W.el('pcfTitle').value = '재시도';
      await W.click('#pcfSave'); const a = W.last('projectCalendarSave');
      await W.reply('projectCalendarSave', { ok: false, error: { kind: 'network', message: '' } });
      await W.click('#pcfSave'); const b = W.last('projectCalendarSave');
      assert.notStrictEqual(a.mutationUid, b.mutationUid, '변이가 변경 id 를 바꾸지 못했다');
    } finally { W.close(); }
  });
}
