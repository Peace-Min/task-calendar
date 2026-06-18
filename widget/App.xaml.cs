using System;
using System.Threading;
using System.Windows;

namespace TaskCalendarWidget
{
    public partial class App : Application
    {
        private static Mutex? _instanceMutex;
        private static EventWaitHandle? _showEvent;
        private const string MutexName = "TaskCalendarWidget_SingleInstance_2C8F";
        private const string ShowEventName = "TaskCalendarWidget_ShowExisting_2C8F";

        protected override void OnStartup(StartupEventArgs e)
        {
            // 단일 인스턴스 보장 — 자동 시작 + 수동 실행이 겹쳐 위젯이 두 개 뜨는 것 방지.
            _instanceMutex = new Mutex(true, MutexName, out bool created);
            if (!created)
            {
                // 이미 실행 중. 기존 인스턴스를 앞으로 불러오고(가능하면) 종료한다.
                // 신호를 못 보내면(예: 이 기능 없는 구버전이 떠 있음) '왜 안 뜨지?' 혼란을 없애도록 안내한다.
                bool summoned = false;
                try
                {
                    if (EventWaitHandle.TryOpenExisting(ShowEventName, out var ev)) { ev.Set(); summoned = true; }
                }
                catch { }
                if (!summoned)
                {
                    MessageBox.Show(
                        "수행과제캘린더가 이미 실행 중입니다.\n\n" +
                        "바탕화면 위젯 모드에서는 다른 창 뒤(바탕화면)에 있어 화면에 보이지 않을 수 있습니다.\n" +
                        "트레이/작업표시줄에도 없으면, 작업 관리자에서 '수행과제캘린더'(또는 TaskCalendarWidget) 프로세스를\n" +
                        "종료한 뒤 다시 실행하세요.",
                        "수행과제캘린더 — 이미 실행 중", MessageBoxButton.OK, MessageBoxImage.Information);
                }
                Shutdown();
                return;
            }

            // 두 번째 실행이 신호하면 기존 위젯을 앞으로 불러온다(바탕화면 모드라 안 보이는 위젯을 찾는 용도).
            try
            {
                _showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
                var pump = new Thread(() =>
                {
                    while (true)
                    {
                        try { _showEvent.WaitOne(); }
                        catch { break; }
                        try { Current?.Dispatcher.BeginInvoke(new Action(() => (Current?.MainWindow as MainWindow)?.SummonToFront())); }
                        catch { }
                    }
                })
                { IsBackground = true, Name = "ShowExistingPump" };
                pump.Start();
            }
            catch { }

            // 크래시/비정상 종료 시에도 트레이 아이콘 잔상(ghost) 방지
            DispatcherUnhandledException += (_, __) => CleanupTray();
            AppDomain.CurrentDomain.ProcessExit += (_, __) => CleanupTray();
            base.OnStartup(e);
        }

        protected override void OnExit(ExitEventArgs e)
        {
            CleanupTray();
            base.OnExit(e);
        }

        private void CleanupTray()
        {
            try { (Current?.MainWindow as MainWindow)?.CleanupScrim(); } catch { }   // 넓게 보기 딤 배경 고스트 방지
            try { (Current?.MainWindow as MainWindow)?.CleanupTray(); } catch { }
        }
    }
}
