#!/usr/bin/env node
// =====================================================================================
//  tools/db-rehearsal/rehearse-upgrade-20-22.mjs: 폐쇄망 실제 경로(0.25.1, DB 구조 20)에서 0.26.0 release SQL 로
//  구조 22 까지 한 번에 올리는 MySQL 8.4 리허설(개발 PC 전용, 외부 의존 없음). docs/RELEASE-0.26.0-QA.md 항목 A.
//
//  왜 있나
//    rehearse-v22.mjs 는 구조 21 에서 시작한다. 폐쇄망은 0.25.1(커밋 8b273b5, 구조 20)이라 release SQL 이 v21, v22 조각을
//    차례로 돈다. 이 스크립트는 0.25.1 의 정본 파일로 구조 20 DB 를 새로 세우고(옛 setup-taskcalendar.ps1 의 순서:
//    schema-structure.sql, 회사 01-schema-users.sql, schema-calendar.sql) 0.25.1 모양의 가짜 데이터를 넣은 뒤 실제 release SQL 을 돌린다.
//    원본 개발 DB(taskcalendar)는 읽지도 쓰지도 않는다. 모든 일은 일회용 DB(tc_rh_u20_*)에서 하고 끝나면 지운다.
//
//  하는 일
//    (a) 구조 20 DB 세우기(git show 8b273b5 의 정본 둘 + 회사 01) 와 시드(가짜 이름만). 정본 22 DB 세우기(지금 정본 둘 + 회사 01).
//    (b) release SQL 조립(installer/release-sql.ps1, OS 임시 폴더, 구조 = DbGate.AppStructureVersion). Workbench 의 안전 갱신 모드를
//        흉내 내려고 맨 앞에 SET SESSION sql_safe_updates = 1 을 붙여 mysql.exe 로 돌린다(오류에서 멈춤, Workbench 기본과 같다).
//    (c) 처음 돌리기: 구조 22, 열림, information_schema 가 정본 22 와 같음, 데이터 보존(표마다 옛 칸 전부의 해시), 주간 줄 cat_uid 채우기,
//        일간 옛 줄 0, memo NULL, 지운 표 셋 없음, cal_project_watch 있음.
//    (d) 다시 돌리기: information_schema, 모든 표 데이터, cal_schema_meta(updated_at 포함)가 그대로.
//    (e) 끊기: v21, v22 조각의 바꾸는 문장 경계마다(조각 시작 0 과 끝 포함) 새 사본에 거기까지 돌리고 끊은 뒤(닫힘 확인),
//        release SQL 전체를 다시 → (c) 와 같은 information_schema 와 데이터.
//
//  실행(개발 PC. 운영 서버에 돌리지 않는다)
//    PowerShell:  $env:TC_DB_PW = '<root 비밀번호>'; node tools\db-rehearsal\rehearse-upgrade-20-22.mjs [--host 127.0.0.1] [--port 3306] [--user root]
//                 [--company-data <taskmgr-company-data 폴더>] [--keep] [--only c,d,e]
//    비밀번호는 환경 변수 TC_DB_PW 에서만 읽고 자식 mysql.exe 에는 MYSQL_PWD 로만 넘긴다. 명령줄, 파일, 화면 어디에도 쓰지 않는다.
//    종료코드: 0 모두 통과, 1 실패가 있음, 2 준비 실패(환경, 인자, 구조 20 세우기 실패).
// =====================================================================================
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { splitStatements, fragmentSpan, diffSignatures, groupSignature, SIGNATURE_SQL, boundaryLabel } from './rehearse-v22.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MYSQL_BIN = process.env.TC_MYSQL_BIN || 'C:/Program Files/MySQL/MySQL Server 8.4/bin';
export const PREFIX = 'tc_rh_u20_';
export const BASE_COMMIT = '8b273b5';   // 0.25.1, 마지막 배포(DB 구조 20)
export const FRAGS = ['v21-project-watch.sql', 'v22-report-hours.sql'];
export const OLD_TABLES = ['cal_task_hours', 'cal_migration_log', 'cal_user_pref'];
const SAFE = 'SET SESSION sql_safe_updates = 1;\n';   // Workbench 기본(Safe Updates)과 같은 조건에서 돌린다(0.25.0 의 1175 사고)

export function isThrowawayName(n) { return typeof n === 'string' && /^tc_rh_u20_[a-z0-9_]{1,40}$/.test(n); }

export function parseArgs(argv) {
  const o = { host: '127.0.0.1', port: '3306', user: 'root', keep: false, companyData: join(ROOT, '..', 'taskmgr-company-data'), only: new Set(['c', 'd', 'e']) };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === '--keep') o.keep = true;
    else if (a === '--host' || a === '--port' || a === '--user') { const v = rest.shift(); if (!v) throw new Error(`${a} 뒤에 값이 없다`); o[a.slice(2)] = v; }
    else if (a === '--company-data') { const v = rest.shift(); if (!v) throw new Error('--company-data 뒤에 값이 없다'); o.companyData = resolve(v); }
    else if (a === '--only') { const v = rest.shift() || ''; o.only = new Set(v.split(',').map((x) => x.trim()).filter(Boolean)); }
    else throw new Error(`모르는 인자: ${a}`);
  }
  if (!/^\d{1,5}$/.test(o.port)) throw new Error(`포트가 이상하다: ${o.port}`);
  if (!/^[A-Za-z0-9_.-]{1,255}$/.test(o.host) || !/^[A-Za-z0-9_.@-]{1,64}$/.test(o.user)) throw new Error('호스트나 사용자 이름이 이상하다');
  for (const k of o.only) if (!['c', 'd', 'e'].includes(k)) throw new Error(`--only 는 c,d,e 중에서: ${k}`);
  return o;
}

//  끊을 경계: 조각 시작(0), 바꾸는 단계가 끝난 자리(DEALLOCATE PREPARE _s, COMMIT, 맨 위의 UPDATE, INSERT, DELETE, ALTER, CREATE, DROP),
//  조각 끝. 트랜잭션 안의 경계에서 끊으면 MySQL 이 그 트랜잭션을 되돌린다(Workbench 가 오류로 멈춘 것과 같다).
export function changeBoundaries(stmts) {
  const out = [0];
  stmts.forEach((s, i) => {
    if (s === 'DEALLOCATE PREPARE _s' || s === 'COMMIT' || /^(UPDATE|INSERT|DELETE|ALTER|CREATE|DROP)\b/i.test(s)) out.push(i + 1);
  });
  out.push(stmts.length);
  return [...new Set(out)].sort((a, b) => a - b);
}

//  표 하나의 데이터 해시 질의(행 수, 행마다 모든 칸을 QUOTE 로 이은 글의 MD5 앞뒤 64비트 XOR). 행 순서와 무관하다.
//  칸 이름이 'b:' 로 시작하면 이진 칸(BLOB, BINARY)이라 HEX 로 바꿔 잇는다(utf8mb4 로 바꿀 수 없어 3854).
export function tableHashSql(table, cols) {
  const one = (c) => (c.startsWith('b:') ? `QUOTE(HEX(\`${c.slice(2)}\`))` : `QUOTE(\`${c}\`)`);
  const x = `CONCAT_WS(',', ${cols.map(one).join(', ')})`;
  return `SELECT '${table}', COUNT(*), IFNULL(BIT_XOR(CAST(CONV(LEFT(MD5(${x}), 16), 16, 10) AS UNSIGNED)), 0), `
    + `IFNULL(BIT_XOR(CAST(CONV(RIGHT(MD5(${x}), 16), 16, 10) AS UNSIGNED)), 0) FROM \`${table}\``;
}

// ── 시드(0.25.1 모양, 가짜 이름만) ───────────────────────────────────────────
const PA = 'aaaaaaaa-0000-4000-8000-000000000001', PB = 'aaaaaaaa-0000-4000-8000-000000000002', PC = 'aaaaaaaa-0000-4000-8000-000000000003';
const C = (u, n) => `c-${u}${u}${u}${u}${u}${u}${u}${u}-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
//  주간 줄마다 기대하는 cat_uid(시드 설계에서 직접. SQL 로 다시 계산한 기대값과 함께 본다)
export const WEEKLY_EXPECT = [
  // [user, period_start, line_no, 기대 cat_uid, 경우]
  [1, '2026-10-26', 0, `db-${PA}`, '공식 과제(project_uid 있음)'],
  [1, '2026-10-26', 1, C(1, 2), '개인 과제, 같은 이름 하나'],
  [1, '2026-10-26', 2, null, '개인 과제, 같은 이름 둘'],
  [1, '2026-10-26', 3, null, '대소문자만 다른 이름'],
  [1, '2026-10-26', 4, null, '모르는 이름'],
  [1, '2026-10-26', 5, null, '끝 공백만 다른 이름(_bin 은 끝 공백을 무시해 글자 수까지 본다)'],
  [1, '2026-10-26', 6, `db-${PC}`, '공식 과제(그 사람의 과제 목록에 없음)'],
  [2, '2026-10-26', 0, C(2, 1), '다른 사람에게는 같은 이름이 하나뿐'],
  [2, '2026-10-26', 1, `db-${PB}`, '공식 과제'],
  [1, '2026-10-19', 0, C(1, 2), '앞 주, 개인 과제 하나'],
];
const TS = "'2026-10-27 01:00:00.000'";
export const SEED_SQL = `
SET NAMES utf8mb4;
INSERT INTO app_user (user_id, login_id, name, view_scope, edit_role, is_active) VALUES
  (1, 'rh_user_a', '시험 사용자 가', 'self', 'viewer', 1), (2, 'rh_user_b', '시험 사용자 나', 'all', 'admin', 1), (3, 'rh_user_c', '시험 사용자 다', 'self', 'viewer', 0);
INSERT INTO cal_user_rev (user_id, rev) VALUES (1, 7), (2, 3), (3, 0);
INSERT INTO customer (customer_id, name) VALUES (1, '가상 발주처 갑');
INSERT INTO project (id, uid, section_id, customer_id, project_name, common_name, status_id, sort_no) VALUES
  (1, '${PA}', 1, 1, '가상과제 알파 사업', '가상과제 알파', 1, 1), (2, '${PB}', 1, 1, '가상과제 베타 사업', '가상과제 베타', 1, 2), (3, '${PC}', 2, 1, '가상과제 감마 사업', '가상과제 감마', 1, 1);
INSERT INTO cal_category (user_id, cat_no, uid, source, name, color, description, project_uid, sort_order, created_at, updated_at) VALUES
  (1, 1, 'db-${PA}', 'db', '가상과제 알파', '#336699', '', '${PA}', 0, ${TS}, ${TS}),
  (1, 2, '${C(1, 2)}', 'local', '개인 과제 하나', '#5b6b7d', '설명', NULL, 1, ${TS}, ${TS}),
  (1, 3, '${C(1, 3)}', 'local', '같은 이름 과제', '#5b6b7d', '', NULL, 2, ${TS}, ${TS}),
  (1, 4, '${C(1, 4)}', 'local', '같은 이름 과제', '#5b6b7d', '', NULL, 3, ${TS}, ${TS}),
  (1, 5, '${C(1, 5)}', 'local', 'CaseName 과제', '#5b6b7d', '', NULL, 4, ${TS}, ${TS}),
  (1, 6, '${C(1, 6)}', 'local', '끝 공백 과제', '#5b6b7d', '', NULL, 5, ${TS}, ${TS}),
  (2, 1, '${C(2, 1)}', 'local', '같은 이름 과제', '#5b6b7d', '', NULL, 0, ${TS}, ${TS}),
  (2, 2, 'db-${PB}', 'db', '가상과제 베타', '#aa3300', '', '${PB}', 1, ${TS}, ${TS}),
  (3, 1, '${C(3, 1)}', 'local', '퇴사자 과제', '#5b6b7d', '', NULL, 0, ${TS}, ${TS});
INSERT INTO cal_entry (user_id, entry_no, uid, cat_no, entry_date, end_date, all_day, start_time, end_time, title, memo, location, remind, recur_freq, recur_interval, recur_until, recur_count, sort_order, created_at, updated_at) VALUES
  (1, 1, 'e-11111111-0000-4000-8000-000000000001', 2, '2026-10-27', NULL, 0, '09:00', '10:00', '회의 준비', '메모 한 줄\\n둘째 줄', '가상 회의실', NULL, NULL, NULL, NULL, NULL, 0, ${TS}, ${TS}),
  (1, 2, 'e-11111111-0000-4000-8000-000000000002', 1, '2026-10-20', NULL, 0, '14:00', '15:00', '주간 점검', '', '', 10, 'weekly', 1, NULL, 0, 1, ${TS}, ${TS}),
  (1, 3, 'e-11111111-0000-4000-8000-000000000003', NULL, '2026-10-28', '2026-10-30', 1, NULL, NULL, '출장', '', '', 0, NULL, NULL, NULL, NULL, 2, ${TS}, ${TS}),
  (2, 1, 'e-22222222-0000-4000-8000-000000000001', 1, '2026-10-27', NULL, 1, NULL, NULL, '교육', '', '', NULL, 'monthly', 2, '2027-03-31', 0, 0, ${TS}, ${TS});
INSERT INTO cal_entry_except (user_id, entry_no, except_date) VALUES (1, 2, '2026-10-27'), (2, 1, '2026-12-27');
INSERT INTO cal_todo (user_id, todo_no, uid, cat_no, todo_text, note, due, end_date, done, prio, completed_at, sort_order, created_at, updated_at) VALUES
  (1, 1, 't-11111111-0000-4000-8000-000000000001', 2, '자료 정리', '설명', '2026-10-28', NULL, 0, 'normal', NULL, 0, ${TS}, ${TS}),
  (1, 2, 't-11111111-0000-4000-8000-000000000002', 1, '검토 회신', '', '2026-10-27', NULL, 1, 'high', '2026-10-27 05:30:00.000', 1, ${TS}, ${TS}),
  (1, 3, 't-11111111-0000-4000-8000-000000000003', NULL, '기간 할 일', '', '2026-10-26', '2026-10-30', 0, 'normal', NULL, 2, ${TS}, ${TS}),
  (2, 1, 't-22222222-0000-4000-8000-000000000001', 1, '보고서 쓰기', '', NULL, NULL, 0, 'normal', NULL, 0, ${TS}, ${TS});
INSERT INTO cal_todo_day_note (user_id, todo_no, note_date, note_text) VALUES (1, 3, '2026-10-27', '둘째 날 메모');
INSERT INTO cal_attendance (user_id, work_date, status, overtime, updated_at) VALUES
  (1, '2026-10-27', '1', 0, ${TS}), (1, '2026-10-28', '2', 2, ${TS}), (2, '2026-10-27', '1', 0, ${TS}), (3, '2026-09-01', '9', 0, ${TS});
INSERT INTO cal_report_daily (user_id, work_date, status, overtime, content, sent_at) VALUES
  (1, '2026-10-27', '1', 0, '[가상과제 알파] : 4.5\\n- 설계 검토\\n[개인 과제 하나] : 3.5\\n- 자료 정리', '2026-10-27 09:00:00.000'),
  (1, '2026-10-28', '', 1, '[모르는 과제] : 8\\n- 출장 준비', '2026-10-28 09:00:00.000'),
  (2, '2026-10-27', '1', 0, '[같은 이름 과제] : 8\\n- 교육', '2026-10-27 09:10:00.000');
INSERT INTO cal_report_hours (user_id, work_date, line_no, task_name, cat_no, hours) VALUES
  (1, '2026-10-27', 0, '가상과제 알파', NULL, 4.5), (1, '2026-10-27', 1, '개인 과제 하나', 2, 3.5),
  (1, '2026-10-28', 0, '모르는 과제', NULL, 8), (2, '2026-10-27', 0, '같은 이름 과제', NULL, 8);
INSERT INTO cal_report_weekly (user_id, period_start, period_end, subject, content, endwork, plan, meeting, composed_at) VALUES
  (1, '2026-10-26', '2026-10-31', '10월 넷째주', '과제투입시간 글', '진행사항', '차주계획', '회의내용', ${TS}),
  (1, '2026-10-19', '2026-10-24', '10월 셋째주', '과제투입시간 글', '진행사항', '차주계획', NULL, ${TS}),
  (2, '2026-10-26', '2026-10-31', '10월 넷째주', '과제투입시간 글', '진행사항', '차주계획', '', ${TS});
INSERT INTO cal_report_weekly_hours (user_id, period_start, line_no, task_name, project_uid, hours) VALUES
  (1, '2026-10-26', 0, '가상과제 알파', '${PA}', 8), (1, '2026-10-26', 1, '개인 과제 하나', NULL, 4),
  (1, '2026-10-26', 2, '같은 이름 과제', NULL, 3), (1, '2026-10-26', 3, 'casename 과제', NULL, 2),
  (1, '2026-10-26', 4, '모르는 과제', NULL, 1.5), (1, '2026-10-26', 5, '끝 공백 과제 ', NULL, 1),
  (1, '2026-10-26', 6, '가상과제 감마', '${PC}', 2),
  (2, '2026-10-26', 0, '같은 이름 과제', NULL, 5), (2, '2026-10-26', 1, '가상과제 베타', '${PB}', 6),
  (1, '2026-10-19', 0, '개인 과제 하나', NULL, 2);
INSERT INTO cal_task_hours (user_id, work_date, cat_no, hours, updated_at) VALUES (1, '2026-10-27', 2, 3.5, ${TS}), (1, '2026-10-27', 1, 4.5, ${TS});
INSERT INTO cal_user_pref (user_id, report_font_family, report_font_size, updated_at) VALUES (1, 'Gulim', 12, ${TS});
INSERT INTO cal_migration_log (user_id, source_host, migrated_at) VALUES (1, 'PC-RH-01', ${TS});
INSERT INTO project_schedule_image (user_id, project_id, seq, mime, bytes, width_px, height_px, sha256, uploaded_at) VALUES
  (1, 1, 1, 'image/png', 0x89504E470D0A1A0A0000000D49484452, 1, 1, '${'0123456789abcdef'.repeat(4)}', ${TS});
INSERT INTO cal_project_event (event_id, uid, project_id, title, start_date, memo, recur_freq, created_by_name, updated_by_name, created_at, updated_at) VALUES
  (1, 'bbbbbbbb-0000-4000-8000-000000000001', 1, '정기 점검', '2026-10-05', '', 'weekly', '시험 사용자 가', '시험 사용자 가', ${TS}, ${TS});
INSERT INTO cal_project_event_except (event_id, except_date) VALUES (1, '2026-10-12');
INSERT INTO cal_project_change (project_id, event_id, mutation_uid, action, actor_name, title_snapshot, before_json, after_json, changed_at) VALUES
  (1, 1, 'cccccccc-0000-4000-8000-000000000001', 'create', '시험 사용자 가', '정기 점검', NULL, '{"title":"정기 점검"}', ${TS});
UPDATE cal_schema_meta SET v = '0.25.1' WHERE k = 'app_latest_version';
UPDATE cal_schema_meta SET v = 'TaskCalendarWidget-Setup-v0.25.1.exe' WHERE k = 'app_installer_file';
UPDATE cal_schema_meta SET v = '${'ab'.repeat(32)}' WHERE k = 'app_installer_sha256';
`;

// ── MySQL 실행(rehearse-v22.mjs 와 같은 방식) ─────────────────────────────────
function makeRunner(o, pw) {
  const env = { ...process.env, MYSQL_PWD: pw };
  delete env.TC_DB_PW;
  const base = ['--host', o.host, '--port', o.port, '--user', o.user, '--default-character-set=utf8mb4'];
  const mysql = join(MYSQL_BIN, 'mysql.exe'), dump = join(MYSQL_BIN, 'mysqldump.exe');
  const run = (db, sql) => {
    const r = spawnSync(mysql, [...base, '--batch', '--skip-column-names', ...(db ? [db] : [])], { input: Buffer.from(sql, 'utf8'), env, maxBuffer: 1 << 30, windowsHide: true });
    if (r.error) throw new Error(`mysql.exe 를 실행하지 못했다: ${r.error.message}`);
    return { code: r.status, out: (r.stdout || Buffer.alloc(0)).toString('utf8'), err: (r.stderr || Buffer.alloc(0)).toString('utf8').trim() };
  };
  const must = (db, sql, what) => {
    const r = run(db, sql);
    if (r.code !== 0) throw new Error(`${what} 실패: ${r.err.split('\n').slice(-3).join(' / ')}`);
    return r.out;
  };
  const dumpDb = (db) => {
    const args = [...base, '--single-transaction', '--no-tablespaces', '--set-gtid-purged=OFF', '--triggers', '--routines', '--hex-blob', '--skip-comments', db];
    const r = spawnSync(dump, args, { env, maxBuffer: 1 << 30, windowsHide: true });
    if (r.error) throw new Error(`mysqldump.exe 를 실행하지 못했다: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`mysqldump 실패: ${(r.stderr || '').toString('utf8').trim().split('\n').slice(-3).join(' / ')}`);
    return r.stdout.toString('utf8');
  };
  return { run, must, dumpDb };
}

function gitShow(path) {
  const r = spawnSync('git', ['-C', ROOT, 'show', `${BASE_COMMIT}:${path}`], { maxBuffer: 1 << 28, windowsHide: true });
  if (r.status !== 0) throw new Error(`git show ${BASE_COMMIT}:${path} 실패: ${(r.stderr || '').toString('utf8').trim()}`);
  return r.stdout.toString('utf8').replace(/^\uFEFF/, '');
}
const readUtf8 = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');

async function body(o, ctx) {
  const { run, must, dumpDb, pass, fail, check, createDb, dropDb, tmp } = ctx;
  const q1 = (db, sql) => must(db, sql, '질의').trim();
  const cells = (out) => out.trim().split('\t');
  const lastErr = (r, n = 3) => r.err.split('\n').slice(-n).join(' / ');
  const signature = (db) => groupSignature(must(db, SIGNATURE_SQL, `${db} 서명`));
  const tableCols = (db) => {
    const m = {};
    for (const line of q1(db, "SELECT c.TABLE_NAME, IF(c.DATA_TYPE IN ('blob', 'tinyblob', 'mediumblob', 'longblob', 'binary', 'varbinary'), CONCAT('b:', c.COLUMN_NAME), c.COLUMN_NAME) FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME "
      + "WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE' ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;").split(/\r?\n/).filter(Boolean)) {
      const [t, c] = line.split('\t'); (m[t] ||= []).push(c);
    }
    return m;
  };
  //  표마다 { 행 수, 해시 }. cols 를 주면 그 칸만(옛 칸으로 새 DB 를 잴 때), skipMetaTime 이면 cal_schema_meta.updated_at 을 뺀다.
  const hashes = (db, colsMap, { skipMetaTime = false } = {}) => {
    const parts = Object.keys(colsMap).sort().map((t) => tableHashSql(t, (skipMetaTime && t === 'cal_schema_meta') ? colsMap[t].filter((c) => c !== 'updated_at') : colsMap[t]));
    const out = {};
    for (const line of must(db, parts.join(' UNION ALL\n') + ';\n', `${db} 데이터 해시`).split(/\r?\n/).filter(Boolean)) {
      const [t, n, h1, h2] = line.split('\t'); out[t] = { n: Number(n), h: `${h1}:${h2}` };
    }
    return out;
  };
  const diffHashes = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((t) => !a[t] || !b[t] || a[t].h !== b[t].h || a[t].n !== b[t].n)
    .map((t) => `${t}(${a[t] ? a[t].n : '없음'} 에서 ${b[t] ? b[t].n : '없음'})`);
  const meta = (db) => Object.fromEntries(q1(db, 'SELECT k, v FROM cal_schema_meta ORDER BY k;').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t')));

  console.log(`20 에서 22 업그레이드 리허설: ${o.user}@${o.host}:${o.port}, 기준 커밋 ${BASE_COMMIT}(0.25.1), 일회용 DB 접두 ${PREFIX}`);
  for (const n of q1(null, "SHOW DATABASES LIKE 'tc\\_rh\\_u20\\_%';").split(/\r?\n/).filter(Boolean)) dropDb(n);

  //  ── (a) 구조 20 과 정본 22 세우기 ──
  const usersFile = join(o.companyData, '01-schema-users.sql');
  if (!existsSync(usersFile)) { console.error(`X 회사 사용자 표 정의가 없다: ${usersFile} (--company-data 로 폴더를 준다)`); return 2; }
  const users = readUtf8(usersFile);
  const oldStruct = gitShow('db/deploy/schema-structure.sql'), oldCal = gitShow('db/deploy/schema-calendar.sql');
  if (!/VALUES \('db_structure_version', '20'/.test(oldCal)) { console.error(`X ${BASE_COMMIT} 의 schema-calendar.sql 이 구조 20 을 시딩하지 않는다`); return 2; }
  const BASE = PREFIX + 'base';
  createDb(BASE);
  must(BASE, oldStruct, `${BASE} 에 ${BASE_COMMIT} schema-structure.sql`);
  must(BASE, users, `${BASE} 에 01-schema-users.sql`);
  must(BASE, oldCal, `${BASE} 에 ${BASE_COMMIT} schema-calendar.sql`);
  must(BASE, SEED_SQL, `${BASE} 시드`);
  const m0 = meta(BASE);
  const nTables0 = Number(q1(BASE, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE';"));
  if (m0.db_structure_version !== '20' || m0.db_updating !== '0') { console.error(`X 세운 DB 의 구조가 20, 열림이 아니다(${m0.db_structure_version}, ${m0.db_updating})`); return 2; }
  const cols0 = tableCols(BASE);
  const before = hashes(BASE, cols0);
  console.log(`구조 20 DB: 표 ${nTables0}개(캘린더 ${Object.keys(cols0).filter((t) => t.startsWith('cal_')).length}), 시드 행 `
    + ['cal_category', 'cal_entry', 'cal_todo', 'cal_attendance', 'cal_report_daily', 'cal_report_hours', 'cal_report_weekly', 'cal_report_weekly_hours', ...OLD_TABLES, 'project_schedule_image']
      .map((t) => `${t} ${before[t] ? before[t].n : '-'}`).join(', '));
  //  주간 줄 기대 cat_uid 를 구조 20 DB 에서 SQL 로 다시 계산(조각의 GROUP BY 와 다른 꼴: 줄마다 같은 이름 개인 과제 수를 센다)
  const expectSql = "SELECT user_id, period_start, line_no, IFNULL(CASE WHEN project_uid IS NOT NULL THEN CONCAT('db-', project_uid) ELSE "
    + "(SELECT IF(COUNT(*) = 1, MIN(c.uid), NULL) FROM cal_category c WHERE c.user_id = h.user_id AND c.source = 'local' AND c.name COLLATE utf8mb4_bin = h.task_name COLLATE utf8mb4_bin AND CHAR_LENGTH(c.name) = CHAR_LENGTH(h.task_name)) END, '<NULL>') "
    + 'FROM cal_report_weekly_hours h ORDER BY user_id, period_start, line_no;';
  const weeklyExpect = q1(BASE, expectSql);

  const CANON = PREFIX + 'canon';
  createDb(CANON);
  must(CANON, readUtf8(join(ROOT, 'db', 'deploy', 'schema-structure.sql')), `${CANON} 에 schema-structure.sql`);
  must(CANON, users, `${CANON} 에 01-schema-users.sql`);
  must(CANON, readUtf8(join(ROOT, 'db', 'deploy', 'schema-calendar.sql')), `${CANON} 에 schema-calendar.sql`);
  const sigCanon = signature(CANON);

  //  ── (b) release SQL 조립 ──
  const app = Number(/public const int AppStructureVersion = (\d+);/.exec(readUtf8(join(ROOT, 'widget', 'DbGate.cs')))[1]);
  const relPath = join(tmp, 'release-rehearsal.sql');
  const g = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'installer', 'release-sql.ps1'),
    '-FragmentDir', join(ROOT, 'db', 'deploy', 'migrations'), '-Structure', String(app), '-Version', '0.26.0', '-InstallerFile', 'TaskCalendarWidget-Setup-v0.26.0.exe',
    '-Sha256', '0'.repeat(64), '-Notes', '20 to 22 rehearsal', '-OutFile', relPath, '-Stamp', 'rehearsal'], { encoding: 'utf8', windowsHide: true });
  if (g.status !== 0 || !existsSync(relPath)) { console.error(`X release SQL 을 조립하지 못했다(exit ${g.status}): ${(g.stdout || '') + (g.stderr || '')}`); return 2; }
  const rel = SAFE + readFileSync(relPath, 'utf8');
  const frags = FRAGS.map((name) => { const span = fragmentSpan(rel, name); const stmts = splitStatements(span.body); return { name, span, stmts, bounds: changeBoundaries(stmts) }; });
  console.log(`release SQL: 구조 ${app}, 안전 갱신 모드 켬, ` + frags.map((f) => `${f.name} 문장 ${f.stmts.length}개 경계 ${f.bounds.length}곳`).join(', '));
  check(app === 22, '(b) 앱 구조 번호(DbGate.AppStructureVersion)가 22', `${app}`);

  //  안전 갱신 모드가 정말 걸리는지: 키 없는 UPDATE 가 1175 로 막혀야 한다(일회용 DB 에서. 막히지 않으면 0행 바꾼다)
  const probe = run(BASE, SAFE + "SELECT @@SESSION.sql_safe_updates;\nUPDATE cal_schema_meta SET updated_at = updated_at WHERE v = '-';\n");
  check(probe.code !== 0 && /\b1175\b/.test(probe.err), '(b) 안전 갱신 모드가 걸린다(키 없는 UPDATE 는 1175)', `exit ${probe.code} ${lastErr(probe, 1)}`);

  const dump20 = dumpDb(BASE);
  const loadCopy = (n) => { createDb(n); must(n, dump20, `${n} 에 구조 20 붓기`); };

  //  ── (c) 처음 돌리기 ──
  const A = PREFIX + 'a';
  loadCopy(A);
  const ra = run(A, rel);
  if (ra.code !== 0) { fail('(c) 구조 20 DB 에 release SQL 처음 돌리기', lastErr(ra)); return 1; }
  pass('(c) 구조 20 DB 에 release SQL 처음 돌리기(오류 없이 끝)');
  const mA = meta(A);
  check(mA.db_structure_version === '22' && mA.db_updating === '0', '(c) 구조 번호 22, 열림(db_updating 0)', `[${mA.db_structure_version}, ${mA.db_updating}]`);
  check(mA.app_latest_version === '0.26.0' && mA.app_installer_file === 'TaskCalendarWidget-Setup-v0.26.0.exe' && mA.app_installer_sha256 === '0'.repeat(64) && Object.keys(mA).length === 5,
    '(c) 배포 정보 세 키가 새 값, 메타 키 다섯 개', JSON.stringify(mA));
  const sigA = signature(A);
  const allTables = [...new Set([...Object.keys(sigA), ...Object.keys(sigCanon)])].sort();
  const dCanon = diffSignatures(sigCanon, sigA, allTables);
  check(dCanon.length === 0, `(c) information_schema 가 정본 22 로 새로 깐 DB 와 같다(표 ${Object.keys(sigCanon).length}개, 칸, 색인, FK, CHECK, 설명)`, dCanon.slice(0, 8).join(' ; '));
  const goneA = OLD_TABLES.filter((t) => sigA[t]);
  check(goneA.length === 0, '(c) 지운 표 셋(cal_task_hours, cal_migration_log, cal_user_pref)이 없다', goneA.join(', '));
  check(!!sigA.cal_project_watch, '(c) cal_project_watch 가 있다', '없다');
  //  데이터 보존: 구조 20 의 표마다 옛 칸 전부로 해시를 견준다(지운 표 셋, 비우는 cal_report_hours, 메타는 따로 본다)
  const keepCols = Object.fromEntries(Object.entries(cols0).filter(([t]) => !OLD_TABLES.includes(t) && t !== 'cal_report_hours' && t !== 'cal_schema_meta'));
  const afterOld = hashes(A, keepCols);
  const lost = diffHashes(hashes(BASE, keepCols), afterOld);
  check(lost.length === 0, `(c) 데이터 보존: 표 ${Object.keys(keepCols).length}개의 옛 칸 전부가 행 하나까지 같다`, lost.join(', '));
  console.log('  보존 확인 행 수: ' + ['cal_category', 'cal_entry', 'cal_entry_except', 'cal_todo', 'cal_todo_day_note', 'cal_attendance', 'cal_report_daily', 'cal_report_weekly', 'cal_report_weekly_hours', 'project_schedule_image', 'cal_user_rev']
    .map((t) => `${t} ${afterOld[t] ? afterOld[t].n : '-'}`).join(', '));
  const [crhN, dailyN, memoNull, watchN] = cells(q1(A, 'SELECT (SELECT COUNT(*) FROM cal_report_hours), (SELECT COUNT(*) FROM cal_report_daily), (SELECT COUNT(*) FROM cal_report_daily WHERE memo IS NULL), (SELECT COUNT(*) FROM cal_project_watch);')).map(Number);
  check(crhN === 0, `(c) cal_report_hours 옛 줄을 모두 지웠다(전 ${before.cal_report_hours.n}줄, cat_no 찬 줄 1 포함)`, `${crhN}줄 남음`);
  check(memoNull === dailyN && dailyN === before.cal_report_daily.n, `(c) 일간보고 ${dailyN}건 모두 memo NULL(옛 보고)`, `NULL ${memoNull}, 전체 ${dailyN}`);
  check(watchN === 0, '(c) cal_project_watch 는 빈 표', `${watchN}행`);
  //  주간 줄 cat_uid: SQL 기대값 대조 + 시드 설계의 경우별 기대
  const weeklyActual = q1(A, "SELECT user_id, period_start, line_no, IFNULL(cat_uid, '<NULL>') FROM cal_report_weekly_hours ORDER BY user_id, period_start, line_no;");
  check(weeklyActual === weeklyExpect, '(c) 주간 줄 cat_uid 가 줄마다 기대(공식은 db-<project_uid>, 개인은 _bin 같은 이름 하나뿐일 때만)와 같다', `\n    기대 ${weeklyExpect.replace(/\n/g, ' | ')}\n    실제 ${weeklyActual.replace(/\n/g, ' | ')}`);
  const actualMap = new Map(weeklyActual.split(/\r?\n/).map((l) => { const [u, p, n, c] = l.split('\t'); return [`${u}|${p}|${n}`, c === '<NULL>' ? null : c]; }));
  for (const [u, p, n, want, why] of WEEKLY_EXPECT) {
    const got = actualMap.get(`${u}|${p}|${n}`);
    check(got === want, `(c) 주간 줄 경우: ${why} -> ${want ?? 'NULL'}`, `실제 ${got ?? 'NULL'}`);
  }
  const [wTot, wDb, wLocal, wNull] = cells(q1(A, "SELECT COUNT(*), SUM(cat_uid LIKE 'db-%'), SUM(cat_uid IS NOT NULL AND cat_uid NOT LIKE 'db-%'), SUM(cat_uid IS NULL) FROM cal_report_weekly_hours;")).map(Number);
  console.log(`  주간 줄 채우기: 전체 ${wTot}(공식 과제 id ${wDb}, 개인 과제 id ${wLocal}, 빈 줄 ${wNull})`);
  const hashA = hashes(A, tableCols(A));
  const hashAnoTime = hashes(A, tableCols(A), { skipMetaTime: true });

  //  ── (d) 다시 돌리기 ──
  if (o.only.has('d')) {
    const rb = run(A, rel);
    if (rb.code !== 0) fail('(d) 같은 release SQL 다시 돌리기', lastErr(rb));
    else {
      const d = diffSignatures(sigA, signature(A), allTables);
      check(d.length === 0, '(d) 다시 돌려도 information_schema 가 그대로', d.slice(0, 5).join(' ; '));
      const dd = diffHashes(hashA, hashes(A, tableCols(A)));
      check(dd.length === 0, '(d) 다시 돌려도 모든 표 데이터와 cal_schema_meta(updated_at 포함)가 그대로', dd.join(', '));
    }
  }

  //  ── (e) 경계마다 끊고 다시 ──
  if (o.only.has('e')) {
    let total = 0, okN = 0;
    const t0 = Date.now();
    for (const f of frags) {
      for (const n of f.bounds) {
        total++;
        const E = PREFIX + 'e';
        const where = `${f.name} 경계 ${n}/${f.stmts.length}(${n === 0 ? '조각 시작' : boundaryLabel(f.stmts, n)})`;
        loadCopy(E);
        const r1 = run(E, rel.slice(0, f.span.start) + '\n' + f.stmts.slice(0, n).map((s) => s + ';').join('\n') + '\n');
        let bad = '';
        if (r1.code !== 0) bad = `끊기 전 실행 실패: ${lastErr(r1, 2)}`;
        else {
          const mid = meta(E);
          if (mid.db_updating !== '1') bad = `끊긴 뒤 닫혀 있지 않다(db_updating ${mid.db_updating})`;
          else {
            const r2 = run(E, rel);
            if (r2.code !== 0) bad = `다시 돌리기 실패: ${lastErr(r2, 2)}`;
            else {
              const d = diffSignatures(sigA, signature(E), allTables);
              const dd = diffHashes(hashAnoTime, hashes(E, tableCols(E), { skipMetaTime: true }));
              if (d.length || dd.length) bad = `(c) 와 다르다: ${d.slice(0, 3).join(' ; ')} ${dd.join(', ')}`;
            }
          }
        }
        if (bad) fail(`(e) ${where}`, bad); else okN++;
        dropDb(E);
      }
    }
    if (okN === total) pass(`(e) v21, v22 경계 ${total}곳 모두: 끊긴 동안 닫혀 있고, 다시 돌리면 (c) 와 같은 구조와 데이터(${Math.round((Date.now() - t0) / 1000)}초)`);
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
  const check = (cond, label, detail) => (cond ? pass(label) : fail(label, detail));
  const made = new Set();
  const createDb = (n) => {
    if (!isThrowawayName(n)) throw new Error(`일회용 DB 이름이 아니다: ${n}`);
    must(null, `DROP DATABASE IF EXISTS \`${n}\`;\nCREATE DATABASE \`${n}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\n`, `${n} 만들기`);
    made.add(n);
  };
  const dropDb = (n) => { if (isThrowawayName(n)) { run(null, `DROP DATABASE IF EXISTS \`${n}\`;\n`); made.delete(n); } };
  const tmp = mkdtempSync(join(tmpdir(), 'tc-rh-u20-'));
  let code;
  try {
    code = await body(o, { run, must, dumpDb, pass, fail, check, createDb, dropDb, tmp });
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
