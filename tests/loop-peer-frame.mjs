#!/usr/bin/env node
/* ============================================================================
 *  tests/loop-peer-frame.mjs — 타인 일정 열람 **창**의 실동작 루프 검증 (C4)
 * ----------------------------------------------------------------------------
 *  증명하는 명제 셋:
 *    ① 열람 창에는 **그 사람의** 일정이 뜬다 (내 것이 아니다)
 *    ② 그 창은 호스트로 **아무것도 내보내지 못한다** — 봉인
 *    ③ 몇 번을 열고 닫아도 **내 데이터도 DB 도 변하지 않고**, 프레임이 쌓이지 않는다
 *
 *  왜 루프인가:
 *    한 번 열어 보는 것으로는 '누수'가 안 드러난다. 프레임이 안 지워지거나, 봉인이
 *    특정 순서에서만 새거나, rev 가 조금씩 오르는 것은 반복해야 보인다.
 *
 *  ★ 오라클 셋을 함께 쓴다 — 하나만 보면 속는다:
 *    (a) **계기** — 열람 창이 chrome.webview.postMessage 를 부르는가  ← 봉인의 **정본 판정**
 *    (b) DB      — rev·행수가 그대로인가                              ← 저장이 새면 rev 가 오른다
 *    (c) DOM     — 그 사람 것이 떴나 · 게이트가 없나 · 프레임이 없어졌나
 *
 *  ★★ 로그는 **봉인 판정에 쓰지 않는다.** 1차 구현이 로그로 판정했다가 눈이 멀었다 —
 *    봉인을 깨고 돌렸는데 통과했다. WebView2 가 자식 프레임의 postMessage 를 최상위
 *    WebMessageReceived 로 전달하지 않기 때문이다(실측). 로그는 늘 깨끗해서 아무것도 증명하지 못한다.
 *    로그는 이제 '부모 쪽에서 새는 것'을 보는 보조 오라클로만 남긴다.
 *
 *  ★ 그리고 **검출력 자체를 시험한다**(--selftest 아님, 항상 돈다):
 *    마지막에 봉인되지 않은 **부모 쪽** hpost 를 일부러 한 번 호출해, 로그 오라클이
 *    실제로 반응하는지 본다. 반응하지 않으면 위의 '로그 0줄'은 아무 의미가 없다.
 *
 *  실행:
 *    TC_DEBUG_PORT=9222 로 위젯을 띄운 뒤(로그인 상태)
 *    TC_TEST_DB_ADMIN_PW=… node tests/loop-peer-frame.mjs [--rounds=8]
 * ==========================================================================*/
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ARG = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const ROUNDS = Number(ARG.get('rounds') || 8);
const PORT = Number(process.env.TC_DEBUG_PORT || 9222);
const MYSQL = process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe';
const PW = process.env.TC_TEST_DB_ADMIN_PW || '';
const USER = process.env.TC_TEST_DB_ADMIN_USER || 'root';
const LOG = process.env.TC_TEST_WIDGET_LOG || join(homedir(), 'AppData', 'Roaming', 'TaskCalendar', 'widget.log');
if (!PW) { console.error('[중단] TC_TEST_DB_ADMIN_PW 가 없습니다.'); process.exit(2); }

let pass = 0, fail = 0; const F = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; } else { fail++; F.push(n + (d ? ' — ' + d : '')); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); }
};
function sql(q, what = 'SQL') {
  const r = spawnSync(MYSQL, [`-u${USER}`, `-p${PW}`, 'taskmgr', '-N', '-B', '-e', q], { encoding: 'utf8' });
  if (r.status !== 0) {
    const lines = (r.stderr || '').split('\n').filter((l) => l.trim() && !/Using a password/.test(l));
    throw new Error(`${what} 실패: ${lines[0] || '(stderr 없음)'}`);
  }
  return (r.stdout || '').trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
}
const one = (q) => { const r = sql(q); return r.length ? r[0][0] : null; };
const num = (q) => Number(one(q));

/* ── 로그 오라클 — 호스트가 명령을 받으면 반드시 한 줄 남긴다 ────────── */
//   봉인이 새면 여기에 찍힌다. 무엇이 찍히면 안 되는지를 이유와 함께 적는다.
const FORBIDDEN = [
  [/캘린더 저장/, '캘린더 저장 — 열람 창이 내 캘린더를 덮어썼다'],
  [/전량 교체/, '전량 교체 — 열람 창이 가져오기를 실행했다'],
  [/DB 과제 로드/, '과제 카탈로그 조회 — 열람 창이 호스트에 명령을 보냈다'],
  [/보고 기록/, '보고 기록 — 열람 창이 회사 보고를 남겼다'],
  [/netcus/i, 'netcus — 열람 창이 회사 시스템과 통신했다'],
  [/부팅 조회/, '부팅 조회 — 열람 창이 ready 를 보내 **내** 캘린더를 받았다'],
];
function logLines() {
  if (!existsSync(LOG)) throw new Error('위젯 로그를 찾지 못했다: ' + LOG);
  const a = readFileSync(LOG, 'utf8').split(/\r?\n/);
  //  ★ 파일이 개행으로 끝나므로 split 이 마지막에 빈 원소를 만든다. 그걸 세면 인덱스가 1 밀리고,
  //    다음에 slice 할 때 **새 줄 하나가 늘 잘린다.** 1차 실행에서 8회 중 7회만 보이고 검출력
  //    시험이 0줄로 나온 원인이 그것이었다 — 제품이 아니라 이 오라클의 오프바이원이었다.
  //    ★ 검출력 시험이 없었으면 "로그 깨끗함"을 그대로 믿고 넘어갔을 자리다.
  while (a.length && a[a.length - 1] === '') a.pop();
  return a;
}
function logSince(n) { return logLines().slice(n); }
//  ★ 로그는 호스트가 **비동기로** 쓴다. 곧바로 읽으면 마지막 줄이 아직 없다.
//    1차 실행에서 4회 중 3회만 보였고, 검출력 시험은 0줄이 나왔다 — 제품이 아니라 이 오라클이
//    성급했던 것이다. 조건이 찰 때까지 기다리되, 못 차면 그대로 실패시킨다(조용히 넘기지 않는다).
async function waitLog(sinceIdx, re, want = 1, ms = 8000) {
  const t = Date.now();
  for (;;) {
    const n = logSince(sinceIdx).filter((l) => re.test(l)).length;
    if (n >= want) return n;
    if (Date.now() - t > ms) return n;
    await sleep(250);
  }
}

/* ── 최소 CDP ─────────────────────────────────────────────────────────── */
class Cdp {
  #ws = null; #id = 0; #p = new Map();
  static async attach(port) {
    let list;
    try { list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json(); }
    catch (e) { throw new Error(`CDP 에 붙지 못했다(포트 ${port}) — 위젯을 TC_DEBUG_PORT=${port} 로 띄웠나요?`); }
    //  ★ ?peer=1 프레임을 제외한다 — 우리가 조종할 것은 **부모** 창이다.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 시험 대상 사용자 — 내 것과 **다른** 데이터를 심는다 ───────────────── */
//   같은 데이터면 "그 사람 것이 떴는가" 를 증명할 수 없다.
const TU = '__pf_target__';
const TITLES = ['열람대상 알파', '열람대상 베타', '열람대상 감마'];
const tid = () => one(`SELECT user_id FROM app_user WHERE login_id='${TU}'`);
function seedTarget() {
  wipeTarget();
  const org = one(`SELECT org_id FROM org_unit WHERE is_active=1 ORDER BY sort_order LIMIT 1`);
  sql(`INSERT INTO app_user (login_id, name, org_id, view_scope, edit_role, is_active) ` +
      `VALUES ('${TU}', '열람대상', ${org}, 'self', 'viewer', 1)`, '대상 생성');
  const u = tid();
  sql(`INSERT IGNORE INTO cal_user_rev (user_id, rev) VALUES (${u}, 0)`, 'rev 시딩');
  sql(`INSERT INTO cal_category (user_id,cat_no,uid,source,name,color,sort_order,created_at,updated_at) ` +
      `VALUES (${u},1,'c-pf-1','local','열람시험과제','#3e5be0',0,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000')`, '대상 과제');
  TITLES.forEach((t, i) => {
    sql(`INSERT INTO cal_entry (user_id,entry_no,uid,cat_no,entry_date,all_day,title,memo,source,location,sort_order,created_at,updated_at) ` +
        `VALUES (${u},${i + 1},'e-pf-${i}',1,'2026-06-1${i + 1}',1,'${t}','비밀메모${i}','','',${i},` +
        `'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000')`, '대상 일정' + i);
  });
  return u;
}
function wipeTarget() {
  const u = tid(); if (!u) return;
  for (const t of ['cal_entry_commit', 'cal_entry_except', 'cal_todo_day_note', 'cal_task_hours',
                   'cal_attendance', 'cal_entry', 'cal_todo', 'cal_category', 'cal_room', 'cal_user_pref'])
    sql(`DELETE FROM ${t} WHERE user_id=${u}`, `정리(${t})`);
  sql(`DELETE FROM cal_user_rev WHERE user_id=${u}`, 'rev 정리');
  sql(`DELETE FROM app_user WHERE user_id=${u}`, '대상 삭제');
}

/* ── main ──────────────────────────────────────────────────────────────── */
const t0 = Date.now();
console.log('═'.repeat(72));
console.log(`타인 일정 열람 창 — 실동작 루프 (라운드 ${ROUNDS} · 실 위젯 · 실 DB)`);
console.log('═'.repeat(72));

let cdp, TUID = 0;
try {
  TUID = seedTarget();
  cdp = await Cdp.attach(PORT);

  const me = String(await cdp.ev("(typeof currentUser!=='undefined' && currentUser && currentUser.loginId) || ''")).trim();
  const MYID = num(`SELECT user_id FROM app_user WHERE login_id='${me.replace(/'/g, "''")}'`);
  if (!MYID) throw new Error(`로그인 사용자를 찾지 못했다(login='${me}')`);
  console.log(`\n로그인 ${me}(user_id=${MYID}) · 대상 ${TU}(user_id=${TUID}) · 일정 ${TITLES.length}건 심음\n`);

  //  기준선 — 이 셋이 끝까지 안 변해야 한다.
  const base = {
    myEnt: num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${MYID}`),
    myCat: num(`SELECT COUNT(*) FROM cal_category WHERE user_id=${MYID}`),
    myRev: num(`SELECT rev FROM cal_user_rev WHERE user_id=${MYID}`),
    tgtEnt: num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${TUID}`),
    tgtRev: num(`SELECT rev FROM cal_user_rev WHERE user_id=${TUID}`),
  };
  const myStateBase = String(await cdp.ev('state.entries.length + "/" + state.categories.length'));
  const logBase = logLines().length;
  console.log('기준선:', JSON.stringify(base), '· 화면 state', myStateBase);

  for (let r = 1; r <= ROUNDS; r++) {
    //  ① 열기
    await cdp.ev(`openPeerSchedule(${JSON.stringify(TU)}, "열람대상")`);
    let loaded = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      const n = await cdp.ev(`(()=>{const f=document.querySelector("#pvHost iframe");
        if(!f||!f.contentWindow||!f.contentWindow.__test) return -1;
        try{ return f.contentWindow.__test.counts().entries; }catch(_){ return -1; }})()`);
      if (Number(n) >= 0) { loaded = true; break; }
    }
    ok(`R${r} 열람 창이 뜨고 데이터가 들어온다`, loaded);
    if (!loaded) { await cdp.ev('closeModal("#peerModal")'); continue; }

    //  ①b **부모 문서에서 실제로 보이는가.** 프레임 안이 아무리 잘 그려져도, 부모 쪽에서
    //  모달이 0×0 이면 사용자에게는 아무것도 안 보인다.
    //  ★ 이 줄이 없어서 오래 못 잡았다 — #peerModal 이 #membersModal 의 **자식**으로 들어가
    //    명부가 .hidden 인 동안 display:none 밑에서 0×0 이었는데, 위 검사들은 전부
    //    프레임 **안쪽**만 보므로 113건이 초록으로 통과했다(2026-09-03 실측: .modal 0×0).
    //    안쪽만 보는 오라클은 바깥이 무너진 것을 원리적으로 못 본다.
    const box = JSON.parse(await cdp.ev(`(()=>{const m=document.querySelector("#peerModal .modal");
      if(!m) return JSON.stringify({w:0,h:0,op:"0",err:"#peerModal .modal 없음"});
      const r=m.getBoundingClientRect(), c=getComputedStyle(m);
      return JSON.stringify({w:Math.round(r.width), h:Math.round(r.height), op:c.opacity});})()`));
    ok(`R${r} **부모에서 보인다**: 열람 모달이 0×0 이 아니다`, box.w >= 300 && box.h >= 200,
       `모달 ${box.w}×${box.h} op=${box.op}${box.err ? ' · ' + box.err : ''} — ` +
       '숨겨진 조상 밑에 들어갔는지 확인할 것(#membersModal 의 자식이 되면 이렇게 된다)');

    //  ② **그 사람의** 것이 떴는가 — 내 것이 아니라
    const shown = JSON.parse(await cdp.ev(`(()=>{const w=document.querySelector("#pvHost iframe").contentWindow;
      const st=w.__test.state(); return JSON.stringify({
        ent: st.entries.length, cat: st.categories.length,
        titles: st.entries.map(e=>e.title).sort(),
        peerAttr: w.document.body.dataset.peer||null,
        banner: (w.document.getElementById("peerBanner")||{}).textContent||"",
        grid: w.document.querySelectorAll("#grid .cell").length,
        chips: w.document.querySelectorAll("#filterbar .fchip").length,
        //  ★ 로그인 게이트가 덮고 있으면 달력이 보여도 사용자는 로그인 화면만 본다.
        //    그리고 봉인 때문에 그 게이트는 **영영 안 풀린다**(2026-09-03 사용자 지적).
        gate: (()=>{ const g=w.document.getElementById("loginGate");
                     return g ? (getComputedStyle(g).display !== "none" && !g.classList.contains("hidden")) : false; })(),
        memoLeak: JSON.stringify(st).includes("비밀메모") });})()`));
    ok(`R${r} 대상의 일정 ${TITLES.length}건이 뜬다(내 ${base.myEnt}건이 아니다)`,
       shown.ent === TITLES.length, `표시 ${shown.ent}건`);
    ok(`R${r} 제목이 대상의 것이다`, JSON.stringify(shown.titles) === JSON.stringify([...TITLES].sort()),
       shown.titles.join(','));
    ok(`R${r} 읽기 전용 표시가 있다`, shown.peerAttr === '1' && /읽기 전용/.test(shown.banner), shown.banner);
    ok(`R${r} 같은 캘린더 UI 가 그대로 뜬다(격자·과제 필터)`, shown.grid === 35 && shown.chips >= 1,
       `격자 ${shown.grid} · 필터칩 ${shown.chips}`);
    ok(`R${r} 메모가 새지 않는다`, shown.memoLeak === false);
    //  ★★ **allowlist 검사** — 보이는 조작 수단이 허용 목록뿐인가.
    //    감추기를 blocklist 로 했다가 열람 창에 보고서·⋯메뉴·문의·테마까지 다 노출됐다(사용자 지적).
    //    그래서 CSS 를 allowlist 로 뒤집었는데, **그것만으로는 부패를 못 막는다** —
    //    새 버튼이 .actions 밖에 생기면 또 샌다. 그래서 여기서 **실제로 보이는 것을 세어** 대조한다.
    //    앞으로 UI 가 늘어도 이 검사가 먼저 운다.
    //  ★ **레이아웃에 기대지 않는다.** 1차 구현은 offsetParent 로 판정했다가 통째로 헛돌았다 —
    //    위젯 창이 화면에 안 그려진 상태에서는 iframe 이 0×0 이라 **모든 요소가 "안 보임"** 이 되고,
    //    그러면 이 검사는 무엇을 노출하든 늘 통과한다(2026-09-03 실측: 보이는 것 0개로 변이가 안 잡혔다).
    //    그래서 조상 사슬의 display/visibility 만 본다 — 이건 레이아웃 없이도 결정된다.
    //  ★ **일정이 있는 날을 먼저 고른다.** 안 그러면 일자 패널이 「기록 없음」이라 카드가 하나도
    //    안 그려지고, 카드 안의 「수정·삭제」(.card-actions)는 존재조차 하지 않아 이 검사가
    //    그 자리를 못 본다. 실제로 그 틈으로 새어 나갔다 — allowlist 로 뒤집을 때 옛 [data-edit]
    //    규칙이 빠져 남의 일정 카드에 삭제 버튼이 붙어 있었는데, 이 검사는 8라운드 내내 초록이었다
    //    (2026-09-03 캡처로 발견). 검사가 볼 수 없는 것은 검사하지 않은 것이다.
    const picked = await cdp.ev(`(()=>{const w=document.querySelector("#pvHost iframe").contentWindow;
      try{ return w.eval("(function(){var e=state.entries[0]; if(!e) return ''; selectedDate=e.date;"
        + " if(typeof renderPanel==='function') renderPanel(); return selectedDate;})()"); }catch(_){ return ''; }})()`);
    ok(`R${r} 일정이 있는 날을 골랐다(카드가 그려져야 편집 어포던스를 볼 수 있다)`, !!picked,
       '날짜 선택에 실패 — 이 라운드의 노출 검사는 카드 영역을 못 본다');
    await sleep(200);
    const vis = JSON.parse(await cdp.ev(`(()=>{const w=document.querySelector("#pvHost iframe").contentWindow;
      const shown=(el)=>{ for(let n=el; n && n!==w.document.documentElement; n=n.parentElement){
        const cs=w.getComputedStyle(n);
        if(cs.display==="none"||cs.visibility==="hidden") return false;
        if(n.classList && n.classList.contains("hidden")) return false; } return true; };
      const seen=[];
      for(const el of w.document.querySelectorAll("#appSurface button, #appSurface input, #appSurface a[href]")){
        if(!shown(el)) continue;
        seen.push(el.id || (el.className||"").toString().split(" ")[0] || el.tagName.toLowerCase());
      }
      return JSON.stringify({seen:[...new Set(seen)], w:w.innerWidth});})()`));
    //  달력 이동 · 연월 · 검색 · 과제 필터칩 · 일자 패널 안의 읽기 컨트롤만 허용한다.
    //  달력 이동 · 연월 · 검색 · 과제 필터칩 · 일자 패널의 **읽기** 컨트롤만 허용한다.
    //  ★ 여기에 무언가를 더할 때는 "그게 읽기인가" 를 먼저 물을 것. 편집이면 CSS 에서 감춰야 한다.
    const ALLOW = new Set(["btnPrev","btnToday","btnNext","btnTitle","jumpMonth","btnSearch",
                           "fchip","dpSheetClose","dptab-detail"]);
    const extra = (vis.seen || []).filter((k) => !ALLOW.has(k));
    //  ★ 한계를 적어 둔다: 위젯 창이 화면에 안 그려지면 iframe 뷰포트가 0폭이 되고,
    //    그러면 **좁은 화면용 반응형 규칙**이 켜져 일부 버튼이 저절로 숨는다 — 이 검사가 그만큼 약해진다.
    //    (실측: allowlist 를 blocklist 로 되돌리는 변이에서 7개 중 3개만 검출됐다. 잡히긴 잡힌다.)
    //    창을 띄워 놓고 돌리면 온전해진다. 그래서 폭을 함께 찍어 결과를 과신하지 않게 한다.
    if (r === 1 && !vis.w) console.log(`  · 참고: 열람 창 뷰포트가 0폭이다(창이 안 그려짐) — 노출 검사가 약해진다`);
    ok(`R${r} 보이는 조작 수단이 허용 목록뿐이다`, extra.length === 0,
       `허용 밖: ${extra.join(", ")}`);
    ok(`R${r} 로그인 게이트가 뜨지 않는다`, shown.gate === false,
       '열람 창이 로그인을 묻는다 — 인증은 부모가 이미 했고, 봉인 때문에 이 게이트는 안 풀린다');

    //  ③ 봉인 — 열람 창에서 쓰기 명령을 직접 쏜다.
    //  ★★ **호스트 로그로 판정하지 않는다.** 1차 구현이 그렇게 했다가 눈이 멀었다:
    //    봉인을 일부러 깨고 돌렸는데도 통과했다. 원인은 WebView2 가 **자식 프레임의
    //    postMessage 를 최상위 WebMessageReceived 로 전달하지 않는다**는 것이었다
    //    (2026-09-03 실측: 봉인 해제 상태에서 iframe 이 postMessage 를 2회 불렀지만
    //     호스트 로그에는 한 줄도 안 남았다). 즉 로그는 봉인 여부와 무관하게 늘 깨끗하다.
    //    그래서 **문 자체에 계기를 단다** — postMessage 가 불렸는지를 센다.
    //    이러면 '호스트가 받았느냐'와 무관하게 **봉인이 실제로 잡고 있는지**를 본다.
    const sealed = JSON.parse(await cdp.ev(`(()=>{const w=document.querySelector("#pvHost iframe").contentWindow;
      let n=0; const orig=w.chrome.webview.postMessage.bind(w.chrome.webview);
      w.chrome.webview.postMessage=function(m){ n++; return orig(m); };
      const cmds=[{cmd:"loadProjects"},{cmd:"loadCodes"},{cmd:"saveState",state:{}},
                  {cmd:"replaceAllState",state:{}},{cmd:"netcusSubmit"},{cmd:"updateApply"}];
      let sent=0, err=null;
      try{ for(const c of cmds){ w.hpost(c); sent++; } }catch(e){ err="hpost 예외:"+e.message; }
      try{ w.eval("save()"); }catch(e){ err=err||("save 예외:"+e.message); }
      w.chrome.webview.postMessage=orig;
      return JSON.stringify({sent, posted:n, err}); })()`));
    ok(`R${r} 쓰기 명령 호출이 예외 없이 삼켜진다`, sealed.sent === 6 && !sealed.err,
       JSON.stringify(sealed));
    //  ★ 여기가 이 테스트의 핵심 한 줄이다 — 문이 한 번도 안 열려야 한다.
    ok(`R${r} **봉인**: 열람 창이 postMessage 를 한 번도 부르지 않았다`, sealed.posted === 0,
       `postMessage ${sealed.posted}회 — 봉인이 샌다`);

    //  ③b 봉인은 DB 를 지킨다. 그런데 **화면**은? — 지역 state 가 바뀐 채로 남으면
    //  사용자는 '남의 일정을 바꿨다'고 믿는다. 실제로 드래그&드롭이 그랬다(「옮겼습니다」 토스트).
    //  ★ 그래서 편집 경로를 **흉내내지 않고** 그 경로들이 하는 짓을 그대로 한다:
    //    state 를 직접 바꾸고 save() 를 부른다. save() 가 되돌려야 통과다.
    //    이 검사는 특정 버튼이 아니라 **모든 편집 경로의 공통 마지막 관문**을 본다 —
    //    새 편집 기능이 생겨도 그것이 save() 를 부르는 한 여기서 함께 지켜진다.
    const rev = JSON.parse(await cdp.ev(`(()=>{const w=document.querySelector("#pvHost iframe").contentWindow;
      try{ return w.eval("(function(){"
        + " var before=JSON.stringify(state.entries.map(function(e){return e.id+'@'+e.date;}));"
        + " var n0=state.entries.length;"
        + " if(state.entries[0]) state.entries[0].date='2000-01-02';"   /* 드래그&드롭이 하는 짓 */
        + " state.entries.push({id:'e-intruder',date:'2000-01-03',title:'침입',allDay:true});"
        + " if(state.todos) state.todos.length=0;"                       /* 할 일 몰살 */
        + " save();"
        + " var after=JSON.stringify(state.entries.map(function(e){return e.id+'@'+e.date;}));"
        + " return JSON.stringify({restored: before===after, n0:n0, n1:state.entries.length,"
        + "   intruder: state.entries.some(function(e){return e.id==='e-intruder';})});"
        + "})()"); }catch(e){ return JSON.stringify({err:String(e && e.message)}); }})()`));
    ok(`R${r} **되돌리기**: state 를 바꾸고 save() 해도 원본으로 돌아온다`,
       rev.restored === true && rev.intruder === false && rev.n0 === rev.n1,
       `복원=${rev.restored} 침입행=${rev.intruder} 행수 ${rev.n0}→${rev.n1}${rev.err ? ' · ' + rev.err : ''} — ` +
       'save() 의 peerRevert 가 없거나 원본 스냅샷(__peerPristine)이 안 잡혔다');
    await sleep(300);

    //  ④ 닫기 — 프레임이 사라져야 한다
    await cdp.ev('closeModal("#peerModal")');
    await sleep(400);
    const after = JSON.parse(await cdp.ev(`JSON.stringify({
      frames: document.querySelectorAll("#pvHost iframe").length,
      anyFrame: document.querySelectorAll("iframe[src*='peer=1']").length,
      pv: (__pv===null)?"null":"살아있음",
      myState: state.entries.length + "/" + state.categories.length })`));
    ok(`R${r} 닫으면 프레임이 사라진다`, after.frames === 0 && after.anyFrame === 0,
       `#pvHost ${after.frames} · 전체 ${after.anyFrame}`);
    ok(`R${r} __pv 가 비워진다(생명주기 종료)`, after.pv === 'null', after.pv);
    ok(`R${r} 내 화면 state 가 그대로다`, after.myState === myStateBase, `${myStateBase} → ${after.myState}`);
    if (r % 3 === 0) process.stdout.write(`  … ${r}/${ROUNDS} (실패 ${fail})\n`);
  }

  /* ── 누적 검증 — 여기가 루프의 값이다 ──────────────────────────── */
  console.log('\n[누적] 몇 번을 열고 닫아도 아무것도 안 변했는가');
  const end = {
    myEnt: num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${MYID}`),
    myCat: num(`SELECT COUNT(*) FROM cal_category WHERE user_id=${MYID}`),
    myRev: num(`SELECT rev FROM cal_user_rev WHERE user_id=${MYID}`),
    tgtEnt: num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${TUID}`),
    tgtRev: num(`SELECT rev FROM cal_user_rev WHERE user_id=${TUID}`),
  };
  for (const k of Object.keys(base))
    ok(`${k} 가 변하지 않았다`, end[k] === base[k], `${base[k]} → ${end[k]}`);
  //  ★ rev 는 저장이 새면 **반드시** 오른다(§3.1). 가장 예민한 계기판이다.
  ok('내 rev 가 한 번도 오르지 않았다(저장이 새지 않았다)', end.myRev === base.myRev,
     `${base.myRev} → ${end.myRev}`);

  const newLines = logSince(logBase);
  const hits = [];
  for (const [re, why] of FORBIDDEN) for (const l of newLines) if (re.test(l)) { hits.push(why + ' :: ' + l.trim()); break; }
  ok('호스트 로그에 금지 문구가 없다', hits.length === 0, hits.slice(0, 3).join(' | '));
  //  열람 조회 자체는 **있어야** 한다 — 없으면 위 '로그 깨끗함'은 아무 일도 안 한 결과다.
  const peerLines = await waitLog(logBase, /타인 일정 조회/, ROUNDS);
  ok(`열람 조회가 ${ROUNDS}회 찍혔다(검사가 헛돌지 않았다)`, peerLines >= ROUNDS,
     `${peerLines}회 / ${ROUNDS}회`);

  /* ── 검출력 시험 — 로그 오라클이 진짜 반응하는가 ────────────────── */
  console.log('\n[검출력] 로그 오라클이 정말 우는지 확인한다');
  const mark = logLines().length;
  //  ★ 부모 창의 hpost 는 봉인돼 있지 않다. 일부러 한 번 보내 오라클을 흔든다.
  await cdp.ev('hpost({cmd:"loadProjects"})');
  const probe = await waitLog(mark, /DB 과제 로드/, 1);
  ok('봉인되지 않은 곳에서 보내면 로그에 찍힌다 — 위의 「금지 문구 없음」이 유의미하다',
     probe > 0, `찍힌 줄 ${probe}`);

} catch (e) {
  fail++; F.push('중단: ' + e.message);
  console.log('\n[중단] ' + e.message);
} finally {
  try { if (cdp) { await cdp.ev('closeModal("#peerModal")').catch(() => {}); cdp.close(); } } catch { }
  try { wipeTarget(); } catch (e) { console.log('  ! 정리 실패: ' + e.message); }
}

console.log('\n' + '═'.repeat(72));
console.log(`통과 ${pass} · 실패 ${fail} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
if (F.length) { console.log('\n실패 목록:'); F.slice(0, 20).forEach((f) => console.log('  · ' + f)); }
console.log(fail === 0
  ? '열람 창 검증 통과 ✓ — 그 사람 것이 뜨고, 아무것도 못 내보내고, 아무것도 안 변한다.'
  : '★ 실패 — 열람 창이 남의 데이터를 다루는 자리다. 배포 전에 고칠 것.');
console.log('═'.repeat(72));
process.exit(fail === 0 ? 0 : 1);
