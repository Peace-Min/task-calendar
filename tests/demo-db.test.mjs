// Layer 1: 사용 설명 영상(이슈 #13)용 데모 DB 키트(db/demo)의 계약을 소스와 생성 결과만으로 본다.
// MySQL 에 붙지 않는다(실제 -Load, -Restore 는 사람이 한다).
//
// 왜 있나
//   이 키트는 로컬 DB 의 사람 이름, 공식 과제, 캘린더를 통째로 바꾼다. 실명이 새거나, 백업보다 먼저 바꾸거나,
//   가드 하나가 빠지면 되돌릴 근거 없이 실데이터를 잃는다. 그래서 못 박는다:
//     ① 생성기는 결정적이다(같은 입력이면 같은 SQL, 명령줄과 모듈 호출이 같은 바이트)
//     ② 이름: 공식 과제, 발주처, 장소는 '(예시)' 로 시작하고, 사람 이름은 가상 명단에서만 나오며, login_id 는 가짜 모양이다.
//        녹화 계정은 이름도 login_id 도 바꾸지 않고(2026-10-19 사용자 결정), login_id 는 16진 리터럴로만 SQL 에 들어간다.
//        가상 이름이 녹화 계정의 지금 이름과 같으면 트랜잭션 전에 멈춘다
//     ③ SQL 가드: 문자셋, 표, db_structure_version 14(2026-10-21 부터, 옛 키 schema_version), 녹화 계정 존재, 트랜잭션 안의 검증이 COMMIT 앞에 있다
//     ④ SQL 은 계정과 권한, DDL 을 건드리지 않는다(GRANT, CREATE USER, DROP USER, DROP DATABASE, ALTER TABLE 없음)
//     ⑤ 데이터가 스키마 CHECK 를 지킨다(기간, 종일, 공식 과제 uid, 색, 시간 범위, 할 일 완료 시각, 기본 과제)
//     ⑥ 지우는 표 목록이 스키마의 cal_* 표 전부와 맞물린다(새 표가 생기면 여기서 걸린다)
//     ⑦ ps1: 비밀번호를 명령줄에 싣지 않는다, 종료코드 표가 .cmd 와 같고 실제로 내는 코드와 같다, .cmd 는 ASCII 와 %*
//     ⑧ ps1 순서: -Load 는 백업(검증) 다음 표지 파일 다음 생성과 적용, -Restore 는 덤프 검증과 안전 덤프 다음 DROP, 그다음 행 수 대조
//     ⑨ ps1 세션 확인, 녹화 계정 읽기(widget/UserSession.cs 와 같은 파일과 형식), 이미 데모면 거부, 녹화 계정 이름을 바꾸지 않는다
//     ⑩ 문서: 줄표, 띄운 가운데 점, 낫표 없음, db/deploy/README.md 가 이 키트를 가리킨다
//   각 계약에 변이 주입을 짝으로 둔다(검사가 정말 잡는지 증명한다).
import { test, assert } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  maskPs, passwordOnCommandLineHits, exitCodeTable, exitCodesInTable, exitCodesUsed,
  mutate, nonAsciiLines,
} from './ps-guard-lib.mjs';

const R = (p) => new URL('../' + p, import.meta.url);
const norm = (s) => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const read = (p) => norm(readFileSync(R(p), 'utf8'));

const D = await import(R('db/demo/demo-data.mjs').href);
const G = await import(R('db/demo/build-demo-sql.mjs').href);
const psBytes = readFileSync(R('db/demo/demo-db.ps1'));
const psSrc = read('db/demo/demo-db.ps1');
const cmdSrc = norm(readFileSync(R('db/demo/demo-db.cmd')).toString('latin1'));
const readme = read('db/demo/README.md');
const deployReadme = read('db/deploy/README.md');
const schemaCal = read('db/deploy/schema-calendar.sql');
const schemaStruct = read('db/deploy/schema-structure.sql');
const userSessionCs = read('widget/UserSession.cs');
const mainWindowCs = read('widget/MainWindow.xaml.cs');

const LOGIN = 'demo.rec01';
const BASE = '2026-10-19';
const sql = G.buildDemoSql({ myLogin: LOGIN, baseDate: BASE });
// SQL 주석(-- 줄)을 지운 코드. 머리말 설명문이 검사에 걸리지 않게.
const sqlCode = (s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

// ══ 검사 함수(테스트와 변이 주입이 같은 함수를 쓴다) ═══════════════════
const checks = {
  // ③ SQL 가드와 트랜잭션 순서
  sqlGuards(s) {
    const c = sqlCode(s);
    const at = (re, label) => { const m = re.exec(c); assert.ok(m, `SQL 에 ${label} 이(가) 없다: ${re}`); return m.index; };
    at(/HEX\('가나다'\) = 'EAB080EB8298EB8BA4'/, '문자셋 가드');
    at(/@n_tbl = \d+, 'DO 0'/, '표 존재 가드');
    assert.ok(/SET @v := \(SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version'\);/.test(c), 'SQL 이 구조 번호를 db_structure_version 키로 읽지 않는다');
    const ver = at(/IF\(@v <=> '14', 'DO 0', 'SELECT 1 FROM `중단: [^`]+`'\)/, 'db_structure_version 14 가드');
    const me = at(/IF\(@n_me = 1, 'DO 0'/, '녹화 계정 존재 가드');
    at(/IF\(@n_other_active >= 3, 'DO 0'/, '동료 수 가드');
    at(/IF\(@n_my_dummy = 0, 'DO 0'/, '녹화 계정과 가상 명단 겹침 가드');
    const nameCap = at(/^SET @my_name_hex := \(SELECT HEX\(name\) FROM app_user WHERE user_id = @u_me\);$/m, '녹화 계정 이름 잡아 두기');
    at(/^SET @n_my_name_dummy := \(SELECT COUNT\(\*\) FROM _demo_names WHERE name = TRIM\(CONVERT\(UNHEX\(@my_name_hex\) USING utf8mb4\)\) COLLATE utf8mb4_0900_ai_ci\);$/m, '가상 이름과 녹화 계정 이름 비교');
    const nameDummy = at(/IF\(@n_my_name_dummy = 0, 'DO 0'/, '가상 이름과 녹화 계정 이름 겹침 가드');
    const tx = at(/^START TRANSACTION;$/m, 'START TRANSACTION');
    const commit = at(/^COMMIT;$/m, 'COMMIT');
    assert.strictEqual(c.split(/^START TRANSACTION;$/m).length, 2, 'START TRANSACTION 이 하나가 아니다');
    assert.strictEqual(c.split(/^COMMIT;$/m).length, 2, 'COMMIT 이 하나가 아니다');
    assert.ok(ver < tx && me < tx, '판번호와 녹화 계정 가드가 트랜잭션보다 뒤에 있다');
    assert.ok(me < nameCap && nameCap < nameDummy && nameDummy < tx, '녹화 계정 이름을 잡아 두고 가상 이름과 비교하는 일이 트랜잭션 전에 순서대로 있지 않다');
    // 실제 표를 바꾸는 문장은 전부 트랜잭션 안에 있다(임시 표 말고)
    const writes = [...c.matchAll(/^(UPDATE|DELETE FROM|INSERT INTO) (\w+)/gm)].filter((m) => !m[2].startsWith('_demo_'));
    assert.ok(writes.length > 10, '쓰기 문장을 찾지 못했다');
    for (const m of writes) assert.ok(m.index > tx && m.index < commit, `트랜잭션 밖의 쓰기: ${m[0]}`);
    // COMMIT 직전 검증 묶음
    const verify = c.slice(c.indexOf('-- 6)') >= 0 ? c.indexOf('cal_user_rev (user_id, rev)') : 0, commit);
    for (const re of [/@fp_user2 = @fp_user/, /@fp_org2 = @fp_org AND @fp_title2 = @fp_title/,
      /WHERE user_id = @u_me AND HEX\(name\) = @my_name_hex AND HEX\(login_id\) = @my_login_hex\) = 1, 'DO 0'/,
      /WHERE user_id <> @u_me AND CAST\(name AS BINARY\) = UNHEX\(@my_name_hex\)\) = 0, 'DO 0'/,
      /SELECT COUNT\(\*\) FROM app_user\) = @n_user/, /name NOT LIKE '\(예시\)%'/, /common_name NOT LIKE '\(예시\)%'/]) {
      assert.ok(re.test(verify), `COMMIT 앞 검증에 ${re} 가 없다`);
    }
    // 모든 가드가 같은 수법(PREPARE 로 없는 표를 SELECT)이다
    const ifs = [...c.matchAll(/^SET @g := IF\((.*), 'DO 0', 'SELECT 1 FROM `(.*)`'\);$/gm)];
    const prep = [...c.matchAll(/^PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;$/gm)];
    assert.ok(ifs.length >= 20, `가드가 ${ifs.length}개뿐이다`);
    assert.strictEqual(ifs.length, prep.length, '가드 SET 과 PREPARE 의 수가 다르다');
    for (const m of ifs) assert.ok([...m[2]].length <= 64 && m[2].startsWith('중단: '), `가드 문장 모양이 이상하다: ${m[2]}`);
  },
  // ④ 계정, 권한, DDL 금지
  sqlNoAccountsNoDdl(s) {
    const c = sqlCode(s);
    for (const re of [/\bGRANT\b/i, /\bREVOKE\b/i, /\bCREATE\s+USER\b/i, /\bDROP\s+USER\b/i, /\bALTER\s+USER\b/i, /\bSET\s+PASSWORD\b/i,
      /\bDROP\s+DATABASE\b/i, /\bCREATE\s+DATABASE\b/i, /\bALTER\s+TABLE\b/i, /\bTRUNCATE\b/i, /\bRENAME\s+TABLE\b/i, /\bmysql\.\w+/i]) {
      assert.ok(!re.test(c), `생성 SQL 에 금지된 문장이 있다: ${re}`);
    }
    for (const m of c.matchAll(/\b(CREATE|DROP)\s+(TEMPORARY\s+)?TABLE\b/gi)) assert.ok(m[2], `임시 표가 아닌 표를 만들거나 지운다: ${m[0]}`);
    assert.ok(!/(INSERT INTO|UPDATE|DELETE FROM) cal_schema_meta\b/.test(c), 'cal_schema_meta 를 바꾼다(판번호는 그대로여야 한다)');
    assert.ok(!/DELETE FROM cal_user_rev\b/.test(c), 'cal_user_rev 를 지운다(DELETE 금지 표, 올리기만 한다)');
    assert.ok(/INSERT INTO cal_user_rev \(user_id, rev\) SELECT user_id, 1 FROM app_user ON DUPLICATE KEY UPDATE rev = cal_user_rev\.rev \+ 1;/.test(c),
      'cal_user_rev 를 모든 사람에게 두고 하나씩 올리는 문장이 없다');
    for (const t of ['org_unit', 'title_code', 'section_code', 'status_code']) {
      assert.ok(!new RegExp(`(INSERT INTO|UPDATE|DELETE FROM) ${t}\\b`).test(c), `${t} 를 바꾼다(조직과 코드표는 그대로여야 한다)`);
    }
  },
  // ② 녹화 계정: login_id 는 16진으로만, 이름도 login_id 도 바꾸지 않는다
  sqlRecordingUser(s, login) {
    const c = sqlCode(s);
    assert.ok(!c.includes(login), '녹화 계정 login_id 가 SQL 에 글자 그대로 들어 있다(16진 리터럴로만 넣어야 한다)');
    const hex = Buffer.from(login, 'utf8').toString('hex').toUpperCase();
    assert.ok(c.includes(`SET @my_login := CONVERT(X'${hex}' USING utf8mb4) COLLATE utf8mb4_0900_ai_ci;`), '녹화 계정 login_id 를 16진 리터럴로 넣지 않는다');
    const ups = [...c.matchAll(/^UPDATE app_user\b.*$/gm)].map((m) => m[0]);
    assert.deepStrictEqual(ups, [
      "UPDATE app_user u JOIN _demo_rank r ON r.user_id = u.user_id SET u.login_id = CONCAT('~demo~', u.user_id);",
      'UPDATE app_user u JOIN _demo_rank r ON r.user_id = u.user_id JOIN _demo_names n ON n.rn = r.rn SET u.name = n.name, u.login_id = n.login_id;',
    ], 'app_user 를 바꾸는 문장이 둘(임시 login_id, 가상 명단)이 아니다. 녹화 계정 이름은 바꾸지 않는다(2026-10-19 사용자 결정)');
    assert.ok(!/^(UPDATE|INSERT INTO|REPLACE INTO|DELETE FROM)\b[^;]*\bapp_user\b[^;]*@u_me\b/m.test(c), '녹화 계정(@u_me)을 직접 바꾸는 문장이 있다');
    assert.ok(!/홍길동/.test(c), '생성 SQL 에 홍길동이 있다(녹화 계정 이름은 그대로여야 한다)');
    assert.ok(/FROM app_user WHERE user_id <> @u_me;/.test(c), '이름 받을 순서에서 녹화 계정을 빼지 않는다');
  },
};

// ══ ① 결정성 ════════════════════════════════════════════════════════
test('데모①: 같은 입력이면 같은 SQL, 기준 날짜가 다르면 다른 SQL', () => {
  assert.strictEqual(G.buildDemoSql({ myLogin: LOGIN, baseDate: BASE }), sql, '같은 입력인데 SQL 이 다르다');
  const other = G.buildDemoSql({ myLogin: LOGIN, baseDate: '2026-11-03' });
  assert.notStrictEqual(other, sql, '기준 날짜를 바꿨는데 SQL 이 같다');
  assert.ok(!/\b20\d\d-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?!\.000')/.test(sql.replace(/'20\d\d-\d\d-\d\d \d\d:\d\d:\d\d\.000'/g, '')),
    'SQL 에 생성 시각 같은 흔들리는 값이 있다');
  assert.ok(/created_at, updated_at\) VALUES/.test(sql) && /@now, @now\)/.test(sql) && /SET @now := UTC_TIMESTAMP\(3\);/.test(sql),
    '생성 시각을 SQL 안의 UTC_TIMESTAMP(3) 로 넣지 않는다');
});

test('데모①: 명령줄 출력이 모듈 호출과 바이트까지 같다(두 번 실행)', () => {
  const gen = fileURLToPath(R('db/demo/build-demo-sql.mjs'));
  const run = () => execFileSync(process.execPath, [gen, '--my-login', LOGIN, '--base-date', BASE], { encoding: 'utf8' });
  const a = run(), b = run();
  assert.strictEqual(a, b, '명령줄 두 번의 출력이 다르다');
  assert.strictEqual(a, sql, '명령줄 출력이 buildDemoSql 결과와 다르다');
});

test('데모①: 잘못된 입력은 SQL 을 내지 않는다', () => {
  for (const bad of ["x'y", 'a b', '', 'a\\b', 'x'.repeat(51)]) {
    assert.throws(() => G.buildDemoSql({ myLogin: bad, baseDate: BASE }), `login_id [${bad}] 를 받았다`);
  }
  assert.throws(() => G.buildDemoSql({ myLogin: LOGIN, baseDate: '2026-02-30' }), '없는 날짜를 받았다');
  assert.throws(() => G.buildDemoSql({ myLogin: 'kimcs', baseDate: BASE }), '가상 명단과 같은 login_id 를 녹화 계정으로 받았다');
  assert.throws(() => G.sqlStr('a\nb'), '제어 문자가 든 문자열을 SQL 리터럴로 만들었다');
  assert.strictEqual(G.sqlStr("a'b\\c"), "'a''b\\\\c'", '따옴표와 역슬래시 이스케이프가 틀렸다');
});

// ══ ② 이름 ═══════════════════════════════════════════════════════════
test('데모②: 공식 과제, 발주처, 장소는 모두 (예시) 로 시작한다', () => {
  const rows = G.projectRows(BASE);
  assert.strictEqual(rows.length, 8, '공식 과제가 8개가 아니다');
  for (const p of rows) {
    for (const v of [p.projectName, p.commonName]) assert.ok(v.startsWith('(예시) '), `공식 과제 이름이 (예시) 로 시작하지 않는다: ${v}`);
    if (p.contractName) assert.ok(p.contractName.startsWith('(예시) '), `계약명이 (예시) 로 시작하지 않는다: ${p.contractName}`);
  }
  assert.ok(rows.some((p) => p.sectionId === 2 && p.startDate === null && p.contractName === ''), '선진행 과제(날짜와 계약명 비움)가 없다');
  assert.ok(rows.some((p) => p.statusId === 2), '종료 과제가 없다');
  //  선진행(구분 2)은 앱 규칙대로 날짜와 상태가 비어 있어야 한다(ProjectDb 의 선진행 판정과 같은 모양).
  for (const p of rows.filter((r) => r.sectionId === 2)) {
    assert.ok(p.statusId === null && p.startDate === null && p.endDate === null, `선진행 과제 ${p.commonName} 에 날짜나 상태가 있다`);
  }
  assert.deepStrictEqual([...new Set(rows.map((p) => p.sectionId))].sort(), [1, 2, 3], '구분이 섞여 있지 않다');
  assert.strictEqual(D.CUSTOMERS.length, 5, '발주처가 5개가 아니다');
  for (const c of D.CUSTOMERS) assert.ok(c.startsWith('(예시) '), `발주처 이름이 (예시) 로 시작하지 않는다: ${c}`);
  for (const r of D.ROOMS) assert.ok(r.startsWith('(예시) ') && [...r].length <= 40, `장소 이름이 이상하다: ${r}`);
  // 생성 SQL 의 발주처, 과제 INSERT 행도 같은 규칙이다(정의 밖에서 끼어든 이름이 없다)
  const cust = /INSERT INTO customer \(customer_id, name, is_active\) VALUES\n([\s\S]*?);\n/.exec(sql);
  assert.ok(cust, 'SQL 에서 발주처 INSERT 를 찾지 못했다');
  for (const l of cust[1].split('\n')) assert.ok(/^ {2}\(\d+, '\(예시\) [^']+', 1\),?$/.test(l), `발주처 행이 (예시) 로 시작하지 않는다: ${l}`);
  const proj = /INSERT INTO project \([^)]*\) VALUES\n([\s\S]*?);\n/.exec(sql);
  assert.ok(proj, 'SQL 에서 공식 과제 INSERT 를 찾지 못했다');
  for (const l of proj[1].split('\n')) {
    const strs = [...l.matchAll(/'([^']*)'/g)].map((m) => m[1]).filter((v) => /[가-힣]/.test(v));
    assert.ok(strs.length >= 2 && strs.every((v) => v.startsWith('(예시) ')), `공식 과제 행에 (예시) 가 아닌 이름이 있다: ${l}`);
  }
});

test('데모②: 사람 이름은 가상 명단에서만 나오고 login_id 는 가짜 모양이다', () => {
  const names = G.peopleNames();
  assert.strictEqual(D.RECORDING_NAME, undefined, 'demo-data.mjs 에 녹화 계정 이름(RECORDING_NAME)이 남아 있다');
  assert.deepStrictEqual(names.slice(0, 4).map((p) => p.name), ['김철수', '이영희', '박민수', '최지은'], '명단 앞 넷이 정한 순서가 아니다');
  assert.deepStrictEqual(names.slice(0, 4).map((p) => p.login), ['kimcs', 'leeyh', 'parkms', 'choije'], '명단 앞 넷의 login_id 가 다르다');
  assert.ok(names.length >= 300, `명단이 ${names.length}명뿐이다(사람이 많은 DB 에서 가드에 걸린다)`);
  const sn = new Map(D.SURNAMES), gn = new Map(D.GIVEN_NAMES);
  const fixed = new Map(D.FIXED_PEOPLE.map((p) => [p.name, p.login]));
  const seen = new Set(), seenLogin = new Set();
  for (const p of names) {
    assert.ok(!seen.has(p.name), `이름이 겹친다: ${p.name}`); seen.add(p.name);
    assert.ok(!seenLogin.has(p.login), `login_id 가 겹친다: ${p.login}`); seenLogin.add(p.login);
    assert.ok(/^[a-z0-9]{2,50}$/.test(p.login), `login_id 모양이 가짜 모양이 아니다: ${p.login}`);
    assert.ok(!D.AVOID_NAMES.includes(p.name), `명단에 피해야 할 이름이 있다: ${p.name}`);
    if (fixed.has(p.name)) { assert.strictEqual(p.login, fixed.get(p.name)); continue; }
    const s = p.name[0], g = p.name.slice(1);
    assert.ok(sn.has(s) && gn.has(g), `명단 재료(성, 이름)에 없는 이름이다: ${p.name}`);
    assert.strictEqual(p.login, sn.get(s) + gn.get(g), `login_id 가 재료에서 나온 모양이 아니다: ${p.name} ${p.login}`);
  }
  // SQL 의 가상 명단은 peopleNames 그대로다(다른 이름이 끼어들 자리가 없다)
  const rows = [...sql.matchAll(/\((\d+),'([^']+)','([^']+)'\)/g)].map((m) => ({ rn: +m[1], name: m[2], login: m[3] }));
  assert.deepStrictEqual(rows.map((r) => [r.name, r.login]), names.map((p) => [p.name, p.login]), 'SQL 의 가상 명단이 peopleNames 와 다르다');
  assert.deepStrictEqual(rows.map((r) => r.rn), names.map((_, i) => i + 1), '가상 명단 번호가 1 부터 이어지지 않는다');
  assert.ok(/NOT EXISTS \(SELECT 1 FROM _demo_names n WHERE CAST\(n\.name AS BINARY\) = CAST\(u\.name AS BINARY\)/.test(sql),
    'COMMIT 앞에서 가상 명단에 없는 이름이 남았는지 보지 않는다');
  checks.sqlRecordingUser(sql, LOGIN);
});

// ══ ③ ④ SQL 가드와 금지 문장 ══════════════════════════════════════════
test('데모③: SQL 가드(문자셋, 표, 구조 번호 14, 녹화 계정)와 트랜잭션 안 검증', () => checks.sqlGuards(sql));
test('데모④: SQL 은 계정, 권한, DDL, 조직과 코드표, 판번호를 건드리지 않는다', () => checks.sqlNoAccountsNoDdl(sql));

test('변이③④②: 가드를 빼거나 금지 문장을 넣으면 검사가 잡는다', () => {
  const muts = [
    [checks.sqlGuards, mutate(sql, "IF(@v <=> '14', 'DO 0',", "IF(1, 'DO 0',")],
    [checks.sqlGuards, mutate(sql, 'IF(@n_me = 1, ', 'IF(1, ')],
    [checks.sqlGuards, mutate(sql, '\nSTART TRANSACTION;\n', '\n')],
    [checks.sqlGuards, mutate(sql, 'IF(@fp_user2 = @fp_user, ', 'IF(1, ')],
    [checks.sqlNoAccountsNoDdl, mutate(sql, '\nCOMMIT;\n', "\nGRANT SELECT ON taskcalendar.app_user TO 'x'@'%';\nCOMMIT;\n")],
    [checks.sqlNoAccountsNoDdl, mutate(sql, '\nCOMMIT;\n', "\nCREATE USER 'x'@'%';\nCOMMIT;\n")],
    [checks.sqlNoAccountsNoDdl, mutate(sql, '\nCOMMIT;\n', '\nDELETE FROM cal_user_rev;\nCOMMIT;\n')],
    [checks.sqlNoAccountsNoDdl, mutate(sql, '\nCOMMIT;\n', '\nDROP TABLE project;\nCOMMIT;\n')],
    // 녹화 계정 이름 바꾸기를 되살리면 잡는다(2026-10-19 사용자 결정: 녹화 계정은 실제 이름 그대로)
    [(s) => checks.sqlRecordingUser(s, LOGIN), mutate(sql, '\n\n-- 2) cal_*', "\nUPDATE app_user SET name = '홍길동' WHERE user_id = @u_me;\n\n-- 2) cal_*")],
    [(s) => checks.sqlRecordingUser(s, LOGIN), mutate(sql, '\n\n-- 2) cal_*', "\nUPDATE app_user SET name = CONVERT(X'EAB980ECB2A0EC8898' USING utf8mb4) WHERE user_id = @u_me;\n\n-- 2) cal_*")],
    [checks.sqlGuards, mutate(sql, 'IF(@n_my_name_dummy = 0, ', 'IF(1, ')],
    [checks.sqlGuards, mutate(sql, 'AND HEX(name) = @my_name_hex AND HEX(login_id) = @my_login_hex', 'AND HEX(login_id) = @my_login_hex')],
    [(s) => checks.sqlRecordingUser(s, LOGIN), sql + `\n-- ${LOGIN}\nSELECT '${LOGIN}';\n`],
  ];
  muts.forEach(([fn, s], i) => assert.throws(() => fn(s), `변이 ${i} 를 잡지 못했다`));
});

// ══ ⑤ 데이터가 스키마 CHECK 를 지킨다 ═════════════════════════════════
test('데모⑤: 네 사람의 데이터가 CHECK 와 앱 규칙을 지킨다', () => {
  const projects = G.projectRows(BASE);
  const uids = new Set(projects.map((p) => p.uid));
  const { prevStart, curEnd, base } = G.dateRange(BASE);
  const ymd = (d) => d.toISOString().slice(0, 10);
  assert.deepStrictEqual(D.DEMO_PEOPLE.map((p) => p.who), ['me', 'c1', 'c2', 'c3'], '데이터를 받는 사람이 녹화 계정과 동료 셋이 아니다');
  for (const person of D.DEMO_PEOPLE) {
    const cal = G.personCalendar(person, BASE, projects);
    const who = person.who;
    // 과제
    const catNos = new Set(cal.cats.map((c) => c.no));
    assert.deepStrictEqual([...catNos], cal.cats.map((_, i) => i + 1), `${who}: cat_no 가 1 부터 이어지지 않는다`);
    for (const c of cal.cats) {
      assert.ok(/^#[0-9a-fA-F]{6}$/.test(c.color), `${who}: 과제 색 모양이 틀렸다 ${c.color}`);
      if (c.source === 'db') {
        assert.ok(c.uid === 'db-' + c.projectUid && c.uid.length === 39 && uids.has(c.projectUid), `${who}: 공식 과제 uid 가 db-<project.uid> 가 아니다 ${c.uid}`);
      } else {
        assert.ok(c.projectUid === null && /^c-[0-9a-f-]{36}$/.test(c.uid), `${who}: 개인 과제 uid 모양이 틀렸다 ${c.uid}`);
      }
    }
    for (const n of ['휴가', '기타']) {
      assert.strictEqual(cal.cats.filter((c) => c.source === 'local' && c.name === n).length, 1, `${who}: 기본 과제 '${n}' 가 정확히 하나가 아니다`);
    }
    assert.ok(cal.cats.filter((c) => c.source === 'db').length >= 3, `${who}: 공식 과제가 셋보다 적다`);
    // 일정
    const days = new Set();
    for (const e of cal.entries) {
      assert.ok(catNos.has(cal.catNo(e.cat)), `${who}: 없는 과제를 가리키는 일정`);
      assert.ok(/^e-[0-9a-f-]{36}$/.test(e.uid), `${who}: 일정 uid 모양이 틀렸다`);
      assert.ok(e.date >= ymd(prevStart) && e.date <= ymd(curEnd), `${who}: 범위 밖 일정 ${e.date}`);
      if (e.endDate) assert.ok(e.endDate > e.date, `${who}: 기간 일정 끝이 시작보다 크지 않다`);
      if (e.allDay) assert.ok(e.start === null && e.end === null, `${who}: 종일 일정에 시각이 있다`);
      else assert.ok(/^\d\d:\d\d$/.test(e.start) && e.end > e.start, `${who}: 시각 일정의 시각이 틀렸다`);
      if (e.location) assert.ok(e.location.startsWith('(예시) '), `${who}: 장소가 (예시) 로 시작하지 않는다`);
      if (e.recur) assert.ok(e.recur.freq === 'weekly' && e.recur.interval >= 1 && e.recur.count >= 0 && !e.endDate, `${who}: 반복 모양이 틀렸다`);
      days.add(e.date);
    }
    assert.strictEqual(new Set(cal.entries.map((e) => e.uid)).size, cal.entries.length, `${who}: 일정 uid 가 겹친다`);
    assert.ok(cal.entries.some((e) => e.endDate), `${who}: 여러 날 일정이 없다`);
    assert.ok(cal.entries.some((e) => e.start && e.location), `${who}: 시각과 장소가 있는 일정이 없다`);
    assert.ok(cal.entries.length >= 40, `${who}: 일정이 ${cal.entries.length}개뿐이다`);
    // 할 일
    for (const t of cal.todos) {
      if (t.endDate) assert.ok(t.due && t.endDate > t.due, `${who}: 기간 할 일의 끝이 시작보다 크지 않다`);
      if (!t.done) assert.strictEqual(t.completedAt, null, `${who}: 끝내지 않은 할 일에 완료 시각이 있다`);
      else assert.ok(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.000$/.test(t.completedAt), `${who}: 완료 시각 모양이 틀렸다`);
      assert.ok(['normal', 'high'].includes(t.prio), `${who}: prio 값이 틀렸다`);
      for (const [d] of t.notes) assert.ok(t.endDate && d >= t.due && d <= t.endDate, `${who}: 날짜별 메모가 기간 밖이다`);
    }
    assert.ok(cal.todos.some((t) => t.done) && cal.todos.some((t) => !t.done), `${who}: 끝낸 할 일과 남은 할 일이 섞여 있지 않다`);
    // 과제별 시간
    const keys = new Set();
    for (const h of cal.hours) {
      assert.ok(h.hours > 0 && h.hours <= 24 && Math.round(h.hours * 100) === h.hours * 100, `${who}: 시간 값이 범위 밖이다 ${h.hours}`);
      assert.ok(h.date <= ymd(base), `${who}: 기준 날짜 뒤에 시간이 있다`);
      const k = h.date + '|' + h.cat;
      assert.ok(!keys.has(k), `${who}: (날짜, 과제) 시간 행이 겹친다 ${k}`); keys.add(k);
    }
    const perDay = new Map();
    for (const h of cal.hours) perDay.set(h.date, (perDay.get(h.date) || 0) + h.hours);
    for (const [d, sum] of perDay) assert.strictEqual(sum, 8, `${who}: ${d} 의 시간 합이 8 이 아니다(${sum})`);
    assert.ok(perDay.size >= 20, `${who}: 시간을 적은 날이 ${perDay.size}일뿐이다`);
  }
});

test('데모⑤: 기준 날짜가 달라도(달 경계, 윤년, 월초) 생성이 깨지지 않는다', () => {
  for (const d of ['2026-01-01', '2026-03-01', '2028-02-29', '2026-05-31', '2026-12-31', '2027-08-02']) {
    const s = G.buildDemoSql({ myLogin: LOGIN, baseDate: d });
    checks.sqlGuards(s);
    checks.sqlNoAccountsNoDdl(s);
  }
});

// ══ ⑥ 지우는 표 목록과 스키마 ═══════════════════════════════════════════
test('데모⑥: 지우는 표와 그대로 두는 표가 스키마의 cal_* 표 전부와 맞물린다', () => {
  const calTables = [...schemaCal.matchAll(/^CREATE TABLE (\w+) \(/gm)].map((m) => m[1]).sort();
  const covered = [...G.WIPE_TABLES, 'cal_user_rev', 'cal_schema_meta'].sort();
  assert.deepStrictEqual(covered, calTables,
    'schema-calendar.sql 의 cal_* 표와 build-demo-sql.mjs 의 WIPE_TABLES(+cal_user_rev, cal_schema_meta)가 다르다. 새 표를 지울지 정할 것');
  // 자식 먼저: FK 로 다른 cal_* 표를 가리키는 표는 그 부모보다 앞에서 지운다
  for (const t of G.WIPE_TABLES) {
    const ddl = new RegExp(`CREATE TABLE ${t} \\(([\\s\\S]*?)\\n\\) ENGINE`).exec(schemaCal)[1];
    for (const m of ddl.matchAll(/REFERENCES (cal_\w+)/g)) {
      if (G.WIPE_TABLES.includes(m[1])) assert.ok(G.WIPE_TABLES.indexOf(t) < G.WIPE_TABLES.indexOf(m[1]), `${t} 를 부모 ${m[1]} 보다 뒤에서 지운다`);
    }
  }
  // INSERT 열 이름이 실제 표에 있다
  const allDdl = schemaCal + '\n' + schemaStruct;
  for (const m of sql.matchAll(/^INSERT INTO (\w+) \(([^)]*)\) VALUES/gm)) {
    if (m[1].startsWith('_demo_')) continue;
    const ddl = new RegExp(`CREATE TABLE ${m[1]} \\(([\\s\\S]*?)\\n\\) ENGINE`).exec(allDdl);
    assert.ok(ddl, `INSERT 대상 표 ${m[1]} 의 DDL 을 찾지 못했다`);
    for (const col of m[2].split(',').map((x) => x.trim())) {
      assert.ok(new RegExp(`^\\s+${col}\\s`, 'm').test(ddl[1]), `${m[1]} 에 열 ${col} 이 없다`);
    }
  }
  assert.ok(/INSERT INTO section_code \(section_id, name, sort_order\) VALUES\s*\n\s*\(1, '일반계약', 10\), \(2, '선진행', 20\), \(3, '사업부관리', 30\);/.test(schemaStruct),
    '구분 코드 고정 번호(1 일반계약, 2 선진행, 3 사업부관리)가 바뀌었다. demo-data.mjs 의 section 번호를 함께 볼 것');
  assert.ok(/\(1, '진행중', 10\), \(2, '종료', 20\), \(3, '1차 납품완료', 30\), \(4, '미정', 40\);/.test(schemaStruct),
    '상태 코드 고정 번호가 바뀌었다. demo-data.mjs 의 status 번호를 함께 볼 것');
  assert.ok(/INSERT INTO cal_schema_meta \(k, v, updated_at\) VALUES \('db_structure_version', '14'/.test(schemaCal), '구조 번호가 14 가 아니다. SCHEMA_VERSION 을 함께 올릴 것');
});

// ══ ⑦ ps1 과 .cmd 의 공통 계약 ═════════════════════════════════════════
const cmdChecks = {
  cmdShape(cmd) {
    assert.deepStrictEqual(nonAsciiLines(cmd), [], '.cmd 에 비ASCII 가 있다(cmd.exe 바이트 오프셋 사고)');
    const body = cmd.split('\n').filter((l) => !/^\s*rem\b/i.test(l)).join('\n');
    assert.ok(/^powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0demo-db\.ps1" %\*$/m.test(body), '.cmd 가 ps1 을 %* 로 부르지 않는다');
    assert.ok(/^set "TC_DEMO_DB_LAUNCHER=cmd"$/m.test(body), '.cmd 가 런처 표시를 세우지 않는다');
    assert.ok(/^set "RC=%ERRORLEVEL%"\nif errorlevel 1 pause\nexit \/b %RC%$/m.test(body), '.cmd 가 실패에서 멈추고 종료코드를 넘기지 않는다');
    assert.ok(/^cd \/d "%~dp0"$/m.test(body), '.cmd 가 자기 폴더로 옮기지 않는다');
  },
};
test('데모⑦: .cmd 는 ASCII 이고 ps1 을 %* 로 부르며 실패에서 멈춘다', () => {
  cmdChecks.cmdShape(cmdSrc);
  assert.ok(/\r\n/.test(readFileSync(R('db/demo/demo-db.cmd')).toString('latin1')), '.cmd 줄끝이 CRLF 가 아니다');
});
test('변이⑦: .cmd 가 %* 를 빼먹거나 한글이 들어가면 검사가 잡는다', () => {
  assert.throws(() => cmdChecks.cmdShape(mutate(cmdSrc, 'demo-db.ps1" %*', 'demo-db.ps1"')), '%* 누락을 잡지 못했다');
  assert.throws(() => cmdChecks.cmdShape(mutate(cmdSrc, 'rem  Usage:', 'rem  사용법:')), '비ASCII 를 잡지 못했다');
  assert.throws(() => cmdChecks.cmdShape(mutate(cmdSrc, 'if errorlevel 1 pause\n', '')), '실패 멈춤 누락을 잡지 못했다');
});

test('데모⑦: 종료코드 표가 .ps1 과 .cmd 에서 줄 단위로 같고 ps1 이 실제로 내는 코드와 같다', () => {
  const a = exitCodeTable(psSrc, false), b = exitCodeTable(cmdSrc, true);
  assert.deepStrictEqual(a, b, '종료코드 표가 .ps1 과 .cmd 에서 다르다');
  const codes = exitCodesInTable(a);
  assert.deepStrictEqual(codes, [0, 1, 2, 3, 4, 5], '종료코드 표가 0~5 가 아니다');
  assert.deepStrictEqual(exitCodesUsed(psSrc), codes, 'ps1 이 실제로 내는 종료코드가 표와 다르다');
  for (const [n, v] of [['OK', 0], ['FAIL', 1], ['CANCEL', 2], ['PRECHECK', 3], ['BUSY', 4], ['BACKUP', 5]]) {
    assert.ok(new RegExp(`^\\$EXIT_${n}\\s*=\\s*${v}$`, 'm').test(psSrc), `$EXIT_${n} = ${v} 가 없다`);
  }
  assert.ok(readme.includes('| 4 | 앱 계정 세션이 열려 있음'), 'README 의 종료코드 표가 ps1 과 맞지 않는다');
});

test('데모⑦: ps1 은 비밀번호를 명령줄에 싣지 않고 임시 .cnf 를 finally 에서 지운다, BOM 이 있다', () => {
  assert.deepStrictEqual(passwordOnCommandLineHits(psSrc), [], 'ps1 이 비밀번호를 명령줄에 싣는 자리가 있다');
  const code = maskPs(psSrc);
  assert.ok(!/param\([\s\S]*?(Password|Pw)\b[\s\S]*?\)\s*\n\$ErrorActionPreference/.test(code.slice(0, code.indexOf('$ErrorActionPreference') + 30)), 'param 에 비밀번호 인자가 있다');
  assert.ok(/\$ADMIN_PW_ENV\s*=\s*"TASKMGR_ADMIN_PW"/.test(code), '무인 실행 환경변수 이름이 TASKMGR_ADMIN_PW 가 아니다');
  assert.ok(/ReadStdinLineBounded \$STDIN_WAIT_SEC/.test(code) && /\$STDIN_WAIT_SEC = 10/.test(code), 'stdin 읽기에 상한이 없다');
  assert.ok(/"--defaults-extra-file=\$\(\$script:cnfPath\)"/.test(code), 'mysql 에 .cnf 로 자격을 넘기지 않는다');
  assert.ok(/\} finally \{\n\s*#[^\n]*\n\s*Cleanup\n\}/.test(psSrc), '마지막 finally 가 Cleanup 을 부르지 않는다');
  assert.ok(/function Cleanup\(\)\{\n\s*if\(\$script:cnfPath\)\{ Remove-Item -LiteralPath \$script:cnfPath -Force/.test(code), 'Cleanup 이 .cnf 를 지우지 않는다');
  assert.deepStrictEqual([...psBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'ps1 에 UTF-8 BOM 이 없다(PowerShell 5.1 이 한글 상수를 잘못 읽는다)');
  for (const re of [/\bGRANT\b/, /\bCREATE USER\b/i, /\bDROP USER\b/i, /\bALTER USER\b/i, /\bREVOKE\b/]) assert.ok(!re.test(code), `ps1 이 계정이나 권한 문장을 낸다: ${re}`);
});

// ══ ⑧ ps1 순서 ═════════════════════════════════════════════════════════
function block(code, start, end) {
  const a = code.indexOf(start), b = end ? code.indexOf(end, a + 1) : code.length;
  assert.ok(a >= 0 && b > a, `블록을 찾지 못했다: ${start}`);
  return code.slice(a, b);
}
const orderChecks = {
  load(code) {
    const L = block(code, "if($mode -eq 'Load'){\n    if(-not $dbExists)", "if($mode -eq 'Restore'){");
    const pos = (re, label) => { const m = re.exec(L); assert.ok(m, `-Load 에 ${label} 이(가) 없다`); return m.index; };
    const ver = pos(/if\(\$ver -ne \$SCHEMA_VERSION\)\{ DiePre/, '구조 번호 14 확인');
    const already = pos(/if\(\$marker\)\{ DiePre/, '표지 파일이 있으면 거부');
    const demoAlready = pos(/if\(\$st\.DemoProjects -gt 0 -or \$st\.DemoCustomers -gt 0\)\{ DiePre/, '이미 (예시) 과제가 있으면 거부');
    const sess = pos(/\n\s*CheckSessions\n/, '세션 확인');
    const confirm = pos(/Read-Host "계속하려면 Y"/, '확인(Y)');
    const dump = pos(/\$why = DumpDb \$dumpPath\n\s*if\(\$why\)\{ Finish \$EXIT_BACKUP/, '백업과 실패 시 종료코드 5');
    const counts = pos(/WriteJson \$countsPath/, '행 수 파일');
    const marker = pos(/WriteJson \$markerPath/, '표지 파일');
    const gen = pos(/& \$node \$genPath "--my-login" \$MyLoginId "--base-date" \$BaseDate "--out" \$sqlPath/, '생성기 호출');
    const apply = pos(/cmd \/c "`"\$mysql`" --defaults-extra-file=`"\$\(\$script:cnfPath\)`" --default-character-set=utf8mb4 -N -B `"\$DbName`" < `"\$sqlPath`"/, '적용(--force 없음)');
    const verify = pos(/Step 3 "확인"/, '확인 단계');
    const nameSame = pos(/if\(\$m2\[0\] -ne \$meNameHex\)\{ \$bad\.Add/, '녹화 계정 이름 불변 확인');
    const loginSame = pos(/\$m2\[1\] -ne \$meLoginHex/, '녹화 계정 login_id 불변 확인');
    const seq = [ver, already, demoAlready, sess, confirm, dump, counts, marker, gen, apply, verify, nameSame, loginSame];
    for (let i = 1; i < seq.length; i++) assert.ok(seq[i - 1] < seq[i], `-Load 순서가 틀렸다(${i - 1} 번째와 ${i} 번째)`);
    for (const l of L.split('\n').filter((x) => /cmd \/c|& \$mysql/.test(x))) assert.ok(!/--force/.test(l), '-Load 가 mysql 에 --force 를 준다: ' + l.trim());
  },
  restore(code) {
    const L = block(code, "if($mode -eq 'Restore'){", '} finally {');
    const pos = (re, label) => { const m = re.exec(L); assert.ok(m, `-Restore 에 ${label} 이(가) 없다`); return m.index; };
    const done = pos(/if\(-not \(DumpCompleted \$DumpPath\)\)\{ DiePre/, "백업 끝의 '-- Dump completed' 확인");
    const head = pos(/CREATE DATABASE\|USE\\s/, '백업 머리의 CREATE DATABASE, USE 확인');
    const counts = pos(/\$countsPath = \$DumpPath \+ "\.counts\.json"/, '행 수 파일 읽기');
    const demo = pos(/if\(-not \$isDemo -and -not \$marker\)\{\n\s*DiePre/, '데모가 아니고 표지도 없으면 거부');
    const sess = pos(/\n\s*CheckSessions\n/, '세션 확인');
    const confirm = pos(/Read-Host "계속하려면 Y"/, '확인(Y)');
    const safe = pos(/\$why = DumpDb \$safePath\n\s*if\(\$why\)\{ Finish \$EXIT_BACKUP/, '안전 덤프와 실패 시 종료코드 5');
    const drop = pos(/DROP DATABASE IF EXISTS \$dbQ; CREATE DATABASE \$dbQ CHARACTER SET utf8mb4 COLLATE \$collation;/, 'DROP 과 CREATE(utf8mb4)');
    const load = pos(/cmd \/c "`"\$mysql`" --defaults-extra-file=`"\$\(\$script:cnfPath\)`" --default-character-set=utf8mb4 `"\$DbName`" < `"\$DumpPath`"/, '백업 붓기');
    const ver = pos(/if\("\$ver" -ne \$SCHEMA_VERSION\)/, '판번호 확인');
    const cmp = pos(/"\$k 행 수가 다릅니다/, '표별 행 수 대조');
    const seq = [done, head, counts, demo, sess, confirm, safe, drop, load, ver, cmp];
    for (let i = 1; i < seq.length; i++) assert.ok(seq[i - 1] < seq[i], `-Restore 순서가 틀렸다(${i - 1} 번째와 ${i} 번째)`);
    for (const l of L.split('\n').filter((x) => /cmd \/c|& \$mysql/.test(x))) assert.ok(!/--force/.test(l), '-Restore 가 mysql 에 --force 를 준다: ' + l.trim());
  },
  dump(code) {
    const f = block(code, 'function DumpDb(', 'function DumpCompleted(');
    const call = /& \$mysqldump (.*)\n/.exec(f);
    assert.ok(call, 'DumpDb 에 mysqldump 호출이 없다');
    for (const opt of ['"--default-character-set=utf8mb4"', '"--single-transaction"', '"--no-tablespaces"', '"--routines"', '"--triggers"', '"--events"', '$GTID_PURGED_OFF', '"--result-file=$part"']) {
      assert.ok(call[1].includes(opt), `mysqldump 에 ${opt} 가 없다`);
    }
    assert.ok(!/--databases|--all-databases|-B\b/.test(call[1]), 'mysqldump 가 --databases 로 뜬다(덤프에 CREATE DATABASE, USE 가 들어간다)');
    assert.ok(call[1].trim().endsWith('$DbName'), 'mysqldump 의 마지막 인자가 DB 이름이 아니다');
    assert.ok(/\$GTID_PURGED_OFF = "--set-gtid-" \+ "purged=OFF"/.test(code), 'GTID 옵션 상수가 없다');
    assert.ok(/if\(-not \(DumpCompleted \$part\)\)\{ return/.test(f), "DumpDb 가 '-- Dump completed' 를 확인하지 않는다");
    assert.ok(/Move-Item -LiteralPath \$part -Destination \$path/.test(f) && /\$part = \$path \+ "\.partial"/.test(f), 'DumpDb 가 검증 전 .partial 이름을 쓰지 않는다');
    assert.ok(/StartsWith\("-- Dump completed"\)/.test(block(code, 'function DumpCompleted(', 'function WriteJson(')), 'DumpCompleted 가 마지막 줄을 보지 않는다');
    assert.ok(/\$DEFAULT_COLLATION = "utf8mb4_0900_ai_ci"/.test(code), '되살릴 DB 의 기본 정렬 규칙이 utf8mb4_0900_ai_ci 가 아니다');
    assert.ok(/if\(\$collation -notmatch '\^utf8mb4_\[a-z0-9_\]\+\$'\)\{ \$collation = \$DEFAULT_COLLATION \}/.test(code), '행 수 파일의 정렬 규칙을 검사 없이 SQL 에 넣는다');
  },
};
test('데모⑧: -Load 는 점검, 확인, 백업, 표지, 생성, 적용, 확인 순서다', () => orderChecks.load(maskPs(psSrc)));
test('데모⑧: -Restore 는 덤프 검증, 데모 확인, 안전 덤프, DROP, 붓기, 행 수 대조 순서다', () => orderChecks.restore(maskPs(psSrc)));
test('데모⑧: 백업은 --databases 없이 필요한 옵션을 다 주고 끝을 확인한다', () => orderChecks.dump(maskPs(psSrc)));
test('변이⑧: 백업을 빼거나 순서를 바꾸거나 옵션을 빼면 검사가 잡는다', () => {
  const code = maskPs(psSrc);
  const muts = [
    [orderChecks.load, mutate(code, '    $why = DumpDb $dumpPath\n', '    $why = ""\n')],
    [orderChecks.load, mutate(code, "    if($marker){ DiePre", "    if($false){ DiePre")],
    [orderChecks.restore, mutate(code, '      $why = DumpDb $safePath\n', '      $why = ""\n')],
    [orderChecks.restore, mutate(code, '"$k 행 수가 다릅니다', '"$k 행 수 차이')],
    [orderChecks.dump, mutate(code, '"--single-transaction" ', '')],
    [orderChecks.dump, mutate(code, '$GTID_PURGED_OFF "--result-file=$part" $DbName', '$GTID_PURGED_OFF "--result-file=$part" "--databases" $DbName')],
  ];
  muts.forEach(([fn, s], i) => assert.throws(() => fn(s), `변이 ${i} 를 잡지 못했다`));
});

// ══ ⑨ 세션 확인, 녹화 계정 읽기 ══════════════════════════════════════════
test('데모⑨: 앱 계정 세션이 있으면 종료코드 4, -Force 만 건너뛴다', () => {
  const code = maskPs(psSrc);
  assert.ok(/\[string\]\$AppUser = "taskmgr_app"/.test(code), '세션을 세는 앱 계정 기본값이 taskmgr_app 이 아니다');
  const f = block(code, 'function CheckSessions(', 'function DumpDb(');
  assert.ok(/if\(\$Force\)\{ Warn/.test(f), '-Force 가 세션 확인을 건너뛰지 않는다');
  assert.ok(/information_schema\.PROCESSLIST WHERE USER = '\$AppUser' AND DB = '\$DbName'/.test(code), '세션을 앱 계정과 DB 로 세지 않는다');
  assert.ok(/Finish \$EXIT_BUSY/.test(f), '세션이 있을 때 종료코드 4 로 끝나지 않는다');
  assert.ok(/if\(\$mode -ne 'Status' -and \[Console\]::IsInputRedirected -and -not \$Yes\)\{ DiePre/.test(code), '무인 실행에서 -Yes 없이 바꾸는 길이 있다');
});

test('데모⑨: 녹화 계정은 -MyLoginId 나 위젯 세션 파일(UserSession.cs 와 같은 형식)에서 온다', () => {
  const code = maskPs(psSrc);
  assert.ok(/Path\.Combine\(dataDir, "user\.session"\)/.test(userSessionCs), '실물: UserSession.cs 의 세션 파일 이름이 user.session 이 아니다');
  assert.ok(/JSON → UTF8 → Dpapi\.Protect → Base64/.test(userSessionCs) && /DPAPI\(CurrentUser\)/.test(userSessionCs), '실물: 세션 파일 형식(JSON, UTF8, DPAPI CurrentUser, Base64)이 바뀌었다');
  assert.ok(/loginId = loginId \?\? ""/.test(userSessionCs), '실물: 세션 JSON 의 키가 loginId 가 아니다');
  assert.ok(/SpecialFolder\.ApplicationData\);\s*\n\s*_dataDir = Path\.Combine\(appData, "TaskCalendar"\);/.test(mainWindowCs), '실물: 위젯 데이터 폴더가 %APPDATA%\\TaskCalendar 가 아니다');
  const f = block(code, 'function ReadSessionLoginId(', 'if($mode -eq ');
  assert.ok(f.includes('Join-Path $env:APPDATA "TaskCalendar\\user.session"'), 'ps1 이 위젯 세션 파일 자리를 다르게 본다');
  assert.ok(/ProtectedData\]::Unprotect\(\[Convert\]::FromBase64String\(\$b64\), \$null, \[Security\.Cryptography\.DataProtectionScope\]::CurrentUser\)/.test(f), 'ps1 이 DPAPI CurrentUser 로 풀지 않는다');
  assert.ok(/\$o\.loginId/.test(f), 'ps1 이 loginId 키를 읽지 않는다');
  assert.ok(/DiePre "\$\(\$sess\.Why\)\. 녹화 계정의 login_id 를 -MyLoginId 로 주세요\."/.test(code), '세션 파일을 못 읽을 때 -MyLoginId 를 요구하지 않는다');
  const re = /\$LOGIN_RE\s*=\s*'([^']+)'/.exec(code);
  assert.ok(re && re[1] === G.LOGIN_RE.source, `ps1 의 LOGIN_RE(${re && re[1]})가 생성기(${G.LOGIN_RE.source})와 다르다`);
  assert.ok(/login_id = \$\(HexStr \$MyLoginId\) COLLATE utf8mb4_0900_ai_ci/.test(code), 'ps1 이 녹화 계정을 16진 리터럴로 찾지 않는다');
  assert.ok(/if\(\$mf\[0\] -ne '1'\)\{ DiePre/.test(code), '녹화 계정이 정확히 한 명인지 보지 않는다');
});

const recChecks = {
  psKeepsName(src) {
    const code = maskPs(src);
    assert.ok(!/홍길동/.test(src), 'ps1 에 홍길동이 있다(녹화 계정 이름은 그대로여야 한다)');
    assert.ok(!/RECORDING_NAME|RECORDING_HEX/.test(code), 'ps1 에 녹화 계정의 바꿀 이름 상수가 있다');
    assert.ok(!/로그아웃했다가|다시 로그인하면|다시 로그인하세요/.test(src), 'ps1 에 다시 로그인하라는 안내가 남아 있다');
    const L = block(code, "if($mode -eq 'Load'){\n    if(-not $dbExists)", "if($mode -eq 'Restore'){");
    assert.ok(/\$meName = FromUtf8Hex \$meNameHex/.test(L), '-Load 가 녹화 계정 이름을 읽어 두지 않는다');
    assert.ok(/Ok "녹화 계정: user_id \$meId, 이름 그대로\(\$\(FromUtf8Hex \$m2\[0\]\)\), login_id 그대로"/.test(L), '-Load 요약이 녹화 계정 이름을 그대로 보여 주지 않는다');
    assert.ok(/if\(\$m2\[0\] -ne \$meNameHex\)\{ \$bad\.Add\("녹화 계정 이름이 바뀌었습니다"\) \}/.test(L), '-Load 확인이 녹화 계정 이름을 넣기 전 값과 비교하지 않는다');
    const S = block(code, "if($mode -eq 'Status'){\n    if(-not $dbExists)", "if($mode -eq 'Load'){\n    if(-not $dbExists)");
    assert.ok(/이름 \$\(FromUtf8Hex \$f\[0\]\)/.test(S), '-Status 가 녹화 계정 이름을 그대로 보여 주지 않는다');
    const f = block(code, 'function FromUtf8Hex(', '$PREFIX_LIKE');
    assert.ok(/\[Text\.Encoding\]::UTF8\.GetString/.test(f), 'FromUtf8Hex 가 UTF-8 로 풀지 않는다');
  },
};
test('데모⑨: ps1 은 녹화 계정 이름을 바꾸지 않고 그대로 보여 주며, 다시 로그인하라고 하지 않는다', () => recChecks.psKeepsName(psSrc));
test('변이⑨: ps1 에 녹화 계정 이름 바꾸기나 다시 로그인 안내를 되살리면 검사가 잡는다', () => {
  const muts = [
    mutate(psSrc, '$DEMO_PREFIX    = "(예시)"\n', '$DEMO_PREFIX    = "(예시)"\n$RECORDING_NAME = "홍길동"\n'),
    mutate(psSrc, 'if($m2[0] -ne $meNameHex){', 'if($m2[0] -ne $RECORDING_HEX){'),
    mutate(psSrc, '녹화 계정은 이름이 그대로라 다시 로그인하지 않아도 됩니다.', '로그아웃했다가 다시 로그인하면 바뀐 이름이 보입니다.'),
    mutate(psSrc, '이름 그대로($(FromUtf8Hex $m2[0]))', '이름 바뀜'),
  ];
  muts.forEach((s, i) => assert.throws(() => recChecks.psKeepsName(s), '변이 ' + i + ' 를 잡지 못했다'));
});

test('데모⑨: -Status 는 읽기만 하고, mysql -e 에는 ASCII 만 싣는다', () => {
  const code = maskPs(psSrc);
  const S = block(code, "if($mode -eq 'Status'){\n    if(-not $dbExists)", "if($mode -eq 'Load'){\n    if(-not $dbExists)");
  for (const re of [/DumpDb/, /DROP DATABASE/, /cmd \/c/, /WriteJson/, /SetMarkerState/, /\bUPDATE\b/, /\bDELETE\b/, /\bINSERT\b/]) assert.ok(!re.test(S), `-Status 가 쓰기를 한다: ${re}`);
  assert.ok(/Finish \$EXIT_OK "상태: \$verdict"/.test(S), '-Status 가 0 으로 끝나지 않는다');
  // QTry, QRowsTry, QPre 에 넘기는 SQL 문자열 리터럴에 한글이 없다(명령줄 코드페이지를 거치면 깨진다)
  for (const m of code.matchAll(/\b(QTry|QRowsTry|QPre) (\(?)"([^"\n]*)"/g)) assert.ok(!/[^\x00-\x7f]/.test(m[3]), `mysql -e 에 비ASCII 가 실린다: ${m[3].slice(0, 80)}`);
  assert.ok(/\$PREFIX_LIKE = "CONCAT\(" \+ \(HexStr \$DEMO_PREFIX\) \+ ", '%'\)"/.test(code), "'(예시)' 판정을 16진 리터럴로 하지 않는다");
});

// ══ ⑩ 문서 ═════════════════════════════════════════════════════════════
test('데모⑩: 키트 문서와 화면 문구에 줄표, 띄운 가운데 점, 낫표가 없다', () => {
  const files = { 'db/demo/README.md': readme, 'db/demo/demo-db.ps1': psSrc, 'db/demo/demo-data.mjs': read('db/demo/demo-data.mjs'),
    'db/demo/build-demo-sql.mjs': read('db/demo/build-demo-sql.mjs') };
  for (const [f, s] of Object.entries(files)) {
    for (const [re, label] of [[/—/, '엠 대시'], [/–/, 'en 대시'], [/ · /, '띄운 가운데 점'], [/[「」]/, '낫표']]) {
      assert.ok(!re.test(s), `${f} 에 ${label} 가 있다`);
    }
  }
  assert.ok(!/홍길동/.test(readme) && !/로그아웃했다가/.test(readme), 'db/demo/README.md 에 녹화 계정 이름 바꾸기나 다시 로그인 안내가 남아 있다');
  for (const re of [/이슈 #13/, /녹화 계정은 이름도 login_id 도 그대로/, /다시 로그인하지 않아도 됩니다/, /모든 세션과 모든 루프에게 데모 데이터/, /위젯 루프.*녹화하지 마세요/, /MySQL 계정과 권한/, /demo-db\.cmd -Load/, /demo-db\.cmd -Restore/, /조직\(org_unit\)과 직급\(title_code\)/]) {
    assert.ok(re.test(readme), `db/demo/README.md 에 ${re} 가 없다`);
  }
  assert.ok(/\[`\.\.\/demo\/README\.md`\]\(\.\.\/demo\/README\.md\)/.test(deployReadme), 'db/deploy/README.md 가 db/demo/README.md 를 가리키지 않는다');
});
