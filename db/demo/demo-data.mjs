// 사용 설명 영상(이슈 #13)용 데모 DB 의 정의. 손으로 고치는 곳은 이 파일 하나다.
// build-demo-sql.mjs 가 이 정의와 기준 날짜로 demo-load.sql 을 만든다(같은 입력이면 같은 SQL).
//
// 규칙(2026-10-19 사용자 결정, db/demo/README.md)
//   - 조직(org_unit)과 직급(title_code)은 지금 DB 그대로 둔다. 여기에 없다.
//   - 사람: 녹화 계정은 이름도 login_id 도 바꾸지 않는다(앱이 그 login_id 로 로그인돼 있고, 세션 파일에 실제 이름이 남아 있다).
//     나머지 사람은 아래 명단 순서대로 이름과 login_id 를 바꾼다. user_id, 소속, 직급, 권한, 재직 여부, 순서는 그대로다.
//     가상 이름이 녹화 계정의 지금 이름과 같으면 생성 SQL 이 아무것도 바꾸기 전에 멈춘다.
//   - 실존 인물, 유명인 이름을 쓰지 않는다. 생성 이름이 아래 AVOID_NAMES 에 걸리면 건너뛴다.
//   - 공식 과제와 발주처 이름은 모두 '(예시)' 로 시작한다. 시험(tests/demo-db.test.mjs)이 이것을 확인한다.
//   - 일정 장소 같은 고유 명칭도 '(예시)' 로 시작한다.

export const PREFIX = '(예시)';

// 녹화 계정 다음으로 이름을 받는 사람. 앞의 셋이 일정 데이터를 받는 동료다(DEMO_PEOPLE 의 c1, c2, c3).
export const FIXED_PEOPLE = [
  { name: '김철수', login: 'kimcs' },
  { name: '이영희', login: 'leeyh' },
  { name: '박민수', login: 'parkms' },
  { name: '최지은', login: 'choije' },
];

// 나머지 사람의 이름 재료. 성 순서와 이름 순서를 엮어 결정적으로 만든다(build-demo-sql.mjs 의 peopleNames).
export const SURNAMES = [
  ['김', 'kim'], ['이', 'lee'], ['박', 'park'], ['최', 'choi'], ['정', 'jung'],
  ['강', 'kang'], ['조', 'cho'], ['윤', 'yoon'], ['장', 'jang'], ['임', 'lim'],
  ['한', 'han'], ['오', 'oh'], ['서', 'seo'], ['신', 'shin'], ['권', 'kwon'],
  ['황', 'hwang'], ['안', 'ahn'], ['송', 'song'], ['류', 'ryu'], ['전', 'jeon'],
  ['홍', 'hong'], ['고', 'ko'], ['문', 'moon'], ['양', 'yang'], ['손', 'son'],
  ['배', 'bae'], ['백', 'baek'], ['허', 'heo'], ['노', 'noh'], ['남', 'nam'],
];
export const GIVEN_NAMES = [
  ['도윤', 'dy'], ['하준', 'hj'], ['서윤', 'sy'], ['하은', 'he'], ['예린', 'yr'],
  ['시우', 'sw'], ['채원', 'cw'], ['윤서', 'ys'], ['가온', 'go'], ['다인', 'di'],
  ['하람', 'hr'], ['소율', 'sl'], ['태윤', 'ty'], ['나래', 'nr'], ['한결', 'hk'],
  ['다솜', 'ds'], ['재원', 'jw'], ['수아', 'sa'], ['유준', 'yj'], ['예준', 'ye'],
  ['지유', 'jy'], ['승현', 'sh'], ['민재', 'mj'], ['아린', 'ar'],
];
// 생성 이름에서 빼는 이름(실존 유명인과 겹칠 만한 조합). 고정 명단의 이름도 생성에서 빠진다.
export const AVOID_NAMES = [
  '이순신', '김연아', '박지성', '손흥민', '이민호', '김수현', '송강호', '정우성', '전지현', '김태희',
  '이지은', '박서준', '김지원', '한지민', '박보검', '송중기', '이도현', '김고은', '정해인', '안유진',
];

// 발주처. customer_id 는 이 순서대로 1 부터 붙는다.
export const CUSTOMERS = [
  '(예시) 가나테크',
  '(예시) 다라솔루션',
  '(예시) 마바산업',
  '(예시) 사아정보',
  '(예시) 자차물산',
];

// 공식 과제(project). id 는 이 순서대로 1 부터 붙는다. uid 는 key 에서 결정적으로 만든다.
//   section: 1 일반계약, 2 선진행, 3 사업부관리 / status: 1 진행중, 2 종료, 3 1차 납품완료, 4 미정(고정 번호)
//   start/end/devEnd: 기준 날짜의 달에서 몇 달 떨어진 달인가(start 는 그 달 1일, end 와 devEnd 는 그 달 말일). null 이면 비운다.
//   color: 과제 색(사용자 소유. 이 과제를 내 과제로 고른 사람 모두에게 같은 색을 준다)
export const PROJECTS = [
  { key: 'equip',   common: '(예시) 장비 개발',             customer: 1, section: 1, status: 1, start: -8,  end: 4,    devEnd: 2,    color: '#3e5be0' },
  { key: 'gw',      common: '(예시) 그룹웨어 개선',         customer: 2, section: 1, status: 1, start: -5,  end: 3,    devEnd: 1,    color: '#e08a00' },
  { key: 'portal',  common: '(예시) 고객 포털 리뉴얼',      customer: 3, section: 1, status: 3, start: -10, end: 2,    devEnd: 0,    color: '#8a4fd0' },
  { key: 'docmig',  common: '(예시) 문서 관리 시스템 이전', customer: 4, section: 3, status: 1, start: -3,  end: 6,    devEnd: 4,    color: '#0d9488' },
  { key: 'mobile2', common: '(예시) 모바일 앱 2차 개발',    customer: 1, section: 2, status: null, start: null, end: null, devEnd: null, color: '#e0457b' },
  { key: 'backup',  common: '(예시) 데이터 백업 체계 구축', customer: 5, section: 1, status: 2, start: -12, end: -1,   devEnd: -2,   color: '#b05c2a' },
  { key: 'qms',     common: '(예시) 품질 관리 시스템 고도화', customer: 3, section: 1, status: 1, start: -2,  end: 9,    devEnd: 7,    color: '#0891b2' },
  { key: 'pilot',   common: '(예시) 신규 서비스 시범 운영', customer: 2, section: 3, status: 1, start: -1,  end: 5,    devEnd: 3,    color: '#6d28d9' },
];
// 사업명과 계약명은 통상명칭 뒤에 붙인다(모두 '(예시)' 로 시작한다). 선진행은 계약명을 비운다.
export const PROJECT_NAME_SUFFIX = ' 사업';
export const CONTRACT_NAME_SUFFIX = ' 용역 계약';

// 개인 과제. 휴가와 기타는 앱의 기본 과제다(docs/DEFAULT-TASKS.md: 이름이 정확히 '휴가', '기타' 인 개인 과제).
export const PERSONAL_TASKS = {
  meeting: { name: '주간 회의', color: '#0f9bb5', desc: '매주 열리는 팀 회의' },
  docs:    { name: '자료 정리', color: '#c43f8e', desc: '' },
  edu:     { name: '교육 수강', color: '#7a9a01', desc: '' },
  leave:   { name: '휴가',      color: '#2e9e6b', desc: '' },
  etc:     { name: '기타',      color: '#5b6b7d', desc: '' },
};

// 장소 빠른 선택(cal_room)과 일정 장소.
export const ROOMS = ['(예시) 3층 회의실', '(예시) 2층 소회의실', '(예시) 교육장', '(예시) 고객사 현장'];

// 공식 과제 일정 제목 묶음(과제와 무관하게 쓰는 일반 업무 이름).
export const PROJECT_TITLES = [
  '요구사항 검토', '설계 문서 작성', '화면 시안 검토', '단위 시험', '코드 리뷰', '배포 준비',
  '고객 회의', '진행 상황 점검', '데이터 이관 점검', '시험 결과 정리', '기능 개선 작업', '사용자 의견 정리',
];
// 개인 과제 일정 제목.
export const PERSONAL_TITLES = {
  docs: ['회의록 정리', '주간 보고 자료 준비', '공유 폴더 정리', '산출물 목록 정리'],
  edu:  ['사내 교육', '보안 교육 수강', '온라인 강의 수강'],
  etc:  ['부서 행사 준비', '장비 점검', '사무용품 신청'],
};
export const ENTRY_MEMOS = ['(예시) 회의 자료는 공유 폴더에 있습니다.', '(예시) 다음 주까지 결과 공유', ''];

// 할 일 문구.
export const TODO_TEXTS = [
  '회의록 공유하기', '시험 계획서 검토', '고객 질의 회신', '산출물 목록 갱신', '교육 신청서 제출',
  '배포 체크리스트 확인', '주간 보고 초안 작성', '장비 반납 확인', '요구사항 변경 내역 정리', '다음 달 일정 공유',
];

// 일정 데이터를 받는 사람. who: me = 녹화 계정, c1 ~ c3 = FIXED_PEOPLE 의 앞 셋.
//   projects: 이 사람의 공식 과제(PROJECTS 의 key, 순서대로 내 과제 목록 맨 앞)
//   personal: 개인 과제(PERSONAL_TASKS 의 key). 휴가와 기타는 늘 맨 뒤에 붙는다.
//   meetingDay: 주간 회의 반복 요일(1 월요일 ... 5 금요일). 회의실은 ROOMS 의 첫째.
//   seed: 일정 배치용 결정적 난수의 씨앗
export const DEMO_PEOPLE = [
  { who: 'me', projects: ['equip', 'gw', 'portal'],  personal: ['meeting', 'docs', 'edu'], meetingDay: 1, seed: 1301 },
  { who: 'c1', projects: ['equip', 'docmig', 'qms'], personal: ['meeting', 'docs'],        meetingDay: 1, seed: 1302 },
  { who: 'c2', projects: ['gw', 'portal', 'pilot'],  personal: ['meeting', 'edu'],         meetingDay: 2, seed: 1303 },
  { who: 'c3', projects: ['equip', 'mobile2', 'backup'], personal: ['docs', 'edu'],        meetingDay: 3, seed: 1304 },
];
