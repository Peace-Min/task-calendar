// 근태 창과 결정 9 의 호스트 계약(docs/ATTENDANCE-PLAN.md §3, docs/DECISIONS.md 결정 9). 정적 검사와 변이.
//
// 이 파일이 지키는 것(호스트 쪽만. 웹의 근태 화면은 웹 시험의 몫이다):
//   ① 창 종류 WinKind.Attend 의 값(주소, 제목, 최소와 처음 크기, 'tw:' 머리, 준비 알림, 여는 함수, 앞으로 올 때 함수,
//      목록 알림 안 받음, 닫기 전 확인, 자리 기억 키)과 등록(All), 설정의 Attend 자리.
//   ② 근태 창 허용 목록 AttendWinCommands = {attendWinReady, attendNav, reportDailyList, netcusSubmit}. 웹 ATTENDWIN_CMD 와 같다.
//   ③ attendOpen 은 메인 창에서만 받는다. payload 가 객체가 아니면 열지 않는다. attendNav 는 근태 창에서만 받고 메인 창의
//      __attendNavFromWin 을 부른다(날짜는 'YYYY-MM-DD' 만, 인자는 JSON 으로 싣는다).
//   ④ reportDailyList: 사람은 세션에서, 기간은 엄격한 날짜 두 개와 상한, DB 는 UI 스레드 밖, 회신은 ReplyOnUi.
//      ReportDb.ListDailyAsync 의 SELECT 는 사람과 기간으로 거르고 값은 모두 파라미터로 묶는다.
//   ⑤ 결정 9: NetcusSubmit 은 vr==1 에서 저장을 기다린 뒤에 결과를 알리고, 실패면 공통 안내를 띄운다.
//   ⑥ 일간 백그라운드 재시도가 없다(주간은 그대로).
//   ⑦ __netcusProgress, __netcusResult 는 메인 창과 근태 창 둘 다로 간다(메인 먼저).
//   ⑧ __reportDailySaved 는 저장이 성공했을 때만, 두 창 모두로 간다.
//   ⑨ 로그아웃과 계정 바뀜은 따로 뜨는 창을 종류 가리지 않고 모두 닫는다(근태 창 포함).
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

const ATTEND_CMDS = ['attendNav', 'attendWinReady', 'netcusSubmit', 'reportDailyList'];
//  근태 창이 보내면 안 되는 것(내 달력 부팅과 저장, 창 열기, 관리, 창 조작, 주간 전송, 업데이트)
const NEVER = ['ready', 'reloadState', 'saveState', 'replaceAllState', 'unsavedState', 'userLogin', 'userLogout',
  'attendOpen', 'adminOpen', 'peerOpen', 'peerSchedule', 'peerMine', 'membersGet', 'saveProject', 'netcusSaveCreds',
  'netcusWeekSubmit', 'netcusWeekMerge', 'reminderSync', 'updateApply', 'updateCheck', 'close', 'hide', 'pin', '__dbFault'];

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
test('근태②: 근태 창 허용 목록이 넷이고 웹 ATTENDWIN_CMD 와 같다', () => checks.whitelist(src));
test('근태③: attendOpen 은 메인 창만, attendNav 는 근태 창만 받아 메인 창 __attendNavFromWin 을 부른다', () => checks.routing(src));
test('근태④: reportDailyList 는 세션의 사람과 엄격한 기간으로 읽고 SELECT 는 파라미터로 묶는다', () => checks.dailyList(src));
test('결정9⑤: vr==1 에서 저장을 기다린 뒤 결과를 알리고 실패는 공통 안내다', () => checks.decision9(src));
test('결정9⑥: 일간 백그라운드 재시도가 없다(주간은 그대로)', () => checks.noDailyRetry(src));
test('알림⑦: __netcusProgress, __netcusResult 가 메인 창과 근태 창으로 간다(메인 먼저)', () => checks.notifyBoth(src));
test('알림⑧: __reportDailySaved 는 저장 성공 뒤에만 두 창으로 간다', () => checks.savedNotice(src));
test('닫기⑨: 로그아웃과 계정 바뀜은 근태 창도 닫는다', () => checks.closeOnLogout(src));

// ══ 변이: 검사가 실제로 무는가 ═════════════════════════════════════════
test('변이①: 근태 창의 처음 높이를 바꾸면 근태① 이 실패한다', () => {
  const bad = mutate(src.aw, 'DefaultWidth = 1200, DefaultHeight = 860,', 'DefaultWidth = 1200, DefaultHeight = 800,');
  assert.throws(() => checks.registry(with_('aw', bad)), /크기 규칙/);
});

test('변이②: 근태 창 목록에 saveState 를 넣으면 근태② 가 실패한다', () => {
  const bad = mutate(src.main, '"attendWinReady", "attendNav", "reportDailyList", "netcusSubmit",', '"attendWinReady", "attendNav", "reportDailyList", "netcusSubmit", "saveState",');
  assert.throws(() => checks.whitelist(with_('main', bad)), /기획\(§3\.2\)과 다르다/);
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
  const bad = mutate(src.main, 'ReplyOnUi(reqId, new { ok = true, rows });', 'HostReply(reqId, new { ok = true, rows });');
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
