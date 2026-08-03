// 설정 → 「과제 DB」 접속 대상 표시 (2026-07-30)
//
// 왜 이 테스트가 있나:
//   DeployConfig.DbHost 가 "localhost" 인 채로 배포되면 다른 PC 에서는 위젯을 아예 못 쓴다
//   (로그인 게이트가 DB 조회를 필요로 하므로 첫 화면조차 못 넘는다). 배포 담당자가 배포 전에
//   '지금 이 빌드가 어디에 붙는가'를 눈으로 확인할 자리를 설정창에 만들었다.
//
// 이 파일이 지키는 것 3가지:
//   ① 비밀번호가 절대 웹으로 새지 않는다 (payload 에 DbPassword 부재)  ← 보안 불변식
//   ② 접속 대상이 실제로 화면에 도달한다 (호스트 case + 설정 오픈 시 요청 + textContent 렌더)
//   ③ 곁에 있던 것들(#dbCacheLine 연결상태 · #dbReload)이 부수피해를 안 입는다
//     — 이웃이던 #accountSection 은 2026-08-03에 상단바 「사용자 정보」 모달로 승격돼 이 화면을 떠났다.
//       그래서 ⑥-c의 단언은 '그대로 있다'에서 '되돌아오지 않는다'로 뒤집혔다.
//
// 검사 함수(checks)를 테스트와 변이 주입이 공유한다 — 검사가 실제로 잡는지 증명하기 위해서다.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';
import { readFileSync } from 'node:fs';

const src  = loadAppSource();
const main = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');

// ── 소스 슬라이서 ──────────────────────────────────────────────────────

// 주석 제거(문자열 리터럴은 보존). 설명 주석에 'DbPassword' 같은 단어가 들어 있어도
// "코드가 실제로 그걸 넘기는가"와 헷갈리면 안 된다.
function stripComments(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === c) { j++; break; } j++; }
      out += s.slice(i, j); i = j; continue;
    }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// C# switch 의 한 case 블록 — `case "<name>":` 부터 그 뒤 첫 `break;` 까지(주석 제거본 기준).
function csCase(source, name) {
  const code = stripComments(source);
  const s = code.indexOf('case "' + name + '":');
  assert.ok(s >= 0, `호스트 case "${name}" 을 찾지 못함`);
  const e = code.indexOf('break;', s);
  assert.ok(e > s, `case "${name}" 의 break; 를 찾지 못함`);
  return code.slice(s, e + 6);
}

// `window.__dbInfo = function(...){ ... }` 본문 슬라이스(중괄호 짝, 문자열 안 중괄호는 건너뜀).
function dbInfoBody(source) {
  const i = source.indexOf('window.__dbInfo = function');
  assert.ok(i >= 0, 'window.__dbInfo 정의를 찾지 못함');
  const open = source.indexOf('{', i);
  assert.ok(open > i, '__dbInfo 본문의 여는 중괄호를 찾지 못함');
  let depth = 0, close = -1;
  for (let k = open; k < source.length; k++) {
    const c = source[k];
    if (c === '"' || c === "'" || c === '`') {                       // 문자열 안 중괄호는 세지 않는다
      let j = k + 1;
      while (j < source.length) { if (source[j] === '\\') { j += 2; continue; } if (source[j] === c) break; j++; }
      k = j; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { close = k; break; } }
  }
  assert.ok(close > open, '__dbInfo 본문의 닫는 중괄호를 찾지 못함');
  return source.slice(i, close + 1);
}

// 설정 섹션 마크업 — <div ... id="dbSection"> 부터 그 섹션이 끝나는 다음 섹션 직전까지.
function dbSectionMarkup(source) {
  const s = source.indexOf('<div class="set-sec set-sec-top" id="dbSection">');
  assert.ok(s >= 0, '#dbSection 마크업을 찾지 못함');
  const e = source.indexOf('<div class="modal-foot">', s);
  assert.ok(e > s, '#dbSection 뒤의 modal-foot 을 찾지 못함');
  return source.slice(s, e);
}

// ══ 검사 함수(테스트 + 변이 주입이 같은 함수를 쓴다) ══════════════════

const checks = {
  // ① 호스트: case 가 존재하고 __dbInfo 로 밀어준다
  hostCaseExists(source) {
    const b = csCase(source, 'dbInfoGet');
    assert.ok(/window\.__dbInfo/.test(b), 'case "dbInfoGet" 이 window.__dbInfo 를 호출하지 않는다 — 웹까지 도달하지 못한다');
    assert.ok(/JsonSerializer\.Serialize/.test(b), 'payload 를 JSON 직렬화하지 않는다');
  },

  // ★ 보안 불변식 — 비밀번호는 payload 에도, 이 case 어디에도 없다.
  noPasswordInPayload(source) {
    const b = csCase(source, 'dbInfoGet');
    assert.ok(!/DbPassword/.test(b),
      'case "dbInfoGet" 이 DbPassword 를 참조한다 — 비밀번호가 웹 DOM 까지 흘러간다(절대 금지)');
    assert.ok(!/\bpassword\b|\bpw\b/i.test(b),
      'case "dbInfoGet" payload 에 password/pw 이름의 필드가 있다 — 표시에 필요 없는 값이다');
  },

  // ② payload 는 host·port 둘뿐. 자동 업데이트가 '소스 URL' 하나만 보여주는 것과 같은 기준이다 —
  //    DB명·계정은 빌드에 고정돼 배포 담당자의 확인 대상이 아니고, 화면에 노출할 이유가 없다.
  payloadHasHostPortOnly(source) {
    const b = csCase(source, 'dbInfoGet');
    for (const [field, konst] of [['host', 'DbHost'], ['port', 'DbPort']]) {
      assert.ok(new RegExp('\\b' + field + '\\s*=\\s*DeployConfig\\.' + konst + '\\b').test(b),
        `payload 에 ${field} = DeployConfig.${konst} 가 없다 — 화면에서 그 조각이 빈다`);
    }
    assert.ok(!/DeployConfig\.DbName|DeployConfig\.DbUser/.test(b),
      'payload 에 DbName/DbUser 가 있다 — 확인 대상이 아닌 값을 화면에 노출한다');
  },

  // ③ 웹: 설정을 열 때 요청한다(자동 업데이트 소스와 같은 자리·같은 방식)
  webRequestsOnOpen(source) {
    const fn = extractFunction(source, 'openSettings');
    assert.ok(/cmd:\s*'updateSourceGet'/.test(fn), '전제가 깨졌다 — openSettings 가 updateSourceGet 을 안 보낸다');
    assert.ok(/cmd:\s*'dbInfoGet'/.test(fn),
      'openSettings 가 dbInfoGet 을 보내지 않는다 — 설정을 열어도 접속 대상이 영영 비어 있다');
    assert.ok(/if\(HOST\)\s*hpost\(\{\s*cmd:\s*'dbInfoGet'\s*\}\)/.test(fn),
      'dbInfoGet 요청이 HOST 가드 밖이다 — 브라우저 단독에서 없는 브리지를 부른다');
  },

  // ④ 렌더는 textContent 로만 — 호스트 문자열이 마크업으로 해석되면 안 된다
  textContentOnly(source) {
    const b = dbInfoBody(source);
    assert.ok(/\.textContent\s*=/.test(b), '__dbInfo 가 textContent 로 쓰지 않는다');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(b),
      '__dbInfo 가 HTML 주입 API 를 쓴다 — 접속 대상 문자열이 마크업으로 해석된다(XSS)');
  },

  // ⑤ 표시 전용 — 입력칸도 [저장] 버튼도 없다(값이 베이크 상수라 바꿀 수 없다)
  readOnlyBox(source) {
    const sec = dbSectionMarkup(source);
    assert.ok(/<div class="set-form" id="dbInfoForm">/.test(sec), '#dbInfoForm(.set-form 박스)이 없다');
    assert.ok(/id="dbHost"/.test(sec), '#dbHost(서버 주소) 표시줄이 없다');
    assert.ok(/id="dbPort"/.test(sec), '#dbPort(포트) 표시줄이 없다');
    assert.ok(!/id="dbConn"/.test(sec), '옛 통합 표시줄 #dbConn 이 남아 있다 — 주소와 포트는 분리 전시한다');
    assert.ok(!/<input\b/.test(sec), '#dbSection 에 <input> 이 생겼다 — 접속 대상은 사용자가 바꿀 수 없는 값이다');
    assert.ok(!/id="dbInfoSave"|>저장</.test(sec), '#dbSection 에 [저장] 버튼이 생겼다 — 저장할 대상이 없다');
    // 새 CSS 클래스 신설 금지 — 자동 업데이트 섹션이 쓰는 기존 클래스만 재사용한다.
    for (const cls of ['set-form', 'set-form-foot', 'qa-lb', 'set-hint', 'git-opt']) {
      assert.ok(sec.includes(cls), `기존 클래스 ${cls} 를 재사용하지 않는다`);
    }
    assert.ok(!/dbHost-|dbPort-|db-conn|dbInfo-/.test(source.slice(source.indexOf('<style>'), source.indexOf('</style>'))),
      '접속 대상 전용 CSS 클래스가 신설됐다 — 자동 업데이트 섹션의 기존 리소스를 재사용할 것');
  },

  // ⑥ 부수피해 방지 — 연결 상태줄(다른 정보다)·새로고침·계정 섹션은 그대로다
  cacheLineIntact(source) {
    const sec = dbSectionMarkup(source);
    assert.ok(/<div class="set-hint" id="dbCacheLine" style="margin-bottom:6px"><\/div>/.test(sec),
      '#dbCacheLine(연결 상태줄)이 사라지거나 바뀌었다 — 접속 대상과 연결 상태는 다른 정보다');
    const fn = extractFunction(source, 'updateDbStatusLine');
    assert.ok(/공식 과제 DB: /.test(fn) && /연결 안 됨/.test(fn) && /데스크톱 위젯 전용/.test(fn),
      'updateDbStatusLine 의 상태 문구가 바뀌었다');
    assert.ok(/dbOnline/.test(fn) && /dbCatalog\.length/.test(fn), 'updateDbStatusLine 의 상태 계산이 바뀌었다');
  },

  reloadIntact(source) {
    const sec = dbSectionMarkup(source);
    assert.ok(/<button type="button" class="btn sm" id="dbReload">지금 새로고침<\/button>/.test(sec),
      '#dbReload 버튼이 사라지거나 바뀌었다');
    assert.ok(/id="dbMsg" class="git-opt"/.test(sec), '#dbMsg 결과줄이 사라졌다');
    // 동작(핸들러)은 무변경 — HOST 가드 + loadProjects 요청.
    assert.ok(/\$\('#dbReload'\)[\s\S]{0,400}cmd:\s*'loadProjects'/.test(source),
      '#dbReload 핸들러가 loadProjects 를 보내지 않는다');
  },

  // ★ 계약이 뒤집혔다(2026-08-03): 설정창의 「계정」 섹션은 상단바 👤 「사용자 정보」 모달로 승격돼
  //    이 자리를 떠났다. 지킬 것은 '남아 있는가'가 아니라 '옮겨 갔는가'다 — 옛 id 가 하나라도 살아 있으면
  //    이동이 아니라 복제이고, 그러면 갱신 코드가 둘로 갈려 한쪽은 반드시 낡는다.
  //    (모달 자체의 불변식은 tests/user-info.test.mjs 가 지킨다. 여기서는 '이 섹션이 안 돌아온다'만 본다.)
  accountSectionGone(source) {
    assert.ok(!source.includes('accountSection'), '#accountSection 이 설정창에 되살아났다 — 계정 표면이 둘이 된다');
    for (const id of ['acctState', 'acctHint', 'acctInfoBlock', 'acctName', 'acctTitle', 'acctOrg', 'acctLogout', 'acctMsg']) {
      assert.ok(!source.includes(id), `옛 계정 섹션의 ${id} 가 남아 있다(옮긴 게 아니라 복제됐다)`);
    }
    assert.ok(/<div class="overlay hidden" id="userModal">/.test(source), '#userModal 이 없다 — 계정 표면이 통째로 사라졌다');
    for (const id of ['usState', 'usInfoBlock', 'usName', 'usTitle', 'usOrg', 'usLogout', 'usMsg']) {
      assert.ok(source.includes('id="' + id + '"'), `사용자 정보 모달의 #${id} 가 없다`);
    }
  },
};

// ══ 검사 실행 ═════════════════════════════════════════════════════════

test('DB접속정보 ①: 호스트에 case "dbInfoGet" 이 있고 __dbInfo 로 밀어준다', () => checks.hostCaseExists(main));
test('DB접속정보 ①-보안: payload 에 DbPassword 가 없다 (비밀번호는 웹으로 내려가지 않는다)', () => checks.noPasswordInPayload(main));
test('DB접속정보 ②: payload 는 host·port 둘뿐 — DB명·계정은 노출하지 않는다', () => checks.payloadHasHostPortOnly(main));
test('DB접속정보 ③: 설정 오픈 시 dbInfoGet 을 보낸다(updateSourceGet 과 같은 자리)', () => checks.webRequestsOnOpen(src));
test('DB접속정보 ④: #dbConn 은 textContent 로만 채운다(HTML 주입 API 부재)', () => checks.textContentOnly(src));
test('DB접속정보 ⑤: 표시 전용 박스 — 입력칸·[저장] 없음, 기존 CSS 재사용', () => checks.readOnlyBox(src));
test('DB접속정보 ⑥-a: #dbCacheLine 연결 상태줄이 무변경으로 살아 있다', () => checks.cacheLineIntact(src));
test('DB접속정보 ⑥-b: #dbReload 버튼·동작이 무변경이다', () => checks.reloadIntact(src));
test('DB접속정보 ⑥-c: 옛 #accountSection 은 사라지고 「사용자 정보」 모달로 옮겨 갔다', () => checks.accountSectionGone(src));

// 비밀번호는 로그에도 남지 않는다 — 호스트 전체에서 DbPassword 를 읽는 곳은 접속 문자열 조립 한 곳뿐.
test('DB접속정보 ①-보안: DbPassword 참조는 접속 문자열 조립(ProjectDb) 한 곳뿐이다', () => {
  const hits = [...stripComments(main).matchAll(/DbPassword/g)];
  assert.strictEqual(hits.length, 0, `MainWindow 가 DbPassword 를 ${hits.length}곳에서 참조한다 — 호스트-웹 브리지에 비밀번호가 닿으면 안 된다`);
  const db = readFileSync(new URL('../widget/ProjectDb.cs', import.meta.url), 'utf8');
  const uses = [...stripComments(db).matchAll(/DeployConfig\.DbPassword/g)];
  assert.strictEqual(uses.length, 1, `ProjectDb 의 DbPassword 사용처가 ${uses.length}곳이다 — 접속 문자열 조립 한 곳이어야 한다`);
});

// ══ 변이 주입(검사가 실효성이 있는지 증명) ════════════════════════════
// 각 변이는 "실제로 날 수 있는 회귀"다. 검사가 안 잡으면 그 검사는 장식이다.

function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

test('변이①: payload 에 비밀번호를 끼워 넣으면 noPasswordInPayload 가 실패한다', () => {
  const bad = mutate(main, 'port = DeployConfig.DbPort', 'port = DeployConfig.DbPort, password = DeployConfig.DbPassword');
  assert.throws(() => checks.noPasswordInPayload(bad), /DbPassword/);
});

test('변이②: 설정 오픈에서 dbInfoGet 요청을 지우면 webRequestsOnOpen 이 실패한다', () => {
  const bad = mutate(src, "if(HOST) hpost({ cmd: 'dbInfoGet' });", '');
  assert.throws(() => checks.webRequestsOnOpen(bad), /dbInfoGet 을 보내지 않는다/);
});

test('변이③: __dbInfo 가 innerHTML 로 쓰면 textContentOnly 가 실패한다', () => {
  const bad = mutate(src, "if(p) p.textContent = port || '—';", "if(p) p.innerHTML = port || '—';");
  assert.throws(() => checks.textContentOnly(bad), /HTML 주입 API/);
});

test('변이④: #dbCacheLine 을 지우면 cacheLineIntact 가 실패한다', () => {
  const bad = mutate(src, '<div class="set-hint" id="dbCacheLine" style="margin-bottom:6px"></div>', '');
  assert.throws(() => checks.cacheLineIntact(bad), /#dbCacheLine/);
});

test('변이⑤: payload 에서 host 를 빼면 payloadHasHostPortOnly 가 실패한다', () => {
  const bad = mutate(main, 'host = DeployConfig.DbHost,', '');
  assert.throws(() => checks.payloadHasHostPortOnly(bad), /host = DeployConfig\.DbHost/);
});

test('변이⑥: 표시 전용 박스에 입력칸이 생기면 readOnlyBox 가 실패한다', () => {
  const bad = mutate(src, '<div class="set-hint" id="dbHost" style="margin:0">—</div>',
    '<input type="text" id="dbHost" class="set-in">');
  assert.throws(() => checks.readOnlyBox(bad), /<input> 이 생겼다/);
});

test('변이⑦: #dbReload 를 박스에서 들어내면 reloadIntact 가 실패한다', () => {
  const bad = mutate(src, '<button type="button" class="btn sm" id="dbReload">지금 새로고침</button>', '');
  assert.throws(() => checks.reloadIntact(bad), /#dbReload 버튼이 사라지거나/);
});

test('변이⑨: payload 에 DbName/DbUser 를 되살리면 payloadHasHostPortOnly 가 실패한다', () => {
  // 사용자 지적: 자동 업데이트가 소스 URL 하나만 보여주듯, 여기도 '어느 서버에 붙는가' 하나면 된다.
  const bad = mutate(main, 'port = DeployConfig.DbPort', 'port = DeployConfig.DbPort, db = DeployConfig.DbName');
  assert.throws(() => checks.payloadHasHostPortOnly(bad), /확인 대상이 아닌 값/);
});

test('변이⑧: 호스트 case 를 지우면 hostCaseExists 가 실패한다', () => {
  const bad = mutate(main, 'case "dbInfoGet":', 'case "dbInfoGetX":');
  assert.throws(() => checks.hostCaseExists(bad), /case "dbInfoGet" 을 찾지 못함/);
});

test('변이⑩: 설정창에 계정 섹션을 되살리면 accountSectionGone 이 실패한다', () => {
  // 뒤집힌 단언도 '실제로 잡는지'를 증명해야 한다 — 안 그러면 항상 참인 장식이 된다.
  const bad = mutate(src, '<div class="overlay hidden" id="userModal">', '<div class="set-sec set-sec-top" id="accountSection">');
  assert.throws(() => checks.accountSectionGone(bad), /#accountSection 이 설정창에 되살아났다/);
});

// ══ 실제 렌더(jsdom) — 문자열 검사만으로는 못 보는 것 ═══════════════════
// 미설치 시 graceful-skip(다른 Layer 2 테스트와 같은 관례).

let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch (_) { /* 미설치 */ }

if (!JSDOM) {
  test('DB접속정보(jsdom): jsdom 미설치 — 렌더 테스트 생략', () => {
    console.log('      jsdom 미설치 — 렌더 테스트 생략');
  });
} else {
  let w = null, bootErr = null;
  try {
    const dom = new JSDOM(src, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://tcapp.local/',
      beforeParse(win) {
        if (typeof win.crypto === 'undefined') {
          win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: a => a };
        }
        win.scrollTo = () => {};
      },
    });
    w = dom.window;
  } catch (e) { bootErr = e; }

  if (bootErr) {
    test('DB접속정보(jsdom): 부팅 실패(조사 필요)', () => { throw bootErr; });
  } else {
    // 주소와 포트는 각자 줄에 전시한다(사용자 결정) — 한 줄로 합치면 어느 쪽이 틀렸는지 눈에 덜 띈다.
    const dbHost = () => w.document.getElementById('dbHost');
    const dbPort = () => w.document.getElementById('dbPort');

    test('DB접속정보(jsdom) ⑤: HOST=false 에서 설정을 열어도 오류 없이 대체 표기된다', () => {
      assert.strictEqual(w.eval('HOST'), false, '전제: 브라우저 단독 부팅');
      w.eval('openSettings()');   // 던지면 여기서 실패한다(브라우저 단독 회귀 방지)
      assert.strictEqual(dbHost().textContent, '데스크톱 위젯 전용',
        'HOST=false 인데 서버 주소가 대체 표기로 바뀌지 않았다');
      assert.strictEqual(dbPort().textContent, '—', 'HOST=false 인데 포트가 비워지지 않았다');
      // 섹션 자체는 위젯 전용이라 감춰지는 기존 관례도 그대로여야 한다.
      assert.strictEqual(w.document.getElementById('dbSection').style.display, 'none',
        '#dbSection 이 브라우저에서 감춰지지 않는다(기존 관례)');
    });

    test('DB접속정보(jsdom) ②: 주소와 포트가 각각 따로 전시된다 (DB명·계정은 안 보인다)', () => {
      w.eval("window.__dbInfo({host:'192.168.0.10',port:3306})");
      assert.strictEqual(dbHost().textContent, '192.168.0.10');
      assert.strictEqual(dbPort().textContent, '3306');
      // 호스트가 db/user 를 보내더라도 화면에는 나오지 않아야 한다(계약 이탈 방어).
      w.eval("window.__dbInfo({host:'192.168.0.10',port:3306,db:'taskmgr',user:'taskmgr_app'})");
      const shown = dbHost().textContent + ' ' + dbPort().textContent;
      assert.ok(!/taskmgr/.test(shown), 'DB명·계정이 화면에 노출됐다 — 확인 대상이 아닌 값이다');
    });

    test('DB접속정보(jsdom): localhost 면 이 PC 전용임을 주소 옆에서 알린다(배포 사고 조기 발견)', () => {
      w.eval("window.__dbInfo({host:'localhost',port:3306})");
      assert.ok(/이 PC 전용/.test(dbHost().textContent), 'localhost 인데 경고 꼬리표가 없다');
      assert.ok(!/이 PC 전용/.test(dbPort().textContent), '꼬리표가 포트 줄에 붙었다 — 주소 줄에만 붙어야 한다');
      w.eval("window.__dbInfo({host:'192.168.0.10',port:3306})");
      assert.ok(!/이 PC 전용/.test(dbHost().textContent), '서버 IP 인데 경고 꼬리표가 붙었다');
    });

    test('DB접속정보(jsdom) ④: 마크업 문자열이 와도 요소로 해석되지 않는다(textContent)', () => {
      w.eval("window.__dbInfo({host:'<img src=x onerror=alert(1)>',port:'<b>1</b>'})");
      assert.strictEqual(dbHost().children.length, 0, '#dbHost 안에 요소가 생성됐다 — HTML 로 해석됐다');
      assert.strictEqual(dbPort().children.length, 0, '#dbPort 안에 요소가 생성됐다');
      assert.ok(dbHost().textContent.includes('<img src=x onerror=alert(1)>'), '원문이 그대로 보이지 않는다');
      assert.strictEqual(dbHost().querySelector('img'), null, 'img 요소가 실제로 만들어졌다');
    });

    test('DB접속정보(jsdom): 값이 비면 —(빈 표시)로 남는다', () => {
      w.eval('window.__dbInfo({})');
      assert.strictEqual(dbHost().textContent, '—');
      assert.strictEqual(dbPort().textContent, '—');
      w.eval('window.__dbInfo(null)');
      assert.strictEqual(dbHost().textContent, '—', 'null 페이로드에서 던지거나 주소가 오염됐다');
      assert.strictEqual(dbPort().textContent, '—', 'null 페이로드에서 던지거나 포트가 오염됐다');
    });
  }
}
