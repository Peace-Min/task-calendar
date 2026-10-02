#!/usr/bin/env node
/* ============================================================================
 *  tests/loop-peer-frame.mjs — 타인 일정 열람 **창**의 실동작 루프 검증 (C4)
 * ----------------------------------------------------------------------------
 *  증명하는 명제 넷:
 *    ① 「내 일정 겹쳐보기」를 **끄면** 열람 창에는 **그 사람의** 일정만 뜬다
 *    ①' 「내 일정 겹쳐보기」를 **켜면**(C4.1 · 기본값) 내 일정이 한 겹 함께 뜨되,
 *        내 것은 내 색 칩(chip-mine · 연한 채움 + 왼쪽 막대)에 draggable=false 이고 **고칠 수 없다**(save 가 되돌린다)
 *    ② 그 창은 호스트로 **아무것도 내보내지 못한다** — 봉인
 *    ③ 몇 번을 열고 닫아도 **내 데이터도 DB 도 변하지 않고**, 프레임이 쌓이지 않는다
 *    ④ 「나란히 보기」(2026-10-02 · docs/PEER-SIDE-BY-SIDE.md R2·R3·R4·R8·R9)에서도 같다 — 왼쪽 = 그 사람 · 오른쪽 = 나로
 *        섞이지 않고, 같은 주 줄 높이가 맞고(±1px), 좁으면 쌓이고, 전환·클릭·시트 내내 postMessage 0회.
 *        실행이 끝나면 보기 방식(tc_peerLayout)은 시작 전 값으로 되돌린다.
 *    ⑤ 「사람 고르기」(2026-10-02 · docs/PEER-PICKER.md R10) — 툴바 👥 → 검색 → 열람 → 최근 → ☆ 즐겨찾기(팝오버 = 열람 창) →
 *        열람 창 ▾ 사람 바꾸기(두 번째 대상 __pf_target2__ 로 · 보는 중 · 보던 달 잇기) → 바뀐 창도 postMessage 0 · DB 무변화.
 *        실행이 끝나면 내 계정의 tc_peerFav:<me> · tc_peerRecent:<me> 는 시작 전 값으로 되돌린다.
 *
 *  ★★ 2026-09-09 — 이 시험이 낡아서 실패했던 자리(고친 경위):
 *    2026-09-07 에 C4.1 「내 일정 겹쳐보기」가 들어왔고 **기본값이 켬**이다. 그래서 열람 창에는
 *    대상 3건이 아니라 3 + 내 겹 이 뜬다. 이 시험은 겹을 모른 채 `state.entries.length === 3` 을
 *    요구해 R4~R8 이 줄줄이 붉었다 — **기능이 옳고 시험이 낡은 것**이었다.
 *    고치면서 배운 것을 남긴다: 내 겹은 **토글과 무관하게 늘 payload 에 들어 있고**, 토글은
 *    그리는 단계(passFilter)에서 걸린다. 그래서 개수는 반드시 **앱 자신의 판정 함수로** 세야 한다.
 *    state.entries 를 세면 토글이 무슨 일을 하는지 원리적으로 못 본다.
 *
 *  ★ tests/peer-overlay.test.mjs 와 역할을 나눈다 — 그쪽은 소스·jsdom 계약(buildMineOverlay 가
 *    무엇을 안 보내는가, 봉인이 여전한가)을 본다. 여기서는 **실제 위젯의 실동작**만 본다.
 *    같은 단언을 두 번 쓰지 않는다.
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
  const r = spawnSync(MYSQL, [`-u${USER}`, `-p${PW}`, (process.env.TC_TEST_DB_NAME || 'taskmgr'), '-N', '-B', '-e', q], { encoding: 'utf8' });
  if (r.status !== 0) {
    const lines = (r.stderr || '').split('\n').filter((l) => l.trim() && !/Using a password/.test(l));
    throw new Error(`${what} 실패: ${lines[0] || '(stderr 없음)'}`);
  }
  //  ★ /\r?\n/ 로 자른다 — mysql.exe 는 Windows 에서 \r\n 을 내므로 '\n' 으로만 자르면
  //    각 행의 마지막 열에 \r 가 남는다. 한 행짜리 결과는 바깥 .trim() 이 가려 주기 때문에
  //    지금껏 조용했고, Number() 는 \r 를 공백으로 먹어 더 조용하다 — 여러 행 문자열 비교에서만
  //    어긋난다. 그런 종류의 결함은 '언젠가 이상한 실패' 로 돌아온다. 다른 러너는 이미 /\r?\n/ 다.
  const rows = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  //  재발하면 조용히 틀리는 대신 크게 실패시킨다(판정 불가 ≠ 통과).
  for (const row of rows) for (const cell of row) {
    if (cell.includes('\r')) throw new Error(`${what}: 결과 셀에 CR 가 남았다 — 줄 자르기가 다시 좁아졌다: ${JSON.stringify(cell)}`);
  }
  return rows;
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

/* ══════════════════════════════════════════════════════════════════════
 *  C4.1 「내 일정 겹쳐보기」를 다루는 도구들
 * ══════════════════════════════════════════════════════════════════════ */
const FRAME_W = 'document.querySelector("#pvHost iframe").contentWindow';

//  겹 토글을 **앱이 사람에게 준 그 경로로** 누른다 — 배너 범례의 「내 일정」 칩이다(click → setPeerOverlay).
//  ★ 2026-10-01(docs/PEER-OVERLAY-REDESIGN.md O1·O6) — 체크박스가 토글 버튼(aria-pressed)으로 바뀌었다.
//    켜짐/꺼짐은 checked 가 아니라 aria-pressed 로 읽는다(상태의 단일 출처 __peerOverlay 가 그 속성을 세운다).
//  ★ 상태를 만드는 것은 시험의 일이다. 앱을 고치거나 내부 변수에 직접 대입하면
//    "사용자가 껐을 때 정말 이렇게 되는가" 를 증명하지 못한다.
//  ★ 설정은 localStorage(tc_peerOverlay) 라 **라운드를 넘어 남는다.** 그래서 라운드마다
//    원하는 상태를 명시적으로 만들고, 읽어 온 값으로 그것이 실제로 섰는지 확인한다.
async function setOverlay(cdp, on) {
  const r = JSON.parse(await cdp.ev(`(()=>{const w=${FRAME_W};
    const t=w.document.getElementById("peerOverlayToggle");
    if(!t) return JSON.stringify({err:"배너에 #peerOverlayToggle 이 없다 — 겹 토글이 사라졌거나 배너가 안 그려졌다"});
    if((t.getAttribute("aria-pressed") === "true") !== ${on ? 'true' : 'false'}) t.click();
    return JSON.stringify({pressed:(t.getAttribute("aria-pressed") === "true"),
      attr:(w.document.body.dataset.peerOverlay || null),
      ls:(()=>{try{ return w.localStorage.getItem("tc_peerOverlay"); }catch(_){ return "(못 읽음)"; }})()});})()`));
  if (r.err) throw new Error('겹 토글 조작 실패: ' + r.err);
  await sleep(150);   // renderAll() 이 돌 틈
  return r;
}

/* ══════════════════════════════════════════════════════════════════════
 *  「나란히 보기」(docs/PEER-SIDE-BY-SIDE.md · R2·R3·R4·R8·R9)를 다루는 도구들
 * ══════════════════════════════════════════════════════════════════════ */
//  보기 방식도 **사람이 누르는 그 버튼**으로 바꾼다 — 배너의 분할 버튼 [겹쳐 보기 | 나란히 보기](click → setPeerLayout).
//  ★ 설정은 localStorage(tc_peerLayout)라 라운드·실행을 넘어 남는다 — 그래서 라운드 첫머리에 겹쳐 보기를 명시적으로 세우고,
//    실행이 끝나면(finally) 시작 전 값으로 되돌린다(사람이 고른 보기 방식을 이 시험이 바꿔 놓지 않는다).
async function setLayout(cdp, v) {
  const r = JSON.parse(await cdp.ev(`(()=>{const w=${FRAME_W};
    const b=w.document.querySelector('#peerBanner .peer-layout [data-layout="${v}"]');
    if(!b) return JSON.stringify({err:"배너에 보기 방식 버튼(${v})이 없다 — 분할 버튼이 사라졌거나 배너가 안 그려졌다"});
    if(b.getAttribute("aria-pressed") !== "true") b.click();
    return JSON.stringify({pressed:(b.getAttribute("aria-pressed") === "true"),
      attr:(w.document.body.dataset.peerLayout || null),
      ls:(()=>{try{ return w.localStorage.getItem("tc_peerLayout"); }catch(_){ return "(못 읽음)"; }})()});})()`));
  if (r.err) throw new Error('보기 방식 조작 실패: ' + r.err);
  await sleep(200);   // renderAll() 이 돌 틈
  return r;
}
//  두 달력의 내용 나누기(R2) — 그 사람 일정이 있는 달(6월)에서 센다. 내 칩은 오른쪽에 **실제로 그려진** 달을 찾아서 본다.
async function sideProbe(cdp) {
  return JSON.parse(await cdp.ev(`(()=>{const w=${FRAME_W}, d=w.document;
    w.eval("view={y:2026,m:5}; selectedDate='2026-06-11'; renderAll();");
    const ids=["e-pf-0","e-pf-1","e-pf-2"];
    const r={
      cellsL:d.querySelectorAll("#grid .cell").length, cellsR:d.querySelectorAll("#gridMine .cell").length,
      wkR:d.querySelectorAll("#weekdaysMine > div").length,
      tabL:(d.getElementById("calTabPeer")||{}).textContent||"", tabR:(d.getElementById("calTabMine")||{}).textContent||"",
      theirsL:ids.filter((id)=>d.querySelector('#grid .chip[data-id="'+id+'"]')).length,
      theirsR:ids.filter((id)=>d.querySelector('#gridMine .chip[data-id="'+id+'"]')).length,
      toggleShown:(()=>{const t=d.getElementById("peerOverlayToggle"); return !!t && w.getComputedStyle(t).display!=="none";})(),
      mineL:0, otherR:0, mineR:-1, mineAt:"" };
    const st=w.__test.state();
    const mine=st.entries.filter((e)=>e&&e._mine).slice(0,12);
    for(const e of mine){
      const ds=String(e.date||""); const y=Number(ds.slice(0,4)), mo=Number(ds.slice(5,7)); if(!y||!mo) continue;
      w.eval("view.y="+y+"; view.m="+(mo-1)+"; renderGrid();");
      r.mineL=Math.max(r.mineL, d.querySelectorAll("#grid .chip.chip-mine").length);
      r.otherR=Math.max(r.otherR, d.querySelectorAll("#gridMine .chip:not(.chip-mine)").length);
      if(d.querySelector('#gridMine .chip[data-id="'+e.id+'"]')){
        r.mineR=d.querySelectorAll("#gridMine .chip.chip-mine").length; r.mineAt=ds;
        r.mineInL=!!d.querySelector('#grid .chip[data-id="'+e.id+'"]'); break; }
    }
    w.eval("view={y:2026,m:5}; selectedDate='2026-06-11'; renderAll();");
    return JSON.stringify(r);})()`));
}
//  줄 맞춤(R3)·좁은 창 쌓기(R8)를 **잰다.** 열람 프레임의 폭을 부모 쪽에서 잠시 정해(wpx) 레이아웃을 확정한 뒤 두 달력의 주 줄 높이를 비교한다.
//  ★ 위젯 창이 좁거나(≤860 이면 늘 쌓인다) 안 그려지면(0×0) 좌우 줄 맞춤을 잴 수 없다 — 그래서 폭·높이를 CSS 로 박아 둔다.
//    박은 값은 sideRowsReset 으로 걷는다(라운드 끝에 프레임을 닫기도 한다).
async function sideRows(cdp, wpx) {
  await cdp.ev(`(()=>{const f=document.querySelector("#pvHost iframe"); if(!f) return 0;
    f.style.width="${wpx}px"; f.style.maxWidth="none"; f.style.height="800px"; f.style.flex="none"; return 1;})()`);
  await sleep(450);   // 프레임 resize → ResizeObserver/rAF 줄 맞춤 · 「+N」
  return JSON.parse(await cdp.ev(`(()=>{const w=${FRAME_W}, d=w.document;
    const a=d.querySelector("main > section.cal").getBoundingClientRect(), b=d.getElementById("calMine").getBoundingClientRect();
    const rows=(g)=>Array.prototype.map.call(d.querySelectorAll("#"+g+" .gridrow"), (x)=>{ const c=x.querySelector(".cell"); return c ? c.getBoundingClientRect().height : 0; });
    const L=rows("grid"), R=rows("gridMine");
    return JSON.stringify({vw:w.innerWidth, dir:w.getComputedStyle(d.querySelector("main")).flexDirection,
      stacked:(b.top >= a.bottom - 1), sideBySide:(b.left >= a.right - 1 && Math.abs(b.top - a.top) < 2),
      rowsN:[L.length, R.length], zero:L.concat(R).some((h)=>!(h > 0)),
      maxDiff:(L.length === R.length && L.length) ? Math.max(...L.map((h,i)=>Math.abs(h - R[i]))) : -1,
      L:L.map((h)=>Math.round(h)), R:R.map((h)=>Math.round(h))});})()`));
}
async function sideRowsReset(cdp) {
  await cdp.ev(`(()=>{const f=document.querySelector("#pvHost iframe"); if(f){ f.style.width=""; f.style.maxWidth=""; f.style.height=""; f.style.flex=""; } return 1;})()`);
  await sleep(250);
}
async function setDensity(cdp, v) {
  const r = await cdp.ev(`(()=>{const w=${FRAME_W};
    const x=w.document.querySelector('#peerBanner input[name="peerDensity"][value="${v}"]');
    if(!x) return "없음"; if(!x.checked) x.click(); return w.calDensity();})()`);
  await sleep(200);
  return r;
}
let R3_MEASURED = 0;   // 좌우 줄 맞춤을 실제로 잰 횟수 — 0 이면 끝에서 실패시킨다(판정 불가 ≠ 통과)

//  지금 **보이는 것**을 앱 자신의 판정 함수(passFilter)로 센다 — 데이터 개수가 아니다.
//  ★ passFilter 가 없으면 세지 않고 실패시킨다(판정 불가 ≠ 통과).
async function visible(cdp) {
  const r = JSON.parse(await cdp.ev(`(()=>{const w=${FRAME_W};
    if(typeof w.passFilter !== "function") return JSON.stringify({err:"프레임에 passFilter 가 없다 — 이 시험은 아무것도 세지 못한다"});
    const st=w.__test.state(), mine=(e)=>!!(e&&e._mine);
    const vis=st.entries.filter((e)=>w.passFilter(e));
    return JSON.stringify({
      dataAll: st.entries.length,          // payload 에 들어온 전부(토글과 무관)
      dataMine: st.entries.filter(mine).length,
      visTheirs: vis.filter((e)=>!mine(e)).length,
      visMine: vis.filter(mine).length,
      theirTitles: vis.filter((e)=>!mine(e)).map((e)=>e.title).sort(),
      chipMine: w.document.querySelectorAll("#grid .chip.chip-mine").length,
      attr: (w.document.body.dataset.peerOverlay || null)});})()`));
  if (r.err) throw new Error(r.err);
  return r;
}

//  내 겹이 **어떻게 그려지는가** — 격자에 칩이 실제로 있는 달로 옮겨 가서 본다.
//  ★ 후보를 훑는다: 열린 달에 내 일정이 없으면 칩이 아예 없어 아무것도 못 본다.
//    끝까지 못 찾으면 통과가 아니라 실패다.
async function mineChipProbe(cdp) {
  return JSON.parse(await cdp.ev(`(()=>{const w=${FRAME_W};
    const st=w.__test.state();
    const mine=st.entries.filter((e)=>e&&e._mine);
    if(!mine.length) return JSON.stringify({err:"프레임에 _mine 일정이 하나도 없다 — 부모가 겹을 안 보냈다"});
    const cand=mine.slice(0,12);
    for(const e of cand){
      const d=String(e.date||""); const y=Number(d.slice(0,4)), mo=Number(d.slice(5,7));
      if(!y||!mo) continue;
      w.eval("view.y="+y+"; view.m="+(mo-1)+"; selectedDate="+JSON.stringify(d)
             +"; renderAll(); if(typeof renderPanel==='function') renderPanel();");
      const chip=w.document.querySelector('#grid .chip[data-id="'+e.id+'"]');
      if(!chip) continue;
      const card=w.document.querySelector('#dpBody .card[data-id="'+e.id+'"]');
      return JSON.stringify({
        id:e.id, date:d,
        chipMine: chip.classList.contains("chip-mine"),
        draggable: chip.getAttribute("draggable"),
        card: !!card,
        cardMine: !!(card && card.classList.contains("card-mine"))});
    }
    return JSON.stringify({err:"내 겹 중 격자에 칩이 그려진 것을 찾지 못했다(후보 "+cand.length+"건)"});})()`));
}

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
function wipeTarget() { wipeUser(TU); }
function wipeUser(login) {
  const u = one(`SELECT user_id FROM app_user WHERE login_id='${login}'`); if (!u) return;
  for (const t of ['cal_entry_commit', 'cal_entry_except', 'cal_todo_day_note', 'cal_task_hours',
                   'cal_attendance', 'cal_entry', 'cal_todo', 'cal_category', 'cal_room', 'cal_user_pref'])
    sql(`DELETE FROM ${t} WHERE user_id=${u}`, `정리(${t})`);
  sql(`DELETE FROM cal_user_rev WHERE user_id=${u}`, 'rev 정리');
  sql(`DELETE FROM app_user WHERE user_id=${u}`, '대상 삭제');
}

/* ── 두 번째 시험 대상 — 「사람 고르기」(docs/PEER-PICKER.md R10) 의 ▾ 사람 바꾸기를 **진짜로** 바꾸려면 둘이어야 한다 ──
 *   첫 대상과 같은 방식·같은 정리(wipeUser)로 심는다. 일정도 다르게 심는다(바꾼 뒤 「그 사람 것」이 떴는지 가르려고).
 *   ★ 같은 6월에 심는다 — 바꾸기가 **보던 달(6월)** 을 잇는지 보려면 거기에 그 사람 일정이 있어야 한다. */
const TU2 = '__pf_target2__';
const TITLES2 = ['열람대상둘 델타'];
function seedTarget2() {
  wipeUser(TU2);
  const org = one(`SELECT org_id FROM org_unit WHERE is_active=1 ORDER BY sort_order LIMIT 1`);
  sql(`INSERT INTO app_user (login_id, name, org_id, view_scope, edit_role, is_active) ` +
      `VALUES ('${TU2}', '열람대상둘', ${org}, 'self', 'viewer', 1)`, '대상2 생성');
  const u = one(`SELECT user_id FROM app_user WHERE login_id='${TU2}'`);
  sql(`INSERT IGNORE INTO cal_user_rev (user_id, rev) VALUES (${u}, 0)`, '대상2 rev 시딩');
  sql(`INSERT INTO cal_category (user_id,cat_no,uid,source,name,color,sort_order,created_at,updated_at) ` +
      `VALUES (${u},1,'c-pf2-1','local','열람시험과제2','#2e9e6b',0,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000')`, '대상2 과제');
  TITLES2.forEach((t, i) => {
    sql(`INSERT INTO cal_entry (user_id,entry_no,uid,cat_no,entry_date,all_day,title,memo,source,location,sort_order,created_at,updated_at) ` +
        `VALUES (${u},${i + 1},'e-pf2-${i}',1,'2026-06-1${i + 5}',1,'${t}','','','',${i},` +
        `'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000')`, '대상2 일정' + i);
  });
  return Number(u);
}

/* ── 「사람 고르기」 도구 — 사람이 누르는 그 자리(툴바 👥 · 검색 칸 · 행 · ☆ · ▾)로만 조작한다 ─────────── */
//  팝오버 상태·행을 읽는다(행은 data-login 으로 가린다 — 이름은 동명이인이 있다).
async function pkState(cdp) {
  return JSON.parse(await cdp.ev(`(()=>{const p=document.getElementById("peerPicker");
    const rows=[...document.querySelectorAll("#pkBody [data-sec] .pk-row")].map((r)=>{const o=r.querySelector(".pk-open"), s=r.querySelector(".pk-star");
      return {sec:r.closest("[data-sec]").dataset.sec, id:o.dataset.login, text:o.textContent.replace(/\\s+/g," ").trim(),
              off:o.getAttribute("aria-disabled")==="true", star:s ? s.getAttribute("aria-pressed") : null};});
    return JSON.stringify({open:!!p && !p.classList.contains("hidden"), inModal:!!(p && p.closest("#peerModal")),
      status:(typeof __pk!=="undefined" && __pk) ? __pk.status : null, focus:(document.activeElement||{}).id||"", rows});})()`));
}
async function pkWait(cdp) {
  for (let i = 0; i < 60; i++) { const s = await pkState(cdp); if (s.status && s.status !== 'loading') return s; await sleep(200); }
  return pkState(cdp);
}
async function pkType(cdp, v) {
  await cdp.ev(`(()=>{const i=document.getElementById("pkSearch"); i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event("input",{bubbles:true})); return 1;})()`);
  await sleep(120);
  return pkState(cdp);
}
async function pkClickRow(cdp, login, act = 'open') {
  return cdp.ev(`(()=>{const b=[...document.querySelectorAll('#pkBody [data-act="${act}"]')].find((x)=>x.dataset.login===${JSON.stringify(login)});
    if(!b) return false; b.click(); return true;})()`);
}
//  열람 프레임이 그 사람 데이터로 떴나 — 조회·주입이 끝날 때까지 기다린다(프레임 교체 중이면 옛 것을 읽지 않게 제목도 함께 본다).
async function waitPeerFrame(cdp, title) {
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    const r = JSON.parse(await cdp.ev(`(()=>{const f=document.querySelector("#pvHost iframe");
      let n=-1; try{ n = f && f.contentWindow && f.contentWindow.__test ? f.contentWindow.__test.counts().entries : -1; }catch(_){}
      return JSON.stringify({n, title:(document.getElementById("pvTitle")||{}).textContent||"", frames:document.querySelectorAll("#pvHost iframe").length});})()`));
    if (r.n >= 0 && r.title === title + ' 님의 일정') return r;
  }
  return { n: -1, title: '', frames: -1 };
}

/* ── main ──────────────────────────────────────────────────────────────── */
const t0 = Date.now();
console.log('═'.repeat(72));
console.log(`타인 일정 열람 창 — 실동작 루프 (라운드 ${ROUNDS} · 실 위젯 · 실 DB)`);
console.log('═'.repeat(72));

let cdp, TUID = 0, TU2ID = 0;
//  사람이 골라 둔 보기 방식(tc_peerLayout) — 시험이 라운드마다 겹쳐 보기·나란히 보기를 오가므로 끝나면 이 값으로 되돌린다.
//  undefined = 아직 못 읽음(되돌리지 않는다) · null = 저장값 없음(지운다).
let LAYOUT0;
//  사람 고르기(R10)가 쓰는 내 계정별 키 — 즐겨찾기·최근(tc_peerFav:<me> · tc_peerRecent:<me>). 시작 전 값을 떠 두고 끝나면 되돌린다.
//  undefined = 아직 못 읽음(되돌리지 않는다).
let PK0, PK_KEYS = null;
try {
  TUID = seedTarget();
  TU2ID = seedTarget2();
  cdp = await Cdp.attach(PORT);
  //  ★ 부모와 열람 프레임은 같은 출처라 localStorage 가 같다 — 부모에서 읽고 되돌린다.
  LAYOUT0 = await cdp.ev("(()=>{ try{ return localStorage.getItem('tc_peerLayout'); }catch(_){ return null; } })()");

  const me = String(await cdp.ev("(typeof currentUser!=='undefined' && currentUser && currentUser.loginId) || ''")).trim();
  PK_KEYS = { fav: 'tc_peerFav:' + me, recent: 'tc_peerRecent:' + me };
  PK0 = JSON.parse(await cdp.ev(`JSON.stringify({ fav: localStorage.getItem(${JSON.stringify(PK_KEYS.fav)}), recent: localStorage.getItem(${JSON.stringify(PK_KEYS.recent)}) })`));
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
    tgt2Ent: num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${TU2ID}`),
    tgt2Rev: num(`SELECT rev FROM cal_user_rev WHERE user_id=${TU2ID}`),
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

    //  ①-00 보기 방식을 **겹쳐 보기**로 먼저 세운다 — 아래 ①~①' 은 겹쳐 보기의 명제다.
    //  ★ 나란히 보기에서는 내 겹이 토글과 무관하게 통과하므로(S9) 「겹을 끄면 대상 것만」 이 원리적으로 성립하지 않는다.
    //    사람이 마지막에 나란히 보기를 골라 두었으면 그 값이 저장돼 있다 — 그래서 명시적으로 세운다(끝나면 되돌린다).
    const ovLay = await setLayout(cdp, 'overlay');
    ok(`R${r} 보기 방식을 겹쳐 보기로 세웠다(분할 버튼 · body 스위치 없음 · tc_peerLayout=overlay 또는 미저장)`,
       ovLay.pressed === true && ovLay.attr === null && (ovLay.ls === 'overlay' || ovLay.ls === null),   // null = 한 번도 안 골랐다(기본값 겹쳐 보기)
       `aria-pressed=${ovLay.pressed} data-peer-layout=${ovLay.attr} tc_peerLayout=${ovLay.ls}`);

    //  ①-0 **겹쳐보기를 끈 상태를 먼저 만든다.** 아래 ② 는 "대상의 것만 보인다" 를 보는데,
    //  기본값이 켬이므로 끄지 않으면 내 겹까지 세어 대상 3건과 어긋난다(2026-09-09 실패 원인).
    //  ★ 끄고 켜는 것은 그 다음 ①' 에서 왕복으로 다시 본다.
    const offSt = await setOverlay(cdp, false);
    ok(`R${r} 겹 토글을 끄면 「내 일정」 칩이 꺼짐(aria-pressed=false)이 되고 body 의 스위치도 내려간다`,
       offSt.pressed === false && offSt.attr === null && offSt.ls === '0',
       `aria-pressed=${offSt.pressed} data-peer-overlay=${offSt.attr} tc_peerOverlay=${offSt.ls}`);

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
        //  ★ 개수·제목은 여기서 세지 않는다 — 겹 때문에 데이터 개수는 '보이는 것'이 아니다.
        //    그 판정은 위의 visible()(passFilter) 이 맡는다.
        peerAttr: w.document.body.dataset.peer||null,
        banner: (w.document.getElementById("peerBanner")||{}).textContent||"",
        grid: w.document.querySelectorAll("#grid .cell").length,
        chips: w.document.querySelectorAll("#filterbar .fchip").length,
        //  ★ 로그인 게이트가 덮고 있으면 달력이 보여도 사용자는 로그인 화면만 본다.
        //    그리고 봉인 때문에 그 게이트는 **영영 안 풀린다**(2026-09-03 사용자 지적).
        gate: (()=>{ const g=w.document.getElementById("loginGate");
                     return g ? (getComputedStyle(g).display !== "none" && !g.classList.contains("hidden")) : false; })(),
        memoLeak: JSON.stringify(st).includes("비밀메모") });})()`));
    //  ★ 개수는 **앱의 passFilter 로** 센다 — 내 겹은 토글과 무관하게 payload 에 늘 들어 있어서
    //    state.entries 를 세면 "겹을 껐다" 를 확인할 수가 없다(2026-09-09 에 배운 것).
    const off = await visible(cdp);
    ok(`R${r} 겹을 끄면 대상의 일정 ${TITLES.length}건만 보인다(내 것 0건)`,
       off.visTheirs === TITLES.length && off.visMine === 0,
       `대상 ${off.visTheirs}건 · 내 겹 ${off.visMine}건(payload 에는 내 겹 ${off.dataMine}건이 그대로 있다)`);
    ok(`R${r} 겹을 끄면 내 겹 칩이 격자에 하나도 없다`, off.chipMine === 0, `chip-mine ${off.chipMine}개`);
    ok(`R${r} 제목이 대상의 것이다`, JSON.stringify(off.theirTitles) === JSON.stringify([...TITLES].sort()),
       off.theirTitles.join(','));
    ok(`R${r} 읽기 전용 표시가 있다`, shown.peerAttr === '1' && /읽기 전용/.test(shown.banner), shown.banner);
    ok(`R${r} 같은 캘린더 UI 가 그대로 뜬다(격자·과제 필터)`, shown.grid === 35 && shown.chips >= 1,
       `격자 ${shown.grid} · 필터칩 ${shown.chips}`);
    //  ★ 2026-10-01 PEER-VIEW-FULL P2 — 열람 창은 메인 화면에 보이는 것을 다 보인다. 대상의 메모는 이제 **보여야** 한다
    //    (예전 「메모가 새지 않는다」는 최소 payload 시절의 기대였다). 내 겹(P6)은 여전히 일정 한 겹뿐이다.
    ok(`R${r} 대상 일정의 메모가 열람 창에 온다(P2)`, shown.memoLeak === true);

    //  ②b 호스트가 부모에 채워 준 것이 **프레임으로 넘어오지 않는가.**
    //  ★ 호스트는 web.CoreWebView2.ExecuteScriptAsync 만 쓴다 — 최상위 문서 전용이고
    //    ExecuteScriptInFrameAsync 는 이 저장소에 없다. 그래서 콜백은 프레임에 안 간다.
    //    실측으로도 확인했다(2026-09-03: 부모 __applyProjects/__applyCodes/__hostReply 3종이
    //    움직이는 동안 프레임 계기는 0). 여기서는 그 결과를 **싸게** 지킨다 —
    //    공식 과제 목록이 부모엔 있고 프레임엔 없어야 한다.
    //  ★ 부모가 0이면 이 비교는 아무것도 증명하지 않으므로 그때는 판정하지 않고 말한다.
    const cat = JSON.parse(await cdp.ev(`(()=>{
      const mine = (typeof dbCatalog !== "undefined" && dbCatalog) ? dbCatalog.length : -1;
      const w = document.querySelector("#pvHost iframe").contentWindow;
      let theirs = -1;
      try{ theirs = Number(w.eval("(typeof dbCatalog!=='undefined' && dbCatalog) ? dbCatalog.length : -1")); }catch(_){}
      return JSON.stringify({mine, theirs}); })()`));
    if (cat.mine <= 0) {
      console.log(`  · 참고: 부모의 공식 과제 목록이 ${cat.mine}개라 프레임 대조를 건너뛴다(전제 불충족)`);
    } else {
      ok(`R${r} 호스트가 부모에 준 공식 과제가 프레임엔 없다`, cat.theirs === 0,
         `부모 ${cat.mine}개 · 프레임 ${cat.theirs}개 — 호스트 데이터가 프레임으로 넘어갔다`);
    }
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
                           "fchip","dpSheetClose","dptab-detail",
                           //  ★ 2026-10-01(PEER-VIEW-FULL P2) — 「할 일」·「커밋 내역」 탭을 연다(읽기). 탭 안의 편집 수단은 여전히 감춘다.
                           "dptab-todo","dptab-git"]);
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

    //  ③a **통제군** — 위의 0회가 *봉인 때문인지* 확인한다.
    //  ★ 0회는 두 가지를 뜻할 수 있다: (a) 봉인이 잡았다, (b) 그 조작이 원래 아무것도 안 한다.
    //    (b) 면 위 한 줄은 아무것도 증명하지 않는다. 그래서 **같은 명령을 부모에서** 쏴 보고
    //    거기서는 반드시 나가는 것을 확인한다. 나가지 않으면 이 시험 전체가 헛돌고 있는 것이다.
    //    (2026-09-03 감사에서 이 통제군이 없어 '봉인의 증거'라고 말할 근거가 없었다.)
    //  ★ 부모의 postMessage 는 **삼킨다**(원본을 부르지 않는다) — 진짜로 나가면 호스트가 실행한다.
    const ctl = JSON.parse(await cdp.ev(`(()=>{
      let n=0; const orig=window.chrome.webview.postMessage.bind(window.chrome.webview);
      window.chrome.webview.postMessage=function(m){ n++; };   // 삼킨다
      let err=null;
      try{ hpost({cmd:"loadCodes"}); hpost({cmd:"loadProjects"}); }catch(e){ err=e.message; }
      window.chrome.webview.postMessage=orig;
      return JSON.stringify({posted:n, err}); })()`));
    ok(`R${r} **통제군**: 같은 명령이 부모에서는 실제로 나간다`, ctl.posted > 0 && !ctl.err,
       `부모 postMessage ${ctl.posted}회${ctl.err ? ' · ' + ctl.err : ''} — ` +
       '부모에서도 안 나가면 위의 「봉인」 판정은 근거가 없다(조작 자체가 무해한 것일 뿐)');

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

    //  ①' C4.1 「내 일정 겹쳐보기」 — **켠 상태**의 실동작.
    //  ★ 여기가 이번(2026-09-09) 보완의 실질이다. 그전까지 이 파일에는 peerOverlay·_mine 이
    //    한 글자도 없었다 — 기능이 들어온 지 이틀이 지나도록 아무도 이 창에서 그것을 보지 않았다.
    const onSt = await setOverlay(cdp, true);
    ok(`R${r} 겹 토글을 켜면 「내 일정」 칩이 켜짐(aria-pressed=true)이 되고 body 의 스위치가 선다`,
       onSt.pressed === true && onSt.attr === '1' && onSt.ls === '1',
       `aria-pressed=${onSt.pressed} data-peer-overlay=${onSt.attr} tc_peerOverlay=${onSt.ls}`);

    const on = await visible(cdp);
    //  통제군 — 부모가 실제로 겹을 만들어 보냈는가. 부모의 비-git 일정 수와 맞아야 한다.
    //  (0 건이면 아래 "함께 보인다" 는 아무것도 증명하지 않는다.)
    const parentMine = Number(await cdp.ev(`state.entries.filter(e=>e && e.source!=='git').length`));
    ok(`R${r} 부모가 보낸 겹의 수가 부모의 비-git 일정 수와 같다(겹이 실제로 만들어졌다)`,
       on.dataMine === parentMine && parentMine > 0,
       `프레임 _mine ${on.dataMine}건 · 부모 비-git ${parentMine}건 — 0 이면 아래 검사들이 헛돈다`);
    ok(`R${r} 겹을 켜면 내 일정이 **함께** 보인다(대상 ${TITLES.length}건 + 내 ${on.dataMine}건)`,
       on.visTheirs === TITLES.length && on.visMine === on.dataMine && on.visMine > 0,
       `대상 ${on.visTheirs}건 · 내 겹 ${on.visMine}/${on.dataMine}건`);

    //  내 것은 **모양으로** 구분되고 끌 수 없다 — 끌리는 것처럼 보이는 것 자체가 거짓말이다.
    const mc = await mineChipProbe(cdp);
    ok(`R${r} 내 겹 칩을 격자에서 찾았다`, !mc.err, mc.err || `${mc.id}@${mc.date}`);
    if (!mc.err) {
      ok(`R${r} 내 겹 칩이 chip-mine 이다(내 색 — 연한 채움 + 왼쪽 막대)`, mc.chipMine === true, `class 에 chip-mine 없음`);
      ok(`R${r} 내 겹 칩은 draggable="false" 다`, mc.draggable === 'false', `draggable=${mc.draggable}`);
      ok(`R${r} 일자 패널의 내 겹 카드가 card-mine 이다`, mc.card === true && mc.cardMine === true,
         `card=${mc.card} card-mine=${mc.cardMine}`);
    }

    //  ★ **내 것도 고칠 수 없다.** ③b 는 대상의 일정으로 저장 문을 확인했다. 겹이 들어오면서
    //    "내 일정이니 내가 고쳐도 되지 않나" 로 새기 가장 쉬운 자리가 생겼다 — 그런데 이 창은
    //    부모로 나가는 문이 봉인돼 있어, 여기서 고친 것은 **어디에도 반영되지 않는다.**
    //    그러니 되돌아가야 한다(save() 의 if(PEER){ peerRevert(); return; }).
    const mineLock = JSON.parse(await cdp.ev(`(()=>{const w=${FRAME_W};
      try{ return w.eval("(function(){"
        + " var i=state.entries.findIndex(function(e){return e && e._mine;});"
        + " if(i<0) return JSON.stringify({err:'_mine 일정이 없다'});"
        + " var id=state.entries[i].id, d0=state.entries[i].date, t0=state.entries[i].title;"
        + " state.entries[i].date='2000-01-04'; state.entries[i].title='내 것을 열람 창에서 고쳤다';"
        + " save();"
        + " var e=state.entries.filter(function(x){return x.id===id;})[0];"
        + " return JSON.stringify({restored: !!e && e.date===d0 && e.title===t0,"
        + "   stillMine: !!(e && e._mine), n:state.entries.length});})()");
      }catch(e){ return JSON.stringify({err:String(e && e.message)}); }})()`));
    ok(`R${r} **내 겹도 읽기 전용**: 고치고 save() 해도 원본으로 돌아온다`,
       mineLock.restored === true && mineLock.stillMine === true,
       `복원=${mineLock.restored} _mine 유지=${mineLock.stillMine}${mineLock.err ? ' · ' + mineLock.err : ''} — ` +
       'save() 의 peerRevert 가 겹까지 덮지 못하면 사용자는 「내 일정을 고쳤다」고 믿는다');

    //  왕복 — 다시 끄면 대상 것만 남는다(한 방향만 보면 토글이 아니라 초기값을 본 것이다).
    await setOverlay(cdp, false);
    const back = await visible(cdp);
    ok(`R${r} 토글을 끄면 다시 대상 것만 남는다(왕복)`,
       back.visTheirs === TITLES.length && back.visMine === 0 && back.chipMine === 0,
       `대상 ${back.visTheirs}건 · 내 겹 ${back.visMine}건 · chip-mine ${back.chipMine}개`);
    //  다음 라운드는 앱 기본값(켬)에서 시작하게 되돌려 둔다 — 이 시험이 사용자 설정을 껀 채
    //  남기면, 다음에 사람이 열람 창을 열었을 때 겹이 꺼져 있다(localStorage 는 창을 넘어 남는다).
    await setOverlay(cdp, true);

    //  ⑤ 「나란히 보기」(docs/PEER-SIDE-BY-SIDE.md · R2·R3·R4·R8·R9) — 같은 열람 창에서 보기 방식만 바꿔 같은 명제를 다시 본다.
    //  ★ 겹을 **끈 채로** 들어간다 — 나란히 보기는 겹 토글과 무관하게 오른쪽에 내 일정을 보여야 한다(S9).
    //    켠 채로만 보면 「토글 값 덕에 보인 것」 과 구별할 수 없다.
    //  ★ 이 블록 전체를 postMessage 계기로 감싼다 — 보기 전환·칸 클릭·시트 열고 닫기·밀도 전환·창 폭 변경 어디서도 문이 열리면 안 된다(R9).
    await setOverlay(cdp, false);
    await cdp.ev(`(()=>{const w=${FRAME_W}; const orig=w.chrome.webview.postMessage.bind(w.chrome.webview);
      w.__sideTap={n:0, orig}; w.chrome.webview.postMessage=function(m){ w.__sideTap.n++; return orig(m); }; return 1;})()`);
    let sideTap = { n: -1 };
    const dens0 = await cdp.ev(`${FRAME_W}.calDensity()`);
    try {
      const sd = await setLayout(cdp, 'side');
      ok(`R${r} 「나란히 보기」 버튼 → 눌림(aria-pressed) · body 스위치 · tc_peerLayout=side`,
         sd.pressed === true && sd.attr === 'side' && sd.ls === 'side',
         `aria-pressed=${sd.pressed} data-peer-layout=${sd.attr} tc_peerLayout=${sd.ls}`);

      //  R2 — 두 달력 · 이름 탭 · 내용 나누기
      const sp = await sideProbe(cdp);
      ok(`R${r} 나란히 보기: 달력 두 개(칸 수 같음 · 오른쪽에도 요일 머리줄)`, sp.cellsL === 35 && sp.cellsR === 35 && sp.wkR === 7,
         `왼쪽 ${sp.cellsL}칸 · 오른쪽 ${sp.cellsR}칸 · 오른쪽 요일 ${sp.wkR}`);
      ok(`R${r} 나란히 보기: 이름 탭 두 개(「열람대상 님」 · 「내 일정」)`, /열람대상 님/.test(sp.tabL) && /내 일정/.test(sp.tabR),
         `왼쪽 「${sp.tabL.trim()}」 · 오른쪽 「${sp.tabR.trim()}」`);
      ok(`R${r} 나란히 보기: 대상 일정 ${TITLES.length}건은 왼쪽에만`, sp.theirsL === TITLES.length && sp.theirsR === 0,
         `왼쪽 ${sp.theirsL}건 · 오른쪽 ${sp.theirsR}건`);
      ok(`R${r} 나란히 보기: 왼쪽에 내 칩 0 · 오른쪽에 내 것 아닌 칩 0`, sp.mineL === 0 && sp.otherR === 0,
         `왼쪽 chip-mine ${sp.mineL} · 오른쪽 비-mine ${sp.otherR}`);
      ok(`R${r} 나란히 보기: 겹을 꺼 두었어도 오른쪽 달력에 내 일정이 그려진다(S9)`, sp.mineR > 0 && sp.mineInL === false,
         `오른쪽 chip-mine ${sp.mineR}개(${sp.mineAt || '찾지 못함'}) · 같은 일정이 왼쪽에도 있음=${sp.mineInL}`);
      ok(`R${r} 나란히 보기: 「내 일정」 겹 토글 칩이 감춰진다(S9)`, sp.toggleShown === false, '겹 토글 칩이 보인다');

      //  R4·R5 — 오른쪽 칸 클릭 → 양쪽 선택 · 시트(두 묶음) · 닫기 손잡이
      const tap = JSON.parse(await cdp.ev(`(()=>{const w=${FRAME_W}, d=w.document;
        const c=d.querySelector('#gridMine .cell[data-date="2026-06-12"]');
        if(!c) return JSON.stringify({err:"오른쪽 달력에 6/12 칸이 없다"});
        const sheet0=d.body.classList.contains("sheet-open");
        c.click();
        const r={ sheet0, sel:Array.prototype.map.call(d.querySelectorAll("#grid .cell.sel, #gridMine .cell.sel"), (x)=>x.closest(".grid").id+":"+x.dataset.date),
          sheet:d.body.classList.contains("sheet-open"),
          secs:Array.prototype.map.call(d.querySelectorAll("#dpBody .dp-sec-h"), (h)=>h.textContent.replace(/\\s+/g," ").trim()) };
        d.getElementById("dpSheetClose").click();
        r.closed=!d.body.classList.contains("sheet-open");
        return JSON.stringify(r);})()`));
      ok(`R${r} 나란히 보기: 상세 패널은 접혀 있다가 오른쪽 칸 클릭으로 시트가 열리고 손잡이로 닫힌다(R4)`,
         !tap.err && tap.sheet0 === false && tap.sheet === true && tap.closed === true,
         tap.err || `처음 열림=${tap.sheet0} · 클릭 뒤=${tap.sheet} · 닫기 뒤 닫힘=${tap.closed}`);
      ok(`R${r} 나란히 보기: 오른쪽 칸 클릭 → 두 달력 모두 같은 날짜 선택(R5)`,
         !tap.err && JSON.stringify((tap.sel || []).sort()) === JSON.stringify(['grid:2026-06-12', 'gridMine:2026-06-12']),
         tap.err || (tap.sel || []).join(','));
      ok(`R${r} 나란히 보기: 시트 상세 = 두 묶음(「열람대상 님 일정」 · 「내 일정」)(S7)`,
         !tap.err && tap.secs.length === 2 && /^열람대상 님 일정 \(1\)$/.test(tap.secs[0]) && /^내 일정 \(\d+\)$/.test(tap.secs[1]),
         tap.err || JSON.stringify(tap.secs));

      //  R3 — 같은 주 줄 높이(±1px) · 고정·촘촘히·펼침 각각 · 폭을 바꾼 뒤에도.  R8 — 좁은 폭에서 위아래로 쌓기.
      for (const dv of ['fixed', 'dense', 'expand']) {
        const got = await setDensity(cdp, dv);
        for (const wpx of [1280, 1000]) {
          const m = await sideRows(cdp, wpx);
          if (m.zero || !m.vw) {
            console.log(`  · 참고: R${r} ${dv}/${wpx}px — 칸 높이를 재지 못했다(창이 안 그려짐 · vw=${m.vw}) — 줄 맞춤 판정을 건너뛴다`);
            continue;
          }
          R3_MEASURED++;
          ok(`R${r} 줄 맞춤(R3) ${dv}·${wpx}px: 좌우로 놓이고 같은 주 줄 높이가 ±1px`,
             got === dv && m.sideBySide && m.dir !== 'column' && m.rowsN[0] === m.rowsN[1] && m.maxDiff >= 0 && m.maxDiff <= 1,
             `밀도=${got} · vw=${m.vw} · 방향=${m.dir} · 좌우=${m.sideBySide} · 줄 ${m.rowsN.join('/')} · 최대 차 ${m.maxDiff}px · L=${m.L.join(',')} R=${m.R.join(',')}`);
        }
      }
      const nar = await sideRows(cdp, 700);
      ok(`R${r} 좁은 폭(700px)에서 위아래로 쌓인다(위 = 그 사람 · 아래 = 나)(R8)`, nar.dir === 'column' && nar.stacked === true,
         `vw=${nar.vw} · 방향=${nar.dir} · 쌓임=${nar.stacked}`);
      const wide = await sideRows(cdp, 1280);
      ok(`R${r} 다시 넓히면 좌우로 돌아온다`, wide.dir !== 'column' && (wide.zero || wide.sideBySide),
         `vw=${wide.vw} · 방향=${wide.dir} · 좌우=${wide.sideBySide}`);
      await sideRowsReset(cdp);
      await setDensity(cdp, dens0);

      //  R9 — 보기 방식을 여러 번 오가도 잔재가 없다(겹쳐 보기면 오른쪽 달력이 비고 스위치가 내려간다)
      let flipBad = '';
      for (let k = 0; k < 3; k++) {
        const o = await setLayout(cdp, 'overlay');
        const oN = await cdp.ev(`${FRAME_W}.document.getElementById("gridMine").children.length`);
        const s2 = await setLayout(cdp, 'side');
        const sN = await cdp.ev(`${FRAME_W}.document.querySelectorAll("#gridMine .cell").length`);
        if (o.attr !== null || oN !== 0 || s2.attr !== 'side' || sN !== 35) { flipBad = `${k}: overlay attr=${o.attr} 오른쪽 ${oN} · side attr=${s2.attr} 오른쪽 ${sN}칸`; break; }
      }
      ok(`R${r} 보기 방식을 세 번 오가도 잔재가 없다`, !flipBad, flipBad);
    } finally {
      try { await sideRowsReset(cdp); } catch { }
      sideTap = JSON.parse(await cdp.ev(`(()=>{const w=${FRAME_W}; const t=w.__sideTap; if(!t) return JSON.stringify({n:-1});
        w.chrome.webview.postMessage=t.orig; delete w.__sideTap; return JSON.stringify({n:t.n});})()`));
    }
    ok(`R${r} **봉인(나란히 보기)**: 보기 전환·클릭·시트·밀도·폭 변경 내내 postMessage 0회`, sideTap.n === 0,
       `postMessage ${sideTap.n}회`);
    //  다음 라운드·사람을 위해 겹쳐 보기 · 겹 켬으로 되돌린다(실행이 끝나면 finally 가 시작 전 tc_peerLayout 으로 다시 되돌린다).
    await setLayout(cdp, 'overlay');
    await setOverlay(cdp, true);

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

  /* ── ⑥ 「사람 고르기」(docs/PEER-PICKER.md R10) — 툴바 👥 → 검색 → 열람 → 최근에 남음 → ☆ 즐겨찾기(팝오버 = 열람 창) →
   *      열람 창 ▾ 사람 바꾸기(보는 중 표시 · 보던 달 잇기) → 바뀐 창도 봉인(postMessage 0) · DB 무변화(아래 누적 검증이 같이 본다).
   *  ★ 저장 키(tc_peerFav/Recent:<me>)는 비운 채로 시작해 판정을 결정적으로 하고, 끝나면(finally) 시작 전 값으로 되돌린다.
   *  ★ 조작은 사람이 누르는 자리로만 한다 — 툴바 버튼 · 검색 칸 · 행 · ☆ · ▾. 내부 함수(pkOpen 등)를 직접 부르지 않는다. */
  console.log('\n[사람 고르기] 툴바 → 검색 → 열람 → 최근 → 즐겨찾기 → ▾ 바꾸기 (R10)');
  await cdp.ev(`(()=>{ localStorage.removeItem(${JSON.stringify(PK_KEYS.fav)}); localStorage.removeItem(${JSON.stringify(PK_KEYS.recent)}); return 1; })()`);
  const lsPk = async () => JSON.parse(await cdp.ev(`JSON.stringify({
    fav: JSON.parse(localStorage.getItem(${JSON.stringify(PK_KEYS.fav)}) || "[]").map((x)=>x.loginId),
    recent: JSON.parse(localStorage.getItem(${JSON.stringify(PK_KEYS.recent)}) || "[]").map((x)=>x.loginId) })`));
  {
    //  (a) 툴바 입구 — 내 창에 있다 · 누르면 팝오버 · 검색 칸 포커스
    const has = await cdp.ev(`!!document.getElementById("btnPeerPick")`);
    ok('R10 툴바에 「다른 사람 일정」 입구가 있다', has === true);
    await cdp.ev(`document.getElementById("btnPeerPick").click()`);
    let s = await pkWait(cdp);
    ok('R10 팝오버가 열리고 검색 칸에 포커스 · 명부를 읽었다', s.open && !s.inModal && s.focus === 'pkSearch' && s.status === 'ok',
       `open=${s.open} inModal=${s.inModal} focus=${s.focus} status=${s.status}`);
    //  (b) 검색 — 심은 두 사람이 결과에 · 열 수 있다(회색 아님)
    s = await pkType(cdp, '열람대상');
    const r1 = s.rows.find((x) => x.id === TU), r2 = s.rows.find((x) => x.id === TU2);
    ok('R10 검색 「열람대상」 → 두 대상이 결과에 · 열 수 있다', !!r1 && !!r2 && !r1.off && !r2.off && r1.sec === 'Result',
       JSON.stringify(s.rows.slice(0, 5)));
    //  (c) 열기 — 팝오버가 닫히고 지금의 열람 창이 그 사람으로
    await pkClickRow(cdp, TU);
    const f1 = await waitPeerFrame(cdp, '열람대상');
    s = await pkState(cdp);
    ok('R10 행을 누르면 팝오버가 닫히고 열람 창이 그 사람으로 뜬다', f1.n >= 0 && f1.frames === 1 && !s.open, JSON.stringify(f1));
    await sleep(300);
    let st = await lsPk();
    ok('R10 열린 사람이 「최근 본 사람」 맨 앞에 남는다', JSON.stringify(st.recent) === JSON.stringify([TU]), JSON.stringify(st));
    //  (d) 열람 창 ☆ → ★ — 저장이 바뀐다
    const fv = JSON.parse(await cdp.ev(`(()=>{const b=document.getElementById("pvFav"); b.click();
      return JSON.stringify({p:b.getAttribute("aria-pressed"), t:b.textContent});})()`));
    st = await lsPk();
    ok('R10 열람 창 ☆ → ★ · 즐겨찾기에 저장', fv.p === 'true' && fv.t === '★' && st.fav.includes(TU), JSON.stringify({ fv, st }));
    //  (e) ▾ 사람 바꾸기 — 같은 팝오버가 열람 창 안에 · 보는 사람은 「보는 중」 · 즐겨찾기 ★ 가 열람 창과 같다
    //      먼저 열람 프레임을 6월로 옮겨 둔다(사람이 ◀ 를 누르는 것과 같다 — 보던 달 잇기를 보려고).
    await cdp.ev(`(()=>{const w=${FRAME_W}; w.eval("view={y:2026,m:5}; selectedDate='2026-06-11'; renderAll();"); return 1;})()`);
    await cdp.ev(`document.getElementById("pvSwitch").click()`);
    s = await pkWait(cdp);
    const cur = s.rows.find((x) => x.id === TU);
    ok('R10 ▾ → 팝오버가 열람 창 머리 아래에 뜬다', s.open && s.inModal && s.focus === 'pkSearch', `open=${s.open} inModal=${s.inModal} focus=${s.focus}`);
    ok('R10 지금 보는 사람은 즐겨찾기 묶음에 「· 보는 중」 · 누를 수 없음 · ★ 가 열람 창과 같다',
       !!cur && cur.sec === 'Fav' && cur.off && /보는 중/.test(cur.text) && cur.star === 'true', JSON.stringify(cur || s.rows));
    ok('R10 즐겨찾기에 있는 사람은 「최근」에 두 줄로 안 나온다', s.rows.filter((x) => x.id === TU).length === 1, JSON.stringify(s.rows));
    //  팝오버 ☆ ↔ 열람 창 ☆ 양방향(R8) — 팝오버에서 빼면 제목 옆도 ☆, 다시 넣으면 ★
    await pkClickRow(cdp, TU, 'star');
    const off1 = await cdp.ev(`document.getElementById("pvFav").getAttribute("aria-pressed")`);
    await pkClickRow(cdp, TU, 'star');
    const on1 = await cdp.ev(`document.getElementById("pvFav").getAttribute("aria-pressed")`);
    ok('R10 팝오버 ☆/★ 를 누르면 열람 창 ☆/★ 가 같이 바뀐다', off1 === 'false' && on1 === 'true', `뺀 뒤 ${off1} · 넣은 뒤 ${on1}`);
    //  (f) 다른 사람으로 바꾼다 — 창은 그대로 · 새 프레임 · 6월 그대로 · 그 사람 것 · 최근 앞으로
    s = await pkType(cdp, '열람대상둘');
    await pkClickRow(cdp, TU2);
    const f2 = await waitPeerFrame(cdp, '열람대상둘');
    const sw = JSON.parse(await cdp.ev(`(()=>{const m=document.getElementById("peerModal"), w=${FRAME_W};
      const st=w.__test.state();
      return JSON.stringify({modal: !m.classList.contains("hidden") && !m.classList.contains("closing"),
        view: w.peerViewNow(), titles: st.entries.filter((e)=>!e._mine).map((e)=>e.title).sort(),
        frames: document.querySelectorAll("iframe[src*='peer=1']").length});})()`));
    ok('R10 바꾸기: 열람 창을 닫지 않고 그 자리에서 다른 사람으로(새 프레임 하나)', f2.n >= 0 && sw.modal && sw.frames === 1,
       JSON.stringify({ f2, modal: sw.modal, frames: sw.frames }));
    ok('R10 바꾸기: 바뀐 사람의 일정이 뜬다(앞 사람 것 없음)', JSON.stringify(sw.titles) === JSON.stringify([...TITLES2].sort()), sw.titles.join(','));
    ok('R10 바꾸기: 보던 달(6월)이 이어진다', !!sw.view && sw.view.y === 2026 && sw.view.m === 5, JSON.stringify(sw.view));
    st = await lsPk();
    ok('R10 바꾼 사람이 최근 맨 앞 · 앞 사람이 그 뒤', JSON.stringify(st.recent) === JSON.stringify([TU2, TU]), JSON.stringify(st));
    //  (g) 바뀐 창도 봉인 — 쓰기 명령·save() 를 쏴도 postMessage 0
    const sealed2 = JSON.parse(await cdp.ev(`(()=>{const w=${FRAME_W};
      let n=0; const orig=w.chrome.webview.postMessage.bind(w.chrome.webview);
      w.chrome.webview.postMessage=function(m){ n++; return orig(m); };
      let err=null;
      try{ for(const c of [{cmd:"saveState",state:{}},{cmd:"replaceAllState",state:{}},{cmd:"membersGet"},{cmd:"peerSchedule",loginId:"x"}]) w.hpost(c); }catch(e){ err=e.message; }
      try{ w.eval("save()"); }catch(e){ err=err||e.message; }
      w.chrome.webview.postMessage=orig;
      return JSON.stringify({posted:n, err, picker: !!w.document.getElementById("btnPeerPick") || !!w.document.getElementById("peerPicker")});})()`));
    ok('R10 **봉인(바꾼 창)**: postMessage 0회', sealed2.posted === 0 && !sealed2.err, JSON.stringify(sealed2));
    ok('R10 열람 창 안에는 👥 입구·팝오버가 없다', sealed2.picker === false, '프레임 안에 #btnPeerPick/#peerPicker 가 있다');
    //  (h) 닫기 — 프레임이 사라진다
    await cdp.ev('closeModal("#peerModal")');
    await sleep(400);
    const gone = Number(await cdp.ev(`document.querySelectorAll("iframe[src*='peer=1']").length`));
    ok('R10 닫으면 프레임이 사라진다', gone === 0, `프레임 ${gone}`);
  }

  //  R3 — 좌우 줄 맞춤을 한 번이라도 실제로 쟀는가(창이 안 그려지면 모두 건너뛰어 아무것도 증명하지 않는다).
  ok('나란히 보기 줄 맞춤(R3)을 실제로 쟀다(판정 불가 ≠ 통과)', R3_MEASURED > 0,
     '한 번도 못 쟀다 — 위젯 창을 화면에 띄운 채로 돌릴 것(최소화·가림이면 칸 높이가 0 이다)');

  /* ── 누적 검증 — 여기가 루프의 값이다 ──────────────────────────── */
  console.log('\n[누적] 몇 번을 열고 닫아도 아무것도 안 변했는가');
  const end = {
    myEnt: num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${MYID}`),
    myCat: num(`SELECT COUNT(*) FROM cal_category WHERE user_id=${MYID}`),
    myRev: num(`SELECT rev FROM cal_user_rev WHERE user_id=${MYID}`),
    tgtEnt: num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${TUID}`),
    tgtRev: num(`SELECT rev FROM cal_user_rev WHERE user_id=${TUID}`),
    tgt2Ent: num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${TU2ID}`),
    tgt2Rev: num(`SELECT rev FROM cal_user_rev WHERE user_id=${TU2ID}`),
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
  try { if (cdp) { await cdp.ev('closeModal("#peerModal")').catch(() => {}); } } catch { }
  //  보기 방식 원상 복구 — 시작 전 값으로(없었으면 지운다). 프레임은 닫혔으니 부모의 같은 저장소에 쓴다.
  try {
    if (cdp && LAYOUT0 !== undefined) {
      const back = await cdp.ev(LAYOUT0 === null
        ? "(()=>{ localStorage.removeItem('tc_peerLayout'); return localStorage.getItem('tc_peerLayout'); })()"
        : `(()=>{ localStorage.setItem('tc_peerLayout', ${JSON.stringify(String(LAYOUT0))}); return localStorage.getItem('tc_peerLayout'); })()`);
      console.log(`  · 보기 방식 되돌림: tc_peerLayout = ${JSON.stringify(back)}(시작 전 ${JSON.stringify(LAYOUT0)})`);
    }
  } catch (e) { console.log('  ! 보기 방식 되돌리기 실패: ' + e.message); }
  //  사람 고르기 저장 키 원상 복구(R10) — 시작 전 값으로(없었으면 지운다). 시험 대상이 내 즐겨찾기·최근에 남지 않게.
  try {
    if (cdp && PK0 !== undefined && PK_KEYS) {
      const back = await cdp.ev(`(()=>{ const o=${JSON.stringify(PK0)}, k=${JSON.stringify(PK_KEYS)};
        if(o.fav===null) localStorage.removeItem(k.fav); else localStorage.setItem(k.fav, o.fav);
        if(o.recent===null) localStorage.removeItem(k.recent); else localStorage.setItem(k.recent, o.recent);
        return JSON.stringify({fav:localStorage.getItem(k.fav), recent:localStorage.getItem(k.recent)}); })()`);
      console.log(`  · 사람 고르기 키 되돌림: ${back}(시작 전 ${JSON.stringify(PK0)})`);
    }
  } catch (e) { console.log('  ! 사람 고르기 키 되돌리기 실패: ' + e.message); }
  try { if (cdp) cdp.close(); } catch { }
  try { wipeTarget(); } catch (e) { console.log('  ! 정리 실패: ' + e.message); }
  try { wipeUser(TU2); } catch (e) { console.log('  ! 정리 실패(대상2): ' + e.message); }
}

console.log('\n' + '═'.repeat(72));
console.log(`통과 ${pass} · 실패 ${fail} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
if (F.length) { console.log('\n실패 목록:'); F.slice(0, 20).forEach((f) => console.log('  · ' + f)); }
console.log(fail === 0
  ? '열람 창 검증 통과 ✓ — 그 사람 것이 뜨고, 아무것도 못 내보내고, 아무것도 안 변한다.'
  : '★ 실패 — 열람 창이 남의 데이터를 다루는 자리다. 배포 전에 고칠 것.');
console.log('═'.repeat(72));
process.exit(fail === 0 ? 0 : 1);
