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
    const db = bodyOf(app, 'window.__applyState = function(json, meta){');
    //  migrateLocalStores 는 2026-09-01 에 없앴다 — 이름을 남겨 두는 것은 되살아나면 잡기 위해서다.
    for (const f of ['migrateDbSubscriptions', 'migrateLocalStores'])
      assert.ok(!db.includes(f),
        `DB 경로가 ${f}() 를 부른다 — 이 함수들은 내부에서 save() 를 부르므로 읽기 전용 계약을 깬다`);
    assert.ok(!/\bsave\(\)/.test(db), 'DB 경로가 save() 를 부른다 — 읽기 전용이 아니다');
  },
};

test('출처①: 출처가 하나다 — XML 갈래가 되살아나지 않았다', () => checks.singleSource(src, mainwin));
test('출처②: 위젯의 저장은 DB 로만 간다(XML 쓰기 문이 없다)', () => checks.widgetSavesOnlyToDb(src));
test('출처③: DB 읽기 실패가 XML 로 조용히 되돌아가지 않는다', () => checks.noSilentXmlFallback(mainwin));
test('출처④: 부팅이 buildStateFrom 으로 조립한다', () => checks.stateBuilderShared(src));
test('출처⑤: DB 경로가 XML 전용 이관 절차를 부르지 않는다', () => checks.dbPathSkipsXmlMigrations(src));

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
  const bad = mutate('    renderDataSourceBadge(meta);', '    migrateLocalStores();\n    renderDataSourceBadge(meta);', src);
  assert.throws(() => checks.dbPathSkipsXmlMigrations(bad), /migrateLocalStores\(\) 를 부른다/);
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
  const bad = mutate('    renderDataSourceBadge(meta);\n    renderEmptyHint();', '    renderDataSourceBadge(meta);', src);
  assert.throws(() => c7.emptyHintGuidesOnly(bad), /부팅이 빈 캘린더 안내를 부르지 않는다/);
});
