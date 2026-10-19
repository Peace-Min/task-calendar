// 일정과 할 일 관리 가이드(v3). 과제 준비(공식 과제와 일반 과제)부터 시작한다(이슈 #13 의 올바른 순서).
//   내용과 순서는 v2 와 같고 속도만 빠르게: 짧은 대기, ease-out 커서(350~500ms), 빠른 입력, 자막 최소 1.6초, 사소한 단계는 합쳤다.
//   실제 화면 이름과 선택자는 ../FLOWS.md. 자막은 한 줄, 30자 안팎.
const NEW_TASK = '사내 스터디';
const NEW_COLOR = '#d6494e';
const OFFICIAL = '(예시) 품질 관리 시스템 고도화';
const ENTRY = '품질 시스템 요구사항 회의';
const TODO = '회의 자료 준비';

const visible = id => `(() => { const m = document.getElementById('${id}'); return !!m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none'; })()`;
const hidden = id => `!${visible(id)}`;

export default (env) => ({
  name: 'TaskCalendar_Guide_ScheduleTodo_v3',
  title: '수행과제 캘린더 사용 가이드: 일정과 할 일 관리',
  cursorStart: [980, 600],
  tail: 300,
  pace: { capHold: 280, pre: 70, post: 180, dwell: 90, typeMs: 30, typeJitter: 14, curMin: 350, curMax: 500, curBase: 330, curK: 0.12, ease: 'cubic-bezier(.22,.61,.36,1)', capMin: 1600, settle: 600 },
  // 녹화 전 정리(화면에 안 나옴): 지난 시도로 생긴 과제와 기록을 걷고, 오늘 화면으로 맞춘다.
  prepare: [
    { js: `(() => { document.querySelectorAll('.overlay:not(.hidden) .x').forEach(b => b.click()); return 1; })()`, ms: 500 },
    { js: `(() => {
        for (const c of state.categories.filter(c => c.name === ${JSON.stringify(NEW_TASK)} && !isOfficialCat(c))) deleteCategory(c.id);
        const q = state.categories.find(c => c.name === ${JSON.stringify(OFFICIAL)});
        if (q) { state.entries = state.entries.filter(e => e.categoryId !== q.id); state.todos = (state.todos || []).filter(t => t.categoryId !== q.id); unsubscribeDbCat(q.id); }
        state.entries = state.entries.filter(e => e.title !== ${JSON.stringify(ENTRY)});
        state.todos = (state.todos || []).filter(t => t.text !== ${JSON.stringify(TODO)} && t.title !== ${JSON.stringify(TODO)});
        save(); filterCatId = null; renderAll(); return 1; })()`, ms: 1500 },
    { js: `(() => { document.documentElement.style.setProperty('--dpw', '460px'); document.getElementById('btnToday').click(); selectDate(${JSON.stringify(env.today)}); document.getElementById('dptab-detail').click(); return 1; })()`, ms: 800 },
  ],
  cleanup: [
    { js: `(() => { const v = parseInt(localStorage.getItem('taskCalendar.panelW')); if (v > 0) document.documentElement.style.setProperty('--dpw', v + 'px'); else document.documentElement.style.removeProperty('--dpw'); return 1; })()` },
  ],
  steps: [
    { act: 'card', ms: 2300, html: `<h1>일정과 할 일 관리</h1><p>먼저 내 과제를 준비하고, 날짜를 골라 일정과 할 일을 기록합니다.</p>` },

    // 1. 과제 유형
    { act: 'click', sel: '#btnCatsTop', cap: '툴바의 내 과제를 엽니다', n: 1 },
    { act: 'waitFor', js: visible('categoryModal'), post: 0 },
    { act: 'js', js: `(() => { const b = document.querySelector('#categoryModal .modal-body'); if (b) b.scrollTop = 0; return 1; })()`, post: 250 },
    { act: 'card', ms: 4600, dim: true, cap: '과제는 두 가지입니다', n: 1, html:
      `<h1>과제는 두 가지입니다</h1><div class="cols">
        <div class="col"><h3>공식 과제 <span class="bd">DB</span></h3><ul><li>회사 DB 에서 관리하는 과제</li><li>찾아보기에서 골라 추가</li><li>과제 이름은 회사 DB 그대로</li></ul></div>
        <div class="col"><h3>일반 과제</h3><ul><li>내가 직접 만드는 개인 과제</li><li>이름과 색을 자유롭게</li><li>회의, 교육 같은 일상 업무에</li></ul></div></div>` },
    { act: 'highlight', sel: '#btnOfficialOpen', id: 'h1', below: false, cap: '공식 과제(DB 과제)는 회사 목록에서 고릅니다', n: 1, ms: 0 },
    { act: 'highlight', sel: '#catList .cat-row:has(.cat-badge.db)', all: true, id: 'h2', label: 'DB 배지 = 공식 과제', below: false, ms: 1700 },
    { act: 'unhighlight', id: 'h1', post: 80 },
    { act: 'highlight', sel: '#catList .cat-row:not(:has(.cat-badge.db))', all: true, id: 'h3', label: '배지 없음 = 일반 과제(휴가, 기타는 기본)', below: true, cap: '일반 과제(개인 과제)는 직접 만듭니다', n: 1, ms: 1800 },

    // 2. 일반 과제 추가
    { act: 'scrollTo', sel: '#cName', block: 'center', ms: 450, cap: '일반 과제 추가: 이름과 색을 정합니다', n: 2 },
    { act: 'type', sel: '#cName', text: NEW_TASK },
    { act: 'click', sel: `#cPalette .swatch[data-color="${NEW_COLOR}"]` },
    { act: 'type', sel: '#cDesc', text: '매주 목요일 기술 공유', cap: '설명은 선택입니다. 과제 추가를 누릅니다', n: 2 },
    { act: 'click', sel: '#btnCatSave' },
    { act: 'waitFor', js: `state.categories.some(c => c.name === ${JSON.stringify(NEW_TASK)})`, post: 100 },
    { act: 'scrollTo', sel: `#catList .cat-row::text(${NEW_TASK})`, block: 'center', ms: 450 },
    { act: 'highlight', sel: `#catList .cat-row::text(${NEW_TASK})`, id: 'h4', label: '새 일반 과제', ms: 1300 },

    // 3. 공식 과제 연결
    { act: 'scrollTo', sel: '#btnOfficialOpen', block: 'center', ms: 450, cap: '공식 과제는 찾아보기에서 연결합니다', n: 3 },
    { act: 'click', sel: '#btnOfficialOpen' },
    { act: 'waitFor', js: visible('officialModal'), post: 300 },
    { act: 'type', sel: '#offSearch', text: '품질', cap: '사업명, 통상명칭, 발주처로 찾습니다', n: 3, post: 400 },
    { act: 'click', sel: '#offList .off-row::text(품질 관리)', cap: '과제를 고르면 정보가 나옵니다', n: 3 },
    { act: 'highlight', sel: '#offDetail', id: 'h5', ms: 1300 },
    { act: 'click', sel: '#offDetail [data-offadd]', cap: '캘린더에 추가를 누르면 연결됩니다', n: 3 },
    { act: 'waitFor', js: `state.categories.some(c => c.name === ${JSON.stringify(OFFICIAL)})`, post: 100 },
    { act: 'highlight', sel: '#offDetail .off-d-sub', id: 'h6', label: '추가됨', ms: 1300 },
    { act: 'caption', cap: '공식 과제 원본 등록과 편집은 관리자 메뉴입니다', n: 3, ms: 1300 },
    { act: 'click', sel: '#officialModal .modal-foot [data-close]' },
    { act: 'waitFor', js: hidden('officialModal'), post: 100 },

    // 4. 목록 확인
    { act: 'scrollTo', sel: `#catList .cat-row::text(${OFFICIAL})`, block: 'center', ms: 450, cap: '내 과제 목록에 둘 다 들어왔습니다', n: 4 },
    { act: 'highlight', sel: `#catList .cat-row::text(${OFFICIAL})`, id: 'h7', label: '공식 과제', below: true, ms: 0 },
    { act: 'highlight', sel: `#catList .cat-row::text(${NEW_TASK})`, id: 'h8', label: '일반 과제', ms: 1700 },
    { act: 'unhighlight' },
    { act: 'click', sel: '#categoryModal .modal-foot [data-close]', cap: '과제 필터에도 바로 나옵니다', n: 4 },
    { act: 'waitFor', js: hidden('categoryModal'), post: 0 },
    { act: 'highlight', sel: `#filterbar .fchip::text(${NEW_TASK})`, id: 'h9', below: true, ms: 0 },
    { act: 'highlight', sel: `#filterbar .fchip::text(품질 관리)`, id: 'h10', below: true, ms: 1500 },
    { act: 'unhighlight' },

    // 5. 날짜와 일정
    { act: 'click', sel: `.cell[data-date="${env.day}"] .cell-top`, at: [0.5, 0.5], cap: `날짜를 고르고 오른쪽 패널의 추가를 누릅니다`, n: 5 },
    { act: 'click', sel: '#btnAddHere' },
    { act: 'waitFor', js: visible('quickAdd'), post: 200 },
    { act: 'type', sel: '#qaTitle', text: ENTRY, cap: '제목을 적고 방금 연결한 공식 과제를 고릅니다', n: 5 },
    { act: 'select', sel: '#qaCat', label: OFFICIAL },
    { act: 'js', js: `(() => { const c = document.getElementById('qaAllDay'); if (c.checked) c.click(); return 1; })()`, post: 80 },
    { act: 'select', sel: '#qaStartH', label: '14', cap: '시간을 정하고 추가를 누릅니다', n: 5, post: 120 },
    { act: 'select', sel: '#qaStartM', label: '00', post: 120 },
    { act: 'select', sel: '#qaEndH', label: '15', post: 120 },
    { act: 'select', sel: '#qaEndM', label: '00', post: 120 },
    { act: 'click', sel: '#qaSave' },
    { act: 'waitFor', js: hidden('quickAdd'), post: 200 },
    { act: 'highlight', sel: `#dpBody .card::text(${ENTRY})`, id: 'h11', label: '새 일정', ms: 0 },
    { act: 'highlight', sel: `.cell[data-date="${env.day}"] .chip::text(${ENTRY.slice(0, 6)})`, id: 'h12', ms: 1600 },
    { act: 'unhighlight' },

    // 6. 수정
    { act: 'click', sel: `#dpBody .card::text(${ENTRY}) >> [data-act=edit]`, cap: '수정은 카드의 수정을 누릅니다', n: 6 },
    { act: 'waitFor', js: visible('quickAdd'), post: 200 },
    { act: 'select', sel: '#qaEndH', label: '16', cap: '끝나는 시간을 16시로 바꿔 저장합니다', n: 6 },
    { act: 'click', sel: '#qaSave' },
    { act: 'waitFor', js: hidden('quickAdd'), post: 200 },
    { act: 'highlight', sel: `#dpBody .card::text(${ENTRY})`, id: 'h13', ms: 1300 },

    // 7. 할 일
    { act: 'click', sel: '#dptab-todo', cap: '할 일 탭에서 할 일을 추가합니다', n: 7 },
    { act: 'click', sel: '#btnTodoNew' },
    { act: 'waitFor', js: visible('quickAdd'), post: 200 },
    { act: 'type', sel: '#qaTitle', text: TODO, cap: '할 일을 짧게 적고 과제를 고릅니다', n: 7 },
    { act: 'select', sel: '#qaCat', label: NEW_TASK },
    { act: 'click', sel: '#qaSave' },
    { act: 'waitFor', js: hidden('quickAdd'), post: 200 },
    { act: 'highlight', sel: `#dpBody .todo-row::text(${TODO})`, id: 'h14', label: '새 할 일', ms: 1400 },

    // 8, 9. 완료와 복원
    { act: 'click', sel: `#dpBody .todo-row::text(${TODO}) >> .todo-check`, cap: '체크하면 이 날 완료로 옮겨집니다', n: 8, post: 300 },
    { act: 'click', sel: '#dpBody .nd-sec[data-sec=done]', if: `document.querySelector('#dpBody .nd-sec[data-sec=done]')?.getAttribute('aria-expanded') === 'false'` },
    { act: 'highlight', sel: `#dpBody .todo-row::text(${TODO})`, id: 'h15', label: '완료', ms: 1300 },
    { act: 'click', sel: `#dpBody .todo-row::text(${TODO}) >> .todo-check`, cap: '다시 누르면 되돌아옵니다', n: 9, post: 300 },
    { act: 'highlight', sel: `#dpBody .todo-row::text(${TODO})`, id: 'h16', ms: 1300 },

    { act: 'card', ms: 3200, cap: '', html: `<h1>정리</h1><p>1. 내 과제에서 공식 과제를 연결하거나 일반 과제를 만듭니다.<br>2. 날짜를 고르고 그 과제로 일정을 추가합니다.<br>3. 할 일을 추가하고 체크로 완료, 다시 체크로 되돌립니다.</p>` },
  ],
});
