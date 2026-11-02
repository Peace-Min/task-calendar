// 근태 창 다시 쓰기(docs/WINDOW-INPAGE.md). 정적 검사(S)와 변이(M).
//
// 지키는 것:
//   ① 닫기 = 숨기기는 근태 창(WinKind.ReuseOnClose)만. 관리 창과 열람 창은 그대로 닫는다(CloseByUser).
//   ② 다시 열기는 살아 있는 숨긴 창을 쓰고(payload 만 넣고 Show), 믿을 수 없는 창(닫힘, Core 없음, 숨긴 채 준비 풀림)은 버리고 새로 만든다.
//      만들기, 보이기, 대상 넣기가 던지면 로그를 남기고 그 창을 버린다.
//   ③ 처음 열 때 WPF 로딩 겹침(불러오는 중 + 흐르는 막대)이 준비 전 보이고, 대상이 들어간 뒤 걷힌다.
//   ④ 로그아웃, 계정 바뀜, 앱 종료는 숨긴 창도 진짜로 닫는다. 숨긴 동안 ProcessFailed 면 버린다. Closed 에서 참조를 비운다.
//   ⑤ 숨기기 직전 웹 정리(__attendWinHidden)를 부르고, 웹은 임시 저장을 남기고 편집 상태를 비운다.
//   ⑥ 열기 시각 로그: 열기 요청, 보임, 화면 준비(ms, 첫 열기와 다시 열기).
import { test, assert, loadAppSource, extractCsMember, readText } from './harness.mjs';

const W = (f) => readText(new URL('../widget/' + f, import.meta.url)).replace(/\r/g, '');
const src = { aw: W('AppWindow.cs'), main: W('MainWindow.xaml.cs'), app: loadAppSource() };
const with_ = (k, v) => ({ ...src, [k]: v });

function mutate(base, from, to) {
  const n = base.split(from).length - 1;
  assert.equal(n, 1, `변이 앵커가 ${n}번 나온다: ${from.slice(0, 80)}`);
  return base.replace(from, to);
}
const member = (code, sig) => extractCsMember(code, sig);
function kindBody(aw, name) {
  const m = new RegExp(`public static readonly WinKind ${name} = new\\(\\)\\s*\\{([\\s\\S]*?)\\};`).exec(aw);
  assert.ok(m, `WinKind.${name} 정의를 찾지 못했다`);
  return m[1];
}

const checks = {
  //  ① 종류
  kinds(s) {
    assert.match(kindBody(s.aw, 'Attend'), /ReuseOnClose = true, HiddenFn = "__attendWinHidden",/, '근태 창이 닫기 = 숨기기가 아니다');
    assert.ok(!/ReuseOnClose/.test(kindBody(s.aw, 'Admin')), '관리 창이 숨기기 종류다');
    assert.ok(!/ReuseOnClose/.test(kindBody(s.aw, 'Peer')), '열람 창이 숨기기 종류다');
  },
  closeHides(s) {
    assert.match(member(s.aw, 'private void CloseByUser()'), /if \(Kind\.ReuseOnClose\) HideForReuse\(\);\s*else CloseNow\(\);/, '다른 종류의 닫기가 그대로 닫기가 아니다');
    assert.match(member(s.aw, 'public void CloseNow()'), /_closeOk = true;\s*try \{ Close\(\); \} catch \{ \}/, 'CloseNow 가 진짜 닫기가 아니다');
    assert.match(member(s.aw, 'private async Task AskCloseAsync()'), /CloseByUser\(\);/, '✕ 의 닫기 확인 뒤가 숨기기로 가지 않는다');
    assert.match(member(s.aw, 'private async Task InitAsync()'), /WindowCloseRequested \+= \(_, _\) => Dispatcher\.BeginInvoke\(new Action\(CloseByUser\)\);/, '웹의 window.close 가 숨기기로 가지 않는다');
    const h = member(s.aw, 'private void HideForReuse()');
    assert.match(h, /SaveBounds\(\);[\s\S]*Hide\(\);/, '숨기기 전에 자리를 남기고 Hide 하지 않는다');
    assert.ok(h.indexOf('SaveBounds();') < h.indexOf('Hide();'), '자리를 숨긴 뒤에 남긴다');
    assert.match(h, /catch \(Exception ex\)\s*\{[\s\S]*CloseNow\(\);/, '숨기기 실패 때 창을 버리지 않는다');
  },
  //  ⑤ 웹 정리
  webCleanup(s) {
    const h = member(s.aw, 'private void HideForReuse()');
    assert.match(h, /Js\("window\." \+ Kind\.HiddenFn \+ " && window\." \+ Kind\.HiddenFn \+ "\(\)"\);/, '숨기기 직전에 웹 정리를 부르지 않는다');
    assert.ok(h.indexOf('Kind.HiddenFn') < h.indexOf('Hide();'), '웹 정리가 숨긴 뒤다');
    const a = s.app;
    const i = a.indexOf('window.__attendWinHidden = function(){');
    assert.ok(i >= 0, '웹에 __attendWinHidden 이 없다');
    const body = a.slice(i, a.indexOf('\n};', i));
    assert.match(body, /atDraftFlushNow\(\)/, '쓰던 일간 글을 임시 저장에 남기지 않는다');
    assert.match(body, /awDraftFlushNow\(\)/, '쓰던 주간 글을 임시 저장에 남기지 않는다');
    assert.match(body, /atCloseEditor\(\)/, '일간 편집 상태를 비우지 않는다');
    assert.match(body, /awCloseEditor\(\)/, '주간 편집 상태를 비우지 않는다');
    assert.match(body, /clearTimeout\(ATE\.pvT\)/, '타이머를 비우지 않는다');
    assert.match(body, /closeOverlay\(document\.getElementById\('confirmModal'\)\)/, '열린 하위 팝업을 닫지 않는다');
    assert.match(body, /classList\.add\('at-idle'\)/, '화면을 비우지(가리지) 않는다');
    const o = a.slice(a.indexOf('window.__attendWinOpen = function(o){'), a.indexOf('window.__attendWinHidden'));
    assert.match(o, /classList\.remove\('at-idle'\)/, '다시 열 때 비운 화면을 걷지 않는다');
  },
  //  ② 다시 열기와 실패
  reopen(s) {
    const sw = member(s.main, 'private AppWindow? ShowWin(WinKind k, string json)');
    assert.match(sw, /if \(w != null && k\.ReuseOnClose && \(w\.Core == null \|\| \(!w\.IsVisible && !w\.IsReady\)\)\)\s*\{[\s\S]*_wins\.Remove\(k\);[\s\S]*w\.CloseNow\(\);[\s\S]*w = null;\s*\}/, '다시 열기가 창 참조와 Core, 준비를 확인하고 못 쓰면 버리지 않는다');
    assert.match(sw, /if \(w == null\)\s*\{[\s\S]*new AppWindow\([\s\S]*\}\s*w\.ShowTarget\(json\);\s*w\.BringToFront\(\);/, '숨긴 창이 있으면 payload 를 넣고 보이는 길이 아니다');
    assert.match(sw, /try\s*\{[\s\S]*w\.ShowTarget\(json\);[\s\S]*w\.BringToFront\(\);[\s\S]*\}\s*catch \(Exception ex\)\s*\{[\s\S]*열기 실패, 창을 버림[\s\S]*_wins\.Remove\(k\);[\s\S]*w\.CloseNow\(\);/, '만들기, 보이기, 대상 넣기 실패 때 창을 버리지 않는다');
    const bf = member(s.aw, 'public void BringToFront()');
    assert.match(bf, /if \(!IsVisible\) Show\(\);/, '숨긴 창을 보이지 않는다');
  },
  //  닫힌 창 참조
  closedRef(s) {
    assert.match(member(s.aw, 'public AppWindow(MainWindow host, WinKind kind, CoreWebView2Environment env, string appDir, Rect bounds, bool maximized, bool dark)'),
      /Closed \+= \(_, _\) => \{ _closed = true; try \{ _web\.Dispose\(\); \} catch \{ \} \};/, 'Closed 에서 닫힘 표시를 하지 않는다');
    assert.match(member(s.main, 'private AppWindow? WinOf(WinKind k)'), /if \(w\.IsClosed\) \{ _wins\.Remove\(k\); return null; \}/, '닫힌 창 참조를 WinOf 가 비우지 않는다');
    assert.match(member(s.main, 'private AppWindow? ShowWin(WinKind k, string json)'), /made\.Closed \+= \(_, _\) => \{ if \(ReferenceEquals\(WinOf\(k\), made\)\) _wins\.Remove\(k\); ForgetWinReqs\(k\); \};/, '창 Closed 에서 캐시 참조를 비우지 않는다');
    assert.match(member(s.aw, 'public CoreWebView2? Core'), /get \{ try \{ return _web\.CoreWebView2; \} catch \{ return null; \} \}/, 'Core 가 해제된 창에서 던진다');
    //  꺼내 쓰는 자리는 Core 와 닫힘을 안전하게 본다
    assert.match(member(s.main, 'private void AttendSourceToWin(JsonDocument doc)'), /var core = WinOf\(WinKind\.Attend\)\?\.Core;\s*if \(core == null\) return;/, '가져오기 중계가 없는 근태 창을 건너뛰지 않는다');
    assert.match(member(s.main, 'private void ReportPush(string js)'), /try \{ _ = WinOf\(WinKind\.Attend\)\?\.Core\?\.ExecuteScriptAsync\(js\); \} catch \{ \}/, '보고 알림이 없는 근태 창을 건너뛰지 않는다');
    assert.match(member(s.aw, 'private void Js(string js)'), /try \{ _ = _web\.CoreWebView2\?\.ExecuteScriptAsync\(js\); \} catch \{ \}/, '웹 호출이 던진다');
  },
  //  ③ 로딩 겹침
  cover(s) {
    const aw = s.aw;
    assert.match(aw, /if \(kind\.ReuseOnClose\) BuildCover\(bg, dark\);\s*else Content = _web;/, '숨기는 종류만 로딩 겹침을 쓰지 않는다');
    const b = member(aw, 'private void BuildCover(Color bg, bool dark)');
    assert.match(b, /Text = "불러오는 중…"/, '불러오는 중 글이 없다');
    assert.match(b, /IsIndeterminate = true, Width = 150, Height = 3/, '흐르는 막대(메인 창 loadingBar 와 같은 크기)가 아니다');
    assert.match(b, /Color\.FromRgb\(0x37, 0x8A, 0xDD\)/, '막대 색이 메인 창과 다르다');
    assert.match(b, /_web\.Margin = new Thickness\(-30000, 0, 30000, 0\);/, '웹을 가리지 않는다(WebView2 가 겹침을 덮는다)');
    assert.match(b, /dark \?/, '다크 테마를 따르지 않는다');
    const r = member(aw, 'private void RevealWeb()');
    assert.match(r, /_cover\.Visibility = Visibility\.Collapsed;\s*_web\.Margin = new Thickness\(0\);/, '로딩 겹침을 걷고 웹을 보이지 않는다');
    assert.match(r, /_coverBar\.IsIndeterminate = false;/, '애니메이션을 멈추지 않는다');
    assert.match(member(aw, 'private async Task PushAsync()'), /await core\.ExecuteScriptAsync[\s\S]*RevealWeb\(\);\s*_host\.TraceOpenReady\(Kind\);/, '대상이 들어간 뒤 로딩을 걷지 않는다');
    assert.match(member(aw, 'public void OnWebReady()'), /_ready = true;[\s\S]*else RevealWeb\(\);/, '대상이 없을 때 준비되면 로딩을 걷지 않는다');
  },
  //  ④ 정리
  teardown(s) {
    const c = member(s.main, 'private void CloseSubWindows()');
    assert.ok(!/WinKind\./.test(c), '종류를 가려 닫는다(근태 창이 빠질 수 있다)');
    assert.match(c, /foreach \(var kv in all\)[\s\S]*kv\.Value\.CloseNow\(\);/, '숨긴 창을 진짜로 닫지 않는다');
    assert.match(member(s.main, 'private void RunUserLogout(string reqId)'), /CloseSubWindows\(\);/, '로그아웃이 숨긴 근태 창을 닫지 않는다');
    assert.match(member(s.main, 'private async Task RunUserLoginAsync(string reqId, string id, string pw)'), /Dispatcher\.Invoke\(CloseSubWindows\);/, '계정이 바뀌어도 숨긴 근태 창이 남는다');
    assert.match(member(s.main, 'private void Window_Closing(object? sender, System.ComponentModel.CancelEventArgs e)'), /CloseSubWindows\(\);/, '앱 종료가 숨긴 근태 창을 닫지 않는다(프로세스를 붙잡는다)');
    const pf = member(s.aw, 'private void OnProcessFailed(CoreWebView2 core, CoreWebView2ProcessFailedKind kind)');
    assert.match(pf, /if \(Kind\.ReuseOnClose && !IsVisible\)\s*\{\s*Dispatcher\.BeginInvoke\(new Action\(CloseNow\)\);\s*return;\s*\}/, '숨긴 동안 프로세스가 죽어도 창을 버리지 않는다');
  },
  //  ⑥ 로그
  logs(s) {
    const sw = member(s.main, 'private AppWindow? ShowWin(WinKind k, string json)');
    assert.match(sw, /Log\(\$"\{k\.Name\} 열기 요청 \(\{\(first \? "첫 열기" : "다시 열기"\)\}\)"\);/, '열기 요청 로그가 없다');
    assert.match(sw, /if \(k\.ReuseOnClose\) Log\(\$"\{k\.Name\} 보임 \(\{\(first \? "첫 열기" : "다시 열기"\)\}\) \+\{Environment\.TickCount64 - t0\}ms"\);/, '창 보임 로그가 없다');
    const t = member(s.main, 'internal void TraceOpenReady(WinKind k)');
    assert.match(t, /k == WinKind\.Attend \? "근태 화면 준비" : k\.Name \+ " 화면 준비"/, '화면 준비 로그 이름이 다르다');
    assert.match(t, /\+\{Environment\.TickCount64 - t\.t0\}ms/, 'ms 가 없다');
  },
};

test('(S) 종류: 근태 창만 닫기 = 숨기기, 관리 창과 열람 창은 그대로', () => checks.kinds(src));
test('(S) 닫기: 사용자 닫기는 숨기기(자리 먼저), 다른 종류는 닫기, CloseNow 는 진짜 닫기', () => checks.closeHides(src));
test('(S) 숨기기 직전 웹 정리: 임시 저장 남기기, 편집 상태, 하위 팝업, 타이머, 화면 비우기. 다시 열면 걷는다', () => checks.webCleanup(src));
test('(S) 다시 열기: 숨긴 창이면 payload 와 Show, 못 쓰는 창은 버리고 새로, 실패하면 버린다', () => checks.reopen(src));
test('(S) 닫힌 창 참조: Closed 에서 비움, WinOf 가 닫힌 창을 걸러냄, Core 접근이 던지지 않음, 꺼내 쓰는 자리가 건너뜀', () => checks.closedRef(src));
test('(S) 로딩 겹침: 준비 전 보이고(웹은 가림) 대상이 들어간 뒤 걷힌다', () => checks.cover(src));
test('(S) 정리: 로그아웃, 계정 바뀜, 종료는 숨긴 창도 진짜로 닫고, 숨긴 동안 프로세스 실패는 버린다', () => checks.teardown(src));
test('(S) 열기 시각 로그 세 줄(요청, 보임, 화면 준비)과 ms', () => checks.logs(src));

test('(M) 숨기기를 닫기로 되돌리면, 웹 정리 호출을 빼면 잡는다', () => {
  assert.throws(() => checks.closeHides(with_('aw', mutate(src.aw, 'if (Kind.ReuseOnClose) HideForReuse();', 'if (false) HideForReuse();'))), /그대로 닫기가 아니다/);
  assert.throws(() => checks.closeHides(with_('aw', mutate(src.aw, '                Hide();\n', '                Close();\n'))), /Hide 하지 않는다/);
  assert.throws(() => checks.webCleanup(with_('aw', mutate(src.aw, '                if (Kind.HiddenFn.Length > 0) Js("window." + Kind.HiddenFn + " && window." + Kind.HiddenFn + "()");\n', ''))), /웹 정리를 부르지 않는다/);
  assert.throws(() => checks.webCleanup(with_('app', mutate(src.app, '  try{ atCloseEditor(); }catch(_){}\n  try{ awCloseEditor(); }catch(_){}\n', ''))), /편집 상태를 비우지 않는다/);
});
test('(M) 로그아웃과 종료 정리에서 근태 창을 빼면, 숨긴 동안 프로세스 실패 버리기를 빼면 잡는다', () => {
  assert.throws(() => checks.teardown(with_('main', mutate(src.main, 'try { kv.Value.CloseNow(); }', 'try { if (kv.Key != WinKind.Attend) kv.Value.CloseNow(); }'))), /종류를 가려 닫는다/);
  assert.throws(() => checks.teardown(with_('main', mutate(src.main, '                CloseSubWindows();   // 로그아웃하면', '                //  CloseSubWindows();   // 로그아웃하면'))), /로그아웃이 숨긴 근태 창을 닫지 않는다/);
  assert.throws(() => checks.teardown(with_('aw', mutate(src.aw, 'if (Kind.ReuseOnClose && !IsVisible)\n            {\n                Dispatcher', 'if (false)\n            {\n                Dispatcher'))), /프로세스가 죽어도 창을 버리지 않는다/);
});
test('(M) Closed 에서 참조 비우기를 빼면, 다시 열기의 null 과 Core 확인을 빼면 잡는다', () => {
  assert.throws(() => checks.closedRef(with_('aw', mutate(src.aw, 'Closed += (_, _) => { _closed = true; try', 'Closed += (_, _) => { try'))), /닫힘 표시를 하지 않는다/);
  assert.throws(() => checks.closedRef(with_('main', mutate(src.main, 'if (w.IsClosed) { _wins.Remove(k); return null; }', ''))), /WinOf 가 비우지 않는다/);
  assert.throws(() => checks.closedRef(with_('main', mutate(src.main, 'made.Closed += (_, _) => { if (ReferenceEquals(WinOf(k), made)) _wins.Remove(k); ForgetWinReqs(k); };', ''))), /캐시 참조를 비우지 않는다/);
  assert.throws(() => checks.reopen(with_('main', mutate(src.main, 'if (w != null && k.ReuseOnClose && (w.Core == null || (!w.IsVisible && !w.IsReady)))', 'if (false)'))), /확인하고 못 쓰면 버리지 않는다/);
  assert.throws(() => checks.reopen(with_('main', mutate(src.main, '(w.Core == null || (!w.IsVisible && !w.IsReady))', '(!w.IsVisible && !w.IsReady)'))), /확인하고 못 쓰면 버리지 않는다/);
  assert.throws(() => checks.reopen(with_('main', mutate(src.main, 'Log(k.Name + " 열기 실패, 창을 버림: " + ex.Message);', ''))), /실패 때 창을 버리지 않는다/);
});
test('(M) 로딩을 걷지 않거나 웹을 가리지 않으면, 로그를 빼면 잡는다', () => {
  assert.throws(() => checks.cover(with_('aw', mutate(src.aw, '            RevealWeb();\n            _host.TraceOpenReady(Kind);', '            _host.TraceOpenReady(Kind);'))), /로딩을 걷지 않는다/);
  assert.throws(() => checks.cover(with_('aw', mutate(src.aw, '            _web.Margin = new Thickness(-30000, 0, 30000, 0);\n', ''))), /웹을 가리지 않는다/);
  assert.throws(() => checks.logs(with_('main', mutate(src.main, 'Log($"{k.Name} 열기 요청 ({(first ? "첫 열기" : "다시 열기")})");', ''))), /열기 요청 로그가 없다/);
});
