using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using static TaskCalendarWidget.NetcusText;

namespace TaskCalendarWidget
{
    internal sealed partial class NetcusService
    {
        // No UI callback shared with the old report editor. Each request returns its own receipt.
        internal async Task<AttendanceReceipt> AttendanceAsync(string login, AttendanceDocument d, bool send)
        {
            if (_ncBusy) return new AttendanceReceipt { Message = "다른 회사 시스템 작업이 진행 중입니다." };
            _ncBusy = true; NetcusBusy(true); Action? detach = null; bool dispatchStarted = false;
            try
            {
                if (!await _host.GateOkAsync()) throw new InvalidOperationException("DB 버전 관문을 확인하세요.");
                var (id,pw) = NetcusLoadCreds();
                if (!string.Equals(login,id,StringComparison.Ordinal) || string.IsNullOrEmpty(pw) || NetcusCredsValid()==false)
                    throw new InvalidOperationException("로그인 계정과 회사 자격증명을 확인하세요.");
                await EnsureW2(background:true); var cw=_w2!.CoreWebView2;
                detach=AttachDialogAutoAccept(cw,"attendance");
                if(!await NetcusLoginVerify(cw,id,pw))throw new InvalidOperationException("회사 로그인을 확인하지 못했습니다.");
                string view="", action="";
                if(d.Kind=="daily")
                {
                    var dt=AttendanceDocument.Date(d.From);
                    view=$"https://www.netcus.com/pjm/pjm_work_view.jsp?y={dt.Year}&m={dt.Month}&d={dt.Day}&id={Uri.EscapeDataString(id)}";
                    if(!await NavTo(cw,view))throw new InvalidOperationException("일간보고 페이지 조회 실패");
                    action=view+"&go=write&table=report_tbl";
                }
                else
                {
                    var hit=await AttendanceFindWeek(cw,id,d);
                    if(hit.Length>0)
                    {
                        var nav=NavOnce(cw,15000); await cw.ExecuteScriptAsync(GoModifyJs(hit,id)); if(!await nav)throw new InvalidOperationException("주간보고 수정 화면 조회 실패");
                        action="pjm_modify.jsp?go=write&table=report_tbl&view_no="+hit+"&id="+Uri.EscapeDataString(id);
                    }
                    else
                    {
                        if(!send)return new AttendanceReceipt { State="absent", Message="회사에서 같은 대상 기간의 보고를 찾지 못했습니다." };
                        var nav=NavOnce(cw,15000);
                        await cw.ExecuteScriptAsync(AttendanceCompanyScripts.Post("pjm_write.jsp",new Dictionary<string,string>{{"table_code","report_tbl"},{"id",id}}));
                        if(!await nav)throw new InvalidOperationException("주간보고 작성 화면 조회 실패");
                        action="pjm_write.jsp?go=write&table=report_tbl&id="+Uri.EscapeDataString(id);
                    }
                }
                var before=await AttendanceFields(cw);
                if (d.Kind == "daily" && (!before.ContainsKey("status") || !before.ContainsKey("overtime")))
                    throw new InvalidOperationException("일간 양식의 근태와 초과근무 필드를 확인하지 못했습니다.");
                if(d.Kind=="weekly" && before.TryGetValue("sdate",out var sd) && !string.IsNullOrEmpty(sd))
                {
                    if(!NcDate(sd,out var a)||!before.TryGetValue("edate",out var ed)||!NcDate(ed,out var b)||a!=AttendanceDocument.Date(d.From)||b!=AttendanceDocument.Date(d.To))
                        throw new InvalidOperationException("회사 보고 대상 기간이 다릅니다.");
                }
                if(!send)return AttendanceVerify(d,before);
                var patch=new Dictionary<string,string>();
                if(d.Kind=="daily")
                {
                    patch["content"]=d.WorkText; patch["overtime"]=d.Overtime.ToString(CultureInfo.InvariantCulture);
                    if(d.Status.Length>0)patch["status"]=d.Status; // empty preserves company's current status
                }
                else
                {
                    foreach(var n in new[]{"sdate","edate","subject","content","endwork","planwork","notendwork","problem","resultwork"})
                        if(!before.ContainsKey(n))throw new InvalidOperationException("주간 양식의 추가 항목을 확인하지 못했습니다: "+n);
                    d.NotEndWork ??= before["notendwork"];
                    d.Problem ??= before["problem"];
                    d.ResultWork ??= before["resultwork"];
                    patch["sdate"]=d.From; patch["edate"]=d.To; patch["subject"]=d.Title;
                    patch["content"]=d.HoursText; patch["endwork"]=d.WorkText; patch["planwork"]=d.PlanText; patch["iscompletion"]="y";
                    if(d.NotEndWork!=null)patch["notendwork"]=d.NotEndWork;
                    if(d.Problem!=null)patch["problem"]=d.Problem;
                    if(d.ResultWork!=null)patch["resultwork"]=d.ResultWork;
                }
                if (d.Kind == "daily" && d.Status.Length == 0) d.Status = before["status"];
                // Any exception from this point could have happened after the POST left the process.
                dispatchStarted=true; var posted=NavOnce(cw,20000);
                var result=await cw.ExecuteScriptAsync(AttendanceCompanyScripts.Post(action,patch));
                if(result!="\"DISPATCHED\"")throw new InvalidOperationException("전송 여부를 확인할 수 없습니다.");
                await posted;
                if(d.Kind=="daily") { if(!await NavTo(cw,view))throw new InvalidOperationException("전송 후 일간 되읽기 실패"); }
                else
                {
                    var hit=await AttendanceFindWeek(cw,id,d);
                    if(hit.Length==0)throw new InvalidOperationException("전송 후 주간 글을 찾지 못했습니다.");
                    var nav=NavOnce(cw,15000);await cw.ExecuteScriptAsync(GoModifyJs(hit,id));if(!await nav)throw new InvalidOperationException("전송 후 주간 되읽기 실패");
                }
                var after=await AttendanceFields(cw); var receipt=AttendanceVerify(d,after);
                // Unknown, non-editable fields are transported intact; these editable additional fields must also survive.
                if(d.Kind=="weekly")foreach(var n in new[]{"notendwork","problem","resultwork"})
                    if(!after.TryGetValue(n,out var v)||Normal(v)!=Normal(patch.TryGetValue(n,out var edit)?edit:before[n]))
                        return new AttendanceReceipt{State="unknown",Message="회사 추가 항목의 보존을 확인하지 못했습니다.",CompanyJson=JsonSerializer.Serialize(after)};
                return receipt;
            }
            catch(Exception ex)
            {
                _host.Log("근태 보고 작업: "+ex.GetType().Name); // no report prose or credentials in new logs
                return new AttendanceReceipt {State=dispatchStarted?"unknown":"failed",Message=ex.Message};
            }
            finally
            {
                detach?.Invoke();try{_w2win?.Close();}catch{} _ncBusy=false;NetcusBusy(false);
            }
        }
        private static string Normal(string s)=>(s??"").Replace("\r\n","\n").Replace("\r","\n");
        internal static AttendanceReceipt AttendanceVerify(AttendanceDocument d,Dictionary<string,string> fields)
        {
            bool Eq(string n,string expected)=>fields.TryGetValue(n,out var v)&&Normal(v)==Normal(expected);
            bool ok=d.Kind=="daily" ? Eq("content",d.WorkText)&&Eq("overtime",d.Overtime.ToString(CultureInfo.InvariantCulture))&&(d.Status==""||Eq("status",d.Status))
                : Eq("subject",d.Title)&&Eq("content",d.HoursText)&&Eq("endwork",d.WorkText)&&Eq("planwork",d.PlanText)&&Eq("iscompletion","y")
                    && fields.TryGetValue("sdate",out var sd)&&NcDate(sd,out var a)&&a==AttendanceDocument.Date(d.From)
                    && fields.TryGetValue("edate",out var ed)&&NcDate(ed,out var b)&&b==AttendanceDocument.Date(d.To)
                    && (d.NotEndWork == null || Eq("notendwork", d.NotEndWork))
                    && (d.Problem == null || Eq("problem", d.Problem))
                    && (d.ResultWork == null || Eq("resultwork", d.ResultWork));
            return new AttendanceReceipt{State=ok?"confirmed":"unknown",Message=ok?"회사에서 동일한 제출 내용을 확인했습니다.":"회사 제출 결과를 확인하지 못했습니다. 다시 시도해 주세요.",CompanyJson=JsonSerializer.Serialize(fields),ConfirmedAt=ok?DateTime.UtcNow:null};
        }
        private static async Task<Dictionary<string,string>> AttendanceFields(CoreWebView2 cw)
        {
            var raw=await cw.ExecuteScriptAsync(AttendanceCompanyScripts.Read);
            var inner=JsonSerializer.Deserialize<string>(raw)??throw new InvalidOperationException("회사 필드 조회 실패");
            return JsonSerializer.Deserialize<Dictionary<string,string>>(inner)??throw new InvalidOperationException("회사 필드 조회 실패");
        }
        private async Task<string> AttendanceFindWeek(CoreWebView2 cw,string id,AttendanceDocument d)
        {
            if(!await NavTo(cw,"https://www.netcus.com/pjm/pjm.jsp?id="+Uri.EscapeDataString(id)))throw new InvalidOperationException("주간 목록 조회 실패");
            var matches=new List<string>();bool invalid=false;
            // Do not infer report period from registration date. Examine actual period cells, including old reports.
            var end=await NcCrawlWeekly(cw,id,DateTime.MinValue,DateTime.MaxValue,200,2000,"근태 주간 기간 확인",_=>{},(no,reg,cell)=>{
                if(cell==null||!NcPeriod(cell.period,out var a,out var b)){invalid=true;return true;}
                if(a==AttendanceDocument.Date(d.From)&&b==AttendanceDocument.Date(d.To)) {if(cell.mod!="1")invalid=true;else matches.Add(no);}return true;});
            if(invalid||end.SessionLost||end.Capped||end.NoProgress||(end.EmptyPage==0&&!end.AllOlder)||matches.Count>1)
                throw new InvalidOperationException("주간 이력이 불완전하거나 같은 기간 글이 여러 개입니다. 회사에서 확인하세요.");
            if(end.EmptyPage>0&&await cw.ExecuteScriptAsync(ListPageMarkJs)!="true")throw new InvalidOperationException("주간 목록을 확인하지 못했습니다.");
            return matches.Count==1?matches[0]:"";
        }
    }
}
