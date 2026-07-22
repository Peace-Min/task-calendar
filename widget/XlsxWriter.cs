using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace TaskCalendarWidget
{
    // ============ 의존성 0 xlsx writer (템플릿 v2) ============
    // .xlsx = ZIP + XML 몇 개. 표 한 장(1시트) 때문에 ClosedXML/EPPlus/OpenXml SDK(수 MB)를 끌고 오지 않는다
    // (폐쇄망·경량 배포 원칙). System.IO.Compression은 인박스라 NuGet 추가가 없다.
    //
    // ★ 이 클래스는 앱 도메인을 모른다. '상태가 진행중이면 초록' 같은 지식은 여기 없다 —
    //   호출측이 Doc.Accents(힌트→색)와 Col(헤더·너비·정렬·줄바꿈·날짜여부)로 넘긴다.
    //   여기 있는 것은 '표 한 장을 장표답게 그리는 법'뿐이다.
    //
    // 고정 레이아웃(v2):
    //   1행 제목(A1:마지막열 병합) / 2행 부제(병합) / 3행 여백 / 4행 헤더 / 5행~ 데이터(짝수 데이터행 줄무늬)
    //   틀 고정 A5 · 자동필터 4행~ · 가로 1페이지 맞춤 · 4행 반복 인쇄 · 바닥글 페이지 번호
    //
    // Excel이 '복구' 대화상자를 띄우는 원인들을 다음 규칙으로 회피한다:
    //  · worksheet 자식 순서(스키마 강제):
    //    sheetPr → dimension → sheetViews → sheetFormatPr → cols → sheetData → autoFilter → mergeCells
    //    → printOptions → pageMargins → pageSetup → headerFooter
    //  · styles.xml의 fills는 0=none, 1=gray125가 반드시 먼저(그 뒤부터 커스텀)
    //  · fonts/fills/borders/cellXfs의 count = 실제 개수(StyleBook이 자동으로 맞춘다)
    //  · 커스텀 numFmtId는 164 이상(0~163 예약)
    //  · 커스텀 행 높이는 customHeight="1"이 없으면 무시된다
    //  · 병합해도 앵커 셀(A1/A2)은 반드시 기록
    //  · XML 이스케이프 + XML 1.0 불법 문자 제거(DB 값 방어)
    //  · [Content_Types].xml을 첫 ZIP 엔트리로, 경로 구분자는 '/', 디렉터리 엔트리 없음
    public static class XlsxWriter
    {
        public enum Align { Left, Center, Right }

        /// 컬럼 정의 — 표시 방법만 담는다(값의 의미는 호출측 몫).
        public sealed class Col
        {
            public string Header { get; }
            public double Width { get; }
            public Align Alignment { get; }
            public bool IsDate { get; }   // true면 'yyyy-MM-dd'로 파싱해 '진짜 날짜'(시리얼+numFmt)로 기록
            public bool Wrap { get; }     // 긴 문장 열(사업명·계약명)의 줄바꿈
            public Col(string header, double width, Align alignment = Align.Left, bool isDate = false, bool wrap = false)
            {
                Header = header ?? "";
                Width = width > 0 ? width : 12;
                Alignment = alignment;
                IsDate = isDate;
                Wrap = wrap;
            }
        }

        /// 한 행 = 컬럼 순서와 같은 문자열 배열. Hints는 셀별 선택적 스타일 키(Doc.Accents의 키).
        public sealed class Row
        {
            public string[] Cells { get; }
            public string?[]? Hints { get; set; }
            public Row(params string[] cells) { Cells = cells ?? Array.Empty<string>(); }
            public Row WithHint(int columnIndex, string? hint)
            {
                var h = Hints ??= new string?[Cells.Length];
                if (columnIndex >= 0 && columnIndex < h.Length) h[columnIndex] = hint;
                return this;
            }
        }

        /// 셀 강조색(배경/글자). 도메인 규칙(어떤 값이 어떤 색인지)은 호출측이 정한다.
        public sealed class Accent
        {
            public string FillArgb { get; }
            public string FontArgb { get; }
            public Accent(string fillArgb, string fontArgb) { FillArgb = fillArgb; FontArgb = fontArgb; }
        }

        /// 문서 수준 설정. 팔레트·행 높이는 기본값이 v2 사양이며 호출측이 바꿀 수 있다.
        public sealed class Doc
        {
            public string SheetName { get; set; } = "Sheet1";
            public string Title { get; set; } = "";
            public string Subtitle { get; set; } = "";
            /// 셀 힌트 → 강조색. 힌트가 여기 없으면 기본(줄무늬) 스타일로 떨어진다.
            public Dictionary<string, Accent> Accents { get; } = new Dictionary<string, Accent>(StringComparer.Ordinal);

            public string TitleFontArgb { get; set; } = "FF1F2937";
            public string SubtitleFontArgb { get; set; } = "FF6B7280";
            public string BodyFontArgb { get; set; } = "FF1F2937";
            public string HeaderFillArgb { get; set; } = "FF2F3B4E";
            public string HeaderFontArgb { get; set; } = "FFFFFFFF";
            public string StripeFillArgb { get; set; } = "FFF7F9FB";
            public string GridArgb { get; set; } = "FFD9DEE5";
            public string FontName { get; set; } = "맑은 고딕";

            public double TitleFontSize { get; set; } = 16;
            public double SubtitleFontSize { get; set; } = 9;
            public double BodyFontSize { get; set; } = 10;

            public double TitleRowHeight { get; set; } = 30;
            public double SubtitleRowHeight { get; set; } = 18;
            public double SpacerRowHeight { get; set; } = 6;
            public double HeaderRowHeight { get; set; } = 24;
            public double DataRowHeight { get; set; } = 20;   // 1줄짜리 데이터행의 높이(=기준 높이)

            /// 줄바꿈(Wrap) 열의 내용이 여러 줄이 될 때 행 높이를 늘린다. 끄면 전 행이 DataRowHeight 고정.
            /// (고정 높이 + wrapText 조합은 2줄 이상인 행에서 글자가 눌려 잘린다 — 실측 확인된 결함.)
            public bool AutoRowHeight { get; set; } = true;
            /// 줄이 하나 늘 때 더할 높이.
            public double WrapLineHeight { get; set; } = 15;
            /// 늘려 주는 상한(줄 수). 극단적으로 긴 값 하나가 표 전체를 망치지 않게 자른다.
            public int MaxWrapLines { get; set; } = 3;

            /// 바닥글(OOXML 코드 그대로). 기본 = 가운데 '현재쪽 / 전체쪽'.
            public string OddFooter { get; set; } = "&C&P / &N";
        }

        // 고정 레이아웃 행 번호 — Print_Titles·틀고정·자동필터가 전부 이 상수를 참조한다.
        public const int TitleRow = 1;
        public const int SubtitleRow = 2;
        public const int SpacerRow = 3;
        public const int HeaderRow = 4;
        public const int FirstDataRow = 5;

        private const int CustomNumFmtId = 164;   // 0~163은 예약 구간

        // 1900 날짜 체계의 시리얼 기준일(Excel의 1900년 윤년 버그를 흡수하는 관례적 기준).
        private static readonly DateTime SerialEpoch = new DateTime(1899, 12, 30);

        /// <summary>
        /// 시트 1개짜리 xlsx를 만든다(레이아웃은 위 상수 참조).
        /// 임시 파일에 먼저 쓰고 성공했을 때만 목적지로 옮긴다(실패 시 깨진 파일이 남지 않게).
        /// 대상 파일이 잠겨 있으면 IOException이 그대로 올라온다(호출측이 한국어 안내로 번역).
        /// </summary>
        public static void Write(string path, Doc doc, IReadOnlyList<Col> cols, IReadOnlyList<Row> rows)
        {
            if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("저장 경로가 비어 있습니다", nameof(path));
            if (doc == null) throw new ArgumentNullException(nameof(doc));
            if (cols == null || cols.Count == 0) throw new ArgumentException("컬럼 정의가 비어 있습니다", nameof(cols));
            rows ??= Array.Empty<Row>();

            string dir = Path.GetDirectoryName(Path.GetFullPath(path)) ?? ".";
            Directory.CreateDirectory(dir);
            // 임시 파일은 목적지와 같은 폴더에(=같은 볼륨) → File.Move가 원자적 교체에 가깝게 동작
            string tmp = Path.Combine(dir, "." + Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N") + ".tmp");

            // 스타일은 시트를 만들면서 채워지므로(조합 폭발 방지 캐시) 시트 XML을 먼저 만든다.
            var styles = new StyleBook(doc);
            string sheet = SheetXml(doc, cols, rows, styles);

            try
            {
                using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
                using (var zip = new ZipArchive(fs, ZipArchiveMode.Create, leaveOpen: false))
                {
                    // [Content_Types].xml은 반드시 첫 엔트리
                    AddEntry(zip, "[Content_Types].xml", ContentTypesXml());
                    AddEntry(zip, "_rels/.rels", RootRelsXml());
                    AddEntry(zip, "xl/workbook.xml", WorkbookXml(doc));
                    AddEntry(zip, "xl/_rels/workbook.xml.rels", WorkbookRelsXml());
                    AddEntry(zip, "xl/styles.xml", styles.ToXml());
                    AddEntry(zip, "xl/worksheets/sheet1.xml", sheet);
                }
                File.Move(tmp, path, true);   // 여기서 실패(파일 잠김 등)해도 목적지는 이전 상태 그대로
            }
            finally
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
            }
        }

        private static void AddEntry(ZipArchive zip, string name, string xml)
        {
            var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
            using var s = entry.Open();
            var bytes = new UTF8Encoding(false).GetBytes(xml);
            s.Write(bytes, 0, bytes.Length);
        }

        // ---------- 스타일 장부 ----------
        // (테두리 × 줄무늬 × 정렬 × 줄바꿈 × 날짜서식 × 강조색) 조합을 셀마다 만들면 cellXfs가 폭발한다.
        // 조각(font/fill/border)과 완성 xf를 각각 'XML 문자열'을 키로 인터닝해 인덱스를 재사용한다.
        private sealed class StyleBook
        {
            private readonly Doc _doc;
            private readonly List<string> _fonts = new List<string>();
            private readonly List<string> _fills = new List<string>();
            private readonly List<string> _borders = new List<string>();
            private readonly List<string> _xfs = new List<string>();
            private readonly Dictionary<string, int> _fontIx = new Dictionary<string, int>(StringComparer.Ordinal);
            private readonly Dictionary<string, int> _fillIx = new Dictionary<string, int>(StringComparer.Ordinal);
            private readonly Dictionary<string, int> _borderIx = new Dictionary<string, int>(StringComparer.Ordinal);
            private readonly Dictionary<string, int> _xfIx = new Dictionary<string, int>(StringComparer.Ordinal);

            public readonly int NoFill;      // = 0
            public readonly int NoBorder;    // = 0
            public readonly int BodyFont;
            public readonly int GridBorder;
            public readonly int StripeFill;

            public StyleBook(Doc doc)
            {
                _doc = doc;
                // ★ 순서 고정 — Excel 하드 요구: fills[0]=none, fills[1]=gray125
                NoFill = Intern(_fills, _fillIx, "<fill><patternFill patternType=\"none\"/></fill>");
                Intern(_fills, _fillIx, "<fill><patternFill patternType=\"gray125\"/></fill>");
                NoBorder = Intern(_borders, _borderIx, "<border><left/><right/><top/><bottom/><diagonal/></border>");
                BodyFont = Font(doc.BodyFontSize, false, doc.BodyFontArgb);   // fonts[0]
                // cellXfs[0] = 기본 스타일(어떤 셀도 참조하지 않더라도 존재해야 안전)
                Intern(_xfs, _xfIx, "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>");
                GridBorder = ThinBorder(doc.GridArgb);
                StripeFill = SolidFill(doc.StripeFillArgb);
            }

            private static int Intern(List<string> list, Dictionary<string, int> index, string xml)
            {
                if (index.TryGetValue(xml, out int i)) return i;
                i = list.Count;
                list.Add(xml);
                index[xml] = i;
                return i;
            }

            public int Font(double size, bool bold, string argb) => Intern(_fonts, _fontIx,
                "<font>" + (bold ? "<b/>" : "") +
                "<sz val=\"" + Num(size) + "\"/><color rgb=\"" + Esc(argb) + "\"/>" +
                "<name val=\"" + Esc(_doc.FontName) + "\"/><family val=\"2\"/><charset val=\"129\"/></font>");

            public int SolidFill(string argb) => Intern(_fills, _fillIx,
                "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"" + Esc(argb) + "\"/><bgColor indexed=\"64\"/></patternFill></fill>");

            public int ThinBorder(string argb)
            {
                string Side(string tag) => "<" + tag + " style=\"thin\"><color rgb=\"" + Esc(argb) + "\"/></" + tag + ">";
                return Intern(_borders, _borderIx,
                    "<border>" + Side("left") + Side("right") + Side("top") + Side("bottom") + "<diagonal/></border>");
            }

            /// 완성 xf 인덱스. 같은 조합은 한 번만 만들어진다.
            public int Xf(int font, int fill, int border, bool date, Align align, bool wrap)
            {
                string h = align == Align.Center ? "center" : align == Align.Right ? "right" : "left";
                var sb = new StringBuilder(240);
                sb.Append("<xf numFmtId=\"").Append(date ? CustomNumFmtId : 0)
                  .Append("\" fontId=\"").Append(font)
                  .Append("\" fillId=\"").Append(fill)
                  .Append("\" borderId=\"").Append(border)
                  .Append("\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"");
                if (date) sb.Append(" applyNumberFormat=\"1\"");
                sb.Append("><alignment horizontal=\"").Append(h).Append("\" vertical=\"center\"");
                if (wrap) sb.Append(" wrapText=\"1\"");
                sb.Append("/></xf>");
                return Intern(_xfs, _xfIx, sb.ToString());
            }

            public string ToXml()
            {
                var sb = new StringBuilder(2048);
                sb.Append(Decl);
                sb.Append("<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");
                sb.Append("<numFmts count=\"1\"><numFmt numFmtId=\"").Append(CustomNumFmtId)
                  .Append("\" formatCode=\"yyyy\\-mm\\-dd\"/></numFmts>");
                Emit(sb, "fonts", _fonts);
                Emit(sb, "fills", _fills);
                Emit(sb, "borders", _borders);
                sb.Append("<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>");
                Emit(sb, "cellXfs", _xfs);
                sb.Append("<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>");
                sb.Append("</styleSheet>");
                return sb.ToString();
            }

            // count 속성은 언제나 실제 개수 — 손으로 세지 않는다(어긋나면 Excel이 파일을 복구 대상으로 본다).
            private static void Emit(StringBuilder sb, string tag, List<string> items)
            {
                sb.Append('<').Append(tag).Append(" count=\"").Append(items.Count).Append("\">");
                foreach (var x in items) sb.Append(x);
                sb.Append("</").Append(tag).Append('>');
            }
        }

        // ---------- 파트 XML ----------

        private const string Decl = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>";

        private static string ContentTypesXml() =>
            Decl +
            "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
            "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
            "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
            "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>" +
            "</Types>";

        private static string RootRelsXml() =>
            Decl +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
            "</Relationships>";

        // definedNames는 sheets '뒤'에 와야 한다(CT_Workbook 순서). Print_Titles = 헤더행 반복 인쇄.
        private static string WorkbookXml(Doc doc)
        {
            string sheetName = SafeSheetName(doc.SheetName);
            string quoted = "'" + sheetName.Replace("'", "''") + "'";   // 공백·특수문자 대비해 항상 인용
            return Decl +
                "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" " +
                "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
                "<sheets><sheet name=\"" + Esc(sheetName) + "\" sheetId=\"1\" r:id=\"rId1\"/></sheets>" +
                "<definedNames><definedName name=\"_xlnm.Print_Titles\" localSheetId=\"0\">" +
                Esc(quoted) + "!$" + HeaderRow + ":$" + HeaderRow +
                "</definedName></definedNames>" +
                "</workbook>";
        }

        private static string WorkbookRelsXml() =>
            Decl +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
            "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
            "</Relationships>";

        private static string SheetXml(Doc doc, IReadOnlyList<Col> cols, IReadOnlyList<Row> rows, StyleBook st)
        {
            int lastCol = cols.Count;
            string lastColRef = ColName(lastCol);
            int lastRow = HeaderRow + rows.Count;   // 데이터가 0건이면 헤더행이 마지막

            // 고정 스타일
            int sTitle = st.Xf(st.Font(doc.TitleFontSize, true, doc.TitleFontArgb), st.NoFill, st.NoBorder, false, Align.Left, false);
            int sSub = st.Xf(st.Font(doc.SubtitleFontSize, false, doc.SubtitleFontArgb), st.NoFill, st.NoBorder, false, Align.Left, false);
            int sHeader = st.Xf(st.Font(doc.BodyFontSize, true, doc.HeaderFontArgb), st.SolidFill(doc.HeaderFillArgb),
                                st.GridBorder, false, Align.Center, false);

            // 데이터 셀 스타일 캐시 — 키: 열|줄무늬|힌트
            var cache = new Dictionary<string, int>(StringComparer.Ordinal);
            int DataStyle(int ci, bool stripe, string? hint)
            {
                string key = ci + "|" + (stripe ? "1" : "0") + "|" + (hint ?? "");
                if (cache.TryGetValue(key, out int v)) return v;
                var c = cols[ci];
                int font = st.BodyFont;
                int fill = stripe ? st.StripeFill : st.NoFill;
                if (!string.IsNullOrEmpty(hint) && doc.Accents.TryGetValue(hint!, out var acc))
                {
                    font = st.Font(doc.BodyFontSize, false, acc.FontArgb);
                    fill = st.SolidFill(acc.FillArgb);
                }
                v = st.Xf(font, fill, st.GridBorder, c.IsDate, c.Alignment, c.Wrap);
                cache[key] = v;
                return v;
            }

            var sb = new StringBuilder(8192 + rows.Count * 512);
            sb.Append(Decl);
            sb.Append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");

            // ★ 자식 순서 고정(스키마 강제)
            sb.Append("<sheetPr><pageSetUpPr fitToPage=\"1\"/></sheetPr>");
            sb.Append("<dimension ref=\"A1:").Append(lastColRef).Append(lastRow).Append("\"/>");
            sb.Append("<sheetViews><sheetView tabSelected=\"1\" workbookViewId=\"0\">")
              .Append("<pane ySplit=\"").Append(HeaderRow).Append("\" topLeftCell=\"A").Append(FirstDataRow)
              .Append("\" activePane=\"bottomLeft\" state=\"frozen\"/>")
              .Append("<selection pane=\"bottomLeft\" activeCell=\"A").Append(FirstDataRow)
              .Append("\" sqref=\"A").Append(FirstDataRow).Append("\"/>")
              .Append("</sheetView></sheetViews>");
            sb.Append("<sheetFormatPr defaultRowHeight=\"15\"/>");

            sb.Append("<cols>");
            for (int i = 0; i < cols.Count; i++)
                sb.Append("<col min=\"").Append(i + 1).Append("\" max=\"").Append(i + 1)
                  .Append("\" width=\"").Append(Num(cols[i].Width)).Append("\" customWidth=\"1\"/>");
            sb.Append("</cols>");

            sb.Append("<sheetData>");

            // 1행 제목 — 병합해도 앵커 셀은 반드시 기록한다(없으면 값이 사라진다)
            OpenRow(sb, TitleRow, doc.TitleRowHeight);
            AppendTextCell(sb, "A" + TitleRow, doc.Title ?? "", sTitle);
            sb.Append("</row>");

            // 2행 부제 — '언제 / 전체 몇 건 중 몇 건 / 어떤 필터 / 숨김 제외'가 파일에 남는 자리
            OpenRow(sb, SubtitleRow, doc.SubtitleRowHeight);
            AppendTextCell(sb, "A" + SubtitleRow, doc.Subtitle ?? "", sSub);
            sb.Append("</row>");

            // 3행 여백(셀 없음)
            sb.Append("<row r=\"").Append(SpacerRow).Append("\" ht=\"").Append(Num(doc.SpacerRowHeight))
              .Append("\" customHeight=\"1\"/>");

            // 4행 헤더
            OpenRow(sb, HeaderRow, doc.HeaderRowHeight);
            for (int i = 0; i < cols.Count; i++)
                AppendTextCell(sb, ColName(i + 1) + HeaderRow, cols[i].Header, sHeader);
            sb.Append("</row>");

            // 5행~ 데이터. 값이 비어도 셀은 반드시 쓴다 — 생략하면 그 칸만 테두리·줄무늬가 빠져 표가 깨져 보인다.
            for (int r = 0; r < rows.Count; r++)
            {
                int rowNum = FirstDataRow + r;
                bool stripe = (r % 2) == 1;   // 짝수번째 데이터행(2,4,6…)에 줄무늬
                var cells = rows[r].Cells;
                // 줄바꿈 열이 2줄 이상이면 그만큼 행을 키운다(고정 높이면 눌려 잘린다).
                OpenRow(sb, rowNum, DataRowHeightFor(doc, cols, cells));
                var hints = rows[r].Hints;
                for (int i = 0; i < cols.Count; i++)
                {
                    string raw = (cells != null && i < cells.Length) ? (cells[i] ?? "") : "";
                    string? hint = (hints != null && i < hints.Length) ? hints[i] : null;
                    string reference = ColName(i + 1) + rowNum;
                    int style = DataStyle(i, stripe, hint);
                    if (cols[i].IsDate)
                    {
                        int? serial = DateSerial(raw);
                        if (serial.HasValue)
                            sb.Append("<c r=\"").Append(reference).Append("\" s=\"").Append(style)
                              .Append("\"><v>").Append(serial.Value.ToString(CultureInfo.InvariantCulture)).Append("</v></c>");
                        else
                            AppendBlankCell(sb, reference, style);   // 파싱 실패/빈값 → 빈 셀(날짜열엔 문자열을 섞지 않는다)
                    }
                    else if (raw.Length > 0) AppendTextCell(sb, reference, raw, style);
                    else AppendBlankCell(sb, reference, style);      // "-" 같은 자리표시자 금지(필터·정렬이 지저분해진다)
                }
                sb.Append("</row>");
            }
            sb.Append("</sheetData>");

            // autoFilter는 sheetData 뒤, mergeCells는 그 뒤 — 순서를 바꾸면 Excel이 복구 대화상자를 띄운다.
            sb.Append("<autoFilter ref=\"A").Append(HeaderRow).Append(':').Append(lastColRef).Append(lastRow).Append("\"/>");
            sb.Append("<mergeCells count=\"2\">")
              .Append("<mergeCell ref=\"A").Append(TitleRow).Append(':').Append(lastColRef).Append(TitleRow).Append("\"/>")
              .Append("<mergeCell ref=\"A").Append(SubtitleRow).Append(':').Append(lastColRef).Append(SubtitleRow).Append("\"/>")
              .Append("</mergeCells>");

            // 인쇄 — 장표 품질의 실제 차이. 가로 + 너비 1페이지 맞춤 + 좁은 여백 + 페이지 번호.
            sb.Append("<pageMargins left=\"0.3\" right=\"0.3\" top=\"0.4\" bottom=\"0.4\" header=\"0.2\" footer=\"0.2\"/>");
            sb.Append("<pageSetup paperSize=\"9\" orientation=\"landscape\" fitToWidth=\"1\" fitToHeight=\"0\"/>");
            if (!string.IsNullOrEmpty(doc.OddFooter))
                sb.Append("<headerFooter><oddFooter>").Append(Esc(doc.OddFooter)).Append("</oddFooter></headerFooter>");

            sb.Append("</worksheet>");
            return sb.ToString();
        }

        // 커스텀 높이는 customHeight="1"이 없으면 Excel이 무시한다.
        private static void OpenRow(StringBuilder sb, int rowNum, double height) =>
            sb.Append("<row r=\"").Append(rowNum).Append("\" ht=\"").Append(Num(height)).Append("\" customHeight=\"1\">");

        // sharedStrings 파트 없이 인라인 문자열로 기록(파트 하나 절약 · 구조 단순).
        private static void AppendTextCell(StringBuilder sb, string reference, string text, int style)
        {
            sb.Append("<c r=\"").Append(reference).Append("\" s=\"").Append(style).Append("\" t=\"inlineStr\">")
              .Append("<is><t xml:space=\"preserve\">").Append(Esc(text)).Append("</t></is></c>");
        }

        // 값 없는 셀 — 서식(테두리·줄무늬)만 유지. 문자열 "-"를 넣지 않는다.
        private static void AppendBlankCell(StringBuilder sb, string reference, int style) =>
            sb.Append("<c r=\"").Append(reference).Append("\" s=\"").Append(style).Append("\"/>");

        // ---------- 행 높이 자동 계산 ----------
        // ★ 이것은 '추정'이지 정밀 측정이 아니다. 폰트 메트릭(글리프 advance) 없이 문자 폭만으로 줄 수를 어림한다.
        //   목표는 "대부분의 행이 안 잘린다"이지 픽셀 정확도가 아니다. 상한(MaxWrapLines)에 걸린 행은 그냥 잘린다.
        //
        // 엑셀의 열 너비 단위는 '기본 글꼴의 숫자 0 한 글자 폭'이다. 한글·CJK·전각 문자는 그 약 2배를 먹으므로
        // 문자 폭을 (CJK=2, 그 외=1)로 세어 '표시폭'을 구한다 → 표시폭 1 ≈ 열 너비 1칸으로 단위가 이미 같다.
        // 그래서 계수는 원래 1 근처여야 하는데, 실제로는 그보다 조금 크다. 이유(추정) 둘:
        //   · 본문 글꼴이 10pt인데 열 너비 기준은 11pt 표준 글꼴이라 같은 칸에 글자가 더 들어간다(≈1.1배)
        //   · 맑은 고딕의 한글 글리프 advance가 '0' 두 글자 폭보다 조금 좁다
        //
        // ★ 그래서 계수는 이론값이 아니라 '렌더 실측에 맞춘 값'이다. LibreOffice로 뽑은 샘플 18개 셀의
        //   실제 줄 수와 (표시폭 / 열 너비) 비를 대조하면 허용 구간이 이렇게 좁혀진다:
        //     · 2줄로 접힌 것 중 가장 작은 비 = 1.50  (열 너비 34 / 표시폭 51)  ⇒ 계수 < 1.50
        //     · 1줄로 남은 것 중 가장 큰 비   = 1.20  (열 너비 40 / 표시폭 48)  ⇒ 계수 ≥ 1.20
        //   그 가운데인 1.35를 쓰면 관측된 18개 셀의 줄 수가 전부 맞는다.
        //   (초기 설계안의 1.9는 'CJK는 2칸'을 표시폭과 계수 양쪽에서 두 번 세는 값이라, 실제로 잘렸던 행을
        //    1줄로 계산해 결함이 그대로 재현됐다. 반대로 1.0 이하는 짧은 행까지 2줄로 부풀린다.)
        //
        // 다시 강조: 이건 추정이지 폰트 메트릭 측정이 아니다. 다른 글꼴·크기·열 너비에서는 어긋날 수 있다.
        // 어긋날 때 안전한 방향은 '과대 추정'이다 — 행이 조금 높아질 뿐이지만, 과소 추정은 글자가 잘린다.
        public const double WrapCharsPerWidthUnit = 1.35;

        /// 문자열의 '표시폭' — CJK·전각·이모지는 2, 그 외는 1.
        public static int DisplayWidth(string text)
        {
            if (string.IsNullOrEmpty(text)) return 0;
            int w = 0;
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if (char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))
                {
                    int cp = char.ConvertToUtf32(c, text[i + 1]);
                    i++;
                    w += IsWideCodePoint(cp) ? 2 : 1;
                    continue;
                }
                w += IsWide(c) ? 2 : 1;
            }
            return w;
        }

        // 전각 판정 구간(BMP). 한글 자모·한글 음절·한중일 통합한자·가나·전각 영숫자 등.
        private static bool IsWide(char c) =>
            (c >= '\u1100' && c <= '\u115F') ||
            (c >= '\u2E80' && c <= '\u303E') ||
            (c >= '\u3041' && c <= '\u33FF') ||
            (c >= '\u3400' && c <= '\u4DBF') ||
            (c >= '\u4E00' && c <= '\u9FFF') ||
            (c >= '\uA000' && c <= '\uA4CF') ||
            (c >= '\uAC00' && c <= '\uD7A3') ||
            (c >= '\uF900' && c <= '\uFAFF') ||
            (c >= '\uFE30' && c <= '\uFE6F') ||
            (c >= '\uFF00' && c <= '\uFF60') ||
            (c >= '\uFFE0' && c <= '\uFFE6');

        // 보충 평면(서러게이트 쌍) — 이모지와 CJK 확장.
        private static bool IsWideCodePoint(int cp) =>
            (cp >= 0x1F300 && cp <= 0x1FAFF) ||
            (cp >= 0x20000 && cp <= 0x3FFFD);

        /// 열 너비 안에서 이 텍스트가 몇 줄이 될지 추정(최소 1, 최대 maxLines).
        /// 문자열 안의 개행(\n)은 강제 줄바꿈으로 센다.
        public static int EstimateWrapLines(string text, double colWidth, int maxLines)
        {
            if (maxLines < 1) maxLines = 1;
            if (string.IsNullOrEmpty(text)) return 1;
            double perLine = colWidth * WrapCharsPerWidthUnit;
            if (perLine < 1) perLine = 1;
            int total = 0;
            foreach (var seg in text.Split('\n'))
            {
                int w = DisplayWidth(seg.TrimEnd('\r'));
                int n = (int)Math.Ceiling(w / perLine);
                total += n < 1 ? 1 : n;
                if (total >= maxLines) return maxLines;
            }
            return total < 1 ? 1 : total;
        }

        /// 데이터 행 하나의 높이 — Wrap 열들 중 가장 많은 줄 수를 기준으로 늘린다.
        /// Wrap=false 열은 어차피 한 줄로 잘려 보이므로 높이에 영향을 주지 않는다.
        public static double DataRowHeightFor(Doc doc, IReadOnlyList<Col> cols, string[] cells)
        {
            if (doc == null) return 20;
            if (!doc.AutoRowHeight || cols == null) return doc.DataRowHeight;
            int lines = 1;
            for (int i = 0; i < cols.Count; i++)
            {
                if (!cols[i].Wrap) continue;
                string raw = (cells != null && i < cells.Length) ? (cells[i] ?? "") : "";
                int n = EstimateWrapLines(raw, cols[i].Width, doc.MaxWrapLines);
                if (n > lines) lines = n;
            }
            return doc.DataRowHeight + (lines - 1) * doc.WrapLineHeight;
        }

        // ---------- 값 변환 ----------

        private static string Num(double v) => v.ToString("0.##", CultureInfo.InvariantCulture);

        /// 'YYYY-MM-DD'(뒤에 시각이 붙어도 앞 10자만) → Excel 시리얼. 실패하면 null.
        public static int? DateSerial(string raw)
        {
            string s = (raw ?? "").Trim();
            if (s.Length < 10) return null;
            string head = s.Substring(0, 10);
            if (!DateTime.TryParseExact(head, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
                return null;
            int serial = (int)(d.Date - SerialEpoch).TotalDays;
            return serial > 0 ? serial : (int?)null;   // 1900-01-01 미만은 Excel 날짜로 표현 불가
        }

        /// 1→A, 26→Z, 27→AA …
        public static string ColName(int index1)
        {
            if (index1 < 1) index1 = 1;
            var sb = new StringBuilder(3);
            while (index1 > 0)
            {
                int rem = (index1 - 1) % 26;
                sb.Insert(0, (char)('A' + rem));
                index1 = (index1 - 1) / 26;
            }
            return sb.ToString();
        }

        /// 시트 이름 제약: 금지문자 제거 + 31자 이하 + 빈 이름 금지.
        public static string SafeSheetName(string name)
        {
            string s = (name ?? "").Trim();
            foreach (char bad in new[] { '\\', '/', '?', '*', '[', ']', ':' }) s = s.Replace(bad, ' ');
            s = s.Trim();
            if (s.Length == 0) s = "Sheet1";
            if (s.Length > 31) s = s.Substring(0, 31);
            return s;
        }

        /// XML 이스케이프 + XML 1.0에서 표현 불가능한 문자 제거.
        /// (DB/사용자 입력에 제어문자가 섞이면 파일이 통째로 안 열린다 — 여기가 유일한 방어선이다.)
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
                if (c == '\t' || c == '\n' || c == '\r') { sb.Append(c); continue; }
                if (c < 0x20) continue;                                  // 그 밖의 C0 제어문자 = XML 1.0 불법
                if (c == '\uFFFE' || c == '\uFFFF') continue;            // 비문자(XML 1.0 불법)
                if (char.IsHighSurrogate(c))
                {
                    // 짝이 맞는 서러게이트 쌍만 통과(고아 서러게이트는 인코딩 단계에서 '?'가 되거나 깨진다)
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
