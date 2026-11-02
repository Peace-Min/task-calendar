// 근태 보고 가이드(v5, 앱 0.25.0, 새 영상). 근태 탭 달력, 일간 근태 창(과제 블록 추가 체크 목록, 시간 숫자, 메모, 미리보기, 가져오기),
//   주간보고 목록과 편집(진행사항, 과제투입시간, 차주계획, 회의내용). 첫 프레임(0초)은 제목 카드(openTitle).
//   ★ 회사 사이트로 보내는 단추(일간 보고, 주간 보고, 인트라넷에서 확인, 회사 출처 가져오기)는 누르지 않는다. 가리키며 설명만 한다.
//     record.mjs 가 대본 검사(#atSend, #awSend, #atIntra 등)와 누르기 직전 검사로 이중으로 막는다.
//   근태 창은 별도 창(CDP 대상 win=attend)이라 toAttend 로 넘어가고 fromAttend 로 돌아온다.
//   쓰는 동안 생긴 임시 저장은 이 PC 저장소에 남으므로, 녹화 전 비우고 끝나면 record.mjs --restore-local 로 원래대로 되돌린다.
const visible = id => `(() => { const m = document.getElementById('${id}'); return !!m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none'; })()`;
const dropDrafts = `(() => { for (const k of Object.keys(localStorage)) if (/^tc_att(W)?Draft:/.test(k)) localStorage.removeItem(k); return 1; })()`;
const toDay = `(() => { document.querySelectorAll('.overlay:not(.hidden) .x').forEach(b => b.click()); document.getElementById('pcTabPersonal').click(); try { localStorage.setItem('tc_attKind', 'day'); localStorage.setItem('tc_attPanelTab', 'pv'); localStorage.setItem('tc_attWPanelTab', 'pv'); } catch (_) {} document.getElementById('pcTabAttend').click(); const d = document.querySelector('[data-atkind=day]'); if (d) d.click(); const t = document.querySelector('[data-atact=today]'); if (t) t.click(); return 1; })()`;

export default (env) => ({
  name: 'TaskCalendar_Guide_Attendance_v5',
  title: '수행과제 캘린더 사용 가이드: 근태 보고',
  cursorStart: [1500, 520],
  tail: 500,
  openTitle: '<div class="kick">사용 영상</div><div class="name">근태 보고</div><div class="tag">일간 근태와 주간보고를 작성합니다</div>',
  pace: { capHold: 280, pre: 70, post: 180, dwell: 90, typeMs: 30, typeJitter: 14, curMin: 350, curMax: 500, curBase: 330, curK: 0.12, ease: 'cubic-bezier(.22,.61,.36,1)', capMin: 1600, settle: 800 },
  prepare: [
    { js: dropDrafts, ms: 300 },
    { js: `(() => { document.querySelectorAll('.overlay:not(.hidden) .x').forEach(b => b.click()); document.getElementById('pcTabPersonal').click(); return 1; })()`, ms: 500 },
    { js: toDay, ms: 1200 },
  ],
  cleanup: [
    { js: dropDrafts, ms: 300 },
    { js: toDay, ms: 600 },
    { js: `(() => { document.getElementById('pcTabPersonal').click(); return 1; })()`, ms: 300 },
  ],
  steps: [
    { act: 'titleOff', ms: 2000 },

    // 1. 근태 탭 달력
    { act: 'click', sel: '#pcTabAttend', cap: '근태 탭에서 달력으로 근태를 봅니다', n: 1 },
    { act: 'waitFor', js: `!!document.querySelector('#atMonth .at-day')`, post: 400 },
    { act: 'click', sel: '[data-atact=prev]', cap: '앱으로 보고한 날은 근태와 내용이 달력에 보입니다', n: 1 },
    { act: 'wait', ms: 500 },
    { act: 'highlight', sel: '#atMonth .at-day[data-date="2026-10-13"]', id: 'h1', label: '야근과 초과시간이 달력에 표시됩니다', below: true, ms: 2400 },
    { act: 'highlight', sel: '#atMonth .at-day[data-date="2026-10-22"]', id: 'h2', label: '휴가도 근태로 보입니다', below: true, ms: 1900 },

    // 2. 일간 근태 창
    { act: 'click', sel: '[data-atact=today]', cap: '오늘로 돌아와 날짜를 누르면 근태 창이 열립니다', n: 2 },
    { act: 'wait', ms: 500 },
    { act: 'click', sel: `#atMonth .at-day[data-date="${env.today}"]`, post: 300 },
    { act: 'toAttend', settle: 900 },

    { act: 'highlight', sel: '#atStatus', id: 'h3', label: '근태', below: true, cap: '근태와 초과시간을 고릅니다', n: 3, ms: 0 },
    { act: 'highlight', sel: '#atOt', id: 'h4', label: '초과시간', below: true, ms: 1800 },
    { act: 'unhighlight' },
    { act: 'click', sel: '#atReset', cap: '처음부터 쓰려면 전체 초기화를 누릅니다', n: 3 },
    { act: 'wait', ms: 600 },

    // 3. 과제 블록 추가 체크 목록
    { act: 'click', sel: '#atAdd', cap: '과제 추가의 체크 목록에서 오늘 쓸 과제를 고릅니다', n: 4 },
    { act: 'wait', ms: 500 },
    { act: 'click', sel: '.aw-mi[data-addname="(예시) 장비 개발"]' },
    { act: 'click', sel: '.aw-mi[data-addname="(예시) 그룹웨어 개선"]' },
    { act: 'wait', ms: 600 },
    { act: 'click', sel: '#atAddDone', cap: '체크한 과제가 블록으로 들어옵니다', n: 4 },
    { act: 'wait', ms: 500 },

    // 4. 시간, 내용, 메모
    { act: 'type', sel: '#atBlocks .at-blk[data-bi="0"] .at-bhn', text: '5', replace: true, cap: '블록마다 시간을 숫자로 적고 내용을 씁니다', n: 5, commit: true },
    { act: 'type', sel: '#atBlocks textarea[data-bt="0"]', text: '- 요구사항 검토\n- 화면 시안 확인' },
    { act: 'type', sel: '#atBlocks .at-blk[data-bi="1"] .at-bhn', text: '3', replace: true, commit: true },
    { act: 'type', sel: '#atBlocks textarea[data-bt="1"]', text: '- 설계 문서 작성' },
    { act: 'type', sel: '#atBlocks textarea[data-memo]', text: '* 오후 고객 회의 참석', cap: '과제와 상관없는 내용은 자유 메모에 적습니다', n: 5 },
    { act: 'wait', ms: 800 },
    { act: 'highlight', sel: '#atHours', id: 'h5', label: '시간 합계', below: false, ms: 1600 },

    // 5. 미리보기와 가져오기
    { act: 'highlight', sel: '#atPreview', id: 'h6', label: '인트라넷에 들어갈 모양 그대로(읽기만)', below: true, cap: '오른쪽 미리보기는 인트라넷 폼에 들어갈 모양입니다', n: 6, ms: 2800 },
    { act: 'click', sel: '[data-attab=imp]', cap: '가져오기에서 캘린더나 이전 보고의 내용을 불러올 수 있습니다', n: 6 },
    { act: 'wait', ms: 600 },
    { act: 'highlight', sel: '#atImp', id: 'h7', label: '캘린더 또는 이전 보고에서 가져오기', below: true, ms: 2400 },
    { act: 'click', sel: '[data-attab=pv]' },
    { act: 'wait', ms: 500 },

    // 6. 회사로 보내는 단추(누르지 않는다)
    { act: 'highlight', sel: '#atSend', id: 'h8', label: '회사 사이트로 보내는 단추', below: false, cap: '보고 단추는 회사 사이트로 보내므로 이 영상에서는 누르지 않습니다', n: 7, ms: 2800 },
    { act: 'move', sel: '#atClose' },
    { act: 'click', sel: '#atClose', cap: '닫으면 쓰던 내용은 임시 저장됩니다', n: 7, post: 500 },
    { act: 'fromAttend' },

    // 7. 주간보고 목록
    { act: 'click', sel: '[data-atkind=week]', cap: '주간을 고르면 주간보고 목록이 나옵니다', n: 8 },
    { act: 'waitFor', js: `!!document.querySelector('#awList .aw-row')`, post: 500 },
    { act: 'highlight', sel: '#awList', id: 'h9', label: '번호, 제목, 기간, 상태', below: true, ms: 2400 },
    { act: 'click', sel: '#awList .aw-row[data-awmon="2026-10-19"]', cap: '주를 누르면 주간보고 편집이 열립니다', n: 8 },
    { act: 'toAttend', settle: 900 },

    // 8. 주간보고 편집
    { act: 'highlight', sel: '#awProg', id: 'h10', label: '진행사항', below: false, cap: '진행사항을 글로 씁니다', n: 9, ms: 2200 },
    { act: 'highlight', sel: '#awHours', id: 'h11', label: '과제투입시간', below: true, cap: '과제투입시간은 과제별 시간 숫자입니다', n: 9, ms: 2400 },
    { act: 'highlight', sel: '#awPlan', id: 'h12', label: '차주계획', below: false, cap: '차주계획을 씁니다', n: 9, ms: 2000 },
    { act: 'caret', sel: '#awMeet', cap: '회의내용도 적습니다', n: 9 },
    { act: 'type', sel: '#awMeet', text: '\n- 다음 주 회의 일정 확인', noClick: true },
    { act: 'highlight', sel: '#awMeet', id: 'h13', label: '회의내용', below: false, ms: 1800 },
    { act: 'highlight', sel: '#awPv', id: 'h14', label: '인트라넷 주간보고 폼 모양', below: true, cap: '오른쪽 미리보기에 바로 반영됩니다', n: 9, ms: 2600 },
    { act: 'click', sel: '[data-awtab=imp]', cap: '가져오기로 이번 주 일간 보고나 지난주 차주계획을 불러옵니다', n: 9 },
    { act: 'wait', ms: 500 },
    { act: 'highlight', sel: '#awImpDaily', id: 'h15', below: true, ms: 0 },
    { act: 'highlight', sel: '#awImpPlan', id: 'h16', below: true, ms: 2200 },
    { act: 'unhighlight' },
    { act: 'highlight', sel: '#awSend', id: 'h17', label: '회사 주간 폼을 채우는 단추', below: false, cap: '주간 보고 단추도 회사 사이트로 가므로 누르지 않습니다', n: 9, ms: 2600 },
    { act: 'move', sel: '#awClose' },
    { act: 'click', sel: '#awClose', post: 500 },
    { act: 'fromAttend' },
    { act: 'click', sel: '[data-atkind=day]', cap: '일간과 주간은 근태 탭 위쪽에서 바꿉니다', n: 10 },
    { act: 'wait', ms: 1600 },
  ],
});
