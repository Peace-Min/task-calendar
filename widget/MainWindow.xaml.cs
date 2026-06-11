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

        private WidgetSettings _settings = new();
        private RECT _gestureRect;   // 이동/리사이즈 시작 시점의 창 물리 좌표

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
            if (_settings.FirstRun)
            {
                SetAutoStart(true);
                _settings.AutoStart = true;
                _settings.FirstRun = false;
                SaveSettings();
            }

            try
            {
                web.DefaultBackgroundColor = System.Drawing.Color.White;
                Directory.CreateDirectory(_webviewDir);
                var env = await CoreWebView2Environment.CreateAsync(null, _webviewDir);
                await web.EnsureCoreWebView2Async(env);

                var s = web.CoreWebView2.Settings;
                s.AreDevToolsEnabled = false;
                s.AreDefaultContextMenusEnabled = false;
                s.IsStatusBarEnabled = false;
                s.AreBrowserAcceleratorKeysEnabled = false;
                s.IsZoomControlEnabled = false;

                web.CoreWebView2.WebMessageReceived += OnWebMessage;
                web.CoreWebView2.NavigateToString(LoadHtml());
            }
            catch (Exception ex)
            {
                MessageBox.Show("WebView2 초기화에 실패했습니다.\n\n" + ex.Message,
                    "수행과제 캘린더", MessageBoxButton.OK, MessageBoxImage.Error);
            }

            ApplyDesktopMode();
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

            var reset = new MenuItem { Header = "위치·크기 초기화" };
            reset.Click += (_, _) => ResetBounds();

            var quit = new MenuItem { Header = "위젯 종료" };
            quit.Click += (_, _) => Application.Current.Shutdown();

            menu.Items.Add(pin);
            menu.Items.Add(size);
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

        private void ApplyDesktopMode()
        {
            if (_settings.Pinned) EmbedIntoDesktop();
            else FloatBottomMost();
        }

        private void EmbedIntoDesktop()
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero) return;
            try
            {
                IntPtr progman = FindWindow("Progman", null);
                if (progman == IntPtr.Zero) { FloatBottomMost(); return; }
                GetWindowRect(hwnd, out RECT r);
                SetParent(hwnd, progman);
                MoveWindow(hwnd, r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, true);
                SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
            catch (Exception ex)
            {
                Debug.WriteLine("바탕화면 임베드 실패 → 플로팅 폴백: " + ex);
                FloatBottomMost();
            }
        }

        private void FloatBottomMost()
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero) return;
            SetParent(hwnd, IntPtr.Zero);
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        private void Window_Deactivated(object? sender, EventArgs e)
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero) return;
            SetWindowPos(hwnd, _settings.Pinned ? HWND_TOP : HWND_BOTTOM,
                0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
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
        private static readonly IntPtr HWND_TOP = IntPtr.Zero;
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
