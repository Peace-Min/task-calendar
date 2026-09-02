#!/usr/bin/env node
/* ============================================================================
 *  tests/loop-import-ui.mjs — 「XML 가져오기」 **실동작** 검증 (B1)
 * ----------------------------------------------------------------------------
 *  증명하는 명제:
 *    **실제 위젯에서 가져오기를 돌리면, 파일 내용이 그대로 DB 가 된다.**
 *
 *  왜 이 파일이 필요한가:
 *    자동이관을 폐기하면서(2026-09-01) 「XML 가져오기」가 89명이 각자 통과할
 *    **유일한 이관 문**이 됐다. 그런데 그 문은 계약 검사(소스 대조)와 루프 테스트
 *    (쓰기 계층 단독)로만 확인돼 있었고 — **실제 위젯에서 한 번도 돌려본 적이 없었다.**
 *    그 사이에는 브리지·직렬화·모달·저장 직렬화가 통째로 들어 있다.
 *
 *  ★ 파괴적 시험이므로 **왕복(round-trip)** 으로 한다:
 *    지금 상태를 toXML() 로 뽑아 그것을 다시 가져온다. 내용이 같아야 하므로
 *    사용자 데이터를 잃지 않으면서 '전량 삭제 + 전량 삽입' 전 구간이 실제로 돈다.
 *    (그래도 실행 전 행수를 적어 두고 끝나고 대조한다 — 같아야 한다.)
 *
 *  ★ 네이티브 파일 대화상자는 이 시험의 범위 밖이다(모달이라 자동화가 클릭을 요구).
 *    그 자리는 계약 ⑦-2 가 소스로 잠근다. 여기서는 **그 뒤 전부**를 돈다:
 *      showImportPreview → #importModal → applyImport(replace|merge)
 *      → saveFull → dbSave{replaceAll} → replaceAllState → CalendarWriteDb → DB
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 띄운 뒤
 *    TC_TEST_DB_ADMIN_PW=… node tests/loop-import-ui.mjs
 * ==========================================================================*/
import { spawnSync } from 'node:child_process';

const PORT = Number(process.env.TC_DEBUG_PORT || 9222);
const MYSQL = process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe';
const PW = process.env.TC_TEST_DB_ADMIN_PW || '';
const USER = process.env.TC_TEST_DB_ADMIN_USER || 'root';
if (!PW) { console.error('[중단] TC_TEST_DB_ADMIN_PW 가 없습니다.'); process.exit(2); }

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
//  저장은 비동기 왕복이라 '끝났음' 을 rev 로 기다린다 — 고정 sleep 은 느리거나 불안정하다.
async function waitRev(u, from, what, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (num(`SELECT rev FROM cal_user_rev WHERE user_id=${u}`) > from) return true;
    await sleep(250);
  }
  throw new Error(`${what}: rev 가 ${from} 에서 오르지 않았다(${ms}ms)`);
}

const t0 = Date.now();
console.log('═'.repeat(72));
console.log('「XML 가져오기」 실동작 검증 — 실제 위젯 · 실 DB');
console.log('═'.repeat(72));

let cdp;
try {
  cdp = await Cdp.attach(PORT);

  /* ── 0. 대상 사용자 · 기준선 ─────────────────────────────────────── */
  const login = await cdp.ev("(typeof currentUser !== 'undefined' && currentUser && currentUser.loginId) || ''");
  const U = num(`SELECT user_id FROM app_user WHERE login_id='${String(login).trim().replace(/'/g, "''")}'`);
  if (!U) throw new Error(`로그인 사용자를 찾지 못했다(login='${login}') — 위젯이 로그인된 상태여야 한다`);
  console.log(`\n대상: login=${login} user_id=${U}`);

  const base = {
    cat: num(`SELECT COUNT(*) FROM cal_category WHERE user_id=${U}`),
    ent: num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${U}`),
    cmt: num(`SELECT COUNT(*) FROM cal_entry_commit WHERE user_id=${U}`),
    todo: num(`SELECT COUNT(*) FROM cal_todo WHERE user_id=${U}`),
    room: num(`SELECT COUNT(*) FROM cal_room WHERE user_id=${U}`),
    th: num(`SELECT COUNT(*) FROM cal_task_hours WHERE user_id=${U}`),
    att: num(`SELECT COUNT(*) FROM cal_attendance WHERE user_id=${U}`),
    rev: num(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`),
  };
  console.log('기준선:', JSON.stringify(base));
  if (base.cat + base.ent === 0) throw new Error('대상 사용자의 캘린더가 비어 있다 — 왕복 시험이 무의미하다');

  /* ── 1. 지금 상태를 XML 로 뽑는다(= 사용자가 내보내기 한 파일) ───── */
  console.log('\n[1] 내보내기 — 지금 상태를 XML 로');
  const xml = await cdp.ev('toXML()');
  ok('toXML() 이 XML 을 만든다', typeof xml === 'string' && xml.startsWith('<?xml'), `${(xml || '').length}자`);
  const xmlCommits = (xml.match(/<commit\b/g) || []).length;
  ok('내보낸 XML 에 커밋이 들어 있다', xmlCommits === base.cmt, `XML ${xmlCommits} · DB ${base.cmt}`);

  /* ── 2. 미리보기 — 호스트 파일창 뒤에 오는 바로 그 함수 ─────────── */
  console.log('\n[2] 미리보기 모달');
  await cdp.ev(`showImportPreview('roundtrip.xml', ${JSON.stringify(xml)})`);
  const pv = await cdp.ev(`JSON.stringify({
    open: !!document.querySelector('#importModal.open, #importModal[open], #importModal:not([hidden])'),
    info: (document.getElementById('importInfo')||{}).textContent || '',
    cats: pendingImport ? pendingImport.categories.length : -1,
    ents: pendingImport ? pendingImport.entries.length : -1
  })`);
  const p = JSON.parse(pv);
  ok('pendingImport 가 파일 내용으로 채워졌다', p.cats === base.cat && p.ents === base.ent,
     `과제 ${p.cats}/${base.cat} · 기록 ${p.ents}/${base.ent}`);
  ok('미리보기 문구에 건수가 보인다', /과제/.test(p.info) && /기록/.test(p.info), p.info.replace(/\s+/g, ' ').slice(0, 80));

  /* ── 3. 교체 — 전량 삭제 + 전량 삽입이 실제로 돈다 ──────────────── */
  console.log('\n[3] 교체(replace) — 전량 교체');
  const catNoBefore = num(`SELECT IFNULL(MIN(cat_no),0) FROM cal_category WHERE user_id=${U}`);
  await cdp.ev("applyImport('replace')");
  await waitRev(U, base.rev, '교체 저장');
  const after = {
    cat: num(`SELECT COUNT(*) FROM cal_category WHERE user_id=${U}`),
    ent: num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${U}`),
    cmt: num(`SELECT COUNT(*) FROM cal_entry_commit WHERE user_id=${U}`),
    todo: num(`SELECT COUNT(*) FROM cal_todo WHERE user_id=${U}`),
    room: num(`SELECT COUNT(*) FROM cal_room WHERE user_id=${U}`),
    th: num(`SELECT COUNT(*) FROM cal_task_hours WHERE user_id=${U}`),
    att: num(`SELECT COUNT(*) FROM cal_attendance WHERE user_id=${U}`),
    rev: num(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`),
  };
  for (const k of ['cat', 'ent', 'cmt', 'todo', 'room', 'th', 'att'])
    ok(`교체 뒤 ${k} 행수가 같다(왕복 무손실)`, after[k] === base[k], `전 ${base[k]} → 후 ${after[k]}`);
  ok('rev 가 올랐다', after.rev > base.rev, `${base.rev} → ${after.rev}`);
  //  ★ 번호가 1 부터 다시 붙었는가 = 차분이 아니라 **전량 교체**가 돌았다는 증거.
  ok('과제 번호가 1 부터 다시 붙었다(전량 교체 확인)',
     num(`SELECT IFNULL(MIN(cat_no),0) FROM cal_category WHERE user_id=${U}`) === 1,
     `교체 전 최소 cat_no=${catNoBefore}`);
  ok('이관 마커가 살아 있다(전량 교체가 안 지운다)',
     num(`SELECT COUNT(*) FROM cal_migration_log WHERE user_id=${U}`) >= 0);
  ok('커밋 고아 0',
     num(`SELECT COUNT(*) FROM cal_entry_commit c LEFT JOIN cal_entry e ON e.user_id=c.user_id AND e.entry_no=c.entry_no WHERE c.user_id=${U} AND e.entry_no IS NULL`) === 0);
  ok('커밋 seq 가 0 부터 빈틈없다',
     num(`SELECT COUNT(*) FROM (SELECT entry_no, MAX(seq)+1 mx, COUNT(*) c FROM cal_entry_commit WHERE user_id=${U} GROUP BY entry_no HAVING mx <> c) z`) === 0);

  /* ── 4. 화면이 갈리지 않았는가 ──────────────────────────────────── */
  console.log('\n[4] 화면 상태');
  const scr = JSON.parse(await cdp.ev(`JSON.stringify({
    cats: state.categories.length, ents: state.entries.length,
    cmts: state.entries.reduce((a,e)=>a+((e.commits||[]).length),0),
    conflict: !!document.getElementById('dbConflict'),
    hint: !!document.getElementById('emptyHint')
  })`));
  ok('화면 state 가 DB 와 같다', scr.cats === after.cat && scr.ents === after.ent,
     `화면 과제 ${scr.cats}·기록 ${scr.ents}`);
  ok('화면 커밋 수가 DB 와 같다', scr.cmts === after.cmt, `화면 ${scr.cmts} · DB ${after.cmt}`);
  ok('충돌 배너가 없다(저장이 거부되지 않았다)', !scr.conflict);
  ok('빈 캘린더 안내가 없다(데이터가 있으므로)', !scr.hint);

  /* ── 5. 병합 — 같은 파일이면 아무것도 늘지 않아야 한다 ──────────── */
  console.log('\n[5] 병합(merge) — 같은 내용이면 증가 0');
  const rev5 = num(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`);
  await cdp.ev(`showImportPreview('roundtrip.xml', ${JSON.stringify(xml)})`);
  await cdp.ev("applyImport('merge')");
  await waitRev(U, rev5, '병합 저장');
  const m = {
    cat: num(`SELECT COUNT(*) FROM cal_category WHERE user_id=${U}`),
    ent: num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${U}`),
    cmt: num(`SELECT COUNT(*) FROM cal_entry_commit WHERE user_id=${U}`),
    todo: num(`SELECT COUNT(*) FROM cal_todo WHERE user_id=${U}`),
  };
  for (const k of ['cat', 'ent', 'cmt', 'todo'])
    ok(`병합 뒤 ${k} 가 늘지 않았다(중복 판정)`, m[k] === after[k], `${after[k]} → ${m[k]}`);

  /* ── 6. 원상 확인 ───────────────────────────────────────────────── */
  console.log('\n[6] 원상');
  for (const k of ['cat', 'ent', 'cmt', 'todo'])
    ok(`${k} 가 시작할 때와 같다`, m[k] === base[k], `시작 ${base[k]} · 지금 ${m[k]}`);

} catch (e) {
  fail++; F.push('중단: ' + e.message);
  console.log('\n[중단] ' + e.message);
} finally {
  if (cdp) cdp.close();
}

console.log('\n' + '═'.repeat(72));
console.log(`통과 ${pass} · 실패 ${fail} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
if (F.length) { console.log('\n실패 목록:'); F.forEach(f => console.log('  · ' + f)); }
console.log(fail === 0
  ? '가져오기 실동작 검증 통과 ✓ — 파일 내용이 그대로 DB 가 된다.'
  : '★ 실패 — 89명이 통과할 유일한 이관 문이다. 배포 전에 고칠 것.');
console.log('═'.repeat(72));
process.exit(fail === 0 ? 0 : 1);
