using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace TaskCalendarWidget
{
    // netcus 크롤/전송에서 쓰는 DOM/WebView 무의존 '순수 정적' 요소 모음(행위보존 추출 Phase1).
    // 날짜/기간 파싱 · JS 스니펫 생성 · 추출 스크립트 상수 · JSON 이스케이프 · 응답 DTO.
    // 부작용 없음(Log/Dispatcher/WebView 의존 없음). 문자열·로직은 원본 그대로.
    internal static class NetcusText
    {
        // ----- 주간범위 읽기 응답 DTO -----
        internal sealed class NcRow { public string viewNo = "", regDate = "", title = ""; }
        internal sealed class NcCell { public string period = "", title = "", regdate = "", endwork = "", content = "", plan = "", modNo = ""; }

        internal static string J(string s) => JsonSerializer.Serialize(s);

        // 본문에서 첫 한글 토막(연속 한글 2~4자)을 뽑아 저장 후 되읽기 대조용 needle로 사용. 한글 없으면 "".
        internal static string NetcusHangulNeedle(string s)
        {
            var sb = new StringBuilder();
            foreach (char ch in s ?? "")
            {
                if (ch >= 0xAC00 && ch <= 0xD7A3) { sb.Append(ch); if (sb.Length >= 4) break; }
                else { if (sb.Length >= 2) break; sb.Clear(); }
            }
            return sb.Length >= 2 ? sb.ToString() : "";
        }

        // "YYYY-MM-DD"/"YYYY/MM/DD"/"YYYY.MM.DD"(+선택 시각) → DateTime. 실패 시 false.
        internal static bool NcDate(string s, out DateTime d)
        {
            d = default;
            if (string.IsNullOrWhiteSpace(s)) return false;
            var t = s.Trim().Replace('/', '-').Replace('.', '-');
            int sp = t.IndexOf(' '); if (sp > 0) t = t.Substring(0, sp);
            return DateTime.TryParseExact(t, new[] { "yyyy-M-d", "yyyy-MM-dd", "yyyy-M-dd", "yyyy-MM-d" },
                System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out d);
        }

        // 기간 "YYYY-MM-DD ~ YYYY-MM-DD" → 시작/끝. '~'(또는 '∼') 기준으로만 분리(날짜의 '-'와 혼동 방지).
        internal static bool NcPeriod(string s, out DateTime a, out DateTime b)
        {
            a = default; b = default;
            if (string.IsNullOrWhiteSpace(s)) return false;
            int i = s.IndexOf('~'); if (i < 0) i = s.IndexOf('∼');
            if (i < 0) return false;
            return NcDate(s.Substring(0, i), out a) && NcDate(s.Substring(i + 1), out b);
        }

        internal static string NcDigits(string s)
        {
            var sb = new StringBuilder();
            foreach (var c in s ?? "") if (c >= '0' && c <= '9') sb.Append(c);
            return sb.Length > 0 ? sb.ToString() : "0";
        }

        // go_list(p) 재현 — pjm.jsp?list=go&start=p 로 동적 POST(hidden: table_code=report_tbl/id + 빈 코드들).
        internal static string GoListJs(int p, string id) =>
            "(function(){try{var f=document.createElement('form');f.method='post';f.action='pjm.jsp?list=go&start=" + p + "';"
          + "function H(n,v){var i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i);}"
          + "H('word_code','');H('n_code','');H('s_code','');H('c_code','');H('table_code','report_tbl');H('id'," + J(id) + ");"
          + "document.body.appendChild(f);f.submit();return 'ok';}catch(e){return 'err';}})()";

        // go_view(viewNo) 재현 — pjm_view.jsp?start=1&view_no=viewNo 로 동적 POST(동일 hidden 필드).
        internal static string GoViewJs(string viewNo, string id) =>
            "(function(){try{var f=document.createElement('form');f.method='post';f.action='pjm_view.jsp?start=1&view_no=" + NcDigits(viewNo) + "';"
          + "function H(n,v){var i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i);}"
          + "H('word_code','');H('n_code','');H('s_code','');H('c_code','');H('table_code','report_tbl');H('id'," + J(id) + ");"
          + "document.body.appendChild(f);f.submit();return 'ok';}catch(e){return 'err';}})()";

        // 목록 페이지 행 추출 — a[href*=go_view]마다 {viewNo, regDate(YYYY-MM-DD), title}. JSON 배열 문자열 반환.
        internal const string RowExtractJs = @"(function(){var out=[];var as=document.getElementsByTagName('a');for(var i=0;i<as.length;i++){var a=as[i];var h=a.getAttribute('href')||'';if(h.indexOf('go_view')<0)continue;var m=/go_view\(\s*['""]?(\d+)['""]?\s*\)/.exec(h);if(!m)continue;var title=((a.innerText||a.textContent||'')+'').replace(/\s+/g,' ').trim();var reg='';var tr=a.closest?a.closest('tr'):null;if(tr){var tds=tr.getElementsByTagName('td');for(var j=0;j<tds.length;j++){var tx=((tds[j].innerText||'')+'').trim();var dm=/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(tx);if(dm){var mm=dm[2].length<2?'0'+dm[2]:dm[2];var dd=dm[3].length<2?'0'+dm[3]:dm[3];reg=dm[1]+'-'+mm+'-'+dd;break;}}}out.push({viewNo:m[1],regDate:reg,title:title});}return JSON.stringify(out);})()";

        // 조회 페이지 라벨셀 추출 — 라벨 div/td 텍스트 정규화 정확일치 → 다음 셀 innerText. JSON 객체 문자열 반환.
        //   modNo: 이 글의 수정 단추(input[name=mo] 의 onclick, 또는 go_modify 가 든 onclick, 링크)에서 뽑은 **진짜 글 번호**(go_modify('39438') 의 숫자).
        //     목록의 go_view(n) 의 n 은 목록 순번이라 글 번호가 아니다(2026-11-05). 번호를 못 뽑거나 서로 다른 번호가 둘 이상이면 "". 수정 단추가 없으면(남의 글) "" 다.
        //   주간범위 읽기는 이 값을 쓰지 않는다(회신 모양 그대로).
        internal const string CellExtractJs = @"(function(){function C(lb){var tds=document.getElementsByTagName('td');for(var i=0;i<tds.length;i++){var d=tds[i].querySelector&&tds[i].querySelector('div');var tx=((d?d.innerText:tds[i].innerText)||'').replace(/\s+/g,' ').trim();if(tx===lb){var n=tds[i].nextElementSibling;if(n)return n.innerText;}}return '';}function M(){var re=/go_modify\(\s*['""]?(\d+)['""]?\s*\)/;var seen={},cnt=0,no='';var els=document.querySelectorAll('input[name=mo],[onclick*=go_modify],a[href*=go_modify]');for(var i=0;i<els.length;i++){var at=['onclick','href'];for(var j=0;j<at.length;j++){var m=re.exec(els[i].getAttribute(at[j])||'');if(m&&!seen[m[1]]){seen[m[1]]=1;cnt++;no=m[1];}}}return cnt===1?no:'';}return JSON.stringify({period:C('기간'),title:C('제목'),regdate:C('작성일'),endwork:C('진행사항'),content:C('과제투입시간'),plan:C('차주계획'),modNo:M()});})()";

        // ================================================================================
        // 주간보고 같은 기간 글 고치기(WEEKLY-UPSERT, docs/WEEKLY-UPSERT.md). 아래는 전부 순수 함수다.
        //   tests/weekly-upsert.test.mjs 가 이 파일을 그대로 컴파일해 고르기 규칙과 문구를 돌려 보고,
        //   여기서 만든 JS 를 가짜 수정 화면(jsdom)에서 그대로 실행한다. 시험이 보는 것은 이 함수들의 출력이다.
        // ================================================================================

        // 확인 실패 문구. 이때는 새 글을 열지 않는다(확인 없이 열면 같은 주 글이 다시 둘이 된다).
        internal const string WeekLookupFailMsg = "기존 주간보고를 확인하지 못했습니다. 다시 시도하세요.";

        // 번호 맞춰 보기 실패 문구. 목록 순번으로 연 보기 화면의 글 번호가 찾을 때 읽은 번호와 다르면(그 사이 목록이 밀렸다) 다른 글을 고치지 않도록 멈춘다.
        //   "주간보고 " 로 시작하지 않는다(웹이 실패 회신으로 읽는다).
        internal const string WeekViewMismatchMsg = "고를 기존 글이 목록에서 바뀌어 채우지 않았습니다. 다시 시도하세요.";

        // 수정 화면의 기간이 비었다 = 기존 글의 수정 화면이 아니라 잘못 열린 화면이다(회사 서버가 빈 폼 제출을 실패시킨다).
        internal const string WeekModifyBlankMsg = "기존 글의 수정 화면이 비어 있어 채우지 않았습니다. 회사 화면에서 글을 확인한 뒤 다시 시도하세요.";

        // 글 번호 정리. 숫자만으로 된 1 ~ 18자리이고 0 보다 크면 앞 0 을 뗀 문자열, 그 밖에는 "".
        //   보기 화면 수정 단추의 go_modify('39438') 에서 뽑은 값을 검증하는 자리다(목록 순번이 아니라 진짜 글 번호).
        internal static string NcModifyNo(string? raw)
        {
            if (string.IsNullOrEmpty(raw) || raw.Length > 18) return "";
            foreach (var c in raw) if (c < '0' || c > '9') return "";
            return raw.TrimStart('0');
        }

        // 같은 기간 글 고르기. 기간 칸을 NcPeriod 로 읽어 시작과 끝이 둘 다 요청과 같아야 같은 글이다.
        //   items = (목록 순번 seq, 기간, 보기 화면에서 뽑은 글 번호 modNo). 순번은 보기 화면을 다시 열 때만 쓰고, 고르는 기준은 글 번호다
        //   (목록은 최신이 1 이라 순번이 큰 글이 오래된 글이다).
        //   기간을 못 읽은 글, 순번을 못 읽은 글은 같은 글로 보지 않는다. 요청 기간을 못 읽으면 아무것도 고르지 않는다.
        //   글 번호를 못 뽑은 글(수정 단추가 없는 남의 글 포함)은 기간이 같아도 고르지 않는다. 그런 글 수는 locked 로 따로 센다(로그용).
        //   여러 개면 글 번호가 가장 큰(가장 최근) 글. 반환은 (그 글의 순번, 글 번호), 없으면 ("", ""). matches = 서로 다른 글 번호 수.
        internal static (string seq, string no) NcPickSameWeek(IEnumerable<(string seq, string period, string modNo)> items, string sdate, string edate, out int matches, out int locked)
        {
            matches = 0; locked = 0;
            if (!NcDate(sdate, out var ds) || !NcDate(edate, out var de)) return ("", "");
            string bestSeq = "", bestNo = ""; long best = 0;
            var seen = new HashSet<long>();
            foreach (var (seq, period, modNo) in items ?? Array.Empty<(string, string, string)>())
            {
                if (!NcPeriod(period, out var a, out var b) || a != ds || b != de) continue;
                if (!long.TryParse(NcDigits(seq), NumberStyles.None, CultureInfo.InvariantCulture, out var s) || s <= 0) continue;
                string no = NcModifyNo(modNo);
                if (no.Length == 0) { locked++; continue; }
                long n = long.Parse(no, NumberStyles.None, CultureInfo.InvariantCulture);
                if (seen.Add(n)) matches++;
                if (n > best) { best = n; bestNo = no; bestSeq = s.ToString(CultureInfo.InvariantCulture); }
            }
            return (bestSeq, bestNo);
        }

        // ================================================================================
        // 주간보고 임시저장과 되읽기(WEEKLY-UPSERT 끝 절, 2026-11-06 사용자 확정). 앱이 임시저장('n')까지 누르고, 같은 기간 글을 다시 찾아
        //   보기 화면의 진행사항에 보낸 한글 토큰이 있는지 본다(일간 NetcusSubmit 의 되읽기와 같은 규칙). 제출('y')은 사용자가 인트라넷에서 한다.
        // ================================================================================

        // 성공 문구. 반드시 "주간보고 " 로 시작한다(웹이 이 머리로 주간 회신을 가른다, REPORT-EDIT 정정 3).
        //   matches = 고친 기존 글을 고를 때 본 같은 기간 글 수. 둘 이상이면 예전 수정 경로 문구의 중복 안내를 그대로 붙인다(새 글이면 0).
        internal static string WeekSavedOkMsg(int matches)
        {
            string m = "주간보고 임시저장을 마쳤습니다. 제출은 인트라넷에서 하세요.";
            if (matches > 1) m += " 같은 기간 글이 " + matches.ToString(CultureInfo.InvariantCulture) + "개 있어 가장 최근 글을 열었습니다. 나머지는 회사 화면에서 지워 주세요.";
            return m;
        }

        // 임시저장 단추를 누르지 못했다(끼운 함수가 없거나 기간, 제목 검사에서 멈춰 폼을 만들지 않았다). 이때 창은 닫는다(자동 수락이 켜진 채 로드된 문서라 넘기지 않는다).
        internal const string WeekSaveFailMsg = "임시저장을 누르지 못했습니다. 페이지 구조가 바뀌었을 수 있습니다.";

        // [WEEKLY-UPSERT:JS] 임시저장: 앞서 끼운 안전한 Bwrite(새 글) 또는 Bmodify(수정)를 'n' 으로 부른다. 'y'(제출)는 부르지 않는다.
        //   두 대체 함수는 보낼 때 data-tc-week="1" 폼을 만든다. 그 폼이 생겼으면 SUBMITTED, 함수가 없으면 NOFN, 검사에서 멈췄으면 NOFORM.
        internal static string WeekTempSaveJs(bool modify)
        {
            string fn = modify ? "Bmodify" : "Bwrite";
            return "(function(){try{if(typeof window." + fn + "!=='function')return 'NOFN';window." + fn + "('n');"
                + "return document.querySelector('form[data-tc-week=\"1\"]')?'SUBMITTED':'NOFORM';}catch(e){return 'ERR '+((e&&e.message)||e);}})()";
        }

        // 저장 중 회사 사이트가 띄운 알림에 "실패" 가 있으면 저장이 안 된 것으로 본다(예: "수정하는데 실패하였습니다").
        //   수정 경로는 예전 글에도 같은 한글 토큰이 있을 수 있어(같은 내용을 다시 보냄) 되읽기만으로는 실패를 못 가린다.
        internal static bool NcSaveAlertFailed(IEnumerable<string>? alerts)
        {
            foreach (var a in alerts ?? Array.Empty<string>()) if ((a ?? "").Contains("실패")) return true;
            return false;
        }

        // 되읽기 판정. 일간 되읽기와 같은 번호를 쓴다: -1 로그인 화면(세션 만료), -2 글을 못 찾음(또는 못 읽음, 다른 글), 0 진행사항이 빔,
        //   1 정상(한글 토큰이 있거나, 보낸 진행사항에 한글이 없고 내용이 있음), 2 저장됐으나 한글 불일치. -3 은 회사 사이트가 저장 실패를 알렸다.
        //   pickedNo = 다시 찾아 고른 글 번호, viewNo = 그 보기 화면 수정 단추에서 다시 읽은 번호, expectNo = 고친 기존 글 번호(새 글이면 "").
        //   보낸 진행사항이 비었으면 읽은 칸도 비어야 맞으므로 빈 칸을 정상으로 본다.
        //   oldEndwork(수정 경로만): 채우기 전 수정 화면의 기존 진행사항. 주면 대조 토막을 NcWeekNeedle(보낸 글, 기존 글)로 고른다.
        //     그런 토막이 없으면(같은 글을 다시 보냄, 새 글이 옛 글의 일부) 바뀐 것이 없어 대조할 수 없으므로 회사 실패 알림(-3)만 보고 정상으로 본다.
        //     null 이면(새 글 경로) 예전처럼 보낸 글의 첫 한글 토막(NetcusHangulNeedle)이다.
        internal static int NcWeekVerify(bool loginPage, bool siteFail, string? pickedNo, string? viewNo, string? expectNo, string? readEndwork, string? sentEndwork, string? oldEndwork = null)
        {
            if (loginPage) return -1;
            string p = NcModifyNo(pickedNo);
            if (p.Length == 0 || NcModifyNo(viewNo) != p) return -2;
            string e = NcModifyNo(expectNo);
            if (e.Length > 0 && e != p) return -2;
            if (siteFail) return -3;
            string v = (readEndwork ?? "").Trim();
            if (v.Length == 0) return (sentEndwork ?? "").Trim().Length == 0 ? 1 : 0;
            string n = oldEndwork == null ? NetcusHangulNeedle(sentEndwork ?? "") : NcWeekNeedle(sentEndwork, oldEndwork);
            return n.Length == 0 ? 1 : (v.IndexOf(n, StringComparison.Ordinal) >= 0 ? 1 : 2);
        }

        // 수정 경로의 대조 토막: 새 진행사항에는 있고 기존 진행사항에는 없는 한글 토막(연속 한글 2 ~ 4자). 없으면 "".
        //   새 글의 한글 묶음(연속 한글)마다 앞에서부터 길이 min(4, 묶음 길이)의 창을 밀며 기존 글에 없는 첫 창을 고른다.
        //   기존 글에도 있는 토막을 고르면 저장이 안 됐어도 옛 글이 대조를 통과한다(같은 과제명으로 시작하는 진행사항).
        internal static string NcWeekNeedle(string? newText, string? oldText)
        {
            string s = newText ?? "", old = oldText ?? "";
            int i = 0;
            while (i < s.Length)
            {
                if (s[i] < 0xAC00 || s[i] > 0xD7A3) { i++; continue; }
                int j = i;
                while (j < s.Length && s[j] >= 0xAC00 && s[j] <= 0xD7A3) j++;
                int len = j - i;
                if (len >= 2)
                {
                    int w = Math.Min(4, len);
                    for (int k = i; k + w <= j; k++)
                    {
                        string c = s.Substring(k, w);
                        if (old.IndexOf(c, StringComparison.Ordinal) < 0) return c;
                    }
                }
                i = j;
            }
            return "";
        }

        // [WEEKLY-UPSERT:JS] 수정 화면의 기존 진행사항(endwork) 값. 채우기 전에 읽어 대조 토막을 고른다(로그에는 남기지 않는다). 칸이 없으면 null.
        internal const string WeekModifyOldEndworkJs = "(function(){try{var e=document.getElementsByName('endwork')[0];return e?String(e.value==null?'':e.value):null;}catch(x){return null;}})()";

        // 되읽기 실패 문구(vr != 1). "주간보고 " 로 시작하지 않는다(성공 회신으로 오인되지 않게). 창은 되읽기 문서째 남는다.
        internal static string WeekVerifyMsg(int vr) => vr switch
        {
            -1 => "세션이 만료됐거나 로그인이 필요합니다. 임시저장이 됐는지 인트라넷에서 확인하세요.",
            -3 => "회사 사이트가 저장 실패를 알렸습니다. 열린 창에서 확인하세요.",
            2 => "임시저장은 됐으나 한글이 깨졌을 수 있습니다(되읽기 대조 불일치). 열린 창에서 확인하세요.",
            _ => "임시저장을 확인하지 못했습니다(같은 기간 글을 다시 찾지 못했거나 진행사항이 비어 있음). 열린 창에서 확인하세요.",
        };

        // [WEEKLY-UPSERT:JS] 목록 페이지 표지: 행이 0개일 때 '빈 목록'과 '목록을 못 읽음'을 가른다(go_view, go_list 함수 또는 table_code 칸).
        internal const string ListPageMarkJs = "(function(){try{return !!(typeof go_view==='function'||typeof go_list==='function'||document.getElementsByName('table_code')[0]);}catch(e){return false;}})()";

        // [WEEKLY-UPSERT:JS] go_modify(postNo) 재현: pjm_modify.jsp?list=go&start=1&view_no=postNo 로 동적 POST(GoViewJs 와 같은 hidden 필드).
        //   postNo 는 보기 화면 수정 단추의 진짜 글 번호다(목록 순번이 아니다).
        internal static string GoModifyJs(string postNo, string id) =>
            "(function(){try{var f=document.createElement('form');f.method='post';f.action='pjm_modify.jsp?list=go&start=1&view_no=" + NcDigits(postNo) + "';"
          + "function H(n,v){var i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i);}"
          + "H('word_code','');H('n_code','');H('s_code','');H('c_code','');H('table_code','report_tbl');H('id'," + J(id) + ");"
          + "document.body.appendChild(f);f.submit();return 'ok';}catch(e){return 'err';}})()";

        // [WEEKLY-UPSERT:JS] 수정 화면 확인: 칸 7개(sdate, edate, wdate, subject, endwork, content, planwork)가 각각 정확히 하나씩 있으면
        //   {sd, ed, wd} JSON 문자열, 없거나 둘 이상이면 null. wdate(작성일)는 수정 화면에만 있는 숨은 칸이라 새 글 화면과 가른다.
        internal const string WeekModifyProbeJs = "(function(){try{function v(n){var l=document.getElementsByName(n);if(l.length!==1)return null;var e=l[0];return String(e.value==null?'':e.value);}"
          + "var o={sd:v('sdate'),ed:v('edate'),wd:v('wdate'),sj:v('subject'),ew:v('endwork'),ct:v('content'),pw:v('planwork')};"
          + "for(var k in o){if(o[k]===null)return null;}return JSON.stringify({sd:o.sd,ed:o.ed,wd:o.wd});}catch(e){return null;}})()";

        // WeekModifyProbeJs 의 ExecuteScriptAsync 반환(JSON 문자열을 다시 JSON 인코딩한 것) → sd, ed, wd. 못 읽으면 false.
        internal static bool NcParseModifyProbe(string? raw, out string sd, out string ed, out string wd)
        {
            sd = ed = wd = "";
            try
            {
                if (string.IsNullOrEmpty(raw) || raw == "null") return false;
                string inner = JsonSerializer.Deserialize<string>(raw) ?? "";
                if (inner.Length == 0) return false;
                using var d = JsonDocument.Parse(inner);
                var r = d.RootElement;
                string G(string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : "";
                sd = G("sd"); ed = G("ed"); wd = G("wd");
                return true;
            }
            catch { return false; }
        }

        // [WEEKLY-UPSERT:JS] 수정 화면 채우기: 진행사항(endwork), 과제투입시간(content), 차주계획(planwork), 회의내용(resultwork) 넷만.
        //   기간, 제목, 작성일, 미처리사항, 문제점, HTML 체크는 건드리지 않는다. 채울 칸이 다 있을 때만 쓰고 1, 아니면 아무것도 안 쓰고 0.
        //   회의내용은 결정 13(2026-10-29)에서 더했다. 이 앱이 DB 에 남겨(구조 20) 완료한 주를 다시 열면 그 값으로 채우기 때문이다.
        //   resultwork 가 null 이면(보고서 창의 옛 주간 전송) 예전 세 칸 JS 그대로다(회의내용 칸을 읽지도 쓰지도 않는다).
        internal static string WeekModifyFillJs(string endwork, string content, string planwork, string? resultwork = null) =>
            resultwork == null
            ? "(function(){try{var e=document.getElementsByName('endwork')[0],c=document.getElementsByName('content')[0],p=document.getElementsByName('planwork')[0];"
              + "if(!e||!c||!p)return 0;"
              + "e.value=" + J(endwork) + ";c.value=" + J(content) + ";p.value=" + J(planwork) + ";return 1;}catch(x){return 0;}})()"
            : "(function(){try{var e=document.getElementsByName('endwork')[0],c=document.getElementsByName('content')[0],p=document.getElementsByName('planwork')[0],r=document.getElementsByName('resultwork')[0];"
              + "if(!e||!c||!p||!r)return 0;"
              + "e.value=" + J(endwork) + ";c.value=" + J(content) + ";p.value=" + J(planwork) + ";r.value=" + J(resultwork) + ";return 1;}catch(x){return 0;}})()";

        // [WEEKLY-UPSERT:JS] 채우기 전 네 칸의 원래 길이(글자 수)만 JSON 으로. 내용은 돌려주지 않는다(로그에 남기지 않으려고). 칸이 없으면 -1.
        //   문의가 왔을 때 무엇을 얼마나 바꿨는지 로그로 가늠하는 용도다.
        internal const string WeekModifyOrigLenJs = "(function(){try{function L(n){var e=document.getElementsByName(n)[0];return e?String(e.value==null?'':e.value).length:-1;}"
          + "return JSON.stringify({endwork:L('endwork'),content:L('content'),planwork:L('planwork'),resultwork:L('resultwork')});}catch(e){return null;}})()";

        // [WEEKLY-UPSERT:JS] Bmodify 안전판. 수정 화면은 칸이 빈 <form name="form"> 밖에 형제로 있어, 원래 Bmodify(document.form.submit)는
        //   빈 폼을 보낼 수 있다(기존 글을 빈 값으로 덮는다). 새 글 화면의 Bwrite 대체처럼 동적 폼으로 바꿔 끼운다.
        //   칸 모으기(window.__tcWeekFields): 파서가 칸을 그 form 에 묶었으면(form.elements 가 비어 있지 않으면) form.elements 를,
        //   아니면 문서의 이름 있는 input, textarea, select 전부를 모은다. 원래 Bmodify 가 보냈을 칸(모르는 숨은 칸 포함)을 빠뜨리지 않으려고 고정 목록을 쓰지 않는다.
        //   빼는 것: 이름 없음, disabled, file, button, submit, reset, image, 체크 안 된 checkbox, radio, 앞서 만든 우리 폼(data-tc-week) 안의 칸.
        //   iscompletion 은 인자로 바꿔 싣는다(없으면 덧붙인다). textarea 는 textarea 로 옮긴다. 검사(기간, 제목)와 'y'(제출)의 확인창, action 은 원본과 같다.
        //   반환 "ok sig=1|0 form=1|0 names=a,b,..." : sig=1 이면 원래 Bmodify 소스에 pjm_modify.jsp?go=write 가 있었다(구조 그대로),
        //   form=1 이면 form.elements 로 모았다(칸이 폼에 묶여 있다), names 는 지금 모이는 칸 이름(값은 싣지 않는다).
        internal static string WeekModifyOverrideJs(string postNo, string id) =>
            "(function(){try{var sig=0;try{sig=(String(window.Bmodify||'').indexOf('pjm_modify.jsp?go=write')>=0)?1:0;}catch(_){}"
          + "window.__tcWeekFields=function(){var fm=document.forms&&document.forms['form'];var useForm=!!(fm&&fm.elements&&fm.elements.length>0);"
          + "var src=useForm?fm.elements:document.querySelectorAll('input[name],textarea[name],select[name]');var out=[];"
          + "for(var i=0;i<src.length;i++){var e=src[i];if(!e||!e.name||e.disabled)continue;var tg=String(e.tagName||'').toUpperCase();"
          + "if(tg!=='INPUT'&&tg!=='TEXTAREA'&&tg!=='SELECT')continue;"
          + "if(e.form&&e.form.getAttribute&&e.form.getAttribute('data-tc-week')==='1')continue;"
          + "var t=String(e.type||'').toLowerCase();if(t==='file'||t==='button'||t==='submit'||t==='reset'||t==='image')continue;"
          + "if((t==='checkbox'||t==='radio')&&!e.checked)continue;"
          + "if(tg==='SELECT'&&e.multiple){for(var k=0;k<e.options.length;k++){if(e.options[k].selected)out.push([e.name,e.options[k].value,0]);}continue;}"
          + "out.push([e.name,e.value,tg==='TEXTAREA'?1:0]);}return {form:useForm,list:out};};"
          + "window.Bmodify=function(iscompletion){"
          + "var sd=document.getElementsByName('sdate')[0],sj=document.getElementsByName('subject')[0];"
          + "if(sd&&!sd.value){alert('기간을 선택하세요.');return;}"
          + "if(sj&&!sj.value){alert('제목을 입력하세요.');return;}"
          + "if(iscompletion==='y'&&!confirm('제출하시겠습니까?'))return;"
          + "var c=window.__tcWeekFields();"
          + "var f=document.createElement('form');f.method='post';f.enctype='multipart/form-data';f.acceptCharset='euc-kr';f.setAttribute('data-tc-week','1');"
          + "f.action='pjm_modify.jsp?go=write&table=report_tbl&view_no=" + NcDigits(postNo) + "&id='+encodeURIComponent(" + J(id) + ");"
          + "function H(n,v,ta){var i=document.createElement(ta?'textarea':'input');if(!ta)i.type='hidden';i.name=n;i.value=v;f.appendChild(i);}"
          + "var isc=false;for(var j=0;j<c.list.length;j++){var x=c.list[j];if(x[0]==='iscompletion'){if(!isc){H('iscompletion',iscompletion,0);isc=true;}continue;}H(x[0],x[1],x[2]);}"
          + "if(!isc)H('iscompletion',iscompletion,0);"
          + "document.body.appendChild(f);f.submit();};"
          + "var c0=window.__tcWeekFields(),nm=[];for(var q=0;q<c0.list.length;q++)nm.push(c0.list[q][0]);"
          + "return 'ok sig='+sig+' form='+(c0.form?1:0)+' names='+nm.join(',');}catch(e){return 'err';}})()";
    }
}
