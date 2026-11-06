// DB 구조 22(docs/DB-V22-REPORT-HOURS.md, 2026-11-06): 스크립트, 권한, 판 번호, 지운 도구의 정적 계약과
// MySQL 8.4 리허설 스크립트(tools/db-rehearsal/rehearse-v22.mjs)의 순수 함수 단위 시험.
//
//   이관 조각 자체(21 에서 22, 다시 돌리기, 검증 멈춤, 변이, 정본과 글자 대조)는 tests/release-sql.test.mjs 의 ③r 이 본다.
//   리허설 스크립트는 MySQL 에 닿으므로 이 게이트에서 돌리지 않는다(PM 이 개발 PC 에서 돌린다). 여기서는
//   비밀번호를 명령줄, 파일, 화면에 내지 않는다는 것과 순수 함수(문장 나누기, 경계, 서명 비교, 일회용 이름)만 본다.
import { existsSync, readdirSync } from 'node:fs';
import { test, assert, readText } from './harness.mjs';
import { mutate } from './ps-guard-lib.mjs';

const R = (p) => new URL('../' + p, import.meta.url);
const read = (p) => readText(R(p)).replace(/^﻿/, '').replace(/\r\n/g, '\n');
const noSqlComments = (s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const noPsComments = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const OLD = ['cal_task_hours', 'cal_migration_log', 'cal_user_pref'];

const canon = read('db/deploy/schema-calendar.sql');
const gate = read('widget/DbGate.cs');
const RH_SRC = read('tools/db-rehearsal/rehearse-v22.mjs');
const RH = await import(R('tools/db-rehearsal/rehearse-v22.mjs').href);

const checks = {
  //  ① 권한 파일 셋에 지운 표의 GRANT 가 없다(없는 표에 GRANT 는 1146). 바꾼 표 셋의 권한은 그대로다.
  grants(g, server, create) {
    for (const [name, text] of [['grants-calendar.sql', g], ['server-app-account.sql', server], ['create-app-user.sql', create]]) {
      const code = noSqlComments(text);
      for (const t of OLD) assert.ok(!new RegExp(`GRANT[^;]*\\b${t}\\b`, 'i').test(code), `${name} 이 지운 표 ${t} 에 권한을 준다`);
    }
    assert.ok(/^GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr\.cal_report_hours TO/m.test(noSqlComments(g)), 'grants-calendar.sql 의 cal_report_hours 권한(SELECT, INSERT, UPDATE, DELETE)이 바뀌었다');
    assert.ok(/^GRANT SELECT, INSERT, UPDATE ON taskmgr\.cal_report_daily\s+TO/m.test(noSqlComments(g)), 'grants-calendar.sql 의 cal_report_daily 권한(SELECT, INSERT, UPDATE)이 바뀌었다');
    assert.ok(/^GRANT SELECT, INSERT, UPDATE, DELETE ON `taskcalendar`\.`cal_report_hours` TO/m.test(noSqlComments(server)), 'server-app-account.sql 의 cal_report_hours 권한이 바뀌었다');
  },
  //  ② 스크립트의 표 명부가 정본과 맞물린다(init 명부 = 정본 CREATE, setup 기록 표, 데모 지우기, 시드)
  scripts(init, setup, demoSrc, seed) {
    const creates = [...canon.matchAll(/^CREATE TABLE (\w+) \(/gm)].map((m) => m[1]).sort();
    const m = /\$DESIGN_TABLES = @\(([\s\S]*?)\n\)/.exec(noPsComments(init));
    assert.ok(m, 'init-calendar.ps1 에서 $DESIGN_TABLES 를 찾지 못했다(판정 불가)');
    const design = [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
    assert.deepStrictEqual(design, creates, 'init-calendar.ps1 의 $DESIGN_TABLES 가 정본 schema-calendar.sql 의 CREATE TABLE 목록과 다르다');
    const cd = /\$CAL_DATA_TABLES = @\(([^)]*)\)/.exec(noPsComments(setup));
    assert.ok(cd, 'setup-taskcalendar.ps1 에서 $CAL_DATA_TABLES 를 찾지 못했다(판정 불가)');
    for (const t of OLD) assert.ok(!cd[1].includes(`'${t}'`), `setup-taskcalendar.ps1 의 $CAL_DATA_TABLES 에 지운 표 ${t} 가 있다`);
    for (const t of [...cd[1].matchAll(/'(\w+)'/g)].map((x) => x[1])) assert.ok(creates.includes(t), `setup-taskcalendar.ps1 의 $CAL_DATA_TABLES 에 정본에 없는 표 ${t} 가 있다`);
    const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    for (const t of OLD) {
      assert.ok(!code(demoSrc).includes(t), `db/demo/build-demo-sql.mjs 의 코드가 지운 표 ${t} 를 쓴다`);
      assert.ok(!code(seed).includes(t), `db/deploy/seed-dummy.mjs 의 코드가 지운 표 ${t} 를 쓴다`);
    }
    assert.ok(!/cal_report_hours \([^)]*\bcat_no\b/.test(code(demoSrc)), '데모가 지운 칸 cal_report_hours.cat_no 에 넣는다');
    assert.ok(/INSERT INTO cal_report_hours \(user_id, work_date, line_no, task_name, cat_uid, project_uid, hours, body\)/.test(demoSrc), '데모가 일간 줄을 구조 22 모양(cat_uid, project_uid, body)으로 넣지 않는다');
    assert.ok(/INSERT INTO cal_report_daily \([^)]*\bmemo\b/.test(demoSrc), '데모가 일간보고 memo 를 넣지 않는다(새 보고는 NULL 이 아니다)');
    assert.ok(/INSERT INTO cal_report_weekly_hours \([^)]*\bcat_uid\b/.test(demoSrc), '데모가 주간 줄 cat_uid 를 넣지 않는다');
  },
  //  ③ 판 번호: 앱 상수 = 정본 시딩 = 데모 두 곳 = 이관 조각 사슬의 끝
  versions(gateSrc, demoSrc, demoPs) {
    const app = /public const int AppStructureVersion = (\d+);/.exec(gateSrc);
    assert.ok(app, 'DbGate.AppStructureVersion 을 찾지 못했다(판정 불가)');
    assert.strictEqual(app[1], '22', 'DbGate.AppStructureVersion 이 22 가 아니다');
    assert.ok(canon.includes(`VALUES ('db_structure_version', '${app[1]}', UTC_TIMESTAMP(3))`), '정본 시딩 구조 번호가 앱 상수와 다르다');
    assert.ok(demoSrc.includes(`export const SCHEMA_VERSION = '${app[1]}';`), 'build-demo-sql.mjs 의 SCHEMA_VERSION 이 앱 상수와 다르다');
    assert.ok(demoPs.includes(`$SCHEMA_VERSION = "${app[1]}"`), 'demo-db.ps1 의 $SCHEMA_VERSION 이 앱 상수와 다르다');
    const frags = readdirSync(R('db/deploy/migrations/')).filter((f) => f.endsWith('.sql'));
    const last = frags.map((f) => Number(/^v(\d+)-/.exec(f)[1])).sort((a, b) => a - b).pop();
    assert.strictEqual(String(last), app[1], '이관 조각 사슬의 끝이 앱 상수와 다르다');
    assert.ok(frags.includes('v22-report-hours.sql'), 'v22 조각 파일 이름이 v22-report-hours.sql 이 아니다');
  },
  //  ④ 리허설 스크립트: 비밀번호는 TC_DB_PW 에서 읽어 자식 환경 MYSQL_PWD 로만 넘긴다(명령줄 -p, 파일 쓰기, 화면 출력 없음)
  rehearsalSafety(src) {
    const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(/const pw = process\.env\.TC_DB_PW;/.test(code), '리허설이 비밀번호를 환경 변수 TC_DB_PW 에서 읽지 않는다');
    assert.ok(/MYSQL_PWD: pw/.test(code), '리허설이 자식에 비밀번호를 MYSQL_PWD 로 넘기지 않는다');
    assert.ok(!/['"`]-p['"`$]|--password/.test(code), '리허설이 명령줄에 비밀번호 인자(-p, --password)를 쓴다');
    assert.ok(!/writeFileSync|appendFileSync|createWriteStream/.test(code), '리허설이 파일을 쓴다(비밀번호나 덤프를 디스크에 남기지 않는다. 조립한 SQL 은 release-sql.ps1 이 임시 폴더에 쓴다)');
    assert.ok(!/console\.(log|error|warn)\([^)]*\bpw\b/.test(code), '리허설이 비밀번호 변수를 출력한다');
    assert.ok(/delete env\.TC_DB_PW;/.test(code), '리허설이 자식 환경에서 TC_DB_PW 를 지우지 않는다');
    assert.ok(/mysqldump\.exe/.test(code) && /MySQL Server 8\.4\/bin/.test(code), '리허설이 MySQL 8.4 의 mysql.exe, mysqldump.exe 를 쓰지 않는다');
    assert.ok(/if \(!isThrowawayName\(n\)\) throw/.test(code) && /const dropDb = \(n\) => \{ if \(isThrowawayName\(n\)\)/.test(code), '리허설이 일회용 이름이 아닌 DB 를 만들거나 지울 수 있다');
    assert.ok(!/['"`]dist[\\/]/.test(code), '리허설이 dist 에 쓴다');
  },
};

test('구조22①: 권한 파일 셋에 지운 표(cal_task_hours, cal_migration_log, cal_user_pref)의 GRANT 가 없고 바꾼 표의 권한은 그대로다', () =>
  checks.grants(read('db/deploy/grants-calendar.sql'), read('db/deploy/server-app-account.sql'), read('db/deploy/create-app-user.sql')));
test('구조22②: init 명부가 정본 CREATE 목록과 같고, setup 기록 표, 데모, 시드가 지운 표와 cat_no 를 쓰지 않으며 데모는 구조 22 모양으로 넣는다', () =>
  checks.scripts(read('db/deploy/init-calendar.ps1'), read('db/deploy/setup-taskcalendar.ps1'), read('db/demo/build-demo-sql.mjs'), read('db/deploy/seed-dummy.mjs')));
test('구조22③: 앱 구조 번호, 정본 시딩, 데모 두 곳, 조각 사슬의 끝이 22 로 같다', () =>
  checks.versions(gate, read('db/demo/build-demo-sql.mjs'), read('db/demo/demo-db.ps1')));
test('구조22④: 관리자 도구 xml-to-db 와 그 전용 시험(migrate-tool, dryrun-xml-to-db)이 없다', () => {
  assert.ok(!existsSync(R('db/deploy/xml-to-db/')), 'db/deploy/xml-to-db 가 남았다');
  assert.ok(!existsSync(R('tests/migrate-tool.mjs')) && !existsSync(R('tests/dryrun-xml-to-db.mjs')), 'xml-to-db 전용 시험이 남았다');
  assert.ok(!/xml-to-db/.test(read('db/deploy/init-calendar.ps1').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')), 'init-calendar.ps1 의 코드가 xml-to-db 를 말한다');
});
test('구조22⑤: 리허설 스크립트는 비밀번호를 환경 변수로만 받아 자식 환경으로만 넘기고, 일회용 DB(tc_rh_v22_*)만 만들고 지운다', () => checks.rehearsalSafety(RH_SRC));

// ── 리허설 스크립트 순수 함수 ─────────────────────────────────────────
test('리허설①: 일회용 DB 이름 판정과 인자 읽기(원본 기본값 taskcalendar, 일회용 이름을 원본으로 받지 않는다)', () => {
  for (const n of ['tc_rh_v22_a', 'tc_rh_v22_c', 'tc_rh_v22_canon']) assert.ok(RH.isThrowawayName(n), `${n} 을 일회용으로 보지 않는다`);
  for (const n of ['taskcalendar', 'tc_rh_v22_', 'tc_rh_v21_a', 'tc_rh_v22_A', 'tc_rh_v22_a;drop', 'x tc_rh_v22_a', null]) assert.ok(!RH.isThrowawayName(n), `${n} 을 일회용으로 본다`);
  const d = RH.parseArgs([]);
  assert.strictEqual(d.source, 'taskcalendar');
  assert.deepStrictEqual([d.host, d.port, d.user, d.keep], ['127.0.0.1', '3306', 'root', false]);
  const o = RH.parseArgs(['copy21', '--port', '3307', '--keep', '--only', 'a,d']);
  assert.deepStrictEqual([o.source, o.port, o.keep, [...o.only]], ['copy21', '3307', true, ['a', 'd']]);
  assert.throws(() => RH.parseArgs(['tc_rh_v22_a']), /일회용/);
  assert.throws(() => RH.parseArgs(['bad-name;']), /이상하다/);
  assert.throws(() => RH.parseArgs(['--only', 'z']), /a,b,c,d/);
  assert.throws(() => RH.parseArgs(['--password', 'x']), /모르는 인자/);
});
test('리허설②: 문장 나누기는 주석과 따옴표, 백틱 안의 ; 를 자르지 않는다', () => {
  const s = "-- 머리 ; 주석\nSET @g := IF(1, 'DO 0', 'SELECT 1 FROM `중단: a ; b`');\nSET @s := 'x;''y';\n-- 끝\nDO 0;";
  assert.deepStrictEqual(RH.splitStatements(s), ["SET @g := IF(1, 'DO 0', 'SELECT 1 FROM `중단: a ; b`')", "SET @s := 'x;''y'", 'DO 0']);
});
test('리허설③: release SQL 에서 v22 조각 본문을 찾고, 바꾸는 단계마다 끊을 경계를 만들며, 끊긴 실행 SQL 은 조각 앞 전부 + 앞 n 문장이다', () => {
  const rel = 'SET SESSION lock_wait_timeout = 10;\n-- ---------- 조각 v21-x.sql (20 에서 21) ----------\nDO 1;\n-- ---------- 조각 v21-x.sql 끝 ----------\n\n'
    + '-- ---------- 조각 v22-report-hours.sql (21 에서 22) ----------\nSET @go := 1;\nSTART TRANSACTION;\nSET @s := IF(@go, \'DELETE FROM t WHERE id > 0\', \'DO 0\');\nPREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;\nCOMMIT;\n'
    + "SET @s := IF(@go, 'ALTER TABLE t DROP INDEX i', 'DO 0');\nPREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;\n-- ---------- 조각 v22-report-hours.sql 끝 ----------\nCOMMIT;\n";
  const span = RH.fragmentSpan(rel, 'v22-report-hours.sql');
  const st = RH.splitStatements(span.body);
  assert.strictEqual(st[0], 'SET @go := 1');
  assert.deepStrictEqual(RH.stepBoundaries(st), [6, 7, 11], '경계가 DEALLOCATE PREPARE _s 와 COMMIT 뒤가 아니다');
  const pre = RH.prefixSql(rel, span, st, 6);
  assert.ok(pre.startsWith('SET SESSION lock_wait_timeout = 10;') && pre.includes('DO 1;'), '끊긴 실행 SQL 에 조각 앞(감싸개, 앞 조각)이 없다');
  assert.ok(pre.trimEnd().endsWith('DEALLOCATE PREPARE _s;') && !pre.includes('DROP INDEX'), '끊긴 실행 SQL 이 경계까지만이 아니다');
  assert.ok(/DELETE FROM t/.test(RH.boundaryLabel(st, 6)) && /DROP INDEX/.test(RH.boundaryLabel(st, 11)), '경계 이름이 바로 앞 단계가 아니다');
  assert.throws(() => RH.fragmentSpan(rel, 'v23-x.sql'), /찾지 못했다/);
});
test('리허설④: information_schema 서명을 묶고 견준다(같으면 빈 목록, 다르면 표와 구역과 줄)', () => {
  const a = RH.groupSignature('cal_report_hours\tcolumn\t1\tuser_id\nt\tcolumn\t2\tcat_uid\tvarchar(80)\tutf8mb4_bin\ncal_report_hours\tindex\tPRIMARY\t1\tuser_id\n');
  assert.deepStrictEqual(Object.keys(a).sort(), ['cal_report_hours', 't']);
  assert.deepStrictEqual(a.t.column, ['2\tcat_uid\tvarchar(80)\tutf8mb4_bin']);
  assert.deepStrictEqual(RH.diffSignatures(a, a, ['cal_report_hours', 't', 'none']), []);
  const b = RH.groupSignature('cal_report_hours\tcolumn\t1\tuser_id\nt\tcolumn\t2\tcat_uid\tvarchar(80)\tutf8mb4_0900_ai_ci\n');
  const d = RH.diffSignatures(a, b, ['cal_report_hours', 't']);
  assert.ok(d.some((x) => x.startsWith('cal_report_hours.index')) && d.some((x) => x.startsWith('t.column') && /utf8mb4_bin/.test(x)), `차이를 못 잡았다: ${d}`);
  assert.deepStrictEqual(RH.diffSignatures(a, {}, ['t']), ['t: 한쪽에만 있다(앞)']);
  assert.deepStrictEqual(RH.canonTables('x\nCREATE TABLE a (\n);\nCREATE TABLE b (\n'), ['a', 'b']);
  assert.ok(RH.V22_TABLES.every((t) => RH.canonTables(canon).includes(t)), '리허설의 v22 표 셋이 정본에 없다');
  assert.ok(RH.OLD_TABLES.every((t) => !RH.canonTables(canon).includes(t)), '리허설의 지울 표가 정본에 있다');
});

// ── 변이 ──────────────────────────────────────────────────────────────
test('변이22①: 권한 파일에 지운 표 GRANT 를 되살리면 ① 이 실패한다', () => {
  const g = read('db/deploy/grants-calendar.sql');
  assert.throws(() => checks.grants(g + "\nGRANT SELECT, INSERT ON taskmgr.cal_migration_log TO 'taskmgr_app'@'%';\n", read('db/deploy/server-app-account.sql'), read('db/deploy/create-app-user.sql')), /cal_migration_log/);
});
test('변이22②: init 명부에 지운 표가 남으면 ② 가 실패한다', () => {
  const init = read('db/deploy/init-calendar.ps1');
  const bad = mutate(init, "'cal_user_rev','cal_schema_meta',", "'cal_user_pref','cal_user_rev','cal_schema_meta',");
  assert.throws(() => checks.scripts(bad, read('db/deploy/setup-taskcalendar.ps1'), read('db/demo/build-demo-sql.mjs'), read('db/deploy/seed-dummy.mjs')), /DESIGN_TABLES/);
});
test('변이22③: 리허설이 명령줄에 비밀번호를 넣으면 ⑤ 가 실패한다', () => {
  const bad = mutate(RH_SRC, "const base = ['--host', o.host,", "const base = ['-p' + pw, '--host', o.host,");
  assert.throws(() => checks.rehearsalSafety(bad), /명령줄|비밀번호/);
});
