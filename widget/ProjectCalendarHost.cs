using System;
using System.Threading.Tasks;

namespace TaskCalendarWidget
{
    // ================================================================================
    //  과제 캘린더 명령 여섯의 배선(docs/PROJECT-CALENDAR-PLAN.md §5.4)
    // ================================================================================
    //  OnWebMessage 의 스위치가 부른다. 메인 창 전용이다: 관리 창(AdminWinCommands)과 열람 창(PeerWinCommands)
    //  허용 목록에 이 명령이 없으므로 그 창에서 오면 OnWebMessage 가 먼저 거절한다(시험이 지킨다).
    //  ★ 판정, 신원, SQL 은 전부 ProjectCalendarDb 에 있다. 여기는 회신과 개인 스냅샷 재적재만 한다.
    //  ★ 웹이 보낸 사용자 값은 넘기지 않는다. 신원은 ProjectCalendarDb 가 세션에서 읽는다.
    public partial class MainWindow
    {
        private async Task RunProjectCalendarAsync(string cmd, string reqId, string raw)
        {
            ProjectCalendarReply r;
            try
            {
                r = await new ProjectCalendarDb(_dataDir, Log).HandleAsync(cmd, raw);
            }
            catch (Exception ex)
            {
                //  HandleAsync 가 예외를 회신으로 바꾸므로 여기 닿는 것은 그 밖의 사고다. 원문은 로그에만 남긴다.
                Log("과제 캘린더 " + cmd + " 예외: " + ex);
                r = ProjectCalendarReply.Failure(DbErrorKind.Unknown, DbErrors.ConnMessage(DbErrorKind.Unknown));
            }

            //  개인 복사는 성공할 때마다 개인 일정을 새로 만든다(대응표 없음). 그때 개인 스냅샷을 다시 읽어 웹에 적용한다(reloadState 와 같은 길, §5.5 3번).
            //  웹은 복사 전에 개인 화면의 미저장 변경을 먼저 저장하므로(§5.5 1번) 덮을 것이 없다.
            if (r.Ok && r.ReloadPersonal)
            {
                try { await BootFromDbAsync(); }
                catch (Exception ex) { Log("과제 캘린더 복사 뒤 개인 스냅샷 재적재 실패: " + ex.Message); }
            }
            ReplyOnUi(reqId, r.ToPayload());
        }
    }
}
