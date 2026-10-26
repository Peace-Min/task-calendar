using System;
using System.Threading.Tasks;

namespace TaskCalendarWidget
{
    // 회사 성공 후 DB를 원자적으로 저장한다. 재시도는 항상 회사 요청부터 시작한다.
    internal static class AttendanceWorkflow
    {
        internal const string Failure = "처리를 완료하지 못했습니다. 다시 시도해 주세요.";
        internal sealed class Result
        {
            public bool Ok { get; init; }
            public string Stage { get; init; } = "";
            public string Error => Ok ? "" : Failure;
        }
        internal static async Task<Result> Run(AttendanceDocument d, Func<Task<AttendanceReceipt>> company, Func<AttendanceDocument,AttendanceReceipt,Task> store, Action<string> log)
        {
            AttendanceReceipt receipt;
            try { receipt=await company(); }
            catch(Exception ex) { log("근태 보고 회사 처리 실패: "+ex.GetType().Name);return new Result{Stage="company"}; }
            if(receipt.State!="confirmed")return new Result{Stage="company"};
            try { await store(d,receipt); }
            catch(Exception ex) { log("근태 보고 DB 저장 실패: "+ex.GetType().Name);return new Result{Stage="database"}; }
            return new Result{Ok=true,Stage="complete"};
        }
    }
}
