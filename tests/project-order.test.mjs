// 과제 순서(No)와 연결 규칙 삭제: 호스트와 DB 절반(docs/PROJECT-ADMIN-UX.md §1.1, §1.4, 2026-10-26)
//
// 이 파일이 지키는 것(웹 절반은 tests/project-order-web.test.mjs):
//   ① 구조 19: project.sort_no INT UNSIGNED NULL 이 정본 schema-structure.sql 에서 status_id 바로 뒤에 있고, 이관 조각 v19 가
//      같은 형, 같은 자리로 더한다. 코드표 표 설명에 고정 번호 문구가 없다. 앱 구조 번호 = 정본 시딩 = 조각 사슬의 끝 = 19.
//   ② 목록 순서: 과제 목록(관리 목록, Excel, 공식 과제 찾아보기와 재연결이 모두 쓰는 LoadProjectsJsonAsync)이 sortNo 를 싣고
//      구분 순서, sort_no(빈 값은 뒤), 표시 이름 순으로 돌려준다.
//   ③ 순서 저장 명령 projectReorder {sectionId, uids}: 편집 권한(OpenWriteAsync), 한 트랜잭션, 그 구분의 보이는 과제를 잠근 채
//      읽어 받은 uid 집합과 같을 때만 1, 2, 3 을 쓰고 다르면 아무것도 쓰지 않고 stale 로 거부한다. 회신 {ok, msg, stale, kind, error} 뒤 새 목록.
//   ④ 맨 뒤 규칙: 새 과제, 구분을 바꾼 과제, 되살린 과제(숨김 해제와 휴지통 복구)는 그 구분의 보이는 과제 최댓값 + 1.
//      구분을 그대로 둔 편집과 숨김은 순서를 바꾸지 않는다.
//   ⑤ 문구와 장표: 과제 캘린더의 읽기 전용 문장은 '숨긴 과제'(상태 종료와 헷갈리지 않게), 엑셀 No 는 구분 안 순서.
//   선진행 규칙과 고정 번호 보호의 삭제(A1, A4)는 tests/code-ids-app.test.mjs ②③ 과 setup-taskcalendar ㉔ 가 본다.
//   ★ 검사는 전부 checks 의 함수다. 변이가 같은 함수를 다시 불러 '잡았다'를 증명한다.
import { test, assert, readText, extractCsMember, stripCsComments } from './harness.mjs';
import { stripSqlComments, parseSeededSchemaVersion } from './canon-schema.mjs';

const R = (p) => readText(new URL('../' + p, import.meta.url));
const lf = (s) => s.replace(/\r+\n/g, '\n');
const src = {
  struct: R('db/deploy/schema-structure.sql'),
  cal: R('db/deploy/schema-calendar.sql'),
  frag: R('db/deploy/migrations/v19-project-order.sql'),
  gate: R('widget/DbGate.cs'),
  pdb: R('widget/ProjectDb.cs'),
  pcdb: R('widget/ProjectCalendarDb.cs'),
  main: lf(R('widget/MainWindow.xaml.cs')),
};

function mutate(text, from, to) {
  const n = text.split(from).length - 1;
  assert.strictEqual(n, 1, `변이 앵커가 ${n}번 나온다(1번이어야 한다): ${from.slice(0, 80)}`);
  return text.replace(from, () => to);
}
//  CREATE TABLE <t> ( ... ) 본문의 열 줄(주석 지움): [{ name, def }]
function columns(sql, t) {
  const m = new RegExp(`CREATE TABLE ${t} \\(([\\s\\S]*?)\\n\\) ENGINE`).exec(stripSqlComments(sql));
  assert.ok(m, `정본에서 ${t} 표를 찾지 못했다(판정 불가)`);
  return m[1].split('\n').map((l) => /^\s+([a-z_]+)\s+(.+?),?\s*$/.exec(l)).filter((x) => x && !/^(PRIMARY|UNIQUE|KEY|CONSTRAINT)$/i.test(x[1]))
    .map((x) => ({ name: x[1], def: x[2].replace(/\s+/g, ' ').trim() }));
}
function tableComment(sql, t) {
  const m = new RegExp(`CREATE TABLE ${t} \\([\\s\\S]*?\\) ENGINE=InnoDB[^\\n]*\\n\\s*COMMENT='([^']*)';`).exec(sql);
  assert.ok(m, `정본에서 ${t} 표 설명을 찾지 못했다(판정 불가)`);
  return m[1];
}
//  C# 문자열 리터럴을 이어 붙인 문장(head 로 시작하는 리터럴부터 ';' 까지)
function csSql(cs, head) {
  const i = cs.indexOf('"' + head);
  assert.ok(i >= 0, `${head} 문장을 찾지 못했다`);
  return [...cs.slice(i, cs.indexOf(';', i)).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('');
}

const checks = {
  // ① 구조 19
  structure(s) {
    const cols = columns(s.struct, 'project');
    const i = cols.findIndex((c) => c.name === 'sort_no');
    assert.ok(i > 0, 'schema-structure.sql 의 project 에 sort_no 가 없다');
    assert.strictEqual(cols[i].def, 'INT UNSIGNED NULL', `sort_no 가 INT UNSIGNED NULL 이 아니다: ${cols[i].def}`);
    assert.strictEqual(cols[i - 1].name, 'status_id', 'sort_no 바로 앞이 status_id 가 아니다(조각은 AFTER status_id)');
    assert.strictEqual(cols[i + 1].name, 'note', 'sort_no 바로 뒤가 note 가 아니다');
    const code = stripSqlComments(s.frag);
    assert.ok(/^-- @migration from=18 to=19\n/.test(s.frag), 'v19 조각의 머리가 18 에서 19 가 아니다');
    assert.ok(code.includes("'ALTER TABLE project ADD COLUMN sort_no INT UNSIGNED NULL AFTER status_id, ALGORITHM=INSTANT'"),
      'v19 조각이 sort_no 를 정본과 같은 형, 같은 자리(AFTER status_id, INSTANT)로 더하지 않는다');
    assert.ok(/AND COLUMN_TYPE = 'int unsigned' AND IS_NULLABLE = 'YES'/.test(code) && /a\.COLUMN_NAME = 'status_id' AND b\.COLUMN_NAME = 'sort_no'/.test(code),
      'v19 검증이 칸의 형(int unsigned, NULL 허용)과 자리(status_id 바로 뒤)를 보지 않는다');
    for (const t of ['section_code', 'status_code']) {
      const c = tableComment(s.struct, t);
      assert.ok(!/고정 번호|선진행|종료/.test(c), `${t} 표 설명에 고정 번호 문구가 남았다: ${c}`);
      assert.ok(code.includes(`ALTER TABLE ${t} COMMENT = ''${c}''`), `v19 조각의 ${t} 표 설명이 정본과 다르다`);
    }
    assert.ok(!/고정 번호: 2=/.test(s.struct), '정본 주석에 고정 번호 동작(2=선진행, 2=종료)이 남았다');
    const app = /public const int AppStructureVersion = (\d+);/.exec(stripCsComments(s.gate));
    assert.ok(app, 'DbGate.AppStructureVersion 을 찾지 못했다');
    assert.ok(Number(app[1]) >= 19, `앱 구조 번호가 ${app[1]} 이다(과제 순서는 구조 19)`);
    assert.strictEqual(parseSeededSchemaVersion(stripSqlComments(s.cal)), app[1], '정본 schema-calendar.sql 의 시딩이 앱 구조 번호와 다르다');
  },

  // ② 목록 순서와 sortNo
  listOrder(pdb) {
    const lp = extractCsMember(pdb, 'public async Task<string?> LoadProjectsJsonAsync(');
    assert.ok(/\["sortNo"\]\s*= IntOrNull\(rd, "sort_no"\)/.test(lp), '과제 목록이 sortNo(그 구분 안의 순서)를 싣지 않는다');
    assert.ok(/p\.sort_no, /.test(csSql(pdb, 'SELECT p.uid,')), '과제 목록 SELECT 가 p.sort_no 를 읽지 않는다');
    assert.ok(/"WHERE p\.is_active=1 " \+ ProjectListOrder;/.test(lp), '과제 목록이 ProjectListOrder 로 정렬하지 않는다');
    const ord = /internal const string ProjectListOrder =\s*"([^"]*)";/.exec(stripCsComments(pdb));
    assert.ok(ord, 'ProjectListOrder 를 찾지 못했다');
    const keys = ord[1].replace(/^ORDER BY /, '').split(/,\s*(?![^()]*\))/).map((x) => x.trim());
    assert.deepStrictEqual(keys.slice(0, 4), ['s.sort_order', 's.section_id', 'p.sort_no IS NULL', 'p.sort_no'],
      `과제 목록 순서가 (구분 순서, 구분, 빈 순서는 뒤, 순서) 로 시작하지 않는다: ${ord[1]}`);
    assert.ok(/^COALESCE\(NULLIF\(p\.common_name, ''\), p\.project_name\)$/.test(keys[4]) && keys[5] === 'p.id',
      `같은 순서 안에서 표시 이름(통상명칭, 비었으면 사업명), id 순이 아니다: ${ord[1]}`);
  },

  // ③ 순서 저장
  reorder(pdb, main) {
    const ro = extractCsMember(pdb, 'public async Task<(bool ok, string msg, bool stale)> ReorderProjectsAsync(');
    assert.ok(/conn = await OpenWriteAsync\(/.test(ro) && !/OpenAdminAsync/.test(ro), '과제 순서의 권한이 과제 편집과 같은 OpenWriteAsync 가 아니다');
    assert.ok(/catch \(NotAuthorizedException nex\)[^\n]*return \(false, nex\.Message, false\);/.test(ro), '권한 거부를 그 문장 그대로 돌려주지 않는다');
    const tx = ro.indexOf('BeginTransactionAsync'), sel = ro.indexOf('"SELECT uid FROM project WHERE section_id=@sec AND is_active=1 FOR UPDATE"');
    assert.ok(tx > 0 && sel > tx, '그 구분의 보이는 과제를 트랜잭션 안에서 잠근 채(FOR UPDATE) 읽지 않는다');
    const cmp = ro.indexOf('if (given.Count != kept.Count || given.Count != live.Count || !given.SetEquals(live))');
    assert.ok(cmp > sel, '받은 uid 집합이 그 구분의 보이는 과제 집합과 같은지(중복, 빠짐, 낯선 uid) 보지 않는다');
    const stale = /if \(given\.Count != kept\.Count[^\n]*\n\s*\{([\s\S]*?)\n\s*\}/.exec(ro.slice(cmp));
    assert.ok(stale && /await SafeRollbackAsync\(tx\);/.test(stale[1]) && /return \(false, ProjectOrderStaleMsg, true\);/.test(stale[1]),
      '목록이 다를 때 되돌리고 stale=true 로 거부하지 않는다');
    const upd = ro.indexOf('"UPDATE project SET sort_no=@n WHERE uid=@uid AND section_id=@sec AND is_active=1"');
    assert.ok(upd > cmp, '순서 쓰기가 (판정 뒤, 같은 구분의 보이는 과제만) 이 아니다');
    assert.ok(/int order = 0;[\s\S]*?order\+\+;[\s\S]*?AddWithValue\("@n", order\)/.test(ro), '순서가 1 부터가 아니다');
    assert.ok(ro.indexOf('await tx.CommitAsync(') > upd, '순서 쓰기 뒤에 확정하지 않는다');
    assert.ok(/internal const string ProjectOrderStaleMsg = OrgTitleStaleMsg;/.test(pdb), '낡은 목록 문장이 구분, 상태 순서와 같은 문장이 아니다');
    //  브리지: 관리 창 허용, 번호와 uid 배열, 회신 {ok, msg, stale, kind, error} 뒤 새 목록
    const allow = /AdminWinCommands = new\(StringComparer\.Ordinal\)\s*\{([\s\S]*?)\};/.exec(main);
    assert.ok(allow && /"projectReorder"/.test(allow[1]), '관리 창 허용 목록에 projectReorder 가 없다');
    const cs = /case "projectReorder":[\s\S]*?break;/.exec(stripCsComments(main));
    assert.ok(cs && /RunReorderProjectsAsync\(GetStr\(doc, "reqId"\), GetInt\(doc, "sectionId"\), GetStrArray\(doc, "uids"\)\)/.test(cs[0]),
      'projectReorder 가 (reqId, sectionId 번호, uids 배열) 을 읽지 않는다');
    const run = extractCsMember(main, 'private async Task RunReorderProjectsAsync(');
    assert.ok(/string kind = ok \? "" : stale \? "stale" : "error";/.test(run) && /ReplyOnUi\(reqId, new \{ ok, msg, stale, kind, error = ok \? "" : msg \}\);/.test(run) &&
      /if \(ok \|\| stale\) await LoadProjectsToWebAsync\(\);/.test(run),
      'projectReorder 회신이 {ok, msg, stale, kind(stale 또는 error), error} 가 아니거나 성공과 낡음 뒤에 새 목록을 보내지 않는다');
  },

  // ④ 맨 뒤 규칙
  tailRules(pdb) {
    const nx = extractCsMember(pdb, 'private static async Task<long> NextProjectSortNoAsync(');
    assert.ok(/"SELECT COALESCE\(MAX\(sort_no\),0\)\+1 FROM project WHERE section_id=@sec AND is_active=1"/.test(nx), '맨 뒤 번호가 (그 구분의 보이는 과제 최댓값 + 1) 이 아니다');
    const nu = extractCsMember(pdb, 'private static async Task<long> NextProjectSortNoForUidAsync(');
    assert.ok(/COALESCE\(MAX\(p\.sort_no\),0\)\+1 FROM project t JOIN project p ON p\.section_id = t\.section_id AND p\.is_active=1 WHERE t\.uid=@uid/.test(nu),
      '되살릴 과제의 맨 뒤 번호가 (그 과제가 속한 구분의 보이는 과제 최댓값 + 1) 이 아니다');
    const up = extractCsMember(pdb, 'public async Task<(bool ok, string msg, bool needConfirm)> UpsertProjectAsync(');
    //  새 과제: INSERT 앞에서 그 구분의 맨 뒤 번호를 구해 sort_no 에 넣는다
    const ins = up.indexOf('INSERT INTO project ('), nIns = up.lastIndexOf('await NextProjectSortNoAsync(conn, null, sectionId, cts.Token)', ins);
    assert.ok(nIns > 0 && nIns < ins, '새 과제의 순서를 INSERT 전에 그 구분의 맨 뒤로 구하지 않는다');
    assert.ok(/sort_no, status_id, note\) " \+\s*"VALUES \([^)]*@sort,@st,@note\)"/.test(up) && /AddWithValue\("@sort", sortNo\)/.test(up), 'INSERT 가 sort_no 에 맨 뒤 번호(@sort)를 넣지 않는다');
    //  수정: 구분을 바꿨을 때만 새 구분의 맨 뒤. sort_no 대입이 section_id 대입보다 앞이어야 한다(MySQL 은 왼쪽부터 대입한다).
    const u = csSql(up, 'UPDATE project SET ');
    const a = u.indexOf('sort_no=IF(section_id=@sec, sort_no, @sortMoved)'), b = u.indexOf('section_id=@sec, customer_id=@cust');
    assert.ok(a >= 0, '수정이 구분을 바꿨을 때만 새 번호를 주는 IF(section_id=@sec, sort_no, @sortMoved) 가 아니다');
    assert.ok(b > a, '수정에서 section_id 대입이 sort_no 대입보다 앞이다(왼쪽부터 대입이라 구분을 바꿔도 순서가 그대로 남는다)');
    assert.ok(/long movedSortNo = await NextProjectSortNoAsync\(conn, null, sectionId, cts\.Token\);/.test(up) && /AddWithValue\("@sortMoved", movedSortNo\)/.test(up),
      '구분을 바꾼 과제의 번호를 새 구분의 맨 뒤로 구하지 않는다');
    //  숨김 해제: 숨겨져 있던 과제만 새 번호. 숨김은 순서를 건드리지 않는다.
    const sa = extractCsMember(pdb, 'public async Task<(bool ok, string msg)> SetProjectActiveAsync(');
    assert.ok(/long sortNo = active \? await NextProjectSortNoForUidAsync\(conn, null, u, cts\.Token\) : 0L;/.test(sa), '숨김 해제가 그 구분의 맨 뒤 번호를 구하지 않는다');
    assert.ok(/\? "UPDATE project SET sort_no=IF\(is_active=1, sort_no, @sort\), is_active=1 WHERE uid=@uid"/.test(sa),
      '숨김 해제가 (숨겨져 있던 과제만 새 번호, sort_no 대입이 먼저) 가 아니다');
    assert.ok(/: "UPDATE project SET is_active=@a WHERE uid=@uid"/.test(sa), '숨김이 순서를 건드린다');
    //  휴지통 복구: 같은 트랜잭션에서 맨 뒤 번호
    const rt = extractCsMember(pdb, 'public async Task<(bool ok, string msg)> RestoreTrashAsync(');
    assert.ok(/case "project":\s+sql = "UPDATE project SET is_active=1, sort_no=@sort WHERE uid=@k"; break;/.test(rt), '휴지통의 과제 복구가 sort_no 를 새로 주지 않는다');
    assert.ok(/if \(kd == "project"\) cmd\.Parameters\.AddWithValue\("@sort", await NextProjectSortNoForUidAsync\(conn, tx, k, cts\.Token\)\);/.test(rt),
      '휴지통의 과제 복구가 같은 트랜잭션에서 그 구분의 맨 뒤 번호를 구하지 않는다');
  },

  // ⑤ 문구와 장표
  wordingAndSheet(pcdb, main) {
    const ro = /internal const string MsgReadOnly = "([^"]*)";/.exec(pcdb);
    assert.ok(ro, 'ProjectCalendarDb.MsgReadOnly 를 찾지 못했다');
    assert.ok(/숨긴 과제/.test(ro[1]) && !/종료/.test(ro[1]), `과제 캘린더의 읽기 전용 문장이 숨긴 과제를 말하지 않거나 종료를 말한다(상태 종료와 헷갈린다): ${ro[1]}`);
    const rows = extractCsMember(main, 'private static List<XlsxWriter.Row> ReadProjectExportRows(');
    assert.ok(/string key = ProjectExportGroupKey\(r\);\s*\n\s*if \(!string\.Equals\(key, groupKey, StringComparison\.Ordinal\)\) \{ groupKey = key; no = 0; \}/.test(rows),
      '엑셀 No 가 구분이 바뀔 때 1 부터 다시 세지 않는다');
    assert.ok(/if \(field\.Length == 0\) \{ cells\[i\] = ProjectExportNo\(r, no\)\./.test(rows), '엑셀 No 열이 웹의 no(화면 No)를 먼저 쓰지 않는다');
    const pn = extractCsMember(main, 'private static int ProjectExportNo(');
    assert.ok(/r\.TryGetProperty\("no", out var nv\) && nv\.ValueKind == JsonValueKind\.Number && nv\.TryGetInt32\(out int n\) && n >= 1 \? n : running/.test(pn),
      '엑셀 No 가 (웹의 no 가 1 이상의 정수면 그것, 아니면 구분 안에서 센 값) 이 아니다');
    const gk = extractCsMember(main, 'private static string ProjectExportGroupKey(');
    assert.ok(/"sectionId"/.test(gk) && /"section"/.test(gk), '엑셀 No 의 묶음 열쇠가 구분 번호(없으면 구분 이름)가 아니다');
  },
};

// ══ 계약 ═══════════════════════════════════════════════════════════════
test('과제 순서①: 구조 19 의 sort_no(INT UNSIGNED NULL, status_id 뒤)가 정본과 v19 조각에서 같고, 코드표 표 설명에 고정 번호 문구가 없다', () => checks.structure(src));
test('과제 순서②: 과제 목록이 sortNo 를 싣고 구분 순서, sort_no(빈 값은 뒤), 표시 이름, id 순으로 돌려준다', () => checks.listOrder(src.pdb));
test('과제 순서③: projectReorder 는 편집 권한, 한 트랜잭션, 잠근 채 집합 대조 뒤에만 1 부터 쓰고, 다르면 stale 로 거부한다', () => checks.reorder(src.pdb, src.main));
test('과제 순서④: 새 과제, 구분을 바꾼 과제, 되살린 과제는 그 구분의 맨 뒤, 그대로 둔 편집과 숨김은 순서를 바꾸지 않는다', () => checks.tailRules(src.pdb));
test('과제 순서⑤: 과제 캘린더의 읽기 전용 문장은 숨긴 과제, 엑셀 No 는 구분 안 순서(웹의 no 우선)', () => checks.wordingAndSheet(src.pcdb, src.main));

// ══ 변이: 검사가 정말 무는지 ═══════════════════════════════════════════
test('과제 순서 변이①: 정본의 sort_no 를 note 뒤로 옮기거나 부호 있는 INT 로 바꾸면 ① 이 잡는다', () => {
  const line = '  sort_no       INT UNSIGNED NULL,';
  const i = src.struct.indexOf(line);
  assert.ok(i > 0, '변이 준비 실패: 정본의 sort_no 줄을 찾지 못했다');
  const full = src.struct.slice(i, src.struct.indexOf('\n', i) + 1);
  const noteLine = /^  note .*\n/m.exec(src.struct)[0];
  const moved = mutate(mutate(src.struct, full, ''), noteLine, noteLine + full);
  assert.throws(() => checks.structure({ ...src, struct: moved }), /바로 앞이 status_id 가 아니다/);
  assert.throws(() => checks.structure({ ...src, struct: mutate(src.struct, line, '  sort_no       INT NULL,') }), /INT UNSIGNED NULL 이 아니다/);
  assert.doesNotThrow(() => checks.structure(src));   // 통제군
});
test('과제 순서 변이②: 정본 표 설명에 고정 번호 문구를 되살리거나 조각만 다른 글자를 쓰면 ① 이 잡는다', () => {
  const c = "COMMENT='구분 코드. PK=section_id, name=UNIQUE 라벨. Admin 관리.'";
  assert.throws(() => checks.structure({ ...src, struct: mutate(src.struct, c, "COMMENT='구분 코드. PK=section_id(고정 번호 2=선진행), name=UNIQUE 라벨. Admin 관리.'") }), /고정 번호 문구가 남았다/);
  assert.throws(() => checks.structure({ ...src, frag: mutate(src.frag, "ALTER TABLE status_code COMMENT = ''상태 코드. PK=status_id, name=UNIQUE 라벨. Admin 관리.''", "ALTER TABLE status_code COMMENT = ''상태 코드.''") }), /status_code 표 설명이 정본과 다르다/);
});
test('과제 순서 변이③: 목록을 옛 순서(통상명칭만)로 되돌리거나 빈 순서를 앞으로 보내면 ② 가 잡는다', () => {
  const ord = '"ORDER BY s.sort_order, s.section_id, p.sort_no IS NULL, p.sort_no, COALESCE(NULLIF(p.common_name, \'\'), p.project_name), p.id"';
  assert.throws(() => checks.listOrder(mutate(src.pdb, ord, '"ORDER BY p.common_name"')), /로 시작하지 않는다/);
  assert.throws(() => checks.listOrder(mutate(src.pdb, ord, ord.replace('p.sort_no IS NULL, ', ''))), /로 시작하지 않는다/);
  assert.throws(() => checks.listOrder(mutate(src.pdb, '                        ["sortNo"]        = IntOrNull(rd, "sort_no"),', '')), /sortNo/);
  assert.doesNotThrow(() => checks.listOrder(src.pdb));   // 통제군
});
test('과제 순서 변이④: 순서 저장이 집합 대조를 빼거나, 관리자 관문으로 바꾸거나, 잠그지 않거나, 다른 구분까지 쓰면 ③ 이 잡는다', () => {
  //  같은 집합 대조가 다른 순서 저장(코드, 직급, 소속)에도 있어 앞줄(문자열 집합)까지 앵커에 넣는다.
  const cmp = 'var given = new HashSet<string>(kept, StringComparer.OrdinalIgnoreCase);\n                    if (given.Count != kept.Count || given.Count != live.Count || !given.SetEquals(live))';
  assert.throws(() => checks.reorder(mutate(src.pdb, cmp, 'var given = new HashSet<string>(kept, StringComparer.OrdinalIgnoreCase);\n                    if (false)'), src.main), /같은지\(중복, 빠짐, 낯선 uid\) 보지 않는다/);
  assert.throws(() => checks.reorder(mutate(src.pdb, 'catch (NotAuthorizedException nex) { _log("권한 거부(과제 순서): "', 'catch (NotAuthorizedException nex) { await OpenAdminAsync(cts.Token); _log("권한 거부(과제 순서): "'), src.main), /OpenWriteAsync 가 아니다/);
  assert.throws(() => checks.reorder(mutate(src.pdb, '"SELECT uid FROM project WHERE section_id=@sec AND is_active=1 FOR UPDATE"', '"SELECT uid FROM project WHERE section_id=@sec AND is_active=1"'), src.main), /FOR UPDATE/);
  assert.throws(() => checks.reorder(mutate(src.pdb, '"UPDATE project SET sort_no=@n WHERE uid=@uid AND section_id=@sec AND is_active=1"', '"UPDATE project SET sort_no=@n WHERE uid=@uid"'), src.main), /같은 구분의 보이는 과제만/);
  assert.throws(() => checks.reorder(mutate(src.pdb, 'return (false, ProjectOrderStaleMsg, true);', 'return (false, ProjectOrderStaleMsg, false);'), src.main), /stale=true 로 거부하지 않는다/);
  assert.throws(() => checks.reorder(src.pdb, mutate(src.main, '"setProjectActive", "projectReorder", ', '"setProjectActive", ')), /관리 창 허용 목록에 projectReorder 가 없다/);
  assert.throws(() => checks.reorder(src.pdb, mutate(src.main, '            if (ok || stale) await LoadProjectsToWebAsync();', '            if (ok) await LoadProjectsToWebAsync();')), /새 목록을 보내지 않는다/);
  assert.doesNotThrow(() => checks.reorder(src.pdb, src.main));   // 통제군
});
test('과제 순서 변이⑤: 수정의 대입 순서를 바꾸거나, 숨김 해제나 휴지통 복구에서 순서를 빼거나, 맨 뒤 셈에 숨긴 과제를 넣으면 ④ 가 잡는다', () => {
  const head = '"UPDATE project SET sort_no=IF(section_id=@sec, sort_no, @sortMoved), " +\n                                       "section_id=@sec, customer_id=@cust,';
  const swapped = '"UPDATE project SET section_id=@sec, sort_no=IF(section_id=@sec, sort_no, @sortMoved), " +\n                                       "customer_id=@cust,';
  assert.throws(() => checks.tailRules(mutate(src.pdb, head, swapped)), /section_id 대입이 sort_no 대입보다 앞이다/);
  assert.throws(() => checks.tailRules(mutate(src.pdb, '? "UPDATE project SET sort_no=IF(is_active=1, sort_no, @sort), is_active=1 WHERE uid=@uid"', '? "UPDATE project SET is_active=1 WHERE uid=@uid"')), /숨김 해제가/);
  assert.throws(() => checks.tailRules(mutate(src.pdb, 'case "project":  sql = "UPDATE project SET is_active=1, sort_no=@sort WHERE uid=@k"; break;', 'case "project":  sql = "UPDATE project SET is_active=1 WHERE uid=@k"; break;')), /휴지통의 과제 복구가 sort_no/);
  assert.throws(() => checks.tailRules(mutate(src.pdb, '"SELECT COALESCE(MAX(sort_no),0)+1 FROM project WHERE section_id=@sec AND is_active=1"', '"SELECT COALESCE(MAX(sort_no),0)+1 FROM project WHERE section_id=@sec"')), /보이는 과제 최댓값 \+ 1\) 이 아니다/);
  assert.throws(() => checks.tailRules(mutate(src.pdb, '                        cmd.Parameters.AddWithValue("@sort", sortNo);\n', '')), /INSERT 가 sort_no/);
  assert.doesNotThrow(() => checks.tailRules(src.pdb));   // 통제군
});
test('과제 순서 변이⑥: 읽기 전용 문장을 종료로 되돌리거나 엑셀 No 를 전체 연번으로 되돌리면 ⑤ 가 잡는다', () => {
  assert.throws(() => checks.wordingAndSheet(mutate(src.pcdb, '"숨긴 과제라 읽기 전용입니다."', '"종료되었거나 숨긴 과제라 읽기 전용입니다."'), src.main), /헷갈린다/);
  assert.throws(() => checks.wordingAndSheet(src.pcdb, mutate(src.main, '{ groupKey = key; no = 0; }', '{ groupKey = key; }')), /1 부터 다시 세지 않는다/);
  assert.throws(() => checks.wordingAndSheet(src.pcdb, mutate(src.main, 'cells[i] = ProjectExportNo(r, no).ToString(', 'cells[i] = no.ToString(')), /웹의 no\(화면 No\)를 먼저 쓰지 않는다/);
  assert.doesNotThrow(() => checks.wordingAndSheet(src.pcdb, src.main));   // 통제군
});
