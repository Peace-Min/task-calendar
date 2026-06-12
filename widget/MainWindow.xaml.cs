using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace TaskCalendarWidget
{
    public partial class MainWindow : Window
    {
        private readonly string _dataDir;
        private readonly string _dataFile;
        private readonly string _settingsFile;
        private readonly string _webviewDir;
        private readonly string _logFile;

        private WidgetSettings _settings = new();
        private RECT _gestureRect;   // 이동/리사이즈 시작 시점의 창 물리 좌표
        private bool _desktopApplied = false;   // 바탕화면 모드 1회 적용 플래그

        private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValueName = "TaskCalendarWidget";

        public MainWindow()
        {
            InitializeComponent();

            // 비클라이언트(리사이즈) 테두리를 0으로 → 클라이언트=창 전체(WebView2가 꽉 채워 검은 테두리 없음).
            // ResizeMode=CanResize라 프로그램적 SetWindowPos 리사이즈가 허용됨(NoResize는 크기를 고정해 막음).
            WindowChrome.SetWindowChrome(this, new WindowChrome
            {
                CaptionHeight = 0,
                CornerRadius = new CornerRadius(0),
                GlassFrameThickness = new Thickness(0),
                ResizeBorderThickness = new Thickness(0),
                UseAeroCaptionButtons = false
            });

            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            _dataDir = Path.Combine(appData, "TaskCalendar");
            _dataFile = Path.Combine(_dataDir, "data.xml");
            _settingsFile = Path.Combine(_dataDir, "widget.settings.json");
            _webviewDir = Path.Combine(_dataDir, "WebView2");
            _logFile = Path.Combine(_dataDir, "widget.log");

            LoadSettings();
            ApplyWindowBounds();
        }

        // ============ 설정 ============
        private void LoadSettings()
        {
            try
            {
                if (File.Exists(_settingsFile))
                {
                    var s = JsonSerializer.Deserialize<WidgetSettings>(File.ReadAllText(_settingsFile, Encoding.UTF8));
                    if (s != null) _settings = s;
                }
            }
            catch (Exception ex) { Debug.WriteLine("설정 로드 오류: " + ex); }
        }

        // 현재 창의 실제 물리 좌표(GetWindowRect)를 DIP로 환산해 저장 → 고정/플로팅 모두 정확
        private void SaveSettings()
        {
            try
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                if (hwnd != IntPtr.Zero && GetWindowRect(hwnd, out RECT r))
                {
                    var dpi = VisualTreeHelper.GetDpi(this);
                    _settings.Left = r.Left / dpi.DpiScaleX;
                    _settings.Top = r.Top / dpi.DpiScaleY;
                    _settings.Width = (r.Right - r.Left) / dpi.DpiScaleX;
                    _settings.Height = (r.Bottom - r.Top) / dpi.DpiScaleY;
                }
                Directory.CreateDirectory(_dataDir);
                File.WriteAllText(_settingsFile,
                    JsonSerializer.Serialize(_settings, new JsonSerializerOptions { WriteIndented = true }),
                    new UTF8Encoding(false));
            }
            catch (Exception ex) { Debug.WriteLine("설정 저장 오류: " + ex); }
        }

        private void ApplyWindowBounds()
        {
            if (_settings.Width >= MinWidth) Width = _settings.Width;
            if (_settings.Height >= MinHeight) Height = _settings.Height;

            if (!double.IsNaN(_settings.Left) && !double.IsNaN(_settings.Top))
            {
                double vl = SystemParameters.VirtualScreenLeft, vt = SystemParameters.VirtualScreenTop;
                double vr = vl + SystemParameters.VirtualScreenWidth, vb = vt + SystemParameters.VirtualScreenHeight;
                Left = Math.Min(Math.Max(_settings.Left, vl), Math.Max(vl, vr - Width));
                Top = Math.Min(Math.Max(_settings.Top, vt), Math.Max(vt, vb - Height));
            }
            else
            {
                var wa = SystemParameters.WorkArea;
                Left = wa.Right - Width - 16;
                Top = wa.Bottom - Height - 16;
            }
        }

        private void ResetBounds()
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero) return;
            var dpi = VisualTreeHelper.GetDpi(this);
            var wa = SystemParameters.WorkArea;
            int w = (int)(380 * dpi.DpiScaleX), h = (int)(470 * dpi.DpiScaleY);
            int x = (int)((wa.Right - 380 - 16) * dpi.DpiScaleX);
            int y = (int)((wa.Bottom - 470 - 16) * dpi.DpiScaleY);
            SetWindowPos(hwnd, IntPtr.Zero, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
            SaveSettings();
        }

        private void SetSize(double w, double h)
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero) return;
            var dpi = VisualTreeHelper.GetDpi(this);
            SetWindowPos(hwnd, IntPtr.Zero, 0, 0, (int)(w * dpi.DpiScaleX), (int)(h * dpi.DpiScaleY),
                SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
            SaveSettings();
        }

        // ============ WebView2 + 브리지 ============
        private async void Window_Loaded(object sender, RoutedEventArgs e)
        {
            bool firstRun = _settings.FirstRun;
            try { Directory.CreateDirectory(_dataDir); File.WriteAllText(_logFile, ""); } catch { }
            Log($"=== 시작 v1.0.0 === pinned={_settings.Pinned} firstRun={firstRun}");

            if (firstRun)
            {
                // 최초 실행 시 1회만 묻는다(묻지 않고 자동 등록하지 않음). 이후 ⚙에서 변경.
                var ans = MessageBox.Show(
                    "Windows를 켤 때 이 위젯을 자동으로 실행할까요?\n\n나중에 ⚙(설정) 메뉴에서 언제든 바꿀 수 있습니다.",
                    "수행과제 캘린더 — 자동 시작 설정",
                    MessageBoxButton.YesNo, MessageBoxImage.Question);
                bool on = ans == MessageBoxResult.Yes;
                SetAutoStart(on);
                _settings.AutoStart = on;
                _settings.FirstRun = false;
                SaveSettings();
                Log("최초 실행 자동시작 선택: " + on);
            }

            try
            {
                web.DefaultBackgroundColor = System.Drawing.Color.White;
                Directory.CreateDirectory(_webviewDir);

                string ver = "";
                try { ver = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
                catch (Exception vx) { Log("런타임 조회 예외: " + vx.Message); }
                Log("WebView2 런타임: " + (string.IsNullOrEmpty(ver) ? "미설치/미탐지" : ver));
                if (string.IsNullOrEmpty(ver))
                    MessageBox.Show("이 PC에 WebView2 런타임이 없습니다.\nMicrosoft Edge WebView2(Evergreen) 런타임을 설치한 뒤 다시 실행하세요.",
                        "수행과제 캘린더", MessageBoxButton.OK, MessageBoxImage.Warning);

                // VM/원격데스크톱/그래픽 드라이버 환경의 '흰 화면' 방지 — GPU 가속/합성 끄기
                var opts = new CoreWebView2EnvironmentOptions
                {
                    AdditionalBrowserArguments = "--disable-gpu --disable-gpu-compositing --disable-features=msWebView2EnableDraggableRegions"
                };
                var env = await CoreWebView2Environment.CreateAsync(null, _webviewDir, opts);
                await web.EnsureCoreWebView2Async(env);
                Log("CoreWebView2 준비: " + web.CoreWebView2.Environment.BrowserVersionString);

                var s = web.CoreWebView2.Settings;
                s.AreDevToolsEnabled = false;
                s.AreDefaultContextMenusEnabled = false;
                s.IsStatusBarEnabled = false;
                s.AreBrowserAcceleratorKeysEnabled = false;
                s.IsZoomControlEnabled = false;

                web.CoreWebView2.WebMessageReceived += OnWebMessage;
                web.CoreWebView2.NavigationCompleted += (_, ev) =>
                {
                    Log($"NavigationCompleted: success={ev.IsSuccess} status={ev.WebErrorStatus}");
                    if (!_desktopApplied)
                    {
                        _desktopApplied = true;
                        ApplyDesktopMode();              // 렌더 완료 후 부착(렌더-우선 → 흰화면 회피)
                        if (firstRun) MoveToCursorMonitor();
                    }
                };
                string html = LoadHtml();
                Log($"NavigateToString 호출 (HTML {html.Length}자)");
                web.CoreWebView2.NavigateToString(html);
            }
            catch (Exception ex)
            {
                Log("초기화 예외: " + ex);
                MessageBox.Show("WebView2 초기화 실패:\n\n" + ex.Message + "\n\n로그: " + _logFile,
                    "수행과제 캘린더", MessageBoxButton.OK, MessageBoxImage.Error);
            }

            // 안전장치: NavigationCompleted가 안 와도 4초 뒤 부착 적용
            var t = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
            t.Tick += (_, _) =>
            {
                t.Stop();
                if (!_desktopApplied)
                {
                    _desktopApplied = true;
                    Log("타이머 폴백으로 부착 적용");
                    ApplyDesktopMode();
                    if (firstRun) MoveToCursorMonitor();
                }
            };
            t.Start();
        }

        private static string LoadHtml()
        {
            var asm = Assembly.GetExecutingAssembly();
            string? name = asm.GetManifestResourceNames()
                .FirstOrDefault(n => n.EndsWith("index.html", StringComparison.OrdinalIgnoreCase));
            if (name == null) throw new InvalidOperationException("임베디드 HTML 리소스(index.html)를 찾을 수 없습니다.");
            using var stream = asm.GetManifestResourceStream(name)!;
            using var reader = new StreamReader(stream, Encoding.UTF8);
            return reader.ReadToEnd();
        }

        private void Log(string msg)
        {
            try { Directory.CreateDirectory(_dataDir); File.AppendAllText(_logFile, DateTime.Now.ToString("HH:mm:ss.fff") + "  " + msg + Environment.NewLine); }
            catch { }
        }

        // 최초 실행 시 커서가 있는 모니터(주로 쓰는 화면)의 우하단에 배치
        private void MoveToCursorMonitor()
        {
            try
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                if (hwnd == IntPtr.Zero || !GetCursorPos(out POINT pt)) return;
                IntPtr mon = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
                var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
                if (!GetMonitorInfo(mon, ref mi)) return;
                GetWindowRect(hwnd, out RECT wr);
                int w = wr.Right - wr.Left, h = wr.Bottom - wr.Top;
                int x = mi.rcWork.Right - w - 16, y = mi.rcWork.Bottom - h - 16;
                SetWindowPos(hwnd, IntPtr.Zero, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                SaveSettings();
                Log($"커서 모니터로 이동 ({x},{y})");
            }
            catch (Exception ex) { Log("MoveToCursorMonitor 오류: " + ex.Message); }
        }

        // ⚙ 메뉴: 다음 모니터의 우하단으로 이동
        private void MoveToNextMonitor()
        {
            try
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                if (hwnd == IntPtr.Zero) return;
                var mons = new System.Collections.Generic.List<RECT>();
                EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr h, IntPtr hdc, ref RECT r, IntPtr d) =>
                {
                    var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
                    if (GetMonitorInfo(h, ref info)) mons.Add(info.rcWork);
                    return true;
                }, IntPtr.Zero);
                if (mons.Count < 2) { Log("모니터 1개 — 이동 안 함"); return; }
                var curMi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
                GetMonitorInfo(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), ref curMi);
                int idx = mons.FindIndex(m => m.Left == curMi.rcWork.Left && m.Top == curMi.rcWork.Top);
                var next = mons[(idx + 1) % mons.Count];
                GetWindowRect(hwnd, out RECT wr);
                int w = wr.Right - wr.Left, h = wr.Bottom - wr.Top;
                int x = next.Right - w - 16, y = next.Bottom - h - 16;
                SetWindowPos(hwnd, IntPtr.Zero, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                SaveSettings();
                Log($"다음 모니터로 이동 ({x},{y})");
            }
            catch (Exception ex) { Log("MoveToNextMonitor 오류: " + ex.Message); }
        }

        private static int GetInt(JsonDocument d, string key) =>
            d.RootElement.TryGetProperty(key, out var v) && v.TryGetInt32(out var n) ? n : 0;

        private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw;
            try { raw = e.TryGetWebMessageAsString(); }
            catch { return; }
            if (string.IsNullOrEmpty(raw)) return;

            try
            {
                using var doc = JsonDocument.Parse(raw);
                if (!doc.RootElement.TryGetProperty("cmd", out var cmdEl)) return;
                var hwnd = new WindowInteropHelper(this).Handle;

                switch (cmdEl.GetString())
                {
                    case "ready":
                        string xml = File.Exists(_dataFile) ? File.ReadAllText(_dataFile, Encoding.UTF8) : "";
                        _ = web.CoreWebView2.ExecuteScriptAsync("window.__applyXml(" + JsonSerializer.Serialize(xml) + ")");
                        SendPinState();
                        break;
                    case "save":
                        if (doc.RootElement.TryGetProperty("xml", out var xmlEl))
                            SaveData(xmlEl.GetString() ?? "");
                        break;

                    // ----- 이동 (부착 상태에서는 잠금) -----
                    case "dragbegin":
                        if (_settings.Pinned) break;
                        GetWindowRect(hwnd, out _gestureRect);
                        break;
                    case "dragmove":
                        if (_settings.Pinned) break;
                        SetWindowPos(hwnd, IntPtr.Zero,
                            _gestureRect.Left + GetInt(doc, "dx"), _gestureRect.Top + GetInt(doc, "dy"),
                            0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                        break;
                    case "dragend":
                        if (!_settings.Pinned) SaveSettings();
                        break;
                    // ----- 리사이즈 (부착/플로팅 모두 가능) -----
                    case "resizebegin":
                        GetWindowRect(hwnd, out _gestureRect);
                        break;
                    case "resizemove":
                        {
                            var dpi = VisualTreeHelper.GetDpi(this);
                            int minW = (int)(MinWidth * dpi.DpiScaleX), minH = (int)(MinHeight * dpi.DpiScaleY);
                            int cx = Math.Max(minW, (_gestureRect.Right - _gestureRect.Left) + GetInt(doc, "dx"));
                            int cy = Math.Max(minH, (_gestureRect.Bottom - _gestureRect.Top) + GetInt(doc, "dy"));
                            SetWindowPos(hwnd, IntPtr.Zero, 0, 0, cx, cy, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
                        }
                        break;
                    case "resizeend":
                        SaveSettings();
                        break;

                    case "menu": ShowSettingsMenu(); break;
                    case "pin": TogglePin(); break;
                    case "close": Application.Current.Shutdown(); break;
                }
            }
            catch (Exception ex) { Debug.WriteLine("웹 메시지 처리 오류: " + ex); }
        }

        private void SendPinState()
        {
            try
            {
                _ = web.CoreWebView2?.ExecuteScriptAsync(
                    "window.__setPinned && window.__setPinned(" + (_settings.Pinned ? "true" : "false") + ")");
            }
            catch { }
        }

        private void SaveData(string xml)
        {
            try
            {
                Directory.CreateDirectory(_dataDir);
                string tmp = _dataFile + ".tmp";
                File.WriteAllText(tmp, xml, new UTF8Encoding(false));
                File.Move(tmp, _dataFile, true);
            }
            catch (Exception ex) { Debug.WriteLine("데이터 저장 오류: " + ex); }
        }

        private void TogglePin()
        {
            _settings.Pinned = !_settings.Pinned;
            ApplyDesktopMode();
            SaveSettings();
            SendPinState();
        }

        private void ShowSettingsMenu()
        {
            var menu = new ContextMenu();

            var pin = new MenuItem { Header = "바탕화면에 부착", IsCheckable = true, IsChecked = _settings.Pinned };
            pin.Click += (_, _) => TogglePin();

            var size = new MenuItem { Header = "크기 프리셋" };
            (string label, double w, double h)[] presets =
            {
                ("작게 (360 × 470)", 360, 470),
                ("보통 (440 × 560)", 440, 560),
                ("크게 (560 × 680)", 560, 680),
                ("와이드 (900 × 640)", 900, 640),
            };
            foreach (var ps in presets)
            {
                var mi = new MenuItem { Header = ps.label };
                mi.Click += (_, _) => SetSize(ps.w, ps.h);
                size.Items.Add(mi);
            }

            var auto = new MenuItem { Header = "Windows 시작 시 자동 실행", IsCheckable = true, IsChecked = IsAutoStart() };
            auto.Click += (_, _) =>
            {
                bool on = !IsAutoStart();
                SetAutoStart(on);
                _settings.AutoStart = on;
                SaveSettings();
            };

            var nextMon = new MenuItem { Header = "다른 모니터로 이동" };
            nextMon.Click += (_, _) => MoveToNextMonitor();

            var reset = new MenuItem { Header = "위치·크기 초기화" };
            reset.Click += (_, _) => ResetBounds();

            var quit = new MenuItem { Header = "위젯 종료" };
            quit.Click += (_, _) => Application.Current.Shutdown();

            menu.Items.Add(pin);
            menu.Items.Add(size);
            menu.Items.Add(nextMon);
            menu.Items.Add(auto);
            menu.Items.Add(reset);
            menu.Items.Add(new Separator());
            menu.Items.Add(quit);

            menu.Placement = System.Windows.Controls.Primitives.PlacementMode.Mouse;
            menu.IsOpen = true;
        }

        // ============ 바탕화면 부착 ============
        private void Window_SourceInitialized(object? sender, EventArgs e)
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            int ex = GetWindowLong(hwnd, GWL_EXSTYLE);
            SetWindowLong(hwnd, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW);
        }

        // 바탕화면 배치: 창을 Progman 자식으로 reparent하면 일부 환경(VM/RDP/그래픽 제한)에서
        // WebView2가 흰 화면이 됨이 확인됨 → reparent하지 않고 '톱레벨 최하위'로 앱들 뒤(바탕화면 레이어)에 둔다.
        // (멀티 모니터 자유 배치도 가능해짐. 📌는 이동 잠금 역할.)
        private void ApplyDesktopMode()
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero) return;
            SetParent(hwnd, IntPtr.Zero);   // 항상 톱레벨 (reparent 안 함 → 렌더 안전)
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            Log("바탕화면 모드 적용(톱레벨 최하위)");
        }

        private void Window_Deactivated(object? sender, EventArgs e)
        {
            // 다른 창을 클릭해 비활성화되면 다시 최하위로 보내 바탕화면 뒤에 유지
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero) return;
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        private void Window_Closing(object? sender, System.ComponentModel.CancelEventArgs e) => SaveSettings();

        // ============ 자동 시작 ============
        private static string ExePath =>
            Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName ?? "";

        private static bool IsAutoStart()
        {
            try { using var k = Registry.CurrentUser.OpenSubKey(RunKeyPath); return k?.GetValue(RunValueName) != null; }
            catch { return false; }
        }

        private static void SetAutoStart(bool on)
        {
            try
            {
                using var k = Registry.CurrentUser.OpenSubKey(RunKeyPath, true)
                              ?? Registry.CurrentUser.CreateSubKey(RunKeyPath);
                if (k == null) return;
                if (on) k.SetValue(RunValueName, "\"" + ExePath + "\"");
                else k.DeleteValue(RunValueName, false);
            }
            catch (Exception ex) { Debug.WriteLine("자동 시작 설정 오류: " + ex); }
        }

        // ============ Win32 ============
        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_TOOLWINDOW = 0x00000080;
        private static readonly IntPtr HWND_BOTTOM = new(1);
        private const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010;

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        // ----- 멀티 모니터 -----
        [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] private struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
        private const uint MONITOR_DEFAULTTONEAREST = 2;
        private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT lprc, IntPtr data);
        [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT pt);
        [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
        [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
        [DllImport("user32.dll")] private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
        [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);
        [DllImport("user32.dll", SetLastError = true, EntryPoint = "GetWindowLongPtr")]
        private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll", SetLastError = true, EntryPoint = "GetWindowLong")]
        private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll", SetLastError = true, EntryPoint = "SetWindowLongPtr")]
        private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
        [DllImport("user32.dll", SetLastError = true, EntryPoint = "SetWindowLong")]
        private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

        private static int GetWindowLong(IntPtr hWnd, int nIndex) =>
            IntPtr.Size == 8 ? (int)GetWindowLongPtr64(hWnd, nIndex) : GetWindowLong32(hWnd, nIndex);

        private static void SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong)
        {
            if (IntPtr.Size == 8) SetWindowLongPtr64(hWnd, nIndex, new IntPtr(dwNewLong));
            else SetWindowLong32(hWnd, nIndex, dwNewLong);
        }
    }

    public class WidgetSettings
    {
        public double Left { get; set; } = double.NaN;
        public double Top { get; set; } = double.NaN;
        public double Width { get; set; } = 380;
        public double Height { get; set; } = 470;
        public bool AutoStart { get; set; } = true;
        public bool FirstRun { get; set; } = true;
        public bool Pinned { get; set; } = true;
    }
}
