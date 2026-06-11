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
            base.OnStartup(e);
        }
    }
}
