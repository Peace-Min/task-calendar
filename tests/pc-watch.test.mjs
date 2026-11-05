// 과제 탭 "다른 과제 보기"(보기만 과제, 구조 21) 계약: docs/PC-WATCH.md §2~5.
// 2026-11-05 2차(docs/PC-WATCH-2.md): 화면 이름은 "관심 과제", 왼쪽 목록은 [내 과제 | 관심 과제] 두 탭, [참여자]는 개인 보기 팝업과 같은 공용 고르기 목록.
//   그 새 계약(이름, 회색, 탭, 공용 팝업, 날짜 패널)은 tests/pc-watch-2.test.mjs, tests/day-panel-fold.test.mjs 가 더 본다.
// 시안: dist/proto/pc-watch-v3.html(과제 탭 목록과 상세), dist/proto/pc-watch-v8.html(다른 과제 보기 창, 애프터).
//
// 이 파일이 지키는 것:
//   (H) 호스트 정적(widget/ProjectCalendarDb.cs):
//       ① 쓰기 판정은 그대로다: EligibleSql 은 EligibleProjectsAsync 하나만 쓰고 내 과제(cal_category)만 본다. 저장, 삭제, 개인 일정 등록은
//          읽기 판정(ReadableProjectsAsync)을 부르지 않는다. 읽기 판정은 LoadAsync, ChangesAsync, MembersAsync 만 부른다.
//       ② 읽기 규칙: 숨기지 않은 모든 공식 과제, 또는 숨겨졌어도 내 과제(HAVING). 웹이 보낸 uid 만 해석한다. 회신에 writable 과 mine 두 값.
//       ③ 넣기는 평범한 INSERT ... SELECT(IGNORE, ON DUPLICATE KEY UPDATE 없음, 과제 is_active = 1), 0행 거부, 1062 는 멱등 성공, 상한 50 은 넣을 때만 센다.
//          빼기는 키 칸 조건 DELETE 하나. 둘 다 트랜잭션은 관문 재확인 커밋(CommitWithGateAsync)으로 끝낸다.
//       ④ 목록은 내 과제를 거르고(NOT EXISTS), 숨겨진 과제는 hidden 으로 알린다. 다른 과제 보기 창용 읽기(pcWatchCatalog)는 숨기지 않은 과제만,
//          lastActivity(지우지 않은 일정의 MAX(updated_at)), 참여자 login_id 목록만 싣는다(이름, 조직, 직급은 싣지 않는다).
//       ⑤ 새 명령 넷은 메인 창 스위치에만 있다. DbGate 구조 번호는 21.
//   (D) 배포 정적: 권한 파일 셋(grants-calendar.sql, server-app-account.sql, create-app-user.sql 머리말), init-calendar 명부, 데모 지우기, 정본 DROP 목록과
//       머리말, 조각의 GRANT 없음, 휴지통 삭제 순서(release-sql, trash-host 시험이 글자 대조를 맡는다).
//   (W) 웹 정적: 보내는 명령, 상태 체크는 이 창 안에서만 센다(공용 기억 불변), 새 문구에 기호 규칙.
//   (R) jsdom(위젯 모드, 가짜 호스트):
//       - 다른 과제 보기 창(#catAddModal 의 보기 모드): 제목, 탭 숨김, 활동순, 일정 있는 과제만, 열, 최근 활동 글자와 강조, 참여자 수와 명단 창,
//         참여자 이름 찾기와 "포함", [참여자] 여러 명 고르기(사람 고르기 팝오버), 보기, 보는 중, 빼기, 내 과제.
//       - 과제 추가 모드는 그대로(탭, 열, [추가])이고 보기 모드의 흔적이 새지 않는다.
//       - 과제 탭: 두 묶음, 묶음 체크 끄고 켜기, 숨겨진 과제, ×, 점선 일정, 상세 단추(writable, mine), 일정 등록 창은 내 과제만,
//         보기만 과제는 내 과제 목록(state.categories)과 근태, 취합, 필터에 섞이지 않는다.
//       - 사람 고르기 한 명 모드(다른 사람 일정 보기)는 그대로다.
//   (M) 변이: 쓰기 판정 넓히기, 보기 모드에서 [추가] 노출, 등록 단추가 mine 대신 writable 을 봄, 근태 과제 목록에 보기만 과제 섞임,
//       사람 고르기 한 명 모드가 체크 모드로 바뀜, 숨겨진 과제를 읽기 요청에 넣음, 참여자 이름 찾기 빼기, 일정 있는 과제만 무시.
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM, readText, extractCsMember, stripCsComments } from './harness.mjs';

const R = (p) => new URL('../' + p, import.meta.url);
const src = loadAppSource();
const pcdb = readText(R('widget/ProjectCalendarDb.cs'));
const main = readText(R('widget/MainWindow.xaml.cs'));
const gate = readText(R('widget/DbGate.cs'));
const canon = readText(R('db/deploy/schema-calendar.sql'));

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}
const code = (s) => stripCsComments(s);
const noSqlComments = (s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

/* ══ (H) 호스트 정적 ═══════════════════════════════════════════════════ */
const hostChecks = {
  //  ① 쓰기 판정은 그대로, 읽기 판정은 읽기 명령 셋만
  writeJudgeUnchanged(cs) {
    const c = code(cs);
    const sql = /private const string EligibleSql =\s*([\s\S]*?);\n/.exec(c);
    assert.ok(sql, 'EligibleSql 이 없다');
    const flat = sql[1].replace(/"\s*\+\s*"/g, '').replace(/^\s*"|"\s*$/g, '');
    assert.strictEqual(flat, "SELECT p.id, p.uid, p.project_name, p.common_name, p.is_active, p.section_id, IFNULL(cu.name, '') AS customer_name, c.uid AS cat_uid, c.color, c.cat_no FROM cal_category c JOIN project p ON p.uid = c.project_uid LEFT JOIN customer cu ON cu.customer_id = p.customer_id WHERE c.user_id=@me AND c.source='db'",
      '쓰기 판정 SQL(EligibleSql)이 바뀌었다(내 과제만, PC-WATCH §3: 손대지 않는다)');
    assert.strictEqual((c.match(/\bEligibleSql\b/g) || []).length, 2, 'EligibleSql 을 EligibleProjectsAsync 밖에서도 쓴다');
    assert.ok(extractCsMember(cs, 'private static async Task<List<Proj>> EligibleProjectsAsync(').includes('EligibleSql'), 'EligibleProjectsAsync 가 EligibleSql 을 쓰지 않는다');
    //  쓰기 길은 읽기 판정을 부르지 않는다
    for (const fn of ['private static async Task<(MySqlTransaction tx, Me me, Proj proj)> BeginSharedWriteAsync(', 'private async Task<object> SaveAsync(',
      'private async Task<object> DeleteAsync(', 'private async Task<object> CopyAsync(']) {
      const b = code(extractCsMember(cs, fn));
      assert.ok(!/ReadableProjectsAsync|RequireReadableAsync/.test(b), `${fn} 가 읽기 판정을 부른다(참여자가 아닌 사람이 쓸 수 있게 된다)`);
      //  저장과 삭제는 BeginSharedWriteAsync 를 거쳐 쓰기 판정을 받는다. 그 함수와 개인 복사는 쓰기 판정을 직접 부른다.
      const direct = /RequireProjectAsync\(conn, tx, me, projectUid, write: (true|false), ct, lockProject: true\)/.test(b);
      const viaBegin = /BeginSharedWriteAsync\(conn, login, projectUid, ct\)/.test(b);
      assert.ok(direct || viaBegin, `${fn} 가 쓰기 판정(내 과제만)을 거치지 않는다`);
    }
    //  읽기 판정을 쓰는 곳은 읽기 명령 셋뿐이다
    const users = ['LoadAsync', 'ChangesAsync', 'MembersAsync'];
    for (const fn of users) assert.ok(/ReadableProjectsAsync\(|RequireReadableAsync\(/.test(code(extractCsMember(cs, `private async Task<object> ${fn}(`))), `${fn} 가 읽기 판정을 쓰지 않는다`);
    const all = [...c.matchAll(/\b(?:ReadableProjectsAsync|RequireReadableAsync)\(/g)].length;
    //  선언 둘(ReadableProjectsAsync, RequireReadableAsync), 읽기 명령 셋의 호출 셋, RequireReadableAsync 안의 호출 하나
    assert.strictEqual(all, 6, `읽기 판정이 읽기 명령 셋(Load, Changes, Members) 말고 다른 곳에서도 쓰인다(${all})`);
  },
  //  ② 읽기 규칙
  readableRule(cs) {
    const b = code(extractCsMember(cs, 'private static async Task<List<Proj>> ReadableProjectsAsync('));
    assert.ok(/WHERE p\.uid IN \(" \+ inSql \+ "\) HAVING p\.is_active = 1 OR mine = 1"/.test(b), '읽기 규칙이 "숨기지 않은 모든 공식 과제 또는 내 과제"(HAVING p.is_active = 1 OR mine = 1)가 아니다');
    assert.ok(/EXISTS\(SELECT 1 FROM cal_category c WHERE c\.user_id=@me AND c\.source='db' AND c\.project_uid = p\.uid\) AS mine/.test(b), 'mine 이 내 과제(cal_category, source=db) 판정이 아니다');
    assert.ok(/if \(uids\.Count == 0\) return list;/.test(b), 'uid 가 없을 때 project 표를 읽는다(웹이 보낸 uid 만 해석해야 한다)');
    const load = code(extractCsMember(cs, 'private async Task<object> LoadAsync('));
    assert.ok(/\["writable"\] = p\.Mine && p\.Active, \["mine"\] = p\.Mine/.test(load), '범위 읽기 회신이 과제마다 writable(내 과제이고 숨기지 않음)과 mine 두 값을 싣지 않는다');
    assert.ok(/UidList\(q, "projectUids"\)/.test(load), '범위 읽기가 UidList(상한 200)로 uid 를 받지 않는다');
    const boot = code(extractCsMember(cs, 'private async Task<object> BootstrapAsync('));
    assert.ok(/\["mine"\] = true/.test(boot), '부트스트랩 회신(내 과제 목록)이 mine 을 싣지 않는다');
  },
  //  ③ 넣기와 빼기
  addRemove(cs) {
    const add = code(extractCsMember(cs, 'private async Task<object> WatchAddAsync('));
    assert.ok(!/INSERT\s+IGNORE|ON DUPLICATE KEY UPDATE/i.test(add), '보기 넣기가 INSERT IGNORE 나 ON DUPLICATE KEY UPDATE 를 쓴다(1452 까지 삼킨다)');
    assert.ok(/"INSERT INTO cal_project_watch \(user_id, project_id, added_at\) " \+\s*"SELECT @me, p\.id, @now FROM project p WHERE p\.uid = @pu AND p\.is_active = 1"/.test(add), '넣기가 평범한 INSERT ... SELECT(과제 is_active = 1)가 아니다');
    assert.ok(/catch \(MySqlException mex\) when \(mex\.Number == 1062\)/.test(add), '1062(이미 보는 중)를 멱등 성공으로 받지 않는다');
    assert.ok(/if \(n == 0\) throw new PcFail\(Kind\.Forbidden, MsgWatchGone\)/.test(add), '영향 0행(과제가 없거나 숨겨짐)을 거부하지 않는다');
    assert.ok(/internal const int WatchMax = 50;/.test(code(cs)), '상한 50 상수가 없다');
    const iMax = add.indexOf('total >= WatchMax'), iIns = add.indexOf('INSERT INTO cal_project_watch'), iHad = add.indexOf('had > 0');
    assert.ok(iHad > 0 && iMax > iHad && iIns > iMax, '상한은 이미 보는 중인지 본 뒤 넣기 앞에서만 센다(이미 보는 과제는 50개여도 성공)');
    assert.ok(/await CommitWithGateAsync\(conn, tx, ct\)/.test(add) && !/tx\.CommitAsync/.test(add), '보기 넣기가 관문 재확인 커밋으로 끝나지 않는다');
    const iId = add.indexOf('await IdentityAsync(conn, tx, login, ct)');
    assert.ok(iId > 0 && iId < iHad, '보기 넣기가 신원 확인(활성 사용자)으로 시작하지 않는다');
    assert.ok(!/EligibleProjectsAsync|RequireProjectAsync/.test(add), '보기 넣기가 쓰기 판정을 쓴다(참여자가 아니어도 넣을 수 있어야 한다)');
    const rm = code(extractCsMember(cs, 'private async Task<object> WatchRemoveAsync('));
    assert.ok(/DELETE FROM cal_project_watch WHERE user_id = @me AND project_id = @pid/.test(rm), '빼기가 키 칸 조건 DELETE(user_id = @me AND project_id = @pid)가 아니다');
    assert.ok(/await CommitWithGateAsync\(conn, tx, ct\)/.test(rm) && !/tx\.CommitAsync/.test(rm), '보기 빼기가 관문 재확인 커밋으로 끝나지 않는다');
    //  1452(과제가 그사이 사라짐)는 HandleAsync 가 고정 문구로 바꾼다
    assert.ok(/DbErrors\.Number\(fx\) == 1452/.test(code(extractCsMember(cs, 'public async Task<ProjectCalendarReply> HandleAsync('))), '1452 를 고정 문구로 바꾸는 catch 가 없다');
  },
  //  ④ 목록과 다른 과제 보기 창용 읽기
  listAndCatalog(cs) {
    const list = code(extractCsMember(cs, 'private async Task<object> WatchListAsync('));
    assert.ok(/NOT EXISTS \(SELECT 1 FROM cal_category c WHERE c\.user_id=@me AND c\.source='db' AND c\.project_uid = p\.uid\)/.test(list), '목록이 이미 내 과제가 된 과제를 거르지 않는다');
    assert.ok(/\["hidden"\] = Convert\.ToInt32\(rd\["is_active"\][^;]*!= 1/.test(list), '숨겨진 과제를 hidden 으로 알리지 않는다(줄을 지우면 안 된다)');
    assert.ok(/FROM cal_project_watch w JOIN project p ON p\.id = w\.project_id/.test(list), '목록이 cal_project_watch 와 project 를 조인하지 않는다');
    assert.ok(!/is_active = 1/.test(list.replace(/c\.source='db'/g, '').replace(/u\.is_active = 1/g, '')), '목록이 숨겨진 과제를 SQL 로 거른다(줄은 남기고 화면이 흐리게 보여야 한다)');
    const cat = code(extractCsMember(cs, 'private async Task<object> WatchCatalogAsync('));
    assert.ok(/MAX\(e\.updated_at\) FROM cal_project_event e WHERE e\.project_id = p\.id AND e\.is_deleted = 0/.test(cat), 'lastActivity 가 지우지 않은 일정의 MAX(updated_at)가 아니다');
    assert.ok(/FROM project p WHERE p\.is_active = 1/.test(cat), '다른 과제 보기 창 목록이 숨기지 않은 과제만이 아니다');
    assert.ok(/JOIN app_user u ON u\.user_id = c\.user_id AND u\.is_active = 1/.test(cat) && /c\.source='db'/.test(cat), '참여자 규칙(cal_category source=db 와 활성 사용자)이 참여자 수와 다르다');
    assert.ok(!/u\.name|org_unit|title_code|\bemail\b|\bmail\b/i.test(cat), '목록용 읽기가 이름, 조직, 직급을 싣는다(login_id 만, 이름은 화면이 명부로 붙인다)');
    assert.ok(/\["projectUid"\] = uid,\s*\["lastActivity"\][^;]*,\s*\["memberIds"\]/.test(cat.replace(/\s+/g, ' ').replace(/, \[/g, ',\n["')) || (/projectUid/.test(cat) && /lastActivity/.test(cat) && /memberIds/.test(cat)), '회신 키가 projectUid, lastActivity, memberIds 가 아니다');
    //  세 읽기 명령은 읽기 스냅샷이고 쓰기 문이 없다
    for (const [fn, b] of [['WatchListAsync', list], ['WatchCatalogAsync', cat]]) {
      assert.ok(/OpenReadSnapshotAsync\(ct\)/.test(b), `${fn} 가 읽기 스냅샷이 아니다`);
      assert.ok(!/BeginTransactionAsync|Exec\(|ExecuteNonQueryAsync|CommitWithGateAsync|INSERT|DELETE/.test(b), `${fn} 가 쓴다`);
    }
  },
  //  ⑤ 메인 창 전용, 구조 번호 21
  wiring(cs, mw, gt) {
    const NEW = ['pcWatchList', 'pcWatchAdd', 'pcWatchRemove', 'pcWatchCatalog'];
    const cmds = /internal static readonly string\[\] Commands =\s*\{([\s\S]*?)\};/.exec(code(cs));
    for (const c of NEW) {
      assert.ok(cmds && cmds[1].includes(`"${c}"`), `Commands 에 ${c} 가 없다`);
      assert.ok(new RegExp(`case "${c}":\\s+return ProjectCalendarReply\\.Success\\(await Watch`).test(code(cs)), `HandleAsync 에 ${c} 가 없다`);
      assert.ok(code(mw).includes(`case "${c}":`), `메인 창 스위치에 ${c} 가 없다`);
      for (const set of ['PeerWinCommands', 'AdminWinCommands']) {
        const m = new RegExp(`internal static readonly HashSet<string> ${set} = new\\(StringComparer\\.Ordinal\\)\\s*\\{([\\s\\S]*?)\\};`).exec(code(mw));
        assert.ok(m && !m[1].includes(`"${c}"`), `${c} 가 ${set} 에 있다`);
      }
    }
    assert.ok(/public const int AppStructureVersion = 21;/.test(code(gt)), 'DbGate.AppStructureVersion 이 21 이 아니다');
    //  웹이 보낸 사용자 값은 읽지 않는다: 새 명령은 projectUid 하나만 읽는다
    for (const fn of ['WatchAddAsync', 'WatchRemoveAsync']) {
      const keys = new Set([...code(extractCsMember(cs, `private async Task<object> ${fn}(`)).matchAll(/ReqUid\(q, "(\w+)"/g)].map((m) => m[1]));
      assert.deepStrictEqual([...keys], ['projectUid'], `${fn} 가 projectUid 말고 다른 값을 읽는다`);
    }
  },
};
test('보기만H①: 쓰기 판정은 그대로(EligibleSql 불변, 저장, 삭제, 개인 일정 등록은 읽기 판정을 안 부름), 읽기 판정은 읽기 명령 셋만', () => hostChecks.writeJudgeUnchanged(pcdb));
test('보기만H②: 읽기 규칙(숨기지 않은 모든 공식 과제 또는 내 과제), 웹이 보낸 uid 만, 회신에 writable 과 mine', () => hostChecks.readableRule(pcdb));
test('보기만H③: 넣기는 평범한 INSERT SELECT(IGNORE 없음, 0행 거부, 1062 멱등, 상한 50), 빼기는 키 칸 DELETE, 둘 다 관문 커밋', () => hostChecks.addRemove(pcdb));
test('보기만H④: 목록은 내 과제를 거르고 숨겨진 과제를 hidden 으로 알리며, 다른 과제 보기 창용 읽기는 login_id 만 싣는다', () => hostChecks.listAndCatalog(pcdb));
test('보기만H⑤: 새 명령 넷은 메인 창 스위치에만 있고 projectUid 하나만 읽으며 구조 번호는 21 이다', () => hostChecks.wiring(pcdb, main, gate));

/* ══ (D) 배포 정적 ═════════════════════════════════════════════════════ */
test('보기만D①: 권한 셋(grants-calendar.sql, server-app-account.sql, create-app-user.sql 머리말)에 SELECT, INSERT, DELETE', () => {
  const g = noSqlComments(readText(R('db/deploy/grants-calendar.sql'))), s = noSqlComments(readText(R('db/deploy/server-app-account.sql')));
  assert.ok(/^GRANT SELECT, INSERT, DELETE ON taskmgr\.cal_project_watch TO 'taskmgr_app'@'%';/m.test(g), 'grants-calendar.sql 에 cal_project_watch 권한(SELECT, INSERT, DELETE)이 없다');
  assert.ok(/^GRANT SELECT, INSERT, DELETE ON `taskcalendar`\.`cal_project_watch` TO 'taskmgr_app'@'%';/m.test(s), 'server-app-account.sql 에 cal_project_watch 권한(SELECT, INSERT, DELETE)이 없다(표마다 권한을 주는 환경에서 영구 삭제가 1142 로 실패한다)');
  assert.ok(!/UPDATE[^;]*cal_project_watch/i.test(g) && !/UPDATE[^;]*cal_project_watch/i.test(s), '보기만 목록 표에 UPDATE 를 준다(고칠 칸이 없다)');
  assert.ok(/cal_project_watch/.test(readText(R('db/deploy/create-app-user.sql'))), 'create-app-user.sql 머리말에 보기만 목록 표(권한은 정본 grants-calendar.sql)가 없다');
});
test('보기만D②: init-calendar 명부와 개수 주석, 데모 지우기, 정본 DROP 목록과 머리말 목록, setup 표 수', () => {
  const init = readText(R('db/deploy/init-calendar.ps1'));
  assert.ok(/'cal_project_event','cal_project_event_except','cal_project_change','cal_project_watch',/.test(init), 'init-calendar.ps1 명부에 cal_project_watch 가 없다');
  assert.ok(/19 → 20/.test(init), 'init-calendar.ps1 의 개수 주석(19 → 20)이 없다');
  assert.ok(/WIPE_TABLES = \[\s*'project_schedule_image', 'cal_project_watch',/.test(readText(R('db/demo/build-demo-sql.mjs'))), '데모가 보기만 목록을 맨 앞에서 비우지 않는다');
  assert.ok(/^DROP TABLE IF EXISTS cal_project_watch;/m.test(canon), '정본 DROP 목록에 cal_project_watch 가 없다');
  assert.ok(/cal_project_event, cal_project_change, cal_project_watch 가 project\(id\) 를 가리킨다/.test(canon), '정본 머리말의 project 를 가리키는 cal_ 표 목록에 cal_project_watch 가 없다');
  assert.ok(/\$EXPECTED_TABLE_COUNT = 28\b/.test(readText(R('db/deploy/setup-taskcalendar.ps1'))), 'setup-taskcalendar.ps1 의 표 수가 28 이 아니다');
});
test('보기만D③: 정본 정의(복합 숫자 PK, 과제 FK CASCADE, 사람 FK RESTRICT)와 조각(GRANT 없음, DELETE 없음, 키 칸 WHERE)', () => {
  const def = /CREATE TABLE cal_project_watch \(([\s\S]*?)\) ENGINE=/.exec(canon);
  assert.ok(def, '정본에 cal_project_watch 가 없다');
  const d = def[1];
  assert.ok(/PRIMARY KEY \(user_id, project_id\)/.test(d), 'PK 가 (user_id, project_id) 숫자 복합 키가 아니다');
  assert.ok(!/watch_no/.test(d), '자기 번호(watch_no)를 둔다(이 표를 가리키는 표가 없다)');
  assert.ok(/FOREIGN KEY \(project_id\)\s+REFERENCES project \(id\)\s+ON DELETE CASCADE\s+ON UPDATE RESTRICT/.test(d), '과제 FK 가 CASCADE 가 아니다(공식 과제 영구 삭제를 보는 줄이 막는다)');
  assert.ok(/FOREIGN KEY \(user_id\)\s+REFERENCES app_user \(user_id\)\s+ON DELETE RESTRICT\s+ON UPDATE RESTRICT/.test(d), '사람 FK 가 RESTRICT 가 아니다');
  assert.ok(/KEY ix_cal_project_watch_project \(project_id\)/.test(d), '과제 FK 의 색인이 없다');
  const frag = noSqlComments(readText(R('db/deploy/migrations/v21-project-watch.sql')));
  assert.ok(!/\bGRANT\b/i.test(frag) && !/\bDELETE\s+FROM\b/i.test(frag), '조각에 GRANT 나 DELETE 가 있다');
  assert.ok(/WHERE k = 'db_structure_version' AND v = '20'/.test(frag), '구조 번호 갱신이 키 칸 WHERE 가 아니다');
  for (const v of ['@go', '@skip', 'PREPARE _g', 'information_schema']) assert.ok(frag.includes(v), `조각이 v20 조각의 방식(${v})을 따르지 않는다`);
});

/* ══ (W) 웹 정적 ═══════════════════════════════════════════════════════ */
const PUNCT = [[/—/, '엠 대시'], [/–/, 'en 대시'], [/「|」/, '낫표'], [/(^|\s)·|·(\s|$)/, '띄어 쓴 가운데 점']];
test('보기만W①: 새로 쓴 함수와 문구에 엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점이 없다', () => {
  const fns = ['pcWatchFromDto', 'pcRowHtml', 'pcSideHtml', 'pcSideInner', 'pcWatchAdd', 'pcWatchRemove', 'pcWatchDrop', 'caModeSet', 'caWatchSyncChrome', 'caWatchLoad', 'caWatchRows',
    'caWatchActHtml', 'caWatchRowHtml', 'renderCaWatchList', 'caWatchMembers', 'caWatchToggle', 'caWhoOpen', 'caAgoText',
    'pcDotCls', 'pcSideTabSet', 'pcSideSelect', 'caWhoText', 'caWhoRender', 'caWhoFoundEl', 'caWhoPlace', 'caWhoClose', 'caWhoKey', 'fbHeadMarkup', 'fbListMarkup', 'fbFill', 'fbListKey', 'fbListClick', 'fbPopKey', 'fbPopEdgeKey',
    'pkCheckRowEl', 'pkAllEl', 'sortHeadHtml', 'sortNext'];
  for (const fn of fns) {
    const text = extractFunction(src, fn).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const [re, name] of PUNCT) assert.ok(!re.test(text), `${fn} 에 ${name}가 있다`);
  }
  const a = src.indexOf('<div class="overlay hidden" id="catAddModal">'), b = src.indexOf('<!-- ===== 공식 과제(DB) 전용 화면', a);
  assert.ok(a > 0 && b > a, 'catAddModal 마크업을 찾지 못했다');
  const vis = src.slice(a, b).replace(/<!--[\s\S]*?-->/g, '');
  for (const [re, name] of PUNCT) assert.ok(!re.test(vis), `다른 과제 보기 창 마크업에 ${name}가 있다`);
});
test('보기만W①-2: 관심 과제를 숨긴 과제로 적지 않는다(주간 줄 이름표와 고치기 막힘 안내는 mine 으로 가른다, 2026-11-05 스트레스 시험)', () => {
  assert.ok(/p\.writable \? '' : '<span class="pc-state">' \+ \(p\.mine === false \? '관심 과제' : '숨긴 과제, 읽기 전용'\)/.test(src), '주간 보기 과제 줄이 관심 과제에 "숨긴 과제, 읽기 전용"을 붙인다');
  assert.ok(!/toast\('숨긴 과제라 읽기 전용입니다\.'/.test(src), '고치기 막힘 안내가 관심 과제에도 "숨긴 과제라"고 한다');
  const f = extractFunction(src, 'pcRoMsg');
  assert.ok(/p\.mine === false/.test(f) && /관심 과제라 고칠 수 없습니다\. 참여자만 고칩니다\./.test(f), 'pcRoMsg 가 관심 과제를 가르지 않는다');
});
test('보기만W②: 보기 모드의 상태 체크는 이 창 안에서만 센다(공용 기억 tc_projStatusOff 를 쓰지 않는다)', () => {
  const m = src.slice(src.indexOf('const CAW = '), src.indexOf('function caWhoOpen('));
  assert.ok(!/offStToggle|offStSave|offStReset|localStorage|OFF_ST_KEY/.test(m), '다른 과제 보기 창이 공용 상태 기억을 바꾼다');
  assert.ok(/function caFillStatus\(\)\{ fillStatusChecks\('caStChecks', CAW\.on \? caStOffSet\(\) : null\); \}/.test(src), '보기 모드가 자기 끈 집합을 상태 체크에 넘기지 않는다');
  assert.ok(/if\(CAW\.on\)\{ const off = caStOffSet\(\);/.test(src), '상태 체크 바뀜이 보기 모드에서 이 창의 집합을 바꾸지 않는다');
});
test('보기만W③: 보기 모드는 새 창이 아니다(과제 추가 창 #catAddModal 하나, openCatAdd 의 인자), 참여자 명단은 #pcMembersModal 하나, [참여자]는 겉은 개인 보기 팝업, 속은 다른 사람 일정 보기 조직도', () => {
  assert.strictEqual((src.match(/id="catAddModal"/g) || []).length, 1, '과제 추가 창이 둘 이상이다');
  assert.strictEqual((src.match(/id="pcMembersModal"/g) || []).length, 1, '참여자 명단 창이 둘 이상이다');
  assert.ok(/openCatAdd\('watch'\)/.test(extractFunction(src, 'pcOnViewClick')), '과제 탭의 [다른 과제 보기]가 과제 추가 창을 보기 모드로 열지 않는다');
  assert.ok(/pcOpenMembers\(uid, \{ name: c\.name/.test(extractFunction(src, 'caWatchMembers')), '참여자 수 단추가 과제 탭의 참여자 명단 창(pcOpenMembers)을 열지 않는다');
  //  2026-11-05(PC-WATCH-2 §4, §7.3): [참여자]는 #peerPicker 여러 명 모드를 쓰지 않는다. 겉은 개인 보기 팝업(fbHeadMarkup 의 찾기, 전체 선택/해제),
  //  속은 다른 사람 일정 보기 조직도 함수(pkRenderOrg, pkTreeEl, pkUnitListEl)를 체크 모드(CAWP)로. 1차의 평평한 팀 목록(CAW_WHO_SRC)은 걷었다
  const who = extractFunction(src, 'caWhoOpen');
  assert.ok(/fbHeadMarkup\('caWhoBody', '이름 찾기'\)/.test(who) && !/pkOpen|fbListMarkup|fbFill/.test(who), '[참여자] 겉이 개인 보기 팝업의 찾기와 전체 선택/해제가 아니다');
  assert.ok(/pkRenderOrg\(body, P\.wide, P,/.test(extractFunction(src, 'caWhoRender')), '[참여자] 속이 다른 사람 일정 보기 조직도(pkRenderOrg)가 아니다');
  for (const gone of ["pkOpen('multi'", 'pkMultiOpenEl', 'pkMultiSync', 'pkMultiSet', 'pkPickedUnits', 'pk-chips', '__pk.multi', 'CAW_WHO_SRC', 'caWhoGroups', "fbListMarkup('caWhoList'", 'fb-gh']) assert.ok(!src.includes(gone), `걷어야 할 흔적 ${gone} 이 남았다`);
  assert.strictEqual((src.match(/id = 'peerPicker'|id="peerPicker"/g) || []).length, 1, '사람 고르기 팝오버가 둘 이상 만들어진다');
});

/* ══ (R) jsdom ═════════════════════════════════════════════════════════ */
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('pc-watch: jsdom 미설치, 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  function fakeClock() {
    let seq = 0, now = 0;
    const timers = new Map();
    return {
      setTimeout(fn, d, ...args) { const id = ++seq; timers.set(id, { fn, args, at: now + (Number(d) || 0) }); return id; },
      clearTimeout(id) { timers.delete(id); },
      advance(ms) {
        const end = now + ms;
        for (;;) {
          let best = null;
          for (const [id, t] of timers) if (t.at <= end && (best === null || t.at < timers.get(best).at)) best = id;
          if (best === null) { now = end; return; }
          const t = timers.get(best); timers.delete(best); now = t.at;
          try { t.fn(...t.args); } catch (_) { /* 앱의 일 */ }
        }
      },
    };
  }
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const P1 = '11111111-1111-4111-8111-111111111111', P3 = '33333333-3333-4333-8333-333333333333';       // 내 과제(P3 는 숨겨졌고 내 과제)
  const B1 = 'bbbbbbbb-0000-4000-8000-000000000001', B2 = 'bbbbbbbb-0000-4000-8000-000000000002',        // 보기만 과제, 숨겨진 보기만 과제
    C1 = 'cccccccc-0000-4000-8000-000000000001', D1 = 'dddddddd-0000-4000-8000-000000000001', E1 = 'eeeeeeee-0000-4000-8000-000000000001';
  const U = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const DAY = 86400000;
  const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const META = { schemaVersion: '21', expectedSchema: '21', schemaMismatch: false, gate: 'ok', rev: 1, canWrite: true, userId: 7 };
  const DATA = (entries = []) => ({
    categories: [{ id: 'c-1', name: '휴가', color: '#9aa2b3' }, { id: 'db-' + P1, name: '장비 개발', color: '#3e5be0' }],
    entries, todos: [], rooms: [] });
  //  내 과제(P1 쓰기 가능, P3 숨겨졌고 읽기 전용이지만 내 과제)
  const MINE = [
    { projectUid: P1, name: '장비 개발', color: '#3e5be0', active: true, writable: true, mine: true, members: 6 },
    { projectUid: P3, name: '구형 유지', color: '#8a5cc8', active: false, writable: false, mine: true, members: 2 },
  ];
  //  보기만 과제(B1 보임, B2 숨겨짐)
  const WATCH = [
    { projectUid: B1, name: '함대공 훈련장비', customer: 'D사', status: '진행중', statusId: 1, sectionId: 1, members: 2, hidden: false },
    { projectUid: B2, name: '숨겨진 표본', customer: 'E사', status: '진행중', statusId: 1, sectionId: 1, members: 0, hidden: true },
  ];
  //  공식 과제 목록(__applyProjects 행): P1 은 내 과제, B1 은 보기만, C1 은 일정 없음, D1 은 종료, E1 은 두 달 넘게 조용함
  const ROW = (uid, name, o = {}) => Object.assign({ uid, project_name: name + ' 사업', common_name: name, contract_name: name + ' 계약', customer: 'D사', section: '개발',
    status: '진행중', customerId: 1, sectionId: 1, statusId: 1, start_date: '2026-01-01', end_date: '2027-12-31', dev_end_date: '', note: '' }, o);
  const CATALOG = [
    ROW(P1, '장비 개발'), ROW(B1, '함대공 훈련장비'), ROW(C1, '해양 부이 통신'),
    ROW(D1, '종료 과제', { status: '종료', statusId: 2 }), ROW(E1, '표적기'),
  ];
  const CAT = [
    { projectUid: P1, lastActivity: ago(0), memberIds: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'] },
    { projectUid: B1, lastActivity: ago(2), memberIds: ['u1', 'u2'] },
    { projectUid: C1, lastActivity: null, memberIds: ['u3'] },
    { projectUid: D1, lastActivity: ago(5), memberIds: [] },
    { projectUid: E1, lastActivity: ago(70), memberIds: ['u3'] },
  ];
  const MEMBERS = [
    { loginId: 'u1', name: '김하늘', title: '책임', orgUnit: '개발1팀', canViewSchedule: true },
    { loginId: 'u2', name: '박서준', title: '선임', orgUnit: '개발1팀', canViewSchedule: true },
    { loginId: 'u3', name: '이도윤', title: '수석', orgUnit: '개발2팀', canViewSchedule: true },
    { loginId: 'u4', name: '최유나', title: '책임', orgUnit: '사업기획팀', canViewSchedule: true },
    { loginId: 'hjlee', name: '이현진', title: '책임', orgUnit: '개발1팀', canViewSchedule: true },
  ];
  const UNITS = [{ name: '개발본부', parent: null, sortOrder: 1 }, { name: '개발1팀', parent: '개발본부', sortOrder: 1 }, { name: '개발2팀', parent: '개발본부', sortOrder: 2 },
    { name: '기획본부', parent: null, sortOrder: 2 }, { name: '사업기획팀', parent: '기획본부', sortOrder: 1 }];

  async function boot({ source = src } = {}) {
    const clock = fakeClock();
    const posts = [];
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: quietConsole(),
      beforeParse(win) {
        win.chrome = { webview: { postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posts.push(o || {}); }, addEventListener() {}, removeEventListener() {} } };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
        win.setTimeout = clock.setTimeout; win.clearTimeout = clock.clearTimeout;
      },
    });
    const w = dom.window, doc = w.document;
    const W = {
      w, doc, clock, posts,
      ev: (c) => w.eval(c),
      el: (id) => doc.getElementById(id),
      q: (s) => doc.querySelector(s), qa: (s) => [...doc.querySelectorAll(s)],
      cmds: (cmd) => posts.filter((p) => p.cmd === cmd),
      last: (cmd) => [...posts].reverse().find((p) => p.cmd === cmd && p.reqId && !p.__done),
      async reply(cmd, res) {
        const p = W.last(cmd);
        assert.ok(p, `${cmd} 요청이 나가지 않았다`);
        p.__done = true;
        w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify(res) + ')');
        await settle();
      },
      async click(sel) { const e = typeof sel === 'string' ? doc.querySelector(sel) : sel; assert.ok(e, `누를 것(${sel})이 없다`); e.click(); await settle(); clock.advance(150); await settle(); },
      async change(el, checked) { el.checked = checked; el.dispatchEvent(new w.Event('change', { bubbles: true })); await settle(); clock.advance(50); await settle(); },
      async type(el, v) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); await settle(); },
      toasts: () => [...doc.querySelectorAll('#toastStack .toast, #toastStackErr .toast')].map((t) => t.textContent),
      close: () => { try { w.close(); } catch (_) {} },
    };
    await settle();
    await W.reply('userSessionGet', { ok: true, user: { loginId: 'hjlee', name: '이현진' } });
    w.eval('__applyState(' + JSON.stringify(JSON.stringify(DATA())) + ',' + JSON.stringify(META) + ')');
    await settle(); clock.advance(5); await settle();
    for (const p of posts.filter((x) => x.cmd === 'saveState' && x.reqId && !x.__done)) { p.__done = true; w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',{"ok":true})'); }
    await settle();
    w.eval('window.__applyProjects(' + JSON.stringify(JSON.stringify(CATALOG)) + ')');
    await settle();
    return W;
  }
  async function withBoot(opts, fn) { const W = await boot(opts); try { return await fn(W); } finally { W.close(); } }
  //  과제 탭에 들어가 내 과제와 보기만 목록을 읽는다(부트스트랩 다음 보기만 목록). events 는 범위 읽기의 일정.
  async function enter(W, { events = [], watch = WATCH, mine = MINE } = {}) {
    await W.click('#pcTabProject');
    await W.reply('projectCalendarBootstrap', { ok: true, data: { projects: mine, limits: { title: 200, location: 200, memo: 8000 } } });
    await W.reply('pcWatchList', { ok: true, data: { projects: watch, max: 50 } });
    const p = W.last('projectCalendarLoad');
    if (p) {
      p.__done = true;
      const ps = (p.projectUids || []).map((u) => {
        const m = mine.find((x) => x.projectUid === u);
        return m ? { projectUid: u, writable: m.writable, mine: true } : { projectUid: u, writable: false, mine: false };
      });
      W.w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify({ ok: true, data: { projects: ps, events, excluded: [], from: p.from, to: p.to } }) + ')');
      await settle();
    }
  }
  const EV = (n, projectUid, o = {}) => Object.assign({ eventUid: U(n), projectUid, title: '일정 ' + n, startDate: today(), endDate: today(), startTime: null, endTime: null,
    location: '', memo: '', rowVersion: 1, deleted: false, createdBy: '홍길동', updatedBy: '홍길동', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' }, o);
  //  다른 과제 보기 창을 열고 목록용 읽기와 명부에 답한다.
  async function openWatchWin(W, { cat = CAT, roster = true } = {}) {
    W.ev('openCatAdd("watch")');
    await settle();
    await W.reply('pcWatchCatalog', { ok: true, data: { projects: cat } });
    if (roster) await W.reply('membersGet', { ok: true, data: { members: MEMBERS, units: UNITS, myUnit: '개발1팀' } });
    W.clock.advance(50); await settle();
  }
  const rowsOf = (W) => W.qa('#caList .ca-r');
  const rowNames = (W) => rowsOf(W).map((r) => r.querySelector('.cat-nm').dataset.full);

  test('보기만R①: 다른 과제 보기 창은 과제 추가 창의 보기 모드다: 제목, 위 탭 숨김, [추가] 없음, 열, 목록용 읽기 하나', () => withBoot({}, async (W) => {
    await enter(W);
    W.ev('openCatAdd("watch")'); await settle();
    assert.strictEqual(W.el('caHead').textContent, '관심 과제 추가', '제목이 "관심 과제 추가"가 아니다');
    assert.ok(W.el('catAddModal').classList.contains('ca-watch'), '창에 보기 모드 표시(ca-watch)가 없다');
    assert.strictEqual(W.w.getComputedStyle(W.el('caTabs')).display, 'none', '보기 모드에서 위 탭(공식, 일반)이 보인다');
    assert.strictEqual(W.cmds('pcWatchCatalog').length, 1, '목록용 읽기(pcWatchCatalog)를 하나 보내지 않았다');
    await W.reply('pcWatchCatalog', { ok: true, data: { projects: CAT } });
    const head = W.q('#caList .ca-h');
    assert.deepStrictEqual([...head.querySelectorAll('[role="columnheader"]')].map((x) => x.textContent.replace(/\s*\/\s*발주처$/, '')).filter(Boolean), ['No', '통상명칭', '발주처', '상태', '참여자', '최근 활동'], '열이 No, 통상명칭, 발주처, 상태, 참여자, 최근 활동, 동작이 아니다');
    assert.ok(!W.q('#caList [data-caadd]'), '보기 모드에 과제 추가 모드의 [추가] 단추가 있다');
    assert.ok(W.q('#caList .ca-g'), '기본 순서(과제 추가 창과 같은 DB 순서)인데 구분 묶음이 없다(§7.3)');
    //  기본: 일정 없는 과제 숨김 켬, 종료 상태는 끔(진행, 선진행만), DB 순서(구분, No, 그다음 이름)
    assert.strictEqual(W.el('caOnlyAct').checked, true, '"일정 없는 과제 숨김"이 처음 켜져 있지 않다');
    assert.deepStrictEqual(rowNames(W), ['장비 개발', '표적기', '함대공 훈련장비'], '처음 목록이 DB 순서(일정 없는 과제와 종료 과제 제외)가 아니다');
    assert.strictEqual(W.el('caCount').textContent, '3 / 5건');
    //  상태 체크: 종료만 꺼져 있고, 공용 기억(tc_projStatusOff)은 바뀌지 않는다
    assert.deepStrictEqual(Object.fromEntries(W.qa('#caStChecks [data-offst]').map((i) => [i.dataset.offst, i.checked])), { 1: true, 2: false });
    assert.strictEqual(W.w.localStorage.getItem('tc_projStatusOff'), null, '보기 모드가 공용 상태 기억을 썼다');
  }));

  test('보기만R②: 열 내용: 최근 활동 글자(오늘, n일 전, n달 전), 이틀 안 강조, 두 달 넘으면 흐림, 참여자 n명 단추, 동작(내 과제, 보기)', () => withBoot({}, async (W) => {
    await enter(W);
    await openWatchWin(W);
    const by = (name) => rowsOf(W).find((r) => r.querySelector('.cat-nm').dataset.full === name);
    assert.strictEqual(by('장비 개발').querySelector('.ca-c-rec').textContent, '오늘');
    assert.ok(by('장비 개발').querySelector('.ca-hot'), '오늘 활동이 강조(ca-hot)되지 않았다');
    assert.strictEqual(by('함대공 훈련장비').querySelector('.ca-c-rec').textContent, '2일 전');
    assert.ok(by('함대공 훈련장비').querySelector('.ca-hot'), '이틀 안 활동이 강조되지 않았다');
    assert.strictEqual(by('표적기').querySelector('.ca-c-rec').textContent, '2달 전');
    assert.ok(!by('표적기').querySelector('.ca-hot') && by('표적기').classList.contains('ca-quiet'), '두 달 넘은 줄이 흐려지지 않았다');
    assert.ok(!by('함대공 훈련장비').classList.contains('ca-quiet'));
    assert.strictEqual(by('함대공 훈련장비').querySelector('.ca-mbc').textContent, '2명');
    assert.strictEqual(by('장비 개발').querySelector('.ca-act').textContent.trim(), '내 과제', '내 과제 줄의 동작이 "내 과제"(흐림)가 아니다');
    assert.ok(!by('장비 개발').querySelector('.ca-act button'), '내 과제 줄에 누르는 단추가 있다');
    assert.ok(by('장비 개발').classList.contains('have'), '내 과제 줄이 흐려지지 않는다');
    assert.strictEqual(by('함대공 훈련장비').querySelector('.ca-act button').textContent, '✓ 관심 과제', '이미 관심 과제인 과제가 "✓ 관심 과제"가 아니다');
    assert.strictEqual(by('함대공 훈련장비').querySelector('.ca-act button').title, '누르면 관심 과제에서 뺍니다');
    assert.strictEqual(by('표적기').querySelector('.ca-act button').textContent, '추가');
    //  순수 계산
    const P = (c) => W.ev(c);
    assert.deepStrictEqual([0, 1, 6, 7, 29, 30, 364, 365].map((d) => P(`caAgoText(${d})`)), ['오늘', '1일 전', '6일 전', '1주 전', '4주 전', '1달 전', '12달 전', '1년 넘음']);
    assert.strictEqual(P('caAgoText(null)'), '');
    assert.strictEqual(P('caActDays(new Date(2026, 10, 1, 23, 30).toISOString(), new Date(2026, 10, 4, 0, 10).getTime())'), 3, '날짜 기준(자정 경계)으로 셈하지 않는다');
    assert.strictEqual(P('caActDays("garbage")'), null);
    //  펼침: 계약명, 계약기간, 사업명, 개발 기간
    await W.click(by('함대공 훈련장비'));
    const x = W.q('#caList .ca-x:not([hidden])');
    assert.ok(x, '줄을 눌러도 펼침이 열리지 않는다');
    for (const t of ['계약명', '계약기간', '사업명', '개발 기간']) assert.ok([...x.querySelectorAll('dt')].some((d) => d.textContent === t), `펼침에 ${t} 가 없다`);
  }));

  test('보기만R③: 순서는 DB 순서(구분 묶음, No), 최근 활동 열 머리 정렬 세 상태(최근 순, 오래된 순, 기본), 일정 없는 과제 숨김 끄기, 상태 체크(§7.3)', () => withBoot({}, async (W) => {
    await enter(W);
    await openWatchWin(W);
    //  자리: 일정 없는 과제 숨김은 참여자 단추 옆이 아니라 상태 체크 줄 끝(세로 구분선 뒤, 개수 앞). 정렬 전환 단추는 없다
    const strow = W.q('#catAddModal .ca-strow'), lab = W.el('caOnlyAct').closest('label');
    assert.ok(strow.contains(lab) && lab.previousElementSibling.classList.contains('ca-stsep') && lab.nextElementSibling.id === 'caCount', '"일정 없는 과제 숨김"이 상태 줄 끝(구분선 뒤, 개수 앞)이 아니다');
    assert.ok(!W.el('caSort') && !W.q('[data-casort="act"], [data-casort="name"]'), '정렬 전환 [최근 활동순 | 이름순]이 남았다');
    assert.ok(!/일정 있는 과제만|최근 활동순|이름순/.test(W.el('catAddModal').textContent), '옛 글자가 남았다');
    //  No 는 구분 안 번호(과제 추가 창과 같은 값), 기본 순서는 이름순이 아니라 DB 순서(No 먼저, 없으면 이름)
    W.ev(`dbCatalogById("db-${E1}").sortNo = 1; dbCatalogById("db-${B1}").sortNo = 2; renderCaList();`); await settle();
    await W.change(W.el('caOnlyAct'), false);
    assert.deepStrictEqual(rowNames(W), ['표적기', '함대공 훈련장비', '장비 개발', '해양 부이 통신'], '숨김을 끄면 일정 없는 과제도 DB 순서 자리에 나와야 한다(종료는 아직 꺼짐)');
    assert.deepStrictEqual(rowsOf(W).map((r) => r.querySelector('.ca-c-no').textContent), ['1', '2', '', ''], 'No 열이 구분 안 번호가 아니다');
    assert.ok(/일정 없음/.test(rowsOf(W)[3].querySelector('.ca-c-rec').textContent));
    //  최근 활동 열 머리: button, aria-sort. 누를 때마다 최근 순(▼) → 오래된 순(▲) → 기본 순서. 정렬 중에는 구분 묶음을 풀고, 일정 없는 과제는 어느 방향이든 끝
    const hb = () => W.q('#caList .ca-h [data-casort]'), hc = () => hb().closest('[role="columnheader"]');
    assert.strictEqual(hb().tagName, 'BUTTON'); assert.strictEqual(hc().getAttribute('aria-sort'), 'none');
    await W.click(hb());
    assert.strictEqual(hc().getAttribute('aria-sort'), 'descending'); assert.ok(/▼/.test(hb().textContent));
    assert.ok(!W.q('#caList .ca-g'), '정렬 중인데 구분 묶음이 남았다');
    assert.deepStrictEqual(rowNames(W), ['장비 개발', '함대공 훈련장비', '표적기', '해양 부이 통신'], '최근 순이 아니다');
    assert.deepStrictEqual(rowsOf(W).map((r) => r.querySelector('.ca-c-no').textContent), ['', '2', '1', ''], '정렬해도 No 는 그 과제의 값 그대로여야 한다');
    assert.strictEqual(W.doc.activeElement, hb(), '정렬 뒤 포커스가 열 머리가 아니다');
    await W.click(hb());
    assert.strictEqual(hc().getAttribute('aria-sort'), 'ascending'); assert.ok(/▲/.test(hb().textContent));
    assert.deepStrictEqual(rowNames(W), ['표적기', '함대공 훈련장비', '장비 개발', '해양 부이 통신'], '오래된 순이 아니다(일정 없는 과제는 끝)');
    await W.click(hb());
    assert.strictEqual(hc().getAttribute('aria-sort'), 'none');
    assert.ok(W.q('#caList .ca-g'), '세 번째 누름에 기본 순서(구분 묶음)로 돌아가지 않았다');
    assert.deepStrictEqual(rowNames(W), ['표적기', '함대공 훈련장비', '장비 개발', '해양 부이 통신']);
    //  기억하지 않는다(창을 다시 열면 기본 순서)
    await W.click(hb());
    W.ev('closeModal("#catAddModal")'); await settle(); W.clock.advance(400); await settle();
    await openWatchWin(W);
    assert.strictEqual(W.q('#caList .ca-h [data-casort]').closest('[role="columnheader"]').getAttribute('aria-sort'), 'none', '창을 다시 열었는데 정렬이 남았다');
    await W.change(W.q('#caStChecks [data-offst="2"]'), true);
    assert.ok(rowNames(W).includes('종료 과제'), '종료 상태 체크를 켰는데 종료 과제가 나오지 않는다');
    //  공용 기억은 그대로
    assert.strictEqual(W.w.localStorage.getItem('tc_projStatusOff'), null, '이 창의 상태 체크가 공용 기억에 새었다');
  }));

  test('보기만R④: 참여자 수 단추는 과제 탭의 참여자 명단 창(#pcMembersModal)을 창 위에 연다, 사람으로 걸렸으면 그 줄을 강조한다', () => withBoot({}, async (W) => {
    await enter(W);
    await openWatchWin(W);
    const row = rowsOf(W).find((r) => r.querySelector('.cat-nm').dataset.full === '함대공 훈련장비');
    await W.click(row.querySelector('.ca-mbc'));
    assert.ok(!W.el('pcMembersModal').classList.contains('hidden'), '명단 창이 열리지 않았다');
    assert.ok(!W.el('catAddModal').classList.contains('hidden'), '명단을 열었더니 관심 과제 추가 창이 닫혔다(창 위에 창이어야 한다)');
    assert.strictEqual(W.cmds('projectCalendarMembers').at(-1).projectUid, B1);
    assert.strictEqual(W.el('pcmHead').textContent, '함대공 훈련장비 참여자 2명');
    await W.reply('projectCalendarMembers', { ok: true, data: { projectUid: B1, total: 2, groups: [{ org: '개발1팀', users: [{ name: '김하늘', org: '개발1팀', title: '책임', me: false }, { name: '박서준', org: '개발1팀', title: '선임', me: false }] }] } });
    assert.deepStrictEqual(W.qa('#pcmBox .pcm-row').map((r) => r.querySelector('.pcm-nm').textContent), ['김하늘', '박서준']);
    assert.strictEqual(W.qa('#pcmBox .pcm-row.hit').length, 0, '아무 사람도 고르지 않았는데 강조된 줄이 있다');
    //  닫고, 사람을 골라(CAW.who) 다시 열면 그 사람 줄이 강조된다
    W.ev('closeModal("#pcMembersModal")'); await settle(); W.clock.advance(400); await settle();
    W.ev('CAW.who = new Map([["u2", "박서준"]]); caWatchSyncChrome(); renderCaList(true);'); await settle();
    await W.click(W.qa('#caList .ca-r').find((r) => r.querySelector('.cat-nm').dataset.full === '함대공 훈련장비').querySelector('.ca-mbc'));
    await W.reply('projectCalendarMembers', { ok: true, data: { projectUid: B1, total: 2, groups: [{ org: '개발1팀', users: [{ name: '김하늘', org: '개발1팀', title: '책임', me: false }, { name: '박서준', org: '개발1팀', title: '선임', me: false }] }] } });
    assert.deepStrictEqual(W.qa('#pcmBox .pcm-row.hit .pcm-nm').map((x) => x.textContent), ['박서준'], '고른 사람의 줄만 강조돼야 한다');
  }));

  test('보기만R⑤: 찾기 칸이 참여자 이름도 찾고 수 옆에 "김하늘 포함"을 보인다(여럿이면 "외 n")', () => withBoot({}, async (W) => {
    await enter(W);
    await openWatchWin(W);
    await W.type(W.el('caSearch'), '김하늘');
    assert.deepStrictEqual(rowNames(W), ['장비 개발', '함대공 훈련장비'], '참여자 이름으로 과제가 걸러지지 않는다');
    const hit = (n) => rowsOf(W).find((r) => r.querySelector('.cat-nm').dataset.full === n).querySelector('.ca-hitn');
    assert.strictEqual(hit('함대공 훈련장비').textContent, '김하늘 포함');
    await W.type(W.el('caSearch'), '책');   // 이름이 아니라 직급은 찾지 않는다(과제 이름에도 없다)
    assert.deepStrictEqual(rowNames(W), []);
    await W.type(W.el('caSearch'), '개발');
    assert.deepStrictEqual(rowNames(W), ['장비 개발'], '과제 이름 찾기가 깨졌다');
    assert.ok(!hit('장비 개발'), '이름으로 찾았는데 사람 포함 글자가 붙었다');
  }));

  //  2026-11-05 2차(docs/PC-WATCH-2.md §7.3): [참여자] 팝업은 겉은 개인 보기 팝업(찾기, 전체 선택/해제, 칩 없음), 속은 다른 사람 일정 보기 조직도 그대로 + 체크
  const wideModal = (W) => W.ev("document.querySelector('#catAddModal .modal').getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700, x: 0, y: 0 })");
  test('보기만R⑥: [참여자]는 조직도 그대로(트리 DB 순서와 계층, 내 소속, 경로, 전원, 사람 체크와 참여 과제 수, 노드 점), 이름만 찾기, 상태 넷과 단추 글자 넷, 합집합 거르기', () => withBoot({}, async (W) => {
    await enter(W);
    await openWatchWin(W);
    wideModal(W);
    assert.strictEqual(W.el('caWhoT').textContent, '전체');
    await W.click('#caWho');
    const pop = W.el('caWhoPop');
    assert.ok(pop && W.el('catAddModal').contains(pop), '참여자 팝업이 과제 추가 창 안에 열리지 않았다');
    assert.ok(pop.classList.contains('fb-pop') && pop.querySelector('.fb-q') && pop.querySelector('.fb-lk[data-act="all"]') && pop.querySelector('.fb-lk[data-act="none"]'), '겉이 개인 보기 팝업(찾기, 전체 선택/해제)이 아니다');
    assert.strictEqual(pop.querySelector('.fb-q').getAttribute('placeholder'), '이름 찾기');
    assert.ok(!pop.querySelector('.fb-opts, .pk-chips, .pk-tabs, .pk-star'), '평평한 목록, 칩, 사람 탭, ☆ 가 있다');
    assert.strictEqual(pop.getAttribute('aria-label'), '참여자 고르기');
    assert.ok(!W.el('peerPicker') || W.el('peerPicker').classList.contains('hidden'), '사람 고르기 팝오버가 열렸다');
    assert.strictEqual(W.el('caWho').getAttribute('aria-expanded'), 'true');
    assert.strictEqual(W.ev('document.activeElement === CAWP.q'), true, '열면 찾기 칸에 포커스가 가야 한다');
    //  왼쪽 트리: DB 순서와 계층 그대로(내 소속을 끌어올리지 않는다), 처음 고른 노드만 내 소속, 사람 수
    const nodes = () => W.qa('#caWhoPop .pk-tree .pk-node');
    assert.ok(W.q('#caWhoPop .pk-org2 .pk-tree[role="tree"]') && W.q('#caWhoPop .pk-org2 .pk-olist'), '넓은 창에서 트리 | 목록 두 칸이 아니다');
    assert.deepStrictEqual(nodes().map((b) => [b.dataset.unit, b.getAttribute('aria-level')]), [['개발본부', '1'], ['개발1팀', '2'], ['개발2팀', '2'], ['기획본부', '1'], ['사업기획팀', '2']], '트리가 DB 순서와 계층이 아니다');
    assert.strictEqual(W.q('#caWhoPop .pk-node[aria-selected="true"]').dataset.unit, '개발1팀', '처음 고른 노드가 내 소속이 아니다');
    assert.ok(W.q('#caWhoPop .pk-node[data-unit="개발1팀"] .pk-mine'), '"내 소속" 표시가 없다');
    assert.strictEqual(W.q('#caWhoPop .pk-node[data-unit="개발본부"] .pk-nc').textContent, '4명');
    //  오른쪽: 경로, "개발1팀 전원 3명", 사람 줄(체크, 이름, 직급, 참여 과제 수, 0 이면 흐리게)
    assert.ok(/개발본부\s*›\s*개발1팀/.test(W.q('#caWhoPop .pk-crumb').textContent), '경로가 없다');
    const all = () => W.q('#caWhoPop .pk-all input');
    assert.ok(/개발1팀 전원 3명/.test(W.q('#caWhoPop .pk-all').textContent) && all().checked, '"전원" 체크가 없다');
    const ck = (id) => W.q(`#caWhoPop input[data-act="pick"][data-login="${id}"]`);
    assert.deepStrictEqual(W.qa('#caWhoPop .pk-olist input[data-act="pick"]').map((i) => i.dataset.login), ['u1', 'u2', 'hjlee'], '고른 조직의 사람(나 포함)이 아니다');
    assert.ok(['u1', 'u2', 'hjlee'].every((id) => ck(id).checked), '전체인데 체크가 꺼져 있다');
    assert.strictEqual(ck('u1').closest('.pk-mpick').querySelector('.pk-pn').textContent, '2', '오른쪽 수가 참여 과제 수가 아니다');
    assert.ok(ck('hjlee').closest('.pk-mpick').classList.contains('zero') && !ck('u1').closest('.pk-mpick').classList.contains('zero'), '참여 과제 0 인 사람이 흐리지 않다');
    assert.ok(!W.q('#caWhoPop .pk-dotsel'), '전체인데 노드 점이 있다');
    //  [전체 해제] = 선택 없음(아무 과제도 안 남는다)
    await W.click('#caWhoPop .fb-lk[data-act="none"]');
    assert.strictEqual(W.el('caWhoT').textContent, '선택 없음');
    assert.deepStrictEqual(rowNames(W), [], '선택 없음인데 과제가 남았다');
    assert.ok(W.q('#caWhoPop .fb-lk[data-act="none"]').disabled && !W.q('#caWhoPop .fb-lk[data-act="all"]').disabled);
    //  한 사람: 이름, 그 사람이 있는 노드(그 조직과 윗 조직)에 점
    ck('u1').focus();
    await W.click(ck('u1'));
    assert.strictEqual(W.el('caWhoT').textContent, '김하늘');
    assert.ok(W.el('caWho').classList.contains('act'));
    assert.deepStrictEqual(rowNames(W), ['장비 개발', '함대공 훈련장비'], '고른 사람이 참여한 과제만 남아야 한다');
    assert.ok(W.qa('#caList .ca-hitn').every((x) => /김하늘/.test(x.textContent)), '참여자 칸에 고른 사람 포함 글자가 없다');
    assert.deepStrictEqual(nodes().filter((b) => b.querySelector('.pk-dotsel')).map((b) => b.dataset.unit), ['개발본부', '개발1팀'], '고른 사람이 있는 노드에 점이 없다');
    assert.ok(all().indeterminate && !all().checked, '일부만 고른 조직의 "전원"이 반쯤이 아니다');
    assert.strictEqual(W.doc.activeElement, ck('u1'), '체크 뒤 포커스가 그 체크가 아니다');
    //  찾기는 이름만(조직 이름으로는 안 찾는다). 결과는 오른쪽 칸, 줄에 조직
    await W.type(W.ev('CAWP.q'), '개발2팀');
    assert.strictEqual(W.qa('#caWhoPop .pk-olist input[data-act="pick"]').length, 0, '조직 이름으로 사람을 찾았다(이름만 찾아야 한다)');
    await W.type(W.ev('CAWP.q'), '이도윤');
    assert.deepStrictEqual(W.qa('#caWhoPop .pk-olist input[data-act="pick"]').map((i) => i.dataset.login), ['u3']);
    assert.strictEqual(ck('u3').closest('.pk-mpick').querySelector('.pk-org').textContent, '개발2팀', '찾은 사람 줄에 조직이 없다');
    assert.ok(W.q('#caWhoPop .pk-tree'), '찾는 동안 트리가 사라졌다');
    await W.click(ck('u3'));
    assert.strictEqual(W.el('caWhoT').textContent, '김하늘 외 1');
    assert.deepStrictEqual(rowNames(W), ['장비 개발', '표적기', '함대공 훈련장비'], '한 명이라도 참여한 과제가 남아야 한다(합집합)');
    await W.type(W.ev('CAWP.q'), '');
    //  트리에서 다른 조직: 경로, 하위 조직 줄, 전원(하위 조직 포함)
    await W.click(W.q('#caWhoPop .pk-node[data-unit="기획본부"]'));
    assert.strictEqual(W.q('#caWhoPop .pk-node[aria-selected="true"]').dataset.unit, '기획본부');
    assert.deepStrictEqual(W.qa('#caWhoPop .pk-olist .pk-sub').map((b) => b.dataset.unit), ['사업기획팀'], '하위 조직 줄이 없다');
    assert.ok(/기획본부 전원 1명/.test(W.q('#caWhoPop .pk-all').textContent) && !all().checked && !all().indeterminate);
    await W.click(all());
    assert.strictEqual(W.el('caWhoT').textContent, '김하늘 외 2', '"전원"이 하위 조직 사람까지 켜지 않았다');
    //  ▸ ▾ 는 펼침만(고른 조직은 그대로)
    await W.click(W.q('#caWhoPop .pk-node[data-unit="개발본부"] .pk-tw'));
    assert.deepStrictEqual(nodes().map((b) => b.dataset.unit), ['개발본부', '기획본부', '사업기획팀'], '▾ 가 접지 않았다');
    assert.strictEqual(W.q('#caWhoPop .pk-node[aria-selected="true"]').dataset.unit, '기획본부');
    await W.click(W.q('#caWhoPop .pk-node[data-unit="개발본부"] .pk-tw'));
    //  반쯤인 "전원"을 누르면 다 켠다. 다 켜면 전체(null)로
    await W.click(W.q('#caWhoPop .pk-node[data-unit="개발1팀"]'));
    assert.ok(all().indeterminate);
    await W.click(all());
    assert.strictEqual(W.el('caWhoT').textContent, '전체', '모두 켰는데 전체로 돌아가지 않았다');
    assert.strictEqual(W.ev('CAW.who'), null);
    assert.ok(W.q('#caWhoPop .fb-lk[data-act="all"]').disabled, '전체일 때 [전체 선택]이 켜져 있다');
    //  트리 키보드(사람 고르기와 같은 pkTreeKey): ↓ 로 다음 노드, Enter 로 고르기
    const node = W.q('#caWhoPop .pk-node[aria-selected="true"]'); node.focus();
    node.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.strictEqual(W.doc.activeElement.dataset.unit, '개발2팀', '트리 ↓ 가 다음 노드로 가지 않았다');
    W.doc.activeElement.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle();
    assert.strictEqual(W.q('#caWhoPop .pk-node[aria-selected="true"]').dataset.unit, '개발2팀', '트리 Enter 가 조직을 고르지 않았다');
    //  Esc 로 닫고 단추로, 기억하지 않는다(다시 열면 전체)
    W.ev('CAWP.q.focus()');
    W.ev('CAWP.q.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))'); await settle();
    assert.ok(!W.el('caWhoPop'), 'Esc 로 닫히지 않았다');
    assert.ok(!W.el('catAddModal').classList.contains('hidden'), 'Esc 가 과제 추가 창까지 닫았다');
    assert.strictEqual(W.ev('document.activeElement && document.activeElement.id'), 'caWho');
    assert.strictEqual(W.el('caWho').getAttribute('aria-expanded'), 'false');
    W.ev('CAW.who = new Map(); caWatchSyncChrome();');
    W.ev('closeModal("#catAddModal")'); await settle(); W.clock.advance(400); await settle();
    await openWatchWin(W);
    assert.strictEqual(W.el('caWhoT').textContent, '전체', '창을 다시 열었는데 참여자 거르기가 남았다');
  }));
  test('보기만R⑥b: 좁은 창의 [참여자]는 한 칸(경로를 따라 내려가기), 바깥을 누르면 닫힌다', () => withBoot({}, async (W) => {
    await enter(W);
    await openWatchWin(W);
    await W.click('#caWho');
    assert.ok(!W.q('#caWhoPop .pk-tree') && W.q('#caWhoPop .pk-body > .pk-olist'), '좁은 창에서 한 칸이 아니다');
    assert.ok(/개발1팀 전원 3명/.test(W.q('#caWhoPop .pk-all').textContent));
    await W.click(W.q('#caWhoPop .pk-crumb button[data-unit="개발본부"]'));
    assert.deepStrictEqual(W.qa('#caWhoPop .pk-olist .pk-sub').map((b) => b.dataset.unit), ['개발1팀', '개발2팀'], '경로를 눌러 위 조직으로 가지 않았다');
    W.el('caSearch').dispatchEvent(new W.w.MouseEvent('pointerdown', { bubbles: true })); await settle();
    assert.ok(!W.el('caWhoPop'), '바깥을 눌렀는데 닫히지 않았다');
  }));

  test('보기만R⑦: [보기]는 호스트에 넣고 "✓ 보는 중"이 되며 아래에 개수를 보인다, 다시 누르면 빼고, 내 과제로는 넣지 않는다', () => withBoot({}, async (W) => {
    await enter(W);
    await openWatchWin(W);
    const row = () => rowsOf(W).find((r) => r.querySelector('.cat-nm').dataset.full === '표적기');
    const nCats = W.ev('state.categories.length');
    await W.click(row().querySelector('[data-cawatch]'));
    const req = W.last('pcWatchAdd');
    assert.ok(req && req.projectUid === E1, '[보기]가 pcWatchAdd(projectUid)를 보내지 않았다');
    await W.reply('pcWatchAdd', { ok: true, data: { projectUid: E1, added: true, count: 2 } });
    assert.strictEqual(row().querySelector('.ca-act').textContent.trim(), '✓ 관심 과제');
    assert.ok(!row().classList.contains('have'), '관심 과제 줄이 내 과제처럼 흐려졌다');
    assert.strictEqual(W.el('caAdded').textContent, '이번에 1개를 관심 과제로 넣었습니다');
    assert.ok(!W.el('catAddModal').classList.contains('hidden'), '[보기]를 눌렀더니 창이 닫혔다');
    assert.ok(W.ev('PCAL.watch.some(p => p.projectUid === "' + E1 + '")'), '과제 탭의 보기만 목록에 들어가지 않았다');
    assert.strictEqual(W.ev('state.categories.length'), nCats, '[보기]가 내 과제(state.categories)를 늘렸다');
    assert.ok(!W.ev('state.categories.some(c => c.id === "db-' + E1 + '")'), '[보기]가 공식 과제를 내 과제에 넣었다');
    //  다시 누르면 뺀다
    await W.click(row().querySelector('[data-cawatchoff]'));
    assert.strictEqual(W.last('pcWatchRemove').projectUid, E1);
    await W.reply('pcWatchRemove', { ok: true, data: { projectUid: E1, removed: 1 } });
    assert.strictEqual(row().querySelector('.ca-act button').textContent, '추가');
    assert.strictEqual(W.el('caAdded').textContent, '');
    assert.ok(!W.ev('PCAL.watch.some(p => p.projectUid === "' + E1 + '")'), '빼기가 과제 탭 목록에서 지우지 않았다');
    //  실패는 알린다
    await W.click(row().querySelector('[data-cawatch]'));
    await W.reply('pcWatchAdd', { ok: false, error: { kind: 'forbidden', message: '과제가 없거나 숨겨졌습니다.' } });
    assert.strictEqual(row().querySelector('.ca-act button').textContent, '추가', '실패했는데 관심 과제로 바뀌었다');
    assert.ok(W.toasts().some((t) => /과제가 없거나 숨겨졌습니다/.test(t)), '실패 문구가 알림으로 나오지 않았다');
  }));

  test('보기만R⑧: 과제 추가 모드는 그대로다(탭, 열, [추가], 보기 모드 값이 새지 않음). 보기 모드에서 돌아와도 같다', () => withBoot({}, async (W) => {
    await enter(W);
    await openWatchWin(W);
    W.ev('closeModal("#catAddModal")'); await settle(); W.clock.advance(400); await settle();
    W.ev('openCatAdd("off")'); await settle();
    assert.strictEqual(W.el('caHead').textContent, '과제 추가');
    assert.ok(!W.el('catAddModal').classList.contains('ca-watch'));
    assert.notStrictEqual(W.w.getComputedStyle(W.el('caTabs')).display, 'none', '과제 추가 모드에서 위 탭이 숨겨졌다');
    for (const e of W.q('#catAddModal').querySelectorAll('.ca-wo')) assert.strictEqual(W.w.getComputedStyle(e).display, 'none', '과제 추가 모드에 보기 모드 전용 칸이 보인다: ' + e.className + ' ' + e.textContent.trim());   // 첫 칸만 보다가 .check(display:flex !important)에 진 '일정 없는 과제 숨김'을 놓쳤다(2026-11-05)
    const heads = [...W.q('#caList .ca-h').querySelectorAll('[role="columnheader"]')].map((x) => x.textContent.replace(/\s*\/\s*발주처$/, ''));
    assert.deepStrictEqual(heads.filter(Boolean), ['통상명칭', '계약명', '발주처', '상태', '계약기간'], '과제 추가 모드의 열이 바뀌었다');
    assert.ok(W.q('#caList .ca-g'), '과제 추가 모드에 구분 묶음이 없다');
    assert.ok(W.qa('#caList [data-caadd]').length >= 1 && !W.q('#caList [data-cawatch], #caList .ca-mbc'), '과제 추가 모드의 동작 칸이 [추가]가 아니다');
    assert.strictEqual(rowNames(W).length, 5, '과제 추가 모드는 일정 유무와 상관없이 활성 과제를 보인다(상태 체크는 공용 기억대로 모두 켬)');
    assert.strictEqual(W.cmds('pcWatchCatalog').length, 1, '과제 추가 모드가 목록용 읽기를 보냈다');
    //  상태 체크는 공용 기억을 그대로 쓴다(관리 화면과 한 벌)
    await W.change(W.q('#caStChecks [data-offst="2"]'), false);
    assert.strictEqual(W.w.localStorage.getItem('tc_projStatusOff'), '["2"]', '과제 추가 모드의 상태 체크가 공용 기억에 쓰지 않는다');
  }));

  //  2026-11-05(docs/PC-WATCH-2.md §3): 왼쪽 목록은 [내 과제 a/b | 관심 과제 c/d] 두 탭. 탭은 목록만 바꾸고 달력은 두 탭 체크의 합. 묶음 머리 체크는 걷었다
  test('보기만R⑨: 과제 탭 왼쪽 목록은 [내 과제 | 관심 과제] 두 탭, 관심 과제 줄은 이름 아래 작은 줄과 ×, 숨겨진 과제는 흐리게, [전체 선택] [전체 해제]는 지금 탭만', () => withBoot({}, async (W) => {
    await enter(W, { events: [EV(1, P1), EV(2, B1)] });
    assert.ok(!W.q('#pcView .pc-grp, #pcView [data-act="watchAll"]'), '걷은 묶음 머리(체크)가 남았다');
    const tabs = () => W.qa('#pcView .pc-stabs [role="tab"]').map((t) => [t.textContent.replace(/\s+/g, ''), t.getAttribute('aria-selected')]);
    assert.deepStrictEqual(tabs(), [['내과제2/2', 'true'], ['관심과제1/2', 'false']], '탭이 [내 과제 a/b | 관심 과제 c/d] 가 아니다(처음은 내 과제)');
    assert.ok(/달력에 3개/.test(W.q('#pcView .pc-side-h').textContent), '머리가 "달력에 n개" 가 아니다');
    assert.strictEqual(W.qa('#pcView .pc-list .pc-row').length, 2, '내 과제 탭에 내 과제 둘이 아니다');
    assert.ok(!W.q('#pcView .pc-list-w') && !W.q('#pcView .pc-addw'), '내 과제 탭에 관심 과제 줄이나 추가 단추가 있다');
    //  관심 과제 탭
    await W.click('#pcView #pcStab-watch');
    assert.deepStrictEqual(tabs().map((t) => t[1]), ['false', 'true']);
    const wrows = W.qa('#pcView .pc-list-w .pc-row');
    assert.strictEqual(wrows.length, 2);
    assert.strictEqual(wrows[0].querySelector('.pc-sub').textContent, 'D사, 진행중', '관심 과제 줄의 작은 줄(발주처, 상태)이 없다');
    assert.ok(wrows[0].querySelector('.pc-wx'), '관심 과제 줄에 × 가 없다');
    assert.ok(wrows[1].classList.contains('pc-hid') && wrows[1].querySelector('.pc-sub').textContent === '숨겨진 과제' && wrows[1].querySelector('input').disabled, '숨겨진 과제가 흐리게, 체크 불가로 보이지 않는다');
    assert.ok(!wrows[1].querySelector('.pc-mbc'), '숨겨진 과제에 참여자 단추가 있다(읽을 수 없다)');
    assert.ok(W.q('#pcView .pc-addw') && /＋ 관심 과제 추가/.test(W.q('#pcView .pc-addw').textContent), '목록 끝 [＋ 관심 과제 추가]가 없다');
    //  읽기 요청에는 숨겨진 관심 과제가 없다
    assert.ok(!W.cmds('projectCalendarLoad').at(-1).projectUids.includes(B2), '숨겨진 관심 과제를 범위 읽기에 넣었다(읽기 판정이 거절해 제외 목록을 되풀이한다)');
    assert.ok(W.cmds('projectCalendarLoad').at(-1).projectUids.includes(B1));
    //  [전체 해제]는 지금 탭만: 관심 과제만 꺼지고 달력에 내 과제만 남는다
    await W.click('#pcView [data-act="selNone"]');
    const ld = W.cmds('projectCalendarLoad').at(-1).projectUids;
    assert.ok(ld.includes(P1) && !ld.includes(B1), '전체 해제 뒤 달력 읽기가 내 과제만이 아니다: ' + JSON.stringify(ld));
    assert.ok(!W.ev('PCAL.sel').includes(B1) && W.ev('PCAL.sel').includes(P1), '관심 과제 탭의 전체 해제가 관심 과제만 끄지 않았다');
    assert.deepStrictEqual(tabs(), [['내과제2/2', 'false'], ['관심과제0/2', 'true']]);
    await W.click('#pcView [data-act="selAll"]');
    assert.ok(W.ev('PCAL.sel').includes(B1) && !W.ev('PCAL.sel').includes(B2), '전체 선택이 읽을 수 있는 관심 과제를 켜지 않았다(숨겨진 과제는 그대로)');
    //  탭은 과제 탭 설정에 기억한다
    assert.strictEqual(JSON.parse(W.w.localStorage.getItem('tc_pcal:hjlee')).side, 'watch', '고른 탭을 기억하지 않는다');
  }));

  test('보기만R⑩: 보기만 일정은 점선 모양이고 내 과제 일정은 그대로, × 는 확인 없이 뺀다, [＋ 다른 과제 보기]는 보기 모드 창을 연다', () => withBoot({}, async (W) => {
    //  jsdom 의 월간 칸은 한 칸에 일정 하나만 그리므로 둘을 다른 주에 둔다(달력 범위 안의 7일 뒤 또는 7일 앞).
    const rg = W.ev('pcRange()'); let d2 = W.ev('addDays(todayYmd(), 7)'); if (d2 > rg.to) d2 = W.ev('addDays(todayYmd(), -7)');
    await enter(W, { events: [EV(1, P1), EV(2, B1, { startDate: d2, endDate: d2 })] });
    const ev = (u) => W.q(`#pcView .pc-ev[data-ev="${u}"]`);
    assert.ok(ev(U(2)) && ev(U(2)).classList.contains('pc-watchev'), '보기만 일정에 점선 모양(pc-watchev)이 없다');
    assert.ok(ev(U(1)) && !ev(U(1)).classList.contains('pc-watchev'), '내 과제 일정이 점선이다');
    //  ×
    await W.click('#pcView #pcStab-watch');   // × 와 점선 단추는 관심 과제 탭에 있다(PC-WATCH-2 §3)
    await W.click(W.q('#pcView .pc-list-w .pc-row .pc-wx'));
    assert.strictEqual(W.last('pcWatchRemove').projectUid, B1);
    assert.ok(!W.q('.overlay:not(.hidden) #cfOk'), '× 가 확인 창을 띄운다');
    await W.reply('pcWatchRemove', { ok: true, data: { projectUid: B1, removed: 1 } });
    assert.strictEqual(W.qa('#pcView .pc-list-w .pc-row').length, 1, '× 뒤에 그 줄이 남아 있다');
    assert.ok(!ev(U(2)), '× 뒤에 그 과제 일정이 달력에 남아 있다');
    //  묶음이 하나뿐인 줄은 숨겨진 과제만 남음. 점선 단추는 보기 모드 창을 연다
    await W.click(W.q('#pcView .pc-addw'));
    assert.strictEqual(W.el('caHead').textContent, '관심 과제 추가', '[＋ 관심 과제 추가]가 보기 모드 창을 열지 않았다');
    assert.ok(!W.el('catAddModal').classList.contains('hidden'));
  }));

  test('보기만R⑪: 상세 단추는 두 값으로 정한다(수정, 삭제 = writable, 개인 일정에 등록 = mine). 보기만 과제는 [닫기]만, 머리에 "보기만"', () => withBoot({}, async (W) => {
    await enter(W, { events: [EV(1, P1), EV(2, B1), EV(3, P3)] });
    const btns = () => W.qa('#pcDetailFoot button').map((b) => b.dataset.act || (b.hasAttribute('data-close') ? 'close' : ''));
    W.ev(`pcOpenDetail("${U(2)}")`); await settle();
    assert.deepStrictEqual(btns(), ['close'], '보기만 과제의 상세에 [닫기] 말고 단추가 있다');
    assert.strictEqual(W.q('#pcDetailBody .pc-ro').textContent, '관심 과제');
    assert.ok(W.q('#pcDetailBody .pcd-proj .pc-dot.pc-ring'), '관심 과제 상세 머리의 색점 자리가 빈 동그라미가 아니다');
    W.ev('closeModal("#pcDetailModal")'); await settle(); W.clock.advance(400); await settle();
    W.ev(`pcOpenDetail("${U(1)}")`); await settle();
    assert.deepStrictEqual(btns(), ['delete', 'copy', 'edit'], '내 과제(쓰기 가능)의 상세 단추가 삭제, 개인 일정에 등록, 수정이 아니다');
    W.ev('closeModal("#pcDetailModal")'); await settle(); W.clock.advance(400); await settle();
    W.ev(`pcOpenDetail("${U(3)}")`); await settle();
    assert.deepStrictEqual(btns(), ['copy'], '숨겨졌어도 내 과제면 개인 일정에 등록은 된다(mine). 수정, 삭제만 막힌다(writable)');
    assert.strictEqual(W.q('#pcDetailBody .pc-ro').textContent, '숨긴 과제, 읽기 전용');
    //  보기만 과제의 개인 일정 등록은 함수도 막는다
    const n = W.cmds('projectCalendarCopy').length;
    await W.w.eval(`pcCopy("${U(2)}")`); await settle();
    assert.strictEqual(W.cmds('projectCalendarCopy').length, n, '보기만 과제에서 개인 일정 등록 요청이 나갔다');
  }));

  test('보기만R⑫: 일정 등록 창의 과제 고르기에는 내 과제만 있다, 보기만 과제는 새 일정의 과제로 고를 수 없고 수정도 막힌다', () => withBoot({}, async (W) => {
    await enter(W, { events: [EV(2, B1)] });
    W.ev('pcOpenForm({ date: PCAL.anchor })'); await settle();
    const opts = [...W.el('pcfProj').options].map((o) => o.value).filter(Boolean);
    assert.deepStrictEqual(opts, [P1], '일정 등록 창의 과제 목록이 내 과제(쓰기 가능)만이 아니다');
    assert.ok(!opts.includes(B1));
    W.ev('closeModal("#pcFormModal")'); await settle(); W.clock.advance(400); await settle();
    W.ev(`pcOpenForm({ uid: "${U(2)}" })`); await settle();
    assert.ok(W.el('pcFormModal').classList.contains('hidden'), '보기만 과제의 일정을 수정 폼으로 열었다');
  }));

  test('보기만R⑬: 보기만 과제는 내 과제(state.categories)와 근태, 취합, 개인 필터의 과제 목록에 섞이지 않는다', () => withBoot({}, async (W) => {
    await enter(W, { events: [EV(2, B1)] });
    const ids = () => W.ev('JSON.stringify(state.categories.map(c => c.id))');
    const before = ids();
    assert.ok(!before.includes(B1) && !before.includes(B2));
    await openWatchWin(W);
    await W.click(rowsOf(W).find((r) => r.querySelector('.cat-nm').dataset.full === '표적기').querySelector('[data-cawatch]'));
    await W.reply('pcWatchAdd', { ok: true, data: { projectUid: E1, added: true, count: 3 } });
    assert.strictEqual(ids(), before, '보기만 과제가 내 과제 목록(근태, 취합, 필터가 읽는 state.categories)에 섞였다');
    //  개인 달력의 과제 필터와 근태 과제 선택이 쓰는 목록에도 없다
    const names = W.ev('JSON.stringify(state.categories.map(c => c.name))');
    for (const n of ['함대공 훈련장비', '표적기', '숨겨진 표본']) assert.ok(!names.includes(n), `${n} 이 개인 과제 목록에 있다`);
    assert.ok(!W.ev('typeof atTaskList === "function" ? JSON.stringify(atTaskList()).includes("' + B1 + '") : false'), '근태 과제 목록에 보기만 과제가 있다');
    assert.strictEqual(W.cmds('saveState').filter((p) => /db-b/.test(JSON.stringify(p))).length, 0, '보기만 과제가 개인 저장에 실렸다');
  }));

  test('보기만R⑭: 사람 고르기 한 명 모드(다른 사람 일정 보기)는 그대로: 행을 누르면 열람 창, 칩과 [완료] 줄이 없고 체크 칸이 없다', () => withBoot({}, async (W) => {
    await W.click('#btnPeerPick');
    await W.reply('membersGet', { ok: true, data: { members: MEMBERS, units: UNITS, myUnit: '개발1팀' } });
    const pop = W.el('peerPicker');
    assert.ok(pop && !pop.classList.contains('hidden'));
    assert.ok(!pop.classList.contains('pk-multi') && !pop.querySelector('.pk-chips, .pk-foot, input[type="checkbox"]'), '한 명 모드에 칩 줄, [완료] 줄, 체크 칸이 있다(여러 명 모드는 걷었다)');
    assert.strictEqual(pop.querySelectorAll('.pk-mpick').length, 0, '한 명 모드에 체크 줄이 있다');
    assert.strictEqual(pop.getAttribute('aria-label'), '다른 사람 일정: 사람 고르기');
    const open = [...pop.querySelectorAll('.pk-body .pk-open')].find((b) => b.dataset.login === 'u1');
    assert.ok(open, '한 명을 여는 단추(.pk-open)가 없다');
    assert.ok(![...pop.querySelectorAll('.pk-body .pk-open')].some((b) => b.dataset.login === 'hjlee' && b.getAttribute('aria-disabled') !== 'true'), '내 줄을 열 수 있다(나 자신은 회색이어야 한다)');
    await W.click(open);
    assert.strictEqual((W.cmds('peerOpen').at(-1) || {}).loginId, 'u1', '한 명 모드에서 행을 눌러도 열람 창(peerOpen)이 열리지 않는다');
    assert.ok(W.el('peerPicker').classList.contains('hidden'), '고른 뒤 팝오버가 닫히지 않았다');
  }));

  test('보기만R⑮: 호스트 실패는 알린다(목록용 읽기 실패 + 다시 시도, 보기만 목록 읽기 실패는 내 과제 화면을 막지 않는다)', () => withBoot({}, async (W) => {
    await W.click('#pcTabProject');
    await W.reply('projectCalendarBootstrap', { ok: true, data: { projects: MINE, limits: { title: 200, location: 200, memo: 8000 } } });
    await W.reply('pcWatchList', { ok: false, error: { kind: 'network', message: '' } });
    assert.ok(W.q('#pcView .pc-side'), '관심 과제 목록을 못 읽었다고 과제 화면이 열리지 않는다');
    assert.strictEqual(W.qa('#pcView .pc-list:not(.pc-list-w) .pc-row').length, 2);
    assert.ok(/관심 과제 목록을 읽지 못했습니다/.test(W.q('#pcView .pc-side').textContent), '읽지 못했다는 말이 없다');
    await openWatchWin(W, { cat: [] });
    W.ev('CAW.status = "error"; CAW.err = "서버 응답이 늦습니다."; renderCaList(true)'); await settle();
    assert.ok(W.q('#caList [data-caretry]') && /일정 정보를 읽지 못했습니다/.test(W.q('#caList').textContent), '목록용 읽기 실패에 다시 시도가 없다');
    await W.click('#caList [data-caretry]');
    assert.strictEqual(W.cmds('pcWatchCatalog').length, 2, '다시 시도가 목록용 읽기를 다시 보내지 않았다');
  }));

  /* ══ (M) 변이 ═══════════════════════════════════════════════════════ */
  test('변이보기만①: 쓰기 판정을 넓히거나(EligibleSql 에서 내 과제 조건 빼기) 쓰기 길이 읽기 판정을 부르면 H① 이 잡는다', () => {
    const bad = mutate('"WHERE c.user_id=@me AND c.source=\'db\'";', '"WHERE c.source=\'db\'";', pcdb);
    assert.throws(() => hostChecks.writeJudgeUnchanged(bad), /쓰기 판정 SQL\(EligibleSql\)이 바뀌었다/);
    const bad2 = mutate('var proj = await RequireProjectAsync(conn, tx, me, projectUid, write: true, ct, lockProject: true);', 'var proj = (await ReadableProjectsAsync(conn, tx, me.UserId, new List<string> { projectUid }, ct))[0];', pcdb);
    assert.throws(() => hostChecks.writeJudgeUnchanged(bad2), /읽기 판정을 부른다|쓰기 판정\(내 과제만\)을 거치지 않는다/);
    const bad3 = mutate('await RequireReadableAsync(conn, null, me, projectUid, ct);', 'await RequireProjectAsync(conn, null, me, projectUid, write: false, ct);', pcdb);
    assert.throws(() => hostChecks.writeJudgeUnchanged(bad3), /MembersAsync 가 읽기 판정을 쓰지 않는다/);
  });
  test('변이보기만②: 읽기 규칙에서 숨겨졌어도 내 과제 조건(HAVING)이나 넣기의 과제 is_active 를 빼면 H②, H③ 이 잡는다', () => {
    const bad = mutate('HAVING p.is_active = 1 OR mine = 1', 'HAVING p.is_active = 1', pcdb);
    assert.throws(() => hostChecks.readableRule(bad), /읽기 규칙/);
    const bad2 = mutate('FROM project p WHERE p.uid = @pu AND p.is_active = 1', 'FROM project p WHERE p.uid = @pu', pcdb);
    assert.throws(() => hostChecks.addRemove(bad2), /평범한 INSERT/);
    const bad3 = mutate('"INSERT INTO cal_project_watch (user_id, project_id, added_at) "', '"INSERT IGNORE INTO cal_project_watch (user_id, project_id, added_at) "', pcdb);
    assert.throws(() => hostChecks.addRemove(bad3), /INSERT IGNORE/);
    const bad4 = mutate('if (total >= WatchMax)', 'if (false)', pcdb);
    assert.throws(() => hostChecks.addRemove(bad4), /상한은 이미 보는 중인지 본 뒤/);
    const bad5 = mutate('DELETE FROM cal_project_watch WHERE user_id = @me AND project_id = @pid', 'DELETE FROM cal_project_watch WHERE project_id = @pid', pcdb);
    assert.throws(() => hostChecks.addRemove(bad5), /키 칸 조건 DELETE/);
  });
  test('변이보기만③: 목록이 내 과제를 거르지 않거나 목록용 읽기가 이름을 싣거나 숨겨진 과제를 지우면 H④ 가 잡는다', () => {
    const bad = mutate('"WHERE w.user_id=@me AND NOT EXISTS (SELECT 1 FROM cal_category c WHERE c.user_id=@me AND c.source=\'db\' AND c.project_uid = p.uid) "', '"WHERE w.user_id=@me "', pcdb);
    assert.throws(() => hostChecks.listAndCatalog(bad), /내 과제가 된 과제를 거르지 않는다/);
    const bad2 = mutate('"SELECT DISTINCT c.project_uid, u.login_id AS member_login FROM cal_category c "', '"SELECT DISTINCT c.project_uid, u.login_id AS member_login, u.name FROM cal_category c "', pcdb);
    assert.throws(() => hostChecks.listAndCatalog(bad2), /이름, 조직, 직급을 싣는다/);
    const bad3 = mutate('"WHERE w.user_id=@me AND NOT EXISTS', '"WHERE p.is_active = 1 AND w.user_id=@me AND NOT EXISTS', pcdb);
    assert.throws(() => hostChecks.listAndCatalog(bad3), /숨겨진 과제를 SQL 로 거른다/);
  });
  test('변이보기만④: 보기 모드에서 과제 추가 모드의 [추가] 단추를 내면 화면① 이 잡는다', async () => {
    const bad = mutate(`'<button type="button" class="btn sm" data-cawatch="' + esc(uid) + '">추가</button>'`, `'<button type="button" class="btn sm primary" data-caadd="' + esc(uid) + '">추가</button>'`, src);
    const W = await boot({ source: bad });
    try {
      await enter(W);
      await openWatchWin(W);
      assert.ok(W.q('#caList [data-caadd]'), '변이가 [추가]를 내지 못했다(시험이 잡을 차이가 없다)');
      assert.ok(!W.q('#caList [data-cawatch]'));
    } finally { W.close(); }
  });
  test('변이보기만⑤: 개인 일정 등록 단추가 mine 대신 writable 을 보면 화면⑪ 이 잡는다', async () => {
    const bad = mutate(`+ (p.mine === false ? '' : '<button type="button" class="btn pc-w" data-act="copy">'`, `+ (ro ? '' : '<button type="button" class="btn pc-w" data-act="copy">'`, src);
    const W = await boot({ source: bad });
    try {
      await enter(W, { events: [EV(3, P3)] });
      W.ev(`pcOpenDetail("${U(3)}")`); await settle();
      assert.ok(!W.q('#pcDetailFoot [data-act="copy"]'), '변이가 숨긴 내 과제의 등록 단추를 없애지 못했다(시험이 잡을 차이가 없다)');
    } finally { W.close(); }
    //  원본은 숨겨진 내 과제에도 등록 단추가 있다(R⑪ 이 본다)
  });
  test('변이보기만⑥: 보기만 추가가 내 과제(state.categories)에도 넣으면(근태 과제 목록에 섞임) 화면⑬ 이 잡는다', async () => {
    const bad = mutate('  if(PCAL.loaded && !PCAL.projects.some(p => p.projectUid === src.uid)', '  try{ subscribeDbCat(dbCatalogById("db-" + src.uid)); }catch(_){}\n  if(PCAL.loaded && !PCAL.projects.some(p => p.projectUid === src.uid)', src);
    const W = await boot({ source: bad });
    try {
      await enter(W);
      await openWatchWin(W);
      await W.click(rowsOf(W).find((r) => r.querySelector('.cat-nm').dataset.full === '표적기').querySelector('[data-cawatch]'));
      await W.reply('pcWatchAdd', { ok: true, data: { projectUid: E1, added: true, count: 3 } });
      assert.ok(W.ev('state.categories.some(c => c.id === "db-' + E1 + '")'), '변이가 내 과제에 섞지 못했다(시험이 잡을 차이가 없다)');
    } finally { W.close(); }
  });
  //  2026-11-05: 여러 명 모드를 걷었으니 한 명 모드의 지킬 것은 "행을 누르면 열람 창"이다
  test('변이보기만⑦: 사람 고르기 한 명 모드에서 행이 열람 창을 열지 않으면(pkPick 빠짐) 화면⑭ 가 잡는다', async () => {
    const bad = mutate('    pkPick(id, nm);', '    void 0;', src);
    const W = await boot({ source: bad });
    try {
      await W.click('#btnPeerPick');
      await W.reply('membersGet', { ok: true, data: { members: MEMBERS, units: UNITS, myUnit: '개발1팀' } });
      const open = [...W.qa('#peerPicker .pk-body .pk-open')].find((b) => b.dataset.login === 'u1');
      await W.click(open);
      assert.ok(!W.cmds('peerOpen').length, '변이가 열람 창 열기를 막지 못했다(시험이 잡을 차이가 없다)');
    } finally { W.close(); }
  });
  test('변이보기만⑧: 숨겨진 보기만 과제를 읽기 요청에 넣으면 화면⑨ 이 잡는다, 참여자 이름 찾기를 빼면 화면⑤ 가 잡는다, 일정 있는 과제만을 무시하면 화면① 이 잡는다', async () => {
    const bad = mutate('return pcAll().filter(p => s.has(p.projectUid) && !p.hidden);', 'return pcAll().filter(p => s.has(p.projectUid));', src);
    let W = await boot({ source: bad });
    try { await enter(W); assert.ok(W.cmds('projectCalendarLoad').at(-1).projectUids.includes(B2), '변이가 숨겨진 과제를 넣지 못했다'); } finally { W.close(); }
    const bad2 = mutate('!hay.includes(q) && !names.some(n => offNorm(n).includes(q))', '!hay.includes(q) && !false', src);
    W = await boot({ source: bad2 });
    try {
      await enter(W); await openWatchWin(W);
      await W.type(W.el('caSearch'), '김하늘');
      assert.deepStrictEqual(rowNames(W), [], '변이가 참여자 이름 찾기를 끄지 못했다');
    } finally { W.close(); }
    const bad3 = mutate('if(ok && CAW.onlyAct && !(info && info.last)) continue;', 'if(false) continue;', src);
    W = await boot({ source: bad3 });
    try {
      await enter(W); await openWatchWin(W);
      assert.ok(rowNames(W).includes('해양 부이 통신'), '변이가 일정 있는 과제만을 끄지 못했다');
    } finally { W.close(); }
  });
}
