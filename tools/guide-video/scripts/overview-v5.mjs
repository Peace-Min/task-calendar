// 전체 소개 홍보 영상(v5, 앱 0.25.0, 약 25초). 개인 캘린더, 과제 공용 캘린더, 근태 탭을 빠르게 보여 준다.
//   첫 프레임(0초)은 제목 카드(openTitle). 장면 사이 준비는 act:'cut' 으로 녹화 없이 한다. 회사 전송 단추는 누르지 않는다.
//   오래된 overview.mjs(v3) 는 그대로 둔다.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function appIcon() {
  const ico = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'widget', 'app.ico');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', ico, '-frames:v', '1', '-vf', 'scale=256:256', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 1 << 24 });
  return r.status === 0 && r.stdout.length ? 'data:image/png;base64,' + r.stdout.toString('base64') : '';
}
const closeAll = `(() => { document.querySelectorAll('.overlay:not(.hidden) .x, .overlay:not(.hidden) .cat-x').forEach(b => b.click()); return 1; })()`;

export default (env) => {
  const icon = appIcon();
  const img = icon ? `<img src="${icon}" alt="">` : '';
  return {
    name: 'TaskCalendar_Overview_v5',
    title: '수행과제 캘린더 소개',
    cursorStart: [1180, 640],
    tail: 200,
    openTitle: `${img}<div class="kick">수행과제 캘린더</div><div class="name">전체 소개</div><div class="tag">개인 일정, 과제 일정, 근태를 한곳에서</div>`,
    pace: { capHold: 0, pre: 40, post: 120, dwell: 70, typeMs: 38, typeJitter: 14, curMin: 300, curMax: 460, curBase: 300, curK: 0.12, ease: 'cubic-bezier(.22,.61,.36,1)', capMin: 0, settle: 600 },
    prepare: [
      { js: closeAll, ms: 400 },
      { js: `(() => { for (const k of Object.keys(localStorage)) if (/^tc_att(W)?Draft:/.test(k)) localStorage.removeItem(k); try { localStorage.setItem('tc_attKind', 'day'); } catch (_) {} return 1; })()` },
      { js: `(() => { document.getElementById('pcTabAttend').click(); const t = document.querySelector('[data-atact=today]'); if (t) t.click(); document.getElementById('pcTabPersonal').click(); document.documentElement.style.setProperty('--dpw', '460px'); document.getElementById('btnToday').click(); selectDate('2026-11-02'); document.getElementById('dptab-detail').click(); return 1; })()`, ms: 800 },
    ],
    cleanup: [
      { js: `(() => { document.getElementById('pcTabPersonal').click(); const v = parseInt(localStorage.getItem('taskCalendar.panelW')); if (v > 0) document.documentElement.style.setProperty('--dpw', v + 'px'); else document.documentElement.style.removeProperty('--dpw'); return 1; })()`, ms: 300 },
    ],
    steps: [
      { act: 'titleOff', ms: 2100, post: 0 },

      // 1. 개인 캘린더(약 7초)
      { act: 'cursor', hide: false, pre: 0, post: 0 },
      { act: 'punch', text: '*개인 일정*과 할 일', sub: '날짜를 고르면 그 날의 기록이 옆에', pre: 0, post: 0 },
      { act: 'zoom', rect: [250, 180, 1200, 700], scale: 1.18, ms: 1800, post: 100 },
      { act: 'click', sel: '.cell[data-date="2026-11-16"] .cell-top', punch: '', pre: 0, post: 300 },
      { act: 'click', sel: '.cell[data-date="2026-11-12"] .cell-top', pre: 0, post: 400 },
      { act: 'click', sel: '#fbBtn', pre: 0, punch: '과제는 *골라서* 봅니다', post: 700 },
      { act: 'key', key: 'Escape', pre: 0, post: 100 },
      { act: 'js', js: `(() => { const p = document.getElementById('fbPop'); if (p && p.isConnected && getComputedStyle(p).display !== 'none') document.getElementById('fbBtn').click(); return 1; })()`, post: 300 },

      // 2. 과제 공용 캘린더(약 7초)
      { act: 'cut', do: [
        { act: 'zoom', reset: true, ms: 0 },
        { act: 'punch', text: '' },
        { act: 'move', xy: [104, 116], ms: 0 },
      ] },
      { act: 'click', sel: '#pcTabProject', punch: '*과제 공용* 일정', sub: '같은 과제의 참여자가 함께 봅니다', pre: 0, post: 500 },
      { act: 'waitFor', js: `!!document.querySelector('#pcView .pc-ev')`, post: 200 },
      { act: 'click', sel: '#pcView .pc-ev[data-occ="2026-11-10"]', pre: 0, post: 1500 },
      { act: 'click', sel: '#pcView .pc-mbc', nth: 0, pre: 0, punch: '*참여자*도 한눈에', post: 300 },
      { act: 'waitFor', js: `!!document.querySelector('#pcMembersModal') && !document.getElementById('pcMembersModal').classList.contains('hidden')`, post: 1200 },

      // 3. 근태 탭(약 7초)
      { act: 'cut', do: [
        { act: 'js', js: closeAll },
        { act: 'punch', text: '' },
        { act: 'move', xy: [166, 116], ms: 0 },
      ] },
      { act: 'click', sel: '#pcTabAttend', punch: '*근태*와 주간보고', sub: '일간 보고와 주간보고를 한 탭에서', pre: 0, post: 400 },
      { act: 'click', sel: '[data-atact=prev]', pre: 0, post: 1400 },
      { act: 'cut', do: [
        { act: 'js', js: `(() => { document.querySelector('[data-atkind=week]').click(); return 1; })()` },
        { act: 'wait', ms: 700 },
      ] },
      { act: 'punch', text: '주간보고 *목록*과 편집', pre: 0, post: 1700 },

      // 4. 맺음 카드
      { act: 'cut', do: [
        { act: 'js', js: `(() => { document.querySelector('[data-atkind=day]').click(); document.getElementById('pcTabPersonal').click(); return 1; })()` },
        { act: 'punch', text: '' },
      ] },
      { act: 'title', ms: 2600, keep: true, html: `${img}<div class="name">수행과제 캘린더</div><div class="tag">일정, 과제, 근태를 한곳에서</div>`, pre: 0, post: 0 },
    ],
  };
};
