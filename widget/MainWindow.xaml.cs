using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
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

        private System.Windows.Forms.NotifyIcon? _tray;   // 옵션 트레이 아이콘 (DisposeTray가 멱등이라 별도 플래그 불필요)
        private bool _focusMode = false;                  // 넓게 보기(일시 맨앞·확대) 활성 여부
        private RECT _preFocusRect;                       // 넓게 보기 진입 전 창 물리 좌표
        private Window? _scrim;                            // 넓게 보기 딤 배경 창

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
            ApplyWindowIcon();   // 작업표시줄/Alt+Tab 버튼 브랜드 아이콘(트레이 모드 노출 시 빈 아이콘 방지)
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
            Log($"=== 시작 v1.0.0 === pinned={_settings.Pinned} firstRun={firstRun} tray={_settings.TrayEnabled}");
            if (_settings.TrayEnabled) EnsureTray();   // 설정돼 있으면 트레이 아이콘 생성

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

        private static string GetStr(JsonDocument d, string key) =>
            d.RootElement.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";

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
                        SendTrayState();
                        SendFocusState();
                        break;
                    case "save":
                        if (doc.RootElement.TryGetProperty("xml", out var xmlEl))
                            SaveData(xmlEl.GetString() ?? "");
                        break;
                    case "backupdata":   // 손상된 data.xml 보존(웹이 파싱 실패 시 요청 — 덮어쓰기 전 백업)
                        try
                        {
                            if (File.Exists(_dataFile)) File.Copy(_dataFile, _dataFile + ".bak", true);
                            Log("data.xml → data.xml.bak 백업(파싱 실패 보호)");
                        }
                        catch (Exception bx) { Log("백업 실패: " + bx.Message); }
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
                            int dx = GetInt(doc, "dx"), dy = GetInt(doc, "dy");
                            string edge = GetStr(doc, "edge");
                            if (string.IsNullOrEmpty(edge)) edge = "se";   // 구버전(그립=우하단) 호환
                            int left = _gestureRect.Left, top = _gestureRect.Top, right = _gestureRect.Right, bottom = _gestureRect.Bottom;
                            if (edge.Contains("e")) right = _gestureRect.Right + dx;   // 끄는 변만 이동(반대편 고정)
                            if (edge.Contains("w")) left  = _gestureRect.Left + dx;
                            if (edge.Contains("s")) bottom = _gestureRect.Bottom + dy;
                            if (edge.Contains("n")) top   = _gestureRect.Top + dy;
                            if (right - left < minW) { if (edge.Contains("w")) left = right - minW; else right = left + minW; }
                            if (bottom - top < minH) { if (edge.Contains("n")) top = bottom - minH; else bottom = top + minH; }
                            SetWindowPos(hwnd, IntPtr.Zero, left, top, right - left, bottom - top, SWP_NOZORDER | SWP_NOACTIVATE);
                        }
                        break;
                    case "resizeend":
                        SaveSettings();
                        break;

                    // ----- Git 커밋 연동 (과제별 저장소에서 내 커밋 읽기) -----
                    case "gitlog":
                    {
                        string reqId = GetStr(doc, "reqId"), repo = GetStr(doc, "repo"),
                               author = GetStr(doc, "author"), since = GetStr(doc, "since"), until = GetStr(doc, "until");
                        _ = RunGitLogAsync(reqId, repo, author, since, until);
                        break;
                    }
                    case "gitauthor":
                    {
                        string reqId = GetStr(doc, "reqId"), repo = GetStr(doc, "repo");
                        _ = RunGitAuthorAsync(reqId, repo);
                        break;
                    }
                    case "pickfolder":   // 네이티브 폴더 선택 다이얼로그(텍스트 입력 대체)
                    {
                        string reqId = GetStr(doc, "reqId"), start = GetStr(doc, "start");
                        PickFolder(reqId, start);   // UI 스레드에서 모달 다이얼로그
                        break;
                    }
                    case "gitcheck":     // 저장된 경로 검증(존재/저장소여부/작성자)
                    {
                        string reqId = GetStr(doc, "reqId"), repo = GetStr(doc, "repo");
                        _ = RunGitCheckAsync(reqId, repo);
                        break;
                    }

                    case "menu": ShowSettingsMenu(); break;
                    case "pin": TogglePin(); break;
                    case "focus": ToggleFocusMode(); break;
                    case "hide": HideToTray(); break;   // 트레이 켜졌을 때만 HTML이 버튼 노출
                    case "close":
                        if (_settings.TrayEnabled) HideToTray();   // 트레이 사용 시 ✕ = 트레이로 숨김
                        else ExitApp();                            // 기본(트레이 미사용) = 종료
                        break;
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
            catch (Exception ex)
            {
                Log("데이터 저장 실패: " + ex.Message);
                // 무음 손실 방지 — 웹에 즉시 알림(경고 토스트)
                try { _ = web.CoreWebView2?.ExecuteScriptAsync("window.__saveFailed && window.__saveFailed()"); } catch { }
            }
        }

        // ============ Git 커밋 연동 ============
        // 과제별 로컬 저장소에서 git log/config를 실행해 '내 커밋'을 읽어 웹(HTML)으로 회신한다.
        // git CLI를 사용하므로 이 PC에 git이 설치돼 있어야 한다(보고서 작성용 개발 PC라면 보통 설치됨).

        private async Task RunGitLogAsync(string reqId, string repo, string author, string since, string until)
        {
            object payload;
            try { payload = await Task.Run(() => GitLog(repo, author, since, until)); }
            catch (Exception ex) { payload = new GitResult { ok = false, error = "예외: " + ex.Message }; }
            GitReply(reqId, payload);
        }

        private async Task RunGitAuthorAsync(string reqId, string repo)
        {
            object payload;
            try
            {
                var (ok, email, name, err) = await Task.Run(() => GitAuthor(repo));
                payload = new { ok, email, name, error = err };
            }
            catch (Exception ex) { payload = new { ok = false, email = "", name = "", error = ex.Message }; }
            GitReply(reqId, payload);
        }

        private GitResult GitLog(string repo, string author, string since, string until)
        {
            var r = new GitResult();
            if (string.IsNullOrWhiteSpace(repo)) { r.ok = false; r.error = "Git 저장소 경로가 비어 있습니다."; return r; }
            if (!Directory.Exists(repo)) { r.ok = false; r.error = "경로를 찾을 수 없습니다: " + repo; return r; }

            try
            {
                var psi = new ProcessStartInfo("git")
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8,
                };
                psi.ArgumentList.Add("-C"); psi.ArgumentList.Add(repo);
                psi.ArgumentList.Add("log");
                psi.ArgumentList.Add("--no-merges");
                if (!string.IsNullOrWhiteSpace(since)) psi.ArgumentList.Add("--since=" + since + " 00:00:00");
                if (!string.IsNullOrWhiteSpace(until)) psi.ArgumentList.Add("--until=" + until + " 23:59:59");
                if (!string.IsNullOrWhiteSpace(author)) psi.ArgumentList.Add("--author=" + author);
                // 필드 구분자 (단위구분), 커밋은 줄바꿈으로 구분. %aI=작성일(ISO), %s=제목(한 줄)
                psi.ArgumentList.Add("--pretty=format:%H%h%aI%an%ae%s");
                psi.Environment["GIT_PAGER"] = "cat";
                psi.Environment["GIT_TERMINAL_PROMPT"] = "0";

                using var p = Process.Start(psi);
                if (p == null) { r.ok = false; r.error = "git 프로세스를 시작할 수 없습니다."; return r; }
                string outp = p.StandardOutput.ReadToEnd();
                string errp = p.StandardError.ReadToEnd();
                if (!p.WaitForExit(15000)) { try { p.Kill(true); } catch { } r.ok = false; r.error = "git 실행 시간 초과"; return r; }
                if (p.ExitCode != 0)
                {
                    r.ok = false;
                    r.error = string.IsNullOrWhiteSpace(errp) ? ("git 종료코드 " + p.ExitCode) : errp.Trim();
                    return r;
                }

                foreach (var raw in outp.Split('\n'))
                {
                    var line = raw.TrimEnd('\r');
                    if (line.Length == 0) continue;
                    var f = line.Split('');
                    if (f.Length < 6) continue;
                    r.commits.Add(new GitCommit { hash = f[0], shortHash = f[1], date = f[2], author = f[3], email = f[4], subject = f[5] });
                }
                r.ok = true;
                return r;
            }
            catch (System.ComponentModel.Win32Exception)
            {
                r.ok = false; r.error = "git 명령을 찾을 수 없습니다. 이 PC에 git이 설치되어 있는지 확인하세요."; return r;
            }
            catch (Exception ex) { r.ok = false; r.error = ex.Message; return r; }
        }

        private (bool ok, string email, string name, string err) GitAuthor(string repo)
        {
            try
            {
                string email = RunGitConfig(repo, "user.email");
                string name = RunGitConfig(repo, "user.name");
                if (string.IsNullOrWhiteSpace(email) && string.IsNullOrWhiteSpace(name))
                    return (false, "", "", "git 사용자 정보를 찾을 수 없습니다. 'git config user.email' 를 설정하세요.");
                return (true, email, name, "");
            }
            catch (System.ComponentModel.Win32Exception) { return (false, "", "", "git 명령을 찾을 수 없습니다."); }
            catch (Exception ex) { return (false, "", "", ex.Message); }
        }

        // 네이티브 폴더 선택(.NET 9 WPF OpenFolderDialog). 선택 즉시 저장소 여부 + 작성자까지 회신.
        private void PickFolder(string reqId, string start)
        {
            try
            {
                var dlg = new OpenFolderDialog { Title = "이 과제의 Git 작업 폴더 선택", Multiselect = false };
                if (!string.IsNullOrWhiteSpace(start) && Directory.Exists(start)) dlg.InitialDirectory = start;
                bool ok = dlg.ShowDialog(this) == true;
                string path = ok ? dlg.FolderName : "";
                bool isRepo = ok && IsGitRepo(path);
                string email = isRepo ? RunGitConfig(path, "user.email") : "";
                GitReply(reqId, new { ok, path, isRepo, email, error = "" });
            }
            catch (Exception ex)
            {
                GitReply(reqId, new { ok = false, path = "", isRepo = false, email = "", error = ex.Message });
            }
        }

        // 저장된 경로 점검: 존재 여부 / git 저장소 여부 / (저장소면) 작성자 이메일
        private async Task RunGitCheckAsync(string reqId, string repo)
        {
            object payload;
            try
            {
                payload = await Task.Run(() =>
                {
                    bool exists = !string.IsNullOrWhiteSpace(repo) && Directory.Exists(repo);
                    bool isRepo = exists && IsGitRepo(repo);
                    string email = isRepo ? RunGitConfig(repo, "user.email") : "";
                    return (object)new { ok = true, exists, isRepo, email, error = "" };
                });
            }
            catch (Exception ex) { payload = new { ok = false, exists = false, isRepo = false, email = "", error = ex.Message }; }
            GitReply(reqId, payload);
        }

        // 폴더가 git 작업트리인지 판정. .git 존재로 빠르게, 아니면 rev-parse로 확인.
        // (RunGitConfig는 폴더가 없으면 -C를 빼고 전역 신원으로 폴백하므로, 비-git/이동된 폴더 판정엔 이 함수가 필수)
        private static bool IsGitRepo(string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path)) return false;
                if (Directory.Exists(Path.Combine(path, ".git")) || File.Exists(Path.Combine(path, ".git"))) return true;
                var psi = new ProcessStartInfo("git")
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    StandardOutputEncoding = Encoding.UTF8,
                };
                psi.ArgumentList.Add("-C"); psi.ArgumentList.Add(path);
                psi.ArgumentList.Add("rev-parse"); psi.ArgumentList.Add("--is-inside-work-tree");
                psi.Environment["GIT_TERMINAL_PROMPT"] = "0";
                using var p = Process.Start(psi);
                if (p == null) return false;
                string o = p.StandardOutput.ReadToEnd().Trim();
                _ = p.StandardError.ReadToEnd();
                p.WaitForExit(8000);
                return p.ExitCode == 0 && o == "true";
            }
            catch (System.ComponentModel.Win32Exception) { return false; }
            catch { return false; }
        }

        private static string RunGitConfig(string repo, string key)
        {
            var psi = new ProcessStartInfo("git")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
            };
            if (!string.IsNullOrWhiteSpace(repo) && Directory.Exists(repo)) { psi.ArgumentList.Add("-C"); psi.ArgumentList.Add(repo); }
            psi.ArgumentList.Add("config"); psi.ArgumentList.Add(key);
            using var p = Process.Start(psi);
            if (p == null) return "";
            string o = p.StandardOutput.ReadToEnd();
            _ = p.StandardError.ReadToEnd();
            p.WaitForExit(8000);   // 미설정 시 git이 종료코드 1 → stdout 빈 문자열 그대로 반환
            return o.Trim();
        }

        // 결과를 window.__hostReply(reqId, payload) 로 전달 (UI 스레드에서 호출)
        private void GitReply(string reqId, object payload)
        {
            if (string.IsNullOrEmpty(reqId)) return;
            try
            {
                string json = JsonSerializer.Serialize(payload);
                string call = "window.__hostReply(" + JsonSerializer.Serialize(reqId) + "," + json + ")";
                _ = web.CoreWebView2?.ExecuteScriptAsync(call);
            }
            catch (Exception ex) { Log("GitReply 오류: " + ex.Message); }
        }

        private class GitResult
        {
            public bool ok { get; set; }
            public string? error { get; set; }
            public List<GitCommit> commits { get; set; } = new();
        }
        private class GitCommit
        {
            public string hash { get; set; } = "";
            [JsonPropertyName("short")] public string shortHash { get; set; } = "";
            public string date { get; set; } = "";
            public string author { get; set; } = "";
            public string email { get; set; } = "";
            public string subject { get; set; } = "";
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

            var tray = new MenuItem { Header = "트레이 아이콘 사용 (작업표시줄·Alt+Tab에 표시, 닫기→트레이)", IsCheckable = true, IsChecked = _settings.TrayEnabled };
            tray.Click += (_, _) => SetTrayEnabled(!_settings.TrayEnabled);

            var focus = new MenuItem { Header = _focusMode ? "넓게 보기 닫기" : "넓게 보기" };
            focus.Click += (_, _) => ToggleFocusMode();

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
            quit.Click += (_, _) => ExitApp();

            menu.Items.Add(pin);
            menu.Items.Add(focus);
            menu.Items.Add(size);
            menu.Items.Add(nextMon);
            menu.Items.Add(tray);
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
            ApplyWindowMode();   // 트레이 모드면 일반 앱 창(작업표시줄+Alt+Tab), 아니면 도구 창(제외)
        }

        // 창 노출 모드: 트레이 모드 = '일반 앱 창'(작업표시줄+Alt+Tab 노출, 최하위 강제 해제 → 다른 앱 쓰는 중 Alt+Tab으로 불러와 볼 수 있음).
        // 트레이 OFF = '바탕화면 위젯'(WS_EX_TOOLWINDOW로 작업표시줄·Alt+Tab 제외 + 항상 최하위).
        private void ApplyWindowMode()
        {
            bool normal = _settings.TrayEnabled;
            ShowInTaskbar = normal;   // WPF: 작업표시줄/Alt+Tab 등록(owner 정리 포함)
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero) return;
            int ex = GetWindowLong(hwnd, GWL_EXSTYLE);
            if (normal) ex = (ex & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW;   // 노출 강제(Alt+Tab 확실)
            else        ex = (ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;   // 제외
            SetWindowLong(hwnd, GWL_EXSTYLE, ex);
            SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
            Log("창 모드: " + (normal ? "일반(작업표시줄+Alt+Tab)" : "바탕화면 위젯(제외)"));
        }

        // 런타임 토글: 모드 재적용 + z-order 전환(일반=앞으로, 위젯=최하위)
        private void RefreshWindowMode()
        {
            ApplyWindowMode();
            if (_settings.TrayEnabled)
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                if (hwnd != IntPtr.Zero && IsVisible)
                {
                    SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    Activate();
                }
            }
            else ApplyDesktopMode();   // 위젯 모드: 다시 최하위로
        }

        // 바탕화면 배치: 창을 Progman 자식으로 reparent하면 일부 환경(VM/RDP/그래픽 제한)에서
        // WebView2가 흰 화면이 됨이 확인됨 → reparent하지 않고 '톱레벨 최하위'로 앱들 뒤(바탕화면 레이어)에 둔다.
        // (멀티 모니터 자유 배치도 가능해짐. 📌는 이동 잠금 역할.)
        private void ApplyDesktopMode()
        {
            if (_focusMode) return;   // 포커스 모드 중에는 최하위로 내리지 않음(늦은 타이머/핀 토글 방어)
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero) return;
            SetParent(hwnd, IntPtr.Zero);   // 항상 톱레벨 (reparent 안 함 → 렌더 안전)
            if (_settings.TrayEnabled) { Log("일반 창 모드 — 최하위 강제 안 함"); return; }   // Alt+Tab으로 띄우면 앞에 와야 함
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            Log("바탕화면 모드 적용(톱레벨 최하위)");
        }

        private void Window_Deactivated(object? sender, EventArgs e)
        {
            if (_focusMode) return;   // 포커스 모드 중에는 맨 앞 유지(클릭해도 안 내려감)
            if (_settings.TrayEnabled) return;   // 일반 창 모드: 비활성화돼도 가라앉지 않음(Alt+Tab으로 보기)
            // 다른 창을 클릭해 비활성화되면 다시 최하위로 보내 바탕화면 뒤에 유지
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero) return;
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        private void Window_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
        {
            SaveSettings();
            CleanupScrim();  // 넓게 보기 중 종료 시 딤 배경 고스트 방지
            CleanupTray();   // 창이 실제로 닫히면 트레이 정리(잔상 방지)
        }

        // ============ 트레이 아이콘 (옵션) ============
        // WinForms NotifyIcon을 WPF Dispatcher 펌프로 구동(Application.Run 미사용). 종료 시 1회 정리해 잔상 방지.
        private void EnsureTray()
        {
            if (_tray != null) return;
            try
            {
                var menu = new System.Windows.Forms.ContextMenuStrip();
                menu.Items.Add("보이기", null, (_, __) => ShowFromTray());
                menu.Items.Add("숨기기", null, (_, __) => HideToTray());
                menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
                menu.Items.Add("설정…", null, (_, __) => ShowSettingsMenu());
                menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
                menu.Items.Add("종료", null, (_, __) => ExitApp());
                _tray = new System.Windows.Forms.NotifyIcon
                {
                    Icon = BuildTrayIcon(),
                    Text = "수행과제 캘린더",
                    Visible = true,
                    ContextMenuStrip = menu
                };
                _tray.DoubleClick += (_, __) => ShowFromTray();
                _tray.MouseClick += (_, ev) => { if (ev.Button == System.Windows.Forms.MouseButtons.Left) ShowFromTray(); };
                Log("트레이 아이콘 생성");
            }
            catch (Exception ex) { Log("트레이 생성 오류: " + ex.Message); }
        }

        // 외부 .ico 의존 없이 코드로 브랜드 아이콘 비트맵을 그린다(단일파일 publish 안전, 오프라인). 32 기준 좌표를 크기에 비례 스케일.
        private static System.Drawing.Bitmap BuildBrandBitmap(int s)
        {
            var bmp = new System.Drawing.Bitmap(s, s);
            using var g = System.Drawing.Graphics.FromImage(bmp);
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            float u = s / 32f;   // 32px 기준 스케일
            using var bg = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(62, 91, 224)); // var(--accent)
            g.FillRectangle(bg, 0, 0, s, s);                       // 전체 채움(투명 픽셀 0 → HBITMAP 변환 시 검은 테두리 방지)
            using var white = new System.Drawing.SolidBrush(System.Drawing.Color.White);
            g.FillRectangle(white, 6 * u, 9 * u, 20 * u, 16 * u);  // 달력 본체
            using var top = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(46, 68, 173));
            g.FillRectangle(top, 6 * u, 9 * u, 20 * u, 5 * u);     // 상단 띠
            using var dot = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(62, 91, 224));
            g.FillRectangle(dot, 9 * u, 17 * u, 4 * u, 4 * u); g.FillRectangle(dot, 15 * u, 17 * u, 4 * u, 4 * u); g.FillRectangle(dot, 21 * u, 17 * u, 3 * u, 4 * u);
            return bmp;
        }

        // 트레이 아이콘(NotifyIcon용 System.Drawing.Icon)
        private static System.Drawing.Icon BuildTrayIcon()
        {
            try
            {
                using var bmp = BuildBrandBitmap(32);
                IntPtr h = bmp.GetHicon();
                try { using var tmp = System.Drawing.Icon.FromHandle(h); return (System.Drawing.Icon)tmp.Clone(); }
                finally { DestroyIcon(h); }   // GDI 핸들 누수 방지
            }
            catch
            {
                try { var ico = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? ""); if (ico != null) return ico; } catch { }
                return System.Drawing.SystemIcons.Application;
            }
        }

        // 창 아이콘(WPF Window.Icon) — 작업표시줄/Alt+Tab 버튼에 브랜드 아이콘 노출(트레이 모드에서 빈 아이콘 방지)
        private void ApplyWindowIcon()
        {
            try
            {
                using var bmp = BuildBrandBitmap(64);   // 크게 그려 작업표시줄/Alt+Tab에서 선명
                IntPtr hbmp = bmp.GetHbitmap();
                try
                {
                    var src = System.Windows.Interop.Imaging.CreateBitmapSourceFromHBitmap(
                        hbmp, IntPtr.Zero, System.Windows.Int32Rect.Empty,
                        System.Windows.Media.Imaging.BitmapSizeOptions.FromEmptyOptions());
                    src.Freeze();
                    Icon = src;
                }
                finally { DeleteObject(hbmp); }   // GDI 핸들 누수 방지
            }
            catch (Exception ex) { Log("창 아이콘 설정 오류: " + ex.Message); }
        }

        private void ShowFromTray()
        {
            Show();
            if (_settings.TrayEnabled) { Activate(); Log("트레이에서 복귀(앞으로)"); }   // 일반 창: 앞으로
            else { ApplyDesktopMode(); Log("트레이에서 복귀"); }                         // 위젯: 다시 최하위
        }

        private void HideToTray()
        {
            if (_focusMode) CloseBig();   // 넓게 보기 중이면 먼저 닫아 스크림 고스트 방지
            if (_tray == null) EnsureTray();
            Hide();
            if (!_settings.TrayHintShown)
            {
                try { _tray?.ShowBalloonTip(3000, "수행과제 캘린더", "트레이로 숨겼습니다. 아이콘을 클릭하면 다시 표시됩니다.", System.Windows.Forms.ToolTipIcon.Info); } catch { }
                _settings.TrayHintShown = true; SaveSettings();
            }
            Log("트레이로 숨김");
        }

        private void SetTrayEnabled(bool on)
        {
            _settings.TrayEnabled = on;
            if (on) EnsureTray();
            else { if (!IsVisible) ShowFromTray(); DisposeTray(); }   // 숨김 상태에서 끄면 먼저 창 복귀(고립 방지)
            SaveSettings();
            SendTrayState();
            RefreshWindowMode();   // 작업표시줄/Alt+Tab 노출 + z-order 전환(일반↔위젯)
        }

        private void DisposeTray()
        {
            if (_tray == null) return;
            try
            {
                _tray.Visible = false;
                _tray.ContextMenuStrip?.Dispose();
                var ico = _tray.Icon; _tray.Icon = null;
                _tray.Dispose();
                if (ico != null && ico != System.Drawing.SystemIcons.Application) ico.Dispose();
            }
            catch { }
            _tray = null;
        }

        // App.OnExit / 크래시 훅 / 창 종료에서 호출 — 1회만 실제 정리
        public void CleanupTray() => DisposeTray();

        private void ExitApp()
        {
            CleanupScrim();
            DisposeTray();
            Application.Current.Shutdown();
        }

        private void SendTrayState()
        {
            try { _ = web.CoreWebView2?.ExecuteScriptAsync("window.__setTray && window.__setTray(" + (_settings.TrayEnabled ? "true" : "false") + ")"); } catch { }
        }
        private void SendFocusState()
        {
            try { _ = web.CoreWebView2?.ExecuteScriptAsync("window.__setFocus && window.__setFocus(" + (_focusMode ? "true" : "false") + ")"); } catch { }
        }

        // ============ 넓게 보기 (모달식 — 딤 배경 + 중앙 확대, 최대화 대체) ============
        private void ToggleFocusMode() { if (!_focusMode) OpenBig(); else CloseBig(); }

        private void OpenBig()
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero || _focusMode || _scrim != null) return;
            GetWindowRect(hwnd, out _preFocusRect);   // 복원 기준(절대 settings 재계산 안 함)
            var dpi = VisualTreeHelper.GetDpi(this);
            var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            GetMonitorInfo(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), ref mi);
            int waW = mi.rcWork.Right - mi.rcWork.Left, waH = mi.rcWork.Bottom - mi.rcWork.Top;
            int w = Math.Min((int)(1100 * dpi.DpiScaleX), (int)(waW * 0.9));
            int h = Math.Min((int)(800 * dpi.DpiScaleY), (int)(waH * 0.9));
            int x = mi.rcWork.Left + (waW - w) / 2, y = mi.rcWork.Top + (waH - h) / 2;
            _focusMode = true;                    // 어떤 SetWindowPos보다 먼저 → Deactivated/ApplyDesktopMode 가드 무장
            ShowScrim(mi.rcMonitor);              // 딤 배경 먼저(TOPMOST) → 위젯이 그 위에
            SetWindowPos(hwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE);
            Activate();                           // Esc 수신용 키보드 포커스
            SendFocusState();
            Log("넓게 보기 진입");
        }

        private void CloseBig()
        {
            if (!_focusMode) return;
            var hwnd = new WindowInteropHelper(this).Handle;
            _focusMode = false;                   // 복원 전에 해제(가드 재무장)
            CleanupScrim();                       // 즉시 닫기(페이드 없음 → 고스트/이중스크림 원천 차단)
            // 화면 구성 변경 대비: 복원 좌표를 가상 화면 안으로 클램프
            double vl = SystemParameters.VirtualScreenLeft, vt = SystemParameters.VirtualScreenTop;
            var pdpi = VisualTreeHelper.GetDpi(this);
            int vlp = (int)(vl * pdpi.DpiScaleX), vtp = (int)(vt * pdpi.DpiScaleY);
            int vrp = vlp + (int)(SystemParameters.VirtualScreenWidth * pdpi.DpiScaleX);
            int vbp = vtp + (int)(SystemParameters.VirtualScreenHeight * pdpi.DpiScaleY);
            int w = _preFocusRect.Right - _preFocusRect.Left, h = _preFocusRect.Bottom - _preFocusRect.Top;
            int rx = Math.Min(Math.Max(_preFocusRect.Left, vlp), Math.Max(vlp, vrp - w));
            int ry = Math.Min(Math.Max(_preFocusRect.Top, vtp), Math.Max(vtp, vbp - h));
            if (hwnd != IntPtr.Zero)
            {
                SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                // 일반 창 모드면 최하위로 내리지 않고 현재 위치(비-topmost)에 둠 → Alt+Tab 유지
                IntPtr z = _settings.TrayEnabled ? HWND_NOTOPMOST : HWND_BOTTOM;
                SetWindowPos(hwnd, z, rx, ry, w, h, SWP_NOACTIVATE);
            }
            ApplyDesktopMode();                   // 이제 _focusMode=false라 안전하게 다시 최하위로(위젯 모드만)
            SaveSettings();
            SendFocusState();
            Log("넓게 보기 해제");
        }

        // 딤 배경(스크림) 창 — 별도 테두리 없는 반투명 WPF Window. 위젯 바로 아래(TOPMOST 밴드).
        private void ShowScrim(RECT mon)
        {
            try
            {
                _scrim = new Window
                {
                    WindowStyle = WindowStyle.None,
                    ResizeMode = ResizeMode.NoResize,
                    AllowsTransparency = true,
                    ShowInTaskbar = false,
                    ShowActivated = false,
                    Topmost = true,
                    WindowStartupLocation = WindowStartupLocation.Manual,
                    Left = -32000, Top = -32000, Width = 1, Height = 1,   // 첫 프레임 플래시 방지(즉시 화면 밖)
                    Opacity = 0,
                    Background = new SolidColorBrush(System.Windows.Media.Color.FromArgb(0x6B, 0, 0, 0)), // 약 0.42, 히트테스트 위해 non-null
                };
                _scrim.MouseLeftButtonDown += (_, __) => CloseBig();   // 바깥(스크림) 클릭 = 닫기
                _scrim.SourceInitialized += (_, __) =>
                {
                    var sh = new WindowInteropHelper(_scrim!).Handle;
                    int ex = GetWindowLong(sh, GWL_EXSTYLE);
                    SetWindowLong(sh, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW);
                    SetWindowPos(sh, HWND_TOPMOST, mon.Left, mon.Top, mon.Right - mon.Left, mon.Bottom - mon.Top,
                        SWP_NOACTIVATE | SWP_SHOWWINDOW);   // 물리 px 직접 배치(혼합 DPI 정확)
                    _scrim.BeginAnimation(Window.OpacityProperty,
                        new System.Windows.Media.Animation.DoubleAnimation(0, 0.42, TimeSpan.FromMilliseconds(130)));
                };
                _scrim.Show();
            }
            catch (Exception ex) { Log("스크림 생성 오류: " + ex.Message); }
        }

        // 스크림 즉시 닫기(페이드 없음) — 멱등. 종료/크래시/트레이숨김/닫기 모든 경로에서 안전.
        public void CleanupScrim()
        {
            var s = _scrim; _scrim = null;
            if (s != null) { try { s.Close(); } catch { } }
        }

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
        private const int WS_EX_APPWINDOW = 0x00040000;
        private static readonly IntPtr HWND_BOTTOM = new(1);
        private static readonly IntPtr HWND_TOPMOST = new(-1);
        private static readonly IntPtr HWND_NOTOPMOST = new(-2);
        private const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010, SWP_FRAMECHANGED = 0x0020, SWP_SHOWWINDOW = 0x0040;

        [DllImport("user32.dll", SetLastError = true)] private static extern bool DestroyIcon(IntPtr hIcon);
        [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr hObject);

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
        public bool TrayEnabled { get; set; } = false;   // 기본 OFF(위젯 우선)
        public bool TrayHintShown { get; set; } = false;  // '트레이로 숨김' 안내는 1회만
    }
}
