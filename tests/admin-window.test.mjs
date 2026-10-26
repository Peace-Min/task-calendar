// 관리 화면 별도 창(docs/ADMIN-WINDOW.md) — 호스트의 창 종류(WinKind, widget/AppWindow.cs)와 웹의 ?win=admin 모드.
//
// 이 파일이 지키는 것:
//   (S) 호스트: 창 종류 등록(열람 창, 관리 창. 주소, 제목, 최소와 처음 크기, 번호 머리, 준비 알림, 목록 알림, 닫기 전 확인, 자리 기억 키).
//       관리 창 허용 목록이 관리 화면이 쓰는 명령과 같고(웹의 ADMINWIN_CMD 와도 같다), 쓰기 밖의 명령(저장, 부팅, 창 조작)이 없다.
//       열람 창 목록은 그대로다. 관리 창 열기(adminOpen)는 메인 창에서만 받고, 세션의 사람이 관리자일 때만 연다(이미 열려 있으면
//       앞으로 가져오기만). 'aw:' 번호의 회신은 보낸 창으로만 간다. 목록 갱신 알림(__applyProjects, __applyCodes, __applyCustomers,
//       __projectSaved)은 메인 창과 관리 창 둘 다로 간다. 새 과제는 메인 창에 자동 편입 대상을 알린다. 관리 창이 연 엑셀 저장 대화상자의
//       주인은 관리 창이다. 관리 창은 닫기 전에 웹에 묻는다(저장 안 한 입력, §2.2).
//   (P) AdminFromUserInfo 를 C# 그대로 컴파일해 돌린다(관리자 아님, 비활성, 미등록, 읽기 실패면 열지 않는다).
//   (R) jsdom: ?win=admin 은 내 달력을 부팅하지 않고 준비 알림과 목록 읽기만 보낸다. 봉인(목록 밖 명령은 나가지 않는다),
//       'aw:' 와 창 소금. __adminWinOpen 이 허브를 그 항목으로 연다. 허브가 창을 채우고 허브와 그 위 창만 보인다.
//       메인 창은 허브를 열지 않고 adminOpen 만 보낸다. 관리자가 아니면 틀을 내리고 창을 닫는다. 닫기 전 확인(ask, close, busy).
//       Esc 로 창을 닫지 않는다. 목록 알림이 관리 창에도 반영되고 메인 창이 자동 편입 대상을 받는다. 버전 관문 카드는 작은 변형.
//   (M) 변이: 관리 창 봉인 빼기, 메인 창의 허브 우회 빼기, 호스트 목록에 쓰기 명령 넣기, 목록 알림을 메인 창 하나로, 닫기 전 확인 빼기,
//       웹의 저장 안 한 입력 판정 빼기, C# 관리자 판정의 비활성 갈래 빼기를 잡는다.
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다. dotnet 이 없으면 (P)가 그렇다.
import { test, skip, assert, loadAppSource, extractCsMember, stripCsComments,
         importOptional, countTestsBelow, SKIP_NO_JSDOM, readText } from './harness.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const app = loadAppSource();
const CS = readText(new URL('../widget/MainWindow.xaml.cs', import.meta.url)).replace(/\r/g, '');
const AW = readText(new URL('../widget/AppWindow.cs', import.meta.url)).replace(/\r/g, '');
const GH = readText(new URL('../widget/GateHost.cs', import.meta.url)).replace(/\r/g, '');

function mutate(text, find, repl) {
  const n = text.split(find).length - 1;
  assert.equal(n, 1, `변이 앵커가 ${n}번 나온다: ${find.slice(0, 80)}`);
  return text.replace(find, repl);
}
const member = (src, sig) => extractCsMember(src, sig);

//  관리 화면이 쓰는 명령(코드에서 하나씩 셌다: 허브 관리자 확인, 공식 과제, 발주처, 구분과 상태, 회의실, 구성원과 직원 편집, 직급, 소속, 휴지통).
const ADMIN_CMDS = ['adminWinReady', 'userInfoGet', 'gateRecheck',
  'loadProjects', 'loadCustomers', 'loadCodes',
  'saveProject', 'setProjectActive', 'projectReorder', 'exportProjectsXlsx', 'openFolder',   // projectReorder: 과제 순서(2026-10-26 PROJECT-ADMIN-UX §1.1)
  'loadCustomersFull', 'addCustomer', 'renameCustomer', 'setCustomerActive', 'customerRefCount',
  'getCodesFull', 'codeAdd', 'codeRename', 'codeSetActive', 'codeReorder', 'codeRefCount',
  'roomsFull', 'roomAdd', 'roomRename', 'roomDelete', 'roomReorder',
  'membersGet', 'saveUser', 'setUserActive', 'saveUserOrder',
  'orgTitleGet', 'titleAdd', 'titleRename', 'titleSetActive', 'titleReorder',
  'unitAdd', 'unitRename', 'unitSetActive', 'unitMove', 'unitReorder',
  'trashGet', 'trashRestore', 'trashDelete'].sort();
//  관리 창이 보내면 안 되는 것(내 달력 부팅과 저장, 보고, 창 조작, 다른 창 열기, 업데이트)
const NEVER = ['ready', 'reloadState', 'saveState', 'replaceAllState', 'unsavedState', 'userLogin', 'userLogout', 'userSessionGet',
  'peerOpen', 'adminOpen', 'peerSchedule', 'peerMine', 'peerWinReady', 'netcusSubmit', 'netcusWeekSubmit', 'reminderSync',
  'updateApply', 'updateCheck', 'updateSetSource', 'close', 'hide', 'menu', 'pin', 'focus', 'winMinimize', 'winMaximizeToggle',
  'dragbegin', 'resizebegin', 'pickImportXml', 'exportResearch', 'openLogFolder', '__dbFault', 'dbPing'];   // pickfolder 는 2026-10-26 Git, SVN 삭제로 명령째 없앴다
const PEER_CMDS = ['gateRecheck', 'membersGet', 'peerMine', 'peerSchedule', 'peerWinReady'];

function hostSet(cs, name) {
  const m = new RegExp(`internal static readonly HashSet<string> ${name} = new\\(StringComparer\\.Ordinal\\)\\s*\\{([^}]*)\\}`).exec(stripCsComments(cs));
  assert.ok(m, `${name} 목록을 찾지 못했다`);
  return [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort();
}
function webSet(src) {
  const m = /const ADMINWIN_CMD = new Set\(\[([\s\S]*?)\]\);/.exec(src);
  assert.ok(m, 'ADMINWIN_CMD 를 찾지 못했다');
  return [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
}
function kindBody(aw, name) {
  const m = new RegExp(`public static readonly WinKind ${name} = new\\(\\)\\s*\\{([\\s\\S]*?)\\};`).exec(aw);
  assert.ok(m, `WinKind.${name} 정의를 찾지 못했다`);
  return m[1];
}

// ══ (S) 호스트 ════════════════════════════════════════════════════════
const S = {
  registry(aw, cs) {
    const k = kindBody(aw, 'Admin');
    assert.match(k, /Id = "admin", Name = "관리 창", Url = "https:\/\/tcapp\.local\/index\.html\?win=admin", Title = "수행과제 캘린더 관리",/, '관리 창의 주소나 제목이 기획(§2.4)과 다르다');
    assert.match(k, /TitleFollowsDocument = false, MinWidth = 720, MinHeight = 520, DefaultWidth = 1200, DefaultHeight = 800,/, '관리 창의 크기 규칙이 기획(§2.1)과 다르다');
    assert.match(k, /ReqPrefix = MainWindow\.AdminReqPrefix, ReadyCmd = "adminWinReady", AnyCmdWithoutReq = true,/);
    assert.match(k, /Commands = MainWindow\.AdminWinCommands, OpenFn = "__adminWinOpen",/);
    assert.match(k, /GetsCatalog = true, AskBeforeClose = true,/, '관리 창이 목록 알림을 받지 않거나 닫기 전에 묻지 않는다');
    assert.match(k, /GetBounds = s => s\.Admin, SetBounds = \(s, b\) => s\.Admin = b,/, '관리 창 자리가 열람 창과 따로 기억되지 않는다');
    assert.match(kindBody(aw, 'Peer'), /GetsCatalog = false, AskBeforeClose = false,/, '열람 창의 동작이 바뀌었다(목록 알림, 닫기 확인)');
    assert.match(aw, /public static readonly IReadOnlyList<WinKind> All = new\[\] \{ Peer, Admin \};/, '창 종류 등록이 열람 창과 관리 창이 아니다');
    assert.match(cs, /internal const string PeerReqPrefix = "pw:";\s*internal const string AdminReqPrefix = "aw:";/, '번호 머리가 pw:, aw: 가 아니다');
    assert.match(cs, /public PeerWindowBounds\? Admin \{ get; set; \}/, '설정에 관리 창 자리가 없다');
    assert.match(aw, /public static WinKind\? OfReq\(string reqId\) =>\s*string\.IsNullOrEmpty\(reqId\) \? null : All\.FirstOrDefault\(k => reqId\.StartsWith\(k\.ReqPrefix, StringComparison\.Ordinal\)\);/, '번호 머리로 창 종류를 찾지 않는다');
  },
  whitelist(cs, src) {
    const host = hostSet(cs, 'AdminWinCommands');
    assert.deepStrictEqual(host, ADMIN_CMDS, '관리 창 허용 목록이 관리 화면이 쓰는 명령과 다르다');
    assert.deepStrictEqual(webSet(src), host, '웹(ADMINWIN_CMD)과 호스트(AdminWinCommands)의 관리 창 목록이 다르다');
    const bad = NEVER.filter((c) => host.includes(c));
    assert.deepStrictEqual(bad, [], '관리 창이 보내면 안 되는 명령이 목록에 있다');
    assert.deepStrictEqual(hostSet(cs, 'PeerWinCommands'), PEER_CMDS, '열람 창 목록이 바뀌었다');
    //  관리 창이 실제로 보내는 hostRequest/hpost 명령이 목록 밖에 없다(관리 화면 함수들의 문자열 명령을 센다)
    for (const fn of ['adminWinBoot', 'adminWinLoadCatalog', 'ahProbe']) {
      const a = src.indexOf('function ' + fn + '(');
      assert.ok(a >= 0, fn + ' 가 없다');
      const body = src.slice(a, src.indexOf('\n}\n', a));
      for (const m of body.matchAll(/(?:hostRequest\('|cmd:\s*')(\w+)'/g)) assert.ok(host.includes(m[1]), `${fn} 가 목록 밖 명령 ${m[1]} 을 보낸다`);
    }
  },
  filter(cs) {
    const d = member(cs, 'private void OnWebMessage(CoreWebView2WebMessageReceivedEventArgs e, CoreWebView2? origin)');
    assert.match(d, /if \(!fromWin\.Commands\.Contains\(cmd\) \|\| !\(ownReq \|\| \(rq\.Length == 0 && fromWin\.AcceptsWithoutReq\(cmd\)\)\)\)/, '따로 뜨는 창의 명령을 그 종류의 목록으로 거르지 않는다');
    assert.match(d, /else if \(rqKind != null\) return;/, '메인 창이 머리 달린 번호(aw:)를 쓰면 버리지 않는다');
    assert.match(d, /case "adminOpen":[^\n]*\n\s*if \(fromWin == null\) _ = OpenAdminWindowAsync\(rq, GetStr\(doc, "item"\)\);/, '관리 창 열기를 메인 창에서만 받지 않는다');
    assert.match(d, /case "adminWinReady":\s*if \(fromWin != null && cmd == fromWin\.ReadyCmd\)\s*\{\s*WinOf\(fromWin\)\?\.OnWebReady\(\);\s*GatePushToWin\(fromWin\);/, '관리 창 준비 알림에 대상과 관문 상태를 넘기지 않는다');
    assert.match(d, /RunMembersGetAsync\(GetStr\(doc, "reqId"\), !fromPeer && GetBool\(doc, "includeInactive"\), !fromPeer && GetBool\(doc, "flat"\)\)/, '관리 창의 구성원 편집이 퇴사자 보기, 서열 순을 못 쓴다(또는 열람 창이 쓴다)');
    const rc = member(cs, 'private CoreWebView2? ReplyCore(string reqId)');
    assert.match(rc, /var k = WinKind\.OfReq\(reqId\);[\s\S]*var cur = WinOf\(k\)\?\.Core;\s*if \(from == null \|\| cur == null \|\| !ReferenceEquals\(from, cur\)\)/, 'aw: 회신이 보낸 창으로만 가지 않는다');
  },
  openGate(cs) {
    const o = member(cs, 'private async Task OpenAdminWindowAsync(string reqId, string item)');
    assert.match(o, /s = UserSession\.Load\(_dataDir, Log\);[\s\S]*if \(s == null \|\| s\.LoginId\.Length == 0\) \{ ReplyOnUi\(reqId, new \{ ok = false, msg = "로그인이 필요합니다\." \}\); return; \}/, '로그인 전에도 연다');
    const exist = o.indexOf('if (WinOf(WinKind.Admin) != null)'), db = o.indexOf('LoadUserInfoJsonAsync');
    assert.ok(exist > 0 && exist < db, '이미 열린 관리 창을 앞으로 가져오기 전에 DB 를 다시 묻는다(§2.3: 앞으로 가져오기만)');
    assert.match(o, /if \(WinOf\(WinKind\.Admin\) != null\)\s*\{\s*ShowWin\(WinKind\.Admin, AdminTargetJson\(item, s\)\);/, '열린 관리 창을 앞으로 가져오지 않는다');
    assert.match(o, /admin = AdminFromUserInfo\(await _projectDb\.LoadUserInfoJsonAsync\(s\.LoginId\)\);/, '세션의 사람이 관리자인지 DB 에서 읽지 않는다');
    assert.match(o, /if \(admin == false\)\s*\{[\s\S]*ReplyOnUi\(reqId, new \{ ok = false, admin = false, msg = "관리자만 사용할 수 있습니다" \}\);\s*return;\s*\}/, '관리자가 아니어도 연다');
    assert.match(o, /if \(admin == null\) \{ ReplyOnUi\(reqId, new \{ ok = false,/, '확인하지 못했는데 연다');
    assert.ok(o.indexOf('if (admin == false)') < o.indexOf('Dispatcher.Invoke(() => ShowWin(WinKind.Admin'), '판정보다 먼저 창을 띄운다');
    assert.match(o, /if \(now == null \|\| now\.LoginId != s\.LoginId\)/, '기다리는 사이 계정이 바뀌어도 연다');
    assert.match(o, /if \(_adminOpening\)/, '두 번 누르면 창이 둘 뜰 수 있다');
    const j = member(cs, 'private static string AdminTargetJson(string item, UserSession s)');
    assert.ok(!/edit_role|admin\s*=/.test(j), '관리 창에 권한을 내려보낸다(권한은 웹으로 내려보내지 않는다)');
  },
  pushes(cs, gh) {
    for (const fn of ['__applyProjects', '__applyCustomers', '__projectSaved', '__applyCodes']) {
      assert.ok(new RegExp(`CatalogPush\\("window\\.${fn} && window\\.${fn}\\(`).test(cs), `${fn} 가 메인 창과 관리 창 둘 다로 가지 않는다`);
      assert.ok(!new RegExp(`JsCall\\("window\\.${fn} `).test(cs), `${fn} 가 아직 메인 창으로만 간다`);
    }
    const cp = member(cs, 'private void CatalogPush(string js)');
    assert.match(cp, /_ = web\.CoreWebView2\?\.ExecuteScriptAsync\(js\);[\s\S]*foreach \(var w in _wins\.Values\.ToList\(\)\)\s*if \(w\.Kind\.GetsCatalog\) \{ try \{ _ = w\.Core\?\.ExecuteScriptAsync\(js\); \} catch \{ \} \}/, 'CatalogPush 가 메인 창과 목록을 받는 창 둘 다에 밀지 않는다');
    assert.match(cp, /Dispatcher\.Invoke/, 'CatalogPush 가 UI 스레드로 넘기지 않는다');
    const pg = member(gh, 'private void PushGate(string json)');
    assert.match(pg, /foreach \(var w in _wins\.Values\.ToList\(\)\)/, '관문 상태가 관리 창에 가지 않는다');
    const sp = member(cs, 'private async Task SaveProjectAsync(string uid, int sectionId, int customerId, string projectName,');
    assert.match(sp, /if \(ok && autoSub && string\.IsNullOrEmpty\(uid\)\)\s*JsCall\("window\.__autoSubNext && window\.__autoSubNext\(" \+ JsonSerializer\.Serialize\(new \{ customerId, projectName \}\) \+ "\)"\);\s*if \(ok\) await LoadProjectsToWebAsync\(\);/,
      '새 과제를 만든 사람의 캘린더(메인 창)에 자동 편입 대상을 목록 알림보다 먼저 알리지 않는다(또는 폼이 아닌 저장도 편입한다)');
    assert.match(member(cs, 'private void OnWebMessage(CoreWebView2WebMessageReceivedEventArgs e, CoreWebView2? origin)'), /GetStr\(doc, "note"\), GetBool\(doc, "confirm"\), GetBool\(doc, "autoSub"\)\);/, '편입 표시(autoSub)를 웹에서 받지 않는다');
  },
  dialogOwner(cs) {
    assert.match(cs, /private Window DialogOwner\(WinKind\? from\) => \(Window\?\)\(from != null \? WinOf\(from\) : null\) \?\? this;/);
    assert.match(member(cs, 'private void OnWebMessage(CoreWebView2WebMessageReceivedEventArgs e, CoreWebView2? origin)'), /RunProjectsXlsxExport\(DialogOwner\(fromWin\), reqId, subtitle, fileName, xrows, custRows\);/, '관리 창이 연 엑셀 저장 대화상자의 주인이 관리 창이 아니다');
    const x = member(cs, 'private void RunProjectsXlsxExport(Window owner, string reqId, string subtitle, string fileName,');
    assert.match(x, /if \(dlg\.ShowDialog\(owner\) != true\)/, '엑셀 저장 대화상자가 요청한 창 위에 뜨지 않는다');
  },
  closeAsk(aw) {
    const ctor = member(aw, 'public AppWindow(MainWindow host, WinKind kind, CoreWebView2Environment env, string appDir, Rect bounds, bool maximized, bool dark)');
    assert.match(ctor, /if \(Kind\.AskBeforeClose && !_closeOk && _ready && Core != null\)\s*\{\s*e\.Cancel = true;\s*_ = AskCloseAsync\(\);\s*return;\s*\}/, '관리 창이 닫기 전에 웹에 묻지 않는다(§2.2)');
    const ask = member(aw, 'private async Task AskCloseAsync()');
    assert.match(ask, /window\.__winCloseRequest/, '닫기 확인을 웹에 묻지 않는다');
    assert.match(ask, /Task\.WhenAny\(t, Task\.Delay\(3000\)\)/, '웹이 답하지 않을 때 닫을 길이 없다');
    assert.match(ask, /if \(ans\.Contains\("ask"\) \|\| ans\.Contains\("busy"\)\) return;\s*CloseNow\(\);/);
    assert.match(member(aw, 'public void CloseNow()'), /_closeOk = true;\s*try \{ Close\(\); \} catch \{ \}/);
    assert.match(member(aw, 'private async Task InitAsync()'), /core\.WindowCloseRequested \+= \(_, _\) => Dispatcher\.BeginInvoke\(new Action\(CloseNow\)\);/, '웹이 확인한 닫기(window.close)를 묻지 않고 받지 않는다');
  },
};
test('(S) 창 종류 등록: 열람 창과 관리 창(주소, 제목, 최소 720x520, 처음 1200x800, aw:, 준비 알림, 목록 알림, 닫기 확인, 자리 키)', () => S.registry(AW, CS));
test('(S) 관리 창 허용 목록 = 관리 화면이 쓰는 명령(웹과 호스트가 같다) · 금지 명령 없음 · 열람 창 목록은 그대로', () => S.whitelist(CS, app));
test('(S) 거름과 회신: 종류 목록 밖은 거절 · 메인 창의 aw: 번호는 버림 · adminOpen 은 메인 창에서만 · aw: 회신은 보낸 창으로만', () => S.filter(CS));
test('(S) 관리 창 열기: 세션의 사람이 관리자일 때만(DB 확인) · 열려 있으면 앞으로 가져오기만 · 권한은 웹으로 내려보내지 않는다', () => S.openGate(CS));
test('(S) 목록 갱신 알림은 메인 창과 관리 창 둘 다로 · 관문 상태도 · 새 과제는 메인 창에 자동 편입 대상을 먼저 알린다', () => S.pushes(CS, GH));
test('(S) 파일 대화상자: 관리 창이 연 엑셀 저장의 주인은 관리 창', () => S.dialogOwner(CS));
test('(S) 새 과제 자동 편입은 편집 폼의 새 과제 저장에서만(autoSub) · 폼이 아닌 saveProject(루프의 직접 전송)는 편입하지 않는다', () => {
  const a = app.indexOf('function offEdSaveNow(');
  assert.ok(a >= 0, 'offEdSaveNow 를 찾지 못했다');
  assert.match(app.slice(a, app.indexOf('\n}\n', a)), /cmd: 'saveProject',[\s\S]*autoSub: !offEdUid,\s*\};/, '편집 폼의 저장이 새 과제일 때 편입 표시(autoSub)를 싣지 않는다');
  assert.throws(() => S.pushes(mutate(CS, 'if (ok && autoSub && string.IsNullOrEmpty(uid))', 'if (ok && string.IsNullOrEmpty(uid))'), GH), /폼이 아닌 저장도 편입한다/);
});
test('(S) 닫기 전 확인: 창 테두리의 ✕ 는 웹에 묻는다(답이 없으면 3초 뒤 닫는다) · 웹이 확인한 window.close 는 바로 닫는다', () => S.closeAsk(AW));
test('(M) 호스트: 관리 창 목록에 쓰기 명령을 넣거나, 목록 알림을 메인 창 하나로 되돌리거나, 닫기 전 확인을 빼면 잡는다', () => {
  assert.throws(() => S.whitelist(mutate(CS, '"trashGet", "trashRestore", "trashDelete",', '"trashGet", "trashRestore", "trashDelete", "saveState",'), app), /관리 화면이 쓰는 명령과 다르다/);
  assert.throws(() => S.pushes(mutate(CS, 'CatalogPush("window.__applyProjects && window.__applyProjects(', 'JsCall("window.__applyProjects && window.__applyProjects('), GH), /__applyProjects/);
  assert.throws(() => S.closeAsk(mutate(AW, 'if (Kind.AskBeforeClose && !_closeOk && _ready && Core != null)', 'if (false)')), /닫기 전에 웹에 묻지 않는다/);
  assert.throws(() => S.openGate(mutate(CS, '                ReplyOnUi(reqId, new { ok = false, admin = false, msg = "관리자만 사용할 수 있습니다" });\n                return;\n', '')), /관리자가 아니어도 연다/);
});

// ══ (P) AdminFromUserInfo — C# 그대로 ═══════════════════════════════════
const dotnetOk = (() => { const r = spawnSync('dotnet', ['--version'], { windowsHide: true, timeout: 120000 }); return !r.error && r.status === 0; })();
const ADM_SIG = 'internal static bool? AdminFromUserInfo(string? json)';
const ADM_MUT = { noActive: ['return role == "admin" && active;', 'return role == "admin";'] };
let ADM_EXE = null;
function admProbe() {
  if (ADM_EXE) return ADM_EXE;
  const body = member(CS, ADM_SIG);
  const fns = [body.replace('AdminFromUserInfo(', 'Adm_real(')];
  for (const [k, [a, b]] of Object.entries(ADM_MUT)) {
    assert.equal(body.split(a).length - 1, 1, `AdminFromUserInfo 변이 앵커(${k})가 한 번이 아니다`);
    fns.push(body.replace(a, b).replace('AdminFromUserInfo(', `Adm_${k}(`));
  }
  const dir = join(tmpdir(), `tc-admin-win-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch (_) { } });
  writeFileSync(join(dir, 'Program.cs'), `using System; using System.Collections.Generic; using System.Text.Json;
static class P {
  ${fns.join('\n  ')}
  static int Main(string[] a) {
    var cases = JsonDocument.Parse(System.IO.File.ReadAllText(a[0])).RootElement;
    var outv = new List<string>();
    foreach (var c in cases.EnumerateArray()) {
      string? j = c.GetProperty("json").ValueKind == JsonValueKind.Null ? null : c.GetProperty("json").GetString();
      bool? r = c.GetProperty("fn").GetString() == "noActive" ? Adm_noActive(j) : Adm_real(j);
      outv.Add(r == null ? "null" : (r.Value ? "true" : "false"));
    }
    System.IO.File.WriteAllText(a[1], JsonSerializer.Serialize(outv));
    return 0;
  }
}
`, 'utf8');
  writeFileSync(join(dir, 'nuget.config'), '<?xml version="1.0" encoding="utf-8"?>\n<configuration><packageSources><clear /></packageSources></configuration>\n', 'utf8');
  writeFileSync(join(dir, 'probe.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable><LangVersion>latest</LangVersion><ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>tc-admin-win</AssemblyName><SatelliteResourceLanguages>en</SatelliteResourceLanguages>
    <TargetLatestRuntimePatch>false</TargetLatestRuntimePatch>
  </PropertyGroup>
</Project>
`, 'utf8');
  const b = spawnSync('dotnet', ['build', join(dir, 'probe.csproj'), '-c', 'Release', '-v', 'q', '--nologo'],
    { cwd: dir, windowsHide: true, timeout: 420000, maxBuffer: 64 * 1024 * 1024 });
  const exe = join(dir, 'bin', 'Release', 'net9.0', 'tc-admin-win.exe');
  if (b.error || b.status !== 0 || !existsSync(exe)) {
    const out = (b.stdout || '').toString('utf8') + (b.stderr || '').toString('utf8');
    throw new Error('AdminFromUserInfo 프로브 빌드 실패:\n' + (out.split('\n').filter((l) => /error|오류/i.test(l)).slice(0, 12).join('\n') || out.slice(-1500)));
  }
  ADM_EXE = { exe, dir };
  return ADM_EXE;
}
function adm(cases) {
  const { exe, dir } = admProbe();
  const inF = join(dir, 'in.json'), outF = join(dir, 'out.json');
  writeFileSync(inF, JSON.stringify(cases), 'utf8');
  const r = spawnSync(exe, [inF, outF], { windowsHide: true, timeout: 120000 });
  if (r.error || r.status !== 0) throw new Error('AdminFromUserInfo 프로브 실행 실패: ' + (r.error ? r.error.message : (r.stderr || '').toString('utf8')));
  return JSON.parse(readFileSync(outF, 'utf8'));
}
const INFO = (o) => JSON.stringify(Object.assign({ found: true, name: '박현민', edit_role: 'admin', is_active: 1 }, o));
const ADM_CASES = [
  ['관리자(재직)', INFO({}), 'true'],
  ['편집자', INFO({ edit_role: 'editor' }), 'false'],
  ['보기만', INFO({ edit_role: 'viewer' }), 'false'],
  ['권한 비어 있음', INFO({ edit_role: null }), 'false'],
  ['관리자지만 비활성', INFO({ is_active: 0 }), 'false'],
  ['관리자, 재직 여부 비어 있음(웹의 ahProbe 와 같이 재직으로 본다)', INFO({ is_active: null }), 'true'],
  ['관리자, 앞뒤 공백', INFO({ edit_role: ' admin ' }), 'true'],
  ['미등록', JSON.stringify({ found: false }), 'false'],
  ['읽기 실패(null)', null, 'null'],
  ['깨진 JSON', '{x', 'null'],
];
if (!dotnetOk) {
  skip('관리 창 열기 판정(AdminFromUserInfo C# 프로브) 시험 전부', 'dotnet 없음', 'C# 을 그대로 컴파일해 판정하는 시험이라 JS 사본으로 대신하지 않는다');
} else {
  test('(P) AdminFromUserInfo(C#): 관리자이고 재직일 때만 연다 · 편집자, 보기만, 비활성, 미등록은 열지 않는다 · 읽지 못하면 null', () => {
    const got = adm(ADM_CASES.map(([, json]) => ({ fn: 'real', json })));
    ADM_CASES.forEach(([name, , want], i) => assert.strictEqual(got[i], want, name));
  });
  test('(M) AdminFromUserInfo(C#): 재직 여부 갈래를 빼면 비활성 관리자에게 열린다', () => {
    const [got] = adm([{ fn: 'noActive', json: INFO({ is_active: 0 }) }]);
    assert.strictEqual(got, 'true', '변이가 비활성 관리자를 막는다(변이가 닿지 않았다)');
  });
}

// ══ (R) jsdom ══════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
if (!JSDOM) {
  skip('admin-window: jsdom 미설치 — ?win=admin 모드와 입구, 닫기 확인 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const ME = { loginId: 'phmin', name: '박현민', title: '수석연구원', orgUnit: 'SW 3팀' };
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const FADE = 200;
  const MAIN_URL = 'https://tcapp.local/', ADMIN_URL = 'https://tcapp.local/?win=admin';
  const ROSTER = { found: true, admin: true, includeInactive: false, units: [], titles: [],
    members: [{ userId: 11, loginId: 'zzA', name: 'zzA_가', title: '선임', orgUnit: 'SW 1팀', isActive: true }] };
  const INFO_R = (role) => ({ ok: true, info: { name: ME.name, edit_role: role, is_active: 1 } });
  //  stub: hostRequest 를 바꿔 회신을 정한다(호출은 __calls 에 남긴다). 아니면 실제 hostRequest 가 chrome.webview 로 보낸다(posted).
  function boot(src, url, { stub = false } = {}) {
    const posted = [], errors = [];
    const vc = new jsdomMod.VirtualConsole();
    vc.on('jsdomError', (e) => errors.push(String(e && (e.stack || e.message) || e)));
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc,
      beforeParse(win) {
        win.chrome = { webview: { postMessage: (s) => posted.push(String(s)), addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.__realClose = win.close; win.__closeCalls = 0;
        win.close = function () { win.__closeCalls++; };   // 관리 창의 window.close() = 호스트가 창을 닫는 길(AppWindow.WindowCloseRequested)
      },
    });
    const w = dom.window;
    const X = { w, posted, errors, doc: w.document, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      close: () => { try { w.__realClose.call(w); } catch (_) {} },
      msgs: () => posted.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(Boolean) };
    if (stub) {
      w.eval(`window.__calls = []; window.__rep = { userInfoGet: ${JSON.stringify(INFO_R('admin'))}, membersGet: ${JSON.stringify({ ok: true, data: ROSTER })} };
        hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
          var r = __rep[cmd];
          if(r === undefined) return Promise.resolve({ ok:false, msg:'시험: 회신 없음' });
          return Promise.resolve(JSON.parse(JSON.stringify(r))); };`);
    }
    return X;
  }
  const $ = (X, s) => X.doc.querySelector(s);
  const isOpen = (X, id) => X.ev(`isOverlayOpen(document.getElementById(${JSON.stringify(id)}))`);
  const navOn = (X) => X.ev("(function(){ var b = document.querySelector('#ahNav [data-ahitem].on'); return b ? b.dataset.ahitem : ''; })()");
  const docked = (X) => X.ev("(function(){ var d = document.querySelector('#ahSlot > .overlay.docked'); return d ? d.id : ''; })()");
  const shownChildren = (X) => [...X.doc.body.children].filter((e) => e.tagName !== 'SCRIPT' && !e.classList.contains('hidden') && X.w.getComputedStyle(e).display !== 'none').map((e) => e.id || e.className);   // jsdom 은 !important 를 계산하지 않아 .hidden 을 따로 본다
  async function openAdmin(X, item = 'members') {
    X.ev(`__adminWinOpen(${JSON.stringify({ item, me: ME })})`);
    await settle(80);
  }

  //  ── ?win=admin 부팅 ──
  function checkBoot(src) {
    const A = boot(src, ADMIN_URL);
    try {
      assert.strictEqual(A.ev('ADMINWIN'), true);
      assert.strictEqual(A.ev('SUBWIN'), true);
      assert.strictEqual(A.doc.documentElement.dataset.adminwin, '1', 'html[data-adminwin] 스위치가 서지 않는다');
      assert.strictEqual(A.doc.title, '수행과제 캘린더 관리');
      assert.deepStrictEqual(A.msgs().map((m) => m.cmd), ['adminWinReady', 'loadProjects', 'loadCodes', 'loadCustomers'],
        '관리 창이 부팅에서 준비 알림과 목록 읽기 말고 다른 것을 보냈다(내 달력을 부팅했다)');
      assert.ok(!A.doc.querySelector('#hostbar .hb-cap'), '관리 창에 메인 창의 제목줄 단추(호스트바)가 그려졌다');
      const gate = A.doc.getElementById('loginGate');
      assert.ok(!gate || gate.classList.contains('hidden'), '관리 창에 로그인 화면이 떴다');
      assert.strictEqual(isOpen(A, 'adminHub'), false, '대상을 받기 전에 허브가 열렸다');
      assert.deepStrictEqual(shownChildren(A).filter((x) => x !== 'toastWrap'), [], '관리 창에 메인 화면이 보인다: ' + shownChildren(A).join(','));
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  }
  test('(R) ?win=admin: 내 달력을 부팅하지 않는다(준비 알림과 목록 읽기 셋만) · 메인 화면, 호스트바, 로그인 화면이 없다', () => checkBoot(app));

  function sealedOut(src) {
    const A = boot(src, ADMIN_URL);
    try {
      A.posted.length = 0;
      A.ev("hpost({cmd:'saveState', state:{}}); hpost({cmd:'ready'}); hpost({cmd:'reminderSync', occ:[]}); hpost({cmd:'adminOpen'}); hpost({cmd:'peerOpen', loginId:'x'}); hpost({cmd:'winMinimize'}); hpost({cmd:'reloadState'})");
      return A.msgs().map((m) => m.cmd);
    } finally { A.close(); }
  }
  test('(R) 관리 창의 봉인: 목록 밖 명령(저장, 부팅, 알림 동기화, 창 조작)은 나가지 않는다 · 번호는 aw:<창 소금>: · 메인 창 번호에는 머리가 없다', async () => {
    assert.deepStrictEqual(sealedOut(app), [], '관리 창에서 목록 밖 명령이 나갔다');
    const ids = [];
    for (let k = 0; k < 2; k++) {
      const A = boot(app, ADMIN_URL);
      try { A.posted.length = 0; A.ev("hostRequest('trashGet', {}, 50)"); ids.push(A.msgs().pop().reqId); } finally { A.close(); }
    }
    assert.ok(ids.every((id) => /^aw:[0-9a-z]{6,}:trashGet-1$/.test(id)), '관리 창 번호 모양이 다르다: ' + ids.join(' / '));
    assert.notStrictEqual(ids[0], ids[1], '두 관리 창의 첫 번호가 같다(창 소금이 없다)');
    const M = boot(app, MAIN_URL);
    try { M.posted.length = 0; M.ev("hostRequest('trashGet', {}, 50)"); assert.ok(/^trashGet-\d+$/.test(M.msgs().pop().reqId), '메인 창 번호에 머리가 붙었다'); } finally { M.close(); }
    await settle(80);
  });

  function checkOpenFill(src) {
    return (async () => {
      const A = boot(src, ADMIN_URL, { stub: true });
      const M = boot(src, MAIN_URL);
      try {
        await openAdmin(A, 'members');
        assert.strictEqual(A.ev('currentUser && currentUser.loginId'), 'phmin', '호스트가 준 내 신원을 쓰지 않는다');
        assert.strictEqual(isOpen(A, 'adminHub'), true, '__adminWinOpen 이 허브를 열지 않았다');
        assert.ok(A.evJSON('__calls').some((c) => c[0] === 'userInfoGet'), '틀을 열기 전에 관리자 확인(userInfoGet)을 하지 않았다');
        assert.strictEqual(navOn(A), 'members'); assert.strictEqual(docked(A), 'userAdminModal');
        //  허브가 창을 채운다(고정 폭, 높이 없음 · 둥근 모서리, 그림자 없음 · 허브 머리의 ✕ 없음)
        const m = $(A, '#adminHub > .ah-modal'), cs = A.w.getComputedStyle(m);
        assert.deepStrictEqual([cs.width, cs.height, cs.maxWidth, cs.maxHeight, cs.borderRadius, cs.boxShadow], ['100%', '100%', 'none', 'none', '0', 'none'], '관리 창에서 허브가 창을 채우지 않는다');
        assert.strictEqual(A.w.getComputedStyle($(A, '#adminHub')).paddingTop, '0px', '허브 바깥 여백이 남았다');
        assert.strictEqual(A.w.getComputedStyle($(A, '#adminHub > .ah-modal > .modal-head > .x')).display, 'none', '관리 창의 허브 머리에 ✕ 가 보인다(창 테두리의 닫기가 그 일을 한다)');
        //  보이는 것은 허브와 그 위 창, 토스트, 관문 카드뿐(allowlist)
        A.ev("openModal('#userEditModal'); confirmBox('확인', '본문', '확인', '취소')"); await settle(40);
        const shown = shownChildren(A);
        assert.deepStrictEqual(shown.filter((x) => !['adminHub', 'userEditModal', 'confirmModal', 'toastWrap'].includes(x)), [], '관리 창에 허브 밖 화면이 보인다: ' + shown.join(','));
        //  allowlist 의 원문: 허브, 허브에 붙는 화면 일곱, 편집 폼 둘, 확인 창 둘, 토스트, 관문 카드(그 밖의 body 직계는 감춘다)
        const allow = /html\[data-adminwin\] body > ((?::not\(#\w+\))+)\{ display:none !important \}/.exec(src);
        assert.ok(allow, '관리 창 allowlist 규칙을 찾지 못했다');
        assert.deepStrictEqual([...allow[1].matchAll(/#(\w+)/g)].map((m) => m[1]).sort(), ['adminHub', 'codeModal', 'confirmModal', 'confirmTypedModal', 'customerModal', 'officialEditModal', 'officialModal',
          'orgTitleModal', 'roomAdminModal', 'toastWrap', 'trashModal', 'userAdminModal', 'userEditModal', 'vgGate'], '관리 창 allowlist 가 허브, 붙는 화면, 편집 폼, 확인 창, 토스트, 관문 카드가 아니다');
        assert.ok(shown.includes('userEditModal') && shown.includes('confirmModal'), '허브 위의 편집 폼, 확인 창이 관리 창에서 보이지 않는다');
        A.ev("document.getElementById('cfOk').click()"); await settle(FADE);
        //  메인 창에는 이 규칙이 서지 않는다
        assert.notStrictEqual(M.w.getComputedStyle($(M, '#adminHub > .ah-modal')).width, '100%', '메인 창에서도 허브가 창 전체 규칙을 탄다');
        //  이미 열린 관리 창: 호스트가 다른 항목을 넘기면 그 항목으로만 옮긴다(항목이 없으면 그대로)
        await openAdmin(A, 'trash'); assert.strictEqual(navOn(A), 'trash');
        await openAdmin(A, ''); assert.strictEqual(navOn(A), 'trash', '항목 없이 앞으로 가져왔는데 항목이 바뀌었다');
        assert.deepStrictEqual(A.errors, []); assert.deepStrictEqual(M.errors, []);
      } finally { A.close(); M.close(); }
    })();
  }
  test('(R) 관리 창: __adminWinOpen 이 허브를 그 항목으로 연다 · 허브가 창을 채운다 · 허브와 그 위 창만 보인다 · 다시 받으면 항목만 옮긴다', () => checkOpenFill(app));

  function checkMainEntry(src) {
    return (async () => {
      const M = boot(src, MAIN_URL);
      try {
        M.ev('currentUser = ' + JSON.stringify(ME) + '; ahNoteRole(true)');
        M.posted.length = 0;
        M.ev("openAdminHub('projects')"); await settle(40);
        M.ev('ahOpenFromMore()'); await settle(40);
        const sent = M.msgs().filter((m) => m.cmd === 'adminOpen');
        assert.deepStrictEqual(sent.map((m) => m.item), ['projects', ''], '메인 창의 입구가 호스트에 관리 창 열기(adminOpen) 하나만 보내지 않는다');
        assert.ok(sent.every((m) => /^adminOpen-\d+$/.test(m.reqId)), '메인 창의 요청 번호가 아니다');
        assert.strictEqual(isOpen(M, 'adminHub'), false, '메인 창 안에 관리 화면이 열렸다');
        assert.strictEqual(M.doc.querySelectorAll('#ahSlot .overlay').length, 0, '메인 창의 허브에 화면이 도킹됐다');
        assert.deepStrictEqual(M.msgs().filter((m) => m.cmd !== 'adminOpen').map((m) => m.cmd), [], '메인 창이 관리 화면의 조회를 직접 보냈다');
        //  거절 회신: 토스트 + 입구를 숨긴다
        M.ev(`__hostReply(${JSON.stringify(sent[0].reqId)}, { ok:false, admin:false, msg:'관리자만 사용할 수 있습니다' })`); await settle(40);
        assert.ok(/관리자만 사용할 수 있습니다/.test($(M, '#toastWrap').textContent), '거절이 토스트로 뜨지 않았다');
        assert.ok($(M, '#mmAdmin').classList.contains('hidden'), '거절 뒤에도 ⋯ 메뉴에 ⚙ 관리가 남았다');
        //  읽기 전용 찾아보기(전원)는 메인 창 모달 그대로
        M.ev('openOfficialModal()'); await settle(40);
        assert.ok(isOpen(M, 'officialModal') && !$(M, '#officialModal').classList.contains('docked'), '공식 과제 찾아보기가 메인 창 모달로 뜨지 않는다');
      } finally { M.close(); }
    })();
  }
  test('(R) 메인 창: ⋯ 의 ⚙ 관리와 내 과제 링크는 adminOpen 만 보낸다(허브를 열지 않는다) · 거절이면 토스트와 입구 숨김 · 찾아보기는 메인 창 그대로', () => checkMainEntry(app));

  test('(R) 관리자가 아니면(확인 회신 viewer) 관리 창의 틀이 열리지 않고 토스트 뒤 창을 닫는다 · 권한이 내려가면 열린 틀도 내린다', async () => {
    const A = boot(app, ADMIN_URL, { stub: true });
    try {
      A.ev(`__rep.userInfoGet = ${JSON.stringify(INFO_R('viewer'))}`);
      await openAdmin(A, 'members');
      assert.strictEqual(isOpen(A, 'adminHub'), false, '관리자가 아닌데 틀이 열렸다');
      assert.strictEqual(A.evJSON('__calls').filter((c) => c[0] === 'membersGet').length, 0, '열지 않았는데 구성원 조회가 나갔다');
      assert.ok(/관리자만 사용할 수 있습니다/.test($(A, '#toastWrap').textContent));
      await settle(1900);
      assert.strictEqual(A.ev('window.__closeCalls'), 1, '빈 관리 창을 닫지 않았다');
    } finally { A.close(); }
  });

  //  ── 닫기 전 확인(§2.2) ──
  async function closeAsk(src) {
    const A = boot(src, ADMIN_URL, { stub: true });
    try {
      await openAdmin(A, 'members');
      assert.strictEqual(A.ev('__winCloseRequest()'), 'close', '저장 안 한 입력이 없는데 닫기를 막았다');
      //  직원 등록 폼(저장 안 한 입력 확인이 있는 폼)을 열고 고친다
      A.ev("openModal('#userEditModal'); document.getElementById('userEditModal').__openSnap = formSnapshot(document.getElementById('userEditModal'))"); await settle(40);
      assert.strictEqual(A.ev('__winCloseRequest()'), 'close', '폼을 열기만 했는데 닫기를 막았다');
      A.ev("document.getElementById('userEdName').value = 'zz새이름'");
      assert.strictEqual(A.ev('__winCloseRequest()'), 'ask', '저장 안 한 입력이 있는데 묻지 않았다');
      await settle(40);
      assert.strictEqual(isOpen(A, 'confirmModal'), true, '확인 창이 뜨지 않았다');
      assert.match($(A, '#cfMsg').textContent, /저장하지 않고 닫을까요/, '같은 확인 문구가 아니다');
      assert.strictEqual(A.ev('__winCloseRequest()'), 'ask', '묻는 중에 다시 누르면 기다려야 한다');
      A.ev("document.getElementById('cfAlt').click()"); await settle(FADE);
      assert.strictEqual(A.ev('window.__closeCalls'), 0, '[계속 편집]인데 창을 닫았다');
      //  허브 닫기(closeOverlay) 길도 같은 확인을 지난다
      A.ev("closeOverlay(document.getElementById('adminHub'))"); await settle(40);
      assert.strictEqual(isOpen(A, 'confirmModal'), true, '허브 닫기 길이 같은 확인을 지나지 않는다');
      A.ev("document.getElementById('cfOk').click()"); await settle(FADE);
      assert.strictEqual(A.ev('window.__closeCalls'), 1, '[닫기]를 눌렀는데 창을 닫지 않았다');
      //  저장 중(busy)이면 닫지 않는다
      A.ev("document.getElementById('userAdminModal').dataset.busy = '1'");
      assert.strictEqual(A.ev('__winCloseRequest()'), 'busy', '저장 중인데 닫기를 막지 않았다');
      A.ev("delete document.getElementById('userAdminModal').dataset.busy");
      //  Esc 는 창을 닫지 않는다(허브, 도킹 창이 맨 위)
      A.ev("closeModal('#userEditModal')"); await settle(FADE);
      const c0 = A.ev('window.__closeCalls');
      A.doc.body.dispatchEvent(new A.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle(FADE);
      assert.strictEqual(A.ev('window.__closeCalls'), c0, 'Esc 가 관리 창을 닫으려 했다');
      assert.strictEqual(isOpen(A, 'adminHub'), true, 'Esc 가 허브를 내렸다');
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  }
  test('(R) 닫기 전 확인: 저장 안 한 입력이 있으면 같은 확인(ask) · [계속 편집]은 남고 [닫기]는 닫는다 · 허브 닫기도 같은 길 · 저장 중이면 busy · Esc 로 닫지 않는다', () => closeAsk(app));

  test('(R) 목록 알림: 관리 창에도 반영된다(공식 과제 개수) · 메인 창은 새 과제 자동 편입 대상을 받는다(관리 창은 받지 않는다)', async () => {
    const A = boot(app, ADMIN_URL, { stub: true }), M = boot(app, MAIN_URL);
    try {
      await openAdmin(A, 'projects');
      A.w.__applyProjects(JSON.stringify([{ uid: 'U1', project_name: 'zz과제', customer: 'zzC', customerId: 7, sectionId: 1 }]));
      await settle(80);
      assert.strictEqual(A.ev('dbOnline'), true);
      assert.strictEqual($(A, '#ahNprojects').textContent, '1건', '관리 창의 공식 과제 개수가 목록 알림을 따르지 않는다');
      M.ev(`__autoSubNext({ customerId: 7, projectName: ' zz과제 ' })`);
      assert.deepStrictEqual(M.evJSON('__pendingAutoSub'), { customerId: 7, projectName: 'zz과제' }, '메인 창이 자동 편입 대상을 받지 않았다');
      A.ev(`__autoSubNext({ customerId: 7, projectName: 'zz과제' })`);
      assert.strictEqual(A.ev('__pendingAutoSub'), null, '관리 창이 자동 편입 대상을 받았다(편입은 메인 창의 캘린더다)');
    } finally { A.close(); M.close(); }
  });

  test('(R) 버전 관문: 관리 창은 작은 카드("메인 창에서 업데이트해 주세요", [이 창 닫기] 하나) · 허브가 열려 있어도 카드는 잠기지 않는다', async () => {
    const A = boot(app, ADMIN_URL, { stub: true });
    try {
      await openAdmin(A, 'members');
      A.ev("__versionGate({ state:'needUpdate', appVersion:'0.30.0', appStructure:'15', dbStructure:'16', latestVersion:'0.31.0', installerPath:'' })"); await settle(40);
      const c = $(A, '#vgGate .vg-card');
      assert.ok(c && c.classList.contains('vg-peer'), '관리 창용 작은 카드가 아니다');
      assert.match($(A, '#vgBody').textContent, /관리 화면을 쓸 수 없습니다\. 메인 창에서 업데이트해 주세요\./);
      assert.deepStrictEqual([...A.doc.querySelectorAll('#vgGate button')].map((b) => b.textContent.trim()), ['이 창 닫기'], '관리 창 카드에 다른 버튼이 있다');
      assert.strictEqual($(A, '#vgGate').hasAttribute('inert'), false, '허브가 열린 관리 창에서 카드가 잠겼다(inert)');
      assert.ok($(A, '#adminHub').hasAttribute('inert'), '카드 뒤 허브가 잠기지 않았다');
      A.ev("document.getElementById('vgPrimary').click()");
      assert.strictEqual(A.ev('window.__closeCalls'), 1, '[이 창 닫기]가 창을 닫지 않는다');
    } finally { A.close(); }
  });

  // ── (M) 웹 변이 ──
  test('(M) 웹: 관리 창 봉인을 빼면, 메인 창의 허브 우회를 빼면, 저장 안 한 입력 판정을 빼면 각각 잡는다', async () => {
    const noSeal = mutate(app, "  if(ADMINWIN && !ADMINWIN_CMD.has(String((o && o.cmd) || ''))) return;\n", '');
    assert.ok(sealedOut(noSeal).includes('saveState'), '봉인을 뺐는데 저장이 나가지 않았다(변이가 닿지 않았다)');
    assert.throws(() => checkBoot(noSeal), /다른 것을 보냈다/);
    const inMain = mutate(app, '  if(!ADMINWIN){ adminWinOpen(item); return; }\n', '');
    await assert.rejects(() => checkMainEntry(inMain), /adminOpen\) 하나만 보내지 않는다|메인 창 안에 관리 화면이 열렸다/);
    const noDirty = mutate(app, "  if(!ov) return 'close';\n  __awAsking = true;", "  return 'close';\n  __awAsking = true;");
    await assert.rejects(() => closeAsk(noDirty), /묻지 않았다/);
    await settle(80);
  });
}
