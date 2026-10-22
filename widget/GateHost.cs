using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace TaskCalendarWidget
{
    // ================================================================================
    //  버전 관문: 호스트 쪽 배선 (docs/VERSION-GATE.md §2.3, §2.5, §2.6)
    // ================================================================================
    //  판정은 DbGate 가 하고, 여기는 그 판정을 웹(메인 창과 따로 뜨는 창)에 알리고(푸시), 막힌 동안 다시 확인하고(루프),
    //  회신에 관문 정보를 붙인다. MainWindow.xaml.cs 에는 배선(명령 case 한 줄씩)만 둔다.
    //  웹으로 나가는 모양(계약):
    //    푸시   window.__versionGate({ state, appVersion, appStructure, dbStructure, latestVersion, installerPath,
    //                                  installFailedTarget?, attemptCount? })
    //           state = 'ok' | 'updating' | 'needUpdate' | 'serverOld' | 'unknown' | 'installFailed'
    //    회신   { ok:false, kind:'gate', gate:{ state, dbStructure, appStructure }, ...원래 필드 }
    //    명령   gateRecheck → { ok:true, state } | { ok:false, kind, error, detail }
    public partial class MainWindow
    {
        private bool _gateHooked;
        private string _gateLastPushed = "";       // 마지막으로 민 JSON. 같은 것을 연달아 밀지 않는다
        private string _gateLastState = "ok";      // 마지막으로 민 DB 판정. 처음은 정상으로 본다(정상을 굳이 밀지 않는다)
        private System.Windows.Threading.DispatcherTimer? _gateTimer;
        private int _gateRecheckBusy;              // 0/1. 루프와 웹 명령이 겹쳐도 연결을 한 번만 연다
        private bool _gateReadyOnce;

        //  설치 실패(update-attempt.json, Update.cs 의 CheckUpdateAttempt 가 채운다). 빈 값 = 실패 기록 없음.
        private string _installFailedTarget = "";
        private int _installFailedCount;
        private string _installFailedFile = "";

        // 생성자에서 한 번. 웹이 뜨기 전의 DB 조회(loadProjects 등)도 판정을 남기므로 일찍 건다.
        private void GateHostInit()
        {
            if (_gateHooked) return;
            _gateHooked = true;
            DbGate.Observed += OnGateObserved;
        }

        // DbGate 는 어느 스레드에서든 부른다. UI 스레드로 넘기고 기다리지 않는다.
        private void OnGateObserved(GateSnapshot s)
        {
            try { _ = Dispatcher.BeginInvoke(new Action(ApplyGateState)); }
            catch { }
        }

        //  웹 ready 때. 설치 실패 기록을 한 번 보고, 이미 막혀 있으면 지금 상태를 다시 민다(웹이 새로 떴다).
        private void GateOnReady()
        {
            if (!_gateReadyOnce)
            {
                _gateReadyOnce = true;
                CheckUpdateAttempt();
            }
            _gateLastPushed = "";
            var last = DbGate.Last;
            if (last != null && last.Verdict != GateVerdict.Ok) ApplyGateState();
            else if (_installFailedTarget.Length > 0) PushGate(GateJson(last, forceInstallFailed: true));
        }

        //  따로 뜨는 창(열람 창, 관리 창)이 떴다. 막혀 있으면 그 창에도 같은 상태를 민다(메인 창 중복 푸시는 막는다).
        private void GatePushToWin(WinKind k)
        {
            var last = DbGate.Last;
            if (last == null || last.Verdict == GateVerdict.Ok) return;
            string js = "window.__versionGate && window.__versionGate(" + GateJson(last) + ")";
            try { _ = WinOf(k)?.Core?.ExecuteScriptAsync(js); } catch { }
        }

        //  마지막 판정을 반영한다(UI 스레드). 이벤트가 늦게 와도 늘 최신 값(DbGate.Last)을 쓴다.
        private void ApplyGateState()
        {
            var s = DbGate.Last;
            if (s == null) return;
            GateTimerFor(s.Verdict);
            if (s.Verdict == GateVerdict.Ok)
            {
                if (_gateLastState == "ok") return;   // 처음부터 정상이었다. 알릴 것이 없다
                _gateLastState = "ok";
                Log("버전 관문: 정상으로 돌아왔다(웹이 다시 읽는다)");
                PushGate(GateJson(s));
                return;
            }
            if (_gateLastState != s.State) Log("버전 관문: " + s.State + " (DB 구조 " + s.DbStructure + ", 앱 구조 " + DbGate.AppStructureVersion + ")");
            _gateLastState = s.State;
            PushGate(GateJson(s));
        }

        private void PushGate(string json)
        {
            if (json == _gateLastPushed) return;   // 같은 것을 연달아 밀지 않는다(연결마다 판정이 온다)
            _gateLastPushed = json;
            string js = "window.__versionGate && window.__versionGate(" + json + ")";
            try { _ = web.CoreWebView2?.ExecuteScriptAsync(js); } catch (Exception ex) { Log("관문 푸시 실패: " + ex.Message); }
            foreach (var w in _wins.Values.ToList()) { try { _ = w.Core?.ExecuteScriptAsync(js); } catch { } }   // 열람 창, 관리 창도 같은 카드(VERSION-GATE §3)
        }

        //  푸시 JSON. 업데이트가 필요한데 지난 설치가 실패했으면 상태를 installFailed 로 바꿔 수동 설치 안내로 보낸다.
        private string GateJson(GateSnapshot? s, bool forceInstallFailed = false)
        {
            bool failed = _installFailedTarget.Length > 0 &&
                          (forceInstallFailed || (s != null && s.Verdict == GateVerdict.NeedUpdate));
            string file = s != null && s.Meta.InstallerFile.Length > 0 ? s.Meta.InstallerFile : (failed ? _installFailedFile : "");
            var o = new JsonObject
            {
                ["state"] = failed ? "installFailed" : (s?.State ?? "ok"),
                ["appVersion"] = OwnVersion()?.ToString(3) ?? "",
                ["appStructure"] = DbGate.AppStructureVersion,
                ["dbStructure"] = s?.DbStructure ?? "",
                ["latestVersion"] = s?.Meta.LatestVersion ?? "",
                ["installerPath"] = InstallerPath(file),
            };
            if (failed)
            {
                o["installFailedTarget"] = _installFailedTarget;
                o["attemptCount"] = _installFailedCount;   // 2 이상이면 웹은 자동 재시도 대신 수동 설치 안내만 보인다
            }
            return o.ToJsonString();
        }

        //  수동 설치 경로 = 업데이트 소스 폴더 + 설치 파일 이름. 둘 중 하나라도 모르면 "".
        private string InstallerPath(string file)
        {
            string src = (_settings?.UpdateSourceUrl ?? "").Trim();
            string f = System.IO.Path.GetFileName((file ?? "").Trim());
            return src.Length == 0 || f.Length == 0 ? "" : CombineUrl(src, f);
        }

        // ── 재확인 루프(§2.5): 막힌 동안만 돈다 ─────────────────────────────────
        //  갱신 중은 30초(이관 SQL 이 끝나면 곧 풀린다), 서버가 낡았거나 모를 때는 5분.
        //  업데이트 필요는 돌지 않는다. 사용자가 업데이트하기 전에는 답이 바뀌지 않는다.
        private void GateTimerFor(GateVerdict v)
        {
            TimeSpan? every = v switch
            {
                GateVerdict.Updating => TimeSpan.FromSeconds(30),
                GateVerdict.ServerOld => TimeSpan.FromMinutes(5),
                GateVerdict.Unknown => TimeSpan.FromMinutes(5),
                _ => null,
            };
            if (every == null) { _gateTimer?.Stop(); return; }
            if (_gateTimer == null)
            {
                _gateTimer = new System.Windows.Threading.DispatcherTimer();
                _gateTimer.Tick += (_, _) => { _ = GateRecheckAsync(""); };
            }
            if (!_gateTimer.IsEnabled || _gateTimer.Interval != every.Value)
            {
                _gateTimer.Stop();
                _gateTimer.Interval = every.Value;   // 간격이 바뀔 때만 다시 건다(같은 판정이 올 때마다 늦추지 않게)
                _gateTimer.Start();
            }
        }

        //  관문으로 연결을 한 번 열고 닫는다. 판정이 바뀌면 DbGate.Observed 가 푸시와 타이머를 맡는다.
        //  연결 자체가 실패하면(네트워크 등) 상태를 바꾸지 않고 다음 차례를 기다린다.
        private async Task GateRecheckAsync(string reqId)
        {
            if (Interlocked.Exchange(ref _gateRecheckBusy, 1) == 1)
            {
                if (reqId.Length > 0) GitReply(reqId, new { ok = true, state = DbGate.Last?.State ?? "ok" });
                return;
            }
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                var v = await DbGate.RecheckAsync(CalendarDb.BuildConnString(), cts.Token);
                Log("관문 재확인: " + DbGate.StateName(v));
                if (reqId.Length > 0) GitReply(reqId, new { ok = true, state = DbGate.StateName(v) });
            }
            catch (Exception ex)
            {
                var (kind, detail) = DbErrors.Observe(ex, Log, notify: false);
                Log("관문 재확인 실패(" + kind + "), 상태를 바꾸지 않는다");
                if (reqId.Length > 0) GitReply(reqId, new { ok = false, kind, error = DbErrors.ConnMessage(kind), detail });
            }
            finally { Volatile.Write(ref _gateRecheckBusy, 0); }
        }

        // ── 회신 장식(§2.3) ─────────────────────────────────────────────────────
        //  이 웹 명령을 처리하는 동안 관문이 막았고(DbGate.FlowBlocked) 회신이 { ok:false } 이면
        //  kind 'gate' 와 gate 정보를 붙인다. 원래 필드(msg, error 등)는 그대로 둔다(웹이 차례로 옮겨 간다).
        private static object WithGate(object payload)
        {
            var g = DbGate.FlowBlocked;
            if (g == null) return payload;
            if (payload is JsonObject done && done.ContainsKey("gate")) return payload;
            JsonNode? n;
            try { n = JsonSerializer.SerializeToNode(payload); } catch { return payload; }
            if (n is not JsonObject o) return payload;
            if (!(o["ok"] is JsonValue okv && okv.TryGetValue<bool>(out bool ok) && !ok)) return payload;
            o["kind"] = DbErrorKind.Gate;
            o["gate"] = JsonSerializer.SerializeToNode(DbGate.ReplyGate(g));
            return o;
        }

        //  부팅 실패 옵션에 관문 정보를 더한 것. 관문이 아닌 실패는 OfflineHost.StateErrorOpt 를 그대로 쓴다.
        private static string StateErrorOpt(bool retryable, string kind, string detail, GateSnapshot gate) =>
            JsonSerializer.Serialize(new { retryable, kind, detail, db = DeployConfig.DbName, host = DeployConfig.DbHost, gate = DbGate.ReplyGate(gate) });

        private void ApplyStateError(string msg, bool retryable, string kind, string detail, GateSnapshot gate)
        {
            string opt = StateErrorOpt(retryable, kind, detail, gate);
            try { _ = web.CoreWebView2.ExecuteScriptAsync("window.__applyStateError(" + JsonSerializer.Serialize(msg) + "," + opt + ")"); }
            catch (Exception ex) { Log("오류 통지 실패: " + ex.Message); }
        }

        // ── 회사 보고 전송 전 확인(§2.4, INetcusHost) ──────────────────────────────
        //  관문으로 연결을 한 번 열고 닫는다. 막혔으면 false(사이트에 접속하지 않는다).
        //  ★ 연결 자체가 실패하면 true 다. 막힌 것이 아니라 끊긴 것이고, 끊긴 동안의 전송은 예전처럼 나가고
        //    기록 저장만 10, 30, 60초 재시도로 따라간다(OFFLINE-RESILIENCE S10). 여기서 막으면 보고를 못 한다.
        async Task<bool> INetcusHost.GateOkAsync()
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                var v = await DbGate.RecheckAsync(CalendarDb.BuildConnString(), cts.Token);
                if (v != GateVerdict.Ok) Log("회사 보고 전송 전 관문 확인: " + DbGate.StateName(v) + ", 사이트에 접속하지 않는다");
                return v == GateVerdict.Ok;
            }
            catch (Exception ex)
            {
                var (kind, _) = DbErrors.Observe(ex, Log, notify: false);
                Log("회사 보고 전송 전 관문 확인: 연결 실패(" + kind + "), 막힌 것은 아니므로 전송은 계속한다");
                return true;
            }
        }
    }
}
