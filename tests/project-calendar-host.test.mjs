// 과제 캘린더 P1(DB 와 호스트, 화면 없음) 정적 계약: docs/PROJECT-CALENDAR-PLAN.md §4, §5, §8.2
//
// 이 파일이 지키는 것:
//   ① 정본(schema-calendar.sql 14~15)과 이관 조각(migrations/v16-project-calendar.sql)의 새 표 정의가 글자까지 같다
//      (조각 쪽은 PREPARE 문자열이라 작은따옴표만 두 겹). 조각은 둘을 FK 순서로, 모두 IF NOT EXISTS 와 @go 일 때만 만들고,
//      검증의 열 수와 FK 수가 정본의 정의와 같다.
//   ② 연결은 DbGate.OpenAsync 로만 연다(new MySqlConnection 없음). 읽기와 쓰기 프리앰블이 각자의 격리수준과 UTC 를 건다.
//   ③ 공용 쓰기 트랜잭션은 판정(신원, 내 과제의 쓸 수 있는 과제)으로 시작하고, 일정 행을 잡은 뒤 재시도를 본다.
//      개인 복사는 판정 다음 원본 일정 행 공유 잠금, 그다음 cal_user_rev.
//   ④ 커밋은 한 곳(CommitWithGateAsync)이고 바로 앞에서 관문을 다시 읽는다. 쓰기 명령은 모두 그 함수로 커밋한다.
//   ⑤ 명령 여섯은 메인 창 스위치에만 있다. 관리 창과 열람 창 허용 목록(호스트와 웹 둘 다)에 없고, 그 창에서 오면 거절된다.
//   ⑥ 웹이 보낸 사용자 값을 읽지 않는다: 요청에서 읽는 키가 정해진 목록 안이고, 신원은 세션(UserSession)에서 온다.
//      edit_role 을 보지 않는다. 판정 SQL 은 한 함수(EligibleProjectsAsync)에만 있고 모든 명령이 그것을 거친다.
//   ⑦ 글자 상한 상수(호스트 Limits)가 DDL 칸 폭과 같다(정본과 조각 둘 다).
//   ⑧ 휴지통 과제 영구 삭제가 공용 일정이 있으면 고정 문구로 거부하고, 목록 힌트도 같은 문장을 쓴다.
//   ⑨ 권한: 두 표 모두 DELETE 없음(정본 권한 파일, 서버 계정 파일), 호스트에도 DELETE 문이 없다.
//   ⑩ 개인 복사가 개인 저장과 같은 행 투영과 INSERT 문(CalendarWriteDb)을 쓴다.
//   ⑪ 개인 복사는 한 번 찍는 사본이다(2026-10-22 저녁 결정): 대응표 cal_project_copy 가 어디에도 없고, "이미 복사했나" 로
//      먼저 돌아가는 길이 없으며, 부트스트랩이 copies 를 돌려주지 않는다. 성공하면 늘 개인 스냅샷을 다시 싣는다.
//   ⑫ 과제별 감시점 표(cal_project_rev)와 과제별 판(rev, projectRev)이 없다(2026-10-22 저녁 결정). 과제 영구 삭제와 엇갈린
//      FK 오류(1452, 1451)는 고정 문구 forbidden, 같은 uid 의 동시 생성(1062)은 재시도로 돌려준다.
//   그리고 변이: 위 검사들이 실제로 무는지 원본을 고쳐 본다.
import { test, assert, readText, extractCsMember, stripCsComments } from './harness.mjs';
import { mutate } from './ps-guard-lib.mjs';
import { defOf } from './release-sql-sim.mjs';

const R = (p) => new URL('../' + p, import.meta.url);
const src = {
  pcdb: readText(R('widget/ProjectCalendarDb.cs')),
  host: readText(R('widget/ProjectCalendarHost.cs')),
  main: readText(R('widget/MainWindow.xaml.cs')),
  appwin: readText(R('widget/AppWindow.cs')),
  cwdb: readText(R('widget/CalendarWriteDb.cs')),
  pdb: readText(R('widget/ProjectDb.cs')),
  canon: readText(R('db/deploy/schema-calendar.sql')),
  frag: readText(R('db/deploy/migrations/v16-project-calendar.sql')),
  grants: readText(R('db/deploy/grants-calendar.sql')),
  server: readText(R('db/deploy/server-app-account.sql')),
  html: readText(R('task-calendar-prototype.html')),
};

const TABLES = ['cal_project_event', 'cal_project_change'];
const COMMANDS = ['projectCalendarBootstrap', 'projectCalendarLoad', 'projectCalendarSave',
  'projectCalendarDelete', 'projectCalendarChanges', 'projectCalendarCopy'];

// 정본의 CREATE TABLE 한 개(머리부터 COMMENT='...' 까지, 끝 ; 제외)
function canonDef(canon, t) {
  const m = new RegExp(`CREATE TABLE ${t} \\(([\\s\\S]*?\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci\\s+COMMENT='[^']*')`).exec(canon);
  assert.ok(m, `정본 schema-calendar.sql 에 ${t} 정의가 없다`);
  return m[1];
}
// 조각의 PREPARE 문자열 안 CREATE TABLE IF NOT EXISTS 한 개(작은따옴표를 한 겹으로 되돌린 것)
function fragDef(frag, t) {
  const m = new RegExp(`SET @s := IF\\(@go,\\n  'CREATE TABLE IF NOT EXISTS ${t} \\(([\\s\\S]*?\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci\\s+COMMENT=''(?:[^']|'')*'')',\\n  'DO 0'\\);\\nPREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;`).exec(frag);
  assert.ok(m, `이관 조각에 ${t} 를 @go 일 때만 IF NOT EXISTS 로 만드는 PREPARE 가 없다`);
  return m[1].replace(/''/g, "'");
}
const noLineComments = (sql) => sql.split('\n').map((l) => l.replace(/^\s*--.*$/, '')).join('\n');

const checks = {
  // ══ ① 정본과 조각 ══════════════════════════════════════════════════
  sameDefs(canon, frag) {
    for (const t of TABLES) {
      const c = canonDef(canon, t), f = fragDef(frag, t);
      assert.strictEqual(f, c, `${t}: 이관 조각의 정의가 정본(schema-calendar.sql)과 글자까지 같지 않다`);
      assert.ok(!/--/.test(c), `${t}: 정본 정의 안에 -- 주석이 있다(조각 문자열과 글자로 맞출 수 없다)`);
    }
  },
  fragmentShape(canon, frag) {
    const code = noLineComments(frag);
    assert.ok(/^-- @migration from=15 to=16\n/.test(frag), '첫 줄이 -- @migration from=15 to=16 이 아니다');
    assert.ok(/SET @go := \(@m_cur <=> '15'\);/.test(code) && /SET @skip := \([^;]*>= 16\);/.test(code), '자기 확인(@go 15, @skip 16 이상)이 없다');
    assert.ok(/SET @g := IF\(NOT @go OR @m_upd <=> '1',/.test(code), '바꿀 때 닫힌 상태(db_updating 1)를 요구하지 않는다');
    //  만들기 순서는 FK 순서(event, change)
    const at = TABLES.map((t) => code.indexOf(`'CREATE TABLE IF NOT EXISTS ${t} (`));
    assert.ok(at.every((x) => x > 0) && at.every((x, i) => i === 0 || x > at[i - 1]), `조각이 표를 FK 순서로 만들지 않는다: ${at}`);
    //  바꾸는 문장은 PREPARE 로만: 문장 맨 앞의 CREATE, ALTER, DROP, INSERT 가 없다(구조 번호 올리기 UPDATE 하나만 맨 앞)
    assert.ok(!/^\s*(CREATE|ALTER|DROP|INSERT|REPLACE|DELETE)\b/im.test(code), 'PREPARE 밖에서 바로 실행하는 바꾸기 문장이 있다');
    assert.strictEqual((code.match(/^UPDATE\b/gm) || []).length, 1, 'PREPARE 밖의 UPDATE 가 구조 번호 올리기 하나가 아니다');
    assert.ok(code.includes("UPDATE cal_schema_meta SET v = '16', updated_at = UTC_TIMESTAMP(3)\n WHERE k = 'db_structure_version' AND v = '15';"), '끝의 구조 번호 올리기 줄이 정확한 모양이 아니다');
    for (const [re, why] of [[/\bGRANT\b/i, 'GRANT'], [/\bDELIMITER\b|\bPROCEDURE\b|\bFUNCTION\b|\bTRIGGER\b/i, '저장 프로그램'],
      [/lock_wait_timeout/i, 'lock_wait_timeout'], [/@r_/, '감싸개 변수 @r_'], [/\b(UPDATE|INSERT|REPLACE|DELETE)\b[^;]*db_updating/i, 'db_updating 쓰기']]) {
      assert.ok(!re.test(code), `조각에 쓰지 않기로 한 것(${why})이 있다`);
    }
    //  검증: 표마다 열 수와 FK 수(information_schema)가 정본 정의에서 센 값과 같다. 표 수보다 큰 번호의 변수는 없다
    assert.ok(!new RegExp('@m_[cf]' + (TABLES.length + 1) + '\b').test(code), '조각 검증에 표 수보다 많은 번호의 변수가 남아 있다');
    TABLES.forEach((t, i) => {
      const d = defOf(`CREATE TABLE ${t} (` + canonDef(canon, t));
      assert.ok(new RegExp(`SET @m_c${i + 1} := \\(SELECT COUNT\\(\\*\\) FROM information_schema\\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\\(\\) AND TABLE_NAME = '${t}'\\);`).test(code), `${t} 의 열 수 검증이 없다`);
      assert.ok(new RegExp(`SET @m_f${i + 1} := \\(SELECT COUNT\\(\\*\\) FROM information_schema\\.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE\\(\\) AND TABLE_NAME = '${t}'\\);`).test(code), `${t} 의 FK 수 검증이 없다`);
      assert.ok(new RegExp(`@m_c${i + 1} = ${d.cols} AND @m_f${i + 1} = ${d.fks}\\b`).test(code), `${t} 검증의 기대값이 정본 정의(열 ${d.cols}, FK ${d.fks})와 다르다`);
    });
    assert.ok(code.indexOf('SET @m_c1') > at[TABLES.length - 1] && code.indexOf('SET @m_c1') < code.indexOf("UPDATE cal_schema_meta SET v = '16'"), '검증이 표 만들기 뒤, 구조 번호 올리기 앞이 아니다');
  },
  canonLists(canon) {
    const code = noLineComments(canon);
    for (const t of TABLES) {
      assert.ok(new RegExp(`^DROP TABLE IF EXISTS ${t};`, 'm').test(code), `정본 DROP 목록에 ${t} 가 없다(재적용 1050)`);
    }
    //  2026-10-22 월간보고(이관 조각 v17)로 정본은 17 이다. 이 기능은 16 에서 들어왔으므로 16 이상을 본다(판번호 정합은 schema-guards ⑨).
    const seeded = /VALUES \('db_structure_version', '(\d+)', UTC_TIMESTAMP\(3\)\)/.exec(code);
    assert.ok(seeded && Number(seeded[1]) >= 16, '정본 시드가 16 이상이 아니다');
  },

  // ══ ② 연결과 프리앰블 ═══════════════════════════════════════════════
  connections(pcdb) {
    const code = stripCsComments(pcdb);
    assert.ok(!/new\s+MySqlConnection\s*\(/.test(code), 'ProjectCalendarDb 가 new MySqlConnection 으로 직접 연다(관문 DbGate.OpenAsync 만 쓴다)');
    assert.strictEqual((code.match(/DbGate\.OpenAsync\(/g) || []).length, 1, 'DbGate.OpenAsync 를 부르는 자리가 OpenAsync 한 곳이 아니다');
    assert.ok(/ReadPreambleSql =[^;]*time_zone='\+00:00'[^;]*transaction_isolation='REPEATABLE-READ'/.test(code), '읽기 프리앰블이 UTC 와 REPEATABLE-READ 가 아니다');
    assert.ok(/WritePreambleSql =[^;]*time_zone='\+00:00'[^;]*transaction_isolation='READ-COMMITTED'/.test(code), '쓰기 프리앰블이 UTC 와 READ-COMMITTED 가 아니다');
    assert.ok(/innodb_lock_wait_timeout=5/.test(code), '잠금 대기 상한 5초가 없다');
  },

  // ══ ③ 트랜잭션 첫 문장과 잠금 순서 ══════════════════════════════════
  firstStatement(pcdb) {
    const code = stripCsComments(pcdb);
    //  과제별 감시점 표(cal_project_rev)는 없다(2026-10-22 저녁 결정). 공용 쓰기는 판정으로 시작한다.
    assert.ok(!/cal_project_rev|ProjectRev/.test(code), 'ProjectCalendarDb 에 과제별 감시점(cal_project_rev)이 남아 있다');
    //  트랜잭션을 여는 곳은 둘뿐: 공용 쓰기(BeginSharedWriteAsync)와 개인 복사(CopyAsync)
    assert.strictEqual((code.match(/BeginTransactionAsync\(/g) || []).length, 2, '트랜잭션을 여는 자리가 둘(공용 쓰기, 개인 복사)이 아니다');
    const begin = stripCsComments(extractCsMember(pcdb, 'BeginSharedWriteAsync(\n            MySqlConnection conn'));
    const afterBegin = begin.slice(begin.indexOf('BeginTransactionAsync(') + 'BeginTransactionAsync('.length);
    const iId = afterBegin.indexOf('await IdentityAsync(conn, tx, login, ct)'), iReq = afterBegin.indexOf('await RequireProjectAsync(conn, tx, me, projectUid, write: true, ct, lockProject: true)');
    assert.ok(iId >= 0 && iReq > iId, '공용 쓰기 트랜잭션이 판정(신원, 그다음 과제 행을 잠그는 쓰기 판정)으로 시작하지 않는다');
    //  과제 행 공유 잠금: 판정 SQL 하나(EligibleProjectsAsync)에 FOR SHARE OF p 를 붙인다(규칙을 둘로 나누지 않는다)
    const elig = stripCsComments(extractCsMember(pcdb, 'private static async Task<List<Proj>> EligibleProjectsAsync('));
    assert.ok(/\(lockProject \? " FOR SHARE OF p" : ""\)/.test(elig), '판정 SQL 이 과제 행 공유 잠금(FOR SHARE OF p)을 걸지 못한다');
    assert.ok(/EligibleProjectsAsync\(conn, tx, me\.UserId, projectUid, ct, lockProject\)/.test(stripCsComments(extractCsMember(pcdb, 'private static async Task<Proj> RequireProjectAsync('))), 'RequireProjectAsync 가 잠금 선택을 판정 함수에 넘기지 않는다');
    assert.ok(!/Exec\(|ExecuteScalarAsync|ExecuteReaderAsync|ExecuteNonQueryAsync|new MySqlCommand/.test(afterBegin.slice(0, iId)), '공용 쓰기 트랜잭션의 첫 문장이 판정이 아니다(판정 앞에 다른 문장이 있다)');
    for (const fn of ['private async Task<object> SaveAsync(', 'private async Task<object> DeleteAsync(']) {
      const b = stripCsComments(extractCsMember(pcdb, fn));
      assert.ok(/BeginSharedWriteAsync\(conn, login, projectUid, ct\)/.test(b), `${fn} 가 BeginSharedWriteAsync 로 트랜잭션을 열지 않는다`);
      assert.ok(!/BeginTransactionAsync\(/.test(b), `${fn} 가 트랜잭션을 직접 연다(판정 규칙을 우회한다)`);
      //  일정 행을 먼저 잡고 그다음 재시도 확인(같은 변경 id 의 동시 재시도가 두 번 적히지 않게)
      const iLock = b.indexOf('EventByUidForUpdateAsync('), iReplay = b.indexOf('ReplayAsync(');
      assert.ok(iLock > b.indexOf('BeginSharedWriteAsync(') && iReplay > iLock, `${fn} 가 일정 행을 잡은 뒤에 재시도를 확인하지 않는다`);
      assert.ok(!/FOR UPDATE|FOR SHARE|EventByUid/.test(b.slice(0, b.indexOf('BeginSharedWriteAsync('))), `${fn} 가 과제 행보다 일정 행을 먼저 잠근다`);
    }
    const copy = stripCsComments(extractCsMember(pcdb, 'private async Task<object> CopyAsync('));
    const iBegin = copy.indexOf('BeginTransactionAsync('), iMe = copy.indexOf('await IdentityAsync(conn, tx, login, ct)'),
      iProj = copy.indexOf('await RequireProjectAsync(conn, tx, me, projectUid, write: false, ct, lockProject: true)'),
      iShare = copy.indexOf('await EventByUidForShareAsync(conn, tx, eventUid, ct)'),
      iUser = copy.indexOf('CalendarWriteDb.BumpUserRevInTxAsync('), iIns = copy.indexOf('CalendarWriteDb.InsertEntryInTxAsync(');
    assert.ok(iBegin > 0 && iMe > iBegin && iProj > iMe && iShare > iProj && iUser > iShare && iIns > iUser, '개인 복사의 잠금 순서가 과제 행(공유), 원본 일정(공유), cal_user_rev 가 아니다');
    assert.ok(!/Exec\(|ExecuteScalarAsync|ExecuteReaderAsync/.test(copy.slice(iBegin, iMe).replace(/BeginTransactionAsync\([^)]*\)/, '')), '개인 복사가 판정 앞에서 다른 문장을 실행한다');
    assert.ok(/EventByUidForShareAsync\([^)]*\) =>\s*await EventWhereAsync\(conn, tx, "e\.uid=@uid FOR SHARE OF e"/.test(code), '복사의 원본 읽기가 일정 행 공유 잠금(FOR SHARE OF e)이 아니다');
  },

  // ══ ④ 커밋 직전 관문 ═══════════════════════════════════════════════
  gateBeforeCommit(pcdb) {
    const code = stripCsComments(pcdb);
    assert.strictEqual((code.match(/\.CommitAsync\(/g) || []).length, 1, 'CommitAsync 가 한 곳(CommitWithGateAsync)에만 있지 않다');
    const c = extractCsMember(pcdb, 'private async Task CommitWithGateAsync(');
    const iRead = c.indexOf('DbGate.ReadMetaAsync(conn, tx, ct)'), iObs = c.indexOf('DbGate.Observe(gateMeta) != GateVerdict.Ok'), iCommit = c.indexOf('tx.CommitAsync(');
    assert.ok(iRead > 0 && iObs > iRead && iCommit > iObs, '커밋 바로 앞에 관문 재확인(ReadMetaAsync, Observe)이 없다');
    assert.ok(/SafeRollbackAsync\(tx\)[\s\S]*throw new DbGateException/.test(c.slice(iObs, iCommit)), '관문이 막으면 롤백하고 멈추지 않는다');
    for (const fn of ['private async Task<object> SaveAsync(', 'private async Task<object> DeleteAsync(', 'private async Task<object> CopyAsync(']) {
      const b = extractCsMember(pcdb, fn);
      assert.ok(/await CommitWithGateAsync\(conn, tx, ct\);/.test(b), `${fn} 가 CommitWithGateAsync 로 커밋하지 않는다`);
    }
  },

  // ══ ⑤ 메인 창 전용 명령 ════════════════════════════════════════════
  mainOnly(main, appwin, html, pcdb, host) {
    const code = stripCsComments(main);
    const setOf = (name) => {
      const m = new RegExp(`internal static readonly HashSet<string> ${name} = new\\(StringComparer\\.Ordinal\\)\\s*\\{([\\s\\S]*?)\\};`).exec(code);
      assert.ok(m, `${name} 를 찾지 못했다`);
      return new Set([...m[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]));
    };
    const peer = setOf('PeerWinCommands'), admin = setOf('AdminWinCommands');
    for (const c of COMMANDS) {
      assert.ok(!peer.has(c), `${c} 가 열람 창 허용 목록(PeerWinCommands)에 있다`);
      assert.ok(!admin.has(c), `${c} 가 관리 창 허용 목록(AdminWinCommands)에 있다`);
      assert.ok(code.includes(`case "${c}":`), `메인 창 스위치에 ${c} 가 없다`);
    }
    //  여섯 case 가 한 덩어리로 RunProjectCalendarAsync 를 부른다
    assert.ok(new RegExp(COMMANDS.map((c) => `case "${c}":\\s*`).join('') + '_ = RunProjectCalendarAsync\\(cmd, GetStr\\(doc, "reqId"\\), raw\\);\\s*break;').test(code),
      '여섯 명령이 한 덩어리로 RunProjectCalendarAsync 를 부르지 않는다');
    //  따로 뜨는 창의 거절: 그 종류의 허용 목록(WinKind.Commands = 위 두 집합) 밖이면 거절 회신
    assert.ok(/if \(!fromWin\.Commands\.Contains\(cmd\)/.test(code) && /에서는 할 수 없는 요청입니다/.test(code), '따로 뜨는 창의 허용 목록 밖 명령을 거절하는 분기가 없다');
    assert.ok(/Commands = MainWindow\.PeerWinCommands/.test(appwin) && /Commands = MainWindow\.AdminWinCommands/.test(appwin), 'AppWindow 의 창 종류 허용 목록이 MainWindow 의 두 집합이 아니다');
    //  웹 쪽 거름(PEERWIN_CMD, ADMINWIN_CMD)에도 없다
    for (const name of ['PEERWIN_CMD', 'ADMINWIN_CMD']) {
      const m = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(html);
      assert.ok(m, `웹의 ${name} 를 찾지 못했다`);
      for (const c of COMMANDS) assert.ok(!m[1].includes(`'${c}'`), `웹의 ${name} 에 ${c} 가 있다`);
    }
    //  호스트 쪽 명령 목록과 배선이 같은 여섯이다
    const listed = /internal static readonly string\[\] Commands =\s*\{([\s\S]*?)\};/.exec(stripCsComments(pcdb));
    assert.ok(listed, 'ProjectCalendarDb.Commands 가 없다');
    assert.deepStrictEqual([...listed[1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort(), [...COMMANDS].sort(), 'ProjectCalendarDb.Commands 가 여섯 명령과 다르다');
    for (const c of COMMANDS) assert.ok(new RegExp(`case "${c}":`).test(stripCsComments(pcdb)), `ProjectCalendarDb.HandleAsync 에 ${c} 가 없다`);
    assert.ok(/new ProjectCalendarDb\(_dataDir, Log\)\.HandleAsync\(cmd, raw\)/.test(host) && /ReplyOnUi\(reqId, r\.ToPayload\(\)\)/.test(host), '배선이 HandleAsync 회신을 ReplyOnUi 로 보내지 않는다');
  },

  // ══ ⑥ 신원, 판정, 웹 값 ════════════════════════════════════════════
  identity(pcdb) {
    const code = stripCsComments(pcdb);
    const ALLOWED = new Set(['projectUid', 'eventUid', 'mutationUid', 'expectedVersion', 'event', 'title', 'startDate', 'endDate',
      'startTime', 'endTime', 'location', 'memo', 'projectUids', 'from', 'to', 'changedFrom', 'changedTo', 'kind', 'fieldFilter',
      'cursor', 'changedAt', 'changeNo', 'limit']);
    //  요청 JSON 에서 읽는 키: Str(q|e|cur, "k"), ReqUid/ReqClientId/OptVersion/ReqDate/UidList/OptInstant(q, "k"), TryGetProperty("k")
    const keys = new Set();
    for (const m of code.matchAll(/\b(?:Str|ReqUid|ReqClientId|OptVersion|ReqDate|UidList|OptInstant)\((?:q|e|cur|evEl), "(\w+)"/g)) keys.add(m[1]);
    for (const m of code.matchAll(/\bq\.TryGetProperty\("(\w+)"|\bcur\.TryGetProperty\("(\w+)"/g)) keys.add(m[1] || m[2]);
    assert.ok(keys.size >= 10, `요청 키를 ${keys.size}개만 찾았다(정규식이 빗나갔다)`);
    for (const k of keys) assert.ok(ALLOWED.has(k), `요청에서 정해진 목록 밖의 값(${k})을 읽는다(웹이 보낸 사용자 값을 쓰지 않는다)`);
    assert.ok(!/"(loginId|login_id|userId|user_id|actor|userName)"\s*\)/.test(code.replace(/rd\["user_id"\]/g, '')), '요청에서 사용자 값을 읽는 것처럼 보이는 키가 있다');
    //  신원은 세션에서, 활성 사용자만, edit_role 은 보지 않는다
    const sess = extractCsMember(pcdb, 'private string SessionLoginId(');
    assert.ok(/UserSession\.Load\(_dataDir, _log\)/.test(sess), '신원을 세션(UserSession.Load)에서 읽지 않는다');
    const idf = extractCsMember(pcdb, 'private static async Task<Me> IdentityAsync(');
    assert.ok(/SELECT user_id, name, is_active FROM app_user WHERE login_id=@id/.test(idf) && /is_active"\], CultureInfo\.InvariantCulture\) != 1\) throw new PcFail\(Kind\.Forbidden/.test(idf), '신원 확인이 활성 사용자(app_user)만 통과시키지 않는다');
    assert.ok(!/edit_role/.test(code), 'ProjectCalendarDb 가 edit_role 을 본다(공용 쓰기는 역할과 무관, §5.2)');
    //  판정 SQL(cal_category, source='db')은 한 함수에만, 모든 명령이 그 함수를 거친다
    assert.strictEqual((code.match(/c\.source='db'/g) || []).length, 2, "판정 SQL(c.source='db')이 EligibleSql 과 참여자 수 두 곳이 아니다");
    assert.strictEqual((code.match(/\bEligibleSql\b/g) || []).length, 2, 'EligibleSql 을 EligibleProjectsAsync 밖에서도 쓴다');
    assert.ok(extractCsMember(pcdb, 'private static async Task<List<Proj>> EligibleProjectsAsync(').includes('EligibleSql'), '판정 함수가 EligibleSql 을 쓰지 않는다');
    //  공용 쓰기(저장, 삭제)는 BeginSharedWriteAsync 가 신원과 쓰기 판정을 한다
    const begin = extractCsMember(pcdb, 'BeginSharedWriteAsync(\n            MySqlConnection conn');
    assert.ok(/IdentityAsync\(/.test(begin) && /RequireProjectAsync\(conn, tx, me, projectUid, write: true, ct, lockProject: true\)/.test(begin), 'BeginSharedWriteAsync 가 신원과 쓰기 판정(숨긴 과제 거부)을 하지 않는다');
    for (const fn of ['private async Task<object> BootstrapAsync(', 'private async Task<object> LoadAsync(', 'private async Task<object> SaveAsync(',
      'private async Task<object> DeleteAsync(', 'private async Task<object> ChangesAsync(', 'private async Task<object> CopyAsync(']) {
      const b = extractCsMember(pcdb, fn);
      const viaBegin = /BeginSharedWriteAsync\(conn, login, projectUid, ct\)/.test(b);
      assert.ok(viaBegin || /EligibleProjectsAsync\(|RequireProjectAsync\(/.test(b), `${fn} 가 판정 함수를 거치지 않는다`);
      assert.ok(/SessionLoginId\(\)/.test(b) && (viaBegin || /IdentityAsync\(/.test(b)), `${fn} 가 세션 신원을 확인하지 않는다`);
    }
    assert.ok(/RequireProjectAsync\(conn, tx, me, projectUid, write: false, ct, lockProject: true\)/.test(extractCsMember(pcdb, 'private async Task<object> CopyAsync(')), '개인 복사가 읽기 판정(숨긴 과제도 허용)을 쓰지 않는다');
  },

  // ══ ⑦ 글자 상한 = DDL 칸 폭 ════════════════════════════════════════
  limits(pcdb, canon, frag) {
    const code = stripCsComments(pcdb);
    const lim = (n) => { const m = new RegExp(`public const int ${n} = (\\d+);`).exec(code); assert.ok(m, `Limits.${n} 가 없다`); return Number(m[1]); };
    const L = { Title: lim('Title'), Location: lim('Location'), Name: lim('Name'), Memo: lim('Memo') };
    assert.deepStrictEqual(L, { Title: 200, Location: 200, Name: 200, Memo: 8000 }, '글자 상한이 기획(제목, 장소, 이름 200, 메모 8,000)과 다르다');
    for (const [label, defs] of [['정본', (t) => canonDef(canon, t)], ['조각', (t) => fragDef(frag, t)]]) {
      const col = (t, c) => { const m = new RegExp(`^\\s*${c}\\s+([A-Z]+(?:\\(\\d+\\))?)`, 'm').exec(defs(t)); assert.ok(m, `${label} ${t}.${c} 가 없다`); return m[1]; };
      assert.strictEqual(col('cal_project_event', 'title'), `VARCHAR(${L.Title})`, `${label}: title 칸 폭이 Limits.Title 과 다르다`);
      assert.strictEqual(col('cal_project_event', 'location'), `VARCHAR(${L.Location})`, `${label}: location 칸 폭이 Limits.Location 과 다르다`);
      for (const [t, c] of [['cal_project_event', 'created_by_name'], ['cal_project_event', 'updated_by_name'], ['cal_project_change', 'actor_name'],
        ['cal_project_change', 'title_snapshot']]) {
        assert.strictEqual(col(t, c), `VARCHAR(${L.Name})`, `${label}: ${t}.${c} 칸 폭이 Limits.Name 과 다르다`);
      }
      assert.strictEqual(col('cal_project_event', 'memo'), 'TEXT', `${label}: memo 가 TEXT 가 아니다`);
      assert.ok(L.Memo * 4 <= 65535, 'Limits.Memo 가 TEXT(65,535바이트, utf8mb4 4바이트)에 들어가지 않는다');
    }
    //  넘으면 자르지 않고 거절한다
    const v = extractCsMember(pcdb, 'private static Fields ValidateFields(');
    for (const n of ['Title', 'Location', 'Memo']) assert.ok(new RegExp(`CountChars\\(f\\.${n}\\) > Limits\\.${n}\\) throw new PcFail\\(Kind\\.Invalid`).test(v), `${n} 상한 초과를 invalid 로 거절하지 않는다`);
    assert.ok(!/\.Substring\(|\.Remove\(|Truncate/.test(v), '일정 값 검사가 글자를 자른다');
  },

  // ══ ⑧ 휴지통 ═══════════════════════════════════════════════════════
  trash(pdb) {
    const code = stripCsComments(pdb);
    assert.ok(/internal const string TrashProjectSharedMsg = "[^"]+";/.test(code), '공용 일정 거부 고정 문구(TrashProjectSharedMsg)가 없다');
    const del = extractCsMember(pdb, 'public async Task<(bool ok, string msg)> DeleteTrashAsync(');
    const iCount = del.indexOf('SELECT COUNT(*) FROM cal_project_event e JOIN project p ON p.id = e.project_id WHERE p.uid=@k');
    const iRefuse = del.indexOf('return (false, TrashProjectSharedMsg)');
    const iDelete = del.indexOf('case "project":  delSql = "DELETE FROM project WHERE uid=@k"');
    assert.ok(iCount > 0 && iRefuse > iCount && iDelete > iRefuse, '과제 영구 삭제가 공용 일정 수를 세어 DELETE 전에 고정 문구로 거부하지 않는다');
    assert.ok(/if \(shared > 0\) \{ await tx\.RollbackAsync/.test(del), '공용 일정이 있을 때 롤백하지 않는다');
    const list = extractCsMember(pdb, 'public async Task<string?> LoadTrashJsonAsync(');
    assert.ok(/!shared, shared \? TrashProjectSharedMsg : ""/.test(list), '휴지통 목록 힌트(deletable, why)가 공용 일정 거부와 같은 문장을 쓰지 않는다');
  },

  // ══ ⑨ 권한(DELETE 없음) ═════════════════════════════════════════════
  grants(grants, server, pcdb) {
    const g = noLineComments(grants), s = noLineComments(server);
    const want = { cal_project_event: 'SELECT, INSERT, UPDATE', cal_project_change: 'SELECT, INSERT' };
    //  과제 캘린더 권한 줄은 정확히 이 둘이다(대응표 cal_project_copy 와 감시점 cal_project_rev 는 2026-10-22 저녁에 뺐다)
    assert.strictEqual((g.match(/^GRANT [^;]*cal_project_/gm) || []).length, 2, 'grants-calendar.sql 의 과제 캘린더 권한 줄이 둘이 아니다');
    assert.strictEqual((s.match(/^GRANT [^;]*cal_project_/gm) || []).length, 2, 'server-app-account.sql 의 과제 캘린더 권한 줄이 둘이 아니다');
    for (const [t, verbs] of Object.entries(want)) {
      assert.ok(new RegExp(`^GRANT ${verbs} ON taskmgr\\.${t}\\s+TO 'taskmgr_app'@'%';`, 'm').test(g), `grants-calendar.sql 의 ${t} 권한이 ${verbs} 가 아니다`);
      assert.ok(new RegExp(`^GRANT ${verbs} ON \`taskcalendar\`\\.\`${t}\` TO 'taskmgr_app'@'%';`, 'm').test(s), `server-app-account.sql 의 ${t} 권한이 ${verbs} 가 아니다`);
    }
    assert.ok(!/DELETE[^;]*cal_project_/i.test(g) && !/DELETE[^;]*cal_project_/i.test(s), '권한 파일이 과제 캘린더 표에 DELETE 를 준다');
    assert.ok(!/\bDELETE\s+FROM\b/i.test(stripCsComments(pcdb)), 'ProjectCalendarDb 에 DELETE 문이 있다(소프트 삭제, 지우지 않는 기록)');
  },

  // ══ ⑩ 개인 복사의 행 투영 ══════════════════════════════════════════
  copyProjection(cwdb) {
    const code = stripCsComments(cwdb);
    const ins = extractCsMember(cwdb, 'internal static async Task<uint> InsertEntryInTxAsync(');
    assert.ok(/EntryParams\(entry, so, /.test(ins) && /EntryInsertSql\(userId, no\)/.test(ins), '개인 복사가 개인 저장의 행 투영(EntryParams)과 INSERT 문(EntryInsertSql)을 쓰지 않는다');
    const save = extractCsMember(cwdb, 'public async Task<CalendarSaveResult> SaveAsync(');
    assert.ok(/await Exec\(conn, tx, EntryInsertSql\(u, no\), ct, p, now\);/.test(save), 'SaveAsync 가 같은 INSERT 문(EntryInsertSql)을 쓰지 않는다');
    assert.strictEqual((code.match(/INSERT INTO cal_entry \(/g) || []).length, 1, 'cal_entry INSERT 문이 한 곳(EntryInsertSql)이 아니다');
    const bump = extractCsMember(cwdb, 'internal static async Task<long> BumpUserRevInTxAsync(');
    assert.ok(/INSERT INTO cal_user_rev\(user_id, rev\) VALUES\(" \+ userId \+ ", 1\) " \+\s*"ON DUPLICATE KEY UPDATE rev = rev \+ 1"/.test(bump), '개인 rev 증가 문장이 SaveAsync 와 같지 않다');
  },

  // ══ ⑪ 개인 복사는 한 번 찍는 사본(대응표 없음) ═════════════════════
  copySnapshot(pcdb, host, canon, frag, grants, server) {
    for (const [label, text] of [['ProjectCalendarDb.cs', stripCsComments(pcdb)], ['정본', noLineComments(canon)], ['조각', noLineComments(frag)],
      ['grants-calendar.sql', noLineComments(grants)], ['server-app-account.sql', noLineComments(server)]]) {
      assert.ok(!/cal_project_copy/.test(text), `${label} 에 대응표 cal_project_copy 가 남아 있다`);
    }
    const copy = stripCsComments(extractCsMember(pcdb, 'private async Task<object> CopyAsync('));
    //  돌아가는 곳은 끝의 한 곳뿐이다("이미 복사했으면 그것" 으로 먼저 돌아가는 길이 없다)
    assert.strictEqual((copy.match(/\breturn\b/g) || []).length, 1, '개인 복사에 끝 말고 먼저 돌아가는 길이 있다(이미 복사했나를 보면 안 된다)');
    const iIns = copy.indexOf('CalendarWriteDb.InsertEntryInTxAsync('), iCommit = copy.indexOf('await CommitWithGateAsync(conn, tx, ct);'), iRet = copy.indexOf('return data;');
    assert.ok(iIns > 0 && iCommit > iIns && iRet > iCommit, '개인 복사가 개인 일정을 넣고 커밋한 뒤 돌아가지 않는다');
    assert.ok(!/existed/.test(stripCsComments(pcdb)), '개인 복사 회신에 existed 가 남아 있다');
    const boot = stripCsComments(extractCsMember(pcdb, 'private async Task<object> BootstrapAsync('));
    assert.ok(!/copies/.test(boot), '부트스트랩이 아직 copies 를 돌려준다');
    assert.ok(/case "projectCalendarCopy":[\s\S]{0,240}r\.ReloadPersonal = true;/.test(stripCsComments(pcdb)), '개인 복사가 성공할 때마다 개인 스냅샷을 다시 싣지 않는다');
    assert.ok(/if \(r\.Ok && r\.ReloadPersonal\)[\s\S]*BootFromDbAsync\(\)/.test(host), '배선이 개인 스냅샷을 다시 싣지 않는다');
  },

  // ══ ⑫ 과제별 감시점 없음, FK 경합은 고정 문구 ════════════════════════
  noProjectRev(pcdb, canon, frag, grants, server) {
    for (const [label, text] of [['정본', noLineComments(canon)], ['조각', noLineComments(frag)],
      ['grants-calendar.sql', noLineComments(grants)], ['server-app-account.sql', noLineComments(server)]]) {
      assert.ok(!/cal_project_rev/.test(text), `${label} 에 cal_project_rev 가 남아 있다`);
    }
    const code = stripCsComments(pcdb);
    assert.ok(!/projectRev|\["rev"\]|RevsAsync/.test(code), '회신에 과제별 판(rev, projectRev)이 남아 있다');
    //  과제 영구 삭제와 엇갈린 FK 오류(1452, 1451)는 원문 대신 고정 문구 forbidden. 일반 catch 보다 앞에 있다
    const h = extractCsMember(pcdb, 'public async Task<ProjectCalendarReply> HandleAsync(');
    const iFk = h.indexOf('when (DbErrors.Number(fx) == 1452 || DbErrors.Number(fx) == 1451)'), iAny = h.indexOf('catch (Exception ex)');
    assert.ok(iFk > 0 && iAny > iFk, 'FK 1452/1451 을 고정 문구로 바꾸는 catch 가 일반 catch 앞에 없다');
    assert.ok(/return ProjectCalendarReply\.Failure\(Kind\.Forbidden, MsgProjectGone\);/.test(h.slice(iFk, iAny)), 'FK 오류를 forbidden 과 고정 문구(MsgProjectGone)로 돌려주지 않는다');
    assert.ok(/internal const string MsgProjectGone = "[^"]+";/.test(code), '고정 문구 MsgProjectGone 이 없다');
    //  같은 uid 의 동시 생성(1062)은 재시도로 돌려준다(원문 오류가 아니다)
    assert.ok(/catch \(MySqlException dx\) when \(dx\.Number == 1062\)[\s\S]{0,400}return SaveData\(won, replayed: true\);/.test(stripCsComments(extractCsMember(pcdb, 'private async Task<object> SaveAsync('))), '같은 uid 동시 생성(1062)을 재시도로 돌려주지 않는다');
  },
};

// ══ 계약 ═══════════════════════════════════════════════════════════════
test('과제캘린더①a: 새 표 둘의 정의가 정본과 이관 조각에서 글자까지 같다', () => checks.sameDefs(src.canon, src.frag));
test('과제캘린더①b: 조각은 15 에서 16 한 칸, FK 순서로 IF NOT EXISTS, 모두 PREPARE, 정본과 같은 열 수와 FK 수로 검증한다', () => checks.fragmentShape(src.canon, src.frag));
test('과제캘린더①c: 정본 DROP 목록에 새 표 둘이 있고 시드가 16 이상이다', () => checks.canonLists(src.canon));
test('과제캘린더②: 연결은 DbGate.OpenAsync 하나, 읽기와 쓰기 프리앰블이 각자의 격리수준과 UTC 를 건다', () => checks.connections(src.pcdb));
test('과제캘린더③: 공용 쓰기는 판정으로 시작하고 일정 행을 잡은 뒤 재시도를 본다, 개인 복사는 원본 일정 공유 잠금 다음 cal_user_rev', () => checks.firstStatement(src.pcdb));
test('과제캘린더④: 커밋은 한 곳이고 바로 앞에서 관문을 다시 읽는다', () => checks.gateBeforeCommit(src.pcdb));
test('과제캘린더⑤: 명령 여섯은 메인 창 전용이다(관리 창, 열람 창 허용 목록 밖, 거절 분기)', () => checks.mainOnly(src.main, src.appwin, src.html, src.pcdb, src.host));
test('과제캘린더⑥: 웹이 보낸 사용자 값을 쓰지 않고, 신원은 세션, 판정은 함수 하나를 모든 명령이 거친다', () => checks.identity(src.pcdb));
test('과제캘린더⑦: 글자 상한(제목, 장소, 이름 200, 메모 8,000)이 DDL 칸 폭과 같고, 넘으면 자르지 않고 거절한다', () => checks.limits(src.pcdb, src.canon, src.frag));
test('과제캘린더⑧: 휴지통 과제 영구 삭제는 공용 일정이 있으면 고정 문구로 거부한다(목록 힌트도 같은 문장)', () => checks.trash(src.pdb));
test('과제캘린더⑨: 새 표 둘에 DELETE 권한이 없고 호스트에도 DELETE 문이 없다', () => checks.grants(src.grants, src.server, src.pcdb));
test('과제캘린더⑩: 개인 복사가 개인 저장과 같은 행 투영, INSERT 문, rev 증가를 쓴다', () => checks.copyProjection(src.cwdb));
test('과제캘린더⑪: 개인 복사는 한 번 찍는 사본이다(대응표 없음, 먼저 돌아가는 길 없음, copies 없음, 늘 개인 재적재)', () => checks.copySnapshot(src.pcdb, src.host, src.canon, src.frag, src.grants, src.server));
test('과제캘린더⑫: 과제별 감시점과 판이 없고, 과제 영구 삭제와 엇갈린 FK 오류는 고정 문구 forbidden 이다', () => checks.noProjectRev(src.pcdb, src.canon, src.frag, src.grants, src.server));

// ══ 변이 ═══════════════════════════════════════════════════════════════
test('변이PC1: 조각의 정의를 정본과 다르게 바꾸면 ①a 가 실패한다', () => {
  const bad = mutate(src.frag, "COMMENT ''제목(앱 상한 200자)''", "COMMENT ''제목''");
  assert.throws(() => checks.sameDefs(src.canon, bad), /글자까지 같지 않다/);
});
test('변이PC2: 조각 검증의 기대 열 수가 정본과 다르면 ①b 가 실패한다', () => {
  const bad = mutate(src.frag, '@m_c1 = 17 AND', '@m_c1 = 16 AND');
  assert.throws(() => checks.fragmentShape(src.canon, bad), /검증의 기대값이 정본 정의/);
});
test('변이PC3: 공용 쓰기에서 판정 앞에 다른 문장을 두면 ③ 이 실패한다', () => {
  const anchor = '                var me = await IdentityAsync(conn, tx, login, ct);\n                //  잠금 1: 과제 행(공유). 커밋까지';
  const bad = mutate(src.pcdb, anchor, '                await Exec(conn, tx, "SELECT 1", ct);\n' + anchor);
  assert.throws(() => checks.firstStatement(bad), /첫 문장이 판정이 아니다/);
});
test('변이PC4: 관문 재확인을 빼면 ④ 가 실패한다', () => {
  const bad = mutate(src.pcdb, 'var gateMeta = await DbGate.ReadMetaAsync(conn, tx, ct);', 'var gateMeta = new GateMeta();');
  assert.throws(() => checks.gateBeforeCommit(bad), /관문 재확인/);
});
test('변이PC5: 명령을 관리 창 허용 목록에 넣으면 ⑤ 가 실패한다', () => {
  const bad = mutate(src.main, '"adminWinReady", "userInfoGet", "gateRecheck",', '"adminWinReady", "userInfoGet", "gateRecheck", "projectCalendarSave",');
  assert.throws(() => checks.mainOnly(bad, src.appwin, src.html, src.pcdb, src.host), /관리 창 허용 목록/);
});
test('변이PC6: 요청에서 사용자 값(loginId)을 읽으면 ⑥ 이 실패한다', () => {
  const bad = mutate(src.pcdb, 'string login = SessionLoginId();\n            await using var conn = await OpenReadSnapshotAsync(ct);\n            var me = await IdentityAsync(conn, null, login, ct);\n            var ps = await EligibleProjectsAsync(conn, null, me.UserId, null, ct);',
    'string login = Str(q, "loginId");\n            await using var conn = await OpenReadSnapshotAsync(ct);\n            var me = await IdentityAsync(conn, null, login, ct);\n            var ps = await EligibleProjectsAsync(conn, null, me.UserId, null, ct);');
  assert.throws(() => checks.identity(bad), /정해진 목록 밖의 값\(loginId\)|사용자 값/);
});
test('변이PC7: 제목 상한을 300 으로 바꾸면 ⑦ 이 실패한다', () => {
  const bad = mutate(src.pcdb, 'public const int Title = 200;', 'public const int Title = 300;');
  assert.throws(() => checks.limits(bad, src.canon, src.frag), /글자 상한|칸 폭/);
});
test('변이PC8: 휴지통의 공용 일정 거부를 빼면 ⑧ 이 실패한다', () => {
  const bad = mutate(src.pdb, 'if (shared > 0) { await tx.RollbackAsync(cts.Token); _log("영구 삭제 거부(과제 캘린더 일정 " + shared + "건) " + k); return (false, TrashProjectSharedMsg); }', '');
  assert.throws(() => checks.trash(bad), /거부하지 않는다|롤백하지 않는다/);
});
test('변이PC9: 이력 표에 DELETE 권한을 주면 ⑨ 가 실패한다', () => {
  const bad = mutate(src.grants, "GRANT SELECT, INSERT ON taskmgr.cal_project_change TO 'taskmgr_app'@'%';", "GRANT SELECT, INSERT, DELETE ON taskmgr.cal_project_change TO 'taskmgr_app'@'%';");
  assert.throws(() => checks.grants(bad, src.server, src.pcdb), /권한이 SELECT, INSERT 가 아니다|DELETE/);
});
test('변이PC10: 개인 복사가 잠금 순서를 뒤집으면(개인 rev 먼저) ③ 이 실패한다', () => {
  const body = extractCsMember(src.pcdb, 'private async Task<object> CopyAsync(');
  const share = '                var src = await EventByUidForShareAsync(conn, tx, eventUid, ct);\n';
  assert.ok(body.includes(share), '변이 준비 실패');
  const bad = mutate(src.pcdb, share, '                await CalendarWriteDb.BumpUserRevInTxAsync(conn, tx, 0, ct);\n' + share);
  assert.throws(() => checks.firstStatement(bad), /잠금 순서/);
});
test('변이PC11: 개인 복사가 "이미 복사했나" 를 보고 먼저 돌아가면 ⑪ 이 실패한다', () => {
  const at = '                //  잠금 3: 내 개인 rev(배타).';
  const bad = mutate(src.pcdb, at, '                if (src.RowVersion < 0) { await SafeRollbackAsync(tx); return CopyData("", eventUid, projectUid); }\n' + at);
  assert.throws(() => checks.copySnapshot(bad, src.host, src.canon, src.frag, src.grants, src.server), /먼저 돌아가는 길/);
});
test('변이PC12: 대응표 권한 줄을 되살리면 ⑨ 와 ⑪ 이 실패한다', () => {
  const bad = mutate(src.grants, "GRANT SELECT, INSERT ON taskmgr.cal_project_change TO 'taskmgr_app'@'%';",
    "GRANT SELECT, INSERT ON taskmgr.cal_project_change TO 'taskmgr_app'@'%';\nGRANT SELECT, INSERT ON taskmgr.cal_project_copy TO 'taskmgr_app'@'%';");
  assert.throws(() => checks.grants(bad, src.server, src.pcdb), /권한 줄이 둘이 아니다/);
  assert.throws(() => checks.copySnapshot(src.pcdb, src.host, src.canon, src.frag, bad, src.server), /cal_project_copy/);
});
test('변이PC13: FK 1452/1451 을 고정 문구로 바꾸는 catch 를 빼면 ⑫ 가 실패한다', () => {
  const bad = mutate(src.pcdb, 'catch (Exception fx) when (DbErrors.Number(fx) == 1452 || DbErrors.Number(fx) == 1451)', 'catch (Exception fx) when (DbErrors.Number(fx) == -1)');
  assert.throws(() => checks.noProjectRev(bad, src.canon, src.frag, src.grants, src.server), /FK 1452\/1451/);
});
test('변이PC14: 감시점 권한 줄을 되살리면 ⑨ 와 ⑫ 가 실패한다', () => {
  const bad = mutate(src.grants, "GRANT SELECT, INSERT ON taskmgr.cal_project_change TO 'taskmgr_app'@'%';",
    "GRANT SELECT, INSERT ON taskmgr.cal_project_change TO 'taskmgr_app'@'%';\nGRANT SELECT, INSERT, UPDATE ON taskmgr.cal_project_rev TO 'taskmgr_app'@'%';");
  assert.throws(() => checks.grants(bad, src.server, src.pcdb), /권한 줄이 둘이 아니다/);
  assert.throws(() => checks.noProjectRev(src.pcdb, src.canon, src.frag, bad, src.server), /cal_project_rev/);
});
test('변이PC15: 판정 SQL 의 과제 행 공유 잠금(FOR SHARE OF p)을 빼면 ③ 이 실패한다', () => {
  const bad = mutate(src.pcdb, '+ (lockProject ? " FOR SHARE OF p" : "");', '+ (lockProject ? "" : "");');
  assert.throws(() => checks.firstStatement(bad), /FOR SHARE OF p/);
});
test('변이PC16: 공용 쓰기가 과제 행보다 일정 행을 먼저 잠그면 ③ 이 실패한다', () => {
  const at = '            var (tx, me, proj) = await BeginSharedWriteAsync(conn, login, projectUid, ct);\n            uint projectId = proj.Id;\n            await using var txOwn = tx;\n            try\n            {\n                //  수정은 그 일정 행을 먼저 잡는다';
  const bad = mutate(src.pcdb, at, '            await using (var pre = new MySqlCommand("SELECT 1 FROM cal_project_event WHERE uid=@u FOR UPDATE", conn)) { }\n' + at);
  assert.throws(() => checks.firstStatement(bad), /일정 행을 먼저 잠근다/);
  const body = extractCsMember(src.pcdb, 'private async Task<object> CopyAsync(');
  const proj = '                var proj = await RequireProjectAsync(conn, tx, me, projectUid, write: false, ct, lockProject: true);\n';
  assert.ok(body.includes(proj), '변이 준비 실패');
  const bad2 = mutate(src.pcdb, proj, '                var pre = await EventByUidForShareAsync(conn, tx, eventUid, ct);\n' + proj);
  assert.throws(() => checks.firstStatement(bad2), /잠금 순서/);
});

//  생성은 잠그지 않고 읽는다. 아직 없는 uid 를 FOR UPDATE 로 읽으면 uid 색인 빈틈이 잠겨 동시 생성 둘이 교착한다(1213, 2026-10-22).
test('생성 경로는 없는 uid 를 잠금 읽기하지 않는다(빈틈 교착 방지)', () => {
  const want = 'var cur = expected == null\n                    ? await EventWhereAsync(conn, tx, "e.uid=@uid", ct, P("@uid", eventUid))\n                    : await EventByUidForUpdateAsync(conn, tx, eventUid, ct);';
  assert.ok(src.pcdb.replace(/\r\n/g, '\n').includes(want), '생성은 잠그지 않는 읽기, 수정만 FOR UPDATE');
});
