#!/usr/bin/env node
/* =====================================================================================
 * tests/loop-user-admin.mjs — 직원 관리(USER-ADMIN) 실동작 루프 시험
 *
 * ★ 이 파일은 `node tests/run-tests.mjs` 의 기본 스위트에 **포함되지 않는다**.
 *   러너는 `readdirSync(tests).filter(f => f.endsWith('.test.mjs'))` 로만 수집하므로
 *   확장자를 `.mjs`(≠ `.test.mjs`)로 둔 것만으로 자동수집에서 빠진다(러너 수정 없음).
 *   실 DB 와 실 위젯이 필요한 시험은 상시 게이트에 넣지 않는다 — 없는 실패를 만들지 않기 위해서다.
 *
 * 무엇을 하나:
 *   이미 떠 있는 위젯(TC_DEBUG_PORT=9222)에 CDP 로 붙어, **실제 화면의 함수·DOM 을 그대로 써서**
 *   직원 등록 → 수정 → 열람범위 → 권한 → 순서 → 퇴사 → 복구 → 잠금 방지 → 검증 → 비관리자 뷰까지
 *   한 라운드(C01~C16)를 왕복하고, **매 케이스 뒤에 MySQL 을 직접 읽어 불변식 다섯**을 본다.
 *
 *   ★★ 2026-09-10 사용자 결정으로 화면이 둘로 갈렸다:
 *     · 「구성원 보기」(#membersModal, openMembers) = **순수 보기**. 관리자에게도 편집 컨트롤이 없다.
 *     · 「구성원 편집」(#userAdminModal, openUserAdmin) = 관리자 전용 관리 화면. 조작은 전부 여기다.
 *     그래서 편집 케이스는 전부 openUserAdmin() 경로로 돌고(C16 이 보기 화면을 따로 본다),
 *     C13 은 「진입 버튼 부재 + 모달 진입 불가(컨트롤 0) + 관문 거부」 셋을 함께 본다.
 *
 *   ★ 2026-09-10(2차) 버튼 자리가 옮겨졌다: 행에는 [편집]뿐이고 퇴사·복구는 **편집 폼 하단 왼쪽**
 *     버튼(#userEdActive)이며, 「＋ 직원 등록」은 상단 막대가 아니라 하단(#uaFoot)의 주 버튼이다.
 *     C06·C07 은 쓰기 자체를 여전히 setUserActive 로 보내되(호스트 계약), 그 **앞에서** 폼을 열어
 *     버튼이 어떤 모습(퇴사 처리/복구 · danger 유무 · 대상 uid)으로 서는지를 함께 본다.
 *
 * 불변식(케이스마다):
 *   I1 활성 admin ≥ 1                       — 0 이 되는 순간 "앱에서만 관리한다"가 깨진다(DB 로 가야 푼다)
 *   I2 활성 사용자 중 sort_order NULL 은 **이번 라운드에서 새로 등록해 아직 순서 저장 전인 계정**뿐
 *   I3 app_user 총원 = 시작 총원 + 이번 라운드 zzU 수
 *   I4 zzU 외 행은 **기대값과 글자까지 같다**(login_id·name·title·org_id·view_scope·edit_role·is_active·sort_order)
 *      ★ '기대값' 은 시작 스냅샷에서 출발해, **정당한 변경을 낸 케이스가 스스로 갱신**한다
 *        (순서 저장은 전원을 다시 쓰고, C13 은 phmin 을 잠깐 editor 로 내린다).
 *        플래그로 검사를 끄지 않는 이유: 끄면 그 구간의 **다른** 변화도 함께 눈이 먼다.
 *   I5 schema_version 불변
 *   그리고 종료 뒤 **원본 스냅샷과 전량 대조**(sort_order 포함) — 이 시험은 데이터를 남기지 않는다.
 *
 * 전제(이 스크립트가 하지 않는 것):
 *   · 위젯을 띄우거나 닫지 않는다. 9222 에 이미 붙어 있어야 한다.
 *   · 로그인을 대신하지 않는다. **admin 계정으로 로그인된** 위젯이어야 한다(아니면 판정 없음 = exit 2).
 *   · 앱 코드를 고치지 않는다. 가로채기는 회신 두 개(__userSaved · __applyMembers)를 **감싸는** 것뿐이고
 *     원본을 반드시 그대로 호출한다 — 화면은 시험이 없을 때와 똑같이 움직인다.
 *
 * 실행:
 *   $env:TC_TEST_DB_ADMIN_PW='...'   (bash: export TC_TEST_DB_ADMIN_PW=...)
 *   node tests/loop-user-admin.mjs [--seed=N] [--port=9222] [--budget=60] [-v]
 *
 * 종료코드: 0 = 전부 통과 · 1 = 위반 있음 · 2 = 판정 없음(전제 미충족)
 * ===================================================================================== */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/* ────────────────────────────── 0. 인자·자격증명 ────────────────────────────── */

const ARG = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const OPT = {
  seed: Number(ARG.get('seed') || Date.now() % 100000),
  port: Number(ARG.get('port') || process.env.TC_DEBUG_PORT || 9222),
  budget: Number(ARG.get('budget') || 60),
  verbose: ARG.has('verbose') || ARG.has('v'),
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  db: process.env.TC_TEST_DB_NAME || 'taskmgr',
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',   // ← 비밀. 소스에 기본값 없음(이 파일은 커밋된다)
};
if (ARG.has('help') || ARG.has('h')) {
  console.log(`사용법: node tests/loop-user-admin.mjs [옵션]
  --seed=N      무작위 시드(기본: 시각). 같은 시드면 같은 이동 횟수·같은 zzU 이름
  --port=N      CDP 포트(기본 ${OPT.port})
  --budget=N    이 초를 넘기면 경고(기본 60)
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

/* 시드 고정 RNG — 실패 재현은 --seed 만 맞추면 된다 */
let _s = OPT.seed >>> 0;
const rnd = () => ((_s = (_s * 1664525 + 1013904223) >>> 0) / 4294967296);
const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

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
 *    그런데 문장 자체는 실행된다 — 그래서 "그냥 재시도" 하면 쓰기가 두 번 적용된다.
 *    재시도 자격은 **다시 적용해도 결과가 같은 문장인가** 로만 가른다:
 *      readOnly(기본)   — 읽기
 *      idempotent:true  — 범위 고정 DELETE · 절대값 UPDATE 처럼 증분이 아닌 쓰기
 *    이 파일의 쓰기는 셋뿐이고 전부 절대값/범위 고정이라 자격이 있다(sweep · phmin 복원 · sort_order 복원).
 *    INSERT·증분 UPDATE 는 이 파일에 없다 — 데이터를 만드는 일은 전부 **위젯**이 한다.              */
const EOF = '__TCEOF__';
let truncSeen = 0;
function sql(q, { readOnly = true, idempotent = false, what = 'SQL' } = {}) {
  const tries = (readOnly || idempotent) ? 3 : 1;
  for (let i = 1; i <= tries; i++) {
    const r = spawnSync(OPT.mysql,
      [`-u${OPT.adminUser}`, `-p${OPT.adminPw}`, '--default-character-set=utf8mb4', '-N', '-B',
       '--connect-timeout=5', '-D', OPT.db],
      { input: Buffer.from(q + `;\nSELECT '${EOF}';\n`, 'utf8'), maxBuffer: 64 << 20, windowsHide: true, timeout: 30000 });
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

/* ── 스냅샷 ────────────────────────────────────────────────────────────────
 *  ORDER BY 는 **앱의 「구성원 편집」 조회(flatOrder)와 글자까지 같다**(ProjectDb.LoadMembersJsonAsync · USER-ADMIN §5.3).
 *  2026-09-10 — 편집 화면은 팀과 무관한 전사 서열이라 소속을 첫 키로 두지 않는다(사용자 결정). 이 스냅샷은 #uaList 와 비교한다.
 *  다르면 '화면 순서 = DB 순서' 비교가 JS 콜레이션 차이로 가짜 실패를 낸다.                     */
const SNAP_SQL = `
SELECT 'U', u.user_id, u.login_id, u.name, IFNULL(u.title,''), IFNULL(CAST(u.org_id AS CHAR),''),
       IFNULL(o.name,''), u.view_scope, u.edit_role, CAST(u.is_active AS CHAR),
       IFNULL(CAST(u.sort_order AS CHAR),'~')     -- '~' = NULL. sort_order 는 숫자라 값과 겹칠 수 없다
  FROM app_user u LEFT JOIN org_unit o ON o.org_id = u.org_id
 ORDER BY u.sort_order IS NULL, u.sort_order, u.name;
SELECT 'V', v FROM cal_schema_meta WHERE k='schema_version'`;

const isTemp = (lid) => /^zzU/.test(lid || '');

function dbSnap(what = '스냅샷') {
  const rs = sql(SNAP_SQL, { what });
  const users = [];
  let schemaVersion = null;
  for (const c of rs) {
    if (c[0] === 'U') {
      users.push({
        uid: Number(c[1]), loginId: c[2], name: c[3], title: c[4],
        orgId: c[5] === '' ? null : Number(c[5]), org: c[6],
        viewScope: c[7], editRole: c[8], active: c[9] === '1',
        sort: c[10] === '~' ? null : Number(c[10]),
      });
    } else if (c[0] === 'V') schemaVersion = c[1];
  }
  return { users, schemaVersion, byId: new Map(users.map((u) => [u.uid, u])) };
}
/** I4 가 비교하는 8필드 — 이 목록이 곧 '무엇을 지키는가' 다. */
const identity = (u) => [u.loginId, u.name, u.title, u.orgId, u.viewScope, u.editRole, u.active, u.sort];
const idHash = (rows) => createHash('sha256')
  .update(JSON.stringify(rows.slice().sort((a, b) => a.uid - b.uid).map((u) => [u.uid, ...identity(u)])))
  .digest('hex').slice(0, 16);

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

/* ── 가로채기 설치 ─────────────────────────────────────────────────────────
 *  회신 둘(__userSaved · __applyMembers)을 **감싼다**. 원본을 반드시 호출하므로 화면 동작은 그대로다.
 *  ★ 페이지가 다시 뜨면 가로채기는 사라진다 — 그래서 **매 실행 시작에** 설치한다.
 *  ★ 이미 설치돼 있으면(같은 페이지에서 두 번째 실행) 감싸기를 겹치지 않고 계수기만 비운다.
 *    겹쳐 감으면 회신 하나가 두 번 세어져 C14(재진입 가드)가 조용히 거짓말을 한다.               */
const INSTALL_JS = `(function(){
  if (window.__ua && window.__ua.v === 1){ window.__ua.replies.length = 0; window.__ua.applies = 0; return 'reset'; }
  var oS = window.__userSaved, oA = window.__applyMembers;
  if (typeof oS !== 'function' || typeof oA !== 'function') return 'missing';
  var A = { v:1, replies: [], applies: 0 };
  window.__ua = A;
  window.__userSaved   = function(ok,msg){ A.replies.push({ ok: !!ok, msg: String(msg==null?'':msg) }); return oS.apply(this, arguments); };
  window.__applyMembers= function(json){ A.applies++; return oA.apply(this, arguments); };
  return 'installed';
})()`;

/** 페이지 상태 한 덩어리 — 폴링은 전부 이걸로 한다(왕복 수를 줄인다). */
const PSTATE = `JSON.stringify({
  r: __ua.replies.length, a: __ua.applies,
  saving: !!__uaSaving, busy: !!__uaBusy, admin: !!__uaAdmin, inact: !!__uaInactive, order: !!__uaOrder,
  n: __uaMembers.length,
  uaOpen: (function(){ var e=document.getElementById('userAdminModal'); return !!e && !e.classList.contains('hidden'); })(),
  lines: document.querySelectorAll('#uaList .mba-line').length,
  barBtns: document.querySelectorAll('#uaAdmin button').length,
  entryBtn: !!document.getElementById('usUserAdmin'),
  ueOpen: (function(){ var e=document.getElementById('userEditModal'); return !!e && !e.classList.contains('hidden'); })(),
  mbOpen: (function(){ var e=document.getElementById('membersModal'); return !!e && !e.classList.contains('hidden'); })(),
  mbBusy: !!__mbBusy, mbN: __mbMembers.length,
  mbLines: document.querySelectorAll('#mbList .mba-line').length,
  mbUops: document.querySelectorAll('#mbList [data-uop]').length,
  mbHasBar: !!document.getElementById('mbAdmin')
})`;
const pstate = () => evj(PSTATE);
/** 명부(호스트가 준 그대로 · 화면 필터 전) — 「구성원 편집」 화면의 상태다 */
const members = () => evj(`JSON.stringify(__uaMembers.map(function(m){return {uid:m.userId,loginId:m.loginId,name:m.name,title:m.title,org:m.orgUnit,orgId:m.orgId,scope:m.viewScope,role:m.editRole,active:m.isActive,sort:m.sortOrder};}))`);
/** 화면에 실제로 그려진 행 순서(「구성원 편집」의 .mba-line) */
const screenIds = () => evj(`JSON.stringify(Array.prototype.map.call(document.querySelectorAll('#uaList .mba-line'), function(l){ var b=l.querySelector('[data-uid]'); return b?Number(b.getAttribute('data-uid')):0; }))`);
/** 편집 폼 하단 왼쪽 버튼(#userEdActive) — 2026-09-10 퇴사·복구가 행에서 이 자리로 옮겨 왔다.
 *  ★ 행에 off/on 이 하나라도 남았는지 함께 센다: 같은 동작이 두 자리에 있으면 어느 쪽이 참인지 갈린다. */
const edActive = () => evj(`JSON.stringify({
  act: (function(){ var b=document.getElementById('userEdActive');
        return b ? { hidden: !!b.hidden, uop: String(b.dataset.uop||''), uid: String(b.dataset.uid||''),
                     text: String(b.textContent||''), danger: b.classList.contains('danger') } : null; })(),
  rowOff: document.querySelectorAll('#uaList [data-uop="off"],#uaList [data-uop="on"]').length
})`);

async function waitPage(pred, { timeout = 15000, interval = 80, desc = '' } = {}) {
  const t = Date.now();
  for (;;) {
    const s = await pstate();
    if (pred(s)) return s;
    if (Date.now() - t > timeout) return null;
    await sleep(interval);
  }
}

/** 호스트 쓰기 1건 — uaSend 로 보내고 __userSaved 회신을 기다린다.
 *  성공이면 호스트가 곧바로 명부를 다시 읽어 __applyMembers 로 민다(§4.2) — 그것까지 기다린다. */
async function send(payload, { expectApply = true, timeout = 15000 } = {}) {
  const idle = await waitPage((s) => !s.saving && !s.busy, { timeout: 14000, desc: 'idle' });
  if (!idle) throw new Error('직전 조작이 끝나지 않았다(__uaSaving/__uaBusy 가 안 내려간다)');
  const b = idle;
  await ev(`uaSend(${JSON.stringify(payload)})`);
  const s = await waitPage((x) => x.r > b.r, { timeout, desc: '회신' });
  if (!s) throw new Error(`호스트 회신이 오지 않았다: ${JSON.stringify(payload).slice(0, 160)}`);
  const rep = await evj(`JSON.stringify(__ua.replies[__ua.replies.length-1])`);
  if (rep.ok && expectApply) await waitPage((x) => x.a > b.a, { timeout: 10000, desc: '명부 재조회' });
  await waitPage((x) => !x.saving, { timeout: 8000 });
  vlog(`send ${payload.cmd} → ok=${rep.ok} "${rep.msg}"`);
  return rep;
}

/* ────────────────────────────── 4. 불변식 ────────────────────────────── */

let BASE = null;              // 시작 스냅샷(원본 · 끝에서 전량 대조한다)
let BASE_TOTAL = 0;
let SCHEMA_V = null;
/** 기대값 — zzU 가 아닌 행이 지금 어떤 모습이어야 하는가. 정당한 변경은 케이스가 스스로 갱신한다. */
let expect = new Map();       // uid → identity 배열
/** 새로 등록했지만 아직 순서 저장을 거치지 않은 zzU 들(I2 의 예외 집합) */
const pendingOrder = new Set();
const madeUids = new Set();   // 이번 라운드가 만든 zzU

function syncExpect(snap) {   // 정당한 변경 뒤 기대값 재기준(호출한 케이스가 이유를 로그로 남긴다)
  expect = new Map(snap.users.filter((u) => !isTemp(u.loginId)).map((u) => [u.uid, identity(u)]));
}

function invariants(caseId) {
  const snap = dbSnap(`불변식(${caseId})`);
  const temps = snap.users.filter((u) => isTemp(u.loginId));
  const fail0 = fail;

  // I1
  const admins = snap.users.filter((u) => u.editRole === 'admin' && u.active);
  ok(`${caseId} I1 활성 admin ≥ 1`, admins.length >= 1,
    '활성 관리자가 0명이다 — 앱에서 권한을 되돌릴 길이 사라졌다(DB 직접 조작 필요)');

  // I2
  const nulls = snap.users.filter((u) => u.active && u.sort === null);
  const bad2 = nulls.filter((u) => !pendingOrder.has(u.uid));
  ok(`${caseId} I2 활성 sort_order NULL 은 순서 저장 전 신규뿐`, bad2.length === 0,
    bad2.map((u) => `${u.loginId}(uid=${u.uid})`).join(', '));

  // I3
  ok(`${caseId} I3 총원 = ${BASE_TOTAL} + zzU ${temps.length}`, snap.users.length === BASE_TOTAL + temps.length,
    `실제 ${snap.users.length}`);

  // I4
  const real = snap.users.filter((u) => !isTemp(u.loginId));
  const diffs = [];
  for (const u of real) {
    const e = expect.get(u.uid);
    if (!e) { diffs.push(`새 행 uid=${u.uid}(${u.loginId})`); continue; }
    const a = identity(u);
    for (let i = 0; i < e.length; i++) {
      if (JSON.stringify(e[i]) !== JSON.stringify(a[i])) {
        diffs.push(`uid=${u.uid}(${u.loginId}) 필드${i}: ${JSON.stringify(e[i])} → ${JSON.stringify(a[i])}`);
        break;
      }
    }
  }
  if (real.length !== expect.size) diffs.push(`행 수 ${expect.size} → ${real.length}`);
  ok(`${caseId} I4 zzU 외 행 불변`, diffs.length === 0, diffs.slice(0, 5).join(' | '));

  // I5
  ok(`${caseId} I5 schema_version 불변(${SCHEMA_V})`, snap.schemaVersion === SCHEMA_V, `실제 ${snap.schemaVersion}`);

  //  다섯이 모두 통과했으면 한 줄로만 말한다 — 케이스마다 다섯 줄이면 진짜 실패가 묻힌다.
  if (fail === fail0) {
    console.log(el(), `  ✓ ${caseId} 불변식 I1~I5 ` +
      `(활성admin ${admins.length} · zzU ${temps.length} · 총원 ${snap.users.length} · v${snap.schemaVersion})`);
  }
  return snap;
}

/* ────────────────────────────── 5. 정리(시작·종료 양쪽) ────────────────────────────── */
/*  ★ 2026-09-07 잔재 사고의 교훈: 종료 정리만으로는 부족하다(강제 종료는 어떤 핸들러도 못 받는다).
 *    그래서 **다음 실행이 시작할 때 이전 잔재를 먼저 걷어낸다**. 둘을 합쳐야 닫힌다.
 *  ★ zzU 계정은 로그인한 적이 없어 cal_* 참조가 없다 — root DELETE 로 지워진다.
 *    혹시 참조가 생겼다면(1451) 조용히 남기지 않고 **보고**한다.                                  */
function sweepTemp(reason) {
  const rows = sql(`SELECT login_id FROM app_user WHERE login_id LIKE 'zzU%'`, { what: '잔재 조회' });
  if (!rows.length) return { deleted: 0, kept: [] };
  //  범위 고정 DELETE — 두 번째는 0행이라 재적용이 무동작이다(idempotent 자격).
  sql(`DELETE FROM app_user WHERE login_id LIKE 'zzU%'`, { readOnly: false, idempotent: true, what: '잔재 삭제' });
  const left = sql(`SELECT login_id FROM app_user WHERE login_id LIKE 'zzU%'`, { what: '잔재 재확인' }).map((r) => r[0]);
  console.error(`[cleanup] zzU 정리(${reason}): 삭제 ${rows.length - left.length}건` +
    (left.length ? ` · 남음 ${left.length}건: ${left.join(', ')} (cal_* 가 참조 중일 수 있다 — 수동 확인)` : ''));
  return { deleted: rows.length - left.length, kept: left };
}

/** phmin(로그인 계정)을 admin/활성으로 되돌린다 — C13 이 잠깐 내리기 때문이다. 절대값 UPDATE(idempotent). */
function restoreMe(loginId) {
  sql(`UPDATE app_user SET edit_role='admin', is_active=1 WHERE login_id=${esc(loginId)}`,
    { readOnly: false, idempotent: true, what: '로그인 계정 복원' });
  const r = sql(`SELECT edit_role, CAST(is_active AS CHAR) FROM app_user WHERE login_id=${esc(loginId)}`, { what: '복원 확인' });
  return r.length ? (r[0][0] === 'admin' && r[0][1] === '1') : false;
}

/** 순서 저장이 전원의 sort_order 를 다시 썼으므로 시작값으로 되돌린다. 절대값 CASE UPDATE(idempotent). */
function restoreSortOrder() {
  const real = BASE.users.filter((u) => !isTemp(u.loginId));
  if (!real.length) return;
  const cases = real.map((u) => `WHEN ${u.uid} THEN ${u.sort === null ? 'NULL' : u.sort}`).join(' ');
  sql(`UPDATE app_user SET sort_order = CASE user_id ${cases} ELSE sort_order END ` +
      `WHERE user_id IN (${real.map((u) => u.uid).join(',')})`,
    { readOnly: false, idempotent: true, what: 'sort_order 복원' });
}

let ME = 'phmin';
let cleaned = false;
function cleanupAll(reason) {
  if (cleaned) return;
  cleaned = true;
  try { sweepTemp(reason); } catch (e) { console.error('[cleanup] zzU 정리 실패: ' + e.message); }
  try {
    if (BASE) restoreSortOrder();
  } catch (e) { console.error('[cleanup] sort_order 복원 실패: ' + e.message); }
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

let tempSeq = 0;
const tmpId = () => `zzU${OPT.seed}_${++tempSeq}`;   // login_id 형식 ^[A-Za-z0-9._-]{1,50}$ 를 지킨다
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

/** 편집 폼을 거쳐 저장하기 — '실제 화면 경로'가 필요한 케이스용(등록·수정). */
async function formSave({ uid = 0, loginId, name, title, orgId, scope, role }) {
  await ev(`userEdOpen(${uid})`);
  await sleep(80);
  //  ★ 신규 등록에는 퇴사시킬 대상이 없다 — 폼 하단 왼쪽 버튼은 감춰져 있어야 한다(2026-09-10).
  if (uid === 0) {
    const p = await edActive();
    okq('신규 등록 폼에 [퇴사 처리]가 서지 않는다(대상 없음)', !!p.act && p.act.hidden === true, JSON.stringify(p.act));
  }
  const setv = async (sel, v) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.value=${JSON.stringify(String(v))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return e.value===${JSON.stringify(String(v))};})()`);
  //  ★ 서열 번호 칸(#userEdSort)은 **읽기전용**이고 명부가 준 값을 그대로 보여야 한다(2026-09-10).
  //    신규(uid 0)면 빈 칸(placeholder '미지정 — 명부 맨 뒤')이다. 여기서 보는 이유는, 폼을 여는 경로가 이 하나라서다.
  const so = await evj(`(function(){var e=document.getElementById('userEdSort');var m=${uid}?(__uaMembers||[]).find(function(x){return x&&Number(x.userId)===${uid};}):null;return JSON.stringify({v:e?String(e.value):null,ro:e?!!e.readOnly:false,exp:(m&&m.sortOrder!=null)?String(m.sortOrder):''});})()`);
  okq(`서열 번호 칸이 명부 값과 같다(uid=${uid})`, so.v === so.exp && so.ro === true, `보임=${JSON.stringify(so.v)} 기대=${JSON.stringify(so.exp)} readonly=${so.ro}`);
  if (loginId != null) await setv('#userEdLogin', loginId);
  await setv('#userEdName', name);
  await setv('#userEdTitle', title);
  await setv('#userEdOrg', orgId == null ? '' : String(orgId));
  //  ★ 열람 범위·편집 권한은 드롭다운이다(2026-09-10 · 라디오 3개 × 2묶음 → <select> 2칸).
  //    값이 안 붙으면 **크게 실패**시킨다: 옵션에 없는 값을 조용히 흘리면 '저장은 성공인데 권한은 딴 값'이 통과한다.
  const okScope = await setv('#userEdScope', scope);
  const okRole = await setv('#userEdRole', role);
  if (!okScope || !okRole) throw new Error(`권한 드롭다운에 값이 붙지 않았다(scope=${scope}:${okScope} role=${role}:${okRole}) — 옵션에 없는 값이다`);
  const b = await pstate();
  await ev(`userEdSaveNow()`);
  const s = await waitPage((x) => x.r > b.r, { timeout: 15000 });
  if (!s) throw new Error('편집 폼 저장의 회신이 오지 않았다');
  const rep = await evj(`JSON.stringify(__ua.replies[__ua.replies.length-1])`);
  if (rep.ok) await waitPage((x) => x.a > b.a, { timeout: 10000 });
  await waitPage((x) => !x.saving, { timeout: 8000 });
  return rep;
}

/** 「퇴사자 보기」 토글 — 관리자 막대의 실제 체크박스를 누른다(조회 조건이라 호스트 왕복이 있다). */
async function setInactiveView(on) {
  const s0 = await pstate();
  if (!!s0.inact === !!on) return s0;
  const r = await ev(`(function(){var c=document.getElementById('uaInactive'); if(!c) return false; c.click(); return true;})()`);
  if (!r) throw new Error('「퇴사자 보기」 체크박스가 없다');
  const s = await waitPage((x) => !x.busy && !!x.inact === !!on, { timeout: 12000 });
  if (!s) throw new Error(`「퇴사자 보기」 ${on ? '켜기' : '끄기'} 가 반영되지 않았다`);
  return s;
}

/* ────────────────────────────── 7. 본체 ────────────────────────────── */

async function main() {
  log(`직원 관리 루프 시험 — 시드 ${OPT.seed} · 포트 ${OPT.port} · DB ${OPT.db}`);

  /* ── 시작 정리 + 전제 확인 ─────────────────────────────────────────── */
  sweepTemp('시작');
  BASE = dbSnap('시작 스냅샷');
  BASE_TOTAL = BASE.users.length;
  SCHEMA_V = BASE.schemaVersion;
  const leftovers = BASE.users.filter((u) => isTemp(u.loginId));
  if (leftovers.length) {
    console.error(`[판정 없음] 시작 정리 뒤에도 zzU 잔재 ${leftovers.length}건이 남았다: ${leftovers.map((u) => u.loginId).join(', ')}`);
    process.exit(2);
  }
  syncExpect(BASE);
  log(`시작 스냅샷: app_user ${BASE_TOTAL}명 · schema_version=${SCHEMA_V} · 해시 ${idHash(BASE.users.filter((u) => !isTemp(u.loginId)))}`);
  if (BASE_TOTAL !== 89) note(`★ 총원이 89 가 아니다(${BASE_TOTAL}) — 이 시험은 '시작 총원 + zzU' 로 판정하므로 계속하되, 개발 DB 가 예상과 다르다는 뜻이다`);

  cdp = await Cdp.attach(OPT.port);
  const inst = await ev(INSTALL_JS);
  if (inst === 'missing') { console.error('[판정 없음] 페이지에 __userSaved/__applyMembers 가 없다 — 구버전 위젯이다'); process.exit(2); }
  vlog(`가로채기: ${inst}`);

  const who = await evj(`JSON.stringify({host: !!HOST, id: (currentUser&&currentUser.loginId)||''})`);
  if (!who.host || !who.id) { console.error('[판정 없음] 위젯이 로그인 상태가 아니다'); process.exit(2); }
  ME = who.id;
  const meRow = BASE.users.find((u) => u.loginId === ME);
  if (!meRow) { console.error(`[판정 없음] 로그인 계정(${ME})이 app_user 에 없다`); process.exit(2); }
  if (meRow.editRole !== 'admin' || !meRow.active) {
    console.error(`[판정 없음] 로그인 계정(${ME})이 활성 admin 이 아니다(${meRow.editRole}/${meRow.active ? '활성' : '비활성'}) — 직원 관리는 admin 으로만 판정된다`);
    process.exit(2);
  }
  log(`로그인 계정 ${ME}(uid=${meRow.uid}) · 활성 admin 확인`);

  /* 「구성원 편집」 열기 — 관리자 회신을 받아야 편집 컨트롤이 생긴다(진입 자체가 관리자 전용이다) */
  await ev(`openUserAdmin()`);
  let s = await waitPage((x) => x.uaOpen && !x.busy && x.n > 0, { timeout: 20000 });
  if (!s) { console.error('[판정 없음] 「구성원 편집」 화면을 열지 못했다'); process.exit(2); }
  if (!s.admin) { console.error('[판정 없음] 회신에 admin 이 없다 — 호스트가 이 계정을 관리자로 보지 않는다'); process.exit(2); }
  //  자리 계약(2026-09-10 2차) — 「＋ 직원 등록」은 하단(#uaFoot)의 주 버튼이고 상단 막대에는 없다.
  //  ★ 여기서 한 번 본다: 자리가 틀리면 아래 케이스들이 셀렉터 실패로 뭉개져 원인이 보이지 않는다.
  const foot0 = await evj(`JSON.stringify({ foot: !!document.querySelector('#uaFoot #uaNew'), bar: !!document.querySelector('#uaAdmin #uaNew') })`);
  okq('「＋ 직원 등록」이 하단(#uaFoot)에 있고 상단 막대에는 없다', foot0.foot === true && foot0.bar === false, JSON.stringify(foot0));
  const meta = await evj(`JSON.stringify({titles: __uaTitles.slice(), units: __uaUnits.filter(function(u){return u&&u.orgId!=null;}).map(function(u){return {orgId:u.orgId,name:u.name};})})`);
  if (meta.titles.length < 2 || meta.units.length < 2) {
    console.error('[판정 없음] 직급 또는 조직이 2개 미만이다 — 수정 케이스를 만들 수 없다');
    process.exit(2);
  }
  //  「구성원 편집」 진입 버튼은 「사용자 정보」의 권한 조회(loadUserPerm)가 만든다 —
  //  이 시험이 그 경로를 한 번 돌려 둔다. C13 이 '내려가면 사라진다'를 보려면 먼저 서 있어야 한다.
  await ev(`loadUserPerm()`);
  const entry0 = await waitPage((x) => x.entryBtn === true, { timeout: 15000 });
  if (!entry0) { console.error("[판정 없음] 관리자인데 「구성원 편집」 진입 버튼(#usUserAdmin)이 만들어지지 않았다"); process.exit(2); }
  log('진입 버튼 #usUserAdmin 확인(관리자 회신으로 생성됨)');

  const T1 = meta.titles[0], T2 = meta.titles[1];
  const O1 = meta.units[rint(0, meta.units.length - 1)];
  const O2 = meta.units.find((u) => u.orgId !== O1.orgId) || meta.units[0];
  log(`직급 ${meta.titles.length}종 · 조직 ${meta.units.length}개 · 명부 ${s.n}명 (T1=${T1} T2=${T2} O1=${O1.name} O2=${O2.name})`);

  const A = { lid: tmpId(), uid: 0 };   // C01 이 만드는 계정(소속 없음)
  const B = { lid: tmpId(), uid: 0 };   // C02 가 만드는 계정(소속 있음 · 나중에 admin 이 된다)

  /* ── C01 등록(최소: 직급만) ─────────────────────────────────────────── */
  await runCase('C01', '등록(최소 · 직급만)', async () => {
    const rep = await formSave({ uid: 0, loginId: A.lid, name: A.lid, title: T1, orgId: null, scope: 'self', role: 'viewer' });
    if (!okq('C01 등록 성공 회신', rep.ok, rep.msg)) return;
    const ms = await members();
    const row = ms.find((m) => m.loginId === A.lid);
    if (!okq('C01 명부에 나타남', !!row)) return;
    okq('C01 회신에 userId 부여', Number.isInteger(row.uid) && row.uid > 0, JSON.stringify(row.uid));
    A.uid = row.uid;
    madeUids.add(A.uid); pendingOrder.add(A.uid);
    const db = dbSnap('C01 확인').byId.get(A.uid);
    okq('C01 DB sort_order NULL(=맨 뒤)', !!db && db.sort === null, db ? String(db.sort) : '행 없음');
    okq('C01 소속 없음(org_id NULL)', !!db && db.orgId === null, db ? String(db.orgId) : '');
    //  '맨 뒤' = 전사 서열의 맨 뒤(편집 화면 ORDER BY 는 순번(NULL 은 뒤) → 이름 — 2026-09-10). 같은 소속 안에서도 당연히 마지막이다.
    const sameOrg = ms.filter((m) => String(m.org || '') === String(row.org || ''));
    okq('C01 같은 소속 안에서 맨 뒤', sameOrg[sameOrg.length - 1].uid === A.uid,
      sameOrg.slice(-3).map((m) => m.loginId).join(' → '));
  });

  /* ── C02 등록(직급·소속·unit_tree·editor) ───────────────────────────── */
  await runCase('C02', '등록(직급·소속·unit_tree·editor)', async () => {
    const rep = await formSave({ uid: 0, loginId: B.lid, name: B.lid, title: T2, orgId: O1.orgId, scope: 'unit_tree', role: 'editor' });
    if (!okq('C02 등록 성공 회신', rep.ok, rep.msg)) return;
    const ms = await members();
    const row = ms.find((m) => m.loginId === B.lid);
    if (!okq('C02 명부에 나타남', !!row)) return;
    B.uid = row.uid;
    madeUids.add(B.uid); pendingOrder.add(B.uid);
    const db = dbSnap('C02 확인').byId.get(B.uid);
    okq('C02 DB 값 일치(title·org_id·view_scope·edit_role)',
      !!db && db.title === T2 && db.orgId === O1.orgId && db.viewScope === 'unit_tree' && db.editRole === 'editor',
      db ? `${db.title}/${db.orgId}/${db.viewScope}/${db.editRole}` : '행 없음');
    okq('C02 신규도 sort_order NULL', !!db && db.sort === null, db ? String(db.sort) : '');
  });

  if (!A.uid || !B.uid) {
    console.error('[판정 없음] 시험 계정 두 개를 만들지 못했다 — 이후 케이스를 판정할 수 없다');
    cleanupAll('등록 실패');
    summary();
    process.exit(2);
  }

  /* ── C03 수정: 이름·직급·소속 ───────────────────────────────────────── */
  await runCase('C03', '수정(이름·직급·소속)', async () => {
    const nm = B.lid + '_r';
    const rep = await formSave({ uid: B.uid, name: nm, title: T1, orgId: O2.orgId, scope: 'unit_tree', role: 'editor' });
    if (!okq('C03 수정 성공 회신', rep.ok, rep.msg)) return;
    const db = dbSnap('C03 확인').byId.get(B.uid);
    okq('C03 DB 반영(name·title·org_id)', !!db && db.name === nm && db.title === T1 && db.orgId === O2.orgId,
      db ? `${db.name}/${db.title}/${db.orgId}` : '행 없음');
    okq('C03 login_id 는 바뀌지 않는다(넷커스 소유 · §6)', !!db && db.loginId === B.lid, db ? db.loginId : '');
    const row = (await members()).find((m) => m.uid === B.uid);
    okq('C03 명부 반영', !!row && row.name === nm && row.title === T1 && row.orgId === O2.orgId,
      row ? `${row.name}/${row.title}/${row.orgId}` : '명부에 없음');
    B.name = nm;
  });

  /* ── C04 열람 범위 self → all → unit_tree ───────────────────────────── */
  await runCase('C04', '열람 범위 self → all → unit_tree', async () => {
    for (const sc of ['self', 'all', 'unit_tree']) {
      const rep = await send({ cmd: 'saveUser', userId: B.uid, loginId: B.lid, name: B.name, title: T1, orgId: O2.orgId, viewScope: sc, editRole: 'editor' });
      if (!okq(`C04 view_scope=${sc} 저장`, rep.ok, rep.msg)) return;
      const db = dbSnap(`C04 ${sc}`).byId.get(B.uid);
      okq(`C04 DB view_scope=${sc}`, !!db && db.viewScope === sc, db ? db.viewScope : '행 없음');
    }
  });

  /* ── C05 편집 권한 viewer → editor → admin (대상은 zzU · 본인 아님) ──── */
  await runCase('C05', '편집 권한 viewer → editor → admin', async () => {
    for (const role of ['viewer', 'editor', 'admin']) {
      const rep = await send({ cmd: 'saveUser', userId: B.uid, loginId: B.lid, name: B.name, title: T1, orgId: O2.orgId, viewScope: 'unit_tree', editRole: role });
      if (!okq(`C05 edit_role=${role} 저장`, rep.ok, rep.msg)) return;
      const db = dbSnap(`C05 ${role}`).byId.get(B.uid);
      okq(`C05 DB edit_role=${role}`, !!db && db.editRole === role, db ? db.editRole : '행 없음');
    }
    const n = Number(sql(`SELECT COUNT(*) FROM app_user WHERE edit_role='admin' AND is_active=1`, { what: 'C05 admin 수' })[0][0]);
    okq('C05 활성 admin 이 2 로 늘었다', n === 2, `실제 ${n}`);
  });

  /* ── C08 순서 편집: [위로]/[아래로] → 순서 저장 ──────────────────────── */
  //  ★ 여기서 하는 이유: 두 zzU 가 모두 서 있는 가장 이른 시점이고, 뒤의 퇴사(C06)가
  //    §7-1a 의 사각지대(C15)를 만들려면 **그 전에 한 번은 전량 재작성이 있어야** 하기 때문이다.
  await runCase('C08', '순서 편집(위로/아래로) → 순서 저장', async () => {
    const t = await ev(`(function(){var b=document.getElementById('uaOrderEdit'); if(!b) return false; b.click(); return true;})()`);
    if (!okq('C08 「순서 편집」 켜기', !!t)) return;
    const s1 = await waitPage((x) => x.order === true, { timeout: 8000 });
    if (!okq('C08 순서 편집 모드 진입', !!s1)) return;
    const before = await screenIds();
    okq('C08 순서 편집 중에는 전 명부가 보인다(검색·조직 잠금 · §11-8)', before.length === s1.n, `화면 ${before.length} / 명부 ${s1.n}`);

    const down = rint(1, 3), up = rint(1, 3);
    const moved = await evj(`JSON.stringify({
      down: (function(){var n=0;for(var i=0;i<${down};i++){var b=document.querySelector('#uaList [data-uop="down"][data-uid="${A.uid}"]');if(!b||b.disabled)break;b.click();n++;}return n;})(),
      up:   (function(){var n=0;for(var i=0;i<${up};i++){var b=document.querySelector('#uaList [data-uop="up"][data-uid="${B.uid}"]');if(!b||b.disabled)break;b.click();n++;}return n;})()
    })`);
    note(`[아래로] ${moved.down}회(uid=${A.uid}) · [위로] ${moved.up}회(uid=${B.uid})`);
    const after = await screenIds();
    okq('C08 화면 순서가 실제로 바뀌었다', JSON.stringify(before) !== JSON.stringify(after),
      '▲▼ 를 눌렀는데 순서가 그대로다 — 이 케이스는 아무것도 증명하지 못한다');

    const b0 = await pstate();
    await ev(`(function(){var b=document.getElementById('uaOrderSave'); if(b) b.click(); return 1;})()`);
    const sv = await waitPage((x) => x.r > b0.r, { timeout: 15000 });
    if (!okq('C08 「순서 저장」 회신', !!sv)) return;
    const rep = await evj(`JSON.stringify(__ua.replies[__ua.replies.length-1])`);
    if (!okq('C08 순서 저장 성공', rep.ok, rep.msg)) return;
    await waitPage((x) => x.a > b0.a, { timeout: 10000 });
    await waitPage((x) => !x.saving && !x.order, { timeout: 8000 });

    const snap = dbSnap('C08 확인');
    const act = snap.users.filter((u) => u.active).slice().sort((x, y) => (x.sort ?? 1e9) - (y.sort ?? 1e9));
    okq('C08 DB sort_order 순서 = 저장 직전 화면 순서', JSON.stringify(act.map((u) => u.uid)) === JSON.stringify(after),
      `db ${act.slice(0, 6).map((u) => u.uid).join(',')} / 화면 ${after.slice(0, 6).join(',')}`);
    okq('C08 10 간격 전량 재작성', act.every((u, i) => u.sort === (i + 1) * 10),
      act.slice(0, 6).map((u) => u.sort).join(','));
    const nullN = snap.users.filter((u) => u.active && u.sort === null).length;
    okq('C08 활성 전원 sort_order NULL 0', nullN === 0, `실제 ${nullN}`);

    //  전량 재작성은 **정당한 변경**이다 — 기대값을 여기서 다시 기준 잡는다(끝에서 원본으로 되돌린다).
    pendingOrder.clear();
    syncExpect(snap);
    note('I4 기대값 재기준: 순서 저장이 전원의 sort_order 를 다시 썼다(종료 시 원본 복원 후 전량 대조)');
  });

  /* ── C06 퇴사 ───────────────────────────────────────────────────────── */
  await runCase('C06', '퇴사(대상: admin 인 zzU)', async () => {
    //  ★ 화면 경로 먼저 본다(2026-09-10): 행에는 [편집]뿐이고, 퇴사는 폼을 연 뒤 하단 왼쪽 버튼이다.
    //    쓰기 자체는 아래 send 가 호스트 계약으로 판정한다 — 여기서 보는 것은 '버튼이 어디에 어떤 모습으로 서는가'다.
    await ev(`userEdOpen(${B.uid})`);
    await sleep(80);
    {
      const s0 = await pstate();
      const p = await edActive();
      okq('C06 편집 폼이 열렸다', s0.ueOpen === true);
      okq('C06 폼 하단에 [퇴사 처리]가 선다(danger · uop=off · 대상 uid)',
        !!p.act && p.act.hidden === false && p.act.uop === 'off' && p.act.uid === String(B.uid)
          && p.act.text === '퇴사 처리' && p.act.danger === true, JSON.stringify(p.act));
      okq('C06 행에는 퇴사·복구 버튼이 없다(자리는 하나여야 한다)', p.rowOff === 0, `실제 ${p.rowOff}개`);
    }
    await ev(`closeModal('#userEditModal')`);
    await sleep(80);
    const rep = await send({ cmd: 'setUserActive', userId: B.uid, active: false });
    if (!okq('C06 퇴사 성공 회신', rep.ok, rep.msg)) return;
    const ms = await members();
    okq('C06 기본 명부에서 사라짐', !ms.some((m) => m.uid === B.uid));
    const db = dbSnap('C06 확인').byId.get(B.uid);
    okq('C06 행은 남고 is_active=0(§3.3)', !!db && db.active === false, db ? String(db.active) : '행이 사라졌다');
    const n = Number(sql(`SELECT COUNT(*) FROM app_user WHERE edit_role='admin' AND is_active=1`, { what: 'C06 admin 수' })[0][0]);
    okq('C06 활성 admin 다시 1', n === 1, `실제 ${n}`);
    await setInactiveView(true);
    const ms2 = await members();
    okq('C06 「퇴사자 보기」 재조회에서 보임', ms2.some((m) => m.uid === B.uid));
    //  기대값 갱신은 없다 — B 는 zzU 라 I4 대상이 아니다.
  });

  /* ── C15 (선택) §7-1a 사각지대 — 현상 재현만, 실패로 두지 않는다 ─────── */
  await runCase('C15', '(선택) 순서 저장 시 퇴사자 순번 사각지대 §7-1a', async () => {
    const beforeRow = dbSnap('C15 전').byId.get(B.uid);
    await setInactiveView(false);   // 퇴사자를 감춘 채 저장하는 것이 바로 그 구멍의 조건이다
    await ev(`(function(){var b=document.getElementById('uaOrderEdit'); if(b) b.click(); return 1;})()`);
    await waitPage((x) => x.order === true, { timeout: 8000 });
    const b0 = await pstate();
    await ev(`(function(){var b=document.getElementById('uaOrderSave'); if(b) b.click(); return 1;})()`);
    const sv = await waitPage((x) => x.r > b0.r, { timeout: 15000 });
    if (!sv) { note('C15: 순서 저장 회신이 없어 재현하지 못했다(보고만)'); return; }
    const rep = await evj(`JSON.stringify(__ua.replies[__ua.replies.length-1])`);
    await waitPage((x) => !x.saving && !x.order, { timeout: 10000 });
    const snap = dbSnap('C15 확인');
    const after = snap.byId.get(B.uid);
    const actives = snap.users.filter((u) => u.active && u.sort !== null).map((u) => u.sort);
    const collide = after && after.sort !== null && actives.includes(after.sort);
    note(`C15 재현: 저장 ok=${rep.ok} · 퇴사자 sort_order ${beforeRow ? beforeRow.sort : '?'} → ${after ? after.sort : '?'} ` +
      `(활성 범위 ${Math.min(...actives)}~${Math.max(...actives)})`);
    note(`C15 결과: 퇴사자 순번이 ${collide ? '활성자와 **충돌한다**' : '우연히 겹치지 않았다'} — ` +
      `§7-1a 의 알려진 구멍이다(복구하면 옛 숫자가 새 서열 사이에 끼어든다). **보고만 하고 실패로 두지 않는다.**`);
    pendingOrder.clear();
    syncExpect(snap);
  });

  /* ── C07 복구 ───────────────────────────────────────────────────────── */
  await runCase('C07', '복구', async () => {
    await setInactiveView(true);
    //  ★ 같은 버튼이 퇴사자에게는 [복구]로 선다 — danger 를 벗는다(되돌리기는 파괴적이지 않다).
    await ev(`userEdOpen(${B.uid})`);
    await sleep(80);
    {
      const p = await edActive();
      okq('C07 폼 하단이 [복구]로 바뀐다(uop=on · danger 없음)',
        !!p.act && p.act.hidden === false && p.act.uop === 'on' && p.act.uid === String(B.uid)
          && p.act.text === '복구' && p.act.danger === false, JSON.stringify(p.act));
      okq('C07 행에는 여전히 퇴사·복구 버튼이 없다', p.rowOff === 0, `실제 ${p.rowOff}개`);
    }
    await ev(`closeModal('#userEditModal')`);
    await sleep(80);
    const rep = await send({ cmd: 'setUserActive', userId: B.uid, active: true });
    if (!okq('C07 복구 성공 회신', rep.ok, rep.msg)) return;
    const db = dbSnap('C07 확인').byId.get(B.uid);
    okq('C07 DB is_active=1', !!db && db.active === true, db ? String(db.active) : '행 없음');
    const ms = await members();
    okq('C07 명부 복귀', ms.some((m) => m.uid === B.uid));
    await setInactiveView(false);
    const ms2 = await members();
    okq('C07 「퇴사자 보기」를 꺼도 보인다(다시 활성이므로)', ms2.some((m) => m.uid === B.uid));
  });

  /* ── C09 잠금 방지① 자기 퇴사 ───────────────────────────────────────── */
  await runCase('C09', '잠금 방지① 자기 계정 퇴사 거부', async () => {
    const rep = await send({ cmd: 'setUserActive', userId: meRow.uid, active: false }, { expectApply: false });
    okq('C09 거부됐다', rep.ok === false, `ok=${rep.ok}`);
    okq('C09 거부 문구가 §4.4-1 그대로', rep.msg === '자기 계정은 퇴사 처리할 수 없습니다.', JSON.stringify(rep.msg));
    const db = dbSnap('C09 확인').byId.get(meRow.uid);
    okq('C09 DB 불변(본인 활성 유지)', !!db && db.active === true && db.editRole === 'admin',
      db ? `${db.editRole}/${db.active}` : '행 없음');
  });

  /* ── C10 잠금 방지② 자기 권한 변경 ──────────────────────────────────── */
  await runCase('C10', '잠금 방지② 자기 권한 변경 거부(admin→editor)', async () => {
    const me = dbSnap('C10 전').byId.get(meRow.uid);
    const rep = await send({
      cmd: 'saveUser', userId: meRow.uid, loginId: me.loginId, name: me.name, title: me.title,
      orgId: me.orgId, viewScope: me.viewScope, editRole: 'editor',
    }, { expectApply: false });
    okq('C10 거부됐다', rep.ok === false, `ok=${rep.ok}`);
    okq('C10 거부 문구가 §4.4-2 그대로',
      rep.msg === '자기 권한은 바꿀 수 없습니다. 다른 관리자가 바꿔야 합니다.', JSON.stringify(rep.msg));
    const db = dbSnap('C10 확인').byId.get(meRow.uid);
    okq('C10 DB 불변(edit_role=admin)', !!db && db.editRole === 'admin', db ? db.editRole : '행 없음');
  });

  /* ── C11 검증 5종 ───────────────────────────────────────────────────── */
  await runCase('C11', '입력 검증 5종(§4.3)', async () => {
    const base = { cmd: 'saveUser', userId: 0, name: 'zz검증', title: T1, orgId: O1.orgId, viewScope: 'self', editRole: 'viewer' };
    const cases = [
      ['잘못된 ID', { ...base, loginId: 'zz U@x' }, '로그인 ID 는 영문·숫자·._- 만 쓸 수 있습니다.'],
      ['중복 ID(대소문자 무시)', { ...base, loginId: ME.toUpperCase() }, '이미 등록된 ID 입니다.'],
      ['빈 이름', { ...base, loginId: tmpId(), name: '' }, '이름을 입력하세요.'],
      ['미등록 직급', { ...base, loginId: tmpId(), title: 'zz없는직급' }, '등록되지 않은 직급입니다.'],
      ['도메인 밖 viewScope', { ...base, loginId: tmpId(), viewScope: 'galaxy' }, '열람 범위 값이 올바르지 않습니다.'],
    ];
    const before = dbSnap('C11 전');
    for (const [label, payload, want] of cases) {
      const rep = await send(payload, { expectApply: false });
      okq(`C11 ${label} 거부`, rep.ok === false, `ok=${rep.ok} msg=${JSON.stringify(rep.msg)}`);
      okq(`C11 ${label} 문구 일치`, rep.msg === want, `기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(rep.msg)}`);
    }
    const after = dbSnap('C11 확인');
    okq('C11 다섯 번 모두 DB 불변(행이 늘지 않았다)', after.users.length === before.users.length,
      `${before.users.length} → ${after.users.length}`);
    okq('C11 다섯 번 모두 DB 불변(내용 해시 동일)', idHash(after.users) === idHash(before.users));
  });

  /* ── C12 정수 null 내성(2026-09-10 회귀) ─────────────────────────────── */
  //  ★ 어제 고친 결함: GetInt 가 ValueKind 를 보지 않아 null 에서 예외가 났고, 바깥 catch 가
  //    메시지를 통째로 삼켜 **회신도 로그도 없이** 화면이 '저장 중'으로 굳었다.
  //    그래서 이 케이스의 판정은 값이 아니라 **회신이 오는가** 다.
  const C = { lid: tmpId(), uid: 0 };
  await runCase('C12', '정수 null 내성(orgId:null · userId:null → 회신이 온다)', async () => {
    const rep = await send({
      cmd: 'saveUser', userId: null, loginId: C.lid, name: C.lid, title: T1,
      orgId: null, viewScope: 'self', editRole: 'viewer',
    });
    okq('C12 회신이 왔다(굳지 않았다)', rep && typeof rep.ok === 'boolean', JSON.stringify(rep));
    okq('C12 저장 성공(null = 없음으로 읽힌다)', rep.ok === true, rep.msg);
    const db = dbSnap('C12 확인').users.find((u) => u.loginId === C.lid);
    if (okq('C12 DB 에 신규 행이 생겼다', !!db)) {
      C.uid = db.uid; madeUids.add(C.uid); pendingOrder.add(C.uid);
      okq('C12 org_id 가 NULL(0 이 아니다)', db.orgId === null, String(db.orgId));
    }
  });

  /* ── C14 재진입 가드 ────────────────────────────────────────────────── */
  await runCase('C14', '재진입 가드(uaSend 연타 → 한 번만 반영)', async () => {
    const idle = await waitPage((x) => !x.saving && !x.busy, { timeout: 12000 });
    if (!okq('C14 시작 시 유휴', !!idle)) return;
    const n1 = A.lid + '_x1', n2 = A.lid + '_x2';
    const mk = (nm) => ({ cmd: 'saveUser', userId: A.uid, loginId: A.lid, name: nm, title: T1, orgId: null, viewScope: 'self', editRole: 'viewer' });
    //  같은 평가 안에서 연달아 두 번 — 두 번째는 __uaSaving 으로 막혀야 한다.
    await ev(`(uaSend(${JSON.stringify(mk(n1))}), uaSend(${JSON.stringify(mk(n2))}), 1)`);
    const s = await waitPage((x) => x.r > idle.r, { timeout: 15000 });
    if (!okq('C14 회신 도착', !!s)) return;
    await waitPage((x) => x.a > idle.a, { timeout: 10000 });
    await waitPage((x) => !x.saving, { timeout: 8000 });
    await sleep(1200);   // 두 번째가 늦게 새어 나오는지 본다(늦은 회신이 있으면 여기서 잡힌다)
    const fin = await pstate();
    okq('C14 회신은 정확히 1건', fin.r - idle.r === 1, `실제 ${fin.r - idle.r}건`);
    const db = dbSnap('C14 확인').byId.get(A.uid);
    okq('C14 DB 에는 첫 번째만 반영', !!db && db.name === n1, db ? db.name : '행 없음');
    okq('C14 두 번째(막힌 쪽)는 반영되지 않았다', !!db && db.name !== n2, db ? db.name : '');
  });

  /* ── C13 비관리자 뷰 ────────────────────────────────────────────────── */
  //  ★★ 이 케이스만 **로그인 계정의 권한을 실제로 내린다.** 복원 실패는 사람이 DB 로 가야 푸는
  //    상태를 남기므로(판번호 사고와 같은 규율), finally 에서 반드시 되돌리고 **읽어서 확인**한다.
  await runCase('C13', '비관리자 뷰(진입 버튼 부재 + 편집 화면 진입 불가 + 관문 거부)', async () => {
    const admins = Number(sql(`SELECT COUNT(*) FROM app_user WHERE edit_role='admin' AND is_active=1`, { what: 'C13 전 admin 수' })[0][0]);
    if (admins < 2) {
      skip('C13', `활성 admin 이 ${admins}명뿐이라 ${ME} 를 내리면 관리자가 0이 된다 — 앞 케이스(C05/C07)가 깨졌다는 뜻`);
      return;
    }
    let restored = false;
    try {
      sql(`UPDATE app_user SET edit_role='editor' WHERE login_id=${esc(ME)}`,
        { readOnly: false, idempotent: true, what: 'C13 권한 강등' });
      //  I4 기대값도 함께 내린다 — 이건 **시험이 일부러 낸 변경**이라 불변식이 눈감을 자리가 아니다.
      const e = expect.get(meRow.uid); if (e) e[5] = 'editor';

      //  ① 진입 버튼이 **DOM 에서 사라진다**(숨김이 아니라 부재). 권한 회신을 다시 받게 한다.
      await ev(`(typeof closeModal === 'function' && closeModal('#userAdminModal'), 1)`);
      await ev(`loadUserPerm()`);
      const gone = await waitPage((x) => x.entryBtn === false, { timeout: 15000 });
      okq('C13 「구성원 편집」 진입 버튼이 DOM 에서 사라졌다(숨김 아님)', !!gone,
        gone ? '' : '#usUserAdmin 이 남아 있다 — 관리자에서 내려갔는데 문이 그대로다');

      //  ② 그래도 함수를 직접 불러 본다(버튼이 없다고 경로가 없는 것은 아니다).
      //     호스트가 admin:false 로 답하므로 컨트롤이 하나도 만들어지지 않아야 한다.
      await ev(`openUserAdmin()`);
      const s2 = await waitPage((x) => x.uaOpen && !x.busy, { timeout: 20000 });
      if (!okq('C13 비관리자로 「구성원 편집」 화면이 열림(진입 시도는 된다)', !!s2)) return;
      okq('C13 __uaAdmin = false', s2.admin === false, String(s2.admin));
      okq('C13 편집 화면에 컨트롤 DOM 부재(.mba-line 0 · §5)', s2.lines === 0, `실제 ${s2.lines}`);
      okq('C13 관리자 막대도 비어 있다(#uaAdmin button 0)', s2.barBtns === 0, `실제 ${s2.barBtns}`);
      //  ③ 편집 폼에도 닿을 수 없다 — userEdOpen 이 __uaAdmin 을 먼저 본다.
      await ev(`userEdOpen(${A.uid})`);
      await sleep(200);
      const s3 = await pstate();
      okq('C13 편집 폼에 닿을 수 없다(#userEditModal 안 열림)', s3.ueOpen === false, String(s3.ueOpen));

      const rep = await send({
        cmd: 'saveUser', userId: A.uid, loginId: A.lid, name: A.lid + '_nope', title: T1,
        orgId: null, viewScope: 'self', editRole: 'viewer',
      }, { expectApply: false });
      okq('C13 쓰기 거부', rep.ok === false, `ok=${rep.ok}`);
      okq('C13 거부 문구가 관문 문장 그대로',
        rep.msg === '직원 정보는 관리자만 고칠 수 있습니다.', JSON.stringify(rep.msg));
      const db = dbSnap('C13 확인').byId.get(A.uid);
      okq('C13 DB 불변(이름이 바뀌지 않았다)', !!db && db.name !== A.lid + '_nope', db ? db.name : '행 없음');
    } finally {
      //  ★ 어떤 경로로 빠져나가든 되돌린다. 그리고 되돌렸다고 **믿지 않고 읽는다**.
      try { restored = restoreMe(ME); } catch (e) { restored = false; note('C13 복원 중 예외: ' + e.message); }
      const e = expect.get(meRow.uid); if (e) { e[5] = 'admin'; e[6] = true; }
      if (!restored) {
        console.error(`\n★★ [치명] ${ME} 의 관리자 권한을 되돌리지 못했다. 지금 바로 수동 복원하세요:`);
        console.error(`    UPDATE app_user SET edit_role='admin', is_active=1 WHERE login_id='${ME}';\n`);
        ok('C13 로그인 계정 admin 복원', false, '복원 실패 — 위 SQL 로 수동 복원 필요');
        summary();
        process.exit(1);
      }
      okq('C13 로그인 계정 admin 복원 확인(DB 재조회)', true);
      //  화면도 관리자 상태로 되돌려 둔다(다음 사람이 위젯을 그대로 쓸 수 있게).
      //  ★ 진입 버튼도 함께 되살린다 — loadUserPerm 이 다시 admin 을 읽어야 버튼이 돌아온다.
      try {
        await ev(`loadUserPerm()`);
        await ev(`openUserAdmin()`);
        await waitPage((x) => x.uaOpen && !x.busy && x.admin === true && x.entryBtn === true, { timeout: 15000 });
      } catch (_) { }
    }
  });

  /* ── C16 「구성원 보기」는 관리자에게도 순수 보기다(2026-09-10 결정) ──── */
  //  ★ 여기가 이 판의 핵심 계약이다. 관리자로 로그인한 채 보기 화면을 열어 **컨트롤이 0** 인지 본다.
  //    앞의 계약들은 "비관리자에게 없다"였지만, 이제는 "관리자에게도 없다"가 판정 기준이다.
  await runCase('C16', '「구성원 보기」는 관리자에게도 편집 컨트롤이 0', async () => {
    await ev(`(typeof closeModal === 'function' && closeModal('#userAdminModal'), 1)`);
    await ev(`openMembers()`);
    const sv = await waitPage((x) => x.mbOpen && !x.mbBusy && x.mbN > 0, { timeout: 20000 });
    if (!okq('C16 구성원 보기 열림', !!sv)) return;
    okq('C16 명부가 실제로 그려졌다(전제)', sv.mbN > 0, `명부 ${sv.mbN}명`);
    okq('C16 보기 화면에 .mba-line 0(편집 행 구조 없음)', sv.mbLines === 0, `실제 ${sv.mbLines}`);
    okq('C16 보기 화면에 data-uop 버튼 0(편집·퇴사·▲▼ 없음)', sv.mbUops === 0, `실제 ${sv.mbUops}`);
    okq('C16 옛 관리자 막대 자리(#mbAdmin) 자체가 없다', sv.mbHasBar === false, String(sv.mbHasBar));
    //  ★ 그런데 관리자 상태는 여전히 참이다 — 즉 "권한이 없어서 안 보이는 것"이 아니라
    //    "보기 화면에는 원래 없는 것"임을 같은 순간에 확인한다.
    const admin = await evj(`JSON.stringify({ ua: !!__uaAdmin })`);
    okq('C16 같은 순간에 관리자 상태는 참이다(권한 때문이 아니다)', admin.ua === true, String(admin.ua));
    await ev(`(typeof closeModal === 'function' && closeModal('#membersModal'), 1)`);
  });

  /* ── 종료 정리 + 전량 대조 ──────────────────────────────────────────── */
  log('── 정리 ──');
  cleanupAll('정상 종료');
  const end = dbSnap('종료 스냅샷');
  const leftU = end.users.filter((u) => isTemp(u.loginId));
  okq('정리: zzU 잔재 0', leftU.length === 0, leftU.map((u) => u.loginId).join(', '));
  okq(`정리: app_user 총원 ${BASE_TOTAL} 복귀`, end.users.length === BASE_TOTAL, `실제 ${end.users.length}`);
  const meEnd = end.users.find((u) => u.loginId === ME);
  okq(`정리: ${ME} admin/활성 복원`, !!meEnd && meEnd.editRole === 'admin' && meEnd.active === true,
    meEnd ? `${meEnd.editRole}/${meEnd.active}` : '행 없음');
  okq(`정리: schema_version ${SCHEMA_V} 불변`, end.schemaVersion === SCHEMA_V, `실제 ${end.schemaVersion}`);
  //  ★ 마지막 관문 — sort_order 까지 포함해 **시작 스냅샷과 전량 대조**. 이 시험은 데이터를 남기지 않는다.
  const h0 = idHash(BASE.users.filter((u) => !isTemp(u.loginId)));
  const h1 = idHash(end.users.filter((u) => !isTemp(u.loginId)));
  if (!okq('정리: 실 직원 89행이 시작과 글자까지 같다(sort_order 포함)', h0 === h1, `${h0} → ${h1}`)) {
    const b = new Map(BASE.users.map((u) => [u.uid, identity(u)]));
    const d = end.users.filter((u) => !isTemp(u.loginId))
      .filter((u) => JSON.stringify(b.get(u.uid)) !== JSON.stringify(identity(u)))
      .slice(0, 6).map((u) => `uid=${u.uid}(${u.loginId}) ${JSON.stringify(b.get(u.uid))} → ${JSON.stringify(identity(u))}`);
    for (const line of d) console.log('        ' + line);
  }

  try { await ev(`(typeof closeModal==='function' && (closeModal('#membersModal'), closeModal('#userAdminModal')), 1)`); } catch (_) { }
  cdp.close();
}

/* ────────────────────────────── 8. 요약 ────────────────────────────── */

function summary() {
  const secs = (Date.now() - T0) / 1000;
  const line = '─'.repeat(74);
  console.log('\n' + line);
  console.log(`직원 관리 루프 시험 요약 — 시드 ${OPT.seed} · 소요 ${secs.toFixed(1)}s` +
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
