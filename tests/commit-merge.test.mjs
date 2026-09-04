// mergeCommitsPreserveEdits 단위테스트 — 재-불러오기 시 사용자 편집(subject·body) 보존 규칙 검증.
// 앱 소스에서 순수 함수만 추출·eval해 앱 전역 없이 단독 실행한다(하네스 패턴: harness-selftest 참고).
//
// ★ 이 파일은 두 층으로 나뉜다 — 둘 다 있어야 게이트가 의미를 가진다.
//   1) 순수 함수 계약  : 추출한 함수가 '올바른가'.
//   2) 배선 계약       : 제품이 그 함수를 '실제로 쓰는가'(소스 문자열 단언 — jsdom 불필요).
//   2)가 없던 옛 판은 호출부 2곳(항목 저장·동기화)을 통째로 지워도 전 스위트가 초록이었다
//   (실측 896 pass / 0 fail / exit 0). 즉 사용자가 고친 커밋 subject·body 가 git 원본으로
//   전부 덮이는 회귀가 릴리스 게이트를 그냥 통과했다 — 이 파일이 존재하는 이유가 무력화된 것이다.
//   이 저장소는 이미 같은 기법을 쓴다(xml-retirement 의 「폐기②/변이⑮~⑱」, user-info 의 「변이①~」).
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';

const src = loadAppSource();

// ── 추출 — 실패해도 러너를 죽이지 않는다 ────────────────────────────
// 옛 판은 모듈 최상위에서 extractFunction 이 throw 했다. 함수명이 바뀌면 run-tests.mjs 의
// import 루프에서 프로세스가 죽고 896건 전체 판정이 증발한다(exit 1 이라 게이트는 막지만
// 원인 보고가 없다). 이름·선언 형태 변경은 '계약 위반 1건'으로 강등하고 나머지 커버리지를 살린다.
let code = null;
let extractErr = null;
try {
  code = extractFunction(src, 'mergeCommitsPreserveEdits');
} catch (e) {
  extractErr = e;
}
let _merge = null;
if (code !== null) {
  try { _merge = eval('(' + code + ')'); } catch (e) { extractErr = e; }
}

// 옛 판이 쓰던 이름 그대로 — 추출이 깨지면 이 함수를 쓰는 계약들만 명시적으로 실패한다.
function mergeCommitsPreserveEdits(prev, fetched) {
  if (typeof _merge !== 'function') {
    assert.fail(
      'mergeCommitsPreserveEdits 를 앱 소스에서 추출하지 못했다 — 함수명·선언 형태가 바뀌었는가? '
      + `(${extractErr && extractErr.message})`
    );
  }
  return _merge(prev, fetched);
}

// 헬퍼: 커밋 생성
const C = (hash, subject, extra) => ({ hash, short: hash ? hash.slice(0, 7) : '', time: '09:00', subject, ...(extra || {}) });

// ══ 순수 함수 계약(테스트 + 변이 주입이 같은 검사를 공유한다) ═══════════
// user-info.test.mjs 관례다 — 검사 본문을 함수로 빼 두어야 "이 검사가 정말 우는가"를
// 변이된 구현에 물려 증명할 수 있다. 본문은 옛 판 그대로고, 인자로 구현만 갈아 끼운다.
const pureChecks = {
  // (a) hash 일치 시 prev(사용자 편집) subject가 fetched를 이김
  a(merge) {
    const prev = [C('aaa111', '내가 고친 메시지')];
    const fetched = [C('aaa111', 'git 원본 메시지')];
    const out = merge(prev, fetched);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].hash, 'aaa111');
    assert.strictEqual(out[0].subject, '내가 고친 메시지');   // prev 우선
    // 다른 필드는 fetched 것 유지(스프레드 기반)
    assert.strictEqual(out[0].short, fetched[0].short);
  },

  // (b) prev에 없는 새 fetched 커밋은 자기 subject 그대로 추가
  b(merge) {
    const prev = [C('aaa111', '고친 것')];
    const fetched = [C('aaa111', '원본'), C('bbb222', '새 커밋')];
    const out = merge(prev, fetched);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].subject, '고친 것');    // (a) 규칙
    assert.strictEqual(out[1].hash, 'bbb222');
    assert.strictEqual(out[1].subject, '새 커밋');     // 그대로
  },

  // (c) prev엔 있으나 fetched엔 없는 커밋은 결과에서 빠짐(fetched 집합이 진실)
  c(merge) {
    const prev = [C('aaa111', '고친 것'), C('ccc333', 'prev에만 있음')];
    const fetched = [C('aaa111', '원본')];
    const out = merge(prev, fetched);
    assert.strictEqual(out.length, 1);                 // fetched 크기와 동일
    assert.ok(!out.some(c => c.hash === 'ccc333'), 'ccc333은 빠져야 함');
  },

  // (d) 사용자가 "삭제"(prev에서 제거)했지만 git엔 여전히 있는 커밋 → git subject로 재등장
  d(merge) {
    const prev = [];                                   // 사용자가 지워서 prev엔 없음
    const fetched = [C('ddd444', 'git의 현재 메시지')];
    const out = merge(prev, fetched);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].hash, 'ddd444');
    assert.strictEqual(out[0].subject, 'git의 현재 메시지');   // git 진실로 부활
  },

  // (e) hash 없는(레거시) fetched 커밋은 매칭 없이 그대로 통과
  e(merge) {
    const noHash = C('', '해시 없는 커밋');
    const prev = [C('aaa111', '고친 것')];
    const fetched = [noHash];
    const out = merge(prev, fetched);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].subject, '해시 없는 커밋');
    assert.strictEqual(out[0], noHash);                // 매칭 안 되면 원본 객체 그대로 통과
  },

  // (f) prev가 비었거나 undefined면 fetched를 그대로 반환
  f(merge) {
    const fetched = [C('aaa111', 'x'), C('bbb222', 'y')];
    const out1 = merge([], fetched);
    assert.deepStrictEqual(out1.map(c => c.subject), ['x', 'y']);
    const out2 = merge(undefined, fetched);
    assert.deepStrictEqual(out2.map(c => c.subject), ['x', 'y']);
    // fetched가 비정상(undefined)이면 빈 배열
    assert.deepStrictEqual(merge(prevUndefinedGuard(), undefined), []);
  },

  // 추가: prev에 hash는 있으나 subject가 빈 문자열이어도 그 값을 씀
  // (사용자가 빈값 저장은 UI에서 막지만 순수함수는 값을 신뢰)
  emptySubject(merge) {
    const prev = [C('aaa111', '')];
    const fetched = [C('aaa111', '원본')];
    const out = merge(prev, fetched);
    assert.strictEqual(out[0].subject, '');            // pm.has(hash) true → prev값('') 사용
  },

  // (g) hash 일치 시 subject뿐 아니라 body(사용자 편집본)도 보존 — fetched body를 이김
  g(merge) {
    const prev = [C('aaa111', '편집 제목', { body: '편집 본문\n둘째 줄' })];
    const fetched = [C('aaa111', 'git 제목', { body: 'git 본문' })];
    const out = merge(prev, fetched);
    assert.strictEqual(out[0].subject, '편집 제목');
    assert.strictEqual(out[0].body, '편집 본문\n둘째 줄');   // prev body 우선
    assert.strictEqual(out[0].short, fetched[0].short);       // 나머지 필드는 fetched
  },

  // (h) prev에 body 부재면 ''로 보존(편집본이 진실 — 스펙상 prev가 subject·body 둘 다 이김)
  h(merge) {
    const prev = [C('aaa111', '편집 제목')];                       // body 없음
    const fetched = [C('aaa111', 'git 제목', { body: 'git 본문' })];
    const out = merge(prev, fetched);
    assert.strictEqual(out[0].subject, '편집 제목');
    assert.strictEqual(out[0].body, '');                          // prev.body||'' → '' (초기화 후 로드로 fresh 취득)
  },

  // (i) hash 없는 fetched는 그대로 통과 — body도 fetched 것 유지(참조 동일)
  i(merge) {
    const noHash = C('', '해시 없음', { body: 'fetched 본문' });
    const out = merge([C('aaa111', 'x', { body: 'y' })], [noHash]);
    assert.strictEqual(out[0], noHash);                           // 매칭 안 됨 → 원본 객체
    assert.strictEqual(out[0].body, 'fetched 본문');
  },
};
function prevUndefinedGuard(){ return undefined; }

// 추출 자체 sanity — 선언 형태 확인
test('mergeCommitsPreserveEdits: 함수로 추출·eval 됨', () => {
  assert.strictEqual(extractErr, null,
    `추출·eval 실패 — 함수명·선언 형태가 바뀌었는가? (${extractErr && extractErr.message})`);
  assert.match(code, /^function\s+mergeCommitsPreserveEdits\s*\(/);
  assert.strictEqual(typeof _merge, 'function');
});

test('(a) hash 일치 → prev의 편집된 subject가 우선', () => pureChecks.a(mergeCommitsPreserveEdits));
test('(b) prev에 없는 새 커밋 → fetched subject 그대로', () => pureChecks.b(mergeCommitsPreserveEdits));
test('(c) prev에만 있고 fetched엔 없는 커밋 → 결과에서 드롭', () => pureChecks.c(mergeCommitsPreserveEdits));
test('(d) 사용자가 삭제한(=prev 부재) 커밋이 git엔 있음 → git subject로 재추가', () => pureChecks.d(mergeCommitsPreserveEdits));
test('(e) hash 없는 fetched 커밋 → 그대로 통과(참조 동일)', () => pureChecks.e(mergeCommitsPreserveEdits));
test('(f) prev empty/undefined → fetched 그대로', () => pureChecks.f(mergeCommitsPreserveEdits));
test('보강: prev subject가 빈 문자열이면 그 빈 문자열이 반영(맵에 존재하므로)', () => pureChecks.emptySubject(mergeCommitsPreserveEdits));
test('(g) hash 일치 → prev의 편집된 body도 보존(줄바꿈 유지)', () => pureChecks.g(mergeCommitsPreserveEdits));
test('(h) prev에 body 없음 → body:"" 로 세팅(fetched body 채택 안 함)', () => pureChecks.h(mergeCommitsPreserveEdits));
test('(i) hash 없는 fetched → body 포함 원본 그대로 통과', () => pureChecks.i(mergeCommitsPreserveEdits));

// ══ 배선 계약 — 제품이 이 함수를 실제로 부르는가 ═══════════════════════
// 순수 함수가 아무리 옳아도 제품이 안 부르면 0점이다. 실측(2026-09-04): 호출부 2곳
// (task-calendar-prototype.html 항목 저장 / 커밋 동기화)을 지우거나 인자 순서를 뒤집어도
// 896 pass / 0 fail / exit 0 이었다. 아래 3건이 그 침묵을 끝낸다.
//   · 배선①② — 인자까지 고정한다(순서 역전도 잡는다). 이게 본체다.
//   · 배선③  — 개수만 센다. 호출부 '추가·삭제' 감지용 보조다(순서 역전은 못 잡는다).
const wiring = {
  // 배선① 항목 편집창 저장 경로(§ let commits = __entryGitLoaded ? … )
  entrySave(source) {
    assert.match(
      source,
      /commits\s*=\s*__entryGitLoaded\s*\?\s*mergeCommitsPreserveEdits\(\s*existing\s*\?\s*existing\.commits\s*:\s*\[\]\s*,\s*__entryCommits\s*\)/,
      '배선① 위반: 항목 저장 경로가 mergeCommitsPreserveEdits(기존 commits, 새로 불러온 commits) 를 그 인자 순서로 부르지 않는다 — 편집창에서 git 커밋을 다시 불러온 뒤 저장하면 사용자가 고친 subject·body 가 전부 git 원본으로 날아간다'
    );
  },
  // 배선② 커밋 동기화 경로(§ if(ex){ ex.commits = … } )
  sync(source) {
    assert.match(
      source,
      /ex\.commits\s*=\s*mergeCommitsPreserveEdits\(\s*ex\.commits\s*,\s*mapped\s*\)/,
      '배선② 위반: 동기화 경로가 mergeCommitsPreserveEdits(기존 ex.commits, 새로 매핑한 mapped) 를 그 인자 순서로 부르지 않는다 — 동기화 한 번에 사용자 편집이 git 원본으로 덮인다'
    );
  },
  // 배선③ 선언 1 + 호출 2 = 3
  callSites(source) {
    const decl = (source.match(/function\s+mergeCommitsPreserveEdits\s*\(/g) || []).length;
    const all = (source.match(/mergeCommitsPreserveEdits\s*\(/g) || []).length;
    assert.strictEqual(decl, 1, `배선③ 위반: 선언이 정확히 1개가 아니다(실제 ${decl}개)`);
    assert.strictEqual(all - decl, 2,
      `배선③ 위반: 호출 지점이 정확히 2곳이 아니다(실제 ${all - decl}곳) — 줄었으면 편집 보존이 죽은 것이고, 늘었으면 배선①② 가 인자를 못 지키는 새 경로가 생긴 것이다(그 경로용 배선 계약을 추가하라)`);
  },
};

test('배선①: 항목 저장 경로가 병합 함수를 실제로 부른다(인자 순서 포함)', () => wiring.entrySave(src));
test('배선②: 동기화 경로가 병합 함수를 실제로 부른다(인자 순서 포함)', () => wiring.sync(src));
test('배선③: 호출 지점이 정확히 2곳이다(추가·삭제 모두 감지)', () => wiring.callSites(src));

// ══ 변이 주입 — 위 계약이 정말 우는지 증명 ════════════════════════════
// 각 변이는 "실제로 날 수 있는 회귀"다. 안 잡히면 그 계약은 장식이다.
// ★ 앵커가 소스에서 안 찾히면 mutate() 가 여기서 실패한다 — 조용히 통과하지 않는다.
function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상이 소스에 없다): ${from}`);
  return out;
}
// 추출한 함수 본문을 변이시켜 다시 eval — '구현만 갈아 끼운' 대체품을 만든다.
function mutantMerge(from, to) {
  assert.strictEqual(extractErr, null, '추출이 실패해 변이를 만들 수 없다');
  return eval('(' + mutate(code, from, to) + ')');
}

// ── 배선 변이 ───────────────────────────────────────────────────────
test('변이①: 항목 저장 경로에서 병합 호출을 지우면 배선①·③ 이 실패한다', () => {
  //  = 감사에서 전 스위트가 침묵했던 바로 그 변이. 원형이 남지 않게 통째로 치환한다.
  const bad = mutate(src,
    'mergeCommitsPreserveEdits(existing ? existing.commits : [], __entryCommits)',
    '(__entryCommits)');
  assert.throws(() => wiring.entrySave(bad), /배선① 위반/);
  assert.throws(() => wiring.callSites(bad), /배선③ 위반/);
});

test('변이②: 동기화 경로에서 병합 호출을 지우면 배선②·③ 이 실패한다', () => {
  const bad = mutate(src,
    'ex.commits = mergeCommitsPreserveEdits(ex.commits, mapped);',
    'ex.commits = mapped;');
  assert.throws(() => wiring.sync(bad), /배선② 위반/);
  assert.throws(() => wiring.callSites(bad), /배선③ 위반/);
});

test('변이③: 항목 저장 경로의 인자 순서를 뒤집으면 배선① 이 실패한다(배선③ 은 못 잡는다)', () => {
  //  인자 역전은 "git 원본이 사용자 편집을 이긴다" — 삭제와 같은 피해인데 개수는 그대로다.
  const bad = mutate(src,
    'mergeCommitsPreserveEdits(existing ? existing.commits : [], __entryCommits)',
    'mergeCommitsPreserveEdits(__entryCommits, existing ? existing.commits : [])');
  assert.throws(() => wiring.entrySave(bad), /배선① 위반/);
  assert.doesNotThrow(() => wiring.callSites(bad));   // ★ 개수만 세는 ③ 단독으로는 무력 — ①② 가 본체인 이유
});

test('변이④: 동기화 경로의 인자 순서를 뒤집으면 배선② 가 실패한다(배선③ 은 못 잡는다)', () => {
  const bad = mutate(src,
    'mergeCommitsPreserveEdits(ex.commits, mapped)',
    'mergeCommitsPreserveEdits(mapped, ex.commits)');
  assert.throws(() => wiring.sync(bad), /배선② 위반/);
  assert.doesNotThrow(() => wiring.callSites(bad));
});

test('변이⑤: 병합 호출부가 하나 더 늘면 배선③ 이 실패한다(배선①② 는 못 잡는다)', () => {
  //  새 저장 경로가 생겼는데 배선 계약을 안 붙인 상황 — 개수 계약이 그걸 잡는다.
  const bad = src + '\n<script>function __ghostSave(a, b){ return mergeCommitsPreserveEdits(a, b); }</script>\n';
  assert.throws(() => wiring.callSites(bad), /호출 지점이 정확히 2곳이 아니다/);
  assert.doesNotThrow(() => wiring.entrySave(bad));
  assert.doesNotThrow(() => wiring.sync(bad));
});

test('변이⑥: 선언 이름을 바꾸면 배선③ 이 멈추고 추출이 계약 위반으로 보고된다', () => {
  const bad = mutate(src, 'function mergeCommitsPreserveEdits(prev, fetched){', 'function __gone(prev, fetched){');
  assert.throws(() => wiring.callSites(bad), /선언이 정확히 1개가 아니다/);
  //  ★ 이름이 바뀌면 추출도 실패한다 — 옛 판은 여기서 러너가 죽었다. 이제는 계약 위반 1건이다.
  assert.throws(() => extractFunction(bad, 'mergeCommitsPreserveEdits'), /선언을 찾지 못함/);
});

// ── 순수 함수 변이 — 어떤 계약이 어느 축을 지키는지 분해해 못 박는다 ──
test('변이⑦: subject 보존을 지우면 (a)·보강 이 실패한다(body 축은 멀쩡)', () => {
  const bad = mutantMerge('subject: pm.get(c.hash).subject', 'subject: c.subject');
  assert.throws(() => pureChecks.a(bad), '(a) 가 subject 보존 상실을 못 잡았다');
  assert.throws(() => pureChecks.emptySubject(bad), '보강 이 subject 보존 상실을 못 잡았다');
  //  body 축은 안 건드렸다 — 검출이 뭉텅이가 아니라 축별로 갈린다는 증거.
  const out = bad([C('aaa111', 'p', { body: '편집 본문' })], [C('aaa111', 'f', { body: 'git 본문' })]);
  assert.strictEqual(out[0].body, '편집 본문');
});

test('변이⑧: body 보존을 지우면 (g)·(h) 가 실패한다(subject 축은 멀쩡)', () => {
  const bad = mutantMerge('body: pm.get(c.hash).body', 'body: c.body');
  assert.throws(() => pureChecks.g(bad), '(g) 가 body 보존 상실을 못 잡았다');
  assert.throws(() => pureChecks.h(bad), '(h) 가 body 보존 상실을 못 잡았다');
  assert.doesNotThrow(() => pureChecks.a(bad));
});

test('변이⑨: prev 가드를 지우면 (f) 가 실패한다', () => {
  const bad = mutantMerge('(Array.isArray(prev) ? prev : [])', '(prev)');
  assert.throws(() => pureChecks.f(bad), '(f) 가 prev 가드 상실을 못 잡았다');
});

test('변이⑩: fetched 가드를 지우면 (f) 가 실패한다', () => {
  const bad = mutantMerge('(Array.isArray(fetched) ? fetched : [])', '(fetched)');
  assert.throws(() => pureChecks.f(bad), '(f) 가 fetched 가드 상실을 못 잡았다');
});

test('변이⑪: hash 존재검사를 지우면 (b)·(d) 가 실패한다', () => {
  const bad = mutantMerge('pm.has(c.hash)', 'true');
  assert.throws(() => pureChecks.b(bad), '(b) 가 존재검사 상실을 못 잡았다');
  assert.throws(() => pureChecks.d(bad), '(d) 가 존재검사 상실을 못 잡았다');
});

test('변이⑫: 반환을 prev 합집합으로 바꾸면 (c) 가 실패한다(드롭 계약 민감도)', () => {
  //  감사에서 '민감도 미측정'으로 남았던 (c) 를 여기서 못 박는다.
  //  fetched 우선이 아니라 prev 잔여분까지 되살리는 구현 — 지운 커밋이 유령처럼 돌아온다.
  const bad = mutantMerge(
    /return \(Array\.isArray\(fetched\)[\s\S]*?: c\);/,
    'const __out = (Array.isArray(fetched) ? fetched : []).map(c => '
    + '(c && c.hash && pm.has(c.hash)) ? {...c, subject: pm.get(c.hash).subject, body: pm.get(c.hash).body} : c); '
    + 'const __have = new Set(__out.map(c => c && c.hash).filter(Boolean)); '
    + 'return __out.concat((Array.isArray(prev) ? prev : []).filter(p => p && p.hash && !__have.has(p.hash)));'
  );
  assert.throws(() => pureChecks.c(bad), '(c) 가 prev 합집합 변이를 못 잡았다');
  assert.doesNotThrow(() => pureChecks.a(bad));   // 축이 분리돼 있다
});

test('변이⑬: 매칭 안 된 커밋까지 복사하면 (e)·(i) 가 실패한다(참조 통과 계약 민감도)', () => {
  //  (e)(i) 도 '민감도 미측정'이었다. 원본 객체 참조 유지가 계약임을 못 박는다.
  const bad = mutantMerge('} : c);', '} : {...c});');
  assert.throws(() => pureChecks.e(bad), '(e) 가 참조 통과 상실을 못 잡았다');
  assert.throws(() => pureChecks.i(bad), '(i) 가 참조 통과 상실을 못 잡았다');
  assert.doesNotThrow(() => pureChecks.a(bad));
});
