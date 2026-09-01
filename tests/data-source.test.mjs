// 데이터 출처(1c) 계약 — DB 읽기 배선이 파일 경로를 오염시키지 않는다
//
// 이 파일이 존재하는 이유:
//   1c 는 **읽기만** 한다. 쓰기 경로(설계 2단계)가 없는 상태에서 DB 모드로 편집이 통과하면
//   변경이 data.xml 로 가고, 다음 부팅에 DB 를 읽는 순간 편집이 사라진 것처럼 보인다.
//   사용자에게 그건 데이터 유실이다. 그래서 잠글 것이 셋이다:
//     ① 기본 출처는 파일이다 — DB 는 명시적으로 켤 때만(실수로 켜진 채 배포되면 안 된다)
//     ② DB 모드에서는 save() 가 입구에서 막힌다
//     ③ DB 읽기 실패는 XML 로 **조용히 되돌아가지 않는다**
//   그리고 두 경로가 갈라지지 않도록:
//     ④ state 조립을 XML·DB 가 공유한다(buildStateFrom)
//     ⑤ DB 경로는 XML 전용 이관 절차를 부르지 않는다(그것들은 내부에서 save() 를 부른다)
import { readFileSync } from 'node:fs';
import { test, assert, loadAppSource } from './harness.mjs';

const src = loadAppSource();
const mainwin = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
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

const checks = {
  // ① 기본 출처는 파일 — DB 는 명시적으로 켤 때만
  defaultsToFile(app, cs) {
    assert.ok(/let __dataSource = 'xml'/.test(app),
      "웹의 기본 출처가 'xml' 이 아니다 — 켠 적 없는데 DB 로 뜨면 사용자가 파일을 잃었다고 오해한다");
    assert.ok(/GetEnvironmentVariable\("TC_DATA_SOURCE"\)/.test(cs),
      '호스트가 TC_DATA_SOURCE 를 보지 않는다');
    //  영속 설정 파일로 만들면 켠 줄 모르고 배포된다 — 그 위험을 막는 것이 이 검사다
    assert.ok(!/data-source\.json|dataSource\.json/.test(cs),
      '출처를 파일에 영속시키고 있다 — 켠 채로 배포될 위험이 있다(환경변수만 쓴다)');
  },

  // ② DB 모드에서는 저장이 입구에서 막힌다
  saveBlockedInDbMode(app) {
    const body = bodyOf(app, 'function save(){');
    const guard = body.indexOf('isDbMode()');
    assert.ok(guard > 0, 'save() 안에 DB 모드 가드가 없다 — 읽기 전용이 강제되지 않는다');
    const post = body.indexOf('postMessage');
    assert.ok(post > 0, 'save() 의 호스트 전송을 찾지 못했다');
    assert.ok(guard < post, '가드가 호스트 전송보다 뒤에 있다 — 이미 저장이 나간 뒤다');
    const ls = body.indexOf('localStorage.setItem');
    assert.ok(ls < 0 || guard < ls, '가드가 브라우저 저장보다 뒤에 있다');
    //  가드는 return 으로 끊어야 한다(경고만 하고 흘려보내면 의미가 없다)
    const seg = body.slice(guard, post);
    assert.ok(/\breturn\s*;/.test(seg), 'DB 모드 가드가 return 으로 끊지 않는다 — 경고만 뜨고 저장된다');
  },

  // ③ DB 읽기 실패가 XML 로 조용히 되돌아가지 않는다
  noSilentXmlFallback(cs) {
    const body = bodyOf(cs, 'private async Task BootFromDbAsync()');
    assert.ok(!/__applyXml/.test(body),
      'DB 부팅 경로가 __applyXml 을 부른다 — 실패를 파일로 덮으면 사용자는 DB 를 본다고 믿으면서 파일을 본다');
    assert.ok(!/_dataFile/.test(body), 'DB 부팅 경로가 data.xml 을 건드린다');
    for (const w of ['ApplyStateError'])
      assert.ok(body.includes(w), `실패 통지(${w})가 없다 — 실패가 빈 화면으로 나타난다`);
    //  '미등록 사용자'와 '연결 실패'는 반드시 구분한다(§3.6)
    assert.ok(/catch \(CalendarUserNotFoundException/.test(body),
      '미등록 사용자를 연결 실패와 구분하지 않는다 — 사용자도 관리자도 엉뚱한 곳을 본다');
  },

  // ④ state 조립을 두 경로가 공유한다
  stateBuilderShared(app) {
    assert.ok(/function buildStateFrom\(data\)\{/.test(app), 'buildStateFrom 이 없다');
    const xml = bodyOf(app, 'window.__applyXml = function(text){');
    const db = bodyOf(app, 'window.__applyState = function(json, meta){');
    assert.ok(/state = buildStateFrom\(/.test(xml), 'XML 경로가 buildStateFrom 을 쓰지 않는다');
    assert.ok(/state = buildStateFrom\(/.test(db), 'DB 경로가 buildStateFrom 을 쓰지 않는다');
    //  DB 경로가 XML 파서를 거치면 '굳이 XML 로 만들었다 되돌리는' 변환 결함이 생긴다
    assert.ok(!/fromXML\(/.test(db), 'DB 경로가 fromXML 을 거친다 — 계약 G 가 존재하는 이유를 무너뜨린다');
  },

  // ⑤ DB 경로는 XML 전용 이관 절차를 부르지 않는다(둘 다 내부에서 save() 를 부른다)
  dbPathSkipsXmlMigrations(app) {
    const db = bodyOf(app, 'window.__applyState = function(json, meta){');
    for (const f of ['migrateDbSubscriptions', 'migrateLocalStores'])
      assert.ok(!db.includes(f),
        `DB 경로가 ${f}() 를 부른다 — 이 함수들은 내부에서 save() 를 부르므로 읽기 전용 계약을 깬다`);
    assert.ok(!/\bsave\(\)/.test(db), 'DB 경로가 save() 를 부른다 — 읽기 전용이 아니다');
  },
};

test('출처①: 기본은 파일이고 DB 는 환경변수로만 켠다', () => checks.defaultsToFile(src, mainwin));
test('출처②: DB 모드에서 save() 가 입구에서 막힌다', () => checks.saveBlockedInDbMode(src));
test('출처③: DB 읽기 실패가 XML 로 조용히 되돌아가지 않는다', () => checks.noSilentXmlFallback(mainwin));
test('출처④: state 조립을 XML·DB 가 공유한다(buildStateFrom)', () => checks.stateBuilderShared(src));
test('출처⑤: DB 경로가 XML 전용 이관 절차를 부르지 않는다', () => checks.dbPathSkipsXmlMigrations(src));

test('출처⑥: 읽기 전용임을 화면에 드러낸다', () => {
  assert.ok(/renderDataSourceBadge/.test(src), '출처 배지 함수가 없다');
  assert.ok(/읽기 전용/.test(src), "'읽기 전용' 문구가 없다 — 사용자가 편집 가능한 줄 안다");
});

// ── 변이 시험 ────────────────────────────────────────────────────────
test('변이⑧: 기본 출처를 db 로 바꾸면 출처① 이 실패한다', () => {
  const bad = mutate("let __dataSource = 'xml'", "let __dataSource = 'db'", src);
  assert.throws(() => checks.defaultsToFile(bad, mainwin), /기본 출처가 'xml' 이 아니다/);
});

test('변이⑨: save() 의 DB 가드를 빼면 출처② 가 실패한다', () => {
  const bad = mutate('if(isDbMode()){', 'if(false){', src);
  assert.throws(() => checks.saveBlockedInDbMode(bad), /DB 모드 가드가 없다/);
});

test('변이⑩: 가드가 return 없이 경고만 하면 출처② 가 실패한다', () => {
  const bad = mutate(
    "    toast('DB 읽기 전용입니다 — 변경은 저장되지 않습니다(쓰기 경로는 다음 단계)', 'warn');\n    return;",
    "    toast('DB 읽기 전용입니다 — 변경은 저장되지 않습니다(쓰기 경로는 다음 단계)', 'warn');", src);
  assert.throws(() => checks.saveBlockedInDbMode(bad), /return 으로 끊지 않는다/);
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
  const bad = mutate('    renderDataSourceBadge(meta);', '    migrateLocalStores();\n    renderDataSourceBadge(meta);', src);
  assert.throws(() => checks.dbPathSkipsXmlMigrations(bad), /migrateLocalStores\(\) 를 부른다/);
});

test('변이⑭: 미등록 사용자 구분을 없애면 출처③ 이 실패한다', () => {
  const bad = mutate('catch (CalendarUserNotFoundException ex)', 'catch (InvalidOperationException ex)', mainwin);
  assert.throws(() => checks.noSilentXmlFallback(bad), /미등록 사용자를 연결 실패와 구분하지 않는다/);
});
