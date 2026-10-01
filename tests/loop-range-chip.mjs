/* ============================================================================
 *  tests/loop-range-chip.mjs — 기간 칩 클릭 날짜 실 위젯 확인 (docs/BUG-RANGE-CHIP-CLICK.md K1·K3·K7)
 * ----------------------------------------------------------------------------
 *  제보(2026-10-01): "10월 1일을 누르면 9월 달력에선 10월로, 10월 달력에선 9월로 바뀐다."
 *  디버그 위젯(TC_DEBUG_PORT=9222)에 붙어 zz 기간 일정(9/29~10/2)을 앱 경로(save)로 만들고,
 *  진짜 칩을 click() 해서 달·선택 날짜·드러내기를 본다. 영속·정리는 앱을 거친다(DB 직접 접속 없음).
 *  실행: node tests/loop-range-chip.mjs [--port=9222] [--seed=N]
 *  종료코드: 0 통과 · 1 실패 · 2 판정 없음
 * ==========================================================================*/
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = arg('port', '9222'), SEED = arg('seed', String(Date.now() % 100000));
const TAG = `zzRNG-${SEED}`;
let pass = 0, fail = 0, und = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const undecide = (n, d) => { und++; console.log(`  ? ${n} — 판정 불가: ${d}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws, id = 0; const pend = new Map();
async function connect() {
  let list; try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { return false; }
  const p = list.find(x => x.type === 'page'); if (!p) return false;
  ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  return true;
}
const ev = (x) => new Promise((r, j) => { const i = ++id; pend.set(i, m => m.result?.exceptionDetails ? j(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300))) : r(m.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: x, awaitPromise: true, returnByValue: true } })); });
const J = async (x) => JSON.parse(await ev(`JSON.stringify(${x})`));
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(fn)) return true; await sleep(250); } return false; }
const healthy = `(typeof conn!=='undefined' && conn==='ok' && bootOk && !unsaved)`;
async function reloadAndWait() {
  await ev(`(() => { window.__rcApplied = false; const o = window.__applyState; window.__applyState = function(){ const r = o.apply(this, arguments); window.__rcApplied = true; window.__applyState = o; return r; }; hpost({cmd:'reloadState'}); return true; })()`);
  return waitFor('window.__rcApplied === true', 20000);
}
const countMine = () => ev(`state.entries.filter(e => String(e.title||'').startsWith(${JSON.stringify(TAG)})).length`);

(async () => {
  if (!(await connect())) { console.log('판정 없음: CDP 페이지 없음(TC_DEBUG_PORT 로 띄운 위젯 필요)'); process.exit(2); }
  console.log(`[loop-range-chip] seed=${SEED} tag=${TAG}`);
  let made = null;
  try {
    // O0 전제
    if (!(await ev(`typeof selectDate === 'function' && typeof chipHtml === 'function'`))) { undecide('O0 앱', '함수 없음'); return; }
    if (!(await waitFor(healthy, 5000))) { await ev(`(() => { const b = document.getElementById('dsErrorRetry'); if (b) b.click(); else hpost({cmd:'reloadState'}); return 1; })()`); }
    if (!(await waitFor(healthy, 30000))) { undecide('O0 정상 연결', JSON.stringify(await J(`{conn, bootOk, unsaved}`))); return; }
    ok('O0 conn ok · bootOk', true);
    const view0 = await J('view'), sel0 = await ev('selectedDate');
    // 기간 일정 만들기(앱 경로: state + save)
    made = await ev(`(() => { const e = { id: uid('e'), date:'2026-09-29', endDate:'2026-10-02', allDay:true, startTime:'', endTime:'', title:${JSON.stringify(TAG + ' 기간')}, memo:'', categoryId:(state.categories[0]||{}).id||null, createdAt: nowIso(), updatedAt: nowIso() }; state.entries.push(e); save(); return e.id; })()`);
    await sleep(1500);
    ok('준비: 기간 일정 9/29~10/2 저장', !!made && (await reloadAndWait()) && (await countMine()) === 1);

    // K1 — 10월 달력, 10/1 칸 막대
    await ev(`(() => { view = {y:2026, m:9}; renderGrid(); return 1; })()`);
    const k1 = await J(`(() => { const cell = document.querySelector('#grid .cell[data-date="2026-10-01"]'); const chip = cell && [...cell.querySelectorAll('.chip')].find(c => c.dataset.id === ${JSON.stringify(made)}); if (!chip) return { found:false }; chip.click(); return { found:true, view, sel:selectedDate, tab:noteTab, flash: !!document.querySelector('.card.flash[data-id="${made}"]'), card: !!document.querySelector('.card[data-id="${made}"]'), title: (document.getElementById('btnTitle')||{}).textContent || '' }; })()`);
    if (!k1.found) undecide('K1 10월 10/1 칸 막대', '칩을 찾지 못했다'); else {
      ok('K1 10월 달력에서 10/1 막대 클릭 → 달 그대로(10월)', k1.view.y === 2026 && k1.view.m === 9, JSON.stringify(k1.view) + ' · ' + k1.title.trim());
      ok('K1 선택 날짜 = 10/1', k1.sel === '2026-10-01', k1.sel);
      //  flashTargetId 는 강조를 그린 뒤 비운다(소비형) — 그래서 변수 대신 카드의 .flash 클래스를 본다
      ok('K1 일정 상세 탭 + 그 카드 표시·강조', k1.tab === 'detail' && k1.flash && k1.card, JSON.stringify({ tab:k1.tab, flash:k1.flash, card:k1.card }));
    }
    // K2 — 10/2 칸
    const k2 = await J(`(() => { const cell = document.querySelector('#grid .cell[data-date="2026-10-02"]'); const chip = cell && [...cell.querySelectorAll('.chip')].find(c => c.dataset.id === ${JSON.stringify(made)}); if (!chip) return { found:false }; chip.click(); return { found:true, view, sel:selectedDate }; })()`);
    if (k2.found) ok('K2 10/2 칸 막대 → 선택 10/2 · 10월 유지', k2.sel === '2026-10-02' && k2.view.m === 9, k2.sel); else undecide('K2', '칩 없음');
    // K3 — 9월 달력, 흐린 10/1 칸 막대
    await ev(`(() => { view = {y:2026, m:8}; renderGrid(); return 1; })()`);
    const k3 = await J(`(() => { const cell = document.querySelector('#grid .cell[data-date="2026-10-01"]'); const chip = cell && [...cell.querySelectorAll('.chip')].find(c => c.dataset.id === ${JSON.stringify(made)}); if (!chip) return { found:false, dim: !!(cell && cell.classList.contains('dim')) }; chip.click(); return { found:true, view, sel:selectedDate }; })()`);
    if (k3.found) ok('K3 9월 달력 흐린 10/1 막대 → 10월로 · 선택 10/1(누른 칸 기준)', k3.view.m === 9 && k3.sel === '2026-10-01', JSON.stringify(k3)); else undecide('K3', '9월 달력에 10/1 칸 막대가 없다 ' + JSON.stringify(k3));
    // K3b — 9월 달력 9/30 칸 막대 → 9월 유지
    await ev(`(() => { view = {y:2026, m:8}; renderGrid(); return 1; })()`);
    const k3b = await J(`(() => { const cell = document.querySelector('#grid .cell[data-date="2026-09-30"]'); const chip = cell && [...cell.querySelectorAll('.chip')].find(c => c.dataset.id === ${JSON.stringify(made)}); if (!chip) return { found:false }; chip.click(); return { found:true, view, sel:selectedDate }; })()`);
    if (k3b.found) ok('K3b 9월 달력 9/30 막대 → 9월 유지 · 선택 9/30', k3b.view.m === 8 && k3b.sel === '2026-09-30'); else undecide('K3b', '칩 없음');
    // 같은 자리 반복 클릭: 10월에서 10/1 막대를 세 번 → 계속 10월
    await ev(`(() => { view = {y:2026, m:9}; renderGrid(); return 1; })()`);
    const rep = await J(`(() => { const out = []; for (let i = 0; i < 3; i++) { const cell = document.querySelector('#grid .cell[data-date="2026-10-01"]'); const chip = cell && [...cell.querySelectorAll('.chip')].find(c => c.dataset.id === ${JSON.stringify(made)}); if (!chip) { out.push('none'); continue; } chip.click(); out.push(view.m); } return out; })()`);
    ok('같은 자리 3번 클릭 → 달이 번갈아 바뀌지 않는다(10월 유지)', rep.every(m => m === 9), JSON.stringify(rep));
    // 원래 화면으로
    await ev(`(() => { view = ${JSON.stringify(view0)}; selectedDate = ${JSON.stringify(sel0)}; renderAll(); return 1; })()`);
  } catch (e) { fail++; console.log('  ✗ 예외 — ' + e.message); }
  finally {
    try {
      if (made) { await ev(`(() => { deleteEntry(${JSON.stringify(made)}); return 1; })()`); await sleep(1500); }
      await ev(`(() => { state.entries.filter(e => String(e.title||'').startsWith('zzRNG-')).forEach(e => deleteEntry(e.id)); return 1; })()`);
      await sleep(1000);
      const back = (await reloadAndWait()) ? await ev(`state.entries.filter(e => String(e.title||'').startsWith('zzRNG-')).length`) : -1;
      ok('정리: zz 기간 일정 삭제 · 서버 재조회 0건', back === 0, 'remaining=' + back);
    } catch (e) { console.log('  !!! 정리 실패: ' + e.message + ' — zzRNG-* 일정을 직접 지우세요'); }
    console.log(`\n통과 ${pass} · 실패 ${fail} · 판정 불가 ${und}`);
    try { ws.close(); } catch {}
    process.exit(fail ? 1 : (und ? 2 : 0));
  }
})();
