// 배포 SQL 하나(release-v<버전>.sql) 계약 (docs/DB-RELEASE-OPS.md §4~6, docs/VERSION-GATE.md §4)
//
// 이 파일이 지키는 것:
//   ① 조립기 installer/release-sql.ps1 의 조각 사슬 검사: 머리 형식, 한 칸, 구조 번호 올리기 줄, db_updating 쓰기 금지,
//      빈틈과 겹침, 끝 = 앱 구조 번호. 어기면 정해진 종료코드로 실패한다(빌드 전에 publish-update.ps1 이 부른다).
//   ② 만들어진 SQL 의 모양: 잠금 대기 상한, 확인이 닫기보다 먼저, 닫기가 첫 조각보다 먼저, 조각은 구조 번호 순서,
//      끝 확인 뒤 마지막 한 트랜잭션에 네 키(app_ 셋과 db_updating 0), 그 뒤 결과 표. 멈춤은 모두 '없는 표 SELECT'.
//   ③ 상태 전이(흉내 실행기 tests/release-sql-sim.mjs): 실제 사슬(13 에서 14, 14 에서 15, 15 에서 16, 16 에서 17, 17 에서 18, 18 에서 19) 그대로.
//      13 에서 처음(여섯 조각을 몰아서), 14 에서 다섯 칸, 16 에서 세 칸, 17 에서 두 칸, 18 에서 한 칸, 앱만 바뀐 배포(닫지 않는다), 성공 뒤 재실행(바뀌는 것 없음),
//      마지막 조각 뒤에 멈춘 DB 마무리, 새 DB, 낮은 DB, 이상한 값, v15 회의실 검증 멈춤, v16 과제 캘린더 표 모양 검증 멈춤,
//      v17 월간보고(칸, CHECK, 그림 표) 검증 멈춤, v18 Git, SVN 삭제(커밋 기록, 커밋 목록 표, 칸과 CHECK) 결과와 검증 멈춤,
//      v19 과제 순서(칸, 코드표 표 설명, 보이는 과제의 처음 순서) 결과와 검증 멈춤,
//      실제 사슬 뒤에 시험 조각을 붙인 건너뛴 배포,
//      그리고 바꾸는 문장마다 실패를 넣어 보고 같은 파일을 다시 돌리면 끝나는지, 그 사이 앱에 반쯤 바뀐 상태(meta 와 표)가 보이지 않는지.
//   ④ 조각 폴더의 모든 파일이 조각 규칙(§5.2)을 따른다.
//   ★ 조립기는 실제 PowerShell 로 돌린다(임시 조각 폴더와 임시 사본). 변이 시험도 같은 길로 실패를 확인한다.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, readText } from './harness.mjs';
import { mutate, exitCodeTable, exitCodesInTable, maskPs } from './ps-guard-lib.mjs';
import { FakeDb, splitStatements, defOf, PROJECT_V16, PROJECT_V17, PROJECT_V19, VCS_V17, VCS_V18, PREF_COMMENT_V18, CODES_V18, CODES_V19, V19_FILL, REPORTS_V20 } from './release-sql-sim.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const GEN = join(ROOT, 'installer', 'release-sql.ps1');
const FRAG_DIR = join(ROOT, 'db', 'deploy', 'migrations');
const genSrc = readText(GEN).replace(/^﻿/, '');
const APP = Number(/public const int AppStructureVersion = (\d+);/.exec(readText(join(ROOT, 'widget', 'DbGate.cs')))[1]);
const VER = '0.99.0', FILE = 'TaskCalendarWidget-Setup-v0.99.0.exe', SHA = 'ab'.repeat(32);

const TMP = mkdtempSync(join(tmpdir(), 'tc-release-sql-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch (_) { } });
let seq = 0;

// 조립기를 실제로 돌린다. 종료코드와 출력(ASCII 꼬리표 [XXX])과 만들어진 SQL 을 돌려준다.
function gen(fragDir, structure, { checkOnly = false, script = GEN } = {}) {
  const out = join(TMP, `out-${++seq}.sql`);
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-FragmentDir', fragDir, '-Structure', String(structure)];
  if (checkOnly) args.push('-CheckOnly');
  else args.push('-Version', VER, '-InstallerFile', FILE, '-Sha256', SHA, '-Notes', 'test notes', '-OutFile', out, '-Stamp', '2026-10-21 00:00');
  const r = spawnSync('powershell', args, { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (r.error) throw new Error(`powershell 을 실행하지 못했다(판정 불가): ${r.error.message}`);
  return { code: r.status, log: (r.stdout || '') + (r.stderr || ''), sql: existsSync(out) ? readFileSync(out, 'utf8') : null };
}
// 임시 조각 폴더. files: { 이름: 내용 } (null 이면 실제 조각을 그대로 복사)
function fragDir(files) {
  const d = join(TMP, `frags-${++seq}`);
  mkdirSync(d);
  for (const [n, body] of Object.entries(files)) {
    if (body === null) copyFileSync(join(FRAG_DIR, n), join(d, n));
    else writeFileSync(join(d, n), body, 'utf8');
  }
  return d;
}
// 규칙을 따르는 시험용 조각(from 에서 to 로, 표식 키 하나를 넣는다)
function fakeFrag(from, to, { marker = `x_v${to}_marker` } = {}) {
  return `-- @migration from=${from} to=${to}
-- 시험용 조각
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @m_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @go := (@m_cur <=> '${from}');
SET @skip := (@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= ${to});
SET @g := IF(@go OR @skip, 'DO 0',
             'SELECT 1 FROM \`중단: v${to} 시험 조각 - 번호가 맞지 않다\`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(NOT @go OR @m_upd <=> '1', 'DO 0',
             'SELECT 1 FROM \`중단: v${to} 시험 조각 - 닫히지 않았다\`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
START TRANSACTION;
SET @s := IF(@go, 'INSERT INTO cal_schema_meta (k, v, updated_at) VALUES (''${marker}'', ''on'', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE k = k', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
COMMIT;
UPDATE cal_schema_meta SET v = '${to}', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_structure_version' AND v = '${from}';
`;
}

// 실제 조각으로 만든 SQL(한 번만 만든다)
let _real = null;
const realSql = () => {
  if (_real === null) {
    const r = gen(FRAG_DIR, APP);
    assert.strictEqual(r.code, 0, `실제 조각으로 배포 SQL 을 만들지 못했다(exit ${r.code}): ${r.log}`);
    _real = r.sql;
  }
  return _real;
};
// 실제 조각 이름(구조 번호 순서. 파일 이름이 v<도착 번호>- 로 시작한다는 것은 ④ 가 본다)
const REAL_FRAGS = readdirSync(FRAG_DIR).filter((f) => f.endsWith('.sql')).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
// 실제 사슬 뒤에 시험용 조각 하나(APP 에서 APP+1)를 붙인 것: 다음 판이 생겼을 때 여러 조각을 몰아 올리는 경우
const NEXT = APP + 1, NEXT_FRAG = `v${NEXT}-test.sql`, NEXT_MARK = `x_v${NEXT}_marker`;
let _ext = null;
const extSql = () => {
  if (_ext === null) {
    const d = fragDir({ ...Object.fromEntries(REAL_FRAGS.map((f) => [f, null])), [NEXT_FRAG]: fakeFrag(APP, NEXT) });
    const r = gen(d, NEXT);
    assert.strictEqual(r.code, 0, `실제 조각과 시험용 v${NEXT} 조각으로 배포 SQL 을 만들지 못했다(exit ${r.code}): ${r.log}`);
    _ext = r.sql;
  }
  return _ext;
};

// ── 출발 상태들 ────────────────────────────────────────────────────────
//  14 까지의 DB 에는 사람마다 두던 회의실 표(cal_room)가 있다. 같은 이름(앞뒤 공백, 대소문자만 다름)을 여러 사람이 쓴다.
//  15 부터는 공용 목록(room_code)만 있다. v15 조각이 이름을 모아(공백 정리, ai_ci 로 묶기) 쓰는 사람 많은 순, 10 간격으로 넣는다.
const CAL_ROOMS = [
  { user_id: 1, name: '회의실A' }, { user_id: 2, name: '회의실A' }, { user_id: 3, name: ' 회의실A ' },
  { user_id: 1, name: 'Room b' }, { user_id: 2, name: 'room B' },
  { user_id: 1, name: '대회의실' },
];
const ROOM_CODES = [['회의실A', 10], ['Room b', 20], ['대회의실', 30]];
//  16 부터는 과제 캘린더 표 둘(cal_project_*)이 있다. 모양(열 수, FK 수)은 정본 schema-calendar.sql 의 정의에서 센다
//  (흉내 실행기가 v16 조각의 CREATE 에서 세는 것과 같은 함수 defOf). v16 의 검증이 이 모양을 information_schema 로 다시 본다.
const PC_TABLES = ['cal_project_event', 'cal_project_change'];
const CANON_CAL = readText(join(ROOT, 'db', 'deploy', 'schema-calendar.sql'));
const PC_DEFS = Object.fromEntries(PC_TABLES.map((n) => {
  const i = CANON_CAL.indexOf(`CREATE TABLE ${n} (`);
  assert.ok(i >= 0, `정본에 ${n} 가 없다`);
  return [n, defOf(CANON_CAL.slice(i, CANON_CAL.indexOf(';', CANON_CAL.indexOf(') ENGINE=', i))))];
}));
//  17 부터는 월간보고 그림 표(project_schedule_image)와 project.dev_start_date(end_date 뒤), CHECK chk_project_dev_dates 가 있다.
//  그림 표 모양도 정본 schema-calendar.sql 의 정의에서 같은 함수로 센다.
const SI_TABLE = 'project_schedule_image';
const SI_DEFS = (() => {
  const i = CANON_CAL.indexOf(`CREATE TABLE ${SI_TABLE} (`);
  assert.ok(i >= 0, `정본에 ${SI_TABLE} 가 없다`);
  return { [SI_TABLE]: defOf(CANON_CAL.slice(i, CANON_CAL.indexOf(';', CANON_CAL.indexOf(') ENGINE=', i)))) };
})();
//  18 부터는 Git, SVN 이 없다(v18 조각): 커밋 기록(cal_entry.source = 'git')과 그 자식 행, cal_entry_commit 표,
//  cal_entry.source, cal_category.uses_repo, cal_user_pref 의 작성자와 커밋 본문 칸, 그 CHECK 넷. 17 까지의 DB 에는
//  사람 둘의 일정이 있다: 커밋 기록 둘(1:1, 2:1), 일반 일정 둘(1:2 는 반복이라 예외일 하나, 2:5). 커밋 목록은 커밋 기록에도
//  일반 일정(1:2)에도 붙어 있다. 18 에는 일반 일정 둘과 그 예외일만 남는다(source 칸 없음).
const VCS_ROWS17 = () => ({
  cal_entry: [{ user_id: 1, entry_no: 1, source: 'git' }, { user_id: 1, entry_no: 2, source: '' },
    { user_id: 2, entry_no: 1, source: 'git' }, { user_id: 2, entry_no: 5, source: '' }],
  cal_entry_except: [{ user_id: 1, entry_no: 2, d: '2026-10-07' }],
  cal_entry_commit: [{ user_id: 1, entry_no: 1, seq: 0 }, { user_id: 1, entry_no: 1, seq: 1 }, { user_id: 1, entry_no: 2, seq: 0 }, { user_id: 2, entry_no: 1, seq: 0 }],
});
const VCS_ROWS18 = () => ({
  cal_entry: [{ user_id: 1, entry_no: 2 }, { user_id: 2, entry_no: 5 }],
  cal_entry_except: [{ user_id: 1, entry_no: 2, d: '2026-10-07' }],
});
//  19 부터는 과제에 sort_no(그 구분 안의 순서)가 있다(v19 조각). 18 까지의 DB 에는 과제 여섯이 있다: 구분 1 에 보이는 둘
//  ('나', 통상명칭이 비어 사업명 '가사업'으로 보이는 것)과 숨긴 하나, 구분 3 에 'B', 'A', 구분 2 에 하나.
//  v19 는 보이는 과제에 구분마다 표시 이름 순으로 1 부터 매기고(가사업 1, 나 2 / A 1, B 2 / 선 1) 숨긴 과제는 NULL 로 둔다.
const PROJ_ROWS18 = () => [
  { id: 1, section_id: 1, common_name: '나', project_name: '나사업', is_active: 1 },
  { id: 2, section_id: 1, common_name: '', project_name: '가사업', is_active: 1 },
  { id: 3, section_id: 1, common_name: '다', project_name: '다사업', is_active: 0 },
  { id: 4, section_id: 3, common_name: 'B', project_name: 'B사업', is_active: 1 },
  { id: 5, section_id: 3, common_name: 'A', project_name: 'A사업', is_active: 1 },
  { id: 6, section_id: 2, common_name: '선', project_name: '선사업', is_active: 1 },
];
const PROJ_SORT19 = { 1: 2, 2: 1, 3: null, 4: 2, 5: 1, 6: 1 };
const PROJ_ROWS19 = () => PROJ_ROWS18().map((r) => ({ ...r, sort_no: PROJ_SORT19[r.id] }));
const T = {
  old: () => ({ cal_room: CAL_ROOMS, ...VCS_ROWS17() }),
  shared: () => ({ room_code: ROOM_CODES.map(([name, sort_order]) => ({ name, sort_order })) }),
  pc: () => Object.fromEntries(PC_TABLES.map((n) => [n, []])),
  si: () => ({ [SI_TABLE]: [] }),
};
const S = {
  legacy13: () => ({ meta: { schema_version: '13' }, tables: { ...T.old(), project: PROJ_ROWS18() } }),
  at: (n, upd = '0', app = ['0.22.0', 'TaskCalendarWidget-Setup-v0.22.0.exe', 'cd'.repeat(32)]) => ({
    meta: {
      db_structure_version: String(n), db_updating: upd,
      app_latest_version: app[0], app_installer_file: app[1], app_installer_sha256: app[2],
    },
    tables: {
      ...(Number(n) >= 17 ? { ...T.shared(), ...T.pc(), ...T.si() } : Number(n) >= 16 ? { ...T.shared(), ...T.pc() } : Number(n) >= 15 ? T.shared() : T.old()),
      ...(Number(n) >= 18 ? VCS_ROWS18() : VCS_ROWS17()),
      project: Number(n) >= 19 ? PROJ_ROWS19() : PROJ_ROWS18(),
    },
    defs: Number(n) >= 17 ? { ...PC_DEFS, ...SI_DEFS } : Number(n) >= 16 ? PC_DEFS : {},
    project: Number(n) >= 19 ? PROJECT_V19() : Number(n) >= 17 ? PROJECT_V17() : PROJECT_V16(),
    vcs: Number(n) >= 18 ? VCS_V18() : VCS_V17(),
    codes: Number(n) >= 19 ? CODES_V19() : CODES_V18(),
    reports: Number(n) >= 20 ? REPORTS_V20() : {},
  }),
};
const open = (init, opts = {}) => new FakeDb(init.meta, { tables: init.tables || {}, defs: init.defs || {}, project: init.project || PROJECT_V16(), vcs: init.vcs || VCS_V17(), codes: init.codes || CODES_V18(), reports: init.reports || {}, ...opts });
const stateOf = (init) => open(init).state();
const finalMeta = (n) => ({ db_structure_version: String(n), db_updating: '0', app_latest_version: VER, app_installer_file: FILE, app_installer_sha256: SHA });
//  끝 상태(meta 와 표): 공용 회의실 목록 하나, cal_room 없음, 과제 캘린더 표 둘과 그림 표(정본과 같은 모양), project 에 개발 시작일 칸과 CHECK,
//  일반 일정과 예외일만(커밋 기록, cal_entry_commit, 지울 칸과 CHECK 없음, cal_user_pref 표 설명은 18),
//  과제에 순서 칸과 처음 순서(보이는 과제만), 코드표 표 설명은 19
const FINAL_DB = new FakeDb({}, { tables: { ...T.shared(), ...T.pc(), ...T.si(), ...VCS_ROWS18(), project: PROJ_ROWS19() }, defs: { ...PC_DEFS, ...SI_DEFS }, project: PROJECT_V19(), vcs: VCS_V18(), codes: CODES_V19(), reports: REPORTS_V20() }).state();
const FINAL_TABLES = FINAL_DB['#tables'];
const finalState = (n, extra = {}) => ({ ...finalMeta(n), ...extra, '#tables': FINAL_TABLES, '#project': FINAL_DB['#project'], '#vcs': FINAL_DB['#vcs'], '#codes': FINAL_DB['#codes'], '#reports': FINAL_DB['#reports'] });
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
const same = (a, b) => JSON.stringify(sortObj(a)) === JSON.stringify(sortObj(b));

// 앱(다른 연결)에 보인 상태(meta 와 회의실 표) 가운데 갱신 중이 아닌 것은 처음 아니면 끝이어야 한다(반쯤 바뀐 DB 를 쓰는 앱이 없다).
function assertNoHalfOpen(db, initial, final, label) {
  for (const v of db.visible) {
    if (v.db_updating === '1') continue;
    assert.ok(same(v, initial) || (final && same(v, final)), `${label}: 갱신 중이 아닌데 처음도 끝도 아닌 상태가 앱에 보였다: ${JSON.stringify(v)}`);
  }
}

//  v18 의 지우기 단계(검증이 잡아야 하는 것): 조건 앞부분 글자. 하나씩 IF(0 AND …) 로 꺼서 ③j3 과 변이에 쓴다.
const V18_STEPS = [
  ['cal_entry_commit', "SET @s := IF(@go AND @m_tbl = 1, 'DROP TABLE cal_entry_commit'"],
  ['cal_entry.source', "SET @s := IF(@go AND @m_col = 1, 'ALTER TABLE cal_entry DROP COLUMN source"],
  ['cal_category.uses_repo', "SET @s := IF(@go AND @m_col = 1, 'ALTER TABLE cal_category DROP COLUMN uses_repo"],
  ['cal_user_pref.git_author', "SET @s := IF(@go AND @m_col = 1, 'ALTER TABLE cal_user_pref DROP COLUMN git_author"],
  ['cal_user_pref.svn_author', "SET @s := IF(@go AND @m_col = 1, 'ALTER TABLE cal_user_pref DROP COLUMN svn_author"],
  ['cal_user_pref.git_commit_body', "SET @s := IF(@go AND @m_col = 1, 'ALTER TABLE cal_user_pref DROP COLUMN git_commit_body"],
];

const checks = {
  // ══ ① 사슬 검사 ════════════════════════════════════════════════════
  chainOk(script = GEN) {
    const r = gen(FRAG_DIR, APP, { checkOnly: true, script });
    assert.strictEqual(r.code, 0, `실제 조각 사슬 확인이 실패한다(exit ${r.code}): ${r.log}`);
    const end = gen(FRAG_DIR, APP + 1, { checkOnly: true, script });
    assert.strictEqual(end.code, 5, `사슬의 끝이 앱 구조 번호와 달라도 실패하지 않는다(exit ${end.code})`);
    assert.ok(/\[CHAIN_END\]/.test(end.log), '사슬 끝 불일치의 꼬리표가 CHAIN_END 가 아니다');
  },
  chainBroken() {
    const gap = gen(fragDir({ 'v14-version-gate.sql': null, 'v16-test.sql': fakeFrag(15, 16) }), 16, { checkOnly: true });
    assert.strictEqual(gap.code, 4, `빈틈(15 출발 조각 없음)을 잡지 못한다(exit ${gap.code})`);
    assert.ok(/\[CHAIN_GAP\]/.test(gap.log), '빈틈의 꼬리표가 CHAIN_GAP 이 아니다');
    const dup = gen(fragDir({ 'v14-version-gate.sql': null, 'v14-other.sql': fakeFrag(13, 14, { marker: 'x_dup' }) }), 14, { checkOnly: true });
    assert.strictEqual(dup.code, 4, `같은 번호에서 출발하는 조각 둘을 잡지 못한다(exit ${dup.code})`);
    const none = gen(fragDir({}), APP, { checkOnly: true });
    assert.strictEqual(none.code, 5, `조각이 없는데 실패하지 않는다(exit ${none.code})`);
  },
  fragmentRules() {
    const real = readText(join(FRAG_DIR, 'v14-version-gate.sql'));
    const cases = [
      ['머리 없음', real.replace(/^-- @migration from=13 to=14\n/, ''), 'BAD_HEADER'],
      ['두 칸', real.replace('-- @migration from=13 to=14', '-- @migration from=13 to=15'), 'BAD_STEP'],
      ['구조 번호 올리기 없음', real.replace("UPDATE cal_schema_meta SET v = '14', updated_at = UTC_TIMESTAMP(3)\n WHERE k = 'db_structure_version' AND v = '13';", ''), 'NO_BUMP'],
      ['db_updating 쓰기', real + "UPDATE cal_schema_meta SET v = '0', updated_at = UTC_TIMESTAMP(3) WHERE k = 'db_updating';\n", 'WRITES_UPDATING'],
      ['저장 프로그램', real + 'DROP PROCEDURE IF EXISTS p;\n', 'STORED_PROGRAM'],
      ['감싸개 변수', real + 'SET @r_n := 0;\n', 'USES_R_VAR'],
    ];
    for (const [label, body, tag] of cases) {
      assert.notStrictEqual(body, real, `변이 준비 실패: ${label}`);
      const r = gen(fragDir({ 'v14-version-gate.sql': body }), 14, { checkOnly: true });
      assert.strictEqual(r.code, 3, `${label}: 조각 규칙 위반을 잡지 못한다(exit ${r.code})`);
      assert.ok(r.log.includes(`[${tag}]`), `${label}: 꼬리표가 ${tag} 가 아니다: ${r.log}`);
    }
  },
  exitCodes(src) {
    const table = exitCodesInTable(exitCodeTable(src, false));
    const code = maskPs(src);
    const used = new Set([...code.matchAll(/Stop-Gen '[A-Z_]+' "[^"\n]*" (\d+)/g)].map((m) => Number(m[1])));
    for (const m of code.matchAll(/\bexit (\d+)\b/g)) used.add(Number(m[1]));
    assert.deepStrictEqual([...used].sort((a, b) => a - b), table, '종료코드 표와 실제로 내는 코드가 다르다');
  },

  // ══ ② 모양 ═════════════════════════════════════════════════════════
  shape(sql, { app = APP, first = 13, fragments = REAL_FRAGS } = {}) {
    const stmts = splitStatements(sql);
    assert.strictEqual(stmts[0], 'SET SESSION lock_wait_timeout = 10', '맨 위 문장이 SET SESSION lock_wait_timeout = 10 이 아니다(DB-RELEASE-OPS §5.1)');
    assert.strictEqual(stmts[stmts.length - 1], 'SELECT k, v, updated_at FROM cal_schema_meta ORDER BY k', '마지막 문장이 결과 표가 아니다');
    const code = stmts.join(';\n') + ';';
    assert.ok(!/\b(SUPER|GRANT|REVOKE|CREATE\s+USER|SET\s+GLOBAL|PROCEDURE|FUNCTION|TRIGGER|DEFINER|DELIMITER)\b/i.test(code), '쓰지 않기로 한 문장(저장 프로그램, 권한, 전역 설정)이 있다');
    //  멈춤: 모든 @g 는 PREPARE 로 실행되고 실패 쪽은 '없는 표 SELECT'(이름 64자 이내)
    const gs = stmts.map((s, i) => [s, i]).filter(([s]) => /^SET @g := IF\(/.test(s));
    assert.ok(gs.length >= 6, `멈춤 확인이 ${gs.length}개뿐이다`);
    for (const [s, i] of gs) {
      assert.strictEqual(stmts[i + 1], 'PREPARE _g FROM @g', `PREPARE 로 실행되지 않는 멈춤 확인이 있다: ${s.slice(0, 60)}`);
      const m = /'SELECT 1 FROM `(중단: [^`]+)`'\)$/.exec(s);
      assert.ok(m, `멈춤 확인의 실패 쪽이 '없는 표 SELECT' 가 아니다: ${s.slice(0, 80)}`);
      assert.ok([...m[1]].length <= 64, `중단 문장이 64자를 넘는다: ${m[1]}`);
    }
    const at = (re, label) => { const i = stmts.findIndex((s) => re.test(s)); assert.ok(i >= 0, `${label} 을 찾지 못했다`); return i; };
    const iTbl = at(/^SET @g := IF\(@r_tbl = 1,/, '표 확인');
    const iHigh = at(new RegExp(`^SET @g := IF\\(@r_n <= ${app},`), `앱(${app})보다 새 DB 멈춤`);
    const iLow = at(new RegExp(`^SET @g := IF\\(@r_n >= ${first},`), `사슬 출발(${first})보다 낮은 DB 멈춤`);
    const iUpd = at(/^SET @g := IF\(@r_upd <=> '0' OR @r_upd <=> '1'/, 'db_updating 값 확인');
    const iNeed = at(new RegExp(`^SET @r_need := \\(@r_n < ${app}\\)$`), '닫을지 판단(@r_need)');
    const iClose = at(/VALUES \(''db_updating'', ''1''/, '닫기');
    assert.ok(/^SET @s := IF\(@r_need,/.test(stmts[iClose]), '닫기가 구조 번호가 낮을 때(@r_need)만 실행되지 않는다');
    assert.strictEqual(stmts.filter((s) => /''db_updating'', ''1''|SET v = '1'[^;]*db_updating/.test(s)).length, 1, 'db_updating = 1 을 쓰는 자리가 닫기 하나가 아니다');
    assert.ok(Math.max(iTbl, iHigh, iLow, iUpd) < iNeed && iNeed < iClose, '확인이 닫기보다 먼저가 아니다');
    //  조각: 닫기 뒤, 이름이 아니라 구조 번호 순서
    const marks = fragments.map((f) => { const i = sql.indexOf(`-- ---------- 조각 ${f} (`); assert.ok(i >= 0, `조각 ${f} 가 들어 있지 않다`); return i; });
    for (let k = 1; k < marks.length; k++) assert.ok(marks[k - 1] < marks[k], `조각 순서가 구조 번호 순서가 아니다: ${fragments.join(', ')}`);
    assert.ok(sql.indexOf("VALUES (''db_updating'', ''1''") < marks[0], '닫기가 첫 조각보다 먼저가 아니다');
    //  끝 확인, 그다음 마지막 한 트랜잭션
    const iEnd = at(/^SET @g := IF\(@r_cur <=> '\d+' AND @r_nold = 0 AND @r_keys = 5/, '끝 확인');
    assert.ok(new RegExp(`^SET @g := IF\\(@r_cur <=> '${app}' `).test(stmts[iEnd]), `끝 확인이 구조 번호 ${app} 를 요구하지 않는다`);
    assert.ok(sql.indexOf(`-- ---------- 조각 ${fragments[fragments.length - 1]} 끝`) < sql.indexOf("'SELECT 1 FROM `중단: 끝 확인 실패"), '끝 확인이 마지막 조각보다 먼저다');
    const tStarts = stmts.map((s, i) => (s === 'START TRANSACTION' ? i : -1)).filter((i) => i >= 0);
    const iT = tStarts[tStarts.length - 1], iC = stmts.lastIndexOf('COMMIT');
    assert.ok(iT > iEnd && iC === stmts.length - 2, '열기 트랜잭션이 끝 확인 뒤, 결과 표 바로 앞이 아니다');
    const tx = stmts.slice(iT + 1, iC);
    const want = [['app_latest_version', VER], ['app_installer_file', FILE], ['app_installer_sha256', SHA], ['db_updating', '0']];
    assert.strictEqual(tx.length, 4, `열기 트랜잭션의 문장이 넷이 아니다: ${tx.join(' | ')}`);
    want.forEach(([k, v], j) => assert.strictEqual(tx[j],
      `UPDATE cal_schema_meta SET v = '${v}', updated_at = UTC_TIMESTAMP(3) WHERE k = '${k}' AND v <> '${v}'`, `열기 트랜잭션의 ${j + 1}번째가 ${k} = ${v} 가 아니다`));
    for (const [k, v] of want.slice(0, 3)) assert.ok(!stmts.slice(0, iT).some((s) => s.includes(`'${v}'`)), `${k} 값이 열기 트랜잭션 밖에서 쓰인다`);
    //  머리말: 운영자 절차
    for (const w of ['latest.json', 'Data Export', '-- Dump completed', 'Ctrl+Shift+Enter', `release-v${VER}.sql`, SHA, FILE])
      assert.ok(sql.slice(0, sql.indexOf('SET SESSION')).includes(w), `머리말에 ${w} 가 없다`);
  },

  // ══ ③ 상태 전이 ════════════════════════════════════════════════════
  //  출발 상태 init 은 { meta, tables }. 결과는 meta 와 회의실 표(state)를 함께 본다.
  fresh13(sql) {
    const init = S.legacy13();
    const db = open(init);
    const r = db.run(sql);
    assert.ok(r.ok, `13 에서 처음 돌리면 끝나야 한다: ${JSON.stringify(r)}`);
    assert.ok(same(db.meta(), finalMeta(APP)), `13 에서 돌린 결과가 키 다섯 개(구조 ${APP}, 갱신 중 0, 새 배포 정보)가 아니다: ${JSON.stringify(db.meta())}`);
    assert.ok(same(db.state(), finalState(APP)), `13 에서 돌린 결과의 회의실 표가 공용 목록 하나(cal_room 없음)가 아니다: ${db.state()['#tables']}`);
    assert.ok(/VERSION-GATE/.test(db.comment), '표 설명을 바꾸지 않았다');
    assert.deepStrictEqual(db.writes[0], { k: 'db_updating', v: '1', was: null }, '첫 쓰기가 닫기(db_updating 1 만들기)가 아니다');
    assert.deepStrictEqual(db.writes[db.writes.length - 1].k, 'db_updating', '마지막 쓰기가 열기(db_updating 0)가 아니다');
    //  조각은 구조 번호 순서로 돈다: 14 의 키 바꾸기, 15 의 회의실 옮기기, 16 의 과제 캘린더 표 만들기(FK 순서), 17 의 칸, CHECK, 그림 표
    const iKeys = db.writes.findIndex((w) => w.k === 'app_latest_version'), iRoom = db.writes.findIndex((w) => w.k === 'table:room_code');
    const iPc = PC_TABLES.map((t) => db.writes.findIndex((w) => w.k === `table:${t}`));
    assert.ok(iKeys > 0 && iRoom > iKeys, `조각 순서가 구조 번호 순서가 아니다(v14 키 ${iKeys}, v15 회의실 ${iRoom})`);
    assert.ok(iPc[0] > iRoom && iPc.every((x, k) => k === 0 || x > iPc[k - 1]), `v16 표 만들기가 v15 뒤에 FK 순서(event, change)로 돌지 않는다: ${iPc}`);
    const iMr = ['col:project.dev_start_date', 'check:chk_project_dev_dates', `table:${SI_TABLE}`].map((k) => db.writes.findIndex((w) => w.k === k));
    assert.ok(iMr[0] > iPc[iPc.length - 1] && iMr[1] > iMr[0] && iMr[2] > iMr[1], `v17(칸, CHECK, 그림 표)이 v16 뒤에 차례로 돌지 않는다: ${iMr}`);
    //  v18: 커밋 기록 지우기, 커밋 목록 표 지우기, CHECK 다음 칸(source), 마지막 칸(git_commit_body) 순서이고 v17 뒤다
    const iGit = ['table:cal_entry', 'table:cal_entry_commit', 'check:chk_cal_entry_git', 'col:cal_entry.source', 'col:cal_user_pref.git_commit_body']
      .map((k) => db.writes.findIndex((w) => w.k === k));
    assert.ok(iGit[0] > iMr[2] && iGit.every((x, k) => k === 0 || x > iGit[k - 1]), `v18(지우기, 표, CHECK, 칸)이 v17 뒤에 차례로 돌지 않는다: ${iGit}`);
    //  v19: 순서 칸, 코드표 표 설명 둘, 처음 순서 채우기 순서이고 v18 뒤다
    const iOrd = ['col:project.sort_no', 'comment:section_code', 'comment:status_code', 'table:project'].map((k) => db.writes.findIndex((w) => w.k === k));
    assert.ok(iOrd[0] > iGit[iGit.length - 1] && iOrd.every((x, k) => k === 0 || x > iOrd[k - 1]), `v19(칸, 표 설명, 순서 채우기)가 v18 뒤에 차례로 돌지 않는다: ${iOrd}`);
    assertNoHalfOpen(db, stateOf(init), finalState(APP), '13 에서 처음');
    //  성공 뒤 다시 돌리면 바뀌는 것이 없다
    const n = db.writes.length, before = db.stamps(), shape = db.state();
    assert.ok(db.run(sql).ok, '성공 뒤 다시 돌리면 끝나야 한다');
    assert.strictEqual(db.writes.length, n, `성공 뒤 다시 돌렸는데 ${db.writes.length - n}행을 바꿨다`);
    assert.deepStrictEqual(db.stamps(), before, '성공 뒤 다시 돌렸는데 updated_at 이 바뀌었다');
    assert.ok(same(db.state(), shape), '성공 뒤 다시 돌렸는데 회의실 표가 바뀌었다');
  },
  // 한 칸 앞(APP-1, 과제 캘린더 표까지 있고 월간보고 칸과 그림 표가 없는 16)에서 올리는 보통의 구조 배포
  fromPrev(sql) {
    const init = S.at(APP - 1);
    const db = open(init);
    const r = db.run(sql);
    assert.ok(r.ok, `${APP - 1} 에서 올리는 배포가 끝나지 않는다: ${JSON.stringify(r)}`);
    assert.ok(same(db.state(), finalState(APP)), `${APP - 1} 에서 올린 결과가 다르다: ${JSON.stringify(db.state())}`);
    assert.deepStrictEqual(db.writes[0], { k: 'db_updating', v: '1', was: '0' }, '첫 쓰기가 닫기가 아니다');
    assert.ok(!db.writes.some((w) => w.k === 'schema_version'), `${APP - 1} 에서 올리는데 v14 조각이 옛 키를 건드렸다`);
    assert.strictEqual(db.comment, '', `${APP - 1} 에서 올리는데 v14 조각이 표 설명을 바꿨다(건너뛰지 않았다)`);
    assertNoHalfOpen(db, stateOf(init), finalState(APP), `${APP - 1} 에서`);
  },
  // 건너뛴 배포: 14(cal_room 이 있다)에서 v15, v16, v17 을 몰아 올린다. v14 조각은 건너뛴다.
  from14(sql) {
    const init = S.at(14);
    const db = open(init);
    const r = db.run(sql);
    assert.ok(r.ok, `14 에서 올리는 배포가 끝나지 않는다: ${JSON.stringify(r)}`);
    assert.ok(same(db.state(), finalState(APP)), `14 에서 올린 결과가 다르다: ${JSON.stringify(db.state())}`);
    assert.strictEqual(db.comment, '', '14 에서 올리는데 v14 조각이 표 설명을 바꿨다(건너뛰지 않았다)');
    assert.ok(db.writes.findIndex((w) => w.k === 'table:cal_room') < db.writes.findIndex((w) => w.k === 'table:cal_project_event'),
      '14 에서 올리는데 v15(cal_room 지우기)가 v16 보다 먼저 돌지 않는다');
    assertNoHalfOpen(db, stateOf(init), finalState(APP), '14 에서');
  },
  // v16 검증: 같은 이름의 다른 모양 표가 이미 있으면(IF NOT EXISTS 가 그대로 둔다) 닫힌 채 멈추고 구조 번호를 올리지 않는다
  pcVerify(sql) {
    const mk = () => { const x = S.at(15); x.tables.cal_project_event = []; x.defs = { cal_project_event: { cols: 5, fks: 0 } }; return x; };
    const db = open(mk());
    const r = db.run(sql);
    assert.ok(!r.ok && /v16 조각 검증 실패/.test(r.stop || ''), `과제 캘린더 표 모양이 다른데 v16 검증에서 멈추지 않았다: ${JSON.stringify(r)}`);
    assert.strictEqual(db.meta().db_updating, '1', 'v16 검증에서 멈췄는데 닫힌 상태(db_updating 1)가 아니다');
    assert.strictEqual(db.meta().db_structure_version, '15', 'v16 검증에서 멈췄는데 구조 번호가 올라갔다');
    assert.ok(!db.hasTable(SI_TABLE), 'v16 검증에서 멈췄는데 v17 이 돌았다');
    assertNoHalfOpen(db, stateOf(mk()), null, 'v16 검증 멈춤');
  },
  // v17 검증: 같은 이름의 다른 모양(그림 표의 열 수, 또는 dev_start_date 의 형과 자리)이 이미 있으면 닫힌 채 멈추고 구조 번호를 올리지 않는다
  mrVerify(sql) {
    const cases = [
      ['그림 표 모양이 다름', () => { const x = S.at(16); x.tables[SI_TABLE] = []; x.defs = { ...x.defs, [SI_TABLE]: { cols: 4, fks: 0 } }; return x; }],
      ['개발 시작일 형이 다름', () => { const x = S.at(16); x.project.cols.splice(x.project.cols.indexOf('end_date:date?') + 1, 0, 'dev_start_date:varchar'); return x; }],
      ['개발 시작일 자리가 다름', () => { const x = S.at(16); x.project.cols.push('dev_start_date:date?'); return x; }],
    ];
    for (const [label, mk] of cases) {
      const db = open(mk());
      const r = db.run(sql);
      assert.ok(!r.ok && /v17 조각 검증 실패/.test(r.stop || ''), `${label}: v17 검증에서 멈추지 않았다: ${JSON.stringify(r)}`);
      assert.strictEqual(db.meta().db_updating, '1', `${label}: v17 검증에서 멈췄는데 닫힌 상태(db_updating 1)가 아니다`);
      assert.strictEqual(db.meta().db_structure_version, '16', `${label}: v17 검증에서 멈췄는데 구조 번호가 올라갔다`);
      assertNoHalfOpen(db, stateOf(mk()), null, `v17 검증 멈춤(${label})`);
    }
  },
  appOnly(sql) {
    const init = S.at(APP);
    const db = open(init);
    const r = db.run(sql);
    assert.ok(r.ok, `앱만 바뀐 배포가 끝나지 않는다: ${JSON.stringify(r)}`);
    assert.ok(same(db.meta(), finalMeta(APP)), `앱만 바뀐 배포 결과가 다르다: ${JSON.stringify(db.meta())}`);
    assert.ok(!db.writes.some((w) => w.k === 'db_updating'), '앱만 바뀐 배포가 닫는다(db_updating 을 쓴다)');
    assert.deepStrictEqual(db.writes.map((w) => w.k), ['app_latest_version', 'app_installer_file', 'app_installer_sha256'], '앱만 바뀐 배포가 app_ 세 키 말고 다른 것을 바꾼다');
    assert.strictEqual(db.comment, '', '앱만 바뀐 배포가 조각을 실행했다(표 설명을 바꿨다)');
    assert.ok(same(db.state(), finalState(APP)), '앱만 바뀐 배포가 회의실 표를 바꿨다');
    assertNoHalfOpen(db, stateOf(init), finalState(APP), '앱만 바뀐 배포');
  },
  finishStuck(sql) {
    const db = open(S.at(APP, '1'));
    const r = db.run(sql);
    assert.ok(r.ok, `구조 ${APP} 에 갱신 중 1 로 멈춘 DB 를 마무리하지 못한다: ${JSON.stringify(r)}`);
    assert.ok(same(db.state(), finalState(APP)), `마무리 결과가 다르다: ${JSON.stringify(db.state())}`);
  },
  refuses(sql) {
    const at = S.at(APP);
    const cases = [
      ['앱보다 새 DB', S.at(APP + 1), /보다 높다/],
      ['사슬보다 낮은 DB(옛 키 12)', { meta: { schema_version: '12' }, tables: T.old() }, /보다 낮다/],
      ['옛 키가 13 이 아님', { meta: { schema_version: String(APP) }, tables: T.old() }, /옛 키 schema_version 이 13 이 아니다/],
      ['숫자 아님', S.at('abc'), /읽을 수 없다/],
      ['두 키가 다름', { ...at, meta: { ...at.meta, schema_version: '13' } }, /읽을 수 없다/],
      ['구조 번호 없음', { meta: { db_updating: '0' } }, /읽을 수 없다/],
      ['db_updating 이상한 값', S.at(APP, '2'), /0 도 1 도 아니다/],
      ['구조는 있는데 db_updating 없음', { meta: { db_structure_version: String(APP) }, tables: T.shared() }, /0 도 1 도 아니다/],
      ['app_ 키 빠짐', { meta: { db_structure_version: String(APP), db_updating: '0' }, tables: T.shared() }, /끝 확인 실패/],
    ];
    for (const [label, init, re] of cases) {
      const db = open(init);
      const r = db.run(sql);
      assert.ok(!r.ok && re.test(r.stop || ''), `${label}: 기대한 이유로 멈추지 않았다: ${JSON.stringify(r)}`);
      assert.strictEqual(db.writes.length, 0, `${label}: 멈췄는데 바꾼 것이 있다`);
    }
    const noTable = new FakeDb({}, { tableExists: false });
    assert.ok(/표가 없다/.test(noTable.run(sql).stop || ''), 'cal_schema_meta 가 없는 DB 에서 표 확인으로 멈추지 않는다');
  },
  // v15 검증: 공용 목록에 모르는 이름이 이미 있으면(줄 수가 고유 이름 수와 다름) 닫힌 채 멈추고 cal_room 을 지우지 않는다
  roomVerify(sql) {
    const mk = () => { const x = S.at(14); x.tables.room_code = [{ name: '모르는 방', sort_order: 10 }]; return x; };
    const db = open(mk());
    const r = db.run(sql);
    assert.ok(!r.ok && /회의실 이름 수가 맞지 않는다/.test(r.stop || ''), `room_code 에 모르는 이름이 있는데 v15 검증에서 멈추지 않았다: ${JSON.stringify(r)}`);
    assert.strictEqual(db.meta().db_updating, '1', 'v15 검증에서 멈췄는데 닫힌 상태(db_updating 1)가 아니다');
    assert.strictEqual(db.meta().db_structure_version, '14', 'v15 검증에서 멈췄는데 구조 번호가 올라갔다');
    assert.ok(!db.hasTable('cal_project_event'), 'v15 검증에서 멈췄는데 v16 이 돌았다');
    assert.ok(db.hasTable('cal_room'), 'v15 검증에서 멈췄는데 cal_room 을 지웠다');
    assertNoHalfOpen(db, stateOf(mk()), null, 'v15 검증 멈춤');
  },
  // 바꾸는 문장마다 실패를 넣는다. 멈춘 동안 앱에 반쯤 바뀐 상태가 보이지 않고, 같은 파일을 다시 돌리면 끝난다.
  faults(sql, init, app, label) {
    const clean = open(init());
    assert.ok(clean.run(sql).ok, `${label}: 실패 없이 돌린 것이 끝나지 않는다`);
    const N = clean.mutations;
    assert.ok(N >= 3, `${label}: 바꾸는 문장이 ${N}개뿐이다(흉내 실행이 빗나갔다)`);
    for (let k = 1; k <= N; k++) {
      const db = open(init());
      const r = db.run(sql, { failAt: k });
      assert.strictEqual(r.fault, k, `${label}: ${k}번째 바꾸는 문장에 넣은 실패로 멈추지 않았다: ${JSON.stringify(r)}`);
      assertNoHalfOpen(db, stateOf(init()), null, `${label}, ${k}번째에서 실패`);
      const again = db.run(sql);
      assert.ok(again.ok, `${label}: ${k}번째에서 실패한 뒤 같은 파일을 다시 돌려도 끝나지 않는다: ${JSON.stringify(again)}`);
      assert.ok(same(db.state(), clean.state()), `${label}: ${k}번째 실패 뒤 다시 돌린 결과가 실패 없이 돌린 것과 다르다: ${JSON.stringify(db.state())}`);
      assert.strictEqual(db.comment, clean.comment, `${label}: ${k}번째 실패 뒤 다시 돌린 표 설명이 다르다`);
    }
  },
  // 실제 사슬 뒤에 시험용 조각(APP 에서 NEXT)을 붙인 SQL: 13, 14, APP 어디서 출발해도 조각을 차례로 돌린다
  extended(sql) {
    const want = finalState(NEXT, { [NEXT_MARK]: 'on' });
    for (const [label, init] of [[`13 에서 ${NEXT}`, S.legacy13], [`14 에서 ${NEXT}`, () => S.at(14)], [`${APP} 에서 ${NEXT}`, () => S.at(APP)]]) {
      const db = open(init());
      const r = db.run(sql);
      assert.ok(r.ok, `건너뛴 배포(${label})가 끝나지 않는다: ${JSON.stringify(r)}`);
      assert.ok(same(db.state(), want), `건너뛴 배포(${label}) 결과가 다르다: ${JSON.stringify(db.state())}`);
      assertNoHalfOpen(db, stateOf(init()), want, `건너뛴 배포(${label})`);
    }
    const atNext = open(S.at(NEXT));
    assert.ok(atNext.run(sql).ok && !atNext.writes.some((w) => w.k === 'db_updating' || w.k === NEXT_MARK || w.k.startsWith('table:')),
      `이미 ${NEXT} 인 DB 에서 닫거나 조각을 실행했다`);
  },
  // v18 결과: 커밋 기록과 그 자식 행(커밋 목록)이 지워지고, 일반 일정과 그 예외일은 남고, 표와 칸과 CHECK 가 없어진다
  gitRemoved(sql) {
    const db = open(S.at(17));
    const r = db.run(sql);
    assert.ok(r.ok, `17 에서 18 로 올리는 배포가 끝나지 않는다: ${JSON.stringify(r)}`);
    assert.ok(!db.hasTable('cal_entry_commit'), 'cal_entry_commit 이 남았다');
    assert.deepStrictEqual(db.tableShape().cal_entry, ['1:2', '2:5'], `커밋 기록만 지우고 일반 일정은 남겨야 한다(source 칸 없음): ${db.tableShape().cal_entry}`);
    assert.deepStrictEqual(db.tableShape().cal_entry_except, ['1:2:2026-10-07'], '일반 일정의 예외일이 사라졌다');
    assert.deepStrictEqual(db.vcs.cols, [], `지울 칸이 남았다: ${db.vcs.cols}`);
    assert.deepStrictEqual(db.vcs.checks, [], `지울 CHECK 가 남았다: ${db.vcs.checks}`);
    assert.strictEqual(db.vcs.prefComment, PREF_COMMENT_V18, 'cal_user_pref 표 설명이 18 이 아니다');
    assert.strictEqual(db.writes.find((w) => w.k === 'table:cal_entry')?.v, '-2', '커밋 기록 두 건을 지우지 않았다');
    //  다시 돌려도 바뀌는 것이 없다(조각은 건너뛰고 열기는 같은 값이라 0행)
    const n = db.writes.length, shape = db.state();
    assert.ok(db.run(sql).ok, '17 에서 올린 뒤 다시 돌리면 끝나야 한다');
    assert.strictEqual(db.writes.length, n, `다시 돌렸는데 ${db.writes.length - n}행을 바꿨다`);
    assert.ok(same(db.state(), shape), '다시 돌렸는데 표나 칸이 바뀌었다');
  },
  // v18 검증: 어느 지우기든 빠지면(조각이 잘못 고쳐지면) 닫힌 채 멈추고 구조 번호를 올리지 않는다
  gitVerify(sql, label) {
    const db = open(S.at(17));
    const r = db.run(sql);
    assert.ok(!r.ok && /v18 조각 검증 실패/.test(r.stop || ''), `${label}: v18 검증에서 멈추지 않았다: ${JSON.stringify(r)}`);
    assert.strictEqual(db.meta().db_updating, '1', `${label}: v18 검증에서 멈췄는데 닫힌 상태(db_updating 1)가 아니다`);
    assert.strictEqual(db.meta().db_structure_version, '17', `${label}: v18 검증에서 멈췄는데 구조 번호가 올라갔다`);
    assertNoHalfOpen(db, stateOf(S.at(17)), null, `v18 검증 멈춤(${label})`);
  },
  // v18 남은 커밋 기록: 지우기의 WHERE(user_id > 0, Workbench 안전 갱신 모드용)가 못 지운 git 행이 있으면 칸을 지우기 전에 멈춘다
  gitLeft(sql) {
    const mk = () => { const x = S.at(17); x.tables.cal_entry.push({ user_id: 0, entry_no: 9, source: 'git' }); return x; };
    const db = open(mk());
    const r = db.run(sql);
    assert.ok(!r.ok && /커밋 기록이 남았다/.test(r.stop || ''), `user_id 0 의 커밋 기록이 남았는데 멈추지 않았다: ${JSON.stringify(r)}`);
    assert.strictEqual(db.meta().db_updating, '1', '커밋 기록이 남아 멈췄는데 닫힌 상태가 아니다');
    assert.ok(db.hasCol('cal_entry', 'source') && db.hasTable('cal_entry_commit'), '커밋 기록이 남았는데 칸이나 표를 지웠다');
    assertNoHalfOpen(db, stateOf(mk()), null, 'v18 커밋 기록 남음');
  },
  // v19 결과: 순서 칸이 status_id 뒤에 생기고, 코드표 표 설명이 19 가 되고, 보이는 과제에 구분마다 표시 이름 순 1 부터, 숨긴 과제는 NULL
  orderAdded(sql) {
    const db = open(S.at(18));
    const r = db.run(sql);
    assert.ok(r.ok, `18 에서 19 로 올리는 배포가 끝나지 않는다: ${JSON.stringify(r)}`);
    assert.deepStrictEqual(db.project, PROJECT_V19(), `project 모양이 정본(v19, status_id 뒤 sort_no)과 다르다: ${JSON.stringify(db.project)}`);
    assert.deepStrictEqual(db.codes, CODES_V19(), `코드표 표 설명이 19 가 아니다: ${JSON.stringify(db.codes)}`);
    const got = Object.fromEntries(db.tables.project.map((x) => [x.id, x.sort_no]));
    assert.deepStrictEqual(got, PROJ_SORT19, `처음 순서가 (구분마다 표시 이름 순 1 부터, 숨긴 과제 NULL) 이 아니다: ${JSON.stringify(got)}`);
    assert.strictEqual(db.writes.find((w) => w.k === 'table:project')?.v, 'sort_no+5', '보이는 과제 다섯에만 순서를 매기지 않았다');
    //  다시 돌려도 바뀌는 것이 없다(조각은 건너뛰고 열기는 같은 값이라 0행)
    const n = db.writes.length, shape = db.state();
    assert.ok(db.run(sql).ok, '18 에서 올린 뒤 다시 돌리면 끝나야 한다');
    assert.strictEqual(db.writes.length, n, `다시 돌렸는데 ${db.writes.length - n}행을 바꿨다`);
    assert.ok(same(db.state(), shape), '다시 돌렸는데 표나 칸이 바뀌었다');
  },
  // v19 이어서 끝내기: 칸이 이미 있고 일부에 번호가 있으면(앞선 실행이 남긴 값) 그 번호는 두고, 빈 것만 그 구분의 최댓값 뒤에 붙인다
  orderKeeps(sql) {
    const init = S.at(18);
    init.project = PROJECT_V19();
    init.tables.project = PROJ_ROWS18().map((x) => ({ ...x, sort_no: x.id === 1 ? 7 : null }));
    const db = open(init);
    const r = db.run(sql);
    assert.ok(r.ok, `순서 칸이 이미 있는 18 에서 올리는 배포가 끝나지 않는다: ${JSON.stringify(r)}`);
    const got = Object.fromEntries(db.tables.project.map((x) => [x.id, x.sort_no]));
    assert.deepStrictEqual(got, { 1: 7, 2: 8, 3: null, 4: 2, 5: 1, 6: 1 }, `이미 있던 번호를 두고 빈 것만 그 구분의 최댓값 뒤에 붙이지 않았다: ${JSON.stringify(got)}`);
  },
  // v19 검증: 같은 이름의 다른 모양 칸이 있거나(형, 자리), 표 설명이나 순서 채우기가 빠지면 닫힌 채 멈추고 구조 번호를 올리지 않는다
  orderVerify(sql, label, mk = () => S.at(18)) {
    const db = open(mk());
    const r = db.run(sql);
    assert.ok(!r.ok && /v19 조각 검증 실패/.test(r.stop || ''), `${label}: v19 검증에서 멈추지 않았다: ${JSON.stringify(r)}`);
    assert.strictEqual(db.meta().db_updating, '1', `${label}: v19 검증에서 멈췄는데 닫힌 상태(db_updating 1)가 아니다`);
    assert.strictEqual(db.meta().db_structure_version, '18', `${label}: v19 검증에서 멈췄는데 구조 번호가 올라갔다`);
    assertNoHalfOpen(db, stateOf(mk()), null, `v19 검증 멈춤(${label})`);
  },
};
//  v19 검증이 잡아야 하는 출발 모양(같은 이름의 다른 칸)
const V19_BAD_SHAPES = [
  ['순서 칸 형이 다름(부호 있는 INT)', () => { const x = S.at(18); x.project.cols.splice(x.project.cols.indexOf('status_id:smallint?') + 1, 0, 'sort_no:int?'); return x; }],
  ['순서 칸 자리가 다름(맨 끝)', () => { const x = S.at(18); x.project.cols.push('sort_no:int unsigned?'); return x; }],
];
//  v19 의 바꾸기 단계(검증이 잡아야 하는 것): 조건 앞부분 글자. 하나씩 IF(0 …) 로 꺼서 ③k3 과 변이에 쓴다.
const V19_STEPS = [
  ['구분 표 설명', "SET @s := IF(@go, 'ALTER TABLE section_code COMMENT"],
  ['상태 표 설명', "SET @s := IF(@go, 'ALTER TABLE status_code COMMENT"],
  ['처음 순서 채우기', "SET @s := IF(@go,\n  'UPDATE project p"],
];

// ══ ④ 조각 폴더 ═══════════════════════════════════════════════════════
test('배포SQL④: db/deploy/migrations 의 조각은 모두 머리, 자기 건너뛰기, 구조 번호 올리기 한 줄, db_updating 쓰기 없음을 지킨다', () => {
  const files = readdirSync(FRAG_DIR).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.length >= 1, '조각이 하나도 없다');
  for (const f of files) {
    const t = readText(join(FRAG_DIR, f)).replace(/\r\n/g, '\n');
    const h = /^-- @migration from=(\d+) to=(\d+)\n/.exec(t);
    assert.ok(h, `${f}: 첫 줄이 '-- @migration from=N to=M' 이 아니다`);
    const [from, to] = [h[1], h[2]];
    assert.strictEqual(f, `v${to}-${f.replace(/^v\d+-/, '')}`, `${f}: 파일 이름이 v<도착 번호>- 로 시작하지 않는다`);
    const code = t.split('\n').map((l) => l.replace(/^\s*--.*$/, '')).join('\n');
    assert.ok(new RegExp(`SET @skip := \\([^;]*>= ${to}\\);`).test(code), `${f}: 이미 ${to} 이상이면 건너뛰는 확인(@skip)이 없다`);
    assert.ok(new RegExp(`SET @go := \\([^;]*<=> '${from}'\\);`).test(code), `${f}: ${from} 일 때만 바꾸는 확인(@go)이 없다`);
    assert.ok(/SET @g := IF\(NOT @go OR @m_upd <=> '1',/.test(code), `${f}: 닫히지 않은 DB 에서 멈추지 않는다(release SQL 로만 돌린다)`);
    const bumps = code.match(/UPDATE cal_schema_meta SET v = '\d+', updated_at = UTC_TIMESTAMP\(3\)\n WHERE k = 'db_structure_version' AND v = '\d+';/g) || [];
    assert.deepStrictEqual(bumps, [`UPDATE cal_schema_meta SET v = '${to}', updated_at = UTC_TIMESTAMP(3)\n WHERE k = 'db_structure_version' AND v = '${from}';`], `${f}: 구조 번호를 ${from} 에서 ${to} 로 올리는 줄이 정확히 하나가 아니다`);
    assert.ok(code.lastIndexOf(bumps[0]) > code.lastIndexOf('COMMIT;'), `${f}: 구조 번호 올리기가 바꾸기 뒤(끝)가 아니다`);
    assert.ok(!/\b(UPDATE|INSERT|REPLACE|DELETE)\b[^;]*db_updating/i.test(code), `${f}: db_updating 을 쓴다(닫기와 열기는 release SQL 의 몫)`);
    assert.ok(!/@r_/.test(code), `${f}: 감싸개 변수(@r_)를 쓴다`);
    assert.ok(!/SET SESSION|lock_wait_timeout/.test(code), `${f}: 잠금 대기 상한은 release SQL 맨 위에 한 번만 둔다`);
  }
});

// ══ 계약 ═══════════════════════════════════════════════════════════════
test('배포SQL①a: 실제 조각 사슬이 맞고, 끝이 앱 구조 번호와 다르면 종료코드 5(CHAIN_END)', () => checks.chainOk());
test('배포SQL①b: 사슬의 빈틈과 겹침은 4, 조각 없음은 5', () => checks.chainBroken());
test('배포SQL①c: 조각 규칙 위반(머리, 두 칸, 올리기 줄 없음, db_updating 쓰기, 저장 프로그램, @r_)은 3', () => checks.fragmentRules());
test('배포SQL①d: release-sql.ps1 의 종료코드 표와 실제로 내는 코드가 같다', () => checks.exitCodes(genSrc));
test('배포SQL②a: 실제 조각으로 만든 SQL 은 확인, 닫기, 조각(구조 번호 순서), 끝 확인, 열기 한 트랜잭션, 결과 표 순서다', () => checks.shape(realSql()));
test(`배포SQL②b: 실제 사슬 뒤에 조각(${NEXT})을 붙이면 구조 번호 순서로 들어가고 끝 확인과 닫기가 ${NEXT} 를 기준으로 한다`, () =>
  checks.shape(extSql(), { app: NEXT, fragments: [...REAL_FRAGS, NEXT_FRAG] }));
test(`배포SQL③a: 13 에서 처음 돌리면 조각을 차례로 지나 ${APP}, 새 배포 정보, 공용 회의실 목록으로 열리고, 다시 돌리면 바뀌는 것이 없다`, () => checks.fresh13(realSql()));
test('배포SQL③b: 앱만 바뀐 배포는 닫지 않고 app_ 세 키만 한 트랜잭션으로 바꾼다', () => checks.appOnly(realSql()));
test('배포SQL③c: 마지막 조각 뒤에 멈춘 DB(구조 = 앱, db_updating 1)는 같은 파일이 열기까지 마무리한다', () => checks.finishStuck(realSql()));
test('배포SQL③d: 새 DB, 낮은 DB, 이상한 값, 키 빠짐, 표 없음에서는 아무것도 바꾸지 않고 멈춘다', () => checks.refuses(realSql()));
test('배포SQL③e: 13 에서 올리는 중 어디서 실패해도 앱에 반쯤 바뀐 DB 가 보이지 않고, 같은 파일을 다시 돌리면 끝난다', () =>
  checks.faults(realSql(), S.legacy13, APP, '13 에서'));
test('배포SQL③f: 앱만 바뀐 배포가 열기 트랜잭션에서 실패해도 다시 돌리면 끝난다', () =>
  checks.faults(realSql(), () => S.at(APP), APP, '앱만'));
test(`배포SQL③g: 한 칸 앞(${APP - 1})에서 올리면 앞 조각은 건너뛰고 마지막 조각만 돌려 열리며, 어디서 실패해도 다시 돌리면 끝난다`, () => {
  checks.fromPrev(realSql());
  checks.faults(realSql(), () => S.at(APP - 1), APP, `${APP - 1} 에서`);
});
test(`배포SQL③g2: 14 에서 올리면 v14 는 건너뛰고 v15(회의실), v16(과제 캘린더), v17(월간보고)을 차례로 돌려 열리며, 어디서 실패해도 다시 돌리면 끝난다`, () => {
  checks.from14(realSql());
  checks.faults(realSql(), () => S.at(14), APP, '14 에서');
});
test('배포SQL③h: v15 검증이 맞지 않으면(공용 목록에 모르는 이름) 닫힌 채 멈추고 cal_room 을 지우지 않는다', () => checks.roomVerify(realSql()));
test('배포SQL③h2: v16 검증이 맞지 않으면(같은 이름의 다른 모양 표) 닫힌 채 멈추고 구조 번호를 올리지 않는다', () => checks.pcVerify(realSql()));
test('배포SQL③h3: v17 검증이 맞지 않으면(그림 표 모양, 개발 시작일 형이나 자리) 닫힌 채 멈추고 구조 번호를 올리지 않는다', () => checks.mrVerify(realSql()));
test('배포SQL③g3: 16 에서 올리면 project 모양이 정본(v17 의 칸과 CHECK, v19 의 순서 칸)과 같아지고, 칸 추가, CHECK, 그림 표 어디서 실패해도 다시 돌리면 끝난다', () => {
  const db = open(S.at(16));
  assert.ok(db.run(realSql()).ok, '16 에서 올리는 배포가 끝나지 않는다');
  assert.strictEqual(db.state()['#project'], JSON.stringify(PROJECT_V19()), `16 에서 올린 project 모양이 정본(v19)과 다르다: ${db.state()['#project']}`);
  checks.faults(realSql(), () => S.at(16), APP, '16 에서');
});
test('배포SQL③j: 17 에서 18 로 올리면 커밋 기록(자식 행 포함)과 cal_entry_commit, 출처, 저장소, 작성자 칸과 CHECK 가 지워지고 다시 돌려도 그대로다', () =>
  checks.gitRemoved(realSql()));
test('배포SQL③j2: 13 에서 18 까지 몰아 올려도 v18 이 마지막에 돌아 같은 끝 상태가 된다(실패 뒤 재실행은 ③e 가 본다)', () => {
  const db = open(S.legacy13());
  assert.ok(db.run(realSql()).ok, '13 에서 18 까지 올리는 배포가 끝나지 않는다');
  assert.ok(same(db.state(), finalState(APP)), `13 에서 올린 결과가 18 끝 상태가 아니다: ${JSON.stringify(db.state())}`);
  assert.ok(!db.hasTable('cal_entry_commit') && db.vcs.cols.length === 0, '13 에서 올렸는데 v18 이 돌지 않았다');
});
test('배포SQL③j3: v18 의 지우기(표 하나, 칸 다섯) 어느 것이 빠져도 검증이 닫힌 채 멈추고 구조 번호를 올리지 않는다', () => {
  for (const [label, from] of V18_STEPS) checks.gitVerify(mutate(realSql(), from, from.replace('IF(@go AND', 'IF(0 AND')), label);
});
test('배포SQL③j4: v18 이 지운 뒤에도 git 기록이 남으면(user_id 0) 칸과 표를 지우기 전에 닫힌 채 멈춘다', () => checks.gitLeft(realSql()));
test('배포SQL③j5: v18 의 cal_user_pref 표 설명은 정본 schema-calendar.sql 과 같은 글자다', () => {
  const m = /CREATE TABLE cal_user_pref \([\s\S]*?\) ENGINE=InnoDB[^\n]*\n\s*COMMENT='((?:[^']|'')*)';/.exec(CANON_CAL);
  assert.ok(m, '정본에서 cal_user_pref 표 설명을 찾지 못했다(판정 불가)');
  assert.strictEqual(m[1].replace(/''/g, "'"), PREF_COMMENT_V18, '정본 cal_user_pref 표 설명이 v18 조각(흉내 실행기 PREF_COMMENT_V18)과 다르다');
  const frag = readText(join(FRAG_DIR, 'v18-remove-git.sql'));
  assert.ok(frag.includes(`ALTER TABLE cal_user_pref COMMENT = ''${PREF_COMMENT_V18}''`), 'v18 조각의 표 설명이 정본과 다르다');
});
test('배포SQL③k: 18 에서 19 로 올리면 순서 칸(status_id 뒤), 코드표 표 설명, 보이는 과제의 처음 순서(구분마다 표시 이름 순)가 생기고 다시 돌려도 그대로다', () =>
  checks.orderAdded(realSql()));
test('배포SQL③k2: 순서 칸이 이미 있고 일부에 번호가 있으면 그 번호는 두고 빈 것만 그 구분의 최댓값 뒤에 붙인다', () => checks.orderKeeps(realSql()));
test('배포SQL③k3: v19 검증이 맞지 않으면(칸의 형이나 자리, 표 설명 하나, 순서 채우기가 빠짐) 닫힌 채 멈추고 구조 번호를 올리지 않는다', () => {
  for (const [label, mk] of V19_BAD_SHAPES) checks.orderVerify(realSql(), label, mk);
  for (const [label, from] of V19_STEPS) checks.orderVerify(mutate(realSql(), from, from.replace('IF(@go', 'IF(0')), label);
});
test('배포SQL③k4: 17 에서 19 까지 두 칸을 몰아 올려도 같은 끝 상태가 되고, 어디서 실패해도 다시 돌리면 끝난다', () => {
  const db = open(S.at(17));
  assert.ok(db.run(realSql()).ok, '17 에서 19 까지 올리는 배포가 끝나지 않는다');
  assert.ok(same(db.state(), finalState(APP)), `17 에서 올린 결과가 끝 상태가 아니다: ${JSON.stringify(db.state())}`);
  checks.faults(realSql(), () => S.at(17), APP, '17 에서');
});
test('배포SQL③k5: v19 의 코드표 표 설명은 정본 schema-structure.sql 과 같은 글자다(흉내 실행기 CODES_V19 와 조각)', () => {
  const struct = readText(join(ROOT, 'db', 'deploy', 'schema-structure.sql'));
  const frag = readText(join(FRAG_DIR, 'v19-project-order.sql'));
  for (const [t, c] of Object.entries(CODES_V19())) {
    const m = new RegExp(`CREATE TABLE ${t} \\([\\s\\S]*?\\) ENGINE=InnoDB[^\\n]*\\n\\s*COMMENT='([^']*)';`).exec(struct);
    assert.ok(m, `정본에서 ${t} 표 설명을 찾지 못했다(판정 불가)`);
    assert.strictEqual(m[1], c, `정본 ${t} 표 설명이 v19(흉내 실행기 CODES_V19)와 다르다`);
    assert.ok(frag.includes(`ALTER TABLE ${t} COMMENT = ''${c}''`), `v19 조각의 ${t} 표 설명이 정본과 다르다`);
    assert.ok(frag.includes(`AND TABLE_COMMENT = '${c}'`), `v19 조각의 검증이 ${t} 표 설명을 정본 글자로 보지 않는다`);
  }
  //  흉내 실행기의 18 까지 표 설명은 2026-10-15 이관이 건 글자다(그 파일은 기록이라 고치지 않는다)
  const mig = readText(join(ROOT, 'db', 'deploy', 'migrate-2026-10-15-code-ids.sql'));
  for (const c of Object.values(CODES_V18())) assert.ok(mig.includes(`COMMENT = '${c}';`), `흉내 실행기 CODES_V18 이 2026-10-15 이관의 표 설명과 다르다: ${c}`);
  //  흉내 실행기가 아는 순서 채우기 문장은 조각의 것과 글자까지 같다(공백만 접는다)
  const body = /SET @s := IF\(@go,\n  '(UPDATE project p[\s\S]*?)',\n  'DO 0'\);/.exec(frag);
  assert.ok(body, 'v19 조각에서 순서 채우기를 찾지 못했다(판정 불가)');
  assert.strictEqual(body[1].replace(/''/g, "'").replace(/\s+/g, ' ').trim(), V19_FILL, '흉내 실행기 V19_FILL 이 조각의 순서 채우기와 다르다');
});
test(`배포SQL③i: 건너뛴 배포(13, 14, ${APP} 에서 ${NEXT})는 조각을 차례로 돌리고, 어디서 실패해도 다시 돌리면 끝난다`, () => {
  checks.extended(extSql());
  checks.faults(extSql(), S.legacy13, NEXT, `13 에서 ${NEXT}`);
});

// ══ 변이: 검사가 정말 무는지 ═══════════════════════════════════════════
//  조립기 사본을 고쳐 돌리거나(PowerShell), 만들어진 SQL 이나 조각을 고쳐 같은 검사에 넣는다.
function mutantGen(from, to) {
  const p = join(TMP, `release-sql-mut-${++seq}.ps1`);
  writeFileSync(p, '﻿' + mutate(genSrc, from, to), 'utf8');
  return p;
}
test('변이R1: 닫기를 늘 하게 바꾸면(앱만 바뀐 배포도 닫음) ③b 가 실패한다', () => {
  const r = gen(FRAG_DIR, APP, { script: mutantGen('SET @s := IF(@r_need,', 'SET @s := IF(1,') });
  assert.strictEqual(r.code, 0, '변이 준비 실패: 사본이 SQL 을 만들지 못했다');
  assert.throws(() => checks.appOnly(r.sql), /닫는다/);
});
test('변이R2: 사슬 끝 검사를 빼면 ①a 가 실패한다', () => {
  const script = mutantGen('if ($lastTo -ne $Structure) {', 'if ($false) {');
  assert.throws(() => checks.chainOk(script), /달라도 실패하지 않는다/);
});
test('변이R3: 열기 트랜잭션에서 db_updating 0 을 빼면 ②a 와 ③a 가 실패한다', () => {
  const bad = mutate(realSql(), "UPDATE cal_schema_meta SET v = '0', updated_at = UTC_TIMESTAMP(3) WHERE k = 'db_updating' AND v <> '0';\n", '');
  assert.throws(() => checks.shape(bad), /문장이 넷이 아니다/);
  assert.throws(() => checks.fresh13(bad), /키 다섯 개/);
});
test('변이R4: 열기를 트랜잭션 밖으로 빼면 ③e 가 실패한다(실패 시 반쯤 바뀐 값이 보인다)', () => {
  const sql = realSql();
  const t = sql.lastIndexOf('START TRANSACTION;\n');
  const bad = sql.slice(0, t) + sql.slice(t).replace('START TRANSACTION;\n', '').replace('COMMIT;\n', '');
  assert.throws(() => checks.faults(bad, () => S.at(APP), APP, '앱만'), /처음도 끝도 아닌 상태/);
});
test('변이R5: 실제 조각 어느 것이든 자기 건너뛰기를 빼면 앱만 바뀐 배포가 멈춘다(③b 실패)', () => {
  for (const f of REAL_FRAGS) {
    const body = mutate(readText(join(FRAG_DIR, f)), 'SET @g := IF(@go OR @skip, ', 'SET @g := IF(@go, ');
    const r = gen(fragDir({ ...Object.fromEntries(REAL_FRAGS.map((x) => [x, null])), [f]: body }), APP);
    assert.strictEqual(r.code, 0, `변이 준비 실패: 사본 조각(${f})으로 SQL 을 만들지 못했다`);
    assert.throws(() => checks.appOnly(r.sql), /끝나지 않는다/, `${f} 의 자기 건너뛰기를 뺐는데 ③b 가 통과한다`);
  }
});
test('변이R7: v15 가 cal_room 을 지우기 전에 검증하지 않으면(검증 끄기) ③h 가 실패한다', () => {
  const bad = mutate(realSql(), 'SET @g := IF(NOT @go OR (@m_rows >= 0 AND (NOT @m_take OR (@m_miss = 0 AND @m_rows = @m_dist))), ', 'SET @g := IF(1, ');
  assert.throws(() => checks.roomVerify(bad), /멈추지 않았다/);
});
test('변이R8: v15 가 cal_room 이 없을 때도 모으기를 하면(@m_take 대신 @go) 실패 뒤 재실행이 멈춘다(③e 실패)', () => {
  const bad = realSql().split("SET @m_take := (@go AND @m_has = 1);").join('SET @m_take := (@go);');
  assert.notStrictEqual(bad, realSql(), '변이 준비 실패');
  assert.throws(() => checks.faults(bad, S.legacy13, APP, '13 에서'), /다시 돌려도 끝나지 않는다/);
});
test('변이R9: v16 이 표 모양을 검증하지 않으면(검증 끄기) ③h2 가 실패한다', () => {
  const sql = realSql();
  const i = sql.indexOf('SET @g := IF(NOT @go OR (@m_c1 = ');
  assert.ok(i >= 0, '변이 준비 실패: v16 검증을 찾지 못했다');
  const bad = sql.slice(0, i) + 'SET @g := IF(1 OR ' + sql.slice(i + 'SET @g := IF('.length);
  assert.throws(() => checks.pcVerify(bad), /멈추지 않았다/);
});
test('변이R10: v16 이 IF NOT EXISTS 없이 표를 만들면 중간 실패 뒤 재실행이 멈춘다(15 에서 올리는 ③g2 와 같은 길 실패)', () => {
  const bad = realSql().split("'CREATE TABLE IF NOT EXISTS cal_project_").join("'CREATE TABLE cal_project_");
  assert.notStrictEqual(bad, realSql(), '변이 준비 실패');
  //  2026-10-22 v17 이 붙어 한 칸 앞(APP - 1)은 16 이다. v16 조각이 도는 출발점은 15 다.
  assert.throws(() => checks.faults(bad, () => S.at(15), APP, '15 에서'), /모르는 문장|다시 돌려도 끝나지 않는다/);
});
test('변이R11: v17 이 칸, CHECK, 그림 표 모양을 검증하지 않으면(검증 끄기) ③h3 이 실패한다', () => {
  const sql = realSql();
  const i = sql.indexOf('SET @g := IF(NOT @go OR (@m_cty = 1 ');
  assert.ok(i >= 0, '변이 준비 실패: v17 검증을 찾지 못했다');
  const bad = sql.slice(0, i) + 'SET @g := IF(1 OR ' + sql.slice(i + 'SET @g := IF('.length);
  assert.throws(() => checks.mrVerify(bad), /멈추지 않았다/);
});
test('변이R12: v17 이 칸이 있는지 보지 않고 늘 더하면 중간 실패 뒤 재실행이 멈춘다(③g3 실패)', () => {
  //  2026-10-26 v19 도 같은 모양의 칸 확인을 써서 앵커에 v17 의 칸 이름까지 넣는다.
  const bad = mutate(realSql(), "SET @s := IF(@go AND @m_col = 0,\n  'ALTER TABLE project ADD COLUMN dev_start_date", "SET @s := IF(@go,\n  'ALTER TABLE project ADD COLUMN dev_start_date");
  assert.throws(() => checks.faults(bad, () => S.at(16), APP, '16 에서'), /다시 돌려도 끝나지 않는다/);
});
test('변이R13: v17 이 CHECK 가 있는지 보지 않고 늘 걸면 중간 실패 뒤 재실행이 멈춘다(③g3 실패)', () => {
  const bad = mutate(realSql(), 'SET @s := IF(@go AND @m_chk = 0,', 'SET @s := IF(@go,');
  assert.throws(() => checks.faults(bad, () => S.at(16), APP, '16 에서'), /다시 돌려도 끝나지 않는다/);
});
test('변이R14: v17 이 IF NOT EXISTS 없이 그림 표를 만들면 중간 실패 뒤 재실행이 멈춘다(③g3 실패)', () => {
  const bad = mutate(realSql(), "'CREATE TABLE IF NOT EXISTS project_schedule_image (", "'CREATE TABLE project_schedule_image (");
  assert.throws(() => checks.faults(bad, () => S.at(16), APP, '16 에서'), /모르는 문장|다시 돌려도 끝나지 않는다/);
});
test('변이R6: 열기의 같은 값 건너뛰기(AND v <>)를 빼면 재실행이 행을 바꾼다(③a 실패)', () => {
  const bad = realSql().replace(/ AND v <> '[^']*';\n/g, ';\n');
  assert.notStrictEqual(bad, realSql());
  assert.throws(() => checks.fresh13(bad), /다시 돌렸는데/);
});
test('변이R15: v18 검증을 끄면(지우기 하나가 빠진 조각) ③j3 이 실패한다', () => {
  const sql = realSql();
  const i = sql.indexOf('SET @g := IF(NOT @go OR (@m_v1 = 0 ');
  assert.ok(i >= 0, '변이 준비 실패: v18 검증을 찾지 못했다');
  const off = sql.slice(0, i) + 'SET @g := IF(1 OR ' + sql.slice(i + 'SET @g := IF('.length);
  const [label, from] = V18_STEPS[0];
  assert.throws(() => checks.gitVerify(mutate(off, from, from.replace('IF(@go AND', 'IF(0 AND')), label), /멈추지 않았다/);
});
test('변이R16: v18 이 남은 커밋 기록을 확인하지 않으면 ③j4 가 실패한다', () => {
  const bad = mutate(realSql(), 'SET @g := IF(NOT @go OR @m_left = 0, ', 'SET @g := IF(1, ');
  assert.throws(() => checks.gitLeft(bad), /멈추지 않았다/);
});
test('변이R17: v18 이 표가 있는지 보지 않고 늘 지우면 중간 실패 뒤 재실행이 멈춘다(③g 실패)', () => {
  const bad = mutate(realSql(), "SET @s := IF(@go AND @m_tbl = 1, 'DROP TABLE cal_entry_commit'", "SET @s := IF(@go, 'DROP TABLE cal_entry_commit'");
  assert.throws(() => checks.faults(bad, () => S.at(17), APP, '17 에서'), /다시 돌려도 끝나지 않는다/);
});
test('변이R18: v18 이 칸이 있는지 보지 않고 늘 지우면 중간 실패 뒤 재실행이 멈춘다(③g 실패)', () => {
  const bad = mutate(realSql(), "SET @s := IF(@go AND @m_col = 1, 'ALTER TABLE cal_category DROP COLUMN uses_repo", "SET @s := IF(@go, 'ALTER TABLE cal_category DROP COLUMN uses_repo");
  assert.throws(() => checks.faults(bad, () => S.at(17), APP, '17 에서'), /다시 돌려도 끝나지 않는다/);
});
test('변이R19: v18 이 source 칸이 없어도 커밋 기록을 지우려 하면(칸 확인 빼기) 중간 실패 뒤 재실행이 멈춘다(③g 실패)', () => {
  const bad = mutate(realSql(), "SET @s := IF(@go AND @m_src = 1,\n  'DELETE FROM cal_entry", "SET @s := IF(@go,\n  'DELETE FROM cal_entry");
  assert.throws(() => checks.faults(bad, () => S.at(17), APP, '17 에서'), /다시 돌려도 끝나지 않는다/);
});
test('변이R21: v19 검증을 끄면(칸 모양이 다르거나 단계 하나가 빠진 조각) ③k3 이 실패한다', () => {
  const sql = realSql();
  const i = sql.indexOf('SET @g := IF(NOT @go OR (@m_cty = 1 AND @m_pos = 1 AND @m_c1 = 1');
  assert.ok(i >= 0, '변이 준비 실패: v19 검증을 찾지 못했다');
  const off = sql.slice(0, i) + 'SET @g := IF(1 OR ' + sql.slice(i + 'SET @g := IF('.length);
  assert.throws(() => checks.orderVerify(off, V19_BAD_SHAPES[1][0], V19_BAD_SHAPES[1][1]), /멈추지 않았다/);
  const [label, from] = V19_STEPS[2];
  assert.throws(() => checks.orderVerify(mutate(off, from, from.replace('IF(@go', 'IF(0')), label), /멈추지 않았다/);
});
test('변이R22: v19 가 칸이 있는지 보지 않고 늘 더하면 중간 실패 뒤 재실행이 멈춘다(③g 실패)', () => {
  const bad = mutate(realSql(), "SET @s := IF(@go AND @m_col = 0,\n  'ALTER TABLE project ADD COLUMN sort_no", "SET @s := IF(@go,\n  'ALTER TABLE project ADD COLUMN sort_no");
  assert.throws(() => checks.faults(bad, () => S.at(18), APP, '18 에서'), /다시 돌려도 끝나지 않는다/);
});
test('변이R23: v19 순서 채우기가 이미 있는 번호를 무시하면(최댓값을 더하지 않음) 흉내 실행기가 모르는 문장으로 거부한다(③k2 가 실패)', () => {
  const bad = mutate(realSql(), 'SET p.sort_no = IFNULL(m.mx, 0) + o.rn', 'SET p.sort_no = o.rn');
  assert.throws(() => checks.orderKeeps(bad), /모르는 문장/);
});
test('변이R24: v19 가 숨긴 과제에도 순서를 매기면 흉내 실행기가 모르는 문장으로 거부한다(③k 가 실패)', () => {
  const bad = mutate(realSql(), 'FROM project WHERE is_active = 1 AND sort_no IS NULL) o ON o.id = p.id', 'FROM project WHERE sort_no IS NULL) o ON o.id = p.id');
  assert.throws(() => checks.orderAdded(bad), /모르는 문장/);
});
test('변이R20: v18 이 CHECK 보다 칸을 먼저 지우면 17 에서 올리는 배포가 멈춘다(③j 실패, MySQL 3959)', () => {
  const sql = realSql();
  const a = sql.indexOf('SET @m_chk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS\n                WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = \'cal_category\'');
  const c = sql.indexOf("SET @m_col := (SELECT COUNT(*) FROM information_schema.COLUMNS\n                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_category'");
  const e = sql.indexOf('-- 6) cal_user_pref');
  assert.ok(a >= 0 && c > a && e > c, '변이 준비 실패: v18 의 cal_category 단계를 찾지 못했다');
  const bad = sql.slice(0, a) + sql.slice(c, e) + sql.slice(a, c) + sql.slice(e);
  assert.throws(() => checks.gitRemoved(bad), /끝나지 않는다/);
});

test('근태정책 v20 이관: 기존 보고 표 확장, 재실행 및 잘못된 열 차단',()=>{
 const db=open(S.at(19));assert.ok(db.run(realSql()).ok);assert.deepEqual(db.reports,REPORTS_V20());const writes=db.writes.length;assert.ok(db.run(realSql()).ok);assert.equal(db.writes.length,writes);
 const init=S.at(19);init.reports={'cal_report_daily.report_json':'varchar?'};const bad=open(init);assert.equal(bad.run(realSql()).ok,false);assert.equal(bad.meta().db_structure_version,'19');assert.equal(bad.meta().db_updating,'1');
});
