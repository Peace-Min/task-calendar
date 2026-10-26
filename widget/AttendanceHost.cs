using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;

namespace TaskCalendarWidget
{
    public partial class MainWindow
    {
        private readonly HashSet<string> _attendanceRequests=new(StringComparer.Ordinal);
        private async Task RunAttendanceAsync(string cmd,string reqId,string raw)
        {
            string login=CurrentLoginId()??"";
            if(login.Length==0){ReplyOnUi(reqId,new{ok=false,error="로그인이 필요합니다."});return;}
            if(!_attendanceRequests.Add(login)){ReplyOnUi(reqId,new{ok=false,error="보고 작업이 진행 중입니다."});return;}
            object result;
            try {
                using var json=JsonDocument.Parse(raw);var r=json.RootElement;
                string Str(string k)=>r.TryGetProperty(k,out var v)&&v.ValueKind==JsonValueKind.String?v.GetString()??"":"";
                int Num(string k)=>r.TryGetProperty(k,out var v)&&v.TryGetInt32(out var n)?n:0;
                var db=new AttendanceDb(login,Log);
                if(cmd=="attendanceCategories")result=new{ok=true,categories=await db.Categories()};
                else if(cmd=="attendanceList")result=new{ok=true,data=await db.List(Str("kind"),Str("from"),Str("to"),Str("search"),Num("page"))};
                else {
                    var d=AttendanceDocument.Parse(r.GetProperty("document").GetRawText());
                    AttendanceDocument.Date(d.From);AttendanceDocument.Date(d.To);
                    if(cmd=="attendanceLoad")result=new{ok=true,data=await db.Detail(d)};
                    else if(cmd=="attendancePrepare") {
                        await db.Prepare(d);
                        result=new{ok=true,document=JsonSerializer.SerializeToElement(d,AttendanceDocument.Json)};
                    } else if(cmd=="attendanceSubmit") {
                        // 조회와 검증은 먼저 하되 보고 기록은 회사 성공 이후에만 쓴다.
                        var reviewed=d.Serialize();await db.Prepare(d);
                        if(reviewed!=d.Serialize())throw new InvalidOperationException("과제 정보가 바뀌었습니다. 내용을 다시 확인하세요.");
                        var outcome=await AttendanceWorkflow.Run(d,()=>_netcus.AttendanceAsync(login,d,true),db.StoreConfirmed,Log);
                        result=new{ok=outcome.Ok,error=outcome.Error,stage=outcome.Stage};
                    } else if(cmd=="attendanceCompanyRead") {
                        var receipt=await _netcus.AttendanceAsync(login,d,false);
                        result=new{ok=receipt.CompanyJson.Length>0,company=receipt.CompanyJson,error=receipt.CompanyJson.Length>0?"":receipt.Message,checkedAt=DateTime.UtcNow.ToString("O")};
                    } else throw new ArgumentException("지원하지 않는 보고 명령입니다.");
                }
            } catch(Exception ex) {
                Log("근태 보고: "+cmd+" "+ex.GetType().Name);
                result=new{ok=false,error=cmd=="attendanceSubmit"?AttendanceWorkflow.Failure:ex.Message};
            } finally {_attendanceRequests.Remove(login);}
            if(string.Equals(login,CurrentLoginId(),StringComparison.Ordinal))ReplyOnUi(reqId,result);
        }
    }
}
