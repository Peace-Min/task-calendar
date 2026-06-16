using System;
using System.Threading;
using System.Windows;

namespace TaskCalendarWidget
{
    public partial class App : Application
    {
        private static Mutex? _instanceMutex;

        protected override void OnStartup(StartupEventArgs e)
        {
            // 단일 인스턴스 보장 — 자동 시작 + 수동 실행이 겹쳐 위젯이 두 개 뜨는 것 방지
            _instanceMutex = new Mutex(true, "TaskCalendarWidget_SingleInstance_2C8F", out bool created);
            if (!created)
            {
                Shutdown();
                return;
            }
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
