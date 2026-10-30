// 근태 창과 결정 9 의 호스트 계약(docs/ATTENDANCE-PLAN.md §3, docs/DECISIONS.md 결정 9). 정적 검사와 변이.
//
// 이 파일이 지키는 것(호스트 쪽만. 웹의 근태 화면은 웹 시험의 몫이다):
//   ① 창 종류 WinKind.Attend 의 값(주소, 제목, 최소와 처음 크기, 'tw:' 머리, 준비 알림, 여는 함수, 앞으로 올 때 함수,
//      목록 알림 안 받음, 닫기 전 확인, 자리 기억 키)과 등록(All), 설정의 Attend 자리.
//   ② 근태 창 허용 목록 AttendWinCommands = {attendWinReady, attendNav, reportDailyList, netcusSubmit, attendSourceReq, netcusViewMonth, attendCatNew,
//      reportWeeklyList, netcusWeekSubmit}. 웹 ATTENDWIN_CMD 와 같다. attendSourcePush 는 메인 창만 보낸다(목록에 없다).
//      netcusWeekMerge(인트라넷 불러오기)는 과제 블록(결정 12)에서 뺐다. 주간 두 명령은 주간보고(결정 13)가 더했다.
//   ③ attendOpen 은 메인 창에서만 받는다. payload 가 객체가 아니면 열지 않는다. attendNav 는 근태 창에서만 받고 메인 창의
//      __attendNavFromWin 을 부른다(날짜는 'YYYY-MM-DD' 만, 인자는 JSON 으로 싣는다).
//   ④ reportDailyList: 사람은 세션에서, 기간은 엄격한 날짜 두 개와 상한, DB 는 UI 스레드 밖, 회신은 ReplyOnUi.
//      ReportDb.ListDailyAsync 의 SELECT 는 사람과 기간으로 거르고 값은 모두 파라미터로 묶는다.
//   ⑤ 결정 9: NetcusSubmit 은 vr==1 에서 저장을 기다린 뒤에 결과를 알리고, 실패면 공통 안내를 띄운다.
//   ⑥ 일간 백그라운드 재시도가 없다(주간은 그대로).
//   ⑦ __netcusProgress, __netcusResult 는 메인 창과 근태 창 둘 다로 간다(메인 먼저).
//   ⑧ __reportDailySaved 는 저장이 성공했을 때만, 두 창 모두로 간다.
//   ⑨ 로그아웃과 계정 바뀜은 따로 뜨는 창을 종류 가리지 않고 모두 닫는다(근태 창 포함).
//   ⑩ 가져오기 중계(2026-10-29): attendSourceReq 는 근태 창에서만 받아 날짜를 확인하고 메인 창 __attendSourceFor 를 부른다.
//      attendSourcePush 는 메인 창에서만 받아 날짜와 source(객체)를 확인하고 {date, source} 를 JSON 으로 다시 써서 근태 창 __attendSource 로만 넘긴다.
//      근태관리 읽기(netcusWeekMerge, 이제 메인 창의 주간보고 병합만 쓴다)는 회사 사이트를 읽기만 한다(제출, 값 넣기, 저장이 없다).
//   ⑪ 새 과제 만들기(결정 12): attendCatNew 는 근태 창에서만 받아 메인 창을 앞으로 가져오고 메인 창 __attendCatNew 를 부른다(인자 없음).
//   ⑫ 주간보고(결정 13, ATTENDANCE-PLAN §13.5): reportWeeklyList 는 세션의 사람과 엄격한 기간(상한)으로 읽고, SELECT 는 파라미터로 묶고
//      회의내용(meeting)까지 돌려준다(NULL 은 빈 글). 회신은 ReplyOnUi. 주간 기록 저장(SaveWeeklyAsync)은 회의내용을 함께 쓰고(없으면 있던 값 그대로),
//      저장이 성공해야 __reportWeeklySaved 를 두 창으로 보낸다. netcusWeekSubmit 의 resultwork 는 칸이 있을 때만 넘긴다.
//   ★ 검사는 함수로 묶고(checks.*), 아래 변이 시험이 같은 함수에 망가뜨린 소스를 넣어 실패를 확인한다.
import { test, assert, loadAppSource, stripCsComments, extractCsMember, readText } from './harness.mjs';

const W = (f) => readText(new URL('../widget/' + f, import.meta.url)).replace(/\r/g, '');
const src = {
  aw: W('AppWindow.cs'),
  main: W('MainWindow.xaml.cs'),
  netcus: W('NetcusService.cs'),
  rdb: W('ReportDb.cs'),
  off: W('OfflineHost.cs'),
  app: loadAppSource(),
};
const with_ = (k, v) => ({ ...src, [k]: v });

function mutate(base, from, to) {
  const n = base.split(from).length - 1;
  assert.equal(n, 1, `변이 앵커가 ${n}번 나온다: ${from.slice(0, 80)}`);
  return base.replace(from, to);
}
const member = (code, sig) => extractCsMember(code, sig);

const ATTEND_CMDS = ['attendCatNew', 'attendNav', 'attendSourceReq', 'attendWinReady', 'netcusSubmit', 'netcusViewMonth', 'netcusWeekSubmit', 'reportDailyList', 'reportWeeklyList'];
//  근태 창이 보내면 안 되는 것(내 달력 부팅과 저장, 창 열기, 관리, 창 조작, 주간 병합과 범위 읽기, 업데이트). 주간 폼 채우기는 결정 13 에서 근태 창으로 옮겼다
const NEVER = ['ready', 'reloadState', 'saveState', 'replaceAllState', 'unsavedState', 'userLogin', 'userLogout',
  'attendOpen', 'adminOpen', 'peerOpen', 'peerSchedule', 'peerMine', 'membersGet', 'saveProject', 'netcusSaveCreds',
  'netcusWeekMerge', 'attendSourcePush', 'netcusWeeklyRangeRead', 'reminderSync', 'updateApply', 'updateCheck', 'close', 'hide', 'pin', '__dbFault'];

function hostSet(cs, name) {
  const m = new RegExp(`internal static readonly HashSet<string> ${name} = new\\(StringComparer\\.Ordinal\\)\\s*\\{([^}]*)\\}`).exec(stripCsComments(cs));
  assert.ok(m, `${name} 목록을 찾지 못했다`);
  return [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort();
}
function kindBody(aw, name) {
  const m = new RegExp(`public static readonly WinKind ${name} = new\\(\\)\\s*\\{([\\s\\S]*?)\\};`).exec(aw);
  assert.ok(m, `WinKind.${name} 정의를 찾지 못했다`);
  return m[1];
}
const onWeb = (s) => member(s.main, 'private void OnWebMessage(CoreWebView2WebMessageReceivedEventArgs e, CoreWebView2? origin)');
//  NetcusSubmit 의 vr==1 블록(중괄호 짝까지)
function verifiedBlock(netcus) {
  const b = member(netcus, 'private async Task NetcusSubmit(NetcusReq req)');
  const at = b.indexOf('else if (vr == 1)');
  assert.ok(at > 0, 'vr == 1 분기를 찾지 못했다');
  let k = b.indexOf('{', at), depth = 0;
  for (let p = k; p < b.length; p++) {
    if (b[p] === '{') depth++;
    else if (b[p] === '}' && --depth === 0) return b.slice(k, p + 1);
  }
  throw new Error('vr == 1 분기의 끝을 찾지 못했다');
}

const checks = {
  // ① 창 종류
  registry(s) {
    const k = kindBody(s.aw, 'Attend');
    assert.match(k, /Id = "attend", Name = "근태 창", Url = "https:\/\/tcapp\.local\/index\.html\?win=attend", Title = "근태 보고",/, '근태 창의 주소나 제목이 기획(§3.1)과 다르다');
    assert.match(k, /TitleFollowsDocument = false, MinWidth = 720, MinHeight = 520, DefaultWidth = 1200, DefaultHeight = 860,/, '근태 창의 크기 규칙이 기획(§3.1)과 다르다');
    assert.match(k, /ReqPrefix = MainWindow\.AttendReqPrefix, ReadyCmd = "attendWinReady", AnyCmdWithoutReq = true,/, '근태 창의 번호 머리나 준비 알림이 다르다(attendNav, netcusSubmit 은 번호 없이 온다)');
    assert.match(k, /Commands = MainWindow\.AttendWinCommands, OpenFn = "__attendWinOpen", ActivatedFn = "__attendWinActivated",/, '근태 창의 허용 목록이나 웹 함수가 다르다');
    assert.match(k, /GetsCatalog = false, AskBeforeClose = true,/, '근태 창이 목록 알림을 받거나 닫기 전에 묻지 않는다');
    assert.match(k, /GetBounds = s => s\.Attend, SetBounds = \(s, b\) => s\.Attend = b,/, '근태 창 자리가 다른 창과 따로 기억되지 않는다');
    assert.match(s.aw, /public static readonly IReadOnlyList<WinKind> All = new\[\] \{[^}]*\bAttend\b[^}]*\};/, '근태 창이 창 종류 등록(All)에 없다');
    assert.match(s.main, /internal const string AttendReqPrefix = "tw:";/, "근태 창의 번호 머리가 'tw:' 가 아니다");
    const prefixes = [...s.main.matchAll(/internal const string \w+ReqPrefix = "([^"]*)";/g)].map((m) => m[1]);
    assert.strictEqual(new Set(prefixes).size, prefixes.length, '창 번호 머리가 서로 겹친다: ' + prefixes.join(', '));
    assert.match(s.main, /public PeerWindowBounds\? Attend \{ get; set; \}/, '설정에 근태 창 자리가 없다');
  },

  // ② 허용 목록(호스트와 웹이 같다)
  whitelist(s) {
    const host = hostSet(s.main, 'AttendWinCommands');
    assert.deepStrictEqual(host, ATTEND_CMDS, '근태 창 허용 목록이 기획(§3.2)과 다르다');
    const bad = NEVER.filter((c) => host.includes(c));
    assert.deepStrictEqual(bad, [], '근태 창이 보내면 안 되는 명령이 목록에 있다');
    const m = /const ATTENDWIN_CMD = new Set\(\[([\s\S]*?)\]\);/.exec(s.app);
    assert.ok(m, '웹의 ATTENDWIN_CMD 를 찾지 못했다');
    const web = [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
    assert.deepStrictEqual(web, host, '웹(ATTENDWIN_CMD)과 호스트(AttendWinCommands)의 근태 창 목록이 다르다');
  },

  // ③ 열기는 메인 창만, 날짜 이동은 근태 창만(메인 창으로 넘긴다)
  routing(s) {
    const d = onWeb(s);
    assert.match(d, /case "attendOpen":[^\n]*\n\s*if \(fromWin == null\) OpenAttendWindow\(rq, doc\);/, '근태 창 열기를 메인 창에서만 받지 않는다');
    assert.match(d, /case "attendNav":[^\n]*\n\s*if \(fromWin == WinKind\.Attend\) AttendNavToMain\(GetStr\(doc, "date"\), GetBool\(doc, "refresh"\)\);/, '날짜 이동을 근태 창에서만 받지 않는다');
    assert.match(d, /case "attendWinReady":[^\n]*\n\s*case "peerWinReady":[^\n]*\n\s*case "adminWinReady":\s*if \(fromWin != null && cmd == fromWin\.ReadyCmd\)\s*\{\s*WinOf\(fromWin\)\?\.OnWebReady\(\);\s*GatePushToWin\(fromWin\);/,
      '근태 창 준비 알림이 대상과 관문 상태를 넘기는 길로 가지 않는다');
    const o = member(s.main, 'private void OpenAttendWindow(string reqId, JsonDocument doc)');
    assert.match(o, /TryGetProperty\("payload", out var p\) \|\| p\.ValueKind != JsonValueKind\.Object\)/, 'payload 가 객체인지 보지 않는다');
    assert.match(o, /s = UserSession\.Load\(_dataDir, Log\);[\s\S]*if \(s == null \|\| s\.LoginId\.Length == 0\)/, '로그인 전에도 근태 창을 연다');
    assert.match(o, /var w = ShowWin\(WinKind\.Attend, p\.GetRawText\(\)\);/, '근태 창을 ShowWin 으로 열거나 앞으로 가져오지 않는다(이미 떠 있으면 대상만 바꾼다)');
    assert.match(o, /HostReply\(reqId, w != null \? new \{ ok = true/, '열기 결과를 회신하지 않는다');
    const n = member(s.main, 'private void AttendNavToMain(string date, bool refresh)');
    assert.match(n, /if \(!ReportDb\.TryParseYmd\(date, out _\)\)[^\n]*return;/, '날짜 형식을 보지 않고 메인 창으로 넘긴다');
    assert.match(n, /JsCall\("window\.__attendNavFromWin && window\.__attendNavFromWin\(" \+ JsonSerializer\.Serialize\(date\) \+ "," \+ \(refresh \? "true" : "false"\) \+ "\)"\);/,
      '메인 창의 __attendNavFromWin 을 JSON 인자로 부르지 않는다');
    //  JsCall 은 메인 창 웹뷰만 부른다(근태 창으로 되돌려 보내지 않는다).
    assert.match(member(s.main, 'private void JsCall(string js)'), /web\.CoreWebView2\?\.ExecuteScriptAsync\(js\)/, 'JsCall 이 메인 창으로 가지 않는다');
  },

  // ④ 보고한 날 목록
  dailyList(s) {
    assert.match(onWeb(s), /case "reportDailyList":[^\n]*\n\s*_ = RunReportDailyListAsync\(rq, GetStr\(doc, "from"\), GetStr\(doc, "to"\)\);/, 'reportDailyList 가 배선되지 않았다');
    const r = member(s.main, 'private async Task RunReportDailyListAsync(string reqId, string from, string to)');
    assert.match(r, /!ReportDb\.TryParseYmd\(from, out var f\) \|\| !ReportDb\.TryParseYmd\(to, out var t\) \|\| f > t/, '기간 날짜를 엄격히 보지 않는다(또는 뒤집힌 기간을 받는다)');
    assert.match(r, /\(t - f\)\.TotalDays > ReportDb\.ListMaxDays/, '기간 상한을 보지 않는다');
    assert.match(r, /string\? loginId = CurrentLoginId\(\);/, '사람을 세션에서 읽지 않는다(웹이 정하면 남의 보고를 읽는다)');
    assert.ok(!/GetStr\(doc, "loginId"\)|GetStr\(doc, "userId"\)/.test(onWeb(s).slice(onWeb(s).indexOf('case "reportDailyList":'), onWeb(s).indexOf('case "reportDailyList":') + 300)), '목록 읽기가 웹이 보낸 사람을 쓴다');
    assert.match(r, /await Task\.Run\(\(\) => db\.ListDailyAsync\(loginId, f, t\)\)/, 'DB 를 UI 스레드 밖에서 읽지 않는다');
    assert.match(r, /ReplyOnUi\(reqId, new \{ ok = true, rows \}\);/, '성공 회신이 { ok, rows } 가 아니다');
    assert.ok(!/HostReply\(/.test(r), '목록 회신이 ReplyOnUi 를 거치지 않는다(백그라운드에서 HostReply 를 부르면 회신이 사라질 수 있다)');
    assert.match(s.rdb, /internal const int ListMaxDays = 400;/, '목록 기간 상한이 400일이 아니다');
    assert.match(s.rdb, /DateTime\.TryParseExact\(s \?\? "", "yyyy-MM-dd", CultureInfo\.InvariantCulture, DateTimeStyles\.None, out d\)/, "날짜 읽기가 'yyyy-MM-dd' 정확 일치가 아니다");
    const l = member(s.rdb, 'public async Task<List<Dictionary<string, object?>>?> ListDailyAsync(string? loginId, DateTime from, DateTime to)');
    assert.ok(l.includes('"SELECT work_date, status, overtime, content, sent_at FROM cal_report_daily " +\n                    "WHERE user_id=@u AND work_date BETWEEN @f AND @t ORDER BY work_date";'),
      'SELECT 가 사람(user_id)과 기간으로 거르지 않거나 날짜 순이 아니다');
    for (const p of ['@u", userId', '@f", from', '@t", to'])
      assert.ok(l.includes('cmd.Parameters.AddWithValue("' + p + ')'), `파라미터 ${p.split('"')[0]} 를 묶지 않는다`);
    const q = l.slice(l.indexOf('cmd.CommandText ='), l.indexOf('ORDER BY work_date";'));
    assert.ok(!/"\s*\+\s*(?:from|to|loginId|userId)\b/.test(q), 'SELECT 문에 값을 이어 붙인다(파라미터로 묶어야 한다)');
    assert.match(l, /await using var conn = await OpenReadAsync\(cts\.Token\);\s*int userId = await ResolveUserIdAsync\(conn, loginId, cts\.Token\);/, '목록 읽기가 관문 연결과 세션 사람의 user_id 로 읽지 않는다');
    assert.match(member(s.rdb, 'private static async Task<MySqlConnection> OpenReadAsync(CancellationToken ct)'), /DbGate\.OpenAsync\(BuildConnString\(\), ct\)[\s\S]*ReadPreambleSql/, '읽기 연결이 관문(DbGate)과 읽기 프리앰블을 거치지 않는다');
    for (const key of ['["date"]', '["status"]', '["overtime"]', '["content"]', '["sentAt"]'])
      assert.ok(l.includes(key + ' = '), `행에 ${key} 가 없다`);
    assert.match(l, /catch \(Exception ex\)[\s\S]*return null;/, '읽기 실패를 null 로 돌려주지 않는다');
  },

  // ⑤ 결정 9: 저장을 기다린 뒤에 결과
  decision9(s) {
    assert.match(stripCsComments(s.netcus), /Task<bool> SaveDailyReport\(int y, int m, int d, string status, int overtime, string content, string hoursJson\);/, 'INetcusHost.SaveDailyReport 가 Task<bool> 이 아니다');
    const v = verifiedBlock(stripCsComments(s.netcus));
    const save = v.indexOf('bool stored = await _host.SaveDailyReport(req.Y, req.M, req.D, req.Status, req.Overtime, req.Content, req.HoursJson);');
    const res = v.indexOf('NetcusResult(stored, stored ? "회사 보고와 기록 저장을 완료했습니다." : "처리를 완료하지 못했습니다. 다시 시도해 주세요.");');
    assert.ok(save >= 0, 'vr==1 에서 저장을 기다리지 않는다');
    assert.ok(res >= 0, '결과가 저장 결과를 따르지 않거나 문구가 기획(결정 9)과 다르다');
    assert.ok(save < res, '결과를 저장보다 먼저 알린다(결정 9: 커밋 확인 뒤에만 성공)');
    assert.strictEqual((v.match(/NetcusResult\(/g) || []).length, 1, 'vr==1 블록에서 결과를 두 번 알린다(옛 성공 문구가 남았다)');
    const hook = member(s.main, 'async Task<bool> INetcusHost.SaveDailyReport(int y, int m, int d, string status, int overtime, string content, string hoursJson)');
    assert.match(hook, /return ok;/, '저장 훅이 결과를 돌려주지 않는다');
    assert.match(hook, /catch \(Exception ex\)[^\n]*ok = false;/, '저장 훅이 예외를 실패로 바꾸지 않는다(결과 알림이 끊긴다)');
  },

  // ⑥ 일간 백그라운드 재시도 없음(주간은 그대로)
  noDailyRetry(s) {
    const hook = stripCsComments(member(s.main, 'async Task<bool> INetcusHost.SaveDailyReport(int y, int m, int d, string status, int overtime, string content, string hoursJson)'));
    assert.ok(!/SaveReportRecordWithRetryAsync|__reportRecordFailed/.test(hook), '일간 저장이 아직 백그라운드 재시도나 그 실패 알림을 탄다');
    assert.ok(!/SaveReportRecordWithRetryAsync\("daily"/.test(stripCsComments(s.main) + stripCsComments(s.off)), '일간 재시도 호출이 남아 있다');
    assert.match(member(s.main, 'void INetcusHost.SaveWeeklyReport('), /SaveReportRecordWithRetryAsync\("weekly", sdate, db,/, '주간 재시도가 사라졌다(주간은 바꾸지 않는다)');
  },

  // ⑦ 진행과 결과 알림이 두 창으로
  notifyBoth(s) {
    const n = stripCsComments(s.netcus);
    assert.match(n, /void EvalReport\(string js\);/, 'INetcusHost 에 두 창 알림(EvalReport)이 없다');
    for (const fn of ['__netcusProgress', '__netcusResult']) {
      assert.ok(new RegExp(`_host\\.EvalReport\\("window\\.${fn} && window\\.${fn}\\(`).test(n), `${fn} 가 두 창 알림으로 가지 않는다`);
      assert.ok(!new RegExp(`JsCall\\("window\\.${fn} `).test(n), `${fn} 가 아직 메인 창으로만 간다`);
    }
    assert.match(stripCsComments(s.main), /void INetcusHost\.EvalReport\(string js\) => ReportPush\(js\);/, 'EvalReport 가 ReportPush 로 가지 않는다');
    const p = member(s.main, 'private void ReportPush(string js)');
    const mainAt = p.indexOf('web.CoreWebView2?.ExecuteScriptAsync(js)');
    const attAt = p.indexOf('WinOf(WinKind.Attend)?.Core?.ExecuteScriptAsync(js)');
    assert.ok(mainAt > 0 && attAt > 0, 'ReportPush 가 메인 창과 근태 창 둘 다로 보내지 않는다');
    assert.ok(mainAt < attAt, 'ReportPush 가 메인 창보다 근태 창에 먼저 보낸다');
    assert.match(p, /Dispatcher\.Invoke/, 'ReportPush 가 UI 스레드로 넘기지 않는다');
  },

  // ⑧ 저장 성공 알림
  savedNotice(s) {
    const hook = stripCsComments(member(s.main, 'async Task<bool> INetcusHost.SaveDailyReport(int y, int m, int d, string status, int overtime, string content, string hoursJson)'));
    const save = hook.indexOf('ok = await Task.Run(() => db.SaveDailyAsync(loginId, y, m, d, st, ot, content, hours));');
    const gate = hook.indexOf('if (ok)');
    const push = hook.indexOf('ReportPush("window.__reportDailySaved && window.__reportDailySaved(" + JsonSerializer.Serialize(new { date, status = st, overtime = ot }) + ")");');
    assert.ok(save > 0, '저장을 기다리지 않는다');
    assert.ok(push > 0, '__reportDailySaved({date, status, overtime}) 를 두 창 알림(ReportPush)으로 보내지 않는다');
    assert.ok(save < gate && gate < push, '__reportDailySaved 가 저장 성공(if (ok)) 안에 있지 않다(실패해도 저장됐다고 알린다)');
    const all = stripCsComments(s.main) + stripCsComments(s.netcus) + stripCsComments(s.off);
    assert.strictEqual((all.match(/__reportDailySaved\(/g) || []).length, 1, '__reportDailySaved 를 보내는 곳이 하나가 아니다');
  },

  // ⑩ 가져오기 중계와 근태관리 읽기
  sourceRelay(s) {
    const d = onWeb(s);
    assert.match(d, /case "attendSourceReq":[^\n]*\n\s*if \(fromWin == WinKind\.Attend\) AttendSourceToMain\(GetStr\(doc, "date"\)\);/, '가져오기 청하기를 근태 창에서만 받지 않는다');
    assert.match(d, /case "attendSourcePush":[^\n]*\n\s*if \(fromWin == null\) AttendSourceToWin\(doc\);/, '가져오기 회신을 메인 창에서만 받지 않는다');
    const a = member(s.main, 'private void AttendSourceToMain(string date)');
    assert.match(a, /if \(!ReportDb\.TryParseYmd\(date, out _\)\)[^\n]*return;/, '가져오기 청하기가 날짜 형식을 보지 않는다');
    assert.match(a, /JsCall\("window\.__attendSourceFor && window\.__attendSourceFor\(" \+ JsonSerializer\.Serialize\(date\) \+ "\)"\);/, '메인 창 __attendSourceFor 를 JSON 인자로 부르지 않는다');
    const b = member(s.main, 'private void AttendSourceToWin(JsonDocument doc)');
    assert.match(b, /if \(!ReportDb\.TryParseYmd\(date, out _\)\)[^\n]*return;/, '가져오기 회신이 날짜 형식을 보지 않는다');
    assert.match(b, /TryGetProperty\("source", out var src\) \|\| src\.ValueKind != JsonValueKind\.Object\) return;/, '가져오기 회신이 source 가 객체인지 보지 않는다');
    assert.match(b, /var core = WinOf\(WinKind\.Attend\)\?\.Core;/, '가져오기 회신을 근태 창으로 보내지 않는다');
    assert.match(b, /"window\.__attendSource && window\.__attendSource\(" \+ JsonSerializer\.Serialize\(new \{ date, source = src \}\) \+ "\)"/, '가져오기 회신을 JSON 으로 다시 쓰지 않는다(받은 글자를 그대로 이어 붙인다)');
    assert.ok(!/JsCall\(|ReportPush\(|GetRawText\(\)/.test(b), '가져오기 회신이 메인 창으로 되돌아가거나 받은 글자를 그대로 쓴다');
    //  근태관리 읽기: 근태 창 회신은 'tw:' 번호로 그 창에 간다(HostReply 의 ReplyCore). 회사 사이트에는 읽기만 한다.
    assert.match(d, /case "netcusWeekMerge":[\s\S]{0,400}_ = _netcus\.WeekMerge\(reqId, from, to\);/, 'netcusWeekMerge 가 배선되지 않았다');
    const m = stripCsComments(member(s.netcus, 'private async Task NetcusWeekMerge(string reqId, string from, string to)'));
    assert.ok(!/SaveDailyReport|SaveWeeklyReport|NetcusSubmit|WeekFill|\.submit\(|requestSubmit|\.value\s*=(?!=)/.test(m), '근태관리 읽기가 회사 사이트에 쓰거나 저장한다');
    assert.match(m, /if \(\(dTo - dFrom\)\.TotalDays > 31\)/, '근태관리 읽기의 기간 상한이 없다');
    //  인트라넷 근태관리 달력 보기: 읽기만 하고(제출, 저장, 값 넣기 없음) 그 달 pjm_work.jsp 를 연다. 회신은 같은 HostReply.
    assert.match(d, /case "netcusViewMonth":[\s\S]{0,400}_ = _netcus\.ViewMonth\(reqId, GetInt\(doc, "y"\), GetInt\(doc, "m"\), GetInt\(doc, "d"\)\);/, 'netcusViewMonth 가 배선되지 않았다');
    const vm = stripCsComments(member(s.netcus, 'private async Task NetcusViewMonth(string reqId, int y, int m, int d)'));
    assert.ok(!/SaveDailyReport|SaveWeeklyReport|NetcusSubmit|WeekFill|\.submit\(|requestSubmit|\.value\s*=(?!=)/.test(vm), '근태 달력 보기가 회사 사이트에 쓰거나 저장한다');
    assert.ok(vm.includes('pjm_work.jsp?y={y}&m={m}&id='), '근태 달력 보기가 그 달 pjm_work.jsp 를 열지 않는다');
    assert.ok(vm.includes('if (_ncBusy) { HostReply(reqId, new { ok = false, error = "busy"'), '근태 달력 보기가 다른 회사 사이트 작업과 겹친다');
    //  없는 날짜(달마다 다른 끝날, 윤년)는 보내기와 달력 보기 전에 막는다. 보내기는 바쁨 확인보다 먼저 본다.
    assert.ok(s.netcus.includes('internal static bool IsRealDate(int y, int m, int d) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= DateTime.DaysInMonth(y, m);'), '실제 날짜 검사가 없다');
    const sub = member(s.netcus, 'private async Task NetcusSubmit(NetcusReq req)');
    assert.ok(sub.indexOf('if (!IsRealDate(req.Y, req.M, req.D))') >= 0 && sub.indexOf('if (!IsRealDate(req.Y, req.M, req.D))') < sub.indexOf('if (_ncBusy)'), '일간 전송이 없는 날짜를 먼저 막지 않는다');
    assert.ok(vm.includes('if (!IsRealDate(y, m, d))'), '근태 달력 보기가 없는 날짜를 막지 않는다');
    //  보고 성공이면 확인용 창을 닫는다(실패면 남긴다)
    assert.ok(member(s.netcus, 'private async Task NetcusSubmit(NetcusReq req)').includes('if (stored) { try { Dispatcher.Invoke(() => { try { _w2win?.Close(); } catch { } }); } catch { } }'), '보고 성공 뒤 확인용 창을 닫지 않는다');
    assert.match(member(s.main, 'private void HostReply(string reqId, object payload)'), /ReplyCore\(reqId\)\?\.ExecuteScriptAsync\(call\)/, '회신이 보낸 창(ReplyCore)으로 가지 않는다');
  },

  // ⑪ 새 과제 만들기: 근태 창만 받고, 메인 창을 앞으로 가져온 뒤 메인 창(JsCall)의 __attendCatNew 를 인자 없이 부른다
  catNew(s) {
    const d = onWeb(s);
    assert.match(d, /case "attendCatNew":[^\n]*\n\s*if \(fromWin == WinKind\.Attend\) AttendCatNewToMain\(\);/, '새 과제 만들기를 근태 창에서만 받지 않는다');
    const m = member(s.main, 'private void AttendCatNewToMain()');
    const front = m.indexOf('SummonToFront();'), call = m.indexOf('JsCall("window.__attendCatNew && window.__attendCatNew()");');
    assert.ok(front > 0, '메인 창을 앞으로 가져오지 않는다(과제 창이 근태 창 뒤에 뜬다)');
    assert.ok(call > 0, '메인 창의 __attendCatNew 를 부르지 않는다');
    assert.ok(front < call, '과제 창을 연 뒤에 메인 창을 가져온다');
    assert.ok(!/GetStr|GetRawText|doc/.test(m), '새 과제 만들기가 근태 창이 보낸 값을 싣는다');
    assert.match(s.app, /window\.__attendCatNew = function\(\)\{\s*if\(!HOST \|\| PEER \|\| SUBWIN\) return;\s*try\{ openCatModal\(\); \}catch\(_\)\{\}/,'웹 메인 창의 __attendCatNew 가 과제 창을 열지 않거나 다른 창에서도 연다');
  },

  // ⑫ 주간보고(결정 13): 목록 읽기, 회의내용 저장, 저장 성공 알림, 회의내용 넘기기
  weekly(s) {
    const d = onWeb(s);
    assert.match(d, /case "reportWeeklyList":[^\n]*\n\s*_ = RunReportWeeklyListAsync\(rq, GetStr\(doc, "from"\), GetStr\(doc, "to"\)\);/, 'reportWeeklyList 가 배선되지 않았다');
    const at = d.indexOf('case "reportWeeklyList":');
    assert.ok(!/GetStr\(doc, "loginId"\)|GetStr\(doc, "userId"\)/.test(d.slice(at, at + 300)), '주간 목록 읽기가 웹이 보낸 사람을 쓴다');
    const r = member(s.main, 'private async Task RunReportWeeklyListAsync(string reqId, string from, string to)');
    assert.match(r, /!ReportDb\.TryParseYmd\(from, out var f\) \|\| !ReportDb\.TryParseYmd\(to, out var t\) \|\| f > t/, '기간 날짜를 엄격히 보지 않는다');
    assert.match(r, /\(t - f\)\.TotalDays > ReportDb\.ListMaxDays/, '기간 상한을 보지 않는다');
    assert.match(r, /string\? loginId = CurrentLoginId\(\);/, '사람을 세션에서 읽지 않는다');
    assert.match(r, /await Task\.Run\(\(\) => db\.ListWeeklyAsync\(loginId, f, t\)\)/, 'DB 를 UI 스레드 밖에서 읽지 않는다');
    assert.match(r, /ReplyOnUi\(reqId, new \{ ok = true, rows \}\);/, '성공 회신이 { ok, rows } 가 아니다');
    assert.ok(!/HostReply\(/.test(r), '주간 목록 회신이 ReplyOnUi 를 거치지 않는다');
    const l = member(s.rdb, 'public async Task<List<Dictionary<string, object?>>?> ListWeeklyAsync(string? loginId, DateTime from, DateTime to)');
    assert.match(l, /OpenReadAsync\(cts\.Token\)/, '주간 목록이 읽기 연결이 아니다');
    assert.match(l, /if \(from > to \|\| \(to - from\)\.TotalDays > ListMaxDays\)/, 'ReportDb 가 기간 상한을 다시 보지 않는다');
    assert.ok(l.includes('"SELECT period_start, period_end, subject, content, endwork, plan, COALESCE(meeting, \'\') AS meeting, composed_at " +\n                    "FROM cal_report_weekly WHERE user_id=@u AND period_start BETWEEN @f AND @t ORDER BY period_start DESC";'),
      '주간 SELECT 가 사람과 기간으로 거르지 않거나 회의내용을 읽지 않는다');
    for (const p of ['@u", userId', '@f", from', '@t", to'])
      assert.ok(l.includes('cmd.Parameters.AddWithValue("' + p + ')'), `파라미터 ${p.split('"')[0]} 를 묶지 않는다`);
    const q = l.slice(l.indexOf('cmd.CommandText ='), l.indexOf('ORDER BY period_start DESC";'));
    assert.ok(!/"\s*\+\s*(?:from|to|loginId|userId)\b/.test(q), 'SELECT 문에 값을 이어 붙인다');
    for (const k of ['periodStart', 'periodEnd', 'subject', 'content', 'endwork', 'plan', 'meeting', 'composedAt'])
      assert.ok(l.includes('["' + k + '"]'), `회신 행에 ${k} 가 없다`);
    assert.ok(!/INSERT|UPDATE|DELETE/.test(stripCsComments(l)), '주간 목록 읽기가 쓴다');
    //  저장: 회의내용 칸, 없으면(null) 있던 값 그대로
    const w = member(s.rdb, 'public async Task<bool> SaveWeeklyAsync(');
    assert.ok(w.includes('(user_id, period_start, period_end, subject, content, endwork, plan, meeting, composed_at)'), 'SaveWeeklyAsync 가 회의내용을 쓰지 않는다');
    assert.ok(w.includes('meeting=COALESCE(VALUES(meeting), meeting)'), '회의내용이 없는 요청(옛 보고서 창)이 있던 회의내용을 지운다');
    assert.ok(w.includes('cmd.Parameters.AddWithValue("@mt", (object?)meeting ?? DBNull.Value);'), '회의내용을 파라미터로 묶지 않는다');
    //  저장 성공 뒤에만 __reportWeeklySaved(두 창)
    const h = stripCsComments(member(s.main, 'void INetcusHost.SaveWeeklyReport(string sdate, string edate, string subject, string content, string endwork, string planwork, string? meeting, string? hoursJson)'));
    const save = h.indexOf('bool ok = await db.SaveWeeklyAsync(loginId, sdate, edate, subject, content, endwork, planwork, meeting, hours);');
    assert.ok(h.includes('var hours = hoursJson == null ? null : ParseWeeklyHoursJson(hoursJson);'), '주간 시간줄을 들어오는 자리에서 거르지 않거나, 없는 요청(null)을 빈 목록으로 바꾼다');
    //  주간 과제투입시간(결정 14): 주간 행과 시간 줄을 한 트랜잭션으로, 그 주를 지우고 다시 넣는다(0 시간 제외, 공식 과제 id 꼴만)
    const t = stripCsComments(member(s.rdb, 'public async Task<bool> SaveWeeklyAsync('));
    const iTx = t.indexOf('await using var tx = await conn.BeginTransactionAsync(cts.Token);'), iUp = t.indexOf('INSERT INTO cal_report_weekly "');
    const iDel = t.indexOf('"DELETE FROM cal_report_weekly_hours WHERE user_id=@u AND period_start=@s"'), iIns = t.indexOf('INSERT INTO cal_report_weekly_hours (user_id, period_start, line_no, task_name, project_uid, hours) VALUES ');
    const iCommit = t.indexOf('await tx.CommitAsync(cts.Token);');
    assert.ok(iTx > 0 && iTx < iUp && iUp < iDel && iDel < iIns && iIns < iCommit, '주간 행과 시간 줄이 한 트랜잭션(행, 지우기, 넣기, 커밋 순)이 아니다');
    assert.ok((t.match(/\.Transaction = tx;/g) || []).length >= 3, '주간 저장의 명령이 모두 그 트랜잭션에 묶이지 않았다');
    assert.ok(/if \(hours != null\)/.test(t), '시간 줄이 없는 요청(옛 전송)이 그 주의 줄을 지운다');
    assert.ok(/if \(!WeeklyHoursInDomain\(h\.Hours\)\) continue;/.test(t) && /ProjectUidOk\(h\.ProjectUid\) \? h\.ProjectUid : \(object\)DBNull\.Value/.test(t), '0 시간 제외나 공식 과제 id 꼴 확인이 없다');
    const pj = stripCsComments(member(s.main, 'private List<WeeklyHourLine> ParseWeeklyHoursJson(string? json)'));
    assert.ok(/name\.Length > 200/.test(pj) && /if \(!ReportDb\.WeeklyHoursInDomain\(h\)\)/.test(pj) && /!ReportDb\.ProjectUidOk\(uid\)/.test(pj), 'ParseWeeklyHoursJson 이 과제명 길이, 시간 범위, 공식 과제 id 꼴을 보지 않는다');
    const ws0 = d.slice(d.indexOf('case "netcusWeekSubmit":'), d.indexOf('break;', d.indexOf('case "netcusWeekSubmit":')));
    assert.ok(ws0.includes('doc.RootElement.TryGetProperty("hours", out var whEl) && whEl.ValueKind == JsonValueKind.Array ? whEl.GetRawText() : null'), 'netcusWeekSubmit 이 hours 구조를 배열일 때만 넘기지 않는다');
    //  목록 읽기의 시간 줄: 파라미터로 묶고, 표가 없는 DB(1146)에서는 시간 줄 없이 목록만
    const lw = member(s.rdb, 'public async Task<List<Dictionary<string, object?>>?> ListWeeklyAsync(string? loginId, DateTime from, DateTime to)');
    assert.ok(lw.includes('"WHERE user_id=@u AND period_start BETWEEN @f AND @t ORDER BY period_start, line_no"') && /catch \(MySqlException mex\) when \(mex\.ErrorCode == MySqlErrorCode\.NoSuchTable\)/.test(lw),
      '주간 목록의 시간 줄 읽기가 사람과 기간으로 거르지 않거나 표 없음(1146)을 견디지 않는다');
    //  CHAR(36) 은 MySqlConnector 가 Guid 로 읽는다: GetString(3) 이면 공식 과제 줄이 하나만 있어도 목록 전체가 InvalidCast 로 실패한다(2026-10-30 실측)
    assert.ok(stripCsComments(lw).includes('Convert.ToString(hr.GetValue(3), CultureInfo.InvariantCulture)') && !stripCsComments(lw).includes('hr.GetString(3)'), '주간 목록이 project_uid(CHAR(36), Guid 로 읽힘)를 GetString 으로 꺼낸다');
    const push = h.indexOf('if (ok) ReportPush("window.__reportWeeklySaved && window.__reportWeeklySaved(" + JsonSerializer.Serialize(new { periodStart = sdate }) + ")");');
    assert.ok(save > 0 && push > save, '__reportWeeklySaved 가 저장 성공 뒤에 두 창으로 가지 않는다');
    assert.match(h, /SaveReportRecordWithRetryAsync\("weekly"/, '주간 기록 저장이 재시도 경로(S10)를 지나지 않는다');
    //  netcusWeekSubmit: resultwork 는 문자열 칸이 있을 때만(없으면 null = 인트라넷의 회의내용을 건드리지 않는다)
    const ws = d.slice(d.indexOf('case "netcusWeekSubmit":'), d.indexOf('break;', d.indexOf('case "netcusWeekSubmit":')));
    assert.ok(ws.includes('doc.RootElement.TryGetProperty("resultwork", out var rw) && rw.ValueKind == JsonValueKind.String ? (rw.GetString() ?? "") : null'), 'resultwork 를 칸이 있을 때만 넘기지 않는다');
    //  WeekFill 두 경로: 새 글은 resultwork 칸을 채우고(요청에 있을 때), 수정 화면은 네 칸 채우기(WeekModifyFillJs)에 회의내용을 넘긴다.
    //    미처리사항(notendwork), 문제점(problem)은 어느 경로도 채우지 않는다. 두 경로 모두 회의내용까지 기록한다.
    const wf = member(s.netcus, 'private async Task NetcusWeekFill(NetcusWeekReq req)');
    assert.ok(wf.includes(`(req.Resultwork != null ? $"set('resultwork',{J(req.Resultwork)});" : "")`), '새 글 경로가 회의내용(resultwork)을 채우지 않는다');
    assert.ok(wf.includes('WeekModifyFillJs(req.Endwork, req.Content, req.Planwork, req.Resultwork)'), '수정 경로가 회의내용을 넘기지 않는다');
    assert.ok(!/set\('(notendwork|problem)'/.test(wf), '미처리사항이나 문제점을 채운다');
    assert.strictEqual((wf.match(/_host\.SaveWeeklyReport\(req\.Sdate, req\.Edate, req\.Subject, req\.Content, req\.Endwork, req\.Planwork, req\.Resultwork, req\.HoursJson\);/g) || []).length, 2, '두 경로가 회의내용과 시간 줄까지 기록하지 않는다');
  },

  // ⑨ 로그아웃과 계정 바뀜에 근태 창도 닫힌다
  closeOnLogout(s) {
    const c = member(s.main, 'private void CloseSubWindows()');
    assert.match(c, /var all = _wins\.ToList\(\);\s*_wins\.Clear\(\);\s*foreach \(var kv in all\)/, '따로 뜨는 창을 종류 가리지 않고 모두 닫지 않는다');
    assert.match(member(s.main, 'private void RunUserLogout(string reqId)'), /CloseSubWindows\(\);/, '로그아웃이 따로 뜨는 창을 닫지 않는다');
    assert.match(s.main, /Dispatcher\.Invoke\(CloseSubWindows\);/, '계정이 바뀌어도 따로 뜨는 창을 닫지 않는다');
  },
};

// ══ 계약 ═══════════════════════════════════════════════════════════════
test('근태①: WinKind.Attend 의 값과 등록(주소, 제목, 크기, tw:, 준비 알림, 웹 함수, 닫기 확인, 자리 키)', () => checks.registry(src));
test('근태②: 근태 창 허용 목록이 아홉이고(netcusWeekMerge 없음, attendCatNew, reportWeeklyList, netcusWeekSubmit 있음) 웹 ATTENDWIN_CMD 와 같다', () => checks.whitelist(src));
test('주간⑫: reportWeeklyList 는 세션의 사람과 엄격한 기간으로 읽고(회의내용 포함, 파라미터), 주간 저장은 회의내용을 쓰고 성공 뒤에만 __reportWeeklySaved', () => checks.weekly(src));
test('근태③: attendOpen 은 메인 창만, attendNav 는 근태 창만 받아 메인 창 __attendNavFromWin 을 부른다', () => checks.routing(src));
test('근태④: reportDailyList 는 세션의 사람과 엄격한 기간으로 읽고 SELECT 는 파라미터로 묶는다', () => checks.dailyList(src));
test('결정9⑤: vr==1 에서 저장을 기다린 뒤 결과를 알리고 실패는 공통 안내다', () => checks.decision9(src));
test('결정9⑥: 일간 백그라운드 재시도가 없다(주간은 그대로)', () => checks.noDailyRetry(src));
test('알림⑦: __netcusProgress, __netcusResult 가 메인 창과 근태 창으로 간다(메인 먼저)', () => checks.notifyBoth(src));
test('알림⑧: __reportDailySaved 는 저장 성공 뒤에만 두 창으로 간다', () => checks.savedNotice(src));
test('닫기⑨: 로그아웃과 계정 바뀜은 근태 창도 닫는다', () => checks.closeOnLogout(src));
test('새 과제⑪: attendCatNew 는 근태 창만 받아 메인 창을 앞으로 가져오고 __attendCatNew(과제 창)를 부른다', () => checks.catNew(src));
test('가져오기⑩: attendSourceReq 는 근태 창만, attendSourcePush 는 메인 창만 받아 날짜와 source 를 확인하고 JSON 으로 다시 써서 넘긴다, 근태관리는 읽기만', () => checks.sourceRelay(src));

// ══ 변이: 검사가 실제로 무는가 ═════════════════════════════════════════
test('변이①: 근태 창의 처음 높이를 바꾸면 근태① 이 실패한다', () => {
  const bad = mutate(src.aw, 'DefaultWidth = 1200, DefaultHeight = 860,', 'DefaultWidth = 1200, DefaultHeight = 800,');
  assert.throws(() => checks.registry(with_('aw', bad)), /크기 규칙/);
});

test('변이②: 근태 창 목록에 saveState 를 넣으면 근태② 가 실패한다', () => {
  const bad = mutate(src.main, '"attendWinReady", "attendNav", "reportDailyList", "netcusSubmit",', '"attendWinReady", "attendNav", "reportDailyList", "netcusSubmit", "saveState",');
  assert.throws(() => checks.whitelist(with_('main', bad)), /기획\(§3\.2\)과 다르다/);
});

test('변이②c: 근태 창 목록에 netcusWeekMerge 를 되살리면 근태② 가 실패한다', () => {
  const bad = mutate(src.main, '"attendSourceReq", "netcusViewMonth", "attendCatNew",', '"attendSourceReq", "netcusViewMonth", "attendCatNew", "netcusWeekMerge",');
  assert.throws(() => checks.whitelist(with_('main', bad)), /기획\(§3\.2\)과 다르다|보내면 안 되는/);
});

test('변이⑪: attendCatNew 의 근태 창 가드를 빼면 새 과제⑪ 이 실패한다', () => {
  const bad = mutate(src.main, 'if (fromWin == WinKind.Attend) AttendCatNewToMain();', 'AttendCatNewToMain();');
  assert.throws(() => checks.catNew(with_('main', bad)), /근태 창에서만 받지 않는다/);
});

test('변이⑪b: 메인 창을 앞으로 가져오지 않으면 새 과제⑪ 이 실패한다', () => {
  const bad = mutate(src.main, '            SummonToFront();\n            JsCall("window.__attendCatNew', '            JsCall("window.__attendCatNew');
  assert.throws(() => checks.catNew(with_('main', bad)), /앞으로 가져오지 않는다/);
});

test('변이②b: 웹 목록이 하나 빠지면 근태② 가 실패한다', () => {
  const m = /const ATTENDWIN_CMD = new Set\(\[([\s\S]*?)\]\);/.exec(src.app);
  assert.ok(m, '웹의 ATTENDWIN_CMD 를 찾지 못했다');
  const bad = src.app.replace(m[0], m[0].replace(/'attendNav',?/, ''));
  assert.notStrictEqual(bad, src.app, '변이가 원본을 바꾸지 못했다');
  assert.throws(() => checks.whitelist(with_('app', bad)), /목록이 다르다/);
});

test('변이③: attendOpen 의 메인 창 가드를 빼면 근태③ 이 실패한다', () => {
  const bad = mutate(src.main, 'if (fromWin == null) OpenAttendWindow(rq, doc);', 'OpenAttendWindow(rq, doc);');
  assert.throws(() => checks.routing(with_('main', bad)), /메인 창에서만 받지 않는다/);
});

test('변이③b: attendNav 를 메인 창 대신 근태 창으로 되돌려 보내면 근태③ 이 실패한다', () => {
  const bad = mutate(src.main, 'JsCall("window.__attendNavFromWin && window.__attendNavFromWin("', 'ReportPush("window.__attendNavFromWin && window.__attendNavFromWin("');
  assert.throws(() => checks.routing(with_('main', bad)), /__attendNavFromWin 을 JSON 인자로 부르지 않는다/);
});

test('변이④: SELECT 에서 사람 거르기를 빼면 근태④ 가 실패한다', () => {
  const bad = mutate(src.rdb, '"WHERE user_id=@u AND work_date BETWEEN @f AND @t ORDER BY work_date";', '"WHERE work_date BETWEEN @f AND @t ORDER BY work_date";');
  assert.throws(() => checks.dailyList(with_('rdb', bad)), /사람\(user_id\)과 기간으로 거르지 않거나/);
});

test('변이④b: 목록 회신을 백그라운드 HostReply 로 바꾸면 근태④ 가 실패한다', () => {
  const bad = mutate(src.main, 'error = "보고 기록을 불러오지 못했습니다." }); return; }\n                ReplyOnUi(reqId, new { ok = true, rows });',
    'error = "보고 기록을 불러오지 못했습니다." }); return; }\n                HostReply(reqId, new { ok = true, rows });');
  assert.throws(() => checks.dailyList(with_('main', bad)), /성공 회신이|ReplyOnUi 를 거치지 않는다/);
});

test('변이⑤: 옛 순서(결과 먼저, 저장 나중)로 되돌리면 결정9⑤ 가 실패한다', () => {
  const bad = mutate(src.netcus,
    '                    bool stored = await _host.SaveDailyReport(req.Y, req.M, req.D, req.Status, req.Overtime, req.Content, req.HoursJson);\n                    NetcusResult(stored, stored ? "회사 보고와 기록 저장을 완료했습니다." : "처리를 완료하지 못했습니다. 다시 시도해 주세요.");',
    '                    NetcusResult(stored, stored ? "회사 보고와 기록 저장을 완료했습니다." : "처리를 완료하지 못했습니다. 다시 시도해 주세요.");\n                    bool stored = await _host.SaveDailyReport(req.Y, req.M, req.D, req.Status, req.Overtime, req.Content, req.HoursJson);');
  assert.throws(() => checks.decision9(with_('netcus', bad)), /먼저 알린다/);
});

test('변이⑥: 일간을 백그라운드 재시도로 되돌리면 결정9⑥ 이 실패한다', () => {
  const bad = mutate(src.main, 'try { ok = await Task.Run(() => db.SaveDailyAsync(loginId, y, m, d, st, ot, content, hours)); }',
    'try { _ = Task.Run(() => SaveReportRecordWithRetryAsync("daily", "", db, () => db.SaveDailyAsync(loginId, y, m, d, st, ot, content, hours))); ok = true; }');
  assert.throws(() => checks.noDailyRetry(with_('main', bad)), /백그라운드 재시도|재시도 호출이 남아/);
});

test('변이⑦: 결과 알림을 메인 창으로만 되돌리면 알림⑦ 이 실패한다', () => {
  const bad = mutate(src.netcus, '_host.EvalReport("window.__netcusResult && window.__netcusResult(" + (ok', 'JsCall("window.__netcusResult && window.__netcusResult(" + (ok');
  assert.throws(() => checks.notifyBoth(with_('netcus', bad)), /__netcusResult/);
});

test('변이⑦b: ReportPush 에서 근태 창을 빼면 알림⑦ 이 실패한다', () => {
  const bad = mutate(src.main, '                    try { _ = WinOf(WinKind.Attend)?.Core?.ExecuteScriptAsync(js); } catch { }\n', '');
  assert.throws(() => checks.notifyBoth(with_('main', bad)), /둘 다로 보내지 않는다/);
});

test('변이⑧: __reportDailySaved 를 성공 확인 밖으로 빼면 알림⑧ 이 실패한다', () => {
  const bad = mutate(src.main, '            if (ok)\n            {\n                string date', '            {\n                string date');
  assert.throws(() => checks.savedNotice(with_('main', bad)), /저장 성공\(if \(ok\)\) 안에 있지 않다/);
});

test('변이⑩: attendSourcePush 의 메인 창 가드를 빼면 가져오기⑩ 이 실패한다', () => {
  const bad = mutate(src.main, 'if (fromWin == null) AttendSourceToWin(doc);', 'AttendSourceToWin(doc);');
  assert.throws(() => checks.sourceRelay(with_('main', bad)), /메인 창에서만 받지 않는다/);
});

test('변이⑩b: 가져오기 회신이 받은 글자를 그대로 이어 붙이면 가져오기⑩ 이 실패한다', () => {
  const bad = mutate(src.main, 'JsonSerializer.Serialize(new { date, source = src })', 'src.GetRawText()');
  assert.throws(() => checks.sourceRelay(with_('main', bad)), /JSON 으로 다시 쓰지 않는다|그대로 쓴다/);
});

test('변이⑫: 주간 SELECT 에서 사람 거르기를 빼면 주간⑫ 가 실패한다', () => {
  const bad = mutate(src.rdb, 'WHERE user_id=@u AND period_start BETWEEN @f AND @t ORDER BY period_start DESC', 'WHERE period_start BETWEEN @f AND @t ORDER BY period_start DESC');
  assert.throws(() => checks.weekly(with_('rdb', bad)), /사람과 기간으로 거르지 않거나/);
});
test('변이⑫b: 회의내용 없는 요청이 있던 값을 지우게 하면 주간⑫ 가 실패한다', () => {
  const bad = mutate(src.rdb, 'meeting=COALESCE(VALUES(meeting), meeting)', 'meeting=VALUES(meeting)');
  assert.throws(() => checks.weekly(with_('rdb', bad)), /있던 회의내용을 지운다/);
});
test('변이⑫c: __reportWeeklySaved 를 성공 확인 밖으로 빼면 주간⑫ 가 실패한다', () => {
  const bad = mutate(src.main, 'if (ok) ReportPush("window.__reportWeeklySaved', 'ReportPush("window.__reportWeeklySaved');
  assert.throws(() => checks.weekly(with_('main', bad)), /저장 성공 뒤에/);
});
test('변이⑫e: 주간 시간 줄을 트랜잭션 밖(커밋 뒤)에서 넣으면 주간⑫ 가 실패한다', () => {
  const bad = mutate(src.rdb, '                await tx.CommitAsync(cts.Token);\n                _log("보고 기록 저장: 주간 "', '                _log("보고 기록 저장: 주간 "');
  assert.throws(() => checks.weekly(with_('rdb', bad)), /한 트랜잭션/);
});
test('변이⑫f: 시간 줄이 없는 옛 요청도 그 주의 줄을 지우면 주간⑫ 가 실패한다', () => {
  const bad = mutate(src.rdb, '                if (hours != null)\n', '                if (true)\n');
  assert.throws(() => checks.weekly(with_('rdb', bad)), /옛 전송/);
});
test('변이⑫d: resultwork 를 늘 빈 글로 넘기면(칸이 없어도) 주간⑫ 가 실패한다', () => {
  const bad = mutate(src.main, '(rw.GetString() ?? "") : null', '(rw.GetString() ?? "") : ""');
  assert.throws(() => checks.weekly(with_('main', bad)), /칸이 있을 때만/);
});

test('변이⑩c: 가져오기 회신의 날짜 확인을 빼면 가져오기⑩ 이 실패한다', () => {
  const b = member(src.main, 'private void AttendSourceToWin(JsonDocument doc)');
  const line = b.split('\n').find((l) => l.includes('ReportDb.TryParseYmd(date, out _)'));
  assert.ok(line, '변이 앵커를 찾지 못했다');
  const bad = mutate(src.main, line + '\n', '');
  assert.throws(() => checks.sourceRelay(with_('main', bad)), /날짜 형식을 보지 않는다/);
});

test('변이⑩d: 근태관리 읽기에 값 넣기가 섞이면 가져오기⑩ 이 실패한다', () => {
  const bad = mutate(src.netcus, `raw = await cw.ExecuteScriptAsync("(function(){var c=document.getElementsByName('content')[0];return c?c.value:null;})()");`,
    `raw = await cw.ExecuteScriptAsync("(function(){var c=document.getElementsByName('content')[0];c.value='x';return c?c.value:null;})()");`);
  assert.throws(() => checks.sourceRelay(with_('netcus', bad)), /쓰거나 저장한다/);
});
