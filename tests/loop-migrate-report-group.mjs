#!/usr/bin/env node
/**
 * loop-migrate-report-group.mjs: db/deploy/migrate-2026-10-06-category-report-group.sql 의 실 MySQL 증명.
 *
 *   개발 DB(TC_TEST_DB_NAME, 기본 taskcalendar)를 mysqldump 로 스크래치 DB `tc_mig_<seed>` 에 통째 복제하고
 *   (원본은 읽기만 한다), 그 복제본을 v12 로 강등한 뒤 마이그레이션을 실제로 두 번 적용해 본다.
 *
 *   절차(각 단계 PASS/FAIL 한 줄):
 *     0. 원본 확인(원본이 v13 이면 원본의 report_group 열 정의와 CHECK 도 information_schema 로 읽어 판정),
 *        복제(mysqldump → tc_mig_<seed>)
 *     1. v12 로 강등: CHECK chk_cal_category_rgroup DROP, 컬럼 report_group DROP, schema_version='12'
 *     2. 마이그레이션 1회차: 종료코드 0, schema_version 13, 컬럼 varchar(8)/NOT NULL/기본값 include/
 *        utf8mb4_bin/위치 uses_repo 다음, CHECK 존재, 기존 과제 행 전부 include(행 수 보존)
 *     3. 2회차(멱등): 종료코드 0, information_schema 행과 버전이 1회차와 같다
 *     4. v12 위젯 꼴 INSERT(컬럼 목록에 report_group 없음)가 성공하고 그 행이 include,
 *        CHECK 가 'ETC' 를 3819 로 거부한다
 *     5. 가드: schema_version 이 11 이면 파일이 중단(0 이 아닌 종료코드)하고 아무것도 바꾸지 않는다
 *     정리: DROP DATABASE tc_mig_<seed> (finally, Ctrl+C 포함)
 *
 *   종료코드: 0 전부 통과 · 1 하나라도 실패 · 2 판정 없음(비밀번호 없음, 접속 실패, 도구 없음 등)
 *
 *   ★ 비밀번호는 환경변수 TC_TEST_DB_ADMIN_PW 에서만 읽고 자식 프로세스 환경변수 MYSQL_PWD 로만 넘긴다.
 *     명령줄(-p…)과 파일에 남기지 않는다(프로세스 목록, 로그에 노출되지 않게).
 *
 *   CHECK_CLAUSE 판정: MySQL 8.4 는 (`report_group` in (_utf8mb4\'include\',_utf8mb4\'etc\')) 처럼 문자셋 소개자와
 *   역슬래시(mysql -B 출력)를 붙여 돌려준다. isReportGroupCheck 가 그것을 걷어낸 뒤 열 이름과 값 목록이 정확히
 *   report_group IN ('include','etc') 인지 본다(제약이 없거나 값이 다르거나 더 있으면 실패). --selftest 는 DB 없이
 *   이 판정만 알려진 문자열들로 시험한다.
 *
 *   실행(마스터, 개발 PC):
 *     $env:TC_TEST_DB_ADMIN_PW = <stdin 등으로 받은 값>
 *     node tests/loop-migrate-report-group.mjs [--seed=N] [--keep] [--verbose]
 *     node tests/loop-migrate-report-group.mjs --selftest   (DB 불필요)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const MIGRATION = join(REPO, 'db', 'deploy', 'migrate-2026-10-06-category-report-group.sql');

const OPT = {
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  mysqldump: process.env.TC_TEST_MYSQLDUMP || '',
  host: '127.0.0.1',
  port: 3306,
  db: process.env.TC_TEST_DB_NAME || 'taskcalendar',
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',
  seed: Number(String(process.pid) + String(Date.now() % 1000)),
  keep: false,
  verbose: false,
  selftest: false,
};
for (const a of process.argv.slice(2)) {
  let m;
  if ((m = /^--seed=(\d+)$/.exec(a))) OPT.seed = Number(m[1]);
  else if (a === '--keep') OPT.keep = true;
  else if (a === '--verbose' || a === '-v') OPT.verbose = true;
  else if (a === '--selftest') OPT.selftest = true;
  else if (a === '--help' || a === '-h') {
    console.log('사용법: node tests/loop-migrate-report-group.mjs [--seed=N] [--keep] [--verbose] [--selftest]\n' +
      '  환경변수: TC_TEST_DB_ADMIN_PW(필수) · TC_TEST_DB_NAME(기본 taskcalendar) · TC_TEST_MYSQL · TC_TEST_MYSQLDUMP');
    process.exit(0);
  } else { console.error('알 수 없는 인자: ' + a); process.exit(2); }
}
const MYSQLDUMP = OPT.mysqldump || join(dirname(OPT.mysql), process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump');
const SCRATCH = `tc_mig_${OPT.seed}`;

/* ── 판정 기록 ── */
let pass = 0, fail = 0;
let partial = false;   // 어떤 단계를 판정하지 못했다(→ 실패가 없으면 2)
const FAILED = [];
function check(name, cond, expected, got) {
  if (cond) { pass++; console.log(`PASS ${name}`); return true; }
  fail++; FAILED.push(name);
  console.log(`FAIL ${name}: expected ${expected}, got ${got}`);
  return false;
}
function noVerdict(msg) {
  console.log(`판정 없음: ${msg}`);
  cleanup();
  process.exit(2);
}

/* ── MySQL 계층(비밀번호는 env MYSQL_PWD 로만) ── */
const ENV = { ...process.env, MYSQL_PWD: OPT.adminPw };
const baseArgs = () => [`-u${OPT.adminUser}`, `-h${OPT.host}`, `-P${OPT.port}`, '--default-character-set=utf8mb4'];
const cleanErr = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim())
  .filter((l) => l && !/Using a password|Using environment variable MYSQL_PWD|MYSQL_PWD.*deprecated/i.test(l)).join(' | ');

/** stdin 으로 SQL 을 보낸다. 반환 {status, out, err}. */
function mysqlRaw(sqlText, { db = null, batch = true, timeout = 120000 } = {}) {
  const args = baseArgs().concat(batch ? ['-N', '-B'] : []);
  if (db) args.push('-D', db);
  const r = spawnSync(OPT.mysql, args, {
    input: Buffer.isBuffer(sqlText) ? sqlText : Buffer.from(sqlText, 'utf8'),
    env: ENV, windowsHide: true, timeout, maxBuffer: 512 * 1024 * 1024,
  });
  if (r.error) return { status: -1, out: '', err: r.error.message };
  return { status: r.status, out: (r.stdout || Buffer.alloc(0)).toString('utf8'), err: cleanErr((r.stderr || Buffer.alloc(0)).toString('utf8')) };
}
/** 읽기 질의. 실패하면 판정 없음. 결과 = 행 배열(탭 분리). */
const EOFM = '__TCEOF__';
function query(sqlText, db = SCRATCH, what = '질의') {
  for (let i = 1; i <= 3; i++) {
    const r = mysqlRaw(sqlText.replace(/\s*;?\s*$/, '') + `;\nSELECT '${EOFM}';\n`, { db });
    if (r.status !== 0) throw new Error(`${what} 실패: ${r.err}`);
    if (!r.out.includes(EOFM)) continue;   // mysql.exe 출력 잘림(loop-trash 의 실측 함정) → 읽기는 재시도
    return r.out.split(/\r?\n/).filter((l) => l.length && l !== EOFM).map((l) => l.split('\t'));
  }
  throw new Error(`${what}: 종결 마커를 3회 연속 받지 못했다(출력 잘림)`);
}
function exec(sqlText, db = SCRATCH, what = '실행') {
  const r = mysqlRaw(sqlText, { db });
  if (r.status !== 0) throw new Error(`${what} 실패: ${r.err}`);
  return r;
}

/* ── 정리 ── */
let created = false;
function cleanup() {
  if (!created) return;
  created = false;
  if (OPT.keep) { console.log(`[cleanup] --keep: 스크래치 DB \`${SCRATCH}\` 를 남깁니다(수동 DROP 필요).`); return; }
  const r = mysqlRaw(`DROP DATABASE IF EXISTS \`${SCRATCH}\`;`);
  if (r.status === 0) console.log(`[cleanup] 스크래치 DB \`${SCRATCH}\` DROP 완료`);
  else console.log(`[cleanup] DROP 실패(수동으로 DROP DATABASE \`${SCRATCH}\`;): ${r.err}`);
}
process.on('SIGINT', () => { cleanup(); process.exit(2); });

/* ── CHECK_CLAUSE 판정 ── */
/** 비교용 정규화: 역슬래시(mysql -B 이스케이프), 문자셋 소개자(_utf8mb4'...'), 백틱, 공백을 걷어낸다.
 *  대소문자는 그대로 둔다(열이 utf8mb4_bin 이라 'ETC' 와 'etc' 는 다른 값이다). */
function normCheckClause(s) {
  if (s == null) return null;
  return String(s).replace(/\\/g, '').replace(/(^|[(,\s])_[A-Za-z0-9]+(?=')/g, '$1').replace(/[`\s]/g, '');
}
/** 정규화한 CHECK 가 report_group IN ('include','etc') 와 같은가(값 순서 무관, 빠지거나 더 있거나 다르면 false). */
function isReportGroupCheck(s) {
  const n = normCheckClause(s);
  if (!n) return false;
  const m = /^\(*report_group[iI][nN]\(('[^']*'(?:,'[^']*')*)\)\)*$/.exec(n);
  if (!m) return false;
  const vals = m[1].split(',').map((v) => v.slice(1, -1));
  return vals.length === 2 && [...vals].sort().join(',') === 'etc,include';
}
function selftest() {
  const real = "(`report_group` in (_utf8mb4\\'include\\',_utf8mb4\\'etc\\'))";   // 개발 DB 에서 mysql -B 로 받은 실제 꼴
  const cases = [
    [real, true, '실제 MySQL 8.4 출력(소개자 + 역슬래시)'],
    ["(`report_group` in (_utf8mb4'include',_utf8mb4'etc'))", true, '역슬래시 없는 꼴'],
    ["(report_group IN ('include','etc'))", true, '소개자 없는 꼴'],
    ["(`report_group` in (_utf8mb4\\'etc\\',_utf8mb4\\'include\\'))", true, '값 순서만 다름'],
    [null, false, '제약 없음(null)'],
    ['', false, '빈 문자열'],
    ["(`report_group` in (_utf8mb4\\'include\\'))", false, 'include 하나뿐'],
    ["(`report_group` in (_utf8mb4\\'include\\',_utf8mb4\\'other\\'))", false, '다른 값'],
    ["(`report_group` in (_utf8mb4\\'include\\',_utf8mb4\\'etc\\',_utf8mb4\\'x\\'))", false, '값이 더 있음'],
    ["(`report_group` in (_utf8mb4\\'include\\',_utf8mb4\\'ETC\\'))", false, "대문자 'ETC'"],
    ["(`report_group` in (_utf8mb4\\'include\\',_utf8mb4\\'include\\'))", false, '같은 값 두 번'],
    ["(`source` in (_utf8mb4\\'include\\',_utf8mb4\\'etc\\'))", false, '다른 열'],
    ["(`report_group` <> _utf8mb4\\'include\\')", false, 'IN 이 아닌 식'],
  ];
  for (const [input, want, label] of cases) {
    const got = isReportGroupCheck(input);
    check(`selftest isReportGroupCheck: ${label}`, got === want, want, `${got} (${normCheckClause(input)})`);
  }
  // 옛 판정(/'include'/ 단순 test)이 실제 꼴을 놓쳤다는 기록(QA r1 Q10). 판정에는 쓰지 않는다.
  console.log(`참고: 옛 판정 /'include'/.test(실제 꼴) = ${/'include'/.test(real)}`);
}

/* ── 스냅샷: 컬럼 정의 + CHECK + 버전(db 기본 = 스크래치) ── */
function snapshot(db = SCRATCH) {
  const col = query(
    "SELECT COLUMN_TYPE, IS_NULLABLE, IFNULL(COLUMN_DEFAULT,'~'), IFNULL(COLLATION_NAME,'~'), ORDINAL_POSITION, " +
    "(SELECT ORDINAL_POSITION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cal_category' AND COLUMN_NAME='uses_repo') " +
    "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cal_category' AND COLUMN_NAME='report_group'",
    db, '컬럼 정의 조회');
  const chk = query(
    "SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='chk_cal_category_rgroup'",
    db, 'CHECK 조회');
  const ver = query("SELECT v FROM cal_schema_meta WHERE k='schema_version'", db, '버전 조회');
  return {
    col: col[0] ? { type: col[0][0], nullable: col[0][1], def: col[0][2], coll: col[0][3], pos: Number(col[0][4]), usesRepoPos: Number(col[0][5]) } : null,
    check: chk[0] ? chk[0][0] : null,
    version: ver[0] ? ver[0][0] : null,
  };
}

function applyMigration() {
  const text = readFileSync(MIGRATION);
  return mysqlRaw(text, { db: SCRATCH, batch: true, timeout: 120000 });
}

async function main() {
  if (OPT.selftest) { selftest(); return; }
  if (!OPT.adminPw) noVerdict('TC_TEST_DB_ADMIN_PW 가 비었습니다(환경변수로만 받습니다)');
  if (!existsSync(OPT.mysql)) noVerdict('mysql.exe 를 찾을 수 없습니다: ' + OPT.mysql);
  if (!existsSync(MYSQLDUMP)) noVerdict('mysqldump 를 찾을 수 없습니다: ' + MYSQLDUMP);
  if (!existsSync(MIGRATION)) noVerdict('마이그레이션 파일이 없습니다: ' + MIGRATION);
  if (!/^tc_mig_\d+$/.test(SCRATCH) || SCRATCH === OPT.db) noVerdict('스크래치 DB 이름이 안전 규칙(tc_mig_<숫자>, 원본과 다름)을 어겼다: ' + SCRATCH);

  // 0. 원본 확인 + 복제
  let src;
  try {
    src = query(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${OPT.db}' AND TABLE_NAME IN ('cal_category','cal_schema_meta')`, null, '원본 확인');
  } catch (e) { noVerdict('DB 접속 실패: ' + e.message); }
  if (Number(src[0][0]) !== 2) noVerdict(`원본 ${OPT.db} 에 cal_category/cal_schema_meta 가 없습니다`);
  // 0-1. 원본(재구축된 개발 DB)의 열 정의를 information_schema 로 읽기만 한다. v13 이면 정의 전체를 판정한다.
  const so = snapshot(OPT.db);
  if (so.version === '13') {
    const c = so.col;
    check('원본 v13: report_group varchar(8)/NOT NULL/include/utf8mb4_bin/uses_repo 다음',
      !!c && c.type === 'varchar(8)' && c.nullable === 'NO' && c.def === 'include' && c.coll === 'utf8mb4_bin' && c.pos === c.usesRepoPos + 1,
      'varchar(8)/NO/include/utf8mb4_bin/' + (c ? c.usesRepoPos + 1 : '?'),
      c ? `${c.type}/${c.nullable}/${c.def}/${c.coll}/${c.pos}` : '열 없음');
    check("원본 v13: CHECK chk_cal_category_rgroup = report_group IN ('include','etc')", isReportGroupCheck(so.check),
      "IN ('include','etc')", so.check);
  } else if (so.version === '12') {
    console.log(`참고: 원본 ${OPT.db} 는 아직 v12 라 원본 열 판정은 하지 않습니다(복제본으로 마이그레이션만 시험)`);
  } else {
    check('원본 schema_version 이 12 또는 13', false, '12 또는 13', so.version);
  }
  console.log(`원본 ${OPT.db} → 스크래치 ${SCRATCH} 복제(mysqldump, 원본은 읽기만)`);
  const d = spawnSync(MYSQLDUMP, baseArgs().concat(['--no-tablespaces', '--single-transaction', '--skip-lock-tables', '--set-gtid-purged=OFF', OPT.db]),
    { env: ENV, windowsHide: true, timeout: 300000, maxBuffer: 1024 * 1024 * 1024 });
  if (d.error || d.status !== 0) noVerdict('mysqldump 실패: ' + (d.error ? d.error.message : cleanErr((d.stderr || Buffer.alloc(0)).toString('utf8'))));
  const mk = mysqlRaw(`DROP DATABASE IF EXISTS \`${SCRATCH}\`; CREATE DATABASE \`${SCRATCH}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`);
  if (mk.status !== 0) noVerdict('스크래치 DB 생성 실패: ' + mk.err);
  created = true;
  const ld = mysqlRaw(d.stdout, { db: SCRATCH, batch: false, timeout: 300000 });
  if (ld.status !== 0) noVerdict('복제본 적재 실패: ' + ld.err);

  // 1. v12 로 강등
  const pre = snapshot();
  console.log(`복제본 원래 상태: schema_version=${pre.version}, report_group=${pre.col ? '있음' : '없음'}, CHECK=${pre.check ? '있음' : '없음'}`);
  const down = [];
  if (pre.check) down.push('ALTER TABLE cal_category DROP CHECK chk_cal_category_rgroup;');
  if (pre.col) down.push('ALTER TABLE cal_category DROP COLUMN report_group;');
  down.push("UPDATE cal_schema_meta SET v='12' WHERE k='schema_version';");
  exec(down.join('\n'), SCRATCH, 'v12 강등');
  const v12 = snapshot();
  const nCat = Number(query('SELECT COUNT(*) FROM cal_category', SCRATCH, '과제 수')[0][0]);
  check('강등: schema_version=12, report_group 없음, CHECK 없음', v12.version === '12' && !v12.col && !v12.check,
    '12/없음/없음', `${v12.version}/${v12.col ? '있음' : '없음'}/${v12.check ? '있음' : '없음'}`);
  console.log(`강등된 복제본의 과제 행: ${nCat}개`);

  // 2. 1회차
  const r1 = applyMigration();
  if (OPT.verbose) console.log(r1.out);
  check('1회차 적용: 종료코드 0', r1.status === 0, 0, `${r1.status} ${r1.err}`);
  const s1 = snapshot();
  check('1회차: schema_version 13', s1.version === '13', '13', s1.version);
  check('1회차: 컬럼 타입 varchar(8)', !!s1.col && s1.col.type === 'varchar(8)', 'varchar(8)', s1.col && s1.col.type);
  check('1회차: NOT NULL', !!s1.col && s1.col.nullable === 'NO', 'NO', s1.col && s1.col.nullable);
  check('1회차: 기본값 include', !!s1.col && s1.col.def === 'include', 'include', s1.col && s1.col.def);
  check('1회차: 콜레이션 utf8mb4_bin', !!s1.col && s1.col.coll === 'utf8mb4_bin', 'utf8mb4_bin', s1.col && s1.col.coll);
  check('1회차: 위치 = uses_repo 다음', !!s1.col && s1.col.pos === s1.col.usesRepoPos + 1,
    s1.col ? s1.col.usesRepoPos + 1 : '?', s1.col && s1.col.pos);
  check("1회차: CHECK chk_cal_category_rgroup = report_group IN ('include','etc')", isReportGroupCheck(s1.check),
    "IN ('include','etc')", s1.check);
  const rows1 = query("SELECT COUNT(*), SUM(report_group='include') FROM cal_category", SCRATCH, '백필 확인')[0];
  check('1회차: 기존 과제 행 전부 include(행 수 보존)', Number(rows1[0]) === nCat && Number(rows1[1] || 0) === nCat,
    `${nCat}/${nCat}`, `${rows1[0]}/${rows1[1]}`);

  // 3. 2회차(멱등)
  const r2 = applyMigration();
  check('2회차 적용(멱등): 종료코드 0', r2.status === 0, 0, `${r2.status} ${r2.err}`);
  const s2 = snapshot();
  check('2회차: information_schema 행과 버전이 1회차와 같다', JSON.stringify(s2) === JSON.stringify(s1), JSON.stringify(s1), JSON.stringify(s2));
  const rows2 = query("SELECT COUNT(*), SUM(report_group='include') FROM cal_category", SCRATCH, '2회차 행')[0];
  check('2회차: 과제 행 수와 값이 그대로', rows2[0] === rows1[0] && rows2[1] === rows1[1], rows1.join('/'), rows2.join('/'));

  // 4. v12 위젯 꼴 INSERT
  const u = query('SELECT MIN(user_id) FROM app_user', SCRATCH, '사용자 조회')[0][0];
  if (!u || u === 'NULL') {
    console.log('판정 없음: app_user 가 비어 v12 꼴 INSERT 를 시험할 수 없습니다');
    partial = true;
    return;
  }
  const no = Number(query(`SELECT IFNULL(MAX(cat_no),0)+1 FROM cal_category WHERE user_id=${Number(u)}`, SCRATCH, '번호')[0][0]);
  const uid = `c-migprobe-${OPT.seed}`;
  const ins = mysqlRaw(
    'INSERT INTO cal_category (user_id,cat_no,uid,source,name,color,description,project_uid,uses_repo,sort_order,created_at,updated_at) ' +
    `VALUES (${Number(u)},${no},'${uid}','local','마이그레이션 시험','#5b6b7d','',NULL,0,9999,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));`, { db: SCRATCH });
  check('v12 꼴 INSERT(report_group 없는 컬럼 목록)가 성공한다', ins.status === 0, 0, `${ins.status} ${ins.err}`);
  const got = query(`SELECT report_group FROM cal_category WHERE user_id=${Number(u)} AND uid='${uid}'`, SCRATCH, '새 행');
  check("v12 꼴 INSERT 의 행이 'include'", got[0] && got[0][0] === 'include', 'include', got[0] && got[0][0]);
  const bad = mysqlRaw(`UPDATE cal_category SET report_group='ETC' WHERE user_id=${Number(u)} AND uid='${uid}';`, { db: SCRATCH });
  check("CHECK 가 'ETC' 를 거부한다(ERROR 3819)", bad.status !== 0 && /3819/.test(bad.err), 'ERROR 3819', `${bad.status} ${bad.err}`);

  // 5. 가드: 11 이면 중단하고 아무것도 바꾸지 않는다
  exec("UPDATE cal_schema_meta SET v='11' WHERE k='schema_version';", SCRATCH, '가드 준비');
  const r3 = applyMigration();
  const s3 = snapshot();
  check('가드: schema_version 11 이면 중단(종료코드 0 아님, 중단 문구)', r3.status !== 0 && /중단|1146/.test(r3.err), '0 아님 + 중단', `${r3.status} ${r3.err}`);
  check('가드: 중단 뒤 버전이 11 그대로', s3.version === '11', '11', s3.version);
}

let code = 0;
try {
  await main();
  console.log(`\n통과 ${pass} · 실패 ${fail}` + (FAILED.length ? '\n실패 목록: ' + FAILED.join(' | ') : ''));
  code = fail ? 1 : partial ? 2 : 0;
} catch (e) {
  console.log('판정 없음: ' + (e && e.message ? e.message : String(e)));
  code = 2;
} finally {
  cleanup();
}
process.exit(code);
