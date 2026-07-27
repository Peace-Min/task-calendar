#!/usr/bin/env node
/* =====================================================================================
 * tests/loop-ui-integrity.mjs — 라이브 위젯 루프 UI 정합성 테스트(실배포 전 게이트)
 *
 * ★ 이 파일은 `node tests/run-tests.mjs`의 기본 스위트에 포함되지 않는다.
 *   러너는 `readdirSync(tests).filter(f => f.endsWith('.test.mjs'))`로만 수집하므로
 *   확장자를 `.mjs`(≠ `.test.mjs`)로 둔 것만으로 자동수집에서 빠진다(러너 수정 없음).
 *
 * 무엇을 하나:
 *   이미 떠 있는 위젯(TC_DEBUG_PORT=9222)에 CDP로 붙어 **실제 DOM을 클릭·입력**해
 *   구분/상태 코드값(#codeModal)과 발주처(#customerModal)를 무작위 시퀀스로 반복 편집하고,
 *   매 조작 뒤 MySQL을 직접 조회해 정합성 불변식(I1~I8)을 검사한다.
 *   중간중간 DB 계정을 잠가 온라인→오프라인→온라인 전환(시나리오 A/B/C)을 주입한다.
 *
 * 전제(이 스크립트가 하지 않는 것):
 *   · 위젯 실행/종료를 하지 않는다. 9222에 이미 붙어 있어야 한다(없으면 친절한 에러로 종료).
 *   · 관리자 인증을 하지 않는다. 시작 시 getRole()==='admin'인지 **확인만** 하고 아니면 중단.
 *   · DB 데이터를 스스로 복원하지 않는다(운영자가 스냅샷 보유). 단 **자기가 건 ACCOUNT LOCK은 반드시 푼다**.
 *
 * 실행:
 *   node tests/loop-ui-integrity.mjs                       # 기본 60조작, 고정 시드
 *   node tests/loop-ui-integrity.mjs --ops=120 --seed=42
 *   node tests/loop-ui-integrity.mjs --selfcheck           # 위젯 없이 DB 계층/불변식 계산만 점검(읽기 전용)
 *   node tests/loop-ui-integrity.mjs --no-offline          # 오프라인 시나리오 생략(계정 잠금 권한 없을 때)
 *
 * 종료코드: 위반 0 → 0, 아니면 1.
 * ===================================================================================== */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

/* ────────────────────────────── 0. 설정·인자 ────────────────────────────── */

// ★ 자격증명은 소스에 박지 않는다 — 이 파일은 커밋된다.
//   DB 관리자(DDL/계정잠금 권한) 비번은 환경변수로만 받는다. 없으면 실행을 거부한다.
//     PowerShell:  $env:TC_TEST_DB_ADMIN_PW = '...'
//     bash:        export TC_TEST_DB_ADMIN_PW='...'
//   앱 계정 기본값은 배포 구성(widget/DeployConfig.cs)에 이미 공개된 값이라 기본값을 두되, 역시 환경변수로 덮을 수 있다.
const DEFAULTS = {
  port: 9222,
  ops: 60,
  seed: 20260727,
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  dbHost: '127.0.0.1',
  dbPort: 3306,
  dbName: process.env.TC_TEST_DB_NAME || 'taskmgr',
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',     // ← 비밀. 소스에 기본값 없음
  appUser: process.env.TC_TEST_APP_USER || 'taskmgr_app',
  appPw: process.env.TC_TEST_APP_PW || 'taskmgr1234', // 배포 구성 공개 기본값
  appHostPattern: '%',      // mysql.user의 host — ALTER USER 'app'@'<이 값>'
};

function parseArgs(argv) {
  const o = { ...DEFAULTS, selfcheck: false, offline: true, verbose: false };
  for (const a of argv) {
    let m;
    if ((m = /^--ops=(\d+)$/.exec(a))) o.ops = Number(m[1]);
    else if ((m = /^--seed=(-?\d+)$/.exec(a))) o.seed = Number(m[1]);
    else if ((m = /^--port=(\d+)$/.exec(a))) o.port = Number(m[1]);
    else if ((m = /^--mysql=(.+)$/.exec(a))) o.mysql = m[1];
    else if ((m = /^--db-host=(.+)$/.exec(a))) o.dbHost = m[1];
    else if ((m = /^--db-port=(\d+)$/.exec(a))) o.dbPort = Number(m[1]);
    else if (a === '--selfcheck') o.selfcheck = true;
    else if (a === '--no-offline') o.offline = false;
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if ((m = /^--admin-user=(.+)$/.exec(a))) o.adminUser = m[1];
    else if ((m = /^--db-name=(.+)$/.exec(a))) o.dbName = m[1];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error('알 수 없는 인자: ' + a); printHelp(); process.exit(2); }
  }
  // 자격증명은 환경변수로만 — 소스/명령행(프로세스 목록 노출)에 비번을 두지 않는다.
  if (!o.adminPw) {
    console.error('[중단] DB 관리자 비밀번호가 없습니다. 환경변수 TC_TEST_DB_ADMIN_PW 로 지정하세요.');
    console.error("        PowerShell:  $env:TC_TEST_DB_ADMIN_PW = '<비번>'");
    console.error("        bash:        export TC_TEST_DB_ADMIN_PW='<비번>'");
    console.error('        계정명 기본값은 root — 다르면 TC_TEST_DB_ADMIN_USER 또는 --admin-user= 로 지정.');
    process.exit(2);
  }
  return o;
}
function printHelp() {
  console.log(`사용법: node tests/loop-ui-integrity.mjs [옵션]
  --ops=N          조작 횟수(기본 ${DEFAULTS.ops})
  --seed=N         RNG 시드(기본 ${DEFAULTS.seed}) — 같은 시드+ops면 같은 시퀀스
  --port=N         CDP 포트(기본 ${DEFAULTS.port})
  --mysql=PATH     mysql.exe 경로
  --db-host/--db-port
  --no-offline     오프라인 시나리오(A/B/C) 생략
  --selfcheck      위젯 없이 DB 계층만 읽기 전용 점검
  -v, --verbose    조작별 상세 로그`);
}

const OPT = parseArgs(process.argv.slice(2));

/* ────────────────────────────── 1. 로그·위반 기록 ────────────────────────────── */

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const log = (...a) => console.log(el(), ...a);
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   ·', ...a); };

/** 위반 누적 — {inv, op, phase, desc, detail} */
const violations = [];
let curOp = 0, curPhase = 'init';
function violate(inv, desc, detail) {
  const v = { inv, op: curOp, phase: curPhase, seed: OPT.seed, desc, detail };
  violations.push(v);
  console.log(el(), `  ✗ [${inv}] op#${curOp} (${curPhase}) ${desc}`);
  if (detail !== undefined) console.log('        ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 1400));
  return v;
}
function ok(msg) { console.log(el(), `  ✓ ${msg}`); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ────────────────────────────── 2. 시드 고정 RNG ────────────────────────────── */
// mulberry32 — 32bit 시드 하나로 결정론적 시퀀스. 실패 재현은 --seed/--ops만 맞추면 된다.
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
/** 가중 선택 — [[weight, value], ...] */
function pickWeighted(pairs) {
  const total = pairs.reduce((a, p) => a + p[0], 0);
  let r = rnd() * total;
  for (const [w, v] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][1];
}

/* ────────────────────────────── 3. MySQL 계층 ────────────────────────────── */
// 드라이버 설치 금지 → mysql.exe를 child_process로. **SQL은 stdin(UTF-8 바이트)** 으로 넘긴다.
// (argv로 넘기면 Windows ANSI 코드페이지 변환에 한글이 깨진다 — stdin은 안전.)

const MYSQL = OPT.mysql;

function mysqlRun(sql, { user = OPT.adminUser, pw = OPT.adminPw, db = OPT.dbName, timeout = 30000 } = {}) {
  const args = [
    `-u${user}`, `-p${pw}`, `-h${OPT.dbHost}`, `-P${OPT.dbPort}`,
    '--default-character-set=utf8mb4', '-N', '-B', '--connect-timeout=5',
  ];
  if (db) args.push('-D', db);
  const r = spawnSync(MYSQL, args, {
    input: Buffer.from(sql, 'utf8'), maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true,
  });
  if (r.error) return { ok: false, status: -1, out: '', err: String(r.error.message), errno: null };
  const out = (r.stdout || Buffer.alloc(0)).toString('utf8');
  const err = (r.stderr || Buffer.alloc(0)).toString('utf8');
  const m = /ERROR (\d+)/.exec(err);
  return { ok: r.status === 0, status: r.status, out, err, errno: m ? Number(m[1]) : null };
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

function mustQuery(sql, what) {
  const r = mysqlRun(sql);
  if (!r.ok) throw new Error(`MySQL 조회 실패(${what}): ${r.err.trim().split('\n').filter((l) => !/Warning/.test(l)).join(' ')}`);
  return rows(r.out);
}

/* ── 전체 스냅샷 — 앱과 **동일한 ORDER BY**로 뽑아 UI 비교에 JS 콜레이션이 끼지 않게 한다 ──
 *   C: customer            ORDER BY is_active DESC, name        (LoadCustomersFullJsonAsync)
 *   S: section_code        ORDER BY is_active DESC, sort_order, name  (LoadCodesFullJsonAsync)
 *   T: status_code         동일
 *   P: project             ORDER BY uid (해시·불변식용)
 *   컬럼 수를 7로 통일해 한 배치에서 태그로 구분 파싱한다. */
const SNAP_SQL = `
SELECT 'C', name, CAST(is_active AS CHAR), '', '', '', '' FROM customer ORDER BY is_active DESC, name;
SELECT 'S', name, CAST(is_active AS CHAR), CAST(sort_order AS CHAR), '', '', '' FROM section_code ORDER BY is_active DESC, sort_order, name;
SELECT 'T', name, CAST(is_active AS CHAR), CAST(sort_order AS CHAR), '', '', '' FROM status_code ORDER BY is_active DESC, sort_order, name;
SELECT 'P', uid, CAST(is_active AS CHAR), section, IFNULL(status,''), CAST(status IS NULL AS CHAR), customer FROM project ORDER BY uid;
`;

function snapshot() {
  const rs = mustQuery(SNAP_SQL, 'snapshot');
  const snap = { customers: [], sections: [], statuses: [], projects: [] };
  for (const c of rs) {
    const tag = c[0];
    if (tag === 'C') snap.customers.push({ name: c[1], active: c[2] === '1' });
    else if (tag === 'S') snap.sections.push({ name: c[1], active: c[2] === '1', sort: Number(c[3]) });
    else if (tag === 'T') snap.statuses.push({ name: c[1], active: c[2] === '1', sort: Number(c[3]) });
    else if (tag === 'P') snap.projects.push({ uid: c[1], active: c[2] === '1', section: c[3], status: c[5] === '1' ? null : c[4], customer: c[6] });
  }
  snap.hash = snapHash(snap);
  return snap;
}
/** 정렬 무관 해시(코드포인트 정렬로 정규화) — 오프라인 구간 '비트 단위 불변' 비교용 */
function snapHash(s) {
  const norm = {
    customers: s.customers.map((x) => [x.name, x.active]).sort(cmpArr),
    sections: s.sections.map((x) => [x.name, x.active, x.sort]).sort(cmpArr),
    statuses: s.statuses.map((x) => [x.name, x.active, x.sort]).sort(cmpArr),
    projects: s.projects.map((x) => [x.uid, x.active, x.section, x.status, x.customer]).sort(cmpArr),
  };
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 16);
}
const cmpArr = (a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);

/** 스냅샷의 코드/발주처 리스트 접근자 */
const listOf = (snap, table) => (table === 'section_code' ? snap.sections : table === 'status_code' ? snap.statuses : snap.customers);
const findRow = (snap, table, name) => listOf(snap, table).find((x) => x.name === name) || null;
/** 앱의 드롭다운 소스와 같은 순서(활성만, sort_order·name) */
const activeNames = (snap, table) => listOf(snap, table).filter((x) => x.active).map((x) => x.name);

/* ────────────────────────────── 4. 오프라인 제어 ────────────────────────────── */
// LOCK → (있으면) KILL → 앱 계정 접속 시도로 **실제 차단 확인**. 풀은 Pooling=false지만
// 조작 직전에 새 커넥션이 열려 있을 수 있으므로 KILL은 방어적으로(0개여도 정상 진행).

let offlineActive = false;

function appProbe() {
  const r = mysqlRun('SELECT 1;', { user: OPT.appUser, pw: OPT.appPw, timeout: 15000 });
  return { connected: r.ok, errno: r.errno, err: r.err.trim() };
}
function killAppSessions() {
  const ids = mustQuery(`SELECT id FROM information_schema.PROCESSLIST WHERE user='${OPT.appUser}';`, 'processlist').map((r) => r[0]);
  let killed = 0;
  for (const id of ids) {
    if (!/^\d+$/.test(id)) continue;
    const r = mysqlRun(`KILL ${id};`);   // 이미 끊긴 세션이면 1094 — 무시(방어적)
    if (r.ok) killed++;
  }
  return { found: ids.length, killed };
}
function goOffline() {
  const a = mysqlRun(`ALTER USER '${OPT.appUser}'@'${OPT.appHostPattern}' ACCOUNT LOCK;`);
  if (!a.ok) throw new Error('ACCOUNT LOCK 실패(migadmin 권한 확인): ' + a.err.trim());
  offlineActive = true;
  const k = killAppSessions();
  let probe = appProbe();
  for (let i = 0; i < 3 && probe.connected; i++) { killAppSessions(); probe = appProbe(); }
  vlog(`오프라인 진입: KILL ${k.killed}/${k.found}, 앱계정 접속=${probe.connected ? '아직 됨(!)' : '차단(errno=' + probe.errno + ')'}`);
  if (probe.connected) violate('OFF', '오프라인 시뮬레이션 실패 — 잠금 후에도 앱 계정이 접속됨', probe);
  return probe;
}
function goOnline() {
  const a = mysqlRun(`ALTER USER '${OPT.appUser}'@'${OPT.appHostPattern}' ACCOUNT UNLOCK;`);
  offlineActive = false;
  if (!a.ok) { violate('OFF', 'ACCOUNT UNLOCK 실패 — 수동 복구 필요', a.err.trim()); return { connected: false }; }
  const probe = appProbe();
  vlog(`온라인 복귀: 앱계정 접속=${probe.connected}`);
  if (!probe.connected) violate('OFF', '언락 후에도 앱 계정 접속 실패', probe);
  return probe;
}
/** 비정상 종료해도 계정 잠금은 반드시 푼다(우리가 건 것만 되돌린다 — 데이터 복원 아님). */
function emergencyUnlock() {
  if (!offlineActive) return;
  try {
    spawnSync(MYSQL, [`-u${OPT.adminUser}`, `-p${OPT.adminPw}`, `-h${OPT.dbHost}`, `-P${OPT.dbPort}`, '--default-character-set=utf8mb4', '-N', '-B'],
      { input: Buffer.from(`ALTER USER '${OPT.appUser}'@'${OPT.appHostPattern}' ACCOUNT UNLOCK;`, 'utf8'), windowsHide: true });
    console.error('[cleanup] taskmgr_app ACCOUNT UNLOCK 수행');
  } catch (_) { console.error('[cleanup] UNLOCK 실패 — 수동으로 ALTER USER ... ACCOUNT UNLOCK 하세요'); }
  offlineActive = false;
}
process.on('exit', emergencyUnlock);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { emergencyUnlock(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error(e); emergencyUnlock(); process.exit(1); });

/* ────────────────────────────── 5. CDP 클라이언트 ────────────────────────────── */
// node v24 전역 WebSocket 사용(ws 모듈 없음 · 설치 금지). Runtime.evaluate로 페이지 JS 실행.

class Cdp {
  #ws = null; #id = 0; #pending = new Map(); #handlers = new Map(); #closed = false;

  static async attach(port) {
    let list;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) });
      list = await res.json();
    } catch (e) {
      throw new Error(
        `CDP 엔드포인트(http://127.0.0.1:${port}/json)에 붙지 못했습니다.\n` +
        `  → 위젯을 TC_DEBUG_PORT=${port} 환경변수와 함께 먼저 띄운 뒤 다시 실행하세요.\n` +
        `  (이 스크립트는 위젯을 직접 실행하지 않습니다.)  원인: ${e.message}`);
    }
    const pages = (Array.isArray(list) ? list : []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!pages.length) throw new Error(`CDP page 타겟이 없습니다(포트 ${port}). 위젯 WebView2가 준비됐는지 확인하세요.`);
    const t = pages.find((p) => /tcapp\.local/i.test(p.url || '')) || pages[0];
    const c = new Cdp();
    await c.#connect(t.webSocketDebuggerUrl);
    c.target = t;
    return c;
  }

  async #connect(url) {
    const ws = new WebSocket(url);
    this.#ws = ws;
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('WebSocket 연결 시간 초과: ' + url)), 10000);
      ws.addEventListener('open', () => { clearTimeout(to); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(to); reject(new Error('WebSocket 연결 실패: ' + url)); }, { once: true });
    });
    ws.addEventListener('close', () => { this.#closed = true; });
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (_) { return; }
      if (m.id != null) {
        const p = this.#pending.get(m.id); if (!p) return;
        this.#pending.delete(m.id); clearTimeout(p.to);
        if (m.error) p.reject(new Error(`CDP 오류(${m.error.code}): ${m.error.message}`));
        else p.resolve(m.result);
      } else if (m.method) {
        for (const h of (this.#handlers.get(m.method) || [])) { try { h(m.params); } catch (_) { } }
      }
    });
  }

  on(method, fn) { const a = this.#handlers.get(method) || []; a.push(fn); this.#handlers.set(method, a); }

  send(method, params = {}) {
    if (this.#closed) return Promise.reject(new Error('CDP 연결이 끊겼습니다(위젯 종료?)'));
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { this.#pending.delete(id); reject(new Error('CDP 응답 시간 초과: ' + method)); }, 40000);
      this.#pending.set(id, { resolve, reject, to });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 페이지 전역 스코프에서 식 평가. 최상위 let(dbOnline·offSections 등)도 그대로 참조된다. */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true, replMode: false,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const msg = (d.exception && (d.exception.description || d.exception.value)) || d.text || '알 수 없는 예외';
      throw new Error('페이지 JS 예외: ' + String(msg).split('\n').slice(0, 2).join(' | '));
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.#ws && this.#ws.close(); } catch (_) { } }
}

/* ────────────────────────────── 6. 페이지 헬퍼(__lt) 주입 ────────────────────────────── */
// 앱 코드는 건드리지 않는다. 관측(토스트 MutationObserver·에러 리스너)과 **실제 DOM 조작**만 제공.
// ★ confirmBox는 가로채지 않는다 — 확인창이 뜨면 #cfOk/#cfAlt를 실제로 클릭해서 넘긴다.

const INSTALL_JS = `(function(){
  if (window.__lt && window.__lt.v === 1) return 'already';
  var L = { v:1, toasts: [], errors: [], seq: 0 };
  window.__lt = L;

  function watchToast(id){
    var box = document.getElementById(id); if(!box) return;
    new MutationObserver(function(muts){
      for (var i=0;i<muts.length;i++){
        var an = muts[i].addedNodes;
        for (var j=0;j<an.length;j++){
          var n = an[j];
          if (!n || n.nodeType !== 1 || !n.classList || !n.classList.contains('toast')) continue;
          var kind = n.classList.contains('error') ? 'error'
                   : n.classList.contains('warn') ? 'warn'
                   : n.classList.contains('info') ? 'info' : 'success';
          var t = n.querySelector('.t-msg');
          L.toasts.push({ n: ++L.seq, kind: kind, msg: (t ? t.textContent : n.textContent) || '' });
        }
      }
    }).observe(box, { childList: true });
  }
  watchToast('toastStack'); watchToast('toastStackErr');

  window.addEventListener('error', function(e){
    L.errors.push({ type:'error', msg: String((e && e.message) || e), where: String((e&&e.filename)||'') + ':' + String((e&&e.lineno)||'') });
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason;
    L.errors.push({ type:'unhandledrejection', msg: String((r && r.message) || r) });
  });

  L.isOpen = function(sel){ var e = document.querySelector(sel); return !!e && !e.classList.contains('hidden') && !e.classList.contains('closing'); };
  L.txt = function(sel){ var e = document.querySelector(sel); return e ? String(e.textContent||'').trim() : null; };

  /* 실제 엘리먼트 클릭 — 앱의 위임 핸들러를 그대로 탄다 */
  L.click = function(sel){
    var e = document.querySelector(sel);
    if(!e) return { ok:false, err:'요소 없음: '+sel };
    if(e.disabled) return { ok:false, err:'비활성 요소: '+sel };
    e.click();
    return { ok:true };
  };
  /* 목록 행 버튼 클릭 — 속성값 비교로 찾는다(한글/특수문자 셀렉터 이스케이프 회피) */
  L.rowBtn = function(boxSel, attr, name){
    var box = document.querySelector(boxSel);
    if(!box) return { ok:false, err:'목록 없음: '+boxSel };
    var els = Array.prototype.slice.call(box.querySelectorAll('['+attr+']'));
    var el = null;
    for (var i=0;i<els.length;i++){ if (els[i].getAttribute(attr) === name){ el = els[i]; break; } }
    if(!el) return { ok:false, err:'버튼 없음: '+attr+'="'+name+'"' };
    if(el.disabled) return { ok:false, err:'버튼 비활성: '+attr+'="'+name+'"' };
    el.click();
    return { ok:true };
  };
  /* 입력칸: 값 설정 + input/change 디스패치 */
  L.setVal = function(sel, v){
    var e = document.querySelector(sel);
    if(!e) return { ok:false, err:'입력칸 없음: '+sel };
    try{ e.focus(); }catch(_){}
    e.value = v;
    e.dispatchEvent(new Event('input', { bubbles:true }));
    e.dispatchEvent(new Event('change', { bubbles:true }));
    return { ok:true, value: e.value };
  };
  /* 인라인 개명 입력칸(codeBeginRename/custBeginRename이 만든 행 안의 input) */
  L.setRowInput = function(boxSel, name, v){
    var box = document.querySelector(boxSel);
    if(!box) return { ok:false, err:'목록 없음: '+boxSel };
    var rs = Array.prototype.slice.call(box.querySelectorAll('.cust-row'));
    var row = null;
    for (var i=0;i<rs.length;i++){ if (rs[i].getAttribute('data-name') === name){ row = rs[i]; break; } }
    if(!row) return { ok:false, err:'행 없음: '+name };
    var inp = row.querySelector('input');
    if(!inp) return { ok:false, err:'인라인 입력칸 없음(개명 모드 진입 실패): '+name };
    try{ inp.focus(); inp.select(); }catch(_){}
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles:true }));
    inp.dispatchEvent(new Event('change', { bubbles:true }));
    return { ok:true };
  };
  L.rowNames = function(boxSel){
    var box = document.querySelector(boxSel); if(!box) return [];
    return Array.prototype.slice.call(box.querySelectorAll('.cust-row')).map(function(r){ return r.getAttribute('data-name'); });
  };
  /* 행에 붙은 버튼 종류(이름변경/숨김/복구/▲▼ 가용성) — 조작 후보 선정용 */
  L.rowCaps = function(boxSel){
    var box = document.querySelector(boxSel); if(!box) return [];
    return Array.prototype.slice.call(box.querySelectorAll('.cust-row')).map(function(r){
      var g = function(a){ var b = r.querySelector('['+a+']'); return !!b && !b.disabled; };
      return { name: r.getAttribute('data-name'), hidden: r.classList.contains('hidden-cust'),
               up: g('data-codeup'), down: g('data-codedown'),
               edit: g('data-codeedit') || g('data-custedit'),
               hide: g('data-codehide') || g('data-custhide'),
               show: g('data-codeshow') || g('data-custshow') };
    });
  };

  L.state = function(){
    var s = {};
    s.host       = (typeof HOST !== 'undefined') ? !!HOST : null;
    s.role       = (typeof getRole === 'function') ? getRole() : null;
    s.dbOnline   = (typeof dbOnline !== 'undefined') ? !!dbOnline : null;
    s.catalogN   = (typeof dbCatalog !== 'undefined' && dbCatalog) ? dbCatalog.length : null;
    s.codeBusy   = (typeof codeBusy !== 'undefined') ? !!codeBusy : null;
    s.custBusy   = (typeof custBusy !== 'undefined') ? !!custBusy : null;
    s.codeKind   = (typeof codeKind !== 'undefined') ? codeKind : null;
    s.codeShowHidden = (typeof codeShowHidden !== 'undefined') ? !!codeShowHidden : null;
    s.custShowHidden = (typeof custShowHidden !== 'undefined') ? !!custShowHidden : null;
    s.offSections = (typeof offSections !== 'undefined' && offSections) ? offSections.slice() : null;
    s.offStatuses = (typeof offStatuses !== 'undefined' && offStatuses) ? offStatuses.slice() : null;
    s.dbCustomers = (typeof dbCustomers !== 'undefined' && dbCustomers) ? dbCustomers.slice() : null;
    s.codeList = (typeof codeList !== 'undefined' && codeList)
      ? codeList.map(function(c){ return { name:c.name, active:!!c.active, sort:c.sort }; }) : null;
    s.custList = (typeof custList !== 'undefined' && custList)
      ? custList.map(function(c){ return { name:c.name, active:!!c.active }; }) : null;
    s.codeRows = L.rowNames('#codeList');
    s.custRows = L.rowNames('#custList');
    var cl = document.getElementById('codeList'), ul = document.getElementById('custList');
    s.codeListText = cl ? String(cl.textContent||'').trim().slice(0,300) : '';
    s.custListText = ul ? String(ul.textContent||'').trim().slice(0,300) : '';
    s.codeMsg = L.txt('#codeMsg'); s.custMsg = L.txt('#custMsg');
    s.codeOpen = L.isOpen('#codeModal'); s.custOpen = L.isOpen('#customerModal');
    s.confirmOpen = L.isOpen('#confirmModal');
    s.cfTitle = L.txt('#cfTitle'); s.cfMsg = L.txt('#cfMsg');
    s.toastN = L.seq; s.errN = L.errors.length;
    s.lastToasts = L.toasts.slice(-5);
    return s;
  };
  L.toastsSince = function(n){ return L.toasts.filter(function(t){ return t.n > n; }); };
  L.errsSince = function(n){ return L.errors.slice(n); };
  return 'installed';
})()`;

/* ────────────────────────────── 7. 페이지 드라이버 ────────────────────────────── */

let cdp = null;
const consoleErrors = [];   // CDP Runtime/Log 채널로 수집한 콘솔 에러(페이지 리스너와 별도)

const ev = (expr) => cdp.evaluate(expr);
const jstr = (v) => JSON.stringify(v);   // 페이지로 넘길 문자열 리터럴(한글·따옴표 안전)
const state = () => ev('__lt.state()');

async function waitFor(pred, { timeout = 25000, interval = 120, desc = '' } = {}) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    last = await state();
    if (pred(last)) return last;
    if (Date.now() - t0 > timeout) return null;
    await sleep(interval);
  }
}

/** 조작 후 '정지' 판정: 확인창 없음 + busy 아님 + 목록이 로딩중 아님 */
const isIdle = (s) =>
  !s.confirmOpen && !s.codeBusy && !s.custBusy &&
  !/불러오는 중/.test(s.codeListText || '') && !/불러오는 중/.test(s.custListText || '');

/**
 * 쓰기 조작 1건 실행 — 트리거(실제 DOM 클릭) → 확인창 실버튼 클릭 → 정지 대기 → 결과(토스트) 수집.
 * opts.confirm: 'ok'(승인·기본) | 'alt'(취소)
 * opts.expectToast: 토스트가 안 뜨는 조작(UI 전용)이면 false
 */
async function doWrite(desc, triggerExpr, opts = {}) {
  const confirmChoice = opts.confirm === 'alt' ? 'alt' : 'ok';
  const expectToast = opts.expectToast !== false;
  const s0 = await state();
  const rec = { desc, outcome: 'none', toasts: [], confirm: null, adminGate: false, trigger: null };

  const tr = await ev(triggerExpr);
  rec.trigger = tr;
  if (!tr || tr.ok === false) { rec.outcome = 'trigger-failed'; return rec; }

  const deadline = Date.now() + (opts.timeout || 35000);
  const tTrig = Date.now();
  let settled = false;
  while (Date.now() < deadline) {
    const s = await state();

    if (s.confirmOpen) {
      if (s.cfTitle === '관리자 인증 필요') {          // 관리자 게이트에 걸림 = 사전조건 위반
        rec.adminGate = true;
        await ev("__lt.click('#cfAlt')");
        rec.outcome = 'admin-gate';
        return rec;
      }
      if (!rec.confirm) {
        rec.confirm = { title: s.cfTitle, msg: s.cfMsg, choice: confirmChoice };
        await sleep(60);
        await ev(`__lt.click('#cf${confirmChoice === 'ok' ? 'Ok' : 'Alt'}')`);   // ★ 실제 버튼 클릭
        await sleep(150);
      }
      await sleep(100);
      continue;
    }

    const newToasts = s.toastN - s0.toastN;
    if (isIdle(s)) {
      const cancelled = rec.confirm && rec.confirm.choice === 'alt';
      if (newToasts > 0) { settled = true; break; }
      if ((!expectToast || cancelled) && Date.now() - tTrig > 900) { settled = true; break; }
    }
    await sleep(120);
  }

  rec.toasts = await ev(`__lt.toastsSince(${s0.toastN})`);
  rec.errs = await ev(`__lt.errsSince(${s0.errN})`);
  const kinds = rec.toasts.map((t) => t.kind);
  rec.outcome = !settled ? 'timeout'
    : kinds.includes('success') ? 'success'
      : kinds.includes('error') ? 'error'
        : kinds.includes('warn') ? 'warn' : 'none';
  if (kinds.includes('success') && (kinds.includes('error') || kinds.includes('warn'))) rec.mixed = true;
  return rec;
}

/** 조작 없이 목록/드롭다운이 DB와 수렴할 때까지 잠시 기다린다(hpost loadCodes/loadCustomers는 fire-and-forget) */
async function waitConverge(pred, ms = 3000) {
  const s = await waitFor(pred, { timeout: ms, interval: 120 });
  return s || (await state());
}

/* ────────────────────────────── 8. 기대 DB 모델 ────────────────────────────── */
// 핵심 계약: **UI가 성공이라 말하면 DB가 그만큼 바뀌어야 하고, 실패라 말하면 DB는 그대로여야 한다.**
// (시나리오 C의 '겉으로 성공, DB엔 없음'을 일반화한 검사)

function cloneSnap(s) { return JSON.parse(JSON.stringify({ customers: s.customers, sections: s.sections, statuses: s.statuses, projects: s.projects })); }

/** plan = {table, kind:'add'|'rename'|'hide'|'show'|'reorder', name, newName, order:[...]} */
function expectAfter(before, plan, success) {
  const exp = cloneSnap(before);
  if (!success || !plan) { exp.hash = snapHash(exp); return exp; }
  const list = plan.table === 'section_code' ? exp.sections : plan.table === 'status_code' ? exp.statuses : exp.customers;
  const projField = plan.table === 'section_code' ? 'section' : plan.table === 'status_code' ? 'status' : 'customer';
  const row = list.find((x) => x.name === plan.name) || null;

  if (plan.kind === 'add') {
    const maxSort = list.reduce((a, x) => Math.max(a, x.sort || 0), 0);
    const nu = { name: plan.name, active: true };
    if (plan.table !== 'customer') nu.sort = maxSort + 10;      // AddCodeAsync: MAX(sort_order)+10
    list.push(nu);
  } else if (plan.kind === 'rename') {
    if (row) row.name = plan.newName;
    for (const p of exp.projects) if (p[projField] === plan.name) p[projField] = plan.newName;   // FK ON UPDATE CASCADE
  } else if (plan.kind === 'hide') {
    if (row) row.active = false;
  } else if (plan.kind === 'show') {
    // SetCodeActiveAsync(active=true)는 sort_order를 MAX+10으로 재부여해 '맨 뒤'로 보낸다.
    // (옛 순번을 들고 복구되면 재부여된 활성 값과 겹쳐 드롭다운 순서가 불안정해지던 결함 수정 — I5)
    // 발주처(customer)는 sort_order 컬럼이 없어 해당 없음.
    if (row) {
      row.active = true;
      if (plan.table !== 'customer') {
        const maxSort = list.reduce((a, x) => Math.max(a, x.sort || 0), 0);
        row.sort = maxSort + 10;
      }
    }
  } else if (plan.kind === 'reorder') {
    plan.order.forEach((nm, i) => { const r = list.find((x) => x.name === nm); if (r) r.sort = (i + 1) * 10; });  // ReorderCodesAsync
  }
  exp.hash = snapHash(exp);
  return exp;
}

/** 스냅샷 두 개의 차이를 사람이 읽는 형태로 */
function diffSnap(a, b) {
  const out = [];
  const key = { customers: 'name', sections: 'name', statuses: 'name', projects: 'uid' };
  for (const g of ['customers', 'sections', 'statuses', 'projects']) {
    const ma = new Map(a[g].map((x) => [x[key[g]], x])), mb = new Map(b[g].map((x) => [x[key[g]], x]));
    for (const [k, v] of ma) {
      if (!mb.has(k)) out.push(`-${g}:${k}`);
      else if (JSON.stringify(v) !== JSON.stringify(mb.get(k))) out.push(`~${g}:${k} ${JSON.stringify(v)} → ${JSON.stringify(mb.get(k))}`);
    }
    for (const k of mb.keys()) if (!ma.has(k)) out.push(`+${g}:${k} ${JSON.stringify(mb.get(k))}`);
  }
  return out;
}

/* ────────────────────────────── 9. 불변식 검사 ────────────────────────────── */

let PROJECT_N0 = null;    // 시작 시점 과제 행수(기대: 14 고정)

/** I1 FK 무결성·고아 0 */
function invFk(snap) {
  const secs = new Set(snap.sections.map((x) => x.name));
  const sts = new Set(snap.statuses.map((x) => x.name));
  const cus = new Set(snap.customers.map((x) => x.name));
  const bad = [];
  for (const p of snap.projects) {
    if (!secs.has(p.section)) bad.push(`uid=${p.uid} section='${p.section}' 고아`);
    if (p.status !== null && !sts.has(p.status)) bad.push(`uid=${p.uid} status='${p.status}' 고아`);
    if (!cus.has(p.customer)) bad.push(`uid=${p.uid} customer='${p.customer}' 고아`);
  }
  if (bad.length) violate('I1', `FK 고아 ${bad.length}건`, bad.slice(0, 10));
  return bad.length === 0;
}

/** I2 데이터 무손실 — project 행수 고정 */
function invProjectCount(snap) {
  if (PROJECT_N0 === null) return true;
  if (snap.projects.length !== PROJECT_N0) {
    violate('I2', `project 행수 변동: ${PROJECT_N0} → ${snap.projects.length} (코드/발주처 편집이 과제를 지우거나 늘렸다)`);
    return false;
  }
  return true;
}

/** I5 정렬 무결성 — 활성 코드값 sort_order 중복 없음 */
function invSortDistinct(snap) {
  let bad = false;
  for (const [label, list] of [['section_code', snap.sections], ['status_code', snap.statuses]]) {
    const act = list.filter((x) => x.active);
    const seen = new Map();
    for (const r of act) {
      if (seen.has(r.sort)) { violate('I5', `${label} 활성 sort_order 중복(${r.sort}): '${seen.get(r.sort)}' vs '${r.name}'`); bad = true; }
      seen.set(r.sort, r.name);
    }
  }
  return !bad;
}

/** 매 조작 뒤 공통 검사(I1·I2·I5) */
function invCommon(snap) {
  const a = invFk(snap), b = invProjectCount(snap), c = invSortDistinct(snap);
  return a && b && c;
}

/** I3 개명 전파(CASCADE) — 개명 성공 시 old 참조 0건 + 참조 행수 이동 */
function invRenameCascade(before, after, plan) {
  const f = plan.table === 'section_code' ? 'section' : plan.table === 'status_code' ? 'status' : 'customer';
  const cntBeforeOld = before.projects.filter((p) => p[f] === plan.name).length;
  const cntBeforeNew = before.projects.filter((p) => p[f] === plan.newName).length;
  const cntAfterOld = after.projects.filter((p) => p[f] === plan.name).length;
  const cntAfterNew = after.projects.filter((p) => p[f] === plan.newName).length;
  let good = true;
  if (cntAfterOld !== 0) { violate('I3', `개명 후에도 옛 값 참조가 남음: ${f}='${plan.name}' ${cntAfterOld}건`); good = false; }
  if (cntAfterNew !== cntBeforeOld + cntBeforeNew) {
    violate('I3', `개명 참조 이동 불일치: ${f} '${plan.name}'(${cntBeforeOld}) + '${plan.newName}'(${cntBeforeNew}) → '${plan.newName}'(${cntAfterNew})`);
    good = false;
  }
  return good;
}

/** I4 숨김 보존 — 숨겨도 그 값을 쓰던 과제의 값은 그대로(NULL화·소실 금지) */
function invHidePreserve(before, after, plan) {
  const f = plan.table === 'section_code' ? 'section' : plan.table === 'status_code' ? 'status' : 'customer';
  const users = before.projects.filter((p) => p[f] === plan.name).map((p) => p.uid);
  const map = new Map(after.projects.map((p) => [p.uid, p]));
  const lost = [];
  for (const uid of users) {
    const p = map.get(uid);
    if (!p) lost.push(`${uid}: 행 소실`);
    else if (p[f] !== plan.name) lost.push(`${uid}: ${f} '${plan.name}' → ${JSON.stringify(p[f])}`);
  }
  if (lost.length) { violate('I4', `숨김/복구 후 참조 값 변형 ${lost.length}건 (${plan.table} '${plan.name}')`, lost.slice(0, 8)); return false; }
  return true;
}

/** I5b 정렬 결과 일치 — ▲▼ 후 활성 순서가 의도한 순서와 같은가 */
function invOrderMatches(after, plan) {
  const got = activeNames(after, plan.table);
  const want = plan.order;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    violate('I5', `정렬 결과 불일치(${plan.table})`, { 기대: want, 실제: got });
    return false;
  }
  return true;
}

/**
 * I6 UI↔DB 일치.
 *  · offSections/offStatuses = DB 활성 코드값(sort_order 순)  ← LoadActiveCodeNamesJsonAsync
 *  · codeList = DB 전체(is_active DESC, sort_order, name)      ← LoadCodesFullJsonAsync
 *  · dbCustomers = DB 활성 발주처(name 순), custList = 전체
 *  ※ 스냅샷을 DB의 ORDER BY 그대로 뽑았으므로 배열을 그대로 비교한다(JS 콜레이션 개입 없음).
 *  ※ hpost(loadCodes/loadCustomers)는 fire-and-forget이라 잠시 기다렸다 비교한다.
 */
async function invUiMatchesDb(snap, { codeOpen, custOpen, kind }) {
  let good = true;
  const wantSec = snap.sections.filter((x) => x.active).map((x) => x.name);
  const wantSt = snap.statuses.filter((x) => x.active).map((x) => x.name);
  const wantCustAct = snap.customers.filter((x) => x.active).map((x) => x.name);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const s = await waitConverge((x) => eq(x.offSections, wantSec) && eq(x.offStatuses, wantSt), 3500);
  if (!eq(s.offSections, wantSec)) { violate('I6', '드롭다운 소스(offSections)가 DB 활성 구분과 불일치', { UI: s.offSections, DB: wantSec }); good = false; }
  if (!eq(s.offStatuses, wantSt)) { violate('I6', '드롭다운 소스(offStatuses)가 DB 활성 상태와 불일치', { UI: s.offStatuses, DB: wantSt }); good = false; }

  if (codeOpen && s.codeOpen && s.codeList) {
    const table = (kind || s.codeKind) === 'status' ? 'status_code' : 'section_code';
    const want = listOf(snap, table).map((x) => ({ name: x.name, active: x.active, sort: x.sort }));
    const got = s.codeList;
    if (!eq(got, want)) { violate('I6', `관리 목록(codeList/${table})이 DB와 불일치`, { UI: got, DB: want }); good = false; }
    // 화면에 실제로 그려진 행 = 목록 중 (숨김표시 여부에 따른) 필터 결과
    const wantRows = want.filter((x) => s.codeShowHidden || x.active).map((x) => x.name);
    if (!eq(s.codeRows, wantRows)) { violate('I6', '코드 목록 DOM 행이 기대와 불일치', { DOM: s.codeRows, 기대: wantRows }); good = false; }
  }
  if (custOpen && s.custOpen && s.custList) {
    const want = snap.customers.map((x) => ({ name: x.name, active: x.active }));
    if (!eq(s.custList, want)) { violate('I6', '관리 목록(custList)이 DB와 불일치', { UI: s.custList, DB: want }); good = false; }
    const wantRows = want.filter((x) => s.custShowHidden || x.active).map((x) => x.name);
    if (!eq(s.custRows, wantRows)) { violate('I6', '발주처 목록 DOM 행이 기대와 불일치', { DOM: s.custRows, 기대: wantRows }); good = false; }
    const s2 = await waitConverge((x) => eq(x.dbCustomers, wantCustAct), 2000);
    if (!eq(s2.dbCustomers, wantCustAct)) { violate('I6', '발주처 드롭다운 소스(dbCustomers)가 DB 활성 발주처와 불일치', { UI: s2.dbCustomers, DB: wantCustAct }); good = false; }
  }
  return good;
}

/* ────────────────────────────── 10. 모달 진입/이탈(실제 클릭) ────────────────────────────── */

const CODE_BOX = '#codeList', CUST_BOX = '#custList';

async function closeIfOpen(modalSel) {
  const s = await state();
  const open = modalSel === '#codeModal' ? s.codeOpen : s.custOpen;
  if (!open) return;
  await ev(`__lt.click(${jstr(modalSel + ' .modal-foot [data-close]')})`);
  await waitFor((x) => !(modalSel === '#codeModal' ? x.codeOpen : x.custOpen), { timeout: 4000 });
}

/** 구분·상태 관리 모달 진입 — 편집폼의 '구분·상태 관리…' 링크를 실제 클릭(offEditGuard 없는 경로) */
async function openCodeModal(kind) {
  let s = await state();
  if (!s.codeOpen) {
    await closeIfOpen('#customerModal');
    await ev("__lt.click('#offEdCodeMgr')");
    s = await waitFor((x) => x.codeOpen && !/불러오는 중/.test(x.codeListText || ''), { timeout: 25000 }) || (await state());
  }
  if (kind && s.codeKind !== kind) {
    await ev(`__lt.click('#codeTab${kind === 'status' ? 'Status' : 'Section'}')`);
    s = await waitFor((x) => x.codeKind === kind && !/불러오는 중/.test(x.codeListText || ''), { timeout: 20000 }) || (await state());
  }
  return s;
}

/** 발주처 관리 모달 진입 — 공식과제 화면의 '발주처 관리'(offEditGuard 경유)를 우선 사용 */
async function openCustModal({ guarded = true } = {}) {
  let s = await state();
  if (!s.custOpen) {
    await closeIfOpen('#codeModal');
    await ev(`__lt.click('${guarded ? '#offCustMgr' : '#offEdCustMgr'}')`);
    s = await waitFor((x) => x.custOpen && !/불러오는 중/.test(x.custListText || ''), { timeout: 25000 }) || (await state());
  }
  return s;
}

/* ────────────────────────────── 11. 조작(op) 구현 ────────────────────────────── */

let tempSeq = 0;
const tmpCode = () => `zzT${OPT.seed}_${++tempSeq}`;          // 코드값(maxlength 50)
const tmpCust = () => `zzC${OPT.seed}_${++tempSeq}`;          // 발주처(maxlength 100)
const isTemp = (n) => /^zz[TC]\d+_/.test(n || '');
const TABLE_OF = (kind) => (kind === 'status' ? 'status_code' : 'section_code');

/** 후보 선정은 **화면에 실제로 그려진 행**에서 한다(클릭 가능한 것만) */
async function codeCaps() { return ev(`__lt.rowCaps(${jstr(CODE_BOX)})`); }
async function custCaps() { return ev(`__lt.rowCaps(${jstr(CUST_BOX)})`); }

/** 숨김표시 체크박스를 원하는 상태로(실제 클릭 → change 이벤트) */
async function setShowHidden(which, want) {
  const sel = which === 'code' ? '#codeShowHidden' : '#custShowHidden';
  const s = await state();
  const cur = which === 'code' ? s.codeShowHidden : s.custShowHidden;
  if (!!cur === !!want) return s;
  await ev(`__lt.click('${sel}')`);
  return (await waitFor((x) => !!(which === 'code' ? x.codeShowHidden : x.custShowHidden) === !!want, { timeout: 4000 })) || (await state());
}

/* ── 코드값 조작 ── */

async function opCodeAdd(kind, name) {
  await openCodeModal(kind);
  await ev(`__lt.setVal('#codeNewName', ${jstr(name)})`);
  const rec = await doWrite(`코드추가(${kind}) '${name}'`, "__lt.click('#codeAddBtn')");
  return { rec, plan: { table: TABLE_OF(kind), kind: 'add', name } };
}

async function opCodeRename(kind, oldName, newName) {
  await openCodeModal(kind);
  const begin = await ev(`__lt.rowBtn(${jstr(CODE_BOX)}, 'data-codeedit', ${jstr(oldName)})`);
  if (!begin || begin.ok === false) return { rec: { desc: `코드개명 '${oldName}'`, outcome: 'trigger-failed', trigger: begin, toasts: [] }, plan: null };
  await sleep(80);
  const set = await ev(`__lt.setRowInput(${jstr(CODE_BOX)}, ${jstr(oldName)}, ${jstr(newName)})`);
  if (!set || set.ok === false) return { rec: { desc: `코드개명 '${oldName}'`, outcome: 'trigger-failed', trigger: set, toasts: [] }, plan: null };
  const rec = await doWrite(`코드개명(${kind}) '${oldName}' → '${newName}'`,
    `__lt.rowBtn(${jstr(CODE_BOX)}, 'data-codesave', ${jstr(oldName)})`);
  return { rec, plan: { table: TABLE_OF(kind), kind: 'rename', name: oldName, newName } };
}

async function opCodeHide(kind, name, confirmChoice = 'ok') {
  await openCodeModal(kind);
  const rec = await doWrite(`코드숨김(${kind}) '${name}'`,
    `__lt.rowBtn(${jstr(CODE_BOX)}, 'data-codehide', ${jstr(name)})`, { confirm: confirmChoice });
  const applied = rec.outcome === 'success';
  return { rec, plan: { table: TABLE_OF(kind), kind: 'hide', name }, cancelled: rec.confirm && rec.confirm.choice === 'alt' && !applied };
}

async function opCodeShow(kind, name) {
  await openCodeModal(kind);
  await setShowHidden('code', true);
  const rec = await doWrite(`코드복구(${kind}) '${name}'`,
    `__lt.rowBtn(${jstr(CODE_BOX)}, 'data-codeshow', ${jstr(name)})`);
  return { rec, plan: { table: TABLE_OF(kind), kind: 'show', name } };
}

async function opCodeMove(kind, name, dir, curActiveOrder) {
  await openCodeModal(kind);
  const i = curActiveOrder.indexOf(name);
  const j = i + (dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= curActiveOrder.length) {
    return { rec: { desc: `코드순서(${kind}) '${name}' ${dir}`, outcome: 'trigger-failed', toasts: [], trigger: { ok: false, err: 'UI 순서와 DB 순서가 어긋남' } }, plan: null };
  }
  const order = curActiveOrder.slice();
  order[i] = order[j]; order[j] = name;
  const rec = await doWrite(`코드순서(${kind}) '${name}' ${dir === 'up' ? '▲' : '▼'}`,
    `__lt.rowBtn(${jstr(CODE_BOX)}, 'data-code${dir === 'up' ? 'up' : 'down'}', ${jstr(name)})`);
  return { rec, plan: { table: TABLE_OF(kind), kind: 'reorder', name, order } };
}

/* ── 발주처 조작 ── */

async function opCustAdd(name) {
  await openCustModal();
  await ev(`__lt.setVal('#custNewName', ${jstr(name)})`);
  const rec = await doWrite(`발주처추가 '${name}'`, "__lt.click('#custAddBtn')");
  return { rec, plan: { table: 'customer', kind: 'add', name } };
}

async function opCustRename(oldName, newName) {
  await openCustModal();
  const begin = await ev(`__lt.rowBtn(${jstr(CUST_BOX)}, 'data-custedit', ${jstr(oldName)})`);
  if (!begin || begin.ok === false) return { rec: { desc: `발주처개명 '${oldName}'`, outcome: 'trigger-failed', trigger: begin, toasts: [] }, plan: null };
  await sleep(80);
  const set = await ev(`__lt.setRowInput(${jstr(CUST_BOX)}, ${jstr(oldName)}, ${jstr(newName)})`);
  if (!set || set.ok === false) return { rec: { desc: `발주처개명 '${oldName}'`, outcome: 'trigger-failed', trigger: set, toasts: [] }, plan: null };
  const rec = await doWrite(`발주처개명 '${oldName}' → '${newName}'`,
    `__lt.rowBtn(${jstr(CUST_BOX)}, 'data-custsave', ${jstr(oldName)})`);
  return { rec, plan: { table: 'customer', kind: 'rename', name: oldName, newName } };
}

async function opCustHide(name, confirmChoice = 'ok') {
  await openCustModal();
  const rec = await doWrite(`발주처숨김 '${name}'`,
    `__lt.rowBtn(${jstr(CUST_BOX)}, 'data-custhide', ${jstr(name)})`, { confirm: confirmChoice });
  return { rec, plan: { table: 'customer', kind: 'hide', name } };
}

async function opCustShow(name) {
  await openCustModal();
  await setShowHidden('cust', true);
  const rec = await doWrite(`발주처복구 '${name}'`,
    `__lt.rowBtn(${jstr(CUST_BOX)}, 'data-custshow', ${jstr(name)})`);
  return { rec, plan: { table: 'customer', kind: 'show', name } };
}

/* ────────────────────────────── 12. 조작 결과 검증 ────────────────────────────── */

const opLog = [];   // {n, phase, desc, outcome, confirm, note}

/** 실패한 인라인 개명이 열린 채 남지 않게 취소 버튼을 실제 클릭(다음 조작 오염 방지) */
async function cancelInline(which) {
  const box = which === 'code' ? CODE_BOX : CUST_BOX;
  const attr = which === 'code' ? 'data-codecancel' : 'data-custcancel';
  const r = await ev(`__lt.rowBtn(${jstr(box)}, ${jstr(attr)}, '1')`);
  if (r && r.ok) await sleep(150);
}

/**
 * 조작 1건 검증.
 *  · UI 성공 → DB가 기대대로 정확히 바뀌었는가(+ I3/I4/I5b)
 *  · UI 실패/차단 → DB가 **전혀** 바뀌지 않았는가  ← stale-online의 부분반영 탐지
 */
async function verifyOp(before, plan, rec, ctx) {
  const after = snapshot();
  invCommon(after);

  const success = rec.outcome === 'success';
  const expected = expectAfter(before, plan, success);
  const changed = before.hash !== after.hash;

  if (after.hash !== expected.hash) {
    if (!success) {
      violate('DB', `UI가 '${rec.outcome}'인데 DB가 바뀌었다(부분반영 의심)`,
        { 조작: rec.desc, 토스트: rec.toasts, diff: diffSnap(before, after) });
    } else {
      violate('DB', 'UI는 성공인데 DB 변화가 기대와 다르다',
        { 조작: rec.desc, 기대차이: diffSnap(before, expected), 실제차이: diffSnap(before, after) });
    }
  } else if (success && plan && !changed && plan.kind !== 'reorder') {
    // 성공 토스트인데 DB가 그대로 = '겉으로만 성공'(시나리오 C 핵심 신호)
    violate('DB', 'UI는 성공이라 했는데 DB에 반영이 없다', { 조작: rec.desc, 토스트: rec.toasts });
  }

  if (success && plan) {
    if (plan.kind === 'rename') invRenameCascade(before, after, plan);
    if (plan.kind === 'hide' || plan.kind === 'show') invHidePreserve(before, after, plan);
    if (plan.kind === 'reorder') invOrderMatches(after, plan);
  }

  await invUiMatchesDb(after, ctx);

  if (rec.errs && rec.errs.length) violate('ERR', `조작 중 페이지 예외 ${rec.errs.length}건`, rec.errs.slice(0, 5));
  if (rec.mixed) violate('UI', '한 조작에서 성공·실패 토스트가 함께 떴다', rec.toasts);
  if (rec.adminGate) violate('PRE', '관리자 인증 게이트에 걸렸다 — adminUnlocked 사전 세팅을 확인하세요');

  opLog.push({ n: curOp, phase: curPhase, desc: rec.desc, outcome: rec.outcome, confirm: rec.confirm ? rec.confirm.choice : null });
  vlog(`${rec.desc} → ${rec.outcome}${rec.confirm ? ' (확인창:' + rec.confirm.choice + ')' : ''}`);
  return after;
}

/* ────────────────────────────── 13. 랜덤 조작 선택·실행 ────────────────────────────── */

async function runRandomOp(before) {
  const family = pickWeighted([[6, 'code'], [4, 'cust']]);

  if (family === 'code') {
    const kind = pickWeighted([[5, 'section'], [5, 'status']]);
    const table = TABLE_OF(kind);
    await openCodeModal(kind);
    if (rnd() < 0.25) await setShowHidden('code', rnd() < 0.5);

    const dbList = listOf(before, table);
    const act = dbList.filter((x) => x.active), hid = dbList.filter((x) => !x.active);
    const activeOrder = act.map((x) => x.name);
    const caps = await codeCaps();
    const renamable = caps.filter((c) => c.edit).map((c) => c.name);
    const movable = caps.filter((c) => c.up || c.down);

    const opts = [[3, 'add'], [1, 'addDup'], [1, 'toggleHidden']];
    if (renamable.some(isTemp)) opts.push([2, 'renameTemp']);
    if (renamable.some((n) => !isTemp(n))) opts.push([2, 'renameRound']);
    if (act.length > 2 && caps.some((c) => c.hide)) opts.push([2, 'hide']);
    if (act.length > 2 && caps.some((c) => c.hide)) opts.push([1, 'hideCancel']);
    if (hid.length) opts.push([3, 'show']);
    if (movable.length) opts.push([3, 'move']);
    if (act.length >= 2) opts.push([1, 'renameCollide']);
    const act2 = pickWeighted(opts);
    const ctx = { codeOpen: true, custOpen: false, kind };

    if (act2 === 'add') { const r = await opCodeAdd(kind, tmpCode()); return verifyOp(before, r.plan, r.rec, ctx); }
    if (act2 === 'addDup') {
      const dup = pick(dbList).name;
      const r = await opCodeAdd(kind, dup);
      if (r.rec.outcome === 'success') violate('NEG', `중복 코드값 '${dup}' 추가가 성공했다(PK 중복이 막히지 않음)`);
      return verifyOp(before, r.rec.outcome === 'success' ? r.plan : null, r.rec, ctx);
    }
    if (act2 === 'toggleHidden') {
      const s = await state();
      const rec = await doWrite(`숨김표시 토글(code, ${!s.codeShowHidden})`, "__lt.click('#codeShowHidden')", { expectToast: false });
      return verifyOp(before, null, rec, ctx);
    }
    if (act2 === 'renameTemp') {
      const from = pick(renamable.filter(isTemp));
      const r = await opCodeRename(kind, from, tmpCode());
      if (r.rec.outcome !== 'success') await cancelInline('code');
      return verifyOp(before, r.plan, r.rec, ctx);
    }
    if (act2 === 'renameRound') {
      // 시드 값은 반드시 왕복 — 최종 상태가 해석 가능하게(운영자 요청)
      const orig = pick(renamable.filter((n) => !isTemp(n)));
      const via = `${orig}_zzR${OPT.seed}`;
      const r1 = await opCodeRename(kind, orig, via);
      if (r1.rec.outcome !== 'success') await cancelInline('code');
      const mid = await verifyOp(before, r1.plan, r1.rec, ctx);
      if (!findRow(mid, table, via)) return mid;                  // 1단계 실패 → 되돌릴 것이 없다(같은 이름 재개명 = 무토스트 정체 회피)
      const r2 = await opCodeRename(kind, via, orig);
      if (r2.rec.outcome !== 'success') await cancelInline('code');
      return verifyOp(mid, r2.plan, r2.rec, ctx);
    }
    if (act2 === 'renameCollide') {
      const a = pick(activeOrder);
      const b = pick(activeOrder.filter((n) => n !== a));
      const r = await opCodeRename(kind, a, b);
      if (r.rec.outcome === 'success') violate('NEG', `'${a}' → 이미 있는 '${b}' 개명이 성공했다(PK 중복이 막히지 않음)`);
      if (r.rec.outcome !== 'success') await cancelInline('code');
      return verifyOp(before, r.rec.outcome === 'success' ? r.plan : null, r.rec, ctx);
    }
    if (act2 === 'hide' || act2 === 'hideCancel') {
      const choice = act2 === 'hideCancel' ? 'alt' : 'ok';
      const name = pick(caps.filter((c) => c.hide).map((c) => c.name));
      const r = await opCodeHide(kind, name, choice);
      const applied = r.rec.outcome === 'success';
      return verifyOp(before, applied ? r.plan : null, r.rec, ctx);
    }
    if (act2 === 'show') {
      const name = pick(hid.map((x) => x.name));
      const r = await opCodeShow(kind, name);
      return verifyOp(before, r.rec.outcome === 'success' ? r.plan : null, r.rec, ctx);
    }
    if (act2 === 'move') {
      const c = pick(movable);
      const dir = c.up && c.down ? (rnd() < 0.5 ? 'up' : 'down') : (c.up ? 'up' : 'down');
      const r = await opCodeMove(kind, c.name, dir, activeOrder);
      return verifyOp(before, r.rec.outcome === 'success' ? r.plan : null, r.rec, ctx);
    }
    return before;
  }

  /* ── 발주처 ── */
  await openCustModal();
  if (rnd() < 0.25) await setShowHidden('cust', rnd() < 0.5);
  const act = before.customers.filter((x) => x.active), hid = before.customers.filter((x) => !x.active);
  const caps = await custCaps();
  const renamable = caps.filter((c) => c.edit).map((c) => c.name);
  const ctx = { codeOpen: false, custOpen: true };

  const opts = [[3, 'add'], [1, 'addDup'], [1, 'toggleHidden']];
  if (renamable.some(isTemp)) opts.push([2, 'renameTemp']);
  if (renamable.some((n) => !isTemp(n))) opts.push([2, 'renameRound']);
  if (act.length > 2 && caps.some((c) => c.hide)) opts.push([3, 'hide']);
  if (hid.length) opts.push([3, 'show']);
  const a2 = pickWeighted(opts);

  if (a2 === 'add') { const r = await opCustAdd(tmpCust()); return verifyOp(before, r.plan, r.rec, ctx); }
  if (a2 === 'addDup') {
    const dup = pick(before.customers).name;
    const r = await opCustAdd(dup);
    if (r.rec.outcome === 'success') violate('NEG', `중복 발주처 '${dup}' 추가가 성공했다`);
    return verifyOp(before, r.rec.outcome === 'success' ? r.plan : null, r.rec, ctx);
  }
  if (a2 === 'toggleHidden') {
    const s = await state();
    const rec = await doWrite(`숨김표시 토글(cust, ${!s.custShowHidden})`, "__lt.click('#custShowHidden')", { expectToast: false });
    return verifyOp(before, null, rec, ctx);
  }
  if (a2 === 'renameTemp') {
    const from = pick(renamable.filter(isTemp));
    const r = await opCustRename(from, tmpCust());
    if (r.rec.outcome !== 'success') await cancelInline('cust');
    return verifyOp(before, r.plan, r.rec, ctx);
  }
  if (a2 === 'renameRound') {
    const orig = pick(renamable.filter((n) => !isTemp(n)));
    const via = `${orig}_zzR${OPT.seed}`;
    const r1 = await opCustRename(orig, via);
    if (r1.rec.outcome !== 'success') await cancelInline('cust');
    const mid = await verifyOp(before, r1.plan, r1.rec, ctx);
    if (!findRow(mid, 'customer', via)) return mid;               // 1단계 실패 → 되돌릴 것 없음
    const r2 = await opCustRename(via, orig);
    if (r2.rec.outcome !== 'success') await cancelInline('cust');
    return verifyOp(mid, r2.plan, r2.rec, ctx);
  }
  if (a2 === 'hide') {
    const name = pick(caps.filter((c) => c.hide).map((c) => c.name));
    const r = await opCustHide(name, rnd() < 0.25 ? 'alt' : 'ok');
    return verifyOp(before, r.rec.outcome === 'success' ? r.plan : null, r.rec, ctx);
  }
  if (a2 === 'show') {
    const name = pick(hid.map((x) => x.name));
    const r = await opCustShow(name);
    return verifyOp(before, r.rec.outcome === 'success' ? r.plan : null, r.rec, ctx);
  }
  return before;
}

/* ────────────────────────────── 14. 오프라인 시나리오 A/B/C ────────────────────────────── */

const GUARD_MSG = '편집하려면 서버 연결이 필요합니다';
const scenariosRun = new Set();

/** 앱이 '연결 안 됨'을 인지하게 만든다 — 설정의 '지금 새로고침' 실제 클릭 */
async function forceReload(wantOnline, timeout = 40000) {
  await ev("__lt.click('#dbReload')");
  const s = await waitFor((x) => x.dbOnline === wantOnline, { timeout });
  return s;
}

/** 오프라인 구간 전후 DB 비트 불변 확인(I8) */
function assertFrozen(tag, a, b) {
  if (a.hash !== b.hash) { violate('I8', `${tag}: 오프라인 구간에서 DB가 변경됐다`, diffSnap(a, b)); return false; }
  ok(`I8 ${tag}: DB 불변(hash=${a.hash})`);
  return true;
}

async function scenarioA() {
  curPhase = 'A-known-offline'; scenariosRun.add('A');
  log('── 시나리오 A: 알려진 오프라인 — offEditGuard가 편집을 막아야 한다 ──');
  // ★ 직전 조작이 열어 둔 모달을 반드시 닫는다 — 안 닫으면 '진입 차단' 판정이 오탐(이미 열려 있음)이 된다.
  await closeIfOpen('#codeModal'); await closeIfOpen('#customerModal');
  goOffline();
  const s = await forceReload(false);
  if (!s) violate('A', '재로드해도 dbOnline이 false가 되지 않았다(오프라인 인지 실패)');
  else ok(`dbOnline=false 인지(카탈로그 ${s.catalogN}건)`);

  const snap0 = snapshot();

  // (1) 발주처 관리 진입 — offEditGuard 경유 버튼
  const pre = await state();
  if (pre.custOpen) violate('A', '(하네스) 발주처 모달을 닫지 못했다 — 진입 차단 판정 불가');
  const r1 = await doWrite('A:발주처 관리 진입(#offCustMgr)', "__lt.click('#offCustMgr')", { timeout: 10000 });
  const s1 = await state();
  if (!pre.custOpen && s1.custOpen) violate('A', '오프라인인데 발주처 관리 모달이 열렸다(offEditGuard 통과)');
  if (!r1.toasts.some((t) => t.kind === 'warn' && t.msg.includes(GUARD_MSG)))
    violate('A', `가드 토스트('${GUARD_MSG}')가 뜨지 않았다 — 발주처 관리 진입`, r1.toasts);
  else ok('발주처 관리 진입 차단 + 안내 토스트');
  opLog.push({ n: curOp, phase: curPhase, desc: r1.desc, outcome: r1.outcome, confirm: null });

  // (2) 코드 추가 — 관리 모달 자체는 가드가 없어 열리지만 '추가'는 막혀야 한다
  await ev("__lt.click('#offEdCodeMgr')");
  await waitFor((x) => x.codeOpen && !/불러오는 중/.test(x.codeListText || ''), { timeout: 30000 });
  const nm = tmpCode();
  await ev(`__lt.setVal('#codeNewName', ${jstr(nm)})`);
  const r2 = await doWrite(`A:코드추가 '${nm}'`, "__lt.click('#codeAddBtn')", { timeout: 15000 });
  if (r2.outcome === 'success') violate('A', '오프라인인데 코드 추가가 성공했다', r2.toasts);
  else if (!r2.toasts.some((t) => t.kind === 'warn' && t.msg.includes(GUARD_MSG)))
    violate('A', `가드 토스트('${GUARD_MSG}')가 뜨지 않았다 — 코드 추가`, r2.toasts);
  else ok('코드 추가 차단 + 안내 토스트');
  opLog.push({ n: curOp, phase: curPhase, desc: r2.desc, outcome: r2.outcome, confirm: null });

  const snap1 = snapshot();
  assertFrozen('시나리오 A', snap0, snap1);
  invCommon(snap1);

  await ev("__lt.click('#codeModal .modal-foot [data-close]')");
  goOnline();
  const back = await forceReload(true);
  if (!back) violate('A', '언락 후 재로드해도 dbOnline이 true로 돌아오지 않았다');
  else ok('재연결 확인(dbOnline=true)');
  return await reconverge();
}

async function scenarioB() {
  curPhase = 'B-offline-browse'; scenariosRun.add('B');
  log('── 시나리오 B: 오프라인 중 조회·열람 — 우아한 실패인가 ──');
  goOffline();
  await forceReload(false);
  const snap0 = snapshot();
  const e0 = (await state()).errN;

  await closeIfOpen('#codeModal'); await closeIfOpen('#customerModal');

  // 코드 관리 모달(가드 없음) — 빈 목록 + 안내로 떨어져야 하고, 예외로 UI가 죽으면 안 된다
  await ev("__lt.click('#offEdCodeMgr')");
  let s = await waitFor((x) => x.codeOpen && !/불러오는 중/.test(x.codeListText || ''), { timeout: 30000 });
  if (!s || !s.codeOpen) violate('B', '오프라인에서 구분·상태 관리 모달이 열리지 않았다', s);
  else if (!/불러오지 못했습니다/.test(s.codeListText || '')) violate('B', '오프라인 코드 목록이 안내문구로 떨어지지 않았다', s.codeListText);
  else ok('코드 관리 모달: 안내 문구로 우아하게 폴백');

  // 탭 전환도 죽지 않아야 한다
  await ev("__lt.click('#codeTabStatus')");
  s = await waitFor((x) => x.codeKind === 'status' && !/불러오는 중/.test(x.codeListText || ''), { timeout: 30000 });
  if (!s) violate('B', '오프라인에서 상태 탭 전환이 정지하지 않았다(무한 로딩?)');
  else ok('탭 전환도 정상 폴백');
  await ev("__lt.click('#codeModal .modal-foot [data-close]')");
  await sleep(200);

  // 발주처 관리(가드 없는 진입 경로)
  await ev("__lt.click('#offEdCustMgr')");
  s = await waitFor((x) => x.custOpen && !/불러오는 중/.test(x.custListText || ''), { timeout: 30000 });
  if (!s || !s.custOpen) violate('B', '오프라인에서 발주처 관리 모달이 열리지 않았다', s);
  else if (!/불러오지 못했습니다/.test(s.custListText || '')) violate('B', '오프라인 발주처 목록이 안내문구로 떨어지지 않았다', s.custListText);
  else ok('발주처 관리 모달: 안내 문구로 우아하게 폴백');

  // 페이지가 살아 있는지(스크립트 정지 여부)
  const alive = await ev('1+1');
  if (alive !== 2) violate('B', '페이지 JS가 응답하지 않는다');
  const errs = await ev(`__lt.errsSince(${e0})`);
  if (errs.length) violate('B', `오프라인 열람 중 페이지 예외 ${errs.length}건`, errs.slice(0, 5));
  else ok('오프라인 열람 중 페이지 예외 0건');

  const snap1 = snapshot();
  assertFrozen('시나리오 B', snap0, snap1);

  await ev("__lt.click('#customerModal .modal-foot [data-close]')");
  goOnline();
  await forceReload(true);
  return await reconverge();
}

async function scenarioC(before) {
  curPhase = 'C-stale-online'; scenariosRun.add('C');
  log('── 시나리오 C: stale-online 창 — dbOnline=true인 채 DB만 끊고 즉시 편집 ──');

  // 목록이 온라인 상태로 로드돼 있어야 행 버튼이 존재한다
  await closeIfOpen('#customerModal'); await closeIfOpen('#codeModal');
  await openCodeModal('section');
  await setShowHidden('code', false);
  let s = await state();
  if (s.dbOnline !== true) { await forceReload(true); s = await state(); }
  const caps = await codeCaps();
  const snap0 = snapshot();

  goOffline();   // ★ 재로드하지 않는다 — dbOnline은 true로 남는다

  const stale = await state();
  if (stale.dbOnline !== true) {
    log('   (주의) stale-online 창이 이미 닫혔다 — dbOnline=false. 이 실행에선 C를 게이트 검증으로 격하한다.');
  } else {
    ok('stale-online 창 확보(dbOnline=true인데 DB는 끊김)');
  }

  const attempts = [];
  // C-1) 추가
  const nm = tmpCode();
  await ev(`__lt.setVal('#codeNewName', ${jstr(nm)})`);
  attempts.push(await doWrite(`C:코드추가 '${nm}'`, "__lt.click('#codeAddBtn')", { timeout: 30000 }));

  // C-2) 개명(행 버튼이 있으면)
  const target = (caps.find((c) => c.edit) || {}).name;
  if (target) {
    const begin = await ev(`__lt.rowBtn(${jstr(CODE_BOX)}, 'data-codeedit', ${jstr(target)})`);
    if (begin && begin.ok) {
      await sleep(80);
      await ev(`__lt.setRowInput(${jstr(CODE_BOX)}, ${jstr(target)}, ${jstr(target + '_zzC')})`);
      attempts.push(await doWrite(`C:코드개명 '${target}'`, `__lt.rowBtn(${jstr(CODE_BOX)}, 'data-codesave', ${jstr(target)})`, { timeout: 30000 }));
      await cancelInline('code');
    }
  }
  // C-3) 숨김(refCount 왕복이 먼저 실패 → 확인창 없이 setActive 실패로 가야 한다)
  const hideT = (caps.find((c) => c.hide) || {}).name;
  if (hideT) attempts.push(await doWrite(`C:코드숨김 '${hideT}'`, `__lt.rowBtn(${jstr(CODE_BOX)}, 'data-codehide', ${jstr(hideT)})`, { timeout: 30000 }));

  // C-4) 발주처 추가(다른 모달 경로도 한 번)
  await ev("__lt.click('#codeModal .modal-foot [data-close]')"); await sleep(200);
  await ev("__lt.click('#offEdCustMgr')");
  await waitFor((x) => x.custOpen && !/불러오는 중/.test(x.custListText || ''), { timeout: 30000 });
  const cn = tmpCust();
  await ev(`__lt.setVal('#custNewName', ${jstr(cn)})`);
  attempts.push(await doWrite(`C:발주처추가 '${cn}'`, "__lt.click('#custAddBtn')", { timeout: 30000 }));

  const snap1 = snapshot();
  for (const a of attempts) {
    opLog.push({ n: curOp, phase: curPhase, desc: a.desc, outcome: a.outcome, confirm: a.confirm ? a.confirm.choice : null });
    if (a.outcome === 'success') violate('C', `DB가 끊겼는데 UI가 성공을 표시했다 — ${a.desc}`, a.toasts);
    else if (a.outcome === 'none' || a.outcome === 'timeout')
      violate('C', `실패가 사용자에게 표시되지 않았다(토스트 없음/무응답) — ${a.desc}`, { outcome: a.outcome, toasts: a.toasts });
    else ok(`${a.desc} → ${a.outcome} (실패가 명확히 표시됨)`);
  }
  assertFrozen('시나리오 C(부분반영 없음)', snap0, snap1);
  invCommon(snap1);

  await ev("__lt.click('#customerModal .modal-foot [data-close]')");
  goOnline();
  const back = await forceReload(true);
  if (!back) violate('C', '재연결 후에도 dbOnline이 true로 돌아오지 않았다');
  return await reconverge();
}

/** 오프라인 구간 종료 후 재수렴 — 관리 목록을 다시 열어 DB와 일치하는지 확인 */
async function reconverge() {
  const snap = snapshot();
  await closeIfOpen('#codeModal'); await closeIfOpen('#customerModal');
  // 드롭다운 소스(offSections/offStatuses/dbCustomers)는 loadCodes/loadCustomers로만 갱신된다.
  // 모달 목록(getCodesFull)만 다시 읽으면 드롭다운은 그대로 → I7이 migadmin으로 앱 몰래 지운 행이
  // 유령으로 남는다(앱이 알 방법이 없는 정상 staleness). 최종 비교 전에 명시적으로 재조회시킨다.
  await ev(`(hpost({cmd:'loadCodes'}), hpost({cmd:'loadCustomers'}), 1)`);
  const secN = snap.sections.filter((x) => x.active).length;
  const stN = snap.statuses.filter((x) => x.active).length;
  const cuN = snap.customers.filter((x) => x.active).length;
  await waitFor((x) => (x.offSections || []).length === secN && (x.offStatuses || []).length === stN
    && (x.dbCustomers || []).length === cuN, { timeout: 8000, desc: '드롭다운 재조회 수렴' });
  await openCodeModal('section');
  await invUiMatchesDb(snap, { codeOpen: true, custOpen: false, kind: 'section' });
  await openCodeModal('status');
  await invUiMatchesDb(snap, { codeOpen: true, custOpen: false, kind: 'status' });
  await closeIfOpen('#codeModal');
  await openCustModal();
  await invUiMatchesDb(snap, { codeOpen: false, custOpen: true });
  ok('재수렴 확인(UI ↔ DB 일치)');
  return snap;
}

/* ────────────────────────────── 15. I7 하드삭제 정책(migadmin 직접) ────────────────────────────── */

const sqlStr = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";

async function phaseHardDelete(snap) {
  curPhase = 'I7-hard-delete';
  log('── I7: 하드삭제 정책(UI엔 삭제 없음 → DB에서 직접 확인) ──');

  // (a) 사용 중인 값 DELETE → FK RESTRICT로 거부돼야 한다(시드 값은 삭제되지 않으므로 안전)
  const usedSec = snap.projects.map((p) => p.section).find(Boolean);
  const usedSt = snap.projects.map((p) => p.status).find(Boolean);
  const usedCu = snap.projects.map((p) => p.customer).find(Boolean);
  for (const [t, v] of [['section_code', usedSec], ['status_code', usedSt], ['customer', usedCu]]) {
    if (!v) continue;
    const b = snapshot();
    const r = mysqlRun(`DELETE FROM ${t} WHERE name=${sqlStr(v)};`);
    const a = snapshot();
    if (r.ok) violate('I7', `사용 중인 ${t} '${v}' DELETE가 거부되지 않았다(FK RESTRICT 미작동)`, diffSnap(b, a));
    else if (r.errno !== 1451) violate('I7', `사용 중인 ${t} '${v}' DELETE가 1451이 아닌 오류로 실패`, { errno: r.errno, err: r.err.trim().split('\n').pop() });
    else ok(`사용 중 ${t} '${v}' DELETE 거부(errno 1451)`);
    if (b.hash !== a.hash) violate('I7', `거부된 DELETE인데 DB가 변경됐다(${t} '${v}')`, diffSnap(b, a));
  }

  // (b) 미사용 임시값 DELETE → 성공해야 한다. **테스트가 만든 zz* 만** 대상으로 한다.
  const refd = new Set();
  for (const p of snap.projects) { refd.add('S:' + p.section); if (p.status) refd.add('T:' + p.status); refd.add('C:' + p.customer); }
  const targets = [];
  const pickTemp = (list, tag, table) => {
    const t = list.find((x) => isTemp(x.name) && !refd.has(tag + ':' + x.name));
    if (t) targets.push({ table, name: t.name });
  };
  pickTemp(snap.sections, 'S', 'section_code');
  pickTemp(snap.statuses, 'T', 'status_code');
  pickTemp(snap.customers, 'C', 'customer');

  if (!targets.length) {
    log('   임시값이 없어 성공 케이스를 만들 수 없음 → UI로 임시 코드값 1개 생성 후 삭제');
    const nm = tmpCode();
    const r = await opCodeAdd('section', nm);
    if (r.rec.outcome === 'success') targets.push({ table: 'section_code', name: nm });
    else violate('I7', '성공 케이스용 임시 코드값 생성 실패', r.rec.toasts);
  }
  for (const t of targets) {
    const b = snapshot();
    const r = mysqlRun(`DELETE FROM ${t.table} WHERE name=${sqlStr(t.name)};\nSELECT ROW_COUNT();`);
    const a = snapshot();
    const n = r.ok ? Number((rows(r.out)[0] || ['0'])[0]) : -1;
    if (!r.ok) violate('I7', `미사용 임시값 ${t.table} '${t.name}' DELETE가 실패했다`, { errno: r.errno, err: r.err.trim().split('\n').pop() });
    else if (n !== 1) violate('I7', `미사용 임시값 DELETE의 영향 행수가 1이 아니다(${n}) — ${t.table} '${t.name}'`);
    else ok(`미사용 임시값 ${t.table} '${t.name}' DELETE 성공(1행)`);
    if (a.projects.length !== b.projects.length) violate('I7', 'DELETE로 project 행수가 변했다', diffSnap(b, a));
  }
  const after = snapshot();
  invCommon(after);
  return after;
}

/* ────────────────────────────── 16. 요약 ────────────────────────────── */

function printSummary(finalSnap) {
  const line = '─'.repeat(74);
  console.log('\n' + line);
  console.log('루프 UI 정합성 테스트 요약');
  console.log(line);
  console.log(`시드=${OPT.seed} · 요청 조작수=${OPT.ops} · 실제 기록된 조작=${opLog.length} · 소요 ${((Date.now() - T0) / 1000).toFixed(1)}s`);

  const byOutcome = {};
  for (const o of opLog) byOutcome[o.outcome] = (byOutcome[o.outcome] || 0) + 1;
  console.log('조작 결과 분포: ' + (Object.entries(byOutcome).map(([k, v]) => `${k}=${v}`).join(' · ') || '(없음)'));
  const bad = opLog.filter((o) => o.outcome === 'timeout' || o.outcome === 'trigger-failed' || o.outcome === 'admin-gate');
  if (bad.length) {
    console.log(`\n주의가 필요한 조작 ${bad.length}건:`);
    for (const o of bad.slice(0, 20)) console.log(`  · op#${o.n} [${o.phase}] ${o.desc} → ${o.outcome}`);
  }
  console.log(`오프라인 시나리오 실행: ${['A', 'B', 'C'].map((s) => s + (scenariosRun.has(s) ? '✓' : '✗')).join(' ')}`);

  console.log('\n콘솔 에러 수집(CDP Runtime/Log 채널): ' + consoleErrors.length + '건');
  for (const e of consoleErrors.slice(0, 15)) console.log(`  · [${e.phase}/op#${e.op}] ${e.src}: ${String(e.text).slice(0, 200)}`);
  if (consoleErrors.length > 15) console.log(`  · … 외 ${consoleErrors.length - 15}건`);

  console.log('\n최종 DB 상태:');
  if (finalSnap) {
    console.log(`  project ${finalSnap.projects.length}행 (시작 ${PROJECT_N0}행)`);
    console.log(`  section_code : ${finalSnap.sections.map((x) => `${x.name}(${x.sort}${x.active ? '' : ',숨김'})`).join(', ')}`);
    console.log(`  status_code  : ${finalSnap.statuses.map((x) => `${x.name}(${x.sort}${x.active ? '' : ',숨김'})`).join(', ')}`);
    console.log(`  customer     : ${finalSnap.customers.map((x) => x.name + (x.active ? '' : '(숨김)')).join(', ')}`);
    const leftovers = [...finalSnap.sections, ...finalSnap.statuses, ...finalSnap.customers].filter((x) => isTemp(x.name) || /_zzR\d+$/.test(x.name));
    console.log(`  테스트 잔여 임시값: ${leftovers.length ? leftovers.map((x) => x.name).join(', ') : '없음'}`);
    console.log(`  스냅샷 해시: ${finalSnap.hash}`);
  }

  console.log('\n' + line);
  if (violations.length === 0) {
    console.log('위반된 불변식: 없음  ✓');
  } else {
    console.log(`위반된 불변식: ${violations.length}건`);
    for (const v of violations) console.log(`  ✗ [${v.inv}] op#${v.op} (${v.phase}) ${v.desc}`);
  }
  console.log(line);
  console.log(`재현: node tests/loop-ui-integrity.mjs --seed=${OPT.seed} --ops=${OPT.ops}${OPT.offline ? '' : ' --no-offline'}`);
  console.log(line);
}

/* ────────────────────────────── 17. 진입점 ────────────────────────────── */

async function selfcheck() {
  log('--selfcheck: DB 계층만 읽기 전용 점검(위젯 불필요, 쓰기 없음)');
  if (!existsSync(MYSQL)) { console.error(`mysql.exe를 찾을 수 없습니다: ${MYSQL} (--mysql=경로)`); process.exit(2); }
  const s = snapshot();
  PROJECT_N0 = s.projects.length;
  log(`스냅샷 OK — project ${s.projects.length} · customer ${s.customers.length} · section ${s.sections.length} · status ${s.statuses.length} · hash ${s.hash}`);
  invCommon(s);
  const probe = appProbe();
  log(`앱 계정(${OPT.appUser}) 접속 가능=${probe.connected}${probe.errno ? ' errno=' + probe.errno : ''}`);
  const pl = mustQuery(`SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE user='${OPT.appUser}';`, 'processlist');
  log(`앱 계정 세션 수=${pl[0][0]}`);
  // 기대모델 계산이 도는지 확인(쓰기 없음)
  const plan = { table: 'section_code', kind: 'add', name: 'zzSelfCheck' };
  const exp = expectAfter(s, plan, true);
  log(`기대모델 검산: add 후 section_code ${exp.sections.length}행, 새 sort=${exp.sections[exp.sections.length - 1].sort}`);
  printSummary(s);
  process.exit(violations.length ? 1 : 0);
}

async function main() {
  if (!existsSync(MYSQL)) { console.error(`mysql.exe를 찾을 수 없습니다: ${MYSQL}\n  → --mysql=<경로>로 지정하세요.`); process.exit(2); }
  if (OPT.selfcheck) return selfcheck();

  log(`루프 UI 정합성 테스트 시작 — seed=${OPT.seed} ops=${OPT.ops} port=${OPT.port} offline=${OPT.offline}`);

  cdp = await Cdp.attach(OPT.port);
  log(`CDP 연결: ${cdp.target.url}`);
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = (p && p.exceptionDetails) || {};
    consoleErrors.push({ src: 'exceptionThrown', phase: curPhase, op: curOp, text: `${d.text || ''} ${(d.exception && (d.exception.description || d.exception.value)) || ''}`.trim() });
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (!p || (p.type !== 'error' && p.type !== 'warning')) return;
    consoleErrors.push({ src: 'console.' + p.type, phase: curPhase, op: curOp, text: (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' ') });
  });
  cdp.on('Log.entryAdded', (p) => {
    const e = (p && p.entry) || {};
    if (e.level !== 'error' && e.level !== 'warning') return;
    consoleErrors.push({ src: 'log.' + e.level, phase: curPhase, op: curOp, text: `${e.text || ''} ${e.url || ''}`.trim() });
  });
  await cdp.send('Runtime.enable');
  try { await cdp.send('Log.enable'); } catch (_) { /* WebView2 버전에 따라 없을 수 있음 */ }

  const installed = await ev(INSTALL_JS);
  log(`페이지 헬퍼 __lt 주입: ${installed}`);

  /* ── 사전조건 확인(인증은 하지 않는다 — 확인만) ── */
  curPhase = 'preflight';
  let s = await state();
  if (s.host !== true) { console.error('\n[중단] 위젯(HOST) 컨텍스트가 아닙니다. 브라우저가 아니라 TaskCalendarWidget에 붙어야 합니다.'); process.exit(2); }
  if (s.role !== 'admin') {
    console.error(`\n[중단] 관리자 인증 상태가 아닙니다(getRole()='${s.role}').`);
    console.error('  이 테스트는 관리자 인증 UI 왕복을 수행하지 않습니다.');
    console.error("  → %APPDATA%\\TaskCalendar\\db-config.json 의 adminUnlocked를 true로 두고 위젯을 띄운 뒤 다시 실행하세요.");
    process.exit(2);
  }
  ok(`사전조건 OK — HOST=true, role=admin`);

  if (s.dbOnline !== true) {
    log('dbOnline=false → 지금 새로고침으로 온라인 확보 시도');
    s = (await forceReload(true)) || (await state());
  }
  if (s.dbOnline !== true) { console.error('\n[중단] DB에 연결되지 않았습니다(dbOnline=false). MySQL/계정 잠금 상태를 확인하세요.'); process.exit(2); }

  let snap = snapshot();
  PROJECT_N0 = snap.projects.length;
  log(`시작 DB — project ${snap.projects.length} · customer ${snap.customers.length} · section ${snap.sections.length} · status ${snap.statuses.length} · hash ${snap.hash}`);
  if (PROJECT_N0 !== 14) log(`  (참고) 과제 행수가 14가 아닙니다(${PROJECT_N0}) — 이 값을 기준선으로 고정합니다.`);
  invCommon(snap);

  /* ── 오프라인 시나리오 주입 지점(시드·ops에 의해 결정론적) ── */
  const inject = new Map();
  if (OPT.offline) {
    const put = (pos, tag) => { let p = Math.max(1, Math.min(OPT.ops, pos)); while (inject.has(p)) p++; if (p <= OPT.ops) inject.set(p, tag); };
    put(Math.floor(OPT.ops * 0.25), 'A');
    put(Math.floor(OPT.ops * 0.50), 'C');
    put(Math.floor(OPT.ops * 0.75), 'B');
  }

  /* ── 메인 루프 ── */
  curPhase = 'loop';
  for (let i = 1; i <= OPT.ops; i++) {
    curOp = i;
    curPhase = 'loop';
    try {
      snap = await runRandomOp(snap);
    } catch (e) {
      violate('RUN', `조작 실행 중 예외: ${e.message}`);
      snap = snapshot();
      try { await closeIfOpen('#codeModal'); await closeIfOpen('#customerModal'); } catch (_) { }
    }
    if (i % 10 === 0 || OPT.verbose) log(`진행 ${i}/${OPT.ops} · 위반 누적 ${violations.length}`);

    const tag = inject.get(i);
    if (tag) {
      try {
        snap = tag === 'A' ? await scenarioA() : tag === 'B' ? await scenarioB() : await scenarioC(snap);
      } catch (e) {
        violate(tag, `시나리오 ${tag} 실행 중 예외: ${e.message}`);
        goOnline();
        snap = snapshot();
      }
      curPhase = 'loop';
    }
  }

  /* ── 루프에서 못 넣은 시나리오는 끝에서 반드시 한 번 ── */
  if (OPT.offline) {
    for (const tag of ['A', 'B', 'C']) {
      if (scenariosRun.has(tag)) continue;
      try {
        snap = tag === 'A' ? await scenarioA() : tag === 'B' ? await scenarioB() : await scenarioC(snap);
      } catch (e) { violate(tag, `시나리오 ${tag} 실행 중 예외: ${e.message}`); goOnline(); snap = snapshot(); }
    }
  }

  /* ── I7 하드삭제 정책 ── */
  curOp = OPT.ops;
  try { snap = await phaseHardDelete(snap); }
  catch (e) { violate('I7', `하드삭제 검사 중 예외: ${e.message}`); snap = snapshot(); }

  /* ── 최종 재수렴 ── */
  curPhase = 'final';
  try { snap = await reconverge(); } catch (e) { violate('FIN', `최종 재수렴 중 예외: ${e.message}`); snap = snapshot(); }
  try { await closeIfOpen('#codeModal'); await closeIfOpen('#customerModal'); } catch (_) { }

  printSummary(snap);
  cdp.close();
  process.exit(violations.length ? 1 : 0);
}

main().catch((e) => {
  console.error('\n[치명] ' + (e && e.stack ? e.stack : e));
  emergencyUnlock();
  printSummary(null);
  process.exit(1);
});
