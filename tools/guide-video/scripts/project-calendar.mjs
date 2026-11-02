// 과제 공용 일정 가이드(v5, 앱 0.25.0). 과제 탭, 참여자, 일정 등록(종일 체크, 매주 반복), 수정, 최근 변경, 날짜 목록(과제별 묶음),
//   개인 일정에 등록, 삭제(반복이면 이 날짜만). 첫 프레임(0초)은 제목 카드(openTitle).
//   만든 공용 일정은 cleanup 에서 반복 전체를 지우고, 개인에 복사한 사본도 지운다(뒤 영상에 남지 않게).
const TITLE = '고객사 요구사항 점검';
const COPY_TITLE = '주간 진행 점검';
const OFFICIAL = '(예시) 장비 개발';
const visible = id => `(() => { const m = document.getElementById('${id}'); return !!m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none'; })()`;
const hidden = id => `!${visible(id)}`;
const wipe = `(async () => {
  document.querySelectorAll('.overlay:not(.hidden) .x').forEach(b => b.click());
  document.getElementById('pcTabPersonal').click();
  const n = state.entries.length;
  state.entries = state.entries.filter(e => e.title !== ${JSON.stringify(COPY_TITLE)});
  if (state.entries.length !== n) save();
  document.getElementById('pcTabProject').click();
  try {
    await pcLoad();
    for (const e of (PCAL.events || []).filter(e => e.title === ${JSON.stringify(TITLE)} && !e.deleted)) {
      await pcReq('projectCalendarDelete', { projectUid: e.projectUid, eventUid: e.eventUid, expectedVersion: e.rowVersion, mutationUid: pcUuid() });
    }
    await pcLoad();
  } catch (_) {}
  renderAll(); return 1; })()`;

export default (env) => ({
  name: 'TaskCalendar_Guide_ProjectCalendar_v5',
  title: '수행과제 캘린더 사용 가이드: 과제 공용 일정',
  cursorStart: [1500, 520],
  tail: 400,
  openTitle: '<div class="kick">사용 영상</div><div class="name">과제 공용 일정</div><div class="tag">같은 과제 참여자가 함께 보는 일정입니다</div>',
  pace: { capHold: 280, pre: 70, post: 180, dwell: 90, typeMs: 30, typeJitter: 14, curMin: 350, curMax: 500, curBase: 330, curK: 0.12, ease: 'cubic-bezier(.22,.61,.36,1)', capMin: 1600, settle: 600 },
  prepare: [
    { js: wipe, ms: 2500 },
    { js: `(() => { document.getElementById('pcTabPersonal').click(); return 1; })()`, ms: 600 },
  ],
  cleanup: [
    { js: wipe, ms: 2500 },
    { js: `(() => { document.getElementById('pcTabPersonal').click(); return 1; })()`, ms: 400 },
  ],
  steps: [
    { act: 'titleOff', ms: 2000 },

    // 1. 과제 탭
    { act: 'click', sel: '#pcTabProject', cap: '공용 일정은 과제 탭에서 시작합니다', n: 1 },
    { act: 'waitFor', js: `!!document.querySelector('#pcView .pc-ev')`, post: 400 },
    { act: 'highlight', sel: '#pcView .pc-mbc', nth: 0, id: 'h1', label: '이 과제의 참여자 수', below: true, cap: '참여자 수를 누르면 명단이 나옵니다', n: 1, ms: 1200 },
    { act: 'click', sel: '#pcView .pc-mbc', nth: 0 },
    { act: 'waitFor', js: visible('pcMembersModal'), post: 1200 },
    { act: 'highlight', sel: '#pcmBox', id: 'h2', label: '같은 과제를 내 과제에 넣은 사람', below: true, cap: '이 사람들이 같은 공용 일정을 보고 고칩니다', n: 1, ms: 2200 },
    { act: 'click', sel: '#pcMembersModal .x' },
    { act: 'waitFor', js: hidden('pcMembersModal'), post: 300 },

    // 2. 일정 등록
    { act: 'click', sel: '#pcNew', cap: '일정 등록을 누릅니다', n: 2 },
    { act: 'waitFor', js: visible('pcFormModal'), post: 300 },
    { act: 'type', sel: '#pcfTitle', text: TITLE, cap: '제목을 적고 저장할 과제를 고릅니다', n: 2 },
    { act: 'select', sel: '#pcfProj', label: OFFICIAL },
    { act: 'click', sel: '#pcfAllDay', cap: '종일에 체크하면 시각 칸이 없어집니다', n: 2 },
    { act: 'wait', ms: 900 },
    { act: 'waitFor', js: `document.getElementById('pcfAllDay').checked` },
    { act: 'click', sel: '#pcfAllDay', cap: '다시 풀고 시각을 정합니다', n: 2 },
    { act: 'waitFor', js: `!document.getElementById('pcfAllDay').checked`, post: 300 },
    { act: 'click', sel: '#pcfTimeRow .tf-btn', nth: 0 },
    { act: 'click', sel: '#pcfSTTfH14' },
    { act: 'click', sel: '#pcfSTTfM0' },
    { act: 'click', sel: '#pcfTimeRow .tf-btn', nth: 1 },
    { act: 'click', sel: '#pcfETTfH15' },
    { act: 'click', sel: '#pcfETTfM0' },
    { act: 'select', sel: '#pcfRecur', label: '매주', cap: '반복에서 매주를 고르면 같은 요일마다 생깁니다', n: 2 },
    { act: 'type', sel: '#pcfMemo', text: '요구사항 변경 내역을 함께 확인합니다', cap: '메모를 적고 저장합니다', n: 2 },
    { act: 'click', sel: '#pcfSave' },
    { act: 'waitFor', js: hidden('pcFormModal'), post: 600 },
    { act: 'highlight', sel: `#pcView .pc-ev::text(${TITLE})`, nth: 0, id: 'h3', label: '새 공용 일정(매주 반복)', below: true, cap: '저장하면 달력에 바로 들어갑니다', n: 2, ms: 2000 },

    // 3. 날짜 목록
    { act: 'click', sel: `#pcView .pc-ev::text(${TITLE})`, nth: 0, cap: '일정을 누르면 그 날짜 목록이 과제별로 묶여 나옵니다', n: 3 },
    { act: 'waitFor', js: `!!document.querySelector('#pcView .pc-dl-row')`, post: 600 },
    { act: 'highlight', sel: '#pcView .pc-dl-row', all: true, id: 'h4', ms: 2200 },

    // 4. 수정
    { act: 'click', sel: `#pcView .pc-dl-row::text(${TITLE})`, cap: '목록의 일정을 누르면 상세가 열립니다', n: 4 },
    { act: 'waitFor', js: visible('pcDetailModal'), post: 800 },
    { act: 'click', sel: '#pcDetailModal [data-act=edit]', cap: '내용을 바꿀 때는 수정을 누릅니다', n: 4 },
    { act: 'waitFor', js: visible('pcFormModal'), post: 500 },
    { act: 'click', sel: '#pcfTimeRow .tf-btn', nth: 1 },
    { act: 'click', sel: '#pcfETTfH16' },
    { act: 'click', sel: '#pcfETTfM0' },
    { act: 'click', sel: '#pcfSave', cap: '끝나는 시각을 16시로 바꿔 저장합니다', n: 4 },
    { act: 'wait', ms: 600 },
    { act: 'waitFor', js: `${hidden('pcFormModal')} || !!document.getElementById('cfOk') && ${visible('confirmModal')}`, post: 500 },
    { act: 'click', sel: '#cfOk', if: visible('confirmModal') },
    { act: 'waitFor', js: hidden('pcFormModal'), post: 800 },

    // 5. 최근 변경
    { act: 'click', sel: '#pcChanges', cap: '바뀐 내용은 최근 변경에서 확인합니다', n: 5 },
    { act: 'waitFor', js: visible('pcChangesModal'), post: 1500 },
    { act: 'highlight', sel: '#pccBody', id: 'h5', label: '누가 언제 무엇을 바꿨는지 남습니다', below: false, ms: 2600 },
    { act: 'click', sel: '#pcChangesModal .x' },
    { act: 'waitFor', js: hidden('pcChangesModal'), post: 400 },

    // 6. 개인 일정에 등록
    { act: 'click', sel: `#pcView .pc-ev[data-occ="2026-11-10"]`, cap: '내 달력에도 필요하면 개인 일정에 등록합니다', n: 6 },
    { act: 'waitFor', js: `!!document.querySelector('#pcView .pc-dl-row')`, post: 500 },
    { act: 'click', sel: `#pcView .pc-dl-row::text(${COPY_TITLE})` },
    { act: 'waitFor', js: visible('pcDetailModal'), post: 600 },
    { act: 'click', sel: '#pcDetailModal [data-act=copy]', cap: '개인 일정에 등록을 누릅니다', n: 6 },
    { act: 'wait', ms: 1500 },
    { act: 'click', sel: '#pcDetailModal .x' },
    { act: 'waitFor', js: hidden('pcDetailModal'), post: 300 },
    { act: 'click', sel: '#pcTabPersonal', cap: '개인 캘린더에 사본이 추가됐습니다', n: 6 },
    { act: 'js', js: `(() => { selectDate('2026-11-10'); document.getElementById('dptab-detail').click(); return 1; })()`, post: 500 },
    { act: 'highlight', sel: `#dpBody .card::text(${COPY_TITLE})`, id: 'h6', label: '들어온 사본', ms: 2200 },

    // 7. 삭제(반복이면 이 날짜만)
    { act: 'click', sel: '#pcTabProject', cap: '반복 일정은 이 날짜만 지울 수 있습니다', n: 7 },
    { act: 'waitFor', js: `!!document.querySelector('#pcView .pc-ev')`, post: 400 },
    { act: 'click', sel: `#pcView .pc-ev::text(${TITLE})`, nth: 0 },
    { act: 'waitFor', js: `!!document.querySelector('#pcView .pc-dl-row')`, post: 400 },
    { act: 'click', sel: `#pcView .pc-dl-row::text(${TITLE})` },
    { act: 'waitFor', js: visible('pcDetailModal'), post: 500 },
    { act: 'click', sel: '#pcDetailModal [data-act=delete]' },
    { act: 'waitFor', js: visible('confirmModal'), post: 900 },
    { act: 'highlight', sel: '#cfOk', id: 'h7', label: '이 날짜만 삭제', below: false, ms: 1800 },
    { act: 'click', sel: '#cfOk', cap: '이 날짜만 삭제를 누르면 다른 주 일정은 그대로입니다', n: 7 },
    { act: 'waitFor', js: hidden('confirmModal'), post: 1200 },
    { act: 'wait', ms: 1200 },
  ],
});
