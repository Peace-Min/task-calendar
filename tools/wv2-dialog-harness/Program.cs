using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using WV = Microsoft.Web.WebView2.Wpf;

namespace wv2test
{
    public static class Program
    {
        static string _mode = "restored";
        static string _out = "result.txt";
        static readonly object _lk = new object();
        static bool _written = false;

        static void Emit(string s)
        {
            lock (_lk)
            {
                if (_written) return;
                _written = true;
                try { File.WriteAllText(_out, _mode + " => " + s + Environment.NewLine); } catch { }
            }
            try { Environment.Exit(0); } catch { }
        }

        [STAThread]
        public static void Main(string[] args)
        {
            if (args.Length > 0) _mode = args[0];
            if (args.Length > 1) _out = args[1];

            // 워치독: 기본 JS 다이얼로그가 실제로 떠서 ExecuteScriptAsync 가 막히면 여기서 끝낸다.
            var wd = new Thread(() => { Thread.Sleep(90000); Emit("BLOCKED_TIMEOUT (default dialog was rendered -> script blocked)"); });
            wd.IsBackground = true; wd.Start();

            var app = new Application();
            var win = new Window
            {
                Title = "wv2test",
                Width = 520,
                Height = 320,
                WindowStartupLocation = WindowStartupLocation.Manual,
                Left = 40,
                Top = 40,
            };
            var wv = new WV.WebView2();
            win.Content = wv;
            win.Loaded += async (_, __) =>
            {
                try { await Run(wv); }
                catch (Exception ex) { Emit("EXCEPTION " + ex.Message); }
            };
            win.Show();
            app.Run(win);
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        static int CountVisibleWindows()
        {
            int n = 0;
            foreach (System.Diagnostics.ProcessThread _ in System.Diagnostics.Process.GetCurrentProcess().Threads) { }
            EnumWindowsProc cb = (h, l) => { if (IsVisible(h)) n++; return true; };
            EnumWindows(cb, IntPtr.Zero);
            GC.KeepAlive(cb);
            return n;
        }

        static string DescribeExtraWindows()
        {
            var sb = new System.Text.StringBuilder();
            EnumWindowsProc cb = (h, l) =>
            {
                if (!IsVisible(h)) return true;
                var cls = new System.Text.StringBuilder(128); GetClassName(h, cls, 128);
                var txt = new System.Text.StringBuilder(256); GetWindowText(h, txt, 256);
                sb.Append("{cls=").Append(cls).Append(",title=").Append(txt).Append("} ");
                return true;
            };
            EnumWindows(cb, IntPtr.Zero);
            GC.KeepAlive(cb);
            return sb.ToString();
        }

        static string DescribeChromeWindows()
        {
            var sb = new System.Text.StringBuilder();
            EnumWindowsProc cb = (h, l) =>
            {
                if (!IsWindowVisible(h)) return true;
                var cls = new System.Text.StringBuilder(128); GetClassName(h, cls, 128);
                if (cls.ToString().IndexOf("Chrome_WidgetWin", StringComparison.OrdinalIgnoreCase) < 0) return true;
                uint pid; GetWindowThreadProcessId(h, out pid);
                string pn = "?";
                try { pn = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { }
                var txt = new System.Text.StringBuilder(256); GetWindowText(h, txt, 256);
                sb.Append("{p=").Append(pn).Append(",cls=").Append(cls).Append(",t=").Append(txt).Append("} ");
                return true;
            };
            EnumWindows(cb, IntPtr.Zero);
            GC.KeepAlive(cb);
            return sb.ToString();
        }

        static bool IsVisible(IntPtr h)
        {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid != (uint)System.Diagnostics.Process.GetCurrentProcess().Id) return false;
            return IsWindowVisible(h);
        }

        delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool IsWindowVisible(IntPtr hWnd);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder s, int n);
        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder s, int n);

        static Task<bool> NavOnce(CoreWebView2 cw, int timeoutMs)
        {
            var tcs = new TaskCompletionSource<bool>();
            void H(object s, CoreWebView2NavigationCompletedEventArgs ev) { cw.NavigationCompleted -= H; tcs.TrySetResult(true); }
            cw.NavigationCompleted += H;
            _ = Task.Delay(timeoutMs).ContinueWith(_ => { try { cw.NavigationCompleted -= H; } catch { } tcs.TrySetResult(false); });
            return tcs.Task;
        }

        const string DOC = "<html><body><h3>wv2test</h3>"
            + "<script>function B(){ if(!confirm('제출하시겠습니까?')) { document.title='CANCELLED'; return; } document.title='ACCEPTED'; }</script>"
            + "</body></html>";

        static async Task Run(WV.WebView2 wv)
        {
            await wv.EnsureCoreWebView2Async();
            var cw = wv.CoreWebView2;
            var log = "";

            // 초기 문서 1회 로드(실제 코드에서 _w2 가 이미 어떤 문서를 들고 있는 상태를 모사)
            var n0 = NavOnce(cw, 8000);
            cw.NavigateToString("<html><body>init</body></html>");
            await n0;

            bool prev = cw.Settings.AreDefaultScriptDialogsEnabled;
            log += "prev=" + prev + "; ";

            // "old" = 변경 전 프로덕션 코드: 설정은 건드리지 않고 핸들러만 붙였다 뗀다.
            if (_mode != "control" && _mode != "old")
            {
                cw.Settings.AreDefaultScriptDialogsEnabled = false;
            }

            // 프로덕션과 완전 동일: AttachDialogAutoAccept 가 핸들러도 부착한다
            int fired = 0;
            void H(object s, CoreWebView2ScriptDialogOpeningEventArgs ev) { fired++; try { ev.Accept(); } catch { } }
            bool useHandler = _mode.StartsWith("prod") || _mode == "old";
            if (useHandler) cw.ScriptDialogOpening += H;

            // 실제 op 의 마지막 문서 로드(= pjm_write.jsp 이동)에 해당
            var n1 = NavOnce(cw, 8000);
            cw.NavigateToString(DOC);
            await n1;

            // op 중에 alert 이 한 번 뜨는 상황(실제 netcus 흐름과 동일)
            if (_mode == "prod_afteralert")
            {
                await cw.ExecuteScriptAsync("alert('op-time alert')");
                log += "fired_during_op=" + fired + "; ";
            }

            if (_mode == "restored" || _mode == "restored_delay" || useHandler)
            {
                // detach() 가 하는 일: 핸들러 해제 + 설정 원복. 새 문서 로드는 이후 없음.
                if (useHandler && _mode != "prod_keephandler") cw.ScriptDialogOpening -= H;
                if (_mode != "prod_norestore" && _mode != "old") cw.Settings.AreDefaultScriptDialogsEnabled = prev;
                log += "readback=" + cw.Settings.AreDefaultScriptDialogsEnabled + "; ";
            }

            if (_mode == "prod_pre")
            {
                // 가설 검증: '사용자에게 넘길 문서'를 로드하기 *전에* 원복+detach 하면 되는가?
                var n2 = NavOnce(cw, 8000);
                cw.NavigateToString(DOC);
                await n2;
            }

            if (_mode == "restored_delay") await Task.Delay(2000);

            int before = CountVisibleWindows();

            // 사용자가 '제출' 버튼을 누르는 것에 해당 — setTimeout 으로 '페이지 자신의' 실행 컨텍스트에서
            // 띄운다(ExecuteScriptAsync 안에서 직접 띄우는 것과 Chromium 처리 경로가 다를 수 있어서).
            await cw.ExecuteScriptAsync("setTimeout(function(){B();},300); 'fired'");
            await Task.Delay(1200);
            if (Environment.GetEnvironmentVariable("WV2HOLD") == "1")
            {
                await Task.Delay(2000);
                try
                {
                    var w = Application.Current.MainWindow;
                    w.Topmost = true; w.Activate(); w.Topmost = true;
                    await Task.Delay(700);
                    var src = System.Windows.PresentationSource.FromVisual(w);
                    double sx = src != null ? src.CompositionTarget.TransformToDevice.M11 : 1.0;
                    double sy = src != null ? src.CompositionTarget.TransformToDevice.M22 : 1.0;
                    int px = (int)(w.Left * sx), py = (int)(w.Top * sy);
                    int pw = (int)(w.Width * sx), ph = (int)(w.Height * sy);
                    using (var bmp = new System.Drawing.Bitmap(pw, ph))
                    using (var gg = System.Drawing.Graphics.FromImage(bmp))
                    {
                        gg.CopyFromScreen(px, py, 0, 0, new System.Drawing.Size(pw, ph));
                        bmp.Save(_mode + "_self.png", System.Drawing.Imaging.ImageFormat.Png);
                    }
                    log += "shot=ok; ";
                }
                catch (Exception ex) { log += "shot_err=" + ex.Message + "; "; }
                await Task.Delay(1000);
                var xs = Environment.GetEnvironmentVariable("WV2EXTRA");
                if (!string.IsNullOrEmpty(xs)) { await Task.Delay(int.Parse(xs) * 1000); log += "extra=" + xs + "s; "; }
            }
            var t = cw.ExecuteScriptAsync("String(document.title)");

            if (useHandler)
            {
                // 2.5초 뒤 우리 프로세스의 '보이는 창' 목록을 찍고, 실제로 Enter 를 눌러 본다.
                // 결과가 ACCEPTED 로 바뀌면 = 사람이 누를 수 있는 진짜 기본 대화상자가 떠 있었다는 뜻.
                await Task.Delay(2500);
                log += "wins_before=" + before + "; wins_during=" + CountVisibleWindows() + "; ";
                log += "own=[" + DescribeExtraWindows() + "] chrome=[" + DescribeChromeWindows() + "]; ";
                try { Application.Current.MainWindow.Activate(); } catch { }
                keybd_event(0x0D, 0, 0, UIntPtr.Zero);
                try { Application.Current.MainWindow.Activate(); } catch { }
                keybd_event(0x0D, 0, 2, UIntPtr.Zero);
            }

            var done = await Task.WhenAny(t, Task.Delay(12000));
            if (done != (Task)t) { Emit("BLOCKED (no result in 5s -> default dialog rendered and is waiting for a click)" + " | " + log); return; }
            Emit("RESULT " + t.Result + " | " + log + "fired_total=" + fired);
        }
    }
}
