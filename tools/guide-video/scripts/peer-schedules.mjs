// 다른 사람 일정 보기 가이드(v3). 0.22.0 의 독립 창(PeerWindow) 기준. 내용은 v2 와 같고 속도만 빠르게 했다.
//   열람 창 안 달력은 iframe 이라 선택자 앞에 'frame:' 을 붙인다. 창 틀 단추(최대화, 이전 크기로, 닫기)는 act:'os'.
const PEER = { login: 'kimcs', name: '김철수' };
const visible = id => `(() => { const m = document.getElementById('${id}'); return !!m && m.offsetParent !== null; })()`;

export default (env) => ({
  name: 'TaskCalendar_Guide_PeerSchedules_v3',
  title: '수행과제 캘린더 사용 가이드: 다른 사람 일정 보기',
  cursorStart: [1100, 520],
  closePeerAfter: true,
  resetPeer: PEER.login,
  tail: 300,
  pace: { capHold: 520, pre: 110, post: 320, dwell: 90, typeMs: 40, typeJitter: 14, curMin: 350, curMax: 500, curBase: 330, curK: 0.12, ease: 'cubic-bezier(.22,.61,.36,1)', capMin: 1600, settle: 600 },
  prepare: [
    { js: `(() => { document.querySelectorAll('.overlay:not(.hidden) .x').forEach(b => b.click()); return 1; })()`, ms: 550 },
    // 열람 창의 보기 설정을 처음 쓰는 사람의 기본값으로(겹쳐 보기, 내 일정 켬, 고정). 끝나면 --restore-local 이 되돌린다.
    { js: `(() => { localStorage.setItem('tc_peerLayout', 'overlay'); localStorage.setItem('tc_peerOverlay', '1'); localStorage.setItem('tc_peerDensity', 'fixed'); return 1; })()` },
    { js: `(() => { document.getElementById('btnToday').click(); selectDate(${JSON.stringify(env.today)}); document.getElementById('dptab-detail').click(); return 1; })()`, ms: 800 },
  ],
  steps: [
    { act: 'card', ms: 3100, html: `<h1>다른 사람 일정 보기</h1><p>같은 팀 동료의 일정을 따로 뜨는 창에서 읽기 전용으로 봅니다.</p>` },

    { act: 'click', sel: '#btnPeerPick', cap: '툴바의 다른 사람 일정을 누릅니다', n: 1 },
    { act: 'waitFor', js: visible('pkSearch'), post: 200 },
    { act: 'highlight', sel: '#pkBody [data-sec=Mine]', label: '내 부서 사람이 먼저 보입니다', below: false, ms: 2050 },
    { act: 'type', sel: '#pkSearch', text: '김철', cap: '이름, 직급, 조직으로 찾을 수 있습니다', n: 2 },
    { act: 'highlight', sel: `#pkBody [data-act=open][data-login=${PEER.login}]`, ms: 1350, pre: 300 },
    { act: 'click', sel: `#pkBody [data-act=open][data-login=${PEER.login}]`, cap: '사람을 누르면 별도 창이 열립니다', n: 3 },
    { act: 'toPeer' },

    { act: 'caption', cap: `${PEER.name} 님의 일정을 읽기 전용으로 봅니다`, n: 3, ms: 950 },
    { act: 'highlight', sel: '#pvSwitch', label: '다른 사람으로 바꾸기', ms: 1750 },

    { act: 'highlight', sel: 'frame:.seg-b::text(겹쳐 보기)', id: 'p1', label: '겹쳐 보기', ms: 0, cap: '겹쳐 보기: 내 일정이 함께 보입니다', n: 4 },
    { act: 'highlight', sel: 'frame:#peerOverlayToggle', id: 'p2', label: '내 일정', ms: 2050 },
    { act: 'unhighlight' },
    { act: 'click', sel: `frame:.cell[data-date="${env.today}"] .cell-top`, cap: '날짜를 누르면 두 사람 일정이 나뉘어 보입니다', n: 4 },
    { act: 'highlight', sel: 'frame:#dayPanel', id: 'p3', ms: 2450 },

    { act: 'click', sel: 'frame:.seg-b::text(나란히 보기)', cap: '나란히 보기: 두 달력을 옆에 놓습니다', n: 5 },
    { act: 'wait', ms: 2300 },
    { act: 'click', sel: 'frame:.seg-b::text(겹쳐 보기)', cap: '다시 겹쳐 보기로 돌아옵니다', n: 5 },
    { act: 'wait', ms: 400 },

    { act: 'click', sel: 'frame:input[value=expand]', cap: '밀도를 펼침으로 하면 모든 일정이 보입니다', n: 6 },
    { act: 'wait', ms: 1200 },
    { act: 'wheel', sel: `frame:.cell[data-date="${env.today}"]`, dy: 120, times: 6, every: 130, cap: '넘치면 달력을 스크롤해서 봅니다', n: 6 },
    { act: 'wait', ms: 400 },
    { act: 'wheel', sel: `frame:#grid`, at: [0.5, 0.5], dy: -120, times: 8, every: 80 },

    { act: 'click', sel: '#pvFav', cap: '☆ 를 누르면 즐겨찾기에 남습니다', n: 7 },
    { act: 'highlight', sel: '#pvFav', ms: 1500 },

    { act: 'os', op: 'maximize', btn: 'max', cap: '창 오른쪽 위 단추로 최대화합니다', n: 8 },
    { act: 'wait', ms: 1750 },
    { act: 'os', op: 'restore', btn: 'max', cap: '다시 누르면 이전 크기로 돌아갑니다', n: 8 },
    { act: 'wait', ms: 950 },
    { act: 'os', op: 'maximize', btn: 'max', cap: '최대화한 채로 닫아 보겠습니다', n: 9 },
    { act: 'wait', ms: 400 },
    { act: 'os', op: 'close', btn: 'close' },

    { act: 'click', sel: '#btnPeerPick', cap: '다시 열 때는 즐겨찾기에서 고릅니다', n: 10 },
    { act: 'waitFor', js: visible('pkSearch'), post: 200 },
    { act: 'highlight', sel: '#pkBody [data-sec=Fav]', label: '★ 즐겨찾기', below: false, ms: 1600 },
    { act: 'click', sel: `#pkBody [data-sec=Fav] [data-act=open][data-login=${PEER.login}]` },
    { act: 'toPeer' },
    { act: 'caption', cap: '닫을 때의 크기 그대로 열립니다', n: 10, ms: 1900 },
    { act: 'os', op: 'restore', btn: 'max' },
    { act: 'caption', cap: '이전 크기와 자리도 기억합니다', n: 10, ms: 1350 },
    { act: 'card', ms: 4300, cap: '', html: `<h1>정리</h1><p>1. 툴바의 다른 사람 일정에서 사람을 찾습니다.<br>2. 별도 창에서 겹쳐 보기, 나란히 보기, 밀도를 바꿔 봅니다.<br>3. ☆ 즐겨찾기로 다시 찾고, 창 크기는 기억됩니다.</p>` },
  ],
});
