using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using WV = Microsoft.Web.WebView2.Wpf;

namespace TaskCalendarWidget
{
    // 회사 일간보고(netcus pjm) 자동 전송. 보조 WebView2(메인과 같은 환경=쿠키/세션 공유)로
    // login.htm→goLogin() 로그인 → pjm_work_view.jsp?y&m&d&id 이동 → status/overtime/content 채움 →
    // (실제 제출) Bmodify()로 서버 POST. 자격증명은 DPAPI로 로컬 암호화 저장.
    public partial class MainWindow
    {
        private CoreWebView2Environment? _cwvEnv;     // MainWindow.xaml.cs init에서 할당
        private WV.WebView2? _w2;                      // 보조 WebView2(가시 창)
        private Window? _w2win;
        private bool _ncMergeBusy;              // netcus 주간병합 중복 실행 가드(단일 _w2 레이스 방지 — JS 타임아웃 후 재시도 대비)
        private bool _ncWeeklyRangeBusy;

        private string CredFile => Path.Combine(_dataDir, "netcus.cred");

        private sealed class NetcusReq
        {
            public int Y, M, D, Overtime;
            public string Status = "", Content = "";
            public bool DryRun = true;
        }

        private sealed class NetcusWeekReq
        {
            public string Sdate = "", Edate = "", Subject = "", Content = "", Endwork = "";
        }

        private sealed class NetcusWeeklyReadRow
        {
            public string Sdate = "", Edate = "", Subject = "", Content = "", Endwork = "";
            public string Notendwork = "", Planwork = "", Problem = "", Resultwork = "";
            public bool Ok = true;
        }

        // ----- 자격증명 (DPAPI, CurrentUser) -----
        private void NetcusSaveCreds(string id, string pw)
        {
            try
            {
                // 비밀번호 칸을 비워서 저장하면 기존 비밀번호 유지(실수로 지워지는 것 방지)
                string enc;
                if (pw.Length > 0) enc = Convert.ToBase64String(Dpapi.Protect(Encoding.UTF8.GetBytes(pw)));
                else
                {
                    enc = "";
                    try { if (File.Exists(CredFile)) { using var d = JsonDocument.Parse(File.ReadAllText(CredFile, Encoding.UTF8)); if (d.RootElement.TryGetProperty("pw", out var p)) enc = p.GetString() ?? ""; } } catch { }
                }
                File.WriteAllText(CredFile, JsonSerializer.Serialize(new { id, pw = enc }), Encoding.UTF8);
                Log("netcus 자격증명 저장");
                NetcusSendCredsState();
                // 저장 후 실제 로그인 검증(보이는 창) — 성공/실패 표시
                var (eid, epw) = NetcusLoadCreds();
                if (string.IsNullOrEmpty(eid) || string.IsNullOrEmpty(epw)) JsCredsResult(false, "ID와 비밀번호를 모두 입력하세요.");
                else _ = NetcusValidateCreds(eid, epw);
            }
            catch (Exception ex) { Log("netcus 자격증명 저장 실패: " + ex.Message); JsCredsResult(false, "저장 오류: " + ex.Message); }
        }

        // 저장된 자격증명으로 실제 로그인해 성공/실패 검증(보조 WebView2, 가시 창)
        private async Task NetcusValidateCreds(string id, string pw)
        {
            try
            {
                JsCredsCheck("로그인 확인 중…");
                await EnsureW2();
                var cw = _w2!.CoreWebView2;
                await NavTo(cw, "https://www.netcus.com/pjm/login.htm");
                var nav = NavOnce(cw, 15000);
                await cw.ExecuteScriptAsync($"(function(){{try{{document.form.id.value={J(id)};document.form.pass.value={J(pw)};goLogin();}}catch(e){{}}}})()");
                await nav;
                // 로그인 후에도 비밀번호 입력칸이 보이면(=로그인 페이지 잔류) 실패
                string still = "true";
                for (int i = 0; i < 8; i++)
                {
                    still = await cw.ExecuteScriptAsync("(function(){return !!document.querySelector('input[type=password]');})()");
                    if (still == "false") break;
                    await Task.Delay(300);
                }
                bool ok = (still == "false");
                JsCredsResult(ok, ok ? "로그인 확인됨 — 자격증명 OK" : "로그인 실패 — ID/비밀번호를 확인하세요");
            }
            catch (Exception ex) { Log("netcus 자격증명 검증 예외: " + ex); JsCredsResult(false, "검증 오류: " + ex.Message); }
            finally
            {
                // 검증은 결과만 설정창에 표시하면 되므로 성공/실패 무관 확인용 창은 닫는다.
                try { await Task.Delay(700); } catch { }
                try { Dispatcher.Invoke(() => { try { _w2win?.Close(); } catch { } }); } catch { }
            }
        }

        private void JsCredsCheck(string m) { JsCall("window.__netcusCredsCheck && window.__netcusCredsCheck(" + JsonSerializer.Serialize(m) + ")"); }
        private void JsCredsResult(bool ok, string m) { Log("netcus creds validate: " + ok + " / " + m); JsCall("window.__netcusCredsResult && window.__netcusCredsResult(" + (ok ? "true" : "false") + "," + JsonSerializer.Serialize(m) + ")"); }

        private (string id, string pw) NetcusLoadCreds()
        {
            try
            {
                if (!File.Exists(CredFile)) return ("", "");
                using var d = JsonDocument.Parse(File.ReadAllText(CredFile, Encoding.UTF8));
                string id = d.RootElement.TryGetProperty("id", out var i) ? (i.GetString() ?? "") : "";
                string encPw = d.RootElement.TryGetProperty("pw", out var p) ? (p.GetString() ?? "") : "";
                string pw = encPw.Length > 0 ? Encoding.UTF8.GetString(Dpapi.Unprotect(Convert.FromBase64String(encPw))) : "";
                return (id, pw);
            }
            catch (Exception ex) { Log("netcus 자격증명 로드 실패: " + ex.Message); return ("", ""); }
        }

        private void NetcusSendCredsState()
        {
            var (id, pw) = NetcusLoadCreds();
            JsCall("window.__netcusCreds && window.__netcusCreds(" + JsonSerializer.Serialize(id) + "," + (string.IsNullOrEmpty(pw) ? "false" : "true") + ")");
        }

        // ----- 진행/결과 보고(메인 웹뷰로) -----
        private void NetcusProgress(string msg) { Log("netcus: " + msg); JsCall("window.__netcusProgress && window.__netcusProgress(" + JsonSerializer.Serialize(msg) + ")"); }
        private void NetcusResult(bool ok, string msg) { Log("netcus result: " + ok + " / " + msg); JsCall("window.__netcusResult && window.__netcusResult(" + (ok ? "true" : "false") + "," + JsonSerializer.Serialize(msg) + ")"); }
        private void JsCall(string js) { try { Dispatcher.Invoke(() => { try { _ = web.CoreWebView2?.ExecuteScriptAsync(js); } catch { } }); } catch { } }

        private async Task EnsureW2(bool background = false)
        {
            // background=true(주간병합 읽기): 포그라운드를 뺏지 않고 최소화 상태로만 띄운다.
            // (읽기 창을 Show+Activate하면 닫힐 때 최소화돼 있던 다른 창(탐색기 등)이 복원돼 바닥 위젯을 덮는 문제)
            if (_w2 != null && _w2.CoreWebView2 != null) { if (!background) { try { _w2win?.Show(); _w2win?.Activate(); } catch { } } return; }
            _w2win = new Window { Title = "회사 일간보고 전송 (확인용)", Width = 920, Height = 720, WindowStartupLocation = WindowStartupLocation.CenterScreen };
            if (background) { _w2win.ShowActivated = false; _w2win.WindowState = WindowState.Minimized; }   // 활성화·포그라운드 없이 최소화 생성
            _w2 = new WV.WebView2();
            _w2win.Content = _w2;
            _w2win.Closed += (_, __) => { try { _w2?.Dispose(); } catch { } _w2 = null; _w2win = null; };
            _w2win.Show();
            await _w2.EnsureCoreWebView2Async(_cwvEnv);
        }

        private static string J(string s) => JsonSerializer.Serialize(s);

        // 본문에서 첫 한글 토막(연속 한글 2~4자)을 뽑아 저장 후 되읽기 대조용 needle로 사용. 한글 없으면 "".
        private static string NetcusHangulNeedle(string s)
        {
            var sb = new StringBuilder();
            foreach (char ch in s ?? "")
            {
                if (ch >= 0xAC00 && ch <= 0xD7A3) { sb.Append(ch); if (sb.Length >= 4) break; }
                else { if (sb.Length >= 2) break; sb.Clear(); }
            }
            return sb.Length >= 2 ? sb.ToString() : "";
        }

        private Task<bool> NavTo(CoreWebView2 cw, string url)
        {
            var tcs = new TaskCompletionSource<bool>();
            void H(object? s, CoreWebView2NavigationCompletedEventArgs ev) { cw.NavigationCompleted -= H; tcs.TrySetResult(ev.IsSuccess); }
            cw.NavigationCompleted += H;
            _ = Task.Delay(20000).ContinueWith(_ => { try { cw.NavigationCompleted -= H; } catch { } tcs.TrySetResult(false); });
            cw.Navigate(url);
            return tcs.Task;
        }

        // 다음 NavigationCompleted 1회 대기(폼 submit로 인한 이동). 핸들러는 호출 전에 부착할 것.
        private Task<bool> NavOnce(CoreWebView2 cw, int timeoutMs)
        {
            var tcs = new TaskCompletionSource<bool>();
            void H(object? s, CoreWebView2NavigationCompletedEventArgs ev) { cw.NavigationCompleted -= H; tcs.TrySetResult(true); }
            cw.NavigationCompleted += H;
            _ = Task.Delay(timeoutMs).ContinueWith(_ => { try { cw.NavigationCompleted -= H; } catch { } tcs.TrySetResult(false); });
            return tcs.Task;
        }

        private async Task NetcusSubmit(NetcusReq req)
        {
            string lastAlert = "";
            CoreWebView2? cw = null;
            void OnDialog(object? s, CoreWebView2ScriptDialogOpeningEventArgs ev) { lastAlert = ev.Message ?? ""; Log("netcus alert: " + lastAlert); try { ev.Accept(); } catch { } }
            try
            {
                var (id, pw) = NetcusLoadCreds();
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(pw)) { NetcusResult(false, "자격증명이 없습니다 — 설정 → 회사 일간보고에서 ID/비밀번호를 저장하세요."); return; }

                NetcusProgress("창 준비 중…");
                await EnsureW2();
                cw = _w2!.CoreWebView2;
                cw.ScriptDialogOpening += OnDialog;

                NetcusProgress("로그인 중…");
                await NavTo(cw, "https://www.netcus.com/pjm/login.htm");
                var loginNav = NavOnce(cw, 15000);
                await cw.ExecuteScriptAsync($"(function(){{try{{document.form.id.value={J(id)};document.form.pass.value={J(pw)};goLogin();}}catch(e){{}}}})()");
                await loginNav;

                NetcusProgress("일간보고 페이지 여는 중…");
                string url = $"https://www.netcus.com/pjm/pjm_work_view.jsp?y={req.Y}&m={req.M}&d={req.D}&id={Uri.EscapeDataString(id)}";
                await NavTo(cw, url);

                // 폼 탐지 — <form>이 <table> 안에 있는 옛 마크업이라 document.form.* 접근이 안 될 수 있어 getElementsByName 사용. 로드 타이밍 대비 재시도.
                NetcusProgress("페이지 확인 중…");
                string probe = "false";
                for (int i = 0; i < 16; i++)
                {
                    probe = await cw.ExecuteScriptAsync("(function(){return !!(document.getElementsByName('status')[0] && document.getElementsByName('content')[0]);})()");
                    if (probe == "true") break;
                    await Task.Delay(300);
                }
                if (probe != "true") { NetcusResult(false, "입력 폼을 찾지 못했습니다 — 로그인 또는 페이지 접근을 확인하세요."); return; }
                // 진단: 페이지 자체 함수(Bmodify)가 쓰는 document.form 연결이 Chromium에서 유효한지 로그
                try { Log("netcus form-assoc(document.form.status): " + await cw.ExecuteScriptAsync("(function(){try{return !!(document.form&&document.form.status);}catch(e){return false;}})()")); } catch { }

                NetcusProgress("내용 작성 중…");
                string fill = "(function(){try{var st=document.getElementsByName('status')[0],ot=document.getElementsByName('overtime')[0],ct=document.getElementsByName('content')[0];"
                    + $"if(st){{st.value={J(req.Status)};}}if(ot){{ot.selectedIndex={req.Overtime};}}if(ct){{ct.value={J(req.Content)};}}"
                    + "return (st&&ct)?1:0;}catch(e){return 0;}})()";
                var filled = await cw.ExecuteScriptAsync(fill);
                if (filled != "1") { NetcusResult(false, "입력 폼 채우기 실패 — 페이지 구조가 바뀌었을 수 있습니다."); return; }

                if (req.DryRun)
                {
                    try { _w2win?.Activate(); } catch { }
                    NetcusResult(true, "미제출(테스트): 내용을 채웠습니다. 열린 창에서 확인 후 직접 ‘수정’으로 제출하세요.");
                    return;
                }

                // 실제 제출 — netcus는 euc-kr 페이지. JS fetch+FormData는 본문이 UTF-8 고정이라 한글이 깨진다.
                // 네이티브 폼 submit은 브라우저가 accept-charset='euc-kr'로 필드값을 인코딩(레거시 폼이 원래 쓰던 경로) → 한글 보존.
                // 페이지 안에서 동적 <form>(action=go=write, multipart, accept-charset=euc-kr)을 만들어 값 싣고 submit → 창이 결과로 이동.
                NetcusProgress("제출 중…");
                var submitNav = NavOnce(cw, 20000);
                string post = "(function(){try{"
                    + "var db=document.getElementsByName('dbstatus')[0];"
                    + "var f=document.createElement('form');f.method='post';f.enctype='multipart/form-data';f.acceptCharset='euc-kr';"
                    + $"f.action='pjm_work_view.jsp?go=write&table=report_tbl&y={req.Y}&m={req.M}&d={req.D}&id='+encodeURIComponent({J(id)});"
                    + "function H(n,v){var i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i);}"
                    + "H('dbstatus',(db&&db.value)?db.value:'0');"
                    + $"H('status',{J(req.Status)});H('overtime',{J(req.Overtime.ToString())});"
                    + $"var ta=document.createElement('textarea');ta.name='content';ta.value={J(req.Content)};f.appendChild(ta);"
                    + "document.body.appendChild(f);f.submit();return 'SUBMITTED';"
                    + "}catch(e){return 'ERR '+((e&&e.message)||e);}})()";
                var pres = await cw.ExecuteScriptAsync(post);
                Log("netcus submit fire: " + pres);
                if (pres == null || !pres.Contains("SUBMITTED")) { NetcusResult(false, "제출 폼 생성 실패: " + (pres ?? "null")); return; }
                bool navOk = await submitNav;   // go=write 결과 페이지로 이동 대기
                Log("netcus submit nav: " + navOk);

                // 저장 검증(거짓 성공 + 한글 깨짐 동시 차단) — 그 날짜 페이지를 다시 열어 content를 되읽어,
                // 우리가 보낸 한글 토큰이 그대로 있는지 대조(mojibake면 불일치).
                // 반환: -1=로그인페이지, -2=폼없음, 0=빈내용, 1=정상(한글 일치 또는 한글없음+내용존재), 2=저장됐으나 한글 불일치
                NetcusProgress("저장 확인 중…");
                await NavTo(cw, url);
                string needle = NetcusHangulNeedle(req.Content);
                string check = "(function(){try{"
                    + "if(document.querySelector('input[type=password]'))return -1;"
                    + "var c=document.getElementsByName('content')[0];if(!c)return -2;"
                    + "var v=(c.value||'').trim();if(!v.length)return 0;"
                    + $"var n={J(needle)};return (!n)?1:(v.indexOf(n)>=0?1:2);"
                    + "}catch(e){return -3;}})()";
                int vr = -9;
                for (int i = 0; i < 14; i++)
                {
                    var v = await cw.ExecuteScriptAsync(check);
                    if (int.TryParse((v ?? "").Trim('"'), out vr) && (vr == 1 || vr == 2 || vr == -1)) break;
                    await Task.Delay(300);
                }
                Log("netcus verify: " + vr + " (needle=" + needle + ")");
                if (vr == -1) NetcusResult(false, "세션 만료/로그인 필요 — 자격증명을 확인하세요.");
                else if (vr == 1) NetcusResult(true, "회사 일간보고 전송 완료 — 한글까지 정상 저장 확인. netcus 사이트에서도 확인하세요.");
                else if (vr == 2) NetcusResult(false, "저장은 됐으나 한글이 깨졌을 수 있습니다(되읽기 대조 불일치) — netcus에서 확인하세요.");
                else NetcusResult(false, "저장 확인 실패(내용이 비어 있음) — 열린 창에서 직접 확인하세요.");
            }
            catch (Exception ex) { Log("netcus 예외: " + ex); NetcusResult(false, "전송 오류: " + ex.Message); }
            finally { if (cw != null) { try { cw.ScriptDialogOpening -= OnDialog; } catch { } } }
        }

        // 주간보고 — '채우고 열어두기'(자동 제출 안 함). pjm_write.jsp 폼에 기간/제목/과제투입시간/진행사항을 채운 뒤
        // 창을 띄워 둔다. 차주계획·회의내용 등 보완 후 사용자가 직접 '제출'(Bwrite) — euc-kr은 네이티브 폼이 처리.
        private async Task NetcusWeekFill(NetcusWeekReq req)
        {
            string lastAlert = "";
            CoreWebView2? cw = null;
            void OnDialog(object? s, CoreWebView2ScriptDialogOpeningEventArgs ev) { lastAlert = ev.Message ?? ""; Log("netcus(week) alert: " + lastAlert); try { ev.Accept(); } catch { } }
            try
            {
                var (id, pw) = NetcusLoadCreds();
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(pw)) { NetcusResult(false, "자격증명이 없습니다 — 설정 → 회사 일간보고에서 ID/비밀번호를 저장하세요."); return; }

                NetcusProgress("창 준비 중…");
                await EnsureW2();
                cw = _w2!.CoreWebView2;
                cw.ScriptDialogOpening += OnDialog;

                NetcusProgress("로그인 중…");
                await NavTo(cw, "https://www.netcus.com/pjm/login.htm");
                var loginNav = NavOnce(cw, 15000);
                await cw.ExecuteScriptAsync($"(function(){{try{{document.form.id.value={J(id)};document.form.pass.value={J(pw)};goLogin();}}catch(e){{}}}})()");
                await loginNav;

                NetcusProgress("주간보고 목록 여는 중…");
                await NavTo(cw, "https://www.netcus.com/pjm/pjm.jsp?id=" + Uri.EscapeDataString(id));
                if (_w2 == null) { NetcusResult(false, "확인 창이 닫혀 중단되었습니다."); return; }

                // 작성 폼은 직접 GET하면 서버가 '게시판이 옳지 않습니다' 거부 → 목록의 form(table_code=report_tbl)을
                // pjm_write.jsp로 POST해야 함. 폼 연결 의존을 피해 동적 POST 폼으로 table_code/id를 실어 이동.
                NetcusProgress("작성 폼 여는 중…");
                var wnav = NavOnce(cw, 15000);
                string goWrite = "(function(){try{var f=document.createElement('form');f.method='post';f.action='pjm_write.jsp';"
                    + "function H(n,v){var i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i);}"
                    + "H('table_code','report_tbl');H('word_code','');H('n_code','');H('s_code','');H('c_code','');"
                    + "H('id'," + J(id) + ");document.body.appendChild(f);f.submit();return 'ok';}catch(e){return 'err';}})()";
                await cw.ExecuteScriptAsync(goWrite);
                await wnav;
                if (_w2 == null) { NetcusResult(false, "확인 창이 닫혀 중단되었습니다."); return; }

                NetcusProgress("페이지 확인 중…");
                string probe = "false";
                for (int i = 0; i < 16; i++)
                {
                    if (_w2 == null) { NetcusResult(false, "확인 창이 닫혀 중단되었습니다."); return; }
                    probe = await cw.ExecuteScriptAsync("(function(){return !!(document.getElementsByName('subject')[0] && document.getElementsByName('content')[0]);})()");
                    if (probe == "true") break;
                    await Task.Delay(300);
                }
                if (probe != "true") { NetcusResult(false, "주간보고 작성 폼을 찾지 못했습니다 — 로그인 또는 페이지 접근을 확인하세요."); return; }

                NetcusProgress("내용 작성 중…");
                // sdate/edate는 readonly지만 JS .value 할당은 가능. content(과제투입시간)/endwork(진행사항)는 textarea.
                string fill = "(function(){try{function set(n,v){var e=document.getElementsByName(n)[0];if(e){e.value=v;}}"
                    + $"set('sdate',{J(req.Sdate)});set('edate',{J(req.Edate)});set('subject',{J(req.Subject)});"
                    + $"set('content',{J(req.Content)});set('endwork',{J(req.Endwork)});"
                    + "return !!document.getElementsByName('content')[0];}catch(e){return false;}})()";
                var filled = await cw.ExecuteScriptAsync(fill);
                if (filled != "true") { NetcusResult(false, "주간보고 폼 채우기 실패 — 페이지 구조가 바뀌었을 수 있습니다."); return; }

                // 안전장치 — 이 폼도 <table> 안 빈 폼이라 페이지의 Bwrite(document.form.submit)가 빈 폼을 보낼 수 있다.
                // Bwrite를 euc-kr 동적 폼 버전으로 오버라이드(원본과 동일 검증·confirm 유지) → 사용자가 보완 후 직접 제출해도 안전.
                string ov = "(function(){try{window.Bwrite=function(iscompletion){"
                    + "var sd=document.getElementsByName('sdate')[0],sj=document.getElementsByName('subject')[0];"
                    + "if(sd&&!sd.value){alert('기간을 선택하세요.');return;}"
                    + "if(sj&&!sj.value){alert('제목을 입력하세요.');return;}"
                    + "if(iscompletion==='y'&&!confirm('제출하시겠습니까?'))return;"
                    + "var f=document.createElement('form');f.method='post';f.enctype='multipart/form-data';f.acceptCharset='euc-kr';"
                    + $"f.action='pjm_write.jsp?go=write&table=report_tbl&id='+encodeURIComponent({J(id)});"
                    + "function H(n,v){var i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i);}"
                    + "H('iscompletion',iscompletion);"
                    + "['ndate','sdate','edate','subject','endwork','content','notendwork','planwork','problem','resultwork'].forEach(function(n){var e=document.getElementsByName(n)[0];if(e)H(n,e.value);});"
                    + "var hc=document.getElementsByName('html')[0];if(hc&&hc.checked)H('html',hc.value);"
                    + "document.body.appendChild(f);f.submit();};return 'ok';}catch(e){return 'err';}})()";
                try { Log("netcus(week) Bwrite override: " + await cw.ExecuteScriptAsync(ov)); } catch { }

                try { _w2win?.Activate(); } catch { }
                NetcusResult(true, "주간보고 작성 폼을 채웠습니다 — 차주계획 등 보완 후 열린 창에서 직접 ‘제출’하세요.");
            }
            catch (Exception ex)
            {
                Log("netcus(week) 예외: " + ex);
                bool disposed = (ex.Message ?? "").Contains("disposed");
                NetcusResult(false, disposed ? "확인 창이 닫혀 중단되었습니다 — 다시 시도하세요." : ("주간보고 작성 오류: " + ex.Message));
            }
            finally { if (cw != null) { try { cw.ScriptDialogOpening -= OnDialog; } catch { } } }
        }

        // 주간보고 병합(Phase2) — from~to 기간의 일간보고 content를 '읽기만' 해서 웹으로 회신(제출/수정 없음).
        // 로그인 → 각 날짜 pjm_work_view.jsp에서 content textarea 값을 읽음 → days 배열로 __hostReply 회신 → 창 닫음.
        // 파싱·과제별 그룹핑·미분류 판정은 전부 웹(JS parseNetcusWeek)이 담당한다. 읽기 창은 최소화하고 끝나면 닫는다.
        // 회신 계약: { ok:bool, error:string, days:[{ date:"YYYY-MM-DD", content:string, ok:bool }] }
        //   error: ""(정상)/"no-creds"/"login"/"read". content 비었거나 요소 없으면 content:""(파서가 '일간 없음' 판정).
        private async Task NetcusWeekMerge(string reqId, string from, string to)
        {
            if (_ncMergeBusy) { GitReply(reqId, new { ok = false, error = "busy", days = Array.Empty<object>() }); return; }   // 이미 진행 중 → 즉시 반환(_w2 안 건드림)
            _ncMergeBusy = true;
            var days = new List<object>();
            CoreWebView2? cw = null;
            // 레거시 pjm alert()/confirm() 자동 수락 — 없으면 최소화된 창에서 다이얼로그가 읽기를 무한 대기시킴(제출/검증과 동일 방어)
            void OnDialog(object? s, CoreWebView2ScriptDialogOpeningEventArgs ev) { Log("netcus(merge) alert: " + (ev.Message ?? "")); try { ev.Accept(); } catch { } }
            try
            {
                var (id, pw) = NetcusLoadCreds();
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(pw))
                {
                    GitReply(reqId, new { ok = false, error = "no-creds", days = Array.Empty<object>() });
                    return;
                }

                // 기간 파싱(YYYY-MM-DD). 실패/역순은 방어 처리.
                if (!DateTime.TryParse(from, out var dFrom) || !DateTime.TryParse(to, out var dTo))
                {
                    GitReply(reqId, new { ok = false, error = "read", days = Array.Empty<object>() });
                    return;
                }
                if (dTo < dFrom) { var tmp = dFrom; dFrom = dTo; dTo = tmp; }
                if ((dTo - dFrom).TotalDays > 30)   // inclusive 31일까지만 허용 — 커스텀 폭주/DateTime.MaxValue 증가 예외 차단
                {
                    GitReply(reqId, new { ok = false, error = "range", days = Array.Empty<object>() });
                    return;
                }

                Log($"netcus 주간병합 읽기: {from} ~ {to}");
                await EnsureW2(background: true);   // 읽기 전용 — 포커스/포그라운드 안 뺏음(최소화 비활성 창)
                cw = _w2!.CoreWebView2;
                cw.ScriptDialogOpening += OnDialog;

                // 로그인(NetcusSubmit와 동일 패턴)
                await NavTo(cw, "https://www.netcus.com/pjm/login.htm");
                var loginNav = NavOnce(cw, 15000);
                await cw.ExecuteScriptAsync($"(function(){{try{{document.form.id.value={J(id)};document.form.pass.value={J(pw)};goLogin();}}catch(e){{}}}})()");
                await loginNav;

                // 로그인 실패 판정 — 비밀번호 입력칸 잔류(NetcusValidateCreds 프로브와 동일)
                string still = "true";
                for (int i = 0; i < 8; i++)
                {
                    still = await cw.ExecuteScriptAsync("(function(){return !!document.querySelector('input[type=password]');})()");
                    if (still == "false") break;
                    await Task.Delay(300);
                }
                if (still != "false")
                {
                    GitReply(reqId, new { ok = false, error = "login", days = Array.Empty<object>() });
                    return;
                }

                // from..to 각 날짜 content 읽기 — 단일 _w2 재사용(하루 1창 금지)
                for (var d = dFrom; d <= dTo; d = d.AddDays(1))
                {
                    int Y = d.Year, M = d.Month, D = d.Day;
                    string date = $"{Y:D4}-{M:D2}-{D:D2}";
                    string content = ""; bool okDay = false;
                    try
                    {
                        string url = $"https://www.netcus.com/pjm/pjm_work_view.jsp?y={Y}&m={M}&d={D}&id={Uri.EscapeDataString(id)}";
                        await NavTo(cw, url);
                        // content textarea 로드 대기(요소 존재하면 값이 빈 문자열이라도 탈출). ExecuteScriptAsync는 JSON 문자열 반환.
                        string raw = "null";
                        for (int i = 0; i < 12; i++)
                        {
                            raw = await cw.ExecuteScriptAsync("(function(){var c=document.getElementsByName('content')[0];return c?c.value:null;})()");
                            if (raw != null && raw != "null") break;
                            await Task.Delay(250);
                        }
                        if (raw != null && raw != "null")
                        {
                            try { content = JsonSerializer.Deserialize<string>(raw) ?? ""; } catch { content = ""; }
                            okDay = true;   // 요소 존재 = 그 날 페이지 접근 성공(내용은 비었을 수 있음)
                        }
                        else { content = ""; okDay = false; }   // 요소 없음(세션/접근 문제) → 파서는 빈 날로 취급
                    }
                    catch (Exception exd) { Log("netcus 주간병합 일자 읽기 실패(" + date + "): " + exd.Message); content = ""; okDay = false; }
                    days.Add(new { date, content, ok = okDay });
                }

                Log($"netcus 주간병합 완료: {days.Count}일");
                GitReply(reqId, new { ok = true, error = "", days });
            }
            catch (Exception ex)
            {
                Log("netcus 주간병합 예외: " + ex);
                GitReply(reqId, new { ok = false, error = "read", days = Array.Empty<object>() });
            }
            finally
            {
                _ncMergeBusy = false;
                try { if (cw != null) cw.ScriptDialogOpening -= OnDialog; } catch { }
                // 읽기 전용 — 성공/실패 무관 확인창은 닫는다(제출 확인창과 달리 열어두지 않음).
                try { Dispatcher.Invoke(() => { try { _w2win?.Close(); } catch { } }); } catch { }
            }
        }

        // 기간·주간 취합: 작성 완료된 netcus 주간보고를 읽기 전용으로 수집한다.
        // pjm.jsp 목록의 링크/폼 후보를 열고, 상세 화면의 주간보고 필드만 읽는다. 제출/수정 함수는 호출하지 않는다.
        // 회신 계약: { ok:bool, error:string, weeks:[{sdate,edate,subject,content,endwork,notendwork,planwork,problem,resultwork,ok}] }
        private async Task NetcusWeeklyRangeRead(string reqId, string from, string to)
        {
            if (_ncWeeklyRangeBusy) { GitReply(reqId, new { ok = false, error = "busy", weeks = Array.Empty<object>() }); return; }
            _ncWeeklyRangeBusy = true;
            var weeks = new List<NetcusWeeklyReadRow>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            CoreWebView2? cw = null;
            void OnDialog(object? s, CoreWebView2ScriptDialogOpeningEventArgs ev) { Log("netcus(weekly-read) dialog: " + (ev.Message ?? "")); try { ev.Accept(); } catch { } }

            string ScriptText(string raw)
            {
                try { return JsonSerializer.Deserialize<string>(raw) ?? ""; }
                catch { return ""; }
            }
            DateTime? ParseDate(string s)
            {
                s = (s ?? "").Trim().Replace(".", "-").Replace("/", "-");
                return DateTime.TryParse(s, out var d) ? d.Date : null;
            }
            bool Overlaps(string sdate, string edate, DateTime dFrom, DateTime dTo)
            {
                var s = ParseDate(sdate);
                var e = ParseDate(edate);
                if (s == null && e == null) return false;
                if (s == null) s = e;
                if (e == null) e = s;
                return s!.Value <= dTo && e!.Value >= dFrom;
            }
            bool HasBody(NetcusWeeklyReadRow r) =>
                !string.IsNullOrWhiteSpace(r.Content) || !string.IsNullOrWhiteSpace(r.Endwork) ||
                !string.IsNullOrWhiteSpace(r.Notendwork) || !string.IsNullOrWhiteSpace(r.Planwork) ||
                !string.IsNullOrWhiteSpace(r.Problem) || !string.IsNullOrWhiteSpace(r.Resultwork);

            try
            {
                var (id, pw) = NetcusLoadCreds();
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(pw))
                {
                    GitReply(reqId, new { ok = false, error = "no-creds", weeks = Array.Empty<object>() });
                    return;
                }
                if (!DateTime.TryParse(from, out var dFrom) || !DateTime.TryParse(to, out var dTo))
                {
                    GitReply(reqId, new { ok = false, error = "read", weeks = Array.Empty<object>() });
                    return;
                }
                if (dTo < dFrom) { var tmp = dFrom; dFrom = dTo; dTo = tmp; }
                dFrom = dFrom.Date; dTo = dTo.Date;
                if ((dTo - dFrom).TotalDays > 365)
                {
                    GitReply(reqId, new { ok = false, error = "range", weeks = Array.Empty<object>() });
                    return;
                }

                Log($"netcus 주간보고 기간 읽기: {from} ~ {to}");
                await EnsureW2(background: true);
                cw = _w2!.CoreWebView2;
                cw.ScriptDialogOpening += OnDialog;

                await NavTo(cw, "https://www.netcus.com/pjm/login.htm");
                var loginNav = NavOnce(cw, 15000);
                await cw.ExecuteScriptAsync($"(function(){{try{{document.form.id.value={J(id)};document.form.pass.value={J(pw)};goLogin();}}catch(e){{}}}})()");
                await loginNav;

                string still = "true";
                for (int i = 0; i < 8; i++)
                {
                    still = await cw.ExecuteScriptAsync("(function(){return !!document.querySelector('input[type=password]');})()");
                    if (still == "false") break;
                    await Task.Delay(300);
                }
                if (still != "false")
                {
                    GitReply(reqId, new { ok = false, error = "login", weeks = Array.Empty<object>() });
                    return;
                }

                string listUrl = "https://www.netcus.com/pjm/pjm.jsp?id=" + Uri.EscapeDataString(id);
                string candidateScript = @"(function(){
function val(f,n){var e=f && f.querySelector('[name=""'+n+'""]');return e?String(e.value||''):'';}
function txt(e){return String((e&&((e.innerText||e.textContent||e.value||e.title)||''))||'').replace(/\s+/g,' ').trim();}
function make(){
  var out=[], re=/report_tbl|pjm_(write|view)|주간|보고|20\d{2}[-./]\d{1,2}[-./]\d{1,2}/i;
  document.querySelectorAll('a[href]').forEach(function(a,i){
    var h=a.href||'', t=txt(a), oc=a.getAttribute('onclick')||'';
    if(re.test(h+' '+t+' '+oc)) out.push({kind:'a',idx:i,text:t,href:h});
  });
  Array.prototype.forEach.call(document.forms||[],function(f,i){
    var t=txt(f), pack=[val(f,'table_code'),val(f,'word_code'),val(f,'n_code'),val(f,'s_code'),val(f,'c_code'),t].join(' ');
    if((val(f,'table_code')==='report_tbl' && (val(f,'word_code')||val(f,'n_code')||val(f,'s_code')||val(f,'c_code'))) || re.test(pack)) out.push({kind:'form',idx:i,text:t});
  });
  return out.slice(0,60);
}
window.__tcWeeklyCandidates=make;
return JSON.stringify(make());
})()";
                string openScript(int idx) => @"(function(i){
function val(f,n){var e=f && f.querySelector('[name=""'+n+'""]');return e?String(e.value||''):'';}
function txt(e){return String((e&&((e.innerText||e.textContent||e.value||e.title)||''))||'').replace(/\s+/g,' ').trim();}
function make(){
  var out=[], re=/report_tbl|pjm_(write|view)|주간|보고|20\d{2}[-./]\d{1,2}[-./]\d{1,2}/i;
  document.querySelectorAll('a[href]').forEach(function(a,j){var h=a.href||'', t=txt(a), oc=a.getAttribute('onclick')||''; if(re.test(h+' '+t+' '+oc)) out.push({kind:'a',idx:j,href:h});});
  Array.prototype.forEach.call(document.forms||[],function(f,j){var t=txt(f), pack=[val(f,'table_code'),val(f,'word_code'),val(f,'n_code'),val(f,'s_code'),val(f,'c_code'),t].join(' '); if((val(f,'table_code')==='report_tbl' && (val(f,'word_code')||val(f,'n_code')||val(f,'s_code')||val(f,'c_code'))) || re.test(pack)) out.push({kind:'form',idx:j});});
  return out.slice(0,60);
}
try{var c=make()[i]; if(!c)return 'none'; if(c.kind==='a'){location.href=c.href;return 'nav';} var f=document.forms[c.idx]; if(f){f.submit();return 'nav';} return 'none';}catch(e){return 'err '+((e&&e.message)||e);}
})(" + idx.ToString(System.Globalization.CultureInfo.InvariantCulture) + ")";
                string detailScript = @"(function(){
function first(sel){return document.querySelector(sel);}
function v(n){var e=document.getElementsByName(n)[0] || document.getElementById(n); if(!e)return ''; return String(e.value!=null?e.value:(e.innerText||e.textContent||'')).trim();}
function allDates(s){var out=[], re=/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/g, m; while((m=re.exec(s||''))&&out.length<4){out.push(m[1]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[3]).slice(-2));} return out;}
var body=String((document.body&&document.body.innerText)||'');
var ds=allDates(body);
var subject=v('subject') || ((first('h1,h2,h3,.subject,.title')||{}).innerText||'') || document.title || '';
return JSON.stringify({
  sdate:v('sdate')||ds[0]||'', edate:v('edate')||ds[1]||ds[0]||'', subject:subject.trim(),
  content:v('content'), endwork:v('endwork'), notendwork:v('notendwork'),
  planwork:v('planwork'), problem:v('problem'), resultwork:v('resultwork'), ok:true
});
})()";

                await NavTo(cw, listUrl);
                string candidatesJson = ScriptText(await cw.ExecuteScriptAsync(candidateScript));
                int candidateCount = 0;
                try { using var d = JsonDocument.Parse(candidatesJson); candidateCount = d.RootElement.ValueKind == JsonValueKind.Array ? d.RootElement.GetArrayLength() : 0; }
                catch { candidateCount = 0; }
                if (candidateCount == 0)
                {
                    GitReply(reqId, new { ok = false, error = "unsupported", weeks = Array.Empty<object>() });
                    return;
                }

                for (int i = 0; i < candidateCount; i++)
                {
                    try
                    {
                        await NavTo(cw, listUrl);
                        var nav = NavOnce(cw, 10000);
                        string opened = ScriptText(await cw.ExecuteScriptAsync(openScript(i)));
                        if (opened != "nav") continue;
                        await nav;
                        await Task.Delay(250);
                        string rawDetail = ScriptText(await cw.ExecuteScriptAsync(detailScript));
                        if (string.IsNullOrWhiteSpace(rawDetail)) continue;
                        var row = JsonSerializer.Deserialize<NetcusWeeklyReadRow>(rawDetail, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                        if (row == null || !HasBody(row) || !Overlaps(row.Sdate, row.Edate, dFrom, dTo)) continue;
                        string key = (row.Sdate + "|" + row.Edate + "|" + row.Subject + "|" + row.Endwork).Trim();
                        if (!seen.Add(key)) continue;
                        weeks.Add(row);
                    }
                    catch (Exception exRow) { Log("netcus 주간보고 후보 읽기 실패(" + i + "): " + exRow.Message); }
                }

                if (weeks.Count == 0)
                {
                    GitReply(reqId, new { ok = false, error = "not-found", weeks = Array.Empty<object>() });
                    return;
                }
                var replyWeeks = new List<object>();
                foreach (var w in weeks)
                {
                    replyWeeks.Add(new
                    {
                        sdate = w.Sdate, edate = w.Edate, subject = w.Subject, content = w.Content,
                        endwork = w.Endwork, notendwork = w.Notendwork, planwork = w.Planwork,
                        problem = w.Problem, resultwork = w.Resultwork, ok = w.Ok
                    });
                }
                Log($"netcus 주간보고 기간 읽기 완료: {replyWeeks.Count}건");
                GitReply(reqId, new { ok = true, error = "", weeks = replyWeeks });
            }
            catch (Exception ex)
            {
                Log("netcus 주간보고 기간 읽기 예외: " + ex);
                GitReply(reqId, new { ok = false, error = "read", weeks = Array.Empty<object>() });
            }
            finally
            {
                _ncWeeklyRangeBusy = false;
                try { if (cw != null) cw.ScriptDialogOpening -= OnDialog; } catch { }
                try { Dispatcher.Invoke(() => { try { _w2win?.Close(); } catch { } }); } catch { }
            }
        }
    }

    // Windows DPAPI(CurrentUser) — 추가 NuGet 없이 crypt32 P/Invoke (폐쇄망 오프라인 빌드 안전)
    internal static class Dpapi
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct DATA_BLOB { public int cbData; public IntPtr pbData; }

        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CryptProtectData(ref DATA_BLOB pDataIn, string? szDataDescr, IntPtr pOptionalEntropy, IntPtr pvReserved, IntPtr pPromptStruct, int dwFlags, ref DATA_BLOB pDataOut);

        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CryptUnprotectData(ref DATA_BLOB pDataIn, IntPtr ppszDataDescr, IntPtr pOptionalEntropy, IntPtr pvReserved, IntPtr pPromptStruct, int dwFlags, ref DATA_BLOB pDataOut);

        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr hMem);

        private const int CRYPTPROTECT_UI_FORBIDDEN = 0x1;

        public static byte[] Protect(byte[] data) => Run(data, true);
        public static byte[] Unprotect(byte[] data) => Run(data, false);

        private static byte[] Run(byte[] data, bool protect)
        {
            var inBlob = new DATA_BLOB();
            var outBlob = new DATA_BLOB();
            try
            {
                inBlob.cbData = data.Length;
                inBlob.pbData = Marshal.AllocHGlobal(data.Length);
                Marshal.Copy(data, 0, inBlob.pbData, data.Length);
                bool ok = protect
                    ? CryptProtectData(ref inBlob, "tc", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_UI_FORBIDDEN, ref outBlob)
                    : CryptUnprotectData(ref inBlob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_UI_FORBIDDEN, ref outBlob);
                if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error());
                var outBytes = new byte[outBlob.cbData];
                Marshal.Copy(outBlob.pbData, outBytes, 0, outBlob.cbData);
                return outBytes;
            }
            finally
            {
                if (inBlob.pbData != IntPtr.Zero) Marshal.FreeHGlobal(inBlob.pbData);
                if (outBlob.pbData != IntPtr.Zero) LocalFree(outBlob.pbData);
            }
        }
    }
}
