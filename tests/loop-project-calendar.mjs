/* ============================================================================
 *  tests/loop-project-calendar.mjs: 과제 탭 실 위젯 확인 (docs/PROJECT-CALENDAR-PLAN.md §8.2 P2)
 * ----------------------------------------------------------------------------
 *  디버그 위젯(TC_DEBUG_PORT=9222)에 붙어 과제 탭을 앱 경로(화면 함수와 단추)로 돌린다. DB 에 직접 붙지 않는다.
 *  전제: DB 구조 16(과제 캘린더 표 둘: cal_project_event, cal_project_change), 로그인한 사람의 내 과제에 쓸 수 있는(숨기지 않은) 공식 과제가 하나 이상.
 *  만드는 것: 제목이 zzPC-<seed> 로 시작하는 과제 일정 둘, 그중 하나의 개인 복사본 하나.
 *  보는 것:
 *    P0 정상 연결, 과제 탭 진입(목록과 범위 읽기)
 *    P1 등록 폼으로 기간 일정과 시간 일정 만들기 → 월간 막대, 시간 일정 점
 *    P2 날짜 칸 → 그날 일정 목록(두 일정 줄, [수정] 없음, 이 날짜에 일정 등록), 체크한 과제가 하나면 폼에 그 과제
 *    P3 주간(과제 행)에 막대
 *    P4 수정: 막대(작은 창은 칸) → 누른 날짜 칸에 붙은 그날 일정 목록(그 줄이 있고 강조는 없음) → 그 줄 → 상세 → 수정 → 판이 오른다
 *    P5 충돌: 폼을 연 뒤 같은 일정을 호스트 명령으로 한 번 더 고친다(다른 사람 흉내) → 충돌 안내 → 내 입력 유지 → 저장
 *    P6 최근 변경: 내 변경이 보이고 종류 필터(수정)가 서버에서 걸린다
 *    P7 개인 일정에 등록(확인 창 없이 바로) → 개인 스냅샷에 새 개인 일정(사본, 미리알림은 새 기록 기본값 null). 상세는 그대로 "개인 일정에 등록"(등록됨 없음), 배지 없음
 *    P8 새로고침 → 목록과 범위를 다시 읽고 일정이 그대로
 *    P9 참여자 명단: 왼쪽 목록의 n명 단추 → 가운데 창, 받은 total 이 목록에 보이는 수와 같다, Esc 로 닫힘
 *  정리: 과제 일정은 화면(삭제 단추)과 호스트 명령으로 지운다. **공용 일정은 소프트 삭제라 DB 에 행(is_deleted=1)과
 *    변경 이력(cal_project_change)이 남는다. 설계대로다(지우지 않는 기록, 기획 §4.2).** 개인 복사본은 개인 삭제로 지운다.
 *  실행: node tests/loop-project-calendar.mjs [--port=9222] [--seed=N]
 *  종료코드: 0 통과, 1 실패, 2 판정 없음
 * ==========================================================================*/
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = arg('port', '9222'), SEED = arg('seed', String(Date.now() % 100000));
const TAG = `zzPC-${SEED}`;
let pass = 0, fail = 0, und = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}${d ? ': ' + d : ''}`); } else { fail++; console.log(`  ✗ ${n}${d ? ': ' + d : ''}`); } };
const undecide = (n, d) => { und++; console.log(`  ? ${n}: 판정 불가, ${d}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws, id = 0; const pend = new Map();
async function connect() {
  let list; try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { return false; }
  const p = list.find(x => x.type === 'page' && !/peerwin=1|[?&]win=admin/.test(x.url || '')); if (!p) return false;   // 메인 창만
  ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  return true;
}
const ev = (x) => new Promise((r, j) => { const i = ++id; pend.set(i, m => m.result?.exceptionDetails ? j(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300))) : r(m.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: x, awaitPromise: true, returnByValue: true } })); });
const J = async (x) => JSON.parse(await ev(`JSON.stringify(${x})`));
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(fn)) return true; await sleep(250); } return false; }
const healthy = `(typeof conn!=='undefined' && conn==='ok' && bootOk && !unsaved && !__dbSaving)`;
const idle = `(PCAL.loaded && !PCAL.loading && !PCAL.booting)`;
const S = JSON.stringify;
async function reloadAndWait() {
  await ev(`(() => { window.__pcApplied = false; const o = window.__applyState; window.__applyState = function(){ const r = o.apply(this, arguments); window.__pcApplied = true; window.__applyState = o; return r; }; hpost({cmd:'reloadState'}); return true; })()`);
  return waitFor('window.__pcApplied === true', 20000);
}
//  폼 칸을 채우고 저장한다(화면 경로). 끝나면 폼이 닫히고 범위 다시 읽기가 끝날 때까지 기다린다.
async function fillAndSave(v) {
  await ev(`(() => { const $ = id => document.getElementById(id); ${v.proj ? `$('pcfProj').value = ${S(v.proj)};` : ''}
    $('pcfTitle').value = ${S(v.title)}; $('pcfStart').value = ${S(v.s)}; $('pcfEnd').value = ${S(v.e)};
    $('pcfST').value = ${S(v.st || '')}; $('pcfET').value = ${S(v.et || '')}; locSet('pcf', ${S(v.loc || '')}); $('pcfMemo').value = ${S(v.memo || '')}; pcFormSync();
    $('pcfSave').click(); return 1; })()`);
}

(async () => {
  if (!(await connect())) { console.log('판정 없음: CDP 페이지 없음(TC_DEBUG_PORT 로 띄운 위젯 필요)'); process.exit(2); }
  console.log(`[loop-project-calendar] seed=${SEED} tag=${TAG}`);
  const made = [];       // 과제 일정 uid
  let copyEntry = '';    // 개인 복사본 uid
  let saved = null;      // 과제 탭 화면 설정(끝나면 되돌린다)
  let projectUid = '';
  try {
    // P0 전제
    if (!(await ev(`typeof PCAL === 'object' && typeof pcSetTab === 'function'`))) { undecide('P0 앱', '과제 탭 함수가 없다(P2 이전 빌드)'); return; }
    if (!(await waitFor(healthy, 30000))) { undecide('P0 정상 연결', JSON.stringify(await J(`{conn, bootOk, unsaved}`))); return; }
    saved = await J(`{ tab: PCAL.tab, view: PCAL.view, sel: PCAL.sel, memo: PCAL.memoLine }`);
    await ev(`(() => { pcSetTab('project'); return 1; })()`);
    if (!(await waitFor(idle, 20000))) { undecide('P0 과제 탭 진입', JSON.stringify(await J(`{ loaded: PCAL.loaded, err: PCAL.bootErr, loadErr: PCAL.loadErr }`))); return; }
    ok('P0 과제 탭 진입: 목록과 범위를 읽었다', await ev(`document.body.classList.contains('pc-on') && !!document.getElementById('pcView').textContent`));
    const proj = await J(`(PCAL.projects.find(p => p.writable) || null)`);
    if (!proj) { undecide('P0 쓸 수 있는 과제', '내 과제에 숨기지 않은 공식 과제를 하나 넣어 주세요(공식 과제 찾아보기)'); return; }
    projectUid = proj.projectUid;
    console.log(`  과제: ${proj.name} (${projectUid})`);
    //  그 과제만 체크(보이기는 체크로만 정한다), 월간, 오늘
    await ev(`(() => { PCAL.sel = [${S(projectUid)}]; PCAL.view = 'month'; PCAL.anchor = todayYmd(); pcRender(); pcLoad(); return 1; })()`);
    await waitFor(idle, 15000);
    const today = await ev('todayYmd()');
    const d2 = await ev(`addDays(todayYmd(), 2)`);

    // P1 등록(폼): 기간 일정 + 시간 일정
    await ev(`(() => { pcOpenForm({ date: todayYmd() }); return 1; })()`);
    ok('P1 체크한 과제가 하나면 등록 폼에 그 과제가 골라져 있다', (await ev(`document.getElementById('pcfProj').value`)) === projectUid);
    await fillAndSave({ proj: projectUid, title: TAG + ' 기간', s: today, e: d2, memo: '첫 줄\n둘째 줄' });
    let okSave = await waitFor(`document.getElementById('pcFormModal').classList.contains('hidden') && PCAL.events.some(e => e.title === ${S(TAG + ' 기간')})`, 15000);
    ok('P1 등록: 기간 일정이 저장되고 달력에 들어왔다', okSave);
    await ev(`(() => { pcOpenForm({ date: todayYmd() }); return 1; })()`);
    await fillAndSave({ proj: projectUid, title: TAG + ' 회의', s: today, e: today, st: '10:00', et: '11:00', loc: '(시험) 회의실', memo: '안건' });
    okSave = await waitFor(`document.getElementById('pcFormModal').classList.contains('hidden') && PCAL.events.some(e => e.title === ${S(TAG + ' 회의')})`, 15000);
    ok('P1 등록: 시간 일정이 저장되고 달력에 들어왔다', okSave);
    const evs = await J(`PCAL.events.filter(e => e.title.startsWith(${S(TAG)})).map(e => ({ uid: e.eventUid, title: e.title, rv: e.rowVersion }))`);
    evs.forEach(e => made.push(e.uid));
    const E1 = (evs.find(e => e.title === TAG + ' 기간') || {}).uid, E2 = (evs.find(e => e.title === TAG + ' 회의') || {}).uid;
    if (!E1 || !E2) { undecide('P1 일정 uid', JSON.stringify(evs)); return; }
    const m1 = await J(`(() => { const a = document.querySelector('#pcView .pc-ev[data-ev="${E1}"]'), b = document.querySelector('#pcView .pc-ev[data-ev="${E2}"]'); return { range: !!a && !a.classList.contains('timed'), span: a ? (+a.dataset.c1 - +a.dataset.c0) : -1, timed: !!b && b.classList.contains('timed') && !!b.querySelector('.pc-edot'), folded: !b && !!document.querySelector('#pcView .pc-more[data-more="${today}"]') }; })()`);
    //  창이 작으면 오늘 칸에 줄이 하나뿐이라 시간 일정이 "+n" 아래로 접힌다. 그때는 접힘 표시가 있으면 통과(목록은 P2 가 본다)
    ok('P1 월간: 기간 일정은 막대, 시간 일정은 점과 시각(작은 창은 +n)', m1.range && (m1.timed || m1.folded), JSON.stringify(m1));

    // P2 날짜 칸 → 그날 일정 목록
    const dl = await J(`(() => { const c = document.querySelector('#pcView .pc-day[data-date="${today}"]'); if(!c) return null; c.click(); const p = document.getElementById('pcPop'); return p ? { rows: [...p.querySelectorAll('.pc-dl .chip')].map(r => r.dataset.ev), edits: p.querySelectorAll('[data-act="edit"]').length, foot: !!p.querySelector('[data-act="newOn"]'), head: (p.querySelector('.pc-pop-n') || {}).textContent || '' } : null; })()`);
    ok('P2 그날 일정 목록: 두 일정 줄, [수정] 없음, 이 날짜에 일정 등록', !!dl && dl.rows.includes(E1) && dl.rows.includes(E2) && dl.edits === 0 && dl.foot && /^일정 \d+건$/.test(dl.head), dl ? JSON.stringify({ rows: dl.rows.length, edits: dl.edits, head: dl.head }) : '팝오버 없음');
    await ev(`pcEscape()`);

    // P3 주간
    await ev(`(() => { document.querySelector('#pcView [data-act="view"][data-v="week"]').click(); return 1; })()`);
    await waitFor(idle, 15000);
    ok('P3 주간: 과제 행에 두 일정', await ev(`!!document.querySelector('#pcView .pc-wcells[data-proj="${projectUid}"] .pc-ev[data-ev="${E1}"]') && !!document.querySelector('#pcView .pc-wcells .pc-ev[data-ev="${E2}"]')`));
    await ev(`(() => { document.querySelector('#pcView [data-act="view"][data-v="month"]').click(); return 1; })()`);
    await waitFor(idle, 15000);

    // P4 수정: 달력 → 그날 일정 목록 → 줄 → 상세 → 수정
    const rv0 = await ev(`pcEv(${S(E2)}).rowVersion`);
    //  막대가 보이면 막대, "+n" 으로 접혔으면 날짜 칸. 어느 쪽이든 그날 목록이 뜨고 그 일정 줄이 있다.
    //  누른 줄 강조는 없다(2026-10-23 사용자): 줄에 hit 과 aria-current 가 없고 초점은 목록 창 자체. 목록 창은 막대가 아니라 날짜 칸에 붙는다.
    const p4l = await J(`(() => { const b = document.querySelector('#pcView .pc-ev[data-ev="${E2}"]'); if(b) b.click(); else document.querySelector('#pcView .pc-day[data-date="${today}"]').click();
      const p = document.getElementById('pcPop'); if(!p) return null; const row = p.querySelector('.pc-dl .chip[data-ev="${E2}"]');
      const a = PCAL.pop && PCAL.pop.anchor;
      const r = { bar: !!b, row: !!row, marked: !!p.querySelector('.pc-dl .chip.hit, .pc-dl [aria-current]'), popFocus: document.activeElement === p,
        cell: !!a && a !== b && !!a.matches && a.matches('.pc-day[data-date], .pc-wday[data-date]') };
      if(row) row.click(); return r; })()`);
    ok('P4 누르면 그날 일정 목록이 뜨고 그 일정 줄이 있다(강조 없음, 초점은 목록 창, 날짜 칸에 붙음)', !!p4l && p4l.row && !p4l.marked && p4l.popFocus && p4l.cell, JSON.stringify(p4l));
    const det = await waitFor(`!document.getElementById('pcDetailModal').classList.contains('hidden') && !document.getElementById('pcPop')`, 5000);
    ok('P4 목록의 줄은 상세 창(삭제, 개인 일정에 등록, 수정)', det && (await ev(`[...document.querySelectorAll('#pcDetailFoot [data-act]')].map(b => b.dataset.act).join(',')`)) === 'delete,copy,edit');
    await ev(`(() => { document.querySelector('#pcDetailFoot [data-act="edit"]').click(); return 1; })()`);
    await waitFor(`!document.getElementById('pcFormModal').classList.contains('hidden')`, 5000);
    await ev(`(() => { document.getElementById('pcfTitle').value = ${S(TAG + ' 회의 고침')}; document.getElementById('pcfSave').click(); return 1; })()`);
    const p4 = await waitFor(`document.getElementById('pcFormModal').classList.contains('hidden') && (pcEv(${S(E2)}) || {}).title === ${S(TAG + ' 회의 고침')} && !PCAL.loading`, 15000);
    const rv1 = await ev(`(pcEv(${S(E2)}) || {}).rowVersion`);
    ok('P4 수정: 제목이 바뀌고 판이 올랐다', p4 && rv1 === rv0 + 1, `v${rv0} → v${rv1}`);

    // P5 충돌: 폼을 열어 둔 채 다른 사람의 저장을 흉내(같은 판으로 호스트 명령) → 내 저장은 충돌
    await ev(`(() => { pcOpenForm({ uid: ${S(E2)} }); return 1; })()`);
    await waitFor(`!document.getElementById('pcFormModal').classList.contains('hidden')`, 5000);
    //  J 는 JSON.stringify(식) 이라 Promise 를 기다리지 않는다. 비동기는 ev 로 받아 직접 푼다
    const other = JSON.parse(await ev(`(async () => { const e = pcEv(${S(E2)}); const r = await hostRequest('projectCalendarSave', { projectUid: e.projectUid, eventUid: e.eventUid, expectedVersion: e.rowVersion, mutationUid: pcUuid(), event: pcEventPayload({ title: ${S(TAG + ' 남의 고침')}, startDate: e.startDate, endDate: e.endDate, startTime: e.startTime, endTime: e.endTime, location: e.location, memo: e.memo }) }, 20000); return JSON.stringify({ ok: !!r.ok, v: r.data && r.data.rowVersion, err: r.error || null }); })()`));
    if (!other.ok) undecide('P5 다른 사람 흉내 저장', JSON.stringify(other));
    else {
      await ev(`(() => { document.getElementById('pcfMemo').value = '내 메모'; document.getElementById('pcfSave').click(); return 1; })()`);
      const cf = await waitFor(`/다른 사람이 먼저 고쳤습니다/.test(document.getElementById('pcfConflict').textContent)`, 10000);
      ok('P5 충돌 안내가 뜨고 내 입력은 그대로', cf && (await ev(`document.getElementById('pcfMemo').value`)) === '내 메모');
      await ev(`(() => { document.querySelector('#pcfConflict [data-act="cfKeep"]').click(); document.getElementById('pcfSave').click(); return 1; })()`);
      const kept = await waitFor(`document.getElementById('pcFormModal').classList.contains('hidden') && (pcEv(${S(E2)}) || {}).memo === '내 메모' && !PCAL.loading`, 15000);
      ok('P5 내 입력 유지 → 최신 판 위에 저장', kept, JSON.stringify(await J(`(() => { const e = pcEv(${S(E2)}) || {}; return { title: e.title, memo: e.memo, v: e.rowVersion }; })()`)));
    }

    // P6 최근 변경
    await ev(`(() => { pcOpenChanges(); return 1; })()`);
    const rc = await waitFor(`!PCAL.rc.busy && PCAL.rc.rows.some(c => c.title.startsWith(${S(TAG)}))`, 15000);
    ok('P6 최근 변경: 내 등록과 수정이 보인다', rc && (await ev(`document.getElementById('pccBody').textContent.includes(${S(TAG)})`)));
    await ev(`(() => { const s = document.getElementById('pccKind'); s.value = 'update'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    await waitFor(`!PCAL.rc.busy`, 15000);
    const kinds = await J(`[...new Set(PCAL.rc.rows.map(c => c.action))]`);
    ok('P6 종류 필터(수정)가 서버에서 걸린다', kinds.length > 0 && kinds.every(k => k === 'update'), JSON.stringify(kinds));
    await ev(`(() => { closeModal('#pcChangesModal'); return 1; })()`);
    await sleep(300);

    // P7 개인 일정에 등록: 지금 내용을 찍은 사본(새 개인 일정). 원본과 잇는 기록이 없어 "등록됨" 과 배지가 없다
    const nCopy = `state.entries.filter(e => e.title === ${S(TAG + ' 기간')}).length`;
    const c0 = await ev(nCopy);
    //  확인 창 없이 바로 보낸다(2026-10-23 사용자). 누른 직후 확인 창이 떠 있으면 실패.
    await ev(`(() => { pcOpenDetail(${S(E1)}); document.querySelector('#pcDetailFoot [data-act="copy"]').click(); return 1; })()`);
    ok('P7 개인 일정에 등록은 확인 창을 띄우지 않는다', await ev(`document.getElementById('confirmModal').classList.contains('hidden')`));
    const copied = await waitFor(`${nCopy} === ${c0 + 1} && !document.getElementById('pcDetailModal').dataset.busy`, 20000);
    copyEntry = await ev(`(state.entries.find(e => e.title === ${S(TAG + ' 기간')}) || {}).id || ''`);
    ok('P7 개인 일정에 등록: 개인 스냅샷에 새 개인 일정', copied, copyEntry);
    const rem = await J(`(() => { const e = state.entries.find(x => x.id === ${S(copyEntry)}); return e ? { has: true, remind: e.remind === undefined ? 'undefined' : e.remind } : { has: false }; })()`);
    ok('P7 사본의 미리알림은 새 기록과 같은 기본값(remind null, 알림 없음 0 이 아니다)', !!rem && rem.has && (rem.remind === null || rem.remind === 'undefined'), JSON.stringify(rem));
    ok('P7 상세는 그대로 "개인 일정에 등록"(등록됨 없음, 다시 누를 수 있음)', await ev(`(() => { const b = document.querySelector('#pcDetailFoot [data-act="copy"]'); return !!b && !b.disabled && !/등록됨/.test(document.getElementById('pcDetailFoot').textContent); })()`));
    ok('P7 개인 탭 출처 배지 없음(배지 함수도 없다)', await ev(`typeof pcCopyBadge === 'undefined' && !document.querySelector('.pc-copy-badge')`));
    await ev(`(() => { closeModal('#pcDetailModal'); return 1; })()`);
    await sleep(300);

    // P8 새로고침
    const before = await ev(`PCAL.events.filter(e => e.title.startsWith(${S(TAG)})).length`);
    await ev(`(() => { document.getElementById('pcRefresh').click(); return 1; })()`);
    await sleep(300);
    const p8 = await waitFor(idle, 20000);
    ok('P8 새로고침: 다시 읽고 일정이 그대로', p8 && (await ev(`PCAL.events.filter(e => e.title.startsWith(${S(TAG)})).length`)) === before, `${before}건`);

    // P9 참여자 명단(기획 §6.9): 왼쪽 목록의 n명 단추 → 가운데 창, 받은 total 이 목록에 보이는 수와 같다(같은 규칙으로 센다)
    const shown = await ev(`(() => { const b = document.querySelector('#pcView .pc-mbc[data-uid="${projectUid}"]'); if(!b) return -1; const n = parseInt(b.textContent, 10); b.click(); return n; })()`);
    if (shown < 0) undecide('P9 참여자 단추', '왼쪽 목록에 n명 단추가 없다(좁은 창이면 목록이 접혀 있다)');
    else {
      const mbOk = await waitFor(`!document.getElementById('pcMembersModal').classList.contains('hidden') && PCAL.mb.status === 'ok'`, 15000);
      const mb = await J(`{ status: PCAL.mb.status, err: PCAL.mb.err, total: PCAL.mb.total, rows: document.querySelectorAll('#pcmBox .pcm-row').length, me: document.querySelectorAll('#pcmBox .pcm-me').length,
        head: document.getElementById('pcmHead').textContent, btn: (document.querySelector('#pcView .pc-mbc[data-uid="${projectUid}"]') || {}).textContent || '' }`);
      ok('P9 참여자 명단: 창이 열리고 total 이 목록의 n명과 같다(줄 수도 같고 "나" 하나)', mbOk && mb.total === shown && mb.rows === mb.total && mb.me === 1 && mb.btn === mb.total + '명' && mb.head.endsWith(' 참여자 ' + mb.total + '명'), JSON.stringify({ shown, ...mb }));
      await ev(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return 1; })()`);
      ok('P9 Esc 로 참여자 창이 닫힌다', await waitFor(`document.getElementById('pcMembersModal').classList.contains('hidden')`, 3000));
    }
  } catch (e) { fail++; console.log('  ✗ 예외: ' + e.message); }
  finally {
    try {
      //  과제 일정: 하나는 화면의 삭제 단추로, 나머지는 호스트 명령으로(지금 판으로).
      const first = made[1] || made[0];
      if (first) {
        await ev(`(() => { if(!pcEv(${S(first)})) return 0; pcOpenDetail(${S(first)}); document.querySelector('#pcDetailFoot [data-act="delete"]').click(); return 1; })()`);
        if (await waitFor(`!document.getElementById('confirmModal').classList.contains('hidden')`, 5000)) {
          await ev(`(() => { document.getElementById('cfOk').click(); return 1; })()`);
          ok('정리: 화면 삭제 단추로 지웠다', await waitFor(`!pcEv(${S(first)}) && !PCAL.loading`, 15000));
        }
      }
      for (const u of made) {
        await ev(`(async () => { await pcLoad(); const e = pcEv(${S(u)}); if(!e) return 0; const r = await hostRequest('projectCalendarDelete', { projectUid: e.projectUid, eventUid: e.eventUid, expectedVersion: e.rowVersion, mutationUid: pcUuid() }, 20000); return r && r.ok ? 1 : 0; })()`);
      }
      await ev(`pcLoad()`);
      const left = await ev(`PCAL.events.filter(e => e.title.startsWith('zzPC-')).length`);
      ok('정리: 범위에 zzPC 과제 일정 0건(공용 일정은 소프트 삭제라 행과 이력은 DB 에 남는다, 설계대로)', left === 0, 'left=' + left);
      //  개인 복사본(보통 개인 일정이라 개인 삭제로 지운다)
      await ev(`(() => { state.entries.filter(e => String(e.title||'').startsWith('zzPC-')).forEach(e => deleteEntry(e.id)); return 1; })()`);
      await sleep(1500);
      const back = (await reloadAndWait()) ? await ev(`state.entries.filter(e => String(e.title||'').startsWith('zzPC-')).length`) : -1;
      ok('정리: 개인 복사본 삭제, 서버 재조회 0건', back === 0, 'remaining=' + back);
      //  화면 설정을 되돌린다
      if (saved) await ev(`(() => { PCAL.view = ${S(saved.view)}; PCAL.sel = ${S(saved.sel)}; PCAL.memoLine = ${S(saved.memo)}; pcSetTab(${S(saved.tab)}); pcPrefsSave(); if(pcOn()){ pcRender(); pcLoad(); } return 1; })()`);
    } catch (e) { console.log('  !!! 정리 실패: ' + e.message + ', zzPC-* 과제 일정과 개인 일정을 직접 지우세요'); }
    console.log(`\n통과 ${pass}, 실패 ${fail}, 판정 불가 ${und}`);
    try { ws.close(); } catch {}
    process.exit(fail ? 1 : (und ? 2 : 0));
  }
})();
