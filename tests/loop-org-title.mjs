#!/usr/bin/env node
/* =====================================================================================
 * tests/loop-org-title.mjs — 「직급·소속 관리」 실동작 루프 시험 · docs/ORG-TITLE-ADMIN.md §7
 *
 * ★ 이 파일은 `node tests/run-tests.mjs` 의 기본 스위트에 **포함되지 않는다**.
 *   러너는 `*.test.mjs` 만 모으므로 확장자를 `.mjs` 로 둔 것만으로 자동수집에서 빠진다.
 *   실 DB·실 위젯이 필요한 시험을 상시 게이트에 넣지 않는 이유는 늘 같다 — 없는 실패를 만들지 않기 위해서다.
 *
 * 무엇을 하나:
 *   이미 떠 있는 위젯(TC_DEBUG_PORT=9222, **admin 로그인**)에 CDP 로 붙어, 직급(title_code)과
 *   조직(org_unit) 마스터를 시험 접두(zzJ·zzO)로 만들고 → 개명하고 → 순서를 바꾸고 → 숨김 거부를 받고 →
 *   숨기고 → 복구하고 → 상위를 옮기고 → 순환을 시도해 거부를 받고 → 지운다.
 *   화면 경로(#uaOrgTitle 실클릭 · otSend)와 호스트 계약(hostRequest 직접 전송)을 **둘 다** 지난다 —
 *   화면이 먼저 막아 주는 것과 호스트가 막는 것은 다른 사실이고, 설계 §4.1 이 "힌트와 판정이 갈리면
 *   판정이 이긴다" 를 못 박았기 때문이다.
 *
 * 케이스(각 케이스 끝에 불변식):
 *   C00 진입 — 「구성원 편집」 → #uaOrgTitle 존재 → 실클릭 → orgTitleGet 이 admin:true · 직급 ≥ 11 ·
 *              조직이 깊이우선(부모가 자식보다 먼저 · depth 가 부모+1)
 *   C01 직급 추가(zzJ)     — 행이 생기고 DB sort_order = 직전 MAX+10
 *   C02 직급 개명(zzJ→zzJ2)— DB 이름이 바뀐다(app_user.title 은 FK CASCADE 라 따라온다)
 *   C03 직급 순서(zzJ2 ▲)  — 두 값의 sort_order 가 맞바뀌고 나머지도 10 간격으로 다시 매겨진다
 *   C04 직급 숨김 거부     — zzU 직원을 잠시 zzJ2 로 둔다 → '재직자' 문장으로 거부 → 직원 직급 복구 →
 *                            숨김 성공 → 복구 성공(복구 뒤 sort_order = MAX+10)
 *   C05 조직 추가(zzO)     — 상위 필수(0 이면 거부) · 형제 MAX+10
 *   C06 조직 개명          — 이름만 바뀌고 parent_id·소속자는 그대로
 *   C07 조직 순서(형제 안) — 그 상위의 활성 하위만 10 간격으로 다시 매겨진다
 *   C08 상위 변경          — 다른 본부로 이동(DB parent_id) · 자손 밑으로는 순환 거부 · 최상위(NULL) 거부
 *   C09 조직 숨김          — 활성 하위가 있으면 거부 → 자식부터 숨김 → 부모 숨김 → 복구
 *   C10 비관리자           — 로그인 계정을 잠시 editor 로 내린다(**반드시 복원**):
 *                            #uaOrgTitle 부재 · orgTitleGet admin:false · titleAdd 거부
 *
 * 불변식(케이스마다):
 *   I1 세 표의 **실행(zz 아닌 행) 수**가 시작과 같다(title_code · org_unit · app_user)
 *   I2 실행 내용 해시 불변(직급 이름·순번·활성 / 조직 이름·상위·순번·활성 / 직원 직급·소속·권한·활성)
 *   I3 schema_version 불변
 *   I4 로그인 계정이 활성 admin(C10 안에서만 예외 · 그 케이스가 스스로 되돌리고 읽어서 확인한다)
 *   그리고 종료 뒤 **zz 잔재 0** — 이 시험은 데이터를 남기지 않는다.
 *   ★ 순서 저장(C03·C07)은 **실행 행의 sort_order 를 정당하게 바꾼다**(10 간격 전량 재작성이 이 기능의
 *     계약이다). 그래서 그 케이스는 끝에서 기대값을 재기준(rebase)하고, 종료 정리가 시작 순번을
 *     **절대값 UPDATE 로 되돌린 뒤** 시작 해시와 대조한다 — 루프가 실 데이터의 서열을 바꿔 놓고 끝나지 않는다.
 *
 * ★★ GRANT 미적용은 **실패가 아니다**(설계 §6):
 *   개발 DB 에 org_unit·title_code 의 INSERT·UPDATE 를 적용하는 일은 백업 뒤·지시가 있을 때만 한다.
 *   그 전에는 첫 쓰기가 ERROR 1142 로 죽는데, 그것을 실패로 세면 "아직 안 한 일" 이 "고장" 으로 보인다.
 *   그래서 (a) 시작에 앱 계정의 권한을 읽어 보고, (b) 그래도 모르겠으면 **첫 쓰기의 회신**으로 가른다.
 *   둘 중 하나라도 '권한 없음'이면 정리한 뒤 **exit 2(판정 없음)** 로 끝낸다.
 *
 * 전제(이 스크립트가 하지 않는 것):
 *   · 위젯을 띄우거나 닫지 않는다. 9222 에 **admin 으로 로그인된 채** 떠 있어야 한다(아니면 판정 없음 = exit 2).
 *   · 앱 코드를 고치지 않는다. 화면 경로는 앱의 함수(openOrgTitle·otSend)를 그대로 부른다 — 가로채기가 없다
 *     (2026-09-14 이후 이 도메인의 쓰기는 전부 **왕복**이라 회신이 부른 자리로 돌아온다: 감쌀 회신함이 없다).
 *   · 실행(zz 아닌 행)은 만들지도 지우지도 않는다. 순번만 정당하게 바뀌고, 그것도 끝에 되돌린다.
 *   · TRUNCATE·스키마 변경 없음.
 *
 * 실행:
 *   $env:TC_TEST_DB_ADMIN_PW='...'   (bash: export TC_TEST_DB_ADMIN_PW=...)
 *   node tests/loop-org-title.mjs [--seed=N] [--port=9222] [--budget=120] [-v]
 *
 * 종료코드: 0 = 전부 통과 · 1 = 위반 있음 · 2 = 판정 없음(전제 미충족 · GRANT 미적용 포함)
 * 배포 게이트: **무작위 시드 5회 연속 통과**(설계 §7). 실패하면 1부터 다시 센다.
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
  appUser: process.env.TC_TEST_DB_APP_USER || 'taskmgr_app',
};
if (ARG.has('help') || ARG.has('h')) {
  console.log(`사용법: node tests/loop-org-title.mjs [옵션]
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
/*  ★ loop-trash.mjs 와 같은 함정을 물려받는다: mysql.exe 는 머신 부하가 있을 때 **종료코드 0 인데도
 *    stdout 을 통째로 잃는다**(≈0.9%). 문장 자체는 실행되므로 "그냥 재시도" 하면 쓰기가 두 번 적용된다.
 *    재시도 자격은 **다시 적용해도 결과가 같은 문장인가** 로만 가른다:
 *      readOnly(기본)   — 읽기
 *      idempotent:true  — 범위 고정 DELETE · 절대값 UPDATE 처럼 증분이 아닌 쓰기
 *    이 파일의 쓰기는 넷뿐이고 전부 자격이 있다: zz 잔재 DELETE(범위 고정) · 순번 복원(절대값) ·
 *    로그인 계정 복원(절대값) · C10 강등(절대값).
 *  ★ 비밀번호는 **명령줄에 싣지 않는다**(-p 금지). 자식 프로세스 환경변수 MYSQL_PWD 로만 넘긴다.        */
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
const n1 = (q, what = '수 조회') => { const r = sql(q, { what }); return r.length ? Number(r[0][0]) : 0; };
const s1 = (q, what = '값 조회') => { const r = sql(q, { what }); return r.length ? r[0][0] : null; };

/* ── 앱 계정 권한 — GRANT 가 아직 적용되지 않았는지 **먼저** 본다(설계 §6) ──────────────
 *  돌려주는 값: 빠진 동사 목록(빈 배열 = 다 있다) · null = 판별할 수 없었다(권한 조회 자체가 막힌 경우).
 *  ★ 전역 권한(*.*)이 있으면 표 단위 GRANT 가 안 보인다 — 그때는 '다 있다'로 읽는다.                */
function appGrantGaps() {
  let rows;
  try { rows = sql(`SHOW GRANTS FOR ${esc(OPT.appUser)}@'%'`, { what: '앱 계정 권한 조회' }); }
  catch (_) { return null; }
  const txt = rows.map((r) => r.join(' ')).join('\n');
  if (/GRANT\s+ALL\s+PRIVILEGES\s+ON\s+\*\.\*/i.test(txt)) return [];
  const gaps = [];
  for (const t of ['org_unit', 'title_code']) {
    const re = new RegExp('GRANT ([A-Z, ]+) ON `?' + OPT.db + '`?\\.`?' + t + '`?', 'i');
    const m = re.exec(txt);
    if (!m) { gaps.push(`${t}: GRANT 자체가 없다`); continue; }
    const verbs = m[1].toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
    const need = ['INSERT', 'UPDATE'].filter((v) => !verbs.includes(v));
    if (need.length) gaps.push(`${t}: ${need.join('·')} 없음(지금 [${verbs.join(', ')}])`);
  }
  return gaps;
}
/** 회신 문장이 'GRANT 가 없다' 로 읽히는가 — 첫 쓰기에만 쓴다(§6).
 *  ★ 호스트가 1142 를 **제 문장**으로 돌려준다(ProjectDb.GrantMissingMsg · §11-2 정정):
 *    「DB 권한이 없습니다(1142) — 서버에 직급·소속 GRANT 를 적용해야 합니다(DEPLOY §0-5).」
 *    옛 판처럼 일반 DB 오류로 뭉개진 위젯도 있을 수 있어 그쪽 문장까지 함께 본다(정본 대조는
 *    tests/org-title-host.test.mjs 계약⑤-b 가 진다). */
const looksLikeGrantDenied = (msg) => /1142|command denied|권한이 없|DB 오류/.test(String(msg || ''));

/** GRANT 미적용으로 끝낸다 — 실패가 아니라 **판정 없음**이다. */
function bailNoGrant(detail) {
  console.error('');
  console.error('[판정 없음] GRANT 미적용 — ORG-TITLE-ADMIN §6');
  console.error(`            ${detail}`);
  console.error(`            개발 DB 적용은 **백업(복원 검증) 뒤·지시가 있을 때만** 합니다(HANDOFF §5).`);
  console.error(`            적용할 두 문장:`);
  console.error(`              GRANT SELECT, INSERT, UPDATE ON ${OPT.db}.org_unit   TO '${OPT.appUser}'@'%';`);
  console.error(`              GRANT SELECT, INSERT, UPDATE ON ${OPT.db}.title_code TO '${OPT.appUser}'@'%';`);
  console.error(`            확인: SHOW GRANTS FOR '${OPT.appUser}'@'%';`);
  cleanupAll('GRANT 미적용');
  summary();
  process.exit(2);
}

/* ── 스냅샷 ────────────────────────────────────────────────────────────────
 *  실행(zz 아닌 행)의 **수**와 **내용 해시**를 함께 뜬다. 수만 보면 "한 줄 지우고 한 줄 넣은" 변화가 통과한다.
 *  ★ GROUP_CONCAT 은 기본 1024 바이트에서 조용히 잘린다 — 세션 변수를 먼저 올린다.                       */
const SNAP_SQL = (me) => `
SET SESSION group_concat_max_len=8388608;
SELECT 'J', COUNT(*) FROM title_code WHERE name     NOT LIKE 'zzJ%';
SELECT 'O', COUNT(*) FROM org_unit   WHERE name     NOT LIKE 'zzO%';
SELECT 'U', COUNT(*) FROM app_user   WHERE login_id NOT LIKE 'zzU%';
SELECT 'V', v FROM cal_schema_meta WHERE k='schema_version';
SELECT 'M', edit_role, CAST(is_active AS CHAR), CAST(user_id AS CHAR), name FROM app_user WHERE login_id=${esc(me)};
SELECT 'H', IFNULL(SHA2(GROUP_CONCAT(x ORDER BY x SEPARATOR '|'),256),'(빈집합)') FROM (
            SELECT CONCAT('J/',name,'/',sort_order,'/',is_active)                                AS x
              FROM title_code WHERE name NOT LIKE 'zzJ%'
  UNION ALL SELECT CONCAT('O/',org_id,'/',name,'/',IFNULL(parent_id,'-'),'/',sort_order,'/',is_active)
              FROM org_unit   WHERE name NOT LIKE 'zzO%'
  UNION ALL SELECT CONCAT('U/',user_id,'/',IFNULL(title,'-'),'/',IFNULL(org_id,'-'),'/',edit_role,'/',is_active)
              FROM app_user   WHERE login_id NOT LIKE 'zzU%'
) z`;

function dbSnap(me, what = '스냅샷') {
  const rs = sql(SNAP_SQL(me), { what });
  const s = { counts: {}, schemaVersion: null, meRole: null, meActive: null, meUid: 0, meName: '', hash: null };
  for (const c of rs) {
    if (c[0] === 'J') s.counts.title_code = Number(c[1]);
    else if (c[0] === 'O') s.counts.org_unit = Number(c[1]);
    else if (c[0] === 'U') s.counts.app_user = Number(c[1]);
    else if (c[0] === 'V') s.schemaVersion = c[1];
    else if (c[0] === 'M') { s.meRole = c[1]; s.meActive = c[2] === '1'; s.meUid = Number(c[3]); s.meName = c[4]; }
    else if (c[0] === 'H') s.hash = c[1];
  }
  return s;
}
const countsKey = (c) => `${c.title_code}/${c.org_unit}/${c.app_user}`;

/* ── 시작 순번 기록/복원 ───────────────────────────────────────────────────
 *  순서 저장은 **10 간격 전량 재작성**이 계약이라(§4.2) 실 데이터의 sort_order 가 정당하게 바뀐다.
 *  루프가 그 서열을 바꿔 놓고 끝나면 안 되므로, 시작값을 적어 두었다가 끝에 절대값 UPDATE 로 되돌린다. */
let ORDER0 = null;
function captureOrder() {
  return {
    titles: sql(`SELECT name, sort_order FROM title_code WHERE name NOT LIKE 'zzJ%'`, { what: '직급 순번 기록' }),
    units: sql(`SELECT org_id, sort_order FROM org_unit WHERE name NOT LIKE 'zzO%'`, { what: '조직 순번 기록' }),
  };
}
function restoreOrder(o) {
  if (!o) return;
  const st = [];
  for (const [name, so] of o.titles) st.push(`UPDATE title_code SET sort_order=${Number(so)} WHERE name=${esc(name)}`);
  for (const [id, so] of o.units) st.push(`UPDATE org_unit SET sort_order=${Number(so)} WHERE org_id=${Number(id)}`);
  if (!st.length) return;
  //  절대값 UPDATE — 다시 적용해도 결과가 같다(idempotent 자격).
  sql(st.join(';\n'), { readOnly: false, idempotent: true, what: '시작 순번 복원' });
}

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

/** 페이지 상태 한 덩어리 — 폴링은 전부 이걸로 한다(왕복 수를 줄인다). */
const PSTATE = `JSON.stringify({
  otOpen: (function(){ var e=document.getElementById('orgTitleModal'); return !!e && !e.classList.contains('hidden'); })(),
  otBusy: !!__otBusy, otSaving: !!__otSaving, otTab: String(__otTab||''), otHidden: !!__otShowHidden,
  otAdmin: (function(){ try { return !!otAdmin(); } catch(_){ return false; } })(),
  otBusyAttr: (function(){ var e=document.getElementById('orgTitleModal'); return e ? String(e.getAttribute('data-busy')||'') : ''; })(),
  rows: document.querySelectorAll('#otList .cust-row').length,
  ops: document.querySelectorAll('#otList [data-otop]').length,
  hints: document.querySelectorAll('#otList .set-hint').length,
  scope: (function(){ var e=document.getElementById('otScope'); return e ? String(e.textContent||'') : ''; })(),
  uaOrgTitle: !!document.getElementById('uaOrgTitle'),
  uaOpen: (function(){ var e=document.getElementById('userAdminModal'); return !!e && !e.classList.contains('hidden') && !e.classList.contains('closing'); })(),
  uaBusy: !!__uaBusy,
  online: !!dbOnline
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

/* ── 호스트 왕복 두 모양 ──────────────────────────────────────────────────
 *  ① otsend — **화면의 문**(otSend)을 그대로 지난다: 잠금·좌석(otSeat)·토스트가 다 돈다. 그래서 이 길로
 *              보낸 뒤에는 화면이 갱신 목록을 앉힌 상태다(행 수·버튼을 그대로 물어볼 수 있다).
 *  ② hsend  — 화면 가드를 일부러 건너뛰고 호스트로 곧장 보낸다. 여기서 보는 것은 **호스트 계약**이다
 *              (화면이 안 보내는 값 — 상위 0, 순환, 낡은 목록 — 을 호스트가 스스로 막는가).
 *  ★ 둘 다 회신 객체({ok,msg,orgTitle})를 그대로 돌려준다. 회신이 없으면 null 대신 모양을 맞춰 준다 —
 *    '회신 없음'을 ok=false 로 뭉개면 무엇이 일어났는지 알 수 없게 된다.                                */
const NOREPLY = { ok: false, msg: '(회신 없음)', orgTitle: '' };
//  ★ otSend 는 자기 기한(20초)을 스스로 들고 있다 — 여기서 따로 주지 않는다(두 벌이면 한쪽만 낡는다).
async function otsend(cmd, params = {}) {
  const r = await evj(`otSend(${J(cmd)}, ${J(params)}).then(function(x){ return JSON.stringify(x==null?null:x); })`);
  const rep = r || NOREPLY;
  vlog(`otsend ${cmd} → ok=${rep.ok} "${rep.msg}"`);
  return rep;
}
async function hsend(cmd, params = {}, timeout = 25000) {
  const r = await evj(`hostRequest(${J(cmd)}, ${J(params)}, ${timeout}).then(function(x){ return JSON.stringify(x==null?null:x); })`);
  const rep = r || NOREPLY;
  vlog(`hsend ${cmd} → ok=${rep.ok} "${rep.msg}"`);
  return rep;
}
/** orgTitleGet — 회신은 {ok, data, msg} 로 감싸여 온다(RunOrgTitleGetAsync). */
async function orgTitleGet() {
  const r = await evj(`hostRequest('orgTitleGet', {}, 15000).then(function(x){ return JSON.stringify(x==null?null:x); })`);
  const d = (r && r.data) ? r.data : r;
  return { reply: r, data: d || null };
}
const titleOf = (data, name) => ((data && data.titles) || []).find((t) => t && String(t.name) === String(name)) || null;
const unitOf = (data, key) => ((data && data.units) || []).find((u) => u && (String(u.orgId) === String(key) || String(u.name) === String(key))) || null;

/* ── 화면 조작 ─────────────────────────────────────────────────────────── */

/** 「구성원 편집」을 열고 관리자 막대가 설 때까지 기다린다.
 *  ★ 관리창(#orgTitleModal)을 닫으면 otAfterClose 가 uaReload() 를 띄운다 — 그 조회가 도는 동안 openUserAdmin() 은
 *    재진입 가드(__uaBusy)에 막혀 **아무 일도 하지 않고**, 닫히는 중(.closing)인 옛 창은 아직 hidden 이 아니라
 *    '열렸다'로 읽힌다. 그래서 첫 5회 게이트에서 C10 이 옛 막대의 #uaOrgTitle 을 보고 실패했다(2026-09-18).
 *    조회가 끝나기를 먼저 기다리고, 연 뒤에도 조회가 끝난 상태(!uaBusy)까지 기다린다. */
async function openMembers() {
  await waitPage((x) => !x.uaBusy, { timeout: 20000 });
  await ev(`(typeof closeModal==='function' && closeModal('#userAdminModal'), 1)`);
  await waitPage((x) => x.uaOpen === false, { timeout: 5000 });
  await ev(`openUserAdmin()`);
  const s = await waitPage((x) => x.uaOpen === true && !x.uaBusy, { timeout: 20000 });
  if (!s) throw new Error('「구성원 편집」이 열리지 않았다(또는 조회가 끝나지 않았다)');
  return s;
}
/** #uaOrgTitle 을 **실제로 누른다**. 반환: 'clicked' | 'disabled' | 'notfound' */
const clickOrgTitle = () => ev(`(function(){
  var b = document.getElementById('uaOrgTitle');
  if(!b) return 'notfound';
  if(b.disabled) return 'disabled';
  b.click(); return 'clicked';
})()`);
/** 「직급·소속 관리」를 열고(실클릭) 회신이 도착할 때까지 기다린다. */
async function openOrgTitleByClick() {
  await ev(`(typeof closeModal==='function' && closeModal('#orgTitleModal'), 1)`);
  const c = await clickOrgTitle();
  if (c !== 'clicked') throw new Error(`「직급·소속 관리」 버튼을 누르지 못했다: ${c}`);
  const s = await waitPage((x) => x.otOpen && !x.otBusy, { timeout: 20000 });
  if (!s) throw new Error('「직급·소속 관리」가 열리지 않았다(회신이 오지 않음)');
  return s;
}
/** 탭 전환 — 실제 탭 버튼을 누른다. */
async function otTab(kind) {
  const id = kind === 'unit' ? 'otTabUnit' : 'otTabTitle';
  await ev(`(function(){var b=document.getElementById(${J(id)}); if(b) b.click(); return 1;})()`);
  const s = await waitPage((x) => x.otTab === (kind === 'unit' ? 'unit' : 'title'), { timeout: 8000 });
  if (!s) throw new Error(`탭 전환에 실패했다: ${kind}`);
  return s;
}
/** 「숨긴 값도 표시」 토글 — 실제 체크박스를 누른다. */
async function otShowHidden(on) {
  await ev(`(function(){
    var c=document.getElementById('otShowHidden'); if(!c) return 0;
    if(!!c.checked !== ${on ? 'true' : 'false'}){ c.checked = ${on ? 'true' : 'false'}; c.dispatchEvent(new Event('change',{bubbles:true})); }
    return 1;
  })()`);
  await waitPage((x) => x.otHidden === !!on, { timeout: 5000 });
}
/** 화면에 그 행이 서 있는가 — 버튼 상태까지(있는가 · 꺼졌는가 · 사유(title)가 붙었는가). */
const otRow = (key) => evj(`(function(){
  var out = null;
  var rows = document.querySelectorAll('#otList .cust-row');
  for(var i=0;i<rows.length;i++){
    var r = rows[i];
    if(String(r.dataset.otkey||'') !== ${J(String(key))}) continue;
    var nm = r.querySelector('.cust-nm');
    out = {
      key: String(r.dataset.otkey||''),
      name: (nm && nm.childNodes[0]) ? String(nm.childNodes[0].nodeValue||'') : '',
      pad: nm ? String(nm.style.paddingLeft||'') : '',
      hidden: r.classList.contains('hidden-cust'),
      btns: Array.prototype.map.call(r.querySelectorAll('button'), function(b){
        return { op: String(b.dataset.otop||''), label: String(b.textContent||''),
                 disabled: !!b.disabled, title: String(b.title||'') }; })
    };
  }
  return JSON.stringify(out);
})()`);
const otBtn = (row, op) => (row && row.btns ? row.btns.find((b) => b.op === op) || null : null);

/* ────────────────────────────── 4. 불변식 ────────────────────────────── */

let ME = 'phmin';
let BASE = null;            // 시작 스냅샷
let EXPECT = null;          // 지금 기대되는 모습(정당한 변경을 낸 케이스가 스스로 갱신한다)

function rebase(why) {
  const s = dbSnap(ME, '기대값 재기준');
  EXPECT = { counts: { ...s.counts }, hash: s.hash, meRole: s.meRole, meActive: s.meActive };
  note(`기대값 재기준: ${why} (해시 ${String(s.hash).slice(0, 12)} · ${ME}=${s.meRole}/${s.meActive ? '활성' : '비활성'})`);
  return s;
}

function invariants(caseId) {
  const s = dbSnap(ME, `불변식(${caseId})`);
  const fail0 = fail;

  ok(`${caseId} I1 세 표 실행 수 불변(${countsKey(EXPECT.counts)})`,
    countsKey(s.counts) === countsKey(EXPECT.counts), `실제 ${countsKey(s.counts)}`);
  ok(`${caseId} I2 실행 내용 해시 불변`, s.hash === EXPECT.hash,
    `${String(EXPECT.hash).slice(0, 12)} → ${String(s.hash).slice(0, 12)} — zz 아닌 행이 바뀌었다`);
  ok(`${caseId} I3 schema_version 불변(${BASE.schemaVersion})`, s.schemaVersion === BASE.schemaVersion, `실제 ${s.schemaVersion}`);
  ok(`${caseId} I4 로그인 계정 ${ME} = ${EXPECT.meRole}/${EXPECT.meActive ? '활성' : '비활성'}`,
    s.meRole === EXPECT.meRole && s.meActive === EXPECT.meActive, `실제 ${s.meRole}/${s.meActive}`);

  if (fail === fail0) {
    console.log(el(), `  ✓ ${caseId} 불변식 I1~I4 ` +
      `(실행 ${countsKey(s.counts)} · v${s.schemaVersion} · ${ME}=${s.meRole})`);
  }
  return s;
}

/* ────────────────────────────── 5. 정리(시작·종료 양쪽) ────────────────────────────── */
/*  ★ 종료 정리만으로는 부족하다(강제 종료는 어떤 핸들러도 못 받는다) — 다음 실행이 시작할 때 이전 잔재를
 *    먼저 걷어낸다. 둘을 합쳐야 닫힌다.
 *  ★ 지우는 순서는 FK 순서다: zzU 직원의 캘린더 자식 표 → cal_user_pref/rev → app_user(zzU)
 *    → org_unit(zzO, **잎부터**) → title_code(zzJ).
 *    app_user.title 과 app_user.org_id 가 RESTRICT 라 직원이 먼저 사라져야 마스터를 지울 수 있다.
 *  ★ 앱 계정에는 이 두 표의 DELETE 가 **없다**(§6) — 그래서 여기서만 관리자 연결로 지운다. */
function zzLeft() {
  return n1(`SELECT
      (SELECT COUNT(*) FROM app_user   WHERE login_id LIKE 'zzU%')
    + (SELECT COUNT(*) FROM org_unit   WHERE name     LIKE 'zzO%')
    + (SELECT COUNT(*) FROM title_code WHERE name     LIKE 'zzJ%')`, 'zz 잔재 수');
}
function sweepZz(reason) {
  const before = {
    user: n1(`SELECT COUNT(*) FROM app_user   WHERE login_id LIKE 'zzU%'`, 'zz 인력 수'),
    unit: n1(`SELECT COUNT(*) FROM org_unit   WHERE name     LIKE 'zzO%'`, 'zz 조직 수'),
    title: n1(`SELECT COUNT(*) FROM title_code WHERE name    LIKE 'zzJ%'`, 'zz 직급 수'),
  };
  const total = before.user + before.unit + before.title;
  if (total === 0) return { swept: 0, left: 0 };

  const ids = sql(`SELECT user_id FROM app_user WHERE login_id LIKE 'zzU%'`, { what: 'zz 사용자 id' }).map((r) => r[0]);
  const IN = ids.length ? ids.join(',') : '-1';
  const kids = ['cal_entry_commit', 'cal_entry_except', 'cal_todo_day_note', 'cal_report_hours',
    'cal_task_hours', 'cal_attendance', 'cal_report_daily', 'cal_report_weekly', 'cal_migration_log',
    'cal_todo', 'cal_entry', 'cal_room', 'cal_category', 'cal_user_pref', 'cal_user_rev'];
  const stmts = kids.map((t) => `DELETE FROM ${t} WHERE user_id IN (${IN})`);
  stmts.push(`DELETE FROM app_user WHERE login_id LIKE 'zzU%'`);
  //  범위 고정 DELETE — 두 번째는 0행이라 재적용이 무동작이다(idempotent 자격).
  sql(stmts.join(';\n'), { readOnly: false, idempotent: true, what: 'zz 인력 삭제' });

  //  조직은 **잎부터** 지운다 — 자기 표 FK(parent_id)가 RESTRICT 라 부모를 먼저 지울 수 없다.
  //  한 문장으로 몰아 지우면 스캔 순서에 따라 1451 이 난다. 깊이는 얕으니 몇 바퀴면 끝난다.
  for (let i = 0; i < 6; i++) {
    const left = n1(`SELECT COUNT(*) FROM org_unit WHERE name LIKE 'zzO%'`, 'zz 조직 잔여');
    if (left === 0) break;
    sql(`DELETE FROM org_unit WHERE name LIKE 'zzO%'
           AND org_id NOT IN (SELECT p FROM (SELECT DISTINCT parent_id AS p FROM org_unit WHERE parent_id IS NOT NULL) t)`,
      { readOnly: false, idempotent: true, what: 'zz 조직 잎 삭제' });
  }
  sql(`DELETE FROM title_code WHERE name LIKE 'zzJ%'`, { readOnly: false, idempotent: true, what: 'zz 직급 삭제' });

  const left = zzLeft();
  console.error(`[cleanup] zz 정리(${reason}): 인력 ${before.user} · 조직 ${before.unit} · 직급 ${before.title}` +
    (left ? ` — ★ ${left}건이 남았다(FK 가 붙들고 있다 — 수동 확인)` : ' — 남은 것 없음'));
  return { swept: total, left };
}

/** 로그인 계정을 admin/활성으로 되돌린다 — C10 이 잠깐 내리기 때문이다. 절대값 UPDATE(idempotent). */
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
  try { restoreOrder(ORDER0); } catch (e) { console.error('[cleanup] ★★ 시작 순번 복원 실패: ' + e.message); }
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

async function runCase(id, title, fn) {
  log(`── ${id} ${title} ──`);
  tick(id);
  try { await fn(); }
  catch (e) { ok(`${id} 실행`, false, e.message); }
  try { invariants(id); } catch (e) { ok(`${id} 불변식 조회`, false, e.message); }
  tock(id);
}

/* 시험 이름 — 접두 규약(zzJ 직급 · zzO 조직 · zzU 인력)을 한 곳에서만 만든다. 같은 시드면 같은 이름이 나온다. */
const NM = {
  title1: () => `zzJ${OPT.seed}`,
  title2: () => `zzJ${OPT.seed}b`,
  unit1: () => `zzO${OPT.seed}`,
  unit2: () => `zzO${OPT.seed}b`,
  user: () => `zzU${OPT.seed}ot`,          // login_id 형식 ^[A-Za-z0-9._-]{1,50}$ 를 지킨다
};

/* DB 직접 조회 — 화면이 말하는 것과 DB 가 말하는 것이 같은지 대조하는 것이 이 루프의 절반이다. */
const titleSort = (name) => Number(s1(`SELECT sort_order FROM title_code WHERE name=${esc(name)}`, '직급 순번') || -1);
const titleActive = (name) => s1(`SELECT CAST(is_active AS CHAR) FROM title_code WHERE name=${esc(name)}`, '직급 활성');
const titleRows = (name) => n1(`SELECT COUNT(*) FROM title_code WHERE name=${esc(name)}`, '직급 행 수');
const titleMax = () => Number(s1(`SELECT COALESCE(MAX(sort_order),0) FROM title_code`, '직급 최대 순번') || 0);
const unitId = (name) => Number(s1(`SELECT org_id FROM org_unit WHERE name=${esc(name)}`, '조직 번호') || 0);
const unitName = (id) => s1(`SELECT name FROM org_unit WHERE org_id=${Number(id)}`, '조직 이름');
const unitParent = (id) => Number(s1(`SELECT IFNULL(parent_id,0) FROM org_unit WHERE org_id=${Number(id)}`, '조직 상위') || 0);
const unitSort = (id) => Number(s1(`SELECT sort_order FROM org_unit WHERE org_id=${Number(id)}`, '조직 순번') || -1);
const unitActive = (id) => s1(`SELECT CAST(is_active AS CHAR) FROM org_unit WHERE org_id=${Number(id)}`, '조직 활성');
const unitRows = (name) => n1(`SELECT COUNT(*) FROM org_unit WHERE name=${esc(name)}`, '조직 행 수');
const siblingMax = (pid) => Number(s1(`SELECT COALESCE(MAX(sort_order),0) FROM org_unit WHERE parent_id=${Number(pid)}`, '형제 최대 순번') || 0);
const userTitle = (loginId) => s1(`SELECT IFNULL(title,'') FROM app_user WHERE login_id=${esc(loginId)}`, '직원 직급');

/* 거부 문구 — 호스트 상수와 뜻이 같아야 한다(ProjectDb.cs · 설계 §5.2). 여기 적힌 것이 계약이다. */
const MSG = {
  titleInUse: /재직자/,
  unitInUse: /하위 조직/,
  parentPick: /상위 조직을 고르세요/,
  parentGone: /상위 조직이 없거나 숨겨져 있습니다/,
  rootHide: /최상위 조직은 숨길 수 없습니다/,
  rootMove: /최상위로는 옮길 수 없습니다/,
  selfMove: /자기 자신을 상위로 삼을 수 없습니다/,
  cycle: /자기 하위 조직 아래로는 옮길 수 없습니다/,
  dupTitle: /이미 있는 직급입니다/,
  dupUnit: /이미 있는 조직입니다/,
  stale: /목록이 바뀌었습니다/,
  already: /이미 그 상태입니다/,
  denied: /관리자/,
};

/* ────────────────────────────── 7. 본체 ────────────────────────────── */

async function main() {
  log(`직급·소속 관리 루프 시험 — 시드 ${OPT.seed} · 포트 ${OPT.port} · DB ${OPT.db}`);

  /* ── 시작 정리 + 전제 확인 ─────────────────────────────────────────── */
  sweepZz('시작');
  const left0 = zzLeft();
  if (left0) { console.error(`[판정 없음] 시작 정리 뒤에도 zz 잔재 ${left0}건이 남았다 — 손으로 확인해야 한다`); process.exit(2); }

  cdp = await Cdp.attach(OPT.port);
  const who = await evj(`JSON.stringify({host: !!HOST, id: (currentUser&&currentUser.loginId)||'', ot: (typeof otSend==='function')})`);
  if (!who.host || !who.id) { console.error('[판정 없음] 위젯이 로그인 상태가 아니다'); process.exit(2); }
  if (!who.ot) { console.error('[판정 없음] 페이지에 otSend 가 없다 — 「직급·소속 관리」 이전 버전의 위젯이다'); process.exit(2); }
  ME = who.id;

  BASE = dbSnap(ME, '시작 스냅샷');
  if (!BASE.meUid) { console.error(`[판정 없음] 로그인 계정(${ME})이 app_user 에 없다`); process.exit(2); }
  if (BASE.meRole !== 'admin' || !BASE.meActive) {
    console.error(`[판정 없음] 로그인 계정(${ME})이 활성 admin 이 아니다(${BASE.meRole}/${BASE.meActive ? '활성' : '비활성'}) — 이 화면은 admin 으로만 판정된다`);
    process.exit(2);
  }
  EXPECT = { counts: { ...BASE.counts }, hash: BASE.hash, meRole: BASE.meRole, meActive: BASE.meActive };
  ORDER0 = captureOrder();
  log(`로그인 계정 ${ME}(user_id=${BASE.meUid}, 이름 "${BASE.meName}") · 활성 admin 확인`);
  log(`시작 스냅샷: 실행 ${countsKey(BASE.counts)}(직급/조직/직원) · schema_version=${BASE.schemaVersion} · 해시 ${String(BASE.hash).slice(0, 12)}`);
  log(`시작 순번 기록: 직급 ${ORDER0.titles.length}건 · 조직 ${ORDER0.units.length}건(종료 시 절대값으로 되돌린다)`);

  //  ★ GRANT 선검사 — 아직 안 준 상태면 여기서 판정 없이 끝낸다(설계 §6). 실패가 아니다.
  const gaps = appGrantGaps();
  if (gaps === null) note(`앱 계정(${OPT.appUser}) 권한을 읽지 못했다 — 첫 쓰기의 회신으로 가른다`);
  else if (gaps.length) bailNoGrant(`앱 계정 ${OPT.appUser}@'%' 의 권한이 모자란다 — ${gaps.join(' · ')}`);
  else vlog(`앱 계정 ${OPT.appUser} 권한 확인: org_unit·title_code 에 INSERT·UPDATE 있음`);

  const T = { one: NM.title1(), two: NM.title2() };
  const U = { lid: NM.user(), uid: 0 };
  const O = { one: NM.unit1(), two: NM.unit2(), oneId: 0, twoId: 0 };
  let PARENT = null;   // zzO 를 매달 상위(실 조직)
  let TARGET = null;   // C08 이 옮겨 갈 다른 상위(실 조직)

  /* ── C00 진입 · 회신 모양 ───────────────────────────────────────────── */
  await runCase('C00', '진입 — 「구성원 편집」 → #uaOrgTitle 실클릭 → orgTitleGet 회신 모양', async () => {
    await openMembers();
    const bar = await waitPage((x) => x.uaOrgTitle === true, { timeout: 15000 });
    if (!okq('C00 「직급·소속 관리」 문이 구성원 편집 상단 막대에 생겼다(관리자 회신)', !!bar,
      '#uaOrgTitle 이 없다 — uaAdminBar 가 admin 회신을 admin 으로 읽지 못했다')) return;

    const s = await openOrgTitleByClick();
    okq('C00 실클릭으로 화면이 열렸다(회신 도착)', s.otOpen === true && s.otBusy === false);
    okq('C00 __otData 가 관리자 회신으로 앉았다', s.otAdmin === true, `otAdmin=${s.otAdmin}`);
    okq('C00 직급 탭이 먼저 열린다(설계 §5.1)', s.otTab === 'title', s.otTab);
    okq('C00 목록이 그려졌다(행 ≥ 1)', s.rows >= 1, `rows=${s.rows}`);

    const { data } = await orgTitleGet();
    if (!okq('C00 orgTitleGet 이 found:true · admin:true', !!(data && data.found === true && data.admin === true),
      JSON.stringify(data && { found: data.found, admin: data.admin }))) return;
    const titles = data.titles || [], units = data.units || [];
    okq('C00 직급 시드 11개 이상', titles.length >= 11, `실제 ${titles.length}`);
    okq('C00 직급 행 모양(name·sort·active·users)', titles.every((t) =>
      t && typeof t.name === 'string' && typeof t.sort === 'number' && typeof t.active === 'boolean' && typeof t.users === 'number'),
      JSON.stringify(titles[0]));
    okq('C00 조직이 하나 이상', units.length >= 1, `실제 ${units.length}`);
    okq('C00 조직 행 모양(orgId·parentId·depth·sort·active·users·children)', units.every((u) =>
      u && typeof u.orgId === 'number' && typeof u.depth === 'number' && typeof u.active === 'boolean'
      && typeof u.users === 'number' && typeof u.children === 'number'), JSON.stringify(units[0]));

    //  깊이우선 — 부모가 자식보다 **먼저** 오고, depth 는 부모+1 이다.
    const seen = new Map();
    let dfsOk = true, why = '';
    for (const u of units) {
      if (u.parentId == null) {
        if (u.depth !== 0) { dfsOk = false; why = `루트 ${u.name} 의 depth 가 ${u.depth}`; break; }
      } else {
        const p = seen.get(Number(u.parentId));
        if (p === undefined) { dfsOk = false; why = `${u.name} 의 상위(${u.parentId})가 아직 나오지 않았다`; break; }
        if (u.depth !== p + 1) { dfsOk = false; why = `${u.name} 의 depth 가 ${u.depth}(상위 ${p})`; break; }
      }
      seen.set(Number(u.orgId), Number(u.depth));
    }
    okq('C00 조직 목록이 깊이우선이다(부모가 먼저 · depth = 상위+1)', dfsOk, why);

    //  zzO 를 매달 상위 둘을 고른다 — 이름이 있으면 시드 트리의 그 자리를, 없으면 아무 활성 비루트 조직을.
    const actives = units.filter((u) => u.active !== false && u.parentId != null);
    PARENT = actives.find((u) => u.name === 'SW개발본부') || actives[0] || null;
    TARGET = actives.find((u) => u.name === '시스템개발본부') || actives.find((u) => PARENT && u.orgId !== PARENT.orgId) || null;
    if (!PARENT || !TARGET) {
      skip('C05~C09', `zzO 를 매달 활성 비루트 조직이 둘 이상 필요한데 ${actives.length}개뿐이다`);
    } else {
      note(`시험 조직의 상위 = "${PARENT.name}"(org_id=${PARENT.orgId}) · 이동 목표 = "${TARGET.name}"(org_id=${TARGET.orgId})`);
    }
  });

  /* ── C01 직급 추가 ─────────────────────────────────────────────────── */
  await runCase('C01', `직급 추가(${T.one}) — 화면에 행이 서고 DB sort = MAX+10`, async () => {
    const max0 = titleMax();
    const rep = await otsend('titleAdd', { name: T.one });
    //  ★ 첫 쓰기다 — 여기서 GRANT 미적용이 드러나면 **실패가 아니라 판정 없음**이다(§6).
    if (!rep.ok && looksLikeGrantDenied(rep.msg) && titleRows(T.one) === 0) {
      bailNoGrant(`첫 쓰기(titleAdd)가 거부됐다: "${rep.msg}" — 위젯 로그에 ERROR 1142 가 있는지 확인하세요`);
    }
    if (!okq('C01 직급 추가 성공', rep.ok === true, rep.msg)) return;
    okq('C01 DB 에 행이 생겼다', titleRows(T.one) === 1);
    okq(`C01 sort_order = 직전 MAX+10 (${max0}+10)`, titleSort(T.one) === max0 + 10, `실제 ${titleSort(T.one)}`);
    okq('C01 새 직급은 활성이다', titleActive(T.one) === '1', String(titleActive(T.one)));
    //  회신의 갱신 목록이 화면에 앉았는가 — otSend 가 otSeat 한 곳으로 앉힌다(설계 §5.1).
    const row = await otRow(T.one);
    okq('C01 화면에 그 행이 섰다(회신의 orgTitle 이 앉았다)', !!row, '행이 없다 — otSeat 가 목록을 앉히지 못했다');
    okq('C01 재직자 0명이라 [숨김] 이 켜져 있다', !!otBtn(row, 'hide') && otBtn(row, 'hide').disabled === false,
      JSON.stringify(otBtn(row, 'hide')));

    //  중복은 거부된다(숨긴 동명도 같은 답 · §4.2).
    const dup = await otsend('titleAdd', { name: T.one });
    okq('C01 같은 이름 재등록 거부', dup.ok === false && MSG.dupTitle.test(String(dup.msg)), JSON.stringify(dup.msg));
    okq('C01 거부 뒤에도 행은 하나뿐', titleRows(T.one) === 1);
  });

  /* ── C02 직급 개명 ─────────────────────────────────────────────────── */
  await runCase('C02', `직급 개명(${T.one} → ${T.two})`, async () => {
    if (titleRows(T.one) !== 1) { skip('C02', 'C01 이 직급을 만들지 못했다'); return; }
    const sort0 = titleSort(T.one);
    const rep = await otsend('titleRename', { oldName: T.one, newName: T.two });
    if (!okq('C02 개명 성공', rep.ok === true, rep.msg)) return;
    okq('C02 옛 이름은 사라졌다', titleRows(T.one) === 0);
    okq('C02 새 이름이 앉았다', titleRows(T.two) === 1);
    okq('C02 순번은 그대로다(개명은 서열을 건드리지 않는다)', titleSort(T.two) === sort0, `${sort0} → ${titleSort(T.two)}`);
    const row = await otRow(T.two);
    okq('C02 화면의 행 이름도 바뀌었다', !!row && row.name === T.two, row ? row.name : '행 없다');

    //  없는 직급을 고치면 '화면이 낡았다'(§4.2) — 호스트가 직접 막는다(화면을 우회한다).
    const gone = await hsend('titleRename', { oldName: T.one, newName: T.one + 'x' });
    okq('C02 없는 직급 개명은 낡은 목록으로 거부', gone.ok === false && MSG.stale.test(String(gone.msg)), JSON.stringify(gone.msg));
  });

  /* ── C03 직급 순서 ─────────────────────────────────────────────────── */
  await runCase('C03', `직급 순서(${T.two} 를 한 칸 위로) — 두 값이 맞바뀌고 전량 10 간격`, async () => {
    if (titleRows(T.two) !== 1) { skip('C03', 'C02 가 직급을 남기지 못했다'); return; }
    const before = sql(`SELECT name FROM title_code WHERE is_active=1 ORDER BY sort_order, name`, { what: 'C03 활성 직급 순서' })
      .map((r) => r[0]);
    const i = before.indexOf(T.two);
    if (i <= 0) { skip('C03', `${T.two} 가 맨 앞이거나 목록에 없다(i=${i}) — 위로 옮길 자리가 없다`); return; }
    const above = before[i - 1];

    //  ★ 화면의 ▲ 를 **실제로 누른다** — 화면이 보내는 페이로드(활성 배열 전체)가 그 길로만 만들어진다.
    await otTab('title');
    const clicked = await ev(`(function(){
      var bs = document.querySelectorAll('#otList [data-otop="up"]');
      for(var k=0;k<bs.length;k++){
        if(String(bs[k].dataset.otkey||'') !== ${J(T.two)}) continue;
        if(bs[k].disabled) return 'disabled';
        bs[k].click(); return 'clicked';
      }
      return 'notfound';
    })()`);
    if (!okq('C03 ▲ 버튼을 실제로 눌렀다', clicked === 'clicked', String(clicked))) return;
    const done = await waitPage((x) => x.otSaving === false && x.otBusyAttr === '', { timeout: 25000 });
    okq('C03 왕복이 끝났다(잠금 해제 · busy 표식 제거)', !!done, JSON.stringify(done));

    const after = sql(`SELECT name FROM title_code WHERE is_active=1 ORDER BY sort_order, name`, { what: 'C03 저장 뒤 순서' })
      .map((r) => r[0]);
    okq(`C03 ${T.two} 가 ${above} 앞으로 갔다`, after.indexOf(T.two) === i - 1 && after.indexOf(above) === i,
      `실제 [${after.slice(Math.max(0, i - 2), i + 2).join(', ')}]`);
    const sorts = sql(`SELECT sort_order FROM title_code WHERE is_active=1 ORDER BY sort_order`, { what: 'C03 순번들' })
      .map((r) => Number(r[0]));
    const want = sorts.map((_, k) => (k + 1) * 10);
    okq('C03 활성 직급이 10·20·30… 으로 전량 재작성됐다', JSON.stringify(sorts) === JSON.stringify(want),
      `실제 [${sorts.join(', ')}]`);

    //  낡은 목록(하나 빠뜨린 배열)은 호스트가 거부한다 — 화면을 우회해 곧장 보낸다.
    const short = await hsend('titleReorder', { names: after.slice(0, Math.max(1, after.length - 1)) });
    okq('C03 활성 하나를 빠뜨린 순서 저장은 거부', short.ok === false && MSG.stale.test(String(short.msg)), JSON.stringify(short.msg));

    rebase('C03 순서 저장이 활성 직급의 sort_order 를 10 간격으로 다시 매겼다 — 이 기능의 계약이다(끝에 시작값으로 되돌린다)');
  });

  /* ── C04 직급 숨김 거부 → 숨김 → 복구 ──────────────────────────────── */
  await runCase('C04', `직급 숨김 — 재직자가 있으면 거부 · 없으면 숨김 · 복구는 MAX+10`, async () => {
    if (titleRows(T.two) !== 1) { skip('C04', 'C02 가 직급을 남기지 못했다'); return; }
    //  ① zzU 직원 하나를 그 직급으로 만든다(직원 등록은 「구성원 편집」의 길 그대로다).
    const mk = await hsend('saveUser', {
      userId: 0, loginId: U.lid, name: U.lid, title: T.two,
      orgId: null, viewScope: 'self', editRole: 'viewer', includeInactive: false,
    });
    if (!okq('C04 시험 직원 등록(그 직급으로)', mk.ok === true, mk.msg)) return;
    U.uid = Number(s1(`SELECT user_id FROM app_user WHERE login_id=${esc(U.lid)}`, 'C04 시험 직원 id') || 0);
    if (!okq('C04 시험 직원이 DB 에 앉았다', U.uid > 0)) return;
    okq('C04 그 직원의 직급이 시험 직급이다', userTitle(U.lid) === T.two, userTitle(U.lid));
    rebase(`C04 가 시험 직원(${U.lid})을 만들었다 — zz 행이라 실행 수에는 안 들어가지만 기준을 다시 뜬다`);

    //  ② 화면 힌트: 재직자가 있으니 [숨김] 이 꺼지고 사유가 title 에 붙는다.
    await openOrgTitleByClick();
    await otTab('title');
    const row = await otRow(T.two);
    const hide = otBtn(row, 'hide');
    okq('C04 화면의 [숨김] 이 꺼져 있다', !!hide && hide.disabled === true, JSON.stringify(hide));
    okq('C04 꺼진 이유가 title 에 붙어 있다', !!hide && MSG.titleInUse.test(String(hide.title)), JSON.stringify(hide && hide.title));

    //  ③ 호스트 판정: 화면을 우회해도 같은 문장으로 거부한다(힌트와 판정이 갈리면 판정이 이긴다 · §4.1).
    const deny = await hsend('titleSetActive', { name: T.two, active: false });
    okq('C04 재직자가 있는 직급 숨김은 호스트가 거부', deny.ok === false && MSG.titleInUse.test(String(deny.msg)), JSON.stringify(deny.msg));
    okq('C04 거부 뒤에도 그 직급은 활성', titleActive(T.two) === '1');

    //  ④ 직원의 직급을 실 직급으로 되돌리면 숨길 수 있다.
    const realTitle = s1(`SELECT name FROM title_code WHERE is_active=1 AND name NOT LIKE 'zzJ%' ORDER BY sort_order, name LIMIT 1`, 'C04 실 직급');
    if (!realTitle) { skip('C04 숨김/복구', '되돌릴 실 직급이 없다'); return; }
    const mv = await hsend('saveUser', {
      userId: U.uid, loginId: U.lid, name: U.lid, title: realTitle,
      orgId: null, viewScope: 'self', editRole: 'viewer', includeInactive: false,
    });
    if (!okq('C04 시험 직원의 직급을 실 직급으로 되돌렸다', mv.ok === true, mv.msg)) return;
    okq('C04 DB 직원 직급이 바뀌었다', userTitle(U.lid) === realTitle, userTitle(U.lid));

    const off = await otsend('titleSetActive', { name: T.two, active: false });
    okq('C04 재직자 0명이 되자 숨김 성공', off.ok === true, off.msg);
    okq('C04 DB is_active=0', titleActive(T.two) === '0', String(titleActive(T.two)));
    //  이미 그 상태면 거부한다(복구가 순번을 새로 주기 때문 · §4.2).
    const again = await hsend('titleSetActive', { name: T.two, active: false });
    okq('C04 이미 숨김인데 또 숨기면 거부', again.ok === false && MSG.already.test(String(again.msg)), JSON.stringify(again.msg));

    //  ⑤ 화면: 「숨긴 값도 표시」를 켜면 [복구] 로 선다.
    await otShowHidden(true);
    const hrow = await otRow(T.two);
    okq('C04 숨긴 직급이 [복구] 버튼으로 선다', !!hrow && hrow.hidden === true && !!otBtn(hrow, 'show'),
      JSON.stringify(hrow && hrow.btns));

    //  ⑥ 복구 — sort_order 는 맨 뒤(MAX+10)로 새로 준다(활성끼리 겹치지 않게 · §4.2).
    const max0 = titleMax();
    const on = await otsend('titleSetActive', { name: T.two, active: true });
    okq('C04 복구 성공', on.ok === true, on.msg);
    okq('C04 DB is_active=1', titleActive(T.two) === '1', String(titleActive(T.two)));
    okq(`C04 복구 뒤 sort_order = MAX+10 (${max0}+10)`, titleSort(T.two) === max0 + 10, `실제 ${titleSort(T.two)}`);
    await otShowHidden(false);

    rebase('C04 복구가 MAX+10 을 새로 주었다(실행 행은 그대로) — 기준을 다시 뜬다');
  });

  /* ── C05 조직 추가 ─────────────────────────────────────────────────── */
  await runCase('C05', `조직 추가(${O.one}) — 상위 필수 · 형제 MAX+10`, async () => {
    if (!PARENT) { skip('C05', 'C00 이 상위로 쓸 조직을 고르지 못했다'); return; }
    //  ① 상위 없는 추가는 거부된다(화면은 [추가] 를 꺼 두지만, 호스트도 스스로 막아야 한다 · §3.2).
    const noParent = await hsend('unitAdd', { name: O.one, parentId: 0 });
    okq('C05 상위 없는 추가는 거부', noParent.ok === false && MSG.parentPick.test(String(noParent.msg)), JSON.stringify(noParent.msg));
    okq('C05 거부 뒤 DB 에 행이 없다', unitRows(O.one) === 0);

    //  ② 없는 상위도 거부된다.
    const ghost = await hsend('unitAdd', { name: O.one, parentId: 999999 });
    okq('C05 없는 상위로의 추가는 거부', ghost.ok === false && MSG.parentGone.test(String(ghost.msg)), JSON.stringify(ghost.msg));

    //  ③ 제대로 된 추가 — 형제 MAX+10.
    const max0 = siblingMax(PARENT.orgId);
    const rep = await otsend('unitAdd', { name: O.one, parentId: PARENT.orgId });
    if (!okq('C05 조직 추가 성공', rep.ok === true, rep.msg)) return;
    O.oneId = unitId(O.one);
    okq('C05 DB 에 행이 생겼다', O.oneId > 0);
    okq(`C05 parent_id = ${PARENT.orgId}(${PARENT.name})`, unitParent(O.oneId) === PARENT.orgId, String(unitParent(O.oneId)));
    okq(`C05 sort_order = 형제 MAX+10 (${max0}+10)`, unitSort(O.oneId) === max0 + 10, `실제 ${unitSort(O.oneId)}`);

    //  ④ 화면 — 소속 탭에 들여쓰기(깊이×16px)와 함께 선다.
    await otTab('unit');
    const row = await otRow(String(O.oneId));
    okq('C05 화면에 그 행이 섰다', !!row, '행이 없다 — otSeat 가 목록을 앉히지 못했다');
    okq('C05 들여쓰기가 상위보다 한 칸 깊다', !!row && row.pad === ((Number(PARENT.depth) + 1) * 16) + 'px',
      row ? `${row.pad} (상위 depth=${PARENT.depth})` : '행 없다');
    okq('C05 재직자 0 · 하위 0 이라 [숨김] 이 켜져 있다',
      !!otBtn(row, 'hide') && otBtn(row, 'hide').disabled === false, JSON.stringify(otBtn(row, 'hide')));

    //  ⑤ 중복 이름 거부.
    const dup = await hsend('unitAdd', { name: O.one, parentId: PARENT.orgId });
    okq('C05 같은 이름 재등록 거부', dup.ok === false && MSG.dupUnit.test(String(dup.msg)), JSON.stringify(dup.msg));
  });

  /* ── C06 조직 개명 ─────────────────────────────────────────────────── */
  await runCase('C06', `조직 개명(${O.one} → ${O.two} → ${O.one})`, async () => {
    if (!O.oneId) { skip('C06', 'C05 가 조직을 만들지 못했다'); return; }
    const p0 = unitParent(O.oneId), s0 = unitSort(O.oneId);
    const rep = await otsend('unitRename', { orgId: O.oneId, newName: O.two });
    if (!okq('C06 개명 성공', rep.ok === true, rep.msg)) return;
    okq('C06 DB 이름이 바뀌었다', unitName(O.oneId) === O.two, String(unitName(O.oneId)));
    okq('C06 번호·상위·순번은 그대로(소속자는 번호로 매달려 있다)',
      unitParent(O.oneId) === p0 && unitSort(O.oneId) === s0, `parent=${unitParent(O.oneId)} sort=${unitSort(O.oneId)}`);
    //  되돌린다 — 뒤 케이스가 O.one 이름을 쓰고, C08 이 zzO2 를 따로 만든다.
    const back = await otsend('unitRename', { orgId: O.oneId, newName: O.one });
    okq('C06 이름을 되돌렸다', back.ok === true && unitName(O.oneId) === O.one, back.msg);

    //  없는 조직을 고치면 낡은 목록으로 거부(§4.2).
    const gone = await hsend('unitRename', { orgId: 999999, newName: O.two });
    okq('C06 없는 조직 개명은 낡은 목록으로 거부', gone.ok === false && MSG.stale.test(String(gone.msg)), JSON.stringify(gone.msg));
  });

  /* ── C07 조직 순서(형제 안) ────────────────────────────────────────── */
  await runCase('C07', '조직 순서 — 같은 상위의 활성 형제끼리만 10 간격으로 다시 매겨진다', async () => {
    if (!O.oneId || !PARENT) { skip('C07', 'C05 가 조직을 만들지 못했다'); return; }
    const sibs = sql(`SELECT org_id FROM org_unit WHERE parent_id=${PARENT.orgId} AND is_active=1 ORDER BY sort_order, name`,
      { what: 'C07 형제 목록' }).map((r) => Number(r[0]));
    if (sibs.length < 2) { skip('C07', `형제가 ${sibs.length}개뿐이라 옮길 자리가 없다`); return; }
    const i = sibs.indexOf(O.oneId);
    if (i <= 0) { skip('C07', `${O.one} 이 형제 중 맨 앞이다(i=${i})`); return; }

    await otTab('unit');
    const clicked = await ev(`(function(){
      var bs = document.querySelectorAll('#otList [data-otop="up"]');
      for(var k=0;k<bs.length;k++){
        if(String(bs[k].dataset.otkey||'') !== ${J(String(O.oneId))}) continue;
        if(bs[k].disabled) return 'disabled';
        bs[k].click(); return 'clicked';
      }
      return 'notfound';
    })()`);
    if (!okq('C07 ▲ 버튼을 실제로 눌렀다', clicked === 'clicked', String(clicked))) return;
    const done = await waitPage((x) => x.otSaving === false && x.otBusyAttr === '', { timeout: 25000 });
    okq('C07 왕복이 끝났다(잠금 해제)', !!done);

    const after = sql(`SELECT org_id, sort_order FROM org_unit WHERE parent_id=${PARENT.orgId} AND is_active=1 ORDER BY sort_order`,
      { what: 'C07 저장 뒤 형제' }).map((r) => [Number(r[0]), Number(r[1])]);
    okq(`C07 ${O.one} 이 한 칸 앞으로 갔다`, after.findIndex((x) => x[0] === O.oneId) === i - 1,
      `실제 ${after.findIndex((x) => x[0] === O.oneId)}`);
    const want = after.map((_, k) => (k + 1) * 10);
    okq('C07 그 형제 집합이 10·20·30… 으로 전량 재작성됐다',
      JSON.stringify(after.map((x) => x[1])) === JSON.stringify(want), `실제 [${after.map((x) => x[1]).join(', ')}]`);

    //  낡은 목록 거부 — 형제 하나를 빠뜨린 배열.
    const short = await hsend('unitReorder', { parentId: PARENT.orgId, orgIds: after.slice(0, after.length - 1).map((x) => x[0]) });
    okq('C07 형제 하나를 빠뜨린 순서 저장은 거부', short.ok === false && MSG.stale.test(String(short.msg)), JSON.stringify(short.msg));

    rebase('C07 순서 저장이 그 상위의 활성 형제 sort_order 를 다시 매겼다 — 계약대로다(끝에 시작값으로 되돌린다)');
  });

  /* ── C08 상위 변경 · 순환 거부 · 최상위 거부 ───────────────────────── */
  await runCase('C08', '상위 변경 — 다른 본부로 이동 · 자손 밑으로는 순환 거부 · 최상위(NULL) 거부', async () => {
    if (!O.oneId || !PARENT || !TARGET) { skip('C08', '상위로 쓸 조직이 모자란다'); return; }

    //  ① 최상위(NULL)로는 못 옮긴다 — 루트는 하나뿐이다(§3.2).
    const root = await hsend('unitMove', { orgId: O.oneId, parentId: 0 });
    okq('C08 최상위로의 이동은 거부', root.ok === false && MSG.rootMove.test(String(root.msg)), JSON.stringify(root.msg));
    //  ② 자기 자신도 안 된다.
    const self = await hsend('unitMove', { orgId: O.oneId, parentId: O.oneId });
    okq('C08 자기 자신을 상위로 삼는 이동은 거부', self.ok === false && MSG.selfMove.test(String(self.msg)), JSON.stringify(self.msg));

    //  ③ 자손 하나를 만들어 **순환**을 시도한다(zzO 밑에 zzO2 → zzO 를 zzO2 밑으로).
    const mk = await otsend('unitAdd', { name: O.two, parentId: O.oneId });
    if (!okq(`C08 자식 조직(${O.two}) 추가`, mk.ok === true, mk.msg)) return;
    O.twoId = unitId(O.two);
    okq('C08 자식이 DB 에 앉았다', O.twoId > 0 && unitParent(O.twoId) === O.oneId, `parent=${unitParent(O.twoId)}`);
    const cyc = await hsend('unitMove', { orgId: O.oneId, parentId: O.twoId });
    okq('C08 자기 하위 밑으로의 이동은 순환으로 거부', cyc.ok === false && MSG.cycle.test(String(cyc.msg)), JSON.stringify(cyc.msg));
    okq('C08 거부 뒤 상위는 그대로', unitParent(O.oneId) === PARENT.orgId, String(unitParent(O.oneId)));

    //  ④ 화면의 [상위 변경] 후보에는 자기 자신도 자손도 없다(설계 §5.1).
    await otTab('unit');
    const opts = await evj(`(function(){
      var bs = document.querySelectorAll('#otList [data-otop="move"]');
      for(var k=0;k<bs.length;k++){
        if(String(bs[k].dataset.otkey||'') !== ${J(String(O.oneId))}) continue;
        bs[k].click();
        var row = null, rs = document.querySelectorAll('#otList .cust-row');
        for(var i=0;i<rs.length;i++) if(String(rs[i].dataset.otkey||'') === ${J(String(O.oneId))}) row = rs[i];
        var sel = row ? row.querySelector('select') : null;
        return JSON.stringify(sel ? Array.prototype.map.call(sel.options, function(o){ return String(o.value); }) : null);
      }
      return JSON.stringify(null);
    })()`);
    okq('C08 [상위 변경] 을 누르면 행 안에 <select> 가 선다', Array.isArray(opts), JSON.stringify(opts));
    if (Array.isArray(opts)) {
      okq('C08 후보에 자기 자신이 없다', !opts.includes(String(O.oneId)), opts.join(','));
      okq('C08 후보에 자기 자손이 없다', !opts.includes(String(O.twoId)), opts.join(','));
      okq(`C08 후보에 이동 목표(${TARGET.name})가 있다`, opts.includes(String(TARGET.orgId)), opts.join(','));
    }
    //  인라인 편집을 접어 둔다(다음 판정이 평소 행을 봐야 한다).
    await ev(`(function(){
      var bs = document.querySelectorAll('#otList [data-otop="cancel"]');
      for(var k=0;k<bs.length;k++) if(String(bs[k].dataset.otkey||'') === ${J(String(O.oneId))}){ bs[k].click(); return 1; }
      return 0;
    })()`);

    //  ⑤ 진짜 이동 — 소속자는 번호로 매달려 있어 통째로 따라온다(§3.2).
    const tmax = siblingMax(TARGET.orgId);
    const mv = await otsend('unitMove', { orgId: O.oneId, parentId: TARGET.orgId });
    if (!okq(`C08 ${TARGET.name} 밑으로 이동 성공`, mv.ok === true, mv.msg)) return;
    okq('C08 DB parent_id 가 바뀌었다', unitParent(O.oneId) === TARGET.orgId, String(unitParent(O.oneId)));
    okq(`C08 새 형제 맨 뒤로 간다(sort = ${tmax}+10)`, unitSort(O.oneId) === tmax + 10, `실제 ${unitSort(O.oneId)}`);
    okq('C08 자식은 번호로 따라온다(parent_id 그대로)', unitParent(O.twoId) === O.oneId, String(unitParent(O.twoId)));
    //  이미 그 상위면 거부한다(다시 걸면 자리가 소리 없이 밀린다 · §4.2).
    const again = await hsend('unitMove', { orgId: O.oneId, parentId: TARGET.orgId });
    okq('C08 이미 그 상위면 거부', again.ok === false && MSG.already.test(String(again.msg)), JSON.stringify(again.msg));

    rebase('C08 이동이 새 형제 집합의 맨 뒤 번호를 썼다 — 기준을 다시 뜬다');
  });

  /* ── C09 조직 숨김/복구 ────────────────────────────────────────────── */
  await runCase('C09', '조직 숨김 — 활성 하위가 있으면 거부 · 자식부터 숨김 · 복구', async () => {
    if (!O.oneId || !O.twoId) { skip('C09', 'C08 이 부모·자식을 남기지 못했다'); return; }

    //  ① 활성 하위가 있으면 숨길 수 없다(화면 힌트와 호스트 판정 둘 다).
    await otTab('unit');
    const row = await otRow(String(O.oneId));
    const hide = otBtn(row, 'hide');
    okq('C09 화면의 [숨김] 이 꺼져 있다(하위 1개)', !!hide && hide.disabled === true, JSON.stringify(hide));
    okq('C09 꺼진 이유가 title 에 붙어 있다', !!hide && MSG.unitInUse.test(String(hide.title)), JSON.stringify(hide && hide.title));
    const deny = await hsend('unitSetActive', { orgId: O.oneId, active: false });
    okq('C09 활성 하위가 있는 조직 숨김은 호스트가 거부', deny.ok === false && MSG.unitInUse.test(String(deny.msg)), JSON.stringify(deny.msg));
    okq('C09 거부 뒤에도 활성', unitActive(O.oneId) === '1');

    //  ② 최상위는 숨길 수 없다 — 루트를 찾아 곧장 눌러 본다(화면에는 그 사유가 title 로 붙어 있다).
    const rootId = Number(s1(`SELECT org_id FROM org_unit WHERE parent_id IS NULL ORDER BY sort_order LIMIT 1`, 'C09 루트') || 0);
    if (rootId) {
      const rdeny = await hsend('unitSetActive', { orgId: rootId, active: false });
      okq('C09 최상위 숨김은 거부', rdeny.ok === false && MSG.rootHide.test(String(rdeny.msg)), JSON.stringify(rdeny.msg));
      okq('C09 거부 뒤에도 루트는 활성', unitActive(rootId) === '1');
    } else {
      skip('C09 최상위 숨김 거부', '루트(parent_id IS NULL)를 찾지 못했다');
    }

    //  ③ 자식부터 숨기면 부모도 숨길 수 있다.
    const c = await otsend('unitSetActive', { orgId: O.twoId, active: false });
    okq('C09 자식 숨김 성공', c.ok === true, c.msg);
    okq('C09 자식 DB is_active=0', unitActive(O.twoId) === '0', String(unitActive(O.twoId)));
    const p = await otsend('unitSetActive', { orgId: O.oneId, active: false });
    okq('C09 부모 숨김 성공(활성 하위 0)', p.ok === true, p.msg);
    okq('C09 부모 DB is_active=0', unitActive(O.oneId) === '0', String(unitActive(O.oneId)));

    //  ④ 숨긴 부모 밑의 자식 복구는 거부된다(트리에 설 자리가 없다 · §4.2).
    const early = await hsend('unitSetActive', { orgId: O.twoId, active: true });
    okq('C09 상위가 숨김인 채로 자식만 복구하면 거부',
      early.ok === false && /상위 조직을 먼저 복구하세요/.test(String(early.msg)), JSON.stringify(early.msg));

    //  ⑤ 부모부터 복구 — 상위(TARGET)가 활성이라 받아 준다. sort 는 새 형제 맨 뒤.
    const tmax = siblingMax(TARGET ? TARGET.orgId : unitParent(O.oneId));
    const up = await otsend('unitSetActive', { orgId: O.oneId, active: true });
    okq('C09 부모 복구 성공', up.ok === true, up.msg);
    okq('C09 부모 DB is_active=1', unitActive(O.oneId) === '1', String(unitActive(O.oneId)));
    okq(`C09 복구 뒤 sort_order = 형제 MAX+10 (${tmax}+10)`, unitSort(O.oneId) === tmax + 10, `실제 ${unitSort(O.oneId)}`);
    //  자식도 이제 복구된다.
    const up2 = await otsend('unitSetActive', { orgId: O.twoId, active: true });
    okq('C09 상위가 살아난 뒤 자식 복구 성공', up2.ok === true, up2.msg);
    okq('C09 자식 DB is_active=1', unitActive(O.twoId) === '1', String(unitActive(O.twoId)));

    rebase('C09 숨김·복구가 형제 순번을 새로 주었다 — 기준을 다시 뜬다');
  });

  /* ── C10 비관리자 ──────────────────────────────────────────────────── */
  //  ★ 로그인 계정을 잠시 editor 로 내린다. **어떤 경로로 빠져나가든 되돌리고, 되돌렸다고 믿지 않고 읽는다.**
  await runCase('C10', '비관리자 — 문이 DOM 에서 사라지고, 조회는 admin:false, 쓰기는 거부', async () => {
    const admins = n1(`SELECT COUNT(*) FROM app_user WHERE edit_role='admin' AND is_active=1`, 'C10 활성 admin 수');
    if (admins < 1) { skip('C10', '활성 admin 이 없다'); return; }

    let restored = false;
    try {
      sql(`UPDATE app_user SET edit_role='editor' WHERE login_id=${esc(ME)}`,
        { readOnly: false, idempotent: true, what: 'C10 권한 강등' });
      rebase('C10 이 로그인 계정을 editor 로 내렸다 — 시험이 일부러 낸 변경이라 눈감는 대신 기준을 옮긴다');

      //  ① 진입 문이 **DOM 에서 사라진다**(숨김이 아니라 부재 · §5.0).
      //    '아직 안 생겼을 뿐'과 '나지 않는다'를 가르려고 기다려 본다 — 기다려도 안 나면 부재다.
      await ev(`(typeof closeModal==='function' && (closeModal('#orgTitleModal'), closeModal('#userAdminModal')), 1)`);
      await openMembers();
      const stillThere = await waitPage((x) => x.uaOrgTitle === true, { timeout: 6000 });
      okq('C10 「직급·소속 관리」 문이 비관리자 DOM 에 없다', !stillThere,
        '#uaOrgTitle 이 남아 있다 — 권한이 내려갔는데 문이 그대로다');
      await ev(`(typeof closeModal==='function' && closeModal('#userAdminModal'), 1)`);

      //  ② 버튼이 없다고 경로가 없는 것은 아니다 — 함수를 직접 불러 본다.
      const { data } = await orgTitleGet();
      okq('C10 orgTitleGet 은 여전히 found:true 로 답한다(권한 없음은 고장이 아니다)',
        !!(data && data.found === true), JSON.stringify(data));
      okq('C10 admin:false', !!(data && data.admin === false), JSON.stringify(data && data.admin));
      const lists = ['titles', 'units'].filter((k) => data && k in data);
      okq('C10 목록을 하나도 싣지 않는다', lists.length === 0, '실린 목록: ' + lists.join(', '));
      //  ★ 권한 부족(RoleOnly)에는 사유 문장을 싣지 않는 것이 계약이다 — 화면이 자기 문장을 갖고 있다.
      okq('C10 권한 부족에는 사유 문장을 싣지 않는다',
        !(data && typeof data.msg === 'string' && data.msg.length > 0), JSON.stringify(data && data.msg));

      //  ③ 화면도 컨트롤이 아니라 안내 한 줄이다(화면을 직접 열어 본다 — 버튼이 없으니 함수로).
      await ev(`openOrgTitle()`);
      const s = await waitPage((x) => x.otOpen && !x.otBusy, { timeout: 20000 });
      okq('C10 화면은 열리되 관리자 회신이 아니다', !!s && s.otAdmin === false, JSON.stringify(s && s.otAdmin));
      okq('C10 행도 행 버튼도 만들어지지 않는다(부재 계약)', !!s && s.rows === 0 && s.ops === 0,
        s ? `rows=${s.rows} ops=${s.ops}` : '상태 없음');
      okq('C10 안내 한 줄은 남는다(빈 화면은 고장으로 보인다)', !!s && s.hints === 1, s ? `hints=${s.hints}` : '상태 없음');
      await ev(`(typeof closeModal==='function' && closeModal('#orgTitleModal'), 1)`);

      //  ④ 관문 — 화면을 통째로 우회한 쓰기도 거부된다.
      const add = await hsend('titleAdd', { name: T.one + 'z' });
      okq('C10 쓰기 거부', add.ok === false, `ok=${add.ok}`);
      okq('C10 거부 문구가 관문 문장(USER-LOGIN §3.3)', MSG.denied.test(String(add.msg)), JSON.stringify(add.msg));
      okq('C10 그 직급은 만들어지지 않았다', titleRows(T.one + 'z') === 0);
    } finally {
      //  ★ 어떤 경로로 빠져나가든 되돌린다. 그리고 되돌렸다고 **믿지 않고 읽는다**.
      try { restored = restoreMe(ME); } catch (e) { restored = false; note('C10 복원 중 예외: ' + e.message); }
      if (!restored) {
        console.error(`\n★★ [치명] ${ME} 의 관리자 권한을 되돌리지 못했다. 지금 바로 수동 복원하세요:`);
        console.error(`    UPDATE app_user SET edit_role='admin', is_active=1 WHERE login_id='${ME}';\n`);
        ok('C10 로그인 계정 admin 복원', false, '복원 실패 — 위 SQL 로 수동 복원 필요');
        summary();
        process.exit(1);
      }
      okq('C10 로그인 계정 admin 복원 확인(DB 재조회)', true);
      rebase('C10 복원 — 기준을 강등 전으로 되돌린다');
      //  화면도 관리자 상태로 되돌려 둔다(다음 사람이 위젯을 그대로 쓸 수 있게).
      try {
        await ev(`loadUserPerm()`);
        await openMembers();
        await waitPage((x) => x.uaOrgTitle === true, { timeout: 15000 });
        await ev(`(typeof closeModal==='function' && closeModal('#userAdminModal'), 1)`);
      } catch (_) { }
    }
  });

  /* ── 종료 정리 + 전량 대조 ──────────────────────────────────────── */
  log('── 정리 ──');
  try { await ev(`(typeof closeModal==='function' && (closeModal('#orgTitleModal'), closeModal('#userAdminModal')), 1)`); } catch (_) { }

  //  정리 **전에** 화면이 무엇을 보고 있는지 본다 — sweep 이 지우고 나면 무엇을 남겼는지 알 수 없다.
  try {
    const { data } = await orgTitleGet();
    if (data && data.admin === true) {
      const zz = [...(data.titles || []).map((t) => String(t.name || '')),
                  ...(data.units || []).map((u) => String(u.name || ''))].filter((n) => /^zz/.test(n));
      note(`정리 전 회신의 zz 항목: ${zz.length ? zz.join(', ') : '(없음)'}`);
    }
  } catch (e) { note('종료 회신 확인 생략: ' + e.message); }

  cleanupAll('정상 종료');

  const end = dbSnap(ME, '종료 스냅샷');
  const left = zzLeft();
  okq('정리: zz 잔재 0(직급·조직·인력)', left === 0, `${left}건 남음`);
  okq(`정리: 세 표 실행 수가 시작과 같다(${countsKey(BASE.counts)})`,
    countsKey(end.counts) === countsKey(BASE.counts), `실제 ${countsKey(end.counts)}`);
  okq('정리: 실행 내용 해시가 시작과 같다(순번까지 되돌렸다)', end.hash === BASE.hash,
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
  console.log(`직급·소속 관리 루프 시험 요약 — 시드 ${OPT.seed} · 소요 ${secs.toFixed(1)}s` +
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
  console.log(`재현: node tests/loop-org-title.mjs --seed=${OPT.seed} --port=${OPT.port}`);
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
