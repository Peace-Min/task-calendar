using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace TaskCalendarWidget
{
    // ============ 다른 사람 일정 보기 창(WINDOW-UI §4) ============
    //  메인 창 안의 모달(#peerModal)이던 열람 화면을 따로 뜨는 창으로 옮겼다. 창 크기를 사람이 정하게 하려는 것이다.
    //  · 일반 Windows 창 테두리(최소화, 최대화, 닫기)를 쓴다. Owner 를 두지 않는다: 메인 창과 따로 최소화하고, 다른 모니터로
    //    옮길 수 있고, 작업 표시줄에 따로 뜬다. 메인 창을 트레이로 숨겨도 이 창은 그대로다.
    //  · 창은 하나다. 메인 창에서 다른 사람을 고르면 MainWindow.OpenPeerWindow 가 이 창을 앞으로 가져와 대상만 바꾼다.
    //  · WebView2 는 메인 창과 **같은 환경**(같은 사용자 데이터 폴더)과 같은 가상 호스트(tcapp.local)를 쓴다.
    //    그래서 localStorage(즐겨찾기, 최근 본 사람, 테마, 보기 방식, 밀도)가 두 창에 하나다.
    //  · 같은 HTML 을 ?peerwin=1 로 띄운다. 그 모드는 열람 껍데기만 그리고 내 달력을 부팅하지 않는다.
    //  · 웹 메시지는 메인 창과 같은 처리기(MainWindow.OnWebMessage)로 간다. 거기서 읽기 명령 넷만 받는다.
    //    보는 사람은 그 처리기가 요청마다 호스트 세션에서 읽는다(웹이 정하지 않는다).
    //  · 크기와 위치는 PC 에 하나 기억한다(widget.settings.json 의 Peer). 닫을 때 MainWindow.RememberPeerBounds 로 넘긴다.
    internal sealed class PeerWindow : Window
    {
        private readonly MainWindow _host;
        private readonly CoreWebView2Environment _env;
        private readonly string _appDir;
        private readonly WebView2 _web = new();
        private bool _ready;                 // 웹이 peerWinReady 를 보냈다(__peerWinOpen 을 받을 수 있다)
        private string _pending = "";        // 웹에 넘길 대상(JSON). 준비 전에 오면 여기 두었다가 준비되면 넘긴다
        private WindowState _shownState;     // 최소화 직전 상태(되살릴 때 최대화였으면 최대화로)
        private bool _dark;                  // 제목줄을 어둡게(다크 테마)

        //  닫히는 중이거나 없앤(Dispose) 창에서는 CoreWebView2 를 읽으면 던질 수 있다. 그때는 null(회신과 메시지 가르기가 버린다).
        public CoreWebView2? Core
        {
            get { try { return _web.CoreWebView2; } catch { return null; } }
        }

        public PeerWindow(MainWindow host, CoreWebView2Environment env, string appDir, Rect bounds, bool maximized, bool dark)
        {
            _host = host;
            _env = env;
            _appDir = appDir;
            Title = "다른 사람 일정";
            WindowStyle = WindowStyle.SingleBorderWindow;
            ResizeMode = ResizeMode.CanResize;
            ShowInTaskbar = true;
            MinWidth = MainWindow.PeerMinWidth;
            MinHeight = MainWindow.PeerMinHeight;
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
            Content = _web;

            SourceInitialized += (_, _) => SetDark(_dark);
            Loaded += async (_, _) => await InitAsync();
            StateChanged += (_, _) => { if (WindowState != WindowState.Minimized) _shownState = WindowState; };
            //  앞으로 올 때마다 웹에 알린다. 메인 창에서 방금 고친 내 일정이 겹에 반영된다(웹이 peerMine 을 다시 묻는다).
            Activated += (_, _) => Js("window.__peerWinActivated && window.__peerWinActivated()");
            Closing += (_, _) =>
            {
                //  최대화나 최소화 중이면 RestoreBounds 가 평소 창 자리다. 최소화로 닫았으면 그 직전 상태를 최대화 여부로 쓴다.
                var r = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
                _host.RememberPeerBounds(r, _shownState == WindowState.Maximized);
            };
            Closed += (_, _) => { try { _web.Dispose(); } catch { } };
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
                core.WebMessageReceived += (_, e) => _host.OnPeerWebMessage(e, core);
                //  창 제목 = 웹 문서 제목('<이름> 님의 일정'). 열람 창 안에서 사람을 바꿔도 따라간다.
                core.DocumentTitleChanged += (_, _) =>
                {
                    string t = core.DocumentTitle ?? "";
                    if (t.Trim().Length > 0) Title = t;
                };
                //  새 창 열기(링크 등)는 막는다. 이 창은 열람 화면 하나만 띄운다.
                core.NewWindowRequested += (_, e) => e.Handled = true;
                //  웹의 window.close() = 창 닫기. 버전 관문 차단 카드의 [이 창 닫기]가 쓴다(VERSION-GATE §3). 닫는 길은 창 테두리의 ✕ 와 같다.
                core.WindowCloseRequested += (_, _) => Dispatcher.BeginInvoke(new Action(() => { try { Close(); } catch { } }));
                core.ProcessFailed += (_, e) => OnProcessFailed(core, e.ProcessFailedKind);
                core.SetVirtualHostNameToFolderMapping("tcapp.local", _appDir, CoreWebView2HostResourceAccessKind.Allow);
                core.Navigate("https://tcapp.local/index.html?peerwin=1");
            }
            catch (Exception ex)
            {
                _host.PeerLog("열람 창 WebView2 초기화 실패: " + ex.Message);
                try { Close(); } catch { }
            }
        }

        //  WebView2 프로세스가 죽었다. 그리는 프로세스(렌더러)면 다시 읽는다(웹이 peerWinReady 를 다시 보내면 마지막 대상을 다시 넘긴다).
        //  브라우저 프로세스면 이 CoreWebView2 는 더 쓸 수 없어 창을 닫는다(다시 고르면 새로 연다). 그 밖(GPU 등)은 WebView2 가 스스로 되살린다.
        private void OnProcessFailed(CoreWebView2 core, CoreWebView2ProcessFailedKind kind)
        {
            _host.PeerLog("열람 창 WebView2 프로세스 실패: " + kind);
            if (kind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                Dispatcher.BeginInvoke(new Action(() => { try { Close(); } catch { } }));
                return;
            }
            if (kind == CoreWebView2ProcessFailedKind.RenderProcessExited || kind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
            {
                _ready = false;   // 다시 읽은 웹이 준비를 알릴 때까지 대상을 쥐고 있는다
                try { core.Reload(); } catch (Exception ex) { _host.PeerLog("열람 창 다시 읽기 실패: " + ex.Message); }
            }
        }

        //  대상을 넘긴다(JSON: {loginId, name, me}). 웹이 아직 준비 전이면 준비될 때 넘긴다.
        public void ShowTarget(string json)
        {
            _pending = json;
            if (_ready) Push();
        }

        //  웹이 peerWinReady 를 보냈다. 페이지를 다시 읽었어도 마지막 대상을 다시 넘긴다.
        public void OnWebReady()
        {
            _ready = true;
            if (_pending.Length > 0) Push();
        }

        private void Push() => Js("window.__peerWinOpen && window.__peerWinOpen(" + _pending + ")");

        //  앞으로 가져온다. 최소화돼 있으면 최소화 직전 상태(최대화 또는 평소)로 되살린다.
        //  Topmost 는 메인 창의 맨 앞에 띄우기를 따른다(켜고 끌 때는 MainWindow.SyncPeerTopmost 가 맞춘다).
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
