using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;

namespace TaskCalendarWidget
{
    // Structured input is the only source of report text. Never parse hours back out of prose.
    internal sealed class AttendanceLine
    {
        public string CategoryId { get; set; } = "";
        public string Name { get; set; } = "";
        public decimal Hours { get; set; }
        public string Work { get; set; } = "";
        public string Plan { get; set; } = "";
    }

    internal sealed class AttendanceDocument
    {
        internal static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
        public string Kind { get; set; } = "daily";
        public string From { get; set; } = "";
        public string To { get; set; } = "";
        public string Status { get; set; } = "";
        public int Overtime { get; set; }
        public List<AttendanceLine> Lines { get; set; } = new();
        // Null preserves company values. Empty string is an explicit user edit, including clearing.
        public string? NotEndWork { get; set; }
        public string? Problem { get; set; }
        public string? ResultWork { get; set; }
        public string Title => Kind == "daily" ? From + " 일간보고" : From + " ~ " + To + " 주간보고";
        public string HoursText => string.Join("\n", Lines.Select(l => "[" + l.Name + "] : " + l.Hours.ToString("0.##", CultureInfo.InvariantCulture) + "시간"));
        public string WorkText => string.Join("\n\n", Lines.Select(l => "[" + l.Name + "] : " + l.Hours.ToString("0.##", CultureInfo.InvariantCulture) + "시간\n" + l.Work.Trim()));
        public string PlanText => string.Join("\n\n", Lines.Select(l => "[" + l.Name + "]\n" + l.Plan.Trim()));
        public string Serialize() => JsonSerializer.Serialize(this, Json);
        public static AttendanceDocument Parse(string raw) => JsonSerializer.Deserialize<AttendanceDocument>(raw, Json) ?? throw new ArgumentException("보고 입력이 없습니다.");
        public static DateTime Date(string s) => DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : throw new ArgumentException("날짜 형식을 확인하세요.");
        public void Validate()
        {
            var a = Date(From); var b = Date(To);
            if ((Kind != "daily" && Kind != "weekly") || b < a || (Kind == "daily" && a != b)) throw new ArgumentException("보고 종류와 기간을 확인하세요.");
            if (!new[] { "", "1", "2", "3", "4", "5", "6", "7", "9", "10", "11", "12" }.Contains(Status)) throw new ArgumentException("근태를 확인하세요.");
            if (Overtime < 0 || Overtime > 11) throw new ArgumentException("초과근무 값을 확인하세요.");
            if (Lines == null || Lines.Count == 0 || Lines.Count > 200) throw new ArgumentException("보고 과제를 선택하세요(최대 200개).");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var l in Lines)
            {
                if (l == null || !ids.Add(l.CategoryId) || string.IsNullOrWhiteSpace(l.CategoryId)) throw new ArgumentException("과제가 비었거나 중복되었습니다.");
                if (!ReportDb.HoursInDomain(l.Hours) || decimal.Round(l.Hours, 2) != l.Hours) throw new ArgumentException("시간은 과제별 0 초과 24 이하, 소수 둘째 자리까지 입력하세요.");
                if (string.IsNullOrWhiteSpace(l.Work) || l.Work.Length > 8000 || l.Plan == null || l.Plan.Length > 8000) throw new ArgumentException("업무 내용은 필수이며 내용과 계획은 각각 8000자 이내입니다.");
            }
            if (new[] { NotEndWork, Problem, ResultWork }.Any(x => x != null && x.Length > 8000)) throw new ArgumentException("추가 항목은 8000자 이내입니다.");
        }
    }

    internal sealed class AttendanceReceipt
    {
        public string State { get; set; } = "failed"; // failed before dispatch, unknown after dispatch, confirmed only after exact read-back
        public string Message { get; set; } = "";
        public string CompanyJson { get; set; } = "";
        public DateTime? ConfirmedAt { get; set; }
    }
}
