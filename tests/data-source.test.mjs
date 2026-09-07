// 데이터 출처 계약 — 두 저장소가 갈라지지 않게 잠근다
//
// 이 파일이 존재하는 이유:
//   앱은 한동안 **파일과 DB 두 저장소**를 다 알고 있다(이관 기간). 그 사이에 조용히 갈라지면
//   어느 쪽이 진실인지 아무도 모르게 된다. 그래서 잠글 것이 다섯이다:
//     ① 기본 출처는 **DB** 다 — 파일로 되돌리려면 명시해야 한다(2026-09-01 이관 완료 후 뒤집었다.
//        기본이 파일이면 사용자가 낡은 쪽을 고치기 시작하고 되돌릴 경로가 없다)
//     ② DB 모드의 변경은 **파일로 새지 않는다** (2단계에서 '읽기 전용'→'DB 로 간다'로 바뀌었다)
//     ③ DB 읽기 실패는 XML 로 **조용히 되돌아가지 않는다**
//   그리고 두 경로가 갈라지지 않도록:
//     ④ state 조립을 XML·DB 가 공유한다(buildStateFrom)
//     ⑤ DB 경로는 XML 전용 이관 절차를 부르지 않는다(그것들은 내부에서 save() 를 부른다)
//     ⑥ 「XML 가져오기」·「전체 초기화」는 **전량 교체**로 간다(2026-09-01) — state 를 통째로
//        갈아끼운 뒤라 차분 저장과 결과는 같지만, 되돌릴 수 없는 조작이 평범한 저장과 같은 문으로
//        들어오면 호출부를 눈으로 셀 수 없다. 그리고 전량 삭제가 **지우면 안 되는 표**를
//        건드리지 않는지가 여기서만 검사된다(DB 없이 소스로 확인할 수 있는 유일한 자리다).
import { readFileSync } from 'node:fs';
import { test, assert, loadAppSource } from './harness.mjs';

const src = loadAppSource();
const mainwin = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

//  주석 제거 — 계약이 보는 것은 **호출**이지 글자가 아니다.
//  ★ 2026-09-03: __applyState 안에 "save() 가 이걸로 되돌린다" 라고 적었더니 계약 ⑤ 가
//    빨간불이 났다. 코드는 그대로였고 주석만 늘었는데도 그랬다 — 함수를 설명하는 사람마다
//    걸리는 덫이다. 그래서 주석을 먼저 걷고 본다. (구현은 xml-retirement.test.mjs 와 같은 꼴.)
//  ★ 줄끝 주의: 정규식의 `.` 는 \r 를 안 먹는다. CRLF 파일에서 조용히 실패하지 않게 \r*\n 로 쪼갠다.
function stripJsComments(text) {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return t.split(/\r*\n/).map((l) => l.replace(/(^|\s)\/\/[^\r\n]*$/, '')).join('\n');
}

// 함수 본문을 중괄호 균형으로 잘라낸다(정규식 구경보다 정확하다).
function bodyOf(text, header) {
  const i = text.indexOf(header);
  assert.ok(i > 0, `${header} 를 찾지 못했다`);
  let k = text.indexOf('{', i), depth = 0;
  for (let p = k; p < text.length; p++) {
    if (text[p] === '{') depth++;
    else if (text[p] === '}') { depth--; if (depth === 0) return text.slice(i, p + 1); }
  }
  assert.fail(`${header} 의 끝을 찾지 못했다`);
}

//  주석은 계약이 아니다 — 왜 지웠는지를 적어 두려면 주석에서는 그 이름이 나와야 한다.
function stripCmt(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r*\n/).map((l) => l.replace(/(^|\s)\/\/[^\r\n]*$/, '')).join('\n')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

const checks = {
  // ① 출처는 **하나**다 (2026-09-01 XML 저장 경로 폐기)
  //    갈래가 있던 자리다 — TC_DATA_SOURCE 환경변수 · __dataSource 변수 · isDbMode() ·
  //    __applyXml 주입. 이관이 끝나 그 넷을 다 걷어냈다. 이제 남은 갈래는 HOST 하나뿐이다:
  //    위젯이면 DB, 브라우저면 localStorage. "지금 어느 경로로 도는가" 가 두 배였던 것이
  //    하나로 줄었고, 이 검사는 **다시 두 배가 되는 것**을 막는다.
  singleSource(app, cs) {
    for (const [re, why] of [
      [/__dataSource/,   '출처 갈래 변수(__dataSource)가 되살아났다'],
      [/\bisDbMode\s*\(/, 'isDbMode() 갈래가 되살아났다'],
      [/__applyXml/,     'data.xml 주입 경로(__applyXml)가 되살아났다'],
    ]) assert.ok(!re.test(stripCmt(app)), why + ' — 이관 뒤 data.xml 은 정의상 낡은 데이터다');
    for (const [re, why] of [
      [/TC_DATA_SOURCE/, '호스트에 출처 환경변수가 되살아났다'],
      [/\bdata\.xml\b/,  '호스트가 다시 data.xml 을 가리킨다'],
    ]) assert.ok(!re.test(stripCmt(cs)), why);
    //  ★ 브라우저에는 호스트도 DB 도 없다. HOST 조건이 빠지면 브라우저 저장이 통째로 막힌다.
    assert.ok(/const isDbHost = \(\) => HOST;/.test(app),
      'isDbHost 가 HOST 로 정의돼 있지 않다 — 브라우저가 DB 모드로 오인돼 localStorage 저장이 막힌다');
    //  영속 설정 파일로 출처를 되살리는 것도 막는다('모르고 그 상태로' 배포되는 부류다)
    assert.ok(!/data-source\.json|dataSource\.json/.test(cs),
      '출처를 파일에 영속시키고 있다 — 갈래가 되살아나는 또 다른 문이다');
  },

  // ② 위젯의 저장은 **DB 로만** 간다
  //    예전에는 save() 안에서 DB 갈래가 파일 전송보다 앞에 있고 return 으로 끊는지를 봤다.
  //    이제 파일 전송 자체가 없다 — 그래서 더 강한 것을 본다: **호스트로 XML 을 보내는 문이
  //    하나도 없어야 한다.** (localStorage 는 남는다 — 브라우저 모드의 저장소다)
  widgetSavesOnlyToDb(app) {
    const body = bodyOf(app, 'function save(){');
    assert.ok(/isDbHost\(\)/.test(body), 'save() 에 위젯 갈래가 없다');
    assert.ok(/dbSave\(\)/.test(body), '위젯 갈래가 dbSave() 를 부르지 않는다');
    assert.ok(/\breturn\s*;/.test(body.slice(body.indexOf('isDbHost()'))),
      '위젯 갈래가 return 으로 끊지 않는다 — DB 와 localStorage 에 둘 다 쓰게 된다');
    //  ★ cmd:'save'(XML 파일 쓰기)로 나가는 문이 앱 전체에 없어야 한다.
    assert.ok(!/cmd:\s*'save'/.test(stripCmt(app)),
      "cmd:'save'(data.xml 쓰기)가 되살아났다 — 그 파일은 이관 뒤 낡은 데이터다");
    assert.ok(!/cmd:\s*'backupdata'/.test(stripCmt(app)),
      "cmd:'backupdata'가 되살아났다 — data.xml 을 전제하는 명령이다");
  },

  // ③ DB 읽기 실패가 XML 로 조용히 되돌아가지 않는다
  noSilentXmlFallback(cs) {
    const body = bodyOf(cs, 'private async Task BootFromDbAsync()');
    assert.ok(!/__applyXml/.test(body),
      'DB 부팅 경로가 __applyXml 을 부른다 — 실패를 파일로 덮으면 사용자는 DB 를 본다고 믿으면서 파일을 본다');
    assert.ok(!/_dataFile|data\.xml/.test(body), 'DB 부팅 경로가 data.xml 을 건드린다');
    for (const w of ['ApplyStateError'])
      assert.ok(body.includes(w), `실패 통지(${w})가 없다 — 실패가 빈 화면으로 나타난다`);
    //  '미등록 사용자'와 '연결 실패'는 반드시 구분한다(§3.6)
    assert.ok(/catch \(CalendarUserNotFoundException/.test(body),
      '미등록 사용자를 연결 실패와 구분하지 않는다 — 사용자도 관리자도 엉뚱한 곳을 본다');
  },

  // ④ 부팅은 buildStateFrom 하나로 조립한다
  //    XML 진입점(__applyXml)이 사라져 이제 부팅 경로는 __applyState 하나다. 그래도 이
  //    검사를 남기는 이유: 가져오기(applyImport)가 **또 하나의 조립처**이고, 거기서 모양이
  //    갈라지면 '같은 데이터인데 들어온 문에 따라 다른 state' 가 된다.
  stateBuilderShared(app) {
    assert.ok(/function buildStateFrom\(data\)\{/.test(app), 'buildStateFrom 이 없다');
    const db = bodyOf(app, 'window.__applyState = function(json, meta){');
    assert.ok(/state = buildStateFrom\(/.test(db), '부팅이 buildStateFrom 을 쓰지 않는다');
    //  DB 경로가 XML 파서를 거치면 '굳이 XML 로 만들었다 되돌리는' 변환 결함이 생긴다
    assert.ok(!/fromXML\(/.test(db), '부팅이 fromXML 을 거친다 — 계약 G 가 존재하는 이유를 무너뜨린다');
  },

  // ⑤ DB 경로는 XML 전용 이관 절차를 부르지 않는다(둘 다 내부에서 save() 를 부른다)
  dbPathSkipsXmlMigrations(app) {
    const db = stripJsComments(bodyOf(app, 'window.__applyState = function(json, meta){'));
    //  migrateLocalStores 는 2026-09-01 에 없앴다 — 이름을 남겨 두는 것은 되살아나면 잡기 위해서다.
    for (const f of ['migrateDbSubscriptions', 'migrateLocalStores'])
      assert.ok(!db.includes(f),
        `DB 경로가 ${f}() 를 부른다 — 이 함수들은 내부에서 save() 를 부르므로 읽기 전용 계약을 깬다`);
    assert.ok(!/\bsave\(\)/.test(db), 'DB 경로가 save() 를 부른다 — 읽기 전용이 아니다');
  },

  //  ⑦ 열람 창(PEER)의 출처는 **부모의 주입 하나뿐**이다 — 로컬 저장소를 씨앗으로 삼지 않는다.
  //  ★ 실제로 그랬다(2026-09-03 실측). 최상위 `let state = load()` 가 PEER 프레임에서도 그대로 돌아
  //    localStorage 의 taskCalendar.v1(= XML 시절의 **내** 캘린더)을 집어왔다. 같은 origin 이라
  //    그 키가 그대로 보인다. 주입이 늦거나 실패하면 부팅 스켈레톤이 4초 뒤 스스로 걷히므로,
  //    「○○ 님의 일정 · 읽기 전용」 창에 **내 일정이 그려졌다**(마커를 심어 재현했다. gitAuthor 도 실렸다).
  //  ★ 정정(2026-09-03): 처음엔 "v0.17.1 에서 올라온 89대에 그 키가 남아 있다" 고 적었는데 **틀렸다.**
  //    폐기 이전 위젯의 save() 는 HOST 면 cmd:'save' 로 XML 파일에 저장했고 localStorage 갈래는
  //    브라우저 전용이었다(git 40109f9~1 확인). 그래서 배포된 위젯에 그 키는 없다.
  //    → 배포기에서 실제로 뜨는 것은 내 데이터가 아니라 **defaultState() 의 샘플 시드**다.
  //      유출은 아니지만 남의 이름이 붙은 창에 **없는 일정**이 뜨는 것이라 마찬가지로 거짓이다.
  //  ★★ 그래서 이 계약은 PEER 만이 아니라 **HOST 전체**를 덮는다. 위젯의 출처는 DB 주입 하나뿐인데
  //    (계약 출처①) 씨앗이 load() 면 그 원칙이 부팅 첫 화면에서 이미 깨진다.
  //    실측: DB 포트를 막고 부팅하면 오류 상자 아래에 「[샘플 일정] …」 3건이 그려졌다.
  //  ★ 브라우저(비-HOST)는 예외다 — 거기서는 localStorage 가 진짜 출처이고 첫 방문 샘플도 의미가 있다.
  peerSeedsEmptyNotLocal(app) {
    const m = /let\s+state\s*=\s*([^\n;]+);/.exec(app);
    assert.ok(m, '최상위 `let state = …` 를 찾지 못했다 — 이름이나 형태를 바꿨다면 이 검사도 함께 고칠 것');
    const seed = m[1].trim();
    assert.ok(/\bPEER\b/.test(seed),
      `부팅 씨앗이 PEER 를 가르지 않는다(현재: ${seed}) — 열람 창은 로컬 저장소를 읽으면 안 된다`);
    assert.ok(/\bHOST\b/.test(seed),
      `부팅 씨앗이 HOST 를 가르지 않는다(현재: ${seed}) — 위젯의 출처는 DB 주입 하나뿐인데(출처①) ` +
      'load() 를 씨앗으로 쓰면 DB 읽기 실패 시 샘플 시드가 자기 일정처럼 그려진다');
    assert.ok(!/\?\s*load\(/.test(seed), `HOST/PEER 갈래가 여전히 load() 를 쓴다: ${seed}`);
    assert.ok(!/\?\s*defaultState\(/.test(seed),
      `HOST/PEER 갈래가 defaultState() 를 쓴다 — 거긴 샘플 시드가 있어 없는 일정이 뜬다: ${seed}`);
    assert.ok(/\?\s*buildStateFrom\(/.test(seed),
      `빈 상태를 buildStateFrom 으로 만들지 않는다(계약 G 와 모양이 갈라진다): ${seed}`);
    //  ★ 브라우저 갈래는 살아 있어야 한다 — 없애면 웹에서 저장이 통째로 사라진다.
    assert.ok(/:\s*load\(\)/.test(seed),
      `브라우저 갈래(: load())가 사라졌다 — 비-HOST 에서는 localStorage 가 진짜 출처다: ${seed}`);
  },

  //  ⑧ 열람 창은 부팅 때 호스트에게 **아무것도 요구하지 않는다.**
  //  ★ 이 계약을 루프 검사(loop-peer-frame)는 **원리적으로 못 본다** — 봉인 계기(postMessage 스파이)를
  //    프레임이 다 뜬 **뒤에** 붙이기 때문에 부팅 시점의 호출은 이미 지나갔다.
  //    C4 변이 감사(2026-09-04)에서 `if(!PEER)` 를 떼어도 루프 153건이 전부 초록이었다.
  //  ★ 정정: 그 변이가 '남의 창에 내 것이 뜬다'를 일으키지는 **않았다**(실측: 프레임은 대상 51건 유지).
  //    호스트 회신이 ExecuteScriptAsync — 최상위 문서 전용 — 이라 프레임에 안 닿기 때문이다.
  //    그래도 막아야 하는 이유: ① 내 user_id 로 부팅 조회가 한 번 더 나간다(헛일)
  //    ② 이 줄은 hpost 봉인을 **우회하는 유일한 자리**다. 그 예외를 늘리지 않는다.
  //  ★ 정규식으로 '그 줄 앞부분' 을 잡으려다 2MB 파일에서 파멸적 역추적이 났다(실측: 10분 초과).
  //    문자열 인덱스로 줄만 잘라 본다 — 같은 판정, 상수 시간.
  peerSendsNothingAtBoot(app) {
    const NEEDLE = "window.chrome.webview.postMessage(JSON.stringify({cmd:'ready'}))";
    const i = app.indexOf(NEEDLE);
    assert.ok(i > 0, '부팅의 ready 전송 줄을 찾지 못했다 — 모양이 바뀌었다면 이 검사도 함께 고칠 것 ' +
      '(안 고치면 게이트가 조용히 검사 없는 상태가 된다)');
    assert.strictEqual(app.indexOf(NEEDLE, i + 1), -1,
      'ready 전송이 두 곳 이상이다 — 새로 생긴 곳에도 같은 가드가 필요하다');
    const lineStart = app.lastIndexOf('\n', i) + 1;
    const before = app.slice(lineStart, i);
    assert.ok(/\bif\s*\(\s*!\s*PEER\s*\)/.test(before),
      `부팅의 ready 전송에 if(!PEER) 가드가 없다(그 줄 앞부분: "${before.trim().slice(0, 60)}") — ` +
      '열람 창이 호스트로 직접 나간다. 이 줄은 hpost 봉인을 우회하는 유일한 자리라 ' +
      '루프 검사가 못 본다(계기가 부팅 뒤에 붙는다). 여기서만 지킬 수 있다');
  },
};

test('출처①: 출처가 하나다 — XML 갈래가 되살아나지 않았다', () => checks.singleSource(src, mainwin));
test('출처②: 위젯의 저장은 DB 로만 간다(XML 쓰기 문이 없다)', () => checks.widgetSavesOnlyToDb(src));
test('출처③: DB 읽기 실패가 XML 로 조용히 되돌아가지 않는다', () => checks.noSilentXmlFallback(mainwin));
test('출처④: 부팅이 buildStateFrom 으로 조립한다', () => checks.stateBuilderShared(src));
test('출처⑤: DB 경로가 XML 전용 이관 절차를 부르지 않는다', () => checks.dbPathSkipsXmlMigrations(src));
test('출처⑤b: 열람 창의 출처는 주입 하나뿐이다(로컬 저장소를 씨앗으로 안 쓴다)', () =>
  checks.peerSeedsEmptyNotLocal(src));
test('출처⑤c: 열람 창은 부팅 때 호스트에 아무것도 요구하지 않는다(루프 검사가 못 보는 자리)', () =>
  checks.peerSendsNothingAtBoot(src));

test('출처⑥: 지금 어느 저장소를 쓰는지 화면에 드러낸다', () => {
  assert.ok(/renderDataSourceBadge/.test(src), '출처 배지 함수가 없다');
  assert.ok(/DB 연결됨/.test(src) && /DB 읽기 전용/.test(src),
    '배지가 쓰기 가능/읽기 전용 두 상태를 구분하지 않는다 — 사용자가 저장되는지 알 수 없다');
});

test('출처⑦: DB 저장은 직렬화된다(앞 저장 중이면 겹쳐 보내지 않는다)', () => {
  const body = bodyOf(src, 'function dbSave(opt){');
  assert.ok(/__dbSaving/.test(body),
    '진행 중 가드가 없다 — 겹쳐 보내면 뒤 요청이 낡은 토큰으로 가서 멀쩡한 저장이 충돌로 거부된다');
  assert.ok(/__dbDirty/.test(body), '저장 중 변경을 기억하지 않는다 — 마지막 편집이 유실된다');
  assert.ok(/JSON\.parse\(JSON\.stringify\(state\)\)/.test(body),
    '보내는 순간의 상태를 고정하지 않는다 — 왕복 중 state 가 바뀌면 무엇을 저장했는지 알 수 없다');
});

test('출처⑧: 충돌은 자동 재시도하지 않고 사용자에게 남는다', () => {
  const body = bodyOf(src, 'function dbSave(opt){');
  const conflictAt = body.indexOf('res.conflict');
  assert.ok(conflictAt > 0, '충돌을 구분해 다루지 않는다');
  assert.ok(/showDbConflict\(/.test(body),
    '충돌을 지속 안내로 띄우지 않는다 — 토스트는 사라지고, 그 뒤 편집도 전부 거부된다');
  //  실패 경로에서 dirty 를 내려 자동 재시도를 끊어야 한다(같은 토큰으로 다시 보내면 또 거부된다)
  assert.ok(/__dbDirty = false;\s*\/\/ 실패했으면/.test(body) || /__dbDirty = false;/.test(body.slice(body.indexOf('return;'))),
    '실패 후 자동 재시도를 끊지 않는다 — 낡은 토큰으로 무한히 거부된다');
});

// ── 변이 시험 ────────────────────────────────────────────────────────
test('변이⑧: 출처 갈래 변수를 되살리면 출처① 이 실패한다', () => {
  const bad = src + "\nlet __dataSource = 'db';\n";
  assert.throws(() => checks.singleSource(bad, mainwin), /출처 갈래 변수/);
});

test('변이⑮: isDbHost 의 HOST 조건을 빼면 출처① 이 실패한다(브라우저 저장이 막힌다)', () => {
  const bad = mutate('const isDbHost = () => HOST;', 'const isDbHost = () => true;', src);
  assert.throws(() => checks.singleSource(bad, mainwin), /HOST 로 정의돼 있지 않다/);
});

test('변이⑯: __applyXml 주입 경로를 되살리면 출처① 이 실패한다', () => {
  const bad = src + '\nwindow.__applyXml = function(t){ };\n';
  assert.throws(() => checks.singleSource(bad, mainwin), /__applyXml/);
});

test('변이⑯b: 호스트에 TC_DATA_SOURCE 를 되살리면 출처① 이 실패한다', () => {
  const bad = mainwin + '\nvar x = Environment.GetEnvironmentVariable("TC_DATA_SOURCE");\n';
  assert.throws(() => checks.singleSource(src, bad), /출처 환경변수/);
});

test('변이⑨: save() 의 위젯 갈래를 빼면 출처② 가 실패한다', () => {
  const bad = mutate('if(isDbHost()){ dbSave(); return; }', 'if(false){ }', src);
  assert.throws(() => checks.widgetSavesOnlyToDb(bad), /위젯 갈래가 없다/);
});

test('변이⑩: 갈래가 return 없이 dbSave 만 부르면 출처② 가 실패한다(DB·localStorage 둘 다 쓴다)', () => {
  const bad = mutate('if(isDbHost()){ dbSave(); return; }', 'if(isDbHost()){ dbSave(); }', src);
  assert.throws(() => checks.widgetSavesOnlyToDb(bad), /return 으로 끊지 않는다/);
});

test('변이⑩b: cmd:\'save\'(XML 파일 쓰기)를 되살리면 출처② 가 실패한다', () => {
  const bad = src + "\nfunction x(){ postMessage({cmd:'save', xml: toXML()}); }\n";
  assert.throws(() => checks.widgetSavesOnlyToDb(bad), /cmd:'save'/);
});

test('변이⑪: DB 부팅이 실패 시 __applyXml 로 폴백하면 출처③ 이 실패한다', () => {
  const bad = mutate('ApplyStateError("서버에 연결하지 못했습니다: " + ex.Message);',
    '_ = web.CoreWebView2.ExecuteScriptAsync("window.__applyXml(\\"\\")");', mainwin);
  assert.throws(() => checks.noSilentXmlFallback(bad), /__applyXml 을 부른다/);
});

test('변이⑫: DB 경로가 fromXML 을 거치면 출처④ 가 실패한다', () => {
  const bad = mutate('    const data = (typeof json === \'string\') ? JSON.parse(json) : json;',
    '    const data = fromXML(json);', src);
  assert.throws(() => checks.stateBuilderShared(bad), /fromXML 을 거친다/);
});

test('변이⑬: DB 경로가 migrateLocalStores 를 부르면 출처⑤ 가 실패한다', () => {
  const bad = mutate('    renderAll();\n    pushReminders();', '    renderAll();\n    migrateLocalStores();\n    pushReminders();', src);
  assert.throws(() => checks.dbPathSkipsXmlMigrations(bad), /migrateLocalStores\(\) 를 부른다/);
});

test('변이·부팅전송: if(!PEER) 를 떼면 출처⑤c 가 잡는다(루프 153건은 침묵했다)', () => {
  //  ★ C4 변이 감사에서 실제로 통과해 버린 변이다 — 루프 검사의 계기가 부팅 뒤에 붙어서다.
  const bad = mutate("if(!PEER) try{ window.chrome.webview.postMessage(JSON.stringify({cmd:'ready'})); }catch(e){}",
                     "try{ window.chrome.webview.postMessage(JSON.stringify({cmd:'ready'})); }catch(e){}", src);
  assert.throws(() => checks.peerSendsNothingAtBoot(bad), /if\(!PEER\) 가드가 없다/);
  //  전송 줄 자체가 사라진 경우(=게이트 폐기)도 조용히 통과하면 안 된다.
  const gone = mutate("if(!PEER) try{ window.chrome.webview.postMessage(JSON.stringify({cmd:'ready'})); }catch(e){}",
                      '/* 부팅 전송 없음 */', src);
  assert.throws(() => checks.peerSendsNothingAtBoot(gone), /찾지 못했다/);
});

test('변이·씨앗: 부팅 씨앗을 옛 모양으로 되돌리면 출처⑤b 가 잡는다', () => {
  const NOW = 'let state = (HOST || PEER) ? buildStateFrom({ categories: [], entries: [] }) : load();';
  //  ① 2026-09-03 이전의 실제 코드 — 프레임도 위젯도 내 localStorage 를 집어왔다.
  assert.throws(() => checks.peerSeedsEmptyNotLocal(mutate(NOW, 'let state = load();', src)),
    /PEER 를 가르지 않는다/);
  //  ② PEER 만 고치고 HOST 를 빠뜨린 '반쪽 수정'(내가 실제로 그렇게 멈출 뻔했다).
  assert.throws(() => checks.peerSeedsEmptyNotLocal(
    mutate(NOW, 'let state = PEER ? buildStateFrom({ categories: [], entries: [] }) : load();', src)),
    /HOST 를 가르지 않는다/);
  //  ③ 샘플 시드로 바꾸는 수정 — 없는 일정이 자기 일정처럼 뜬다.
  assert.throws(() => checks.peerSeedsEmptyNotLocal(
    mutate(NOW, 'let state = (HOST || PEER) ? defaultState() : load();', src)), /샘플 시드/);
  //  ④ 브라우저 갈래를 없애는 과잉 수정 — 웹에서 저장이 통째로 사라진다.
  assert.throws(() => checks.peerSeedsEmptyNotLocal(
    mutate(NOW, 'let state = buildStateFrom({ categories: [], entries: [] });', src)),
    /PEER 를 가르지 않는다|브라우저 갈래/);
});

test('변이⑬b: 주석을 걷어도 **진짜** save() 호출은 여전히 잡힌다', () => {
  //  ★ 주석 제거를 넣은 뒤 이 검사가 물렁해지지 않았는지 확인한다 —
  //    "오검출을 없앴다" 가 "아무것도 안 잡는다" 로 바뀌는 것이 이런 완화의 흔한 결말이다.
  const bad = mutate('    renderAll();\n    pushReminders();', '    renderAll();\n    save();\n    pushReminders();', src);
  assert.throws(() => checks.dbPathSkipsXmlMigrations(bad), /save\(\) 를 부른다/);
  //  그리고 주석 안의 save() 는 **잡지 않아야** 한다(그게 이 완화의 목적이다).
  const okSrc = mutate('    renderAll();\n    pushReminders();',
                       '    renderAll();\n    // save() 는 여기서 부르지 않는다\n    pushReminders();', src);
  checks.dbPathSkipsXmlMigrations(okSrc);
});

test('변이⑭: 미등록 사용자 구분을 없애면 출처③ 이 실패한다', () => {
  const bad = mutate('catch (CalendarUserNotFoundException ex)', 'catch (InvalidOperationException ex)', mainwin);
  assert.throws(() => checks.noSilentXmlFallback(bad), /미등록 사용자를 연결 실패와 구분하지 않는다/);
});

/* ── ⑥ 전량 교체(가져오기·초기화) ──────────────────────────────────────── */

const writedb = readFileSync(new URL('../widget/CalendarWriteDb.cs', import.meta.url), 'utf8');

//  전량 삭제가 **절대 건드리면 안 되는** 표. 각 항목에 왜 안 되는지를 함께 적는다 —
//  이유 없이 목록만 있으면 다음 사람이 하나 지우고 통과시킨다.
const NEVER_WIPE = [
  ['cal_user_rev',      'rev 는 단조증가여야 삭제까지 감지된다(§3.1). DELETE 권한도 없다'],
  ['cal_migration_log', '재실행 방지 마커. 지우면 같은 XML 을 두 번 넣을 수 있다'],
  ['cal_report_daily',  '보고한 사실은 캘린더 데이터가 아니다 — 가져오기로 지난 보고 이력이 사라지면 안 된다'],
  ['cal_report_hours',  '위와 같다(cal_report_daily 의 자식)'],
  ['cal_report_weekly', '위와 같다'],
];

const c6 = {
  //  ⑥-1 가져오기·초기화가 통상 저장이 아니라 전량 교체로 간다
  importUsesReplaceAll(app) {
    const im = app.indexOf('function applyImport(');
    assert.ok(im > 0, 'applyImport 를 찾지 못했다');
    const tail = app.slice(im, app.indexOf('async function clearAll'));
    assert.ok(/saveFull\(\)/.test(tail),
      '가져오기가 saveFull() 로 저장하지 않는다 — 통상 저장으로 새면 전량 교체가 아니게 되고, 무엇보다 되돌릴 수 없는 조작이 로그에서 평범한 저장과 구분되지 않는다');
    const ca = app.indexOf('async function clearAll');
    assert.ok(/saveFull\(\)/.test(app.slice(ca, ca + 1600)),
      '전체 초기화가 saveFull() 로 저장하지 않는다');
  },

  //  ⑥-2 saveFull 이 DB 모드에서 replaceAll 을 실어 보낸다
  saveFullSendsReplaceAll(app) {
    const b = bodyOf(app, 'function saveFull(){');
    assert.ok(/dbSave\(\s*\{\s*replaceAll:\s*true\s*\}\s*\)/.test(b),
      'saveFull 이 replaceAll 을 켜지 않는다 — 그러면 통상 차분 저장과 같아진다');
    const d = bodyOf(app, 'function dbSave(opt){');
    assert.ok(/replaceAll \? 'replaceAllState' : 'saveState'/.test(d),
      'dbSave 가 명령을 가르지 않는다 — 호스트가 전량 교체인지 알 길이 없다');
  },

  //  ⑥-3 호스트가 그 명령을 받아 replaceAll 로 넘긴다
  hostHandlesReplaceAll(cs) {
    assert.ok(/case "replaceAllState":/.test(cs),
      '호스트에 replaceAllState 명령이 없다 — 웹이 보내도 아무 일도 일어나지 않는다(조용한 무동작)');
    assert.ok(/SaveStateToDbAsync\([^)]*replaceAll:\s*true\)/.test(cs),
      'replaceAllState 가 replaceAll:true 로 저장을 부르지 않는다 — 명령만 갈리고 동작은 통상 저장이 된다');
  },

  //  ⑥-4 전량 삭제가 지우면 안 되는 표를 건드리지 않는다
  wipeSpares(cs) {
    const i = cs.indexOf('if (replaceAll)');
    assert.ok(i > 0, '쓰기 계층에 전량 교체 블록이 없다');
    const blk = cs.slice(i, cs.indexOf('// ── 2.', i));
    assert.ok(blk.length > 0 && blk.length < 4000, '전량 교체 블록의 끝을 잘못 잡았다');
    for (const [t, why] of NEVER_WIPE) {
      assert.ok(!new RegExp('DELETE FROM ' + t + '\\b').test(blk),
        `전량 교체가 ${t} 을(를) 지운다 — ${why}`);
    }
  },

  //  ⑥-5 삭제가 발번보다 **먼저** 온다
  wipeBeforeNumbering(cs) {
    const wipe = cs.indexOf('if (replaceAll)');
    const num = cs.indexOf('IFNULL(MAX(cat_no),0)');
    assert.ok(wipe > 0 && num > 0, '전량 교체 블록 또는 발번을 찾지 못했다');
    assert.ok(wipe < num,
      '전량 삭제가 발번보다 뒤에 온다 — MAX(<표>_no) 가 지워질 행을 세어 번호가 1 부터 다시 붙지 않는다');
  },

  //  ⑥-6 FK 순서 — cal_category 는 반드시 마지막
  wipeOrderRespectsFk(cs) {
    const i = cs.indexOf('if (replaceAll)');
    const blk = cs.slice(i, cs.indexOf('// ── 2.', i));
    const at = (t) => blk.indexOf('DELETE FROM ' + t);
    for (const t of ['cal_task_hours', 'cal_entry', 'cal_todo']) {
      assert.ok(at(t) > 0, `전량 교체가 ${t} 를 지우지 않는다`);
      assert.ok(at(t) < at('cal_category'),
        `${t} 를 cal_category 보다 나중에 지운다 — FK 가 RESTRICT 라 ERROR 1451 로 죽는다`);
    }
  },
};

test('교체①: 가져오기·초기화가 전량 교체로 간다', () => c6.importUsesReplaceAll(src));
test('교체②: saveFull 이 replaceAll 명령으로 보낸다', () => c6.saveFullSendsReplaceAll(src));
test('교체③: 호스트가 replaceAllState 를 받아 replaceAll 로 넘긴다', () => c6.hostHandlesReplaceAll(mainwin));
test('교체④: 전량 삭제가 rev·이관마커·보고기록을 건드리지 않는다', () => c6.wipeSpares(writedb));
test('교체⑤: 전량 삭제가 발번보다 먼저 온다', () => c6.wipeBeforeNumbering(writedb));
test('교체⑥: 전량 삭제 순서가 FK 를 지킨다(과제가 마지막)', () => c6.wipeOrderRespectsFk(writedb));

test('변이⑲: 가져오기를 통상 저장으로 되돌리면 교체① 이 실패한다', () => {
  const bad = mutate("  saveFull(); closeModal('#importModal')", "  save(); closeModal('#importModal')", src);
  assert.throws(() => c6.importUsesReplaceAll(bad), /saveFull\(\) 로 저장하지 않는다/);
});

test('변이⑳: 전량 삭제에 cal_user_rev 를 끼워 넣으면 교체④ 가 실패한다', () => {
  const bad = mutate('                    wiped += await Exec(conn, tx, $"DELETE FROM cal_task_hours WHERE user_id={u}", ct);',
    '                    wiped += await Exec(conn, tx, $"DELETE FROM cal_user_rev WHERE user_id={u}", ct);', writedb);
  assert.throws(() => c6.wipeSpares(bad), /cal_user_rev 을\(를\) 지운다/);
});

test('변이㉑: 삭제를 발번 뒤로 옮기면 교체⑤ 가 실패한다', () => {
  //  블록 자체를 발번 뒤로 옮긴 상태를 흉내낸다 — 표식을 지우고 뒤쪽에 다시 심는다.
  const bad = writedb.replace('if (replaceAll)', 'if (REPLACE_ALL_MOVED)')
    .replace('IFNULL(MAX(cat_no),0)', 'IFNULL(MAX(cat_no),0)/*x*/ if (replaceAll)');
  assert.notStrictEqual(bad, writedb, '변이가 원본을 바꾸지 못했다');
  assert.throws(() => c6.wipeBeforeNumbering(bad), /발번보다 뒤에 온다/);
});

test('변이㉒: 호스트가 replaceAll 을 통상 저장으로 넘기면 교체③ 이 실패한다', () => {
  const bad = mutate('_ = SaveStateToDbAsync(rid, rj, replaceAll: true);', '_ = SaveStateToDbAsync(rid, rj);', mainwin);
  assert.throws(() => c6.hostHandlesReplaceAll(bad), /replaceAll:true 로 저장을 부르지 않는다/);
});

/* ── ⑦ 미이관 표시등 + 가져오기 파일창 ─────────────────────────────────── */
//  자동이관을 폐기했으므로(2026-09-01) 이관은 사용자가 「XML 가져오기」로 한다.
//  그 결정이 성립하려면 둘이 필요하다:
//    ① 이관하지 않은 사람이 **빈 화면을 사고로 오해하지 않게** 길을 알려 준다
//    ② 그 길이 실제로 걸을 만해야 한다 — 파일창이 데이터 폴더에서 열려야 한다
//  둘 중 하나만 빠져도 "명시적 이관" 은 89명 중 상당수에게 일어나지 않는다.

const c7 = {
  //  ⑦-1 빈 캘린더면 안내가 뜬다. 그리고 그것은 **안내일 뿐** 아무것도 하지 않는다.
  emptyHintGuidesOnly(app) {
    const b = bodyOf(app, 'function renderEmptyHint(){');
    assert.ok(/categories.*length.*entries.*length/s.test(b), '빈 상태 판정이 없다');
    assert.ok(/startImport\(\)/.test(b), '안내가 가져오기로 이어지지 않는다 — 길을 알려 주지 않으면 안내가 아니다');
    //  ★ 표시등이지 트리거가 아니다 — 여기서 데이터를 옮기면 그것이 자동이관이다.
    for (const f of ['applyImport', 'saveFull', 'dbSave', 'fromXML'])
      assert.ok(!b.includes(f),
        `안내가 ${f}() 를 부른다 — 그 순간 자동이관이 된다(부팅이 사용자 동의 없이 데이터를 바꾼다). 안내는 길만 알려 준다`);
    //  부팅 경로가 실제로 이 안내를 부르는지
    const db = bodyOf(app, 'window.__applyState = function(json, meta){');
    assert.ok(/renderEmptyHint\(\)/.test(db), '부팅이 빈 캘린더 안내를 부르지 않는다 — 미이관자가 빈 화면만 본다');
  },

  //  ⑦-2 위젯의 가져오기는 호스트 파일창으로 간다(기본 폴더 = 데이터 폴더)
  importOpensAtDataDir(app, cs) {
    const b = bodyOf(app, 'function startImport(){');
    assert.ok(/!HOST/.test(b), '브라우저 갈래가 없다 — 호스트 없는 곳에서 가져오기가 죽는다');
    assert.ok(/pickImportXml/.test(b),
      '위젯이 호스트 파일창을 쓰지 않는다 — <input type=file> 은 시작 폴더를 정할 수 없어 사용자가 %APPDATA% 를 손으로 찾아 들어가야 한다');
    assert.ok(/case "pickImportXml":/.test(cs), '호스트에 pickImportXml 명령이 없다 — 웹이 불러도 무동작이다');
    const impl = bodyOf(cs, 'private void PickImportXml(string reqId)');
    assert.ok(/InitialDirectory\s*=\s*Directory\.Exists\(_dataDir\)/.test(impl),
      '파일창이 데이터 폴더에서 열리지 않는다 — 옮길 파일이 거기 있는데 사용자가 찾아 들어가야 한다');
    //  ★ 경로가 아니라 **내용**을 돌려줘야 한다. 경로를 주면 다음에 '저장해 두자' 가 되고,
    //    그 순간 data.xml 이 다시 데이터 출처가 된다(방금 폐기한 것이다).
    assert.ok(/text = File\.ReadAllText/.test(impl) && /name = fi\.Name, text/.test(impl),
      '파일창이 내용을 읽어 넘기지 않는다 — 경로를 넘기면 data.xml 이 출처로 되살아나는 문이 열린다');
  },

  //  ⑦-3 두 진입점이 미리보기를 공유한다
  previewShared(app) {
    assert.ok(/function showImportPreview\(name, text\)\{/.test(app), 'showImportPreview 가 없다');
    for (const [fn, why] of [['startImport', '호스트 파일창'], ['onImportFile', '<input type=file>']]) {
      const b = bodyOf(app, `function ${fn}(`);
      assert.ok(/showImportPreview\(/.test(b),
        `${why} 진입점이 공용 미리보기를 쓰지 않는다 — 갈라 두면 한쪽만 고쳐진다`);
    }
  },
};

test('표시등①: 빈 캘린더 안내가 뜨고, 안내일 뿐이다(자동이관 금지)', () => c7.emptyHintGuidesOnly(src));
test('표시등②: 가져오기 파일창이 데이터 폴더에서 열리고 내용을 넘긴다', () => c7.importOpensAtDataDir(src, mainwin));
test('표시등③: 두 진입점이 미리보기를 공유한다', () => c7.previewShared(src));

test('변이㉓: 안내가 가져오기를 대신 실행하면 표시등① 이 실패한다(자동이관 부활)', () => {
  const bad = mutate("  btn.addEventListener('click', () => startImport());",
    "  btn.addEventListener('click', () => startImport()); applyImport('merge');", src);
  assert.throws(() => c7.emptyHintGuidesOnly(bad), /자동이관이 된다/);
});

test('변이㉔: 파일창 기본 폴더를 없애면 표시등② 가 실패한다', () => {
  const bad = mutate('InitialDirectory = Directory.Exists(_dataDir) ? _dataDir : "",', 'InitialDirectory = "",', mainwin);
  assert.throws(() => c7.importOpensAtDataDir(src, bad), /데이터 폴더에서 열리지 않는다/);
});

test('변이㉕: 파일창이 경로를 넘기면 표시등② 가 실패한다', () => {
  const bad = mutate('GitReply(reqId, new { ok = true, name = fi.Name, text });',
    'GitReply(reqId, new { ok = true, name = fi.Name, path = dlg.FileName });', mainwin);
  assert.throws(() => c7.importOpensAtDataDir(src, bad), /내용을 읽어 넘기지 않는다/);
});

test('변이㉖: 부팅이 빈 캘린더 안내를 안 부르면 표시등① 이 실패한다', () => {
  //  ★ 안내는 이제 if(!PEER) 안에 있다 — 열람 창에 내 이관 안내가 뜨던 것을 막으면서 옮겼다.
  const bad = mutate('if(!PEER){ renderDataSourceBadge(meta); renderEmptyHint(); }',
                     'if(!PEER){ renderDataSourceBadge(meta); }', src);
  assert.throws(() => c7.emptyHintGuidesOnly(bad), /부팅이 빈 캘린더 안내를 부르지 않는다/);
});

/* ── ⑧ 낡은 클라이언트의 파괴적 연산 차단 (설계 §5.5 · P1-1) ─────────────── */
//  전제: 스키마는 앞으로도 오른다(migrate-*.sql). 그때 낡은 위젯이 **전량 교체**를 돌리면
//    자기가 아는 모양으로 통째로 다시 넣기 때문에, 새 스키마에서 늘어난 값이 조용히 사라진다.
//    차분 저장은 자기가 아는 컬럼만 건드리므로 그 사고가 없다 — 그래서 §5.5 는 **파괴적 연산만**
//    막고 조회·편집은 계속되게 하라고 못박았다. 이 절은 그 '만' 을 양쪽에서 잠근다:
//      · 막아야 할 것을 안 막는가 (전량 교체)
//      · 막지 말아야 할 것을 막는가 (통상 저장)

const grants = readFileSync(new URL('../db/deploy/grants-calendar.sql', import.meta.url), 'utf8');

const c8 = {
  //  ⑧-1 게이트가 **트랜잭션을 열기 전에** 있다. 열고 나서 막으면 rev 가 이미 올라 있고
  //       (§3.1 의 첫 문장) 롤백해도 '아무것도 안 했다'가 아니게 된다 — 다음 사람이
  //       "왜 실패한 저장이 rev 를 올렸나"를 다시 조사한다.
  gateBeforeTransaction(cs) {
    const g = cs.indexOf('if (replaceAll && !string.Equals(prev.SchemaVersion');
    assert.ok(g > 0, '쓰기 계층에 스키마 게이트가 없다 — 다음 ALTER 순간 낡은 위젯이 그대로 전량 교체한다');
    const tx = cs.indexOf('BeginTransactionAsync');
    assert.ok(tx > 0, '트랜잭션 시작을 찾지 못했다');
    assert.ok(g < tx, '스키마 게이트가 트랜잭션을 연 뒤에 있다 — 거부해도 rev 가 이미 올라간다(§3.1)');
    assert.ok(/CalendarDb\.ExpectedSchemaVersion/.test(cs.slice(g, g + 400)),
      '게이트가 위젯 상수(CalendarDb.ExpectedSchemaVersion)와 비교하지 않는다');
  },

  //  ⑧-2 통상 저장은 **막지 않는다**(§5.5 "전 쓰기 봉인은 과하다"). 게이트 조건에서 replaceAll 이
  //       빠지면 낡은 위젯을 쓰는 사람은 그날 하루 아무것도 저장하지 못한다.
  normalSaveNotBlocked(cs) {
    const g = cs.indexOf('if (replaceAll && !string.Equals(prev.SchemaVersion');
    assert.ok(g > 0, '스키마 게이트를 찾지 못했다');
    //  게이트 앞에 다른 스키마 비교가 또 있으면 그쪽이 통상 저장까지 막고 있을 수 있다.
    assert.ok(!/ExpectedSchemaVersion/.test(cs.slice(0, g)),
      '게이트보다 앞에서 스키마를 또 비교한다 — 통상 저장까지 막고 있지 않은지 확인할 것(§5.5)');
  },

  //  ⑧-3 거부는 **충돌과 구분되는 신호**로 나간다. 같은 상자에 담으면 사용자가 '새로고침'만
  //       반복한다 — 그건 위젯을 업데이트하기 전에는 영원히 안 풀리는 실패다.
  mismatchIsNotConflict(cs, mw, app) {
    assert.ok(/public bool SchemaMismatch \{ get; init; \}/.test(cs),
      '결과에 SchemaMismatch 가 없다 — 호스트가 충돌과 구분해 넘길 방법이 없다');
    assert.ok(/schemaMismatch = r\.SchemaMismatch/.test(mw),
      '호스트가 schemaMismatch 를 웹으로 넘기지 않는다');
    const d = bodyOf(app, 'function dbSave(opt){');
    const i = d.indexOf('res.schemaMismatch');
    const j = d.indexOf('res.conflict');
    assert.ok(i > 0, '웹이 schemaMismatch 를 읽지 않는다');
    assert.ok(i < j, '스키마 불일치보다 충돌 분기가 먼저다 — 불일치가 충돌 상자로 샌다');
  },

  //  ⑧-4 부팅 meta 가 두 판본을 함께 실어, 화면이 '어느 쪽이 낡았는지'를 말할 수 있게 한다.
  bootMetaCarriesBoth(mw, app) {
    assert.ok(/expectedSchema = CalendarDb\.ExpectedSchemaVersion/.test(mw) && /schemaMismatch,/.test(mw),
      '부팅 meta 에 expectedSchema·schemaMismatch 가 없다 — 배지가 서버 값만 보고 정상으로 보인다');
    const b = bodyOf(app, 'function renderDataSourceBadge(meta){');
    assert.ok(/m\.schemaMismatch/.test(b) && /var\(--danger\)/.test(b),
      '배지가 스키마 불일치를 경고 톤으로 알리지 않는다');
  },

  //  ⑧-5 웹은 **누르기 전에** 막는다(UX). 진짜 방어는 호스트지만, 눌러 본 뒤 거부당하는 흐름은
  //       특히 「전체 초기화」에서 나쁘다 — 화면만 비고 DB 는 그대로라 사용자가 사고로 읽는다.
  webGatesBothEntrances(app) {
    for (const [fn, why] of [['function startImport(){', '가져오기'], ['async function clearAll(){', '전체 초기화']]) {
      const b = bodyOf(app, fn);
      assert.ok(/schemaBlocked\(\)/.test(b), `${why} 진입점에 스키마 게이트가 없다`);
    }
    const g = bodyOf(app, 'function schemaBlocked(){');
    assert.ok(/__bootMeta/.test(g) && /toast\(/.test(g), '게이트가 부팅 meta 를 읽거나 사유를 알리지 않는다');
  },

  //  ⑧-6 앱 계정은 버전 행을 **읽기만** 한다(§5.5 ★). 한 줄이라도 쓰기를 주면 막으려는 대상이
  //       자기 통과증을 발급할 수 있게 되어 이 게이트 전체가 무의미해진다.
  versionRowIsReadOnlyForApp(sql) {
    const lines = sql.split(/\r?\n/).filter((l) => /^\s*GRANT\b/.test(l) && /cal_schema_meta/.test(l));
    assert.ok(lines.length > 0, 'cal_schema_meta 에 대한 GRANT 가 없다 — 앱이 버전을 읽지 못한다');
    for (const l of lines) {
      const verbs = l.slice(l.indexOf('GRANT') + 5, l.indexOf(' ON ')).split(',').map((s) => s.trim().toUpperCase());
      assert.deepStrictEqual(verbs, ['SELECT'],
        `cal_schema_meta 에 SELECT 외의 권한을 준다(${verbs.join(', ')}) — ` +
        '낡은 클라이언트가 스스로 버전을 올려 게이트를 통과할 수 있게 된다(§5.5 ★)');
    }
  },
};

test('낡은①: 전량 교체 게이트가 트랜잭션을 열기 전에 있다', () => c8.gateBeforeTransaction(writedb));
test('낡은②: 통상 저장은 막지 않는다(§5.5 — 조회·편집은 계속되게)', () => c8.normalSaveNotBlocked(writedb));
test('낡은③: 스키마 불일치가 낙관적 잠금 충돌과 구분돼 나간다', () => c8.mismatchIsNotConflict(writedb, mainwin, src));
test('낡은④: 부팅 meta 가 서버·위젯 두 판본을 함께 싣고 배지가 경고한다', () => c8.bootMetaCarriesBoth(mainwin, src));
test('낡은⑤: 가져오기·초기화 진입점이 누르기 전에 사유를 알린다', () => c8.webGatesBothEntrances(src));
test('낡은⑥: 앱 계정의 cal_schema_meta 권한은 SELECT 하나뿐이다(§5.5 ★)', () => c8.versionRowIsReadOnlyForApp(grants));

test('변이㉗: 게이트를 트랜잭션 뒤로 옮기면 낡은① 이 실패한다', () => {
  const bad = writedb
    .replace('if (replaceAll && !string.Equals(prev.SchemaVersion', 'if (SCHEMA_GATE_MOVED && !string.Equals(prev.SchemaVersion')
    .replace('BeginTransactionAsync', 'BeginTransactionAsync/*x*/ if (replaceAll && !string.Equals(prev.SchemaVersion');
  assert.notStrictEqual(bad, writedb, '변이가 원본을 바꾸지 못했다');
  assert.throws(() => c8.gateBeforeTransaction(bad), /트랜잭션을 연 뒤에 있다/);
});

test('변이㉘: 게이트에서 replaceAll 조건을 빼면(통상 저장까지 봉인) 낡은①·② 가 실패한다', () => {
  const bad = mutate('if (replaceAll && !string.Equals(prev.SchemaVersion', 'if (!string.Equals(prev.SchemaVersion', writedb);
  assert.throws(() => c8.gateBeforeTransaction(bad), /스키마 게이트가 없다/);
  assert.throws(() => c8.normalSaveNotBlocked(bad), /스키마 게이트를 찾지 못했다/);
});

test('변이㉙: 불일치를 충돌 상자에 담으면 낡은③ 이 실패한다', () => {
  const bad = mutate("    if(res && res.schemaMismatch) toast((res.error || '위젯 업데이트가 필요합니다'), 'error');\n    else if(res && res.conflict)",
    '    if(res && res.conflict)', src);
  assert.throws(() => c8.mismatchIsNotConflict(writedb, mainwin, bad), /schemaMismatch 를 읽지 않는다/);
});

test('변이㉚: 가져오기 게이트를 없애면 낡은⑤ 가 실패한다', () => {
  const bad = mutate('  if(schemaBlocked()) return;   // P1-1 — 낡은 위젯의 전량 교체는 호스트가 거부한다. 여기서 사유를 먼저 알린다\n', '', src);
  assert.throws(() => c8.webGatesBothEntrances(bad), /가져오기 진입점에 스키마 게이트가 없다/);
});

test('변이㉛: 버전 행에 UPDATE 권한을 주면 낡은⑥ 이 실패한다', () => {
  const bad = mutate("GRANT SELECT ON taskmgr.cal_schema_meta TO 'taskmgr_app'@'%';",
    "GRANT SELECT, UPDATE ON taskmgr.cal_schema_meta TO 'taskmgr_app'@'%';", grants);
  assert.throws(() => c8.versionRowIsReadOnlyForApp(bad), /SELECT 외의 권한을 준다/);
});

/* ── ⑨ 가져오기 후 원본 개명 (설계 §8 · P1-8) ───────────────────────────── */
//  왜: 이관을 마친 파일이 원래 이름 그대로 남아 있으면 **다음에 또 가져온다.** 그 사이의 편집이
//    통째로 옛 파일로 덮이고 되돌릴 경로가 없다(가져오기는 전량 교체다). 이름에 이관 사실이
//    적혀 있으면 파일창에서 눈으로 걸러진다.
//  ★ 지우지 않는다 — 이관 결과를 사람이 대조할 유일한 원본이다.

const c9 = {
  //  ⑨-1 경로는 **pick 에서만** 기억한다. 다른 곳에서 세우기 시작하면 '무엇을 개명하는가'가
  //       추적 불가가 되고, 무엇보다 사용자가 고르지 않은 파일이 대상이 될 수 있다.
  pathSetOnlyByPicker(cs) {
    const pick = bodyOf(cs, 'private void PickImportXml(string reqId)');
    assert.ok(/_lastImportPath = dlg\.FileName;/.test(pick), '파일창이 고른 경로를 기억하지 않는다');
    assert.ok(/_lastImportPath = null;/.test(pick), '새 선택 때 지난 선택을 지우지 않는다(취소·실패가 남는다)');
    //  세팅은 **읽은 뒤**에 온다 — 읽기가 실패한 파일이 개명 대상이 되면 안 된다.
    assert.ok(pick.indexOf('File.ReadAllText') < pick.indexOf('_lastImportPath = dlg.FileName'),
      '파일을 읽기 전에 개명 대상으로 기억한다 — 읽기 실패한 파일이 개명된다');
    //  ★ 경로는 웹으로 새지 않는다(⑦-2 와 같은 이유).
    assert.ok(!/path = dlg\.FileName/.test(pick), '경로를 웹에 넘긴다 — data.xml 이 출처로 되살아나는 문이다');
    //  세팅 지점은 파일창과 개명 함수 두 곳뿐이어야 한다.
    const owners = ['private void PickImportXml(string reqId)', 'private (string, string) RenameImportedSource()']
      .map((h) => bodyOf(cs, h)).join('\n');
    const total = (cs.match(/_lastImportPath\s*=/g) || []).length;
    const mine = (owners.match(/_lastImportPath\s*=/g) || []).length;
    assert.strictEqual(total, mine,
      '_lastImportPath 를 파일창·개명 함수 밖에서도 세운다 — 사용자가 고르지 않은 파일이 개명 대상이 된다');
  },

  //  ⑨-2 개명은 **한 번만** 쓴다. 성공이든 실패든 즉시 null 로 되돌리지 않으면, pick 없이 오는
  //       전량 교체(전체 초기화·루프 테스트)가 엉뚱한 파일을 건드린다.
  pathConsumedOnce(cs) {
    const b = bodyOf(cs, 'private (string, string) RenameImportedSource()');
    const read = b.indexOf('string? p = _lastImportPath;');
    const clear = b.indexOf('_lastImportPath = null;');
    assert.ok(read >= 0 && clear > read, '개명 함수가 경로를 읽자마자 비우지 않는다');
    assert.ok(clear < b.indexOf('try'), '비우기가 try 안에 있다 — 예외가 나면 경로가 남는다');
    assert.ok(/if \(string\.IsNullOrEmpty\(p\)\) return \("", ""\);/.test(b),
      'pick 없이 온 전량 교체(전체 초기화)에서 아무것도 안 한다는 보장이 없다');
  },

  //  ⑨-3 데이터 폴더 안 · `.migrated-<날짜>` · 덮어쓰기 금지.
  renameIsSafe(cs) {
    const b = bodyOf(cs, 'private (string, string) RenameImportedSource()');
    assert.ok(/_dataDir/.test(b) && /StringComparison\.OrdinalIgnoreCase/.test(b),
      '데이터 폴더 안인지 검사하지 않는다 — 사용자가 바탕화면에서 고른 파일을 말없이 개명한다');
    assert.ok(/"\.migrated-"/.test(b) && /yyyyMMdd/.test(b), '개명 이름에 `.migrated-<날짜>` 규약이 없다(설계 §8)');
    assert.ok(/File\.Move\(p, target\);/.test(b) && !/File\.Move\([^)]*,\s*true\s*\)/.test(b),
      'File.Move 가 덮어쓰기 모드다 — 지난 이관본의 원본이 사라진다');
    assert.ok(/File\.Exists\(target\)/.test(b) && /stem \+ "-" \+ n/.test(b),
      '같은 이름이 있을 때 접미(-2,-3)를 붙이지 않는다');
  },

  //  ⑨-4 저장이 **성공한 뒤**, **전량 교체일 때만** 부른다. 실패했는데 개명하면 사용자는
  //       원본을 잃은 것처럼 본다. 개명 실패는 반대로 가져오기 실패가 아니다(ok=true 유지).
  renamedAfterSuccessOnly(cs) {
    const b = bodyOf(cs, 'private async Task SaveStateToDbAsync(string reqId, string stateJson, bool replaceAll = false)');
    assert.ok(/var rn = replaceAll \? RenameImportedSource\(\) : \("", ""\);/.test(b),
      '전량 교체가 아닐 때도 개명을 시도한다(또는 아예 안 한다)');
    assert.ok(b.indexOf('if (r.Ok)') < b.indexOf('RenameImportedSource()'),
      '저장 성공 판정보다 먼저 개명한다 — 저장이 실패해도 원본 이름이 바뀐다');
    assert.ok(/ok = true,[^;]*renamedTo = rn\.Item1, renameError = rn\.Item2/.test(b),
      '개명 결과를 회신에 싣지 않는다 — 이름이 말없이 바뀌면 사용자는 파일이 사라졌다고 읽는다');
  },

  //  ⑨-5 웹이 그 사실을 알린다(성공·실패 둘 다).
  webTellsRename(app) {
    const d = bodyOf(app, 'function dbSave(opt){');
    assert.ok(/res\.renamedTo/.test(d) && /res\.renameError/.test(d), '웹이 개명 결과를 알리지 않는다');
    const ok = d.indexOf('if(res && res.ok)');
    assert.ok(ok >= 0 && d.indexOf('res.renamedTo') > ok, '개명 안내가 성공 분기 밖에 있다');
  },
};

test('개명①: 원본 경로는 파일창에서만, 읽기에 성공한 뒤에 기억한다', () => c9.pathSetOnlyByPicker(mainwin));
test('개명②: 경로는 한 번만 쓰인다(pick 없는 전량 교체는 무동작)', () => c9.pathConsumedOnce(mainwin));
test('개명③: 데이터 폴더 안·`.migrated-<날짜>`·덮어쓰기 금지', () => c9.renameIsSafe(mainwin));
test('개명④: 저장 성공 + 전량 교체일 때만 개명하고 결과를 회신한다', () => c9.renamedAfterSuccessOnly(mainwin));
test('개명⑤: 웹이 개명 사실(또는 실패)을 사용자에게 알린다', () => c9.webTellsRename(src));

test('변이㉜: 경로를 비우지 않으면 개명② 가 실패한다(전체 초기화가 엉뚱한 파일을 건드린다)', () => {
  //  ★ 주석 처리가 아니라 **문장을 지운다** — 주석으로 남기면 indexOf 가 그 글자를 그대로 찾아
  //    변이가 성립하지 않는다(이 검사는 텍스트 대조다).
  const bad = mutate('            _lastImportPath = null;   // ★ 한 번만 쓴다', '            /* 비우지 않는다 */', mainwin);
  assert.throws(() => c9.pathConsumedOnce(bad), /읽자마자 비우지 않는다/);
});

test('변이㉝: File.Move 를 덮어쓰기로 바꾸면 개명③ 이 실패한다', () => {
  const bad = mutate('File.Move(p, target);', 'File.Move(p, target, true);', mainwin);
  assert.throws(() => c9.renameIsSafe(bad), /덮어쓰기 모드다/);
});

test('변이㉞: 데이터 폴더 검사를 없애면 개명③ 이 실패한다', () => {
  const bad = mainwin.replace(/string data = Directory\.Exists\(_dataDir\)[\s\S]{0,400}?OrdinalIgnoreCase\)\)/,
    'string data = ""; if (false)');
  assert.notStrictEqual(bad, mainwin, '변이가 원본을 바꾸지 못했다');
  assert.throws(() => c9.renameIsSafe(bad), /데이터 폴더 안인지 검사하지 않는다/);
});

test('변이㉟: 저장 실패에도 개명하면 개명④ 가 실패한다', () => {
  const bad = mutate('                var r = await new CalendarWriteDb(Log).SaveAsync(snap, stateJson, replaceAll);',
    '                var r = await new CalendarWriteDb(Log).SaveAsync(snap, stateJson, replaceAll);\r\r\n                var rn0 = replaceAll ? RenameImportedSource() : ("", "");', mainwin);
  assert.throws(() => c9.renamedAfterSuccessOnly(bad), /저장 성공 판정보다 먼저 개명한다/);
});
