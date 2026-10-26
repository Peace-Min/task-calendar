// 버전 관문: 호스트, DB, 배포 스크립트 계약 (docs/VERSION-GATE.md §2, §4, §5, docs/DB-RELEASE-OPS.md §1~5)
//
// 이 파일이 지키는 것:
//   ① 판정 표: DbGate.Judge 를 소스에서 읽어 값 조합마다 verdict 를 계산한다(정수 비교, 갱신 중 먼저, 모르면 막기).
//   ② 연결 입구 하나: `new MySqlConnection(` 은 DbGate.cs 와 재연결 핑(OfflineHost) 에만 있고, 데이터 계층 넷은 관문으로 연다.
//      관문은 장애 주입, 열기 실패 정리, 메타 한 번 읽기, 판정, 막히면 닫고 던지기 순서다.
//   ③ 쓰기 재확인: CalendarWriteDb.SaveAsync 가 rev 증가 뒤, 삭제 루프 뒤, CommitAsync 바로 앞에서 잠금 없이 다시 읽는다.
//      commit-lost 주입은 여전히 커밋 뒤다.
//   ④ 오류와 회신: kind 'gate'(재시도 안 함), { ok:false } 회신에 gate 정보, 부팅 실패 옵션, 푸시와 재확인 루프.
//   ⑤ 회사 보고: 일간 전송과 주간 채우기가 사이트에 닿기 전에 관문을 본다.
//   ⑥ 업데이트: latest.json 대신 DB 의 app_ 키, 설치 시도 기록을 Setup 실행 전에 쓴다.
//   ⑦ 배포 스크립트: Setup exe 만 복사하고 해시를 다시 재며, 조각 사슬을 빌드 전에 확인하고 release-v<버전>.sql 하나를 만든다
//      (조립과 그 SQL 의 모양, 상태 전이는 tests/release-sql.test.mjs).
//   ⑧ 이관 조각 v14(13 에서 14): 머리, 자기 건너뛰기, 닫힌 상태 확인, 바꾸기, 검증, 구조 번호 올리기 순서. 닫기와 열기는 하지 않는다.
//   ⑨ 정본 시딩: 키 다섯 개, 구조 번호 = 앱 상수.
//   ★ 검사는 함수로 묶고 아래 변이 시험이 같은 함수에 망가뜨린 소스를 넣어 실패를 확인한다.
import { readdirSync } from 'node:fs';
import { test, assert, stripCsComments as stripCs, extractCsMember as csMember, readText } from './harness.mjs';
import { stripSqlComments } from './canon-schema.mjs';

const R = (rel) => readText(new URL('../' + rel, import.meta.url));
const src = {
  gate:   R('widget/DbGate.cs'),
  host:   R('widget/GateHost.cs'),
  dbe:    R('widget/DbErrors.cs'),
  cdb:    R('widget/CalendarDb.cs'),
  wdb:    R('widget/CalendarWriteDb.cs'),
  pdb:    R('widget/ProjectDb.cs'),
  rdb:    R('widget/ReportDb.cs'),
  off:    R('widget/OfflineHost.cs'),
  main:   R('widget/MainWindow.xaml.cs'),
  netcus: R('widget/NetcusService.cs'),
  upd:    R('widget/Update.cs'),
  pub:    R('installer/publish-update.ps1'),
  mig:    R('db/deploy/migrations/v14-version-gate.sql'),
  canon:  R('db/deploy/schema-calendar.sql'),
};
const widgetCs = () => readdirSync(new URL('../widget/', import.meta.url))
  .filter((f) => f.endsWith('.cs'))
  .map((f) => [f, R('widget/' + f)]);

function mutate(base, from, to) {
  const out = base.split(from).join(to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}
const with_ = (k, v) => ({ ...src, [k]: v });
const flat = (s) => s.replace(/\s+/g, ' ');
const idx = (hay, needle, label) => {
  const i = hay.indexOf(needle);
  assert.ok(i >= 0, `${label} 을(를) 찾지 못했다: ${needle}`);
  return i;
};

// ══ ① 판정 표 ═══════════════════════════════════════════════════════════
//  Judge 와 TryParseStructure 의 문장을 소스에서 읽어, 아는 문장만 JS 로 옮겨 돌린다.
//  모르는 문장이 나오면 판정 불가로 실패한다(문장이 바뀌면 이 표도 함께 고칠 것).
const JUDGE_STMTS = {
  'string up = (dbUpdating ?? "").Trim();': (c) => { c.up = (c.dbUpdating ?? '').trim(); },
};
const JUDGE_CONDS = {
  'up == "1"': (c) => c.up === '1',
  'dbUpdating == null || up != "0"': (c) => c.dbUpdating === null || c.up !== '0',
  '!TryParseStructure(dbStructure, out int db)': (c) => { const r = tryParseMirror(c.dbStructure); c.db = r.v; return !r.ok; },
  'db > appStructure': (c) => c.db > c.app,
  'db < appStructure': (c) => c.db < c.app,
};
//  TryParseStructure 의 C# 문장 그대로(공백만 접는다). NumberStyles.None = 부호, 소수점, 공백 없는 숫자만.
const TRY_PARSE_BODY = 'value = 0; if (s == null) return false; string t = s.Trim(); ' +
  'return t.Length > 0 && int.TryParse(t, NumberStyles.None, CultureInfo.InvariantCulture, out value);';
function tryParseMirror(s) {
  if (s === null) return { ok: false, v: 0 };
  const t = s.trim();
  if (!(t.length > 0 && /^[0-9]+$/.test(t))) return { ok: false, v: 0 };
  const v = Number(t);
  return v <= 2147483647 ? { ok: true, v } : { ok: false, v: 0 };
}
function judgeFromSource(gateSrc) {
  const tp = csMember(gateSrc, 'internal static bool TryParseStructure(string? s, out int value)');
  const tpBody = flat(tp.slice(tp.indexOf('{') + 1, tp.lastIndexOf('}'))).trim();
  assert.strictEqual(tpBody, TRY_PARSE_BODY, 'TryParseStructure 문장이 바뀌었다. 판정 표의 숫자 해석을 함께 고칠 것');
  const j = csMember(gateSrc, 'public static GateVerdict Judge(string? dbStructure, string? dbUpdating, int appStructure)');
  const body = j.slice(j.indexOf('{') + 1, j.lastIndexOf('}'));
  const stmts = body.split(';').map((x) => flat(x).trim()).filter(Boolean).map((x) => x + ';');
  const prog = [];
  for (const st of stmts) {
    if (JUDGE_STMTS[st]) { prog.push({ kind: 'do', f: JUDGE_STMTS[st] }); continue; }
    let m = /^if \((.+)\) return GateVerdict\.(\w+);$/.exec(st);
    if (m) {
      const cond = JUDGE_CONDS[m[1]];
      assert.ok(cond, `Judge 의 모르는 조건: ${m[1]}. 판정 표를 함께 고칠 것(판정 불가 ≠ 통과)`);
      prog.push({ kind: 'if', f: cond, v: m[2] });
      continue;
    }
    m = /^return GateVerdict\.(\w+);$/.exec(st);
    assert.ok(m, `Judge 의 모르는 문장: ${st}`);
    prog.push({ kind: 'ret', v: m[1] });
  }
  return (dbStructure, dbUpdating, app) => {
    const c = { dbStructure, dbUpdating, app };
    for (const p of prog) {
      if (p.kind === 'do') p.f(c);
      else if (p.kind === 'if') { if (p.f(c)) return p.v; }
      else return p.v;
    }
    throw new Error('Judge 가 값을 돌려주지 않고 끝났다');
  };
}
const VERDICT_TABLE = [
  //  [구조 번호, 갱신 중, 기대]
  ['14', '0', 'Ok'],
  [' 14 ', '0', 'Ok'],                 // 앞뒤 공백만 걷는다
  ['15', '0', 'NeedUpdate'],
  ['100', '0', 'NeedUpdate'],          // 문자열 비교면 '100' < '14'
  ['13', '0', 'ServerOld'],
  ['9', '0', 'ServerOld'],             // 문자열 비교면 '9' > '14'
  ['014', '0', 'Ok'],                  // 정수로 같다
  ['14', '1', 'Updating'],
  ['15', '1', 'Updating'],             // 갱신 중이 먼저
  [null, '1', 'Updating'],             // 13 에서 14 로 가는 중(구조 번호 행이 아직 없다)
  ['abc', ' 1 ', 'Updating'],
  [null, '0', 'Unknown'],
  ['', '0', 'Unknown'],
  ['abc', '0', 'Unknown'],
  ['1.4', '0', 'Unknown'],
  ['-14', '0', 'Unknown'],
  ['+14', '0', 'Unknown'],
  ['99999999999', '0', 'Unknown'],     // int 범위 밖
  ['14', null, 'Unknown'],             // 갱신 중 표시 행이 없다
  ['14', '', 'Unknown'],
  ['14', '2', 'Unknown'],
  ['14', 'yes', 'Unknown'],
];
const checks = {
  verdictTable(s) {
    const judge = judgeFromSource(s.gate);
    const m = /public const int AppStructureVersion = (\d+);/.exec(stripCs(s.gate));
    assert.ok(m, 'DbGate.AppStructureVersion 을 찾지 못했다');
    //  2026-10-21 회의실 공용화(SHARED-ROOMS, 이관 조각 v15)로 15, 2026-10-22 과제 캘린더(PROJECT-CALENDAR-PLAN, 이관 조각 v16)로 16,
    //  같은 날 월간보고(MONTHLY-REPORT-PLAN, 이관 조각 v17)로 17, 2026-10-26 Git, SVN 삭제(GIT-SVN-REMOVAL, 이관 조각 v18)로 18.
    //  아래 판정 표는 앱 번호를 14 로 주고 판정 함수만 본다.
    assert.strictEqual(m[1], '18', '앱 구조 번호가 18 이 아니다(GIT-SVN-REMOVAL 목표 버전)');
    for (const [db, up, want] of VERDICT_TABLE) {
      assert.strictEqual(judge(db, up, 14), want, `판정이 다르다: db_structure_version=${JSON.stringify(db)}, db_updating=${JSON.stringify(up)}`);
    }
    const sn = csMember(s.gate, 'public static string StateName(GateVerdict v)');
    for (const [v, n] of [['Ok', 'ok'], ['Updating', 'updating'], ['NeedUpdate', 'needUpdate'], ['ServerOld', 'serverOld']])
      assert.ok(sn.includes(`GateVerdict.${v} => "${n}",`), `상태 이름 ${v} → ${n} 이 아니다(웹이 같은 글자로 분기한다)`);
    assert.ok(/_ => "unknown",/.test(sn), '나머지 상태 이름이 unknown 이 아니다');
  },

  // ══ ② 연결 입구 ═════════════════════════════════════════════════════
  singleEntrance(s, files = widgetCs()) {
    const where = {};
    for (const [f, code] of files) {
      const n = (stripCs(code).match(/new MySqlConnection\(/g) || []).length;
      if (n) where[f] = n;
    }
    assert.deepStrictEqual(where, { 'DbGate.cs': 2, 'OfflineHost.cs': 1 },
      `new MySqlConnection( 이 ${JSON.stringify(where)} 에 있다. 관문(DbGate.cs 둘: 입구, 업데이트 확인)과 재연결 핑 하나만 허용`);
    const ping = csMember(s.off, 'private async Task RunDbPingAsync(string reqId)');
    assert.ok(/new MySqlConnection\(CalendarDb\.BuildPingConnString\(\)\)/.test(ping), '핑 밖의 OfflineHost 코드가 연결을 만든다');
    //  데이터 계층 여섯 자리가 관문으로 연다.
    assert.ok(/private static Task<MySqlConnection> OpenReadAsync\(CancellationToken ct\) =>\s*DbGate\.OpenAsync\(BuildConnString\(\), ct\);/.test(stripCs(s.cdb)),
      'CalendarDb.OpenReadAsync 가 관문으로 열지 않는다');
    assert.ok(/DbGate\.OpenWithMetaAsync\(BuildConnString\(\), ct\)/.test(csMember(s.cdb, 'public async Task<CalendarSnapshot?> LoadSnapshotAsync(')),
      '부팅 조회가 관문이 읽은 구조 번호를 쓰지 않는다');
    assert.ok(/await using var conn = await DbGate\.OpenAsync\(BuildConnString\(\), ct\);/.test(csMember(s.wdb, 'public async Task<CalendarSaveResult> SaveAsync(')),
      'CalendarWriteDb.SaveAsync 가 관문으로 열지 않는다');
    for (const sig of ['private static async Task<MySqlConnection> OpenReadAsync(CancellationToken ct)',
                       'private async Task<MySqlConnection> OpenWriteAsync(CancellationToken ct)',
                       'private async Task<MySqlConnection> OpenAdminAsync(CancellationToken ct)'])
      assert.ok(/var conn = await DbGate\.OpenAsync\(BuildConnString\(\), ct\);/.test(csMember(s.pdb, sig)), `ProjectDb ${sig} 가 관문으로 열지 않는다`);
    const rw = csMember(s.rdb, 'private static async Task<MySqlConnection> OpenWriteAsync(CancellationToken ct)');
    assert.ok(/var conn = await DbGate\.OpenAsync\(BuildConnString\(\), ct\);/.test(rw), 'ReportDb.OpenWriteAsync 가 관문으로 열지 않는다');
    assert.ok(/catch \{ await conn\.DisposeAsync\(\); throw; \}/.test(rw), 'ReportDb.OpenWriteAsync 가 프리앰블 실패 때 연결을 닫지 않는다');
    //  관문 안의 순서.
    const o = csMember(s.gate, 'public static async Task<(MySqlConnection conn, GateMeta meta)> OpenWithMetaAsync(string connString, CancellationToken ct)');
    const fault = idx(o, 'DbFault.ThrowIfActive();', '장애 주입');
    const mk = idx(o, 'new MySqlConnection(connString)', '연결 생성');
    const open = idx(o, 'try { await conn.OpenAsync(ct); }', '열기');
    const read = idx(o, 'meta = await ReadMetaAsync(conn, null, ct);', '메타 읽기');
    const judge = idx(o, 'var v = Observe(meta);', '판정');
    const drop = idx(o, 'await conn.DisposeAsync();\n                throw new DbGateException(v, meta);', '막히면 닫고 던지기');
    assert.ok(fault < mk && mk < open && open < read && read < judge && judge < drop, '관문 순서가 (장애 주입, 생성, 열기, 메타, 판정, 닫고 던지기) 가 아니다');
    assert.ok(/catch \{ await conn\.DisposeAsync\(\); throw; \}/.test(o.slice(open, read + 80)), '열기나 메타 읽기 실패 때 연결을 닫지 않는다');
    //  메타 읽기: 키 다섯 개, 잠금 읽기 없음, 트랜잭션을 열지 않는다.
    const sql = /internal const string MetaSql =\s*([\s\S]*?);/.exec(stripCs(s.gate));
    assert.ok(sql, 'MetaSql 을 찾지 못했다');
    for (const k of ['db_structure_version', 'db_updating', 'app_latest_version', 'app_installer_file', 'app_installer_sha256'])
      assert.ok(sql[1].includes(`'${k}'`), `MetaSql 이 ${k} 를 읽지 않는다`);
    for (const code of [stripCs(s.gate), stripCs(s.wdb)])
      assert.ok(!/FOR\s+SHARE|LOCK\s+IN\s+SHARE\s+MODE|FOR\s+UPDATE/i.test(code), '잠금 읽기를 쓴다(앱 계정은 cal_schema_meta 에 SELECT 만 있다)');
    assert.ok(!/BeginTransaction|START TRANSACTION/.test(o), '관문이 트랜잭션을 연다(호출자의 격리수준 프리앰블이 그 뒤에 걸려야 한다)');
    //  업데이트 확인 전용 읽기는 판정하지 않는다(막힌 상태에서도 업데이트 버튼이 동작해야 한다).
    const rr = csMember(s.gate, 'public static async Task<(string latestVersion, string installerFile, string sha256)> ReadReleaseAsync(string connString, CancellationToken ct)');
    assert.ok(/DbFault\.ThrowIfActive\(\);/.test(rr) && !/Observe\(|Judge\(|DbGateException/.test(rr), 'ReadReleaseAsync 가 판정을 하거나 장애 주입을 건너뛴다');
  },

  // ══ ③ 쓰기 재확인 ═══════════════════════════════════════════════════
  writeRecheck(s) {
    const b = csMember(s.wdb, 'public async Task<CalendarSaveResult> SaveAsync(');
    const gateOpen = idx(b, 'await DbGate.OpenAsync(', '관문 열기');
    const tx = idx(b, 'await using var tx = await conn.BeginTransactionAsync(ct);', '트랜잭션 시작');
    const rev = idx(b, 'INSERT INTO cal_user_rev(user_id, rev)', 'rev 증가');
    const lastDel = b.lastIndexOf('await DelTok(conn, tx, "cal_category"');
    const recheck = idx(b, 'var gateMeta = await DbGate.ReadMetaAsync(conn, tx, ct);', '커밋 직전 재확인');
    const commit = idx(b, 'await tx.CommitAsync(ct);', 'CommitAsync');
    const lost = idx(b, 'if (DbFault.ConsumeCommitLost())', 'commit-lost 주입');
    assert.ok(gateOpen < tx, '관문 열기가 트랜잭션 시작보다 뒤다');
    const beforeRev = b.slice(tx + 20, rev);
    assert.ok((beforeRev.match(/await (Exec|Scalar)\(/g) || []).length === 1 && /await Exec\(conn, tx,\s*"$/.test(beforeRev),
      'rev 증가 앞에 다른 문장이 있다(§3.1 첫 문장 규칙)');
    assert.ok(rev < lastDel && lastDel < recheck, '재확인이 rev 증가와 삭제 루프 뒤가 아니다');
    assert.ok(recheck < commit && commit < lost, '재확인이 CommitAsync 바로 앞이 아니거나 commit-lost 주입이 커밋 뒤가 아니다');
    assert.strictEqual((b.match(/await tx\.CommitAsync\(ct\);/g) || []).length, 1, 'CommitAsync 가 둘 이상이다');
    const between = b.slice(recheck, commit);
    assert.ok(/if \(DbGate\.Observe\(gateMeta\) != GateVerdict\.Ok\)/.test(between), '재확인이 판정하지 않는다');
    assert.ok(/await tx\.RollbackAsync\(CancellationToken\.None\);/.test(between), '막혔을 때 롤백하지 않는다');
    assert.ok(/Kind = DbErrorKind\.Gate/.test(between) && /return new CalendarSaveResult/.test(between), '막혔을 때 관문 실패로 돌려주지 않는다');
  },

  // ══ ④ 오류, 회신, 푸시, 재확인 ═══════════════════════════════════════
  errorsAndReplies(s) {
    const dbe = stripCs(s.dbe);
    assert.ok(/public const string Gate\s*=\s*"gate";/.test(dbe), 'DbErrorKind.Gate 가 "gate" 가 아니다');
    assert.ok(/case DbGateException:\s*return DbErrorKind\.Gate;/.test(dbe), '관문 예외를 gate 로 분류하지 않는다');
    assert.ok(/public static bool IsRetryable\(string kind\) => kind == DbErrorKind\.Network \|\| kind == DbErrorKind\.Unknown;/.test(dbe),
      '재시도 대상이 network|unknown 이 아니다(gate 는 재시도하지 않는다)');
    //  회신 장식: 모든 회신(HostReply, ReplyOnUi)이 지나고, ok:false 에만 붙는다.
    const gr = csMember(s.main, 'private void HostReply(string reqId, object payload)');
    assert.ok(/JsonSerializer\.Serialize\(WithGate\(payload\)\)/.test(gr), 'HostReply 가 관문 정보를 붙이지 않는다');
    const ru = csMember(s.main, 'private void ReplyOnUi(string reqId, object payload)');
    assert.ok(/var p = WithGate\(payload\);/.test(ru) && /HostReply\(reqId, p\)/.test(ru), 'ReplyOnUi 가 관문 정보를 붙이지 않는다');
    const wg = csMember(s.host, 'private static object WithGate(object payload)');
    assert.ok(/var g = DbGate\.FlowBlocked;/.test(wg) && /okv\.TryGetValue<bool>\(out bool ok\) && !ok/.test(wg), '관문 정보를 ok:false 회신에만 붙이지 않는다');
    assert.ok(/o\["kind"\] = DbErrorKind\.Gate;/.test(wg) && /o\["gate"\] = JsonSerializer\.SerializeToNode\(DbGate\.ReplyGate\(g\)\);/.test(wg), '회신에 kind gate 와 gate 정보가 없다');
    const rg = csMember(s.gate, 'public static object ReplyGate(GateSnapshot s)');
    assert.ok(/state = s\.State,/.test(rg) && /dbStructure = s\.DbStructure,/.test(rg) && /appStructure = AppStructureVersion,/.test(rg), 'gate 정보가 { state, dbStructure, appStructure } 가 아니다');
    //  흐름 표시는 명령 분기 앞에서 건다.
    const ow = csMember(s.main, 'private void OnWebMessage(CoreWebView2WebMessageReceivedEventArgs e, CoreWebView2? origin)');
    assert.ok(ow.indexOf('using var gateFlow = DbGate.BeginFlow();') > 0 && ow.indexOf('using var gateFlow = DbGate.BeginFlow();') < ow.indexOf('switch (cmd)'),
      '웹 명령마다 관문 흐름 표시를 걸지 않는다');
    assert.ok(/case "gateRecheck":[\s\S]{0,200}?_ = GateRecheckAsync\(rq\);/.test(ow), 'gateRecheck 명령이 배선되지 않았다');
    assert.ok(/case "ready":[\s\S]{0,400}?GateOnReady\(\);/.test(ow), 'ready 때 관문 상태와 설치 실패 기록을 보지 않는다');
    //  부팅 실패 옵션에 gate.
    const abe = csMember(s.off, 'private void ApplyBootDbError(DbErrorCapture cap)');
    assert.ok(/kind == DbErrorKind\.Gate \? \(DbGate\.FlowBlocked \?\? DbGate\.Last\) : null/.test(abe) &&
              /ApplyStateError\(DbErrors\.BootMessage\(kind\), false, kind, cap\.Detail, gate\)/.test(abe), '부팅 실패가 관문 정보를 싣지 않는다');
    assert.ok(/gate = DbGate\.ReplyGate\(gate\)/.test(stripCs(s.host)), '부팅 실패 옵션에 gate 가 없다');
    //  부팅 meta: gate, 옛 schemaMismatch 는 gate 에서.
    assert.ok(/bool schemaMismatch = gate != "ok" \|\|/.test(s.main), '부팅 meta 의 schemaMismatch 가 관문 판정에서 나오지 않는다');
    //  푸시: 메인과 열람 창, 같은 것은 연달아 밀지 않는다.
    const pg = csMember(s.host, 'private void PushGate(string json)');
    assert.ok(/if \(json == _gateLastPushed\) return;/.test(pg), '같은 관문 상태를 연달아 민다');
    //  2026-10-22(ADMIN-WINDOW): 따로 뜨는 창(열람 창, 관리 창) 전부에 민다(_wins). 창이 뜰 때도 그 창에 민다(GatePushToWin).
    assert.ok(/web\.CoreWebView2\?\.ExecuteScriptAsync\(js\)/.test(pg) && /foreach \(var w in _wins\.Values\.ToList\(\)\) \{ try \{ _ = w\.Core\?\.ExecuteScriptAsync\(js\); \} catch \{ \} \}/.test(pg), '메인 창과 따로 뜨는 창(열람 창, 관리 창) 모두에 밀지 않는다');
    assert.ok(/case "adminWinReady":[\s\S]*?GatePushToWin\(fromWin\);/.test(s.main), '따로 뜨는 창이 뜰 때 막힌 상태를 그 창에 밀지 않는다');
    assert.ok(/"window\.__versionGate && window\.__versionGate\("/.test(pg), '__versionGate 로 밀지 않는다');
    const gj = csMember(s.host, 'private string GateJson(GateSnapshot? s, bool forceInstallFailed = false)');
    for (const k of ['state', 'appVersion', 'appStructure', 'dbStructure', 'latestVersion', 'installerPath', 'installFailedTarget', 'attemptCount'])
      assert.ok(gj.includes(`["${k}"]`), `푸시 JSON 에 ${k} 가 없다`);
    assert.ok(/DbGate\.Observed \+= OnGateObserved;/.test(stripCs(s.host)) && /GateHostInit\(\);/.test(s.main), '관문 판정 통지를 구독하지 않는다');
    //  재확인 루프: 갱신 중 30초, 서버 낡음과 모름 5분, 업데이트 필요는 없음, 정상이면 멈춤.
    const tf = csMember(s.host, 'private void GateTimerFor(GateVerdict v)');
    assert.ok(/GateVerdict\.Updating => TimeSpan\.FromSeconds\(30\),/.test(tf), '갱신 중 재확인이 30초가 아니다');
    assert.ok(/GateVerdict\.ServerOld => TimeSpan\.FromMinutes\(5\),/.test(tf) && /GateVerdict\.Unknown => TimeSpan\.FromMinutes\(5\),/.test(tf), '서버 낡음, 모름 재확인이 5분이 아니다');
    assert.ok(/_ => null,/.test(tf) && !/NeedUpdate/.test(tf) && /if \(every == null\) \{ _gateTimer\?\.Stop\(\); return; \}/.test(tf), '업데이트 필요나 정상에서 재확인을 멈추지 않는다');
    assert.ok(/"gateRecheck",/.test(stripCs(s.main).slice(stripCs(s.main).indexOf('PeerWinCommands = new'))), '열람 창이 gateRecheck 를 보낼 수 없다');
    assert.ok(/"gateRecheck"/.test(stripCs(s.main).slice(stripCs(s.main).indexOf('AdminWinCommands = new'), stripCs(s.main).indexOf('PeerReqPrefix ='))), '관리 창이 gateRecheck 를 보낼 수 없다');
  },

  // ══ ⑤ 회사 보고 전송 전 확인 ═══════════════════════════════════════
  netcusPrecheck(s) {
    assert.ok(/Task<bool> GateOkAsync\(\);/.test(stripCs(s.netcus)), 'INetcusHost 에 GateOkAsync 가 없다');
    for (const sig of ['private async Task NetcusSubmit(NetcusReq req)', 'private async Task NetcusWeekFill(NetcusWeekReq req)']) {
      const b = csMember(s.netcus, sig);
      const g = idx(b, 'if (!await _host.GateOkAsync()) { NetcusGateBlocked(); return; }', `${sig} 의 관문 확인`);
      for (const [needle, label] of [['NetcusLoadCreds()', '자격 읽기'], ['await EnsureW2();', '보조 창 준비'], ['NetcusLoginVerify(', '사이트 로그인']])
        assert.ok(g < idx(b, needle, label), `${sig}: 관문 확인이 ${label}보다 뒤다(사이트에 먼저 닿는다)`);
    }
    const nb = csMember(s.netcus, 'private void NetcusGateBlocked()');
    assert.ok(/kind = DbErrorKind\.Gate/.test(nb) && /__netcusResult\(false,/.test(nb), '막혔을 때 kind gate 로 실패를 알리지 않는다');
    const ok = csMember(s.host, 'async Task<bool> INetcusHost.GateOkAsync()');
    assert.ok(/DbGate\.RecheckAsync\(CalendarDb\.BuildConnString\(\), cts\.Token\)/.test(ok) && /return v == GateVerdict\.Ok;/.test(ok), 'GateOkAsync 가 관문으로 판정하지 않는다');
  },

  // ══ ⑥ 업데이트 ═════════════════════════════════════════════════════
  update(s) {
    const code = stripCs(s.upd);
    assert.ok(!/latest\.json/.test(code), 'Update.cs 코드가 아직 latest.json 을 읽는다');
    const chk = csMember(s.upd, 'private async Task CheckForUpdateAsync(bool userInitiated = false)');
    const app = csMember(s.upd, 'private async Task ApplyUpdateAsync()');
    for (const [b, label] of [[chk, '확인'], [app, '적용']])
      assert.ok(/DbGate\.ReadReleaseAsync\(CalendarDb\.BuildConnString\(\), cts\.Token\)/.test(b), `업데이트 ${label}이 DB 의 app_ 키를 읽지 않는다`);
    assert.ok(/if \(mver\.Length == 0\)/.test(chk), '빈 app_latest_version 을 새 버전 없음으로 보지 않는다');
    const write = idx(app, 'WriteUpdateAttempt(mver, file);', '설치 시도 기록');
    const start = idx(app, 'Process.Start(new ProcessStartInfo(dest, "/SILENT /UPDATED=1")', 'Setup 실행');
    assert.ok(write < start, '설치 시도 기록을 Setup 실행 뒤에 쓴다');
    assert.ok(idx(app, 'if (string.IsNullOrWhiteSpace(sha))', '해시 필수') < start, '해시 없이 설치한다');
    assert.ok(/private const string InstallerNotFoundMsg = "새 버전 파일을 찾을 수 없습니다\. 관리자에게 문의해 주세요\.";/.test(code), '파일 없음 문구가 계약과 다르다');
    assert.ok((app.match(/UpdateResult\(false, InstallerNotFoundMsg\)/g) || []).length >= 3, '새 버전 없음, 파일 정보 없음, 파일 없음이 같은 문구로 가지 않는다');
    assert.ok(/Environment\.SpecialFolder\.LocalApplicationData\), "TaskCalendar", "update-attempt\.json"/.test(code), '설치 시도 기록 위치가 %LOCALAPPDATA%\\TaskCalendar\\update-attempt.json 이 아니다');
    const ca = csMember(s.upd, 'private void CheckUpdateAttempt()');
    assert.ok(/if \(!IsNewer\(t, own\)\)[\s\S]*?TryDelete\(UpdateAttemptPath\);/.test(ca), '설치가 됐으면(자기 버전 >= 목표) 기록을 지우지 않는다');
    assert.ok(/_installFailedTarget = a\.target;/.test(ca) && /_installFailedCount = /.test(ca), '설치 실패를 관문 푸시에 넘기지 않는다');
    const wa = csMember(s.upd, 'private void WriteUpdateAttempt(string target, string file)');
    assert.ok(/prev\.target == target \? prev\.count \+ 1 : 1/.test(wa), '같은 목표의 재시도 횟수를 세지 않는다');
    assert.ok(/유일한 주기 DB 읽기/.test(s.upd) && /A11/.test(s.upd), '30분 확인이 A11 의 예외라는 기록이 없다');
  },

  // ══ ⑦ 배포 스크립트 ════════════════════════════════════════════════
  publish(ps) {
    const code = ps.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
    //  latest.json 은 0.22 이하 위젯을 위한 전환용으로 남는다(2026-10-21). 형식은 옛것 그대로이고,
    //  공유폴더에는 exe 복사와 해시 대조가 끝난 뒤 임시 이름에서 바꿔 단다.
    assert.ok(/version = \$ver[\s\S]*file\s+= \$fileName[\s\S]*sha256\s+= \$sha/.test(code), '전환용 latest.json(version, file, sha256)을 만들지 않는다');
    {
      const cp0 = code.slice(code.indexOf('if ($CopyTo) {'));
      const iExe = cp0.indexOf('Copy-Item $setup -Destination $dest -Force'), iHash = cp0.indexOf('if ($copied -ne $sha) { Fail ');
      const iTmp = cp0.indexOf("'latest.json.tmp'"), iMove = cp0.indexOf('Move-Item -LiteralPath $tmp');
      assert.ok(iExe >= 0 && iHash > iExe && iTmp > iHash && iMove > iTmp, '공유폴더 latest.json 이 exe 복사와 해시 대조 뒤, 임시 이름에서 바꿔 달지 않는다');
    }
    assert.ok(/\$structMatch = \[regex\]::Match\(\$gateText, 'public const int AppStructureVersion = \(\\d\+\);'\)/.test(code), '앱 구조 번호를 DbGate.cs 에서 읽지 않는다');
    //  배포 SQL 은 release-sql.ps1 이 조립한다. 조각 사슬은 빌드 전에 확인하고(-CheckOnly), 실패하면 멈춘다.
    assert.ok(/\$relGen = Join-Path \$here 'release-sql\.ps1'/.test(code) && /\$fragDir = Join-Path \$root 'db\\deploy\\migrations'/.test(code), '조립기(release-sql.ps1)와 조각 폴더(db\\deploy\\migrations)를 가리키지 않는다');
    const iCheck = code.indexOf('& $relGen -FragmentDir $fragDir -Structure ([int]$structure) -CheckOnly');
    assert.ok(iCheck > 0 && /-CheckOnly\nif \(\$LASTEXITCODE -ne 0\) \{ Fail /.test(code), '조각 사슬을 확인하지 않거나 실패를 무시한다');
    assert.ok(iCheck < code.indexOf('if ($Build) {'), '조각 사슬 확인이 빌드보다 뒤다(빌드 뒤에야 사슬이 틀린 것을 안다)');
    assert.ok(/\$releaseSql = Join-Path \$distDir "release-v\$ver\.sql"/.test(code), 'release-v<버전>.sql 을 만들지 않는다');
    assert.ok(/& \$relGen -FragmentDir \$fragDir -Structure \(\[int\]\$structure\) -Version \$ver -InstallerFile \$fileName -Sha256 \$sha -Notes \$Notes -OutFile \$releaseSql\nif \(\$LASTEXITCODE -ne 0\) \{ Fail /.test(code),
      '배포 SQL 을 조립기로 만들지 않거나 실패를 무시한다(버전, 파일, 해시를 넘겨야 한다)');
    assert.ok(!/START TRANSACTION|UPDATE cal_schema_meta/.test(code), '배포 스크립트가 SQL 을 직접 쓴다(조립은 release-sql.ps1 한 곳에서)');
    const cp = code.slice(code.indexOf('if ($CopyTo) {'));
    assert.ok(/Copy-Item \$setup -Destination \$dest -Force/.test(cp), 'Setup exe 를 복사하지 않는다');
    assert.ok(/\$copied = \(Get-FileHash -Algorithm SHA256 -Path \$dest\)\.Hash\.ToLower\(\)/.test(cp) && /if \(\$copied -ne \$sha\) \{ Fail /.test(cp), '복사본 해시를 다시 재서 대조하지 않는다');
    assert.ok(!/Remove-Item/.test(cp), '공유폴더의 옛 Setup 을 지운다');
  },

  // ══ ⑧ 이관 조각 v14 ═════════════════════════════════════════════════
  //  release-v<버전>.sql 안에서 닫기와 열기 사이에 돈다(DB-RELEASE-OPS §5.2). 조각 공통 규칙은 tests/release-sql.test.mjs ④.
  migration(mig) {
    assert.ok(/^-- @migration from=13 to=14\r?\n/.test(mig), '첫 줄이 -- @migration from=13 to=14 가 아니다');
    const code = stripSqlComments(mig);
    assert.ok(!/\b(SUPER|GRANT|REVOKE|CREATE\s+USER|SET\s+GLOBAL|PROCEDURE|FUNCTION|TRIGGER|DEFINER|DELIMITER)\b/i.test(code), '쓰지 않기로 한 문장(SUPER, GRANT, CREATE USER, SET GLOBAL, 저장 프로그램)이 있다');
    assert.ok(!/SIGNAL\s+SQLSTATE/i.test(code), 'SIGNAL 을 쓴다(저장 프로그램 밖에서는 못 쓴다)');
    //  가드: 모든 @g 는 PREPARE 로 실행되고 실패 쪽은 '없는 표 SELECT' 다(64자 이내).
    const guards = [...code.matchAll(/SET @g := IF\(([\s\S]*?)\);\s*\nPREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;/g)];
    assert.strictEqual(guards.length, [...code.matchAll(/SET @g := /g)].length, 'PREPARE 로 실행되지 않는 가드가 있다');
    assert.ok(guards.length >= 4, `가드가 ${guards.length}개뿐이다(번호, 닫힘, 검증, 끝 확인)`);
    for (const g of guards) {
      const m = /'SELECT 1 FROM `(중단: [^`]+)`'$/.exec(g[1].trim());
      assert.ok(m, `가드의 실패 쪽이 '없는 표 SELECT' 가 아니다: ${g[1].slice(0, 80)}`);
      assert.ok([...m[1]].length <= 64, `중단 문장이 64자를 넘는다: ${m[1]}`);
    }
    //  확인: 13(옛 키든 새 키든)에서만 바꾸고, 14 이상이면 건너뛰고, 그 밖이면 멈춘다. 바꿀 때는 닫혀 있어야 한다.
    assert.ok(/SET @m_from := COALESCE\(@m_cur, @m_old\);/.test(code) && /SET @m_old := \(SELECT v FROM cal_schema_meta WHERE k = 'schema_version'\);/.test(code), '옛 키 schema_version 을 구조 번호로 읽지 않는다');
    assert.ok(/SET @go := \(@m_from <=> '13'\);/.test(code), '13 에서만 바꾸지 않는다');
    assert.ok(/SET @skip := \(@m_from REGEXP '\^\[0-9\]\{1,6\}\$' AND CAST\(@m_from AS UNSIGNED\) >= 14\);/.test(code), '이미 14 이상인 DB 를 건너뛰지 않는다');
    assert.ok(/SET @g := IF\(@go OR @skip, 'DO 0',/.test(code), '13 도 14 이상도 아니면 멈추지 않는다');
    assert.ok(/SET @g := IF\(NOT @go OR @m_upd <=> '1', 'DO 0',/.test(code), '닫히지 않은 DB(db_updating 1 아님)에서 바꾸기 전에 멈추지 않는다');
    //  닫기와 열기는 release SQL 의 몫: 조각은 db_updating 을 쓰지 않는다.
    assert.ok(!/\b(UPDATE|INSERT|REPLACE|DELETE)\b[^;]*db_updating/i.test(code), '조각이 db_updating 을 쓴다(닫기와 열기는 release SQL 의 몫)');
    assert.ok(!/lock_wait_timeout/.test(code), '잠금 대기 상한은 release SQL 맨 위에 한 번만 둔다');
    //  순서: 닫힘 확인, 표 설명, 새 키 넣기, 옛 키 지우기, 검증, 구조 번호 올리기, 끝 확인.
    const closed = idx(code, "SET @g := IF(NOT @go OR @m_upd <=> '1'", '닫힘 확인');
    const alter = idx(code, "'ALTER TABLE cal_schema_meta COMMENT = ", '표 설명');
    const ins = idx(code, "(''db_structure_version'', ''13''", '새 키 넣기');
    const del = idx(code, "'DELETE FROM cal_schema_meta WHERE k = ''schema_version'''", '옛 키 지우기');
    const verify = idx(code, "'SELECT 1 FROM `중단: v14 조각 검증 실패", '검증');
    const bump = idx(code, "UPDATE cal_schema_meta SET v = '14', updated_at = UTC_TIMESTAMP(3)\n WHERE k = 'db_structure_version' AND v = '13';", '구조 번호 14');
    const end = idx(code, "'SELECT 1 FROM `중단: v14 조각 끝 확인 실패", '끝 확인');
    assert.ok(closed < alter && alter < ins && ins < del && del < verify && verify < bump && bump < end, '순서가 (닫힘 확인, 표 설명, 넣기, 지우기, 검증, 구조 번호 올리기, 끝 확인) 이 아니다');
    for (const m of code.matchAll(/SET @s := IF\(([\s\S]*?)\);\s*\nPREPARE _s/g))
      assert.ok(/^@go,/.test(m[1].trim()) && /'DO 0'$/.test(m[1].trim()), `바꾸는 문장이 @go 로만 실행되지 않는다: ${m[1].slice(0, 60)}`);
    for (const m of code.matchAll(/^\s*(INSERT|DELETE|UPDATE|ALTER|DROP|CREATE)\b[^\n]*/gim))
      assert.ok(/^UPDATE cal_schema_meta SET v = '14'/.test(m[0].trim()), `PREPARE 밖에서 바꾸는 문장은 구조 번호 올리기 하나뿐이어야 한다: ${m[0].trim()}`);
    //  새 키 넣기와 옛 키 지우기는 한 트랜잭션.
    const t1 = code.indexOf('START TRANSACTION;');
    assert.ok(t1 > alter && t1 < ins && code.indexOf('COMMIT;', t1) > del && code.indexOf('COMMIT;', t1) < verify, '새 키 넣기와 옛 키 지우기가 한 트랜잭션이 아니다');
    assert.strictEqual(code.split('START TRANSACTION;').length, 2, '조각 안의 트랜잭션이 하나가 아니다');
    //  검증은 바꿨을 때만, 새 키 다섯 개와 옛 키 없음과 구조 13 을 본다.
    assert.ok(/SET @g := IF\(NOT @go OR \(@m_keys = 5 AND @m_nold = 0 AND @m_cur <=> '13'\), 'DO 0',/.test(code), '검증이 (키 다섯 개, 옛 키 없음, 구조 13) 이 아니다');
    assert.ok(/UTC_TIMESTAMP\(3\)/.test(code) && !/CURRENT_TIMESTAMP|NOW\(\)/i.test(code), 'updated_at 을 UTC_TIMESTAMP(3) 로 쓰지 않는다');
    //  머리말: release SQL 로만 돈다는 것.
    assert.ok(/혼자 실행하지 않는다/.test(mig) && /release-v<버전>\.sql/.test(mig), '머리말에 release SQL 로만 돈다는 설명이 없다');
  },

  // ══ ⑨ 정본 시딩 ═══════════════════════════════════════════════════
  canonSeed(canon, gate) {
    const code = stripSqlComments(canon);
    const m = /INSERT INTO cal_schema_meta \(k, v, updated_at\) VALUES ([\s\S]*?);/.exec(code);
    assert.ok(m, '정본의 cal_schema_meta 시딩을 찾지 못했다');
    const rows = [...m[1].matchAll(/\('(\w+)', '([^']*)', UTC_TIMESTAMP\(3\)\)/g)].map((x) => [x[1], x[2]]);
    const app = /public const int AppStructureVersion = (\d+);/.exec(stripCs(gate))[1];
    assert.deepStrictEqual(rows, [['db_structure_version', app], ['db_updating', '0'], ['app_latest_version', ''],
      ['app_installer_file', ''], ['app_installer_sha256', '']], '정본 시딩이 키 다섯 개(구조 번호 = 앱 상수, 갱신 중 0, app_ 빈 값)가 아니다');
    assert.ok(!/'schema_version'/.test(code), '정본이 아직 옛 키 schema_version 을 시딩한다');
    assert.ok(/v\s+VARCHAR\(64\)/.test(code.slice(code.indexOf('CREATE TABLE cal_schema_meta'))), 'v 가 VARCHAR(64) 가 아니다(sha256 64자가 들어가야 한다)');
  },
};

// ══ 계약 ═══════════════════════════════════════════════════════════════
test('관문①: 판정 표(정수 비교, 갱신 중이 먼저, 행 없음과 숫자 아님은 막기)', () => checks.verdictTable(src));
test('관문②: new MySqlConnection 은 DbGate 와 재연결 핑에만 있고, 데이터 계층 여섯 자리가 관문으로 연다', () => checks.singleEntrance(src));
test('관문③: 저장은 rev 증가와 삭제 뒤, CommitAsync 바로 앞에서 잠금 없이 다시 읽고 막히면 롤백한다', () => checks.writeRecheck(src));
test('관문④: kind gate, ok:false 회신의 gate 정보, 부팅 옵션, __versionGate 푸시, 재확인 루프', () => checks.errorsAndReplies(src));
test('관문⑤: 회사 보고 일간 전송과 주간 채우기는 사이트에 닿기 전에 관문을 본다', () => checks.netcusPrecheck(src));
test('관문⑥: 업데이트는 DB 의 app_ 키를 읽고, 설치 시도 기록을 Setup 실행 전에 쓴다', () => checks.update(src));
test('관문⑦: publish-update.ps1 은 Setup 만 복사해 해시를 대조하고, 조각 사슬을 빌드 전에 확인해 release-v<버전>.sql 하나를 만든다', () => checks.publish(src.pub));
test('관문⑧: 이관 조각 v14(13 에서 14)는 자기 건너뛰기, 닫힘 확인, 바꾸기, 검증, 구조 번호 올리기 순서이고 닫기와 열기를 하지 않는다', () => checks.migration(src.mig));
test('관문⑨: 정본은 키 다섯 개를 시딩하고 구조 번호가 앱 상수와 같다', () => checks.canonSeed(src.canon, src.gate));

// ══ 변이: 검사가 정말 무는지 ═══════════════════════════════════════════
test('변이V1: 구조 번호를 갱신 중보다 먼저 보면 판정 표가 실패한다', () => {
  const bad = mutate(src.gate, '            if (up == "1") return GateVerdict.Updating;\n            if (dbUpdating == null || up != "0") return GateVerdict.Unknown;\n            if (!TryParseStructure(dbStructure, out int db)) return GateVerdict.Unknown;\n',
    '            if (!TryParseStructure(dbStructure, out int db)) return GateVerdict.Unknown;\n            if (up == "1") return GateVerdict.Updating;\n            if (dbUpdating == null || up != "0") return GateVerdict.Unknown;\n');
  assert.throws(() => checks.verdictTable(with_('gate', bad)), /판정이 다르다/);
});
test('변이V2: 비교를 바꾸면(> 를 <) 판정 표가 실패한다', () => {
  const bad = mutate(src.gate, 'if (db > appStructure) return GateVerdict.NeedUpdate;', 'if (db < appStructure) return GateVerdict.NeedUpdate;');
  assert.throws(() => checks.verdictTable(with_('gate', bad)), /판정이 다르다/);
});
test('변이V3: 숫자 해석에 부호를 허용하면 판정 표가 실패한다', () => {
  const bad = mutate(src.gate, 'NumberStyles.None', 'NumberStyles.Integer');
  assert.throws(() => checks.verdictTable(with_('gate', bad)), /TryParseStructure 문장이 바뀌었다/);
});
test('변이V4: 데이터 계층이 연결을 직접 만들면 관문② 가 실패한다', () => {
  const bad = mutate(src.rdb, 'var conn = await DbGate.OpenAsync(BuildConnString(), ct);', 'DbFault.ThrowIfActive();\n            var conn = new MySqlConnection(BuildConnString());\n            await conn.OpenAsync(ct);');
  const files = widgetCs().map(([f, c]) => [f, f === 'ReportDb.cs' ? bad : c]);
  assert.throws(() => checks.singleEntrance(with_('rdb', bad), files), /ReportDb\.cs/);
});
test('변이V5: 관문이 막고도 연결을 닫지 않으면 관문② 가 실패한다', () => {
  const bad = mutate(src.gate, '                await conn.DisposeAsync();\n                throw new DbGateException(v, meta);', '                throw new DbGateException(v, meta);');
  assert.throws(() => checks.singleEntrance(with_('gate', bad)), /막히면 닫고 던지기/);
});
test('변이V6: 재확인을 커밋 뒤로 옮기면 관문③ 이 실패한다', () => {
  let bad = mutate(src.wdb, '                var gateMeta = await DbGate.ReadMetaAsync(conn, tx, ct);\n', '');
  bad = mutate(bad, '                await tx.CommitAsync(ct);\n', '                await tx.CommitAsync(ct);\n                var gateMeta = await DbGate.ReadMetaAsync(conn, tx, ct);\n');
  assert.throws(() => checks.writeRecheck(with_('wdb', bad)), /CommitAsync 바로 앞이 아니/);
});
test('변이V7: 재확인에 FOR SHARE 를 붙이면 관문② 가 실패한다(앱 계정은 SELECT 만)', () => {
  const bad = mutate(src.gate, "'app_installer_sha256')\";", "'app_installer_sha256') FOR SHARE\";");
  assert.throws(() => checks.singleEntrance(with_('gate', bad)), /잠금 읽기/);
});
test('변이V8: 보고 전송의 관문 확인을 빼면 관문⑤ 가 실패한다', () => {
  const bad = src.netcus.replace('if (!await _host.GateOkAsync()) { NetcusGateBlocked(); return; }', '');
  assert.notStrictEqual(bad, src.netcus);
  assert.throws(() => checks.netcusPrecheck(with_('netcus', bad)), /관문 확인/);
});
test('변이V9: 설치 시도 기록을 Setup 실행 뒤로 옮기면 관문⑥ 이 실패한다', () => {
  const nl = src.upd.includes('\r\n') ? '\r\n' : '\n';
  let bad = mutate(src.upd, '                WriteUpdateAttempt(mver, file);' + nl, '');
  bad = mutate(bad, '                await Task.Delay(700);', '                WriteUpdateAttempt(mver, file);' + nl + '                await Task.Delay(700);');
  assert.throws(() => checks.update(with_('upd', bad)), /Setup 실행 뒤에 쓴다/);
});
test('변이V10: 업데이트 확인이 latest.json 으로 돌아가면 관문⑥ 이 실패한다', () => {
  const bad = mutate(src.upd, 'var (mver, _, _) = await DbGate.ReadReleaseAsync(CalendarDb.BuildConnString(), cts.Token);',
    'string json = await FetchTextAsync(CombineUrl(src, "latest.json"), 6000); string mver = json;');
  assert.throws(() => checks.update(with_('upd', bad)), /latest\.json/);
});
test('변이V11: 배포 스크립트가 공유폴더의 옛 Setup 을 지우면 관문⑦ 이 실패한다', () => {
  const bad = mutate(src.pub, '    Copy-Item $setup -Destination $dest -Force', '    Remove-Item (Join-Path $CopyTo "*.exe") -Force\n    Copy-Item $setup -Destination $dest -Force');
  assert.throws(() => checks.publish(bad), /옛 Setup 을 지운다/);
});
test('변이V12: 조각이 스스로 열면(db_updating 0) 관문⑧ 이 실패한다', () => {
  const line = "UPDATE cal_schema_meta SET v = '14', updated_at = UTC_TIMESTAMP(3)\n WHERE k = 'db_structure_version' AND v = '13';\n";
  const bad = mutate(src.mig, line, line + "UPDATE cal_schema_meta SET v = '0', updated_at = UTC_TIMESTAMP(3) WHERE k = 'db_updating';\n");
  assert.throws(() => checks.migration(bad), /db_updating 을 쓴다/);
});
test('변이V13: 구조 번호 올리기를 검증 앞으로 옮기면 관문⑧ 이 실패한다', () => {
  const line = "UPDATE cal_schema_meta SET v = '14', updated_at = UTC_TIMESTAMP(3)\n WHERE k = 'db_structure_version' AND v = '13';\n";
  let bad = mutate(src.mig, line, '');
  bad = mutate(bad, '-- 3) 검증', line + '-- 3) 검증');
  assert.throws(() => checks.migration(bad), /순서가 \(닫힘 확인/);
});
test('변이V14: 이미 14 인 DB 의 건너뛰기를 빼면 관문⑧ 이 실패한다', () => {
  const bad = mutate(src.mig, "SET @skip := (@m_from REGEXP '^[0-9]{1,6}$' AND CAST(@m_from AS UNSIGNED) >= 14);", 'SET @skip := 0;');
  assert.throws(() => checks.migration(bad), /이미 14 이상인 DB/);
});
test('변이V16: 배포 스크립트가 조각 사슬 확인을 빌드 뒤로 미루면 관문⑦ 이 실패한다', () => {
  const chk = '& $relGen -FragmentDir $fragDir -Structure ([int]$structure) -CheckOnly\n';
  let bad = mutate(src.pub, chk, '');
  bad = mutate(bad, '# 3) 설치기 확인', chk + '# 3) 설치기 확인');
  assert.throws(() => checks.publish(bad), /사슬 확인이 빌드보다 뒤다|조각 사슬을 확인하지 않거나/);
});
test('변이V15: 정본이 구조 번호만 앱과 다르게 시딩하면 관문⑨ 가 실패한다', () => {
  const bad = mutate(src.canon, "VALUES ('db_structure_version', '18', UTC_TIMESTAMP(3))", "VALUES ('db_structure_version', '19', UTC_TIMESTAMP(3))");
  assert.throws(() => checks.canonSeed(bad, src.gate), /키 다섯 개/);
});
