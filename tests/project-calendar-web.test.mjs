// 과제 공용 캘린더 P2: 과제 탭 화면(docs/PROJECT-CALENDAR-PLAN.md §6, §6.6, 시안 docs/prototypes/project-calendar.html 2차).
//
// 이 파일이 지키는 것:
//   (S) 정적: 웹 글자 상한(PCAL_LIMITS)이 호스트 상수(ProjectCalendarDb.Limits)와 DDL 칸 폭, 입력 칸 maxlength 와 같다.
//       보내는 명령은 여섯뿐(호스트 Commands 와 같은 목록)이고 pcReq 한 문으로만 나간다. 열람 창과 관리 창 목록에 없다.
//       주기 확인(setInterval)이 없다. 장애 띠 자리는 탭 줄 아래. 전역 Esc 와 방향키가 과제 탭을 안다. 기호 규칙.
//   (P) 순수 계산(node:vm): 막대 차선 배치, 주 경계 자르기, 정렬 고정, 윤년과 같은 날짜와 366일, 월간 보이는 차선 수,
//       범위, 설정(설정 없음과 빈 선택 구분), 선택 맞추기, 메모 첫 줄, DTO 왕복, 폼 검사, 변경 이력의 전과 후.
//   (R) jsdom(위젯 모드, 가짜 호스트): 탭 전환이 숨기고 보이는 것, 탭 진입과 새로고침과 창 복귀의 읽기, 늦은 회신 버리기,
//       글자로만 그리기, 메모 첫 줄을 켜도 보이는 수가 같음, 체크로만 보이기(이름 누름은 아무 일 없음, 옛 solo 설정 무시),
//       체크가 하나면 폼에 그 과제, 달력에서 무엇을 누르든 그날 일정 목록(누른 일정 줄 강조와 초점), 줄은 상세 창,
//       상세의 단추(수정, 개인 일정에 등록, 삭제), 목록 안 방향키와 Esc, 폼 검사와 저장, 충돌(최신 내용 확인, 내 입력 유지),
//       최근 변경의 종류 필터와 더 보기, 개인 일정에 등록(사본: 누를 때마다 새로, 등록됨과 배지 없음),
//       계정별 설정, 열람 창과 관리 창과 브라우저에서는 보내지 않음.
//   2026-10-22 저녁 검토 반영(기획 §6.7): 단독 보기, 막대 미리보기, 줄의 [수정], 복사 대응과 배지와 "등록됨" 을 걷었다.
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
    assert.ok(/if\(!PEER\) pcOnBootApplied\(\);/.test(app), '부팅 주입이 과제 탭에 계정을 알리지 않는다');
    assert.ok(/ov\.id==='pcFormModal'/.test(extractFunction(app, 'isGuardedModal')), '과제 일정 폼이 닫기 확인(Esc, 배경 누름) 대상이 아니다');
    assert.ok(/<section class="pc-view" id="pcView"/.test(app) && /<div class="pc-tabs" id="pcTabs" role="tablist"/.test(app), '탭 줄이나 과제 화면 자리가 마크업에 없다');
    const css = app.slice(app.indexOf('<style>'), app.indexOf('</style>'));
    for (const sel of ['body.pc-on #filterbar', 'body.pc-on main > .cal', 'body.pc-on #dayPanel', 'body.pc-on .topbar .nav', 'body.pc-on #btnSearch',
      'body.pc-on #btnPeerPick', 'body.pc-on #btnReportTop', 'body.pc-on #btnNew']) assert.ok(css.includes(sel), `과제 탭에서 ${sel} 를 숨기지 않는다`);
    assert.ok(!/공식 과제 추가/.test(m), '과제 탭에 "공식 과제 추가" 진입이 생겼다(기획 §6.6: 내 과제 창에서만)');
    //  텍스트로만 그린다: 사용자 글을 담는 innerHTML 조립에 esc 없이 붙는 필드가 없다.
    for (const f of ['title', 'memo', 'location', 'name', 'actor', 'createdBy', 'updatedBy']) {
      const raw = new RegExp(`\\+ (?:e|p|c|L)\\.${f} \\+`, 'g');
      const lines = m.split('\n').filter((l) => l.includes("'<")).map((l) => l.replace(/esc\([^()]*\)/g, ''));
      assert.ok(!lines.some((l) => raw.test(l)), `${f} 를 esc 없이 HTML 에 붙인다`);
    }
  },
  //  2026-10-22 저녁 검토 반영(기획 §6.7)으로 걷은 것이 돌아오지 않는다.
  removed(app) {
    const m = moduleOf(app);
    //  ① 단독 보기: 상태, 이름 단추, 머리의 단독 전환, 안내 글, 색칠 규칙이 없다. 과제 이름은 단추가 아닌 글자다.
    for (const [re, what] of [[/PCAL\.solo|\bsolo:/, 'PCAL.solo 상태'], [/data-act="(?:un)?solo"|case 'solo'|case 'unsolo'/, '단독 보기 동작'],
      [/pc-solo-note|\.pc-row\.solo/, '단독 보기 표시'], [/이름을 누르면/, '이름 누름 안내']]) assert.ok(!re.test(app), `${what}이 남아 있다`);
    const side = extractFunction(m, 'pcSideHtml');
    assert.ok(/<span class="pc-name">' \+ esc\(p\.name\) \+ '<\/span>'/.test(side) && !/<button[^']*pc-name/.test(side), '과제 이름이 누를 수 있는 단추다(보이기는 체크만 정한다)');
    assert.ok(!/cursor:pointer/.test(/\n\.pc-name\{[^}]*\}/.exec(app)?.[0] || 'cursor:pointer'), '.pc-name 이 누를 수 있는 모양(cursor:pointer)이다');
    assert.ok(!/solo/.test(extractFunction(m, 'pcPrefsSave')), '설정에 단독 보기를 저장한다');
    //  ② 복사 대응: 개인 탭 배지, 대응 지도, "등록됨" 이 없다. 부트스트랩의 copies 를 읽지 않는다.
    for (const [re, what] of [[/pcCopyBadge|pc-copy-badge/, '개인 탭 복사 배지'], [/PCAL\.copies|copyEntries|d\.copies/, '복사 대응 상태'],
      [/개인 일정에 등록됨|pcd-copied|d\.existed/, '"등록됨" 표시']]) assert.ok(!re.test(app), `${what}이 남아 있다`);
    //  ③ 미리보기: 막대를 눌러도 미리보기가 없다. 목록 줄에 [수정] 이 없다.
    assert.ok(!/pcOpenPreview|pc-pop-memo|pc-pop-acts/.test(app), '막대 미리보기가 남아 있다');
    assert.ok(!/data-act="edit"/.test(extractFunction(m, 'pcDayRowHtml') + extractFunction(m, 'pcOpenDayList')), '그날 일정 목록에 [수정] 이 있다');
    assert.ok(/pcOpenDayList\(ds, cell, \{ hit: bar\.dataset\.ev/.test(extractFunction(m, 'pcOnViewClick')), '막대를 누르면 누른 날짜 칸에 붙은 그날 일정 목록이 아니다');
    //  ④ 누른 줄 강조(2026-10-23 사용자): 줄에 hit 과 aria-current 가 없고, 강조 CSS 가 없다.
    assert.ok(!/' hit'|aria-current/.test(extractFunction(m, 'pcDayRowHtml')), '목록 줄에 누른 일정 강조(hit, aria-current)가 남아 있다');
    assert.ok(!/\.pc-dl \.chip(?:\.chip-timed)?\.hit/.test(app), '누른 일정 강조 CSS(.pc-dl .chip.hit)가 남아 있다');
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
test('정적③: 주기 확인 없음, 띠 자리, Esc, 방향키, 부팅 알림, 숨김 규칙, 글자 이스케이프', () => statics.wiring(src));
test('정적④: 과제 탭 문구와 주석의 기호 규칙', () => statics.punct(src));
test('정적⑤: 검토 반영으로 걷은 것(단독 보기, 복사 대응과 배지와 등록됨, 막대 미리보기와 목록 [수정], 누른 줄 강조)이 없다', () => statics.removed(src));
test('변이S⑤: 이름 단추, 복사 배지, 미리보기, 누른 줄 강조를 되돌리면 정적⑤ 가 잡는다', () => {
  assert.throws(() => statics.removed(mutate("'<span class=\"pc-nm\"><span class=\"pc-name\">' + esc(p.name) + '</span>'", "'<span class=\"pc-nm\"><button type=\"button\" class=\"pc-name\" data-act=\"solo\">' + esc(p.name) + '</button>'")), /단독 보기 동작|단추다/);
  assert.throws(() => statics.removed(mutate('      ${ovlBadge}\n    </div>', '      ${ovlBadge}\n      ${pcCopyBadge(e.id)}\n    </div>')), /복사 배지/);
  assert.throws(() => statics.removed(mutate('pcOpenDayList(ds, cell, { hit: bar.dataset.ev, projectUid: rowProj })', 'pcOpenPreview(bar.dataset.ev, bar, null)')), /미리보기|그날 일정 목록/);
  assert.throws(() => statics.removed(mutate("const cls = 'chip' + (timed ? ' chip-timed' : '');", "const cls = 'chip' + (timed ? ' chip-timed' : '') + (hit ? ' hit' : '');")), /강조\(hit/);
  assert.throws(() => statics.removed(mutate('.pc-dl-empty{', '.pc-dl .chip.hit{box-shadow:0 0 0 2px var(--accent)}\n.pc-dl-empty{')), /강조 CSS/);
});
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
  assert.throws(() => statics.wiring(mutate("'<span class=\"ctitle\">' + esc(e.title) + '</span>'", "'<span class=\"ctitle\">' + e.title + '</span>'")), /title 를 esc 없이/);
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
  //  옛 판이 남겼을 수 있는 단독 보기 값(solo)은 버린다(2026-10-22 저녁 단독 보기 제거). 나머지 설정은 그대로 산다.
  assert.deepStrictEqual(J(P.pcPrefsNorm('{"tab":"project","sel":["a"],"solo":"a","known":["a","b"]}')), { tab: 'project', view: 'month', sel: ['a'], known: ['a', 'b'], memo: false }, '옛 solo 값이 설정에 남았다');
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

  async function boot({ url = '', host = true, login = 'hjlee', prefs = null, source = src } = {}) {
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
      async bootstrap(projects = PROJECTS) { await W.reply('projectCalendarBootstrap', { ok: true, data: { projects, limits: { title: 200, location: 200, memo: 8000 } } }); },
      async load(events, extra = {}) {
        const p = W.last('projectCalendarLoad');
        await W.reply('projectCalendarLoad', { ok: true, data: Object.assign({ projects: (p.projectUids || []).map((u) => ({ projectUid: u, writable: u !== P3 })), events, excluded: [], from: p.from, to: p.to }, extra) });
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
    }
    return W;
  }
  async function withBoot(opts, fn) { const W = await boot(opts); try { return await fn(W); } finally { W.close(); } }
  //  달력에서 sel 을 눌러 그날 일정 목록을 연다.
  async function openList(W, sel) {
    await W.click(sel);
    const pop = W.el('pcPop');
    assert.ok(pop && /일정 목록$/.test(pop.getAttribute('aria-label') || ''), `${sel} 를 눌렀는데 그날 일정 목록이 뜨지 않았다`);
    return pop;
  }
  //  달력의 sel 을 눌러 목록을 열고, 첫 줄을 눌러 상세 창을 연다(누른 줄 강조는 없다, 2026-10-23).
  async function openDetail(W, sel = '#pcView .pc-ev') {
    const pop = await openList(W, sel);
    const row = pop.querySelector('.pc-dl .chip');
    assert.ok(row, '목록에 줄이 없다');
    await W.click(row);
    assert.ok(!W.el('pcDetailModal').classList.contains('hidden'), '목록의 줄을 눌렀는데 상세 창이 열리지 않았다');
    assert.ok(!W.el('pcPop'), '상세 창을 열었는데 목록이 남았다');
  }
  //  2026-10-23 사용자: 누른 줄 강조가 오히려 헷갈린다. 줄에 강조 표시(hit, aria-current)도 초점도 없고, 초점은 목록 창 자체다.
  function plainList(W, pop, what) {
    assert.ok(!pop.querySelector('.pc-dl .chip.hit, .pc-dl [aria-current]'), `${what}: 목록에 강조된 줄이 있다`);
    assert.strictEqual(W.doc.activeElement, W.el('pcPop'), `${what}: 초점이 목록 창이 아니다(줄에 초점을 두면 강조처럼 보인다)`);
  }
  //  막대 uid 의 date 칸을 누른다. jsdom 은 좌표가 없어 주 줄의 너비(700)를 꾸며 clientX 로 그 칸을 가리킨다(pcClickedDate).
  async function clickBarAt(W, uid, date) {
    const colOf = (from) => { for (let i = 0; i < 7; i++) if (W.ev(`addDays(${JSON.stringify(from)}, ${i})`) === date) return i; return -1; };
    const bar = [...W.qa(`#pcView .pc-ev[data-ev="${uid}"]`)].find((b) => {
      const wk = b.closest('[data-from]'); if (!wk) return false;
      const col = colOf(wk.dataset.from);
      return col >= Number(b.dataset.c0) && col <= Number(b.dataset.c1);
    });
    assert.ok(bar, `시험 준비: ${date} 를 지나는 막대가 없다`);
    const wk = bar.closest('[data-from]');
    wk.getBoundingClientRect = () => ({ left: 0, top: 0, right: 700, bottom: 100, width: 700, height: 100, x: 0, y: 0 });
    bar.dispatchEvent(new W.w.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: colOf(wk.dataset.from) * 100 + 50, clientY: 10 }));
    await settle();
    return bar;
  }
  const key = async (W, el, k) => { el.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); await settle(); };
  const EV = (n, o = {}) => Object.assign({ eventUid: U(n), projectUid: P1, title: '일정 ' + n, startDate: today(), endDate: today(), startTime: null, endTime: null,
    location: '', memo: '', rowVersion: 1, deleted: false, createdBy: '홍길동', updatedBy: '홍길동', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' }, o);

  test('화면①: 탭 전환이 개인 화면과 상단 단추를 숨기고 되돌린다, 탭 줄 아래로 장애 띠, 탭 진입은 목록과 범위를 읽는다', () => withBoot({}, async (W) => {
    assert.ok(W.el('pcTabs') && !W.doc.body.classList.contains('pc-on'), '처음은 개인 탭이어야 한다');
    //  개인 탭에는 과제 캘린더와 이어진 표시가 없다(복사 배지 제거, 기획 §6.7). 그래서 개인 탭으로 켜면 과제 캘린더를 읽지 않는다.
    assert.strictEqual(W.cmds('projectCalendarBootstrap').length, 0, '개인 탭인데 과제 목록을 읽었다');
    assert.strictEqual(W.cmds('projectCalendarLoad').length, 0, '개인 탭인데 과제 일정을 읽었다');
    await W.tab('project');
    assert.ok(W.doc.body.classList.contains('pc-on'), '과제 탭 표시(body.pc-on)가 없다');
    assert.strictEqual(W.el('pcTabProject').getAttribute('aria-selected'), 'true');
    for (const id of ['filterbar', 'dayPanel', 'btnSearch', 'btnPeerPick', 'btnReportTop', 'btnNew']) {
      assert.strictEqual(W.w.getComputedStyle(W.el(id)).display, 'none', `과제 탭에서 #${id} 가 보인다`);
    }
    assert.strictEqual(W.w.getComputedStyle(W.q('.topbar .nav')).display, 'none', '과제 탭에서 상단바 달 이동이 보인다');
    assert.notStrictEqual(W.w.getComputedStyle(W.el('pcView')).display, 'none', '과제 화면이 보이지 않는다');
    assert.strictEqual(W.cmds('projectCalendarBootstrap').length, 1, '탭 진입이 과제 목록을 읽지 않았다');
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
    const pop = await openList(W, '#pcView .pc-ev');
    assert.ok(!pop.querySelector('img, script, b'), '그날 일정 목록이 사용자 글을 요소로 그렸다');
    const row = pop.querySelector('.pc-dl .chip');
    assert.ok(row.textContent.includes(evil) && row.getAttribute('title').startsWith('<b>장비</b> 개발, '), '목록 줄의 제목이나 title(과제명)이 글자 그대로가 아니다');
    assert.strictEqual(W.w.__pwned, undefined);
  }));

  test('화면④: 왼쪽 목록(전체 선택, 전체 해제, 체크, 종료 읽기 전용), 이름을 눌러도 아무 일 없음, 계정별 설정에 빈 선택이 남는다', () => withBoot({}, async (W) => {
    await W.enter([]);
    assert.ok(/3 \/ 3/.test(W.q('#pcView .pc-side-h').textContent));
    assert.ok(/종료, 읽기 전용/.test(W.q(`#pcView .pc-row input[data-uid="${P3}"]`).closest('.pc-row').textContent), '종료된 과제에 읽기 전용 표시가 없다');
    const hint = W.q('#pcView .pc-hint').textContent;
    assert.ok(/체크하면 달력에 보이고, 해제하면 숨깁니다/.test(hint) && /내 과제에서 빠지지 않습니다/.test(hint) && !/이름/.test(hint), '목록 안내가 체크만 말하지 않는다: ' + hint);
    await W.click(`#pcView input[data-uid="${P2}"]`);
    assert.deepStrictEqual(W.last('projectCalendarLoad').projectUids, [P1, P3], '체크를 끄면 그 과제를 읽지 않아야 한다');
    await W.load([]);
    //  과제 이름은 글자다. 눌러도 읽기, 선택, 제목이 그대로다(단독 보기 없음, 기획 §6.7).
    const nm = [...W.qa('#pcView .pc-name')].find((e) => e.textContent === '플랫폼 개선');
    assert.ok(nm && nm.tagName === 'SPAN' && !nm.hasAttribute('data-act') && !nm.closest('button, a, label'), '과제 이름이 누를 수 있는 요소다');
    const l0 = W.cmds('projectCalendarLoad').length, sel0 = JSON.stringify(W.ev('PCAL.sel'));
    await W.click(nm);
    assert.strictEqual(W.cmds('projectCalendarLoad').length, l0, '이름을 누르자 일정을 다시 읽었다');
    assert.strictEqual(JSON.stringify(W.ev('PCAL.sel')), sel0, '이름을 누르자 표시 선택이 바뀌었다');
    assert.ok(/^전체 과제$/.test(W.q('#pcView .pc-title').textContent) && /2개 과제 표시/.test(W.q('#pcView .pc-sub').textContent), '머리가 "전체 과제, n개 과제 표시" 가 아니다');
    assert.ok(!W.q(`#pcView input[data-uid="${P2}"]`).checked, '이름을 누르자 체크가 바뀌었다');
    await W.click('#pcView [data-act="selNone"]');
    assert.ok(/표시할 과제를 선택하세요/.test(W.el('pcView').textContent), '0개 선택 안내가 없다');
    const saved = JSON.parse(W.w.localStorage.getItem('tc_pcal:hjlee'));
    assert.deepStrictEqual([saved.tab, saved.sel], ['project', []], '계정별 키에 빈 선택이 남지 않았다');
    await W.click('#pcView [data-act="selAll"]');
    assert.deepStrictEqual(W.last('projectCalendarLoad').projectUids, [P1, P2, P3]);
  }));

  test('화면④b: 체크한 과제가 하나이고 쓸 수 있으면 등록 폼에 그 과제, 둘 이상이거나 읽기 전용이면 "과제를 선택하세요", 옛 solo 설정은 무시', () => withBoot(
    { prefs: { 'tc_pcal:hjlee': JSON.stringify({ tab: 'project', view: 'month', sel: [P2], known: [P1, P2, P3], solo: P1 }) } },
    async (W) => {
      await W.bootstrap();
      assert.deepStrictEqual(W.last('projectCalendarLoad').projectUids, [P2], '옛 solo 값이 보이는 과제를 바꿨다(체크만 본다)');
      assert.ok(!('solo' in W.ev('PCAL')), 'PCAL 에 solo 상태가 있다');
      await W.load([]);
      const formProj = async () => { await W.click('#pcView [data-act="new"]'); const v = W.el('pcfProj').value, h = W.el('pcfProjHint').textContent; W.ev("closeModal('#pcFormModal')"); W.clock.advance(500); await settle(); return [v, h]; };
      assert.deepStrictEqual(await formProj(), [P2, ''], '체크한 과제가 하나(쓸 수 있음)인데 폼에 그 과제가 골라져 있지 않다');
      await W.click(`#pcView input[data-uid="${P1}"]`); await W.load([]);
      const two = await formProj();
      assert.strictEqual(two[0], '', '체크한 과제가 둘인데 하나를 미리 골랐다');
      assert.ok(/고르세요/.test(two[1]));
      await W.click(`#pcView input[data-uid="${P1}"]`); await W.click(`#pcView input[data-uid="${P2}"]`); await W.click(`#pcView input[data-uid="${P3}"]`); await W.load([]);
      assert.deepStrictEqual(J(W.ev('PCAL.sel')), [P3]);
      assert.strictEqual((await formProj())[0], '', '읽기 전용 과제 하나만 체크했는데 그 과제를 골랐다');
      const saved = JSON.parse(W.w.localStorage.getItem('tc_pcal:hjlee'));
      assert.ok(!('solo' in saved), '설정을 다시 쓸 때 옛 solo 값을 남겼다');
    }));

  test('화면⑤: 저장된 빈 선택은 다시 켜도 빈 선택이다(설정 없음과 다름), 마지막 탭과 주간을 되살린다, 날짜는 오늘', () => withBoot(
    { prefs: { 'tc_pcal:hjlee': JSON.stringify({ tab: 'project', view: 'week', sel: [], known: [P1, P2, P3], memo: true }), 'tc_pcal:other': JSON.stringify({ tab: 'personal' }) } },
    async (W) => {
      assert.ok(W.doc.body.classList.contains('pc-on'), '마지막 탭(과제)을 되살리지 않았다');
      await W.bootstrap();
      assert.strictEqual(W.cmds('projectCalendarLoad').length, 0, '빈 선택인데 일정을 읽었다');
      assert.ok(/표시할 과제를 선택하세요/.test(W.el('pcView').textContent));
      assert.strictEqual(W.ev('PCAL.view'), 'week');
      assert.strictEqual(W.ev('PCAL.memoLine'), true);
      assert.strictEqual(W.ev('PCAL.anchor'), today(), '날짜를 기억해 되살렸다(켤 때 오늘이어야 한다)');
    }));

  test('화면⑥: 그날 일정 목록의 모양(머리 날짜와 n건, 막대 줄과 시간 줄, 과제명은 줄 글자가 아니라 title), [수정] 없음, 줄은 상세, "이 날짜에 일정 등록"', () => withBoot({}, async (W) => {
    await W.enter([EV(1, { title: '첫째', memo: '메모 있음' }), EV(2, { title: '둘째', projectUid: P2, startTime: '14:00', endTime: '15:00' }), EV(3, { title: '종료 과제', projectUid: P3 })]);
    const pop = await openList(W, `#pcView .pc-day[data-date="${today()}"]`);
    assert.strictEqual(pop.querySelector('.pc-pop-title').textContent, W.ev(`pcMd(${JSON.stringify(today())})`), '머리가 "M월 D일 (요일)" 이 아니다');
    assert.strictEqual(pop.querySelector('.pc-pop-n').textContent, '일정 3건');
    const rows = [...pop.querySelectorAll('.pc-dl .chip')];
    assert.strictEqual(rows.length, 3);
    assert.ok(rows.every((r) => r.tagName === 'BUTTON' && r.dataset.act === 'dlOpen'), '줄 전체가 단추가 아니다');
    assert.ok(!pop.querySelector('[data-act="edit"]') && !/수정/.test(pop.textContent), '목록에 [수정] 이 있다(줄을 누르면 상세)');
    assert.ok(!/장비|플랫폼|구형/.test(pop.textContent), '줄 글자에 과제명이 있다(색이 과제를 가리킨다)');
    const r2 = pop.querySelector(`[data-ev="${U(2)}"]`), r1 = pop.querySelector(`[data-ev="${U(1)}"]`);
    assert.strictEqual(r2.getAttribute('title'), '플랫폼 개선, 14:00 ~ 15:00', '시간 줄의 title 이 "과제명, 시각" 이 아니다');
    assert.ok(/^플랫폼 개선, 14:00 ~ 15:00, 둘째/.test(r2.getAttribute('aria-label')), r2.getAttribute('aria-label'));
    assert.ok(r2.classList.contains('chip-timed') && r2.querySelector('.cdot') && r2.querySelector('.chip-t').textContent === '14:00', '시간 일정이 색 점과 시각이 아니다');
    assert.ok(!r1.classList.contains('chip-timed') && /border-left-color/.test(r1.getAttribute('style') || '') && r1.querySelector('.ctitle').textContent === '첫째', '날짜 일정이 과제 색 막대가 아니다');
    assert.ok(r1.querySelector('.pc-mi'), '메모 있음 표시가 제목 뒤에 없다');
    assert.ok(/, 읽기 전용$/.test(pop.querySelector(`[data-ev="${U(3)}"]`).getAttribute('aria-label')), '종료 과제 줄의 aria-label 에 읽기 전용이 없다');
    assert.ok(pop.querySelector('[data-act="newOn"]'), '"이 날짜에 일정 등록" 이 없다');
    await W.click(r2);
    assert.ok(!W.el('pcDetailModal').classList.contains('hidden') && /둘째/.test(W.el('pcDetailBody').textContent), '줄이 그 일정의 상세를 열지 않았다');
    W.ev("closeModal('#pcDetailModal')"); W.clock.advance(500); await settle();
    await openList(W, `#pcView .pc-day[data-date="${today()}"] .num`);
    await W.click('#pcPop [data-act="newOn"]');
    assert.strictEqual(W.el('pcfHead').textContent, '과제 일정 등록');
    assert.strictEqual(W.el('pcfStart').value, today());
    assert.strictEqual(W.el('pcfProj').value, '', '여러 과제를 볼 때 과제가 미리 골라져 있다(과제를 선택하세요 여야 한다)');
    assert.ok(![...W.el('pcfProj').options].some((o) => o.value === P3), '종료된 과제가 등록 목록에 있다');
    W.ev("closeModal('#pcFormModal')"); W.clock.advance(500); await settle();
    //  보이는 과제가 모두 읽기 전용이면 "이 날짜에 일정 등록" 이 없다(쓸 수 있는 과제가 다른 데 있어도).
    await W.click(`#pcView input[data-uid="${P1}"]`); await W.click(`#pcView input[data-uid="${P2}"]`); await W.load([EV(3, { title: '종료 과제', projectUid: P3 })]);
    const ro = await openList(W, `#pcView .pc-day[data-date="${today()}"]`);
    assert.ok(!ro.querySelector('[data-act="newOn"]'), '보이는 과제가 모두 읽기 전용인데 "이 날짜에 일정 등록" 이 있다');
    W.ev('pcEscape()');
  }));

  test('화면⑦: 달력에서 무엇을 누르든(막대, 시간 일정, 칸, 날짜 숫자, "+n", 주간) 그 날짜의 같은 목록, 어느 줄도 강조하거나 초점을 두지 않는다(초점은 목록 창)', () => withBoot({}, async (W) => {
    const t = today(), y = W.ev(`addDays(${JSON.stringify(t)}, -1)`), z = W.ev(`addDays(${JSON.stringify(t)}, 1)`);
    const evs = [EV(1, { title: '긴 일정', startDate: y, endDate: z }), EV(2, { title: '회의', projectUid: P2, startTime: '09:30', endTime: '10:00' }), EV(3, { title: '셋째' })];
    await W.enter(evs);
    const ids = (pop) => [...pop.querySelectorAll('.pc-dl .chip')].map((r) => r.dataset.ev);
    const plain = (pop, what) => plainList(W, pop, what);
    //  날짜 칸(빈 곳)이 기준 목록이다.
    const base = ids(await openList(W, `#pcView .pc-day[data-date="${t}"]`));
    assert.strictEqual(base.length, 3);
    plain(W.el('pcPop'), '칸');
    //  여러 날 막대: 누른 칸의 날짜(jsdom 은 좌표가 없어 이 주의 막대 첫 칸)의 목록이고, 그 막대 줄도 따로 강조하지 않는다.
    //  (jsdom 은 칸 높이가 0 이라 월간에는 차선이 하나만 보인다. 시간 일정 누름은 아래 주간에서 본다.)
    const bar = [...W.qa('#pcView .pc-ev')].find((b) => b.dataset.ev === U(1));
    const p1 = await openList(W, bar);
    const ds = W.ev('PCAL.anchor');
    assert.strictEqual(p1.querySelector('.pc-pop-title').textContent, W.ev(`pcMd(${JSON.stringify(ds)})`), '막대로 연 목록의 날짜가 선택한 날짜와 다르다');
    assert.ok(ds >= y && ds <= z, '막대 밖의 날짜로 열었다');
    assert.ok(ids(p1).includes(U(1)), '누른 막대의 일정이 목록에 없다');
    plain(p1, '막대');
    //  날짜 숫자와 "+n" 도 같은 목록이다(jsdom 은 칸 높이가 0 이라 차선이 하나만 보이고 나머지는 "+n").
    assert.deepStrictEqual(ids(await openList(W, `#pcView .pc-day[data-date="${t}"] .num`)), base, '날짜 숫자로 연 목록이 다르다');
    const more = W.q(`#pcView .pc-more[data-more="${t}"]`);
    assert.ok(more, '시험 준비: "+n" 이 없다');
    assert.deepStrictEqual(ids(await openList(W, more)), base, '"+n" 으로 연 목록이 다르다');
    //  주간: 막대와 칸도 같은 목록(모든 보이는 과제의 그날 일정)이다.
    await W.click('#pcView [data-act="view"][data-v="week"]'); await W.load(evs);
    //  시간 일정을 누르면 같은 목록이고, 그 줄에 강조도 초점도 없다.
    const timed = [...W.qa('#pcView .pc-wcells .pc-ev')].find((b) => b.dataset.ev === U(2));
    const p2 = await openList(W, timed);
    assert.deepStrictEqual(ids(p2), base, '시간 일정을 눌러 연 목록이 칸의 목록과 다르다');
    plain(p2, '시간 일정');
    const wbar = [...W.qa('#pcView .pc-wcells .pc-ev')].find((b) => b.dataset.ev === U(3));
    const pw = await openList(W, wbar);
    assert.deepStrictEqual(ids(pw), base, '주간 막대로 연 목록이 다르다');
    plain(pw, '주간 막대');
    const wcell = W.q(`#pcView .pc-wcells[data-proj="${P2}"] .pc-wday[data-date="${t}"]`);
    assert.deepStrictEqual(ids(await openList(W, wcell)), base, '주간 칸으로 연 목록이 다르다(과제 행으로 좁히지 않는다)');
    assert.strictEqual(W.q('#pcPop [data-act="newOn"]').dataset.proj, P2, '주간 과제 행에서 연 목록의 등록이 그 과제를 미리 고르지 않는다');
    //  막대 미리보기는 없다.
    assert.ok(!W.q('#pcPop [data-act="detail"]') && !W.q('#pcPop .pc-pop-memo'), '미리보기가 남아 있다');
  }));

  test('화면⑦d: 여러 날 막대를 누르면 목록 창은 막대가 아니라 누른 날짜 칸에 붙는다(월간 .pc-day, 주간 .pc-wday)', () => withBoot({}, async (W) => {
    const t = today(), y = W.ev(`addDays(${JSON.stringify(t)}, -1)`), z = W.ev(`addDays(${JSON.stringify(t)}, 1)`);
    const evs = [EV(1, { title: '사흘 일정', startDate: y, endDate: z })];
    await W.enter(evs);
    for (const [view, cellSel] of [['month', '.pc-day'], ['week', '.pc-wday']]) {
      if (view === 'week') { await W.click('#pcView [data-act="view"][data-v="week"]'); await W.load(evs); }
      for (const d of [t, z]) {
        const bar = await clickBarAt(W, U(1), d);
        assert.ok(W.el('pcPop'), `${view}: 막대를 눌렀는데 목록이 뜨지 않았다`);
        assert.strictEqual(W.ev('PCAL.anchor'), d, `${view}: 누른 날짜(${d})가 선택되지 않았다`);
        const a = W.ev('PCAL.pop.anchor');
        assert.ok(a && a !== bar && a.matches(`${cellSel}[data-date="${d}"]`), `${view}: 목록 창이 누른 날짜 칸(${cellSel}[data-date="${d}"])이 아니라 ${a && a.className} 에 붙었다`);
        assert.ok(bar.closest('[data-from]').contains(a), `${view}: 다른 주나 다른 과제 행의 칸에 붙었다`);
        W.ev('pcEscape()'); await settle();
      }
    }
  }));

  test('화면⑦b: 키보드(칸에서 Enter 로 목록, 위와 아래로 줄 이동, 왼쪽과 오른쪽은 달을 옮기지 않음, Esc 로 닫고 칸으로 초점)', () => withBoot({}, async (W) => {
    await W.enter([EV(1, { title: '하나' }), EV(2, { title: '둘', projectUid: P2 }), EV(3, { title: '셋' })]);
    const cell = W.q(`#pcView .pc-day[data-date="${today()}"]`);
    assert.strictEqual(cell.tabIndex, 0, '선택한 날짜 칸이 탭 순서에 없다');
    cell.focus();
    await key(W, cell, 'Enter');
    assert.ok(W.el('pcPop'), 'Enter 가 그날 일정 목록을 열지 않았다');
    const rows = [...W.qa('#pcPop .pc-dl .chip')];
    assert.strictEqual(W.doc.activeElement, W.el('pcPop'), '목록을 열면 초점은 목록 창 자체다(줄이 아니다)');
    await key(W, W.doc.activeElement, 'ArrowDown');
    assert.strictEqual(W.doc.activeElement, rows[0], '목록 창에서 아래 방향키가 첫 줄로 옮기지 않았다');
    await key(W, W.doc.activeElement, 'ArrowDown');
    assert.strictEqual(W.doc.activeElement, rows[1], '아래 방향키가 다음 줄로 옮기지 않았다');
    await key(W, W.doc.activeElement, 'ArrowUp');
    assert.strictEqual(W.doc.activeElement, rows[0], '위 방향키가 앞 줄로 옮기지 않았다');
    await key(W, W.doc.activeElement, 'End');
    assert.strictEqual(W.doc.activeElement, W.q('#pcPop [data-act="newOn"]'), 'End 가 맨 아래(등록)로 옮기지 않았다');
    await key(W, W.doc.activeElement, 'Home');
    assert.strictEqual(W.doc.activeElement, rows[0]);
    const a0 = W.ev('PCAL.anchor');
    await key(W, W.doc.activeElement, 'ArrowRight');
    assert.ok(W.el('pcPop') && W.ev('PCAL.anchor') === a0, '목록 안의 오른쪽 방향키가 달을 옮겼다');
    await W.click(W.doc.activeElement);   // 단추라 Enter 와 스페이스는 브라우저가 누름으로 바꾼다(jsdom 은 하지 않아 직접 누른다)
    assert.ok(!W.el('pcDetailModal').classList.contains('hidden'), '줄 단추가 상세를 열지 않았다');
    W.ev("closeModal('#pcDetailModal')"); W.clock.advance(500); await settle();
    const cell2 = W.q(`#pcView .pc-day[data-date="${today()}"]`);
    cell2.focus(); await key(W, cell2, 'Enter');
    await key(W, W.doc, 'Escape');
    assert.ok(!W.el('pcPop'), 'Esc 가 목록을 닫지 않았다');
    assert.strictEqual(W.doc.activeElement, cell2, 'Esc 로 닫은 뒤 초점이 칸으로 돌아가지 않았다');
  }));

  test('화면⑦c: 상세 창은 전체 메모, 날짜, 시간, 장소, 글쓴이, 마지막 수정과 단추 셋(수정, 개인 일정에 등록, 삭제). 수정은 폼', () => withBoot({}, async (W) => {
    await W.enter([EV(1, { title: '상세 볼 일정', memo: '1\n2\n3\n4\n5', location: '3층', createdBy: '가', updatedBy: '나', startTime: '09:00', endTime: '10:00' })]);
    await openDetail(W);
    const body = W.el('pcDetailBody').textContent;
    assert.ok(/1\n2\n3\n4\n5/.test(body) && /3층/.test(body) && /글쓴이가/.test(body) && /마지막 수정나/.test(body) && /09:00 ~ 10:00/.test(body) && /날짜/.test(body), body);
    const acts = [...W.qa('#pcDetailFoot [data-act]')].map((b) => b.dataset.act);
    assert.deepStrictEqual(acts, ['delete', 'copy', 'edit'], '상세의 단추가 삭제, 개인 일정에 등록, 수정이 아니다');
    assert.ok(/개인 일정에 등록$/.test(W.q('#pcDetailFoot [data-act="copy"]').textContent.trim()) && !W.q('#pcDetailFoot [data-act="copy"]').disabled);
    await W.click('#pcDetailFoot [data-act="edit"]');
    assert.ok(!W.el('pcFormModal').classList.contains('hidden'), '상세의 수정이 폼을 열지 않았다');
    assert.strictEqual(W.el('pcfHead').textContent, '과제 일정 수정');
    assert.strictEqual(W.el('pcfTitle').value, '상세 볼 일정');
    assert.ok(W.el('pcfProj').disabled, '수정 때 과제를 바꿀 수 있다');
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
    await W.reply('projectCalendarSave', { ok: true, data: { event: EV(5, { eventUid: s.eventUid, title: '새 일정' }), rowVersion: 1, replayed: false } });
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
    await openDetail(W);
    await W.click('#pcDetailFoot [data-act="edit"]');
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

  test('화면⑫: 개인 일정에 등록은 확인 창 없이, 개인 저장이 끝난 뒤에만 보내고, 사본이라 누를 때마다 새로 보낸다(두 번이면 두 번, 등록됨과 배지 없음)', () => withBoot({}, async (W) => {
    await W.enter([EV(1, { title: '복사할 일정', rowVersion: 2 })]);
    await openDetail(W);
    //  개인 저장이 진행 중이면 기다린다(그 저장이 끝나기 전에는 복사를 보내지 않는다)
    W.ev("state.entries.push({ id:'e-mine', date:'2026-10-01', title:'내 것', categoryId:'c-2', allDay:true, startTime:'', endTime:'', memo:'', location:'', source:'', commits:[] }); save();");
    await settle();
    const sv = W.pending('saveState');
    assert.strictEqual(sv.length, 1, '개인 저장이 나가지 않았다(시험 준비)');
    await W.click('#pcDetailFoot [data-act="copy"]');
    assert.ok(W.el('confirmModal').classList.contains('hidden'), '개인 일정에 등록이 확인 창을 띄웠다(2026-10-23 바로 등록)');
    assert.strictEqual(W.cmds('projectCalendarCopy').length, 0, '개인 저장이 끝나기 전에 복사를 보냈다');
    sv[0].__done = true; W.ev('__hostReply(' + JSON.stringify(sv[0].reqId) + ',{"ok":true})'); await settle();
    const c = W.last('projectCalendarCopy');
    assert.ok(c, '개인 저장이 끝났는데 복사를 보내지 않았다');
    assert.deepStrictEqual([c.projectUid, c.eventUid, c.expectedVersion], [P1, U(1), 2]);
    assert.ok(W.el('pcDetailModal').dataset.busy === '1' && W.q('#pcDetailFoot [data-act="copy"]').disabled, '보내는 동안 상세 창과 단추를 붙들지 않는다(다시 눌러 두 건)');
    await W.reply('projectCalendarCopy', { ok: true, data: { entryUid: 'e-copy-1', eventUid: U(1), projectUid: P1, personalRev: 3 } });
    assert.ok(W.toasts().some((t) => /개인 일정에 등록했습니다/.test(t)), '등록 알림이 없다');
    const btn = W.q('#pcDetailFoot [data-act="copy"]');
    assert.ok(btn && !btn.disabled && !/등록됨/.test(W.el('pcDetailFoot').textContent) && !W.el('pcDetailModal').dataset.busy, '등록 뒤 상세가 "등록됨" 으로 바뀌었거나 단추가 꺼졌다(사본이라 다시 등록할 수 있어야 한다)');
    //  두 번째 등록: 확인 창 없이 새 변경 id 로 한 번 더 보낸다(화면이 막지 않는다. 호스트가 새 개인 일정을 하나 더 만든다).
    await W.click(btn);
    assert.ok(W.el('confirmModal').classList.contains('hidden'), '두 번째 등록이 확인 창을 띄웠다');
    const c2 = W.last('projectCalendarCopy');
    assert.strictEqual(W.cmds('projectCalendarCopy').length, 2, '두 번째 등록을 보내지 않았다(사본은 누를 때마다 새로)');
    assert.notStrictEqual(c2.mutationUid, c.mutationUid, '두 번째 등록이 같은 변경 id 로 나갔다');
    await W.reply('projectCalendarCopy', { ok: true, data: { entryUid: 'e-copy-2', eventUid: U(1), projectUid: P1, personalRev: 4 } });
    //  호스트가 개인 스냅샷을 다시 실어도(§5.5 3번) 개인 탭 카드는 보통 개인 일정이다(출처 배지 없음).
    W.ev("closeModal('#pcDetailModal')"); W.clock.advance(500); await settle();
    const ent = (id) => ({ id, date: today(), title: '복사할 일정', categoryId: 'db-' + P1, allDay: false, startTime: '', endTime: '', memo: '', location: '', source: '', commits: [], createdAt: '', updatedAt: '' });
    await W.applyState([ent('e-copy-1'), ent('e-copy-2')]);
    await W.tab('personal');
    W.ev(`selectedDate = ${JSON.stringify(today())}; renderAll();`);
    const cards = W.qa('#dpBody .card[data-id^="e-copy-"]');
    assert.strictEqual(cards.length, 2, '개인 탭에 두 사본이 보이지 않는다');
    assert.ok(cards.every((cd) => !/과제 캘린더에서 복사/.test(cd.textContent) && !cd.querySelector('.pc-copy-badge')), '개인 탭 카드에 복사 배지가 있다');
    assert.strictEqual(W.cmds('projectCalendarBootstrap').length, 1, '개인 탭으로 돌아오며 배지 때문에 과제 목록을 다시 읽었다');
  }));

  test('화면⑫b: 개인 일정에 등록을 누르면 확인 창 없이 바로 projectCalendarCopy 를 보내고, 결과는 알림 하나(실패도 알림)', () => withBoot({}, async (W) => {
    await W.enter([EV(1, { title: '바로 등록', rowVersion: 5 })]);
    await openDetail(W);
    await W.click('#pcDetailFoot [data-act="copy"]');
    assert.ok(W.el('confirmModal').classList.contains('hidden'), '개인 일정에 등록이 확인 창을 띄웠다(2026-10-23 바로 등록)');
    const c = W.last('projectCalendarCopy');
    assert.ok(c, '누르자마자 복사를 보내지 않았다');
    assert.deepStrictEqual([c.projectUid, c.eventUid, c.expectedVersion], [P1, U(1), 5]);
    await W.reply('projectCalendarCopy', { ok: false, error: { kind: 'network', message: '' } });
    assert.ok(W.toasts().some((x) => /개인 일정에 등록하지 못했습니다/.test(x)), '실패 알림이 없다');
    assert.ok(W.el('confirmModal').classList.contains('hidden'), '실패 뒤 확인 창이 떴다');
    assert.ok(!W.q('#pcDetailFoot [data-act="copy"]').disabled, '실패 뒤 단추가 꺼진 채다');
  }));

  test('화면⑬: 내 개인 저장이 막혀 있으면(미저장) 복사하지 않는다, 종료 과제는 수정 삭제 단추가 없고 등록은 된다', () => withBoot({}, async (W) => {
    await W.enter([EV(3, { projectUid: P3, title: '종료 과제 일정' })]);
    await openDetail(W);
    assert.ok(!W.q('#pcDetailFoot [data-act="edit"]') && !W.q('#pcDetailFoot [data-act="delete"]'), '종료 과제의 상세에 수정이나 삭제가 있다(쓸 수 있는 과제만)');
    assert.ok(!W.q('#pcDetailFoot [data-act="copy"]').disabled, '종료 과제도 개인 등록은 된다(기획 §6.6)');
    W.ev('setUnsaved(true)');
    await W.click('#pcDetailFoot [data-act="copy"]');
    assert.ok(W.el('confirmModal').classList.contains('hidden'), '편집 잠금인데 확인 창이 떴다');
    assert.strictEqual(W.cmds('projectCalendarCopy').length, 0, '미저장 변경이 있는데 복사를 보냈다');
  }));

  test('화면⑭: 과제가 없으면 내 과제 창 안내(공식 과제 추가 진입 없음), 목록 읽기 실패는 다시 시도', () => withBoot({}, async (W) => {
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
    await openDetail(W);
    await W.click('#pcDetailFoot [data-act="delete"]');
    assert.ok(/이 일정을 삭제할까요/.test(W.el('confirmModal').textContent));
    await W.click('#cfOk');
    const d = W.last('projectCalendarDelete');
    assert.deepStrictEqual([d.projectUid, d.eventUid, d.expectedVersion], [P1, U(1), 7]);
    await W.reply('projectCalendarDelete', { ok: true, data: { eventUid: U(1), rowVersion: 8, deleted: true } });
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
    await openDetail(W); grab(W.el('pcDetailModal'));
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
      await openDetail(W);
      W.ev("state.entries.push({ id:'e-mine', date:'2026-10-01', title:'내 것', categoryId:'c-2', allDay:true, startTime:'', endTime:'', memo:'', location:'', source:'', commits:[] }); save();"); await settle();
      await W.click('#pcDetailFoot [data-act="copy"]');
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
  test('변이R③: 누른 줄 강조(hit 과 그 줄 초점)를 되살리면 화면⑦ 의 강조와 초점 검사가 잡는다', async () => {
    let bad = mutate("const cls = 'chip' + (timed ? ' chip-timed' : '');", "const cls = 'chip' + (timed ? ' chip-timed' : '') + (hit ? ' hit' : '');");
    bad = mutate('  try{ pop.focus({ preventScroll: true }); }catch(_){}', "  try{ (pop.querySelector('.pc-dl .chip.hit') || pop).focus(); }catch(_){}", bad);
    const W = await boot({ source: bad });
    try {
      const evs = [EV(1, { title: '하나' }), EV(2, { title: '둘', startTime: '09:00', endTime: '10:00' })];
      await W.enter(evs);
      await W.click('#pcView [data-act="view"][data-v="week"]'); await W.load(evs);
      const timed = [...W.qa('#pcView .pc-wcells .pc-ev')].find((x) => x.dataset.ev === U(2));
      const pop = await openList(W, timed);
      assert.throws(() => plainList(W, pop, '변이'), /강조된 줄/, '변이가 강조를 되살리지 못했다(화면⑦ 이 잡을 차이가 없다)');
      pop.querySelector('.chip.hit').classList.remove('hit');
      assert.throws(() => plainList(W, pop, '변이'), /초점이 목록 창이 아니다/, '변이가 줄 초점을 되살리지 못했다');
    } finally { W.close(); }
  });
  test('변이R⑥: 막대 목록 창을 막대에 붙이면(옛 동작) 화면⑦d 가 잡는다', async () => {
    const bad = mutate('pcOpenDayList(ds, cell, { hit: bar.dataset.ev, projectUid: rowProj })', 'pcOpenDayList(ds, bar, { hit: bar.dataset.ev, projectUid: rowProj })');
    const W = await boot({ source: bad });
    try {
      const t0 = today(), z = W.ev(`addDays(${JSON.stringify(t0)}, 1)`);
      await W.enter([EV(1, { startDate: W.ev(`addDays(${JSON.stringify(t0)}, -1)`), endDate: z })]);
      const bar = await clickBarAt(W, U(1), z);
      assert.strictEqual(W.ev('PCAL.pop.anchor'), bar, '변이가 목록 창을 막대에 붙이지 못했다(화면⑦d 가 잡을 차이가 없다)');
    } finally { W.close(); }
  });
  test('변이R④: 상세를 "등록됨" 으로 끄면(옛 동작) 화면⑫ 의 두 번째 등록 검사가 잡는다', async () => {
    const bad = mutate("  toast('개인 일정에 등록했습니다. 개인 탭에서 볼 수 있습니다.', 'success');", "  toast('개인 일정에 등록했습니다. 개인 탭에서 볼 수 있습니다.', 'success'); const zb = document.querySelector('#pcDetailFoot [data-act=\"copy\"]'); if(zb){ zb.disabled = true; zb.textContent = '개인 일정에 등록됨'; }");
    const W = await boot({ source: bad });
    try {
      await W.enter([EV(1, { rowVersion: 2 })]);
      await openDetail(W);
      await W.click('#pcDetailFoot [data-act="copy"]');
      await W.reply('projectCalendarCopy', { ok: true, data: { entryUid: 'e-copy-1', eventUid: U(1), projectUid: P1, personalRev: 3 } });
      const btn = W.q('#pcDetailFoot [data-act="copy"]');
      assert.ok(btn.disabled && /등록됨/.test(W.el('pcDetailFoot').textContent), '변이가 상세를 "등록됨" 으로 바꾸지 못했다(화면⑫ 가 잡을 차이가 없다)');
    } finally { W.close(); }
  });
  test('변이R⑤: 개인 일정에 등록에 확인 창을 되살리면 화면⑫b 가 잡는다', async () => {
    const bad = mutate('  //  확인 창 없이 바로 넣고 결과만 알린다(2026-10-23 사용자).', "  if(await confirmBox('개인 일정에 등록할까요?', e.title, '등록', null, { ok: 'safe' }) !== 'ok') return;\n  //  확인 창 없이 바로 넣고 결과만 알린다(2026-10-23 사용자).");
    const W = await boot({ source: bad });
    try {
      await W.enter([EV(1, { rowVersion: 5 })]);
      await openDetail(W);
      await W.click('#pcDetailFoot [data-act="copy"]');
      assert.ok(!W.el('confirmModal').classList.contains('hidden') && !W.last('projectCalendarCopy'), '변이가 확인 창을 띄우지 못했다(화면⑫b 가 잡을 차이가 없다)');
    } finally { W.close(); }
  });
}

//  창 복귀 새로고침(pcLoad)과 목록 열기가 겹치면 다시 그리기가 목록을 닫았다(2026-10-22 실제 앱). 열려 있던 날짜 목록은 다시 연다.
test('다시 읽기가 끝나도 열려 있던 그날 일정 목록을 다시 연다', () => {
  const html = readText(R('task-calendar-prototype.html'));
  assert.ok(/PCAL\.pop\.day = \{ ds, hit, projectUid/.test(html), '목록이 날짜를 기억한다(다시 열 때 같은 날짜와 과제 힌트)');
  assert.ok(/const keepDay = PCAL\.pop && PCAL\.pop\.day;\n\s+if\(pcOn\(\)\)\{ pcRender\(\); if\(keepDay\) pcReopenDay\(keepDay\); \}/.test(html), 'pcLoad 가 그린 뒤 목록을 다시 연다');
});
