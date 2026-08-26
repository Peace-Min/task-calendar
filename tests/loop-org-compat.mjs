#!/usr/bin/env node
/* =====================================================================================
 * tests/loop-org-compat.mjs — org_unit 대리키 **완전 절단** 루프 테스트
 *
 * ★ 이 파일은 `node tests/run-tests.mjs`의 기본 스위트에 포함되지 않는다.
 *   러너는 `readdirSync(tests).filter(f => f.endsWith('.test.mjs'))`로만 수집하므로
 *   확장자를 `.mjs`(≠ `.test.mjs`)로 둔 것만으로 자동수집에서 빠진다(러너 수정 없음).
 *   ★★ 이 파일을 `*.test.mjs`로 개명하지 말 것 — CI(ubuntu-latest)에는 MySQL이 없다.
 *
 * ── 무엇이 바뀌었나(2026-08-24 방향 전환) ───────────────────────────────────────
 *   직전 판은 **확장-수축 A단계**를 검증했다: org_id/parent_id 를 신설하되 구 컬럼
 *   `org_unit.parent` · `app_user.org_unit` 을 **미러로 남겨** 배포된 v0.17.1 89대를 살리는 설계.
 *   그 미러는 **DB 가 아무것도 검증하지 않는 중복 상태**였고, 적대검증 결함의 절반이 거기서 나왔다
 *   (1문장 개명 사고 · 정본만 쓴 신설 · 대소문자 표류 · 롤백이 정본을 지움 …).
 *
 *   실측으로 완전 절단을 선택했다:
 *     · 부팅 경로(userSessionGet)는 로컬 세션 파일만 읽고 DB 를 안 본다(MainWindow.xaml.cs:1578).
 *     · 세션에 만료(TTL)가 없다(UserSession.cs) — 재로그인이 강제되는 경로가 없다.
 *     · 미러를 지우면 배포본 6문 중 **S1(과제 편집 권한 관문)은 생존**하고, S2~S6 만
 *       `ERROR 1054 Unknown column` 으로 죽는다. **쓰기가 없어 데이터 손상 위험 0.**
 *       (이 파일이 마이그레이션 직후 실제로 6문을 쏘아 그 사실을 매 실행마다 재확인한다 — I0.)
 *   → 미러를 만들지 않는다. 뷰도 만들지 않는다. 기반표를 정규화하고 끝낸다.
 *
 * ── 명제 ────────────────────────────────────────────────────────────────────────
 *   옛 명제: "배포본 SQL 6문의 결과가 언제나 id 경로와 일치한다"(미러 정합)  ← 폐기
 *   ★ 새 명제: **조직에 무슨 짓을 해도 트리는 건강하고, 신버전 앱이 받는 payload 가 정확하다.**
 *
 * ── 불변식 ─────────────────────────────────────────────────────────────────────
 *   I0  스키마 계약   org_id PK · uq_org_unit_name · fk_org_parent_id · fk_user_org_id ·
 *                     **`org_unit.parent` 컬럼 없음** · **`app_user.org_unit` 컬럼 없음** ·
 *                     fk_org_parent 없음 · ix_org_parent 없음. 어기면 루프 전에 중단.
 *                     ＋ 배포본 낙진 확인(S1 생존 · S2~S6 은 errno 1054) — 절단을 '동작'으로도 증명.
 *   I1  트리 건강     순환 없음 · 루트 정확히 1개 · **도달불가 0**(재귀 CTE 512)
 *   I2  고아 0        parent_id · app_user.org_id (FK 가 강제하지만 확인한다)
 *   I3  숨김(is_active=0)이 만드는 절단 0 — 배포본도 신버전도 `is_active=1` 로 조직을 읽는다
 *         (a) 비활성 부모의 활성 **자식 조직** 0
 *         (b) ★ 비활성 조직에 남은 **재직자** 0 — (a) 는 조직만 센다. 자식 조직까지 전부
 *             숨기면 (a) 는 0 이 되는데 그 안의 사람은 살아 있는 채로 조직도에서 사라진다
 *             (실측: CTO 열람 89 → 69명인데 게이트 3종이 전부 exit 0 이었다).
 *   I4  이름 유일성·표기 — TRIM 됐고 전각 없음, 빈 이름 없음, BINARY 로도 유일, 리터럴 'NULL' 없음
 *   I5  **신버전 payload 정확성** — 호스트가 쓸 JOIN SQL 이 만드는 units/members 가
 *                     id 경로로 직접 계산한 정답과 일치(행·값·순서). NULL 소속·비활성 포함.
 *   I6  ExpandUnitTree 재현 — 이름 경로 순회(ProjectDb.cs:443 포팅) == id 경로 순회,
 *                     그리고 앱 JS `mbSubtree`(prototype.html:3932) == 이름 경로.
 *                     전 유닛(비활성 포함) + 전 사용자를 루트로 전수.
 *   I7  **개명이 1문장** — `UPDATE org_unit SET name=? WHERE org_id=?` 이 에러 없이 끝나고,
 *                     **자식·소속자 쪽에 고칠 것이 남지 않는다**(그 조직 한 행 말고는
 *                     아무 행도 바뀌지 않았음 + 스키마 전 텍스트 컬럼에 옛 이름 잔존 0건).
 *   I8  조작 효과     모든 루프 조작이 기대 모델대로 실제로 일어났는가(ROW_COUNT + 스냅샷 대조).
 *   ★ 옛 I1/I2(미러 정합)·I3(배포본 SQL 대조)·I8(배포본 컬럼 계약)은 **삭제**했다 — 미러가 없다.
 *
 * ── 전제(이 스크립트가 하지 않는 것) ────────────────────────────────────────────
 *   · **실 DB 를 절대 건드리지 않는다.** mysqldump 로 통째 복제한 별도 스키마
 *     (기본 org_probe_loop_<pid>)에서만 쓰기를 하고, 끝나면 DROP 한다(--keep 로 보존 가능).
 *     ★★ 복제본 이름에 **프로세스 고유값(pid)** 이 들어간다 — 고정 상수였을 때
 *        동시 실행 두 개가 서로의 스키마를 DROP 했다. 두 겹으로 막는다:
 *        ① 이름에 pid  ② GET_LOCK('tc_org_loop') 유지 접속.
 *     ★ 접속·환경 계열 errno(1049·2002·2003·2006·2013·1205·1213)는 **불변식 위반이 아니라
 *       환경 실패(exit 2)** 로 분류한다.
 *     ★ CREATE TABLE ... LIKE 를 쓰지 않는 이유: FK 를 복사하지 않아 가짜 결과가 나온다.
 *   · 위젯을 띄우지 않는다. 화면 쪽 계약은 앱 JS 알고리즘을 이 파일 안에 **포팅**해 대조한다(I6).
 *   · 데이터를 복원하지 않는다 — 복제본을 통째로 버리므로 복원할 것이 없다.
 *
 * ── 시험대(스키마)를 어디서 세우나 ───────────────────────────────────────────────
 *   1) `--migration=<경로>` 가 있으면 그 파일
 *   2) 없으면 db/deploy 에서 `migrate-*org*.sql` 을 찾아 그 파일(=실배포에 쓸 바로 그것을 게이트한다)
 *   3) 그래도 없거나 `--reference-ddl` 이면 이 파일에 내장된 **참조 DDL**(SEVER_DDL)
 *   어느 쪽을 썼든 I0 이 결과 스키마를 확정 설계와 대조해 **루프 전에** 막는다 —
 *   즉 내장본이 실제 마이그레이션과 다른 모양을 만들면 그 자리에서 걸린다.
 *   ★ 내장 참조 DDL 도 org_id 를 **depth → sort_order → name 재귀 CTE 로 명시 배정**한다(1..N).
 *     실측(2026-08-25): 마이그레이션 파일과 내장 DDL 이 **같은 번호**를 냈다
 *     (1=루트 · 2~5=본부 · 6~12=팀). 두 경로가 다른 번호를 내면 요약의 'org_id 배정' 줄에서 보인다.
 *
 * ── 한글 처리 ──────────────────────────────────────────────────────────────────
 *   ★ 한글은 절대 셸 변수·argv 로 넘기지 않는다. SQL 은 전부 JS 템플릿 문자열로 만들어
 *     **stdin(UTF-8 바이트)** 으로 mysql.exe 에 먹인다(argv 로 넘기면 Windows ANSI
 *     코드페이지 변환에 깨진다 — loop-ui-integrity.mjs 와 같은 관례).
 *   ★ 조직 실명은 이 파일에 한 글자도 박지 않는다(실명은 비공개 저장소 소관).
 *     루프가 만드는 조직명은 전부 합성 한글이다.
 *
 * 실행:
 *   $env:TC_TEST_DB_ADMIN_PW = '<root 비번>'
 *   node tests/loop-org-compat.mjs                     # 기본 60조작, 고정 시드
 *   node tests/loop-org-compat.mjs --ops=150 --seed=7
 *   node tests/loop-org-compat.mjs --selfcheck         # 복제 없이 현재 DB 불변식만(읽기 전용)
 *   node tests/loop-org-compat.mjs --selftest          # 일부러 깨뜨려 검출기 자체를 검증
 *   node tests/loop-org-compat.mjs --reference-ddl     # 마이그레이션 파일 대신 내장 DDL 로 시험대
 *   node tests/loop-org-compat.mjs --keep              # 복제본을 남긴다(사후 조사용)
 *
 * 종료코드: 0 = 위반 0 · 1 = 불변식 위반 · 2 = 전제조건/환경 불충족 · 130 = 중단(SIGINT 등)
 * ===================================================================================== */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

/* ────────────────────────────── 0. 설정·인자 ────────────────────────────── */

// ★ 자격증명은 소스에 박지 않는다 — 이 파일은 커밋된다. 환경변수로만 받는다.
//   (명령행에 두지 않는 이유: 프로세스 목록에 노출된다.)
const DEFAULTS = {
  ops: 60,
  seed: 20260824,
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  mysqldump: process.env.TC_TEST_MYSQLDUMP || '',   // 비면 mysql.exe 와 같은 bin 에서 찾는다
  dbHost: '127.0.0.1',
  dbPort: 3306,
  dbName: process.env.TC_TEST_DB_NAME || 'taskmgr',  // 복제 원본(읽기만 한다)
  clone: process.env.TC_TEST_ORG_CLONE || `org_probe_loop_${process.pid}`,
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',   // ← 비밀. 소스에 기본값 없음
  migration: '',                                    // '' = 내장 참조 DDL · 'auto' = db/deploy 탐색
};

function printHelp() {
  console.log(`사용법: node tests/loop-org-compat.mjs [옵션]
  --ops=N            조작 횟수(기본 ${DEFAULTS.ops})
  --seed=N           RNG 시드(기본 ${DEFAULTS.seed}) — 같은 시드+ops면 같은 시퀀스
  --db-name=NAME     복제 원본 스키마(기본 ${DEFAULTS.dbName}) — 읽기만 한다
  --clone=NAME       시험용 복제 스키마명(기본 ${DEFAULTS.clone}) — org_probe_ 로 시작해야 한다
  --migration=PATH   적용할 마이그레이션 SQL(기본: db/deploy 에서 migrate-*org*.sql 자동 탐색)
                     'auto' 면 탐색을 강제한다(못 찾으면 exit 2)
  --reference-ddl    마이그레이션 파일을 무시하고 내장 참조 DDL(완전 절단)로 시험대를 세운다
  --mysql=PATH       mysql.exe 경로
  --mysqldump=PATH   mysqldump.exe 경로
  --db-host/--db-port
  --admin-user=NAME  DB 관리자 계정(기본 root)
  --selfcheck        복제 없이 --db-name 의 현재 상태만 읽기 전용 점검(절단된 DB 여야 한다)
  --selftest         일부러 깨뜨려 불변식 검출기 자체를 검증
  --keep             끝나도 복제본을 DROP 하지 않는다
  -v, --verbose      조작별 상세 로그`);
}

function parseArgs(argv) {
  const o = { ...DEFAULTS, selfcheck: false, selftest: false, keep: false, verbose: false, referenceDdl: false };
  for (const a of argv) {
    let m;
    if ((m = /^--ops=(\d+)$/.exec(a))) o.ops = Number(m[1]);
    else if ((m = /^--seed=(-?\d+)$/.exec(a))) o.seed = Number(m[1]);
    else if ((m = /^--mysql=(.+)$/.exec(a))) o.mysql = m[1];
    else if ((m = /^--mysqldump=(.+)$/.exec(a))) o.mysqldump = m[1];
    else if ((m = /^--db-host=(.+)$/.exec(a))) o.dbHost = m[1];
    else if ((m = /^--db-port=(\d+)$/.exec(a))) o.dbPort = Number(m[1]);
    else if ((m = /^--db-name=(.+)$/.exec(a))) o.dbName = m[1];
    else if ((m = /^--clone=(.+)$/.exec(a))) o.clone = m[1];
    else if ((m = /^--admin-user=(.+)$/.exec(a))) o.adminUser = m[1];
    else if ((m = /^--migration=(.+)$/.exec(a))) o.migration = m[1];
    else if (a === '--reference-ddl') o.referenceDdl = true;
    else if (a === '--selfcheck') o.selfcheck = true;
    else if (a === '--selftest') o.selftest = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error('알 수 없는 인자: ' + a); printHelp(); process.exit(2); }
  }
  if (o.referenceDdl) o.migration = '';
  if (!o.adminPw) {
    console.error('[중단] DB 관리자 비밀번호가 없습니다. 환경변수 TC_TEST_DB_ADMIN_PW 로 지정하세요.');
    console.error("        PowerShell:  $env:TC_TEST_DB_ADMIN_PW = '<비번>'");
    console.error("        bash:        export TC_TEST_DB_ADMIN_PW='<비번>'");
    console.error('        계정명 기본값은 root — 다르면 TC_TEST_DB_ADMIN_USER 또는 --admin-user= 로 지정.');
    process.exit(2);
  }
  // ★ 안전장치: DROP DATABASE 를 하는 이름은 반드시 org_probe_ 접두사여야 하고 원본과 달라야 한다.
  //   (실 DB 이름을 --clone 에 잘못 넣는 사고 하나로 회사 데이터가 사라진다.)
  if (!/^org_probe_[A-Za-z0-9_]{1,40}$/.test(o.clone)) {
    console.error(`[중단] --clone 은 org_probe_ 로 시작하는 [A-Za-z0-9_] 이름이어야 합니다: ${o.clone}`);
    console.error('        (이 스크립트는 그 이름의 스키마를 DROP 합니다 — 접두사 강제가 유일한 안전장치입니다.)');
    process.exit(2);
  }
  if (o.clone.toLowerCase() === o.dbName.toLowerCase()) {
    console.error('[중단] --clone 과 --db-name 이 같습니다. 원본을 파괴할 뻔했습니다.');
    process.exit(2);
  }
  if (o.selfcheck && o.selftest) { console.error('[중단] --selfcheck 와 --selftest 는 함께 쓸 수 없습니다.'); process.exit(2); }
  return o;
}

const OPT = parseArgs(process.argv.slice(2));

/* ────────────────────────────── 1. 로그·위반 기록 ────────────────────────────── */

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const log = (...a) => console.log(el(), ...a);
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   ·', ...a); };

/** 위반 누적 — {inv, op, phase, seed, desc, detail} */
const violations = [];
let curOp = 0, curPhase = 'init';
/** --selftest 가 '일부러 낸 위반'을 최종 집계에서 빼기 위한 전환 버킷. null 이면 정상 집계. */
let capture = null;

function violate(inv, desc, detail) {
  const v = { inv, op: curOp, phase: curPhase, seed: OPT.seed, desc, detail };
  if (capture) {
    capture.push(v);
    if (OPT.verbose) console.log(el(), `    (기대된 검출) [${inv}] ${desc}`);
    return v;
  }
  violations.push(v);
  console.log(el(), `  ✗ [${inv}] op#${curOp} (${curPhase}) ${desc}`);
  if (detail !== undefined) {
    console.log('        ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 1400));
  }
  const sqlOf = opLog.length ? opLog[opLog.length - 1].sql : null;
  if (sqlOf) console.log('        ↳ 직전 조작 SQL: ' + sqlOf.replace(/\s+/g, ' ').slice(0, 500));
  return v;
}
function ok(msg) { console.log(el(), `  ✓ ${msg}`); }

function withCapture(fn) {
  const prev = capture;
  const bucket = [];
  capture = bucket;
  try { fn(); } finally { capture = prev; }
  return bucket;
}

/* ────────────────────────────── 2. 시드 고정 RNG ────────────────────────────── */
// mulberry32 — 32bit 시드 하나로 결정론적 시퀀스. 실패 재현은 --seed/--ops 만 맞추면 된다.
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
const rnd = mulberry32(OPT.seed);
const rint = (n) => Math.floor(rnd() * n);
const pick = (arr) => arr[rint(arr.length)];
function pickWeighted(pairs) {
  const total = pairs.reduce((a, p) => a + p[0], 0);
  let r = rnd() * total;
  for (const [w, v] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][1];
}

/* ────────────────────────────── 3. MySQL 계층 ────────────────────────────── */
// 드라이버 설치 금지(의존성 0) → mysql.exe 를 child_process 로. SQL 은 stdin(UTF-8) 으로.

const MYSQL = OPT.mysql;
const MYSQLDUMP = OPT.mysqldump || join(dirname(MYSQL), process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump');

// ★ mysql.exe 와 mysqldump.exe 가 받는 옵션이 다르다 — --connect-timeout 은 mysql 전용이라
//   덤프 인자에 섞으면 'unknown variable' 로 죽는다(실측). 공통분만 baseArgs 로 둔다.
function baseArgs(user, pw) {
  return [
    `-u${user}`, `-p${pw}`, `-h${OPT.dbHost}`, `-P${OPT.dbPort}`,
    '--get-server-public-key', '--default-character-set=utf8mb4',
  ];
}
const cliArgs = (user, pw) => baseArgs(user, pw).concat(['--connect-timeout=5']);

/* ── ★ 출력 무결성 계약 ──────────────────────────────────────────────────────
 *  실측(2026-08-24, Windows · Node spawnSync): snapshot() 과 같은 모양의 호출을 2,700회
 *  반복하면 그 중 4회(0.15%)가 **종료코드 0 · stderr 빈 채로** stdout 을 행 중간에서 잘라
 *  돌려준다. stdout 을 파이프 대신 임시 파일로 받아도 3,500회 중 3회가 **똑같은 지점에서**
 *  잘렸다 — Node 의 파이프 읽기 경합이 아니라 **mysql.exe 의 출력 경로** 에서 잃는다.
 *  부모 쪽을 아무리 고쳐도 막을 수 없으므로 '예방'이 아니라 **검출 + 재시도** 가 유일한 대책이다.
 *
 *  대책:
 *   ① 검출 — 모든 SQL 뒤에 종결 마커 SELECT 를 **별도 문장으로** 붙이고, 마지막 유효 줄이
 *      그 마커가 아니면 '잘렸다' 로 판정한다.
 *   ② 처리 — 재시도가 안전한지(= 그 호출이 SELECT 뿐인지)에 따라 셋으로 나눈다. 어느 쪽이든
 *      **절대 조용히 빈 결과로 흘려보내지 않는다.**
 *        readOnly   : 최대 3회 재시도 → 그래도 안 되면 envFail(exit 2)
 *        reportTrunc: 재시도 불가(DML). r.truncated 를 달아 돌려주고 **호출자가 명시적으로**
 *                     '계측 유실' 로 기록한다(execPlan 전용 — 효과 검증은 스냅샷이 맡는다)
 *        (기본)     : 재시도 불가 + 출력을 신뢰해야 하는 호출 → 즉시 envFail(exit 2)
 *
 *  ★ 마커는 원문 뒤에 붙는 **별도 문장**이다. 계약 SQL(호스트가 쏠 문자열)은 한 글자도
 *    변형되지 않고, 반환 전에 마커 줄만 잘라 낸다.
 *  ★ 실패한 SQL 은 mysql 이 첫 오류에서 멈추므로 마커가 안 나온다(실측: exit 1). 그래서
 *    무결성 판정은 **status === 0 일 때만** 한다.                                        */
const EOFMARK = '__TCEOF__';
let truncSeen = 0;          // 잘림을 몇 번 겪었나(요약에 찍는다 — 조용히 넘어가지 않는다)
let truncRecovered = 0;     // 그중 재시도로 회복한 횟수
let truncUnrecovered = 0;   // 회복하지 못한 횟수(→ envFail 이거나 계측 유실로 명시 기록)
/* ★ 고장 주입(테스트의 테스트) — 이 계약이 정말 작동하는지 확인하는 유일한 방법이다.
 *     TC_TEST_INJECT_TRUNC=N        앞으로 N 회의 (마커 있는·성공한) 호출을 자른다
 *     TC_TEST_INJECT_TRUNC_WHAT=문자열  그 문자열이 what 에 들어간 호출만 자른다(경로 지정) */
let injectTrunc = Number(process.env.TC_TEST_INJECT_TRUNC || 0);
const INJECT_WHAT = process.env.TC_TEST_INJECT_TRUNC_WHAT || '';

/** mysql.exe 1회 실행(재시도 없음). 반환 {ok, status, out, err, errno, truncated}
 *  truncated=true 는 '종료코드 0 인데 종결 마커가 없다' = 출력을 신뢰할 수 없다는 뜻이다. */
function mysqlRunOnce(sql, { db, timeout, marker, what = '' }) {
  const args = cliArgs(OPT.adminUser, OPT.adminPw).concat(['-N', '-B']);
  if (db) args.push('-D', db);
  // ★ 원문 뒤에 빈 문장 하나(`;`)를 두고 마커를 새 줄에 붙인다 —
  //   원문이 세미콜론으로 끝나든(빈 문장은 무해), 줄 주석으로 끝나든 안전하다(둘 다 실측).
  const body = marker ? sql.replace(/\s+$/, '') + '\n;\n' + `SELECT ${q(EOFMARK)};\n` : sql;

  const r = spawnSync(MYSQL, args, {
    input: Buffer.from(body, 'utf8'), maxBuffer: 128 * 1024 * 1024, timeout, windowsHide: true,
  });
  if (r.error) return { ok: false, status: -1, out: '', err: String(r.error.message), errno: null, truncated: false };

  let out = (r.stdout || Buffer.alloc(0)).toString('utf8');
  const err = (r.stderr || Buffer.alloc(0)).toString('utf8');
  const m = /ERROR (\d+)/.exec(err);
  const ok = r.status === 0;

  if (marker && ok && injectTrunc > 0 && (!INJECT_WHAT || String(what).includes(INJECT_WHAT))) {
    injectTrunc--;   // 고장 주입 — 실측된 잘림과 똑같은 모양(행 중간 절단)을 만든다
    out = out.slice(0, Math.max(0, Math.floor(out.length * 0.85)));
  }

  let truncated = false;
  if (marker && ok) {
    const lines = out.split(/\r?\n/);
    let last = '';
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].length) { last = lines[i]; break; }
    if (last !== EOFMARK) truncated = true;
    else {
      // 마커 줄(마지막 유효 줄) 하나만 걷어낸다 — 뒤따르는 빈 줄은 그대로 둔다.
      const idx = out.lastIndexOf(EOFMARK);
      out = out.slice(0, idx).replace(/(\r?\n)$/, '');
    }
  }
  return { ok, status: r.status, out, err, errno: m ? Number(m[1]) : null, truncated };
}

/** SQL 을 stdin 으로 실행. db 를 주면 -D. 반환 {ok, status, out, err, errno, truncated} */
function mysqlRun(sql, { db = null, timeout = 60000, marker = true, readOnly = false, reportTrunc = false, what = 'SQL 실행' } = {}) {
  const tries = readOnly ? 3 : 1;
  let r = null;
  for (let i = 1; i <= tries; i++) {
    r = mysqlRunOnce(sql, { db, timeout, marker, what });
    if (!r.truncated) {
      if (i > 1) { truncRecovered++; vlog(`출력 잘림에서 회복 — ${what} (재시도 ${i - 1}회)`); }
      return r;
    }
    truncSeen++;
    console.log(el(), `  ⚠ mysql 출력이 잘렸다(종료코드 0·stderr 없음, ${r.out.length}B) — ${what}` +
      (i < tries ? ` → 재시도 ${i}/${tries - 1}` : ''));
    if (i < tries) sleepSync(150);
  }
  if (reportTrunc) {
    // ★ 재시도하면 DML 이 두 번 적용된다. 그래서 '유실했다' 는 사실을 그대로 들고 올라간다 —
    //   호출자(execPlan)가 ROW_COUNT 계측을 통째로 '유실' 로 표시하고, 효과 검증은
    //   스냅샷(readOnly 라 재시도로 보호된다)이 맡는다.
    truncUnrecovered++;
    return r;
  }
  truncUnrecovered++;
  envFail(
    `mysql 출력이 잘렸다(종료코드 0 · stderr 없음) — ${what}` +
    (readOnly ? ` · ${tries - 1}회 재시도 실패` : ' · 쓰기 가능 호출이라 재시도하지 않는다(두 번 적용 위험)'),
    `출력 ${r ? r.out.length : 0}B · 종결 마커 ${EOFMARK} 없음. SQL 머리: ` + sql.replace(/\s+/g, ' ').slice(0, 200));
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
/** 배치 출력 → 행 배열(탭 분리, 이스케이프 복원). 빈 줄 제거. */
function rows(out) {
  return out.split(/\r?\n/).filter((l) => l.length > 0).map((l) => l.split('\t').map(unesc));
}
const cleanErr = (e) => String(e || '').trim().split('\n').filter((l) => !/\[Warning\]/.test(l)).join(' ');

/* ── 환경 실패 vs 불변식 위반 ────────────────────────────────────────────────
 *  ★ 이 구분이 없으면 환경 사고가 언제나 '릴리스 게이트의 핵심 결함' 으로 둔갑한다.
 *      1049 Unknown database · 2002/2003/2005 접속 불가 · 2006/2013 연결 끊김
 *      1205 lock wait timeout · 1213 deadlock
 *    반대로 1451(FK 제약)·1452·1062 등은 "스키마는 멀쩡한데 조작이 거부됐다" → 진짜 불변식 위반. */
const ENV_ERRNOS = new Set([1049, 2002, 2003, 2005, 2006, 2013, 1205, 1213]);
const isEnvErrno = (e) => e != null && ENV_ERRNOS.has(Number(e));

/** 환경/전제 실패로 즉시 종료(exit 2). 불변식 집계에 섞지 않는다. */
function envFail(msg, detail) {
  console.error('');
  console.error('[중단·환경] ' + msg);
  if (detail) console.error('            ' + String(detail).replace(/\s+/g, ' ').slice(0, 900));
  console.error('            ↳ 이것은 불변식 위반이 아니다(종료코드 2). 확인할 것:');
  console.error(`               · 같은 복제본 이름 \`${OPT.clone}\` 을 쓰는 다른 실행이 있는가`);
  console.error('               · MySQL 이 살아 있는가 / 접속 정보가 맞는가');
  try { printSummary(null, msg); } catch (_) { }
  process.exit(2);
}
/** SQL 오류를 errno 를 달아 던진다(상위에서 환경/불변식으로 갈라 쓴다). */
function sqlThrow(msg, r) {
  const e = new Error(msg);
  e.sqlErrno = r.errno;
  throw e;
}

/** ★ 출력 유실 — 요청한 블록이 결과에 없다. 불변식 위반이 **아니라** 환경 실패다. */
function outputLoss(msg, detail) {
  const e = new Error(msg);
  e.tcOutputLoss = true;
  e.tcDetail = detail;
  throw e;
}

function mustQuery(sql, what, db) {
  const r = mysqlRun(sql, { db: db === undefined ? CLONE : db, readOnly: true, what });
  if (!r.ok) sqlThrow(`MySQL 조회 실패(${what}): ${cleanErr(r.err)}`, r);
  return rows(r.out);
}

/** SQL 문자열 리터럴 — 백슬래시·작은따옴표 이스케이프. null → NULL */
function q(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}
/** 숫자 리터럴 — null 은 NULL */
function n(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (!/^-?\d+$/.test(String(v))) throw new Error('숫자가 아닌 값을 숫자 자리에 넣으려 했습니다: ' + v);
  return String(v);
}

/* ── 마커로 구분되는 배치 조회 ────────────────────────────────────────────────
 *  mysql 은 여러 SELECT 의 출력을 구분 없이 이어 붙인다. 쿼리마다 앞뒤에 마커 SELECT 를
 *  끼워 넣고 그 줄로 블록을 자른다. 프로세스 1회로 10~30개 쿼리를 뽑기 위한 장치다.
 *  ★ 블록마다 **여는 마커와 닫는 마커** 를 둘 다 둔다. 여는 마커만 있던 옛 구조는
 *    '0행' 과 '출력 유실' 을 구분할 수 없어 유실을 정상값으로 둔갑시켰다.                */
const SEP = '__TCSEP__';
const ENDSEP = '__TCEND__';
function batch(items, { db = CLONE_LAZY, what = '배치 조회' } = {}) {
  const parts = ['SET NAMES utf8mb4;'];
  for (const it of items) {
    if (it.pre) parts.push(it.pre.replace(/;?\s*$/, ';'));
    parts.push(`SELECT ${q(SEP + it.key + SEP)};`);
    parts.push(it.sql.replace(/;\s*$/, '') + ';');
    parts.push(`SELECT ${q(ENDSEP + it.key + ENDSEP)};`);
  }
  // ★ 전부 SELECT(+ SET @id) 라 재시도가 안전하다 — readOnly:true.
  const r = mysqlRun(parts.join('\n'), { db: db === CLONE_LAZY ? CLONE : db, readOnly: true, what });
  if (!r.ok) sqlThrow('배치 조회 실패: ' + cleanErr(r.err) + '\n--- SQL ---\n' + parts.join('\n').slice(0, 2000), r);
  const res = new Map();
  const closed = new Set();
  const reBeg = new RegExp('^' + SEP + '(.+?)' + SEP + '$');
  const reEnd = new RegExp('^' + ENDSEP + '(.+?)' + ENDSEP + '$');
  let cur = null, curKey = null;
  for (const line of r.out.split(/\r?\n/)) {
    if (line.length === 0) continue;
    let m;
    if ((m = reBeg.exec(line))) {
      if (curKey !== null) outputLoss(`배치 출력 유실 — 블록 '${curKey}' 이 닫히기 전에 '${m[1]}' 이 시작됐다`, what);
      curKey = m[1]; cur = []; res.set(curKey, cur); continue;
    }
    if ((m = reEnd.exec(line))) {
      if (m[1] !== curKey) outputLoss(`배치 출력 유실 — 닫는 마커 '${m[1]}' 이 열린 블록 '${curKey}' 과 다르다`, what);
      closed.add(curKey); cur = null; curKey = null; continue;
    }
    if (cur) cur.push(line.split('\t').map(unesc));
  }
  if (curKey !== null) outputLoss(`배치 출력 유실 — 블록 '${curKey}' 이 닫히지 않았다(출력이 중간에서 끊겼다)`, what);
  const lost = items.filter((it) => !res.has(it.key) || !closed.has(it.key)).map((it) => it.key);
  if (lost.length) {
    outputLoss(
      `배치 출력 유실 — 요청한 ${items.length}개 블록 중 ${lost.length}개가 결과에 없다: ${lost.slice(0, 8).join(', ')}${lost.length > 8 ? ' …' : ''}`,
      `${what} · 받은 출력 ${r.out.length}B / 블록 ${res.size}개(닫힘 ${closed.size}개)`);
  }
  return res;
}
const CLONE_LAZY = Symbol('clone-lazy');   // batch 기본 db = 실행 시점의 CLONE

/* ────────────────────────────── 4. 복제본 수명주기 ────────────────────────────── */

let CLONE = OPT.clone;      // --selfcheck 에서는 원본 이름으로 바뀐다(읽기 전용)
let cloneCreated = false;

/* ── 전역 실행 잠금 ────────────────────────────────────────────────────────
 *  복제본 이름에 pid 를 넣어 충돌 자체는 사라졌지만, 같은 원본 DB 를 여럿이 동시에
 *  덤프·적재하면 서로의 진행을 느리게 하고 사고 원인을 흐린다. 한 번에 하나만 돌린다.
 *  ★ GET_LOCK 은 **접속 수명** 에 묶인다 — mysql.exe 는 매 호출마다 접속을 새로 열고 닫으므로
 *    spawnSync 로는 잠금을 '쥐고 있을' 수 없다. 그래서 잠금 유지용 mysql 프로세스를 하나 띄우고
 *    (GET_LOCK → SLEEP), 별도 접속에서 IS_USED_LOCK 이 **그 프로세스의 접속 id** 인지 대조해
 *    "정말 내가 쥐었는지" 를 확인한다(남이 쥔 것을 내 것으로 착각하지 않기 위해). */
const LOCK_NAME = 'tc_org_loop';
const LOCK_MARK = `tc_org_loop_holder_${process.pid}`;
let lockProc = null;

/** 동기 sleep — 폴링용(외부 프로세스를 기다리는 것뿐이라 이벤트 루프가 필요 없다). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/* ★ 잠금 누수 — 실측 사고: 8회 **연속**(동시 아님) 실행에서 run3~run8 이 전부
 *    exit 2("다른 루프 실행이 진행 중")로 죽었다. 클라이언트 프로세스는 죽어도 **서버 세션**은
 *    `SELECT SLEEP(7200)` 을 계속 돌다가 소켓이 끊긴 것을 알아챌 때까지(약 10초) 살아 있고,
 *    GET_LOCK 은 그 세션 수명에 묶여 있기 때문이다.
 *  → (a) releaseRunLock 이 별도 접속에서 KILL 로 서버 세션을 즉시 끊는다
 *     (b) acquireRunLock 은 즉시 죽지 않고 20초까지 재시도한다
 *     (c) exit 2 로 끝날 때 '위반된 불변식: 없음 ✓' 를 찍지 않는다(printSummary). */
let lockConnId = null;   // 유지용 접속의 PROCESSLIST.ID — releaseRunLock 이 KILL 할 대상

/* ★ 잠금 확보 1회 시도. 반환 {ok} | {busy, why} | {fatal, why}
 *  ① 은 **읽기만** 한다 — GET_LOCK 으로 직접 쥐면 ② 의 유지용 접속이 ① 이 남긴 자기 자신의
 *    잔여 세션과 경합해 스스로 죽는다(실측: 20연속 중 1회 exit 2). IS_USED_LOCK 은 쥐지 않는다. */
function acquireRunLockOnce() {
  const probe = mysqlRun(`SELECT IFNULL(IS_USED_LOCK(${q(LOCK_NAME)}),0);`,
    { db: null, readOnly: true, what: '실행 잠금 확인' });
  if (!probe.ok) return { fatal: true, why: 'DB 접속 실패(실행 잠금 확인 단계): ' + cleanErr(probe.err) };
  const held = (rows(probe.out)[0] || ['0'])[0];
  if (held !== '0') return { busy: true, why: `'${LOCK_NAME}' 을 접속 ${held} 가 쥐고 있다` };

  // ② 유지용 접속을 띄운다. GET_LOCK 대기는 5초 — ③ 의 감시(9초)보다 짧아야
  //    '아직 대기 중' 과 '얻지 못했다' 를 구분할 수 있다.
  lockProc = spawn(MYSQL, cliArgs(OPT.adminUser, OPT.adminPw).concat(['-N', '-B']),
    { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  lockProc.on('error', () => { });
  lockProc.stdin.on('error', () => { });
  lockProc.stdin.end(`SELECT GET_LOCK(${q(LOCK_NAME)}, 5);\nSELECT SLEEP(7200) /* ${LOCK_MARK} */;\n`);
  lockProc.unref();

  // ③ '내가' 쥐었는지 대조 — IS_USED_LOCK(접속 id) == 유지용 접속의 PROCESSLIST.ID
  const idSql = `SELECT IFNULL(IS_USED_LOCK(${q(LOCK_NAME)}),0),
                        IFNULL((SELECT MAX(ID) FROM information_schema.PROCESSLIST
                                 WHERE INFO LIKE ${q('%' + LOCK_MARK + '%')} AND INFO NOT LIKE '%PROCESSLIST%'),0);`;
  let sawMine = false;
  for (let i = 0; i < 60; i++) {          // 60 × 150ms = 9초 > 홀더의 GET_LOCK 대기 5초
    sleepSync(150);
    const r = mysqlRun(idSql, { db: null, readOnly: true, what: '실행 잠금 소유 확인' });
    if (!r.ok) continue;
    const rr = rows(r.out)[0];
    if (!rr) continue;
    const [used, mine] = rr;
    if (mine === '0') continue;          // 아직 GET_LOCK 실행 중(INFO 가 SLEEP 이 아니다)
    sawMine = true;
    lockConnId = mine;                   // 어느 쪽으로 끝나든 이 세션은 우리가 책임진다
    if (used === mine) { vlog(`실행 잠금 확보 — ${LOCK_NAME} (접속 ${mine})`); return { ok: true }; }
    releaseRunLock();
    return { busy: true, why: used === '0' ? '유지용 접속이 GET_LOCK 을 얻지 못했다' : `다른 접속(${used})이 먼저 쥐었다` };
  }
  releaseRunLock();
  return sawMine
    ? { busy: true, why: '유지용 접속이 9초 안에 잠금을 얻지 못했다' }
    : { fatal: true, why: '유지용 mysql 접속이 뜨지 않았거나 information_schema.PROCESSLIST 조회 권한이 없다' };
}

function acquireRunLock() {
  const deadline = Date.now() + 20000;
  let why = '';
  for (let attempt = 1; ; attempt++) {
    const r = acquireRunLockOnce();
    if (r.ok) {
      if (attempt > 1) log(`실행 잠금 확보 — ${attempt}회 시도 (직전 실행의 세션이 사라지기를 기다렸다)`);
      return;
    }
    why = r.why;
    if (r.fatal) envFail('실행 잠금 확보 실패', why);
    if (Date.now() >= deadline) break;
    if (attempt === 1) log(`실행 잠금 대기 — ${why} · 최대 20초 재시도`);
    sleepSync(500);
  }
  envFail(`다른 루프 실행이 진행 중입니다 — ${why}`,
    '20초를 기다려도 잠금이 풀리지 않았다. 동시 실행은 서로의 복제본·원본 덤프를 방해한다. ' +
    `그쪽이 끝난 뒤 다시 돌리거나, 남은 세션을 확인하라: SELECT ID,INFO FROM information_schema.PROCESSLIST WHERE INFO LIKE '%${LOCK_NAME}%';`);
}

/** ★ kill 만으로는 부족하다 — 서버 세션을 KILL 로 즉시 끊어야 잠금이 그 자리에서 풀린다. */
function releaseRunLock() {
  const p = lockProc; lockProc = null;
  const id = lockConnId; lockConnId = null;
  if (p) { try { p.kill(); } catch (_) { } }
  if (id) {
    // ★ mysqlRun 을 쓰지 않는다 — 이 함수는 process.on('exit') 경로에서도 돌고,
    //   거기서 envFail(→ process.exit) 이 재진입하면 정리가 꼬인다. 단발 실행으로 끝낸다.
    try { mysqlRunOnce(`KILL ${/^\d+$/.test(String(id)) ? id : 0};`, { db: null, timeout: 15000, marker: false }); } catch (_) { }
    for (let i = 0; i < 12; i++) {
      let r;
      try { r = mysqlRunOnce(`SELECT IFNULL(IS_USED_LOCK(${q(LOCK_NAME)}),0);`, { db: null, timeout: 15000, marker: false }); }
      catch (_) { break; }
      if (!r.ok) break;
      const v = (rows(r.out)[0] || ['0'])[0];
      if (v === '0' || v !== String(id)) { vlog(`실행 잠금 해제 확인 — 접속 ${id} 종료`); return; }
      sleepSync(250);
    }
  }
}

function createClone() {
  acquireRunLock();
  if (!existsSync(MYSQLDUMP)) {
    console.error(`[중단] mysqldump 를 찾을 수 없습니다: ${MYSQLDUMP}\n  → --mysqldump=<경로> 로 지정하세요.`);
    process.exit(2);
  }
  // 원본 존재 확인(원본에는 SELECT 만 한다)
  const chk = mysqlRun(`SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=${q(OPT.dbName)};`, { db: null, readOnly: true, what: '원본 스키마 확인' });
  if (!chk.ok) { console.error('[중단] DB 접속 실패: ' + cleanErr(chk.err)); process.exit(2); }
  if (rows(chk.out).length !== 1) { console.error(`[중단] 원본 스키마가 없습니다: ${OPT.dbName}`); process.exit(2); }

  log(`복제 시작 — ${OPT.dbName} → ${OPT.clone} (mysqldump 통째 복제 · 원본은 SELECT 만)`);
  // ★ --single-transaction: 원본에 락을 걸지 않는다(운영 중 DB 를 방해하지 않기 위해 필수).
  // ★ CREATE TABLE ... LIKE 를 쓰지 않는 이유가 여기 있다 — mysqldump 는 FK 를 그대로 복제한다.
  const dumpArgs = baseArgs(OPT.adminUser, OPT.adminPw).concat([
    '--no-tablespaces', '--single-transaction', '--skip-lock-tables', '--set-gtid-purged=OFF', OPT.dbName,
  ]);
  const d = spawnSync(MYSQLDUMP, dumpArgs, { maxBuffer: 512 * 1024 * 1024, timeout: 300000, windowsHide: true });
  if (d.error || d.status !== 0) {
    console.error('[중단] mysqldump 실패: ' + cleanErr((d.stderr || Buffer.alloc(0)).toString('utf8')) + (d.error ? ' ' + d.error.message : ''));
    process.exit(2);
  }
  const dump = d.stdout || Buffer.alloc(0);

  const mk = mysqlRun(
    `DROP DATABASE IF EXISTS \`${OPT.clone}\`;\n` +
    `CREATE DATABASE \`${OPT.clone}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`,
    { db: null, what: '복제 스키마 생성' });
  if (!mk.ok) { console.error('[중단] 복제 스키마 생성 실패: ' + cleanErr(mk.err)); process.exit(2); }
  cloneCreated = true;   // 이 시점부터 정리 훅이 책임진다

  const args = cliArgs(OPT.adminUser, OPT.adminPw).concat(['-D', OPT.clone]);
  const l = spawnSync(MYSQL, args, { input: dump, maxBuffer: 512 * 1024 * 1024, timeout: 300000, windowsHide: true });
  if (l.error || l.status !== 0) {
    console.error('[중단] 복제본 적재 실패: ' + cleanErr((l.stderr || Buffer.alloc(0)).toString('utf8')));
    process.exit(2);
  }
  const cnt = mustQuery('SELECT COUNT(*) FROM org_unit; SELECT COUNT(*) FROM app_user;', '복제 검산', OPT.clone);
  log(`복제 완료 — ${OPT.clone}: org_unit ${cnt[0][0]}행 · app_user ${cnt[1][0]}행 (덤프 ${(dump.length / 1024).toFixed(0)}KB)`);
}

/** 자기가 만든 것만 되돌린다 — 복제 스키마 DROP + 실행 잠금 해제. 예외·Ctrl+C 에도 반드시 돈다. */
function dropClone() {
  // ★ 잠금은 **복제본을 지운 뒤** 푼다 — 먼저 풀면 다음 실행이 우리 정리와 겹친다.
  try {
    if (!cloneCreated) return;
    if (OPT.keep) { cloneCreated = false; console.error(`[cleanup] --keep — 복제본 \`${OPT.clone}\` 을 남깁니다(수동 DROP 필요).`); return; }
    cloneCreated = false;
    try {
      spawnSync(MYSQL, cliArgs(OPT.adminUser, OPT.adminPw).concat(['-N', '-B']),
        { input: Buffer.from(`DROP DATABASE IF EXISTS \`${OPT.clone}\`;`, 'utf8'), windowsHide: true, timeout: 60000 });
      console.error(`[cleanup] 복제 스키마 \`${OPT.clone}\` DROP 완료`);
    } catch (_) {
      console.error(`[cleanup] DROP 실패 — 수동으로: DROP DATABASE \`${OPT.clone}\`;`);
    }
  } finally {
    releaseRunLock();
  }
}
process.on('exit', dropClone);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { dropClone(); process.exit(130); });
process.on('uncaughtException', (e) => {
  // ★ 출력 유실·접속 사고는 종료코드 2(환경) — 1(불변식 위반)로 오보하지 않는다.
  if (e && (e.tcOutputLoss || isEnvErrno(e.sqlErrno))) {
    try { envFail(e.tcOutputLoss ? 'mysql 출력 유실 — ' + e.message : `DB 오류 errno=${e.sqlErrno}`, e.tcDetail || e.message); } catch (_) { }
    dropClone(); process.exit(2);
  }
  console.error(e); dropClone(); process.exit(1);
});

/* ────────────────────────────── 5. 시험대 DDL — 완전 절단 ────────────────────────────── */

/* ★ 내장 참조 DDL — 확정 최종 스키마를 그대로 세운다(미러 없음·뷰 없음).
 *   실측(2026-08-24, MySQL 8.4.9, 실 taskmgr 복제본 12행/89명)으로 통과 확인했고,
 *   org_id 배정 결과가 확정 번호(1=루트 · 2~5=본부 · 6~12=팀)와 완전히 일치했다.
 *   ★ 번호는 AUTO_INCREMENT 순서에 맡기지 않는다 — depth → sort_order → name 재귀 CTE 로
 *     **명시 배정**한다. 재구축 경로(taskmgr-company-data 시드)와 같은 번호를 내야 하기 때문이다.
 *   ★ org_id 를 먼저 NOT NULL DEFAULT 0 으로 세우고 값을 채운 뒤에야 PK·AUTO_INCREMENT 를
 *     붙이는 순서가 중요하다: 유일 인덱스가 없는 동안 1..N 을 덮어써야 중간 충돌이 안 난다.
 *   ★ updated_at = updated_at 은 오타가 아니다 — 명시 대입이 ON UPDATE CURRENT_TIMESTAMP 를
 *     억제한다(실측). 없으면 전 행의 갱신시각이 시험 시각으로 덮인다. */
const SEVER_DDL = `
SET NAMES utf8mb4;
-- ① org_id 신설(아직 키 없음) + 계층 너비우선 번호 배정
ALTER TABLE org_unit ADD COLUMN org_id SMALLINT UNSIGNED NOT NULL DEFAULT 0 FIRST;
WITH RECURSIVE tree AS (
    SELECT name, sort_order, 0 AS depth FROM org_unit WHERE parent IS NULL
    UNION ALL
    SELECT o.name, o.sort_order, t.depth + 1 FROM org_unit o JOIN tree t ON o.parent = t.name
)
UPDATE org_unit o
  JOIN (SELECT name AS nm, ROW_NUMBER() OVER (ORDER BY depth, sort_order, name) AS rn FROM tree) x
    ON o.name = x.nm
   SET o.org_id = x.rn, o.updated_at = o.updated_at;
-- ② PK 교체 + name 은 UNIQUE 로 강등 + AUTO_INCREMENT
--    ★ 네 조각을 한 문장에 묶어야 한다 — name 을 참조하는 FK 가 살아 있는 동안
--      그 컬럼 위의 인덱스가 한 순간도 사라지면 ERROR 1553.
ALTER TABLE org_unit DROP PRIMARY KEY, ADD PRIMARY KEY (org_id),
      ADD UNIQUE KEY uq_org_unit_name (name),
      MODIFY org_id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT;
-- ③ parent_id · app_user.org_id 신설 + 값 이관(구 이름 컬럼이 아직 살아 있을 때 해야 한다)
ALTER TABLE org_unit ADD COLUMN parent_id SMALLINT UNSIGNED NULL DEFAULT NULL AFTER name;
UPDATE org_unit c JOIN org_unit p ON c.parent = p.name SET c.parent_id = p.org_id, c.updated_at = c.updated_at;
ALTER TABLE app_user ADD COLUMN org_id SMALLINT UNSIGNED NULL DEFAULT NULL AFTER org_unit;
UPDATE app_user u JOIN org_unit o ON u.org_unit = o.name SET u.org_id = o.org_id, u.updated_at = u.updated_at;
-- ④ ★ 절단 — 이름을 들고 있던 컬럼·FK·인덱스를 전부 없앤다(미러를 남기지 않는다)
ALTER TABLE app_user DROP FOREIGN KEY fk_user_org;
ALTER TABLE org_unit DROP FOREIGN KEY fk_org_parent;
ALTER TABLE app_user DROP COLUMN org_unit;   -- ix_user_org 도 컬럼과 함께 사라진다
ALTER TABLE org_unit DROP COLUMN parent;     -- ix_org_parent 도 컬럼과 함께 사라진다
-- ⑤ 새 FK — 이제 DB 가 계층·소속을 직접 검증한다
ALTER TABLE org_unit ADD KEY ix_org_parent_id (parent_id),
      ADD CONSTRAINT fk_org_parent_id FOREIGN KEY (parent_id) REFERENCES org_unit(org_id)
          ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE app_user ADD KEY ix_user_org_id (org_id),
      ADD CONSTRAINT fk_user_org_id FOREIGN KEY (org_id) REFERENCES org_unit(org_id)
          ON UPDATE CASCADE ON DELETE RESTRICT;
-- ⑥ 표 코멘트 — 'name=자연키, parent로 계층' 은 이제 거짓이다.
--    ★ 문장을 db/deploy/migrate-*org*.sql 과 **글자 그대로 같게** 맞춘다. 두 경로가 다른
--      결과를 만들면 SHOW CREATE TABLE 로 대조할 때 사람이 헷갈린다(이 파일은 새 복제본에만
--      돌므로 마이그레이션 쪽의 '옛 문장일 때만' 조건은 필요 없다).
ALTER TABLE org_unit COMMENT = '조직 트리. PK=org_id(내부 정체성) · name=UNIQUE. 계층 정본은 parent_id 하나 — 이름 미러 없음.';
ALTER TABLE app_user COMMENT = '사용자. 인증은 netcus, 여기는 인가만. 비밀번호 컬럼 없음. 소속 정본은 org_id 하나 — 이름 미러 없음.';
`;

function resolveMigration() {
  if (OPT.referenceDdl) return { source: '내장 참조 DDL(완전 절단 · --reference-ddl)', sql: SEVER_DDL, builtin: true };
  if (OPT.migration && OPT.migration !== 'auto') {
    const p = resolve(OPT.migration);
    if (!existsSync(p)) { console.error(`[중단] --migration 파일이 없습니다: ${p}`); process.exit(2); }
    return { source: p, sql: readFileSync(p, 'utf8'), builtin: false };
  }
  const dir = join(REPO, 'db', 'deploy');
  if (existsSync(dir)) {
    const hit = readdirSync(dir).filter((f) => /^migrate-.*org.*\.sql$/i.test(f)).sort();
    if (hit.length) {
      const p = join(dir, hit[hit.length - 1]);
      return { source: p, sql: readFileSync(p, 'utf8'), builtin: false };
    }
  }
  if (OPT.migration === 'auto') {
    console.error('[중단] --migration=auto 인데 db/deploy 에서 migrate-*org*.sql 을 찾지 못했습니다.');
    process.exit(2);
  }
  return { source: '내장 참조 DDL(db/deploy 에 migrate-*org*.sql 없음)', sql: SEVER_DDL, builtin: true };
}

/* ────────────────────────────── 6. 계약 SQL ────────────────────────────── */

/* ★ 변이 훅 — --selftest 가 '검출기 자체' 를 시험할 때만 건드린다.
 *   DB 를 깨뜨려서는 만들 수 없는 결함(계약 SQL 이 틀림 · 앱 포팅이 틀림 · 조작이 no-op)을
 *   코드 쪽에서 일부러 만들어 넣고, 그것을 불변식이 잡는지 본다.
 *   평시에는 전부 null/false 라 아무 영향이 없다. */
const MUT = {
  payloadUnits: null,
  payloadMembers: null,
  mbSubtreeBug: false,
  /* ★ TC_TEST_MUTATE_NOOP=1 — 루프 **전체**를 no-op 으로 돌려 본다(변이 테스트).
   *   --selftest 의 C12 가 조작 1회로 같은 것을 보지만, 이 훅은 게이트 전체가
   *   "아무 일도 안 일어났는데 통과" 로 끝나지 않는지를 실제 루프 규모로 확인한다.
   *   기대: exit 1 (I8 위반 다수). exit 0 이 나오면 이 테스트는 아무것도 증명하지 못한다. */
  noopOps: Number(process.env.TC_TEST_MUTATE_NOOP || 0) > 0,
};
if (MUT.noopOps) console.log('★ TC_TEST_MUTATE_NOOP — 모든 조작을 no-op(DO 0)으로 실행한다. 기대 결과는 exit 1(I8 위반)이다.');

/* ── 신버전 호스트가 쏠 SQL — **이 문자열이 곧 계약이다** ────────────────────────
 *  절단 뒤에는 이름이 org_unit.name 한 곳에만 있으므로, 페이로드를 만들려면 JOIN 해야 한다.
 *  · units   : ProjectDb.cs:364 자리 — payload {name, parent, sortOrder}
 *  · members : ProjectDb.cs:395 자리 — payload {loginId, name, title, orgUnit}
 *  · user    : ProjectDb.cs:232/278/339 자리 — 로그인 인가·사용자정보·열람범위 기준점
 *  ★ LEFT JOIN 이어야 한다: 루트는 parent_id 가 NULL 이고, 소속 미등록자는 org_id 가 NULL 이다.
 *    INNER JOIN 으로 쓰면 루트가 통째로 사라지고 미등록자가 명부에서 지워진다(--selftest 가 확인).
 *  ★ ORDER BY 는 배포본과 같은 키다(sort_order,name / org 이름,name) — 화면 정렬이 이 순서에 붙어 있다. */
const HOST = {
  units:
    'SELECT c.name, p.name, c.sort_order ' +
    'FROM org_unit c LEFT JOIN org_unit p ON p.org_id = c.parent_id ' +
    'WHERE c.is_active=1 ORDER BY c.sort_order, c.name',
  members:
    'SELECT u.login_id, u.name, u.title, o.name ' +
    'FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id ' +
    'WHERE u.is_active=1 ORDER BY o.name, u.name',
  user:
    'SELECT u.login_id, u.name, u.title, o.name, u.view_scope, u.edit_role, u.is_active ' +
    'FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id WHERE u.login_id=@id',
};

/* ── 같은 답을 **다른 방법으로** 뽑는 대조본 ──────────────────────────────────
 *  JOIN 이 아니라 상관 서브쿼리로 같은 결과를 만든다. 두 형태가 같은 시퀀스를 내면
 *  '행·값·순서' 가 맞다는 뜻이고, 그 판정을 **MySQL 콜레이션에 맡길 수 있다**
 *  (utf8mb4_0900_ai_ci 의 정렬 규칙을 JS 로 다시 구현하면 그 재구현이 틀려서 가짜 실패가 난다).
 *  ★ '내용' 의 진짜 오라클은 JS 가 id 경로로 직접 계산한 정답이다(invPayload 의 ②).
 *    이 대조본은 **순서** 를 책임진다. 둘 다 통과해야 I5 가 성립한다. */
const XREF = {
  units:
    'SELECT c.name, (SELECT p.name FROM org_unit p WHERE p.org_id = c.parent_id), c.sort_order ' +
    'FROM org_unit c WHERE c.is_active=1 ORDER BY c.sort_order, c.name',
  members:
    'SELECT u.login_id, u.name, u.title, (SELECT o.name FROM org_unit o WHERE o.org_id = u.org_id) ' +
    'FROM app_user u WHERE u.is_active=1 ' +
    'ORDER BY (SELECT o.name FROM org_unit o WHERE o.org_id = u.org_id), u.name',
};

/* ── 배포된 v0.17.1 이 쏘는 SQL 6문(widget/ProjectDb.cs 원문 그대로) ──────────────
 *  절단 뒤 이 6문이 **어떻게 되는지** 를 마이그레이션 직후 한 번 실측한다(I0 낙진 확인).
 *  기대: S1 은 살아남고(과제 편집 권한 관문 — 조직 컬럼을 안 본다),
 *        S2~S6 은 errno 1054(Unknown column) 로 죽는다. **쓰기가 없어 데이터 손상 위험 0.**
 *  이 결과가 기대와 다르면 "무엇이 깨지는지" 에 대한 우리 전제가 틀린 것이다 — 그 자리에서 멈춘다. */
const DEPLOYED = [
  { key: 'S1', line: 'ProjectDb.cs:102', param: true, survive: true,
    what: '과제 편집 권한 관문(OpenWriteAsync)',
    sql: 'SELECT edit_role, is_active FROM app_user WHERE login_id=@id' },
  { key: 'S2', line: 'ProjectDb.cs:232', param: true, survive: false,
    what: '로그인 인가(LoadAppUserJsonAsync)',
    sql: 'SELECT login_id, name, title, org_unit, view_scope, edit_role, is_active FROM app_user WHERE login_id=@id' },
  { key: 'S3', line: 'ProjectDb.cs:278', param: true, survive: false,
    what: '사용자 정보 모달(LoadUserInfoJsonAsync)',
    sql: 'SELECT name, title, org_unit, view_scope, edit_role, is_active FROM app_user WHERE login_id=@id' },
  { key: 'S4', line: 'ProjectDb.cs:339', param: true, survive: false,
    what: '열람범위 기준점(LoadMembersJsonAsync ①)',
    sql: 'SELECT org_unit, view_scope, is_active FROM app_user WHERE login_id=@id' },
  { key: 'S5', line: 'ProjectDb.cs:364', param: false, survive: false,
    what: '조직 트리(LoadMembersJsonAsync ②)',
    sql: 'SELECT name, parent, sort_order FROM org_unit WHERE is_active=1 ORDER BY sort_order, name' },
  { key: 'S6', line: 'ProjectDb.cs:395', param: false, survive: false,
    what: '구성원 명부(LoadMembersJsonAsync ④)',
    sql: 'SELECT login_id, name, title, org_unit FROM app_user WHERE is_active=1 ORDER BY org_unit, name' },
];

/* ── 결과 비교 ──────────────────────────────────────────────────────────────
 *  1차: 시퀀스 완전 일치.
 *  불일치면 2차: '정렬키 시퀀스가 같고 다중집합이 같은가'를 본다. 같으면 ORDER BY 가
 *  결정하지 않는 동률 자리의 순서 차이일 뿐이므로 위반이 아니다(SQL 이 보장하지 않는 것을
 *  불변식으로 삼으면 가짜 실패가 난다). 그 외에는 전부 위반이고, 어디가 다른지 찍는다.  */
function compareResult(a, b, orderKeys) {
  const eq = (x, y) => x.length === y.length && x.every((r, i) => r.length === y[i].length && r.every((c, j) => c === y[i][j]));
  if (eq(a, b)) return { same: true };
  const keyOf = (r) => (orderKeys.length ? orderKeys.map((i) => r[i]).join('\u0001') : '');
  const ka = a.map(keyOf).join('\u0002'), kb = b.map(keyOf).join('\u0002');
  const ms = (x) => x.map((r) => r.join('\u0001')).sort().join('\u0002');
  if (orderKeys.length && ka === kb && ms(a) === ms(b)) return { same: true, tie: true };

  const diffs = [];
  if (a.length !== b.length) diffs.push(`행수 다름: ${a.length} vs ${b.length}`);
  for (let i = 0; i < Math.max(a.length, b.length) && diffs.length < 6; i++) {
    const ra = a[i] ? a[i].join(' | ') : '(없음)';
    const rb = b[i] ? b[i].join(' | ') : '(없음)';
    if (ra !== rb) diffs.push(`행#${i}\n            A: ${ra}\n            B: ${rb}`);
  }
  return {
    same: false,
    detail: diffs.join('\n          '),
    hashA: createHash('sha256').update(ms(a)).digest('hex').slice(0, 12),
    hashB: createHash('sha256').update(ms(b)).digest('hex').slice(0, 12),
  };
}

/* ────────────────────────────── 7. 스냅샷 ────────────────────────────── */
/* ★ 우리가 짜는 쿼리라 NULL 모호성을 없애기 위해 `x IS NULL` 을 따로 싣는다.
 *   (계약 SQL 은 원문 그대로 실행해야 해서 컬럼을 덧붙일 수 없다 — 그쪽의 모호성은
 *    I4 의 "리터럴 'NULL' 값 0건" 가드가 없애 준다.) */
const SNAP_ORG = `SELECT org_id, name, IFNULL(parent_id,0), parent_id IS NULL, sort_order, is_active
                    FROM org_unit ORDER BY org_id`;
const SNAP_USER = `SELECT user_id, login_id, name, IFNULL(title,''), title IS NULL,
                          IFNULL(org_id,0), org_id IS NULL, view_scope, edit_role, is_active
                     FROM app_user ORDER BY user_id`;

/* 카운터 묶음 — 한 블록 안에 여러 SELECT 를 이어 붙여 'key<TAB>value' 로 받는다.
 *  ★ 도달불가는 재귀 CTE(깊이 512 가드)로 센다. 순환이 있으면 그 사슬은 루트에서
 *    도달할 수 없으므로 여기서 잡히고, 깊이 가드 덕에 무한 재귀로 죽지 않는다.        */
const COUNT_SQL = `
SELECT 'orphan_parent_id', COUNT(*) FROM org_unit c WHERE c.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM (SELECT org_id FROM org_unit) p WHERE p.org_id = c.parent_id);
SELECT 'orphan_user_org', COUNT(*) FROM app_user u WHERE u.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM (SELECT org_id FROM org_unit) o WHERE o.org_id = u.org_id);
SELECT 'roots', COUNT(*) FROM org_unit WHERE parent_id IS NULL;
SELECT 'dup_name_exact', COUNT(*) - COUNT(DISTINCT BINARY name) FROM org_unit;
SELECT 'name_ci_drift', COUNT(DISTINCT BINARY name) - COUNT(DISTINCT name) FROM org_unit;
SELECT 'inactive_parent', COUNT(*) FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id WHERE c.is_active=1 AND p.is_active=0;
SELECT 'member_hidden', COUNT(*) FROM app_user u JOIN org_unit o ON o.org_id = u.org_id WHERE u.is_active=1 AND o.is_active=0;
SELECT 'lit_null', (SELECT COUNT(*) FROM org_unit WHERE name='NULL') + (SELECT COUNT(*) FROM app_user WHERE name='NULL' OR login_id='NULL' OR title='NULL');
WITH RECURSIVE t AS (SELECT org_id, 0 AS d FROM org_unit WHERE parent_id IS NULL UNION ALL SELECT o.org_id, t.d+1 FROM org_unit o JOIN t ON o.parent_id = t.org_id WHERE t.d < 512)
SELECT 'unreachable', (SELECT COUNT(*) FROM org_unit) - (SELECT COUNT(DISTINCT org_id) FROM t);
`;

/** S1~S4 · HOST.user 의 @id 로 쓸 대표 사용자. login_id 는 루프가 절대 바꾸지 않으므로 한 번만 고른다. */
let PROBES = [];

function snapshot() {
  const items = [
    { key: 'org', sql: SNAP_ORG },
    { key: 'usr', sql: SNAP_USER },
    { key: 'cnt', sql: COUNT_SQL.trim() },
    { key: 'hu', sql: MUT.payloadUnits || HOST.units },
    { key: 'hm', sql: MUT.payloadMembers || HOST.members },
    { key: 'xu', sql: XREF.units },
    { key: 'xm', sql: XREF.members },
  ];
  for (const lid of PROBES) items.push({ key: 'up|' + lid, pre: `SET @id := ${q(lid)}`, sql: HOST.user });
  const b = batch(items, { what: '스냅샷' });

  const cnt = {};
  for (const r of b.get('cnt')) cnt[r[0]] = Number(r[1]);

  const units = b.get('org').map((r) => ({
    orgId: Number(r[0]),
    name: r[1],
    parentId: r[3] === '1' ? null : Number(r[2]),
    sort: Number(r[4]),
    active: r[5] === '1',
  }));
  const users = b.get('usr').map((r) => ({
    userId: Number(r[0]),
    loginId: r[1],
    name: r[2],
    title: r[4] === '1' ? null : r[3],
    orgId: r[6] === '1' ? null : Number(r[5]),
    scope: r[7],
    role: r[8],
    active: r[9] === '1',
  }));
  const probeRows = new Map();
  for (const lid of PROBES) probeRows.set(lid, b.get('up|' + lid));
  return {
    units, users, cnt,
    hostUnits: b.get('hu'), hostMembers: b.get('hm'),
    xrefUnits: b.get('xu'), xrefMembers: b.get('xm'),
    probeRows,
  };
}

/* ────────────────────────────── 8. 트리 알고리즘 3구현 ────────────────────────────── */

/** ① widget/ProjectDb.cs:443 ExpandUnitTree 를 그대로 옮긴 것(이름 경로).
 *    입력 units 는 **호스트가 실제로 받는 목록** = HOST.units 의 출력 그 자체다.
 *    (우리가 is_active 필터를 다시 흉내내면, 그 모델링이 틀려도 두 경로가 함께 틀려 상쇄된다.)
 *    ★ 루트(myUnit)는 units 에 없어도 항상 집합에 넣는다 — 원본의 '비활성 유닛' 배려. */
function expandUnitTreeByName(activeUnits, myUnit) {
  const allowed = new Set();
  const root = String(myUnit == null ? '' : myUnit).trim();
  if (!root) return allowed;
  const children = new Map();
  for (const u of activeUnits) {
    const p = u.parent == null ? '' : String(u.parent);
    if (!p) continue;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(u.name);
  }
  const queue = [root];
  allowed.add(root);
  while (queue.length) {
    const cur = queue.shift();
    for (const k of children.get(cur) || []) if (!allowed.has(k)) { allowed.add(k); queue.push(k); }
  }
  return allowed;
}

/** ② 같은 계산을 org_id/parent_id 로만 한다. 반환은 '이름 집합'(비교 가능하도록).
 *    루트 이름은 전체 표(비활성 포함)에서 org_id 로 찾는다 — ①의 '루트는 무조건 넣는다'와 대응. */
function expandUnitTreeById(allUnits, activeUnits, rootOrgId) {
  const allowed = new Set();
  if (rootOrgId == null) return allowed;
  const byId = new Map(allUnits.map((u) => [u.orgId, u]));
  const rootRow = byId.get(rootOrgId);
  if (!rootRow) return allowed;
  const children = new Map();
  for (const u of activeUnits) {
    if (u.parentId == null) continue;
    if (!children.has(u.parentId)) children.set(u.parentId, []);
    children.get(u.parentId).push(u.orgId);
  }
  const seen = new Set([rootOrgId]);
  const queue = [rootOrgId];
  allowed.add(rootRow.name);
  while (queue.length) {
    const cur = queue.shift();
    for (const kid of children.get(cur) || []) {
      if (seen.has(kid)) continue;
      seen.add(kid); queue.push(kid);
      const row = byId.get(kid);
      if (row) allowed.add(row.name);
    }
  }
  return allowed;
}

/** ③ 앱 JS 의 mbChildMap/mbSubtree(task-calendar-prototype.html:3921·3932) 포팅.
 *    호스트가 보내는 units 페이로드는 {name, parent|null, sortOrder} 다. */
function mbSubtree(unitsPayload, name) {
  const out = new Set();
  const root = String(name == null ? '' : name);
  if (!root) return out;
  const kids = new Map();
  for (const u of unitsPayload) {
    const p = (u && u.parent != null) ? String(u.parent) : '';
    if (!p) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(u);
  }
  const que = [root]; out.add(root);
  let first = true;
  while (que.length) {
    const cur = que.shift();
    for (const c of (kids.get(cur) || [])) {
      // ★ MUT.mbSubtreeBug: --selftest 전용 변이 — 첫 자식 하나를 빠뜨린다.
      //   '앱 포팅이 조용히 어긋나는' 실패 모드를 I6 이 정말 잡는지 확인하기 위한 것.
      if (MUT.mbSubtreeBug && first) { first = false; continue; }
      const nm = String((c && c.name) || '');
      if (nm && !out.has(nm)) { out.add(nm); que.push(nm); }
    }
  }
  return out;
}

const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const setDiff = (a, b) => ({ onlyA: [...a].filter((x) => !b.has(x)), onlyB: [...b].filter((x) => !a.has(x)) });

/* ────────────────────────────── 9. 불변식 ────────────────────────────── */

/* ── I0 스키마 계약 ─────────────────────────────────────────────────────────
 *  확정 최종 스키마 그대로인가. **어기면 루프를 돌 의미가 없으므로 그 자리에서 멈춘다.**
 *  ★ 이 판의 핵심은 '있어야 할 것' 만큼이나 '없어야 할 것' 이다 —
 *    org_unit.parent · app_user.org_unit · fk_org_parent · ix_org_parent 가 되살아나면
 *    미러 판으로 회귀한 것이고, 이 파일의 명제가 통째로 무의미해진다.                  */
function invSchemaContract() {
  const b = batch([
    { key: 'cols', sql: `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA
                           FROM information_schema.COLUMNS
                          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('org_unit','app_user') ORDER BY TABLE_NAME, ORDINAL_POSITION` },
    { key: 'idx', sql: `SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX), NON_UNIQUE
                          FROM information_schema.STATISTICS
                         WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('org_unit','app_user')
                         GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY TABLE_NAME, INDEX_NAME` },
    { key: 'fk', sql: `SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
                         FROM information_schema.KEY_COLUMN_USAGE k
                         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                           ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
                        WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME IN ('org_unit','app_user')
                        ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME` },
  ], { what: 'I0 스키마 계약' });
  const cols = new Map(b.get('cols').map((r) => [r[0] + '.' + r[1], { type: r[2], nullable: r[3], key: r[4], extra: r[5] }]));
  const idx = new Map(b.get('idx').map((r) => [r[0] + '.' + r[1], { cols: r[2], unique: r[3] === '0' }]));
  const fk = new Map(b.get('fk').map((r) => [r[0] + '.' + r[1], { col: r[2], refT: r[3], refC: r[4], upd: r[5], del: r[6] }]));
  const need = (cond, msg) => { if (!cond) violate('I0', msg); };
  /** 어떤 이름이든 좋으니 그 컬럼을 **선두로** 갖는 인덱스가 있는가(이름은 강제하지 않는다 —
   *  FK 가 자동 생성하면 제약 이름이 붙는다). */
  const leads = (table, col) => [...idx.entries()].some(([k, v]) => k.startsWith(table + '.') && v.cols.split(',')[0] === col);

  // ── org_unit: 있어야 할 것
  need(cols.has('org_unit.org_id') && /smallint unsigned/.test(cols.get('org_unit.org_id').type),
    'org_unit.org_id 가 없거나 SMALLINT UNSIGNED 가 아니다');
  need(cols.has('org_unit.org_id') && /auto_increment/i.test(cols.get('org_unit.org_id').extra || ''),
    'org_unit.org_id 에 AUTO_INCREMENT 가 없다 — 신설 조직이 번호를 못 받는다');
  need(idx.has('org_unit.PRIMARY') && idx.get('org_unit.PRIMARY').cols === 'org_id',
    `org_unit PK 가 org_id 가 아니다: ${idx.get('org_unit.PRIMARY') ? idx.get('org_unit.PRIMARY').cols : '(없음)'}`);
  need(idx.has('org_unit.uq_org_unit_name') && idx.get('org_unit.uq_org_unit_name').unique && idx.get('org_unit.uq_org_unit_name').cols === 'name',
    'org_unit.name 이 UNIQUE(uq_org_unit_name) 로 서 있지 않다');
  need(cols.has('org_unit.name') && cols.get('org_unit.name').nullable === 'NO', 'org_unit.name 이 NOT NULL 이 아니다');
  need(cols.has('org_unit.parent_id') && /smallint unsigned/.test(cols.get('org_unit.parent_id').type) && cols.get('org_unit.parent_id').nullable === 'YES',
    'org_unit.parent_id 가 없거나 SMALLINT UNSIGNED NULL 이 아니다');
  need(leads('org_unit', 'parent_id'), 'parent_id 를 선두로 하는 인덱스가 없다 — 자식 조회가 전수 스캔이 된다');
  const fkp = fk.get('org_unit.fk_org_parent_id');
  need(!!fkp, 'fk_org_parent_id(parent_id→org_unit.org_id) 가 없다');
  if (fkp) need(fkp.refT === 'org_unit' && fkp.refC === 'org_id' && fkp.upd === 'CASCADE' && fkp.del === 'RESTRICT',
    `fk_org_parent_id 규칙이 다르다: →${fkp.refT}.${fkp.refC} ON UPDATE ${fkp.upd} ON DELETE ${fkp.del}`);
  need(cols.has('org_unit.sort_order') && cols.get('org_unit.sort_order').nullable === 'NO', 'org_unit.sort_order 가 없거나 NULL 허용이다');
  need(cols.has('org_unit.is_active') && cols.get('org_unit.is_active').nullable === 'NO', 'org_unit.is_active 가 없거나 NULL 허용이다');
  need(cols.has('org_unit.created_at') && cols.has('org_unit.updated_at'), 'org_unit 에 created_at/updated_at 가 없다');

  // ── org_unit: ★ 없어야 할 것(완전 절단의 핵심)
  need(!cols.has('org_unit.parent'), '★ org_unit.parent(구 이름 컬럼)가 살아 있다 — 미러 판으로 회귀했다. 이 파일의 명제가 무의미해진다');
  need(!fk.has('org_unit.fk_org_parent'), '★ fk_org_parent(parent→name) 가 살아 있다 — 이것이 본부 개명을 1451 로 막던 제약이다');
  need(!idx.has('org_unit.ix_org_parent'), '★ ix_org_parent(parent) 인덱스가 살아 있다 — 절단 뒤에는 존재할 수 없다');

  // ── app_user: 있어야 할 것
  need(cols.has('app_user.org_id') && /smallint unsigned/.test(cols.get('app_user.org_id').type) && cols.get('app_user.org_id').nullable === 'YES',
    'app_user.org_id 가 없거나 SMALLINT UNSIGNED NULL 이 아니다');
  need(leads('app_user', 'org_id'), 'app_user.org_id 를 선두로 하는 인덱스가 없다');
  const fku = fk.get('app_user.fk_user_org_id');
  need(!!fku, 'fk_user_org_id(org_id→org_unit.org_id) 가 없다');
  if (fku) need(fku.refT === 'org_unit' && fku.refC === 'org_id' && fku.upd === 'CASCADE' && fku.del === 'RESTRICT',
    `fk_user_org_id 규칙이 다르다: →${fku.refT}.${fku.refC} ON UPDATE ${fku.upd} ON DELETE ${fku.del}`);
  need(idx.has('app_user.uq_app_user_login_id') && idx.get('app_user.uq_app_user_login_id').unique,
    'uq_app_user_login_id 가 사라졌다 — 앱은 login_id 로만 사람을 찾는다');

  // ── app_user: ★ 없어야 할 것
  need(!cols.has('app_user.org_unit'), '★ app_user.org_unit(구 이름 컬럼)가 살아 있다 — 미러 판으로 회귀했다');
  need(!fk.has('app_user.fk_user_org'), '★ fk_user_org(org_unit→org_unit.name) 가 살아 있다 — 절단 뒤에는 존재할 수 없다');
  need(!idx.has('app_user.ix_user_org'), '★ ix_user_org(org_unit) 인덱스가 살아 있다 — 절단 뒤에는 존재할 수 없다');
}

/* ── I0(낙진) 배포본 6문이 실제로 어떻게 되는지 ─────────────────────────────────
 *  절단을 '스키마 메타데이터' 가 아니라 **동작** 으로 증명한다. 이 판의 결정 근거가
 *  "S1 은 살고 S2~S6 만 죽는다(쓰기 없음 → 손상 위험 0)" 였으므로, 그 근거를 매 실행마다 재확인한다.
 *  ★ mysql 은 첫 오류에서 멈추므로 6문을 한 번에 못 보낸다 — 문장별로 따로 쏜다(1회성). */
function invDeployedFallout(probes) {
  const lid = probes[0] || 'nobody';
  const report = [];
  for (const s of DEPLOYED) {
    const sql = (s.param ? `SET @id := ${q(lid)};\n` : '') + s.sql + ';';
    const r = mysqlRun('SET NAMES utf8mb4;\n' + sql, { db: CLONE, readOnly: true, what: `배포본 낙진 ${s.key}` });
    if (isEnvErrno(r.errno)) envFail(`배포본 낙진 확인 중 환경 오류 (${s.key}) errno=${r.errno}`, cleanErr(r.err));
    const survived = r.ok;
    report.push(`${s.key}=${survived ? '생존' : 'errno ' + r.errno}`);
    if (s.survive && !survived) {
      violate('I0', `★ 배포본 ${s.key}(${s.line} ${s.what})이 죽었다 — errno=${r.errno}. ` +
        '이 문장은 조직 컬럼을 보지 않으므로 절단 뒤에도 살아 있어야 한다(과제 편집 권한 관문).',
        cleanErr(r.err) + ' | ' + s.sql);
    }
    if (!s.survive && survived) {
      violate('I0', `★ 배포본 ${s.key}(${s.line} ${s.what})이 아직 살아 있다 — 구 컬럼이 어딘가 남아 있다는 뜻이다(절단 미완).`, s.sql);
    }
    if (!s.survive && !survived && r.errno !== 1054) {
      violate('I0', `배포본 ${s.key} 가 기대와 다른 이유로 죽었다: errno=${r.errno} (기대 1054 Unknown column)`, cleanErr(r.err));
    }
  }
  return report.join(' · ');
}

/** I1 — 트리 건강: 순환 없음 · 루트 정확히 1개 · 도달불가 0 */
function invTreeHealth(st) {
  const byId = new Map(st.units.map((u) => [u.orgId, u]));
  const roots = st.units.filter((u) => u.parentId == null);

  if (roots.length !== 1) {
    violate('I1', `루트(parent_id IS NULL)가 ${roots.length}개 — 정확히 1개여야 한다`,
      roots.slice(0, 10).map((r) => `${r.orgId}:${r.name}`).join(', '));
  }
  if (st.cnt.roots !== roots.length) {
    violate('I1', `루트 수가 SQL(${st.cnt.roots})과 스냅샷(${roots.length})에서 다르다 — 둘 중 하나가 거짓말을 하고 있다`);
  }

  // 순환 — 각 노드에서 부모를 따라 올라가며 방문 집합으로 막는다.
  const inCycle = new Set();
  for (const u of st.units) {
    const seen = new Set([u.orgId]);
    let cur = u;
    for (let i = 0; i < st.units.length + 2; i++) {
      if (cur.parentId == null) break;
      if (seen.has(cur.parentId)) {
        if (!inCycle.has(cur.parentId)) {
          inCycle.add(cur.parentId);
          violate('I1', `parent_id 경로에 순환: ${u.name}(org_id ${u.orgId}) 에서 출발해 org_id ${cur.parentId} 로 되돌아온다`);
        }
        break;
      }
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId);
      if (!cur) break;   // 고아는 I2 가 잡는다
    }
  }

  // 도달불가 — 루트(들)에서 BFS 로 못 닿는 노드. SQL 의 재귀 CTE 결과와 교차 검증한다.
  const reach = new Set(roots.map((r) => r.orgId));
  const kids = new Map();
  for (const u of st.units) { if (u.parentId == null) continue; if (!kids.has(u.parentId)) kids.set(u.parentId, []); kids.get(u.parentId).push(u.orgId); }
  const que = roots.map((r) => r.orgId);
  while (que.length) { const c = que.shift(); for (const k of kids.get(c) || []) if (!reach.has(k)) { reach.add(k); que.push(k); } }
  const lost = st.units.filter((u) => !reach.has(u.orgId));
  if (lost.length) {
    violate('I1', `루트에서 **도달불가**한 조직 ${lost.length}개 — 조직도에 그려지지 않는 섬이 생겼다`,
      lost.slice(0, 10).map((u) => `${u.orgId}:${u.name}(parent_id=${u.parentId})`).join(' · '));
  }
  if (st.cnt.unreachable !== lost.length) {
    violate('I1', `도달불가 수가 재귀 CTE(${st.cnt.unreachable})와 스냅샷 BFS(${lost.length})에서 다르다 — 계측이 어긋났다`);
  }
}

/** I2 — 고아 0. FK 가 강제하지만, FK 가 사라지거나 우회되는 경로가 있으므로 매번 확인한다. */
function invOrphan(st) {
  if (st.cnt.orphan_parent_id !== 0) {
    const byId = new Set(st.units.map((u) => u.orgId));
    const bad = st.units.filter((u) => u.parentId != null && !byId.has(u.parentId));
    violate('I2', `org_unit.parent_id 가 실재하지 않는 org_id 를 가리킨다 — ${st.cnt.orphan_parent_id}행 (fk_org_parent_id 가 무력화됐다)`,
      bad.slice(0, 8).map((u) => `${u.name}→${u.parentId}`).join(' · '));
  }
  if (st.cnt.orphan_user_org !== 0) {
    const byId = new Set(st.units.map((u) => u.orgId));
    const bad = st.users.filter((u) => u.orgId != null && !byId.has(u.orgId));
    violate('I2', `app_user.org_id 가 실재하지 않는 org_id 를 가리킨다 — ${st.cnt.orphan_user_org}행 (fk_user_org_id 가 무력화됐다)`,
      bad.slice(0, 8).map((u) => `${u.loginId}→${u.orgId}`).join(' · '));
  }
}

/** I3 — 숨김(is_active=0)이 만드는 절단.
 *  신버전도 배포본도 `is_active=1` 로 조직을 읽는다(HOST.units / ProjectDb.cs:364).
 *  (a) 부모 행이 목록에서 빠지면 그 하위 트리가 통째로 끊겨 열람 범위가 조용히 줄어든다.
 *  (b) ★ 조직이 아니라 **사람** 이 갇히는 경우 — 비활성 조직에 재직자가 남아 있는 상태.
 *      (a) 는 조직만 세므로, 자식 조직까지 전부 숨기면 (a) 는 0 이 되는데 그 안의 사람은
 *      살아 있는 채로 조직도에서 사라진다. 옛 판은 이 상태를 아무 게이트도 보지 않아서,
 *      org-ops repair -DeactivateOrphanedChildren 이 그것을 **직접 만들고** '불변식 전 항목
 *      통과'를 선언했다(실측: CTO 열람 89 → 69명, 게이트 3종 전부 exit 0). */
function invActiveParent(st) {
  const byId = new Map(st.units.map((u) => [u.orgId, u]));

  // ── (b) 비활성 조직에 남은 재직자 ────────────────────────────────────────
  //  ※ 소속이 없는 조직을 가리키는 경우(고아)는 I2 가 본다 — 여기서는 실재하는 조직만 센다.
  const hidden = st.users.filter((x) => x.active && x.orgId != null
    && byId.has(x.orgId) && !byId.get(x.orgId).active);
  if (st.cnt.member_hidden !== hidden.length) {
    violate('I3', `'비활성 조직에 남은 재직자' 수가 SQL(${st.cnt.member_hidden})과 스냅샷(${hidden.length})에서 다르다 — 계측이 어긋났다`);
  }
  if (hidden.length) {
    const perOrg = new Map();
    for (const x of hidden) perOrg.set(x.orgId, (perOrg.get(x.orgId) || 0) + 1);
    violate('I3', `비활성(is_active=0) 조직에 재직자 ${hidden.length}명이 남아 있다 — 조직도(is_active=1)에서도 상위 조직의 unit_tree 열람 범위에서도 통째로 빠진다`,
      [...perOrg.entries()].slice(0, 8).map(([oid, cnt]) => `${byId.get(oid).name}(org_id ${oid}): ${cnt}명`).join(' · '));
  }

  // ── (a) 비활성 부모의 활성 자식 조직 ─────────────────────────────────────
  const bad = [];
  for (const u of st.units) {
    if (!u.active || u.parentId == null) continue;
    const p = byId.get(u.parentId);
    if (p && !p.active) bad.push({ node: u, parent: p });
  }
  if (st.cnt.inactive_parent !== bad.length) {
    violate('I3', `'비활성 부모의 활성 자식' 수가 SQL(${st.cnt.inactive_parent})과 스냅샷(${bad.length})에서 다르다`);
  }
  if (!bad.length) return;

  // 피해 규모 — 페이로드(활성 목록)에서 그 하위 트리가 몇 개 조직·몇 명을 데리고 나가는가
  const payload = st.hostUnits.map((r) => ({ name: r[0], parent: r[1] === 'NULL' ? null : r[1] }));
  const kids = new Map();
  for (const u of payload) { if (u.parent == null) continue; if (!kids.has(u.parent)) kids.set(u.parent, []); kids.get(u.parent).push(u.name); }
  const nameOfUser = new Map(st.units.map((u) => [u.orgId, u.name]));
  const detail = bad.map(({ node, parent }) => {
    const sub = new Set([node.name]);
    const que = [node.name];
    while (que.length) { const c = que.shift(); for (const k of kids.get(c) || []) if (!sub.has(k)) { sub.add(k); que.push(k); } }
    const members = st.users.filter((x) => x.active && x.orgId != null && sub.has(nameOfUser.get(x.orgId))).length;
    return `${node.name}: 상위 ${parent.name} 가 비활성 → 하위 ${sub.size}개 조직·활성 ${members}명이 조직도에서 떨어져 나간다`;
  });
  violate('I3', `활성 조직 ${bad.length}개의 상위가 비활성 — is_active=1 로 읽는 조직도가 끊긴다`, detail.slice(0, 8).join(' · '));
}

/** I4 — 이름 유일성·표기.
 *  ★ ai_ci 중복(대소문자만 다른 쌍)은 uq_org_unit_name 이 막지만, 그 인덱스가 사라지는
 *    회귀가 있으므로 SQL 로도 센다. 표기(TRIM·전각·빈 이름)는 JS 로 본다 — 콜레이션과 무관하고,
 *    호스트(StringComparer.Ordinal)와 앱(===)이 보는 것과 같은 기준이기 때문이다. */
function invNames(st) {
  if (st.cnt.dup_name_exact !== 0) {
    violate('I4', `조직명이 바이트까지 완전히 중복 ${st.cnt.dup_name_exact}건 — uq_org_unit_name 이 무력화됐다`);
  }
  if (st.cnt.name_ci_drift !== 0) {
    /* ★ DB 는 utf8mb4_0900_ai_ci 라 'Aa팀' 과 'AA팀' 을 **같은 값**으로 본다 — uq_org_unit_name 도
     *   불평하지 않는다. 그런데 호스트는 StringComparer.Ordinal(ProjectDb.cs:447), 앱 JS 는 === 로
     *   비교한다. 즉 **DB 는 정합하다고 하는데 화면의 트리는 끊기는** 상태다. */
    violate('I4', `DB(ai_ci)는 같다고 보는데 BINARY 로는 다른 조직명이 ${st.cnt.name_ci_drift}쌍 — ` +
      '호스트 Ordinal/앱 === 는 서로 다른 이름으로 읽어 트리가 끊긴다(대소문자 표류)');
  }
  if (st.cnt.lit_null !== 0) {
    violate('I4', `값이 문자열 리터럴 'NULL' 인 행이 ${st.cnt.lit_null}건 — batch 출력에서 진짜 NULL 과 구분이 안 되어 ` +
      'I5 payload 판정이 무의미해진다');
  }
  const seen = new Map();
  const bad = [];
  for (const u of st.units) {
    const nm = u.name;
    if (nm !== nm.trim()) bad.push(`${u.orgId}: 앞뒤 공백 ${JSON.stringify(nm)}`);
    if (nm.length === 0) bad.push(`${u.orgId}: 빈 이름`);
    if (nm.length > 50) bad.push(`${u.orgId}: 50자 초과(${nm.length}자)`);
    if (/[！-～　]/.test(nm)) bad.push(`${u.orgId}: 전각 문자 포함 ${JSON.stringify(nm)}`);
    if (/[\u0000-\u001f]/.test(nm)) bad.push(`${u.orgId}: 제어문자 포함`);
    if (seen.has(nm)) bad.push(`${u.orgId}: 이름 완전 중복 ${JSON.stringify(nm)} (org_id ${seen.get(nm)} 와 같다)`);
    else seen.set(nm, u.orgId);
  }
  if (bad.length) violate('I4', `조직명 표기 규칙 위반 ${bad.length}건 — 앱은 이름을 문자열 그대로 비교한다`, bad.slice(0, 10).join(' · '));
}

/* ── I5 신버전 payload 정확성 ────────────────────────────────────────────────
 *  ① 내용의 오라클은 **JS 가 id 경로로 직접 계산한 정답** 이다(다중집합 완전 일치).
 *  ② 순서의 오라클은 **같은 답을 다른 SQL 형태로 뽑은 대조본** 이다(시퀀스 일치).
 *     콜레이션 정렬을 JS 로 재구현하지 않는 이유는, 그 재구현이 틀리면 멀쩡한 DB 에서
 *     가짜 실패가 나기 때문이다. 대신 콜레이션과 무관한 순서 성질(숫자 단조성 ·
 *     같은 조직 묶임 · NULL 선두)을 따로 검사해 'ORDER BY 가 통째로 빠진' 결함을 잡는다.
 *  ★ NULL 은 batch 출력에서 문자열 'NULL' 로 찍힌다. I4 가 "리터럴 'NULL' 값 0건" 을
 *    지켜 주므로 그 전제 위에서만 'NULL' 을 NULL 로 읽는다.                             */
function invPayload(st) {
  const nameById = new Map(st.units.map((u) => [u.orgId, u.name]));
  const nm = (id) => (id == null || !nameById.has(id) ? 'NULL' : nameById.get(id));
  let compared = 0;

  // ── units ──────────────────────────────────────────────────────────────
  const truthU = st.units.filter((u) => u.active).map((u) => [u.name, nm(u.parentId), String(u.sort)]);
  const msOf = (x) => x.map((r) => r.join('\u0001')).sort();
  const msU = msOf(truthU), msH = msOf(st.hostUnits);
  if (msU.length !== msH.length || msU.some((v, i) => v !== msH[i])) {
    const onlyT = msU.filter((v) => !msH.includes(v)).slice(0, 6);
    const onlyH = msH.filter((v) => !msU.includes(v)).slice(0, 6);
    violate('I5', `units payload 의 내용이 id 경로 정답과 다르다 — 정답 ${msU.length}행 vs payload ${msH.length}행`,
      `정답에만: [${onlyT.join(' / ')}] · payload 에만: [${onlyH.join(' / ')}]\n          SQL: ${MUT.payloadUnits || HOST.units}`);
  }
  const cu = compareResult(st.hostUnits, st.xrefUnits, [2, 0]);
  compared++;
  if (!cu.same) {
    violate('I5', `units payload 가 같은 답을 다른 형태로 뽑은 대조본과 다르다(행·값·순서) [${cu.hashA} vs ${cu.hashB}]`,
      `A=payload(JOIN) B=대조본(상관 서브쿼리)\n          ${cu.detail}`);
  }
  // 콜레이션과 무관한 순서 성질: sort_order 가 비내림차순인가
  for (let i = 1; i < st.hostUnits.length; i++) {
    if (Number(st.hostUnits[i][2]) < Number(st.hostUnits[i - 1][2])) {
      violate('I5', `units payload 의 sort_order 가 뒤집혔다 — ORDER BY 가 듣지 않는다`,
        `행#${i - 1}=${st.hostUnits[i - 1].join('|')} → 행#${i}=${st.hostUnits[i].join('|')}`);
      break;
    }
  }

  // ── members ────────────────────────────────────────────────────────────
  const truthM = st.users.filter((u) => u.active).map((u) => [u.loginId, u.name, u.title == null ? 'NULL' : u.title, nm(u.orgId)]);
  const msT = msOf(truthM), msM = msOf(st.hostMembers);
  if (msT.length !== msM.length || msT.some((v, i) => v !== msM[i])) {
    const onlyT = msT.filter((v) => !msM.includes(v)).slice(0, 6);
    const onlyH = msM.filter((v) => !msT.includes(v)).slice(0, 6);
    violate('I5', `members payload 의 내용이 id 경로 정답과 다르다 — 정답 ${msT.length}행 vs payload ${msM.length}행`,
      `정답에만: [${onlyT.join(' / ')}] · payload 에만: [${onlyH.join(' / ')}]\n          SQL: ${MUT.payloadMembers || HOST.members}`);
  }
  const cm = compareResult(st.hostMembers, st.xrefMembers, [3, 1]);
  compared++;
  if (!cm.same) {
    violate('I5', `members payload 가 같은 답을 다른 형태로 뽑은 대조본과 다르다(행·값·순서) [${cm.hashA} vs ${cm.hashB}]`,
      `A=payload(JOIN) B=대조본(상관 서브쿼리)\n          ${cm.detail}`);
  }
  // 콜레이션과 무관한 순서 성질: 같은 조직이 흩어지지 않는가 · 소속 미등록(NULL)이 앞인가
  const firstSeen = new Map();
  let prev = null, broken = null;
  st.hostMembers.forEach((r, i) => {
    const org = r[3];
    if (prev !== null && org !== prev && firstSeen.has(org) && broken === null) broken = { i, org };
    if (!firstSeen.has(org)) firstSeen.set(org, i);
    prev = org;
  });
  if (broken) {
    violate('I5', `members payload 에서 같은 조직의 행이 흩어졌다 — ORDER BY 가 듣지 않는다`,
      `행#${broken.i} 에서 조직 '${broken.org}' 가 다시 나타난다(처음 등장 행#${firstSeen.get(broken.org)})`);
  }
  const nullIdx = st.hostMembers.findIndex((r) => r[3] === 'NULL');
  if (nullIdx > 0 && st.hostMembers.slice(0, nullIdx).some((r) => r[3] !== 'NULL')) {
    violate('I5', 'members payload 에서 소속 미등록(NULL)이 앞에 오지 않았다 — ORDER BY 의 NULL 처리가 바뀌었다',
      `첫 NULL 행#${nullIdx}`);
  }

  // ── 단건 조회(로그인 인가·사용자정보·열람범위 기준점) ────────────────────────
  const byLogin = new Map(st.users.map((u) => [u.loginId, u]));
  for (const [lid, got] of st.probeRows) {
    compared++;
    const u = byLogin.get(lid);
    const want = u ? [[u.loginId, u.name, u.title == null ? 'NULL' : u.title, nm(u.orgId), u.scope, u.role, u.active ? '1' : '0']] : [];
    const c = compareResult(got, want, []);
    if (!c.same) violate('I5', `단건 사용자 payload 가 id 경로 정답과 다르다 (@id=${lid})`, c.detail + '\n          SQL: ' + HOST.user);
  }
  return compared;
}

/** I6 — ExpandUnitTree 이름 경로 == id 경로, 그리고 앱 mbSubtree == 이름 경로.
 *  ★ 이름 경로의 입력은 **호스트가 실제로 받는 목록**(HOST.units 출력) 그 자체다. */
function invExpand(st) {
  const active = st.units.filter((u) => u.active);
  const hostUnits = st.hostUnits.map((r) => ({ name: r[0], parent: r[1] === 'NULL' ? null : r[1], sort: Number(r[2]) }));
  const payload = hostUnits.map((u) => ({ name: u.name, parent: u.parent, sortOrder: u.sort }));

  // payload 가 준 활성 목록과 스냅샷의 is_active=1 목록이 어긋나면 그 자체가 결함이다.
  const dSet = new Set(hostUnits.map((u) => u.name));
  const aSet = new Set(active.map((u) => u.name));
  if (!setEq(dSet, aSet)) {
    const d = setDiff(dSet, aSet);
    violate('I6', `payload 가 준 활성 목록과 스냅샷의 is_active=1 목록이 다르다 — payload ${dSet.size}개 vs 스냅샷 ${aSet.size}개`,
      `payload 에만: [${d.onlyA.join(', ')}] · 스냅샷에만: [${d.onlyB.join(', ')}]`);
  }

  const nameById = new Map(st.units.map((u) => [u.orgId, u.name]));
  const roots = [];
  for (const u of st.units) roots.push({ label: `unit ${u.name}${u.active ? '' : '(비활성)'}`, name: u.name, orgId: u.orgId, appSelectable: u.active });
  for (const usr of st.users) roots.push({ label: `user ${usr.loginId}(${usr.scope})`, name: usr.orgId == null ? null : nameById.get(usr.orgId), orgId: usr.orgId, appSelectable: false });

  let checked = 0;
  for (const r of roots) {
    const byNameSet = expandUnitTreeByName(hostUnits, r.name);
    const byIdSet = expandUnitTreeById(st.units, active, r.orgId);
    if (!setEq(byNameSet, byIdSet)) {
      const d = setDiff(byNameSet, byIdSet);
      violate('I6', `ExpandUnitTree 결과 불일치(${r.label}) — 이름경로 ${byNameSet.size}개 vs id경로 ${byIdSet.size}개`,
        `이름경로에만: [${d.onlyA.join(', ')}] · id경로에만: [${d.onlyB.join(', ')}]`);
    }
    if (r.appSelectable) {   // 앱은 활성 유닛만 트리에 그리고 그것만 선택할 수 있다
      const app = mbSubtree(payload, r.name);
      if (!setEq(byNameSet, app)) {
        const d = setDiff(byNameSet, app);
        violate('I6', `앱 mbSubtree 결과가 호스트 ExpandUnitTree 와 불일치(${r.label})`,
          `호스트에만: [${d.onlyA.join(', ')}] · 앱에만: [${d.onlyB.join(', ')}]`);
      }
    }
    checked++;
  }
  return checked;
}

/** 전 불변식 1회 — 조작마다 부른다. schema:true 면 I0(스키마 계약)까지 본다. */
function checkAll(st, { schema = false } = {}) {
  if (schema) invSchemaContract();
  invTreeHealth(st);
  invOrphan(st);
  invActiveParent(st);
  invNames(st);
  const c = invPayload(st);
  invExpand(st);
  return c;
}

/* ────────────────────────────── 10. 무작위 조작 ────────────────────────────── */

const NAME_BASE = ['가온', '나래', '다솜', '라온', '마루', '바다', '아라', '한별', '해솔', '벼리', '미르', '슬기', '푸른', '참빛', '하늘', '너울'];
const NAME_KIND = ['팀', '본부', '실', '그룹', '연구소'];
let nameSeq = 0;
/** 합성 조직명 — 실명은 이 파일에 한 글자도 넣지 않는다(실명은 비공개 저장소 소관). */
function newUnitName(existing) {
  for (let i = 0; i < 2000; i++) {
    const nm = pick(NAME_BASE) + pick(NAME_KIND) + '_' + (++nameSeq);
    if (nm !== 'NULL' && nm.length <= 50 && !existing.has(nm)) return nm;
  }
  throw new Error('새 조직명 생성 실패');
}

/** 어떤 노드의 후손 org_id 집합(자기 자신 포함) — 순환 생성 방지·하위 트리 조작에 쓴다. */
function descendantIds(units, orgId) {
  const kids = new Map();
  for (const u of units) { if (u.parentId == null) continue; if (!kids.has(u.parentId)) kids.set(u.parentId, []); kids.get(u.parentId).push(u.orgId); }
  const out = new Set([orgId]);
  const que = [orgId];
  while (que.length) { const c = que.shift(); for (const k of kids.get(c) || []) if (!out.has(k)) { out.add(k); que.push(k); } }
  return out;
}

/** 어떤 노드의 조상 사슬(자기 자신 포함, 루트까지) */
function ancestorChain(units, orgId) {
  const byId = new Map(units.map((u) => [u.orgId, u]));
  const out = [];
  let cur = byId.get(orgId);
  const seen = new Set();
  for (let i = 0; cur && i < units.length + 2; i++) {
    if (seen.has(cur.orgId)) break;
    seen.add(cur.orgId);
    out.push(cur);
    cur = cur.parentId == null ? null : byId.get(cur.parentId);
  }
  return out;
}

const opLog = [];        // {n, phase, kind, desc, sql, outcome, verified}
/* ★ ROW_COUNT 마커 유실 집계 — 위반이 아니라 '계측 실패' 다.
 *   ①(ROW_COUNT)은 ②③(스냅샷 대조)의 **보강**일 뿐이고 진짜 오라클은 스냅샷이다.
 *   마커를 못 받았어도 스냅샷이 기대한 효과를 보여주면 조작은 실제로 일어난 것이다 —
 *   그것을 위반으로 올리면 게이트가 무작위로 우는 늑대가 된다. 대신 집계해 요약에 찍는다. */
const rcMiss = [];       // {n, kind, tag, sql}
const kindAttempt = {};  // 시도한 횟수
const kindVerified = {}; // ★ '효과가 실제로 확인된' 횟수 — 요약에 나가는 것은 이 숫자다

const OP_KINDS = [
  [3, 'rename-leaf'],
  [4, 'rename-branch'],     // ★ 옛 스키마에서 ERROR 1451 로 죽던 것 — 이제 1문장이다
  [1, 'rename-root'],
  [3, 'move-team'],
  [2, 'add-team'],
  [2, 'toggle-active'],
  [3, 'move-user'],
  [2, 'sort-order'],
];

/* ★ 활성 조직 수 하한 — 편향 보정.
 *   앞선 판에서 toggle-active 가 누적 편향돼 활성 조직이 1개까지 줄었다. 그러면 트리가
 *   사실상 사라져 후반 검출력(payload·ExpandUnitTree·정렬)이 통째로 없어진다.
 *   숨김 후보를 고를 때 **이 하한 아래로 내려가는 후보는 아예 뽑지 않고**,
 *   활성 비율이 낮을수록 '복원' 쪽으로 확률을 기울인다. */
const activeFloor = (total) => Math.max(5, Math.ceil(total * 0.5));

const RCMARK = '__TCRC__';

/** 계획을 실행하고 문장별 ROW_COUNT 를 함께 받아 온다. */
function execPlan(plan) {
  const parts = ['SET NAMES utf8mb4;'];
  if (plan.tx) parts.push('START TRANSACTION;');
  plan.stmts.forEach((s, i) => {
    // ★ MUT.noopOps: --selftest 전용 변이 — 조작을 통째로 no-op 으로 만든다.
    //   "조작을 전부 no-op 으로 바꿔도 통과하던" 옛 구멍을 I8 이 정말 막는지 확인한다.
    parts.push((MUT.noopOps ? 'DO 0' : s.sql).replace(/;?\s*$/, ';'));
    // ROW_COUNT() 는 '직전 문장' 의 영향 행수다 — DML 바로 뒤에서만 의미가 있다.
    parts.push(`SELECT ${q(RCMARK)}, ${i}, ROW_COUNT(), LAST_INSERT_ID();`);
  });
  if (plan.tx) parts.push('COMMIT;');
  const sql = parts.join('\n');
  /* ★ 이 호출만 reportTrunc 다 — DML 이라 재시도하면 두 번 적용된다.
   *   출력이 잘리면 ROW_COUNT **계측만** 잃는다. counts 를 전부 null 로 만들어
   *   '0행' 과 '유실' 을 구조적으로 갈라 놓고, 효과 검증은 스냅샷이 맡는다(verifyPlan ④). */
  const r = mysqlRun(sql, { db: CLONE, reportTrunc: true, what: `조작 [${plan.kind}] ${plan.desc}` });
  const counts = plan.stmts.map(() => null);
  let lastId = null;
  if (!r.truncated) {
    for (const line of (r.out || '').split(/\r?\n/)) {
      if (line.slice(0, RCMARK.length + 1) !== RCMARK + '\t') continue;
      const f = line.split('\t');
      counts[Number(f[1])] = Number(f[2]);
      if (f[3] && f[3] !== 'NULL' && Number(f[3]) > 0) lastId = Number(f[3]);
    }
  } else {
    console.log(el(), `  ⚠ op#${curOp} [${plan.kind}] ROW_COUNT 계측을 통째로 유실했다(출력 잘림) — ` +
      '효과는 스냅샷으로 확인한다. 조작 자체는 실행됐다(종료코드 0).');
  }
  return { r, sql, counts, lastId, truncated: !!r.truncated };
}

const sameUnit = (x, y) => x.name === y.name && x.parentId === y.parentId && x.sort === y.sort && x.active === y.active;
const sameUser = (x, y) => x.loginId === y.loginId && x.name === y.name && x.title === y.title && x.orgId === y.orgId && x.scope === y.scope && x.active === y.active;
const showUnit = (u) => `${u.name}(#${u.orgId}, parent_id=${u.parentId}, sort=${u.sort}, ${u.active ? '활성' : '숨김'})`;
const showUser = (u) => `${u.loginId}(org_id=${u.orgId})`;

/* ══ 조작의 '효과' 검증 ═══════════════════════════════════════════════════════
 *  ★ 옛 구조의 구멍: runOp 이 mysqlRun 의 r.ok 만 보고 넘어갔다. 그래서 조작 SQL 을
 *    전부 no-op 으로 바꿔도 exit 0 이었고 "조작 종류 분포: … / 실패한 조작: 0건 ✓" 를 찍었다.
 *    '의도' 를 세어 놓고 '결과' 인 척한 것이다.
 *  ★ 지금은 조작마다 실행 **전에** 기대 모델을 선언한다 —
 *      ① 문장별 기대 ROW_COUNT  ② 실행 후 특정 행이 가져야 할 값
 *      ③ 바뀌어도 되는 행의 목록(그 밖의 행이 바뀌면 그것도 위반)
 *    셋을 모두 통과한 조작만 '효과 확인됨' 으로 센다.
 *  ★★ ③ 은 절단판에서 특별한 의미를 갖는다: 개명이 **정말 1문장으로 끝나는지** 를 증명한다.
 *     이름을 들고 있는 곳이 org_unit.name 한 곳뿐이므로, 개명 뒤 다른 행이 하나라도
 *     바뀌었다면 어딘가에 아직 사본이 있다는 뜻이다.                                   */
function verifyPlan(plan, exec, before, after) {
  let bad = 0;
  const head = `조작 [${plan.kind}] ${plan.desc}`;
  const fail = (msg, detail) => { violate('I8', msg, detail); bad++; };

  // ── ① 문장별 ROW_COUNT ─────────────────────────────────────────────
  if (!plan.stmts.some((s) => s.rows > 0)) {
    fail(`${head} — 기대 행수가 전부 0인 계획이다(검증할 효과가 없는 조작은 만들지 않는다)`);
  }
  const missing = [];   // 마커를 못 받은 문장 — 즉시 실패시키지 않고 ②③ 뒤에 판정한다
  plan.stmts.forEach((s, i) => {
    const got = exec.counts[i];
    const tag = `${i + 1}번 문장${s.label ? '(' + s.label + ')' : ''}`;
    if (got === null || got === undefined) {
      missing.push({ tag, sql: s.sql });
    } else if (got !== s.rows) {
      fail(`${head} — ${tag} 의 영향 행수가 기대와 다르다: 기대 ${s.rows} · 실제 ${got}` +
        (got <= 0 ? '  ★ 아무 행도 바뀌지 않았다 = 조작이 아무 일도 하지 않았다' : ''), s.sql);
    }
  });

  // ── ② 기대값이 실제로 스냅샷에 나타났는가 ────────────────────────────
  const aUnit = new Map(after.units.map((u) => [u.orgId, u]));
  const bUnit = new Map(before.units.map((u) => [u.orgId, u]));
  const aUser = new Map(after.users.map((u) => [u.userId, u]));
  const bUser = new Map(before.users.map((u) => [u.userId, u]));

  for (const e of plan.expect.units || []) {
    const row = aUnit.get(e.orgId);
    if (!row) { fail(`${head} — org_id ${e.orgId} 행이 사라졌다`); continue; }
    for (const k of ['name', 'parentId', 'sort', 'active']) {
      if (e[k] === undefined) continue;
      if (row[k] !== e[k]) fail(`${head} — org_id ${e.orgId} 의 ${k} 가 기대와 다르다: 기대 ${JSON.stringify(e[k])} · 실제 ${JSON.stringify(row[k])}`);
    }
  }
  for (const e of plan.expect.users || []) {
    const row = aUser.get(e.userId);
    if (!row) { fail(`${head} — user_id ${e.userId} 행이 사라졌다`); continue; }
    if (e.orgId !== undefined && row.orgId !== e.orgId) {
      fail(`${head} — user_id ${e.userId} 의 org_id 가 기대와 다르다: 기대 ${JSON.stringify(e.orgId)} · 실제 ${JSON.stringify(row.orgId)}`);
    }
  }
  const changedUnits = new Set(plan.expect.changedUnits || []);
  if (plan.expect.addUnit) {
    const want = plan.expect.addUnit;
    const row = after.units.find((u) => u.name === want.name);
    if (!row) {
      fail(`${head} — 새 조직 ${want.name} 이 실제로 생기지 않았다`);
    } else {
      changedUnits.add(row.orgId);
      for (const k of ['parentId', 'sort', 'active']) {
        if (want[k] === undefined) continue;
        if (row[k] !== want[k]) fail(`${head} — 새 조직 ${want.name} 의 ${k} 가 기대와 다르다: 기대 ${JSON.stringify(want[k])} · 실제 ${JSON.stringify(row[k])}`);
      }
      if (exec.lastId != null && row.orgId !== exec.lastId) {
        fail(`${head} — 새 조직의 org_id 가 LAST_INSERT_ID(${exec.lastId}) 와 다르다: ${row.orgId}`);
      }
    }
  }

  // ── ③ 선언한 행은 반드시 바뀌고, 선언하지 않은 행은 반드시 그대로여야 한다 ──
  const stale = [...changedUnits].filter((id) => bUnit.has(id) && aUnit.has(id) && sameUnit(bUnit.get(id), aUnit.get(id)));
  if (stale.length) {
    fail(`${head} — 바뀌어야 한다고 선언한 조직 ${stale.length}행이 조작 전과 완전히 같다(효과 없음)`,
      stale.map((id) => showUnit(aUnit.get(id))).join(' · '));
  }
  const changedUsers = new Set(plan.expect.changedUsers || []);
  const staleU = [...changedUsers].filter((id) => bUser.has(id) && aUser.has(id) && sameUser(bUser.get(id), aUser.get(id)));
  if (staleU.length) {
    fail(`${head} — 바뀌어야 한다고 선언한 사용자 ${staleU.length}행이 조작 전과 완전히 같다(효과 없음)`,
      staleU.map((id) => showUser(aUser.get(id))).join(' · '));
  }
  const unexpectedU = after.units.filter((u) => bUnit.has(u.orgId) && !changedUnits.has(u.orgId) && !sameUnit(bUnit.get(u.orgId), u));
  if (unexpectedU.length) {
    fail(`${head} — 선언하지 않은 조직 ${unexpectedU.length}행이 함께 바뀌었다` +
      (/^rename-/.test(plan.kind) ? '  ★ 개명이 1문장이 아니다 — 이름 사본이 어딘가 남아 있다' : ''),
      unexpectedU.slice(0, 8).map((u) => `${showUnit(bUnit.get(u.orgId))} → ${showUnit(u)}`).join(' · '));
  }
  const unexpectedUsr = after.users.filter((u) => bUser.has(u.userId) && !changedUsers.has(u.userId) && !sameUser(bUser.get(u.userId), u));
  if (unexpectedUsr.length) {
    fail(`${head} — 선언하지 않은 사용자 ${unexpectedUsr.length}행이 함께 바뀌었다`,
      unexpectedUsr.slice(0, 8).map((u) => `${showUser(bUser.get(u.userId))} → ${showUser(u)}`).join(' · '));
  }
  const wantAdded = plan.expect.addUnit ? 1 : 0;
  const added = after.units.filter((u) => !bUnit.has(u.orgId));
  const removed = before.units.filter((u) => !aUnit.has(u.orgId));
  if (added.length !== wantAdded) fail(`${head} — 늘어난 조직 행수가 기대와 다르다: 기대 ${wantAdded} · 실제 ${added.length}`, added.map(showUnit).join(' · '));
  if (removed.length) fail(`${head} — 조직 ${removed.length}행이 사라졌다(이 테스트의 조작은 조직을 지우지 않는다)`, removed.map(showUnit).join(' · '));
  if (after.users.length !== before.users.length) fail(`${head} — app_user 행수가 ${before.users.length} → ${after.users.length} 로 변했다`);

  // ── ④ 보류해 둔 ROW_COUNT 마커 유실 판정 ─────────────────────────────
  if (missing.length) {
    if (bad === 0) {
      for (const m of missing) rcMiss.push({ n: curOp, kind: plan.kind, tag: m.tag, sql: m.sql });
      vlog(`op#${curOp} [${plan.kind}] ${missing.map((x) => x.tag).join('·')} 의 ROW_COUNT 마커를 못 받았다 — ` +
        '스냅샷 대조는 전부 통과했으므로 조작은 실제로 일어났다(계측 사고로 집계)');
    } else {
      for (const m of missing) {
        fail(`${head} — ${m.tag} 의 ROW_COUNT 를 받지 못했다(위 스냅샷 위반과 같은 원인일 수 있다)`, m.sql);
      }
    }
  }
  return bad;
}

/* ── 조작 계획 수립 ───────────────────────────────────────────────────────────
 *  ★ '아무 일도 일어나지 않는 조작' 은 만들지 않는다(같은 상위로 이동, 같은 sort 로 변경 …).
 *    그래야 ROW_COUNT 0 을 무조건 '조작이 무효' 로 판정할 수 있다.
 *  ★ 조작은 전부 **1문장** 이다 — 절단 뒤에는 정본 한 곳만 고치면 되기 때문이다.
 *    (미러 판에서는 개명·이동·소속변경이 전부 2문장이었고 그 둘째 문장이 결함의 온상이었다.) */
function planOp(st, forceKind, depth) {
  const kind = forceKind || pickWeighted(OP_KINDS);
  const d = (depth || 0) + 1;
  if (d > 10) throw new Error('조작 계획 수립 실패(대체 종류를 10번 찾았다) — 조직 표가 너무 작습니다');
  const names = new Set(st.units.map((u) => u.name));
  const hasChild = (id) => st.units.some((u) => u.parentId === id);

  if (kind === 'rename-leaf' || kind === 'rename-branch' || kind === 'rename-root') {
    let cands;
    if (kind === 'rename-root') cands = st.units.filter((u) => u.parentId == null);
    else if (kind === 'rename-branch') cands = st.units.filter((u) => u.parentId != null && hasChild(u.orgId));
    else cands = st.units.filter((u) => !hasChild(u.orgId));
    if (!cands.length) return planOp(st, kind === 'rename-leaf' ? 'rename-branch' : 'rename-leaf', d);
    const t = pick(cands);
    const nn = newUnitName(names);
    const kids = st.units.filter((u) => u.parentId === t.orgId);
    const members = st.users.filter((u) => u.orgId === t.orgId);
    return {
      kind, tx: false,
      desc: `${kind === 'rename-root' ? '루트' : kind === 'rename-branch' ? '본부(비-리프)' : '리프'} 개명(1문장): ${t.name} → ${nn} (자식 ${kids.length}·소속자 ${members.length})`,
      stmts: [{ sql: `UPDATE org_unit SET name=${q(nn)} WHERE org_id=${n(t.orgId)}`, rows: 1, label: '개명 1문장' }],
      // ★ 자식도 소속자도 **아무것도 바뀌지 않아야** 한다 — 이름 사본이 없기 때문이다.
      //   verifyPlan ③ 이 '선언하지 않은 행이 바뀌면 위반' 으로 그것을 강제한다.
      expect: { units: [{ orgId: t.orgId, name: nn }], changedUnits: [t.orgId] },
    };
  }

  if (kind === 'move-team') {
    const movable = st.units.filter((u) => u.parentId != null);
    if (!movable.length) return planOp(st, 'add-team', d);
    const t = pick(movable);
    const banned = descendantIds(st.units, t.orgId);
    // ★ 현재 상위로의 '이동' 은 no-op — 후보에서 뺀다(효과를 검증할 수 없게 된다).
    // ★ 활성 조직을 비활성 상위 밑으로 옮기면 조직도가 끊긴다(I3) — 그런 이동은 하지 않는다.
    const targets = st.units.filter((u) => !banned.has(u.orgId) && u.orgId !== t.parentId && (!t.active || u.active));
    if (!targets.length) return planOp(st, 'sort-order', d);
    const p = pick(targets);
    return {
      kind, tx: false,
      desc: `조직 이동(1문장): ${t.name} 의 상위 → ${p.name}`,
      stmts: [{ sql: `UPDATE org_unit SET parent_id=${n(p.orgId)} WHERE org_id=${n(t.orgId)}`, rows: 1, label: 'parent_id' }],
      expect: { units: [{ orgId: t.orgId, parentId: p.orgId }], changedUnits: [t.orgId] },
    };
  }

  if (kind === 'add-team') {
    // ★ 상위는 활성 조직만 고른다 — 비활성 상위 밑에 활성 조직을 달면 조직도가 끊긴다(I3).
    const parents = st.units.filter((u) => u.active);
    if (!parents.length) return planOp(st, 'toggle-active', d);
    const p = pick(parents);
    const nn = newUnitName(names);
    const so = 10 + rint(90);
    return {
      kind, tx: false,
      desc: `신규 조직(1문장): ${nn} (상위 ${p.name}, sort ${so})`,
      stmts: [{ sql: `INSERT INTO org_unit (name, parent_id, sort_order, is_active) VALUES (${q(nn)}, ${n(p.orgId)}, ${n(so)}, 1)`, rows: 1, label: '신규 행' }],
      expect: { addUnit: { name: nn, parentId: p.orgId, sort: so, active: true }, changedUnits: [] },
    };
  }

  if (kind === 'toggle-active') {
    /* ★ 하위 트리째 숨김 / 조상까지 복원 — 운영에서 하는 정합한 조작만 돌린다.
     *   (정합하지 않은 '혼자 숨김' 을 I3 가 실제로 잡는지는 --selftest 가 따로 증명한다.)
     *   ★ 편향 보정: 활성 하한 아래로 내려가는 숨김 후보는 아예 만들지 않고,
     *     활성 비율이 낮을수록 복원 쪽으로 기운다.
     *   ★★ 재직자가 남아 있는 서브트리는 숨기지 않는다 — 그것은 정합한 조작이 아니다.
     *     숨기면 그 사람들이 조직도(is_active=1)에서 통째로 사라지고, 그 상태를 org-ops 도
     *     apply.ps1 도 거부한다(I3(b) 가 잡는 바로 그 상태다). 운영 절차는 '사람을 먼저 옮기고
     *     조직을 숨긴다' 이므로 루프도 그 순서만 돌린다. 검출기 자체는 --selftest C15 가 증명한다. */
    const total = st.units.length;
    const act = st.units.filter((u) => u.active).length;
    const floor = activeFloor(total);
    const hideCands = [];
    for (const u of st.units) {
      if (!u.active || u.parentId == null) continue;      // 활성 루트는 숨기지 않는다
      const sub = descendantIds(st.units, u.orgId);
      const will = st.units.filter((x) => sub.has(x.orgId) && x.active);
      const stuck = st.users.some((x) => x.active && x.orgId != null && sub.has(x.orgId));
      if (stuck) continue;                               // 재직자가 남은 서브트리는 숨기지 않는다
      if (act - will.length >= floor) hideCands.push({ u, will });
    }
    const restoreCands = st.units.filter((u) => !u.active);
    const headroom = (act - floor) / Math.max(1, total - floor);
    const wantRestore = restoreCands.length > 0 && (hideCands.length === 0 || rnd() > headroom);

    if (wantRestore) {
      const t = pick(restoreCands);
      const chain = ancestorChain(st.units, t.orgId);
      const will = chain.filter((u) => !u.active);
      return {
        kind, tx: false,
        desc: `조직 복원(1문장): ${t.name} 및 상위 ${will.length - 1}개 (숨김→활성, 조상까지)`,
        stmts: [{ sql: `UPDATE org_unit SET is_active=1 WHERE org_id IN (${chain.map((u) => u.orgId).join(',')}) AND is_active=0`, rows: will.length, label: '조상까지 복원' }],
        expect: { units: will.map((u) => ({ orgId: u.orgId, active: true })), changedUnits: will.map((u) => u.orgId) },
      };
    }
    if (!hideCands.length) return planOp(st, 'sort-order', d);
    const { u: t, will } = pick(hideCands);
    const sub = [...descendantIds(st.units, t.orgId)];
    return {
      kind, tx: false,
      desc: `조직 숨김(1문장): ${t.name} 및 하위 ${will.length - 1}개 (활성→숨김, 하위 트리째 · 활성 ${act}→${act - will.length}, 하한 ${floor})`,
      stmts: [{ sql: `UPDATE org_unit SET is_active=0 WHERE org_id IN (${sub.join(',')}) AND is_active=1`, rows: will.length, label: '하위 트리 숨김' }],
      expect: { units: will.map((u) => ({ orgId: u.orgId, active: false })), changedUnits: will.map((u) => u.orgId) },
    };
  }

  if (kind === 'move-user') {
    if (!st.users.length) return planOp(st, 'sort-order', d);
    const u = pick(st.users);
    const toNull = rnd() < 0.12 && u.orgId != null;       // 이미 NULL 이면 no-op 이라 뽑지 않는다
    let p = null;
    if (!toNull) {
      /* ★ 재직자는 **살아 있는 조직으로만** 보낸다 — 숨긴 조직으로 보내면 그 사람이 조직도에서
       *   사라진다(I3(b)). org-ops 의 assign 이 같은 이유로 그것을 거부하므로, 루프도 도구가
       *   허용하는 조작만 돌린다. 퇴직자(is_active=0)는 어디로 가든 조직도에 안 나오므로 제한 없다. */
      const opts = st.units.filter((x) => x.orgId !== u.orgId && (x.active || !u.active));
      if (!opts.length) return planOp(st, 'sort-order', d);
      p = pick(opts);
    }
    return {
      kind, tx: false,
      desc: `소속 변경(1문장): ${u.loginId} → ${toNull ? '(미등록/NULL)' : p.name}`,
      stmts: [{ sql: `UPDATE app_user SET org_id=${toNull ? 'NULL' : n(p.orgId)} WHERE user_id=${n(u.userId)}`, rows: 1, label: 'org_id' }],
      expect: { users: [{ userId: u.userId, orgId: toNull ? null : p.orgId }], changedUsers: [u.userId] },
    };
  }

  // sort-order
  const t = pick(st.units);
  let so = rint(120);
  if (so === t.sort) so = (so + 1) % 120;                 // ★ 같은 값으로의 '변경' 은 no-op
  return {
    kind: 'sort-order', tx: false,
    desc: `정렬 변경(1문장): ${t.name} sort ${t.sort} → ${so}`,
    stmts: [{ sql: `UPDATE org_unit SET sort_order=${n(so)} WHERE org_id=${n(t.orgId)}`, rows: 1, label: 'sort_order' }],
    expect: { units: [{ orgId: t.orgId, sort: so }], changedUnits: [t.orgId] },
  };
}

/** 조작 1회 — 계획 → 실행 → **효과 검증**. 반환 {rec, after, verified} */
function runOp(st, forceKind) {
  const plan = planOp(st, forceKind);
  kindAttempt[plan.kind] = (kindAttempt[plan.kind] || 0) + 1;
  const exec = execPlan(plan);
  const rec = { n: curOp, phase: curPhase, kind: plan.kind, desc: plan.desc, sql: exec.sql, outcome: exec.r.ok ? 'ok' : `error:${exec.r.errno || '?'}`, verified: false };
  opLog.push(rec);

  if (!exec.r.ok) {
    // ★ DB 가 사라졌거나 접속이 끊긴 것은 '환경' 이지 '스키마가 조작을 막았다' 가 아니다.
    if (isEnvErrno(exec.r.errno)) {
      envFail(`조작 실행 실패(${plan.kind}) errno=${exec.r.errno} — 복제 스키마가 사라졌거나 접속이 끊겼습니다`,
        cleanErr(exec.r.err));
    }
    const inv = /^rename-/.test(plan.kind) ? 'I7' : 'I8';
    violate(inv, `조작 실패(${plan.kind}) errno=${exec.r.errno} — ${plan.desc}`,
      cleanErr(exec.r.err) + '\n          SQL: ' + exec.sql.replace(/\s+/g, ' '));
    return { rec, after: snapshot(), verified: false };
  }

  const after = snapshot();
  const bad = verifyPlan(plan, exec, st, after);
  rec.verified = bad === 0;
  if (rec.verified) kindVerified[plan.kind] = (kindVerified[plan.kind] || 0) + 1;
  else rec.outcome = 'no-effect';
  vlog(`op#${curOp} [${plan.kind}] ${plan.desc} → ${rec.outcome}${rec.verified ? ' (효과 확인)' : ''}`);
  return { rec, after, verified: rec.verified };
}

/* ────────────────────────────── 11. I7 — 개명이 1문장 ────────────────────────────── */

/** 스키마 안의 **모든 텍스트 컬럼**에서 그 문자열을 찾는다.
 *  "자식·소속자 쪽에 고칠 것이 남지 않았다" 를 증명하는 도구다 —
 *  이름을 들고 있는 곳이 org_unit.name 한 곳뿐이라면, 옛 이름은 개명 뒤 **어디에도 없어야** 한다.
 *  ★ 대상 문자열은 우리가 방금 만든 합성명이라 자유 텍스트(과제명·메모)와 우연히 겹칠 수 없다. */
function scanNameEverywhere(name) {
  const cols = mustQuery(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE IN ('char','varchar','tinytext','text','mediumtext','longtext')
      ORDER BY TABLE_NAME, COLUMN_NAME`, '텍스트 컬럼 목록');
  if (!cols.length) return [];
  const parts = cols.map(([t, c]) => `SELECT ${q(t + '.' + c)}, COUNT(*) FROM \`${t}\` WHERE \`${c}\` = ${q(name)}`);
  const res = mustQuery('SET NAMES utf8mb4;\n' + parts.join('\nUNION ALL\n'), '조직명 잔존 검색');
  return res.filter((r) => Number(r[1]) > 0).map((r) => `${r[0]}=${r[1]}행`);
}

/** I7 — 개명이 **1문장으로** 성공하고, 따라올 것이 남지 않는다.
 *  target: 'branch' | 'leaf' | 'root'.  deep=true 면 스키마 전 텍스트 컬럼 잔존 검색까지 한다. */
function renameProbe(st, label, { target = 'branch', deep = false } = {}) {
  const hasChild = (id) => st.units.some((c) => c.parentId === id);
  let cands;
  if (target === 'root') cands = st.units.filter((u) => u.parentId == null);
  else if (target === 'leaf') cands = st.units.filter((u) => !hasChild(u.orgId));
  else cands = st.units.filter((u) => u.parentId != null && hasChild(u.orgId));
  if (!cands.length) cands = st.units.filter((u) => hasChild(u.orgId));
  if (!cands.length) { violate('I7', `${label}: 개명 대상(${target})을 찾을 수 없다 — 조직 표가 비었다`); return st; }
  // 소속자가 있는 조직을 우선 고른다(따라올 것이 없다는 주장을 가장 세게 시험한다)
  const withMembers = cands.filter((u) => st.users.some((x) => x.orgId === u.orgId));
  const t = withMembers.length ? pick(withMembers) : pick(cands);
  const kidIds = st.units.filter((u) => u.parentId === t.orgId).map((u) => u.orgId);
  const memberIds = st.users.filter((u) => u.orgId === t.orgId).map((u) => u.userId);
  const names = new Set(st.units.map((u) => u.name));
  const s1 = newUnitName(names); names.add(s1);
  const oldName = t.name;

  const sql1 = `UPDATE org_unit SET name=${q(s1)} WHERE org_id=${n(t.orgId)}`;
  const r = mysqlRun(`SET NAMES utf8mb4;\n${sql1};`, { db: CLONE, what: `I7 개명(${label}/${target})` });
  opLog.push({ n: curOp, phase: curPhase, kind: `I7-${target}-rename`, desc: `${label}: ${oldName} → ${s1}`, sql: sql1, outcome: r.ok ? 'ok' : `error:${r.errno || '?'}` });
  if (!r.ok) {
    if (isEnvErrno(r.errno)) envFail(`I7 개명 중 환경 오류 errno=${r.errno}`, cleanErr(r.err));
    violate('I7', `${label}(${target}): 개명 1문장이 실패했다 errno=${r.errno} (${oldName} → ${s1}) — 절단이 없애려던 바로 그 증상`,
      cleanErr(r.err) + '\n          SQL: ' + sql1);
    return snapshot();
  }

  // ★ 에러가 안 났다 ≠ 성공. 결과를 별도 스냅샷으로 확인한다.
  const after = snapshot();
  const row = after.units.find((u) => u.orgId === t.orgId);
  if (!row || row.name !== s1) {
    violate('I7', `${label}: 개명 뒤에도 org_id ${t.orgId} 의 이름이 ${row ? row.name : '(사라짐)'} — ${s1} 이어야 한다`);
    return after;
  }
  // ★ 따라올 것이 없다 = **그 한 행 말고는 아무것도 바뀌지 않았다**
  const bUnit = new Map(st.units.map((u) => [u.orgId, u]));
  const aUnit = new Map(after.units.map((u) => [u.orgId, u]));
  const movedUnits = after.units.filter((u) => bUnit.has(u.orgId) && u.orgId !== t.orgId && !sameUnit(bUnit.get(u.orgId), u));
  const selfOther = (() => {
    const b = bUnit.get(t.orgId), a = aUnit.get(t.orgId);
    return b && a && (b.parentId !== a.parentId || b.sort !== a.sort || b.active !== a.active);
  })();
  const bUser = new Map(st.users.map((u) => [u.userId, u]));
  const movedUsers = after.users.filter((u) => bUser.has(u.userId) && !sameUser(bUser.get(u.userId), u));
  if (movedUnits.length || movedUsers.length || selfOther) {
    violate('I7', `${label}: 개명 한 문장이 다른 행까지 건드렸다 — 조직 ${movedUnits.length}행 · 사용자 ${movedUsers.length}행` +
      (selfOther ? ' · 대상 행의 이름 외 컬럼' : ''),
      movedUnits.slice(0, 6).map((u) => `${showUnit(bUnit.get(u.orgId))} → ${showUnit(u)}`).concat(
        movedUsers.slice(0, 6).map((u) => `${showUser(bUser.get(u.userId))} → ${showUser(u)}`)).join(' · '));
  }
  // 자식·소속자가 '그대로 붙어 있는지' 도 명시적으로 확인(관계는 id 로 유지된다)
  const lostKids = after.units.filter((u) => kidIds.includes(u.orgId) && u.parentId !== t.orgId);
  if (lostKids.length) violate('I7', `${label}: 개명 뒤 자식 ${lostKids.length}/${kidIds.length}개가 떨어져 나갔다`, lostKids.map(showUnit).join(' · '));
  const lostMem = after.users.filter((u) => memberIds.includes(u.userId) && u.orgId !== t.orgId);
  if (lostMem.length) violate('I7', `${label}: 개명 뒤 소속자 ${lostMem.length}/${memberIds.length}명이 떨어져 나갔다`, lostMem.map(showUser).join(' · '));

  if (!deep) {
    if (!movedUnits.length && !movedUsers.length && !lostKids.length && !lostMem.length) {
      vlog(`I7 ${label}(${target}): 1문장 개명 성공 — 자식 ${kidIds.length}·소속자 ${memberIds.length}명 그대로`);
    }
    return after;
  }

  // ── deep: 한 번 더 개명하고, **옛 이름이 스키마 어디에도 남지 않았는지** 전수 검색한다.
  const s2 = newUnitName(names);
  const sql2 = `UPDATE org_unit SET name=${q(s2)} WHERE org_id=${n(t.orgId)}`;
  const r2 = mysqlRun(`SET NAMES utf8mb4;\n${sql2};`, { db: CLONE, what: `I7 재개명(${label})` });
  opLog.push({ n: curOp, phase: curPhase, kind: `I7-${target}-rename2`, desc: `${label}: ${s1} → ${s2}`, sql: sql2, outcome: r2.ok ? 'ok' : `error:${r2.errno || '?'}` });
  if (!r2.ok) {
    if (isEnvErrno(r2.errno)) envFail(`I7 재개명 중 환경 오류 errno=${r2.errno}`, cleanErr(r2.err));
    violate('I7', `${label}: 두 번째 개명이 실패했다 errno=${r2.errno}`, cleanErr(r2.err));
    return snapshot();
  }
  const leftovers = scanNameEverywhere(s1);
  if (leftovers.length) {
    violate('I7', `${label}: 개명 뒤에도 옛 이름 '${s1}' 이 ${leftovers.length}곳에 남아 있다 — 이름 사본이 있다는 뜻이고, ` +
      '그러면 개명은 1문장으로 끝날 수 없다', leftovers.join(' · '));
  }
  const now = scanNameEverywhere(s2);
  if (now.length !== 1 || now[0] !== 'org_unit.name=1행') {
    violate('I7', `${label}: 새 이름 '${s2}' 이 org_unit.name 한 곳(1행)이 아니라 ${now.length}곳에 있다 — 이름이 여러 곳에 산다`,
      now.join(' · ') || '(어디에도 없다)');
  }
  const fin = snapshot();
  if (!capture) {
    ok(`I7 ${label}(${target}): 개명 1문장 성공 — ${oldName} → ${s1} → ${s2} · 자식 ${kidIds.length}·소속자 ${memberIds.length}명 그대로 · ` +
      `스키마 전 텍스트 컬럼 잔존 0건(새 이름은 org_unit.name 1행뿐)`);
  }
  return fin;
}

/* ────────────────────────────── 12. --selftest (검출기 검증) ────────────────────────────── */
/* "잡아내지 못하면 그 불변식은 가짜다" — 일부러 깨뜨려 각 불변식이 실제로 우는지 본다.
 *  각 케이스는 (준비 → 파괴 → 검사 → 기대 코드 확인 → 복구 → 재검사 clean → 정리) 순으로 돈다.
 *  파괴가 낸 위반은 capture 버킷으로 새어 나가 최종 집계에 들어가지 않는다.
 *  ★ DB 를 깨뜨려서는 만들 수 없는 결함(계약 SQL 이 틀림 · 앱 포팅이 틀림 · 조작이 no-op)은
 *    MUT 변이 훅으로 코드 쪽에서 만든다 — 그게 아니면 그 검출기들은 영원히 검증되지 않는다. */
function selftestCases(st) {
  const cases = [];
  const hasChild = (id) => st.units.some((c) => c.parentId === id);
  const child = st.units.find((u) => u.parentId != null);
  const deepChild = st.units.find((u) => u.parentId != null && hasChild(u.orgId) && st.units.some((c) => c.parentId === u.orgId));
  const leaf = st.units.find((u) => !hasChild(u.orgId));
  const root = st.units.find((u) => u.parentId == null);
  const cutBranch = st.units.find((u) => u.active && u.parentId != null && st.units.some((c) => c.parentId === u.orgId && c.active));
  const userWithOrg = st.users.find((u) => u.orgId != null && u.active);

  if (child) cases.push({
    code: 'C1', must: ['I1'], mustText: /순환/,
    desc: '순환 — 부모의 부모를 자기 자식으로 돌린다(FK 는 통과한다)',
    sql: `UPDATE org_unit SET parent_id=${n(child.orgId)} WHERE org_id=${n(child.parentId)};`,
    undo: (() => {
      const par = st.units.find((u) => u.orgId === child.parentId);
      return `UPDATE org_unit SET parent_id=${n(par ? par.parentId : null)} WHERE org_id=${n(child.parentId)};`;
    })(),
  });

  if (child) cases.push({
    code: 'C2', must: ['I1'], mustText: /루트/,
    desc: '루트 2개 — 조직도가 두 갈래로 갈라진다',
    sql: `UPDATE org_unit SET parent_id=NULL WHERE org_id=${n(child.orgId)};`,
    undo: `UPDATE org_unit SET parent_id=${n(child.parentId)} WHERE org_id=${n(child.orgId)};`,
  });

  if (deepChild) cases.push({
    code: 'C3', must: ['I1'], mustText: /도달불가/,
    desc: '도달불가 섬 — 깊은 곳에 2노드 고리를 만들어 하위 트리를 루트에서 떼어낸다',
    sql: (() => {
      const kid = st.units.find((c) => c.parentId === deepChild.orgId);
      return `UPDATE org_unit SET parent_id=${n(kid.orgId)} WHERE org_id=${n(deepChild.orgId)};`;
    })(),
    undo: `UPDATE org_unit SET parent_id=${n(deepChild.parentId)} WHERE org_id=${n(deepChild.orgId)};`,
  });

  if (cutBranch) cases.push({
    code: 'C4', must: ['I3'],
    desc: '비활성 절단 — 활성 자식을 둔 비-리프를 혼자 숨긴다(조직도가 끊긴다)',
    sql: `UPDATE org_unit SET is_active=0 WHERE org_id=${n(cutBranch.orgId)};`,
    undo: `UPDATE org_unit SET is_active=1 WHERE org_id=${n(cutBranch.orgId)};`,
  });

  if (leaf) cases.push({
    code: 'C5', must: ['I2'],
    desc: '고아 — FOREIGN_KEY_CHECKS 를 끄고 없는 org_id 를 가리키게 한다(FK 우회)',
    sql: `SET FOREIGN_KEY_CHECKS=0;\nUPDATE org_unit SET parent_id=30000 WHERE org_id=${n(leaf.orgId)};\nSET FOREIGN_KEY_CHECKS=1;`,
    undo: `SET FOREIGN_KEY_CHECKS=0;\nUPDATE org_unit SET parent_id=${n(leaf.parentId)} WHERE org_id=${n(leaf.orgId)};\nSET FOREIGN_KEY_CHECKS=1;`,
  });

  if (leaf) cases.push({
    code: 'C6', must: ['I4'], mustText: /앞뒤 공백/,
    desc: '이름 표기 — 뒤에 공백을 붙인다(NO PAD 콜레이션이라 DB 는 아무 말도 하지 않는다)',
    sql: `UPDATE org_unit SET name=CONCAT(name,' ') WHERE org_id=${n(leaf.orgId)};`,
    undo: `UPDATE org_unit SET name=TRIM(name) WHERE org_id=${n(leaf.orgId)};`,
  });

  if (leaf) cases.push({
    code: 'C7', must: ['I4'], mustText: /전각/,
    desc: '이름 표기 — 전각 문자를 섞는다(사람 눈에는 같아 보이지만 앱의 === 에는 다른 이름이다)',
    sql: `UPDATE org_unit SET name=CONCAT(name,${q('Ａ')}) WHERE org_id=${n(leaf.orgId)};`,
    undo: `UPDATE org_unit SET name=${q(leaf.name)} WHERE org_id=${n(leaf.orgId)};`,
  });

  if (root) cases.push({
    code: 'C8', must: ['I0', 'I4'], mustText: /BINARY/,
    desc: '★대소문자만 다른 두 조직 — uq_org_unit_name 을 떼면 DB(ai_ci)는 통과시키지만 호스트 Ordinal/앱 === 는 다른 이름으로 읽는다',
    setup: `INSERT INTO org_unit (name, parent_id, sort_order, is_active) VALUES (${q('Zz가온그룹_st')}, ${n(root.orgId)}, 95, 1);`,
    sql: `ALTER TABLE org_unit DROP KEY uq_org_unit_name;\n` +
      `INSERT INTO org_unit (name, parent_id, sort_order, is_active) VALUES (${q('zZ가온그룹_ST')}, ${n(root.orgId)}, 96, 1);`,
    undo: `DELETE FROM org_unit WHERE name=${q('zZ가온그룹_ST')} AND sort_order=96;\nALTER TABLE org_unit ADD UNIQUE KEY uq_org_unit_name (name);`,
    teardown: `DELETE FROM org_unit WHERE name=${q('Zz가온그룹_st')};`,
  });

  cases.push({
    code: 'C9', must: ['I5'],
    desc: '★payload JOIN 오류 — units 를 INNER JOIN 으로 쓴다(루트가 통째로 사라진다)',
    mutate: () => {
      const prev = MUT.payloadUnits;
      MUT.payloadUnits = 'SELECT c.name, p.name, c.sort_order FROM org_unit c JOIN org_unit p ON p.org_id = c.parent_id ' +
        'WHERE c.is_active=1 ORDER BY c.sort_order, c.name';
      return () => { MUT.payloadUnits = prev; };
    },
  });

  cases.push({
    code: 'C10', must: ['I5'],
    desc: '★payload 정렬 오류 — members 의 ORDER BY 를 뺀다(같은 조직 행이 흩어진다)',
    setup: userWithOrg ? `UPDATE app_user SET org_id=NULL WHERE user_id=${n(userWithOrg.userId)};` : undefined,
    teardown: userWithOrg ? `UPDATE app_user SET org_id=${n(userWithOrg.orgId)} WHERE user_id=${n(userWithOrg.userId)};` : undefined,
    mutate: () => {
      const prev = MUT.payloadMembers;
      MUT.payloadMembers = 'SELECT u.login_id, u.name, u.title, o.name FROM app_user u ' +
        'LEFT JOIN org_unit o ON o.org_id = u.org_id WHERE u.is_active=1';
      return () => { MUT.payloadMembers = prev; };
    },
  });

  cases.push({
    code: 'C11', must: ['I6'],
    desc: '★앱 포팅 오류 — mbSubtree 가 자식 하나를 빠뜨린다(호스트와 화면이 다른 범위를 계산한다)',
    mutate: () => { MUT.mbSubtreeBug = true; return () => { MUT.mbSubtreeBug = false; }; },
  });

  cases.push({
    code: 'C12', must: ['I8'], probe: 'op',
    desc: '★조작 no-op — 조작 SQL 을 통째로 DO 0 으로 바꾼다(옛 판이 exit 0 을 내던 구멍)',
    mutate: () => { MUT.noopOps = true; return () => { MUT.noopOps = false; }; },
  });

  cases.push({
    code: 'C13', must: ['I0'], mustText: /구 이름 컬럼/,
    desc: '★옛 스키마 회귀 — 구 컬럼(org_unit.parent · app_user.org_unit)을 되살린다',
    sql: `ALTER TABLE org_unit ADD COLUMN parent VARCHAR(50) NULL;\nALTER TABLE app_user ADD COLUMN org_unit VARCHAR(50) NULL;`,
    undo: `ALTER TABLE org_unit DROP COLUMN parent;\nALTER TABLE app_user DROP COLUMN org_unit;`,
  });

  cases.push({
    code: 'C14', must: ['I0', 'I7'], probe: 'rename',
    desc: '★옛 FK 회귀 — parent(이름) 자기참조 FK 를 다시 건다 → 개명 1문장이 1451 로 죽어야 한다',
    sql: `ALTER TABLE org_unit ADD COLUMN parent VARCHAR(50) NULL;\n` +
      `UPDATE org_unit c JOIN org_unit p ON c.parent_id=p.org_id SET c.parent=p.name, c.updated_at=c.updated_at;\n` +
      `ALTER TABLE org_unit ADD CONSTRAINT fk_org_parent FOREIGN KEY (parent) REFERENCES org_unit(name) ON UPDATE CASCADE ON DELETE RESTRICT;`,
    undo: `ALTER TABLE org_unit DROP FOREIGN KEY fk_org_parent;\nALTER TABLE org_unit DROP COLUMN parent;`,
  });

  // ★ C4 는 자식을 남긴 채 부모만 숨긴다(inactive_cut 이 운다). C15 는 그 사각지대 —
  //   **리프** 조직을 숨기므로 자식이 없어 inactive_cut 은 0 그대로인데, 그 안의 재직자가
  //   조직도(is_active=1) 밖으로 통째로 밀려난다. 옛 판에서는 이 상태를 아무도 못 봤고,
  //   repair -DeactivateOrphanedChildren 이 바로 그것을 만들며 exit 0 을 냈다.
  const memberLeaf = st.units.find((u) => u.active && !hasChild(u.orgId)
    && st.users.some((x) => x.active && x.orgId === u.orgId));
  if (memberLeaf) cases.push({
    code: 'C15', must: ['I3'], mustText: /재직자/,
    desc: '★숨긴 조직에 사람만 갇힌다 — 리프를 숨겨 inactive_cut 은 0 인 채 재직자를 조직도 밖으로 밀어낸다',
    sql: `UPDATE org_unit SET is_active=0 WHERE org_id=${n(memberLeaf.orgId)};`,
    undo: `UPDATE org_unit SET is_active=1 WHERE org_id=${n(memberLeaf.orgId)};`,
  });

  // 전각 공백(U+3000)은 MySQL TRIM 이 떼지 못한다 — SQL 게이트가 오래 놓치던 구멍이라,
  // 이 파일의 표기 검출기도 같은 문자를 실제로 잡는지 매 실행 확인한다.
  // ※ 소스에 보이지 않는 문자를 박지 않으려고 16진 바이트로 만든다.
  if (leaf) cases.push({
    code: 'C16', must: ['I4'], mustText: /전각/,
    desc: '★전각 공백(U+3000) — 한글 IME 로 가장 쉽게 들어오는데 MySQL TRIM 은 이걸 떼지 못한다',
    sql: `UPDATE org_unit SET name=CONCAT(name, CONVERT(0xE38080 USING utf8mb4), 'x') WHERE org_id=${n(leaf.orgId)};`,
    undo: `UPDATE org_unit SET name=${q(leaf.name)} WHERE org_id=${n(leaf.orgId)};`,
  });

  return cases;
}

function runSelftest() {
  console.log('');
  log('--selftest: 일부러 깨뜨려 불변식 검출기 자체를 검증한다(파괴는 전부 복제본 안에서, 케이스마다 복구)');
  const results = [];
  for (const c of selftestCases(snapshot())) {
    curPhase = 'selftest/' + c.code;
    if (c.setup) {
      const s = mysqlRun('SET NAMES utf8mb4;\n' + c.setup, { db: CLONE, what: `selftest ${c.code} 준비` });
      if (!s.ok) {
        // ★ 여기서 그냥 continue 하면 '9/10' 을 찍고도 '위반 없음 ✓' 로 끝난다(실측 사고).
        results.push({ ...c, verdict: 'SETUP-FAIL', got: [], missing: c.must, after: [], note: '준비 SQL 실패: ' + cleanErr(s.err) });
        console.log(el(), `  ✗ [${c.code}] ${c.desc}`);
        console.log(`        SETUP-FAIL — 준비 SQL 실패: ${cleanErr(s.err)}`);
        violate('SELFTEST', `[${c.code}] SETUP-FAIL(준비 SQL) — ${c.desc}`, cleanErr(s.err));
        continue;
      }
    }

    if (c.sql) {
      const r = mysqlRun('SET NAMES utf8mb4;\n' + c.sql, { db: CLONE, what: `selftest ${c.code} 파괴` });
      if (!r.ok) {
        if (c.teardown) mysqlRun('SET NAMES utf8mb4;\n' + c.teardown, { db: CLONE, what: `selftest ${c.code} 정리` });
        // ★ 파괴 SQL 이 못 돌면 그 검출기는 **검증되지 않은 것**이다 — 통과로 세지 않는다.
        results.push({ ...c, verdict: 'SETUP-FAIL', got: [], missing: c.must, after: [], note: cleanErr(r.err) });
        console.log(el(), `  ✗ [${c.code}] ${c.desc}`);
        console.log(`        SETUP-FAIL — 파괴 SQL 실패: ${cleanErr(r.err)}`);
        violate('SELFTEST', `[${c.code}] SETUP-FAIL(파괴 SQL) — ${c.desc}`, cleanErr(r.err));
        continue;
      }
    }

    const restore = c.mutate ? c.mutate() : null;
    const got = withCapture(() => {
      const st = snapshot();
      checkAll(st, { schema: true });
      if (c.probe === 'rename') renameProbe(st, 'selftest ' + c.code, { target: 'branch', deep: false });
      if (c.probe === 'op') { const save = curOp; curOp = 0; try { runOp(st); } finally { curOp = save; } }
    });
    if (restore) restore();

    const codes = [...new Set(got.map((v) => v.inv))];
    const missing = c.must.filter((m) => !codes.includes(m));
    // ★ 코드만 맞추면 '아무 이유로나 울기만 하면 통과' 가 된다 — 어느 검출 갈래가 울었는지까지 본다.
    const textOk = !c.mustText || got.some((v) => c.mustText.test(String(v.desc) + ' ' + String(v.detail || '')));

    let restored = true, after = [], undoErr = '';
    if (c.undo) {
      const u = mysqlRun('SET NAMES utf8mb4;\n' + c.undo, { db: CLONE, what: `selftest ${c.code} 복구` });
      restored = u.ok;
      if (restored) after = withCapture(() => checkAll(snapshot(), { schema: true }));
      else undoErr = cleanErr(u.err);
    } else {
      // 파괴가 코드 변이(MUT)뿐인 케이스 — 되돌릴 SQL 이 없다. 복구는 restore() 가 이미 했다.
      after = withCapture(() => checkAll(snapshot(), { schema: true }));
    }
    if (c.teardown) {
      const td = mysqlRun('SET NAMES utf8mb4;\n' + c.teardown, { db: CLONE, what: `selftest ${c.code} 정리` });
      if (!td.ok) violate('SELFTEST', `[${c.code}] 정리(teardown) 실패`, cleanErr(td.err));
      else after = withCapture(() => checkAll(snapshot(), { schema: true }));
    }

    const verdict = missing.length ? 'MISSED'
      : !textOk ? 'WRONG-DETECTOR'
        : !restored ? 'NO-RESTORE'
          : after.length ? 'DIRTY-AFTER-RESTORE' : 'CAUGHT';
    const afterInv = after.map((v) => v.inv);
    const afterDetail = after.map((v) => `[${v.inv}] ${v.desc}`).join(' / ');
    results.push({ ...c, verdict, got: codes, missing, after: afterInv, note: undoErr });

    const mark = verdict === 'CAUGHT' ? '✓' : '✗';
    console.log(el(), `  ${mark} [${c.code}] ${c.desc}`);
    console.log(`        기대 ${c.must.join(',')}${c.mustText ? ' /' + c.mustText.source + '/' : ''} · 검출 ${codes.length ? codes.join(',') : '(없음)'}` +
      `${missing.length ? ' · ★놓침 ' + missing.join(',') : ''}${verdict === 'CAUGHT' ? ' · 복구 후 clean' : ' · ' + verdict}`);
    if (verdict !== 'CAUGHT') {
      violate('SELFTEST', `[${c.code}] ${verdict} — ${c.desc}`,
        (missing.length ? '놓친 불변식: ' + missing.join(',') : '') +
        (!textOk ? ` 기대한 검출 갈래(/${c.mustText.source}/)가 아니라 다른 이유로 울었다: ${got.map((v) => v.desc).slice(0, 3).join(' / ')}` : '') +
        (afterInv.length ? ` 복구 후 잔여 위반: ${afterInv.join(',')} — ${afterDetail}` : '') +
        (restored ? '' : ' 복구 SQL 실패'));
    }
  }
  const caught = results.filter((r) => r.verdict === 'CAUGHT').length;
  log(`--selftest 결과: ${caught}/${results.length} 케이스가 기대한 불변식에 정확히 걸렸다`);
  /* ★ 집계 경로의 마지막 안전장치 — CAUGHT 가 아닌 케이스가 하나라도 있으면 **반드시** 위반이
   *   기록돼 exit 1 이 되게 한다(실측 사고: SETUP-FAIL 이 continue 로 빠져 '9/10' 인데 exit 0). */
  const notCaught = results.filter((r) => r.verdict !== 'CAUGHT');
  if (notCaught.length && !violations.some((v) => v.inv === 'SELFTEST')) {
    violate('SELFTEST', `검출기 검증 미완료 — ${notCaught.length}/${results.length} 케이스가 CAUGHT 가 아니다`,
      notCaught.map((r) => `${r.code}:${r.verdict}`).join(' · '));
  }
  if (!results.length) violate('SELFTEST', '--selftest 가 케이스를 하나도 만들지 못했다 — 검출기가 검증되지 않았다');
  selftestResults = results;
  return results;
}

/* ────────────────────────────── 13. 요약 ────────────────────────────── */

let stats = { compared: 0, checks: 0, migSource: '', fallout: '', preRenameErrno: null, minActive: Infinity, numbering: '' };
let selftestResults = null;

/** 대표 사용자 3명 — 단건 payload 의 @id. view_scope 를 골고루 덮고, 결정론적으로 고른다.
 *  ★ login_id 는 루프가 절대 바꾸지 않으므로 한 번 고르면 끝까지 유효하다. */
function probeUsersOf(st) {
  const out = [];
  for (const sc of ['all', 'unit_tree', 'self']) {
    const c = st.users.filter((u) => u.scope === sc);
    if (c.length) out.push(c[rint(c.length)].loginId);
  }
  if (!out.length && st.users.length) out.push(st.users[0].loginId);
  return out;
}

function printSummary(finalSt, envFailNote) {
  const line = '─'.repeat(74);
  console.log('\n' + line);
  console.log('org_unit 완전 절단 루프 테스트 요약');
  console.log(line);
  if (envFailNote) console.log(`★ 환경 실패로 중단(종료코드 2 — 불변식 판정 아님): ${envFailNote}`);
  if (OPT.selftest) {
    console.log(`모드=--selftest(검출기 검증) · 시드=${OPT.seed} · 소요 ${((Date.now() - T0) / 1000).toFixed(1)}s`);
    if (selftestResults) {
      const nc = selftestResults.filter((r) => r.verdict !== 'CAUGHT');
      console.log(`검출기 케이스: ${selftestResults.length - nc.length}/${selftestResults.length} CAUGHT` + (nc.length ? '' : ' ✓'));
      for (const r of nc) console.log(`  ✗ [${r.code}] ${r.verdict} — ${r.desc}${r.note ? ' · ' + r.note : ''}`);
    } else {
      console.log('검출기 케이스: (실행되지 않았다)');
    }
  } else {
    console.log(`시드=${OPT.seed} · 요청 조작수=${OPT.ops} · 실제 기록된 조작=${opLog.length} · 소요 ${((Date.now() - T0) / 1000).toFixed(1)}s`);
  }
  console.log(`복제본=${OPT.selfcheck ? '(없음 — 읽기 전용 점검)' : OPT.clone}  원본=${OPT.dbName}(SELECT 만)`);
  console.log(`시험대 DDL: ${stats.migSource}`);
  if (stats.numbering) console.log(`org_id 배정: ${stats.numbering}`);
  if (stats.preRenameErrno !== null) {
    console.log(`절단 전 대조: 옛 스키마 복제본에서 본부 개명 → errno=${stats.preRenameErrno}` +
      (stats.preRenameErrno === 1451 ? ' (기대대로 1451 로 막힘 — 절단이 없애려던 증상)' : ' (★1451 이 아니다)'));
  }
  if (stats.fallout) console.log(`배포본 6문 낙진: ${stats.fallout}  (기대: S1 생존 · S2~S6 errno 1054)`);
  if (!OPT.selftest) {
    /* ★ 여기 찍히는 숫자는 '효과가 실제로 확인된 조작' 의 수다.
     *   옛 요약은 '의도한 조작 종류' 를 세어 놓고 결과인 척했다 — 조작을 전부 no-op 으로
     *   바꿔도 같은 줄이 나왔다. 이제 시도/확인이 다르면 그 자체가 눈에 보인다. */
    const kinds = [...new Set(Object.keys(kindAttempt).concat(Object.keys(kindVerified)))].sort();
    const byKind = kinds.map((k) => `${k}=${kindVerified[k] || 0}/${kindAttempt[k] || 0}`).join(' · ');
    const va = kinds.reduce((a, k) => a + (kindVerified[k] || 0), 0);
    const ta = kinds.reduce((a, k) => a + (kindAttempt[k] || 0), 0);
    console.log(`조작 종류 분포(효과 확인/시도): ${byKind || '(없음)'}`);
    console.log(`효과가 확인된 조작: ${va}/${ta}건` + (va === ta ? ' ✓' : '  ★ 확인되지 않은 조작이 있다 — 위 I8 위반을 보라'));
  }
  if (truncSeen) {
    console.log(`mysql 출력 잘림(종료코드 0·stderr 없음): ${truncSeen}회 감지 · 재시도 회복 ${truncRecovered}회 · 미회복 ${truncUnrecovered}회`);
    console.log('  → 감지 못 하고 지나간 것은 없다(모든 호출에 종결 마커 계약이 걸려 있다). ' +
      (truncUnrecovered ? '미회복 건은 계측 유실로 명시 기록했거나 exit 2 로 끊었다.' : '전부 재시도로 회복했다 ✓'));
  }
  const bad = opLog.filter((o) => o.outcome !== 'ok' && !String(o.phase || '').startsWith('selftest'));
  const intended = opLog.filter((o) => o.outcome !== 'ok' && String(o.phase || '').startsWith('selftest'));
  if (rcMiss.length) {
    const head5 = rcMiss.slice(0, 5).map((m) => `op#${m.n}[${m.kind}]${m.tag}`).join(' · ');
    console.log(`ROW_COUNT 마커 유실(계측 사고 · 위반 아님): ${rcMiss.length}건 — ${head5}${rcMiss.length > 5 ? ` 외 ${rcMiss.length - 5}건` : ''}`);
    console.log('  → 해당 조작들은 스냅샷 대조로 효과가 확인됐다. 이 수치가 계속 늘면 mysql 호출 경로를 볼 것.');
  }
  console.log(`실패하거나 효과가 확인되지 않은 조작: ${bad.length}건` + (bad.length ? '' : ' ✓') +
    (intended.length ? ` (그 외 --selftest 가 의도적으로 실패시킨 것 ${intended.length}건)` : ''));
  for (const o of bad.slice(0, 15)) console.log(`  · op#${o.n} [${o.kind}] ${o.desc} → ${o.outcome}`);
  console.log(`payload ↔ id경로 정답 대조: ${stats.compared}회 (검사 ${stats.checks}회분)`);

  if (finalSt) {
    const act = finalSt.units.filter((u) => u.active).length;
    const floor = activeFloor(finalSt.units.length);
    console.log('\n최종 조직 상태:');
    console.log(`  org_unit ${finalSt.units.length}행(활성 ${act} · 하한 ${floor}` +
      (stats.minActive !== Infinity ? ` · 루프 중 최소 활성 ${stats.minActive}` : '') + ')' +
      (act >= floor ? '  ✓ 편향 보정 유지' : '  ★ 활성 조직이 하한 아래로 떨어졌다 — 후반 검출력이 사라진다'));
    const roots = finalSt.units.filter((u) => u.parentId == null);
    console.log(`  루트 ${roots.length}개${roots.length ? ' (' + roots.map((r) => r.name).join(', ') + ')' : ''}`);
    console.log(`  app_user ${finalSt.users.length}행 · 소속 미등록 ${finalSt.users.filter((u) => u.orgId == null).length}명`);
    // DFS — 자식은 앱과 같은 규칙(sort_order → name)으로 훑는다.
    const kidsOf = new Map();
    const ROOTKEY = -1;
    for (const u of finalSt.units) {
      const k = u.parentId == null ? ROOTKEY : u.parentId;
      if (!kidsOf.has(k)) kidsOf.set(k, []);
      kidsOf.get(k).push(u);
    }
    for (const v of kidsOf.values()) v.sort((a, b) => a.sort - b.sort || (a.name < b.name ? -1 : 1));
    const lines = [];
    const seen = new Set();          // 순환(I1 위반)이 있어도 출력이 무한루프에 빠지지 않게
    const walk = (key, d) => {
      for (const u of kidsOf.get(key) || []) {
        if (lines.length >= 30 || seen.has(u.orgId)) continue;
        seen.add(u.orgId);
        lines.push('  ' + '  '.repeat(d) + `${u.name}(#${u.orgId}, ${u.sort}${u.active ? '' : ',숨김'})`);
        walk(u.orgId, d + 1);
      }
    };
    walk(ROOTKEY, 0);
    console.log(lines.join('\n'));
    if (finalSt.units.length > lines.length) console.log(`  … 외 ${finalSt.units.length - lines.length}행(순환·고아이거나 30행 초과)`);
    console.log(`\n신버전 앱이 받는 payload: units ${finalSt.hostUnits.length}개 · members ${finalSt.hostMembers.length}명`);
  }

  console.log('\n' + line);
  if (envFailNote) {
    /* ★ 검사를 끝까지 수행하지 못했다 — '위반 없음 ✓' 는 거짓이다. 종료코드 2 는 **판정 없음**이다. */
    console.log('판정 없음 — 검사를 끝까지 수행하지 못했다(종료코드 2 · 환경 실패).');
    if (violations.length) {
      console.log(`  (중단 전까지 기록된 위반: ${violations.length}건)`);
      for (const v of violations.slice(0, 10)) console.log(`  ✗ [${v.inv}] op#${v.op} (${v.phase}) ${v.desc}`);
    } else {
      console.log('  중단 전까지 기록된 위반은 없지만, 그것은 "위반이 없다"는 뜻이 아니다 — 검사가 끝나지 않았다.');
    }
  } else if (violations.length === 0) {
    console.log('위반된 불변식: 없음  ✓');
  } else {
    console.log(`위반된 불변식: ${violations.length}건`);
    for (const v of violations) console.log(`  ✗ [${v.inv}] op#${v.op} (${v.phase}) ${v.desc}`);
    const first = violations[0];
    const opRec = opLog.find((o) => o.n === first.op);
    if (opRec) {
      console.log('\n최초 위반 시점의 조작:');
      console.log(`  op#${opRec.n} [${opRec.kind}] ${opRec.desc}`);
      console.log('  SQL: ' + opRec.sql.replace(/\n/g, ' ').replace(/\s+/g, ' '));
    }
  }
  console.log(line);
  console.log(`재현: node tests/loop-org-compat.mjs --seed=${OPT.seed} --ops=${OPT.ops}` +
    (OPT.migration ? ` --migration=${OPT.migration}` : '') + '   (조사하려면 --keep 추가)');
  console.log(line);
}

/* ────────────────────────────── 14. 진입점 ────────────────────────────── */

/** --selfcheck: 복제 없이 지정 DB 를 읽기 전용으로만 본다. 쓰기(CREATE/ALTER/UPDATE) 0회. */
function selfcheck() {
  CLONE = OPT.dbName;
  curPhase = 'selfcheck';
  log(`--selfcheck: ${OPT.dbName} 를 읽기 전용으로 점검한다(쓰기 없음 — I7·I8 은 건너뛴다)`);
  const has = mustQuery(
    `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='org_unit' AND COLUMN_NAME='org_id';`,
    'org_id 실재', OPT.dbName);
  if (Number(has[0][0]) !== 1) {
    // ★ 절단 전 DB 는 이 불변식들의 대상이 아니다 — '위반' 이 아니라 '전제 불충족' 이다(exit 2).
    console.error(`[중단·전제] ${OPT.dbName} 에 org_unit.org_id 가 없습니다 — 아직 절단(마이그레이션) 전 DB 입니다.`);
    console.error('            이 판의 불변식은 완전 절단된 스키마를 전제로 합니다. 복제본에서 루프로 돌리세요:');
    console.error('              node tests/loop-org-compat.mjs --ops=60');
    process.exit(2);
  }
  stats.migSource = '(적용하지 않음 — 이미 절단된 DB 를 읽기만 한다)';
  invSchemaContract();
  PROBES = probeUsersOf(snapshot());
  const st = snapshot();
  log(`대상 상태 — org_unit ${st.units.length}행 · app_user ${st.users.length}행 · 대표 사용자 ${PROBES.join(', ')}`);
  stats.compared = checkAll(st);
  stats.checks = 1;
  if (!violations.length) ok('읽기 전용 점검 통과');
  printSummary(st);
  process.exit(violations.length ? 1 : 0);
}

function main() {
  if (!existsSync(MYSQL)) { console.error(`mysql.exe 를 찾을 수 없습니다: ${MYSQL}\n  → --mysql=<경로> 로 지정하세요.`); process.exit(2); }
  if (OPT.selfcheck) return selfcheck();

  log(`org_unit 완전 절단 루프 테스트 시작 — seed=${OPT.seed} ops=${OPT.ops}`);

  /* ── 1. 복제 ── */
  curPhase = 'clone';
  createClone();

  /* ── 2. 절단 **전** 대조 — 옛 스키마가 정말 본부 개명을 막는지(이 테스트가 무엇을 없앴는지의 근거) ── */
  curPhase = 'baseline';
  {
    const br = mustQuery(
      `SELECT c.parent FROM org_unit c WHERE c.parent IS NOT NULL LIMIT 1;`, '절단 전 본부 찾기', CLONE);
    if (br.length) {
      const r = mysqlRun(['SET NAMES utf8mb4;', 'START TRANSACTION;',
        `UPDATE org_unit SET name=${q('개명시험_zz')} WHERE name=${q(br[0][0])};`, 'ROLLBACK;'].join('\n'),
        { db: CLONE, what: '절단 전 개명 시도' });
      stats.preRenameErrno = r.ok ? 0 : r.errno;
      log(`절단 전 확인: 자식을 가진 조직의 개명 시도 → ${r.ok ? '성공(원본이 이미 절단됐거나 트리가 1단이다)' : `errno=${r.errno}${r.errno === 1451 ? ' (ERROR 1451, 기대대로)' : ''}`}`);
    }
  }

  /* ── 3. 시험대 세우기(절단) ── */
  curPhase = 'migrate';
  const mig = resolveMigration();
  stats.migSource = mig.source;
  log(`시험대 DDL 적용: ${mig.source}`);
  const mr = mysqlRun(mig.sql, { db: CLONE, timeout: 300000, what: '시험대 DDL 적용' });
  if (!mr.ok) {
    console.error('[중단] 시험대 DDL 적용 실패: ' + cleanErr(mr.err));
    violate('I0', '시험대 DDL(마이그레이션) 적용이 실패했다 — 절단된 스키마를 세우지 못했다', cleanErr(mr.err));
    printSummary(null); process.exit(1);
  }

  /* ── 4. I0 스키마 계약 + 배포본 낙진 ── */
  curPhase = 'contract';
  invSchemaContract();
  if (violations.length) {
    console.error('\n[중단] 결과 스키마가 확정 설계(완전 절단)와 다릅니다 — 루프를 돌 의미가 없습니다.');
    if (!mig.builtin) {
      console.error(`        적용한 파일: ${mig.source}`);
      console.error('        (그 파일이 아직 미러(A단계) 판이면 여기서 걸린다. 내장 참조 DDL 과 대조하려면 --reference-ddl 로 한 번 더 돌려 보라 —');
      console.error('         내장본으로는 통과하는데 파일로는 걸린다면 결함은 마이그레이션 파일 쪽이다.)');
    }
    printSummary(null); process.exit(1);
  }
  ok('I0 스키마 계약 통과 — org_id PK · name UNIQUE · parent_id/org_id FK · 구 컬럼(parent·org_unit) 없음 · fk_org_parent 없음');

  PROBES = probeUsersOf(snapshot());
  stats.fallout = invDeployedFallout(PROBES);
  log(`배포본 6문 낙진: ${stats.fallout}`);
  if (!violations.length) ok('배포본 낙진이 전제와 일치 — S1(과제 편집 권한 관문)만 생존, 나머지는 1054. 쓰기 문장이 없어 데이터 손상 위험 0');

  const st0 = snapshot();
  stats.numbering = st0.units.map((u) => `${u.orgId}=${u.name}`).join(' · ');
  log(`org_id 배정(depth→sort_order→name): ${stats.numbering}`);
  log(`대표 사용자(단건 payload @id): ${PROBES.join(', ')}`);
  stats.compared += checkAll(st0);
  stats.checks++;
  stats.minActive = st0.units.filter((u) => u.active).length;

  /* ── 5. --selftest ── */
  if (OPT.selftest) {
    const stRes = runSelftest();
    curPhase = 'final';
    const fin = snapshot();
    checkAll(fin, { schema: true });
    printSummary(fin);
    /* ★ 집계 경로를 두 갈래로 잠근다 — CAUGHT 가 아닌 케이스가 하나라도 있으면 무조건 1. */
    const notCaught = stRes.filter((r) => r.verdict !== 'CAUGHT').length;
    process.exit(violations.length || notCaught || !stRes.length ? 1 : 0);
  }

  /* ── 6. 메인 루프 ── */
  curPhase = 'loop';
  let st = st0;
  for (let i = 1; i <= OPT.ops; i++) {
    curOp = i; curPhase = 'loop';
    try {
      st = runOp(st).after;          // ★ runOp 이 효과 검증까지 하고 '검증에 쓴' 스냅샷을 돌려준다
    } catch (e) {
      if (e && e.tcOutputLoss) envFail(`조작 중 mysql 출력 유실 (op#${i}) — ${e.message}`, e.tcDetail);
      if (isEnvErrno(e && e.sqlErrno)) envFail(`조작 중 DB 오류 (op#${i})`, e.message);
      violate('I8', `조작 실행 중 예외: ${e.message}`);
      st = snapshot();
    }
    stats.compared += checkAll(st);
    stats.checks++;
    stats.minActive = Math.min(stats.minActive, st.units.filter((u) => u.active).length);
    // 스키마는 DML 로 변하지 않는다(루프 조작은 전부 DML) — 25회마다 + 최종에만 본다.
    if (i % 25 === 0) invSchemaContract();
    if (i % 10 === 0 || OPT.verbose) {
      log(`진행 ${i}/${OPT.ops} · 조직 ${st.units.length}행(활성 ${st.units.filter((u) => u.active).length}/하한 ${activeFloor(st.units.length)}) · 위반 누적 ${violations.length}`);
    }
  }

  /* ── 7. 루프가 안 뽑은 조작 종류는 끝에서 반드시 한 번씩 ── */
  curPhase = 'coverage';
  let extraOp = OPT.ops;
  for (const [, kind] of OP_KINDS) {
    if (kindVerified[kind]) continue;      // ★ '시도했다' 가 아니라 '효과가 확인됐다' 를 기준으로 본다
    curOp = ++extraOp;
    log(`커버리지 보정 — 효과 확인된 적 없는 조작 [${kind}] 을 1회 실행`);
    try { st = runOp(st, kind).after; }
    catch (e) {
      if (e && e.tcOutputLoss) envFail(`보정 조작 중 mysql 출력 유실(${kind}) — ${e.message}`, e.tcDetail);
      if (isEnvErrno(e && e.sqlErrno)) envFail(`보정 조작 중 DB 오류(${kind})`, e.message);
      violate('I8', `보정 조작 예외(${kind}): ${e.message}`);
      st = snapshot();
    }
    stats.compared += checkAll(st);
    stats.checks++;
  }

  /* ── 8. I7 — 개명이 1문장(리프·본부·루트) + 옛 이름 잔존 전수 검색 ── */
  curPhase = 'I7';
  for (const target of ['leaf', 'branch', 'root']) {
    st = renameProbe(st, '개명 1문장', { target, deep: true });
    stats.compared += checkAll(st);
    stats.checks++;
  }
  invSchemaContract();

  curPhase = 'final';
  printSummary(st);
  process.exit(violations.length ? 1 : 0);
}

try { main(); }
catch (e) {
  // ★ 접속·환경 계열은 '불변식 위반' 이 아니다 — 종료코드 2 로 갈라 낸다.
  if (e && e.tcOutputLoss) { envFail('mysql 출력 유실 — ' + e.message, e.tcDetail); }
  if (e && isEnvErrno(e.sqlErrno)) { envFail(`DB 오류 errno=${e.sqlErrno}`, e.message); }
  console.error('\n[치명] ' + (e && e.stack ? e.stack : e));
  try { printSummary(null); } catch (_) { }
  dropClone();
  process.exit(1);
}
