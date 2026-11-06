#!/usr/bin/env node
// =====================================================================================
//  tools/db-rehearsal/rehearse-v22.mjs: DB 구조 22 이관 조각의 MySQL 8.4 실제 리허설(개발 PC 전용, 외부 의존 없음)
//  docs/DB-V22-REPORT-HOURS.md 3 "개발 PC MySQL 8.4 실제 리허설 필수".
//
//  왜 있나
//    tests/release-sql.test.mjs 의 흉내 실행은 FK 받침 색인, CHECK 이름, INSTANT 같은 MySQL 의 실제 규칙을 다 잡지 못한다.
//    이 스크립트는 구조 21 원본 DB 를 일회용 DB(tc_rh_v22_*)로 복사해 실제 release SQL 을 돌린다. 원본은 읽기(mysqldump)만 한다.
//
//  하는 일(모두 일회용 DB 에서. 끝나면 지운다)
//    (a) 처음: 원본 복사 → release SQL 전체(installer/release-sql.ps1 로 임시 폴더에 조립) → 구조 22, 열림, 검증 통과,
//        일간 옛 줄 0, 지울 표 셋 없음, 주간 줄 수 그대로. 주간 줄 cat_uid 채우기 수를 보여 준다.
//    (b) 다시: 같은 DB 에 같은 SQL 을 다시 → information_schema 와 데이터, cal_schema_meta(updated_at 포함)가 그대로.
//    (c) 끊기: v22 조각의 바꾸는 문장 경계마다 새 복사본에 (닫기까지의 release SQL + 조각의 그 경계까지) 를 돌리고 끊은 뒤,
//        release SQL 전체를 다시 → (a) 와 같은 information_schema 와 데이터.
//    (d) 새로 깔기: 원본 구조만(--no-data) 복사한 DB 에 정본 db/deploy/schema-calendar.sql 을 돌려 (a) 와 information_schema 를 견준다
//        (칸 순서, 형, NULL, 기본값, 콜레이션, 설명, 색인과 칸 순서, FK 와 규칙, CHECK 글, 표 설명).
//        v22 가 바꾸는 표 셋은 다르면 실패, 그 밖의 정본 표는 다르면 경고(원본 DB 의 옛 차이라 v22 탓이 아니다).
//
//  실행(PM 이 개발 PC 에서. 운영 서버에 돌리지 않는다)
//    PowerShell:  $env:TC_DB_PW = '<root 비밀번호>'; node tools\db-rehearsal\rehearse-v22.mjs [원본DB=taskcalendar] [--host 127.0.0.1] [--port 3306] [--user root] [--keep] [--only a,b,c,d]
//    비밀번호는 환경 변수 TC_DB_PW 에서만 읽고, 자식 mysql.exe 에는 환경 변수 MYSQL_PWD 로만 넘긴다.
//    명령줄, 파일, 화면 어디에도 비밀번호를 쓰지 않는다. 조립한 release SQL 과 덤프는 OS 임시 폴더에 두고 끝나면 지운다.
//    종료코드: 0 모두 통과, 1 실패가 있음, 2 준비 실패(환경, 인자, 원본 구조 번호가 21 이 아님).
// =====================================================================================
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MYSQL_BIN = process.env.TC_MYSQL_BIN || 'C:/Program Files/MySQL/MySQL Server 8.4/bin';
const FRAG_NAME = 'v22-report-hours.sql';
export const PREFIX = 'tc_rh_v22_';
//  v22 가 바꾸는 표(다르면 실패)와 지우는 표
export const V22_TABLES = ['cal_report_hours', 'cal_report_daily', 'cal_report_weekly_hours'];
export const OLD_TABLES = ['cal_task_hours', 'cal_migration_log', 'cal_user_pref'];

// ── 순수 함수(tests/db-v22.test.mjs 가 단위 시험한다) ─────────────────────────────

//  일회용 DB 이름만 만들고 지운다. 이 모양이 아니면 어떤 DROP 도 하지 않는다.
export function isThrowawayName(n) { return typeof n === 'string' && /^tc_rh_v22_[a-z0-9_]{1,40}$/.test(n); }

//  인자 읽기
export function parseArgs(argv) {
  const o = { source: 'taskcalendar', host: '127.0.0.1', port: '3306', user: 'root', keep: false, only: new Set(['a', 'b', 'c', 'd']) };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === '--keep') o.keep = true;
    else if (a === '--host' || a === '--port' || a === '--user') { const v = rest.shift(); if (!v) throw new Error(`${a} 뒤에 값이 없다`); o[a.slice(2)] = v; }
    else if (a === '--only') { const v = rest.shift() || ''; o.only = new Set(v.split(',').map((x) => x.trim()).filter(Boolean)); }
    else if (a.startsWith('--')) throw new Error(`모르는 인자: ${a}`);
    else o.source = a;
  }
  if (!/^[A-Za-z0-9_]{1,64}$/.test(o.source)) throw new Error(`원본 DB 이름이 이상하다: ${o.source}`);
  if (o.source.startsWith(PREFIX)) throw new Error('원본 DB 가 일회용 DB 이름이다');
  if (!/^\d{1,5}$/.test(o.port)) throw new Error(`포트가 이상하다: ${o.port}`);
  if (!/^[A-Za-z0-9_.-]{1,255}$/.test(o.host) || !/^[A-Za-z0-9_.@-]{1,64}$/.test(o.user)) throw new Error('호스트나 사용자 이름이 이상하다');
  for (const k of o.only) if (!['a', 'b', 'c', 'd'].includes(k)) throw new Error(`--only 는 a,b,c,d 중에서: ${k}`);
  return o;
}

//  SQL 을 문장으로 나눈다(줄 주석 --, 작은따옴표와 백틱 안의 ; 는 자르지 않는다. '' 와 `` 는 이스케이프). release SQL 이 쓰는 문법만.
export function splitStatements(sql) {
  const out = [];
  let cur = '';
  for (let i = 0; i < sql.length;) {
    const c = sql[i];
    if (c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === "'" || c === '`') {
      let k = i + 1;
      while (k < sql.length) { if (sql[k] === c && sql[k + 1] === c) { k += 2; continue; } if (sql[k] === c) break; k++; }
      cur += sql.slice(i, k + 1); i = k + 1; continue;
    }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

//  release SQL 안에서 조각 하나의 본문 위치(조립기 release-sql.ps1 이 붙이는 머리, 꼬리 줄 사이)
export function fragmentSpan(releaseSql, name) {
  const head = new RegExp(`^-- ---------- 조각 ${name.replace(/[.]/g, '\\.')} \\(\\d+ 에서 \\d+\\) ----------$`, 'm').exec(releaseSql);
  const tail = releaseSql.indexOf(`-- ---------- 조각 ${name} 끝 ----------`);
  if (!head || tail < 0 || tail < head.index) throw new Error(`release SQL 에서 조각 ${name} 을 찾지 못했다`);
  const start = head.index + head[0].length + 1;
  return { start, end: tail, body: releaseSql.slice(start, tail) };
}

//  끊을 경계: 조각의 바꾸는 단계(PREPARE _s ... DEALLOCATE PREPARE _s) 하나가 끝난 자리와 COMMIT 뒤.
//  돌려주는 값은 "앞에서부터 이만큼의 문장을 돌린 뒤 끊는다" 의 문장 수 목록이다(트랜잭션 안에서 끊긴 연결은 되돌려진다).
export function stepBoundaries(stmts) {
  const out = [];
  stmts.forEach((s, i) => { if (s === 'DEALLOCATE PREPARE _s' || s === 'COMMIT') out.push(i + 1); });
  return [...new Set(out)];
}

//  끊긴 실행의 SQL: 조각 앞의 release SQL 전부(확인, 닫기, 앞 조각들) + 조각의 앞 n 문장
export function prefixSql(releaseSql, span, stmts, n) {
  return releaseSql.slice(0, span.start) + '\n' + stmts.slice(0, n).map((s) => s + ';').join('\n') + '\n';
}

//  information_schema 서명 둘을 견준다. 서명은 { 표 이름: { 구역: [줄...] } }. 다른 곳을 사람이 읽는 줄로 돌려준다.
export function diffSignatures(a, b, tables) {
  const out = [];
  for (const t of tables) {
    const x = a[t], y = b[t];
    if (!x && !y) continue;
    if (!x || !y) { out.push(`${t}: 한쪽에만 있다(${x ? '앞' : '뒤'})`); continue; }
    for (const part of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const p = (x[part] || []).join('\n'), q = (y[part] || []).join('\n');
      if (p !== q) {
        const xs = x[part] || [], ys = y[part] || [];
        const only1 = xs.filter((l) => !ys.includes(l)), only2 = ys.filter((l) => !xs.includes(l));
        out.push(`${t}.${part}: ` + (only1.length || only2.length ? `앞에만 [${only1.join(' | ')}] 뒤에만 [${only2.join(' | ')}]` : '순서가 다르다'));
      }
    }
  }
  return out;
}

//  mysql --batch 출력(탭 구분, 줄마다 한 행)을 서명으로 묶는다. 첫 칸이 표 이름, 둘째 칸이 구역.
export function groupSignature(text) {
  const sig = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const [t, part, ...rest] = line.split('\t');
    ((sig[t] ||= {})[part] ||= []).push(rest.join('\t'));
  }
  return sig;
}

//  정본에서 CREATE TABLE 하는 표 이름(비교 대상)
export function canonTables(canonSql) { return [...canonSql.matchAll(/^CREATE TABLE (\w+) \(/gm)].map((m) => m[1]); }

//  information_schema 서명 질의(현재 DB). 표 이름, 구역, 값들. 순서를 고정한다.
export const SIGNATURE_SQL = [
  "SELECT TABLE_NAME, 'table', ENGINE, TABLE_COLLATION, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
  "SELECT TABLE_NAME, 'column', ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, IFNULL(COLUMN_DEFAULT, '<NULL>'), IFNULL(CHARACTER_SET_NAME, '-'), IFNULL(COLLATION_NAME, '-'), EXTRA, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION",
  "SELECT TABLE_NAME, 'index', INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, IFNULL(SUB_PART, '-') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
  "SELECT k.TABLE_NAME, 'fk', k.CONSTRAINT_NAME, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION SEPARATOR ','), r.REFERENCED_TABLE_NAME, GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION SEPARATOR ','), r.UPDATE_RULE, r.DELETE_RULE "
    + 'FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME '
    + 'WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL GROUP BY k.TABLE_NAME, k.CONSTRAINT_NAME, r.REFERENCED_TABLE_NAME, r.UPDATE_RULE, r.DELETE_RULE ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME',
  "SELECT t.TABLE_NAME, 'check', t.CONSTRAINT_NAME, c.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME "
    + "WHERE t.TABLE_SCHEMA = DATABASE() AND t.CONSTRAINT_TYPE = 'CHECK' ORDER BY t.TABLE_NAME, t.CONSTRAINT_NAME",
].join(';\n') + ';\n';

//  데이터 지문(같은 결과인지 보려고). 주간 줄은 과제 id 까지, 일간 줄은 줄 수, 메타는 키와 값.
export const DATA_SQL = [
  "SELECT 'weekly_hours', COUNT(*), IFNULL(SUM(CRC32(CONCAT_WS('|', user_id, period_start, line_no, task_name, IFNULL(cat_uid, '-'), IFNULL(project_uid, '-'), hours))), 0) FROM cal_report_weekly_hours",
  "SELECT 'report_hours', COUNT(*) FROM cal_report_hours",
  "SELECT 'report_daily', COUNT(*), IFNULL(SUM(memo IS NULL), 0) FROM cal_report_daily",
  "SELECT 'meta', GROUP_CONCAT(CONCAT(k, '=', v) ORDER BY k SEPARATOR ',') FROM cal_schema_meta",
].join(';\n') + ';\n';

// ── MySQL 실행 ───────────────────────────────────────────────────────────────────
function makeRunner(o, pw) {
  const env = { ...process.env, MYSQL_PWD: pw };
  delete env.TC_DB_PW;   // 자식에는 MYSQL_PWD 로만 넘긴다
  const base = ['--host', o.host, '--port', o.port, '--user', o.user, '--default-character-set=utf8mb4'];
  const mysql = join(MYSQL_BIN, 'mysql.exe'), dump = join(MYSQL_BIN, 'mysqldump.exe');
  const run = (db, sql, { batch = true } = {}) => {
    const args = [...base, ...(batch ? ['--batch', '--skip-column-names'] : []), ...(db ? [db] : [])];
    const r = spawnSync(mysql, args, { input: Buffer.from(sql, 'utf8'), env, maxBuffer: 1 << 30, windowsHide: true });
    if (r.error) throw new Error(`mysql.exe 를 실행하지 못했다: ${r.error.message}`);
    return { code: r.status, out: (r.stdout || Buffer.alloc(0)).toString('utf8'), err: (r.stderr || Buffer.alloc(0)).toString('utf8').trim() };
  };
  const must = (db, sql, what) => {
    const r = run(db, sql);
    if (r.code !== 0) throw new Error(`${what} 실패: ${r.err.split('\n').slice(-3).join(' / ')}`);
    return r.out;
  };
  const dumpDb = (db, noData) => {
    const args = [...base, '--single-transaction', '--no-tablespaces', '--set-gtid-purged=OFF', '--triggers', '--routines', '--hex-blob', '--skip-comments', ...(noData ? ['--no-data'] : []), db];
    const r = spawnSync(dump, args, { env, maxBuffer: 1 << 30, windowsHide: true });
    if (r.error) throw new Error(`mysqldump.exe 를 실행하지 못했다: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`mysqldump 실패: ${(r.stderr || '').toString('utf8').trim().split('\n').slice(-3).join(' / ')}`);
    return r.stdout.toString('utf8');
  };
  return { run, must, dumpDb };
}

// ── 본체 ────────────────────────────────────────────────────────────────────────
//  한 줄짜리 결과(여러 칸)를 숫자 목록으로. mysql --batch 는 칸을 탭으로 나눈다(값 안의 탭은 \t 로 바뀌어 섞이지 않는다).
const cells = (out) => out.trim().split('\t');
//  끊은 자리 이름: 경계 바로 앞의 바꾸는 단계(SET @s := ...) 머리 글자
export function boundaryLabel(stmts, n) {
  for (let i = n - 1; i >= 0; i--) if (/^SET @s := /.test(stmts[i])) return stmts[i].replace(/\s+/g, ' ').slice(0, 70);
  return `문장 ${n}`;
}

async function body(o, ctx) {
  const { run, must, dumpDb, pass, fail, warn, check, createDb, dropDb, tmp } = ctx;
  const q1 = (db, sql) => must(db, sql, '질의').trim();
  const signature = (db) => groupSignature(must(db, SIGNATURE_SQL, `${db} 서명`));
  const data = (db) => must(db, DATA_SQL, `${db} 데이터 지문`).trim();
  const meta = (db) => q1(db, 'SELECT k, v, updated_at FROM cal_schema_meta ORDER BY k;');
  const lastErr = (r, n = 3) => r.err.split('\n').slice(-n).join(' / ');

  console.log(`v22 리허설: 원본 ${o.source} (${o.user}@${o.host}:${o.port}), 일회용 DB 접두 ${PREFIX}`);
  //  지난 실행이 남긴 일회용 DB 를 먼저 지운다(접두가 같은 것만)
  for (const n of q1(null, "SHOW DATABASES LIKE 'tc\\_rh\\_v22\\_%';").split(/\r?\n/).filter(Boolean)) dropDb(n);

  //  원본 확인(읽기만): 구조 번호 21, 사전 조회 수(docs/DB-V22-REPORT-HOURS.md 배포와 운영의 폐쇄망 사전 조회와 같은 것)
  const srcVer = q1(o.source, "SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version';");
  if (srcVer !== '21') { console.error(`X 원본 ${o.source} 의 구조 번호가 21 이 아니다([${srcVer}]). 구조 21 사본에서만 리허설한다.`); return 2; }
  const sameName = (op) => "(SELECT COUNT(*) FROM cal_report_weekly_hours h WHERE h.project_uid IS NULL AND (SELECT COUNT(*) FROM cal_category c WHERE c.user_id = h.user_id AND c.source = 'local' "
    + `AND c.name COLLATE utf8mb4_bin = h.task_name COLLATE utf8mb4_bin) ${op})`;
  const pre = cells(q1(o.source, 'SELECT (SELECT COUNT(*) FROM cal_report_hours), (SELECT COUNT(*) FROM cal_report_hours WHERE cat_no IS NOT NULL), '
    + '(SELECT COUNT(*) FROM cal_report_weekly_hours), (SELECT COUNT(*) FROM cal_report_weekly_hours WHERE project_uid IS NOT NULL), '
    + `${sameName('= 1')}, ${sameName('> 1')}, ` + OLD_TABLES.map((t) => `(SELECT COUNT(*) FROM ${t})`).join(', ') + ';')).map(Number);
  const [crh0, crhCat0, wk0, wkDb0, wkLocal1, wkLocalN, ...old0] = pre;
  console.log(`원본 사전 조회: cal_report_hours ${crh0}줄(cat_no 찬 줄 ${crhCat0}), 주간 줄 ${wk0}(공식 과제 ${wkDb0}, 이름이 같은 개인 과제 하나 ${wkLocal1}, 둘 이상 ${wkLocalN}), `
    + OLD_TABLES.map((t, i) => `${t} ${old0[i]}줄`).join(', '));

  //  release SQL 조립(임시 폴더. dist 에 쓰지 않는다). 감싸개(확인, 닫기, 끝 확인, 열기)까지 운영과 같은 파일이다.
  const app = Number(/public const int AppStructureVersion = (\d+);/.exec(readFileSync(join(ROOT, 'widget', 'DbGate.cs'), 'utf8'))[1]);
  const relPath = join(tmp, 'release-rehearsal.sql');
  const g = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'installer', 'release-sql.ps1'),
    '-FragmentDir', join(ROOT, 'db', 'deploy', 'migrations'), '-Structure', String(app), '-Version', '0.0.0', '-InstallerFile', 'TaskCalendarWidget-Setup-v0.0.0-rehearsal.exe',
    '-Sha256', '0'.repeat(64), '-Notes', 'v22 rehearsal', '-OutFile', relPath, '-Stamp', 'rehearsal'], { encoding: 'utf8', windowsHide: true });
  if (g.status !== 0 || !existsSync(relPath)) { console.error(`X release SQL 을 조립하지 못했다(exit ${g.status}): ${(g.stdout || '') + (g.stderr || '')}`); return 2; }
  const rel = readFileSync(relPath, 'utf8');
  const span = fragmentSpan(rel, FRAG_NAME);
  const fragStmts = splitStatements(span.body);
  const bounds = stepBoundaries(fragStmts);
  console.log(`release SQL: 구조 ${app}, v22 조각 문장 ${fragStmts.length}개, 끊을 경계 ${bounds.length}곳`);

  const dumpAll = dumpDb(o.source, false);
  const loadCopy = (n) => { createDb(n); must(n, dumpAll, `${n} 에 원본 붓기`); };

  //  (a) 처음
  const A = PREFIX + 'a';
  loadCopy(A);
  const ra = run(A, rel);
  if (ra.code !== 0) { fail('(a) 처음 돌리기', lastErr(ra)); return 1; }
  const metaA = cells(q1(A, "SELECT (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version'), (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');"));
  check(metaA[0] === '22' && metaA[1] === '0', '(a) 구조 번호 22, 열림(db_updating 0)', `[${metaA.join(', ')}]`);
  const [crh1, wk1, wkDb1, wkLocal1b, wkNull1, wkDbOk, oldLeft, memoSet] = cells(q1(A, 'SELECT (SELECT COUNT(*) FROM cal_report_hours), (SELECT COUNT(*) FROM cal_report_weekly_hours), '
    + "(SELECT COUNT(*) FROM cal_report_weekly_hours WHERE cat_uid LIKE 'db-%'), (SELECT COUNT(*) FROM cal_report_weekly_hours WHERE cat_uid IS NOT NULL AND cat_uid NOT LIKE 'db-%'), "
    + "(SELECT COUNT(*) FROM cal_report_weekly_hours WHERE cat_uid IS NULL), (SELECT COUNT(*) FROM cal_report_weekly_hours WHERE project_uid IS NOT NULL AND cat_uid <=> CONCAT('db-', project_uid)), "
    + `(SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${OLD_TABLES.map((t) => `'${t}'`).join(', ')})), `
    + '(SELECT COUNT(*) FROM cal_report_daily WHERE memo IS NOT NULL);')).map(Number);
  console.log(`  주간 줄 채우기: 전 ${wk0}줄, 뒤 ${wk1}줄(공식 과제 id ${wkDb1}, 개인 과제 id ${wkLocal1b}, 빈 줄 ${wkNull1})`);
  check(crh1 === 0, '(a) 일간 옛 줄 0', `${crh1}줄 남음`);
  check(wk1 === wk0, '(a) 주간 줄 수가 바뀌기 전과 같다', `${wk0} 에서 ${wk1}`);
  check(wkDb1 === wkDb0 && wkDbOk === wkDb0, '(a) 공식 과제 줄은 모두 db-<project_uid>', `공식 ${wkDb0}, 채움 ${wkDb1}, 맞음 ${wkDbOk}`);
  check(wkLocal1b === wkLocal1, '(a) 개인 과제 줄은 이름이 글자까지 같은 개인 과제가 하나뿐일 때만 채운다', `기대 ${wkLocal1}, 채움 ${wkLocal1b}`);
  check(oldLeft === 0, '(a) 지울 표 셋이 없다', `${oldLeft}개 남음`);
  check(memoSet === 0, '(a) 있던 일간보고의 memo 는 NULL(옛 보고)', `${memoSet}줄이 NULL 이 아니다`);
  const sigA = signature(A), dataA = data(A);
  const allTables = Object.keys(sigA).sort();

  //  (b) 다시
  if (o.only.has('b')) {
    const metaBefore = meta(A);
    const rb = run(A, rel);
    if (rb.code !== 0) fail('(b) 다시 돌리기', lastErr(rb));
    else {
      const d = diffSignatures(sigA, signature(A), allTables);
      check(d.length === 0, '(b) 다시 돌려도 information_schema 가 그대로', d.slice(0, 5).join(' ; '));
      check(data(A) === dataA, '(b) 다시 돌려도 데이터가 그대로', '데이터 지문이 다르다');
      check(meta(A) === metaBefore, '(b) 다시 돌려도 cal_schema_meta(updated_at 포함)가 그대로', '메타 행이 바뀌었다');
    }
  }

  //  (c) 경계마다 끊고 다시. 끊긴 연결의 열린 트랜잭션은 MySQL 이 되돌린다(운영에서 Workbench 가 오류로 멈춘 것과 같다).
  if (o.only.has('c')) {
    let okAll = true;
    for (const n of bounds) {
      const C = PREFIX + 'c';
      const where = `경계 ${n}(${boundaryLabel(fragStmts, n)})`;
      loadCopy(C);
      const r1 = run(C, prefixSql(rel, span, fragStmts, n));
      const r2 = r1.code === 0 ? run(C, rel) : null;
      if (r1.code !== 0) { fail(`(c) ${where}: 끊기 전 실행`, lastErr(r1, 2)); okAll = false; }
      else if (r2.code !== 0) { fail(`(c) ${where}: 다시 돌리기`, lastErr(r2, 2)); okAll = false; }
      else {
        const d = diffSignatures(sigA, signature(C), allTables);
        const sameData = data(C) === dataA;
        if (d.length || !sameData) { fail(`(c) ${where}: (a) 와 다르다`, d.slice(0, 3).join(' ; ') + (sameData ? '' : ' 데이터 지문이 다르다')); okAll = false; }
      }
      dropDb(C);
    }
    if (okAll) pass(`(c) 경계 ${bounds.length}곳 모두 끊은 뒤 다시 돌리면 (a) 와 같다`);
  }

  //  (d) 정본으로 새로 깐 DB 와 견주기(원본의 다른 표 구조를 --no-data 로 옮긴 뒤 schema-calendar.sql 을 그대로 돌린다)
  if (o.only.has('d')) {
    const N = PREFIX + 'canon';
    createDb(N);
    must(N, dumpDb(o.source, true), `${N} 에 원본 구조 붓기`);
    const canonText = readFileSync(join(ROOT, 'db', 'deploy', 'schema-calendar.sql'), 'utf8');
    const rd = run(N, canonText);
    if (rd.code !== 0) fail('(d) 정본 schema-calendar.sql 돌리기', lastErr(rd));
    else {
      const sigN = signature(N);
      const d22 = diffSignatures(sigA, sigN, V22_TABLES);
      check(d22.length === 0, `(d) v22 표 셋(${V22_TABLES.join(', ')})이 정본으로 새로 깐 것과 같다`, d22.join(' ; '));
      const others = diffSignatures(sigA, sigN, canonTables(canonText).filter((t) => !V22_TABLES.includes(t)));
      if (others.length) warn('(d) 그 밖의 정본 표가 원본 DB 에서 정본과 다르다(v22 탓이 아니다)', others.slice(0, 6).join(' ; '));
      else pass('(d) 그 밖의 정본 표도 같다');
      const left = OLD_TABLES.filter((t) => sigN[t] || sigA[t]);
      check(left.length === 0, '(d) 지운 표 셋이 양쪽 다 없다', left.join(', '));
    }
  }
  return 0;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`X 인자: ${e.message}`); return 2; }
  const pw = process.env.TC_DB_PW;
  if (!pw) { console.error('X 환경 변수 TC_DB_PW(root 비밀번호)가 없다. 비밀번호는 환경 변수로만 받는다.'); return 2; }
  for (const f of ['mysql.exe', 'mysqldump.exe']) if (!existsSync(join(MYSQL_BIN, f))) { console.error(`X ${join(MYSQL_BIN, f)} 가 없다(TC_MYSQL_BIN 으로 폴더를 줄 수 있다)`); return 2; }
  const { run, must, dumpDb } = makeRunner(o, pw);
  const results = [];
  const pass = (label) => { results.push(true); console.log(`  PASS ${label}`); };
  const fail = (label, detail) => { results.push(false); console.log(`  FAIL ${label}: ${detail}`); };
  const warn = (label, detail) => console.log(`  WARN ${label}: ${detail}`);
  const check = (cond, label, detail) => (cond ? pass(label) : fail(label, detail));
  const made = new Set();
  const createDb = (n) => {
    if (!isThrowawayName(n)) throw new Error(`일회용 DB 이름이 아니다: ${n}`);
    must(null, `DROP DATABASE IF EXISTS \`${n}\`;\nCREATE DATABASE \`${n}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\n`, `${n} 만들기`);
    made.add(n);
  };
  const dropDb = (n) => { if (isThrowawayName(n)) { run(null, `DROP DATABASE IF EXISTS \`${n}\`;\n`); made.delete(n); } };
  const tmp = mkdtempSync(join(tmpdir(), 'tc-rh-v22-'));
  let code;
  try {
    code = await body(o, { run, must, dumpDb, pass, fail, warn, check, createDb, dropDb, tmp });
  } catch (e) {
    console.error(`X ${e.message}`);
    code = 2;
  } finally {
    if (!o.keep) for (const n of [...made]) dropDb(n);
    else if (made.size) console.log(`남긴 일회용 DB(--keep): ${[...made].join(', ')}`);
    try { rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 임시 폴더 */ }
  }
  const bad = results.filter((x) => !x).length;
  if (code === 0 && bad) code = 1;
  console.log(code === 0 ? `결과: PASS (${results.length}건)` : `결과: FAIL (실패 ${bad}건${code === 2 ? ', 준비 실패' : ''})`);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then((c) => process.exit(c));
