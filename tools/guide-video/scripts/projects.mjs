// 내 과제 등록 가이드(v5, 앱 0.25.0). 내 과제 창(한 상자 목록, 과제 추가는 목록 아래 단추)과 과제 추가 창(일반 과제, 공식 과제 표)으로
//   일반 과제와 공식 과제를 더한다. 첫 프레임(0초)은 제목 카드다(openTitle). 실제 화면 이름과 선택자는 ../FLOWS.md 의 v5 절.
//   만든 과제는 cleanup 에서 지운다(뒤 영상에 남지 않게).
const NEW_TASK = '사내 스터디';
const OFFICIAL = '(예시) 모바일 앱 2차 개발';
const visible = id => `(() => { const m = document.getElementById('${id}'); return !!m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none'; })()`;
const hidden = id => `!${visible(id)}`;
const wipe = `(() => {
  document.querySelectorAll('.overlay:not(.hidden) .x, .overlay:not(.hidden) .cat-x').forEach(b => b.click());
  for (const c of state.categories.filter(c => c.name === ${JSON.stringify(NEW_TASK)} && !isOfficialCat(c))) deleteCategory(c.id);
  const q = state.categories.find(c => c.name === ${JSON.stringify(OFFICIAL)});
  if (q) { state.entries = state.entries.filter(e => e.categoryId !== q.id); state.todos = (state.todos || []).filter(t => t.categoryId !== q.id); unsubscribeDbCat(q.id); }
  save(); filterCatId = null; renderAll(); return 1; })()`;

export default (env) => ({
  name: 'TaskCalendar_Guide_Projects_v5',
  title: '수행과제 캘린더 사용 가이드: 내 과제 등록',
  cursorStart: [1500, 520],
  tail: 400,
  openTitle: '<div class="kick">사용 영상</div><div class="name">내 과제 등록</div><div class="tag">일반 과제와 공식 과제를 내 목록에 더합니다</div>',
  pace: { capHold: 280, pre: 70, post: 180, dwell: 90, typeMs: 30, typeJitter: 14, curMin: 350, curMax: 500, curBase: 330, curK: 0.12, ease: 'cubic-bezier(.22,.61,.36,1)', capMin: 1600, settle: 600 },
  prepare: [
    { js: wipe, ms: 1500 },
    { js: `(() => { document.getElementById('pcTabPersonal').click(); document.documentElement.style.setProperty('--dpw', '460px'); document.getElementById('btnToday').click(); selectDate(${JSON.stringify(env.today)}); return 1; })()`, ms: 900 },
  ],
  cleanup: [
    { js: wipe, ms: 800 },
    { js: `(() => { const v = parseInt(localStorage.getItem('taskCalendar.panelW')); if (v > 0) document.documentElement.style.setProperty('--dpw', v + 'px'); else document.documentElement.style.removeProperty('--dpw'); return 1; })()` },
  ],
  steps: [
    { act: 'titleOff', ms: 2000 },

    // 1. 내 과제 창
    { act: 'click', sel: '#btnCatsTop', cap: '상단의 내 과제를 엽니다', n: 1 },
    { act: 'waitFor', js: visible('categoryModal'), post: 300 },
    { act: 'highlight', sel: '#catWrap', id: 'h1', label: '내 과제는 한 상자 목록입니다', below: false, cap: '공식 과제와 일반 과제가 한 목록에 있습니다', n: 1, ms: 2200 },
    { act: 'highlight', sel: '#catList .cat-row[data-kind=official]', nth: 0, id: 'h2', label: '공식 표시가 붙은 과제는 회사 목록의 과제', below: true, ms: 1900, if: `!!document.querySelector('#catList .cat-row')` },
    { act: 'highlight', sel: '#btnCatAdd', id: 'h3', label: '과제 추가는 목록 아래 단추', below: false, cap: '과제 추가는 목록 아래 단추로 합니다', n: 1, ms: 1800 },

    // 2. 일반 과제
    { act: 'click', sel: '#btnCatAdd', cap: '과제 추가를 누르면 과제 추가 창이 열립니다', n: 2 },
    { act: 'waitFor', js: visible('catAddModal'), post: 300 },
    { act: 'click', sel: '#caTabOwn', cap: '일반 과제 탭에서 내가 직접 만듭니다', n: 2 },
    { act: 'type', sel: '#caName', text: NEW_TASK, cap: '과제 이름을 적고 색상을 고릅니다', n: 2 },
    { act: 'click', sel: '#caPalette .swatch[data-color="#d6494e"]' },
    { act: 'type', sel: '#caDesc', text: '매주 목요일 기술 공유', cap: '메모는 선택입니다', n: 2 },
    { act: 'click', sel: '#caAddOwn', cap: '추가를 누르면 내 과제에 들어갑니다', n: 2 },
    { act: 'waitFor', js: `state.categories.some(c => c.name === ${JSON.stringify(NEW_TASK)})`, post: 300 },
    { act: 'waitFor', js: hidden('catAddModal'), post: 300 },
    { act: 'scrollTo', sel: `#catList .cat-row::text(${NEW_TASK})`, block: 'center', ms: 400 },
    { act: 'highlight', sel: `#catList .cat-row::text(${NEW_TASK})`, id: 'h4', label: '새 일반 과제', ms: 1700, cap: '일반 과제가 목록에 들어왔습니다', n: 2 },

    // 3. 공식 과제
    { act: 'click', sel: '#btnCatAdd', cap: '공식 과제는 같은 과제 추가 창에서 고릅니다', n: 3 },
    { act: 'waitFor', js: visible('catAddModal'), post: 300 },
    { act: 'click', sel: '#caTabOff', cap: '공식 과제 탭에는 회사 과제 표가 나옵니다', n: 3 },
    { act: 'wait', ms: 400 },
    { act: 'highlight', sel: '#caList', id: 'h5', label: '통상명칭, 계약명, 발주처, 상태, 계약기간', below: true, ms: 2200 },
    { act: 'type', sel: '#caSearch', text: '모바일', cap: '통상명칭, 사업명, 발주처로 찾습니다', n: 3, post: 500 },
    { act: 'highlight', sel: `#caList .ca-r[data-caid]::text(모바일)`, id: 'h6', ms: 1200 },
    { act: 'click', sel: `#caList .ca-r[data-caid]::text(모바일) >> [data-caadd]`, cap: '추가를 누르면 공식 과제도 내 과제에 들어갑니다', n: 3 },
    { act: 'waitFor', js: `state.categories.some(c => c.name === ${JSON.stringify(OFFICIAL)})`, post: 600 },
    { act: 'waitFor', js: `!!document.querySelector('#caList [data-caadd]') || true`, post: 200 },
    { act: 'click', sel: '#catAddModal .x', cap: '창을 닫습니다', n: 3 },
    { act: 'waitFor', js: hidden('catAddModal'), post: 300 },

    // 4. 목록 확인
    { act: 'scrollTo', sel: `#catList .cat-row::text(${NEW_TASK})`, block: 'center', ms: 400 },
    { act: 'highlight', sel: `#catList .cat-row::text(${OFFICIAL})`, id: 'h7', label: '공식 과제', below: true, cap: '두 과제가 내 목록에 들어왔습니다', n: 4, ms: 0 },
    { act: 'highlight', sel: `#catList .cat-row::text(${NEW_TASK})`, id: 'h8', label: '일반 과제', ms: 2000 },
    { act: 'unhighlight' },
    { act: 'click', sel: '#categoryModal .cat-x', cap: '닫으면 과제 필터와 새 기록에서 바로 쓸 수 있습니다', n: 4 },
    { act: 'waitFor', js: hidden('categoryModal'), post: 300 },
    { act: 'click', sel: '#fbBtn' },
    { act: 'wait', ms: 400 },
    { act: 'highlight', sel: `#fbList .fb-opt::text(${NEW_TASK})`, id: 'h9', below: true, ms: 0 },
    { act: 'highlight', sel: `#fbList .fb-opt::text(모바일)`, id: 'h10', below: true, ms: 2000 },
    { act: 'unhighlight' },
    { act: 'key', key: 'Escape', post: 200 },
    { act: 'js', js: `(() => { const p = document.getElementById('fbPop'); if (p && p.parentNode) { document.body.click(); } return 1; })()` },
  ],
});
