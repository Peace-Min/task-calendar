using System;
using System.Threading;

namespace TaskCalendarWidget
{
    // 디버그 장애 주입이 던지는 예외. MySqlException 은 공개 생성자가 없어 만들 수 없으므로
    // 스스로 kind 를 들고 다닌다 — DbErrors.Classify 가 이 Kind 를 그대로 쓴다.
    internal sealed class DbFaultException : Exception
    {
        public string Kind { get; }
        public int Number { get; }
        public DbFaultException(string kind, int number, string message) : base(message)
        {
            Kind = kind;
            Number = number;
        }
    }

    // ================================================================================
    //  DbFault — QA 를 위한 DB 장애 주입(디버그 전용) · 기획서 §7
    // ================================================================================
    //  ★ TC_DEBUG_PORT 가 설정된 실행에서만 켜진다(Enabled). 배포 실행에서는 __dbFault 명령이
    //    거부되고(MainWindow.RunDbFault) 모드가 바뀔 길이 없으므로 ThrowIfActive 는 아무 일도 안 한다.
    //    Enabled 는 **시작 때 한 번** 환경변수에서 읽고 이후 바뀌지 않는다(setter 없음).
    //  mode:
    //    off         — 정상
    //    network     — 모든 DB 열기가 연결 실패처럼 던진다(2003 · kind=network)
    //    auth        — 모든 DB 열기가 1045 처럼 던진다(kind=auth)
    //    commit-lost — **다음 저장 1회**는 COMMIT 까지 정상으로 한 뒤 응답 직전에 네트워크 오류로 끊는다(S9 재현).
    //                  한 번 터지면 off 로 돌아간다(한 발짜리).
    internal static class DbFault
    {
        public static readonly bool Enabled = DebugPortSet(Environment.GetEnvironmentVariable("TC_DEBUG_PORT"));

        // MainWindow 가 원격 디버깅 포트를 여는 판정과 같은 규칙(정수 1~65535)이다 — 둘이 갈리면
        // '포트는 안 열렸는데 장애 주입은 켜진' 실행이 생긴다.
        private static bool DebugPortSet(string? v) =>
            !string.IsNullOrWhiteSpace(v) && int.TryParse(v, out var p) && p > 0 && p < 65536;

        private const int Off = 0, Network = 1, Auth = 2, CommitLost = 3;
        private static int _mode = Off;

        public static string Mode => Volatile.Read(ref _mode) switch
        {
            Network => "network",
            Auth => "auth",
            CommitLost => "commit-lost",
            _ => "off",
        };

        // 모드 바꾸기. Enabled 가 아니면 거부한다(호출자가 이미 막지만 두 번째 문이다).
        public static bool TrySetMode(string? mode, out string error)
        {
            error = "";
            if (!Enabled) { error = "디버그 실행에서만 쓸 수 있습니다"; return false; }
            int m;
            switch ((mode ?? "").Trim())
            {
                case "off": m = Off; break;
                case "network": m = Network; break;
                case "auth": m = Auth; break;
                case "commit-lost": m = CommitLost; break;
                default: error = "알 수 없는 mode: " + mode; return false;
            }
            Volatile.Write(ref _mode, m);
            return true;
        }

        // 모든 DB 열기 지점(CalendarDb · CalendarWriteDb · ProjectDb · ReportDb · dbPing)이 연결을 만들기 직전에 부른다.
        public static void ThrowIfActive()
        {
            if (!Enabled) return;
            int m = Volatile.Read(ref _mode);
            if (m == Network)
                throw new DbFaultException(DbErrorKind.Network, 2003,
                    "Unable to connect to any of the specified MySQL hosts. (장애 주입: network)");
            if (m == Auth)
                throw new DbFaultException(DbErrorKind.Auth, 1045,
                    "Access denied for user (장애 주입: auth)");
        }

        // commit-lost 한 발 — COMMIT 직후에 부른다. 켜져 있었으면 off 로 되돌리고 true(호출자가 던진다).
        public static bool ConsumeCommitLost()
        {
            if (!Enabled) return false;
            return Interlocked.CompareExchange(ref _mode, Off, CommitLost) == CommitLost;
        }

        public static DbFaultException CommitLostException() =>
            new DbFaultException(DbErrorKind.Network, 2013,
                "Lost connection to MySQL server during query (장애 주입: commit-lost — COMMIT 은 됐다)");
    }
}
