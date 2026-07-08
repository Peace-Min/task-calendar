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
  }
}
