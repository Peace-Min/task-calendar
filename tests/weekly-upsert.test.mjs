// 주간보고 같은 기간 글 고치기(WEEKLY-UPSERT, docs/WEEKLY-UPSERT.md §5) 시험.
//
// 회사 사이트는 쓰지 않는다. 대신 세 겹으로 본다.
//   A. C# 실행: widget/NetcusText.cs 를 **그대로** 작은 콘솔 프로그램과 함께 컴파일해 돌린다.
//      고르기 규칙(NcPickSameWeek), 성공 문구(WeekModifyOkMsg), 수정 화면 확인 해석(NcParseModifyProbe)은
//      JS 로 옮겨 적은 사본이 아니라 C# 이 실제로 돌려준 값으로 판정한다.
//   B. jsdom 행동: A 에서 C# 이 만든 JS 문자열(GoModifyJs, WeekModifyFillJs, WeekModifyOverrideJs, WeekModifyProbeJs,
//      ListPageMarkJs)을 가짜 수정 화면에서 그대로 실행한다. 가짜 화면은 회사 수정 화면의 **구조만** 따른다
//      (빈 form, 그 밖에 형제로 있는 칸, 같은 칸 이름, 숨은 wdate, 미리 채운 미처리사항 등). 이름과 내용은 전부 지어낸 것이다.
//   C. 정적 계약 + 변이: NetcusService.cs 의 흐름(확인 실패면 새 글을 열지 않음, 저장은 성공 뒤, 주간범위 읽기 회신 계약 그대로).
//      인계(자동수락 detach) 순서는 netcus-dialog.test.mjs 의 HANDOFF_LOADS.week 가 수정 화면까지 본다.
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, skip, assert, importOptional, SKIP_NO_JSDOM, stripCsComments, extractCsMember, readText } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WIDGET = join(HERE, '..', 'widget');
const NETCUS_TEXT_CS = join(WIDGET, 'NetcusText.cs');
const svc = readText(join(WIDGET, 'NetcusService.cs'));
const txt = readText(NETCUS_TEXT_CS);
const NL = svc.includes('\r\n') ? '\r\n' : '\n';

function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${String(from).slice(0, 80)}`);
  return out;
}
// from 이후 첫 '{' 부터 짝이 맞는 '}' 까지(문자열 안의 중괄호는 세지 않는다). 주석은 부르는 쪽이 걷어 둔다.
function braceSlice(code, from) {
  let i = code.indexOf('{', from);
  assert.ok(i >= 0 && from >= 0, '중괄호 블록을 찾지 못함');
  let depth = 0;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'") { const q = c; i++; while (i < code.length && code[i] !== q) { if (code[i] === '\\') i++; i++; } continue; }   // 문자열과 문자 리터럴('"')
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return code.slice(from, i + 1); }
  }
  throw new Error('중괄호 짝이 맞지 않음');
}
const weekFill = (cs) => extractCsMember(cs, 'private async Task NetcusWeekFill(');
function openModify(cs) {
  const m = weekFill(cs);
  const at = m.indexOf('async Task OpenModify(');
  assert.ok(at > 0, 'NetcusWeekFill 안에서 수정 경로(로컬 함수 OpenModify)를 찾지 못했다');
  return braceSlice(m, at);
}
const writePath = (cs) => { const m = weekFill(cs); return m.slice(0, m.indexOf('async Task OpenModify(')); };

// ══ A. C# 프로브(NetcusText.cs 를 그대로 컴파일) ══════════════════════════
const PROBE_CS = `using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using static TaskCalendarWidget.NetcusText;

namespace TaskCalendarWidget
{
    // 시험 전용. 입력 JSON 파일(args[0])을 읽어 NetcusText 의 순수 함수 결과를 출력 JSON 파일(args[1])로 쓴다.
    internal static class UpsertProbe
    {
        private static int Main(string[] args)
        {
            try
            {
                using var input = JsonDocument.Parse(File.ReadAllText(args[0], Encoding.UTF8));
                var root = input.RootElement;
                var o = new Dictionary<string, object?>();
                var picks = new List<object>();
                foreach (var c in root.GetProperty("picks").EnumerateArray())
                {
                    var items = new List<(string, string, bool)>();
                    foreach (var it in c.GetProperty("items").EnumerateArray()) items.Add((it[0].GetString() ?? "", it[1].GetString() ?? "", it[2].GetBoolean()));
                    string v = NcPickSameWeek(items, c.GetProperty("sdate").GetString() ?? "", c.GetProperty("edate").GetString() ?? "", out int m, out int lk);
                    picks.Add(new { viewNo = v, matches = m, locked = lk });
                }
                o["picks"] = picks;
                var js = root.GetProperty("js");
                string S(string k) => js.GetProperty(k).GetString() ?? "";
                o["goModify"] = GoModifyJs(S("viewNo"), S("id"));
                o["override"] = WeekModifyOverrideJs(S("viewNo"), S("id"));
                o["fill"] = WeekModifyFillJs(S("endwork"), S("content"), S("planwork"));
                o["probeJs"] = WeekModifyProbeJs;
                o["listMarkJs"] = ListPageMarkJs;
                o["cellJs"] = CellExtractJs;
                o["origLenJs"] = WeekModifyOrigLenJs;
                var msgs = new List<string>();
                foreach (var n in root.GetProperty("msgs").EnumerateArray()) msgs.Add(WeekModifyOkMsg(n.GetInt32()));
                o["okMsgs"] = msgs;
                o["failMsg"] = WeekLookupFailMsg;
                var parsed = new List<object>();
                foreach (var r in root.GetProperty("probeRaw").EnumerateArray())
                {
                    bool ok = NcParseModifyProbe(r.ValueKind == JsonValueKind.Null ? null : r.GetString(), out var sd, out var ed, out var wd);
                    parsed.Add(new { ok, sd, ed, wd });
                }
                o["parsed"] = parsed;
                File.WriteAllText(args[1], JsonSerializer.Serialize(o), new UTF8Encoding(false));
                return 0;
            }
            catch (Exception ex) { Console.Error.WriteLine(ex.ToString()); return 1; }
        }
    }
}
`;

const dotnetOk = (() => { const r = spawnSync('dotnet', ['--version'], { windowsHide: true, timeout: 120000 }); return !r.error && r.status === 0; })();
const PROBE_DIR = join(tmpdir(), `tc-weekly-upsert-probe-${process.pid}`);
const _probeExe = new Map();   // 종류(real: widget/NetcusText.cs 그대로, 그 밖: 변이 사본) → exe
process.on('exit', () => { try { if (existsSync(PROBE_DIR)) rmSync(PROBE_DIR, { recursive: true, force: true }); } catch (_) { } });

// kind='real' 은 widget/NetcusText.cs 를 그 자리에서 컴파일한다. mutatedText 를 주면 그 사본을 프로브 폴더에 두고 컴파일한다(C# 변이 시험).
function buildProbe(kind = 'real', mutatedText = null) {
  if (_probeExe.has(kind)) return _probeExe.get(kind);
  const dir = join(PROBE_DIR, kind);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Program.cs'), PROBE_CS, 'utf8');
  let src = NETCUS_TEXT_CS;
  if (mutatedText != null) { src = join(dir, 'NetcusText.mut.cs'); writeFileSync(src, mutatedText, 'utf8'); }
  //  오프라인(폐쇄망) 빌드: 패키지 참조가 없어 원본 저장소를 비워도 복원된다.
  writeFileSync(join(dir, 'nuget.config'),
    '<?xml version="1.0" encoding="utf-8"?>\n<configuration><packageSources><clear /></packageSources></configuration>\n', 'utf8');
  writeFileSync(join(dir, 'probe.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <LangVersion>latest</LangVersion>
    <ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>tc-upsert-probe</AssemblyName>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
    <SatelliteResourceLanguages>en</SatelliteResourceLanguages>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include=${JSON.stringify(join(dir, 'Program.cs'))} />
    <Compile Include=${JSON.stringify(src)} />
  </ItemGroup>
</Project>
`, 'utf8');
  const b = spawnSync('dotnet', ['build', join(dir, 'probe.csproj'), '-c', 'Release', '-v', 'q', '--nologo'],
    { cwd: dir, windowsHide: true, timeout: 420000, maxBuffer: 64 * 1024 * 1024 });
  const out = (b.stdout || Buffer.alloc(0)).toString('utf8') + (b.stderr || Buffer.alloc(0)).toString('utf8');
  const exe = join(dir, 'bin', 'Release', 'net9.0', process.platform === 'win32' ? 'tc-upsert-probe.exe' : 'tc-upsert-probe');
  if (b.error || b.status !== 0 || !existsSync(exe)) {
    throw new Error(`NetcusText.cs 프로브(${kind}) 빌드 실패(이 시험은 C# 을 그대로 컴파일해 판정한다):\n`
      + (out.split('\n').filter((l) => /error|오류/i.test(l)).slice(0, 12).join('\n') || out.slice(-1500)));
  }
  _probeExe.set(kind, exe);
  return exe;
}

let _runSeq = 0;
function runProbe(input, kind = 'real', mutatedText = null) {
  const exe = buildProbe(kind, mutatedText);
  const n = ++_runSeq;
  const inF = join(PROBE_DIR, `in-${n}.json`), outF = join(PROBE_DIR, `out-${n}.json`);
  writeFileSync(inF, JSON.stringify(input), 'utf8');
  const r = spawnSync(exe, [inF, outF], { windowsHide: true, timeout: 120000 });
  if (r.error || r.status !== 0) throw new Error('프로브 실행 실패: ' + (r.error ? r.error.message : (r.stderr || '').toString('utf8')));
  return JSON.parse(readFileSync(outF, 'utf8'));
}

// 시험 입력(지어낸 값). 기간 P 는 2026-09-28(월) ~ 2026-10-03(토).
const SD = '2026-09-28', ED = '2026-10-03', P = '2026-09-28 ~ 2026-10-03';
const USER_ID = 'tester+01';   // encodeURIComponent 를 실제로 거치는지 보려고 '+' 를 넣었다
const NEW = {
  endwork: "[가상과제A]\n1. 구현\n    - 따옴표 ' \" 와 역슬래시 \\ 와 </script> 확인\n\n[가상과제B]\n    - 회의",
  content: '[가상과제A] : 10\n[가상과제B] : 2\n----------------------------\n합계 : 12',
  planwork: '[가상과제A]\n    - 다음 주 가상 계획',
};
const PICKS = [
  { name: '하나가 기간이 정확히 같다', items: [['101', P]], sdate: SD, edate: ED, want: { viewNo: '101', matches: 1 } },
  { name: '시작만 같다(끝이 다르다)', items: [['101', '2026-09-28 ~ 2026-10-04']], sdate: SD, edate: ED, want: { viewNo: '', matches: 0 } },
  { name: '끝만 같다(시작이 다르다)', items: [['101', '2026-09-27 ~ 2026-10-03']], sdate: SD, edate: ED, want: { viewNo: '', matches: 0 } },
  { name: '여러 개면 글 번호가 가장 큰 글(문자열 순서가 아니라 수)', items: [['99', P], ['205', P], ['1000', P], ['3000', '2026-10-05 ~ 2026-10-10']], sdate: SD, edate: ED, want: { viewNo: '1000', matches: 3 } },
  { name: '기간을 못 읽은 글은 같은 글로 보지 않는다', items: [['500', '기간 미정'], ['501', ''], ['502', '2026-09-28'], ['503', '2026-13-40 ~ 2026-10-03']], sdate: SD, edate: ED, want: { viewNo: '', matches: 0 } },
  { name: '구분자 모양이 달라도 날짜가 같으면 같은 글(/, 붙여 쓴 ~, ∼)', items: [['601', '2026/09/28 ~ 2026/10/03'], ['602', '2026-09-28~2026-10-03'], ['603', '2026.9.28 ∼ 2026.10.3']], sdate: SD, edate: ED, want: { viewNo: '603', matches: 3 } },
  { name: '글 번호를 못 읽은 글은 고르지 않는다', items: [['abc', P], ['0', P]], sdate: SD, edate: ED, want: { viewNo: '', matches: 0 } },
  { name: '요청 기간을 못 읽으면 아무것도 고르지 않는다', items: [['101', P]], sdate: '이번 주', edate: ED, want: { viewNo: '', matches: 0 } },
  { name: '후보가 없으면 없다', items: [], sdate: SD, edate: ED, want: { viewNo: '', matches: 0 } },
  //  2026-10-08 검토 2: 수정 단추가 없는 글(내가 고칠 수 없는 글)은 기간이 같아도 고르지 않는다.
  { name: '수정 단추가 없는 글은 기간이 같아도 고르지 않는다(번호가 더 커도)', items: [['300', P, false], ['120', P]], sdate: SD, edate: ED, want: { viewNo: '120', matches: 1, locked: 1 } },
  { name: '같은 기간 글이 모두 수정 단추가 없으면 없다', items: [['300', P, false]], sdate: SD, edate: ED, want: { viewNo: '', matches: 0, locked: 1 } },
];
const pickWant = (c) => ({ locked: 0, ...c.want });
const PROBE_RAW_STATIC = [null, 'null', '"not json"', JSON.stringify(JSON.stringify({ sd: SD, ed: ED, wd: '2026/10/02 17:50' }))];
const BASE_INPUT = {
  picks: PICKS.map(({ items, sdate, edate }) => ({ items: items.map((it) => (it.length === 3 ? it : [...it, true])), sdate, edate })),
  js: { viewNo: '101', id: USER_ID, ...NEW },
  msgs: [1, 2, 3],
  probeRaw: PROBE_RAW_STATIC,
};
let _base = null;
const base = () => (_base ||= runProbe(BASE_INPUT));

// ══ B. jsdom 가짜 수정 화면 ═════════════════════════════════════════════
//  회사 수정 화면의 구조: 빈 <form name="form" enctype="multipart/form-data" method="post"></form> 이 표 안에 있고,
//  칸은 그 밖에 형제로 있다(폼에 묶이지 않는다). 새 글 화면과 칸 이름이 같고 숨은 wdate 가 더 있다. 기존 값이 미리 채워져 있다.
const MODIFY_FIXTURE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>가짜 수정 화면</title></head><body>
<table><tr><td>
<form name="form" enctype="multipart/form-data" method="post"></form>
<input type="hidden" name="ndate" value="2026/10/02">
<input type="hidden" name="wdate" value="2026/10/02 17:50">
<input type="hidden" name="iscompletion" value="n">
<input type="hidden" name="seq_key" value="77">
<table>
<tr><td><div>기간</div></td><td><input type="text" name="sdate" value="${SD}" readonly> ~ <input type="text" name="edate" value="${ED}" readonly></td></tr>
<tr><td><div>제목</div></td><td><input type="text" name="subject" value="가상 주간보고 제목"> <input type="checkbox" name="html" value="Y"> HTML <input type="radio" name="opt" value="a" checked><input type="radio" name="opt" value="b"></td></tr>
<tr><td><div>진행사항</div></td><td><textarea name="endwork">[가상과제A] 예전 진행 내용</textarea></td></tr>
<tr><td><div>과제투입시간</div></td><td><textarea name="content">[가상과제A] : 8</textarea></td></tr>
<tr><td><div>미처리사항</div></td><td><textarea name="notendwork">가상&nbsp;&nbsp;미처리 메모</textarea></td></tr>
<tr><td><div>차주계획</div></td><td><textarea name="planwork">예전 차주 계획</textarea></td></tr>
<tr><td><div>문제점</div></td><td><textarea name="problem">가상 문제점 메모</textarea></td></tr>
<tr><td><div>회의내용</div></td><td><textarea name="resultwork">가상 회의 메모</textarea></td></tr>
</table>
<input type="button" name="btn_save" value="임시저장" onclick="Bmodify('n')"> <input type="submit" name="btn_go" value="제출">
<input type="file" name="upfile"> <input type="text" name="old_memo" value="꺼진 칸" disabled>
<a href="javascript:Bmodify('n')">임시저장</a> <a href="javascript:Bmodify('y')">제출</a>
</td></tr></table></body></html>`;
//  2026-10-08 검토 1: 파서가 칸을 빈 form 에 묶는 경우. 같은 칸을 form 안에 두고(묶임), form 밖에 칸 하나를 더 둔다(안 실려야 한다).
const MODIFY_FIXTURE_ASSOC = MODIFY_FIXTURE
  .replace('<form name="form" enctype="multipart/form-data" method="post"></form>', '<form name="form" enctype="multipart/form-data" method="post">')
  .replace("<a href=\"javascript:Bmodify('n')\">", "</form><input type=\"hidden\" name=\"outside_only\" value=\"z\"><a href=\"javascript:Bmodify('n')\">");
const NBSP_NOTE = '가상\u00a0\u00a0미처리 메모';
// 원래 Bmodify 를 흉내 낸 것(검사, 'y' 확인창, 이름이 form 인 폼에 action 지정 후 submit). 지어낸 view_no, id.
//   회사 화면은 document.form 으로 부르지만 jsdom 은 document 의 이름 접근을 모른다 → document.forms['form'](같은 요소).
const PAGE_SCRIPT = `function Bmodify(iscompletion){
  var sd=document.getElementsByName('sdate')[0], sj=document.getElementsByName('subject')[0];
  if(sd.value==''){alert('기간을 선택하세요.');return;}
  if(sj.value==''){alert('제목을 입력하세요.');return;}
  if(iscompletion=='y'){ if(!confirm('제출하시겠습니까?')) return; }
  var F=document.forms['form'];
  F.action='pjm_modify.jsp?go=write&table=report_tbl&view_no=101&id=tester+01';
  F.submit();
}`;
const LIST_FIXTURE = `<!DOCTYPE html><html><body><table><tr><td><form name="form" method="post"></form>
<input type="hidden" name="table_code" value="report_tbl"><input type="hidden" name="id" value="tester+01">
</td></tr></table></body></html>`;
const BLANK_FIXTURE = '<!DOCTYPE html><html><body><p>오류</p></body></html>';
const NAMES = ['ndate', 'wdate', 'iscompletion', 'sdate', 'edate', 'subject', 'html', 'endwork', 'content', 'notendwork', 'planwork', 'problem', 'resultwork'];
const KEEP = ['ndate', 'wdate', 'iscompletion', 'sdate', 'edate', 'subject', 'html', 'notendwork', 'problem', 'resultwork'];

const jsdomMod = await importOptional('jsdom');
function page(html = MODIFY_FIXTURE, script = PAGE_SCRIPT) {
  const dom = new jsdomMod.JSDOM(html, { runScripts: 'outside-only', url: 'https://intranet.example.invalid/pjm/pjm_modify.jsp' });
  const w = dom.window;
  const log = { sent: [], alerts: [], confirms: [], answer: true };
  w.alert = (m) => { log.alerts.push(String(m)); };
  w.confirm = (m) => { log.confirms.push(String(m)); return log.answer; };
  //  submit 은 가로챈다(네트워크로 나가지 않는다). 보낸 폼의 action, 방식, 칸 목록과 값을 그대로 남긴다.
  w.HTMLFormElement.prototype.submit = function () {
    log.sent.push({
      action: this.getAttribute('action'), method: String(this.getAttribute('method') || '').toLowerCase(),
      enctype: this.getAttribute('enctype'), charset: this.getAttribute('accept-charset'),
      fields: Array.from(this.elements).map((e) => [e.name, e.value]),
    });
  };
  if (script) w.eval(script);
  const val = (n) => { const e = w.document.getElementsByName(n)[0]; return e ? (e.type === 'checkbox' ? e.checked : e.value) : undefined; };
  const snap = () => Object.fromEntries(NAMES.map((n) => [n, val(n)]));
  return { w, log, run: (js) => w.eval(js), val, snap };
}
const fixtureValues = () => page().snap();
//  보낼 칸(문서 순서): iscompletion 은 인자로 바뀌고, 모르는 숨은 칸(seq_key)과 고른 라디오(opt=a)도 실린다.
//  빠지는 칸: 체크 안 된 html(체크하면 subject 다음), 고르지 않은 라디오, button, submit, file, disabled.
const expectedFields = (iscompletion, v, html = false) => [
  ['ndate', v.ndate], ['wdate', v.wdate], ['iscompletion', iscompletion], ['seq_key', '77'],
  ['sdate', v.sdate], ['edate', v.edate], ['subject', v.subject], ...(html ? [['html', 'Y']] : []), ['opt', 'a'],
  ['endwork', v.endwork], ['content', v.content], ['notendwork', v.notendwork], ['planwork', v.planwork], ['problem', v.problem], ['resultwork', v.resultwork]];
const EXPECTED_NAMES = 'ndate,wdate,iscompletion,seq_key,sdate,edate,subject,opt,endwork,content,notendwork,planwork,problem,resultwork';
const MODIFY_ACTION = 'pjm_modify.jsp?go=write&table=report_tbl&view_no=101&id=' + encodeURIComponent(USER_ID);

// ══ 등록 ════════════════════════════════════════════════════════════════
if (!dotnetOk) {
  skip('주간 고치기: C# 프로브(NetcusText.cs 컴파일) 시험 전부', 'dotnet 없음',
    '고르기 규칙, 성공 문구, 호스트가 만든 JS 의 jsdom 행동을 판정하지 못했다(JS 사본으로는 C# 동작의 증거가 되지 않는다)');
} else {
  // ── A. 고르기 규칙(C# 실행) ──
  PICKS.forEach((c, i) => {
    test(`주간 고치기 A${i + 1}: 고르기 규칙(C#) ${c.name}`, () => {
      assert.deepStrictEqual(base().picks[i], pickWant(c));
    });
  });

  test('주간 고치기 A10: 성공 문구(C#)는 "주간보고 " 로 시작하고, 2개 이상이면 중복 안내를 붙인다', () => {
    const [one, two, three] = base().okMsgs;
    for (const m of [one, two, three]) {
      assert.ok(/^주간보고 /.test(m), `성공 문구가 RPT_WEEKFILL_OK_RE(/^주간보고 /)와 맞지 않는다: ${m}`);
      assert.ok(!/[—–「」]| · /.test(m), `새 문구에 엠 대시, en 대시, 낫표, 가운데 점 구분자가 있다: ${m}`);
    }
    assert.ok(!/같은 기간 글이/.test(one), '하나뿐인데 중복 안내를 붙였다');
    assert.ok(two.startsWith(one + ' ') && /같은 기간 글이 2개 있어 가장 최근 글을 열었습니다\. 나머지는 회사 화면에서 지워 주세요\.$/.test(two), `2개 안내가 다르다: ${two}`);
    assert.ok(/같은 기간 글이 3개 있어/.test(three), `3개 안내가 다르다: ${three}`);
    assert.ok(one.includes('진행사항, 과제투입시간, 차주계획 세 칸은 캘린더 내용으로 바뀌었습니다.'), `세 칸이 통째로 바뀐다는 말이 없다: ${one}`);
    assert.ok(one.includes('임시저장이나 제출을 누르세요.'), `무엇을 누를지 말하지 않는다: ${one}`);
    assert.ok(/저장하지 않고 창을 닫으면 회사 글은 그대로입니다\.$/.test(one), `저장하지 않으면 회사 글이 그대로라는 말이 없다: ${one}`);
  });

  test('주간 고치기 A11: 확인 실패 문구(C#)는 설계 문구 그대로다', () => {
    assert.strictEqual(base().failMsg, '기존 주간보고를 확인하지 못했습니다. 다시 시도하세요.');
  });

  test('주간 고치기 A12: 수정 화면 확인 해석(C#)은 칸이 없거나 못 읽으면 false, 읽으면 sd, ed, wd', () => {
    const p = base().parsed;
    assert.deepStrictEqual(p.slice(0, 3).map((x) => x.ok), [false, false, false]);
    assert.deepStrictEqual(p[3], { ok: true, sd: SD, ed: ED, wd: '2026/10/02 17:50' });
  });

  test('주간 고치기 A13(변이): NetcusText.cs 사본에서 고르기를 "가장 작은 번호" 로, 기간 비교를 시작만으로 바꾸면 A 판정이 달라진다', () => {
    //  A 묶음이 정말 C# 출력으로 판정한다는 증거. 사본을 컴파일해 같은 입력을 넣고, 기대값과 어긋나는지 본다.
    let mut = mutate(txt, 'if (n > bestNo) { bestNo = n;', 'if (bestNo == 0 || n < bestNo) { bestNo = n;');
    mut = mutate(mut, '|| a != ds || b != de) continue;', '|| a != ds) continue;');
    const out = runProbe(BASE_INPUT, 'mut', mut);
    const i4 = PICKS.findIndex((c) => /가장 큰 글/.test(c.name)), i2 = PICKS.findIndex((c) => /시작만 같다/.test(c.name));
    assert.notDeepStrictEqual(out.picks[i4], pickWant(PICKS[i4]), '가장 작은 번호를 고르는 변이를 A 가 못 잡는다');
    assert.notDeepStrictEqual(out.picks[i2], pickWant(PICKS[i2]), '시작만 비교하는 변이를 A 가 못 잡는다');
    assert.deepStrictEqual(base().picks[i4], pickWant(PICKS[i4]), '원본 C# 의 판정이 흔들렸다');
  });

  test('주간 고치기 A14(변이): NetcusText.cs 사본에서 수정 단추 검사를 빼면 남의 글(수정 단추 없음)을 고른다', () => {
    const mut = mutate(txt, 'if (!canModify) { locked++; continue; }', '');
    const out = runProbe(BASE_INPUT, 'mut-mod', mut);
    const k = PICKS.findIndex((c) => /수정 단추가 없는 글은 기간이 같아도/.test(c.name));
    assert.notDeepStrictEqual(out.picks[k], pickWant(PICKS[k]), '수정 단추 검사를 뺀 변이를 A 가 못 잡는다');
    assert.strictEqual(out.picks[k].viewNo, '300', '변이 사본은 수정 단추 없는 300 을 골라야 한다(변이가 효과를 못 냈다)');
  });

  // ── B. jsdom 행동(C# 이 만든 JS 를 그대로 실행) ──
  if (!jsdomMod) {
    skip('주간 고치기 B: 가짜 수정 화면 jsdom 행동 시험 전부', SKIP_NO_JSDOM, '호스트가 만든 채우기와 Bmodify 대체 JS 를 실행해 보지 못했다');
  } else {
    test('주간 고치기 B0: 가짜 화면이 회사 구조와 같다(빈 form 에 칸이 묶이지 않아 원래 Bmodify 는 빈 폼을 보낸다)', () => {
      const P0 = page();
      assert.strictEqual(P0.w.document.forms.form.elements.length, 0, '가짜 화면의 form 에 칸이 묶여 있다. 회사 화면(빈 form, 형제 칸)과 다르다');
      P0.run("Bmodify('n')");
      assert.strictEqual(P0.log.sent.length, 1);
      assert.deepStrictEqual(P0.log.sent[0].fields, [], '원래 Bmodify 가 칸을 실어 보냈다. 안전판이 왜 필요한지 보여 주는 전제가 무너졌다');
    });

    test('주간 고치기 B1: 채우기 JS 는 진행사항, 과제투입시간, 차주계획 셋만 바꾸고 나머지(wdate 포함)는 그대로 둔다', () => {
      const P1 = page();
      const before = P1.snap();
      assert.strictEqual(P1.run(base().fill), 1, '채우기 JS 가 1 을 돌려주지 않았다');
      const after = P1.snap();
      for (const n of KEEP) assert.deepStrictEqual(after[n], before[n], `${n} 이(가) 바뀌었다`);
      assert.strictEqual(after.endwork, NEW.endwork);
      assert.strictEqual(after.content, NEW.content);
      assert.strictEqual(after.planwork, NEW.planwork);
    });

    test('주간 고치기 B2: 세 칸 중 하나라도 없으면 아무것도 쓰지 않고 0 을 돌려준다', () => {
      const P2 = page(MODIFY_FIXTURE.replace('<textarea name="planwork">예전 차주 계획</textarea>', ''));
      const before = P2.snap();
      assert.strictEqual(P2.run(base().fill), 0);
      assert.deepStrictEqual(P2.snap(), before);
    });

    test("주간 고치기 B3: 대체 Bmodify('n') 은 확인창 없이 정확한 action 과 칸 목록, 값으로 euc-kr multipart 폼을 보낸다", () => {
      const P3 = page();
      const sig = P3.run(base().override);
      assert.strictEqual(sig, 'ok sig=1 form=0 names=' + EXPECTED_NAMES, '안전판 진단(원래 Bmodify 표지, 폼 묶임, 칸 이름)이 다르다');
      P3.run(base().fill);
      const v = P3.snap();
      P3.run("Bmodify('n')");
      assert.deepStrictEqual(P3.log.confirms, [], "임시저장('n')인데 확인창을 띄웠다");
      assert.deepStrictEqual(P3.log.alerts, []);
      assert.strictEqual(P3.log.sent.length, 1, '폼을 한 번 보내지 않았다');
      const s = P3.log.sent[0];
      assert.strictEqual(s.action, MODIFY_ACTION);
      assert.strictEqual(s.method, 'post');
      assert.strictEqual(s.enctype, 'multipart/form-data');
      assert.strictEqual(s.charset, 'euc-kr');
      assert.deepStrictEqual(s.fields, expectedFields('n', v), '보낸 칸 목록이나 값이 수정 화면 칸과 다르다');
      //  끝에서 끝까지: 세 칸은 새 값, 나머지는 화면에 원래 있던 값 그대로 나간다.
      const sent = Object.fromEntries(s.fields);
      const orig = fixtureValues();
      for (const n of ['ndate', 'wdate', 'sdate', 'edate', 'subject', 'notendwork', 'problem', 'resultwork']) assert.strictEqual(sent[n], orig[n], `${n} 이(가) 원래 값으로 나가지 않았다`);
      assert.strictEqual(sent.endwork, NEW.endwork);
      assert.strictEqual(sent.planwork, NEW.planwork);
      assert.strictEqual(sent.seq_key, '77', '모르는 숨은 칸을 싣지 않았다');
      assert.strictEqual(sent.notendwork, NBSP_NOTE, '&nbsp; 가 풀린 U+00A0 이 그대로 나가지 않았다');
      for (const n of ['btn_save', 'btn_go', 'upfile', 'old_memo', 'outside_only']) assert.ok(!(n in sent), `실으면 안 되는 칸 ${n} 을 실었다`);
    });

    test("주간 고치기 B3b: 칸이 form 에 묶인 화면이면 form.elements 에서 모아 같은 칸을 보낸다(form 밖 칸은 싣지 않는다)", () => {
      const PA = page(MODIFY_FIXTURE_ASSOC);
      assert.ok(PA.w.document.forms.form.elements.length > 10, '묶인 변형 화면에서 칸이 form 에 묶이지 않았다(시험 전제)');
      assert.strictEqual(PA.run(base().override), 'ok sig=1 form=1 names=' + EXPECTED_NAMES, 'form.elements 로 모았다는 진단(form=1)이 아니다');
      PA.run(base().fill);
      const v = PA.snap();
      PA.run("Bmodify('n')");
      assert.strictEqual(PA.log.sent.length, 1);
      assert.strictEqual(PA.log.sent[0].action, MODIFY_ACTION);
      assert.deepStrictEqual(PA.log.sent[0].fields, expectedFields('n', v), '묶인 화면에서 보낸 칸 목록이나 값이 다르다');
      const sent = Object.fromEntries(PA.log.sent[0].fields);
      assert.ok(!('outside_only' in sent), 'form.elements 로 모으는데 form 밖 칸을 실었다');
      assert.strictEqual(sent.notendwork, NBSP_NOTE);
    });

    test("주간 고치기 B3c: 두 번 눌러도 앞서 만든 우리 폼의 칸을 다시 모으지 않는다(iscompletion 은 하나)", () => {
      const PR = page();
      PR.run(base().override);
      PR.run("Bmodify('n')");
      PR.run("Bmodify('n')");
      assert.strictEqual(PR.log.sent.length, 2);
      assert.deepStrictEqual(PR.log.sent[1].fields, PR.log.sent[0].fields, '두 번째 전송에 앞 폼의 칸이 섞였다');
      assert.strictEqual(PR.log.sent[1].fields.filter((f) => f[0] === 'iscompletion').length, 1);
    });

    test("주간 고치기 B4: HTML 체크가 켜져 있으면 html 칸을 덧붙이고, 꺼져 있으면 싣지 않는다", () => {
      const P4 = page();
      P4.run(base().override);
      P4.w.document.getElementsByName('html')[0].checked = true;
      P4.run("Bmodify('n')");
      assert.deepStrictEqual(P4.log.sent[0].fields, expectedFields('n', P4.snap(), true), '체크한 html 이 제자리(subject 다음)에 실리지 않았다');
    });

    test("주간 고치기 B5: 대체 Bmodify('y') 는 '제출하시겠습니까?' 확인창을 거친다(취소면 보내지 않는다)", () => {
      const P5 = page();
      P5.run(base().override);
      P5.log.answer = false;
      P5.run("Bmodify('y')");
      assert.deepStrictEqual(P5.log.confirms, ['제출하시겠습니까?']);
      assert.strictEqual(P5.log.sent.length, 0, '확인창에서 취소했는데 보냈다');
      P5.log.answer = true;
      P5.run("Bmodify('y')");
      assert.strictEqual(P5.log.sent.length, 1);
      assert.deepStrictEqual(P5.log.sent[0].fields.filter((f) => f[0] === 'iscompletion'), [['iscompletion', 'y']]);
      assert.strictEqual(P5.log.sent[0].action, MODIFY_ACTION);
    });

    test('주간 고치기 B6: 대체 Bmodify 는 기간, 제목이 비면 원본처럼 알리고 멈춘다', () => {
      const P6 = page();
      P6.run(base().override);
      P6.w.document.getElementsByName('sdate')[0].value = '';
      P6.run("Bmodify('n')");
      assert.deepStrictEqual(P6.log.alerts, ['기간을 선택하세요.']);
      P6.w.document.getElementsByName('sdate')[0].value = SD;
      P6.w.document.getElementsByName('subject')[0].value = '';
      P6.run("Bmodify('y')");
      assert.deepStrictEqual(P6.log.alerts, ['기간을 선택하세요.', '제목을 입력하세요.']);
      assert.deepStrictEqual(P6.log.confirms, [], '검사에서 멈춰야 하는데 확인창까지 갔다');
      assert.strictEqual(P6.log.sent.length, 0);
    });

    test('주간 고치기 B7: 원래 Bmodify 에 수정 저장 표지가 없으면 sig=0 으로 알린다(구조 변화 감지)', () => {
      assert.ok(page(MODIFY_FIXTURE, '').run(base().override).startsWith('ok sig=0 form=0 names='));
      assert.ok(page(MODIFY_FIXTURE, "function Bmodify(x){document.forms['form'].submit();}").run(base().override).startsWith('ok sig=0 '));
    });

    test('주간 고치기 B8: GoModifyJs 는 pjm_modify.jsp?list=go&start=1&view_no=<n> 로 숨은 칸을 실어 POST 한다', () => {
      const P8 = page(LIST_FIXTURE, '');
      assert.strictEqual(P8.run(base().goModify), 'ok');
      assert.strictEqual(P8.log.sent.length, 1);
      const s = P8.log.sent[0];
      assert.strictEqual(s.action, 'pjm_modify.jsp?list=go&start=1&view_no=101');
      assert.strictEqual(s.method, 'post');
      assert.deepStrictEqual(s.fields, [['word_code', ''], ['n_code', ''], ['s_code', ''], ['c_code', ''], ['table_code', 'report_tbl'], ['id', USER_ID]]);
    });

    test('주간 고치기 B9: 수정 화면 확인 JS 는 수정 화면에서만 {sd, ed, wd} 를 돌려주고, 그 값을 C# 이 그대로 읽는다', () => {
      const got = page().run(base().probeJs);
      assert.strictEqual(typeof got, 'string', '수정 화면인데 확인 JS 가 null 을 돌려줬다');
      assert.deepStrictEqual(JSON.parse(got), { sd: SD, ed: ED, wd: '2026/10/02 17:50' });
      //  새 글 화면(wdate 없음)과 다른 화면에서는 null 이다.
      assert.strictEqual(page(MODIFY_FIXTURE.replace('<input type="hidden" name="wdate" value="2026/10/02 17:50">', ''), '').run(base().probeJs), null);
      assert.strictEqual(page(BLANK_FIXTURE, '').run(base().probeJs), null);
      //  2026-10-08 검토 4: 일곱 칸은 각각 정확히 하나여야 한다(같은 이름이 둘이면 어느 칸을 채울지 모른다).
      assert.strictEqual(page(MODIFY_FIXTURE.replace('<input type="hidden" name="seq_key" value="77">', '<input type="hidden" name="subject" value="둘째 제목">'), '').run(base().probeJs), null, '제목 칸이 둘인데 수정 화면으로 봤다');
      //  ExecuteScriptAsync 는 결과를 JSON 으로 한 번 더 감싸 돌려준다. 그 모양 그대로 C# 해석기에 넣는다.
      const out = runProbe({ ...BASE_INPUT, picks: [], probeRaw: [JSON.stringify(got), JSON.stringify(null)] });
      assert.deepStrictEqual(out.parsed, [{ ok: true, sd: SD, ed: ED, wd: '2026/10/02 17:50' }, { ok: false, sd: '', ed: '', wd: '' }]);
    });

    test('주간 고치기 B10: 목록 표지 JS 는 목록(빈 목록 포함)에서 true, 엉뚱한 화면에서 false 다', () => {
      assert.strictEqual(page(LIST_FIXTURE, '').run(base().listMarkJs), true);
      assert.strictEqual(page(BLANK_FIXTURE, 'function go_view(n){}').run(base().listMarkJs), true);
      assert.strictEqual(page(BLANK_FIXTURE, '').run(base().listMarkJs), false);
    });

    test('주간 고치기 B11: 보기 화면 추출의 수정 단추 표지(mod)는 go_modify 단추, 링크, input[name=mo] 가 있을 때만 "1" 이다', () => {
      const V = (inner) => JSON.parse(page('<!DOCTYPE html><html><body><table><tr><td><div>기간</div></td><td>' + P + '</td></tr></table>' + inner + '</body></html>', '').run(base().cellJs)).mod;
      assert.strictEqual(V('<input type="button" value="수정" onclick="go_modify(101)">'), '1');
      assert.strictEqual(V('<a href="javascript:go_modify(101)">수정</a>'), '1');
      assert.strictEqual(V('<input type="hidden" name="mo" value="1">'), '1');
      assert.strictEqual(V('<input type="button" value="목록" onclick="go_list(1)">'), '', '수정 단추가 없는 글(남의 글)에 표지가 섰다');
    });

    test('주간 고치기 B12: 채우기 전 원래 길이 JS 는 세 칸의 글자 수(숫자)만 돌려준다(내용은 싣지 않는다)', () => {
      const PL = page();
      const raw = PL.run(base().origLenJs);
      const o = JSON.parse(raw);
      assert.deepStrictEqual(Object.keys(o).sort(), ['content', 'endwork', 'planwork']);
      assert.deepStrictEqual(o, { endwork: PL.val('endwork').length, content: PL.val('content').length, planwork: PL.val('planwork').length });
      assert.ok(!raw.includes('예전'), '원래 내용이 반환값에 섞였다');
      assert.deepStrictEqual(JSON.parse(page(BLANK_FIXTURE, '').run(base().origLenJs)), { endwork: -1, content: -1, planwork: -1 });
    });
  }
}

// ══ C. 정적 계약(NetcusService.cs, NetcusText.cs) ═══════════════════════
const checks = {
  //  C1. 같은 기간 글 찾기는 목록을 연 뒤, 새 글 경로보다 먼저 돈다. 실패(예외 포함)면 창을 닫고 확인 실패 문구로 멈춘다.
  lookupFailStops(cs) {
    const w = writePath(cs);
    const listNav = w.indexOf('NetcusStatus("weekfill", "listing");');
    const call = w.indexOf('same = await NcFindSameWeek(cw, id, req.Sdate, req.Edate);');
    const failIf = w.indexOf('if (!same.Ok)');
    const modIf = w.indexOf('if (same.ViewNo.Length > 0) { await OpenModify(cw, same); return; }');
    const writeDetach = w.indexOf('var wnav = NavOnce(cw, 15000);');
    const writeLoad = w.indexOf('await cw.ExecuteScriptAsync(goWrite);');
    assert.ok(listNav > 0 && call > listNav, '같은 기간 글 찾기가 목록을 연 뒤에 돌지 않는다');
    assert.ok(writeDetach > call && writeLoad > writeDetach, '새 글 경로가 찾기보다 앞에 있다. 확인 없이 새 글이 열린다');
    assert.ok(failIf > call && failIf < writeDetach, '찾기 결과의 실패 검사가 찾기와 새 글 경로 사이에 없다');
    assert.ok(modIf > failIf && modIf < writeDetach, '수정 경로 분기가 실패 검사 뒤, 새 글 경로 앞에 있지 않다(확인 실패인데 무언가를 연다)');
    const fb = braceSlice(w, failIf);
    assert.ok(fb.includes('NetcusResult(false, WeekLookupFailMsg);'), '확인 실패인데 확인 실패 문구를 내지 않는다');
    assert.ok(/\breturn;/.test(fb), '확인 실패 블록에 return 이 없다. 새 글 작성 화면으로 내려간다(중복 재발)');
    assert.ok(/_w2win\?\.Close\(\)/.test(fb), '확인 실패 때 읽던 목록이나 보기 화면을 사용자에게 남긴다');
    //  예외는 실패로 바뀐다(Ok 기본값 false). 예외를 '없음'으로 읽으면 새 글이 열린다.
    assert.ok(/catch \(Exception \w+\) \{[^{}]*same = new NcSameWeek\(\); \}/.test(w), '찾기 예외가 확인 실패(Ok=false)로 바뀌지 않는다');
    assert.ok(/private sealed class NcSameWeek \{ public bool Ok; /.test(cs), 'NcSameWeek.Ok 의 기본값이 false 가 아니다');
    assert.ok(!/Ok\s*=\s*true/.test(extractCsMember(cs, 'private async Task<NcSameWeek> NcFindSameWeek(')), '찾기가 Ok 를 직접 true 로 세운다(실패 사유와 무관하게 통과)');
  },

  //  C2. 찾기 안의 실패 사유: 세션 만료, 보기 화면이나 기간 칸을 못 읽음(건너뛰지 않음), 행 0 인데 목록 표지 없음, 상한에 닿았는데 못 찾음.
  lookupFailReasons(cs) {
    const f = extractCsMember(cs, 'private async Task<NcSameWeek> NcFindSameWeek(');
    assert.ok(/if \(!NcDate\(sdate, out var ds\) \|\| !NcDate\(edate, out var de\)\) \{[^{}]*return res; \}/.test(f), '요청 기간을 못 읽을 때 실패(Ok=false)로 돌아가지 않는다');
    assert.ok(f.includes('if (end.SessionLost) why = '), '세션 만료를 실패로 보지 않는다');
    assert.ok(/if \(cell == null \|\| string\.IsNullOrWhiteSpace\(cell\.period\)\) \{ why = [^;]+; return false; \}/.test(f), '보기 화면이나 기간 칸을 못 읽은 글을 건너뛴다(그 글이 같은 기간일 수 있다)');
    assert.ok(f.includes('end.EmptyPage > 0 && await cw.ExecuteScriptAsync(ListPageMarkJs) != "true"'), '행 0 일 때 빈 목록과 못 읽은 목록을 가르지 않는다');
    assert.ok(/if \(res\.ViewNo\.Length == 0 && \(end\.Capped \|\| !finished\)\)/.test(f), '상한에 닿았는데 못 찾은 것을 "없음" 으로 읽는다');
    assert.ok(f.includes('bool finished = end.AllOlder || end.NoProgress || end.EmptyPage > 0;'), '"창 끝까지 봤다" 의 정의가 바뀌었다(페이지 상한에 닿았는데 못 찾은 것을 "없음" 으로 읽게 된다)');
    assert.ok(f.includes('found.Add((viewNo, cell.period, cell.mod == "1"));'), '수정 단추 표지(cell.mod)를 고르기에 넘기지 않는다(남의 글을 고를 수 있다)');
    assert.ok(f.includes('NcPickSameWeek(found, sdate, edate, out int matches, out locked)'), '고르기가 수정 단추 없는 글 수(locked)를 돌려받지 않는다');
    assert.ok(f.includes('res.Ok = why.Length == 0;'), '실패 사유가 Ok 를 정하지 않는다');
    assert.ok(f.includes('res.ViewNo = NcPickSameWeek('), '고르기가 공용 순수 함수(NcPickSameWeek)가 아니다');
  },

  //  C3. 수정 경로의 성공 문구는 "주간보고 " 로 시작하는 WeekModifyOkMsg 다(웹이 이 머리로 주간 회신을 가른다).
  okMsgPrefix(cs, text) {
    const om = openModify(cs);
    const oks = [...om.matchAll(/NetcusResult\(true,\s*([^;]+)\);/g)].map((m) => m[1]);
    assert.deepStrictEqual(oks, ['WeekModifyOkMsg(hit.Matches)'], `수정 경로의 성공 회신이 WeekModifyOkMsg 하나가 아니다: ${oks}`);
    const body = extractCsMember(text, 'internal static string WeekModifyOkMsg(');
    const first = /"([^"]*)"/.exec(body);
    assert.ok(first && /^주간보고 /.test(first[1]), '수정 경로 성공 문구가 "주간보고 " 로 시작하지 않는다(웹이 일간 회신으로 오인한다)');
  },

  //  C4. 수정 경로는 세 칸만 채운다: 새 글 경로의 채우기(기간, 제목까지 쓰는 fill)를 쓰지 않고, WeekModifyFillJs 는 세 칸 이름만 안다.
  modifyFillsThreeOnly(cs, text) {
    const om = openModify(cs);
    assert.ok(om.includes('WeekModifyFillJs(req.Endwork, req.Content, req.Planwork)'), '수정 경로가 세 칸 채우기(WeekModifyFillJs)를 쓰지 않는다');
    assert.ok(!/ExecuteScriptAsync\(fill\)|set\('/.test(om), '수정 경로가 새 글 경로의 채우기(기간, 제목까지 쓰는 fill)를 쓴다');
    for (const n of ['sdate', 'edate', 'subject', 'wdate', 'ndate', 'notendwork', 'problem', 'resultwork']) {
      assert.ok(!new RegExp(`req\\.(${n})\\b`, 'i').test(om.replace(/_host\.SaveWeeklyReport\([^;]*;/, '').replace(/NcDate\(req\.(Sdate|Edate)[^)]*\)/g, '')),
        `수정 경로가 ${n} 에 요청 값을 쓴다`);
    }
    const fill = extractCsMember(text, 'internal static string WeekModifyFillJs(');
    const names = [...fill.matchAll(/getElementsByName\('([^']+)'\)/g)].map((m) => m[1]).sort();
    assert.deepStrictEqual(names, ['content', 'endwork', 'planwork'], `수정 화면 채우기가 세 칸 밖을 건드린다: ${names}`);
    assert.ok(!/\.value=/.test(fill.replace(/[ecp]\.value=/g, '')), '수정 화면 채우기가 세 칸 말고 다른 값을 쓴다');
  },

  //  C5. 수정 경로의 저장은 성공 통지 뒤에 한 번, 실패 경로들보다 뒤에 있다(새 글 경로는 report-wiring ④).
  modifySaveAfterSuccess(cs) {
    const om = openModify(cs);
    const call = '_host.SaveWeeklyReport(req.Sdate, req.Edate, req.Subject, req.Content, req.Endwork, req.Planwork);';
    const at = om.indexOf(call);
    assert.ok(at > 0, '수정 경로에서 SaveWeeklyReport 호출을 찾지 못했다. 배선이 끊겼다');
    assert.strictEqual(om.split('_host.SaveWeeklyReport(').length - 1, 1, '수정 경로에서 저장을 두 번 이상 부른다');
    const ok = om.indexOf('NetcusResult(true, WeekModifyOkMsg(hit.Matches));');
    assert.ok(ok > 0 && at > ok, '수정 경로의 저장이 성공 통지보다 앞에 있다. 실패한 채우기도 기록된다');
    const lastFail = om.lastIndexOf('NetcusResult(false,');
    assert.ok(lastFail > 0 && at > lastFail, '수정 경로의 저장이 실패 분기보다 앞에 있다');
    const fillFail = om.indexOf('주간보고 수정 화면 채우기 실패');
    assert.ok(fillFail > 0 && fillFail < ok, '채우기 실패 분기가 성공 통지보다 뒤에 있다');
  },

  //  C6. 안전판(Bmodify 대체)을 채우기 전에 끼우고, 못 끼우면 창을 닫고 멈춘다(원래 Bmodify 는 빈 폼으로 기존 글을 덮을 수 있다).
  overrideBeforeFill(cs) {
    const om = openModify(cs);
    const ov = om.indexOf('WeekModifyOverrideJs(hit.ViewNo, id)');
    const fill = om.indexOf('WeekModifyFillJs(');
    assert.ok(ov > 0 && fill > ov, 'Bmodify 안전판을 채우기 뒤에 끼운다(또는 없다)');
    const g = om.indexOf('if (!ovr.StartsWith("ok", StringComparison.Ordinal))');
    assert.ok(g > ov && g < fill, '안전판을 못 끼웠을 때 멈추는 검사가 채우기 앞에 없다');
    const gb = braceSlice(om, g);
    assert.ok(/_w2win\?\.Close\(\)/.test(gb) && /\breturn;/.test(gb), '안전판을 못 끼우면 창을 닫고 멈춰야 한다(원래 Bmodify 가 빈 폼을 보낸다)');
    assert.ok(/Log\("netcus\(week\) Bmodify override: " \+ ovr/.test(om), '원래 Bmodify 의 구조 표지(sig)를 로그로 남기지 않는다');
  },

  //  C10. 채우기 전에 세 칸의 원래 길이만 로그로 남긴다(내용은 남기지 않는다). 검토 3.
  origLenLogged(cs) {
    const om = openModify(cs);
    const at = om.indexOf('await wv.ExecuteScriptAsync(WeekModifyOrigLenJs)');
    const fill = om.indexOf('WeekModifyFillJs(');
    assert.ok(at > 0 && at < fill, '채우기 전에 원래 길이를 읽지 않는다(무엇을 덮었는지 문의 때 알 수 없다)');
    const lg = /Log\(\$"netcus\(week\) 수정 화면 원래 길이[^;]*;/.exec(om);
    assert.ok(lg && lg.index > at && lg.index < fill, '원래 길이를 채우기 전에 로그로 남기지 않는다');
    assert.ok(lg[0].includes('{olen}') && lg[0].includes('req.Endwork.Length') && !/req\.(Endwork|Content|Planwork)[^.]/.test(lg[0]), '길이 로그에 내용이 섞였다(길이만 남긴다)');
  },

  //  C11. 수정 화면 확인 실패도 다른 실패 경로처럼 창을 닫고 멈춘다. 검토 4.
  probeFailClosesWindow(cs) {
    const om = openModify(cs);
    const at = om.indexOf('if (!NcParseModifyProbe(mprobe,');
    assert.ok(at > 0, '수정 화면 확인 실패 분기를 찾지 못했다');
    const b = braceSlice(om, at);
    assert.ok(/_w2win\?\.Close\(\)/.test(b), '수정 화면 확인 실패 때 창을 닫지 않는다');
    assert.ok(b.includes('주간보고 수정 화면을 찾지 못했습니다.') && /\breturn;/.test(b), '수정 화면 확인 실패 때 알리고 멈추지 않는다');
  },

  //  C7. 주간범위 읽기(NetcusWeeklyRangeRead)의 창, 상한, 오류 코드, 회신 모양, 포함 규칙은 그대로다. 순회는 공용 함수를 같은 값으로 부른다.
  rangeReadContract(cs) {
    const r = extractCsMember(cs, 'private async Task NetcusWeeklyRangeRead(');
    assert.ok(r.includes('DateTime winLo = dFrom.AddDays(-7), winHi = dTo.AddDays(7);'), '주간범위 읽기의 작성일 창(from-7 ~ to+7)이 바뀌었다');
    assert.ok(r.includes('const int MAXPAGES = 40, MAXREAD = 60;'), '주간범위 읽기의 상한(40 페이지, 60 건)이 바뀌었다');
    assert.ok(r.includes('NcCrawlWeekly(cw, id, winLo, winHi, MAXPAGES, MAXREAD, "netcus 주간범위",'), '주간범위 읽기가 공용 순회를 같은 창과 상한으로 부르지 않는다');
    const errs = [...new Set([...r.matchAll(/error = "([^"]*)"/g)].map((m) => m[1]))].sort();
    assert.deepStrictEqual(errs, ['', 'busy', 'login', 'no-creds', 'range', 'read', 'session', 'unverified'], `주간범위 읽기 오류 코드가 바뀌었다: ${errs}`);
    assert.ok(r.includes('if (crawl.SessionLost) { HostReply(reqId, new { ok = false, error = "session", weeks = Array.Empty<object>() }); return; }'), '세션 만료 회신(부분 데이터 폐기)이 바뀌었다');
    assert.ok(r.includes('HostReply(reqId, new { ok = true, error = "", weeks });'), '성공 회신 모양이 바뀌었다');
    assert.ok(r.includes('n => NetcusStatus("weekly", "reading", n, -1)'), '진행 표시(weekly reading, total=-1)가 바뀌었다');
    assert.ok(r.includes('if (cell == null) return true;'), '셀을 못 읽은 글을 건너뛰지 않는다(예전 동작과 다르다)');
    assert.ok(r.includes('include = (ps <= dTo && pe >= dFrom);') && r.includes('else include = true;'), '기간 겹침, 파싱 실패 관대 포함 규칙이 바뀌었다');
    assert.ok(r.includes('weeks.Add(new { regdate, title = cell.title ?? "", period = cell.period ?? "", endwork = cell.endwork ?? "", content = cell.content ?? "", plan = cell.plan ?? "" });'), '주간 항목 모양이 바뀌었다');
    assert.ok(!/return false;/.test(r), '주간범위 읽기가 순회를 중간에 끊는다(예전에는 끝까지 돌았다)');
    //  공용 순회 본문의 핵심(예전 인라인 루프와 같은 문장들).
    const c = extractCsMember(cs, 'private async Task<NcCrawlEnd> NcCrawlWeekly(');
    for (const s of [
      'for (int p = 1; p <= maxPages && !capped; p++)',
      'await cw.ExecuteScriptAsync(GoListJs(p, id));',
      'rowsRaw = await cw.ExecuteScriptAsync(RowExtractJs);',
      'if (pwp == "true") { end.SessionLost = true; end.Opened = opened; return end; }',
      'if (regOk && dReg >= winLo) allOlder = false;',
      'if (!regOk || (dReg >= winLo && dReg <= winHi)) candidates.Add((r.viewNo, r.regDate));',
      'if (!anyNew) { end.NoProgress = true; break; }',
      'if (seenViews.Contains(c.viewNo)) continue;',
      'if (opened >= maxRead) { capped = true; Log($"{logTag}: 읽기 상한({maxRead}) 도달 — 중단"); break; }',
      'await cw.ExecuteScriptAsync(GoViewJs(c.viewNo, id));',
      'opened++;',
      'cellRaw = await cw.ExecuteScriptAsync(CellExtractJs);',
      'if (!onCell(c.viewNo, c.regStr, NcParseCell(cellRaw))) { end.Aborted = true; end.Opened = opened; return end; }',
      'if (allOlder) { end.AllOlder = true; break; }',
    ]) assert.ok(c.includes(s), `공용 순회에서 예전 문장이 사라졌다: ${s}`);
    assert.ok(c.indexOf('opened++;') < c.indexOf('onOpened(opened);'), '진행 표시가 열람 수를 올리기 전에 나간다');
  },

  //  C8. 같은 기간 글 찾기의 창과 상한(작성일 sdate-7 ~ edate+14, 40 페이지, 20 건).
  upsertWindow(cs) {
    const f = extractCsMember(cs, 'private async Task<NcSameWeek> NcFindSameWeek(');
    assert.ok(f.includes('const int UPSERT_MAXPAGES = 40, UPSERT_MAXREAD = 20;'), '찾기 상한이 설계(열람 20)와 다르다');
    assert.ok(f.includes('NcCrawlWeekly(cw, id, ds.AddDays(-7), de.AddDays(14), UPSERT_MAXPAGES, UPSERT_MAXREAD,'), '찾기의 작성일 창이 설계(sdate-7 ~ edate+14)와 다르다');
    assert.ok(f.includes('n => NetcusStatus("weekfill", "checking", n, -1)'), '찾는 동안 진행 상태(weekfill checking)를 내지 않는다');
  },

  //  C9. 새로 보이는 문구(호스트가 웹으로 보내는 문구)에 엠 대시, en 대시, 낫표, 가운데 점 구분자가 없다.
  newCopyPunct(cs, text) {
    const om = openModify(cs);
    const w = writePath(cs);
    const from = w.indexOf('NetcusProgress("기존 주간보고 확인 중…");'), to = w.indexOf('var wnav = NavOnce(cw, 15000);');
    assert.ok(from > 0 && to > from, '찾기 구간을 찾지 못했다(판정 불가)');
    const lits = [...(om + w.slice(from, to)).matchAll(/Netcus(?:Result|Progress)\([^"();]*"([^"]*)"/g)].map((m) => m[1]);
    const fail = /internal const string WeekLookupFailMsg = "([^"]*)";/.exec(text);
    assert.ok(fail, 'WeekLookupFailMsg 를 찾지 못했다');
    lits.push(fail[1]);
    for (const m of extractCsMember(text, 'internal static string WeekModifyOkMsg(').matchAll(/"([^"]*)"/g)) lits.push(m[1]);
    assert.ok(lits.length >= 8, `문구를 충분히 찾지 못했다(${lits.length}). 판정 불가`);
    for (const s of lits) assert.ok(!/[—–「」]| · /.test(s), `새 문구에 엠 대시, en 대시, 낫표, 가운데 점 구분자가 있다: ${s}`);
  },
};

test('주간 고치기 C1: 확인 실패(예외 포함)면 창을 닫고 멈춘다. 새 글 작성 화면은 찾기와 분기 뒤에만 열린다', () => checks.lookupFailStops(svc));
test('주간 고치기 C2: 찾기는 세션 만료, 못 읽은 글, 못 읽은 목록, 상한 도달을 "없음" 이 아니라 실패로 본다', () => checks.lookupFailReasons(svc));
test('주간 고치기 C3: 수정 경로 성공 문구는 "주간보고 " 로 시작하는 WeekModifyOkMsg 하나다', () => checks.okMsgPrefix(svc, txt));
test('주간 고치기 C4: 수정 경로는 세 칸만 채운다(기간, 제목, 작성일, 미처리사항, 문제점, 회의내용은 건드리지 않는다)', () => checks.modifyFillsThreeOnly(svc, txt));
test('주간 고치기 C5: 수정 경로의 SaveWeeklyReport 는 성공 통지 뒤에 한 번 불린다', () => checks.modifySaveAfterSuccess(svc));
test('주간 고치기 C6: Bmodify 안전판은 채우기 전에 끼우고, 못 끼우면 창을 닫고 멈춘다', () => checks.overrideBeforeFill(svc));
test('주간 고치기 C7: 주간범위 읽기의 창, 상한, 오류 코드, 회신, 포함 규칙은 그대로다(공용 순회로 옮긴 뒤)', () => checks.rangeReadContract(svc));
test('주간 고치기 C8: 같은 기간 글 찾기의 창은 sdate-7 ~ edate+14, 열람 상한 20 이다', () => checks.upsertWindow(svc));
test('주간 고치기 C9: 새 문구에 엠 대시, en 대시, 낫표, 가운데 점 구분자가 없다', () => checks.newCopyPunct(svc, txt));
test('주간 고치기 C10: 채우기 전에 세 칸의 원래 길이(내용 아님)를 로그로 남긴다', () => checks.origLenLogged(svc));
test('주간 고치기 C11: 수정 화면 확인 실패 때도 창을 닫고 멈춘다', () => checks.probeFailClosesWindow(svc));

// ── 변이(검사가 실제로 잡는가) ──
test('주간 고치기 변이 CM1: 확인 실패 블록의 return 을 빼면 C1 이 잡는다(새 글로 내려가 중복 재발)', () => {
  const bad = mutate(svc, '                    NetcusResult(false, WeekLookupFailMsg);' + NL + '                    return;', '                    NetcusResult(false, WeekLookupFailMsg);');
  assert.throws(() => checks.lookupFailStops(bad), /return 이 없다/);
});
test('주간 고치기 변이 CM2: 실패 검사를 무력화하면 C1 이 잡는다', () => {
  const bad = mutate(svc, 'if (!same.Ok)', 'if (same == null)');
  assert.throws(() => checks.lookupFailStops(bad), /실패 검사가 찾기와 새 글 경로 사이에 없다/);
});
test('주간 고치기 변이 CM3: 찾기 예외를 "없음(Ok=true)" 으로 바꾸면 C1 이 잡는다', () => {
  const bad = mutate(svc, 'same = new NcSameWeek(); }', 'same = new NcSameWeek { Ok = true }; }');
  assert.throws(() => checks.lookupFailStops(bad), /예외가 확인 실패/);
});
test('주간 고치기 변이 CM4: 새 글 경로를 찾기 앞으로 당기면 C1 이 잡는다', () => {
  //  찾기 호출을 새 글 로드 뒤로 옮긴 모양(= 확인 전에 새 글이 열린다).
  let bad = mutate(svc, '                try { same = await NcFindSameWeek(cw, id, req.Sdate, req.Edate); }', '                try { same = new NcSameWeek(); }');
  bad = mutate(bad, '                await wnav;' + NL, '                await wnav;' + NL + '                same = await NcFindSameWeek(cw, id, req.Sdate, req.Edate);' + NL);
  assert.throws(() => checks.lookupFailStops(bad), /새 글 경로가 찾기보다 앞에 있다/);
});
test('주간 고치기 변이 CM5: 못 읽은 보기 화면을 건너뛰게 하면 C2 가 잡는다', () => {
  const bad = mutate(svc, 'why = "보기 화면을 읽지 못함(view_no=" + viewNo + ")"; return false; }', 'return true; }');
  assert.throws(() => checks.lookupFailReasons(bad), /건너뛴다/);
});
test('주간 고치기 변이 CM6: 세션 만료를 실패로 보지 않게 하면 C2 가 잡는다', () => {
  const bad = mutate(svc, 'if (end.SessionLost) why = "세션 만료";', 'if (end.SessionLost) { }');
  assert.throws(() => checks.lookupFailReasons(bad), /세션 만료/);
});
test('주간 고치기 변이 CM7: 상한 도달 실패를 지우면 C2 가 잡는다', () => {
  const bad = mutate(svc, 'if (res.ViewNo.Length == 0 && (end.Capped || !finished))', 'if (false)');
  assert.throws(() => checks.lookupFailReasons(bad), /상한에 닿았는데/);
});
test('주간 고치기 변이 CM8: 성공 문구 머리를 바꾸면 C3 이 잡는다', () => {
  const bad = mutate(txt, 'string m = "주간보고 같은 기간에', 'string m = "같은 기간에');
  assert.throws(() => checks.okMsgPrefix(svc, bad), /"주간보고 " 로 시작하지 않는다/);
  const bad2 = mutate(svc, 'NetcusResult(true, WeekModifyOkMsg(hit.Matches));', 'NetcusResult(true, "기존 글을 열었습니다.");');
  assert.throws(() => checks.okMsgPrefix(bad2, txt), /WeekModifyOkMsg 하나가 아니다/);
});
test('주간 고치기 변이 CM9: 수정 화면 채우기가 기간이나 제목을 건드리면 C4 가 잡는다', () => {
  const bad = mutate(txt, "p=document.getElementsByName('planwork')[0];", "p=document.getElementsByName('planwork')[0],s=document.getElementsByName('subject')[0];");
  assert.throws(() => checks.modifyFillsThreeOnly(svc, bad), /세 칸 밖을 건드린다/);
  const bad2 = mutate(svc, 'var mfilled = await wv.ExecuteScriptAsync(WeekModifyFillJs(req.Endwork, req.Content, req.Planwork));',
    'var mfilled = await wv.ExecuteScriptAsync(WeekModifyFillJs(req.Endwork, req.Content, req.Planwork) + SetJs("subject", req.Subject));');
  assert.throws(() => checks.modifyFillsThreeOnly(bad2, txt), /subject 에 요청 값을 쓴다/);
});
test('주간 고치기 변이 CM10: 수정 경로의 저장을 지우거나 성공 통지 앞으로 옮기면 C5 가 잡는다', () => {
  const call = '                    _host.SaveWeeklyReport(req.Sdate, req.Edate, req.Subject, req.Content, req.Endwork, req.Planwork);';
  assert.ok(svc.includes(call), '수정 경로의 저장 호출(20칸 들여쓰기)을 찾지 못했다');
  const at = svc.lastIndexOf(call);
  const removed = svc.slice(0, at) + '                    // 지워짐' + svc.slice(at + call.length);
  assert.throws(() => checks.modifySaveAfterSuccess(removed), /배선이 끊겼다/);
  const okLine = '                    NetcusResult(true, WeekModifyOkMsg(hit.Matches));';
  const moved = removed.replace('                    var mfilled = ', call + NL + '                    var mfilled = ');
  assert.notStrictEqual(moved, removed);
  assert.ok(moved.includes(okLine));
  assert.throws(() => checks.modifySaveAfterSuccess(moved), /성공 통지보다 앞에 있다|실패 분기보다 앞에 있다/);
});
test('주간 고치기 변이 CM11: 안전판 실패 검사를 지우면 C6 이 잡는다', () => {
  const bad = mutate(svc, 'if (!ovr.StartsWith("ok", StringComparison.Ordinal))', 'if (ovr == null)');
  assert.throws(() => checks.overrideBeforeFill(bad), /멈추는 검사가 채우기 앞에 없다/);
});
test('주간 고치기 변이 CM12: 주간범위 읽기의 상한, 창, 세션 회신을 바꾸면 C7 이 잡는다', () => {
  assert.throws(() => checks.rangeReadContract(mutate(svc, 'const int MAXPAGES = 40, MAXREAD = 60;', 'const int MAXPAGES = 40, MAXREAD = 20;')), /상한/);
  assert.throws(() => checks.rangeReadContract(mutate(svc, 'winHi = dTo.AddDays(7);', 'winHi = dTo.AddDays(14);')), /작성일 창/);
  assert.throws(() => checks.rangeReadContract(mutate(svc, 'if (crawl.SessionLost) { HostReply(reqId, new { ok = false, error = "session", weeks = Array.Empty<object>() }); return; }', '')), /오류 코드가 바뀌었다|세션 만료 회신/);
  assert.throws(() => checks.rangeReadContract(mutate(svc, 'if (cell == null) return true;', 'if (cell == null) return false;')), /건너뛰지 않는다|끊는다/);
  assert.throws(() => checks.rangeReadContract(mutate(svc, 'if (allOlder) { end.AllOlder = true; break; }', 'if (allOlder) { end.AllOlder = true; }')), /예전 문장이 사라졌다/);
});
test('주간 고치기 변이 CM13: 찾기의 창이나 상한을 바꾸면 C8 이 잡는다', () => {
  assert.throws(() => checks.upsertWindow(mutate(svc, 'de.AddDays(14), UPSERT_MAXPAGES', 'de.AddDays(7), UPSERT_MAXPAGES')), /작성일 창/);
  assert.throws(() => checks.upsertWindow(mutate(svc, 'UPSERT_MAXREAD = 20;', 'UPSERT_MAXREAD = 60;')), /찾기 상한/);
});
test('주간 고치기 변이 CM14: 새 문구에 엠 대시를 넣으면 C9 가 잡는다', () => {
  const bad = mutate(svc, '"주간보고 수정 화면 채우기 실패. 페이지', '"주간보고 수정 화면 채우기 실패 — 페이지');
  assert.throws(() => checks.newCopyPunct(bad, txt), /엠 대시/);
});

test('주간 고치기 변이 CM15: "창 끝까지 봤다" 를 늘 참으로 바꾸면(페이지 상한에 닿았는데 못 찾음 = 없음) C2 가 잡는다', () => {
  const bad = mutate(svc, 'bool finished = end.AllOlder || end.NoProgress || end.EmptyPage > 0;', 'bool finished = true;');
  assert.throws(() => checks.lookupFailReasons(bad), /창 끝까지 봤다/);
});
test('주간 고치기 변이 CM16: 수정 단추 표지를 버리고 모든 글을 고칠 수 있다고 넘기면 C2 가 잡는다', () => {
  const bad = mutate(svc, 'found.Add((viewNo, cell.period, cell.mod == "1"));', 'found.Add((viewNo, cell.period, true));');
  assert.throws(() => checks.lookupFailReasons(bad), /수정 단추 표지/);
});
test('주간 고치기 변이 CM17: 원래 길이 읽기를 빼거나 채우기 뒤로 옮기면 C10 이 잡는다', () => {
  const line = 'try { olen = await wv.ExecuteScriptAsync(WeekModifyOrigLenJs) ?? ""; }';
  assert.throws(() => checks.origLenLogged(mutate(svc, line, 'try { olen = ""; }')), /원래 길이를 읽지 않는다/);
  const bad = mutate(svc, 'req.Endwork.Length}', 'req.Endwork}');
  assert.throws(() => checks.origLenLogged(bad), /내용이 섞였다/);
});
test('주간 고치기 변이 CM18: 수정 화면 확인 실패 때 창 닫기를 빼면 C11 이 잡는다', () => {
  const close = '                        try { Dispatcher.Invoke(() => { try { _w2win?.Close(); } catch { } }); } catch { }' + NL + '                        NetcusResult(false, "주간보고 수정 화면을 찾지 못했습니다.';
  const bad = mutate(svc, close, '                        NetcusResult(false, "주간보고 수정 화면을 찾지 못했습니다.');
  assert.throws(() => checks.probeFailClosesWindow(bad), /창을 닫지 않는다/);
});
