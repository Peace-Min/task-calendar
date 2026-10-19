// 홍보 영상(v3, 25~35초). 설명 영상이 아니라 짧은 장면을 빠르게 잇는 소개: 제목 카드, 한 달 달력, 빠른 일정 추가, 하루 패널, 할 일 체크,
//   과제 필터, 보고서 자동 초안(전송 안 함), 다른 사람 일정 창(겹쳐 보기)과 최대화, 제품 카드.
//   장면 사이 준비 동작은 act:'cut' 의 do 로 녹화 없이 한다. 확대와 이동은 act:'zoom'(body transform, 글자가 선명하다).
//   이 영상에서 만든 일정은 cleanup 에서 지운다(뒤 영상에 남지 않게). 할 일 체크는 녹화 밖에서 되돌린다.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 제품 아이콘(widget/app.ico 256px)을 PNG data URI 로(처음과 끝 카드).
function appIcon() {
  const ico = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'widget', 'app.ico');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', ico, '-frames:v', '1', '-vf', 'scale=256:256', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 1 << 24 });
  return r.status === 0 && r.stdout.length ? 'data:image/png;base64,' + r.stdout.toString('base64') : '';
}
const visible = id => `(() => { const m = document.getElementById('${id}'); return !!m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none'; })()`;
const hidden = id => `!${visible(id)}`;
const closeAll = `(() => { document.querySelectorAll('.overlay:not(.hidden) .x, .overlay:not(.hidden) [data-close]').forEach(b => b.click()); return 1; })()`;
const QUICK = '고객사 미팅 준비';   // 이 영상에서만 잠깐 만드는 일정(cleanup 에서 지움)
const TODO_ID = 't-1011d369-f3ff-546e-9cbb-a6e97b5c8249';   // 데모 할 일 '주간 보고 초안 작성'(10/17~10/23)
// 체크한 할 일을 녹화 밖에서 되돌린다(완료 구획이 접혀 있으면 행이 안 보여서 함수로).
const undoTodo = `(() => { const t = (state.todos || []).find(t => t.id === ${JSON.stringify(TODO_ID)}); if (t && t.done) { toggleTodo(t.id); renderPanel(); renderGrid(); } return 1; })()`;

export default (env) => {
  const icon = appIcon();
  const ADD_DAY = '2026-10-21';
  return {
    name: 'TaskCalendar_Overview_v3',
    title: '수행과제 캘린더 소개',
    cursorStart: [1180, 640],
    closePeerAfter: true,
    resetPeer: 'kimcs',
    tail: 200,
    pace: { capHold: 0, pre: 40, post: 120, dwell: 70, typeMs: 38, typeJitter: 14, curMin: 300, curMax: 460, curBase: 300, curK: 0.12, ease: 'cubic-bezier(.22,.61,.36,1)', capMin: 0, settle: 500 },
    prepare: [
      { js: closeAll, ms: 400 },
      { js: `(() => { localStorage.setItem('tc_peerLayout', 'overlay'); localStorage.setItem('tc_peerOverlay', '1'); localStorage.setItem('tc_peerDensity', 'fixed'); return 1; })()` },
      { js: `(() => { state.entries = state.entries.filter(e => e.title !== ${JSON.stringify(QUICK)}); save(); return 1; })()`, ms: 600 },
      { js: undoTodo, ms: 300 },
      { js: `(() => { document.documentElement.style.setProperty('--dpw', '460px'); filterCatId = null; renderAll(); document.getElementById('btnToday').click(); selectDate(${JSON.stringify(env.today)}); document.getElementById('dptab-detail').click(); return 1; })()`, ms: 700 },
    ],
    cleanup: [
      { js: undoTodo, ms: 300 },
      { js: `(() => { const n = state.entries.length; state.entries = state.entries.filter(e => e.title !== ${JSON.stringify(QUICK)}); if (state.entries.length !== n) save(); filterCatId = null; renderAll(); return 1; })()`, ms: 600 },
      { js: `(() => { const v = parseInt(localStorage.getItem('taskCalendar.panelW')); if (v > 0) document.documentElement.style.setProperty('--dpw', v + 'px'); else document.documentElement.style.removeProperty('--dpw'); return 1; })()` },
    ],
    steps: [
      // 0. 제목 카드
      { act: 'title', ms: 2100, html: `<div class="kick">업무 캘린더</div>${icon ? `<img src="${icon}" alt="">` : ''}<div class="name">수행과제 캘린더</div><div class="tag">하루 기록이 보고서가 되는 업무 캘린더</div>`, post: 0 },

      // 1. 한 달 달력: 천천히 밀고 들어간다
      { act: 'cursor', hide: false, pre: 0, post: 0 },
      { act: 'punch', text: '한 달이 *한눈에*', pre: 0, post: 0 },
      { act: 'zoom', rect: [250, 520, 1200, 500], scale: 1.22, ms: 2300, post: 200 },

      // 2. 빠른 일정 추가
      { act: 'cut', do: [
        { act: 'zoom', reset: true, ms: 0 },
        { act: 'punch', text: '' },
        { act: 'click', sel: `.cell[data-date="${ADD_DAY}"] .cell-top`, ms: 0 },
        { act: 'click', sel: '#btnAddHere', ms: 0 },
        { act: 'waitFor', js: visible('quickAdd') },
        { act: 'wait', ms: 300 },
      ] },
      { act: 'zoom', sel: '#quickAdd .modal', scale: 1.35, ms: 550, punch: '일정은 *몇 초* 만에', pre: 0, post: 0 },
      { act: 'type', sel: '#qaTitle', text: QUICK, pre: 0, post: 150 },
      { act: 'click', sel: '#qaSave', post: 100 },
      { act: 'waitFor', js: hidden('quickAdd'), post: 0 },
      { act: 'zoom', sel: `.cell[data-date="${ADD_DAY}"]`, scale: 1.7, ms: 650, post: 600 },

      // 3. 하루 기록은 옆 패널
      { act: 'cut', do: [
        { act: 'zoom', reset: true, ms: 0 },
        { act: 'punch', text: '' },
        { act: 'js', js: `(() => { selectDate('2026-10-14'); document.getElementById('dptab-detail').click(); return 1; })()` },
        { act: 'move', xy: [900, 640], ms: 0 },
        { act: 'wait', ms: 250 },
      ] },
      { act: 'click', sel: `.cell[data-date="2026-10-15"] .cell-top`, punch: '하루 기록은 *옆 패널*에', pre: 0, post: 100 },
      { act: 'zoom', sel: '#dayPanel', scale: 1.3, ms: 900, post: 700 },

      // 4. 할 일 체크
      { act: 'cut', do: [
        { act: 'zoom', reset: true, ms: 0 },
        { act: 'punch', text: '' },
        { act: 'js', js: `(() => { selectDate(${JSON.stringify(env.today)}); document.getElementById('dptab-todo').click(); return 1; })()` },
        { act: 'wait', ms: 350 },
        { act: 'zoom', sel: '#dayPanel', scale: 1.45, ms: 0 },
        { act: 'move', sel: `#dpBody .todo-row[data-id="${TODO_ID}"] .todo-check`, ms: 0 },
        { act: 'wait', ms: 300 },
      ] },
      { act: 'punch', text: '할 일은 *체크 한 번*', pre: 0, post: 300 },
      { act: 'click', sel: `#dpBody .todo-row[data-id="${TODO_ID}"] .todo-check`, scroll: false, post: 250 },
      { act: 'click', sel: '#dpBody .nd-sec[data-sec=done]', scroll: false, if: `document.querySelector('#dpBody .nd-sec[data-sec=done]')?.getAttribute('aria-expanded') === 'false'`, post: 1000 },

      // 5. 과제 필터
      { act: 'cut', do: [
        { act: 'js', js: undoTodo },
        { act: 'zoom', reset: true, ms: 0 },
        { act: 'punch', text: '' },
        { act: 'js', js: `(() => { document.getElementById('dptab-detail').click(); return 1; })()` },
        { act: 'move', xy: [620, 300], ms: 0 },
        { act: 'wait', ms: 250 },
      ] },
      { act: 'click', sel: '#filterbar .fchip::text(장비 개발)', punch: '과제별로 *골라 보기*', pre: 0, post: 1300 },

      // 6. 보고서 자동 초안(주간 작성, 회사 주간보고 모양). 전송 단추는 누르지 않는다.
      { act: 'cut', do: [
        { act: 'js', js: `(() => { filterCatId = null; renderAll(); return 1; })()` },
        { act: 'punch', text: '' },
        { act: 'click', sel: '#btnReportTop', ms: 0 },
        { act: 'waitFor', js: visible('reportModal') },
        { act: 'click', sel: '#reportModal [data-rmode=weekly]', ms: 0 },
        { act: 'wait', ms: 500 },
        { act: 'setValue', sel: '#rptFrom', value: '2026-10-14' },
        { act: 'js', js: `(() => { document.activeElement && document.activeElement.blur(); return 1; })()` },
        { act: 'wait', ms: 600 },
        { act: 'move', xy: [1500, 600], ms: 0 },
      ] },
      { act: 'punch', text: '보고서는 *자동 초안*', where: 'right', pre: 0, post: 0 },
      { act: 'zoom', sel: '#rptOut .rwf', scale: 1.45, ms: 1000, post: 300 },
      { act: 'wheel', sel: '#rptOut', at: [0.6, 0.6], dy: 120, times: 4, every: 110, post: 900 },

      // 7. 다른 사람 일정 창(겹쳐 보기)
      { act: 'cut', do: [
        { act: 'zoom', reset: true, ms: 0 },
        { act: 'punch', text: '' },
        { act: 'js', js: closeAll },
        { act: 'wait', ms: 400 },
        { act: 'click', sel: '#btnPeerPick', ms: 0 },
        { act: 'waitFor', js: `(() => { const s = document.getElementById('pkSearch'); return !!s && s.offsetParent !== null; })()` },
        { act: 'wait', ms: 300 },
        { act: 'move', sel: '#pkBody [data-act=open][data-login=kimcs]', at: [0.3, 0.5], ms: 0 },
      ] },
      { act: 'click', sel: '#pkBody [data-act=open][data-login=kimcs]', at: [0.3, 0.5], punch: '동료 일정은 *따로 띄워서*', pre: 300, post: 0 },
      { act: 'toPeer', settle: 500, post: 200 },
      { act: 'zoom', sel: 'frame:#dayPanel', scale: 1.45, ms: 1200, post: 800 },
      { act: 'zoom', reset: true, ms: 500, post: 0 },

      // 8. 창은 마음대로(최대화)
      { act: 'os', op: 'maximize', btn: 'max', punch: '창은 *마음대로*', pre: 300, ms: 700, post: 0 },
      { act: 'wait', ms: 1200, post: 0 },
      { act: 'os', op: 'close', btn: 'close', punch: '', pre: 0, ms: 300, post: 0 },

      // 9. 제품 카드
      { act: 'title', ms: 2900, keep: true, html: `${icon ? `<img src="${icon}" alt="">` : ''}<div class="name">수행과제 캘린더</div><div class="tag">일정, 할 일, 보고서를 한곳에서</div>`, pre: 0, post: 0 },
    ],
  };
};
