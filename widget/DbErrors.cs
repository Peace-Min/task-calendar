using System;
using System.Collections.Generic;
using System.Net.Sockets;
using System.Threading;
using MySqlConnector;

namespace TaskCalendarWidget
{
    // ================================================================================
    //  DB 오류 분류 — 서버(DB) 연결 장애 대응 기획서 §3 (docs/OFFLINE-RESILIENCE.md)
    // ================================================================================
    //  웹으로 가는 kind 는 이 다섯 값뿐이다. 문자열로 두는 이유: 그대로 JSON 에 실리고,
    //  웹이 같은 글자로 분기한다(enum 이면 직렬화 규약이 하나 더 생긴다).
    internal static class DbErrorKind
    {
        public const string Network      = "network";       // 기다리면 풀린다 — 재시도·재연결 확인 대상
        public const string Auth         = "auth";          // 계정·권한·DB 이름 — 설정 문제(관리자). 재시도 안 함
        public const string Schema       = "schema";        // 표·컬럼 없음 — 버전 불일치. 재시도 안 함
        public const string Unregistered = "unregistered";  // 신원이 서지 않는다(app_user 미등록 · 로그인 없음)
        public const string Unknown      = "unknown";       // 그 밖 — 네트워크와 같이 재시도한다
    }

    internal static class DbErrors
    {
        // ── 분류표(§3) — 숫자는 MySQL 서버/클라이언트 오류 번호 ─────────────────────
        //   network : 1042 호스트 연결 불가 · 2002/2003 소켓·TCP 연결 불가 · 2005 호스트 이름 모름 ·
        //             2006 서버가 사라짐 · 2013 질의 중 연결 끊김
        //   auth    : 1044 DB 접근 거부 · 1045 계정/비밀번호 거부 · 1142/1143 표·컬럼 권한 없음 ·
        //             3118 계정 잠김
        //   schema  : 1146 표 없음 · 1054 컬럼 없음
        private static readonly HashSet<int> NetworkCodes = new() { 1042, 2002, 2003, 2005, 2006, 2013 };
        private static readonly HashSet<int> AuthCodes    = new() { 1044, 1045, 1142, 1143, 3118 };
        private static readonly HashSet<int> SchemaCodes  = new() { 1146, 1054 };

        // 재시도 가능 = 기다리면 풀릴 수 있는 실패. auth/schema/unregistered 는 몇 번을 다시 걸어도 같은 답이다.
        public static bool IsRetryable(string kind) => kind == DbErrorKind.Network || kind == DbErrorKind.Unknown;

        // ── 하나의 분류 함수 ─────────────────────────────────────────────────────
        //   예외 사슬(AggregateException 의 내부들 · InnerException)을 바깥에서 안으로 훑어
        //   처음으로 판정이 서는 고리의 kind 를 돌려준다. 끝까지 판정이 안 서면 unknown.
        //   ★ 바깥 MySqlException 이 모르는 번호(0 등)여도 멈추지 않는다 — 원인이 안쪽
        //     SocketException·TimeoutException 에 있는 경우가 흔하다(드라이버가 감싸서 던진다).
        public static string Classify(Exception? ex)
        {
            foreach (var e in Chain(ex))
            {
                string? k = ClassifyOne(e);
                if (k != null) return k;
            }
            return DbErrorKind.Unknown;
        }

        private static string? ClassifyOne(Exception e)
        {
            switch (e)
            {
                case DbFaultException f:                return f.Kind;   // 디버그 장애 주입(§7) — 스스로 kind 를 안다
                case CalendarUserNotFoundException:     return DbErrorKind.Unregistered;
                case MySqlException me:
                    if (NetworkCodes.Contains(me.Number)) return DbErrorKind.Network;
                    if (AuthCodes.Contains(me.Number))    return DbErrorKind.Auth;
                    if (SchemaCodes.Contains(me.Number))  return DbErrorKind.Schema;
                    if (me.ErrorCode == MySqlErrorCode.UnableToConnectToHost ||
                        me.ErrorCode == MySqlErrorCode.CommandTimeoutExpired) return DbErrorKind.Network;   // S8 느린 서버
                    if (IsUnableToConnect(me.Message)) return DbErrorKind.Network;
                    return null;   // 모르는 번호 — 안쪽 원인을 더 본다
                case SocketException:                   return DbErrorKind.Network;
                case TimeoutException:                  return DbErrorKind.Network;
                case OperationCanceledException:        return DbErrorKind.Network;   // TaskCanceledException 포함 — 우리 토큰의 시한
            }
            return IsUnableToConnect(e.Message) ? DbErrorKind.Network : null;
        }

        private static bool IsUnableToConnect(string? m) =>
            m != null && m.IndexOf("Unable to connect", StringComparison.OrdinalIgnoreCase) >= 0;

        // 바깥 → 안. AggregateException 은 내부 예외 전부를 펼친다. 순환 사슬 방어로 깊이를 자른다.
        private static IEnumerable<Exception> Chain(Exception? ex)
        {
            var stack = new Stack<Exception>();
            if (ex != null) stack.Push(ex);
            int guard = 0;
            while (stack.Count > 0 && guard++ < 32)
            {
                var e = stack.Pop();
                yield return e;
                if (e is AggregateException ae)
                {
                    for (int i = ae.InnerExceptions.Count - 1; i >= 0; i--) stack.Push(ae.InnerExceptions[i]);
                }
                else if (e.InnerException != null) stack.Push(e.InnerException);
            }
        }

        // 사슬에서 처음 만나는 MySQL 오류 번호(없으면 0). 번호로 갈라야 하는 호출자용(1062 등).
        public static int Number(Exception? ex)
        {
            foreach (var e in Chain(ex))
            {
                if (e is MySqlException me) return me.Number;
                if (e is DbFaultException f) return f.Number;
            }
            return 0;
        }

        // ── detail — 사람이 신고할 때 쓰는 원문 한 줄(「자세히」에서만 보인다) ──────────
        //   값은 예외의 첫 줄(MySqlException 이 있으면 그 Message)이다. 그 문장에는 비밀번호가 없다 —
        //   그래도 방어적으로 'password' 뒤는 잘라 내고, 배포 비밀번호 원문이 섞이면 가린다.
        //   ★ 이 값을 만드는 곳은 여기 하나뿐이다. 회신·로그·푸시가 모두 이것을 쓴다.
        public static string Detail(Exception? ex)
        {
            if (ex == null) return "";
            Exception pick = ex;
            foreach (var e in Chain(ex))
            {
                if (e is MySqlException || e is DbFaultException) { pick = e; break; }
            }
            if (pick is AggregateException agg && agg.InnerExceptions.Count > 0) pick = agg.InnerExceptions[0];
            return Sanitize(pick.Message ?? pick.GetType().Name);
        }

        internal static string Sanitize(string? raw)
        {
            string m = raw ?? "";
            int nl = m.IndexOfAny(new[] { '\r', '\n' });
            if (nl >= 0) m = m.Substring(0, nl);
            m = m.Trim();
            int pw = m.IndexOf("password", StringComparison.OrdinalIgnoreCase);
            if (pw >= 0) m = m.Substring(0, pw + "password".Length) + "…";   // 'password' 뒤는 싣지 않는다
            string secret = DeployConfig.DbPassword ?? "";
            if (secret.Length >= 3) m = m.Replace(secret, "***", StringComparison.Ordinal);
            if (m.Length > 200) m = m.Substring(0, 200) + "…";
            return m;
        }

        // ── 부팅 실패 문구(§3 · S1/S6/S7) ────────────────────────────────────────
        public static string BootMessage(string kind) => kind switch
        {
            DbErrorKind.Network => "서버에 연결할 수 없습니다 — 서버가 꺼져 있거나 네트워크 문제입니다",
            DbErrorKind.Auth    => "DB 접근이 거부되었습니다 — DB 이름·계정 설정과 서버 권한을 확인하세요(관리자)",
            DbErrorKind.Schema  => "DB 구조가 이 버전과 맞지 않습니다",
            _                   => "서버 오류로 캘린더를 받지 못했습니다",
        };

        // 부팅이 아닌 자리(핑 회신 등)의 같은 분류 문구.
        public static string ConnMessage(string kind) => kind switch
        {
            DbErrorKind.Network => "서버에 연결할 수 없습니다 — 서버가 꺼져 있거나 네트워크 문제입니다",
            DbErrorKind.Auth    => "DB 접근이 거부되었습니다 — DB 이름·계정 설정과 서버 권한을 확인하세요(관리자)",
            DbErrorKind.Schema  => "DB 구조가 이 버전과 맞지 않습니다",
            _                   => "서버 오류 — 잠시 뒤 다시 시도하세요",
        };

        // ── 관찰 지점 — 모든 DB 실패 catch 가 이 한 줄을 부른다 ─────────────────────
        //   ① 분류해서 kind + detail 을 **한 줄** 로그로 남긴다(비밀번호 없음 — detail 이 이미 걸렀다).
        //   ② network 이면 전역 「연결 끊김」 통지(S12)를 올린다. auth/schema 는 올리지 않는다 —
        //      설정 문제라 재연결 확인으로 풀리지 않고, 부팅이 이미 그 문구를 보여 준다.
        //   ③ 진행 중인 캡처(Capture)가 있으면 거기에도 적는다 — 메서드 서명을 바꾸지 않고
        //      호출자가 원인 종류를 받아 가는 길이다(로그인·부팅 회신이 쓴다).
        public static (string kind, string detail) Observe(Exception ex, Action<string>? log, bool notify = true)
        {
            string kind = Classify(ex);
            string detail = Detail(ex);
            try { log?.Invoke("DB 오류 분류: kind=" + kind + " · detail=" + detail); } catch { }
            _capture.Value?.Record(kind, detail);
            if (notify && kind == DbErrorKind.Network)
            {
                try { NetworkFailure?.Invoke(kind, detail); } catch { }
            }
            return (kind, detail);
        }

        //  S12 — 네트워크 종류 실패가 어디서 나든 한 곳으로 모인다. MainWindow 가 구독해 웹에 민다
        //  (MainWindow.NotifyConnLost — 디바운스는 받는 쪽이 한다).
        public static event Action<string, string>? NetworkFailure;

        // ── 캡처 — 호출 흐름(AsyncLocal) 안에서 일어난 마지막 분류를 받아 온다 ──────────
        //   using (var cap = DbErrors.Capture()) { json = await db.LoadXAsync(); if (json == null) use(cap.Kind); }
        //   ★ AsyncLocal 은 await 로 부른 메서드 안으로 흐른다. 안에서 값을 바꾸는 것은 밖으로 돌아오지
        //     않지만, **같은 객체를 고치는 것**은 보인다 — 그래서 객체 하나를 심고 그 안에 적는다.
        private static readonly AsyncLocal<DbErrorCapture?> _capture = new();

        public static DbErrorCapture Capture()
        {
            var c = new DbErrorCapture(_capture.Value);
            _capture.Value = c;
            return c;
        }

        internal static void EndCapture(DbErrorCapture c)
        {
            if (ReferenceEquals(_capture.Value, c)) _capture.Value = c.Previous;
        }
    }

    internal sealed class DbErrorCapture : IDisposable
    {
        internal DbErrorCapture? Previous { get; }
        internal DbErrorCapture(DbErrorCapture? previous) { Previous = previous; }

        public string Kind { get; private set; } = "";      // "" = 분류된 실패 없음
        public string Detail { get; private set; } = "";
        public bool HasError => Kind.Length > 0;

        internal void Record(string kind, string detail) { Kind = kind; Detail = detail; Previous?.Record(kind, detail); }

        public void Dispose() => DbErrors.EndCapture(this);
    }
}
