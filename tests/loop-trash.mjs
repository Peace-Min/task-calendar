#!/usr/bin/env node
/* =====================================================================================
 * tests/loop-trash.mjs — 휴지통(영구 삭제) 실동작 루프 시험 · docs/TRASH-DELETE §8-8
 *
 * ★ 이 파일은 `node tests/run-tests.mjs` 의 기본 스위트에 **포함되지 않는다**.
 *   러너는 `*.test.mjs` 만 모으므로 확장자를 `.mjs` 로 둔 것만으로 자동수집에서 빠진다.
 *   실 DB·실 위젯이 필요한 시험을 상시 게이트에 넣지 않는 이유는 늘 같다 — 없는 실패를 만들지 않기 위해서다.
 *
 * 무엇을 하나:
 *   이미 떠 있는 위젯(TC_DEBUG_PORT=9222, **admin 로그인**)에 CDP 로 붙어, 다섯 표(과제·인력·발주처·구분·상태)를
 *   시험 접두(zzP·zzU·zzC·zzT)로 만들고 → 숨기고 → 휴지통에서 보고 → 복구하고 → 이름을 틀리게 쳐 보고 →
 *   이름을 맞춰 지운다. 화면 경로(#trList 의 실제 버튼 · confirmBox · confirmTyped)와 호스트 계약(메시지 직접
 *   전송)을 **둘 다** 지난다 — 화면이 먼저 막아 주는 것과 호스트가 막는 것은 다른 사실이고, 설계 §4.2 가
 *   "힌트와 판정이 갈리면 판정이 이긴다" 를 못 박았기 때문이다.
 *
 * 케이스(각 케이스 끝에 불변식):
 *   C00 sweep + 스냅샷(실행 수 · schema_version · 로그인 계정 권한 · trashGet 이 admin:true 와 목록 다섯)
 *   C01 과제  — 등록 → 편입 → 숨김 → 휴지통 → **화면으로 복구** → 카탈로그 복귀 → 숨김 →
 *               이름 오타(화면: 버튼 안 켜짐 / 호스트: 거부) → 이름 일치 → DB 0행 · 카탈로그 0 · 편입분 dbGone
 *   C02 인력(기록 0)   — 등록 → 퇴사 → 삭제 ok → app_user·cal_user_pref·cal_user_rev 0행
 *   C03 인력(기록 2)   — 기록을 심고 퇴사 → deletable:false · why 문장 그대로 → 화면 버튼 disabled+title →
 *                        호스트로 우회해도 같은 문장으로 거부 → 행 유지(is_active=0)
 *   C04 코드 3종       — 숨긴 과제가 쓰는 값은 거부 → 그 과제를 지우면 삭제 가능 → 복구 시 sort_order=MAX+10
 *   C05 활성 항목 거부 — 숨기지 않은 과제에 trashDelete → 거부(화면 우회)
 *   C06 알 수 없는 대상 / 이미 없는 항목
 *   C07 자기 계정      — **활성 관문(②)이 언제나 먼저다.** 자기 계정 문장은 실동작으로 닿지 않는다(§11-22)
 *   C09 이미 복구됨    — 숨김 → 복구 → **한 번 더 복구** → '이미 복구된 항목입니다 — 목록을 새로고침합니다.'
 *   C10 확인창 취소    — confirmTyped 의 [data-close] **실클릭** → 호스트로 아무것도 나가지 않는다
 *   C11 사유 가시화    — 기록 있는 퇴사자의 why 가 **보이는 줄**(.set-hint[data-trwhy])로 그려진다(툴팁만으로는 안 보인다)
 *   C12 쓰기 중 잠금   — [복구] → [확인] 그 순간 #trList 의 버튼 전부 disabled + #trashModal[data-busy=1] → 회신 뒤 해제
 *   C08 비관리자       — 로그인 계정을 잠시 editor 로 내린다(**반드시 복원**): #usTrash 부재 · admin:false · 삭제 거부
 *
 * 불변식(케이스마다):
 *   I1 다섯 표의 **실행(zz 아닌 행) 수**가 시작과 같다
 *   I2 실행 내용 해시 불변(과제 is_active · 직원 권한/활성 · 코드 활성·순번까지) — C08 만 스스로 재기준
 *   I3 schema_version 불변
 *   I4 로그인 계정이 활성 admin(C08 안에서만 예외 · 그 케이스가 스스로 되돌리고 읽어서 확인한다)
 *   그리고 종료 뒤 **zz 잔재 0** — 이 시험은 데이터를 남기지 않는다.
 *
 * 전제(이 스크립트가 하지 않는 것):
 *   · 위젯을 띄우거나 닫지 않는다. 9222 에 **admin 으로 로그인된 채** 떠 있어야 한다(아니면 판정 없음 = exit 2).
 *   · 앱 코드를 고치지 않는다. 가로채기는 회신 다섯(__userSaved · __projectSaved · __trashDone ·
 *     __applyTrash · __applyProjects)을 **감싸는** 것뿐이고 원본을 반드시 그대로 호출한다.
 *   · 실행(zz 아닌 행)은 만들지도 고치지도 지우지도 않는다. TRUNCATE·스키마 변경 없음.
 *
 * 실행:
 *   $env:TC_TEST_DB_ADMIN_PW='...'   (bash: export TC_TEST_DB_ADMIN_PW=...)
 *   node tests/loop-trash.mjs [--seed=N] [--port=9222] [--budget=120] [-v]
 *
 * 종료코드: 0 = 전부 통과 · 1 = 위반 있음 · 2 = 판정 없음(전제 미충족)
 * 배포 게이트: **무작위 시드 5회 연속 통과**(설계 §8-8). 실패하면 1부터 다시 센다.
 * ===================================================================================== */

import { spawnSync } from 'node:child_process';

/* ────────────────────────────── 0. 인자·자격증명 ────────────────────────────── */

const ARG = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const OPT = {
  seed: Number(ARG.get('seed') || Date.now() % 100000),
  port: Number(ARG.get('port') || process.env.TC_DEBUG_PORT || 9222),
  budget: Number(ARG.get('budget') || 120),
  verbose: ARG.has('verbose') || ARG.has('v'),
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  db: process.env.TC_TEST_DB_NAME || 'taskmgr',
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',   // ← 비밀. 소스에 기본값 없음(이 파일은 커밋된다)
};
if (ARG.has('help') || ARG.has('h')) {
  console.log(`사용법: node tests/loop-trash.mjs [옵션]
  --seed=N      무작위 시드(기본: 시각). 같은 시드면 같은 zz 이름이 만들어진다 — 재현은 이것만 맞추면 된다
  --port=N      CDP 포트(기본 ${OPT.port})
  --budget=N    이 초를 넘기면 경고(기본 120)
  -v            케이스별 상세 로그`);
  process.exit(0);
}
if (!OPT.adminPw) {
  console.error('[판정 없음] DB 관리자 비밀번호가 없습니다. 환경변수 TC_TEST_DB_ADMIN_PW 로 지정하세요.');
  console.error("            PowerShell:  $env:TC_TEST_DB_ADMIN_PW = '<비번>'");
  console.error("            bash:        export TC_TEST_DB_ADMIN_PW='<비번>'");
  process.exit(2);
}

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const log = (...a) => console.log(el(), ...a);
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   ·', ...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ────────────────────────────── 1. 판정 기록 ────────────────────────────── */

let pass = 0, fail = 0;
const FAILED = [];
const SKIPPED = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; if (OPT.verbose) console.log(el(), `  ✓ ${name}`); return true; }
  fail++; FAILED.push(name + (detail ? ' — ' + detail : ''));
  console.log(el(), `  ✗ ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`);
  return false;
}
function okq(name, cond, detail = '') {   // 통과도 반드시 보이게(케이스 요약용)
  if (cond) { pass++; console.log(el(), `  ✓ ${name}`); return true; }
  return ok(name, cond, detail);
}
function skip(name, why) { SKIPPED.push(`${name} — ${why}`); console.log(el(), `  ↷ [건너뜀] ${name} — ${why}`); }
function note(msg) { console.log(el(), `  · ${msg}`); }

/* ────────────────────────────── 2. MySQL 계층 ────────────────────────────── */
/*  ★ 이 저장소의 함정을 그대로 물려받는다(tests/loop-report-wiring.mjs §머리말 실측):
 *    mysql.exe 는 머신 부하가 있을 때 **종료코드 0 인데도 stdout 을 통째로 잃는다**(≈0.9%).
 *    그런데 문장 자체는 실행된다 — "그냥 재시도" 하면 쓰기가 두 번 적용된다.
 *    재시도 자격은 **다시 적용해도 결과가 같은 문장인가** 로만 가른다:
 *      readOnly(기본)   — 읽기
 *      idempotent:true  — 범위 고정 DELETE · 절대값 UPDATE 처럼 증분이 아닌 쓰기
 *    이 파일의 쓰기는 넷뿐이고 전부 자격이 있다: zz 잔재 DELETE(범위 고정) · 로그인 계정 복원(절대값) ·
 *    C08 강등(절대값) · C03 기록 심기(고정 키 — 같은 키를 먼저 지우고 넣으므로 재적용 결과가 같다).
 *  ★ 비밀번호는 **명령줄에 싣지 않는다**(-p 금지). 자식 프로세스 환경변수 MYSQL_PWD 로만 넘긴다 —
 *    명령줄은 같은 PC 의 다른 사용자에게도 보인다.                                                */
const EOF = '__TCEOF__';
let truncSeen = 0;
function sql(q, { readOnly = true, idempotent = false, what = 'SQL' } = {}) {
  const tries = (readOnly || idempotent) ? 3 : 1;
  for (let i = 1; i <= tries; i++) {
    const r = spawnSync(OPT.mysql,
      [`-u${OPT.adminUser}`, '--default-character-set=utf8mb4', '-N', '-B',
       '--connect-timeout=5', '-D', OPT.db],
      { input: Buffer.from(q + `;\nSELECT '${EOF}';\n`, 'utf8'), maxBuffer: 64 << 20, windowsHide: true,
        timeout: 30000, env: { ...process.env, MYSQL_PWD: OPT.adminPw } });
    if (r.error) throw new Error(`${what} 실행 실패: ${r.error.message}`);
    const out = (r.stdout || Buffer.alloc(0)).toString('utf8');
    const err = (r.stderr || Buffer.alloc(0)).toString('utf8');
    if (r.status !== 0) {
      const line = err.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/Using a password/.test(l))[0] || '(stderr 없음)';
      throw new Error(`${what} 실패: ${line}`);
    }
    if (!out.includes(EOF)) {
      truncSeen++;
      if (i < tries) continue;
      const line = err.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/Using a password/.test(l))[0] || '(없음)';
      throw new Error(`${what}: mysql 이 종결 마커를 내지 않았다 — 결과를 믿을 수 없다 ` +
        `(종료코드=${r.status} · stdout ${out.length}자 · stderr=${line} · 시도 ${i}/${tries}). ` +
        (readOnly || idempotent ? '재시도까지 전부 실패했다.'
          : '★ 재시도 자격이 없어 한 번만 보냈다 — 실측상 문장 자체는 적용됐을 가능성이 높다. DB 를 직접 확인할 것.'));
    }
    //  -B(batch) 출력의 이스케이프 복원: \t \n \r \0 \\ — 한글 이름이 그대로 오도록.
    const unesc = (s) => {
      if (s.indexOf('\\') < 0) return s;
      let o = '';
      for (let k = 0; k < s.length; k++) {
        if (s[k] !== '\\' || k === s.length - 1) { o += s[k]; continue; }
        const c = s[++k];
        o += c === 't' ? '\t' : c === 'n' ? '\n' : c === 'r' ? '\r' : c === '0' ? '\0' : c;
      }
      return o;
    };
    return out.split(/\r?\n/).filter((l) => l.length && l !== EOF).map((l) => l.split('\t').map(unesc));
  }
}
const esc = (v) => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
/** 스칼라 한 개(없으면 0) — COUNT 확인이 이 파일 판정의 절반이라 짧은 이름을 준다. */
const n1 = (q, what = '수 조회') => { const r = sql(q, { what }); return r.length ? Number(r[0][0]) : 0; };
const s1 = (q, what = '값 조회') => { const r = sql(q, { what }); return r.length ? r[0][0] : null; };

/* ── 스냅샷 ────────────────────────────────────────────────────────────────
 *  실행(zz 아닌 행)의 **수**와 **내용 해시**를 함께 뜬다. 수만 보면 "한 줄 지우고 한 줄 넣은" 변화가 통과한다.
 *  ★ GROUP_CONCAT 은 기본 1024 바이트에서 **조용히 잘린다** — 잘린 해시는 앞부분만 보므로 방어가 반쪽이 된다.
 *    그래서 세션 변수를 먼저 올린다. ORDER BY 를 넣는 이유는 행 순서가 바뀌어도 해시가 흔들리지 않게.        */
const SNAP_SQL = (me) => `
SET SESSION group_concat_max_len=8388608;
SELECT 'P', COUNT(*) FROM project      WHERE project_name NOT LIKE 'zzP%';
SELECT 'U', COUNT(*) FROM app_user     WHERE login_id     NOT LIKE 'zzU%';
SELECT 'C', COUNT(*) FROM customer     WHERE name         NOT LIKE 'zzC%';
SELECT 'S', COUNT(*) FROM section_code WHERE name         NOT LIKE 'zzT%';
SELECT 'T', COUNT(*) FROM status_code  WHERE name         NOT LIKE 'zzT%';
SELECT 'V', v FROM cal_schema_meta WHERE k='schema_version';
SELECT 'M', edit_role, CAST(is_active AS CHAR), CAST(user_id AS CHAR), name FROM app_user WHERE login_id=${esc(me)};
SELECT 'H', IFNULL(SHA2(GROUP_CONCAT(x ORDER BY x SEPARATOR '|'),256),'(빈집합)') FROM (
            SELECT CONCAT('P/',uid,'/',is_active)                     AS x FROM project      WHERE project_name NOT LIKE 'zzP%'
  UNION ALL SELECT CONCAT('U/',user_id,'/',edit_role,'/',is_active)        FROM app_user     WHERE login_id     NOT LIKE 'zzU%'
  UNION ALL SELECT CONCAT('C/',name,'/',is_active)                         FROM customer     WHERE name         NOT LIKE 'zzC%'
  UNION ALL SELECT CONCAT('S/',name,'/',is_active,'/',sort_order)          FROM section_code WHERE name         NOT LIKE 'zzT%'
  UNION ALL SELECT CONCAT('T/',name,'/',is_active,'/',sort_order)          FROM status_code  WHERE name         NOT LIKE 'zzT%'
) z`;

function dbSnap(me, what = '스냅샷') {
  const rs = sql(SNAP_SQL(me), { what });
  const s = { counts: {}, schemaVersion: null, meRole: null, meActive: null, meUid: 0, meName: '', hash: null };
  for (const c of rs) {
    if (c[0] === 'P') s.counts.project = Number(c[1]);
    else if (c[0] === 'U') s.counts.app_user = Number(c[1]);
    else if (c[0] === 'C') s.counts.customer = Number(c[1]);
    else if (c[0] === 'S') s.counts.section_code = Number(c[1]);
    else if (c[0] === 'T') s.counts.status_code = Number(c[1]);
    else if (c[0] === 'V') s.schemaVersion = c[1];
    else if (c[0] === 'M') { s.meRole = c[1]; s.meActive = c[2] === '1'; s.meUid = Number(c[3]); s.meName = c[4]; }
    else if (c[0] === 'H') s.hash = c[1];
  }
  return s;
}
const countsKey = (c) => `${c.project}/${c.app_user}/${c.customer}/${c.section_code}/${c.status_code}`;

/* ────────────────────────────── 3. 최소 CDP ────────────────────────────── */

class Cdp {
  #ws = null; #id = 0; #p = new Map(); #closed = false;
  static async attach(port) {
    let list;
    try { list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json(); }
    catch (e) {
      throw new Error(`CDP 에 붙지 못했다(포트 ${port}).\n` +
        `  → 위젯을 TC_DEBUG_PORT=${port} 로 먼저 띄우세요(이 스크립트는 위젯을 실행하지 않습니다).\n` +
        `  원인: ${e.message}`);
    }
    //  ?peer=1 프레임은 제외한다 — 조종할 것은 **부모** 창이다.
    const t = (list || []).filter((x) => x.type === 'page' && x.webSocketDebuggerUrl
      && /tcapp\.local/i.test(x.url || '') && !/peer=1/.test(x.url || ''))[0];
    if (!t) throw new Error('부모 page 타겟이 없다 — 위젯이 떠 있고 로그인돼 있어야 한다');
    const c = new Cdp();
    const ws = new WebSocket(t.webSocketDebuggerUrl); c.#ws = ws;
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('WebSocket 연결 시간 초과')), 10000);
      ws.addEventListener('open', () => { clearTimeout(to); res(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(to); rej(new Error('WebSocket 연결 실패')); }, { once: true });
    });
    ws.addEventListener('close', () => { c.#closed = true; });
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.id == null) return;
      const p = c.#p.get(m.id); if (!p) return;
      c.#p.delete(m.id); clearTimeout(p.to);
      m.error ? p.rej(new Error('CDP: ' + m.error.message)) : p.res(m.result);
    });
    return c;
  }
  send(method, params = {}) {
    if (this.#closed) return Promise.reject(new Error('CDP 연결이 끊겼다(위젯 종료?)'));
    const id = ++this.#id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { this.#p.delete(id); rej(new Error('CDP 시간 초과: ' + method)); }, 40000);
      this.#p.set(id, { res, rej, to });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('페이지 JS 예외: ' + String((d.exception && (d.exception.description || d.exception.value)) || d.text).split('\n')[0]);
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.#ws && this.#ws.close(); } catch { } }
}

let cdp = null;
const ev = (e) => cdp.ev(e);
const evj = async (e) => JSON.parse(await cdp.ev(e));
const J = (v) => JSON.stringify(v);

/* ── 가로채기 설치 ─────────────────────────────────────────────────────────
 *  회신 다섯을 **감싼다**. 원본을 반드시 호출하므로 화면 동작은 시험이 없을 때와 같다.
 *  ★ 페이지가 다시 뜨면 사라진다 — 그래서 매 실행 시작에 설치한다.
 *  ★ 이미 설치돼 있으면(같은 페이지 두 번째 실행) 감싸기를 겹치지 않고 계수기만 비운다.
 *    겹쳐 감으면 회신 하나가 두 번 세어져 '회신을 기다리는' 판정이 조용히 거짓말을 한다. */
const INSTALL_JS = `(function(){
  if (window.__tr && window.__tr.v === 1){ var A0=window.__tr; A0.u.length=0; A0.p.length=0; A0.t.length=0; A0.ta=0; A0.pa=0; return 'reset'; }
  var oU=window.__userSaved, oP=window.__projectSaved, oT=window.__trashDone, oA=window.__applyTrash, oQ=window.__applyProjects;
  if(typeof oU!=='function'||typeof oP!=='function'||typeof oT!=='function'||typeof oA!=='function'||typeof oQ!=='function') return 'missing';
  var A={v:1,u:[],p:[],t:[],ta:0,pa:0};
  window.__tr=A;
  window.__userSaved    = function(ok,msg){ A.u.push({ok:!!ok,msg:String(msg==null?'':msg)}); return oU.apply(this,arguments); };
  window.__projectSaved = function(ok,msg,nc){ A.p.push({ok:!!ok,msg:String(msg==null?'':msg),needConfirm:!!nc}); return oP.apply(this,arguments); };
  window.__trashDone    = function(ok,msg){ A.t.push({ok:!!ok,msg:String(msg==null?'':msg)}); return oT.apply(this,arguments); };
  window.__applyTrash   = function(j){ A.ta++; return oA.apply(this,arguments); };
  window.__applyProjects= function(j){ A.pa++; return oQ.apply(this,arguments); };
  return 'installed';
})()`;

/** 페이지 상태 한 덩어리 — 폴링은 전부 이걸로 한다(왕복 수를 줄인다). */
const PSTATE = `JSON.stringify({
  u: __tr.u.length, p: __tr.p.length, t: __tr.t.length, ta: __tr.ta, pa: __tr.pa,
  trBusy: !!__trBusy, trSaving: !!__trSaving, trAdmin: !!__trAdmin, trTab: String(__trTab||''),
  trOpen: (function(){ var e=document.getElementById('trashModal'); return !!e && !e.classList.contains('hidden'); })(),
  lines: document.querySelectorAll('#trList .mba-line').length,
  tabs: document.querySelectorAll('#trTabs [data-trtab]').length,
  usTrash: !!document.getElementById('usTrash'),
  usAdmin: !!document.getElementById('usUserAdmin'),
  cfOpen: (function(){ var e=document.getElementById('confirmModal'); return !!e && !e.classList.contains('hidden'); })(),
  ctOpen: (function(){ var e=document.getElementById('confirmTypedModal'); return !!e && !e.classList.contains('hidden'); })(),
  ctDisabled: (function(){ var b=document.getElementById('ctOk'); return b ? !!b.disabled : null; })(),
  online: !!dbOnline, catalog: (typeof dbCatalog!=='undefined' && dbCatalog) ? dbCatalog.length : 0
})`;
const pstate = () => evj(PSTATE);

async function waitPage(pred, { timeout = 15000, interval = 80 } = {}) {
  const t = Date.now();
  for (;;) {
    const s = await pstate();
    if (pred(s)) return s;
    if (Date.now() - t > timeout) return null;
    await sleep(interval);
  }
}

/* ── 호스트 왕복 세 모양 ──────────────────────────────────────────────────
 *  ① hsend  — hpost 로 보내고 **회신 계수기**가 오르기를 기다린다(__userSaved/__projectSaved/__trashDone).
 *             화면의 가드(uaSend·trSend)를 일부러 건너뛴다: 여기서 보는 것은 **호스트 계약**이다.
 *  ② hreq   — reqId 왕복(hostRequest). trashGet·발주처·코드 관리가 이 모양이다.
 *  ③ 화면   — 실제 버튼을 누른다(아래 uiTrashClick). 그건 케이스가 직접 한다.                       */
async function hsend(payload, chan, { timeout = 20000, expectPush = null } = {}) {
  const b = await pstate();
  await ev(`hpost(${J(payload)})`);
  const s = await waitPage((x) => x[chan] > b[chan], { timeout });
  if (!s) throw new Error(`호스트 회신이 오지 않았다(${chan}): ${J(payload).slice(0, 160)}`);
  const rep = await evj(`JSON.stringify(__tr.${chan}[__tr.${chan}.length-1])`);
  //  성공했으면 호스트가 곧바로 관련 목록을 다시 민다(§4.2·§5.3) — 그것까지 기다려야 다음 판정이 최신 화면을 본다.
  if (rep.ok && expectPush) await waitPage((x) => x[expectPush] > b[expectPush], { timeout: 12000 });
  vlog(`hsend ${payload.cmd} → ok=${rep.ok} "${rep.msg}"`);
  return rep;
}
async function hreq(cmd, params = {}, timeout = 15000) {
  const r = await evj(`hostRequest(${J(cmd)}, ${J(params)}, ${timeout}).then(function(x){ return JSON.stringify(x==null?null:x); })`);
  vlog(`hreq ${cmd} → ${JSON.stringify(r).slice(0, 200)}`);
  return r;
}
/** trashGet 회신을 목록 다섯이 든 평평한 객체로 — 회신은 {ok, data, msg} 로 감싸여 온다(RunTrashGetAsync). */
async function trashGet() {
  const r = await hreq('trashGet', {}, 15000);
  const d = (r && r.data) ? r.data : r;
  return { reply: r, data: d || null };
}
const trFind = (data, key, k) => {
  const arr = (data && Array.isArray(data[key])) ? data[key] : [];
  return arr.find((x) => x && String(x.key) === String(k)) || null;
};

/* ── 화면 조작 ─────────────────────────────────────────────────────────── */

/** 휴지통을 열고(또는 다시 열고) 회신이 도착할 때까지 기다린다. 탭은 캐시가 아니라 매번 새 조회다. */
async function openTrash({ tab = null } = {}) {
  await ev(`(typeof closeModal==='function' && closeModal('#trashModal'), 1)`);
  await ev(`openTrash()`);
  const s = await waitPage((x) => x.trOpen && !x.trBusy, { timeout: 20000 });
  if (!s) throw new Error('휴지통이 열리지 않았다(회신이 오지 않음)');
  if (tab && s.trTab !== tab) {
    const clicked = await ev(`(function(){var b=document.querySelector('#trTabs [data-trtab=${J(tab)}]'); if(!b) return false; b.click(); return true;})()`);
    if (!clicked) throw new Error(`휴지통 탭 버튼이 없다: ${tab}`);
    await waitPage((x) => x.trTab === tab, { timeout: 5000 });
  }
  return await pstate();
}
/** 한 행의 두 버튼 상태 — 있는가 · 꺼졌는가 · 사유(title)가 붙었는가. */
const trRow = (key) => evj(`(function(){
  var out = { restore:null, del:null };
  var bs = document.querySelectorAll('#trList [data-top]');
  for(var i=0;i<bs.length;i++){
    var b = bs[i];
    if(String(b.dataset.tkey||'') !== ${J(String(key))}) continue;
    var o = { disabled: !!b.disabled, title: String(b.title||''), text: String(b.textContent||'') };
    if(b.dataset.top === 'restore') out.restore = o; else if(b.dataset.top === 'delete') out.del = o;
  }
  return JSON.stringify(out);
})()`);
/** 행의 버튼을 실제로 누른다. 반환: 'clicked' | 'disabled' | 'notfound' */
const uiTrashClick = (top, key) => ev(`(function(){
  var bs = document.querySelectorAll('#trList [data-top=${J(top)}]');
  for(var i=0;i<bs.length;i++){
    if(String(bs[i].dataset.tkey||'') !== ${J(String(key))}) continue;
    if(bs[i].disabled) return 'disabled';
    bs[i].click(); return 'clicked';
  }
  return 'notfound';
})()`);
/** confirmBox 의 [확인] — 복구 경로가 지나는 문. */
async function clickCfOk() {
  const s = await waitPage((x) => x.cfOpen === true, { timeout: 8000 });
  if (!s) throw new Error('confirmBox 가 열리지 않았다');
  await ev(`(function(){var b=document.getElementById('cfOk'); if(b) b.click(); return 1;})()`);
}
/** confirmTyped 에 이름을 친다 — 입력 이벤트까지 실제로 낸다(oninput 이 버튼을 켠다). */
const ctType = (text) => ev(`(function(){
  var i=document.getElementById('ctInput'); if(!i) return false;
  i.value=${J(String(text))};
  i.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
})()`);
const ctOkClick = () => ev(`(function(){var b=document.getElementById('ctOk'); if(b) b.click(); return 1;})()`);
const ctCancel = () => ev(`(typeof closeModal==='function' && closeModal('#confirmTypedModal'), 1)`);

/* ── 카탈로그·편입(개인 카테고리) ──────────────────────────────────────── */

const catalogHas = (uid) => evj(`JSON.stringify(!!(typeof dbCatalog!=='undefined' && dbCatalog && dbCatalog.some(function(c){ return c && c.id === 'db-' + ${J(uid)}; })))`);
/** state.categories 안의 편입분 — 없으면 null. dbGone 이 이 시험의 관심사다. */
const subCat = (uid) => evj(`(function(){
  var c = (state.categories||[]).find(function(x){ return x && x.id === 'db-' + ${J(uid)}; });
  return JSON.stringify(c ? { id:c.id, name:c.name, source:c.source, dbGone: !!c.dbGone } : null);
})()`);
/** 앱 자신의 편입/해제 경로(카탈로그 화면의 [추가]/[제거])를 그대로 부른다.
 *  ★ SQL 로 심지 않는 이유: 앱은 DB 모드라 cal_category 를 스스로 소유한다. 뒤에서 행을 만들거나 지우면
 *    앱의 state 와 갈리고, 다음 저장이 지운 행을 되살리거나 심은 행을 지운다(잔재의 씨앗). */
const appSubscribe = (uid) => ev(`(offSubscribeFromCatalog('db-' + ${J(uid)}), 1)`);
const appUnsubscribe = (uid) => ev(`(offUnsubscribeFromCatalog('db-' + ${J(uid)}), 1)`);
/** cal_category 가 DB 에 실제로 앉을 때까지 기다린다(dbSave 는 비동기 왕복이다). */
async function waitSqlCount(q, want, { timeout = 15000, what = 'DB 반영 대기' } = {}) {
  const t = Date.now();
  for (;;) {
    if (n1(q, what) === want) return true;
    if (Date.now() - t > timeout) return false;
    await sleep(200);
  }
}

/* ────────────────────────────── 4. 불변식 ────────────────────────────── */

let ME = 'phmin';
let BASE = null;            // 시작 스냅샷
let EXPECT = null;          // 지금 기대되는 모습(정당한 변경을 낸 케이스가 스스로 갱신한다 — C08 뿐이다)

function rebase(why) {
  const s = dbSnap(ME, '기대값 재기준');
  EXPECT = { counts: { ...s.counts }, hash: s.hash, meRole: s.meRole, meActive: s.meActive };
  note(`기대값 재기준: ${why} (해시 ${String(s.hash).slice(0, 12)} · ${ME}=${s.meRole}/${s.meActive ? '활성' : '비활성'})`);
  return s;
}

function invariants(caseId) {
  const s = dbSnap(ME, `불변식(${caseId})`);
  const fail0 = fail;

  ok(`${caseId} I1 다섯 표 실행 수 불변(${countsKey(EXPECT.counts)})`,
    countsKey(s.counts) === countsKey(EXPECT.counts), `실제 ${countsKey(s.counts)}`);
  ok(`${caseId} I2 실행 내용 해시 불변`, s.hash === EXPECT.hash,
    `${String(EXPECT.hash).slice(0, 12)} → ${String(s.hash).slice(0, 12)} — zz 아닌 행이 바뀌었다`);
  ok(`${caseId} I3 schema_version 불변(${BASE.schemaVersion})`, s.schemaVersion === BASE.schemaVersion, `실제 ${s.schemaVersion}`);
  ok(`${caseId} I4 로그인 계정 ${ME} = ${EXPECT.meRole}/${EXPECT.meActive ? '활성' : '비활성'}`,
    s.meRole === EXPECT.meRole && s.meActive === EXPECT.meActive, `실제 ${s.meRole}/${s.meActive}`);

  //  넷이 모두 통과했으면 한 줄로만 말한다 — 케이스마다 네 줄이면 진짜 실패가 묻힌다.
  if (fail === fail0) {
    console.log(el(), `  ✓ ${caseId} 불변식 I1~I4 ` +
      `(실행 ${countsKey(s.counts)} · v${s.schemaVersion} · ${ME}=${s.meRole})`);
  }
  return s;
}

/* ────────────────────────────── 5. 정리(시작·종료 양쪽) ────────────────────────────── */
/*  ★ 2026-09-07 잔재 사고의 교훈: 종료 정리만으로는 부족하다(강제 종료는 어떤 핸들러도 못 받는다).
 *    그래서 **다음 실행이 시작할 때 이전 잔재를 먼저 걷어낸다**. 둘을 합쳐야 닫힌다.
 *  ★ 지우는 순서는 FK 순서다: 자식 캘린더 표 → cal_user_pref/rev → app_user → project → 코드 3종.
 *    (customer/section_code/status_code 는 project 가 먼저 사라져야 지워진다 — FK RESTRICT.)
 *  ★ 편입분(cal_category, source='db')은 **이름으로** 찾는다. 과제 행이 이미 사라진 잔재에는
 *    project_uid 로 되짚을 근거가 없기 때문이다 — 편입분의 name 은 과제명(zzP…)을 그대로 물려받는다. */
function sweepZz(reason) {
  const before = {
    user: n1(`SELECT COUNT(*) FROM app_user WHERE login_id LIKE 'zzU%'`, 'zz 인력 수'),
    proj: n1(`SELECT COUNT(*) FROM project WHERE project_name LIKE 'zzP%'`, 'zz 과제 수'),
    cat: n1(`SELECT COUNT(*) FROM cal_category WHERE source='db' AND name LIKE 'zzP%'`, 'zz 편입분 수'),
    cust: n1(`SELECT COUNT(*) FROM customer WHERE name LIKE 'zzC%'`, 'zz 발주처 수'),
    sec: n1(`SELECT COUNT(*) FROM section_code WHERE name LIKE 'zzT%'`, 'zz 구분 수'),
    st: n1(`SELECT COUNT(*) FROM status_code WHERE name LIKE 'zzT%'`, 'zz 상태 수'),
  };
  const total = Object.values(before).reduce((a, b) => a + b, 0);
  if (total === 0) return { swept: 0, left: 0 };

  const ids = sql(`SELECT user_id FROM app_user WHERE login_id LIKE 'zzU%'`, { what: 'zz 사용자 id' }).map((r) => r[0]);
  const IN = ids.length ? ids.join(',') : '-1';
  const kids = ['cal_entry_commit', 'cal_entry_except', 'cal_todo_day_note', 'cal_report_hours',
    'cal_task_hours', 'cal_attendance', 'cal_report_daily', 'cal_report_weekly', 'cal_migration_log',
    'cal_todo', 'cal_entry', 'cal_room', 'cal_category', 'cal_user_pref', 'cal_user_rev'];
  const stmts = kids.map((t) => `DELETE FROM ${t} WHERE user_id IN (${IN})`);
  stmts.push(`DELETE FROM cal_category WHERE source='db' AND name LIKE 'zzP%'`);
  stmts.push(`DELETE FROM app_user WHERE login_id LIKE 'zzU%'`);
  stmts.push(`DELETE FROM project WHERE project_name LIKE 'zzP%'`);
  stmts.push(`DELETE FROM customer WHERE name LIKE 'zzC%'`);
  stmts.push(`DELETE FROM section_code WHERE name LIKE 'zzT%'`);
  stmts.push(`DELETE FROM status_code WHERE name LIKE 'zzT%'`);
  //  범위 고정 DELETE — 두 번째는 0행이라 재적용이 무동작이다(idempotent 자격).
  sql(stmts.join(';\n'), { readOnly: false, idempotent: true, what: 'zz 잔재 삭제' });

  const left = zzLeft();
  console.error(`[cleanup] zz 정리(${reason}): 인력 ${before.user} · 과제 ${before.proj} · 편입분 ${before.cat} · ` +
    `발주처 ${before.cust} · 구분 ${before.sec} · 상태 ${before.st}` +
    (left ? ` — ★ ${left}건이 남았다(FK 가 붙들고 있다 — 수동 확인)` : ' — 남은 것 없음'));
  return { swept: total, left };
}
function zzLeft() {
  return n1(`SELECT
      (SELECT COUNT(*) FROM app_user     WHERE login_id LIKE 'zzU%')
    + (SELECT COUNT(*) FROM project      WHERE project_name LIKE 'zzP%')
    + (SELECT COUNT(*) FROM cal_category WHERE source='db' AND name LIKE 'zzP%')
    + (SELECT COUNT(*) FROM customer     WHERE name LIKE 'zzC%')
    + (SELECT COUNT(*) FROM section_code WHERE name LIKE 'zzT%')
    + (SELECT COUNT(*) FROM status_code  WHERE name LIKE 'zzT%')`, 'zz 잔재 수');
}

/** 로그인 계정을 admin/활성으로 되돌린다 — C08 이 잠깐 내리기 때문이다. 절대값 UPDATE(idempotent). */
function restoreMe(loginId) {
  sql(`UPDATE app_user SET edit_role='admin', is_active=1 WHERE login_id=${esc(loginId)}`,
    { readOnly: false, idempotent: true, what: '로그인 계정 복원' });
  const r = sql(`SELECT edit_role, CAST(is_active AS CHAR) FROM app_user WHERE login_id=${esc(loginId)}`, { what: '복원 확인' });
  return r.length ? (r[0][0] === 'admin' && r[0][1] === '1') : false;
}

let cleaned = false;
function cleanupAll(reason) {
  if (cleaned) return;
  cleaned = true;
  try { sweepZz(reason); } catch (e) { console.error('[cleanup] zz 정리 실패: ' + e.message); }
  try {
    if (!restoreMe(ME)) {
      console.error(`[cleanup] ★★ ${ME} 복원 실패 — 수동으로 다음을 실행하세요:`);
      console.error(`          UPDATE app_user SET edit_role='admin', is_active=1 WHERE login_id='${ME}';`);
    }
  } catch (e) {
    console.error('[cleanup] ★★ 로그인 계정 복원 실패: ' + e.message);
    console.error(`          UPDATE app_user SET edit_role='admin', is_active=1 WHERE login_id='${ME}';`);
  }
}
process.on('exit', () => cleanupAll('exit'));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanupAll(sig); process.exit(130); });
process.on('uncaughtException', (e) => { console.error(e); cleanupAll('uncaughtException'); process.exit(1); });

/* ────────────────────────────── 6. 케이스 도우미 ────────────────────────────── */

const caseT = new Map();
function tick(id) { caseT.set(id, Date.now()); }
function tock(id) { const ms = Date.now() - (caseT.get(id) || Date.now()); log(`   [${id}] ${(ms / 1000).toFixed(1)}s`); }

/** 케이스 하나 — 시간을 재고, 끝에 불변식을 돌린다. 예외는 그 케이스만 죽인다(뒤 케이스는 계속). */
async function runCase(id, title, fn) {
  log(`── ${id} ${title} ──`);
  tick(id);
  try { await fn(); }
  catch (e) { ok(`${id} 실행`, false, e.message); }
  try { invariants(id); } catch (e) { ok(`${id} 불변식 조회`, false, e.message); }
  tock(id);
}

/* 시험 이름 — 접두 규약(zzP·zzU·zzC·zzT)을 한 곳에서만 만든다. 같은 시드면 같은 이름이 나온다(재현). */
const NM = {
  proj: (n) => `zzP${OPT.seed}_${n}`,
  user: (n) => `zzU${OPT.seed}_${n}`,           // login_id 형식 ^[A-Za-z0-9._-]{1,50}$ 를 지킨다
  cust: () => `zzC${OPT.seed}발주처`,
  sec: () => `zzT${OPT.seed}구분`,
  stat: () => `zzT${OPT.seed}상태`,
};
/** 과제 하나를 앱 경로(saveProject)로 만들고 uid 를 돌려준다. */
async function makeProject(name, { section, customer, status }) {
  const rep = await hsend({
    cmd: 'saveProject', uid: '', section, customer, projectName: name,
    contractName: '', commonName: name + '_공통', startDate: '2026-01-01', endDate: '2026-12-31',
    devEndDate: '', status, note: '', confirm: true,   // confirm=true — '비슷한 과제' 소프트 경고를 건너뛴다
  }, 'p', { expectPush: 'pa' });
  if (!rep.ok) throw new Error(`과제 등록 실패: ${rep.msg}`);
  const uid = s1(`SELECT uid FROM project WHERE project_name=${esc(name)}`, '새 과제 uid');
  if (!uid) throw new Error('과제를 만들었는데 DB 에서 uid 를 찾지 못했다');
  return uid;
}
/** 직원 하나를 앱 경로(saveUser)로 만들고 user_id 를 돌려준다. */
async function makeUser(loginId, { title, role = 'viewer' }) {
  const rep = await hsend({
    cmd: 'saveUser', userId: 0, loginId, name: loginId, title,
    orgId: 0, viewScope: 'self', editRole: role, includeInactive: false,
  }, 'u');
  if (!rep.ok) throw new Error(`직원 등록 실패: ${rep.msg}`);
  const uid = Number(s1(`SELECT user_id FROM app_user WHERE login_id=${esc(loginId)}`, '새 직원 user_id') || 0);
  if (!uid) throw new Error('직원을 만들었는데 DB 에서 user_id 를 찾지 못했다');
  return uid;
}
const projActive = (uid) => Number(s1(`SELECT CAST(is_active AS CHAR) FROM project WHERE uid=${esc(uid)}`, '과제 활성') || -1);
const projRows = (uid) => n1(`SELECT COUNT(*) FROM project WHERE uid=${esc(uid)}`, '과제 행 수');

/* 거부 문구 — 호스트 상수와 **글자까지 같아야** 한다(ProjectDb.cs §4.3). 여기 적힌 것이 계약이다. */
const MSG = {
  kind: '알 수 없는 대상입니다.',
  gone: '이미 삭제됐거나 없는 항목입니다 — 목록을 새로고침합니다.',
  active: '숨긴(퇴사) 항목만 지울 수 있습니다. 먼저 숨기세요.',
  name: '입력한 이름이 다릅니다.',
  self: '자기 계정은 지울 수 없습니다.',
  //  이미 활성인 항목의 복구 — 실패가 아니라 **목록이 낡은 것**이라 문구가 새로고침을 시킨다(TrashAlreadyActiveMsg).
  already: '이미 복구된 항목입니다 — 목록을 새로고침합니다.',
  done: '영구 삭제했습니다.',
  records: (n) => `기록 ${n}건이 있어 지울 수 없습니다. 퇴사 상태로 유지됩니다.`,
  inUse: (n) => `이 값을 쓰는 과제가 ${n}건(숨긴 과제 포함) 있어 지울 수 없습니다.`,
};

/* ────────────────────────────── 7. 본체 ────────────────────────────── */

async function main() {
  log(`휴지통 루프 시험 — 시드 ${OPT.seed} · 포트 ${OPT.port} · DB ${OPT.db}`);

  /* ── 시작 정리 + 전제 확인 ─────────────────────────────────────────── */
  sweepZz('시작');
  const left0 = zzLeft();
  if (left0) { console.error(`[판정 없음] 시작 정리 뒤에도 zz 잔재 ${left0}건이 남았다 — 손으로 확인해야 한다`); process.exit(2); }

  cdp = await Cdp.attach(OPT.port);
  const inst = await ev(INSTALL_JS);
  if (inst === 'missing') { console.error('[판정 없음] 페이지에 휴지통 회신 함수가 없다 — 휴지통 이전 버전의 위젯이다'); process.exit(2); }
  vlog(`가로채기: ${inst}`);

  const who = await evj(`JSON.stringify({host: !!HOST, id: (currentUser&&currentUser.loginId)||''})`);
  if (!who.host || !who.id) { console.error('[판정 없음] 위젯이 로그인 상태가 아니다'); process.exit(2); }
  ME = who.id;

  BASE = dbSnap(ME, '시작 스냅샷');
  if (!BASE.meUid) { console.error(`[판정 없음] 로그인 계정(${ME})이 app_user 에 없다`); process.exit(2); }
  if (BASE.meRole !== 'admin' || !BASE.meActive) {
    console.error(`[판정 없음] 로그인 계정(${ME})이 활성 admin 이 아니다(${BASE.meRole}/${BASE.meActive ? '활성' : '비활성'}) — 휴지통은 admin 으로만 판정된다`);
    process.exit(2);
  }
  EXPECT = { counts: { ...BASE.counts }, hash: BASE.hash, meRole: BASE.meRole, meActive: BASE.meActive };
  log(`로그인 계정 ${ME}(user_id=${BASE.meUid}, 이름 "${BASE.meName}") · 활성 admin 확인`);
  log(`시작 스냅샷: 실행 ${countsKey(BASE.counts)}(과제/직원/발주처/구분/상태) · schema_version=${BASE.schemaVersion} · 해시 ${String(BASE.hash).slice(0, 12)}`);

  //  실행 코드값 — 시험 과제가 빌려 쓴다(값을 고치지 않는다. 참조만 한다).
  //  ★ '선진행'은 제외한다: 그 구분은 날짜·상태를 강제로 비우는 특수 규칙이 있어(UpsertProjectAsync)
  //    시험 과제가 의도한 모습으로 앉지 않는다.
  const REAL = {
    section: s1(`SELECT name FROM section_code WHERE is_active=1 AND name<>'선진행' AND name NOT LIKE 'zzT%' ORDER BY sort_order, name LIMIT 1`, '실 구분'),
    customer: s1(`SELECT name FROM customer WHERE is_active=1 AND name NOT LIKE 'zzC%' ORDER BY name LIMIT 1`, '실 발주처'),
    status: s1(`SELECT name FROM status_code WHERE is_active=1 AND name NOT LIKE 'zzT%' ORDER BY sort_order, name LIMIT 1`, '실 상태'),
    title: s1(`SELECT name FROM title_code WHERE is_active=1 ORDER BY sort_order, name LIMIT 1`, '실 직급'),
  };
  if (!REAL.section || !REAL.customer || !REAL.status || !REAL.title) {
    console.error(`[판정 없음] 시험 과제를 만들 실 코드값이 모자란다: ${JSON.stringify(REAL)}`);
    process.exit(2);
  }
  vlog(`빌려 쓸 실 코드값: 구분=${REAL.section} 발주처=${REAL.customer} 상태=${REAL.status} 직급=${REAL.title}`);

  //  진입 버튼(#usTrash)은 권한 회신이 만든다 — C08 이 '내려가면 사라진다'를 보려면 먼저 서 있어야 한다.
  await ev(`loadUserPerm()`);
  const entry0 = await waitPage((x) => x.usTrash === true, { timeout: 15000 });

  /* ── C00 전제 · 회신 모양 ───────────────────────────────────────────── */
  await runCase('C00', '전제 · 진입 버튼 · trashGet 회신 모양', async () => {
    okq('C00 「휴지통」 진입 버튼(#usTrash)이 관리자 회신으로 생성됐다', !!entry0,
      '#usTrash 가 없다 — usAdminBtnSync 가 admin 을 admin 으로 읽지 못했다');
    const { reply, data } = await trashGet();
    if (!okq('C00 trashGet 회신 ok(found)', !!(reply && reply.ok), JSON.stringify(reply).slice(0, 200))) return;
    okq('C00 admin:true', !!(data && data.admin === true), JSON.stringify(data && data.admin));
    const keys = ['projects', 'users', 'customers', 'sections', 'statuses'];
    const miss = keys.filter((k) => !Array.isArray(data && data[k]));
    okq('C00 목록 다섯이 모두 배열로 왔다', miss.length === 0, '없는 키: ' + miss.join(', '));
    if (miss.length === 0) {
      note(`휴지통 기준선: 과제 ${data.projects.length} · 인력 ${data.users.length} · 발주처 ${data.customers.length} · ` +
        `구분 ${data.sections.length} · 상태 ${data.statuses.length}건(전부 실행 — 이 수는 라운드 끝에 그대로 돌아와야 한다)`);
    }
    //  행 모양 계약 — 한 건이라도 있으면 여섯 필드가 다 있어야 한다(§4.2).
    const any = keys.map((k) => (data && data[k] && data[k][0]) || null).find(Boolean);
    if (any) {
      const need = ['key', 'name', 'sub', 'refs', 'deletable', 'why'];
      const lack = need.filter((f) => !(f in any));
      okq('C00 행 모양이 계약대로(key·name·sub·refs·deletable·why)', lack.length === 0, '빠진 필드: ' + lack.join(', '));
    } else note('휴지통이 비어 있어 행 모양은 뒤 케이스에서 본다');
  });

  const P1 = NM.proj(1);

  /* ── C01 과제 — 편입 → 숨김 → 복구 → 삭제 ────────────────────────── */
  await runCase('C01', `과제(${P1}) 등록·편입·숨김·복구·이름대조·삭제`, async () => {
    const uid = await makeProject(P1, REAL);
    okq('C01 과제가 DB 에 활성으로 앉았다', projActive(uid) === 1, `is_active=${projActive(uid)}`);
    let has = false;
    for (let i = 0; i < 40 && !has; i++) { has = await catalogHas(uid); if (!has) await sleep(150); }
    if (!okq('C01 카탈로그에 새 과제가 실렸다(__applyProjects)', has)) return;

    //  ① 편입 — 앱 자신의 경로(카탈로그 [추가])로. 이 한 행이 곧 refs 1 이 된다.
    await appSubscribe(uid);
    const c0 = await subCat(uid);
    okq('C01 편입분이 생겼다(source=db · dbGone 아님)', !!c0 && c0.source === 'db' && c0.dbGone === false, JSON.stringify(c0));
    const seeded = await waitSqlCount(`SELECT COUNT(*) FROM cal_category WHERE project_uid=${esc(uid)}`, 1,
      { what: 'C01 편입분 DB 반영' });
    if (!okq('C01 편입분이 DB(cal_category)에 앉았다', seeded, '15초 안에 dbSave 가 반영되지 않았다')) return;

    //  ①-b 두 번째 편입자 — refs 는 '편입한 **사람 수**'다. 하나만 두면 '1이 나온다'가 우연인지 계약인지 갈리지 않는다.
    //     ★ SQL 로 심는 이유는 C03 과 같다: 이 계정은 한 번도 로그인하지 않으므로(넷커스 자격이 없다) 앱 경로가 없다.
    //     ★ uid 는 반드시 'db-' + project.uid 다 — chk_cal_category_projuid 가 (source='db' · 39자 · 접두 db-)
    //       셋을 함께 강제한다. 어기면 3819 로 막힌다(schema-calendar.sql §5.2).
    const U0 = NM.user(0);
    let u0 = 0;
    try { u0 = await makeUser(U0, { title: REAL.title }); }
    catch (e) { ok('C01 두 번째 편입자 등록', false, e.message); }
    if (u0) {
      sql(`DELETE FROM cal_category WHERE user_id=${u0};\n` +
        `INSERT INTO cal_category (user_id,cat_no,uid,source,name,color,description,project_uid,uses_repo,sort_order,created_at,updated_at) ` +
        `VALUES (${u0},1,${esc('db-' + uid)},'db',${esc(P1)},'#5b6b7d','',${esc(uid)},0,10,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        { readOnly: false, idempotent: true, what: 'C01 두 번째 편입분 심기' });
      const n2 = n1(`SELECT COUNT(*) FROM cal_category WHERE project_uid=${esc(uid)}`, 'C01 편입분 수');
      okq('C01 같은 과제를 가리키는 편입분이 둘이 됐다(두 사람)', n2 === 2, `실제 ${n2}`);
    }
    const wantRefs = u0 ? 2 : 1;

    //  ② 숨김 — 여기서부터 휴지통의 세계다.
    const hide = await hsend({ cmd: 'setProjectActive', uid, active: false }, 'p', { expectPush: 'pa' });
    if (!okq('C01 숨김 성공 회신', hide.ok, hide.msg)) return;
    okq('C01 DB is_active=0', projActive(uid) === 0, `is_active=${projActive(uid)}`);
    okq('C01 카탈로그에서 사라졌다', (await catalogHas(uid)) === false);
    const c1 = await subCat(uid);
    okq('C01 편입분이 dbGone 으로 바뀌었다(숨김도 "카탈로그에 없음"이다)', !!c1 && c1.dbGone === true, JSON.stringify(c1));

    //  ③ 휴지통 조회 — 힌트(deletable·refs·why)가 설계대로인가.
    const g = (await trashGet()).data;
    const row = trFind(g, 'projects', uid);
    if (!okq('C01 휴지통 「과제」 탭에 보인다', !!row, '목록에 없다')) return;
    okq('C01 이름이 그대로다', row.name === P1, JSON.stringify(row.name));
    okq('C01 deletable:true(과제는 참조가 있어도 지울 수 있다 · §3.1)', row.deletable === true, JSON.stringify(row.deletable));
    okq(`C01 refs = 편입한 개인 카테고리 수(${wantRefs})`, Number(row.refs) === wantRefs, `실제 ${row.refs}`);
    okq('C01 why 는 비어 있다(막을 이유가 없다)', row.why === '', JSON.stringify(row.why));

    //  ④ 화면 — 실제 DOM 의 버튼 둘.
    let s = await openTrash({ tab: 'project' });
    okq('C01 휴지통이 관리자 모드로 열렸다(탭 5개)', s.trAdmin === true && s.tabs === 5, `admin=${s.trAdmin} tabs=${s.tabs}`);
    const btn = await trRow(uid);
    okq('C01 화면에 [복구]가 있다', !!btn.restore && btn.restore.text === '복구', JSON.stringify(btn.restore));
    okq('C01 화면의 [영구 삭제]가 켜져 있다', !!btn.del && btn.del.disabled === false, JSON.stringify(btn.del));

    //  ⑤ 복구 — 화면 경로 그대로(버튼 → confirmBox → [복구]).
    {
      const b = await pstate();
      const c = await uiTrashClick('restore', uid);
      if (!okq('C01 [복구] 클릭', c === 'clicked', c)) return;
      await clickCfOk();
      const done = await waitPage((x) => x.t > b.t, { timeout: 20000 });
      if (!okq('C01 복구 회신 도착', !!done)) return;
      const rep = await evj(`JSON.stringify(__tr.t[__tr.t.length-1])`);
      if (!okq('C01 복구 성공', rep.ok === true, rep.msg)) return;
      //  ★ 푸시(__applyTrash·__applyProjects)는 **성공했을 때만** 온다 — 실패에도 기다리면
      //    한 케이스가 타임아웃 12초를 헛되이 태우고, 그 지연이 원인처럼 보인다.
      await waitPage((x) => x.ta > b.ta && x.pa > b.pa, { timeout: 12000 });
    }
    okq('C01 DB is_active=1 로 돌아왔다', projActive(uid) === 1, `is_active=${projActive(uid)}`);
    okq('C01 카탈로그에 복귀했다', (await catalogHas(uid)) === true);
    const c2 = await subCat(uid);
    okq('C01 편입분의 dbGone 이 풀렸다', !!c2 && c2.dbGone === false, JSON.stringify(c2));

    //  ⑥ 다시 숨기고 — 이름 대조를 화면과 호스트 양쪽에서 본다.
    const hide2 = await hsend({ cmd: 'setProjectActive', uid, active: false }, 'p', { expectPush: 'pa' });
    if (!okq('C01 다시 숨김', hide2.ok, hide2.msg)) return;
    await openTrash({ tab: 'project' });

    //  ⑥-a 화면: 틀린 이름을 치면 [영구 삭제]가 **켜지지 않는다**.
    {
      const c = await uiTrashClick('delete', uid);
      if (!okq('C01 [영구 삭제] 클릭 → 이름 입력창', c === 'clicked', c)) return;
      const opened = await waitPage((x) => x.ctOpen === true, { timeout: 8000 });
      if (!okq('C01 confirmTyped 가 열렸다', !!opened)) return;
      okq('C01 처음에는 버튼이 꺼져 있다', opened.ctDisabled === true, String(opened.ctDisabled));
      await ctType(P1 + '오타');
      const wrong = await pstate();
      okq('C01 이름이 다르면 버튼이 켜지지 않는다', wrong.ctDisabled === true, String(wrong.ctDisabled));
      await ctType(' ' + P1);   // 앞 공백 한 칸 — TRIM 하지 않는다는 계약(§5.2)
      const pad = await pstate();
      okq('C01 앞뒤 공백도 다른 이름이다(TRIM 없음)', pad.ctDisabled === true, String(pad.ctDisabled));
      await ctCancel();
      await waitPage((x) => x.ctOpen === false, { timeout: 5000 });
    }

    //  ⑥-b 호스트: 화면을 통째로 우회해도 같은 문장으로 거부한다(시험 계약 ⑤).
    {
      const rep = await hsend({ cmd: 'trashDelete', kind: 'project', key: uid, confirm: 'wrong' }, 't');
      okq('C01 이름 불일치 거부', rep.ok === false, `ok=${rep.ok}`);
      okq('C01 거부 문구가 §4.3 그대로', rep.msg === MSG.name, JSON.stringify(rep.msg));
      okq('C01 DB 행은 그대로다', projRows(uid) === 1, `행 ${projRows(uid)}`);
    }

    //  ⑦ 이름을 맞춰 삭제 — 화면 경로.
    {
      await openTrash({ tab: 'project' });
      const b = await pstate();
      const c = await uiTrashClick('delete', uid);
      if (!okq('C01 [영구 삭제] 다시 클릭', c === 'clicked', c)) return;
      if (!(await waitPage((x) => x.ctOpen === true, { timeout: 8000 }))) { ok('C01 confirmTyped 재오픈', false); return; }
      await ctType(P1);
      const on = await pstate();
      if (!okq('C01 이름이 같으면 버튼이 켜진다', on.ctDisabled === false, String(on.ctDisabled))) return;
      await ctOkClick();
      const done = await waitPage((x) => x.t > b.t, { timeout: 20000 });
      if (!okq('C01 삭제 회신 도착', !!done)) return;
      const rep = await evj(`JSON.stringify(__tr.t[__tr.t.length-1])`);
      const delOk = okq('C01 삭제 성공', rep.ok === true, rep.msg);
      okq('C01 성공 문구', rep.msg === MSG.done, JSON.stringify(rep.msg));
      if (delOk) await waitPage((x) => x.ta > b.ta && x.pa > b.pa, { timeout: 12000 });
    }
    okq('C01 DB 에서 과제 행이 사라졌다(0행)', projRows(uid) === 0, `행 ${projRows(uid)}`);
    okq('C01 카탈로그에도 없다', (await catalogHas(uid)) === false);
    //  ★ 편입분은 **두 사람 몫 다** 남는다 — project_uid 는 FK 가 아니라 문자열 참조라 DB 가 지우지 않는다(§3.1).
    //    '지워야 할 것이 하나 있는데 하나만 남았다' 를 가리려면 수로 봐야 한다.
    okq(`C01 편입분 ${wantRefs}행이 그대로 남는다(문자열 참조 · FK 아님 · §3.1)`,
      n1(`SELECT COUNT(*) FROM cal_category WHERE project_uid=${esc(uid)}`, 'C01 삭제 뒤 편입분') === wantRefs,
      `실제 ${n1(`SELECT COUNT(*) FROM cal_category WHERE project_uid=${esc(uid)}`, 'C01 삭제 뒤 편입분(재)')}`);
    const c3 = await subCat(uid);
    okq('C01 내 편입분은 남고 dbGone 이 파생된다(라벨·일정 보존 · §3.1)', !!c3 && c3.dbGone === true, JSON.stringify(c3));
    const g2 = (await trashGet()).data;
    okq('C01 휴지통 「과제」 탭에서도 사라졌다', !trFind(g2, 'projects', uid));

    //  ⑧ 편입분 정리 — **내 것은 앱 경로**(구독 해제), 남의 것(SQL 로 심은 zzU)은 SQL 로.
    //     SQL 로 내 것을 지우면 앱 상태와 갈려 다음 저장이 되살린다(잔재의 씨앗). 반대로 남의 것은 앱 경로가 없다.
    if (u0) {
      sql(`DELETE FROM cal_category WHERE user_id=${u0};\n` +
        `DELETE FROM cal_user_pref WHERE user_id=${u0};\n` +
        `DELETE FROM cal_user_rev WHERE user_id=${u0};\n` +
        `DELETE FROM app_user WHERE user_id=${u0}`,
        { readOnly: false, idempotent: true, what: 'C01 두 번째 편입자 정리' });
      okq('C01 두 번째 편입자 정리(0행)',
        n1(`SELECT COUNT(*) FROM app_user WHERE user_id=${u0}`, 'C01 두 번째 편입자 확인') === 0);
    }
    await appUnsubscribe(uid);
    const gone = await waitSqlCount(`SELECT COUNT(*) FROM cal_category WHERE source='db' AND name=${esc(P1)}`, 0,
      { what: 'C01 편입분 정리' });
    okq('C01 편입분을 앱 경로로 정리했다(cal_category 0행)', gone, '구독 해제가 DB 에 반영되지 않았다');
  });

  /* ── C02 인력(기록 0) ────────────────────────────────────────────── */
  const U1 = NM.user(1);
  await runCase('C02', `인력 기록 0(${U1}) 등록·퇴사·삭제`, async () => {
    const uid = await makeUser(U1, { title: REAL.title });
    const off = await hsend({ cmd: 'setUserActive', userId: uid, active: false, includeInactive: false }, 'u');
    if (!okq('C02 퇴사 성공 회신', off.ok, off.msg)) return;

    const g = (await trashGet()).data;
    const row = trFind(g, 'users', uid);
    if (!okq('C02 휴지통 「인력」 탭에 보인다', !!row)) return;
    okq('C02 이름이 그대로다', row.name === U1, JSON.stringify(row.name));
    okq('C02 refs 0(기록이 없다)', Number(row.refs) === 0, `실제 ${row.refs}`);
    okq('C02 deletable:true', row.deletable === true, JSON.stringify(row));
    okq('C02 why 는 비어 있다', row.why === '', JSON.stringify(row.why));

    const rep = await hsend({ cmd: 'trashDelete', kind: 'user', key: String(uid), confirm: U1 }, 't', { expectPush: 'ta' });
    okq('C02 삭제 성공', rep.ok === true, rep.msg);
    okq('C02 성공 문구', rep.msg === MSG.done, JSON.stringify(rep.msg));
    okq('C02 app_user 0행', n1(`SELECT COUNT(*) FROM app_user WHERE user_id=${uid}`, 'C02 잔여') === 0);
    okq('C02 cal_user_pref 0행(부속 표를 같은 트랜잭션에서 지웠다 · §3.1)',
      n1(`SELECT COUNT(*) FROM cal_user_pref WHERE user_id=${uid}`, 'C02 pref') === 0);
    okq('C02 cal_user_rev 0행', n1(`SELECT COUNT(*) FROM cal_user_rev WHERE user_id=${uid}`, 'C02 rev') === 0);
  });

  /* ── C03 인력(기록 2) ────────────────────────────────────────────── */
  const U2 = NM.user(2);
  await runCase('C03', `인력 기록 있음(${U2}) — 거부되고 퇴사 상태로 남는다`, async () => {
    const uid = await makeUser(U2, { title: REAL.title });
    //  기록을 심는다 — 개인 과제 1 + 일정 1 = §3.2 의 9표 합계 2건.
    //  ★ 앱이 만든 것이 아니라 SQL 로 심는 이유: 이 계정은 **한 번도 로그인하지 않는다**(넷커스 자격이 없다).
    //    앱 경로로는 남의 계정에 기록을 만들 길이 없으므로, 여기서만 정본 스키마를 직접 따른다.
    //  ★ 개인 과제(source='local', project_uid NULL)로 두는 이유: 공식 과제였다면
    //    chk_cal_category_projuid 가 uid·project_uid 짝을 강제한다(§5.2). 이 케이스가 보려는 것은
    //    '기록 수' 하나뿐이라 가장 단순한 쪽을 고른다.
    //  ★ 고정 키(cat_no=1 · entry_no=1)로 넣고 앞에서 지운다 — 재적용이 같은 결과라 idempotent 자격이 있다.
    sql(
      `DELETE FROM cal_entry WHERE user_id=${uid};\n` +
      `DELETE FROM cal_category WHERE user_id=${uid};\n` +
      `INSERT INTO cal_category (user_id,cat_no,uid,source,name,color,description,project_uid,uses_repo,sort_order,created_at,updated_at) ` +
      `VALUES (${uid},1,${esc('c-zz' + OPT.seed + '-cat00000001')},'local',${esc('zz기록과제')},'#5b6b7d','',NULL,0,10,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));\n` +
      `INSERT INTO cal_entry (user_id,entry_no,uid,cat_no,entry_date,all_day,title,source,location,sort_order,created_at,updated_at) ` +
      `VALUES (${uid},1,${esc('e-zz' + OPT.seed + '-ent00000001')},1,'2026-09-10',0,${esc('zz기록일정')},'','',10,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      { readOnly: false, idempotent: true, what: 'C03 기록 심기' });
    const seeded = n1(`SELECT (SELECT COUNT(*) FROM cal_category WHERE user_id=${uid}) + (SELECT COUNT(*) FROM cal_entry WHERE user_id=${uid})`, 'C03 기록 수');
    if (!okq('C03 기록 2건을 심었다(과제 1 + 일정 1)', seeded === 2, `실제 ${seeded}`)) return;
    const want = MSG.records(seeded);

    const off = await hsend({ cmd: 'setUserActive', userId: uid, active: false, includeInactive: false }, 'u');
    if (!okq('C03 퇴사 성공 회신', off.ok, off.msg)) return;

    const g = (await trashGet()).data;
    const row = trFind(g, 'users', uid);
    if (!okq('C03 휴지통 「인력」 탭에 보인다', !!row)) return;
    okq('C03 refs = 기록 수(2)', Number(row.refs) === seeded, `실제 ${row.refs}`);
    okq('C03 deletable:false', row.deletable === false, JSON.stringify(row.deletable));
    okq('C03 why 가 §4.3 문장 그대로', row.why === want, `기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(row.why)}`);

    //  화면: 버튼이 꺼지고 사유가 title 로 붙는다(§5.1 — 눌러 봐야 거부되는 버튼은 이유를 알려 주지 않는다).
    await openTrash({ tab: 'user' });
    const btn = await trRow(uid);
    okq('C03 화면의 [영구 삭제]가 꺼져 있다', !!btn.del && btn.del.disabled === true, JSON.stringify(btn.del));
    okq('C03 꺼진 버튼의 title 이 사유(why)와 같다', !!btn.del && btn.del.title === want, JSON.stringify(btn.del && btn.del.title));
    okq('C03 [복구]는 살아 있다(되돌리기는 막지 않는다)', !!btn.restore && btn.restore.disabled === false, JSON.stringify(btn.restore));
    const clicked = await uiTrashClick('delete', uid);
    okq('C03 화면으로는 삭제를 시작할 수 없다', clicked === 'disabled', clicked);

    //  호스트: 화면을 우회해도 같은 문장으로 거부한다(판정은 트랜잭션 안이다 · §4.2).
    const rep = await hsend({ cmd: 'trashDelete', kind: 'user', key: String(uid), confirm: U2 }, 't');
    okq('C03 호스트도 거부한다', rep.ok === false, `ok=${rep.ok}`);
    okq('C03 거부 문구가 화면 힌트와 글자까지 같다', rep.msg === want, `기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(rep.msg)}`);
    okq('C03 행은 남고 is_active=0', n1(`SELECT COUNT(*) FROM app_user WHERE user_id=${uid} AND is_active=0`, 'C03 잔존') === 1);

    //  정리 — FK 순서: 일정 → 과제 → 부속 2표 → 사람.
    sql(`DELETE FROM cal_entry WHERE user_id=${uid};\n` +
        `DELETE FROM cal_category WHERE user_id=${uid};\n` +
        `DELETE FROM cal_user_pref WHERE user_id=${uid};\n` +
        `DELETE FROM cal_user_rev WHERE user_id=${uid};\n` +
        `DELETE FROM app_user WHERE user_id=${uid}`,
      { readOnly: false, idempotent: true, what: 'C03 정리' });
    okq('C03 정리 완료(zz 인력 0행)', n1(`SELECT COUNT(*) FROM app_user WHERE user_id=${uid}`, 'C03 정리 확인') === 0);
  });

  /* ── C04 코드 3종 ─────────────────────────────────────────────────── */
  const CU = NM.cust(), SE = NM.sec(), STT = NM.stat(), P2 = NM.proj(2);
  await runCase('C04', '발주처·구분·상태 — 쓰는 과제가 있으면 거부, 없으면 삭제', async () => {
    const a1 = await hreq('addCustomer', { name: CU });
    if (!okq('C04 발주처 추가', !!(a1 && a1.ok), JSON.stringify(a1))) return;
    const a2 = await hreq('codeAdd', { kind: 'section', name: SE });
    if (!okq('C04 구분 추가', !!(a2 && a2.ok), JSON.stringify(a2))) return;
    const a3 = await hreq('codeAdd', { kind: 'status', name: STT });
    if (!okq('C04 상태 추가', !!(a3 && a3.ok), JSON.stringify(a3))) return;

    const uid = await makeProject(P2, { section: SE, customer: CU, status: STT });
    const hide = await hsend({ cmd: 'setProjectActive', uid, active: false }, 'p', { expectPush: 'pa' });
    if (!okq('C04 그 과제를 숨겼다(숨긴 과제도 FK 로 붙든다)', hide.ok, hide.msg)) return;

    for (const [kind, name, label] of [['customer', CU, '발주처'], ['section', SE, '구분'], ['status', STT, '상태']]) {
      const r = kind === 'customer'
        ? await hreq('setCustomerActive', { name, active: false })
        : await hreq('codeSetActive', { kind, name, active: false });
      okq(`C04 ${label} 숨김`, !!(r && r.ok), JSON.stringify(r));
    }

    //  ① 쓰는 과제가 1건(숨긴 과제 포함) → 셋 다 지울 수 없다.
    let g = (await trashGet()).data;
    const want1 = MSG.inUse(1);
    for (const [key, name, label] of [['customers', CU, '발주처'], ['sections', SE, '구분'], ['statuses', STT, '상태']]) {
      const row = trFind(g, key, name);
      if (!okq(`C04 휴지통 「${label}」 탭에 보인다`, !!row)) continue;
      okq(`C04 ${label} refs 1`, Number(row.refs) === 1, `실제 ${row.refs}`);
      okq(`C04 ${label} deletable:false`, row.deletable === false, JSON.stringify(row.deletable));
      okq(`C04 ${label} why 가 §4.3 문장 그대로`, row.why === want1, `기대 ${JSON.stringify(want1)} / 실제 ${JSON.stringify(row.why)}`);
    }
    {
      const rep = await hsend({ cmd: 'trashDelete', kind: 'customer', key: CU, confirm: CU }, 't');
      okq('C04 발주처 삭제는 거부된다(화면 우회)', rep.ok === false, `ok=${rep.ok}`);
      okq('C04 거부 문구 일치', rep.msg === want1, `기대 ${JSON.stringify(want1)} / 실제 ${JSON.stringify(rep.msg)}`);
      okq('C04 발주처 행은 그대로', n1(`SELECT COUNT(*) FROM customer WHERE name=${esc(CU)}`, 'C04 발주처 잔존') === 1);
    }

    //  ② 그 과제를 휴지통에서 지우면 셋 다 지울 수 있게 된다.
    {
      const rep = await hsend({ cmd: 'trashDelete', kind: 'project', key: uid, confirm: P2 }, 't', { expectPush: 'ta' });
      if (!okq('C04 그 과제를 휴지통에서 삭제', rep.ok === true, rep.msg)) return;
      okq('C04 과제 0행', projRows(uid) === 0);
    }
    g = (await trashGet()).data;
    for (const [key, name, label] of [['customers', CU, '발주처'], ['sections', SE, '구분'], ['statuses', STT, '상태']]) {
      const row = trFind(g, key, name);
      okq(`C04 ${label} 가 이제 deletable:true`, !!row && row.deletable === true && Number(row.refs) === 0, JSON.stringify(row));
    }

    //  ③ 복구 한 번 — 코드 2종의 복구는 sort_order 를 맨 뒤(MAX+10)로 새로 준다(§4.1 ★).
    //     옛 순번을 들고 돌아오면 활성끼리 겹쳐 드롭다운 순서가 콜레이션에 좌우된다(실측된 결함).
    {
      const maxBefore = n1(`SELECT COALESCE(MAX(sort_order),0) FROM section_code`, 'C04 구분 최대 순번');
      const rep = await hsend({ cmd: 'trashRestore', kind: 'section', key: SE }, 't', { expectPush: 'ta' });
      if (okq('C04 구분 복구 성공', rep.ok === true, rep.msg)) {
        const now = sql(`SELECT CAST(is_active AS CHAR), CAST(sort_order AS CHAR) FROM section_code WHERE name=${esc(SE)}`, { what: 'C04 복구 확인' })[0] || [];
        okq('C04 복구된 구분이 활성이다', now[0] === '1', String(now[0]));
        okq(`C04 복구된 구분의 sort_order = MAX+10 (${maxBefore}+10)`, Number(now[1]) === maxBefore + 10, `실제 ${now[1]}`);
      }
      const r2 = await hreq('codeSetActive', { kind: 'section', name: SE, active: false });
      okq('C04 다시 숨김(삭제 전제는 숨김이다)', !!(r2 && r2.ok), JSON.stringify(r2));
    }

    //  ④ 셋을 이름 대조로 지운다(오타 한 번씩 먼저).
    for (const [kind, name, table, label] of [
      ['customer', CU, 'customer', '발주처'],
      ['section', SE, 'section_code', '구분'],
      ['status', STT, 'status_code', '상태'],
    ]) {
      const bad = await hsend({ cmd: 'trashDelete', kind, key: name, confirm: name + 'X' }, 't');
      okq(`C04 ${label} 이름 오타는 거부`, bad.ok === false && bad.msg === MSG.name, JSON.stringify(bad));
      const rep = await hsend({ cmd: 'trashDelete', kind, key: name, confirm: name }, 't', { expectPush: 'ta' });
      okq(`C04 ${label} 삭제 성공`, rep.ok === true, rep.msg);
      okq(`C04 ${label} 0행`, n1(`SELECT COUNT(*) FROM ${table} WHERE name=${esc(name)}`, `C04 ${label} 잔여`) === 0);
    }
  });

  /* ── C05 활성 항목 거부 ──────────────────────────────────────────── */
  const P3 = NM.proj(3);
  await runCase('C05', '활성 항목은 지울 수 없다(화면 우회)', async () => {
    const uid = await makeProject(P3, REAL);
    okq('C05 활성 상태로 서 있다', projActive(uid) === 1, `is_active=${projActive(uid)}`);
    const g = (await trashGet()).data;
    okq('C05 활성이라 휴지통에는 보이지 않는다', !trFind(g, 'projects', uid));
    const rep = await hsend({ cmd: 'trashDelete', kind: 'project', key: uid, confirm: P3 }, 't');
    okq('C05 거부됐다', rep.ok === false, `ok=${rep.ok}`);
    okq('C05 거부 문구가 §4.3 그대로', rep.msg === MSG.active, JSON.stringify(rep.msg));
    okq('C05 DB 행 그대로', projRows(uid) === 1, `행 ${projRows(uid)}`);

    //  정리 — 두 단계(숨김 → 삭제)를 그대로 밟는다. 이 시험도 지름길을 쓰지 않는다.
    const hide = await hsend({ cmd: 'setProjectActive', uid, active: false }, 'p', { expectPush: 'pa' });
    if (!okq('C05 숨김', hide.ok, hide.msg)) return;
    const del = await hsend({ cmd: 'trashDelete', kind: 'project', key: uid, confirm: P3 }, 't', { expectPush: 'ta' });
    okq('C05 숨긴 뒤에는 지워진다', del.ok === true, del.msg);
    okq('C05 정리 완료(0행)', projRows(uid) === 0);
  });

  /* ── C06 알 수 없는 대상 / 이미 없는 항목 ───────────────────────── */
  await runCase('C06', '알 수 없는 대상 · 이미 없는 항목', async () => {
    const r1 = await hsend({ cmd: 'trashDelete', kind: 'bogus', key: 'x', confirm: 'x' }, 't');
    okq('C06 알 수 없는 종류는 거부', r1.ok === false, `ok=${r1.ok}`);
    okq('C06 문구 일치', r1.msg === MSG.kind, JSON.stringify(r1.msg));
    const ghost = '00000000-0000-0000-0000-000000000000';
    const r2 = await hsend({ cmd: 'trashDelete', kind: 'project', key: ghost, confirm: 'x' }, 't');
    okq('C06 없는 키는 거부', r2.ok === false, `ok=${r2.ok}`);
    okq('C06 문구 일치(목록 새로고침 안내)', r2.msg === MSG.gone, JSON.stringify(r2.msg));
    okq('C06 유령 uid 는 애초에 DB 에 없다', projRows(ghost) === 0);
  });

  /* ── C07 자기 계정 ────────────────────────────────────────────────── */
  await runCase('C07', '자기 계정은 지울 수 없다', async () => {
    const before = dbSnap(ME, 'C07 전');
    const rep = await hsend({ cmd: 'trashDelete', kind: 'user', key: String(before.meUid), confirm: before.meName }, 't');
    okq('C07 거부됐다', rep.ok === false, `ok=${rep.ok}`);
    //  ★★ 문장은 **하나로 정해져 있다.** 로그인 계정은 반드시 활성이고(비활성이면 애초에 관문을 못 지난다),
    //    §3.4 의 관문 순서는 ② 숨긴 항목만 → ③ 자기 계정이다. 그래서 여기서 나올 수 있는 문장은 ② 하나뿐이다.
    //    '둘 중 하나' 로 두면 관문 순서가 뒤바뀌어도 통과한다 — 그건 판정이 아니라 눈감기다(2026-09-10 검토).
    okq('C07 거부 문구는 「활성 항목」이다(§3.4 의 ②가 ③보다 앞이다)',
      rep.msg === MSG.active, JSON.stringify(rep.msg));
    note('C07 TrashSelfMsg(자기 계정)는 **실동작으로는 닿지 않는다** — 자기 계정은 퇴사 처리할 수 없어서' +
      '(USER-ADMIN §4.4-1) 휴지통에 자기 자신이 실릴 수 없고, 활성 관문(②)이 언제나 먼저 막는다. ' +
      '규칙은 퇴사 규칙과 한 벌이라 지우지 않고 **정적 계약**으로 남긴다 — TRASH-DELETE §11-22.');
    const after = dbSnap(ME, 'C07 확인');
    okq('C07 내 행은 손대지 않았다',
      after.meUid === before.meUid && after.meRole === before.meRole && after.meActive === before.meActive,
      `${after.meRole}/${after.meActive}`);
  });

  /* ── C09 이미 복구된 항목의 재복구 ───────────────────────────────── */
  //  ★ 두 관리자가 같은 항목을 동시에 복구하면 뒤에 온 쪽이 **이미 활성인 행**에 UPDATE 를 걸었고,
  //    구분·상태는 그 자리에서 sort_order 를 MAX+10 으로 다시 매겨 멀쩡히 쓰이던 값이 목록 맨 뒤로 튀었다.
  //    지금은 is_active 를 같은 트랜잭션에서 잠근 채 읽어 **낡은 목록**이라고 말한다(실패가 아니다).
  const P4 = NM.proj(4);
  await runCase('C09', `이미 복구된 항목(${P4}) — 재복구는 「목록이 낡았다」로 거부`, async () => {
    const uid = await makeProject(P4, REAL);
    const hide = await hsend({ cmd: 'setProjectActive', uid, active: false }, 'p', { expectPush: 'pa' });
    if (!okq('C09 숨김 성공', hide.ok, hide.msg)) return;
    okq('C09 DB is_active=0', projActive(uid) === 0, `is_active=${projActive(uid)}`);

    const r1 = await hsend({ cmd: 'trashRestore', kind: 'project', key: uid }, 't', { expectPush: 'ta' });
    if (!okq('C09 첫 복구 성공', r1.ok === true, r1.msg)) return;
    okq('C09 DB is_active=1 로 돌아왔다', projActive(uid) === 1, `is_active=${projActive(uid)}`);

    //  ★ 두 번째 복구 — 목록을 새로고침하지 않은 관리자가 같은 버튼을 다시 누른 모양이다.
    const r2 = await hsend({ cmd: 'trashRestore', kind: 'project', key: uid }, 't');
    okq('C09 두 번째 복구는 거부된다', r2.ok === false, `ok=${r2.ok}`);
    okq('C09 거부 문구가 §4.1 그대로(새로고침 안내)', r2.msg === MSG.already, JSON.stringify(r2.msg));
    okq('C09 DB 는 활성 그대로다(두 번 쓰지 않았다)', projActive(uid) === 1, `is_active=${projActive(uid)}`);
    okq('C09 휴지통에는 여전히 보이지 않는다(활성이므로)',
      !trFind((await trashGet()).data, 'projects', uid));

    //  정리 — 숨김 → 이름 대조 삭제. 이 시험도 지름길을 쓰지 않는다.
    const h2 = await hsend({ cmd: 'setProjectActive', uid, active: false }, 'p', { expectPush: 'pa' });
    if (!okq('C09 정리: 숨김', h2.ok, h2.msg)) return;
    const del = await hsend({ cmd: 'trashDelete', kind: 'project', key: uid, confirm: P4 }, 't', { expectPush: 'ta' });
    okq('C09 정리: 삭제', del.ok === true, del.msg);
    okq('C09 정리 완료(0행)', projRows(uid) === 0);
  });

  /* ── C10 confirmTyped 취소(실클릭) ───────────────────────────────── */
  //  ★ 취소는 '아무 일도 일어나지 않았다'가 계약이다. closeModal() 로 부르면 마크업의 [data-close] 배선이
  //    시험되지 않는다 — × 를 마크업에서 빼먹어도 통과한다. 그래서 **실제 버튼**을 누른다.
  const P5 = NM.proj(5);
  await runCase('C10', `확인창 취소(${P5}) — 호스트로 아무것도 나가지 않는다`, async () => {
    const uid = await makeProject(P5, REAL);
    const hide = await hsend({ cmd: 'setProjectActive', uid, active: false }, 'p', { expectPush: 'pa' });
    if (!okq('C10 숨김 성공', hide.ok, hide.msg)) return;
    await openTrash({ tab: 'project' });

    const b = await pstate();
    const c = await uiTrashClick('delete', uid);
    if (!okq('C10 [영구 삭제] 클릭 → 이름 입력창', c === 'clicked', c)) return;
    if (!okq('C10 confirmTyped 가 열렸다',
      !!(await waitPage((x) => x.ctOpen === true, { timeout: 8000 })))) return;

    const x = await ev(`(function(){var b=document.querySelector('#confirmTypedModal [data-close]'); if(!b) return false; b.click(); return true;})()`);
    if (!okq('C10 [data-close] 실클릭', x === true, '확인창에 닫기 손잡이가 없다')) return;
    if (!okq('C10 확인창이 닫혔다', !!(await waitPage((y) => y.ctOpen === false, { timeout: 8000 })))) return;

    await sleep(500);   // 늦게 새어 나오는 요청이 있으면 여기서 잡힌다
    const fin = await pstate();
    okq('C10 호스트 회신이 0건이다(=아무것도 보내지 않았다)', fin.t === b.t, `${b.t} → ${fin.t}`);
    okq('C10 휴지통은 열린 채 잠기지도 않았다', fin.trOpen === true &&
      (await ev(`String((document.getElementById('trashModal')||{dataset:{}}).dataset.busy||'')`)) === '');
    const btn = await trRow(uid);
    okq('C10 행이 그대로 서 있다([영구 삭제] 켜짐)', !!btn.del && btn.del.disabled === false, JSON.stringify(btn.del));
    okq('C10 DB 행 그대로', projRows(uid) === 1, `행 ${projRows(uid)}`);

    //  정리
    const del = await hsend({ cmd: 'trashDelete', kind: 'project', key: uid, confirm: P5 }, 't', { expectPush: 'ta' });
    okq('C10 정리: 삭제', del.ok === true, del.msg);
    okq('C10 정리 완료(0행)', projRows(uid) === 0);
  });

  /* ── C11 사유(why)를 보이는 줄로 낸다 ────────────────────────────── */
  //  ★ 예전에는 사유가 **꺼진 버튼의 title** 에만 있었다. 그런데 Chromium 은 disabled 컨트롤에 툴팁을
  //    띄우지 않는다 — 관리자는 '왜 안 눌리지'를 영영 알 수 없었다(2026-09-10). 지금은 행에 보이는 줄로 낸다.
  //    title 은 그대로 둔다(마우스가 아닌 경로 · 기존 시험의 손잡이) — 둘 다 있는지 함께 본다.
  const U4 = NM.user(4);
  await runCase('C11', `사유 가시화(${U4}) — .set-hint[data-trwhy] 로 보인다`, async () => {
    const uid = await makeUser(U4, { title: REAL.title });
    //  기록 1건이면 '기록 있음'이 성립한다(C03 과 같은 이유로 SQL 로 심는다 — 이 계정은 로그인하지 않는다).
    sql(`DELETE FROM cal_entry WHERE user_id=${uid};\n` +
      `DELETE FROM cal_category WHERE user_id=${uid};\n` +
      `INSERT INTO cal_category (user_id,cat_no,uid,source,name,color,description,project_uid,uses_repo,sort_order,created_at,updated_at) ` +
      `VALUES (${uid},1,${esc('c-zz' + OPT.seed + '-why00000001')},'local',${esc('zz사유과제')},'#5b6b7d','',NULL,0,10,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      { readOnly: false, idempotent: true, what: 'C11 기록 심기' });
    const seeded = n1(`SELECT COUNT(*) FROM cal_category WHERE user_id=${uid}`, 'C11 기록 수');
    if (!okq('C11 기록 1건을 심었다', seeded === 1, `실제 ${seeded}`)) return;
    const want = MSG.records(seeded);

    const off = await hsend({ cmd: 'setUserActive', userId: uid, active: false, includeInactive: false }, 'u');
    if (!okq('C11 퇴사 성공 회신', off.ok, off.msg)) return;
    const g = (await trashGet()).data;
    const row = trFind(g, 'users', uid);
    if (!okq('C11 휴지통 「인력」 탭에 보인다', !!row)) return;
    okq('C11 호스트 why 가 §4.3 문장 그대로', row.why === want, `기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(row.why)}`);

    await openTrash({ tab: 'user' });
    //  data-trwhy 값은 행의 key(=user_id)라 숫자다 — 셀렉터에 그대로 끼워도 이스케이프가 낄 자리가 없다.
    const why = await evj(`JSON.stringify((function(){
      var e = document.querySelector('#trList [data-trwhy="${uid}"]');
      return e ? { text: String(e.textContent||''), cls: String(e.className||''), tag: e.tagName } : null;
    })())`);
    okq('C11 사유가 보이는 줄로 그려졌다(.set-hint[data-trwhy])',
      !!why && /set-hint/.test(why.cls), JSON.stringify(why));
    okq('C11 그 줄의 글이 호스트 why 와 글자까지 같다',
      !!why && why.text === want, `기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(why && why.text)}`);
    const btn = await trRow(uid);
    okq('C11 [영구 삭제]는 꺼져 있다', !!btn.del && btn.del.disabled === true, JSON.stringify(btn.del));
    okq('C11 꺼진 버튼의 title 도 남아 있다(마우스 아닌 경로)',
      !!btn.del && btn.del.title === want, JSON.stringify(btn.del && btn.del.title));

    //  정리 — FK 순서: 과제 → 부속 2표 → 사람.
    sql(`DELETE FROM cal_category WHERE user_id=${uid};\n` +
      `DELETE FROM cal_user_pref WHERE user_id=${uid};\n` +
      `DELETE FROM cal_user_rev WHERE user_id=${uid};\n` +
      `DELETE FROM app_user WHERE user_id=${uid}`,
      { readOnly: false, idempotent: true, what: 'C11 정리' });
    okq('C11 정리 완료(0행)', n1(`SELECT COUNT(*) FROM app_user WHERE user_id=${uid}`, 'C11 정리 확인') === 0);
  });

  /* ── C12 쓰기 중 잠금 ─────────────────────────────────────────────── */
  //  ★ 예전에는 가드가 두 번째 클릭을 조용히 버리고 첫 요청도 아무 표시가 없어서, 관리자에게는
  //    [영구 삭제]가 먹지 않는 것처럼 보였다. 지금은 trSetSaving 이 행 버튼 전부 + 모달 busy 를 함께 건다.
  const P6 = NM.proj(6);
  await runCase('C12', `쓰기 중 잠금(${P6}) — 행 버튼 전부 꺼지고 모달이 busy 다`, async () => {
    const uid = await makeProject(P6, REAL);
    const hide = await hsend({ cmd: 'setProjectActive', uid, active: false }, 'p', { expectPush: 'pa' });
    if (!okq('C12 숨김 성공', hide.ok, hide.msg)) return;
    await openTrash({ tab: 'project' });

    const b = await pstate();
    const c = await uiTrashClick('restore', uid);
    if (!okq('C12 [복구] 클릭', c === 'clicked', c)) return;
    if (!okq('C12 confirmBox 가 열렸다', !!(await waitPage((s) => s.cfOpen === true, { timeout: 8000 })))) return;

    //  ★★ [확인]을 누른 **그 순간**을 본다. confirmBox 의 해소는 MutationObserver(마이크로태스크)라
    //    같은 평가식 안에서 한 틱만 양보하면 trSend 는 이미 돌아 있고, 호스트 회신은 WebView2 IPC 왕복이라
    //    아직 올 수 없다. 그래서 '보내는 중' 이라는 상태가 실재하는지를 이 한 번에 붙잡을 수 있다.
    const lock = await evj(`(async function(){
      var ok = document.getElementById('cfOk'); if(!ok) return JSON.stringify({ err: 'cfOk 없음' });
      ok.click();
      var t0 = Date.now();
      while (Date.now() - t0 < 500){
        await new Promise(function(r){ setTimeout(r, 0); });
        var ov = document.getElementById('trashModal');
        if (ov && ov.dataset.busy === '1'){
          var bs = document.querySelectorAll('#trList [data-top]'), on = 0;
          for (var i=0;i<bs.length;i++) if(!bs[i].disabled) on++;
          return JSON.stringify({ busy: String(ov.dataset.busy), n: bs.length, enabled: on });
        }
      }
      return JSON.stringify({ err: '500ms 안에 busy 가 켜지지 않았다' });
    })()`);
    okq('C12 보내는 동안 #trashModal 이 busy 다(닫기 차단)', lock.busy === '1', JSON.stringify(lock));
    okq('C12 보내는 동안 #trList 의 행 버튼이 하나도 켜져 있지 않다',
      lock.n > 0 && lock.enabled === 0, JSON.stringify(lock));

    const done = await waitPage((s) => s.t > b.t, { timeout: 20000 });
    if (!okq('C12 복구 회신 도착', !!done)) return;
    const rep = await evj(`JSON.stringify(__tr.t[__tr.t.length-1])`);
    if (!okq('C12 복구 성공', rep.ok === true, rep.msg)) return;
    await waitPage((s) => s.ta > b.ta, { timeout: 12000 });

    const after = await evj(`JSON.stringify((function(){
      var ov = document.getElementById('trashModal');
      var bs = document.querySelectorAll('#trList [data-top]'), on = 0;
      for (var i=0;i<bs.length;i++) if(!bs[i].disabled) on++;
      return { busy: String((ov && ov.dataset.busy) || ''), n: bs.length, enabled: on };
    })())`);
    okq('C12 회신 뒤 잠금이 풀린다(busy 없음)', after.busy === '', JSON.stringify(after));
    //  ★ 남은 행이 있으면 켜져 있어야 한다. 복구가 성공하면 그 행은 목록에서 빠지므로 0행일 수도 있다 —
    //    0행을 '전부 꺼짐'으로 읽으면 통과가 거짓말이 된다(그래서 수를 함께 본다).
    okq('C12 회신 뒤 행 버튼이 다시 켜진다(남은 행이 있으면)',
      after.n === 0 || after.enabled > 0, JSON.stringify(after));
    okq('C12 DB is_active=1', projActive(uid) === 1, `is_active=${projActive(uid)}`);

    //  정리
    const h2 = await hsend({ cmd: 'setProjectActive', uid, active: false }, 'p', { expectPush: 'pa' });
    if (!okq('C12 정리: 숨김', h2.ok, h2.msg)) return;
    const del = await hsend({ cmd: 'trashDelete', kind: 'project', key: uid, confirm: P6 }, 't', { expectPush: 'ta' });
    okq('C12 정리: 삭제', del.ok === true, del.msg);
    okq('C12 정리 완료(0행)', projRows(uid) === 0);
  });

  /* ── C08 비관리자 ─────────────────────────────────────────────────── */
  //  ★★ 이 케이스만 **로그인 계정의 권한을 실제로 내린다.** 복원 실패는 사람이 DB 로 가야 푸는 상태를
  //    남기므로, finally 에서 반드시 되돌리고 **읽어서 확인**한다(cleanupAll 이 한 겹 더 받친다).
  const U3 = NM.user(3);
  await runCase('C08', '비관리자 — 진입 버튼 부재 · admin:false · 삭제 거부', async () => {
    //  내려가는 동안 '활성 관리자 0' 이 되면 앱에서 되돌릴 길이 사라진다 — 대역 관리자를 먼저 세운다.
    let standIn = 0;
    try { standIn = await makeUser(U3, { title: REAL.title, role: 'admin' }); }
    catch (e) { skip('C08', `대역 관리자를 만들지 못했다(${e.message}) — 로그인 계정을 내릴 수 없다`); return; }
    const admins = n1(`SELECT COUNT(*) FROM app_user WHERE edit_role='admin' AND is_active=1`, 'C08 활성 admin 수');
    if (admins < 2) { skip('C08', `활성 admin 이 ${admins}명뿐이다 — 내리면 관리자가 0이 된다`); return; }

    let restored = false;
    try {
      sql(`UPDATE app_user SET edit_role='editor' WHERE login_id=${esc(ME)}`,
        { readOnly: false, idempotent: true, what: 'C08 권한 강등' });
      rebase('C08 이 로그인 계정을 editor 로 내렸다 — 시험이 일부러 낸 변경이라 눈감는 대신 기준을 옮긴다');

      //  ① 진입 버튼이 **DOM 에서 사라진다**(숨김이 아니라 부재 · §5.0).
      await ev(`(typeof closeModal==='function' && closeModal('#trashModal'), 1)`);
      await ev(`loadUserPerm()`);
      const gone = await waitPage((x) => x.usTrash === false, { timeout: 15000 });
      okq('C08 「휴지통」 버튼이 DOM 에서 사라졌다', !!gone, '#usTrash 가 남아 있다 — 권한이 내려갔는데 문이 그대로다');
      if (gone) okq('C08 「구성원 편집」 버튼도 함께 사라졌다(한 함수·한 판정 · §5.0)', gone.usAdmin === false, String(gone.usAdmin));

      //  ② 버튼이 없다고 경로가 없는 것은 아니다 — 함수를 직접 불러 본다.
      const g = (await trashGet()).data;
      okq('C08 trashGet 은 여전히 found:true 로 답한다(권한 없음은 고장이 아니다)', !!(g && g.found === true), JSON.stringify(g));
      okq('C08 admin:false', !!(g && g.admin === false), JSON.stringify(g && g.admin));
      const lists = ['projects', 'users', 'customers', 'sections', 'statuses'].filter((k) => g && k in g);
      okq('C08 목록을 하나도 싣지 않는다', lists.length === 0, '실린 목록: ' + lists.join(', '));
      //  ★ 이 경로는 **권한 부족**(RoleOnly)이라 msg 를 싣지 않는 것이 계약이다(§11-17).
      okq('C08 권한 부족에는 사유 문장을 싣지 않는다(화면이 자기 문장을 갖고 있다)',
        !(g && typeof g.msg === 'string' && g.msg.length > 0), JSON.stringify(g && g.msg));
      //  ★★ 미판정 하나를 적어 둔다(감추지 않는다): **비활성·미등록 계정**의 trashGet 은
      //    admin:false 와 함께 msg 를 싣는다(§11-17 의 나머지 절반). 그런데 그걸 실동작으로 보려면
      //    로그인 계정을 잠시 is_active=0 으로 내려야 하고, 그 순간 위젯은 자기 세션을 잃어
      //    되돌리는 일이 DB 의 몫이 된다(사람이 SQL 로 가야 푸는 상태 — 이 루프의 금기).
      //    그래서 여기서는 editor 경로(권한 부족)만 판정하고, 나머지 절반은 정적 계약으로 남긴다.
      note('C08 미판정: 비활성·미등록 계정의 trashGet(admin:false + msg 실림 · §11-17)은 이 루프가 보지 않는다 — ' +
        '실 로그인 계정을 비활성으로 내리는 순간 위젯이 세션을 잃고 복구가 DB 몫이 되기 때문이다.');

      //  ③ 화면도 컨트롤이 아니라 안내 한 줄이다.
      const s = await openTrash();
      okq('C08 휴지통은 열리되 __trAdmin=false', s.trAdmin === false, String(s.trAdmin));
      okq('C08 탭도 행도 만들어지지 않는다(부재 계약)', s.tabs === 0 && s.lines === 0, `tabs=${s.tabs} lines=${s.lines}`);

      //  ④ 관문 — 화면을 통째로 우회한 삭제도 거부된다.
      const rep = await hsend({ cmd: 'trashDelete', kind: 'user', key: String(standIn), confirm: U3 }, 't');
      okq('C08 삭제 거부', rep.ok === false, `ok=${rep.ok}`);
      okq('C08 거부 문구가 관문 문장(USER-LOGIN §3.3)', /관리자/.test(String(rep.msg)), JSON.stringify(rep.msg));
      okq('C08 대상 행은 그대로', n1(`SELECT COUNT(*) FROM app_user WHERE user_id=${standIn}`, 'C08 대역 잔존') === 1);
    } finally {
      //  ★ 어떤 경로로 빠져나가든 되돌린다. 그리고 되돌렸다고 **믿지 않고 읽는다**.
      try { restored = restoreMe(ME); } catch (e) { restored = false; note('C08 복원 중 예외: ' + e.message); }
      if (!restored) {
        console.error(`\n★★ [치명] ${ME} 의 관리자 권한을 되돌리지 못했다. 지금 바로 수동 복원하세요:`);
        console.error(`    UPDATE app_user SET edit_role='admin', is_active=1 WHERE login_id='${ME}';\n`);
        ok('C08 로그인 계정 admin 복원', false, '복원 실패 — 위 SQL 로 수동 복원 필요');
        summary();
        process.exit(1);
      }
      okq('C08 로그인 계정 admin 복원 확인(DB 재조회)', true);
      rebase('C08 복원 — 기준을 시작 상태로 되돌린다');
      //  화면도 관리자 상태로 되돌려 둔다(다음 사람이 위젯을 그대로 쓸 수 있게).
      try {
        await ev(`(typeof closeModal==='function' && closeModal('#trashModal'), 1)`);
        await ev(`loadUserPerm()`);
        await waitPage((x) => x.usTrash === true, { timeout: 15000 });
      } catch (_) { }
      //  대역 관리자 치우기 — 관리자로 돌아온 지금이라야 휴지통이 연다(퇴사 → 이름 대조 삭제).
      try {
        if (standIn) {
          const off = await hsend({ cmd: 'setUserActive', userId: standIn, active: false, includeInactive: false }, 'u');
          okq('C08 대역 관리자 퇴사', off.ok === true, off.msg);
          const del = await hsend({ cmd: 'trashDelete', kind: 'user', key: String(standIn), confirm: U3 }, 't', { expectPush: 'ta' });
          okq('C08 대역 관리자 삭제(기록 0)', del.ok === true, del.msg);
          okq('C08 대역 관리자 0행', n1(`SELECT COUNT(*) FROM app_user WHERE user_id=${standIn}`, 'C08 정리 확인') === 0);
        }
      } catch (e) { ok('C08 대역 관리자 정리', false, e.message); }
    }
  });

  /* ── 종료 정리 + 전량 대조 ──────────────────────────────────────── */
  log('── 정리 ──');
  try { await ev(`(typeof closeModal==='function' && (closeModal('#confirmTypedModal'), closeModal('#confirmModal'), closeModal('#trashModal')), 1)`); } catch (_) { }

  //  휴지통이 시작과 같은 모습인지 **정리 전에** 본다 — sweep 이 지우고 나면 무엇을 남겼는지 알 수 없다.
  try {
    const g = (await trashGet()).data;
    if (g && g.admin === true) {
      const zz = ['projects', 'users', 'customers', 'sections', 'statuses']
        .flatMap((k) => (g[k] || []).map((r) => String((r && r.name) || '')))
        .filter((n) => /^zz/.test(n));
      okq('정리 전: 휴지통에 zz 항목이 하나도 남지 않았다', zz.length === 0, zz.join(', '));
    }
  } catch (e) { note('종료 휴지통 확인 생략: ' + e.message); }

  cleanupAll('정상 종료');

  const end = dbSnap(ME, '종료 스냅샷');
  const left = zzLeft();
  okq('정리: zz 잔재 0', left === 0, `${left}건 남음`);
  okq(`정리: 다섯 표 실행 수가 시작과 같다(${countsKey(BASE.counts)})`,
    countsKey(end.counts) === countsKey(BASE.counts), `실제 ${countsKey(end.counts)}`);
  okq('정리: 실행 내용 해시가 시작과 같다', end.hash === BASE.hash,
    `${String(BASE.hash).slice(0, 12)} → ${String(end.hash).slice(0, 12)} — zz 아닌 행이 바뀐 채로 끝났다`);
  okq(`정리: ${ME} admin/활성 복원`, end.meRole === 'admin' && end.meActive === true, `${end.meRole}/${end.meActive}`);
  okq(`정리: schema_version ${BASE.schemaVersion} 불변`, end.schemaVersion === BASE.schemaVersion, `실제 ${end.schemaVersion}`);

  cdp.close();
}

/* ────────────────────────────── 8. 요약 ────────────────────────────── */

function summary() {
  const secs = (Date.now() - T0) / 1000;
  const line = '─'.repeat(74);
  console.log('\n' + line);
  console.log(`휴지통 루프 시험 요약 — 시드 ${OPT.seed} · 소요 ${secs.toFixed(1)}s` +
    (truncSeen ? ` · mysql 출력 소실 ${truncSeen}회(재시도로 회복)` : ''));
  console.log(line);
  if (FAILED.length) {
    console.log(`실패 ${FAILED.length}건:`);
    for (const f of FAILED.slice(0, 30)) console.log('  ✗ ' + f);
    if (FAILED.length > 30) console.log(`  … 외 ${FAILED.length - 30}건`);
  }
  if (SKIPPED.length) {
    console.log(`건너뜀 ${SKIPPED.length}건(판정 없음):`);
    for (const s of SKIPPED) console.log('  ↷ ' + s);
  }
  if (secs > OPT.budget) console.log(`★ 예산 ${OPT.budget}s 를 넘겼다(${secs.toFixed(1)}s) — 케이스별 시간을 보고 어디가 느린지 확인할 것`);
  console.log(`재현: node tests/loop-trash.mjs --seed=${OPT.seed} --port=${OPT.port}`);
  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  console.log(line);
}

try {
  await main();
  summary();
  process.exit(fail > 0 ? 1 : (SKIPPED.length ? 2 : 0));
} catch (e) {
  console.error('\n[중단] ' + (e && e.message ? e.message : e));
  if (OPT.verbose && e && e.stack) console.error(e.stack);
  cleanupAll('중단');
  summary();
  process.exit(fail > 0 ? 1 : 2);
}
