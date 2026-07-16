using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Threading;
using Microsoft.Win32;

namespace TaskCalendarWidget
{
    // 일정 시작 전 OS 알림(에스컬레이션 60→30→10→5분, '확인' 시 종료). 폐쇄망·무음 대응으로
    // Windows 토스트가 아닌 별도 Topmost WPF 창 + 작업표시줄 깜빡임(FlashWindowEx)을 쓴다.
    // 트레이 ON/OFF 무관(본체와 분리된 창). 상태는 reminders.json에 영속.
    public partial class MainWindow
    {
        private static readonly int[] REM_FIRE = { 60, 30, 10, 5 };
        private DispatcherTimer? _remTimer;
        private readonly List<RemOcc> _remSched = new();
        private bool _remEnabled = true;
        private bool _remInited;
        private string _remTheme = "light";
        private readonly Dictionary<string, string> _remAcks = new();   // key → ackedAt(iso)
        private string RemFile => Path.Combine(_dataDir, "reminders.json");

        private sealed class RemOcc
        {
            public string Key = "", Title = "", OccStart = "", StartTime = "", EndTime = "", Loc = "", Color = "";
            public DateTime Start;
            public int[] Fire = REM_FIRE;   // 이 일정의 알림 사다리(분, 내림차순). 기본=REM_FIRE → mins 없는 페이로드는 기존 동작 그대로
            public int StageIndex;          // 다음에 띄울 단계 인덱스(0=첫 단계 … Fire.Length=소진)
            public bool Acked, Expired;
            public ReminderWindow? Win;
        }

        private void ReminderInit()
        {
            if (_remInited) return;
            _remInited = true;
            RemLoad();
            _remTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(20) };
            _remTimer.Tick += (_, _) => RemTick();
            if (_remEnabled) _remTimer.Start();
            // 절전 복귀·시계 변경 시 즉시 재평가(놓친 단계 보정)
            try { SystemEvents.PowerModeChanged += (_, ev) => { if (ev.Mode == PowerModes.Resume) Dispatcher.Invoke(RemTick); }; } catch { }
            try { SystemEvents.TimeChanged += (_, _) => Dispatcher.Invoke(RemTick); } catch { }
            JsCall("window.__setReminders && window.__setReminders(" + (_remEnabled ? "true" : "false") + ")");
            Log("reminders init: enabled=" + _remEnabled + " acks=" + _remAcks.Count);
        }

        // JS reminderSync 수신 — 향후 48h occurrence 목록 + 현재 테마(단일 진실: recur 전개는 JS expandOccurrences)
        private void RemSync(JsonDocument doc)
        {
            try
            {
                var root = doc.RootElement;
                if (root.TryGetProperty("theme", out var th) && th.ValueKind == JsonValueKind.String) _remTheme = th.GetString() ?? "light";
                var incoming = new List<RemOcc>();
                if (root.TryGetProperty("occ", out var arr) && arr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var o in arr.EnumerateArray())
                    {
                        var r = new RemOcc
                        {
                            Key = RGet(o, "key"), Title = RGet(o, "title"), OccStart = RGet(o, "occStart"),
                            StartTime = RGet(o, "startTime"), EndTime = RGet(o, "endTime"), Loc = RGet(o, "loc"), Color = RGet(o, "color"),
                        };
                        if (string.IsNullOrEmpty(r.Key)) continue;
                        // ★P0: occStart+startTime → 로컬 DateTime 파싱(실패 항목은 제외). 빠지면 전 알림 무발화.
                        if (!DateTime.TryParseExact(r.OccStart + " " + r.StartTime,
                                new[] { "yyyy-MM-dd HH:mm", "yyyy-MM-dd H:mm" },
                                CultureInfo.InvariantCulture, DateTimeStyles.None, out r.Start))
                        { Log("reminder 시각 파싱 실패: '" + r.OccStart + " " + r.StartTime + "'"); continue; }
                        if (string.IsNullOrEmpty(r.Title)) r.Title = "(제목 없음)";
                        r.Fire = ParseFire(RGet(o, "mins"));   // 일정별 알림 설정(없으면 기본 사다리)
                        r.Acked = _remAcks.ContainsKey(r.Key);
                        incoming.Add(r);
                    }
                }
                // 같은 키의 기존 단계·창 보존
                foreach (var inn in incoming)
                {
                    var prev = _remSched.FirstOrDefault(p => p.Key == inn.Key);
                    if (prev != null)
                    {
                        inn.Win = prev.Win; inn.Expired = prev.Expired;
                        // 사다리가 그대로일 때만 단계 유지 — 알림 설정이 바뀌었으면 0부터 재평가(중복/누락 방지)
                        inn.StageIndex = prev.Fire.SequenceEqual(inn.Fire) ? prev.StageIndex : 0;
                    }
                }
                // 사라진(삭제/시간변경) occurrence의 열린 창 닫기
                foreach (var p in _remSched)
                    if (p.Win != null && incoming.All(i => i.Key != p.Key)) { try { p.Win.CloseHard(); } catch { } }
                _remSched.Clear();
                _remSched.AddRange(incoming);
                Log("reminderSync: " + incoming.Count + " occ, theme=" + _remTheme);
                RemTick();
            }
            catch (Exception ex) { Log("reminderSync 예외: " + ex.Message); }
        }

        private static string RGet(JsonElement o, string k) => o.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";

        // "30" | "60,30,10,5" → int[] (내림차순·중복제거·양수만). 비거나 잘못되면 기본 사다리.
        private static int[] ParseFire(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return REM_FIRE;
            var list = new List<int>();
            foreach (var part in raw.Split(','))
                if (int.TryParse(part.Trim(), out var v) && v > 0 && !list.Contains(v)) list.Add(v);
            if (list.Count == 0) return REM_FIRE;
            list.Sort((a, b) => b.CompareTo(a));   // 내림차순(60,30,10,5) — RemTick의 target 스캔 규약과 동일
            return list.ToArray();
        }

        private void RemTick()
        {
            if (!_remEnabled) return;
            var now = DateTime.Now;
            foreach (var o in _remSched)
            {
                if (o.Acked || o.Expired) continue;
                double m = (o.Start - now).TotalMinutes;
                if (m <= 0)   // 시작 지남 → 종료(시작 전 알림이므로). 창 닫기.
                {
                    if (o.Win != null) { try { o.Win.CloseHard(); } catch { } o.Win = null; }
                    o.Expired = true;
                    continue;
                }
                // m이 이미 지난 임계 중 '가장 임박한(가장 작은)' 단계 = 인덱스가 가장 큰 것. 부팅 중간 진입도 자동 처리.
                int target = -1;
                for (int i = 0; i < o.Fire.Length; i++) if (m <= o.Fire[i]) target = i;
                if (target < 0) continue;              // 아직 첫 알림 시점 밖
                if (target >= o.StageIndex)            // 새 단계 도달(에스컬레이션 포함)
                {
                    o.StageIndex = target + 1;
                    int disp = Math.Max(1, (int)Math.Ceiling(m));   // 표시=실제 남은 분, 색=단계
                    ShowOrUpdate(o, o.Fire[target], disp);
                }
            }
        }

        private void ShowOrUpdate(RemOcc o, int stageMins, int dispMins)
        {
            try
            {
                // 색=단계(60 파랑·30 호박·10 주황·5 빨강), 표시 숫자=실제 남은 분
                string urgency = stageMins >= 60 ? "#5b7cfa" : stageMins >= 30 ? "#d9a23a" : stageMins >= 10 ? "#e8743b" : "#e0524e";
                if (o.Win == null || !o.Win.Alive)
                {
                    int idx = _remSched.Count(x => x.Win != null && x.Win.Alive);   // 스택 오프셋(겹침 방지)
                    Log("reminder fire: '" + o.Title + "' " + dispMins + "m (stage " + stageMins + ", theme " + _remTheme + ")");
                    o.Win = new ReminderWindow(o.Title, o.OccStart, o.StartTime, o.EndTime, o.Loc, dispMins, urgency, RemPalette(_remTheme), () => RemAck(o));
                    o.Win.ShowReminder(idx);
                }
                else o.Win.UpdateStage(dispMins, urgency);
            }
            catch (Exception ex) { Log("reminder 창 예외: " + ex.Message); }
        }

        private void RemAck(RemOcc o)
        {
            o.Acked = true;
            _remAcks[o.Key] = DateTime.Now.ToString("o");
            if (o.Win != null) { try { o.Win.CloseHard(); } catch { } o.Win = null; }
            RemSave();
        }

        private void SetRemindersEnabled(bool on)
        {
            _remEnabled = on;
            if (on) { _remTimer?.Start(); RemTick(); }
            else { _remTimer?.Stop(); foreach (var o in _remSched) { if (o.Win != null) { try { o.Win.CloseHard(); } catch { } o.Win = null; } } }
            RemSave();
            JsCall("window.__setReminders && window.__setReminders(" + (on ? "true" : "false") + ")");
            Log("reminders enabled=" + on);
        }

        public void CleanupReminders()
        {
            try { _remTimer?.Stop(); } catch { }
            foreach (var o in _remSched) { try { o.Win?.CloseHard(); } catch { } }
        }

        // ----- 영속(reminders.json) : enabled + acks. read-modify-write, 손상 방어, GC. -----
        private void RemLoad()
        {
            try
            {
                if (!File.Exists(RemFile)) { _remEnabled = true; return; }
                using var d = JsonDocument.Parse(File.ReadAllText(RemFile, Encoding.UTF8));
                var root = d.RootElement;
                if (root.TryGetProperty("enabled", out var en) && (en.ValueKind == JsonValueKind.True || en.ValueKind == JsonValueKind.False)) _remEnabled = en.GetBoolean();
                if (root.TryGetProperty("acks", out var a) && a.ValueKind == JsonValueKind.Object)
                    foreach (var p in a.EnumerateObject())
                        _remAcks[p.Name] = p.Value.ValueKind == JsonValueKind.String ? (p.Value.GetString() ?? "") : DateTime.Now.ToString("o");
            }
            catch (Exception ex)
            {
                Log("reminders 로드 실패(기본값 사용): " + ex.Message);
                try { if (File.Exists(RemFile)) File.Copy(RemFile, RemFile + ".bak", true); } catch { }
                _remEnabled = true;
            }
        }

        private void RemSave()
        {
            try
            {
                Directory.CreateDirectory(_dataDir);
                // GC: 키 = seriesId|occStart|startTime → occStart가 그제 이전이면 제거(파일 비대 방지)
                var cutoff = DateTime.Now.Date.AddDays(-1);
                foreach (var k in _remAcks.Keys.ToList())
                {
                    var parts = k.Split('|');
                    if (parts.Length >= 2 && DateTime.TryParseExact(parts[1], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var od) && od < cutoff)
                        _remAcks.Remove(k);
                }
                var obj = new Dictionary<string, object> { ["version"] = 1, ["enabled"] = _remEnabled, ["acks"] = _remAcks };
                string tmp = RemFile + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(obj), new UTF8Encoding(false));
                File.Move(tmp, RemFile, true);
            }
            catch (Exception ex) { Log("reminders 저장 실패: " + ex.Message); }
        }

        // 테마별 카드 팔레트(앱 6테마). 긴급 헤더·테두리는 단계색으로 별도 고정.
        private static RemTheme RemPalette(string theme) => theme switch
        {
            "dark"     => new RemTheme { Panel = "#1a2031", Text = "#e6e9f2", Muted = "#a8b0c3", Line = "#3a4357", BtnBg = "#e9ecf4", BtnText = "#141a28", HeadText = "#ffffff" },
            "forest"   => new RemTheme { Panel = "#ffffff", Text = "#1d2a22", Muted = "#54665b", Line = "#c3d6c8", BtnBg = "#243027", BtnText = "#ffffff", HeadText = "#ffffff" },
            "sepia"    => new RemTheme { Panel = "#fbf6ec", Text = "#4a3a28", Muted = "#7a6a52", Line = "#d4c2a3", BtnBg = "#3a2e20", BtnText = "#fbf6ec", HeadText = "#ffffff" },
            "contrast" => new RemTheme { Panel = "#ffffff", Text = "#000000", Muted = "#2a2a2a", Line = "#111111", BtnBg = "#000000", BtnText = "#ffffff", HeadText = "#000000" },
            _          => new RemTheme { Panel = "#ffffff", Text = "#1d2433", Muted = "#5b6373", Line = "#d6dbe6", BtnBg = "#2a2f3a", BtnText = "#ffffff", HeadText = "#ffffff" },
        };
    }

    internal sealed class RemTheme
    {
        public string Panel = "", Text = "", Muted = "", Line = "", BtnBg = "", BtnText = "", HeadText = "";
    }

    // 코드-온리 리마인더 창(XAML 불필요). Topmost + ShowInTaskbar + FlashWindowEx(무음 시각 신호).
    internal sealed class ReminderWindow : Window
    {
        [DllImport("user32.dll")] private static extern bool FlashWindowEx(ref FLASHWINFO pwfi);
        [StructLayout(LayoutKind.Sequential)] private struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }
        private const uint FLASHW_ALL = 3, FLASHW_TIMERNOFG = 12;

        public bool Alive { get; private set; } = true;
        private readonly Action _onAck;
        private readonly Border _card, _head;
        private readonly TextBlock _stageTx;

        private static SolidColorBrush SB(string hex) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));

        public ReminderWindow(string title, string occStart, string startTime, string endTime, string loc, int mins, string urgency, RemTheme pal, Action onAck)
        {
            _onAck = onAck;
            Title = "일정 알림"; Width = 300; SizeToContent = SizeToContent.Height;
            WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
            Topmost = true; ShowInTaskbar = true; ShowActivated = false;
            AllowsTransparency = true; Background = Brushes.Transparent;
            WindowStartupLocation = WindowStartupLocation.Manual;

            _card = new Border
            {
                CornerRadius = new CornerRadius(12), Background = SB(pal.Panel),
                BorderBrush = SB(urgency), BorderThickness = new Thickness(2), Margin = new Thickness(10),
                Effect = new DropShadowEffect { BlurRadius = 22, ShadowDepth = 4, Opacity = 0.4, Color = Colors.Black },
                SnapsToDevicePixels = true,
            };
            var root = new StackPanel();

            // 헤더(긴급색) — "N분 후 시작" + 시각 + 닫기(✕)
            _head = new Border { Background = SB(urgency), Padding = new Thickness(12, 7, 9, 7) };
            var hg = new Grid();
            hg.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            hg.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            _stageTx = new TextBlock { Text = mins + "분 후 시작", Foreground = SB(pal.HeadText), FontSize = 12.5, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center };
            var hr = new StackPanel { Orientation = Orientation.Horizontal };
            hr.Children.Add(new TextBlock { Text = startTime, Foreground = SB(pal.HeadText), FontSize = 12, Opacity = 0.92, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center });
            var x = new TextBlock { Text = "✕", Foreground = SB(pal.HeadText), FontSize = 12, Opacity = 0.9, Cursor = Cursors.Hand, VerticalAlignment = VerticalAlignment.Center };
            x.MouseLeftButtonUp += (_, _) => CloseHard();   // 닫기=치우기(다음 단계에 다시 뜸), ack 아님
            hr.Children.Add(x);
            Grid.SetColumn(_stageTx, 0); Grid.SetColumn(hr, 1);
            hg.Children.Add(_stageTx); hg.Children.Add(hr);
            _head.Child = hg;

            // 본체 — 제목 / 시각·장소 / 확인
            var body = new StackPanel { Margin = new Thickness(14, 12, 14, 13) };
            body.Children.Add(new TextBlock { Text = title, Foreground = SB(pal.Text), FontSize = 15.5, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap });
            string meta = startTime + (string.IsNullOrEmpty(endTime) ? "" : " – " + endTime) + (string.IsNullOrEmpty(loc) ? "" : "  ·  " + loc);
            body.Children.Add(new TextBlock { Text = meta, Foreground = SB(pal.Muted), FontSize = 12.5, Margin = new Thickness(0, 5, 0, 0), TextWrapping = TextWrapping.Wrap });

            var okBorder = new Border { Background = SB(pal.BtnBg), CornerRadius = new CornerRadius(8), Cursor = Cursors.Hand, Margin = new Thickness(0, 13, 0, 0) };
            okBorder.Child = new TextBlock { Text = "확인 — 알림 끄기", Foreground = SB(pal.BtnText), FontSize = 13.5, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 9, 0, 9) };
            okBorder.MouseEnter += (_, _) => okBorder.Opacity = 0.9;
            okBorder.MouseLeave += (_, _) => okBorder.Opacity = 1.0;
            okBorder.MouseLeftButtonUp += (_, _) => { try { _onAck(); } catch { } };
            body.Children.Add(okBorder);

            root.Children.Add(_head);
            root.Children.Add(body);
            _card.Child = root;
            Content = _card;

            Closed += (_, _) => Alive = false;
        }

        public void ShowReminder(int stackIndex)
        {
            var wa = SystemParameters.WorkArea;
            const double est = 160;
            Left = wa.Right - Width - 16;
            Top = wa.Bottom - est - 16 - stackIndex * (est + 8);
            Show();
            // 실제 높이로 위치 보정(첫 렌더 후)
            Dispatcher.BeginInvoke(new Action(() =>
            {
                try { Top = wa.Bottom - ActualHeight - 16 - stackIndex * (ActualHeight + 8); } catch { }
            }), DispatcherPriority.Loaded);
            Flash();
        }

        public void UpdateStage(int mins, string urgency)
        {
            if (!Alive) return;
            try
            {
                _stageTx.Text = mins + "분 후 시작";
                _head.Background = SB(urgency);
                _card.BorderBrush = SB(urgency);
                Topmost = false; Topmost = true;   // z-order 위로
                Flash();
            }
            catch { }
        }

        private void Flash()
        {
            try
            {
                var h = new WindowInteropHelper(this).Handle;
                if (h == IntPtr.Zero) return;
                var fi = new FLASHWINFO { cbSize = (uint)Marshal.SizeOf<FLASHWINFO>(), hwnd = h, dwFlags = FLASHW_ALL | FLASHW_TIMERNOFG, uCount = uint.MaxValue, dwTimeout = 0 };
                FlashWindowEx(ref fi);
            }
            catch { }
        }

        public void CloseHard()
        {
            Alive = false;
            try { Close(); } catch { }
        }
    }
}
