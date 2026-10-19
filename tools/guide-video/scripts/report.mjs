// 보고서 작성 가이드(v3, 새 영상). 캘린더 기록으로 일간보고를 만들고 고쳐서 복사하고, 주간 작성 폼에 차주계획을 적는 데서 멈춘다.
//   화면 이름은 docs/wiki/보고서-글-편집.md, docs/wiki/보고서-회사-전송.md, docs/REPORT-EDIT.md, docs/WEEKLY-EDIT.md, docs/REPORT-GROUP.md 를 따른다.
//   ★ 회사 사이트로 가는 단추(일간보고 전송, 주간보고 작성)와 netcus 출처는 누르지 않는다. 녹화기가 대본 검사와 누르기 직전 검사로 막는다.
//     자막과 강조(highlight)로 그 단추를 가리키기만 한다.
//   이 영상이 남기는 것: 10월 14일 과제 시간(장비 개발 5, 자료 정리 3, 캘린더 데이터), 일간과 주간 임시 저장(브라우저 저장소, --restore-local 이 지운다).
const DAY = '2026-10-14';          // 기록이 있는 지난 평일(장비 개발 2건, 자료 정리 1건)
const WFROM = '2026-10-12', WTO = '2026-10-18';
const EQUIP = '(예시) 장비 개발';
const DOCS = '자료 정리';

const visible = id => `(() => { const m = document.getElementById('${id}'); return !!m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none'; })()`;
const blur = { act: 'js', js: `(() => { document.activeElement && document.activeElement.blur(); return 1; })()`, post: 120 };
const card = name => `#rptOut .rcard::text(${name})`;

export default (env) => ({
  name: 'TaskCalendar_Guide_Report_v3',
  title: '수행과제 캘린더 사용 가이드: 보고서 작성',
  cursorStart: [1180, 560],
  tail: 300,
  pace: { capHold: 650, pre: 110, post: 330, dwell: 100, typeMs: 34, typeJitter: 14, curMin: 350, curMax: 500, curBase: 330, curK: 0.12, ease: 'cubic-bezier(.22,.61,.36,1)', capMin: 1700, settle: 600 },
  // 녹화 전 정리(화면에 안 나옴): 지난 시도의 임시 저장과 시간을 데모 값으로 되돌리고, 보기와 출처를 처음 상태로.
  prepare: [
    { js: `(() => { document.querySelectorAll('.overlay:not(.hidden) .x, .overlay:not(.hidden) [data-close]').forEach(b => b.click()); return 1; })()`, ms: 500 },
    { js: `(() => {
        rptDraftPut(${JSON.stringify(DAY)}, rptDraftEmpty(${JSON.stringify(DAY)}), true);
        rptWDraftPut(${JSON.stringify(WFROM)}, ${JSON.stringify(WTO)}, rptWEmpty(${JSON.stringify(WFROM)}, ${JSON.stringify(WTO)}), true);
        try { localStorage.removeItem(rptDraftKey(${JSON.stringify(DAY)})); localStorage.removeItem(rptWKey(${JSON.stringify(WFROM)}, ${JSON.stringify(WTO)})); } catch (_) {}
        const id = n => (state.categories.find(c => c.name === n) || {}).id;
        setTaskHours(${JSON.stringify(DAY)}, id(${JSON.stringify(EQUIP)}), 4); setTaskHours(${JSON.stringify(DAY)}, id(${JSON.stringify(DOCS)}), 4);
        rptView = 'card'; rptViewW = 'doc'; state.reportSource = 'cal';
        return 1; })()`, ms: 600 },
    { js: `(() => { document.documentElement.style.setProperty('--dpw', '460px'); filterCatId = null; renderAll(); document.getElementById('btnToday').click(); selectDate(${JSON.stringify(env.today)}); document.getElementById('dptab-detail').click(); return 1; })()`, ms: 700 },
  ],
  cleanup: [
    { js: `(() => { document.querySelectorAll('.overlay:not(.hidden) .x, .overlay:not(.hidden) [data-close]').forEach(b => b.click()); return 1; })()`, ms: 400 },
    { js: `(() => { const v = parseInt(localStorage.getItem('taskCalendar.panelW')); if (v > 0) document.documentElement.style.setProperty('--dpw', v + 'px'); else document.documentElement.style.removeProperty('--dpw'); return 1; })()` },
  ],
  steps: [
    { act: 'card', ms: 3600, html: `<h1>보고서 작성</h1><p>캘린더에 남긴 기록으로 일간보고와 주간보고 초안을 만들고, 고쳐서 복사합니다.<br>이 영상에서는 회사 사이트로 보내지 않습니다.</p>` },

    // 1. 일간 작성 열기
    { act: 'click', sel: '#btnReportTop', cap: '툴바의 보고서를 엽니다', n: 1 },
    { act: 'waitFor', js: visible('reportModal'), post: 200 },
    { act: 'click', sel: '#reportModal [data-rmode=daily]', cap: '일간 작성 탭에서 날짜를 고릅니다', n: 1 },
    { act: 'setValue', sel: '#rptFrom', value: DAY },
    blur,

    // 2. 카드 보기
    { act: 'highlight', sel: '#rptOut .rcard', all: true, slice: [0, 8], id: 'r1', label: '그날 기록이 과제별 카드로 모입니다', below: false, ms: 0, cap: '기록이 있는 과제는 업무 줄이 자동으로 들어갑니다', n: 2 },
    { act: 'highlight', sel: `${card(EQUIP)}`, id: 'r2', ms: 2300 },
    { act: 'unhighlight' },
    { act: 'zoom', sel: '#reportModal .rpt-preview', scale: 1.3, ms: 700 },

    // 3. 시간 입력
    { act: 'type', sel: `${card(EQUIP)} >> .rcard-h-in`, replace: true, commit: true, text: '5', cap: '과제마다 시간 칸에 시간을 적습니다', n: 3, post: 350 },
    { act: 'type', sel: `${card(DOCS)} >> .rcard-h-in`, replace: true, commit: true, text: '3', post: 300 },
    blur,
    { act: 'highlight', sel: `${card(DOCS)} >> .rcard-h-in`, id: 'r3', label: '머리 줄의 시간이 됩니다', ms: 1550 },

    // 4. 이 보고서에서 빼기(×)와 되돌리기
    { act: 'click', sel: `${card(DOCS)} >> .rcard-x`, cap: '× 를 누르면 이 보고서에서만 빠집니다', n: 4, post: 400 },
    { act: 'highlight', sel: `${card(DOCS)}`, id: 'r4', label: '흐리게 남고 되돌릴 수 있습니다', below: true, ms: 2650 },
    { act: 'click', sel: `${card(DOCS)} >> .rcard-back`, cap: '되돌리기를 누르면 다시 들어갑니다', n: 4, post: 700 },

    // 5. 글 편집
    { act: 'click', sel: '#reportModal [data-rview=doc]', cap: '글 편집에서는 보낼 글을 문서처럼 고칩니다', n: 5, post: 400 },
    { act: 'highlight', sel: '#rptOut .rdoc-lock', id: 'r5', label: '머리 줄은 잠겨 있습니다(과제와 시간은 카드에서)', ms: 2400 },
    { act: 'caret', sel: `#rptOut .rdoc-ta[aria-label="${EQUIP} 내용"]`, after: '코드 리뷰', cap: '업무 줄을 고치고', n: 5 },
    { act: 'type', sel: `#rptOut .rdoc-ta[aria-label="${EQUIP} 내용"]`, noClick: true, text: '(로그인 화면)', post: 200 },
    { act: 'type', sel: `#rptOut .rdoc-ta[aria-label="${EQUIP} 내용"]`, noClick: true, text: '\n        - 암호화 모듈 확인', cap: '상세 줄을 자유롭게 더합니다', n: 5, post: 300 },
    blur,
    { act: 'highlight', sel: `#rptOut .rdoc-sec:has(.rdoc-ta[aria-label="${EQUIP} 내용"])`, id: 'r6', label: '고친 과제에는 초안으로가 생깁니다', below: true, ms: 2500 },

    // 6. 보고서 묶음: 자료 정리를 기타 아래로
    { act: 'zoom', reset: true, ms: 600 },
    { act: 'click', sel: '#rptGroupOpen', cap: '보고서 묶음의 설정을 엽니다', n: 6 },
    { act: 'waitFor', js: visible('rptGroupModal'), post: 200 },
    { act: 'zoom', sel: '#rptGroupModal .modal', scale: 1.4, ms: 700 },
    { act: 'click', sel: '#rgmRows [data-gmore]', cap: '기타는 내용 없는 과제 아래에 접혀 있습니다', n: 6, post: 400 },
    { act: 'drag', sel: `#rgmRows .rgm-row::text(${DOCS})`, at: [0.3, 0.5], to: '#rgmRows .rgm-row::text(기타)', toAt: [0.3, 0.5], ms: 1200, cap: '자료 정리를 끌어 기타 위에 놓습니다', n: 6, post: 500 },
    { act: 'highlight', sel: `#rgmRows .rgm-row.kid::text(${DOCS})`, id: 'r7', label: '이 보고서에서만 기타 안에 씁니다', below: true, ms: 2400 },
    { act: 'zoom', reset: true, ms: 500, post: 0 },
    { act: 'click', sel: '#rptGroupModal [data-close]', post: 300 },

    // 7. 결과 확인
    { act: 'highlight', sel: '#rptGroupSum', id: 'r8', label: '지금 묶음', ms: 0, cap: '미리보기에 묶음이 바로 반영됩니다', n: 7 },
    { act: 'highlight', sel: '#rptOut .rdoc-sec::text([기타])', id: 'r9', label: '시간도 기타에 더해집니다', ms: 3100 },
    { act: 'unhighlight' },

    // 8. 복사(전송 안 함)
    { act: 'click', sel: '#btnRptCopy', cap: '복사를 누르면 보낼 글이 클립보드에 담깁니다', n: 8, post: 1500 },
    { act: 'highlight', sel: '#btnRptSend', id: 'r10', label: '회사 시스템에 실제로 제출', ms: 2400, cap: '일간보고 전송은 실제 제출이라 이 영상에서는 누르지 않습니다', n: 8 },

    // 9. 주간 작성 폼
    { act: 'click', sel: '#reportModal [data-rmode=weekly]', cap: '주간 작성은 회사 주간보고 폼과 같은 모양입니다', n: 9, post: 400 },
    { act: 'setValue', sel: '#rptFrom', value: DAY },
    blur,
    { act: 'zoom', sel: '#reportModal .rpt-preview', scale: 1.25, ms: 700 },
    { act: 'highlight', sel: '#rptOut .rwf-val::text(기간에 따라 자동)', id: 'r11', label: '제목은 기간에 따라 자동, 고칠 수 없음', below: true, ms: 2400 },
    { act: 'highlight', sel: '#rptOut .rwf-val:has(.rdoc-ta[data-wsec])', id: 'r12', label: '진행사항: 머리 줄 아래를 고칩니다', below: false, ms: 2300, cap: '진행사항은 한 주의 기록으로 채워집니다', n: 9 },
    { act: 'scrollTo', sel: '#rptOut .rwd-hours', block: 'center', ms: 600, cap: '과제투입시간은 일간에 적은 시간의 합계입니다', n: 9 },
    { act: 'highlight', sel: '#rptOut .rwd-hours', id: 'r13', label: '읽기 전용', ms: 2500 },

    // 10. 차주계획
    { act: 'scrollTo', sel: `#rptOut .rdoc-ta[aria-label="${EQUIP} 차주계획"]`, block: 'center', ms: 600, cap: '차주계획은 과제마다 직접 적습니다', n: 10 },
    { act: 'caret', sel: `#rptOut .rdoc-ta[aria-label="${EQUIP} 차주계획"]` },
    { act: 'type', sel: `#rptOut .rdoc-ta[aria-label="${EQUIP} 차주계획"]`, noClick: true, text: '- 로그인 화면 시험 마무리', post: 300 },
    blur,
    { act: 'highlight', sel: `#rptOut .rdoc-sec:has(.rdoc-ta[aria-label="${EQUIP} 차주계획"])`, id: 'r14', ms: 1550 },
    { act: 'highlight', sel: '#rptOut .rwf-off', id: 'r15', label: '미처리사항 등은 회사 화면에서 씁니다', below: false, ms: 2150 },

    // 11. 여기서 멈춤
    { act: 'zoom', reset: true, ms: 600 },
    { act: 'highlight', sel: '#btnRptSend', id: 'r16', label: '회사 화면을 열어 채워 줍니다', ms: 3100, cap: '주간보고 작성은 회사 화면을 열어 주고, 제출은 그 화면에서 합니다', n: 11 },
    { act: 'card', ms: 4300, cap: '', html: `<h1>정리</h1><p>1. 일간 작성에서 날짜를 고르고 과제마다 시간을 적습니다.<br>2. 글 편집에서 업무 줄과 상세 줄을 고치고, × 와 보고서 묶음으로 정리합니다.<br>3. 복사해 쓰거나, 주간 작성에서 차주계획까지 적어 회사 화면으로 넘깁니다.</p>` },
  ],
});
