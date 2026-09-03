#!/usr/bin/env node
/* =====================================================================================
 * db/deploy/seed-dummy.mjs — 「타인 일정 열람」 평가용 더미 캘린더 데이터 시딩 도구
 *
 * ── 왜 이것이 필요한가 ─────────────────────────────────────────────────────────
 *   C4(타인 일정 열람)는 명부에서 사람을 고르면 그 사람의 달력을 읽기 전용 팝업으로 띄운다.
 *   그런데 개발 DB 에는 89명 중 **한 명(phmin)** 에게만 데이터가 있어, 누구를 눌러도 빈 달력이
 *   뜬다. 그 상태로는 이 기능의 UI/UX 를 평가할 수 없다 — 밀도·색·겹침·빈 날이 전부 안 보인다.
 *   → 이 도구는 '볼 수 있는 사람들' 에게 그럴듯한 더미를 채워 넣는다. 재실행 가능하고,
 *     같은 seed 면 언제나 같은 데이터가 나온다(결정적).
 *
 * ── 이 도구가 지키는 안전 규칙(운영 DB 에서 잘못 돌면 남의 데이터를 지우는 도구다) ────────
 *   R1 대상 사용자 외에는 단 한 행도 건드리지 않는다 — 모든 DELETE/INSERT 에 user_id 가 있다.
 *   R2 삭제는 FK 순서대로: cal_task_hours → cal_entry → cal_todo → cal_category
 *      (cal_entry_commit·except 는 CASCADE, cal_todo_day_note 도 CASCADE.
 *       cal_category 는 3표가 RESTRICT 로 잡고 있어 **맨 마지막**). cal_attendance 는 FK 가 없다.
 *   R3 cal_user_rev 는 DELETE 하지 않는다 — 단조 증가값이라 되돌리면 앱의 변경 감지가 깨진다.
 *      사용자별 시딩이 끝나면 ODKU 로 **+1 만** 한다.
 *   R4 cal_migration_log · cal_report_* · cal_user_pref · cal_room 에는 쓰지 않는다.
 *      ★ 단 검증 V13('총 행수 불변')은 COUNT(*) 로 **읽는다** — 그 읽기가 없으면 '건드리지
 *        않았다' 를 증명할 방법이 없다. 읽기만 하고 절대 쓰지 않는다.
 *   R5 project · app_user · org_unit 등 조직·과제 원본 표는 SELECT 만 한다.
 *   R6 사용자 1명 = 1 트랜잭션. 중간에 실패하면 그 사용자만 실패로 적고 다음 사람으로 간다
 *      (mysql.exe 는 첫 오류에서 멈추고 접속을 닫으므로 COMMIT 전이면 암묵 ROLLBACK 이다).
 *   R7 문자열은 전부 이스케이프한다(q()). 한글은 argv 가 아니라 **stdin(UTF-8)** 으로 넘긴다 —
 *      Windows ANSI 코드페이지 변환에 깨진다(tests/loop-*.mjs 와 같은 관례).
 *   R8 Date.now()/Math.random() 으로 **데이터 값**을 만들지 않는다. 진행 로그의 경과시간만 예외.
 *
 * ── 앱 규약(맞추지 않으면 앱이 조용히 오작동한다) ────────────────────────────────
 *   · 카테고리 uid: DB 과제 = 'db-'+project.uid(정확히 39자, source='db', project_uid 일치),
 *                   일반과제 = 'c-<base36 8>-<base36 8>'(source='local', project_uid=NULL).
 *                   이 규칙은 chk_cal_category_projuid 가 DB 에서 직접 강제한다.
 *   · 일정 uid 'e-…', 할일 uid 't-…' — 같은 seed·같은 사람이면 언제나 같은 값이 나온다.
 *   · cal_entry.source 는 ''(사람이 만든 일정) 또는 'git'(커밋 수집) 둘뿐이다.
 *   · 근태 status 는 문자열 코드이고 **미기록은 NULL 이 아니라 '행 부재'** 다. 무효·미지 코드를
 *     '1'(정근)로 흡수하지 않는다 — 이 앱의 과거 사고가 정확히 그것이었다.
 *
 * ── 스키마와 브리프가 어긋난 자리(스키마를 따랐다) ──────────────────────────────
 *   · cal_todo.prio 는 0~2 정수가 아니라 CHECK (prio IN ('normal','high')) 다. → 'normal'/'high'.
 *   · cal_attendance.overtime 은 NOT NULL DEFAULT 0(0..11) 이라 NULL 을 넣을 수 없다. → 0.
 *   · cal_entry_commit.seq 는 스키마 주석이 '부모 commits 배열 인덱스(0부터)' 라고 못박는다.
 *     → 1..N 이 아니라 **0..N-1** 로 넣는다(앱의 표시 순서 근거가 이 값이다).
 *   · 반복 일정은 chk_cal_entry_recur 가 recur_count 를 NOT NULL 로 요구한다(0=제한 없음).
 *     → until 을 쓰는 반복은 recur_count=0, count 를 쓰는 반복은 recur_until=NULL.
 *
 * 실행:
 *   $env:TC_TEST_DB_ADMIN_PW = '<root 비번>'
 *   node db/deploy/seed-dummy.mjs                      # phmin 이 볼 수 있는 사람 전원(자신 제외)
 *   node db/deploy/seed-dummy.mjs --dry-run            # SQL 만 만들고 DB 는 건드리지 않는다
 *   node db/deploy/seed-dummy.mjs --users=hjlee,ykkim  # 지정한 사람만
 *   node db/deploy/seed-dummy.mjs --verify             # 시딩하지 않고 불변식만 확인
 *
 * 종료코드: 0 = 정상 · 1 = 검증 위반 · 2 = 전제/환경 불충족(비밀번호 없음·mysql.exe 없음 등)
 * ===================================================================================== */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/* ══════════════════════════ 0. 옵션 ══════════════════════════ */

const DEFAULTS = {
  viewer: 'phmin',
  seed: 20260903,
  db: process.env.TC_TEST_DB_NAME || 'taskmgr',
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  dbHost: '127.0.0.1',
  dbPort: 3306,
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',   // ← 비밀. 소스에 기본값을 두지 않는다.
};

function printHelp() {
  console.log([
    '사용법: node db/deploy/seed-dummy.mjs [옵션]',
    '  --viewer=<login_id>   기준 사용자(기본 ' + DEFAULTS.viewer + '). 이 사람이 볼 수 있는 사람들이 대상이 된다',
    '  --all-users           view_scope 를 무시하고 활성 사용자 전원을 대상으로',
    '  --users=a,b,c         login_id 를 직접 지정(뷰어 권한 계산 생략)',
    '  --include-self        기본은 뷰어 자신 제외(개발자 본인 데이터 보존). 이 옵션으로 포함',
    '  --seed=<정수>         결정적 생성의 씨앗(기본 ' + DEFAULTS.seed + ')',
    '  --clear               대상 사용자의 기존 캘린더 데이터를 지우고 새로 넣는다(기본 동작)',
    '  --keep                기존 데이터가 있는 사람은 지우지 않고 건너뛴다',
    '  --dry-run             SQL 만 만들고 실행하지 않는다(DB 를 전혀 바꾸지 않는다)',
    '  --verify              시딩하지 않고 자체 검증(V1~V10)만 수행',
    '  --db=<name>           대상 스키마(기본 ' + DEFAULTS.db + ')',
    '  --mysql=<path>        mysql.exe 경로',
    '  --db-host=/--db-port= 접속 정보(기본 ' + DEFAULTS.dbHost + ':' + DEFAULTS.dbPort + ')',
    '  --admin-user=NAME     DB 관리자 계정(기본 ' + DEFAULTS.adminUser + ')',
    '  -v, --verbose         사용자별 상세 로그',
    '',
    '비밀번호는 환경변수 TC_TEST_DB_ADMIN_PW 로만 받는다(명령행·소스에 두지 않는다).',
  ].join('\n'));
}

function parseArgs(argv) {
  const o = {
    ...DEFAULTS,
    allUsers: false, users: null, includeSelf: false,
    clear: true, keep: false, dryRun: false, verifyOnly: false, verbose: false,
  };
  for (const a of argv) {
    let m;
    if ((m = /^--viewer=(.+)$/.exec(a))) o.viewer = m[1].trim();
    else if (a === '--all-users') o.allUsers = true;
    else if ((m = /^--users=(.+)$/.exec(a))) o.users = m[1].split(',').map((s) => s.trim()).filter((s) => s.length);
    else if (a === '--include-self') o.includeSelf = true;
    else if ((m = /^--seed=(-?\d+)$/.exec(a))) o.seed = Number(m[1]);
    else if (a === '--clear') o.clear = true;
    else if (a === '--keep') { o.keep = true; o.clear = false; }
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--verify') o.verifyOnly = true;
    else if ((m = /^--db=(.+)$/.exec(a))) o.db = m[1].trim();
    else if ((m = /^--mysql=(.+)$/.exec(a))) o.mysql = m[1];
    else if ((m = /^--db-host=(.+)$/.exec(a))) o.dbHost = m[1].trim();
    else if ((m = /^--db-port=(\d+)$/.exec(a))) o.dbPort = Number(m[1]);
    else if ((m = /^--admin-user=(.+)$/.exec(a))) o.adminUser = m[1].trim();
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error('알 수 없는 인자: ' + a); printHelp(); process.exit(2); }
  }
  return o;
}

const OPT = parseArgs(process.argv.slice(2));

const T0 = Date.now();   // ★ 로그의 경과시간 전용. 데이터 값에는 절대 쓰지 않는다(R8).
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const log = (...a) => console.log(el(), ...a);
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   ·', ...a); };

/** 전제/환경 실패 — 불변식 위반이 아니다(종료코드 2). */
function envFail(msg, detail) {
  console.error('');
  console.error('[중단·환경] ' + msg);
  if (detail) console.error('            ' + String(detail).replace(/\s+/g, ' ').slice(0, 900));
  process.exit(2);
}

if (!OPT.adminPw) {
  console.error('[중단] DB 관리자 비밀번호가 없습니다. 환경변수 TC_TEST_DB_ADMIN_PW 로 지정하세요.');
  console.error("        PowerShell:  $env:TC_TEST_DB_ADMIN_PW = '<비번>'");
  console.error("        bash:        export TC_TEST_DB_ADMIN_PW='<비번>'");
  console.error('        계정명 기본값은 root — 다르면 TC_TEST_DB_ADMIN_USER 또는 --admin-user= 로 지정.');
  process.exit(2);
}
if (OPT.keep && process.argv.includes('--clear')) {
  console.error('[중단] --clear 와 --keep 은 함께 쓸 수 없습니다(지울지 말지가 반대입니다).');
  process.exit(2);
}
if (!existsSync(OPT.mysql)) {
  envFail('mysql.exe 를 찾을 수 없습니다: ' + OPT.mysql, '--mysql= 또는 환경변수 TC_TEST_MYSQL 로 경로를 지정하세요.');
}

/* ══════════════════════════ 1. 결정적 PRNG ══════════════════════════ */
// mulberry32 — 32bit 시드 하나로 결정론적 시퀀스. 같은 seed·같은 user_id 면 같은 데이터가 나온다.
// ★ Math.random() 을 쓰면 '두 번 돌렸더니 다른 더미' 가 되어 멱등성을 잃는다(R8).
function mulberry32(a) {
  let s = a >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ══════════════════════════ 2. MySQL 계층 ══════════════════════════ */
/* 이 저장소에는 package.json 도 node_modules 도 없다(의존성 0). 그래서 드라이버를 쓰지 않고
 * mysql.exe 를 spawnSync 로 부른다. 호출 모양·EOF 마커 기법은 tests/loop-org-compat.mjs 를
 * 그대로 본떴다 — 그 파일이 실측으로 얻은 계약이라 여기서 다시 발명할 이유가 없다.        */

function baseArgs() {
  return [
    '-u' + OPT.adminUser, '-p' + OPT.adminPw, '-h' + OPT.dbHost, '-P' + OPT.dbPort,
    '--get-server-public-key', '--default-character-set=utf8mb4',
  ];
}
const cliArgs = () => baseArgs().concat(['--connect-timeout=5']);

/* ── 출력 무결성 계약(loop-org-compat.mjs 의 실측을 그대로 물려받는다) ────────────
 *  mysql.exe 는 드물게(실측 0.15%) **종료코드 0 · stderr 빈 채로** stdout 을 행 중간에서
 *  잘라 돌려준다. 부모 쪽으로는 막을 수 없으므로 '예방' 이 아니라 **검출 + 재시도** 가 대책이다.
 *   · 모든 SQL 뒤에 종결 마커 SELECT 를 별도 문장으로 붙이고, 마지막 유효 줄이 마커가 아니면 잘림.
 *   · 읽기 전용 호출은 3회까지 재시도한다(재실행이 안전하다).
 *   · 쓰기 호출은 재시도하지 않는다(두 번 적용 위험) — 그 사용자를 실패로 적고 넘어간다. */
const EOFMARK = '__TCEOF__';
let truncSeen = 0;

function mysqlRunOnce(sql, { timeout, marker }) {
  const args = cliArgs().concat(['-N', '-B', '-D', OPT.db]);
  const body = marker ? sql.replace(/\s+$/, '') + '\n;\n' + 'SELECT ' + q(EOFMARK) + ';\n' : sql;
  const r = spawnSync(OPT.mysql, args, {
    input: Buffer.from(body, 'utf8'), maxBuffer: 256 * 1024 * 1024, timeout, windowsHide: true,
  });
  if (r.error) return { ok: false, status: -1, out: '', err: String(r.error.message), errno: null, truncated: false };

  let out = (r.stdout || Buffer.alloc(0)).toString('utf8');
  const err = (r.stderr || Buffer.alloc(0)).toString('utf8');
  const m = /ERROR (\d+)/.exec(err);
  const ok = r.status === 0;

  let truncated = false;
  if (marker && ok) {
    const lines = out.split(/\r?\n/);
    let last = '';
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].length) { last = lines[i]; break; }
    if (last !== EOFMARK) truncated = true;
    else out = out.slice(0, out.lastIndexOf(EOFMARK)).replace(/(\r?\n)$/, '');
  }
  return { ok, status: r.status, out, err, errno: m ? Number(m[1]) : null, truncated };
}

function mysqlRun(sql, { timeout = 120000, marker = true, readOnly = false, what = 'SQL 실행' } = {}) {
  const tries = readOnly ? 3 : 1;
  let r = null;
  for (let i = 1; i <= tries; i++) {
    r = mysqlRunOnce(sql, { timeout, marker });
    if (!r.truncated) return r;
    truncSeen++;
    log('  ⚠ mysql 출력이 잘렸다(종료코드 0·stderr 없음, ' + r.out.length + 'B) — ' + what +
      (i < tries ? ' → 재시도 ' + i + '/' + (tries - 1) : ''));
  }
  if (readOnly) {
    envFail('mysql 출력이 잘렸다(종료코드 0 · stderr 없음) — ' + what + ' · ' + (tries - 1) + '회 재시도 실패',
      'SQL 머리: ' + sql.replace(/\s+/g, ' ').slice(0, 200));
  }
  return r;   // 쓰기 호출: 잘림 사실을 그대로 올린다(호출자가 그 사용자를 실패로 적는다)
}

/** -B(batch) 출력의 이스케이프 복원: \t \n \r \0 \\ */
function unesc(s) {
  if (s.indexOf('\\') < 0) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i === s.length - 1) { out += s[i]; continue; }
    const c = s[++i];
    out += c === 't' ? '\t' : c === 'n' ? '\n' : c === 'r' ? '\r' : c === '0' ? '\0' : c;
  }
  return out;
}
const rows = (out) => out.split(/\r?\n/).filter((l) => l.length > 0).map((l) => l.split('\t').map(unesc));
const cleanErr = (e) => String(e || '').trim().split('\n').filter((l) => !/\[Warning\]/.test(l)).join(' ');

/** 접속·환경 계열 errno 는 불변식 위반이 아니라 환경 실패다. */
const ENV_ERRNOS = new Set([1049, 2002, 2003, 2005, 2006, 2013]);

function mustQuery(sql, what) {
  const r = mysqlRun('SET NAMES utf8mb4;\n' + sql, { readOnly: true, what });
  if (!r.ok) {
    if (r.errno == null || ENV_ERRNOS.has(r.errno)) envFail('MySQL 조회 실패(' + what + '): ' + cleanErr(r.err));
    envFail('MySQL 조회 실패(' + what + '): ' + cleanErr(r.err));
  }
  return rows(r.out);
}

/** SQL 문자열 리터럴 — 백슬래시·작은따옴표 이스케이프. null/undefined → NULL */
function q(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}
/** 정수 리터럴 — null 은 NULL. 정수가 아니면 즉시 터뜨린다(조용한 오염 방지). */
function I(v) {
  if (v === null || v === undefined) return 'NULL';
  if (!Number.isInteger(v)) throw new Error('정수가 아닌 값을 정수 자리에 넣으려 했습니다: ' + v);
  return String(v);
}
/** 고정소수 리터럴(cal_task_hours.hours 전용) */
function F(v) {
  if (v === null || v === undefined) return 'NULL';
  if (!Number.isFinite(v)) throw new Error('숫자가 아닌 값을 소수 자리에 넣으려 했습니다: ' + v);
  return v.toFixed(2);
}

/* ══════════════════════════ 3. 대상 사용자 산정 ══════════════════════════ */
/* ★ 앱과 같은 규칙이어야 한다 — widget/ProjectDb.cs 의 CanViewScheduleAsync 와
 *   ExpandUnitTree 를 그대로 옮긴 것이다(이름 기준 트리 순회까지 동일).
 *     view_scope='all'       → 활성 사용자 전원
 *     view_scope='unit_tree' → 내 조직 + 그 아래 모든 자손 조직 소속자
 *     그 밖('self'·미지값)   → 자기 자신뿐 (앱도 미지값을 거부로 떨어뜨린다)                */

function loadUsers() {
  const r = mustQuery(
    'SELECT u.user_id, u.login_id, IFNULL(u.name,' + q('') + '), IFNULL(u.org_id,0), IFNULL(o.name,' + q('') + '),' +
    ' IFNULL(u.view_scope,' + q('') + '), u.is_active' +
    ' FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id ORDER BY u.user_id;', '사용자 목록');
  return r.map((c) => ({
    userId: Number(c[0]), loginId: c[1], name: c[2], orgId: Number(c[3]),
    orgUnit: c[4], scope: c[5], active: c[6] === '1',
  }));
}

function loadOrgUnits() {
  // 앱과 같은 조건: is_active=1 만 읽고 sort_order, name 순.
  const r = mustQuery(
    'SELECT t.name, IFNULL(p.name,' + q('') + '), IFNULL(t.sort_order,0)' +
    ' FROM org_unit t LEFT JOIN org_unit p ON p.org_id = t.parent_id' +
    ' WHERE t.is_active=1 ORDER BY t.sort_order, t.name;', '조직 목록');
  return r.filter((c) => c[0].length > 0).map((c) => ({ name: c[0], parent: c[1], sortOrder: Number(c[2]) }));
}

/** ProjectDb.ExpandUnitTree 포팅 — 이름 기준 BFS, 방문 집합 가드. */
function expandUnitTree(units, myUnit) {
  const allowed = new Set();
  const root = (myUnit || '').trim();
  if (root.length === 0) return allowed;
  const children = new Map();
  for (const u of units) {
    if (u.parent.length === 0) continue;
    if (!children.has(u.parent)) children.set(u.parent, []);
    children.get(u.parent).push(u.name);
  }
  allowed.add(root);                    // 내 소속은 org_unit 에 없더라도 항상 내 범위다(앱과 동일)
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift();
    const kids = children.get(cur);
    if (!kids) continue;
    for (const k of kids) if (!allowed.has(k)) { allowed.add(k); queue.push(k); }
  }
  return allowed;
}

/** 대상 사용자와 '왜 제외했는지' 를 함께 돌려준다(요약에 그대로 찍는다). */
function resolveTargets(users) {
  const active = users.filter((u) => u.active);
  const excluded = [];
  const inactive = users.length - active.length;
  if (inactive > 0) excluded.push('비활성(is_active=0) ' + inactive + '명');

  let viewer = null, mode = '';
  let pool;

  if (OPT.users) {
    const byLogin = new Map(users.map((u) => [u.loginId, u]));
    const missing = OPT.users.filter((l) => !byLogin.has(l));
    if (missing.length) envFail('--users 에 없는 login_id 가 있습니다: ' + missing.join(', '));
    pool = OPT.users.map((l) => byLogin.get(l)).filter((u) => u.active);
    mode = '--users 직접 지정(' + OPT.users.length + '명 요청)';
  } else if (OPT.allUsers) {
    pool = active;
    mode = '--all-users(권한 무시)';
    // ★ 권한 계산은 건너뛰지만 '뷰어 본인 보존' 은 유지한다 — 개발자 본인 데이터가
    //   옵션 하나로 조용히 날아가는 쪽이 훨씬 나쁘다. 지우려면 --include-self 를 명시할 것.
    viewer = users.find((u) => u.loginId === OPT.viewer) || null;
  } else {
    viewer = users.find((u) => u.loginId === OPT.viewer) || null;
    if (!viewer) envFail('뷰어 login_id 를 app_user 에서 찾을 수 없습니다: ' + OPT.viewer);
    if (viewer.scope === 'all') {
      pool = active;
      mode = "view_scope='all' → 활성 전원";
    } else if (viewer.scope === 'unit_tree') {
      const allowed = expandUnitTree(loadOrgUnits(), viewer.orgUnit);
      pool = active.filter((u) => u.orgUnit.length > 0 && allowed.has(u.orgUnit));
      // 뷰어 자신은 소속이 비어 있어도 언제나 볼 수 있다(앱의 '자기 자신은 언제나 참').
      if (!pool.some((u) => u.userId === viewer.userId)) pool = pool.concat([viewer]);
      mode = "view_scope='unit_tree' → 하위 트리 " + allowed.size + '개 조직';
      excluded.push('열람 범위 밖 ' + (active.length - pool.length) + '명');
    } else {
      pool = [viewer];
      mode = "view_scope='" + viewer.scope + "' → 자기 자신뿐";
      excluded.push('열람 범위 밖 ' + (active.length - 1) + '명');
    }
  }

  let targets = pool;
  if (viewer && !OPT.includeSelf) {
    const before = targets.length;
    targets = targets.filter((u) => u.userId !== viewer.userId);
    if (targets.length < before) excluded.push('뷰어 본인 1명(--include-self 로 포함 가능)');
  }
  // 중복 제거(안전장치) + user_id 순
  const seen = new Set();
  targets = targets.filter((u) => (seen.has(u.userId) ? false : (seen.add(u.userId), true)))
    .sort((a, b) => a.userId - b.userId);
  return { viewer, mode, targets, excluded };
}

/* ══════════════════════════ 4. 더미 소재 ══════════════════════════ */

// DB 등록 과제 색 — section 별로 고정한다(같은 과제가 89명에게 같은 색으로 보여야 한다).
const DB_SECTION_COLORS = { 일반계약: '#3e5be0', 사업부관리: '#8a5cf6', 선진행: '#c2770a' };
const FALLBACK_COLOR = '#5b6b7d';

// 앱 PALETTE — 일반과제 색은 여기서만 고른다.
const PALETTE = ['#3e5be0', '#2e9e6b', '#d6494e', '#e08a00', '#8a4fd0', '#0f9bb5', '#c43f8e', '#5b6b7d',
  '#7a9a01', '#b05c2a', '#0ea5e9', '#0d9488', '#65a30d', '#ca8a04', '#e0457b', '#6d28d9', '#475569', '#0891b2'];

// 일반과제 이름 풀. 각 이름마다 어울리는 일정 제목을 붙여 둔다 —
// 제목이 과제와 따로 놀면 한눈에 더미 티가 나고, 그러면 UI 평가 자체가 왜곡된다.
const LOCAL_CATS = [
  { name: '보고서 작성', titles: ['주간보고 작성', '월간보고 정리', '일일 업무보고', '진척 보고서 작성', '실적 자료 취합'] },
  { name: '시스템 점검', titles: ['정기 점검', '서버 상태 점검', '백업 확인', '로그 점검', '네트워크 점검'] },
  { name: '사내 교육', titles: ['사내 보안 교육', '신규 도구 교육', '안전 교육', '품질 교육 수강', '신입 멘토링'] },
  { name: '회의·검토', titles: ['팀 주간회의', '기술 검토 회의', '일정 조율 회의', '부서 협의', '월례 회의'] },
  { name: '문서 정리', titles: ['산출물 정리', '회의록 정리', '자료 아카이빙', '양식 갱신', '매뉴얼 보완'] },
  { name: '코드 리뷰', titles: ['PR 리뷰', '리팩토링 검토', '정적분석 결과 확인', '코드 컨벤션 점검', '머지 요청 확인'] },
  { name: '출장', titles: ['고객사 출장', '현장 지원 출장', '협력사 방문', '지방 출장', '본사 방문'] },
  { name: '연차', titles: ['연차', '오전 반차', '오후 반차', '경조 휴가', '대체 휴무'] },
  { name: '기술 검토', titles: ['신기술 조사', '대안 비교 검토', '성능 분석', '아키텍처 검토', '도입 타당성 검토'] },
  { name: '품질 점검', titles: ['품질 지표 점검', '결함 추이 확인', '시험 결과 검토', 'QA 회의', '부적합 조치 확인'] },
  { name: '고객 대응', titles: ['고객 문의 대응', '현장 이슈 대응', '요구사항 협의', '정기 고객 미팅', '장애 대응'] },
  { name: '형상 관리', titles: ['형상 항목 등록', '베이스라인 설정', '변경 이력 정리', '릴리스 태깅', '저장소 정리'] },
  { name: '시험 준비', titles: ['시험 환경 구성', '시험 항목 작성', '예비 시험', '시험 데이터 준비', '시험 일정 협의'] },
  { name: '자료 조사', titles: ['시장 자료 조사', '규격 문서 확인', '참고 사례 수집', '벤치마크 조사', '논문 검토'] },
];

const DB_TITLES = ['요구사항 검토 회의', '1차 산출물 검수', '고객 시연 준비', '설계 리뷰', '인터페이스 정의서 작성',
  '단위시험 수행', '통합시험 준비', '착수 보고 준비', '중간 보고 자료 작성', '완료 보고 준비',
  '현장 설치 지원', '기술 협의', '형상 항목 정리', '산출물 목록 점검', '변경 요청 검토', '납품 자료 정리'];

const MISC_TITLES = ['개인 일정', '병원 예약', '차량 점검', '은행 업무', '가족 행사', '자격증 공부', '건강검진', '장비 반납'];

// 제목 변주 — 같은 제목이 사람마다 똑같이 반복되면 더미 티가 난다(브리프 ★).
const PREFIXES = ['', '', '', '[정기] ', '[긴급] ', '1차 ', '2차 ', '사전 ', '후속 '];
const SUFFIXES = ['', '', '', '', ' (오전)', ' (오후)', ' — 2차', ' 후속'];

const MEMOS = ['담당자 확인 필요', '자료 미리 공유할 것', '지난 회의 결과 반영', '이슈 목록 정리해서 가져가기',
  '결과는 팀 채널에 공유', '관련 문서 링크 첨부', '예상 소요 2시간', '참석 대상 재확인'];
const LOCATIONS = ['회의실 A', '회의실 B', '3층 회의실', '대회의실', '고객사', '온라인', '현장', '본사 1층 라운지'];
const REMINDS = [0, 5, 10, 30, 60];

const COMMIT_SUBJECTS = ['로그인 처리 오류 수정', '목록 조회 성능 개선', '설정 파일 정리', '예외 처리 보완',
  '단위 테스트 추가', '리팩토링: 중복 제거', '문서 갱신', '빌드 스크립트 수정', 'UI 여백 조정',
  '쿼리 인덱스 추가', '로그 메시지 정리', '경계값 처리 수정'];
const COMMIT_BODIES = ['', '', '', '재현 절차와 원인은 이슈에 적어 두었다.', '동작 확인: 로컬 · 개발 서버',
  '기존 동작은 그대로 두고 내부 구현만 바꿨다.'];

const TODO_TEXTS = ['월간 보고서 초안 작성', '회의록 공유', '시험 결과 정리', '예산 집행 확인', '자료 취합 요청',
  '장비 반납 처리', '교육 이수 등록', '산출물 검토 회신', '일정표 갱신', '고객 회신 대기',
  '변경 이력 정리', '점검 체크리스트 작성', '협력사 견적 확인', '휴가 계획 제출'];
const TODO_NOTES = ['담당자와 협의 후 진행', '다음 주까지 마무리', '관련 자료는 공유 폴더에', '선행 작업 완료 후 착수'];
const DAY_NOTES = ['오전에 초안 작성', '검토 의견 반영', '최종 확인 후 제출', '자료 취합', '담당자 회신 대기'];

// 근태 코드 — 유효 집합은 이것뿐이고, '미기록' 은 NULL 이 아니라 **행 부재** 로 표현한다.
const ATTEND_CODES = ['1', '2', '3', '4', '5', '6', '7', '9', '10', '11', '12'];
const ATTEND_MIX = [[78, '1'], [8, '2'], [4, '4'], [3, '5'], [3, '6'], [4, '12']];

/* ══════════════════════════ 5. 날짜 창 ══════════════════════════ */
// 오늘(2026-09-03) 기준으로 과거·현재·미래가 모두 보이도록 6월~10월을 덮는다.
const WIN_FROM = Date.UTC(2026, 5, 1);    // 2026-06-01
const WIN_TO = Date.UTC(2026, 9, 31);     // 2026-10-31
const MS_D = 86400000;

const pad2 = (v) => String(v).padStart(2, '0');
function ymd(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
function fmtDt(ms) {
  const d = new Date(ms);
  return ymd(ms) + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds()) + '.000';
}
function addMonthsMs(ms, k) {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(day, last));
}

const DAYS = [];
for (let ms = WIN_FROM; ms <= WIN_TO; ms += MS_D) {
  const dow = new Date(ms).getUTCDay();
  DAYS.push({ ms, s: ymd(ms), dow, weekend: dow === 0 || dow === 6 });
}
const WEEKDAYS = DAYS.filter((d) => !d.weekend);
// 주말은 밀도를 크게 낮춘다 — 가중치 10:1.
const DAY_BAG = [];
for (const d of DAYS) { const w = d.weekend ? 1 : 10; for (let i = 0; i < w; i++) DAY_BAG.push(d); }

/* ══════════════════════════ 6. 사용자 1명치 더미 생성 ══════════════════════════ */

function makeGen(rng) {
  const rint = (n) => Math.floor(rng() * n);
  const pick = (arr) => arr[rint(arr.length)];
  const chance = (p) => rng() < p;
  const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
  const b36 = (len) => { let s = ''; for (let i = 0; i < len; i++) s += B36[rint(36)]; return s; };
  const hex = (len) => { let s = ''; for (let i = 0; i < len; i++) s += '0123456789abcdef'[rint(16)]; return s; };
  function pickWeighted(pairs) {
    const total = pairs.reduce((a, p) => a + p[0], 0);
    let r = rng() * total;
    for (const [w, v] of pairs) { r -= w; if (r <= 0) return v; }
    return pairs[pairs.length - 1][1];
  }
  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = rint(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  return { rint, pick, chance, b36, hex, pickWeighted, shuffled, rng };
}

/** 조직에 맞는 section 가중치 — 사업부·경영지원은 '사업부관리' 쪽으로 기운다. */
function sectionWeights(orgId) {
  if (orgId === 4) return { 사업부관리: 6, 일반계약: 2, 선진행: 1 };
  if (orgId === 5) return { 사업부관리: 5, 일반계약: 2, 선진행: 1 };
  return { 일반계약: 6, 선진행: 3, 사업부관리: 1 };   // SW/시스템 팀 및 그 밖
}

/**
 * 사용자 1명분 더미를 만든다. DB 를 보지 않고 순수 계산만 한다(테스트·dry-run 이 쉬워진다).
 * @param user   {userId, loginId, name, orgId}
 * @param projects [{uid, section, label}]
 * @param seed   씨앗(= OPT.seed ^ user_id)
 */
function buildUserData(user, projects, seed) {
  const g = makeGen(mulberry32((seed ^ user.userId) >>> 0));
  const { rint, pick, chance, b36, hex, pickWeighted, shuffled } = g;

  /* ── 6-1. 카테고리 ─────────────────────────────────────────────── */
  const wants = sectionWeights(user.orgId);
  const bySection = new Map();
  for (const p of projects) {
    if (!bySection.has(p.section)) bySection.set(p.section, []);
    bySection.get(p.section).push(p);
  }
  const dbWant = 3 + rint(3);              // 3~5개
  const chosen = [];
  const usedUid = new Set();
  let guard = 0;
  while (chosen.length < dbWant && guard++ < 200) {
    const secPairs = [...bySection.keys()].map((s) => [wants[s] || 1, s]);
    const sec = pickWeighted(secPairs);
    const cand = bySection.get(sec);
    const p = cand[rint(cand.length)];
    if (usedUid.has(p.uid)) continue;
    usedUid.add(p.uid);
    chosen.push(p);
  }

  const localWant = 3 + rint(3);           // 3~5개
  const localPicked = shuffled(LOCAL_CATS).slice(0, localWant);
  const colorBag = shuffled(PALETTE);

  const cats = [];
  let catNo = 0;
  for (const p of chosen) {
    cats.push({
      catNo: ++catNo, kind: 'db',
      uid: 'db-' + p.uid, source: 'db', name: p.label,
      color: DB_SECTION_COLORS[p.section] || FALLBACK_COLOR,
      description: chance(0.3) ? p.section + ' 과제' : '',
      projectUid: p.uid, usesRepo: 0, titles: DB_TITLES,
    });
  }
  const catUids = new Set();
  const newCatUid = () => {
    let u = 'c-' + b36(8) + '-' + b36(8), n = 0;
    while (catUids.has(u) && n++ < 50) u = 'c-' + b36(8) + '-' + b36(8);
    catUids.add(u);
    return u;
  };
  localPicked.forEach((lc, i) => {
    cats.push({
      catNo: ++catNo, kind: 'local',
      uid: newCatUid(), source: 'local', name: lc.name,
      color: colorBag[i % colorBag.length],
      description: chance(0.25) ? lc.name + ' 관련 개인 과제' : '',
      projectUid: null, usesRepo: 0, titles: lc.titles,
    });
  });
  // 저장소를 쓰는 과제 1개 — git 수집 일정이 붙을 자리다(DB 과제는 uses_repo=0 규약이라 일반과제에 둔다).
  const repoCat = cats.find((c) => c.kind === 'local') || null;
  if (repoCat) repoCat.usesRepo = 1;

  // 표시 순서는 섞는다(일반과제가 먼저 오기도, 뒤에 오기도 한다).
  shuffled(cats).forEach((c, i) => { c.sortOrder = i; });

  /* ── 6-2. 일정 ─────────────────────────────────────────────────── */
  const entryCount = 25 + rint(36);        // 25~60개
  const entries = [];
  const entryUids = new Set();
  const catBag = [];
  for (const c of cats) { const w = c.kind === 'db' ? 3 : 2; for (let i = 0; i < w; i++) catBag.push(c); }

  function newUid(prefix, set) {
    let u = prefix + '-' + b36(8) + '-' + b36(8);
    let n = 0;
    while (set.has(u) && n++ < 50) u = prefix + '-' + b36(8) + '-' + b36(8);
    set.add(u);
    return u;
  }
  function titleFor(cat) {
    const base = cat ? pick(cat.titles) : pick(MISC_TITLES);
    let t = pick(PREFIXES) + base + pick(SUFFIXES);
    // DB 과제는 가끔 과제명을 앞에 붙인다 — 팝업에서 어느 과제의 일정인지 바로 읽힌다.
    if (cat && cat.kind === 'db' && chance(0.35)) t = cat.name + ' ' + base;
    return t.trim();
  }
  function stamps(dayMs) {
    const c = dayMs - (1 + rint(14)) * MS_D + rint(600) * 60000;
    const u = c + rint(600) * 60000;
    return [fmtDt(c), fmtDt(u)];
  }

  for (let i = 0; i < entryCount; i++) {
    const day = pick(DAY_BAG);
    const cat = chance(0.10) ? null : pick(catBag);     // ~10% 미분류
    const kind = pickWeighted([[55, 'allday'], [25, 'timed'], [10, 'span'], [7, 'recur'], [3, 'git']]);
    const [createdAt, updatedAt] = stamps(day.ms);
    const e = {
      uid: newUid('e', entryUids), catNo: cat ? cat.catNo : null,
      entryDate: day.s, endDate: null, allDay: 1, startTime: null, endTime: null,
      title: titleFor(cat), memo: '', source: '', location: '', remind: null,
      recurFreq: null, recurInterval: null, recurUntil: null, recurCount: null,
      createdAt, updatedAt, commits: [], excepts: [],
    };

    if (kind === 'timed') {
      const sh = 9 + rint(7);                           // 09~15시 시작
      const dur = 1 + rint(3);
      const eh = Math.min(18, sh + dur);
      e.allDay = 0;
      e.startTime = pad2(sh) + ':' + (chance(0.5) ? '00' : '30') + ':00';
      e.endTime = pad2(eh) + ':' + (eh === 18 ? '00' : chance(0.5) ? '00' : '30') + ':00';
      // end > start 를 반드시 보장한다(V6). 같은 시각이 나오면 30분 뒤로 민다.
      if (e.endTime <= e.startTime) e.endTime = pad2(Math.min(18, sh + 1)) + ':30:00';
      if (e.endTime <= e.startTime) { e.startTime = '09:00:00'; e.endTime = '10:00:00'; }
    } else if (kind === 'span') {
      e.endDate = ymd(day.ms + (1 + rint(4)) * MS_D);
    } else if (kind === 'recur') {
      e.recurFreq = chance(0.7) ? 'weekly' : 'monthly';
      e.recurInterval = 1 + rint(2);
      if (chance(0.5)) {
        // 종료일이 있는 반복. chk_cal_entry_recur 가 recur_count 를 NOT NULL 로 요구하므로 0(=제한 없음).
        const span = e.recurFreq === 'weekly' ? (8 + rint(9)) * 7 * MS_D : 0;
        e.recurUntil = e.recurFreq === 'weekly' ? ymd(day.ms + span) : ymd(addMonthsMs(day.ms, 3 + rint(4)));
        e.recurCount = 0;
      } else {
        e.recurCount = 4 + rint(9);
        e.recurUntil = null;
      }
      // 예외일 — 반복 중 몇 회차를 실제로 건너뛴 모습(첫 회차는 남긴다).
      if (chance(0.6)) {
        const howMany = 1 + rint(3);
        const seen = new Set();
        for (let k = 0; k < howMany; k++) {
          const idx = 1 + rint(6);
          const occ = e.recurFreq === 'weekly'
            ? day.ms + idx * e.recurInterval * 7 * MS_D
            : addMonthsMs(day.ms, idx * e.recurInterval);
          const s = ymd(occ);
          if (!seen.has(s)) { seen.add(s); e.excepts.push(s); }   // PK 중복(1062) 방지 — 앱 어댑터와 같은 dedup
        }
      }
    } else if (kind === 'git') {
      // git 수집 일정: 기간·반복 개념이 없다(chk_cal_entry_git).
      const n = 1 + rint(8);
      e.source = 'git';
      e.title = (cat ? cat.name : '작업') + ' · 커밋 ' + n + '건';
      for (let s = 0; s < n; s++) {
        const h = hex(40);
        e.commits.push({
          seq: s, hash: h, shortHash: h.slice(0, 7),
          commitTime: pad2(9 + rint(10)) + ':' + pad2(rint(60)) + ':00',
          subject: pick(COMMIT_SUBJECTS), body: pick(COMMIT_BODIES),
        });
      }
    }

    if (e.source !== 'git') {
      if (chance(0.25)) e.memo = pick(MEMOS);
      if (chance(0.15)) e.location = pick(LOCATIONS);
      if (chance(0.10)) e.remind = pick(REMINDS);
    }
    entries.push(e);
  }

  /* ★★ sort_order 는 **사용자별 전역 0..N-1** 이다. 날짜별로 0 부터 다시 시작하지 말 것. ★★
   *   근거 — 앱의 일정 조회 두 곳이 **둘 다 날짜 없이** sort_order 로만 정렬한다
   *   (widget/CalendarDb.cs, 실측):
   *     · 부팅 조회(:587)     ORDER BY e.sort_order, e.uid   ← **날짜가 없다**
   *     · 타인 열람 조회(:341) ORDER BY e.sort_order, e.uid
   *   ※ 열람 조회는 2026-09-03 까지 entry_date 를 앞세우고 있었고(주석만 '같은 정렬'이라 적혀 있었다),
   *      이 더미를 넣다가 그 불일치가 드러나 함께 고쳤다. 지금은 tests/schema-guards.test.mjs 의
   *      '스키마 가드 ⑩' 이 두 ORDER BY 가 같은지를 매 실행 검사한다.
   *   즉 sort_order 는 '그 날짜 안의 순번' 이 아니라 **state.entries 배열 전체의 순서**다
   *   (cal_entry.sort_order 컬럼 주석이 말하는 그것). 날짜별 0,1,2… 로 넣으면 값이 거의 전부 0 이
   *   되어 부팅 조회에서 전역 순서가 uid 사전순으로 무너진다 — 실앱 데이터와 모양이 달라지고,
   *   그 상태로는 '순서가 뒤집혔다' 류의 결함을 더미로 재현할 수 없다.
   *   ★ 실앱 데이터(user_id=58)가 전역임을 확인했다: 06-11 → 0,1,21 · 06-12 → 2 · 06-16 → 3,4,18.
   *   배정 규칙: entry_date 오름차순으로 0..N-1. 같은 날짜 안에서는 생성 순서를 유지한다
   *   (JS sort 는 안정 정렬이라 아래 한 줄로 보장된다).                                            */
  entries.sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0));
  entries.forEach((e, i) => {
    e.entryNo = i + 1;      // 번호는 1부터(계약 H-1). ★ sort_order 와 다른 값이다
    e.sortOrder = i;        // 전역 0..N-1 — 위 ★★ 참조
  });

  /* ── 6-3. 할 일 ────────────────────────────────────────────────── */
  const todoCount = 3 + rint(8);           // 3~10개
  const todos = [];
  const todoUids = new Set();
  const todoTexts = shuffled(TODO_TEXTS);
  for (let i = 0; i < todoCount; i++) {
    const day = pick(DAY_BAG);
    const [createdAt, updatedAt] = stamps(day.ms);
    const t = {
      todoNo: i + 1, uid: newUid('t', todoUids),
      catNo: chance(0.75) ? pick(cats).catNo : null,
      text: todoTexts[i % todoTexts.length],
      note: '', due: null, endDate: null, done: 0, prio: chance(0.25) ? 'high' : 'normal',
      // ★ 할 일의 sort_order 도 **사용자별 전역 0..N-1** 이다(일정과 같은 근거).
      //   부팅 조회는 due 로 정렬하지 않는다 — due 는 NULL(기한 없음)이 정상 상태라 정렬키가 못 된다.
      //   실앱 데이터(user_id=58)도 todo_no 1..10 에 sort_order 0..9 가 그대로 붙어 있다.
      completedAt: null, sortOrder: i, createdAt, updatedAt, dayNotes: [],
    };
    if (chance(0.7)) {
      t.due = day.s;
      // 기간 할일 — 이때 note 는 반드시 ''(설명은 day_note 로 간다. 스키마 계약).
      if (chance(0.3)) t.endDate = ymd(day.ms + (1 + rint(5)) * MS_D);
    }
    if (!t.endDate && chance(0.4)) t.note = pick(TODO_NOTES);
    if (chance(0.35)) {
      t.done = 1;
      t.completedAt = fmtDt(day.ms + (6 + rint(12)) * 3600000);   // done=1 일 때만 채운다(chk_cal_todo_comp)
    }
    todos.push(t);
  }
  // 1~2개에 날짜별 설명을 붙인다 — 기간 할일에만(앱이 due..end 범위를 강제한다).
  const spanTodos = todos.filter((t) => t.endDate);
  const noteTargets = (spanTodos.length ? spanTodos : todos.filter((t) => t.due)).slice(0, 1 + rint(2));
  for (const t of noteTargets) {
    if (!t.due) continue;
    const from = Date.parse(t.due + 'T00:00:00Z');
    const to = t.endDate ? Date.parse(t.endDate + 'T00:00:00Z') : from;
    const span = Math.round((to - from) / MS_D);
    const seen = new Set();
    const howMany = 1 + rint(3);
    for (let k = 0; k < howMany; k++) {
      const d = ymd(from + rint(span + 1) * MS_D);
      if (seen.has(d)) continue;
      seen.add(d);
      t.dayNotes.push({ date: d, text: pick(DAY_NOTES) });
    }
  }

  /* ── 6-4. 공수(cal_task_hours) ─────────────────────────────────── */
  // 하루 합계가 8.0 을 넘지 않게 한다 — 넘으면 그 숫자가 회사 보고로 나갈 때 말이 안 된다.
  const hourDays = shuffled(WEEKDAYS).slice(0, 26 + rint(9)).sort((a, b) => a.ms - b.ms);
  const taskHours = [];
  for (const d of hourDays) {
    const howMany = Math.min(cats.length, 2 + rint(2));      // 2~3개 과제에 배분
    const picked = shuffled(cats).slice(0, howMany);
    let left = pickWeighted([[2, 4], [3, 6], [3, 7], [4, 8]]);  // 그날 총 공수(시간)
    picked.forEach((c, i) => {
      const last = i === picked.length - 1;
      let h;
      if (last) h = left;
      else {
        const maxHere = left - 0.5 * (picked.length - 1 - i);
        const units = Math.max(1, Math.floor(maxHere * 2) - 1);
        h = (1 + rint(Math.max(1, units))) * 0.5;
        if (h > maxHere) h = maxHere;
      }
      h = Math.round(h * 2) / 2;
      if (h <= 0) return;
      left = Math.round((left - h) * 2) / 2;
      taskHours.push({ date: d.s, catNo: c.catNo, hours: h, updatedAt: fmtDt(d.ms + 10 * 3600000) });
    });
  }

  /* ── 6-5. 근태 ─────────────────────────────────────────────────── */
  // 평일의 ~60%만 행을 만든다. 나머지는 **행 자체를 만들지 않는다**(= 미기록).
  const attendance = [];
  for (const d of WEEKDAYS) {
    if (!chance(0.6)) continue;
    const status = pickWeighted(ATTEND_MIX);
    attendance.push({
      date: d.s, status,
      overtime: status === '2' ? 1 + rint(4) : 0,           // overtime 은 NOT NULL(0..11)
      updatedAt: fmtDt(d.ms + 18 * 3600000),
    });
  }

  return { cats, entries, todos, taskHours, attendance };
}

/* ══════════════════════════ 7. SQL 조립 ══════════════════════════ */

const CHUNK = 200;   // 한 INSERT 에 담는 행 수 — max_allowed_packet 여유를 둔다.

function insertChunks(out, table, cols, valueRows) {
  for (let i = 0; i < valueRows.length; i += CHUNK) {
    const part = valueRows.slice(i, i + CHUNK);
    out.push('INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES\n' +
      part.map((r) => '  (' + r.join(', ') + ')').join(',\n') + ';');
  }
}

function buildUserSql(userId, data) {
  const uid = I(userId);
  const out = ['SET NAMES utf8mb4;', 'START TRANSACTION;'];

  // R2 — FK 순서. cal_category 는 cal_entry·cal_todo·cal_task_hours 가 RESTRICT 로 잡고 있어 맨 마지막.
  out.push('DELETE FROM cal_task_hours WHERE user_id = ' + uid + ';');
  out.push('DELETE FROM cal_entry      WHERE user_id = ' + uid + ';');   // commit·except 는 CASCADE
  out.push('DELETE FROM cal_todo       WHERE user_id = ' + uid + ';');   // day_note 는 CASCADE
  out.push('DELETE FROM cal_category   WHERE user_id = ' + uid + ';');
  out.push('DELETE FROM cal_attendance WHERE user_id = ' + uid + ';');   // FK 없음 — 독립

  insertChunks(out, 'cal_category',
    ['user_id', 'cat_no', 'uid', 'source', 'name', 'color', 'description', 'project_uid', 'uses_repo', 'sort_order', 'created_at', 'updated_at'],
    data.cats.map((c) => [uid, I(c.catNo), q(c.uid), q(c.source), q(c.name), q(c.color), q(c.description),
      q(c.projectUid), I(c.usesRepo), I(c.sortOrder), q(CAT_TS), q(CAT_TS)]));

  insertChunks(out, 'cal_entry',
    ['user_id', 'entry_no', 'uid', 'cat_no', 'entry_date', 'end_date', 'all_day', 'start_time', 'end_time',
      'title', 'memo', 'source', 'location', 'remind', 'recur_freq', 'recur_interval', 'recur_until', 'recur_count',
      'sort_order', 'created_at', 'updated_at'],
    data.entries.map((e) => [uid, I(e.entryNo), q(e.uid), I(e.catNo), q(e.entryDate), q(e.endDate), I(e.allDay),
      q(e.startTime), q(e.endTime), q(e.title), q(e.memo), q(e.source), q(e.location), I(e.remind),
      q(e.recurFreq), I(e.recurInterval), q(e.recurUntil), I(e.recurCount), I(e.sortOrder),
      q(e.createdAt), q(e.updatedAt)]));

  const commitRows = [];
  for (const e of data.entries) for (const c of e.commits) {
    commitRows.push([uid, I(e.entryNo), I(c.seq), q(c.hash), q(c.shortHash), q(c.commitTime), q(c.subject), q(c.body)]);
  }
  insertChunks(out, 'cal_entry_commit',
    ['user_id', 'entry_no', 'seq', 'hash', 'short_hash', 'commit_time', 'subject', 'body'], commitRows);

  const exceptRows = [];
  for (const e of data.entries) for (const d of e.excepts) exceptRows.push([uid, I(e.entryNo), q(d)]);
  insertChunks(out, 'cal_entry_except', ['user_id', 'entry_no', 'except_date'], exceptRows);

  insertChunks(out, 'cal_todo',
    ['user_id', 'todo_no', 'uid', 'cat_no', 'todo_text', 'note', 'due', 'end_date', 'done', 'prio',
      'completed_at', 'sort_order', 'created_at', 'updated_at'],
    data.todos.map((t) => [uid, I(t.todoNo), q(t.uid), I(t.catNo), q(t.text), q(t.note), q(t.due), q(t.endDate),
      I(t.done), q(t.prio), q(t.completedAt), I(t.sortOrder), q(t.createdAt), q(t.updatedAt)]));

  const dayNoteRows = [];
  for (const t of data.todos) for (const dn of t.dayNotes) dayNoteRows.push([uid, I(t.todoNo), q(dn.date), q(dn.text)]);
  insertChunks(out, 'cal_todo_day_note', ['user_id', 'todo_no', 'note_date', 'note_text'], dayNoteRows);

  insertChunks(out, 'cal_task_hours', ['user_id', 'work_date', 'cat_no', 'hours', 'updated_at'],
    data.taskHours.map((h) => [uid, q(h.date), I(h.catNo), F(h.hours), q(h.updatedAt)]));

  insertChunks(out, 'cal_attendance', ['user_id', 'work_date', 'status', 'overtime', 'updated_at'],
    data.attendance.map((a) => [uid, q(a.date), q(a.status), I(a.overtime), q(a.updatedAt)]));

  // R3 — 리비전은 지우지 않고 올리기만 한다. 앱은 이 값으로 '남의 달력이 바뀌었다' 를 안다.
  out.push('INSERT INTO cal_user_rev (user_id, rev) VALUES (' + uid + ', 1) ' +
    'ON DUPLICATE KEY UPDATE rev = rev + 1;');
  out.push('COMMIT;');
  return out.join('\n');
}

// 카테고리 타임스탬프는 고정값이다 — 과제는 '언제 만들었는지' 가 화면에 안 나오고,
// 고정해 두면 재실행 결과가 바이트 단위로 같아 멱등성 대조가 쉬워진다.
const CAT_TS = '2026-05-25 00:30:00.000';

function countRows(data) {
  let commits = 0, excepts = 0, dayNotes = 0;
  for (const e of data.entries) { commits += e.commits.length; excepts += e.excepts.length; }
  for (const t of data.todos) dayNotes += t.dayNotes.length;
  return {
    cal_category: data.cats.length, cal_entry: data.entries.length,
    cal_entry_commit: commits, cal_entry_except: excepts,
    cal_todo: data.todos.length, cal_todo_day_note: dayNotes,
    cal_task_hours: data.taskHours.length, cal_attendance: data.attendance.length,
  };
}

/* ══════════════════════════ 8. 검증 ══════════════════════════ */

const V_LABELS = {
  V1: '대상 전원이 cal_category ≥ 6 · cal_entry ≥ 20',
  V2: "대상 전원이 source='db' 와 source='local' 카테고리를 둘 다 가진다",
  V3: "db 카테고리의 project_uid 가 project 에 실재 · local 카테고리는 project_uid=NULL",
  V4: 'cal_entry.cat_no 고아 0',
  V5: 'cal_entry_commit · cal_entry_except 고아 0',
  V6: 'all_day 와 시각의 정합(종일=시각 NULL · 시간지정=둘 다 있고 end>start)',
  V7: 'end_date 가 있으면 entry_date 이상',
  V8: 'recur_* 는 반복 일정에서만 채워져 있다',
  V9: '(user_id, work_date) 공수 합계 8.0 초과 0건',
  V10: 'cal_attendance.status 가 유효 코드 집합에 속한다(NULL 없음)',
  V11: '대상이 아닌 사용자의 cal_entry 행수 불변',
  V12: 'cal_user_rev — 대상은 증가, 그 외는 불변',
  V13: '보호 대상 표(cal_report_* · cal_migration_log · cal_user_pref · cal_room) 총 행수 불변',
};

const results = [];   // {id, ok, detail}
const okV = (id) => results.push({ id, ok: true, detail: '' });
const badV = (id, detail) => results.push({ id, ok: false, detail });

const inList = (ids) => '(' + ids.join(',') + ')';
const one = (sql, what) => { const r = mustQuery(sql, what); return r.length ? r[0] : []; };

/** V1~V10 — 시딩된 데이터 자체의 불변식(전후 대조가 필요 없다). */
function verifyContent(ids) {
  if (!ids.length) { log('  (검증 대상 사용자가 없다 — V1~V10 생략)'); return; }
  const L = inList(ids);

  // V1
  const r1 = mustQuery(
    'SELECT u.user_id,' +
    ' (SELECT COUNT(*) FROM cal_category c WHERE c.user_id=u.user_id),' +
    ' (SELECT COUNT(*) FROM cal_entry e WHERE e.user_id=u.user_id)' +
    ' FROM app_user u WHERE u.user_id IN ' + L + ';', 'V1');
  const bad1 = r1.filter((c) => Number(c[1]) < 6 || Number(c[2]) < 20);
  bad1.length ? badV('V1', bad1.length + '명 미달 — 예: ' +
    bad1.slice(0, 5).map((c) => 'user_id=' + c[0] + '(cat ' + c[1] + ', entry ' + c[2] + ')').join(', ')) : okV('V1');

  // V2
  const r2 = mustQuery(
    "SELECT user_id, SUM(source='db'), SUM(source='local') FROM cal_category" +
    ' WHERE user_id IN ' + L + ' GROUP BY user_id;', 'V2');
  const have2 = new Map(r2.map((c) => [Number(c[0]), [Number(c[1]), Number(c[2])]]));
  const bad2 = ids.filter((id) => {
    const v = have2.get(id);
    return !v || v[0] < 1 || v[1] < 1;
  });
  bad2.length ? badV('V2', bad2.length + '명이 두 종류를 모두 갖지 못했다 — user_id ' + bad2.slice(0, 8).join(', ')) : okV('V2');

  // V3
  const orphan3 = Number(one('SELECT COUNT(*) FROM cal_category c LEFT JOIN project p ON p.uid = c.project_uid' +
    " WHERE c.user_id IN " + L + " AND c.source='db' AND p.uid IS NULL;", 'V3-a')[0] || 0);
  const local3 = Number(one('SELECT COUNT(*) FROM cal_category' +
    " WHERE user_id IN " + L + " AND source='local' AND project_uid IS NOT NULL;", 'V3-b')[0] || 0);
  (orphan3 || local3) ? badV('V3', 'db 고아 ' + orphan3 + '건 · local 인데 project_uid 가 있는 행 ' + local3 + '건') : okV('V3');

  // V4
  const orphan4 = Number(one('SELECT COUNT(*) FROM cal_entry e' +
    ' LEFT JOIN cal_category c ON c.user_id = e.user_id AND c.cat_no = e.cat_no' +
    ' WHERE e.user_id IN ' + L + ' AND e.cat_no IS NOT NULL AND c.cat_no IS NULL;', 'V4')[0] || 0);
  orphan4 ? badV('V4', '고아 ' + orphan4 + '건') : okV('V4');

  // V5
  const o5a = Number(one('SELECT COUNT(*) FROM cal_entry_commit x LEFT JOIN cal_entry e' +
    ' ON e.user_id = x.user_id AND e.entry_no = x.entry_no' +
    ' WHERE x.user_id IN ' + L + ' AND e.entry_no IS NULL;', 'V5-a')[0] || 0);
  const o5b = Number(one('SELECT COUNT(*) FROM cal_entry_except x LEFT JOIN cal_entry e' +
    ' ON e.user_id = x.user_id AND e.entry_no = x.entry_no' +
    ' WHERE x.user_id IN ' + L + ' AND e.entry_no IS NULL;', 'V5-b')[0] || 0);
  (o5a || o5b) ? badV('V5', 'commit 고아 ' + o5a + '건 · except 고아 ' + o5b + '건') : okV('V5');

  // V6
  const bad6 = Number(one('SELECT COUNT(*) FROM cal_entry WHERE user_id IN ' + L +
    ' AND ((all_day=1 AND (start_time IS NOT NULL OR end_time IS NOT NULL))' +
    '   OR (all_day=0 AND (start_time IS NULL OR end_time IS NULL OR end_time <= start_time)));', 'V6')[0] || 0);
  bad6 ? badV('V6', bad6 + '건') : okV('V6');

  // V7
  const bad7 = Number(one('SELECT COUNT(*) FROM cal_entry WHERE user_id IN ' + L +
    ' AND end_date IS NOT NULL AND end_date < entry_date;', 'V7')[0] || 0);
  bad7 ? badV('V7', bad7 + '건') : okV('V7');

  // V8
  const bad8 = Number(one('SELECT COUNT(*) FROM cal_entry WHERE user_id IN ' + L +
    " AND (((recur_freq IS NULL OR recur_freq='')" +
    '        AND (recur_interval IS NOT NULL OR recur_until IS NOT NULL OR recur_count IS NOT NULL))' +
    "    OR (recur_freq IS NOT NULL AND recur_freq<>''" +
    '        AND (recur_interval IS NULL OR recur_count IS NULL)));', 'V8')[0] || 0);
  bad8 ? badV('V8', bad8 + '건') : okV('V8');

  // V9
  const bad9 = mustQuery('SELECT user_id, work_date, SUM(hours) s FROM cal_task_hours WHERE user_id IN ' + L +
    ' GROUP BY user_id, work_date HAVING s > 8.00 ORDER BY s DESC LIMIT 5;', 'V9');
  bad9.length ? badV('V9', bad9.length + '건 초과 — 예: ' +
    bad9.map((c) => 'user_id=' + c[0] + ' ' + c[1] + ' ' + c[2] + 'h').join(', ')) : okV('V9');

  // V10
  const codes = ATTEND_CODES.map((c) => q(c)).join(',');
  const bad10 = Number(one('SELECT COUNT(*) FROM cal_attendance WHERE user_id IN ' + L +
    ' AND (status IS NULL OR status NOT IN (' + codes + '));', 'V10')[0] || 0);
  bad10 ? badV('V10', bad10 + '건') : okV('V10');
}

const PROTECTED_TABLES = ['cal_report_daily', 'cal_report_weekly', 'cal_report_hours',
  'cal_migration_log', 'cal_user_pref', 'cal_room'];

/** 시딩 전후 대조용 스냅샷. ★ 보호 대상 표는 COUNT(*) 로 '읽기만' 한다(R4 의 예외 — V13 의 근거). */
function snapshot() {
  const entryCounts = new Map(mustQuery(
    'SELECT user_id, COUNT(*) FROM cal_entry GROUP BY user_id;', '스냅샷·cal_entry').map((c) => [Number(c[0]), Number(c[1])]));
  const revs = new Map(mustQuery(
    'SELECT user_id, rev FROM cal_user_rev;', '스냅샷·cal_user_rev').map((c) => [Number(c[0]), Number(c[1])]));
  const protectedCounts = {};
  const sql = PROTECTED_TABLES.map((t) => "SELECT " + q(t) + ", COUNT(*) FROM " + t).join(' UNION ALL ') + ';';
  for (const c of mustQuery(sql, '스냅샷·보호표')) protectedCounts[c[0]] = Number(c[1]);
  return { entryCounts, revs, protectedCounts };
}

/** V11~V13 — 시딩 전후 대조. */
function verifyDelta(before, after, targetIds) {
  const tset = new Set(targetIds);

  // V11 — 대상이 아닌 사용자의 cal_entry 행수가 그대로인가
  const keys = new Set([...before.entryCounts.keys(), ...after.entryCounts.keys()]);
  const moved = [];
  for (const k of keys) {
    if (tset.has(k)) continue;
    const b = before.entryCounts.get(k) || 0, a = after.entryCounts.get(k) || 0;
    if (b !== a) moved.push('user_id=' + k + ' ' + b + '→' + a);
  }
  moved.length ? badV('V11', '대상이 아닌 사용자 ' + moved.length + '명의 행수가 변했다: ' + moved.slice(0, 8).join(', ')) : okV('V11');

  // V12 — 대상은 rev 증가, 그 외는 불변
  const notUp = [], moved12 = [];
  for (const id of targetIds) {
    const b = before.revs.has(id) ? before.revs.get(id) : -1;
    const a = after.revs.has(id) ? after.revs.get(id) : -1;
    if (!(a > b)) notUp.push('user_id=' + id + ' ' + b + '→' + a);
  }
  for (const k of new Set([...before.revs.keys(), ...after.revs.keys()])) {
    if (tset.has(k)) continue;
    if ((before.revs.get(k) || 0) !== (after.revs.get(k) || 0)) moved12.push('user_id=' + k);
  }
  (notUp.length || moved12.length)
    ? badV('V12', '증가하지 않은 대상 ' + notUp.length + '명' + (notUp.length ? '(' + notUp.slice(0, 5).join(', ') + ')' : '') +
      ' · 대상 아닌데 변한 사용자 ' + moved12.length + '명' + (moved12.length ? '(' + moved12.slice(0, 5).join(', ') + ')' : ''))
    : okV('V12');

  // V13 — 보호 대상 표 총 행수 불변
  const diff13 = PROTECTED_TABLES
    .filter((t) => (before.protectedCounts[t] || 0) !== (after.protectedCounts[t] || 0))
    .map((t) => t + ' ' + before.protectedCounts[t] + '→' + after.protectedCounts[t]);
  diff13.length ? badV('V13', diff13.join(', ')) : okV('V13');
}

/* ══════════════════════════ 9. 본체 ══════════════════════════ */

function loadProjects() {
  const r = mustQuery(
    'SELECT uid, section, IFNULL(common_name,' + q('') + '), IFNULL(project_name,' + q('') + ')' +
    ' FROM project WHERE is_active=1 ORDER BY id;', '과제 목록');
  const list = r.map((c) => ({
    uid: c[0], section: c[1],
    // common_name 이 빈 문자열인 행이 실제로 있다(id=17) — 그때는 project_name 으로 대체한다.
    label: (c[2] && c[2].trim().length) ? c[2].trim() : (c[3] || '').trim(),
  })).filter((p) => p.uid && p.uid.length === 36 && p.label.length);
  if (!list.length) envFail('활성 project 행이 없습니다 — DB 등록 과제 카테고리를 만들 수 없습니다.');
  return list;
}

function main() {
  console.log('');
  log('수행과제 캘린더 — 더미 데이터 시딩 (' + OPT.db + ' @ ' + OPT.dbHost + ':' + OPT.dbPort + ')');

  const users = loadUsers();
  const { viewer, mode, targets, excluded } = resolveTargets(users);
  const targetIds = targets.map((u) => u.userId);
  log('뷰어: ' + (viewer ? viewer.loginId + '(' + viewer.name + ", view_scope='" + viewer.scope + "')" : '(권한 계산 생략)') +
    ' · ' + mode);
  log('대상 사용자 ' + targets.length + '명' + (excluded.length ? ' · 제외: ' + excluded.join(' / ') : ''));

  /* ── --verify 단독: V1~V10 만 ─────────────────────────────── */
  if (OPT.verifyOnly) {
    log('검증만 수행합니다(--verify) — 전후 대조가 필요한 V11~V13 은 건너뜁니다.');
    verifyContent(targetIds);
    return finish({ seeded: [], skipped: [], failed: [], totals: null, verifyOnly: true, viewer, mode, targets, excluded });
  }

  const projects = loadProjects();
  log('활성 과제 ' + projects.length + '건 · seed=' + OPT.seed +
    ' · 기존 데이터: ' + (OPT.keep ? '보존(있으면 건너뜀)' : '삭제 후 재삽입'));

  /* ── --keep: 이미 데이터가 있는 사람은 건너뛴다 ────────────── */
  const hasData = new Set();
  if (OPT.keep && targetIds.length) {
    const L = inList(targetIds);
    const r = mustQuery(
      'SELECT user_id FROM (' +
      '  SELECT user_id FROM cal_category   WHERE user_id IN ' + L +
      '  UNION SELECT user_id FROM cal_entry      WHERE user_id IN ' + L +
      '  UNION SELECT user_id FROM cal_todo       WHERE user_id IN ' + L +
      '  UNION SELECT user_id FROM cal_task_hours WHERE user_id IN ' + L +
      '  UNION SELECT user_id FROM cal_attendance WHERE user_id IN ' + L +
      ') t;', '기존 데이터 확인');
    for (const c of r) hasData.add(Number(c[0]));
  }

  const before = OPT.dryRun ? null : snapshot();

  const totals = {};
  const seeded = [], skipped = [], failed = [];
  for (const u of targets) {
    if (OPT.keep && hasData.has(u.userId)) {
      skipped.push(u);
      vlog('건너뜀(--keep, 기존 데이터 있음): ' + u.loginId);
      continue;
    }
    const data = buildUserData(u, projects, OPT.seed);
    const cnt = countRows(data);
    const sql = buildUserSql(u.userId, data);

    if (OPT.dryRun) {
      seeded.push(u);
      for (const k of Object.keys(cnt)) totals[k] = (totals[k] || 0) + cnt[k];
      vlog('[dry-run] ' + u.loginId + ' — ' + Object.entries(cnt).map(([k, v]) => k + ' ' + v).join(', ') +
        ' · SQL ' + sql.length + 'B');
      continue;
    }

    const r = mysqlRun(sql, { what: '시딩 user_id=' + u.userId + '(' + u.loginId + ')', timeout: 180000 });
    if (!r.ok) {
      // R6 — 그 사용자만 실패로 적고 계속한다. COMMIT 전에 접속이 닫히므로 암묵 ROLLBACK 이다.
      failed.push({ u, why: cleanErr(r.err).slice(0, 300) });
      log('  ✗ 시딩 실패 ' + u.loginId + ' (user_id=' + u.userId + '): ' + cleanErr(r.err).slice(0, 200));
      continue;
    }
    if (r.truncated) {
      // 종료코드 0 인데 종결 마커가 없다 = 출력을 신뢰할 수 없다. 쓰기는 재시도하지 않는다.
      failed.push({ u, why: 'mysql 출력 잘림(종료코드 0·마커 없음) — 커밋 여부 불확실. 검증이 판정한다.' });
      log('  ✗ 출력 잘림 ' + u.loginId + ' — 이 사용자는 실패로 적는다(검증에서 다시 드러난다).');
      continue;
    }
    seeded.push(u);
    for (const k of Object.keys(cnt)) totals[k] = (totals[k] || 0) + cnt[k];
    vlog('시딩 ' + u.loginId + ' — ' + Object.entries(cnt).map(([k, v]) => k + ' ' + v).join(', '));
    if (seeded.length % 10 === 0) log('  … ' + seeded.length + '/' + targets.length + '명 완료');
  }

  if (OPT.dryRun) {
    log('[dry-run] DB 를 전혀 건드리지 않았습니다. 삽입 예정 행수만 아래에 출력합니다.');
    return finish({ seeded, skipped, failed, totals, dryRun: true, viewer, mode, targets, excluded });
  }

  log('시딩 완료 — 성공 ' + seeded.length + '명 · 건너뜀 ' + skipped.length + '명 · 실패 ' + failed.length + '명. 검증을 시작합니다.');
  const after = snapshot();

  // 검증 대상 = 이번에 실제로 시딩한 사람들.
  //   --keep 로 건너뛴 사람은 '우리가 만든 데이터' 가 아니라서 V1/V2 의 판정 대상이 아니고,
  //   실패한 사람은 실패로 이미 보고되므로 여기서 두 번 세지 않는다.
  verifyContent(seeded.map((u) => u.userId));
  verifyDelta(before, after, seeded.map((u) => u.userId));

  return finish({ seeded, skipped, failed, totals, viewer, mode, targets, excluded });
}

function finish(ctx) {
  const bad = results.filter((r) => !r.ok);
  console.log('');
  console.log('═══════════════════════ 요약 ═══════════════════════');
  console.log(' 뷰어           : ' + (ctx.viewer ? ctx.viewer.loginId + ' (' + ctx.viewer.name + "), view_scope='" + ctx.viewer.scope + "'" : '(권한 계산 생략)'));
  console.log(' 대상 산정      : ' + ctx.mode);
  console.log(' 대상 사용자    : ' + ctx.targets.length + '명' + (ctx.excluded.length ? '  (제외: ' + ctx.excluded.join(' / ') + ')' : ''));
  if (!ctx.verifyOnly) {
    console.log(' 시딩 결과      : 성공 ' + ctx.seeded.length + '명 · 건너뜀 ' + ctx.skipped.length + '명 · 실패 ' + ctx.failed.length + '명' +
      (ctx.dryRun ? '  ← dry-run(실제 쓰기 없음)' : ''));
    for (const f of ctx.failed) console.log('   ✗ ' + f.u.loginId + '(user_id=' + f.u.userId + '): ' + f.why);
  }
  console.log(' seed           : ' + OPT.seed + '   (사용자별 PRNG = seed ^ user_id)');
  console.log(' 날짜 창        : ' + ymd(WIN_FROM) + ' ~ ' + ymd(WIN_TO));
  if (ctx.totals) {
    console.log(' 삽입 행수(표별)' + (ctx.dryRun ? ' ※ 예정' : '') + ':');
    let sum = 0;
    for (const [k, v] of Object.entries(ctx.totals)) { console.log('   · ' + k.padEnd(20) + String(v).padStart(7)); sum += v; }
    console.log('   · ' + '합계'.padEnd(19) + String(sum).padStart(7));
    console.log('   · cal_user_rev        ' + String(ctx.seeded.length).padStart(6) + ' (bump 만 · DELETE 없음)');
  }
  console.log(' 검증:');
  if (!results.length) console.log('   (수행한 검증 없음)');
  for (const r of results) {
    console.log('   ' + (r.ok ? '✓' : '✗') + ' ' + r.id.padEnd(4) + V_LABELS[r.id] + (r.ok ? '' : '\n        ↳ ' + r.detail));
  }
  const skippedV = Object.keys(V_LABELS).filter((k) => !results.some((r) => r.id === k));
  if (skippedV.length) console.log('   - 미수행: ' + skippedV.join(', ') + (ctx.dryRun ? ' (dry-run)' : ctx.verifyOnly ? ' (--verify 는 전후 대조를 하지 않는다)' : ''));
  if (truncSeen) console.log(' ⚠ mysql 출력 잘림 ' + truncSeen + '회 발생(조용히 넘기지 않았다 — 위 로그 참조)');
  console.log(' 재현 명령줄    : node db/deploy/seed-dummy.mjs ' + process.argv.slice(2).join(' '));
  console.log('                  (환경변수 TC_TEST_DB_ADMIN_PW 필요)');
  console.log('════════════════════════════════════════════════════');

  if (bad.length) { console.log('검증 위반 ' + bad.length + '건 — 종료코드 1'); process.exit(1); }
  if (!ctx.verifyOnly && ctx.failed && ctx.failed.length) {
    console.log('시딩 실패 ' + ctx.failed.length + '명 — 종료코드 1'); process.exit(1);
  }
  console.log('정상 종료(0)');
  process.exit(0);
}

main();
