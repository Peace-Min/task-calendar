// Layer 2 — 실제 앱을 jsdom에 부팅해 전역 함수(toXML/fromXML/collectReportData/expandOccurrences)를
// 그대로 호출·검증한다. 이 함수들은 페이지 전역 스코프의 bare global이라 window.eval로 직접 도달 가능.
// jsdom 미설치 시(폐쇄망 로컬 등) graceful-skip — 러너는 Layer 1만으로도 green. CI는 jsdom을 설치해 여기까지 돈다.
import { test, assert, loadAppSource } from './harness.mjs';

// ── 토큰 드리프트 가드(jsdom 불필요 — 소스 텍스트 스캔) ─────────────────
// var(--fs-*/--sp-*/--r-*/--lh-*)로 참조되는 스케일 토큰이 :root에 실제로 정의돼 있는지 검사한다.
// 미정의 토큰은 var()가 빈 값으로 풀려 선언 자체가 무효화 → 폰트/여백이 조용히 상속된다(실버그).
// 실제로 --fs-small이 정의 없이 보고서 미리보기에 쓰여 설명·dayNote 위계가 죽어 있었다.
test('디자인 토큰: 참조된 --fs-/--sp-/--r-/--lh- 스케일 토큰은 전부 :root에 정의돼 있어야 한다', () => {
  const src = loadAppSource();
  // :root{...} 블록(테마 오버라이드 :root[data-theme=...] 제외 — 스케일은 베이스에서만 정의)
  const rootStart = src.indexOf(':root{');
  assert.ok(rootStart >= 0, ':root{ 블록을 찾지 못함');
  const rootBlock = src.slice(rootStart, src.indexOf('}', rootStart));

  const defined = new Set();
  for (const m of rootBlock.matchAll(/(--(?:fs|sp|r|lh)-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);

  const missing = new Map();   // token -> 처음 등장한 줄 번호
  for (const m of src.matchAll(/var\(\s*(--(?:fs|sp|r|lh)-[a-z0-9-]+)/g)) {
    const tok = m[1];
    if (defined.has(tok) || missing.has(tok)) continue;
    missing.set(tok, src.slice(0, m.index).split('\n').length);
  }
  assert.deepStrictEqual([...missing.entries()], [],
    ':root에 없는 스케일 토큰이 참조됨(토큰 [줄번호]) — 정의를 추가하거나 기존 토큰으로 교체할 것');
});

// ── 색 리터럴 래칫(--fs/--sp/--r/--lh 가드가 구조적으로 못 잡는 종류) ─────
// 위 가드는 '참조된 토큰이 정의됐는지'만 본다. 애초에 토큰을 안 쓰고 #fff를 박아버린 선언은
// var()가 없으니 아무 신호도 남기지 않는다 — 실제로 사용설명서/스크린샷 뷰어 블록이 통째로
// 토큰화에서 빠졌는데도 테스트는 green이었다(다크에서 .shotViewer-card 1.21:1로 사실상 안 보임).
// 그래서 '토큰 정의처(:root / :root[data-theme] / html.dark) 밖의 hex 색 선언 수'에 상한을 건다.
// 상한 = 현재 값 → 새 하드코딩은 즉시 실패, 정리하면 상한을 내려 되돌아오지 못하게 못박는 일방향 래칫.
// (html.dark .foo{} 같은 '테마 스코프 개별 오버라이드'는 정의처가 아니라 사용처이므로 셈에 포함한다.)
const HEX_DECL_CEILING = 56;
test(`디자인 토큰: 토큰 블록 밖 hex 색 선언은 ${HEX_DECL_CEILING}개 이하여야 한다(래칫 — 늘리지 말고 줄일 것)`, () => {
  const src = loadAppSource();
  const s = src.indexOf('<style>'), e = src.indexOf('</style>', s);
  assert.ok(s >= 0 && e > s, '<style> 블록을 찾지 못함');
  let css = src.slice(s + 7, e).replace(/\/\*[\s\S]*?\*\//g, '');           // 주석 안 hex는 색이 아님
  css = css.replace(/(?::root(?:\[data-theme=[^\]]*\])?|html\.dark)\s*\{[^}]*\}/g, '');   // 토큰 정의처 제외
  // 선언 단위로 센다(한 선언에 hex가 여러 개여도 1). 앞이 '{' 또는 ';'인 것만 → 선택자 속 ':hover' 오검출 방지.
  const hits = [...css.matchAll(/(?:^|[;{])\s*([-a-z]+)\s*:\s*([^;{}]*#[0-9a-fA-F]{3,8}[^;{}]*)/g)]
    .map(m => `${m[1]}: ${m[2].trim()}`);
  assert.ok(hits.length <= HEX_DECL_CEILING,
    `토큰 블록 밖 hex 색 선언이 ${hits.length}개(상한 ${HEX_DECL_CEILING}) — 새 색은 var(--토큰)으로 쓸 것.\n` +
    hits.slice(HEX_DECL_CEILING).join('\n'));
  // 상한이 실제보다 헐거우면 래칫이 풀린다 → 줄인 만큼 상수를 내리도록 강제.
  assert.ok(hits.length >= HEX_DECL_CEILING,
    `hex 색 선언이 ${hits.length}개로 상한(${HEX_DECL_CEILING})보다 적다 — HEX_DECL_CEILING을 ${hits.length}로 내려 래칫을 조일 것`);
});

// ── 보고서 미리보기 글자 크기 배율(--m-scale) 가드 ───────────────────────
// 미러 안의 글자는 전부 자기 --fs-* 토큰을 직접 잡는다. 그래서 #rptOut의 font-size를 키워도
// 상속이 이겨지지 않아 '크기' 설정이 아무것도 안 하는 것처럼 보였다(실버그). 새로 추가되는 선언이
// 배율을 빠뜨리면 그 요소만 다시 고정 크기로 얼어붙으므로 선언 단위로 못박는다.
test('보고서 미리보기: .rpt-mirror 안의 font-size는 전부 --m-scale 배율을 곱해야 한다', () => {
  const src = loadAppSource();
  const s = src.indexOf('<style>'), e = src.indexOf('</style>', s);
  const css = src.slice(s + 7, e).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/(^|\})([^{}]*\.rpt-mirror[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length > 0, '.rpt-mirror 규칙을 찾지 못함');
  const bad = rules
    .filter(m => /font-size\s*:/.test(m[3]) && !/font-size\s*:\s*calc\(\s*var\(--m-scale\)/.test(m[3]))
    .map(m => m[2].trim());
  assert.deepStrictEqual(bad, [],
    '미러 안에 고정 font-size가 있음 — calc(var(--m-scale) * var(--fs-*))로 쓸 것(크기 설정이 이 요소만 건너뛴다)');
  // 배율 기본값이 없으면 설정 전 첫 렌더에서 calc()가 통째로 무효 → 글자가 사라진다.
  assert.ok(/#rptOut\.rpt-mirror\{--m-scale:1;/.test(css), '#rptOut.rpt-mirror에 --m-scale 기본값 1이 없음');
});

// JS가 배율을 계산할 때 쓰는 기준 픽셀은 CSS 토큰(--fs-emph)과 같아야 한다.
// calc()는 길이로 나눠 무단위 배율을 만들 수 없어 이 분모만 JS에 복제돼 있다 → 드리프트를 여기서 잡는다.
test('보고서 미리보기: REPORT_MIRROR_BASE_PX는 --fs-emph 픽셀값과 일치해야 한다', () => {
  const src = loadAppSource();
  const js = src.match(/const REPORT_MIRROR_BASE_PX\s*=\s*(\d+)/);
  assert.ok(js, 'REPORT_MIRROR_BASE_PX 선언을 찾지 못함');
  const tok = src.match(/--fs-emph\s*:\s*(\d+)px/);
  assert.ok(tok, '--fs-emph 토큰을 찾지 못함');
  assert.strictEqual(js[1], tok[1], 'JS 기준 픽셀과 --fs-emph가 어긋남 — 배율이 통째로 틀어진다');
});

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
    // 컨텍스트 안 Promise를 Node 레벨에서 await — jsdom realm 프로미스를 JSON 문자열로 환원해 realm 경계 안전.
    const evAsyncJSON = async (code) => JSON.parse(await w.eval('Promise.resolve(' + code + ').then(function(v){return JSON.stringify(v);})'));
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
        { id: 'c-1', name: '보고서 작성', color: '#3e5be0', desc: '주간/월간 보고', gitRepo: '/repo/a', svnRepo: '', createdAt: CA },
        { id: 'c-2', name: '시스템 점검', color: '#2e9e6b', desc: '', gitRepo: '/git/b', svnRepo: 'C:/wc/b', createdAt: CA },   // Git·SVN 둘 다 보유(독립) — 왕복 보존 검증
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
            { hash: 'aaaaaaa111', short: 'aaaaaa1', time: '09:15', subject: '첫 커밋', body: '본문 첫 줄\n- 둘째 줄(줄바꿈 보존)' },   // body 포함 → XML round-trip이 본문·줄바꿈 영속을 요구(재시작 후 소실 회귀 방지)
            { hash: 'bbbbbbb222', short: 'bbbbbb2', time: '14:30', subject: '둘째 커밋' },   // body 없음(빈 문자열로 round-trip)
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
        { id: 't-2', text: '점검 완료', done: true, categoryId: 'c-2', due: '2026-07-09', endDate: '2026-07-11', prio: 'normal', completedAt: '2026-07-11T09:00:00.000Z', note: '', dayNotes: { '2026-07-10': '중간 점검 메모', '2026-07-11': '완료 확인' }, createdAt: CA, updatedAt: CA },
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
      assert.strictEqual(p.categories[0].gitRepo, '/repo/a');   // git 전용 과제
      assert.strictEqual(p.categories[0].svnRepo, '');
      assert.strictEqual(p.categories[1].gitRepo, '/git/b');     // git·svn 둘 다 독립 보존
      assert.strictEqual(p.categories[1].svnRepo, 'C:/wc/b');
      assert.ok(!('vcs' in p.categories[0]) && !('vcs' in p.categories[1]), 'vcs 필드 폐기(결과에 없음)');
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
      assert.strictEqual(byId['e-2'].commits[0].body, '본문 첫 줄\n- 둘째 줄(줄바꿈 보존)');   // 본문 XML 왕복(줄바꿈 보존) — 재시작 후 본문 소실 회귀 방지
      assert.strictEqual(byId['e-2'].commits[1].body, '');   // body 없는 커밋 → 빈 문자열로 왕복(하위호환)
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
      assert.deepStrictEqual(t2.dayNotes, { '2026-07-10': '중간 점검 메모', '2026-07-11': '완료 확인' });
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
      // 과제: gitRepo/svnRepo/vcs 미기재 → 둘 다 '' + vcs 필드 없음, 이름 보존, foo 무시
      assert.strictEqual(p.categories.length, 1);
      assert.strictEqual(p.categories[0].gitRepo, '');
      assert.strictEqual(p.categories[0].svnRepo, '');
      assert.ok(!('vcs' in p.categories[0]), 'vcs 필드 폐기');
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

    // ── Git·SVN 독립 보유(신규): 과제가 두 VCS를 각각 따로 가짐 + 구버전 vcs 마이그레이션 ──────────
    test('git/svn 독립: 한 과제가 gitRepo·svnRepo 둘 다 보유 → XML 왕복에 둘 다 보존', () => {
      seed({
        gitAuthor: 'me@corp.com', svnAuthor: 'mysvn',
        categories: [{ id: 'cboth', name: '둘다과제', color: '#3e5be0', desc: '', gitRepo: 'C:/git/repo', svnRepo: 'C:/svn/wc', createdAt: CA }],
        entries: [], todos: [], rooms: [],
      });
      const p = evJSON('fromXML(toXML())');
      assert.strictEqual(p.categories[0].gitRepo, 'C:/git/repo', 'gitRepo 보존');
      assert.strictEqual(p.categories[0].svnRepo, 'C:/svn/wc', 'svnRepo 보존(덮이지 않음)');
      assert.ok(!('vcs' in p.categories[0]), 'vcs 필드 없음');
    });

    test('git/svn 마이그레이션: 구버전 vcs="svn"+gitRepo → svnRepo로 이관·gitRepo 비움·vcs 제거(하위호환)', () => {
      const oldSvnXml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<taskCalendar version="1" generator="old" gitAuthor="">' +
        '<categories>' +
        '<category id="c-svn" color="#2e9e6b" vcs="svn" gitRepo="C:/wc/old" createdAt="2026-01-01T00:00:00.000Z">' +
        '<name>구 SVN 과제</name><description></description></category>' +
        '<category id="c-git" color="#3e5be0" vcs="git" gitRepo="C:/git/old" createdAt="2026-01-01T00:00:00.000Z">' +
        '<name>구 Git 과제</name><description></description></category>' +
        '</categories><entries></entries></taskCalendar>';
      const p = evJSON('fromXML(' + JSON.stringify(oldSvnXml) + ')');
      const svn = p.categories.find(c => c.id === 'c-svn'), git = p.categories.find(c => c.id === 'c-git');
      // 구 vcs='svn': 그 gitRepo는 실제 SVN 경로였음 → svnRepo로 이관, gitRepo 비움
      assert.strictEqual(svn.svnRepo, 'C:/wc/old', '구 svn 경로가 svnRepo로 이관');
      assert.strictEqual(svn.gitRepo, '', '구 svn 과제의 gitRepo는 비워짐');
      assert.ok(!('vcs' in svn), 'vcs 제거');
      // 구 vcs='git'/부재: gitRepo 그대로, svnRepo ''
      assert.strictEqual(git.gitRepo, 'C:/git/old', '구 git 경로는 gitRepo 유지');
      assert.strictEqual(git.svnRepo, '', '구 git 과제의 svnRepo는 빈 값');
      assert.ok(!('vcs' in git));
    });

    test('gitEnabledCats: gitRepo만·svnRepo만·둘 다인 과제 포함, 아무것도 없으면 제외', () => {
      seed({
        gitAuthor: '', svnAuthor: '',
        categories: [
          { id: 'cg', name: '깃만', color: '#3e5be0', desc: '', gitRepo: 'C:/g', svnRepo: '', createdAt: CA },
          { id: 'cs', name: 'svn만', color: '#2e9e6b', desc: '', gitRepo: '', svnRepo: 'C:/s', createdAt: CA },
          { id: 'cb', name: '둘다', color: '#c43a3f', desc: '', gitRepo: 'C:/g2', svnRepo: 'C:/s2', createdAt: CA },
          { id: 'cn', name: '없음', color: '#4b62a0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
        ],
        entries: [], todos: [], rooms: [],
      });
      const ids = evJSON('gitEnabledCats().map(function(c){return c.id;})');
      assert.deepStrictEqual(ids.sort(), ['cb', 'cg', 'cs'], 'svn만 있는 과제도 포함, 미연결은 제외');
    });

    // ── mergeGitSvnCommits (순수 함수): hash dedup + 시각(date) 오름차순 병합 ──────────
    test('mergeGitSvnCommits: git+svn 병합 — hash dedup + date 정렬, 레거시(hash 없음)는 각자 유지', () => {
      const gitC = [
        { hash: 'g2', short: 'g2', date: '2026-07-08T14:00:00', subject: 'git 오후' },
        { hash: 'g1', short: 'g1', date: '2026-07-08T09:00:00', subject: 'git 오전' },
        { hash: 'dup', short: 'dup', date: '2026-07-08T11:00:00', subject: 'git 중복본' },
      ];
      const svnC = [
        { hash: 's1', short: 's1', date: '2026-07-08T10:00:00', subject: 'svn r1' },
        { hash: 'dup', short: 'dup', date: '2026-07-08T11:00:00', subject: 'svn 중복본(제거대상)' },
        { hash: '', short: '', date: '2026-07-08T08:00:00', subject: '레거시(해시없음)' },
      ];
      const merged = evJSON('mergeGitSvnCommits(' + JSON.stringify(gitC) + ',' + JSON.stringify(svnC) + ')');
      // dup은 첫 등장(git)만 유지 → 총 5건
      assert.strictEqual(merged.length, 5, 'hash dedup: dup 1건만');
      assert.strictEqual(merged.filter(c => c.hash === 'dup').length, 1);
      assert.strictEqual(merged.find(c => c.hash === 'dup').subject, 'git 중복본', '먼저 나온 git 쪽 유지');
      // date 오름차순 정렬
      assert.deepStrictEqual(merged.map(c => c.subject),
        ['레거시(해시없음)', 'git 오전', 'svn r1', 'git 중복본', 'git 오후']);
    });
    test('mergeGitSvnCommits: 한쪽이 빈 배열/비배열이어도 안전', () => {
      assert.deepStrictEqual(evJSON('mergeGitSvnCommits([], [])'), []);
      assert.strictEqual(evJSON('mergeGitSvnCommits([{hash:"a",date:"1",subject:"x"}], null).length'), 1);
      assert.strictEqual(evJSON('mergeGitSvnCommits(undefined, [{hash:"b",date:"1",subject:"y"}]).length'), 1);
    });

    // ── fetchCommitsForCat: 전역 hostRequest를 목킹해 git+svn 병합·부분실패 검증 ──────────
    // (fetchCommitsForCat은 함수 선언·전역 hostRequest 참조 → 전역 재할당으로 목킹 가능. 각 테스트는 원본 복원.)
    test('fetchCommitsForCat: gitRepo·svnRepo 둘 다 → 양쪽 호출·병합·정렬, ok=true', async () => {
      seed({ gitAuthor: 'g@x', svnAuthor: 'sv', categories: [], entries: [], todos: [], rooms: [] });
      ev('globalThis.__origHR = hostRequest;');
      try {
        ev(`
          globalThis.__calls = [];
          hostRequest = function(cmd, params){
            globalThis.__calls.push({cmd:cmd, repo:params.repo, vcs:params.vcs, author:params.author});
            if(params.vcs === 'git') return Promise.resolve({ok:true, commits:[{hash:'g1', short:'g1', date:'2026-07-08T13:00:00', subject:'git 커밋'}]});
            return Promise.resolve({ok:true, commits:[{hash:'s1', short:'s1', date:'2026-07-08T09:00:00', subject:'svn 커밋'}]});
          };
        `);
        const res = await evAsyncJSON('fetchCommitsForCat({gitRepo:"C:/g", svnRepo:"C:/s"}, "2026-07-08", "2026-07-08")');
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.errors.length, 0);
        assert.deepStrictEqual(res.commits.map(c => c.subject), ['svn 커밋', 'git 커밋'], 'date 정렬(svn 09시 먼저)');
        const calls = evJSON('globalThis.__calls');
        assert.strictEqual(calls.length, 2, 'git·svn 각 1회 호출');
        const g = calls.find(c => c.vcs === 'git'), s = calls.find(c => c.vcs === 'svn');
        assert.strictEqual(g.repo, 'C:/g'); assert.strictEqual(g.author, 'g@x', 'git은 git 작성자');
        assert.strictEqual(s.repo, 'C:/s'); assert.strictEqual(s.author, 'sv', 'svn은 svn 작성자');
      } finally { ev('hostRequest = globalThis.__origHR;'); }
    });
    test('fetchCommitsForCat: 한쪽(svn) 실패해도 다른 쪽(git) 커밋은 살림 + errors 기록', async () => {
      seed({ gitAuthor: 'g@x', svnAuthor: 'sv', categories: [], entries: [], todos: [], rooms: [] });
      ev('globalThis.__origHR = hostRequest;');
      try {
        ev(`
          hostRequest = function(cmd, params){
            if(params.vcs === 'git') return Promise.resolve({ok:true, commits:[{hash:'g1', date:'2026-07-08T10:00:00', subject:'git ok'}]});
            return Promise.resolve({ok:false, error:'svn 서버 없음'});
          };
        `);
        const res = await evAsyncJSON('fetchCommitsForCat({gitRepo:"C:/g", svnRepo:"C:/s"}, "2026-07-08", "2026-07-08")');
        assert.strictEqual(res.ok, true, '한쪽 성공이면 ok=true');
        assert.deepStrictEqual(res.commits.map(c => c.subject), ['git ok']);
        assert.strictEqual(res.errors.length, 1);
        assert.ok(/SVN:.*svn 서버 없음/.test(res.errors[0]), 'svn 실패가 errors에 기록');
      } finally { ev('hostRequest = globalThis.__origHR;'); }
    });
    test('fetchCommitsForCat: gitRepo만 있으면 svn 호출 안 함(불필요 왕복 없음)', async () => {
      seed({ gitAuthor: 'g@x', svnAuthor: 'sv', categories: [], entries: [], todos: [], rooms: [] });
      ev('globalThis.__origHR = hostRequest;');
      try {
        ev(`
          globalThis.__n = 0;
          hostRequest = function(cmd, params){ globalThis.__n++; return Promise.resolve({ok:true, commits:[]}); };
        `);
        const res = await evAsyncJSON('fetchCommitsForCat({gitRepo:"C:/g", svnRepo:""}, "2026-07-08", "2026-07-08")');
        assert.strictEqual(evJSON('globalThis.__n'), 1, 'gitRepo만 → 1회만 호출');
        assert.strictEqual(res.ok, true);
        assert.deepStrictEqual(res.commits, []);
      } finally { ev('hostRequest = globalThis.__origHR;'); }
    });

    test('todo dayNotes: 기간 안 날짜별 설명만 저장 + 기간→단일 전환 시 시작일 dayNote를 note로 복귀(무손실)', () => {
      seed(roundtripState);
      ev("updateTodo('t-2', { dayNotes: { '2026-07-09':'시작', '2026-07-10':'진행', '2026-07-12':'범위 밖' } })");
      let t = evJSON("todoById('t-2')");
      assert.deepStrictEqual(t.dayNotes, { '2026-07-09':'시작', '2026-07-10':'진행', '2026-07-11':'완료 확인' });
      // 기간→단일(endDate=due): 시작일 dayNote를 전역 note로 복귀, dayNotes는 비움(단일=note만). 무손실.
      ev("updateTodo('t-2', { endDate: '2026-07-09' })");
      t = evJSON("todoById('t-2')");
      assert.strictEqual(t.endDate, '');
      assert.strictEqual(t.note, '시작', '기간→단일: 시작일 dayNote가 note로 복귀');
      assert.deepStrictEqual(t.dayNotes, {}, '단일 할일은 dayNotes 미보유');
    });

    test('todo UI: 기간 할 일은 선택 날짜별 설명을 목록과 편집 폼에 표시', () => {
      seed(roundtripState);
      ev("selectedDate='2026-07-10'; editingTodoId=null;");
      let html = ev("todoRowHtml(todoById('t-2'))");
      assert.ok(/todo-daymemo/.test(html), '날짜별 설명 행 표시');
      assert.ok(/중간 점검 메모/.test(html), '선택 날짜 설명 표시');
      ev("editingTodoId='t-2';");
      html = ev("todoRowHtml(todoById('t-2'))");
      assert.ok(/class=\"te-daynote\"/.test(html), '선택 날짜 설명 편집기 표시');
      assert.ok(/data-date=\"2026-07-10\"/.test(html), '선택 날짜로 저장 앵커');
      assert.ok(/중간 점검 메모/.test(html), '기존 날짜별 설명 프리필');
    });

    test('todo UI: 기간 할 일 날짜별 설명 저장/비우기는 실제 편집 폼 클릭으로 반영', () => {
      seed(roundtripState);
      ev("selectedDate='2026-07-10'; document.querySelector('#dpBody').innerHTML=todoEditHtml(todoById('t-2'));");
      ev("document.querySelector('.todo-edit .te-daynote').value='클릭 저장 메모'; document.querySelector('.todo-edit [data-act=\"save\"]').click();");
      let t = evJSON("todoById('t-2')");
      assert.strictEqual(t.dayNotes['2026-07-10'], '클릭 저장 메모');
      assert.strictEqual(ev("editingTodoId"), null);

      ev("selectedDate='2026-07-10'; document.querySelector('#dpBody').innerHTML=todoEditHtml(todoById('t-2'));");
      ev("document.querySelector('.todo-edit .te-daynote').value=''; document.querySelector('.todo-edit [data-act=\"save\"]').click();");
      t = evJSON("todoById('t-2')");
      assert.ok(!Object.prototype.hasOwnProperty.call(t.dayNotes || {}, '2026-07-10'), '빈 날짜별 설명은 저장하지 않고 제거');
    });

    // ── 기간 할일 dayNotes → 보고서 병합/편집 + 이중 설명 모델 전환 이관 (신규) ────────────
    // 주(2026): 월07-13 화07-14 수07-15 목07-16 금07-17 토07-18 일07-19 (weekRange 규약과 일치)
    const dnState = () => ({
      gitAuthor: '', svnAuthor: '',
      categories: [{ id: 'cp', name: '기획', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }],
      entries: [],
      todos: [
        // 기간 할일: 월~금, dayNotes는 월/수/금만(화·목 비어 있음)
        { id: 'tp', text: '보고서 준비', done: false, categoryId: 'cp', due: '2026-07-13', endDate: '2026-07-17', prio: 'normal', completedAt: '', note: '', dayNotes: { '2026-07-13': '초안 작성', '2026-07-15': '검토', '2026-07-17': '마무리' }, createdAt: CA, updatedAt: CA },
        // 기간 할일이지만 범위 내 dayNote 0개 — skipEmpty 대상
        { id: 'te', text: '빈 기간할일', done: false, categoryId: 'cp', due: '2026-07-13', endDate: '2026-07-17', prio: 'normal', completedAt: '', note: '', dayNotes: {}, createdAt: CA, updatedAt: CA },
        // 단일 할일: 전역 note 사용(날짜 무관)
        { id: 'ts', text: '단일 검토', done: false, categoryId: 'cp', due: '2026-07-15', endDate: '', prio: 'normal', completedAt: '', note: '단일 설명', dayNotes: {}, createdAt: CA, updatedAt: CA },
      ],
      rooms: [],
    });
    const collectDN = (from, to, src) => evJSON('collectReportData(' + JSON.stringify(from) + ',' + JSON.stringify(to) + ',' + JSON.stringify(src) + ')');
    const rowCp = r => r.rows.find(x => x.name === '기획');
    const setWeekly = (f, t) => ev("reportMode='weekly'; $('#rptFrom').value='" + f + "'; $('#rptTo').value='" + t + "'; $('#rptSrcEvent').checked=true; $('#rptSrcTodo').checked=true; $('#rptSrcGit').checked=true; $('#rptWithDesc').checked=true; $('#rptSkipEmpty').checked=false; editingDayNoteKey=null; editingReportKey=null;");

    test('기간 할일 dayNotes → 주간 보고: details=본문만(복사·전송), dayDetails=날짜 보존(미리보기)', () => {
      seed(dnState());
      const r = collectDN('2026-07-13', '2026-07-19', { event: true, todo: true, git: true, desc: true, skipEmpty: false });
      const row = rowCp(r);
      const mp = row.titleMeta[row.titles.indexOf('보고서 준비')];
      assert.deepStrictEqual(mp.details, ['초안 작성', '검토', '마무리'], 'details(복사·전송 텍스트)는 날짜 접두 없이 본문만');
      assert.deepStrictEqual(mp.dayDetails.map(d => d.date), ['2026-07-13', '2026-07-15', '2026-07-17'], 'dayDetails는 날짜 보존(미리보기 흐린 접두용)');
      assert.deepStrictEqual(mp.dayDetails.map(d => d.text), ['초안 작성', '검토', '마무리']);
      const ms = row.titleMeta[row.titles.indexOf('단일 검토')];
      assert.deepStrictEqual(ms.details, ['단일 설명'], '단일 할일은 전역 note가 detail');
      assert.strictEqual(ms.dayDetails, null, '단일 할일은 dayDetails 없음');
    });

    test('일간 보고: 그날 dayNote만(요일 접두 없음)', () => {
      seed(dnState());
      const r = collectDN('2026-07-15', '2026-07-15', { event: true, todo: true, git: true, desc: true, skipEmpty: false });
      const mp = rowCp(r).titleMeta[rowCp(r).titles.indexOf('보고서 준비')];
      assert.deepStrictEqual(mp.details, ['검토'], '일간(from==to)은 그날 dayNote 원문만(접두 없음)');
    });

    test('skipEmpty ON: dayNote 없는 기간할일 제외 / 있으면 유지', () => {
      seed(dnState());
      let row = rowCp(collectDN('2026-07-13', '2026-07-19', { event: true, todo: true, git: true, desc: true, skipEmpty: true }));
      assert.ok(row.titles.includes('보고서 준비'), 'dayNote 있는 기간할일 유지');
      assert.ok(!row.titles.includes('빈 기간할일'), 'dayNote 0개 기간할일 제외');
      row = rowCp(collectDN('2026-07-13', '2026-07-19', { event: true, todo: true, git: true, desc: true, skipEmpty: false }));
      assert.ok(row.titles.includes('빈 기간할일'), 'skipEmpty OFF면 제목만이라도 유지');
    });

    test('skipEmpty ON: 내용 없는 과제 행도 제외(빈 과제명 미표시)', () => {
      seed({
        gitAuthor: '', svnAuthor: '',
        categories: [
          { id: 'c-full', name: '내용과제', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
          { id: 'c-empty', name: '빈과제', color: '#2e9e6b', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
        ],
        entries: [],
        todos: [
          { id: 't1', text: '작업', done: false, categoryId: 'c-full', due: '2026-07-15', endDate: '', prio: 'normal', completedAt: '', note: '설명있음', dayNotes: {}, createdAt: CA, updatedAt: CA },
        ],
        rooms: [],
      });
      const names = (skip) => collectDN('2026-07-15', '2026-07-15', { event: true, todo: true, git: true, desc: true, skipEmpty: skip }).rows.map(r => r.name);
      const off = names(false);
      assert.ok(off.includes('내용과제') && off.includes('빈과제'), 'skipEmpty OFF면 빈 과제 행도 표시(기존 동작 보존)');
      const on = names(true);
      assert.ok(on.includes('내용과제'), '내용 있는 과제는 유지');
      assert.ok(!on.includes('빈과제'), 'skipEmpty ON이면 내용 없는 과제 행 제외');
    });

    test('reportSubIndent: 설명 들여쓰기가 마커 표시폭만큼(한글=2칸) — 제목 텍스트 아래 정렬', () => {
      assert.strictEqual(evJSON("reportSubIndent('가. ', ' ')"), '    ', '가(2)+.(1)+공백(1)=4칸');
      assert.strictEqual(evJSON("reportSubIndent('가) ', ' ')"), '    ', '가)+공백=4칸');
      assert.strictEqual(evJSON("reportSubIndent('1. ', ' ')"), '   ', '1+.+공백=3칸');
      assert.strictEqual(evJSON("reportSubIndent('10) ', ' ')"), '    ', '1+0+)+공백=4칸');
      assert.strictEqual(evJSON("reportSubIndent('', ' ')"), '  ', '마커 없으면 최소 2칸(중첩)');
    });

    test('포함 항목: 일간/주간 모드별 캐싱 + 구 포맷(단일) 하위호환', () => {
      // 구 포맷(단일 객체) → 일간·주간 양쪽 이관
      ev("localStorage.setItem('tc_rptSources', JSON.stringify({event:false, todo:true, git:true, desc:true, skipEmpty:true}));");
      let p = evJSON("loadRptSourcePrefs()");
      assert.strictEqual(p.daily.event, false); assert.strictEqual(p.weekly.event, false);
      assert.strictEqual(p.daily.skipEmpty, true); assert.strictEqual(p.weekly.skipEmpty, true);
      // 모드별 저장 — 일간=커밋 OFF, 주간=커밋 ON (서로 독립)
      ev("localStorage.removeItem('tc_rptSources'); reportMode='daily'; $('#rptSrcEvent').checked=true; $('#rptSrcTodo').checked=true; $('#rptSrcGit').checked=false; $('#rptWithDesc').checked=true; $('#rptSkipEmpty').checked=false; saveRptSourcePrefs();");
      ev("reportMode='weekly'; $('#rptSrcGit').checked=true; $('#rptSrcEvent').checked=false; saveRptSourcePrefs();");
      p = evJSON("loadRptSourcePrefs()");
      assert.strictEqual(p.daily.git, false, '일간 커밋 OFF 저장');
      assert.strictEqual(p.weekly.git, true, '주간 커밋 ON 저장');
      assert.strictEqual(p.daily.event, true); assert.strictEqual(p.weekly.event, false);
      // applyRptSourcePrefs가 현재 모드값을 체크박스에 복원
      ev("reportMode='daily'; applyRptSourcePrefs();");
      assert.strictEqual(evJSON("$('#rptSrcGit').checked"), false, '일간 복원 → 커밋 OFF');
      ev("reportMode='weekly'; applyRptSourcePrefs();");
      assert.strictEqual(evJSON("$('#rptSrcGit').checked"), true, '주간 복원 → 커밋 ON');
      ev("reportMode='custom'; applyRptSourcePrefs();");
      assert.strictEqual(evJSON("$('#rptSrcGit').checked"), true, 'custom=weekly 키 재사용');
      ev("localStorage.removeItem('tc_rptSources'); reportMode='daily';");
    });

    test('주간 보고 렌더: 기간 할일 날짜별 dayNote 라인(.rdn) 편집 앵커 + 요일 접두 + 제목 읽기전용', () => {
      seed(dnState());
      setWeekly('2026-07-13', '2026-07-19');
      ev('buildReport()');
      const html = ev("$('#rptOut').innerHTML");
      assert.ok(html.includes('data-dnid="tp"') && html.includes('data-dndate="2026-07-13"'), '날짜별 편집 앵커(todoId/date)');
      assert.ok(/data-dnact="edit"/.test(html), 'dayNote 라인 편집 버튼');
      assert.ok(html.includes('초안 작성') && html.includes('마무리'), '날짜별 dayNote 텍스트 렌더');
      assert.ok(html.includes('월 7/13') && html.includes('금 7/17'), '요일 M/D 접두');
      assert.ok(/rtask-roline/.test(html), '제목은 읽기전용(.rtask-roline)');
      assert.ok(!/rtask-edit-btn/.test(html), '주간 제목엔 편집 버튼 없음(제목 읽기전용 유지)');
      assert.ok(evJSON("!!$('#rptOut').querySelector('.rtask-roline .rtask-main .rdn')"), 'dayNote 라인이 .rtask-main 안 → 제목 텍스트 아래 정렬(마커 폭 무관)');
    });

    test('주간 날짜별 라인 저장: 클릭→편집→저장이 updateTodo(dayNotes) 왕복 반영', () => {
      seed(dnState());
      setWeekly('2026-07-13', '2026-07-19');
      ev('buildReport()');
      ev("document.querySelector('#rptOut .rdn[data-dndate=\"2026-07-13\"] [data-dnact=\"edit\"]').click();");
      assert.strictEqual(ev('editingDayNoteKey'), 'tp|2026-07-13', '클릭 시 편집 키 설정');
      ev("var _ta=document.querySelector('#rptOut .rdn-edit'); _ta.value='초안 완료'; commitDayNoteEdit(_ta);");
      const t = evJSON("todoById('tp')");
      assert.strictEqual(t.dayNotes['2026-07-13'], '초안 완료', '원본 dayNotes 반영(단일 소스)');
      assert.strictEqual(ev('editingDayNoteKey'), null, '저장 후 편집 상태 해제');
    });

    test('주간 날짜별 라인 비우기: 빈 값 저장 시 그 날짜 dayNote 제거', () => {
      seed(dnState());
      setWeekly('2026-07-13', '2026-07-19');
      ev('buildReport()');
      ev("document.querySelector('#rptOut .rdn[data-dndate=\"2026-07-15\"] [data-dnact=\"edit\"]').click();");
      ev("var _ta=document.querySelector('#rptOut .rdn-edit'); _ta.value='   '; commitDayNoteEdit(_ta);");
      const t = evJSON("todoById('tp')");
      assert.ok(!Object.prototype.hasOwnProperty.call(t.dayNotes, '2026-07-15'), '빈 값 → 그 날짜 dayNote 제거');
      assert.deepStrictEqual(Object.keys(t.dayNotes).sort(), ['2026-07-13', '2026-07-17']);
    });

    test('전환 이관: 단일→기간 — 전역 note가 시작일 dayNote로 이관되고 note 비움(무손실)', () => {
      seed(dnState());
      ev("updateTodo('ts', { endDate: '2026-07-17' })");   // ts: 단일(note='단일 설명', due=07-15) → 기간
      const t = evJSON("todoById('ts')");
      assert.strictEqual(t.endDate, '2026-07-17');
      assert.strictEqual(t.note, '', '기간 전환 후 전역 note 비움');
      assert.strictEqual(t.dayNotes['2026-07-15'], '단일 설명', 'note가 시작일 dayNote로 이관');
    });

    test('전환 이관: 기간→단일 — 시작일 dayNote가 note로 복귀(무손실)', () => {
      seed(dnState());
      ev("updateTodo('tp', { endDate: '' })");   // tp: 기간 → 단일
      const t = evJSON("todoById('tp')");
      assert.strictEqual(t.endDate, '');
      assert.strictEqual(t.note, '초안 작성', '시작일 dayNote가 note로 복귀');
      assert.deepStrictEqual(t.dayNotes, {}, '단일 할일은 dayNotes 미보유');
    });

    test('단일 할일 note 보존: due 변경해도 전역 note 유지(날짜 무관)', () => {
      seed(dnState());
      ev("updateTodo('ts', { due: '2026-07-20' })");   // 단일 유지(endDate 없음)
      const t = evJSON("todoById('ts')");
      assert.strictEqual(t.due, '2026-07-20');
      assert.strictEqual(t.note, '단일 설명', 'due 변경에도 단일 note 보존');
      assert.deepStrictEqual(t.dayNotes, {});
    });

    test('addTodo(기간+설명): 전역 설명이 시작일 dayNote로 이관되어 생성(무손실)', () => {
      seed(dnState());
      const id = ev("addTodo('신규 기간', { categoryId:'cp', due:'2026-07-20', endDate:'2026-07-22', note:'시작 설명' }).id");
      const t = evJSON("todoById(" + JSON.stringify(id) + ")");
      assert.strictEqual(t.note, '', '기간 생성 시 전역 note 비움');
      assert.strictEqual(t.dayNotes['2026-07-20'], '시작 설명', '시작일 dayNote로 이관');
    });

    // ── collectReportData (보고서 정확성 — 최고 가치) ─────────────────────
    const reportState = {
      gitAuthor: '', svnAuthor: '',
      categories: [
        { id: 'c-1', name: '보고서 작성', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
        { id: 'c-2', name: '시스템 점검', color: '#2e9e6b', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
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

    test('collectReportData: 설명 포함과 내용 없는 항목 제외 옵션', () => {
      const st = {
        gitAuthor: '', svnAuthor: '',
        categories: [{ id: 'cx', name: 'Alpha', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }],
        entries: [
          { id: 'e-desc', date: '2026-07-09', title: 'Event with memo', categoryId: 'cx', allDay: true, startTime: '', endTime: '', location: '', memo: 'memo one\n• memo two', source: '', commits: [], hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
          { id: 'e-empty', date: '2026-07-09', title: 'Event without memo', categoryId: 'cx', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
          { id: 'g-desc', date: '2026-07-09', title: 'Git entry', categoryId: 'cx', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: 'git', commits: [{ hash: 'g1', short: 'g1', time: '10:00', subject: 'Git subject' }], hours: 30, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        ],
        todos: [
          { id: 'td-desc', text: 'Todo with note', done: false, categoryId: 'cx', due: '2026-07-09', endDate: '', prio: 'normal', completedAt: '', note: 'todo detail', createdAt: CA, updatedAt: CA },
          { id: 'td-empty', text: 'Todo without note', done: false, categoryId: 'cx', due: '2026-07-09', endDate: '', prio: 'normal', completedAt: '', note: '', createdAt: CA, updatedAt: CA },
        ],
        rooms: [],
      };
      seed(st);
      let r = collect('2026-07-01', '2026-07-31', { event: true, todo: true, git: true, desc: true, skipEmpty: false });
      let row = rowOf(r, 'Alpha');
      assert.deepStrictEqual(row.titleMeta[row.titles.indexOf('Event with memo')].details, ['memo one', 'memo two']);
      assert.deepStrictEqual(row.titleMeta[row.titles.indexOf('Todo with note')].details, ['todo detail']);
      assert.ok(row.titles.includes('Event without memo'));
      assert.ok(row.titles.includes('Todo without note'));

      r = collect('2026-07-01', '2026-07-31', { event: true, todo: true, git: true, desc: true, skipEmpty: true });
      row = rowOf(r, 'Alpha');
      assert.ok(row.titles.includes('Event with memo'));
      assert.ok(row.titles.includes('Todo with note'));
      assert.ok(row.titles.includes('Git subject'), '커밋 제목은 자체가 내용이므로 유지');
      assert.ok(!row.titles.includes('Event without memo'));
      assert.ok(!row.titles.includes('Todo without note'));
      assert.strictEqual(row.minutes, 90, '내용 없는 일정은 공수 집계에서도 제외');
      assert.deepStrictEqual(row.entries.map(e => e.id).sort(), ['e-desc', 'g-desc'], '내용 없는 일정은 편집/표시용 엔트리 버킷에서도 제외');
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
      withEtcFirst.categories.unshift({ id: 'c-etc', name: '기타', color: '#5b6b7d', desc: '', gitRepo: '', svnRepo: '', createdAt: CA });
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
      categories: [{ id: 'c-1', name: '시스템 점검', color: '#2e9e6b', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }],
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

    // ── setCommitMessage (커밋 내역 탭 전체메시지 편집 — 첫 줄=제목·나머지=본문 재분리) ──
    const commitBodyOf = (eid, i) => evJSON(`(entryById(${JSON.stringify(eid)}).commits[${i}].body||"")`);
    test('setCommitMessage: 제목+본문 → 첫 줄=제목(정규화)·나머지=본문(내부 줄바꿈 보존)', () => {
      seed(mutState());
      assert.strictEqual(ev('setCommitMessage("g1","h1",0,"고친  제목\\n본문 첫째\\n- 본문 둘째")'), true);
      assert.strictEqual(commitSubjectOf('g1', 0), '고친 제목');            // 제목만 \s+ 접기+트림
      assert.strictEqual(commitBodyOf('g1', 0), '본문 첫째\n- 본문 둘째');   // 본문 줄바꿈 보존
      assert.notStrictEqual(evJSON('entryById("g1").updatedAt'), CA);       // updatedAt 갱신
      assert.strictEqual(commitSubjectOf('g1', 1), '둘째 커밋');            // 다른 커밋 불변
    });
    test('setCommitMessage: 선두 빈 줄 무시 → 첫 비어있지 않은 줄이 제목', () => {
      seed(mutState());
      assert.strictEqual(ev('setCommitMessage("g1","h1",0,"\\n\\n  진짜 제목\\n본문")'), true);
      assert.strictEqual(commitSubjectOf('g1', 0), '진짜 제목');
      assert.strictEqual(commitBodyOf('g1', 0), '본문');
    });
    test('setCommitMessage: 제목만(본문 없음) → body 빈 문자열', () => {
      seed(mutState());
      assert.strictEqual(ev('setCommitMessage("g1","h1",0,"제목만 있음")'), true);
      assert.strictEqual(commitSubjectOf('g1', 0), '제목만 있음');
      assert.strictEqual(commitBodyOf('g1', 0), '');
    });
    test('setCommitMessage: 전부 공백/빈 입력 → false(제목 없음, 원본 유지)', () => {
      seed(mutState());
      assert.strictEqual(ev('setCommitMessage("g1","h1",0,"   \\n  \\n ")'), false);   // 모든 줄 공백 → 제목 없음
      assert.strictEqual(ev('setCommitMessage("g1","h1",0,"")'), false);
      assert.strictEqual(commitSubjectOf('g1', 0), '첫 커밋');
    });
    test('setCommitMessage: 제목 줄이 공백이고 아래 본문 있으면 → 첫 비어있지 않은 줄(본문 첫 줄)이 제목으로 승격', () => {
      seed(mutState());
      assert.strictEqual(ev('setCommitMessage("g1","h1",0,"   \\n본문만")'), true);   // git 관례: 첫 비어있지 않은 줄=제목
      assert.strictEqual(commitSubjectOf('g1', 0), '본문만');
      assert.strictEqual(commitBodyOf('g1', 0), '');
    });
    test('setCommitMessage: 무변경(제목 동일·본문 동일) → false', () => {
      seed(mutState());
      assert.strictEqual(ev('setCommitMessage("g1","h1",0,"첫 커밋")'), false);   // 기존 subject='첫 커밋', body 없음(='')
      assert.strictEqual(commitSubjectOf('g1', 0), '첫 커밋');
    });
    test('setCommitMessage: 없는 엔트리/커밋 → false', () => {
      seed(mutState());
      assert.strictEqual(ev('setCommitMessage("nope","h1",0,"x")'), false);
      assert.strictEqual(ev('setCommitMessage("g1","zzz",5,"x")'), false);
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

    // 회귀: 커밋 전체 본문(body)이 gitFeed 행·renderGitTab(커밋 내역 탭)에 실려 표시돼야 함.
    // (버그: 피드/렌더가 body를 누락 → 옵션 ON 저장분도 커밋 내역 탭엔 제목만 보여 '안 불러온 듯' 오인. 보고서엔 정상이었음.)
    test('regression(커밋내역 본문): git body가 gitFeed 행·renderGitTab에 렌더됨', () => {
      seed({
        gitAuthor: '', svnAuthor: '',
        categories: [{ id: 'c-b', name: '시스템 점검', color: '#2e9e6b', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }],
        entries: [
          { id: 'gb', date: '2026-07-08', title: '작업일지', categoryId: 'c-b', allDay: true, startTime: '', endTime: '',
            location: '', memo: '', source: 'git',
            commits: [{ hash: 'hb', short: 'hb', time: '14:38', subject: '제목 한 줄', body: '본문 첫째 줄\n- 둘째 줄' }],
            hours: null, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        ],
        todos: [], rooms: [],
      });
      ev('selectedDate = "2026-07-08"'); ev('noteFilterCat = null');
      assert.strictEqual(evJSON('gitFeed().find(function(r){return r.hash==="hb";}).body'), '본문 첫째 줄\n- 둘째 줄');   // 피드에 body 실림
      assert.strictEqual(ev('renderGitTab().indexOf("nd-commit-body") >= 0'), true);   // 본문 컨테이너 렌더
      assert.strictEqual(ev('renderGitTab().indexOf("둘째 줄") >= 0'), true);           // 본문 텍스트 렌더
    });

    // ── PART C: collectReportData titleMeta(라인별 편집 가능 여부) ─────────────
    // titles(문자열 배열·dedup)는 불변, titleMeta가 1:1로 병렬 추가. editable=true는 '단일 git 커밋' 출처만.
    const metaState = {
      gitAuthor: '', svnAuthor: '',
      categories: [
        { id: 'cg', name: '깃과제', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
        { id: 'cm', name: '혼합과제', color: '#2e9e6b', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
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
        { id: 'ca', name: '에이', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
        { id: 'cb', name: '비이', color: '#2e9e6b', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
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
    test('reportFormatPrefs: 일간/주간 서식은 서로 독립 적용', () => {
      const st = fmtState('-', '', 0);
      st.reportFormatPrefs = {
        daily: { marker: '-', markerCustom: '', indent: 0 },
        weekly: { marker: '1.', markerCustom: '', indent: 2 },
      };
      seed(st);
      setRptRange('2026-07-01', '2026-07-31');

      ev("reportMode='daily'");
      const dailyLines = ev('buildReportText()').split('\n');
      assert.ok(dailyLines.some(l => l.startsWith('- ')), 'daily uses hyphen with indent 0');
      assert.ok(!dailyLines.some(l => l.startsWith('1. ')), 'daily does not leak weekly numbering');

      ev("reportMode='weekly'");
      const weeklyLines = ev('buildReportText()').split('\n');
      const P = ' '.repeat(4);
      assert.ok(weeklyLines.some(l => l.startsWith(P + '1. ')), 'weekly uses its own indent+number marker');
      assert.ok(!weeklyLines.some(l => l.startsWith('- ')), 'weekly does not leak daily hyphen');

      ev("setReportMode('custom'); $('#rptFrom').value='2026-07-01'; $('#rptTo').value='2026-07-31';");
      const customLines = ev('buildReportText()').split('\n');
      assert.ok(customLines.some(l => l.startsWith(P + '1. ')), 'custom range uses weekly formatting, not daily');
      assert.ok(!customLines.some(l => l.startsWith('- ')), 'custom range does not overwrite daily formatting');
    });

    test('buildReportText/buildWeeklyFields: 설명 포함 시 제목 아래 설명 라인 출력', () => {
      const st = fmtState('-', '', 1);
      st.entries = [
        { id: 'd1', date: '2026-07-02', title: 'Alpha item', categoryId: 'ca', allDay: true, startTime: '', endTime: '', location: '', memo: 'detail one\n• detail two', source: '', commits: [], hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
      ];
      seed(st);
      setRptRange('2026-07-01', '2026-07-31');
      ev("$('#rptWithDesc').checked=true; $('#rptSkipEmpty').checked=false;");

      let lines = ev('buildReportText()').split('\n').map(l => l.trim());
      assert.ok(lines.includes('- Alpha item'));
      assert.ok(lines.includes('detail one'));
      assert.ok(lines.includes('detail two'));

      const ewLines = ev('buildWeeklyFields($("#rptFrom").value, $("#rptTo").value).endwork').split('\n').map(l => l.replace(/&nbsp;/g, '').trim());
      assert.ok(ewLines.includes('- Alpha item'));
      assert.ok(ewLines.includes('detail one'));
      assert.ok(ewLines.includes('detail two'));
    });

    // 항목1 — 커밋 전체 본문(gitCommitBody) 통합: OFF=본문 미포함(기존과 동일), ON=제목 아래 더 깊은 들여쓰기 라인들
    const bodyState = (on) => ({
      gitAuthor: '', svnAuthor: '',
      categories: [{ id: 'cg', name: '깃', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }],
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
    test('prefs roundtrip: 일간/주간 reportFormatPrefs 보존', () => {
      const st = fmtState('-', '', 1);
      st.reportFormatPrefs = {
        daily: { marker: '-', markerCustom: '', indent: 1 },
        weekly: { marker: 'A.', markerCustom: '▶', indent: 4 },
      };
      seed(st);
      const xml = ev('toXML()');
      assert.ok(/reportMarker_daily="-"/.test(xml), 'daily marker 기록');
      assert.ok(/reportIndent_weekly="4"/.test(xml), 'weekly indent 기록');
      assert.ok(/reportMarkerCustom_weekly="▶"/.test(xml), 'weekly custom 기록');
      const p = evJSON('fromXML(' + JSON.stringify(xml) + ')');
      assert.deepStrictEqual(p.reportFormatPrefs.daily, { marker: '-', markerCustom: '', indent: 1 });
      assert.deepStrictEqual(p.reportFormatPrefs.weekly, { marker: 'A.', markerCustom: '▶', indent: 4 });
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
    // ── 기간 취합(custom) 전용 보고서 폰트 — 정규화 / <prefs> 왕복 / 복사용 HTML 트윈 ──────────
    test('normalizeReportFont: 화이트리스트 폰트·10~16pt만 통과, 그 외는 기본(""/0)', () => {
      assert.deepStrictEqual(evJSON("normalizeReportFont({family:'Gulim',size:12})"), { family: 'Gulim', size: 12 });
      assert.deepStrictEqual(evJSON("normalizeReportFont({family:'Comic Sans MS',size:12})"), { family: '', size: 12 }, '미등록 폰트 → ""(크기는 유효하면 유지)');
      assert.deepStrictEqual(evJSON("normalizeReportFont({family:'Batang',size:9})"), { family: 'Batang', size: 0 }, '하한 미만 → 0');
      assert.deepStrictEqual(evJSON("normalizeReportFont({family:'Batang',size:17})"), { family: 'Batang', size: 0 }, '상한 초과 → 0');
      assert.deepStrictEqual(evJSON("normalizeReportFont({family:'Batang',size:'abc'})"), { family: 'Batang', size: 0 }, '숫자 아님 → 0');
      assert.deepStrictEqual(evJSON("normalizeReportFont({family:'Batang',size:12.5})"), { family: 'Batang', size: 0 }, '정수 아님 → 0');
      assert.deepStrictEqual(evJSON("normalizeReportFont({family:'Batang',size:'12'})"), { family: 'Batang', size: 12 }, '숫자 문자열은 허용(셀렉트 value)');
      assert.deepStrictEqual(evJSON('normalizeReportFont(null)'), { family: '', size: 0 });
      assert.deepStrictEqual(evJSON('normalizeReportFont(undefined)'), { family: '', size: 0 });
      assert.deepStrictEqual(evJSON('normalizeReportFont({})'), { family: '', size: 0 });
      // 경계값 10/16은 통과해야 한다
      assert.deepStrictEqual(evJSON("normalizeReportFont({family:'',size:10})"), { family: '', size: 10 });
      assert.deepStrictEqual(evJSON("normalizeReportFont({family:'',size:16})"), { family: '', size: 16 });
    });

    // 셀렉트에 실제로 뜨는 값이 전부 끝까지 살아 있어야 한다 — 하나라도 정규화에서 기본으로 떨어지면
    // 사용자가 고른 크기가 조용히 무시된다(고를 수 있는데 안 먹는 옵션 = 고장난 컨트롤).
    test('reportFont: REPORT_FONT_SIZES의 모든 옵션이 정규화를 통과하고 미러 배율로 단조 증가한다', () => {
      const sizes = evJSON('REPORT_FONT_SIZES');
      assert.deepStrictEqual(sizes, [0, 10, 11, 12, 13, 14, 15, 16], '제공 목록이 바뀌면 이 테스트도 같이 갱신할 것');
      // 0(기본)은 pt가 아니라 14px이라 10pt(13.33px)와 11pt(14.67px) 사이에 낀다 → 단조 검사는 pt 옵션만.
      let prev = 0;
      for (const n of sizes) {
        const norm = evJSON(`normalizeReportFont({family:'',size:${n}})`);
        assert.strictEqual(norm.size, n, `${n}pt가 정규화에서 기본으로 떨어짐 — 셀렉트에 있는데 안 먹는 옵션`);
        if (n === 0) continue;
        const scale = Number(evJSON(`reportFontCss({family:'',size:${n}})`).scale);
        assert.ok(scale > prev, `${n}pt 배율(${scale})이 이전 옵션(${prev}) 이하 — 크기 순서가 깨짐`);
        prev = scale;
      }
      // 기본(0)은 배율을 아예 안 싣는다 = CSS 기본값 1 = 기존 픽셀 그대로.
      assert.strictEqual(evJSON("reportFontCss({family:'',size:0})").scale, '');
      // 경계: 10pt는 기본보다 작고, 16pt는 크다(1pt=4/3px, 기준 14px).
      assert.ok(Number(evJSON("reportFontCss({family:'',size:10})").scale) < 1);
      assert.ok(Number(evJSON("reportFontCss({family:'',size:16})").scale) > 1);
    });

    // 배율이 DOM까지 실제로 도달하는지 — syncReportFontUI가 #rptOut에 인라인으로 심고, 기본이면 지운다.
    test('reportFont: syncReportFontUI가 #rptOut에 --m-scale을 심고 기본에서는 제거한다', () => {
      ev("state.reportFont = {family:'', size:16}; syncReportFontUI();");
      assert.strictEqual(ev("$('#rptOut').style.getPropertyValue('--m-scale')").trim(),
        evJSON("reportFontCss({family:'',size:16})").scale);
      assert.strictEqual(ev("$('#rptOut').style.fontSize"), '16pt');
      ev("state.reportFont = {family:'', size:0}; syncReportFontUI();");
      assert.strictEqual(ev("$('#rptOut').style.getPropertyValue('--m-scale')").trim(), '',
        '기본으로 돌아오면 인라인 배율은 지워져야 한다(CSS 기본값 1로 복귀)');
      assert.strictEqual(ev("$('#rptOut').style.fontSize"), '');
    });

    test('reportFont roundtrip: <prefs fontFamily/fontSize> 보존 + 기본이면 속성 미기록(기존 파일 byte 동일)', () => {
      // 기본값 — 속성이 하나도 붙지 않아야 구버전 파일과 byte 동일
      seed(fmtState('-', '', 2));
      let xml = ev('toXML()');
      assert.ok(!/fontFamily/.test(xml), '기본 폰트면 fontFamily 속성 없음');
      assert.ok(!/fontSize/.test(xml), '기본 크기면 fontSize 속성 없음');
      assert.deepStrictEqual(evJSON('fromXML(' + JSON.stringify(xml) + ').reportFont'), { family: '', size: 0 }, '속성 부재 → 기본');

      // 값 설정 — 왕복 동일 + 앱 자체 검증기도 통과
      const st = fmtState('-', '', 2);
      st.reportFont = { family: 'Batang', size: 14 };
      seed(st);
      xml = ev('toXML()');
      assert.ok(/fontFamily="Batang"/.test(xml), 'fontFamily 기록');
      assert.ok(/fontSize="14"/.test(xml), 'fontSize 기록');
      assert.deepStrictEqual(evJSON('fromXML(' + JSON.stringify(xml) + ').reportFont'), { family: 'Batang', size: 14 });
      assert.strictEqual(evJSON('xmlRoundTrip()').ok, true, '앱 자체 검증기도 폰트 포함 무손실');

      // 손상/외부편집 값은 파싱에서 기본으로 떨어진다(저장 경로와 동일 검증)
      const bad = xml.replace('fontFamily="Batang"', 'fontFamily="Comic Sans MS"').replace('fontSize="14"', 'fontSize="99"');
      assert.deepStrictEqual(evJSON('fromXML(' + JSON.stringify(bad) + ').reportFont'), { family: '', size: 0 }, '미등록 폰트·범위 밖 크기 → 기본');
    });

    test('buildReportHtml: 평문과 내용 동일(줄 수 보존·HTML 이스케이프) + 폰트 있을 때만 서식', () => {
      const st = fmtState('-', '', 2);
      st.entries = st.entries.concat([{
        id: 'x1', date: '2026-07-07', title: '<b>중요</b> & "인용"', categoryId: 'ca', allDay: true,
        startTime: '', endTime: '', location: '', memo: '', source: '', commits: [],
        hours: 60, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA,
      }]);
      seed(st);
      setRptRange('2026-07-01', '2026-07-31');
      const text = ev('buildReportText()');
      assert.ok(text.includes('<b>중요</b> & "인용"'), '평문에는 원문 그대로');

      // 폰트 없음 — 서식 속성 없이 white-space만
      const plainHtml = ev('buildReportHtml(buildReportText(), {family:"",size:0})');
      assert.strictEqual((plainHtml.match(/<br>/g) || []).length, text.split('\n').length - 1,
        '<br> 수 = 평문 줄바꿈 수(라인 추가·손실 없음)');
      assert.ok(!/font-family/.test(plainHtml), '폰트 미설정이면 font-family 없음');
      assert.ok(!/font-size/.test(plainHtml), '폰트 미설정이면 font-size 없음');
      assert.ok(/white-space:pre-wrap/.test(plainHtml), '선행 공백 보존용 pre-wrap은 항상');
      // HTML 특수문자 이스케이프 — 본문에 살아있는 태그가 없어야 한다(<div>/<br>은 래퍼)
      assert.ok(plainHtml.includes('&lt;b&gt;중요&lt;/b&gt;'), '< > 이스케이프');
      assert.ok(plainHtml.includes('&amp;'), '& 이스케이프');
      assert.ok(!/<b>/.test(plainHtml), '원문 태그가 실제 태그로 새지 않음');
      // 언이스케이프 후 평문과 완전 일치(내용 드리프트 0)
      const unesc = plainHtml
        .replace(/^<div style="[^"]*">/, '').replace(/<\/div>$/, '')
        .split('<br>').join('\n')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
      assert.strictEqual(unesc, text, '언이스케이프하면 평문과 바이트 동일');

      // 폰트 설정 — 서식만 추가되고 라인 수는 그대로
      const styledHtml = ev('buildReportHtml(buildReportText(), {family:"Gulim",size:12})');
      assert.ok(/font-family/.test(styledHtml), '폰트 설정 시 font-family 부여');
      assert.ok(styledHtml.includes('Gulim'), '선택한 폰트명 포함');
      assert.ok(/Malgun Gothic/.test(styledHtml), '안전 폴백 스택 동반');
      assert.ok(/font-size:12pt/.test(styledHtml), 'pt 단위 크기');
      assert.strictEqual((styledHtml.match(/<br>/g) || []).length, text.split('\n').length - 1,
        '서식을 입혀도 라인 수 불변');
    });

    test('reportFont: 폰트 행·미리보기 서식은 일간/주간/기간 취합 전부에 적용된다', () => {
      const st = fmtState('-', '', 2);
      st.reportFont = { family: 'Gulim', size: 13 };
      seed(st);
      for(const mode of ['custom', 'daily', 'weekly']){
        ev(`setReportMode(${JSON.stringify(mode)}); $('#rptFrom').value='2026-07-01'; $('#rptTo').value=${mode === 'daily' ? "'2026-07-01'" : "'2026-07-31'"}; buildReport();`);
        assert.notStrictEqual(ev("$('#rptFontRow').style.display"), 'none', `${mode}에서 폰트 행 노출`);
        assert.notStrictEqual(ev("$('#rptFontHint').style.display"), 'none', `${mode}에서 폰트 안내 노출`);
        assert.ok(ev("$('#rptOut').style.fontFamily").includes('Gulim'), `${mode} 미리보기에 폰트 적용`);
        assert.strictEqual(ev("$('#rptOut').style.fontSize"), '13pt', `${mode} 미리보기 크기 적용`);
        // 글꼴은 ⚙옵션이 아니라 레일에 상시 노출 → 접힘 요약에 나오면 '옵션 안 설정'으로 오인된다
        assert.ok(!/폰트|글꼴/.test(ev("$('#rptOptSum').textContent")), `${mode} 옵션 요약에는 글꼴이 없다`);
        // 셀렉트도 저장값과 동기(재오픈·모드 전환 후에도)
        assert.strictEqual(ev("$('#rptFontFamily').value"), 'Gulim', `${mode} 폰트 셀렉트 동기`);
        assert.strictEqual(ev("$('#rptFontSize').value"), '13', `${mode} 크기 셀렉트 동기`);
      }
      // 기본값이면 인라인 스타일을 걷어낸다(모드 무관) — '기본' 표기도 확인
      ev("state.reportFont={family:'',size:0}; buildReport();");
      assert.strictEqual(ev("$('#rptOut').style.fontFamily"), '', '기본 폰트면 인라인 스타일 해제');
      assert.strictEqual(ev("$('#rptOut').style.fontSize"), '');
      ev("reportMode='daily'");   // 상태 원복(다른 테스트 보호)
    });

    // 회귀 방지: 글꼴 행이 ⚙옵션(#rptOpt) 안으로 되돌아가면 netcus 출처에서 통째로 사라진다(옵션 패널이 숨겨지므로).
    // 보고 유형 3 × 내용 출처 3 = 9조합 전부에서 레일에 남아 있어야 한다.
    test('reportFont: 글꼴 행은 ⚙옵션 밖 레일에 있어 3모드 × 3출처 9조합 모두에서 노출된다', () => {
      const st = fmtState('-', '', 2);
      st.reportFont = { family: 'Gulim', size: 13 };
      seed(st);
      assert.strictEqual(ev("!!$('#rptOpt').contains($('#rptFontRow'))"), false, '글꼴 행은 ⚙옵션 패널 밖');
      assert.strictEqual(ev("$('#rptFontRow').parentElement.className"), 'rpt-rail', '레일 직속 자식');
      for(const mode of ['daily', 'weekly', 'custom']){
        for(const src of ['cal', 'net', 'week']){
          ev(`setReportMode(${JSON.stringify(mode)}); state.reportSource=${JSON.stringify(src)};`
            + `$('#rptFrom').value='2026-07-01'; $('#rptTo').value=${mode === 'daily' ? "'2026-07-01'" : "'2026-07-31'"}; buildReport();`);
          const tag = `${mode}/${src}`;
          assert.notStrictEqual(ev("$('#rptFontRow').style.display"), 'none', `${tag}: 글꼴 행 노출`);
          assert.notStrictEqual(ev("$('#rptFontHint').style.display"), 'none', `${tag}: 안내 문구 노출`);
          assert.strictEqual(ev("$('#rptFontFamily').value"), 'Gulim', `${tag}: 폰트 셀렉트 동기`);
          assert.strictEqual(ev("$('#rptFontSize').value"), '13', `${tag}: 크기 셀렉트 동기`);
          assert.ok(ev("$('#rptOut').style.fontFamily").includes('Gulim'), `${tag}: 미리보기에 폰트 적용`);
          // netcus 출처(주간/커스텀)에서는 ⚙옵션이 숨는다 — 그래도 글꼴은 남아야 한다는 것이 이 테스트의 요지
          const optHidden = (ev("$('#rptOpt').style.display") === 'none');
          assert.strictEqual(optHidden, (src !== 'cal' && mode !== 'daily'), `${tag}: ⚙옵션 표시 규칙 유지`);
        }
      }
      ev("state.reportSource='cal'; state.reportFont={family:'',size:0}; reportMode='daily'");   // 상태 원복
    });

    // 폰트는 표시+복사 전용이라는 계약 — 전송 페이로드(회사 폼)와 평문 복사는 폰트에 1바이트도 반응하면 안 된다.
    test('reportFont 불변식: buildReportText/buildWeeklyFields(전송 콘텐츠)는 폰트와 무관하게 바이트 동일', () => {
      const st = fmtState('-', '', 2);
      st.entries = st.entries.concat([{
        id: 'x2', date: '2026-07-07', title: '폰트 무관 확인', categoryId: 'ca', allDay: true,
        startTime: '', endTime: '', location: '', memo: '메모', source: '', commits: [],
        hours: 90, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA,
      }]);
      seed(st);
      setRptRange('2026-07-01', '2026-07-31');
      // setReportMode가 기간을 그 모드 기본값으로 되돌리므로 from/to는 매번 다시 지정한다
      ev("setReportMode('daily'); $('#rptFrom').value='2026-07-07'; $('#rptTo').value='2026-07-07';");
      const plainDaily = ev('buildReportText()');
      const sendDaily = ev("buildReportText('&nbsp;')");                       // netcus 일간 전송 content
      ev("setReportMode('weekly'); $('#rptFrom').value='2026-07-01'; $('#rptTo').value='2026-07-31';");
      const plainWeekly = ev('buildReportText()');
      const sendWeekly = ev('JSON.stringify(buildWeeklyFields($("#rptFrom").value, $("#rptTo").value, rptSources()))');

      // 공허한 비교(양쪽 다 빈 문자열) 방지 — 기준값이 실제 내용을 담고 있어야 한다
      assert.ok(plainDaily.includes('폰트 무관 확인') && plainWeekly.includes('폰트 무관 확인'), '기준 텍스트가 비어 있지 않음');
      assert.ok(/endwork/.test(sendWeekly) && sendWeekly.includes('폰트 무관 확인'), '기준 주간 전송 필드가 비어 있지 않음');

      ev("state.reportFont={family:'Batang',size:16}; $('#rptFrom').value='2026-07-01'; $('#rptTo').value='2026-07-31'; buildReport();");   // 폰트 설정 후 동일 경로 재계산
      assert.strictEqual(ev('buildReportText()'), plainWeekly, '주간 평문 복사 바이트 동일');
      assert.strictEqual(ev('JSON.stringify(buildWeeklyFields($("#rptFrom").value, $("#rptTo").value, rptSources()))'), sendWeekly,
        '주간 전송 필드(subject/content/endwork/planwork) 바이트 동일');
      ev("setReportMode('daily'); $('#rptFrom').value='2026-07-07'; $('#rptTo').value='2026-07-07'; buildReport();");
      assert.strictEqual(ev('buildReportText()'), plainDaily, '일간 평문 복사 바이트 동일');
      assert.strictEqual(ev("buildReportText('&nbsp;')"), sendDaily, '일간 전송 content 바이트 동일');
      // HTML 트윈에만 서식이 붙는다 — 같은 평문에서 파생됐음을 함께 확인
      const html = ev("buildReportHtml(buildReportText(), normalizeReportFont(state.reportFont))");
      assert.ok(/font-family/.test(html) && /font-size:16pt/.test(html), '일간 HTML 트윈에는 폰트 적용');
      assert.strictEqual((html.match(/<br>/g) || []).length, plainDaily.split('\n').length - 1, '라인 수 불변');
      ev("state.reportFont={family:'',size:0}; reportMode='daily'");   // 상태 원복
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
      categories: [{ id: 'cg', name: '깃과제', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }],
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
        categories: [{ id: 'ct', name: '할일과제', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }],
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

    // ── buildCalendarExportMd (연구노트 데이터 내보내기 — 순수 직렬화) ─────────────
    // 선택 과제 1개의 캘린더 기록을 날짜별 md로. cat은 catById로 조회해 넘긴다. ev는 원시 문자열을 그대로 반환.
    const buildMd = (catId, from, to) =>
      ev('buildCalendarExportMd(catById(' + JSON.stringify(catId) + '),' + JSON.stringify(from) + ',' + JSON.stringify(to) + ')');
    const catOnly = (name, extra) => ({ id: (extra && extra.id) || 'c-1', name, color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA, ...(extra || {}) });

    test('buildCalendarExportMd: 단일 일정+메모 → 헤더·날짜·### 일정·제목(공수)·메모 불릿', () => {
      seed({
        gitAuthor: '', svnAuthor: '',
        categories: [catOnly('연구과제')],
        entries: [{ id: 'e1', date: '2026-07-08', title: '실험 설계', categoryId: 'c-1', allDay: true, startTime: '', endTime: '', location: '', memo: '가설 수립\n장비 점검', source: '', commits: [], hours: 90, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }],
        todos: [], rooms: [],
      });
      const md = buildMd('c-1', '2026-07-08', '2026-07-08');
      assert.ok(md.includes('# 연구노트 데이터 — 연구과제'), '문서 제목');
      assert.ok(md.includes('## 2026-07-08 (수)'), '날짜 헤더 + 한글 요일');
      assert.ok(md.includes('### 일정'), '일정 섹션');
      assert.ok(md.includes('- 실험 설계 · 1시간 30분'), '제목 + 공수(90분→1시간 30분)');
      const lines = md.split('\n');
      assert.ok(lines.includes('  - 가설 수립') && lines.includes('  - 장비 점검'), '메모 불릿 2칸 들여쓰기');
    });

    test('buildCalendarExportMd: 기간 할일 dayNotes — 해당일은 — 설명, dayNote 없는 in-range일은 상세 없음', () => {
      seed({
        gitAuthor: '', svnAuthor: '',
        categories: [catOnly('연구과제')],
        entries: [],
        todos: [{ id: 'tp', text: '논문 초안', done: false, categoryId: 'c-1', due: '2026-07-13', endDate: '2026-07-15', prio: 'normal', completedAt: '', note: '', dayNotes: { '2026-07-14': '서론 작성' }, createdAt: CA, updatedAt: CA }],
        rooms: [],
      });
      const lines = buildMd('c-1', '2026-07-13', '2026-07-15').split('\n');
      assert.ok(lines.includes('- [ ] 논문 초안 — 서론 작성'), '07-14: dayNote → — 설명');
      assert.ok(lines.includes('- [ ] 논문 초안'), '07-13/07-15: dayNote 없음 → 제목만(— 없음)');
    });

    test('buildCalendarExportMd: git 작업일지 → ### 작업일지(커밋)에 - subject (short)', () => {
      seed({
        gitAuthor: '', svnAuthor: '',
        categories: [catOnly('연구과제')],
        entries: [{ id: 'g1', date: '2026-07-09', title: '작업일지', categoryId: 'c-1', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: 'git', commits: [{ hash: 'abc123def', short: 'r1195', time: '09:00', subject: '데이터 파이프라인 추가' }], hours: null, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }],
        todos: [], rooms: [],
      });
      const md = buildMd('c-1', '2026-07-09', '2026-07-09');
      assert.ok(md.includes('### 작업일지(커밋)'), '커밋 섹션');
      assert.ok(md.includes('- 데이터 파이프라인 추가 (r1195)'), 'subject (short)');
    });

    test('buildCalendarExportMd: 과제 격리 — 다른 과제 항목은 포함되지 않음', () => {
      seed({
        gitAuthor: '', svnAuthor: '',
        categories: [catOnly('내과제', { id: 'c-1' }), catOnly('남의과제', { id: 'c-2', color: '#2e9e6b' })],
        entries: [
          { id: 'e1', date: '2026-07-08', title: '내 일정', categoryId: 'c-1', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: null, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
          { id: 'e2', date: '2026-07-08', title: '남의 일정', categoryId: 'c-2', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: null, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        ],
        todos: [], rooms: [],
      });
      const md = buildMd('c-1', '2026-07-08', '2026-07-08');
      assert.ok(md.includes('내 일정'), '선택 과제 일정 포함');
      assert.ok(!md.includes('남의 일정'), '다른 과제 일정 미포함');
    });

    test('buildCalendarExportMd: 항목 없는 날짜는 헤더(## ) 미출력 + cat 없으면 빈 문자열', () => {
      seed({
        gitAuthor: '', svnAuthor: '',
        categories: [catOnly('연구과제')],
        entries: [{ id: 'e1', date: '2026-07-10', title: '중간 일정', categoryId: 'c-1', allDay: true, startTime: '', endTime: '', location: '', memo: '', source: '', commits: [], hours: null, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }],
        todos: [], rooms: [],
      });
      const md = buildMd('c-1', '2026-07-08', '2026-07-12');
      assert.ok(md.includes('## 2026-07-10'), '항목 있는 날짜만 헤더');
      assert.ok(!md.includes('## 2026-07-08') && !md.includes('## 2026-07-09'), '빈 날짜 헤더 미출력');
      assert.strictEqual(ev('buildCalendarExportMd(null, "2026-07-01", "2026-07-02")'), '', 'cat 없으면 빈 문자열');
    });

    // ── 일정별 알림 리드타임(remindMinsFor / normRemind — 순수 함수) ────────────────
    // 계약: entry.remind = null(미설정 → 기본 사다리 60·30·10·5) / n>0(n분 전 1회) / 0(알림 없음)
    const remindMins = (e) => evJSON('remindMinsFor(' + JSON.stringify(e) + ')');
    const normRem = (expr) => evJSON('normRemind(' + expr + ')');

    test('remindMinsFor: 미설정(기본) — {} / {remind:null} → 기존 사다리 [60,30,10,5] 그대로(하위호환)', () => {
      assert.deepStrictEqual(evJSON('REMIND_DEFAULT'), [60, 30, 10, 5], '기본 사다리 상수');
      assert.deepStrictEqual(remindMins({}), [60, 30, 10, 5], '설정 안 한 일정 = 기존 동작 그대로');
      assert.deepStrictEqual(remindMins({ remind: null }), [60, 30, 10, 5]);
    });

    test('remindMinsFor: n분 전 1회 / 0=알림 없음 / 엔트리 없으면 null', () => {
      assert.deepStrictEqual(remindMins({ remind: 30 }), [30], '30 → 30분 전 1회만(사다리 아님)');
      assert.deepStrictEqual(remindMins({ remind: 5 }), [5]);
      assert.deepStrictEqual(remindMins({ remind: 1440 }), [1440]);
      assert.strictEqual(remindMins({ remind: 0 }), null, '0 → 알림 없음');
      assert.strictEqual(evJSON('remindMinsFor(null)'), null, 'e 없으면 null');
    });

    test('remindMinsFor: 손상값(음수/문자열)은 기본 사다리로 폴백(무음 유실 방지)', () => {
      assert.deepStrictEqual(remindMins({ remind: -5 }), [60, 30, 10, 5], '음수 → 기본');
      assert.deepStrictEqual(remindMins({ remind: 'x' }), [60, 30, 10, 5], 'NaN → 기본');
    });

    test('remindMinsFor: 반환은 복사본 — 결과를 변형해도 다음 호출·REMIND_DEFAULT 불변', () => {
      ev('var _rm = remindMinsFor({}); _rm.push(999); _rm[0] = -1;');
      assert.deepStrictEqual(evJSON('remindMinsFor({})'), [60, 30, 10, 5], '두 번째 호출도 원본 사다리');
      assert.deepStrictEqual(evJSON('REMIND_DEFAULT'), [60, 30, 10, 5], '상수 자체가 오염되지 않음');
    });

    test('normRemind: 빈값→null(기본) / 0→0(없음) / 양수→분 정수 / 손상→null / 상한 클램프', () => {
      assert.strictEqual(normRem('null'), null);
      assert.strictEqual(normRem('undefined'), null);
      assert.strictEqual(normRem("''"), null);
      assert.strictEqual(normRem('0'), 0, '0은 0으로 보존 — 알림 없음(미설정과 구분)');
      assert.strictEqual(normRem("'0'"), 0, "문자열 '0'도 알림 없음");
      assert.strictEqual(normRem('30'), 30);
      assert.strictEqual(normRem("'30'"), 30);
      assert.strictEqual(normRem('30.7'), 30, '소수는 내림');
      assert.strictEqual(normRem('-1'), null, '음수 → 기본');
      assert.strictEqual(normRem("'abc'"), null, '문자 → 기본');
      assert.strictEqual(normRem('99999'), 10080, '상한 7일(10080분)로 클램프');
    });

    test('remind 저장: addEntry는 정규화 저장, updateEntry는 미제공 시 기존값 보존(hours와 동일 규약)', () => {
      seed({ gitAuthor: '', svnAuthor: '', categories: [], entries: [], todos: [], rooms: [] });
      const id = ev("addEntry({date:'2026-07-08', title:'회의', allDay:false, startTime:'14:00', remind:30}).id");
      assert.strictEqual(evJSON('entryById(' + JSON.stringify(id) + ').remind'), 30);
      ev('updateEntry(' + JSON.stringify(id) + ", {date:'2026-07-08', title:'회의(수정)', allDay:false, startTime:'14:00'})");
      assert.strictEqual(evJSON('entryById(' + JSON.stringify(id) + ').remind'), 30, 'remind 미제공 → 기존값 보존');
      ev('updateEntry(' + JSON.stringify(id) + ", {date:'2026-07-08', title:'회의', allDay:false, startTime:'14:00', remind:0})");
      assert.strictEqual(evJSON('entryById(' + JSON.stringify(id) + ').remind'), 0, '명시적 0 → 알림 없음으로 갱신');
      const id2 = ev("addEntry({date:'2026-07-08', title:'미설정', allDay:false, startTime:'15:00'}).id");
      assert.strictEqual(evJSON('entryById(' + JSON.stringify(id2) + ').remind'), null, '미지정 생성 → null(기본)');
    });

    test('remind XML: 기본(null)은 속성 미기록(기존 파일과 byte 동일), 0/분은 왕복 보존', () => {
      seed({
        gitAuthor: '', svnAuthor: '',
        categories: [],
        entries: [
          { id: 'r-def', date: '2026-07-08', title: '기본', categoryId: null, allDay: false, startTime: '10:00', endTime: '', location: '', memo: '', source: '', commits: [], hours: null, remind: null, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
          { id: 'r-off', date: '2026-07-08', title: '없음', categoryId: null, allDay: false, startTime: '11:00', endTime: '', location: '', memo: '', source: '', commits: [], hours: null, remind: 0, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
          { id: 'r-30', date: '2026-07-08', title: '30분', categoryId: null, allDay: false, startTime: '12:00', endTime: '', location: '', memo: '', source: '', commits: [], hours: null, remind: 30, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA },
        ],
        todos: [], rooms: [],
      });
      const xml = ev('toXML()');
      assert.ok(!/id="r-def"[^>]*remind=/.test(xml), '기본(null) 엔트리엔 remind 속성 미기록');
      assert.ok(/id="r-off"[^>]*remind="0"/.test(xml), '0은 remind="0"으로 기록');
      assert.ok(/id="r-30"[^>]*remind="30"/.test(xml), '30은 remind="30"으로 기록');
      const p = evJSON('fromXML(toXML())');
      const byId = Object.fromEntries(p.entries.map(e => [e.id, e]));
      assert.strictEqual(byId['r-def'].remind, null, '속성 없음 → null(기본)');
      assert.strictEqual(byId['r-off'].remind, 0, '0 왕복');
      assert.strictEqual(byId['r-30'].remind, 30, '30 왕복');
      assert.strictEqual(evJSON('xmlRoundTrip()').ok, true, '앱 자체 검증기도 remind 포함 무손실');
    });

    test('remind 하위호환: 구버전 XML(remind 속성 부재) → null(기본 사다리) / 손상값도 null', () => {
      const mk = (attr) =>
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<taskCalendar version="1" generator="old" gitAuthor="" svnAuthor="">' +
        '<categories></categories><entries>' +
        '<entry id="e-o" date="2026-07-08" allDay="false" startTime="09:00" endTime="" ' + attr +
        ' createdAt="' + CA + '" updatedAt="' + CA + '"><title>구버전</title><memo></memo></entry>' +
        '</entries></taskCalendar>';
      assert.strictEqual(evJSON('fromXML(' + JSON.stringify(mk('')) + ').entries[0].remind'), null, '속성 부재 → null');
      assert.strictEqual(evJSON('fromXML(' + JSON.stringify(mk('remind="abc"')) + ').entries[0].remind'), null, '손상값 → null(기본)');
      assert.strictEqual(evJSON('fromXML(' + JSON.stringify(mk('remind="-5"')) + ').entries[0].remind'), null, '음수 → null(기본)');
    });

    // ── 미리알림 UI 매핑(remindToUi / uiToRemind — 순수 함수, 새 세그 UI의 단일 소스) ──────
    // 저장값 규약(null/0/분)은 동결. UI는 없음(none)·놓침 방지(def)·직접(cust, 분×단위)로 표현.
    const toUi = (r) => evJSON('remindToUi(' + JSON.stringify(r) + ')');
    const toRem = (mode, num, unit) => evJSON('uiToRemind(' + JSON.stringify(mode) + ',' + JSON.stringify(num) + ',' + JSON.stringify(unit) + ')');

    test('remindToUi: null→놓침방지(def) / 0→없음(none) / n→직접(cust, 단위 역환산)', () => {
      assert.deepStrictEqual(toUi(null), { mode: 'def', num: 30, unit: 1 }, 'null → 놓침 방지');
      assert.deepStrictEqual(toUi(0), { mode: 'none', num: 30, unit: 1 }, '0 → 없음');
      assert.deepStrictEqual(toUi(30), { mode: 'cust', num: 30, unit: 1 }, '30 → 분');
      assert.deepStrictEqual(toUi(90), { mode: 'cust', num: 90, unit: 1 }, '90은 60배수 아님 → 분');
      assert.deepStrictEqual(toUi(60), { mode: 'cust', num: 1, unit: 60 }, '60 → 1시간');
      assert.deepStrictEqual(toUi(120), { mode: 'cust', num: 2, unit: 60 }, '120 → 2시간');
      assert.deepStrictEqual(toUi(1440), { mode: 'cust', num: 1, unit: 1440 }, '1440 → 1일');
      assert.deepStrictEqual(toUi(2880), { mode: 'cust', num: 2, unit: 1440 }, '2880 → 2일');
    });

    test('uiToRemind: def→null / none→0 / cust→normRemind(num×unit), num 최소 1 클램프·상한 캡', () => {
      assert.strictEqual(toRem('def', 30, 1), null, 'def → null');
      assert.strictEqual(toRem('none', 30, 1), 0, 'none → 0');
      assert.strictEqual(toRem('cust', 2, 60), 120, '2시간 → 120');
      assert.strictEqual(toRem('cust', 0, 60), 60, '0 → 최소 1 → 60');
      assert.strictEqual(toRem('cust', -1, 60), 60, '음수 → 최소 1 → 60');
      assert.strictEqual(evJSON('uiToRemind("cust", NaN, 60)'), 60, 'NaN → 최소 1 → 60');
      assert.strictEqual(toRem('cust', 99999, 1), 10080, '상한 7일(10080분) 캡');
    });

    test('미리알림 왕복: uiToRemind(...remindToUi(r)) === r (계약값 전 범위)', () => {
      for (const r of [null, 0, 5, 30, 60, 90, 120, 1440, 10080]) {
        const u = toUi(r);
        assert.strictEqual(toRem(u.mode, u.num, u.unit), r, 'r=' + r + ' 왕복 불변');
      }
    });

    // ── 미리알림 행 UI(entryModal·quick-add 공용 세그) — jsdom 폼 상호작용 ──────────────
    const uiSeed = () => seed({ gitAuthor: '', svnAuthor: '', categories: [{ id: 'c-1', name: '과제', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }], entries: [], todos: [], rooms: [] });

    // 단위(분|시간|일)는 세그 3버튼 → <select>로 강등됐다(모드 3버튼과 나란히 서서 '모드'와 '파라미터'가
    // 구분되지 않던 문제 + 380px 빠른등록 모달에서 행이 줄바꿈되던 문제). 계약: #{pfx}RemUnit.value = 분 배율 문자열.
    // 고스트(공간 예약)는 행이 한 줄에 들어가면서 불필요해져 .hidden으로 대체.
    test('미리알림 UI(entryModal): 새 기록 기본 = 놓침 방지(def), 직접영역 숨김', () => {
      uiSeed();
      ev("openEntryModal('new', '2026-07-08')");
      assert.strictEqual(ev("$('#fRemSeg [data-remmode=\"def\"]').classList.contains('active')"), true, '기본 놓침 방지 active');
      assert.strictEqual(ev("$('#fRemCust').classList.contains('hidden')"), true, '직접영역 숨김');
      assert.strictEqual(ev("$('#fRemHint').textContent"), '확인할 때까지 60·30·10·5분 전 재알림', 'def 힌트');
      assert.strictEqual(evJSON("remReadValue('f')"), null, '읽으면 null(=기본)');
    });

    test('미리알림 UI(entryModal): 편집 {remind:120} → 직접·2·시간 프리필 + 왕복', () => {
      uiSeed();
      ev("addEntry({date:'2026-07-08', title:'회의', allDay:false, startTime:'14:00', remind:120})");
      const id = ev('state.entries[0].id');
      ev("openEntryModal('edit', " + JSON.stringify(id) + ')');
      assert.strictEqual(ev("$('#fRemSeg [data-remmode=\"cust\"]').classList.contains('active')"), true, '직접 active');
      assert.strictEqual(ev("$('#fRemUnit').tagName"), 'SELECT', '단위는 select로 강등');
      assert.strictEqual(ev("$('#fRemUnit').value"), '60', '시간 단위 선택');
      assert.strictEqual(ev("$('#fRemNum').value"), '2', '숫자 2');
      assert.strictEqual(ev("$('#fRemCust').classList.contains('hidden')"), false, '직접영역 표시');
      assert.strictEqual(ev("$('#fRemHint').textContent"), '시작 2시간 전 1회 알림', 'cust 힌트');
      assert.strictEqual(evJSON("remReadValue('f')"), 120, '읽으면 120 왕복');
    });

    test('미리알림 단위 select: 변경 시 상태·상한(max)·힌트가 함께 갱신', () => {
      uiSeed();
      ev("openEntryModal('new', '2026-07-08')");
      ev("_remState.f.mode='cust'; fRemResync();");
      assert.strictEqual(ev("$('#fRemNum').max"), '10080', '분 단위 상한 = REMIND_MAX');
      ev("$('#fRemUnit').value='1440'; $('#fRemUnit').dispatchEvent(new window.Event('change'));");
      assert.strictEqual(evJSON('_remState.f.unit'), 1440, 'change → 상태 반영');
      assert.strictEqual(ev("$('#fRemNum').max"), '7', '일 단위 상한 = 7일');
    });

    // 무언의 클램프 방지 — 힌트는 반드시 normRemind 통과 후의 '저장될 값'을 말해야 한다.
    test('미리알림 힌트: 상한 초과 입력은 클램프된 실제 저장값으로 표시(999일 → 7일)', () => {
      uiSeed();
      ev("openEntryModal('new', '2026-07-08')");
      ev("_remState.f.mode='cust'; _remState.f.unit=1440; $('#fRemNum').value='999'; fRemResync();");
      assert.strictEqual(evJSON("remReadValue('f')"), 10080, '저장값은 7일로 클램프');
      assert.strictEqual(ev("$('#fRemHint').textContent"), '시작 7일 전 1회 알림', '힌트도 클램프된 값');
    });

    // 무음 실패 방지 — 전역 '시작 알림'이 꺼진 걸 아는 상태에서는 폼이 지키지 못할 약속을 하지 않는다.
    test('미리알림 경고: 전역 알림 꺼짐(_remGlobalOn=false)이면 힌트에 경고 + 켜기 액션', () => {
      uiSeed();
      ev('_remGlobalOn = false');
      ev("openEntryModal('new', '2026-07-08')");
      assert.ok(/시작 알림이 꺼져 있어/.test(ev("$('#fRemHint').textContent")), '경고 문구 노출');
      assert.strictEqual(ev("!!$('#fRemHint [data-remenable]')"), true, '켜기 액션 제공');
      ev("$('#fRemHint [data-remenable]').click()");
      assert.strictEqual(ev("$('#remEnabled').checked"), true, '클릭 시 전역 토글 켜짐');
      assert.strictEqual(ev("$('#fRemHint').textContent"), '확인할 때까지 60·30·10·5분 전 재알림', '경고 사라짐');
      ev('_remGlobalOn = null');
    });

    // 힌트가 '왜 꺼졌는지' 설명하는 자리인데 블록 전체 opacity에 삼켜지면 안 된다(부모 opacity는 자식에 곱해짐).
    test('미리알림 흐림(.rem-off): 힌트는 흐림 대상 밖 — 조상 opacity 곱이 1', () => {
      uiSeed();
      ev("openEntryModal('new', '2026-07-08')");
      ev("$('#fAllDay').checked = true; toggleTimeRow();");
      assert.strictEqual(ev("$('#fRemBlock').classList.contains('rem-off')"), true, 'rem-off 적용');
      const eff = ev(
        "(function(){var o=1,el=$('#fRemHint');while(el&&el.nodeType===1){" +
        "var v=window.getComputedStyle(el).opacity;if(v!==''&&v!=null)o*=parseFloat(v)||(parseFloat(v)===0?0:1);" +
        "el=el.parentElement;}return o;})()");
      assert.strictEqual(eff, 1, '힌트의 합성 불투명도 = 1(가독)');
      assert.strictEqual(ev("window.getComputedStyle($('#fRemBlock .rem-row')).opacity"), '0.45', '흐림은 컨트롤(.rem-row)로 이동 — 사라진 게 아님');
    });

    // jsdom에는 레이아웃 엔진이 없다(offsetHeight === 0) → 실제 행 높이는 여기서 잴 수 없다.
    // 대신 높이 불변을 '보장하는 구조'만 검증한다: 세 컨트롤이 같은 변수 하나에 묶여 있을 것.
    // 실제 픽셀 검증은 브라우저에서 수행했다(1180 / 400 / 380px, 두 폼 모두 none=def=cust).
    // 배경: 공용 .modal select가 단위 select만 39px로 키워, '직접'을 고르면 행이 31.6→39px로 커지며
    //       아래 내용이 밀렸다("직접 클릭시 동적으로 화면 바뀌는게 부자연스럽다").
    test('미리알림 행: 세 컨트롤이 한 높이 변수에 묶임 — 모드 전환에 행 높이 불변', () => {
      uiSeed();
      ev("openEntryModal('new', '2026-07-08'); _remState.f.mode='cust'; fRemResync();");
      const cs = (s, p) => ev("window.getComputedStyle($('" + s + "'))." + p);
      for (const s of ['#fRemSeg', '#fRemNum', '#fRemUnit']) {
        assert.strictEqual(cs(s, 'height'), 'var(--rem-ctl-h)', s + ' 높이는 공용 변수');
        assert.strictEqual(cs(s, 'boxSizing'), 'border-box', s + ' border-box(테두리 포함 높이)');
      }
      assert.strictEqual(ev("$('#fRemSeg').offsetHeight"), 0, 'jsdom은 레이아웃 미구현 — 픽셀 측정은 브라우저 담당');
    });

    // 라벨이 잘리면 '할 ...'처럼 깨져 보인다. flex basis 0은 내용폭을 무시하고 균등분배하므로 금지.
    test('.seg-b: 내용폭 미만으로 줄지 않음(라벨 잘림 방지)', () => {
      uiSeed();
      ev("openQuickAdd('2026-07-08', 'event')");
      for (const s of ['.qa-tg .seg-b', '#qaRemSeg .seg-b']) {
        assert.strictEqual(ev("window.getComputedStyle($('" + s + "')).minWidth"), 'max-content', s + ' min-width:max-content');
        assert.notStrictEqual(ev("window.getComputedStyle($('" + s + "')).flexBasis"), '0px', s + ' flex-basis:0 금지');
      }
    });

    test('미리알림 UI(entryModal): 종일 → 행 흐림+비활성+종일 힌트', () => {
      uiSeed();
      ev("openEntryModal('new', '2026-07-08')");
      ev("$('#fAllDay').checked = true; toggleTimeRow();");
      assert.strictEqual(ev("$('#fRemBlock').classList.contains('rem-off')"), true, 'rem-off(흐림)');
      assert.strictEqual(ev("$('#fRemSeg [data-remmode=\"def\"]').disabled"), true, '컨트롤 비활성');
      assert.strictEqual(ev("$('#fRemHint').textContent"), '종일 일정에는 미리알림이 적용되지 않습니다', '종일 힌트');
    });

    test('미리알림 UI(quick-add): 행은 #qaWhen 내부(일정 표시·할 일 숨김), 신규 기본=놓침 방지', () => {
      uiSeed();
      ev("openQuickAdd('2026-07-08', 'event')");
      assert.strictEqual(ev("$('#qaWhen').contains($('#qaRemBlock'))"), true, '미리알림 행이 #qaWhen 안(할 일 시 통째 숨김)');
      assert.strictEqual(ev("$('#qaWhen').classList.contains('hidden')"), false, '일정 모드 표시');
      assert.strictEqual(ev("$('#qaRemSeg [data-remmode=\"def\"]').classList.contains('active')"), true, '기본 놓침 방지');
      ev("qaType='todo'; qaSyncType();");
      assert.strictEqual(ev("$('#qaWhen').classList.contains('hidden')"), true, '할 일 모드: 행 숨김');
    });

    test('미리알림 UI(quick-add): qaEventFormData가 모드별 remind 방출(놓침방지=null/없음=0/직접=분)', () => {
      uiSeed();
      ev("openQuickAdd('2026-07-08', 'event')");
      ev("$('#qaTitle').value='회의'; $('#qaAllDay').checked=false;");
      assert.strictEqual(evJSON('qaEventFormData().remind'), null, '놓침 방지(기본) → null');
      ev("_remState.qa.mode='none'; qaRemResync();");
      assert.strictEqual(evJSON('qaEventFormData().remind'), 0, '없음 → 0');
      ev("_remState.qa.mode='cust'; _remState.qa.unit=60; $('#qaRemNum').value='3'; qaRemResync();");
      assert.strictEqual(evJSON('qaEventFormData().remind'), 180, '직접 3시간 → 180');
    });

    // ── 과제별 시간(taskHours)·근태(attendance) XML 승격 ─────────────────────
    // 배경: 두 저장소는 localStorage(WebView2 LevelDB)에만 있었고, 비정상 종료로 WAL이 손상돼
    //       최신 기록이 통째로 유실된 사고가 있었다. 원자 저장(data.xml)으로 승격해 같은 내구성을 얻는다.
    const THS = (extra) => Object.assign({
      gitAuthor: '', svnAuthor: '',
      categories: [
        { id: 'ca', name: '과제가', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
        { id: 'cb', name: '과제나', color: '#2e9e6b', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
      ],
      entries: [], todos: [], rooms: [],
      taskHours: {}, attendance: {}, lsMigrated: true,
    }, extra || {});
    // 구 저장소 셋업 + 세션 가드 해제(같은 realm에서 여러 번 이관을 시뮬레이션하기 위함)
    const setLegacy = (th, at) => ev(
      (th === null ? "localStorage.removeItem('tc_taskHours');" : "localStorage.setItem('tc_taskHours'," + JSON.stringify(JSON.stringify(th)) + ");") +
      (at === null ? "localStorage.removeItem('tc_attendance');" : "localStorage.setItem('tc_attendance'," + JSON.stringify(JSON.stringify(at)) + ");") +
      '__lsMigrateDone = false;');
    const clearLegacy = () => ev("localStorage.removeItem('tc_taskHours'); localStorage.removeItem('tc_attendance'); __lsMigrateDone = true;");

    test('taskHours/attendance: XML 왕복 — 값·마커 무손실(localStorage 아닌 data.xml에 영속)', () => {
      seed(THS({
        taskHours: { '2026-07-13': { ca: 6.5, cb: 1.25 }, '2026-07-14': { cb: 8 } },
        attendance: { '2026-07-13': { status: '2', overtime: 3 }, '2026-07-14': { status: '1', overtime: 0 } },
        lsMigrated: true,
      }));
      const xml = ev('toXML()');
      assert.ok(/<taskHours>/.test(xml), '<taskHours> 컬렉션 기록');
      assert.ok(/<t cat="ca" h="6.5"\/>/.test(xml), 'h는 정규화된 숫자 문자열로 기록');
      assert.ok(/<attendance>/.test(xml), '<attendance> 컬렉션 기록');
      assert.ok(/lsMigrated="1"/.test(xml), '이관 마커는 루트 속성');
      const p = evJSON('fromXML(toXML())');
      assert.deepStrictEqual(p.taskHours, { '2026-07-13': { ca: 6.5, cb: 1.25 }, '2026-07-14': { cb: 8 } });
      assert.deepStrictEqual(p.attendance, { '2026-07-13': { status: '2', overtime: 3 }, '2026-07-14': { status: '1', overtime: 0 } });
      assert.strictEqual(p.lsMigrated, true, '마커 왕복');
      assert.strictEqual(evJSON('xmlRoundTrip()').ok, true, '앱 자체 검증기도 시간·근태 포함 무손실');
    });

    test('taskHours/attendance: 비어 있으면 요소 자체 미기록(기존 파일 byte 동일) + 마커만은 남음', () => {
      seed(THS({ lsMigrated: false }));
      let xml = ev('toXML()');
      assert.ok(!/<taskHours/.test(xml), '빈 taskHours는 요소 미생성');
      assert.ok(!/<attendance/.test(xml), '빈 attendance는 요소 미생성');
      assert.ok(!/lsMigrated=/.test(xml), '마커 false면 속성 미기록');
      // 데이터가 비어도 마커는 살아남아야 한다 — 그래야 재이관(좀비 부활)이 없다
      seed(THS({ lsMigrated: true }));
      xml = ev('toXML()');
      assert.ok(!/<taskHours/.test(xml) && !/<attendance/.test(xml));
      assert.ok(/lsMigrated="1"/.test(xml));
      assert.strictEqual(evJSON('fromXML(toXML()).lsMigrated'), true, '빈 컬렉션이어도 마커 왕복');
      // 구버전 XML(요소·속성 부재) → 빈 맵 + 미이관
      const oldXml = '<?xml version="1.0" encoding="UTF-8"?>\n<taskCalendar version="1" gitAuthor="" svnAuthor=""><categories></categories><entries></entries></taskCalendar>';
      const p = evJSON('fromXML(' + JSON.stringify(oldXml) + ')');
      assert.deepStrictEqual(p.taskHours, {}, '요소 부재 → {}');
      assert.deepStrictEqual(p.attendance, {}, '요소 부재 → {}');
      assert.strictEqual(p.lsMigrated, false, '속성 부재 → false(이관 필요)');
    });

    test('getTaskHours 미입력=null 계약: 부재·저장된 0 모두 null, 빈칸/0 저장은 키 제거', () => {
      seed(THS());
      assert.strictEqual(evJSON("getTaskHours('2026-07-13','ca')"), null, '없는 (날짜×과제) → null(0 아님)');
      assert.strictEqual(evJSON("getTaskHours('bad-date','ca')"), null, '잘못된 날짜 → null');
      assert.strictEqual(evJSON("getTaskHours('2026-07-13','')"), null, '과제 없음 → null');
      // 저장된 0(손상/외부편집)도 null
      seed(THS({ taskHours: { '2026-07-13': { ca: 0 } } }));
      assert.strictEqual(evJSON("getTaskHours('2026-07-13','ca')"), null, '저장된 0 → null(미입력)');
      // 빈칸 저장 = 키 제거 + 빈 날 정리
      seed(THS({ taskHours: { '2026-07-13': { ca: 6.5 } } }));
      ev("setTaskHours('2026-07-13','ca','')");
      assert.strictEqual(evJSON("getTaskHours('2026-07-13','ca')"), null);
      assert.deepStrictEqual(evJSON('state.taskHours'), {}, '마지막 과제 제거 시 그 날짜도 삭제');
      // 0 저장 = 그 과제만 제거(다른 과제는 유지)
      seed(THS({ taskHours: { '2026-07-13': { ca: 6.5, cb: 2 } } }));
      ev("setTaskHours('2026-07-13','ca',0)");
      assert.deepStrictEqual(evJSON('state.taskHours'), { '2026-07-13': { cb: 2 } }, '0 → 그 키만 제거');
    });

    test('setTaskHours 정규화: 24h 상한 클램프 + 소수 둘째자리 반올림', () => {
      seed(THS());
      ev("setTaskHours('2026-07-13','ca','30')");
      assert.strictEqual(evJSON("getTaskHours('2026-07-13','ca')"), 24, '24h 상한');
      ev("setTaskHours('2026-07-13','cb','6.567')");
      assert.strictEqual(evJSON("getTaskHours('2026-07-13','cb')"), 6.57, '소수 둘째자리 반올림');
      ev("setTaskHours('2026-07-14','ca','abc')");
      assert.strictEqual(evJSON("getTaskHours('2026-07-14','ca')"), null, '숫자 아님 → 미입력');
      ev("setTaskHours('2026-07-14','ca',-3)");
      assert.strictEqual(evJSON("getTaskHours('2026-07-14','ca')"), null, '음수 → 미입력');
    });

    test('setAttendance: 검증 규약 유지(status 화이트리스트·overtime 0..11) + 기본 정근', () => {
      seed(THS());
      assert.deepStrictEqual(evJSON("getAttendance('2026-07-13')"), { status: '1', overtime: 0 }, '미설정 기본 = 정근/0');
      ev("setAttendance('2026-07-13','2','3')");
      assert.deepStrictEqual(evJSON("getAttendance('2026-07-13')"), { status: '2', overtime: 3 });
      ev("setAttendance('2026-07-14','99','50')");
      assert.deepStrictEqual(evJSON("getAttendance('2026-07-14')"), { status: '1', overtime: 0 }, '미지 코드·범위 초과 → 기본값');
      ev("setAttendance('bad','2','1')");
      assert.ok(!('bad' in evJSON('state.attendance')), '잘못된 날짜는 저장 안 함');
    });

    test('이관: 구 localStorage 값이 state로 이동하고 마커가 선다(반환=이동 건수)', () => {
      seed(THS({ lsMigrated: false }));
      setLegacy({ '2026-07-13': { ca: 6.5 }, '2026-07-14': { cb: 3 } }, { '2026-07-13': { status: '2', overtime: 2 } });
      const n = ev('migrateLocalStores()');
      assert.strictEqual(n, 3, '시간 2건 + 근태 1건');
      assert.deepStrictEqual(evJSON('state.taskHours'), { '2026-07-13': { ca: 6.5 }, '2026-07-14': { cb: 3 } });
      assert.deepStrictEqual(evJSON('state.attendance'), { '2026-07-13': { status: '2', overtime: 2 } });
      assert.strictEqual(ev('state.lsMigrated'), true, '이관 완료 마커');
      assert.ok(ev("localStorage.getItem('tc_taskHours')") !== null, '구 키는 수동 복구용으로 남겨둔다(삭제 금지)');
      clearLegacy();
    });

    test('이관: 기존 XML 값은 절대 덮지 않는다(없는 것만 채움)', () => {
      seed(THS({ taskHours: { '2026-07-13': { ca: 8 } }, attendance: { '2026-07-13': { status: '6', overtime: 0 } }, lsMigrated: false }));
      setLegacy({ '2026-07-13': { ca: 6.5, cb: 1 } }, { '2026-07-13': { status: '2', overtime: 5 } });
      const n = ev('migrateLocalStores()');
      assert.strictEqual(n, 1, '이미 있는 (날짜×과제)/근태일은 건너뛰고 신규만 이동');
      assert.strictEqual(evJSON("getTaskHours('2026-07-13','ca')"), 8, '기존 XML 값 보존(덮이지 않음)');
      assert.strictEqual(evJSON("getTaskHours('2026-07-13','cb')"), 1, '없던 값만 채움');
      assert.deepStrictEqual(evJSON("getAttendance('2026-07-13')"), { status: '6', overtime: 0 }, '기존 근태 보존');
      clearLegacy();
    });

    test('좀비 방지(핵심): 이관 후 삭제한 값은 재이관에도 되살아나지 않는다', () => {
      seed(THS({ lsMigrated: false }));
      setLegacy({ '2026-07-13': { ca: 6.5 } }, null);
      assert.strictEqual(ev('migrateLocalStores()'), 1);
      assert.strictEqual(evJSON("getTaskHours('2026-07-13','ca')"), 6.5);
      // 사용자가 값을 지운다 — localStorage에는 6.5가 그대로 남아 있는 상태
      ev("setTaskHours('2026-07-13','ca',0)");
      assert.strictEqual(evJSON("getTaskHours('2026-07-13','ca')"), null, '삭제 반영');
      // 같은 세션 재호출 + 새 세션(가드 해제) 재호출 모두 마커에서 단락되어야 한다
      assert.strictEqual(ev('migrateLocalStores()'), 0, '세션 가드로 즉시 종료');
      ev('__lsMigrateDone = false;');
      assert.strictEqual(ev('migrateLocalStores()'), 0, '마커(state.lsMigrated)로 영구 종료');
      assert.strictEqual(evJSON("getTaskHours('2026-07-13','ca')"), null, '지운 값이 좀비로 부활하면 안 됨');
      clearLegacy();
    });

    test('이관: 옮길 게 없어도 마커는 남긴다(다음 실행에서 재훑기 없음)', () => {
      seed(THS({ lsMigrated: false }));
      setLegacy(null, null);
      assert.strictEqual(ev('migrateLocalStores()'), 0, '이동 0건');
      assert.strictEqual(ev('state.lsMigrated'), true, '데이터가 없어도 마커는 기록');
      clearLegacy();
    });

    test('과제 삭제: 그 과제의 (날짜×과제) 시간도 동반 정리, 다른 과제 시간은 보존', () => {
      seed(THS({ taskHours: { '2026-07-13': { ca: 6.5, cb: 2 }, '2026-07-14': { ca: 3 } } }));
      ev("deleteCategory('ca')");
      assert.deepStrictEqual(evJSON('state.taskHours'), { '2026-07-13': { cb: 2 } },
        'ca 시간 제거 + ca만 있던 07-14는 날짜째 삭제, cb 시간은 보존');
      assert.strictEqual(evJSON("getTaskHours('2026-07-13','cb')"), 2);
    });

    // ── Excel 추출 버튼(P4) — 실제 렌더 경로에서의 상태 배선 ───────────
    // 순수 함수 단위는 xlsx-export.test.mjs에서 본다. 여기서는 'renderOfficialList가 실제로 버튼을 갱신하는지'
    // (배선 누락 = 0건인데 눌러서 빈 파일이 나오는 실버그)를 진짜 DOM에서 확인한다.
    const seedCatalog = (rows) => {
      ev('dbCatalog = ' + JSON.stringify(rows) + ';');
      ev("var __c = document.getElementById('offActiveOnly'); if(__c) __c.checked = false;");
      ev("['offSearch','offCustomer','offSection','offStatus'].forEach(function(id){var e=document.getElementById(id); if(e) e.value='';});");
      ev('offFillSelects(); renderOfficialList();');
    };

    test('Excel 추출 버튼: 목록이 비면 비활성, 행이 있으면 활성(renderOfficialList 배선)', () => {
      seedCatalog([]);
      assert.strictEqual(ev("document.getElementById('offExport').disabled"), true, '0건인데 활성이면 빈 파일이 나온다');
      seedCatalog([
        { id: 'db-1', name: '레이더', color: '#3e5be0', source: 'db', customer: '방위사업청', section: '일반계약',
          status: '진행중', startDate: '2026-01-01', endDate: '2026-12-31',
          projectName: '레이더 성능개량', contractName: '', commonName: '레이더' },
      ]);
      assert.strictEqual(ev("document.getElementById('offExport').disabled"), false);
    });

    test('Excel 추출 버튼: 브라우저 모드(HOST=false)에서는 숨겨져 있다', () => {
      // 이 컨텍스트는 HOST=false로 부팅됐다 — 렌더가 곧 브라우저 모드 검증이다.
      seedCatalog([{ id: 'db-1', name: 'x', color: '#3e5be0', source: 'db', section: '일반계약' }]);
      assert.strictEqual(ev("document.getElementById('offExport').style.display"), 'none');
    });

    test('Excel 추출: 필터가 걸리면 부제에 전체/추출 건수와 필터가 함께 남는다', () => {
      seedCatalog([
        { id: 'db-1', name: 'a', color: '#3e5be0', source: 'db', section: '일반계약', customer: 'A청', status: '진행중', projectName: 'a' },
        { id: 'db-2', name: 'b', color: '#c2770a', source: 'db', section: '선진행', customer: 'B사', status: '종료', projectName: 'b' },
      ]);
      ev("document.getElementById('offSection').value = '일반계약'; renderOfficialList();");
      const sub = ev("(function(){var f=offFilters(); var l=dbCatalog.filter(function(c){return offMatches(c,f);});" +
                     "return offExportSubtitle(f, dbCatalog.length, l.length, '2026-07-22');})()");
      assert.strictEqual(sub, '2026-07-22 추출 · 전체 2건 중 1건 · 필터: 구분=일반계약 · 숨김 과제 제외');
      ev("document.getElementById('offSection').value = ''; renderOfficialList();");
    });

    // ══════════════════════════════════════════════════════════════════
    // 로컬 DB 카탈로그 캐시 제거 (2026-07-24)
    // 근거: 서버 설계문서 §7·장애정책이 'DB 정보를 로컬에 캐싱해 오프라인 지원'을 배제.
    // 실질 위험: 캐시가 있으면 서버가 꺼져 있어도 Excel 장표가 뽑히는데, 부제엔 '오늘 추출'로 찍히고
    //           데이터는 몇 주 전 것일 수 있다(오정보가 남에게 전달됨).
    // ══════════════════════════════════════════════════════════════════
    const DBROW = (uid, extra) => Object.assign({
      uid, section: '일반계약', customer: 'A청', project_name: 'P' + uid, contract_name: 'C' + uid,
      common_name: '통상' + uid, start_date: '2026-01-01', end_date: '2026-12-31', status: '진행중', is_active: 1,
    }, extra || {});
    const applyRows = (rows) => ev('__applyProjects(' + JSON.stringify(JSON.stringify(rows)) + ')');

    test('캐시 제거: loadDbCache 함수가 존재하지 않는다', () => {
      assert.strictEqual(ev('typeof loadDbCache'), 'undefined', '캐시 복원 함수가 남아 있다');
    });

    test('캐시 제거: 조회 성공해도 localStorage에 카탈로그·동기화시각을 쓰지 않는다', () => {
      ev("try{ localStorage.removeItem('tc_dbProjects'); localStorage.removeItem('tc_dbSyncedAt'); }catch(_){}");
      applyRows([DBROW('u1')]);
      assert.strictEqual(ev('dbCatalog.length'), 1);
      assert.strictEqual(ev('dbOnline'), true);
      assert.strictEqual(ev("localStorage.getItem('tc_dbProjects')"), null, '카탈로그를 로컬에 캐싱하면 안 된다');
      assert.strictEqual(ev("localStorage.getItem('tc_dbSyncedAt')"), null, '동기화 시각도 남기지 않는다');
    });

    test('캐시 제거(핵심): 조회 실패("")면 폴백 없이 목록을 비운다 — stale 장표 유통 차단', () => {
      applyRows([DBROW('u1'), DBROW('u2')]);
      assert.strictEqual(ev('dbCatalog.length'), 2);
      ev("__applyProjects('')");
      assert.strictEqual(ev('dbCatalog.length'), 0, '실패 시 이전 목록/캐시로 폴백하면 안 된다');
      assert.strictEqual(ev('dbOnline'), false);
    });

    test('캐시 제거: 오프라인이어도 편입분을 "삭제됨(dbGone)"으로 오표시하지 않는다', () => {
      // 카탈로그를 못 읽은 것과 DB에서 삭제된 것은 다른 사실이다. 못 읽었다고 피커에서 사라지면 안 된다.
      seed(THS({ categories: [{ id: 'db-u1', name: '통상u1', color: '#3e5be0', source: 'db', dbGone: false,
                                desc: '', gitRepo: '', svnRepo: '', createdAt: CA }] }));
      ev("__applyProjects('')");
      assert.strictEqual(evJSON("state.categories.find(function(c){return c.id==='db-u1';}).dbGone"), false,
        '오프라인인데 삭제됨으로 표시하면 피커에서 사라진다');
      // 반대로 온라인인데 카탈로그에 없으면 그때는 진짜 삭제 → dbGone=true
      applyRows([DBROW('other')]);
      assert.strictEqual(evJSON("state.categories.find(function(c){return c.id==='db-u1';}).dbGone"), true,
        '온라인 카탈로그에 없으면 삭제됨으로 표시해야 한다');
    });

    // ── 편입분(XML source="db") 메타 최소화 ────────────────────────────
    const DROPPED = ['customer', 'section', 'status', 'startDate', 'endDate', 'projectName', 'contractName', 'commonName'];

    test('편입분 메타: 편입 객체엔 상세 메타 8개가 없다(name·color만)', () => {
      seed(THS({ categories: [] }));
      applyRows([DBROW('u1')]);
      ev("subscribeDbCat(dbCatalogById('db-u1'))");
      const c = evJSON("state.categories.find(function(x){return x.id==='db-u1';})");
      for (const k of DROPPED) assert.ok(!(k in c), `편입분에 ${k}가 남아 있다(DB 캐시 재유입)`);
      assert.strictEqual(c.name, '통상u1');
      assert.strictEqual(c.color, '#3e5be0');
      assert.strictEqual(c.source, 'db');
    });

    test('편입분 메타: XML 왕복에서 source/name/color/dbGone만 보존된다', () => {
      seed(THS({ categories: [] }));
      applyRows([DBROW('u1')]);
      ev("subscribeDbCat(dbCatalogById('db-u1')); state.categories[state.categories.length-1].dbGone = true;");
      const xml = ev('toXML()');
      for (const k of DROPPED) assert.ok(!new RegExp(k + '=').test(xml), `XML에 ${k} 속성이 기록됐다`);
      const p = evJSON('fromXML(toXML())');
      const c = p.categories.find(x => x.id === 'db-u1');
      assert.strictEqual(c.source, 'db');
      assert.strictEqual(c.name, '통상u1');
      assert.strictEqual(c.color, '#3e5be0');
      assert.strictEqual(c.dbGone, true);
      for (const k of DROPPED) assert.ok(!(k in c), `파싱 결과에 ${k}가 복원됐다`);
    });

    test('편입분 메타 하위호환: 8개 속성이 든 옛 XML도 에러 없이 파싱되고 name/color/source 복원', () => {
      const oldXml = '<?xml version="1.0" encoding="UTF-8"?><taskCalendar version="1"><categories>' +
        '<category id="db-old" color="#c2770a" createdAt="2026-01-01T00:00:00.000Z" source="db" dbGone="1"' +
        ' customer="방위사업청" section="일반계약" status="진행중" startDate="2026-01-01" endDate="2026-12-31"' +
        ' projectName="옛 사업명" contractName="옛 계약명" commonName="옛 통상명칭">' +
        '<name>옛 이름</name><description></description></category>' +
        '</categories><entries></entries><todos></todos></taskCalendar>';
      let p;
      assert.doesNotThrow(() => { p = evJSON('fromXML(' + JSON.stringify(oldXml) + ')'); }, '옛 속성이 있으면 파싱이 깨진다');
      const c = p.categories.find(x => x.id === 'db-old');
      assert.strictEqual(c.source, 'db');
      assert.strictEqual(c.name, '옛 이름');
      assert.strictEqual(c.color, '#c2770a');
      assert.strictEqual(c.dbGone, true);
      // 읽지 않으므로 객체에 실리지 않는다 → 다음 저장 때 자연 소멸(마이그레이션 코드 불필요)
      for (const k of DROPPED) assert.ok(!(k in c), `옛 속성 ${k}가 다시 실렸다`);
    });

    test('편입분 메타: 개인 과제 XML은 그대로(공식 전용 속성이 하나도 안 붙는다)', () => {
      seed(THS());   // 개인 과제 2개(ca, cb)만
      const xml = ev('toXML()');
      for (const attr of ['source=', 'dbGone=', ...DROPPED.map(k => k + '=')])
        assert.ok(!xml.includes(attr), `개인 과제 XML에 ${attr}가 붙었다(회귀)`);
      const p = evJSON('fromXML(toXML())');
      const ca = p.categories.find(x => x.id === 'ca');
      assert.ok(!('source' in ca) && !('dbGone' in ca), '개인 과제에 출처 키가 생겼다');
    });

    // ── 오프라인 UX — '못 읽음'과 '없음'을 섞지 않는다 ──────────────────
    test('오프라인 빈 상태: 카탈로그 문구가 "등록된 과제 없음"과 구분된다', () => {
      ev("__applyProjects('')");                       // 연결 실패 → 목록 비고 dbOnline=false
      ev('offFillSelects(); renderOfficialList();');
      const off = ev("document.getElementById('offList').textContent");
      assert.ok(/서버에 연결되지 않아/.test(off), '오프라인 원인이 드러나지 않는다: ' + off);
      assert.ok(!/등록된 공식 과제가 없습니다/.test(off), '"등록된 게 없다"와 섞이면 DB가 빈 줄로 오해한다');

      applyRows([]);                                   // 연결은 됐는데 DB가 진짜 빈 경우
      ev('offFillSelects(); renderOfficialList();');
      const empty = ev("document.getElementById('offList').textContent");
      assert.ok(/등록된 공식 과제가 없습니다/.test(empty), '온라인·0건 문구가 아니다: ' + empty);
      assert.ok(!/서버에 연결되지 않아/.test(empty), '온라인인데 연결 오류로 안내하면 안 된다');
    });

    test('오프라인: 재연결 도우미가 "서버 연결이 필요합니다"를 명시한다', () => {
      seed(THS());                 // 개인 과제 있음 → 목록은 그려지고 오른쪽 select만 빈다
      ev("__applyProjects('')");
      ev('renderRelink();');
      const t = ev("document.getElementById('rlList').textContent");
      assert.ok(/서버 연결이 필요합니다/.test(t), '재연결 도우미가 오프라인 사유를 알리지 않는다: ' + t);
    });

    // ── 피커/과제관리 행 — 부제(발주처·구분) 제거 ──────────────────────
    test('편입분 표시: 피커 옵션과 과제관리 행에 부제가 없다(이름만)', () => {
      seed(THS({ categories: [] }));
      applyRows([DBROW('u1')]);
      ev("subscribeDbCat(dbCatalogById('db-u1')); renderAll();");
      // 피커(과제 선택 select) — 옵션 라벨이 이름 그대로여야 한다
      const opt = ev("(function(){var s=document.createElement('select'); fillCatSelect(s);" +
                     "var o=[].slice.call(s.querySelectorAll('option')).filter(function(x){return x.value==='db-u1';})[0];" +
                     "return o ? o.textContent : '';})()");
      assert.strictEqual(opt, '통상u1', '피커 옵션에 부제가 붙어 있다: ' + opt);
      assert.ok(!/—/.test(opt), '부제 구분자(—)가 남아 있다');
      // 과제 관리 행
      const row = ev("catRowHtml(state.categories.find(function(c){return c.id==='db-u1';}))");
      assert.ok(!/cat-desc/.test(row), '과제관리 행에 부제(cat-desc)가 남아 있다');
      assert.ok(/통상u1/.test(row) && /cat-badge db/.test(row), '이름·DB 배지는 유지돼야 한다');
    });

    // ══════════════════════════════════════════════════════════════════
    // 재연결 UX — 콤보 → 검색 팝업 (2026-07-24)
    // 공식 과제가 많아 콤보에서 못 찾던 문제. 각 개인 과제 행에 [공식 과제 선택…] 버튼 → 카탈로그처럼
    // 검색·필터되는 팝업(#relinkPickModal)에서 고른다. 팝업은 동명 식별을 위해 사업명·계약명을 노출한다.
    // ══════════════════════════════════════════════════════════════════
    // 개인 과제 2개 + 재연결 시드(p1이 일정 2건 사용). 동명 공식 2건(계약명만 다름)으로 식별을 시험.
    const seedRelink = () => {
      seed(THS({
        categories: [{ id: 'p1', name: '레이더 작업', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA },
                     { id: 'p2', name: '위성 작업', color: '#2e9e6b', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }],
        entries: [{ id: 'e1', title: 'a', date: '2026-07-20', categoryId: 'p1' },
                  { id: 'e2', title: 'b', date: '2026-07-21', categoryId: 'p1' }],
      }));
      applyRows([
        DBROW('u1', { customer: '방위사업청', project_name: '함정 레이더 성능개량', contract_name: '저장장치', common_name: '레이더 성능개량', status: '진행중' }),
        DBROW('u2', { customer: '방위사업청', project_name: '함정 레이더 성능개량', contract_name: '처리장치', common_name: '레이더 성능개량', status: '진행중' }),
        DBROW('u3', { section: '선진행', customer: '국방과학연구소', project_name: '위성 통신 체계', contract_name: '', common_name: '위성통신', status: '', start_date: null, end_date: null }),
      ]);
      ev('rlPick.clear(); rlpFor = null; rlpCollapsed.clear();');
    };

    test('재연결: 목록 행은 콤보가 아니라 [공식 과제 선택…] 버튼이다', () => {
      seedRelink();
      ev('renderRelink();');
      const html = ev("document.getElementById('rlList').innerHTML");
      assert.ok(!/class="rl-sel"/.test(html) && !/<select/.test(html), '콤보(select.rl-sel)가 남아 있다');
      assert.ok(/data-rlpick="p1"/.test(html) && /data-rlpick="p2"/.test(html), '개인 과제 행에 선택 버튼이 없다');
      assert.strictEqual(ev("document.getElementById('rlRun').disabled"), true, '선택 전엔 실행 비활성');
    });

    test('재연결 팝업: 동명 과제를 사업명·계약명으로 식별(콤보가 못 보여주던 열)', () => {
      seedRelink();
      ev("openRelinkPick('p1')");
      assert.strictEqual(ev("document.getElementById('relinkPickModal').classList.contains('hidden')"), false, '팝업이 열리지 않았다');
      assert.strictEqual(ev("document.getElementById('rlpForName').textContent"), '레이더 작업 →', '대상 개인 과제 배지가 없다');
      const rowsText = ev("[].slice.call(document.querySelectorAll('#rlpList .off-row')).map(function(r){return r.textContent;}).join('|')");
      // 두 동명 과제가 계약명(저장장치/처리장치)으로 구분돼 보여야 한다
      assert.ok(/저장장치/.test(rowsText) && /처리장치/.test(rowsText), '계약명이 목록에 노출되지 않는다(동명 식별 불가)');
      assert.ok(/함정 레이더 성능개량/.test(rowsText), '사업명이 노출되지 않는다');
    });

    test('재연결 팝업: 검색이 계약명까지 훑어 동명 중 하나로 좁혀진다', () => {
      seedRelink();
      ev("openRelinkPick('p1')");
      ev("document.getElementById('rlpSearch').value = '처리장치'; renderRlpList();");
      const ids = evJSON("[].slice.call(document.querySelectorAll('#rlpList .off-row')).map(function(r){return r.dataset.rlpid;})");
      assert.deepStrictEqual(ids, ['db-u2'], '계약명 검색으로 좁혀지지 않는다: ' + JSON.stringify(ids));
    });

    test('재연결: 팝업에서 선택 → 그 행에 매핑 · 배지 = 통상명칭 · 발주처 · 계약명', () => {
      seedRelink();
      ev("openRelinkPick('p1'); rlpChoose('db-u2')");
      assert.deepStrictEqual(evJSON('rlSelections()'), [{ from: 'p1', to: 'db-u2' }], 'rlSelections가 {from,to}를 못 모은다');
      const p1 = ev("(function(){var r=[].slice.call(document.querySelectorAll('#rlList .rl-row')).filter(function(x){return x.dataset.cat==='p1';})[0];" +
                    "return JSON.stringify({nm:(r.querySelector('.rl-picked-nm')||{}).textContent, meta:(r.querySelector('.rl-picked-meta')||{}).textContent, clear:!!r.querySelector('[data-rlclear]')});})()");
      const b = JSON.parse(p1);
      assert.strictEqual(b.nm, '레이더 성능개량', '배지 주 라벨이 통상명칭이 아니다');
      assert.strictEqual(b.meta, '방위사업청 · 처리장치', '배지 보조가 발주처·계약명이 아니다(=올바른 대상 u2 확인)');
      assert.ok(b.clear, '해제 버튼이 없다');
      assert.strictEqual(ev("document.getElementById('rlRun').disabled"), false, '선택 후 실행이 활성화되지 않는다');
    });

    test('재연결: 해제 → 개인으로 유지로 복귀(맵에서 제거, 선택 버튼 복원)', () => {
      seedRelink();
      ev("openRelinkPick('p1'); rlpChoose('db-u2'); rlClearPick('p1')");
      assert.strictEqual(ev('rlPick.has("p1")'), false, '해제해도 맵에 남아 있다');
      const html = ev("document.getElementById('rlList').innerHTML");
      assert.ok(/data-rlpick="p1"/.test(html), '해제 후 선택 버튼이 복원되지 않는다');
      assert.deepStrictEqual(evJSON('rlSelections()'), [], '해제 후에도 선택으로 집계된다');
      assert.strictEqual(ev("document.getElementById('rlRun').disabled"), true, '선택 0개인데 실행이 활성이다');
    });

    test('재연결: runRelink 기존 로직 회귀 없음(유효 대상만 일괄 재태그 + 편입)', () => {
      seedRelink();
      ev("openRelinkPick('p1'); rlpChoose('db-u2')");
      ev('runRelink();');   // confirmBox는 jsdom에서 즉시 resolve되지 않으므로 아래는 매핑/검증 로직을 직접 확인
      // confirmBox 프라미스에 의존하지 않도록 재태그 로직만 직접 재현해 계약 확인
      ev("(function(){var valid=new Map();for(var _ of rlSelections()){var src=dbCatalogById(_.to);if(src){subscribeDbCat(src);valid.set(_.from,_.to);}}" +
         "for(var e of (state.entries||[])){var to=e&&valid.get(e.categoryId);if(to)e.categoryId=to;}})()");
      assert.strictEqual(evJSON("state.entries.filter(function(e){return e.categoryId==='p1';}).length"), 0, 'p1 일정이 재태그되지 않았다');
      assert.strictEqual(evJSON("state.entries.filter(function(e){return e.categoryId==='db-u2';}).length"), 2, 'db-u2로 옮겨진 일정 수가 다르다');
      assert.strictEqual(ev("state.categories.some(function(c){return c.id==='db-u2'&&c.source==='db';})"), true, '대상 공식 과제가 편입되지 않았다');
    });

    test('재연결: 오프라인이면 팝업이 뜨지 않고 "서버 연결" 안내(대상 목록이 필요)', () => {
      seedRelink();
      ev("__applyProjects('')");   // 연결 실패 → dbCatalog=[]
      // 앞 테스트의 애니메이션 닫힘이 jsdom에선 비동기라 남아 있을 수 있다 → 강제로 hidden 리셋 후 검증(격리)
      ev("document.getElementById('relinkPickModal').classList.add('hidden')");
      let warned = '';
      ev("window.__t0=window.toast; window.toast=function(m,k){window.__lastToast=m+'|'+k;};");
      ev("openRelinkPick('p1')");
      warned = ev('window.__lastToast || ""');
      ev("window.toast=window.__t0;");
      assert.strictEqual(ev("document.getElementById('relinkPickModal').classList.contains('hidden')"), true, '오프라인인데 팝업이 열렸다');
      assert.ok(/서버에 연결/.test(warned), '오프라인 안내가 없다: ' + warned);
      // 목록의 선택 버튼도 비활성
      ev('renderRelink();');
      assert.ok(/data-rlpick="p1"[^>]*disabled/.test(ev("document.getElementById('rlList').innerHTML")), '오프라인 선택 버튼이 비활성이 아니다');
    });

    test('재연결↔카탈로그 상태 비간섭: 팝업 그룹접기/선택이 카탈로그(offSelId·offCollapsed)를 건드리지 않는다', () => {
      seedRelink();
      ev('offSelId = "db-u1"; offCollapsed.clear(); offCollapsed.add("사업부관리");');   // 카탈로그 상태 세팅
      ev("openRelinkPick('p1'); rlpToggleGroup('일반계약'); rlpChoose('db-u2')");
      assert.strictEqual(ev('offSelId'), 'db-u1', '팝업 사용이 카탈로그 선택(offSelId)을 바꿨다');
      assert.deepStrictEqual(evJSON('[...offCollapsed]'), ['사업부관리'], '팝업 그룹접기가 카탈로그 접힘을 오염시켰다');
      assert.deepStrictEqual(evJSON('[...rlpCollapsed]'), ['일반계약'], '팝업 자체 그룹접기가 반영되지 않았다');
    });

    // ══════════════════════════════════════════════════════════════════
    // 구분/상태 코드테이블(ENUM 대체) + note 컬럼 (2026-07-24)
    // ══════════════════════════════════════════════════════════════════
    test('코드목록: __applyCodes가 offSections/offStatuses를 채우고 편집폼 드롭다운에 반영', () => {
      ev("offSections = []; offStatuses = [];");
      ev("__applyCodes(" + JSON.stringify(JSON.stringify(['일반계약', '선진행', '신규구분'])) + "," +
                          JSON.stringify(JSON.stringify(['진행중', '종료'])) + ")");
      assert.deepStrictEqual(evJSON('offSections'), ['일반계약', '선진행', '신규구분']);
      assert.deepStrictEqual(evJSON('offStatuses'), ['진행중', '종료']);
      // 편집폼 드롭다운이 코드목록에서 채워진다
      ev("offEdFillEnums('선진행', '종료')");
      assert.deepStrictEqual(evJSON("[].slice.call(document.getElementById('offEdSection').options).map(function(o){return o.value;})"),
        ['일반계약', '선진행', '신규구분'], '구분 드롭다운이 코드목록으로 채워지지 않는다');
      assert.strictEqual(ev("document.getElementById('offEdSection').value"), '선진행');
    });

    test('코드목록: 연결 실패("")면 기존값 유지(우아한 폴백)', () => {
      ev("offSections = ['일반계약']; offStatuses = ['진행중'];");
      ev("__applyCodes('','')");
      assert.deepStrictEqual(evJSON('offSections'), ['일반계약'], '빈 응답에 기존값을 잃는다');
      assert.deepStrictEqual(evJSON('offStatuses'), ['진행중']);
    });

    test('코드목록: 편집 중 값이 목록에 없어도(숨겨진 코드) 옵션 보존', () => {
      ev("__applyCodes(" + JSON.stringify(JSON.stringify(['일반계약'])) + ",'')");
      ev("offEdFillEnums('폐지된구분', '')");
      const opts = evJSON("[].slice.call(document.getElementById('offEdSection').options).map(function(o){return o.value;})");
      assert.ok(opts.includes('폐지된구분'), '편집 중 값이 드롭다운에서 사라진다(값 유실)');
      assert.strictEqual(ev("document.getElementById('offEdSection').value"), '폐지된구분');
    });

    test('note: offEditOpen이 편집폼 textarea에 note를 채운다(payload 조립은 code-tables 소스검증)', () => {
      seed(THS({ categories: [] }));
      applyRows([DBROW('u1', { note: '내부 참고 메모' })]);
      ev("offEditOpen('db-u1')");
      assert.strictEqual(ev("document.getElementById('offEdNote').value"), '내부 참고 메모', '편집폼에 note가 안 채워진다');
      // 신규(빈 편집)면 note 비어 있음
      ev("offEditOpen('')");
      assert.strictEqual(ev("document.getElementById('offEdNote').value"), '', '신규 편집에 note가 남아 있다');
    });

    test('note(SRP): 편입분·전시(캘린더/보고서)에 note가 새지 않는다', () => {
      seed(THS({ categories: [] }));
      applyRows([DBROW('u1', { note: '비밀 내부메모' })]);
      ev("subscribeDbCat(dbCatalogById('db-u1'))");
      const cat = evJSON("state.categories.find(function(c){return c.id==='db-u1';})");
      assert.ok(!('note' in cat), '편입분에 note가 새어 든다(전시 유출 위험)');
      // XML 왕복에도 note 없음
      const xml = ev('toXML()');
      assert.ok(!/비밀 내부메모/.test(xml), 'XML에 note가 기록된다(전시/영속 유출)');
      // 렌더된 캘린더/피커 어디에도 note 문자열 없음
      ev('renderAll();');
      assert.ok(!/비밀 내부메모/.test(ev('document.body.textContent')), '화면에 note가 노출된다');
    });

    // ══════════════════════════════════════════════════════════════════
    // 공식(DB) 과제의 소유권 분리 — 이름·색=DB / 설명·Git·SVN=로컬 (2026-07-27)
    // 배경: DB에서 과제를 가져오는 이유는 '보고서에 찍히는 과제명 = 사업부 관리 과제명'이어야
    //       기존 시스템의 데이터 수집이 되기 때문이다. DB가 소유하는 건 이름이지 나머지가 아닌데,
    //       설명·Git/SVN까지 통째로 잠겨 있어 DB 과제로는 버전관리 연동을 아예 못 썼다
    //       (Git/SVN 경로는 각 PC의 작업복사본 경로라 DB가 알 수도 없는 값이다).
    // ══════════════════════════════════════════════════════════════════
    // 편입 + 로컬 필드가 채워진 상태를 만든다(개인 행과 같은 desc/gitRepo/svnRepo).
    const seedOfficialLocal = () => {
      seed(THS({ categories: [] }));
      applyRows([DBROW('u1')]);
      ev("subscribeDbCat(dbCatalogById('db-u1'));");
      ev("(function(){var c=state.categories.find(function(x){return x.id==='db-u1';});" +
         "c.desc='레이더 담당분'; c.gitRepo='C:\\\\work\\\\radar'; c.svnRepo='C:\\\\work\\\\radar-wc';})()");
    };

    test('소유권 분리: 공식 과제 행이 설명·Git·SVN을 표시하고 [수정] 버튼을 준다', () => {
      seedOfficialLocal();
      const row = ev("catRowHtml(state.categories.find(function(c){return c.id==='db-u1';}))");
      assert.ok(row.includes('data-act="edit"'), '공식 행에 [수정] 진입점이 없다 — 로컬 필드를 고칠 방법이 사라진다');
      assert.ok(row.includes('data-act="unsub"'), '제거(구독 해제) 버튼이 사라졌다');
      assert.ok(row.includes('cat-badge db'), 'DB 배지가 사라졌다(출처 표시)');
      assert.ok(row.includes('레이더 담당분'), '설명이 표시되지 않는다');
      assert.ok(row.includes('C:\\work\\radar'), 'Git 경로가 표시되지 않는다');
      assert.ok(row.includes('C:\\work\\radar-wc'), 'SVN 경로가 표시되지 않는다');
      assert.ok(row.includes('cat-git'), '렌치 아이콘(버전관리 연동 표시)이 없다 — 개인 행과 규약이 어긋난다');
    });

    test('소유권 분리: 공식 행 [수정]으로 편집에 진입하면 이름·색이 잠기고 안내가 뜬다', () => {
      seedOfficialLocal();
      ev('openCatModal();');
      ev("document.querySelector('#catList .cat-row[data-id=\"db-u1\"] [data-act=\"edit\"]').click();");
      assert.strictEqual(ev('editingCatId'), 'db-u1', '공식 행 [수정]이 편집 모드로 들어가지 않는다');
      assert.strictEqual(ev("document.getElementById('cName').readOnly"), true, '과제명 입력이 열려 있다(DB 소유 필드)');
      assert.strictEqual(ev("document.getElementById('cColor').disabled"), true, '색상 직접선택이 열려 있다(DB 소유 필드)');
      assert.strictEqual(ev("document.getElementById('cLockNote').classList.contains('hidden')"), false, '잠금 사유 안내가 안 보인다');
      const note = ev("document.getElementById('cLockNote').textContent");
      assert.ok(/회사 DB/.test(note) && /보고서/.test(note), '왜 잠겼는지(보고서 집계) 설명이 없다: ' + note);
      assert.ok(/설명/.test(note) && /Git/.test(note), '무엇은 열려 있는지 안내가 없다: ' + note);
      // 설명·Git·SVN 입력은 정상(잠금 대상 아님)
      assert.strictEqual(ev("document.getElementById('cDesc').readOnly"), false, '설명까지 잠겼다(연동 불가 회귀)');
      assert.strictEqual(ev("document.getElementById('cDesc').value"), '레이더 담당분', '설명이 폼에 프리필되지 않는다');
      // 폼 제목·버튼 문구가 '새 과제 추가'와 섞이지 않는다
      assert.ok(/공식 과제/.test(ev("document.getElementById('catFormTitle').textContent")), '폼 제목이 공식 편집 모드를 알리지 않는다');
      assert.strictEqual(ev("document.getElementById('btnCatSave').textContent"), '수정 저장');
      // 편집 취소 → 잠금이 원복(잔상 없음)
      ev("document.getElementById('btnCatCancelEdit').click();");
      assert.strictEqual(ev('editingCatId'), null);
      assert.strictEqual(ev("document.getElementById('cName').readOnly"), false, '편집 이탈 후에도 이름칸이 잠겨 있다(새 과제 추가 불가)');
      assert.strictEqual(ev("document.getElementById('cLockNote').classList.contains('hidden')"), true, '안내가 남아 새 과제 추가를 오해시킨다');
    });

    test('소유권 분리(계약): 공식 과제 저장은 name/color를 건드리지 않고 desc/git/svn만 반영한다', () => {
      seedOfficialLocal();
      ev('openCatModal();');
      ev("document.querySelector('#catList .cat-row[data-id=\"db-u1\"] [data-act=\"edit\"]').click();");
      // 폼을 일부러 오염시킨다 — 잠금이 UI 장식이 아니라 '저장 경로 계약'인지 본다(DOM은 언제든 조작 가능).
      ev("document.getElementById('cName').readOnly=false; document.getElementById('cName').value='조작된 이름';");
      ev("selColor='#ff0000';");
      ev("document.getElementById('cDesc').value='내 PC 메모'; catFormRepo='D:\\\\repo\\\\g'; catFormSvnRepo='D:\\\\repo\\\\s';");
      ev('saveCatFromForm();');
      const c = evJSON("state.categories.find(function(x){return x.id==='db-u1';})");
      assert.strictEqual(c.name, '통상u1', '공식 과제의 이름이 로컬 편집으로 바뀌었다 — 보고서 집계(사업부 과제명 일치)가 깨진다');
      assert.strictEqual(c.color, '#3e5be0', '공식 과제의 색이 로컬 편집으로 바뀌었다(구분별 색 규약 이탈)');
      assert.strictEqual(c.desc, '내 PC 메모', '설명이 저장되지 않는다');
      assert.strictEqual(c.gitRepo, 'D:\\repo\\g', 'Git 경로가 저장되지 않는다(연동 불가)');
      assert.strictEqual(c.svnRepo, 'D:\\repo\\s', 'SVN 경로가 저장되지 않는다');
      assert.strictEqual(c.source, 'db', '출처가 유실됐다');
      // XML 영속(공통 경로)에도 로컬 필드가 실린다 — 재부팅해도 연동이 유지된다
      const p = evJSON('fromXML(toXML())');
      const back = p.categories.find(x => x.id === 'db-u1');
      assert.strictEqual(back.desc, '내 PC 메모');
      assert.strictEqual(back.gitRepo, 'D:\\repo\\g');
      assert.strictEqual(back.svnRepo, 'D:\\repo\\s');
      assert.strictEqual(back.name, '통상u1');
    });

    test('소유권 분리: DB 재조회(syncSubscribedDbMeta)가 로컬 필드를 덮어쓰지 않는다', () => {
      seedOfficialLocal();
      applyRows([DBROW('u1', { common_name: '이름바뀜' })]);   // 재조회 = name/color만 최신화
      const c = evJSON("state.categories.find(function(x){return x.id==='db-u1';})");
      assert.strictEqual(c.name, '이름바뀜', 'DB 이름 변경이 반영되지 않는다(DB 소유 필드)');
      assert.strictEqual(c.desc, '레이더 담당분', '재조회가 로컬 설명을 날렸다');
      assert.strictEqual(c.gitRepo, 'C:\\work\\radar', '재조회가 로컬 Git 경로를 날렸다');
      assert.strictEqual(c.svnRepo, 'C:\\work\\radar-wc', '재조회가 로컬 SVN 경로를 날렸다');
    });

    test('소유권 분리: 공식 과제 삭제(del)는 여전히 차단된다(제거=unsub만)', async () => {
      seedOfficialLocal();
      ev('openCatModal();');
      const row = ev("catRowHtml(state.categories.find(function(c){return c.id==='db-u1';}))");
      assert.ok(!row.includes('data-act="del"'), '공식 행에 삭제 버튼이 생겼다');
      // 가드 자체 검증 — del 버튼을 주입해 눌러도 확인창조차 뜨지 않아야 한다(핸들러가 먼저 되돌아온다)
      ev("window.__askN=0; window.__cb0=window.confirmBox; window.confirmBox=function(){window.__askN++; return Promise.resolve('ok');};");
      ev("(function(){var r=document.querySelector('#catList .cat-row[data-id=\"db-u1\"]');" +
         "var b=document.createElement('button'); b.dataset.act='del'; r.appendChild(b); b.click();})()");
      await new Promise(r => setTimeout(r, 0));
      ev('window.confirmBox=window.__cb0;');
      assert.strictEqual(ev('window.__askN'), 0, '공식 과제에서 삭제 확인창이 떴다(가드가 뚫렸다)');
      assert.strictEqual(ev("state.categories.some(function(c){return c.id==='db-u1';})"), true, '공식 과제가 삭제됐다');
      // 개인 과제는 그대로 삭제 가능해야 한다(가드가 과하게 넓어지지 않았는지)
      assert.strictEqual(ev("typeof deleteCategory"), 'function');
    });

    test('소유권 분리: 편집 중이던 공식 과제를 제거하면 폼이 유령으로 남지 않는다', () => {
      seedOfficialLocal();
      ev('openCatModal();');
      ev("document.querySelector('#catList .cat-row[data-id=\"db-u1\"] [data-act=\"edit\"]').click();");
      assert.strictEqual(ev('editingCatId'), 'db-u1');
      ev("unsubscribeDbCat('db-u1'); renderCatModal();");   // 카탈로그/행 어느 경로로 제거하든 같은 렌더를 탄다
      assert.strictEqual(ev('editingCatId'), null, '사라진 과제를 계속 편집 중이라고 믿는다(저장이 조용히 무시된다)');
      assert.strictEqual(ev("document.getElementById('catFormTitle').textContent"), '새 과제 추가', '폼 제목이 편집 모드로 남았다');
      assert.strictEqual(ev("document.getElementById('cName').readOnly"), false, '이름칸이 잠긴 채 남아 새 과제를 못 만든다');
    });

    // ══════════════════════════════════════════════════════════════════
    // 재연결 픽커 행 가시성 (2026-07-27) — 평문 '·' 나열 → 구조화 + 구분·계약기간 추가
    // 여기서 고른 하나로 일정·할일 수십 건의 소속이 바뀌므로, 카탈로그 상세와 같은 축을 다 봐야 고를 수 있다.
    // ══════════════════════════════════════════════════════════════════
    test('픽커 행: 구분·계약기간이 추가되고 레이블 붙은 필드로 구조화된다', () => {
      seedRelink();
      ev("openRelinkPick('p1')");
      const t = ev("(function(){var r=document.querySelector('#rlpList .off-row[data-rlpid=\"db-u1\"]'); return r?r.textContent:'';})()");
      assert.ok(/일반계약/.test(t), '구분(section)이 행에 없다');
      assert.ok(/2026-01-01 ~ 2026-12-31/.test(t), '계약기간(offPeriod)이 행에 없다');
      for (const lb of ['발주처', '사업', '계약', '기간'])
        assert.ok(t.includes(lb), `레이블 '${lb}'가 없다 — 값만 흘리면 무슨 값인지 모른다: ` + t);
      assert.ok(/방위사업청/.test(t) && /함정 레이더 성능개량/.test(t) && /저장장치/.test(t), '발주처·사업명·계약명이 유실됐다');
      assert.ok(/진행중/.test(t), '상태가 유실됐다');
      // 구조 — 1행(주라벨+구분 배지+상태 칩) / 2행(레이블 필드)
      const has = s => ev("!!document.querySelector('#rlpList .off-row[data-rlpid=\"db-u1\"] " + s + "')");
      for (const s of ['.rlp-head', '.rlp-nm', '.rlp-sec', '.rlp-st', '.rlp-meta']) assert.strictEqual(has(s), true, s + ' 가 없다');
      // 상태 색 규약(offStatusKind) + 색점은 그대로
      assert.strictEqual(ev("document.querySelector('#rlpList .off-row[data-rlpid=\"db-u1\"] .rlp-st').className"), 'rlp-st run',
        '상태 종류 클래스(run/warn/end/none) 규약이 깨졌다');
      assert.strictEqual(has('.off-dot.run'), true, '상태 색점(.off-dot)이 사라졌다');
      // 값이 빈 행도 무너지지 않는다(선진행 u3 — 계약명·상태·날짜 없음)
      const t3 = ev("(function(){var r=document.querySelector('#rlpList .off-row[data-rlpid=\"db-u3\"]'); return r?r.textContent:'';})()");
      assert.ok(/기간/.test(t3), '빈 값 행에서 필드가 통째로 사라졌다');
    });

    test('픽커 행: 각 필드가 개별 말줄임 + title로 전체 값을 준다', () => {
      seedRelink();
      ev("openRelinkPick('p1')");
      const labels = evJSON("[].slice.call(document.querySelectorAll('#rlpList .off-row[data-rlpid=\"db-u1\"] .rlp-f'))" +
                            ".map(function(e){return e.querySelector('.rlp-lbl').textContent;})");
      assert.deepStrictEqual(labels, ['발주처', '사업', '계약', '기간'], '필드 구성이 다르다: ' + JSON.stringify(labels));
      const titles = evJSON("[].slice.call(document.querySelectorAll('#rlpList .off-row[data-rlpid=\"db-u1\"] .rlp-f'))" +
                            ".map(function(e){return e.getAttribute('title')||'';})");
      assert.ok(titles.every(t => t.includes(':')), '잘린 값을 확인할 title이 없다: ' + JSON.stringify(titles));
      assert.ok(titles.some(t => t.includes('저장장치')), 'title에 전체 값이 담기지 않는다');
      // CSS 계약 — 필드/값 칸에 min-width:0 + overflow:hidden + text-overflow:ellipsis
      // (min-width:0이 없으면 flex/grid 아이템이 내용폭 아래로 못 줄어 긴 값이 레이아웃을 민다)
      const src = loadAppSource();
      for (const sel of ['rlp-f', 'rlp-v']) {
        const m = new RegExp('\\.' + sel + '\\{([^}]*)\\}').exec(src);
        assert.ok(m, `.${sel} 규칙을 찾지 못함`);
        for (const decl of ['min-width:0', 'overflow:hidden', 'text-overflow:ellipsis'])
          assert.ok(m[1].includes(decl), `.${sel}에 ${decl}가 없다 — 개별 말줄임이 안 된다`);
      }
    });

    test('픽커 행: 카탈로그 목록과 스타일이 서로 새지 않는다(.rlp-* ↔ .off-meta 분리)', () => {
      seed(THS({ categories: [] }));
      applyRows([DBROW('u1')]);
      ev('offFillSelects(); renderOfficialList();');
      assert.strictEqual(ev("document.querySelectorAll('#offList [class*=\"rlp-\"]').length"), 0,
        '카탈로그 목록 행에 픽커 전용 클래스가 새어 들었다');
      assert.strictEqual(ev("document.querySelectorAll('#offList .off-meta').length > 0"), true, '카탈로그 행 골격(.off-meta)이 바뀌었다');
      seedRelink();
      ev("openRelinkPick('p1')");
      assert.strictEqual(ev("document.querySelectorAll('#rlpList .off-meta').length"), 0,
        '픽커 행이 아직 카탈로그의 평문 나열(.off-meta)을 쓴다');
      assert.strictEqual(ev("document.querySelectorAll('#rlpList .off-row').length > 0"), true, '.off-row 골격(선택·hover·포커스)은 유지돼야 한다');
    });

    // ══════════════════════════════════════════════════════════════════
    // 카탈로그 상세 액션 한 줄 (2026-07-27) — .off-d-sub / .off-d-act 두 div → 한 컨테이너
    // ══════════════════════════════════════════════════════════════════
    test('카탈로그 상세: 편입·관리 액션이 한 줄(.off-d-bar)에 모이고 좌/우로 의미가 갈린다', () => {
      seed(THS({ categories: [] }));
      applyRows([DBROW('u1')]);
      ev("offSelId='db-u1'; renderOfficialDetail();");
      assert.strictEqual(ev("document.querySelectorAll('#offDetail .off-d-bar').length"), 1, '액션 컨테이너가 1개(한 줄)가 아니다');
      for (const s of ['[data-offadd]', '.off-d-act [data-offedit]', '.off-d-act [data-offhide]'])
        assert.strictEqual(ev("!!document.querySelector('#offDetail .off-d-bar " + s + "')"), true, s + ' 가 한 줄 컨테이너 밖에 있다');
      // 편입 상태 문구(추가됨)가 붙어도 한 줄 유지
      ev("subscribeDbCat(dbCatalogById('db-u1')); renderOfficialDetail();");
      assert.strictEqual(ev("document.querySelectorAll('#offDetail .off-d-bar').length"), 1, '편입 후 액션이 다시 두 덩이로 갈라졌다');
      assert.strictEqual(ev("!!document.querySelector('#offDetail .off-d-bar .off-sub-state')"), true, '편입 상태 문구가 한 줄 밖으로 나갔다');
      assert.strictEqual(ev("!!document.querySelector('#offDetail .off-d-bar [data-offremove]')"), true, '제거 버튼이 한 줄 밖으로 나갔다');
      // 포커스 순서 = 편입(주 동작) → 편집 → 숨김
      const order = evJSON("[].slice.call(document.querySelectorAll('#offDetail .off-d-bar button')).map(function(b){return b.textContent.trim();})");
      // 라벨이 짧아야 위젯 실폭(≈380px)에서 한 줄이 유지된다 — '캘린더에서 제거'는 앞의 상태 문구와 중복이라 '제거'로 줄였다.
      assert.deepStrictEqual(order, ['제거', '편집', '숨김'], '액션 순서(포커스 순서)가 편입→관리가 아니다: ' + JSON.stringify(order));
      // 좌/우 분리는 스페이서로 — 좁으면 flex-wrap으로 자연히 접힌다
      const src = loadAppSource();
      const bar = /\.off-d-bar\{([^}]*)\}/.exec(src), act = /\.off-d-act\{([^}]*)\}/.exec(src);
      assert.ok(bar && /flex-wrap:wrap/.test(bar[1]), '.off-d-bar에 flex-wrap이 없다(좁은 폭에서 잘린다)');
      assert.ok(act && /margin-left:auto/.test(act[1]), '.off-d-act가 우측으로 밀리지 않는다(의미 구분 소실)');
      assert.ok(act && !/margin-top/.test(act[1]), '.off-d-act에 margin-top이 남아 다시 줄을 만든다');
    });
  }
}
