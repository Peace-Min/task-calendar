#!/usr/bin/env node
/* ============================================================================
 *  tests/loop-schema-gate.mjs — P1-1·P1-2·P1-8 **실동작** 회귀 검증
 * ----------------------------------------------------------------------------
 *  증명하는 명제(f6d6c2d 로 넣은 셋을, 다음 빌드가 스스로 재증명하게):
 *    P1-1  서버 스키마가 위젯보다 앞서면, **전량 교체(가져오기·초기화)만** 막히고
 *          통상 저장·조회는 계속된다(§5.5). 배지·웹 게이트·호스트 게이트 삼중.
 *    P1-2  부팅 실패가 오면 위젯이 15·30·60초로 **스스로 다시 붙고**, 성공하면
 *          빨간 상자·타이머를 함께 걷는다. 로그인 없음·미등록(retryable=false)은
 *          자동 재시도하지 않는다.
 *    P1-8  네이티브 파일창으로 고른 원본만 이관 뒤 개명한다. **pick 없이 온**
 *          전량 교체(전체 초기화·이 테스트의 CDP 호출)는 개명하지 않는다
 *          (`_lastImportPath` null 가드).
 *
 *  왜 이 파일이 필요한가:
 *    이 셋은 만들 때 CDP 로 실위젯 검증했지만 그 검증이 **일회성 스크래치**였다.
 *    지금 게이트(run-tests.mjs)는 소스 대조 + 순수 로직만 본다 — 부팅 경로·스키마
 *    비교·배지처럼 **실행돼야 드러나는** 것은 아무도 다시 확인하지 않는다.
 *
 *  ★ 네이티브 파일 대화상자로 고른 원본의 **실개명**은 이 시험의 범위 밖이다
 *    (모달이라 자동화가 창 조작을 요구 — loop-import-ui 의 ⑦-2 판단과 같다).
 *    그 leg 은 계약 테스트 data-source ⑨ 가 소스로 잠그고, 실개명은 2026-09-03
 *    수기 확인(호스트 로그: "가져오기 원본 개명: … → …migrated-…")으로 증명됐다.
 *    여기서는 그 반대편 — **pick 없는 전량 교체가 개명하지 않는다** — 를 돈다.
 *
 *  ⚠️ 이 시험은 **전역 행 `cal_schema_meta.schema_version` 을 잠깐 올려 둔다**(정본보다 큰 값).
 *    그 창 동안에는 이 DB 를 보는 **모든** 위젯이 전량 교체를 거부한다. 그래서
 *    **테스트 DB 에서만** 돌리고, 끝나면(중단돼도) finally 에서 **시작할 때 실제로 읽은 값**으로
 *    되돌린다. 되돌림이 실패하면 마지막에 크게 경고한다.
 *
 *  ★★ 2026-09-09 사고 — 이 파일이 실 DB 를 강등시켰다. 반드시 읽을 것:
 *    정본이 8 → 9 로 올랐는데 이 시험은 '8' 을 코드에 박아 두고 있었다. v9 DB 에서 돌리자
 *    선행조건 검사가 **아무것도 바꾸지 않은 채** 중단했는데, finally 가 무조건 '8' 을 써서
 *    schema_version 이 9 → 8 로 **강등**됐다(구조는 v9 그대로). 그 상태의 DB 를 보는 위젯은
 *    전량 교체(가져오기·초기화)를 계속 거부한다. 폐쇄망이었다면 89대가 그 상태가 된다.
 *    그래서 이 파일의 두 가지 규칙은 타협 대상이 아니다:
 *      (1) 판본을 박지 않는다 — 정본(db/deploy/schema-calendar.sql)에서 읽는다. 못 읽으면 중단.
 *      (2) **자기가 바꾼 적이 없으면 아무것도 쓰지 않는다**(touched 플래그). 되돌릴 때도
 *          '정본 값'이 아니라 **시작할 때 이 DB 에서 실제로 읽은 값**을 쓴다.
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 로그인된 채 띄운 뒤
 *    TC_TEST_DB_ADMIN_PW=… node tests/loop-schema-gate.mjs
 * ==========================================================================*/
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { canonSchemaVersion, CANON_PATH } from './canon-schema.mjs';

const PORT = Number(process.env.TC_DEBUG_PORT || 9222);
const MYSQL = process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe';
const PW = process.env.TC_TEST_DB_ADMIN_PW || '';
const USER = process.env.TC_TEST_DB_ADMIN_USER || 'root';
const DATA = (process.env.APPDATA || '').replace(/\\/g, '/') + '/TaskCalendar';
if (!PW) { console.error('[중단] TC_TEST_DB_ADMIN_PW 가 없습니다.'); process.exit(2); }

/* ── 판본은 정본에서 읽는다(코드에 박지 않는다) ─────────────────────────
 *   CANON     = 정본이 시딩하는 schema_version. 위젯의 ExpectedSchemaVersion 과 같아야 한다.
 *   MISMATCH  = **불일치를 만들기 위한** 주입값. '9' 같은 고정값이면 정본이 9 로 오르는 순간
 *               "서버가 앞선다"가 성립하지 않아 이 시험 전체가 조용히 무의미해진다.
 *               그래서 CANON 보다 확실히 큰 값으로 그때그때 만든다.
 *   ★ 읽지 못하면 통과가 아니라 중단이다 — 값을 모르면 판정한 것이 아니다. */
let CANON, MISMATCH;
try {
  CANON = canonSchemaVersion();
  const n = Number(CANON);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`정본의 schema_version 이 정수가 아니다('${CANON}') — 불일치 주입값을 만들 수 없다`);
  }
  MISMATCH = String(n + 1);
} catch (e) {
  console.error(`[중단] 정본 판본을 읽지 못했습니다(${CANON_PATH}): ` + e.message);
  process.exit(2);
}

let pass = 0, fail = 0; const F = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`); }
  else { fail++; F.push(n + (d ? ' — ' + d : '')); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); }
};

function q(sql) {
  const r = spawnSync(MYSQL, [`-u${USER}`, `-p${PW}`, 'taskmgr', '-N', '-B', '-e', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('SQL 실패: ' + (r.stderr || '').split('\n')[0]);
  return (r.stdout || '').trim();
}
const num = (sql) => Number(q(sql));
const schemaVer = () => q("SELECT v FROM cal_schema_meta WHERE k='schema_version'");
//  ★ touched — **한 번이라도 실제로 썼는가.** finally 는 이 플래그가 참일 때만 복구를 시도한다.
//    2026-09-09 사고의 직접 원인이 이것이 없었던 것이다: 선행조건에서 중단해 아무것도 안 바꿨는데도
//    finally 가 하드코딩 값을 써서 실 DB 를 강등시켰다. 안 바꿨으면 되돌릴 것도 없다.
let touched = false;
const setSchemaVer = (v) => { touched = true; return q(`UPDATE cal_schema_meta SET v='${v}' WHERE k='schema_version'`); };

/* ── 최소 CDP ─────────────────────────────────────────────────────────── */
class Cdp {
  #ws = null; #id = 0; #p = new Map();
  static async attach(port) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json();
    const t = (list || []).filter(x => x.type === 'page' && x.webSocketDebuggerUrl)
      .find(x => /tcapp\.local/i.test(x.url || ''));
    if (!t) throw new Error(`CDP page 타겟이 없습니다(포트 ${port}) — 위젯을 TC_DEBUG_PORT=${port} 로 띄웠나요?`);
    const c = new Cdp();
    const ws = new WebSocket(t.webSocketDebuggerUrl); c.#ws = ws;
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('WS 시간 초과')), 10000);
      ws.addEventListener('open', () => { clearTimeout(to); res(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(to); rej(new Error('WS 실패')); }, { once: true });
    });
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id == null) return;
      const p = c.#p.get(m.id); if (!p) return;
      c.#p.delete(m.id); clearTimeout(p.to);
      m.error ? p.rej(new Error('CDP: ' + m.error.message)) : p.res(m.result);
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { this.#p.delete(id); rej(new Error('CDP 시간 초과: ' + method)); }, 60000);
      this.#p.set(id, { res, rej, to });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('페이지 JS 예외: ' + String((d.exception && (d.exception.description || d.exception.value)) || d.text));
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.#ws.close(); } catch { } }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

//  reloadState 는 회신이 없는 명령이라(설계 §3.6) rev 나 부팅 meta 로 '끝났음'을 기다린다.
//  부팅 조회는 트랜잭션 안에서 schema_version 을 다시 읽으므로, 서버 값을 바꾼 뒤
//  reloadState 를 보내면 이 조건으로 새 스냅샷 도착을 확인할 수 있다.
async function waitBootSchema(cdp, want, ms = 12000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await cdp.ev(`(__bootMeta && __bootMeta.schemaVersion) || ''`);
    if (String(v) === String(want)) return true;
    await sleep(250);
  }
  throw new Error(`부팅 meta.schemaVersion 이 ${want} 가 되지 않았다(${ms}ms)`);
}
const migratedFiles = () => { try { return readdirSync(DATA).filter(f => /\.migrated-\d{8}(-\d+)?$/.test(f)); } catch { return []; } };

const t0 = Date.now();
console.log('═'.repeat(72));
console.log('스키마 게이트·부팅 재시도·개명 가드 실동작 검증 — 실제 위젯 · 실 DB');
console.log('═'.repeat(72));

let cdp;
let restored = true;   // finally 에서 schema_version 되돌림 성공 여부
//  ★ startVer 를 try 바깥에 둔다 — finally 가 되돌릴 값은 '정본'이 아니라 **이 DB 가 시작할 때
//    실제로 갖고 있던 값**이다. 그래야 정본과 어긋난 DB 를 만나도 시험이 그 상태를 바꾸지 않는다.
let startVer = null;
try {
  cdp = await Cdp.attach(PORT);

  /* ── 0. 전제 — 로그인·정상 스키마·기준선 ─────────────────────────── */
  const login = await cdp.ev("(typeof currentUser !== 'undefined' && currentUser && currentUser.loginId) || ''");
  const U = num(`SELECT user_id FROM app_user WHERE login_id='${String(login).trim().replace(/'/g, "''")}'`);
  if (!U) throw new Error(`로그인 사용자를 찾지 못했다(login='${login}') — 위젯이 로그인된 상태여야 한다`);
  startVer = schemaVer();
  console.log(`\n대상: login=${login} user_id=${U} · 시작 schema_version='${startVer}' · 정본 '${CANON}'`);
  if (startVer !== CANON) {
    throw new Error(`시작 schema_version 이 정본과 다르다(DB='${startVer}' · 정본='${CANON}', ${CANON_PATH}) — ` +
                    '정본과 어긋난 DB 다. 확인 후 재실행. (이 시험은 여기서 아무것도 쓰지 않고 끝난다)');
  }
  // 위젯이 아는 판본(CalendarDb.ExpectedSchemaVersion)을 부팅 meta 로 읽는다.
  await cdp.ev(`hpost({cmd:'reloadState'}); 1`); await waitBootSchema(cdp, CANON);
  const WIDGET = await cdp.ev(`(__bootMeta && __bootMeta.expectedSchema) || ''`);
  ok(`위젯이 아는 스키마 판본 = 정본 ${CANON}`, WIDGET === CANON, `expectedSchema='${WIDGET}' 정본='${CANON}'`);
  ok('시작 상태는 불일치 아님', (await cdp.ev(`!!(__bootMeta && __bootMeta.schemaMismatch)`)) === false);

  /* ── 1. P1-1 낡은 클라이언트 게이트 (서버가 위젯보다 앞선다) ─────── */
  console.log(`\n[1] P1-1 — 서버 스키마를 ${MISMATCH} 로 올린다(위젯은 ${CANON})`);
  setSchemaVer(MISMATCH);
  await cdp.ev(`hpost({cmd:'reloadState'}); 1`); await waitBootSchema(cdp, MISMATCH);

  //  배지 문구 대조 — 판본은 숫자뿐이라 정규식 이스케이프는 필요 없다(위에서 정수임을 확인했다).
  //  ★ 뒤에 (?!\d) 를 붙인다 — 'v1' 이 'v10' 에 걸리면 판본이 오른 날 이 검사가 조용히 통과한다.
  const badge = await cdp.ev(`(document.getElementById('dsBadge')||{}).textContent || ''`);
  ok(`배지가 경고 문구로 바뀐다(서버 v${MISMATCH} · 위젯 v${CANON} · 차단)`,
     new RegExp(`서버 스키마 v${MISMATCH}(?!\\d)`).test(badge) && new RegExp(`위젯 v${CANON}(?!\\d)`).test(badge)
     && /차단/.test(badge), badge.slice(0, 90));
  ok('부팅 meta.schemaMismatch = true', (await cdp.ev(`!!__bootMeta.schemaMismatch`)) === true);

  //  웹 게이트 — startImport() 가 pickImportXml 을 아예 보내지 않는다(schemaBlocked).
  const capImport = await cdp.ev(`(function(){
    const o = hpost, sent = [];
    hpost = function(m){ sent.push(m && m.cmd); return o(m); };
    try { startImport(); } finally { hpost = o; }
    return JSON.stringify(sent);
  })()`);
  ok('웹 게이트: startImport() 가 pickImportXml 을 안 보낸다', !/pickImportXml/.test(capImport), '발신=' + capImport);

  //  호스트 게이트 — 웹을 우회해 직접 replaceAllState 를 쳐도 쓰기 계층이 거부한다(진짜 방어).
  const repRej = await cdp.ev(`hostRequest('replaceAllState',{state:JSON.parse(JSON.stringify(state))},25000).then(r=>JSON.stringify(r))`);
  ok(`호스트 게이트: replaceAllState 거부(ok:false·schemaMismatch:true·v${MISMATCH} 명시)`,
     /"ok":false/.test(repRej) && /"schemaMismatch":true/.test(repRej)
     && new RegExp(`v${MISMATCH}(?!\\d)`).test(repRej), repRej.slice(0, 120));

  //  통상 저장은 §5.5 대로 **허용** — 전 쓰기 봉인이 아니다(같은 state 라 데이터 불변, upd 만).
  const revBefore = num(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`);
  const savOk = await cdp.ev(`hostRequest('saveState',{state:JSON.parse(JSON.stringify(state))},25000).then(r=>JSON.stringify({ok:r.ok,del:r.del}))`);
  ok('통상 저장은 허용된다(§5.5 — 낡아도 조회·편집은 계속)', /"ok":true/.test(savOk), savOk);
  ok('통상 저장이 데이터를 지우지 않았다(del=0)', /"del":0/.test(savOk));
  ok('통상 저장으로 rev 가 올랐다(진짜 커밋)', num(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`) > revBefore);

  /* ── 2. P1-1 복구 — 서버를 시작값으로 되돌리면 게이트가 풀린다 ───── */
  console.log(`\n[2] P1-1 복구 — 서버를 ${startVer} 로`);
  setSchemaVer(startVer); restored = (schemaVer() === startVer);
  await cdp.ev(`hpost({cmd:'reloadState'}); 1`); await waitBootSchema(cdp, startVer);
  ok('되돌리면 불일치 해제', (await cdp.ev(`!!__bootMeta.schemaMismatch`)) === false);
  ok('배지가 정상 문구로 복귀', /DB 연결됨/.test(await cdp.ev(`(document.getElementById('dsBadge')||{}).textContent||''`)));
  const repOk = await cdp.ev(`hostRequest('replaceAllState',{state:JSON.parse(JSON.stringify(state))},25000).then(r=>r.ok)`);
  ok(`v${startVer} 에서는 전량 교체가 다시 통과한다`, repOk === true);

  /* ── 3. P1-8 개명 가드 — pick 없는 전량 교체는 개명하지 않는다 ───── */
  console.log('\n[3] P1-8 — pick 없이 온 전량 교체는 원본을 개명하지 않는다');
  const before = migratedFiles().length;
  const rn = await cdp.ev(`hostRequest('replaceAllState',{state:JSON.parse(JSON.stringify(state))},25000).then(r=>JSON.stringify({ok:r.ok,renamedTo:r.renamedTo,renameError:r.renameError}))`);
  ok('CDP 전량 교체가 성공한다', /"ok":true/.test(rn), rn);
  ok('renamedTo 가 비어 있다(_lastImportPath null 가드)', /"renamedTo":""/.test(rn));
  ok('renameError 도 비어 있다', /"renameError":""/.test(rn));
  ok('데이터 폴더에 새 .migrated 파일이 생기지 않았다', migratedFiles().length === before, `migrated ${before}→${migratedFiles().length}`);

  /* ── 4. P1-2 부팅 실패 재시도 (실 WebView2, DB 무관) ────────────── */
  console.log('\n[4] P1-2 — 부팅 실패 자동 백오프 + 수동/자동 구분');
  const t1 = await cdp.ev(`window.__applyStateError('테스트: 연결 실패', {retryable:true}); (document.getElementById('dsErrorText')||{}).textContent || ''`);
  ok('실패 직후 15초 카운트다운 (1/3)', /15초 후 자동 재시도 \(1\/3\)/.test(t1), t1.slice(-40));
  ok('재시도 타이머가 대기 중', (await cdp.ev(`JSON.stringify(__bootRetry && __bootRetry.state())`)).includes('"pending":true'));
  await sleep(1300);
  ok('1초 뒤 남은 초가 준다(14초)', /14초 후/.test(await cdp.ev(`(document.getElementById('dsErrorText')||{}).textContent||''`)));
  const t3 = await cdp.ev(`document.getElementById('dsErrorRetry').click(); (document.getElementById('dsErrorText')||{}).textContent || ''`);
  ok('[다시 시도] → 서버에 연결 중…', /서버에 연결 중/.test(t3));
  await waitBootSchema(cdp, startVer);   // 수동 재시도가 진짜 재부팅을 일으켰다(성공)
  await sleep(300);
  const afterOk = await cdp.ev(`JSON.stringify({box:!!document.getElementById('dsError'), st: __bootRetry.state()})`);
  ok('부팅 성공 → 상자 제거·타이머 해제·카운터 리셋',
     /"box":false/.test(afterOk) && /"pending":false/.test(afterOk) && /"attempt":0/.test(afterOk), afterOk);

  const t4 = await cdp.ev(`window.__applyStateError('테스트: 로그인 없음', {retryable:false}); JSON.stringify({txt:(document.getElementById('dsErrorText')||{}).textContent||'', st: __bootRetry.state()})`);
  ok('retryable:false → 자동 재시도 없음(수동 안내만)',
     /확인한 뒤 \[다시 시도\]/.test(t4) && /"pending":false/.test(t4), t4.slice(0, 90));

  //  화면을 실제 데이터로 되돌린다 — 에러 상자를 띄운 채로 끝내지 않는다.
  await cdp.ev(`document.getElementById('dsErrorRetry').click(); 1`); await waitBootSchema(cdp, startVer); await sleep(300);
  ok('마무리: 에러 상자 없음·화면 복구', (await cdp.ev(`!document.getElementById('dsError') && !!(state && state.entries)`)) === true);

} catch (e) {
  fail++; F.push('중단: ' + e.message);
  console.log('\n[중단] ' + e.message);
} finally {
  //  ★ 되돌림의 두 규칙(2026-09-09 강등 사고의 직접 원인이 이 두 줄이 없었던 것이다):
  //    (1) **안 바꿨으면 안 쓴다.** touched 가 거짓이면 이 DB 는 이 시험이 손대지 않은 것이다 —
  //        선행조건에서 중단한 경우가 그렇다. 그때 '정상값'이라고 믿는 것을 써 넣는 순간
  //        시험이 아니라 마이그레이션이 된다.
  //    (2) 되돌릴 값은 **시작할 때 이 DB 에서 읽은 값**이다. 코드에 박은 값도, 정본 값도 아니다.
  if (touched && startVer !== null) {
    try { setSchemaVer(startVer); restored = (schemaVer() === startVer); }
    catch (e) { restored = false; F.push('복구 실패: ' + e.message); }
  }
  if (cdp) cdp.close();
}

console.log('\n' + '═'.repeat(72));
console.log(`통과 ${pass} · 실패 ${fail} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
if (F.length) { console.log('\n실패 목록:'); F.forEach(f => console.log('  · ' + f)); }
//  ★ 안내문에도 판본을 박지 않는다 — 사람이 그대로 따라 치는 문장이라, 낡은 값이 박혀 있으면
//    안내문 자체가 DB 를 강등시킨다(2026-09-09 사고의 재발 경로가 정확히 여기다).
if (!restored) {
  console.log(`\n★★ 경고: schema_version 을 '${startVer}'(시작할 때 읽은 값) 로 되돌리지 못했습니다 — 수동으로 되돌리세요:\n` +
              `   UPDATE cal_schema_meta SET v='${startVer}' WHERE k='schema_version';`);
}
console.log((fail === 0 && restored)
  ? '스키마 게이트·부팅 재시도·개명 가드 검증 통과 ✓'
  : '★ 실패 — 배포 전에 고칠 것.');
console.log('═'.repeat(72));
process.exit((fail === 0 && restored) ? 0 : 1);
