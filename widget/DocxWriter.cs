using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace TaskCalendarWidget
{
    // ============ 의존성 0 docx writer (월간보고 양식) ============
    // .docx = ZIP + XML 몇 개. 표 몇 장 때문에 OpenXml SDK/DocX(수 MB)를 끌고 오지 않는다
    // (폐쇄망은 NuGet 을 못 받는다). XlsxWriter 와 같은 원칙이다.
    //
    // ★ 이 클래스는 앱 도메인을 모른다. 어떤 과제를 넣을지, 실적 글을 어디서 가져올지는 호출측 몫이다.
    //   여기 있는 것은 '회사 월간보고 양식(A4 가로)을 그대로 그리는 법'뿐이다.
    //   치수는 원본 양식 PDF 를 잰 값이다(docs/MONTHLY-REPORT-PLAN.md 2장, 7장). 원본 .docx 는 반출하지 않는다.
    //
    // ★ WPF/WinForms/System.Drawing 을 쓰지 않는다. 위젯(net9.0-windows)과 평범한 net9.0 콘솔(시험용 목업
    //   tests/tools/monthly-docx-mock) 양쪽에서 같은 파일을 그대로 컴파일하기 때문이다.
    //   그림 가로세로도 그래서 PNG IHDR, JPEG SOFn 을 직접 읽는다.
    //
    // 레이아웃(과제 표 하나, 격자 7열):
    //   1행 과제명 / 월간 실적 / 월간 계획 (연파랑)
    //   2행 과제명 값(2행부터 끝까지 세로 병합) / 과제 수행 기간 / 기간 값 (연회색)
    //   3행 개발 일정 / 그림
    //   4행 일정 변경이력(아래 이력 줄과 세로 병합) / 변경 내용 / 변경 날짜 / 변경 사유
    //   5행~ 이력 줄(없으면 빈 줄 1개)
    //   끝-1 수행 계획 / 수행 실적 / 수행 계획,  끝 세 칸 본문(쪽을 넘어 이어질 수 있음)
    //
    // Word 와 한컴이 '복구'를 띄우거나 표를 깨뜨리는 원인들을 다음 규칙으로 피한다:
    //  - 자식 순서(스키마 강제): tcPr = tcW, gridSpan, vMerge, tcBorders, shd, noWrap, tcMar, textDirection,
    //    tcFitText, vAlign, hideMark / pPr = pStyle, keepNext, ..., spacing, ind, jc / rPr = rFonts, b, ..., sz, szCs, u
    //    / tblPr = tblStyle, tblW, jc, tblInd, tblBorders, shd, tblLayout, tblCellMar, tblLook
    //  - 세로 병합으로 가려지는 자리도 tc 를 반드시 쓴다(vMerge 계속 + 같은 gridSpan). 빼면 열이 밀린다.
    //  - tc 는 반드시 p 를 하나 이상 가진다(빈 칸도 빈 문단 하나).
    //  - 줄마다 gridSpan 합 = 격자 열 수(RowWriter 가 끝에서 확인한다). tcW 는 걸친 격자 폭의 합.
    //  - 본문 마지막 표 뒤에는 문단이 있어야 한다(표 뒤 빈 문단이 그 역할도 한다). sectPr 은 body 의 마지막.
    //  - 글자는 전부 하나뿐인 런 헬퍼(AppendRun)를 지나며, 그 헬퍼가 Esc 로 이스케이프한다.
    //    XML 1.0 불법 문자 제거, 줄바꿈은 공백으로(한 Line 은 한 문단이다).
    //  - [Content_Types].xml 이 첫 ZIP 엔트리, 경로 구분자는 '/', 디렉터리 엔트리 없음, UTF-8(BOM 없음).
    public static class DocxWriter
    {
        /// 본문 한 줄 = 문단 하나. Level 은 들여쓰기 단계(0..3), 글자는 받은 그대로 쓴다(글머리를 덧붙이지 않는다).
        public sealed class Line
        {
            public int Level { get; set; }
            public string Text { get; set; } = "";
            public bool Bold { get; set; }
            public Line() { }
            public Line(int level, string text, bool bold = false) { Level = level; Text = text ?? ""; Bold = bold; }
        }

        /// 일정 변경이력 한 줄. 날짜는 사용자가 쓴 글자 그대로(형식을 강제하지 않는다).
        public sealed class Change
        {
            public string What { get; set; } = "";
            public string Date { get; set; } = "";
            public string Why { get; set; } = "";
        }

        /// 과제 하나 = 표 하나. Term 은 미리 만든 글자('2025/08 ~ 2026/07'), 비어도 된다.
        /// Images 는 PNG 또는 JPEG 원본 바이트(위에서 아래로 차례로 놓는다).
        public sealed class Project
        {
            public string Title { get; set; } = "";
            public string Term { get; set; } = "";
            public List<Change> Changes { get; set; } = new List<Change>();
            public List<Line> PrevPlan { get; set; } = new List<Line>();
            public List<Line> Actual { get; set; } = new List<Line>();
            public List<Line> NextPlan { get; set; } = new List<Line>();
            public List<byte[]> Images { get; set; } = new List<byte[]>();
        }

        /// 문서 전체. ReportDate 는 작성일(제목 날짜)이며 실적 끝 날짜와 다를 수 있다.
        /// Etc 가 null 이거나 비면 기타 표를 만들지 않는다.
        public sealed class Report
        {
            public string Name { get; set; } = "";
            public DateTime ReportDate { get; set; }
            public DateTime ActualFrom { get; set; }
            public DateTime ActualTo { get; set; }
            public DateTime PlanFrom { get; set; }
            public DateTime PlanTo { get; set; }
            public List<Project> Projects { get; set; } = new List<Project>();
            public List<Line>? Etc { get; set; }
        }

        // ---------- 양식 치수(dxa = 1/20 pt) ----------
        // 열 경계 PDF 실측(85.6, 141.9, 197.7, 317.4, 394.8, 458.3, 592.9, 775.0 pt)을 dxa 로 바꾼 값. 합 13788.
        private static readonly int[] ProjectGrid = { 1126, 1116, 2394, 1548, 1270, 2692, 3642 };
        // 기타 표: 첫 열은 과제 표와 같고 나머지는 한 칸.
        private static readonly int[] EtcGrid = { 1126, 12662 };
        private const int TableWidth = 13788;

        private const string FillA = "DBE5F1";   // 맨 윗줄(과제명, 월간 실적, 월간 계획)
        private const string FillB = "F2F2F2";   // 칸 이름 줄, 과제 수행 기간, 개발 일정
        private const string FontName = "맑은 고딕";

        private const int IndentPerLevel = 284;  // 본문 들여쓰기 한 단계(약 14.2pt)
        // 그림 칸(3~7열 합 11546)에서 좌우 셀 여백(108 x 2)을 뺀 폭. 높이는 한 쪽을 넘지 않게 상한을 둔다.
        private const int ImageMaxWidthDxa = 11330;
        private const int ImageMaxHeightDxa = 7200;
        private const long EmuPerDxa = 635;
        private const long EmuPerPixel = 9525;    // 96 dpi 가정

        private enum Jc { Left, Center }
        private enum VMerge { None, Restart, Continue }

        /// <summary>
        /// 월간보고 docx 를 만든다. 먼저 메모리에서 전부 조립하고(그림 형식 오류 등은 여기서 터진다),
        /// 같은 폴더 임시 파일에 쓴 뒤 성공했을 때만 목적지로 옮긴다(실패 시 반쯤 쓴 파일이 남지 않게).
        /// 대상 파일이 Word/한컴에 열려 잠겨 있으면 IOException 이 그대로 올라온다(호출측이 한국어 안내로 번역).
        /// </summary>
        public static void Write(string path, Report r)
        {
            if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("저장 경로가 비어 있습니다", nameof(path));
            byte[] bytes = Build(r);

            string dir = Path.GetDirectoryName(Path.GetFullPath(path)) ?? ".";
            Directory.CreateDirectory(dir);
            // 임시 파일은 목적지와 같은 폴더에(=같은 볼륨) → File.Move 가 원자적 교체에 가깝게 동작
            string tmp = Path.Combine(dir, "." + Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                File.WriteAllBytes(tmp, bytes);
                File.Move(tmp, path, true);   // 여기서 실패(파일 잠김 등)해도 목적지는 이전 상태 그대로
            }
            finally
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
            }
        }

        /// <summary>docx 바이트를 메모리에서 만든다(파일을 건드리지 않는다).</summary>
        public static byte[] Build(Report r)
        {
            if (r == null) throw new ArgumentNullException(nameof(r));

            // 그림은 본문을 만들면서 차례로 등록된다(rId 와 파일 이름이 여기서 정해진다).
            var media = new List<Media>();
            string documentXml = DocumentXml(r, media);

            using var ms = new MemoryStream();
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            {
                // [Content_Types].xml 은 반드시 첫 엔트리
                AddEntry(zip, "[Content_Types].xml", ContentTypesXml());
                AddEntry(zip, "_rels/.rels", RootRelsXml());
                AddEntry(zip, "docProps/core.xml", CoreXml(r));
                AddEntry(zip, "docProps/app.xml", AppXml());
                AddEntry(zip, "word/document.xml", documentXml);
                AddEntry(zip, "word/styles.xml", StylesXml());
                AddEntry(zip, "word/settings.xml", SettingsXml());
                AddEntry(zip, "word/_rels/document.xml.rels", DocumentRelsXml(media));
                foreach (var m in media)
                    AddBinary(zip, "word/media/" + m.FileName, m.Bytes);
            }
            return ms.ToArray();
        }

        private static void AddEntry(ZipArchive zip, string name, string xml) =>
            AddBinary(zip, name, new UTF8Encoding(false).GetBytes(xml));

        private static void AddBinary(ZipArchive zip, string name, byte[] bytes)
        {
            var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
            using var s = entry.Open();
            s.Write(bytes, 0, bytes.Length);
        }

        // ---------- 그림 ----------

        private sealed class Media
        {
            public string RelId = "";
            public string FileName = "";   // imageN.png | imageN.jpeg
            public byte[] Bytes = Array.Empty<byte>();
            public int DocPrId;
        }

        // 형식과 픽셀 크기. 모르는 형식이면 던진다(빈 칸으로 조용히 넘기면 사용자가 그림이 빠진 걸 모른다).
        private static (string ext, int w, int h) ProbeImage(byte[]? b)
        {
            if (b == null || b.Length < 24) throw new ArgumentException("개발 일정 그림이 비어 있거나 너무 작습니다");
            // PNG: 8바이트 서명 뒤 첫 청크가 IHDR, 그 안에 가로(16)와 세로(20)가 빅엔디언 4바이트.
            if (b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A)
            {
                if (b[12] != (byte)'I' || b[13] != (byte)'H' || b[14] != (byte)'D' || b[15] != (byte)'R')
                    throw new ArgumentException("PNG 그림의 머리(IHDR)를 읽지 못했습니다");
                int w = BigEndian32(b, 16), h = BigEndian32(b, 20);
                if (w <= 0 || h <= 0) throw new ArgumentException("PNG 그림의 가로세로가 0 입니다");
                return ("png", w, h);
            }
            // JPEG: SOI(FFD8) 뒤 마커를 차례로 넘기며 SOFn(C0..CF 중 C4, C8, CC 제외)을 찾는다. 프로그레시브(C2)도 포함.
            if (b[0] == 0xFF && b[1] == 0xD8)
            {
                int i = 2;
                while (i + 3 < b.Length)
                {
                    if (b[i] != 0xFF) throw new ArgumentException("JPEG 그림의 구조를 읽지 못했습니다");
                    byte marker = b[i + 1];
                    if (marker == 0xFF) { i++; continue; }                                   // 채움 바이트
                    if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }   // 길이 없는 마커
                    if (marker == 0xD9 || marker == 0xDA) break;                               // 끝 또는 스캔 시작: SOF 가 없었다
                    int len = (b[i + 2] << 8) | b[i + 3];
                    if (len < 2) break;
                    bool sof = marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
                    if (sof)
                    {
                        if (i + 8 >= b.Length) break;
                        int h = (b[i + 5] << 8) | b[i + 6];
                        int w = (b[i + 7] << 8) | b[i + 8];
                        if (w <= 0 || h <= 0) throw new ArgumentException("JPEG 그림의 가로세로가 0 입니다");
                        return ("jpeg", w, h);
                    }
                    i += 2 + len;
                }
                throw new ArgumentException("JPEG 그림에서 가로세로(SOF)를 찾지 못했습니다");
            }
            throw new ArgumentException("개발 일정 그림은 PNG 또는 JPEG 만 넣을 수 있습니다(알 수 없는 형식)");
        }

        private static int BigEndian32(byte[] b, int at) =>
            (int)(((uint)b[at] << 24) | ((uint)b[at + 1] << 16) | ((uint)b[at + 2] << 8) | b[at + 3]);

        // 96 dpi 로 본 원래 크기에서 칸 폭과 높이 상한에 맞춰 줄이기만 한다(키우지 않는다). 비율 유지.
        private static (long cx, long cy) FitImage(int wPx, int hPx)
        {
            double cx = (double)wPx * EmuPerPixel, cy = (double)hPx * EmuPerPixel;
            double maxW = ImageMaxWidthDxa * EmuPerDxa, maxH = ImageMaxHeightDxa * EmuPerDxa;
            double scale = Math.Min(1.0, Math.Min(maxW / cx, maxH / cy));
            long w = (long)Math.Round(cx * scale), h = (long)Math.Round(cy * scale);
            return (w < 1 ? 1 : w, h < 1 ? 1 : h);
        }

        // ---------- 본문 ----------

        private const string WordNs = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
        private const string RelNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        private const string WpNs = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
        private const string ANs = "http://schemas.openxmlformats.org/drawingml/2006/main";
        private const string PicNs = "http://schemas.openxmlformats.org/drawingml/2006/picture";

        private static string DocumentXml(Report r, List<Media> media)
        {
            var sb = new StringBuilder(64 * 1024);
            sb.Append(Decl);
            sb.Append("<w:document xmlns:w=\"").Append(WordNs).Append("\" xmlns:r=\"").Append(RelNs)
              .Append("\" xmlns:wp=\"").Append(WpNs).Append("\" xmlns:a=\"").Append(ANs)
              .Append("\" xmlns:pic=\"").Append(PicNs).Append("\">");
            sb.Append("<w:body>");

            // 제목. 이름과 날짜 사이 구분 기호는 양식 원본 글자(U+2013)를 그대로 쓴다.
            string title = "월간보고 (" + (r.Name ?? "") + ") \u2013 " +
                           r.ReportDate.ToString("yyyy", CultureInfo.InvariantCulture) + "년 " +
                           r.ReportDate.ToString("MM", CultureInfo.InvariantCulture) + "월 " +
                           r.ReportDate.ToString("dd", CultureInfo.InvariantCulture) + "일";
            AppendPara(sb, title, true, Jc.Center, 0, sizeHalfPt: 24, underline: true);
            AppendEmptyPara(sb);

            string actualHead = "월간 실적: " + MonthDay(r.ActualFrom) + " ~ " + MonthDay(r.ActualTo);
            string planHead = "월간 계획: " + MonthDay(r.PlanFrom) + " ~ " + MonthDay(r.PlanTo);

            foreach (var p in r.Projects ?? new List<Project>())
            {
                if (p == null) continue;
                ProjectTable(sb, p, actualHead, planHead, media);
                AppendEmptyPara(sb);
            }

            var etc = r.Etc;
            if (etc != null && etc.Count > 0)
            {
                EtcTable(sb, etc, actualHead);
                AppendEmptyPara(sb);
            }

            // 구역: A4 가로, 여백은 양식 실측값. pgMar 은 일곱 속성이 모두 필수다.
            sb.Append("<w:sectPr>")
              .Append("<w:pgSz w:w=\"16838\" w:h=\"11906\" w:orient=\"landscape\"/>")
              .Append("<w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1800\" w:header=\"851\" w:footer=\"851\" w:gutter=\"0\"/>")
              .Append("<w:cols w:space=\"425\"/>")
              .Append("<w:docGrid w:linePitch=\"360\"/>")
              .Append("</w:sectPr>");
            sb.Append("</w:body></w:document>");
            return sb.ToString();
        }

        private static string MonthDay(DateTime d) =>
            d.ToString("MM", CultureInfo.InvariantCulture) + "월 " + d.ToString("dd", CultureInfo.InvariantCulture) + "일";

        private static void ProjectTable(StringBuilder sb, Project p, string actualHead, string planHead, List<Media> media)
        {
            OpenTable(sb, ProjectGrid);

            // 1행 머리(연파랑)
            var row = new RowWriter(sb, ProjectGrid, 580, atLeast: true, cantSplit: true);
            row.Label(1, FillA, VMerge.None, "과제명");
            row.Label(4, FillA, VMerge.None, actualHead);
            row.Label(2, FillA, VMerge.None, planHead);
            row.End();

            // 2행 과제명 값(세로 병합 시작) / 과제 수행 기간
            row = new RowWriter(sb, ProjectGrid, 346, atLeast: false, cantSplit: false);
            row.Cell(1, null, VMerge.Restart, true, s => AppendPara(s, p.Title ?? "", false, Jc.Center, 0));
            row.Label(2, FillB, VMerge.None, "과제 수행 기간");
            row.Cell(4, FillB, VMerge.None, true, s => AppendPara(s, p.Term ?? "", false, Jc.Left, 0));
            row.End();

            // 3행 개발 일정(그림)
            row = new RowWriter(sb, ProjectGrid, 692, atLeast: true, cantSplit: false);
            row.Continue(1);
            row.Label(1, FillB, VMerge.None, "개발", "일정");
            row.Cell(5, FillB, VMerge.None, true, s => AppendImages(s, p.Images, media));
            row.End();

            // 4행 일정 변경이력 머리(왼쪽 칸 이름은 아래 이력 줄과 세로 병합)
            row = new RowWriter(sb, ProjectGrid, 346, atLeast: false, cantSplit: true);
            row.Continue(1);
            row.Label(1, FillB, VMerge.Restart, "일정", "변경이력");
            row.Label(1, FillB, VMerge.None, "변경 내용");
            row.Label(1, FillB, VMerge.None, "변경 날짜");
            row.Label(3, FillB, VMerge.None, "변경 사유");
            row.End();

            // 5행~ 이력 줄. 없으면 빈 줄 하나(양식과 같다).
            var changes = new List<Change>();
            foreach (var c in p.Changes ?? new List<Change>()) if (c != null) changes.Add(c);
            if (changes.Count == 0) changes.Add(new Change());
            foreach (var c in changes)
            {
                row = new RowWriter(sb, ProjectGrid, 344, atLeast: false, cantSplit: false);
                row.Continue(1);
                row.Continue(1);
                row.Cell(1, null, VMerge.None, true, s => AppendPara(s, c.What ?? "", false, Jc.Left, 0));
                row.Cell(1, null, VMerge.None, true, s => AppendPara(s, c.Date ?? "", false, Jc.Center, 0));
                row.Cell(3, null, VMerge.None, true, s => AppendPara(s, c.Why ?? "", false, Jc.Left, 0));
                row.End();
            }

            // 끝-1 본문 칸 이름
            row = new RowWriter(sb, ProjectGrid, 392, atLeast: false, cantSplit: true);
            row.Continue(1);
            row.Label(2, FillB, VMerge.None, "수행 계획");
            row.Label(3, FillB, VMerge.None, "수행 실적");
            row.Label(1, FillB, VMerge.None, "수행 계획");
            row.End();

            // 끝 본문(쪽을 넘어 이어질 수 있게 cantSplit 을 주지 않는다)
            row = new RowWriter(sb, ProjectGrid, 1460, atLeast: true, cantSplit: false);
            row.Continue(1);
            row.Cell(2, null, VMerge.None, false, s => AppendLines(s, p.PrevPlan));
            row.Cell(3, null, VMerge.None, false, s => AppendLines(s, p.Actual));
            row.Cell(1, null, VMerge.None, false, s => AppendLines(s, p.NextPlan));
            row.End();

            sb.Append("</w:tbl>");
        }

        // 기타 표: 과제에 속하지 않는 일. 계획 칸이 없다.
        private static void EtcTable(StringBuilder sb, List<Line> lines, string actualHead)
        {
            OpenTable(sb, EtcGrid);

            var row = new RowWriter(sb, EtcGrid, 580, atLeast: true, cantSplit: true);
            row.Label(1, FillA, VMerge.None, "과제명");
            row.Label(1, FillA, VMerge.None, actualHead);
            row.End();

            row = new RowWriter(sb, EtcGrid, 1460, atLeast: true, cantSplit: false);
            row.Cell(1, null, VMerge.None, true, s => AppendPara(s, "기타", false, Jc.Center, 0));
            row.Cell(1, null, VMerge.None, false, s => AppendLines(s, lines));
            row.End();

            sb.Append("</w:tbl>");
        }

        // 표 머리: 고정 레이아웃, 폭 13788, 얇은 검정 실선 테두리, 격자.
        private static void OpenTable(StringBuilder sb, int[] grid)
        {
            sb.Append("<w:tbl><w:tblPr>")
              .Append("<w:tblStyle w:val=\"ReportTable\"/>")
              .Append("<w:tblW w:w=\"").Append(TableWidth).Append("\" w:type=\"dxa\"/>")
              .Append("<w:tblInd w:w=\"0\" w:type=\"dxa\"/>")
              .Append(BordersXml("w:tblBorders"))
              .Append("<w:tblLayout w:type=\"fixed\"/>")
              .Append("<w:tblLook w:val=\"04A0\" w:firstRow=\"0\" w:lastRow=\"0\" w:firstColumn=\"0\" w:lastColumn=\"0\" w:noHBand=\"1\" w:noVBand=\"1\"/>")
              .Append("</w:tblPr>");
            sb.Append("<w:tblGrid>");
            foreach (int w in grid) sb.Append("<w:gridCol w:w=\"").Append(w).Append("\"/>");
            sb.Append("</w:tblGrid>");
        }

        // 테두리 순서: top, left, bottom, right, insideH, insideV.
        private static string BordersXml(string tag)
        {
            var sb = new StringBuilder(400);
            sb.Append('<').Append(tag).Append('>');
            foreach (var side in new[] { "top", "left", "bottom", "right", "insideH", "insideV" })
                sb.Append("<w:").Append(side).Append(" w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"000000\"/>");
            sb.Append("</").Append(tag).Append('>');
            return sb.ToString();
        }

        // 표 한 줄을 쓴다. 칸을 왼쪽부터 붙이며 격자 위치를 세고, End 에서 gridSpan 합이 열 수와 같은지 확인한다
        // (어긋난 표는 Word 에서 열이 밀리고 한컴에서는 칸이 사라진다. 조용히 내보내지 않는다).
        private sealed class RowWriter
        {
            private readonly StringBuilder _sb;
            private readonly int[] _grid;
            private int _col;

            public RowWriter(StringBuilder sb, int[] grid, int height, bool atLeast, bool cantSplit)
            {
                _sb = sb;
                _grid = grid;
                // trPr: cantSplit, trHeight. hRule 을 빼면 스키마 기본값이 atLeast 다.
                sb.Append("<w:tr><w:trPr>");
                if (cantSplit) sb.Append("<w:cantSplit/>");
                sb.Append("<w:trHeight w:val=\"").Append(height).Append('"');
                if (atLeast) sb.Append(" w:hRule=\"atLeast\"");
                sb.Append("/></w:trPr>");
            }

            /// 칸 하나. content 는 문단을 하나 이상 써야 한다(빈 칸이면 AppendEmptyPara).
            public void Cell(int span, string? fill, VMerge vm, bool vCenter, Action<StringBuilder> content)
            {
                if (span < 1 || _col + span > _grid.Length)
                    throw new InvalidOperationException("표 칸이 격자를 넘었습니다(내부 오류)");
                int width = 0;
                for (int i = 0; i < span; i++) width += _grid[_col + i];
                _col += span;

                _sb.Append("<w:tc><w:tcPr>");
                _sb.Append("<w:tcW w:w=\"").Append(width).Append("\" w:type=\"dxa\"/>");
                if (span > 1) _sb.Append("<w:gridSpan w:val=\"").Append(span).Append("\"/>");
                if (vm == VMerge.Restart) _sb.Append("<w:vMerge w:val=\"restart\"/>");
                else if (vm == VMerge.Continue) _sb.Append("<w:vMerge/>");
                if (fill != null) _sb.Append("<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"").Append(fill).Append("\"/>");
                _sb.Append("<w:vAlign w:val=\"").Append(vCenter ? "center" : "top").Append("\"/>");
                _sb.Append("</w:tcPr>");
                content(_sb);
                _sb.Append("</w:tc>");
            }

            /// 칸 이름: 굵게, 가로세로 가운데. 여러 줄이면 줄마다 문단 하나.
            public void Label(int span, string fill, VMerge vm, params string[] lines) =>
                Cell(span, fill, vm, true, s =>
                {
                    foreach (var l in lines) AppendPara(s, l, true, Jc.Center, 0);
                });

            /// 세로 병합으로 가려지는 자리. 내용은 없어도 tc 와 빈 문단은 있어야 한다.
            public void Continue(int span) => Cell(span, null, VMerge.Continue, true, AppendEmptyPara);

            public void End()
            {
                if (_col != _grid.Length)
                    throw new InvalidOperationException("표 한 줄의 칸 폭 합이 격자 열 수와 다릅니다(내부 오류)");
                _sb.Append("</w:tr>");
            }
        }

        // 본문 줄들. 비어 있으면 빈 문단 하나(tc 는 문단이 있어야 한다).
        private static void AppendLines(StringBuilder sb, List<Line>? lines)
        {
            bool any = false;
            if (lines != null)
                foreach (var l in lines)
                {
                    if (l == null) continue;
                    int level = Math.Max(0, Math.Min(3, l.Level));
                    AppendPara(sb, l.Text ?? "", l.Bold, Jc.Left, level * IndentPerLevel);
                    any = true;
                }
            if (!any) AppendEmptyPara(sb);
        }

        private static void AppendImages(StringBuilder sb, List<byte[]>? images, List<Media> media)
        {
            bool any = false;
            if (images != null)
                foreach (var bytes in images)
                {
                    if (bytes == null) continue;
                    var (ext, wPx, hPx) = ProbeImage(bytes);
                    var (cx, cy) = FitImage(wPx, hPx);
                    int n = media.Count + 1;
                    var m = new Media
                    {
                        RelId = "rIdImg" + n,
                        FileName = "image" + n + "." + ext,
                        Bytes = bytes,
                        DocPrId = n,   // 문서 안에서 유일하면 된다
                    };
                    media.Add(m);
                    sb.Append("<w:p>");
                    AppendPPr(sb, Jc.Center, 0);
                    AppendDrawingRun(sb, m, cx, cy);
                    sb.Append("</w:p>");
                    any = true;
                }
            if (!any) AppendEmptyPara(sb);
        }

        // 인라인 그림 런(wp:inline > a:graphic > pic:pic). 글자 런이 아니므로 w:t 가 없다.
        private static void AppendDrawingRun(StringBuilder sb, Media m, long cx, long cy)
        {
            string ext = "cx=\"" + cx.ToString(CultureInfo.InvariantCulture) + "\" cy=\"" + cy.ToString(CultureInfo.InvariantCulture) + "\"";
            sb.Append("<w:r><w:drawing>")
              .Append("<wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\">")
              .Append("<wp:extent ").Append(ext).Append("/>")
              .Append("<wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/>")
              .Append("<wp:docPr id=\"").Append(m.DocPrId).Append("\" name=\"").Append(Esc("그림 " + m.DocPrId)).Append("\"/>")
              .Append("<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect=\"1\"/></wp:cNvGraphicFramePr>")
              .Append("<a:graphic><a:graphicData uri=\"").Append(PicNs).Append("\">")
              .Append("<pic:pic>")
              .Append("<pic:nvPicPr><pic:cNvPr id=\"").Append(m.DocPrId).Append("\" name=\"").Append(Esc(m.FileName)).Append("\"/><pic:cNvPicPr/></pic:nvPicPr>")
              .Append("<pic:blipFill><a:blip r:embed=\"").Append(m.RelId).Append("\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>")
              .Append("<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext ").Append(ext).Append("/></a:xfrm>")
              .Append("<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr>")
              .Append("</pic:pic></a:graphicData></a:graphic></wp:inline>")
              .Append("</w:drawing></w:r>");
        }

        // 문단 하나. 빈 글자면 런 없이 문단만(빈 w:t 를 남기지 않는다).
        private static void AppendPara(StringBuilder sb, string text, bool bold, Jc jc, int indentDxa,
            int sizeHalfPt = 0, bool underline = false)
        {
            sb.Append("<w:p>");
            AppendPPr(sb, jc, indentDxa);
            if (!string.IsNullOrEmpty(text)) AppendRun(sb, text, bold, sizeHalfPt, underline);
            sb.Append("</w:p>");
        }

        private static void AppendEmptyPara(StringBuilder sb) => sb.Append("<w:p/>");

        // pPr 순서: ... spacing, ind, jc. 간격은 styles 의 기본값(앞뒤 0, 줄 240 auto)을 따른다.
        private static void AppendPPr(StringBuilder sb, Jc jc, int indentDxa)
        {
            if (indentDxa <= 0 && jc == Jc.Left) return;
            sb.Append("<w:pPr>");
            if (indentDxa > 0) sb.Append("<w:ind w:left=\"").Append(indentDxa).Append("\"/>");
            if (jc == Jc.Center) sb.Append("<w:jc w:val=\"center\"/>");
            sb.Append("</w:pPr>");
        }

        // ★ 문서의 모든 글자가 지나는 유일한 런 헬퍼. w:t 를 쓰는 곳은 여기 한 곳뿐이고, 글자는 반드시 Esc 를 거친다
        //   (tests/monthly-docx.test.mjs 가 이 모양을 못박는다). rPr 순서: rFonts, b, bCs, ..., sz, szCs, u.
        //   글꼴은 styles 의 기본값(맑은 고딕 10pt)을 따르므로 런에는 다른 것만 적는다.
        private static void AppendRun(StringBuilder sb, string text, bool bold, int sizeHalfPt, bool underline)
        {
            sb.Append("<w:r>");
            if (bold || sizeHalfPt > 0 || underline)
            {
                sb.Append("<w:rPr>");
                if (bold) sb.Append("<w:b/><w:bCs/>");
                if (sizeHalfPt > 0) sb.Append("<w:sz w:val=\"").Append(sizeHalfPt).Append("\"/><w:szCs w:val=\"").Append(sizeHalfPt).Append("\"/>");
                if (underline) sb.Append("<w:u w:val=\"single\"/>");
                sb.Append("</w:rPr>");
            }
            sb.Append("<w:t xml:space=\"preserve\">").Append(Esc(text)).Append("</w:t></w:r>");
        }

        // ---------- 파트 XML ----------

        private const string Decl = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>";

        private static string ContentTypesXml() =>
            Decl +
            "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
            "<Default Extension=\"png\" ContentType=\"image/png\"/>" +
            "<Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>" +
            "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
            "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>" +
            "<Override PartName=\"/word/settings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml\"/>" +
            "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>" +
            "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>" +
            "</Types>";

        private static string RootRelsXml() =>
            Decl +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
            "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>" +
            "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>" +
            "</Relationships>";

        // 그림 rId 는 rIdImgN 으로 따로 두어 styles(rId1), settings(rId2)와 겹치지 않게 한다.
        private static string DocumentRelsXml(List<Media> media)
        {
            var sb = new StringBuilder(512);
            sb.Append(Decl);
            sb.Append("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
            sb.Append("<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>");
            sb.Append("<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings\" Target=\"settings.xml\"/>");
            foreach (var m in media)
                sb.Append("<Relationship Id=\"").Append(m.RelId)
                  .Append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/")
                  .Append(m.FileName).Append("\"/>");
            sb.Append("</Relationships>");
            return sb.ToString();
        }

        private static string CoreXml(Report r)
        {
            string now = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
            return Decl +
                "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" " +
                "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" " +
                "xmlns:dcmitype=\"http://purl.org/dc/dcmitype/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">" +
                "<dc:title>월간보고</dc:title>" +
                "<dc:creator>" + Esc(r.Name ?? "") + "</dc:creator>" +
                "<dcterms:created xsi:type=\"dcterms:W3CDTF\">" + now + "</dcterms:created>" +
                "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">" + now + "</dcterms:modified>" +
                "</cp:coreProperties>";
        }

        private static string AppXml() =>
            Decl +
            "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" " +
            "xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">" +
            "<Application>TaskCalendarWidget</Application>" +
            "</Properties>";

        // 기본 글꼴 맑은 고딕 10pt(네 글꼴 칸 모두), 문단 앞뒤 0, 줄 240 auto. 표 기본 서식은 셀 좌우 여백 108.
        // style 자식 순서: name, basedOn, next, uiPriority, semiHidden, unhideWhenUsed, qFormat, pPr, rPr, tblPr.
        private static string StylesXml()
        {
            string fonts = "<w:rFonts w:ascii=\"" + FontName + "\" w:eastAsia=\"" + FontName + "\" w:hAnsi=\"" + FontName + "\" w:cs=\"" + FontName + "\"/>";
            string rPr = "<w:rPr>" + fonts + "<w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/><w:lang w:val=\"en-US\" w:eastAsia=\"ko-KR\"/></w:rPr>";
            string pPr = "<w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr>";
            string cellMar = "<w:tblCellMar><w:top w:w=\"0\" w:type=\"dxa\"/><w:left w:w=\"108\" w:type=\"dxa\"/>" +
                             "<w:bottom w:w=\"0\" w:type=\"dxa\"/><w:right w:w=\"108\" w:type=\"dxa\"/></w:tblCellMar>";
            return Decl +
                "<w:styles xmlns:w=\"" + WordNs + "\">" +
                "<w:docDefaults><w:rPrDefault>" + rPr + "</w:rPrDefault><w:pPrDefault>" + pPr + "</w:pPrDefault></w:docDefaults>" +
                "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/>" + pPr + rPr + "</w:style>" +
                "<w:style w:type=\"table\" w:default=\"1\" w:styleId=\"TableNormal\"><w:name w:val=\"Normal Table\"/>" +
                "<w:uiPriority w:val=\"99\"/><w:semiHidden/><w:unhideWhenUsed/>" +
                "<w:tblPr><w:tblInd w:w=\"0\" w:type=\"dxa\"/>" + cellMar + "</w:tblPr></w:style>" +
                "<w:style w:type=\"table\" w:styleId=\"ReportTable\"><w:name w:val=\"Report Table\"/><w:basedOn w:val=\"TableNormal\"/>" +
                "<w:uiPriority w:val=\"59\"/>" + pPr + rPr +
                "<w:tblPr>" + BordersXml("w:tblBorders") + cellMar + "</w:tblPr></w:style>" +
                "</w:styles>";
        }

        // 최소 설정. compatibilityMode 15 = Word 2013 이후 배치 규칙(없으면 Word 가 호환 모드로 연다).
        private static string SettingsXml() =>
            Decl +
            "<w:settings xmlns:w=\"" + WordNs + "\">" +
            "<w:zoom w:percent=\"100\"/>" +
            "<w:defaultTabStop w:val=\"800\"/>" +
            "<w:characterSpacingControl w:val=\"doNotCompress\"/>" +
            "<w:compat><w:compatSetting w:name=\"compatibilityMode\" w:uri=\"http://schemas.microsoft.com/office/word\" w:val=\"15\"/></w:compat>" +
            "</w:settings>";

        // ---------- 값 변환 ----------

        /// XML 이스케이프 + XML 1.0 에서 표현 불가능한 문자 제거. 줄바꿈(\r, \n)은 공백으로 바꾼다
        /// (한 Line 은 한 문단이라 w:t 안에 개행이 있으면 안 된다. Word 는 그 개행을 공백처럼 보이게 하지만 한컴은 다르게 다룬다).
        /// DB/사용자 입력에 제어문자가 섞이면 파일이 통째로 안 열린다. 여기가 유일한 방어선이다.
        public static string Esc(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "";
            var sb = new StringBuilder(raw.Length + 16);
            for (int i = 0; i < raw.Length; i++)
            {
                char c = raw[i];
                switch (c)
                {
                    case '&': sb.Append("&amp;"); continue;
                    case '<': sb.Append("&lt;"); continue;
                    case '>': sb.Append("&gt;"); continue;
                    case '"': sb.Append("&quot;"); continue;
                    case '\'': sb.Append("&apos;"); continue;
                }
                if (c == '\t') { sb.Append(c); continue; }
                if (c == '\r' && i + 1 < raw.Length && raw[i + 1] == '\n') continue;   // \r\n 은 공백 하나로
                if (c == '\n' || c == '\r') { sb.Append(' '); continue; }
                if (c < 0x20) continue;                                  // 그 밖의 C0 제어문자 = XML 1.0 불법
                if (c == '\uFFFE' || c == '\uFFFF') continue;            // 비문자(XML 1.0 불법)
                if (char.IsHighSurrogate(c))
                {
                    // 짝이 맞는 서러게이트 쌍만 통과(고아 서러게이트는 인코딩 단계에서 깨진다)
                    if (i + 1 < raw.Length && char.IsLowSurrogate(raw[i + 1])) { sb.Append(c).Append(raw[i + 1]); i++; }
                    continue;
                }
                if (char.IsLowSurrogate(c)) continue;                    // 고아 low surrogate
                sb.Append(c);
            }
            return sb.ToString();
        }
    }
}
