// Layer 2 — 실제 앱을 jsdom에 부팅해 전역 함수(toXML/fromXML/collectReportData/expandOccurrences)를
// 그대로 호출·검증한다. 이 함수들은 페이지 전역 스코프의 bare global이라 window.eval로 직접 도달 가능.
// jsdom 미설치 시(폐쇄망 로컬 등) graceful-skip — 러너는 Layer 1만으로도 green. CI는 jsdom을 설치해 여기까지 돈다.
import { test, assert, loadAppSource } from './harness.mjs';

// ── jsdom 로드(없으면 생략) ─────────────────────────────────────────────
let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch (_) { /* 미설치 */ }

if (!JSDOM) {
  test('app-context: jsdom 미설치 — app-context 테스트 생략', () => {
    console.log('      jsdom 미설치 — app-context 테스트 생략');
  });
} else {
  // ── 앱 부팅(1회) — HOST=false(webview 없음) → BrowserPlatform 경로. beforeParse로 최소 shim만 주입. ──
  let dom, w, bootErr = null;
  try {
    dom = new JSDOM(loadAppSource(), {
      runScripts: 'dangerously',
      pretendToBeVisual: true,   // requestAnimationFrame/cancelAnimationFrame 제공
      url: 'https://tcapp.local/',
      beforeParse(window) {
        // crypto.randomUUID가 없는 런타임 방어(uid()가 부팅 시드 생성에 사용). 있으면 건드리지 않음.
        if (typeof window.crypto === 'undefined') {
          window.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: a => a };
        }
        window.scrollTo = () => {};   // 일부 렌더 경로가 호출 — jsdom 미구현 경고 억제
      },
    });
    w = dom.window;
  } catch (e) {
    bootErr = e;
  }

  if (bootErr) {
    test('app-context: jsdom 부팅 실패(조사 필요)', () => {
      throw bootErr;   // 생략이 아니라 '실패'로 노출 — 부팅은 성공해야 정상
    });
  } else {
    // ── 헬퍼: 컨텍스트 안에서 JS 실행 ──────────────────────────────────
    const ev = (code) => w.eval(code);
    const evJSON = (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')'));
    // state를 통째로 갈아끼워 테스트 간 격리(순수 데이터라 JSON 왕복 안전)
    const seed = (stateObj) => { w.eval('state = ' + JSON.stringify(stateObj) + ';'); };
    // 엔트리 하나를 [from,to] 창으로 전개해 발생 시작일 배열 반환
    const occStarts = (entry, from, to) =>
      evJSON('expandOccurrences(' + JSON.stringify(entry) + ',' + JSON.stringify(from) + ',' + JSON.stringify(to) + ').map(function(o){return o._occStart;})');
    const occFull = (entry, from, to) =>
      evJSON('expandOccurrences(' + JSON.stringify(entry) + ',' + JSON.stringify(from) + ',' + JSON.stringify(to) + ')');

    const CA = '2026-07-01T00:00:00.000Z';   // 고정 타임스탬프(결정론)

    // 부팅 sanity — 전역 함수 도달 가능 + HOST=false
    test('app-context 부팅: HOST=false, 핵심 전역 함수 도달 가능', () => {
      assert.strictEqual(ev('HOST'), false);
      for (const fn of ['toXML', 'fromXML', 'collectReportData', 'expandOccurrences']) {
        assert.strictEqual(ev('typeof ' + fn), 'function', fn + ' 전역이어야 함');
      }
    });

    // ── toXML/fromXML ROUND-TRIP (데이터 안전 — 최고 가치) ────────────────
    // ≥2 과제(하나는 svn) + 다양한 엔트리(일정/공수/커밋/반복+예외/기간/장소/메모) + todos/rooms/authors
    const roundtripState = {
      gitAuthor: 'hong@corp.com',
      svnAuthor: 'phmin',
      categories: [
        { id: 'c-1', name: '보고서 작성', color: '#3e5be0', desc: '주간/월간 보고', gitRepo: '/repo/a', vcs: 'git', createdAt: CA },
        { id: 'c-2', name: '시스템 점검', color: '#2e9e6b', desc: '', gitRepo: 'C:/wc/b', vcs: 'svn', createdAt: CA },
      ],
      entries: [
        // 일반 일정(공수+장소+메모+시간)
        { id: 'e-1', date: '2026-07-08', title: '요구사항 정리', categoryId: 'c-1', allDay: false,
          startTime: '10:00', endTime: '11:30', location: '201호', memo: '명세 작성\n검색 포함',
          source: '', commits: [], hours: 150, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        // git 엔트리(구조화 커밋)
        { id: 'e-2', date: '2026-07-08', title: '작업일지', categoryId: 'c-2', allDay: false,
          startTime: '', endTime: '', location: '', memo: '',
          source: 'git', commits: [
            { hash: 'aaaaaaa111', short: 'aaaaaa1', time: '09:15', subject: '첫 커밋' },
            { hash: 'bbbbbbb222', short: 'bbbbbb2', time: '14:30', subject: '둘째 커밋' },
          ], hours: 120, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        // 반복(weekly, count) + 예외
        { id: 'e-3', date: '2026-07-06', title: '주간 회의', categoryId: 'c-1', allDay: true,
          startTime: '', endTime: '', location: '', memo: '',
          source: '', commits: [], hours: null,
          endDate: '', recur: { freq: 'weekly', interval: 1, until: '', count: 5 }, recurExcept: ['2026-07-13'], createdAt: CA, updatedAt: CA },
        // 기간(endDate) 엔트리(미분류 categoryId=null)
        { id: 'e-4', date: '2026-07-20', title: '출장', categoryId: null, allDay: true,
          startTime: '', endTime: '', location: '부산', memo: '',
          source: '', commits: [], hours: null, endDate: '2026-07-24', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
      ],
      todos: [
        { id: 't-1', text: 'API 명세 검토', done: false, categoryId: 'c-1', due: '2026-07-08', endDate: '', prio: 'high', completedAt: '', note: '세부 노트', createdAt: CA, updatedAt: CA },
        { id: 't-2', text: '점검 완료', done: true, categoryId: 'c-2', due: '2026-07-09', endDate: '2026-07-11', prio: 'normal', completedAt: '2026-07-11T09:00:00.000Z', note: '', createdAt: CA, updatedAt: CA },
      ],
      rooms: ['101호', '201호', '303호'],
    };

    test('roundtrip: 앱 자체 검증기(xmlRoundTrip) ok=true — 모든 의미 필드 무손실', () => {
      seed(roundtripState);
      const r = evJSON('xmlRoundTrip()');
      assert.strictEqual(r.ok, true, 'fromXML(toXML())가 state와 정규화 동일해야 함');
      assert.strictEqual(r.categories, 2);
      assert.strictEqual(r.entries, 4);
    });

    test('roundtrip: 독립 필드 검증 — 과제/엔트리/커밋/반복/기간/공수/장소', () => {
      seed(roundtripState);
      const p = evJSON('fromXML(toXML())');
      // 과제
      assert.strictEqual(p.categories.length, 2);
      assert.deepStrictEqual(p.categories.map(c => c.name), ['보고서 작성', '시스템 점검']);
      assert.strictEqual(p.categories[0].vcs, 'git');
      assert.strictEqual(p.categories[1].vcs, 'svn');      // svn 보존
      assert.strictEqual(p.categories[0].gitRepo, '/repo/a');
      // authors
      assert.strictEqual(p.gitAuthor, 'hong@corp.com');
      assert.strictEqual(p.svnAuthor, 'phmin');
      // 엔트리 수
      assert.strictEqual(p.entries.length, 4);
      const byId = Object.fromEntries(p.entries.map(e => [e.id, e]));
      // e-1: 공수/장소/시간/메모
      assert.strictEqual(byId['e-1'].hours, 150);
      assert.strictEqual(byId['e-1'].location, '201호');
      assert.strictEqual(byId['e-1'].startTime, '10:00');
      assert.strictEqual(byId['e-1'].endTime, '11:30');
      assert.strictEqual(byId['e-1'].memo, '명세 작성\n검색 포함');
      assert.strictEqual(byId['e-1'].createdAt, CA);       // 타임스탬프도 왕복
      // e-2: git + 커밋 2건(hash/short/time/subject)
      assert.strictEqual(byId['e-2'].source, 'git');
      assert.strictEqual(byId['e-2'].commits.length, 2);
      assert.deepStrictEqual(byId['e-2'].commits.map(c => c.hash), ['aaaaaaa111', 'bbbbbbb222']);
      assert.deepStrictEqual(byId['e-2'].commits.map(c => c.subject), ['첫 커밋', '둘째 커밋']);
      assert.strictEqual(byId['e-2'].commits[0].time, '09:15');
      assert.strictEqual(byId['e-2'].commits[1].short, 'bbbbbb2');
      // e-3: 반복 + 예외
      assert.strictEqual(byId['e-3'].recur.freq, 'weekly');
      assert.strictEqual(byId['e-3'].recur.count, 5);
      assert.strictEqual(byId['e-3'].recur.interval, 1);
      assert.deepStrictEqual(byId['e-3'].recurExcept, ['2026-07-13']);
      // e-4: 기간 + 미분류
      assert.strictEqual(byId['e-4'].endDate, '2026-07-24');
      assert.strictEqual(byId['e-4'].categoryId, null);
      assert.strictEqual(byId['e-4'].location, '부산');
      // todos
      assert.strictEqual(p.todos.length, 2);
      const t2 = p.todos.find(t => t.id === 't-2');
      assert.strictEqual(t2.done, true);
      assert.strictEqual(t2.endDate, '2026-07-11');
      assert.strictEqual(t2.completedAt, '2026-07-11T09:00:00.000Z');
      const t1 = p.todos.find(t => t.id === 't-1');
      assert.strictEqual(t1.prio, 'high');
      assert.strictEqual(t1.note, '세부 노트');
      // rooms
      assert.deepStrictEqual(p.rooms, ['101호', '201호', '303호']);
    });

    // ── 하위호환: 미지 속성 무시 + 구버전(선택 속성 부재) 파싱 무손상 ─────────
    test('backward-compat: 미지 속성(seenVersion/foo) 있어도 throw 없이 파싱·무시', () => {
      seed(roundtripState);
      let xml = ev('toXML()');
      // 루트에 미지 속성 주입 + 첫 category에 미지 속성 주입
      xml = xml.replace('<taskCalendar ', '<taskCalendar seenVersion="0.3" ');
      xml = xml.replace('<category ', '<category foo="bar" ');
      let p;
      assert.doesNotThrow(() => { p = evJSON('fromXML(' + JSON.stringify(xml) + ')'); }, '미지 속성이 있어도 파싱 성공해야 함');
      assert.strictEqual(p.categories.length, 2);
      assert.strictEqual(p.entries.length, 4);
      // 미지 키는 결과에 존재하지 않음(그냥 무시)
      assert.ok(!('seenVersion' in p), '결과에 seenVersion 키 없어야 함');
      assert.ok(!('foo' in p.categories[0]), '결과 category에 foo 키 없어야 함');
    });

    test('backward-compat: 구버전 XML(hours/location/vcs/rooms/svnAuthor 부재) — 안전 기본값', () => {
      const DEF_ROOMS = evJSON('DEFAULT_ROOMS');   // 하드코딩 대신 컨텍스트에서 읽어 드리프트 방지
      const oldXml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<taskCalendar version="1" generator="old" seenVersion="0.3" gitAuthor="old@corp.com">' +
        '<categories>' +
        '<category id="c-old" color="#3e5be0" createdAt="2026-01-01T00:00:00.000Z" foo="bar">' +
        '<name>구버전 과제</name><description>설명</description></category>' +
        '</categories>' +
        '<entries>' +
        '<entry id="e-old" date="2026-07-08" categoryId="c-old" allDay="false" startTime="09:00" endTime="10:00" createdAt="2026-07-08T00:00:00.000Z" updatedAt="2026-07-08T00:00:00.000Z">' +
        '<title>구버전 일정</title><memo>메모</memo></entry>' +
        '</entries>' +
        '</taskCalendar>';
      let p;
      assert.doesNotThrow(() => { p = evJSON('fromXML(' + JSON.stringify(oldXml) + ')'); });
      // 과제: vcs 미기재 → 'git' 기본, 이름 보존, foo 무시
      assert.strictEqual(p.categories.length, 1);
      assert.strictEqual(p.categories[0].vcs, 'git');
      assert.strictEqual(p.categories[0].name, '구버전 과제');
      assert.ok(!('foo' in p.categories[0]));
      // 엔트리: hours 없음 → null, location 없음 → '', 기간/반복 없음
      assert.strictEqual(p.entries.length, 1);
      assert.strictEqual(p.entries[0].hours, null);
      assert.strictEqual(p.entries[0].location, '');
      assert.strictEqual(p.entries[0].source, '');
      assert.strictEqual(p.entries[0].endDate, '');
      assert.strictEqual(p.entries[0].recur, null);
      assert.deepStrictEqual(p.entries[0].recurExcept, []);
      // todos 없음 → [], rooms 요소 없음 → 기본값
      assert.deepStrictEqual(p.todos, []);
      assert.deepStrictEqual(p.rooms, DEF_ROOMS);
      // svnAuthor 속성 부재 → gitAuthor 복사(1회 마이그레이션)
      assert.strictEqual(p.gitAuthor, 'old@corp.com');
      assert.strictEqual(p.svnAuthor, 'old@corp.com');
    });

    // ── collectReportData (보고서 정확성 — 최고 가치) ─────────────────────
    const reportState = {
      gitAuthor: '', svnAuthor: '',
      categories: [
        { id: 'c-1', name: '보고서 작성', color: '#3e5be0', desc: '', gitRepo: '', vcs: 'git', createdAt: CA },
        { id: 'c-2', name: '시스템 점검', color: '#2e9e6b', desc: '', gitRepo: '', vcs: 'git', createdAt: CA },
      ],
      entries: [
        // git 엔트리(커밋 2건, 공수 120) — c-2
        { id: 'g1', date: '2026-07-08', title: '깃엔트리제목', categoryId: 'c-2', allDay: true, startTime: '', endTime: '',
          location: '', memo: '', source: 'git',
          commits: [{ hash: 'h1', short: 'h1', time: '09:00', subject: '커밋 A' }, { hash: 'h2', short: 'h2', time: '10:00', subject: '커밋 B' }],
          hours: 120, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        // 일정(비-git, 제목/공수 150) — c-1
        { id: 'v1', date: '2026-07-09', title: '요구사항 정리', categoryId: 'c-1', allDay: true, startTime: '', endTime: '',
          location: '', memo: '', source: '', commits: [], hours: 150, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        // 중복 제목 일정(공수 60) — dedup 확인 + 동명 공수 유실 방지
        { id: 'v2', date: '2026-07-10', title: '요구사항 정리', categoryId: 'c-1', allDay: true, startTime: '', endTime: '',
          location: '', memo: '', source: '', commits: [], hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        // 범위 밖 일정 — 제외 확인
        { id: 'v3', date: '2026-08-15', title: '범위밖', categoryId: 'c-1', allDay: true, startTime: '', endTime: '',
          location: '', memo: '', source: '', commits: [], hours: 90, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
      ],
      todos: [
        { id: 't1', text: '할일 인범위', done: false, categoryId: 'c-1', due: '2026-07-15', endDate: '', prio: 'normal', completedAt: '', note: '', createdAt: CA, updatedAt: CA },
        { id: 't2', text: '할일 범위밖', done: false, categoryId: 'c-1', due: '2026-08-20', endDate: '', prio: 'normal', completedAt: '', note: '', createdAt: CA, updatedAt: CA },
        { id: 't3', text: '기한없음', done: false, categoryId: 'c-1', due: '', endDate: '', prio: 'normal', completedAt: '', note: '', createdAt: CA, updatedAt: CA },
      ],
      rooms: [],
    };
    const collect = (from, to, src) => evJSON('collectReportData(' + JSON.stringify(from) + ',' + JSON.stringify(to) + ',' + JSON.stringify(src) + ')');
    const rowOf = (r, name) => r.rows.find(x => x.name === name);

    test('collectReportData: 전체 소스 — 제목/공수합/dedup/grandMin', () => {
      seed(reportState);
      const r = collect('2026-07-01', '2026-07-31', { event: true, todo: true, git: true });
      assert.strictEqual(r.rows.length, 2);   // 미분류 없음
      const c1 = rowOf(r, '보고서 작성'), c2 = rowOf(r, '시스템 점검');
      // c-1: v1+v2 공수 210, 제목 dedup('요구사항 정리' 1회) + 할일 제목
      assert.strictEqual(c1.minutes, 210);
      assert.ok(c1.titles.includes('요구사항 정리'));
      assert.ok(c1.titles.includes('할일 인범위'));
      assert.strictEqual(c1.titles.filter(t => t === '요구사항 정리').length, 1, 'dedup: 동일 제목 1회');
      assert.strictEqual(c1.titles.length, 2);
      // c-2: git 커밋 제목 전부(엔트리 제목 아님), 공수 120
      assert.deepStrictEqual(c2.titles, ['커밋 A', '커밋 B']);
      assert.ok(!c2.titles.includes('깃엔트리제목'), 'git은 엔트리 제목이 아니라 커밋 제목을 편입');
      assert.strictEqual(c2.minutes, 120);
      // grandMin = 210+120
      assert.strictEqual(r.grandMin, 330);
      // 범위 밖/기한없음 제외
      const all = r.rows.flatMap(x => x.titles);
      assert.ok(!all.includes('범위밖'));
      assert.ok(!all.includes('할일 범위밖'));
      assert.ok(!all.includes('기한없음'));
      assert.strictEqual(r.uninput, 0);   // 범위 내 엔트리 모두 공수 있음
    });

    test('collectReportData: 소스 토글 — git:false / event:false / todo:false', () => {
      seed(reportState);
      // git:false → c-2 git 커밋 빠짐(0/빈), c-1 유지
      let r = collect('2026-07-01', '2026-07-31', { event: true, todo: true, git: false });
      const c2 = rowOf(r, '시스템 점검');
      assert.strictEqual(c2.minutes, 0);
      assert.deepStrictEqual(c2.titles, []);
      assert.ok(!r.rows.flatMap(x => x.titles).includes('커밋 A'));
      assert.strictEqual(r.grandMin, 210);
      // event:false → 비-git 일정 빠짐(제목·공수), 할일은 유지, git 유지
      r = collect('2026-07-01', '2026-07-31', { event: false, todo: true, git: true });
      const c1 = rowOf(r, '보고서 작성');
      assert.ok(!c1.titles.includes('요구사항 정리'), 'event:false면 일정 제목 제외');
      assert.ok(c1.titles.includes('할일 인범위'), 'todo:true면 할일은 유지');
      assert.strictEqual(c1.minutes, 0, 'event:false면 일정 공수 미집계');
      assert.deepStrictEqual(rowOf(r, '시스템 점검').titles, ['커밋 A', '커밋 B']);
      assert.strictEqual(r.grandMin, 120);
      // todo:false → 할일 제외, 일정/git 유지
      r = collect('2026-07-01', '2026-07-31', { event: true, todo: false, git: true });
      assert.ok(!r.rows.flatMap(x => x.titles).includes('할일 인범위'), 'todo:false면 할일 제외');
      assert.ok(rowOf(r, '보고서 작성').titles.includes('요구사항 정리'));
    });

    test('collectReportData: 기간 필터 — 좁은 범위는 전부 제외(빈 결과, grandMin 0)', () => {
      seed(reportState);
      const r = collect('2026-07-01', '2026-07-05', { event: true, todo: true, git: true });
      for (const row of r.rows) {
        assert.strictEqual(row.minutes, 0);
        assert.deepStrictEqual(row.titles, []);
      }
      assert.strictEqual(r.grandMin, 0);
    });

    test('collectReportData: 기타 과제는 등록 순서와 무관하게 항상 마지막', () => {
      const withEtcFirst = JSON.parse(JSON.stringify(reportState));
      withEtcFirst.categories.unshift({ id: 'c-etc', name: '기타', color: '#5b6b7d', desc: '', gitRepo: '', vcs: 'git', createdAt: CA });
      seed(withEtcFirst);
      const r = collect('2026-07-01', '2026-07-31', { event: true, todo: true, git: true });
      assert.strictEqual(r.rows[r.rows.length - 1].name, '기타');
      assert.deepStrictEqual(r.rows.slice(0, -1).map(row => row.name), ['보고서 작성', '시스템 점검']);
    });

    // ── PART A: setCommitSubject / deleteCommitRow (커밋 데이터 단일 변경 경로 · 결정6) ──
    // 커밋 subject 쓰기·삭제는 이 두 API만 통과한다. 호출 시 notifyDataChanged가 패널/그리드를
    // 재렌더하므로 부팅된 jsdom 컨텍스트에서 실행(렌더 안전성도 함께 검증). state는 seed로 격리.
    const mutState = () => ({
      gitAuthor: '', svnAuthor: '',
      categories: [{ id: 'c-1', name: '시스템 점검', color: '#2e9e6b', desc: '', gitRepo: '', vcs: 'git', createdAt: CA }],
      entries: [
        { id: 'g1', date: '2026-07-08', title: '작업일지', categoryId: 'c-1', allDay: true, startTime: '', endTime: '',
          location: '', memo: '', source: 'git',
          commits: [{ hash: 'h1', short: 'h1', time: '09:00', subject: '첫 커밋' }, { hash: 'h2', short: 'h2', time: '10:00', subject: '둘째 커밋' }],
          hours: 120, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        // hash 없는(레거시) 커밋 — cidx로만 해석. 커밋 1개(삭제 시 엔트리 제거 확인용).
        { id: 'g2', date: '2026-07-08', title: '무해시', categoryId: 'c-1', allDay: true, startTime: '', endTime: '',
          location: '', memo: '', source: 'git',
          commits: [{ hash: '', short: '', time: '', subject: '해시없음' }],
          hours: null, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
      ],
      todos: [], rooms: [],
    });
    const commitSubjectOf = (eid, i) => evJSON(`entryById(${JSON.stringify(eid)}).commits[${i}].subject`);

    test('setCommitSubject: hash로 해석 → subject 변경·true, 공백 접기·updatedAt 갱신', () => {
      seed(mutState());
      assert.strictEqual(ev('setCommitSubject("g1","h1",0,"  고친   메시지  ")'), true);
      assert.strictEqual(commitSubjectOf('g1', 0), '고친 메시지');       // \s+ 접기 + 트림
      assert.notStrictEqual(evJSON('entryById("g1").updatedAt'), CA);    // updatedAt 갱신됨
      assert.strictEqual(commitSubjectOf('g1', 1), '둘째 커밋');          // 다른 커밋은 불변
    });
    test('setCommitSubject: cidx로 해석(hash 없는 레거시 커밋)', () => {
      seed(mutState());
      assert.strictEqual(ev('setCommitSubject("g2","",0,"해시없음 수정")'), true);
      assert.strictEqual(commitSubjectOf('g2', 0), '해시없음 수정');
    });
    test('setCommitSubject: 동일 텍스트 → false(무변경)', () => {
      seed(mutState());
      assert.strictEqual(ev('setCommitSubject("g1","h1",0,"첫 커밋")'), false);
      assert.strictEqual(commitSubjectOf('g1', 0), '첫 커밋');
    });
    test('setCommitSubject: 빈 값/공백만 → false(빈값 저장 안 함)', () => {
      seed(mutState());
      assert.strictEqual(ev('setCommitSubject("g1","h1",0,"   ")'), false);
      assert.strictEqual(ev('setCommitSubject("g1","h1",0,"")'), false);
      assert.strictEqual(commitSubjectOf('g1', 0), '첫 커밋');   // 원본 유지
    });
    test('setCommitSubject: 없는 엔트리/커밋 → false', () => {
      seed(mutState());
      assert.strictEqual(ev('setCommitSubject("nope","h1",0,"x")'), false);
      assert.strictEqual(ev('setCommitSubject("g1","zzz",5,"x")'), false);
    });

    test('deleteCommitRow: 커밋 제거(남은 커밋 유지)', () => {
      seed(mutState());
      ev('deleteCommitRow("g1","h1",0)');
      assert.deepStrictEqual(evJSON('entryById("g1").commits.map(function(c){return c.hash;})'), ['h2']);
    });
    test('deleteCommitRow: 마지막 커밋 삭제 → 엔트리 자체 제거(entryById null)', () => {
      seed(mutState());
      ev('deleteCommitRow("g2","",0)');   // 커밋 1개 → 삭제 시 git 기록(엔트리) 제거
      assert.strictEqual(ev('entryById("g2")'), null);
      assert.strictEqual(evJSON('state.entries.some(function(e){return e.id==="g2";})'), false);
    });

    // ── PART C: collectReportData titleMeta(라인별 편집 가능 여부) ─────────────
    // titles(문자열 배열·dedup)는 불변, titleMeta가 1:1로 병렬 추가. editable=true는 '단일 git 커밋' 출처만.
    const metaState = {
      gitAuthor: '', svnAuthor: '',
      categories: [
        { id: 'cg', name: '깃과제', color: '#3e5be0', desc: '', gitRepo: '', vcs: 'git', createdAt: CA },
        { id: 'cm', name: '혼합과제', color: '#2e9e6b', desc: '', gitRepo: '', vcs: 'git', createdAt: CA },
      ],
      entries: [
        // (a) 단일 유니크 git 커밋 → 편집 가능
        { id: 'gu', date: '2026-07-08', title: '무시제목', categoryId: 'cg', allDay: true, startTime: '', endTime: '',
          location: '', memo: '', source: 'git',
          commits: [{ hash: 'hu', short: 'hu', time: '09:00', subject: '유니크 커밋' }],
          hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        // (b) 동일 subject 커밋 2건(같은 과제) → 병합 → 편집 불가
        { id: 'gd', date: '2026-07-08', title: '무시', categoryId: 'cm', allDay: true, startTime: '', endTime: '',
          location: '', memo: '', source: 'git',
          commits: [{ hash: 'd1', short: 'd1', time: '09:00', subject: '중복 커밋' }, { hash: 'd2', short: 'd2', time: '10:00', subject: '중복 커밋' }],
          hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        // (c) 비-git 일정 제목(cm) → 편집 불가
        { id: 'ev1', date: '2026-07-08', title: '일정제목', categoryId: 'cm', allDay: true, startTime: '', endTime: '',
          location: '', memo: '', source: '', commits: [], hours: 30, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
      ],
      todos: [
        { id: 'td1', text: '할일제목', done: false, categoryId: 'cm', due: '2026-07-08', endDate: '', prio: 'normal', completedAt: '', note: '', createdAt: CA, updatedAt: CA },
      ],
      rooms: [],
    };
    const rowByName = (r, name) => r.rows.find(x => x.name === name);

    test('titleMeta: 단일 git 커밋 → editable true + entryId/hash/cidx, titles 불변', () => {
      seed(metaState);
      const r = collect('2026-07-01', '2026-07-31', { event: true, todo: true, git: true });
      const cg = rowByName(r, '깃과제');
      assert.deepStrictEqual(cg.titles, ['유니크 커밋']);              // 문자열 배열 shape 불변(엔트리 제목 아님)
      assert.strictEqual(cg.titleMeta.length, cg.titles.length);       // 1:1 정렬
      assert.strictEqual(cg.titleMeta[0].editable, true);
      assert.strictEqual(cg.titleMeta[0].entryId, 'gu');
      assert.strictEqual(cg.titleMeta[0].hash, 'hu');
      assert.strictEqual(cg.titleMeta[0].cidx, 0);
      assert.strictEqual(cg.titleMeta[0].text, '유니크 커밋');
    });
    test('titleMeta: 동일 subject 2건 → 병합(dedup) → editable false, entryId null', () => {
      seed(metaState);
      const r = collect('2026-07-01', '2026-07-31', { event: true, todo: true, git: true });
      const cm = rowByName(r, '혼합과제');
      assert.strictEqual(cm.titles.filter(t => t === '중복 커밋').length, 1);   // dedup 1회(문자열 불변)
      const dup = cm.titleMeta.find(m => m.text === '중복 커밋');
      assert.strictEqual(dup.editable, false);   // 2개 출처 → 단일 아님 → 편집 불가
      assert.strictEqual(dup.entryId, null);
      assert.strictEqual(dup.hash, null);
    });
    test('titleMeta: 일정 제목·할일 제목 → editable true(출처 라우팅), titles/titleMeta 1:1 유지', () => {
      seed(metaState);
      const r = collect('2026-07-01', '2026-07-31', { event: true, todo: true, git: true });
      const cm = rowByName(r, '혼합과제');
      const em = cm.titleMeta.find(m => m.text === '일정제목');
      assert.strictEqual(em.editable, true);          // 비-git 일정 → 일간 라인편집(setEntryTitle)
      assert.strictEqual(em.kind, 'event');
      assert.strictEqual(em.entryId, 'ev1');
      const tm = cm.titleMeta.find(m => m.text === '할일제목');
      assert.strictEqual(tm.editable, true);          // 할 일 → 일간 라인편집(setTodoText)
      assert.strictEqual(tm.kind, 'todo');
      assert.strictEqual(tm.todoId, 'td1');
      // titles(문자열) shape 불변: [중복 커밋(dedup), 일정제목, 할일제목]
      assert.strictEqual(cm.titles.length, 3);
      assert.ok(cm.titles.every(t => typeof t === 'string'));
      assert.strictEqual(cm.titleMeta.length, cm.titles.length);
    });

    // ── expandOccurrences (보고서 입력 정확성) ───────────────────────────
    test('expandOccurrences: 단일일 — 범위 안 1건, 범위 밖 0건', () => {
      const E = { id: 'x', date: '2026-07-08', endDate: '', recur: null, recurExcept: [] };
      assert.deepStrictEqual(occStarts(E, '2026-07-01', '2026-07-31'), ['2026-07-08']);
      assert.deepStrictEqual(occStarts(E, '2026-07-09', '2026-07-31'), []);   // 시작 이후 창 → 0
      assert.deepStrictEqual(occStarts(E, '2026-07-01', '2026-07-07'), []);   // 시작 이전 창 → 0
    });

    test('expandOccurrences: 기간(endDate) — 단일 발생이 [date,date+span] 전체를 덮음', () => {
      const E = { id: 'x', date: '2026-07-08', endDate: '2026-07-10', recur: null, recurExcept: [] };
      // 전체를 포함하는 창: 1건, _occStart=date, _occEnd=endDate
      const full = occFull(E, '2026-07-01', '2026-07-31');
      assert.strictEqual(full.length, 1);
      assert.strictEqual(full[0]._occStart, '2026-07-08');
      assert.strictEqual(full[0]._occEnd, '2026-07-10');
      // 스팬 '중간' 하루만 조회해도 걸침(기간 일정이 그날 표시됨)
      assert.strictEqual(occStarts(E, '2026-07-09', '2026-07-09').length, 1);
      assert.strictEqual(occStarts(E, '2026-07-10', '2026-07-10').length, 1);
      // 스팬 밖: 0
      assert.strictEqual(occStarts(E, '2026-07-11', '2026-07-11').length, 0);
      assert.strictEqual(occStarts(E, '2026-07-01', '2026-07-07').length, 0);
    });

    test('expandOccurrences: 주간 반복 count — 매주 3회', () => {
      const E = { id: 'x', date: '2026-07-06', endDate: '', recur: { freq: 'weekly', interval: 1, until: '', count: 3 }, recurExcept: [] };
      assert.deepStrictEqual(occStarts(E, '2026-07-01', '2026-07-31'), ['2026-07-06', '2026-07-13', '2026-07-20']);
    });

    test('expandOccurrences: 주간 반복 interval=2 — 격주(count 3이나 창 안 2건)', () => {
      const E = { id: 'x', date: '2026-07-06', endDate: '', recur: { freq: 'weekly', interval: 2, until: '', count: 3 }, recurExcept: [] };
      // 07-06, 07-20, (08-03은 창 밖)
      assert.deepStrictEqual(occStarts(E, '2026-07-01', '2026-07-31'), ['2026-07-06', '2026-07-20']);
    });

    test('expandOccurrences: 주간 반복 until — 종료일 이후 중단', () => {
      const E = { id: 'x', date: '2026-07-06', endDate: '', recur: { freq: 'weekly', interval: 1, until: '2026-07-14', count: 0 }, recurExcept: [] };
      assert.deepStrictEqual(occStarts(E, '2026-07-01', '2026-07-31'), ['2026-07-06', '2026-07-13']);
    });

    test('expandOccurrences: recurExcept — 예외 날짜 건너뜀', () => {
      const E = { id: 'x', date: '2026-07-06', endDate: '', recur: { freq: 'weekly', interval: 1, until: '', count: 3 }, recurExcept: ['2026-07-13'] };
      assert.deepStrictEqual(occStarts(E, '2026-07-01', '2026-07-31'), ['2026-07-06', '2026-07-20']);
    });

    test('expandOccurrences: 월간 반복 count — 매월 같은 날 3회', () => {
      const E = { id: 'x', date: '2026-07-15', endDate: '', recur: { freq: 'monthly', interval: 1, until: '', count: 3 }, recurExcept: [] };
      assert.deepStrictEqual(occStarts(E, '2026-07-01', '2026-09-30'), ['2026-07-15', '2026-08-15', '2026-09-15']);
    });

    // ── 보고서 서식(머리기호/들여쓰기) — prefs 영속 + buildReportText/buildReport WYSIWYG(결정6: 데이터 불변) ──
    const fmtState = (marker, custom, indent) => ({
      gitAuthor: '', svnAuthor: '',
      categories: [
        { id: 'ca', name: '에이', color: '#3e5be0', desc: '', gitRepo: '', vcs: 'git', createdAt: CA },
        { id: 'cb', name: '비이', color: '#2e9e6b', desc: '', gitRepo: '', vcs: 'git', createdAt: CA },
      ],
      entries: [
        { id: 'a1', date: '2026-07-02', title: '알파', categoryId: 'ca', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        { id: 'a2', date: '2026-07-03', title: '브라보', categoryId: 'ca', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        { id: 'a3', date: '2026-07-04', title: '찰리', categoryId: 'ca', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        { id: 'b1', date: '2026-07-05', title: '델타', categoryId: 'cb', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        { id: 'b2', date: '2026-07-06', title: '에코', categoryId: 'cb', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
      ],
      todos: [], rooms: [],
      reportMarker: marker, reportMarkerCustom: custom, reportIndent: indent,
    });
    const setRptRange = (f, t) => ev(`$('#rptFrom').value=${JSON.stringify(f)}; $('#rptTo').value=${JSON.stringify(t)}; $('#rptSrcEvent').checked=true; $('#rptSrcTodo').checked=true; $('#rptSrcGit').checked=true;`);

    // F2 — 라인 텍스트 빌더(카드×마커×들여쓰기): (indent*2 스페이스)+prefix+제목, 번호 카드별 리셋
    test('buildReportText(복사): 숫자 마커+들여쓰기2 — (indent*2)U+00A0+prefix+제목, 카드별 번호 리셋', () => {
      seed(fmtState('1.', '', 2));
      setRptRange('2026-07-01', '2026-07-31');
      const P = ' '.repeat(4);   // 복사 들여쓰기 = 비분리공백(2단*2) — netcus·평문 붙여넣기 양쪽 안전
      const lines = ev('buildReportText()').split('\n');
      assert.ok(lines.includes('[에이]'));            // 공수 제거 — 과제명만
      assert.ok(lines.includes(P + '1. 알파'));
      assert.ok(lines.includes(P + '2. 브라보'));
      assert.ok(lines.includes(P + '3. 찰리'));
      assert.ok(lines.includes('[비이]'));
      assert.ok(lines.includes(P + '1. 델타'));       // 카드 B — 번호 리셋
      assert.ok(lines.includes(P + '2. 에코'));
    });
    test('buildReportText: 무번호(none) — 마커/접미 없이 들여쓰기만(공백도 마커 없음)', () => {
      seed(fmtState('none', '', 3));
      setRptRange('2026-07-01', '2026-07-31');
      const P6 = ' '.repeat(6);   // 3단*2 (비분리공백)
      const lines = ev('buildReportText()').split('\n');
      assert.ok(lines.includes(P6 + '알파'));
      assert.ok(lines.includes(P6 + '델타'));
      assert.ok(!lines.some(l => /^\s*[-•·]/.test(l) && l.includes('알파')));
    });
    test('buildReportText: custom 마커 우선 — 그 문자, 들여쓰기0이면 스페이스 없음', () => {
      seed(fmtState('1.', '▶', 0));   // custom이 preset보다 우선
      setRptRange('2026-07-01', '2026-07-31');
      const lines = ev('buildReportText()').split('\n');
      assert.ok(lines.includes('▶ 알파'));
      assert.ok(lines.includes('▶ 델타'));
    });

    // 항목1 — 커밋 전체 본문(gitCommitBody) 통합: OFF=본문 미포함(기존과 동일), ON=제목 아래 더 깊은 들여쓰기 라인들
    const bodyState = (on) => ({
      gitAuthor: '', svnAuthor: '',
      categories: [{ id: 'cg', name: '깃', color: '#3e5be0', desc: '', gitRepo: '', vcs: 'git', createdAt: CA }],
      entries: [
        { id: 'g1', date: '2026-07-09', title: '', categoryId: 'cg', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: 'git',
          commits: [{ hash: 'h1', short: 'h1', time: '09:00', subject: '기능 추가', body: '본문 상세1\n본문 상세2' }],
          hours: null, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }],
      todos: [], rooms: [],
      reportMarker: 'none', reportMarkerCustom: '', reportIndent: 2, gitCommitBody: on,
    });
    const bodyRange = "reportMode='daily'; $('#rptFrom').value='2026-07-09'; $('#rptTo').value='2026-07-09'; $('#rptFrom').disabled=false; $('#rptTo').disabled=true; $('#rptSrcEvent').checked=true; $('#rptSrcTodo').checked=true; $('#rptSrcGit').checked=true;";
    const P4 = ' '.repeat(4), P6 = ' '.repeat(6);   // 제목=indent2*2, 본문=한 단계 더(+2)

    test('항목1(buildReportText): ON — 제목 아래 본문 라인들이 더 깊게 들여쓰기됨', () => {
      seed(bodyState(true));
      ev(bodyRange);
      const lines = ev('buildReportText()').split('\n');
      assert.ok(lines.includes(P4 + '기능 추가'), '제목 라인');
      assert.ok(lines.includes(P6 + '본문 상세1'), '본문 1행(더 깊은 들여쓰기)');
      assert.ok(lines.includes(P6 + '본문 상세2'), '본문 2행');
    });
    test('항목1(buildReportText): OFF(기본) — 본문 완전 미포함(기존과 동일)', () => {
      seed(bodyState(false));
      ev(bodyRange);
      const text = ev('buildReportText()');
      assert.ok(text.split('\n').includes(P4 + '기능 추가'), '제목은 그대로');
      assert.ok(!text.includes('본문 상세1'), 'OFF면 본문 미포함');
      assert.ok(!text.includes('본문 상세2'));
    });
    test('항목1(buildReport): ON→.rtask-body 렌더 / OFF→미렌더', () => {
      seed(bodyState(true));
      ev(bodyRange + ' buildReport();');
      const htmlOn = ev("$('#rptOut').innerHTML");
      assert.ok(htmlOn.includes('rtask-body'), 'ON: 본문 div 존재');
      assert.ok(htmlOn.includes('본문 상세1'), 'ON: 본문 텍스트 존재');
      seed(bodyState(false));
      ev(bodyRange + ' buildReport();');
      const htmlOff = ev("$('#rptOut').innerHTML");
      assert.ok(!htmlOff.includes('rtask-body'), 'OFF: 본문 div 없음');
      assert.ok(!htmlOff.includes('본문 상세1'), 'OFF: 본문 텍스트 없음');
      ev("reportMode='daily'");   // 상태 원복(다른 테스트 보호)
    });

    // F2c — buildWeeklyFields.endwork(netcus 자동전송 콘텐츠)도 복사와 동일 서식(머리기호+들여쓰기)
    test('buildWeeklyFields.endwork: 전송 콘텐츠도 마커+들여쓰기(2단) 반영, 카드별 번호 리셋', () => {
      seed(fmtState('가.', '', 2));
      setRptRange('2026-07-01', '2026-07-31');
      const NB = '&nbsp;'.repeat(4);   // netcus 전송 들여쓰기 = &nbsp; 4개(2단*2, euc-kr HTML collapse 방지)
      const ew = ev('buildWeeklyFields($("#rptFrom").value, $("#rptTo").value).endwork');
      assert.ok(ew.includes(NB + '가. '), '4×&nbsp; 들여쓰기 + 가. 마커');
      assert.ok((ew.split('\n' + NB + '가. ').length - 1) >= 2, '카드마다 가.로 번호 리셋');
      assert.ok(!ew.includes('    가. '), '평문 4칸 공백 아님(&nbsp;여야)');
      assert.ok(!/^- /m.test(ew), '옛 하드코딩 "- " 불릿 없음');
      const planwork = ev('buildWeeklyFields($("#rptFrom").value, $("#rptTo").value).planwork');
      assert.strictEqual(planwork, '[에이]\n[비이]', '차주계획에 과제 머리표 자동 생성');
    });

    test('buildWeeklyFields.content: 일간 과제시간을 주간 합산하고 구분선 아래 전체 합계 표시', () => {
      seed(reportState);
      setRptRange('2026-07-06', '2026-07-12');
      ev("setTaskHours('2026-07-06','c-1',2.5); setTaskHours('2026-07-07','c-1',1.5); setTaskHours('2026-07-08','c-2',3);");
      const content = ev('buildWeeklyFields($("#rptFrom").value, $("#rptTo").value).content');
      assert.strictEqual(content, '[보고서 작성] : 4\n[시스템 점검] : 3\n-----\n합계 : 7');
      ev("setTaskHours('2026-07-06','c-1',0); setTaskHours('2026-07-07','c-1',0); setTaskHours('2026-07-08','c-2',0);");
    });

    // F3 — XML 왕복: prefs 보존 + <prefs> 부재 시 기본값 + 데이터 무손실
    test('prefs roundtrip: reportMarker/custom/indent 보존', () => {
      seed(fmtState('가.', '▶', 5));
      const p = evJSON('fromXML(toXML())');
      assert.strictEqual(p.reportMarker, '가.');
      assert.strictEqual(p.reportMarkerCustom, '▶');
      assert.strictEqual(p.reportIndent, 5);
    });
    test('prefs roundtrip: custom 비면 속성 미기록·기본 복원(indent 경계 0)', () => {
      seed(fmtState('A.', '', 0));
      const xml = ev('toXML()');
      assert.ok(/reportMarker="A\."/.test(xml), 'reportMarker 기록');
      assert.ok(/reportIndent="0"/.test(xml), 'reportIndent=0도 기록');
      assert.ok(!/reportMarkerCustom/.test(xml), 'custom 비면 속성 없음');
      const p = evJSON('fromXML(' + JSON.stringify(xml) + ')');
      assert.strictEqual(p.reportMarker, 'A.');
      assert.strictEqual(p.reportMarkerCustom, '');
      assert.strictEqual(p.reportIndent, 0);
    });
    test('prefs 부재 XML → 기본값(-,"",2) + entries/todos/commits/rooms 무손실(가산적)', () => {
      seed(roundtripState);   // 4 엔트리(커밋 2건 포함)+2 todos+rooms
      let xml = ev('toXML()');
      xml = xml.replace(/<prefs\b[^>]*\/>/, '');
      assert.ok(!/<prefs/.test(xml), 'prefs 요소 제거됨');
      const p = evJSON('fromXML(' + JSON.stringify(xml) + ')');
      assert.strictEqual(p.reportMarker, '-');
      assert.strictEqual(p.reportMarkerCustom, '');
      assert.strictEqual(p.reportIndent, 2);
      // 데이터 무손실
      assert.strictEqual(p.entries.length, 4);
      const byId = Object.fromEntries(p.entries.map(e => [e.id, e]));
      assert.strictEqual(byId['e-2'].commits.length, 2);
      assert.deepStrictEqual(byId['e-2'].commits.map(c => c.subject), ['첫 커밋', '둘째 커밋']);
      assert.strictEqual(p.todos.length, 2);
      assert.deepStrictEqual(p.rooms, ['101호', '201호', '303호']);
    });
    test('prefs 범위/길이 방어: reportIndent clamp 0..6, 9자 custom 무시', () => {
      seed(fmtState('1.', '', 2));
      let xml = ev('toXML()');
      xml = xml.replace(/reportIndent="\d+"/, 'reportIndent="99"').replace('<prefs', '<prefs reportMarkerCustom="123456789"');
      const p = evJSON('fromXML(' + JSON.stringify(xml) + ')');
      assert.strictEqual(p.reportIndent, 6, 'clamp 상한 6');
      assert.strictEqual(p.reportMarkerCustom, '', 'len>8 custom은 무시→기본 빈값');
    });

    // F4 — 회귀: buildReport 일간 출력에 편집 앵커 유지 + rtask-t는 마커 없는 원문만
    const gitDailyState = (marker, indent) => ({
      gitAuthor: '', svnAuthor: '',
      categories: [{ id: 'cg', name: '깃과제', color: '#3e5be0', desc: '', gitRepo: '', vcs: 'git', createdAt: CA }],
      entries: [{ id: 'gu', date: '2026-07-08', title: '무시제목', categoryId: 'cg', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: 'git', commits: [{ hash: 'hu', short: 'hu', time: '09:00', subject: '유니크 커밋' }], hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }],
      todos: [], rooms: [],
      reportMarker: marker, reportMarkerCustom: '', reportIndent: indent,
    });
    const renderDaily = (marker, indent) => {
      seed(gitDailyState(marker, indent));
      ev("reportMode='daily'; editingReportKey=null;");
      ev("$('#rptFrom').value='2026-07-08'; $('#rptTo').value='2026-07-08'; $('#rptFrom').disabled=false; $('#rptTo').disabled=true; $('#rptSrcEvent').checked=true; $('#rptSrcTodo').checked=true; $('#rptSrcGit').checked=true;");
      ev('buildReport()');
      return ev("$('#rptOut').innerHTML");
    };
    test('regression: 일간 buildReport — rtask-edit-btn + data-reid/rhash/rcidx 유지, rtask-t=마커없는 원문', () => {
      const html = renderDaily('1.', 3);
      assert.ok(/rtask-edit-btn/.test(html), '편집 버튼(✎) 유지');
      assert.ok(/data-reid="gu"/.test(html), 'data-reid 유지');
      assert.ok(/data-rhash="hu"/.test(html), 'data-rhash 유지');
      assert.ok(/data-rcidx="0"/.test(html), 'data-rcidx 유지');
      const m = /<span class="rtask-t">([^<]*)<\/span>/.exec(html);
      assert.ok(m, 'rtask-t span 존재');
      assert.strictEqual(m[1], '유니크 커밋', 'rtask-t는 마커 없는 원문만(setCommitSubject·편집 textarea 안전)');
      assert.ok(/<span class="rtask-mk">1\. <\/span>/.test(html), '마커는 rtask-mk 별도 span');
      assert.ok(/padding-left:55px/.test(html), '들여쓰기 13+3*14=55px');
    });
    test('regression: 무번호(none) — rtask-mk 생략, rtask-t 원문 유지, indent0=base 13px', () => {
      const html = renderDaily('none', 0);
      assert.ok(!/rtask-mk/.test(html), '무번호는 마커 span 없음');
      assert.ok(/<span class="rtask-t">유니크 커밋<\/span>/.test(html), 'rtask-t 원문 유지');
      assert.ok(/rtask-edit-btn/.test(html), '편집 버튼 유지');
      assert.ok(/padding-left:13px/.test(html), 'indent0 → base 13px');
    });

    // 항목3 회귀 — 할일만 있는 카드(일정 0)는 흐림(rcard-empty) 아님 + 편집힌트 노출.
    //   버그: 흐림 판정을 entries(일정)로 해서 할일-only가 '빈 카드'로 오판·흐려짐 → hasContent(titles)로 수정.
    test('regression(항목3): 할일-only 카드 — rcard-empty 미부여 + 편집힌트 노출(일정 없어도)', () => {
      seed({
        gitAuthor: '', svnAuthor: '',
        categories: [{ id: 'ct', name: '할일과제', color: '#3e5be0', desc: '', gitRepo: '', vcs: 'git', createdAt: CA }],
        entries: [],   // 일정 0 (할일만)
        todos: [{ id: 'td', text: '할일 항목', done: false, categoryId: 'ct', due: '2026-07-08', endDate: '', prio: 'normal', note: '', createdAt: CA, updatedAt: CA }],
        rooms: [], reportMarker: '-', reportMarkerCustom: '', reportIndent: 2,
      });
      ev("reportMode='daily'; editingReportKey=null;");
      ev("$('#rptFrom').value='2026-07-08'; $('#rptTo').value='2026-07-08'; $('#rptFrom').disabled=false; $('#rptTo').disabled=true; $('#rptSrcEvent').checked=true; $('#rptSrcTodo').checked=true; $('#rptSrcGit').checked=true;");
      ev('buildReport()');
      const html = ev("$('#rptOut').innerHTML");
      assert.ok(html.includes('할일 항목'), '할일 항목이 카드에 렌더됨');
      // 할일과제 카드가 rcard-empty(흐림)가 아니어야 (일정이 없어도 내용은 있음)
      assert.ok(!/class="rcard rcard-empty"/.test(html) && !/class="rcard [^"]*rcard-empty/.test(html), '할일-only 카드에 rcard-empty 미부여');
      assert.ok(/오늘치 — 여기서 바로 수정/.test(html), '할일-only 카드에도 편집 힌트 노출');
    });

    // ── Item1 — 일간 과제별 시간 입력(tc_taskHours) → buildReportText 헤더 "[과제] : n" ──
    test('Item1(일간): setTaskHours → buildReportText "[과제] : 6.5" / 미입력이면 과제명만', () => {
      seed(reportState);
      ev("reportMode='daily'; $('#rptFrom').value='2026-07-09'; $('#rptTo').value='2026-07-09'; $('#rptFrom').disabled=false; $('#rptTo').disabled=true; $('#rptSrcEvent').checked=true; $('#rptSrcTodo').checked=true; $('#rptSrcGit').checked=true;");
      // 미입력 — 헤더에 시간 없음
      ev("setTaskHours('2026-07-09','c-1',0); setTaskHours('2026-07-09','c-2',0);");
      let lines = ev('buildReportText()').split('\n');
      assert.ok(lines.includes('[보고서 작성]'), '미입력 → 과제명만');
      assert.ok(!lines.some(l => /^\[보고서 작성\]\s*:/.test(l)), '미입력이면 " : " 안 붙음');
      // 6.5 입력 → 헤더에 반영(소수 유지)
      ev("setTaskHours('2026-07-09','c-1',6.5);");
      lines = ev('buildReportText()').split('\n');
      assert.ok(lines.includes('[보고서 작성] : 6.5'), '입력 시 "[과제] : 6.5"');
      assert.ok(lines.includes('[시스템 점검]'), '시간 없는 과제는 과제명만');
      assert.ok(!lines.some(l => /^\[시스템 점검\]\s*:/.test(l)), '시간 없는 과제 " : " 없음');
      // getTaskHours 왕복 + 클램프/정리(6.50→6.5, 음수→null, 과대→24)
      assert.strictEqual(ev("getTaskHours('2026-07-09','c-1')"), 6.5, 'getTaskHours 반환값');
      ev("setTaskHours('2026-07-09','c-1',-3);"); assert.strictEqual(ev("getTaskHours('2026-07-09','c-1')"), null, '음수 → 미입력(null)');
      ev("setTaskHours('2026-07-09','c-1',30);"); assert.strictEqual(ev("getTaskHours('2026-07-09','c-1')"), 24, '24 초과 → 24 클램프');
      // 주간/커스텀은 시간 안 붙음(일간 전용) — 같은 시간 저장돼 있어도 헤더엔 없음
      ev("setTaskHours('2026-07-09','c-1',6.5); reportMode='weekly'; $('#rptFrom').value='2026-07-06'; $('#rptTo').value='2026-07-12';");
      assert.ok(!/\]\s*:\s*\d/.test(ev('buildReportText()')), '주간 복사 텍스트 헤더에 시간 없음');
      // 정리(테스트 간 localStorage 격리)
      ev("setTaskHours('2026-07-09','c-1',0); reportMode='daily';");
    });
    test('Item1: 일간 buildReport rcard 헤더에 시간 입력칸(.rcard-h-in) 렌더 / 주간엔 없음', () => {
      seed(reportState);
      ev("reportMode='daily'; $('#rptFrom').value='2026-07-09'; $('#rptTo').value='2026-07-09'; $('#rptFrom').disabled=false; $('#rptTo').disabled=true; $('#rptSrcEvent').checked=true; $('#rptSrcTodo').checked=true; $('#rptSrcGit').checked=true; buildReport();");
      assert.ok(/class="rcard-h-in"/.test(ev("$('#rptOut').innerHTML")), '일간 rcard 헤더에 시간 입력칸');
      assert.ok(/data-hcat="c-1"/.test(ev("$('#rptOut').innerHTML")), 'catId 앵커(data-hcat)');
      ev("reportMode='weekly'; $('#rptFrom').value='2026-07-06'; $('#rptTo').value='2026-07-12'; $('#rptTo').disabled=true; buildReport();");
      assert.ok(!/rcard-h-in/.test(ev("$('#rptOut').innerHTML")), '주간엔 시간 입력칸 없음(읽기전용)');
      ev("reportMode='daily'");
    });

    // ── Item2/재작업 — 일간 편집가능 라인(커밋·일정·할일) 모두에 삭제(✕) 노출(원본 삭제) ──
    // (최초엔 git만이었으나, "일간 정리→주간 병합 클린" 목적상 일정·할일도 원본삭제로 확장)
    test('Item2(일간): 삭제(✕)는 편집가능 라인(커밋·일정·할일) 모두 노출', () => {
      seed(reportState);
      // git 커밋 라인(2026-07-08, g1) → 삭제 버튼 + git 라벨
      ev("reportMode='daily'; editingReportKey=null; $('#rptFrom').value='2026-07-08'; $('#rptTo').value='2026-07-08'; $('#rptFrom').disabled=false; $('#rptTo').disabled=true; $('#rptSrcEvent').checked=true; $('#rptSrcTodo').checked=true; $('#rptSrcGit').checked=true; buildReport();");
      const gitHtml = ev("$('#rptOut').innerHTML");
      assert.ok(/rtask-del-btn/.test(gitHtml), 'git 커밋 라인에 삭제 버튼');
      assert.ok(/data-ract="del"/.test(gitHtml), '삭제 액션 앵커(data-ract=del)');
      assert.ok(/이 커밋 삭제/.test(gitHtml), 'git 삭제 라벨');
      // 일정 라인(2026-07-09, v1) → 편집 + 삭제(원본 제거로 확장)
      ev("$('#rptFrom').value='2026-07-09'; $('#rptTo').value='2026-07-09'; buildReport();");
      const evHtml = ev("$('#rptOut').innerHTML");
      assert.ok(/rtask-edit-btn/.test(evHtml), '일정 라인 편집 버튼');
      assert.ok(/rtask-del-btn/.test(evHtml), '일정 라인에도 삭제 버튼(원본 삭제)');
      assert.ok(/이 일정 삭제/.test(evHtml), '일정 삭제 라벨(aria/title)');
      ev("reportMode='daily'");
    });
    test('Item2: deleteCommitRow — 커밋 제거 후 commits 반영(마지막이면 엔트리 제거)', () => {
      seed(reportState);   // g1: 커밋 2건(h1,h2)
      ev("deleteCommitRow('g1','h1',0)");   // h1 제거 → 1건 남음
      let e = evJSON("entryById('g1')");
      assert.ok(e && Array.isArray(e.commits) && e.commits.length === 1, '커밋 1건 남음');
      assert.strictEqual(e.commits[0].hash, 'h2', '남은 커밋은 h2');
      ev("deleteCommitRow('g1','h2',0)");   // 마지막 제거 → 엔트리 자체 제거
      assert.strictEqual(evJSON("entryById('g1')||null"), null, '커밋 0개 git 엔트리는 제거');
    });

    // ── 보고서 모달 재구성(레일+미리보기 / 근태 레일 슬롯 / ⚙옵션 / 내용 출처) ─────────
    // 데이터 로직 불변, 구조/노출만 변경. 근태는 미리보기(#rptOut) 밖 좌측 레일 #rptAttendRail(일간만).
    test('report UI: 내용 출처 행 — 일간 숨김 / 주간·커스텀 표시', () => {
      seed(reportState);
      ev("setReportMode('daily')");
      assert.strictEqual(ev("$('#rptSourceRow').style.display"), 'none', '일간=숨김');
      ev("setReportMode('weekly')");
      assert.strictEqual(ev("$('#rptSourceRow').style.display"), 'flex', '주간=표시');
      ev("setReportMode('custom')");
      assert.strictEqual(ev("$('#rptSourceRow').style.display"), 'flex', '커스텀=표시');
      ev("setReportMode('daily')");   // 상태 원복(테스트 간 간섭 방지)
    });

    test('report UI: 일간 buildReport — 근태(.rpt-attend)는 좌측 레일 #rptAttendRail, #rptOut엔 없음', () => {
      seed(reportState);
      ev("reportMode='daily'; $('#rptFrom').value='2026-07-08'; $('#rptTo').value='2026-07-08'; $('#rptFrom').disabled=false; $('#rptTo').disabled=true; $('#rptSrcEvent').checked=true; $('#rptSrcTodo').checked=true; $('#rptSrcGit').checked=true; buildReport();");
      assert.ok(/rpt-attend/.test(ev("$('#rptAttendRail').innerHTML")), '근태 바가 레일 슬롯에 렌더');
      assert.ok(/id="raStatus"/.test(ev("$('#rptAttendRail').innerHTML")), 'raStatus/raOT 존재');
      assert.ok(!/rpt-attend/.test(ev("$('#rptOut').innerHTML")), '#rptOut엔 근태 없음(미리보기=순수 카드)');
    });

    test('report UI: 주간/커스텀 buildReport — #rptAttendRail 비움', () => {
      seed(reportState);
      ev("reportMode='weekly'; $('#rptFrom').value='2026-07-06'; $('#rptTo').value='2026-07-12'; $('#rptFrom').disabled=false; $('#rptTo').disabled=true; buildReport();");
      assert.strictEqual(ev("$('#rptAttendRail').innerHTML"), '', '주간=근태 없음');
      ev("reportMode='custom'; $('#rptFrom').value='2026-07-01'; $('#rptTo').value='2026-07-31'; $('#rptFrom').disabled=false; $('#rptTo').disabled=false; buildReport();");
      assert.strictEqual(ev("$('#rptAttendRail').innerHTML"), '', '커스텀=근태 없음');
      ev("reportMode='daily'");
    });

    test('report UI: #rptOptSum — 포함 항목 체크 수 반영(하나 해제 → 2/3)', () => {
      seed(reportState);
      ev("reportMode='daily'; $('#rptFrom').value='2026-07-08'; $('#rptTo').value='2026-07-08'; $('#rptFrom').disabled=false; $('#rptTo').disabled=true; $('#rptSrcEvent').checked=true; $('#rptSrcTodo').checked=true; $('#rptSrcGit').checked=true; buildReport();");
      assert.ok(/포함 3\/3/.test(ev("$('#rptOptSum').textContent")), '3개 체크 → 3/3');
      ev("$('#rptSrcGit').checked=false; buildReport();");
      assert.ok(/포함 2\/3/.test(ev("$('#rptOptSum').textContent")), '하나 해제 → 2/3');
    });

    test('report UI: ⚙옵션 토글 — #rptOpt .open 토글 + aria-expanded 플립(bind 배선)', () => {
      ev("$('#rptOpt').classList.remove('open'); $('#rptOptBtn').setAttribute('aria-expanded','false');");
      ev("$('#rptOptBtn').click()");
      assert.ok(ev("$('#rptOpt').classList.contains('open')"), '클릭 → open');
      assert.strictEqual(ev("$('#rptOptBtn').getAttribute('aria-expanded')"), 'true');
      ev("$('#rptOptBtn').click()");
      assert.ok(!ev("$('#rptOpt').classList.contains('open')"), '재클릭 → 닫힘');
      assert.strictEqual(ev("$('#rptOptBtn').getAttribute('aria-expanded')"), 'false');
    });

    // ── netcus 주간 병합 미리보기(Phase2) — 렌더 브랜치(HOST=false=브라우저 경로) ─────
    test('report UI(netcus): 파서·전송·렌더 함수 전역 도달', () => {
      for(const fn of ['parseNetcusWeek', 'buildNetcusSendText', 'renderNetcusInto', 'renderNetcusPreview']){
        assert.strictEqual(ev('typeof ' + fn), 'function', fn + ' 전역이어야 함');
      }
    });

    test('report UI(netcus): 브라우저(HOST=false) net 출처 → "위젯에서만" 안내(#rptOut), fetch 없음', () => {
      seed(reportState);
      ev("state.reportSource='net'; reportMode='weekly'; $('#rptFrom').value='2026-07-06'; $('#rptTo').value='2026-07-12';");
      ev("renderNetcusInto('2026-07-06','2026-07-12')");   // HOST=false → 동기 가드 경로(hostRequest 안 탐)
      const out = ev("$('#rptOut').innerHTML");
      assert.ok(/위젯/.test(out), '위젯 전용 안내 문구');
      assert.ok(/rpt-guard/.test(out), 'guard 카드로 렌더');
      assert.strictEqual(ev("$('#rptSummary').textContent"), 'netcus 병합은 위젯에서만 됩니다');
      ev("state.reportSource='cal'; reportMode='daily';");   // 상태 원복
    });

    test('report UI(netcus): net 세그 버튼 클릭 배선 — reportSource=net 전환 + 가드 렌더(비활성 해제 확인)', () => {
      seed(reportState);
      // 세그 버튼이 더 이상 disabled가 아니어야 함(Part C: 활성화)
      assert.strictEqual(ev("$('#rptSrcSeg [data-rsrc=\"net\"]').disabled"), false, 'netcus 세그 활성화됨');
      ev("state.reportSource='cal'; reportMode='weekly'; $('#rptFrom').value='2026-07-06'; $('#rptTo').value='2026-07-12'; $('#rptFrom').disabled=false; $('#rptTo').disabled=true;");
      ev("$('#rptSrcSeg [data-rsrc=\"net\"]').click()");   // 실제 클릭(bind 배선) → state 전환 + buildReport
      assert.strictEqual(ev("state.reportSource"), 'net', '클릭 → reportSource=net');
      assert.strictEqual(ev("$('#rptSourceRow').getAttribute('data-src')"), 'net', '설명 강조 data-src 연동');
      assert.ok(/위젯|rpt-guard/.test(ev("$('#rptOut').innerHTML")), 'net(브라우저) → 가드 미리보기 렌더');
      ev("$('#rptSrcSeg [data-rsrc=\"cal\"]').click(); reportMode='daily';");   // 원복
    });

    test('report UI(netcus): renderNetcusPreview — 미등록 뱃지 + 미분류 // 사유(표시 전용) + 배너/상태라인', () => {
      seed(reportState);
      // 선행(no-header) → 미분류 / [미등록과제](카테고리 없음) → matched:false / 회의:2 → ambiguous
      ev("renderNetcusPreview(parseNetcusWeek([{date:'2026-07-06',content:'선행 메모\\n[미등록과제] : 2\\n탐색 작업',ok:true},{date:'2026-07-07',content:'회의 : 2',ok:true}], state.categories, {}), '09:30')");
      const out = ev("$('#rptOut').innerHTML");
      assert.ok(/rnc-badge/.test(out), '미등록 뱃지 렌더');
      assert.ok(/rnc-why/.test(out), '미분류 // 사유 span 렌더');
      assert.ok(/읽기전용/.test(out), '읽기전용 배너');
      assert.ok(/id="rncRefresh"/.test(out), '🔄 새로고침 버튼');
      assert.ok(/조회 09:30/.test(out), '조회 시각 표시');
      const sum = ev("$('#rptSummary').textContent");
      assert.ok(/미등록 1/.test(sum), '상태라인 미등록 카운트');
      assert.ok(/미분류 2건/.test(sum), '상태라인 미분류 카운트');
    });

    test('report UI(netcus): // 사유 주석은 화면 전용 — buildNetcusSendText엔 없음', () => {
      const sendText = ev("buildNetcusSendText(parseNetcusWeek([{date:'2026-07-06',content:'선행 메모\\n[보고서 작성]\\n초안',ok:true},{date:'2026-07-07',content:'회의 : 2',ok:true}], state.categories, {}))");
      assert.ok(!sendText.includes('//'), '전송 텍스트에 // 없음');
      assert.ok(sendText.includes('[미분류]'), '[미분류] 블록은 포함');
      assert.ok(sendText.includes('[보고서 작성]'), '과제 블록 포함');
    });
  }
}
