#!/usr/bin/env node
/* ============================================================================
 *  tests/calendar-adapter.mjs — DB 읽기 계층(1b) 대조 테스트
 * ----------------------------------------------------------------------------
 *  증명하는 명제 하나:
 *    **같은 데이터를 XML 에서 읽은 것과 DB 에서 읽은 것이 완전히 같다.**
 *
 *  ── ★ '완전히 같다' 에는 **배열 순서**가 들어간다 ────────────────────────
 *  화면 순서 = 배열 순서다. 렌더 정렬(entrySort·sortS)도 createdAt 에서 끝나므로,
 *  정렬 키가 동률이면 배열 순서가 그대로 화면에 새어 나온다(JS sort 는 안정 정렬).
 *  그래서 entries·todos 를 **배열 그대로 인덱스별로** 대조한다(diffArrayOrdered).
 *  예전에는 대조 직전에 배열을 id 키 객체로 접어서(byId) 순서가 비교에서 통째로 빠져 있었다 —
 *  자리가 뒤바뀌어도 "차이 0건" 이 나왔다. **통과하는 테스트가 통과 못 하는 테스트보다 위험했다.**
 *  보고는 세 갈래로 나뉜다:
 *    [ORDER] 자리 어긋남 — 어느 배열 몇 번째에 어느 id 가 왔는지까지 찍는다.
 *            정렬 키 동률 그룹 안의 재배치는 `★ 동률 그룹 재배치` 로 따로 센다
 *            (= created_at 로도 복원 불가한 부분 = sort_order 가 있어야 낫는 부분).
 *    [DIFF]  항목 누락/잉여(다중집합) · 항목 내용 차이.
 *  순서를 포기해야 하는 구간은 ORDER_EXEMPT 에 적는다 — **지금은 비어 있다.**
 *  거기에 무엇이든 들어가면 요약의 「순서 비교 면제」에 반드시 찍힌다.
 *
 *  기준(expected)은 앱의 `fromXML()` 이다 — 문서가 아니라 **코드가 정본**이다
 *  (task-calendar-prototype.html:4697). 실제로 그 함수를 실행해서 받는다:
 *    ① 위젯이 CDP(TC_DEBUG_PORT=9222)로 떠 있으면 그 안에서 실행
 *    ② 없으면 jsdom 으로 같은 prototype.html 을 부팅해 실행(같은 코드·같은 정본)
 *    ③ 둘 다 안 되면 exit 2 — **조용히 건너뛰지 않는다.**
 *
 *  실측(actual)은 `widget/CalendarDb.cs` 다. 이 파일이 그것을 컴파일해 복제 DB 에
 *  붙여 부팅 조회를 시키고, 돌려받은 JSON 을 expected 와 깊이 비교한다.
 *
 *  ── 기본 스위트에 포함되지 않는다 ─────────────────────────────────────────
 *  러너(run-tests.mjs)가 `*.test.mjs` 만 수집하므로 확장자가 `.mjs` 인 이 파일은
 *  자동수집에서 빠진다. **개명 금지** — 개명하면 CI(ubuntu-latest)가 MySQL 과
 *  .NET SDK 를 요구하게 되어 깨진다. (loop-*.mjs 와 같은 관례다.)
 *
 *  ── 계약의 정본(이 파일은 그 사본이 아니라 그것을 시험하는 도구다) ──────────
 *   · 어댑터 계약 A~H  : db/deploy/schema-calendar.sql 머리말 (특히 G 절 = DB→앱)
 *   · §2 대전제 / §3.5 부팅 조회 / §3.6 접속 프리앰블 / §3.8.5 어댑터 제약
 *                       : db/CALENDAR-TABLE-DESIGN.md
 *   · 모양의 정본       : task-calendar-prototype.html 의 fromXML()
 *
 *  ── 실 DB 를 절대 건드리지 않는다 ────────────────────────────────────────
 *  `mysqldump` 로 통째 복제한 별도 스키마(기본 `cal_probe_adapter_<pid>`)에서만 쓰고,
 *  끝나면 — 예외·Ctrl+C 에도 — `DROP DATABASE` 한다. 원본에는 `--single-transaction`
 *  덤프(락 없음)와 SELECT 만 나간다. `CREATE TABLE ... LIKE` 를 쓰지 않는 이유는
 *  그것이 **FK 를 복사하지 않아** 가짜 결과를 내기 때문이다(loop-org-compat 과 같은 근거).
 *  `%APPDATA%/TaskCalendar/data.xml` 도 **읽기만** 한다.
 *
 *  ── ★ 출력 무결성 계약 ──────────────────────────────────────────────────
 *  mysql.exe 는 약 0.1% 확률로 종료코드 0 · stderr 없이 stdout 을 행 중간에서
 *  잘라먹는다(실측 2026-08-24). 모든 호출에 종결 마커(`SELECT '__TCEOF__'`)를
 *  별도 문장으로 붙이고, 마지막 유효 줄이 그 마커가 아니면 잘림으로 판정한다.
 *  읽기 전용은 3회 재시도, 그 밖은 즉시 exit 2. 정본은 tests/loop-org-compat.mjs.
 *
 *  ── ★ 어댑터 프로브 계약 (widget/CalendarDb.cs 가 만족해야 하는 최소 표면) ──
 *  이 테스트는 CalendarDb.cs 를 **소스째 컴파일**해 리플렉션으로 부팅 조회를 부른다.
 *  (DeployConfig 는 복제 DB 를 가리키는 대체본으로 갈아끼운다 — 실 DB 로 갈 수 없다.)
 *
 *    · 형식: namespace TaskCalendarWidget 안의 `CalendarDb` 타입(internal 가능)
 *    · 부팅 조회 메서드 — **이름 점수**로 고른다(고정 이름을 요구하지 않는다):
 *        snapshot/boot/state/calendar/load 가 들어가면 가점, commit/member/user/catalog 는 감점.
 *        (감점이 필요한 이유: `LoadEntryCommitsJsonAsync` 는 G-7 의 **지연 조회**이지 부팅 조회가 아니다)
 *    · 반환 — 아래 둘 다 받는다:
 *        `string` / `Task<string>`                       → 그 문자열이 곧 state JSON
 *        `T` / `Task<T>` (T 에 string 프로퍼티 `StateJson`, 없으면 이름이 …Json 인 것)
 *                                                        → 그 프로퍼티가 state JSON
 *        어느 쪽이든 내용은 계약 G-0 의 **14키 객체**를 직렬화한 것이어야 한다.
 *    · 인자 — 순서와 이름에 기대지 않고 **형(型)으로** 맞춘다:
 *        첫 `string`                       ← loginId (필수. 없으면 후보에서 탈락)
 *        `CancellationToken`               ← None
 *        `I(ReadOnly)Dictionary<string,V>` ← 로컬 저장소 경로 맵(G-6). V 는
 *            `(string git, string svn)` · `Tuple<string,string>` ·
 *            `Dictionary<string,string>`{gitRepo,svnRepo} · `string`(git 만) 을 지원
 *        둘째 `string`                     ← 위 맵의 JSON 원문(딕셔너리 인자가 없을 때)
 *        그 밖의 참조형/기본값 인자        ← null / 기본값
 *      ★ 로컬 저장소 인자를 **받지 않는 어댑터도 통과할 수 있다.** 다만 그때는
 *        gitRepo·svnRepo 를 '' 로만 대조하고, 그 사실을 요약의 「계약상 차이」에 찍는다.
 *    · 인스턴스 타입이면 `(Action<string> log)` 생성자를 우선 쓴다(ProjectDb.cs 관례).
 *        어댑터가 그 로그로 남긴 줄은 실패했을 때 stderr 로 그대로 보여 준다.
 *    · 반환이 null 이면 **실패로 본다** — 어댑터가 그것을 '오프라인'으로 쓰기 때문이다.
 *      (그 경우 접속·권한 문제이므로 exit 2. '데이터가 없다'로 통과시키지 않는다.)
 *
 *  후보를 못 찾으면 **그 사실을 그대로 보고하고 exit 2** 한다 — 통과로 치지 않는다.
 *  ※ 실측(2026-08-26): `CalendarDb.LoadSnapshotAsync(string?, IReadOnlyDictionary<string,(string,string)>?)`
 *    → `Task<CalendarSnapshot?>` 형태가 이 계약으로 그대로 잡혔다.
 *
 *  ── 어댑터는 무엇으로 DB 에 붙나 ─────────────────────────────────────────
 *  프로브는 `widget/DeployConfig.cs` 를 **복제본을 가리키는 대체본**으로 갈아끼우고,
 *  거기에 **일회용 전용 계정**(`calprobe_<pid>`, 복제본 SELECT 만)을 넣는다.
 *  실 앱 계정(taskmgr_app)의 GRANT 는 건드리지 않는다 — 89대가 쓰는 운영 자산이다.
 *  덤으로 §3.5 의 '한 연결' 계측이 **우리 접속만** 세게 된다(전역 카운터는 옆 트래픽에 오염된다).
 *
 *  ── ★ 픽스처 한계 — 이 게이트가 증명하지 **못하는** 것 ──────────────────────
 *  판정력은 픽스처가 그 결함을 **만들 수 있는 모양인가**에 달려 있다. 두 픽스처의 성격이 다르다:
 *    real  = 사용자의 실 data.xml. **읽기 전용이라 모양을 고칠 수 없다.** 그래서 실 데이터가
 *            우연히 갖지 않은 결함은 이 픽스처로 만들 수 없다 — 실측: 회의실 4개가 이미
 *            이름순이라 M6(rooms ORDER BY 누락)를 만들 수 없다. remind=0·taskHours 도 없다.
 *    synth = 그 구멍을 메우려고 있는 합성 픽스처. 표시 순서 ≠ 이름 순서인 회의실,
 *            remind 3상태, taskHours, 정렬키 동률 그룹을 일부러 넣어 둔다.
 *  ★ 그러므로 **`--fixture=real` 단독 실행을 완전한 게이트로 쓰면 안 된다.** 그 실행의 SKIP 은
 *    '통과'가 아니라 '만들지 못했다'이고, 요약이 「아무 픽스처도 덮지 못한 것」으로 그 사실을 찍는다.
 *    게이트로 쓸 실행은 `--fixture=both --selftest`(기본값 both)다.
 *  ★ 만들 수 있는 모양인지는 게이트가 스스로 감시한다 — 「픽스처 조건」 줄이 그것이고,
 *    요약에 별도 블록으로 남는다. 그 줄이 늘어나면 그만큼 '같다'의 뜻이 약해진 것이다.
 *
 *  ── 종료코드 ────────────────────────────────────────────────────────────
 *    0  위반 0
 *    1  **불변식 위반**(모양이 다르다 / 계약을 어겼다)
 *    2  **판정 없음** — 검사를 끝까지 못 했다(MySQL·dotnet 없음 · 오라클 없음 ·
 *       CalendarDb.cs 없음 · 출력 잘림 미회복 · 다른 실행이 잠금 보유)
 *    130 중단(Ctrl+C 등)
 *  ★ `2` 를 통과로 읽지 말 것.
 *
 *  ── 사용법 ──────────────────────────────────────────────────────────────
 *    $env:TC_TEST_DB_ADMIN_PW = '<DB 관리자 비번>'    (계정 기본값 root)
 *    node tests/calendar-adapter.mjs
 *    node tests/calendar-adapter.mjs --selftest             비교기 변이 시험(어댑터 불필요)
 *    node tests/calendar-adapter.mjs --reference-adapter    내장 참조 어댑터로 하네스 자체 검증
 *    node tests/calendar-adapter.mjs --reference-adapter --selftest   ← 전 구간 변이 시험
 *    node tests/calendar-adapter.mjs --fixture=real|synth|both
 *    node tests/calendar-adapter.mjs --keep                 복제본·프로브를 남긴다
 * ==========================================================================*/

import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const APP_HTML = join(REPO, 'task-calendar-prototype.html');
const CALENDARDB_CS = join(REPO, 'widget', 'CalendarDb.cs');
const WIDGET_DIR = join(REPO, 'widget');

/* ────────────────────────────── 0. 설정·인자 ────────────────────────────── */
// ★ 자격증명은 소스에 박지 않는다 — 이 파일은 커밋된다. 환경변수로만 받는다.

const DEFAULTS = {
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  mysqldump: process.env.TC_TEST_MYSQLDUMP || '',
  dbHost: '127.0.0.1',
  dbPort: 3306,
  dbName: process.env.TC_TEST_DB_NAME || 'taskmgr',
  clone: process.env.TC_TEST_CAL_CLONE || `cal_probe_adapter_${process.pid}`,
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',
  appUser: process.env.TC_TEST_CAL_APP_USER || 'taskmgr_app',
  appPw: process.env.TC_TEST_CAL_APP_PW || 'taskmgr1234',
  loginId: process.env.TC_TEST_CAL_LOGIN || 'hjlee',
  xml: process.env.TC_TEST_CAL_XML || join(process.env.APPDATA || '', 'TaskCalendar', 'data.xml'),
  cdpPort: Number(process.env.TC_DEBUG_PORT || 9222),
  fixture: 'both',
  oracle: 'auto',
};

function printHelp() {
  console.log(`사용법: node tests/calendar-adapter.mjs [옵션]
  --fixture=real|synth|both  픽스처 선택(기본 both) — real=실 data.xml, synth=합성 커버리지
  --oracle=auto|cdp|jsdom    기준(fromXML) 실행처(기본 auto: cdp → jsdom 순)
  --login-id=ID              복제본에서 쓸 app_user.login_id (기본 ${DEFAULTS.loginId})
  --xml=PATH                 실 픽스처 XML 경로(읽기 전용, 기본 %APPDATA%/TaskCalendar/data.xml)
  --clone=NAME               시험용 복제 스키마명 — cal_probe_ 로 시작해야 한다
  --db-name=NAME             복제 원본(기본 ${DEFAULTS.dbName}) — 읽기만 한다
  --mysql=PATH / --mysqldump=PATH / --db-host / --db-port
  --admin-user=NAME          DB 관리자 계정(기본 root)
  --reference-adapter        widget/CalendarDb.cs 대신 **내장 참조 어댑터**로 돈다(하네스 자체 검증)
  --selftest                 검출기 변이 시험 — 일부러 깨뜨려 검사가 우는지 본다
  --keep                     복제본·프로브 디렉터리를 남긴다(사후 조사용)
  -v, --verbose`);
}

function parseArgs(argv) {
  const o = { ...DEFAULTS, selftest: false, keep: false, verbose: false, referenceAdapter: false };
  for (const a of argv) {
    let m;
    if ((m = /^--mysql=(.+)$/.exec(a))) o.mysql = m[1];
    else if ((m = /^--mysqldump=(.+)$/.exec(a))) o.mysqldump = m[1];
    else if ((m = /^--db-host=(.+)$/.exec(a))) o.dbHost = m[1];
    else if ((m = /^--db-port=(\d+)$/.exec(a))) o.dbPort = Number(m[1]);
    else if ((m = /^--db-name=(.+)$/.exec(a))) o.dbName = m[1];
    else if ((m = /^--clone=(.+)$/.exec(a))) o.clone = m[1];
    else if ((m = /^--admin-user=(.+)$/.exec(a))) o.adminUser = m[1];
    else if ((m = /^--login-id=(.+)$/.exec(a))) o.loginId = m[1];
    else if ((m = /^--xml=(.+)$/.exec(a))) o.xml = m[1];
    else if ((m = /^--fixture=(real|synth|both)$/.exec(a))) o.fixture = m[1];
    else if ((m = /^--oracle=(auto|cdp|jsdom)$/.exec(a))) o.oracle = m[1];
    else if (a === '--reference-adapter') o.referenceAdapter = true;
    else if (a === '--selftest') o.selftest = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error('알 수 없는 인자: ' + a); printHelp(); process.exit(2); }
  }
  if (!o.adminPw) {
    console.error('[중단] DB 관리자 비밀번호가 없습니다. 환경변수 TC_TEST_DB_ADMIN_PW 로 지정하세요.');
    console.error("        PowerShell:  $env:TC_TEST_DB_ADMIN_PW = '<비번>'");
    console.error('        계정명 기본값은 root — 다르면 TC_TEST_DB_ADMIN_USER 또는 --admin-user= 로.');
    process.exit(2);
  }
  // ★ 안전장치: DROP DATABASE 를 하는 이름은 반드시 cal_probe_ 접두사여야 하고 원본과 달라야 한다.
  if (!/^cal_probe_[A-Za-z0-9_]{1,40}$/.test(o.clone)) {
    console.error(`[중단] --clone 은 cal_probe_ 로 시작하는 [A-Za-z0-9_] 이름이어야 합니다: ${o.clone}`);
    console.error('        (이 스크립트는 그 이름의 스키마를 DROP 합니다 — 접두사 강제가 유일한 안전장치입니다.)');
    process.exit(2);
  }
  if (o.clone.toLowerCase() === o.dbName.toLowerCase()) {
    console.error('[중단] --clone 과 --db-name 이 같습니다. 원본을 파괴할 뻔했습니다.');
    process.exit(2);
  }
  return o;
}

const OPT = parseArgs(process.argv.slice(2));

/* ────────────────────────────── 1. 로그·위반 기록 ────────────────────────────── */

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const log = (...a) => console.log(el(), ...a);
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   ·', ...a); };

const violations = [];
const notes = [];              // 계약상 차이·경고 — 위반은 아니지만 요약에 반드시 남긴다
let curPhase = 'init';
let capture = null;            // --selftest 가 '일부러 낸 위반' 을 최종 집계에서 빼는 버킷

function violate(code, desc, detail) {
  const v = { code, phase: curPhase, desc, detail };
  if (capture) {
    capture.push(v);
    if (OPT.verbose) console.log(el(), `    (기대된 검출) [${code}] ${desc}`);
    return v;
  }
  violations.push(v);
  console.log(el(), `  ✗ [${code}] (${curPhase}) ${desc}`);
  if (detail !== undefined) {
    console.log('        ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 1600));
  }
  return v;
}
// ★ capture 중(변이 시험)에는 통과 줄을 찍지 않는다 — 17케이스 × 통과줄이 진짜 결과를 덮는다.
const ok = (msg) => { if (!capture) console.log(el(), `  ✓ ${msg}`); };
function note(msg, detail) {
  if (capture) return;
  notes.push({ phase: curPhase, msg, detail });
  console.log(el(), `  · ${msg}` + (detail ? ` — ${String(detail).slice(0, 300)}` : ''));
}
function withCapture(fn) {
  const prev = capture; const bucket = []; capture = bucket;
  try { return { bucket, ret: fn() }; } finally { capture = prev; }
}

/* ────────────────────────────── 2. MySQL 계층 ────────────────────────────── */
// 드라이버 설치 금지(의존성 0) → mysql.exe 를 child_process 로. SQL 은 stdin(UTF-8) 으로.
// ★ 한글은 셸 변수·argv 로 넘기지 않는다 — Windows ANSI 코드페이지 변환에 깨진다(실측).

const MYSQL = OPT.mysql;
const MYSQLDUMP = OPT.mysqldump || join(dirname(MYSQL), process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump');

function baseArgs(user, pw) {
  return [`-u${user}`, `-p${pw}`, `-h${OPT.dbHost}`, `-P${OPT.dbPort}`,
    '--get-server-public-key', '--default-character-set=utf8mb4'];
}
const cliArgs = (user, pw) => baseArgs(user, pw).concat(['--connect-timeout=5']);

const EOFMARK = '__TCEOF__';
let truncSeen = 0, truncRecovered = 0, truncUnrecovered = 0;
let injectTrunc = Number(process.env.TC_TEST_INJECT_TRUNC || 0);
const INJECT_WHAT = process.env.TC_TEST_INJECT_TRUNC_WHAT || '';

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** mysql.exe 1회 실행(재시도 없음). truncated=true = '종료코드 0 인데 종결 마커가 없다'. */
function mysqlRunOnce(sql, { db, timeout, marker, what = '', user, pw }) {
  const args = cliArgs(user || OPT.adminUser, pw || OPT.adminPw).concat(['-N', '-B']);
  if (db) args.push('-D', db);
  const body = marker ? sql.replace(/\s+$/, '') + '\n;\n' + `SELECT ${q(EOFMARK)};\n` : sql;

  const r = spawnSync(MYSQL, args, {
    input: Buffer.from(body, 'utf8'), maxBuffer: 256 * 1024 * 1024, timeout, windowsHide: true,
  });
  if (r.error) return { ok: false, status: -1, out: '', err: String(r.error.message), errno: null, truncated: false };

  let out = (r.stdout || Buffer.alloc(0)).toString('utf8');
  const err = (r.stderr || Buffer.alloc(0)).toString('utf8');
  const m = /ERROR (\d+)/.exec(err);
  const okc = r.status === 0;

  if (marker && okc && injectTrunc > 0 && (!INJECT_WHAT || String(what).includes(INJECT_WHAT))) {
    injectTrunc--;
    out = out.slice(0, Math.max(0, Math.floor(out.length * 0.85)));
  }

  let truncated = false;
  if (marker && okc) {
    const lines = out.split(/\r?\n/);
    let last = '';
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].length) { last = lines[i]; break; }
    if (last !== EOFMARK) truncated = true;
    else { const idx = out.lastIndexOf(EOFMARK); out = out.slice(0, idx).replace(/(\r?\n)$/, ''); }
  }
  return { ok: okc, status: r.status, out, err, errno: m ? Number(m[1]) : null, truncated };
}

/** SQL 을 stdin 으로 실행. readOnly 면 잘림에서 3회 재시도(재시도가 안전하므로). */
function mysqlRun(sql, { db = null, timeout = 120000, marker = true, readOnly = false, what = 'SQL 실행', user, pw } = {}) {
  const tries = readOnly ? 3 : 1;
  let r = null;
  for (let i = 1; i <= tries; i++) {
    r = mysqlRunOnce(sql, { db, timeout, marker, what, user, pw });
    if (!r.truncated) {
      if (i > 1) { truncRecovered++; vlog(`출력 잘림에서 회복 — ${what} (재시도 ${i - 1}회)`); }
      return r;
    }
    truncSeen++;
    console.log(el(), `  ⚠ mysql 출력이 잘렸다(종료코드 0·stderr 없음, ${r.out.length}B) — ${what}` +
      (i < tries ? ` → 재시도 ${i}/${tries - 1}` : ''));
    if (i < tries) sleepSync(150);
  }
  truncUnrecovered++;
  envFail(`mysql 출력이 잘렸다(종료코드 0 · stderr 없음) — ${what}` +
    (readOnly ? ` · ${tries - 1}회 재시도 실패` : ' · 쓰기 가능 호출이라 재시도하지 않는다(두 번 적용 위험)'),
    `출력 ${r ? r.out.length : 0}B · 종결 마커 ${EOFMARK} 없음. SQL 머리: ` + sql.replace(/\s+/g, ' ').slice(0, 200));
}

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

// 환경 실패 vs 불변식 위반 — 이 구분이 없으면 환경 사고가 '핵심 결함' 으로 둔갑한다.
const ENV_ERRNOS = new Set([1049, 2002, 2003, 2005, 2006, 2013, 1205, 1213]);
const isEnvErrno = (e) => e != null && ENV_ERRNOS.has(Number(e));

let summaryPrinted = false;
function envFail(msg, detail) {
  console.error('');
  console.error('[중단·환경] ' + msg);
  if (detail) console.error('            ' + String(detail).replace(/\s+/g, ' ').slice(0, 1200));
  console.error('            ↳ 이것은 불변식 위반이 아니다(종료코드 2). 확인할 것:');
  console.error(`               · 같은 복제본 이름 \`${OPT.clone}\` 을 쓰는 다른 실행이 있는가`);
  console.error('               · MySQL 이 살아 있는가 / 접속 정보가 맞는가');
  try { printSummary(null, msg); } catch (_) { }
  process.exit(2);
}
function sqlThrow(msg, r) { const e = new Error(msg); e.sqlErrno = r.errno; throw e; }
function outputLoss(msg, detail) { const e = new Error(msg); e.tcOutputLoss = true; e.tcDetail = detail; throw e; }

function mustQuery(sql, what, db) {
  const r = mysqlRun(sql, { db: db === undefined ? CLONE : db, readOnly: true, what });
  if (!r.ok) sqlThrow(`MySQL 조회 실패(${what}): ${cleanErr(r.err)}`, r);
  return rows(r.out);
}
/** SQL 문자열 리터럴 — 백슬래시·작은따옴표 이스케이프. null/undefined → NULL */
function q(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}
/** 숫자 리터럴 — null 은 NULL */
function num(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (!Number.isFinite(Number(v))) throw new Error('숫자가 아닌 값을 숫자 자리에 넣으려 했습니다: ' + v);
  return String(Number(v));
}

/* 마커로 구분되는 배치 조회 — 여는·닫는 마커 둘 다 두어 '0행' 과 '유실' 을 구조적으로 구분한다. */
const SEP = '__TCSEP__', ENDSEP = '__TCEND__';
function batch(items, { db = null, what = '배치 조회' } = {}) {
  const parts = ['SET NAMES utf8mb4;'];
  for (const it of items) {
    parts.push(`SELECT ${q(SEP + it.key + SEP)};`);
    parts.push(it.sql.replace(/;\s*$/, '') + ';');
    parts.push(`SELECT ${q(ENDSEP + it.key + ENDSEP)};`);
  }
  const r = mysqlRun(parts.join('\n'), { db: db === null ? CLONE : db, readOnly: true, what });
  if (!r.ok) sqlThrow('배치 조회 실패: ' + cleanErr(r.err) + '\n--- SQL ---\n' + parts.join('\n').slice(0, 2000), r);
  const res = new Map(); const closed = new Set();
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
  if (curKey !== null) outputLoss(`배치 출력 유실 — 블록 '${curKey}' 이 닫히지 않았다`, what);
  const lost = items.filter((it) => !res.has(it.key) || !closed.has(it.key)).map((it) => it.key);
  if (lost.length) outputLoss(`배치 출력 유실 — ${items.length}개 중 ${lost.length}개가 결과에 없다: ${lost.join(', ')}`,
    `${what} · 받은 출력 ${r.out.length}B`);
  return res;
}

/* ────────────────────────────── 3. 실행 잠금 ────────────────────────────── */
/* GET_LOCK 은 **접속 수명** 에 묶인다 — mysql.exe 는 호출마다 접속을 새로 열고 닫으므로
 * spawnSync 로는 잠금을 쥐고 있을 수 없다. 유지용 mysql 프로세스를 하나 띄우고,
 * 별도 접속에서 IS_USED_LOCK 이 **그 프로세스의 접속 id** 인지 대조한다. */
const LOCK_NAME = 'tc_cal_adapter';
const LOCK_MARK = `tc_cal_adapter_holder_${process.pid}`;
let lockProc = null, lockConnId = null;

function acquireRunLockOnce() {
  const probe = mysqlRun(`SELECT IFNULL(IS_USED_LOCK(${q(LOCK_NAME)}),0);`,
    { db: null, readOnly: true, what: '실행 잠금 확인' });
  if (!probe.ok) return { fatal: true, why: 'DB 접속 실패(실행 잠금 확인 단계): ' + cleanErr(probe.err) };
  const held = (rows(probe.out)[0] || ['0'])[0];
  if (held !== '0') return { busy: true, why: `'${LOCK_NAME}' 을 접속 ${held} 가 쥐고 있다` };

  lockProc = spawn(MYSQL, cliArgs(OPT.adminUser, OPT.adminPw).concat(['-N', '-B']),
    { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  lockProc.on('error', () => { });
  lockProc.stdin.on('error', () => { });
  lockProc.stdin.end(`SELECT GET_LOCK(${q(LOCK_NAME)}, 5);\nSELECT SLEEP(7200) /* ${LOCK_MARK} */;\n`);
  lockProc.unref();

  const idSql = `SELECT IFNULL(IS_USED_LOCK(${q(LOCK_NAME)}),0),
                        IFNULL((SELECT MAX(ID) FROM information_schema.PROCESSLIST
                                 WHERE INFO LIKE ${q('%' + LOCK_MARK + '%')} AND INFO NOT LIKE '%PROCESSLIST%'),0);`;
  let sawMine = false;
  for (let i = 0; i < 60; i++) {
    sleepSync(150);
    const r = mysqlRun(idSql, { db: null, readOnly: true, what: '실행 잠금 소유 확인' });
    if (!r.ok) continue;
    const rr = rows(r.out)[0];
    if (!rr) continue;
    const [used, mine] = rr;
    if (mine === '0') continue;
    sawMine = true;
    lockConnId = mine;
    if (used === mine) { vlog(`실행 잠금 확보 — ${LOCK_NAME} (접속 ${mine})`); return { ok: true }; }
    releaseRunLock();
    return { busy: true, why: used === '0' ? '유지용 접속이 GET_LOCK 을 얻지 못했다' : `다른 접속(${used})이 먼저 쥐었다` };
  }
  releaseRunLock();
  return sawMine ? { busy: true, why: '유지용 접속이 9초 안에 잠금을 얻지 못했다' }
    : { fatal: true, why: '유지용 mysql 접속이 뜨지 않았거나 PROCESSLIST 조회 권한이 없다' };
}

function acquireRunLock() {
  const deadline = Date.now() + 20000;
  let why = '';
  for (let attempt = 1; ; attempt++) {
    const r = acquireRunLockOnce();
    if (r.ok) { if (attempt > 1) log(`실행 잠금 확보 — ${attempt}회 시도`); return; }
    why = r.why;
    if (r.fatal) envFail('실행 잠금 확보 실패', why);
    if (Date.now() >= deadline) break;
    if (attempt === 1) log(`실행 잠금 대기 — ${why} · 최대 20초 재시도`);
    sleepSync(500);
  }
  envFail(`다른 실행이 진행 중입니다 — ${why}`,
    `20초를 기다려도 잠금이 풀리지 않았다. 남은 세션 확인: SELECT ID,INFO FROM information_schema.PROCESSLIST WHERE INFO LIKE '%${LOCK_NAME}%';`);
}

function releaseRunLock() {
  const p = lockProc; lockProc = null;
  const id = lockConnId; lockConnId = null;
  if (p) { try { p.kill(); } catch (_) { } }
  if (id) {
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

/* ────────────────────────────── 4. 복제본 수명주기 ────────────────────────────── */

let CLONE = OPT.clone;
let cloneCreated = false;
let grantGiven = false;
/* ★ 어댑터는 **전용 일회용 계정**으로 붙는다. 실 앱 계정(taskmgr_app)의 GRANT 를 건드리지 않기 위해서다
 *   — 그 계정은 89대가 쓰는 운영 자산이고, 이 테스트가 스키마별 GRANT 를 붙였다 떼는 대상이 아니다.
 *   부수 효과가 하나 더 있다: 접속 수 계측(§3.5 '한 연결')이 **우리 것만** 세게 된다.
 *   SHOW GLOBAL STATUS 'Connections' 는 서버 전역이라, 옆에서 위젯이나 다른 실행이 붙기만 해도
 *   멀쩡한 어댑터가 '연결을 3번 열었다' 로 찍힌다(실측: 동시 실행 2개로 재현). */
const PROBE_USER = `calprobe_${process.pid}`;
const PROBE_PW = 'p' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
const PROBE_DIR = join(tmpdir(), `tc-cal-probe-${process.pid}`);
let probeDirCreated = false;

function createClone() {
  acquireRunLock();
  if (!existsSync(MYSQL)) envFail(`mysql 을 찾을 수 없습니다: ${MYSQL}`, '--mysql=<경로> 로 지정하세요.');
  if (!existsSync(MYSQLDUMP)) envFail(`mysqldump 를 찾을 수 없습니다: ${MYSQLDUMP}`, '--mysqldump=<경로> 로 지정하세요.');

  const chk = mysqlRun(`SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=${q(OPT.dbName)};`,
    { db: null, readOnly: true, what: '원본 스키마 확인' });
  if (!chk.ok) envFail('DB 접속 실패: ' + cleanErr(chk.err));
  if (rows(chk.out).length !== 1) envFail(`원본 스키마가 없습니다: ${OPT.dbName}`);

  log(`복제 시작 — ${OPT.dbName} → ${OPT.clone} (mysqldump 통째 복제 · 원본은 SELECT 만)`);
  // ★ --single-transaction: 원본에 락을 걸지 않는다. CREATE TABLE ... LIKE 는 FK 를 복사하지 않아 쓰지 않는다.
  const dumpArgs = baseArgs(OPT.adminUser, OPT.adminPw).concat([
    '--no-tablespaces', '--single-transaction', '--skip-lock-tables', '--set-gtid-purged=OFF', OPT.dbName]);
  const d = spawnSync(MYSQLDUMP, dumpArgs, { maxBuffer: 512 * 1024 * 1024, timeout: 300000, windowsHide: true });
  if (d.error || d.status !== 0) {
    envFail('mysqldump 실패: ' + cleanErr((d.stderr || Buffer.alloc(0)).toString('utf8')) + (d.error ? ' ' + d.error.message : ''));
  }
  const dump = d.stdout || Buffer.alloc(0);

  const mk = mysqlRun(`DROP DATABASE IF EXISTS \`${OPT.clone}\`;\n` +
    `CREATE DATABASE \`${OPT.clone}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`,
    { db: null, what: '복제 스키마 생성' });
  if (!mk.ok) envFail('복제 스키마 생성 실패: ' + cleanErr(mk.err));
  cloneCreated = true;

  const l = spawnSync(MYSQL, cliArgs(OPT.adminUser, OPT.adminPw).concat(['-D', OPT.clone]),
    { input: dump, maxBuffer: 512 * 1024 * 1024, timeout: 300000, windowsHide: true });
  if (l.error || l.status !== 0) envFail('복제본 적재 실패: ' + cleanErr((l.stderr || Buffer.alloc(0)).toString('utf8')));

  // 전용 계정 생성 + 복제본에만 SELECT. 이전 실행이 죽어 남긴 계정도 함께 치운다.
  const stale = mysqlRun(String.raw`SELECT user FROM mysql.user WHERE user LIKE 'calprobe\_%';`,
    { db: null, readOnly: true, what: '잔여 프로브 계정 확인' });
  if (stale.ok) {
    for (const [u] of rows(stale.out)) {
      if (u === PROBE_USER) continue;
      mysqlRun(`DROP USER IF EXISTS ${q(u)}@'%';`, { db: null, what: '잔여 프로브 계정 정리' });
      note(`이전 실행이 남긴 프로브 계정을 지웠다: ${u}`);
    }
  }
  const gr = mysqlRun([
    `DROP USER IF EXISTS ${q(PROBE_USER)}@'%';`,
    `CREATE USER ${q(PROBE_USER)}@'%' IDENTIFIED BY ${q(PROBE_PW)};`,
    `GRANT SELECT ON \`${OPT.clone}\`.* TO ${q(PROBE_USER)}@'%';`,
  ].join('\n'), { db: null, what: '프로브 계정 생성' });
  if (!gr.ok) envFail('프로브 전용 DB 계정을 만들지 못했습니다 — 어댑터가 복제본에 붙을 수 없습니다.', cleanErr(gr.err));
  grantGiven = true;
  vlog(`프로브 계정 ${PROBE_USER} 생성 · GRANT SELECT ON ${OPT.clone}.*`);

  const cnt = mustQuery(
    'SELECT COUNT(*) FROM app_user; SELECT COUNT(*) FROM cal_user_rev; SELECT COUNT(*) FROM cal_category;',
    '복제 검산', OPT.clone);
  log(`복제 완료 — ${OPT.clone}: app_user ${cnt[0][0]}행 · cal_user_rev ${cnt[1][0]}행 · cal_category ${cnt[2][0]}행 (덤프 ${(dump.length / 1024).toFixed(0)}KB)`);
  if (cnt[2][0] !== '0') note(`복제본의 cal_category 가 0행이 아니다(${cnt[2][0]}행) — 픽스처 적재 전에 이 사용자 행만 비운다`);
}

/** 자기가 만든 것만 되돌린다. 예외·Ctrl+C 에도 반드시 돈다. */
function cleanupAll() {
  try {
    if (probeDirCreated && !OPT.keep) {
      try { rmSync(PROBE_DIR, { recursive: true, force: true }); } catch (_) { }
      probeDirCreated = false;
    } else if (probeDirCreated) {
      console.error(`[cleanup] --keep — 프로브 디렉터리를 남깁니다: ${PROBE_DIR}`);
      probeDirCreated = false;
    }
    // ★ 전용 계정은 반드시 지운다 — DROP DATABASE 는 그 스키마에 준 권한을 자동으로 지우지 않아
    //   계정을 남기면 mysql.db 에 유령 행이 함께 남는다.
    if (grantGiven) {
      grantGiven = false;
      try {
        spawnSync(MYSQL, cliArgs(OPT.adminUser, OPT.adminPw).concat(['-N', '-B']), {
          input: Buffer.from(`DROP USER IF EXISTS '${PROBE_USER}'@'%';`, 'utf8'),
          windowsHide: true, timeout: 60000,
        });
        console.error(`[cleanup] 프로브 계정 '${PROBE_USER}' 삭제 완료`);
      } catch (_) {
        console.error(`[cleanup] 프로브 계정 삭제 실패 — 수동으로: DROP USER '${PROBE_USER}'@'%';`);
      }
    }
    if (!cloneCreated) return;
    if (OPT.keep) { cloneCreated = false; console.error(`[cleanup] --keep — 복제본 \`${OPT.clone}\` 을 남깁니다(수동 DROP + REVOKE 필요).`); return; }
    cloneCreated = false;
    try {
      spawnSync(MYSQL, cliArgs(OPT.adminUser, OPT.adminPw).concat(['-N', '-B']),
        { input: Buffer.from(`DROP DATABASE IF EXISTS \`${OPT.clone}\`;`, 'utf8'), windowsHide: true, timeout: 60000 });
      console.error(`[cleanup] 복제 스키마 \`${OPT.clone}\` DROP 완료`);
    } catch (_) {
      console.error(`[cleanup] DROP 실패 — 수동으로: DROP DATABASE \`${OPT.clone}\`;`);
    }
  } finally { releaseRunLock(); }
}
process.on('exit', cleanupAll);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanupAll(); process.exit(130); });
process.on('uncaughtException', (e) => {
  if (e && (e.tcOutputLoss || isEnvErrno(e.sqlErrno))) {
    try { envFail(e.tcOutputLoss ? 'mysql 출력 유실 — ' + e.message : `DB 오류 errno=${e.sqlErrno}`, e.tcDetail || e.message); } catch (_) { }
    cleanupAll(); process.exit(2);
  }
  console.error(e); cleanupAll(); process.exit(1);
});

/* ────────────────────────────── 5. 기준(expected) — 앱의 fromXML() ──────────────────────────────
 * ★ 문서가 아니라 **코드가 정본**이다. 그러므로 fromXML 을 재구현하지 않고 **실행**한다.
 *   ① CDP(위젯) ② jsdom(같은 prototype.html) — 둘 다 같은 함수를 돌린다.
 *   ③ 둘 다 실패하면 exit 2. 조용히 건너뛰지 않는다.
 *
 * ★ undefined 를 잃지 않는 직렬화: JSON.stringify 는 값이 undefined 인 **키를 통째로 지운다**.
 *   "키가 없는 것" 과 "키는 있는데 undefined" 는 이 테스트가 반드시 구분해야 하는 두 상태다
 *   (계약: 개인 과제에는 source 키가 **없어야** 한다). replacer 로 센티널을 넣어 키를 살린다. */
const UNDEF = '\u0000undef';
const NANV = '\u0000nan';
const SERIALIZER = `function(k,v){ if(v===undefined) return ${JSON.stringify(UNDEF)};
  if(typeof v==='number' && !isFinite(v)) return ${JSON.stringify(NANV)}; return v; }`;

class Cdp {
  #ws = null; #id = 0; #pending = new Map(); #closed = false;
  static async attach(port) {
    let list;
    const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) });
    list = await res.json();
    const pages = (Array.isArray(list) ? list : []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!pages.length) throw new Error(`CDP page 타겟이 없습니다(포트 ${port})`);
    const t = pages.find((p) => /tcapp\.local/i.test(p.url || '')) || pages[0];
    const c = new Cdp();
    await c.#connect(t.webSocketDebuggerUrl);
    c.target = t;
    return c;
  }
  async #connect(url) {
    const ws = new WebSocket(url); this.#ws = ws;
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('WebSocket 연결 시간 초과: ' + url)), 10000);
      ws.addEventListener('open', () => { clearTimeout(to); res(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(to); rej(new Error('WebSocket 연결 실패: ' + url)); }, { once: true });
    });
    ws.addEventListener('close', () => { this.#closed = true; });
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (_) { return; }
      if (m.id == null) return;
      const p = this.#pending.get(m.id); if (!p) return;
      this.#pending.delete(m.id); clearTimeout(p.to);
      if (m.error) p.reject(new Error(`CDP 오류(${m.error.code}): ${m.error.message}`));
      else p.resolve(m.result);
    });
  }
  send(method, params = {}) {
    if (this.#closed) return Promise.reject(new Error('CDP 연결이 끊겼습니다(위젯 종료?)'));
    const id = ++this.#id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { this.#pending.delete(id); rej(new Error('CDP 응답 시간 초과: ' + method)); }, 40000);
      this.#pending.set(id, { resolve: res, reject: rej, to });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const msg = (d.exception && (d.exception.description || d.exception.value)) || d.text || '알 수 없는 예외';
      throw new Error('페이지 JS 예외: ' + String(msg).split('\n').slice(0, 3).join(' | '));
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.#ws && this.#ws.close(); } catch (_) { } }
}

/** fromXML 오라클 — { kind, run(xmlText) -> object, close() } */
async function openOracle() {
  const errs = [];
  if (OPT.oracle === 'auto' || OPT.oracle === 'cdp') {
    try {
      const cdp = await Cdp.attach(OPT.cdpPort);
      const probe = await cdp.evaluate('typeof fromXML');
      if (probe !== 'function') throw new Error(`페이지에 fromXML 이 없다(typeof=${probe})`);
      log(`기준 오라클 = CDP 위젯 (포트 ${OPT.cdpPort} · ${cdp.target && cdp.target.url})`);
      return {
        kind: 'cdp',
        run: async (xml) => JSON.parse(await cdp.evaluate(
          `JSON.stringify(fromXML(${JSON.stringify(xml)}), ${SERIALIZER})`)),
        close: () => cdp.close(),
      };
    } catch (e) { errs.push('CDP: ' + e.message); }
  }
  if (OPT.oracle === 'auto' || OPT.oracle === 'jsdom') {
    try {
      const { JSDOM } = await import('jsdom');
      if (!existsSync(APP_HTML)) throw new Error('앱 소스가 없다: ' + APP_HTML);
      const dom = new JSDOM(readFileSync(APP_HTML, 'utf8'), {
        runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/',
        beforeParse(window) {
          if (typeof window.crypto === 'undefined') {
            window.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
          }
          window.scrollTo = () => { };
        },
      });
      const w = dom.window;
      if (typeof w.fromXML !== 'function') throw new Error('부팅은 됐지만 fromXML 이 전역에 없다');
      log('기준 오라클 = jsdom (같은 task-calendar-prototype.html 을 부팅해 같은 fromXML 을 실행한다)');
      if (OPT.oracle === 'auto') note('CDP 위젯이 없어 jsdom 으로 대체했다(같은 코드·같은 정본). 위젯 경로를 강제하려면 --oracle=cdp');
      return {
        kind: 'jsdom',
        run: async (xml) => JSON.parse(w.eval(
          `JSON.stringify(fromXML(${JSON.stringify(xml)}), ${SERIALIZER})`)),
        close: () => { try { w.close(); } catch (_) { } },
      };
    } catch (e) { errs.push('jsdom: ' + e.message); }
  }
  envFail('기준(fromXML) 을 실행할 곳이 없습니다 — 이 테스트는 기준 없이는 아무것도 판정할 수 없습니다.',
    errs.join(' / ') + `  → 위젯을 TC_DEBUG_PORT=${OPT.cdpPort} 로 띄우거나, tests/ 에서 npm ci 로 jsdom 을 설치하세요.`);
}

/* ────────────────────────────── 6. 픽스처 ──────────────────────────────
 * real  : %APPDATA%/TaskCalendar/data.xml — **읽기만 한다. 고치지 않는다.**
 * synth : 실 데이터가 안 건드리는 계약면(반복·예외·dayNotes·taskHours·remind 3상태·
 *         공식과제 source/dbGone·완료시각·NULL 자리 전수)을 덮는 합성 XML.
 *         ★ '이관 도구' 가 아니다 — 이 테스트가 쓰는 **시험용 픽스처**다. */

const ATTEND_OK = new Set(['1', '2', '3', '4', '5', '6', '7', '9', '10', '11', '12']);

function realFixtureXml() {
  if (!existsSync(OPT.xml)) {
    envFail(`실 픽스처 XML 이 없습니다: ${OPT.xml}`, '--xml=<경로> 로 지정하거나 --fixture=synth 로 실행하세요.');
  }
  const t = readFileSync(OPT.xml, 'utf8');
  log(`실 픽스처: ${OPT.xml} (${Buffer.byteLength(t, 'utf8')}B) — 읽기 전용`);
  return t;
}

/** 합성 커버리지 XML. projectUid 가 있으면 dbGone=false 인 공식 과제도 함께 덮는다. */
function synthFixtureXml(projectUid) {
  const CA = '2026-05-01T01:02:03.123Z';
  const UA = '2026-05-02T04:05:06.789Z';
  const cats = [];
  cats.push(`<category id="c-alpha" color="#123abc" gitRepo="D:\\repos\\alpha" createdAt="${CA}">` +
    `<name>알파 과제</name><description>설명 있음 · 특수문자 &amp; &lt;태그&gt; '따옴표'</description></category>`);
  cats.push(`<category id="c-beta" color="#00ff00" svnRepo="C:\\wc\\beta" createdAt="${CA}">` +
    `<name>베타 과제</name><description/></category>`);
  cats.push(`<category id="c-gamma" createdAt="${CA}"><name>감마(색 없음→기본색)</name><description/></category>`);
  if (projectUid) {
    cats.push(`<category id="db-${projectUid}" source="db" color="#5b6b7d" createdAt="${CA}">` +
      `<name>공식 과제(살아있음)</name><description>DB 유래</description></category>`);
  }
  cats.push(`<category id="db-00000000-0000-0000-0000-0000000000ff" source="db" dbGone="1" color="#abcdef" createdAt="${CA}">` +
    `<name>공식 과제(사라짐)</name><description/></category>`);

  const e = [];
  // 날짜 순서와 문서 순서를 일부러 어긋나게 둔다 — ORDER BY 누락을 검출하기 위한 픽스처 조건.
  e.push(`<entry id="e-late" date="2026-05-20" categoryId="c-beta" allDay="false" startTime="09:30" endTime="10:45" location="회의실 A" remind="15" createdAt="${CA}" updatedAt="${UA}"><title>늦은 날짜인데 문서 앞</title><memo>메모 첫줄
메모 둘째줄</memo></entry>`);
  e.push(`<entry id="e-early" date="2026-05-04" categoryId="c-alpha" allDay="true" remind="0" createdAt="${CA}" updatedAt="${UA}"><title>종일 · 알림 없음(0)</title><memo/></entry>`);
  e.push(`<entry id="e-nocat" date="2026-05-06" allDay="false" startTime="13:00" endTime="14:00" createdAt="${CA}" updatedAt="${UA}"><title>미분류(categoryId 없음)</title><memo/></entry>`);
  e.push(`<entry id="e-range" date="2026-05-08" endDate="2026-05-12" categoryId="c-gamma" allDay="true" createdAt="${CA}" updatedAt="${UA}"><title>기간 일정</title><memo/></entry>`);
  e.push(`<entry id="e-weekly" date="2026-05-05" categoryId="c-alpha" allDay="false" startTime="08:00" endTime="09:00" createdAt="${CA}" updatedAt="${UA}"><title>주간 반복 + 예외</title><memo/>` +
    `<recur freq="weekly" interval="2" until="2026-07-31"><except date="2026-05-19"/><except date="2026-06-02"/></recur></entry>`);
  e.push(`<entry id="e-monthly" date="2026-05-15" categoryId="c-beta" allDay="true" createdAt="${CA}" updatedAt="${UA}"><title>월간 반복 + 횟수</title><memo/>` +
    `<recur freq="monthly" interval="1" count="6"/></entry>`);
  e.push(`<entry id="e-git" date="2026-05-11" categoryId="c-alpha" source="git" allDay="true" createdAt="${CA}" updatedAt="${UA}"><title>git 일정 · 커밋 3건</title><memo/><commits>` +
    `<commit hash="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" short="aaaaaaa" time="09:12" subject="첫 커밋 제목">본문 첫줄
본문 둘째줄</commit>` +
    `<commit hash="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" short="bbbbbbb" subject="시각 없는 커밋"/>` +
    `<commit hash="cccccccccccccccccccccccccccccccccccccccc" short="ccccccc" time="23:59" subject="세 번째"/></commits></entry>`);
  e.push(`<entry id="e-noremind" date="2026-05-18" categoryId="c-gamma" allDay="false" startTime="17:00" endTime="18:00" createdAt="${CA}" updatedAt="${UA}"><title>remind 속성 없음(=기본 사다리 null)</title><memo/></entry>`);
  // ★ 정렬 키(entry_date) **동률 3인조** — createdAt 까지 같다(합성 픽스처는 전부 CA 다).
  //   ORDER BY entry_date 로도, created_at 보조정렬로도 이 셋의 문서 순서를 복원할 수 없다.
  //   §5.3 이 cal_category 에 sort_order 를 둔 것과 **정확히 같은 상황**을 합성으로 재현한 것 —
  //   이 자리가 있어야 '동률 자리 순서 뒤바뀜' 을 사용자의 실 data.xml 없이도 증명할 수 있다.
  e.push(`<entry id="e-tie-3" date="2026-05-14" categoryId="c-alpha" allDay="true" createdAt="${CA}" updatedAt="${UA}"><title>동률 3인조 · 문서 첫째</title><memo/></entry>`);
  e.push(`<entry id="e-tie-1" date="2026-05-14" categoryId="c-beta" allDay="true" createdAt="${CA}" updatedAt="${UA}"><title>동률 3인조 · 문서 둘째</title><memo/></entry>`);
  e.push(`<entry id="e-tie-2" date="2026-05-14" categoryId="c-gamma" allDay="true" createdAt="${CA}" updatedAt="${UA}"><title>동률 3인조 · 문서 셋째</title><memo/></entry>`);

  const t = [];
  t.push(`<todo id="t-done" done="true" categoryId="c-alpha" due="2026-05-10" prio="high" completedAt="2026-05-11T02:03:04.005Z" createdAt="${CA}" updatedAt="${UA}"><text>완료된 할 일</text><note>비고 있음</note></todo>`);
  t.push(`<todo id="t-span" done="false" categoryId="c-beta" due="2026-05-01" endDate="2026-05-05" createdAt="${CA}" updatedAt="${UA}"><text>기간 할 일 + 날짜별 설명</text><note/>` +
    `<dayNote date="2026-05-01">첫날 내용</dayNote><dayNote date="2026-05-03">   가운데 날   </dayNote><dayNote date="2026-05-05">마지막 날</dayNote></todo>`);
  t.push(`<todo id="t-nodue" done="false" createdAt="${CA}" updatedAt="${UA}"><text>기한 없음 · 과제 없음</text><note/></todo>`);
  t.push(`<todo id="t-plain" done="false" categoryId="c-gamma" due="2026-05-25" createdAt="${CA}" updatedAt="${UA}"><text>보통 우선순위</text><note/></todo>`);
  // ★ 정렬 키(due) 동률 짝 — createdAt 도 같다. entries 와 같은 이유로 둔다.
  t.push(`<todo id="t-tie-2" done="false" categoryId="c-alpha" due="2026-05-22" createdAt="${CA}" updatedAt="${UA}"><text>동률 짝 · 문서 앞</text><note/></todo>`);
  t.push(`<todo id="t-tie-1" done="false" categoryId="c-beta" due="2026-05-22" createdAt="${CA}" updatedAt="${UA}"><text>동률 짝 · 문서 뒤</text><note/></todo>`);

  /* 회의실 — ★ 표시(문서) 순서가 이름 **오름차순으로도 내림차순으로도** 재현되지 않아야 한다.
   *   cal_room 은 _no 가 없고 PK 가 (user_id, name) 이라, ORDER BY sort_order 를 빠뜨린 어댑터는
   *   **이름순**을 돌려준다 — M6 가 재현하는 상태가 그것이고, M6b 가 그 반대 방향이다.
   *   이 자리가 synth 에 있어야 하는 이유: 사용자의 실 data.xml 회의실 4개는 우연히 이미
   *   이름순이라(읽기 전용이라 고칠 수도 없다) real 픽스처로는 M6 를 만들 수 없다(SKIP).
   *   아래 배치의 이름순은 '101호 · A룸 · 대회의실 · 회의실 Z'(숫자<라틴<한글) — 양방향 모두 다르다.
   *   ※ 순서를 바꾸려면 verifyLoaded 의 「픽스처 조건」이 조용한지 확인하고 바꿔라. */
  const rooms = ['회의실 Z', '101호', '대회의실', 'A룸'];

  const th = `<taskHours>` +
    `<day date="2026-05-04"><t cat="c-alpha" h="3.5"/><t cat="c-beta" h="4.25"/></day>` +
    `<day date="2026-05-05"><t cat="c-gamma" h="8"/></day>` +
    `</taskHours>`;
  const at = `<attendance>` +
    `<day date="2026-05-04" status="1" overtime="0"/>` +
    `<day date="2026-05-05" status="2" overtime="3"/>` +
    `<day date="2026-05-06" status="12" overtime="11"/>` +
    `<day date="2026-05-07" status="5" overtime="0"/>` +
    `</attendance>`;

  // ★ lsMigrated 는 2026-09-01 에 없앴다(자동이관과 함께). 픽스처에도 두지 않는다.
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<taskCalendar version="1" generator="calendar-adapter-test" gitAuthor="깃작성자" svnAuthor="svn-author">` +
    `<categories>${cats.join('')}</categories>` +
    `<entries>${e.join('')}</entries>` +
    `<todos>${t.join('')}</todos>` +
    `<rooms>${rooms.map((r) => `<room>${r}</room>`).join('')}</rooms>` +
    `<prefs reportMarker="•" reportMarkerCustom="※" reportIndent="4" gitCommitBody="1" ` +
    `reportMarker_daily="1." reportMarkerCustom_daily="d" reportIndent_daily="0" ` +
    `reportMarker_weekly="가." reportMarkerCustom_weekly="w" reportIndent_weekly="6" ` +
    `fontFamily="Malgun Gothic" fontSize="12"/>` +
    th + at + `</taskCalendar>`;
}

/* ────────────────────────────── 7. 적재기 — expected → 복제 DB ──────────────────────────────
 * ★ 방향에 주의: XML → fromXML() → **expected** → INSERT. 설계 §8 이 못박은 순서와 같다
 *   ("이관 도구와 런타임 저장은 fromXML() 을 통과한 결과만 DB 에 넣는다").
 * ★ _no(cat_no·entry_no·todo_no)는 **표시 순서와 일부러 어긋나게** 배정한다.
 *   그래야 ORDER BY 를 빠뜨린 어댑터가 PK 순서(=_no 순서)를 돌려주고, 그 자리에서 잡힌다. */

const isoRe = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.(\d{3})Z$/;
/** ISO 'Z' → DATETIME(3) 리터럴. 3자리가 아니면 픽스처 자격이 없다(왕복 서명이 어긋난다). */
function isoToDt(v, where) {
  const m = isoRe.exec(String(v || ''));
  if (!m) { violate('FIX', `픽스처의 시각이 ISO(밀리초 3자리) 형식이 아니다: ${where} = ${JSON.stringify(v)}`); return null; }
  return `${m[1]} ${m[2]}.${m[3]}`;
}
/** 표시 순서(0..n-1)와 어긋나는 _no 배정 — **결정적 셔플**.
 *  ★ 2026-08-27: 옛 구현은 완전 역순(`n - i`)이었다. 그러면 계약 G-5 가 **금지한** 정렬키를 쓴
 *    어댑터(`ORDER BY <표>_no DESC`)가 문서 순서와 **항상 일치**해서 게이트를 초록으로 통과한다
 *    (실측: 그렇게 바꾼 어댑터가 real·synth 양쪽에서 EXIT 0 · "인덱스별로 같다"까지 찍었다).
 *    표시 순서가 `_no` 의 **오름차순으로도 내림차순으로도** 재현되지 않아야 시험이 성립한다.
 *  고정 시드 LCG 라 실행마다 같은 배치가 나온다(재현성 유지). n<3 이면 어떤 배치도 두 조건을
 *  동시에 만족시킬 수 없으므로 verifyLoaded 의 「픽스처 조건」이 그 사실을 찍는다. */
/** ★ 고장 주입 — **픽스처 조건 검출기 자체**를 시험한다(TC_TEST_INJECT_NOSCRAMBLE=1).
 *  _no 를 표시 순서 그대로(1,2,3…) 배정해 「픽스처 조건 미달」이 정말 우는지 본다.
 *  한 번도 울지 않는 검출기는 옳다는 증거가 없다 — 그것이 '잘못된 초록' 의 전형이다.
 *  (state 에는 _no 가 안 나가므로 이 주입은 대조 결과를 바꾸지 않는다 — 조건 줄만 늘어난다.) */
const INJECT_NOSCRAMBLE = process.env.TC_TEST_INJECT_NOSCRAMBLE === '1';

function scrambledNos(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(i + 1);
  if (INJECT_NOSCRAMBLE) return a;             // 주입: 표시 순서 = _no 오름차순
  let seed = 0x5eed ^ n;                       // n 을 섞어 표 크기마다 다른 배치가 나오게
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = a.length - 1; i > 0; i--) {     // Fisher-Yates(결정적)
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  // 우연히 오름차순·내림차순이 되면 한 쌍을 바꿔 깨뜨린다(작은 n 에서 실제로 일어난다).
  const asc = a.every((v, i) => i === 0 || a[i - 1] < v);
  const desc = a.every((v, i) => i === 0 || a[i - 1] > v);
  if ((asc || desc) && a.length >= 2) { const t = a[0]; a[0] = a[1]; a[1] = t; }
  return a;
}
/** 표시 순서가 _no 의 ASC·DESC 어느 쪽으로도 재현되지 않는가(픽스처 자격). */
function nosAreScrambled(nos) {
  if (!Array.isArray(nos) || nos.length < 3) return false;
  const asc = nos.every((v, i) => i === 0 || nos[i - 1] < v);
  const desc = nos.every((v, i) => i === 0 || nos[i - 1] > v);
  return !asc && !desc;
}

/** ★ '저장소를 쓰는 과제인가' 를 XML 기준 객체에서 판정한다 — cal_category.uses_repo 의 근거.
 *  이 한 함수가 **두 자리에서 함께** 쓰인다. 갈라 놓으면 두 규칙이 생기고, 그 순간 이 게이트는
 *  자기가 넣은 값을 자기가 다시 계산해 맞춰 보는 시늉만 하게 된다:
 *    ① loadFixtureIntoDb()  — DB 에 넣을 값(= 이관 도구가 할 일. 계약 I-1)
 *    ② normalizeExpected()  — 기준(fromXML) 쪽에 얹을 값(= 계약 G-0 의 의도된 예외)
 *  ★ 그래서 이 대조가 증명하는 것은 **'어댑터가 DB 의 그 비트를 앱까지 손실 없이 나르는가'** 이지
 *    '이관 규칙이 옳은가' 가 아니다. 후자는 §8 왕복 대조의 몫도 아니다(toXML 이 이 키를 안 쓴다) —
 *    이관 도구의 자체 리포트가 세어서 사람에게 보고해야 한다. 요약에 그 사실을 찍는다. */
const usesRepoOf = (c) => !!((c && c.gitRepo) || (c && c.svnRepo));

/** expected 객체를 복제 DB 에 적재하고, 적재에 쓴 부수 정보를 돌려준다. */
function loadFixtureIntoDb(exp, userId) {
  const S = [];
  S.push('SET NAMES utf8mb4;');
  S.push("SET SESSION time_zone='+00:00';");
  S.push('SET SESSION innodb_lock_wait_timeout=5;');
  const U = String(userId);

  // ① 이 사용자의 cal_* 를 비운다(자식 먼저). 다른 사용자 행은 건드리지 않는다.
  for (const tbl of ['cal_todo_day_note', 'cal_entry_commit', 'cal_entry_except', 'cal_task_hours',
    'cal_entry', 'cal_todo', 'cal_category', 'cal_room', 'cal_attendance', 'cal_user_pref']) {
    S.push(`DELETE FROM ${tbl} WHERE user_id=${U};`);
  }

  // ② 과제 — sort_order = 표시 순서, cat_no = 역순(어긋나게)
  const catNos = scrambledNos(exp.categories.length);
  const uidToNo = new Map();
  const localRepos = {};   // G-6: gitRepo·svnRepo 는 DB 에 없다 — 로컬 저장소 몫이다
  exp.categories.forEach((c, i) => {
    const no = catNos[i];
    uidToNo.set(c.id, no);
    const src = (Object.prototype.hasOwnProperty.call(c, 'source') && c.source === 'db') ? 'db' : 'local';
    const projUid = src === 'db' ? String(c.id).slice(3) : null;
    localRepos[c.id] = { gitRepo: c.gitRepo || '', svnRepo: c.svnRepo || '' };
    // ★ uses_repo — '저장소를 쓰는 과제인가' 한 비트(§4 · schema_version 5). **경로가 아니다.**
    //   여기서 채우는 규칙이 곧 이관 도구가 할 일이다(계약 I-1): XML 의 gitRepo·svnRepo 중
    //   하나라도 비어 있지 않으면 1. 이관 시점에 존재하는 증거는 그것뿐이다(한 PC 의 data.xml 하나).
    //   ※ DEFAULT 0 에 맡기면 전 행이 0 이 되어 §4 의 안내가 아무 데도 안 뜬다 — sort_order 와 같은 함정이다.
    const usesRepo = usesRepoOf(c) ? 1 : 0;
    S.push(`INSERT INTO cal_category (user_id,cat_no,uid,source,name,color,description,project_uid,uses_repo,sort_order,created_at,updated_at) VALUES (` +
      `${U},${no},${q(c.id)},${q(src)},${q(c.name)},${q(c.color)},${q(c.desc)},${q(projUid)},${usesRepo},${i},` +
      `${q(isoToDt(c.createdAt, `category[${c.id}].createdAt`))},${q(isoToDt(c.createdAt, 'x'))});`);
  });

  // ③ 일정 — sort_order = 문서 순서(배열 인덱스), entry_no = 역순(어긋나게).
  //    ★ sort_order 를 배열 인덱스로 채우는 것이 곧 이관 도구가 할 일이다(어댑터 계약 C/E).
  //      여기서 안 채우면 컬럼 DEFAULT 0 이 조용히 먹고 전 행이 동률이 된다 — 그게 계약 E 가
  //      경고하는 바로 그 상태이고, 이 적재기는 그 실패를 예행하는 자리가 아니라 정상 이관을
  //      재현하는 자리다. entry_no 를 역순으로 두는 것은 '번호가 순서와 무관함'을 시험하기 위함이다.
  const entNos = scrambledNos(exp.entries.length);
  const entUidToNo = new Map();
  exp.entries.forEach((e, i) => {
    const no = entNos[i];
    entUidToNo.set(e.id, no);
    const catNo = e.categoryId == null ? null : uidToNo.get(e.categoryId);
    if (e.categoryId != null && catNo === undefined) {
      violate('FIX', `픽스처의 일정이 없는 과제를 가리킨다(FK 로 적재가 막힌다): entry ${e.id} → ${e.categoryId}`);
    }
    const r = e.recur;
    S.push(`INSERT INTO cal_entry (user_id,entry_no,uid,cat_no,entry_date,end_date,all_day,start_time,end_time,` +
      `title,memo,source,location,remind,recur_freq,recur_interval,recur_until,recur_count,sort_order,created_at,updated_at) VALUES (` +
      `${U},${no},${q(e.id)},${catNo == null ? 'NULL' : catNo},${q(e.date)},${e.endDate ? q(e.endDate) : 'NULL'},` +
      `${e.allDay ? 1 : 0},${e.startTime ? q(e.startTime) : 'NULL'},${e.endTime ? q(e.endTime) : 'NULL'},` +
      `${q(e.title)},${q(e.memo)},${q(e.source)},${q(e.location)},${e.remind == null ? 'NULL' : num(e.remind)},` +
      `${r ? q(r.freq) : 'NULL'},${r ? num(r.interval) : 'NULL'},${r && r.until ? q(r.until) : 'NULL'},${r ? num(r.count) : 'NULL'},${i},` +
      `${q(isoToDt(e.createdAt, `entry[${e.id}].createdAt`))},${q(isoToDt(e.updatedAt, `entry[${e.id}].updatedAt`))});`);
    for (const d of (e.recurExcept || [])) {
      S.push(`INSERT INTO cal_entry_except (user_id,entry_no,except_date) VALUES (${U},${no},${q(d)});`);
    }
    // ★ 커밋을 적재한다 — G-7 개정(2026-09-01) 뒤로는 **부팅이 이것을 실어 와야** 한다.
    //   DB 에 있는 커밋이 state 에 그대로(순서까지) 오는지가 그 계약의 시험이다.
    (e.commits || []).forEach((c, s) => {
      S.push(`INSERT INTO cal_entry_commit (user_id,entry_no,seq,hash,short_hash,commit_time,subject,body) VALUES (` +
        `${U},${no},${s},${q(c.hash)},${q(c.short)},${c.time ? q(c.time) : 'NULL'},${q(c.subject)},${q(c.body)});`);
    });
  });

  // ④ 할 일 — sort_order = 문서 순서(배열 인덱스), todo_no = 역순. 위 ③ 의 ★ 와 같은 계약이다.
  const todoNos = scrambledNos(exp.todos.length);
  const todoUidToNo = new Map();
  exp.todos.forEach((t, i) => {
    const no = todoNos[i];
    todoUidToNo.set(t.id, no);
    const catNo = t.categoryId == null ? null : uidToNo.get(t.categoryId);
    if (t.categoryId != null && catNo === undefined) {
      violate('FIX', `픽스처의 할 일이 없는 과제를 가리킨다: todo ${t.id} → ${t.categoryId}`);
    }
    S.push(`INSERT INTO cal_todo (user_id,todo_no,uid,cat_no,todo_text,note,due,end_date,done,prio,completed_at,sort_order,created_at,updated_at) VALUES (` +
      `${U},${no},${q(t.id)},${catNo == null ? 'NULL' : catNo},${q(t.text)},${q(t.note)},` +
      `${t.due ? q(t.due) : 'NULL'},${t.endDate ? q(t.endDate) : 'NULL'},${t.done ? 1 : 0},${q(t.prio)},` +
      `${t.completedAt ? q(isoToDt(t.completedAt, `todo[${t.id}].completedAt`)) : 'NULL'},${i},` +
      `${q(isoToDt(t.createdAt, `todo[${t.id}].createdAt`))},${q(isoToDt(t.updatedAt, `todo[${t.id}].updatedAt`))});`);
    for (const [d, v] of Object.entries(t.dayNotes || {})) {
      S.push(`INSERT INTO cal_todo_day_note (user_id,todo_no,note_date,note_text) VALUES (${U},${no},${q(d)},${q(v)});`);
    }
  });

  // ⑤ 회의실 — sort_order = 표시 순서(PK 는 name 이라, ORDER BY 를 빠뜨리면 이름순으로 나온다)
  exp.rooms.forEach((r, i) => {
    S.push(`INSERT INTO cal_room (user_id,name,sort_order) VALUES (${U},${q(r)},${i});`);
  });

  // ⑥ 과제별 공수 — 2단 맵 → 행. 안쪽 키는 과제 uid 다(G-1).
  const NOW = '2026-05-30 00:00:00.000';
  for (const [date, m] of Object.entries(exp.taskHours || {})) {
    for (const [catUid, h] of Object.entries(m)) {
      const catNo = uidToNo.get(catUid);
      if (catNo === undefined) { violate('FIX', `픽스처의 taskHours 가 없는 과제를 가리킨다: ${date}/${catUid}`); continue; }
      S.push(`INSERT INTO cal_task_hours (user_id,work_date,cat_no,hours,updated_at) VALUES (${U},${q(date)},${catNo},${num(h)},${q(NOW)});`);
    }
  }

  // ⑦ 근태 — 행이 없는 날짜가 곧 '미기록' 이다(G-5). 무효 코드는 픽스처 자격 실격.
  for (const [date, a] of Object.entries(exp.attendance || {})) {
    if (!ATTEND_OK.has(String(a.status))) {
      violate('FIX', `픽스처의 근태 코드가 CHECK 목록에 없다: ${date} status=${a.status}`); continue;
    }
    S.push(`INSERT INTO cal_attendance (user_id,work_date,status,overtime,updated_at) VALUES (${U},${q(date)},${q(a.status)},${num(a.overtime)},${q(NOW)});`);
  }

  // ⑧ 사용자 설정 — 전역 3값 + daily/weekly 6값 + 폰트 2값 + 작성자 2값
  const rf = exp.reportFormatPrefs || { daily: {}, weekly: {} };
  const fo = exp.reportFont || { family: '', size: 0 };
  S.push(`INSERT INTO cal_user_pref (user_id,git_author,svn_author,report_marker,report_marker_custom,report_indent,` +
    `git_commit_body,report_marker_daily,report_marker_custom_daily,report_indent_daily,` +
    `report_marker_weekly,report_marker_custom_weekly,report_indent_weekly,report_font_family,report_font_size,updated_at) VALUES (` +
    `${U},${q(exp.gitAuthor)},${q(exp.svnAuthor)},${q(exp.reportMarker)},${q(exp.reportMarkerCustom)},${num(exp.reportIndent)},` +
    `${exp.gitCommitBody ? 1 : 0},${q(rf.daily.marker)},${q(rf.daily.markerCustom)},${num(rf.daily.indent)},` +
    `${q(rf.weekly.marker)},${q(rf.weekly.markerCustom)},${num(rf.weekly.indent)},${q(fo.family)},${num(fo.size)},${q(NOW)});`);

  const sql = S.join('\n');
  const r = mysqlRun(sql, { db: CLONE, what: '픽스처 적재' });
  if (!r.ok) {
    if (isEnvErrno(r.errno)) envFail(`픽스처 적재 중 환경 오류 errno=${r.errno}`, cleanErr(r.err));
    envFail(`픽스처 적재 실패 errno=${r.errno} — 픽스처가 스키마 제약을 어겼다(테스트 자신의 결함이다)`,
      cleanErr(r.err) + ' | SQL 조각: ' + (sql.split('\n').find((x) => /INSERT/.test(x)) || '').slice(0, 200));
  }
  return { uidToNo, entUidToNo, todoUidToNo, localRepos, sql };
}

/** 적재 검산 — 넣은 것이 실제로 들어갔나. "에러가 안 났다"는 증거가 아니다. */
function verifyLoaded(exp, userId, maps) {
  const U = String(userId);
  const b = batch([
    { key: 'cat', sql: `SELECT COUNT(*) FROM cal_category WHERE user_id=${U}` },
    { key: 'ent', sql: `SELECT COUNT(*) FROM cal_entry WHERE user_id=${U}` },
    { key: 'exc', sql: `SELECT COUNT(*) FROM cal_entry_except WHERE user_id=${U}` },
    { key: 'cmt', sql: `SELECT COUNT(*) FROM cal_entry_commit WHERE user_id=${U}` },
    { key: 'todo', sql: `SELECT COUNT(*) FROM cal_todo WHERE user_id=${U}` },
    { key: 'dn', sql: `SELECT COUNT(*) FROM cal_todo_day_note WHERE user_id=${U}` },
    { key: 'room', sql: `SELECT COUNT(*) FROM cal_room WHERE user_id=${U}` },
    { key: 'th', sql: `SELECT COUNT(*) FROM cal_task_hours WHERE user_id=${U}` },
    { key: 'att', sql: `SELECT COUNT(*) FROM cal_attendance WHERE user_id=${U}` },
    { key: 'pref', sql: `SELECT COUNT(*) FROM cal_user_pref WHERE user_id=${U}` },
    // ★ GROUP_CONCAT 을 쓰지 않는다 — group_concat_max_len(기본 1024B)에 걸리면 **조용히 잘려**
    //   픽스처 조건 판정이 뒤집힌다(잘린 앞부분만 보고 '어긋나 있다'고 오판한다). 행으로 받는다.
    { key: 'catnos', sql: `SELECT cat_no FROM cal_category WHERE user_id=${U} ORDER BY sort_order` },
    { key: 'entnos', sql: `SELECT entry_no FROM cal_entry WHERE user_id=${U} ORDER BY sort_order` },
    { key: 'todonos', sql: `SELECT todo_no FROM cal_todo WHERE user_id=${U} ORDER BY sort_order` },
    { key: 'roomsort', sql: `SELECT name FROM cal_room WHERE user_id=${U} ORDER BY sort_order` },
    { key: 'roomname', sql: `SELECT name FROM cal_room WHERE user_id=${U} ORDER BY name` },
    { key: 'roomnamedesc', sql: `SELECT name FROM cal_room WHERE user_id=${U} ORDER BY name DESC` },
  ], { what: '적재 검산' });
  const n = (k) => Number((b.get(k)[0] || ['0'])[0]);
  const want = {
    cat: exp.categories.length,
    ent: exp.entries.length,
    exc: exp.entries.reduce((a, e) => a + (e.recurExcept || []).length, 0),
    cmt: exp.entries.reduce((a, e) => a + (e.commits || []).length, 0),
    todo: exp.todos.length,
    dn: exp.todos.reduce((a, t) => a + Object.keys(t.dayNotes || {}).length, 0),
    room: exp.rooms.length,
    th: Object.values(exp.taskHours || {}).reduce((a, m) => a + Object.keys(m).length, 0),
    att: Object.keys(exp.attendance || {}).length,
    pref: 1,
  };
  let bad = 0;
  for (const [k, v] of Object.entries(want)) {
    if (n(k) !== v) { violate('LOAD', `적재 검산 불일치 — ${k}: DB ${n(k)}행 ≠ 기준 ${v}행`); bad++; }
  }
  if (!bad) ok(`적재 검산 통과 — ${Object.entries(want).map(([k, v]) => `${k}:${v}`).join(' · ')}`);

  /* ── 픽스처 조건 — '이 픽스처가 그 결함을 만들 수 있는 모양인가' ──────────────
   * ★ 여기서 찍히는 줄은 **검사 결과가 아니라 검사의 한계**다. 요약에 그대로 남고,
   *   요약의 「픽스처 조건」 블록이 어느 픽스처가 그 자리를 덮었는지까지 대조한다.
   * ★ 조건은 ASC 만이 아니라 **ASC·DESC 둘 다** 본다. 2026-08-27 실측: `_no` 를 완전 역순으로
   *   배정했더니 계약 G-5 가 금지한 `ORDER BY <표>_no DESC` 어댑터가 real·synth 양쪽에서
   *   초록으로 통과했다. ASC 만 보는 조건은 그 사고를 그대로 통과시킨다. */
  const seqOf = (k) => (b.get(k) || []).map((r) => r[0]);
  const catNoSeq = seqOf('catnos');
  for (const [key, what, n] of [
    ['catnos', 'categories', exp.categories.length],
    ['entnos', 'entries', exp.entries.length],
    ['todonos', 'todos', exp.todos.length],
  ]) {
    const seq = seqOf(key).map(Number);
    if (n <= 1 || nosAreScrambled(seq)) continue;
    const why = seq.length < 3
      ? `${seq.length}건뿐이라 오름·내림 둘 다 깨는 배치가 존재하지 않는다`
      : `표시 순서가 _no 의 ${seq.every((v, i) => i === 0 || seq[i - 1] < v) ? '오름' : '내림'}차순으로 그대로 재현된다(${seq.join(',')})`;
    note(`[${curPhase}] 픽스처 조건 미달 — ${what}: ${why} — 이 픽스처로는 ${what} 의 ORDER BY 누락(및 계약이 금지한 _no 정렬키)을 검출할 수 없다`);
  }
  // 회의실은 _no 가 없다 — PK 가 name 이라, ORDER BY 를 빠뜨리면 **이름순**으로 나온다.
  const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  const roomBySort = seqOf('roomsort');
  if (exp.rooms.length > 1) {
    if (same(roomBySort, seqOf('roomname'))) {
      note(`[${curPhase}] 픽스처 조건 미달 — rooms 의 표시 순서 = 이름 순서라 이 픽스처로는 rooms ORDER BY 누락을 검출할 수 없다`);
    } else if (same(roomBySort, seqOf('roomnamedesc'))) {
      note(`[${curPhase}] 픽스처 조건 미달(절반) — rooms 의 표시 순서 = 이름 **역순**이라 이 픽스처로는 'ORDER BY name DESC' 를 쓴 어댑터를 검출할 수 없다`);
    }
  }
  return { catNoSeq };
}

/* ────────────────────────────── 8. 어댑터 프로브 ──────────────────────────────
 * widget/CalendarDb.cs 를 **소스째** 컴파일해 리플렉션으로 부팅 조회를 부른다.
 * DeployConfig 는 복제 DB 를 가리키는 대체본으로 갈아끼운다(실 DB 로 갈 수 없다).
 * ★ 이 테스트는 어댑터를 구현하지 않는다 — 있는 것을 시험할 뿐이다. 없으면 exit 2. */

const PROBE_BEGIN = '__PROBE_BEGIN__', PROBE_END = '__PROBE_END__', PROBE_META = '__PROBE_META__';

const PROBE_PROGRAM_CS = String.raw`
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace TaskCalendarWidget
{
    //  ★ 컴파일 전용 대역 — UserSession.cs 가 Dpapi 를 참조하는데 그 클래스는 NetcusService.cs
    //    안에 있고, 그 파일을 링크하면 WebView2 의존이 통째로 딸려온다(프로브는 net9.0 콘솔이다).
    //    이 프로브는 세션 경로를 타지 않는다. ★ 그래도 불리면 검사가 거짓이 되므로 즉시 터뜨린다.
    internal static class Dpapi
    {
        public static byte[] Protect(byte[] b) => throw new InvalidOperationException("프로브 대역이 불렸다");
        public static byte[] Unprotect(byte[] b) => throw new InvalidOperationException("프로브 대역이 불렸다");
    }
}

internal static class TcProbeMain
{
    static readonly List<string> Logs = new List<string>();

    // 반환형이 state JSON 을 실어 나르는가 — string, 또는 string 프로퍼티(StateJson/…Json)를 가진 객체.
    static Type Unwrap(Type rt)
    {
        if (rt != null && rt.IsGenericType && rt.GetGenericTypeDefinition() == typeof(Task<>)) return rt.GetGenericArguments()[0];
        return rt;
    }
    static PropertyInfo StateProp(Type t)
    {
        if (t == null || t == typeof(string)) return null;
        var p = t.GetProperty("StateJson", BindingFlags.Public | BindingFlags.Instance);
        if (p != null && p.PropertyType == typeof(string)) return p;
        return t.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .FirstOrDefault(x => x.PropertyType == typeof(string) && x.Name.EndsWith("Json", StringComparison.OrdinalIgnoreCase));
    }
    static bool Carries(Type rt) { var u = Unwrap(rt); return u == typeof(string) || StateProp(u) != null; }

    // 이름 점수 — 부팅 조회로 보이는 정도. 0 이면 후보가 아니다.
    static int Score(MethodInfo m)
    {
        var n = m.Name.ToLowerInvariant();
        int s = 0;
        if (n.Contains("snapshot")) s += 4;
        if (n.Contains("boot")) s += 4;
        if (n.Contains("state")) s += 3;
        if (n.Contains("calendar")) s += 1;
        if (n.Contains("load")) s += 1;
        if (n.Contains("commit")) s -= 6;      // 커밋 지연 조회(G-7)는 부팅 조회가 아니다
        if (n.Contains("member") || n.Contains("user") || n.Contains("catalog")) s -= 4;
        return s;
    }

    static object BuildRepoDict(Type target, Dictionary<string, Dictionary<string, string>> src)
    {
        Type[] ga = null;
        if (target.IsGenericType)
        {
            var gd = target.GetGenericTypeDefinition();
            if (gd == typeof(IReadOnlyDictionary<,>) || gd == typeof(IDictionary<,>) || gd == typeof(Dictionary<,>))
                ga = target.GetGenericArguments();
        }
        if (ga == null || ga[0] != typeof(string)) return null;
        Type V = ga[1];
        var dictType = typeof(Dictionary<,>).MakeGenericType(typeof(string), V);
        var dict = Activator.CreateInstance(dictType);
        var add = dictType.GetMethod("Add", new[] { typeof(string), V });
        foreach (var kv in src)
        {
            string git = kv.Value != null && kv.Value.ContainsKey("gitRepo") ? (kv.Value["gitRepo"] ?? "") : "";
            string svn = kv.Value != null && kv.Value.ContainsKey("svnRepo") ? (kv.Value["svnRepo"] ?? "") : "";
            object val;
            if (V == typeof(string)) val = git;
            else if (V.IsGenericType && V.GetGenericTypeDefinition() == typeof(ValueTuple<,>))
            {
                val = Activator.CreateInstance(V);
                V.GetField("Item1").SetValue(val, git);
                V.GetField("Item2").SetValue(val, svn);
            }
            else if (V == typeof(Dictionary<string, string>) || V == typeof(IDictionary<string, string>) || V == typeof(IReadOnlyDictionary<string, string>))
                val = new Dictionary<string, string> { { "gitRepo", git }, { "svnRepo", svn } };
            else if (V.IsGenericType && V.GetGenericTypeDefinition() == typeof(Tuple<,>))
                val = Activator.CreateInstance(V, git, svn);
            else return null;
            add.Invoke(dict, new object[] { kv.Key, val });
        }
        return dict;
    }

    static int Fail(string msg, int code)
    {
        Console.Error.WriteLine("PROBE-FAIL: " + msg);
        if (Logs.Count > 0)
        {
            Console.Error.WriteLine("--- 어댑터 로그 ---");
            foreach (var l in Logs) Console.Error.WriteLine("  " + l);
        }
        return code;
    }

    static int Main(string[] argv)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        string loginId = argv.Length > 0 ? argv[0] : "";
        string repoJsonPath = argv.Length > 1 ? argv[1] : "";
        string repoJson = (repoJsonPath.Length > 0 && File.Exists(repoJsonPath)) ? File.ReadAllText(repoJsonPath, Encoding.UTF8) : "{}";
        Dictionary<string, Dictionary<string, string>> repos;
        try { repos = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(repoJson) ?? new Dictionary<string, Dictionary<string, string>>(); }
        catch { repos = new Dictionary<string, Dictionary<string, string>>(); }

        var asm = typeof(TcProbeMain).Assembly;
        Type[] types;
        try { types = asm.GetTypes(); }
        catch (ReflectionTypeLoadException ex) { types = ex.Types.Where(t => t != null).ToArray(); }

        var t = types.FirstOrDefault(x => x.Name == "CalendarDb");
        if (t == null)
            return Fail("CalendarDb 타입을 찾지 못했습니다(컴파일된 타입: " + string.Join(", ", types.Select(x => x.Name).Take(20)) + ")", 3);

        var flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static;
        var all = t.GetMethods(flags).Where(m => m.DeclaringType == t).ToList();
        var cands = all.Where(m => Score(m) > 0 && Carries(m.ReturnType) &&
                                   m.GetParameters().Any(p => p.ParameterType == typeof(string)))
                       .OrderByDescending(Score).ThenByDescending(m => m.GetParameters().Length).ToList();
        if (cands.Count == 0)
            return Fail("CalendarDb 에 부팅 조회 후보 메서드가 없습니다(계약: state JSON 을 실어 나르는 반환형 + loginId 문자열 인자). 있는 메서드: " +
                string.Join(" | ", all.Select(m => m.ReturnType.Name + " " + m.Name + "(" +
                    string.Join(",", m.GetParameters().Select(p => p.ParameterType.Name)) + ")")), 3);

        object inst = null;
        Exception ctorErr = null;
        if (!cands[0].IsStatic)
        {
            Action<string> logSink = s => { lock (Logs) Logs.Add(s); };
            foreach (var c in t.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                               .OrderByDescending(c => c.GetParameters().Count(p => p.ParameterType == typeof(Action<string>))))
            {
                try
                {
                    var ps = c.GetParameters();
                    var args = new object[ps.Length];
                    for (int i = 0; i < ps.Length; i++)
                    {
                        var pt = ps[i].ParameterType;
                        if (pt == typeof(Action<string>)) args[i] = logSink;
                        else if (pt == typeof(string)) args[i] = Path.GetTempPath();
                        else if (pt.IsValueType) args[i] = Activator.CreateInstance(pt);
                        else args[i] = null;
                    }
                    inst = c.Invoke(args);
                    break;
                }
                catch (Exception e) { ctorErr = e; }
            }
            if (inst == null) return Fail("CalendarDb 인스턴스를 만들지 못했습니다: " + (ctorErr == null ? "생성자 없음" : ctorErr.ToString()), 3);
        }

        var tried = new List<string>();
        foreach (var m in cands)
        {
            var ps = m.GetParameters();
            var args = new object[ps.Length];
            bool okBind = true, tookRepos = false, sawLogin = false;
            for (int i = 0; i < ps.Length; i++)
            {
                var pt = ps[i].ParameterType;
                if (pt == typeof(CancellationToken)) { args[i] = CancellationToken.None; continue; }
                if (pt == typeof(string) && !sawLogin) { args[i] = loginId; sawLogin = true; continue; }
                var d = BuildRepoDict(pt, repos);
                if (d != null) { args[i] = d; tookRepos = true; continue; }
                if (pt == typeof(string)) { args[i] = repoJson; tookRepos = true; continue; }
                if (ps[i].HasDefaultValue) { args[i] = ps[i].DefaultValue; continue; }
                if (!pt.IsValueType) { args[i] = null; continue; }
                okBind = false; break;
            }
            if (!okBind || !sawLogin)
            {
                tried.Add(m.Name + "(" + string.Join(",", ps.Select(p => p.ParameterType.Name)) + ") — 인자 바인딩 실패");
                continue;
            }

            object raw;
            try { raw = m.Invoke(m.IsStatic ? null : inst, args); }
            catch (TargetInvocationException tie) { return Fail(m.Name + " 호출이 예외로 끝났습니다:\n" + (tie.InnerException ?? tie).ToString(), 4); }
            catch (Exception e) { return Fail(m.Name + " 호출 실패:\n" + e.ToString(), 4); }

            object result = raw;
            try
            {
                if (raw is Task task)
                {
                    task.GetAwaiter().GetResult();
                    var rp = raw.GetType().GetProperty("Result");
                    result = rp == null ? null : rp.GetValue(raw);
                }
            }
            catch (Exception e) { return Fail(m.Name + " 의 Task 가 예외로 끝났습니다:\n" + e.ToString(), 4); }

            if (result == null)
                return Fail(m.Name + " 이 null 을 돌려줬습니다 — 어댑터는 이것을 '오프라인/조회 실패'로 씁니다. " +
                            "복제 DB 접속(계정 권한 포함)을 확인하세요.", 5);

            string json;
            if (result is string s0) json = s0;
            else
            {
                var pi = StateProp(result.GetType());
                if (pi == null) return Fail(m.Name + " 의 반환 객체(" + result.GetType().Name + ")에서 state JSON 프로퍼티를 찾지 못했습니다", 3);
                json = (string)pi.GetValue(result);
                if (json == null) return Fail(m.Name + " 의 " + pi.Name + " 이 null 입니다", 5);
            }

            var meta = new Dictionary<string, object> {
                ["type"] = t.FullName, ["method"] = m.Name,
                ["params"] = string.Join(",", ps.Select(p => p.ParameterType.Name)),
                ["returns"] = m.ReturnType.Name, ["localRepos"] = tookRepos, ["logs"] = Logs.Count };
            Console.Out.WriteLine("__PROBE_META__" + JsonSerializer.Serialize(meta));
            foreach (var l in Logs) Console.Error.WriteLine("[어댑터 로그] " + l);
            Console.Out.WriteLine("__PROBE_BEGIN__");
            Console.Out.WriteLine(json);
            Console.Out.WriteLine("__PROBE_END__");
            Console.Out.Flush();
            return 0;
        }
        return Fail("후보 메서드는 있으나 인자를 맞출 수 없습니다: " + string.Join(" | ", tried), 3);
    }
}
`;

/* ★ 내장 참조 어댑터 — **테스트 전용**이다. widget/ 에 두지 않고 임시 디렉터리에만 만든다.
 *   loop-org-compat.mjs 의 '내장 참조 DDL' 과 같은 자리: 대상이 아직 없을 때 하네스 자신이
 *   맞는지(픽스처 SQL·비교기·검출기)를 증명하기 위한 대조본이다. 계약 G 를 그대로 따른다. */
const REFERENCE_ADAPTER_CS = String.raw`
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MySqlConnector;

namespace TaskCalendarWidget
{
    // ★ 테스트 전용 참조 어댑터(계약 G). 배포물이 아니다.
    internal sealed class CalendarDb
    {
        private static string BuildConnString() =>
            new MySqlConnectionStringBuilder {
                Server = DeployConfig.DbHost, Port = (uint)DeployConfig.DbPort,
                Database = DeployConfig.DbName, UserID = DeployConfig.DbUser, Password = DeployConfig.DbPassword,
                ConnectionTimeout = 4, DefaultCommandTimeout = 8, Pooling = false,
            }.ConnectionString;

        private static async Task Exec(MySqlConnection c, string sql, CancellationToken ct)
        { using var cmd = new MySqlCommand(sql, c); await cmd.ExecuteNonQueryAsync(ct); }

        // ISO 'Z' 3자리 고정(G-3) · TIME 은 HH:mm(G-1) · DATE 는 yyyy-MM-dd
        private const string ISO = "CONCAT(DATE_FORMAT({0},'%Y-%m-%dT%H:%i:%s.'), LPAD(FLOOR(MICROSECOND({0})/1000),3,'0'), 'Z')";
        private static string Iso(string col) => string.Format(ISO, col);

        private static string S(MySqlDataReader r, string n) { int i = r.GetOrdinal(n); return r.IsDBNull(i) ? "" : r.GetString(i); }
        private static string SN(MySqlDataReader r, string n) { int i = r.GetOrdinal(n); return r.IsDBNull(i) ? null : r.GetString(i); }
        private static int I(MySqlDataReader r, string n) { int i = r.GetOrdinal(n); return r.IsDBNull(i) ? 0 : Convert.ToInt32(r.GetValue(i)); }
        private static int? IN(MySqlDataReader r, string n) { int i = r.GetOrdinal(n); return r.IsDBNull(i) ? (int?)null : Convert.ToInt32(r.GetValue(i)); }
        private static bool B(MySqlDataReader r, string n) { int i = r.GetOrdinal(n); return !r.IsDBNull(i) && Convert.ToInt32(r.GetValue(i)) != 0; }

        public async Task<string> LoadBootSnapshotJsonAsync(string loginId, string localRepoJson, CancellationToken ct)
        {
            var repos = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
            if (!string.IsNullOrWhiteSpace(localRepoJson))
            {
                try { repos = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(localRepoJson)
                             ?? new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal); }
                catch { }
            }
            string Repo(string uid, string key)
            {
                Dictionary<string, string> d;
                if (repos != null && repos.TryGetValue(uid, out d) && d != null && d.TryGetValue(key, out var v)) return v ?? "";
                return "";
            }

            await using var conn = new MySqlConnection(BuildConnString());
            await conn.OpenAsync(ct);

            // ── 접속 프리앰블(§3.6) — 읽기 연결이므로 격리는 REPEATABLE-READ(§3.2·§3.5) ──
            await Exec(conn, "SET SESSION innodb_lock_wait_timeout=5", ct);
            await Exec(conn, "SET SESSION time_zone='+00:00'", ct);
            await Exec(conn, "SET SESSION transaction_isolation='REPEATABLE-READ'", ct);
            using (var vc = new MySqlCommand("SELECT v FROM cal_schema_meta WHERE k='schema_version'", conn))
                { var v = await vc.ExecuteScalarAsync(ct); if (v == null) throw new Exception("cal_schema_meta 가 비어 있습니다"); }

            int userId;
            using (var uc = new MySqlCommand("SELECT user_id FROM app_user WHERE login_id=@id", conn))
            {
                uc.Parameters.AddWithValue("@id", loginId);
                var v = await uc.ExecuteScalarAsync(ct);
                // ★ 0행이면 app_user 에 없는 사람이다 — user_id 를 만들어 내지 않는다(§3.6)
                if (v == null) throw new Exception("app_user 에 없는 사용자입니다: " + loginId);
                userId = Convert.ToInt32(v);
            }

            var cats = new List<Dictionary<string, object>>();
            var catNoToUid = new Dictionary<int, string>();
            var entries = new List<Dictionary<string, object>>();
            var entryNoToObj = new Dictionary<int, Dictionary<string, object>>();
            var todos = new List<Dictionary<string, object>>();
            var todoNoToObj = new Dictionary<int, Dictionary<string, object>>();
            var rooms = new List<string>();
            var taskHours = new Dictionary<string, Dictionary<string, double>>();
            var attendance = new Dictionary<string, object>();
            Dictionary<string, object> pref = null;
            var prefFmt = new Dictionary<string, object>();
            var font = new Dictionary<string, object>();

            // ── 부팅 조회는 단일 트랜잭션 · 10개 표(§3.5). cal_entry_commit **포함**(G-7 개정 2026-09-01) ──
            await Exec(conn, "START TRANSACTION WITH CONSISTENT SNAPSHOT", ct);
            try
            {
                // ① cal_category — ORDER BY sort_order(G-5). dbGone 은 LEFT JOIN project 파생(G-6)
                using (var cmd = new MySqlCommand(
                    "SELECT c.cat_no, c.uid, c.source, c.name, c.color, c.description, c.uses_repo, " + Iso("c.created_at") + " AS created_at, " +
                    "(p.uid IS NULL) AS db_gone FROM cal_category c LEFT JOIN project p ON p.uid = c.project_uid " +
                    "WHERE c.user_id=@u ORDER BY c.sort_order", conn))
                {
                    cmd.Parameters.AddWithValue("@u", userId);
                    using var rd = (MySqlDataReader)await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct))
                    {
                        int no = I(rd, "cat_no"); string uid = S(rd, "uid");
                        catNoToUid[no] = uid;
                        var o = new Dictionary<string, object>();
                        o["id"] = uid;                                   // G-1: uid → id (번호가 아니다)
                        o["name"] = S(rd, "name");
                        o["color"] = S(rd, "color");
                        o["desc"] = S(rd, "description");                // G-1: description → desc
                        o["gitRepo"] = Repo(uid, "gitRepo");             // G-6: 로컬 저장소에서 채운다
                        o["svnRepo"] = Repo(uid, "svnRepo");
                        o["usesRepo"] = B(rd, "uses_repo");              // G-6: DB 에만 있다(위 둘의 거울). 경로에서 파생하지 않는다
                        o["createdAt"] = S(rd, "created_at");            // G-3
                        if (S(rd, "source") == "db") { o["source"] = "db"; o["dbGone"] = B(rd, "db_gone"); }
                        // ★ 개인 과제에는 source·dbGone 키를 만들지 않는다(G-6)
                        cats.Add(o);
                    }
                }
                // ② cal_entry — ORDER BY sort_order, uid (G-5 · 2026-08-27 확정값)
                using (var cmd = new MySqlCommand(
                    "SELECT entry_no, uid, cat_no, DATE_FORMAT(entry_date,'%Y-%m-%d') AS entry_date, " +
                    "DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date, all_day, " +
                    "TIME_FORMAT(start_time,'%H:%i') AS start_time, TIME_FORMAT(end_time,'%H:%i') AS end_time, " +
                    "title, memo, source, location, remind, recur_freq, recur_interval, recur_until, recur_count, " +
                    Iso("created_at") + " AS created_at, " + Iso("updated_at") + " AS updated_at " +
                    "FROM cal_entry WHERE user_id=@u ORDER BY sort_order, uid", conn))
                {
                    cmd.Parameters.AddWithValue("@u", userId);
                    using var rd = (MySqlDataReader)await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct))
                    {
                        int no = I(rd, "entry_no");
                        var o = new Dictionary<string, object>();
                        int? cn = IN(rd, "cat_no");
                        o["id"] = S(rd, "uid");
                        o["date"] = S(rd, "entry_date");                                  // G-1: entry_date → date
                        o["title"] = S(rd, "title");
                        o["categoryId"] = cn == null ? null : (object)catNoToUid[cn.Value]; // G-1/G-2b: NULL 은 null 로
                        o["allDay"] = B(rd, "all_day");                                    // G-4
                        o["startTime"] = S(rd, "start_time");                              // G-2: NULL → ''
                        o["endTime"] = S(rd, "end_time");
                        o["hours"] = null;                                                 // G-6: 컬럼 폐지 → null
                        o["location"] = S(rd, "location");
                        o["remind"] = IN(rd, "remind");                                    // G-2b: NULL 유지
                        o["memo"] = S(rd, "memo");
                        o["source"] = S(rd, "source");
                        o["commits"] = new List<object>();                                 // G-7(개정): 아래 ③b 에서 채운다
                        o["endDate"] = S(rd, "end_date");                                  // G-2
                        var f = SN(rd, "recur_freq");
                        o["recur"] = f == null ? null : (object)new Dictionary<string, object> {
                            ["freq"] = f, ["interval"] = I(rd, "recur_interval"),
                            ["until"] = S(rd, "recur_until"), ["count"] = I(rd, "recur_count") };
                        o["recurExcept"] = new List<object>();
                        o["createdAt"] = S(rd, "created_at");
                        o["updatedAt"] = S(rd, "updated_at");
                        entries.Add(o); entryNoToObj[no] = o;
                    }
                }
                // ③ cal_entry_except — ORDER BY except_date(G-5) → 부모 안으로 접는다
                using (var cmd = new MySqlCommand(
                    "SELECT entry_no, DATE_FORMAT(except_date,'%Y-%m-%d') AS d FROM cal_entry_except " +
                    "WHERE user_id=@u ORDER BY entry_no, except_date", conn))
                {
                    cmd.Parameters.AddWithValue("@u", userId);
                    using var rd = (MySqlDataReader)await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct))
                    {
                        Dictionary<string, object> p;
                        if (entryNoToObj.TryGetValue(I(rd, "entry_no"), out p)) ((List<object>)p["recurExcept"]).Add(S(rd, "d"));
                    }
                }
                // ③b cal_entry_commit — G-7 개정. ORDER BY entry_no, seq(G-5)
                using (var cmd = new MySqlCommand(
                    "SELECT entry_no, hash, short_hash, DATE_FORMAT(commit_time,'%H:%i') AS ct, subject, body " +
                    "FROM cal_entry_commit WHERE user_id=@u ORDER BY entry_no, seq", conn))
                {
                    cmd.Parameters.AddWithValue("@u", userId);
                    using var rd = (MySqlDataReader)await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct))
                    {
                        Dictionary<string, object> p;
                        if (!entryNoToObj.TryGetValue(I(rd, "entry_no"), out p)) continue;
                        ((List<object>)p["commits"]).Add(new Dictionary<string, object> {
                            ["hash"] = S(rd, "hash"), ["short"] = S(rd, "short_hash"),
                            ["time"] = S(rd, "ct"), ["subject"] = S(rd, "subject"), ["body"] = S(rd, "body") });
                    }
                }
                // ④ cal_todo
                using (var cmd = new MySqlCommand(
                    "SELECT todo_no, uid, cat_no, todo_text, note, DATE_FORMAT(due,'%Y-%m-%d') AS due, " +
                    "DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date, done, prio, " +
                    "CASE WHEN completed_at IS NULL THEN NULL ELSE " + Iso("completed_at") + " END AS completed_at, " +
                    Iso("created_at") + " AS created_at, " + Iso("updated_at") + " AS updated_at " +
                    "FROM cal_todo WHERE user_id=@u ORDER BY sort_order, uid", conn))
                {
                    cmd.Parameters.AddWithValue("@u", userId);
                    using var rd = (MySqlDataReader)await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct))
                    {
                        int no = I(rd, "todo_no");
                        int? cn = IN(rd, "cat_no");
                        var o = new Dictionary<string, object>();
                        o["id"] = S(rd, "uid");
                        o["text"] = S(rd, "todo_text");                                    // G-1: todo_text → text
                        o["done"] = B(rd, "done");                                         // G-4
                        o["categoryId"] = cn == null ? null : (object)catNoToUid[cn.Value];
                        o["due"] = S(rd, "due");                                           // G-2
                        o["endDate"] = S(rd, "end_date");
                        o["prio"] = S(rd, "prio");
                        o["completedAt"] = S(rd, "completed_at");                          // G-2 + G-3
                        o["note"] = S(rd, "note");
                        o["dayNotes"] = new Dictionary<string, object>();
                        o["createdAt"] = S(rd, "created_at");
                        o["updatedAt"] = S(rd, "updated_at");
                        todos.Add(o); todoNoToObj[no] = o;
                    }
                }
                // ⑤ cal_todo_day_note → todo.dayNotes 맵(G-5)
                using (var cmd = new MySqlCommand(
                    "SELECT todo_no, DATE_FORMAT(note_date,'%Y-%m-%d') AS d, note_text FROM cal_todo_day_note " +
                    "WHERE user_id=@u ORDER BY todo_no, note_date", conn))
                {
                    cmd.Parameters.AddWithValue("@u", userId);
                    using var rd = (MySqlDataReader)await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct))
                    {
                        Dictionary<string, object> p;
                        if (todoNoToObj.TryGetValue(I(rd, "todo_no"), out p))
                            ((Dictionary<string, object>)p["dayNotes"])[S(rd, "d")] = S(rd, "note_text");
                    }
                }
                // ⑥ cal_room — ORDER BY sort_order → 문자열 배열(G-5)
                using (var cmd = new MySqlCommand("SELECT name FROM cal_room WHERE user_id=@u ORDER BY sort_order", conn))
                {
                    cmd.Parameters.AddWithValue("@u", userId);
                    using var rd = (MySqlDataReader)await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct)) rooms.Add(S(rd, "name"));
                }
                // ⑦ cal_task_hours → { 날짜: { 과제uid: 시간 } }  안쪽 키는 uid 다(G-1/G-5)
                using (var cmd = new MySqlCommand(
                    "SELECT DATE_FORMAT(work_date,'%Y-%m-%d') AS d, cat_no, hours FROM cal_task_hours " +
                    "WHERE user_id=@u ORDER BY work_date, cat_no", conn))
                {
                    cmd.Parameters.AddWithValue("@u", userId);
                    using var rd = (MySqlDataReader)await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct))
                    {
                        string d = S(rd, "d"); int cn = I(rd, "cat_no");
                        Dictionary<string, double> inner;
                        if (!taskHours.TryGetValue(d, out inner)) { inner = new Dictionary<string, double>(); taskHours[d] = inner; }
                        inner[catNoToUid[cn]] = (double)rd.GetDecimal(rd.GetOrdinal("hours"));
                    }
                }
                // ⑧ cal_attendance → { 날짜: { status, overtime } }  행이 없는 날짜의 키를 만들지 않는다(G-5)
                using (var cmd = new MySqlCommand(
                    "SELECT DATE_FORMAT(work_date,'%Y-%m-%d') AS d, status, overtime FROM cal_attendance " +
                    "WHERE user_id=@u ORDER BY work_date", conn))
                {
                    cmd.Parameters.AddWithValue("@u", userId);
                    using var rd = (MySqlDataReader)await cmd.ExecuteReaderAsync(ct);
                    while (await rd.ReadAsync(ct))
                        attendance[S(rd, "d")] = new Dictionary<string, object> { ["status"] = S(rd, "status"), ["overtime"] = I(rd, "overtime") };
                }
                // ⑨ cal_user_pref
                using (var cmd = new MySqlCommand(
                    "SELECT git_author, svn_author, report_marker, report_marker_custom, report_indent, git_commit_body, " +
                    "report_marker_daily, report_marker_custom_daily, report_indent_daily, " +
                    "report_marker_weekly, report_marker_custom_weekly, report_indent_weekly, " +
                    "report_font_family, report_font_size FROM cal_user_pref WHERE user_id=@u", conn))
                {
                    cmd.Parameters.AddWithValue("@u", userId);
                    using var rd = (MySqlDataReader)await cmd.ExecuteReaderAsync(ct);
                    if (await rd.ReadAsync(ct))
                    {
                        pref = new Dictionary<string, object> {
                            ["gitAuthor"] = S(rd, "git_author"), ["svnAuthor"] = S(rd, "svn_author"),
                            ["reportMarker"] = S(rd, "report_marker"), ["reportMarkerCustom"] = S(rd, "report_marker_custom"),
                            ["reportIndent"] = I(rd, "report_indent"), ["gitCommitBody"] = B(rd, "git_commit_body") };
                        prefFmt["daily"] = new Dictionary<string, object> {
                            ["marker"] = S(rd, "report_marker_daily"), ["markerCustom"] = S(rd, "report_marker_custom_daily"),
                            ["indent"] = I(rd, "report_indent_daily") };
                        prefFmt["weekly"] = new Dictionary<string, object> {
                            ["marker"] = S(rd, "report_marker_weekly"), ["markerCustom"] = S(rd, "report_marker_custom_weekly"),
                            ["indent"] = I(rd, "report_indent_weekly") };
                        font["family"] = S(rd, "report_font_family");
                        font["size"] = I(rd, "report_font_size");
                    }
                }
                using (var cmd = new MySqlCommand("COMMIT", conn)) await cmd.ExecuteNonQueryAsync(ct);
            }
            catch { try { using var rb = new MySqlCommand("ROLLBACK", conn); await rb.ExecuteNonQueryAsync(ct); } catch { } throw; }

            if (pref == null) throw new Exception("cal_user_pref 행이 없습니다(user_id=" + userId + ")");

            // ── 계약 G-0 — 최상위 14키. 그 이상도 이하도 아니다 ──
            var outObj = new Dictionary<string, object>();
            outObj["categories"] = cats;
            outObj["entries"] = entries;
            outObj["gitAuthor"] = pref["gitAuthor"];
            outObj["svnAuthor"] = pref["svnAuthor"];
            outObj["todos"] = todos;
            outObj["rooms"] = rooms;
            outObj["reportMarker"] = pref["reportMarker"];
            outObj["reportMarkerCustom"] = pref["reportMarkerCustom"];
            outObj["reportIndent"] = pref["reportIndent"];
            outObj["gitCommitBody"] = pref["gitCommitBody"];
            outObj["reportFormatPrefs"] = prefFmt;
            outObj["taskHours"] = taskHours;
            outObj["attendance"] = attendance;
            outObj["reportFont"] = font;
            return JsonSerializer.Serialize(outObj);
        }
    }
}
`;

function genDeployConfig() {
  return `namespace TaskCalendarWidget
{
    // ★ 테스트 프로브 전용 — 복제 DB 를 가리킨다. 실 DB(taskmgr)로 가지 않는다.
    internal static class DeployConfig
    {
        public const string DbHost     = ${JSON.stringify(OPT.dbHost)};
        public const int    DbPort     = ${OPT.dbPort};
        public const string DbName     = ${JSON.stringify(OPT.clone)};
        public const string DbUser     = ${JSON.stringify(PROBE_USER)};
        public const string DbPassword = ${JSON.stringify(PROBE_PW)};
        public const string UpdateSourceUrl = "";
    }
}
`;
}

let probeExe = null, probeMeta = null, adapterSrcPath = null;

/** 프로브 빌드. 성공하면 {exe, sourceKind}. 실패면 envFail. */
function buildProbe() {
  const dn = spawnSync('dotnet', ['--version'], { windowsHide: true, timeout: 120000 });
  if (dn.error || dn.status !== 0) {
    envFail('dotnet SDK 를 찾지 못했습니다 — CalendarDb.cs 를 컴파일할 수 없습니다.',
      '이 테스트는 어댑터를 소스째 컴파일해 실행합니다. .NET SDK 설치가 필요합니다.');
  }
  const sdkVer = (dn.stdout || Buffer.alloc(0)).toString('utf8').trim();

  let adapterSrc, sourceKind;
  if (OPT.referenceAdapter) {
    adapterSrc = { path: join(PROBE_DIR, 'RefCalendarDb.cs'), text: REFERENCE_ADAPTER_CS };
    sourceKind = 'reference';
    note('★ --reference-adapter — widget/CalendarDb.cs 가 아니라 **내장 참조 어댑터**로 돈다. ' +
      '이 모드의 통과는 "어댑터가 옳다" 가 아니라 "하네스(픽스처 SQL·비교기·검출기)가 옳다" 의 증거다.');
  } else {
    if (!existsSync(CALENDARDB_CS)) {
      envFail('widget/CalendarDb.cs 가 없습니다 — 시험할 어댑터가 아직 없습니다.',
        '이 테스트는 대조 하네스이지 어댑터 구현이 아닙니다. 하네스 자체를 검증하려면 ' +
        '`--reference-adapter` 로 내장 참조 어댑터를 쓰고, 비교기 변이 시험은 `--selftest` 로 돌리세요.');
    }
    adapterSrc = { path: CALENDARDB_CS, text: null };
    sourceKind = 'widget/CalendarDb.cs';
  }

  mkdirSync(PROBE_DIR, { recursive: true });
  probeDirCreated = true;
  if (adapterSrc.text) writeFileSync(adapterSrc.path, adapterSrc.text, 'utf8');
  writeFileSync(join(PROBE_DIR, 'DeployConfig.cs'), genDeployConfig(), 'utf8');
  writeFileSync(join(PROBE_DIR, 'Program.cs'), PROBE_PROGRAM_CS, 'utf8');
  // 오프라인(폐쇄망) 복원 — 전역 패키지 캐시에 이미 있는 정확한 버전이면 네트워크 없이 복원된다.
  writeFileSync(join(PROBE_DIR, 'nuget.config'),
    `<?xml version="1.0" encoding="utf-8"?>\n<configuration><packageSources><clear /></packageSources></configuration>\n`, 'utf8');

  const extra = [];
  const csproj = (files) => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <LangVersion>latest</LangVersion>
    <ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>tc-cal-probe</AssemblyName>
    <RootNamespace>TcCalProbe</RootNamespace>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <NoWarn>$(NoWarn);CS1591;CS8600;CS8601;CS8602;CS8603;CS8604;CS8618;CS8625;CS0168;CS0219</NoWarn>
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
    <SatelliteResourceLanguages>en</SatelliteResourceLanguages>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="MySqlConnector" Version="2.3.7" />
  </ItemGroup>
  <ItemGroup>
${files.map((f) => `    <Compile Include=${JSON.stringify(f)} />`).join('\n')}
  </ItemGroup>
</Project>
`;

  /* CalendarDb.cs 가 위젯의 다른 파일을 참조할 수 있다 — 후보 조합을 **최소 집합부터** 순서대로 시도한다.
   * ★ 여기에 파일을 더할 때는 WPF·WebView2 에 의존하지 않는 것만 넣어라(프로브는 net9.0 콘솔이다).
   *   실측 2026-08-27: CalendarDb 의 배선용 진입점이 `RepoPaths`(widget/RepoPaths.cs · G-6 로컬 저장소
   *   경로 맵의 소유자)를 받게 되면서 최소 집합 빌드가 CS0246 으로 깨졌다. 조합에 더해 회복했다. */
  const base = [join(PROBE_DIR, 'Program.cs'), join(PROBE_DIR, 'DeployConfig.cs'), adapterSrc.path];
  const REPO_PATHS_CS = join(WIDGET_DIR, 'RepoPaths.cs');
  const USER_SESSION_CS = join(WIDGET_DIR, 'UserSession.cs');
  /*   실측 2026-09-03: C4(타인 일정 열람)에서 CalendarDb 가 ProjectDb.CanViewScheduleAsync 를
   *   부르게 되면서 — 명부와 조회가 **같은 인가 규칙**을 쓰게 하려고 거기 뒀다 — 모든 조합이
   *   CS0103 으로 깨져 이 검사가 통째로 '판정 없음'(exit 2)이 됐다. 조합을 더해 회복했다.
   *   ProjectDb 는 RepoPaths·UserSession 을 함께 요구하고, UserSession 은 Dpapi 를 요구한다
   *   (그 클래스는 NetcusService.cs 안에 있어 링크하면 WebView2 가 딸려온다 → Program.cs 의 대역). */
  const PROJECT_DB_CS = join(WIDGET_DIR, 'ProjectDb.cs');
  const extraCandidates = [[], [REPO_PATHS_CS], [USER_SESSION_CS], [USER_SESSION_CS, REPO_PATHS_CS],
                           [PROJECT_DB_CS, REPO_PATHS_CS, USER_SESSION_CS]];
  let lastErr = '';
  for (const ex of extraCandidates) {
    const files = base.concat(ex.filter((f) => existsSync(f)));
    writeFileSync(join(PROBE_DIR, 'probe.csproj'), csproj(files), 'utf8');
    const b = spawnSync('dotnet', ['build', join(PROBE_DIR, 'probe.csproj'), '-c', 'Release', '-v', 'q', '--nologo'],
      { cwd: PROBE_DIR, windowsHide: true, timeout: 420000, maxBuffer: 64 * 1024 * 1024 });
    const out = ((b.stdout || Buffer.alloc(0)).toString('utf8') + (b.stderr || Buffer.alloc(0)).toString('utf8'));
    if (!b.error && b.status === 0) {
      const exe = join(PROBE_DIR, 'bin', 'Release', 'net9.0', process.platform === 'win32' ? 'tc-cal-probe.exe' : 'tc-cal-probe');
      if (!existsSync(exe)) { lastErr = '빌드는 성공했으나 산출물이 없다: ' + exe; continue; }
      log(`프로브 빌드 완료 — ${sourceKind} (dotnet ${sdkVer}${ex.length ? ' · +' + ex.map((f) => f.split(/[\\/]/).pop()).join(',') : ''})`);
      probeExe = exe;
      return { exe, sourceKind, sourcePath: adapterSrc.path };
    }
    lastErr = out.split('\n').filter((l) => /error|오류/i.test(l)).slice(0, 12).join('\n') || out.slice(-1500);
  }
  envFail('어댑터 프로브 빌드 실패 — CalendarDb.cs 를 컴파일하지 못했습니다.', '\n' + lastErr);
}

/** 프로브 실행 → 어댑터가 돌려준 14키 객체. 실패면 {error}. */
function runProbe(loginId, localReposPath, { allowFail = false } = {}) {
  const r = spawnSync(probeExe, [loginId, localReposPath || ''],
    { windowsHide: true, timeout: 120000, maxBuffer: 128 * 1024 * 1024 });
  const out = (r.stdout || Buffer.alloc(0)).toString('utf8');
  const err = (r.stderr || Buffer.alloc(0)).toString('utf8');
  if (r.error) {
    if (allowFail) return { error: String(r.error.message) };
    envFail('어댑터 프로브 실행 실패', String(r.error.message));
  }
  const mm = /__PROBE_META__(\{.*\})/.exec(out);
  if (mm) { try { probeMeta = JSON.parse(mm[1]); } catch (_) { } }
  const i = out.indexOf(PROBE_BEGIN), j = out.indexOf(PROBE_END);
  if (r.status !== 0 || i < 0 || j < 0) {
    const msg = (err || out).trim().slice(0, 2500);
    if (allowFail) return { error: msg, status: r.status };
    if (r.status === 3) {
      envFail('어댑터 프로브가 부팅 조회 메서드를 찾지 못했습니다 — 프로브 계약(파일 머리말)을 보세요.', '\n' + msg);
    }
    envFail(`어댑터 프로브가 실패했습니다(exit ${r.status})`, '\n' + msg);
  }
  const json = out.slice(i + PROBE_BEGIN.length, j).trim();
  try { return { value: JSON.parse(json) }; }
  catch (e) {
    if (allowFail) return { error: 'JSON 파싱 실패: ' + e.message };
    envFail('어댑터가 돌려준 문자열이 JSON 이 아닙니다', json.slice(0, 800));
  }
}

/* ────────────────────────────── 9. 깊은 비교기 ──────────────────────────────
 * 비교 규칙(임무가 못박은 것):
 *   · **키 유무까지** 본다 — 개인 과제에 source 키가 **없어야** 하는 계약이 있다
 *   · undefined 와 null 을 구분한다(직렬화 센티널로 키를 살려 둔다)
 *   · 배열은 **순서까지** 본다 — categories·rooms·recurExcept·commits·entries·todos
 *   · 맵(taskHours·attendance·dayNotes)은 아래 정책대로 다룬다
 *
 * ★ entries·todos 는 **배열 그대로 인덱스별로** 비교한다(diffArrayOrdered).
 *   예전에는 대조 **직전에** byId() 로 배열을 id 키 객체로 접었다 — 그 순간 순서가
 *   비교 대상에서 통째로 빠져 자리가 뒤바뀌어도 "차이 0건" 이 나왔다. 그 구멍을 막았다.
 *   화면 순서 = 배열 순서이므로(렌더 정렬도 createdAt 에서 끝나 동률이면 배열 순서가 그대로
 *   새어 나온다) 배열 순서는 **관찰 가능한 계약**이고, 기준(fromXML)과 같아야 한다.
 *   보고는 세 갈래로 갈라 낸다 — [ORDER] 자리 어긋남 · [DIFF] 항목 누락/잉여 · [DIFF] 내용 차이.
 *   순서를 포기해야 하는 구간이 생기면 ORDER_EXEMPT 에 적는다(지금은 비어 있다).
 * ★ 맵의 **키 순서**는 계약이 아니다(JS 객체 키 순서에 앱이 의존하지 않는다). 키 집합과 값만 본다. */

const TN = (v) => (v === UNDEF ? 'undefined' : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const short = (v) => {
  if (v === UNDEF) return 'undefined';
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
  return s === undefined ? String(v) : (s.length > 160 ? s.slice(0, 157) + '…' : s);
};

function deepDiff(a, b, path, out, cap = 80) {
  if (out.length >= cap) return out;
  const ta = TN(a), tb = TN(b);
  if (ta !== tb) { out.push({ path, kind: '자료형이 다르다', exp: `${ta} ${short(a)}`, act: `${tb} ${short(b)}` }); return out; }
  if (ta === 'array') {
    if (a.length !== b.length) out.push({ path, kind: '배열 길이가 다르다', exp: a.length, act: b.length });
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) deepDiff(a[i], b[i], `${path}[${i}]`, out, cap);
    return out;
  }
  if (ta === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k)) out.push({ path: `${path}.${k}`, kind: '키가 없다(DB 쪽)', exp: short(a[k]), act: '(키 없음)' });
    for (const k of kb) if (!Object.prototype.hasOwnProperty.call(a, k)) out.push({ path: `${path}.${k}`, kind: '없어야 할 키가 있다(DB 쪽)', exp: '(키 없음)', act: short(b[k]) });
    for (const k of ka) if (Object.prototype.hasOwnProperty.call(b, k)) deepDiff(a[k], b[k], `${path}.${k}`, out, cap);
    return out;
  }
  if (!Object.is(a, b)) out.push({ path, kind: '값이 다르다', exp: short(a), act: short(b) });
  return out;
}

/* ── ★ 순서 비교 면제 자리(ORDER_EXEMPT) ──────────────────────────────────
 * '계약이 순서를 포기한 구간' 을 적는 곳이다. **지금은 비어 있다** —
 * cal_entry·cal_todo 에 sort_order 가 들어가면 배열 순서는 DB 가 확정하므로
 * 면제할 구간이 없다. 여기에 항목을 넣으면 그 배열의 **순서만** 비교를 건너뛰고
 * (항목 유무·내용 비교는 계속 돈다), 그 사실이 요약의 「순서 비교 면제」에
 * **반드시** 찍힌다 — '왜 같다고 했는지' 를 나중에 설명할 수 있어야 한다. */
const ORDER_EXEMPT = [
  // { array: 'entries', why: '<계약 조항>이 이 배열의 순서를 정하지 않는다', ref: '<문서·줄>' },
];
const orderExemptUsed = [];
function orderExemptFor(what) {
  const hit = ORDER_EXEMPT.find((x) => x.array === what);
  if (hit && !orderExemptUsed.includes(hit)) orderExemptUsed.push(hit);
  return hit || null;
}

const idAt = (o, i) => (o && typeof o === 'object' && o.id !== undefined && o.id !== null ? String(o.id) : `(id없음#${i})`);
const trim = (s, n = 300) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

/** G-5 가 배열 순서를 정할 때 쓰는 정렬 키 — '어긋난 자리가 동률 그룹 안인가' 를 판정하는 데만 쓴다. */
const SORT_KEY = {
  entries: { col: 'entry_date', of: (o) => String(o && o.date) },
  todos: { col: 'due', of: (o) => String(o && o.due) },
};

/** 순서가 어긋났을 때 **원인 후보**를 한 줄로. 짐작이 아니라 관측(dbFacts·정렬 키)에서만 만든다. */
function orderCause(what, eArr, eCommon, aCommon, bad, dbFacts) {
  const hits = [];
  const eBy = new Map(eArr.map((o, i) => [idAt(o, i), o]));
  const sk = SORT_KEY[what];
  if (sk && bad.length) {
    let allTie = true;
    for (const i of bad) {
      const x = eBy.get(eCommon[i]), y = eBy.get(aCommon[i]);
      if (!x || !y || sk.of(x) !== sk.of(y)) { allTie = false; break; }
    }
    if (allTie) hits.push(`어긋난 자리가 **전부 정렬 키(${sk.col}) 동률 그룹 안**이다 — 그 키만으로는 순서를 확정할 수 없다`);
    else hits.push(`실측이 기준과 **다른 축**으로 늘어서 있다 — 기준은 문서 순서, 실측은 ${sk.col} 순서다(ORDER BY 가 문서 순서를 복원하지 않는다)`);
  }
  const pkOrder = what === 'todos' ? (dbFacts && dbFacts.todoNoOrder) : what === 'entries' ? (dbFacts && dbFacts.entryNoOrder) : null;
  const pkCol = what === 'todos' ? 'todo_no' : 'entry_no';
  if (pkOrder && pkOrder.length > 1) {
    const inSet = new Set(aCommon);
    if (pkOrder.filter((k) => inSet.has(k)).join('|') === aCommon.join('|')) {
      hits.push(`실측 순서가 ${pkCol}(PK) 순서와 같다 — ORDER BY 가 없거나 PK 로 정렬했다(계약이 금지한다)`);
    }
  }
  return hits.length ? hits.join(' / ') : null;
}

/** ★ 동률 그룹 진단 — 정렬 키가 **같은** 항목들끼리의 상대 순서가 기준과 다른가.
 *  이것이 sort_order 없이는 복원 불가능한 부분이다: 정렬 키(entry_date·due)가 같고
 *  created_at 마저 같으면 어떤 보조정렬로도 문서 순서를 되살릴 수 없다.
 *  ORDER BY 축이 달라 생긴 '전체가 재배치된 것' 과 이것을 **반드시 나눠서** 봐야 한다. */
function tieGroupDiag(what, eArr, aArr) {
  const sk = SORT_KEY[what];
  if (!sk) return [];
  const eIds = eArr.map(idAt), aIds = aArr.map(idAt);
  const eBy = new Map(eArr.map((o, i) => [idAt(o, i), o]));
  const aSet = new Set(aIds), eSet = new Set(eIds);
  const groups = new Map();
  for (const k of eIds) {
    if (!aSet.has(k)) continue;
    const g = sk.of(eBy.get(k));
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(k);
  }
  const out = [];
  for (const [g, ids] of groups) {
    if (ids.length < 2) continue;
    const inA = aIds.filter((k) => eSet.has(k) && sk.of(eBy.get(k)) === g);
    if (inA.join('|') === ids.join('|')) continue;
    const cts = ids.map((k) => String(eBy.get(k).createdAt));
    const ctTie = new Set(cts).size < cts.length;
    out.push({ key: g, exp: ids, act: inA, ctTie, cts });
  }
  return out;
}

/** 배열을 **배열 그대로** 비교한다 — 순서(ORDER)·항목 유무(DIFF)·내용(DIFF)을 **따로** 보고한다.
 *  ★ id 키 객체로 접지 않는다. 접는 순간 순서가 비교 대상에서 통째로 빠진다
 *    ("차이 0건" 이 나왔던 자리다 — 통과하는 테스트가 통과 못 하는 테스트보다 위험했다). */
function diffArrayOrdered(eArr, aArr, what, out, dbFacts) {
  const path = `$.${what}`;
  if (!Array.isArray(eArr) || !Array.isArray(aArr)) { deepDiff(eArr, aArr, path, out); return; }

  const eIds = eArr.map(idAt), aIds = aArr.map(idAt);

  // ① id 중복 — 여기서 잡지 않으면 아래 짝짓기가 거짓말을 한다
  const dups = (ids, side) => {
    const seen = new Set(), bad = new Set();
    ids.forEach((k) => { if (seen.has(k)) bad.add(k); seen.add(k); });
    for (const k of bad) out.push({ cls: 'DIFF', path: `${path}[id=${k}]`, kind: `id 가 중복이다(${side} 쪽)`, exp: '-', act: '-' });
  };
  dups(eIds, '기준'); dups(aIds, '실측');

  // ② 다중집합 — 항목 유무. **순서와 분리해서** 본다(누락과 자리바꿈은 다른 병이다)
  const eSet = new Set(eIds), aSet = new Set(aIds);
  const missing = eIds.map((k, i) => [k, i]).filter(([k]) => !aSet.has(k));
  const extra = aIds.map((k, i) => [k, i]).filter(([k]) => !eSet.has(k));
  for (const [k, i] of missing.slice(0, 20))
    out.push({ cls: 'DIFF', path: `${path}[${i}](id=${k})`, kind: '항목이 없다(DB 쪽)', exp: short(eArr[i]), act: '(항목 없음)' });
  if (missing.length > 20) out.push({ cls: 'DIFF', path, kind: `… 누락 항목 ${missing.length - 20}건 더`, exp: '-', act: '-' });
  for (const [k, i] of extra.slice(0, 20))
    out.push({ cls: 'DIFF', path: `${path}[${i}](id=${k})`, kind: '없어야 할 항목이 있다(DB 쪽)', exp: '(항목 없음)', act: short(aArr[i]) });
  if (extra.length > 20) out.push({ cls: 'DIFF', path, kind: `… 잉여 항목 ${extra.length - 20}건 더`, exp: '-', act: '-' });

  // ③ 순서 — 양쪽에 다 있는 항목만 남겨 **인덱스별로** 비교한다.
  //    (누락 하나 때문에 그 뒤 전부가 '순서 어긋남' 으로 번지지 않게 한다 =
  //     '위치만 다른 것' 과 '항목 자체가 없는 것' 이 구분된다)
  const eCommon = eIds.filter((k) => aSet.has(k));
  const aCommon = aIds.filter((k) => eSet.has(k));
  const exempt = orderExemptFor(what);
  if (exempt) {
    out.push({
      cls: 'EXEMPT', path,
      kind: `순서 비교를 면제했다 — ${exempt.why}${exempt.ref ? ` [${exempt.ref}]` : ''}`,
      exp: trim(eCommon.join(' → ')), act: trim(aCommon.join(' → ')),
    });
  } else {
    const n = Math.min(eCommon.length, aCommon.length);
    const bad = [];
    for (let i = 0; i < n; i++) if (eCommon[i] !== aCommon[i]) bad.push(i);
    for (const i of bad.slice(0, 15)) {
      out.push({
        cls: 'ORDER', path: `${path}[${i}]`,
        kind: '순서가 다르다 — 이 자리에 다른 항목이 있다',
        exp: `${i}번째 = id ${eCommon[i]}`,
        act: `${i}번째 = id ${aCommon[i]}  (이 id 는 기준에서 ${eCommon.indexOf(aCommon[i])}번째다)`,
      });
    }
    if (bad.length > 15) out.push({ cls: 'ORDER', path: `${path}[…]`, kind: `… 어긋난 자리 ${bad.length - 15}개 더`, exp: '-', act: '-' });
    if (bad.length) {
      out.push({
        cls: 'ORDER', path, badCount: bad.length, kind: `순서 전체 — ${n}자리 중 ${bad.length}자리가 어긋났다`,
        exp: trim(eCommon.join(' → ')), act: trim(aCommon.join(' → ')),
      });
      const cause = orderCause(what, eArr, eCommon, aCommon, bad, dbFacts);
      if (cause) out.push({ cls: 'ORDER', path, kind: '원인 후보(관측)', exp: '-', act: cause });
    }
    // ★ 결함 B 자리 — 정렬 키 동률 그룹 안에서 상대 순서가 뒤바뀐 것만 따로 센다.
    //   (ORDER BY 축이 달라 통째로 재배치된 것과 섞어 보면 '무엇이 복원 불가인지' 가 사라진다)
    const tg = tieGroupDiag(what, eArr, aArr);
    if (tg.length) {
      const sk = SORT_KEY[what];
      const noFix = tg.filter((x) => x.ctTie);
      out.push({
        cls: 'ORDER', path,
        kind: `★ 동률 그룹 재배치 ${tg.length}그룹 — 정렬 키(${sk.col})가 **같은** 항목끼리 상대 순서가 뒤바뀌었다` +
          (noFix.length ? ` · 그중 ${noFix.length}그룹은 created_at 마저 동률이라 **어떤 보조정렬로도 복원 불가**(= sort_order 부재)` : ''),
        exp: trim(tg.slice(0, 4).map((x) => `${x.key}: ${x.exp.join(' → ')}`).join(' | '), 400),
        act: trim(tg.slice(0, 4).map((x) => `${x.key}: ${x.act.join(' → ')}${x.ctTie ? ' [created_at 동률]' : ''}`).join(' | '), 400),
      });
    }
  }

  // ④ 내용 — id 로 짝지어 **내용만** 본다(순서 차이가 내용 차이로 번지지 않게).
  //    자리가 어긋났으면 경로에 '기준i→실측j' 로 양쪽 인덱스를 같이 찍는다.
  const aBy = new Map();
  aArr.forEach((o, i) => { const k = idAt(o, i); if (!aBy.has(k)) aBy.set(k, { o, i }); });
  eArr.forEach((o, i) => {
    const k = idAt(o, i), hit = aBy.get(k);
    if (!hit) return;                                   // 누락은 ②가 이미 보고했다
    const pos = i === hit.i ? `[${i}]` : `[기준${i}→실측${hit.i}]`;
    deepDiff(o, hit.o, `${path}${pos}(id=${k})`, out, 400);
  });
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/* ── 계약상 차이표 — expected 를 DB 쪽 계약에 맞춰 정규화한다 ────────────────
 * 이 표에 **없는** 차이는 전부 위반이다. 표에 있는 것은 요약에 반드시 찍는다
 * (숨기면 '왜 같다고 하는지' 를 나중에 아무도 설명할 수 없다). */
function normalizeExpected(exp, { localReposAccepted }) {
  const e = clone(exp);
  const applied = [];
  let n = 0;
  for (const en of e.entries) { if (en.hours !== null) n++; en.hours = null; }
  if (n) applied.push(`G-6 entry.hours → null (컬럼 폐지) · ${n}건`);
  //  ★ G-7 개정(2026-09-01) — 커밋을 기준에서 지우던 정규화를 **없앴다.**
  //    예전에는 여기서 en.commits = [] 로 깎아 DB 쪽의 빈 배열과 억지로 맞췄다. 그 줄이
  //    '계약상 차이' 로 정직하게 찍히긴 했지만, 실제로는 **DB 에서 커밋을 못 읽는 결함**을
  //    계약으로 덮고 있었다. 이제 양쪽이 그냥 같아야 한다 — 그게 훨씬 강한 명제다.
  //    (지우는 대신 이 주석을 남긴다. 다시 깎고 싶어지면 그것이 결함의 재발이다.)
  //  ★ lsMigrated 를 true 로 맞추던 정규화를 없앴다(2026-09-01) — 그 키 자체가 사라졌다.
  //    그 줄이 있던 이유는 자동이관을 봉인하려고 어댑터가 하드코딩 true 를 내보냈기 때문이다.

  /* ★ category.usesRepo — 계약 G-0 이 명시한 **유일한 의도된 예외**(2026-08-27, schema_version 5).
   *   fromXML() 은 이 키를 만들지 않는다. XML 에는 경로 **문자열**만 있고 '쓴다/안 쓴다'는 없다(§4) —
   *   경로는 그 파일을 만든 PC 의 사실이지 과제의 사실이 아니기 때문이다.
   *   그래서 여기서 기준 쪽에 얹는다. **덮지 않고 계산해서 맞춘다** — hours=null·
   *   hours=null 과 같은 부류다(G-6 '없는 것 채우기').
   *   ★ 이 정규화를 gitRepo/svnRepo **정규화보다 먼저** 한다. 아래에서 두 값을 '' 로 지우고 나면
   *     근거가 사라져 전부 false 가 되고, 그러면 이 검사는 조용히 무력해진다.
   *   ※ 규칙은 loadFixtureIntoDb 가 DB 에 넣을 때 쓴 것과 **같은 함수**(usesRepoOf)다 —
   *     그래서 이 대조가 증명하는 것은 '어댑터가 DB 의 비트를 앱까지 나르는가' 이지
   *     '이관 규칙이 옳은가' 가 아니다. 그 사실을 요약에 남긴다. */
  {
    let t = 0;
    for (const c of e.categories) { c.usesRepo = usesRepoOf(c); if (c.usesRepo) t++; }
    const f = e.categories.length - t;
    applied.push(`G-0/G-6 category.usesRepo 신설 키를 기준에 얹었다 — true ${t}건 · false ${f}건 ` +
      `(XML 의 gitRepo/svnRepo 유무로 계산. 적재도 같은 규칙이라 여기서 증명되는 것은 ` +
      `**어댑터가 DB 의 그 비트를 나르는가** 이지 이관 규칙의 옳음이 아니다)`);
    // ★ 픽스처 적격성 — 전부 true 이거나 전부 false 면 'DB 를 안 읽고 상수를 넣은 어댑터'가 통과한다.
    if (t === 0 || f === 0) {
      note(`픽스처 조건 미달 — category.usesRepo 가 전부 ${t === 0 ? 'false' : 'true'} 다(${e.categories.length}건). ` +
        `이 픽스처로는 '어댑터가 uses_repo 를 읽지 않고 상수를 넣는' 결함을 검출할 수 없다`);
    }
  }

  if (!localReposAccepted) {
    n = 0;
    for (const c of e.categories) { if (c.gitRepo || c.svnRepo) n++; c.gitRepo = ''; c.svnRepo = ''; }
    applied.push(`G-6 category.gitRepo/svnRepo → '' · ${n}건 ` +
      `(어댑터에 로컬 저장소 주입 표면이 없다 — 빈 문자열로만 대조했다)`);
  } else {
    applied.push('G-6 category.gitRepo/svnRepo — 어댑터가 로컬 저장소 JSON 을 받았다. 값까지 대조한다');
  }
  return { exp: e, applied };
}

/* ────────────────────────────── 10. 계약별 개별 검사 ────────────────────────────── */

const TOP15 = ['categories', 'entries', 'todos', 'rooms', 'taskHours', 'attendance', 'gitAuthor', 'svnAuthor',
  'reportMarker', 'reportMarkerCustom', 'reportIndent', 'gitCommitBody', 'reportFormatPrefs', 'reportFont'];
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// G-1d — state 에 흘리면 안 되는 이름(자식 표의 부모번호·소유자축·정렬 컬럼·DB 컬럼명 그대로)
const FORBIDDEN_KEYS = new Set(['user_id', 'userId', 'cat_no', 'catNo', 'entry_no', 'entryNo', 'todo_no', 'todoNo',
  'sort_order', 'sortOrder', 'seq', 'uid', 'description', 'todo_text', 'todoText', 'short_hash', 'shortHash',
  'commit_time', 'commitTime', 'entry_date', 'entryDate', 'all_day', 'work_date', 'workDate', 'project_uid', 'projectUid']);

function walkKeys(v, path, fn) {
  if (Array.isArray(v)) { v.forEach((x, i) => walkKeys(x, `${path}[${i}]`, fn)); return; }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) { fn(k, `${path}.${k}`, v[k], path); walkKeys(v[k], `${path}.${k}`, fn); }
  }
}

/** act 가 계약 G 를 지키는지 — 깊은 비교와 **별개로** 본다(비교가 통과해도 여기서 걸릴 수 있다). */
function contractChecks(expNorm, act, expRaw, dbFacts) {
  // ── G-0 최상위 14키 ─────────────────────────────────────────────────
  const ka = Object.keys(act);
  const missing = TOP15.filter((k) => !Object.prototype.hasOwnProperty.call(act, k));
  const extra = ka.filter((k) => !TOP15.includes(k));
  if (missing.length) violate('G-0', `최상위에 있어야 할 키가 없다: ${missing.join(', ')}`);
  if (extra.length) violate('G-0', `최상위에 없어야 할 키가 있다: ${extra.join(', ')}`);
  if (!missing.length && !extra.length) ok(`G-0 최상위 ${TOP15.length}키 일치`);

  // ── G-1d 흘리면 안 되는 키 ──────────────────────────────────────────
  const leaked = [];
  walkKeys(act, '$', (k, p) => { if (FORBIDDEN_KEYS.has(k)) leaked.push(p); });
  if (leaked.length) violate('G-1d', `state 에 흘리면 안 되는 키가 있다 — ${leaked.slice(0, 10).join(', ')}${leaked.length > 10 ? ` 외 ${leaked.length - 10}개` : ''}`);
  else ok('G-1d 금지 키 없음(user_id·*_no·sort_order·seq·uid·DB 컬럼명 그대로)');

  // ── G-1b/G-1c 과제 참조 — cat_no 를 흘리면 전 일정이 조용히 '미분류' 가 된다 ──
  const catIds = new Set((act.categories || []).map((c) => c.id));
  const dangling = (act.entries || []).filter((e) => e.categoryId != null && !catIds.has(e.categoryId));
  const danglingT = (act.todos || []).filter((t) => t.categoryId != null && !catIds.has(t.categoryId));
  const numeric = (act.entries || []).filter((e) => typeof e.categoryId === 'number')
    .concat((act.todos || []).filter((t) => typeof t.categoryId === 'number'));
  if (numeric.length) violate('G-1c', `categoryId 가 숫자다 — cat_no 를 그대로 흘렸다(오류 없이 전부 '미분류'가 된다). ${numeric.length}건, 예: ${short(numeric[0].categoryId)}`);
  if (dangling.length || danglingT.length) {
    violate('G-1c', `과제에 붙지 못하는 참조가 있다 — 일정 ${dangling.length}건 · 할 일 ${danglingT.length}건`,
      (dangling[0] || danglingT[0]) && `예: ${short((dangling[0] || danglingT[0]).id)} → ${short((dangling[0] || danglingT[0]).categoryId)}`);
  }
  if (!numeric.length && !dangling.length && !danglingT.length) ok('G-1c 게이트 통과 — 모든 categoryId 가 실재하는 과제 uid 다');

  // taskHours 안쪽 키도 과제 uid 여야 한다(G-1/G-5)
  const thBad = [];
  for (const [d, m] of Object.entries(act.taskHours || {})) for (const k of Object.keys(m)) if (!catIds.has(k)) thBad.push(`${d}/${k}`);
  if (thBad.length) violate('G-1b', `taskHours 의 안쪽 키가 과제 uid 가 아니다: ${thBad.slice(0, 6).join(', ')}`);
  else if (Object.keys(act.taskHours || {}).length) ok('G-1b taskHours 안쪽 키 = 과제 uid');

  // ── G-2 NULL → '' (전수 8자리 중 부팅 조회에 나타나는 7자리) ──────────
  const g2 = [];
  for (const e of act.entries || []) {
    for (const k of ['startTime', 'endTime', 'endDate']) if (typeof e[k] !== 'string') g2.push(`entries[${e.id}].${k}=${TN(e[k])}`);
    if (e.recur && typeof e.recur.until !== 'string') g2.push(`entries[${e.id}].recur.until=${TN(e.recur.until)}`);
  }
  for (const t of act.todos || []) {
    for (const k of ['due', 'endDate', 'completedAt', 'note']) if (typeof t[k] !== 'string') g2.push(`todos[${t.id}].${k}=${TN(t[k])}`);
  }
  if (g2.length) violate('G-2', `NULL 을 빈 문자열로 되돌리지 않았다(문자열 메서드에서 터진다): ${g2.slice(0, 8).join(', ')}`);
  else ok('G-2 NULL → \'\' — start/end time · endDate(일정·할일) · due · recur.until · completedAt 전부 문자열');

  // ── G-2b 반대로 NULL 을 유지해야 하는 둘 ─────────────────────────────
  const g2b = [];
  for (const e of act.entries || []) {
    if (e.categoryId !== null && typeof e.categoryId !== 'string') g2b.push(`entries[${e.id}].categoryId=${TN(e.categoryId)}`);
    if (e.categoryId === '') g2b.push(`entries[${e.id}].categoryId='' (null 이어야 한다)`);
    if (!(e.remind === null || typeof e.remind === 'number')) g2b.push(`entries[${e.id}].remind=${TN(e.remind)}`);
    if (e.remind === '') g2b.push(`entries[${e.id}].remind='' — '알림 없음'(0)이 '기본 사다리'(null)로 뭉개진다`);
  }
  for (const t of act.todos || []) if (t.categoryId !== null && typeof t.categoryId !== 'string') g2b.push(`todos[${t.id}].categoryId=${TN(t.categoryId)}`);
  if (g2b.length) violate('G-2b', `NULL 을 유지해야 하는 자리를 바꿨다: ${g2b.slice(0, 8).join(', ')}`);
  else ok('G-2b cat_no·remind 는 null 유지 (0 과 null 이 구분된다)');

  // ── G-3 DATETIME(3) → ISO 'Z' 3자리 고정 ────────────────────────────
  const g3 = [];
  for (const c of act.categories || []) if (!ISO_Z.test(String(c.createdAt))) g3.push(`categories[${c.id}].createdAt=${short(c.createdAt)}`);
  for (const e of act.entries || []) for (const k of ['createdAt', 'updatedAt']) if (!ISO_Z.test(String(e[k]))) g3.push(`entries[${e.id}].${k}=${short(e[k])}`);
  for (const t of act.todos || []) {
    for (const k of ['createdAt', 'updatedAt']) if (!ISO_Z.test(String(t[k]))) g3.push(`todos[${t.id}].${k}=${short(t[k])}`);
    if (t.completedAt !== '' && !ISO_Z.test(String(t.completedAt))) g3.push(`todos[${t.id}].completedAt=${short(t.completedAt)}`);
  }
  if (g3.length) violate('G-3', `ISO 'Z'(밀리초 3자리)가 아니다 — 왕복 서명이 어긋난다: ${g3.slice(0, 6).join(', ')}`);
  else ok("G-3 시각 6자리 전부 ISO 'Z' · 소수 정확히 3자리");

  // ── G-4 TINYINT → boolean ───────────────────────────────────────────
  const g4 = [];
  for (const e of act.entries || []) if (typeof e.allDay !== 'boolean') g4.push(`entries[${e.id}].allDay=${TN(e.allDay)} ${short(e.allDay)}`);
  for (const t of act.todos || []) if (typeof t.done !== 'boolean') g4.push(`todos[${t.id}].done=${TN(t.done)} ${short(t.done)}`);
  if (typeof act.gitCommitBody !== 'boolean') g4.push(`gitCommitBody=${TN(act.gitCommitBody)} ${short(act.gitCommitBody)}`);
  for (const c of act.categories || []) if (Object.prototype.hasOwnProperty.call(c, 'dbGone') && typeof c.dbGone !== 'boolean') g4.push(`categories[${c.id}].dbGone=${TN(c.dbGone)}`);
  // usesRepo 도 TINYINT(1) → boolean 이다(uses_repo. G-6). 키 부재는 아래 G-6 이 따로 본다 —
  // 여기서 함께 울리면 '자료형이 틀렸다'와 '아예 안 실었다'가 한 줄로 뭉개진다.
  for (const c of act.categories || []) if (Object.prototype.hasOwnProperty.call(c, 'usesRepo') && typeof c.usesRepo !== 'boolean') g4.push(`categories[${c.id}].usesRepo=${TN(c.usesRepo)} ${short(c.usesRepo)}`);
  if (g4.length) violate('G-4', `0/1 을 그대로 넘겼다(화면은 같지만 내보내기에서만 값이 달라진다): ${g4.slice(0, 6).join(', ')}`);
  else ok('G-4 allDay·done·gitCommitBody·dbGone·usesRepo 전부 boolean');

  // ── G-5 순서 ────────────────────────────────────────────────────────
  // ★ 예전엔 순서 검사가 여기 두 줄뿐이었다 — 'entry_date 가 단조인가' 와 'todo_no 순서와 다른가'.
  //   둘 다 **기준과 같은가를 묻지 않는다.** 그래서 동률 그룹 안에서 자리가 뒤바뀌어도 통과했다.
  //   이제 순서의 **판정**은 비교기(diffArrayOrdered)가 기준(fromXML)과 **인덱스별로** 대조해
  //   [ORDER] 로 낸다. 여기 남은 것은 (a) 일치했다는 확인과 (b) 위반의 원인을 좁히는 성질 검사다.
  //   같은 것을 두 번 울리지 않으려고, 불일치의 보고는 비교기에만 맡긴다.
  const orderVsBaseline = (what) => {
    if (ORDER_EXEMPT.some((x) => x.array === what)) return;      // 면제 구간은 비교기가 요약에 찍는다
    const eIds = (expNorm[what] || []).map((x, i) => idAt(x, i));
    const aIds = (act[what] || []).map((x, i) => idAt(x, i));
    if (eIds.join('|') === aIds.join('|')) ok(`ORDER ${what} 순서가 기준(fromXML)과 인덱스별로 같다 (${aIds.length}건)`);
  };
  orderVsBaseline('entries'); orderVsBaseline('todos');

  /* ★ 2026-08-27 — 여기 있던 'entries 가 entry_date 오름차순인가(단조)' 검사를 **삭제했다.**
   *   그 검사는 기준(fromXML)이 갖지 않은 성질을 실측에만 요구하고 있었다 — fromXML 의 entries 배열은
   *   **문서 순서이고 날짜순이 아니다**(real 픽스처·synth 픽스처 둘 다 날짜순이 아님을 확인).
   *   즉 통과하려면 어댑터가 기준과 **다른 축**으로 정렬해야 했고, 그게 결함 A 시절 "차이 0건" 과
   *   짝을 이루던 잘못된 초록불이다(배열을 id 맵으로 접어 순서를 안 보던 때라 모순이 안 드러났다).
   *   순서의 판정은 이제 orderVsBaseline + 비교기(diffArrayOrdered)가 기준과 인덱스별로 대조해서 낸다 —
   *   그게 '정렬 축이 맞는가' 까지 포함하므로 이 대리 검사는 덮이는 것이 아니라 **틀린 것**이었다.
   *   ★ 되살리지 말 것. 되살리면 sort_order 로 문서 순서를 정확히 복원한 정상 상태가 위반으로 뜬다.
   *   ※ 'ORDER BY 를 통째로 빠뜨렸다' 는 원래 겨냥은 그대로 잡힌다 — ORDER BY 가 없으면 순서가
   *     기준과 어긋나고 [ORDER] 가 자리별로 운다(변이 MO1~MO3 이 그 검출력을 매 실행 확인한다). */

  // recurExcept 도 정렬돼야 한다(G-5)
  const exBad = (act.entries || []).filter((e) => {
    const a = e.recurExcept || [];
    for (let i = 1; i < a.length; i++) if (String(a[i]) < String(a[i - 1])) return true;
    return false;
  });
  if (exBad.length) violate('G-5', `recurExcept 가 except_date 오름차순이 아니다: ${exBad.map((e) => e.id).join(', ')}`);

  // ※ 옛 'todos 순서 ≠ todo_no 순서' 대리 검사는 위 orderVsBaseline('todos') 로 **승격**됐다.
  //    (PK 순서와 다르기만 하면 통과하던 검사다 — 기준과 같은지는 묻지 않았다.)
  //    PK 순서와 같다는 관측은 이제 [ORDER] 위반의 「원인 후보」로 붙는다(orderCause).

  // 근태는 행이 없는 날짜의 키를 만들지 않는다(G-5)
  const attBad = Object.entries(act.attendance || {}).filter(([, v]) => !v || v.status === '' || v.status == null);
  if (attBad.length) violate('G-5', `근태에 빈 status 키가 있다 — '미기록' 은 키 자체가 없어야 한다: ${attBad.map(([k]) => k).join(', ')}`);

  // taskHours 값은 숫자여야 한다(DECIMAL 을 문자열로 흘리면 화면 합계가 문자열 접합이 된다)
  const thNum = [];
  for (const [d, m] of Object.entries(act.taskHours || {})) for (const [k, v] of Object.entries(m)) if (typeof v !== 'number') thNum.push(`${d}/${k}=${TN(v)} ${short(v)}`);
  if (thNum.length) violate('G-5', `taskHours 값이 숫자가 아니다(DECIMAL 을 문자열로 흘렸다): ${thNum.slice(0, 5).join(', ')}`);

  // ── G-6 채우기 ──────────────────────────────────────────────────────
  //  (없앤 것) G-6 lsMigrated 검사 — 그 키를 2026-09-01 에 없앴다.
  //    어댑터가 하드코딩 true 로 내보내던 값이고, 그 이유는 웹의 자동이관을 봉인하기
  //    위해서였다. 자동이관이 사라지면서 함께 없앴다(G-0 키 15 → 14).

  const hoursBad = (act.entries || []).filter((e) => e.hours !== null);
  if (hoursBad.length) violate('G-6', `entry.hours 가 null 이 아니다 — 컬럼이 폐지됐으므로 null 로 채워야 한다: ${hoursBad.slice(0, 5).map((e) => `${e.id}=${short(e.hours)}`).join(', ')}`);
  const hoursUndef = (act.entries || []).filter((e) => !Object.prototype.hasOwnProperty.call(e, 'hours'));
  if (hoursUndef.length) violate('G-6', `entry.hours 키가 아예 없다(undefined) — 명시적 null 로 채워야 한다: ${hoursUndef.length}건`);

  // source 키는 'db' 일 때만 만든다. 개인 과제에는 **키 자체가 없어야** 한다.
  const srcBad = [];
  for (const c of act.categories || []) {
    const has = Object.prototype.hasOwnProperty.call(c, 'source');
    const hasG = Object.prototype.hasOwnProperty.call(c, 'dbGone');
    if (has && c.source !== 'db') srcBad.push(`${c.id}: source=${short(c.source)} (개인 과제에는 키 자체가 없어야 한다)`);
    if (has !== hasG) srcBad.push(`${c.id}: source 와 dbGone 은 함께 있거나 함께 없어야 한다(source=${has}, dbGone=${hasG})`);
  }
  if (srcBad.length) violate('G-6', `공식/개인 과제의 키 유무 계약을 어겼다: ${srcBad.slice(0, 5).join(' · ')}`);
  else ok('G-6 source·dbGone 은 공식 과제(db)에만 — 개인 과제에는 키 자체가 없다');

  // usesRepo 는 반대다 — **모든 과제에 항상** 있어야 한다(source·dbGone 과 판정이 다르다).
  //   저 둘은 '공식 과제인가' 라는 분류라 부재가 곧 'local' 이라는 뜻이지만, usesRepo 는
  //   '경로 없음 안내를 띄울까' 의 조건이고 undefined 는 false 와 같은 자리에 떨어진다 —
  //   즉 키를 빼먹으면 §4 의 안내 분기가 **오류 없이 통째로 사라진다.**
  const urMissing = (act.categories || []).filter((c) => !Object.prototype.hasOwnProperty.call(c, 'usesRepo'));
  if (urMissing.length) {
    violate('G-6', `category.usesRepo 키가 없다 — ${urMissing.length}건(예: ${short(urMissing[0].id)}). ` +
      "undefined 는 false 와 같게 동작해 '이 PC 에는 경로가 설정되지 않았습니다' 안내가 오류 없이 사라진다");
  } else if (act.categories && act.categories.length) {
    const t = act.categories.filter((c) => c.usesRepo === true).length;
    ok(`G-6 category.usesRepo 전 과제에 존재 (${act.categories.length}건 중 true ${t}건) — 경로 유무와 별개의 비트다`);
  }

  // ── G-7(개정) 커밋은 부팅 조회가 **실어 와야** 한다 ──────────────────
  //   2026-09-01 이전에는 정반대였다("섞이면 위반"). 그 계약이 배선을 막고 있었고,
   //  그 결과 DB 모드에서 커밋 기반 보고서가 통째로 비었다. 방향을 뒤집는다.
  const cmNotArr = (act.entries || []).filter((e) => !Array.isArray(e.commits));
  const cmLoaded = (act.entries || []).reduce((a, e) => a + (Array.isArray(e.commits) ? e.commits.length : 0), 0);
  if (cmNotArr.length) {
    violate('G-7', `entry.commits 가 배열이 아니다 — ${cmNotArr.length}건, 예: ${cmNotArr[0].id} → ${TN(cmNotArr[0].commits)} (undefined 면 커밋 편집 경로가 TypeError 로 죽는다)`);
  } else if (dbFacts && dbFacts.commitRows > 0) {
    if (cmLoaded !== dbFacts.commitRows) {
      violate('G-7', `부팅 조회가 커밋을 다 싣지 않았다 — DB ${dbFacts.commitRows}행인데 state 에는 ${cmLoaded}개. ` +
        '0 이면 지연 조회 시절로 되돌아간 것이다(그때 보고서가 통째로 비었다).');
    } else {
      ok(`G-7(개정) 커밋 ${cmLoaded}개를 부팅에서 실어 왔다 · DB 행수와 일치(검출 가능한 상태에서 통과)`);
    }
  } else {
    note('G-7 검출력 없음 — 이 픽스처의 DB 에 커밋이 0행이라 "커밋을 실어 오는지" 를 이 실행으로는 증명할 수 없다');
  }
}

/* ── 깊은 비교 실행 ──────────────────────────────────────────────────── */
function compareDeep(expNorm, act, dbFacts) {
  const out = [];
  const e = clone(expNorm), a = clone(act);
  // entries·todos 는 **배열 그대로** 본다 — 접지 않는다(위 ★ 참조)
  const eE = e.entries, aE = a.entries, eT = e.todos, aT = a.todos;
  delete e.entries; delete a.entries; delete e.todos; delete a.todos;
  deepDiff(e, a, '$', out);
  diffArrayOrdered(eE, aE, 'entries', out, dbFacts);
  diffArrayOrdered(eT, aT, 'todos', out, dbFacts);
  for (const d of out) if (!d.cls) d.cls = 'DIFF';       // deepDiff 가 낸 것은 전부 내용/유무 차이다
  return out;
}

const diffLine = (d) => `        ${d.path}  ${d.kind}\n            기준(XML): ${d.exp}\n            실측(DB) : ${d.act}`;

/** 차이를 **갈래별로** 낸다 — [ORDER] 자리 어긋남 / [DIFF] 항목 유무·내용.
 *  둘을 한 통에 담으면 '순서만 틀렸는데 데이터가 깨진 줄' 알거나 그 반대가 된다. */
function emitDiffs(diffs, label, { print = true } = {}) {
  const order = diffs.filter((d) => d.cls === 'ORDER');
  const exempt = diffs.filter((d) => d.cls === 'EXEMPT');
  const rest = diffs.filter((d) => d.cls !== 'ORDER' && d.cls !== 'EXEMPT');
  const head = (arr) => arr.slice(0, 4).map((d) => `${d.path} ${d.kind} 기준=${d.exp} 실측=${d.act}`).join(' | ');
  const arrOf = (d) => d.path.split('[')[0];

  for (const d of exempt) note(`${label} — ${d.kind}`, `기준=${d.exp} / 실측=${d.act}`);

  // ★ 순서 위반은 **배열별로 따로** 낸다 — '어느 배열의 몇 번째가 어긋났나' 가 곧 진단이고,
  //   한 통에 담으면 entries 가 어긋난 것 때문에 todos 가 멀쩡한지도 알 수 없게 된다.
  for (const arr of [...new Set(order.map(arrOf))]) {
    const g = order.filter((d) => arrOf(d) === arr);
    const pos = g.filter((d) => /\[/.test(d.path));        // 자리별
    const sum = g.filter((d) => !/\[/.test(d.path));       // 전체 순서·동률 그룹·원인
    const total = (sum.find((d) => d.badCount !== undefined) || {}).badCount ?? pos.length;
    violate('ORDER', `${label} — ${arr} 배열 순서가 기준(fromXML)과 다르다: ${total}자리`, head(sum.concat(pos)));
    if (print) {
      for (const d of pos.slice(0, 25)) console.log(diffLine(d));
      if (pos.length > 25) console.log(`        … 외 ${pos.length - 25}자리`);
      for (const d of sum) console.log(diffLine(d));
    }
  }
  if (rest.length) {
    violate('DIFF', `${label} — 기준과 다르다: ${rest.length}건`, head(rest));
    if (print) {
      for (const d of rest.slice(0, 40)) console.log(diffLine(d));
      if (rest.length > 40) console.log(`        … 외 ${rest.length - 40}건`);
    }
  }
  if (print) {
    if (!order.length && !rest.length) {
      ok(`${label} — 기준(fromXML)과 완전히 같다 (차이 0건 · 순서까지 인덱스별로 대조)` +
        (exempt.length ? ` ※ 순서 면제 ${exempt.length}구간` : ''));
    } else if (!order.length && !exempt.length) {
      ok(`${label} — 배열 순서는 기준과 같다(entries·todos 인덱스별 일치)`);
    }
  }
  return { order: order.length, diff: rest.length, exempt: exempt.length };
}

function reportDiffs(diffs, label) { return emitDiffs(diffs, label, { print: true }); }

/* ────────────────────────────── 11. §3.5/§3.6 증거 검사 ──────────────────────────────
 * '어댑터가 정말 한 연결에서, 대상 표 전부를, 스냅샷 트랜잭션으로 읽었나' 를
 * performance_schema 의 문장 다이제스트로 **관측**한다(코드를 읽어 짐작하지 않는다). */
//  부팅 조회가 읽어야 하는 표. cal_entry_commit 은 2026-09-01 G-7 개정으로 **들어왔다**
//  (그전에는 이 목록 밖이었고, 오히려 나타나면 위반이었다).
const NINE = ['cal_category', 'cal_entry', 'cal_entry_except', 'cal_entry_commit', 'cal_todo',
  'cal_todo_day_note', 'cal_room', 'cal_task_hours', 'cal_attendance', 'cal_user_pref'];

function psAvailable() {
  const r = mysqlRun(`SELECT ENABLED FROM performance_schema.setup_consumers WHERE NAME='statements_digest';`,
    { db: null, readOnly: true, what: 'performance_schema 확인' });
  if (!r.ok) return false;
  const v = rows(r.out)[0];
  return !!v && v[0] === 'YES';
}
function psReset() {
  const r = mysqlRun('TRUNCATE performance_schema.events_statements_summary_by_digest;', { db: null, what: 'ps 다이제스트 초기화' });
  return r.ok;
}
/** 프로브 **계정의** 누적 접속 수. 서버 전역 카운터(SHOW GLOBAL STATUS 'Connections')를 쓰지 않는 이유:
 *  옆에서 위젯이나 다른 실행이 붙기만 해도 그 수가 섞여 멀쩡한 어댑터가 위반으로 찍힌다(실측). */
function connCount() {
  const r = mysqlRun(`SELECT IFNULL(SUM(TOTAL_CONNECTIONS),0) FROM performance_schema.accounts WHERE USER=${q(PROBE_USER)};`,
    { db: null, readOnly: true, what: '프로브 계정 접속 수' });
  if (!r.ok) return -1;
  const v = rows(r.out)[0];
  return v ? Number(v[0]) : -1;
}
function checkBootQuery(connDelta) {
  const r = mysqlRun(
    `SELECT REPLACE(REPLACE(DIGEST_TEXT,'\\n',' '),'\\t',' '), COUNT_STAR FROM performance_schema.events_statements_summary_by_digest ` +
    `WHERE SCHEMA_NAME=${q(CLONE)} AND DIGEST_TEXT IS NOT NULL ORDER BY FIRST_SEEN;`,
    { db: null, readOnly: true, what: '부팅 조회 문장 관측' });
  if (!r.ok) { note('§3.5 관측 실패 — performance_schema 조회 오류: ' + cleanErr(r.err)); return; }
  const stmts = rows(r.out).map((x) => ({ t: String(x[0]), n: Number(x[1]) }));
  if (!stmts.length) { note('§3.5 관측 불가 — 다이제스트가 비어 있다(계측이 꺼져 있거나 스키마가 잡히지 않았다)'); return; }
  const all = stmts.map((s) => s.t).join('\n');
  const has = (re) => re.test(all);

  // ★ 다이제스트는 리터럴을 `?` 로 정규화한다 — 그래서 '무엇을 실행했나'(변수명·표명·구문)는
  //   여기서 보고, '값이 무엇인가'(REPEATABLE-READ · +00:00 · 5)는 소스 텍스트로 따로 본다.
  //   둘을 합쳐야 "그 문장을 정말 쐈고, 값도 맞다" 가 된다.
  if (!has(/START\s+TRANSACTION\s+WITH\s+CONSISTENT\s+SNAPSHOT/i)) {
    violate('§3.5', '부팅 조회가 `START TRANSACTION WITH CONSISTENT SNAPSHOT` 으로 열리지 않았다 — 같은 사람의 다른 PC 가 부팅 창 안에 커밋하면 데이터가 찢어진다');
  } else ok('§3.5 START TRANSACTION WITH CONSISTENT SNAPSHOT 관측됨');
  if (!has(/transaction_isolation/i)) {
    violate('§3.5', "읽기 연결에 `SET SESSION transaction_isolation` 이 없다 — READ COMMITTED 위에서는 위 스냅샷 구문이 Warning 138 만 남기고 무시된다");
  } else ok('§3.5 transaction_isolation 설정 관측됨');
  if (!has(/time_zone/i)) violate('§3.6', "접속 프리앰블에 `SET SESSION time_zone` 이 없다 — 서버 함수가 한 줄만 섞여도 그 값만 9시간 어긋난 채 영구 혼재한다");
  else ok('§3.6 time_zone 설정 관측됨');
  if (!has(/innodb_lock_wait_timeout/i)) violate('§3.6', '접속 프리앰블에 `SET SESSION innodb_lock_wait_timeout` 이 없다');
  if (!has(/cal_schema_meta/i)) violate('§3.6', '접속 프리앰블이 cal_schema_meta(schema_version)를 읽지 않았다 — 스키마 불일치를 검출할 길이 없다');
  if (!has(/app_user/i)) violate('§3.6', 'login_id → user_id 해석(app_user 조회)이 관측되지 않았다');

  const missed = NINE.filter((t) => !new RegExp(`\\b${t}\\b`, 'i').test(all));
  if (missed.length) violate('§3.5', `부팅 조회가 ${NINE.length}개 표를 다 읽지 않았다 — 빠진 표: ${missed.join(', ')}`);
  else ok(`§3.5 대상 ${NINE.length}개 표 전부 조회됨`);
  if (!/\bcal_entry_commit\b/i.test(all)) violate('§2/G-7', '부팅 조회가 cal_entry_commit 을 읽지 않았다 — 커밋이 빈 배열로 남고 검색·통계·보고서가 전부 조용히 틀린다(G-7 개정 2026-09-01)');
  else ok('§2/G-7 cal_entry_commit 이 부팅 조회에 있다');
  if (!has(/\bCOMMIT\b/i) && !has(/\bROLLBACK\b/i)) violate('§3.5', '부팅 조회 트랜잭션을 닫는 COMMIT/ROLLBACK 이 관측되지 않았다 — 열린 read view 가 undo purge 를 붙잡는다');

  if (connDelta >= 0) {
    if (connDelta > 1) violate('§3.5', `부팅 조회가 연결을 ${connDelta}번 열었다 — 계약은 **한 연결**이다(실측 근거: 12번 connect+auth 887ms → 1번 114ms)`);
    else ok(`§3.5 연결 ${connDelta}회 (계약: 한 연결)`);
  }
  vlog('관측된 문장 ' + stmts.length + '종: ' + stmts.map((s) => s.t.slice(0, 60)).join(' | ').slice(0, 1200));
}

/** 프리앰블 **값** 검사 — 다이제스트가 리터럴을 지우므로 소스에서 본다(관측을 대신하지 않고 보완한다). */
function checkPreambleLiterals(srcPath) {
  if (!srcPath || !existsSync(srcPath)) { note('§3.6 값 검사 생략 — 어댑터 소스를 읽을 수 없다: ' + srcPath); return; }
  const src = readFileSync(srcPath, 'utf8');
  const want = [
    [/transaction_isolation\s*=\s*'REPEATABLE-READ'/i, "transaction_isolation='REPEATABLE-READ'", '§3.5',
      '읽기 연결의 격리수준이 REPEATABLE-READ 로 명시되지 않았다 — 명시가 없으면 WITH CONSISTENT SNAPSHOT 이 Warning 138 만 남기고 무시된다'],
    [/time_zone\s*=\s*'\+00:00'/i, "time_zone='+00:00'", '§3.6',
      "세션 시간대가 '+00:00' 로 고정되지 않았다 — 서버 함수가 한 줄이라도 섞이면 그 값만 9시간 어긋난 채 같은 컬럼에 영구 혼재한다"],
    [/innodb_lock_wait_timeout\s*=\s*5\b/i, 'innodb_lock_wait_timeout=5', '§3.6',
      'innodb_lock_wait_timeout 이 5 가 아니다 — DefaultCommandTimeout(8초)보다 짧아야 DB 가 진단 가능한 1205 를 먼저 낸다'],
  ];
  const missed = [];
  for (const [re, label, code, why] of want) {
    if (re.test(src)) ok(`${code} 프리앰블 값 확인 — ${label}`);
    else { violate(code, `${why} (소스에서 \`${label}\` 을 찾지 못했다: ${srcPath})`); missed.push(label); }
  }
  return missed;
}

/* ────────────────────────────── 12. 변이 시험(--selftest) ──────────────────────────────
 * "잡아내지 못하면 그 불변식은 가짜다." 각 케이스는 act 를 **일부러 깨뜨려** 검사에 통과시키고,
 * 기대한 검출 갈래(코드 + 문구)까지 울었는지 본다. 그냥 아무 이유로나 울면 통과가 아니다. */
/** 정렬 키(entry_date)가 **동률**인 이웃 두 자리의 앞 인덱스. 없으면 -1.
 *  동률 자리에서만 바꿔야 '단조' 검사를 통과한 채 순서만 어긋난 상태를 만들 수 있다. */
function tiePairIndex(entries) {
  const a = entries || [];
  for (let i = 0; i + 1 < a.length; i++) if (String(a[i].date) === String(a[i + 1].date)) return i;
  return -1;
}

function mutationSuite(expNorm, act, expRaw, dbFacts) {
  const M = [];
  const add = (code, why, mustCode, mustText, fn, precond, mustNotText) =>
    M.push({ code, why, mustCode, mustText, fn, precond, mustNotText });

  add('M1', 'G-2 — 빈 문자열이어야 할 자리를 null 로', 'G-2', /빈 문자열로 되돌리지 않았다/, (a) => {
    const e = a.entries.find((x) => x.startTime === ''); e.startTime = null; return `entries[${e.id}].startTime = null`;
  }, (a) => a.entries.some((x) => x.startTime === ''));

  add('M2', "G-3 — ISO 'Z' 대신 DB 원문", 'G-3', /ISO 'Z'/, (a) => {
    const e = a.entries[0]; e.createdAt = String(e.createdAt).replace('T', ' ').replace(/\.(\d{3})Z$/, '.$1');
    return `entries[${e.id}].createdAt = '${e.createdAt}'`;
  }, (a) => a.entries.length > 0);

  add('M3', 'G-4 — boolean 대신 0/1', 'G-4', /0\/1 을 그대로 넘겼다/, (a) => {
    const e = a.entries[0]; e.allDay = e.allDay ? 1 : 0; return `entries[${e.id}].allDay = ${e.allDay}`;
  }, (a) => a.entries.length > 0);

  add('M4', 'G-5 — categories ORDER BY 누락(자리 뒤바뀜)', 'DIFF', /기준과 다르다/, (a) => {
    const t = a.categories[0]; a.categories[0] = a.categories[1]; a.categories[1] = t; return 'categories[0] ↔ categories[1]';
  }, (a) => a.categories.length > 1);

  /* ★ 2026-08-27 — 겨냥은 그대로('entries 의 ORDER BY 가 통째로 틀렸다')이고 **판정처만 옮겼다.**
   *   전에는 'entry_date 오름차순이 아니다'(G-5 단조 검사)가 잡기를 기대했는데, 그 검사는 기준이
   *   갖지 않은 성질을 요구하던 것이라 삭제했다(contractChecks 의 ★). 이제는 [ORDER] 가 기준과
   *   인덱스별로 대조해서 잡는다 — 더 강한 판정이다(날짜뿐 아니라 **문서 순서**를 본다).
   *   precond 도 '뒤집으면 날짜가 어긋나는가' 에서 '뒤집으면 배열 순서가 실제로 달라지는가' 로 바꿨다:
   *   옛 조건은 날짜축 기준이라, 문서 순서가 뒤집혔는데도 날짜가 우연히 대칭이면 SKIP 이 됐다. */
  add('M5', '순서 — entries 를 통째로 역순(ORDER BY 가 아예 틀린 경우)', 'ORDER', /순서가 다르다/, (a) => {
    a.entries.reverse(); return 'entries 배열을 뒤집었다';
  }, (a) => {
    const ids = (a.entries || []).map((x) => String(x.id));
    return ids.length > 1 && ids.join('|') !== ids.slice().reverse().join('|');
  });

  /* ★ M6/M6b — 회의실은 `_no` 가 없다(PK 가 name). 그래서 ORDER BY 를 빠뜨린 어댑터가
   *   돌려주는 것은 **이름순**이고, 그것이 이 변이가 재현하는 상태다.
   *   real 픽스처의 회의실 4개는 **우연히 이미 이름순**이라 M6 를 만들 수 없다(SKIP) —
   *   실 data.xml 은 사용자 자료라 고칠 수 없으므로 그 자리는 synth 가 덮는다.
   *   M6b(이름 역순)를 나란히 두는 이유는 `_no` 에서 실제로 났던 사고와 같은 부류이기 때문이다:
   *   표시 순서가 어느 한쪽 방향으로 재현되면 그 방향으로 정렬한 어댑터가 초록으로 통과한다. */
  add('M6', 'G-5 — rooms ORDER BY 누락(이름 오름차순으로)', 'DIFF', /기준과 다르다/, (a) => {
    a.rooms = a.rooms.slice().sort(); return 'rooms 를 이름 오름차순으로 정렬';
  }, (a) => a.rooms.length > 1 && a.rooms.join('|') !== a.rooms.slice().sort().join('|'));

  add('M6b', 'G-5 — rooms 를 이름 내림차순으로(금지된 정렬키)', 'DIFF', /기준과 다르다/, (a) => {
    a.rooms = a.rooms.slice().sort().reverse(); return 'rooms 를 이름 내림차순으로 정렬';
  }, (a) => a.rooms.length > 1 && a.rooms.join('|') !== a.rooms.slice().sort().reverse().join('|'));

  add('M7', 'G-5 — 근태 맵에서 하루가 사라짐', 'DIFF', /키가 없다/, (a) => {
    const k = Object.keys(a.attendance)[0]; delete a.attendance[k]; return `attendance['${k}'] 삭제`;
  }, (a) => Object.keys(a.attendance || {}).length > 0);

  //  M8 은 방향이 바뀌었다 — 예전에는 'lsMigrated 가 true 가 아니면 위반' 이었다.
  //  그 키를 2026-09-01 에 없앴으므로(자동이관 폐기), 이제 시험할 것은 **되살아나면 걸리는가** 다.
  add('M8', 'G-0 — 없앤 lsMigrated 키가 되살아남', 'G-0', /최상위에 없어야 할 키가 있다/, (a) => {
    a.lsMigrated = true; return 'lsMigrated 키를 되살림';
  }, () => true);

  add('M9', 'G-7(개정) — 부팅 조회가 커밋을 빠뜨림', 'G-7', /커밋을 다 싣지 않았다/, (a) => {
    //  지연 조회 시절로 되돌아간 상태를 그대로 만든다 — 그때 보고서가 통째로 비었다.
    let n = 0;
    for (const e of a.entries) { n += (e.commits || []).length; e.commits = []; }
    return `commits 를 전부 [] 로 비움(${n}개 삭제)`;
  }, (a) => a.entries.some((e) => (e.commits || []).length > 0));

  add('M10', 'G-1c — categoryId 에 cat_no(숫자)를 흘림', 'G-1c', /categoryId 가 숫자다/, (a) => {
    const e = a.entries.find((x) => x.categoryId != null); e.categoryId = 7; return `entries[${e.id}].categoryId = 7`;
  }, (a) => a.entries.some((x) => x.categoryId != null));

  add('M11', 'G-0 — 최상위에 없어야 할 키', 'G-0', /없어야 할 키가 있다/, (a) => {
    a.userId = 25; return '최상위에 userId 추가';
  }, () => true);

  add('M12', '키 유무 — 개인 과제에 source 키를 만듦', 'G-6', /키 유무 계약을 어겼다/, (a) => {
    const c = a.categories.find((x) => !Object.prototype.hasOwnProperty.call(x, 'source'));
    c.source = 'local'; return `categories[${c.id}].source = 'local'`;
  }, (a) => a.categories.some((x) => !Object.prototype.hasOwnProperty.call(x, 'source')));

  add('M13', 'G-1d — state 에 entry_no 를 흘림', 'G-1d', /흘리면 안 되는 키/, (a) => {
    a.entries[0].entry_no = 3; return `entries[${a.entries[0].id}].entry_no = 3`;
  }, (a) => a.entries.length > 0);

  add('M14', 'G-2b — remind 0(알림 없음)을 null(기본 사다리)로', 'DIFF', /(값|자료형)이 다르다/, (a) => {
    const e = a.entries.find((x) => x.remind === 0); e.remind = null; return `entries[${e.id}].remind: 0 → null`;
  }, (a) => a.entries.some((x) => x.remind === 0));

  add('M15', 'DECIMAL 을 문자열로 — taskHours 값이 숫자가 아님', 'G-5', /taskHours 값이 숫자가 아니다/, (a) => {
    const d = Object.keys(a.taskHours)[0]; const k = Object.keys(a.taskHours[d])[0];
    a.taskHours[d][k] = String(a.taskHours[d][k]); return `taskHours['${d}']['${k}'] → 문자열`;
  }, (a) => Object.keys(a.taskHours || {}).length > 0);

  add('M16', '키 유무 — 일정에서 hours 키를 통째로 뺌(undefined)', 'G-6', /hours 키가 아예 없다/, (a) => {
    delete a.entries[0].hours; return `entries[${a.entries[0].id}].hours 키 삭제`;
  }, (a) => a.entries.length > 0);

  // ★ 다중집합(항목 유무) 비교는 순서 비교로 대체된 것이 아니라 **나란히** 남아 있다.
  //   문구가 '키가 없다' → '항목이 없다' 로 바뀐 것은 배열을 객체로 접지 않게 됐기 때문이다.
  add('M17', '다중집합 — 할 일 한 건이 통째로 사라짐', 'DIFF', /항목이 없다/, (a) => {
    const t = a.todos.pop(); return `todos 마지막(${t.id}) 삭제`;
  }, (a) => (a.todos || []).length > 0);

  /* ── usesRepo(§4 · schema_version 5) 전용 변이 ───────────────────────────
   * 겨냥이 둘이다. 둘 다 **DB 는 멀쩡한데 화면만 조용히 틀리는** 형태라 눈으로는 안 보인다.
   *   M18 — 어댑터가 uses_repo 를 안 읽고 값을 뒤집는다(또는 상수를 넣는다) →
   *          '저장소를 쓰는 과제'인데 「연동」 섹션이 그대로 숨겨진다. §4 가 없애려던 그 상태다.
   *   M19 — 키를 아예 안 만든다(undefined) → JS 에서 undefined 는 false 와 같은 자리에 떨어져
   *          '경로 없음 안내' 분기가 통째로 사라진다. **오류는 하나도 안 난다.** */
  add('M18', 'G-6 — usesRepo 값을 뒤집음(DB 의 비트를 안 나름)', 'DIFF', /값이 다르다/, (a) => {
    const c = a.categories.find((x) => typeof x.usesRepo === 'boolean');
    c.usesRepo = !c.usesRepo; return `categories[${c.id}].usesRepo → ${c.usesRepo}`;
  }, (a) => (a.categories || []).some((x) => typeof x.usesRepo === 'boolean'));

  add('M19', '키 유무 — 과제에서 usesRepo 키를 통째로 뺌(undefined)', 'DIFF', /키가 없다/, (a) => {
    const c = a.categories.find((x) => Object.prototype.hasOwnProperty.call(x, 'usesRepo'));
    delete c.usesRepo; return `categories[${c.id}].usesRepo 키 삭제`;
  }, (a) => (a.categories || []).some((x) => Object.prototype.hasOwnProperty.call(x, 'usesRepo')));

  add('M20', 'G-4 — usesRepo 를 boolean 이 아니라 0/1 로', 'DIFF', /자료형이 다르다/, (a) => {
    const c = a.categories.find((x) => typeof x.usesRepo === 'boolean');
    c.usesRepo = c.usesRepo ? 1 : 0; return `categories[${c.id}].usesRepo = ${c.usesRepo}`;
  }, (a) => (a.categories || []).some((x) => typeof x.usesRepo === 'boolean'));

  /* ── 순서 전용 변이 ─────────────────────────────────────────────────────
   * 결함 A 가 있던 자리를 정면으로 겨눈다. 셋 다 **항목은 하나도 잃지 않고 자리만** 바꾼다 —
   * 옛 비교기(byId 로 접던 것)는 셋 다 "차이 0건" 으로 통과시켰다. */

  // MO1 — 같은 날짜 두 건의 자리 바꾸기(날짜 자체는 그대로).
  //   ★ 이 자리를 고르는 이유: 같은 날짜 안이 바로 **결함 B 가 화면에 새는 유일한 경로**다.
  //     앱은 날짜로 먼저 묶은 뒤 entrySort 로 정렬하는데(entriesOn·groupByDateHtml), 그 정렬이
  //     동률이면 배열 순서가 그대로 보인다. 즉 '항목도 날짜도 안 잃었는데 화면 순서만 틀린' 상태.
  //   ※ 2026-08-27 이전에는 여기에 "'entry_date 단조' 검사(G-5)는 여전히 통과한다" 는 설명이 붙어
  //     있었다. 그 검사는 삭제됐다(위 contractChecks 의 ★ 참조 — 기준이 갖지 않은 성질이었다).
  //     변이의 겨냥은 그대로다: 이 변이를 잡는 것은 오직 [ORDER] 뿐이다.
  add('MO1', '순서 — entries 동률 그룹 안에서 자리 바꾸기(날짜는 그대로)', 'ORDER', /순서가 다르다/, (a) => {
    const i = tiePairIndex(a.entries);
    const t = a.entries[i]; a.entries[i] = a.entries[i + 1]; a.entries[i + 1] = t;
    return `entries[${i}](${a.entries[i + 1].id}) ↔ entries[${i + 1}](${a.entries[i].id}) · date=${a.entries[i].date} 동률`;
  }, (a) => tiePairIndex(a.entries) >= 0);

  // MO2 — todos 전체를 역순으로.
  add('MO2', '순서 — todos 를 통째로 역순', 'ORDER', /순서가 다르다/, (a) => {
    a.todos.reverse(); return `todos ${a.todos.length}건을 뒤집었다`;
  }, (a) => {
    const ids = (a.todos || []).map((t) => String(t.id));
    return ids.length > 1 && ids.join('|') !== ids.slice().reverse().join('|');
  });

  // MO3 — 배열 **하나만** 회전. entries 는 손대지 않는다 →
  //   어긋난 자리가 todos 로만 보고되는지(자리 귀속이 맞는지)까지 본다.
  add('MO3', '순서 — todos 만 한 칸 회전(entries 는 그대로)', 'ORDER', /\$\.todos\[/, (a) => {
    a.todos.unshift(a.todos.pop()); return `todos 를 한 칸 회전(마지막 → 첫째: ${a.todos[0].id})`;
  }, (a) => (a.todos || []).length > 1, /\$\.entries\[\d+\] 순서가 다르다/);

  /** 한 상태를 전 검사에 통과시키고 운 위반을 그대로 모은다(통과줄은 capture 가 막는다). */
  const runAll = (a0) => withCapture(() => {
    contractChecks(expNorm, a0, expRaw, dbFacts);
    emitDiffs(compareDeep(expNorm, a0, dbFacts), '깊은 비교', { print: false });
  }).bucket;
  const sig = (v) => `${v.code}\u0000${v.desc}\u0000${v.detail === undefined ? '' : String(v.detail)}`;

  // ── 기준선 — 변이하지 않은 상태에서 이미 우는 것들 ──────────────────────
  //   ★ 어댑터/스키마에 **실제 결함**이 있으면 여기가 비어 있지 않다. 그때 '오탐'이라 부르면
  //     진짜 결함을 검출기 탓으로 돌리게 된다. 그래서 기준선은 (a) 그대로 보고하고
  //     (b) 각 변이의 판정에서 **빼고** 본다(변이가 새로 울린 것만 센다).
  const base = runAll(clone(act));
  const baseSig = new Set(base.map(sig));
  const baseOrder = base.filter((v) => v.code === 'ORDER');
  const baseOther = base.filter((v) => v.code !== 'ORDER');

  let caught = 0, missed = 0, skipped = 0;
  const detail = [];
  log('');
  log(`── 변이 시험 — 검출기가 정말 우는가(${M.length}케이스) ──`);
  if (base.length) {
    console.log(`  · 기준선 — 변이 없이도 이미 ${base.length}건이 운다(ORDER ${baseOrder.length} · 그 밖 ${baseOther.length}).` +
      ` 아래 판정은 이 기준선을 **빼고** 본다.`);
    for (const v of base.slice(0, 6)) console.log(`        [${v.code}] ${v.desc}`);
  }
  for (const m of M) {
    const a0 = clone(act);
    if (m.precond && !m.precond(a0)) {
      skipped++; detail.push({ code: m.code, r: 'SKIP', why: m.why, msg: '픽스처에 해당 자료가 없다' });
      console.log(`  · ${m.code} SKIP  ${m.why} — 이 픽스처로는 만들 수 없다`);
      continue;
    }
    let what = '';
    try { what = m.fn(a0) || ''; } catch (e) { what = '변이 실패: ' + e.message; }
    const bucket = runAll(a0);
    const fresh = bucket.filter((v) => !baseSig.has(sig(v)));      // 이 변이가 **새로** 울린 것만
    const txt = (v) => `${v.desc}\n${v.detail === undefined ? '' : String(v.detail)}`;
    const hitCode = fresh.some((v) => v.code === m.mustCode);
    const hitText = fresh.some((v) => m.mustText.test(txt(v)));
    const banned = m.mustNotText ? fresh.filter((v) => m.mustNotText.test(txt(v))) : [];
    if (hitCode && hitText && !banned.length) {
      caught++; detail.push({ code: m.code, r: 'CAUGHT', why: m.why });
      console.log(`  ✓ ${m.code} CAUGHT [${m.mustCode}] ${m.why}  (${what})`);
    } else {
      missed++;
      detail.push({ code: m.code, r: 'MISSED', why: m.why, got: fresh.map((v) => v.code).join(',') });
      console.log(`  ✗ ${m.code} MISSED ${m.why}  (${what})`);
      if (banned.length) {
        console.log(`        엉뚱한 배열까지 어긋났다고 울었다(귀속 오류): ${banned.map((v) => `[${v.code}] ${v.desc.slice(0, 70)}`).join(' / ')}`);
      }
      console.log(`        기대: [${m.mustCode}] ${m.mustText}   새로 운 것: ${fresh.length ? fresh.map((v) => `[${v.code}] ${v.desc.slice(0, 70)}`).join(' / ') : '(아무것도 새로 울지 않았다)'}`);
      violate('SELFTEST', `${m.code} — 이 변이를 검출하지 못했다: ${m.why}. **그 검사는 장식이다.**`);
    }
  }

  // ── 오탐 확인 ① 순서 비교기 — **순서가 정말 맞을 때** 조용한가 ─────────────
  //   기준선에 ORDER 가 있어도(=실제 결함) 이 검사는 성립한다: act 를 기준 순서로
  //   **다시 늘어놓기만** 하고(내용·항목은 그대로) ORDER 가 사라지는지 본다.
  //   사라지지 않으면 그 순서 비교기는 오탐한다.
  const reordered = clone(act);
  for (const what of ['entries', 'todos']) {
    const want = (expNorm[what] || []).map((x, i) => idAt(x, i));
    const by = new Map((reordered[what] || []).map((x, i) => [idAt(x, i), x]));
    const head = want.map((k) => by.get(k)).filter(Boolean);
    const tail = (reordered[what] || []).filter((x, i) => !want.includes(idAt(x, i)));
    reordered[what] = head.concat(tail);
  }
  const reBucket = runAll(reordered).filter((v) => v.code === 'ORDER');
  if (reBucket.length) {
    violate('SELFTEST', `순서 비교기가 오탐한다 — 기준과 **같은 순서**로 늘어놓았는데도 ORDER 가 ${reBucket.length}건 울었다`,
      reBucket.map((v) => `${v.desc} | ${v.detail}`).join(' // ').slice(0, 800));
  } else {
    console.log(`  ✓ 오탐 확인① 순서 비교기 — 기준과 같은 순서로 늘어놓으면 ORDER 가 0건이다(정상 데이터 오탐 없음)`);
  }

  // ── 오탐 확인 ② 변이 없음 상태 ─────────────────────────────────────────
  //   ORDER 는 위 ①이 '순서를 맞추면 사라진다'를 증명했으므로 오탐이 아니라 **실측 결함**이다.
  //   그 밖의 코드가 변이 없이 울면 그것은 검출기의 오탐이다.
  if (baseOther.length) {
    violate('SELFTEST', `변이하지 않은 상태에서 순서 외 ${baseOther.length}건이 울었다 — 검출기가 오탐한다`,
      baseOther.map((v) => `[${v.code}] ${v.desc}`).join(' | ').slice(0, 600));
  } else if (baseOrder.length) {
    console.log(`  ✓ 오탐 확인② 변이 없음 상태에서 순서 외 위반 0건 ` +
      `(ORDER ${baseOrder.length}건은 남는다 — 오탐이 아니라 실제 순서 결함이다. 본문 판정을 보라)`);
  } else {
    console.log(`  ✓ 변이 없음 상태에서는 조용하다(오탐 0)`);
  }
  log(`변이 시험 결과 — CAUGHT ${caught} · MISSED ${missed} · SKIP ${skipped} / ${M.length}`);
  return { caught, missed, skipped, total: M.length, detail, baseOrder: baseOrder.length };
}

/* ────────────────────────────── 13. 요약 ────────────────────────────── */
let RUN = { fixtures: [], mutations: [], adapter: null, oracle: null, declared: [] };

function printSummary(_x, abortMsg) {
  if (summaryPrinted) return;
  summaryPrinted = true;
  console.log('');
  console.log('════════════════════════ 요약 ════════════════════════');
  console.log(`기준(fromXML) 실행처 : ${RUN.oracle || '(없음)'}`);
  console.log(`어댑터               : ${RUN.adapter || '(없음)'}`);
  for (const f of RUN.fixtures) console.log(`픽스처 ${f.name.padEnd(6)}      : ${f.summary}`);
  if (RUN.declared.length) {
    console.log('계약상 차이(숨기지 않는다 — 이 표에 없는 차이는 전부 위반이다):');
    for (const d of RUN.declared) console.log('   · ' + d);
  }
  // ★ 순서 비교 면제 — 비어 있지 않으면 그만큼 '같다' 의 뜻이 약해진 것이다. 항상 찍는다.
  if (orderExemptUsed.length) {
    console.log('순서 비교 면제(★ 이만큼은 "순서가 같다"를 증명하지 않았다):');
    for (const x of orderExemptUsed) console.log(`   · ${x.array} — ${x.why}${x.ref ? ` [${x.ref}]` : ''}`);
  } else {
    console.log(`순서 비교 면제        : 없음 (ORDER_EXEMPT 가 비어 있다 — entries·todos 순서를 기준과 인덱스별로 전부 대조했다)`);
  }
  // ★ 픽스처 조건 — '이 픽스처로는 그 결함을 만들 수 없다'. 검사 결과가 아니라 **검사의 한계**라서
  //   참고 더미에 섞어 두면 읽히지 않는다. 따로 세워 둔다.
  const fixNotes = notes.filter((n) => /픽스처 조건/.test(n.msg));
  if (fixNotes.length) {
    console.log('픽스처 조건(★ 이만큼은 그 픽스처로 검출할 수 없다 — 아래 변이 시험이 다른 픽스처로 덮였는지 보여 준다):');
    for (const n of fixNotes) console.log('   · ' + n.msg);
  }

  /* ★ SKIP 은 통과가 아니다 — '이 픽스처로는 그 변이를 만들 수 없었다' 일 뿐이다.
   *   그래서 **다른 픽스처가 같은 변이를 CAUGHT 했는지** 여기서 대조한다.
   *   덮이지 않은 SKIP 이 하나라도 남으면 그 실행은 완전한 게이트가 아니다
   *   (전형: `--fixture=real` 단독 — 실 data.xml 의 회의실이 이미 이름순이라 M6 를 만들 수 없다). */
  const caughtIn = new Map();
  for (const m of RUN.mutations) {
    for (const d of m.detail) {
      if (d.r !== 'CAUGHT') continue;
      if (!caughtIn.has(d.code)) caughtIn.set(d.code, []);
      caughtIn.get(d.code).push(m.fixture);
    }
  }
  const openAll = new Map();   // 어떤 픽스처도 못 덮은 변이 → 사유
  for (const m of RUN.mutations) {
    console.log(`변이 시험 [${m.fixture}]  : CAUGHT ${m.caught} · MISSED ${m.missed} · SKIP ${m.skipped} / ${m.total}` +
      (m.missed ? `  ← MISSED 가 있으면 그 검사는 장식이다` : '') +
      (m.skipped ? `  (SKIP=픽스처에 해당 자료가 없어 만들 수 없는 변이)` : '') +
      (m.baseOrder ? `  · 기준선 ORDER ${m.baseOrder}건은 빼고 셌다(실제 결함)` : ''));
    const skips = m.detail.filter((d) => d.r === 'SKIP');
    if (!skips.length) continue;
    const covered = skips.filter((d) => caughtIn.has(d.code));
    const open = skips.filter((d) => !caughtIn.has(d.code));
    for (const d of open) openAll.set(d.code, d.why);
    if (covered.length) {
      console.log(`   · SKIP 중 덮인 것 : ` +
        covered.map((d) => `${d.code}(→${[...new Set(caughtIn.get(d.code))].join('/')})`).join(' · '));
    }
    if (open.length) {
      console.log(`   ✗ SKIP 중 **아무 픽스처도 덮지 못한 것** : ${open.map((d) => `${d.code} ${d.why}`).join(' · ')}`);
    }
  }
  if (RUN.mutations.length) {
    if (openAll.size) {
      console.log(`★ 이 실행은 **완전한 게이트가 아니다** — ${[...openAll.keys()].join('·')} 를 어떤 픽스처로도 만들지 못했다.`);
      console.log(`   real 픽스처는 사용자 실데이터라 고칠 수 없다(읽기 전용). \`--fixture=both --selftest\` 로 돌려 synth 가 그 자리를 덮게 하라.`);
    } else if (RUN.mutations.some((m) => m.skipped)) {
      console.log(`   ↳ SKIP 은 전부 다른 픽스처가 덮었다 — 이 실행의 변이 커버리지에 구멍이 없다.`);
    }
  }
  if (truncSeen) console.log(`mysql 출력 잘림       : 감지 ${truncSeen}회 · 회복 ${truncRecovered}회 · 미회복 ${truncUnrecovered}회`);
  const otherNotes = notes.filter((n) => !/픽스처 조건/.test(n.msg));
  if (otherNotes.length) {
    console.log('참고:');
    for (const n of otherNotes) console.log('   · ' + n.msg);
  }
  console.log('');
  if (abortMsg) {
    console.log('판정 없음 — 검사를 끝까지 수행하지 못했다: ' + abortMsg);
    console.log('  (종료코드 2. 이것은 통과가 아니다.)');
  } else if (violations.length === 0) {
    console.log('위반 없음 ✓ — 같은 데이터를 XML 에서 읽은 것과 DB 에서 읽은 것이 완전히 같다.');
  } else {
    const byCode = new Map();
    for (const v of violations) byCode.set(v.code, (byCode.get(v.code) || 0) + 1);
    console.log(`위반된 계약: ${[...byCode.entries()].map(([k, n]) => `${k}(${n})`).join(' · ')}`);
    for (const v of violations.slice(0, 20)) console.log(`   ✗ [${v.code}] ${v.desc}`);
    if (violations.length > 20) console.log(`   … 외 ${violations.length - 20}건`);
  }
  console.log('══════════════════════════════════════════════════════');
}

/* ────────────────────────────── 14. 본문 ────────────────────────────── */

async function main() {
  const oracle = await openOracle();
  RUN.oracle = oracle.kind === 'cdp' ? `CDP 위젯(포트 ${OPT.cdpPort})` : 'jsdom(task-calendar-prototype.html)';

  createClone();

  // 사용자 해석 — 없는 사람의 user_id 를 만들어 내지 않는다(§3.6)
  const ur = mustQuery(`SELECT user_id FROM app_user WHERE login_id=${q(OPT.loginId)};`, '사용자 해석', CLONE);
  if (ur.length !== 1) {
    const some = mustQuery('SELECT login_id FROM app_user ORDER BY user_id LIMIT 8;', '사용자 후보', CLONE).map((x) => x[0]);
    envFail(`app_user 에 login_id='${OPT.loginId}' 가 없습니다 — user_id 를 만들어 내지 않습니다(§3.6).`,
      '후보: ' + some.join(', ') + ' … → --login-id= 로 지정하세요.');
  }
  const userId = Number(ur[0][0]);
  log(`대상 사용자 — login_id='${OPT.loginId}' → user_id=${userId} (복제본)`);

  // 어댑터 준비
  let useAdapter = true;
  if (!OPT.referenceAdapter && !existsSync(CALENDARDB_CS)) {
    if (!OPT.selftest) {
      envFail('widget/CalendarDb.cs 가 없습니다 — 시험할 어댑터가 아직 없습니다.',
        '이 파일은 대조 하네스이지 어댑터 구현이 아닙니다. ' +
        '하네스 자체 검증: `--reference-adapter`(내장 참조 어댑터로 전 구간) 또는 `--selftest`(비교기 변이 시험).');
    }
    useAdapter = false;
    note('★ widget/CalendarDb.cs 가 없다 — **어댑터 없이** 하네스만 검증한다. ' +
      '이 실행의 통과는 "어댑터가 옳다"의 증거가 아니라 "픽스처·비교기·검출기가 옳다"의 증거다.');
    RUN.adapter = '(없음 — widget/CalendarDb.cs 미구현. 하네스 자체 검증만 수행)';
  } else {
    const built = buildProbe();
    RUN.adapter = built.sourceKind + (OPT.referenceAdapter ? ' ★테스트 전용 대조본' : '');
    adapterSrcPath = built.sourcePath;
  }

  // 픽스처 목록
  const fixtures = [];
  if (OPT.fixture === 'real' || OPT.fixture === 'both') fixtures.push({ name: 'real', xml: realFixtureXml() });
  if (OPT.fixture === 'synth' || OPT.fixture === 'both') {
    const pr = mustQuery('SELECT uid FROM project ORDER BY uid LIMIT 1;', '공식 과제 표본', CLONE);
    const projectUid = pr.length ? pr[0][0] : null;
    if (!projectUid) note('복제본의 project 가 0행이다 — dbGone=false 인 공식 과제는 합성 픽스처에서 뺀다');
    fixtures.push({ name: 'synth', xml: synthFixtureXml(projectUid) });
  }

  if (useAdapter) { curPhase = '프리앰블'; checkPreambleLiterals(adapterSrcPath); }

  const psOk = useAdapter && psAvailable();
  if (useAdapter && !psOk) note('performance_schema statements_digest 가 꺼져 있다 — §3.5/§3.6 문장 관측을 건너뛴다(코드 짐작으로 대신하지 않는다)');

  for (const f of fixtures) {
    curPhase = f.name;
    log('');
    log(`══ 픽스처 [${f.name}] ══`);
    const exp = await oracle.run(f.xml);
    if (!exp || typeof exp !== 'object') envFail(`기준 실행이 객체를 돌려주지 않았다(${f.name})`, short(exp));
    const kmiss = TOP15.filter((k) => !Object.prototype.hasOwnProperty.call(exp, k));
    if (kmiss.length) envFail(`기준(fromXML) 결과에 15키가 없다 — 오라클이 이상하다: ${kmiss.join(', ')}`);
    log(`기준 산출 — 과제 ${exp.categories.length} · 일정 ${exp.entries.length} · 할일 ${exp.todos.length} · ` +
      `장소 ${exp.rooms.length} · 공수 ${Object.keys(exp.taskHours).length}일 · 근태 ${Object.keys(exp.attendance).length}일`);

    const maps = loadFixtureIntoDb(exp, userId);
    verifyLoaded(exp, userId, maps);

    // DB 사실 — 검출 가능성의 근거
    const dbf = batch([
      { key: 'cmt', sql: `SELECT COUNT(*) FROM cal_entry_commit WHERE user_id=${userId}` },
      { key: 'tno', sql: `SELECT uid FROM cal_todo WHERE user_id=${userId} ORDER BY todo_no` },
      { key: 'tdue', sql: `SELECT uid FROM cal_todo WHERE user_id=${userId} ORDER BY due` },
      { key: 'eno', sql: `SELECT uid FROM cal_entry WHERE user_id=${userId} ORDER BY entry_no` },
    ], { what: 'DB 사실 수집' });
    const todoNoOrder = (dbf.get('tno') || []).map((x) => x[0]);
    const todoDueOrder = (dbf.get('tdue') || []).map((x) => x[0]);
    const dbFacts = {
      commitRows: Number((dbf.get('cmt')[0] || ['0'])[0]),
      todoNoOrder,
      entryNoOrder: (dbf.get('eno') || []).map((x) => x[0]),
      todoOrderDistinguishable: todoNoOrder.join('|') !== todoDueOrder.join('|'),
    };
    if (!dbFacts.todoOrderDistinguishable && todoNoOrder.length > 1) {
      note(`[${curPhase}] 픽스처 조건 미달 — todo_no 순서와 due 순서가 같아 todos ORDER BY 누락을 이 픽스처로는 구분할 수 없다`);
    }

    // 어댑터 실행
    let act, localReposAccepted = false;
    if (useAdapter) {
      const reposPath = join(PROBE_DIR, `local-repos-${f.name}.json`);
      writeFileSync(reposPath, JSON.stringify(maps.localRepos), 'utf8');
      let connBefore = -1;
      if (psOk) { psReset(); connBefore = connCount(); }
      const pr = runProbe(OPT.loginId, reposPath);
      act = pr.value;
      localReposAccepted = !!(probeMeta && probeMeta.localRepos);
      if (probeMeta) log(`어댑터 호출 — ${probeMeta.type}.${probeMeta.method}(${probeMeta.params}) · 로컬저장소 주입=${localReposAccepted ? '받음' : '안 받음'}`);
      // 계측은 프로브 **계정** 기준이라 우리 측정용 접속(관리자 계정)은 섞이지 않는다.
      if (psOk) checkBootQuery(connBefore >= 0 ? connCount() - connBefore : -1);
    } else {
      // 어댑터가 없다 — '완벽한 어댑터' 를 흉내 내 비교기·검출기만 시험한다(위 note 참조).
      act = null;
    }

    const { exp: expNorm, applied } = normalizeExpected(exp, { localReposAccepted });
    if (!RUN.declared.length) RUN.declared = applied;
    if (!useAdapter) act = clone(expNorm);

    contractChecks(expNorm, act, exp, dbFacts);
    reportDiffs(compareDeep(expNorm, act, dbFacts), `깊은 비교 [${f.name}]`);

    RUN.fixtures.push({
      name: f.name,
      summary: `과제 ${exp.categories.length} · 일정 ${exp.entries.length} · 할일 ${exp.todos.length} · 장소 ${exp.rooms.length} · ` +
        `커밋 ${dbFacts.commitRows}행(부팅에서 적재 확인) · 근태 ${Object.keys(exp.attendance).length}일`,
    });

    if (OPT.selftest) RUN.mutations.push({ fixture: f.name, ...mutationSuite(expNorm, act, exp, dbFacts) });
  }

  curPhase = 'done';
  try { oracle.close(); } catch (_) { }
  printSummary(null, null);
  process.exitCode = violations.length ? 1 : 0;
}

main().then(() => { }, (e) => {
  if (e && (e.tcOutputLoss || isEnvErrno(e.sqlErrno))) {
    try { envFail(e.tcOutputLoss ? 'mysql 출력 유실 — ' + e.message : `DB 오류 errno=${e.sqlErrno}`, e.tcDetail || e.message); } catch (_) { }
    process.exit(2);
  }
  console.error(e);
  try { printSummary(null, '예외로 중단: ' + (e && e.message)); } catch (_) { }
  process.exit(1);
});
