// 월간보고 DOCX 생성기(widget/DocxWriter.cs) 정적 계약.
// 파일 바이트 자체는 tests/loop-monthly-docx.mjs 가 dotnet 으로 만들어 검사한다(기본 실행 밖).
// 여기서는 빌드 없이 소스 모양만 못박는다:
//  (1) 의존성 0: WPF, System.Drawing, OpenXml SDK 를 쓰지 않고 ZipArchive 로 쓴다(목업 콘솔에서도 컴파일돼야 한다).
//  (2) 글자 출력 통로가 하나: w:t 를 쓰는 곳은 런 헬퍼 한 곳뿐이고, 그 글자는 반드시 Esc 를 거친다.
//      통로가 둘이 되면 한쪽만 이스케이프를 빠뜨려도 이 시험이 모른다. 그래서 '하나'를 센다.
//  (3) 패키지: 목업 csproj 는 PackageReference 가 없고, 위젯 csproj 는 WebView2 와 MySqlConnector 뿐이다.
// 아래 변이 시험이 (2)의 검사가 실제로 잡는다는 것을 증명한다.
import { test, assert, readText, listCsMembers, stripCsComments } from './harness.mjs';

const WRITER_PATH = new URL('../widget/DocxWriter.cs', import.meta.url);
const MOCK_CSPROJ = new URL('./tools/monthly-docx-mock/monthly-docx-mock.csproj', import.meta.url);
const WIDGET_CSPROJ = new URL('../widget/TaskCalendarWidget.csproj', import.meta.url);

const writer = readText(WRITER_PATH);
const mockCsproj = readText(MOCK_CSPROJ);
const widgetCsproj = readText(WIDGET_CSPROJ);

// w:t 여는 태그(<w:tbl, <w:tc, <w:tr 와 구별: 바로 뒤가 공백, '>' 또는 '/')
const WT_OPEN = /<w:t[\s>/]/g;

// ── 검사 함수(변이 시험이 같은 함수에 변이본을 넣는다) ────────────────
const check = {
  noForbiddenDeps(src) {
    const code = stripCsComments(src);
    const hit = /System\.Windows|System\.Drawing|DocumentFormat/.exec(code);
    if (hit) throw new Error(`DocxWriter 가 '${hit[0]}' 를 쓴다. 콘솔 목업(net9.0)에서 컴파일되지 않거나 외부 패키지가 필요하다`);
  },
  usesZipArchive(src) {
    const code = stripCsComments(src);
    if (!/new ZipArchive\(/.test(code)) throw new Error('DocxWriter 가 ZipArchive 로 쓰지 않는다');
  },
  // w:t 를 내보내는 멤버가 정확히 하나이고, 그 멤버가 글자를 Esc 로 감싸 넣는다.
  singleEscapedRunWriter(src) {
    const code = stripCsComments(src);
    const total = (code.match(WT_OPEN) || []).length;
    if (total !== 1) throw new Error(`w:t 여는 태그를 쓰는 자리가 ${total}곳이다(1곳이어야 한다). 글자 통로가 늘면 이스케이프가 빠져도 모른다`);
    const owners = listCsMembers(src).filter((m) => { WT_OPEN.lastIndex = 0; return WT_OPEN.test(m.body); });
    WT_OPEN.lastIndex = 0;
    if (owners.length !== 1) throw new Error(`w:t 를 쓰는 멤버가 ${owners.length}개다: ${owners.map((m) => m.name).join(', ')}`);
    const body = owners[0].body;
    const shape = /"<w:t xml:space=\\"preserve\\">"\)\s*\.Append\(\s*Esc\(\s*\w+\s*\)\s*\)\s*\.Append\(\s*"<\/w:t>/;
    if (!shape.test(body)) throw new Error(`런 헬퍼(${owners[0].name})가 w:t 안의 글자를 Esc(...) 로 감싸지 않는다`);
    return owners[0].name;
  },
  escapeIsReal(src) {
    const esc = listCsMembers(src).find((m) => m.name === 'Esc');
    if (!esc) throw new Error('Esc 멤버가 없다');
    for (const need of ['&amp;', '&lt;', '&gt;', '&quot;']) {
      if (!esc.body.includes(need)) throw new Error(`Esc 가 ${need} 를 만들지 않는다`);
    }
    if (!/c < 0x20/.test(esc.body)) throw new Error('Esc 가 XML 1.0 불법 제어 문자를 걸러 내지 않는다');
  },
  csprojHasNoPackages(xml) {
    if (/<PackageReference\b/.test(xml)) throw new Error('목업 csproj 에 PackageReference 가 있다(폐쇄망은 NuGet 을 못 받는다)');
  },
  widgetPackagesUnchanged(xml) {
    const names = Array.from(xml.matchAll(/<PackageReference\s+Include="([^"]+)"/g), (m) => m[1]).sort();
    const want = ['Microsoft.Web.WebView2', 'MySqlConnector'];
    if (JSON.stringify(names) !== JSON.stringify(want)) {
      throw new Error(`위젯 PackageReference 가 바뀌었다: [${names.join(', ')}] (기대 [${want.join(', ')}])`);
    }
  },
};

// ── 계약 ───────────────────────────────────────────────────────────
test('월간 DOCX: DocxWriter 는 WPF, System.Drawing, OpenXml SDK 를 쓰지 않는다', () => check.noForbiddenDeps(writer));
test('월간 DOCX: DocxWriter 는 ZipArchive 로 직접 쓴다', () => check.usesZipArchive(writer));
test('월간 DOCX: w:t 를 쓰는 곳은 런 헬퍼 하나뿐이고 글자는 Esc 를 거친다', () => {
  assert.strictEqual(check.singleEscapedRunWriter(writer), 'AppendRun');
});
test('월간 DOCX: Esc 는 & < > " 를 바꾸고 제어 문자를 걸러 낸다', () => check.escapeIsReal(writer));
test('월간 DOCX: 제목 구분 기호는 양식 원본 글자(U+2013)를 이스케이프로 적는다(소스에 날 글자 없음)', () => {
  assert.ok(writer.includes(') \\u2013 "'), '제목 구분 기호가 "\\u2013" 이스케이프로 적혀 있지 않다');
  assert.ok(!writer.includes('\u2013'), 'U+2013 날 글자가 소스에 있다(이스케이프로 적는다)');
  assert.ok(!writer.includes('\u2014'), 'U+2014 가 소스에 있다(표기 규칙)');
});
test('월간 DOCX: 목업 csproj 는 PackageReference 가 없고 DocxWriter.cs 를 링크한다', () => {
  check.csprojHasNoPackages(mockCsproj);
  assert.ok(/<Compile Include="..\\..\\..\\widget\\DocxWriter.cs" Link="DocxWriter.cs" \/>/.test(mockCsproj),
    '목업 csproj 가 widget/DocxWriter.cs 를 링크하지 않는다(사본을 두면 위젯과 갈린다)');
});
test('월간 DOCX: 위젯 csproj 의 PackageReference 는 WebView2 와 MySqlConnector 뿐이다', () => check.widgetPackagesUnchanged(widgetCsproj));

// ══════════════════════════════════════════════════════════════════════
// 변이 주입: 위 검사가 실효성이 있는지 증명한다(안 잡으면 그 검사는 장식이다).
// 앵커가 소스에서 안 찾히면 여기서 실패한다. 조용히 통과하지 않는다.
// ══════════════════════════════════════════════════════════════════════
function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

test('변이D1: 런 헬퍼에서 Esc 를 빼면 단일 통로 검사가 실패한다', () => {
  const bad = mutate(writer, '.Append(Esc(text)).Append("</w:t></w:r>")', '.Append(text).Append("</w:t></w:r>")');
  assert.throws(() => check.singleEscapedRunWriter(bad), /Esc\(\.\.\.\) 로 감싸지 않는다/);
});

test('변이D2: 이스케이프 없는 두 번째 w:t 통로를 만들면 단일 통로 검사가 실패한다', () => {
  const RAW_RUN = [
    '        private static void AppendRawRun(StringBuilder sb, string text) =>',
    '            sb.Append("<w:r><w:t>").Append(text).Append("</w:t></w:r>");',
    '',
    '        private static void AppendEmptyPara(StringBuilder sb)',
  ].join('\n');
  const bad = mutate(writer, '        private static void AppendEmptyPara(StringBuilder sb)', RAW_RUN);
  assert.throws(() => check.singleEscapedRunWriter(bad), /2곳이다/);
});

test('변이D3: Esc 가 & 를 바꾸지 않으면 이스케이프 검사가 실패한다', () => {
  const bad = mutate(writer, `case '&': sb.Append("&amp;"); continue;`, `case '&': sb.Append("&"); continue;`);
  assert.throws(() => check.escapeIsReal(bad), /&amp;/);
});

test('변이D4: using System.Windows.Media 를 넣으면 의존성 검사가 실패한다', () => {
  const bad = mutate(writer, 'using System.Text;', 'using System.Text;\nusing System.Windows.Media;');
  assert.throws(() => check.noForbiddenDeps(bad), /System\.Windows/);
});

test('변이D5: 목업 csproj 에 패키지를 넣거나 위젯 패키지를 늘리면 실패한다', () => {
  const badMock = mutate(mockCsproj, '  <ItemGroup>', '  <ItemGroup>\n    <PackageReference Include="DocumentFormat.OpenXml" Version="3.0.0" />');
  assert.throws(() => check.csprojHasNoPackages(badMock), /PackageReference/);
  const badWidget = mutate(widgetCsproj, '<PackageReference Include="MySqlConnector" Version="2.3.7" />',
    '<PackageReference Include="MySqlConnector" Version="2.3.7" />\n    <PackageReference Include="DocumentFormat.OpenXml" Version="3.0.0" />');
  assert.throws(() => check.widgetPackagesUnchanged(badWidget), /바뀌었다/);
});

// ══════════════════════════════════════════════════════════════════════
// 호스트 저장 명령 exportMonthlyDocx(widget/MonthlyReportExport.cs, docs/MONTHLY-REPORT-PLAN.md §7.4)
//  (4) 모양은 RunProjectsXlsxExport 와 같다: 요청한 창이 주인인 SaveFileDialog, Task.Run 으로 쓰기, ReplyOnUi 회신.
//      회신은 { ok, path, dir } | { ok:false, cancelled:true } | { ok:false, error }.
//  (5) 기본 파일 이름 월간보고_<이름>_<YYMMDD>.docx, 지난번 폴더 기억.
//  (6) payload 에 그림 바이트가 없다. 그림은 호스트가 과제 uid 로 PC 사본이나 DB 에서 넣는다(ScheduleImageDb).
//  (7) 회사 사이트로 보내는 길(Platform.report, netcus 제출)을 부르지 않는다.
// ══════════════════════════════════════════════════════════════════════
const EXPORT_PATH = new URL('../widget/MonthlyReportExport.cs', import.meta.url);
const MAIN_PATH = new URL('../widget/MainWindow.xaml.cs', import.meta.url);
const exportCs = readText(EXPORT_PATH);
const mainCs = readText(MAIN_PATH);

function csMemberBody(src, nameRe) {
  const m = listCsMembers(src).find((x) => nameRe.test(x.name));
  if (!m) throw new Error(`멤버를 찾지 못했다: ${nameRe}`);
  return m.body;
}

const host = {
  saveFlow(src) {
    const body = csMemberBody(src, /^RunMonthlyDocxExport$/);
    const iDlg = body.indexOf('new Microsoft.Win32.SaveFileDialog');
    const iShow = body.indexOf('dlg.ShowDialog(owner)');
    const iRun = body.indexOf('Task.Run(');
    const writes = [...body.matchAll(/DocxWriter\.Write\(/g)].map((m) => m.index);
    if (iDlg < 0 || iShow < 0) throw new Error('저장 창(SaveFileDialog)을 요청한 창(owner)이 주인으로 띄우지 않는다');
    if (!(iRun > iShow && writes.length === 1 && writes[0] > iRun)) throw new Error('문서 쓰기가 저장 창 뒤의 Task.Run 안에서 돌지 않는다(UI 스레드를 막는다)');
    if (!/ReplyOnUi\(reqId, new \{ ok = false, cancelled = true \}\)/.test(body)) throw new Error('취소 회신이 { ok:false, cancelled:true } 가 아니다');
    if (!/ok = true, path = target, dir = Path\.GetDirectoryName\(target\)/.test(body)) throw new Error('성공 회신에 ok, path, dir 이 없다');
    if (!/catch \(IOException\)/.test(body) || !/파일이 열려 있어 저장할 수 없습니다/.test(body)) throw new Error('파일이 열려 있을 때 이유를 말하지 않는다');
    if (!/ImagesForExportAsync\(p\.ProjectUids\(\)\)/.test(body)) throw new Error('그림을 과제 uid 로 호스트가 찾아 넣지 않는다');
  },
  fileNameAndFolder(src) {
    const fn = csMemberBody(src, /^MonthlyDefaultFileName$/);
    if (!/"월간보고_" \+ who \+ "_" \+ reportDate\.ToString\("yyMMdd", CultureInfo\.InvariantCulture\)/.test(fn) || !/\+ "\.docx"/.test(fn)) {
      throw new Error('기본 파일 이름이 월간보고_<이름>_<YYMMDD>.docx 가 아니다');
    }
    const body = csMemberBody(src, /^RunMonthlyDocxExport$/);
    if (!/dlg\.InitialDirectory = last/.test(body) || !/MonthlyRememberDir\(/.test(body)) throw new Error('지난번 저장 폴더를 기억해 열지 않는다');
  },
  noImageBytesInPayload(src) {
    const code = stripCsComments(src);
    const parse = csMemberBody(src, /^Parse$/);
    if (/"images"|"bytes"|"dataUrl"|FromBase64String/.test(parse)) throw new Error('payload 에서 그림 바이트를 읽는다(그림은 호스트가 uid 로 넣는다)');
    if (!/pr\.Images = uid\.Length > 0 && images != null && images\.TryGetValue\(uid, out var b\)/.test(code)) throw new Error('문서 그림이 과제 uid 로 찾은 바이트가 아니다');
  },
  neverSubmits(src) {
    const code = stripCsComments(src);
    const hit = /Platform\.report|NetcusSubmit|NetcusWeekFill|netcusSubmit|netcusWeekSubmit|_netcus\b/.exec(code);
    if (hit) throw new Error(`월간보고 호스트가 회사로 보내는 길(${hit[0]})을 부른다`);
  },
  mainCase(main) {
    const code = stripCsComments(main);
    if (!/case "exportMonthlyDocx": RunMonthlyDocxExport\(DialogOwner\(fromWin\), GetStr\(doc, "reqId"\), raw\); break;/.test(code)) {
      throw new Error('메인 창 스위치에 exportMonthlyDocx case 한 줄(요청한 창을 주인으로)이 없다');
    }
    const admin = /internal static readonly HashSet<string> AdminWinCommands = new\(StringComparer\.Ordinal\)\s*\{([\s\S]*?)\};/.exec(code);
    const peer = /internal static readonly HashSet<string> PeerWinCommands = new\(StringComparer\.Ordinal\)\s*\{([\s\S]*?)\};/.exec(code);
    if (!admin || !peer) throw new Error('창 허용 목록을 찾지 못했다');
    if (admin[1].includes('"exportMonthlyDocx"') || peer[1].includes('"exportMonthlyDocx"')) throw new Error('exportMonthlyDocx 가 관리 창이나 열람 창 허용 목록에 있다(메인 창 전용)');
  },
};

test('월간 DOCX 호스트: 요청한 창이 주인인 저장 창, Task.Run 쓰기, ReplyOnUi 회신(ok, path, dir / cancelled / error)', () => host.saveFlow(exportCs));
test('월간 DOCX 호스트: 기본 파일 이름 월간보고_<이름>_<YYMMDD>.docx, 지난번 폴더 기억', () => host.fileNameAndFolder(exportCs));
test('월간 DOCX 호스트: payload 에 그림 바이트가 없고 그림은 과제 uid 로 호스트가 넣는다', () => host.noImageBytesInPayload(exportCs));
test('월간 DOCX 호스트: 회사 사이트로 보내는 길을 부르지 않는다', () => host.neverSubmits(exportCs));
test('월간 DOCX 호스트: 메인 창 스위치에 case 한 줄, 관리 창과 열람 창 허용 목록에는 없다', () => host.mainCase(mainCs));

test('변이D6: 저장 창의 주인을 빼면 저장 흐름 검사가 실패한다', () => {
  const bad = mutate(exportCs, 'if (dlg.ShowDialog(owner) != true)', 'if (dlg.ShowDialog() != true)');
  assert.throws(() => host.saveFlow(bad), /주인으로 띄우지 않는다/);
});
test('변이D7: 문서 쓰기를 Task.Run 밖(UI 스레드)으로 옮기면 저장 흐름 검사가 실패한다', () => {
  const bad = mutate(exportCs, '            var db = new ScheduleImageDb(_dataDir, Log);\n            _ = Task.Run(async () =>',
    '            DocxWriter.Write(target, p.ToReport(new Dictionary<string, List<byte[]>>()));\n            var db = new ScheduleImageDb(_dataDir, Log);\n            _ = Task.Run(async () =>');
  assert.throws(() => host.saveFlow(bad), /Task\.Run 안에서 돌지 않는다/);
});
test('변이D8: payload 에서 그림을 읽게 하면 그림 바이트 검사가 실패한다', () => {
  const bad = mutate(exportCs, '                            Title = Short(o, "title", "과제명"),', '                            Title = Short(o, "title", "과제명") + Str(o, "images"),');
  assert.throws(() => host.noImageBytesInPayload(bad), /그림 바이트를 읽는다/);
});
test('변이D9: netcus 제출을 부르면 회사 전송 검사가 실패한다', () => {
  const bad = mutate(exportCs, '                    DocxWriter.Write(target, report);', '                    DocxWriter.Write(target, report);\n                    NetcusSubmit(report);');
  assert.throws(() => host.neverSubmits(bad), /회사로 보내는 길/);
});
test('변이D10: exportMonthlyDocx 를 관리 창 허용 목록에 넣으면 메인 창 검사가 실패한다', () => {
  const bad = mutate(mainCs, '"adminWinReady", "userInfoGet", "gateRecheck",', '"adminWinReady", "userInfoGet", "gateRecheck", "exportMonthlyDocx",');
  assert.throws(() => host.mainCase(bad), /허용 목록에 있다/);
});

//  2026-10-23: 월간 탭은 수행 계획 두 칸(prevPlan, nextPlan)과 일정 변경이력(changes)을 늘 빈 배열로 보낸다.
//  호스트는 빈 배열과 없는 칸을 받아들이고(거절하지 않음), 문서는 양식 그대로 계획 칸에 빈 문단, 변경이력에 빈 줄 하나를 쓴다.
//  실제 표 모양은 loop-monthly-docx.mjs 의 과제 D(계획 칸을 비운 과제)가 본다.
const emptyPlans = {
  hostTolerant(src) {
    const lines = csMemberBody(src, /^Lines$/);
    if (!/if \(!o\.TryGetProperty\(k, out var a\) \|\| a\.ValueKind == JsonValueKind\.Null\) return list;/.test(lines)) throw new Error('본문 칸이 없거나 null 일 때 빈 목록으로 받지 않는다');
    const parse = csMemberBody(src, /^Parse$/);
    if (!/if \((?:!hw && )?o\.TryGetProperty\("changes", out var ch\) && ch\.ValueKind == JsonValueKind\.Array\)/.test(parse)) throw new Error('변경이력이 없을 때 받아들이지 않는다');
  },
  writerKeepsForm(src) {
    const al = listCsMembers(src).find((m) => m.name === 'AppendLines');
    if (!al || !/if \(!any\) AppendEmptyPara\(sb\);/.test(al.body)) throw new Error('빈 본문 칸에 빈 문단을 쓰지 않는다(셀에 문단이 없으면 Word 가 문서를 고장으로 본다)');
    const pt = listCsMembers(src).find((m) => m.name === 'ProjectTable');
    if (!pt || !/if \(changes\.Count == 0\) changes\.Add\(new Change\(\)\);/.test(pt.body)) throw new Error('변경이력이 비면 양식처럼 빈 줄 하나를 쓰지 않는다');
  },
};
test('월간 DOCX 호스트: 빈 계획 칸과 빈 변경이력(2026-10-23 화면 모양)을 받아들인다', () => emptyPlans.hostTolerant(exportCs));
test('월간 DOCX: 빈 계획 칸은 빈 문단, 빈 변경이력은 빈 줄 하나로 양식 모양을 지킨다', () => emptyPlans.writerKeepsForm(writer));
test('변이D11: 빈 변경이력의 빈 줄을 빼거나 빈 칸 문단을 빼면 양식 검사가 실패한다', () => {
  assert.throws(() => emptyPlans.writerKeepsForm(mutate(writer, 'if (changes.Count == 0) changes.Add(new Change());', '')), /빈 줄 하나/);
  assert.throws(() => emptyPlans.writerKeepsForm(mutate(writer, 'if (!any) AppendEmptyPara(sb);\n        }\n\n        private static void AppendImages', '}\n\n        private static void AppendImages')), /빈 문단/);
});

//  표 머리 줄은 다음 줄과 같은 쪽에 둔다(2026-10-22 QA: 기타 표 머리 줄만 앞 쪽 끝에 남았다).
test('과제 표와 기타 표의 머리 줄은 keepNext 로 다음 줄과 붙는다', () => {
  const w = writer.replace(/\r\n/g, '\n');
  assert.ok(/AppendPPr\(StringBuilder sb, Jc jc, int indentDxa, bool keepNext = false\)[\s\S]{0,200}<w:keepNext\/>/.test(w), 'pPr 에 keepNext 를 쓴다');
  assert.ok(/new RowWriter\(sb, ProjectGrid, 580, atLeast: true, cantSplit: true\) \{ KeepNext = true \}/.test(w), '과제 표 1행');
  assert.ok(/new RowWriter\(sb, EtcGrid, 580, atLeast: true, cantSplit: true\) \{ KeepNext = true \}/.test(w), '기타 표 1행');
  assert.ok(/AppendPara\(s, l, true, Jc\.Center, 0, keepNext: KeepNext\)/.test(w), '칸 이름 문단이 줄의 KeepNext 를 따른다');
});

// ══════════════════════════════════════════════════════════════════════
// 양식 SW/HW(2026-11-10, docs/MONTHLY-UX-V2.md 11~13, docs/MONTHLY-TEMPLATE-HW.md 3장)
//  (8) payload template: 'hw' 만 HW, 없거나 모르는 값은 SW. HW 는 계획 기간, changes, prevPlan, nextPlan 을 읽지 않는다.
//  (9) 저장 흐름: HW 는 그림을 찾지 않는다(ImagesForExportAsync 를 부르지 않고 빈 묶음).
//  (10) DocxWriter: HW 그리기 함수(HwBody, HwProjectTable, HwEtcTable)가 있고, 글자는 같은 통로(AppendPara, AppendLines)로만,
//       그림과 변경이력과 계획 칸을 쓰지 않는다. 여백 합 + HW 격자 합이 A4 가로 폭(16838) 안이다. 문서 바이트는 루프가 본다.
// ══════════════════════════════════════════════════════════════════════
const tpl = {
  parse(src) {
    const parse = csMemberBody(src, /^Parse$/);
    if (!/Template = Str\(q, "template"\)\.Trim\(\)\.ToLowerInvariant\(\) == "hw" \? DocxWriter\.Template\.Hw : DocxWriter\.Template\.Sw,/.test(parse)) {
      throw new Error("payload template 을 읽지 않거나 'hw' 가 아닌 값(없음, 모르는 값)이 SW 가 되지 않는다");
    }
    if (!/public DocxWriter\.Template Template \{ get; private set; \} = DocxWriter\.Template\.Sw;/.test(src)) throw new Error('payload 의 양식 기본값이 SW 가 아니다');
    if (!/bool hw = p\.Template == DocxWriter\.Template\.Hw;/.test(parse)) throw new Error('Parse 가 HW 여부를 따로 보지 않는다');
    if (!/if \(!hw\)\s*\{\s*var \(pf, pt\) = Range\(q, "plan", "월간 계획 기간"\);/.test(parse)) throw new Error('HW 에서도 계획 기간을 읽거나 요구한다');
    if (!/PrevPlan = hw \? new List<DocxWriter\.Line>\(\) : Lines\(o, "prevPlan"/.test(parse) || !/NextPlan = hw \? new List<DocxWriter\.Line>\(\) : Lines\(o, "nextPlan"/.test(parse)) throw new Error('HW 에서도 수행 계획 두 칸을 읽는다');
    if (!/if \(!hw && o\.TryGetProperty\("changes"/.test(parse)) throw new Error('HW 에서도 변경이력을 읽는다');
    const to = csMemberBody(src, /^ToReport$/);
    if (!/Template = Template,/.test(to)) throw new Error('ToReport 가 양식을 문서로 넘기지 않는다');
  },
  noImagesForHw(src) {
    const body = csMemberBody(src, /^RunMonthlyDocxExport$/);
    if (!/var imgs = p\.Template == DocxWriter\.Template\.Hw \? new ScheduleImageDb\.ExportImages\(\) : await db\.ImagesForExportAsync\(p\.ProjectUids\(\)\);/.test(body)) {
      throw new Error('HW 양식에서도 그림을 찾는다(HW 는 그림을 쓰지 않는다)');
    }
  },
  writer(src) {
    const members = listCsMembers(src);
    const get = (n) => { const m = members.find((x) => x.name === n); if (!m) throw new Error(`HW 그리기 멤버 ${n} 가 없다`); return m.body; };
    const doc = get('DocumentXml');
    if (!/if \(r\.Template == Template\.Hw\)\s*\{\s*HwBody\(sb, r\);\s*AppendSectPr\(sb, HwMarginTop, HwMarginRight, HwMarginBottom, HwMarginLeft\);/.test(doc)) throw new Error('DocumentXml 이 HW 를 HwBody 와 HW 여백으로 그리지 않는다');
    const hw = ['HwBody', 'HwProjectTable', 'HwEtcTable'].map(get).join('\n');
    if (/AppendRun\(|<w:t[\s>/]|AppendImages|AppendDrawingRun|\.Images\b|\.Changes\b|PrevPlan|NextPlan|PlanFrom|PlanTo|FillA/.test(hw)) {
      throw new Error('HW 그리기가 런을 직접 쓰거나 그림, 변경이력, 계획 칸, 계획 기간, 파랑 머리를 쓴다');
    }
    if (!/AppendLines\(s, p\.Actual\)/.test(hw) || !/AppendLines\(s, lines\)/.test(hw)) throw new Error('HW 본문이 SW 와 같은 줄 쓰기(AppendLines)를 거치지 않는다');
    const body = get('HwBody');
    if (!/"월간보고 \\u2013 H\/W팀 \(" \+ \(r\.Name \?\? ""\) \+ "\) \\u2013 " \+ YearMonthDay\(r\.ReportDate\)/.test(body)) throw new Error('HW 제목이 월간보고 [U+2013] H/W팀 (이름) [U+2013] 작성일 이 아니다');
    if (!/sizeHalfPt: 28, underline: true/.test(body) || !/"\[ " \+ Dotted\(r\.ActualFrom\) \+ " ~ " \+ Dotted\(r\.ActualTo\) \+ " \]"/.test(body)) throw new Error('HW 제목 14pt 밑줄 또는 실적 기간 줄이 없다');
    if (!/if \(etc != null && etc\.Count > 0\)/.test(body)) throw new Error('HW 기타 표 규칙이 SW 와 다르다(기타가 비면 표 없음)');
  },
  margins(src) {
    const code = stripCsComments(src);
    const grid = /private static readonly int\[\] HwGrid = \{([^}]*)\};/.exec(code);
    if (!grid) throw new Error('HwGrid 가 없다');
    const cols = grid[1].split(',').map((x) => Number(x.trim()));
    const want = [1416, 992, 2974, 1274, 1132, 2268, 4670];
    if (JSON.stringify(cols) !== JSON.stringify(want)) throw new Error(`HW 격자가 실측과 다르다: [${cols}]`);
    const c = (n) => { const m = new RegExp(`private const int ${n} = (\\d+);`).exec(code); if (!m) throw new Error(`${n} 가 없다`); return Number(m[1]); };
    const left = c('HwMarginLeft'), right = c('HwMarginRight');
    const sum = cols.reduce((a, b) => a + b, 0);
    if (16838 - left - right < sum) throw new Error(`HW 글 영역 ${16838 - left - right} 이 표 폭 ${sum} 을 담지 못한다(표가 오른쪽 여백으로 나간다)`);
    if (left < 1000 || right < 600) throw new Error(`HW 여백이 너무 좁다(왼쪽 ${left}, 오른쪽 ${right})`);
  },
};
test('월간 DOCX 호스트: payload template 은 hw 만 HW(없거나 모르면 SW), HW 는 계획 기간과 변경이력과 계획 칸을 읽지 않는다', () => tpl.parse(exportCs));
test('월간 DOCX 호스트: HW 양식은 그림을 찾지 않는다', () => tpl.noImagesForHw(exportCs));
test('월간 DOCX: HW 그리기(HwBody, HwProjectTable, HwEtcTable)는 같은 글자 통로를 쓰고 그림, 변경이력, 계획 칸, 파랑을 쓰지 않는다', () => tpl.writer(writer));
test('월간 DOCX: HW 격자는 실측 7열(합 14726)이고 HW 여백 안에 들어간다', () => tpl.margins(writer));

test('변이D12: 모르는 template 을 HW 로 읽으면 양식 파싱 검사가 실패한다', () => {
  const bad = mutate(exportCs, '.ToLowerInvariant() == "hw" ? DocxWriter.Template.Hw', '.ToLowerInvariant() != "sw" ? DocxWriter.Template.Hw');
  assert.throws(() => tpl.parse(bad), /모르는 값/);
});
test('변이D13: HW 에서도 그림을 찾게 하면 그림 검사가 실패한다', () => {
  const bad = mutate(exportCs, 'var imgs = p.Template == DocxWriter.Template.Hw ? new ScheduleImageDb.ExportImages() : await db.ImagesForExportAsync(p.ProjectUids());',
    'var imgs = await db.ImagesForExportAsync(p.ProjectUids());');
  assert.throws(() => tpl.noImagesForHw(bad), /그림을 찾는다/);
});
test('변이D14: HW 표에 변경이력을 쓰거나 오른쪽 여백을 SW 값(1440)으로 두면 실패한다', () => {
  const badW = mutate(writer, 'row.Cell(3, null, VMerge.None, false, s => AppendLines(s, p.Actual));',
    'row.Cell(3, null, VMerge.None, false, s => AppendLines(s, p.Actual));\n            foreach (var c in p.Changes) AppendPara(sb, c.What, false, Jc.Left, 0);');
  assert.throws(() => tpl.writer(badW), /변경이력/);
  const badM = mutate(writer, 'private const int HwMarginRight = 960;', 'private const int HwMarginRight = 1440;');
  assert.throws(() => tpl.margins(badM), /담지 못한다/);
});
test('변이D15: HW 그리기에 날 w:t 런을 넣으면 단일 통로 검사와 HW 검사가 둘 다 실패한다', () => {
  const bad = mutate(writer, '            AppendMarkPara(sb, true, 24);\n\n            foreach (var p in r.Projects ?? new List<Project>())\n            {\n                if (p == null) continue;\n                HwProjectTable(sb, p);',
    '            AppendMarkPara(sb, true, 24);\n            sb.Append("<w:p><w:r><w:t>").Append(r.Name).Append("</w:t></w:r></w:p>");\n\n            foreach (var p in r.Projects ?? new List<Project>())\n            {\n                if (p == null) continue;\n                HwProjectTable(sb, p);');
  assert.throws(() => check.singleEscapedRunWriter(bad), /2곳이다/);
  assert.throws(() => tpl.writer(bad), /런을 직접 쓰거나/);
});
