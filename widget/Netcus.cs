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
        private bool _ncProbeBusy;              // netcus 구조 캡처 창 중복 실행 가드(단일 _w2 레이스 방지)
        private bool _ncProbeFolderOpened;      // 최초 캡처 저장 시 저장 폴더 1회만 자동 열기

        private string CredFile => Path.Combine(_dataDir, "netcus.cred");

        private sealed class NetcusReq
        {
            public int Y, M, D, Overtime;
            public string Status = "", Content = "";
            public bool DryRun = true;
        }

        private sealed class NetcusWeekReq
        {
            public string Sdate = "", Edate = "", Subject = "", Content = "", Endwork = "", Planwork = "";
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

        // 주간보고 — '채우고 열어두기'(자동 제출 안 함). pjm_write.jsp 폼에 기간/제목/과제투입시간/진행사항/차주계획 과제목록을 채운 뒤
        // 창을 띄워 둔다. 차주계획 내용·회의내용 등을 보완 후 사용자가 직접 '제출'(Bwrite) — euc-kr은 네이티브 폼이 처리.
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
                // sdate/edate는 readonly지만 JS .value 할당은 가능. content(과제투입시간)/endwork(진행사항)/planwork(차주계획)는 textarea.
                string fill = "(function(){try{function set(n,v){var e=document.getElementsByName(n)[0];if(e){e.value=v;}}"
                    + $"set('sdate',{J(req.Sdate)});set('edate',{J(req.Edate)});set('subject',{J(req.Subject)});"
                    + $"set('content',{J(req.Content)});set('endwork',{J(req.Endwork)});set('planwork',{J(req.Planwork)});"
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
                NetcusResult(true, "주간보고 작성 폼을 채웠습니다 — 차주계획 내용 등을 보완 후 열린 창에서 직접 ‘제출’하세요.");
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
                if ((dTo - dFrom).TotalDays > 31)   // 과도한 범위 방어 — 커스텀 폭주/DateTime.MaxValue 증가 예외 차단
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

        // 주간보고 범위 읽기(Phase2) — from~to에 걸치는 netcus '주간보고'들을 읽기만 해서 웹으로 회신(제출/수정 없음).
        // 흐름: 로그인 → 게시판 목록(pjm.jsp) 페이지 순회 → 각 행 {viewNo,regDate,title} 추출 →
        //   작성일 사전필터(from-7 ~ to+7) → 후보 조회(pjm_view.jsp) 열어 라벨셀 innerText 추출 → 기간 겹침 확정 → weeks 누적.
        // 파싱·과제별 병합은 전부 웹(JS parseNetcusWeekly)이 담당. 읽기 창은 최소화하고 끝나면 닫는다.
        // 회신 계약: { ok:bool, error:string, weeks:[{ regdate, title, period, endwork, content, plan }] }
        //   error: ""(정상)/"busy"/"no-creds"/"login"/"read"/"range".
        // 크롤 재현: go_list(loc)=pjm.jsp?list=go&start=loc / go_view(loc)=pjm_view.jsp?start=1&view_no=loc (캡처 그대로).
        //   레거시 <table> 내부 빈 <form>(필드가 형제 노드) 이슈 회피 위해 document.form 대신 동적 POST 폼으로 hidden 필드
        //   (word_code/n_code/s_code/c_code/table_code=report_tbl/id)를 실어 재현한다(기존 NetcusWeekFill와 동일 패턴).
        private async Task NetcusWeeklyRangeRead(string reqId, string from, string to)
        {
            if (_ncMergeBusy) { GitReply(reqId, new { ok = false, error = "busy", weeks = Array.Empty<object>() }); return; }   // 단일 _w2 레이스 방지(주간병합과 공유 가드)
            _ncMergeBusy = true;
            var weeks = new List<object>();
            CoreWebView2? cw = null;
            void OnDialog(object? s, CoreWebView2ScriptDialogOpeningEventArgs ev) { Log("netcus(weekly) alert: " + (ev.Message ?? "")); try { ev.Accept(); } catch { } }
            try
            {
                var (id, pw) = NetcusLoadCreds();
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(pw)) { GitReply(reqId, new { ok = false, error = "no-creds", weeks = Array.Empty<object>() }); return; }

                if (!NcDate(from, out var dFrom) || !NcDate(to, out var dTo)) { GitReply(reqId, new { ok = false, error = "read", weeks = Array.Empty<object>() }); return; }
                if (dTo < dFrom) { var tmp = dFrom; dFrom = dTo; dTo = tmp; }
                if ((dTo - dFrom).TotalDays > 400) { GitReply(reqId, new { ok = false, error = "range", weeks = Array.Empty<object>() }); return; }   // 일간(31일)과 달리 넓게, 그러나 폭주 방지
                DateTime winLo = dFrom.AddDays(-7), winHi = dTo.AddDays(7);   // 작성일 사전필터 창(주간보고 등록일은 기간 끝 근처)

                Log($"netcus 주간범위 읽기: {from} ~ {to}");
                await EnsureW2(background: true);   // 읽기 전용 — 포커스 안 뺏음(최소화 비활성 창)
                cw = _w2!.CoreWebView2;
                cw.ScriptDialogOpening += OnDialog;

                // 로그인(NetcusWeekMerge와 동일 패턴)
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
                if (still != "false") { GitReply(reqId, new { ok = false, error = "login", weeks = Array.Empty<object>() }); return; }

                // 목록 1페이지 이동(GET). 이후 페이지는 go_list 폼 재현.
                await NavTo(cw, "https://www.netcus.com/pjm/pjm.jsp?id=" + Uri.EscapeDataString(id));

                const int MAXPAGES = 40, MAXREAD = 60;
                var seenViews = new HashSet<string>();
                int opened = 0; bool capped = false;

                for (int p = 1; p <= MAXPAGES && !capped; p++)
                {
                    if (p > 1)
                    {
                        var lnav = NavOnce(cw, 15000);
                        await cw.ExecuteScriptAsync(GoListJs(p, id));   // go_list(p) 재현
                        await lnav;
                    }
                    // 목록 행 추출(테이블 로드 대기 재시도)
                    string rowsRaw = "null";
                    for (int i = 0; i < 16; i++)
                    {
                        rowsRaw = await cw.ExecuteScriptAsync(RowExtractJs);
                        if (rowsRaw != null && rowsRaw != "null" && rowsRaw != "\"[]\"") break;
                        await Task.Delay(250);
                    }
                    var rows = NcParseRows(rowsRaw);
                    if (rows.Count == 0) break;   // 더 없는 페이지

                    bool anyNew = false, allOlder = true;
                    var candidates = new List<(string viewNo, string regStr)>();
                    foreach (var r in rows)
                    {
                        if (string.IsNullOrEmpty(r.viewNo)) continue;
                        if (!seenViews.Contains(r.viewNo)) anyNew = true;
                        bool regOk = NcDate(r.regDate, out var dReg);
                        if (regOk && dReg >= winLo) allOlder = false;
                        if (!regOk || (dReg >= winLo && dReg <= winHi)) candidates.Add((r.viewNo, r.regDate));   // 창 안(또는 날짜 불명=관대) → 후보
                    }
                    if (!anyNew) break;   // go_list가 마지막 페이지로 클램프(반복) → 진전 없음 → 중단

                    foreach (var c in candidates)
                    {
                        if (seenViews.Contains(c.viewNo)) continue;
                        seenViews.Add(c.viewNo);
                        if (opened >= MAXREAD) { capped = true; Log("netcus 주간범위: 읽기 상한(60) 도달 — 중단"); break; }

                        var vnav = NavOnce(cw, 15000);
                        await cw.ExecuteScriptAsync(GoViewJs(c.viewNo, id));   // go_view(viewNo) 재현
                        await vnav;
                        opened++;

                        string cellRaw = "null";
                        for (int i = 0; i < 16; i++)
                        {
                            cellRaw = await cw.ExecuteScriptAsync(CellExtractJs);
                            if (cellRaw != null && cellRaw != "null" && cellRaw.Length > 4) break;
                            await Task.Delay(250);
                        }
                        var cell = NcParseCell(cellRaw);
                        if (cell == null) continue;

                        bool include;
                        if (NcPeriod(cell.period, out var ps, out var pe)) include = (ps <= dTo && pe >= dFrom);   // 기간 겹침 확정
                        else include = true;   // 기간 파싱 실패 → 작성일 사전필터 통과분은 관대 포함
                        if (!include) continue;

                        string regdate = !string.IsNullOrWhiteSpace(cell.regdate) ? cell.regdate : c.regStr;
                        weeks.Add(new { regdate, title = cell.title ?? "", period = cell.period ?? "", endwork = cell.endwork ?? "", content = cell.content ?? "", plan = cell.plan ?? "" });
                    }

                    if (allOlder) break;   // 페이지 전체가 from-7 이전 → 최신순이므로 이후 페이지 불필요
                }

                Log($"netcus 주간범위 완료: {weeks.Count}건 (열람 {opened})");
                GitReply(reqId, new { ok = true, error = "", weeks });
            }
            catch (Exception ex)
            {
                Log("netcus 주간범위 예외: " + ex);
                GitReply(reqId, new { ok = false, error = "read", weeks = Array.Empty<object>() });
            }
            finally
            {
                _ncMergeBusy = false;
                try { if (cw != null) cw.ScriptDialogOpening -= OnDialog; } catch { }
                try { Dispatcher.Invoke(() => { try { _w2win?.Close(); } catch { } }); } catch { }   // 읽기 전용 — 확인창 닫음
            }
        }

        // ----- 주간범위 읽기 보조(날짜 파싱·JS 재현·응답 파싱) -----
        private sealed class NcRow { public string viewNo = "", regDate = "", title = ""; }
        private sealed class NcCell { public string period = "", title = "", regdate = "", endwork = "", content = "", plan = ""; }

        // "YYYY-MM-DD"/"YYYY/MM/DD"/"YYYY.MM.DD"(+선택 시각) → DateTime. 실패 시 false.
        private static bool NcDate(string s, out DateTime d)
        {
            d = default;
            if (string.IsNullOrWhiteSpace(s)) return false;
            var t = s.Trim().Replace('/', '-').Replace('.', '-');
            int sp = t.IndexOf(' '); if (sp > 0) t = t.Substring(0, sp);
            return DateTime.TryParseExact(t, new[] { "yyyy-M-d", "yyyy-MM-dd", "yyyy-M-dd", "yyyy-MM-d" },
                System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out d);
        }

        // 기간 "YYYY-MM-DD ~ YYYY-MM-DD" → 시작/끝. '~'(또는 '∼') 기준으로만 분리(날짜의 '-'와 혼동 방지).
        private static bool NcPeriod(string s, out DateTime a, out DateTime b)
        {
            a = default; b = default;
            if (string.IsNullOrWhiteSpace(s)) return false;
            int i = s.IndexOf('~'); if (i < 0) i = s.IndexOf('∼');
            if (i < 0) return false;
            return NcDate(s.Substring(0, i), out a) && NcDate(s.Substring(i + 1), out b);
        }

        private static string NcDigits(string s)
        {
            var sb = new StringBuilder();
            foreach (var c in s ?? "") if (c >= '0' && c <= '9') sb.Append(c);
            return sb.Length > 0 ? sb.ToString() : "0";
        }

        // go_list(p) 재현 — pjm.jsp?list=go&start=p 로 동적 POST(hidden: table_code=report_tbl/id + 빈 코드들).
        private string GoListJs(int p, string id) =>
            "(function(){try{var f=document.createElement('form');f.method='post';f.action='pjm.jsp?list=go&start=" + p + "';"
          + "function H(n,v){var i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i);}"
          + "H('word_code','');H('n_code','');H('s_code','');H('c_code','');H('table_code','report_tbl');H('id'," + J(id) + ");"
          + "document.body.appendChild(f);f.submit();return 'ok';}catch(e){return 'err';}})()";

        // go_view(viewNo) 재현 — pjm_view.jsp?start=1&view_no=viewNo 로 동적 POST(동일 hidden 필드).
        private string GoViewJs(string viewNo, string id) =>
            "(function(){try{var f=document.createElement('form');f.method='post';f.action='pjm_view.jsp?start=1&view_no=" + NcDigits(viewNo) + "';"
          + "function H(n,v){var i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i);}"
          + "H('word_code','');H('n_code','');H('s_code','');H('c_code','');H('table_code','report_tbl');H('id'," + J(id) + ");"
          + "document.body.appendChild(f);f.submit();return 'ok';}catch(e){return 'err';}})()";

        // 목록 페이지 행 추출 — a[href*=go_view]마다 {viewNo, regDate(YYYY-MM-DD), title}. JSON 배열 문자열 반환.
        private const string RowExtractJs = @"(function(){var out=[];var as=document.getElementsByTagName('a');for(var i=0;i<as.length;i++){var a=as[i];var h=a.getAttribute('href')||'';if(h.indexOf('go_view')<0)continue;var m=/go_view\(\s*['""]?(\d+)['""]?\s*\)/.exec(h);if(!m)continue;var title=((a.innerText||a.textContent||'')+'').replace(/\s+/g,' ').trim();var reg='';var tr=a.closest?a.closest('tr'):null;if(tr){var tds=tr.getElementsByTagName('td');for(var j=0;j<tds.length;j++){var tx=((tds[j].innerText||'')+'').trim();var dm=/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(tx);if(dm){var mm=dm[2].length<2?'0'+dm[2]:dm[2];var dd=dm[3].length<2?'0'+dm[3]:dm[3];reg=dm[1]+'-'+mm+'-'+dd;break;}}}out.push({viewNo:m[1],regDate:reg,title:title});}return JSON.stringify(out);})()";

        // 조회 페이지 라벨셀 추출 — 라벨 div/td 텍스트 정규화 정확일치 → 다음 셀 innerText. JSON 객체 문자열 반환.
        private const string CellExtractJs = @"(function(){function C(lb){var tds=document.getElementsByTagName('td');for(var i=0;i<tds.length;i++){var d=tds[i].querySelector&&tds[i].querySelector('div');var tx=((d?d.innerText:tds[i].innerText)||'').replace(/\s+/g,' ').trim();if(tx===lb){var n=tds[i].nextElementSibling;if(n)return n.innerText;}}return '';}return JSON.stringify({period:C('기간'),title:C('제목'),regdate:C('작성일'),endwork:C('진행사항'),content:C('과제투입시간'),plan:C('차주계획')});})()";

        // ExecuteScriptAsync는 JSON 문자열을 다시 JSON 인코딩 → 이중 디코드.
        private List<NcRow> NcParseRows(string? raw)
        {
            var list = new List<NcRow>();
            try
            {
                if (string.IsNullOrEmpty(raw) || raw == "null") return list;
                string inner = JsonSerializer.Deserialize<string>(raw) ?? "[]";
                using var d = JsonDocument.Parse(inner);
                foreach (var el in d.RootElement.EnumerateArray())
                {
                    list.Add(new NcRow
                    {
                        viewNo = el.TryGetProperty("viewNo", out var v) ? (v.GetString() ?? "") : "",
                        regDate = el.TryGetProperty("regDate", out var g) ? (g.GetString() ?? "") : "",
                        title = el.TryGetProperty("title", out var t) ? (t.GetString() ?? "") : "",
                    });
                }
            }
            catch (Exception ex) { Log("netcus 주간범위 행파싱 실패: " + ex.Message); }
            return list;
        }

        private NcCell? NcParseCell(string? raw)
        {
            try
            {
                if (string.IsNullOrEmpty(raw) || raw == "null") return null;
                string inner = JsonSerializer.Deserialize<string>(raw) ?? "{}";
                using var d = JsonDocument.Parse(inner);
                var r = d.RootElement;
                string G(string k) => r.TryGetProperty(k, out var v) ? (v.GetString() ?? "") : "";
                return new NcCell { period = G("period"), title = G("title"), regdate = G("regdate"), endwork = G("endwork"), content = G("content"), plan = G("plan") };
            }
            catch (Exception ex) { Log("netcus 주간범위 셀파싱 실패: " + ex.Message); return null; }
        }

        // 주간보고 '구조 캡처' 도구(Phase2 준비) — netcus를 가시 창으로 열고 자동 로그인 → 게시판 홈까지만 이동.
        // 사용자가 주간보고 목록/조회로 직접 이동 후 상단에 주입된 '이 페이지 HTML 저장' 버튼을 누르면
        // 그 페이지 HTML을 로컬(%APPDATA%\TaskCalendar\netcus-probe)에 저장. 읽기 전용 — 제출/수정/삭제 없음.
        // 창은 코드로 닫지 않고 사용자가 닫는다(Closed에서 가드·핸들러 해제).
        private async Task NetcusProbeStart()
        {
            if (_ncProbeBusy) { JsCall("window.__netcusProbeResult && window.__netcusProbeResult(true," + J("이미 캡처 창이 열려 있습니다.") + ")"); return; }
            _ncProbeBusy = true;
            // 레거시 pjm alert()/confirm() 자동 수락 — 창이 살아있는 동안 유지(제출/병합과 동일 방어)
            void OnDialog(object? s, CoreWebView2ScriptDialogOpeningEventArgs ev) { try { ev.Accept(); } catch { } }
            try
            {
                var (id, pw) = NetcusLoadCreds();
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(pw))
                {
                    _ncProbeBusy = false;
                    JsCall("window.__netcusProbeResult && window.__netcusProbeResult(false," + J("netcus 자격증명이 없습니다 — 설정에서 저장하세요.") + ")");
                    return;
                }

                await EnsureW2();   // 가시 창(920x720)
                try { if (_w2win != null) { _w2win.Title = "netcus 주간보고 구조 캡처 (읽기 전용)"; _w2win.Closed += (_, __) => { _ncProbeBusy = false; }; } } catch { }
                var cw = _w2!.CoreWebView2;
                cw.ScriptDialogOpening += OnDialog;

                // 로그인(NetcusSubmit와 동일 패턴)
                await NavTo(cw, "https://www.netcus.com/pjm/login.htm");
                var loginNav = NavOnce(cw, 15000);
                await cw.ExecuteScriptAsync($"(function(){{try{{document.form.id.value={J(id)};document.form.pass.value={J(pw)};goLogin();}}catch(e){{}}}})()");
                await loginNav;

                // 로그인 성공 판정 — 비밀번호 입력칸 잔류 여부(NetcusValidateCreds 프로브와 동일)
                string still = "true";
                for (int i = 0; i < 8; i++)
                {
                    still = await cw.ExecuteScriptAsync("(function(){return !!document.querySelector('input[type=password]');})()");
                    if (still == "false") break;
                    await Task.Delay(300);
                }
                if (still != "false")
                {
                    _ncProbeBusy = false;
                    JsCall("window.__netcusProbeResult && window.__netcusProbeResult(false," + J("netcus 로그인 실패 — 설정에서 로그인 정보를 확인하세요.") + ")");
                    try { cw.ScriptDialogOpening -= OnDialog; } catch { }
                    return;
                }

                // 게시판 홈까지만 이동 — 주간보고 목록/조회는 사용자가 직접 이동(URL 추측 자동이동 금지)
                await NavTo(cw, "https://www.netcus.com/pjm/pjm.jsp?id=" + Uri.EscapeDataString(id));

                // 프로브 세션 핸들러 배선 — 창은 계속 열어둠(finally에서 떼지 않음). Closed에서 누수 방지.
                cw.WebMessageReceived += OnProbeMsg;
                cw.NavigationCompleted += OnProbeNav;
                _w2win!.Closed += (_, __) => { try { cw.WebMessageReceived -= OnProbeMsg; } catch { } try { cw.NavigationCompleted -= OnProbeNav; } catch { } };

                // 캡처 바 즉시 주입(이후 탐색마다 OnProbeNav가 재주입)
                await InjectProbeBar(cw);

                JsCall("window.__netcusProbeResult && window.__netcusProbeResult(true," + J("netcus 캡처 창을 열었습니다 — 주간보고 목록/조회로 이동 후 상단 '이 페이지 HTML 저장'을 누르세요.") + ")");
                // 성공 경로: _ncProbeBusy·OnDialog는 창이 살아있는 동안 유지(창 Closed에서 리셋).
            }
            catch (Exception ex)
            {
                _ncProbeBusy = false;
                JsCall("window.__netcusProbeResult && window.__netcusProbeResult(false," + J("캡처 창 오류: " + ex.Message) + ")");
            }
        }

        // 캡처 바 주입(idempotent) — 이미 있으면 return. body 미존재 대비 documentElement에 append.
        private async Task InjectProbeBar(CoreWebView2 cw)
        {
            string js = @"(function(){
 if(document.getElementById('__tcProbeBar'))return;
 var b=document.createElement('div');b.id='__tcProbeBar';
 b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1d2433;color:#fff;font:13px ""Malgun Gothic"",sans-serif;padding:8px 12px;display:flex;gap:10px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.35)';
 var t=document.createElement('span');t.textContent='📸 주간보고 목록/조회 페이지에서 → ';
 var btn=document.createElement('button');btn.textContent='이 페이지 HTML 저장';
 btn.style.cssText='background:#3e5be0;color:#fff;border:0;border-radius:6px;padding:6px 12px;font:inherit;cursor:pointer';
 btn.onclick=function(){try{window.chrome.webview.postMessage(JSON.stringify({t:'probeCapture'}));}catch(e){}};
 var st=document.createElement('span');st.id='__tcProbeStatus';st.style.cssText='margin-left:auto;opacity:.9';
 b.appendChild(t);b.appendChild(btn);b.appendChild(st);
 (document.body||document.documentElement).appendChild(b);
 if(document.body)document.body.style.paddingTop='46px';
})();";
            try { await cw.ExecuteScriptAsync(js); } catch { }
        }

        // 탐색 완료마다 캡처 바 재주입(페이지 이동 후에도 버튼 유지)
        private async void OnProbeNav(object? s, CoreWebView2NavigationCompletedEventArgs e)
        {
            try { if (_w2?.CoreWebView2 != null) await InjectProbeBar(_w2.CoreWebView2); } catch { }
        }

        // 캡처 버튼 클릭 수신 → 현재 페이지 outerHTML을 로컬 파일로 저장(읽기 전용)
        private async void OnProbeMsg(object? s, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string raw;
                try { raw = e.TryGetWebMessageAsString(); } catch { raw = e.WebMessageAsJson; }
                if (string.IsNullOrEmpty(raw) || !raw.Contains("probeCapture")) return;
                var cw = _w2?.CoreWebView2;
                if (cw == null) return;
                // ExecuteScriptAsync는 JSON 문자열을 다시 JSON 인코딩해 반환 → 이중 디코드 필요
                string j = await cw.ExecuteScriptAsync("JSON.stringify({html:document.documentElement.outerHTML,url:location.href,title:document.title})");
                if (string.IsNullOrEmpty(j) || j == "null") return;
                var inner = JsonSerializer.Deserialize<string>(j);
                using var docp = JsonDocument.Parse(inner ?? "{}");
                var root = docp.RootElement;
                string html = root.GetProperty("html").GetString() ?? "";
                string url = root.GetProperty("url").GetString() ?? "";
                string title = root.GetProperty("title").GetString() ?? "";

                var dir = Path.Combine(_dataDir, "netcus-probe");
                Directory.CreateDirectory(dir);
                string ts = DateTime.Now.ToString("yyyyMMdd-HHmmss");
                string fname = "capture-" + ts + ".html";
                string path = Path.Combine(dir, fname);
                string header = "<!-- TaskCalendar netcus probe | URL: " + url + " | TITLE: " + title + " | AT: " + ts + " -->\n";
                File.WriteAllText(path, header + html, new System.Text.UTF8Encoding(false));

                // 페이지 상태 갱신(주입 바에 파일명 표시)
                try { await cw.ExecuteScriptAsync("(function(){var s=document.getElementById('__tcProbeStatus');if(s)s.textContent=" + J("저장됨: " + fname) + ";})()"); } catch { }

                // 최초 저장 시 저장 폴더 1회만 자동 열기
                if (!_ncProbeFolderOpened)
                {
                    _ncProbeFolderOpened = true;
                    try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = "explorer.exe", Arguments = "\"" + dir + "\"", UseShellExecute = true }); } catch { }
                }

                JsCall("window.__netcusProbeResult && window.__netcusProbeResult(true," + J("저장됨: " + path) + ")");
                Log("netcus probe 저장: " + path);
            }
            catch (Exception ex) { Log("netcus probe 캡처 오류: " + ex.Message); }
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
