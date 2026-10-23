using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using TaskCalendarWidget;

namespace MonthlyDocxMock
{
    // 월간보고 DOCX 목업. 실행(저장소 루트에서): dotnet run --project tests/tools/monthly-docx-mock -- <out.docx>
    // 값은 전부 지어낸 것이다(과제명은 '(예시)' 머리, 사람 이름은 홍길동, 김예시).
    // 실제 보고서의 과제명, 동료 이름, 본문은 저장소에 두지 않는다(docs/MONTHLY-REPORT-PLAN.md 2장).
    //
    // 일부러 넣은 것:
    //  - 과제 A 실적 약 45줄(표가 쪽을 넘어 이어지는지 본다), 그림 2장(PNG, JPEG)
    //  - 이스케이프 시료 A&B <태그> "따옴표" 와 제어 문자(\u0007) 줄
    //  - 과제 B 그림 없음, 이력 없음, 왼쪽 계획 빈칸 / 과제 C 기간 빈칸, 그림 1장, 이력 1줄
    //  - 과제 D 계획 두 칸과 이력이 빈 목록(2026-10-23 월간 탭 모양), 그림 없음
    //  - 기타 표 4줄
    // 시험(tests/loop-monthly-docx.mjs)이 이 값을 기준으로 문서를 검사한다. 값을 바꾸면 그쪽도 같이 본다.
    internal static class Program
    {
        private static int Main(string[] args)
        {
            if (args.Length < 1)
            {
                Console.Error.WriteLine("사용법: dotnet run --project tests/tools/monthly-docx-mock -- <out.docx>");
                return 2;
            }
            string outPath = Path.GetFullPath(args[0]);

            // 그림은 현재 폴더가 아니라 이 프로젝트 폴더 기준으로 찾는다(어디서 실행해도 같게).
            string fixtures = Path.GetFullPath(Path.Combine(ProjectDir(), "..", "..", "fixtures", "monthly-docx"));
            byte[] ganttA = File.ReadAllBytes(Path.Combine(fixtures, "gantt-a.png"));
            byte[] ganttB = File.ReadAllBytes(Path.Combine(fixtures, "gantt-b.jpg"));

            var r = new DocxWriter.Report
            {
                Name = "홍길동",
                ReportDate = new DateTime(2026, 10, 20),
                ActualFrom = new DateTime(2026, 8, 31),
                ActualTo = new DateTime(2026, 10, 16),
                PlanFrom = new DateTime(2026, 10, 19),
                PlanTo = new DateTime(2026, 12, 4),
                Projects = new List<DocxWriter.Project> { ProjectA(ganttA, ganttB), ProjectB(), ProjectC(ganttB), ProjectD() },
                Etc = new List<DocxWriter.Line>
                {
                    L(0, "- 사내 교육 참석 (09.24)"),
                    L(1, "; 보안 교육, 정보보호 서약"),
                    L(0, "- 내부 검토 자료 작성 (w. 김예시 선임)"),
                    L(1, "; 세부 내용 정리"),
                },
            };

            DocxWriter.Write(outPath, r);
            Console.WriteLine("작성: " + outPath + " (" + new FileInfo(outPath).Length + " bytes)");
            return 0;
        }

        private static string ProjectDir([CallerFilePath] string here = "") =>
            Path.GetDirectoryName(here) ?? ".";

        private static DocxWriter.Line L(int level, string text, bool bold = false) => new DocxWriter.Line(level, text, bold);

        private static DocxWriter.Project ProjectA(byte[] png, byte[] jpg)
        {
            var actual = new List<DocxWriter.Line>
            {
                L(0, "▪ 구현", true),
                L(1, "1. 기능 보완", true),
                L(2, "- 화면 응답 속도 개선"),
                L(3, "; 목록 갱신 횟수 줄임"),
                L(3, "; 표 다시 그리기 범위 축소"),
                L(2, "- 시나리오 편집기 저장 오류 수정"),
                L(3, "; 저장 중 창을 닫으면 파일이 비는 문제"),
                L(2, "- 비교 기호 표시 확인: A&B <태그> \"따옴표\""),
                L(3, "; 제어 문자 제거 확인(\u0007 이 글자 앞의 종소리 문자는 빠져야 한다)"),
                L(1, "2. 신규 기능", true),
                L(2, "- 표적 궤적 재생 속도 조절"),
                L(3, "; 0.5배, 1배, 2배, 4배"),
                L(3, "; 재생 중 속도 바꾸기"),
                L(2, "- 기록 파일 내보내기(CSV)"),
                L(3, "; 열 순서 사용자 지정"),
                L(2, "- 시뮬레이션 일시 정지 상태 저장"),
                L(1, "3. 시험", true),
                L(2, "- 단위 시험 보강"),
                L(3, "; 경계 값 시험 30건 추가"),
                L(2, "- 연동 시험(모의 장비)"),
                L(3, "; 장시간(8시간) 연속 구동"),
                L(3, "; 메모리 사용량 기록"),
                L(1, "4. 문서", true),
                L(2, "- 사용자 설명서 갱신"),
                L(2, "- 인터페이스 정의서 개정안 작성"),
                L(3, "; 메시지 3종 추가"),
                L(0, "▪ 유지보수", true),
                L(2, "- 설치본 서명 갱신"),
                L(2, "- 로그 보관 기간 설정 추가"),
                L(3, "; 기본 30일"),
                L(2, "- 고객 문의 대응 4건"),
                L(0, "▪ 회의", true),
                L(1, "- 중간 점검 회의 (09.15, 고객사)"),
                L(2, "; 화면 개선 요청 3건 접수"),
                L(1, "- 내부 설계 검토 (09.22, 본사)"),
                L(1, "- 시험 계획 협의 (10.06, 고객사)"),
                L(2, "; 시험 일정 11월 둘째 주로 합의"),
                L(1, "- 주간 진행 회의 (매주 월, 본사)"),
                L(0, "▪ 기타", true),
                L(1, "- 내부 검토 자료 작성 (w. 김예시 선임)"),
                L(1, "- 개발 환경 정리"),
                L(2, "; 빌드 서버 디스크 정리"),
                L(2, "; 저장소 오래된 브랜치 정리"),
                L(1, "- 신규 입사자 교육 지원 (w. 김예시 선임)"),
                L(2, "; 개발 환경 설치 안내"),
            };
            return new DocxWriter.Project
            {
                Title = "(예시) 관제 시뮬레이터 고도화",
                Term = "2025/08 ~ 2026/12",
                Images = new List<byte[]> { png, jpg },
                Changes = new List<DocxWriter.Change>
                {
                    new DocxWriter.Change { What = "시험 일정 연기", Date = "2026.09.15", Why = "고객사 장비 반입 지연" },
                    new DocxWriter.Change { What = "문서 납품 순서 변경", Date = "2026.10.06", Why = "고객 요청(설명서 먼저)" },
                },
                PrevPlan = new List<DocxWriter.Line>
                {
                    L(0, "▪ 구현", true),
                    L(2, "- 화면 응답 속도 개선"),
                    L(2, "- 재생 속도 조절 기능"),
                },
                Actual = actual,
                NextPlan = new List<DocxWriter.Line>
                {
                    L(0, "▪ 구현", true),
                    L(2, "- 기록 파일 내보내기 마무리"),
                    L(0, "▪ 시험", true),
                    L(2, "- 고객사 연동 시험 (11월 둘째 주)"),
                },
            };
        }

        private static DocxWriter.Project ProjectB() => new DocxWriter.Project
        {
            Title = "(예시) 시험장비 운용SW",
            Term = "2026/03 ~ 2027/06",
            Actual = new List<DocxWriter.Line>
            {
                L(0, "▪ 구현", true),
                L(2, "- 장비 상태 화면 초안"),
                L(3, "; 경고 색 규칙 정리"),
            },
            NextPlan = new List<DocxWriter.Line>
            {
                L(2, "- 장비 상태 화면 검토 반영"),
            },
        };

        private static DocxWriter.Project ProjectC(byte[] jpg) => new DocxWriter.Project
        {
            Title = "(예시) 신규 과제 착수",
            Term = "",
            Images = new List<byte[]> { jpg },
            Changes = new List<DocxWriter.Change>
            {
                new DocxWriter.Change { What = "착수 회의 일정 조정", Date = "2026.10.02", Why = "계약 지연" },
            },
            PrevPlan = new List<DocxWriter.Line> { L(2, "- 착수 준비") },
            Actual = new List<DocxWriter.Line> { L(0, "▪ 회의", true), L(1, "- 착수 회의 (10.08, 고객사)") },
            NextPlan = new List<DocxWriter.Line> { L(2, "- 요구사항 분석") },
        };

        // 과제 D: 2026-10-23 부터 월간 탭이 보내는 모양 그대로. 수행 계획 두 칸과 변경이력이 비어 있고(빈 목록) 실적만 있다.
        // 문서에는 계획 두 칸이 빈 문단 하나씩, 변경이력은 빈 줄 하나로 양식 그대로 나와야 한다(loop-monthly-docx.mjs).
        private static DocxWriter.Project ProjectD() => new DocxWriter.Project
        {
            Title = "(예시) 계획 칸을 비운 과제",
            Term = "2026/01 ~ 2026/12",
            Actual = new List<DocxWriter.Line> { L(0, "- 자료 정리 화면 보완"), L(1, "; 필터 저장") },
        };
    }
}
