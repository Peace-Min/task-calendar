// 폐쇄망 배포 확인 SQL(db/deploy/checks/*.sql)은 읽기만 한다(docs/RELEASE-0.26.0-QA.md 항목 A).
//   배포하는 관리자 계정은 taskcalendar 전체 권한이라 이 파일 안의 쓰기 문장 하나가 운영 DB 를 바꾼다.
//   그래서 주석과 글자값을 걷어 낸 코드에 바꾸는 낱말이 없고, 모든 문장이 SELECT 나 SHOW 로 시작하는지 본다.
//   20 에서 22 리허설 스크립트(tools/db-rehearsal/rehearse-upgrade-20-22.mjs)의 순수 함수와 비밀번호 규칙도 함께 본다.
import { readdirSync } from 'node:fs';
import { test, assert, readText } from './harness.mjs';

const R = (p) => new URL('../' + p, import.meta.url);
const read = (p) => readText(R(p)).replace(/^﻿/, '').replace(/\r\n/g, '\n');

//  줄 주석(--, #)과 블록 주석, 작은따옴표, 큰따옴표, 백틱 글자값을 걷는다(설명과 기대 문구가 검사에 걸리지 않게).
export function stripSql(sql) {
  let out = '';
  for (let i = 0; i < sql.length;) {
    const c = sql[i];
    if ((c === '-' && sql[i + 1] === '-') || c === '#') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '/' && sql[i + 1] === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; out += ' '; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let k = i + 1;
      while (k < sql.length) { if (sql[k] === '\\') { k += 2; continue; } if (sql[k] === c && sql[k + 1] === c) { k += 2; continue; } if (sql[k] === c) break; k++; }
      out += ' x '; i = k + 1; continue;
    }
    out += c; i++;
  }
  return out;
}
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE|RENAME|SET|CALL|LOAD|LOCK|HANDLER|DO|PREPARE|EXECUTE|START|COMMIT|INTO)\b/i;
const problems = (sql) => {
  const code = stripSql(sql);
  const out = [];
  const m = FORBIDDEN.exec(code);
  if (m) out.push(`바꾸는 낱말 ${m[1]}`);
  for (const st of code.split(';').map((s) => s.trim()).filter(Boolean)) if (!/^(SELECT|SHOW)\b/i.test(st)) out.push(`SELECT, SHOW 가 아닌 문장: ${st.slice(0, 40)}`);
  return out;
};

const DIR = 'db/deploy/checks/';
const files = readdirSync(R(DIR)).filter((f) => f.endsWith('.sql')).sort();

test('확인 SQL①: db/deploy/checks 에 v22 사전 조회와 사후 확인이 있다', () => {
  for (const f of ['v22-precheck.sql', 'v22-postcheck.sql']) assert.ok(files.includes(f), `${DIR}${f} 가 없다`);
});

for (const f of files) {
  test(`확인 SQL②: ${f} 는 읽기만 한다(INSERT, UPDATE, DELETE, ALTER, DROP, CREATE, GRANT 따위가 없고 문장마다 SELECT 나 SHOW)`, () => {
    const p = problems(read(DIR + f));
    assert.deepStrictEqual(p, [], `${f}: ${p.join(' ; ')}`);
  });
}

test('확인 SQL③: 검사기가 쓰기 문장을 실제로 잡는다(변이)', () => {
  const pre = read(DIR + 'v22-precheck.sql');
  for (const bad of ["UPDATE cal_schema_meta SET v = '1' WHERE k = 'db_updating';", 'DROP TABLE cal_task_hours;', 'ALTER TABLE x ADD COLUMN y INT;',
    "GRANT SELECT ON taskcalendar.* TO 'a'@'%';", 'DELETE FROM cal_report_hours WHERE user_id > 0;', 'CREATE TABLE t (a INT);', 'INSERT INTO t VALUES (1);',
    'SELECT 1 INTO @x;', 'SET @a := 1;']) {
    assert.ok(problems(pre + '\n' + bad + '\n').length > 0, `검사기가 놓쳤다: ${bad}`);
  }
  //  주석과 글자값 안의 낱말은 잡지 않는다(설명문이 검사를 깨지 않게)
  assert.deepStrictEqual(problems("-- DROP TABLE x;\nSELECT 'UPDATE 는 없다' AS `DELETE`;\n"), []);
});

test('확인 SQL④: 사전 조회는 v22 조각과 같은 비교(utf8mb4_bin, 개인 과제)로 주간 줄 채우기를 미리 센다', () => {
  const pre = read(DIR + 'v22-precheck.sql');
  const frag = read('db/deploy/migrations/v22-report-hours.sql');
  assert.ok(/source = ''local''/.test(frag) && /COLLATE utf8mb4_bin/.test(frag), 'v22 조각의 채우기 비교가 바뀌었다(사전 조회도 함께 고칠 것)');
  assert.ok(/c\.source = 'local'/.test(pre) && /c\.name COLLATE utf8mb4_bin = h\.task_name COLLATE utf8mb4_bin/.test(pre), '사전 조회의 같은 이름 비교가 조각과 다르다');
  //  _bin 은 PAD SPACE 라 끝 공백만 다른 이름을 같다고 본다. 조각과 사전 조회 모두 글자 수까지 보아야 미리 보기 수가 맞는다.
  const LEN = /CHAR_LENGTH\(c\.name\) = CHAR_LENGTH\(h\.task_name\)/;
  assert.ok(LEN.test(frag), 'v22 조각의 채우기가 글자 수를 보지 않는다');
  const preCmp = pre.match(/c\.name COLLATE utf8mb4_bin = h\.task_name COLLATE utf8mb4_bin\s+AND CHAR_LENGTH\(c\.name\) = CHAR_LENGTH\(h\.task_name\)/g) || [];
  const preAll = pre.match(/c\.name COLLATE utf8mb4_bin = h\.task_name COLLATE utf8mb4_bin/g) || [];
  assert.ok(preAll.length >= 1 && preCmp.length === preAll.length, `사전 조회의 같은 이름 비교 ${preAll.length}곳 가운데 글자 수까지 보는 곳이 ${preCmp.length}곳이다`);
  assert.ok(/SHOW GRANTS FOR 'taskmgr_app'@'%'/.test(pre), '사전 조회가 앱 계정(server-app-account.sql 의 taskmgr_app@%) 권한을 보지 않는다');
  assert.ok(/'taskmgr_app'@'%'/.test(read('db/deploy/server-app-account.sql')), 'server-app-account.sql 의 앱 계정 이름이 바뀌었다(사전 조회도 함께 고칠 것)');
});

const RH_SRC = read('tools/db-rehearsal/rehearse-upgrade-20-22.mjs');
const RH = await import(R('tools/db-rehearsal/rehearse-upgrade-20-22.mjs').href);

test('리허설 20에서22①: 비밀번호는 환경 변수 TC_DB_PW 에서 MYSQL_PWD 로만, 명령줄과 파일에 싣지 않는다', () => {
  assert.ok(/process\.env\.TC_DB_PW/.test(RH_SRC) && /MYSQL_PWD: pw/.test(RH_SRC) && /delete env\.TC_DB_PW/.test(RH_SRC));
  assert.ok(!/--password|['"]-p['"]|-p\$\{/.test(RH_SRC), '비밀번호를 명령줄에 싣는다');
  assert.ok(!/writeFileSync/.test(RH_SRC), '파일을 쓴다(조립본은 release-sql.ps1 이 OS 임시 폴더에 쓴다)');
  assert.ok(/sql_safe_updates = 1/.test(RH_SRC), 'Workbench 안전 갱신 모드로 돌리지 않는다');
});

test('리허설 20에서22②: 일회용 이름, 인자, 끊을 경계, 해시 질의', () => {
  assert.ok(RH.isThrowawayName('tc_rh_u20_a') && !RH.isThrowawayName('taskcalendar') && !RH.isThrowawayName('tc_rh_v22_a') && !RH.isThrowawayName('tc_rh_u20_a;drop'));
  assert.throws(() => RH.parseArgs(['--only', 'z']));
  assert.throws(() => RH.parseArgs(['taskcalendar']));
  assert.deepStrictEqual([...RH.parseArgs([]).only].sort(), ['c', 'd', 'e']);
  const st = ['SET @a := 1', 'START TRANSACTION', 'SET @s := 1', 'PREPARE _s FROM @s', 'EXECUTE _s', 'DEALLOCATE PREPARE _s', 'COMMIT', "UPDATE cal_schema_meta SET v = '21' WHERE k = 'x'", 'SET @b := 2'];
  assert.deepStrictEqual(RH.changeBoundaries(st), [0, 6, 7, 8, 9]);
  const h = RH.tableHashSql('t', ['a', 'b:img']);
  assert.ok(/QUOTE\(`a`\)/.test(h) && /QUOTE\(HEX\(`img`\)\)/.test(h) && /FROM `t`/.test(h));
  assert.strictEqual(RH.BASE_COMMIT, '8b273b5');
  assert.ok(!/(?:taskcalendar|taskmgr)`?\s*;?\s*$/m.test(RH.SEED_SQL.split('\n').filter((l) => /USE /i.test(l)).join('\n')), '시드가 다른 DB 를 고른다');
});
