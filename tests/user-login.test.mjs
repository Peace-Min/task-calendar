// 사용자 로그인(세션 유지) + DB 접근 관문 — 구조 불변식 (docs/USER-LOGIN.md)
//
// 이 파일의 존재 이유: 이 기능은 두 번 갈아엎었고, 결함은 전부 '배선'에 있었다.
//   1차 — 부팅마다 netcus 재인증 → 시작할 때마다 가시 창이 떴다 사라짐(EnsureW2(background:true)를 안 씀).
//   2차 — 적대적 검증 8건: 게이트를 비동기 회신 뒤에 달아 캘린더가 먼저 보임 / 포커스 격리가 없어
//          Shift+Tab으로 덮개 뒤 버튼이 눌림 / 자격 저장 실패를 삼키고 성공 회신 / 로그아웃과
//          백그라운드 갱신이 경합해 삭제된 세션 부활 / 실패 code 7종인데 분기 0곳 / 자격 출처 2개.
// 관례(기억)로는 반드시 다시 뚫린다. 아래 불변식은 전부 '실제로 났던 사고'를 기계가 잡게 한 것이다.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';
import { readFileSync } from 'node:fs';

const src         = loadAppSource();
const mainWindow  = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
const netcus      = readFileSync(new URL('../widget/NetcusService.cs', import.meta.url), 'utf8');
const projectDb   = readFileSync(new URL('../widget/ProjectDb.cs', import.meta.url), 'utf8');
const userSession = readFileSync(new URL('../widget/UserSession.cs', import.meta.url), 'utf8');

// ── 도우미 ──────────────────────────────────────────────────────────
// 주석 제거 — "이 경로에 netcus는 없다" 같은 주석이 'netcus 참조'로 오탐되면 불변식이 무의미해진다.
// 문자열 리터럴은 통째로 보존한다(https:// 를 주석 시작으로 오해하지 않게).
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

// 주석 + 문자열 리터럴까지 걷어낸 '코드만'. 로그 문구에 든 'netcus' 같은 단어가
// 실제 접근으로 오탐되지 않게, "무엇을 부르는가"만 보는 검사에 쓴다.
function codeOnly(s) {
  return stripComments(s).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
}

// C# 멤버 본문 슬라이스 — 시그니처 조각부터 '같은 들여쓰기(8칸)의 다음 멤버 선언' 직전까지.
function csMember(source, sigSnippet) {
  const s = source.indexOf(sigSnippet);
  assert.ok(s >= 0, `C# 멤버를 찾지 못함: ${sigSnippet}`);
  const re = /\n        (?:public|private|internal|protected|static|const|sealed)\b/g;
  re.lastIndex = s + sigSnippet.length;
  const m = re.exec(source);
  return source.slice(s, m ? m.index : source.length);
}
const bare = (source, sig) => stripComments(csMember(source, sig));
const jsBody = (name) => stripComments(extractFunction(src, name));

// 게이트 마크업 슬라이스
function gateMarkup() {
  const s = src.indexOf('<div class="lg-gate hidden" id="loginGate">');
  assert.ok(s >= 0, '#loginGate 마크업을 찾지 못함(전용 .lg-gate 클래스여야 한다)');
  const e = src.indexOf('</div>\n</div>', s);
  return src.slice(s, e + 13);
}

// ══ ① 부팅 경로에 netcus 참조 0 ═══════════════════════════════════════
// 1차 실패의 본체. 부팅에서 netcus로 나가면 위젯을 켤 때마다 보조 창이 떴다 사라진다.

test('부팅(웹): bootUserSession은 userSessionGet 하나만 부르고 netcus를 모른다', () => {
  const b = jsBody('bootUserSession');
  assert.ok(!/netcus/i.test(codeOnly(b)), '부팅 경로에 netcus 참조가 있다 — 켤 때마다 회사 사이트로 나간다');
  const reqs = [...b.matchAll(/hostRequest\(\s*'([^']+)'/g)].map(m => m[1]);
  assert.deepStrictEqual(reqs, ['userSessionGet'], `부팅이 보내는 호스트 요청이 계약과 다르다: ${reqs}`);
  assert.ok(!/hpost\(/.test(b), '부팅이 hostRequest 외의 경로로도 호스트를 부른다');
});

test('부팅(호스트): userSessionGet은 세션 파일만 읽는다 — netcus·DB 접근 0', () => {
  const b = bare(mainWindow, 'private void RunUserSessionGet(string reqId)');
  assert.ok(/UserSession\.Load\(/.test(b), '세션 파일을 읽지 않는다');
  assert.ok(!/netcus/i.test(codeOnly(b)), 'userSessionGet 안에 netcus 접근이 있다(부팅 경로 오염)');
  assert.ok(!/_projectDb/.test(b), 'userSessionGet이 DB를 건드린다 — 부팅이 DB 상태에 묶이면 오프라인에서 못 들어간다');
  // 동기 메서드여야 한다: async가 되는 순간 "회신 먼저 → 뒤에서 뭔가 더" 유혹이 생긴다.
  assert.ok(/private void RunUserSessionGet/.test(b), 'RunUserSessionGet이 async로 바뀌었다(뒤에 딸린 작업 의심)');
});

// ══ ② LoginVerify는 background 창 ════════════════════════════════════

test('LoginVerify: 반드시 EnsureW2(background: true) — 기본값은 화면 중앙 가시 창이다', () => {
  const b = bare(netcus, 'public async Task<bool> LoginVerify(string id, string pw)');
  assert.ok(/EnsureW2\(background:\s*true\)/.test(b),
    'EnsureW2(background: true)가 아니다 — 로그인할 때마다 920x720 창이 화면 중앙에 뜬다(1차 폐기 원인)');
  assert.ok(!/EnsureW2\(\s*\)/.test(b), 'EnsureW2()(가시 창) 호출이 남아 있다');
  assert.ok(/NetcusLoginVerify\(/.test(b), '판정을 공유 헬퍼(NetcusLoginVerify)로 하지 않는다');
});

// ══ ③ 자격 저장 경로가 재검증(가시 창)을 트리거하지 않는다 ══════════════

test('SaveCredsForLogin: NetcusSaveCreds/NetcusValidateCreds를 부르지 않는다(재검증 창 방지)', () => {
  const b = bare(netcus, 'public (bool ok, string msg) SaveCredsForLogin(string id, string pw)');
  assert.ok(!/NetcusSaveCreds\(/.test(b), 'NetcusSaveCreds를 거친다 — 그쪽은 저장 직후 재검증(가시 창 재로그인)을 건다');
  assert.ok(!/NetcusValidateCreds\(/.test(b), '저장 직후 재검증을 건다 — 방금 LoginVerify로 확인했는데 창이 또 뜬다');
  assert.ok(/valid = \(bool\?\)true/.test(b), 'valid=true로 쓰지 않으면 보고 전송이 자격을 미검증으로 보고 다시 묻는다');
});

test('로그인 핸들러도 자격을 옛 경로(SaveCreds)로 저장하지 않는다', () => {
  const b = bare(mainWindow, 'private async Task RunUserLoginAsync(string reqId, string id, string pw)');
  assert.ok(/_netcus\.SaveCredsForLogin\(/.test(b), '로그인 연동 저장 경로를 쓰지 않는다');
  assert.ok(!/_netcus\.SaveCreds\(/.test(b), '설정창용 SaveCreds(재검증 트리거)를 부른다');
});

// ══ ④ 게이트: 닫는 길이 없다 · 종료 버튼은 있다 · 브라우저 단독은 미표시 ══

test('게이트: .overlay 클래스를 쓰지 않는다(배경클릭·ESC·모달스택으로 뚫린다)', () => {
  const g = gateMarkup();
  assert.ok(/class="lg-gate hidden"/.test(g), '전용 .lg-gate 클래스가 아니다');
  assert.ok(!/\boverlay\b/.test(g), '.overlay 클래스가 붙었다 — 공통 닫기 경로가 전부 공짜로 따라붙는다');
  // CSS도 실제로 불투명·최상단이어야 덮개 구실을 한다.
  assert.ok(/\.lg-gate\{[^}]*position:fixed[^}]*inset:0[^}]*z-index:300[^}]*background:var\(--bg\)/.test(src),
    '.lg-gate가 불투명 전면 덮개(fixed·inset:0·z-index:300·불투명 배경)가 아니다');
});

test('게이트: 닫기(× · data-close) 경로가 하나도 없다', () => {
  const g = gateMarkup();
  assert.ok(!/data-close/.test(g), '게이트에 data-close가 있다 — 로그인 없이 닫고 들어갈 수 있다');
  assert.ok(!/class="x"/.test(g), '게이트에 × 버튼이 있다');
  // 닫기는 hideLoginGate 한 곳에서만 — 세션 복원/로그인 성공 뒤에만 불린다.
  const callers = [...stripComments(src).matchAll(/hideLoginGate\(\)/g)].length;
  assert.ok(callers >= 1 && callers <= 4, `hideLoginGate 호출 지점이 비정상적으로 많다(${callers}) — 닫는 길이 늘었는지 확인`);
});

test('게이트: 「위젯 종료」(#lgQuit)가 있고 close로 직접 배선돼 있다', () => {
  const g = gateMarkup();
  assert.ok(/id="lgQuit"/.test(g), '#lgQuit가 없다 — 게이트가 호스트바를 덮으므로 Alt+F4 말고는 나갈 길이 없어진다');
  const i = src.indexOf("$('#lgQuit')");
  assert.ok(i >= 0, '#lgQuit 배선이 없다');
  assert.ok(/hpost\(\{\s*cmd:\s*'close'\s*\}\)/.test(src.slice(i, i + 220)),
    "#lgQuit가 close를 직접 보내지 않는다(호스트바의 data-host 위임은 바 안쪽만 듣는다)");
});

test('게이트: 브라우저 단독(HOST=false)은 미표시 + 호스트 요청 0회', () => {
  const b = jsBody('bootUserSession');
  const guard = b.indexOf('if(!HOST) return;');
  assert.ok(guard >= 0, 'bootUserSession에 !HOST 차단이 없다 — SOP로 netcus 로그인이 불가라 영구히 잠긴다');
  assert.ok(guard < b.indexOf('showLoginGate('), '!HOST 차단이 게이트 표시보다 뒤에 있다');
  assert.ok(guard < b.indexOf('hostRequest('), '!HOST 차단이 호스트 요청보다 뒤에 있다(브라우저에서도 요청이 나간다)');
  // 로그인·로그아웃 제출도 같은 차단을 갖는다.
  assert.ok(/if\(!HOST \|\| __loginBusy\) return;/.test(jsBody('submitLogin')), 'submitLogin에 !HOST 차단이 없다');
  assert.ok(/if\(!HOST\) return;/.test(jsBody('submitLogout')), 'submitLogout에 !HOST 차단이 없다');
});

test('게이트: 첫 프레임부터 뜬다 — 회신을 기다렸다가 덮지 않는다', () => {
  const b = jsBody('bootUserSession');
  const show = b.indexOf('showLoginGate(false');
  const req  = b.indexOf('hostRequest(');
  assert.ok(show >= 0, "부팅이 '로그인 확인 중' 상태로 게이트를 먼저 띄우지 않는다");
  assert.ok(show < req, '게이트가 비동기 회신 뒤에 붙었다 — 그 사이 캘린더와 실데이터가 먼저 보인다(2차 실패)');
  assert.ok(show < b.indexOf('await'), '게이트 표시가 await 뒤에 있다(동기 표시가 아니다)');
  // 부팅 스크립트가 실제로 bootUserSession을 부르는지(HOST 분기 안에서)
  const boot = src.slice(src.indexOf('if(HOST){ // 데스크톱 위젯 모드'), src.indexOf("postMessage(JSON.stringify({cmd:'ready'}))"));
  assert.ok(/bootUserSession\(\);/.test(boot), '부팅 경로에서 bootUserSession을 부르지 않는다');
});

test('게이트: 세션 복원에 성공했을 때만 내린다', () => {
  const b = jsBody('bootUserSession');
  assert.ok(/if\(r && r\.ok && r\.user\)\{[^}]*hideLoginGate\(\)/.test(b),
    '복원 성공 조건과 게이트 내림이 붙어 있지 않다');
  assert.ok(/showLoginGate\(true/.test(b), '복원 실패 시 폼 모드로 전환하지 않는다');
});

// ══ ⑤ 포커스 격리 · 전역 단축키 조기 return ══════════════════════════
// 2차 실패: 격리가 없어 Shift+Tab 몇 번으로 덮개 뒤 버튼이 눌렸다(로그인 없이 저장까지 됐다).

test('격리: 게이트 표시 중 #loginGate·#toastWrap 제외 전부 inert + aria-hidden', () => {
  const b = jsBody('_gateInert');
  assert.ok(/document\.body\.children/.test(b), 'body 직계 전체를 대상으로 하지 않는다');
  assert.ok(/el\.id === 'loginGate' \|\| el\.id === 'toastWrap'/.test(b), '예외 대상이 게이트·토스트 둘이 아니다');
  assert.ok(/setAttribute\('inert'/.test(b) && /setAttribute\('aria-hidden'/.test(b), 'inert/aria-hidden을 둘 다 걸지 않는다');
  assert.ok(/removeAttribute\('inert'/.test(b) && /_updateInert\(\)/.test(b),
    '해제 시 직접 걷어낸 뒤 _updateInert로 모달 상태를 되돌리지 않는다(.overlay는 _updateInert가 건너뛴다)');
  assert.ok(/_gateInert\(true\)/.test(jsBody('showLoginGate')), 'showLoginGate가 격리를 걸지 않는다');
  assert.ok(/_gateInert\(false\)/.test(jsBody('hideLoginGate')), 'hideLoginGate가 격리를 풀지 않는다');
});

test('격리: 게이트 자신은 모달 A11y(_updateInert)의 inert 대상에서 제외된다', () => {
  const b = jsBody('_updateInert');
  assert.ok(/el\.id === 'loginGate'/.test(b), '게이트에 inert가 붙을 수 있다 — 그러면 로그인 입력 자체가 막힌다');
});

test('전역 단축키: 게이트 표시 중이면 조기 return', () => {
  const i = src.indexOf('/* 키보드 단축키 */');
  assert.ok(i >= 0, '전역 단축키 핸들러를 찾지 못함');
  const b = stripComments(src.slice(i, i + 900));
  const guard = b.indexOf('if(__gateOn) return;');
  assert.ok(guard >= 0, '게이트 표시 중 전역 단축키가 그대로 돈다(ESC로 뒤의 모달을 닫는 등)');
  assert.ok(guard < b.indexOf("ev.key === 'Escape'"), '가드가 Escape 처리보다 뒤에 있다');
  // 플래그는 게이트 표시/숨김 양쪽에서 갱신돼야 한다.
  assert.ok(/__gateOn = true/.test(jsBody('showLoginGate')), 'showLoginGate가 __gateOn을 켜지 않는다');
  assert.ok(/__gateOn = false/.test(jsBody('hideLoginGate')), 'hideLoginGate가 __gateOn을 끄지 않는다');
});

test('재진입 가드: 버튼 disabled와 JS 플래그를 둘 다 쓴다(Enter는 disabled로 안 막힌다)', () => {
  const b = jsBody('submitLogin');
  assert.ok(/__loginBusy\) return;/.test(b), '재진입 플래그 가드가 없다 — Enter 연타로 로그인이 중복 발사된다');
  assert.ok(/__loginBusy = true;/.test(b) && /__loginBusy = false;/.test(b), '플래그를 세우거나 내리지 않는다');
  assert.ok(/btn\.disabled = true/.test(b) && /btn\.disabled = false/.test(b), '버튼 잠금이 없다(또는 풀지 않는다)');
});

// ══ ⑥ 저장 2개: 되읽기 확인 후에만 성공 · 실패 시 양쪽 정리 ══════════

test('세션 저장: 되읽어 확인된 경우에만 성공을 반환한다', () => {
  const b = bare(userSession, 'public static (bool ok, string msg) Save(');
  assert.ok(/var back = Load\(dataDir, verifyVersion: false\)/.test(b),
    '되읽기 검증이 없다 — "저장 성공" 로그를 찍고도 파일이 그대로였던 사례가 실제로 있었다');
  const chk = b.indexOf('var back = Load(');
  const okRet = b.indexOf('return (true');
  assert.ok(chk < okRet, '성공 반환이 되읽기 검증보다 앞에 있다(거짓 성공)');
  assert.ok(/return \(false, "세션을 저장하지 못했습니다\."\);/.test(b), '되읽기 불일치 시 실패를 반환하지 않는다');
});

test('자격 저장: 되읽기 + valid 기록까지 확인한 경우에만 성공', () => {
  const b = bare(netcus, 'public (bool ok, string msg) SaveCredsForLogin(string id, string pw)');
  assert.ok(/NetcusLoadCreds\(\)/.test(b), '되읽기 확인이 없다');
  assert.ok(/NetcusCredsValid\(\) != true/.test(b), 'valid가 실제로 기록됐는지 확인하지 않는다');
  const okRet = b.indexOf('return (true, "")');
  assert.ok(b.indexOf('NetcusLoadCreds()') < okRet && b.indexOf('NetcusCredsValid() != true') < okRet,
    '성공 반환이 확인보다 앞에 있다(거짓 성공)');
});

test('로그인: 저장 2개가 모두 성공해야 ok:true · 하나라도 실패하면 둘 다 정리', () => {
  const b = bare(mainWindow, 'private async Task RunUserLoginAsync(string reqId, string id, string pw)');
  const save1 = b.indexOf('UserSession.Save(');
  const save2 = b.indexOf('_netcus.SaveCredsForLogin(');
  const okRep = b.indexOf('ok = true');
  assert.ok(save1 >= 0 && save2 >= 0, '저장 2개가 다 있지 않다');
  assert.ok(save1 < okRep && save2 < okRep, '성공 회신이 저장보다 앞에 있다');
  assert.ok(/if \(!sok\)/.test(b) && /if \(!cok\)/.test(b), '저장 결과를 검사하지 않는다(실패를 삼키는 2차 실패 경로)');
  // 반쪽 상태 금지 — 실패 분기 둘 다에서 세션·자격을 함께 지운다.
  const cleanups = [...b.matchAll(/UserSession\.Clear\(_dataDir, Log\); _netcus\.ClearCredsForLogout\(\);/g)].length;
  assert.strictEqual(cleanups, 2,
    `실패 시 양쪽 정리가 ${cleanups}곳이다(2여야 한다) — 세션만 남으면 보고가 깨지고 자격만 남으면 유령 상태가 된다`);
});

test('로그아웃: 세션과 자격을 함께 지운다', () => {
  const b = bare(mainWindow, 'private void RunUserLogout(string reqId)');
  assert.ok(/UserSession\.Clear\(/.test(b), '세션을 지우지 않는다');
  assert.ok(/_netcus\.ClearCredsForLogout\(\)/.test(b), '자격을 지우지 않는다 — 보고 전송이 계속 그 사람 자격으로 돈다');
});

// ══ ⑦ 세션은 DPAPI 경유 · 앱 버전 불일치 시 폐기 ═════════════════════

test('세션: 평문 저장 금지 — DPAPI(CurrentUser)를 반드시 거친다', () => {
  const s = bare(userSession, 'public static (bool ok, string msg) Save(');
  assert.ok(/Dpapi\.Protect\(/.test(s), '세션을 DPAPI로 감싸지 않는다 — loginId 한 줄만 고치면 남의 신원이 된다');
  assert.ok(!/File\.WriteAllText\(path, json/.test(s), 'JSON을 평문 그대로 쓴다');
  const l = bare(userSession, 'public static UserSession? Load(');
  assert.ok(/Dpapi\.Unprotect\(/.test(l), '복호화를 거치지 않는다');
});

test('세션: 앱 버전이 다르면 폐기한다(업데이트 = 일괄 로그아웃)', () => {
  const l = bare(userSession, 'public static UserSession? Load(');
  assert.ok(/if \(verifyVersion\)/.test(l), '버전 검사 분기가 없다');
  assert.ok(/!string\.Equals\(s\.AppVersion, cur, StringComparison\.Ordinal\)/.test(l), '저장 버전과 현재 버전을 비교하지 않는다');
  assert.ok(/Clear\(dataDir, log\);\s*return null;/.test(l), '버전 불일치 세션을 폐기하지 않는다');
  // 부팅은 반드시 검증 모드로 읽는다.
  assert.ok(/UserSession\.Load\(_dataDir, verifyVersion: true, Log\)/.test(mainWindow),
    '부팅이 verifyVersion:true로 읽지 않는다 — 업데이트해도 옛 세션이 살아남는다');
});

// ══ ⑧ 비밀번호가 어디에도 남지 않는다 ════════════════════════════════

test('비밀번호: 웹은 저장소에 남기지 않고 실패 시 입력칸도 비운다', () => {
  const b = jsBody('submitLogin');
  assert.ok(!/localStorage|sessionStorage/.test(b), '비밀번호 경로가 로컬 저장소에 닿는다');
  assert.ok(/pwEl\.value = ''/.test(b), '실패 후 비밀번호 칸을 비우지 않는다');
  assert.ok(/pw\.value = ''/.test(jsBody('hideLoginGate')), '게이트를 내릴 때 비밀번호가 DOM에 남는다');
  // 게이트 전체 소스에 비번을 담아두는 전역이 없어야 한다.
  assert.ok(!/currentUser\s*=\s*\{[^}]*pw/.test(stripComments(src)), '사용자 객체에 비밀번호가 실린다');
});

test('비밀번호: 호스트 로그·회신·예외 메시지 어디에도 싣지 않는다', () => {
  const targets = [
    ['RunUserLoginAsync', bare(mainWindow, 'private async Task RunUserLoginAsync(string reqId, string id, string pw)')],
    ['LoginVerify',       bare(netcus, 'public async Task<bool> LoginVerify(string id, string pw)')],
    ['SaveCredsForLogin', bare(netcus, 'public (bool ok, string msg) SaveCredsForLogin(string id, string pw)')],
  ];
  // pw가 등장해도 되는 자리는 이 몇 개뿐이다. 나머지는 전부 유출로 본다 —
  // '로그 호출 줄만 검사'하면 헬퍼(Fail(...))를 하나 끼우는 것만으로 검사를 빠져나간다.
  const ALLOWED = [
    /string pw\)/,                                    // 시그니처
    /pw = pw \?\? ""/,                                 // 정규화
    /\bpw\.Length\b/,                                  // 빈값 검사 / 분기
    /_netcus\.LoginVerify\(id, pw\)/,                  // 인증 전달
    /_netcus\.SaveCredsForLogin\(id, pw\)/,            // 저장 전달
    /NetcusLoginVerify\(cw, id, pw(?:, \d+)?\)/,       // 공유 판정 헬퍼 전달(+ 선택적 nav 타임아웃 숫자 리터럴)
    /Dpapi\.Protect\(Encoding\.UTF8\.GetBytes\(pw\)\)/, // DPAPI 암호화(저장 직전)
    /\bpw = enc\b/,                                    // 파일에는 암호문만 쓴다
  ];
  for (const [name, body] of targets) {
    for (const line of body.split('\n')) {
      if (!/\bpw\b/.test(line)) continue;
      assert.ok(ALLOWED.some(re => re.test(line)),
        `${name}: 허용되지 않은 위치에 비밀번호가 흐른다 → ${line.trim()}`);
    }
  }
  // 회신 payload에도 pw 필드가 없어야 한다.
  const b = bare(mainWindow, 'private async Task RunUserLoginAsync(string reqId, string id, string pw)');
  assert.ok(!/new \{[^}]*\bpw\b/.test(b), '회신 객체에 pw 필드가 있다');
});

// ══ ⑨ 부팅에 app_user 재조회가 없다 (세션 부활 경합 재발 방지) ═════════

test('부팅에 app_user 백그라운드 재조회가 없다(로그아웃과 경합해 삭제된 세션이 부활했다)', () => {
  const b = bare(mainWindow, 'private void RunUserSessionGet(string reqId)');
  assert.ok(!/LoadAppUserJsonAsync/.test(b), '부팅에서 app_user를 다시 읽는다 — 로그아웃과 경합한다');
  for (const dead of ['RefreshUserFromDbAsync', '__userRefreshed']) {
    assert.ok(!mainWindow.includes(dead), `폐기 대상이 호스트에 남아 있다: ${dead}`);
    assert.ok(!src.includes(dead), `폐기 대상이 웹에 남아 있다: ${dead}`);
  }
  // 재조회가 없으므로 경합 방어(세대 토큰)도 필요 없다 — 있으면 재조회가 되살아났다는 뜻이다.
  assert.ok(!/_userGen|userGeneration/.test(mainWindow), '세대 토큰이 생겼다 = 경합하는 백그라운드 갱신이 돌아왔다');
});

// ══ ⑩ ProjectDb 접근 관문 ═══════════════════════════════════════════

test('불변식①: ProjectDb에서 new MySqlConnection을 직접 부르는 곳은 두 헬퍼 안뿐이다', () => {
  const readSpan  = (() => { const s = projectDb.indexOf('private static async Task<MySqlConnection> OpenReadAsync');
                             return [s, projectDb.indexOf('private static async Task<MySqlConnection> OpenWriteAsync')]; })();
  const writeSpan = (() => { const s = projectDb.indexOf('private static async Task<MySqlConnection> OpenWriteAsync');
                             return [s, projectDb.indexOf('public async Task<string?> LoadProjectsJsonAsync')]; })();
  assert.ok(readSpan[0] >= 0 && writeSpan[0] >= 0, '관문 헬퍼(OpenReadAsync/OpenWriteAsync)가 없다');
  const hits = [...projectDb.matchAll(/new MySqlConnection\(/g)].map(m => m.index);
  assert.ok(hits.length === 2, `new MySqlConnection 호출이 ${hits.length}곳이다(헬퍼 2곳이어야 한다)`);
  for (const i of hits) {
    const inRead  = i > readSpan[0]  && i < readSpan[1];
    const inWrite = i > writeSpan[0] && i < writeSpan[1];
    assert.ok(inRead || inWrite, `헬퍼 밖에서 연결을 직접 연다(offset ${i}) — 관문이 fail-open이 된다`);
  }
  // 연결 오픈도 헬퍼 밖에 있으면 안 된다.
  const opens = [...projectDb.matchAll(/conn\.OpenAsync\(/g)].map(m => m.index);
  for (const i of opens) {
    const inHelper = (i > readSpan[0] && i < readSpan[1]) || (i > writeSpan[0] && i < writeSpan[1]);
    assert.ok(inHelper, `헬퍼 밖에서 conn.OpenAsync를 직접 부른다(offset ${i})`);
  }
});

test('불변식②: (bool ok, …)를 반환하는 공개 메서드는 전부 OpenWriteAsync를 쓴다', () => {
  const sigs = [...projectDb.matchAll(/public async Task<\(bool ok,[^)]*\)> (\w+)\(/g)];
  assert.ok(sigs.length >= 11, `쓰기 계열 메서드가 ${sigs.length}개뿐이다(11개 이상이어야 한다 — 시그니처 패턴 확인)`);
  for (const m of sigs) {
    const body = bare(projectDb, m[0]);
    assert.ok(/OpenWriteAsync\(/.test(body), `${m[1]}가 쓰기 관문을 거치지 않는다 — 2단계 권한 검사를 빠져나간다`);
    assert.ok(!/OpenReadAsync\(/.test(body), `${m[1]}가 읽기 관문으로 연결을 연다(권한 검사 우회)`);
  }
});

test('관문: 읽기 계열(Load*)은 OpenReadAsync를 쓰고 app_user 조회도 예외가 아니다', () => {
  for (const name of ['LoadProjectsJsonAsync', 'LoadCustomersJsonAsync', 'LoadCustomersFullJsonAsync',
                      'LoadCodesFullJsonAsync', 'LoadAppUserJsonAsync']) {
    const body = bare(projectDb, `public async Task<string?> ${name}(`);
    assert.ok(/OpenReadAsync\(/.test(body), `${name}가 읽기 관문을 거치지 않는다`);
  }
});

test('app_user 조회: 파라미터 바인딩 · 3분기 반환(행 / "{}" / null)', () => {
  const b = bare(projectDb, 'public async Task<string?> LoadAppUserJsonAsync(string? loginId)');
  assert.ok(/WHERE login_id=@id/.test(b) && /AddWithValue\("@id", id\)/.test(b), '값을 파라미터로 바인딩하지 않는다(문자열 연결 금지)');
  assert.ok(/return "\{\}";/.test(b), '미등록(행 없음)을 "{}"로 구분하지 않는다');
  assert.ok(/return null;/.test(b), '연결·질의 실패를 null로 구분하지 않는다');
});

// ══ ⑪ 설정창: 로그인 입력칸 없음 · netcus 자격 UI 제거 ════════════════

test('설정창: netcus 자격증명 UI가 흔적 없이 제거됐다', () => {
  for (const dead of ['ncId', 'ncPw', 'ncSave', 'ncSaveMsg', 'ncPwState', 'ncBadge', 'ncForm',
                      'netcusSaveCreds', 'netcusCredsGet', '__netcusCreds']) {
    assert.ok(!src.includes(dead), `자격증명 UI 잔재가 남아 있다: ${dead}`);
  }
  // 「회사 일간보고」 섹션 자체는 남는다(전송 모드·구조 캡처가 거기 있다).
  assert.ok(/회사 일간보고 \(netcus\)/.test(src), 'netcus 섹션이 통째로 사라졌다(전송 모드까지 잃었다)');
  assert.ok(/name="ncMode"/.test(src), '전송 모드 라디오가 사라졌다');
});

test('설정창 「계정」: 이름+직급 · 소속 · 로그아웃뿐 — 로그인 입력칸이 없다', () => {
  const s = src.indexOf('<div class="set-sec set-sec-top" id="accountSection">');
  assert.ok(s >= 0, '계정 섹션이 없다');
  const sec = src.slice(s, src.indexOf('id="adminSection"', s));
  assert.ok(!/<input/.test(sec), '계정 섹션에 입력칸이 있다 — 로그인 진입점을 둘로 만들면 안 된다(게이트 하나)');
  for (const id of ['acctState', 'acctInfoBlock', 'acctName', 'acctTitle', 'acctOrg', 'acctLogout']) {
    assert.ok(new RegExp('id="' + id + '"').test(sec), `계정 섹션에 #${id}가 없다`);
  }
  assert.ok(!/viewScope|editRole|view_scope|edit_role/.test(sec), '권한을 표시한다(이번 범위 밖 — 추후 열람 기능에서)');
});

test('계정 표기: DB에서 온 값은 textContent로만 넣는다(innerHTML 금지)', () => {
  const b = jsBody('updateAccountUi');
  assert.ok(/textContent/.test(b), 'textContent를 쓰지 않는다');
  assert.ok(!/innerHTML/.test(b), 'DB 문자열을 innerHTML로 넣는다 — 이름·소속이 마크업으로 해석된다');
  assert.ok(/'· 데스크톱 위젯 전용'/.test(b), '브라우저 단독 표기가 없다');
});

test('관리자 섹션은 이번 범위 밖 — 그대로 남아 있다(2단계에서 삭제)', () => {
  for (const id of ['adminSection', 'admAuthPw', 'admAuthOk', 'admLogout']) {
    assert.ok(src.includes(id), `관리자 섹션이 손상됐다: ${id}`);
  }
});

test('호스트의 netcusSaveCreds/netcusCredsGet 처리부는 남아 있다(웹이 부르지 않을 뿐)', () => {
  assert.ok(/case "netcusSaveCreds":/.test(mainWindow), '호스트 케이스를 지웠다 — 다른 흐름이 참조할 수 있다');
  assert.ok(/case "netcusCredsGet":/.test(mainWindow), '호스트 케이스를 지웠다');
  assert.ok(/private void NetcusSaveCreds\(/.test(netcus), 'NetcusSaveCreds 본문을 지웠다');
  assert.ok(/private void NetcusSendCredsState\(\)/.test(netcus), 'SendCredsState 본문을 지웠다');
});

// ══ ⑫ 호스트 계약: 3개 · 실패 code 없음 · 문구 고정 ═══════════════════

test('계약: userSessionGet / userLogin / userLogout 셋뿐이고 실패 code 필드가 없다', () => {
  for (const c of ['userSessionGet', 'userLogin', 'userLogout']) {
    assert.ok(new RegExp(`case "${c}":`).test(mainWindow), `계약 ${c}가 없다`);
  }
  const bodies = [
    bare(mainWindow, 'private void RunUserSessionGet(string reqId)'),
    bare(mainWindow, 'private async Task RunUserLoginAsync(string reqId, string id, string pw)'),
    bare(mainWindow, 'private void RunUserLogout(string reqId)'),
  ].join('\n');
  assert.ok(!/\bcode = "/.test(bodies), '실패 code를 만들었다 — 이전 구현은 7종을 만들었지만 JS가 분기하는 곳이 0곳이었다(죽은 복잡도)');
  assert.ok(!/\.code\b/.test(jsBody('submitLogin')), '웹이 실패 code로 분기한다');
});

test('계약: 실패 문구가 설계 문서와 글자 그대로 일치한다', () => {
  const b = bare(mainWindow, 'private async Task RunUserLoginAsync(string reqId, string id, string pw)');
  const msgs = [
    'ID와 비밀번호를 입력하세요.',
    '다른 회사 시스템 작업이 진행 중입니다 — 잠시 후 다시 시도하세요.',
    '로그인하지 못했습니다 — ID/비밀번호 또는 사내망 연결을 확인하세요.',
    'DB에 연결하지 못했습니다.',
    '사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요.',
    '비활성 처리된 계정입니다.',
    '로그인 정보를 이 PC에 저장하지 못했습니다 — 다시 시도하세요.',
  ];
  for (const m of msgs) assert.ok(b.includes(m), `실패 문구가 계약과 다르다: ${m}`);
});

test('계약: netcus 진행 중은 인증 시도 전에 걸러 "인증 실패"로 오표시하지 않는다', () => {
  const b = bare(mainWindow, 'private async Task RunUserLoginAsync(string reqId, string id, string pw)');
  const busy = b.indexOf('_netcus.IsBusy');
  const verify = b.indexOf('_netcus.LoginVerify(');
  assert.ok(busy >= 0, '진행 중 검사가 없다 — LoginVerify가 false를 돌려 ID/비밀번호 오류로 표시된다(실제 결함)');
  assert.ok(busy < verify, '진행 중 검사가 인증 시도보다 뒤에 있다');
  assert.ok(/public bool IsBusy => _ncBusy;/.test(netcus), 'NetcusService가 진행 상태를 노출하지 않는다');
});

// ══ ⑬ 실사용 결함 3종 (2026-07-30 실측 · 로그/스크린샷 근거) ═════════
// D1 로그인 '실패'가 15.7초(성공은 0.5초) · D2 최소화 창 조각이 화면에 보임 ·
// D3 게이트 카드가 창보다 커서 「위젯 종료」가 잘리고 스크롤·리사이즈도 막혀 탈출구가 사라짐.

test('D1: LoginVerify는 nav 대기를 4000ms로 줄인다 — 실패가 15초 타임아웃을 꽉 기다렸다', () => {
  const b = bare(netcus, 'public async Task<bool> LoginVerify(string id, string pw)');
  assert.ok(/NetcusLoginVerify\(cw, id, pw, 4000\)/.test(b),
    'LoginVerify가 짧은 nav 타임아웃(4000)을 넘기지 않는다 — 실패 시 15.7초를 기다린다(실측)');
  // 헬퍼는 선택적 파라미터여야 한다(기본값 15000) — 그래야 기존 호출부 동작이 그대로다.
  assert.ok(/private async Task<bool> NetcusLoginVerify\(CoreWebView2 cw, string id, string pw, int navTimeoutMs = 15000\)/.test(netcus),
    'NetcusLoginVerify에 기본값 15000짜리 선택적 navTimeoutMs가 없다');
  const h = bare(netcus, 'private async Task<bool> NetcusLoginVerify(CoreWebView2 cw, string id, string pw, int navTimeoutMs = 15000)');
  assert.ok(/NavOnce\(cw, navTimeoutMs\)/.test(h), '헬퍼가 파라미터를 NavOnce에 전달하지 않는다(상수 15000이 그대로 남았다)');
  assert.ok(!/NavOnce\(cw, 15000\)/.test(h), 'NavOnce에 15000이 하드코딩돼 있다');
  // 판정 로직(도달 폴링)은 그대로여야 한다 — 대기를 줄인 근거가 "그 결과를 판정에 쓰지 않는다"였다.
  assert.ok(/for \(int i = 0; i < 16; i\+\+\)/.test(h) && /Task\.Delay\(250\)/.test(h),
    '판정 폴링(16회×250ms)이 바뀌었다 — 대기 단축의 안전 근거가 사라진다');
  // 결과 로그에 소요시간 — 지연 회귀를 로그만으로 관측할 수 있게.
  assert.ok(/사용자 로그인 확인 결과/.test(b) && /ElapsedMilliseconds/.test(b) && /"초"/.test(b),
    '로그인 결과 로그에 소요시간(초)이 없다 — 회귀를 로그로 볼 수 없다');
});

test('D1: 기존 NetcusLoginVerify 호출 6곳은 인자 없이 그대로다(동작 무변경)', () => {
  // 기존 호출부 6곳 = 자격검증 · 일간제출 · 주간채움 · 주간병합 · 범위읽기 · 구조캡처.
  const calls = [...codeOnly(netcus).matchAll(/NetcusLoginVerify\(cw, id, pw([^)]*)\)/g)].map(m => m[1].trim());
  assert.strictEqual(calls.length, 7, `NetcusLoginVerify 호출이 ${calls.length}곳이다(로그인 1 + 기존 6 = 7이어야 한다)`);
  const withArg = calls.filter(a => a !== '');
  assert.deepStrictEqual(withArg, [', 4000'],
    `타임아웃을 넘기는 호출부가 로그인 하나가 아니다: ${JSON.stringify(withArg)} — 나머지 6곳은 15000 그대로여야 한다`);
});

test('D2: EnsureW2 background 분기는 작업표시줄에서도 화면에서도 사라진다', () => {
  const b = bare(netcus, 'private async Task EnsureW2(bool background = false)');
  const i = b.indexOf('if (background)');
  assert.ok(i >= 0, 'background 분기를 찾지 못함');
  // 분기 경계를 중괄호 짝으로 정확히 자른다 — "다음 줄까지"로 자르면 분기 '밖'에 놓인 한 줄이
  // 분기 안으로 오인돼 가시 창 오염을 놓친다(실제로 변이 주입에서 빠져나갔다).
  const open = b.indexOf('{', i);
  assert.ok(open >= 0, 'background 분기가 블록({})이 아니다');
  let depth = 0, close = -1;
  for (let k = open; k < b.length; k++) {
    if (b[k] === '{') depth++;
    else if (b[k] === '}') { depth--; if (depth === 0) { close = k; break; } }
  }
  assert.ok(close > open, 'background 분기의 닫는 중괄호를 찾지 못함');
  const br = b.slice(i, close + 1);
  assert.ok(/ShowInTaskbar = false/.test(br), 'ShowInTaskbar=false가 없다 — 작업표시줄 버튼 + 최소화 창 조각이 화면에 보인다(실측 스크린샷)');
  assert.ok(/WindowStartupLocation\.Manual/.test(br), 'Manual이 아니면 CenterScreen이 Left/Top을 무시한다');
  assert.ok(/Left = -32000/.test(br) && /Top = -32000/.test(br), '복원돼도 화면 밖이 되도록 좌표를 밀어두지 않았다');
  assert.ok(/WindowState\.Minimized/.test(br) && /ShowActivated = false/.test(br), '기존 최소화·비활성 생성이 사라졌다');
  // 분기 '밖'은 절대 오염되면 안 된다 — 일간 전송·주간 채움은 창이 보여야 한다.
  const outside = b.slice(0, i) + b.slice(close + 1);
  assert.ok(!/ShowInTaskbar/.test(outside) && !/-32000/.test(outside) && !/WindowStartupLocation\.Manual/.test(outside),
    '숨김 설정이 background 분기 밖으로 새어 가시 창까지 숨겼다 — 일간 전송·주간 채움은 사용자가 결과를 봐야 한다');
});

test('D3/F1: 게이트가 스크롤 컨테이너다 — 카드가 넘쳐도 「위젯 종료」에 도달할 수 있다', () => {
  const g = /\.lg-gate\{([^}]*)\}/.exec(src);
  assert.ok(g, '.lg-gate 규칙을 찾지 못함');
  assert.ok(/overflow-y:auto/.test(g[1]), '게이트가 스크롤되지 않는다 — body{overflow:hidden}이라 넘친 부분에 영영 도달 못 한다');
  assert.ok(/align-items:flex-start/.test(g[1]), 'align-items:center 단독이면 넘칠 때 카드 위쪽이 스크롤로 도달 불가해진다');
  const c = /\.lg-card\{([^}]*)\}/.exec(src);
  assert.ok(c && /margin:auto/.test(c[1]), '.lg-card에 margin:auto가 없다 — 들어갈 때 중앙 정렬이 깨진다');
  // 리사이즈 그립이 게이트에 덮이는 건 그대로다(z-index 200 < 300) → 스크롤이 유일한 탈출 경로다.
  assert.ok(/\.rsz\{[^}]*z-index:200/.test(src), '.rsz z-index 전제가 바뀌었다 — 이 테스트의 근거를 다시 확인할 것');
});

test('D3/F2: 실패 문구는 .lg-foot 밖 + 자리 예약(2줄) — 나타날 때 카드가 튀지 않는다', () => {
  const g = gateMarkup();
  const foot = /<div class="lg-foot">([\s\S]*?)<\/div>/.exec(g);
  assert.ok(foot, '.lg-foot을 찾지 못함');
  assert.ok(!/lgMsg/.test(foot[1]), '#lgMsg가 아직 .lg-foot 안이다 — flex-wrap으로 감기며 foot이 37→84px로 늘어 카드가 47px 점프한다');
  assert.ok(/<div class="lg-msg" id="lgMsg" role="alert" aria-live="assertive"><\/div>/.test(g),
    '#lgMsg가 role="alert" 전용 블록이 아니다');
  assert.ok(!/git-opt/.test(g), 'git-opt 클래스가 남아 있다 — 그 muted 때문에 JS가 색을 인라인으로 덮어써야 했다');
  const m = /\.lg-msg\{([^}]*)\}/.exec(src);
  assert.ok(m, '.lg-msg 규칙이 없다');
  const mh = /min-height:(\d+)px/.exec(m[1]);
  assert.ok(mh, '.lg-msg에 min-height 자리 예약이 없다');
  assert.ok(Number(mh[1]) >= 36, `min-height가 ${mh[1]}px다 — 확정 문구 7종 중 4종이 2줄이라 1줄(18px) 예약으론 점프가 남는다`);
  assert.ok(/color:var\(--danger-text\)/.test(m[1]), '실패색을 CSS가 소유하지 않는다');
});

test('D3/F2: JS는 실패 문구 색을 인라인으로 지정하지 않는다(색은 CSS 소유)', () => {
  for (const fn of ['submitLogin', 'hideLoginGate']) {
    const b = jsBody(fn);
    assert.ok(!/style\.color/.test(b), `${fn}이 msg.style.color를 쓴다 — 색 소유권이 둘로 갈라진다`);
  }
});

test('D3/F3: 진행 중 버튼은 disabled만으로 죽지 않는다(채움색 유지 + aria-busy)', () => {
  const b = jsBody('submitLogin');
  assert.ok(/setAttribute\('aria-busy', ?'true'\)/.test(b), '진행 중 aria-busy를 주지 않는다');
  assert.ok(/removeAttribute\('aria-busy'\)/.test(b), '끝난 뒤 aria-busy를 걷지 않는다');
  assert.ok(/btn\.textContent = '확인 중…'/.test(b), '진행 중 라벨이 "확인 중…"이 아니다');
  const r = /\.lg-foot \.btn\.primary\[aria-busy="true"\]\{([^}]*)\}/.exec(src);
  assert.ok(r, 'aria-busy 버튼 스타일 규칙이 없다 — disabled 회색 면(게이트 배경 대비 1.12:1)이 그대로 보인다');
  assert.ok(/background:var\(--accent-fill\)/.test(r[1]) && /color:var\(--on-accent\)/.test(r[1]),
    '진행 중 버튼이 accent 채움 + on-accent 글자를 유지하지 않는다');
  assert.ok(/opacity:1/.test(r[1]), 'opacity:.5(.btn:disabled)를 되돌리지 않아 여전히 흐리다');
});

test('D3/F4: 카드 컴팩트 — 안내문 1줄 · DPAPI 설명 없음 · 간격은 기존 스케일', () => {
  const g = gateMarkup();
  const note = /<div class="lg-note">([\s\S]*?)<\/div>/.exec(g);
  assert.ok(note, '.lg-note를 찾지 못함');
  assert.ok(!/DPAPI/.test(g), '로그인 화면에 DPAPI 같은 기술 설명이 남아 있다(아무도 읽지 않는 4줄이 카드의 23%였다)');
  assert.ok(note[1].length <= 40, `안내문이 ${note[1].length}자다 — 한 줄로 줄여야 한다`);
  assert.ok(!/<b>/.test(note[1]), '안내문에 강조 태그가 남아 있다(줄이 늘어난다)');
  // 라벨과 placeholder가 같은 말을 반복하지 않는다.
  assert.ok(!/placeholder="회사 시스템 ID"/.test(g) && !/placeholder="회사 시스템 비밀번호"/.test(g),
    'placeholder가 라벨을 그대로 반복한다');
  // 간격 하드코딩 제거 — 기존 --sp-* 스케일만 쓴다(신규 토큰 신설 금지).
  for (const [sel, dead] of [['.lg-gate', 'padding:20px'], ['.lg-status', 'margin:2px 0 14px'],
                             ['.lg-foot', 'margin-top:12px'], ['.lg-note', 'margin-top:16px'],
                             ['.lg-quit-row', 'margin-top:14px']]) {
    const rule = new RegExp(sel.replace('.', '\\.') + '\\{([^}]*)\\}').exec(src);
    assert.ok(rule, `${sel} 규칙이 없다`);
    assert.ok(!rule[1].includes(dead), `${sel}에 하드코딩 간격이 남아 있다: ${dead}`);
    assert.ok(/var\(--sp-\d\)/.test(rule[1]), `${sel}이 --sp-* 스케일을 쓰지 않는다`);
  }
  // 제목/상태문구의 층 — 제목은 --fs-head, 상태문구는 지시문이므로 --fs-body/--text(muted·meta는 sepia AA 미달).
  assert.ok(/\.lg-title\{[^}]*font-size:var\(--fs-head\)/.test(src), '.lg-title이 --fs-head가 아니다');
  const st = /\.lg-status\{([^}]*)\}/.exec(src);
  assert.ok(st && /font-size:var\(--fs-body\)/.test(st[1]) && /color:var\(--text\)/.test(st[1]),
    '.lg-status가 --fs-body/--text가 아니다(sepia에서 4.38:1 AA 미달이었다)');
  // 신규 토큰 신설 금지 — 게이트 규칙이 쓰는 var()는 전부 :root에 이미 있는 것이어야 한다.
  const gateCss = src.slice(src.indexOf('.lg-gate{'), src.indexOf('.lg-quit-row{') + 120);
  for (const v of new Set([...gateCss.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]))) {
    assert.ok(new RegExp('\\' + v + ':').test(src.slice(0, src.indexOf('.lg-gate{'))), `게이트가 신규 토큰을 만들었다: ${v}`);
  }
});

// ══ ⑭ 로그인 실패가 상한을 통째로 버리던 결함 (2026-07-30 실측) ═══════
// 실사용 로그: 실패 4.5s · 4.5s · 4.6s = navTimeoutMs(4000)와 정확히 일치, 성공 0.6s.
// 원인: 실패 때는 goLogin()이 document.form.submit()에 닿지 못해 '이동이 아예 없다'.
//   그런데 코드는 NavOnce(=다음 이동 1회)를 await 했다 — 안 일어난 일에는 이벤트가 없으므로
//   상한이 지나야 풀린다. 게다가 주입 스크립트의 빈 catch가 예외까지 삼켜 흔적이 0이었다.
// 해법: 주입 스크립트가 '제출까지 갔는지'를 직접 돌려주고(1/0/'ERR:…'), 0·ERR이면 기다리지 않는다.
// 배제된 후보(실측): 네트워크(왕복 47ms) · WebView2 생성(성공 전체가 0.6s) · alert(로그 0건).

// NetcusLoginVerify 본문(주석 제거, 문자열은 보존 — 로그 문구·주입 스크립트를 봐야 한다).
const loginHelperSig =
  'private async Task<bool> NetcusLoginVerify(CoreWebView2 cw, string id, string pw, int navTimeoutMs = 15000)';
const helper = () => bare(netcus, loginHelperSig);

// C# 블록 슬라이스 — fromIdx 이후 첫 '{'부터 짝이 맞는 '}'까지. 문자열 리터럴 안의 중괄호는 세지 않는다
// ($"…{tA}ms…" 보간이나 주입 스크립트의 function(){…}이 깊이를 흔들면 분기 경계가 통째로 어긋난다).
function csBlock(s, fromIdx) {
  const open = s.indexOf('{', fromIdx);
  assert.ok(open >= 0, '블록의 여는 중괄호를 찾지 못함');
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    const c = s[k];
    if (c === '"' || c === "'") {
      let j = k + 1;
      while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === c) break; j++; }
      k = j; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { start: open, end: k, body: s.slice(open, k + 1) }; }
  }
  assert.fail('블록의 닫는 중괄호를 찾지 못함');
}

// 로그인 주입 스크립트(브라우저에 실제로 들어가는 문자열) — 조각난 리터럴을 이어 붙인다.
function injectedLoginScript(h) {
  const s = h.indexOf('await cw.ExecuteScriptAsync(');
  assert.ok(s >= 0, '로그인 주입 스크립트 호출을 찾지 못함');
  const e = h.indexOf('.Trim();', s);
  assert.ok(e > s, '로그인 주입 스크립트 호출의 끝(.Trim())을 찾지 못함');
  const js = [...h.slice(s, e).matchAll(/"((?:\\.|[^"\\])*)"/g)].map(m => m[1]).join('');
  assert.ok(/goLogin\(\)/.test(js), '첫 ExecuteScriptAsync가 로그인 주입이 아니다(goLogin이 없다)');
  return js;
}

test('E1: 주입 스크립트가 제출 여부를 돌려준다 — submitted?1:0 · 예외는 ERR:(빈 catch 아님)', () => {
  const js = injectedLoginScript(helper());
  assert.ok(/var submitted=false;/.test(js), '제출 여부 플래그가 없다 — 다시 "이동을 기다린다"로 돌아간다');
  assert.ok(/return submitted\?1:0;/.test(js), '제출 여부를 반환하지 않는다 — 호스트가 판단할 근거가 사라진다');
  assert.ok(/catch\(e\)\{return 'ERR:'\+\(\(e&&e\.message\)\?e\.message:String\(e\)\);\}/.test(js),
    'catch가 ERR:<메시지>를 돌려주지 않는다 — 예외를 삼키면 실패 원인이 로그에 0건으로 남는다(이번 결함의 본체)');
  assert.ok(!/catch\(e\)\{\}/.test(js), '빈 catch가 남아 있다 — 예외가 통째로 사라진다');
  // 호스트도 그 문자열을 실제로 해석해야 한다(JSON 문자열이라 따옴표가 붙는다).
  const h = helper();
  assert.ok(/JsonSerializer\.Deserialize<string>\(res\)/.test(h), '반환된 JSON 문자열을 풀지 않는다 — "ERR:…"가 영영 매칭되지 않는다');
  assert.ok(/errMsg\.StartsWith\("ERR:", StringComparison\.Ordinal\)/.test(h), 'ERR: 판정이 없다');
});

test('E2: document.form.submit을 저장→교체→원복한다(원복 없으면 남은 페이지가 오염된다)', () => {
  const js = injectedLoginScript(helper());
  assert.ok(/var orig=document\.form\.submit;/.test(js), '네이티브 submit을 저장하지 않는다');
  assert.ok(/document\.form\.submit=function\(\)\{submitted=true;return orig\.apply\(this,arguments\);\};/.test(js),
    '감싼 submit이 원본을 그대로 위임하지 않는다 — 성공 경로의 실제 제출이 달라진다');
  assert.ok(/finally\{try\{document\.form\.submit=orig;\}catch\(_\)\{\}\}/.test(js),
    '원복이 finally에 없다 — 제출이 안 된 경우 그 페이지가 남으므로 감싼 함수가 그대로 살아 있게 된다');
  const [iSave, iSwap, iCall, iBack] = ['var orig=document.form.submit;', 'document.form.submit=function()',
                                        'goLogin();', 'document.form.submit=orig;'].map(t => js.indexOf(t));
  assert.ok(iSave >= 0 && iSwap > iSave && iCall > iSwap && iBack > iCall,
    `저장→교체→goLogin→원복 순서가 어긋났다: ${JSON.stringify([iSave, iSwap, iCall, iBack])}`);
});

test('E3: "0"/"ERR:"는 nav를 기다리지 않고 즉시 실패한다(상한을 통째로 버리던 4.5초)', () => {
  const h = helper();
  const iIf = h.indexOf('if (res == "0" || scriptErr)');
  assert.ok(iIf >= 0, '제출 실패 즉시반환 분기가 없다 — 실패가 다시 상한(4.0s)을 꽉 기다린다');
  const blk = csBlock(h, iIf);
  assert.ok(/return false;/.test(blk.body), '즉시반환 분기가 false를 돌려주지 않는다');
  assert.ok(!/await nav/.test(blk.body), '즉시반환 분기 안에서 nav를 기다린다 — 이번 수정의 핵심이 사라졌다');
  const navs = [...h.matchAll(/await nav\b/g)].map(m => m.index);
  assert.strictEqual(navs.length, 1, `await nav가 ${navs.length}곳이다(성공 경로 1곳이어야 한다)`);
  assert.ok(navs[0] > blk.end, 'await nav가 즉시반환 분기보다 앞에 있다 — 분기해봐야 이미 상한을 다 기다린 뒤다');
  // 버려지는 리스너는 명시적으로 표시한다(NavOnce가 상한에 스스로 떼므로 누수는 없다).
  assert.ok(/_ = nav;/.test(blk.body), '버리는 nav를 명시하지 않는다(_ = nav;)');
  // 리스너는 여전히 '제출 전'에 붙는다 — 제출 후에 붙이면 이미 끝난 이동을 놓쳐 성공이 상한까지 늘어진다.
  const iNavOnce = h.indexOf('NavOnce(cw, navTimeoutMs)');
  const iScript  = h.indexOf('await cw.ExecuteScriptAsync(');
  assert.ok(iNavOnce >= 0 && iNavOnce < iScript,
    '이동 리스너를 제출보다 뒤에 붙인다 — 성공 이동을 놓치면 성공 경로가 느려진다');
});

test('E4: "1"(제출됨) 경로는 기존과 동일 — await nav → work_view → 판정 폴링', () => {
  const h = helper();
  const iNav  = h.indexOf('await nav;');
  const iView = h.indexOf('pjm_work_view.jsp');
  const iPoll = h.indexOf('for (int i = 0; i < 16; i++)');
  assert.ok(iNav >= 0 && iView > iNav && iPoll > iView,
    `성공 경로의 순서가 바뀌었다(대기→work_view→폴링): ${JSON.stringify([iNav, iView, iPoll])}`);
  // 성공/실패 판정 자체는 여전히 도달 폴링만 한다 — 제출 여부를 성공 근거로 승격하면 안 된다.
  assert.ok(!/return true;/.test(csBlock(h, h.indexOf('if (res == "0" || scriptErr)')).body),
    '즉시반환 분기가 true를 돌려준다 — 제출됐다는 사실이 로그인 성공으로 둔갑한다');
  const trues = [...h.matchAll(/return true;/g)].map(m => m.index);
  assert.strictEqual(trues.length, 1, `return true가 ${trues.length}곳이다(폴링의 content 확인 1곳이어야 한다)`);
  assert.ok(trues[0] > iPoll, 'true를 돌려주는 자리가 판정 폴링 밖이다');
});

test('E5: 알 수 없는 반환값은 보수적으로 기존 경로(대기 후 판정)를 탄다', () => {
  const h = helper();
  // 조건이 "1이 아니면 전부 실패"로 넓어지면 예상 못 한 반환값 하나에 로그인이 통째로 깨진다.
  for (const bad of ['if (res != "1")', 'if (!submitted)', 'if (res == "1")']) {
    assert.ok(!h.includes(bad), `즉시반환 조건이 넓어졌다(${bad}) — 모르는 값은 기다렸다 판정해야 한다`);
  }
  assert.ok(/if \(res == "0" \|\| scriptErr\)/.test(h), '즉시반환은 0과 ERR: 두 경우에만 걸려야 한다');
  assert.ok(/"\?"/.test(h), '알 수 없는 반환값을 구분하는 표식(?)이 없다 — 로그에서 "모르는 값"을 볼 수 없다');
});

test('E6: 비밀번호는 반환값·로그 어디에도 실리지 않는다', () => {
  const h = helper();
  const js = injectedLoginScript(h);
  assert.ok(/document\.form\.pass\.value=/.test(js), '비밀번호를 폼에 넣지 않는다(로그인 자체가 안 된다)');
  assert.ok(!/return[^;]*pass/.test(js), '반환값에 비밀번호 칸이 실린다');
  assert.ok(!/'ERR:'\+[^;]*pass/.test(js), '예외 메시지에 비밀번호 칸을 붙인다');
  // C#에서 pw가 등장해도 되는 줄은 시그니처와 폼 채우기 한 줄뿐이다.
  const ALLOWED = [/string pw, int navTimeoutMs = 15000\)/, /document\.form\.pass\.value=\{J\(pw\)\}/];
  for (const line of h.split('\n')) {
    if (!/\bpw\b/.test(line)) continue;
    assert.ok(ALLOWED.some(re => re.test(line)), `헬퍼의 허용되지 않은 자리에 비밀번호가 흐른다 → ${line.trim()}`);
  }
  for (const m of h.matchAll(/Log\((?:[^()]|\([^()]*\))*\)/g)) {
    assert.ok(!/\bpw\b/.test(m[0]), `로그 호출에 비밀번호가 실린다 → ${m[0].trim()}`);
  }
});

test('E7: 판정 폴링·판정 기준·NavTo/NavOnce·공유 호출부 6곳은 무변경', () => {
  const h = helper();
  assert.ok(/for \(int i = 0; i < 16; i\+\+\)/.test(h) && /Task\.Delay\(250\)/.test(h), '판정 폴링(16회×250ms)이 바뀌었다');
  assert.ok(/getElementsByName\('content'\)\[0\]/.test(h) && /querySelector\('input\[type=password\]'\)/.test(h),
    '판정 기준(content textarea / input[type=password])이 바뀌었다');
  assert.ok(/if \(st == "1"\) return true;/.test(h) && /if \(st == "-1"\) return false;/.test(h), '폴링 판정 분기가 바뀌었다');
  const navTo = bare(netcus, 'private Task<bool> NavTo(CoreWebView2 cw, string url)');
  assert.ok(/Task\.Delay\(20000\)/.test(navTo) && /tcs\.TrySetResult\(ev\.IsSuccess\)/.test(navTo), 'NavTo 본문이 바뀌었다');
  const navOnce = bare(netcus, 'private Task<bool> NavOnce(CoreWebView2 cw, int timeoutMs)');
  assert.ok(/Task\.Delay\(timeoutMs\)/.test(navOnce) && /cw\.NavigationCompleted -= H/.test(navOnce),
    'NavOnce가 상한에 스스로 핸들러를 떼지 않는다 — 즉시반환 경로에서 버린 리스너가 누수된다');
  // 6개 공유 호출부(자격검증·일간제출·주간채움·주간병합·범위읽기·구조캡처)는 인자 없이 그대로.
  const calls = [...codeOnly(netcus).matchAll(/NetcusLoginVerify\(cw, id, pw([^)]*)\)/g)].map(m => m[1].trim());
  assert.strictEqual(calls.length, 7, `NetcusLoginVerify 호출이 ${calls.length}곳이다(로그인 1 + 공유 6 = 7)`);
  assert.deepStrictEqual(calls.filter(a => a !== ''), [', 4000'], '타임아웃을 넘기는 호출부가 로그인 하나가 아니다');
});

test('E8: 로그만으로 원인이 확정된다 — 구간 계측 유지 + 제출 판정 첨부', () => {
  const h = helper();
  assert.ok(/로그인 구간: login\.htm \{tA\}ms/.test(h), '구간 계측 로그가 사라졌다');
  assert.strictEqual((h.match(/제출=\{mark\}/g) || []).length, 2,
    '제출 판정(제출=…)이 두 경로(즉시실패·기존경로) 모두에 붙어 있지 않다');
  assert.ok(h.includes('로그인 제출 안 됨(goLogin 이 submit 까지 가지 않음) — 즉시 실패 처리'), '미제출 로그 문구가 계약과 다르다');
  assert.ok(h.includes('로그인 스크립트 예외: '), '스크립트 예외 로그 문구가 없다');
  assert.ok(h.includes(' — 즉시 실패 처리'), '즉시 실패 처리 표기가 없다');
  assert.ok(/errMsg\.Substring\(4\)/.test(h), '예외 메시지를 그대로(ERR: 접두어만 떼고) 남기지 않는다');
  // 직전 커밋의 WebView2 준비 계측도 유지된다.
  const b = bare(netcus, 'public async Task<bool> LoginVerify(string id, string pw)');
  assert.ok(/WebView2 준비/.test(b) && /재사용/.test(b) && /신규 생성/.test(b), 'WebView2 준비 계측이 사라졌다');
});
