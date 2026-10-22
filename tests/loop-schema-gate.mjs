#!/usr/bin/env node
/* ============================================================================
 *  tests/loop-schema-gate.mjs — 버전 관문(docs/VERSION-GATE.md) **실동작** 회귀 검증
 * ----------------------------------------------------------------------------
 *  2026-10-21 부터 뜻이 반대가 됐다(VERSION-GATE §5). 예전 명제는 "서버 스키마가 앞서면 전량 교체만 막히고
 *  통상 저장은 계속된다" 였다. 지금은 관문이 연결을 열 때마다 cal_schema_meta 를 읽고, 맞지 않으면 **읽기와 쓰기를
 *  모두** 막고 웹은 차단 카드(#vgGate)를 띄운다. 이 파일이 실제 위젯과 실제 DB 로 증명하는 것:
 *    [1] db_structure_version 을 앱보다 높이면: 업데이트 필요 카드, 편집 잠금, 통상 저장과 전량 교체 모두 관문이 거절(rev 그대로),
 *        웹의 저장 큐는 보내지도 않는다. 되돌리고 다시 확인(gateRecheck)하면 카드가 닫히고 다시 읽기(reloadState)는 한 번.
 *    [2] 앱보다 낮추면: 서버 갱신 전 카드(관리자 문의, 버튼 없음). 되돌리면 같은 길로 풀린다.
 *    [3] db_updating = '1' 이면: 갱신 중 카드(버튼 없음, 마지막 확인 줄). '0' 으로 되돌리면 **아무것도 누르지 않아도**
 *        약 35초 안에(호스트 30초 재확인 또는 웹 30초 재확인) 카드가 닫히고 다시 읽는다.
 *    [4] 끝: 정상 상태의 통상 저장이 다시 들어간다.
 *  테스트 데이터는 만들지 않는다(저장은 지금 화면의 state 를 그대로 보낸다, 데이터 불변). 새로 만들 일이 생기면 zz 접두어를 쓴다.
 *
 *  ⚠️ 이 시험은 **전역 행 cal_schema_meta(db_structure_version, db_updating)** 를 잠깐 바꾼다. 그 창 동안에는 이 DB 를 보는
 *    **모든** 위젯이 막힌다. 그래서 **테스트 DB 에서만** 돌리고, 끝나면(중단돼도) finally 에서 **시작할 때 실제로 읽은 값**으로
 *    되돌린다. 되돌림이 실패하면 마지막에 크게 경고한다.
 *
 *  ★★ 2026-09-09 사고(이 파일이 실 DB 를 강등시켰다)의 두 규칙은 그대로다. 타협 대상이 아니다:
 *      (1) 판본을 박지 않는다. 정본(db/deploy/schema-calendar.sql)에서 읽는다. 못 읽으면 중단.
 *      (2) **자기가 바꾼 적이 없으면 아무것도 쓰지 않는다**(touched 플래그). 되돌릴 때도 '정본 값'이 아니라
 *          **시작할 때 이 DB 에서 실제로 읽은 값**을 쓴다.
 *
 *  실행(run-loops 규약과 같다):
 *    TC_DEBUG_PORT=9222 로 위젯을 로그인된 채 띄운 뒤
 *    TC_TEST_DB_ADMIN_PW=… [TC_TEST_DB_NAME=taskcalendar] node tests/loop-schema-gate.mjs
 * ==========================================================================*/
import { spawnSync } from 'node:child_process';
import { canonSchemaVersion, CANON_PATH } from './canon-schema.mjs';

const PORT = Number(process.env.TC_DEBUG_PORT || 9222);
const MYSQL = process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe';
const PW = process.env.TC_TEST_DB_ADMIN_PW || '';
const USER = process.env.TC_TEST_DB_ADMIN_USER || 'root';
const DBNAME = process.env.TC_TEST_DB_NAME || 'taskcalendar';
if (!PW) { console.error('[중단] TC_TEST_DB_ADMIN_PW 가 없습니다.'); process.exit(2); }

/* ── 판본은 정본에서 읽는다(코드에 박지 않는다) ─────────────────────────
 *   CANON = 정본이 시딩하는 db_structure_version. 앱의 DbGate.AppStructureVersion 과 같아야 한다.
 *   HIGH / LOW = 불일치를 만들기 위한 주입값. 그때그때 CANON 에서 만든다(정본이 오르면 따라 오른다).
 *   ★ 읽지 못하면 통과가 아니라 중단이다. 값을 모르면 판정한 것이 아니다. */
let CANON, HIGH, LOW;
try {
  CANON = canonSchemaVersion();
  const n = Number(CANON);
  if (!Number.isInteger(n) || n <= 1) throw new Error(`정본의 db_structure_version 이 2 이상의 정수가 아니다('${CANON}')`);
  HIGH = String(n + 1);
  LOW = String(n - 1);
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
  const r = spawnSync(MYSQL, [`-u${USER}`, `-p${PW}`, DBNAME, '-N', '-B', '-e', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('SQL 실패: ' + (r.stderr || '').split('\n')[0]);
  return (r.stdout || '').trim();
}
const num = (sql) => Number(q(sql));
const meta = (k) => q(`SELECT v FROM cal_schema_meta WHERE k='${k}'`);
//  ★ touched — **한 번이라도 실제로 썼는가.** finally 는 이 플래그가 참일 때만 되돌린다(2026-09-09 사고의 직접 원인).
let touched = false;
const setMeta = (k, v) => { touched = true; return q(`UPDATE cal_schema_meta SET v='${v}' WHERE k='${k}'`); };

/* ── 최소 CDP ─────────────────────────────────────────────────────────── */
class Cdp {
  #ws = null; #id = 0; #p = new Map();
  static async attach(port) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json();
    const t = (list || []).filter(x => x.type === 'page' && x.webSocketDebuggerUrl)
      .find(x => /tcapp\.local/i.test(x.url || '') && !/peerwin=1|[?&]win=admin/.test(x.url || ''));   // 열람 창(?peerwin=1)은 메인 창이 아니다
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

//  카드 상태(차단이 아니면 'ok'). __vg 는 웹의 관문 상태다(task-calendar-prototype.html 「버전 관문 차단 카드」).
const gateState = (cdp) => cdp.ev(`(typeof vgBlocked === 'function' && vgBlocked()) ? __vg.state : 'ok'`);
async function waitGate(cdp, want, ms = 15000) {
  const t = Date.now();
  let last = '';
  while (Date.now() - t < ms) {
    last = await gateState(cdp);
    if (want.includes(last)) return { state: last, ms: Date.now() - t };
    await sleep(250);
  }
  throw new Error(`관문 카드가 ${want.join('/')} 가 되지 않았다(${ms}ms, 지금 '${last}')`);
}
//  다시 읽기(reloadState) 감시. hpost 를 감싸 세고, 부팅 주입(__applyState)이 새 meta 를 세웠는지 본다.
async function spyStart(cdp) {
  await cdp.ev(`(function(){
    if(!window.__lsgOrig) window.__lsgOrig = hpost;
    window.__lsgSent = [];
    hpost = function(m){ try{ window.__lsgSent.push(m && m.cmd); }catch(_){} return window.__lsgOrig(m); };
    window.__lsgMeta = __bootMeta;
    return 1;
  })()`);
}
const spySent = async (cdp) => JSON.parse(await cdp.ev(`JSON.stringify(window.__lsgSent || [])`));
async function spyStop(cdp) { await cdp.ev(`(function(){ if(window.__lsgOrig){ hpost = window.__lsgOrig; window.__lsgOrig = null; } return 1; })()`); }
async function waitReloaded(cdp, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await cdp.ev(`!!__bootMeta && __bootMeta !== window.__lsgMeta`)) return true;
    await sleep(250);
  }
  throw new Error(`다시 읽기(__applyState)가 오지 않았다(${ms}ms)`);
}
//  막힌 상태를 만든다: 서버 값을 바꾼 뒤 다시 읽기를 보내면 부팅 조회가 관문에 막히고, 호스트가 카드를 민다.
async function provoke(cdp) { await cdp.ev(`hpost({cmd:'reloadState'}); 1`); }
//  업데이트 필요, 서버 갱신 전은 호스트가 저절로 다시 보지 않는다(§2.5: 업데이트 필요는 재확인 없음, 서버 갱신 전은 5분).
//  값을 되돌린 뒤에는 관문 재확인 명령으로 바로 확인시킨다(카드의 재확인과 같은 명령).
const recheck = (cdp) => cdp.ev(`hostRequest('gateRecheck', {}, 15000).then(r => JSON.stringify(r))`);
const stateCopy = `JSON.parse(JSON.stringify(state))`;

const t0 = Date.now();
console.log('═'.repeat(72));
console.log('버전 관문 실동작 검증(업데이트 필요, 서버 갱신 전, 갱신 중) — 실제 위젯 · 실 DB');
console.log('═'.repeat(72));

let cdp;
let restored = true;
//  ★ 시작값은 try 바깥에 둔다. finally 가 되돌릴 값은 정본이 아니라 **이 DB 가 시작할 때 실제로 갖고 있던 값**이다.
let startVer = null, startUpd = null;
try {
  cdp = await Cdp.attach(PORT);

  /* ── 0. 전제 — 로그인, 정상 상태, 기준선 ─────────────────────────── */
  const login = await cdp.ev("(typeof currentUser !== 'undefined' && currentUser && currentUser.loginId) || ''");
  const U = num(`SELECT user_id FROM app_user WHERE login_id='${String(login).trim().replace(/'/g, "''")}'`);
  if (!U) throw new Error(`로그인 사용자를 찾지 못했다(login='${login}') — 위젯이 로그인된 상태여야 한다`);
  startVer = meta('db_structure_version');
  startUpd = meta('db_updating');
  console.log(`\n대상: login=${login} user_id=${U} · 시작 db_structure_version='${startVer}' db_updating='${startUpd}' · 정본 '${CANON}'`);
  if (startVer !== CANON || startUpd !== '0') {
    throw new Error(`시작 값이 정상이 아니다(db_structure_version='${startVer}' 정본='${CANON}', db_updating='${startUpd}') — ` +
                    '확인 후 재실행. (이 시험은 여기서 아무것도 쓰지 않고 끝난다)');
  }
  if ((await gateState(cdp)) !== 'ok') {
    await recheck(cdp);
    await waitGate(cdp, ['ok'], 10000);
  }
  await spyStart(cdp); await provoke(cdp); await waitReloaded(cdp); await spyStop(cdp);
  const appStruct = await cdp.ev(`(__bootMeta && __bootMeta.expectedSchema) || ''`);
  ok(`앱이 아는 구조 번호 = 정본 ${CANON}`, appStruct === CANON, `expectedSchema='${appStruct}'`);
  ok('시작 상태는 막히지 않았다(부팅 meta.gate = ok)', (await cdp.ev(`(__bootMeta && __bootMeta.gate) || ''`)) === 'ok');

  /* ── 1. 업데이트 필요 — 서버 구조 번호가 앱보다 높다 ───────────────── */
  console.log(`\n[1] 업데이트 필요 — db_structure_version 을 ${HIGH} 로(앱 ${CANON})`);
  setMeta('db_structure_version', HIGH);
  await provoke(cdp);
  //  지난 설치 실패 기록이 남아 있으면 같은 막힘이 installFailed 로 온다(Update.cs 의 update-attempt.json). 둘 다 업데이트 필요다.
  const g1 = await waitGate(cdp, ['needUpdate', 'installFailed']);
  ok('업데이트 필요 카드가 뜬다', g1.state === 'needUpdate' || g1.state === 'installFailed', `state=${g1.state} (${g1.ms}ms)`);
  const card1 = JSON.parse(await cdp.ev(`JSON.stringify({
    title:(document.getElementById('vgTitle')||{}).textContent||'',
    shown:!document.getElementById('vgGate').classList.contains('hidden'),
    on:document.body.classList.contains('vg-on'),
    hostbarInert:!!(document.getElementById('hostbar') && document.getElementById('hostbar').hasAttribute('inert')),
    locked:editLocked(), dbStructure: (__vg && __vg.dbStructure) || '' })`));
  ok('카드 제목', g1.state !== 'needUpdate' || card1.title === '새 버전이 필요합니다', card1.title);
  ok('카드가 보이고 뒤 화면을 흐린다', card1.shown && card1.on);
  ok('제목줄은 살아 있다(창 이동, 최소화, 닫기)', card1.hostbarInert === false);
  ok('편집이 잠긴다', card1.locked === true);
  ok(`카드가 서버 구조 번호 ${HIGH} 를 안다(자세한 정보)`, card1.dbStructure === HIGH, `dbStructure='${card1.dbStructure}'`);

  //  통상 저장도 막힌다(예전과 반대). 웹을 우회해 호스트에 직접 보내도 관문이 거절한다(진짜 방어).
  const rev1 = num(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`);
  const sv = JSON.parse(await cdp.ev(`hostRequest('saveState',{state:${stateCopy}},25000).then(r=>JSON.stringify(r))`));
  ok('통상 저장이 관문에 막힌다(kind gate)', sv.ok === false && sv.kind === 'gate' && sv.gate && sv.gate.state === 'needUpdate', JSON.stringify(sv).slice(0, 140));
  const ra = JSON.parse(await cdp.ev(`hostRequest('replaceAllState',{state:${stateCopy}},25000).then(r=>JSON.stringify(r))`));
  ok('전량 교체도 관문에 막힌다(kind gate)', ra.ok === false && ra.kind === 'gate', JSON.stringify(ra).slice(0, 140));
  ok('막힌 동안 rev 가 그대로다(아무것도 쓰지 않았다)', num(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`) === rev1);
  //  웹의 저장 큐는 보내지도 않는다(dbSave 가 막힘을 보고 멈춘다).
  await spyStart(cdp);
  const dq = await cdp.ev(`dbSave().then(r => r)`);
  ok('웹 저장 큐가 막힌 동안 보내지 않는다', dq === false && !(await spySent(cdp)).includes('saveState'), JSON.stringify(await spySent(cdp)));
  await spyStop(cdp);
  //  막힌 동안 오류 토스트가 쌓이지 않는다(카드가 사정을 말한다).
  ok('막힌 동안 오류 토스트가 없다', (await cdp.ev(`document.querySelectorAll('#toastStackErr .toast').length`)) === 0);

  console.log(`\n[1-복구] db_structure_version 을 ${startVer} 로 되돌리고 다시 확인`);
  setMeta('db_structure_version', startVer);
  await spyStart(cdp);
  const rc1 = JSON.parse(await recheck(cdp));
  ok('관문 재확인이 정상을 돌려준다', rc1.ok === true && rc1.state === 'ok', JSON.stringify(rc1));
  await waitGate(cdp, ['ok']);
  await waitReloaded(cdp);
  await sleep(1500);   // 뒤따르는 'ok' 푸시까지 기다린다(다시 읽기가 두 번 나가지 않는지 보려고)
  const sent1 = await spySent(cdp);
  await spyStop(cdp);
  ok('카드가 닫히고 다시 읽기는 한 번', sent1.filter(c => c === 'reloadState').length === 1, JSON.stringify(sent1));
  ok('편집 잠금이 풀린다', (await cdp.ev(`editLocked()`)) === false);

  /* ── 2. 서버 갱신 전 — 서버 구조 번호가 앱보다 낮다 ─────────────────── */
  console.log(`\n[2] 서버 갱신 전 — db_structure_version 을 ${LOW} 로(앱 ${CANON})`);
  setMeta('db_structure_version', LOW);
  await provoke(cdp);
  await waitGate(cdp, ['serverOld']);
  const card2 = JSON.parse(await cdp.ev(`JSON.stringify({ title:(document.getElementById('vgTitle')||{}).textContent||'',
    buttons: document.querySelectorAll('#vgGate .vg-card button').length })`));
  ok('서버 갱신 전 카드(관리자 문의)', card2.title === '서버 갱신 전입니다', card2.title);
  ok('서버 갱신 전 카드에는 버튼이 없다', card2.buttons === 0, `buttons=${card2.buttons}`);
  const sv2 = JSON.parse(await cdp.ev(`hostRequest('saveState',{state:${stateCopy}},25000).then(r=>JSON.stringify(r))`));
  ok('서버 갱신 전에도 통상 저장이 막힌다', sv2.ok === false && sv2.kind === 'gate', JSON.stringify(sv2).slice(0, 120));
  setMeta('db_structure_version', startVer);
  await spyStart(cdp);
  await recheck(cdp);
  await waitGate(cdp, ['ok']);
  await waitReloaded(cdp);
  await spyStop(cdp);
  ok('되돌리면 카드가 닫힌다', (await gateState(cdp)) === 'ok');

  /* ── 3. 갱신 중 — db_updating = '1' ─────────────────────────────── */
  console.log("\n[3] 갱신 중 — db_updating 을 '1' 로");
  setMeta('db_updating', '1');
  await provoke(cdp);
  await waitGate(cdp, ['updating']);
  const card3 = JSON.parse(await cdp.ev(`JSON.stringify({ title:(document.getElementById('vgTitle')||{}).textContent||'',
    status:(document.getElementById('vgStatusText')||{}).textContent||'',
    buttons: document.querySelectorAll('#vgGate .vg-card button').length })`));
  ok('갱신 중 카드', card3.title === '서버를 갱신하고 있습니다', card3.title);
  ok('마지막 확인 줄(30초마다)', /^마지막 확인 \d\d:\d\d, 30초마다 다시 확인$/.test(card3.status), card3.status);
  ok('갱신 중 카드에는 버튼이 없다', card3.buttons === 0);
  console.log("    db_updating 을 '0' 으로 되돌리고 아무것도 누르지 않은 채 기다린다(최대 40초)");
  await spyStart(cdp);
  setMeta('db_updating', '0');
  const back = await waitGate(cdp, ['ok'], 40000);
  ok('저절로 풀린다(약 35초 안)', back.ms <= 36000, `${(back.ms / 1000).toFixed(1)}초`);
  await waitReloaded(cdp);
  await sleep(1500);
  const sent3 = await spySent(cdp);
  await spyStop(cdp);
  ok('풀린 뒤 다시 읽기는 한 번', sent3.filter(c => c === 'reloadState').length === 1, JSON.stringify(sent3));

  /* ── 4. 끝 — 정상 상태의 통상 저장 ──────────────────────────────── */
  console.log('\n[4] 정상 상태로 돌아왔다');
  const rev4 = num(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`);
  const sv4 = JSON.parse(await cdp.ev(`hostRequest('saveState',{state:${stateCopy}},25000).then(r=>JSON.stringify({ok:r.ok,del:r.del,kind:r.kind||''}))`));
  ok('통상 저장이 다시 들어간다', sv4.ok === true, JSON.stringify(sv4));
  ok('저장이 데이터를 지우지 않았다(del=0)', sv4.del === 0);
  ok('rev 가 올랐다(진짜 커밋)', num(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`) > rev4);
  ok('카드 없음, 편집 가능', (await gateState(cdp)) === 'ok' && (await cdp.ev(`editLocked()`)) === false);

} catch (e) {
  fail++; F.push('중단: ' + e.message);
  console.log('\n[중단] ' + e.message);
} finally {
  //  ★ 되돌림의 두 규칙(2026-09-09): 안 바꿨으면 안 쓴다(touched), 되돌릴 값은 시작할 때 읽은 값이다.
  if (touched && startVer !== null && startUpd !== null) {
    try {
      setMeta('db_structure_version', startVer);
      setMeta('db_updating', startUpd);
      restored = (meta('db_structure_version') === startVer) && (meta('db_updating') === startUpd);
    } catch (e) { restored = false; F.push('복구 실패: ' + e.message); }
    //  위젯이 막힌 채로 남지 않게 한 번 다시 확인시킨다(업데이트 필요는 호스트가 저절로 다시 보지 않는다).
    if (cdp && restored) {
      try { await cdp.ev(`(function(){ if(window.__lsgOrig){ hpost = window.__lsgOrig; window.__lsgOrig = null; } return 1; })()`); } catch { }
      try { await recheck(cdp); } catch { }
    }
  }
  if (cdp) cdp.close();
}

console.log('\n' + '═'.repeat(72));
console.log(`통과 ${pass} · 실패 ${fail} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
if (F.length) { console.log('\n실패 목록:'); F.forEach(f => console.log('  · ' + f)); }
//  ★ 안내문에도 판본을 박지 않는다(시작할 때 읽은 값만 쓴다).
if (!restored) {
  console.log(`\n★★ 경고: cal_schema_meta 를 시작 값으로 되돌리지 못했습니다 — 수동으로 되돌리세요:\n` +
              `   UPDATE cal_schema_meta SET v='${startVer}' WHERE k='db_structure_version';\n` +
              `   UPDATE cal_schema_meta SET v='${startUpd}' WHERE k='db_updating';`);
}
console.log((fail === 0 && restored)
  ? '버전 관문 실동작 검증 통과 ✓'
  : '★ 실패 — 배포 전에 고칠 것.');
console.log('═'.repeat(72));
process.exit((fail === 0 && restored) ? 0 : 1);
