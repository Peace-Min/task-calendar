using System;
using System.Threading;
using System.Windows;

namespace TaskCalendarWidget
{
    public partial class App : Application
    {
        private static Mutex? _instanceMutex;
        private static EventWaitHandle? _showEvent;
        private static EventWaitHandle? _quitEvent;
        private const string MutexName = "TaskCalendarWidget_SingleInstance_2C8F";
        private const string ShowEventName = "TaskCalendarWidget_ShowExisting_2C8F";
        private const string QuitEventName = "TaskCalendarWidget_QuitExisting_2C8F";

        protected override void OnStartup(StartupEventArgs e)
        {
            // 단일 인스턴스 + '새 실행이 항상 이긴다' 정책(우아한 자기교체).
            // 새 버전을 배포하고 실행하면, 떠 있는 옛 인스턴스에 '깨끗이 종료' 신호를 보내고
            // 그 인스턴스가 빠져나가며 뮤텍스를 놓으면 우리가 새 인스턴스로 인계한다.
            _instanceMutex = new Mutex(true, MutexName, out bool created);
            if (!created)
            {
                // 1) 기존 인스턴스에 종료 신호(있으면). 자동 저장은 변경 시마다 되므로 데이터는 최신 상태.
                try { if (EventWaitHandle.TryOpenExisting(QuitEventName, out var q)) q.Set(); } catch { }

                // 2) 기존 인스턴스가 종료하며 뮤텍스를 놓을 때까지 대기 → 소유권 인계
                bool acquired = false;
                try { acquired = _instanceMutex.WaitOne(TimeSpan.FromSeconds(4)); }
                catch (AbandonedMutexException) { acquired = true; }   // 옛 인스턴스가 종료하며 버린 뮤텍스 → 우리가 소유
                catch { }

                // 3) 제때 종료하지 않으면(예: 종료 신호 없는 구버전) 최후수단 강제 종료 후 재인계
                if (!acquired)
                {
                    KillOtherInstances();
                    try { acquired = _instanceMutex.WaitOne(TimeSpan.FromSeconds(3)); }
                    catch (AbandonedMutexException) { acquired = true; }
                    catch { }
                }
                // acquired 여부와 무관하게 새 인스턴스로 계속 진행(최선 노력 — 교체가 목적).
            }

            // 신호 펌프 설치: (a) 앞으로 가져오기  (b) 종료(다음 실행에게 자리 양보)
            try
            {
                _showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
                StartPump(_showEvent, () => (Current?.MainWindow as MainWindow)?.SummonToFront(), "ShowExistingPump");
            }
            catch { }
            try
            {
                _quitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, QuitEventName);
                // 새 인스턴스가 신호하면: 트레이 정리 후 깨끗이 종료(자동 저장 완료 상태) → 새 인스턴스가 인계
                StartPump(_quitEvent, () => { CleanupTray(); Current?.Shutdown(); }, "QuitPump");
            }
            catch { }

            // 크래시/비정상 종료 시에도 트레이 아이콘 잔상(ghost) 방지
            DispatcherUnhandledException += (_, __) => CleanupTray();
            AppDomain.CurrentDomain.ProcessExit += (_, __) => CleanupTray();
            base.OnStartup(e);
        }

        // 명명된 이벤트를 기다렸다가 UI 스레드에서 동작 실행하는 백그라운드 펌프
        private void StartPump(EventWaitHandle handle, Action action, string name)
        {
            var pump = new Thread(() =>
            {
                while (true)
                {
                    try { handle.WaitOne(); }
                    catch { break; }
                    try { Current?.Dispatcher.BeginInvoke(action); }
                    catch { }
                }
            })
            { IsBackground = true, Name = name };
            pump.Start();
        }

        // 최후수단 — 종료 신호에 응답하지 않는(구버전 등) 동일 앱 프로세스를 강제 종료(자기 자신 제외).
        // 저장은 원자적(temp→rename)이라 강제 종료해도 data.xml 손상 없음.
        private static void KillOtherInstances()
        {
            try
            {
                var me = System.Diagnostics.Process.GetCurrentProcess();
                foreach (var p in System.Diagnostics.Process.GetProcessesByName(me.ProcessName))
                {
                    if (p.Id == me.Id) continue;
                    try { p.Kill(); p.WaitForExit(2000); } catch { }
                }
            }
            catch { }
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
