// 다른 사람 일정 보기 독립 창(docs/WINDOW-UI.md §4) — 호스트 PeerWindow 와 웹의 ?peerwin=1 모드.
//
// 이 파일이 지키는 것:
//   (S) 호스트: 열람 창의 웹 메시지는 메인 창과 같은 처리기(OnWebMessage)로 오고, 읽기 넷(PeerWinCommands)만 받는다.
//       요청 번호는 'pw:' 로 시작해야 하고 회신은 그 표시로 열람 창에 돌아간다(ReplyCore). 보는 사람은 세션에서 읽는다.
//       창은 하나(_peerWin)이고 메인 창의 peerOpen 이 열거나 앞으로 가져온다. 앱 종료, 로그아웃, 계정 바뀜이면 닫는다.
//       PeerWindow 는 Owner 없는 일반 창(SingleBorderWindow, 작업 표시줄)이고 메인 창과 같은 WebView2 환경과 가상 호스트를 쓴다.
//       닫을 때 자리(평소 창 + 최대화 여부)를 _settings.Peer 에 남기고, 열 때 FitPeerRect 로 지금 화면에 맞춘다.
//   (P) FitPeerRect 를 C# 그대로 컴파일해 돌린다(기본 크기, 화면 밖이면 주 모니터 가운데, 가상 화면 안으로 당기기).
//   (R) jsdom: ?peerwin=1 은 열람 껍데기만 펴고 읽기 넷만 보낸다. 메인 창의 입구는 peerOpen 하나만 보낸다.
//       내 겹은 메인 창의 __peerMineSnapshot 에서 오고, 열람 창은 겹을 다시 켜거나 창이 앞으로 오면 새로 받아 __peerSetMine 으로 갈아 끼운다.
//       두 창이 함께 쓰는 localStorage 의 storage 이벤트로 ☆/★ 와 테마가 따라간다.
//   (M) 변이: 호스트 목록에 쓰기 명령 넣기, 열람 창 거름 빼기, 회신 길 하나로 만들기, 웹 봉인 빼기, 'pw:' 빼기,
//       메인 창이 직접 조회하기, C# FitPeerRect 의 세 갈래를 각각 빼기를 잡는다.
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다. dotnet 이 없으면 (P)가 그렇다.
import { test, skip, assert, loadAppSource, extractFunction, extractCsMember, stripCsComments,
         importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const app = loadAppSource();
const CS = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8').replace(/\r/g, '');
const PW = readFileSync(new URL('../widget/PeerWindow.cs', import.meta.url), 'utf8').replace(/\r/g, '');

function mutate(text, find, repl) {
  const n = text.split(find).length - 1;
  assert.equal(n, 1, `변이 앵커가 ${n}번 나온다: ${find.slice(0, 80)}`);
  return text.replace(find, repl);
}
const member = (src, sig) => extractCsMember(src, sig);

// ══ (S) 호스트 ════════════════════════════════════════════════════════
const READ_FOUR = ['membersGet', 'peerMine', 'peerSchedule', 'peerWinReady'];
function peerCommands(cs) {
  const m = /internal static readonly HashSet<string> PeerWinCommands = new\(StringComparer\.Ordinal\)\s*\{([^}]*)\}/.exec(stripCsComments(cs));
  assert.ok(m, 'PeerWinCommands 목록을 찾지 못했다');
  return [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort();
}
function checkWhitelist(cs) {
  assert.deepStrictEqual(peerCommands(cs), READ_FOUR, '열람 창이 보낼 수 있는 명령이 읽기 넷이 아니다');
  const d = member(cs, 'private void OnWebMessage(CoreWebView2WebMessageReceivedEventArgs e, CoreWebView2? origin)');
  assert.match(d, /bool fromPeer = origin != null && _peerWin != null && ReferenceEquals\(origin, _peerWin\.Core\);/, '보낸 창을 CoreWebView2 로 가르지 않는다');
  assert.match(d, /if \(!fromPeer && \(origin == null \|\| !ReferenceEquals\(origin, web\.CoreWebView2\)\)\) return;/, '모르는 창의 메시지를 버리지 않는다');
  assert.match(d, /if \(fromPeer\)\s*\{\s*if \(!PeerWinCommands\.Contains\(cmd\) \|\| \(rq\.Length > 0 && !peerReq\)\)\s*\{\s*Log\("열람 창 명령 거부: " \+ cmd\);\s*if \(peerReq\) GitReply\(rq, new \{ ok = false, error = "열람 창에서는 할 수 없는 요청입니다" \}\);\s*return;\s*\}\s*\}\s*else if \(peerReq\) return;/,
    '열람 창의 명령을 읽기 넷과 pw: 번호로 거르지 않는다(또는 거절을 말하지 않는다)');
  assert.ok(d.indexOf('if (fromPeer)') < d.indexOf('switch (cmd)'), '거름이 명령 분기보다 뒤에 있다');
  assert.match(d, /fromPeer && !\(e\.Source \?\? ""\)\.StartsWith\("https:\/\/tcapp\.local\/"/, '열람 창 메시지의 출처(tcapp.local)를 보지 않는다');
  assert.match(cs, /private void OnMainWebMessage\(object\? sender, CoreWebView2WebMessageReceivedEventArgs e\) => OnWebMessage\(e, web\.CoreWebView2\);/, '메인 창이 같은 처리기로 오지 않는다');
  assert.match(cs, /internal void OnPeerWebMessage\(CoreWebView2WebMessageReceivedEventArgs e, CoreWebView2 core\) => OnWebMessage\(e, core\);/, '열람 창이 같은 처리기로 오지 않는다');
  assert.match(PW, /core\.WebMessageReceived \+= \(_, e\) => _host\.OnPeerWebMessage\(e, core\);/, 'PeerWindow 가 메시지를 호스트 처리기로 넘기지 않는다');
  //  명부: 열람 창의 사람 고르기는 재직자 명부만(퇴사자 보기, 서열 순은 관리 화면 것)
  assert.match(d, /RunMembersGetAsync\(GetStr\(doc, "reqId"\), !fromPeer && GetBool\(doc, "includeInactive"\), !fromPeer && GetBool\(doc, "flat"\)\)/, '열람 창의 membersGet 이 퇴사자 보기나 서열 순을 켤 수 있다');
  assert.match(d, /case "peerWinReady":\s*if \(fromPeer\) _peerWin\?\.OnWebReady\(\);/, 'peerWinReady 를 열람 창에서 온 것만 받지 않는다');
}
function checkReplyRouting(cs) {
  assert.match(cs, /internal const string PeerReqPrefix = "pw:";/);
  assert.match(cs, /private CoreWebView2\? ReplyCore\(string reqId\) =>\s*reqId\.StartsWith\(PeerReqPrefix, StringComparison\.Ordinal\) \? _peerWin\?\.Core : web\.CoreWebView2;/,
    '회신이 pw: 번호로 열람 창에 가지 않는다');
  assert.match(member(cs, 'private void GitReply(string reqId, object payload)'), /_ = ReplyCore\(reqId\)\?\.ExecuteScriptAsync\(call\);/, 'GitReply 가 물은 창으로 회신하지 않는다');
  const ps = member(cs, 'private async Task RunPeerScheduleAsync(string reqId, string targetLoginId)');
  assert.match(ps, /string\? me = CurrentLoginId\(\);/, '보는 사람을 세션에서 읽지 않는다');
  assert.match(ps, /LoadPeerScheduleJsonAsync\(me, targetLoginId\)/);
  assert.match(ps, /_ = ReplyCore\(reqId\)\?\.ExecuteScriptAsync\(/, '남의 일정 회신이 물은 창으로 가지 않는다');
  assert.ok(!/web\.CoreWebView2\.ExecuteScriptAsync/.test(ps), '남의 일정 회신이 메인 창으로 바로 간다');
  const pm = member(cs, 'private async Task RunPeerMineAsync(string reqId)');
  assert.match(pm, /web\.CoreWebView2\.ExecuteScriptAsync\(\s*"\(function\(\)\{try\{return window\.__peerMineSnapshot\?window\.__peerMineSnapshot\(\):\[\];\}catch\(e\)\{return \[\];\}\}\)\(\)"\)/, '내 겹을 메인 창 웹에서 묻지 않는다');
  assert.match(pm, /if \(d\.RootElement\.ValueKind == JsonValueKind\.Array\) arr = d\.RootElement\.GetRawText\(\);/, '메인 창의 답이 배열인지 확인하지 않는다');
  assert.match(pm, /ReplyCore\(reqId\)\?\.ExecuteScriptAsync\("window\.__hostReply\(" \+ JsonSerializer\.Serialize\(reqId\) \+ ", \{ok:true, entries:" \+ arr \+ "\}\)"\)/, '내 겹 회신 모양이 다르다');
  assert.ok(!/CalendarDb|BootFromDb|LoadStateJson/.test(pm), '내 겹을 DB 에서 다시 읽는다(정본은 메인 창 상태다)');
}
function checkOpenAndLifecycle(cs) {
  const d = member(cs, 'private void OnWebMessage(CoreWebView2WebMessageReceivedEventArgs e, CoreWebView2? origin)');
  assert.match(d, /case "peerOpen":[^\n]*\n\s*OpenPeerWindow\(GetStr\(doc, "loginId"\), GetStr\(doc, "name"\)\);/, 'peerOpen 이 열람 창을 열지 않는다');
  const o = member(cs, 'private void OpenPeerWindow(string loginId, string name)');
  assert.match(o, /s = UserSession\.Load\(_dataDir, Log\);/, '열람 창을 열 때 세션을 보지 않는다');
  assert.match(o, /if \(s == null \|\| s\.LoginId\.Length == 0\) \{ Log\("열람 창: 로그인 정보가 없어 열지 않음"\); return; \}/, '로그인 전에도 연다');
  assert.match(o, /me = UserPayload\(s\)/, '내 신원(me)을 세션에서 싣지 않는다');
  assert.match(o, /if \(_peerWin == null\)\s*\{[\s\S]*new PeerWindow\(this, _cwvEnv, _appDir, r, max, _remTheme == "dark"\);[\s\S]*w\.Show\(\);[\s\S]*\}\s*_peerWin\.ShowTarget\(json\);\s*_peerWin\.BringToFront\(\);/,
    '창이 하나가 아니다(있으면 다시 쓰고 앞으로 가져와야 한다)');
  assert.match(o, /w\.Closed \+= \(_, _\) => \{ if \(ReferenceEquals\(_peerWin, w\)\) _peerWin = null; \};/, '닫힌 창을 잊지 않는다');
  const close = member(cs, 'private void Window_Closing(object? sender, System.ComponentModel.CancelEventArgs e)');
  assert.ok(close.indexOf('ClosePeerWindow();') > close.indexOf('ConfirmCloseIfUnsaved') && close.indexOf('ClosePeerWindow();') < close.indexOf('SaveSettings();'),
    '앱을 닫을 때 열람 창을 (저장 전에) 닫지 않는다');
  assert.match(member(cs, 'private void RunUserLogout(string reqId)'), /ClosePeerWindow\(\);/, '로그아웃이 열람 창을 닫지 않는다');
  assert.match(member(cs, 'private async Task RunUserLoginAsync(string reqId, string id, string pw)'), /Dispatcher\.Invoke\(ClosePeerWindow\);/, '계정이 바뀌어도 열람 창이 남는다');
  //  PeerWindow 자체
  const ctor = extractCsMember(PW, 'public PeerWindow(MainWindow host, CoreWebView2Environment env, string appDir, Rect bounds, bool maximized, bool dark)');
  assert.match(ctor, /WindowStyle = WindowStyle\.SingleBorderWindow;/, '일반 Windows 창 테두리가 아니다');
  assert.match(ctor, /ShowInTaskbar = true;/, '작업 표시줄에 따로 뜨지 않는다');
  assert.ok(!/\bOwner\s*=/.test(stripCsComments(PW)), 'Owner 를 둔다(메인 창과 독립이어야 한다)');
  assert.match(ctor, /if \(maximized\) WindowState = WindowState\.Maximized;/, '최대화로 닫았으면 최대화로 열지 않는다');
  assert.match(ctor, /var r = WindowState == WindowState\.Normal \? new Rect\(Left, Top, Width, Height\) : RestoreBounds;\s*_host\.RememberPeerBounds\(r, _shownState == WindowState\.Maximized\);/, '닫을 때 평소 창 자리와 최대화 여부를 남기지 않는다');
  assert.match(ctor, /Closed \+= \(_, _\) => \{ try \{ _web\.Dispose\(\); \} catch \{ \} \};/, '닫힌 창의 WebView2 를 없애지 않는다(남의 데이터를 실은 문서가 남는다)');
  const init = extractCsMember(PW, 'private async Task InitAsync()');
  assert.match(init, /await _web\.EnsureCoreWebView2Async\(_env\);/, '메인 창과 같은 WebView2 환경을 쓰지 않는다(localStorage 가 갈라진다)');
  assert.match(init, /SetVirtualHostNameToFolderMapping\("tcapp\.local", _appDir, CoreWebView2HostResourceAccessKind\.Allow\);/, '같은 가상 호스트를 쓰지 않는다');
  assert.match(init, /core\.Navigate\("https:\/\/tcapp\.local\/index\.html\?peerwin=1"\);/, '열람 모드(?peerwin=1)로 띄우지 않는다');
  assert.match(init, /core\.DocumentTitleChanged \+= /, '창 제목이 보는 사람 이름을 따라가지 않는다');
  assert.match(init, /s\.AreDevToolsEnabled = false;/);
  assert.match(cs, /_appDir = appDir;/, '메인 창의 가상 호스트 폴더를 기억하지 않는다');
  const bf = extractCsMember(PW, 'public void BringToFront()');
  assert.match(bf, /if \(WindowState == WindowState\.Minimized\) WindowState = _shownState == WindowState\.Maximized \? WindowState\.Maximized : WindowState\.Normal;\s*Activate\(\);/, '최소화된 창을 되살려 앞으로 가져오지 않는다');
  //  자리 기억
  assert.match(cs, /public PeerWindowBounds\? Peer \{ get; set; \}/, '설정에 열람 창 자리가 없다');
  const rem = member(cs, 'internal void RememberPeerBounds(Rect r, bool maximized)');
  assert.match(rem, /_settings\.Peer = new PeerWindowBounds \{ Left = r\.Left, Top = r\.Top, Width = r\.Width, Height = r\.Height, Maximized = maximized \};\s*SaveSettings\(\);/);
  const sb = member(cs, 'private (Rect rect, bool maximized) PeerStartBounds()');
  assert.match(sb, /return \(FitPeerRect\(saved, virt, works, home, SystemParameters\.WorkArea\), p != null && p\.Maximized\);/, '열 때 저장 자리를 화면에 맞추지 않는다');
  assert.match(sb, /System\.Windows\.Forms\.Screen\.FromHandle\(hwnd\)\.WorkingArea/, '기본 자리가 메인 창 모니터가 아니다');
}
test('(S) 호스트: 열람 창 메시지는 같은 처리기로 오고 읽기 넷만 받는다(나머지는 거절하고 로그) · 출처 확인 · 명부는 재직자만', () => checkWhitelist(CS));
test('(S) 호스트: 회신은 pw: 번호로 물은 창에 간다 · 보는 사람은 세션 · 내 겹은 메인 창 웹에서 묻는다(DB 아님)', () => checkReplyRouting(CS));
test('(S) 호스트: 창은 하나(다시 쓰고 앞으로) · 종료, 로그아웃, 계정 바뀜이면 닫는다 · Owner 없는 일반 창 · 같은 환경과 가상 호스트 · 자리 기억', () => checkOpenAndLifecycle(CS));
test('(M) 호스트: 쓰기 명령을 목록에 넣거나, 거름을 빼거나, 회신 길을 메인 하나로 만들면 잡는다', () => {
  assert.throws(() => checkWhitelist(mutate(CS, '"peerWinReady", "peerSchedule", "membersGet", "peerMine",', '"peerWinReady", "peerSchedule", "membersGet", "peerMine", "saveState",')), /읽기 넷이 아니다/);
  assert.throws(() => checkWhitelist(mutate(CS, '                    if (!PeerWinCommands.Contains(cmd) || (rq.Length > 0 && !peerReq))', '                    if (false)')), /거르지 않는다/);
  assert.throws(() => checkReplyRouting(mutate(CS, '? _peerWin?.Core : web.CoreWebView2;', '? web.CoreWebView2 : web.CoreWebView2;')), /열람 창에 가지 않는다/);
  assert.throws(() => checkOpenAndLifecycle(mutate(CS, '            ClosePeerWindow();   // 앱을 닫으면', '            //  ClosePeerWindow();   // 앱을 닫으면')), /열람 창을 \(저장 전에\) 닫지 않는다/);
});

// ══ (P) FitPeerRect — C# 그대로 컴파일 ══════════════════════════════════
const dotnetOk = (() => { const r = spawnSync('dotnet', ['--version'], { windowsHide: true, timeout: 120000 }); return !r.error && r.status === 0; })();
const FIT_SIG = 'internal static Rect FitPeerRect(Rect saved, Rect virt, IReadOnlyList<Rect> works, Rect home, Rect primary)';
const FIT_MUT = {
  noMonitorGone: ['if (!onScreen) return Center(primary, sw, sh);', ''],
  noVirtClamp: ['double x = Math.Min(Math.Max(saved.Left, virt.Left), Math.Max(virt.Left, virt.Right - sw));', 'double x = saved.Left;'],
  noDefaultCap: ['Math.Min(1400, home.Width * 0.9)', 'home.Width'],
};
let FIT_EXE = null;
function fitProbe() {
  if (FIT_EXE) return FIT_EXE;
  const body = extractCsMember(CS, FIT_SIG);
  const mins = /internal const double PeerMinWidth = (\d+), PeerMinHeight = (\d+);/.exec(CS);
  assert.ok(mins, 'PeerMinWidth/PeerMinHeight 상수를 찾지 못했다');
  const fns = [body.replace('FitPeerRect(', 'Fit_real(')];
  for (const [k, [a, b]] of Object.entries(FIT_MUT)) {
    assert.equal(body.split(a).length - 1, 1, `FitPeerRect 변이 앵커(${k})가 한 번이 아니다`);
    fns.push(body.replace(a, b).replace('FitPeerRect(', `Fit_${k}(`));
  }
  const dir = join(tmpdir(), `tc-peer-fit-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch (_) { } });
  writeFileSync(join(dir, 'Program.cs'), `using System; using System.Collections.Generic; using System.Linq; using System.Text.Json; using System.Windows;
static class P {
  internal const double PeerMinWidth = ${mins[1]}, PeerMinHeight = ${mins[2]};
  ${fns.join('\n  ')}
  static Rect R(JsonElement e) => e.ValueKind == JsonValueKind.Null ? Rect.Empty : new Rect(e[0].GetDouble(), e[1].GetDouble(), e[2].GetDouble(), e[3].GetDouble());
  [STAThread] static int Main(string[] a) {
    var cases = JsonDocument.Parse(System.IO.File.ReadAllText(a[0])).RootElement;
    var outv = new List<object>();
    foreach (var c in cases.EnumerateArray()) {
      var works = c.GetProperty("works").EnumerateArray().Select(R).ToList();
      Func<Rect, Rect, IReadOnlyList<Rect>, Rect, Rect, Rect> f = c.GetProperty("fn").GetString() switch {
        ${['real', ...Object.keys(FIT_MUT)].map((k) => `"${k}" => Fit_${k},`).join(' ')}
        _ => throw new Exception("fn") };
      var r = f(R(c.GetProperty("saved")), R(c.GetProperty("virt")), works, R(c.GetProperty("home")), R(c.GetProperty("primary")));
      outv.Add(new[] { Math.Round(r.X, 2), Math.Round(r.Y, 2), Math.Round(r.Width, 2), Math.Round(r.Height, 2) });
    }
    System.IO.File.WriteAllText(a[1], JsonSerializer.Serialize(outv));
    return 0;
  }
}
`, 'utf8');
  writeFileSync(join(dir, 'nuget.config'), '<?xml version="1.0" encoding="utf-8"?>\n<configuration><packageSources><clear /></packageSources></configuration>\n', 'utf8');
  writeFileSync(join(dir, 'probe.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net9.0-windows</TargetFramework><UseWPF>true</UseWPF>
    <Nullable>enable</Nullable><LangVersion>latest</LangVersion><ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>tc-peer-fit</AssemblyName><SatelliteResourceLanguages>en</SatelliteResourceLanguages>
    <TargetLatestRuntimePatch>false</TargetLatestRuntimePatch>
  </PropertyGroup>
</Project>
`, 'utf8');
  const b = spawnSync('dotnet', ['build', join(dir, 'probe.csproj'), '-c', 'Release', '-v', 'q', '--nologo'],
    { cwd: dir, windowsHide: true, timeout: 420000, maxBuffer: 64 * 1024 * 1024 });
  const exe = join(dir, 'bin', 'Release', 'net9.0-windows', 'tc-peer-fit.exe');
  if (b.error || b.status !== 0 || !existsSync(exe)) {
    const out = (b.stdout || '').toString('utf8') + (b.stderr || '').toString('utf8');
    throw new Error('FitPeerRect 프로브 빌드 실패:\n' + (out.split('\n').filter((l) => /error|오류/i.test(l)).slice(0, 12).join('\n') || out.slice(-1500)));
  }
  FIT_EXE = { exe, dir };
  return FIT_EXE;
}
let _fitSeq = 0;
function fit(cases) {
  const { exe, dir } = fitProbe();
  const n = ++_fitSeq, inF = join(dir, `in-${n}.json`), outF = join(dir, `out-${n}.json`);
  writeFileSync(inF, JSON.stringify(cases), 'utf8');
  const r = spawnSync(exe, [inF, outF], { windowsHide: true, timeout: 120000 });
  if (r.error || r.status !== 0) throw new Error('FitPeerRect 프로브 실행 실패: ' + (r.error ? r.error.message : (r.stderr || '').toString('utf8')));
  return JSON.parse(readFileSync(outF, 'utf8'));
}
//  모니터 하나(1920x1080, 작업 영역 1920x1040) · 둘(왼쪽에 하나 더) · 작은 모니터
const ONE = { virt: [0, 0, 1920, 1080], works: [[0, 0, 1920, 1040]], home: [0, 0, 1920, 1040], primary: [0, 0, 1920, 1040] };
const TWO = { virt: [-1920, 0, 3840, 1080], works: [[-1920, 0, 1920, 1040], [0, 0, 1920, 1040]], home: [0, 0, 1920, 1040], primary: [0, 0, 1920, 1040] };
const FIT_CASES = [
  ['저장 자리가 화면 안이면 그대로', { ...ONE, saved: [100, 60, 1500, 900] }, [100, 60, 1500, 900]],
  ['처음(저장 없음)은 메인 창 모니터 가운데 1400x900', { ...ONE, saved: null }, [260, 70, 1400, 900]],
  ['너무 작은 저장값은 버리고 기본', { ...ONE, saved: [10, 10, 100, 80] }, [260, 70, 1400, 900]],
  ['작은 모니터면 작업 영역의 90%', { ...ONE, home: [0, 0, 1280, 720], saved: null }, [64, 36, 1152, 648]],
  ['그 모니터가 없어졌으면(제목줄이 어느 작업 영역에도 없다) 주 모니터 가운데', { ...ONE, saved: [5000, 3000, 1200, 800] }, [360, 120, 1200, 800]],
  ['왼쪽 모니터를 뺐을 때도 주 모니터 가운데', { ...ONE, saved: [-1500, 100, 1200, 800] }, [360, 120, 1200, 800]],
  ['왼쪽 모니터가 있으면 그 자리 그대로', { ...TWO, saved: [-1500, 100, 1200, 800] }, [-1500, 100, 1200, 800]],
  ['오른쪽으로 삐져나가면 가상 화면 안으로 당긴다', { ...ONE, saved: [1800, 100, 1000, 700] }, [920, 100, 1000, 700]],
  ['가상 화면보다 크면 가상 화면 크기로 줄인다', { ...ONE, saved: [0, 0, 3000, 2000] }, [0, 0, 1920, 1080]],
];
if (!dotnetOk) {
  skip('열람 창 자리(FitPeerRect C# 프로브) 시험 전부', 'dotnet 없음', 'C# 을 그대로 컴파일해 판정하는 시험이라 JS 사본으로 대신하지 않는다');
} else {
  test('(P) FitPeerRect(C#): 기본 크기, 화면 밖이면 주 모니터 가운데, 가상 화면 안으로 당기기와 줄이기', () => {
    const got = fit(FIT_CASES.map(([, c]) => ({ fn: 'real', ...c })));
    FIT_CASES.forEach(([name, , want], i) => assert.deepStrictEqual(got[i], want, name));
  });
  test('(M) FitPeerRect(C#): 모니터 없어짐 갈래, 가상 화면 당기기, 기본 크기 상한을 각각 빼면 잡는다', () => {
    const pick = (name) => FIT_CASES.find((c) => c[0] === name);
    for (const [k, name] of [['noMonitorGone', '그 모니터가 없어졌으면(제목줄이 어느 작업 영역에도 없다) 주 모니터 가운데'],
                             ['noVirtClamp', '오른쪽으로 삐져나가면 가상 화면 안으로 당긴다'],
                             ['noDefaultCap', '처음(저장 없음)은 메인 창 모니터 가운데 1400x900']]) {
      const [, c, want] = pick(name);
      const [got] = fit([{ fn: k, ...c }]);
      assert.notDeepStrictEqual(got, want, `변이 ${k} 가 '${name}' 를 통과했다`);
    }
  });
}

// ══ (R) jsdom ══════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
if (!JSDOM) {
  skip('peer-window: jsdom 미설치 — ?peerwin=1 모드와 입구, 겹 갱신 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const ME = { loginId: 'phmin', name: '박현민', title: '수석연구원', orgUnit: 'SW 3팀' };
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const MAIN_URL = 'https://tcapp.local/', PW_URL = 'https://tcapp.local/?peerwin=1', FRAME_URL = 'https://tcapp.local/?peer=1';
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
      },
    });
    const w = dom.window;
    const X = { w, posted, errors, doc: w.document, ev: (c) => w.eval(c), close: () => { try { w.close(); } catch (_) {} },
      msgs: () => posted.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(Boolean) };
    if (stub) {
      w.eval(`window.__calls = []; window.__rep = {};
        hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
          var r = __rep[cmd];
          if(r === undefined) return Promise.resolve({ ok:false, msg:'시험: 회신 없음' });
          return Promise.resolve(JSON.parse(JSON.stringify(r))); };`);
    }
    return X;
  }
  const reply = (X, cmd, res) => {
    const m = X.msgs().filter((x) => x.cmd === cmd).pop();
    assert.ok(m && m.reqId, `${cmd} 요청이 나가지 않았다`);
    X.ev('__hostReply(' + JSON.stringify(m.reqId) + ', ' + JSON.stringify(res) + ')');
    return m;
  };
  const PEER_OK = { ok: true, allowed: true, categories: [], entries: [{ id: 'e-t1', date: '2026-06-11', title: '그 사람 일정', allDay: true }], todos: [] };

  //  ── ?peerwin=1 부팅 ──
  function checkPeerWinBoot(src) {
    const V = boot(src, PW_URL);
    try {
      assert.strictEqual(V.ev('PEERWIN'), true);
      assert.strictEqual(V.doc.documentElement.dataset.peerwin, '1', 'html[data-peerwin] 스위치가 서지 않는다');
      assert.ok(!V.doc.getElementById('peerWin').classList.contains('hidden'), '열람 껍데기가 펴지지 않았다');
      assert.strictEqual(V.doc.title, '다른 사람 일정');
      assert.deepStrictEqual(V.msgs().map((m) => m.cmd), ['peerWinReady'], '열람 창이 부팅에서 준비 알림 말고 다른 것을 보냈다(내 달력을 부팅했다)');
      assert.ok(!V.doc.querySelector('#hostbar .hb-cap'), '열람 창에 메인 창의 제목줄 단추(호스트바)가 그려졌다');
      const gate = V.doc.getElementById('loginGate');
      assert.ok(!gate || gate.classList.contains('hidden'), '열람 창에 로그인 화면이 떴다');
      //  보이는 것은 #peerWin, 사람 고르기, 토스트뿐(allowlist)
      const shown = [...V.doc.body.children].filter((e) => V.w.getComputedStyle(e).display !== 'none').map((e) => e.id || e.className);
      assert.deepStrictEqual(shown.filter((x) => !['peerWin', 'toastWrap'].includes(x)), [], '열람 창에 메인 화면이 보인다: ' + shown.join(','));
      assert.deepStrictEqual(V.errors, []);
    } finally { V.close(); }
  }
  test('(R) ?peerwin=1: 열람 껍데기만 펴고(메인 화면은 감춘다) 내 달력은 부팅하지 않는다(peerWinReady 하나만 보낸다)', () => checkPeerWinBoot(app));

  test('(R) 열람 창의 봉인: 읽기 넷만 나가고 나머지는 조용히 버린다 · 요청 번호는 pw: 로 시작한다 · 메인 창 번호에는 없다', async () => {
    const V = boot(app, PW_URL), B = boot(app, MAIN_URL);
    try {
      V.posted.length = 0;
      V.ev("hpost({cmd:'saveState', state:{}}); hpost({cmd:'ready'}); hpost({cmd:'reminderSync', occ:[]}); hpost({cmd:'peerOpen', loginId:'x'}); hpost({cmd:'winMinimize'})");
      assert.deepStrictEqual(V.posted, [], '열람 창에서 읽기 넷 밖의 명령이 나갔다');
      V.ev("hostRequest('membersGet', { includeInactive: false }, 50); hostRequest('peerMine', {}, 50)");
      const ids = V.msgs().map((m) => m.reqId);
      assert.ok(ids.length === 2 && ids.every((id) => /^pw:(membersGet|peerMine)-\d+$/.test(id)), '열람 창 요청 번호에 pw: 가 없다: ' + ids.join(','));
      B.posted.length = 0;
      B.ev("hostRequest('membersGet', { includeInactive: false }, 50)");
      assert.ok(/^membersGet-\d+$/.test(B.msgs()[0].reqId), '메인 창 요청 번호에 pw: 가 붙었다');
      await settle(80);
    } finally { V.close(); B.close(); }
  });

  test('(R) __peerWinOpen: 내 신원(me)은 즐겨찾기 키에만 · 남의 일정과 내 겹을 함께 물어 프레임을 만든다 · 창 제목 · 다시 열면 프레임을 바꾼다', async () => {
    const V = boot(app, PW_URL);
    try {
      V.posted.length = 0;
      V.ev(`__peerWinOpen(${JSON.stringify({ loginId: 'ihyoon', name: '윤인환', me: ME })})`);
      assert.strictEqual(V.ev('currentUser && currentUser.loginId'), 'phmin', '호스트가 준 내 신원을 쓰지 않는다(즐겨찾기 키가 서지 않는다)');
      assert.strictEqual(V.ev("pkKey('Fav')"), 'tc_peerFav:phmin');
      const cmds = V.msgs().map((m) => m.cmd).sort();
      assert.deepStrictEqual(cmds, ['peerMine', 'peerSchedule'], '남의 일정과 내 겹을 함께 묻지 않는다');
      const ps = V.msgs().find((m) => m.cmd === 'peerSchedule');
      assert.deepStrictEqual(Object.keys(ps).sort(), ['cmd', 'loginId', 'reqId'], '조회에 대상 말고 다른 것(보는 사람 등)을 싣는다');
      assert.strictEqual(ps.loginId, 'ihyoon');
      assert.strictEqual(V.doc.title, '윤인환 님의 일정', '문서 제목(= 창 제목)이 보는 사람이 아니다');
      reply(V, 'peerSchedule', PEER_OK);
      reply(V, 'peerMine', { ok: true, entries: [{ id: 'm1', date: '2026-06-12', title: '내 일정', memo: '비밀', categoryId: 'c1', source: '' }] });
      await settle();
      const f1 = V.doc.querySelector('#pvHost iframe');
      assert.ok(f1 && /\?peer=1$/.test(f1.getAttribute('src')), '열람 프레임(?peer=1)을 만들지 않았다');
      const mine = JSON.parse(V.ev('JSON.stringify(__pv.mine)'));
      assert.deepStrictEqual(mine.map((e) => [e.id, e._mine, e.categoryId, 'memo' in e]), [['m1', true, null, false]], '받은 겹을 buildMineOverlay 로 다시 깎지 않았다');
      V.ev(`__peerWinOpen(${JSON.stringify({ loginId: 'yschoi', name: '최용성', me: ME })})`);
      assert.strictEqual(V.doc.querySelectorAll('#pvHost iframe').length, 0, '다른 사람을 열었는데 옛 프레임이 남았다');
      assert.strictEqual(V.doc.title, '최용성 님의 일정');
      reply(V, 'peerSchedule', { ok: true, allowed: false });
      reply(V, 'peerMine', { ok: true, entries: [] });
      await settle();
      assert.ok(/권한이 없습니다/.test(V.doc.getElementById('pvHost').textContent), '권한 없음을 말하지 않는다');
      assert.deepStrictEqual(V.errors, []);
    } finally { V.close(); }
  });

  function checkMainEntry(src) {
    const B = boot(src, MAIN_URL);
    try {
      B.ev('currentUser = ' + JSON.stringify(ME));
      B.posted.length = 0;
      B.ev("openPeerSchedule('ihyoon', '윤인환')");
      assert.deepStrictEqual(B.msgs(), [{ cmd: 'peerOpen', loginId: 'ihyoon', name: '윤인환' }], '메인 창이 열람 창 열기(peerOpen) 하나만 보내지 않는다');
      assert.ok(B.doc.getElementById('peerWin').classList.contains('hidden'), '메인 창 안에 열람 화면이 펴졌다');
      assert.strictEqual(B.doc.querySelectorAll('iframe').length, 0, '메인 창에 열람 프레임이 생겼다');
    } finally { B.close(); }
  }
  test('(R) 메인 창의 입구: openPeerSchedule 은 호스트에 peerOpen 하나만 보낸다(남의 일정을 묻지도 그리지도 않는다)', () => checkMainEntry(app));

  test('(R) __peerMineSnapshot: 메인 창은 내 겹 모양(일정만, 메모 없음, 커밋 제외)을 주고, 열람 창과 열람 프레임은 빈 배열', () => {
    const B = boot(app, MAIN_URL), V = boot(app, PW_URL), F = boot(app, FRAME_URL);
    try {
      B.w.__applyState(JSON.stringify({ categories: [{ id: 'c-vac', name: '휴가', color: '#2e9e6b' }, { id: 'c-etc', name: '기타', color: '#5b6b7d' }],
        entries: [{ id: 'a', date: '2026-06-01', title: '내 일정', memo: '비밀', location: '3층', categoryId: 'c-etc', commits: [{ subject: 's' }] },
                  { id: 'g', date: '2026-06-02', title: '커밋', source: 'git', categoryId: 'c-etc' }], todos: [{ text: '할 일' }] }), {});
      const snap = JSON.parse(B.ev('JSON.stringify(window.__peerMineSnapshot())'));
      assert.deepStrictEqual(snap.map((e) => e.id), ['a'], '커밋이 겹에 들어갔다');
      assert.ok(snap[0]._mine === true && snap[0].categoryId === null && !('memo' in snap[0]) && !('location' in snap[0]) && !('commits' in snap[0]), JSON.stringify(snap[0]));
      assert.deepStrictEqual(JSON.parse(V.ev('JSON.stringify(window.__peerMineSnapshot())')), []);
      assert.deepStrictEqual(JSON.parse(F.ev('JSON.stringify(window.__peerMineSnapshot())')), []);
    } finally { B.close(); V.close(); F.close(); }
  });

  test('(R) __peerSetMine(열람 프레임): 겹만 갈아 끼우고 그 사람 기록은 그대로 · 원본도 고쳐 되돌리기가 옛 겹으로 가지 않는다 · _mine 아닌 것은 버린다', () => {
    const F = boot(app, FRAME_URL);
    try {
      const theirs = { id: 't1', date: '2026-06-03', title: '그 사람', allDay: true, categoryId: 'c1' };
      const old = { id: 'm-old', date: '2026-06-04', title: '옛 겹', allDay: true, categoryId: null, _mine: true };
      F.w.__applyState(JSON.stringify({ categories: [{ id: 'c1', name: '과제', color: '#3e5be0' }], entries: [theirs, old], todos: [] }), { peerName: '윤인환', canWrite: false });
      F.ev("view = {y:2026, m:5}; selectedDate = '2026-06-03'; filterCatId = 'c1'");
      const ok = F.ev(`__peerSetMine(${JSON.stringify(JSON.stringify([{ id: 'm-new', date: '2026-06-05', title: '새 겹', allDay: true, categoryId: null, _mine: true },
                                                                       { id: 'sneak', date: '2026-06-06', title: '끼어들기', categoryId: 'c1' }]))})`);
      assert.strictEqual(ok, true);
      const ids = () => JSON.parse(F.ev('JSON.stringify(state.entries.map(function(e){ return e.id; }))'));
      assert.deepStrictEqual(ids(), ['t1', 'm-new'], '겹만 갈아 끼우지 않았다(또는 _mine 아닌 것을 받았다)');
      assert.strictEqual(F.ev('filterCatId'), 'c1', '겹을 바꾸면서 과제 필터를 처음으로 돌렸다');
      assert.strictEqual(F.ev('selectedDate'), '2026-06-03', '겹을 바꾸면서 고른 날을 잃었다');
      F.ev('save()');   // 열람 창의 save 는 원본으로 되돌린다(peerRevert)
      assert.deepStrictEqual(ids(), ['t1', 'm-new'], '되돌리기가 옛 겹으로 돌아갔다(원본을 고치지 않았다)');
      assert.strictEqual(F.ev("__peerSetMine('[1,2')"), false, '깨진 값을 받아들였다');
      const B = boot(app, MAIN_URL);
      try { assert.strictEqual(B.ev("__peerSetMine('[]')"), false, '메인 창에서도 겹을 갈아 끼운다'); } finally { B.close(); }
    } finally { F.close(); }
  });

  test('(R) 겹 다시 받기: 프레임의 겹을 켜거나 나란히 보기로 바꾸면, 그리고 창이 앞으로 오면(__peerWinActivated) peerMine 을 다시 묻는다 · 끈 것은 묻지 않는다', async () => {
    const V = boot(app, PW_URL, { stub: true });
    try {
      V.ev('__rep.peerSchedule = ' + JSON.stringify(PEER_OK) + '; __rep.peerMine = ' + JSON.stringify({ ok: true, entries: [{ id: 'm1', date: '2026-06-01', title: '겹', _mine: true }] }));
      V.ev(`__peerWinOpen(${JSON.stringify({ loginId: 'ihyoon', name: '윤인환', me: ME })})`);
      await settle();
      //  jsdom 은 iframe 을 불러오지 않는다 → 프레임 쪽 두 함수를 세우고 load 를 쏜다(부모 쪽 계약만 본다)
      V.ev(`(function(){ var f = document.querySelector('#pvHost iframe'), w = f.contentWindow, d = f.contentDocument; w.__got = [];
        if(!d.body){ var h = d.documentElement || d.appendChild(d.createElement('html')); h.appendChild(d.createElement('body')); }
        w.__applyState = function(){}; w.__peerSetMine = function(j){ w.__got.push(JSON.parse(j)); return true; };
        f.dispatchEvent(new Event('load')); })()`);
      await settle();
      const mineCalls = () => JSON.parse(V.ev('JSON.stringify(__calls)')).filter((c) => c[0] === 'peerMine').length;
      const got = () => JSON.parse(V.ev("JSON.stringify(document.querySelector('#pvHost iframe').contentWindow.__got)"));
      const body = () => V.doc.querySelector('#pvHost iframe').contentDocument.body;
      const n0 = mineCalls();
      body().dataset.peerOverlay = '1';
      await settle();
      assert.strictEqual(mineCalls(), n0 + 1, '겹을 켰는데 내 겹을 다시 묻지 않았다');
      assert.deepStrictEqual(got().pop().map((e) => [e.id, e._mine]), [['m1', true]], '다시 받은 겹을 프레임에 넣지 않았다');
      delete body().dataset.peerOverlay;
      await settle();
      assert.strictEqual(mineCalls(), n0 + 1, '겹을 껐는데 내 겹을 다시 물었다');
      body().dataset.peerLayout = 'side';
      await settle();
      assert.strictEqual(mineCalls(), n0 + 2, '나란히 보기로 바꿨는데 내 겹을 다시 묻지 않았다');
      V.ev('__peerWinActivated()');
      await settle();
      assert.strictEqual(mineCalls(), n0 + 3, '창이 앞으로 왔는데 내 겹을 다시 묻지 않았다');
      assert.deepStrictEqual(V.errors, []);
    } finally { V.close(); }
  });

  test('(R) 두 창이 함께 쓰는 저장소: 다른 창이 즐겨찾기를 바꾸면 ☆/★ 가, 테마를 바꾸면 열람 창과 프레임의 테마가 따라간다', async () => {
    const V = boot(app, PW_URL, { stub: true }), F = boot(app, FRAME_URL);
    try {
      V.ev('__rep.peerSchedule = ' + JSON.stringify(PEER_OK));
      V.ev(`__peerWinOpen(${JSON.stringify({ loginId: 'ihyoon', name: '윤인환', me: ME })})`);
      await settle();
      const fv = V.doc.getElementById('pvFav');
      assert.strictEqual(fv.getAttribute('aria-pressed'), 'false');
      //  메인 창이 저장한 것처럼: 값을 넣고 storage 이벤트를 쏜다(같은 창의 setItem 은 storage 를 쏘지 않는다)
      V.w.localStorage.setItem('tc_peerFav:phmin', JSON.stringify([{ loginId: 'ihyoon', name: '윤인환' }]));
      V.w.dispatchEvent(new V.w.StorageEvent('storage', { key: 'tc_peerFav:phmin' }));
      assert.deepStrictEqual([fv.getAttribute('aria-pressed'), fv.textContent], ['true', '★'], '다른 창의 즐겨찾기가 ☆/★ 에 반영되지 않았다');
      for (const X of [V, F]) {
        X.w.dispatchEvent(new X.w.StorageEvent('storage', { key: 'tc_theme', newValue: 'dark' }));
        assert.strictEqual(X.doc.documentElement.getAttribute('data-theme'), 'dark', '메인 창의 테마 바꿈을 따라가지 않는다');
      }
    } finally { V.close(); F.close(); }
  });

  // ── (M) 웹 변이 ──
  test('(M) 웹: 열람 창 봉인(PEERWIN 거름)을 빼면, 메인 창이 직접 조회하면, 껍데기를 펴지 않으면 각각 잡는다', async () => {
    const noSeal = mutate(app, "  if(PEERWIN && !PEERWIN_CMD.has(String((o && o.cmd) || ''))) return;\n", '');
    const V = boot(noSeal, PW_URL);
    try {
      V.posted.length = 0;
      V.ev("hpost({cmd:'saveState', state:{}})");
      assert.ok(V.msgs().some((m) => m.cmd === 'saveState'), '전제: 봉인을 빼면 쓰기가 나간다');
    } finally { V.close(); }
    assert.throws(() => checkPeerWinBoot(noSeal), /다른 것을 보냈다/);
    const direct = mutate(app, "  if(!PEERWIN){ hpost({ cmd:'peerOpen', loginId:String(loginId == null ? '' : loginId), name:String(name || '') }); return; }\n", '');
    assert.throws(() => checkMainEntry(direct), /peerOpen\) 하나만 보내지 않는다/);
    const noShell = mutate(app, "  if(w) w.classList.remove('hidden');\n  document.title = '다른 사람 일정';", "  document.title = '다른 사람 일정';");
    assert.throws(() => checkPeerWinBoot(noShell), /펴지지 않았다/);
    const noPrefix = mutate(app, "const reqId = (PEERWIN ? 'pw:' : '') + cmd + '-' + (++__reqSeq);", "const reqId = cmd + '-' + (++__reqSeq);");
    const V2 = boot(noPrefix, PW_URL);
    try {
      V2.ev("hostRequest('membersGet', {}, 50)");
      assert.ok(!/^pw:/.test(V2.msgs().pop().reqId), '전제: 변이가 pw: 를 뺐다');
    } finally { V2.close(); }
    await settle(80);
  });
}
