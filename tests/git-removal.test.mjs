// Git, SVN 기능 전량 삭제(2026-10-26, docs/GIT-SVN-REMOVAL.md) 호스트와 DB 쪽 흔적 0 검사
//
// 이 파일이 지키는 것(호스트 C#, 정본 스키마, 배포 도구):
//   ① 파일째 지운 것: widget/Svn.cs, widget/RepoPaths.cs 가 다시 생기지 않는다.
//   ② 호스트 명령: gitlog, gitauthor, gitcheck, pickfolder 가 없고, git 이나 svn 을 실행하는 코드가 없다.
//      exportResearch 는 남는다. 받는 값은 project, calendarMd, from, to 넷뿐이다(옛 웹이 더 보내도 읽지 않는다).
//   ③ widget/*.cs 코드(주석 제외)에 없앤 표, 칸, state 키 이름이 없다.
//   ④ 정본 스키마(schema-calendar.sql, 주석 제외)에 cal_entry_commit 정의, 없앤 칸 다섯, CHECK 넷이 없다.
//      cal_entry_commit 은 옛 DB 정리용 DROP 한 줄만 남는다.
//   ⑤ 판 번호: DbGate.AppStructureVersion = 정본 시드 = 이관 조각 사슬의 끝 = 18 이상.
//   ⑥ 권한 파일, 시드와 데모 생성기, 1회성 XML 이관 도구가 없앤 표와 칸을 쓰지 않는다.
//   웹(task-calendar-prototype.html) 쪽 흔적 검사는 tests/git-removal-web.test.mjs 가 맡는다.
//   ★ 변이 시험이 각 검사가 정말 무는지 본다(흔적을 하나 되살린 사본을 같은 검사에 넣는다).
import { existsSync, readdirSync } from 'node:fs';
import { test, assert, readText, stripCsComments } from './harness.mjs';
import { stripSqlComments } from './canon-schema.mjs';

const R = (p) => new URL('../' + p, import.meta.url);
const WIDGET = R('widget/');
const csFiles = () => readdirSync(WIDGET).filter((f) => f.endsWith('.cs')).sort();
const src = {
  main: readText(R('widget/MainWindow.xaml.cs')),
  gate: readText(R('widget/DbGate.cs')),
  canon: readText(R('db/deploy/schema-calendar.sql')),
  grants: readText(R('db/deploy/grants-calendar.sql')),
  server: readText(R('db/deploy/server-app-account.sql')),
  init: readText(R('db/deploy/init-calendar.ps1')),
  seed: readText(R('db/deploy/seed-dummy.mjs')),
  demo: readText(R('db/demo/build-demo-sql.mjs')),
  x2d: readText(R('db/deploy/xml-to-db/Program.cs')),
};
const hosts = () => csFiles().map((f) => ({ name: 'widget/' + f, code: stripCsComments(readText(new URL(f, WIDGET))) }));
//  JS 코드에서 줄 주석과 블록 주석을 걷는다(문자열 안의 // 는 이 파일들에 없다. 주석의 옛 설명이 검사에 걸리지 않게 한다).
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

//  없앤 이름: DB 칸과 표, 웹과 주고받던 state 키, 지운 C# 형
const DB_NAMES = ['cal_entry_commit', 'uses_repo', 'git_author', 'svn_author', 'git_commit_body'];
const STATE_KEYS = ['gitRepo', 'svnRepo', 'usesRepo', 'gitAuthor', 'svnAuthor', 'gitCommitBody'];
const CS_TYPES = ['RepoPaths', 'GitResult', 'GitCommit', 'SvnLog', 'SvnExe', 'DetectVcs', 'ResolveVcs', 'IsGitRepo', 'RunGitConfig',
  'GitListCommits', 'GitPatchOne', 'SvnDiff', 'PickFolder', 'RunGitLogAsync', 'RunGitAuthorAsync', 'RunGitCheckAsync'];
const REMOVED_CMDS = ['gitlog', 'gitauthor', 'gitcheck', 'pickfolder'];
const DROPPED_CHECKS = ['chk_cal_entry_source', 'chk_cal_entry_git', 'chk_cal_category_usesrepo01', 'chk_cal_user_pref_commit_body'];

const checks = {
  // ① 파일
  files(names) {
    for (const f of ['Svn.cs', 'RepoPaths.cs']) assert.ok(!names.includes(f), `widget/${f} 가 되살아났다(2026-10-26 파일째 지웠다)`);
    assert.ok(names.length >= 12, `widget/*.cs 를 ${names.length}개만 찾았다(열거가 빗나가면 아래 훑기가 아무것도 안 본다)`);
  },
  // ② 명령과 외부 프로그램
  commands(main) {
    const code = stripCsComments(main);
    for (const c of REMOVED_CMDS) assert.ok(!code.includes(`case "${c}"`), `MainWindow 에 없앤 명령 case "${c}" 가 있다`);
    assert.ok(!/new ProcessStartInfo\(\s*"git"/.test(code), 'MainWindow 가 git 프로세스를 실행한다');
    assert.ok(!/\bsvn(\.exe)?"/i.test(code), 'MainWindow 가 svn 을 실행한다');
    assert.ok(/case "exportResearch":/.test(code), 'exportResearch 명령이 사라졌다(과제 데이터 내보내기는 남는다)');
    const m = /case "exportResearch":[\s\S]*?break;/.exec(code);
    const read = [...m[0].matchAll(/GetStr\(doc, "(\w+)"\)/g)].map((x) => x[1]).sort();
    assert.deepStrictEqual(read, ['calendarMd', 'from', 'project', 'reqId', 'to'], `exportResearch 가 읽는 값이 project, calendarMd, from, to(+reqId)가 아니다: ${read.join(', ')}`);
    assert.ok(/private void RunResearchExport\(string reqId, string project, string calendarMd, string from, string to\)/.test(code),
      'RunResearchExport 의 인자가 (reqId, project, calendarMd, from, to) 가 아니다');
    const body = /private void RunResearchExport\([\s\S]*?\n {8}\}\r*\n/.exec(code);
    assert.ok(body && !/"git"|"svn"|\.patch/.test(body[0]), 'RunResearchExport 가 git, svn 폴더나 patch 를 아직 만든다');
  },
  // ③ 호스트 코드의 이름
  hostNames(list) {
    const bad = [];
    for (const h of list) {
      for (const n of DB_NAMES) if (h.code.includes(n)) bad.push(`${h.name}: ${n}`);
      for (const n of STATE_KEYS) if (new RegExp(`"${n}"`).test(h.code)) bad.push(`${h.name}: "${n}"`);
      for (const n of CS_TYPES) if (new RegExp(`\\b${n}\\b`).test(h.code)) bad.push(`${h.name}: ${n}`);
      //  일정의 출처와 커밋 키(과제의 source 는 공식 과제 표시라 남는다: "source" 는 보지 않는다)
      if (/\["commits"\]|"commits"/.test(h.code)) bad.push(`${h.name}: "commits"`);
      if (/e\.source\b|cal_entry\.source|"@src", S\(e,/.test(h.code)) bad.push(`${h.name}: 일정 출처(source)`);
    }
    assert.deepStrictEqual(bad, [], '호스트 코드에 없앤 Git, SVN 이름이 남았다:\n' + bad.join('\n'));
  },
  // ④ 정본 스키마
  canon(sql) {
    const code = stripSqlComments(sql);
    assert.ok(!/CREATE TABLE\s+cal_entry_commit\b/i.test(code), '정본이 cal_entry_commit 을 만든다');
    const commitLines = code.split('\n').filter((l) => /\bcal_entry_commit\b/.test(l));
    assert.deepStrictEqual(commitLines.map((l) => l.trim()), ['DROP TABLE IF EXISTS cal_entry_commit;'],
      'cal_entry_commit 은 옛 DB 정리용 DROP 한 줄만 남아야 한다');
    for (const n of DB_NAMES.slice(1)) assert.ok(!new RegExp(`\\b${n}\\b`).test(code), `정본에 없앤 칸 ${n} 이 있다`);
    for (const n of DROPPED_CHECKS) assert.ok(!code.includes(n), `정본에 없앤 CHECK ${n} 이 있다`);
    const entry = /CREATE TABLE cal_entry \(([\s\S]*?)\n\) ENGINE/.exec(code);
    assert.ok(entry, '정본에서 cal_entry 정의를 찾지 못했다(판정 불가)');
    assert.ok(!/^\s*source\s/m.test(entry[1]), '정본 cal_entry 에 source 칸이 남았다');
    assert.ok(!/커밋 수집|git\/svn/.test(/CREATE TABLE cal_user_pref[\s\S]*?COMMENT='[^']*'/.exec(code)[0]), '정본 cal_user_pref 표 설명에 커밋 수집 작성자가 남았다');
  },
  // ⑤ 판 번호
  versions(gate, canon, fragNames) {
    const a = /public const int AppStructureVersion = (\d+);/.exec(stripCsComments(gate));
    const c = /VALUES \('db_structure_version', '(\d+)', UTC_TIMESTAMP\(3\)\)/.exec(stripSqlComments(canon));
    assert.ok(a && c, '앱 구조 번호나 정본 시드를 읽지 못했다(판정 불가)');
    assert.ok(Number(a[1]) >= 18, `앱 구조 번호가 ${a[1]} 이다(Git, SVN 삭제는 구조 18)`);
    assert.strictEqual(c[1], a[1], `정본 시드(${c[1]})가 앱 구조 번호(${a[1]})와 다르다`);
    const last = Math.max(...fragNames.map((f) => Number(/^v(\d+)-/.exec(f)[1])));
    assert.strictEqual(String(last), a[1], `이관 조각 사슬의 끝(v${last})이 앱 구조 번호(${a[1]})와 다르다`);
    assert.ok(fragNames.includes('v18-remove-git.sql'), 'Git, SVN 삭제 이관 조각 v18-remove-git.sql 이 없다');
  },
  // ⑥ 권한, 생성기, 이관 도구
  tools(s) {
    assert.ok(!/^GRANT[^;]*cal_entry_commit/m.test(stripSqlComments(s.grants)), 'grants-calendar.sql 이 없앤 표 cal_entry_commit 에 권한을 준다');
    assert.ok(!/^GRANT[^;]*cal_entry_commit/m.test(stripSqlComments(s.server)), 'server-app-account.sql 이 없앤 표 cal_entry_commit 에 권한을 준다');
    assert.ok(!/'cal_entry_commit'/.test(s.init.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')), 'init-calendar.ps1 표 명부에 cal_entry_commit 이 있다');
    for (const [name, text] of [['seed-dummy.mjs', s.seed], ['build-demo-sql.mjs', s.demo]]) {
      const code = stripJs(text);
      for (const n of DB_NAMES) assert.ok(!code.includes(n), `${name} 이 없앤 이름 ${n} 을 쓴다`);
      assert.ok(!/INSERT INTO cal_entry \([^)]*\bsource\b/.test(code) && !/'title', 'memo', 'source'/.test(code), `${name} 가 cal_entry.source 를 넣는다`);
    }
    const x = stripCsComments(s.x2d);
    for (const n of DB_NAMES) assert.ok(!x.includes(n), `xml-to-db/Program.cs 가 없앤 이름 ${n} 을 쓴다`);
    assert.ok(!/repo-paths\.json/.test(x), 'xml-to-db 가 아직 repo-paths.json 을 쓴다');
    assert.ok(/A\(e, "source"\) != "git"/.test(x), 'xml-to-db 가 옛 커밋 기록(source="git")을 걸러 내지 않는다');
  },
};

const fragNames = () => readdirSync(R('db/deploy/migrations/')).filter((f) => f.endsWith('.sql'));

test('Git 삭제①: widget/Svn.cs, widget/RepoPaths.cs 가 없다', () => checks.files(csFiles()));
test('Git 삭제②: 호스트에 gitlog, gitauthor, gitcheck, pickfolder 가 없고 exportResearch 는 project, calendarMd, from, to 만 받는다', () => checks.commands(src.main));
test('Git 삭제③: widget/*.cs 코드에 없앤 표, 칸, state 키, 형 이름이 없다', () => checks.hostNames(hosts()));
test('Git 삭제④: 정본 스키마에 cal_entry_commit 정의, 없앤 칸 다섯, CHECK 넷이 없다(DROP 한 줄만)', () => checks.canon(src.canon));
test('Git 삭제⑤: 앱 구조 번호 = 정본 시드 = 이관 조각 사슬의 끝 = 18 이상', () => checks.versions(src.gate, src.canon, fragNames()));
test('Git 삭제⑥: 권한 파일, 시드, 데모, XML 이관 도구가 없앤 표와 칸을 쓰지 않는다', () => checks.tools(src));

// ══ 변이: 흔적을 하나 되살리면 검사가 문다 ═══════════════════════════════
const swap = (s, from, to) => { assert.ok(s.includes(from), `변이 준비 실패: [${from.slice(0, 60)}] 없음`); return s.replace(from, to); };
test('변이G1: RepoPaths.cs 가 목록에 다시 생기면 ① 이 실패한다', () => {
  assert.throws(() => checks.files([...csFiles(), 'RepoPaths.cs']), /RepoPaths\.cs 가 되살아났다/);
});
test('변이G2: case "gitlog" 를 되살리거나 exportResearch 가 gitRepo 를 다시 읽으면 ② 가 실패한다', () => {
  const a = swap(src.main, 'case "exportResearch":', 'case "gitlog": break;\r\r\n                    case "exportResearch":');
  assert.throws(() => checks.commands(a), /case "gitlog"/);
  const b = swap(src.main, 'RunResearchExport(reqId, project, calendarMd, from, to);', 'string gitRepo = GetStr(doc, "gitRepo"); RunResearchExport(reqId, project, calendarMd, from, to);');
  assert.throws(() => checks.commands(b), /읽는 값이/);
});
test('변이G3: 호스트 코드에 uses_repo 나 "gitAuthor" 가 되살아나면 ③ 이 실패한다', () => {
  const list = hosts();
  const i = list.findIndex((h) => h.name === 'widget/CalendarWriteDb.cs');
  assert.ok(i >= 0, '변이 준비 실패: CalendarWriteDb.cs 없음');
  const a = list.map((h, k) => (k === i ? { ...h, code: h.code + '\nvar s = "SET uses_repo=@ur";' } : h));
  assert.throws(() => checks.hostNames(a), /uses_repo/);
  const b = list.map((h, k) => (k === i ? { ...h, code: h.code + '\nvar p = ("@ga", S(st, "gitAuthor"));' } : h));
  assert.throws(() => checks.hostNames(b), /"gitAuthor"/);
});
test('변이G4: 정본 cal_entry 에 source 칸이나 CHECK chk_cal_entry_git 이 되살아나면 ④ 가 실패한다', () => {
  const a = swap(src.canon, '  location       VARCHAR(200)', "  source         VARCHAR(8) NOT NULL DEFAULT '',\n  location       VARCHAR(200)");
  assert.throws(() => checks.canon(a), /source 칸/);
  const b = swap(src.canon, '  CONSTRAINT chk_cal_entry_uid      CHECK (uid <> \'\'),', "  CONSTRAINT chk_cal_entry_uid      CHECK (uid <> ''),\n  CONSTRAINT chk_cal_entry_git CHECK (1),");
  assert.throws(() => checks.canon(b), /chk_cal_entry_git/);
});
test('변이G5: 앱 구조 번호만 17 로 되돌리면 ⑤ 가 실패한다', () => {
  const bad = src.gate.replace(/(public const int AppStructureVersion = )\d+;/, '$117;');
  assert.notStrictEqual(bad, src.gate, '변이 준비 실패');
  assert.throws(() => checks.versions(bad, src.canon, fragNames()), /구조 18|다르다/);
});
test('변이G6: 권한 파일에 cal_entry_commit GRANT 가 되살아나거나 시드가 uses_repo 를 넣으면 ⑥ 이 실패한다', () => {
  assert.throws(() => checks.tools({ ...src, grants: src.grants + "\nGRANT SELECT, INSERT, DELETE ON taskmgr.cal_entry_commit TO 'taskmgr_app'@'%';\n" }), /cal_entry_commit 에 권한/);
  assert.throws(() => checks.tools({ ...src, seed: src.seed + "\nconst cols = ['uses_repo'];\n" }), /uses_repo/);
});

//  ⑦ 과제 데이터 내보내기의 회신 스레드(2026-10-26 QA 실측: 무한 로딩).
//    파일 쓰기는 Task.Run 안에서 한다. 그 안에서 GitReply 를 바로 부르면 웹뷰 접근이 스레드 오류로 묻혀(로그 'GitReply 오류')
//    웹이 120초 동안 '내보내는 중' 에 머문다. 백그라운드 회신은 ReplyOnUi(UI 스레드로 넘김)여야 한다.
const exportBody = (code) => {
  const m = /private void RunResearchExport\([\s\S]*?\n {8}\}/.exec(code);
  assert.ok(m, 'RunResearchExport 를 찾지 못했다');
  const i = m[0].indexOf('Task.Run(');
  assert.ok(i >= 0, 'RunResearchExport 에 Task.Run 이 없다(파일 쓰기가 UI 스레드로 왔다면 이 검사를 다시 볼 것)');
  return m[0].slice(i);
};
const checkExportReply = (code) => {
  const bg = exportBody(stripCsComments(code));
  assert.ok(!/\bGitReply\(/.test(bg), 'RunResearchExport 의 백그라운드 구간에서 GitReply 를 바로 부른다(회신이 사라져 무한 로딩)');
  assert.ok((bg.match(/\bReplyOnUi\(/g) || []).length >= 2, 'RunResearchExport 의 백그라운드 구간이 성공과 실패 모두 ReplyOnUi 로 회신하지 않는다');
};
test('Git 삭제⑦: 과제 데이터 내보내기는 백그라운드에서 ReplyOnUi 로 회신한다(무한 로딩 방지)', () => checkExportReply(src.main));
test('변이G7: 내보내기 성공 회신을 GitReply 로 되돌리면 ⑦ 이 실패한다', () => {
  const bad = swap(src.main, 'ReplyOnUi(reqId, new { ok = true, outPath = outDir, calendar = true });', 'GitReply(reqId, new { ok = true, outPath = outDir, calendar = true });');
  assert.throws(() => checkExportReply(bad), /GitReply 를 바로 부른다/);
});
