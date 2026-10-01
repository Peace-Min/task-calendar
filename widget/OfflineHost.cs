using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using MySqlConnector;

namespace TaskCalendarWidget
{
    // ================================================================================
    //  서버(DB) 연결 장애 대응 — 호스트 쪽 (docs/OFFLINE-RESILIENCE.md §3 · §5 · §6 · §7 · S9 · S10 · S12)
    // ================================================================================
    //  MainWindow.xaml.cs 에는 배선(명령 case · catch 한 줄)만 두고 판단은 여기 모은다.
    //  웹으로 나가는 모양(계약):
    //    부팅 실패   window.__applyStateError(message, { retryable, kind, detail, db, host })
    //    저장 실패   saveState 회신 { ok:false, conflict, schemaMismatch, error, kind, detail }
    //    S9 해소     saveState 회신 { ok:true, conflict:false, error:"", rev, ins:0, upd:0, del:0, renamedTo:"", renameError:"", resolvedConflict:true }
    //    로그인 실패 userLogin 회신 { ok:false, msg, kind, detail }   (DB 조회 실패일 때만 kind 가 붙는다)
    //    핑          dbPing 회신   { ok:true } | { ok:false, kind, error, detail }
    //    장애 주입   __dbFault 회신 { ok:true, mode } | { ok:false, error }
    //    S12 푸시    window.__dbConnLost({ kind, detail })              — network 일 때만 · 2초 디바운스
    //    S10 푸시    window.__reportRecordFailed({ which, date, error }) — 10·30·60초 재시도가 모두 실패한 뒤
    //  ★ detail 은 DbErrors.Detail 하나가 만든다(원문 첫 줄 · 'password' 뒤 절단). 비밀번호는 어디에도 싣지 않는다.
    public partial class MainWindow
    {
        // ── 부팅 실패(§3 · S1/S6/S7) ─────────────────────────────────────────────
        //  {retryable, kind, detail, db, host}. db·host 는 「DB 이름·호스트 표시」(S6) — 관리자가 설정을 대조한다.
        private static string StateErrorOpt(bool retryable, string kind, string detail) =>
            JsonSerializer.Serialize(new { retryable, kind, detail, db = DeployConfig.DbName, host = DeployConfig.DbHost });

        //  캘린더 부팅 조회가 실패했고 원인이 분류됐을 때. 재시도 여부는 kind 가 정한다 —
        //  auth/schema 는 몇 번을 다시 걸어도 같은 답이라 자동 재시도하지 않는다(S6/S7).
        private void ApplyBootDbError(DbErrorCapture cap)
        {
            string kind = cap.HasError ? cap.Kind : DbErrorKind.Unknown;
            Log("DB 부팅 조회 실패: kind=" + kind + " · detail=" + cap.Detail);
            ApplyStateError(DbErrors.BootMessage(kind), DbErrors.IsRetryable(kind), kind, cap.Detail);
        }

        // ── S12 — 전역 「연결 끊김」 푸시 ────────────────────────────────────────
        //  어느 DB 경로든 network 종류로 실패하면 DbErrors.NetworkFailure 로 모이고, 여기서 웹에 민다.
        //  ★ network 만 민다. auth/schema 는 설정 문제라 재연결 확인으로 풀리지 않고 부팅이 이미 보여 준다.
        //  ★ 디바운스 2초 — 한 번의 끊김에 과제·코드·발주처 조회가 줄줄이 실패해도 웹은 한 번만 받는다.
        private const long ConnLostDebounceMs = 2000;
        private long _connLostAtMs;   // Environment.TickCount64 (0 = 아직 없음)
        private bool _offlineHooked;

        private void OfflineHostInit()
        {
            if (_offlineHooked) return;
            _offlineHooked = true;
            DbErrors.NetworkFailure += NotifyConnLost;
            if (DbFault.Enabled) Log("DB 장애 주입 사용 가능(TC_DEBUG_PORT 실행 — 테스트 전용)");
        }

        private void NotifyConnLost(string kind, string detail)
        {
            if (kind != DbErrorKind.Network) return;
            long now = Environment.TickCount64;
            long last = Interlocked.Read(ref _connLostAtMs);
            if (last != 0 && now - last < ConnLostDebounceMs) return;
            if (Interlocked.CompareExchange(ref _connLostAtMs, now, last) != last) return;   // 동시에 들어온 다른 통지가 이겼다
            string js = "window.__dbConnLost && window.__dbConnLost(" + JsonSerializer.Serialize(new { kind, detail }) + ")";
            Log("연결 끊김 통지(__dbConnLost): " + detail);
            //  ★ BeginInvoke — 백그라운드(보고 기록 저장 등)에서 와도 UI 스레드를 붙잡고 기다리지 않는다.
            try { _ = Dispatcher.BeginInvoke(new Action(() => { try { _ = web.CoreWebView2?.ExecuteScriptAsync(js); } catch { } })); }
            catch { }
        }

        // ── S9 — 응답만 끊긴 저장(COMMIT 은 됨) ─────────────────────────────────────
        //  앞선 저장이 network 로 실패했는데 그 COMMIT 이 실제로는 들어갔다면, 다음 저장은 낡은 토큰을 들고 가서
        //  **가짜 충돌**이 된다(새 행이면 1062). 그때 서버 스냅샷을 다시 읽어 '이 state 를 그 위에 저장해도
        //  바뀌는 것이 없는가'(CalendarWriteDb.DiffIsEmpty — 저장 경로와 같은 행 투영)를 본다.
        //    · 같으면 → 새 스냅샷을 채택하고 성공으로 돌려준다(resolvedConflict:true).
        //    · 다르면 → 진짜 충돌이다. 지금처럼 충돌 상자로 간다.
        private bool _lastSaveNetworkFail;

        private async Task<bool> TryResolveAmbiguousSaveAsync(string reqId, CalendarSaveResult r, string stateJson, CalendarSnapshot snap)
        {
            if (!_lastSaveNetworkFail) return false;
            if (!(r.Conflict || r.DuplicateKey)) return false;
            Log("S9: 앞선 저장이 네트워크 실패였고 이번 저장이 " + (r.Conflict ? "충돌" : "중복 키") + " — 서버 스냅샷을 다시 읽어 대조한다");
            string? loginId = CurrentLoginId();
            if (string.IsNullOrEmpty(loginId)) return false;
            CalendarSnapshot? fresh;
            try { fresh = await new CalendarDb(Log).LoadSnapshotAsync(loginId, RepoPaths.Load(_dataDir, Log).Map); }
            catch (Exception ex) { Log("S9: 다시 읽지 못했다 — 충돌 그대로 둔다: " + DbErrors.Sanitize(ex.Message)); return false; }
            if (fresh == null || fresh.UserId != snap.UserId) { Log("S9: 서버 스냅샷을 받지 못했다 — 충돌 그대로 둔다"); return false; }
            if (!CalendarWriteDb.DiffIsEmpty(stateJson, fresh.StateJson))
            {
                Log("S9: 서버 내용이 이 편집과 다르다 — 진짜 충돌로 둔다");
                return false;
            }
            _calSnap = fresh;
            _lastSaveNetworkFail = false;
            Log("S9: 응답만 끊긴 저장이었다 — 서버가 이미 같은 내용이다(rev=" + fresh.Rev + "). 새 스냅샷을 채택하고 성공으로 돌려준다");
            GitReply(reqId, new { ok = true, conflict = false, error = "", rev = fresh.Rev, ins = 0, upd = 0, del = 0, renamedTo = "", renameError = "", resolvedConflict = true });
            return true;
        }

        // ── §5 재연결 확인 — dbPing ──────────────────────────────────────────────
        //  캘린더와 같은 접속 대상 · 연결 대기 3초 · SELECT 1. 웹이 'offline' 일 때만 부른다(정상일 때 폴링 없음).
        //  ★ 핑 실패는 __dbConnLost 를 다시 밀지 않는다(notify:false) — 핑을 부른 웹이 이미 끊긴 줄 알고, 회신으로 받는다.
        private async Task RunDbPingAsync(string reqId)
        {
            try
            {
                DbFault.ThrowIfActive();
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                await using var conn = new MySqlConnection(CalendarDb.BuildPingConnString());
                await conn.OpenAsync(cts.Token);
                await using (var cmd = new MySqlCommand("SELECT 1", conn))
                    await cmd.ExecuteScalarAsync(cts.Token);
                Log("DB 핑: 성공");
                GitReply(reqId, new { ok = true });
            }
            catch (Exception ex)
            {
                var (kind, detail) = DbErrors.Observe(ex, Log, notify: false);
                Log("DB 핑: 실패(" + kind + ")");
                GitReply(reqId, new { ok = false, kind, error = DbErrors.ConnMessage(kind), detail });
            }
        }

        // ── §7 장애 주입(디버그 전용) ─────────────────────────────────────────────
        //  ★ TC_DEBUG_PORT 로 띄운 실행에서만 받는다(DbFault.Enabled — 시작 때 한 번 정해진다).
        private void RunDbFault(string reqId, string mode)
        {
            string m = (mode ?? "").Length > 40 ? mode!.Substring(0, 40) : (mode ?? "");
            if (!DbFault.Enabled)
            {
                Log("__dbFault 거부 — 배포 실행(TC_DEBUG_PORT 없음)에서는 장애 주입을 받지 않는다(mode=" + m + ")");
                GitReply(reqId, new { ok = false, error = "디버그 실행에서만 쓸 수 있습니다" });
                return;
            }
            if (!DbFault.TrySetMode(m, out var err))
            {
                Log("__dbFault 거부: " + err);
                GitReply(reqId, new { ok = false, error = err });
                return;
            }
            Log("DB 장애 주입 모드: " + DbFault.Mode);
            GitReply(reqId, new { ok = true, mode = DbFault.Mode });
        }

        // ── S10 — 보고 기록 저장 재시도 ──────────────────────────────────────────
        //  보고는 이미 회사 사이트로 나갔다. 기록(cal_report_*) 저장이 **예외로** 실패하면 10·30·60초 뒤 다시 한다.
        //  셋 다 실패하면 화면에 알린다 — 「보고는 전송됐지만 기록 저장에 실패했습니다」(문구는 웹의 몫).
        //  ★ 건너뜀(로그인 없음·빈 본문 — ReportDb.LastFailure == null)은 재시도하지 않는다. 다시 해도 같다.
        private static readonly int[] ReportRetryDelaysSec = { 10, 30, 60 };

        private async Task SaveReportRecordWithRetryAsync(string which, string date, ReportDb db, Func<Task<bool>> save)
        {
            string label = which == "weekly" ? "주간" : "일간";
            if (await TryReportSaveAsync(label, save)) return;
            if (db.LastFailure == null) return;
            foreach (int sec in ReportRetryDelaysSec)
            {
                await Task.Delay(TimeSpan.FromSeconds(sec));
                Log("보고 기록 저장 재시도(" + label + " " + date + ") — " + sec + "초 뒤");
                if (await TryReportSaveAsync(label, save)) { Log("보고 기록 저장 재시도 성공(" + label + " " + date + ")"); return; }
                if (db.LastFailure == null) return;
            }
            string error = db.LastFailure ?? "";
            Log("보고 기록 저장 최종 실패(" + label + " " + date + ") — 10·30·60초 재시도 모두 실패: " + error);
            string js = "window.__reportRecordFailed && window.__reportRecordFailed(" + JsonSerializer.Serialize(new { which, date, error }) + ")";
            try { _ = Dispatcher.BeginInvoke(new Action(() => { try { _ = web.CoreWebView2?.ExecuteScriptAsync(js); } catch { } })); }
            catch { }
        }

        private async Task<bool> TryReportSaveAsync(string label, Func<Task<bool>> save)
        {
            try { return await save(); }
            catch (Exception ex) { Log("보고 기록 저장 예외(" + label + "): " + ex.Message); return false; }
        }

        // ── §6 닫기 경고(S4) ────────────────────────────────────────────────────
        //  웹이 '저장되지 않은 변경' 표시가 바뀔 때마다 unsavedState {on} 을 보낸다. 사용자가 시작한 종료
        //  (✕ · 트레이 「종료」 · ⚙ 종료 · Alt+F4)에서 그 값이 참이면 묻는다. 「아니오」면 닫지 않는다.
        //  ★ Windows 세션 종료(로그오프·재부팅)와 시스템 종료(새 인스턴스 인계·업데이트 설치)는 막지 않는다 — 로그만.
        //  ★ 한 번 「예」를 받으면 다시 묻지 않는다(ExitApp → Shutdown → Window_Closing 이중 질문 방지).
        private const string UnsavedCloseText =
            "저장되지 않은 변경이 있습니다.\n지금 닫으면 이 변경은 사라집니다.\n\n그래도 닫을까요?";

        private volatile bool _webUnsaved;
        private bool _closeConfirmed;
        private bool _closePrompting;
        private volatile bool _sessionEnding;
        private volatile bool _systemExit;

        private void SetWebUnsaved(bool on)
        {
            if (_webUnsaved != on) Log("미저장 변경 표시(unsavedState): " + (on ? "켜짐" : "꺼짐"));
            _webUnsaved = on;
        }

        // App.OnSessionEnding 이 부른다 — 이 뒤의 창 닫기는 묻지 않는다(세션 끝을 막지 않는다).
        internal void MarkSessionEnding(string reason)
        {
            _sessionEnding = true;
            Log("Windows 세션 종료(" + reason + ")" + (_webUnsaved ? " — 저장되지 않은 변경이 있지만 막지 않는다" : ""));
        }

        // 사용자가 고른 종료가 아닌 종료(새 인스턴스 인계 · 업데이트 설치) — 묻지 않는다.
        internal void MarkSystemExit(string why)
        {
            _systemExit = true;
            Log("시스템 종료(" + why + ")" + (_webUnsaved ? " — 저장되지 않은 변경이 있지만 막지 않는다" : ""));
        }

        // true = 닫아도 된다.
        private bool ConfirmCloseIfUnsaved(string via)
        {
            if (_closeConfirmed) return true;
            if (_sessionEnding || _systemExit)
            {
                if (_webUnsaved) Log("닫기 경고 생략(" + via + ") — 세션·시스템 종료는 막지 않는다(미저장 변경 버림)");
                _closeConfirmed = true;
                return true;
            }
            if (!_webUnsaved) { _closeConfirmed = true; return true; }
            if (_closePrompting) return false;   // 이미 묻는 중 — 두 번째 질문 창을 띄우지 않는다
            _closePrompting = true;
            MessageBoxResult ans;
            try
            {
                ans = MessageBox.Show(UnsavedCloseText, "수행과제 캘린더", MessageBoxButton.YesNo,
                                      MessageBoxImage.Warning, MessageBoxResult.No);
            }
            finally { _closePrompting = false; }
            bool yes = ans == MessageBoxResult.Yes;
            Log("닫기 경고(" + via + "): " + (yes ? "그래도 닫는다 — 미저장 변경을 버린다" : "취소 — 닫지 않는다"));
            if (yes) _closeConfirmed = true;
            return yes;
        }
    }
}
