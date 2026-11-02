using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace TaskCalendarWidget
{
    // ============ 따로 뜨는 창의 종류(WINDOW-UI §4, ADMIN-WINDOW §3) ============
    //  메인 창 밖에 따로 뜨는 창은 종류마다 하나다(MainWindow._wins). 지금 종류는 셋이다.
    //    열람 창(Peer): 다른 사람 일정 보기. 같은 HTML 을 ?peerwin=1 로 띄운다.
    //    관리 창(Admin): ⚙ 관리 허브. 같은 HTML 을 ?win=admin 으로 띄운다.
    //    근태 창(Attend): 근태 보고 작성(ATTENDANCE-PLAN §3.1). 같은 HTML 을 ?win=attend 로 띄운다.
    //  종류가 정하는 것: 웹 주소(같은 HTML 의 모드), 창 제목, 최소 크기, 처음 크기, 크기 기억 자리(widget.settings.json),
    //  명령 허용 목록(웹과 호스트 양쪽에서 거른다. 판정은 호스트의 MainWindow.OnWebMessage), 회신 번호 머리,
    //  번호 없이 받는 명령, 목록 갱신 알림을 받는지, 닫기 전에 웹에 묻는지.
    //  ★ 열람 창의 값은 종류를 나누기 전(PeerWindow) 그대로다. 동작이 바뀌지 않는다.
    internal sealed class WinKind
    {
        public string Id { get; private init; } = "";
        public string Name { get; private init; } = "";             // 로그와 거절 문구("열람 창", "관리 창")
        public string Url { get; private init; } = "";
        public string Title { get; private init; } = "";            // 처음 창 제목
        public bool TitleFollowsDocument { get; private init; }     // 열람 창: 웹 문서 제목('<이름> 님의 일정')을 따라간다
        public double MinWidth { get; private init; }
        public double MinHeight { get; private init; }
        public double DefaultWidth { get; private init; }           // 처음 열 때(작업 영역의 90% 를 넘지 않게 줄인다)
        public double DefaultHeight { get; private init; }
        public string ReqPrefix { get; private init; } = "";        // 이 창의 요청 번호 머리. 회신은 이 표시로 이 창에 간다(MainWindow.ReplyCore)
        public string ReadyCmd { get; private init; } = "";         // 웹이 떴다는 알림. 번호 없이 온다
        public bool AnyCmdWithoutReq { get; private init; }         // 관리 창: 회신이 없는 명령(목록 읽기, 과제 저장)도 번호 없이 온다
        public HashSet<string> Commands { get; private init; } = new();
        public string OpenFn { get; private init; } = "";           // 대상을 넘기는 웹 함수(준비되면 넘긴다)
        public string ActivatedFn { get; private init; } = "";      // 창이 앞으로 올 때 부르는 웹 함수(없으면 "")
        public bool GetsCatalog { get; private init; }              // 목록 갱신 알림(__applyProjects 등)을 메인 창과 함께 받는다
        public bool AskBeforeClose { get; private init; }           // 창을 닫기 전에 웹에 묻는다(저장 안 한 입력, ADMIN-WINDOW §2.2)
        public bool ReuseOnClose { get; private init; }             // 닫기 = 숨기기(WINDOW-INPAGE). 다음 열기는 payload 만 넣고 바로 보인다. 처음 열 때는 웹이 준비될 때까지 "불러오는 중"을 보인다
        public string HiddenFn { get; private init; } = "";          // 숨기기 직전에 부르는 웹 함수(화면 비우기). ReuseOnClose 종류만 쓴다
        public Func<WidgetSettings, PeerWindowBounds?> GetBounds { get; private init; } = _ => null;
        public Action<WidgetSettings, PeerWindowBounds> SetBounds { get; private init; } = (_, _) => { };

        public static readonly WinKind Peer = new()
        {
            Id = "peer", Name = "열람 창", Url = "https://tcapp.local/index.html?peerwin=1", Title = "다른 사람 일정",
            TitleFollowsDocument = true, MinWidth = 480, MinHeight = 360, DefaultWidth = 1400, DefaultHeight = 900,
            ReqPrefix = MainWindow.PeerReqPrefix, ReadyCmd = "peerWinReady", AnyCmdWithoutReq = false,
            Commands = MainWindow.PeerWinCommands, OpenFn = "__peerWinOpen", ActivatedFn = "__peerWinActivated",
            GetsCatalog = false, AskBeforeClose = false,
            GetBounds = s => s.Peer, SetBounds = (s, b) => s.Peer = b,
        };
        public static readonly WinKind Admin = new()
        {
            Id = "admin", Name = "관리 창", Url = "https://tcapp.local/index.html?win=admin", Title = "수행과제 캘린더 관리",
            TitleFollowsDocument = false, MinWidth = 720, MinHeight = 520, DefaultWidth = 1200, DefaultHeight = 800,
            ReqPrefix = MainWindow.AdminReqPrefix, ReadyCmd = "adminWinReady", AnyCmdWithoutReq = true,
            Commands = MainWindow.AdminWinCommands, OpenFn = "__adminWinOpen", ActivatedFn = "",
            GetsCatalog = true, AskBeforeClose = true,
            GetBounds = s => s.Admin, SetBounds = (s, b) => s.Admin = b,
        };
        //  근태 창(ATTENDANCE-PLAN §3.1). 대상(payload)은 메인 창이 만들어 attendOpen 으로 넘긴다. 내 달력은 읽지 않는다.
        //  회신 없는 명령(attendNav, netcusSubmit)도 번호 없이 오므로 AnyCmdWithoutReq 를 켠다. 작성 중 글이 있으면 닫기 전에 묻는다.
        public static readonly WinKind Attend = new()
        {
            Id = "attend", Name = "근태 창", Url = "https://tcapp.local/index.html?win=attend", Title = "근태 보고",
            TitleFollowsDocument = false, MinWidth = 720, MinHeight = 520, DefaultWidth = 1200, DefaultHeight = 860,
            ReqPrefix = MainWindow.AttendReqPrefix, ReadyCmd = "attendWinReady", AnyCmdWithoutReq = true,
            Commands = MainWindow.AttendWinCommands, OpenFn = "__attendWinOpen", ActivatedFn = "__attendWinActivated",
            GetsCatalog = false, AskBeforeClose = true, ReuseOnClose = true, HiddenFn = "__attendWinHidden",
            GetBounds = s => s.Attend, SetBounds = (s, b) => s.Attend = b,
        };
        //  종류 등록. 새 종류는 여기에 더한다(번호 머리가 서로 겹치지 않아야 한다).
        public static readonly IReadOnlyList<WinKind> All = new[] { Peer, Admin, Attend };

        //  요청 번호의 머리로 종류를 찾는다. 메인 창의 번호(머리 없음)면 null.
        public static WinKind? OfReq(string reqId) =>
            string.IsNullOrEmpty(reqId) ? null : All.FirstOrDefault(k => reqId.StartsWith(k.ReqPrefix, StringComparison.Ordinal));

        //  번호 없이 받아도 되는 명령인가. 열람 창은 준비 알림 하나, 관리 창과 근태 창은 허용 목록 전부(회신 없는 명령이 있다).
        public bool AcceptsWithoutReq(string cmd) => AnyCmdWithoutReq || cmd == ReadyCmd;
    }

    // ============ 따로 뜨는 창(WINDOW-UI §4, ADMIN-WINDOW) ============
    //  메인 창 안의 모달이던 화면(열람, 관리)을 따로 뜨는 창으로 옮겼다. 창 크기를 사람이 정하게 하려는 것이다.
    //  - 일반 Windows 창 테두리(최소화, 최대화, 닫기)를 쓴다. Owner 를 두지 않는다: 메인 창과 따로 최소화하고, 다른 모니터로
    //    옮길 수 있고, 작업 표시줄에 따로 뜬다. 메인 창을 트레이로 숨겨도 이 창은 그대로다.
    //  - 종류마다 창은 하나다. 메인 창의 입구가 다시 부르면 MainWindow.ShowWin 이 이 창을 앞으로 가져와 대상만 바꾼다.
    //  - WebView2 는 메인 창과 **같은 환경**(같은 사용자 데이터 폴더)과 같은 가상 호스트(tcapp.local)를 쓴다.
    //    그래서 localStorage(즐겨찾기, 최근 본 사람, 테마, 관리 화면의 마지막 항목 등)가 창들에 하나다.
    //  - 같은 HTML 을 종류의 모드(?peerwin=1, ?win=admin)로 띄운다. 그 모드는 자기 화면만 그리고 내 달력을 부팅하지 않는다.
    //  - 웹 메시지는 메인 창과 같은 처리기(MainWindow.OnWebMessage)로 간다. 거기서 그 종류의 허용 목록만 받는다.
    //    사람(보는 사람, 관리자)은 그 처리기가 요청마다 호스트 세션에서 읽는다(웹이 정하지 않는다).
    //  - 크기와 위치는 종류마다 PC 에 하나 기억한다(widget.settings.json 의 Peer, Admin, Attend). 닫을 때 MainWindow.RememberWinBounds 로 넘긴다.
    internal sealed class AppWindow : Window
    {
        private readonly MainWindow _host;
        private readonly CoreWebView2Environment _env;
        private readonly string _appDir;
        private readonly WebView2 _web = new();
        private bool _ready;                 // 웹이 준비 알림(Kind.ReadyCmd)을 보냈다(대상을 받을 수 있다)
        private string _pending = "";        // 웹에 넘길 대상(JSON). 준비 전에 오면 여기 두었다가 준비되면 넘긴다
        private WindowState _shownState;     // 최소화 직전 상태(되살릴 때 최대화였으면 최대화로)
        private bool _dark;                  // 제목줄을 어둡게(다크 테마)
        private bool _closeOk;               // 묻지 않고 닫는다(웹이 확인했다, 로그아웃, 앱 종료). AskBeforeClose 종류만 본다
        private bool _asking;                // 닫아도 되는지 웹에 묻는 중
        private bool _closed;                // 창이 닫혔다(Closed). 닫힌 창은 다시 쓰지 않는다(MainWindow.WinOf 가 참조를 비운다)
        private Border? _cover;              // ReuseOnClose 종류: 웹이 준비되기 전 "불러오는 중" 겹침(WPF 로 그린다)
        private ProgressBar? _coverBar;

        public WinKind Kind { get; }
        public bool IsClosed => _closed;
        public bool IsReady => _ready;

        //  닫히는 중이거나 없앤(Dispose) 창에서는 CoreWebView2 를 읽으면 던질 수 있다. 그때는 null(회신과 메시지 가르기가 버린다).
        public CoreWebView2? Core
        {
            get { try { return _web.CoreWebView2; } catch { return null; } }
        }

        public AppWindow(MainWindow host, WinKind kind, CoreWebView2Environment env, string appDir, Rect bounds, bool maximized, bool dark)
        {
            _host = host;
            Kind = kind;
            _env = env;
            _appDir = appDir;
            Title = kind.Title;
            WindowStyle = WindowStyle.SingleBorderWindow;
            ResizeMode = ResizeMode.CanResize;
            ShowInTaskbar = true;
            MinWidth = kind.MinWidth;
            MinHeight = kind.MinHeight;
            Icon = host.Icon;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = bounds.Left; Top = bounds.Top; Width = bounds.Width; Height = bounds.Height;
            //  Show 전에 정하면 최대화로 열리고, 복원하면 bounds 로 돌아온다(RestoreBounds).
            if (maximized) WindowState = WindowState.Maximized;
            _shownState = WindowState;
            //  웹이 그리기 전의 빈 바탕. 다크 테마면 흰 번쩍임이 없게 어둡게 둔다(테마는 알림 동기화가 알려 준 값).
            _dark = dark;
            var bg = dark ? Color.FromRgb(0x0f, 0x14, 0x20) : Color.FromRgb(0xf3, 0xf4, 0xf7);   // 앱의 --bg(다크, 라이트)
            Background = new SolidColorBrush(bg);
            _web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(bg.R, bg.G, bg.B);
            if (kind.ReuseOnClose) BuildCover(bg, dark);
            else Content = _web;

            SourceInitialized += (_, _) => SetDark(_dark);
            Loaded += async (_, _) => await InitAsync();
            StateChanged += (_, _) => { if (WindowState != WindowState.Minimized) _shownState = WindowState; };
            //  앞으로 올 때마다 웹에 알린다(열람 창: 메인 창에서 방금 고친 내 일정이 겹에 반영된다. 웹이 peerMine 을 다시 묻는다).
            Activated += (_, _) => { if (Kind.ActivatedFn.Length > 0) Js("window." + Kind.ActivatedFn + " && window." + Kind.ActivatedFn + "()"); };
            Closing += (_, e) =>
            {
                //  관리 창과 근태 창: 창 테두리의 ✕, Alt+F4, 작업 표시줄의 닫기는 먼저 웹에 묻는다(저장 안 한 입력, ADMIN-WINDOW §2.2, ATTENDANCE-PLAN §2.4).
                //  웹이 아직 뜨지 않았으면 물을 곳이 없으니 그냥 닫는다.
                if (Kind.AskBeforeClose && !_closeOk && _ready && Core != null)
                {
                    e.Cancel = true;
                    _ = AskCloseAsync();
                    return;
                }
                SaveBounds();
            };
            Closed += (_, _) => { _closed = true; try { _web.Dispose(); } catch { } };
        }

        //  최대화나 최소화 중이면 RestoreBounds 가 평소 창 자리다. 최소화로 닫았으면 그 직전 상태를 최대화 여부로 쓴다.
        private void SaveBounds()
        {
            var r = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
            _host.RememberWinBounds(Kind, r, _shownState == WindowState.Maximized);
        }

        //  처음 열 때의 로딩 표시. 웹이 준비되기 전에는 WebView2 를 창 밖으로 밀어 두고(HWND 가 WPF 겹침을 가린다) 메인 창 시작 표시(loadingBar)와 같은 모양을 보인다.
        //  ★ Visibility 로 숨기면 안 된다. 숨긴 웹은 화면 읽기가 열 배 가까이 느려진다(실측 2.2초 대 0.2초). 크기는 그대로 두고 자리만 민다.
        private void BuildCover(Color bg, bool dark)
        {
            var text = new TextBlock
            {
                Text = "불러오는 중…", FontFamily = new FontFamily("Malgun Gothic"), FontSize = 12,
                Foreground = new SolidColorBrush(dark ? Color.FromRgb(0xA9, 0xB4, 0xC8) : Color.FromRgb(0x5B, 0x63, 0x73)),
                HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 14),
            };
            _coverBar = new ProgressBar
            {
                IsIndeterminate = true, Width = 150, Height = 3, BorderThickness = new Thickness(0),
                Foreground = new SolidColorBrush(Color.FromRgb(0x37, 0x8A, 0xDD)),
                Background = new SolidColorBrush(dark ? Color.FromRgb(0x24, 0x30, 0x49) : Color.FromRgb(0xF1, 0xEF, 0xE8)),
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            stack.Children.Add(text);
            stack.Children.Add(_coverBar);
            _cover = new Border { Background = new SolidColorBrush(bg), IsHitTestVisible = false, Child = stack };
            _web.Margin = new Thickness(-30000, 0, 30000, 0);
            var grid = new Grid();
            grid.Children.Add(_web);
            grid.Children.Add(_cover);
            Content = grid;
        }

        //  로딩 표시를 걷고 웹을 보인다(시각 트리에서 내려 애니메이션 타이머도 멈춘다).
        private void RevealWeb()
        {
            if (_cover == null) return;
            try
            {
                if (_coverBar != null) _coverBar.IsIndeterminate = false;
                _cover.Visibility = Visibility.Collapsed;
                _web.Margin = new Thickness(0);
            }
            catch { }
            _cover = null;
        }

        private async Task InitAsync()
        {
            try
            {
                await _web.EnsureCoreWebView2Async(_env);
                var core = _web.CoreWebView2;
                var s = core.Settings;   // 메인 창과 같은 설정(개발자 도구, 기본 메뉴, 확대, 브라우저 단축키 끔)
                s.AreDevToolsEnabled = false;
                s.AreDefaultContextMenusEnabled = false;
                s.IsStatusBarEnabled = false;
                s.AreBrowserAcceleratorKeysEnabled = false;
                s.IsZoomControlEnabled = false;
                core.WebMessageReceived += (_, e) => _host.OnWinWebMessage(e, core);
                //  열람 창: 창 제목 = 웹 문서 제목('<이름> 님의 일정'). 열람 창 안에서 사람을 바꿔도 따라간다.
                //  관리 창: 제목은 "수행과제 캘린더 관리" 그대로다(ADMIN-WINDOW §2.4).
                if (Kind.TitleFollowsDocument)
                {
                    core.DocumentTitleChanged += (_, _) =>
                    {
                        string t = core.DocumentTitle ?? "";
                        if (t.Trim().Length > 0) Title = t;
                    };
                }
                //  새 창 열기(링크 등)는 막는다. 이 창은 자기 화면 하나만 띄운다.
                core.NewWindowRequested += (_, e) => e.Handled = true;
                //  웹의 window.close() = 창 닫기. 버전 관문 차단 카드의 [이 창 닫기](VERSION-GATE §3)와, 관리 창이 닫기를 확인한 뒤에 쓴다.
                //  웹이 이미 확인했으므로 다시 묻지 않는다(CloseNow).
                core.WindowCloseRequested += (_, _) => Dispatcher.BeginInvoke(new Action(CloseByUser));
                core.ProcessFailed += (_, e) => OnProcessFailed(core, e.ProcessFailedKind);
                core.SetVirtualHostNameToFolderMapping("tcapp.local", _appDir, CoreWebView2HostResourceAccessKind.Allow);
                core.Navigate(Kind.Url);
            }
            catch (Exception ex)
            {
                _host.WinLog(Kind.Name + " WebView2 초기화 실패: " + ex.Message);
                CloseNow();
            }
        }

        //  WebView2 프로세스가 죽었다. 그리는 프로세스(렌더러)면 다시 읽는다(웹이 준비를 다시 알리면 마지막 대상을 다시 넘긴다).
        //  브라우저 프로세스면 이 CoreWebView2 는 더 쓸 수 없어 창을 닫는다(다시 고르면 새로 연다). 그 밖(GPU 등)은 WebView2 가 스스로 되살린다.
        private void OnProcessFailed(CoreWebView2 core, CoreWebView2ProcessFailedKind kind)
        {
            _host.WinLog(Kind.Name + " WebView2 프로세스 실패: " + kind);
            //  숨겨 둔 창(ReuseOnClose)은 어떤 실패든 다시 읽지 않고 버린다. 다음 열기 때 새로 만든다(WINDOW-INPAGE §4).
            if (Kind.ReuseOnClose && !IsVisible)
            {
                Dispatcher.BeginInvoke(new Action(CloseNow));
                return;
            }
            if (kind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                Dispatcher.BeginInvoke(new Action(CloseNow));
                return;
            }
            if (kind == CoreWebView2ProcessFailedKind.RenderProcessExited || kind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
            {
                _ready = false;   // 다시 읽은 웹이 준비를 알릴 때까지 대상을 쥐고 있는다
                try { core.Reload(); } catch (Exception ex) { _host.WinLog(Kind.Name + " 다시 읽기 실패: " + ex.Message); }
            }
        }

        //  관리 창의 닫기 확인. 웹(window.__winCloseRequest)이 답한다:
        //    'close' = 닫아도 된다(지금 닫는다), 'ask' = 저장 안 한 입력이 있어 확인 창을 띄웠다(사용자가 [닫기]를 누르면
        //    웹이 window.close() 를 부르고 WindowCloseRequested 가 닫는다), 'busy' = 저장 중이라 닫지 않는다(웹이 안내한다).
        //  ★ 웹이 3초 안에 답하지 않으면(멈춤, 오류) 닫는다. 닫을 수 없는 창을 남기지 않는다.
        private async Task AskCloseAsync()
        {
            if (_asking) return;
            _asking = true;
            string ans = "close";
            try
            {
                var core = Core;
                if (core != null)
                {
                    var t = core.ExecuteScriptAsync("(function(){try{return window.__winCloseRequest?String(window.__winCloseRequest()):'close';}catch(e){return 'close';}})()");
                    if (await Task.WhenAny(t, Task.Delay(3000)) == t) ans = t.Result ?? "";
                }
            }
            catch { ans = "close"; }
            finally { _asking = false; }
            if (ans.Contains("ask") || ans.Contains("busy")) return;
            CloseByUser();
        }

        //  사용자가 닫았다(웹이 확인했다). ReuseOnClose 종류는 없애지 않고 숨긴다. 그 밖은 닫는다.
        private void CloseByUser()
        {
            if (Kind.ReuseOnClose) HideForReuse();
            else CloseNow();
        }

        //  숨기기. 자리를 먼저 남기고(숨기면 Closing 이 안 돈다), 웹 화면을 비운 뒤 Hide 한다. 실패하면 이 창을 버린다(다음 열기 때 새로 만든다).
        private void HideForReuse()
        {
            if (_closed || !IsVisible) return;
            try
            {
                SaveBounds();
                if (Kind.HiddenFn.Length > 0) Js("window." + Kind.HiddenFn + " && window." + Kind.HiddenFn + "()");
                _pending = "";
                _host.WinHidden(Kind);
                Hide();
            }
            catch (Exception ex)
            {
                _host.WinLog(Kind.Name + " 숨기기 실패, 창을 버림: " + ex.Message);
                CloseNow();
            }
        }

        //  묻지 않고 진짜로 닫는다(로그아웃, 계정 바뀜, 앱 종료, WebView2 실패, 처음 뜨기 전의 닫기). 숨겨 둔 근태 창도 여기서 닫힌다. 닫히면서 자리를 남긴다(Closing).
        public void CloseNow()
        {
            _closeOk = true;
            try { Close(); } catch { }
        }

        //  대상을 넘긴다(JSON. 열람 창: {loginId, name, me}, 관리 창: {item, me}, 근태 창: 메인 창이 만든 payload). 웹이 아직 준비 전이면 준비될 때 넘긴다.
        public void ShowTarget(string json)
        {
            _pending = json;
            if (_ready) _ = PushAsync();
        }

        //  웹이 준비를 알렸다. 페이지를 다시 읽었어도 마지막 대상을 다시 넘긴다.
        public void OnWebReady()
        {
            _ready = true;
            if (_pending.Length > 0) _ = PushAsync();
            else RevealWeb();
        }

        //  대상을 넣고 끝나면 로딩 표시를 걷는다(웹이 그려진 뒤에 걷어 "불러오는 중"에서 바로 내용으로 바뀐다). 끝난 시각은 열기 시각 로그에 남는다.
        private async Task PushAsync()
        {
            try
            {
                var core = Core;
                if (core != null)
                    await core.ExecuteScriptAsync("window." + Kind.OpenFn + " && window." + Kind.OpenFn + "(" + _pending + ")");
            }
            catch { }
            RevealWeb();
            _host.TraceOpenReady(Kind);
        }

        //  앞으로 가져온다. 최소화돼 있으면 최소화 직전 상태(최대화 또는 평소)로 되살린다.
        //  Topmost 는 메인 창의 맨 앞에 띄우기를 따른다(켜고 끌 때는 MainWindow.SyncWinTopmost 가 맞춘다).
        public void BringToFront()
        {
            if (!IsVisible) Show();
            if (WindowState == WindowState.Minimized) WindowState = _shownState == WindowState.Maximized ? WindowState.Maximized : WindowState.Normal;
            Topmost = _host.FrontActive;   // 메인 창이 맨 앞에 떠 있으면 이 창도 맨 위 띠에 둔다(메인 창 뒤에 깔리지 않게)
            Activate();
        }

        //  제목줄 색을 앱 테마에 맞춘다(Windows 10 20H1 이상의 DWMWA_USE_IMMERSIVE_DARK_MODE = 20). 지원하지 않으면 그대로다.
        public void SetDark(bool dark)
        {
            _dark = dark;
            var h = new WindowInteropHelper(this).Handle;
            if (h == IntPtr.Zero) return;
            int v = dark ? 1 : 0;
            try { DwmSetWindowAttribute(h, 20, ref v, sizeof(int)); } catch { }
        }

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        private void Js(string js)
        {
            try { _ = _web.CoreWebView2?.ExecuteScriptAsync(js); } catch { }
        }
    }
}
