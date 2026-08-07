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
    public partial class MainWindow : Window, INetcusHost
    {
        private readonly string _dataDir;
        private readonly string _dataFile;
        private readonly string _settingsFile;
        private readonly string _webviewDir;
        private readonly string _logFile;

        private CoreWebView2Environment? _cwvEnv;      // Window_Loaded에서 할당 — 보조 WebView2(netcus)가 같은 환경(쿠키·세션) 재사용
        private readonly NetcusService _netcus;        // 회사 일간보고(netcus) 전용 서비스(행위보존 추출 Phase1)
        private readonly ProjectDb _projectDb;         // 과제 DB 연동(READ 경로) — 로컬 MySQL(taskmgr)의 공식 과제를 읽어 웹으로 넘김

        private WidgetSettings _settings = new();
        private RECT _gestureRect;   // 이동/리사이즈 시작 시점의 창 물리 좌표
        private bool _desktopApplied = false;   // 바탕화면 모드 1회 적용 플래그

        private System.Windows.Forms.NotifyIcon? _tray;   // 옵션 트레이 아이콘 (DisposeTray가 멱등이라 별도 플래그 불필요)
        private bool _focusMode = false;                  // 넓게 보기(일시 맨앞·확대) 활성 여부
        private RECT _preFocusRect;                       // 넓게 보기 진입 전 창 물리 좌표
        private Window? _scrim;                            // 넓게 보기 딤 배경 창

        private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValueName = "TaskCalendarWidget";

        // 업데이트 소스 초기 디폴트는 배포 구성(DeployConfig.UpdateSourceUrl) 한 곳에서 온다.
        // 빈 값이면 기능 휴면 — 이후 설정 모달의 '업데이트 소스 URL'로 언제든 설정/변경(재빌드 불필요).

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
            ReconcileAutoStart();   // 옛 빌드 경로로 등록된 자동시작을 현재 실행 exe로 자가 치유(ISSUES #1)
            ApplyWindowBounds();
            ApplyWindowIcon();   // 작업표시줄/Alt+Tab 버튼 브랜드 아이콘(트레이 모드 노출 시 빈 아이콘 방지)
            _netcus = new NetcusService(this);   // Env/DataDir은 라이브 getter로 읽으므로 이른 생성 안전
            _projectDb = new ProjectDb(_dataDir, Log);   // 과제 DB(READ) — 같은 데이터 폴더에 db-config.json 저장
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
            // 업데이트 소스가 비어 있으면 배포 구성 기본값으로 시드(부트스트랩 빌드용). 여전히 비면 기능 휴면.
            if (string.IsNullOrEmpty(_settings.UpdateSourceUrl)) _settings.UpdateSourceUrl = DeployConfig.UpdateSourceUrl;
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
            RotateLog();   // 시작 시 비우지 않는다 — 재시작 후 제보하면 증거가 사라지므로(크기·기간 상한으로 회전)
            var _ver = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;   // csproj AssemblyVersion에서 자동(현재 0.2.0)
            Log($"=== 시작 v{(_ver != null ? _ver.ToString(3) : "0.2.0")} === pinned={_settings.Pinned} firstRun={firstRun} tray={_settings.TrayEnabled}");
            if (_settings.TrayEnabled) EnsureTray();   // 설정돼 있으면 트레이 아이콘 생성

            // 콜드 스타트(WebView2 브라우저 프로세스 준비 ~4초) 동안 빈 창 대신 로딩 표시.
            // 트레이 ON(일반 창 모드)에서만 — 바탕화면 위젯 모드는 조용히 시작해야 하고,
            // WPF 렌더 영역이 남으면 부착 시 검게 렌더되는 이슈가 있어 그 모드에선 아예 띄우지 않는다.
            ShowLoading("준비 중…");

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
                // 진짜 투명도: 창(AllowsTransparency)·WebView2를 투명하게 만들어 HTML 앱 배경(body --bg)이
                // 바탕화면 위로 비치게 한다. (기존엔 OS 테마색으로 초기 불투명 배경을 깔아 흰 플래시를 막았으나,
                // 투명 창에서는 투명이어야 desktop이 보인다. HTML 초기 배경이 불투명이라 로드 후 플래시는 무시 가능.)
                web.DefaultBackgroundColor = System.Drawing.Color.Transparent;
                Directory.CreateDirectory(_webviewDir);

                string ver = "";
                try { ver = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
                catch (Exception vx) { Log("런타임 조회 예외: " + vx.Message); }
                Log("WebView2 런타임: " + (string.IsNullOrEmpty(ver) ? "미설치/미탐지" : ver));
                if (string.IsNullOrEmpty(ver))
                    MessageBox.Show("이 PC에 WebView2 런타임이 없습니다.\nMicrosoft Edge WebView2(Evergreen) 런타임을 설치한 뒤 다시 실행하세요.",
                        "수행과제 캘린더", MessageBoxButton.OK, MessageBoxImage.Warning);

                // VM/원격데스크톱/그래픽 드라이버 환경의 '흰 화면' 방지 — GPU 가속/합성 끄기
                string browserArgs = "--disable-gpu --disable-gpu-compositing --disable-features=msWebView2EnableDraggableRegions";
                // 테스트 전용(옵트인) — 환경변수 TC_DEBUG_PORT가 있을 때만 WebView2 원격 디버깅 포트를 연다.
                // 미설정이면 인자 자체가 붙지 않아 배포 동작·보안에 영향 없음. 자동화 검증(CDP로 실위젯 JS 실행)에서 사용.
                {
                    var dbgPort = Environment.GetEnvironmentVariable("TC_DEBUG_PORT");
                    if (!string.IsNullOrWhiteSpace(dbgPort) && int.TryParse(dbgPort, out var dp) && dp > 0 && dp < 65536)
                    {
                        browserArgs += " --remote-debugging-port=" + dp;
                        Log("원격 디버깅 포트 활성(TC_DEBUG_PORT=" + dp + ") — 테스트 전용");
                    }
                }
                var opts = new CoreWebView2EnvironmentOptions { AdditionalBrowserArguments = browserArgs };
                var env = await CoreWebView2Environment.CreateAsync(null, _webviewDir, opts);
                _cwvEnv = env;   // 회사 보고 전송용 보조 WebView2가 같은 환경(쿠키·세션) 재사용
                await web.EnsureCoreWebView2Async(env);
                Log("CoreWebView2 준비: " + web.CoreWebView2.Environment.BrowserVersionString);
                ShowLoading("화면 준비 중…");   // 병목(브라우저 프로세스 준비) 통과 — 남은 건 내비게이션뿐

                var s = web.CoreWebView2.Settings;
                s.AreDevToolsEnabled = false;
                s.AreDefaultContextMenusEnabled = false;
                s.IsStatusBarEnabled = false;
                s.AreBrowserAcceleratorKeysEnabled = false;
                s.IsZoomControlEnabled = false;

                web.CoreWebView2.WebMessageReceived += OnWebMessage;
                web.CoreWebView2.NavigationCompleted += (_, ev) =>
                {
                    HideLoading();   // 반드시 ApplyDesktopMode보다 먼저 — WPF 렌더 영역이 남은 채 부착되면 검게 렌더됨
                    Log($"NavigationCompleted: success={ev.IsSuccess} status={ev.WebErrorStatus}");
                    if (!_desktopApplied)
                    {
                        _desktopApplied = true;
                        ApplyDesktopMode();              // 렌더 완료 후 부착(렌더-우선 → 흰화면 회피)
                        if (firstRun) MoveToCursorMonitor();
                    }
                };
                string html = LoadHtml();
                // 가상 호스트(실제 origin)에서 로드 — NavigateToString은 opaque origin이라 localStorage가
                // 영속되지 않음(설정·테마·근태·패치노트 '봤음' 등 손실). 파일로 써서 https 가상 호스트로 서빙.
                try
                {
                    // ⚠️ 실측으로 밝혀진 함정: 서빙 중인 index.html을 매 실행 덮어쓰는데, 이전 인스턴스(또는 잔류
                    // msedgewebview2)가 그 파일을 아직 잡고 있으면 쓰기가 막히고 그 폴더 전체가 ERR_ACCESS_DENIED가
                    // 되어 페이지가 통째로 안 뜬다. "재시작하면 되기도/안 되기도" 하던 증상의 원인.
                    // → 실행마다 '새 폴더'에 쓰고 그쪽을 매핑한다(잠긴 파일과 절대 경합하지 않음). 옛 폴더는 뒤에서 정리.
                    string appRoot = Path.Combine(_dataDir, "app");
                    Directory.CreateDirectory(appRoot);
                    string appDir = Path.Combine(appRoot, "v" + DateTime.Now.ToString("yyyyMMddHHmmssfff"));
                    Directory.CreateDirectory(appDir);
                    File.WriteAllText(Path.Combine(appDir, "index.html"), html, new UTF8Encoding(false));
                    web.CoreWebView2.SetVirtualHostNameToFolderMapping("tcapp.local", appDir, CoreWebView2HostResourceAccessKind.Allow);
                    Log($"가상 호스트 로드(localStorage 영속) — HTML {html.Length}자 · dir={Path.GetFileName(appDir)}");
                    web.CoreWebView2.Navigate("https://tcapp.local/index.html");
                    PruneOldAppDirs(appRoot, appDir);   // 이전 회차 폴더 정리(잠겨 있으면 조용히 건너뜀)
                }
                catch (Exception nx)
                {
                    Log("가상 호스트 실패 → NavigateToString 폴백: " + nx.Message);
                    // 여기서 내리지 않는다 — 폴백 내비게이션 동안 로딩 표시를 유지(빈 화면 방지).
                    // 완료 시 NavigationCompleted가, 그마저 안 오면 4초 폴백 타이머가 내려준다.
                    web.CoreWebView2.NavigateToString(html);
                }
            }
            catch (Exception ex)
            {
                Log("초기화 예외: " + ex);
                HideLoading();   // 실패해도 로딩 표시가 화면에 영원히 남지 않게
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
                    HideLoading();   // 부착 전에 먼저 내린다(검게 렌더 방지)
                    ApplyDesktopMode();
                    if (firstRun) MoveToCursorMonitor();
                }
            };
            t.Start();

            UpdateInit();   // 자동 업데이트: 시작 후 지연 1회 + 주기(30분) 백그라운드 확인(전부 무음). 시작 차단 없음.
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

        // 로그 회전 — 시작 시 truncate하면 "이상해서 재시작해봤어요" 뒤에 제보가 오는 순간 증거가 이미 없다.
        // 그렇다고 무한정 쌓으면 연결 실패 재시도 같은 폭주에서 파일이 커진다. 그래서 양쪽에 상한을 건다:
        //   · 용량 — 1MB 넘으면 widget.log.1로 밀고 새로 시작(2세대 = 최대 2MB 고정)
        //   · 기간 — 백업(.1)이 30일 지나면 삭제. 로그엔 과제명·발주처명이 평문으로 남으므로 오래 두지 않는다.
        // 통상 사용은 하루 수 KB라 1MB를 채우는 데 수개월 걸린다(실측 기준).
        private void RotateLog()
        {
            const long MaxBytes = 1024 * 1024;   // 1MB
            const int KeepDays = 30;
            try
            {
                Directory.CreateDirectory(_dataDir);
                string bak = _logFile + ".1";
                var cur = new FileInfo(_logFile);
                if (cur.Exists && cur.Length > MaxBytes)
                {
                    try { if (File.Exists(bak)) File.Delete(bak); } catch { }
                    try { File.Move(_logFile, bak); } catch { }
                }
                var old = new FileInfo(bak);
                if (old.Exists && (DateTime.Now - old.LastWriteTime).TotalDays > KeepDays)
                {
                    try { File.Delete(bak); } catch { }
                }
            }
            catch { }
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

        private static bool GetBool(JsonDocument d, string key) =>
            d.RootElement.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.True;

        // 문자열 배열 필드 → List<string>(비문자열 원소는 건너뜀). 코드 순서변경(codeReorder)의 names 수집용.
        private static List<string> GetStrArray(JsonDocument d, string key)
        {
            var list = new List<string>();
            if (d.RootElement.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Array)
                foreach (var e in v.EnumerateArray())
                    if (e.ValueKind == JsonValueKind.String) list.Add(e.GetString() ?? "");
            return list;
        }

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
                        ReminderInit();   // 시작 알림 타이머·확인 이력 1회 초기화(타이머는 항상 가동 — 전역 on/off 없음)
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

                    // ----- 회사 일간보고(netcus) 자동 전송 -----
                    case "netcusSaveCreds":
                        _netcus.SaveCreds(GetStr(doc, "id"), GetStr(doc, "pw"));
                        break;
                    case "netcusCredsGet":
                        _netcus.SendCredsState();
                        break;
                    case "netcusSubmit":
                    {
                        bool dryRun = !(doc.RootElement.TryGetProperty("dryRun", out var drEl) && drEl.ValueKind == JsonValueKind.False);
                        // ★ 근태 미기록 규약: 웹은 status에 null을 싣고, GetStr은 JSON null(문자열이 아님)을 ""로 환원한다.
                        //   즉 웹→호스트 경계에서 '미기록'은 빈 문자열로 보존된다(NetcusReq.Status 주석과 한 쌍).
                        //   NetcusService는 빈 값이면 사이트의 status를 건드리지 않고 기존 근태를 유지한다.
                        _ = _netcus.SubmitDaily(GetInt(doc, "y"), GetInt(doc, "m"), GetInt(doc, "d"),
                            GetStr(doc, "status"), GetInt(doc, "overtime"), GetStr(doc, "content"), dryRun);   // async — 진행/결과는 __netcusProgress/__netcusResult로 보고
                        break;
                    }
                    // ----- 시작 알림(리마인더) -----
                    case "reminderSync":
                        RemSync(doc);
                        break;

                    // ----- 자동 업데이트(FTP/파일 기반) -----
                    case "updateCheck":     // 설정에서 '지금 확인'(userInitiated — 최신/실패도 조용히 __updateResult로 알림)
                        _ = CheckForUpdateAsync(userInitiated: true);
                        break;
                    case "updateApply":     // 배너 '지금 업데이트' — 내려받기·검증·설치·재시작
                        _ = ApplyUpdateAsync();
                        break;
                    case "updateSetSource": // 설정에서 소스 URL 저장
                        _settings.UpdateSourceUrl = GetStr(doc, "url").Trim();
                        SaveSettings();
                        Log("업데이트 소스 URL 저장: " + (_settings.UpdateSourceUrl.Length == 0 ? "(비움 — 휴면)" : _settings.UpdateSourceUrl));
                        break;
                    case "updateSourceGet": // 설정 열 때 현재 값 반영
                        JsCall("window.__updateSource && window.__updateSource(" + JsonSerializer.Serialize(_settings.UpdateSourceUrl ?? "") + ")");
                        break;

                    // ----- 과제 DB 연동 — 연결정보는 배포 구성(ProjectDb 상수), 설정 UI 없음 -----
                    case "dbInfoGet":       // 설정 열 때 현재 접속 대상 반영 — 배포 시 서버 주소를 제대로 넣었는지 눈으로 확인
                        // ★ 주소와 포트만 보낸다 — 자동 업데이트가 '소스 URL' 하나만 보여주는 것과 같다.
                        //   DbName·DbUser는 배포 담당자가 확인할 대상이 아니고(빌드에 고정), 화면에 노출할 이유가 없다.
                        //   DbPassword는 말할 것도 없다 — 넘기는 순간 DOM에 남는다.
                        JsCall("window.__dbInfo && window.__dbInfo(" + JsonSerializer.Serialize(new
                        {
                            host = DeployConfig.DbHost,
                            port = DeployConfig.DbPort
                        }) + ")");
                        break;
                    case "loadProjects":    // 공식 과제 읽어 웹으로(__applyProjects). 실패 시 ""를 넘기면 웹은 목록을 비운다(로컬 캐시 없음 — ADR-18).
                        _ = LoadProjectsToWebAsync();
                        break;
                    case "loadCustomers":   // 편집 폼의 발주처 드롭다운 소스(customer 마스터) → __applyCustomers
                        _ = LoadCustomersToWebAsync();
                        break;

                    // ----- 공식 과제 쓰기(P3.2) — 관리자 편집. 결과는 __projectSaved(ok,msg) + 성공 시 자동 재조회 -----
                    case "saveProject":     // uid 없으면 신규 INSERT, 있으면 그 uid UPDATE. confirm=true면 소프트 경고 검사 건너뜀.
                        _ = SaveProjectAsync(GetStr(doc, "uid"), GetStr(doc, "section"), GetStr(doc, "customer"),
                            GetStr(doc, "projectName"), GetStr(doc, "contractName"), GetStr(doc, "commonName"),
                            GetStr(doc, "startDate"), GetStr(doc, "endDate"), GetStr(doc, "status"),
                            GetStr(doc, "note"), GetBool(doc, "confirm"));
                        break;
                    case "setProjectActive":   // 소프트삭제(active=false)/복구 — 목록에서 감추기
                        _ = SetProjectActiveAsync(GetStr(doc, "uid"), GetBool(doc, "active"));
                        break;

                    // ----- 발주처(customer) 마스터 관리 — 이름만. 회신은 ReplyOnUi(reqId)로 {ok,msg,count?} -----
                    case "addCustomer":
                        _ = RunAddCustomerAsync(GetStr(doc, "reqId"), GetStr(doc, "name"));
                        break;
                    case "renameCustomer":
                        _ = RunRenameCustomerAsync(GetStr(doc, "reqId"), GetStr(doc, "oldName"), GetStr(doc, "newName"));
                        break;
                    case "setCustomerActive":
                        _ = RunSetCustomerActiveAsync(GetStr(doc, "reqId"), GetStr(doc, "name"), GetBool(doc, "active"));
                        break;
                    case "customerRefCount":   // 이 발주처를 쓰는 활성 과제 수(숨김 확인 UX용)
                        _ = RunCustomerRefCountAsync(GetStr(doc, "reqId"), GetStr(doc, "name"));
                        break;
                    case "loadCustomersFull":  // 관리 화면 전용 — 숨김 포함 전체 [{name,active}]
                        _ = RunLoadCustomersFullAsync(GetStr(doc, "reqId"));
                        break;

                    // ----- 구분/상태 코드테이블 관리 — kind('section'|'status')로 분기. 발주처 브리지 패턴 복제. -----
                    case "loadCodes":          // 드롭다운 소스(활성 코드값) → __applyCodes({sections, statuses})
                        _ = LoadCodesToWebAsync();
                        break;
                    case "getCodesFull":       // 관리 화면 전용 — 숨김 포함 전체 [{name,active,sort}]
                        _ = RunLoadCodesFullAsync(GetStr(doc, "reqId"), GetStr(doc, "kind"));
                        break;
                    case "codeAdd":
                        _ = RunAddCodeAsync(GetStr(doc, "reqId"), GetStr(doc, "kind"), GetStr(doc, "name"));
                        break;
                    case "codeRename":
                        _ = RunRenameCodeAsync(GetStr(doc, "reqId"), GetStr(doc, "kind"), GetStr(doc, "oldName"), GetStr(doc, "newName"));
                        break;
                    case "codeSetActive":
                        _ = RunSetCodeActiveAsync(GetStr(doc, "reqId"), GetStr(doc, "kind"), GetStr(doc, "name"), GetBool(doc, "active"));
                        break;
                    case "codeReorder":
                        _ = RunReorderCodesAsync(GetStr(doc, "reqId"), GetStr(doc, "kind"), GetStrArray(doc, "names"));
                        break;
                    case "codeRefCount":       // 이 코드값을 쓰는 활성 과제 수(숨김 확인 UX용)
                        _ = RunCodeRefCountAsync(GetStr(doc, "reqId"), GetStr(doc, "kind"), GetStr(doc, "name"));
                        break;

                    // ★ 관리자 브리지(adminLogin/adminLogout/adminStateGet/saveAdminCred)는 폐지됐다(USER-LOGIN §3.3).
                    //   공용 관리자 비밀번호로 편집을 여는 모델 자체를 없앴다 — 편집 권한은 로그인 신원으로
                    //   '작업 요청 시점'에 DB 쓰기 관문(ProjectDb.OpenWriteAsync)이 판정한다.

                    // ----- 사용자 로그인(세션 유지) — 계약 3개, 실패 code 없음(USER-LOGIN §2.2) -----
                    case "userSessionGet":   // ★ 부팅 경로다. 세션 파일만 읽는다 — netcus 접속 코드가 한 줄도 없어야 한다.
                        RunUserSessionGet(GetStr(doc, "reqId"));
                        break;
                    case "userLogin":        // 게이트에서 [로그인]을 눌렀을 때만 — 여기서만 netcus로 나간다
                        _ = RunUserLoginAsync(GetStr(doc, "reqId"), GetStr(doc, "id"), GetStr(doc, "pw"));
                        break;
                    case "userLogout":       // 세션 + netcus 자격 동시 삭제(둘 중 하나만 지우면 반쪽 상태가 남는다)
                        RunUserLogout(GetStr(doc, "reqId"));
                        break;
                    case "userInfoGet":      // 사용자 정보 모달 — 권한을 '열 때마다' DB에서 새로 읽는다(세션에 없음)
                        _ = RunUserInfoGetAsync(GetStr(doc, "reqId"));
                        break;
                    case "membersGet":       // 구성원 모달 — 조직 트리 + 내 열람 범위 안의 사람들(열 때마다 재조회)
                        _ = RunMembersGetAsync(GetStr(doc, "reqId"));
                        break;

                    case "netcusWeekSubmit":
                        _ = _netcus.WeekFill(GetStr(doc, "sdate"), GetStr(doc, "edate"), GetStr(doc, "subject"),
                            GetStr(doc, "content"), GetStr(doc, "endwork"), GetStr(doc, "planwork"));   // 주간보고는 '채우고 열어두기'(직접 제출) — POST 안 함
                        break;
                    case "netcusWeekMerge":   // 주간보고 병합(Phase2) — 기간 일간보고 content를 '읽기만' 해서 reqId로 회신
                    {
                        string reqId = GetStr(doc, "reqId"), from = GetStr(doc, "from"), to = GetStr(doc, "to");
                        _ = _netcus.WeekMerge(reqId, from, to);   // async — days 배열을 __hostReply(reqId, ...)로 회신
                        break;
                    }
                    case "netcusWeeklyRangeRead":   // 주간보고 범위 읽기(Phase2) — 기간에 걸치는 netcus 주간보고들을 '읽기만' 해서 reqId로 회신
                    {
                        string reqId = GetStr(doc, "reqId"), from = GetStr(doc, "from"), to = GetStr(doc, "to");
                        _ = _netcus.WeeklyRangeRead(reqId, from, to);   // async — weeks 배열을 __hostReply(reqId, ...)로 회신
                        break;
                    }
                    case "netcusProbe":   // 주간보고 구조 캡처 창 열기(읽기 전용) — 가시 로그인 후 사용자가 HTML 저장
                        _ = _netcus.Probe();
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
                               author = GetStr(doc, "author"), since = GetStr(doc, "since"), until = GetStr(doc, "until"),
                               vcs = GetStr(doc, "vcs");
                        bool wantBody = GetBool(doc, "body");   // 전역 옵션(제목+본문) — false면 기존 포맷/파싱 그대로
                        _ = RunGitLogAsync(reqId, repo, author, since, until, vcs, wantBody);
                        break;
                    }
                    case "gitauthor":
                    {
                        string reqId = GetStr(doc, "reqId"), repo = GetStr(doc, "repo"), vcs = GetStr(doc, "vcs");
                        _ = RunGitAuthorAsync(reqId, repo, vcs);
                        break;
                    }
                    case "pickfolder":   // 네이티브 폴더 선택 다이얼로그(텍스트 입력 대체)
                    {
                        string reqId = GetStr(doc, "reqId"), start = GetStr(doc, "start");
                        PickFolder(reqId, start);   // UI 스레드에서 모달 다이얼로그
                        break;
                    }
                    case "gitcheck":     // 저장된 경로 검증(존재/선택종류로 유효한지/작성자)
                    {
                        string reqId = GetStr(doc, "reqId"), repo = GetStr(doc, "repo"), vcs = GetStr(doc, "vcs");
                        _ = RunGitCheckAsync(reqId, repo, vcs);
                        break;
                    }
                    case "exportResearch":   // 연구노트 데이터 내보내기(임시) — 캘린더 md + 내 커밋 patch(git/svn)를 사용자가 고른 폴더로
                    {
                        string reqId = GetStr(doc, "reqId"), project = GetStr(doc, "project"), calendarMd = GetStr(doc, "calendarMd"),
                               gitRepo = GetStr(doc, "gitRepo"), gitAuthor = GetStr(doc, "gitAuthor"),
                               svnRepo = GetStr(doc, "svnRepo"), svnAuthor = GetStr(doc, "svnAuthor"),
                               from = GetStr(doc, "from"), to = GetStr(doc, "to");
                        RunResearchExport(reqId, project, calendarMd, gitRepo, gitAuthor, svnRepo, svnAuthor, from, to);
                        break;
                    }

                    case "exportProjectsXlsx":   // 사업부 과제목록(+발주처) → Excel(.xlsx) 2시트. 데이터는 웹(화면 필터 결과 + 활성 발주처)이 주고 호스트는 서식만 만든다.
                    {
                        string reqId = GetStr(doc, "reqId"), subtitle = GetStr(doc, "subtitle"), fileName = GetStr(doc, "fileName");
                        // doc는 이 메서드가 끝나면 dispose된다 → 백그라운드로 넘기기 전에 여기서 값(행)으로 확정한다.
                        var xrows = ReadProjectExportRows(doc);
                        var custRows = ReadCustomerExportRows(doc);
                        RunProjectsXlsxExport(reqId, subtitle, fileName, xrows, custRows);
                        break;
                    }

                    case "openFolder":   // 내보내기 결과 폴더 다시 열기(자동 열기는 1회뿐 — 창을 닫았으면 되돌아갈 길이 없다)
                    {
                        OpenFolderSafe(GetStr(doc, "path"));
                        break;
                    }

                    case "openLogFolder":   // 문의 모달의 '로그 폴더 열기' — ★ 웹이 경로를 보내지 않는다(doc에서 아무것도 읽지 않음)
                    {
                        OpenLogFolder();    // 호스트 자신의 _dataDir/_logFile만 연다 → 웹발 문자열이 explorer 인자로 샐 표면이 0
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

        private async Task RunGitLogAsync(string reqId, string repo, string author, string since, string until, string vcs = "", bool wantBody = false)
        {
            object payload;
            try
            {
                string useVcs = ResolveVcs(repo, vcs);   // 분기 단일 소스(명시 선택 우선, 없으면 DetectVcs)
                payload = await Task.Run(() => useVcs == "svn" ? (GitResult)SvnLog(repo, author, since, until, wantBody) : GitLog(repo, author, since, until, wantBody));
            }
            catch (Exception ex) { payload = new GitResult { ok = false, error = "예외: " + ex.Message }; }
            GitReply(reqId, payload);
        }

        private async Task RunGitAuthorAsync(string reqId, string repo, string vcs = "")
        {
            object payload;
            try
            {
                // 분기 단일 소스 — gitlog와 동일하게 명시 vcs 우선(없으면 DetectVcs). svn은 작성자 자동감지 불가.
                if (ResolveVcs(repo, vcs) == "svn")
                    payload = new { ok = false, email = "", name = "", error = "SVN은 작성자 자동 감지가 안 됩니다 — 본인 SVN 사용자명을 직접 입력하세요." };
                else
                {
                    var (ok, email, name, err) = await Task.Run(() => GitAuthor(repo));
                    payload = new { ok, email, name, error = err };
                }
            }
            catch (Exception ex) { payload = new { ok = false, email = "", name = "", error = ex.Message }; }
            GitReply(reqId, payload);
        }

        private GitResult GitLog(string repo, string author, string since, string until, bool wantBody = false)
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
                // 작성자 필터: svn(Svn.cs)이 대소문자무시 substring이므로 git도 -i로 맞춘다(동일 전역 작성자 문자열이 양쪽에서 같은 폭으로 매칭).
                // (git --author는 정규식이라 '.' 등 메타문자는 더 넓게 잡힐 수 있으나, 실사용 작성자는 단순 이름/이메일이라 무해)
                if (!string.IsNullOrWhiteSpace(author)) { psi.ArgumentList.Add("--regexp-ignore-case"); psi.ArgumentList.Add("--author=" + author); }
                // 필드 구분자 (단위구분), 커밋은 줄바꿈으로 구분. %aI=작성일(ISO), %s=제목(한 줄)
                if (wantBody)
                    psi.ArgumentList.Add("--pretty=format:%H%x1f%h%x1f%aI%x1f%an%x1f%ae%x1f%s%x1f%b%x00");   // %b=제목 제외 본문, %x00=커밋 구분(NUL)
                else
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

                if (wantBody)
                {
                    // 커밋 = NUL(\0) 구분(본문에 줄바꿈 있음), 필드 = US(0x1F) 구분. idx 0~5=기존 필드, idx 6~=본문(US로 재결합).
                    foreach (var rawChunk in outp.Split('\0'))
                    {
                        var chunk = rawChunk.TrimStart('\n', '\r');   // 커밋 사이 git이 넣는 줄바꿈 제거
                        if (chunk.Length == 0) continue;
                        var f = chunk.Split('');
                        if (f.Length < 6) continue;
                        string body = f.Length > 6 ? string.Join("", f, 6, f.Length - 6).Trim() : "";
                        r.commits.Add(new GitCommit { hash = f[0], shortHash = f[1], date = f[2], author = f[3], email = f[4], subject = f[5], body = body });
                    }
                    r.ok = true;
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
                var dlg = new OpenFolderDialog { Title = "이 과제의 Git/SVN 작업 폴더 선택", Multiselect = false };
                if (!string.IsNullOrWhiteSpace(start) && Directory.Exists(start)) dlg.InitialDirectory = start;
                bool ok = dlg.ShowDialog(this) == true;
                string path = ok ? dlg.FolderName : "";
                // pickfolder는 사용자가 아직 종류를 안 정한 진입점 → DetectVcs로 감지해 프론트가 라디오에 반영(setCatVcs).
                string vcs = ok ? DetectVcs(path) : "";
                bool isRepo = vcs == "git" || vcs == "svn";
                bool exists = ok && Directory.Exists(path);
                string email = vcs == "git" ? RunGitConfig(path, "user.email") : "";
                // gitcheck와 동일 스키마(exists/isRepo/vcs/detected/email)로 회신 — applyGitState가 두 출처를 같은 불변식으로 처리.
                GitReply(reqId, new { ok, path, exists, isRepo, vcs, detected = vcs, email, error = "" });
            }
            catch (Exception ex)
            {
                GitReply(reqId, new { ok = false, path = "", exists = false, isRepo = false, vcs = "", detected = "", email = "", error = ex.Message });
            }
        }

        // 저장된 경로 점검: 존재 여부 / git 저장소 여부 / (저장소면) 작성자 이메일
        private async Task RunGitCheckAsync(string reqId, string repo, string vcs = "")
        {
            object payload;
            try
            {
                payload = await Task.Run(() =>
                {
                    bool exists = !string.IsNullOrWhiteSpace(repo) && Directory.Exists(repo);
                    string detected = exists ? DetectVcs(repo) : "";            // 폴더의 실제 마커(.git/.svn)
                    string useVcs = string.IsNullOrWhiteSpace(vcs) ? detected : vcs;   // 사용자 선택 우선
                    // 핵심: '선택한 종류로 유효한가'를 본다 — git 선택이면 .svn이 끼어 있어도 git 저장소면 OK,
                    // svn 선택이면 .svn 작업복사본이면 OK. (.git+.svn 혼재 폴더에서 선택을 존중해 오탐 방지)
                    bool isRepo = exists && (useVcs == "svn" ? Directory.Exists(Path.Combine(repo, ".svn"))
                                  : useVcs == "git" ? IsGitRepo(repo)
                                  : (detected == "git" || detected == "svn"));
                    string email = (useVcs == "git" && isRepo) ? RunGitConfig(repo, "user.email") : "";
                    // detected를 함께 회신 → 프론트가 '선택종류와 실제 불일치' 힌트(감지된 종류: X)를 띄울 수 있음
                    return (object)new { ok = true, exists, isRepo, vcs = useVcs, detected, email, error = "" };
                });
            }
            catch (Exception ex) { payload = new { ok = false, exists = false, isRepo = false, vcs = "", detected = "", email = "", error = ex.Message }; }
            GitReply(reqId, payload);
        }

        // ============ 연구노트 데이터 내보내기(임시) ============
        // 선택 과제 1개 + 기간의 캘린더 기록(md)과 '내 커밋' patch(git log -p / svn diff)를 사용자가 고른 폴더로 내보낸다.
        // 폴더 선택(모달)은 UI 스레드에서 먼저 → 이후 파일/git/svn 작업은 백그라운드 스레드(UI 비블로킹). LLM에 넣어 연구노트 작성용.
        private void RunResearchExport(string reqId, string project, string calendarMd,
            string gitRepo, string gitAuthor, string svnRepo, string svnAuthor, string from, string to)
        {
            // 1) 저장 폴더 선택 — UI 스레드(OnWebMessage에서 호출). 취소면 조용히 회신(오류 아님).
            string basePath;
            try
            {
                var dlg = new OpenFolderDialog { Title = "연구노트 데이터를 저장할 폴더 선택", Multiselect = false };
                if (dlg.ShowDialog(this) != true) { GitReply(reqId, new { ok = false, cancelled = true }); return; }
                basePath = dlg.FolderName;
            }
            catch (Exception ex) { GitReply(reqId, new { ok = false, error = ex.Message }); return; }

            // 2) 파일/git/svn 작업은 백그라운드 스레드에서(외부 프로세스·IO → UI 비블로킹)
            _ = Task.Run(() =>
            {
                try
                {
                    string safe = SanitizeName(project);
                    string outDir = Path.Combine(basePath, $"연구노트_{safe}_{from}_{to}");
                    Directory.CreateDirectory(Path.Combine(outDir, "calendar"));
                    // 캘린더 md는 항상 기록(BOM 없는 UTF-8)
                    File.WriteAllText(Path.Combine(outDir, "calendar", "캘린더.md"), calendarMd ?? "", new UTF8Encoding(false));

                    // --- GIT: 경로·작성자 모두 설정 && 유효할 때만 '내 커밋' patch(git log -p). 아니면 사유를 상태로 남긴다. ---
                    string gitStatus, gitMsg; int gitCount = 0;
                    if (string.IsNullOrWhiteSpace(gitRepo)) { gitStatus = "nopath"; gitMsg = "경로가 없어 뽑을 수 없음"; }
                    else if (!Directory.Exists(gitRepo) || !IsGitRepo(gitRepo)) { gitStatus = "norepo"; gitMsg = "유효한 git 저장소가 아님"; }
                    else if (string.IsNullOrWhiteSpace(gitAuthor)) { gitStatus = "noauthor"; gitMsg = "작성자 미설정으로 뽑지 않음"; }
                    else
                    {
                        // 커밋별 '개별 .patch 파일'로 저장 — 병합 단일 txt는 폐쇄망(약한) LLM에서 커밋 경계 혼선(hunk 오귀속)과
                        // 컨텍스트 잘림(잘린 diff를 이어서 지어냄)을 유발한다. 파일=경계, 파일명(순번-단축해시)=캘린더 md와의 조인 키.
                        var (gok, glist, gerr) = GitListCommits(gitRepo, gitAuthor, from, to);
                        if (!gok) { gitStatus = "error"; gitMsg = "오류: " + gerr; }
                        else if (glist.Count == 0) { gitStatus = "empty"; gitMsg = "해당 작성자의 커밋 없음"; }   // 0건 → 폴더 안 만듦
                        else
                        {
                            string gitDir = Path.Combine(outDir, "git");
                            Directory.CreateDirectory(gitDir);
                            int gOrd = 0; string gFirstErr = "";
                            foreach (var (ghash, gshort) in glist)   // 오래된 것부터(연구노트 서사 순) 0001, 0002…
                            {
                                gOrd++;
                                var (ok1, text1, err1) = GitPatchOne(gitRepo, ghash);
                                if (!ok1) { if (gFirstErr.Length == 0) gFirstErr = gshort + ": " + err1; continue; }
                                File.WriteAllText(Path.Combine(gitDir, gOrd.ToString("0000") + "-" + gshort + ".patch"), text1, new UTF8Encoding(false));
                                gitCount++;
                            }
                            if (gitCount == 0) { gitStatus = "error"; gitMsg = "오류: " + (gFirstErr.Length > 0 ? gFirstErr : "patch 생성 실패"); }
                            else { gitStatus = "ok"; gitMsg = gitCount + "건 → git/ 커밋별 .patch" + (gFirstErr.Length > 0 ? " (일부 실패: " + gFirstErr + ")" : ""); }
                        }
                    }
                    object gitResult = new { status = gitStatus, msg = gitMsg, count = gitCount };

                    // --- SVN: 경로·작성자 모두 설정 && 유효할 때만 '내 리비전' log+diff. 아니면 사유를 상태로 남긴다. ---
                    string svnStatus, svnMsg; int svnCount = 0;
                    if (string.IsNullOrWhiteSpace(svnRepo)) { svnStatus = "nopath"; svnMsg = "경로가 없어 뽑을 수 없음"; }
                    else if (!Directory.Exists(Path.Combine(svnRepo, ".svn"))) { svnStatus = "norepo"; svnMsg = "유효한 svn 작업복사본이 아님"; }
                    else if (string.IsNullOrWhiteSpace(svnAuthor)) { svnStatus = "noauthor"; svnMsg = "작성자 미설정으로 뽑지 않음"; }
                    else
                    {
                        try
                        {
                            var log = SvnLog(svnRepo, svnAuthor, from, to, true);   // 작성자·기간 필터된 '내 리비전'
                            if (!log.ok) { svnStatus = "error"; svnMsg = "오류: " + (log.error ?? "svn 로그 실패"); }
                            else if (log.commits.Count == 0) { svnStatus = "empty"; svnMsg = "해당 작성자의 리비전 없음"; }   // 0건 → patch 파일 안 만듦
                            else
                            {
                                // 리비전별 '개별 .patch 파일' — git과 동일한 이유(경계=파일, 파일명=조인 키). 내용: 로그 헤더 + 요약(A/M/D) + diff.
                                string svnDir = Path.Combine(outDir, "svn");
                                Directory.CreateDirectory(svnDir);
                                int sOrd = 0;
                                for (int k = log.commits.Count - 1; k >= 0; k--)   // SvnLog는 최신 먼저 → 오래된 것부터 번호 매김
                                {
                                    var c = log.commits[k];
                                    sOrd++;
                                    var one = new StringBuilder();
                                    one.Append("===== r").Append(c.hash).Append(" · ").Append(c.author).Append(" · ").Append(c.date).Append(" =====\n");
                                    one.Append(c.subject).Append('\n');
                                    if (!string.IsNullOrWhiteSpace(c.body)) one.Append(c.body).Append('\n');
                                    one.Append('\n');
                                    one.Append(SvnDiff(svnRepo, c.hash, true));   // 변경 파일 요약(A/M/D) — git --stat 대응
                                    one.Append('\n');
                                    one.Append(SvnDiff(svnRepo, c.hash));
                                    File.WriteAllText(Path.Combine(svnDir, sOrd.ToString("0000") + "-r" + c.hash + ".patch"), one.ToString(), new UTF8Encoding(false));
                                }
                                svnCount = log.commits.Count;
                                svnStatus = "ok"; svnMsg = svnCount + "건 → svn/ 리비전별 .patch";
                            }
                        }
                        catch (Exception sx) { svnStatus = "error"; svnMsg = "오류: " + sx.Message; }
                    }
                    object svnResult = new { status = svnStatus, msg = svnMsg, count = svnCount };

                    // 내보내기 요약(log 수준) — 폴더에 남겨 왜 이렇게 나왔는지 자명하게(경로/작성자/건수)
                    var summary = new StringBuilder();
                    summary.Append("연구노트 데이터 내보내기 요약\n");
                    summary.Append("================================\n");
                    summary.Append("과제: ").Append(project).Append('\n');
                    summary.Append("기간: ").Append(from).Append(" ~ ").Append(to).Append('\n');
                    summary.Append("생성: ").Append(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")).Append('\n');
                    summary.Append("작성자(Git): ").Append(string.IsNullOrWhiteSpace(gitAuthor) ? "(미설정)" : gitAuthor).Append('\n');
                    summary.Append("작성자(SVN): ").Append(string.IsNullOrWhiteSpace(svnAuthor) ? "(미설정)" : svnAuthor).Append('\n');
                    summary.Append('\n');
                    summary.Append("[캘린더] calendar/캘린더.md 생성\n");
                    summary.Append("[Git]  ").Append(gitMsg).Append('\n');
                    summary.Append("[SVN]  ").Append(svnMsg).Append('\n');
                    File.WriteAllText(Path.Combine(outDir, "내보내기_요약.txt"), summary.ToString(), new UTF8Encoding(false));

                    // 편의: 결과 폴더 열기(실패해도 무시 — 필수 아님)
                    try { Process.Start(new ProcessStartInfo { FileName = outDir, UseShellExecute = true }); } catch { }

                    GitReply(reqId, new { ok = true, outPath = outDir, calendar = true, git = gitResult, svn = svnResult });
                }
                catch (Exception ex) { GitReply(reqId, new { ok = false, error = ex.Message }); }
            });
        }

        // ============ 사업부 과제목록 → Excel(.xlsx) 추출 (P4) ============
        // 책임 분리: 웹 = '무엇을'(카탈로그 화면에 지금 보이는 필터 결과·정보줄) / 호스트 = '어떻게'(xlsx 바이트).
        // 호스트가 DB를 다시 읽지 않는 이유 — 화면과 파일이 어긋나면 "내가 본 것"이 아닌 장표가 나온다.
        // 읽기 산출물이라 관리자 인증은 걸지 않는다(뷰어도 뽑을 수 있다).
        //
        // ★ 장표 컬럼 정의의 단일 소스(템플릿 v2 — 자체 서식 확정, 2026-07-22 사용자 승인).
        //   Field = 웹이 보내는 행 객체의 키(웹은 값만 만들고 순서·제목·너비·정렬은 모른다).
        //   Field가 빈 문자열인 열 = 연번(No) — 호스트가 배열 순서로 채운다(화면 정렬 순서가 곧 연번).
        //   '사용여부' 열은 두지 않는다 — LoadProjectsJsonAsync가 is_active=1만 읽어 숨김 행이 애초에 오지 않으므로
        //   전 행이 "사용"인 상수 열이 된다(장표에서 상수 열은 노이즈). 그 사실은 부제의 '숨김 과제 제외'가 담는다.
        private static readonly (string Header, string Field, double Width, XlsxWriter.Align Align, bool IsDate, bool Wrap)[] ProjectExportCols =
        {
            ("No",       "",             6,  XlsxWriter.Align.Center, false, false),
            ("구분",     "section",      12, XlsxWriter.Align.Center, false, false),
            ("발주처",   "customer",     18, XlsxWriter.Align.Left,   false, false),
            ("사업명",   "projectName",  40, XlsxWriter.Align.Left,   false, true),
            ("통상명칭", "commonName",   20, XlsxWriter.Align.Left,   false, false),
            ("계약명",   "contractName", 34, XlsxWriter.Align.Left,   false, true),   // 길고 덜 보는 열은 뒤로
            ("시작일",   "startDate",    12, XlsxWriter.Align.Center, true,  false),
            ("종료일",   "endDate",      12, XlsxWriter.Align.Center, true,  false),
            ("상태",     "status",       14, XlsxWriter.Align.Center, false, false),
        };

        private const string ProjectExportTitle = "사업부 과제 목록";
        private const string ProjectExportSheet = "과제목록";
        private static readonly int ProjectExportStatusCol =
            Array.FindIndex(ProjectExportCols, c => c.Field == "status");   // 상태색 힌트를 붙일 열

        // 상태 → 강조색(도메인 지식). XlsxWriter는 '진행중이 초록'인 걸 모른다 — 힌트 키만 받는다.
        // 이 표에 없는 값(미정·빈값)은 힌트가 매칭되지 않아 기본(줄무늬) 스타일로 떨어진다.
        private static readonly Dictionary<string, XlsxWriter.Accent> ProjectStatusAccents = new Dictionary<string, XlsxWriter.Accent>
        {
            ["진행중"]       = new XlsxWriter.Accent("FFE8F3EC", "FF1E7A45"),
            ["1차 납품완료"] = new XlsxWriter.Accent("FFE9F0FA", "FF1F5FA8"),
            ["종료"]         = new XlsxWriter.Accent("FFF0F1F3", "FF6B7280"),
        };

        private static XlsxWriter.Col[] ProjectExportColDefs() =>
            ProjectExportCols.Select(c => new XlsxWriter.Col(c.Header, c.Width, c.Align, c.IsDate, c.Wrap)).ToArray();

        // 시트2 '발주처' — 이름만 관리하므로 2열(No·발주처). 더미 View_Customer(No+이름)와 같은 모양.
        private const string CustomerExportTitle = "발주처 목록";
        private const string CustomerExportSheet = "발주처";
        private static XlsxWriter.Col[] CustomerExportColDefs() => new[]
        {
            new XlsxWriter.Col("No", 6, XlsxWriter.Align.Center),
            new XlsxWriter.Col("발주처", 30, XlsxWriter.Align.Left),
        };

        // 웹이 보낸 활성 발주처 이름 배열(customers) → 이름·번호 행. 번호는 호스트가 배열 순서로 매긴다(웹이 이름순 정렬해 보냄).
        private static List<XlsxWriter.Row> ReadCustomerExportRows(JsonDocument doc)
        {
            var list = new List<XlsxWriter.Row>();
            if (!doc.RootElement.TryGetProperty("customers", out var arr) || arr.ValueKind != JsonValueKind.Array) return list;
            int no = 0;
            foreach (var v in arr.EnumerateArray())
            {
                if (v.ValueKind != JsonValueKind.String) continue;
                string name = (v.GetString() ?? "").Trim();
                if (name.Length == 0) continue;
                no++;
                list.Add(new XlsxWriter.Row(no.ToString(System.Globalization.CultureInfo.InvariantCulture), name));
            }
            return list;
        }

        // 웹이 보낸 rows(객체 배열)를 컬럼 순서의 문자열 배열로 확정. 없는 키/비문자열 값은 빈 문자열
        // (웹이 이미 정규화해 보내지만, 여기서도 "null" 문자열이 새지 않게 한 번 더 잠근다).
        private static List<XlsxWriter.Row> ReadProjectExportRows(JsonDocument doc)
        {
            var list = new List<XlsxWriter.Row>();
            if (!doc.RootElement.TryGetProperty("rows", out var arr) || arr.ValueKind != JsonValueKind.Array) return list;
            int no = 0;
            foreach (var r in arr.EnumerateArray())
            {
                if (r.ValueKind != JsonValueKind.Object) continue;
                no++;
                var cells = new string[ProjectExportCols.Length];
                for (int i = 0; i < ProjectExportCols.Length; i++)
                {
                    string field = ProjectExportCols[i].Field;
                    // WPF 파일이라 using System.Globalization을 들이지 않는다(Calendar 등 이름 충돌 여지) — 한 곳뿐이므로 전체 한정.
                    if (field.Length == 0) { cells[i] = no.ToString(System.Globalization.CultureInfo.InvariantCulture); continue; }   // No = 연번
                    cells[i] = r.TryGetProperty(field, out var v) && v.ValueKind == JsonValueKind.String
                        ? (v.GetString() ?? "") : "";
                }
                var row = new XlsxWriter.Row(cells);
                // 상태 문자열을 그대로 스타일 힌트로 — 색 규칙(ProjectStatusAccents)은 이 파일에만 있다.
                if (ProjectExportStatusCol >= 0) row.WithHint(ProjectExportStatusCol, cells[ProjectExportStatusCol]);
                list.Add(row);
            }
            return list;
        }

        // 저장 위치 선택(UI 스레드 모달) → 실제 쓰기는 백그라운드. 취소는 오류가 아니라 조용한 회신.
        // 2시트: ① 과제목록(부제=웹이 준 필터 요약) ② 발주처(마스터 전체 — 과제 필터와 무관하므로 부제에 '전체'로 명시).
        private void RunProjectsXlsxExport(string reqId, string subtitle, string fileName,
            List<XlsxWriter.Row> rows, List<XlsxWriter.Row> customerRows)
        {
            string target;
            try
            {
                string suggest = SanitizeName(string.IsNullOrWhiteSpace(fileName)
                    ? "사업부_과제목록_" + DateTime.Now.ToString("yyyyMMdd") : fileName);
                if (!suggest.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) suggest += ".xlsx";
                var dlg = new SaveFileDialog
                {
                    Title = "사업부 과제목록을 저장할 위치 선택",
                    Filter = "Excel 통합 문서 (*.xlsx)|*.xlsx",
                    DefaultExt = "xlsx",
                    AddExtension = true,
                    OverwritePrompt = true,
                    FileName = suggest,
                };
                if (dlg.ShowDialog(this) != true) { ReplyOnUi(reqId, new { ok = false, cancelled = true }); return; }
                target = dlg.FileName;
            }
            catch (Exception ex) { ReplyOnUi(reqId, new { ok = false, error = ex.Message }); return; }

            var xdoc = new XlsxWriter.Doc();
            foreach (var kv in ProjectStatusAccents) xdoc.Accents[kv.Key] = kv.Value;

            var sheets = new List<XlsxWriter.Sheet>
            {
                // 시트1 과제목록 — 여러 쪽으로 넘어갈 수 있어 헤더행 반복 인쇄 ON.
                new XlsxWriter.Sheet
                {
                    TabName = ProjectExportSheet, Title = ProjectExportTitle, Subtitle = subtitle ?? "",
                    Cols = ProjectExportColDefs(), Rows = rows, RepeatHeaderRow = true,
                },
            };
            // 시트2 발주처 — 발주처가 하나라도 있으면 추가(빈 시트로 혼동 방지). 작아서 1페이지 → 헤더 반복 불필요.
            if (customerRows != null && customerRows.Count > 0)
            {
                string custSubtitle = DateTime.Now.ToString("yyyy-MM-dd") + " 추출 · 전체 발주처 " + customerRows.Count + "개";
                sheets.Add(new XlsxWriter.Sheet
                {
                    TabName = CustomerExportSheet, Title = CustomerExportTitle, Subtitle = custSubtitle,
                    Cols = CustomerExportColDefs(), Rows = customerRows, RepeatHeaderRow = false,
                });
            }
            int count = rows.Count;
            _ = Task.Run(() =>
            {
                try
                {
                    XlsxWriter.Write(target, xdoc, sheets);
                    ReplyOnUi(reqId, new { ok = true, path = target, dir = Path.GetDirectoryName(target) ?? "", count });
                }
                catch (IOException)
                {
                    // 가장 흔한 실패 — Excel에서 같은 파일을 열어둔 채 덮어쓰기. 원인을 그대로 말해 준다.
                    ReplyOnUi(reqId, new { ok = false, error = "파일이 열려 있어 저장할 수 없습니다. Excel에서 닫고 다시 시도하세요." });
                }
                catch (UnauthorizedAccessException)
                {
                    ReplyOnUi(reqId, new { ok = false, error = "이 위치에 저장할 권한이 없습니다. 다른 폴더를 선택하세요." });
                }
                catch (Exception ex) { ReplyOnUi(reqId, new { ok = false, error = ex.Message }); }
            });
        }

        // GitReply(=window.__hostReply)를 UI 스레드에서 호출하도록 마샬. CoreWebView2는 스레드 친화성이 있어
        // 백그라운드에서 그대로 부르면 회신이 통째로 유실될 수 있다(JsCall과 같은 이유로 Dispatcher를 거친다).
        private void ReplyOnUi(string reqId, object payload)
        {
            try { Dispatcher.Invoke(() => GitReply(reqId, payload)); }
            catch (Exception ex) { Log("ReplyOnUi 오류: " + ex.Message); }
        }

        // 폴더 열기 — 웹에서 온 문자열이므로 '실재하는 디렉터리'만 통과시킨다. UseShellExecute에 임의 문자열을
        // 그대로 넘기면 exe·URL 실행으로 새는 경로가 되므로, explorer.exe에 인자로만 건넨다.
        private static void OpenFolderSafe(string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path)) return;
                var full = Path.GetFullPath(path);
                if (!Directory.Exists(full)) return;
                Process.Start(new ProcessStartInfo("explorer.exe", "\"" + full + "\"") { UseShellExecute = true });
            }
            catch { }
        }

        // 로그 폴더 열기(문의 모달) — OpenFolderSafe와 달리 **경로 인자를 받지 않는다**.
        // 웹은 { cmd:"openLogFolder" }만 보내고, 여는 대상은 이 클래스가 아는 _dataDir/_logFile뿐이다.
        // → 웹이 문자열을 못 넘기므로 explorer 인자 주입 표면이 아예 없다(openFolder는 '호스트가 준 경로만'
        //   되돌리는 규약이라 한 단계 더 방어가 필요했지만, 로그는 그럴 이유조차 없다).
        // 목적이 '이 파일을 첨부해 달라'이므로 파일이 있으면 /select 로 **선택된 채** 연다 — 폴더만 열면 또 찾아야 한다.
        private void OpenLogFolder()
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_dataDir)) return;
                string dir = Path.GetFullPath(_dataDir);
                Directory.CreateDirectory(dir);   // 첫 실행 등으로 폴더가 없으면 만들고 연다(아무 반응 없는 실패 방지)
                string file = string.IsNullOrWhiteSpace(_logFile) ? "" : Path.GetFullPath(_logFile);
                if (file.Length > 0 && File.Exists(file))
                {
                    Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + file + "\"") { UseShellExecute = true });
                    return;
                }
                OpenFolderSafe(dir);   // 로그가 아직 없으면 폴더만 — 빈값·GetFullPath·존재확인 방어는 그쪽을 재사용
            }
            catch (Exception ex) { Log("로그 폴더 열기 실패: " + ex.Message); }
        }

        // '내 커밋' 해시 목록(오래된 것부터) — 커밋별 patch 파일 생성용. GitLog와 동일한 필터(작성자 -i·기간).
        private (bool ok, System.Collections.Generic.List<(string hash, string shortH)> commits, string err) GitListCommits(string repo, string author, string from, string to)
        {
            var list = new System.Collections.Generic.List<(string, string)>();
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
                psi.ArgumentList.Add("--reverse");   // 오래된 것부터 — 파일 순번이 연구노트 서사 순이 되게
                psi.ArgumentList.Add("--format=%H%x1f%h");
                if (!string.IsNullOrWhiteSpace(from)) psi.ArgumentList.Add("--since=" + from + " 00:00:00");
                if (!string.IsNullOrWhiteSpace(to)) psi.ArgumentList.Add("--until=" + to + " 23:59:59");
                if (!string.IsNullOrWhiteSpace(author)) { psi.ArgumentList.Add("--regexp-ignore-case"); psi.ArgumentList.Add("--author=" + author); }
                psi.Environment["GIT_PAGER"] = "cat";
                psi.Environment["GIT_TERMINAL_PROMPT"] = "0";

                using var p = Process.Start(psi);
                if (p == null) return (false, list, "git 프로세스를 시작할 수 없습니다.");
                string outp = p.StandardOutput.ReadToEnd();
                string errp = p.StandardError.ReadToEnd();
                if (!p.WaitForExit(60000)) { try { p.Kill(true); } catch { } return (false, list, "git 실행 시간 초과"); }
                if (p.ExitCode != 0) return (false, list, string.IsNullOrWhiteSpace(errp) ? ("git 종료코드 " + p.ExitCode) : errp.Trim());
                foreach (var raw in outp.Split('\n'))
                {
                    var line = raw.TrimEnd('\r');
                    if (line.Length == 0) continue;
                    var f = line.Split('');
                    if (f.Length < 2) continue;
                    list.Add((f[0], f[1]));
                }
                return (true, list, "");
            }
            catch (System.ComponentModel.Win32Exception) { return (false, list, "git 명령을 찾을 수 없습니다. 이 PC에 git이 설치되어 있는지 확인하세요."); }
            catch (Exception ex) { return (false, list, ex.Message); }
        }

        // 단일 커밋 patch(git log -1 -p --stat) — 커밋별 .patch 파일 저장용. 메타+요약+diff가 한 파일에.
        private (bool ok, string text, string err) GitPatchOne(string repo, string hash)
        {
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
                psi.ArgumentList.Add("-1");
                psi.ArgumentList.Add("-p");
                psi.ArgumentList.Add("--stat");   // 변경 파일 요약 — 리포트 '수정 N·신규 N' 카드용(LLM이 diff를 세지 않게)
                psi.ArgumentList.Add("--no-color");
                psi.ArgumentList.Add(hash);
                psi.Environment["GIT_PAGER"] = "cat";
                psi.Environment["GIT_TERMINAL_PROMPT"] = "0";

                using var p = Process.Start(psi);
                if (p == null) return (false, "", "git 프로세스를 시작할 수 없습니다.");
                string outp = p.StandardOutput.ReadToEnd();
                string errp = p.StandardError.ReadToEnd();
                if (!p.WaitForExit(60000)) { try { p.Kill(true); } catch { } return (false, "", "git 실행 시간 초과"); }
                if (p.ExitCode != 0) return (false, "", string.IsNullOrWhiteSpace(errp) ? ("git 종료코드 " + p.ExitCode) : errp.Trim());
                return (true, outp, "");
            }
            catch (System.ComponentModel.Win32Exception) { return (false, "", "git 명령을 찾을 수 없습니다. 이 PC에 git이 설치되어 있는지 확인하세요."); }
            catch (Exception ex) { return (false, "", ex.Message); }
        }

        // svn diff -c <rev> — 단일 리비전 변경분. SvnLog와 동일한 ProcessStartInfo/인코딩(UTF-8).
        // 실패해도 오류 주석 문자열로 반환 → 한 리비전 실패가 전체 patch를 끊지 않게.
        private static string SvnDiff(string repo, string rev, bool summarize = false)
        {
            try
            {
                var psi = new ProcessStartInfo(SvnExe())
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8,
                };
                psi.ArgumentList.Add("diff");
                if (summarize) psi.ArgumentList.Add("--summarize");   // 변경 파일 요약(A/M/D 목록) — git --stat 대응
                psi.ArgumentList.Add("-c"); psi.ArgumentList.Add(rev);
                psi.ArgumentList.Add(repo);
                psi.ArgumentList.Add("--non-interactive");

                using var p = Process.Start(psi);
                if (p == null) return "(svn diff 프로세스를 시작할 수 없습니다)";
                string outp = p.StandardOutput.ReadToEnd();
                string errp = p.StandardError.ReadToEnd();
                if (!p.WaitForExit(60000)) { try { p.Kill(true); } catch { } return "(svn diff 시간 초과: r" + rev + ")"; }
                if (p.ExitCode != 0) return "(svn diff 실패 r" + rev + ": " + (string.IsNullOrWhiteSpace(errp) ? ("종료코드 " + p.ExitCode) : errp.Trim()) + ")";
                return outp;
            }
            catch (Exception ex) { return "(svn diff 예외 r" + rev + ": " + ex.Message + ")"; }
        }

        // 파일/폴더명 안전화 — Windows 금지문자(\ / : * ? " < > |)와 제어문자를 '_'로. 트림 후 비면 "과제".
        private static string SanitizeName(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return "과제";
            var sb = new StringBuilder(s.Length);
            foreach (char ch in s)
            {
                if (ch == '\\' || ch == '/' || ch == ':' || ch == '*' || ch == '?' || ch == '"' || ch == '<' || ch == '>' || ch == '|' || char.IsControl(ch))
                    sb.Append('_');
                else sb.Append(ch);
            }
            string r = sb.ToString().Trim();
            return r.Length == 0 ? "과제" : r;
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

        // 메인 웹뷰로 임의 JS 실행(UI 스레드 마샬 + try/catch). netcus·리마인더·업데이트 통지 공유.
        private void JsCall(string js) { try { Dispatcher.Invoke(() => { try { _ = web.CoreWebView2?.ExecuteScriptAsync(js); } catch { } }); } catch { } }

        // ============ 과제 DB 연동 ============
        // 공식 과제(project, is_active=1)를 읽어 웹으로 넘긴다. 오프라인/실패면 ""를 넘기고, 웹은 폴백 없이 목록을 비운다(ADR-18).
        private async Task LoadProjectsToWebAsync()
        {
            string? json = await _projectDb.LoadProjectsJsonAsync();
            // null(연결/조회 실패) → "" 전달 → 웹 __applyProjects가 dbCatalog를 비우고 오프라인 안내를 띄운다
            JsCall("window.__applyProjects && window.__applyProjects(" + JsonSerializer.Serialize(json ?? "") + ")");
        }

        // 발주처 마스터 → 편집 폼 드롭다운. 실패면 ""(웹이 기존 목록의 distinct 발주처로 폴백).
        private async Task LoadCustomersToWebAsync()
        {
            string? json = await _projectDb.LoadCustomersJsonAsync();
            JsCall("window.__applyCustomers && window.__applyCustomers(" + JsonSerializer.Serialize(json ?? "") + ")");
        }

        // 쓰기 결과 통지(성공/실패 + 한국어 사유 + 소프트경고 여부). 웹 __projectSaved(ok, msg, needConfirm):
        //   needConfirm=true는 실패가 아니라 '비슷한 과제 확인 요청' — 웹이 confirmBox 후 confirm:true로 재전송한다.
        //   기존 2인자 호출부(setProjectActive)와의 정합: needConfirm 기본 false.
        private void ProjectSaved(bool ok, string msg, bool needConfirm = false) =>
            JsCall("window.__projectSaved && window.__projectSaved(" + (ok ? "true" : "false") + ","
                + JsonSerializer.Serialize(msg ?? "") + "," + (needConfirm ? "true" : "false") + ")");

        // 공식 과제 추가/수정 — 성공하면 곧바로 재조회해서 목록(dbCategories)까지 갱신한다(사용자가 새로고침을 누를 필요 없게).
        private async Task SaveProjectAsync(string uid, string section, string customer, string projectName,
            string contractName, string commonName, string startDate, string endDate, string status, string note, bool confirm)
        {
            var (ok, msg, needConfirm) = await _projectDb.UpsertProjectAsync(uid, section, customer, projectName,
                contractName, commonName, startDate, endDate, status, note: note, confirmSimilar: confirm);
            ProjectSaved(ok, msg, needConfirm);
            if (ok) await LoadProjectsToWebAsync();
        }

        // 공식 과제 숨김(소프트삭제)/복구 — 성공 시 재조회하면 is_active=0인 행은 목록에서 사라진다.
        private async Task SetProjectActiveAsync(string uid, bool active)
        {
            var (ok, msg) = await _projectDb.SetProjectActiveAsync(uid, active);
            ProjectSaved(ok, msg);   // needConfirm 기본 false — 숨김/복구엔 소프트경고 없음
            if (ok) await LoadProjectsToWebAsync();
        }

        // ----- 발주처(customer) 관리 — 회신은 ReplyOnUi(=UI 스레드 마샬)로만. 재조회(loadProjects/loadCustomers)는
        //       웹이 성공 응답을 받고 스스로 트리거한다(웹=무엇을, 호스트=어떻게). -----
        private async Task RunAddCustomerAsync(string reqId, string name)
        {
            var (ok, msg) = await _projectDb.AddCustomerAsync(name);
            ReplyOnUi(reqId, new { ok, msg });
        }
        private async Task RunRenameCustomerAsync(string reqId, string oldName, string newName)
        {
            var (ok, msg) = await _projectDb.RenameCustomerAsync(oldName, newName);
            ReplyOnUi(reqId, new { ok, msg });
        }
        private async Task RunSetCustomerActiveAsync(string reqId, string name, bool active)
        {
            var (ok, msg) = await _projectDb.SetCustomerActiveAsync(name, active);
            ReplyOnUi(reqId, new { ok, msg });
        }
        private async Task RunCustomerRefCountAsync(string reqId, string name)
        {
            var (ok, count, msg) = await _projectDb.CountActiveProjectsByCustomerAsync(name);
            ReplyOnUi(reqId, new { ok, count, msg });
        }
        // list = JSON 배열 문자열(웹이 JSON.parse). __applyProjects와 같은 '문자열로 전달' 규약(이중 인코딩 회피).
        private async Task RunLoadCustomersFullAsync(string reqId)
        {
            string? json = await _projectDb.LoadCustomersFullJsonAsync();
            ReplyOnUi(reqId, json == null
                ? (object)new { ok = false, list = "", msg = "발주처 목록을 불러오지 못했습니다." }
                : new { ok = true, list = json, msg = "" });
        }

        // ----- 구분/상태 코드테이블 관리 — 발주처와 대칭. 회신은 ReplyOnUi. 재조회(loadCodes/loadProjects)는 웹이 트리거. -----
        // 드롭다운 소스(활성 코드값) — sections/statuses 두 배열을 한 번에 __applyCodes로. 실패는 각각 ""(웹이 폴백).
        private async Task LoadCodesToWebAsync()
        {
            string? sec = await _projectDb.LoadSectionCodesJsonAsync();
            string? st = await _projectDb.LoadStatusCodesJsonAsync();
            JsCall("window.__applyCodes && window.__applyCodes("
                + JsonSerializer.Serialize(sec ?? "") + "," + JsonSerializer.Serialize(st ?? "") + ")");
        }
        private async Task RunLoadCodesFullAsync(string reqId, string kind)
        {
            string? json = await _projectDb.LoadCodesFullJsonAsync(kind);
            ReplyOnUi(reqId, json == null
                ? (object)new { ok = false, list = "", msg = "목록을 불러오지 못했습니다." }
                : new { ok = true, list = json, msg = "" });
        }
        private async Task RunAddCodeAsync(string reqId, string kind, string name)
        {
            var (ok, msg) = await _projectDb.AddCodeAsync(kind, name);
            ReplyOnUi(reqId, new { ok, msg });
        }
        private async Task RunRenameCodeAsync(string reqId, string kind, string oldName, string newName)
        {
            var (ok, msg) = await _projectDb.RenameCodeAsync(kind, oldName, newName);
            ReplyOnUi(reqId, new { ok, msg });
        }
        private async Task RunSetCodeActiveAsync(string reqId, string kind, string name, bool active)
        {
            var (ok, msg) = await _projectDb.SetCodeActiveAsync(kind, name, active);
            ReplyOnUi(reqId, new { ok, msg });
        }
        private async Task RunReorderCodesAsync(string reqId, string kind, List<string> names)
        {
            var (ok, msg) = await _projectDb.ReorderCodesAsync(kind, names);
            ReplyOnUi(reqId, new { ok, msg });
        }
        private async Task RunCodeRefCountAsync(string reqId, string kind, string name)
        {
            var (ok, count, msg) = await _projectDb.CountActiveProjectsByCodeAsync(kind, name);
            ReplyOnUi(reqId, new { ok, count, msg });
        }

        // ============ 사용자 로그인(세션 유지) — USER-LOGIN §2.2 ============
        // 인증(정말 본인인가) = 회사 사이트(netcus) · 인가(이름·소속·권한) = 우리 DB(app_user).
        // 계약은 3개뿐이고 실패 code는 만들지 않는다 — 웹은 msg를 그대로 보여줄 뿐 분기하지 않는다.

        // 세션 → 웹 회신 payload. 비밀번호는 애초에 저장하지 않으므로 샐 것이 없다.
        // ★ 4개뿐이다(USER-LOGIN §3.3) — 권한(view_scope/edit_role)은 웹으로 내려보내지 않는다.
        //   권한은 '작업 요청 시점'에 DB 쓰기 관문(ProjectDb.OpenWriteAsync)이 판정한다.
        private static object UserPayload(UserSession s) => new
        {
            loginId = s.LoginId, name = s.Name, title = s.Title, orgUnit = s.OrgUnit,
        };

        // app_user 행 JSON → 필드 튜플. 행 없음("{}")이면 전부 빈 문자열로 나온다.
        // ★ edit_role은 여기서 읽지 않는다 — 로그인 시점의 권한을 캐시하지 않기 위해서다.
        //   등록 여부 판정은 name/org_unit으로 하고, is_active만 로그인 거부에 쓴다.
        private static (string name, string title, string orgUnit, int? isActive) ParseAppUser(string json)
        {
            try
            {
                using var d = JsonDocument.Parse(json);
                var r = d.RootElement;
                string S(string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";
                int? act = r.TryGetProperty("is_active", out var a) && a.ValueKind == JsonValueKind.Number ? a.GetInt32() : (int?)null;
                return (S("name"), S("title"), S("org_unit"), act);
            }
            catch { return ("", "", "", null); }
        }

        // 부팅 세션 복원 — ★ 로컬 세션 파일(DPAPI)만 읽는다. netcus도 DB도 건드리지 않는다.
        // ★ 회신 뒤 app_user 백그라운드 재조회를 '하지 않는다'(USER-LOGIN §2.5): 그 30줄이 로그아웃과 경합해
        //   방금 삭제한 세션을 되살린 적이 있다. 이름·소속 변경은 다음 로그인에 반영되면 충분하다.
        //   재조회가 없으므로 세대 토큰·경합 방어도 필요 없다.
        private void RunUserSessionGet(string reqId)
        {
            UserSession? s = null;
            try { s = UserSession.Load(_dataDir, Log); }
            catch (Exception ex) { Log("사용자 세션 복원 예외(로그인 화면으로): " + ex.Message); }
            if (s == null) { GitReply(reqId, new { ok = false }); return; }
            Log("사용자 세션 복원: " + s.LoginId + " — netcus 접속 없음");
            GitReply(reqId, new { ok = true, user = UserPayload(s) });
        }

        // 로그인 — 인증(netcus) → 인가(app_user) → 저장 2개. ★ 비밀번호는 로그·회신·예외 메시지 어디에도 넣지 않는다.
        // 저장은 둘 다 성공해야 ok:true다. 하나라도 실패하면 둘 다 정리한다 — 반쪽 상태가 남으면
        // (세션만) 보고 전송이 깨지고 (자격만) 유령 상태가 된다.
        private async Task RunUserLoginAsync(string reqId, string id, string pw)
        {
            void Fail(string m) => ReplyOnUi(reqId, new { ok = false, msg = m });   // 실패 회신은 msg 하나뿐(code 없음)
            try
            {
                id = (id ?? "").Trim();
                pw = pw ?? "";
                if (id.Length == 0 || pw.Length == 0) { Fail("ID와 비밀번호를 입력하세요."); return; }
                // ★ 인증 시도 '전에' 진행 중 여부를 본다. 그냥 부르면 LoginVerify가 false를 돌려
                //   '다른 작업 중'이 'ID/비밀번호 오류'로 표시된다(이전 구현의 실제 결함).
                if (_netcus.IsBusy) { Fail("다른 회사 시스템 작업이 진행 중입니다 — 잠시 후 다시 시도하세요."); return; }

                // ① 인증 — netcus 보호 페이지 도달로 판정(최소화·비활성 창).
                //    자격 불일치와 사내망 미연결을 구분할 신호가 없으므로 단정하지 않는다.
                if (!await _netcus.LoginVerify(id, pw)) { Fail("로그인하지 못했습니다 — ID/비밀번호 또는 사내망 연결을 확인하세요."); return; }

                // ② 인가 — app_user 조회. null=연결 실패 / "{}"=미등록 / is_active=0 → 비활성.
                string? json = await _projectDb.LoadAppUserJsonAsync(id);
                if (json == null) { Fail("DB에 연결하지 못했습니다."); return; }
                var u = ParseAppUser(json);
                if (json.Trim() == "{}" || (u.name.Length == 0 && u.orgUnit.Length == 0))
                { Fail("사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요."); return; }
                if (u.isActive == 0) { Fail("비활성 처리된 계정입니다."); return; }

                // ③ 저장 2개 — 세션(신원) + netcus 자격(보고 전송이 valid:true를 보고 다시 묻지 않는다).
                //    둘 다 '되읽어 확인'된 경우에만 성공이고, 하나라도 실패하면 양쪽을 지운다(반쪽 상태 금지).
                const string SaveFail = "로그인 정보를 이 PC에 저장하지 못했습니다 — 다시 시도하세요.";
                var fresh = new UserSession { LoginId = id, Name = u.name, Title = u.title, OrgUnit = u.orgUnit };
                var (sok, _) = UserSession.Save(_dataDir, id, u.name, u.title, u.orgUnit, Log);
                if (!sok) { UserSession.Clear(_dataDir, Log); _netcus.ClearCredsForLogout(); Fail(SaveFail); return; }
                var (cok, _) = _netcus.SaveCredsForLogin(id, pw);
                if (!cok) { UserSession.Clear(_dataDir, Log); _netcus.ClearCredsForLogout(); Fail(SaveFail); return; }

                Log("사용자 로그인 완료: " + id + " (" + u.name + " · " + u.orgUnit + ")");
                ReplyOnUi(reqId, new { ok = true, user = UserPayload(fresh) });
            }
            catch (Exception ex)
            {
                // 어떤 예외에도 회신은 나가야 한다 — 회신이 없으면 게이트의 로그인 버튼이 영원히 '로그인 중…'에 갇힌다.
                // ex 전체(스택)는 로그로만, 회신 문구는 고정 — 예외 메시지에 입력값이 섞여 나가지 않게.
                Log("사용자 로그인 예외: " + ex);
                Fail("로그인 처리 중 오류가 발생했습니다.");
            }
        }

        // 로그아웃 — 세션과 netcus 자격을 함께 지운다. 둘 중 하나만 지우면 다음 시작에 되돌아오거나
        // 이름만 지워진 채 보고 전송이 계속 그 사람 자격으로 돈다.
        private void RunUserLogout(string reqId)
        {
            try
            {
                UserSession.Clear(_dataDir, Log);
                _netcus.ClearCredsForLogout();
                Log("사용자 로그아웃 — 세션·자격증명 삭제");
            }
            catch (Exception ex) { Log("사용자 로그아웃 예외: " + ex.Message); }
            GitReply(reqId, new { ok = true });
        }

        // 사용자 정보(권한) 조회 — 상단바 「사용자 정보」 모달이 열릴 때마다 부른다.
        // ★ 세션에는 권한이 없다(4필드뿐) — 그래서 DB를 다시 읽는다. 캐시하면 관리자가 역할을 바꾼 뒤
        //   화면이 낡은 값으로 거짓말을 한다.
        // ★ 읽기 경로다(ProjectDb.LoadUserInfoJsonAsync → OpenReadAsync). 쓰기 관문을 쓰면
        //   viewer 가 자기 권한을 확인조차 못 한다("권한을 보려면 먼저 권한이 있어야 한다"는 순환).
        // ★ 표시 전용이다 — 웹은 이 값으로 무엇도 막지 않는다. 실제 판정은 쓰기 요청 시점(USER-LOGIN §3.3).
        // async 이므로 회신은 UI 스레드로 마샬하는 ReplyOnUi 를 쓴다(RunUserLoginAsync 와 같은 경로).
        private async Task RunUserInfoGetAsync(string reqId)
        {
            try
            {
                UserSession? s = UserSession.Load(_dataDir, Log);
                if (s == null || s.LoginId.Length == 0)
                { ReplyOnUi(reqId, new { ok = false, msg = "로그인이 필요합니다." }); return; }

                string? json = await _projectDb.LoadUserInfoJsonAsync(s.LoginId);
                if (json == null)
                { ReplyOnUi(reqId, new { ok = false, msg = "서버에 연결하지 못했습니다 — 잠시 후 다시 시도하세요." }); return; }

                // Deserialize<JsonElement> 는 복제본을 돌려준다 — JsonDocument 수명에 묶이지 않아 회신에 그대로 실을 수 있다.
                var info = JsonSerializer.Deserialize<JsonElement>(json);
                bool found = info.TryGetProperty("found", out var f) && f.ValueKind == JsonValueKind.True;
                if (!found)
                { ReplyOnUi(reqId, new { ok = false, msg = "사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요." }); return; }

                ReplyOnUi(reqId, new { ok = true, info });
            }
            catch (Exception ex)
            {
                // 예외 원문(스택)은 로그에만 — 회신 문구는 고정이다. 내부 사정이 화면으로 새 나가면 안 된다.
                Log("사용자 정보 조회 예외: " + ex);
                ReplyOnUi(reqId, new { ok = false, msg = "사용자 정보를 확인하지 못했습니다." });
            }
        }

        // 구성원 조회 — 구성원 모달이 열릴 때마다 부른다(캐시 없음: 인사이동·권한변경이 낡은 채 남으면 화면이 거짓말을 한다).
        // ★ 범위 밖 사람은 payload 에 아예 담기지 않는다(ProjectDb 가 자른다) — 화면 필터로 가리면
        //   개발자도구로 전부 보인다. 조직 트리는 구조만 함께 보내고 범위 밖 노드는 allowed=false 로 표시한다.
        // ★ 읽기 경로다(ProjectDb.LoadMembersJsonAsync → OpenReadAsync). 쓰기 관문을 쓰면
        //   unit_tree 를 가진 viewer 전원이 명부를 못 본다 — 열람 권한과 편집 권한은 다른 축이다.
        // 회신 문구는 RunUserInfoGetAsync 와 같은 3분기다(세션 없음 / 연결 실패 / 미등록) — 사유가 다르면 대처도 다르다.
        private async Task RunMembersGetAsync(string reqId)
        {
            try
            {
                UserSession? s = UserSession.Load(_dataDir, Log);
                if (s == null || s.LoginId.Length == 0)
                { ReplyOnUi(reqId, new { ok = false, msg = "로그인이 필요합니다." }); return; }

                string? json = await _projectDb.LoadMembersJsonAsync(s.LoginId);
                if (json == null)
                { ReplyOnUi(reqId, new { ok = false, msg = "서버에 연결하지 못했습니다 — 잠시 후 다시 시도하세요." }); return; }

                // Deserialize<JsonElement> 는 복제본을 돌려준다 — JsonDocument 수명에 묶이지 않아 회신에 그대로 실을 수 있다.
                var data = JsonSerializer.Deserialize<JsonElement>(json);
                bool found = data.TryGetProperty("found", out var f) && f.ValueKind == JsonValueKind.True;
                if (!found)
                { ReplyOnUi(reqId, new { ok = false, msg = "사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요." }); return; }

                ReplyOnUi(reqId, new { ok = true, data });
            }
            catch (Exception ex)
            {
                // 예외 원문(스택)은 로그에만 — 회신 문구는 고정이다. 내부 사정이 화면으로 새 나가면 안 된다.
                Log("구성원 조회 예외: " + ex);
                ReplyOnUi(reqId, new { ok = false, msg = "구성원 목록을 불러오지 못했습니다." });
            }
        }

        // ----- INetcusHost (NetcusService 호스트 어댑터) -----
        // Dispatcher는 Window(DispatcherObject)의 상속 프로퍼티가 인터페이스를 만족한다.
        CoreWebView2Environment? INetcusHost.Env => _cwvEnv;
        string INetcusHost.DataDir => _dataDir;
        void INetcusHost.Eval(string js) => JsCall(js);
        void INetcusHost.Reply(string reqId, object payload) => GitReply(reqId, payload);
        void INetcusHost.Log(string msg) => Log(msg);

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
            public string body { get; set; } = "";   // 전체 커밋 본문(제목 제외) — wantBody일 때만 채움, 아니면 ""
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

        // ============ 콜드 스타트 로딩 표시 ============
        // 트레이 ON(일반 창 모드)에서만 표시. 위젯 모드는 조용히 시작해야 하고, WPF 렌더 영역이
        // 남은 채 바탕화면에 부착되면 그 영역이 검게 렌더되는 이슈가 있어 아예 띄우지 않는다.
        // 이전 회차 서빙 폴더 정리 — 현재 회차만 남긴다. 아직 잠긴 폴더는 실패해도 조용히 건너뛴다
        // (다음 실행에서 정리되므로 누적되지 않는다). 구버전이 쓰던 프로필 내부 폴더도 함께 치운다.
        private void PruneOldAppDirs(string appRoot, string keepDir)
        {
            try
            {
                foreach (var d in Directory.GetDirectories(appRoot))
                {
                    if (string.Equals(d, keepDir, StringComparison.OrdinalIgnoreCase)) continue;
                    try { Directory.Delete(d, true); } catch { }
                }
                // 옛 배치(프로필 내부)에서 넘어온 잔여물
                try
                {
                    string legacy = Path.Combine(_webviewDir, "app");
                    if (Directory.Exists(legacy)) Directory.Delete(legacy, true);
                }
                catch { }
                // 옛 배치(app 바로 아래 index.html)도 정리
                try
                {
                    string legacyFile = Path.Combine(appRoot, "index.html");
                    if (File.Exists(legacyFile)) File.Delete(legacyFile);
                }
                catch { }
            }
            catch { }
        }

        private void ShowLoading(string status)
        {
            try
            {
                if (!_settings.TrayEnabled) return;   // 위젯 모드에선 어떤 호출 경로에서도 뜨지 않게
                if (loadingPanel == null) return;
                if (loadingStatus != null) loadingStatus.Text = status;
                loadingPanel.Visibility = Visibility.Visible;
            }
            catch { }
        }

        // 로딩 표시 제거 — 반드시 시각 트리에서 내린다(Collapsed). 남겨두면 바탕화면 부착 시 검게 렌더될 수 있다.
        private void HideLoading()
        {
            try
            {
                if (loadingPanel == null) return;
                if (loadingPanel.Visibility == Visibility.Collapsed) return;
                if (loadingBar != null) loadingBar.IsIndeterminate = false;   // 애니메이션 타이머 정지
                loadingPanel.Visibility = Visibility.Collapsed;
                Log("로딩 표시 제거");
            }
            catch { }
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
            CleanupReminders();   // 열린 알림 창·타이머 정리
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

        // 두 번째 인스턴스가 신호했을 때 — 이미 떠 있는(특히 바탕화면 모드라 안 보이는) 위젯을 앞으로 끌어올린다.
        public void SummonToFront()
        {
            try
            {
                if (!IsVisible) Show();
                if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
                bool prev = Topmost;
                Topmost = true;
                Activate();
                Topmost = prev;   // 원래 z-order 정책 복원(위젯 모드면 이후 동기화가 최하위 처리)
            }
            catch { }
        }

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

        // 자동시작이 켜져 있으면(Run 값 존재) 그 경로가 현재 실행 중인 exe와 다를 때 현재 경로로 갱신한다.
        // 옛 빌드(예: widget\bin\Release\...) 경로가 stale로 남아 로그인 시 옛 exe가 단일인스턴스를
        // 선점해 새 배포본이 조용히 종료되던 문제(ISSUES #1)를 매 실행 시 자가 치유.
        private static void ReconcileAutoStart()
        {
            try
            {
                using var k = Registry.CurrentUser.OpenSubKey(RunKeyPath, true);
                if (k == null) return;                    // Run 키를 못 열면 정리할 것 없음(이후 k는 non-null → CS8602 해소)
                var cur = k.GetValue(RunValueName) as string;
                if (string.IsNullOrEmpty(cur)) return;    // 자동시작 꺼짐 → 새로 만들지 않음(사용자 선택 존중)
                var want = "\"" + ExePath + "\"";
                if (!string.Equals(cur.Trim(), want, StringComparison.OrdinalIgnoreCase))
                    k.SetValue(RunValueName, want);
            }
            catch (Exception ex) { Debug.WriteLine("자동시작 경로 정리 오류: " + ex); }
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
        // 자동 업데이트 소스 폴더 URL(ftp:// · http(s):// · UNC/로컬 경로). 빈 값 = 업데이트 기능 휴면.
        public string UpdateSourceUrl { get; set; } = "";
    }
}
