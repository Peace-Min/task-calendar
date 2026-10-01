// 서버(DB) 연결 장애 대응 — 호스트 계약 · docs/OFFLINE-RESILIENCE.md §3 · §5 · §6 · §7 · S2 · S9 · S10 · S12
//
// 이 파일이 지키는 것(호스트 쪽만 — 웹 쪽 계약은 웹 시험의 몫이다):
//   ① 분류표(§3) — DbErrors.Classify 하나가 MySQL 번호·예외 종류를 network/auth/schema/unregistered/unknown 으로
//      나눈다. 재시도 가능 = network|unknown 뿐이다.
//   ② 부팅 실패 — __applyStateError(message, {retryable, kind, detail, db, host}) · kind 별 문구.
//   ③ 저장 실패 회신에 kind·detail 이 실린다(ok·conflict·schemaMismatch·error 는 그대로).
//   ④ S9 — 앞선 저장이 network 실패 → 이번 저장이 충돌 → 서버 스냅샷을 다시 읽어 **차이가 없을 때만** 성공 처리.
//   ⑤ dbPing — 연결 3초 · SELECT 1 · 장애 주입을 지난다.
//   ⑥ __dbFault — TC_DEBUG_PORT 실행에서만(DbFault.Enabled 는 그 환경변수에서만 정해진다).
//   ⑦ 모든 DB 열기 지점이 DbFault.ThrowIfActive() 를 지난다(widget/*.cs 전부를 훑는다).
//   ⑧ commit-lost 는 한 발짜리이고 COMMIT **뒤**에 터진다.
//   ⑨ S12 — 연결 끊김 푸시는 network 일 때만 · 2초 이상 디바운스.
//   ⑩ S10 — 보고 기록 저장 재시도 10·30·60초 → 그래도 실패면 __reportRecordFailed.
//   ⑪ 닫기 경고(§6) — _webUnsaved 면 묻고, Windows 세션 종료는 막지 않는다.
//   ⑫ 비밀번호는 어디에도 싣지 않는다 · 정상 상태에서 주기 DB 접속이 없다(A11).
//
//   ★ 검사는 함수로 묶고(checks.*), 아래 변이 시험이 같은 함수에 **망가뜨린 소스**를 넣어 실패를 확인한다 —
//     검사가 실제로 무는지(장식이 아닌지)를 증명하는 것이 변이 시험의 목적이다.
import { readFileSync, readdirSync } from 'node:fs';
import { test, assert, stripCsComments as stripCs, extractCsMember as csMember } from './harness.mjs';

const W = (f) => readFileSync(new URL('../widget/' + f, import.meta.url), 'utf8');
const src = {
  dbe:   W('DbErrors.cs'),
  fault: W('DbFault.cs'),
  off:   W('OfflineHost.cs'),
  main:  W('MainWindow.xaml.cs'),
  cdb:   W('CalendarDb.cs'),
  wdb:   W('CalendarWriteDb.cs'),
  pdb:   W('ProjectDb.cs'),
  rdb:   W('ReportDb.cs'),
  app:   W('App.xaml.cs'),
  upd:   W('Update.cs'),
};
//  ⑦ 은 widget/*.cs 전부를 훑는다 — 새 파일이 연결을 열어도 빠져나가지 못하게.
const widgetCs = () => readdirSync(new URL('../widget/', import.meta.url))
  .filter((f) => f.endsWith('.cs'))
  .map((f) => [f, W(f)]);

function mutate(base, from, to) {
  const out = base.split(from).join(to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}
const with_ = (k, v) => ({ ...src, [k]: v });

// 집합 상수 `Name = new() { 1, 2, 3 }` → 정렬된 숫자 배열
function codeSet(code, name) {
  const m = new RegExp(name + '\\s*=\\s*new\\(\\)\\s*\\{([^}]*)\\}').exec(code);
  assert.ok(m, `분류표 ${name} 를 찾지 못했다(판정 불가 ≠ 통과)`);
  return m[1].split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
}
const sorted = (a) => [...a].sort((x, y) => x - y);

const checks = {
  // ① 분류표 — §3 표와 숫자까지 같다
  classifyTable(s) {
    const code = stripCs(s.dbe);
    assert.deepStrictEqual(codeSet(code, 'NetworkCodes'), sorted([1042, 2002, 2003, 2005, 2006, 2013]),
      'network 번호 집합이 §3 과 다르다');
    assert.deepStrictEqual(codeSet(code, 'AuthCodes'), sorted([1044, 1045, 1142, 1143, 3118]),
      'auth 번호 집합이 §3 과 다르다 — 권한 거부가 재시도로 헛돈다(S6)');
    assert.deepStrictEqual(codeSet(code, 'SchemaCodes'), sorted([1054, 1146]), 'schema 번호 집합이 §3 과 다르다');
    for (const [k, v] of [['Network', 'network'], ['Auth', 'auth'], ['Schema', 'schema'], ['Unregistered', 'unregistered'], ['Unknown', 'unknown']])
      assert.ok(new RegExp(`public const string ${k}\\s*=\\s*"${v}";`).test(code), `DbErrorKind.${k} 값이 "${v}" 가 아니다(웹과 같은 글자여야 한다)`);

    const one = csMember(s.dbe, 'private static string? ClassifyOne(Exception e)');
    assert.ok(/NetworkCodes\.Contains\(me\.Number\)\)\s*return DbErrorKind\.Network;/.test(one), 'network 번호가 network 로 가지 않는다');
    assert.ok(/AuthCodes\.Contains\(me\.Number\)\)\s*return DbErrorKind\.Auth;/.test(one), 'auth 번호가 auth 로 가지 않는다');
    assert.ok(/SchemaCodes\.Contains\(me\.Number\)\)\s*return DbErrorKind\.Schema;/.test(one), 'schema 번호가 schema 로 가지 않는다');
    for (const t of ['SocketException', 'TimeoutException', 'OperationCanceledException'])
      assert.ok(new RegExp(`case ${t}:\\s*return DbErrorKind\\.Network;`).test(one), `${t} 가 network 로 가지 않는다`);
    assert.ok(/case CalendarUserNotFoundException:\s*return DbErrorKind\.Unregistered;/.test(one), '미등록이 unregistered 로 가지 않는다');
    assert.ok(/case DbFaultException f:\s*return f\.Kind;/.test(one), '장애 주입 예외가 자기 Kind 로 분류되지 않는다');
    assert.ok(/IsUnableToConnect\(/.test(one) && /"Unable to connect"/.test(code), "'Unable to connect' 문구를 network 로 보지 않는다");

    const cls = csMember(s.dbe, 'public static string Classify(Exception? ex)');
    assert.ok(/foreach \(var e in Chain\(ex\)\)/.test(cls) && /return DbErrorKind\.Unknown;/.test(cls),
      'Classify 가 예외 사슬을 훑지 않거나 끝을 unknown 으로 닫지 않는다');
    const chain = csMember(s.dbe, 'private static IEnumerable<Exception> Chain(Exception? ex)');
    assert.ok(/AggregateException/.test(chain) && /InnerExceptions/.test(chain) && /InnerException/.test(chain.replace(/InnerExceptions/g, '')),
      'AggregateException·InnerException 을 펼치지 않는다 — 드라이버가 감싼 원인을 놓친다');

    const rt = csMember(s.dbe, 'public static bool IsRetryable(string kind)');
    assert.ok(/kind == DbErrorKind\.Network \|\| kind == DbErrorKind\.Unknown;/.test(rt) && !/Auth|Schema|Unregistered/.test(rt),
      '재시도 가능이 network|unknown 이 아니다');
  },

  // ② 부팅 실패 — kind·detail·db·host 가 실리고 문구가 kind 별이다
  bootError(s) {
    const opt = csMember(s.off, 'private static string StateErrorOpt(bool retryable, string kind, string detail)');
    assert.ok(/new \{ retryable, kind, detail, db = DeployConfig\.DbName, host = DeployConfig\.DbHost \}/.test(opt),
      '부팅 실패 옵션이 {retryable, kind, detail, db, host} 가 아니다');
    const ase = csMember(s.main, 'private void ApplyStateError(string msg, bool retryable, string kind, string detail)');
    assert.ok(/StateErrorOpt\(retryable, kind, detail\)/.test(ase) && /window\.__applyStateError\(/.test(ase),
      'ApplyStateError 가 분류 옵션을 __applyStateError 로 넘기지 않는다');
    const ase2 = csMember(s.main, 'private void ApplyStateError(string msg, bool retryable = true)');
    assert.ok(/retryable \? DbErrorKind\.Unknown : DbErrorKind\.Unregistered/.test(ase2),
      '분류 없는 실패(로그인 없음·미등록)에 kind 가 붙지 않는다');

    const boot = csMember(s.main, 'private async Task BootFromDbAsync()');
    const cap = boot.indexOf('DbErrors.Capture()'), load = boot.indexOf('LoadSnapshotAsync('), apply = boot.indexOf('ApplyBootDbError(cap)');
    assert.ok(cap >= 0 && cap < load && load < apply, '부팅이 조회 실패의 원인 종류를 받아 오지 않는다(Capture → LoadSnapshot → ApplyBootDbError)');
    assert.ok(/if \(snap == null && cap\.HasError\) \{ ApplyBootDbError\(cap\); return; \}/.test(boot), '분류된 실패를 분류 문구로 보내지 않는다');
    for (const lit of ['ApplyStateError("로그인 정보가 없습니다 — 로그인 후 다시 시작하세요", retryable: false)',
                       'ApplyStateError("이 계정이 서버에 등록돼 있지 않습니다 — 관리자에게 문의하세요", retryable: false)'])
      assert.ok(boot.includes(lit), `로그인 없음·미등록 경로가 바뀌었다: ${lit}`);

    const abe = csMember(s.off, 'private void ApplyBootDbError(DbErrorCapture cap)');
    assert.ok(/ApplyStateError\(DbErrors\.BootMessage\(kind\), DbErrors\.IsRetryable\(kind\), kind, cap\.Detail\)/.test(abe),
      '부팅 실패의 문구·재시도 여부가 kind 에서 오지 않는다 — 권한 거부도 3번 헛돈다(S6)');
    const bm = csMember(s.dbe, 'public static string BootMessage(string kind)');
    for (const [k, msg] of [
      ['Network', '서버에 연결할 수 없습니다 — 서버가 꺼져 있거나 네트워크 문제입니다'],
      ['Auth', 'DB 접근이 거부되었습니다 — DB 이름·계정 설정과 서버 권한을 확인하세요(관리자)'],
      ['Schema', 'DB 구조가 이 버전과 맞지 않습니다'],
    ]) assert.ok(new RegExp(`DbErrorKind\\.${k}\\s*=>\\s*"${msg.replace(/[()]/g, '\\$&')}"`).test(bm), `${k} 문구가 계약과 다르다`);
    assert.ok(/_\s*=>\s*"서버 오류로 캘린더를 받지 못했습니다"/.test(bm), 'unknown 문구가 계약과 다르다');

    const snapBody = csMember(s.cdb, 'public async Task<CalendarSnapshot?> LoadSnapshotAsync(');
    const tail = snapBody.slice(snapBody.lastIndexOf('catch (Exception ex)'));
    assert.ok(tail.indexOf('DbErrors.Observe(ex, _log)') >= 0 && tail.indexOf('DbErrors.Observe(ex, _log)') < tail.indexOf('return null;'),
      '부팅 조회가 실패를 분류하지 않고 null 만 돌려준다 — 원인이 화면에 안 온다(§1-1)');
  },

  // ③ 저장 실패 회신 — kind·detail 이 붙고 기존 필드는 그대로
  saveReply(s) {
    const b = csMember(s.main, 'private async Task SaveStateToDbAsync(string reqId, string stateJson, bool replaceAll = false)');
    assert.ok(/ok = false, conflict = r\.Conflict, schemaMismatch = r\.SchemaMismatch, error = r\.Message \?\? "저장하지 못했습니다", kind = r\.Kind, detail = r\.Detail/.test(b),
      '저장 실패 회신이 {ok, conflict, schemaMismatch, error, kind, detail} 이 아니다');
    assert.ok(/public string Kind \{ get; init; \}/.test(s.wdb) && /public string Detail \{ get; init; \}/.test(s.wdb), '저장 결과에 Kind·Detail 이 없다');
    const save = csMember(s.wdb, 'public async Task<CalendarSaveResult> SaveAsync(');
    const c = save.slice(save.lastIndexOf('catch (Exception ex)'));
    assert.ok(/var \(kind, detail\) = DbErrors\.Observe\(ex, _log\);/.test(c) && /Kind = kind, Detail = detail/.test(c),
      '쓰기 실패가 분류되지 않는다 — 웹이 네트워크 끊김과 다른 실패를 가르지 못한다');
  },

  // ④ S9 — 앞선 network 실패 + 충돌 → 다시 읽기 → 차이 없음일 때만 성공
  s9(s) {
    const b = csMember(s.main, 'private async Task SaveStateToDbAsync(string reqId, string stateJson, bool replaceAll = false)');
    const tryAt = b.indexOf('TryResolveAmbiguousSaveAsync(reqId, r, stateJson, snap)'), okAt = b.indexOf('if (r.Ok)');
    assert.ok(tryAt >= 0 && tryAt < okAt, 'S9 해소 시도가 저장 결과 분기 앞에 없다');
    assert.ok(/if \(r\.Kind == DbErrorKind\.Network\) _lastSaveNetworkFail = true;/.test(b), '네트워크 저장 실패를 기억하지 않는다(S9 의 전제)');
    assert.ok(/if \(r\.Ok\)\s*\{\s*_lastSaveNetworkFail = false;/.test(b), '성공한 저장 뒤에 S9 표시를 지우지 않는다');

    const t = csMember(s.off, 'private async Task<bool> TryResolveAmbiguousSaveAsync(string reqId, CalendarSaveResult r, string stateJson, CalendarSnapshot snap)');
    assert.ok(/^[\s\S]*?\{\s*if \(!_lastSaveNetworkFail\) return false;/.test(t), '앞선 저장이 네트워크 실패가 아닐 때도 해소를 시도한다');
    assert.ok(/if \(!\(r\.Conflict \|\| r\.DuplicateKey\)\) return false;/.test(t), '충돌(또는 중복 키)이 아닌 실패를 해소하려 든다');
    const reread = t.indexOf('LoadSnapshotAsync('), diff = t.indexOf('CalendarWriteDb.DiffIsEmpty(stateJson, fresh.StateJson)'),
          adopt = t.indexOf('_calSnap = fresh;'), reply = t.indexOf('resolvedConflict = true');
    assert.ok(reread >= 0 && reread < diff && diff < adopt && adopt < reply, 'S9 순서가 다시 읽기 → 차이 대조 → 채택 → 성공 회신이 아니다');
    assert.ok(/if \(!CalendarWriteDb\.DiffIsEmpty\(stateJson, fresh\.StateJson\)\)\s*\{[^}]*return false;\s*\}/.test(t),
      '차이가 있을 때 충돌로 두지 않는다 — 다른 PC 의 진짜 편집을 덮는다');
    assert.ok(/fresh == null \|\| fresh\.UserId != snap\.UserId\) \{[^}]*return false; \}/.test(t), '다시 읽지 못했거나 다른 사람이면 멈추지 않는다');
    //  성공 회신은 평범한 성공 회신과 **같은 필드**를 갖는다(+ resolvedConflict).
    const normal = /GitReply\(reqId, new \{ (ok = true,[^}]*)\}\);/.exec(b);
    assert.ok(normal, '평범한 성공 회신을 찾지 못했다(판정 불가)');
    const keys = [...normal[1].matchAll(/(\w+) =/g)].map((m) => m[1]);
    const s9reply = /GitReply\(reqId, new \{ ([^}]*resolvedConflict = true[^}]*)\}\);/.exec(t);
    assert.ok(s9reply, 'S9 성공 회신을 찾지 못했다');
    for (const k of keys) assert.ok(new RegExp('\\b' + k + ' =').test(s9reply[1]), `S9 성공 회신에 ${k} 가 없다 — 웹의 성공 분기가 다르게 읽는다`);
    assert.ok(/ok = true/.test(s9reply[1]) && /conflict = false/.test(s9reply[1]), 'S9 회신이 성공이 아니다');

    //  차이 판정이 저장 경로와 **같은 행 투영**을 쓴다(두 벌이면 갈라진다).
    const d = csMember(s.wdb, 'internal static bool DiffIsEmpty(string clientStateJson, string serverStateJson)');
    assert.ok(/Canon\(clientStateJson\)/.test(d) && /Canon\(serverStateJson\)/.test(d) && /catch \{ return false; \}/.test(d),
      '차이 판정이 양쪽을 같은 투영으로 대조하지 않거나, 판정 불가를 성공으로 본다');
    const canon = csMember(s.wdb, 'private static string Canon(string stateJson)');
    const save = csMember(s.wdb, 'public async Task<CalendarSaveResult> SaveAsync(');
    for (const [fn, call] of [['CategoryParams', 'CategoryParams(c, i)'], ['EntryParams', 'EntryParams(e, i, cno)'],
                              ['TodoParams', 'TodoParams(t, i, cno)'], ['PrefParams', 'PrefParams(st)']]) {
      assert.ok(save.includes(call), `저장 경로가 ${fn} 를 쓰지 않는다 — 차이 판정과 저장이 다른 값을 본다`);
      assert.ok(canon.includes(fn + '('), `차이 판정이 ${fn} 를 쓰지 않는다`);
    }
  },

  // ⑤ dbPing
  ping(s) {
    assert.ok(/case "dbPing":[\s\S]{0,200}?_ = RunDbPingAsync\(GetStr\(doc, "reqId"\)\);/.test(s.main), 'dbPing 명령이 배선되지 않았다');
    const p = csMember(s.off, 'private async Task RunDbPingAsync(string reqId)');
    const f = p.indexOf('DbFault.ThrowIfActive();'), c = p.indexOf('new MySqlConnection(CalendarDb.BuildPingConnString())');
    assert.ok(f >= 0 && c > f, '핑이 장애 주입을 지나지 않거나 핑 전용 접속 문자열을 쓰지 않는다');
    assert.ok(/new MySqlCommand\("SELECT 1", conn\)/.test(p), '핑이 SELECT 1 을 하지 않는다');
    assert.ok(/GitReply\(reqId, new \{ ok = true \}\);/.test(p) && /GitReply\(reqId, new \{ ok = false, kind, error = [^,]+, detail \}\);/.test(p),
      '핑 회신이 {ok:true} | {ok:false, kind, error, detail} 이 아니다');
    const cs = csMember(s.cdb, 'internal static string BuildPingConnString()');
    assert.ok(/new MySqlConnectionStringBuilder\(BuildConnString\(\)\)/.test(cs) && /ConnectionTimeout = 3,/.test(cs),
      '핑이 캘린더 접속 대상 + 연결 3초가 아니다');
  },

  // ⑥ __dbFault — 디버그 실행에서만
  faultGate(s) {
    assert.ok(/case "__dbFault":[\s\S]{0,200}?RunDbFault\(GetStr\(doc, "reqId"\), GetStr\(doc, "mode"\)\);/.test(s.main), '__dbFault 명령이 배선되지 않았다');
    const r = csMember(s.off, 'private void RunDbFault(string reqId, string mode)');
    const gate = r.indexOf('if (!DbFault.Enabled)'), set = r.indexOf('DbFault.TrySetMode(');
    assert.ok(gate >= 0 && gate < set, '__dbFault 가 DbFault.Enabled 를 먼저 보지 않는다 — 배포 실행에서 장애를 주입할 수 있다(A10)');
    const deny = r.slice(gate, set);
    assert.ok(/Log\(/.test(deny) && /GitReply\(reqId, new \{ ok = false, error = "디버그 실행에서만 쓸 수 있습니다" \}\);/.test(deny) && /return;/.test(deny),
      '배포 실행의 __dbFault 를 로그·거부 회신 후 끝내지 않는다');
    assert.ok(/GitReply\(reqId, new \{ ok = true, mode = DbFault\.Mode \}\);/.test(r), '성공 회신이 {ok:true, mode} 가 아니다');

    const fc = stripCs(s.fault);
    assert.ok(/public static readonly bool Enabled = DebugPortSet\(Environment\.GetEnvironmentVariable\("TC_DEBUG_PORT"\)\);/.test(fc),
      'DbFault.Enabled 가 TC_DEBUG_PORT 에서 시작 때 한 번 정해지지 않는다');
    const envs = [...fc.matchAll(/GetEnvironmentVariable\("([^"]+)"\)/g)].map((m) => m[1]);
    assert.deepStrictEqual(envs, ['TC_DEBUG_PORT'], 'DbFault 가 TC_DEBUG_PORT 말고 다른 환경변수를 읽는다');
    assert.strictEqual((fc.match(/\bEnabled\s*=(?!=)/g) || []).length, 1, 'DbFault 안에서 Enabled 를 시작 때 말고 또 정한다');
    for (const [f, code] of widgetCs())
      assert.ok(!/DbFault\.Enabled\s*=(?!=)/.test(stripCs(code)), `${f}: DbFault.Enabled 를 바깥에서 바꾼다`);
    assert.ok(/if \(!Enabled\) \{ error = "디버그 실행에서만 쓸 수 있습니다"; return false; \}/.test(csMember(s.fault, 'public static bool TrySetMode(string? mode, out string error)')),
      'TrySetMode 가 두 번째 문(Enabled)을 보지 않는다');
    for (const m of ['off', 'network', 'auth', 'commit-lost']) assert.ok(fc.includes(`case "${m}":`), `mode ${m} 가 없다`);
  },

  // ⑦ 모든 DB 열기 지점이 장애 주입을 지난다(widget/*.cs 전부)
  throwIfActive(s, files = widgetCs()) {
    let total = 0;
    for (const [f, code] of files) {
      const c = stripCs(code);
      for (const m of c.matchAll(/new MySqlConnection\(/g)) {
        total++;
        const before = c.slice(Math.max(0, m.index - 600), m.index);
        const lastOpen = before.lastIndexOf('new MySqlConnection(');
        const fault = before.lastIndexOf('DbFault.ThrowIfActive();');
        assert.ok(fault >= 0 && fault > lastOpen, `${f}: 연결을 여는 자리(offset ${m.index})가 DbFault.ThrowIfActive() 를 지나지 않는다`);
      }
    }
    assert.ok(total >= 7, `DB 연결 생성 지점이 ${total}곳뿐이다(CalendarDb·CalendarWriteDb·ProjectDb×3·ReportDb·dbPing = 7) — 훑기가 헛돈다`);
    for (const [k, label] of [['cdb', 'CalendarDb'], ['wdb', 'CalendarWriteDb'], ['pdb', 'ProjectDb'], ['rdb', 'ReportDb'], ['off', 'dbPing']])
      assert.ok(/DbFault\.ThrowIfActive\(\);/.test(stripCs(s[k])), `${label} 에 장애 주입 지점이 없다`);
    const t = csMember(s.fault, 'public static void ThrowIfActive()');
    assert.ok(/if \(!Enabled\) return;/.test(t), 'ThrowIfActive 가 배포 실행에서도 동작한다');
    assert.ok(/m == Network\)\s*throw new DbFaultException\(DbErrorKind\.Network, 2003,/.test(t) &&
              /m == Auth\)\s*throw new DbFaultException\(DbErrorKind\.Auth, 1045,/.test(t), 'network/auth 주입이 분류표의 종류로 던지지 않는다');
    assert.ok(!/CommitLost/.test(t), 'commit-lost 가 열기 지점에서 터진다 — 그건 COMMIT 뒤 한 발이어야 한다');
  },

  // ⑧ commit-lost — COMMIT 뒤 · 한 발
  commitLost(s) {
    const save = csMember(s.wdb, 'public async Task<CalendarSaveResult> SaveAsync(');
    const commit = save.indexOf('await tx.CommitAsync(ct);'), lost = save.indexOf('DbFault.ConsumeCommitLost()'),
          thr = save.indexOf('throw DbFault.CommitLostException();'), conflictCatch = save.indexOf('catch (ConflictException ex)');
    assert.ok(commit >= 0 && commit < lost && lost < thr && thr < conflictCatch, 'commit-lost 가 COMMIT 뒤·같은 try 안에서 터지지 않는다(S9 재현이 안 된다)');
    const c = csMember(s.fault, 'public static bool ConsumeCommitLost()');
    assert.ok(/Interlocked\.CompareExchange\(ref _mode, Off, CommitLost\) == CommitLost/.test(c), 'commit-lost 가 한 발짜리가 아니다(터진 뒤 off 로 안 돌아간다)');
    assert.ok(/if \(!Enabled\) return false;/.test(c), 'commit-lost 가 배포 실행에서도 터질 수 있다');
    assert.ok(/new DbFaultException\(DbErrorKind\.Network, 2013,/.test(csMember(s.fault, 'public static DbFaultException CommitLostException()')),
      'commit-lost 예외가 network 종류가 아니다 — S9 표시가 서지 않는다');
  },

  // ⑨ S12 — network 일 때만 · 디바운스
  connLost(s) {
    const o = csMember(s.dbe, 'public static (string kind, string detail) Observe(Exception ex, Action<string>? log, bool notify = true)');
    assert.ok(/if \(notify && kind == DbErrorKind\.Network\)\s*\{\s*try \{ NetworkFailure\?\.Invoke\(kind, detail\); \}/.test(o),
      '연결 끊김 통지가 network 만이 아니다 — 설정 문제(auth/schema)까지 재연결 확인을 돌린다');
    assert.ok(/log\?\.Invoke\("DB 오류 분류: kind=" \+ kind \+ " · detail=" \+ detail\)/.test(o), '분류된 실패가 kind·detail 한 줄 로그를 남기지 않는다');
    const n = csMember(s.off, 'private void NotifyConnLost(string kind, string detail)');
    assert.ok(/^[^{]*\{\s*if \(kind != DbErrorKind\.Network\) return;/.test(n), 'NotifyConnLost 가 network 아닌 통지를 걸러 내지 않는다');
    const deb = /private const long ConnLostDebounceMs = (\d+);/.exec(s.off);
    assert.ok(deb && Number(deb[1]) >= 2000, '디바운스가 2초 미만이다(또는 없다)');
    assert.ok(/if \(last != 0 && now - last < ConnLostDebounceMs\) return;/.test(n), '디바운스 검사가 없다 — 한 번의 끊김에 통지가 줄줄이 간다');
    assert.ok(/"window\.__dbConnLost && window\.__dbConnLost\(" \+ JsonSerializer\.Serialize\(new \{ kind, detail \}\) \+ "\)"/.test(n), '__dbConnLost 푸시 모양이 {kind, detail} 이 아니다');
    assert.ok(/DbErrors\.NetworkFailure \+= NotifyConnLost;/.test(csMember(s.off, 'private void OfflineHostInit()')), '통지 구독이 없다');
    assert.ok(/OfflineHostInit\(\);/.test(csMember(s.main, 'private void OnWebMessage(')), 'ready 에서 구독을 걸지 않는다');
    //  관찰 지점 — 실패가 분류기에 닿는가
    const pdbCode = stripCs(s.pdb);
    const offline = pdbCode.split('\n').filter((l) => /return[^;]*OfflineMsg/.test(l) && /catch \(Exception cex\)/.test(l));
    assert.ok(offline.length >= 25, `OfflineMsg catch 자리가 ${offline.length}곳뿐이다(판정 불가)`);
    for (const l of offline) assert.ok(/DbErrors\.Observe\(cex, _log\);/.test(l), `연결 실패 catch 가 분류기에 닿지 않는다: ${l.trim()}`);
    for (const sig of ['public async Task<string?> LoadProjectsJsonAsync()', 'public async Task<string?> LoadAppUserJsonAsync(string? loginId)',
                       'public async Task<string?> LoadUserInfoJsonAsync(string loginId)', 'public async Task<string?> LoadMembersJsonAsync(',
                       'public async Task<string?> LoadTrashJsonAsync(string loginId)', 'public async Task<string?> LoadOrgTitleJsonAsync(string loginId)'])
      assert.ok(/DbErrors\.Observe\(\w+, _log\);/.test(csMember(s.pdb, sig)), `${sig} 의 실패가 분류기에 닿지 않는다`);
    assert.ok(/DbErrors\.Observe\(ex, _log\);/.test(csMember(s.cdb, 'public async Task<string?> LoadPeerScheduleJsonAsync(')), '타인 일정 조회 실패가 분류기에 닿지 않는다');
    assert.ok((stripCs(s.rdb).match(/DbErrors\.Observe\(ex, _log\)/g) || []).length === 2, '보고 기록 저장 실패(일간·주간)가 분류기에 닿지 않는다');
  },

  // ⑩ S10 — 보고 기록 재시도
  reportRetry(s) {
    const daily = csMember(s.main, 'void INetcusHost.SaveDailyReport(');
    assert.ok(/SaveReportRecordWithRetryAsync\("daily", ymd, db,[\s\S]*?db\.SaveDailyAsync\(loginId, y, m, d, st, ot, content, hours\)/.test(daily), '일간 보고 기록이 재시도 경로로 가지 않는다');
    const weekly = csMember(s.main, 'void INetcusHost.SaveWeeklyReport(');
    assert.ok(/SaveReportRecordWithRetryAsync\("weekly", sdate, db,[\s\S]*?db\.SaveWeeklyAsync\(/.test(weekly), '주간 보고 기록이 재시도 경로로 가지 않는다');
    assert.ok(/private static readonly int\[\] ReportRetryDelaysSec = \{ 10, 30, 60 \};/.test(s.off), '재시도 간격이 10·30·60초가 아니다');
    const r = csMember(s.off, 'private async Task SaveReportRecordWithRetryAsync(string which, string date, ReportDb db, Func<Task<bool>> save)');
    const first = r.indexOf('if (await TryReportSaveAsync(label, save)) return;');
    const loop = r.indexOf('foreach (int sec in ReportRetryDelaysSec)');
    const delay = r.indexOf('await Task.Delay(TimeSpan.FromSeconds(sec));');
    const push = r.indexOf('window.__reportRecordFailed && window.__reportRecordFailed(');
    assert.ok(first >= 0 && first < loop && loop < delay && delay < push, '재시도 순서가 첫 시도 → (대기 → 재시도)×3 → 실패 알림이 아니다');
    assert.ok(/if \(db\.LastFailure == null\) return;/.test(r.slice(first, loop)), '건너뜀(로그인 없음·빈 본문)까지 재시도한다');
    assert.ok(/JsonSerializer\.Serialize\(new \{ which, date, error \}\)/.test(r), '__reportRecordFailed 페이로드가 {which, date, error} 가 아니다');
    assert.ok(/LastFailure = null;\s*var date = SafeDate/.test(s.rdb) && /LastFailure = null;\s*var ps = ParseDate/.test(s.rdb), '저장 시작에서 지난 실패 표시를 비우지 않는다');
  },

  // ⑪ 닫기 경고 — 미저장이면 묻고, 세션 종료는 막지 않는다
  closeGuard(s) {
    assert.ok(/case "unsavedState":[\s\S]{0,200}?SetWebUnsaved\(GetBool\(doc, "on"\)\);/.test(s.main), 'unsavedState 명령이 배선되지 않았다');
    const exit = csMember(s.main, 'private void ExitApp()');
    assert.ok(/^[^{]*\{\s*if \(!ConfirmCloseIfUnsaved\("종료"\)\) return;/.test(exit), '종료(✕·트레이·⚙)가 미저장 경고를 먼저 보지 않는다');
    const closing = csMember(s.main, 'private void Window_Closing(object? sender, System.ComponentModel.CancelEventArgs e)');
    assert.ok(/^[^{]*\{\s*if \(!ConfirmCloseIfUnsaved\("창 닫기"\)\) \{ e\.Cancel = true; return; \}/.test(closing), 'Alt+F4 등 창 닫기가 미저장 경고를 보지 않는다(또는 취소해도 닫힌다)');

    const c = csMember(s.off, 'private bool ConfirmCloseIfUnsaved(string via)');
    const box = c.indexOf('MessageBox.Show(');
    assert.ok(box > 0, '확인 창이 없다');
    assert.ok(/^[^{]*\{\s*if \(_closeConfirmed\) return true;/.test(c), '한 번 받은 「예」를 기억하지 않는다 — 종료 → 창 닫기에서 두 번 묻는다');
    const sess = /if \(_sessionEnding \|\| _systemExit\)\s*\{[\s\S]*?return true;\s*\}/.exec(c);
    assert.ok(sess && sess.index < box, 'Windows 세션 종료를 막는다(확인 창보다 앞에서 통과시키지 않는다)');
    const clean = /if \(!_webUnsaved\) \{ _closeConfirmed = true; return true; \}/.exec(c);
    assert.ok(clean && clean.index < box, '미저장이 없어도 묻는다');
    assert.ok(/MessageBoxButton\.YesNo/.test(c) && /if \(yes\) _closeConfirmed = true;\s*return yes;/.test(c), '「아니오」가 닫기를 취소하지 않는다');
    assert.ok(s.off.includes('"저장되지 않은 변경이 있습니다.\\n지금 닫으면 이 변경은 사라집니다.\\n\\n그래도 닫을까요?"'), '확인 문구가 계약과 다르다');
    assert.ok(/_sessionEnding = true;/.test(csMember(s.off, 'internal void MarkSessionEnding(string reason)')), '세션 종료 표시가 서지 않는다');

    const se = csMember(s.app, 'protected override void OnSessionEnding(SessionEndingCancelEventArgs e)');
    assert.ok(/MarkSessionEnding\(/.test(se) && !/e\.Cancel\s*=/.test(se), 'Windows 세션 종료를 가로채 막는다(또는 표시하지 않는다)');
    assert.ok(/MarkSystemExit\("새 인스턴스 인계"\); CleanupTray\(\); Current\?\.Shutdown\(\);/.test(s.app), '새 인스턴스 인계가 닫기 경고에 막힌다');
    assert.ok(/MarkSystemExit\("업데이트 설치"\); ExitApp\(\);/.test(s.upd), '업데이트 설치 종료가 닫기 경고에 막힌다');
  },

  // ⑫ 비밀번호 · 정상 상태 폴링 없음
  hygiene(s) {
    for (const k of ['off', 'fault']) assert.ok(!/Password/i.test(stripCs(s[k]).replace(/"[^"]*"/g, '""')), `${k} 가 비밀번호를 만진다`);
    const dbeCode = stripCs(s.dbe);
    const uses = [...dbeCode.matchAll(/DbPassword/g)];
    assert.strictEqual(uses.length, 1, 'DbErrors 가 비밀번호 상수를 가리기 말고 다른 데 쓴다');
    const san = csMember(s.dbe, 'internal static string Sanitize(string? raw)');
    assert.ok(/DbPassword/.test(san) && /\.Replace\(secret, "\*\*\*"/.test(san), '비밀번호 원문을 가리지 않는다');
    assert.ok(/IndexOf\("password", StringComparison\.OrdinalIgnoreCase\)/.test(san) && /Substring\(0, pw \+ "password"\.Length\)/.test(san),
      "'password' 뒤를 잘라 내지 않는다");
    assert.ok(/return Sanitize\(/.test(csMember(s.dbe, 'public static string Detail(Exception? ex)')), 'detail 이 정화를 거치지 않는다');
    //  회신·푸시의 detail 은 전부 분류기에서 온다(원문 ex.Message 를 직접 싣지 않는다).
    for (const k of ['off', 'main']) {
      for (const m of stripCs(s[k]).matchAll(/detail = ([^,}]+)/g))
        assert.ok(/^(?:cap\.Detail|r\.Detail|ed|""|detail)\s*$/.test(m[1].trim()), `${k}: detail 이 분류기 밖에서 온다 → ${m[0]}`);
    }
    //  A11 — 정상일 때 주기 DB 접속이 없다: 호스트에 핑 타이머가 없고, 핑은 웹 명령으로만 돈다.
    const offCode = stripCs(s.off);
    assert.ok(!/DispatcherTimer|System\.Threading\.Timer|new Timer\(|PeriodicTimer/.test(offCode), '호스트가 스스로 주기 확인을 돈다(폴링 없음 원칙 위반)');
    const pingCalls = [...stripCs(s.main).matchAll(/RunDbPingAsync\(/g)].length + [...offCode.matchAll(/RunDbPingAsync\(/g)].length;
    assert.strictEqual(pingCalls, 2, '핑이 dbPing 명령 말고 다른 곳에서도 돈다(정의 1 + 배선 1 이어야 한다)');
  },
};

// ══ 계약 ═══════════════════════════════════════════════════════════════
test('분류①: DbErrors.Classify 가 §3 표대로 나누고 재시도 가능은 network|unknown 뿐이다', () => checks.classifyTable(src));
test('부팅②: 실패가 {retryable, kind, detail, db, host} 와 kind 별 문구로 간다', () => checks.bootError(src));
test('저장③: 저장 실패 회신에 kind·detail 이 붙는다(기존 필드 유지)', () => checks.saveReply(src));
test('S9④: 네트워크 실패 뒤 충돌은 다시 읽어 차이가 없을 때만 성공 처리한다', () => checks.s9(src));
test('핑⑤: dbPing = 연결 3초 + SELECT 1 + 장애 주입 경유', () => checks.ping(src));
test('주입⑥: __dbFault 는 TC_DEBUG_PORT 실행에서만 받는다(A10)', () => checks.faultGate(src));
test('주입⑦: widget/*.cs 의 모든 DB 연결 생성이 DbFault.ThrowIfActive() 를 지난다', () => checks.throwIfActive(src));
test('주입⑧: commit-lost 는 COMMIT 뒤 한 발이다(S9 재현)', () => checks.commitLost(src));
test('S12⑨: 연결 끊김 푸시는 network 일 때만 · 2초 디바운스 · 모든 실패가 분류기에 닿는다', () => checks.connLost(src));
test('S10⑩: 보고 기록 저장 재시도 10·30·60초 → __reportRecordFailed', () => checks.reportRetry(src));
test('닫기⑪: 미저장이면 묻고, Windows 세션 종료는 막지 않는다', () => checks.closeGuard(src));
test('위생⑫: 비밀번호를 싣지 않고 정상 상태에서 주기 DB 접속이 없다', () => checks.hygiene(src));

// ══ 변이 — 검사가 실제로 무는가 ═════════════════════════════════════════
test('변이①: 1045 를 network 로 옮기면 분류① 이 실패한다', () => {
  let bad = mutate(src.dbe, 'new() { 1042, 2002, 2003, 2005, 2006, 2013 }', 'new() { 1042, 1045, 2002, 2003, 2005, 2006, 2013 }');
  bad = mutate(bad, 'new() { 1044, 1045, 1142, 1143, 3118 }', 'new() { 1044, 1142, 1143, 3118 }');
  assert.throws(() => checks.classifyTable(with_('dbe', bad)), /network 번호 집합|auth 번호 집합/);
});

test('변이②: SocketException 을 unknown 으로 돌리면 분류① 이 실패한다', () => {
  const bad = mutate(src.dbe, 'case SocketException:                   return DbErrorKind.Network;', 'case SocketException:                   return DbErrorKind.Unknown;');
  assert.throws(() => checks.classifyTable(with_('dbe', bad)), /SocketException/);
});

test('변이③: 재시도 가능에 auth 를 넣으면 분류① 이 실패한다', () => {
  const bad = mutate(src.dbe, 'kind == DbErrorKind.Network || kind == DbErrorKind.Unknown;', 'kind == DbErrorKind.Network || kind == DbErrorKind.Unknown || kind == DbErrorKind.Auth;');
  assert.throws(() => checks.classifyTable(with_('dbe', bad)), /재시도 가능/);
});

test('변이④: 부팅 실패를 고정 재시도(true)로 되돌리면 부팅② 가 실패한다', () => {
  const bad = mutate(src.off, 'ApplyStateError(DbErrors.BootMessage(kind), DbErrors.IsRetryable(kind), kind, cap.Detail);',
    'ApplyStateError(DbErrors.BootMessage(kind), true, kind, cap.Detail);');
  assert.throws(() => checks.bootError(with_('off', bad)), /kind 에서 오지 않는다/);
});

test('변이⑤: 부팅 옵션에서 db·host 를 빼면 부팅② 가 실패한다', () => {
  const bad = mutate(src.off, 'new { retryable, kind, detail, db = DeployConfig.DbName, host = DeployConfig.DbHost }', 'new { retryable, kind, detail }');
  assert.throws(() => checks.bootError(with_('off', bad)), /retryable, kind, detail, db, host/);
});

test('변이⑥: 저장 실패 회신에서 kind 를 빼면 저장③ 이 실패한다', () => {
  const bad = mutate(src.main, ', kind = r.Kind, detail = r.Detail });', ' });');
  assert.throws(() => checks.saveReply(with_('main', bad)), /kind, detail/);
});

test('변이⑦: S9 의 차이 대조를 없애면(늘 성공 처리) S9④ 가 실패한다', () => {
  const bad = mutate(src.off, 'if (!CalendarWriteDb.DiffIsEmpty(stateJson, fresh.StateJson))', 'if (false)');
  assert.throws(() => checks.s9(with_('off', bad)), /S9 순서|차이가 있을 때/);
});

test('변이⑧: S9 가 앞선 네트워크 실패 표시를 안 보면 S9④ 가 실패한다', () => {
  const bad = mutate(src.off, '            if (!_lastSaveNetworkFail) return false;\n', '');
  assert.throws(() => checks.s9(with_('off', bad)), /네트워크 실패가 아닐 때도/);
});

test('변이⑨: 네트워크 저장 실패를 기억하지 않으면 S9④ 가 실패한다', () => {
  const bad = mutate(src.main, 'if (r.Kind == DbErrorKind.Network) _lastSaveNetworkFail = true;', 'if (false) _lastSaveNetworkFail = true;');
  assert.throws(() => checks.s9(with_('main', bad)), /기억하지 않는다/);
});

test('변이⑩: 저장 경로가 행 투영을 안 쓰고 제 값을 만들면 S9④ 가 실패한다', () => {
  const bad = mutate(src.wdb, 'var p = TodoParams(t, i, cno);', 'var p = new List<(string, object?)>();');
  assert.throws(() => checks.s9(with_('wdb', bad)), /TodoParams/);
});

test('변이⑪: 핑 연결 대기를 4초로 되돌리면 핑⑤ 가 실패한다', () => {
  const bad = mutate(src.cdb, '                ConnectionTimeout = 3,\n', '                ConnectionTimeout = 4,\n');
  assert.throws(() => checks.ping(with_('cdb', bad)), /연결 3초/);
});

test('변이⑫: 핑이 장애 주입을 건너뛰면 핑⑤ 가 실패한다', () => {
  const bad = mutate(src.off, '                DbFault.ThrowIfActive();\n                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));',
    '                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));');
  assert.throws(() => checks.ping(with_('off', bad)), /장애 주입을 지나지 않/);
});

test('변이⑬: __dbFault 의 DbFault.Enabled 관문을 없애면 주입⑥ 이 실패한다', () => {
  const bad = src.off.replace(/            if \(!DbFault\.Enabled\)\n            \{[\s\S]*?return;\n            \}\n/, '');
  assert.notStrictEqual(bad, src.off, '변이가 원본을 바꾸지 못했다');
  assert.throws(() => checks.faultGate(with_('off', bad)), /DbFault\.Enabled 를 먼저 보지 않는다/);
});

test('변이⑭: Enabled 를 다른 환경변수로 켜면 주입⑥ 이 실패한다', () => {
  const bad = mutate(src.fault, 'Environment.GetEnvironmentVariable("TC_DEBUG_PORT")', 'Environment.GetEnvironmentVariable("TC_FAULT")');
  assert.throws(() => checks.faultGate(with_('fault', bad)), /TC_DEBUG_PORT/);
});

test('변이⑮: ProjectDb 의 연결 관문 하나가 장애 주입을 건너뛰면 주입⑦ 이 실패한다', () => {
  const bad = src.pdb.replace('            DbFault.ThrowIfActive();   // 디버그 장애 주입(OFFLINE-RESILIENCE §7) — 배포 실행에서는 무동작\n', '');
  assert.notStrictEqual(bad, src.pdb, '변이가 원본을 바꾸지 못했다');
  const files = widgetCs().map(([f, c]) => [f, f === 'ProjectDb.cs' ? bad : c]);
  assert.throws(() => checks.throwIfActive(with_('pdb', bad), files), /ProjectDb\.cs: 연결을 여는 자리/);
});

test('변이⑯: 새 파일이 장애 주입 없이 연결을 열면 주입⑦ 이 잡는다(widget/*.cs 전수)', () => {
  const files = [...widgetCs(), ['Sneaky.cs', 'class X { async Task F() { var conn = new MySqlConnection(cs); } }']];
  assert.throws(() => checks.throwIfActive(src, files), /Sneaky\.cs/);
});

test('변이⑰: commit-lost 를 COMMIT 앞으로 옮기면 주입⑧ 이 실패한다', () => {
  let bad = mutate(src.wdb, '                await tx.CommitAsync(ct);\n', '                if (DbFault.ConsumeCommitLost()) throw DbFault.CommitLostException();\n                await tx.CommitAsync(ct);\n');
  bad = bad.replace(/\n                if \(DbFault\.ConsumeCommitLost\(\)\)\n                \{[\s\S]*?\n                \}\n/, '\n');
  assert.throws(() => checks.commitLost(with_('wdb', bad)), /COMMIT 뒤/);
});

test('변이⑱: commit-lost 가 off 로 안 돌아가면(여러 발) 주입⑧ 이 실패한다', () => {
  const bad = mutate(src.fault, 'Interlocked.CompareExchange(ref _mode, Off, CommitLost) == CommitLost', 'Volatile.Read(ref _mode) == CommitLost');
  assert.throws(() => checks.commitLost(with_('fault', bad)), /한 발짜리가 아니다/);
});

test('변이⑲: NotifyConnLost 가 auth 에도 쏘면 S12⑨ 가 실패한다', () => {
  const bad = mutate(src.off, 'if (kind != DbErrorKind.Network) return;', 'if (kind != DbErrorKind.Network && kind != DbErrorKind.Auth) return;');
  assert.throws(() => checks.connLost(with_('off', bad)), /network 아닌 통지/);
});

test('변이⑲b: 분류기가 auth 까지 통지로 올리면 S12⑨ 가 실패한다', () => {
  const bad = mutate(src.dbe, 'if (notify && kind == DbErrorKind.Network)', 'if (notify && kind != DbErrorKind.Unknown)');
  assert.throws(() => checks.connLost(with_('dbe', bad)), /network 만이 아니다/);
});

test('변이⑳: 디바운스를 없애면 S12⑨ 가 실패한다', () => {
  const bad = mutate(src.off, '            if (last != 0 && now - last < ConnLostDebounceMs) return;\n', '');
  assert.throws(() => checks.connLost(with_('off', bad)), /디바운스 검사가 없다/);
});

test('변이㉑: OfflineMsg catch 하나가 분류기를 건너뛰면 S12⑨ 가 실패한다', () => {
  const bad = mutate(src.pdb, 'catch (Exception cex) { DbErrors.Observe(cex, _log); _log("DB 연결 실패(직원 저장): "', 'catch (Exception cex) { _log("DB 연결 실패(직원 저장): "');
  assert.throws(() => checks.connLost(with_('pdb', bad)), /분류기에 닿지 않는다/);
});

test('변이㉒: 재시도 간격을 바꾸면 S10⑩ 이 실패한다', () => {
  const bad = mutate(src.off, '{ 10, 30, 60 }', '{ 1, 1 }');
  assert.throws(() => checks.reportRetry(with_('off', bad)), /10·30·60/);
});

test('변이㉓: 재시도 없이 바로 알리면 S10⑩ 이 실패한다', () => {
  const bad = src.off.replace(/            foreach \(int sec in ReportRetryDelaysSec\)\n            \{[\s\S]*?\n            \}\n/, '');
  assert.notStrictEqual(bad, src.off, '변이가 원본을 바꾸지 못했다');
  assert.throws(() => checks.reportRetry(with_('off', bad)), /재시도 순서/);
});

test('변이㉔: 세션 종료 면제를 없애면 닫기⑪ 이 실패한다', () => {
  const bad = mutate(src.off, 'if (_sessionEnding || _systemExit)', 'if (_systemExit)');
  assert.throws(() => checks.closeGuard(with_('off', bad)), /세션 종료를 막는다/);
});

test('변이㉕: 세션 종료를 취소하면 닫기⑪ 이 실패한다', () => {
  const bad = mutate(src.app, '            base.OnSessionEnding(e);\r\n', '            e.Cancel = true;\r\n            base.OnSessionEnding(e);\r\n');
  assert.throws(() => checks.closeGuard(with_('app', bad)), /세션 종료를 가로채/);
});

test('변이㉖: Alt+F4 경로에서 경고를 빼면 닫기⑪ 이 실패한다', () => {
  const bad = mutate(src.main, '            if (!ConfirmCloseIfUnsaved("창 닫기")) { e.Cancel = true; return; }', '            ');
  assert.throws(() => checks.closeGuard(with_('main', bad)), /창 닫기가 미저장 경고/);
});

test('변이㉗: detail 에 원문 예외를 그대로 실으면 위생⑫ 가 실패한다', () => {
  const bad = mutate(src.off, 'GitReply(reqId, new { ok = false, kind, error = DbErrors.ConnMessage(kind), detail });',
    'GitReply(reqId, new { ok = false, kind, error = DbErrors.ConnMessage(kind), detail = ex.ToString() });');
  assert.throws(() => checks.hygiene(with_('off', bad)), /분류기 밖에서 온다/);
});

test('변이㉘: 호스트가 핑 타이머를 돌리면 위생⑫ 가 실패한다(A11)', () => {
  const bad = src.off + '\nclass T { System.Windows.Threading.DispatcherTimer t = new(); }\n';
  assert.throws(() => checks.hygiene(with_('off', bad)), /주기 확인/);
});
