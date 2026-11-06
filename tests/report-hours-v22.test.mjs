// DB 구조 22 앱 쪽(docs/DB-V22-REPORT-HOURS.md "앱 변경" 1~7): 일간보고 과제별 줄, 메모, 블록 과제 id, 공식 과제 연결 공수 옮기기, 세 표 삭제.
//
// 이 파일이 지키는 것:
//   (H) 호스트 정적: 일간 저장이 memo 와 줄(cat_uid, project_uid, hours, body)을 한 트랜잭션에 쓴다, 일간 0시간 허용(주간은 그대로 0 초과),
//       reportDailyList detail(memo, lines)을 한 트랜잭션에서 읽는다, 주간 줄에 cat_uid, 새 명령 reportRelink(메인 창만, 보내기와 서로 막기),
//       공수 옮기기 SQL(id 로만, 잠금 순서, 커밋 직전 관문, 24와 168 미리 거절), 지운 세 표를 코드가 부르지 않는다.
//   (P) 호스트 C# 그대로(dotnet 프로브): 일간 줄 합치기(메모만 있는 날, 내용 있는 0시간, 빈 0시간 빼기, 같은 과제 합치기), 다시 만든 글,
//       공수 옮기기 계획(합치기, 가장 작은 line_no, 내용 잇기, 옛 과제 없는 날은 그대로, 다시 돌려도 같음)과 24, 168 넘침 판정.
//   (S) 웹 정적: 작성 중 시간, 서식 저장, state 글꼴이 없다, 글꼴은 tc_rptFont:<계정> localStorage(try/catch), 공식 과제 연결의 순서와 확인 문구.
//   (U) 웹 순수(jsdom 한 번): 보고 줄(atHoursPayload), 블록 과제 id 정하기(하나뿐, 같은 이름 둘, 없음, id 우선, id 로만), 새 보고와 옛 보고 가르기(memo),
//       주간 [일간 불러오기] 두 길(awDailyCollect), 주간 줄 catUid(awHoursPayload), 0시간 블록 허용.
//   (A) 근태 창: 보고한 새 보고를 줄로 되살린다(이름이 바뀐 과제는 id 로 지금 이름), 이전 보고는 detail 로 읽는다, 보내기 payload(memo, 줄),
//       과제 이름이 바뀐 채 보내면 지금 이름으로 보낸다.
//   (W) 위젯 메인 창: 공식 과제로 연결(일정 옮기고 저장 → reportRelink → 성공한 과제만 지움, 실패하면 남기고 알림), 글꼴 저장.
// ★ 실제 DB 리허설(MySQL 8.4)과 이관 조각 시험은 DB 쪽 시험이 맡는다. 여기서는 C# 을 그대로 컴파일한 프로브와 정적 계약으로 본다.
import vm from 'node:vm';
import { test, skip, assert, loadAppSource, extractFunction, extractCsMember, stripCsComments,
         importOptional, countTestsBelow, SKIP_NO_JSDOM, readText } from './harness.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const app = loadAppSource();
const rd = (p) => readText(new URL('../widget/' + p, import.meta.url)).replace(/\r/g, '');
const RDB = rd('ReportDb.cs'), MAIN = rd('MainWindow.xaml.cs'), NET = rd('NetcusService.cs');
const CDB = rd('CalendarDb.cs'), CWDB = rd('CalendarWriteDb.cs'), PDB = rd('ProjectDb.cs');
const code = (s) => stripCsComments(s);
function member(src, sig) { return extractCsMember(src, sig); }
function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다: ' + find.slice(0, 100));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 100));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}

// ══ (H) 호스트 정적 ══════════════════════════════════════════════════════
const H = {
  dailySave(rdb) {
    const s = code(member(rdb, 'public async Task<bool> SaveDailyAsync('));
    assert.ok(/string\? content, string\? memo,/.test(s), 'SaveDailyAsync 가 memo 를 받지 않는다');
    assert.ok(/INSERT INTO cal_report_daily \(user_id, work_date, status, overtime, content, memo, sent_at\)/.test(s) && /memo=VALUES\(memo\)/.test(s),
      '일간 부모 행에 memo 를 쓰지 않는다');
    assert.ok(/AddWithValue\("@mm", memo \?\? ""\)/.test(s), 'memo 가 없을 때 NULL 을 쓴다(NULL 은 옛 보고 표시다)');
    assert.ok(/INSERT INTO cal_report_hours \(user_id, work_date, line_no, task_name, cat_uid, project_uid, hours, body\)/.test(s),
      '일간 줄이 cat_uid, project_uid, body 를 쓰지 않는다');
    assert.ok(!/cat_no/.test(s), '일간 저장에 cat_no 가 남았다');
    assert.ok(/AddWithValue\("@b" \+ lineNo, h\.Body \?\? ""\)/.test(s), '줄 내용이 없을 때 NULL 을 쓴다');
    assert.ok(/var lines = MergeDailyLines\(hours, _log\);/.test(s), '저장 직전에 같은 과제 줄을 합치지 않는다');
    const iDel = s.indexOf('DELETE FROM cal_report_hours'), iIns = s.indexOf('INSERT INTO cal_report_hours'), iCommit = s.indexOf('CommitAsync');
    assert.ok(s.indexOf('BeginTransactionAsync') < iDel && iDel < iIns && iIns < iCommit, '부모, 줄 지우기, 줄 넣기가 한 트랜잭션 순서가 아니다');
    assert.ok(/ComposeDaily\(memo, lines\)[\s\S]*_log\(/.test(s.slice(iCommit)), '저장 뒤 줄로 다시 만든 글과 보낸 글 견주기(로그만)가 없다');
    assert.ok(/internal static bool HoursInDomain\(decimal h\) => h >= 0m && h <= 24m;/.test(rdb), '일간 시간 범위가 0 이상 24 이하가 아니다');
    assert.ok(/internal static bool WeeklyHoursInDomain\(decimal h\) => h > 0m && h <= 168m;/.test(rdb), '주간 시간 범위(0 초과)가 바뀌었다');
    const k = code(member(rdb, 'internal static bool DailyLineKept('));
    assert.ok(/HoursInDomain\(h\) && \(h != 0m \|\| !string\.IsNullOrWhiteSpace\(body\)\)/.test(k), '0시간 줄을 내용이 있을 때만 남기지 않는다');
  },
  weeklySave(rdb) {
    const s = code(member(rdb, 'public async Task<bool> SaveWeeklyAsync('));
    assert.ok(/INSERT INTO cal_report_weekly_hours \(user_id, period_start, line_no, task_name, cat_uid, project_uid, hours\)/.test(s), '주간 줄에 cat_uid 를 쓰지 않는다');
    assert.ok(/CatUidOrNull\(h\.CatUid\)/.test(s), '주간 줄 cat_uid 를 거르지 않는다');
  },
  dailyList(rdb, main) {
    const s = code(member(rdb, 'public async Task<List<Dictionary<string, object?>>?> ListDailyAsync('));
    assert.ok(/bool withLines = false/.test(s), 'ListDailyAsync 에 줄 싣기(withLines) 갈래가 없다');
    const tx = s.indexOf('BeginTransactionAsync'), p = s.indexOf('FROM cal_report_daily'), l = s.indexOf('FROM cal_report_hours'), c = s.indexOf('CommitAsync');
    assert.ok(tx > 0 && tx < p && p < l && l < c, '부모와 줄을 한 트랜잭션(같은 스냅숏)에서 읽지 않는다');
    assert.ok(/row\["memo"\] = r\.IsDBNull\(5\) \? null : r\.GetString\(5\);/.test(s), 'memo 가 NULL 이면 null(옛 보고)로 주지 않는다');
    assert.ok(/row\["memo"\] == null\) continue;/.test(s), '옛 보고 날짜에 줄을 붙인다(규칙은 memo 하나)');
    for (const k of ['catUid', 'projectUid', 'name', 'hours', 'body']) assert.ok(s.includes(`["${k}"] =`), `줄에 ${k} 가 없다`);
    assert.ok(/if \(withLines\)/.test(s), 'detail 이 아닐 때도 memo, 줄을 싣는다(달력 목록은 가볍게)');
    const m = code(main);
    assert.ok(/RunReportDailyListAsync\(rq, GetStr\(doc, "from"\), GetStr\(doc, "to"\),\s*doc\.RootElement\.TryGetProperty\("detail", out var dtEl\) && dtEl\.ValueKind == JsonValueKind\.True\)/.test(m),
      'reportDailyList 가 detail 을 넘기지 않는다');
  },
  relinkCmd(main) {
    const m = code(main);
    assert.ok(/case "reportRelink":[^\n]*\n\s*if \(fromWin == null\) _ = RunReportRelinkAsync\(rq, GetStr\(doc, "catId"\), GetStr\(doc, "projectUid"\)\);/.test(m),
      'reportRelink 이 메인 창만 받는 명령이 아니다');
    const ns = m.indexOf('case "netcusSubmit":'), ws = m.indexOf('case "netcusWeekSubmit":');
    assert.ok(/if \(!RelinkBlocksSend\(\)\) _ = _netcus\.SubmitDaily\(/.test(m.slice(ns, ns + 1200)), '연결 중에 일간 보내기를 막지 않는다');
    assert.ok(/if \(!RelinkBlocksSend\(\)\) _ = _netcus\.WeekFill\(/.test(m.slice(ws, ws + 300)), '연결 중에 주간 보내기를 막지 않는다');
    assert.ok(/if \(!_reportRelinkBusy\) return false;\s*ReportPush\("window\.__netcusResult && window\.__netcusResult\(false,"/.test(code(member(main, 'private bool RelinkBlocksSend('))), '막을 때 두 창에 실패를 알리지 않는다');
    const r = code(member(main, 'private async Task RunReportRelinkAsync('));
    assert.ok(/if \(_reportRelinkBusy \|\| _netcus\.IsBusy\)/.test(r), '보내는 중에 연결을 막지 않는다');
    assert.ok(/_reportRelinkBusy = true;[\s\S]*finally \{ _reportRelinkBusy = false; \}/.test(r), '연결 중 표시를 finally 로 풀지 않는다');
    assert.ok(/db\.RelinkHoursAsync\(loginId, catId, projectUid\)/.test(r) && /CurrentLoginId\(\)/.test(r), '사람을 세션에서 읽지 않거나 공수 옮기기를 부르지 않는다');
    assert.ok(!/"reportRelink"/.test(m.slice(m.indexOf('AttendWinCommands'), m.indexOf('AttendWinCommands') + 900)), '근태 창이 reportRelink 를 보낼 수 있다');
  },
  relinkSql(rdb) {
    const s = code(member(rdb, 'public async Task<(bool ok, string msg, int daily, int weekly)> RelinkHoursAsync('));
    assert.ok(/OpenWriteAsync\(ct\)/.test(s) && /DbGate\.OpenAsync\(BuildConnString\(\), ct\)/.test(code(member(rdb, 'private static async Task<MySqlConnection> OpenWriteAsync('))),
      '공수 옮기기가 관문(DbGate.OpenAsync)으로 열지 않는다');
    assert.ok(/oldCat\.StartsWith\("db-", StringComparison\.Ordinal\)/.test(s) && /!ProjectUidOk\(uid\)/.test(s), '옛 과제 id 와 공식 uid 를 거르지 않는다');
    assert.ok(/FROM project WHERE uid=@p/.test(s), '공식 이름을 호스트가 project 에서 읽지 않는다');
    const order = ['FROM cal_report_daily WHERE', 'FROM cal_report_hours WHERE user_id=@u AND cat_uid IN (@o, @n)', 'FROM cal_report_weekly WHERE', 'FROM cal_report_weekly_hours WHERE user_id=@u AND cat_uid IN (@o, @n)'];
    let at = -1;
    for (const o of order) { const i = s.indexOf(o); assert.ok(i > at, '잠금 순서가 일간 부모, 일간 줄, 주간 부모, 주간 줄이 아니다: ' + o); at = i; }
    assert.strictEqual((s.match(/FOR UPDATE/g) || []).length, 4, '네 읽기가 모두 FOR UPDATE 가 아니다');
    assert.ok(!/task_name\s*=\s*@|task_name IN|task_name LIKE/.test(s.replace('SET cat_uid=@n, project_uid=@p, task_name=@t', '')), '이름으로 줄을 찾는다(id 로만 찾아야 한다)');
    assert.ok(/RelinkOver\(dRows, oldCat, 24m\)/.test(s) && /RelinkOver\(wRows, oldCat, 168m\)/.test(s), '24, 168 넘침을 미리 거절하지 않는다');
    const over = s.indexOf('RelinkOver(dRows'), apply = s.indexOf('RelinkApplyAsync(conn, tx, "cal_report_hours"');
    assert.ok(over > 0 && over < apply, '넘침 검사가 쓰기보다 뒤에 있다');
    const gate = s.indexOf('DbGate.ReadMetaAsync(conn, tx, ct)'), commit = s.indexOf('await tx.CommitAsync(ct)');
    assert.ok(gate > apply && gate < commit && /DbGate\.Observe\(gateMeta\) != GateVerdict\.Ok/.test(s), '커밋 직전에 구조 번호를 다시 보지 않는다');
    const ap = code(member(rdb, 'private static async Task<int> RelinkApplyAsync('));
    assert.ok(/SET cat_uid=@n, project_uid=@p, task_name=@t, hours=@h/.test(ap) && /WHERE user_id=@u AND " \+ keyCol \+ "=@k AND line_no=@l/.test(ap), '옮기기 UPDATE 가 키 칸 조건이 아니다');
    assert.ok(/"DELETE FROM " \+ table \+ " WHERE user_id=@u AND " \+ keyCol \+ "=@k AND line_no=@l"/.test(ap), '합친 줄 지우기에 키 칸 조건이 없다');
  },
  droppedTables(srcs) {
    for (const [name, s] of srcs) {
      const c = code(s);
      for (const t of ['cal_task_hours', 'cal_user_pref', 'cal_migration_log']) assert.ok(!c.includes(t), `${name} 코드가 지운 표 ${t} 를 부른다(배포 뒤 "표 없음")`);
    }
    const st = code(member(CDB, 'public async Task<CalendarSnapshot?> LoadSnapshotAsync('));
    assert.ok(!/taskHours|reportFormatPrefs|reportFont|reportMarker/.test(code(CDB)), '부팅 state 에 작성 중 시간이나 서식이 남았다');
    assert.ok(st.length > 0);
    assert.ok(!/taskHours|PrefParams|reportFormatPrefs/.test(code(CWDB)), '캘린더 저장이 작성 중 시간이나 서식을 쓴다');
  },
};
test('(H) 일간 저장: memo 와 과제별 줄(cat_uid, project_uid, hours, body)을 한 트랜잭션에, 0시간은 내용이 있을 때만, 다시 만든 글은 로그만', () => H.dailySave(RDB));
test('(H) 주간 저장: 줄에 cat_uid', () => H.weeklySave(RDB));
test('(H) reportDailyList detail: memo(NULL = 옛 보고)와 줄을 한 트랜잭션(같은 스냅숏)에서, 옛 보고 날짜에는 줄을 붙이지 않는다', () => H.dailyList(RDB, MAIN));
test('(H) reportRelink: 메인 창만, 세션의 사람, 보내기와 서로 막는다', () => H.relinkCmd(MAIN));
test('(H) 공수 옮기기 SQL: 관문으로 열고, id 로만 찾고, 잠금 순서, 24와 168 미리 거절, 커밋 직전 관문, 키 칸 조건', () => H.relinkSql(RDB));
test('(H) 지운 세 표(작성 중 시간, 서식, 이관 기록)를 호스트 코드가 부르지 않는다', () =>
  H.droppedTables([['CalendarDb', CDB], ['CalendarWriteDb', CWDB], ['ProjectDb', PDB], ['ReportDb', RDB], ['MainWindow', MAIN], ['NetcusService', NET]]));
test('(H) 변이: 일간 memo 를 NULL 로 쓰면, 줄의 잠금 순서를 바꾸면, 넘침 검사를 빼면, 관문 재확인을 빼면 잡는다', () => {
  assert.throws(() => H.dailySave(mutate(RDB, 'AddWithValue("@mm", memo ?? "")', 'AddWithValue("@mm", (object?)memo ?? DBNull.Value)')), /NULL 을 쓴다/);
  const swapped = mutate(RDB, '"SELECT period_start FROM cal_report_weekly WHERE user_id=@u AND period_start IN " +', '"SELECT period_start FROM cal_report_weekly_x WHERE user_id=@u AND period_start IN " +');
  assert.throws(() => H.relinkSql(swapped), /잠금 순서/);
  assert.throws(() => H.relinkSql(mutate(RDB, 'string? overDay = RelinkOver(dRows, oldCat, 24m), overWeek = RelinkOver(wRows, oldCat, 168m);', 'string? overDay = null, overWeek = null;')), /미리 거절/);
  assert.throws(() => H.relinkSql(mutate(RDB, 'var gateMeta = await DbGate.ReadMetaAsync(conn, tx, ct);\n                if (DbGate.Observe(gateMeta) != GateVerdict.Ok)', 'var gateMeta = (object?)null;\n                if (false)')), /구조 번호/);
  assert.throws(() => H.relinkCmd(mutate(MAIN, 'if (fromWin == null) _ = RunReportRelinkAsync(', '_ = RunReportRelinkAsync(')), /메인 창만/);
  assert.throws(() => H.droppedTables([['ProjectDb', mutate(PDB, '"cal_category", "cal_entry", "cal_todo",', '"cal_category", "cal_entry", "cal_todo", "cal_task_hours",')]]), /cal_task_hours/);
});

// ══ (P) 호스트 C# 그대로(dotnet 프로브) ════════════════════════════════════
const dotnetOk = (() => { const r = spawnSync('dotnet', ['--version'], { windowsHide: true, timeout: 120000 }); return !r.error && r.status === 0; })();
let PROBE = null;
function probe() {
  if (PROBE) return PROBE;
  const sigs = ['internal static bool HoursInDomain(', 'internal static bool DailyLineKept(', 'internal static string? CatUidOrNull(', 'internal static bool ProjectUidOk(',
    'internal static string? ProjectUidFor(', 'internal static List<ReportHourLine> MergeDailyLines(', 'internal static string ComposeDaily(', 'internal static string NormText(',
    'internal sealed class RelinkRow', 'internal sealed class RelinkStep', 'internal static string? RelinkOver(', 'internal static List<RelinkStep> RelinkPlan('];
  const body = sigs.map((s) => member(RDB, s)).join('\n  ');
  const line = member(RDB, 'internal sealed class ReportHourLine');
  const dir = join(tmpdir(), `tc-v22-probe-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch (_) { } });
  writeFileSync(join(dir, 'Program.cs'), `using System; using System.Collections.Generic; using System.Globalization; using System.Text.Json;
${line}
static class R {
  ${body}
}
static class P {
  static string? S(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
  static object? Run(JsonElement c) {
    switch (c.GetProperty("fn").GetString()) {
      case "merge": {
        var L = new List<ReportHourLine>();
        foreach (var x in c.GetProperty("lines").EnumerateArray())
          L.Add(new ReportHourLine { TaskName = S(x, "name") ?? "", CatUid = S(x, "cat"), ProjectUid = S(x, "puid"), Hours = x.GetProperty("h").GetDecimal(), Body = S(x, "body") ?? "" });
        var outL = new List<object?>();
        foreach (var l in R.MergeDailyLines(L)) outL.Add(new object?[] { l.TaskName, l.CatUid, l.ProjectUid, l.Hours.ToString("0.##", CultureInfo.InvariantCulture), l.Body });
        if (c.TryGetProperty("memo", out var mm)) return new object?[] { outL, R.ComposeDaily(mm.GetString(), R.MergeDailyLines(L)) };
        return outL;
      }
      case "plan": case "over": {
        var rows = new List<R.RelinkRow>();
        foreach (var x in c.GetProperty("rows").EnumerateArray())
          rows.Add(new R.RelinkRow { Key = S(x, "k") ?? "", LineNo = x.GetProperty("l").GetInt32(), CatUid = S(x, "cat") ?? "", Hours = x.GetProperty("h").GetDecimal(), Body = S(x, "body") });
        string old = S(c, "old") ?? "";
        if (c.GetProperty("fn").GetString() == "over") return R.RelinkOver(rows, old, c.GetProperty("max").GetDecimal());
        var outP = new List<object?>();
        foreach (var st in R.RelinkPlan(rows, old, c.GetProperty("body").GetBoolean()))
          outP.Add(new object?[] { st.Key, st.KeepLine, st.Hours.ToString("0.##", CultureInfo.InvariantCulture), st.Body, st.DropLines, st.Olds });
        return outP;
      }
      case "kept": return R.DailyLineKept(S(c, "name"), c.GetProperty("h").GetDecimal(), S(c, "body"));
      case "puid": return R.ProjectUidFor(S(c, "cat"), S(c, "puid"));
    }
    return null;
  }
  static int Main(string[] a) {
    var cases = JsonDocument.Parse(System.IO.File.ReadAllText(a[0])).RootElement;
    var outv = new List<object?>();
    foreach (var c in cases.EnumerateArray()) outv.Add(Run(c));
    System.IO.File.WriteAllText(a[1], JsonSerializer.Serialize(outv));
    return 0;
  }
}
`, 'utf8');
  writeFileSync(join(dir, 'nuget.config'), '<?xml version="1.0" encoding="utf-8"?>\n<configuration><packageSources><clear /></packageSources></configuration>\n', 'utf8');
  writeFileSync(join(dir, 'probe.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable><LangVersion>latest</LangVersion><ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>tc-v22-probe</AssemblyName><SatelliteResourceLanguages>en</SatelliteResourceLanguages>
    <TargetLatestRuntimePatch>false</TargetLatestRuntimePatch>
  </PropertyGroup>
</Project>
`, 'utf8');
  const b = spawnSync('dotnet', ['build', join(dir, 'probe.csproj'), '-c', 'Release', '-v', 'q', '--nologo'],
    { cwd: dir, windowsHide: true, timeout: 420000, maxBuffer: 64 * 1024 * 1024 });
  const exe = join(dir, 'bin', 'Release', 'net9.0', 'tc-v22-probe.exe');
  if (b.error || b.status !== 0 || !existsSync(exe)) {
    const out = (b.stdout || '').toString('utf8') + (b.stderr || '').toString('utf8');
    throw new Error('구조 22 프로브 빌드 실패:\n' + (out.split('\n').filter((l) => /error|오류/i.test(l)).slice(0, 12).join('\n') || out.slice(-1500)));
  }
  PROBE = { exe, dir };
  return PROBE;
}
function cs(cases) {
  const { exe, dir } = probe();
  const inF = join(dir, 'in.json'), outF = join(dir, 'out.json');
  writeFileSync(inF, JSON.stringify(cases), 'utf8');
  const r = spawnSync(exe, [inF, outF], { windowsHide: true, timeout: 120000 });
  if (r.error || r.status !== 0) throw new Error('구조 22 프로브 실행 실패: ' + (r.error ? r.error.message : (r.stderr || '').toString('utf8')));
  return JSON.parse(readFileSync(outF, 'utf8'));
}
const U1 = '0a1b2c3d-0000-4000-8000-00000000000a', U2 = '0a1b2c3d-0000-4000-8000-00000000000b';
if (!dotnetOk) {
  skip('구조 22 호스트 C# 프로브(일간 줄 합치기, 공수 옮기기 계획) 시험 전부', 'dotnet 없음', 'C# 을 그대로 컴파일해 판정하는 시험이라 JS 사본으로 대신하지 않는다');
} else {
  test('(P) 일간 줄(C#): 메모만 있는 날은 줄 0, 내용 있는 0시간은 남고 빈 0시간은 빠진다, 같은 과제 id 는 한 줄(시간 합, 내용 잇기), id 없는 줄은 합치지 않는다, 공식 uid', () => {
    const [memoOnly, zero, merge, [lines, composed], kept, puid] = cs([
      { fn: 'merge', lines: [] },
      { fn: 'merge', lines: [{ name: '알파', cat: 'c-a', h: 0, body: '- 회의만' }, { name: '베타', cat: 'c-b', h: 0, body: '  ' }, { name: '감마', cat: 'c-c', h: 2, body: '' }, { name: '  ', cat: 'c-d', h: 1, body: 'x' }, { name: '델타', cat: 'c-e', h: 25, body: 'x' }] },
      { fn: 'merge', lines: [{ name: '알파', cat: 'c-a', h: 2, body: '- 첫째' }, { name: '미정', cat: null, h: 1, body: 'a' }, { name: '알파(새 이름)', cat: 'c-a', h: 1.5, body: '- 둘째' }, { name: '미정', cat: null, h: 1, body: 'b' }, { name: '공식', cat: 'db-' + U1, h: 3, body: '' }] },
      { fn: 'merge', memo: '* 대전 출장', lines: [{ name: '알파', cat: 'c-a', h: 6, body: '  - 한 일' }, { name: '베타', cat: 'c-b', h: 0, body: '- 메모' }] },
      { fn: 'kept', name: '알파', h: 0, body: '' },
      { fn: 'puid', cat: 'db-' + U2, puid: '' },
    ]);
    assert.deepStrictEqual(memoOnly, [], '메모만 있는 날에 줄이 생겼다');
    assert.deepStrictEqual(zero, [['알파', 'c-a', null, '0', '- 회의만'], ['감마', 'c-c', null, '2', '']], '0시간 줄 규칙이 다르다(내용 있는 0시간만 남고, 이름 없음과 24 넘침은 빠진다)');
    assert.deepStrictEqual(merge, [['알파', 'c-a', null, '3.5', '- 첫째\n- 둘째'], ['미정', null, null, '1', 'a'], ['미정', null, null, '1', 'b'], ['공식', 'db-' + U1, U1, '3', '']],
      '같은 과제 id 블록 합치기가 다르다');
    assert.deepStrictEqual(lines.map((l) => l[0]), ['알파', '베타']);
    assert.strictEqual(composed, '* 대전 출장\n\n[알파] : 6\n  - 한 일\n\n[베타] : 0\n- 메모', '줄로 다시 만든 글이 회사 글 꼴과 다르다');
    assert.strictEqual(kept, false, '내용 없는 0시간 줄을 남긴다');
    assert.strictEqual(puid, U2, "과제 id 'db-<uid>' 에서 공식 uid 를 읽지 않는다");
  });

  test('(P) 공수 옮기기 계획(C#): id 로만(같은 이름 다른 공식 과제 줄은 그대로), 같은 날 대상 줄과 합치기(가장 작은 line_no, 시간 합, 내용 잇기), 옛 과제 없는 날은 그대로, 다시 돌리면 할 일 없음', () => {
    const OLD = 'c-old', NEW = 'db-' + U1;
    const rows = [
      { k: '2026-11-02', l: 0, cat: OLD, h: 2, body: '- 옛 과제 일' },
      { k: '2026-11-03', l: 0, cat: NEW, h: 3, body: '- 공식 과제 일' }, { k: '2026-11-03', l: 2, cat: OLD, h: 1.5, body: null }, { k: '2026-11-03', l: 4, cat: OLD, h: 0, body: '- 0시간 메모' },
      { k: '2026-11-04', l: 1, cat: NEW, h: 5, body: '- 대상만 있는 날' },
    ];
    const [plan, weekPlan, rerun] = cs([
      { fn: 'plan', rows, old: OLD, body: true },
      { fn: 'plan', rows: [{ k: '2026-11-02', l: 3, cat: OLD, h: 10, body: null }, { k: '2026-11-02', l: 1, cat: NEW, h: 20, body: null }], old: OLD, body: false },
      { fn: 'plan', rows: [{ k: '2026-11-02', l: 0, cat: NEW, h: 2, body: 'x' }], old: OLD, body: true },
    ]);
    assert.deepStrictEqual(plan, [
      ['2026-11-02', 0, '2', '- 옛 과제 일', [], 1],
      ['2026-11-03', 0, '4.5', '- 공식 과제 일\n- 0시간 메모', [2, 4], 2],
    ], '일간 옮기기 계획이 다르다(대상만 있는 날은 건드리지 않아야 한다)');
    assert.deepStrictEqual(weekPlan, [['2026-11-02', 1, '30', null, [3], 1]], '주간 옮기기 계획이 다르다(가장 작은 line_no 를 남기고 내용은 없다)');
    assert.deepStrictEqual(rerun, [], '옮길 줄이 없는데(다시 보내기) 할 일이 생겼다');
  });

  test('(P) 넘침 판정(C#): 합친 하루가 24, 한 주가 168 을 넘으면 그 날(주)을 돌려준다(옛 과제가 없는 날은 보지 않는다)', () => {
    const OLD = 'c-old', NEW = 'db-' + U1;
    const [d1, d2, w1, w2] = cs([
      { fn: 'over', old: OLD, max: 24, rows: [{ k: '2026-11-03', l: 0, cat: NEW, h: 20 }, { k: '2026-11-03', l: 1, cat: OLD, h: 4 }, { k: '2026-11-04', l: 0, cat: NEW, h: 24 }] },
      { fn: 'over', old: OLD, max: 24, rows: [{ k: '2026-11-03', l: 0, cat: NEW, h: 20 }, { k: '2026-11-03', l: 1, cat: OLD, h: 4.5 }] },
      { fn: 'over', old: OLD, max: 168, rows: [{ k: '2026-11-02', l: 0, cat: NEW, h: 100 }, { k: '2026-11-02', l: 1, cat: OLD, h: 68 }] },
      { fn: 'over', old: OLD, max: 168, rows: [{ k: '2026-11-02', l: 0, cat: NEW, h: 100 }, { k: '2026-11-02', l: 1, cat: OLD, h: 68.5 }] },
    ]);
    assert.strictEqual(d1, null, '딱 24 를 넘침으로 봤거나 옛 과제 없는 날을 봤다');
    assert.strictEqual(d2, '2026-11-03', '24 넘침을 잡지 않는다');
    assert.strictEqual(w1, null, '딱 168 을 넘침으로 봤다');
    assert.strictEqual(w2, '2026-11-02', '168 넘침을 잡지 않는다');
  });
}

// ══ (S) 웹 정적 ═════════════════════════════════════════════════════════
const S = {
  noDropped(src) {
    for (const w of ['taskHours', 'getTaskHours', 'setTaskHours', 'loadTaskHoursMap', 'dropCatHours', 'reportDailyHours', 'normalizeReportFormatPrefs', 'updateCurrentReportFormatPref', 'syncLegacyReportFormatFields'])
      assert.ok(!new RegExp('\\b' + w + '\\s*\\(|\\.' + w + '\\b|\\b' + w + '\\s*:').test(src), `웹에 ${w} 가 남았다`);
    assert.ok(!/state\.reportFont|state\.reportMarker|state\.reportIndent|state\.reportFormatPrefs/.test(src), 'state 에 서식이나 글꼴이 남았다');
    assert.ok(!/getElementsByTagName\('prefs'\)|createElement\('prefs'\)|createElement\('taskHours'\)/.test(src), '옛 XML <prefs>, <taskHours> 를 읽거나 쓴다');
    assert.ok(/function buildStateFrom\(data\)\{[\s\S]*?return \{categories:data\.categories, entries:data\.entries, todos:data\.todos\|\|\[\], reportSource:'cal', attendance:data\.attendance\|\|\{\}\};/.test(src),
      'buildStateFrom 이 서식이나 작성 중 시간을 state 에 싣는다');
  },
  font(src) {
    assert.ok(/const RPT_FONT_PREFIX = 'tc_rptFont:';/.test(src), '글꼴 키가 tc_rptFont: 가 아니다');
    const g = extractFunction(src, 'reportFontGet'), s = extractFunction(src, 'reportFontSet');
    assert.ok(/try\{[\s\S]*localStorage\.getItem\(rptFontKey\(\)\)[\s\S]*\}catch\(_\)\{ return defaultReportFont\(\); \}/.test(g), '글꼴 읽기가 try/catch 로 기본값에 떨어지지 않는다');
    assert.ok(/try\{[\s\S]*localStorage\.(setItem|removeItem)\(rptFontKey\(\)[\s\S]*\}catch\(_\)\{\}/.test(s), '글꼴 쓰기가 try/catch 가 아니다');
    assert.ok(/atWho\(\)/.test(extractFunction(src, 'rptFontKey')), '글꼴 키가 계정별이 아니다');
    assert.ok(/reportFontSet\(\{ family: _ff\.value, size: reportFontGet\(\)\.size \}\); buildReport\(\);/.test(src), '글꼴 고르기가 localStorage 에 쓰지 않는다');
  },
  relink(src) {
    const f = extractFunction(src, 'runRelink');
    assert.ok(f.includes('원래 과제는 지웁니다'), '확인 창 문구에 "원래 과제는 지웁니다" 가 없다');
    const mv = f.indexOf('catMoveRefs(fromId, toId)'), sv = f.indexOf('save();', mv), rq = f.indexOf("hostRequest('reportRelink'"), del = f.indexOf('deleteCategory(fromId)');
    assert.ok(mv > 0 && sv > mv && rq > sv && del > rq, '순서가 일정과 할 일 옮기기, 저장, 공수 옮기기, 옛 과제 지우기가 아니다');
    assert.ok(/if\(ok && deleteCategory\(fromId\)\) done\+\+;/.test(f), '공수 옮기기가 실패해도 옛 과제를 지운다');
    assert.ok(/catMoveRefs\(fromId, toId\)/.test(extractFunction(src, 'moveCategoryData')), '합치기와 연결이 같은 옮기기(catMoveRefs)를 쓰지 않는다');
  },
};
test('(S) 웹: 작성 중 시간, 서식 저장, state 글꼴, 옛 XML <prefs>, <taskHours> 가 없다', () => S.noDropped(app));
test('(S) 웹: 보고 글꼴은 계정별 localStorage(tc_rptFont:<계정>), 읽기와 쓰기 모두 try/catch', () => S.font(app));
test('(S) 웹: 공식 과제로 연결 순서(옮기기, 저장, reportRelink, 성공한 과제만 지움)와 확인 문구', () => S.relink(app));
test('(S) 변이: 연결이 실패해도 옛 과제를 지우거나, 글꼴을 state 에 두거나, 확인 문구를 빼면 잡는다', () => {
  assert.throws(() => S.relink(mutate(app, 'if(ok && deleteCategory(fromId)) done++;', 'if(deleteCategory(fromId)) done++;')), /실패해도 옛 과제를 지운다/);
  assert.throws(() => S.relink(mutate(app, '원래 과제는 지웁니다. 계속할까요?', '계속할까요?')), /원래 과제는 지웁니다/);
  assert.throws(() => S.noDropped(app + '\nstate.reportFont = 1;'), /서식이나 글꼴/);
});

// ══ (U)(A)(W) jsdom ═════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod && jsdomMod.JSDOM;
if (!JSDOM) {
  skip('report-hours-v22: jsdom 미설치, 웹 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  function boot(src, url, host) {
    const posted = [], errors = [];
    const vc = new jsdomMod.VirtualConsole();
    vc.on('jsdomError', (e) => { const s = String(e && (e.stack || e.message) || e); if (!/Not implemented/.test(s)) errors.push(s); });
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc,
      beforeParse(win) {
        if (host) win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posted.push(o || { raw: String(m) }); }, addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {}; win.HTMLElement.prototype.scrollIntoView = function () {}; win.open = () => null;
        win.__realClose = win.close; win.close = function () {};
      },
    });
    const w = dom.window;
    return { w, doc: w.document, posted, errors, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      $: (s) => w.document.querySelector(s), close: () => { try { w.__realClose.call(w); } catch (_) {} } };
  }
  const stubHost = (X, rep) => X.ev(`window.__calls = []; window.__rep = ${rep || '{}'};
    hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
      var r = __rep[cmd]; if(typeof r === 'function') r = r(p);
      return Promise.resolve(r === undefined ? { ok:false, error:'시험: 회신 없음' } : JSON.parse(JSON.stringify(r))); };`);
  const CA = '2026-07-01T00:00:00.000Z';
  const CATS = [
    { id: 'c-a', name: '알파', color: '#3e5be0', desc: '', createdAt: CA },
    { id: 'c-b', name: '베타', color: '#2e9e6b', desc: '', createdAt: CA },
    { id: 'c-d1', name: '중복', color: '#d97706', desc: '', createdAt: CA },
    { id: 'c-d2', name: '중복', color: '#5b6b7d', desc: '', createdAt: CA },
  ];
  const stateFor = () => ({ categories: CATS.map((c) => Object.assign({}, c)), entries: [], todos: [], attendance: {} });
  function bootBrowser() {
    const X = boot(app, 'https://tcapp.local/', false);
    X.T = X.ev('todayYmd()');
    X.ev('state = ' + JSON.stringify(stateFor()) + ';');
    X.ev("(function(){ for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k && (k.indexOf('tc_attDraft:')===0 || k.indexOf('tc_rptFont:')===0)) localStorage.removeItem(k); } })()");
    return X;
  }
  const ALL = CATS.map((c) => ({ key: c.id, name: c.name }));

  test('(U) 보고 줄(atHoursPayload): 메모만 있는 날은 줄 0, 내용 있는 0시간은 남고 빈 0시간은 빠진다, 같은 과제 id 는 한 줄, 공식 uid, 0시간 블록은 막지 않는다', () => {
    const X = bootBrowser();
    try {
      const P = (b) => X.evJSON(`atHoursPayload(${JSON.stringify(b)})`);
      assert.deepStrictEqual(P([]), [], '블록이 없는데 줄이 생겼다');
      assert.deepStrictEqual(P([{ name: '알파', catId: 'c-a', hours: 0, text: '\n- 회의만  \n' }, { name: '베타', catId: 'c-b', hours: 0, text: '  ' }]),
        [{ name: '알파', catUid: 'c-a', projectUid: null, hours: 0, body: '- 회의만' }], '0시간 블록 규칙이 다르다');
      assert.deepStrictEqual(P([{ name: '알파', catId: 'c-a', hours: 2, text: '- 첫째' }, { name: '알파', catId: 'c-a', hours: 1.25, text: '- 둘째' }, { name: '공식', catId: 'db-' + U1, hours: 3, text: '' }, { name: '', catId: null, hours: 1, text: '미정' }]),
        [{ name: '알파', catUid: 'c-a', projectUid: null, hours: 3.25, body: '- 첫째\n- 둘째' }, { name: '공식', catUid: 'db-' + U1, projectUid: U1, hours: 3, body: '' }], '같은 과제 id 합치기나 공식 uid 가 다르다');
      assert.strictEqual(X.ev("atBlockProblem({ name: '알파', hours: 0, text: '- 한 일' })"), '', '내용이 있는 0시간 블록을 막는다');
      assert.strictEqual(X.ev("atCompose([{ name: '알파', hours: 0, text: '- 한 일' }], '')"), '[알파] : 0\n- 한 일', '회사로 [과제] : 0 아래 내용이 나가지 않는다');
    } finally { X.close(); }
  });

  test('(U) 블록 과제 id: 이름이 하나뿐이면 그 id, 같은 이름 둘이나 없으면 과제 미정, id 가 있으면 id 로(이름이 바뀌어도), idOnly 는 이름으로 찾지 않는다', () => {
    const X = bootBrowser();
    try {
      const K = (b, opt) => X.evJSON(`atBlocksKnown(${JSON.stringify(b)}, ${JSON.stringify(ALL)}${opt ? ', ' + JSON.stringify(opt) : ''})`).map((x) => [x.name, x.catId, x.text]);
      assert.deepStrictEqual(K([{ name: '알파', hours: 1, text: 'a' }]), [['알파', 'c-a', 'a']], '이름이 하나뿐인데 id 를 싣지 않았다');
      assert.deepStrictEqual(K([{ name: '중복', hours: 1, text: 'a' }]), [['', null, '[중복] : 1\na']], '같은 이름이 둘인데 하나를 골랐다');
      assert.deepStrictEqual(K([{ name: '모름', hours: 2, text: '' }]), [['', null, '[모름] : 2']], '없는 이름이 과제 미정이 아니다');
      assert.deepStrictEqual(K([{ name: '옛 이름', catId: 'c-b', hours: 1, text: 'b' }]), [['베타', 'c-b', 'b']], 'id 로 찾아 지금 이름으로 바꾸지 않는다');
      assert.deepStrictEqual(K([{ name: '중복', catId: 'c-d2', hours: 1, text: '' }]), [['중복', 'c-d2', '']], '같은 이름이 둘이어도 id 가 있으면 그 과제다');
      assert.deepStrictEqual(K([{ name: '알파', catId: null, hours: 1, text: '' }], { idOnly: true }), [['', null, '[알파] : 1']], 'idOnly 인데 이름으로 찾았다');
      assert.deepStrictEqual(K([{ name: '알파', catId: 'c-a', hours: 1, text: '' }, { name: '알파', catId: 'c-a', hours: 2, text: '' }]).map((x) => x[1]), ['c-a', null], '같은 과제의 두 번째 블록이 미정이 아니다');
    } finally { X.close(); }
  });

  test('(U) 새 보고와 옛 보고 가르기(memo): 문자열이면 메모 칸과 줄(id 로만), null 이면 글 해석. 줄이 0개인 새 보고도 새 보고다', () => {
    const X = bootBrowser();
    try {
      const SP = (sv) => X.evJSON(`atSavedParts(${JSON.stringify(sv)}, ['알파', '베타', '중복'], ${JSON.stringify(ALL)})`);
      const nu = SP({ content: '무시되는 글 [알파] : 9', memo: '* 출장', lines: [{ catUid: 'c-b', name: '옛 베타', hours: 2, body: '- 둘' }, { catUid: 'c-gone', name: '지운 과제', hours: 1, body: '' }] });
      assert.strictEqual(nu.memo, '* 출장');
      assert.deepStrictEqual(nu.blocks.map((b) => [b.name, b.catId, b.hours, b.text]), [['베타', 'c-b', 2, '- 둘'], ['', null, 1, '[지운 과제] : 1']], '새 보고를 줄과 id 로 되살리지 않는다');
      const empty = SP({ content: '[알파] : 3', memo: '', lines: [] });
      assert.deepStrictEqual([empty.memo, empty.blocks.length], ['', 0], '줄이 0개인 새 보고를 옛 보고로 봤다(글을 해석했다)');
      const old = SP({ content: '* 메모\n\n[알파] : 3\n- 일\n[중복] : 1', memo: null, lines: [] });
      assert.strictEqual(old.memo, '* 메모');
      assert.deepStrictEqual(old.blocks.map((b) => [b.name, b.catId, b.hours]), [['알파', 'c-a', 3], ['', null, 1]], '옛 보고를 글 해석과 이름 규칙(같은 이름 둘은 미정)으로 되살리지 않는다');
    } finally { X.close(); }
  });

  test('(U) 주간 [일간 불러오기] 두 길: 새 보고는 줄의 과제 id 로(이름이 바뀌어도), 옛 보고는 글 해석, 주간 줄에 catUid', () => {
    const X = bootBrowser();
    try {
      const rows = [
        { date: '2026-11-02', content: '[베타] : 9\n- 글은 무시', memo: '', lines: [{ catUid: 'c-a', name: '옛 알파 이름', hours: 2, body: '- 새 길' }, { catUid: 'c-gone', name: '지운 과제', hours: 1, body: 'x' }] },
        { date: '2026-11-03', content: '[알파] : 3\n- 옛 길\n[베타] : 1', memo: null, lines: [] },
      ];
      const c = X.evJSON(`awDailyCollect(${JSON.stringify(rows)}, ['알파', '베타', '중복'], ${JSON.stringify(ALL)})`);
      assert.deepStrictEqual(c.hours, { '알파': 5, '베타': 1 }, '두 길을 합친 시간이 다르다(새 보고의 글을 해석했거나 id 로 찾지 않았다)');
      assert.deepStrictEqual(c.prog.map((p) => [p.name, p.text]), [['알파', '- 새 길\n\n- 옛 길'], ['베타', '']]);
      assert.strictEqual(c.skipped, 1, '이어지지 않은 줄을 세지 않았다');
      const w = X.evJSON(`awHoursPayload(['알파', '모름'], { '알파': 3, '모름': 1 }, ${JSON.stringify(ALL.map((x) => Object.assign({ color: '#000000' }, x)))})`);
      assert.deepStrictEqual(w, [{ name: '알파', catUid: 'c-a', projectUid: '', hours: 3 }, { name: '모름', catUid: '', projectUid: '', hours: 1 }], '주간 줄에 catUid 가 없다');
    } finally { X.close(); }
  });

  test('(U) 글꼴: tc_rptFont:<계정> 에 저장하고 읽는다, 기본이면 키를 지운다, 저장소가 막혀도 기본으로', () => {
    const X = bootBrowser();
    try {
      X.ev("__bootMeta = { userId: 42 }");
      X.ev("reportFontSet({ family: 'Gulim', size: 12 })");
      assert.strictEqual(X.ev("localStorage.getItem('tc_rptFont:42')"), JSON.stringify({ family: 'Gulim', size: 12 }));
      assert.deepStrictEqual(X.evJSON('reportFontGet()'), { family: 'Gulim', size: 12 });
      X.ev("reportFontSet({ family: '', size: 0 })");
      assert.strictEqual(X.ev("localStorage.getItem('tc_rptFont:42')"), null, '기본 글꼴인데 키가 남았다');
      X.ev("localStorage.setItem('tc_rptFont:42', '{깨짐')");
      assert.deepStrictEqual(X.evJSON('reportFontGet()'), { family: '', size: 0 }, '깨진 값에서 기본으로 떨어지지 않는다');
      X.ev("Object.defineProperty(window, 'localStorage', { get(){ throw new Error('막힘'); } })");
      assert.deepStrictEqual(X.evJSON('reportFontGet()'), { family: '', size: 0 }, '저장소가 막히면 기본으로 그리지 않는다');
      X.ev("reportFontSet({ family: 'Gulim', size: 12 })");   // 던지지 않는다
      assert.ok(!('reportFont' in X.evJSON('state')), 'state 에 글꼴이 있다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });

  // ── (A) 근태 창 ─────────────────────────────────────────────────────
  const ATTEND_URL = 'https://tcapp.local/index.html?win=attend';
  function payloadFrom(T, saved, renamed) {
    const B = bootBrowser();
    try {
      B.ev("__bootMeta = { userId: 7 }; currentUser = { loginId: 'tester', name: '시험자' };");
      if (renamed) B.ev(`state.categories[1].name = ${JSON.stringify(renamed)}`);
      return B.evJSON(`atBuildPayload(${JSON.stringify(T)}, ${JSON.stringify(saved || null)}, false)`);
    } finally { B.close(); }
  }
  function bootAttend() {
    const A = boot(app, ATTEND_URL, true);
    A.T = A.ev('todayYmd()');
    A.ev("(function(){ for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k && k.indexOf('tc_attDraft:')===0) localStorage.removeItem(k); } })()");
    return A;
  }
  const blocks = (A) => A.evJSON('ATE.blocks.map(function(b){ return [b.name, b.catId, b.hours, b.text]; })');

  test('(A) 보고한 새 보고는 메모와 줄로 연다(이름이 바뀐 과제는 id 로 지금 이름), 열린 채 이름이 바뀌면 따라가고 보낼 때 지금 이름과 id 로 보낸다', () => {
    const A = bootAttend();
    try {
      const saved = { status: '1', overtime: 0, content: '* 메모\n\n[베타] : 2\n- 둘', sentAt: '', memo: '* 메모', lines: [{ catUid: 'c-b', name: '베타', hours: 2, body: '- 둘' }, { catUid: 'c-a', name: '알파', hours: 0, body: '- 0시간 메모' }] };
      A.ev('__attendWinOpen(' + JSON.stringify(payloadFrom(A.T, saved, '베타 새 이름')) + ')');
      assert.strictEqual(A.ev('ATE.memo'), '* 메모', '메모 칸을 memo 로 채우지 않았다');
      assert.deepStrictEqual(blocks(A), [['알파', 'c-a', 0, '- 0시간 메모'], ['베타 새 이름', 'c-b', 2, '- 둘']], '줄을 id 로 지금 과제에 잇지 않았다');
      //  메인 창에서 알파 이름을 바꾸고 돌아왔다(새로고침 payload)
      const p = payloadFrom(A.T, saved, '베타 새 이름'); p.refresh = true;
      p.projects = p.projects.map((x) => x.key === 'c-a' ? Object.assign({}, x, { name: '알파 바뀜' }) : x);
      A.ev('__attendWinOpen(' + JSON.stringify(p) + ')');
      assert.deepStrictEqual(blocks(A).map((b) => b[0]), ['알파 바뀜', '베타 새 이름'], '열린 블록이 id 로 새 이름을 따라가지 않았다');
      A.ev("Platform.report.submitDaily = function(p){ window.__sent = JSON.parse(JSON.stringify(p)); }; Platform.caps.reportAuto = true;");
      A.$('#atSend').click();
      const s = A.evJSON('window.__sent');
      assert.strictEqual(s.memo, '* 메모');
      assert.deepStrictEqual(s.hours, [{ name: '알파 바뀜', catUid: 'c-a', projectUid: null, hours: 0, body: '- 0시간 메모' }, { name: '베타 새 이름', catUid: 'c-b', projectUid: null, hours: 2, body: '- 둘' }], '보내는 줄이 다르다');
      assert.ok(s.fields.content.includes('[알파 바뀜] : 0\n- 0시간 메모'), '회사 글에 지금 이름과 0시간 블록이 없다');
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  test('(A) 옛 보고(memo null)는 글을 해석하고, 이전 보고는 detail 로 읽어 새 보고면 줄로 되살린다', async () => {
    const A = bootAttend();
    try {
      A.ev('__attendWinOpen(' + JSON.stringify(payloadFrom(A.T, { status: '1', overtime: 0, content: '[알파] : 3\n- 옛 글', sentAt: '', memo: null, lines: [] })) + ')');
      assert.deepStrictEqual(blocks(A), [['알파', 'c-a', 3, '- 옛 글']], '옛 보고를 글 해석으로 되살리지 않았다');
      const Y = A.ev('addDays(todayYmd(), -1)');
      stubHost(A, `{ reportDailyList: { ok: true, rows: [{ date: ${JSON.stringify(Y)}, status: '1', overtime: 0, content: '[베타] : 9', sentAt: '', memo: '* 어제 메모', lines: [{ catUid: 'c-b', name: '베타', hours: 4, body: '- 어제 일' }] }] } }`);
      A.ev(`atSetSrc('prev'); atSetSrcDate(${JSON.stringify(Y)})`); await tick(); await tick();
      const calls = A.evJSON('__calls').filter((c) => c[0] === 'reportDailyList');
      assert.ok(calls.length >= 1 && calls[calls.length - 1][1].detail === true, '이전 보고를 detail 로 읽지 않았다');
      const items = A.evJSON('atPanelItems().map(function(it){ return it.memo != null ? ["메모", it.memo] : [it.blk.name, it.blk.catId, it.blk.hours, it.blk.text]; })');
      assert.deepStrictEqual(items, [['메모', '* 어제 메모'], ['베타', 'c-b', 4, '- 어제 일']], '이전 보고(새 보고)를 메모와 줄로 되살리지 않았다(글을 해석했다)');
      assert.deepStrictEqual(A.errors, []);
    } finally { A.close(); }
  });

  // ── (W) 위젯 메인 창: 공식 과제로 연결 ─────────────────────────────────
  const META = { schemaVersion: '22', expectedSchema: '22', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  async function bootMain() {
    const X = boot(app, 'https://tcapp.local/', true);
    const sess = X.posted.find((x) => x && x.cmd === 'userSessionGet');
    if (sess) X.ev('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'tester', name: '시험자' } }) + ')');
    const st = stateFor();
    st.categories.push({ id: 'c-x', name: '임시 과제', color: '#123456', desc: '설명', createdAt: CA }, { id: 'c-y', name: '임시 둘', color: '#654321', desc: '', createdAt: CA });
    st.entries = [{ id: 'e-1', date: '2026-11-02', title: '일정', categoryId: 'c-x', allDay: true, startTime: '', endTime: '', location: '', memo: '', hours: null, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }];
    X.ev('__applyState(' + JSON.stringify(JSON.stringify(st)) + ',' + JSON.stringify(META) + ')');
    await tick();
    X.ev(`dbCatalog = [{ id: 'db-${U1}', name: '공식 하나', color: '#3e5be0', source: 'db' }, { id: 'db-${U2}', name: '공식 둘', color: '#2e9e6b', source: 'db' }]; dbOnline = true;`);
    X.ev("confirmBox = function(){ window.__confirmMsg = arguments[1]; return Promise.resolve('ok'); }");
    X.ev("window.__toasts = []; toast = function(m, k){ window.__toasts.push([String(m), k]); };");
    return X;
  }
  test('(W) 공식 과제로 연결: 일정을 옮기고 저장 → 과제마다 reportRelink → 성공한 과제만 지우고, 실패한 과제는 남기고 알린다', async () => {
    const X = await bootMain();
    try {
      stubHost(X, `{ reportRelink: function(p){ return p.catId === 'c-x' ? { ok: true, daily: 2, weekly: 1 } : { ok: false, error: '합친 시간이 하루 24시간을 넘는 날(2026-11-03)이 있어 연결하지 않았습니다. 원래 과제는 그대로 두었습니다.' }; } }`);
      X.ev(`openRelinkModal(); rlPick.set('c-x', 'db-${U1}'); rlPick.set('c-y', 'db-${U2}'); runRelink();`);
      for (let i = 0; i < 10; i++) await tick();
      assert.ok(String(X.ev('window.__confirmMsg')).includes('원래 과제는 지웁니다'), '확인 창 문구가 다르다');
      const calls = X.evJSON('__calls').filter((c) => c[0] === 'reportRelink').map((c) => c[1]);
      assert.deepStrictEqual(calls, [{ catId: 'c-x', projectUid: U1 }, { catId: 'c-y', projectUid: U2 }], 'reportRelink 을 과제마다 공식 uid 로 부르지 않았다');
      const ids = X.evJSON('state.categories.map(function(c){ return c.id; })');
      assert.ok(!ids.includes('c-x'), '공수 옮기기가 성공했는데 옛 과제를 지우지 않았다');
      assert.ok(ids.includes('c-y'), '공수 옮기기가 실패했는데 옛 과제를 지웠다');
      assert.strictEqual(X.ev("state.entries.find(function(e){ return e.id === 'e-1'; }).categoryId"), 'db-' + U1, '일정을 공식 과제로 옮기지 않았다');
      const t = X.evJSON('__toasts').map((x) => x[0]).join(' / ');
      assert.ok(t.includes('원래 과제 1개를 지웠습니다') && t.includes('1개 과제는 원래 과제를 남겼습니다') && t.includes('24시간'), '결과 안내가 다르다: ' + t);
      //  다시 보내기: 남은 c-y 를 다시 연결하면(이번엔 성공) 지운다
      X.ev(`window.__rep.reportRelink = { ok: true, daily: 0, weekly: 0 }; openRelinkModal(); rlPick.set('c-y', 'db-${U2}'); runRelink();`);
      for (let i = 0; i < 10; i++) await tick();
      assert.ok(!X.evJSON('state.categories.map(function(c){ return c.id; })').includes('c-y'), '다시 연결했는데 옛 과제가 남았다');
      assert.deepStrictEqual(X.errors, []);
    } finally { X.close(); }
  });
}
