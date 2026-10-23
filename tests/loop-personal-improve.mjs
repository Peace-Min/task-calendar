/* ============================================================================
 *  tests/loop-personal-improve.mjs: 개인 탭 개선 실 위젯 확인 (docs/PERSONAL-IMPROVE-PLAN.md 결정 1~10)
 * ----------------------------------------------------------------------------
 *  디버그 위젯(TC_DEBUG_PORT=9222)에 붙어 zz 기록(여러 날 일정, 여러 날 할 일, 시간 일정)을 앱 경로(save, addTodo)로 만들고
 *    L1 월간 막대가 그려지는지(주 경계에서 나뉨, ◂ ▸ 표시 자리, 할 일 점선, 시간 일정 점),
 *    L2 막대의 그 날 칸 가운데를 누르면 그 날짜가 골라지는지(시작일이 아니라),
 *    L3 진짜 DragEvent(DataTransfer)로 막대의 한 날을 잡아 다른 칸에 놓으면 (놓은 날 - 잡은 날)만큼 옮겨지고(길이 유지) 저장되는지
 *       (서버에서 다시 읽어 확인),
 *    L4 한 화면 폼이 모든 칸을 처음부터 보이는지(옵션 더보기 없음), 시각 칸이 type=time step=300 이고 5분 단위가 아닌 값(11:38)이
 *       그대로 보이고 저장되는지,
 *  를 본다. 영속과 정리는 앱을 거친다(DB 직접 접속 없음). 끝나면 zz 기록을 지우고 서버에서 0건인지 다시 읽어 본다.
 *  ★ 시각 고르기 목록이 실제로 5분 간격인지(WebView2 의 드롭다운 모양)는 화면을 보는 사람이 확인한다. 이 루프는 속성만 본다.
 *  실행: node tests/loop-personal-improve.mjs [--port=9222] [--seed=N]
 *  종료코드: 0 통과, 1 실패, 2 판정 없음
 * ==========================================================================*/
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = arg('port', '9222'), SEED = arg('seed', String(Date.now() % 100000));
const TAG = `zzPI-${SEED}`;
let pass = 0, fail = 0, und = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}${d ? ': ' + d : ''}`); } else { fail++; console.log(`  ✗ ${n}${d ? ': ' + d : ''}`); } };
const undecide = (n, d) => { und++; console.log(`  ? ${n}: 판정 불가, ${d}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws, id = 0; const pend = new Map();
async function connect() {
  let list; try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { return false; }
  const p = list.find(x => x.type === 'page' && !/peerwin=1|[?&]win=admin/.test(x.url || '')); if (!p) return false;   // 열람 창, 관리 창 제외
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
  await ev(`(() => { window.__piApplied = false; const o = window.__applyState; window.__applyState = function(){ const r = o.apply(this, arguments); window.__piApplied = true; window.__applyState = o; return r; }; hpost({cmd:'reloadState'}); return true; })()`);
  return waitFor('window.__piApplied === true', 20000);
}
//  페이지 쪽 도우미: 그 날짜 칸을 덮는 막대(sel)를 찾아 그 칸 가운데 좌표를 돌려준다(막대가 숨어 있으면 null).
const BAR = `(function(ds, sel){ const cell = document.querySelector('#grid .cell[data-date="' + ds + '"]'); if(!cell) return null; const wk = cell.closest('.gridrow'); if(!wk) return null; const col = [...wk.querySelectorAll('.cell')].indexOf(cell); const bar = [...wk.querySelectorAll('.chip-bar' + sel)].find(c => Number(c.dataset.c0) <= col && Number(c.dataset.c1) >= col && c.offsetParent !== null); if(!bar) return null; const r = cell.getBoundingClientRect(), b = bar.getBoundingClientRect(); return { bar, cell, x: r.left + r.width / 2, y: b.top + b.height / 2 }; })`;
//  이번 루프가 쓰는 달: 2026년 12월(1일 화요일). 주 = 11/29, 12/6, 12/13, 12/20, 12/27.
const D = { evS: '2026-12-07', evE: '2026-12-15', tdS: '2026-12-16', tdE: '2026-12-18', tm: '2026-12-17' };

(async () => {
  if (!(await connect())) { console.log('판정 없음: CDP 페이지 없음(TC_DEBUG_PORT 로 띄운 위젯 필요)'); process.exit(2); }
  console.log(`[loop-personal-improve] seed=${SEED} tag=${TAG}`);
  let evId = null, tdId = null, tmId = null;
  try {
    if (!(await ev(`typeof renderMonthBars === 'function' && typeof openQuickAdd === 'function' && typeof shiftByGrab === 'function'`))) { undecide('O0 앱', '이 판의 함수(renderMonthBars, shiftByGrab)가 없다. 이 브랜치로 빌드한 위젯인지 확인'); return; }
    if (!(await waitFor(healthy, 5000))) { await ev(`(() => { const b = document.getElementById('dsErrorRetry'); if (b) b.click(); else hpost({cmd:'reloadState'}); return 1; })()`); }
    if (!(await waitFor(healthy, 30000))) { undecide('O0 정상 연결', JSON.stringify(await J(`{conn, bootOk, unsaved}`))); return; }
    ok('O0 conn ok, bootOk', true);
    const view0 = await J('view'), sel0 = await ev('selectedDate'), dens0 = await ev('calDensity()');
    await ev(`(() => { setCalDensity('fixed'); return 1; })()`);
    // 준비: zz 기록 셋(앱 경로)
    const made = await J(`(() => {
      const cat = (state.categories.find(c => isPickableCat(c)) || state.categories[0] || {}).id || null;
      const e1 = addEntry({ date:'${D.evS}', endDate:'${D.evE}', allDay:true, startTime:'', endTime:'', title:${JSON.stringify(TAG + ' 기간 일정')}, memo:'', location:'', categoryId:cat, recur:null });
      const e2 = addEntry({ date:'${D.tm}', allDay:false, startTime:'11:38', endTime:'12:07', title:${JSON.stringify(TAG + ' 시간 일정')}, memo:'', location:'', categoryId:cat, recur:null });
      const t = addTodo(${JSON.stringify(TAG + ' 기간 할 일')}, { categoryId:cat, due:'${D.tdS}', endDate:'${D.tdE}', prio:'high', note:'' });
      return { e1: e1 && e1.id, e2: e2 && e2.id, t: t && t.id };
    })()`);
    evId = made.e1; tmId = made.e2; tdId = made.t;
    await waitFor(`!unsaved`, 10000);
    const back = (await reloadAndWait()) ? await J(`({ e: state.entries.filter(e => String(e.title||'').startsWith(${JSON.stringify(TAG)})).length, t: (state.todos||[]).filter(t => String(t.text||'').startsWith(${JSON.stringify(TAG)})).length })`) : null;
    ok('준비: zz 기간 일정, 시간 일정, 기간 할 일 저장(서버 재조회)', !!(evId && tmId && tdId) && back && back.e === 2 && back.t === 1, JSON.stringify(back));

    // L1 막대
    await ev(`(() => { view = {y:2026, m:11}; selectedDate = '2026-12-01'; focusDs = null; renderAll(); return 1; })()`);
    const l1 = await J(`(() => {
      const g = document.getElementById('grid');
      const segs = [...g.querySelectorAll('.chip-bar[data-id="${evId}"]')].map(b => ({ cl: b.classList.contains('cl'), cr: b.classList.contains('cr'), c0: +b.dataset.c0, c1: +b.dataset.c1, from: b.closest('.gridrow').dataset.from, w: Math.round(b.getBoundingClientRect().width) }));
      const td = g.querySelector('.chip-bar[data-todo="${tdId}"]'), tm = g.querySelector('.chip-bar[data-id="${tmId}"]');
      const cellW = Math.round((g.querySelector('.cell[data-date="${D.evS}"]') || g).getBoundingClientRect().width);
      return { bars: g.classList.contains('bars'), inCell: g.querySelectorAll('.cell .chip').length, segs, cellW,
        todo: td ? { range: td.classList.contains('range'), todo: td.classList.contains('chip-todo'), dashed: getComputedStyle(td).borderTopStyle, star: !!td.querySelector('.txt svg') } : null,
        timed: tm ? { timed: tm.classList.contains('chip-timed'), dot: !!tm.querySelector('.cdot'), t: (tm.querySelector('.chip-t') || {}).textContent } : null };
    })()`);
    ok('L1 내 창 달력이 막대 달력(.bars)이고 칸 안 칩이 없다', l1.bars && l1.inCell === 0, JSON.stringify({ bars: l1.bars, inCell: l1.inCell }));
    ok('L1 12/7~12/15 막대가 주 경계에서 둘로 나뉜다(앞 조각 cr, 뒤 조각 cl)', l1.segs.length === 2 && l1.segs[0].cr && !l1.segs[0].cl && l1.segs[1].cl && !l1.segs[1].cr && l1.segs[0].c0 === 1 && l1.segs[0].c1 === 6 && l1.segs[1].c1 === 2, JSON.stringify(l1.segs));
    ok('L1 앞 조각이 여러 칸을 가로지른다(폭 > 칸 5개)', l1.segs.length === 2 && l1.segs[0].w > l1.cellW * 5, JSON.stringify({ w: l1.segs[0] && l1.segs[0].w, cellW: l1.cellW }));
    ok('L1 기간 할 일은 점선 막대, 중요 별', !!l1.todo && l1.todo.range && l1.todo.todo && l1.todo.dashed === 'dashed' && l1.todo.star, JSON.stringify(l1.todo));
    ok('L1 하루 시간 일정은 점 + 시각', !!l1.timed && l1.timed.timed && l1.timed.dot && l1.timed.t === '11:38', JSON.stringify(l1.timed));

    // L2 누르기: 12/9 칸 가운데
    const l2 = await J(`(() => { const h = ${BAR}('2026-12-09', '[data-id="${evId}"]'); if(!h) return { found:false };
      h.bar.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, detail:1, clientX:h.x, clientY:h.y }));
      return { found:true, sel:selectedDate, view, tab:noteTab, flash: !!document.querySelector('.card.flash[data-id="${evId}"]'), pop: !!document.querySelector('.pc-pop') }; })()`);
    if (!l2.found) undecide('L2 누르기', '12/9 칸 위 막대를 찾지 못했다(숨었거나 없다)'); else {
      ok('L2 막대의 12/9 위를 누르면 12/9 가 골라진다(시작일 12/7 이 아니다)', l2.sel === '2026-12-09' && l2.view.m === 11, JSON.stringify({ sel: l2.sel, view: l2.view }));
      ok('L2 오른쪽 패널 일정 상세 탭 + 그 카드 강조, 목록 창 없음', l2.tab === 'detail' && l2.flash && !l2.pop, JSON.stringify(l2));
    }

    // L3 끌어 옮기기: 12/9 를 잡아 12/11 칸에 놓는다 → 12/9~12/17(+2), 길이 9일 그대로
    const l3 = await J(`(() => { const h = ${BAR}('2026-12-09', '[data-id="${evId}"]'); const to = document.querySelector('#grid .cell[data-date="2026-12-11"]'); if(!h || !to) return { found:false };
      const dt = new DataTransfer();
      const ds = new DragEvent('dragstart', { bubbles:true, cancelable:true, dataTransfer:dt, clientX:h.x, clientY:h.y });
      h.bar.dispatchEvent(ds);
      let payload = null; try{ payload = JSON.parse(dt.getData('text/plain')); }catch(_){}
      const r = to.getBoundingClientRect();
      to.dispatchEvent(new DragEvent('dragover', { bubbles:true, cancelable:true, dataTransfer:dt, clientX:r.left + r.width/2, clientY:r.top + 10 }));
      to.dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer:dt, clientX:r.left + r.width/2, clientY:r.top + 10 }));
      const e = entryById('${evId}');
      return { found:true, payload, date: e && e.date, end: e && e.endDate, sel: selectedDate }; })()`);
    if (!l3.found) undecide('L3 끌기', '막대나 놓을 칸을 찾지 못했다'); else {
      ok('L3 끌기 시작이 잡은 날(12/9)을 싣는다', l3.payload && l3.payload.grab === '2026-12-09', JSON.stringify(l3.payload));
      ok('L3 12/9 를 잡아 12/11 에 놓으면 12/9~12/17(+2일, 길이 유지)', l3.date === '2026-12-09' && l3.end === '2026-12-17', `${l3.date}~${l3.end}`);
      await waitFor('!unsaved', 10000);
      const srv = (await reloadAndWait()) ? await J(`(() => { const e = entryById('${evId}'); return e ? { d: e.date, e: e.endDate } : null; })()`) : null;
      ok('L3 옮긴 날짜가 저장됐다(서버 재조회)', !!srv && srv.d === '2026-12-09' && srv.e === '2026-12-17', JSON.stringify(srv));
      //  막대 위에 놓기: 시간 일정(12/17)을 잡아 기간 할 일 막대의 12/18 자리 위에 놓는다 → 12/18
      await ev(`(() => { view = {y:2026, m:11}; renderAll(); return 1; })()`);
      const l3b = await J(`(() => { const h = ${BAR}('2026-12-17', '[data-id="${tmId}"]'); const over = ${BAR}('2026-12-18', '[data-todo="${tdId}"]'); if(!h || !over) return { found:false };
        const dt = new DataTransfer();
        h.bar.dispatchEvent(new DragEvent('dragstart', { bubbles:true, cancelable:true, dataTransfer:dt, clientX:h.x, clientY:h.y }));
        over.bar.dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer:dt, clientX:over.x, clientY:over.y }));
        const e = entryById('${tmId}'); return { found:true, date: e && e.date, st: e && e.startTime }; })()`);
      if (!l3b.found) undecide('L3b 막대 위에 놓기', '막대를 찾지 못했다'); else ok('L3b 막대 위에 놓아도 손가락 아래 칸(12/18)으로 옮겨진다, 시각 그대로', l3b.date === '2026-12-18' && l3b.st === '11:38', JSON.stringify(l3b));
      await waitFor('!unsaved', 10000);
    }

    // L4 한 화면 폼: 모든 칸, 시각 칸, 11:38 그대로 저장
    const l4 = await J(`(() => { editEntry('${tmId}');
      const shown = id => { let n = document.getElementById(id); if(!n) return false; for(; n && n.id !== 'quickAdd'; n = n.parentElement) if(n.classList && n.classList.contains('hidden')) return false; return true; };
      const ids = ['qaTitle','qaDate','qaEndDate','qaCat','qaAllDay','qaStart','qaEnd','qaRemBlock','qaRecur','qaLoc','qaMemo','qaSave'];
      const s = document.getElementById('qaStart'), en = document.getElementById('qaEnd');
      const r = { open: isOverlayOpen(document.getElementById('quickAdd')), missing: ids.filter(x => !shown(x)), more: !!document.getElementById('qaMore') || !!document.getElementById('qaAdvanced'),
        type: s && s.type, step: s && s.getAttribute('step'), stepEnd: en && en.getAttribute('step'), v: [s && s.value, en && en.value],
        recurOpts: [...document.querySelectorAll('#qaRecur option')].map(o => o.value),
        sheet: getComputedStyle(document.querySelector('#quickAdd .qa-modal')).maxHeight, bodyScroll: getComputedStyle(document.querySelector('#quickAdd .qa-body')).overflowY };
      qaSave(); return r; })()`);
    ok('L4 일정 수정이 한 화면 폼으로 열리고 모든 칸이 처음부터 보인다(옵션 더보기, 자세히 편집 없음)', l4.open && l4.missing.length === 0 && !l4.more, JSON.stringify({ missing: l4.missing, more: l4.more }));
    ok('L4 시각 칸은 type=time step=300(시작, 종료)', l4.type === 'time' && l4.step === '300' && l4.stepEnd === '300', JSON.stringify(l4));
    ok('L4 5분 단위가 아닌 11:38, 12:07 이 그대로 보인다', l4.v[0] === '11:38' && l4.v[1] === '12:07', JSON.stringify(l4.v));
    ok('L4 반복은 안 함, 매주, 매월', JSON.stringify(l4.recurOpts) === JSON.stringify(['', 'weekly', 'monthly']), JSON.stringify(l4.recurOpts));
    console.log(`    (참고) 폼 창 max-height=${l4.sheet}, 본문 overflow-y=${l4.bodyScroll}. 창 폭이 440px 이하이면 88vh 아래 시트여야 한다`);
    await waitFor('!unsaved', 10000);
    const l4b = (await reloadAndWait()) ? await J(`(() => { const e = entryById('${tmId}'); return e ? [e.startTime, e.endTime] : null; })()`) : null;
    ok('L4 폼으로 저장해도 11:38, 12:07 그대로(서버 재조회)', !!l4b && l4b[0] === '11:38' && l4b[1] === '12:07', JSON.stringify(l4b));
    //  할 일 폼 칸
    const l4c = await J(`(() => { openQuickAdd('2026-12-21', 'todo');
      const shown = id => { let n = document.getElementById(id); if(!n) return false; for(; n && n.id !== 'quickAdd'; n = n.parentElement) if(n.classList && n.classList.contains('hidden')) return false; return true; };
      const r = { on: ['qaTitle','qaDate','qaEndDate','qaCat','qaPrio','qaMemo'].filter(x => !shown(x)), off: ['qaWhen','qaRecurWrap','qaLocWrap'].filter(x => shown(x)) };
      closeOverlay(document.getElementById('quickAdd')); return r; })()`);
    ok('L4 할 일 폼: 제목, 기한, 종료일, 과제, 중요, 설명이 보이고 시각, 반복, 장소는 없다', l4c.on.length === 0 && l4c.off.length === 0, JSON.stringify(l4c));

    await ev(`(() => { setCalDensity(${JSON.stringify(dens0)}); view = ${JSON.stringify(view0)}; selectedDate = ${JSON.stringify(sel0)}; renderAll(); return 1; })()`);
  } catch (e) { fail++; console.log('  ✗ 예외: ' + e.message); }
  finally {
    try {
      await ev(`(() => { try{ closeOverlay(document.getElementById('quickAdd')); }catch(_){}
        state.entries.filter(e => String(e.title||'').startsWith('zzPI-')).forEach(e => deleteEntry(e.id));
        (state.todos||[]).filter(t => String(t.text||'').startsWith('zzPI-')).forEach(t => deleteTodo(t.id)); return 1; })()`);
      await waitFor('!unsaved', 10000);
      const left = (await reloadAndWait()) ? await J(`({ e: state.entries.filter(e => String(e.title||'').startsWith('zzPI-')).length, t: (state.todos||[]).filter(t => String(t.text||'').startsWith('zzPI-')).length })`) : null;
      ok('정리: zz 일정, 할 일 삭제, 서버 재조회 0건', !!left && left.e === 0 && left.t === 0, JSON.stringify(left));
    } catch (e) { console.log('  !!! 정리 실패: ' + e.message + '. zzPI-* 일정과 할 일을 직접 지우세요'); }
    console.log(`\n통과 ${pass}, 실패 ${fail}, 판정 불가 ${und}`);
    try { ws.close(); } catch {}
    process.exit(fail ? 1 : (und ? 2 : 0));
  }
})();
