// Git, SVN 기능 전량 삭제(2026-10-26, docs/GIT-SVN-REMOVAL.md §4, §5): 웹 쪽 지킴이.
//
// 이 파일이 지키는 것:
//   (S) 정적: task-calendar-prototype.html 에 Git, SVN 기능의 식별자가 다시 생기지 않는다(호스트 명령 gitlog, gitauthor,
//       gitcheck, pickfolder 호출, 과제 창 #gitCard, 기록 창, 커밋 탭, 일괄과 그날 커밋 창, 저장소 경로, 작성자, 커밋 본문 설정,
//       커밋 목록 정규화와 메모 이관, 커밋 기록 판정 등). 예외는 아래 허용 목록 하나뿐이다:
//         - 옛 흔적을 '읽지 않고 버리는' 두 함수(isLegacyGitEntry, dropLegacyGit). 그 함수가 옛 키 이름을 알아야 지울 수 있다.
//       이름만 git 처럼 보이는 공용 이름(.git-hint, .git-opt, .git-note, badge-git, gitaTaskId 등)은 금지 목록에 없으므로 걸리지 않는다.
//   (R) jsdom 행동:
//       - 옛(0.12 꼴) XML 가져오기: source="git" 기록은 통째로 버리고, 나머지 기록과 할 일은 그대로 들어온다.
//         커밋 목록, 저장소 경로와 버전관리 종류, 작성자, 커밋 본문 설정은 읽지 않는다.
//       - XML 내보내기: 커밋, 저장소, 작성자, source 속성을 쓰지 않는다(옛 키가 객체에 남아 있어도).
//       - 옛 localStorage 와 옛 DB 스냅숏(buildStateFrom): 커밋 기록을 버리고 옛 키를 지운다.
//       - 보고서 데이터: 커밋 항목이 없다(옛 commits 배열이 남아 있어도 제목으로 펼치지 않는다).
//       - 과제 데이터 내보내기: 호스트로 가는 exportResearch 의 값은 {project, calendarMd, from, to} 넷뿐이다.
//   (M) 변이: 금지 식별자를 하나 되살리면 (S)가 잡는다. 허용 목록 밖에서 옛 키를 쓰면 잡는다.
// 생략 규약: jsdom 이 없으면 (R)은 등록되지 않고 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

// ── (S) 정적 ──────────────────────────────────────────────────────────
//  금지 식별자. [정규식, 이름]. 문자열 그대로 찾는다(주석도 본다: 주석에 남은 옛 이름도 되살림의 씨앗이다).
const FORBIDDEN = [
  [/'gitlog'|'gitauthor'|'gitcheck'|'pickfolder'/, '호스트 명령 gitlog, gitauthor, gitcheck, pickfolder'],
  [/gitCard/, '과제 창 Git 카드(#gitCard)'],
  [/entryModal|openEntryModal|saveEntryFromForm/, '기록 창(#entryModal)'],
  [/dptab-git|renderGitTab|gitFeed/, '커밋 내역 탭'],
  [/bulkGitModal|dayGitModal|runGitImport|openBulkGitFetch|openDayGitFetch/, '일괄, 그날 커밋 불러오기'],
  [/fetchCommitsForCat|gitEnabledCats|mergeGitSvnCommits|detectGitAuthor|browseRepoFor|validateExistingRepoFor/, '커밋 불러오기, 저장소 카드'],
  [/gitRepo|svnRepo|usesRepo/, '과제의 저장소 경로'],
  [/gitAuthor|svnAuthor|cGitAuthor|cSvnAuthor/, '작성자 설정'],
  [/gitCommitBody|setGitCommitBody|syncGitBodyChecks|bgBodyChk|dgBodyChk/, '커밋 본문 설정'],
  [/normCommits|migrateGitMemo|mergeCommitsPreserveEdits|commitRowHtml|COMMIT_PREVIEW/, '커밋 목록 정규화와 메모 이관'],
  [/setCommitMessage|deleteCommitRow|commitCommitEdit|editingCommitKey/, '커밋 고치기와 지우기'],
  [/source\s*[!=]==?\s*'git'|'git'\s*[!=]==?\s*\w*\.?source/, "커밋 기록 판정(source === 'git')"],
  [/\.commits\b|\bcommits\s*:/, '기록의 커밋 목록(commits)'],
  [/rptSrcGit|src\.git\b|kind\s*:\s*'git'/, '보고서 출처 커밋 내역'],
  [/ICON\.git\b|chip-git|fchip-git|cat-git|nd-commit|commit-row|commit-head|git-card|git-badge|vcs-sect/, '커밋, 저장소 표시와 그 CSS'],
  [/filterSource/, '커밋 전용 출처 필터(filterSource)'],
  [/btnGitHere|btnGitBulk|btnGitFetch|btnGitBrowse|btnSvnBrowse|btnDayGitRun|btnBulkRun/, '커밋 불러오기 버튼'],
  [/data-goto="g-git"|id="g-git"|'git_1'|"git_1"/, '사용설명서 Git 장'],
];
//  허용 목록: 옛 흔적을 읽지 않고 버리는 두 함수. 이 둘만 옛 키 이름을 쓴다.
const ALLOW_FNS = ['isLegacyGitEntry', 'dropLegacyGit'];
function scanned(src) {
  let s = src;
  for (const fn of ALLOW_FNS) {
    let body = '';
    try { body = extractFunction(s, fn); } catch (_) { assert.fail(`허용 목록 함수 ${fn} 이 사라졌다: 옛 흔적을 버리는 자리가 없으면 옛 파일과 옛 DB 의 커밋 기록이 일반 기록으로 섞인다`); }
    s = s.replace(body, '');
  }
  //  사용설명서 그림 줄(base64)은 글자가 아니라 그림이다. 우연한 글자 조합을 보지 않는다.
  s = s.split('\n').filter((l) => !l.startsWith('const GUIDE_SHOTS = ')).join('\n');
  return s;
}
const checks = {
  noGitIdentifiers(src) {
    const s = scanned(src);
    const hits = [];
    for (const [re, name] of FORBIDDEN) {
      const m = re.exec(s);
      if (m) {
        const line = s.slice(0, m.index).split('\n').length;
        hits.push(`${name}: '${m[0]}' (거른 소스 ${line}번째 줄 근처)`);
      }
    }
    assert.deepStrictEqual(hits, [], 'Git, SVN 기능의 흔적이 되살아났다:\n  ' + hits.join('\n  '));
  },
  //  옛 흔적을 버리는 자리가 실제로 그 일을 한다(이름만 남은 껍데기가 아니다).
  legacyDropWired(src) {
    const drop = extractFunction(src, 'dropLegacyGit');
    for (const k of ['gitRepo', 'svnRepo', 'usesRepo', 'gitAuthor', 'svnAuthor', 'gitCommitBody', 'commits', 'source']) {
      assert.ok(new RegExp('delete [\\w.]*\\b' + k + '\\b').test(drop), `dropLegacyGit 이 옛 키 ${k} 를 지우지 않는다`);
    }
    assert.ok(/filter\(e => !isLegacyGitEntry\(e\)\)/.test(drop), 'dropLegacyGit 이 커밋 기록을 버리지 않는다');
    assert.ok(/dropLegacyGit\(data\);/.test(extractFunction(src, 'buildStateFrom')), 'buildStateFrom(옛 DB 스냅숏)이 옛 흔적을 버리지 않는다');
    assert.ok(/dropLegacyGit\(s\);/.test(extractFunction(src, 'load')), 'load(옛 localStorage)가 옛 흔적을 버리지 않는다');
    assert.ok(/filter\(e => !isLegacyGitEntry\(\{ source: e\.getAttribute\('source'\) \}\)\)/.test(extractFunction(src, 'fromXML')), 'fromXML(옛 XML)이 커밋 기록을 버리지 않는다');
  },
  //  과제 데이터 내보내기 문구가 patch 를 약속하지 않는다.
  exportCopy(src) {
    const a = src.indexOf('<div class="overlay hidden" id="exportModal">');
    const modal = src.slice(a, src.indexOf('</div>\n</div>', a));
    assert.ok(a > 0 && /<h2>과제 데이터 내보내기<\/h2>/.test(modal), '내보내기 창 제목이 「과제 데이터 내보내기」가 아니다(호스트 폴더 이름과 맞춘다)');
    const words = modal.replace(/<[^>]*>/g, ' ');   // 보이는 글만(class 이름 git-hint 같은 공용 이름은 보지 않는다)
    assert.ok(!/patch|커밋|Git|SVN/i.test(words), '내보내기 창이 아직 커밋, patch, Git, SVN 을 말한다');
    assert.ok(/캘린더\.md/.test(modal), '내보내기 창이 무엇을 만드는지(캘린더.md) 말하지 않는다');
    assert.ok(/hostRequest\('exportResearch', \{ project: cat\.name, calendarMd: md, from, to \}, 120000\)/.test(extractFunction(src, 'runResearchExport')),
      'exportResearch 에 보내는 값이 {project, calendarMd, from, to} 넷이 아니다');
  },
};

test('(S) Git, SVN 기능 식별자가 HTML 에 없다(허용: 옛 흔적을 버리는 두 함수)', () => checks.noGitIdentifiers(app));
test('(S) 옛 흔적 버리기가 load, buildStateFrom, fromXML 세 입구에 걸려 있고 옛 키를 모두 지운다', () => checks.legacyDropWired(app));
test('(S) 과제 데이터 내보내기 창은 patch 를 약속하지 않고 호스트로 넷만 보낸다', () => checks.exportCopy(app));

// ── (M) 변이 ─────────────────────────────────────────────────────────
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다(리팩터로 사라졌다면 앵커를 갱신할 것): ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}
test('변이 S1: 호스트 gitlog 호출을 되살리면 (S)가 잡는다', () => {
  const bad = mutate(app, 'function qaSave(){', "async function _g(){ return hostRequest('gitlog', {}); }\nfunction qaSave(){");
  assert.throws(() => checks.noGitIdentifiers(bad), /gitlog/);
});
test("변이 S2: 그리드에 커밋 기록 거르기(source === 'git')를 되살리면 (S)가 잡는다", () => {
  const bad = mutate(app, '    if(pick && !pick(e)) continue;   // 나란히 보기', "    if(e.source === 'git') continue;\n    if(pick && !pick(e)) continue;   // 나란히 보기");
  assert.throws(() => checks.noGitIdentifiers(bad), /source === 'git'/);
});
test('변이 S3: 과제에 저장소 경로를 다시 실으면 (S)가 잡는다(허용 함수 밖)', () => {
  const bad = mutate(app, "  const c = {id:uid('c'), name, color, desc:desc||'', createdAt:nowIso()};", "  const c = {id:uid('c'), name, color, desc:desc||'', gitRepo:'', createdAt:nowIso()};");
  assert.throws(() => checks.noGitIdentifiers(bad), /gitRepo/);
});
test('변이 S4: dropLegacyGit 이 커밋 기록을 거르지 않으면 배선 검사가 잡는다', () => {
  const bad = mutate(app, '    s.entries = s.entries.filter(e => !isLegacyGitEntry(e));\n', '');
  assert.throws(() => checks.legacyDropWired(bad), /커밋 기록을 버리지 않는다/);
});
test('변이 S5: exportResearch 에 저장소 경로를 다시 실으면 내보내기 검사가 잡는다', () => {
  const bad = mutate(app, "{ project: cat.name, calendarMd: md, from, to }, 120000", "{ project: cat.name, calendarMd: md, repo: '', from, to }, 120000");
  assert.throws(() => checks.exportCopy(bad), /넷이 아니다/);
});

// ── (R) jsdom ────────────────────────────────────────────────────────
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('git-removal-web: jsdom 미설치: 옛 XML, 내보내기, 보고서, 옛 저장본 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const quiet = () => (jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);
  const shims = (win) => {
    if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
    win.scrollTo = () => {};
    win.HTMLElement.prototype.scrollIntoView = function () {};
  };
  //  브라우저 모드(HOST=false). before(win) 로 부팅 전에 localStorage 를 심을 수 있다.
  function bootBrowser(before) {
    const dom = new JSDOM(app, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quiet(),
      beforeParse(win) { shims(win); if (before) before(win); } });
    const w = dom.window;
    return { w, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')), close: () => { try { w.close(); } catch (_) {} } };
  }
  //  위젯 모드(HOST=true): 호스트로 가는 메시지를 붙잡는다.
  function bootWidget() {
    const posted = [];
    const dom = new JSDOM(app, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quiet(),
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); }, addEventListener() {}, removeEventListener() {} } };
        shims(win);
      } });
    const w = dom.window;
    return { w, posted, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')), close: () => { try { w.close(); } catch (_) {} } };
  }
  const CA = '2026-07-01T00:00:00.000Z';

  //  옛(0.12 꼴) XML: 루트 작성자 속성, 과제의 vcs/gitRepo/svnRepo, 커밋 기록(source="git" + <commits>),
  //  일반 기록에 붙은 <commits>, prefs 의 gitCommitBody 를 모두 담았다.
  const OLD_XML =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<taskCalendar version="1" generator="TaskCalendar-Prototype" gitAuthor="hong@corp.com" svnAuthor="phmin">' +
    '<categories>' +
    '<category id="c-1" color="#3e5be0" gitRepo="C:/repo/a" createdAt="' + CA + '"><name>보고서 작성</name><description>설명</description></category>' +
    '<category id="c-2" color="#2e9e6b" vcs="svn" gitRepo="C:/wc/b" svnRepo="" createdAt="' + CA + '"><name>시스템 점검</name><description></description></category>' +
    '</categories>' +
    '<entries>' +
    '<entry id="e-1" date="2026-07-08" categoryId="c-1" allDay="false" startTime="10:00" endTime="11:00" createdAt="' + CA + '" updatedAt="' + CA + '">' +
    '<title>요구사항 정리</title><memo>명세 작성</memo>' +
    '<commits><commit hash="x1" short="x1" time="09:00" subject="일반 기록에 붙은 커밋">본문</commit></commits></entry>' +
    '<entry id="e-git" date="2026-07-08" categoryId="c-2" source="git" allDay="true" startTime="" endTime="" createdAt="' + CA + '" updatedAt="' + CA + '">' +
    '<title>작업일지</title><memo>[Git 커밋 2건 · 시스템 점검]\n• 09:15 첫 커밋 (aaaaaa1)</memo>' +
    '<commits><commit hash="aaaaaaa111" short="aaaaaa1" time="09:15" subject="첫 커밋">본문</commit><commit hash="b2" short="b2" time="10:00" subject="둘째 커밋"></commit></commits></entry>' +
    '<entry id="e-3" date="2026-07-09" categoryId="c-2" allDay="true" startTime="" endTime="" createdAt="' + CA + '" updatedAt="' + CA + '">' +
    '<title>점검 회의</title><memo></memo></entry>' +
    '</entries>' +
    '<todos><todo id="t-1" done="false" categoryId="c-1" due="2026-07-08" prio="normal" createdAt="' + CA + '" updatedAt="' + CA + '"><text>검토</text><note></note></todo></todos>' +
    '<prefs reportMarker="-" reportIndent="2" gitCommitBody="1"/>' +
    '</taskCalendar>';

  const B = bootBrowser();

  test('(R) 옛 XML: 커밋 기록(source="git")은 통째로 버리고 나머지 기록, 과제, 할 일은 그대로 들어온다', () => {
    const p = B.evJSON('fromXML(' + JSON.stringify(OLD_XML) + ')');
    assert.deepStrictEqual(p.entries.map((e) => e.id), ['e-1', 'e-3'], '커밋 기록이 남았거나 다른 기록까지 빠졌다');
    const e1 = p.entries.find((e) => e.id === 'e-1');
    assert.strictEqual(e1.title, '요구사항 정리'); assert.strictEqual(e1.memo, '명세 작성');
    assert.strictEqual(e1.startTime, '10:00');
    for (const e of p.entries) assert.ok(!('source' in e) && !('commits' in e), `기록 ${e.id} 에 source/commits 가 남았다`);
    assert.deepStrictEqual(p.categories.map((c) => c.name), ['보고서 작성', '시스템 점검']);
    assert.strictEqual(p.categories[0].desc, '설명');
    for (const c of p.categories) for (const k of ['gitRepo', 'svnRepo', 'vcs', 'usesRepo']) assert.ok(!(k in c), `과제 ${c.id} 에 ${k} 가 남았다`);
    for (const k of ['gitAuthor', 'svnAuthor', 'gitCommitBody']) assert.ok(!(k in p), `가져온 결과에 ${k} 가 남았다`);
    assert.deepStrictEqual(p.todos.map((t) => t.text), ['검토'], '할 일이 들어오지 않았다');
    assert.strictEqual(p.reportMarker, '-');
  });

  test('(R) 옛 XML 가져오기(교체) 뒤 state 에도 커밋 기록과 옛 키가 없다', () => {
    B.ev('__test.importXml(' + JSON.stringify(OLD_XML) + ')');
    const st = B.evJSON('state');
    assert.deepStrictEqual(st.entries.map((e) => e.id).sort(), ['e-1', 'e-3']);
    for (const k of ['gitAuthor', 'svnAuthor', 'gitCommitBody']) assert.ok(!(k in st), `state 에 ${k} 가 남았다`);
    assert.ok(st.categories.every((c) => !('gitRepo' in c) && !('svnRepo' in c)), 'state 의 과제에 저장소 경로가 남았다');
  });

  test('(R) XML 내보내기: 커밋, 저장소, 작성자, source, 커밋 본문 설정을 쓰지 않는다(옛 키가 객체에 남아 있어도)', () => {
    B.ev('state = ' + JSON.stringify({
      categories: [{ id: 'c-1', name: '과제', color: '#3e5be0', desc: '', gitRepo: 'C:/repo', svnRepo: 'C:/wc', createdAt: CA }],
      entries: [{ id: 'e-1', date: '2026-07-08', title: '일정', categoryId: 'c-1', allDay: true, startTime: '', endTime: '', memo: '',
        source: '', commits: [{ hash: 'h', short: 'h', time: '', subject: '남은 커밋', body: '' }], endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }],
      todos: [], gitAuthor: 'me@corp.com', svnAuthor: 'me', gitCommitBody: true,
      reportMarker: '-', reportMarkerCustom: '', reportIndent: 2, taskHours: {}, attendance: {},
    }) + ';');
    const xml = B.ev('toXML()');
    for (const t of ['gitRepo', 'svnRepo', 'gitAuthor', 'svnAuthor', 'gitCommitBody', '<commits', '<commit ', 'source="git"', '남은 커밋']) {
      assert.ok(!xml.includes(t), `XML 에 ${t} 가 쓰였다`);
    }
    assert.ok(xml.includes('<title>일정</title>'), '대조군: 일정은 그대로 쓰인다');
  });

  test('(R) 보고서 데이터: 커밋 항목이 없다(옛 commits 배열이 남아 있어도 제목으로 펼치지 않는다)', () => {
    B.ev('state = ' + JSON.stringify({
      categories: [{ id: 'c-1', name: '과제', color: '#3e5be0', desc: '', createdAt: CA }],
      entries: [{ id: 'e-1', date: '2026-07-08', title: '점검 일정', categoryId: 'c-1', allDay: true, startTime: '', endTime: '', memo: '',
        commits: [{ hash: 'h', short: 'h', time: '', subject: '남은 커밋 제목', body: '남은 본문' }], endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }],
      todos: [], reportMarker: '-', reportMarkerCustom: '', reportIndent: 2, taskHours: {}, attendance: {},
    }) + ';');
    const r = B.evJSON("collectReportData('2026-07-01', '2026-07-31', { event: true, todo: true, git: true, desc: true })");
    const row = r.rows.find((x) => x.key === 'c-1');
    assert.deepStrictEqual(row.titles, ['점검 일정'], '보고서에 커밋 제목이 펼쳐졌다');
    assert.ok(row.titleMeta.every((m) => m.kind !== 'git' && !('hash' in m) && !m.body), '보고서 메타에 커밋 흔적(kind git, hash, body)이 있다');
    assert.ok(!JSON.stringify(row.titleMeta).includes('남은'), '커밋 제목이나 본문이 보고서 항목에 실렸다');
  });

  test('(R) 옛 DB 스냅숏(buildStateFrom): 커밋 기록을 버리고 과제, 기록, 루트의 옛 키를 지운다', () => {
    const st = B.evJSON('buildStateFrom(' + JSON.stringify({
      categories: [{ id: 'c-1', name: '과제', color: '#3e5be0', desc: '', usesRepo: true, gitRepo: 'C:/r', createdAt: CA }],
      entries: [
        { id: 'e-1', date: '2026-07-08', title: '일정', categoryId: 'c-1', source: '', commits: [], recur: null, recurExcept: [] },
        { id: 'e-g', date: '2026-07-08', title: '커밋', categoryId: 'c-1', source: 'git', commits: [{ subject: 'x' }], recur: null, recurExcept: [] },
      ],
      todos: [], gitAuthor: 'a', svnAuthor: 'b', gitCommitBody: true,
    }) + ')');
    assert.deepStrictEqual(st.entries.map((e) => e.id), ['e-1']);
    assert.ok(!('source' in st.entries[0]) && !('commits' in st.entries[0]));
    assert.ok(!('usesRepo' in st.categories[0]) && !('gitRepo' in st.categories[0]));
    for (const k of ['gitAuthor', 'svnAuthor', 'gitCommitBody']) assert.ok(!(k in st), `state 에 ${k} 가 남았다`);
  });

  test('(R) 옛 localStorage(load): 부팅하면 커밋 기록이 빠지고 옛 키가 지워진다', () => {
    const OLD = {
      categories: [{ id: 'c-1', name: '과제', color: '#3e5be0', desc: '', gitRepo: 'C:/repo', svnRepo: '', vcs: 'git', createdAt: CA }],
      entries: [
        { id: 'e-1', date: '2026-07-08', title: '일정', categoryId: 'c-1', allDay: true, startTime: '', endTime: '', memo: '', source: '', commits: [], recur: null, recurExcept: [] },
        { id: 'e-g', date: '2026-07-08', title: '작업일지', categoryId: 'c-1', allDay: true, startTime: '', endTime: '', memo: '', source: 'git', commits: [{ hash: 'h', subject: 'c' }], recur: null, recurExcept: [] },
      ],
      todos: [], gitAuthor: 'me', svnAuthor: 'me', gitCommitBody: true,
    };
    const L = bootBrowser((win) => { win.localStorage.setItem('taskCalendar.v1', JSON.stringify(OLD)); });
    try {
      const st = L.evJSON('state');
      assert.deepStrictEqual(st.entries.map((e) => e.id), ['e-1'], '옛 저장본의 커밋 기록이 남았다');
      assert.ok(!('source' in st.entries[0]) && !('commits' in st.entries[0]));
      assert.ok(st.categories.every((c) => !('gitRepo' in c) && !('svnRepo' in c) && !('vcs' in c)), '과제에 저장소 키가 남았다');
      for (const k of ['gitAuthor', 'svnAuthor', 'gitCommitBody']) assert.ok(!(k in st), `state 에 ${k} 가 남았다`);
    } finally { L.close(); }
  });

  test('(R) 화면: 날짜 패널 탭은 일정 상세와 할 일 둘, 과제 창에 저장소 카드가 없고, 보고서 포함 항목은 일정과 할 일 둘이다', () => {
    assert.deepStrictEqual(B.evJSON("[].map.call(document.querySelectorAll('#dpTabs .dp-tab'), function(b){ return b.dataset.ptab; })"), ['detail', 'todo']);
    assert.strictEqual(B.ev("!!document.getElementById('gitCard')"), false);
    assert.strictEqual(B.ev("!!document.getElementById('entryModal') || !!document.getElementById('bulkGitModal') || !!document.getElementById('dayGitModal')"), false);
    assert.deepStrictEqual(B.evJSON("[].map.call(document.querySelectorAll('#reportModal .rpt-chips input'), function(i){ return i.id; })"), ['rptSrcEvent', 'rptSrcTodo']);
  });

  test('(R) 과제 데이터 내보내기: 호스트로 가는 exportResearch 의 값은 {project, calendarMd, from, to} 넷뿐이다', async () => {
    const Wd = bootWidget();
    try {
      await tick(40);
      Wd.ev('state = ' + JSON.stringify({
        categories: [{ id: 'c-1', name: '연구과제', color: '#3e5be0', desc: '', createdAt: CA }],
        entries: [{ id: 'e-1', date: '2026-07-08', title: '실험', categoryId: 'c-1', allDay: true, startTime: '', endTime: '', memo: '', endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }],
        todos: [], reportMarker: '-', reportMarkerCustom: '', reportIndent: 2, taskHours: {}, attendance: {},
      }) + ';');
      Wd.ev("openExportModal(); $('#expCat').value = 'c-1'; $('#expFrom').value = '2026-07-01'; $('#expTo').value = '2026-07-31';");
      const before = Wd.posted.length;
      Wd.ev('window.__expP = runResearchExport();');
      await tick(20);
      const msg = Wd.posted.slice(before).find((m) => m && m.cmd === 'exportResearch');
      assert.ok(msg, 'exportResearch 요청이 나가지 않았다');
      const keys = Object.keys(msg).filter((k) => k !== 'cmd' && k !== 'reqId').sort();
      assert.deepStrictEqual(keys, ['calendarMd', 'from', 'project', 'to'], '내보내기 값이 넷이 아니다: ' + keys.join(','));
      assert.strictEqual(msg.project, '연구과제');
      assert.ok(msg.calendarMd.startsWith('# 과제 데이터: 연구과제'), '캘린더 md 제목이 「과제 데이터」가 아니다: ' + msg.calendarMd.slice(0, 40));
      assert.ok(!/작업일지|커밋/.test(msg.calendarMd), '캘린더 md 에 커밋 흔적이 있다');
      //  호스트 회신(구조 18 호스트와 같은 꼴)으로 끝맺는다
      Wd.ev('__hostReply(' + JSON.stringify(msg.reqId) + ', ' + JSON.stringify({ ok: true, outPath: 'C:/out/과제데이터_연구과제_2026-07-01_2026-07-31', calendar: true }) + ')');
      await Wd.w.__expP;
      assert.ok(/캘린더\.md/.test(Wd.ev("$('#expHint').textContent")), '완료 안내가 무엇을 만들었는지 말하지 않는다');
      assert.ok(!/Git|SVN/.test(Wd.ev("$('#expHint').textContent")), '완료 안내에 Git, SVN 이 남았다');
      const sent = Wd.posted.map((m) => m && m.cmd).filter(Boolean);
      assert.ok(!sent.some((c) => ['gitlog', 'gitauthor', 'gitcheck', 'pickfolder'].includes(c)), '웹이 없앤 호스트 명령을 보냈다: ' + sent.join(','));
    } finally { Wd.close(); }
  });

  test('(R) 정리', () => { B.close(); });
}
