#!/usr/bin/env node
/* ============================================================================
 *  tests/loop-conflict-ui.mjs — 충돌이 났을 때 **사용자가 무엇을 보는가** (§3.3 의 사람 쪽 끝)
 * ----------------------------------------------------------------------------
 *  【왜 이게 따로 필요한가】
 *    쓰기 계층이 충돌을 옳게 거부한다는 것은 loop-calendar-write.mjs 가 증명한다.
 *    그런데 거부가 **화면에 어떻게 도착하는지**는 지금까지 한 번도 태워 본 적이 없다 —
 *    계약 검사(출처⑧)가 소스 텍스트에 그 줄이 있는지만 봤다. 텍스트는 배선이 살아 있다는
 *    증거가 아니다. 이 파일은 실제 위젯에 낡은 토큰을 만들어 주고 저장을 시켜서,
 *    사용자가 보는 것을 **그 자리에서** 본다.
 *
 *  【배선】 task-calendar-prototype.html:4102
 *    else if(res && res.conflict) showDbConflict(res.error || '다른 곳에서 먼저 수정되었습니다');
 *
 *  【증명하는 다섯】
 *    U1  #dbConflict 안내가 **실제로 뜬다**(요소가 있고 조상 사슬로 보인다)
 *    U2  문구가 **충돌을 말한다**(먼저 수정 / 다시 불러오기 취지)
 *    U3  **자동 재시도가 없다** — 저장 뒤 3초 동안 saveState 계열이 다시 나가지 않는다
 *    U4  **DB 가 안 덮였다** — 밖에서 넣은 값이 그대로 있다(앱이 이겨서 덮어쓰면 안 된다)
 *    U5  **회복 수단**이 있고, 누르면 앱이 DB 를 다시 읽어 화면이 밖의 값으로 바뀐다
 *
 *  ★ '판정 불가' 를 통과로 세지 않는다. 특히 U1 — #dbConflict 요소가 **없으면**
 *    '숨겨져 있다' 가 아니라 **아무것도 판정하지 못한 것**이다. 이 저장소에서 `!!el && 보임`
 *    패턴이 없는 요소를 조용히 '숨김' 으로 세어 검사가 헛돈 적이 있다(loop-peer-frame 의 교훈).
 *    전제가 안 서면 exit 2 로 끝낸다.
 *
 *  ★★ 【이 시험은 로그인한 사용자의 실계정을 건드린다 — 그래서 규율이 있다】
 *    앱의 부팅 스냅샷을 낡게 만들려면 **그 앱이 로그인한 사용자**의 행을 밖에서 바꿔야 한다.
 *    로그인은 netcus 를 거치므로 시험 계정으로 갈아탈 수 없다(호스트 userLogin → RunUserLoginAsync).
 *    그래서 여기서는:
 *      · DELETE 를 **한 줄도 하지 않는다.** cal_category 한 행의 name/updated_at 과
 *        cal_user_rev.rev — 딱 셋만 UPDATE 하고, finally 에서 원래 값으로 되돌린다.
 *      · 시작·끝에 행수(cal_entry·cal_category)를 재서 **하나도 늘거나 줄지 않았음**을 확인한다.
 *      · 되돌린 뒤 앱에 reloadState 를 보내 앱의 스냅샷도 DB 와 다시 맞춘다
 *        (안 그러면 이 시험이 끝난 뒤 사용자의 다음 저장이 충돌한다).
 *
 *  【실행】
 *    ① 위젯을 디버깅 포트로 띄운다(로그인된 상태여야 한다):
 *       powershell -NoProfile -Command '$env:TC_DEBUG_PORT="9222"; Start-Process -FilePath "<exe>"'
 *       ★ bash 에서 부를 때 **작은따옴표**로 감쌀 것 — 큰따옴표면 bash 가 $env: 를 먹어
 *         포트가 안 열린다(실측).
 *    ② TC_TEST_DB_ADMIN_PW=… node tests/loop-conflict-ui.mjs
 *    종료코드: 0 통과 · 1 실패 · 2 판정 불가(전제 불충족 — 초록 아님)
 * ==========================================================================*/
import { spawnSync } from 'node:child_process';

const ARG = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const PORT = Number(process.env.TC_DEBUG_PORT || ARG.get('port') || 9222);
const MYSQL = process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe';
const USER = process.env.TC_TEST_DB_ADMIN_USER || 'root';
const PW = process.env.TC_TEST_DB_ADMIN_PW || '';
const DB = process.env.TC_TEST_DB_NAME || 'taskmgr';
//  U3 의 관찰 창. 3초 안에 자동 재시도가 안 나오면 '안 한다' 로 본다 —
//  dbSave 는 실패하면 __dbDirty 를 내리고 끝내므로, 재시도가 있다면 즉시 나온다.
const QUIET_MS = Number(ARG.get('quiet') || 3000);

if (!PW) { console.error('[중단] TC_TEST_DB_ADMIN_PW 가 없습니다.'); process.exit(2); }

let pass = 0, fail = 0, undecided = 0;
const F = [], UD = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; F.push(n + (d ? ' — ' + d : '')); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); }
};
//  판정 불가 = 전제가 안 서서 **아무 말도 못 한 것**. 통과가 아니다.
const undecide = (n, d = '') => { undecided++; UD.push(n + (d ? ' — ' + d : '')); console.log(`  ? ${n} — 판정 불가${d ? ': ' + d : ''}`); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qq = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");

/* ── mysql ─────────────────────────────────────────────────────────────── */
//  ★ 한글 값을 넣고 되읽으므로 utf8mb4 를 명시한다. 빠뜨리면 이름 대조가 조용히 어긋난다.
function sql(q, what = 'SQL') {
  const r = spawnSync(MYSQL, [`-u${USER}`, `-p${PW}`, '--default-character-set=utf8mb4', DB, '-N', '-B', '-e', q],
                      { encoding: 'utf8' });
  if (r.status !== 0) {
    const lines = (r.stderr || '').split('\n').filter((l) => l.trim() && !/Using a password/.test(l));
    throw new Error(`${what} 실패: ${lines[0] || '(stderr 없음)'}`);
  }
  //  ★ **CRLF 로 자른다.** Windows 의 mysql.exe 는 줄 끝에 \r 을 붙이므로 '\n' 으로만 자르면
  //    **각 줄의 마지막 칸에 \r 이 남는다.** 그러면 문자열 비교가 눈에는 같아 보이는데 늘 어긋난다
  //    (2026-09-07 실측: 기대·현재가 화면상 같은데 U4 가 실패했다. 원인이 이 \r 이었다).
  return (r.stdout || '').split(/\r?\n/).filter((l) => l.length).map((l) => l.split('\t'));
}
const one = (q, w) => { const r = sql(q, w); return r.length ? r[0][0] : null; };
const num = (q, w) => Number(one(q, w));

/* ── 최소 CDP — loop-peer-frame.mjs 의 것을 그대로 본뜬다 ───────────────── */
class Cdp {
  #ws = null; #id = 0; #p = new Map();
  static async attach(port) {
    let list;
    try {
      //  ★ 응답을 잘라 읽지 말 것 — webSocketDebuggerUrl 은 각 항목의 **뒤쪽**에 있어
      //    head -c 로 자르면 "타겟이 없다" 로 오판한다(실측).
      list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json();
    } catch (e) {
      throw new Error(`CDP 에 붙지 못했다(포트 ${port}) — 위젯을 TC_DEBUG_PORT=${port} 로 띄웠나요?`);
    }
    //  ?peer=1 프레임(타인 일정 열람 창)은 제외한다 — 조종할 것은 **부모** 창이다.
    const t = (list || []).filter((x) => x.type === 'page' && x.webSocketDebuggerUrl
      && /tcapp\.local/i.test(x.url || '') && !/peer=1/.test(x.url || ''))[0];
    if (!t) throw new Error('부모 page 타겟이 없다 — 위젯이 떠 있고 로그인돼 있어야 한다');
    const c = new Cdp();
    const ws = new WebSocket(t.webSocketDebuggerUrl); c.#ws = ws;
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('WS 시간 초과')), 10000);
      ws.addEventListener('open', () => { clearTimeout(to); res(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(to); rej(new Error('WS 실패')); }, { once: true });
    });
    ws.addEventListener('message', (ev) => {
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
      throw new Error('페이지 JS 예외: ' + String((d.exception && (d.exception.description || d.exception.value)) || d.text).split('\n')[0]);
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.#ws.close(); } catch { } }
}

/* ── main ──────────────────────────────────────────────────────────────── */
const t0 = Date.now();
console.log('═'.repeat(72));
console.log('충돌 안내 UI — 실 위젯 · 실 DB (§3.3 이 사용자에게 도착하는가)');
console.log('═'.repeat(72));

let cdp = null;
let restore = null;      // { uid, catNo, name, updatedAt, rev } — finally 가 되돌릴 것
let aborted = false;     // 전제 불충족으로 끊었나(=판정 불가)

try {
  try { cdp = await Cdp.attach(PORT); }
  catch (e) {
    console.log('\n[전제 불충족] ' + e.message);
    console.log('  위젯을 이렇게 띄운 뒤 다시 실행하세요(bash 라면 **작은따옴표**로):');
    console.log(`  powershell -NoProfile -Command '$env:TC_DEBUG_PORT="${PORT}"; Start-Process -FilePath "widget\\bin\\Debug\\net9.0-windows\\TaskCalendarWidget.exe"'`);
    undecide('위젯 CDP 연결', e.message);
    aborted = true;
    throw new Error('__ABORT__');
  }

  // ── 전제 ① 로그인 + 부팅 스냅샷이 있다 ──────────────────────────────────
  const me = String(await cdp.ev("(typeof currentUser!=='undefined' && currentUser && currentUser.loginId) || ''")).trim();
  if (!me) { undecide('앱이 로그인돼 있다', 'currentUser 가 없다 — 로그인한 뒤 다시 실행'); aborted = true; throw new Error('__ABORT__'); }
  const UID = num(`SELECT user_id FROM app_user WHERE login_id='${qq(me)}'`, 'user_id 조회');
  if (!UID) { undecide('로그인 사용자를 DB 에서 찾았다', `login_id='${me}'`); aborted = true; throw new Error('__ABORT__'); }

  //  전제 ② 앱이 DB 데이터를 들고 있다. 과제가 하나도 없으면 낡게 만들 행이 없다.
  const app = JSON.parse(await cdp.ev(`JSON.stringify({
    cats: (state.categories||[]).map(c=>({id:c.id,name:c.name,source:c.source||''})),
    ents: (state.entries||[]).length,
    saving: (typeof __dbSaving!=='undefined') ? !!__dbSaving : null,
    host: (typeof HOST!=='undefined') ? !!HOST : false })`));
  if (!app.host) { undecide('위젯(호스트) 안에서 돈다', 'HOST=false — 브라우저 창에 붙었다'); aborted = true; throw new Error('__ABORT__'); }
  if (!app.cats.length) { undecide('앱이 과제를 하나 이상 들고 있다', '과제 0개 — 낡게 만들 행이 없다'); aborted = true; throw new Error('__ABORT__'); }

  //  ★ 대상은 **로컬 과제**를 고른다. 공식(db) 과제를 고르면 다음 loadProjects 때
  //    syncSubscribedDbMeta 가 이름을 카탈로그 값으로 되돌리며 save() 를 부른다(html:4192) —
  //    시험이 만든 상태를 제품 코드가 치워 버려서 무엇을 봤는지 알 수 없게 된다.
  const tIdx = app.cats.findIndex((c) => c.source !== 'db' && !String(c.id).startsWith('db-'));
  if (tIdx < 0) {
    undecide('낡게 만들 로컬 과제가 있다', '전부 공식(db) 과제다 — 이름 동기화가 시험 상태를 덮는다');
    aborted = true; throw new Error('__ABORT__');
  }

  console.log(`\n로그인 ${me}(user_id=${UID}) · 화면 과제 ${app.cats.length} · 일정 ${app.ents}`);

  // ── 기준선 — 이 시험이 행을 **하나도** 늘리거나 줄이지 않았음을 끝에서 대조한다 ───
  const base = {
    ent: num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${UID}`),
    cat: num(`SELECT COUNT(*) FROM cal_category WHERE user_id=${UID}`),
    rev: num(`SELECT rev FROM cal_user_rev WHERE user_id=${UID}`),
  };
  console.log(`기준선: cal_entry ${base.ent}행 · cal_category ${base.cat}행 · rev ${base.rev}`);

  //  앱 화면의 첫 과제가 DB 의 어느 행인지 uid 로 찾는다 —
  //  ★ 순서로 짐작하지 않는다. 앱이 UPDATE 할 행을 정확히 골라야 토큰이 낡는다.
  const targetUid = app.cats[tIdx].id;
  const row = sql(`SELECT cat_no, name, updated_at FROM cal_category WHERE user_id=${UID} AND uid='${qq(targetUid)}'`,
                  '대상 과제 조회');
  if (!row.length) {
    undecide('화면 첫 과제가 DB 에 있다', `uid='${targetUid}' 행이 없다 — 앱과 DB 가 이미 어긋나 있다`);
    aborted = true; throw new Error('__ABORT__');
  }
  const catNo = Number(row[0][0]);
  restore = { uid: UID, catNo, name: row[0][1], updatedAt: row[0][2], rev: base.rev };
  console.log(`대상 과제: cat_no=${catNo} uid=${targetUid} name="${restore.name}" updated_at=${restore.updatedAt}`);

  // ── 계기 — chrome.webview.postMessage 를 세어 둔다(U3 의 정본 판정) ──────
  //  ★ 삼키지 않는다. 진짜 저장이 나가야 충돌이 난다 — 원본으로 그대로 넘긴다.
  //  ★ 로그가 아니라 **문 자체**를 센다: 호스트 로그는 재시도 한 번을 저장 한 번과 구별해 주지 않는다.
  await cdp.ev(`(()=>{ if(window.__cuiOrig) return 'already';
    window.__cuiOrig = window.chrome.webview.postMessage.bind(window.chrome.webview);
    window.__cuiSeen = [];
    window.chrome.webview.postMessage = function(m){
      try{ const o = JSON.parse(m); window.__cuiSeen.push({cmd:o.cmd, t:Date.now()}); }catch(_){ window.__cuiSeen.push({cmd:'?', t:Date.now()}); }
      return window.__cuiOrig(m);
    };
    return 'armed'; })()`);

  // ── ★ 밖에서 DB 를 바꾼다 — '다른 PC 가 먼저 저장했다' 를 그대로 만든다 ────
  //    updated_at 만 올리면 토큰은 낡지만 "누가 무엇을 썼는가" 가 안 보인다.
  //    그래서 name 도 함께 바꾼다 — U4(덮이지 않았다)·U5(다시 읽으면 이 값이 뜬다)의 눈이 된다.
  //    ★ rev 도 함께 올린다. 실제 저장은 §3.1 로 반드시 rev 를 올리므로, 여기서 빠뜨리면
  //      "다른 PC 가 저장한 상태" 가 아니라 "누가 updated_at 만 손댄 상태" 가 된다.
  const SENTINEL = '충돌시험-다른PC-' + new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const NEWTOK = new Date(Date.now() + 1000).toISOString().replace('T', ' ').replace('Z', '');   // 'yyyy-MM-dd HH:mm:ss.fff'
  sql(`UPDATE cal_category SET name='${qq(SENTINEL)}', updated_at='${qq(NEWTOK)}' ` +
      `WHERE user_id=${UID} AND cat_no=${catNo}`, '외부 수정(과제)');
  sql(`UPDATE cal_user_rev SET rev = rev + 1 WHERE user_id=${UID}`, '외부 수정(rev)');
  console.log(`\n밖에서 DB 를 바꿨다: name="${SENTINEL}" updated_at=${NEWTOK} · rev ${base.rev}→${base.rev + 1}`);

  // ── 앱에서 저장을 유발한다 ─────────────────────────────────────────────
  //    ★ save() 를 직접 부른다 — 특정 버튼이 아니라 **모든 편집 경로의 공통 마지막 관문**이다
  //      (task-calendar-prototype.html:3780 의 주석과 같은 판단). 버튼을 고르면 그 버튼만 시험한다.
  const APPNAME = '앱이-바꾼-이름';
  //  ★ 앞 저장이 아직 날고 있으면 dbSave 는 __dbDirty 만 세우고 조용히 돌아간다(html:4078) —
  //    그러면 postMessage 가 한 번도 안 나가 U3 가 "0회" 로 헛돈다. 가라앉기를 먼저 기다린다.
  for (let i = 0; i < 40 && (await cdp.ev('(typeof __dbSaving!==\'undefined\') ? !!__dbSaving : false')) === true; i++)
    await sleep(250);
  const seenBefore = Number(await cdp.ev('window.__cuiSeen.length'));
  await cdp.ev(`(()=>{ state.categories[${tIdx}].name = ${JSON.stringify(APPNAME)};
                       try{ renderAll(); }catch(_){}
                       save(); return true; })()`);
  const tSave = Date.now();

  // ── U1 — 안내가 실제로 뜨는가 ───────────────────────────────────────────
  //    ★ 조상 사슬로 판정한다(레이아웃이 아니라). 창이 화면에 안 그려져 있어도 결정된다 —
  //      offsetParent/rect 로 보면 위젯이 최소화돼 있을 때 모든 요소가 '안 보임' 이 되어
  //      검사가 통째로 헛돈다(loop-peer-frame 2026-09-03 실측).
  const probeBanner = `(()=>{ const el = document.getElementById('dbConflict');
    if(!el) return JSON.stringify({exists:false});
    let shown = true;
    for(let n = el; n && n !== document.documentElement; n = n.parentElement){
      const cs = getComputedStyle(n);
      if(cs.display === 'none' || cs.visibility === 'hidden'){ shown = false; break; }
      if(n.classList && n.classList.contains('hidden')){ shown = false; break; }
    }
    const btns = [...el.querySelectorAll('button')].map(b => (b.textContent||'').trim());
    return JSON.stringify({exists:true, shown, text:(el.textContent||'').trim(), btns});
  })()`;
  let banner = { exists: false };
  for (let i = 0; i < 60; i++) {              // 최대 15초 — 저장 왕복(호스트+DB)이 끝나야 뜬다
    banner = JSON.parse(await cdp.ev(probeBanner));
    if (banner.exists) break;
    await sleep(250);
  }

  if (!banner.exists) {
    //  ★ '안 떴다' 가 아니라 **판정 불가**로 다룬다. 요소가 없으면 U2·U5 도 볼 수 없고,
    //    없는 요소를 '숨김' 으로 세는 순간 이 검사 전체가 조용히 무의미해진다.
    //    (저장이 애초에 충돌하지 않았을 수도 있다 — 그러면 배선이 아니라 전제가 틀린 것이다.)
    undecide('U1 #dbConflict 안내가 뜬다',
      '요소 자체가 없다 — 저장이 충돌하지 않았거나(전제 실패) 배선이 끊겼다(제품 결함). ' +
      '위젯 로그의 「캘린더 저장 충돌」 줄로 어느 쪽인지 가른다');
  } else {
    ok('U1 #dbConflict 안내가 실제로 뜬다(요소가 있고 조상 사슬로 보인다)', banner.shown === true,
       '요소는 있는데 숨겨져 있다 — 사용자에게는 아무 일도 안 일어난 것과 같다');
    console.log(`     문구: "${banner.text}"`);
    console.log(`     버튼: ${banner.btns.length ? banner.btns.map(b => `[${b}]`).join(' ') : '(없음)'}`);

    // ── U2 — 문구가 충돌을 말하는가 ────────────────────────────────────────
    //    두 가지를 다 말해야 한다: **무슨 일이 났는지**(먼저 수정됨)와 **무엇을 하면 되는지**(다시 불러오기).
    const saysWhat = /먼저 수정|다른 곳에서|충돌/.test(banner.text);
    const saysHow = /새로고침|다시 불러|다시 시도|최신/.test(banner.text);
    ok('U2 문구가 「다른 곳에서 먼저 수정되었다」는 사실을 말한다', saysWhat, banner.text);
    ok('U2 문구가 회복 방법(새로고침/다시 불러오기)을 말한다', saysHow, banner.text);
  }

  // ── U3 — 자동 재시도가 없다 ─────────────────────────────────────────────
  //    ★ 횟수로 판정한다. dbSave 는 실패 시 __dbDirty 를 내리고 끝내는 설계라(html:4098),
  //      재시도가 생기면 곧바로 saveState 가 한 번 더 나간다. 3초면 충분하다.
  const elapsed = Date.now() - tSave;
  if (elapsed < QUIET_MS) await sleep(QUIET_MS - elapsed);
  const seen = JSON.parse(await cdp.ev('JSON.stringify(window.__cuiSeen.slice(' + seenBefore + '))'));
  const saves = seen.filter((x) => x.cmd === 'saveState' || x.cmd === 'replaceAllState');
  ok(`U3 저장 명령이 **정확히 한 번만** 나갔다(자동 재시도 없음 · ${QUIET_MS}ms 관찰)`,
     saves.length === 1,
     `saveState 계열 ${saves.length}회 [${saves.map((s) => s.cmd).join(', ')}] · 그 사이 전체 명령 ${seen.length}회 ` +
     '— 0이면 저장이 아예 안 나갔고(전제 실패), 2 이상이면 낡은 토큰으로 다시 두드린 것이다');
  ok('U3 전량 교체(replaceAllState)로 번지지 않았다',
     saves.every((s) => s.cmd === 'saveState'), saves.map((s) => s.cmd).join(', '));

  // ── U4 — DB 가 안 덮였다 ────────────────────────────────────────────────
  const nameNow = one(`SELECT name FROM cal_category WHERE user_id=${UID} AND cat_no=${catNo}`, '대상 과제 재조회');
  ok('U4 밖에서 넣은 값이 DB 에 그대로다(앱이 덮어쓰지 않았다)', nameNow === SENTINEL,
     `기대="${SENTINEL}" 현재="${nameNow}" — 앱 값("${APPNAME}")이면 마지막 쓴 사람이 이긴 것이다`);
  //  부분 적용도 없어야 한다 — 트랜잭션이 통째로 롤백됐다는 뜻(§3.3).
  ok('U4 앱이 보낸 값이 DB 에 한 조각도 안 들어갔다',
     num(`SELECT COUNT(*) FROM cal_category WHERE user_id=${UID} AND name='${qq(APPNAME)}'`) === 0);
  ok('U4 행수가 그대로다(이 시험이 아무것도 만들거나 지우지 않았다)',
     num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${UID}`) === base.ent &&
     num(`SELECT COUNT(*) FROM cal_category WHERE user_id=${UID}`) === base.cat,
     `cal_entry ${base.ent}→${num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${UID}`)} · ` +
     `cal_category ${base.cat}→${num(`SELECT COUNT(*) FROM cal_category WHERE user_id=${UID}`)}`);

  // ── U5 — 회복 수단이 있고, 그것이 정말 회복시키는가 ──────────────────────
  if (!banner.exists) {
    undecide('U5 회복 수단', '안내가 없어 누를 것도 없다');
  } else if (!banner.btns.length) {
    //  ★ 버튼이 없으면 그 사실을 **그대로** 실패로 적는다. 충돌 안내만 있고 빠져나갈 문이 없으면
    //    사용자는 이후 모든 편집이 거부되는 상태에 갇힌다(제품 결함이다).
    ok('U5 안내에 회복 수단(다시 불러오기 버튼)이 있다', false,
       '버튼이 하나도 없다 — 사용자가 이 상태에서 빠져나갈 문이 없다');
  } else {
    ok('U5 안내에 회복 수단(다시 불러오기 버튼)이 있다', true);
    await cdp.ev(`(()=>{ const el = document.getElementById('dbConflict');
      const b = [...el.querySelectorAll('button')][0]; b.click(); return true; })()`);
    //  누르면 hpost({cmd:'reloadState'}) → 호스트가 BootFromDbAsync 를 다시 돌려 __applyState 로 주입한다.
    let after = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      after = String(await cdp.ev(`(()=>{ const c = (state.categories||[]).find(c=>c.id===${JSON.stringify(targetUid)});
        return c ? c.name : ''; })()`));
      if (after === SENTINEL) break;
    }
    ok('U5 다시 불러오기를 누르면 화면이 DB(=밖에서 넣은) 값으로 바뀐다', after === SENTINEL,
       `화면 이름="${after}" 기대="${SENTINEL}" — 눌러도 안 바뀌면 회복 수단이 이름뿐이다`);
    //  회복이 진짜인지 한 번 더: 스냅샷이 새로워졌으니 rev 도 앱이 다시 읽었을 것이다.
    //  ★ 같은 구간(seenBefore 이후)으로 센다 — 전체를 세면 시험 시작 전의 저장이 섞여 계산이 어긋난다.
    const reSeen = JSON.parse(await cdp.ev('JSON.stringify(window.__cuiSeen.slice(' + seenBefore + ').map(x=>x.cmd))'));
    ok('U5 회복은 reloadState 로 간다(저장으로 덮지 않는다)',
       reSeen.includes('reloadState') && reSeen.filter((c) => c === 'saveState').length === saves.length,
       `보낸 명령: ${reSeen.join(', ')} — saveState 가 늘었다면 회복이 아니라 '내 화면으로 덮기' 다`);

    //  ★ U6 — 회복했으면 안내도 걷혀야 한다.
    //    처음엔 이걸 '관찰만' 하고 판정하지 않았는데(계약이 정해진 자리가 아니라는 이유),
    //    실측해 보니 **남아 있었다**: hideDbConflict 가 '저장 성공' 경로에만 있었다(html:4086).
    //    그러면 사용자는 [새로고침] 으로 이미 최신을 받아 놓고도 "다른 곳에서 먼저 수정되었습니다" 를
    //    계속 본다 — 해결된 일을 아직 문제처럼 보여 주는 것이다.
    //    __applyState 에 hideDbConflict() 를 넣어 고쳤고, 이제 여기서 **판정한다.**
    //    (같은 자리의 clearBootError 가 이미 같은 이유로 그렇게 하고 있었다.)
    const stillThere = JSON.parse(await cdp.ev(probeBanner));
    console.log(`     다시 불러온 뒤 안내: ${stillThere.exists ? (stillThere.shown ? '아직 보인다' : '요소는 있으나 숨김') : '사라졌다'}`);
    ok('U6 회복하면 충돌 안내가 걷힌다(최신인데 경고를 계속 보여주지 않는다)',
       stillThere.exists === false || stillThere.shown === false,
       '다시 불러왔는데도 안내가 그대로다 — 사용자는 회복됐는지 알 수 없다');
  }

} catch (e) {
  if (String(e && e.message) !== '__ABORT__') {
    fail++; F.push('중단: ' + e.message);
    console.log('\n[중단] ' + e.message);
  }
} finally {
  // ── 원상 복구 — 실패해도 반드시 돈다 ───────────────────────────────────
  if (restore) {
    try {
      sql(`UPDATE cal_category SET name='${qq(restore.name)}', updated_at='${qq(restore.updatedAt)}' ` +
          `WHERE user_id=${restore.uid} AND cat_no=${restore.catNo}`, '원복(과제)');
      sql(`UPDATE cal_user_rev SET rev=${restore.rev} WHERE user_id=${restore.uid}`, '원복(rev)');
      const back = one(`SELECT CONCAT(name,'|',updated_at) FROM cal_category WHERE user_id=${restore.uid} AND cat_no=${restore.catNo}`);
      console.log(`\n원복: cat_no=${restore.catNo} → "${restore.name}" · rev=${restore.rev} · 확인 "${back}"`);
    } catch (e) { console.log('  ! 원복 실패(수동 확인 필요): ' + e.message); fail++; F.push('원복 실패: ' + e.message); }
  }
  if (cdp) {
    try {
      //  계기를 떼고, 앱의 스냅샷을 DB 와 다시 맞춘다 — 안 하면 이 시험이 끝난 뒤
      //  사용자의 다음 저장이 (우리가 낡게 만든 토큰 때문에) 충돌한다.
      await cdp.ev(`(()=>{ if(window.__cuiOrig){ window.chrome.webview.postMessage = window.__cuiOrig;
                             delete window.__cuiOrig; delete window.__cuiSeen; }
                           try{ hideDbConflict(); }catch(_){}
                           try{ hpost({cmd:'reloadState'}); }catch(_){}
                           return true; })()`).catch(() => {});
      await sleep(1200);
    } catch { }
    cdp.close();
  }
}

console.log('\n' + '═'.repeat(72));
console.log(`통과 ${pass} · 실패 ${fail} · 판정 불가 ${undecided} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
if (F.length) { console.log('\n실패 목록:'); F.forEach((f) => console.log('  · ' + f)); }
if (UD.length) { console.log('\n판정 불가 목록(통과가 아니다):'); UD.forEach((f) => console.log('  · ' + f)); }
console.log(fail === 0
  ? (undecided === 0
      ? '충돌 안내 검증 통과 ✓ — 충돌은 화면에 뜨고, 재시도하지 않고, DB 를 덮지 않고, 되돌릴 문이 있다.'
      : '★ 판정 불가 — 전제가 서지 않아 증명하지 못했다(초록 아님)')
  : '★ 실패 — 사용자가 데이터를 잃었다고 느끼는 자리다. 배포 전에 고칠 것.');
console.log('═'.repeat(72));
process.exit(fail > 0 ? 1 : (undecided > 0 ? 2 : 0));
