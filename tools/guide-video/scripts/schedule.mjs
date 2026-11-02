// 개인 일정과 할 일 가이드(v5, 앱 0.25.0). 날짜 고르기, 새 기록(메모의 http 주소는 링크), 저장, 수정, 과제 필터(월간, 주간 옆 단추의 다중 선택 팝업),
//   할 일 추가와 완료, 삭제. 메모 링크는 누르지 않는다(브라우저가 열린다). 첫 프레임(0초)은 제목 카드(openTitle).
const ENTRY = '품질 점검 회의';
const TODO = '회의 자료 준비';
const OFFICIAL = '(예시) 장비 개발';
const LINK = 'https://example.com/guide';
const visible = id => `(() => { const m = document.getElementById('${id}'); return !!m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none'; })()`;
const hidden = id => `!${visible(id)}`;
const wipe = `(() => {
  document.querySelectorAll('.overlay:not(.hidden) .x').forEach(b => b.click());
  state.entries = state.entries.filter(e => e.title !== ${JSON.stringify(ENTRY)});
  state.todos = (state.todos || []).filter(t => t.text !== ${JSON.stringify(TODO)} && t.title !== ${JSON.stringify(TODO)});
  save(); renderAll(); return 1; })()`;
const filterAll = `(() => { document.getElementById('fbBtn').click(); const a = document.querySelector('#fbPop [data-act=all]'); if (a) a.click(); document.getElementById('fbBtn').click(); return 1; })()`;

export default (env) => ({
  name: 'TaskCalendar_Guide_Personal_v5',
  title: '수행과제 캘린더 사용 가이드: 개인 일정과 할 일',
  cursorStart: [1500, 520],
  tail: 400,
  openTitle: '<div class="kick">사용 영상</div><div class="name">개인 일정과 할 일</div><div class="tag">날짜를 골라 기록하고, 수정하고, 완료하고, 지웁니다</div>',
  pace: { capHold: 280, pre: 70, post: 180, dwell: 90, typeMs: 30, typeJitter: 14, curMin: 350, curMax: 500, curBase: 330, curK: 0.12, ease: 'cubic-bezier(.22,.61,.36,1)', capMin: 1600, settle: 600 },
  prepare: [
    { js: wipe, ms: 1200 },
    { js: `(() => { document.getElementById('pcTabPersonal').click(); localStorage.setItem('tc_calView', 'month'); document.documentElement.style.setProperty('--dpw', '460px'); document.getElementById('btnToday').click(); selectDate(${JSON.stringify(env.today)}); document.getElementById('dptab-detail').click(); return 1; })()`, ms: 900 },
    { js: filterAll, ms: 500 },
  ],
  cleanup: [
    { js: wipe, ms: 800 },
    { js: filterAll, ms: 400 },
    { js: `(() => { const v = parseInt(localStorage.getItem('taskCalendar.panelW')); if (v > 0) document.documentElement.style.setProperty('--dpw', v + 'px'); else document.documentElement.style.removeProperty('--dpw'); return 1; })()` },
  ],
  steps: [
    { act: 'titleOff', ms: 2000 },

    // 1. 날짜 고르기, 새 기록
    { act: 'click', sel: `.cell[data-date="${env.day}"] .cell-top`, at: [0.5, 0.5], cap: '달력에서 날짜를 고르면 오른쪽 패널이 그 날을 보여 줍니다', n: 1 },
    { act: 'highlight', sel: '#dayPanel .dp-head, #dayPanel h2, #dpBody', nth: 0, id: 'h0', ms: 900 },
    { act: 'click', sel: '#btnAddHere', cap: '패널의 추가를 누르면 새 기록 창이 열립니다', n: 1 },
    { act: 'waitFor', js: visible('quickAdd'), post: 300 },

    // 2. 입력과 저장
    { act: 'type', sel: '#qaTitle', text: ENTRY, cap: '제목을 적고 과제를 고릅니다', n: 2 },
    { act: 'select', sel: '#qaCat', label: OFFICIAL },
    { act: 'click', sel: '#qaStart', cap: '시작 시각은 목록에서 시와 분을 누릅니다', n: 2 },
    { act: 'click', sel: '#qaStartTfH14', scroll: true },
    { act: 'click', sel: '#qaStartTfM0' },
    { act: 'wait', ms: 500 },
    { act: 'highlight', sel: '#qaEnd', id: 'h1', label: '종료 시각은 한 시간 뒤로 채워집니다', below: true, ms: 1800 },
    { act: 'type', sel: '#qaMemo', text: `참고 자료 ${LINK}`, cap: '메모에 http 주소를 적으면 링크가 됩니다', n: 2 },
    { act: 'click', sel: '#qaSave', cap: '저장을 누릅니다', n: 2 },
    { act: 'waitFor', js: hidden('quickAdd'), post: 400 },
    { act: 'highlight', sel: `#dpBody .card::text(${ENTRY})`, id: 'h2', label: '새 일정', ms: 0, cap: '저장한 일정은 패널과 달력에 보입니다', n: 2 },
    { act: 'highlight', sel: `.chip[data-occ="${env.day}"]::text(${ENTRY.slice(0, 5)})`, id: 'h3', ms: 1500 },
    { act: 'unhighlight' },
    { act: 'highlight', sel: `#dpBody .card::text(${ENTRY}) >> a`, id: 'h4', label: '링크가 된 주소', below: true, ms: 2200, if: `!!document.querySelector('#dpBody .card a')` },

    // 3. 수정
    { act: 'click', sel: `#dpBody .card::text(${ENTRY}) >> [data-act=edit]`, cap: '고칠 때는 카드의 수정을 누릅니다', n: 3 },
    { act: 'waitFor', js: visible('quickAdd'), post: 300 },
    { act: 'click', sel: '#qaEnd', cap: '끝나는 시각을 16시로 바꿉니다', n: 3 },
    { act: 'click', sel: '#qaEndTfH16' },
    { act: 'click', sel: '#qaEndTfM0' },
    { act: 'click', sel: '#qaSave', cap: '저장하면 바로 바뀝니다', n: 3 },
    { act: 'waitFor', js: hidden('quickAdd'), post: 300 },
    { act: 'highlight', sel: `#dpBody .card::text(${ENTRY})`, id: 'h5', ms: 1400 },

    // 4. 과제 필터
    { act: 'click', sel: '#fbBtn', cap: '월간, 주간 옆의 과제 단추로 보고 싶은 과제만 거릅니다', n: 4 },
    { act: 'wait', ms: 500 },
    { act: 'click', sel: '#fbPop [data-act=none]', cap: '여러 과제를 체크해 함께 볼 수 있습니다', n: 4 },
    { act: 'click', sel: `#fbList .fb-opt::text(${OFFICIAL})` },
    { act: 'click', sel: '#fbList .fb-opt::text(그룹웨어)', post: 300 },
    { act: 'highlight', sel: '#fbBtn', id: 'h6', label: '고른 과제만 달력에 나옵니다', below: true, ms: 2200 },
    { act: 'click', sel: '#fbPop [data-act=all]', cap: '전체 선택으로 되돌립니다', n: 4 },
    { act: 'key', key: 'Escape', post: 200 },
    { act: 'js', js: `(() => { const p = document.getElementById('fbPop'); if (p && p.isConnected && getComputedStyle(p).display !== 'none') document.getElementById('fbBtn').click(); return 1; })()`, post: 300 },

    // 5. 할 일
    { act: 'click', sel: '#dptab-todo', cap: '완료를 체크할 일은 할 일 탭에 둡니다', n: 5 },
    { act: 'click', sel: '#btnTodoNew' },
    { act: 'waitFor', js: visible('quickAdd'), post: 300 },
    { act: 'type', sel: '#qaTitle', text: TODO, cap: '할 일을 짧게 적고 과제를 고릅니다', n: 5 },
    { act: 'select', sel: '#qaCat', label: OFFICIAL },
    { act: 'click', sel: '#qaSave' },
    { act: 'waitFor', js: hidden('quickAdd'), post: 400 },
    { act: 'highlight', sel: `#dpBody .todo-row::text(${TODO})`, id: 'h7', label: '새 할 일', ms: 1500 },

    // 6. 완료
    { act: 'click', sel: `#dpBody .todo-row::text(${TODO}) >> .todo-check`, cap: '체크하면 이 날 완료로 옮겨집니다', n: 6, post: 400 },
    { act: 'click', sel: '#dpBody .nd-sec[data-sec=done]', if: `document.querySelector('#dpBody .nd-sec[data-sec=done]')?.getAttribute('aria-expanded') === 'false'` },
    { act: 'highlight', sel: `#dpBody .todo-row::text(${TODO})`, id: 'h8', label: '완료', ms: 1500 },
    { act: 'click', sel: `#dpBody .todo-row::text(${TODO}) >> .todo-check`, cap: '다시 누르면 되돌아옵니다', n: 6, post: 400 },

    // 7. 삭제
    { act: 'click', sel: '#dptab-detail', cap: '필요 없는 일정은 확인한 뒤 지웁니다', n: 7 },
    { act: 'click', sel: `#dpBody .card::text(${ENTRY}) >> [data-act=del]` },
    { act: 'waitFor', js: visible('confirmModal'), post: 500 },
    { act: 'click', sel: '#cfOk', cap: '삭제를 누르면 일정이 지워집니다', n: 7 },
    { act: 'waitFor', js: hidden('confirmModal'), post: 500 },
    { act: 'wait', ms: 1200 },
  ],
});
