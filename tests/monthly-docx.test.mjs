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

//  표 머리 줄은 다음 줄과 같은 쪽에 둔다(2026-10-22 QA: 기타 표 머리 줄만 앞 쪽 끝에 남았다).
test('과제 표와 기타 표의 머리 줄은 keepNext 로 다음 줄과 붙는다', () => {
  const w = writer.replace(/\r\n/g, '\n');
  assert.ok(/AppendPPr\(StringBuilder sb, Jc jc, int indentDxa, bool keepNext = false\)[\s\S]{0,200}<w:keepNext\/>/.test(w), 'pPr 에 keepNext 를 쓴다');
  assert.ok(/new RowWriter\(sb, ProjectGrid, 580, atLeast: true, cantSplit: true\) \{ KeepNext = true \}/.test(w), '과제 표 1행');
  assert.ok(/new RowWriter\(sb, EtcGrid, 580, atLeast: true, cantSplit: true\) \{ KeepNext = true \}/.test(w), '기타 표 1행');
  assert.ok(/AppendPara\(s, l, true, Jc\.Center, 0, keepNext: KeepNext\)/.test(w), '칸 이름 문단이 줄의 KeepNext 를 따른다');
});
